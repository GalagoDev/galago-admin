import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getImportPaymentsConfig } from "@/lib/import-payments-config";
import type { ImportAllocation, ImportContainer, ImportInvoice, ImportInvoiceDraft, ImportPayment, ImportsOverview, SourcePayment } from "@/lib/import-payments-types";
import { parseImportMoney } from "@/lib/import-payments-types";
import { importBankParserVersion, type ImportBankRow } from "@/lib/import-bank-parser";

export const sourceSnapshotSchema = z.object({
  companyId: z.string().min(1).max(64),
  companyName: z.string().min(1).max(191),
  sourceFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sourceThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  payments: z.array(z.object({
    id: z.string().min(1).max(64), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    partner: z.string().max(191), reference: z.string().max(1000),
    amountMinor: z.number().int().positive().max(1_000_000_000_000), currency: z.enum(["BAM", "EUR", "USD"]),
    kind: z.enum(["payment", "fee"]), supplier: z.enum(["TADEX", "SHENGFENG"]).nullable(),
    statement: z.string().max(100), account: z.string().max(191), fileId: z.string().max(64).nullable(),
    excluded: z.boolean().optional(),
  })).max(20_000),
});

let initialized = false;
function db() {
  const database = getDb();
  if (!initialized) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS import_containers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, notes TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('planned','in_transit','received')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS import_payments (
        id TEXT PRIMARY KEY, data_json TEXT NOT NULL, supplier_override TEXT,
        available INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS import_allocations (
        id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES import_payments(id),
        container_id TEXT NOT NULL REFERENCES import_containers(id),
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        request_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS import_allocation_payment ON import_allocations(payment_id);
      CREATE INDEX IF NOT EXISTS import_allocation_container ON import_allocations(container_id);
      CREATE TABLE IF NOT EXISTS import_sync (
        id INTEGER PRIMARY KEY CHECK(id=1), company_id TEXT, last_success_at TEXT,
        source_from TEXT, source_through TEXT, last_error TEXT,
        last_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO import_sync(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS import_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS import_invoice_files (
        id TEXT PRIMARY KEY, container_id TEXT NOT NULL, data_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS import_container_invoices (
        container_id TEXT PRIMARY KEY REFERENCES import_containers(id),
        file_id TEXT NOT NULL REFERENCES import_invoice_files(id), data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS import_bank_documents (
        id TEXT PRIMARY KEY, hash TEXT NOT NULL, rows_json TEXT NOT NULL
      );
    `);
    initialized = true;
  }
  return database;
}

function audit(action: string, detail: unknown) {
  db().prepare("INSERT INTO import_audit(action,detail_json) VALUES(?,?)").run(action, JSON.stringify(detail));
}

export function applyImportSnapshot(input: unknown, expectedCompanyId: string) {
  const snapshot = sourceSnapshotSchema.parse(input);
  if (snapshot.companyId !== expectedCompanyId) throw new Error("Nalto firma ne odgovara konfiguraciji.");
  if (new Set(snapshot.payments.map(p => p.id)).size !== snapshot.payments.length) throw new Error("Nalto je vratio ponovljene transakcije.");
  const database = db();
  database.transaction(() => {
    const state = database.prepare("SELECT company_id FROM import_sync WHERE id=1").get() as { company_id: string | null };
    if (state.company_id && state.company_id !== snapshot.companyId) throw new Error("Nije dozvoljeno miješanje uplata različitih firmi.");
    database.prepare("UPDATE import_payments SET available=0").run();
    for (const payment of snapshot.payments) {
      const previous = database.prepare("SELECT data_json,supplier_override FROM import_payments WHERE id=?").get(payment.id) as { data_json: string; supplier_override: string | null } | undefined;
      const allocated = database.prepare("SELECT COUNT(*) AS n FROM import_allocations WHERE payment_id=?").get(payment.id) as { n: number };
      const before = previous ? JSON.parse(previous.data_json) as SourcePayment : null;
      // Never silently change the money/currency/supplier underneath saved allocations.
      const supplierChanged = (before?.supplier || previous?.supplier_override) !== (payment.supplier || previous?.supplier_override);
      if (allocated.n && before && (supplierChanged || Boolean(before.excluded) !== Boolean(payment.excluded) || ["amountMinor", "currency", "kind"].some(key => before[key as keyof SourcePayment] !== payment[key as keyof SourcePayment]))) continue;
      database.prepare(`INSERT INTO import_payments(id,data_json,available) VALUES(?,?,1)
        ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,available=1`).run(payment.id, JSON.stringify(payment));
      if (payment.supplier) database.prepare("UPDATE import_payments SET supplier_override=NULL WHERE id=?").run(payment.id);
    }
    database.prepare(`UPDATE import_sync SET company_id=?,last_success_at=?,source_from=?,source_through=?,last_error=NULL,lease_until=0 WHERE id=1`)
      .run(snapshot.companyId, new Date().toISOString(), snapshot.sourceFrom, snapshot.sourceThrough);
    audit("sync", { payments: snapshot.payments.length });
  }).immediate();
  return snapshot.payments.length;
}

export function getImportsOverview(): ImportsOverview {
  const database = db();
  const containers = database.prepare("SELECT id,name,notes,status FROM import_containers ORDER BY created_at DESC,id").all() as ImportContainer[];
  const allocations = database.prepare("SELECT id,payment_id AS paymentId,container_id AS containerId,amount_minor AS amountMinor FROM import_allocations ORDER BY created_at,id").all() as ImportAllocation[];
  const amounts = new Map<string, number>();
  for (const a of allocations) amounts.set(a.paymentId, (amounts.get(a.paymentId) || 0) + a.amountMinor);
  const payments = (database.prepare("SELECT * FROM import_payments").all() as Array<{ id: string; data_json: string; supplier_override: string | null; available: number }>).map((row): ImportPayment => {
    const source = JSON.parse(row.data_json) as SourcePayment;
    const override = row.supplier_override;
    return { ...source, sourceSupplier: source.supplier,
      supplier: override === "TADEX" || override === "SHENGFENG" ? override : source.supplier,
      ignored: override === "OTHER", available: Boolean(row.available), allocatedMinor: amounts.get(row.id) || 0 };
  }).filter(p => !p.excluded).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const state = database.prepare("SELECT * FROM import_sync WHERE id=1").get() as {
    company_id: string | null; last_success_at: string | null; source_from: string | null; source_through: string | null; last_error: string | null;
  };
  const invoices = (database.prepare("SELECT data_json FROM import_container_invoices").all() as Array<{ data_json: string }>).map(row => JSON.parse(row.data_json) as ImportInvoice);
  return { containers, payments, allocations, invoices, lastSyncAt: state.last_success_at, sourceFrom: state.source_from,
    sourceThrough: state.source_through, error: state.last_error, companyId: state.company_id,
    configured: Boolean(getImportPaymentsConfig()) };
}

export function getImportBankDocument(id: string, hash: string): ImportBankRow[] | null {
  const row = db().prepare("SELECT rows_json FROM import_bank_documents WHERE id=? AND hash=?").get(id, `${hash}:${importBankParserVersion}`) as { rows_json: string } | undefined;
  return row ? JSON.parse(row.rows_json) as ImportBankRow[] : null;
}

export function getImportBankDocumentHashes() {
  const rows = db().prepare("SELECT id,hash FROM import_bank_documents ORDER BY rowid DESC LIMIT 500").all() as Array<{ id: string; hash: string }>;
  return Object.fromEntries(rows.filter(row => row.hash.endsWith(`:${importBankParserVersion}`)).map(row => [row.id, row.hash.split(":")[0]]));
}

export function saveImportBankDocument(id: string, hash: string, rows: ImportBankRow[]) {
  db().prepare("INSERT INTO import_bank_documents(id,hash,rows_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,rows_json=excluded.rows_json")
    .run(id, `${hash}:${importBankParserVersion}`, JSON.stringify(rows));
}

export function saveImportContainer(input: unknown) {
  const value = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80),
    notes: z.string().trim().max(1000), status: z.enum(["planned", "in_transit", "received"]) }).parse(input);
  const id = value.id || randomUUID();
  const database = db();
  database.transaction(() => {
    if (database.prepare("SELECT id FROM import_containers WHERE name=? COLLATE NOCASE AND id<>?").get(value.name, id)) throw new Error("Kontejner s tom oznakom već postoji.");
    if (value.id) {
      if (!database.prepare("UPDATE import_containers SET name=?,notes=?,status=? WHERE id=?").run(value.name, value.notes, value.status, id).changes) throw new Error("Kontejner nije pronađen.");
    } else database.prepare("INSERT INTO import_containers(id,name,notes,status) VALUES(?,?,?,?)").run(id, value.name, value.notes, value.status);
    audit("container_saved", { ...value, id });
  }).immediate();
}

export function removeImportContainer(id: string) {
  z.string().uuid().parse(id);
  db().transaction(() => {
    if (db().prepare("SELECT 1 FROM import_allocations WHERE container_id=? LIMIT 1").get(id)) throw new Error("Prvo uklonite raspored uplata iz ovog kontejnera.");
    db().prepare("DELETE FROM import_container_invoices WHERE container_id=?").run(id);
    db().prepare("DELETE FROM import_containers WHERE id=?").run(id);
    audit("container_removed", { id });
  }).immediate();
}

export function addImportInvoiceFile(draft: ImportInvoiceDraft) {
  db().transaction(() => {
    if (!db().prepare("SELECT id FROM import_containers WHERE id=?").get(draft.containerId)) throw new Error("Kontejner nije pronađen.");
    db().prepare("INSERT INTO import_invoice_files(id,container_id,data_json) VALUES(?,?,?)").run(draft.fileId, draft.containerId, JSON.stringify(draft));
    audit("invoice_uploaded", { fileId: draft.fileId, containerId: draft.containerId });
  }).immediate();
}

export function getImportInvoiceFile(id: string): ImportInvoiceDraft | null {
  if (!z.string().uuid().safeParse(id).success) return null;
  const row = db().prepare("SELECT data_json FROM import_invoice_files WHERE id=?").get(id) as { data_json: string } | undefined;
  return row ? JSON.parse(row.data_json) as ImportInvoiceDraft : null;
}

export function saveImportInvoice(input: unknown) {
  const value = z.object({ containerId: z.string().uuid(), fileId: z.string().uuid(), number: z.string().trim().max(100),
    amount: z.string().max(30), currency: z.enum(["USD", "EUR", "BAM"]), supplier: z.enum(["TADEX", "SHENGFENG"]) }).parse(input);
  const totalMinor = parseImportMoney(value.amount);
  db().transaction(() => {
    const file = getImportInvoiceFile(value.fileId);
    if (!file || file.containerId !== value.containerId) throw new Error("Faktura ne pripada ovom kontejneru.");
    if (!db().prepare("SELECT id FROM import_containers WHERE id=?").get(value.containerId)) throw new Error("Kontejner nije pronađen.");
    const invoice: ImportInvoice = { containerId: value.containerId, fileId: file.fileId, filename: file.filename, number: value.number,
      totalMinor, currency: value.currency, supplier: value.supplier, warning: file.warning };
    db().prepare(`INSERT INTO import_container_invoices(container_id,file_id,data_json) VALUES(?,?,?)
      ON CONFLICT(container_id) DO UPDATE SET file_id=excluded.file_id,data_json=excluded.data_json`).run(value.containerId, value.fileId, JSON.stringify(invoice));
    audit("invoice_confirmed", invoice);
  }).immediate();
}

export function removeImportInvoice(containerId: string) {
  z.string().uuid().parse(containerId);
  db().transaction(() => {
    db().prepare("DELETE FROM import_container_invoices WHERE container_id=?").run(containerId);
    audit("invoice_unlinked", { containerId });
  }).immediate();
}

export function classifyImportPayment(id: string, supplier: string) {
  z.enum(["TADEX", "SHENGFENG", "OTHER", ""]).parse(supplier);
  db().transaction(() => {
    const row = db().prepare("SELECT data_json FROM import_payments WHERE id=? AND available=1").get(id) as { data_json: string } | undefined;
    if (!row) throw new Error("Uplata nije dostupna. Osvježite podatke.");
    if ((JSON.parse(row.data_json) as SourcePayment).supplier) throw new Error("Dobavljač je naveden u izvornom izvodu.");
    if (db().prepare("SELECT 1 FROM import_allocations WHERE payment_id=? LIMIT 1").get(id)) throw new Error("Prvo uklonite raspored ove uplate.");
    db().prepare("UPDATE import_payments SET supplier_override=? WHERE id=?").run(supplier || null, id);
    audit("supplier_confirmed", { id, supplier });
  }).immediate();
}

export function allocateImportPayment(input: unknown) {
  const value = z.object({ paymentId: z.string().min(1).max(64), containerId: z.string().uuid(),
    amount: z.string().max(30), requestId: z.string().uuid() }).parse(input);
  const amount = parseImportMoney(value.amount);
  db().transaction(() => {
    const previous = db().prepare("SELECT payment_id,container_id,amount_minor FROM import_allocations WHERE request_id=?").get(value.requestId) as { payment_id: string; container_id: string; amount_minor: number } | undefined;
    if (previous) {
      if (previous.payment_id !== value.paymentId || previous.container_id !== value.containerId || previous.amount_minor !== amount) throw new Error("Zahtjev je već iskorišten.");
      return;
    }
    const payment = getImportsOverview().payments.find(p => p.id === value.paymentId);
    if (!payment?.available || payment.ignored || !payment.supplier) throw new Error("Prvo potvrdite dobavljača dostupne uplate.");
    if (amount > payment.amountMinor - payment.allocatedMinor) throw new Error("Iznos je veći od neraspoređenog dijela uplate.");
    if (!db().prepare("SELECT id FROM import_containers WHERE id=?").get(value.containerId)) throw new Error("Kontejner nije pronađen.");
    db().prepare("INSERT INTO import_allocations(id,payment_id,container_id,amount_minor,request_id) VALUES(?,?,?,?,?)")
      .run(randomUUID(), value.paymentId, value.containerId, amount, value.requestId);
    audit("allocated", { ...value, amountMinor: amount });
  }).immediate();
}

export function removeImportAllocation(id: string) {
  z.string().uuid().parse(id);
  db().transaction(() => {
    const previous = db().prepare("SELECT * FROM import_allocations WHERE id=?").get(id);
    if (!previous) return;
    db().prepare("DELETE FROM import_allocations WHERE id=?").run(id);
    audit("allocation_removed", previous);
  }).immediate();
}

export function claimImportSync(manual = false) {
  const now = Date.now();
  return db().prepare(`UPDATE import_sync SET last_attempt_at=?,lease_until=? WHERE id=1 AND lease_until<=?
    AND last_attempt_at <= ? - CASE WHEN ?=1 THEN 60000 WHEN last_error IS NOT NULL THEN 900000 ELSE 21600000 END`)
    .run(now, now + 90_000, now, now, manual ? 1 : 0).changes > 0;
}

export function failImportSync(reason?: { phase: string; code: string; name: string }) {
  db().prepare("UPDATE import_sync SET lease_until=0,last_error=? WHERE id=1")
    .run("Nalto trenutno nije dostupan. Prikazani su posljednji uspješno preuzeti podaci.");
  if (reason) audit("sync_failed", reason);
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { ensureStorage } from "@/lib/storage";

const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type InvoiceRow = {
  id: number;
  invoice_month: string;
  title: string;
  amount: number | null;
  original_name: string;
  stored_name: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  file_hash: string;
  paid: number;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: number;
  month: string;
  title: string;
  amount: number | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  paid: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceOverview = {
  invoices: Invoice[];
  totals: {
    count: number;
    paid: number;
    unpaid: number;
    totalAmount: number;
    paidAmount: number;
    unpaidAmount: number;
  };
};

export class InvoiceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InvoiceError";
    this.code = code;
  }
}

function mapInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    month: row.invoice_month,
    title: row.title,
    amount: row.amount,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    paid: row.paid === 1,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function currentInvoiceMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function normalizeInvoiceMonth(value: unknown) {
  const month = String(value || "").trim();
  return MONTH_PATTERN.test(month) ? month : null;
}

export function shiftInvoiceMonth(month: string, delta: number) {
  const normalized = normalizeInvoiceMonth(month) || currentInvoiceMonth();
  const [year, monthNumber] = normalized.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function cleanTitle(value: string, fallbackName: string) {
  const fallback = path.basename(fallbackName, path.extname(fallbackName));
  const title = value.trim() || fallback.trim() || "Faktura";
  return title.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 160);
}

function parseAmount(value: string) {
  const input = value.trim();
  if (!input) return null;

  let normalized = input.replace(/\s|KM/gi, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new InvoiceError("amount-invalid", "Iznos fakture nije ispravan.");
  }
  return Math.round(amount * 100) / 100;
}

function detectInvoiceFile(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { extension: ".pdf", mimeType: "application/pdf" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  throw new InvoiceError("file-type", "Dokument mora biti PDF, JPG, PNG ili WEBP.");
}

export async function createInvoice(input: {
  month: string;
  title: string;
  amount: string;
  file: File;
}) {
  const month = normalizeInvoiceMonth(input.month);
  if (!month) throw new InvoiceError("month-invalid", "Mjesec fakture nije ispravan.");
  if (input.file.size === 0) throw new InvoiceError("file-missing", "Odaberite dokument fakture.");
  if (input.file.size > MAX_INVOICE_BYTES) throw new InvoiceError("file-size", "Dokument može imati najviše 10 MB.");

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const detected = detectInvoiceFile(bytes);
  const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const db = getDb();
  const duplicate = db
    .prepare("SELECT * FROM invoices WHERE invoice_month = ? AND file_hash = ?")
    .get(month, fileHash) as InvoiceRow | undefined;
  if (duplicate) return { invoice: mapInvoice(duplicate), created: false };

  const storage = ensureStorage();
  const monthFolder = path.join(storage.invoiceFiles, month);
  fs.mkdirSync(monthFolder, { recursive: true });
  const storedName = `${crypto.randomUUID()}${detected.extension}`;
  const storedPath = path.join(monthFolder, storedName);
  const relativePath = path.relative(storage.root, storedPath);

  fs.writeFileSync(storedPath, bytes, { flag: "wx" });
  try {
    const result = db
      .prepare(
        `INSERT INTO invoices (
           invoice_month, title, amount, original_name, stored_name, stored_path,
           mime_type, size_bytes, file_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        month,
        cleanTitle(input.title, input.file.name),
        parseAmount(input.amount),
        path.basename(input.file.name).slice(0, 220) || `faktura${detected.extension}`,
        storedName,
        relativePath,
        detected.mimeType,
        bytes.length,
        fileHash,
      );
    const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get(result.lastInsertRowid) as InvoiceRow;
    return { invoice: mapInvoice(row), created: true };
  } catch (error) {
    try {
      fs.unlinkSync(storedPath);
    } catch {
      // The database error is the useful failure; orphan cleanup is best effort.
    }
    throw error;
  }
}

export function getInvoiceOverview(month: string): InvoiceOverview {
  const normalized = normalizeInvoiceMonth(month) || currentInvoiceMonth();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM invoices
       WHERE invoice_month = ?
       ORDER BY paid ASC, datetime(created_at) DESC, id DESC`,
    )
    .all(normalized) as InvoiceRow[];
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS count,
         SUM(CASE WHEN paid = 1 THEN 1 ELSE 0 END) AS paid,
         SUM(CASE WHEN paid = 0 THEN 1 ELSE 0 END) AS unpaid,
         COALESCE(SUM(amount), 0) AS total_amount,
         COALESCE(SUM(CASE WHEN paid = 1 THEN amount ELSE 0 END), 0) AS paid_amount,
         COALESCE(SUM(CASE WHEN paid = 0 THEN amount ELSE 0 END), 0) AS unpaid_amount
       FROM invoices WHERE invoice_month = ?`,
    )
    .get(normalized) as {
      count: number;
      paid: number | null;
      unpaid: number | null;
      total_amount: number;
      paid_amount: number;
      unpaid_amount: number;
    };

  return {
    invoices: rows.map(mapInvoice),
    totals: {
      count: totals.count,
      paid: totals.paid || 0,
      unpaid: totals.unpaid || 0,
      totalAmount: totals.total_amount,
      paidAmount: totals.paid_amount,
      unpaidAmount: totals.unpaid_amount,
    },
  };
}

export function getInvoiceMonths() {
  const rows = getDb()
    .prepare("SELECT DISTINCT invoice_month FROM invoices ORDER BY invoice_month DESC LIMIT 60")
    .all() as Array<{ invoice_month: string }>;
  return rows.map((row) => row.invoice_month);
}

export function setInvoicePaid(id: number, paid: boolean) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE invoices
       SET paid = ?, paid_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(paid ? 1 : 0, paid ? now : null, now, id);
  return result.changes > 0;
}

export function deleteInvoice(id: number) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow | undefined;
  if (!row) return false;

  const deleted = db.prepare("DELETE FROM invoices WHERE id = ?").run(id).changes > 0;
  if (!deleted) return false;

  const storage = ensureStorage();
  const configuredPath = path.isAbsolute(row.stored_path)
    ? row.stored_path
    : path.resolve(storage.root, row.stored_path);
  try {
    const invoiceRoot = fs.realpathSync(storage.invoiceFiles);
    const storedPath = fs.realpathSync(configuredPath);
    if (storedPath.startsWith(`${invoiceRoot}${path.sep}`)) fs.unlinkSync(storedPath);
  } catch {
    // Missing files do not block removal from the register.
  }
  return true;
}

export function resolveInvoiceFile(id: number) {
  const row = getDb().prepare("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow | undefined;
  if (!row) return null;

  const storage = ensureStorage();
  const configuredPath = path.isAbsolute(row.stored_path)
    ? row.stored_path
    : path.resolve(storage.root, row.stored_path);
  try {
    const invoiceRoot = fs.realpathSync(storage.invoiceFiles);
    const storedPath = fs.realpathSync(configuredPath);
    if (storedPath !== invoiceRoot && !storedPath.startsWith(`${invoiceRoot}${path.sep}`)) return null;
    const stat = fs.statSync(storedPath);
    if (!stat.isFile()) return null;
    return {
      path: storedPath,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

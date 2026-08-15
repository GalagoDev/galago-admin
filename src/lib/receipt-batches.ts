import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/lib/db";
import type { SheetOrderRow } from "@/lib/google-sheets";
import { matchCourierDeliveries } from "@/lib/order-matching";
import type { ReceiptWorkbookRow } from "@/lib/receipt-workbook";
import { ensureStorage } from "@/lib/storage";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_TOTAL_BYTES = 50 * 1024 * 1024;

export type ReceiptBatch = {
  id: number;
  collectionDate: string;
  originalName: string;
  createdAt: string;
};

export type ReceiptRecipient = {
  id: number;
  batchId: number;
  position: number;
  sourceRowNumber: number;
  shipmentDateSort: number;
  shipmentDateLabel: string;
  recipient: string;
  city: string;
  amount: number | null;
  reference: string;
  phone: string;
  matchStatus: string;
  matchReason: string;
  pdfOriginalName: string;
  pdfHash: string;
  linkExpiresAt: string;
  sendStatus: string;
  sendError: string;
};

export type ReceiptBatchOverview = {
  batch: ReceiptBatch;
  recipients: ReceiptRecipient[];
  totals: {
    customers: number;
    phones: number;
    pdfs: number;
    sent: number;
    amount: number;
  };
};

export class ReceiptBatchError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function collectionDateToday() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/Sarajevo",
  }).format(new Date());
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("387")) return digits;
  if (digits.startsWith("0")) return `387${digits.slice(1)}`;
  if (digits.startsWith("6")) return `387${digits}`;
  return digits;
}

function matchPhones(rows: ReceiptWorkbookRow[], orders: SheetOrderRow[]) {
  const result = matchCourierDeliveries(
    rows.map((row) => ({
      sourceRowNumber: row.sourceRowNumber,
      recipient: row.recipient,
      city: row.city,
      amount: row.amount,
      product: row.reference,
    })),
    orders,
  );
  const matches = new Map(result.matches.map((match) => [match.source.sourceRowNumber, match]));
  const ambiguous = new Set(result.ambiguous.map((entry) => entry.source.sourceRowNumber));

  return rows.map((row) => {
    const match = matches.get(row.sourceRowNumber);
    const phone = normalizePhone(match?.order.brojTelefona ?? "");
    return {
      row,
      phone,
      matchStatus: match ? (phone ? "matched" : "missing_phone") : ambiguous.has(row.sourceRowNumber) ? "ambiguous" : "unmatched",
      matchReason: match?.reason ?? (ambiguous.has(row.sourceRowNumber) ? "Više narudžbi sa istim imenom" : "Ime nije pronađeno u Orders sheetu"),
      matchedOrderRow: match?.order.sheetRowNumber ?? null,
    };
  });
}

function mapBatch(row: Record<string, unknown>): ReceiptBatch {
  return {
    id: Number(row.id),
    collectionDate: String(row.collection_date),
    originalName: String(row.original_name),
    createdAt: String(row.created_at),
  };
}

function mapRecipient(row: Record<string, unknown>): ReceiptRecipient {
  return {
    id: Number(row.id),
    batchId: Number(row.batch_id),
    position: Number(row.position),
    sourceRowNumber: Number(row.source_row_number),
    shipmentDateSort: Number(row.shipment_date_sort),
    shipmentDateLabel: String(row.shipment_date_label),
    recipient: String(row.recipient),
    city: String(row.city ?? ""),
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    reference: String(row.reference ?? ""),
    phone: String(row.phone ?? ""),
    matchStatus: String(row.match_status),
    matchReason: String(row.match_reason ?? ""),
    pdfOriginalName: String(row.pdf_original_name ?? ""),
    pdfHash: String(row.pdf_hash ?? ""),
    linkExpiresAt: String(row.link_expires_at ?? ""),
    sendStatus: String(row.send_status),
    sendError: String(row.send_error ?? ""),
  };
}

export function createReceiptBatch(
  originalName: string,
  fileHash: string,
  rows: ReceiptWorkbookRow[],
  orders: SheetOrderRow[],
) {
  const db = getDb();
  const collectionDate = collectionDateToday();
  const existing = db.prepare(
    "SELECT * FROM receipt_batches WHERE collection_date = ? AND file_hash = ?",
  ).get(collectionDate, fileHash) as Record<string, unknown> | undefined;
  if (existing) return { batch: mapBatch(existing), created: false };

  const matchedRows = matchPhones(rows, orders);
  const transaction = db.transaction(() => {
    const batchResult = db.prepare(
      "INSERT INTO receipt_batches (collection_date, original_name, file_hash) VALUES (?, ?, ?)",
    ).run(collectionDate, originalName, fileHash);
    const batchId = Number(batchResult.lastInsertRowid);
    const insert = db.prepare(`
      INSERT INTO receipt_recipients (
        batch_id, position, source_row_number, shipment_date_sort, shipment_date_label,
        recipient, city, amount, reference, phone, match_status, match_reason, matched_order_row
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    matchedRows.forEach((entry, index) => {
      insert.run(
        batchId,
        index + 1,
        entry.row.sourceRowNumber,
        entry.row.shipmentDateSort,
        entry.row.shipmentDateLabel,
        entry.row.recipient,
        entry.row.city,
        entry.row.amount,
        entry.row.reference,
        entry.phone,
        entry.matchStatus,
        entry.matchReason,
        entry.matchedOrderRow,
      );
    });

    return batchId;
  });

  const batchId = transaction();
  const batch = db.prepare("SELECT * FROM receipt_batches WHERE id = ?").get(batchId) as Record<string, unknown>;
  return { batch: mapBatch(batch), created: true };
}

export function getReceiptBatchOverview(batchId?: number): ReceiptBatchOverview | null {
  const db = getDb();
  const batchRow = batchId
    ? db.prepare("SELECT * FROM receipt_batches WHERE id = ?").get(batchId)
    : db.prepare("SELECT * FROM receipt_batches WHERE collection_date = ? ORDER BY id DESC LIMIT 1").get(collectionDateToday());
  if (!batchRow) return null;

  const batch = mapBatch(batchRow as Record<string, unknown>);
  const recipientRows = db.prepare("SELECT * FROM receipt_recipients WHERE batch_id = ? ORDER BY position").all(batch.id) as Record<string, unknown>[];
  const recipients = recipientRows.map(mapRecipient);
  return {
    batch,
    recipients,
    totals: {
      customers: recipients.length,
      phones: recipients.filter((row) => row.phone).length,
      pdfs: recipients.filter((row) => row.pdfOriginalName).length,
      sent: recipients.filter((row) => row.sendStatus === "sent").length,
      amount: recipients.reduce((sum, row) => sum + (row.amount ?? 0), 0),
    },
  };
}

export function getRecentReceiptBatches(limit = 8) {
  const db = getDb();
  return (db.prepare("SELECT * FROM receipt_batches ORDER BY id DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(mapBatch);
}

export async function deleteReceiptBatch(batchId: number) {
  const db = getDb();
  const batch = db.prepare("SELECT id FROM receipt_batches WHERE id = ?").get(batchId) as { id: number } | undefined;
  if (!batch) throw new ReceiptBatchError("batch-not-found", "Dnevna lista nije pronađena.");

  const sent = db.prepare(
    "SELECT COUNT(*) AS count FROM receipt_recipients WHERE batch_id = ? AND send_status = 'sent'",
  ).get(batchId) as { count: number };
  if (sent.count > 0) {
    throw new ReceiptBatchError("delete-locked", "Poslana dnevna lista se ne može obrisati.");
  }

  db.prepare("DELETE FROM receipt_batches WHERE id = ?").run(batchId);

  const storage = ensureStorage();
  const batchDir = path.join(storage.receiptPdfs, `batch-${batchId}`);
  await fs.rm(batchDir, { recursive: true, force: true }).catch((error) => {
    console.error(`Receipt batch ${batchId} was deleted, but its PDF folder could not be removed`, error);
  });
}

export function refreshReceiptBatchPhones(batchId: number, orders: SheetOrderRow[]) {
  const overview = getReceiptBatchOverview(batchId);
  if (!overview) throw new ReceiptBatchError("batch-not-found", "Dnevna lista nije pronađena.");
  const rows: ReceiptWorkbookRow[] = overview.recipients.map((row) => ({
    sourceRowNumber: row.id,
    shipmentDateSort: row.shipmentDateSort,
    shipmentDateLabel: row.shipmentDateLabel,
    recipient: row.recipient,
    city: row.city,
    amount: row.amount,
    reference: row.reference,
  }));
  const matched = matchPhones(rows, orders);
  const db = getDb();
  const update = db.prepare(`
    UPDATE receipt_recipients
    SET phone = ?, match_status = ?, match_reason = ?, matched_order_row = ?,
        send_status = CASE
          WHEN pdf_stored_path IS NULL THEN 'pending_pdf'
          WHEN ? != '' THEN 'ready'
          ELSE 'blocked'
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND batch_id = ? AND send_status != 'sent'
  `);
  const transaction = db.transaction(() => {
    matched.forEach((entry) => {
      update.run(
        entry.phone,
        entry.matchStatus,
        entry.matchReason,
        entry.matchedOrderRow,
        entry.phone,
        entry.row.sourceRowNumber,
        batchId,
      );
    });
  });
  transaction();
  return matched.filter((entry) => entry.phone).length;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "racun.pdf";
}

export async function saveReceiptPdfs(batchId: number, uploadedFiles: File[]) {
  const overview = getReceiptBatchOverview(batchId);
  if (!overview) throw new ReceiptBatchError("batch-not-found", "Dnevna lista nije pronađena.");
  if (overview.recipients.some((row) => row.sendStatus === "sent")) {
    throw new ReceiptBatchError("pdf-locked", "PDF dokumenti se ne mogu zamijeniti nakon slanja.");
  }

  const files = uploadedFiles.filter((file) => file.size > 0);
  if (files.length !== overview.recipients.length) {
    throw new ReceiptBatchError("pdf-count", `Potrebno je ${overview.recipients.length} PDF dokumenata.`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_PDF_TOTAL_BYTES) throw new ReceiptBatchError("pdf-total-size", "PDF dokumenti mogu imati ukupno najviše 50 MB.");

  const collator = new Intl.Collator("bs", { numeric: true, sensitivity: "base" });
  files.sort((a, b) => collator.compare(a.name, b.name));
  const validated: Array<{ originalName: string; storedName: string; bytes: Buffer; hash: string }> = [];
  for (const [index, file] of files.entries()) {
    if (!file.name.toLowerCase().endsWith(".pdf")) throw new ReceiptBatchError("pdf-type", "Svi dokumenti moraju biti PDF.");
    if (file.size > MAX_PDF_BYTES) throw new ReceiptBatchError("pdf-size", `${file.name} je veći od 10 MB.`);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ReceiptBatchError("pdf-type", `${file.name} nije ispravan PDF.`);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const storedName = `${String(index + 1).padStart(3, "0")}-${hash}-${sanitizeFileName(file.name)}`;
    validated.push({ originalName: file.name, storedName, bytes, hash });
  }

  const storage = ensureStorage();
  const batchDir = path.join(storage.receiptPdfs, `batch-${batchId}`);
  await fs.mkdir(batchDir, { recursive: true });
  const saved = validated.map((file) => ({
    originalName: file.originalName,
    storedName: file.storedName,
    storedPath: path.join(batchDir, file.storedName),
    hash: file.hash,
  }));
  const writtenPaths: string[] = [];
  try {
    for (const [index, file] of validated.entries()) {
      await fs.writeFile(saved[index].storedPath, file.bytes);
      writtenPaths.push(saved[index].storedPath);
    }
  } catch (error) {
    await Promise.all(writtenPaths.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
    throw error;
  }

  const db = getDb();
  const previousPaths = (db.prepare(
    "SELECT pdf_stored_path FROM receipt_recipients WHERE batch_id = ? AND pdf_stored_path IS NOT NULL",
  ).all(batchId) as Array<{ pdf_stored_path: string }>).map((row) => row.pdf_stored_path);
  const update = db.prepare(`
    UPDATE receipt_recipients
    SET pdf_original_name = ?, pdf_stored_name = ?, pdf_stored_path = ?, pdf_hash = ?,
        pdf_uploaded_at = CURRENT_TIMESTAMP, link_expires_at = datetime('now', '+90 days'),
        send_status = CASE WHEN COALESCE(phone, '') != '' THEN 'ready' ELSE 'blocked' END,
        send_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND batch_id = ?
  `);
  const transaction = db.transaction(() => {
    overview.recipients.forEach((recipient, index) => {
      const file = saved[index];
      update.run(file.originalName, file.storedName, file.storedPath, file.hash, recipient.id, batchId);
    });
  });
  transaction();

  const currentPaths = new Set(saved.map((file) => file.storedPath));
  await Promise.all(previousPaths.filter((filePath) => filePath && !currentPaths.has(filePath)).map((filePath) => fs.unlink(filePath).catch(() => undefined)));
  return saved.length;
}

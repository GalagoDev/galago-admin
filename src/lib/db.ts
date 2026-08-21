import Database from "better-sqlite3";
import path from "node:path";

import { ensureStorage, resolveRuntimePath } from "@/lib/storage";

let database: Database.Database | null = null;

function ensureColumn(db: Database.Database, table: string, column: string, sql: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = columns.some((item) => item.name === column);

  if (!exists) {
    db.exec(sql);
  }
}

export function getDb() {
  if (database) {
    return database;
  }

  const storage = ensureStorage();
  const dbPath = process.env.DATABASE_PATH
    ? resolveRuntimePath(process.env.DATABASE_PATH)
    : path.join(storage.data, "store.db");

  database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      extracted_text TEXT,
      uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      customer_name TEXT,
      phone TEXT,
      city TEXT,
      address TEXT,
      product_summary TEXT,
      quantity INTEGER,
      notes TEXT,
      raw_text TEXT,
      status TEXT NOT NULL DEFAULT 'incoming',
      document_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );

    CREATE TABLE IF NOT EXISTS receipt_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_date TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(collection_date, file_hash)
    );

    CREATE TABLE IF NOT EXISTS receipt_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      source_row_number INTEGER NOT NULL,
      shipment_date_sort INTEGER NOT NULL,
      shipment_date_label TEXT NOT NULL,
      recipient TEXT NOT NULL,
      city TEXT,
      amount REAL,
      reference TEXT,
      phone TEXT,
      match_status TEXT NOT NULL,
      match_reason TEXT,
      matched_order_row INTEGER,
      pdf_original_name TEXT,
      pdf_stored_name TEXT,
      pdf_stored_path TEXT,
      pdf_hash TEXT,
      pdf_uploaded_at TEXT,
      link_expires_at TEXT,
      send_status TEXT NOT NULL DEFAULT 'pending_pdf',
      provider TEXT,
      provider_message_id TEXT,
      sent_at TEXT,
      send_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(batch_id) REFERENCES receipt_batches(id) ON DELETE CASCADE,
      UNIQUE(batch_id, position)
    );

    CREATE TABLE IF NOT EXISTS customer_return_claims (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      request_type TEXT NOT NULL,
      order_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      phone TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_return_files (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(claim_id) REFERENCES customer_return_claims(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customer_return_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_month TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(invoice_month, file_hash)
    );

    CREATE INDEX IF NOT EXISTS receipt_batches_collection_date_idx
      ON receipt_batches(collection_date, id DESC);
    CREATE INDEX IF NOT EXISTS receipt_recipients_batch_idx
      ON receipt_recipients(batch_id, position);
    CREATE INDEX IF NOT EXISTS customer_return_claims_created_idx
      ON customer_return_claims(created_at DESC);
    CREATE INDEX IF NOT EXISTS customer_return_files_claim_idx
      ON customer_return_files(claim_id, created_at);
    CREATE INDEX IF NOT EXISTS customer_return_rate_limits_idx
      ON customer_return_rate_limits(ip_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS invoices_month_idx
      ON invoices(invoice_month DESC, paid, created_at DESC);
  `);

  ensureColumn(database, "documents", "extracted_text", "ALTER TABLE documents ADD COLUMN extracted_text TEXT");
  ensureColumn(database, "orders", "document_id", "ALTER TABLE orders ADD COLUMN document_id INTEGER");
  ensureColumn(database, "receipt_recipients", "pdf_uploaded_at", "ALTER TABLE receipt_recipients ADD COLUMN pdf_uploaded_at TEXT");
  ensureColumn(database, "receipt_recipients", "link_expires_at", "ALTER TABLE receipt_recipients ADD COLUMN link_expires_at TEXT");
  database.exec(`
    UPDATE receipt_recipients
    SET pdf_uploaded_at = COALESCE(pdf_uploaded_at, updated_at),
        link_expires_at = COALESCE(link_expires_at, datetime(COALESCE(pdf_uploaded_at, updated_at), '+90 days'))
    WHERE pdf_stored_path IS NOT NULL
      AND (pdf_uploaded_at IS NULL OR link_expires_at IS NULL)
  `);

  return database;
}

export function getDashboardStats() {
  const db = getDb();

  const incoming = db
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'incoming'")
    .get() as { count: number };
  const sent = db
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'sent'")
    .get() as { count: number };
  const delivered = db
    .prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'delivered'")
    .get() as { count: number };

  return {
    incoming: incoming.count,
    sent: sent.count,
    delivered: delivered.count,
    undelivered: Math.max(sent.count - delivered.count, 0),
  };
}

export function getTodayIncomingStats() {
  const db = getDb();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const incoming = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM orders
       WHERE status = 'incoming'
         AND date(datetime(created_at, 'localtime')) = date(?)`
    )
    .get(today) as { count: number };

  return {
    incoming: incoming.count,
    dateLabel: today,
  };
}

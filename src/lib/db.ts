import Database from "better-sqlite3";
import path from "node:path";

import { ensureStorage } from "@/lib/storage";

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
    ? path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.DATABASE_PATH)
    : path.join(storage.data, "store.db");

  database = new Database(dbPath);
  database.pragma("journal_mode = WAL");

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
  `);

  ensureColumn(database, "documents", "extracted_text", "ALTER TABLE documents ADD COLUMN extracted_text TEXT");
  ensureColumn(database, "orders", "document_id", "ALTER TABLE orders ADD COLUMN document_id INTEGER");

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

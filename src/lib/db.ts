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

    CREATE TABLE IF NOT EXISTS inventory_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      file_hash TEXT NOT NULL UNIQUE,
      item_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      unit_cost REAL NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_import_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(last_import_id) REFERENCES inventory_imports(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_product_aliases (
      normalized_alias TEXT PRIMARY KEY,
      alias_label TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_shopify_sync_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_attempt_at TEXT,
      last_success_at TEXT,
      matched_products INTEGER NOT NULL DEFAULT 0,
      catalog_products INTEGER NOT NULL DEFAULT 0,
      total_variants INTEGER NOT NULL DEFAULT 0,
      matched_variants INTEGER NOT NULL DEFAULT 0,
      unmatched_variants INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_confirmed_orders (
      chat_id TEXT NOT NULL,
      preview_message_id INTEGER NOT NULL,
      source_message_id TEXT NOT NULL,
      sheet_order_id TEXT NOT NULL UNIQUE,
      order_json TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(chat_id, preview_message_id)
    );

    CREATE TABLE IF NOT EXISTS ananas_product_links (
      shopify_variant_id TEXT PRIMARY KEY,
      shopify_product_id TEXT NOT NULL,
      shopify_inventory_item_id TEXT UNIQUE,
      ean TEXT,
      sku TEXT,
      ananas_product_id INTEGER,
      merchant_inventory_id INTEGER,
      active_discount_id TEXT,
      import_progress_id TEXT,
      catalog_submitted_at TEXT,
      discount_date_from TEXT,
      discount_date_to TEXT,
      discount_type TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      last_catalog_hash TEXT,
      last_inventory INTEGER,
      last_base_price REAL,
      last_discount_price REAL,
      last_error TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ananas_sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      scheduled_for TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS integration_webhook_receipts (
      provider TEXT NOT NULL,
      webhook_id TEXT NOT NULL,
      topic TEXT,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, webhook_id)
    );

    CREATE TABLE IF NOT EXISTS ananas_invoices (
      invoice_key TEXT PRIMARY KEY,
      invoice_type TEXT,
      invoice_number TEXT,
      issued_at TEXT,
      payload_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ananas_scheduler_runs (
      run_date TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      last_error TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      PRIMARY KEY(run_date, action)
    );

    CREATE TABLE IF NOT EXISTS bazzar_feed_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_attempt_at TEXT NOT NULL,
      last_success_at TEXT,
      last_error TEXT,
      offer_count INTEGER NOT NULL DEFAULT 0,
      in_stock_count INTEGER NOT NULL DEFAULT 0,
      discount_count INTEGER NOT NULL DEFAULT 0,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      payload_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS bedly_ananas_order_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      activated_at TEXT NOT NULL,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      lease_owner TEXT,
      lease_until INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bedly_ananas_order_stock (
      order_id TEXT NOT NULL,
      inventory_sku TEXT NOT NULL,
      inventory_product_id INTEGER NOT NULL,
      applied_units INTEGER NOT NULL CHECK(applied_units >= 0),
      dispatched INTEGER NOT NULL DEFAULT 0,
      statuses TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(order_id, inventory_sku),
      FOREIGN KEY(inventory_product_id) REFERENCES inventory_products(id)
    );

    CREATE TABLE IF NOT EXISTS bedly_ananas_stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      inventory_sku TEXT NOT NULL,
      deducted_units INTEGER NOT NULL,
      quantity_after REAL NOT NULL,
      created_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS inventory_products_active_idx
      ON inventory_products(active, normalized_name);
    CREATE INDEX IF NOT EXISTS inventory_aliases_product_idx
      ON inventory_product_aliases(product_id);
    CREATE INDEX IF NOT EXISTS telegram_confirmed_orders_sheet_idx
      ON telegram_confirmed_orders(sheet_order_id, deleted_at);
    CREATE INDEX IF NOT EXISTS ananas_product_links_ean_idx
      ON ananas_product_links(ean);
    CREATE INDEX IF NOT EXISTS ananas_product_links_inventory_idx
      ON ananas_product_links(shopify_inventory_item_id);
    CREATE INDEX IF NOT EXISTS ananas_sync_jobs_pending_idx
      ON ananas_sync_jobs(status, scheduled_for, id);
  `);

  ensureColumn(database, "documents", "extracted_text", "ALTER TABLE documents ADD COLUMN extracted_text TEXT");
  ensureColumn(database, "orders", "document_id", "ALTER TABLE orders ADD COLUMN document_id INTEGER");
  ensureColumn(database, "receipt_recipients", "pdf_uploaded_at", "ALTER TABLE receipt_recipients ADD COLUMN pdf_uploaded_at TEXT");
  ensureColumn(database, "receipt_recipients", "link_expires_at", "ALTER TABLE receipt_recipients ADD COLUMN link_expires_at TEXT");
  ensureColumn(database, "customer_return_claims", "company_name", "ALTER TABLE customer_return_claims ADD COLUMN company_name TEXT");
  ensureColumn(database, "customer_return_claims", "company_id_number", "ALTER TABLE customer_return_claims ADD COLUMN company_id_number TEXT");
  ensureColumn(database, "customer_return_claims", "company_vat_number", "ALTER TABLE customer_return_claims ADD COLUMN company_vat_number TEXT");
  ensureColumn(database, "customer_return_claims", "company_address", "ALTER TABLE customer_return_claims ADD COLUMN company_address TEXT");
  ensureColumn(database, "ananas_product_links", "import_progress_id", "ALTER TABLE ananas_product_links ADD COLUMN import_progress_id TEXT");
  ensureColumn(database, "ananas_product_links", "catalog_submitted_at", "ALTER TABLE ananas_product_links ADD COLUMN catalog_submitted_at TEXT");
  ensureColumn(database, "ananas_product_links", "discount_date_from", "ALTER TABLE ananas_product_links ADD COLUMN discount_date_from TEXT");
  ensureColumn(database, "ananas_product_links", "discount_date_to", "ALTER TABLE ananas_product_links ADD COLUMN discount_date_to TEXT");
  ensureColumn(database, "ananas_product_links", "discount_type", "ALTER TABLE ananas_product_links ADD COLUMN discount_type TEXT");
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

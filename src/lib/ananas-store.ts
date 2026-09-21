import crypto from "node:crypto";

import { getDb } from "@/lib/db";

export type AnanasJobType = "product_upsert" | "inventory_update" | "full_reconcile" | "invoice_sync";

export type AnanasSyncJob = {
  id: number;
  job_type: AnanasJobType;
  entity_key: string;
  payload_json: string;
  status: string;
  attempts: number;
  scheduled_for: string;
  last_error: string | null;
};

export type AnanasProductLink = {
  shopify_variant_id: string;
  shopify_product_id: string;
  shopify_inventory_item_id: string | null;
  ean: string | null;
  sku: string | null;
  ananas_product_id: number | null;
  merchant_inventory_id: number | null;
  active_discount_id: string | null;
  import_progress_id: string | null;
  catalog_submitted_at: string | null;
  discount_date_from: string | null;
  discount_date_to: string | null;
  discount_type: string | null;
  sync_status: string;
  last_catalog_hash: string | null;
  last_inventory: number | null;
  last_base_price: number | null;
  last_discount_price: number | null;
  last_error: string | null;
  last_synced_at: string | null;
};

export function payloadHash(payload: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function recordWebhook(provider: string, webhookId: string, topic: string | null) {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO integration_webhook_receipts (provider, webhook_id, topic)
       VALUES (?, ?, ?)`,
    )
    .run(provider, webhookId, topic);
  return result.changes === 1;
}

export function enqueueAnanasJob(jobType: AnanasJobType, entityKey: string, payload: unknown) {
  const db = getDb();
  const serialized = JSON.stringify(payload);
  const existing = db
    .prepare(
      `SELECT id FROM ananas_sync_jobs
       WHERE job_type = ? AND entity_key = ? AND payload_json = ? AND status IN ('pending', 'running')
       LIMIT 1`,
    )
    .get(jobType, entityKey, serialized) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      `INSERT INTO ananas_sync_jobs (job_type, entity_key, payload_json)
       VALUES (?, ?, ?)`,
    )
    .run(jobType, entityKey, serialized);
  return Number(result.lastInsertRowid);
}

export function claimPendingAnanasJobs(limit = 10) {
  const db = getDb();
  const claim = db.transaction(() => {
    const jobs = db
      .prepare(
        `SELECT id, job_type, entity_key, payload_json, status, attempts, scheduled_for, last_error
         FROM ananas_sync_jobs
         WHERE status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 100))) as AnanasSyncJob[];
    const statement = db.prepare(
      `UPDATE ananas_sync_jobs
       SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
    );
    return jobs.filter((job) => statement.run(job.id).changes === 1);
  });
  return claim();
}

export function completeAnanasJob(id: number) {
  getDb()
    .prepare(
      `UPDATE ananas_sync_jobs
       SET status = 'succeeded', last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(id);
}

export function failAnanasJob(id: number, attempts: number, error: string) {
  const finalFailure = attempts >= 6;
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  getDb()
    .prepare(
      `UPDATE ananas_sync_jobs
       SET status = ?, last_error = ?, scheduled_for = datetime('now', ?), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(finalFailure ? "failed" : "pending", error.slice(0, 2000), `+${delayMinutes} minutes`, id);
}

export function upsertAnanasProductLink(input: {
  shopifyVariantId: string;
  shopifyProductId: string;
  shopifyInventoryItemId: string | null;
  ean: string | null;
  sku: string | null;
  status?: string;
  error?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO ananas_product_links (
        shopify_variant_id, shopify_product_id, shopify_inventory_item_id, ean, sku, sync_status, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shopify_variant_id) DO UPDATE SET
        shopify_product_id = excluded.shopify_product_id,
        shopify_inventory_item_id = excluded.shopify_inventory_item_id,
        ean = excluded.ean,
        sku = excluded.sku,
        sync_status = CASE
          WHEN excluded.last_error IS NOT NULL THEN excluded.sync_status
          WHEN ananas_product_links.ananas_product_id IS NULL
               AND ananas_product_links.catalog_submitted_at IS NOT NULL THEN 'pending_listing'
          ELSE excluded.sync_status
        END,
        last_error = excluded.last_error,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .run(
      input.shopifyVariantId,
      input.shopifyProductId,
      input.shopifyInventoryItemId,
      input.ean,
      input.sku,
      input.status || "pending",
      input.error || null,
    );
}

export function getAnanasLinkByVariantId(variantId: string) {
  return getDb()
    .prepare("SELECT * FROM ananas_product_links WHERE shopify_variant_id = ?")
    .get(variantId) as AnanasProductLink | undefined;
}

export function getAnanasLinkByInventoryItemId(inventoryItemId: string) {
  return getDb()
    .prepare("SELECT * FROM ananas_product_links WHERE shopify_inventory_item_id = ?")
    .get(inventoryItemId) as AnanasProductLink | undefined;
}

export function saveAnanasProductId(ean: string, ananasId: number) {
  return getDb()
    .prepare(
      `UPDATE ananas_product_links
       SET ananas_product_id = ?, merchant_inventory_id = ?,
           sync_status = CASE WHEN last_error IS NULL THEN 'listed' ELSE 'needs_attention' END,
           last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE ean = ?`,
    )
    .run(ananasId, ananasId, ean);
}

export function markAnanasCatalogSubmitted(
  items: Array<{ variantId: string; catalogHash: string }>,
  progressId: string | null,
) {
  const db = getDb();
  const update = db.prepare(
    `UPDATE ananas_product_links
     SET last_catalog_hash = ?, import_progress_id = ?, catalog_submitted_at = CURRENT_TIMESTAMP,
         sync_status = CASE WHEN last_error IS NULL THEN 'pending_listing' ELSE 'needs_attention' END,
         updated_at = CURRENT_TIMESTAMP
     WHERE shopify_variant_id = ?`,
  );
  db.transaction(() => {
    for (const item of items) update.run(item.catalogHash, progressId, item.variantId);
  })();
}

export function clearAnanasDiscount(variantId: string) {
  getDb()
    .prepare(
      `UPDATE ananas_product_links
       SET active_discount_id = NULL, last_discount_price = NULL,
           discount_date_from = NULL, discount_date_to = NULL, discount_type = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE shopify_variant_id = ?`,
    )
    .run(variantId);
}

export function markAnanasLinkSynced(input: {
  variantId: string;
  catalogHash?: string;
  inventory?: number;
  basePrice?: number;
  discountPrice?: number | null;
  discountId?: string | null;
  discountDateFrom?: string | null;
  discountDateTo?: string | null;
  discountType?: string | null;
}) {
  const fields = ["sync_status = 'synced'", "last_error = NULL", "last_synced_at = CURRENT_TIMESTAMP", "updated_at = CURRENT_TIMESTAMP"];
  const values: Array<string | number | null> = [];
  if (input.catalogHash !== undefined) {
    fields.push("last_catalog_hash = ?");
    values.push(input.catalogHash);
  }
  if (input.inventory !== undefined) {
    fields.push("last_inventory = ?");
    values.push(input.inventory);
  }
  if (input.basePrice !== undefined) {
    fields.push("last_base_price = ?");
    values.push(input.basePrice);
  }
  if (input.discountPrice !== undefined) {
    fields.push("last_discount_price = ?");
    values.push(input.discountPrice);
  }
  if (input.discountId !== undefined) {
    fields.push("active_discount_id = ?");
    values.push(input.discountId);
  }
  if (input.discountDateFrom !== undefined) {
    fields.push("discount_date_from = ?");
    values.push(input.discountDateFrom);
  }
  if (input.discountDateTo !== undefined) {
    fields.push("discount_date_to = ?");
    values.push(input.discountDateTo);
  }
  if (input.discountType !== undefined) {
    fields.push("discount_type = ?");
    values.push(input.discountType);
  }
  values.push(input.variantId);
  getDb().prepare(`UPDATE ananas_product_links SET ${fields.join(", ")} WHERE shopify_variant_id = ?`).run(...values);
}

export function markAnanasLinkError(variantId: string, error: string) {
  getDb()
    .prepare(
      `UPDATE ananas_product_links
       SET sync_status = 'error', last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE shopify_variant_id = ?`,
    )
    .run(error.slice(0, 2000), variantId);
}

export function markAnanasLinkNeedsAttention(variantId: string, warning: string) {
  getDb()
    .prepare(
      `UPDATE ananas_product_links
       SET sync_status = 'needs_attention', last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE shopify_variant_id = ?`,
    )
    .run(warning.slice(0, 2000), variantId);
}

export function saveAnanasInvoice(invoiceKey: string, payload: unknown) {
  const data = payload as Record<string, unknown>;
  getDb()
    .prepare(
      `INSERT INTO ananas_invoices (invoice_key, invoice_type, invoice_number, issued_at, payload_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(invoice_key) DO UPDATE SET
         invoice_type = excluded.invoice_type,
         invoice_number = excluded.invoice_number,
         issued_at = excluded.issued_at,
         payload_json = excluded.payload_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(
      invoiceKey,
      String(data.invoiceType || data.type || "") || null,
      String(data.invoiceNumber || data.number || "") || null,
      String(data.issuedAt || data.createdAt || "") || null,
      JSON.stringify(payload),
    );
}

export function getAnanasSyncSummary() {
  const db = getDb();
  return {
    links: db.prepare("SELECT sync_status AS status, COUNT(*) AS count FROM ananas_product_links GROUP BY sync_status").all(),
    jobs: db.prepare("SELECT status, COUNT(*) AS count FROM ananas_sync_jobs GROUP BY status").all(),
    invoices: (db.prepare("SELECT COUNT(*) AS count FROM ananas_invoices").get() as { count: number }).count,
  };
}

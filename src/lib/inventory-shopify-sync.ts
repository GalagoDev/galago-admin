import "server-only";

import { getDb } from "@/lib/db";
import { matchShopifyInventory } from "@/lib/inventory-shopify-matching";
import { getShopifyProductsForAnanas } from "@/lib/shopify-admin";
import { BEDLY_ANANAS_PRODUCTS } from "@/lib/bedly-ananas";

const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

let runningSync: Promise<InventoryShopifySyncResult> | null = null;

export type InventoryShopifySyncResult = {
  matchedProducts: number;
  catalogProducts: number;
  totalVariants: number;
  matchedVariants: number;
  unmatchedVariants: number;
  updatedAt: string;
  skipped?: boolean;
};

function shopifyConfigured() {
  const hasStore = Boolean(process.env.SHOPIFY_STORE_DOMAIN?.trim());
  const hasToken = Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN?.trim());
  const hasClientCredentials = Boolean(
    process.env.SHOPIFY_CLIENT_ID?.trim() && process.env.SHOPIFY_CLIENT_SECRET?.trim(),
  );
  return hasStore && (hasToken || hasClientCredentials);
}

function recordAttempt(attemptedAt: string) {
  getDb()
    .prepare(
      `INSERT INTO inventory_shopify_sync_state (id, last_attempt_at)
       VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`,
    )
    .run(attemptedAt);
}

function recordFailure(attemptedAt: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  getDb()
    .prepare(
      `INSERT INTO inventory_shopify_sync_state (id, last_attempt_at, last_error)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_error = excluded.last_error`,
    )
    .run(attemptedAt, message.slice(0, 1000));
}

async function runInventoryShopifySync(): Promise<InventoryShopifySyncResult> {
  if (!shopifyConfigured()) {
    throw new Error("Shopify pristup za Lager nije konfigurisan na Hostingeru.");
  }

  const db = getDb();
  const products = db
    .prepare("SELECT id, sku, name, normalized_name, unit_cost, quantity FROM inventory_products WHERE active = 1")
    .all() as Array<{
      id: number;
      sku: string | null;
      name: string;
      normalized_name: string;
      unit_cost: number;
      quantity: number;
    }>;
  if (!products.length) throw new Error("Prvo uvezite lager sa nazivima i nabavnim cijenama.");

  const aliases = db
    .prepare("SELECT normalized_alias, product_id FROM inventory_product_aliases")
    .all() as Array<{ normalized_alias: string; product_id: number }>;
  const shopifyProducts = await getShopifyProductsForAnanas();
  const matched = matchShopifyInventory(
    // Bedly inventory is owned by Admin + the Ananas consumption ledger, not Shopify.
    products.filter((product) => !BEDLY_ANANAS_PRODUCTS.some((bedly) => bedly.inventorySku === product.sku)).map((product) => ({
      id: product.id,
      sku: product.sku || "",
      name: product.name,
      normalizedName: product.normalized_name,
      unitCost: product.unit_cost,
      quantity: product.quantity,
    })),
    aliases.map((alias) => ({ normalizedAlias: alias.normalized_alias, productId: alias.product_id })),
    shopifyProducts,
  );

  const updatedAt = new Date().toISOString();
  const unmatchedVariants = matched.unmatchedLabels.length
    + matched.ambiguousLabels.length
    + matched.untrackedLabels.length;
  db.transaction(() => {
    const update = db.prepare("UPDATE inventory_products SET quantity = ?, updated_at = ? WHERE id = ? AND active = 1");
    for (const item of matched.updates) update.run(item.quantity, updatedAt, item.productId);
    db.prepare(
      `INSERT INTO inventory_shopify_sync_state (
         id, last_attempt_at, last_success_at, matched_products, catalog_products,
         total_variants, matched_variants, unmatched_variants, last_error
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         matched_products = excluded.matched_products,
         catalog_products = excluded.catalog_products,
         total_variants = excluded.total_variants,
         matched_variants = excluded.matched_variants,
         unmatched_variants = excluded.unmatched_variants,
         last_error = NULL`,
    ).run(
      updatedAt,
      updatedAt,
      matched.updates.length,
      products.length,
      matched.totalVariants,
      matched.matchedVariants,
      unmatchedVariants,
    );
  })();

  return {
    matchedProducts: matched.updates.length,
    catalogProducts: products.length,
    totalVariants: matched.totalVariants,
    matchedVariants: matched.matchedVariants,
    unmatchedVariants,
    updatedAt,
  };
}

export async function syncInventoryFromShopify() {
  if (runningSync) return runningSync;
  const attemptedAt = new Date().toISOString();
  recordAttempt(attemptedAt);
  runningSync = runInventoryShopifySync().catch((error) => {
    recordFailure(attemptedAt, error);
    throw error;
  }).finally(() => {
    runningSync = null;
  });
  return runningSync;
}

export async function refreshInventoryFromShopifyIfStale(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const state = getDb()
    .prepare("SELECT last_success_at FROM inventory_shopify_sync_state WHERE id = 1")
    .get() as { last_success_at: string | null } | undefined;
  const lastSuccess = state?.last_success_at ? new Date(state.last_success_at).getTime() : 0;
  if (lastSuccess && Date.now() - lastSuccess < maxAgeMs) {
    return {
      matchedProducts: 0,
      catalogProducts: 0,
      totalVariants: 0,
      matchedVariants: 0,
      unmatchedVariants: 0,
      updatedAt: state?.last_success_at || new Date().toISOString(),
      skipped: true,
    } satisfies InventoryShopifySyncResult;
  }
  return syncInventoryFromShopify();
}

export function isInventoryShopifySyncConfigured() {
  return shopifyConfigured();
}

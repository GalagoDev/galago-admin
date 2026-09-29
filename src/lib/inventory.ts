import "server-only";

import crypto from "node:crypto";
import path from "node:path";

import { getDb } from "@/lib/db";
import { readFirstWorksheet } from "@/lib/excel-workbook";
import { InventoryParseError, normalizeInventoryName, parseInventoryRows } from "@/lib/inventory-import";

const MAX_INVENTORY_BYTES = 15 * 1024 * 1024;

type InventoryProductRow = {
  id: number;
  sku: string | null;
  name: string;
  normalized_name: string;
  unit_cost: number;
  quantity: number;
  active: number;
  updated_at: string;
};

export type InventoryProduct = {
  id: number;
  sku: string;
  name: string;
  normalizedName: string;
  unitCost: number;
  quantity: number;
  active: boolean;
  updatedAt: string;
};

export type InventoryAlias = {
  normalizedAlias: string;
  aliasLabel: string;
  productId: number;
};

export type InventoryShopifySyncState = {
  lastAttemptAt: string;
  lastSuccessAt: string;
  matchedProducts: number;
  catalogProducts: number;
  totalVariants: number;
  matchedVariants: number;
  unmatchedVariants: number;
  lastError: string;
};

export class InventoryError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
  }
}

function mapProduct(row: InventoryProductRow): InventoryProduct {
  return {
    id: row.id,
    sku: row.sku || "",
    name: row.name,
    normalizedName: row.normalized_name,
    unitCost: row.unit_cost,
    quantity: row.quantity,
    active: row.active === 1,
    updatedAt: row.updated_at,
  };
}

export async function importInventoryFile(file: File) {
  if (!file || file.size === 0) throw new InventoryError("file-missing", "Odaberite lager dokument.");
  if (file.size > MAX_INVENTORY_BYTES) throw new InventoryError("file-size", "Lager dokument može imati najviše 15 MB.");
  const extension = path.extname(file.name).toLowerCase();
  if (![".xls", ".xlsx", ".csv"].includes(extension)) {
    throw new InventoryError("file-type", "Lager mora biti XLS, XLSX ili CSV dokument.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const db = getDb();
  const duplicate = db.prepare("SELECT id, item_count FROM inventory_imports WHERE file_hash = ?").get(fileHash) as { id: number; item_count: number } | undefined;
  if (duplicate) return { imported: false, itemCount: duplicate.item_count };

  let parsed;
  try {
    parsed = parseInventoryRows(await readFirstWorksheet(file));
  } catch (error) {
    if (error instanceof InventoryParseError) throw new InventoryError(error.code, error.message);
    throw error;
  }

  const now = new Date().toISOString();
  const importId = db.transaction(() => {
    const importResult = db
      .prepare("INSERT INTO inventory_imports (original_name, file_hash, item_count, imported_at) VALUES (?, ?, ?, ?)")
      .run(path.basename(file.name).slice(0, 220), fileHash, parsed.items.length, now);
    const id = Number(importResult.lastInsertRowid);
    db.prepare("UPDATE inventory_products SET active = 0, updated_at = ?").run(now);
    const upsert = db.prepare(
      `INSERT INTO inventory_products (
         sku, name, normalized_name, unit_cost, quantity, active, last_import_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         sku = excluded.sku,
         name = excluded.name,
         unit_cost = excluded.unit_cost,
         quantity = excluded.quantity,
         active = 1,
         last_import_id = excluded.last_import_id,
         updated_at = excluded.updated_at`,
    );
    for (const item of parsed.items) {
      upsert.run(item.sku, item.name, item.normalizedName, item.unitCost, item.quantity, id, now, now);
    }
    return id;
  })();

  return { imported: true, importId, itemCount: parsed.items.length };
}

export function getInventoryOverview() {
  const db = getDb();
  const products = db
    .prepare("SELECT * FROM inventory_products WHERE active = 1 ORDER BY name COLLATE NOCASE")
    .all() as InventoryProductRow[];
  const latestImport = db
    .prepare("SELECT id, original_name, item_count, imported_at FROM inventory_imports ORDER BY id DESC LIMIT 1")
    .get() as { id: number; original_name: string; item_count: number; imported_at: string } | undefined;
  const aliases = db
    .prepare("SELECT normalized_alias, alias_label, product_id FROM inventory_product_aliases")
    .all() as Array<{ normalized_alias: string; alias_label: string; product_id: number }>;
  const shopifySync = db
    .prepare(
      `SELECT last_attempt_at, last_success_at, matched_products, catalog_products,
              total_variants, matched_variants, unmatched_variants, last_error
       FROM inventory_shopify_sync_state WHERE id = 1`,
    )
    .get() as {
      last_attempt_at: string | null;
      last_success_at: string | null;
      matched_products: number;
      catalog_products: number;
      total_variants: number;
      matched_variants: number;
      unmatched_variants: number;
      last_error: string | null;
    } | undefined;

  return {
    products: products.map(mapProduct),
    aliases: aliases.map((row) => ({
      normalizedAlias: row.normalized_alias,
      aliasLabel: row.alias_label,
      productId: row.product_id,
    })),
    latestImport: latestImport
      ? {
          id: latestImport.id,
          originalName: latestImport.original_name,
          itemCount: latestImport.item_count,
          importedAt: latestImport.imported_at,
        }
      : null,
    shopifySync: shopifySync
      ? {
          lastAttemptAt: shopifySync.last_attempt_at || "",
          lastSuccessAt: shopifySync.last_success_at || "",
          matchedProducts: shopifySync.matched_products,
          catalogProducts: shopifySync.catalog_products,
          totalVariants: shopifySync.total_variants,
          matchedVariants: shopifySync.matched_variants,
          unmatchedVariants: shopifySync.unmatched_variants,
          lastError: shopifySync.last_error || "",
        } satisfies InventoryShopifySyncState
      : null,
  };
}

export function saveInventoryAlias(aliasLabel: string, productId: number) {
  const normalizedAlias = normalizeInventoryName(aliasLabel);
  if (!normalizedAlias) throw new InventoryError("alias-invalid", "Naziv za povezivanje nije ispravan.");
  const product = getDb().prepare("SELECT id FROM inventory_products WHERE id = ? AND active = 1").get(productId);
  if (!product) throw new InventoryError("product-not-found", "Artikal iz lagera nije pronađen.");
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO inventory_product_aliases (normalized_alias, alias_label, product_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(normalized_alias) DO UPDATE SET
         alias_label = excluded.alias_label,
         product_id = excluded.product_id,
         updated_at = excluded.updated_at`,
    )
    .run(normalizedAlias, aliasLabel.trim().slice(0, 240), productId, now, now);
}

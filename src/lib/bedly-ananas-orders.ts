import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { BEDLY_ANANAS_PRODUCTS, bedlyEan } from "@/lib/bedly-ananas";
import { getAnanasOrders, getAnanasOrderShipments, type AnanasOrder, type AnanasShipment } from "@/lib/ananas-client";

const POLL_MS = 5 * 60_000;
const LEASE_MS = 10 * 60_000;
// First production catalog submission. Never consume historical Galago orders.
const ACTIVATED_AT = "2026-10-23T00:00:00.000Z";
const cancelled = new Set(["CANCELLED", "CANCELLED_BY_JOB", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_MERCHANT", "CANCELLED_BY_EMPLOYEE", "MISSING_ITEMS", "TERMINATED"]);
const beforeDispatch = new Set(["CREATED", "PENDING", "NOT_READY", "PARTIALLY_CONFIRMED", "CONFIRMED", "PACKING_INITIATED", "PARTIALLY_PACKED", "PACKED", "READY_FOR_COLLECTION"]);
type Config = (typeof BEDLY_ANANAS_PRODUCTS)[number];
type StockPlan = { config: Config; units: number; dispatched: boolean; statuses: string[] };
type Ledger = { inventory_product_id: number; applied_units: number; dispatched: number };
type SyncState = { activated_at: string; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null };

function merchantSku(config: Config) {
  return `BEDLY-${config.inventorySku}${config.unitsPerPack > 1 ? `-SET${config.unitsPerPack}` : ""}`;
}

function match(item: { productEan: string; productSku: string }) {
  const config = BEDLY_ANANAS_PRODUCTS.find((p) => item.productEan === bedlyEan(p.variantId) || item.productSku === merchantSku(p));
  if (config && (item.productEan !== bedlyEan(config.variantId) || item.productSku !== merchantSku(config))) {
    throw new Error("Bedly order SKU/EAN mismatch; inventory unchanged for this order");
  }
  return config;
}

function quantity(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Ananas order quantity");
  return value;
}

export function planBedlyOrder(order: AnanasOrder, shipments: AnanasShipment[]): StockPlan[] {
  const ordered = new Map<string, number>();
  for (const item of order.items) {
    const config = match(item);
    if (config) ordered.set(config.inventorySku, (ordered.get(config.inventorySku) || 0) + quantity(item.quantity));
  }
  const plans = new Map<string, StockPlan & { ordered: number }>();
  const ids = new Set<string>();
  for (const shipment of shipments) {
    if (shipment.orderId !== order.id) continue; // search is not an exact filter
    if (!shipment.suborderId || ids.has(shipment.suborderId)) throw new Error("Duplicate or missing Ananas shipment ID");
    ids.add(shipment.suborderId);
    if (!shipment.status) throw new Error("Missing Ananas shipment status");
    for (const item of shipment.items) {
      const config = match(item);
      if (!config) continue;
      const orderedUnits = quantity(item.orderedQuantity);
      const isCancelled = cancelled.has(shipment.status);
      // Only confirmed sales consume Admin stock; unconfirmed requests do not.
      // Do not infer a zero from a missing quantity in a partial API snapshot.
      if (item.confirmedQuantity == null && !isCancelled) return [];
      const confirmed = isCancelled ? 0 : quantity(item.confirmedQuantity);
      if (confirmed > orderedUnits) throw new Error("Ananas confirmed quantity exceeds ordered quantity");
      const plan = plans.get(config.inventorySku) || { config, units: 0, ordered: 0, dispatched: false, statuses: [] };
      plan.units += confirmed * config.unitsPerPack;
      plan.ordered += orderedUnits;
      // Unknown, shipped, return, damaged and lost statuses never auto-restock.
      plan.dispatched ||= !isCancelled && !beforeDispatch.has(shipment.status);
      plan.statuses.push(shipment.status);
      plans.set(config.inventorySku, plan);
    }
  }
  for (const [sku, plan] of plans) {
    if (plan.ordered !== ordered.get(sku)) throw new Error("Incomplete or conflicting Ananas shipment quantities");
  }
  if ([...ordered.keys()].some((sku) => !plans.has(sku))) return [];
  return [...plans.values()];
}

function assertLease(owner: string) {
  const state = getDb().prepare("SELECT lease_owner, lease_until FROM bedly_ananas_order_state WHERE id = 1")
    .get() as { lease_owner: string; lease_until: number };
  if (state?.lease_owner !== owner || state.lease_until <= Date.now()) throw new Error("Bedly order sync lease expired; retry required");
}

// Ledger and stock move in the same SQLite transaction, including after restarts.
export function applyBedlyOrder(orderId: string, plans: StockPlan[], owner: string) {
  const db = getDb();
  return db.transaction(() => {
    assertLease(owner);
    let movements = 0;
    for (const plan of plans) {
      const config = plan.config;
      const rows = db.prepare("SELECT id, name, quantity FROM inventory_products WHERE sku = ?").all(config.inventorySku) as Array<{ id: number; name: string; quantity: number }>;
      if (rows.length !== 1 || rows[0].name !== config.inventoryName || !Number.isFinite(rows[0].quantity)) throw new Error(`Bedly inventory mapping changed: ${config.inventorySku}`);
      const row = rows[0];
      const previous = db.prepare("SELECT * FROM bedly_ananas_order_stock WHERE order_id = ? AND inventory_sku = ?").get(orderId, config.inventorySku) as Ledger | undefined;
      if (previous && previous.inventory_product_id !== row.id) throw new Error("Bedly inventory row replaced; manual review required");
      const dispatched = Boolean(previous?.dispatched || plan.dispatched);
      const desired = dispatched ? Math.max(previous?.applied_units || 0, plan.units) : plan.units;
      const delta = desired - (previous?.applied_units || 0);
      const now = new Date().toISOString();
      if (delta !== 0) {
        // Preserve an honest negative balance if oversold, rather than losing the debt.
        // The catalog mapper publishes zero for any negative available balance.
        db.prepare("UPDATE inventory_products SET quantity = quantity - ?, updated_at = ? WHERE id = ?").run(delta, now, row.id);
        db.prepare("INSERT INTO bedly_ananas_stock_movements (order_id, inventory_sku, deducted_units, quantity_after, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(orderId, config.inventorySku, delta, row.quantity - delta, now);
        movements++;
      }
      db.prepare(`INSERT INTO bedly_ananas_order_stock (order_id, inventory_sku, inventory_product_id, applied_units, dispatched, statuses, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(order_id, inventory_sku) DO UPDATE SET
        applied_units = excluded.applied_units, dispatched = excluded.dispatched, statuses = excluded.statuses, updated_at = excluded.updated_at`)
        .run(orderId, config.inventorySku, row.id, desired, Number(dispatched), JSON.stringify([...new Set(plan.statuses)]), now);
    }
    return movements;
  }).immediate();
}

export function getBedlyOrderSyncStatus() {
  const db = getDb();
  const state = (db.prepare("SELECT activated_at, last_attempt_at, last_success_at, last_error FROM bedly_ananas_order_state WHERE id = 1").get() as SyncState | undefined) || null;
  return {
    enabled: process.env.ANANAS_BEDLY_ENABLED?.trim().toLowerCase() !== "false" && process.env.ANANAS_BEDLY_ORDER_SYNC_ENABLED?.trim().toLowerCase() !== "false",
    pollMinutes: 5,
    deductAt: "confirmed",
    state,
    stale: !state?.last_success_at || Date.now() - Date.parse(state.last_success_at) > 15 * 60_000,
    totals: db.prepare("SELECT COUNT(*) AS orderProducts, COALESCE(SUM(applied_units), 0) AS deductedPhysicalUnits FROM bedly_ananas_order_stock").get(),
    negativeStock: db.prepare("SELECT sku, quantity FROM inventory_products WHERE sku IN ('16', '17') AND quantity < 0").all(),
  };
}

export async function syncBedlyAnanasOrders(force = false) {
  if (process.env.ANANAS_BEDLY_ENABLED?.trim().toLowerCase() === "false" || process.env.ANANAS_BEDLY_ORDER_SYNC_ENABLED?.trim().toLowerCase() === "false") return { skipped: "disabled" };
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO bedly_ananas_order_state (id, activated_at) VALUES (1, ?)").run(ACTIVATED_AT);
  const owner = randomUUID();
  const acquired = db.transaction(() => {
    const state = db.prepare("SELECT * FROM bedly_ananas_order_state WHERE id = 1").get() as { last_success_at: string | null; lease_until: number };
    if (state.lease_until > Date.now()) throw new Error("Bedly order sync already running");
    if (!force && state.last_success_at && Date.now() - Date.parse(state.last_success_at) < POLL_MS) return false;
    db.prepare("UPDATE bedly_ananas_order_state SET lease_owner = ?, lease_until = ?, last_attempt_at = ? WHERE id = 1")
      .run(owner, Date.now() + LEASE_MS, new Date().toISOString());
    return true;
  }).immediate();
  if (!acquired) return { skipped: "recent-success" };
  try {
    const until = new Date().toISOString();
    // Re-read the activation window, not just new orders: cancellations can arrive later.
    const orders = await getAnanasOrders(ACTIVATED_AT, until);
    let matchedOrders = 0;
    let movements = 0;
    const seen = new Set<string>();
    const failures: string[] = [];
    for (const order of orders) {
      if (!order.id || seen.has(order.id)) continue;
      seen.add(order.id);
      if (!Number.isFinite(Date.parse(order.createdDate)) || Date.parse(order.createdDate) < Date.parse(ACTIVATED_AT)) continue;
      try {
        if (!order.items.some((item) => match(item))) continue;
        matchedOrders++;
        assertLease(owner);
        db.prepare("UPDATE bedly_ananas_order_state SET lease_until = ? WHERE id = 1 AND lease_owner = ?").run(Date.now() + LEASE_MS, owner);
        const shipments = await getAnanasOrderShipments(order.id);
        movements += applyBedlyOrder(order.id, planBedlyOrder(order, shipments), owner);
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error) {
        failures.push(`${order.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) throw new Error(failures.join("; ").slice(0, 2000));
    assertLease(owner);
    db.prepare("UPDATE bedly_ananas_order_state SET last_success_at = ?, last_error = NULL WHERE id = 1 AND lease_owner = ?").run(new Date().toISOString(), owner);
    return { scannedOrders: orders.length, matchedOrders, movements };
  } catch (error) {
    db.prepare("UPDATE bedly_ananas_order_state SET last_error = ? WHERE id = 1 AND lease_owner = ?").run(error instanceof Error ? error.message : String(error), owner);
    throw error;
  } finally {
    db.prepare("UPDATE bedly_ananas_order_state SET lease_owner = NULL, lease_until = 0 WHERE id = 1 AND lease_owner = ?").run(owner);
  }
}

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { getDb } from "@/lib/db";
import { fetchCourierTracking } from "@/lib/courier-tracking-client";
import { courierOrderKey } from "@/lib/courier-status";
import { courierTrackingSnapshot, linkCourierOrder, recordCourierParcel } from "@/lib/courier-tracking-store";
import { markCourierOrdersDelivered, moveOrdersToReturns, readReturnImportOrders } from "@/lib/google-order-status";
import { matchExpressOneReturn, nextExpressOneScan, type ExpressOneEvent } from "@/lib/expressone-parser";

export function nextCourierTrackingScan(now: number) { return nextExpressOneScan(now - 15 * 60_000) + 15 * 60_000; }

function discoverEmailTracking(orders: Awaited<ReturnType<typeof readReturnImportOrders>>) {
  const db = getDb();
  const grouped = new Map<string, { order: (typeof orders)[number]; ids: Set<string> }>();
  const events = db.prepare("SELECT event_json,first_status_at FROM expressone_shipments").all() as { event_json: string; first_status_at: string }[];
  for (const row of events) {
    const event = JSON.parse(row.event_json) as ExpressOneEvent;
    const match = matchExpressOneReturn(event, row.first_status_at, orders);
    if (!match.order || match.order.appStatus || match.order.deliveredChecked) continue;
    const key = courierOrderKey(match.order);
    const link = db.prepare("SELECT provenance,suppressed,applied_status_id FROM courier_order_links WHERE order_key=?").get(key) as
      { provenance: string; suppressed: number; applied_status_id: string | null } | undefined;
    if (link && (link.provenance !== "email" || link.suppressed || link.applied_status_id)) continue;
    const entry = grouped.get(key) || { order: match.order, ids: new Set<string>() };
    entry.ids.add(event.tracking.slice(-8)); grouped.set(key, entry);
  }
  for (const entry of grouped.values()) {
    try { linkCourierOrder(entry.order, [...entry.ids], "email", true); } catch { /* Ambiguous or excess parcels stay for review. */ }
  }
}

export async function runCourierTrackingSync() {
  const db = getDb(), started = Date.now(), token = randomUUID();
  db.prepare("INSERT OR IGNORE INTO courier_tracking_sync (id) VALUES (1)").run();
  if (!db.prepare(`UPDATE courier_tracking_sync SET lease_until=?,lease_token=? WHERE id=1 AND next_run_at<=? AND lease_until<?`)
    .run(started + 90_000, token, started, started).changes) return;
  const heartbeat = setInterval(() => db.prepare("UPDATE courier_tracking_sync SET lease_until=? WHERE id=1 AND lease_token=?")
    .run(Date.now() + 90_000, token), 20_000);
  heartbeat.unref();
  const ownsLease = () => Boolean(db.prepare("SELECT 1 FROM courier_tracking_sync WHERE id=1 AND lease_token=? AND lease_until>?").get(token, Date.now()));
  let checked = 0, failures = 0;
  try {
    let orders = await readReturnImportOrders();
    discoverEmailTracking(orders);
    const snapshot = courierTrackingSnapshot(orders);
    const activeKeys = new Set(orders.filter(o => !o.appStatus && !o.deliveredChecked).map(courierOrderKey));
    const ids = new Set<string>();
    for (const key of activeKeys) {
      const link = snapshot.links.get(key);
      if (!link || link.suppressed || link.applied_status_id) continue;
      for (const id of snapshot.byOrder.get(key) || []) if ((snapshot.parcels.get(id)?.next_check_at || 0) <= Date.now()) ids.add(id);
    }
    for (const id of ids) {
      if (!ownsLease() || Date.now() - started > 15 * 60_000) throw new Error("Courier scan interrupted");
      await sleep(500);
      try {
        const data = await fetchCourierTracking(id);
        recordCourierParcel(data, nextCourierTrackingScan(Date.now())); checked++;
      } catch {
        failures++;
        db.prepare("UPDATE courier_parcels SET last_error=?,next_check_at=? WHERE tracking=?")
          .run("Express One status nije potvrden. Novi pokusaj za sat vremena.", Date.now() + 60 * 60_000, id);
        if (failures >= 5 && checked === 0) throw new Error("Courier service unavailable");
      }
    }
    if (!ownsLease()) throw new Error("Courier scan interrupted");
    // Fresh source identities are revalidated again by the queued Sheets transitions.
    orders = await readReturnImportOrders();
    const { states } = courierTrackingSnapshot(orders);
    const active = orders.filter(o => !o.appStatus && !o.deliveredChecked);
    const delivered = active.filter(o => states[o.sheetRowNumber]?.category === "delivered");
    const returned = active.filter(o => states[o.sheetRowNumber]?.category === "returned");
    if (delivered.length) await markCourierOrdersDelivered(delivered);
    if (returned.length) await moveOrdersToReturns(returned);
    if (delivered.length || returned.length) {
      const verified = await readReturnImportOrders();
      const byKey = new Map(verified.map(o => [courierOrderKey(o), o]));
      for (const order of [...delivered, ...returned]) {
        const key = courierOrderKey(order), fresh = byKey.get(key);
        const expected = states[order.sheetRowNumber].category === "returned" ? "returned:" : "delivered:";
        if (!fresh?.appStatus.startsWith(expected)) throw new Error("Courier archive not confirmed");
        db.prepare("UPDATE courier_order_links SET applied_status_id=? WHERE order_key=?").run(fresh.appStatus, key);
      }
    }
    db.prepare(`UPDATE courier_tracking_sync SET next_run_at=CASE WHEN requested_at>? THEN 0 ELSE ? END,
      last_success_at=?,last_error=?,checked_count=?,lease_until=0,lease_token='' WHERE id=1 AND lease_token=?`)
      .run(started, failures ? Date.now() + 60 * 60_000 : nextCourierTrackingScan(Date.now()), Date.now(),
        failures ? `${failures} paketa nije osvježeno. Narudžbe ostaju u ukupnom pregledu.` : null, checked, token);
  } catch {
    db.prepare(`UPDATE courier_tracking_sync SET next_run_at=?,last_error=?,checked_count=?,lease_until=0,lease_token=''
      WHERE id=1 AND lease_token=?`).run(Date.now() + 60 * 60_000,
        "Provjera kurirskih statusa nije zavrsena. Automatski novi pokusaj za sat vremena.", checked, token);
  } finally { clearInterval(heartbeat); }
}

declare global { var galagoCourierTimer: ReturnType<typeof setInterval> | undefined; var galagoCourierRun: Promise<void> | undefined; }
export function kickCourierTrackingSync() {
  if (!globalThis.galagoCourierRun) globalThis.galagoCourierRun = runCourierTrackingSync()
    .catch(() => console.error("Courier tracking worker failed")).finally(() => { globalThis.galagoCourierRun = undefined; });
  return globalThis.galagoCourierRun;
}
export function startCourierTrackingScheduler() {
  if (globalThis.galagoCourierTimer) return;
  void kickCourierTrackingSync();
  globalThis.galagoCourierTimer = setInterval(() => void kickCourierTrackingSync(), 30_000);
  globalThis.galagoCourierTimer.unref();
}

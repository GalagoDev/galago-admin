import { getDb } from "@/lib/db";
import type { SheetOrderRow } from "@/lib/google-sheets";
import { aggregateCourierParcels, classifyCourierParcel, COURIER_MAX_AGE, courierOrderKey, courierPackageCount,
  normalizeCourierTracking, type CourierOrderState, type CourierParcelData } from "@/lib/courier-status";

type Link = { order_key: string; expected_packages: number; provenance: string; linked_at: number; suppressed: number; applied_status_id: string | null };
type Parcel = { tracking: string; data_json: string | null; checked_at: number; next_check_at: number; last_error: string | null };

export function linkCourierOrder(order: SheetOrderRow, tracking: string[], provenance: string, allowIncomplete = false) {
  const db = getDb(), key = courierOrderKey(order), expected = courierPackageCount(order);
  if (!tracking.length || tracking.some(id => normalizeCourierTracking(id) !== id) || new Set(tracking).size !== tracking.length || tracking.length > expected || (!allowIncomplete && tracking.length !== expected)) throw new Error("parcel-count");
  db.transaction(() => {
    for (const id of tracking) {
      const collision = db.prepare("SELECT order_key FROM courier_order_parcels WHERE tracking = ? AND order_key != ?").get(id, key);
      if (collision) throw new Error("tracking-already-linked");
    }
    db.prepare(`INSERT INTO courier_order_links (order_key, expected_packages, provenance, linked_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(order_key) DO UPDATE SET expected_packages=excluded.expected_packages, provenance=excluded.provenance,
      linked_at=excluded.linked_at, suppressed=0, applied_status_id=NULL`).run(key, expected, provenance, Date.now());
    db.prepare("DELETE FROM courier_order_parcels WHERE order_key = ?").run(key);
    for (const id of tracking) {
      db.prepare("INSERT OR IGNORE INTO courier_parcels (tracking) VALUES (?)").run(id);
      db.prepare("INSERT INTO courier_order_parcels (order_key,tracking) VALUES (?,?)").run(key, id);
      if (provenance === "manual") db.prepare("UPDATE courier_parcels SET next_check_at=0 WHERE tracking=?").run(id);
    }
  })();
}

export function courierTrackingSnapshot(orders: SheetOrderRow[], now = Date.now()) {
  const db = getDb();
  const links = new Map((db.prepare("SELECT * FROM courier_order_links").all() as Link[]).map(l => [l.order_key, l]));
  const parcels = new Map((db.prepare("SELECT * FROM courier_parcels").all() as Parcel[]).map(p => [p.tracking, p]));
  const assignments = db.prepare("SELECT order_key,tracking FROM courier_order_parcels ORDER BY tracking").all() as { order_key: string; tracking: string }[];
  const byOrder = new Map<string, string[]>();
  for (const a of assignments) byOrder.set(a.order_key, [...(byOrder.get(a.order_key) || []), a.tracking]);
  const counts = new Map<string, number>();
  for (const order of orders) { const key = courierOrderKey(order); counts.set(key, (counts.get(key) || 0) + 1); }
  const states: Record<number, CourierOrderState> = {};
  for (const order of orders) {
    const key = courierOrderKey(order), link = links.get(key);
    const state: CourierOrderState = { key, category: "review", reason: "Nema povezanog broja posiljke.", checkedAt: 0,
      expectedPackages: courierPackageCount(order), parcels: [] };
    if (link) {
      const archived = Boolean(link.applied_status_id && link.applied_status_id === order.appStatus);
      state.parcels = (byOrder.get(key) || []).map(id => {
        const parcel = parcels.get(id);
        let data: CourierParcelData | null = null;
        try { data = parcel?.data_json ? JSON.parse(parcel.data_json) as CourierParcelData : null; } catch { /* Invalid stored data stays unconfirmed. */ }
        const valid = parcel && data && !parcel.last_error && (archived || now - parcel.checked_at <= COURIER_MAX_AGE);
        return { tracking: id, category: valid && data ? classifyCourierParcel(data) : "review", checkedAt: parcel?.checked_at || 0,
          lastStatus: data?.traces[0]?.status || "Status nije potvrden" };
      });
      state.checkedAt = Math.min(...state.parcels.map(p => p.checkedAt), now);
      state.category = aggregateCourierParcels(state.parcels, state.expectedPackages);
      state.reason = state.category === "review" ? "Nedostaje broj paketa ili svjeza potvrda kurira." : "";
      if (link.suppressed || (link.applied_status_id && !order.appStatus)) {
        state.category = "review"; state.reason = "Ponovo aktivirana narudzba; potreban je novi broj posiljke.";
      }
    }
    if ((counts.get(key) || 0) > 1) { state.category = "review"; state.reason = "Identicne kopije narudzbe; provjerite koji paket pripada kojem redu."; }
    states[order.sheetRowNumber] = state;
  }
  return { states, links, parcels, byOrder };
}

export function recordCourierParcel(data: CourierParcelData, nextCheckAt: number, now = Date.now()) {
  getDb().prepare(`INSERT INTO courier_parcels (tracking,data_json,checked_at,next_check_at) VALUES (?,?,?,?)
    ON CONFLICT(tracking) DO UPDATE SET data_json=excluded.data_json, checked_at=excluded.checked_at,
    next_check_at=excluded.next_check_at,last_error=NULL`).run(data.tracking, JSON.stringify(data), now, nextCheckAt);
}
export function requestCourierTrackingSync(force = false) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO courier_tracking_sync (id) VALUES (1)").run();
  db.prepare("UPDATE courier_tracking_sync SET next_run_at=0,requested_at=? WHERE id=1").run(Date.now());
  if (force) db.prepare("UPDATE courier_parcels SET next_check_at=0").run();
}
export function getCourierSyncStatus() {
  const status = getDb().prepare("SELECT next_run_at,last_success_at,last_error,checked_count,lease_until FROM courier_tracking_sync WHERE id=1").get() as
    { next_run_at: number; last_success_at: number | null; last_error: string | null; checked_count: number; lease_until: number } | undefined;
  return status ? { ...status, running: status.lease_until > Date.now() } : undefined;
}
export function suppressCourierOrder(order: SheetOrderRow) {
  getDb().prepare("UPDATE courier_order_links SET suppressed=1 WHERE order_key=?").run(courierOrderKey(order));
}

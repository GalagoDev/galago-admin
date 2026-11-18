import { getDb } from "./db";
import { courierOrderKey, courierPackageCount } from "./courier-status";
import type { SheetOrderRow } from "./google-sheets";
import type { RiskOutcome } from "./order-risk";

type MailStatus = { tracking: string; status: string };
type Evidence = { settled: boolean; appliedReturn: boolean; trackedFinal?: boolean; mail: MailStatus[]; refusedInTracking: boolean };
const email = "Express One · email";
const noMail = "Evidencija narudžbi · bez potvrde emailom";

export function historicalDeliveryOutcome(order: SheetOrderRow, evidence: Evidence): RiskOutcome {
  const result = (label: string, source: string, tone: RiskOutcome["tone"]): RiskOutcome => ({ label, source, tone });
  const returned = order.appStatus.startsWith("returned:");
  const delivered = !returned && (order.appStatus.startsWith("delivered:") || order.deliveredChecked);
  if (order.appStatus.startsWith("duplicate:")) return result("Nije poslano", "Evidencija narudžbi", "neutral");

  const count = courierPackageCount(order);
  const events = [...new Map(evidence.mail.map(m => [m.tracking, m])).values()];
  const refused = events.filter(m => m.status === "odbijeno").length;
  const returns = events.filter(m => m.status === "povrat posiljaocu").length;
  const received = events.filter(m => ["potvrda dostave", "otkup placen gotovinom"].includes(m.status)).length;
  const fullReturn = evidence.appliedReturn || returns === count && events.length === count;
  const fullDelivery = evidence.settled || received === count && events.length === count;
  if ((fullDelivery && (returned || returns > 0 || fullReturn)) || (delivered && fullReturn)) {
    return result("Neslaganje podataka o dostavi", "Express One i evidencija narudžbi", "neutral");
  }
  if (fullDelivery) return result("Preuzeto", evidence.settled ? "Express One · email razduženja" : email, "good");
  if (fullReturn || returned) {
    if (refused || evidence.refusedInTracking) return result(count === 1 ? "Povrat · odbijeno" : "Povrat · zabilježeno odbijanje paketa",
      refused ? email : "Express One · praćenje pošiljke", "bad");
    return result("Vraćeno pošiljaocu", fullReturn ? email : evidence.trackedFinal ? "Express One · praćenje pošiljke" : noMail, "bad");
  }
  if (delivered) return evidence.trackedFinal ? result("Preuzeto", "Express One · praćenje pošiljke", "good") : result("Označeno kao dostavljeno", noMail, "good");
  if (refused || returns || received) {
    if (refused === count && events.length === count) return result("Odbijeno", email, "bad");
    return result(`Status po paketima: ${[refused && `odbijeno ${refused}`, returns && `vraćeno ${returns}`, received && `preuzeto ${received}`].filter(Boolean).join(", ")} od ${count}`, email, "neutral");
  }
  if (evidence.refusedInTracking) return result("Zabilježeno odbijanje paketa", "Express One · praćenje pošiljke", "bad");
  return result("Preuzimanje nije potvrđeno", "Nema konačne potvrde emailom", "neutral");
}

// The review screen reads saved evidence only. A contact match finds the history,
// but never assigns a carrier event to a different order from the same customer.
export function orderHistoryReader(orders: SheetOrderRow[]) {
  function load() {
    const db = getDb();
    const settled = new Set((db.prepare("SELECT DISTINCT order_key FROM expressone_settlement_rows WHERE resolution='applied' AND order_key IS NOT NULL").all() as { order_key: string }[]).map(r => r.order_key));
    const returned = new Set((db.prepare(`SELECT DISTINCT order_status_id FROM expressone_shipments WHERE resolution='applied'
      AND json_extract(event_json,'$.status')='povrat posiljaocu' AND order_status_id IS NOT NULL`).all() as { order_status_id: string }[]).map(r => 'returned:' + r.order_status_id));
    const parcels = db.prepare(`SELECT p.tracking, l.applied_status_id, json_extract(e.event_json,'$.status') AS status,
      EXISTS(SELECT 1 FROM json_each(c.data_json,'$.traces') t WHERE lower(trim(json_extract(t.value,'$.status')))='odbijeno') AS refused
      FROM courier_order_links l JOIN courier_order_parcels p USING(order_key)
      JOIN courier_parcels c ON c.tracking=p.tracking
      LEFT JOIN expressone_shipments e ON e.tracking='001-' || p.tracking
      WHERE l.order_key=? AND l.suppressed=0 AND (l.applied_status_id IS NULL OR l.applied_status_id=?)`);
    const keys = new Map<string, number>(), statuses = new Map<string, number>();
    for (const order of orders) {
      const k = courierOrderKey(order); keys.set(k, (keys.get(k) || 0) + 1);
      if (order.appStatus) statuses.set(order.appStatus, (statuses.get(order.appStatus) || 0) + 1);
    }
    return { settled, returned, parcels, keys, statuses };
  }
  let data: ReturnType<typeof load> | undefined;
  const memo = new Map<number, RiskOutcome>();
  return (order: SheetOrderRow) => {
    const cached = memo.get(order.sheetRowNumber);
    if (cached) return cached;
    const index = data ??= load(), key = courierOrderKey(order), unique = index.keys.get(key) === 1;
    const rows = unique ? index.parcels.all(key, order.appStatus) as (MailStatus & { refused: number; applied_status_id: string | null })[] : [];
    const status = historicalDeliveryOutcome(order, {
      settled: unique && index.settled.has(key),
      appliedReturn: index.statuses.get(order.appStatus) === 1 && index.returned.has(order.appStatus),
      trackedFinal: Boolean(order.appStatus && rows.some(r => r.applied_status_id === order.appStatus)),
      mail: rows.filter(r => r.status), refusedInTracking: rows.some(r => r.refused === 1),
    });
    memo.set(order.sheetRowNumber, status);
    return status;
  };
}

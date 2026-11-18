import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { getDb } from "@/lib/db";
import { claimGmailReader } from "@/lib/claim-gmail";
import { moveOrdersToReturns, readReturnImportOrders } from "@/lib/google-order-status";
import { EXPRESSONE_SENDER, matchExpressOneReturn, nextExpressOneScan, parseExpressOneMessage, type ExpressOneEvent } from "@/lib/expressone-parser";
import { courierOrderKey, courierPackageCount } from "@/lib/courier-status";
import { courierTrackingSnapshot } from "@/lib/courier-tracking-store";
import type { CarrierReturnContact } from "@/lib/order-risk";

type Shipment = { tracking: string; event_json: string; first_status_at: string; resolution: string; order_status_id: string | null; last_error: string | null };
type Scan = { next_run_at: number; last_success_at: number | null; last_error: string | null; last_added: number; last_messages: number };
const LEASE = 90_000;
const requestOptions = { timeout: 20_000, retry: false };

export function recordExpressOneEvent(event: ExpressOneEvent) {
  const db = getDb();
  const previous = db.prepare("SELECT * FROM expressone_shipments WHERE tracking = ?").get(event.tracking) as Shipment | undefined;
  if (!previous) {
    db.prepare("INSERT INTO expressone_shipments (tracking, event_json, first_status_at) VALUES (?, ?, ?)")
      .run(event.tracking, JSON.stringify(event), event.statusAt);
    return;
  }
  const old = JSON.parse(previous.event_json) as ExpressOneEvent;
  const newer = event.statusAt > old.statusAt || (event.statusAt === old.statusAt && event.receivedAt > old.receivedAt);
  db.prepare("UPDATE expressone_shipments SET first_status_at = ?, event_json = ? WHERE tracking = ?")
    .run([previous.first_status_at, event.statusAt].sort()[0], newer ? JSON.stringify(event) : previous.event_json, event.tracking);
}

export async function runExpressOneScan(now = Date.now()) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO expressone_scan (id) VALUES (1)").run();
  const token = randomUUID();
  const claimed = db.prepare(`UPDATE expressone_scan SET lease_until = ?, lease_token = ?
    WHERE id = 1 AND next_run_at <= ? AND lease_until < ?`).run(now + LEASE, token, now, now);
  if (!claimed.changes) return;
  const heartbeat = setInterval(() => db.prepare("UPDATE expressone_scan SET lease_until = ? WHERE id = 1 AND lease_token = ?")
    .run(Date.now() + LEASE, token), 20_000);
  heartbeat.unref();
  const ownsLease = () => Boolean(db.prepare("SELECT 1 FROM expressone_scan WHERE id = 1 AND lease_token = ? AND lease_until > ?").get(token, Date.now()));
  let added = 0, read = 0;
  try {
    const gmail = claimGmailReader();
    if (!gmail) throw new Error("gmail-not-connected");
    const previousScan = db.prepare("SELECT last_success_at FROM expressone_scan WHERE id = 1").get() as { last_success_at: number | null };
    const after = previousScan.last_success_at ? ` after:${Math.floor((previousScan.last_success_at - 7 * 86400_000) / 1000)}` : "";
    const deadline = Date.now() + 20 * 60_000;
    async function request<T>(call: () => Promise<T>): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        if (!ownsLease() || Date.now() > deadline) throw new Error("scan-interrupted");
        await sleep(1200);
        try { return await call(); }
        catch (error) {
          const e = error as { code?: number; response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
          const status = e.response?.status || e.code;
          const quota = status === 429 || e.response?.data?.error?.errors?.some(x => x.reason === "rateLimitExceeded" || x.reason === "userRateLimitExceeded");
          if (attempt >= 3 || (!quota && !(typeof status === "number" && status >= 500))) throw error;
          await sleep(20_000 * (attempt + 1));
        }
      }
    }
    const ids = new Set<string>();
    let pageToken: string | undefined;
    // Sender-only search includes archived mail. Only previously unseen IDs are downloaded.
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("mailbox-page-limit");
      const response = await request(() => gmail.users.messages.list({ userId: "me", q: `in:anywhere from:${EXPRESSONE_SENDER}${after}`,
        includeSpamTrash: true, maxResults: 100, pageToken }, requestOptions));
      for (const item of response.data.messages || []) if (item.id) ids.add(item.id);
      pageToken = response.data.nextPageToken || undefined;
      if (!pageToken) break;
    }
    const seen = db.prepare("SELECT 1 FROM expressone_messages WHERE gmail_id = ?");
    for (const id of ids) {
      if (seen.get(id)) continue;
      const { data } = await request(() => gmail.users.messages.get({ userId: "me", id, format: "full" }, requestOptions));
      const event = parseExpressOneMessage(data);
      // Unrecognised automated status mail must not be silently discarded.
      const subject = data.payload?.headers?.find(h => h.name?.toLowerCase() === "subject")?.value || "";
      if (!event && /^Status po[sš]iljke\b/i.test(subject)) throw new Error("unrecognised-carrier-format");
      db.transaction(() => {
        if (event) recordExpressOneEvent(event);
        db.prepare("INSERT OR IGNORE INTO expressone_messages (gmail_id, received_at, tracking) VALUES (?, ?, ?)")
          .run(id, Number(data.internalDate) || now, event?.tracking || "");
      })();
      read++;
    }
    const shipments = db.prepare("SELECT * FROM expressone_shipments WHERE resolution != 'applied'").all() as Shipment[];
    const returns = shipments.filter(s => (JSON.parse(s.event_json) as ExpressOneEvent).status === "povrat posiljaocu");
    if (returns.length) {
      const orders = await readReturnImportOrders();
      const courier = courierTrackingSnapshot(orders);
      const pending: Array<{ shipment: Shipment; order: (typeof orders)[number] }> = [];
      for (const shipment of returns) {
        const event = JSON.parse(shipment.event_json) as ExpressOneEvent;
        const match = matchExpressOneReturn(event, shipment.first_status_at, orders);
        if (!match.order) {
          db.prepare("UPDATE expressone_shipments SET resolution = 'review', last_error = ? WHERE tracking = ?").run(match.reason, shipment.tracking);
        } else if (match.alreadyReturned) {
          db.prepare("UPDATE expressone_shipments SET resolution = 'applied', order_status_id = ?, last_error = NULL WHERE tracking = ?")
            .run(match.order.appStatus.slice("returned:".length), shipment.tracking);
        } else {
          const link = courier.links.get(courierOrderKey(match.order));
          const state = courier.states[match.order.sheetRowNumber];
          // An email describes one parcel; a whole multi-parcel order needs all parcel statuses.
          if ((link && state.category !== "returned") || (!link && courierPackageCount(match.order) > 1)) {
            db.prepare("UPDATE expressone_shipments SET resolution = 'review', last_error = ? WHERE tracking = ?")
              .run("Potrebna je potvrda svih paketa narudzbe u Express One pregledu.", shipment.tracking);
          } else pending.push({ shipment, order: match.order });
        }
      }
      if (pending.length) {
        if (!ownsLease()) throw new Error("scan-interrupted");
        const references = Array.from(new Map(pending.map(p => [p.order.sheetRowNumber, p.order])).values());
        const result = await moveOrdersToReturns(references);
        added = result.moved;
        const verified = await readReturnImportOrders();
        for (const { shipment, order } of pending) {
          const current = verified.find(o => o.sheetRowNumber === order.sheetRowNumber && o.fingerprint === order.fingerprint && o.dateLabel === order.dateLabel);
          if (!current?.appStatus.startsWith("returned:")) throw new Error("return-write-not-confirmed");
          db.prepare("UPDATE expressone_shipments SET resolution = 'applied', order_status_id = ?, last_error = NULL WHERE tracking = ?")
            .run(current.appStatus.slice("returned:".length), shipment.tracking);
        }
      }
    }
    db.prepare(`UPDATE expressone_scan SET last_success_at = ?, next_run_at = ?, lease_until = 0, lease_token = '',
      last_error = NULL, last_added = ?, last_messages = ? WHERE id = 1 AND lease_token = ?`)
      .run(Date.now(), nextExpressOneScan(Date.now()), added, read, token);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    const details: Record<string, string> = {
      "gmail-not-connected": "Gmail citanje nije povezano. Provjerite Gmail povezivanje.",
      "unrecognised-carrier-format": "Format kurirskog emaila nije prepoznat. Potrebna je provjera uvoza.",
      "return-write-not-confirmed": "Promjena u Sheets nije potvrdjena; narudzba ce biti ponovo provjerena.",
    };
    // Persist a safe error, never provider responses containing mailbox data or credentials.
    db.prepare(`UPDATE expressone_scan SET next_run_at = ?, lease_until = 0, lease_token = '', last_error = ?
      WHERE id = 1 AND lease_token = ?`).run(Date.now() + 60 * 60_000,
        `${details[reason] || "Provjera nije zavrsena."} Automatski novi pokusaj za sat vremena.`, token);
  } finally { clearInterval(heartbeat); }
}

export function getExpressOneScanStatus() {
  const db = getDb();
  const scan = db.prepare("SELECT * FROM expressone_scan WHERE id = 1").get() as Scan | undefined;
  const review = (db.prepare("SELECT * FROM expressone_shipments WHERE resolution = 'review'").all() as Shipment[])
    .filter(s => (JSON.parse(s.event_json) as ExpressOneEvent).status === "povrat posiljaocu")
    .map(s => ({ ...JSON.parse(s.event_json) as ExpressOneEvent, reason: s.last_error }));
  return { scan, review };
}

export function getExpressOneReturnRiskContacts(includeDetails = false): CarrierReturnContact[] {
  // A verified return email can warn about a customer even before an exact order match is safe.
  // Applied returns are already covered by Orders/Povrati; keep parcel counts separate from order counts.
  const rows = getDb().prepare(`SELECT tracking, json_extract(event_json, '$.recipient') AS primalac,
    json_extract(event_json, '$.phone') AS brojTelefona,
    json_extract(event_json, '$.product') AS product, json_extract(event_json, '$.statusAt') AS statusAt FROM expressone_shipments
    WHERE resolution != 'applied' AND json_extract(event_json, '$.status') = 'povrat posiljaocu'`).all() as CarrierReturnContact[];
  return rows.map((row) => ({ tracking: row.tracking, primalac: String(row.primalac || ""), brojTelefona: String(row.brojTelefona || ""),
    ...(includeDetails ? { product: row.product || "", statusAt: row.statusAt || "" } : {}) }));
}

declare global { var galagoExpressOneTimer: ReturnType<typeof setInterval> | undefined; var galagoExpressOneRun: Promise<void> | undefined; }
export function startExpressOneScheduler() {
  if (globalThis.galagoExpressOneTimer) return;
  const kick = () => {
    if (!globalThis.galagoExpressOneRun) globalThis.galagoExpressOneRun = runExpressOneScan().then(async () => {
      const { runSettlementScan } = await import("./expressone-settlements");
      await runSettlementScan();
    })
      .catch(() => console.error("Express One daily scan failed"))
      .finally(() => { globalThis.galagoExpressOneRun = undefined; });
  };
  kick();
  globalThis.galagoExpressOneTimer = setInterval(kick, 60_000);
  globalThis.galagoExpressOneTimer.unref();
}

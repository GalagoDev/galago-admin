import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { getDb } from "./db";
import { claimGmailReader } from "./claim-gmail";
import { markCourierOrdersDelivered, readReturnImportOrders } from "./google-order-status";
import { courierOrderKey } from "./courier-status";
import { courierTrackingSnapshot } from "./courier-tracking-store";
import { matchSettlement, nextSettlementScan, parseSettlementWorkbook, settlementAttachments, type SettlementRow } from "./expressone-settlement-parser";

type StoredRow = { file_hash: string; row_number: number; row_json: string; order_key: string | null };
type Scan = { last_success_at: number | null; last_error: string | null; last_added: number; last_reports: number; next_run_at: number; lease_until: number };
const options = { timeout: 20_000, retry: false };

export function getSettlementScanStatus() {
  const db = getDb();
  const scan = db.prepare("SELECT * FROM expressone_settlement_scan WHERE id = 1").get() as Scan | undefined;
  const latest = db.prepare("SELECT MAX(received_at) AS received_at FROM expressone_settlement_reports").get() as { received_at: number | null };
  const review = db.prepare("SELECT COUNT(*) AS n FROM expressone_settlement_rows WHERE resolution = 'review'").get() as { n: number };
  return { scan, latestReportAt: latest.received_at, reviewCount: review.n, running: Boolean(scan && scan.lease_until > Date.now()) };
}

export function requestSettlementScan() {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO expressone_settlement_scan (id) VALUES (1)").run();
  // Preserve the active lease; the daily timer will run this after the current operation.
  db.prepare("UPDATE expressone_settlement_scan SET next_run_at = 0 WHERE id = 1 AND lease_until < ?").run(Date.now());
}

export async function runSettlementScan(now = Date.now()) {
  const db = getDb(), token = randomUUID(), lease = 90_000;
  db.prepare("INSERT OR IGNORE INTO expressone_settlement_scan (id) VALUES (1)").run();
  if (!db.prepare(`UPDATE expressone_settlement_scan SET lease_until = ?, lease_token = ?
    WHERE id = 1 AND next_run_at <= ? AND lease_until < ?`).run(now + lease, token, now, now).changes) return;
  const heartbeat = setInterval(() => db.prepare("UPDATE expressone_settlement_scan SET lease_until = ? WHERE id = 1 AND lease_token = ?")
    .run(Date.now() + lease, token), 20_000);
  heartbeat.unref();
  const deadline = Date.now() + 20 * 60_000;
  function assertLease() {
    if (Date.now() > deadline || !db.prepare("SELECT 1 FROM expressone_settlement_scan WHERE id = 1 AND lease_token = ? AND lease_until > ?").get(token, Date.now())) throw new Error("settlement-interrupted");
  }
  async function request<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      assertLease(); await sleep(1200);
      try { return await call(); } catch (error) {
        const e = error as { code?: number; response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
        const status = e.response?.status || e.code;
        const quota = status === 429 || e.response?.data?.error?.errors?.some(e => /^(userRateLimitExceeded|rateLimitExceeded)$/.test(e.reason || ""));
        if (attempt >= 3 || (!quota && !(typeof status === "number" && status >= 500))) throw error;
        await sleep(20_000 * (attempt + 1));
      }
    }
  }
  let reports = 0, added = 0;
  try {
    const gmail = claimGmailReader();
    if (!gmail) throw new Error("gmail-not-connected");
    const previous = getSettlementScanStatus().scan?.last_success_at;
    const after = previous ? String(Math.floor((previous - 7 * 86400_000) / 1000)) : "2026/09/06";
    const ids: string[] = []; let pageToken: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("settlement-interrupted");
      const { data } = await request(() => gmail.users.messages.list({ userId: "me", includeSpamTrash: true,
        q: `in:anywhere from:expressone.ba subject:GALAGO {filename:xls filename:xlsx} after:${after}`, maxResults: 100, pageToken }, options));
      for (const message of data.messages || []) if (message.id) ids.push(message.id);
      pageToken = data.nextPageToken || undefined;
      if (!pageToken) break;
    }
    // Import oldest first. A checkpoint is written only after every attachment in the scan is stored.
    for (const id of ids.reverse()) {
      if (db.prepare("SELECT 1 FROM expressone_settlement_messages WHERE gmail_id = ?").get(id)) continue;
      const { data: message } = await request(() => gmail.users.messages.get({ userId: "me", id, format: "full" }, options));
      const received = Number(message.internalDate);
      if (!Number.isFinite(received) || received <= 0) throw new Error("settlement-format");
      for (const part of settlementAttachments(message)) {
        if ((part.body?.size || 0) > 5 * 1024 * 1024) throw new Error("settlement-format");
        const raw = part.body?.attachmentId
          ? (await request(() => gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: part.body!.attachmentId! }, options))).data.data
          : part.body?.data;
        if (!raw) throw new Error("settlement-format");
        const buffer = Buffer.from(raw, "base64url");
        const hash = createHash("sha256").update(buffer).digest("hex");
        if (db.prepare("SELECT 1 FROM expressone_settlement_reports WHERE file_hash = ?").get(hash)) continue;
        const rows = await parseSettlementWorkbook(new File([buffer], part.filename!), received);
        assertLease();
        db.transaction(() => {
          db.prepare("INSERT INTO expressone_settlement_reports (file_hash,gmail_id,filename,received_at,imported_at) VALUES (?,?,?,?,?)")
            .run(hash, id, part.filename!, received, Date.now());
          const insert = db.prepare("INSERT INTO expressone_settlement_rows (file_hash,row_number,row_json) VALUES (?,?,?)");
          for (const row of rows) insert.run(hash, row.row, JSON.stringify(row));
        })();
        reports++;
      }
      assertLease();
      db.prepare("INSERT OR IGNORE INTO expressone_settlement_messages (gmail_id,received_at) VALUES (?,?)").run(id, received);
    }
    const pending = db.prepare(`SELECT r.* FROM expressone_settlement_rows r JOIN expressone_settlement_reports f USING(file_hash)
      WHERE r.resolution != 'applied' ORDER BY f.received_at,r.row_number`).all() as StoredRow[];
    if (pending.length) {
      const orders = await readReturnImportOrders(), states = courierTrackingSnapshot(orders).states;
      const selected = new Map<string, { order: typeof orders[number]; rows: StoredRow[] }>();
      const applied = db.prepare("UPDATE expressone_settlement_rows SET resolution = 'applied', order_key = ?, last_error = NULL WHERE file_hash = ? AND row_number = ?");
      const review = db.prepare("UPDATE expressone_settlement_rows SET resolution = 'review', last_error = ? WHERE file_hash = ? AND row_number = ?");
      for (const row of pending) {
        const match = matchSettlement(JSON.parse(row.row_json) as SettlementRow, orders);
        if (!match.order) { review.run(match.reason, row.file_hash, row.row_number); continue; }
        const order = match.order, key = courierOrderKey(order);
        if (row.order_key && row.order_key !== key) { review.run("Narudzba je promijenjena", row.file_hash, row.row_number); continue; }
        if (match.alreadyDelivered) { applied.run(key, row.file_hash, row.row_number); continue; }
        if (states[order.sheetRowNumber]?.parcels.some(p => p.category === "returned")) {
          review.run("Kurir evidentira povrat", row.file_hash, row.row_number); continue;
        }
        // A remittance of the full order amount is evidence that its COD has been settled.
        db.prepare("UPDATE expressone_settlement_rows SET order_key = ? WHERE file_hash = ? AND row_number = ?").run(key, row.file_hash, row.row_number);
        const entry = selected.get(key) || { order, rows: [] }; entry.rows.push(row); selected.set(key, entry);
      }
      if (selected.size) {
        assertLease();
        const result = await markCourierOrdersDelivered([...selected.values()].map(entry => entry.order));
        added = result.moved;
        const verified = await readReturnImportOrders();
        for (const [key, entry] of selected) {
          const matches = verified.filter(order => courierOrderKey(order) === key);
          if (matches.length !== 1 || !matches[0].appStatus.startsWith("delivered:") || !matches[0].deliveredChecked) throw new Error("settlement-write-not-confirmed");
          assertLease();
          for (const row of entry.rows) applied.run(key, row.file_hash, row.row_number);
        }
      }
    }
    db.prepare(`UPDATE expressone_settlement_scan SET last_success_at = ?, next_run_at = ?, lease_until = 0, lease_token = '',
      last_error = NULL, last_added = ?, last_reports = ? WHERE id = 1 AND lease_token = ?`)
      .run(Date.now(), nextSettlementScan(Date.now()), added, reports, token);
  } catch (error) {
    const reasons: Record<string, string> = {
      "gmail-not-connected": "Gmail citanje nije povezano.",
      "settlement-format": "Format izvjestaja razduzenja nije prepoznat.",
      "settlement-write-not-confirmed": "Upis dostave u Sheets nije potvrdjen.",
    };
    db.prepare("UPDATE expressone_settlement_scan SET next_run_at = ?, lease_until = 0, lease_token = '', last_error = ? WHERE id = 1 AND lease_token = ?")
      .run(Date.now() + 3600_000, (reasons[error instanceof Error ? error.message : ""] || "Provjera izvjestaja nije zavrsena.") + " Novi pokusaj za sat vremena.", token);
  } finally { clearInterval(heartbeat); }
}

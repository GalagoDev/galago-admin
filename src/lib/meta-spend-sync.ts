import "server-only";
import { getDb } from "@/lib/db";
import { getMetaAdsDailySpend } from "@/lib/meta-ads";

function db() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta_daily_spend (
      date_key TEXT PRIMARY KEY, result_json TEXT NOT NULL, fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta_spend_sync (
      id INTEGER PRIMARY KEY CHECK(id=1), last_attempt_at INTEGER NOT NULL DEFAULT 0,
      lease_until INTEGER NOT NULL DEFAULT 0, last_success_at TEXT, last_error TEXT
    );
    INSERT OR IGNORE INTO meta_spend_sync(id) VALUES(1);
  `);
  return database;
}

export async function syncMetaDailySpend() {
  if (!process.env.META_ADS_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_IDS) return;
  const database = db();
  const now = Date.now();
  if (!database.prepare("UPDATE meta_spend_sync SET last_attempt_at=?,lease_until=? WHERE id=1 AND lease_until<=? AND last_attempt_at<=?")
    .run(now, now + 5 * 60_000, now, now - 60 * 60_000).changes) return;
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sarajevo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const days = [0, 1, 2].map(offset => new Date(Date.parse(`${today}T12:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10));
    // Account-level spend only; no page rendering, order scans or ad-level ranking.
    for (const day of days) {
      const result = await getMetaAdsDailySpend(day);
      if (!result.configured || !result.complete) throw new Error("Meta spend unavailable");
      database.prepare(`INSERT INTO meta_daily_spend(date_key,result_json,fetched_at) VALUES(?,?,?)
        ON CONFLICT(date_key) DO UPDATE SET result_json=excluded.result_json,fetched_at=excluded.fetched_at`)
        .run(day, JSON.stringify(result), new Date().toISOString());
    }
    database.prepare("UPDATE meta_spend_sync SET lease_until=0,last_success_at=?,last_error=NULL WHERE id=1").run(new Date().toISOString());
  } catch {
    database.prepare("UPDATE meta_spend_sync SET lease_until=0,last_error=? WHERE id=1").run("Meta potrošnja nije osvježena; prethodni podaci su sačuvani.");
  }
}

declare global { var galagoMetaSpendScheduler: ReturnType<typeof setInterval> | undefined; }
export function startMetaSpendScheduler() {
  if (globalThis.galagoMetaSpendScheduler || !process.env.META_ADS_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_IDS) return;
  const tick = () => { void syncMetaDailySpend().catch(() => console.error("Meta spend storage unavailable")); };
  tick();
  globalThis.galagoMetaSpendScheduler = setInterval(tick, 30 * 60_000);
  globalThis.galagoMetaSpendScheduler.unref();
}

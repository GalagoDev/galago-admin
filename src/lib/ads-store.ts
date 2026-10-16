import "server-only";

import { getDb } from "@/lib/db";
import { defaultAdsSettings } from "@/lib/ads-analytics";
import type { AdsSettings, AdsSnapshot } from "@/lib/ads-types";

function db() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS ads_snapshots (
      customer_id TEXT PRIMARY KEY, snapshot_json TEXT,
      last_attempt_at TEXT, last_success_at TEXT, last_error TEXT,
      lock_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS ads_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1), settings_json TEXT NOT NULL
    );
  `);
  return database;
}

export function readAdsState(customerId: string) {
  const row = db().prepare("SELECT * FROM ads_snapshots WHERE customer_id = ?").get(customerId) as {
    snapshot_json: string | null; last_attempt_at: string | null; last_success_at: string | null; last_error: string | null; lock_until: number;
  } | undefined;
  return { snapshot: row?.snapshot_json ? JSON.parse(row.snapshot_json) as AdsSnapshot : null, lastAttemptAt: row?.last_attempt_at || null, lastSuccessAt: row?.last_success_at || null, error: row?.last_error || null, running: (row?.lock_until || 0) > Date.now() };
}

export function claimAdsSync(customerId: string, cooldownMs: number) {
  const database = db();
  return database.transaction(() => {
    database.prepare("INSERT OR IGNORE INTO ads_snapshots (customer_id) VALUES (?)").run(customerId);
    const state = readAdsState(customerId);
    if (state.running || (state.lastAttemptAt && Date.now() - Date.parse(state.lastAttemptAt) < cooldownMs)) return false;
    database.prepare("UPDATE ads_snapshots SET last_attempt_at = ?, lock_until = ? WHERE customer_id = ?").run(new Date().toISOString(), Date.now() + 10 * 60_000, customerId);
    return true;
  })();
}

export function saveAdsSnapshot(snapshot: AdsSnapshot) {
  db().prepare("UPDATE ads_snapshots SET snapshot_json = ?, last_success_at = ?, last_error = NULL, lock_until = 0 WHERE customer_id = ?").run(JSON.stringify(snapshot), snapshot.fetchedAt, snapshot.account.id);
}

export function failAdsSync(customerId: string, message: string) {
  db().prepare("UPDATE ads_snapshots SET last_error = ?, lock_until = 0 WHERE customer_id = ?").run(message, customerId);
}

export function readAdsSettings(): AdsSettings {
  const row = db().prepare("SELECT settings_json FROM ads_settings WHERE id = 1").get() as { settings_json: string } | undefined;
  return row ? { ...defaultAdsSettings(), ...JSON.parse(row.settings_json) } : defaultAdsSettings();
}

export function saveAdsSettings(settings: AdsSettings) {
  db().prepare("INSERT INTO ads_settings (id, settings_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json").run(JSON.stringify(settings));
}

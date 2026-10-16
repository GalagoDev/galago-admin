import "server-only";

import { fetchGoogleAdsSnapshot, getAdsConnection } from "@/lib/google-ads-client";
import { claimAdsSync, failAdsSync, saveAdsSnapshot } from "@/lib/ads-store";

export async function syncGoogleAds(manual = false) {
  const connection = getAdsConnection();
  if (!connection.configured || !connection.customerId) return { ok: false, error: "Google Ads još nije povezan." };
  // A database lock prevents duplicate work across multiple Node workers.
  if (!claimAdsSync(connection.customerId, manual ? 5 * 60_000 : 60 * 60_000)) return { ok: true, skipped: true };
  try {
    saveAdsSnapshot(await fetchGoogleAdsSnapshot());
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Ads sinhronizacija nije uspjela.";
    failAdsSync(connection.customerId, message);
    return { ok: false, error: message };
  }
}

declare global { var galagoAdsScheduler: ReturnType<typeof setInterval> | undefined; }

export function startAdsScheduler() {
  if (globalThis.galagoAdsScheduler || !getAdsConnection().configured) return;
  const tick = () => { void syncGoogleAds().catch(() => console.error("Google Ads sync storage unavailable")); };
  tick();
  globalThis.galagoAdsScheduler = setInterval(tick, 5 * 60_000);
  globalThis.galagoAdsScheduler.unref();
}

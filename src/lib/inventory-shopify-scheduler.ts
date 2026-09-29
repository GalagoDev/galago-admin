import { isInventoryShopifySyncConfigured, refreshInventoryFromShopifyIfStale } from "@/lib/inventory-shopify-sync";

declare global {
  var galagoInventoryScheduler: ReturnType<typeof setInterval> | undefined;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function tick() {
  if (!isInventoryShopifySyncConfigured()) return;
  try {
    await refreshInventoryFromShopifyIfStale();
  } catch (error) {
    console.error("Shopify Lager sync failed", error);
  }
}

export function startInventoryShopifyScheduler() {
  if (globalThis.galagoInventoryScheduler) return;
  void tick();
  globalThis.galagoInventoryScheduler = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  globalThis.galagoInventoryScheduler.unref();
}

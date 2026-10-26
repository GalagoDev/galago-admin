export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.CLAIMS_MESSAGING_SCHEDULER_ENABLED !== "false") {
      const { startClaimMessagingScheduler } = await import("@/lib/claim-messaging-worker");
      startClaimMessagingScheduler();
    }
    if (process.env.GOOGLE_ADS_SYNC_ENABLED?.trim().toLowerCase() !== "false") {
      const { startAdsScheduler } = await import("@/lib/ads-sync");
      startAdsScheduler();
    }

    if (process.env.ANANAS_INTERNAL_SCHEDULER_ENABLED?.trim().toLowerCase() === "true") {
      const { startAnanasScheduler } = await import("@/lib/ananas-scheduler");
      startAnanasScheduler();
    }

    if (process.env.SHOPIFY_INVENTORY_SYNC_ENABLED?.trim().toLowerCase() !== "false") {
      const { startInventoryShopifyScheduler } = await import("@/lib/inventory-shopify-scheduler");
      startInventoryShopifyScheduler();
    }
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.ANANAS_INTERNAL_SCHEDULER_ENABLED?.trim().toLowerCase() === "true") {
    const { startAnanasScheduler } = await import("@/lib/ananas-scheduler");
    startAnanasScheduler();
  }

  if (process.env.SHOPIFY_INVENTORY_SYNC_ENABLED?.trim().toLowerCase() !== "false") {
    const { startInventoryShopifyScheduler } = await import("@/lib/inventory-shopify-scheduler");
    startInventoryShopifyScheduler();
  }
}

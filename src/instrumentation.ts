export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    if (process.env.COURIER_TRACKING_SCHEDULER_ENABLED !== "false" && process.env.NEXT_PHASE !== "phase-production-build") {
      const { startCourierTrackingScheduler } = await import("@/lib/courier-tracking-worker");
      startCourierTrackingScheduler();
    }
    if (process.env.EXPRESSONE_RETURNS_SCHEDULER_ENABLED !== "false") {
      const { startExpressOneScheduler } = await import("@/lib/expressone-returns");
      startExpressOneScheduler();
    }
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

    if (process.env.META_ADS_SYNC_ENABLED !== "false") {
      const { startMetaSpendScheduler } = await import("@/lib/meta-spend-sync");
      startMetaSpendScheduler();
    }

    if (process.env.IMPORT_PAYMENTS_SYNC_ENABLED !== "false") {
      const { startImportPaymentsScheduler } = await import("@/lib/import-payments-sync");
      startImportPaymentsScheduler();
    }
  }
}

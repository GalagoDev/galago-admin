export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.ANANAS_INTERNAL_SCHEDULER_ENABLED?.trim().toLowerCase() === "true"
  ) {
    const { startAnanasScheduler } = await import("@/lib/ananas-scheduler");
    startAnanasScheduler();
  }
}

import { getDb } from "@/lib/db";
import { runFullAnanasReconciliation, syncAnanasInvoices } from "@/lib/ananas-sync";
import { syncBedlyAnanasOrders } from "@/lib/bedly-ananas-orders";

type ScheduledAction = "prices-stock" | "discounts" | "refresh-ids" | "import-catalog" | "invoices";

declare global {
  var galagoAnanasScheduler: ReturnType<typeof setInterval> | undefined;
  var galagoAnanasSchedulerRunning: boolean | undefined;
}

function sarajevoClock() {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Sarajevo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function dueActions(clock: ReturnType<typeof sarajevoClock>) {
  const actions: ScheduledAction[] = [];
  // Ananas product IDs must be refreshed before price/stock updates.
  if (clock.hour === 0 && clock.minute >= 5) actions.push("refresh-ids");
  if ((clock.hour === 0 && clock.minute >= 15) || clock.hour === 1) actions.push("prices-stock");
  if (clock.hour === 2 && clock.minute >= 15) actions.push("discounts");
  if ((clock.day === 1 || clock.day === 15) && clock.hour >= 4) actions.push("import-catalog");
  if (clock.hour >= 5) actions.push("invoices");
  return actions;
}

function claimRun(date: string, action: ScheduledAction) {
  return (
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO ananas_scheduler_runs (run_date, action, status)
         VALUES (?, ?, 'running')`,
      )
      .run(date, action).changes === 1
  );
}

function completeRun(date: string, action: ScheduledAction) {
  getDb()
    .prepare(
      `UPDATE ananas_scheduler_runs
       SET status = 'succeeded', last_error = NULL, completed_at = CURRENT_TIMESTAMP
       WHERE run_date = ? AND action = ?`,
    )
    .run(date, action);
}

function releaseFailedRun(date: string, action: ScheduledAction, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Ananas scheduled ${action} failed`, error);
  getDb()
    .prepare("DELETE FROM ananas_scheduler_runs WHERE run_date = ? AND action = ?")
    .run(date, action);
  return message;
}

async function execute(action: ScheduledAction) {
  if (action === "prices-stock") {
    return runFullAnanasReconciliation(undefined, {
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: true,
      syncDiscounts: false,
    });
  }
  if (action === "discounts") {
    return runFullAnanasReconciliation(undefined, {
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: false,
      syncDiscounts: true,
    });
  }
  if (action === "refresh-ids") {
    return runFullAnanasReconciliation(undefined, {
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: false,
      syncDiscounts: false,
    });
  }
  if (action === "import-catalog") {
    return runFullAnanasReconciliation(undefined, {
      submitCatalog: true,
      refreshIds: false,
      syncPricesStock: false,
      syncDiscounts: false,
    });
  }
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000);
  return syncAnanasInvoices({ dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString(), type: "NON_FISCAL" });
}

async function tick() {
  if (globalThis.galagoAnanasSchedulerRunning) return;
  globalThis.galagoAnanasSchedulerRunning = true;
  try {
    // Five-minute persistent cooldown inside sync; independent of nightly jobs.
    try {
      await syncBedlyAnanasOrders();
    } catch (error) {
      console.error("Bedly Ananas order inventory sync failed", error);
    }
    const clock = sarajevoClock();
    for (const action of dueActions(clock)) {
      if (!claimRun(clock.date, action)) continue;
      try {
        await execute(action);
        completeRun(clock.date, action);
      } catch (error) {
        releaseFailedRun(clock.date, action, error);
      }
    }
  } finally {
    globalThis.galagoAnanasSchedulerRunning = false;
  }
}

export function startAnanasScheduler() {
  if (globalThis.galagoAnanasScheduler) return;
  void tick();
  globalThis.galagoAnanasScheduler = setInterval(() => void tick(), 60_000);
  globalThis.galagoAnanasScheduler.unref();
}

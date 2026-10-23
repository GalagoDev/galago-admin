import { enqueueAnanasJob, getAnanasSyncSummary } from "@/lib/ananas-store";
import { processPendingAnanasJobs } from "@/lib/ananas-sync";
import { verifyIntegrationSecret } from "@/lib/shopify-ananas-auth";
import { syncBedlyAnanasOrders, getBedlyOrderSyncStatus } from "@/lib/bedly-ananas-orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 300;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(request: Request) {
  if (!verifyIntegrationSecret(request.headers.get("x-integration-secret"))) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    limitProducts?: number;
    dateFrom?: string;
    dateTo?: string;
    type?: "FISCAL" | "NON_FISCAL";
    discountDate?: string;
    source?: "galago" | "bedly" | "all";
  };
  const action = body.action || "process";
  if (body.source && !["galago", "bedly", "all"].includes(body.source)) {
    return Response.json({ ok: false, error: "Unsupported source" }, { status: 400 });
  }
  const source = body.source || "all";
  if (action === "bedly-orders") {
    try {
      return Response.json({ ok: true, result: await syncBedlyAnanasOrders(true), orderSync: getBedlyOrderSyncStatus() });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
  }
  let jobId: number | null = null;

  if (action === "test-catalog") {
    jobId = enqueueAnanasJob("full_reconcile", `test-catalog:${source}`, {
      source,
      limitProducts: 10,
      submitCatalog: true,
      refreshIds: true,
      syncPricesStock: true,
      syncDiscounts: false,
    });
  } else if (action === "test-discounts") {
    if (!body.discountDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.discountDate)) {
      return Response.json({ ok: false, error: "discountDate must use YYYY-MM-DD" }, { status: 400 });
    }
    jobId = enqueueAnanasJob("full_reconcile", `test-discounts:${source}:${body.discountDate}`, {
      source,
      limitProducts: 10,
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: false,
      syncDiscounts: true,
      discountDate: body.discountDate,
    });
  } else if (action === "import-catalog") {
    jobId = enqueueAnanasJob("full_reconcile", `import-catalog:${source}`, {
      source,
      ...(body.limitProducts ? { limitProducts: body.limitProducts } : {}),
      submitCatalog: true,
      refreshIds: false,
      syncPricesStock: false,
      syncDiscounts: false,
    });
  } else if (action === "refresh-ids") {
    jobId = enqueueAnanasJob("full_reconcile", `refresh-ids:${source}`, {
      source,
      ...(body.limitProducts ? { limitProducts: body.limitProducts } : {}),
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: false,
      syncDiscounts: false,
    });
  } else if (action === "prices-stock") {
    jobId = enqueueAnanasJob("full_reconcile", `prices-stock:${source}`, {
      source,
      ...(body.limitProducts ? { limitProducts: body.limitProducts } : {}),
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: true,
      syncDiscounts: false,
    });
  } else if (action === "discounts") {
    jobId = enqueueAnanasJob("full_reconcile", `discounts:${source}`, {
      source,
      ...(body.limitProducts ? { limitProducts: body.limitProducts } : {}),
      submitCatalog: false,
      refreshIds: true,
      syncPricesStock: false,
      syncDiscounts: true,
    });
  } else if (action === "reconcile") {
    jobId = enqueueAnanasJob("full_reconcile", `all-products:${source}`, {
      source,
      ...(body.limitProducts ? { limitProducts: body.limitProducts } : {}),
    });
  } else if (action === "invoices") {
    jobId = enqueueAnanasJob("invoice_sync", `${body.dateFrom || "recent"}:${body.dateTo || "now"}`, {
      dateFrom: body.dateFrom || isoDaysAgo(7),
      dateTo: body.dateTo || new Date().toISOString(),
      type: body.type || "NON_FISCAL",
    });
  } else if (action !== "process") {
    return Response.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }

  const results = await processPendingAnanasJobs(
    ["reconcile", "import-catalog", "refresh-ids", "prices-stock", "discounts"].includes(action) ? 1 : 20,
  );
  return Response.json({ ok: true, jobId, results, summary: getAnanasSyncSummary() });
}

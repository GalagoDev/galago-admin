import { after } from "next/server";

import { processPendingAnanasJobs } from "@/lib/ananas-sync";
import { enqueueAnanasJob, recordWebhook } from "@/lib/ananas-store";
import type { ShopifyProductWebhook } from "@/lib/ananas-types";
import { verifyShopifyWebhook } from "@/lib/shopify-ananas-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyShopifyWebhook(rawBody, request.headers.get("x-shopify-hmac-sha256"))) {
    return Response.json({ ok: false, error: "Invalid Shopify webhook signature" }, { status: 401 });
  }

  const webhookId = request.headers.get("x-shopify-webhook-id") || "";
  const topic = request.headers.get("x-shopify-topic") || "products/update";
  if (webhookId && !recordWebhook("shopify", webhookId, topic)) {
    return Response.json({ ok: true, duplicate: true });
  }

  let product: ShopifyProductWebhook;
  try {
    product = JSON.parse(rawBody) as ShopifyProductWebhook;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!product.id || !product.title || !Array.isArray(product.variants)) {
    return Response.json({ ok: false, error: "Invalid Shopify product payload" }, { status: 400 });
  }

  const jobId = enqueueAnanasJob("product_upsert", String(product.id), product);
  after(async () => {
    const results = await processPendingAnanasJobs(5);
    if (results.some((result) => result.status === "failed")) {
      console.error("Ananas product webhook processing finished with failures", results);
    }
  });
  return Response.json({ ok: true, queued: true, jobId }, { status: 202 });
}

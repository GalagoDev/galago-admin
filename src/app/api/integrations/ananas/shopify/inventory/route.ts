import { recordWebhook } from "@/lib/ananas-store";
import type { ShopifyInventoryWebhook } from "@/lib/ananas-types";
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
  const topic = request.headers.get("x-shopify-topic") || "inventory_levels/update";
  if (webhookId && !recordWebhook("shopify", webhookId, topic)) {
    return Response.json({ ok: true, duplicate: true });
  }

  let inventory: ShopifyInventoryWebhook;
  try {
    inventory = JSON.parse(rawBody) as ShopifyInventoryWebhook;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!inventory.inventory_item_id) {
    return Response.json({ ok: false, error: "Invalid Shopify inventory payload" }, { status: 400 });
  }

  return Response.json({ ok: true, scheduledForDailySync: true, localInventoryUpdated: false }, { status: 202 });
}

import crypto from "node:crypto";

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function verifyShopifyWebhook(rawBody: string, receivedHmac: string | null) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim() || process.env.SHOPIFY_CLIENT_SECRET?.trim();
  if (!secret) throw new Error("SHOPIFY_CLIENT_SECRET or SHOPIFY_WEBHOOK_SECRET is not configured.");
  if (!receivedHmac) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(expected, receivedHmac);
}

export function verifyIntegrationSecret(received: string | null) {
  const expected = process.env.ANANAS_SYNC_SECRET?.trim();
  if (!expected) throw new Error("ANANAS_SYNC_SECRET is not configured.");
  if (!received) return false;
  return safeEqual(expected, received);
}

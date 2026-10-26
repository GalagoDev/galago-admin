import { after } from "next/server";
import { getClaimMessagingConfig, sameSecret } from "@/lib/claim-messaging-config";
import { acceptClaimTelegramUpdate } from "@/lib/claim-messaging-store";
import { kickClaimMessaging } from "@/lib/claim-messaging-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const config = getClaimMessagingConfig();
  if (!config?.enabled || !sameSecret(request.headers.get("x-telegram-bot-api-secret-token") || "", config.webhookSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await request.text();
  if (body.length > 100_000) return new Response("Too large", { status: 413 });
  let input: unknown;
  try { input = JSON.parse(body); } catch { return new Response("Invalid JSON", { status: 400 }); }
  acceptClaimTelegramUpdate(input);
  after(() => kickClaimMessaging());
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

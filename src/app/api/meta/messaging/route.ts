import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  recordMetaMessagingMessage,
  type MetaMessagingChannel,
} from "@/lib/meta-messaging-identities";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type MetaWebhookMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  referral?: unknown;
};

type MetaWebhookEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MetaWebhookMessage;
  referral?: unknown;
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: MetaWebhookEvent[];
  }>;
};

function verifySignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = process.env.META_APP_SECRET || "";
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const receivedHex = signatureHeader.slice("sha256=".length);
  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;

  const received = Buffer.from(receivedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function getChannel(objectType: string, businessAccountId: string): MetaMessagingChannel {
  if (objectType === "instagram") return "instagram";
  if (
    process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID &&
    businessAccountId === process.env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID
  ) {
    return "instagram";
  }
  return "messenger";
}

function processWebhook(body: MetaWebhookBody) {
  const objectType = body.object || "";
  let processed = 0;

  for (const entry of body.entry || []) {
    const businessAccountId = String(entry.id || "");
    if (!businessAccountId) continue;

    const channel = getChannel(objectType, businessAccountId);
    for (const event of entry.messaging || []) {
      const message = event.message;
      if (!message?.mid) continue;

      const outgoing = Boolean(message.is_echo) || event.sender?.id === businessAccountId;
      const scopedUserId = String(outgoing ? event.recipient?.id || "" : event.sender?.id || "");
      if (!scopedUserId || scopedUserId === businessAccountId) continue;

      recordMetaMessagingMessage({
        messageId: message.mid,
        channel,
        businessAccountId,
        scopedUserId,
        direction: outgoing ? "outgoing" : "incoming",
        text: message.text,
        referral: message.referral || event.referral,
        timestampMs: event.timestamp || entry.time || Date.now(),
      });
      processed += 1;
    }
  }

  return processed;
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN || "";

  if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json(
    {
      ok: false,
      configured: Boolean(expectedToken && process.env.META_APP_SECRET),
    },
    { status: 403 }
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false, error: "Invalid Meta signature." }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody) as MetaWebhookBody;
    if (body.object !== "page" && body.object !== "instagram") {
      return NextResponse.json({ ok: false, error: "Unsupported Meta webhook object." }, { status: 404 });
    }

    const processed = processWebhook(body);
    return new Response("EVENT_RECEIVED", {
      status: 200,
      headers: { "x-galago-meta-events": String(processed) },
    });
  } catch (error) {
    console.error(
      "Meta messaging webhook failed:",
      error instanceof Error ? error.message : "Unknown Meta webhook error"
    );
    return NextResponse.json({ ok: false, error: "Meta webhook processing failed." }, { status: 500 });
  }
}

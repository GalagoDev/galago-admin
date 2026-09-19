import { createHash } from "node:crypto";

import { getDb } from "@/lib/db";
import {
  type MetaMessagingChannel,
  type MetaMessagingIdentity,
} from "@/lib/meta-messaging-identities";
import { bosniaPostalCodes, normalizePhone, type TelegramOrderDraft } from "@/lib/telegram-orders";

export type { MetaMessagingChannel, MetaMessagingIdentity } from "@/lib/meta-messaging-identities";

export type MetaTrackingResult = {
  status: "sent" | "queued" | "already_sent";
  eventsReceived?: number;
  traceId?: string;
  error?: string;
};

type MetaPurchaseInput = {
  eventId: string;
  identity: MetaMessagingIdentity;
  order: TelegramOrderDraft;
  eventTime?: number;
};

type MetaQueuedRow = {
  event_id: string;
  payload_json: string;
  status: string;
  attempts: number;
};

type MetaApiResponse = {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

const DEFAULT_DATASET_ID = "1046076751538508";
const DEFAULT_GRAPH_API_VERSION = "v26.0";

function normalizeForHash(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("bs-BA")
    .replace(/[^a-z0-9]/g, "");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashNormalized(value: string) {
  const normalized = normalizeForHash(value);
  return normalized ? sha256(normalized) : null;
}

function hashAsArray(value: string) {
  const hashed = hashNormalized(value);
  return hashed ? [hashed] : [];
}

function parseAmount(value: string) {
  const cleaned = String(value || "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function splitCustomerName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0] || "", lastName: "" };
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function cityAndZip(value: string) {
  const trimmed = value.trim();
  const zip = trimmed.match(/\b\d{5}\b/)?.[0] || "";
  let city = trimmed.replace(/\b\d{5}\b/g, " ").replace(/\s+/g, " ").trim();

  if (!city && zip) {
    city =
      Object.entries(bosniaPostalCodes).find(([, postalCode]) => postalCode === zip)?.[0] || "";
  }

  return { city, zip };
}

function getEventSourceUrl(channel: MetaMessagingChannel) {
  if (channel === "instagram") {
    return process.env.META_INSTAGRAM_PROFILE_URL || "https://www.instagram.com/galago.ba/";
  }

  return process.env.META_FACEBOOK_PAGE_URL || "https://www.facebook.com/galago.shop";
}

function compactRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === null || value === undefined || value === "") return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })
  );
}

export function buildMetaMessagingPurchasePayload(input: MetaPurchaseInput) {
  const phone = normalizePhone(input.order.brojTelefona);
  const { firstName, lastName } = splitCustomerName(input.order.primalac);
  const { city, zip } = cityAndZip(input.order.grad);
  const hashedPhone = phone ? sha256(phone) : null;

  const messagingIdentity =
    input.identity.channel === "messenger"
      ? {
          page_id: input.identity.pageId,
          page_scoped_user_id: input.identity.pageScopedUserId,
        }
      : {
          instagram_business_account_id: input.identity.instagramBusinessAccountId,
          ig_sid: input.identity.instagramScopedUserId,
        };

  const userData = compactRecord({
    ...messagingIdentity,
    ph: hashedPhone ? [hashedPhone] : [],
    fn: hashAsArray(firstName),
    ln: hashAsArray(lastName),
    ct: hashAsArray(city),
    zp: zip ? [sha256(zip)] : [],
    country: [sha256("ba")],
    external_id: [sha256(phone || input.eventId)],
  });

  const event = {
    event_name: "Purchase",
    event_time: input.eventTime || Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "business_messaging",
    messaging_channel: input.identity.channel,
    event_source_url: getEventSourceUrl(input.identity.channel),
    user_data: userData,
    custom_data: {
      currency: "BAM",
      value: parseAmount(input.order.otkupnina),
      order_id: input.eventId,
      content_name: input.order.artikal || "Narudžba iz poruka",
      payment_info_available: 0,
    },
  };

  return {
    data: [event],
    ...(process.env.META_CAPI_TEST_EVENT_CODE
      ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
      : {}),
  };
}

function ensureMetaQueueTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_conversion_events (
      event_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      response_json TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS meta_conversion_events_status_idx
      ON meta_conversion_events(status, updated_at, attempts);
  `);
  return db;
}

function getMetaConfig() {
  return {
    datasetId: process.env.META_MESSAGING_DATASET_ID || DEFAULT_DATASET_ID,
    version: process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION,
    token: process.env.META_CAPI_ACCESS_TOKEN || "",
  };
}

async function sendQueuedEvent(eventId: string): Promise<MetaTrackingResult> {
  const db = ensureMetaQueueTable();
  const row = db
    .prepare("SELECT event_id, payload_json, status, attempts FROM meta_conversion_events WHERE event_id = ?")
    .get(eventId) as MetaQueuedRow | undefined;

  if (!row) return { status: "queued", error: "Meta event nije pronađen u redu za slanje." };
  if (row.status === "sent") return { status: "already_sent" };

  const config = getMetaConfig();
  if (!config.token) {
    return { status: "queued", error: "META_CAPI_ACCESS_TOKEN nije podešen." };
  }

  db.prepare(
    `UPDATE meta_conversion_events
     SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE event_id = ?`
  ).run(eventId);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(config.version)}/${encodeURIComponent(config.datasetId)}/events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: row.payload_json,
        signal: AbortSignal.timeout(12_000),
      }
    );

    const result = (await response.json()) as MetaApiResponse;
    if (!response.ok || result.error || !result.events_received) {
      const message =
        result.error?.message || result.messages?.join("; ") || `Meta API HTTP ${response.status}`;
      db.prepare(
        `UPDATE meta_conversion_events
         SET status = 'failed', last_error = ?, response_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE event_id = ?`
      ).run(message, JSON.stringify(result), eventId);
      return { status: "queued", error: message, traceId: result.fbtrace_id };
    }

    db.prepare(
      `UPDATE meta_conversion_events
       SET status = 'sent', last_error = NULL, response_json = ?, sent_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE event_id = ?`
    ).run(JSON.stringify(result), eventId);

    return {
      status: "sent",
      eventsReceived: result.events_received,
      traceId: result.fbtrace_id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nepoznata Meta API greška";
    db.prepare(
      `UPDATE meta_conversion_events
       SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE event_id = ?`
    ).run(message, eventId);
    return { status: "queued", error: message };
  }
}

export async function trackMetaMessagingPurchase(input: MetaPurchaseInput) {
  const db = ensureMetaQueueTable();
  const payload = buildMetaMessagingPurchasePayload(input);

  db.prepare(
    `INSERT INTO meta_conversion_events (event_id, channel, payload_json)
     VALUES (?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  ).run(input.eventId, input.identity.channel, JSON.stringify(payload));

  return sendQueuedEvent(input.eventId);
}

export async function retryPendingMetaConversions(limit = 10) {
  const config = getMetaConfig();
  if (!config.token) return [];

  const db = ensureMetaQueueTable();
  const rows = db
    .prepare(
      `SELECT event_id, payload_json, status, attempts
       FROM meta_conversion_events
       WHERE status != 'sent'
         AND attempts < 10
         AND datetime(created_at) >= datetime('now', '-7 days')
         AND datetime(updated_at) <= datetime('now', '-5 minutes')
       ORDER BY datetime(created_at) ASC
       LIMIT ?`
    )
    .all(limit) as MetaQueuedRow[];

  const results: MetaTrackingResult[] = [];
  for (const row of rows) {
    results.push(await sendQueuedEvent(row.event_id));
  }
  return results;
}

export function isMetaConversionsConfigured() {
  const config = getMetaConfig();
  return Boolean(config.datasetId && config.token);
}

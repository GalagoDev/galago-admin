import { getDb } from "@/lib/db";
import { normalizePhone } from "@/lib/telegram-orders";

export type MetaMessagingChannel = "messenger" | "instagram";

export type MetaMessagingIdentity =
  | {
      channel: "messenger";
      pageId: string;
      pageScopedUserId: string;
    }
  | {
      channel: "instagram";
      instagramBusinessAccountId: string;
      instagramScopedUserId: string;
    };

type ContactRow = {
  channel: MetaMessagingChannel;
  business_account_id: string;
  scoped_user_id: string;
  last_seen_at: string;
};

function ensureMetaMessagingTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_messaging_messages (
      message_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      business_account_id TEXT NOT NULL,
      scoped_user_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      message_text TEXT,
      referral_json TEXT,
      message_timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS meta_messaging_messages_conversation_idx
      ON meta_messaging_messages(channel, business_account_id, scoped_user_id, message_timestamp);

    CREATE TABLE IF NOT EXISTS meta_messaging_contacts (
      phone TEXT NOT NULL,
      channel TEXT NOT NULL,
      business_account_id TEXT NOT NULL,
      scoped_user_id TEXT NOT NULL,
      last_message_id TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (phone, channel, business_account_id, scoped_user_id)
    );

    CREATE INDEX IF NOT EXISTS meta_messaging_contacts_phone_idx
      ON meta_messaging_contacts(phone, last_seen_at DESC);
  `);
  return db;
}

function identityFromRow(row: ContactRow): MetaMessagingIdentity {
  if (row.channel === "instagram") {
    return {
      channel: "instagram",
      instagramBusinessAccountId: row.business_account_id,
      instagramScopedUserId: row.scoped_user_id,
    };
  }

  return {
    channel: "messenger",
    pageId: row.business_account_id,
    pageScopedUserId: row.scoped_user_id,
  };
}

export function extractPhonesFromMetaMessage(text: string) {
  const matches = text.match(/(?:\+?387[\d\s/.-]{6,}|06[\d\s/.-]{6,})/gi) || [];
  return [...new Set(matches.map(normalizePhone).filter((phone) => phone.length >= 10))];
}

export function recordMetaMessagingMessage(input: {
  messageId: string;
  channel: MetaMessagingChannel;
  businessAccountId: string;
  scopedUserId: string;
  direction: "incoming" | "outgoing";
  text?: string;
  referral?: unknown;
  timestampMs: number;
}) {
  const db = ensureMetaMessagingTables();
  const timestamp = new Date(input.timestampMs || Date.now()).toISOString();
  const insert = db
    .prepare(
      `INSERT INTO meta_messaging_messages (
        message_id, channel, business_account_id, scoped_user_id, direction,
        message_text, referral_json, message_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING`
    )
    .run(
      input.messageId,
      input.channel,
      input.businessAccountId,
      input.scopedUserId,
      input.direction,
      input.text || null,
      input.referral ? JSON.stringify(input.referral) : null,
      timestamp
    );

  if (!insert.changes || input.direction !== "incoming" || !input.text) {
    return { duplicate: !insert.changes, phones: [] as string[] };
  }

  const phones = extractPhonesFromMetaMessage(input.text);
  const statement = db.prepare(`
    INSERT INTO meta_messaging_contacts (
      phone, channel, business_account_id, scoped_user_id, last_message_id, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone, channel, business_account_id, scoped_user_id) DO UPDATE SET
      last_message_id = excluded.last_message_id,
      last_seen_at = excluded.last_seen_at,
      updated_at = CURRENT_TIMESTAMP
  `);

  const saveContacts = db.transaction(() => {
    for (const phone of phones) {
      statement.run(
        phone,
        input.channel,
        input.businessAccountId,
        input.scopedUserId,
        input.messageId,
        timestamp
      );
    }
  });
  saveContacts();

  return { duplicate: false, phones };
}

export function findMetaMessagingIdentityByPhone(phoneValue: string) {
  const phone = normalizePhone(phoneValue);
  if (!phone) return { status: "missing" as const };

  const db = ensureMetaMessagingTables();
  const rows = db
    .prepare(
      `SELECT channel, business_account_id, scoped_user_id, last_seen_at
       FROM meta_messaging_contacts
       WHERE phone = ?
         AND datetime(last_seen_at) >= datetime('now', '-30 days')
       ORDER BY datetime(last_seen_at) DESC
       LIMIT 3`
    )
    .all(phone) as ContactRow[];

  if (rows.length === 0) return { status: "missing" as const };

  const newest = rows[0];
  const competing = rows.find(
    (row) =>
      row.channel !== newest.channel ||
      row.business_account_id !== newest.business_account_id ||
      row.scoped_user_id !== newest.scoped_user_id
  );

  if (competing) {
    const newestTime = Date.parse(newest.last_seen_at);
    const competingTime = Date.parse(competing.last_seen_at);
    if (Number.isFinite(newestTime) && Number.isFinite(competingTime) && newestTime - competingTime < 24 * 60 * 60 * 1000) {
      return { status: "ambiguous" as const };
    }
  }

  return {
    status: "found" as const,
    identity: identityFromRow(newest),
    lastSeenAt: newest.last_seen_at,
  };
}

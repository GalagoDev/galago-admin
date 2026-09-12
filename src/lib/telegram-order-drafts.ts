import { getDb } from "@/lib/db";
import type { MetaMessagingIdentity } from "@/lib/meta-messaging-identities";
import type { TelegramOrderDraft } from "@/lib/telegram-orders";

type DraftRow = {
  draft_key: string;
  chat_id: string;
  message_id: string;
  preview_message_id: number;
  order_json: string;
  meta_identity_json: string | null;
};

function ensureDraftTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_order_drafts (
      draft_key TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      preview_message_id INTEGER NOT NULL,
      order_json TEXT NOT NULL,
      meta_identity_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns = db.prepare("PRAGMA table_info(telegram_order_drafts)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "meta_identity_json")) {
    db.exec("ALTER TABLE telegram_order_drafts ADD COLUMN meta_identity_json TEXT");
  }
  return db;
}

export function makeTelegramDraftKey(chatId: number | string, messageId: number | string) {
  return `${chatId}:${messageId}`;
}

export function saveTelegramOrderDraft(input: {
  key: string;
  chatId: number | string;
  messageId: number | string;
  previewMessageId: number;
  order: TelegramOrderDraft;
  metaIdentity?: MetaMessagingIdentity;
}) {
  const db = ensureDraftTable();
  db.prepare(
    `INSERT INTO telegram_order_drafts (
       draft_key, chat_id, message_id, preview_message_id, order_json, meta_identity_json
     )
     VALUES (@key, @chatId, @messageId, @previewMessageId, @orderJson, @metaIdentityJson)
     ON CONFLICT(draft_key) DO UPDATE SET
       preview_message_id = excluded.preview_message_id,
       order_json = excluded.order_json,
       meta_identity_json = excluded.meta_identity_json,
       created_at = CURRENT_TIMESTAMP`
  ).run({
    key: input.key,
    chatId: String(input.chatId),
    messageId: String(input.messageId),
    previewMessageId: input.previewMessageId,
    orderJson: JSON.stringify(input.order),
    metaIdentityJson: input.metaIdentity ? JSON.stringify(input.metaIdentity) : null,
  });
}

export function getTelegramOrderDraft(key: string) {
  const db = ensureDraftTable();
  const row = db.prepare("SELECT * FROM telegram_order_drafts WHERE draft_key = ?").get(key) as DraftRow | undefined;
  if (!row) return null;

  return {
    key: row.draft_key,
    chatId: row.chat_id,
    messageId: row.message_id,
    previewMessageId: row.preview_message_id,
    order: JSON.parse(row.order_json) as TelegramOrderDraft,
    metaIdentity: row.meta_identity_json
      ? (JSON.parse(row.meta_identity_json) as MetaMessagingIdentity)
      : undefined,
  };
}

export function deleteTelegramOrderDraft(key: string) {
  const db = ensureDraftTable();
  db.prepare("DELETE FROM telegram_order_drafts WHERE draft_key = ?").run(key);
}

export function cleanupOldTelegramOrderDrafts() {
  const db = ensureDraftTable();
  db.prepare("DELETE FROM telegram_order_drafts WHERE datetime(created_at) < datetime('now', '-2 days')").run();
}

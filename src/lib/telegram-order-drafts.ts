import { getDb } from "@/lib/db";
import type { TelegramOrderDraft } from "@/lib/telegram-orders";

type DraftRow = {
  draft_key: string;
  chat_id: string;
  message_id: string;
  preview_message_id: number;
  order_json: string;
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
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
}) {
  const db = ensureDraftTable();
  db.prepare(
    `INSERT INTO telegram_order_drafts (draft_key, chat_id, message_id, preview_message_id, order_json)
     VALUES (@key, @chatId, @messageId, @previewMessageId, @orderJson)
     ON CONFLICT(draft_key) DO UPDATE SET
       preview_message_id = excluded.preview_message_id,
       order_json = excluded.order_json,
       created_at = CURRENT_TIMESTAMP`
  ).run({
    key: input.key,
    chatId: String(input.chatId),
    messageId: String(input.messageId),
    previewMessageId: input.previewMessageId,
    orderJson: JSON.stringify(input.order),
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

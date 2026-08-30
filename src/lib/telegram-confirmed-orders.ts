import { getDb } from "@/lib/db";
import type { TelegramOrderDraft } from "@/lib/telegram-orders";

type ConfirmedOrderRow = {
  chat_id: string;
  preview_message_id: number;
  source_message_id: string;
  sheet_order_id: string;
  order_json: string;
  deleted_at: string | null;
};

export type TelegramConfirmedOrder = {
  chatId: string;
  previewMessageId: number;
  sourceMessageId: string;
  sheetOrderId: string;
  order: TelegramOrderDraft;
  deletedAt: string | null;
};

function mapConfirmedOrder(row: ConfirmedOrderRow): TelegramConfirmedOrder {
  return {
    chatId: row.chat_id,
    previewMessageId: row.preview_message_id,
    sourceMessageId: row.source_message_id,
    sheetOrderId: row.sheet_order_id,
    order: JSON.parse(row.order_json) as TelegramOrderDraft,
    deletedAt: row.deleted_at,
  };
}

export function saveTelegramConfirmedOrder(input: {
  chatId: number | string;
  previewMessageId: number;
  sourceMessageId: number | string;
  sheetOrderId: string;
  order: TelegramOrderDraft;
}) {
  getDb()
    .prepare(
      `INSERT INTO telegram_confirmed_orders (
         chat_id, preview_message_id, source_message_id, sheet_order_id, order_json
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, preview_message_id) DO UPDATE SET
         source_message_id = excluded.source_message_id,
         sheet_order_id = excluded.sheet_order_id,
         order_json = excluded.order_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(
      String(input.chatId),
      input.previewMessageId,
      String(input.sourceMessageId),
      input.sheetOrderId,
      JSON.stringify(input.order),
    );
}

export function getTelegramConfirmedOrder(chatId: number | string, previewMessageId: number) {
  const row = getDb()
    .prepare(
      `SELECT * FROM telegram_confirmed_orders
       WHERE chat_id = ? AND preview_message_id = ?`,
    )
    .get(String(chatId), previewMessageId) as ConfirmedOrderRow | undefined;
  return row ? mapConfirmedOrder(row) : null;
}

export function markTelegramConfirmedOrderDeleted(chatId: number | string, previewMessageId: number) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE telegram_confirmed_orders
       SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
       WHERE chat_id = ? AND preview_message_id = ?`,
    )
    .run(now, now, String(chatId), previewMessageId);
  return result.changes > 0;
}

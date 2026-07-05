import { NextRequest, NextResponse } from "next/server";

import { appendOrderToOrdersSheet } from "@/lib/google-orders";
import {
  cleanupOldTelegramOrderDrafts,
  deleteTelegramOrderDraft,
  getTelegramOrderDraft,
  makeTelegramDraftKey,
  saveTelegramOrderDraft,
} from "@/lib/telegram-order-drafts";
import { formatTelegramOrderPreview, parseTelegramOrderText } from "@/lib/telegram-orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: {
    id: number;
  };
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

function getBotToken() {
  const token = process.env.TELEGRAM_ORDERS_BOT_TOKEN;
  if (!token) throw new Error("Telegram orders bot token is not configured.");
  return token;
}

function isAllowedChat(chatId: number | string) {
  const allowed = process.env.TELEGRAM_ORDERS_ALLOWED_CHAT_ID;
  if (!allowed) return true;

  const chat = String(chatId);
  return allowed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(chat);
}

function verifyWebhookSecret(request: NextRequest) {
  const expected = process.env.TELEGRAM_ORDERS_WEBHOOK_SECRET;
  if (!expected) return true;
  return request.headers.get("x-telegram-bot-api-secret-token") === expected;
}

async function telegramRequest<T>(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${getBotToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram API request failed: ${method}`);
  }

  return result.result as T;
}

async function sendMessage(payload: Record<string, unknown>) {
  return telegramRequest<TelegramMessage>("sendMessage", payload);
}

async function editMessageText(payload: Record<string, unknown>) {
  return telegramRequest<TelegramMessage>("editMessageText", payload);
}

async function answerCallbackQuery(payload: Record<string, unknown>) {
  return telegramRequest<boolean>("answerCallbackQuery", payload);
}

async function handleMessage(message: TelegramMessage) {
  if (!message.text || message.text.startsWith("/")) return;
  if (!isAllowedChat(message.chat.id)) return;

  cleanupOldTelegramOrderDrafts();

  const order = parseTelegramOrderText(message.text);
  const key = makeTelegramDraftKey(message.chat.id, message.message_id);
  const preview = await sendMessage({
    chat_id: message.chat.id,
    text: formatTelegramOrderPreview(order),
    reply_to_message_id: message.message_id,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Confirm", callback_data: `confirm:${key}` },
          { text: "Cancel", callback_data: `cancel:${key}` },
        ],
      ],
    },
  });

  saveTelegramOrderDraft({
    key,
    chatId: message.chat.id,
    messageId: message.message_id,
    previewMessageId: preview.message_id,
    order,
  });
}

async function handleCallbackQuery(query: TelegramCallbackQuery) {
  const data = query.data || "";
  const chatId = query.message?.chat.id;
  if (!data || !chatId || !isAllowedChat(chatId)) return;

  if (data.startsWith("cancel:")) {
    const key = data.slice("cancel:".length);
    const draft = getTelegramOrderDraft(key);
    if (!draft) {
      await answerCallbackQuery({ callback_query_id: query.id, text: "Order draft not found." });
      return;
    }

    deleteTelegramOrderDraft(key);
    await editMessageText({
      chat_id: Number(draft.chatId),
      message_id: draft.previewMessageId,
      text: "Narudžba otkazana.",
    });
    await answerCallbackQuery({ callback_query_id: query.id });
    return;
  }

  if (data.startsWith("confirm:")) {
    const key = data.slice("confirm:".length);
    const draft = getTelegramOrderDraft(key);
    if (!draft) {
      await answerCallbackQuery({ callback_query_id: query.id, text: "Order draft not found." });
      return;
    }

    try {
      await appendOrderToOrdersSheet(draft.order);
      deleteTelegramOrderDraft(key);
      await editMessageText({
        chat_id: Number(draft.chatId),
        message_id: draft.previewMessageId,
        text: `Narudžba potvrđena i sačuvana u Orders sheet.\n\n${formatTelegramOrderPreview(draft.order)}`,
      });
      await answerCallbackQuery({ callback_query_id: query.id, text: "Saved." });
    } catch (error) {
      await answerCallbackQuery({ callback_query_id: query.id, text: "Save failed." });
      await sendMessage({
        chat_id: Number(draft.chatId),
        text: `Greška pri spremanju: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.TELEGRAM_ORDERS_BOT_TOKEN),
    webhook: "/api/telegram/orders",
  });
}

export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.message) {
    await handleMessage(update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
  }

  return NextResponse.json({ ok: true });
}

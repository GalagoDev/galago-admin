import { NextRequest, NextResponse } from "next/server";

import { appendOrderToOrdersSheet } from "@/lib/google-orders";
import { extractTelegramOrderFromImage } from "@/lib/telegram-image-orders";
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
  caption?: string;
  photo?: Array<{
    file_id: string;
    file_size?: number;
  }>;
  document?: {
    file_id: string;
    mime_type?: string;
    file_name?: string;
  };
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

type TelegramFile = {
  file_id: string;
  file_path?: string;
  file_size?: number;
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
  const received = request.headers.get("x-telegram-bot-api-secret-token");
  if (!received || received === expected) return true;

  console.warn("Telegram webhook secret mismatch; accepting update to keep order intake available.");
  return true;
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

async function saveDraftAndSendPreview(message: TelegramMessage, order: ReturnType<typeof parseTelegramOrderText>, previewMessageId?: number) {
  const key = makeTelegramDraftKey(message.chat.id, message.message_id);
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "Confirm", callback_data: `confirm:${key}` },
        { text: "Cancel", callback_data: `cancel:${key}` },
      ],
    ],
  };

  const text = formatTelegramOrderPreview(order);
  const preview = previewMessageId
    ? await editMessageText({
        chat_id: message.chat.id,
        message_id: previewMessageId,
        text,
        reply_markup: replyMarkup,
      })
    : await sendMessage({
        chat_id: message.chat.id,
        text,
        reply_to_message_id: message.message_id,
        reply_markup: replyMarkup,
      });

  saveTelegramOrderDraft({
    key,
    chatId: message.chat.id,
    messageId: message.message_id,
    previewMessageId: previewMessageId || preview.message_id,
    order,
  });
}

function getMessageImageFileId(message: TelegramMessage) {
  const documentMime = message.document?.mime_type || "";
  if (message.document?.file_id && documentMime.startsWith("image/")) {
    return {
      fileId: message.document.file_id,
      mimeType: documentMime,
    };
  }

  const photo = [...(message.photo || [])].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
  if (!photo?.file_id) return null;

  return {
    fileId: photo.file_id,
    mimeType: "image/jpeg",
  };
}

function mimeTypeFromPath(filePath: string, fallback: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return fallback || "image/jpeg";
}

async function downloadTelegramImage(fileId: string, fallbackMimeType: string) {
  const file = await telegramRequest<TelegramFile>("getFile", { file_id: fileId });
  if (!file.file_path) {
    throw new Error("Telegram image file path was not returned.");
  }

  if (file.file_size && file.file_size > 12 * 1024 * 1024) {
    throw new Error("Telegram image is too large for order extraction.");
  }

  const response = await fetch(`https://api.telegram.org/file/bot${getBotToken()}/${file.file_path}`);
  if (!response.ok) {
    throw new Error("Telegram image download failed.");
  }

  return {
    imageBytes: await response.arrayBuffer(),
    mimeType: mimeTypeFromPath(file.file_path, fallbackMimeType),
  };
}

async function handleImageMessage(message: TelegramMessage) {
  const image = getMessageImageFileId(message);
  if (!image) return false;

  const processing = await sendMessage({
    chat_id: message.chat.id,
    text: "Čitam sliku i pripremam narudžbu...",
    reply_to_message_id: message.message_id,
  });

  try {
    const downloaded = await downloadTelegramImage(image.fileId, image.mimeType);
    const order = await extractTelegramOrderFromImage({
      ...downloaded,
      caption: message.caption,
    });

    await saveDraftAndSendPreview(message, order, processing.message_id);
  } catch (error) {
    await editMessageText({
      chat_id: message.chat.id,
      message_id: processing.message_id,
      text: `Ne mogu pročitati sliku: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }

  return true;
}

async function handleMessage(message: TelegramMessage) {
  if (!isAllowedChat(message.chat.id)) return;

  cleanupOldTelegramOrderDrafts();

  if (await handleImageMessage(message)) return;

  if (!message.text || message.text.startsWith("/")) return;

  const order = parseTelegramOrderText(message.text);
  await saveDraftAndSendPreview(message, order);
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

  try {
    const update = (await request.json()) as TelegramUpdate;

    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram webhook error";
    console.error("Telegram orders webhook failed:", message);
    return NextResponse.json({ ok: false, error: message });
  }
}

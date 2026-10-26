import { z } from "zod";
import { getDb } from "@/lib/db";
import { getClaimMessagingConfig } from "@/lib/claim-messaging-config";

export function queueClaimTelegram(claimId: string, id: string, text: string, replyToId?: number, fileId?: string) {
  const config = getClaimMessagingConfig();
  if (!config?.enabled) return;
  getDb().prepare(`INSERT OR IGNORE INTO claim_telegram_outbox
    (id, claim_id, chat_id, text, reply_to_id, file_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, claimId, config.chatId, text, replyToId ?? null, fileId ?? null);
}

type NewClaimNotice = { customerName: string; email: string; phone: string; requestType: string;
  orderNumber: string; address: string; city: string; description: string; files: { id: string }[] };

export function queueNewClaimNotification(id: string, reference: string, input: NewClaimNotice) {
  const config = getClaimMessagingConfig();
  if (!config?.enabled) return;
  const heading = `${reference}\n${input.requestType}\n\nKupac: ${input.customerName}\nEmail: ${input.email}\nTelefon: ${input.phone}\nNarudzba: ${input.orderNumber || "-"}\nAdresa: ${input.address}, ${input.city}`;
  const footer = `\n\n${config.publicUrl}/reklamacije?q=${encodeURIComponent(reference)}\nOdgovor kupcu: Reply na ovu poruku (tekst se salje emailom).`;
  const text = `${heading}\n\n${input.description}`;
  // Keep the complete description in subsequent messages instead of silently truncating it.
  const parts = text.match(/[\s\S]{1,3300}/gu) || [text];
  parts.forEach((part, i) => queueClaimTelegram(id, `claim:${id}:text:${i}`, part + (i === 0 ? footer : "")));
  input.files.forEach((file) => queueClaimTelegram(id, `claim:${id}:file:${file.id}`, reference, undefined, file.id));
}

const telegramMessageSchema = z.object({
  message_id: z.number().int().positive(),
  chat: z.object({ id: z.number().int(), type: z.enum(["private", "group", "supergroup", "channel"]) }),
  from: z.object({ id: z.number().int().positive(), is_bot: z.boolean(), first_name: z.string().optional(), last_name: z.string().optional() }).optional(),
  sender_chat: z.unknown().optional(),
  text: z.string().max(4096).optional(),
  reply_to_message: z.object({ message_id: z.number().int().positive() }).optional(),
});
const updateSchema = z.object({ update_id: z.number().int().nonnegative(), message: telegramMessageSchema.optional() });
export function acceptClaimTelegramUpdate(input: unknown) {
  const config = getClaimMessagingConfig();
  const update = updateSchema.safeParse(input);
  if (!config?.enabled || !update.success || !update.data.message) return "ignored";
  const { update_id, message } = update.data;
  if (String(message.chat.id) !== config.chatId || !["group", "supergroup"].includes(message.chat.type) ||
      !message.from || message.from.is_bot || message.sender_chat ||
      !config.allowedUserIds.includes(String(message.from.id)) || !message.reply_to_message) return "ignored";
  const db = getDb();
  const claim = db.prepare(`SELECT c.id, c.email FROM claim_telegram_messages m
    JOIN customer_return_claims c ON c.id = m.claim_id WHERE m.chat_id = ? AND m.message_id = ?`)
    .get(config.chatId, message.reply_to_message.message_id) as { id: string; email: string } | undefined;
  if (!claim) return "ignored";
  const body = message.text?.trim();
  if (!body || body.startsWith("/")) {
    queueClaimTelegram(claim.id, `unsupported:${update_id}`, "Email nije poslan. Podrzani su tekstualni odgovori putem Reply.", message.message_id);
    return "unsupported";
  }
  const connected = !!db.prepare("SELECT 1 FROM claim_gmail_connection WHERE id = 1").get();
  const result = db.prepare(`INSERT OR IGNORE INTO claim_email_replies
    (update_id, chat_id, message_id, claim_id, recipient, body, sender_id, sender_name, status, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(update_id, config.chatId, message.message_id, claim.id, claim.email, body, String(message.from.id),
      [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
      connected ? "queued" : "failed", connected ? null : "Gmail nije povezan. Email nije poslan.");
  if (!result.changes) return "duplicate";
  if (!connected) queueClaimTelegram(claim.id, `reply:${result.lastInsertRowid}:result`,
    "Gmail jos nije povezan. Email NIJE poslan. Nakon povezivanja posaljite odgovor ponovo.", message.message_id);
  return connected ? "queued" : "not-connected";
}

export type ClaimReply = { id: number; claim_id: string; recipient: string; body: string; sender_name: string;
  status: string; last_error: string | null; created_at: string; sent_at: string | null };
export function getClaimReplies(claimId: string) {
  return getDb().prepare(`SELECT id, claim_id, recipient, body, sender_name, status, last_error, created_at, sent_at
    FROM claim_email_replies WHERE claim_id = ? ORDER BY id DESC LIMIT 100`).all(claimId) as ClaimReply[];
}
export function getClaimMessagingStatus() {
  const config = getClaimMessagingConfig();
  const db = getDb();
  const gmail = db.prepare("SELECT email, connected_at FROM claim_gmail_connection WHERE id = 1").get() as { email: string; connected_at: string } | undefined;
  const counts = db.prepare(`SELECT
    SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM claim_telegram_outbox`).get() as { pending: number; failed: number };
  const last = db.prepare("SELECT created_at FROM claim_telegram_outbox WHERE status = 'sent' ORDER BY rowid DESC LIMIT 1").get() as { created_at: string } | undefined;
  return { enabled: !!config?.enabled, gmailReady: !!(config?.gmailClientId && config?.gmailClientSecret),
    gmail: gmail?.email || null, pending: counts.pending || 0, failed: counts.failed || 0, lastSent: last?.created_at || null };
}

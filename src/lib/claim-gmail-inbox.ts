import type { gmail_v1 } from "googleapis";
import { parseAddressList } from "email-addresses";
import { convert } from "html-to-text";
import { getDb } from "@/lib/db";
import { claimGmailReader } from "@/lib/claim-gmail";
import { getClaimMessagingConfig } from "@/lib/claim-messaging-config";
import { queueClaimTelegram } from "@/lib/claim-messaging-store";

export const CLAIM_INBOX_INTERVAL = 2 * 60 * 60 * 1000;
const requestOptions = { timeout: 10_000, retry: false };
type Thread = { thread_id: string; claim_id: string };

function header(part: gmail_v1.Schema$MessagePart | undefined, name: string) {
  return part?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export function parseClaimIncoming(message: gmail_v1.Schema$Message) {
  const addresses = parseAddressList(header(message.payload, "from"));
  const sender = addresses?.length === 1 && addresses[0].type === "mailbox" ? addresses[0].address.toLowerCase() : "";
  let attachments = 0, nodes = 0;
  function text(part: gmail_v1.Schema$MessagePart, depth = 0): string {
    if (++nodes > 100 || depth > 12) return "";
    if (part.filename || /^attachment\b/i.test(header(part, "content-disposition"))) { attachments++; return ""; }
    if (part.mimeType === "multipart/alternative") {
      const preferred = part.parts?.find(p => p.mimeType === "text/plain") || part.parts?.find(p => p.mimeType === "text/html");
      if (preferred) return text(preferred, depth + 1);
    }
    if (part.parts?.length) return part.parts.map(p => text(p, depth + 1)).filter(Boolean).join("\n\n");
    if (!part.body?.data || !["text/plain", "text/html"].includes(part.mimeType || "")) return "";
    const bytes = Buffer.from(part.body.data.slice(0, 300_000), "base64url");
    const charset = /charset=["']?([^\s;"']+)/i.exec(header(part, "content-type"))?.[1] || "utf-8";
    let decoded: string;
    try { decoded = new TextDecoder(charset).decode(bytes); } catch { decoded = bytes.toString("utf8"); }
    return part.mimeType === "text/html" ? convert(decoded, { wordwrap: false, limits: { maxInputLength: 200_000 },
      selectors: [{ selector: "img", format: "skip" }, { selector: "a", options: { ignoreHref: true } }] }) : decoded;
  }
  const body = message.payload ? text(message.payload).replace(/\u0000/g, "").trim().slice(0, 100_000) : "";
  const rfcId = header(message.payload, "message-id");
  return { sender, subject: header(message.payload, "subject").slice(0, 500), body, attachments,
    rfcId: /^<[^<>\s\r\n]+>$/.test(rfcId) ? rfcId : "" };
}

export function recordClaimIncoming(thread: Thread, message: gmail_v1.Schema$Message) {
  if (!message.id || message.threadId !== thread.thread_id || message.labelIds?.some(l => ["DRAFT", "SPAM", "TRASH"].includes(l))) return;
  const config = getClaimMessagingConfig();
  if (!config?.enabled) return;
  const db = getDb();
  if (db.prepare("SELECT 1 FROM claim_email_replies WHERE gmail_id = ?").get(message.id)) return;
  const claim = db.prepare("SELECT reference, email, customer_name FROM customer_return_claims WHERE id = ?").get(thread.claim_id) as
    { reference: string; email: string; customer_name: string } | undefined;
  if (!claim) return;
  const parsed = parseClaimIncoming(message);
  if (!parsed.sender || parsed.sender !== claim.email.trim().toLowerCase()) return;
  // Never relay our own outgoing mail, except an explicit self-addressed inbox test.
  if (message.labelIds?.includes("SENT") && !(parsed.sender === config.gmailAddress && message.labelIds.includes("INBOX"))) return;
  const date = Number(message.internalDate);
  if (!Number.isFinite(date) || date <= 0) return;
  db.transaction(() => {
    if (!db.prepare(`INSERT OR IGNORE INTO claim_email_incoming
      (gmail_id, thread_id, claim_id, sender, subject, body, rfc_message_id, received_at, attachment_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(message.id!, thread.thread_id, thread.claim_id, parsed.sender,
      parsed.subject, parsed.body, parsed.rfcId, new Date(date).toISOString(), parsed.attachments).changes) return;
    const root = db.prepare("SELECT message_id FROM claim_telegram_outbox WHERE claim_id = ? AND id = ? AND status = 'sent'")
      .get(thread.claim_id, `claim:${thread.claim_id}:text:0`) as { message_id: number } | undefined;
    const link = `https://mail.google.com/mail/?authuser=${encodeURIComponent(config.gmailAddress)}#all/${encodeURIComponent(thread.thread_id)}`;
    const body = parsed.body.slice(0, 20_000) || "[Email nema tekstualni sadrzaj.]";
    const text = `ODGOVOR KUPCA\n${claim.reference}\n${claim.customer_name} <${parsed.sender}>\n\n${body}`;
    const footer = `${parsed.body.length > 20_000 ? "\n[Ostatak poruke je u Gmailu.]" : ""}${parsed.attachments ? `\nPrilozi: ${parsed.attachments} (otvorite Gmail).` : ""}\n\n${link}\nOdgovor kupcu: Reply na ovu poruku.`;
    const parts = text.match(/[\s\S]{1,3000}/gu) || [text];
    parts.forEach((part, i) => queueClaimTelegram(thread.claim_id, `incoming:${message.id}:${i}`, part + (i === parts.length - 1 ? footer : ""), root?.message_id));
  })();
}

export async function pollClaimGmailReplies() {
  const gmail = claimGmailReader();
  if (!gmail) return;
  const db = getDb();
  const deadline = Date.now() + 30_000;
  // Only previously sent complaint message IDs are read, never a mailbox-wide search.
  for (let i = 0; i < 3 && Date.now() < deadline; i++) {
    const sent = db.prepare(`UPDATE claim_email_replies SET thread_lookup_at = ? WHERE id = (
      SELECT id FROM claim_email_replies WHERE status = 'sent' AND gmail_id IS NOT NULL
      AND gmail_thread_id IS NULL AND thread_lookup_at < ? ORDER BY id LIMIT 1) RETURNING id, gmail_id, claim_id`)
      .get(Date.now(), Date.now() - CLAIM_INBOX_INTERVAL) as { id: number; gmail_id: string; claim_id: string } | undefined;
    if (!sent) break;
    try {
      const { data } = await gmail.users.messages.get({ userId: "me", id: sent.gmail_id, format: "minimal" }, requestOptions);
      if (data.threadId) db.transaction(() => {
        if (!db.prepare("SELECT 1 FROM customer_return_claims WHERE id = ?").get(sent.claim_id)) return;
        db.prepare("UPDATE claim_email_replies SET gmail_thread_id = ? WHERE id = ?").run(data.threadId, sent.id);
        db.prepare("INSERT OR IGNORE INTO claim_gmail_threads (thread_id, claim_id) VALUES (?, ?)").run(data.threadId, sent.claim_id);
      })();
    } catch { /* Retried at the next two-hour check without affecting outgoing email. */ }
  }
  for (let i = 0; i < 3 && Date.now() < deadline; i++) {
    const now = Date.now();
    const thread = db.prepare(`UPDATE claim_gmail_threads SET lease_until = ? WHERE thread_id = (
      SELECT thread_id FROM claim_gmail_threads WHERE next_check_at <= ? AND lease_until < ?
      ORDER BY next_check_at, thread_id LIMIT 1) RETURNING thread_id, claim_id`)
      .get(now + 180_000, now, now) as Thread | undefined;
    if (!thread) break;
    try {
      const { data } = await gmail.users.threads.get({ userId: "me", id: thread.thread_id, format: "metadata",
        metadataHeaders: ["From"] }, requestOptions);
      const claim = db.prepare("SELECT email FROM customer_return_claims WHERE id = ?").get(thread.claim_id) as { email: string } | undefined;
      let complete = true;
      for (const message of data.messages || []) {
        if (!claim || !message.id || db.prepare("SELECT 1 FROM claim_email_incoming WHERE gmail_id = ?").get(message.id) ||
            db.prepare("SELECT 1 FROM claim_email_replies WHERE gmail_id = ?").get(message.id)) continue;
        if (message.labelIds?.some(l => ["DRAFT", "SPAM", "TRASH"].includes(l))) continue;
        if (parseClaimIncoming(message).sender !== claim.email.trim().toLowerCase()) continue;
        if (Date.now() >= deadline) { complete = false; break; }
        const full = await gmail.users.messages.get({ userId: "me", id: message.id, format: "full" }, requestOptions);
        recordClaimIncoming(thread, full.data);
      }
      db.prepare(`UPDATE claim_gmail_threads SET next_check_at = ?, lease_until = 0,
        checked_at = CURRENT_TIMESTAMP, last_error = NULL WHERE thread_id = ?`)
        .run(Date.now() + (complete ? CLAIM_INBOX_INTERVAL : 15_000), thread.thread_id);
    } catch {
      db.prepare("UPDATE claim_gmail_threads SET next_check_at = ?, lease_until = 0, last_error = ? WHERE thread_id = ?")
        .run(Date.now() + CLAIM_INBOX_INTERVAL, "Provjera Gmail odgovora nije uspjela. Provjerite Gmail povezivanje.", thread.thread_id);
    }
  }
}

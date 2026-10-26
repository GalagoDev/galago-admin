import fs from "node:fs";
import { getDb } from "@/lib/db";
import { getClaimMessagingConfig } from "@/lib/claim-messaging-config";
import { queueClaimTelegram } from "@/lib/claim-messaging-store";
import { ClaimEmailSendError, sendClaimEmail } from "@/lib/claim-gmail";
import { resolveCustomerReturnFile } from "@/lib/reklamacije";
import { pollClaimGmailReplies } from "@/lib/claim-gmail-inbox";

type TelegramJob = { id: string; claim_id: string; chat_id: string; text: string; file_id: string | null;
  reply_to_id: number | null; attempts: number };
type EmailJob = { id: number; claim_id: string; chat_id: string; message_id: number; recipient: string; body: string; reference: string };

async function sendTelegram(job: TelegramJob) {
  const config = getClaimMessagingConfig();
  if (!config?.enabled || job.chat_id !== config.chatId) throw new Error("Telegram grupa nije povezana.");
  const data = new FormData();
  data.set("chat_id", job.chat_id);
  if (job.reply_to_id) data.set("reply_parameters", JSON.stringify({ message_id: job.reply_to_id, allow_sending_without_reply: true }));
  if (job.file_id) {
    const file = resolveCustomerReturnFile(job.file_id);
    if (!file) throw new Error("Prilog nije dostupan.");
    data.set("document", new Blob([new Uint8Array(fs.readFileSync(file.path))], { type: file.mimeType }), file.originalName);
    data.set("caption", job.text);
  } else {
    data.set("text", job.text);
    data.set("link_preview_options", JSON.stringify({ is_disabled: true }));
  }
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${job.file_id ? "sendDocument" : "sendMessage"}`,
    { method: "POST", body: data, signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as { ok: boolean; result?: { message_id: number }; error_code?: number };
  if (!response.ok || !result.ok || !result.result?.message_id) throw new Error(`Telegram nije prihvatio poruku (${result.error_code || response.status}).`);
  return result.result.message_id;
}

function finishReply(job: EmailJob, status: string, error: string | null, gmailId: string | null = null, threadId: string | null = null) {
  const db = getDb();
  db.transaction(() => {
    const updated = db.prepare(`UPDATE claim_email_replies SET status = ?, last_error = ?, gmail_id = ?, gmail_thread_id = ?,
      sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?`).run(status, error, gmailId, threadId, status, job.id);
    if (!updated.changes) return;
    if (threadId) db.prepare("INSERT OR IGNORE INTO claim_gmail_threads (thread_id, claim_id) VALUES (?, ?)").run(threadId, job.claim_id);
    queueClaimTelegram(job.claim_id, `reply:${job.id}:result`, status === "sent"
      ? `Email poslan na ${job.recipient}.\n${job.reference}` : `Email: ${error}`, job.message_id);
  })();
}

export async function runClaimMessaging() {
  const config = getClaimMessagingConfig();
  if (!config?.enabled) return;
  const db = getDb();
  // Crashed/expired sends are deliberately not retried, because Gmail has no idempotency key.
  const abandoned = db.prepare(`SELECT r.*, c.reference FROM claim_email_replies r
    JOIN customer_return_claims c ON c.id = r.claim_id WHERE r.status = 'sending' AND r.started_at < ?`)
    .all(Date.now() - 180_000) as EmailJob[];
  for (const job of abandoned) finishReply(job, "unknown", "Slanje je prekinuto. Provjerite Poslano u Gmailu prije ponovnog odgovora.");

  for (let i = 0; i < 10; i++) {
    const job = db.transaction(() => {
      const row = db.prepare(`SELECT r.*, c.reference FROM claim_email_replies r JOIN customer_return_claims c ON c.id = r.claim_id
        WHERE r.status = 'queued' ORDER BY r.id LIMIT 1`).get() as EmailJob | undefined;
      if (!row) return null;
      if (row.chat_id !== config.chatId) { finishReply(row, "failed", "Grupa je promijenjena. Email nije poslan."); return null; }
      db.prepare("UPDATE claim_email_replies SET status = 'sending', started_at = ? WHERE id = ? AND status = 'queued'").run(Date.now(), row.id);
      return row;
    })();
    if (!job) break;
    try {
      const sent = await sendClaimEmail(job.recipient, job.reference, job.body, job.id);
      finishReply(job, "sent", null, sent.id, sent.threadId);
    } catch (error) {
      const known = error instanceof ClaimEmailSendError;
      finishReply(job, known && !error.uncertain ? "failed" : "unknown", known ? error.message : "Ishod nije potvrđen. Provjerite Poslano u Gmailu prije ponovnog odgovora.");
    }
  }

  for (let i = 0; i < 15; i++) {
    const now = Date.now();
    const job = db.prepare(`UPDATE claim_telegram_outbox SET status = 'sending', lease_until = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM claim_telegram_outbox WHERE (status = 'pending' OR (status = 'sending' AND lease_until < ?))
      AND available_at <= ? ORDER BY rowid LIMIT 1) RETURNING *`).get(now + 90_000, now, now) as TelegramJob | undefined;
    if (!job) break;
    try {
      const messageId = await sendTelegram(job);
      db.transaction(() => {
        if (!db.prepare("SELECT 1 FROM customer_return_claims WHERE id = ?").get(job.claim_id)) return;
        db.prepare("UPDATE claim_telegram_outbox SET status = 'sent', message_id = ?, last_error = NULL WHERE id = ?").run(messageId, job.id);
        db.prepare("INSERT OR IGNORE INTO claim_telegram_messages (chat_id, message_id, claim_id) VALUES (?, ?, ?)").run(job.chat_id, messageId, job.claim_id);
      })();
    } catch {
      db.prepare("UPDATE claim_telegram_outbox SET status = ?, available_at = ?, last_error = ? WHERE id = ?")
        .run(job.attempts >= 10 ? "failed" : "pending", Date.now() + Math.min(3600_000, 15_000 * 2 ** job.attempts),
          "Telegram slanje nije uspjelo. Provjerite bota i članstvo u grupi.", job.id);
    }
  }
  await pollClaimGmailReplies();
}

declare global { var galagoClaimsTimer: ReturnType<typeof setInterval> | undefined; var galagoClaimsRun: Promise<void> | undefined; }
export function kickClaimMessaging() {
  if (!globalThis.galagoClaimsRun) {
    globalThis.galagoClaimsRun = runClaimMessaging().catch(() => console.error("Claims messaging worker failed"))
      .finally(() => { globalThis.galagoClaimsRun = undefined; });
  }
  return globalThis.galagoClaimsRun;
}
export function startClaimMessagingScheduler() {
  if (globalThis.galagoClaimsTimer) return;
  void kickClaimMessaging();
  globalThis.galagoClaimsTimer = setInterval(() => void kickClaimMessaging(), 15_000);
  globalThis.galagoClaimsTimer.unref();
}

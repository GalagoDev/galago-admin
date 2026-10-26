/* eslint-disable @typescript-eslint/no-require-imports -- Standalone deployment utility. */
const fs = require("node:fs");
const filename = process.argv[2];
if (!filename) throw new Error("Usage: node scripts/configure-claim-telegram.cjs /private/claims-config.json [--drop-pending] [--test]");
const config = JSON.parse(fs.readFileSync(filename, "utf8"));
async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed (${result.error_code || response.status})`);
  return result.result;
}
(async () => {
  if (!config.enabled || !/^https:\/\//.test(config.publicUrl) || !config.allowedUserIds?.length || config.webhookSecret?.length < 32) throw Error("Invalid private configuration");
  const bot = await telegram("getMe", {});
  const chat = await telegram("getChat", { chat_id: config.chatId });
  if (!["group", "supergroup"].includes(chat.type) || chat.username) throw Error("Expected a private group");
  const url = config.publicUrl + "/api/telegram/claims";
  // Refuse to replace another integration's webhook on an accidentally selected bot.
  const previous = await telegram("getWebhookInfo", {});
  if (previous.url && previous.url !== url) throw Error("This bot already has a different webhook");
  await telegram("setWebhook", { url, secret_token: config.webhookSecret, allowed_updates: ["message"],
    drop_pending_updates: process.argv.includes("--drop-pending") });
  const status = await telegram("getWebhookInfo", {});
  if (status.url !== url) throw Error("Webhook verification failed");
  if (process.argv.includes("--test")) await telegram("sendMessage", { chat_id: config.chatId,
    text: "Galago reklamacije: Telegram povezivanje je aktivno. Nove reklamacije iz admin panela dolazit ce ovdje.\n\nGmail jos nije odobren. Dok povezivanje Gmaila ne zavrsimo, email odgovori se ne salju." });
  console.log(JSON.stringify({ bot: bot.username, group: chat.title, webhook: "configured", pendingUpdates: status.pending_update_count }));
})().catch((error) => { console.error(error.message.startsWith("Telegram ") ? error.message : "Claims bot configuration failed; inspect settings without logging secrets."); process.exitCode = 1; });

/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQLite and mocked providers. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "galago-claims-test-"));
process.env.STORAGE_DIR = tmp;
process.env.DATABASE_PATH = path.join(tmp, "data", "test.db");
const config = { enabled: true, botToken: "123456789:" + "a".repeat(35), webhookSecret: "s".repeat(40), chatId: "-100123",
  allowedUserIds: ["123"], publicUrl: "https://example.test", encryptionKey: crypto.randomBytes(32).toString("base64"),
  gmailClientId: "test-client", gmailClientSecret: "test-secret", gmailAddress: "galagodoo@gmail.com" };
fs.mkdirSync(path.join(tmp, "data"));
const configPath = path.join(tmp, "data/claims-config.json");
fs.writeFileSync(configPath, JSON.stringify(config));
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
let mailCalls = 0, sendMode = "ok", tokenMode = "ok", nonce, auth = true;
class OAuth2 {
  generateAuthUrl(options) { assert.deepEqual(options.scope, ["https://www.googleapis.com/auth/gmail.send", "openid", "email"]); return "https://accounts.google.com/o/oauth2/auth?state=" + options.state; }
  async getToken(options) { assert.ok(options.codeVerifier); return { tokens: { id_token: "id", refresh_token: "refresh-secret", scope: "https://www.googleapis.com/auth/gmail.send" } }; }
  async verifyIdToken() { return { getPayload: () => ({ email: tokenMode === "wrong-account" ? "wrong@example.test" : config.gmailAddress, email_verified: true, nonce }) }; }
  setCredentials() {}
  async getAccessToken() { if (tokenMode === "expired") throw Error("Private token must not leak"); return { token: "access" }; }
}
Module._load = function (request, parent, isMain) {
  if (request === "googleapis") return { google: { auth: { OAuth2 }, gmail: () => ({ users: { messages: { send: async (input, options) => {
    assert.equal(options.retry, false); assert.ok(input.requestBody.raw); mailCalls++;
    if (sendMode === "network") throw Error("secret-network-error");
    if (sendMode === "rejected") throw { response: { status: 403 }, message: "secret" };
    return { data: { id: "gmail-" + mailCalls } };
  } } } }) } };
  if (request === "next/server") return { after: () => {} };
  if (request === "@/lib/auth") return { requireAuth: async () => auth };
  return load.call(this, request, parent, isMain);
};
const { getDb } = require("../src/lib/db.ts");
const db = getDb();
const claims = require("../src/lib/reklamacije.ts");
const store = require("../src/lib/claim-messaging-store.ts");
const gmail = require("../src/lib/claim-gmail.ts");
const secrets = require("../src/lib/claim-messaging-config.ts");
const worker = require("../src/lib/claim-messaging-worker.ts");
const webhook = require("../src/app/api/telegram/claims/route.ts");
const connect = require("../src/app/api/reklamacije/gmail/connect/route.ts");
let telegramCalls = 0, telegramMode = "ok";
global.fetch = async (_url, options) => {
  assert.ok(options.body instanceof FormData);
  if (telegramMode === "offline") throw Error("secret-telegram-url");
  telegramCalls++;
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1000 + telegramCalls } }));
};
const input = { requestType: "Reklamacija", orderNumber: "T1", customerName: "Test kupac", email: "test@example.test", phone: "061000000",
  address: "Test", city: "Test", description: "Duga poruka ".repeat(340), companyName: "", companyIdNumber: "", companyVatNumber: "", companyAddress: "", files: [] };
const update = (n, extra = {}) => ({ update_id: n, message: { message_id: n, chat: { id: -100123, type: "group" },
  from: { id: 123, is_bot: false, first_name: "Admin" }, text: "Hvala, provjeravamo.", reply_to_message: { message_id: 1001 }, ...extra } });
const reply = (id) => db.prepare("SELECT * FROM claim_email_replies WHERE message_id = ?").get(id);

(async () => {
  const c = claims.createCustomerRequest(input);
  assert.equal(store.getClaimMessagingStatus().pending, 2, "long notification is split without losing text");
  await worker.runClaimMessaging();
  assert.equal(telegramCalls, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM claim_telegram_messages").get().n, 2);
  await worker.runClaimMessaging(); assert.equal(telegramCalls, 2);
  assert.equal(store.acceptClaimTelegramUpdate(update(1, { from: { id: 999, is_bot: false } })), "ignored");
  assert.equal(store.acceptClaimTelegramUpdate(update(2, { chat: { id: -999, type: "group" } })), "ignored");
  assert.equal(store.acceptClaimTelegramUpdate(update(3, { sender_chat: { id: -100123 } })), "ignored");
  assert.equal(store.acceptClaimTelegramUpdate(update(4, { from: { id: 123, is_bot: true } })), "ignored");
  assert.equal(store.acceptClaimTelegramUpdate(update(5, { reply_to_message: { message_id: 9999 } })), "ignored");
  assert.equal(store.acceptClaimTelegramUpdate(update(6, { reply_to_message: undefined })), "ignored");
  assert.equal(store.acceptClaimTelegramUpdate(update(7)), "not-connected");
  assert.equal(reply(7).status, "failed");
  assert.equal(store.acceptClaimTelegramUpdate(update(7)), "duplicate");
  assert.equal(store.acceptClaimTelegramUpdate(update(8, { text: undefined })), "unsupported");
  assert.equal(store.acceptClaimTelegramUpdate(update(9, { text: "/delete" })), "unsupported");

  const begin = gmail.beginClaimGmailConnection();
  const state = new URL(begin.url).searchParams.get("state");
  nonce = new URL(begin.url).searchParams.get("nonce");
  assert.ok(new URL(begin.url).searchParams.get("code_challenge"));
  await assert.rejects(gmail.finishClaimGmailConnection(state, "wrong-browser", "code"));
  await gmail.finishClaimGmailConnection(state, begin.browser, "code");
  await assert.rejects(gmail.finishClaimGmailConnection(state, begin.browser, "code"), /isteklo/);
  const token = db.prepare("SELECT encrypted_token FROM claim_gmail_connection").get().encrypted_token;
  assert.ok(!token.includes("refresh-secret")); assert.equal(secrets.decryptClaimSecret(token, config), "refresh-secret");
  assert.throws(() => secrets.decryptClaimSecret(token + "x", config));
  tokenMode = "wrong-account";
  const bad = gmail.beginClaimGmailConnection(); nonce = new URL(bad.url).searchParams.get("nonce");
  await assert.rejects(gmail.finishClaimGmailConnection(new URL(bad.url).searchParams.get("state"), bad.browser, "code"), /isključivo/);
  tokenMode = "ok";

  assert.equal(store.acceptClaimTelegramUpdate(update(10)), "queued");
  assert.equal(store.acceptClaimTelegramUpdate(update(10)), "duplicate");
  assert.equal(store.acceptClaimTelegramUpdate({ ...update(10), update_id: 11 }), "duplicate");
  await Promise.all([worker.runClaimMessaging(), worker.runClaimMessaging()]);
  assert.equal(mailCalls, 1); assert.equal(reply(10).status, "sent"); assert.equal(reply(10).recipient, input.email);
  assert.equal(reply(7).status, "failed", "pre-connection replies must not send later");
  await worker.runClaimMessaging(); assert.equal(mailCalls, 1);

  sendMode = "network"; store.acceptClaimTelegramUpdate(update(12)); await worker.runClaimMessaging();
  assert.equal(reply(12).status, "unknown"); assert.ok(!reply(12).last_error.includes("secret"));
  await worker.runClaimMessaging(); assert.equal(mailCalls, 2, "uncertain email must never auto-retry");
  sendMode = "rejected"; store.acceptClaimTelegramUpdate(update(13)); await worker.runClaimMessaging(); assert.equal(reply(13).status, "failed");
  sendMode = "ok"; tokenMode = "expired"; store.acceptClaimTelegramUpdate(update(14)); await worker.runClaimMessaging();
  assert.equal(reply(14).status, "failed"); assert.equal(mailCalls, 3, "token failure must occur before sending"); tokenMode = "ok";
  store.acceptClaimTelegramUpdate(update(15)); db.prepare("UPDATE claim_email_replies SET status='sending', started_at=0 WHERE message_id=15").run();
  await worker.runClaimMessaging(); assert.equal(reply(15).status, "unknown"); assert.equal(mailCalls, 3);

  assert.throws(() => gmail.buildClaimEmail("victim@example.test\r\nBcc: x@test.com", c.reference, "body", 1));
  const raw = Buffer.from(gmail.buildClaimEmail(input.email, c.reference, "Čćžšđ", 1), "base64url").toString();
  assert.ok(raw.includes("To: test@example.test\r\n")); assert.ok(raw.includes(Buffer.from("Čćžšđ").toString("base64").slice(0, 8)));
  assert.equal((await webhook.POST(new Request("https://example.test/api", { method: "POST", body: "{}" }))).status, 401);
  assert.equal((await webhook.POST(new Request("https://example.test/api", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "wrong" } }))).status, 401);
  assert.equal((await webhook.POST(new Request("https://example.test/api", { method: "POST", body: "bad", headers: { "x-telegram-bot-api-secret-token": config.webhookSecret } }))).status, 400);
  auth = false; assert.equal((await connect.POST(new Request("https://example.test/api", { method: "POST" }))).status, 401);
  auth = true; assert.equal((await connect.POST(new Request("https://example.test/api", { method: "POST", headers: { origin: "https://attacker.test" } }))).status, 403);

  telegramMode = "offline";
  const failed = claims.createCustomerRequest({ ...input, description: "Retry", files: [{ id: crypto.randomUUID(), storedName: "test.png", originalName: "test.png", mimeType: "image/png", sizeBytes: 3, bytes: Buffer.from("png") }] });
  await worker.runClaimMessaging(); assert.ok(store.getClaimMessagingStatus().pending > 0);
  db.prepare("UPDATE claim_telegram_outbox SET available_at = 0 WHERE status='pending'").run(); telegramMode = "ok";
  await worker.runClaimMessaging(); assert.equal(store.getClaimMessagingStatus().pending, 0);
  store.acceptClaimTelegramUpdate(update(16)); claims.deleteCustomerReturnClaim(c.id);
  await worker.runClaimMessaging(); assert.equal(mailCalls, 3, "deleted claims cannot send queued emails");
  assert.equal(store.acceptClaimTelegramUpdate(update(17)), "ignored"); claims.deleteCustomerReturnClaim(failed.id);
  fs.writeFileSync(configPath, JSON.stringify({ ...config, enabled: false }));
  claims.createCustomerRequest(input); assert.equal(store.getClaimMessagingStatus().pending, 0, "disabled integration must not queue historical backlog");
  console.log("Claims messaging: authorization, MIME, OAuth, encryption, durable queue, attachments, retries and duplicate protection passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { getDb } from "@/lib/db";
import { decryptClaimSecret, digest, encryptClaimSecret, getClaimMessagingConfig, type ClaimMessagingConfig } from "@/lib/claim-messaging-config";

export const CLAIM_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const CLAIM_OAUTH_COOKIE = "galago-claims-oauth";
export const CLAIM_OAUTH_PATH = "/api/reklamacije/gmail/callback";

function oauthClient(config: ClaimMessagingConfig) {
  if (!config.gmailClientId || !config.gmailClientSecret) throw new Error("Gmail OAuth nije konfigurisan.");
  return new google.auth.OAuth2(config.gmailClientId, config.gmailClientSecret, config.publicUrl + CLAIM_OAUTH_PATH);
}

export function beginClaimGmailConnection() {
  const config = getClaimMessagingConfig();
  if (!config) throw new Error("Povezivanje nije konfigurirano.");
  const client = oauthClient(config);
  const state = randomBytes(32).toString("base64url");
  const browser = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const db = getDb();
  db.prepare("DELETE FROM claim_oauth_states WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO claim_oauth_states (state_hash, browser_hash, nonce, verifier, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(digest(state), digest(browser), nonce, verifier, Date.now() + 600_000);
  const url = client.generateAuthUrl({
    access_type: "offline", prompt: "consent", scope: [CLAIM_GMAIL_SCOPE, "openid", "email"],
    login_hint: config.gmailAddress, state, include_granted_scopes: false,
  });
  const authUrl = new URL(url);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("code_challenge", Buffer.from(digest(verifier), "hex").toString("base64url"));
  authUrl.searchParams.set("code_challenge_method", "S256");
  return { url: authUrl.toString(), browser };
}

export async function finishClaimGmailConnection(state: string, browser: string, code: string) {
  const config = getClaimMessagingConfig();
  if (!config || !state || !browser || !code) throw new Error("Povezivanje nije potvrđeno.");
  const db = getDb();
  // Single-use state is bound to the same signed-in browser and consumed before exchange.
  const pending = db.prepare(`DELETE FROM claim_oauth_states WHERE state_hash = ? AND browser_hash = ?
    AND expires_at > ? RETURNING nonce, verifier`).get(digest(state), digest(browser), Date.now()) as { nonce: string; verifier: string } | undefined;
  if (!pending) throw new Error("Povezivanje je isteklo. Pokrenite ga ponovo.");
  const client = oauthClient(config);
  const { tokens } = await client.getToken({ code, codeVerifier: pending.verifier });
  if (!tokens.id_token || !tokens.refresh_token || !tokens.scope?.split(" ").includes(CLAIM_GMAIL_SCOPE)) {
    throw new Error("Nije odobreno trajno slanje emailova.");
  }
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.gmailClientId });
  const identity = ticket.getPayload();
  if (identity?.email !== config.gmailAddress || !identity.email_verified || identity.nonce !== pending.nonce) {
    throw new Error("Povežite isključivo galagodoo@gmail.com.");
  }
  db.prepare(`INSERT INTO claim_gmail_connection (id, email, encrypted_token) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, encrypted_token = excluded.encrypted_token, connected_at = CURRENT_TIMESTAMP`)
    .run(config.gmailAddress, encryptClaimSecret(tokens.refresh_token, config));
}

export function buildClaimEmail(recipient: string, reference: string, body: string, id: number) {
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient) ||
      !/^GAL-[A-Z0-9-]+$/.test(reference) || !Number.isSafeInteger(id) || id < 1) {
    throw new Error("Neispravna email adresa ili referenca. Email nije poslan.");
  }
  const encodedBody = Buffer.from(`${body}\n\nGalago\nReklamacija: ${reference}\n`, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  const mime = ["From: Galago <galagodoo@gmail.com>", `To: ${recipient}`, `Subject: Re: ${reference}`,
    `Message-ID: <claim-reply-${id}@galago.ba>`, `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", encodedBody].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

export class ClaimEmailSendError extends Error {
  constructor(message: string, public uncertain: boolean) { super(message); }
}

export async function sendClaimEmail(recipient: string, reference: string, body: string, id: number) {
  const config = getClaimMessagingConfig();
  const row = getDb().prepare("SELECT encrypted_token FROM claim_gmail_connection WHERE id = 1").get() as { encrypted_token: string } | undefined;
  if (!config || !row) throw new ClaimEmailSendError("Gmail nije povezan. Email nije poslan.", false);
  const raw = buildClaimEmail(recipient, reference, body, id);
  const client = oauthClient(config);
  try {
    client.setCredentials({ refresh_token: decryptClaimSecret(row.encrypted_token, config) });
    await client.getAccessToken();
  } catch {
    throw new ClaimEmailSendError("Gmail prijava nije važeća. Ponovo povežite Gmail; email nije poslan.", false);
  }
  const lease = getDb().prepare("SELECT status, started_at FROM claim_email_replies WHERE id = ?").get(id) as { status: string; started_at: number } | undefined;
  if (lease?.status !== "sending" || lease.started_at < Date.now() - 180_000) {
    throw new ClaimEmailSendError("Slanje je zaustavljeno prije predaje Gmailu.", false);
  }
  try {
    // Never automatically retry a send: a lost response can still mean the email was delivered.
    const result = await google.gmail({ version: "v1", auth: client }).users.messages.send(
      { userId: "me", requestBody: { raw } }, { timeout: 30_000, retry: false },
    );
    if (!result.data.id) throw new Error("Missing Gmail message ID");
    return result.data.id;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status && status >= 400 && status < 500) {
      throw new ClaimEmailSendError(`Gmail je odbio slanje (${status}). Email nije poslan.`, false);
    }
    throw new ClaimEmailSendError("Ishod slanja nije potvrđen. Provjerite Poslano u Gmailu prije ponovnog odgovora.", true);
  }
}

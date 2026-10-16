import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "store-admin-session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_KEY_CONTEXT = "galago-admin/session-signing/v1";

function signingKey(): Buffer | null {
  const password = process.env.APP_PASSWORD;
  return password ? createHmac("sha256", password).update(SESSION_KEY_CONTEXT).digest() : null;
}

export function verifyAppPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(createHash("sha256").update(password).digest(), createHash("sha256").update(expected).digest());
}

export function createSession(now = Date.now()): string {
  const key = signingKey();
  if (!key) throw new Error("Admin password is not configured.");
  const issued = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issued) || issued < 0) throw new Error("Invalid session time.");
  const payload = `v1.${issued}.${issued + SESSION_MAX_AGE_SECONDS}.${randomBytes(16).toString("base64url")}`;
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

export function verifySession(value: unknown, now = Date.now()): boolean {
  const key = signingKey();
  if (!key || typeof value !== "string" || value.length > 256 || !Number.isFinite(now)) return false;
  const match = /^v1\.(\d{1,12})\.(\d{1,12})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const [, issuedValue, expiresValue, , signature] = match;
  const issued = Number(issuedValue);
  const expires = Number(expiresValue);
  const current = Math.floor(now / 1000);
  if (issued > current || expires <= current || expires - issued !== SESSION_MAX_AGE_SECONDS) return false;
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== 32 || actual.toString("base64url") !== signature) return false;
  const payload = value.slice(0, value.lastIndexOf("."));
  const expected = createHmac("sha256", key).update(payload).digest();
  return timingSafeEqual(actual, expected);
}

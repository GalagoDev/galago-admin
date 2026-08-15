import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { ensureStorage } from "@/lib/storage";

const LINK_TOKEN_PATTERN = /^(\d+)\.(\d{10})\.([A-Za-z0-9_-]{43})$/;
const SECRET_FILE_NAME = "receipt-link-secret";

let cachedSecret: string | null = null;

type ReceiptLinkSource = {
  id: number;
  pdfHash: string;
  linkExpiresAt: string;
};

export type ReceiptDownload = {
  bytes: Buffer;
};

function readPersistentSecret() {
  if (cachedSecret) return cachedSecret;

  const configured = process.env.RECEIPT_LINK_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error("RECEIPT_LINK_SECRET must contain at least 32 characters.");
    cachedSecret = configured;
    return cachedSecret;
  }

  const secretPath = path.join(ensureStorage().data, SECRET_FILE_NAME);
  try {
    cachedSecret = fs.readFileSync(secretPath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const generated = crypto.randomBytes(48).toString("base64url");
    try {
      fs.writeFileSync(secretPath, generated, { encoding: "utf8", flag: "wx", mode: 0o600 });
      cachedSecret = generated;
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
      cachedSecret = fs.readFileSync(secretPath, "utf8").trim();
    }
  }

  if (!cachedSecret || cachedSecret.length < 32) throw new Error("Receipt link secret is invalid.");
  return cachedSecret;
}

function sqliteTimestampToUnix(value: string) {
  const timestamp = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", readPersistentSecret()).update(payload).digest("base64url");
}

function signaturesMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export function createReceiptDownloadPath(source: ReceiptLinkSource) {
  if (!source.id || !source.pdfHash || !source.linkExpiresAt) return "";
  const expires = sqliteTimestampToUnix(source.linkExpiresAt);
  if (!expires) return "";

  const payload = `${source.id}.${expires}.${source.pdfHash}`;
  return `/r/${source.id}.${expires}.${sign(payload)}.pdf`;
}

export function resolveReceiptDownloadToken(token: string, now = Date.now()): ReceiptDownload | null {
  const match = token.match(LINK_TOKEN_PATTERN);
  if (!match) return null;

  const recipientId = Number(match[1]);
  const expires = Number(match[2]);
  const signature = match[3];
  if (!Number.isSafeInteger(recipientId) || recipientId < 1 || expires * 1000 <= now) return null;

  const row = getDb().prepare(`
    SELECT id, pdf_stored_path, pdf_hash, link_expires_at
    FROM receipt_recipients
    WHERE id = ?
  `).get(recipientId) as {
    id: number;
    pdf_stored_path: string | null;
    pdf_hash: string | null;
    link_expires_at: string | null;
  } | undefined;
  if (!row?.pdf_stored_path || !row.pdf_hash || !row.link_expires_at) return null;

  const storedExpiry = sqliteTimestampToUnix(row.link_expires_at);
  if (storedExpiry !== expires) return null;
  const expected = sign(`${recipientId}.${expires}.${row.pdf_hash}`);
  if (!signaturesMatch(signature, expected)) return null;

  const receiptRoot = path.resolve(ensureStorage().receiptPdfs);
  const storedPath = path.resolve(row.pdf_stored_path);
  if (!storedPath.startsWith(`${receiptRoot}${path.sep}`)) return null;

  try {
    return { bytes: fs.readFileSync(storedPath) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

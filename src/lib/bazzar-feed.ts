import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureStorage } from "@/lib/storage";
import { getDb } from "@/lib/db";
import { getShopifyProductsForBazzar } from "@/lib/shopify-admin";
import { mapBazzarCatalog, renderBazzarXml } from "@/lib/bazzar-mapping";

export const BAZZAR_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "cdn-cache-control": "no-store",
  "surrogate-control": "no-store",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function getBazzarFeedToken() {
  const configured = process.env.BAZZAR_FEED_TOKEN?.trim();
  if (configured) {
    if (configured.length < 32) throw new Error("BAZZAR_FEED_TOKEN must be at least 32 characters");
    return configured;
  }
  const filename = path.join(ensureStorage().data, "bazzar-feed-secret");
  let secret: string;
  try {
    secret = fs.readFileSync(filename, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      fs.writeFileSync(filename, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
    }
    secret = fs.readFileSync(filename, "utf8").trim();
  }
  if (secret.length < 32) throw new Error("Invalid persistent Bazzar feed token");
  return secret;
}

export function verifyBazzarFeedToken(value: string | null) {
  if (!value || value.length > 512) return false;
  return timingSafeEqual(createHash("sha256").update(value).digest(), createHash("sha256").update(getBazzarFeedToken()).digest());
}

export function getBazzarFeedUrl() {
  const base = process.env.BAZZAR_FEED_BASE_URL?.trim() || "https://magenta-tarsier-949777.hostingersite.com";
  const url = new URL("/api/integrations/bazzar/feed.xml", base);
  if (url.protocol !== "https:") throw new Error("Bazzar feed URL must use HTTPS");
  url.searchParams.set("token", getBazzarFeedToken());
  return url.toString();
}

type FeedState = { last_attempt_at: string; last_success_at: string | null; last_error: string | null;
  offer_count: number; in_stock_count: number; discount_count: number; warnings_json: string; payload_hash: string | null };

export function getBazzarFeedStatus() {
  const row = getDb().prepare("SELECT last_attempt_at, last_success_at, last_error, offer_count, in_stock_count, discount_count, warnings_json, payload_hash FROM bazzar_feed_state WHERE id = 1").get() as FeedState | undefined;
  return {
    source: "wktcnu-i5.myshopify.com", currency: "BAM", marginPercent: 15, vatPercent: 17,
    enabled: process.env.BAZZAR_FEED_ENABLED?.trim().toLowerCase() !== "false",
    activation: "Bazzar must configure this URL and its twice-daily polling; generation alone does not confirm their import.",
    snapshot: row ? { ...row, warnings: JSON.parse(row.warnings_json) as string[] } : null,
  };
}

let generating: Promise<{ xml: string; generatedAt: string }> | null = null;

export async function generateBazzarFeed() {
  if (generating) return generating;
  generating = (async () => {
    const db = getDb();
    const started = new Date().toISOString();
    db.prepare(`INSERT INTO bazzar_feed_state (id, last_attempt_at) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`).run(started);
    try {
      const { offers, warnings } = mapBazzarCatalog(await getShopifyProductsForBazzar());
      const xml = renderBazzarXml(offers);
      const generatedAt = new Date().toISOString();
      db.prepare(`UPDATE bazzar_feed_state SET last_success_at = ?, last_error = NULL, offer_count = ?,
        in_stock_count = ?, discount_count = ?, warnings_json = ?, payload_hash = ? WHERE id = 1`)
        .run(generatedAt, offers.length, offers.filter((p) => p.stock > 0).length,
          offers.filter((p) => p.discountedRetailPrice).length, JSON.stringify(warnings), createHash("sha256").update(xml).digest("hex"));
      return { xml, generatedAt };
    } catch (error) {
      db.prepare("UPDATE bazzar_feed_state SET last_error = ? WHERE id = 1").run((error instanceof Error ? error.message : String(error)).slice(0, 1500));
      throw error;
    }
  })();
  try { return await generating; } finally { generating = null; }
}

import crypto from "node:crypto";
import { isAuthenticated } from "@/lib/auth";
import { syncGoogleAds } from "@/lib/ads-sync";
import { isSameOriginRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const expected = process.env.GOOGLE_ADS_SYNC_SECRET;
  const supplied = request.headers.get("x-integration-secret") || "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected || "");
  const cron = Boolean(expected && suppliedBytes.length === expectedBytes.length && crypto.timingSafeEqual(suppliedBytes, expectedBytes));
  if (!cron && !await isAuthenticated()) return Response.json({ ok: false, error: "Prijavite se za osvježavanje reklama." }, { status: 401 });
  if (!cron && !isSameOriginRequest(request)) return Response.json({ ok: false, error: "Zahtjev mora doći iz admin panela." }, { status: 403 });
  const result = await syncGoogleAds(!cron);
  return Response.json(result, { status: result.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}

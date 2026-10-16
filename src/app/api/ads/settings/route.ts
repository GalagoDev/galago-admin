import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { saveAdsSettings } from "@/lib/ads-store";
import { isSameOriginRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
const schema = z.object({
  targetRoas: z.number().min(0.1).max(1000).nullable(),
  minimumSpendBam: z.number().min(1).max(1_000_000),
  minimumClicks: z.number().int().min(1).max(100_000),
  minimumPurchases: z.number().int().min(1).max(10_000),
  attributionLagDays: z.number().int().min(1).max(30),
}).strict();

export async function POST(request: Request) {
  if (!await isAuthenticated()) return Response.json({ ok: false, error: "Prijavite se za postavke reklama." }, { status: 401 });
  if (!isSameOriginRequest(request)) return Response.json({ ok: false, error: "Zahtjev mora doći iz admin panela." }, { status: 403 });
  const result = schema.safeParse(await request.json().catch(() => null));
  if (!result.success) return Response.json({ ok: false, error: "Provjerite ciljni ROAS i pragove procjene. Kašnjenje može biti 1–30 dana." }, { status: 400 });
  saveAdsSettings(result.data);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

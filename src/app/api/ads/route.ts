import { isAuthenticated } from "@/lib/auth";
import { getAdsConnection } from "@/lib/ads-source";
import { readAdsSettings, readAdsState } from "@/lib/ads-store";
import { buildAdsPeriod, buildAdsReport } from "@/lib/ads-analytics";
import type { AdsDashboardData } from "@/lib/ads-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function accountDate(timestamp: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function readableDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}.`;
}

export async function GET(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Prijavite se za pregled reklama." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const now = new Date();
  let period;
  try {
    period = buildAdsPeriod({ kind: params.get("kind") || undefined, date: params.get("date") || undefined, from: params.get("from") || undefined, to: params.get("to") || undefined }, now);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Period nije ispravan." }, { status: 400 });
  }
  const connection = getAdsConnection();
  const settings = readAdsSettings();
  const state = connection.customerId ? readAdsState(connection.customerId) : null;
  const data: AdsDashboardData = {
    connection, settings, account: state?.snapshot?.account || null, tracking: state?.snapshot?.purchaseTracking || null,
    sync: { lastAttemptAt: state?.lastAttemptAt || null, lastSuccessAt: state?.lastSuccessAt || null, error: state?.error || null, running: state?.running || false },
    report: null,
  };
  if (state?.snapshot) {
    const snapshot = state.snapshot;
    const start = Date.parse(period.start);
    const effectiveEnd = Math.min(Date.parse(period.end), now.getTime());
    // Coverage is in the Ads account's local dates; an active workday/weekend
    // can end in the future, which must not require future downloaded data.
    const firstDate = accountDate(start, snapshot.account.timeZone);
    const lastDate = accountDate(Math.max(start, effectiveEnd - 1), snapshot.account.timeZone);
    if (firstDate < snapshot.fromDate || lastDate > snapshot.toDate) {
      return Response.json({
        error: `Odabrani period nije u cijelosti obuhvaćen preuzetim podacima. Dostupna historija: ${readableDate(snapshot.fromDate)} – ${readableDate(snapshot.toDate)} (${snapshot.account.timeZone}). Odaberi obuhvaćeni raspon ili osvježi podatke.`,
        // Preserve connection and sync controls while unknown results remain null.
        data,
      }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }
    data.report = buildAdsReport(snapshot, period, settings, now);
  }
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

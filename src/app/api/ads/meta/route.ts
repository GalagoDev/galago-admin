import { isAuthenticated } from "@/lib/auth";
import { buildAdsPeriod } from "@/lib/ads-analytics";
import { buildMetaAdsReport } from "@/lib/meta-ads-analytics";
import { fetchMetaAdsSnapshot, getMetaAdsConnection, MetaAdsSourceError } from "@/lib/meta-ads-client";
import type { MetaAdsDashboardData } from "@/lib/meta-ads-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!await isAuthenticated()) return Response.json({ error: "Prijavite se za pregled reklama." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const now = new Date();
  let period;
  try {
    period = buildAdsPeriod({
      kind: params.get("kind") || undefined, date: params.get("date") || undefined,
      from: params.get("from") || undefined, to: params.get("to") || undefined,
    }, now);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Period nije ispravan." }, { status: 400, headers });
  }
  const connection = getMetaAdsConnection();
  const data: MetaAdsDashboardData = {
    connection, period, fetchedAt: null, accounts: [], report: null, error: null,
  };
  if (connection.configured) {
    try {
      const snapshot = await fetchMetaAdsSnapshot(period, { force: params.get("refresh") === "1" }, now);
      data.report = buildMetaAdsReport(snapshot, period, now);
      data.accounts = snapshot.accounts;
      data.fetchedAt = snapshot.fetchedAt;
    } catch (error) {
      data.error = error instanceof MetaAdsSourceError ? error.message : "Meta izvještaj trenutno nije dostupan. Pokušaj ponovo.";
    }
  }
  return Response.json(data, { headers });
}

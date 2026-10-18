import { getAdsHourInstants, getAdsLocalParts } from "./ads-analytics.ts";
import type { AdsPeriod, AdsSummary } from "./ads-types.ts";
import type { MetaAdsAccount, MetaAdsEntity, MetaAdsHour, MetaAdsReport, MetaAdsSnapshot } from "./meta-ads-types.ts";

const SARAJEVO = "Europe/Sarajevo";
const HOUR_MS = 3_600_000;
const BAM_PER_EUR = 1.95583;

type Totals = {
  impressions: number; clicks: number; purchases: number; spendBam: number; revenueBam: number;
  missingPurchases: boolean; missingSpend: boolean; missingRevenue: boolean;
};
type EntityTotal = { account: MetaAdsAccount; row: MetaAdsHour; instant: number; totals: Totals };

function emptyTotals(): Totals {
  return { impressions: 0, clicks: 0, purchases: 0, spendBam: 0, revenueBam: 0, missingPurchases: false, missingSpend: false, missingRevenue: false };
}

function localDate(instant: number, zone = SARAJEVO): string {
  const parts = getAdsLocalParts(instant, zone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function validateRow(row: MetaAdsHour): void {
  if (![row.accountId, row.campaignId, row.adId].every((value) => typeof value === "string" && value.length > 0)
    || !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23
    || !Number.isInteger(row.impressions) || row.impressions < 0
    || !Number.isInteger(row.clicks) || row.clicks < 0
    || !Number.isFinite(row.spend) || row.spend < 0
    || (row.purchases !== null && (!Number.isFinite(row.purchases) || row.purchases < 0))
    || (row.purchaseValue !== null && (!Number.isFinite(row.purchaseValue) || row.purchaseValue < 0))
    || (row.bamRate !== null && (!Number.isFinite(row.bamRate) || row.bamRate <= 0))) {
    throw new Error("Meta izvještaj sadrži neispravan satni zapis ili iznos.");
  }
}

function missingPurchaseValue(row: MetaAdsHour): boolean {
  return row.purchaseValue === null || (row.purchases !== null && row.purchases > 0 && row.purchaseValue === 0);
}

function add(total: Totals, row: MetaAdsHour, account: MetaAdsAccount): void {
  total.impressions += row.impressions;
  total.clicks += row.clicks;
  if (row.purchases === null) total.missingPurchases = true;
  else total.purchases += row.purchases;
  const rate = /^[A-Z]{3}$/.test(account.currency) ? row.bamRate : null;
  if (rate === null) {
    total.missingSpend = true;
    total.missingRevenue = true;
  } else {
    total.spendBam += row.spend * rate;
    if (row.purchaseValue !== null) total.revenueBam += row.purchaseValue * rate;
  }
  if (missingPurchaseValue(row)) total.missingRevenue = true;
}

function summarize(total: Totals): AdsSummary {
  if (![total.impressions, total.clicks, total.purchases, total.spendBam, total.revenueBam].every(Number.isFinite)) {
    throw new Error("Meta zbir prelazi podržanu brojčanu preciznost.");
  }
  const spendBam = total.missingSpend ? null : total.spendBam;
  const revenueBam = total.missingRevenue ? null : total.revenueBam;
  const purchases = total.missingPurchases ? null : total.purchases;
  const ratio = (numerator: number | null, denominator: number | null): number | null => {
    if (numerator === null || denominator === null || denominator <= 0) return null;
    const value = numerator / denominator;
    return Number.isFinite(value) ? value : null;
  };
  return {
    impressions: total.impressions, clicks: total.clicks, spendBam,
    spendEur: spendBam === null ? null : spendBam / BAM_PER_EUR,
    purchases, revenueBam, roas: ratio(revenueBam, spendBam),
    ctr: ratio(total.clicks, total.impressions), cpcBam: ratio(spendBam, total.clicks), cpaBam: ratio(spendBam, purchases),
  };
}

function entity(id: string, entry: EntityTotal, kind: "campaign" | "ad"): MetaAdsEntity {
  return {
    ...summarize(entry.totals), id, accountId: entry.account.id, accountName: entry.account.name,
    name: kind === "ad" ? entry.row.adName || entry.row.adId : entry.row.campaignName || entry.row.campaignId,
    campaignName: entry.row.campaignName,
    adSetName: kind === "ad" ? entry.row.adSetName : "",
    // An ad's effective status is not evidence of its campaign's own status.
    status: kind === "ad" ? entry.row.status : null,
  };
}

function sortEntities(left: MetaAdsEntity, right: MetaAdsEntity): number {
  return (right.spendBam ?? -1) - (left.spendBam ?? -1) || left.id.localeCompare(right.id);
}

/** Aggregate the one ad-hour series; never add separate campaign or purchase-alias totals. */
export function buildMetaAdsReport(snapshot: MetaAdsSnapshot, period: AdsPeriod, now = new Date()): MetaAdsReport {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const nowMs = now.getTime();
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (![start, end, nowMs, fetchedAt].every(Number.isFinite) || end <= start || start > nowMs || fetchedAt > nowMs + 5 * 60_000) {
    throw new Error("Meta izvještaj nema ispravan period ili vrijeme preuzimanja.");
  }
  if (Date.parse(snapshot.periodStart) !== start || Date.parse(snapshot.periodEnd) !== end) {
    throw new Error("Meta podaci ne pokrivaju tačno odabrani period. Osvježite izvještaj za ovaj raspon.");
  }
  const effectiveEnd = Math.min(end, nowMs);
  const warnings = new Set(snapshot.warnings);
  if (nowMs - fetchedAt > 6 * HOUR_MS) warnings.add("Meta podaci su stariji od šest sati; prikazan je posljednji poznati učinak.");
  const accounts = new Map<string, { account: MetaAdsAccount; totals: Totals }>();
  for (const account of snapshot.accounts) {
    if (!account.id || accounts.has(account.id)) throw new Error("Meta izvještaj sadrži neispravan ili ponovljen račun.");
    try { getAdsLocalParts(start, account.timeZone); }
    catch { throw new Error("Vremenska zona Meta računa nije podržana."); }
    accounts.set(account.id, { account, totals: emptyTotals() });
  }
  if (!accounts.size) throw new Error("Meta izvještaj nema potvrđen račun.");
  const total = emptyTotals();
  const campaignTotals = new Map<string, EntityTotal>();
  const adTotals = new Map<string, EntityTotal>();
  const timeline = new Map<string, Totals>();
  const lastDate = localDate(Math.max(start, effectiveEnd - 1));
  for (let date = localDate(start); date <= lastDate; date = nextDate(date)) timeline.set(date, emptyTotals());
  const seen = new Set<string>();
  const hours = new Map<string, number[]>();

  for (const row of snapshot.hours) {
    validateRow(row);
    const entry = accounts.get(row.accountId);
    if (!entry) throw new Error("Meta satni zapis pripada računu koji nedostaje u izvještaju.");
    const { account } = entry;
    const duplicateKey = JSON.stringify([row.accountId, row.campaignId, row.adId, row.date, row.hour]);
    if (seen.has(duplicateKey)) throw new Error("Meta izvještaj sadrži dupliran sat oglasa; zbir nije prikazan.");
    seen.add(duplicateKey);
    const hourKey = JSON.stringify([account.timeZone, row.date, row.hour]);
    let instants = hours.get(hourKey);
    if (!instants) {
      try { instants = getAdsHourInstants(row.date, row.hour, account.timeZone); }
      catch { throw new Error("Meta izvještaj sadrži neispravan datum sata."); }
      hours.set(hourKey, instants);
    }
    if (!instants.length) {
      warnings.add("Meta sat koji ne postoji zbog promjene vremena izostavljen je iz zbira.");
      continue;
    }
    if (instants[0] >= effectiveEnd || instants.every((instant) => instant + HOUR_MS <= start || instant >= end)) continue;
    // A current hour may be unfinished. A requested period boundary, however,
    // must include the whole local bucket, including both repeated DST hours.
    if (instants.some((instant) => instant < start || instant + HOUR_MS > end)) {
      warnings.add("Meta satni segmenti koji djelimično prelaze granicu perioda izostavljeni su; zbir je nepotpun zbog vremenskih zona.");
      continue;
    }
    const dates = new Set(instants.map((instant) => localDate(instant)));
    if (dates.size !== 1) {
      warnings.add("Ponovljeni Meta sat prelazi granicu Sarajevo datuma; segment je izostavljen jer dnevna raspodjela nije poznata.");
      continue;
    }
    if (row.bamRate === null || !/^[A-Z]{3}$/.test(account.currency)) warnings.add("Nedostaje kurs za dio Meta podataka; zahvaćeni novčani zbir i ROAS nisu poznati.");
    if (row.purchases === null) warnings.add("Broj Meta kupovina nedostaje u dijelu podataka; zahvaćeni zbir kupovina nije poznat.");
    if (missingPurchaseValue(row)) warnings.add("Vrijednost Meta kupovina nedostaje u dijelu podataka; zahvaćeni prihod i ROAS nisu poznati.");
    add(total, row, account);
    add(entry.totals, row, account);
    const campaignId = `${row.accountId}/${row.campaignId}`;
    const adId = `${campaignId}/${row.adId}`;
    for (const [map, key] of [[campaignTotals, campaignId], [adTotals, adId]] as const) {
      const value = map.get(key) ?? { account, row, instant: instants[0], totals: emptyTotals() };
      if (instants[0] >= value.instant) { value.row = row; value.instant = instants[0]; }
      add(value.totals, row, account);
      map.set(key, value);
    }
    const date = [...dates][0];
    const day = timeline.get(date) ?? emptyTotals();
    add(day, row, account);
    timeline.set(date, day);
  }

  return {
    period, summary: summarize(total),
    accounts: [...accounts.values()].map(({ account, totals }) => ({
      ...summarize(totals), id: account.id, accountId: account.id, accountName: account.name,
      name: account.name, campaignName: "", adSetName: "", status: null,
    })).sort(sortEntities),
    campaigns: [...campaignTotals.entries()].map(([id, entry]) => entity(id, entry, "campaign")).sort(sortEntities),
    ads: [...adTotals.entries()].map(([id, entry]) => entity(id, entry, "ad")).sort(sortEntities),
    timeline: [...timeline.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, totals]) => ({ date, ...summarize(totals) })),
    attribution: snapshot.attribution, warnings: [...warnings],
  };
}

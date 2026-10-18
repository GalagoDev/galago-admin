import "server-only";
import { createHash } from "node:crypto";
import type { AdsPeriod } from "./ads-types";
import type { MetaAdsAccount, MetaAdsDashboardData, MetaAdsHour, MetaAdsSnapshot } from "./meta-ads-types";

const WEBSITE_PURCHASE = "offsite_conversion.fb_pixel_purchase";
const TIMEOUT_MS = 120_000;
const CACHE_MS = 5 * 60_000;
const COOLDOWN_MS = 60_000;
const MAX_PAGES = 200;
const MAX_ROWS = 100_000;
const EUR_BAM = 1.95583;
const caches = new Map<string, { until: number; snapshot: MetaAdsSnapshot }>();
const flights = new Map<string, Promise<MetaAdsSnapshot>>();
const attempts = new Map<string, number>();

/** Only controlled messages may cross the API boundary. */
export class MetaAdsSourceError extends Error {}
const invalid = () => new MetaAdsSourceError("Meta je vratio nepotpune podatke. Izvještaj nije prikazan.");
const timeout = () => new MetaAdsSourceError("Meta izvještaj nije završen u roku od 120 sekundi. Pokušajte ponovo.");
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Json;
}
function text(value: unknown, maximum = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw invalid();
  return value;
}
function number(value: unknown): number {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value))) throw invalid();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw invalid();
  return parsed;
}
function id(value: unknown) { const result = text(value, 40); if (!/^\d+$/.test(result)) throw invalid(); return result; }
function dateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (kind: string) => parts.find(part => part.type === kind)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function configuration() {
  const token = (process.env.META_ADS_ACCESS_TOKEN || "").trim();
  const rawIds = (process.env.META_REPORT_AD_ACCOUNT_IDS || process.env.META_AD_ACCOUNT_IDS || "").trim();
  const ids = [...new Set(rawIds.split(",").map(value => value.trim().replace(/^act_/, "")))].sort();
  const validIds = ids.length > 0 && ids.length <= 10 && ids.every(value => /^\d{5,30}$/.test(value));
  const version = (process.env.META_GRAPH_API_VERSION || "v25.0").trim();
  const missing: string[] = [];
  if (!token) missing.push("Meta token za čitanje oglasa");
  if (!validIds) missing.push("Ispravan ID Meta oglasnog računa");
  if (!/^v\d{1,3}\.\d+$/.test(version)) missing.push("Ispravna Meta API verzija");
  const ratesConfig = process.env.META_ADS_TO_BAM_RATES_JSON || "";
  const key = createHash("sha256").update(JSON.stringify([token, ids, version, ratesConfig])).digest("hex");
  return { token, ids: validIds ? ids : [], version, missing, key, ratesConfig };
}
export function getMetaAdsConnection(): MetaAdsDashboardData["connection"] {
  const config = configuration();
  return { configured: config.missing.length === 0, accountIds: config.ids, missing: config.missing };
}

type Budget = { signal: AbortSignal; check: () => void };
async function request(url: URL, token: string | null, budget: Budget, fx = false): Promise<Json> {
  budget.check();
  const response = await fetch(url.toString(), {
    method: "GET", cache: "no-store", redirect: "error",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.any([budget.signal, AbortSignal.timeout(fx ? 5_000 : 30_000)]),
  });
  const payload = object(await response.json());
  budget.check();
  if (!response.ok || payload.error) {
    if (payload.error && !fx) {
      const code = object(payload.error).code;
      if (code === 190) throw new MetaAdsSourceError("Meta pristup je istekao ili nije važeći. Potrebno je obnoviti postojeći token.");
      if (code === 10 || code === 200) throw new MetaAdsSourceError("Meta račun nije dostupan postojećem tokenu. Provjerite pristup ads_read.");
    }
    throw new MetaAdsSourceError("Meta izvještaj trenutno nije dostupan. Pokušajte ponovo.");
  }
  return payload;
}
async function graphPages(accountId: string, params: Record<string, string>, config: ReturnType<typeof configuration>, budget: Budget): Promise<Json[]> {
  const rows: Json[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`https://graph.facebook.com/${config.version}/act_${accountId}/insights`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    if (after) url.searchParams.set("after", after);
    const payload = await request(url, config.token, budget);
    if (!Array.isArray(payload.data)) throw invalid();
    rows.push(...payload.data.map(object));
    if (rows.length > MAX_ROWS) throw new MetaAdsSourceError("Meta izvještaj je prevelik. Odaberite kraći period.");
    if (!payload.paging) return rows;
    const paging = object(payload.paging);
    if (!paging.next) return rows;
    // Never follow the upstream URL (which may also contain a token).
    const next = text(paging.next, 20_000);
    const nextUrl = new URL(next);
    // Meta can upgrade an older configured API version in its paging link.
    // Only the version segment may differ; requests still use our fixed URL.
    if (nextUrl.origin !== "https://graph.facebook.com" || !new RegExp(`^/v\\d{1,3}\\.\\d+/act_${accountId}/insights$`).test(nextUrl.pathname) || nextUrl.username || nextUrl.password) throw invalid();
    const cursor = text(object(paging.cursors).after, 4_000);
    if (cursors.has(cursor) || !payload.data.length) throw invalid();
    cursors.add(cursor);
    after = cursor;
  }
  throw new MetaAdsSourceError("Meta izvještaj je prevelik. Odaberite kraći period.");
}
function actionMetric(value: unknown, action: string): number | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw invalid();
  const matches = value.map(object).filter(row => row.action_type === action);
  if (matches.length > 1) throw invalid();
  return matches.length ? number(matches[0].value) : null;
}
function purchaseMetrics(row: Json) {
  const count = actionMetric(row.actions, WEBSITE_PURCHASE);
  const value = actionMetric(row.action_values, WEBSITE_PURCHASE);
  // Meta omits zero action arrays. A reported purchase without a value is unknown revenue.
  return { purchases: count ?? (value ? null : 0), purchaseValue: count && !value ? null : (value ?? 0) };
}
function overrideRates(raw: string): Record<string, number> {
  const rates: Record<string, number> = { BAM: 1, EUR: EUR_BAM };
  if (!raw) return rates;
  try {
    const parsed = object(JSON.parse(raw));
    for (const [key, value] of Object.entries(parsed)) {
      if (/^[A-Z]{3}$/.test(key) && key !== "BAM" && key !== "EUR") rates[key] = number(value);
      if (rates[key] === 0) delete rates[key];
    }
  } catch { /* Invalid optional overrides never invent a conversion. */ }
  return rates;
}
async function fetchSnapshot(period: AdsPeriod, now: Date, config: ReturnType<typeof configuration>): Promise<MetaAdsSnapshot> {
  const start = new Date(period.start);
  const end = new Date(period.end);
  if (![start, end, now].every(value => Number.isFinite(value.getTime())) || start >= end || start >= now || end.getTime() - start.getTime() > 91 * 86_400_000) {
    throw new MetaAdsSourceError("Odabrani Meta period nije ispravan ili je duži od 90 dana.");
  }
  const effectiveEnd = new Date(Math.min(end.getTime(), now.getTime()));
  const deadline = Date.now() + TIMEOUT_MS;
  const controller = new AbortController();
  const budget: Budget = { signal: controller.signal, check: () => { if (Date.now() >= deadline || controller.signal.aborted) throw timeout(); } };
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(timeout()); }, TIMEOUT_MS); });
  const work = async (): Promise<MetaAdsSnapshot> => {
    const accounts: MetaAdsAccount[] = [];
    const hours: MetaAdsHour[] = [];
    const warnings = new Set<string>();
    const rates = overrideRates(config.ratesConfig);
    const rateCache = new Map<string, number | null>();
    let otherPurchases = false;
    for (const accountId of config.ids) {
      const metadataUrl = new URL(`https://graph.facebook.com/${config.version}/act_${accountId}`);
      metadataUrl.searchParams.set("fields", "id,name,currency,timezone_name");
      const meta = await request(metadataUrl, config.token, budget);
      if (meta.id !== `act_${accountId}`) throw invalid();
      const account: MetaAdsAccount = { id: accountId, name: text(meta.name), currency: text(meta.currency, 3), timeZone: text(meta.timezone_name, 100) };
      if (!/^[A-Z]{3}$/.test(account.currency)) throw invalid();
      try { new Intl.DateTimeFormat("en", { timeZone: account.timeZone }).format(now); } catch { throw invalid(); }
      accounts.push(account);
      const since = dateKey(start, account.timeZone);
      const until = dateKey(new Date(effectiveEnd.getTime() - 1), account.timeZone);
      const params = {
        fields: "account_id,account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,impressions,clicks,actions,action_values",
        level: "ad", time_increment: "1", time_range: JSON.stringify({ since, until }),
        action_report_time: "conversion", use_unified_attribution_setting: "true", limit: "500",
        breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
      };
      const rows = await graphPages(accountId, params, config, budget);
      const seen = new Set<string>();
      const dates = new Set<string>();
      for (const row of rows) {
        if (row.account_id !== accountId || row.account_currency !== account.currency) throw invalid();
        const date = text(row.date_start, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date < since || date > until || row.date_stop !== date) throw invalid();
        const match = text(row.hourly_stats_aggregated_by_advertiser_time_zone, 30).match(/^(\d{2}):00:00 - (\d{2}):59:59$/);
        if (!match || match[1] !== match[2] || Number(match[1]) > 23) throw invalid();
        const adId = id(row.ad_id);
        const key = `${adId}|${date}|${match[1]}`;
        if (seen.has(key)) throw invalid();
        seen.add(key); dates.add(date);
        const purchases = purchaseMetrics(row);
        if ((actionMetric(row.actions, "omni_purchase") ?? 0) > (purchases.purchases ?? 0)) otherPurchases = true;
        hours.push({
          accountId, campaignId: id(row.campaign_id), campaignName: text(row.campaign_name),
          adSetId: id(row.adset_id), adSetName: text(row.adset_name), adId, adName: text(row.ad_name), status: null,
          date, hour: Number(match[1]), impressions: number(row.impressions), clicks: number(row.clicks), spend: number(row.spend),
          ...purchases, purchaseActionType: WEBSITE_PURCHASE, bamRate: rates[account.currency] ?? null,
        });
      }
      if (hours.length > MAX_ROWS) throw new MetaAdsSourceError("Meta izvještaj je prevelik. Odaberite kraći period.");
      // A disabled/unavailable hourly breakdown can otherwise look like zero delivery.
      const daily = await graphPages(accountId, {
        fields: "account_id,date_start,date_stop,spend,impressions,clicks,actions,action_values", level: "account", time_increment: "1",
        time_range: JSON.stringify({ since, until }), action_report_time: "conversion", use_unified_attribution_setting: "true", limit: "500",
      }, config, budget);
      for (const row of daily) {
        if (row.account_id !== accountId || typeof row.date_start !== "string" || row.date_start < since || row.date_start > until || row.date_stop !== row.date_start) throw invalid();
        if (!dates.has(row.date_start) && (number(row.spend) > 0 || number(row.impressions) > 0 || number(row.clicks) > 0 || (purchaseMetrics(row).purchases ?? 0) > 0 || (purchaseMetrics(row).purchaseValue ?? 0) > 0)) {
          throw new MetaAdsSourceError("Meta satni podaci nisu dostupni za cijeli period. Nije moguće tačno prikazati period 08–08.");
        }
      }
    }
    const pairs = [...new Set(hours.filter(hour => hour.bamRate === null).map(hour => `${accounts.find(account => account.id === hour.accountId)!.currency}|${hour.date}`))];
    // Small groups keep FX requests bounded without making a month take one timeout per day.
    for (let offset = 0; offset < pairs.length; offset += 5) {
      await Promise.all(pairs.slice(offset, offset + 5).map(async pair => {
        const [currency, date] = pair.split("|");
        try {
          const payload = await request(new URL(`https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/eur?date=${date}`), null, budget, true);
          const rateDate = typeof payload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? new Date(`${payload.date}T00:00:00Z`) : null;
          const age = rateDate ? new Date(`${date}T00:00:00Z`).getTime() - rateDate.getTime() : NaN;
          if (payload.base !== currency || payload.quote !== "EUR" || !rateDate || !Number.isFinite(age) || rateDate.toISOString().slice(0, 10) !== payload.date || age < 0 || age > 7 * 86_400_000) throw invalid();
          const rate = number(payload.rate);
          rateCache.set(pair, rate > 0 ? rate * EUR_BAM : null);
        } catch { budget.check(); rateCache.set(pair, null); }
      }));
    }
    for (const hour of hours) {
      if (hour.bamRate === null) {
        const currency = accounts.find(account => account.id === hour.accountId)!.currency;
        hour.bamRate = rateCache.get(`${currency}|${hour.date}`) ?? null;
      }
    }
    if (otherPurchases) warnings.add("Meta bilježi i druge vrste kupovina; njihove vrijednosti nisu uključene u web promet.");
    budget.check();
    return { fetchedAt: new Date().toISOString(), periodStart: start.toISOString(), periodEnd: end.toISOString(), accounts, hours,
      attribution: "Web kupovine · atribucija po Meta skupu oglasa", warnings: [...warnings] };
  };
  try { return await Promise.race([work(), limit]); }
  catch (error) {
    controller.abort();
    if (error instanceof MetaAdsSourceError) throw error;
    if (Date.now() >= deadline) throw timeout();
    throw new MetaAdsSourceError("Meta izvještaj trenutno nije dostupan. Pokušajte ponovo.");
  } finally { clearTimeout(timer!); }
}

export async function fetchMetaAdsSnapshot(period: AdsPeriod, options: { force?: boolean } = {}, now = new Date()): Promise<MetaAdsSnapshot> {
  const config = configuration();
  if (config.missing.length) throw new MetaAdsSourceError("Meta Ads nije povezan. Provjerite postojeći token i ID oglasnog računa.");
  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  const key = `${config.key}|${start}|${end}`;
  const flight = flights.get(key);
  if (flight) return structuredClone(await flight);
  const cached = caches.get(key);
  if (!options.force && cached && cached.until > Date.now()) return structuredClone(cached.snapshot);
  if (options.force && Date.now() - (attempts.get(config.key) ?? -Infinity) < COOLDOWN_MS) {
    if (cached && cached.until > Date.now()) return structuredClone(cached.snapshot);
    throw new MetaAdsSourceError("Meta podaci su nedavno osvježeni. Sačekajte 60 sekundi prije novog osvježavanja.");
  }
  attempts.set(config.key, Date.now());
  const pending = fetchSnapshot(period, now, config);
  flights.set(key, pending);
  try {
    const snapshot = await pending;
    caches.set(key, { until: Date.now() + CACHE_MS, snapshot });
    while (caches.size > 30) caches.delete(caches.keys().next().value!);
    while (attempts.size > 30) attempts.delete(attempts.keys().next().value!);
    return structuredClone(snapshot);
  } finally { flights.delete(key); }
}

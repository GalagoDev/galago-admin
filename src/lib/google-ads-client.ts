import "server-only";

import { google } from "googleapis";
import { getGoogleServiceAccountCredentials } from "@/lib/google-auth";
import type { AdsAdDay, AdsCampaignHour, AdsDashboardData, AdsSnapshot } from "@/lib/ads-types";

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const API_VERSION = "v26";
const SYNC_BUDGET_MS = 4 * 60_000;
const SYNC_TIMEOUT_MESSAGE = "Google Ads sinhronizacija je prekoračila četiri minute. Posljednji uspješni podaci su sačuvani.";
type SyncBudget = { deadline: number; signal: AbortSignal };

function remainingMs(budget: SyncBudget): number {
  const remaining = budget.deadline - Date.now();
  if (budget.signal.aborted || remaining <= 0) throw new Error(SYNC_TIMEOUT_MESSAGE);
  return remaining;
}
type Row = {
  customer?: { id?: string; descriptiveName?: string; currencyCode?: string; timeZone?: string };
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  adGroup?: { id?: string; name?: string; status?: string };
  adGroupAd?: { status?: string; ad?: { id?: string; name?: string; type?: string } };
  segments?: { date?: string; hour?: number; conversionAction?: string };
  metrics?: { impressions?: string | number; clicks?: string | number; costMicros?: string | number; conversions?: number; conversionsValue?: number };
  conversionAction?: {
    resourceName?: string;
    name?: string;
    status?: string;
    primaryForGoal?: boolean;
    valueSettings?: { alwaysUseDefaultValue?: boolean; defaultValue?: number; defaultCurrencyCode?: string };
  };
};

export function getAdsConnection(): AdsDashboardData["connection"] {
  const rawId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/[\s-]/g, "") || "";
  const customerId = /^\d{10}$/.test(rawId) ? rawId : null;
  const oauth = Boolean(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_REFRESH_TOKEN);
  const serviceAccount = Boolean(process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const credentialMode = oauth ? "oauth" : serviceAccount ? "service-account" : null;
  const missing = [!customerId ? "Google Ads ID računa" : "", !credentialMode ? "Google pristup za aplikaciju" : ""].filter(Boolean);
  return { source: "api", configured: missing.length === 0, customerId, credentialMode, missing };
}

function credentials() {
  const value = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON?.trim();
  if (!value) return getGoogleServiceAccountCredentials();
  const parsed = JSON.parse(value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8"));
  if (typeof parsed.private_key === "string") parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function accessToken(budget: SyncBudget) {
  const connection = getAdsConnection();
  if (!connection.configured) throw new Error("Google Ads povezivanje još nije podešeno.");
  try {
    // The same cancellation reaches OAuth/JWT token exchange and all report pages.
    const transporterOptions = { signal: budget.signal, timeout: remainingMs(budget), retry: false };
    if (connection.credentialMode === "oauth") {
      const auth = new google.auth.OAuth2({ clientId: process.env.GOOGLE_ADS_CLIENT_ID, clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET, transporterOptions });
      auth.setCredentials({ refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN });
      const result = await auth.getAccessToken();
      if (!result.token) throw new Error("Missing token");
      return result.token;
    }
    const account = credentials();
    if (!account.client_email || !account.private_key) throw new Error("Incomplete credentials");
    const auth = new google.auth.JWT({ email: account.client_email, key: account.private_key, scopes: [ADS_SCOPE], transporterOptions });
    const result = await auth.getAccessToken();
    if (!result.token) throw new Error("Missing token");
    return result.token;
  } catch {
    remainingMs(budget);
    throw new Error("Google prijava nije uspjela. Provjerite serverske pristupne podatke i ovlaštenje za Google Ads.");
  }
}

function apiError(payload: unknown, status: number) {
  const detail = JSON.stringify(payload);
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|DEVELOPER_TOKEN_NOT_APPROVED/.test(detail)) return "Google Cloud projekt još nema produkcijski Google Ads API pristup. Potreban je Explorer ili viši nivo.";
  if (/SERVICE_DISABLED|API_DISABLED/.test(detail)) return "Google Ads API nije omogućen u Google Cloud projektu aplikacije.";
  if (/USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND|AUTHORIZATION_ERROR/.test(detail) || status === 403) return "Aplikacija nema pristup Google Ads računu. Provjerite ID računa, pristup Read-only i odobrenje Cloud projekta.";
  if (/CUSTOMER_NOT_ENABLED/.test(detail)) return "Google Ads račun trenutno nije dostupan za izvještavanje. Provjerite status računa u Google Ads.";
  if (status === 401) return "Google ovlaštenje je isteklo ili povučeno. Ponovo povežite račun.";
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(detail)) return "Dostignuto je Google Ads API ograničenje. Ponovna sinhronizacija će pokušati kasnije.";
  if (status >= 500) return "Google Ads trenutno ne odgovara. Posljednji uspješni podaci su sačuvani.";
  return `Google Ads izvještaj nije preuzet (HTTP ${status}). Provjerite API pristup i podržanu verziju.`;
}

/** Only the reporting search endpoint is exposed; this client cannot mutate ads. */
async function search(customerId: string, token: string, query: string, budget: SyncBudget): Promise<Row[]> {
  const rows: Row[] = [];
  let pageToken: string | undefined;
  const loginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/[\s-]/g, "");
  if (loginId && !/^\d{10}$/.test(loginId)) throw new Error("ID Google Ads upravljačkog računa nije ispravan.");
  for (let page = 0; page < 25; page += 1) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(loginId ? { "login-customer-id": loginId } : {}) },
          body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
          cache: "no-store",
          signal: AbortSignal.any([budget.signal, AbortSignal.timeout(Math.min(40_000, remainingMs(budget)))]),
        });
      } catch {
        remainingMs(budget);
        throw new Error("Google Ads veza je prekinuta ili je zahtjev istekao. Posljednji uspješni podaci su sačuvani.");
      }
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 2) break;
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (attempt + 1), remainingMs(budget))));
    }
    remainingMs(budget);
    if (!response) throw new Error("Google Ads nije odgovorio.");
    const payload = await response.json().catch(() => null) as { results?: Row[]; nextPageToken?: string } | null;
    remainingMs(budget);
    if (!response.ok) throw new Error(apiError(payload, response.status));
    if (!payload || (payload.results !== undefined && !Array.isArray(payload.results))) throw new Error("Google Ads je vratio neispravan izvještaj.");
    rows.push(...(payload.results || []));
    pageToken = payload.nextPageToken;
    if (!pageToken) return rows;
  }
  throw new Error("Izvještaj je prevelik za potpuno preuzimanje. Prethodni potpuni podaci ostaju sačuvani.");
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error("Google Ads je vratio neispravnu vrijednost metrike.");
  return parsed;
}

function metrics(row: Row) {
  return { impressions: numeric(row.metrics?.impressions), clicks: numeric(row.metrics?.clicks), cost: numeric(row.metrics?.costMicros) / 1_000_000, purchases: numeric(row.metrics?.conversions), purchaseValue: numeric(row.metrics?.conversionsValue) };
}

function campaignHour(row: Row): AdsCampaignHour {
  if (!row.campaign?.id || !row.segments?.date) throw new Error("Google Ads izvještaju nedostaje kampanja ili datum.");
  return { ...metrics(row), date: row.segments.date, hour: numeric(row.segments.hour), campaignId: row.campaign.id, campaignName: row.campaign.name || `Kampanja ${row.campaign.id}`, status: row.campaign.status || "UNKNOWN", channel: row.campaign.advertisingChannelType || "UNKNOWN" };
}

function effectiveAdStatus(row: Row): string {
  const statuses = [row.campaign?.status, row.adGroup?.status, row.adGroupAd?.status];
  if (statuses.includes("REMOVED")) return "REMOVED";
  if (statuses.includes("PAUSED")) return "PAUSED";
  return row.adGroupAd?.status || "UNKNOWN";
}

function adDay(row: Row): AdsAdDay {
  const ad = row.adGroupAd?.ad;
  if (!ad?.id || !row.campaign?.id || !row.adGroup?.id || !row.segments?.date) throw new Error("Google Ads izvještaju nedostaju podaci oglasa.");
  return { ...metrics(row), date: row.segments.date, campaignId: row.campaign.id, campaignName: row.campaign.name || `Kampanja ${row.campaign.id}`, adGroupId: row.adGroup.id, adGroupName: row.adGroup.name || `Grupa ${row.adGroup.id}`, adId: ad.id, adName: ad.name || `Oglas ${ad.id}`, status: effectiveAdStatus(row), adType: ad.type || "UNKNOWN" };
}

function mergePurchases<T extends AdsCampaignHour | AdsAdDay>(base: T[], purchaseRows: T[], key: (row: T) => string) {
  const merged = new Map(base.map((row) => [key(row), row]));
  for (const row of purchaseRows) {
    const current = merged.get(key(row));
    if (current) {
      current.purchases += row.purchases;
      current.purchaseValue += row.purchaseValue;
    } else merged.set(key(row), row);
  }
  return [...merged.values()];
}

function revenueValidFrom(): string | undefined {
  const value = process.env.GOOGLE_ADS_REVENUE_VALID_FROM?.trim();
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error("Datum početka pouzdanog prihoda Google Ads mora biti ispravan datum YYYY-MM-DD.");
  }
  return value;
}

function purchaseTracking(actionRows: Row[], purchaseRows: Row[], validFrom?: string): AdsSnapshot["purchaseTracking"] {
  // Custom goals can include secondary actions. Audit every contributing action,
  // as well as active primary actions, before treating conversion value as sales.
  const observedRows = purchaseRows.filter((row) => numeric(row.metrics?.conversions) !== 0 || numeric(row.metrics?.conversionsValue) !== 0);
  const observedActions = new Set(observedRows.map((row) => row.segments?.conversionAction));
  const knownActions = actionRows.flatMap((row) => row.conversionAction ? [row.conversionAction] : []);
  const relevant = knownActions.filter((action) => (action.primaryForGoal === true && action.status === "ENABLED") || (action.resourceName !== undefined && observedActions.has(action.resourceName)));
  const observedComplete = observedRows.every((row) => row.segments?.conversionAction && knownActions.some((action) => action.resourceName === row.segments?.conversionAction));
  return {
    configured: relevant.length > 0 || observedRows.length > 0,
    actions: relevant.map((action) => action.name || "Kupovina"),
    // Optional protobuf fields may be absent. An absent boolean is unverified.
    valueSettingsChecked: relevant.length > 0 && observedComplete && relevant.every((action) => typeof action.valueSettings?.alwaysUseDefaultValue === "boolean"),
    fixedValueActions: relevant.filter((action) => action.valueSettings?.alwaysUseDefaultValue === true).map((action) => action.name || "Kupovina"),
    ...(validFrom ? { revenueValidFrom: validFrom } : {}),
  };
}

export async function fetchGoogleAdsSnapshot(now = new Date()): Promise<AdsSnapshot> {
  const { customerId } = getAdsConnection();
  if (!customerId) throw new Error("Google Ads ID računa nije podešen.");
  const validFrom = revenueValidFrom();
  const budget: SyncBudget = { deadline: Date.now() + SYNC_BUDGET_MS, signal: AbortSignal.timeout(SYNC_BUDGET_MS) };
  const token = await accessToken(budget);
  const customerRows = await search(customerId, token, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer", budget);
  const customer = customerRows[0]?.customer;
  if (!customer?.currencyCode || !customer.timeZone || customer.id !== customerId) throw new Error("Nije moguće potvrditi valutu i vremensku zonu Google Ads računa.");
  const toDate = new Intl.DateTimeFormat("en-CA", { timeZone: customer.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const fromDate = new Date(Date.parse(`${toDate}T12:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const dates = `segments.date BETWEEN '${fromDate}' AND '${toDate}'`;
  const campaignFields = "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, segments.hour";
  const adFields = "campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, segments.date";
  const costFields = "metrics.impressions, metrics.clicks, metrics.cost_micros";
  const purchaseFields = "segments.conversion_action, segments.conversion_action_category, metrics.conversions, metrics.conversions_value";
  // Cost metrics cannot be segmented by conversion category. Keep these requests separate.
  const requests = await Promise.allSettled([
    search(customerId, token, `SELECT ${campaignFields}, ${costFields} FROM campaign WHERE ${dates} AND campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')`, budget),
    search(customerId, token, `SELECT ${campaignFields}, ${purchaseFields} FROM campaign WHERE ${dates} AND segments.conversion_action_category = 'PURCHASE' AND campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')`, budget),
    search(customerId, token, `SELECT ${adFields}, ${costFields} FROM ad_group_ad WHERE ${dates} AND ad_group_ad.status IN ('ENABLED', 'PAUSED', 'REMOVED')`, budget),
    search(customerId, token, `SELECT ${adFields}, ${purchaseFields} FROM ad_group_ad WHERE ${dates} AND segments.conversion_action_category = 'PURCHASE' AND ad_group_ad.status IN ('ENABLED', 'PAUSED', 'REMOVED')`, budget),
    search(customerId, token, "SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.primary_for_goal, conversion_action.value_settings.always_use_default_value, conversion_action.value_settings.default_value, conversion_action.value_settings.default_currency_code FROM conversion_action WHERE conversion_action.category = 'PURCHASE'", budget),
  ]);
  remainingMs(budget);
  const results = requests.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const campaigns = mergePurchases(results[0].map(campaignHour), results[1].map(campaignHour), (row) => `${row.campaignId}/${row.date}/${row.hour}`);
  const ads = mergePurchases(results[2].map(adDay), results[3].map(adDay), (row) => `${row.adGroupId}/${row.adId}/${row.date}`);
  return {
    account: { id: customerId, name: customer.descriptiveName || "Google Ads", currency: customer.currencyCode, timeZone: customer.timeZone },
    fetchedAt: new Date().toISOString(), fromDate, toDate, campaigns, ads,
    purchaseTracking: purchaseTracking(results[4], [...results[1], ...results[3]], validFrom),
  };
}

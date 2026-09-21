import "server-only";

type MetaInsight = {
  account_id?: string;
  account_name?: string;
  spend?: string;
};

type MetaAccount = {
  id?: string;
  name?: string;
  currency?: string;
};

type MetaAccountSpend = {
  accountId: string;
  accountName: string;
  currency: string;
  spend: number;
  spendBam: number | null;
};

export type MetaSpendResult = {
  configured: boolean;
  complete: boolean;
  spendBam: number | null;
  accounts: MetaAccountSpend[];
  error: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const EUR_TO_BAM = 1.95583;
const cache = new Map<string, { expiresAt: number; value: MetaSpendResult }>();

function sarajevoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function insightsDateKey(requestedDateKey: string) {
  const today = sarajevoDateKey();
  return requestedDateKey > today ? today : requestedDateKey;
}

function currencyRates() {
  const rates: Record<string, number> = { BAM: 1, KM: 1, EUR: EUR_TO_BAM };
  try {
    const configured = JSON.parse(process.env.META_ADS_TO_BAM_RATES_JSON || "{}") as Record<string, unknown>;
    for (const [currency, value] of Object.entries(configured)) {
      const rate = Number(value);
      if (Number.isFinite(rate) && rate > 0) rates[currency.toUpperCase()] = rate;
    }
  } catch {
    // Invalid optional rates are reported as missing currencies below.
  }
  return rates;
}

async function rateToBam(currency: string, dateKey: string, rates: Record<string, number>) {
  if (rates[currency]) return rates[currency];
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/eur?date=${dateKey}`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) },
    );
    const payload = await response.json() as { rate?: number };
    const rateToEur = Number(payload.rate);
    if (!response.ok || !Number.isFinite(rateToEur) || rateToEur <= 0) return null;
    return rateToEur * EUR_TO_BAM;
  } catch {
    return null;
  }
}

function graphVersion() {
  const configured = String(process.env.META_GRAPH_API_VERSION || "").trim();
  return /^v\d+\.\d+$/.test(configured) ? configured : "v25.0";
}

export async function getMetaAdsDailySpend(dateKey: string): Promise<MetaSpendResult> {
  const token = String(process.env.META_ADS_ACCESS_TOKEN || "").trim();
  const accountIds = String(process.env.META_AD_ACCOUNT_IDS || "")
    .split(",")
    .map((value) => value.trim().replace(/^act_/, ""))
    .filter(Boolean);
  if (!token || accountIds.length === 0) {
    return { configured: false, complete: false, spendBam: null, accounts: [], error: "Meta Ads nije povezan." };
  }

  // Weekend orders are stored under the next workday (Monday). Meta rejects
  // future dates, so use today's actual date until that workday arrives.
  const metaDateKey = insightsDateKey(dateKey);
  const cached = cache.get(metaDateKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rates = currencyRates();

  try {
    const accounts = await Promise.all(accountIds.map(async (accountId): Promise<MetaAccountSpend> => {
      const insightParams = new URLSearchParams({
        fields: "account_id,account_name,spend",
        level: "account",
        time_increment: "1",
        time_range: JSON.stringify({ since: metaDateKey, until: metaDateKey }),
      });
      const accountParams = new URLSearchParams({ fields: "id,name,currency" });
      const request = (url: string) => fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const [accountResponse, insightResponse] = await Promise.all([
        request(`https://graph.facebook.com/${graphVersion()}/act_${accountId}?${accountParams}`),
        request(`https://graph.facebook.com/${graphVersion()}/act_${accountId}/insights?${insightParams}`),
      ]);
      const accountPayload = await accountResponse.json() as MetaAccount & { error?: { message?: string } };
      const insightPayload = await insightResponse.json() as { data?: MetaInsight[]; error?: { message?: string } };
      if (!accountResponse.ok || accountPayload.error) {
        throw new Error(accountPayload.error?.message || `Meta account ${accountId} nije dostupan.`);
      }
      if (!insightResponse.ok || insightPayload.error) {
        throw new Error(insightPayload.error?.message || `Meta potrošnja za račun ${accountId} nije dostupna.`);
      }
      const insight = insightPayload.data?.[0];
      const spend = Number(insight?.spend || 0);
      const currency = String(accountPayload.currency || "").toUpperCase();
      const rate = await rateToBam(currency, metaDateKey, rates);
      return {
        accountId,
        accountName: accountPayload.name || insight?.account_name || `Ad account ${accountId}`,
        currency: currency || "-",
        spend: Number.isFinite(spend) ? spend : 0,
        spendBam: Number.isFinite(spend) && rate ? Math.round(spend * rate * 100) / 100 : null,
      };
    }));
    const complete = accounts.every((account) => account.spendBam !== null);
    const value: MetaSpendResult = {
      configured: true,
      complete,
      spendBam: complete ? Math.round(accounts.reduce((sum, account) => sum + (account.spendBam || 0), 0) * 100) / 100 : null,
      accounts,
      error: complete ? "" : "Nedostaje KM kurs za jednu od valuta Meta računa.",
    };
    cache.set(metaDateKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    return {
      configured: true,
      complete: false,
      spendBam: null,
      accounts: [],
      error: error instanceof Error ? error.message : "Meta Ads podaci trenutno nisu dostupni.",
    };
  }
}

export async function getMetaAdsWorkdaySpend(dateKeys: string[]): Promise<MetaSpendResult> {
  const today = sarajevoDateKey();
  const elapsedDateKeys = Array.from(new Set(dateKeys.filter((dateKey) => dateKey <= today))).sort();
  if (elapsedDateKeys.length === 0) return getMetaAdsDailySpend(today);

  const dailyResults = await Promise.all(elapsedDateKeys.map((dateKey) => getMetaAdsDailySpend(dateKey)));
  const firstFailure = dailyResults.find((result) => !result.configured || !result.complete);
  if (firstFailure) return firstFailure;

  const accounts = new Map<string, MetaAccountSpend>();
  for (const result of dailyResults) {
    for (const account of result.accounts) {
      const current = accounts.get(account.accountId);
      accounts.set(account.accountId, {
        ...account,
        spend: Math.round(((current?.spend || 0) + account.spend) * 100) / 100,
        spendBam: Math.round(((current?.spendBam || 0) + (account.spendBam || 0)) * 100) / 100,
      });
    }
  }

  const combinedAccounts = Array.from(accounts.values());
  return {
    configured: true,
    complete: true,
    spendBam: Math.round(combinedAccounts.reduce((sum, account) => sum + (account.spendBam || 0), 0) * 100) / 100,
    accounts: combinedAccounts,
    error: "",
  };
}

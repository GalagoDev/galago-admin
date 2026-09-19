import "server-only";

type MetaInsight = {
  account_id?: string;
  account_name?: string;
  spend?: string;
  account_currency?: string;
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
const cache = new Map<string, { expiresAt: number; value: MetaSpendResult }>();

function currencyRates() {
  const rates: Record<string, number> = { BAM: 1, KM: 1, EUR: 1.95583 };
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

  const cached = cache.get(dateKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rates = currencyRates();

  try {
    const accounts = await Promise.all(accountIds.map(async (accountId): Promise<MetaAccountSpend> => {
      const params = new URLSearchParams({
        fields: "account_id,account_name,spend,account_currency",
        level: "account",
        time_increment: "1",
        time_range: JSON.stringify({ since: dateKey, until: dateKey }),
      });
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/act_${accountId}/insights?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json() as { data?: MetaInsight[]; error?: { message?: string } };
      if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta account ${accountId} nije dostupan.`);
      const insight = payload.data?.[0];
      const spend = Number(insight?.spend || 0);
      const currency = String(insight?.account_currency || "").toUpperCase();
      const rate = rates[currency];
      return {
        accountId,
        accountName: insight?.account_name || `Ad account ${accountId}`,
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
    cache.set(dateKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
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

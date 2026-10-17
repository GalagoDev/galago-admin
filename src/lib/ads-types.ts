export type AdsMetrics = {
  impressions: number;
  clicks: number;
  cost: number;
  purchases: number;
  purchaseValue: number;
};

export type AdsCampaignHour = AdsMetrics & {
  date: string;
  hour: number;
  campaignId: string;
  campaignName: string;
  status: string;
  channel: string;
};

export type AdsAdDay = AdsMetrics & {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  adId: string;
  adName: string;
  status: string;
  adType: string;
};

export type AdsSnapshot = {
  account: { id: string; name: string; currency: string; timeZone: string };
  fetchedAt: string;
  fromDate: string;
  toDate: string;
  campaigns: AdsCampaignHour[];
  ads: AdsAdDay[];
  purchaseTracking: {
    configured: boolean;
    actions: string[];
    /** Absent on legacy snapshots: value configuration has not been checked. */
    valueSettingsChecked?: boolean;
    /** Purchase actions that override event revenue with a fixed default. */
    fixedValueActions?: string[];
    /** First Europe/Sarajevo calendar date eligible after a known tracking fix. */
    revenueValidFrom?: string;
  };
};

export type AdsSettings = {
  targetRoas: number | null;
  minimumSpendBam: number;
  minimumClicks: number;
  minimumPurchases: number;
  attributionLagDays: number;
};

export type AdsPeriodKind = "workday" | "weekend" | "7days" | "30days" | "custom";
export type AdsPeriod = {
  kind: AdsPeriodKind;
  date: string;
  start: string;
  end: string;
  label: string;
  complete: boolean;
};

export type AdsSummary = {
  impressions: number;
  clicks: number;
  spendBam: number | null;
  spendEur: number | null;
  purchases: number | null;
  revenueBam: number | null;
  roas: number | null;
  ctr: number | null;
  cpcBam: number | null;
  cpaBam: number | null;
};

export type AdsRecommendation = {
  decision: "keep" | "review" | "wait" | "tracking" | "inactive";
  label: string;
  reason: string;
};

export type AdsCampaignReport = AdsSummary & {
  id: string;
  name: string;
  status: string;
  channel: string;
};

export type AdsAdReport = AdsSummary & {
  id: string;
  name: string;
  campaignName: string;
  adGroupName: string;
  status: string;
  adType: string;
  recommendation: AdsRecommendation;
};

export type AdsReport = {
  period: AdsPeriod;
  summary: AdsSummary;
  campaigns: AdsCampaignReport[];
  timeline: Array<AdsSummary & { date: string }>;
  ads: AdsAdReport[];
  recommendationPeriod: { from: string; to: string; label: string };
  warnings: string[];
};

export type AdsDashboardData = {
  connection: {
    source: "api" | "sheets";
    configured: boolean;
    customerId: string | null;
    credentialMode: "service-account" | "oauth" | null;
    missing: string[];
  };
  sync: { lastAttemptAt: string | null; lastSuccessAt: string | null; error: string | null; running: boolean };
  account: AdsSnapshot["account"] | null;
  tracking: AdsSnapshot["purchaseTracking"] | null;
  settings: AdsSettings;
  report: AdsReport | null;
};

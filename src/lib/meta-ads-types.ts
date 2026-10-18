import type { AdsPeriod, AdsSummary } from "./ads-types";

export type MetaAdsAccount = {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
};

export type MetaAdsHour = {
  accountId: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  status: string | null;
  date: string;
  hour: number;
  impressions: number;
  clicks: number;
  spend: number;
  purchases: number | null;
  purchaseValue: number | null;
  purchaseActionType: string | null;
  /** Conversion for this account/date; null means the BAM value is unknown. */
  bamRate: number | null;
};

export type MetaAdsSnapshot = {
  fetchedAt: string;
  periodStart: string;
  periodEnd: string;
  accounts: MetaAdsAccount[];
  hours: MetaAdsHour[];
  /** Meta's requested attribution and action date semantics. */
  attribution: string;
  warnings: string[];
};

export type MetaAdsEntity = AdsSummary & {
  id: string;
  accountId: string;
  accountName: string;
  name: string;
  campaignName: string;
  adSetName: string;
  status: string | null;
};

export type MetaAdsReport = {
  period: AdsPeriod;
  summary: AdsSummary;
  accounts: MetaAdsEntity[];
  campaigns: MetaAdsEntity[];
  ads: MetaAdsEntity[];
  timeline: Array<AdsSummary & { date: string }>;
  attribution: string;
  warnings: string[];
};

export type MetaAdsDashboardData = {
  connection: { configured: boolean; accountIds: string[]; missing: string[] };
  period: AdsPeriod;
  fetchedAt: string | null;
  accounts: MetaAdsAccount[];
  report: MetaAdsReport | null;
  error: string | null;
};

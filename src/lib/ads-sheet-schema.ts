import { z } from "zod";
import type { AdsSnapshot } from "./ads-types";

const DAY_MS = 86_400_000;
export const ADS_SHEET_MAX_AGE_MS = 6 * 60 * 60_000;
export const adsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const countSchema = z.number().int().min(0).max(100_000);
const textSchema = z.string().min(1).max(2000);
const idSchema = z.string().regex(/^\d{1,30}$/);
const statusSchema = z.enum(["ENABLED", "PAUSED", "REMOVED"]);
const metricSchema = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const metrics = {
  impressions: metricSchema.int(), clicks: metricSchema.int(), cost: metricSchema,
  purchases: metricSchema, purchaseValue: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
};
const campaignSchema = z.object({
  ...metrics, date: adsDateSchema, hour: z.number().int().min(0).max(23),
  campaignId: idSchema, campaignName: textSchema, status: statusSchema,
  channel: z.string().regex(/^[A-Z_]+$/).max(100),
}).strict();
const adSchema = z.object({
  ...metrics, date: adsDateSchema, campaignId: idSchema, campaignName: textSchema,
  adGroupId: idSchema, adGroupName: textSchema, adId: idSchema, adName: textSchema,
  status: statusSchema, adType: z.string().regex(/^[A-Z_]+$/).max(100),
}).strict();
const trackingSchema = z.object({
  configured: z.boolean(), actions: z.array(textSchema).max(1000),
  valueSettingsChecked: z.boolean(), fixedValueActions: z.array(textSchema).max(1000),
  revenueValidFrom: adsDateSchema.optional(),
}).strict();
const manifestSchema = z.object({
  schemaVersion: z.literal(1), complete: z.literal(true), runId: runIdSchema,
  exportedAt: z.string().datetime({ offset: true }), customerId: z.string().regex(/^\d{10}$/),
  currency: z.string().regex(/^[A-Z]{3}$/), timeZone: textSchema, accountName: textSchema,
  fromDate: adsDateSchema, toDate: adsDateSchema,
  campaignsTab: z.string(), adsTab: z.string(), trackingTab: z.string(),
  campaignsCount: countSchema, adsCount: countSchema, trackingCount: z.literal(1),
  previousRunIds: z.array(runIdSchema).max(2).optional(),
}).strict();
export type AdsSheetManifest = z.infer<typeof manifestSchema>;
export type AdsSheetKind = "campaigns" | "ads" | "tracking";

export class AdsSheetValidationError extends Error {}
function invalid(message: string): never {
  throw new AdsSheetValidationError(`Google Ads Sheet: ${message} Prethodni potpuni podaci ostaju sačuvani.`);
}

function parseCell(row: unknown): unknown {
  if (!Array.isArray(row) || row.length !== 1 || typeof row[0] !== "string" || row[0].length > 49_000) {
    return invalid("red nedostaje ili nije JSON zapis.");
  }
  try { return JSON.parse(row[0]); } catch { return invalid("JSON zapis nije ispravan."); }
}

export function readAdsSheetManifest(values: unknown, expectedCustomerId: string, now = Date.now()): AdsSheetManifest {
  if (!Array.isArray(values) || values.length !== 1) return invalid("nedostaje objavljeni manifest izvoza.");
  const result = manifestSchema.safeParse(parseCell(values[0]));
  if (!result.success) return invalid("manifest nije potpun ili njegova verzija nije podržana.");
  const manifest = result.data;
  if (manifest.customerId !== expectedCustomerId) return invalid("izvoz pripada drugom Google Ads računu.");
  const exportedAt = Date.parse(manifest.exportedAt);
  if (exportedAt > now + 5 * 60_000) return invalid("vrijeme izvoza je u budućnosti.");
  if (now - exportedAt > ADS_SHEET_MAX_AGE_MS) return invalid("izvoz je stariji od šest sati. Provjerite raspored Google Ads Script izvoza.");
  const span = Date.parse(`${manifest.toDate}T00:00:00Z`) - Date.parse(`${manifest.fromDate}T00:00:00Z`);
  if (span < 0 || span >= 90 * DAY_MS) return invalid("historija mora obuhvatati 1–90 kalendarskih dana.");
  let exportDate: string;
  try {
    exportDate = new Intl.DateTimeFormat("en-CA", { timeZone: manifest.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(exportedAt));
  } catch { return invalid("vremenska zona računa nije ispravna."); }
  if (manifest.toDate > exportDate) return invalid("historija sadrži budući datum.");
  for (const kind of ["campaigns", "ads", "tracking"] as const) {
    if (manifest[`${kind}Tab`] !== `ads_${kind}_${manifest.runId}`) return invalid("naziv kartice ne odgovara objavljenom izvozu.");
  }
  return manifest;
}

function readRows(values: unknown, manifest: AdsSheetManifest, kind: AdsSheetKind): unknown[] {
  const count = manifest[`${kind}Count`];
  if (!Array.isArray(values) || values.length !== count + 1) return invalid(`broj redova (${kind}) ne odgovara potpunom izvozu.`);
  const header = z.object({ schemaVersion: z.literal(1), runId: runIdSchema, kind: z.literal(kind), count: countSchema }).strict().safeParse(parseCell(values[0]));
  if (!header.success || header.data.runId !== manifest.runId || header.data.count !== count) return invalid(`zaglavlje (${kind}) pripada drugom ili nepotpunom izvozu.`);
  return values.slice(1).map(parseCell);
}

export function buildAdsSheetSnapshot(manifest: AdsSheetManifest, tables: Record<AdsSheetKind, unknown>, validFrom: string): AdsSnapshot {
  if (!adsDateSchema.safeParse(validFrom).success) return invalid("serverski datum početka procjene prihoda nije ispravan.");
  const campaignResult = z.array(campaignSchema).safeParse(readRows(tables.campaigns, manifest, "campaigns"));
  const adResult = z.array(adSchema).safeParse(readRows(tables.ads, manifest, "ads"));
  const trackingResult = trackingSchema.safeParse(readRows(tables.tracking, manifest, "tracking")[0]);
  if (!campaignResult.success || !adResult.success || !trackingResult.success) return invalid("metrike ili podaci praćenja nisu ispravni; nepoznate vrijednosti nisu pretvorene u nule.");
  const campaigns = campaignResult.data;
  const ads = adResult.data;
  for (const rows of [campaigns, ads]) {
    if (rows.some((row) => row.date < manifest.fromDate || row.date > manifest.toDate)) return invalid("datum retka je izvan objavljene historije.");
  }
  const campaignKeys = campaigns.map((row) => `${row.campaignId}/${row.date}/${row.hour}`);
  const adKeys = ads.map((row) => `${row.campaignId}/${row.adGroupId}/${row.adId}/${row.date}`);
  if (new Set(campaignKeys).size !== campaignKeys.length || new Set(adKeys).size !== adKeys.length) return invalid("izvoz sadrži duple metrike.");
  const tracking = trackingResult.data;
  if (tracking.valueSettingsChecked && (!tracking.configured || tracking.actions.length === 0)) return invalid("potvrda postavki kupovine nema odgovarajući cilj.");
  if (tracking.fixedValueActions.some((action) => !tracking.actions.includes(action))) return invalid("fiksna vrijednost nema odgovarajući cilj kupovine.");
  // Server configuration can tighten, but the transport cannot relax, the
  // historical cutoff. Configuration alone does not verify real purchase values.
  const revenueValidFrom = tracking.revenueValidFrom && tracking.revenueValidFrom > validFrom ? tracking.revenueValidFrom : validFrom;
  return {
    account: { id: manifest.customerId, name: manifest.accountName, currency: manifest.currency, timeZone: manifest.timeZone },
    fetchedAt: manifest.exportedAt, fromDate: manifest.fromDate, toDate: manifest.toDate,
    campaigns, ads, purchaseTracking: { ...tracking, revenueValidFrom },
  };
}

import "server-only";

import { google } from "googleapis";
import { getGoogleServiceAccountCredentials } from "@/lib/google-auth";
import { adsDateSchema, AdsSheetValidationError, buildAdsSheetSnapshot, readAdsSheetManifest } from "@/lib/ads-sheet-schema";
import type { AdsDashboardData, AdsSnapshot } from "@/lib/ads-types";

const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TIMEOUT_MS = 4 * 60_000;

export function getAdsSheetConnection(): AdsDashboardData["connection"] {
  const rawId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/[\s-]/g, "") || "";
  const customerId = /^\d{10}$/.test(rawId) ? rawId : null;
  const spreadsheetId = process.env.GOOGLE_ADS_REPORT_SPREADSHEET_ID?.trim() || "";
  const credentials = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const validFrom = adsDateSchema.safeParse(process.env.GOOGLE_ADS_REVENUE_VALID_FROM?.trim());
  const missing = [
    !customerId ? "Google Ads ID računa" : "",
    !/^[A-Za-z0-9_-]{20,200}$/.test(spreadsheetId) ? "ID privatnog Google Ads izvještajnog Sheeta" : "",
    !credentials ? "Postojeći Google Sheets service account pristup" : "",
    !validFrom.success ? "Datum početka procjene prihoda (GOOGLE_ADS_REVENUE_VALID_FROM)" : "",
  ].filter(Boolean);
  return { source: "sheets", configured: missing.length === 0, customerId, credentialMode: credentials ? "service-account" : null, missing };
}

/** This client exposes only values.get/batchGet with a read-only Sheets scope. */
export async function fetchAdsSheetSnapshot(): Promise<AdsSnapshot> {
  const connection = getAdsSheetConnection();
  if (!connection.configured || !connection.customerId) throw new Error("Google Ads Sheet povezivanje nije potpuno podešeno. Provjerite prikazane serverske postavke.");
  const spreadsheetId = process.env.GOOGLE_ADS_REPORT_SPREADSHEET_ID!.trim();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const deadline = Date.now() + TIMEOUT_MS;
  const options = () => {
    const remaining = deadline - Date.now();
    if (signal.aborted || remaining <= 0) throw new AdsSheetValidationError("Google Ads Sheet čitanje je prekoračilo četiri minute. Prethodni podaci ostaju sačuvani.");
    return { signal, timeout: Math.min(45_000, remaining), retry: false };
  };
  try {
    const credentials = getGoogleServiceAccountCredentials();
    if (typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") throw new Error("Incomplete credentials");
    const auth = new google.auth.JWT({ email: credentials.client_email, key: credentials.private_key, scopes: [READONLY_SCOPE], transporterOptions: options() });
    const sheets = google.sheets({ version: "v4", auth });
    const readManifest = () => sheets.spreadsheets.values.get({ spreadsheetId, range: "'ads_manifest'!A1", valueRenderOption: "UNFORMATTED_VALUE" }, options());
    const first = await readManifest();
    const manifest = readAdsSheetManifest(first.data.values, connection.customerId);
    const kinds = ["campaigns", "ads", "tracking"] as const;
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId, valueRenderOption: "UNFORMATTED_VALUE", majorDimension: "ROWS",
      ranges: kinds.map((kind) => `'${manifest[`${kind}Tab`]}'!A1:A${manifest[`${kind}Count`] + 2}`),
    }, options());
    const tables = result.data.valueRanges;
    if (!tables || tables.length !== 3) throw new AdsSheetValidationError("Google Ads Sheet nije vratio sve kartice izvoza.");
    const second = await readManifest();
    options();
    // The publisher commits the manifest last. A changed pointer means the
    // read raced a new publication; retry on the next scheduled import.
    if (JSON.stringify(first.data.values) !== JSON.stringify(second.data.values)) throw new AdsSheetValidationError("Google Ads Script je objavio novi izvoz tokom čitanja. Ponovite uvoz.");
    readAdsSheetManifest(second.data.values, connection.customerId);
    return buildAdsSheetSnapshot(manifest, { campaigns: tables[0].values, ads: tables[1].values, tracking: tables[2].values }, process.env.GOOGLE_ADS_REVENUE_VALID_FROM!.trim());
  } catch (error) {
    if (error instanceof AdsSheetValidationError) throw error;
    options();
    // Google errors can contain credential/request details. Never expose them.
    throw new Error("Privatni Google Ads Sheet nije moguće pročitati. Provjerite ID Sheeta, Viewer pristup postojećeg Google service accounta i posljednji Script izvoz. Prethodni podaci ostaju sačuvani.");
  }
}

import "server-only";

import { fetchGoogleAdsSnapshot, getAdsConnection as getApiConnection } from "@/lib/google-ads-client";
import { fetchAdsSheetSnapshot, getAdsSheetConnection } from "@/lib/ads-sheets";

function usesSheets() {
  return Boolean(process.env.GOOGLE_ADS_REPORT_SPREADSHEET_ID?.trim());
}

export function getAdsConnection() {
  return usesSheets() ? getAdsSheetConnection() : getApiConnection();
}

export async function fetchAdsSnapshot() {
  // A configured Sheets source must fail closed, never silently fall back to API.
  return usesSheets() ? fetchAdsSheetSnapshot() : fetchGoogleAdsSnapshot();
}

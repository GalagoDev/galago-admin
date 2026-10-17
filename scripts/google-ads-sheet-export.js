/* global AdsApp, SpreadsheetApp, Utilities, Logger */
/**
 * Install ONE copy in Google Ads > Tools > Scripts, on the client account below.
 * Set SPREADSHEET_ID to a dedicated private spreadsheet, then schedule hourly.
 * This script only READS Google Ads. It writes only its own reporting Sheet tabs.
 * No Ads changes, HTTP callbacks, email, credentials or public sharing.
 * Transport: docs/google-ads-sheet-export.md. Tests: test-google-ads-sheet-export.cjs.
 */
var GALAGO_ADS_EXPORT = {
  SPREADSHEET_ID: "",
  EXPECTED_CUSTOMER_ID: "3221742913",
  LOOKBACK_DAYS: 35,
  // First eligible Europe/Sarajevo calendar date after the known tracking fix.
  // This is a history cutoff, not proof that purchase tracking works.
  REVENUE_VALID_FROM: "2026-10-17",
  API_VERSION: "v26",
  MAX_QUERY_ROWS: 200000,
  MAX_SNAPSHOT_ROWS: 100000,
  MAX_CELL_CHARS: 45000,
  MAX_TOTAL_JSON_CHARS: 40000000,
  BATCH_ROWS: 500,
  MAX_RUNTIME_MS: 20 * 60 * 1000
};

// Google Ads invokes this entry point by name.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function main() {
  var startedAt = new Date();
  var config = GALAGO_ADS_EXPORT;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(config.SPREADSHEET_ID)) throw new Error("Set SPREADSHEET_ID to the dedicated private reporting Sheet ID.");
  if (!/^\d{10}$/.test(config.EXPECTED_CUSTOMER_ID)) throw new Error("Invalid EXPECTED_CUSTOMER_ID.");
  if (!Number.isInteger(config.LOOKBACK_DAYS) || config.LOOKBACK_DAYS < 35 || config.LOOKBACK_DAYS > 90) throw new Error("LOOKBACK_DAYS must be between 35 and 90.");
  if (config.REVENUE_VALID_FROM) galagoDate(config.REVENUE_VALID_FROM);
  var currentId = String(AdsApp.currentAccount().getCustomerId()).replace(/-/g, "");
  if (currentId !== config.EXPECTED_CUSTOMER_ID) throw new Error("Wrong Google Ads account. Export cancelled.");
  var book = SpreadsheetApp.openById(config.SPREADSHEET_ID);
  var oldManifestSheet = book.getSheetByName("ads_manifest");
  var oldText = oldManifestSheet ? String(oldManifestSheet.getRange(1, 1).getValue() || "") : "";
  var oldManifest = oldText ? JSON.parse(oldText) : null;
  if (oldManifest && (oldManifest.schemaVersion !== 1 || oldManifest.customerId !== currentId || oldManifest.complete !== true)) throw new Error("Existing manifest does not belong to this account/schema.");

  var budget = { startedAt: startedAt.getTime(), queryRows: 0 };
  var snapshot = galagoFetchSnapshot(startedAt, budget);
  if (book.getSpreadsheetTimeZone() !== snapshot.account.timeZone) book.setSpreadsheetTimeZone(snapshot.account.timeZone);
  var runId = String(startedAt.getTime()) + "_" + Utilities.getUuid().replace(/-/g, "");
  var data = { campaigns: snapshot.campaigns, ads: snapshot.ads, tracking: [snapshot.purchaseTracking] };
  var totalRows = data.campaigns.length + data.ads.length + data.tracking.length;
  if (totalRows > config.MAX_SNAPSHOT_ROWS) throw new Error("Snapshot row limit exceeded; previous export preserved.");
  var serialized = {};
  var totalChars = 0;
  Object.keys(data).forEach(function (kind) {
    serialized[kind] = data[kind].map(function (row) {
      var value = JSON.stringify(row);
      if (value.length > config.MAX_CELL_CHARS) throw new Error("A JSON row exceeds the safe Sheet cell size.");
      totalChars += value.length;
      return [value];
    });
  });
  if (totalChars > config.MAX_TOTAL_JSON_CHARS) throw new Error("Snapshot size limit exceeded; previous export preserved.");

  var manifest = {
    schemaVersion: 1, complete: true, runId: runId,
    // Conservative freshness: timestamp the first query, not the final Sheet write.
    exportedAt: startedAt.toISOString(),
    customerId: snapshot.account.id, accountName: snapshot.account.name,
    currency: snapshot.account.currency, timeZone: snapshot.account.timeZone,
    fromDate: snapshot.fromDate, toDate: snapshot.toDate,
    campaignsTab: "ads_campaigns_" + runId, adsTab: "ads_ads_" + runId, trackingTab: "ads_tracking_" + runId,
    campaignsCount: data.campaigns.length, adsCount: data.ads.length, trackingCount: 1,
    previousRunIds: oldManifest ? [oldManifest.runId].concat(oldManifest.previousRunIds || []).slice(0, 2) : []
  };
  Object.keys(data).forEach(function (kind) {
    galagoWriteTable(book, manifest[kind + "Tab"], runId, kind, serialized[kind], budget);
  });
  // Flush every immutable table before changing the single commit pointer.
  SpreadsheetApp.flush();
  galagoCheckBudget(budget);
  var manifestSheet = book.getSheetByName("ads_manifest");
  var currentText = manifestSheet ? String(manifestSheet.getRange(1, 1).getValue() || "") : "";
  if (currentText !== oldText) throw new Error("Another export committed meanwhile; this export was not published.");
  if (!manifestSheet) manifestSheet = book.insertSheet("ads_manifest");
  manifestSheet.getRange(1, 1).setNumberFormat("@").setValue(JSON.stringify(manifest));
  SpreadsheetApp.flush();
  Logger.log("Galago Ads export complete: " + runId + "; campaigns=" + data.campaigns.length + "; ads=" + data.ads.length);
  var totals = data.campaigns.reduce(function (sum, row) {
    sum.cost += row.cost; sum.impressions += row.impressions; sum.clicks += row.clicks;
    sum.purchases += row.purchases; sum.reportedPurchaseValue += row.purchaseValue;
    return sum;
  }, { cost: 0, impressions: 0, clicks: 0, purchases: 0, reportedPurchaseValue: 0 });
  Logger.log(JSON.stringify({ account: manifest.customerId, currency: manifest.currency, fromDate: manifest.fromDate, toDate: manifest.toDate, totals: totals, valueSettingsChecked: snapshot.purchaseTracking.valueSettingsChecked, fixedValueActionCount: snapshot.purchaseTracking.fixedValueActions.length, revenueValidFrom: snapshot.purchaseTracking.revenueValidFrom || null }));
  // A cleanup failure must not invalidate a fully published snapshot.
  try { galagoCleanup(book, manifest); } catch { Logger.log("Export published. Old reporting tab cleanup will retry on the next run."); }
}

function galagoCheckBudget(budget) {
  if (Date.now() - budget.startedAt >= GALAGO_ADS_EXPORT.MAX_RUNTIME_MS || AdsApp.getExecutionInfo().getRemainingTime() < 60) throw new Error("Export time limit reached; previous complete export preserved.");
}

function galagoSearch(query, budget) {
  galagoCheckBudget(budget);
  var iterator = AdsApp.search(query, { apiVersion: GALAGO_ADS_EXPORT.API_VERSION });
  var rows = [];
  while (iterator.hasNext()) {
    if (++budget.queryRows > GALAGO_ADS_EXPORT.MAX_QUERY_ROWS) throw new Error("Query row limit exceeded; export incomplete and not published.");
    rows.push(iterator.next());
    if (rows.length % 250 === 0) galagoCheckBudget(budget);
  }
  galagoCheckBudget(budget);
  return rows;
}

function galagoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) throw new Error("Invalid reporting date.");
  return value;
}

function galagoId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsafe numeric Google Ads identifier.");
  if (!/^\d+$/.test(String(value))) throw new Error("Missing Google Ads identifier.");
  return String(value);
}

function galagoNumber(value) {
  // Selected fields must exist. Zero is valid; null/absent/blank is not silently zero.
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error("Missing or invalid selected Google Ads metric.");
  return Number(value);
}

function galagoMetrics(row, purchase) {
  if (!row.metrics) throw new Error("Google Ads row has no metrics.");
  var result = { impressions: 0, clicks: 0, cost: 0, purchases: 0, purchaseValue: 0 };
  if (purchase) {
    if (!row.segments || row.segments.conversionActionCategory !== "PURCHASE") throw new Error("Non-PURCHASE conversion row rejected.");
    result.purchases = galagoNumber(row.metrics.conversions);
    result.purchaseValue = galagoNumber(row.metrics.conversionsValue);
    if (result.purchases < 0) throw new Error("Negative purchase count requires manual review.");
  } else {
    result.impressions = galagoNumber(row.metrics.impressions);
    result.clicks = galagoNumber(row.metrics.clicks);
    result.cost = galagoNumber(row.metrics.costMicros) / 1000000;
    if (result.impressions < 0 || result.clicks < 0 || result.cost < 0 || !Number.isInteger(result.impressions) || !Number.isInteger(result.clicks)) throw new Error("Invalid impression, click or cost metric.");
  }
  return result;
}

function galagoCampaignRow(row, purchase) {
  if (!row.campaign || !row.segments) throw new Error("Missing campaign report fields.");
  var result = galagoMetrics(row, purchase);
  result.date = galagoDate(row.segments.date);
  result.hour = galagoNumber(row.segments.hour);
  if (!Number.isInteger(result.hour) || result.hour < 0 || result.hour > 23) throw new Error("Invalid reporting hour.");
  result.campaignId = galagoId(row.campaign.id);
  result.campaignName = row.campaign.name || "Kampanja " + result.campaignId;
  result.status = row.campaign.status || "UNKNOWN";
  result.channel = row.campaign.advertisingChannelType || "UNKNOWN";
  return result;
}

function galagoAdRow(row, purchase) {
  if (!row.campaign || !row.adGroup || !row.adGroupAd || !row.adGroupAd.ad || !row.segments) throw new Error("Missing ad report fields.");
  var result = galagoMetrics(row, purchase);
  result.date = galagoDate(row.segments.date);
  result.campaignId = galagoId(row.campaign.id);
  result.campaignName = row.campaign.name || "Kampanja " + result.campaignId;
  result.adGroupId = galagoId(row.adGroup.id);
  result.adGroupName = row.adGroup.name || "Grupa " + result.adGroupId;
  result.adId = galagoId(row.adGroupAd.ad.id);
  result.adName = row.adGroupAd.ad.name || "Oglas " + result.adId;
  var statuses = [row.campaign.status, row.adGroup.status, row.adGroupAd.status];
  result.status = statuses.indexOf("REMOVED") >= 0 ? "REMOVED" : statuses.indexOf("PAUSED") >= 0 ? "PAUSED" : row.adGroupAd.status || "UNKNOWN";
  result.adType = row.adGroupAd.ad.type || "UNKNOWN";
  return result;
}

function galagoMerge(base, purchases, key) {
  var merged = new Map();
  base.forEach(function (row) {
    if (merged.has(key(row))) throw new Error("Duplicate unsegmented cost row.");
    merged.set(key(row), row);
  });
  purchases.forEach(function (row) {
    var previous = merged.get(key(row));
    if (previous) { previous.purchases += row.purchases; previous.purchaseValue += row.purchaseValue; }
    else merged.set(key(row), row);
  });
  return Array.from(merged.values());
}

function galagoTracking(actionRows, purchaseRows) {
  var observed = new Set();
  var observedComplete = true;
  purchaseRows.forEach(function (row) {
    if (galagoNumber(row.metrics.conversions) !== 0 || galagoNumber(row.metrics.conversionsValue) !== 0) {
      if (!row.segments.conversionAction) observedComplete = false;
      else observed.add(row.segments.conversionAction);
    }
  });
  var actions = actionRows.map(function (row) { return row.conversionAction || {}; });
  observed.forEach(function (resource) {
    if (!actions.some(function (action) { return action.resourceName === resource; })) observedComplete = false;
  });
  var relevant = actions.filter(function (action) { return (action.primaryForGoal === true && action.status === "ENABLED") || observed.has(action.resourceName); });
  var result = {
    configured: relevant.length > 0 || observed.size > 0 || !observedComplete,
    actions: relevant.map(function (action) { return action.name || "Kupovina"; }),
    valueSettingsChecked: relevant.length > 0 && observedComplete && relevant.every(function (action) { return action.valueSettings && typeof action.valueSettings.alwaysUseDefaultValue === "boolean"; }),
    fixedValueActions: relevant.filter(function (action) { return action.valueSettings && action.valueSettings.alwaysUseDefaultValue === true; }).map(function (action) { return action.name || "Kupovina"; })
  };
  if (GALAGO_ADS_EXPORT.REVENUE_VALID_FROM) result.revenueValidFrom = GALAGO_ADS_EXPORT.REVENUE_VALID_FROM;
  return result;
}

function galagoFetchSnapshot(now, budget) {
  var customers = galagoSearch("SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer", budget);
  var customer = customers.length === 1 && customers[0].customer;
  if (!customer || galagoId(customer.id) !== GALAGO_ADS_EXPORT.EXPECTED_CUSTOMER_ID || !/^[A-Z]{3}$/.test(customer.currencyCode) || !customer.timeZone) throw new Error("Cannot verify account, currency and timezone.");
  var toDate = galagoDate(Utilities.formatDate(now, customer.timeZone, "yyyy-MM-dd"));
  var fromDate = new Date(Date.parse(toDate + "T12:00:00Z") - (GALAGO_ADS_EXPORT.LOOKBACK_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  var dates = "segments.date BETWEEN '" + fromDate + "' AND '" + toDate + "'";
  var campaignFields = "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, segments.hour";
  var adFields = "campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, segments.date";
  var costs = "metrics.impressions, metrics.clicks, metrics.cost_micros";
  var purchases = "segments.conversion_action, segments.conversion_action_category, metrics.conversions, metrics.conversions_value";
  var statuses = " IN ('ENABLED', 'PAUSED', 'REMOVED')";
  var campaignCosts = galagoSearch("SELECT " + campaignFields + ", " + costs + " FROM campaign WHERE " + dates + " AND campaign.status" + statuses, budget);
  var campaignPurchases = galagoSearch("SELECT " + campaignFields + ", " + purchases + " FROM campaign WHERE " + dates + " AND segments.conversion_action_category = 'PURCHASE' AND campaign.status" + statuses, budget);
  var adCosts = galagoSearch("SELECT " + adFields + ", " + costs + " FROM ad_group_ad WHERE " + dates + " AND ad_group_ad.status" + statuses, budget);
  var adPurchases = galagoSearch("SELECT " + adFields + ", " + purchases + " FROM ad_group_ad WHERE " + dates + " AND segments.conversion_action_category = 'PURCHASE' AND ad_group_ad.status" + statuses, budget);
  var actions = galagoSearch("SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.primary_for_goal, conversion_action.value_settings.always_use_default_value, conversion_action.value_settings.default_value, conversion_action.value_settings.default_currency_code FROM conversion_action WHERE conversion_action.category = 'PURCHASE'", budget);
  var campaigns = galagoMerge(campaignCosts.map(function (r) { return galagoCampaignRow(r, false); }), campaignPurchases.map(function (r) { return galagoCampaignRow(r, true); }), function (r) { return r.campaignId + "/" + r.date + "/" + r.hour; });
  var ads = galagoMerge(adCosts.map(function (r) { return galagoAdRow(r, false); }), adPurchases.map(function (r) { return galagoAdRow(r, true); }), function (r) { return r.adGroupId + "/" + r.adId + "/" + r.date; });
  campaigns.concat(ads).forEach(function (row) { if (row.date < fromDate || row.date > toDate) throw new Error("Row outside requested reporting coverage."); });
  return {
    account: { id: galagoId(customer.id), name: customer.descriptiveName || "Google Ads", currency: customer.currencyCode, timeZone: customer.timeZone },
    fromDate: fromDate, toDate: toDate, campaigns: campaigns, ads: ads,
    purchaseTracking: galagoTracking(actions, campaignPurchases.concat(adPurchases))
  };
}

function galagoWriteTable(book, name, runId, kind, rows, budget) {
  galagoCheckBudget(budget);
  if (book.getSheetByName(name)) throw new Error("Run tab already exists; immutable data will not be overwritten.");
  var sheet = book.insertSheet(name);
  // One column avoids allocating 26x the necessary cells when growing a sheet.
  if (sheet.getMaxColumns() > 1) sheet.deleteColumns(2, sheet.getMaxColumns() - 1);
  // Leave a blank sentinel row so the reader can detect unexpected extra data.
  if (sheet.getMaxRows() < rows.length + 2) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 2 - sheet.getMaxRows());
  for (var offset = 0; offset < rows.length; offset += GALAGO_ADS_EXPORT.BATCH_ROWS) {
    galagoCheckBudget(budget);
    var batch = rows.slice(offset, offset + GALAGO_ADS_EXPORT.BATCH_ROWS);
    sheet.getRange(offset + 2, 1, batch.length, 1).setNumberFormat("@").setValues(batch);
  }
  sheet.getRange(1, 1).setNumberFormat("@").setValue(JSON.stringify({ schemaVersion: 1, runId: runId, kind: kind, count: rows.length }));
}

function galagoCleanup(book, manifest) {
  var keep = new Set([manifest.runId].concat(manifest.previousRunIds));
  book.getSheets().forEach(function (sheet) {
    var match = /^ads_(?:campaigns|ads|tracking)_(\d{13}_[a-fA-F0-9]{32})$/.exec(sheet.getName());
    if (match && !keep.has(match[1]) && Number(match[1].slice(0, 13)) < Number(manifest.runId.slice(0, 13))) book.deleteSheet(sheet);
  });
}

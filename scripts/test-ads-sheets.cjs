/* eslint-disable @typescript-eslint/no-require-imports -- Exercise real server modules with isolated Google/SQLite fixtures. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalTs = Module._extensions[".ts"];
const originalFetch = global.fetch;
const OriginalDate = Date;
let now = Date.parse("2026-10-20T10:00:00Z");
global.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const envKeys = Object.keys(process.env).filter((key) => /^GOOGLE_/.test(key));
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
for (const key of envKeys) delete process.env[key];
process.env.GOOGLE_ADS_CUSTOMER_ID = "322-174-2913";
process.env.GOOGLE_ADS_REPORT_SPREADSHEET_ID = "fixture_private_spreadsheet_123456789";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = "fixture-shared-credentials";
process.env.GOOGLE_ADS_REVENUE_VALID_FROM = "2026-10-17";
const secret = "SENSITIVE-TEST-KEY-NEVER-RETURN";
const customerId = "3221742913";
const sqlite = new DatabaseSync(":memory:");
const database = {
  exec: (sql) => sqlite.exec(sql), prepare: (sql) => sqlite.prepare(sql),
  transaction: (run) => (...args) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = run(...args); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
let authOptions;
let credentialFailure = false;
let getCalls = 0;
let batchCalls = 0;
let readOverride;
let batchOverride;
let fixture;
class JWT { constructor(options) { authOptions = options; } }
const sheetApi = {
  spreadsheets: { values: {
    get: async (params, options) => {
      getCalls++;
      assert.equal(params.spreadsheetId, process.env.GOOGLE_ADS_REPORT_SPREADSHEET_ID);
      assert.equal(params.range, "'ads_manifest'!A1");
      assert.equal(params.valueRenderOption, "UNFORMATTED_VALUE");
      assert.equal(options.retry, false);
      assert.ok(options.signal instanceof AbortSignal);
      if (readOverride) return readOverride(params, options);
      return { data: { values: [[JSON.stringify(fixture.manifest)]] } };
    },
    batchGet: async (params, options) => {
      batchCalls++;
      assert.equal(params.valueRenderOption, "UNFORMATTED_VALUE");
      assert.equal(options.retry, false);
      assert.deepEqual(params.ranges, ["campaigns", "ads", "tracking"].map((kind) => `'ads_${kind}_${fixture.manifest.runId}'!A1:A${fixture.manifest[`${kind}Count`] + 2}`));
      if (batchOverride) return batchOverride(params, options);
      return { data: { valueRanges: ["campaigns", "ads", "tracking"].map((kind) => ({ values: fixture.tables[kind] })) } };
    },
  } },
};
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "googleapis") return { google: { auth: { JWT }, sheets: () => sheetApi } };
  if (request === "@/lib/db") return { getDb: () => database };
  if (request === "@/lib/google-auth") return { getGoogleServiceAccountCredentials: () => {
    if (credentialFailure) throw new Error(secret);
    return { client_email: "shared-sheets@example.invalid", private_key: secret };
  } };
  if (request === "@/lib/auth") return { isAuthenticated: async () => true };
  return originalLoad.call(this, request, parent, isMain);
};
global.fetch = async () => { throw new Error("Test attempted network or direct Ads API"); };
const source = require("../src/lib/ads-source.ts");
const sheets = require("../src/lib/ads-sheets.ts");
const schema = require("../src/lib/ads-sheet-schema.ts");
const sync = require("../src/lib/ads-sync.ts");
const store = require("../src/lib/ads-store.ts");
const analytics = require("../src/lib/ads-analytics.ts");
const route = require("../src/app/api/ads/route.ts");

function makeFixture() {
  const runId = "1792489800000_fixture";
  const campaigns = [{ date: "2026-10-19", hour: 8, campaignId: "1", campaignName: "Nexo", status: "ENABLED", channel: "DEMAND_GEN", impressions: 100, clicks: 10, cost: 5, purchases: 1, purchaseValue: 100 / 1.95583 }];
  const ads = [{ ...campaigns[0], adGroupId: "11", adGroupName: "45+", adId: "111", adName: "Nexo ad", adType: "DEMAND_GEN_MULTI_ASSET_AD" }];
  delete ads[0].hour;
  delete ads[0].channel;
  const tracking = [{ configured: true, actions: ["Purchase"], valueSettingsChecked: true, fixedValueActions: [] }];
  const manifest = { schemaVersion: 1, complete: true, runId, exportedAt: new Date(now - 30 * 60_000).toISOString(), customerId, currency: "EUR", timeZone: "Europe/Sarajevo", accountName: "Galago fixture", fromDate: "2026-09-16", toDate: "2026-10-20", previousRunIds: [] };
  const tables = {};
  for (const [kind, rows] of Object.entries({ campaigns, ads, tracking })) {
    manifest[`${kind}Tab`] = `ads_${kind}_${runId}`;
    manifest[`${kind}Count`] = rows.length;
    tables[kind] = [[JSON.stringify({ schemaVersion: 1, runId, kind, count: rows.length })], ...rows.map((row) => [JSON.stringify(row)])];
  }
  return { manifest, tables };
}
function resetFixture() { fixture = makeFixture(); readOverride = undefined; batchOverride = undefined; credentialFailure = false; }
function row(kind, index = 1) { return JSON.parse(fixture.tables[kind][index][0]); }
function setRow(kind, value, index = 1) { fixture.tables[kind][index] = [JSON.stringify(value)]; }
async function reject(run, pattern) {
  await assert.rejects(run, (error) => {
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.match(error.message, pattern);
    return true;
  });
}

async function run() {
  resetFixture();
  assert.deepEqual(source.getAdsConnection(), { source: "sheets", configured: true, customerId, credentialMode: "service-account", missing: [] });
  process.env.GOOGLE_ADS_CLIENT_ID = "unrelated-ads-oauth";
  process.env.GOOGLE_ADS_CLIENT_SECRET = secret;
  process.env.GOOGLE_ADS_REFRESH_TOKEN = secret;
  const initial = await source.fetchAdsSnapshot();
  assert.deepEqual(authOptions.scopes, ["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  assert.equal(authOptions.email, "shared-sheets@example.invalid", "dedicated Ads credentials must not replace existing Sheets access");
  assert.equal(initial.fetchedAt, fixture.manifest.exportedAt, "import time must not masquerade as source freshness");
  assert.equal(initial.purchaseTracking.revenueValidFrom, "2026-10-17");
  const period = analytics.buildAdsPeriod({ kind: "custom", from: "2026-10-19", to: "2026-10-19" });
  const report = analytics.buildAdsReport(initial, period, analytics.defaultAdsSettings());
  assert.equal(report.summary.spendEur, 5);
  assert.ok(Math.abs(report.summary.revenueBam - 100) < 1e-8);
  assert.ok(Math.abs(report.summary.roas - 100 / (5 * 1.95583)) < 1e-8, "5 EUR and 100 BAM must use the same currency");

  for (const mutate of [
    () => { fixture.manifest.customerId = "1234567890"; },
    () => { fixture.manifest.complete = false; },
    () => { fixture.manifest.schemaVersion = 2; },
    () => { fixture.manifest.exportedAt = new Date(now + 6 * 60_000).toISOString(); },
    () => { fixture.manifest.exportedAt = new Date(now - 6 * 60 * 60_000 - 1).toISOString(); },
    () => { fixture.manifest.fromDate = "2026-02-30"; },
    () => { fixture.manifest.fromDate = "2026-01-01"; },
    () => { fixture.manifest.toDate = "2026-10-21"; },
    () => { fixture.manifest.timeZone = "Invalid/Zone"; },
    () => { fixture.manifest.campaignsTab = "Orders"; },
    () => { fixture.manifest.adsCount = 100001; },
    () => { fixture.tables.campaigns.pop(); },
    () => { setRow("ads", { ...row("ads"), clicks: "10" }); },
    () => { setRow("campaigns", { ...row("campaigns"), cost: null }); },
    () => { const value = row("campaigns"); delete value.purchases; setRow("campaigns", value); },
    () => { setRow("campaigns", { ...row("campaigns"), hour: 24 }); },
    () => { setRow("campaigns", { ...row("campaigns"), date: "2026-08-31" }); },
    () => { setRow("campaigns", { ...row("campaigns"), clicks: -1 }); },
    () => { setRow("campaigns", { schemaVersion: 1, runId: "different", kind: "campaigns", count: 1 }, 0); },
    () => { fixture.tables.campaigns.push(fixture.tables.campaigns[1]); fixture.manifest.campaignsCount = 2; setRow("campaigns", { schemaVersion: 1, runId: fixture.manifest.runId, kind: "campaigns", count: 2 }, 0); },
    () => { setRow("tracking", { ...row("tracking"), fixedValueActions: ["unknown action"] }); },
    () => { const value = row("tracking"); delete value.valueSettingsChecked; setRow("tracking", value); },
  ]) {
    resetFixture(); mutate();
    await reject(() => sheets.fetchAdsSheetSnapshot(), /Google Ads Sheet/);
  }
  resetFixture();
  let reads = 0;
  readOverride = () => ({ data: { values: [[JSON.stringify({ ...fixture.manifest, ...(++reads > 1 ? { exportedAt: new Date(now).toISOString() } : {}) })]] } });
  await reject(() => sheets.fetchAdsSheetSnapshot(), /tokom čitanja/);
  resetFixture();
  credentialFailure = true;
  await reject(() => sheets.fetchAdsSheetSnapshot(), /nije moguće pročitati/);
  resetFixture();
  batchOverride = () => { throw new Error(secret); };
  await reject(() => sheets.fetchAdsSheetSnapshot(), /nije moguće pročitati/);
  resetFixture();
  batchOverride = () => ({ data: { valueRanges: [{ values: fixture.tables.campaigns }] } });
  await reject(() => sheets.fetchAdsSheetSnapshot(), /sve kartice/);
  resetFixture();
  const beforeTimeout = now;
  batchOverride = () => {
    now += 4 * 60_000;
    return { data: { valueRanges: ["campaigns", "ads", "tracking"].map((kind) => ({ values: fixture.tables[kind] })) } };
  };
  await reject(() => sheets.fetchAdsSheetSnapshot(), /četiri minute/);
  now = beforeTimeout;

  resetFixture();
  for (const kind of ["campaigns", "ads"]) {
    fixture.manifest[`${kind}Count`] = 0;
    fixture.tables[kind] = [[JSON.stringify({ schemaVersion: 1, runId: fixture.manifest.runId, kind, count: 0 })]];
  }
  setRow("tracking", { configured: false, actions: [], valueSettingsChecked: false, fixedValueActions: [] });
  const empty = await sheets.fetchAdsSheetSnapshot();
  assert.deepEqual(empty.campaigns, [], "an explicitly complete empty export is valid");
  assert.equal(analytics.buildAdsReport(empty, period, analytics.defaultAdsSettings()).summary.purchases, null, "empty tracking must not become verified zero sales");

  resetFixture();
  setRow("tracking", { ...row("tracking"), fixedValueActions: ["Purchase"] });
  let protectedReport = analytics.buildAdsReport(await sheets.fetchAdsSheetSnapshot(), period, analytics.defaultAdsSettings());
  assert.equal(protectedReport.summary.purchases, 1);
  assert.equal(protectedReport.summary.roas, null, "fixed values never become revenue");
  resetFixture();
  setRow("tracking", { ...row("tracking"), valueSettingsChecked: false });
  protectedReport = analytics.buildAdsReport(await sheets.fetchAdsSheetSnapshot(), period, analytics.defaultAdsSettings());
  assert.equal(protectedReport.summary.revenueBam, null, "unknown value settings stay unknown");
  resetFixture();
  setRow("tracking", { ...row("tracking"), revenueValidFrom: "2026-01-01" });
  assert.equal((await sheets.fetchAdsSheetSnapshot()).purchaseTracking.revenueValidFrom, "2026-10-17", "sheet cannot loosen server cutoff");
  setRow("tracking", { ...row("tracking"), revenueValidFrom: "2026-10-20" });
  protectedReport = analytics.buildAdsReport(await sheets.fetchAdsSheetSnapshot(), period, analytics.defaultAdsSettings());
  assert.equal(protectedReport.summary.roas, null, "later source cutoff can tighten protection");

  resetFixture();
  assert.deepEqual(await sync.syncGoogleAds(true), { ok: true });
  let stored = store.readAdsState(customerId);
  assert.equal(stored.lastSuccessAt, fixture.manifest.exportedAt);
  const saved = stored.snapshot;
  const data = await (await route.GET(new Request("https://admin.example.invalid/api/ads?kind=custom&from=2026-10-19&to=2026-10-19"))).json();
  assert.equal(data.connection.source, "sheets");
  assert.equal(data.report.summary.spendEur, 5);
  assert.doesNotMatch(JSON.stringify(data), /SENSITIVE|fixture_private_spreadsheet/);
  now += 5 * 60_000;
  fixture.tables.ads.pop();
  assert.equal((await sync.syncGoogleAds(true)).ok, false);
  stored = store.readAdsState(customerId);
  assert.deepEqual(stored.snapshot, saved, "partial export must preserve prior complete snapshot");
  assert.equal(stored.lastSuccessAt, saved.fetchedAt);
  assert.equal(stored.running, false, "failure releases the sync lease");
  resetFixture();
  now += 5 * 60_000;
  fixture.manifest.exportedAt = new Date(Date.parse(saved.fetchedAt) - 60_000).toISOString();
  assert.equal((await sync.syncGoogleAds(true)).ok, false, "older exports must never replace newer metrics");
  assert.deepEqual(store.readAdsState(customerId).snapshot, saved);
  now += 5 * 60_000;
  resetFixture();
  const concurrent = await Promise.all([sync.syncGoogleAds(), sync.syncGoogleAds()]);
  assert.deepEqual(concurrent, [{ ok: true }, { ok: true, skipped: true }]);
  now += 5 * 60_000;
  const beforeReads = getCalls;
  assert.equal((await sync.syncGoogleAds()).ok, true, "Sheets can poll each5min without triggering Google Ads report execution");
  assert.equal(getCalls, beforeReads + 2);

  const before = batchCalls;
  process.env.GOOGLE_ADS_REVENUE_VALID_FROM = "2026-02-31";
  assert.equal(source.getAdsConnection().configured, false);
  await reject(() => source.fetchAdsSnapshot(), /nije potpuno podešeno/);
  assert.equal(batchCalls, before);
  delete process.env.GOOGLE_ADS_REPORT_SPREADSHEET_ID;
  assert.equal(source.getAdsConnection().source, "api", "existing API remains default when no report Sheet is selected");
  assert.equal(schema.ADS_SHEET_MAX_AGE_MS, 6 * 60 * 60_000);
  console.log("Google Ads Sheets adapter/sync tests passed (no credentials loaded, no network).");
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  Module._extensions[".ts"] = originalTs;
  global.fetch = originalFetch;
  global.Date = OriginalDate;
  for (const key of Object.keys(process.env).filter((key) => /^GOOGLE_/.test(key))) delete process.env[key];
  Object.assign(process.env, savedEnv);
  sqlite.close();
});

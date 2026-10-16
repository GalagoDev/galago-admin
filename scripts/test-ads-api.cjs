/* eslint-disable @typescript-eslint/no-require-imports -- Isolate server modules with the CommonJS loader. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");

// Real client, routes, analytics and SQL; only Google, session cookies and the
// database connection are replaced. This script never loads .env or uses network.
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

const envKeys = [
  "APP_PASSWORD",
  "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "GOOGLE_ADS_SYNC_SECRET",
  "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", "GOOGLE_SERVICE_ACCOUNT_PATH",
];
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
for (const key of envKeys) delete process.env[key];
process.env.APP_PASSWORD = "local-ads-test-password";
const customerId = "3221742913";
const privateSentinel = "TEST-PRIVATE-CREDENTIAL-DO-NOT-RETURN";
process.env.GOOGLE_ADS_CUSTOMER_ID = "322-174-2913";
process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "ads-test@example.invalid", private_key: privateSentinel,
});
process.env.GOOGLE_ADS_SYNC_SECRET = "test-cron-secret";

const sqlite = new DatabaseSync(":memory:");
const database = {
  exec: (sql) => sqlite.exec(sql),
  prepare: (sql) => sqlite.prepare(sql),
  transaction: (run) => (...args) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = run(...args); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
let authenticated = true;
let authCookieOverride;
let tokenFailure = false;
let authCalls = [];
class JWT {
  constructor(options) { authCalls.push({ mode: "service-account", options }); }
  async getAccessToken() {
    if (tokenFailure) throw new Error(privateSentinel);
    return { token: "test-oauth-access-token" };
  }
}
class OAuth2 {
  constructor() { authCalls.push({ mode: "oauth" }); }
  setCredentials() {}
  async getAccessToken() {
    if (tokenFailure) throw new Error(privateSentinel);
    return { token: "test-oauth-access-token" };
  }
}
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "googleapis") return { google: { auth: { JWT, OAuth2 } } };
  if (request === "@/lib/db") return { getDb: () => database };
  if (request === "next/headers") return { cookies: async () => ({ get: () => authenticated ? { value: authCookieOverride ?? session.createSession() } : undefined }) };
  if (request === "@/lib/google-auth") return {
    getGoogleServiceAccountCredentials: () => ({ client_email: "shared-test@example.invalid", private_key: privateSentinel }),
  };
  return originalLoad.call(this, request, parent, isMain);
};

const calls = [];
let responseFor;
global.fetch = async (url, options) => {
  assert.equal(url, `https://googleads.googleapis.com/v26/customers/${customerId}/googleAds:search`);
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer test-oauth-access-token");
  assert.equal(options.cache, "no-store");
  const body = JSON.parse(options.body);
  const call = { url, options, ...body };
  calls.push(call);
  assert.ok(responseFor, "every fetch must be satisfied by an explicit local fixture");
  return responseFor(call);
};

const session = require("../src/lib/session.ts");
const client = require("../src/lib/google-ads-client.ts");
const store = require("../src/lib/ads-store.ts");
const sync = require("../src/lib/ads-sync.ts");
const analytics = require("../src/lib/ads-analytics.ts");
const dashboardRoute = require("../src/app/api/ads/route.ts");
const settingsRoute = require("../src/app/api/ads/settings/route.ts");
const syncRoute = require("../src/app/api/ads/sync/route.ts");
const origin = "https://admin.example.invalid";
function request(route, { method = "POST", withOrigin = true, originValue = origin, body, secret } = {}) {
  return new Request(`${origin}${route}`, {
    method,
    headers: {
      ...(withOrigin ? { Origin: originValue } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(secret === undefined ? {} : { "x-integration-secret": secret }),
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}
function campaign(id, date, hour, metrics, channel = "SEARCH") {
  return { campaign: { id, name: `Campaign ${id}`, status: "ENABLED", advertisingChannelType: channel }, segments: { date, hour }, metrics };
}
function ad(id, date, metrics) {
  return { campaign: { id: "1", name: "Campaign 1", status: "ENABLED" }, adGroup: { id: "11", name: "Ad group", status: "ENABLED" }, adGroupAd: { status: "ENABLED", ad: { id, name: `Ad ${id}`, type: "RESPONSIVE_SEARCH_AD" } }, segments: { date }, metrics };
}
function goodResponse(call) {
  const { query, pageToken } = call;
  if (query.includes("FROM customer")) return Response.json({ results: [{ customer: { id: customerId, descriptiveName: "Test account", currencyCode: "EUR", timeZone: "Europe/Sarajevo" } }] });
  if (query.includes("FROM conversion_action")) {
    assert.match(query, /conversion_action\.category = 'PURCHASE'/);
    return Response.json({ results: [{ conversionAction: { name: "Purchase", primaryForGoal: true } }, { conversionAction: { name: "Secondary purchase", primaryForGoal: false } }] });
  }
  const purchases = query.includes("metrics.conversions");
  if (purchases) {
    assert.match(query, /segments\.conversion_action_category = 'PURCHASE'/);
    assert.doesNotMatch(query, /metrics\.(cost_micros|impressions|clicks)/, "purchase segmentation must not repeat cost metrics");
  } else {
    assert.match(query, /metrics\.cost_micros/);
    assert.doesNotMatch(query, /conversion_action_category|metrics\.conversions/);
  }
  if (query.includes("FROM ad_group_ad")) {
    assert.doesNotMatch(query, /segments\.hour/, "Google does not support hourly individual-ad metrics");
    assert.match(query, /campaign\.status/, "ad eligibility must account for campaign status");
    assert.match(query, /ad_group\.status/, "ad eligibility must account for ad-group status");
    return Response.json({ results: purchases ? [
      ad("111", "2026-10-15", { conversions: 0.75, conversionsValue: 60.25 }),
      ad("112", "2026-10-15", { conversions: 1, conversionsValue: 50 }),
    ] : [ad("111", "2026-10-15", { costMicros: "5000000", impressions: "100", clicks: "10" })] });
  }
  assert.match(query, /FROM campaign/);
  assert.match(query, /segments\.hour/);
  if (purchases) return Response.json({ results: [
    campaign("1", "2026-10-15", 8, { conversions: 0.5, conversionsValue: 40.25 }),
    campaign("1", "2026-10-15", 8, { conversions: 0.25, conversionsValue: 20 }),
    campaign("3", "2026-10-15", 10, { conversions: 1, conversionsValue: 50 }),
  ] });
  if (!pageToken) return Response.json({ results: [campaign("1", "2026-10-15", 8, { costMicros: "5000000", impressions: "100", clicks: "10" })], nextPageToken: "fixture-page-2" });
  assert.equal(pageToken, "fixture-page-2");
  return Response.json({ results: [campaign("2", "2026-10-15", 9, { costMicros: "2000000", impressions: "50", clicks: "5" }, "PERFORMANCE_MAX")] });
}
async function statusOf(run, expected) {
  const response = await run();
  assert.equal(response.status, expected);
  return response;
}
async function rejectsSafely(run, expected) {
  await assert.rejects(run, (error) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, new RegExp(privateSentinel));
    if (expected) assert.match(error.message, expected);
    return true;
  });
}

async function testConnectionAndQueries() {
  assert.deepEqual(client.getAdsConnection(), { configured: true, customerId, credentialMode: "service-account", missing: [] });
  process.env.GOOGLE_ADS_CUSTOMER_ID = "bad-customer";
  assert.equal(client.getAdsConnection().configured, false);
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /ID računa/);
  assert.equal(calls.length, 0);
  process.env.GOOGLE_ADS_CUSTOMER_ID = customerId;
  responseFor = goodResponse;
  const snapshot = await client.fetchGoogleAdsSnapshot(new Date());
  assert.equal(snapshot.fromDate, "2026-07-23");
  assert.equal(snapshot.toDate, "2026-10-20");
  assert.equal(snapshot.campaigns.length, 3);
  assert.equal(snapshot.campaigns.reduce((sum, row) => sum + row.cost, 0), 7, "purchase rows must not duplicate spend");
  assert.equal(snapshot.campaigns.reduce((sum, row) => sum + row.purchases, 0), 1.75, "fractional conversions must survive merging");
  assert.equal(snapshot.campaigns.reduce((sum, row) => sum + row.purchaseValue, 0), 110.25);
  assert.equal(snapshot.campaigns.find((row) => row.campaignId === "3").cost, 0, "conversion-only campaign rows must survive");
  assert.equal(snapshot.ads.find((row) => row.adId === "112").purchaseValue, 50, "conversion-only ad rows must survive");
  assert.deepEqual(snapshot.purchaseTracking, { configured: true, actions: ["Purchase"] });
  assert.equal(calls.filter((call) => call.pageToken).length, 1, "all pages must be fetched");
  assert.equal(calls.length, 7);
  assert.deepEqual(authCalls.at(-1).options.scopes, ["https://www.googleapis.com/auth/adwords"]);
  assert.ok(calls.every((call) => !call.options.headers["developer-token"]));
  return snapshot;
}

async function testRoutesAndValidation(snapshot) {
  const valid = { targetRoas: 5, minimumSpendBam: 30, minimumClicks: 30, minimumPurchases: 3, attributionLagDays: 3 };
  authenticated = false;
  const before = calls.length;
  await statusOf(() => dashboardRoute.GET(request("/api/ads", { method: "GET" })), 401);
  await statusOf(() => settingsRoute.POST(request("/api/ads/settings", { body: valid })), 401);
  await statusOf(() => syncRoute.POST(request("/api/ads/sync")), 401);
  await statusOf(() => syncRoute.POST(request("/api/ads/sync", { secret: "wrong-cron-token" })), 401);
  // Equal JS string lengths can have different UTF-8 byte lengths. Reject, don't throw.
  await statusOf(() => syncRoute.POST(request("/api/ads/sync", { secret: "é".repeat(process.env.GOOGLE_ADS_SYNC_SECRET.length) })), 401);
  assert.equal(calls.length, before, "unauthorized callers must not reach Google");
  authenticated = true;
  authCookieOverride = "ok";
  await statusOf(() => dashboardRoute.GET(request("/api/ads", { method: "GET" })), 401);
  await statusOf(() => settingsRoute.POST(request("/api/ads/settings", { body: valid })), 401);
  await statusOf(() => syncRoute.POST(request("/api/ads/sync")), 401);
  authCookieOverride = undefined;
  for (const options of [{ withOrigin: false }, { originValue: "https://attacker.example.invalid" }]) {
    await statusOf(() => settingsRoute.POST(request("/api/ads/settings", { ...options, body: valid })), 403);
    await statusOf(() => syncRoute.POST(request("/api/ads/sync", options)), 403);
  }
  assert.equal(calls.length, before);
  for (const body of [
    "{not-json", {}, { ...valid, targetRoas: 0 }, { ...valid, targetRoas: "5" },
    { ...valid, minimumSpendBam: -1 }, { ...valid, minimumClicks: 1.5 },
    { ...valid, minimumPurchases: 0 }, { ...valid, attributionLagDays: 0 },
    { ...valid, attributionLagDays: 31 }, { ...valid, unknown: true },
  ]) await statusOf(() => settingsRoute.POST(request("/api/ads/settings", { body })), 400);
  assert.deepEqual(store.readAdsSettings(), analytics.defaultAdsSettings(), "invalid settings must not persist");
  await statusOf(() => settingsRoute.POST(request("/api/ads/settings", { body: valid })), 200);
  assert.deepEqual(store.readAdsSettings(), valid);
  await statusOf(() => settingsRoute.POST(request("/api/ads/settings", { body: { ...valid, targetRoas: null } })), 200);
  assert.equal(store.readAdsSettings().targetRoas, null);
  for (const query of ["kind=unknown", "kind=custom&from=2026-02-31&to=2026-03-01", "kind=custom&from=2026-10-16&to=2026-10-15", "kind=custom&from=2026-01-01&to=2026-10-16"]) {
    await statusOf(() => dashboardRoute.GET(request(`/api/ads?${query}`, { method: "GET" })), 400);
  }
  assert.equal(store.claimAdsSync(customerId, 0), true);
  store.saveAdsSnapshot(snapshot);
  const response = await statusOf(() => dashboardRoute.GET(request("/api/ads?kind=workday&date=2026-10-16", { method: "GET" })), 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const data = await response.json();
  assert.equal(data.report.summary.spendEur, 7);
  assert.equal(data.report.summary.purchases, 1.75);
  assert.equal(data.report.summary.roas, 110.25 / 7);
  assert.doesNotMatch(JSON.stringify(data), /TEST-PRIVATE-CREDENTIAL|test-oauth-access-token/);

  for (const query of [
    "kind=custom&from=2026-07-01&to=2026-07-05",
    "kind=custom&from=2026-07-22&to=2026-07-24",
  ]) {
    const unavailable = await statusOf(() => dashboardRoute.GET(request(`/api/ads?${query}`, { method: "GET" })), 400);
    const unavailableData = await unavailable.json();
    assert.equal(unavailableData.report, undefined, "uncovered history must not render a fabricated zero-spend report");
    assert.ok(unavailableData.error);
    assert.equal(unavailableData.data.report, null);
    assert.equal(unavailableData.data.connection.configured, true, "range errors must preserve connection metadata so users can refresh");
  }
  await statusOf(() => dashboardRoute.GET(request("/api/ads?kind=custom&from=2026-07-23&to=2026-07-24", { method: "GET" })), 200);
  await statusOf(() => dashboardRoute.GET(request("/api/ads?kind=workday&date=2026-10-21", { method: "GET" })), 200);
  const previousNow = now;
  now = OriginalDate.parse("2026-10-23T10:00:00Z");
  store.saveAdsSnapshot({ ...snapshot, toDate: "2026-10-23" });
  await statusOf(() => dashboardRoute.GET(request("/api/ads?kind=weekend&date=2026-10-26", { method: "GET" })), 200);
  now = previousNow;
  store.saveAdsSnapshot({ ...snapshot, toDate: "2026-10-15" });
  const stale = await statusOf(() => dashboardRoute.GET(request("/api/ads?kind=workday&date=2026-10-16", { method: "GET" })), 400);
  assert.equal((await stale.json()).data.report, null);
  store.saveAdsSnapshot(snapshot);
}

async function testSyncAndCooldown() {
  sqlite.exec("DELETE FROM ads_snapshots");
  responseFor = goodResponse;
  const before = calls.length;
  let response = await statusOf(() => syncRoute.POST(request("/api/ads/sync")), 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, before + 7);
  assert.equal(store.readAdsState(customerId).running, false);
  const initialState = store.readAdsState(customerId);
  response = await statusOf(() => syncRoute.POST(request("/api/ads/sync")), 200);
  assert.deepEqual(await response.json(), { ok: true, skipped: true });
  assert.equal(calls.length, before + 7);
  now += 5 * 60_000;
  authenticated = false;
  response = await statusOf(() => syncRoute.POST(request("/api/ads/sync", { withOrigin: false, secret: process.env.GOOGLE_ADS_SYNC_SECRET })), 200);
  assert.deepEqual(await response.json(), { ok: true, skipped: true }, "cron has a one-hour cooldown");
  assert.equal(calls.length, before + 7);
  authenticated = true;
  responseFor = (call) => call.query.includes("FROM campaign") && call.query.includes("metrics.conversions")
    ? Response.json({ error: { message: privateSentinel, details: [{ code: "USER_PERMISSION_DENIED" }] } }, { status: 403 })
    : goodResponse(call);
  response = await statusOf(() => syncRoute.POST(request("/api/ads/sync")), 502);
  const failure = await response.json();
  assert.equal(failure.ok, false);
  assert.doesNotMatch(failure.error, new RegExp(privateSentinel));
  const failedState = store.readAdsState(customerId);
  assert.deepEqual(failedState.snapshot, initialState.snapshot, "failed report must preserve the complete previous snapshot");
  assert.equal(failedState.lastSuccessAt, initialState.lastSuccessAt);
  assert.equal(failedState.running, false, "failure must release the sync lock");
  assert.ok(failedState.error);
  assert.deepEqual(await sync.syncGoogleAds(true), { ok: true, skipped: true }, "failed attempts also obey the cooldown");
  now += 60 * 60_000;
  responseFor = goodResponse;
  authenticated = false;
  response = await statusOf(() => syncRoute.POST(request("/api/ads/sync", { withOrigin: false, secret: process.env.GOOGLE_ADS_SYNC_SECRET })), 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(store.readAdsState(customerId).error, null, "successful sync clears the error");
  authenticated = true;
  now += 5 * 60_000;
  const concurrentBefore = calls.length;
  const concurrent = await Promise.all([sync.syncGoogleAds(true), sync.syncGoogleAds(true)]);
  assert.deepEqual(concurrent, [{ ok: true }, { ok: true, skipped: true }]);
  assert.equal(calls.length, concurrentBefore + 7, "only one concurrent worker fetches the snapshot");
}

async function testForwardedOrigins() {
  const validSettings = store.readAdsSettings();
  const allowed = [
    { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    { origin: "http://[::1]:3000", host: "[::1]:3000" },
    { origin, host: "localhost:3000", "x-forwarded-host": "admin.example.invalid", "x-forwarded-proto": "https" },
    { origin, host: "localhost:3000", "x-forwarded-host": "admin.example.invalid, internal:3000", "x-forwarded-proto": "https, http" },
    { origin: "https://admin.example.invalid:8443", "x-forwarded-host": "admin.example.invalid:8443", "x-forwarded-proto": "https" },
  ];
  const denied = [
    { host: "127.0.0.1:3000" },
    { origin: "null", host: "127.0.0.1:3000" },
    { origin: "http://attacker.example.invalid", host: "127.0.0.1:3000" },
    { origin: "http://127.0.0.1:3001", host: "127.0.0.1:3000" },
    { origin, host: "admin.example.invalid" }, // Internal HTTP is not browser HTTPS without a forwarded protocol.
    { origin, "x-forwarded-host": "attacker.example.invalid, admin.example.invalid", "x-forwarded-proto": "https" },
    { origin, "x-forwarded-host": "admin.example.invalid", "x-forwarded-proto": "ftp" },
    { origin, "x-forwarded-host": "", "x-forwarded-proto": "https" },
    { origin, "x-forwarded-host": "admin.example.invalid/path", "x-forwarded-proto": "https" },
    { origin, "x-forwarded-host": "user@admin.example.invalid", "x-forwarded-proto": "https" },
    ...[
      "https://admin.example.invalid, https://attacker.example.invalid",
      "https://user@admin.example.invalid", "https://admin.example.invalid/path",
      "https://admin.example.invalid/", "https://admin.example.invalid?query=1",
      "https://admin.example.invalid#fragment", "https:\\admin.example.invalid", "file://admin.example.invalid",
    ].map((value) => ({ origin: value, "x-forwarded-host": "admin.example.invalid", "x-forwarded-proto": "https" })),
  ];
  const before = calls.length;
  for (const [headers, status] of [...allowed.map((item) => [item, 200]), ...denied.map((item) => [item, 403])]) {
    for (const [pathname, handler] of [["/api/ads/settings", settingsRoute.POST], ["/api/ads/sync", syncRoute.POST]]) {
      const body = pathname.endsWith("settings") ? JSON.stringify(validSettings) : undefined;
      const incoming = new Request(`http://localhost:3000${pathname}`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body,
      });
      const response = await handler(incoming);
      assert.equal(response.status, status, `${pathname} must check the external host, protocol and port for ${JSON.stringify(headers)}`);
    }
  }
  assert.deepEqual(store.readAdsSettings(), validSettings);
  assert.equal(calls.length, before, "cross-origin requests never sync, and allowed requests still respect the cooldown");
}

async function testSafeFailuresAndCredentials() {
  const before = calls.length;
  tokenFailure = true;
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /Google prijava nije uspjela/);
  tokenFailure = false;
  assert.equal(calls.length, before);
  process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON = "malformed-json";
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /Google prijava nije uspjela/);
  delete process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = "fixture-credentials-resolved-by-mock";
  responseFor = goodResponse;
  await client.fetchGoogleAdsSnapshot();
  assert.equal(authCalls.at(-1).options.email, "shared-test@example.invalid", "existing Sheets service-account auth is reused");
  process.env.GOOGLE_ADS_CLIENT_ID = "test-client";
  process.env.GOOGLE_ADS_CLIENT_SECRET = privateSentinel;
  process.env.GOOGLE_ADS_REFRESH_TOKEN = privateSentinel;
  await client.fetchGoogleAdsSnapshot();
  assert.equal(authCalls.at(-1).mode, "oauth");
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "invalid-manager";
  const beforeInvalidManager = calls.length;
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /upravljačkog računa/);
  assert.equal(calls.length, beforeInvalidManager);
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "123-456-7890";
  responseFor = (call) => {
    assert.equal(call.options.headers["login-customer-id"], "1234567890");
    return goodResponse(call);
  };
  await client.fetchGoogleAdsSnapshot();
  delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  responseFor = () => { throw new Error(`network error ${privateSentinel}`); };
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /veza je prekinuta/);
  for (const [status, code, expected] of [
    [400, "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION", /Explorer/],
    [400, "SERVICE_DISABLED", /nije omogućen/],
    [401, "TOKEN_ERROR", /ovlaštenje je isteklo/],
    [403, "USER_PERMISSION_DENIED", /nema pristup/],
    [400, "UNRECOGNIZED_ERROR", /HTTP 400/],
  ]) {
    responseFor = () => Response.json({ error: { message: privateSentinel, code } }, { status });
    await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), expected);
  }
  responseFor = () => Response.json({ results: "not-an-array" });
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /neispravan izvještaj/);
  responseFor = (call) => call.query.includes("FROM customer") ? goodResponse(call) : Response.json({ results: [], nextPageToken: "never-ending-page" });
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /prevelik/);
  responseFor = (call) => {
    if (call.query.includes("FROM customer")) return goodResponse(call);
    if (call.query.includes("FROM campaign") && call.query.includes("cost_micros")) return Response.json({ results: [campaign("1", "2026-10-15", 8, { costMicros: "NaN" })] });
    return Response.json({ results: [] });
  };
  await rejectsSafely(() => client.fetchGoogleAdsSnapshot(), /neispravnu vrijednost/);
  responseFor = (call) => call.query.includes("FROM customer") ? goodResponse(call) : Response.json({});
  const empty = await client.fetchGoogleAdsSnapshot();
  assert.deepEqual(empty.campaigns, []);
  assert.deepEqual(empty.ads, []);
  assert.equal(empty.purchaseTracking.configured, false, "missing purchase tracking must not look like confirmed zero sales");
}

async function testInactiveParentStatus() {
  const cases = [
    ["PAUSED", "ENABLED", "ENABLED", "PAUSED"],
    ["REMOVED", "ENABLED", "ENABLED", "REMOVED"],
    ["ENABLED", "PAUSED", "ENABLED", "PAUSED"],
    ["ENABLED", "REMOVED", "ENABLED", "REMOVED"],
    ["PAUSED", "REMOVED", "ENABLED", "REMOVED"],
    ["ENABLED", "ENABLED", "PAUSED", "PAUSED"],
    ["PAUSED", "ENABLED", "REMOVED", "REMOVED"],
    ["ENABLED", "ENABLED", "ENABLED", "ENABLED"],
  ];
  const rows = cases.map(([campaignStatus, groupStatus, adStatus], index) => {
    const row = ad(`status-${index}`, "2026-10-10", { costMicros: "1000000", clicks: "10", impressions: "100" });
    row.campaign.status = campaignStatus;
    row.adGroup.status = groupStatus;
    row.adGroupAd.status = adStatus;
    return row;
  });
  responseFor = (call) => {
    if (call.query.includes("FROM ad_group_ad")) {
      assert.match(call.query, /campaign\.status/);
      assert.match(call.query, /ad_group\.status/);
      return Response.json({ results: call.query.includes("metrics.conversions") ? [] : rows });
    }
    return goodResponse(call);
  };
  const snapshot = await client.fetchGoogleAdsSnapshot();
  assert.deepEqual(snapshot.ads.map((row) => row.status), cases.map((item) => item[3]));
  const report = analytics.buildAdsReport(snapshot, analytics.buildAdsPeriod({ kind: "workday", date: "2026-10-16" }), analytics.defaultAdsSettings());
  for (const row of report.ads.filter((row) => row.status !== "ENABLED")) {
    assert.equal(row.recommendation.decision, "inactive", "an enabled ad inside an inactive parent must not be recommended for retention");
  }
}

async function testSyncDeadline() {
  const prior = store.readAdsState(customerId);
  now += 5 * 60_000;
  responseFor = (call) => {
    const response = goodResponse(call);
    now += 4 * 60_000;
    return response;
  };
  const result = await sync.syncGoogleAds(true);
  assert.equal(result.ok, false, "a sync must stop before its database lease can expire");
  assert.match(result.error, /četiri minute/);
  assert.doesNotMatch(result.error, new RegExp(privateSentinel));
  const after = store.readAdsState(customerId);
  assert.deepEqual(after.snapshot, prior.snapshot, "deadline failure cannot overwrite the prior complete report");
  assert.equal(after.lastSuccessAt, prior.lastSuccessAt);
  assert.equal(after.running, false, "deadline failure releases the lease");
  assert.equal(store.claimAdsSync(customerId, 0), true, "the released lease is claimable without waiting ten minutes");
  store.failAdsSync(customerId, "Test completed");
}

(async () => {
  const snapshot = await testConnectionAndQueries();
  await testRoutesAndValidation(snapshot);
  await testForwardedOrigins();
  await testSyncAndCooldown();
  await testSafeFailuresAndCredentials();
  await testInactiveParentStatus();
  await testSyncDeadline();
  console.log("Ads API tests passed: access control, same-origin writes, validation, purchase-only reporting, pagination, hourly limits, secret-safe errors, snapshot retention and sync cooldowns. No live data accessed.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  sqlite.close();
  global.Date = OriginalDate;
  global.fetch = originalFetch;
  Module._resolveFilename = originalResolve;
  Module._load = originalLoad;
  if (originalTs) Module._extensions[".ts"] = originalTs;
  else delete Module._extensions[".ts"];
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

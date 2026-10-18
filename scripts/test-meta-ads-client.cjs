/* eslint-disable @typescript-eslint/no-require-imports -- Isolated TS loader and local HTTP fixtures. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const originalLoad = Module._load;
const originalTs = Module._extensions[".ts"];
const originalFetch = global.fetch;
const RealDate = Date;
const keys = ["META_ADS_ACCESS_TOKEN", "META_REPORT_AD_ACCOUNT_IDS", "META_AD_ACCOUNT_IDS", "META_GRAPH_API_VERSION", "META_ADS_TO_BAM_RATES_JSON"];
const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const sentinel = "PRIVATE-TOKEN-NEVER-EXPOSE";
const target = "offsite_conversion.fb_pixel_purchase";
let now = RealDate.parse("2026-10-18T10:00:00Z");
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
Module._load = function(request, parent, isMain) { if (request === "server-only") return {}; return originalLoad.call(this, request, parent, isMain); };
const period = { kind: "weekend", date: "2026-10-19", start: "2026-10-16T06:00:00Z", end: "2026-10-19T06:00:00Z", complete: false, label: "Vikend" };
let client, calls, responseFor;
function row(overrides = {}) { return { account_id: "1270654995072639", account_currency: "USD", campaign_id: "101", campaign_name: "Kampanja", adset_id: "201", adset_name: "Skup", ad_id: "301", ad_name: "Oglas", date_start: "2026-10-17", date_stop: "2026-10-17", spend: "5.00", impressions: "100", clicks: "10", hourly_stats_aggregated_by_advertiser_time_zone: "09:00:00 - 09:59:59", actions: [{ action_type: target, value: "1" }, { action_type: "omni_purchase", value: "2" }, { action_type: "purchase", value: "1" }], action_values: [{ action_type: target, value: "50" }, { action_type: "purchase", value: "50" }], ...overrides }; }
function page(rows, after = null, nextHost = "https://graph.facebook.com") { return Response.json({ data: rows, ...(after ? { paging: { next: `${nextHost}/v25.0/act_1270654995072639/insights?after=${after}&access_token=upstream-secret`, cursors: { after } } } : {}) }); }
function fixture(url) {
  if (url.hostname === "api.frankfurter.dev") return Response.json({ rate: 0.9, date: url.searchParams.get("date"), base: "USD", quote: "EUR" });
  if (!url.pathname.endsWith("/insights")) return Response.json({ id: "act_1270654995072639", name: "Galago", currency: "USD", timezone_name: "Europe/Sarajevo" });
  return page([row()]);
}
function reset() {
  now = RealDate.parse("2026-10-18T10:00:00Z");
  keys.forEach(key => delete process.env[key]);
  process.env.META_ADS_ACCESS_TOKEN = sentinel;
  process.env.META_AD_ACCOUNT_IDS = "2851569935200724,1270654995072639";
  process.env.META_REPORT_AD_ACCOUNT_IDS = "act_1270654995072639,1270654995072639";
  delete require.cache[path.join(root, "src/lib/meta-ads-client.ts")];
  client = require("../src/lib/meta-ads-client.ts");
  calls = []; responseFor = fixture;
  global.fetch = async (raw, options) => {
    const url = new URL(raw);
    assert.ok(["graph.facebook.com", "api.frankfurter.dev"].includes(url.hostname));
    assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(url.searchParams.has("access_token"), false);
    if (url.hostname === "graph.facebook.com") assert.equal(options.headers.Authorization, `Bearer ${process.env.META_ADS_ACCESS_TOKEN}`);
    else assert.equal(options.headers, undefined);
    calls.push({ url, options });
    return responseFor(url, options);
  };
}
async function safeReject(action, pattern = /./) { await assert.rejects(action, error => error instanceof client.MetaAdsSourceError && pattern.test(error.message) && !error.message.includes(sentinel) && !error.message.includes("upstream-secret")); }
let passed = 0;
async function test(name, run) { reset(); await run(); passed++; console.log(`ok ${passed} - ${name}`); }
(async () => {
  await test("deduplicated Galago override, hourly parameters, original full period, USD daily FX and no alias double count", async () => {
    assert.deepEqual(client.getMetaAdsConnection(), { configured: true, accountIds: ["1270654995072639"], missing: [] });
    const result = await client.fetchMetaAdsSnapshot(period);
    assert.equal(result.accounts.length, 1); assert.equal(result.accounts[0].currency, "USD");
    assert.equal(result.periodEnd, "2026-10-19T06:00:00.000Z");
    assert.equal(result.hours[0].purchases, 1); assert.equal(result.hours[0].purchaseValue, 50);
    assert.equal(result.hours[0].bamRate, 0.9 * 1.95583); assert.equal(result.hours[0].status, null);
    assert.ok(result.warnings.some(warning => warning.includes("druge vrste kupovina")));
    const query = calls.find(call => call.url.searchParams.has("breakdowns")).url.searchParams;
    assert.equal(query.get("action_report_time"), "conversion"); assert.equal(query.get("use_unified_attribution_setting"), "true");
    assert.equal(query.get("level"), "ad"); assert.equal(query.get("time_increment"), "1");
    assert.deepEqual(JSON.parse(query.get("time_range")), { since: "2026-10-16", until: "2026-10-18" });
    assert.ok(calls.every(call => !call.url.pathname.includes("2851569935200724")));
  });
  await test("missing credentials or malformed account/version fails before HTTP", async () => {
    delete process.env.META_ADS_ACCESS_TOKEN;
    assert.equal(client.getMetaAdsConnection().configured, false);
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /nije povezan/);
    process.env.META_ADS_ACCESS_TOKEN = sentinel; process.env.META_REPORT_AD_ACCOUNT_IDS = "../../bad";
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /nije povezan/);
    process.env.META_REPORT_AD_ACCOUNT_IDS = "1270654995072639"; process.env.META_GRAPH_API_VERSION = "../bad";
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /nije povezan/);
    assert.equal(calls.length, 0);
  });
  await test("pagination uses fixed path and after cursor, never upstream token", async () => {
    responseFor = url => url.searchParams.has("breakdowns")
      ? (url.searchParams.get("after") ? page([row({ ad_id: "302" })]) : Response.json({data:[row()],paging:{next:'https://graph.facebook.com/v26.0/act_1270654995072639/insights?access_token=upstream-secret',cursors:{after:'next'}}})) : fixture(url);
    const result = await client.fetchMetaAdsSnapshot(period);
    assert.equal(result.hours.length, 2); assert.equal(calls.filter(c => c.url.searchParams.has("breakdowns")).length, 2);
    assert.ok(calls.filter(c => c.url.hostname === "graph.facebook.com").every(c => c.url.pathname.startsWith('/v25.0/')));
  });
  await test("external pagination, repeated cursors and duplicate rows fail closed", async () => {
    responseFor = url => url.searchParams.has("breakdowns") ? page([row()], "next", "https://attacker.test") : fixture(url);
    await safeReject(() => client.fetchMetaAdsSnapshot(period));
    responseFor = url => url.searchParams.has("breakdowns") ? page([row()], "same") : fixture(url);
    await safeReject(() => client.fetchMetaAdsSnapshot(period));
    responseFor = url => url.searchParams.has("breakdowns") ? page([row(), row()]) : fixture(url);
    await safeReject(() => client.fetchMetaAdsSnapshot(period));
  });
  await test("page limit rejects a still-running report without returning partial rows", async () => {
    let pageNumber = 0;
    responseFor = url => url.searchParams.has("breakdowns") ? page([row({ ad_id: String(1000 + ++pageNumber) })], `page-${pageNumber}`) : fixture(url);
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /prevelik/);
    assert.equal(pageNumber, 200);
  });
  await test("upstream errors and thrown network text never expose credentials; failures are not cached", async () => {
    responseFor = () => Response.json({ error: { code: 190, message: sentinel } }, { status: 400 });
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /pristup je istekao/);
    responseFor = () => { throw new Error(sentinel); };
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /trenutno nije dostupan/);
    responseFor = fixture;
    assert.equal((await client.fetchMetaAdsSnapshot(period)).hours.length, 1);
  });
  await test("website purchase with missing value remains unknown, but omitted zero arrays stay zero", async () => {
    responseFor = url => url.searchParams.has("breakdowns") ? page([row({ action_values: undefined }), row({ ad_id: "302", actions: undefined, action_values: undefined }), row({ ad_id: "303", action_values: [{ action_type: target, value: "0" }] })]) : fixture(url);
    const result = await client.fetchMetaAdsSnapshot(period);
    assert.equal(result.hours[0].purchases, 1); assert.equal(result.hours[0].purchaseValue, null);
    assert.equal(result.hours[1].purchases, 0); assert.equal(result.hours[1].purchaseValue, 0);
    assert.equal(result.hours[2].purchases, 1); assert.equal(result.hours[2].purchaseValue, null);
  });
  await test("FX failure keeps raw money but null BAM; EUR peg and explicit USD override skip FX", async () => {
    responseFor = url => url.hostname === "api.frankfurter.dev" ? Response.json({ error: { message: sentinel } }, { status: 500 }) : fixture(url);
    assert.equal((await client.fetchMetaAdsSnapshot(period)).hours[0].bamRate, null);
    process.env.META_ADS_TO_BAM_RATES_JSON = '{"USD":1.75,"EUR":7}';
    const count = calls.filter(call => call.url.hostname === "api.frankfurter.dev").length;
    assert.equal((await client.fetchMetaAdsSnapshot(period)).hours[0].bamRate, 1.75);
    assert.equal(calls.filter(call => call.url.hostname === "api.frankfurter.dev").length, count);
  });
  await test("FX must match base, quote and a valid recent nonfuture date", async () => {
    for (const bad of [{ base: "GBP" }, { quote: "USD" }, { date: "2026-10-18" }, { date: "2026-10-01" }, { date: "2026-02-30" }, { date: undefined }]) {
      responseFor = url => url.hostname === "api.frankfurter.dev" ? Response.json({ rate: 0.9, base: "USD", quote: "EUR", date: "2026-10-17", ...bad }) : fixture(url);
      process.env.META_ADS_ACCESS_TOKEN += "x";
      assert.equal((await client.fetchMetaAdsSnapshot(period)).hours[0].bamRate, null);
    }
    responseFor = url => url.hostname === "api.frankfurter.dev" ? Response.json({ rate: 0.9, base: "USD", quote: "EUR", date: "2026-10-16" }) : fixture(url);
    process.env.META_ADS_ACCESS_TOKEN += "x";
    assert.equal((await client.fetchMetaAdsSnapshot(period)).hours[0].bamRate, 0.9 * 1.95583);
  });
  await test("missing hourly dates with daily activity never become zero spend", async () => {
    responseFor = url => url.searchParams.has("breakdowns") ? page([]) : fixture(url);
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /satni podaci nisu dostupni/);
    responseFor = url => url.pathname.endsWith("/insights") ? page([]) : fixture(url);
    assert.deepEqual((await client.fetchMetaAdsSnapshot(period)).hours, []);
  });
  await test("wrong account/currency/date/hour or malformed metrics fail closed", async () => {
    for (const bad of [{ account_id: "999" }, { account_currency: "EUR" }, { date_start: "2026-10-15", date_stop: "2026-10-15" }, { hourly_stats_aggregated_by_advertiser_time_zone: "24:00:00 - 24:59:59" }, { spend: undefined }, { clicks: "NaN" }, { actions: [{ action_type: target, value: "1" }, { action_type: target, value: "2" }] }]) {
      responseFor = url => url.searchParams.has("breakdowns") ? page([row(bad)]) : fixture(url);
      await safeReject(() => client.fetchMetaAdsSnapshot(period));
    }
  });
  await test("any configured account failure prevents partial success", async () => {
    process.env.META_REPORT_AD_ACCOUNT_IDS = "1270654995072639,2851569935200724";
    responseFor = url => url.pathname.includes("2851569935200724") ? Response.json({ error: { code: 200, message: sentinel } }, { status: 403 }) : fixture(url);
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /ads_read/);
  });
  await test("singleflight, cloned five-minute cache, manual cooldown and token-key separation", async () => {
    let resolve;
    responseFor = url => !url.pathname.endsWith("/insights") && url.hostname === "graph.facebook.com" ? new Promise(done => { resolve = () => done(fixture(url)); }) : fixture(url);
    const first = client.fetchMetaAdsSnapshot(period); const second = client.fetchMetaAdsSnapshot(period);
    await new Promise(done => setImmediate(done)); assert.equal(calls.length, 1); resolve();
    const [one, two] = await Promise.all([first, second]); one.hours[0].spend = 999;
    assert.equal(two.hours[0].spend, 5); const count = calls.length;
    assert.equal((await client.fetchMetaAdsSnapshot(period)).hours[0].spend, 5); assert.equal(calls.length, count);
    const refresh = await client.fetchMetaAdsSnapshot(period, { force: true });
    assert.equal(refresh.fetchedAt, two.fetchedAt); assert.equal(calls.length, count);
    await safeReject(() => client.fetchMetaAdsSnapshot({ ...period, start: "2026-10-17T06:00:00Z" }, { force: true }), /60 sekundi/);
    now += 61_000; responseFor = fixture;
    await client.fetchMetaAdsSnapshot(period, { force: true }); assert.ok(calls.length > count);
    const afterForce = calls.length; process.env.META_ADS_ACCESS_TOKEN = sentinel + "-rotated";
    await client.fetchMetaAdsSnapshot(period); assert.ok(calls.length > afterForce);
    now += 301_000; responseFor = () => { throw new Error(sentinel); };
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /trenutno nije dostupan/);
  });
  await test("deadline covers metadata, pages and FX; overlarge/invalid period fails before HTTP", async () => {
    responseFor = url => { now += 120_001; return fixture(url); };
    await safeReject(() => client.fetchMetaAdsSnapshot(period), /120 sekundi/);
    const count = calls.length;
    await safeReject(() => client.fetchMetaAdsSnapshot({ ...period, start: "bad" }), /period nije ispravan/);
    await safeReject(() => client.fetchMetaAdsSnapshot({ ...period, start: "2025-01-01T00:00:00Z" }), /period nije ispravan/);
    assert.equal(calls.length, count);
  });
  console.log(`${passed} Meta Ads client tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch; global.Date = RealDate; Module._load = originalLoad; Module._extensions[".ts"] = originalTs;
  keys.forEach(key => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; });
});

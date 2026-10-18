/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server route tests. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const originalTs = Module._extensions[".ts"];
const OriginalDate = Date;
const originalFetch = global.fetch;
const originalPassword = process.env.APP_PASSWORD;
const now = Date.parse("2026-10-18T10:00:00Z");
global.Date = class extends OriginalDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
global.fetch = async () => { throw new Error("Unexpected network request in isolated Meta API test"); };
process.env.APP_PASSWORD = "meta-api-local-test-password";
let cookie;
let configured = true;
let failure;
const calls = [];
class MetaAdsSourceError extends Error {}

Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") return { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) };
  if (request === "@/lib/meta-ads-client") return {
    MetaAdsSourceError,
    getMetaAdsConnection: () => {
      calls.push({ type: "config" });
      return { configured, accountIds: configured ? ["123"] : [], missing: configured ? [] : ["Meta pristup"] };
    },
    fetchMetaAdsSnapshot: async (period, options) => {
      calls.push({ type: "fetch", period, options });
      if (failure) throw failure;
      return {
        fetchedAt: new Date().toISOString(), periodStart: period.start, periodEnd: period.end,
        accounts: [{ id: "123", name: "Galago", currency: "USD", timeZone: "Europe/Sarajevo" }],
        hours: [{
          accountId: "123", campaignId: "campaign-1", campaignName: "Lewa", adSetId: "set-1", adSetName: "Namještaj",
          adId: "ad-1", adName: "Lewa zlatni", status: "ACTIVE", date: "2026-10-17", hour: 9,
          impressions: 1000, clicks: 100, spend: 5, purchases: 2, purchaseValue: 100,
          purchaseActionType: "offsite_conversion.fb_pixel_purchase", bamRate: 1.7,
        }], attribution: "Web kupovine · Meta atribucija", warnings: [],
      };
    },
  };
  return originalLoad.call(this, request, parent, isMain);
};

const session = require("../src/lib/session.ts");
const route = require("../src/app/api/ads/meta/route.ts");
const request = (query = "kind=weekend") => new Request(`https://admin.example.invalid/api/ads/meta?${query}`);

(async () => {
  try {
    const denied = await route.GET(request());
    assert.equal(denied.status, 401);
    assert.equal(calls.length, 0, "no Meta access before authentication");
    cookie = "forged-session";
    assert.equal((await route.GET(request())).status, 401);
    cookie = session.createSession();
    for (const query of ["kind=custom&from=2026-02-30&to=2026-10-17", "kind=custom&from=2026-10-01&to=2026-10-30", "kind=invalid", "kind=custom&from=2025-01-01&to=2026-10-17"]) {
      assert.equal((await route.GET(request(query))).status, 400);
    }
    assert.equal(calls.length, 0, "invalid ranges do not request Meta data");
    configured = false;
    const missing = await (await route.GET(request())).json();
    assert.equal(missing.connection.configured, false);
    assert.equal(missing.report, null);
    assert.equal(calls.filter((call) => call.type === "fetch").length, 0);
    configured = true;
    const response = await route.GET(request("kind=weekend&refresh=1&accountId=unapproved"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const data = await response.json();
    assert.equal(data.report.summary.spendBam, 8.5);
    assert.equal(data.report.summary.revenueBam, 170);
    assert.equal(data.report.summary.roas, 20);
    assert.equal(data.report.ads.length, 1);
    assert.equal(data.report.ads[0].revenueBam, 170);
    assert.deepEqual(data.connection.accountIds, ["123"], "account scope comes from server configuration only");
    const fetchCall = calls.find((call) => call.type === "fetch");
    assert.equal(fetchCall.options.force, true);
    assert.equal(fetchCall.period.start, "2026-10-16T06:00:00.000Z");
    assert.equal(fetchCall.period.end, "2026-10-19T06:00:00.000Z");
    failure = new MetaAdsSourceError("Meta pristup je istekao. Obnovi vezu.");
    const knownError = await (await route.GET(request())).json();
    assert.equal(knownError.report, null);
    assert.match(knownError.error, /istekao/);
    failure = new Error("PRIVATE-META-TOKEN-DO-NOT-EXPOSE");
    const unexpected = await (await route.GET(request())).json();
    assert.equal(unexpected.report, null);
    assert.equal(unexpected.fetchedAt, null);
    assert.doesNotMatch(JSON.stringify(unexpected), /PRIVATE-META-TOKEN/);
    assert.match(unexpected.error, /trenutno nije dostupan/);
    console.log("Meta API tests passed: signed sessions, range validation, server account scope, exact period totals and secret-safe failures. No live requests.");
  } finally {
    Module._resolveFilename = originalResolve;
    Module._load = originalLoad;
    if (originalTs) Module._extensions[".ts"] = originalTs; else delete Module._extensions[".ts"];
    global.Date = OriginalDate;
    global.fetch = originalFetch;
    if (originalPassword === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = originalPassword;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "google-ads-sheet-export.js"), "utf8");
const accountId = "3221742913";
const actionId = `customers/${accountId}/conversionActions/1`;
function campaign(id = "10", metrics = { impressions: "100", clicks: "10", costMicros: "5000000" }) {
  return { campaign: { id, name: "Lewa", status: "ENABLED", advertisingChannelType: "DEMAND_GEN" }, segments: { date: "2026-10-17", hour: 0 }, metrics };
}
function ad(id = "30", metrics) {
  return { ...campaign("10", metrics), adGroup: { id: "20", name: "45+", status: "ENABLED" }, adGroupAd: { status: "ENABLED", ad: { id, name: "Lewa black", type: "DEMAND_GEN_MULTI_ASSET_AD" } } };
}
function purchase(row, value = 100, action = actionId) {
  return { ...row, segments: { ...row.segments, conversionActionCategory: "PURCHASE", conversionAction: action }, metrics: { conversions: 1, conversionsValue: value } };
}
function fixtures() {
  return [
    [{ customer: { id: accountId, descriptiveName: "Galago", currencyCode: "EUR", timeZone: "Europe/Sarajevo" } }],
    [campaign()], [purchase(campaign()), purchase(campaign(), 50), purchase(campaign("11"), 25)],
    [ad()], [purchase(ad()), purchase(ad("31"), 25)],
    [{ conversionAction: { resourceName: actionId, name: "Purchase", status: "ENABLED", primaryForGoal: true, valueSettings: { alwaysUseDefaultValue: false, defaultValue: 0, defaultCurrencyCode: "EUR" } } }]
  ];
}

function harness(options = {}) {
  const state = { clock: Date.parse("2026-10-17T08:00:00Z"), queryIndex: 0, queries: [], writes: [], uuid: 0, failWrite: null, failQuery: options.failQuery, beforeFlush: null, remaining: 1800, logs: [] };
  const sheets = new Map();
  function makeSheet(name) {
    const cells = new Map();
    let maxRows = 1000, maxColumns = 26;
    const sheet = {
      getName: () => name, getMaxRows: () => maxRows, getMaxColumns: () => maxColumns,
      deleteColumns: (_, count) => { maxColumns -= count; },
      insertRowsAfter: (_, count) => { maxRows += count; },
      getRange(row, col, length = 1) {
        assert.equal(col, 1);
        const range = {
          getValue: () => cells.get(row) ?? "",
          setNumberFormat(format) { assert.equal(format, "@"); return range; },
          setValue(value) { return range.setValues([[value]]); },
          setValues(values) {
            if (state.failWrite && state.failWrite(name, row)) throw new Error("Simulated Sheet write failure");
            assert.equal(values.length, length);
            values.forEach((value, i) => { assert.equal(typeof value[0], "string"); cells.set(row + i, value[0]); });
            state.writes.push({ name, row, length });
            return range;
          }
        };
        return range;
      },
      cells
    };
    sheets.set(name, sheet);
    return sheet;
  }
  let bookTimeZone = "America/Los_Angeles";
  const book = { getSpreadsheetTimeZone: () => bookTimeZone, setSpreadsheetTimeZone: zone => { bookTimeZone = zone; }, getSheetByName: name => sheets.get(name) || null, getSheets: () => [...sheets.values()], insertSheet: name => { assert.ok(!sheets.has(name)); return makeSheet(name); }, deleteSheet: sheet => { if (options.cleanupFails) throw new Error("cleanup failed"); sheets.delete(sheet.getName()); } };
  makeSheet("Upute").getRange(1, 1).setValue("Unrelated user content");
  const data = options.data || fixtures();
  const allowedAds = {
    currentAccount: () => ({ getCustomerId: () => options.wrongAccount ? "000-000-0000" : "322-174-2913" }),
    getExecutionInfo: () => ({ getRemainingTime: () => state.remaining }),
    search(query, opts) {
      assert.equal(opts.apiVersion, "v26");
      assert.ok(query.startsWith("SELECT "));
      state.queries.push(query);
      const index = state.queryIndex++ % 6;
      if (index === state.failQuery) throw new Error("Simulated Ads query failure");
      let cursor = 0;
      const rows = structuredClone(data[index]);
      return { hasNext: () => cursor < rows.length, next: () => rows[cursor++] };
    }
  };
  const AdsApp = new Proxy(allowedAds, { get(target, key) { assert.ok(key in target, `Forbidden Ads operation: ${String(key)}`); return target[key]; } });
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [state.clock])); }
    static now() { return state.clock; }
  }
  const context = vm.createContext({ AdsApp, SpreadsheetApp: { openById: () => book, flush: () => { state.beforeFlush?.(); state.writes.push({ flush: true }); } }, Utilities: { getUuid: () => (++state.uuid).toString(16).padStart(32, "0"), formatDate: (date, zone, format) => { assert.equal(format, "yyyy-MM-dd"); return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); } }, Logger: { log: text => state.logs.push(text) }, Date: ClockDate });
  vm.runInContext(source, context);
  context.GALAGO_ADS_EXPORT.SPREADSHEET_ID = "private_reporting_sheet_id_12345";
  function manifest() { const value = book.getSheetByName("ads_manifest")?.getRange(1, 1).getValue(); return value ? JSON.parse(value) : null; }
  function rows(kind) { const m = manifest(); const sheet = book.getSheetByName(m[kind + "Tab"]); const header = JSON.parse(sheet.getRange(1, 1).getValue()); assert.equal(header.runId, m.runId); assert.equal(header.count, m[kind + "Count"]); return Array.from({ length: header.count }, (_, i) => JSON.parse(sheet.getRange(i + 2, 1).getValue())); }
  return { context, state, sheets, book, manifest, rows, run: () => context.main(), data };
}

test("read-only six-query pipeline preserves spend, purchase-only rows, attribution metadata and coverage", () => {
  const h = harness(); h.run();
  const manifest = h.manifest();
  assert.equal(manifest.complete, true); assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.fromDate, "2026-09-13"); assert.equal(manifest.toDate, "2026-10-17");
  assert.equal(manifest.customerId, accountId); assert.equal(manifest.currency, "EUR");
  assert.equal(h.book.getSpreadsheetTimeZone(), "Europe/Sarajevo");
  assert.equal(manifest.campaignsCount, 2); assert.equal(manifest.adsCount, 2); assert.equal(manifest.trackingCount, 1);
  assert.match(manifest.runId, /^\d{13}_[a-f0-9]{32}$/);
  assert.equal(h.rows("campaigns")[0].cost, 5); assert.equal(h.rows("campaigns")[0].purchases, 2); assert.equal(h.rows("campaigns")[0].purchaseValue, 150);
  assert.equal(h.rows("campaigns")[1].cost, 0); assert.equal(h.rows("campaigns")[1].purchaseValue, 25);
  assert.equal(h.rows("ads")[1].cost, 0); assert.equal(h.rows("ads")[1].purchases, 1);
  assert.deepEqual(h.rows("tracking")[0], { configured: true, actions: ["Purchase"], valueSettingsChecked: true, fixedValueActions: [], revenueValidFrom: "2026-10-17" });
  assert.equal(h.state.queries.length, 6);
  for (const query of h.state.queries.filter(q => q.includes(" FROM ad_group_ad "))) assert.ok(!query.includes("segments.hour"));
  for (const query of h.state.queries.filter(q => q.includes("metrics.cost_micros"))) assert.ok(!query.includes("conversion_action"));
  for (const query of h.state.queries.filter(q => q.includes("metrics.conversions"))) assert.ok(query.includes("segments.conversion_action_category = 'PURCHASE'"));
  const commit = h.state.writes.findIndex(w => w.name === "ads_manifest");
  assert.equal(h.state.writes[commit - 1].flush, true);
  assert.equal(h.state.writes[commit + 1].flush, true);
});

test("fixed and observed secondary purchase actions suppress revenue trust; missing settings stay unknown", () => {
  for (const mode of ["fixed", "missing", "unknownObserved", "secondaryFixed"]) {
    const data = fixtures();
    if (mode === "fixed") data[5][0].conversionAction.valueSettings.alwaysUseDefaultValue = true;
    if (mode === "missing") delete data[5][0].conversionAction.valueSettings;
    if (mode === "unknownObserved") data[2][0].segments.conversionAction = "customers/3221742913/conversionActions/999";
    if (mode === "secondaryFixed") {
      const secondary = structuredClone(data[5][0]); secondary.conversionAction.resourceName += "2"; secondary.conversionAction.name = "Secondary fixed"; secondary.conversionAction.primaryForGoal = false; secondary.conversionAction.valueSettings.alwaysUseDefaultValue = true;
      data[5].push(secondary); data[2][0].segments.conversionAction = secondary.conversionAction.resourceName;
    }
    const h = harness({ data }); h.run(); const tracking = h.rows("tracking")[0];
    if (mode === "fixed" || mode === "secondaryFixed") assert.equal(tracking.fixedValueActions.length, 1);
    else assert.equal(tracking.valueSettingsChecked, false);
  }
});

test("paused or removed parents make child ads inactive", () => {
  const data = fixtures(); data[3][0].campaign.status = "PAUSED"; data[4][1].adGroup.status = "REMOVED";
  const h = harness({ data }); h.run(); assert.deepEqual(h.rows("ads").map(r => r.status), ["PAUSED", "REMOVED"]);
});

test("failed query, invalid selected metric, duplicate costs, wrong category and row limits never publish", () => {
  const cases = [
    { options: { failQuery: 3 } },
    { change: d => { delete d[1][0].metrics.costMicros; } },
    { change: d => { d[1][0].metrics.costMicros = ""; } },
    { change: d => { d[1].push(structuredClone(d[1][0])); } },
    { change: d => { d[2][0].segments.conversionActionCategory = "PAGE_VIEW"; } },
    { change: d => { d[1][0].segments.hour = 24; } },
    { config: { MAX_QUERY_ROWS: 1 } }, { config: { MAX_SNAPSHOT_ROWS: 1 } }, { config: { MAX_TOTAL_JSON_CHARS: 1 } },
    { config: { REVENUE_VALID_FROM: "2026-02-30" } }, { options: { wrongAccount: true } }
  ];
  for (const c of cases) {
    const data = fixtures(); c.change?.(data); const h = harness({ data, ...c.options }); Object.assign(h.context.GALAGO_ADS_EXPORT, c.config);
    assert.throws(h.run); assert.equal(h.manifest(), null); assert.equal(h.sheets.size, 1);
  }
});

test("successful empty reports are complete no-activity snapshots with unknown tracking", () => {
  const data = fixtures(); data.fill([], 1); const h = harness({ data }); h.run();
  assert.equal(h.manifest().campaignsCount, 0); assert.equal(h.manifest().adsCount, 0);
  assert.equal(h.rows("tracking")[0].configured, false); assert.equal(h.rows("tracking")[0].valueSettingsChecked, false);
});

test("write failure keeps the previous immutable snapshot and manifest", () => {
  const h = harness(); h.run(); const previous = h.manifest(); const oldRows = h.rows("campaigns");
  h.state.clock += 3600000; h.state.failWrite = (name, row) => name.startsWith("ads_ads_") && row > 1;
  assert.throws(h.run, /Sheet write failure/); assert.deepEqual(h.manifest(), previous); assert.deepEqual(h.rows("campaigns"), oldRows);
});

test("retention keeps current + two previous snapshots and leaves unrelated tabs intact", () => {
  const h = harness(); const runIds = [];
  for (let i = 0; i < 5; i++) { h.run(); runIds.push(h.manifest().runId); h.state.clock += 3600000; }
  assert.equal(h.sheets.size, 11); assert.equal(h.book.getSheetByName("Upute").getRange(1, 1).getValue(), "Unrelated user content");
  assert.deepEqual(h.manifest().previousRunIds, [runIds[3], runIds[2]]);
  assert.equal(h.book.getSheetByName("ads_campaigns_" + runIds[0]), null);
});

test("cleanup failure does not turn a published valid export into failure", () => {
  const h = harness({ cleanupFails: true });
  for (let i = 0; i < 4; i++) { assert.doesNotThrow(h.run); h.state.clock += 3600000; }
  assert.ok(h.manifest().complete); assert.ok(h.state.logs.some(l => l.includes("cleanup will retry")));
});

test("execution deadline prevents publication and keeps prior snapshot", () => {
  const h = harness(); h.run(); const previous = h.manifest(); h.state.clock += 3600000; h.state.remaining = 59;
  assert.throws(h.run, /time limit/); assert.deepEqual(h.manifest(), previous);
});

test("reader sees only valid full rows and formula-like names remain inert JSON strings", () => {
  const data = fixtures(); data[1][0].campaign.name = '=IMPORTXML("https://invalid", "x")';
  const h = harness({ data }); h.run();
  const value = h.book.getSheetByName(h.manifest().campaignsTab).getRange(2, 1).getValue();
  assert.ok(value.startsWith("{")); assert.equal(h.rows("campaigns")[0].campaignName, data[1][0].campaign.name);
});

test("large data tabs reserve the reader's blank sentinel row", () => {
  const data = fixtures(); data[1] = Array.from({ length: 1001 }, (_, i) => campaign(String(i + 100)));
  data[2] = []; data[3] = []; data[4] = [];
  const h = harness({ data }); h.run();
  const sheet = h.book.getSheetByName(h.manifest().campaignsTab);
  assert.equal(sheet.getMaxRows(), 1003); assert.equal(sheet.getMaxColumns(), 1);
  assert.equal(sheet.getRange(1003, 1).getValue(), "");
});

test("explicit selected zero metrics and midnight hour are valid", () => {
  const data = fixtures(); data[1][0].metrics = { impressions: 0, clicks: "0", costMicros: 0 };
  data[2] = [purchase(campaign(), 0)]; data[2][0].metrics.conversions = 0;
  const h = harness({ data }); h.run(); const row = h.rows("campaigns")[0];
  for (const key of ["cost", "impressions", "clicks", "purchases", "purchaseValue", "hour"]) assert.equal(row[key], 0);
});

test("query failure after prior success keeps the published snapshot", () => {
  const h = harness(); h.run(); const previous = h.manifest(); h.state.clock += 3600000; h.state.failQuery = 5;
  assert.throws(h.run, /Ads query failure/); assert.deepEqual(h.manifest(), previous);
});

test("an intervening manifest commit aborts publication of this run", () => {
  const h = harness(); h.run(); const previous = h.manifest(); h.state.clock += 3600000;
  const other = { ...previous, exportedAt: new Date(h.state.clock).toISOString() };
  h.state.beforeFlush = () => { h.state.beforeFlush = null; h.book.getSheetByName("ads_manifest").getRange(1, 1).setValue(JSON.stringify(other)); };
  assert.throws(h.run, /Another export committed/); assert.deepEqual(h.manifest(), other);
});

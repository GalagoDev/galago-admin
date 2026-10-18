import assert from "node:assert/strict";
import test from "node:test";
import { buildAdsPeriod } from "../src/lib/ads-analytics.ts";
import { buildMetaAdsReport } from "../src/lib/meta-ads-analytics.ts";

const now = new Date("2026-10-18T10:30:00Z");
const HOUR_MS = 3_600_000;
const period = buildAdsPeriod({ kind: "custom", from: "2026-10-18", to: "2026-10-18" }, now);
function account(overrides = {}) { return { id: "account-1", name: "Meta shop", currency: "EUR", timeZone: "Europe/Sarajevo", ...overrides }; }
function hour(overrides = {}) {
  return {
    accountId: "account-1", campaignId: "campaign-1", campaignName: "Stolovi", adSetId: "set-1", adSetName: "Namještaj",
    adId: "ad-1", adName: "Lewa", status: "ACTIVE", date: "2026-10-18", hour: 10,
    impressions: 100, clicks: 10, spend: 5, purchases: 1, purchaseValue: 50,
    purchaseActionType: "offsite_conversion.fb_pixel_purchase", bamRate: 1.95583, ...overrides,
  };
}
function snapshot(overrides = {}, selected = period, at = now) {
  return {
    fetchedAt: at.toISOString(), periodStart: selected.start, periodEnd: selected.end,
    accounts: [account()], hours: [hour()], attribution: "Meta conversion time; unified attribution", warnings: [], ...overrides,
  };
}
function report(overrides = {}, selected = period, at = now) { return buildMetaAdsReport(snapshot(overrides, selected, at), selected, at); }
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test("ad-hour series derives all levels exactly once, preserving conversion values", () => {
  const result = report({ hours: [hour(), hour({ hour: 11, spend: 10, purchases: 2, purchaseValue: 100 }), hour({ adId: "ad-2", spend: 5, purchases: 0, purchaseValue: 0 })] });
  close(result.summary.spendBam, 20 * 1.95583);
  close(result.summary.revenueBam, 150 * 1.95583);
  assert.equal(result.summary.purchases, 3);
  close(result.summary.roas, 7.5);
  assert.equal(result.summary.clicks, 30);
  assert.equal(result.summary.impressions, 300);
  assert.equal(result.campaigns.length, 1);
  assert.equal(result.ads.length, 2);
  for (const sum of [result.accounts[0], result.campaigns[0], result.timeline[0]]) {
    assert.equal(sum.purchases, result.summary.purchases);
    close(sum.spendBam, result.summary.spendBam);
    close(sum.revenueBam, result.summary.revenueBam);
  }
  assert.deepEqual(result.warnings, []);
  assert.equal(result.attribution, "Meta conversion time; unified attribution");
});

test("mixed accounts/currencies convert each row before totals and IDs stay distinct", () => {
  const result = report({
    accounts: [account(), account({ id: "account-2", currency: "BAM" })],
    hours: [hour(), hour({ accountId: "account-2", bamRate: 1, spend: 10, purchaseValue: 100 })],
  });
  close(result.summary.spendBam, 5 * 1.95583 + 10);
  close(result.summary.revenueBam, 50 * 1.95583 + 100);
  close(result.summary.roas, 10);
  assert.equal(result.ads.length, 2);
  assert.deepEqual(new Set(result.ads.map((row) => row.id)), new Set(["account-1/campaign-1/ad-1", "account-2/campaign-1/ad-1"]));
  assert.equal(result.campaigns.length, 2);
});

test("adapter-provided historical USD rates are applied per row instead of a latest-rate shortcut", () => {
  const result = report({ accounts: [account({ currency: "USD" })], hours: [hour({ spend: 10, purchaseValue: 20, bamRate: 1.7 }), hour({ hour: 11, spend: 10, purchaseValue: 40, bamRate: 1.8 })] });
  close(result.summary.spendBam, 35);
  close(result.summary.revenueBam, 106);
  close(result.summary.roas, 106 / 35);
  close(result.summary.spendEur, 35 / 1.95583);
});

test("missing purchase values propagate only to affected entities and the full aggregate", () => {
  const result = report({ hours: [hour(), hour({ adId: "ad-2", purchases: null, purchaseValue: null }), hour({ adId: "ad-3", purchases: 2, purchaseValue: 0 })] });
  assert.equal(result.summary.purchases, null);
  assert.equal(result.summary.revenueBam, null);
  assert.equal(result.summary.roas, null);
  assert.equal(result.campaigns[0].revenueBam, null);
  assert.equal(result.accounts[0].purchases, null);
  assert.equal(result.timeline[0].revenueBam, null);
  close(result.ads.find((row) => row.id.endsWith("/ad-1")).roas, 10);
  assert.equal(result.ads.find((row) => row.id.endsWith("/ad-2")).roas, null);
  const noValue = result.ads.find((row) => row.id.endsWith("/ad-3"));
  assert.equal(noValue.purchases, 2);
  assert.equal(noValue.revenueBam, null);
  assert.equal(noValue.roas, null, "a pixel purchase without a value cannot become a zero-return recommendation");
  close(result.summary.spendBam, 15 * 1.95583);
  assert.equal(result.warnings.length, 2);
});

test("missing count alone stays unknown without discarding an independently supplied value", () => {
  const result = report({ hours: [hour({ purchases: null })] });
  assert.equal(result.summary.purchases, null);
  assert.equal(result.summary.cpaBam, null);
  close(result.summary.roas, 10);
});

test("missing currency rate cannot become a partial monetary grand total", () => {
  const result = report({ accounts: [account(), account({ id: "usd", currency: "USD" })], hours: [hour(), hour({ accountId: "usd", bamRate: null })] });
  assert.equal(result.summary.spendBam, null);
  assert.equal(result.summary.spendEur, null);
  assert.equal(result.summary.revenueBam, null);
  assert.equal(result.summary.roas, null);
  assert.equal(result.summary.purchases, 2);
  assert.equal(result.summary.impressions, 200);
  close(result.accounts.find((row) => row.id === "account-1").spendBam, 5 * 1.95583);
  assert.equal(result.accounts.find((row) => row.id === "usd").spendBam, null);
  assert.equal(report({ accounts: [account({ currency: "" })] }).summary.spendBam, null);
});

test("duplicate ad-hours reject instead of doubling metrics; bad identifiers cannot merge accounts", () => {
  assert.throws(() => report({ hours: [hour(), hour()] }), /dupliran/);
  assert.throws(() => report({ accounts: [account(), account()] }), /ponovljen/);
  assert.throws(() => report({ hours: [hour({ accountId: "missing" })] }), /računu koji nedostaje/);
  assert.throws(() => report({ hours: [hour({ spend: NaN })] }), /neispravan/);
  assert.throws(() => report({ hours: [hour({ date: "2026-02-30" })] }), /neispravan datum/);
});

test("coverage must match the requested period including an active future end", () => {
  const weekend = buildAdsPeriod({ kind: "weekend" }, now);
  assert.ok(Date.parse(weekend.end) > now.getTime());
  assert.equal(report({}, weekend).summary.purchases, 1);
  assert.throws(() => report({ periodStart: "2026-10-18T00:00:00Z" }), /tačno odabrani/);
  assert.throws(() => report({ periodEnd: now.toISOString() }), /tačno odabrani/);
});

test("Sarajevo weekend includes Friday08, excludes earlier hours and future rows", () => {
  const weekend = buildAdsPeriod({ kind: "weekend" }, now);
  const result = report({ hours: [
    hour({ date: "2026-10-16", hour: 7 }), hour({ date: "2026-10-16", hour: 8 }),
    hour({ date: "2026-10-18", hour: 12 }), hour({ date: "2026-10-18", hour: 13 }),
    hour({ date: "2026-10-19", hour: 8 }),
  ] }, weekend);
  assert.equal(result.summary.purchases, 2);
  assert.deepEqual(result.timeline.map((row) => row.date), ["2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.equal(result.timeline[1].spendBam, 0);
});

test("each account-local hour maps to the proper Sarajevo day", () => {
  const result = report({ accounts: [account({ timeZone: "America/Los_Angeles" })], hours: [
    hour({ date: "2026-10-17", hour: 14 }), hour({ date: "2026-10-17", hour: 15 }),
    hour({ date: "2026-10-17", hour: 23 }),
  ] });
  assert.equal(result.summary.purchases, 2);
  assert.equal(result.timeline[0].date, "2026-10-18");
  assert.equal(result.timeline[0].purchases, 2);
});

test("DST repeated local hour is one source bucket, never duplicated", () => {
  const later = new Date("2026-10-26T12:00:00Z");
  const selected = buildAdsPeriod({ kind: "custom", from: "2026-10-25", to: "2026-10-25" }, later);
  assert.equal(Date.parse(selected.end) - Date.parse(selected.start), 25 * HOUR_MS);
  const result = report({ hours: [hour({ date: "2026-10-25", hour: 1 }), hour({ date: "2026-10-25", hour: 2, purchases: 2, spend: 10 }), hour({ date: "2026-10-25", hour: 3 })] }, selected, later);
  assert.equal(result.summary.purchases, 4);
  close(result.summary.spendBam, 20 * 1.95583);
  assert.deepEqual(result.warnings, []);
});
test("nonexistent DST hour and partial half-hour timezone boundaries produce explicit incompleteness", () => {
  const springNow = new Date("2026-03-30T12:00:00Z");
  const spring = buildAdsPeriod({ kind: "custom", from: "2026-03-29", to: "2026-03-29" }, springNow);
  const skipped = report({ hours: [hour({ date: "2026-03-29", hour: 2 }), hour({ date: "2026-03-29", hour: 3 })] }, spring, springNow);
  assert.equal(skipped.summary.purchases, 1);
  assert.ok(skipped.warnings.some((value) => value.includes("ne postoji")));
  const later = new Date("2026-10-19T12:00:00Z");
  const partial = report({ accounts: [account({ timeZone: "Asia/Kolkata" })], hours: [
    hour({ hour: 3 }), hour({ hour: 4 }), hour({ date: "2026-10-19", hour: 3 }),
  ] }, period, later);
  assert.equal(partial.summary.purchases, 1);
  assert.equal(partial.warnings.length, 1);
  assert.match(partial.warnings[0], /nepotpun/);
});

test("zero denominators and unknown status never fabricate Infinity or active state", () => {
  const result = report({ hours: [hour({ spend: 0, clicks: 0, impressions: 0, purchases: 0, purchaseValue: 0, status: null })] });
  for (const field of ["roas", "ctr", "cpcBam", "cpaBam"]) assert.equal(result.summary[field], null);
  assert.equal(result.ads[0].status, null);
  assert.equal(result.campaigns[0].status, null);
  assert.equal(result.accounts[0].status, null);
  const empty = report({ hours: [] });
  assert.equal(empty.summary.spendBam, 0);
  assert.equal(empty.summary.revenueBam, 0);
  assert.equal(empty.accounts.length, 1);
});

test("newest hour supplies ad status/names even if the input is not ordered", () => {
  const result = report({ hours: [hour({ hour: 11, status: "PAUSED", adName: "Noviji naziv" }), hour({ hour: 10, status: "ACTIVE", adName: "Stari naziv" })] });
  assert.equal(result.ads[0].status, "PAUSED");
  assert.equal(result.ads[0].name, "Noviji naziv");
  assert.equal(result.summary.purchases, 2);
});

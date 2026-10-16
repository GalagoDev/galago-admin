import assert from "node:assert/strict";
import test from "node:test";
import { buildAdsPeriod, buildAdsReport, defaultAdsSettings } from "../src/lib/ads-analytics.ts";

const now = new Date("2026-10-16T10:00:00Z");
const period = buildAdsPeriod({ kind: "custom", from: "2026-10-01", to: "2026-10-12" }, now);
const settings = { ...defaultAdsSettings(), targetRoas: 5 };
const metrics = { impressions: 1000, clicks: 40, cost: 20, purchases: 4, purchaseValue: 200 };
function hour(overrides = {}) {
  return { ...metrics, date: "2026-10-02", hour: 14, campaignId: "c1", campaignName: "Stolice", status: "ENABLED", channel: "SEARCH", ...overrides };
}
function ad(overrides = {}) {
  return { ...metrics, date: "2026-10-02", campaignId: "c1", campaignName: "Stolice", adGroupId: "g1", adGroupName: "Duma", adId: "a1", adName: "Duma 79", status: "ENABLED", adType: "RESPONSIVE_SEARCH_AD", ...overrides };
}
function snapshot(overrides = {}) {
  return {
    account: { id: "1234567890", name: "Galago", currency: "EUR", timeZone: "Europe/Sarajevo" },
    fetchedAt: now.toISOString(), fromDate: "2026-08-01", toDate: "2026-10-16",
    campaigns: [hour()], ads: [ad()], purchaseTracking: { configured: true, actions: ["Kupovina"] }, ...overrides,
  };
}
function report(overrides = {}, config = settings, selectedPeriod = period, at = now) {
  return buildAdsReport(snapshot(overrides), selectedPeriod, config, at);
}
function close(actual, expected, epsilon = 1e-9) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≠ ${expected}`); }

test("5 EUR ad spend and 100 BAM attributed sales produce 10.2258x ROAS", () => {
  const result = report({ campaigns: [hour({ cost: 5, purchaseValue: 100 / 1.95583, purchases: 1 })] });
  close(result.summary.spendBam, 9.77915);
  close(result.summary.spendEur, 5);
  close(result.summary.revenueBam, 100);
  close(result.summary.roas, 10.22583762392437);
  close(result.summary.ctr, 0.04);
  close(result.summary.cpcBam, 9.77915 / 40);
});

test("BAM accounts use identical units for ROAS and fixed EUR conversion", () => {
  const result = report({ account: { ...snapshot().account, currency: "BAM" }, campaigns: [hour({ cost: 10, purchaseValue: 100 })] });
  assert.equal(result.summary.roas, 10);
  assert.equal(result.summary.spendBam, 10);
  close(result.summary.spendEur, 10 / 1.95583);
});

test("zero spend, zero clicks and zero impressions never yield infinite ratios", () => {
  const result = report({ campaigns: [hour({ impressions: 0, clicks: 0, cost: 0, purchases: 0, purchaseValue: 0 })] });
  assert.equal(result.summary.roas, null);
  assert.equal(result.summary.ctr, null);
  assert.equal(result.summary.cpcBam, null);
  assert.equal(result.summary.cpaBam, null);
});

test("tracking must be confirmed before exposing purchase metrics or recommending action", () => {
  const result = report({ purchaseTracking: { configured: false, actions: [] } });
  assert.equal(result.summary.purchases, null);
  assert.equal(result.summary.revenueBam, null);
  assert.equal(result.summary.roas, null);
  assert.equal(result.ads[0].recommendation.decision, "tracking");
  assert.equal(result.campaigns[0].purchases, null);
  assert.ok(result.warnings.some((warning) => warning.includes("ukupne narudžbe")));
});

test("missing value on one purchase cannot be hidden by other positive purchases", () => {
  const result = report({ campaigns: [hour(), hour({ hour: 15, purchases: 1, purchaseValue: 0 })], ads: [ad(), ad({ date: "2026-10-03", purchaseValue: 0, purchases: 1 })] });
  assert.equal(result.summary.purchases, 5);
  assert.equal(result.summary.revenueBam, null);
  assert.equal(result.summary.roas, null);
  assert.equal(result.ads[0].recommendation.decision, "tracking");
});

test("unsupported currency keeps native ROAS but does not invent EUR or BAM values", () => {
  const result = report({ account: { ...snapshot().account, currency: "USD" } });
  assert.equal(result.summary.spendBam, null);
  assert.equal(result.summary.spendEur, null);
  assert.equal(result.summary.revenueBam, null);
  assert.equal(result.summary.cpcBam, null);
  assert.equal(result.summary.roas, 10);
  assert.equal(result.ads[0].recommendation.decision, "wait");
  assert.ok(result.warnings.some((warning) => warning.includes("USD")));
});

test("default settings require an explicit business target", () => {
  assert.deepEqual(defaultAdsSettings(), { targetRoas: null, minimumSpendBam: 30, minimumClicks: 30, minimumPurchases: 3, attributionLagDays: 3 });
  assert.equal(report({}, defaultAdsSettings()).ads[0].recommendation.decision, "wait");
  assert.equal(report({}, defaultAdsSettings()).ads[0].recommendation.label, "Postavi cilj");
});

test("recommendations use purchase, spend and click gates conservatively", () => {
  assert.equal(report().ads[0].recommendation.decision, "keep");
  assert.equal(report({ ads: [ad({ purchases: 2 })] }).ads[0].recommendation.decision, "wait");
  assert.equal(report({ ads: [ad({ purchaseValue: 0, purchases: 0 })] }).ads[0].recommendation.decision, "review");
  assert.equal(report({ ads: [ad({ cost: 5, purchaseValue: 0, purchases: 0 })] }).ads[0].recommendation.decision, "wait");
  assert.equal(report({ ads: [ad({ clicks: 29, purchaseValue: 0, purchases: 0 })] }).ads[0].recommendation.decision, "wait");
  assert.equal(report({ ads: [ad({ purchases: 3, purchaseValue: 100 })] }).ads[0].recommendation.decision, "keep");
  assert.equal(report({ ads: [ad({ purchases: 3, purchaseValue: 99 })] }).ads[0].recommendation.decision, "review");
});

test("paused or removed ads remain inactive regardless of performance", () => {
  for (const status of ["PAUSED", "REMOVED"]) assert.equal(report({ ads: [ad({ status })] }).ads[0].recommendation.decision, "inactive");
});

test("mature 14-day recommendation window is separate from the selected hourly period", () => {
  const result = report({ ads: [ad(), ad({ date: "2026-10-13", purchaseValue: 10000, purchases: 100 }), ad({ date: "2026-09-28", cost: 999 })] });
  assert.equal(result.recommendationPeriod.from, "2026-09-29");
  assert.equal(result.recommendationPeriod.to, "2026-10-12");
  assert.equal(result.ads[0].purchases, 4);
  assert.equal(result.ads[0].spendEur, 20);
  assert.equal(result.ads[0].roas, 10);
  assert.equal(result.ads[0].recommendation.decision, "keep");
});

test("new ads with only immature data wait, while latest status remains authoritative", () => {
  const result = report({ ads: [ad({ date: "2026-10-15" })] });
  assert.equal(result.ads[0].purchases, 0);
  assert.equal(result.ads[0].recommendation.decision, "wait");
  const paused = report({ ads: [ad(), ad({ date: "2026-10-15", status: "PAUSED" })] });
  assert.equal(paused.ads[0].recommendation.decision, "inactive");
});

test("insufficient downloaded history prevents confident recommendations", () => {
  const result = report({ fromDate: "2026-10-01" });
  assert.equal(result.ads[0].recommendation.decision, "wait");
  assert.ok(result.ads[0].recommendation.reason.includes("historiju"));
  assert.ok(result.warnings.some((warning) => warning.includes("14 dana")));
});

test("campaign hourly totals are not double counted from individual ad rows", () => {
  const result = report({ campaigns: [hour({ cost: 10 }), hour({ campaignId: "c2", cost: 7 })], ads: [ad({ cost: 10000 })] });
  assert.equal(result.summary.spendEur, 17);
  assert.equal(result.campaigns.length, 2);
  close(result.timeline.reduce((sum, day) => sum + day.spendEur, 0), 17);
});

test("workday 08–08 uses active target label before and after cutoff", () => {
  const before = buildAdsPeriod({}, new Date("2026-10-15T05:59:00Z"));
  assert.equal(before.date, "2026-10-15");
  assert.equal(before.start, "2026-10-14T06:00:00.000Z");
  assert.equal(before.end, "2026-10-15T06:00:00.000Z");
  const after = buildAdsPeriod({}, new Date("2026-10-15T06:00:00Z"));
  assert.equal(after.date, "2026-10-16");
  assert.equal(after.complete, false);
});

test("Friday after cutoff, Saturday and Monday before cutoff select Friday–Monday", () => {
  for (const date of ["2026-10-16T06:00:00Z", "2026-10-17T10:00:00Z", "2026-10-19T05:59:00Z"]) {
    const active = buildAdsPeriod({}, new Date(date));
    assert.equal(active.start, "2026-10-16T06:00:00.000Z");
    assert.equal(active.end, "2026-10-19T06:00:00.000Z");
  }
});

test("weekend selects last started Friday, including completed weekend midweek", () => {
  const fridayBefore = buildAdsPeriod({ kind: "weekend" }, new Date("2026-10-16T05:59:00Z"));
  assert.equal(fridayBefore.date, "2026-10-12");
  assert.equal(fridayBefore.complete, true);
  const current = buildAdsPeriod({ kind: "weekend" }, now);
  assert.equal(current.start, "2026-10-16T06:00:00.000Z");
  assert.equal(current.end, "2026-10-19T06:00:00.000Z");
  assert.equal(current.complete, false);
  const midweek = buildAdsPeriod({ kind: "weekend" }, new Date("2026-10-21T10:00:00Z"));
  assert.equal(midweek.date, "2026-10-19");
});

test("Sarajevo weekend duration respects 71/73-hour DST weekends", () => {
  const spring = buildAdsPeriod({ kind: "weekend", date: "2026-03-30" }, now);
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 71);
  const autumn = buildAdsPeriod({ kind: "weekend", date: "2026-10-26" }, new Date("2026-10-27T10:00:00Z"));
  assert.equal((Date.parse(autumn.end) - Date.parse(autumn.start)) / 3600000, 73);
});

test("rolling ranges are inclusive Sarajevo calendar days and can include today", () => {
  const seven = buildAdsPeriod({ kind: "7days" }, now);
  assert.equal(seven.start, "2026-10-09T22:00:00.000Z");
  assert.equal(seven.end, "2026-10-16T22:00:00.000Z");
  assert.equal(seven.complete, false);
  const thirty = buildAdsPeriod({ kind: "30days", date: "2026-10-15" }, now);
  assert.equal(thirty.start, "2026-09-15T22:00:00.000Z");
  assert.equal(thirty.end, "2026-10-15T22:00:00.000Z");
  assert.equal(thirty.complete, true);
});

test("strict date validation rejects normalized, malformed, future and overlong periods", () => {
  for (const input of [
    { kind: "workday", date: "2026-02-30" }, { kind: "custom", from: "2026-2-01", to: "2026-02-01" },
    { kind: "custom", from: "2026-10-12", to: "2026-10-01" }, { kind: "custom", from: "2026-07-01", to: "2026-10-01" },
    { kind: "custom", from: "2026-10-16", to: "2026-10-17" }, { kind: "7days", date: "2026-10-17" },
    { kind: "workday", date: "2026-10-20" }, { kind: "weekend", date: "2026-10-26" },
    { kind: "workday", date: "2026-10-17" }, { kind: "weekend", date: "2026-10-16" },
    { kind: "custom", from: "2026-10-12" }, { kind: "unknown" },
  ]) assert.throws(() => buildAdsPeriod(input, now), JSON.stringify(input));
  assert.doesNotThrow(() => buildAdsPeriod({ kind: "custom", from: "2024-02-29", to: "2024-02-29" }, now));
  assert.doesNotThrow(() => buildAdsPeriod({ kind: "custom", from: "2026-07-19", to: "2026-10-16" }, now));
});

test("account-local hours are converted to UTC before Sarajevo cutoff filtering", () => {
  const selected = buildAdsPeriod({ kind: "workday", date: "2026-10-16" }, now);
  const result = report({ account: { ...snapshot().account, timeZone: "America/New_York" }, campaigns: [
    hour({ date: "2026-10-15", hour: 1, cost: 100 }), // 05Z: before Sarajevo 08
    hour({ date: "2026-10-15", hour: 2, cost: 2 }),   // 06Z: included
    hour({ date: "2026-10-16", hour: 1, cost: 3 }),   // 05Z: included
    hour({ date: "2026-10-16", hour: 2, cost: 100 }), // 06Z: exclusive end
  ] }, settings, selected);
  assert.equal(result.summary.spendEur, 5);
  assert.equal(result.timeline[0].spendEur, 2);
  assert.equal(result.timeline[1].spendEur, 3);
});

test("fall-back hour aggregation is counted once and missing spring hour is excluded", () => {
  const autumnNow = new Date("2026-10-27T10:00:00Z");
  const selected = buildAdsPeriod({ kind: "custom", from: "2026-10-25", to: "2026-10-25" }, autumnNow);
  const autumn = report({ toDate: "2026-10-27", campaigns: [hour({ date: "2026-10-25", hour: 2, cost: 7 })] }, settings, selected, autumnNow);
  assert.equal(autumn.summary.spendEur, 7);
  const spring = report({ campaigns: [hour({ date: "2026-03-29", hour: 2, cost: 100 }), hour({ date: "2026-03-29", hour: 3, cost: 4 })] }, settings,
    buildAdsPeriod({ kind: "custom", from: "2026-03-29", to: "2026-03-29" }, now));
  assert.equal(spring.summary.spendEur, 4);
  assert.ok(spring.warnings.some((warning) => warning.includes("pomjeranja sata")));
});

test("fractional offset account excludes boundary fragments and exposes imprecision", () => {
  const selected = buildAdsPeriod({ kind: "workday", date: "2026-10-16" }, now);
  const result = report({ account: { ...snapshot().account, timeZone: "Asia/Kathmandu" }, campaigns: [
    hour({ date: "2026-10-15", hour: 11, cost: 100 }), // 05:15Z crosses start 06Z
    hour({ date: "2026-10-15", hour: 12, cost: 2 }),   // 06:15Z wholly inside
    hour({ date: "2026-10-16", hour: 11, cost: 100 }), // 05:15Z crosses end 06Z
  ] }, settings, selected);
  assert.equal(result.summary.spendEur, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("nije precizan")));
});

test("today includes active hour but never rows starting in the future", () => {
  const selected = buildAdsPeriod({ kind: "7days" }, now);
  const result = report({ campaigns: [hour({ date: "2026-10-16", hour: 11, cost: 2 }), hour({ date: "2026-10-16", hour: 12, cost: 50 }), hour({ date: "2026-10-16", hour: 20, cost: 100 })] }, settings, selected);
  assert.equal(result.summary.spendEur, 2);
  const midHour = report({ campaigns: [hour({ date: "2026-10-16", hour: 12, cost: 3 })] }, settings, selected, new Date("2026-10-16T10:05:00Z"));
  assert.equal(midHour.summary.spendEur, 3);
});

test("recommendation dates use account timezone around Sarajevo midnight", () => {
  const at = new Date("2026-10-16T00:30:00Z");
  const result = report({ account: { ...snapshot().account, timeZone: "America/Los_Angeles" } }, settings, period, at);
  assert.equal(result.recommendationPeriod.to, "2026-10-11");
  assert.equal(result.recommendationPeriod.from, "2026-09-28");
});

test("settings validation prevents NaN thresholds and unlimited lag windows", () => {
  for (const config of [{ ...settings, targetRoas: NaN }, { ...settings, minimumSpendBam: -1 }, { ...settings, attributionLagDays: 1.5 }, { ...settings, attributionLagDays: 31 }]) {
    assert.throws(() => report({}, config));
  }
});


test("stale snapshots preserve last-known ROAS but block actionable recommendations", () => {
  const stale = report({ fetchedAt: "2026-10-16T03:59:59Z" });
  assert.equal(stale.summary.roas, 10);
  assert.equal(stale.ads[0].recommendation.decision, "wait");
  assert.equal(stale.ads[0].recommendation.label, "Osvježi podatke");
  assert.ok(stale.warnings.some((warning) => warning.includes("posljednji poznati")));
  assert.equal(report({ fetchedAt: "2026-10-16T04:00:00Z" }).ads[0].recommendation.decision, "keep");
  assert.equal(report({ fetchedAt: "invalid" }).ads[0].recommendation.decision, "wait");
});

test("Performance Max warns that the individual ad list has narrower coverage", () => {
  const result = report({ campaigns: [hour({ channel: "PERFORMANCE_MAX" })] });
  assert.equal(result.summary.spendEur, 20);
  assert.ok(result.warnings.some((warning) => warning.includes("Performance Max") && warning.includes("grupe elemenata")));
});

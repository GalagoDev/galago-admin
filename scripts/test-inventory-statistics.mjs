import assert from "node:assert/strict";

import { calculateDailyStatistics, statisticsDateKeyFromLabel } from "../src/lib/daily-statistics.ts";
import { parseInventoryRows } from "../src/lib/inventory-import.ts";
import { ProductMatcher } from "../src/lib/product-matching.ts";

const parsed = parseInventoryRows([
  ["Šifra", "Naziv artikla", "Nabavna cijena", "Količina"],
  ["Z-01", "Žuri bijeli", "20,50 KM", 14],
  ["J-01", "Ormar Jambo Bijeli", 56.25, "8"],
]);
assert.equal(parsed.items.length, 2);
assert.equal(parsed.items[0].normalizedName, "zuri bijeli");
assert.equal(parsed.items[0].unitCost, 20.5);
assert.equal(parsed.items[1].quantity, 8);

const products = parsed.items.map((item, index) => ({
  id: index + 1,
  ...item,
  active: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
}));
const matcher = new ProductMatcher(products);
const fuzzy = matcher.match("Zuri bjeli", 1);
assert.equal(fuzzy.matches[0]?.product.name, "Žuri bijeli");

const aliased = new ProductMatcher(products, [{ normalizedAlias: "mara white", productId: 2 }]);
assert.equal(aliased.match("Mara white", 1).matches[0]?.product.name, "Ormar Jambo Bijeli");

const order = {
  rowNumber: 1,
  sheetRowNumber: 4,
  fingerprint: "test",
  dateLabel: "21/09/2026",
  primalac: "Test Kupac",
  brojTelefona: "38761111222",
  grad: "71000",
  adresa: "Test 1",
  artikal: "Zuri bjeli",
  brojPaketa: "2",
  otkupnina: "100,00",
  vrijednostPosiljke: "100,00",
  dop: "1",
  zamjena: "0",
  sourceId: "telegram:test",
  appStatus: "",
  receivedAt: "2026-09-19T08:30:00.000Z",
  riskReview: "",
};

assert.equal(statisticsDateKeyFromLabel(order.dateLabel), "2026-09-21");
const stats = calculateDailyStatistics({
  orders: [order],
  products,
  dateKey: "2026-09-21",
  metaSpendBam: 10,
});
assert.equal(stats.orderCount, 1);
assert.equal(stats.revenue, 100);
assert.equal(stats.vat, 14.5);
assert.equal(stats.shipping, 8.5);
assert.equal(stats.costOfGoods, 41);
assert.equal(stats.profitBeforeAds, 36);
assert.equal(stats.profitAfterAds, 26);
assert.equal(stats.ranking[0].units, 2);

const incomplete = calculateDailyStatistics({
  orders: [{ ...order, artikal: "Nepoznat proizvod" }],
  products,
  dateKey: "2026-09-21",
  metaSpendBam: 10,
});
assert.equal(incomplete.costComplete, false);
assert.equal(incomplete.profitBeforeAds, null);
assert.equal(incomplete.profitAfterAds, null);

const weekendStats = calculateDailyStatistics({
  orders: [
    order,
    { ...order, sheetRowNumber: 5, fingerprint: "saturday", receivedAt: "2026-09-19T15:00:00.000Z" },
    { ...order, sheetRowNumber: 6, fingerprint: "sunday", receivedAt: "2026-09-20T15:00:00.000Z" },
  ],
  products,
  dateKey: "2026-09-21",
  metaSpendBam: 0,
});
assert.equal(weekendStats.sourceOrderCount, 3);
assert.equal(weekendStats.orderCount, 3);

console.log("Inventory import, fuzzy matching, workday grouping, and profit calculations passed.");

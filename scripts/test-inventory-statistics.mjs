import assert from "node:assert/strict";

import { calculateDailyStatistics, statisticsDateKeyFromLabel } from "../src/lib/daily-statistics.ts";
import { parseInventoryRows } from "../src/lib/inventory-import.ts";
import { calculatePeriodStatistics, getStatisticsYears } from "../src/lib/period-statistics.ts";
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

assert.throws(
  () => parseInventoryRows([
    ["Naziv artikla", "Nabavna cijena", "Količina"],
    ["Artikal bez cijene", 0, 5],
  ]),
  (error) => error?.code === "costs-missing",
);
assert.throws(
  () => parseInventoryRows([
    ["Naziv artikla", "Nabavna cijena", "Količina"],
    ["Artikal A", 10, 20_000_000],
    ["Artikal B", 20, 15_000_000],
    ["Artikal C", 30, 8],
  ]),
  (error) => error?.code === "quantities-invalid",
);

const products = parsed.items.map((item, index) => ({
  id: index + 1,
  ...item,
  active: true,
  updatedAt: "2026-09-19T00:00:00.000Z",
}));
const matcher = new ProductMatcher(products);
const fuzzy = matcher.match("Zuri bjeli", 1);
assert.equal(fuzzy.matches[0]?.product.name, "Žuri bijeli");

const quantityPrefix = matcher.match("2x Zuri bjeli", 1);
assert.equal(quantityPrefix.matches[0]?.product.name, "Žuri bijeli");
assert.equal(quantityPrefix.matches[0]?.quantity, 2);

const quantitySuffix = matcher.match("Zuri bjeli 3 komada", 1);
assert.equal(quantitySuffix.matches[0]?.product.name, "Žuri bijeli");
assert.equal(quantitySuffix.matches[0]?.quantity, 3);

const aliased = new ProductMatcher(products, [{ normalizedAlias: "mara white", productId: 2 }]);
assert.equal(aliased.match("Mara white", 1).matches[0]?.product.name, "Ormar Jambo Bijeli");

const operationalProducts = parseInventoryRows([
  ["Naziv artikla", "Nabavna cijena", "Količina"],
  ["Zuri bijeli - sto za šimkanje", 40, 10],
  ["Stolica LULU", 15, 10],
  ["Komoda Kibo", 50, 10],
  ["Tunda bijeli 3 ladice", 30, 10],
  ["Usiku bijeli", 25, 10],
  ["Sto za šminkanje Imara bijeli", 45, 10],
  ["Sto za šminkanje ZOLA bijeli", 45, 10],
  ["Komoda MARA bijela", 50, 10],
  ["Komoda MARA orah", 50, 10],
  ["Komoda NORA bijela", 25, 10],
  ["Komoda NORA orah", 25, 10],
  ["Klub sto Duma bijeli", 37.07, 10],
]).items.map((item, index) => ({ id: index + 20, ...item }));
const operationalMatcher = new ProductMatcher(operationalProducts);
const implicitPair = operationalMatcher.match("Zuri sto Lulu stolica", 2);
assert.deepEqual(implicitPair.matches.map((match) => match.product.name), [
  "Zuri bijeli - sto za šimkanje",
  "Stolica LULU",
]);
assert.deepEqual(implicitPair.matches.map((match) => match.quantity), [1, 1]);
const descriptiveConjunction = operationalMatcher.match("Komoda Kibo sa vratima i policama", 1);
assert.equal(descriptiveConjunction.matches[0]?.product.name, "Komoda Kibo");
assert.deepEqual(descriptiveConjunction.unmatched, []);
const tundaPair = operationalMatcher.match("2x tunda s 3 ladice", 1);
assert.equal(tundaPair.matches[0]?.product.name, "Tunda bijeli 3 ladice");
assert.equal(tundaPair.matches[0]?.quantity, 2);
const usikuPair = operationalMatcher.match("usiku bijeli 2 komada", 1);
assert.equal(usikuPair.matches[0]?.product.name, "Usiku bijeli");
assert.equal(usikuPair.matches[0]?.quantity, 2);
const usikuPairAsWord = operationalMatcher.match("usiku bijeli dva", 1);
assert.equal(usikuPairAsWord.matches[0]?.product.name, "Usiku bijeli");
assert.equal(usikuPairAsWord.matches[0]?.quantity, 2);
const leadingWordQuantity = operationalMatcher.match("dvije komode Kibo", 1);
assert.equal(leadingWordQuantity.matches[0]?.product.name, "Komoda Kibo");
assert.equal(leadingWordQuantity.matches[0]?.quantity, 2);
const drawerCountAsWord = operationalMatcher.match("Tunda bijeli tri ladice", 1);
assert.equal(drawerCountAsWord.matches[0]?.product.name, "Tunda bijeli 3 ladice");
assert.equal(drawerCountAsWord.matches[0]?.quantity, 1);
const sdsSuffix = operationalMatcher.match("Tunda bijeli 3 ladice SDS 95", 1);
assert.equal(sdsSuffix.matches[0]?.product.name, "Tunda bijeli 3 ladice");
const dispatchNote = operationalMatcher.match("Zuri u utorak da ide", 1);
assert.equal(dispatchNote.matches[0]?.product.name, "Zuri bijeli - sto za šimkanje");
const trailingMultiplier = operationalMatcher.match("Kibo 2x", 1);
assert.equal(trailingMultiplier.matches[0]?.product.name, "Komoda Kibo");
assert.equal(trailingMultiplier.matches[0]?.quantity, 2);
const imaraTypo = operationalMatcher.match("Imama led ogledalo", 1);
assert.equal(imaraTypo.matches[0]?.product.name, "Sto za šminkanje Imara bijeli");
const zolaSet = operationalMatcher.match("Set zola", 1);
assert.equal(zolaSet.matches[0]?.product.name, "Sto za šminkanje ZOLA bijeli");
const maraSet = operationalMatcher.match("Set za dnevni boravak Mara Orah 200 cm", 2);
assert.deepEqual(maraSet.matches.map((match) => match.product.name), ["Komoda MARA orah", "Komoda NORA orah"]);
assert.deepEqual(maraSet.matches.map((match) => match.quantity), [1, 1]);
const doubleMaraSet = operationalMatcher.match("2x Mara set bijela", 4);
assert.deepEqual(doubleMaraSet.matches.map((match) => match.quantity), [2, 2]);
const redundantNora = operationalMatcher.match("Mara orah set i nora orah", 2);
assert.deepEqual(redundantNora.matches.map((match) => match.product.name), ["Komoda MARA orah", "Komoda NORA orah"]);
const savedMultiplierAlias = new ProductMatcher(operationalProducts, [{
  normalizedAlias: "klub stol duma smedji sa policama 120x60 2x",
  productId: operationalProducts.find((product) => product.name === "Klub sto Duma bijeli").id,
}]).match("Klub stol Duma smeđi sa policama 120x60 2x", 1);
assert.equal(savedMultiplierAlias.matches[0]?.product.name, "Klub sto Duma bijeli");
assert.equal(savedMultiplierAlias.matches[0]?.quantity, 2);
assert.deepEqual(savedMultiplierAlias.unmatched, []);
const dumaVariant = operationalMatcher.match("Klub stol Duma smeđi sa policama 120x60", 1);
assert.equal(dumaVariant.matches[0]?.product.name, "Klub sto Duma bijeli");
assert.deepEqual(dumaVariant.unmatched, []);
const dumaCombo = operationalMatcher.match("Klub stol Duma smeđi sa policama 120x60 + Komoda Kibo", 2);
assert.deepEqual(dumaCombo.matches.map((match) => match.product.name), ["Klub sto Duma bijeli", "Komoda Kibo"]);
const ambiguousDuma = new ProductMatcher([
  ...operationalProducts,
  { ...operationalProducts.find((product) => product.name === "Klub sto Duma bijeli"), id: 1000, name: "Klub sto Duma smeđi", normalizedName: "klub sto duma smedji" },
]).match("Klub stol Duma sa policama", 1);
assert.deepEqual(ambiguousDuma.matches, []);
const maraCombo = operationalMatcher.match("Komoda Kibo + Mara set bijela", 3);
assert.deepEqual(maraCombo.matches.map((match) => match.product.name), [
  "Komoda Kibo",
  "Komoda MARA bijela",
  "Komoda NORA bijela",
]);
assert.deepEqual(maraCombo.matches.map((match) => match.quantity), [1, 1, 1]);

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

const periodOrders = [
  order,
  { ...order, dateLabel: "15/01/2026", otkupnina: "100" },
  { ...order, dateLabel: "02/02/2026", otkupnina: "200" },
  { ...order, dateLabel: "03/02/2026", otkupnina: "120", appStatus: "returned:test" },
  { ...order, dateLabel: "04/03/2026", otkupnina: "89", artikal: "Zuri zamjena" },
  { ...order, dateLabel: "05/04/2026", otkupnina: "95", appStatus: "duplicate:test" },
  { ...order, dateLabel: "10/12/2025", otkupnina: "50" },
];
assert.deepEqual(getStatisticsYears(periodOrders), [2026, 2025]);
const periodStats = calculatePeriodStatistics(periodOrders, 2026);
assert.equal(periodStats.sourceOrderCount, 6);
assert.equal(periodStats.orderCount, 3);
assert.equal(periodStats.excludedOrderCount, 3);
assert.equal(periodStats.revenue, 400);
assert.equal(periodStats.months[0].orderCount, 1);
assert.equal(periodStats.months[0].revenue, 100);
assert.equal(periodStats.months[1].sourceOrderCount, 2);
assert.equal(periodStats.months[1].orderCount, 1);
assert.equal(periodStats.months[1].revenue, 200);
assert.equal(periodStats.months[2].orderCount, 0);
assert.equal(periodStats.days[0].dateLabel, "21/09/2026");

const wordQuantityStats = calculateDailyStatistics({
  orders: [{ ...order, artikal: "Usiku bijeli dva", brojPaketa: "1" }],
  products: operationalProducts,
  dateKey: "2026-09-21",
  metaSpendBam: 0,
});
assert.equal(wordQuantityStats.orderCount, 1);
assert.equal(wordQuantityStats.costOfGoods, 50);
assert.equal(wordQuantityStats.ranking[0].product.name, "Usiku bijeli");
assert.equal(wordQuantityStats.ranking[0].units, 2);

const replacementByName = calculateDailyStatistics({
  orders: [order, { ...order, artikal: "Zuri ogledalo zamjena", otkupnina: "89" }],
  products,
  dateKey: "2026-09-21",
  metaSpendBam: 10,
});
assert.equal(replacementByName.sourceOrderCount, 2);
assert.equal(replacementByName.orderCount, 1);
assert.equal(replacementByName.unmatchedLines, 0);
assert.equal(replacementByName.revenue, 100);
assert.equal(replacementByName.profitAfterAds, 26);

const replacementByColumn = calculateDailyStatistics({
  orders: [order, { ...order, artikal: "Nepoznat proizvod", zamjena: "1", otkupnina: "89" }],
  products,
  dateKey: "2026-09-21",
  metaSpendBam: 10,
});
assert.equal(replacementByColumn.orderCount, 1);
assert.equal(replacementByColumn.unmatchedLines, 0);
assert.equal(replacementByColumn.profitAfterAds, 26);

const incomplete = calculateDailyStatistics({
  orders: [{ ...order, artikal: "Nepoznat proizvod" }],
  products,
  dateKey: "2026-09-21",
  metaSpendBam: 10,
});
assert.equal(incomplete.costComplete, false);
assert.equal(incomplete.profitBeforeAds, null);
assert.equal(incomplete.profitAfterAds, null);

const missingPurchaseCost = calculateDailyStatistics({
  orders: [order],
  products: products.map((product) => ({ ...product, unitCost: 0 })),
  dateKey: "2026-09-21",
  metaSpendBam: 10,
});
assert.equal(missingPurchaseCost.unmatchedLines, 0);
assert.equal(missingPurchaseCost.missingCostProducts.length, 1);
assert.equal(missingPurchaseCost.costComplete, false);
assert.equal(missingPurchaseCost.profitBeforeAds, null);
assert.equal(missingPurchaseCost.profitAfterAds, null);

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

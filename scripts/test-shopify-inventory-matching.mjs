import assert from "node:assert/strict";

import { matchShopifyInventory } from "../src/lib/inventory-shopify-matching.ts";
import { normalizeInventoryName } from "../src/lib/inventory-import.ts";

const names = [
  [5, "Komoda Tanzi", "5"],
  [8, "Komoda SERENA bijela", "8, 26"],
  [9, "Klub sto Duma bijeli", "9"],
  [18, "Stolica LULU", "18"],
  [21, "Komoda MARA bijela", "21"],
  [24, "Komoda NORA bijela", "24"],
  [27, "Sto za šminkanje ZOLA bijeli", "27"],
];
const products = names.map(([id, name, sku]) => ({
  id,
  name,
  sku,
  normalizedName: normalizeInventoryName(name),
  unitCost: 50,
  quantity: 999,
}));

function shopifyProduct(id, title, quantity, sku = "") {
  return {
    id,
    title,
    variants: [{
      id: id * 10,
      product_id: id,
      title: "Default Title",
      sku,
      barcode: null,
      inventory_quantity: quantity,
      inventory_tracked: true,
    }],
  };
}

const result = matchShopifyInventory(products, [], [
  shopifyProduct(101, "Komoda Tanzi Bijela", 180, "5"),
  shopifyProduct(102, "Komoda Serena bijela sa 3 ladice i vratima", 109, "8"),
  shopifyProduct(103, "Klub stol Duma bijeli sa policama 120x60", 150, "9"),
  shopifyProduct(104, "Klub stol Duma smeđi sa policama 120x60", 149, "10"),
  shopifyProduct(105, "Zola Bijeli – Sto za šminkanje sa LED ogledalom", 80, "27"),
  shopifyProduct(106, "Stolica za šminkanje Lulu Zlatna", 196, "18"),
  shopifyProduct(107, "Set za dnevni boravak Mara Bijeli 200 cm", 79, "set-mara"),
  shopifyProduct(108, "Set za šminkanje Zola - stol + stolica", 67, "set-zola"),
]);

const updates = new Map(result.updates.map((update) => [update.productId, update.quantity]));
assert.equal(updates.get(5), 180);
assert.equal(updates.get(8), 109);
assert.equal(updates.get(9), 150, "exact Duma SKU must beat the fuzzy brown Duma candidate");
assert.equal(updates.get(27), 80);
assert.equal(updates.get(18), 196);
assert.equal(updates.has(21), false, "Mara set must not overwrite a component quantity");
assert.equal(updates.has(24), false, "Mara set must not overwrite a component quantity");
assert.ok(result.unmatchedLabels.includes("Set za dnevni boravak Mara Bijeli 200 cm"));

const untracked = matchShopifyInventory(products, [], [{
  ...shopifyProduct(109, "Komoda Tanzi Bijela", 0, "5"),
  variants: [{
    ...shopifyProduct(109, "Komoda Tanzi Bijela", 0, "5").variants[0],
    inventory_tracked: false,
  }],
}]);
assert.equal(untracked.updates.length, 0);
assert.equal(untracked.untrackedLabels.length, 1);

console.log(`Shopify inventory matching passed (${result.updates.length} safe updates).`);

import assert from "node:assert/strict";

import { mapShopifyProductToAnanas } from "../src/lib/ananas-mapping.ts";

const product = {
  id: 100,
  title: "Galago stolica",
  body_html: "<p>Udobna stolica.</p>",
  vendor: "Galago",
  product_type: "Stolice",
  image: { src: "https://cdn.shopify.com/chair.jpg" },
  images: [{ src: "https://cdn.shopify.com/chair.jpg" }],
  variants: [
    {
      id: 200,
      inventory_item_id: 300,
      title: "Bijela",
      sku: "CHAIR-WHITE",
      barcode: "3871234567890",
      price: "90.00",
      compare_at_price: "100.00",
      inventory_quantity: 7,
      weight: 2500,
      weight_unit: "g",
      sale_start: "2026-08-28",
      sale_end: "2026-09-20",
      discount_type: "SALE",
      selected_options: [{ name: "Boja", value: "Bijela" }],
    },
  ],
};

const [mapped] = mapShopifyProductToAnanas(product, { vat: 17, defaultWeightKg: 1 });
assert.equal(mapped.validationErrors.length, 0);
assert.equal(mapped.importProduct.ean, "3871234567890");
assert.equal(mapped.importProduct.basePrice, 100);
assert.equal(mapped.importProduct.vat, 17);
assert.equal(mapped.importProduct.packageWeightValue, 2.5);
assert.equal(mapped.importProduct.stockLevel, 7);
assert.deepEqual(mapped.importProduct.attributes, { Boja: ["Bijela"] });
assert.deepEqual(mapped.discount, {
  discountPrice: 90,
  discountPriceCurrency: "BAM",
  dateFrom: "28/08/2026",
  dateTo: "20/09/2026",
  discountType: "SALE",
});

const invalid = structuredClone(product);
invalid.variants[0].barcode = "";
const [missingEan] = mapShopifyProductToAnanas(invalid);
assert.equal(missingEan.importProduct, null);
assert(missingEan.validationErrors.includes("Missing EAN/barcode"));

const noDates = structuredClone(product);
noDates.variants[0].sale_start = null;
noDates.variants[0].sale_end = null;
const [dailyDiscount] = mapShopifyProductToAnanas(noDates, { today: "2026-09-11" });
assert(dailyDiscount.importProduct);
assert.equal(dailyDiscount.discountDatesInferred, true);
assert.equal(dailyDiscount.validationErrors.length, 0);
assert.deepEqual(dailyDiscount.discount, {
  discountPrice: 90,
  discountPriceCurrency: "BAM",
  dateFrom: "11/09/2026",
  dateTo: "11/09/2026",
  discountType: "SALE",
});

const partialDates = structuredClone(product);
partialDates.variants[0].sale_start = "2026-09-11";
partialDates.variants[0].sale_end = null;
const [missingEnd] = mapShopifyProductToAnanas(partialDates, { today: "2026-09-11" });
assert.equal(missingEnd.discount, null);
assert(missingEnd.validationErrors.some((error) => error.includes("sale_end")));

const untracked = structuredClone(product);
untracked.variants[0].inventory_tracked = false;
untracked.variants[0].inventory_quantity = -12;
const [fallbackStock] = mapShopifyProductToAnanas(untracked, { untrackedStockLevel: 10 });
assert.equal(fallbackStock.importProduct.stockLevel, 10);

console.log("Ananas mapping tests passed.");

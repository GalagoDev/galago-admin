/* eslint-disable @typescript-eslint/no-require-imports -- Isolated integration checks. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function (request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
let inventory = [];
const links = new Map();
const calls = [];
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/bedly-ananas-orders") return { syncBedlyAnanasOrders: async () => ({}), getBedlyOrderSyncStatus: () => ({}) };
  if (request === "@/lib/db") return { getDb: () => ({ prepare: () => ({ all: (sku) => inventory.filter((row) => row.sku === sku) }) }) };
  if (request === "@/lib/ananas-client") return {
    importAnanasProducts: async (products) => { calls.push({ type: "import", products }); return { id: "test-import" }; },
  };
  if (request === "@/lib/ananas-store") return {
    payloadHash: (data) => JSON.stringify(data),
    upsertAnanasProductLink: (data) => links.set(data.shopifyVariantId, data),
    getAnanasLinkByVariantId: (id) => links.get(id),
    markAnanasCatalogSubmitted: (items) => {
      for (const item of items) links.get(item.variantId).last_catalog_hash = item.catalogHash;
    },
  };
  if (request === "@/lib/shopify-admin") return { getShopifyProductsForAnanas: async () => {
    calls.push({ type: "galago" });
    return [{ id: 1, title: "Galago", body_html: "Opis", images: [{ src: "https://example.com/image.jpg" }],
      variants: [{ id: 2, barcode: "2063413525339", price: 45, inventory_quantity: 3, weight: 1 }] }];
  } };
  return load.call(this, request, parent, isMain);
};
const bedly = require("../src/lib/bedly-ananas.ts");
const { mapShopifyProductToAnanas } = require("../src/lib/ananas-mapping.ts");
const sync = require("../src/lib/ananas-sync.ts");
const [ergo, cloud] = bedly.BEDLY_ANANAS_PRODUCTS;
const fixture = (config) => ({
  id: config.productId, handle: config.handle, title: config.inventoryName, description: "<p>Opis</p>",
  images: ["//cdn.shopify.com/test.jpg"],
  variants: [{ id: config.variantId, price: 4900, compare_at_price: config === ergo ? 9800 : null, weight: 0, available: true }],
});
const row = (config, quantity) => ({ sku: config.inventorySku, name: config.inventoryName, quantity, active: 1 });
const mapped = (config, quantity) => mapShopifyProductToAnanas(bedly.mapBedlySource(config, fixture(config), row(config, quantity)))[0];

(async () => {
  const c = mapped(cloud, 298);
  assert.equal(c.importProduct.stockLevel, 149);
  assert.equal(mapped(cloud, 296).importProduct.stockLevel, 148);
  assert.equal(mapped(cloud, 297).importProduct.stockLevel, 148, "never offer a partial two-pillow pack");
  assert.equal(mapped(cloud, 1).importProduct.stockLevel, 0);
  assert.equal(mapped(cloud, -1).importProduct.stockLevel, 0);
  assert.equal(c.importProduct.basePrice, 49);
  assert.equal(c.discount, null);
  assert.equal(c.importProduct.vat, 17);
  assert.equal(c.importProduct.sku, "BEDLY-17-SET2");
  assert.match(c.importProduct.name, /set od 2 jastuka/);
  assert.match(c.shopifyVariantId, /^bedly:/);
  assert.equal(c.importProduct.externalId, c.shopifyVariantId);
  assert.equal(c.shopifyInventoryItemId, null);
  assert.equal(c.importProduct.coverImage, "https://cdn.shopify.com/test.jpg");
  const e = mapped(ergo, 295);
  assert.equal(e.importProduct.stockLevel, 295);
  assert.equal(e.importProduct.basePrice, 98);
  assert.equal(e.discount.discountPrice, 49);
  assert.equal(e.discount.discountPriceCurrency, "BAM");
  assert.notEqual(e.importProduct.ean, c.importProduct.ean);
  for (const code of [e.importProduct.ean, c.importProduct.ean]) {
    assert.match(code, /^20\d{11}$/);
    assert.equal([...code].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10, 0);
  }
  assert.throws(() => bedly.mapBedlySource(ergo, fixture(cloud), row(ergo, 1)), /identity/);
  assert.throws(() => bedly.mapBedlySource(ergo, fixture(ergo), undefined), /mapping/);
  assert.throws(() => bedly.mapBedlySource(ergo, fixture(ergo), row(cloud, 1)), /mapping/);
  assert.throws(() => bedly.mapBedlySource(ergo, fixture(ergo), row(ergo, NaN)), /quantity/);
  const p = fixture(ergo); p.variants.push(p.variants[0]);
  assert.throws(() => bedly.mapBedlySource(ergo, p, row(ergo, 1)), /variants/);
  const inactive = row(cloud, 298); inactive.active = 0;
  assert.equal(bedly.mapBedlySource(cloud, fixture(cloud), inactive).variants[0].inventory_quantity, 0);
  let currency = "BAM";
  inventory = [row(ergo, 295), row(cloud, 298)];
  global.fetch = async (url) => {
    if (url === "https://bedly.ba/cart.js") return Response.json({ currency });
    const config = bedly.BEDLY_ANANAS_PRODUCTS.find((item) => url === `https://bedly.ba/products/${item.handle}.js`);
    assert.ok(config, "only the two approved product endpoints may be fetched");
    return Response.json(fixture(config));
  };
  const opts = { submitCatalog: true, refreshIds: false, syncPricesStock: false, syncDiscounts: false };
  const result = await sync.runFullAnanasReconciliation(undefined, { ...opts, source: "bedly" });
  assert.equal(result.sources[0].submittedForImport, 2);
  assert.equal(calls.filter((call) => call.type === "galago").length, 0, "targeted Bedly import must not touch Galago");
  assert.equal(calls[0].products.length, 2);
  assert.ok(calls[0].products.every((product) => product.externalId.startsWith("bedly:")));
  currency = "EUR";
  await assert.rejects(() => bedly.getBedlyProductsForAnanas(), /currency must be BAM/);
  calls.length = 0;
  await assert.rejects(() => sync.runFullAnanasReconciliation(undefined, opts), /bedly:.*currency/);
  assert.ok(calls.some((call) => call.type === "import" && call.products[0].name === "Galago"), "Galago still completes when Bedly fails");
  currency = "BAM";
  inventory.push(row(cloud, 100));
  await assert.rejects(() => bedly.getBedlyProductsForAnanas(), /Expected one/);
  inventory.pop();
  process.env.ANANAS_SYNC_SECRET = "isolated-test-secret";
  const statusRoute = require("../src/app/api/integrations/ananas/status/route.ts");
  const statusUrl = "https://admin.example.invalid/api/integrations/ananas/status?source=bedly";
  assert.equal((await statusRoute.GET(new Request(statusUrl))).status, 401);
  const preview = await statusRoute.GET(new Request(statusUrl, { headers: { "x-integration-secret": "isolated-test-secret" } }));
  assert.equal(preview.status, 200);
  const previewData = await preview.json();
  assert.equal(previewData.products.length, 2);
  assert.equal(previewData.inventorySource, "admin-lager");
  const runRoute = require("../src/app/api/integrations/ananas/run/route.ts");
  assert.equal((await runRoute.POST(new Request("https://admin.example.invalid/run", {
    method: "POST", headers: { "x-integration-secret": "isolated-test-secret" }, body: JSON.stringify({ source: "arbitrary-store" }),
  }))).status, 400);
  console.log("Bedly Ananas checks passed: two-product scope, pack stock, BAM/VAT prices, IDs, inventory safety and source isolation.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

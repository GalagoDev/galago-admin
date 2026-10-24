/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQLite and HTTP contract tests. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "galago-bazzar-tests-"));
process.env.DATABASE_PATH = ":memory:";
process.env.ANANAS_SYNC_SECRET = "admin-test-secret";
delete process.env.BAZZAR_FEED_TOKEN;
process.env.BAZZAR_FEED_ENABLED = "true";
process.env.BAZZAR_FEED_BASE_URL = "https://admin.example.invalid";
let catalog, failure = false, sourceCalls = 0;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/storage") return { ensureStorage: () => ({ data: temp }), resolveRuntimePath: () => ":memory:" };
  if (request === "@/lib/shopify-admin") return { getShopifyProductsForBazzar: async () => {
    sourceCalls++; if (failure) throw new Error("Shopify unavailable"); return structuredClone(catalog);
  } };
  return load.call(this, request, parent, isMain);
};
const { getDb } = require("../src/lib/db.ts");
const db = getDb();
const mapping = require("../src/lib/bazzar-mapping.ts");
const service = require("../src/lib/bazzar-feed.ts");
const route = require("../src/app/api/integrations/bazzar/feed.xml/route.ts");
const statusRoute = require("../src/app/api/integrations/bazzar/status/route.ts");
const fixture = () => [{ id: 1, title: "Stolica Lulu & 'Test' <posebno>", vendor: "Galago.ba", status: "active", product_type: "Dom|Stolice",
  body_html: '<p>Čvrsta & udobna ]]>\u0001 stolica 😀</p>', image: { src: "https://cdn.example.invalid/image.jpg?v=1&width=900" },
  variants: [{ id: 11, title: "Default Title", sku: "mutable-sku", barcode: "2063739239255", price: "45.00", compare_at_price: "65.00", inventory_tracked: true, inventory_quantity: 192, weight: 2.7, weight_unit: "kg" }],
}];
catalog = fixture();
const parse = (xml, xpath) => {
  const result = spawnSync("xmllint", ["--nonet", ...(xpath ? ["--xpath", xpath] : ["--noout"]), "-"], { input: xml, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

(async () => {
  assert.deepEqual(mapping.bazzarPrices("45.00", "65.00"), { retailPrice: "65.00", discountedRetailPrice: "45.00", vendorPrice: "32.69" });
  assert.equal(mapping.bazzarPrices("49.00", null).vendorPrice, "35.60");
  assert.equal(mapping.bazzarPrices("100.00", "0").vendorPrice, "72.65");
  assert.equal(mapping.bazzarPrices("49.00", "49.00").discountedRetailPrice, null);
  assert.equal(mapping.bazzarPrices("49.00", "40.00").retailPrice, "49.00");
  for (const value of ["0", "-1", "NaN", "Infinity", "", "1.001", "1,00", null]) assert.throws(() => mapping.bazzarPrices(value, null));
  const { offers } = mapping.mapBazzarCatalog(catalog);
  const xml = mapping.renderBazzarXml(offers);
  parse(xml);
  assert.equal(parse(xml, "count(/products/product)"), "1");
  assert.equal(parse(xml, "string(/products/product/vendor_price)"), "32.69");
  assert.equal(parse(xml, "string(/products/product/weight)"), "2700");
  assert.equal(parse(xml, "string(/products/product/title)"), catalog[0].title);
  assert.equal(parse(xml, "string(/products/product/description)"), catalog[0].body_html.replace("\u0001", ""));
  assert.equal(parse(xml, "string(/products/product/images/image)"), catalog[0].image.src);
  assert.equal(offers[0].id, "GALAGO-11");
  catalog[0].variants[0].sku = "changed";
  assert.equal(mapping.mapBazzarCatalog(catalog).offers[0].id, "GALAGO-11", "changing SKU must not recycle identity");
  catalog[0].variants.push({ ...catalog[0].variants[0], id: 12, barcode: "2070656635732", title: "Crna", price: "59.00", inventory_quantity: 0 });
  assert.equal(mapping.mapBazzarCatalog(catalog).offers.length, 2, "differently priced variants are separate stable offers");
  assert.equal(mapping.mapBazzarCatalog(catalog).offers[1].stock, 0);
  const secondId = mapping.mapBazzarCatalog(catalog).offers[1].id;
  catalog[0].variants.shift();
  assert.equal(mapping.mapBazzarCatalog(catalog).offers[0].id, secondId, "removing another variant must not change surviving identity");
  catalog = fixture();
  catalog[0].variants[0].weight = 0;
  assert.equal(mapping.mapBazzarCatalog(catalog).offers[0].weight, null);
  catalog[0].variants[0].inventory_tracked = false;
  assert.equal(mapping.mapBazzarCatalog(catalog).offers[0].stock, 0);
  catalog[0].variants[0].inventory_tracked = true;
  catalog[0].variants[0].inventory_quantity = -3;
  assert.equal(mapping.mapBazzarCatalog(catalog).offers[0].stock, 0);
  catalog[0].variants[0].inventory_quantity = NaN;
  assert.throws(() => mapping.mapBazzarCatalog(catalog), /stock/);
  catalog = fixture();
  assert.throws(() => mapping.mapBazzarCatalog([...catalog, ...catalog]), /Duplicate/);
  assert.throws(() => mapping.mapBazzarCatalog([]), /Empty/);
  assert.throws(() => mapping.mapBazzarCatalog([{ ...catalog[0], source_store: "bedly" }]), /non-Galago/);
  assert.equal(mapping.mapBazzarCatalog([...catalog, { ...catalog[0], vendor: "Bedly" }]).offers.length, 1);
  assert.equal(mapping.mapBazzarCatalog([...catalog, { ...catalog[0], status: "draft" }]).offers.length, 1);
  const noImage = fixture(); noImage[0].image = null;
  assert.throws(() => mapping.mapBazzarCatalog(noImage), /image/);

  const privateUrl = service.getBazzarFeedUrl();
  const token = new URL(privateUrl).searchParams.get("token");
  assert.ok(token.length >= 32);
  assert.equal(fs.statSync(path.join(temp, "bazzar-feed-secret")).mode & 0o777, 0o600);
  assert.equal(service.getBazzarFeedUrl(), privateUrl);
  assert.equal(service.verifyBazzarFeedToken(null), false);
  assert.equal(service.verifyBazzarFeedToken("wrong"), false);
  assert.equal((await route.GET(new Request("https://admin.invalid/api/integrations/bazzar/feed.xml"))).status, 401);
  assert.equal((await route.GET(new Request(privateUrl.replace(token, "wrong")))).status, 401);
  assert.equal(sourceCalls, 0);
  assert.equal((await statusRoute.GET(new Request("https://admin.invalid/status"))).status, 401);
  const statusResponse = await statusRoute.GET(new Request("https://admin.invalid/status", { headers: { "x-integration-secret": "admin-test-secret" } }));
  assert.equal((await statusResponse.json()).feedUrl, privateUrl);
  const response = await route.GET(new Request(privateUrl));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /application\/xml/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(parse(await response.text(), "string(/products/product/stock)"), "192");
  catalog[0].variants[0].price = "55.00"; catalog[0].variants[0].compare_at_price = null; catalog[0].variants[0].inventory_quantity = 0;
  const changed = await route.GET(new Request(privateUrl)); const changedXml = await changed.text();
  assert.equal(parse(changedXml, "string(/products/product/retail_price)"), "55.00");
  assert.equal(parse(changedXml, "count(/products/product/discounted_retail_price)"), "0", "ending a sale removes the optional discount");
  assert.equal(parse(changedXml, "string(/products/product/vendor_price)"), "39.96");
  assert.equal(parse(changedXml, "string(/products/product/stock)"), "0");
  const previousSuccess = service.getBazzarFeedStatus().snapshot.last_success_at;
  failure = true;
  const failed = await route.GET(new Request(privateUrl));
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /<products/);
  assert.equal(service.getBazzarFeedStatus().snapshot.last_success_at, previousSuccess);
  assert.match(service.getBazzarFeedStatus().snapshot.last_error, /unavailable/);
  failure = false; catalog = [];
  assert.equal((await route.GET(new Request(privateUrl))).status, 503);
  catalog = fixture();
  assert.equal((await route.GET(new Request(privateUrl))).status, 200);
  assert.equal(service.getBazzarFeedStatus().snapshot.last_error, null);
  const calls = sourceCalls;
  await Promise.all([route.GET(new Request(privateUrl)), route.GET(new Request(privateUrl))]);
  assert.equal(sourceCalls - calls, 1);
  process.env.BAZZAR_FEED_ENABLED = "false";
  assert.equal((await route.GET(new Request(privateUrl))).status, 503);

  // Actual Shopify adapter: correct store/currency and complete pagination, no writes.
  process.env.SHOPIFY_STORE_DOMAIN = "wktcnu-i5.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "test-only";
  const shopify = require("../src/lib/shopify-admin.ts");
  let currency = "BAM", brokenCursor = false;
  const node = { legacyResourceId: "11", title: "Default Title", sku: null, barcode: "2063739239255", price: "45.00", compareAtPrice: "65.00", inventoryQuantity: 5,
    inventoryItem: { legacyResourceId: "111", tracked: true }, selectedOptions: [], media: { nodes: [] },
    product: { legacyResourceId: "1", title: "Lulu", descriptionHtml: "Opis", vendor: "Galago", productType: "Stolice", status: "ACTIVE", handle: "lulu", media: { nodes: [] } } };
  global.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/wktcnu-i5\.myshopify\.com\/admin\/api\//);
    assert.ok(options.signal);
    const body = JSON.parse(options.body); assert.doesNotMatch(body.query, /\bmutation\b/);
    if (body.query.includes("BazzarCurrency")) return Response.json({ data: { shop: { currencyCode: currency } } });
    return Response.json({ data: { productVariants: { nodes: [node], pageInfo: { hasNextPage: brokenCursor, endCursor: null } } } });
  };
  assert.equal((await shopify.getShopifyProductsForBazzar()).length, 1);
  currency = "EUR"; await assert.rejects(() => shopify.getShopifyProductsForBazzar(), /BAM/);
  currency = "BAM"; brokenCursor = true;
  await assert.rejects(() => shopify.getShopifyProductsForBazzar(), /pagination/);
  process.env.SHOPIFY_STORE_DOMAIN = "waetdj-4t.myshopify.com";
  await assert.rejects(() => shopify.getShopifyProductsForBazzar(), /Galago/);
  console.log("Bazzar checks passed: net margin/VAT, sale lifecycle, XML parser/escaping, real SQLite, stock, source isolation, persistent auth, HTTP failures, no caching, pagination and dynamic refresh.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  db.close();
  fs.rmSync(temp, { recursive: true }); // This test's own mkdtemp directory only.
});

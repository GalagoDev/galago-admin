/* eslint-disable @typescript-eslint/no-require-imports -- Real SQLite with isolated external APIs. */
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
let orders = [], shipments = [], apiError = false, orderCalls = 0;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/storage") return { ensureStorage: () => ({ data: "/unused" }), resolveRuntimePath: () => ":memory:" };
  if (request === "@/lib/ananas-client") return {
    getAnanasOrders: async (from, to) => {
      assert.equal(from, "2026-10-23T00:00:00.000Z"); assert.ok(to); orderCalls++;
      if (apiError) throw new Error("API unavailable"); return orders;
    },
    getAnanasOrderShipments: async () => shipments,
  };
  return load.call(this, request, parent, isMain);
};
process.env.DATABASE_PATH = ":memory:";
process.env.ANANAS_BEDLY_ENABLED = "true";
process.env.ANANAS_BEDLY_ORDER_SYNC_ENABLED = "true";
const { getDb } = require("../src/lib/db.ts");
const { BEDLY_ANANAS_PRODUCTS: products, bedlyEan } = require("../src/lib/bedly-ananas.ts");
const servicePath = require.resolve("../src/lib/bedly-ananas-orders.ts");
let service = require(servicePath);
const db = getDb();
db.prepare("INSERT INTO inventory_imports (id, original_name, file_hash, item_count) VALUES (1, 'test', 'test', 3)").run();
for (const config of products) db.prepare("INSERT INTO inventory_products (sku, name, normalized_name, unit_cost, quantity, last_import_id) VALUES (?, ?, ?, 1, ?, 1)")
  .run(config.inventorySku, config.inventoryName, config.inventoryName, config.unitsPerPack === 2 ? 298 : 295);
db.prepare("INSERT INTO inventory_products (sku, name, normalized_name, unit_cost, quantity, last_import_id) VALUES ('galago', 'Galago', 'galago', 1, 10, 1)").run();
const [ergo, cloud] = products;
const sku = (c) => `BEDLY-${c.inventorySku}${c.unitsPerPack === 2 ? "-SET2" : ""}`;
const item = (c, n = 1) => ({ productEan: bedlyEan(c.variantId), productSku: sku(c), quantity: n });
const order = (id, items) => ({ id, createdDate: "2026-10-23T12:00:00.000Z", items });
const shipment = (o, status = "CONFIRMED", n = 1, packed = 0) => ({ orderId: o.id, suborderId: `${o.id}-DS-1`, status,
  items: o.items.map((i) => ({ ...i, orderedQuantity: i.quantity, confirmedQuantity: n, packedQuantity: packed })) });
const stock = (c) => db.prepare("SELECT quantity FROM inventory_products WHERE sku = ?").get(c.inventorySku).quantity;
const count = () => db.prepare("SELECT COUNT(*) AS n FROM bedly_ananas_stock_movements").get().n;
const claim = () => db.prepare("UPDATE bedly_ananas_order_state SET lease_owner = 'test', lease_until = ? WHERE id = 1").run(Date.now() + 60000);
const apply = (o, ss) => { claim(); return service.applyBedlyOrder(o.id, service.planBedlyOrder(o, ss), "test"); };
db.prepare("INSERT INTO bedly_ananas_order_state (id, activated_at) VALUES (1, '2026-10-23T00:00:00.000Z')").run();

(async () => {
  const both = order("both", [item(cloud), item(ergo)]);
  const confirmed = shipment(both);
  assert.equal(apply(both, [confirmed]), 2);
  assert.equal(stock(cloud), 296); assert.equal(stock(ergo), 294);
  assert.equal(apply(both, [confirmed]), 0); assert.equal(count(), 2);
  delete require.cache[servicePath]; service = require(servicePath);
  assert.equal(apply(both, [confirmed]), 0, "restart must not deduct twice");
  assert.equal(apply(both, [shipment(both, "CANCELLED")]), 2);
  assert.equal(stock(cloud), 298); assert.equal(stock(ergo), 295);
  assert.equal(apply(both, [shipment(both, "CANCELLED")]), 0, "cancellation must restore once");

  const partial = order("partial", [item(cloud, 3)]);
  apply(partial, [shipment(partial, "PARTIALLY_CONFIRMED", 2)]);
  assert.equal(stock(cloud), 294);
  apply(partial, [shipment(partial, "PARTIALLY_CONFIRMED", 1)]);
  assert.equal(stock(cloud), 296, "release rejected confirmations before dispatch");
  apply(partial, [shipment(partial, "COLLECTED", 1, 1)]);
  apply(partial, [shipment(partial, "CANCELLED", 0)]);
  assert.equal(stock(cloud), 296, "do not restock after known dispatch");
  apply(partial, [shipment(partial, "RETURNED_TO_SELLER", 0)]);
  assert.equal(stock(cloud), 296, "returns require physical inspection");

  const pending = order("pending", [item(ergo)]);
  assert.deepEqual(service.planBedlyOrder(pending, [shipment(pending, "PENDING", null)]), []);
  assert.deepEqual(service.planBedlyOrder(pending, []), []);
  assert.deepEqual(service.planBedlyOrder(pending, [shipment(order("unrelated", [item(ergo)]))]), []);
  assert.throws(() => service.planBedlyOrder(pending, [shipment(pending), shipment(pending)]), /Duplicate/);
  const bad = shipment(pending); bad.items[0].productSku = "other";
  assert.throws(() => service.planBedlyOrder(pending, [bad]), /SKU\/EAN/);
  assert.throws(() => service.planBedlyOrder(pending, [shipment(pending, "CONFIRMED", -1)]), /quantity/);
  assert.throws(() => service.planBedlyOrder(pending, [shipment(pending, "CONFIRMED", 2)]), /exceeds/);
  const split = order("split", [item(cloud, 2)]);
  const a = shipment(split), b = shipment(split); a.items[0].orderedQuantity = 1; b.items[0].orderedQuantity = 1; b.suborderId += "-2";
  assert.throws(() => service.planBedlyOrder(split, [a]), /Incomplete/);
  apply(split, [a, b]); assert.equal(stock(cloud), 292);

  const rollback = order("rollback", [item(cloud), item(ergo)]);
  db.prepare("UPDATE inventory_products SET name = 'wrong' WHERE sku = '16'").run();
  const before = count();
  assert.throws(() => apply(rollback, [shipment(rollback)]), /mapping/);
  assert.equal(stock(cloud), 292); assert.equal(count(), before, "all products rolled back with stock ledger");
  db.prepare("UPDATE inventory_products SET name = ? WHERE sku = '16'").run(ergo.inventoryName);
  assert.throws(() => service.applyBedlyOrder("stale", service.planBedlyOrder(pending, [shipment(pending)]), "other-owner"), /lease/);
  db.prepare("UPDATE bedly_ananas_order_state SET lease_until = 0, lease_owner = NULL").run();

  orders = [pending, order("galago", [{ productEan: "123", productSku: "galago", quantity: 1 }])];
  shipments = [shipment(pending)];
  const first = await service.syncBedlyAnanasOrders(true);
  assert.equal(first.matchedOrders, 1); assert.equal(first.movements, 1); assert.equal(stock(ergo), 294);
  assert.equal(db.prepare("SELECT quantity FROM inventory_products WHERE sku = 'galago'").get().quantity, 10);
  assert.equal((await service.syncBedlyAnanasOrders(true)).movements, 0);
  const priorCalls = orderCalls;
  assert.equal((await service.syncBedlyAnanasOrders()).skipped, "recent-success");
  assert.equal(orderCalls, priorCalls);
  apiError = true;
  await assert.rejects(() => service.syncBedlyAnanasOrders(true), /API unavailable/);
  assert.equal(stock(ergo), 294); assert.match(service.getBedlyOrderSyncStatus().state.last_error, /unavailable/);
  apiError = false;
  claim(); await assert.rejects(() => service.syncBedlyAnanasOrders(true), /already running/);
  db.prepare("UPDATE bedly_ananas_order_state SET lease_until = 0").run();
  await service.syncBedlyAnanasOrders(true);
  assert.equal(service.getBedlyOrderSyncStatus().state.last_error, null);

  const oversold = order("oversold", [item(ergo, 300)]);
  apply(oversold, [shipment(oversold, "CONFIRMED", 300)]);
  assert.equal(stock(ergo), -6); assert.equal(service.getBedlyOrderSyncStatus().negativeStock.length, 1);
  apply(oversold, [shipment(oversold, "CANCELLED", 0)]); assert.equal(stock(ergo), 294);
  process.env.ANANAS_BEDLY_ORDER_SYNC_ENABLED = "false";
  assert.equal((await service.syncBedlyAnanasOrders(true)).skipped, "disabled");
  // Exercise the actual HTTP adapter, pagination and credential handling without network.
  process.env.ANANAS_CLIENT_ID = "test-client";
  process.env.ANANAS_CLIENT_SECRET = "test-secret";
  process.env.ANANAS_API_BASE_URL = "https://ananas.example.invalid";
  let pages = 0, invalidPage = false;
  global.fetch = async (url, options) => {
    assert.ok(options.signal, "network requests must time out");
    if (url.endsWith("/auth/token")) return Response.json({ access_token: "test-token", expires_in: 900 });
    assert.equal(options.method, "GET", "order adapter must never change Ananas orders");
    assert.equal(options.headers.authorization, "Bearer test-token");
    const parsed = new URL(url); const page = Number(parsed.searchParams.get("page"));
    assert.equal(parsed.searchParams.get("size"), "100"); pages++;
    return Response.json({ content: [pending], number: invalidPage ? 99 : page, last: page === 1 });
  };
  const client = require("../src/lib/ananas-client.ts");
  assert.equal((await client.getAnanasOrders("from", "to")).length, 2); assert.equal(pages, 2);
  invalidPage = true;
  await assert.rejects(() => client.getAnanasOrders("from", "to"), /pagination/);
  process.env.ANANAS_SYNC_SECRET = "isolated-secret";
  const route = require("../src/app/api/integrations/ananas/run/route.ts");
  assert.equal((await route.POST(new Request("https://admin.invalid/run", { method: "POST", body: '{"action":"bedly-orders"}' }))).status, 401);
  console.log("Bedly orders passed: real SQLite migration/transactions, pack counts, idempotency/restart, cancellations, returns, split shipments, scope, failure/retry, lease, cooldown and overselling.");
  db.close();
})().catch((error) => { console.error(error); db.close(); process.exitCode = 1; });

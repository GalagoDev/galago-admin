/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server-page tests with synthetic orders. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest); };
const compile = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
Module._extensions[".ts"] = compile; Module._extensions[".tsx"] = compile;
const { isActiveOrderRow } = require("../src/lib/google-sheets.ts");
const order = (id, extra = {}) => ({ rowNumber: id, sheetRowNumber: id + 2, fingerprint: "test" + id, dateLabel: "28/10/2026", primalac: "Synthetic " + id,
  brojTelefona: "061111111", grad: "71000", adresa: "Test bb", artikal: "Test", brojPaketa: "1", otkupnina: "89.10", vrijednostPosiljke: "89.10",
  dop: "1", zamjena: "0", sourceId: "test:" + id, appStatus: "", receivedAt: "", riskReview: "", deliveredChecked: false, ...extra });
// All four open carrier categories must be included, even without a tracking link.
const rows = [order(1), order(2), order(3), order(4, { brojPaketa: "2" }), order(5, { appStatus: "delivered:old" }),
  order(6, { appStatus: "returned:old" }), order(7, { appStatus: "duplicate:old" }), order(8, { deliveredChecked: true })];
let fail = false, reads = 0;
Module._load = function(request, parent, isMain) {
  if (request === "next/link") return { __esModule: true, default: "a" };
  if (request === "@/components/order-list-page") return { OrderListPage: "order-list-page" };
  if (request === "@/components/delivery-reconciliation") return { DeliveryReconciliation: "delivery-reconciliation" };
  if (request === "@/app/actions/courier") return { refreshCourierStatusesAction: async () => {} };
  if (request === "@/app/actions/auth") return { logoutAction: async () => {} };
  if (request === "@/lib/inventory") return { getInventoryOverview: () => ({ products: [] }) };
  if (request === "@/lib/courier-tracking-store") return { getCourierSyncStatus: () => undefined, courierTrackingSnapshot: () => { throw Error("Carrier categories must not filter financial totals"); } };
  if (request === "@/lib/google-sheets") return { isActiveOrderRow, getReturnedSheetRows: async () => [], getOrdersSheetRows: async options => {
    assert.equal(options.fresh, true); reads++; if (fail) throw Error("synthetic failure"); return rows;
  } };
  return load.call(this, request, parent, isMain);
};
const page = require("../src/app/in-transit/page.tsx").default, home = require("../src/app/page.tsx").default;
function elements(node) {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  return Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
}
(async () => {
  for (const view of [undefined, "active", "registered", "partial", "review", "delivered", "returned"]) {
    const result = await page({ searchParams: Promise.resolve({ view }) });
    assert.equal(result.props.title, "Na dostavi");
    assert.deepEqual(result.props.orders.map(o => o.sourceId), ["test:1", "test:2", "test:3", "test:4"]);
    assert.equal(result.props.courierStates, undefined); assert.equal(result.props.summaryExtra, undefined);
    assert.equal(result.props.allowReturns, true);
    assert.ok(!elements(result).some(e => e.type === "nav"), "no category tabs or manual review split");
  }
  const dashboard = await home({ searchParams: Promise.resolve({}) });
  const card = elements(dashboard).find(e => e.type === "a" && e.props.href === "/in-transit" && text(e).includes("KM ukupno"));
  assert.ok(card); assert.match(text(card), /Na dostavi4/); assert.match(text(card), /356\.4 KM ukupno/);
  fail = true;
  const unavailable = await page({ searchParams: Promise.resolve({}) });
  assert.equal(unavailable.props.summaryUnavailable, true, "a failed source read must not show a confirmed zero");
  assert.ok(reads >= 9);
  console.log("Delivery overview passed: all open orders combined, archived/returned/duplicate/checked rows excluded, legacy views ignored, dashboard totals aligned, fresh reads and failure state.");
})().catch(error => { console.error(error); process.exitCode = 1; });

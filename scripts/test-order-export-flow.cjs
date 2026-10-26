/* eslint-disable @typescript-eslint/no-require-imports -- This test isolates server dependencies with the CommonJS loader. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const XLSX = require("xlsx");

// Load the real page, action and route with in-memory Sheets and Next adapters.
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file);
}

const workday = require("../src/lib/order-workday.ts");
const session = require("../src/lib/session.ts");
const originalAppPassword = process.env.APP_PASSWORD;
process.env.APP_PASSWORD = "local-export-flow-test-password";
const { createOrderFingerprint } = require("../src/lib/order-fingerprint.ts");
const { planOrderRiskDecisions } = require("../src/lib/order-risk-decisions.ts");
const window = workday.getOperationalExportWindow(new Date("2026-10-16T05:08:00Z"));
let authenticated = true;
let readError = false;
let markerError = false;
const exportMarkers = [];

function order(row, name, phone, dateLabel, receivedAt) {
  const value = {
    rowNumber: row, sheetRowNumber: row, primalac: name, brojTelefona: phone,
    grad: "71000", adresa: "Test bb", artikal: "Test item", brojPaketa: "1",
    otkupnina: "95", vrijednostPosiljke: "95", dop: "1", zamjena: "0",
    sourceId: `test:${row}`, appStatus: "", riskReview: "", deliveredChecked: false,
    dateLabel, receivedAt,
  };
  return { ...value, fingerprint: createOrderFingerprint(value) };
}
const rows = [
  order(3, "Future Buyer", "061999999", "19/10/2026", "2026-10-16T08:00:00Z"),
  order(6, "Safe Buyer", "061333333", "16/10/2026", "2026-10-15T06:30:00Z"),
  order(7, "Repeated Buyer", "061111111", "16/10/2026", "2026-10-15T07:00:00Z"),
  order(8, "Excluded Buyer", "061444444", "16/10/2026", "2026-10-15T08:00:00Z"),
  order(11, "Older Block Buyer", "062222222", "15/10/2026", "2026-10-15T07:30:00Z"),
  order(20, "Previous Buyer", "061111111", "13/10/2026", "2026-10-12T07:00:00Z"),
  order(21, "Another Previous Buyer", "062222222", "13/10/2026", "2026-10-12T07:30:00Z"),
];
rows[3].appStatus = `duplicate:${rows[3].fingerprint}`;

function redirect(location) { throw Object.assign(new Error("Redirect"), { location }); }
async function persist(references, decision) {
  const updates = planOrderRiskDecisions(rows, references, decision);
  for (const update of updates) Object.assign(rows.find((row) => row.sheetRowNumber === update.sheetRowNumber), {
    appStatus: update.appStatus, riskReview: update.riskReview,
  });
  return { count: updates.length, decision };
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/navigation") return { redirect };
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "next/headers") return { cookies: async () => ({ get: () => authenticated ? { value: session.createSession() } : undefined }) };
  if (request === "@/components/order-list-page") return { OrderListPage: () => null };
  if (request === "@/lib/order-workday") return { ...workday, getOperationalExportWindow: () => window };
  if (request === "@/lib/google-sheets") return {
    getOrdersSheetRows: async () => { if (readError) throw new Error("private upstream failure"); return rows; },
    getReturnedSheetRows: async () => [],
    isActiveOrderRow: (row) => !row.deliveredChecked && !/^(delivered|returned|duplicate):/.test(row.appStatus),
  };
  if (request === "@/lib/google-orders") return {
    setOrderRiskDecision: (reference, decision) => persist([reference], decision),
    setOrderRiskDecisions: persist,
    markLastExportedOrder: async (...args) => { if (markerError) throw new Error("private marker failure"); exportMarkers.push(args); },
  };
  if (request === "@/lib/telegram-orders") return { normalizeTelegramPostalCode: (value) => /^\d{5}$/.test(value) ? value : "" };
  return originalLoad.call(this, request, parent, isMain);
};

function form(orders, decision) {
  const data = new FormData();
  data.set("view", "export");
  if (decision) data.set("decision", decision);
  for (const { sheetRowNumber, fingerprint, dateLabel, sourceId } of orders) {
    data.append("order", JSON.stringify({ sheetRowNumber, fingerprint, dateLabel, sourceId }));
  }
  return data;
}
async function expectRedirect(run, location) {
  await assert.rejects(run, (error) => error.location === location);
}

(async () => {
  const { GET } = require("../src/app/orders/export/route.ts");
  const get = (json = false) => GET(new Request("http://localhost/orders/export", { headers: json ? { Accept: "application/json" } : {} }));
  const Page = require("../src/app/orders/page.tsx").default;
  const actions = require("../src/app/actions/order-risk.ts");
  const blocked = await get();
  assert.equal(blocked.status, 303);
  assert.equal(blocked.headers.get("Location"), "/orders?view=export&exportError=review&refresh=1#risk-alerts");
  const blockedJson = await get(true);
  assert.equal(blockedJson.status, 409);
  assert.deepEqual(await blockedJson.json(), { redirect: blocked.headers.get("Location") });
  assert.equal(exportMarkers.length, 0, "blocked export must not mark any order as exported");

  const normal = await Page({ searchParams: Promise.resolve({}) });
  assert.deepEqual(normal.props.orders.map((row) => row.sheetRowNumber), [3]);
  const review = await Page({ searchParams: Promise.resolve({ view: "export", exportError: "review" }) });
  assert.deepEqual(review.props.orders.map((row) => row.sheetRowNumber), [6, 7, 11]);
  assert.equal(review.props.riskView, "export");
  assert.equal(review.props.refreshPath, "/orders?view=export");
  assert.equal(review.props.headerAction.type.name, "OrderExportButton", "use the guarded client download control, never a prefetched Next Link");
  assert.match(review.props.headerAction.props.label, /15\/10\/2026 08:00 - 16\/10\/2026 08:00/);
  assert.equal(Object.values(review.props.riskAssessments).filter((risk) => risk.unresolved).length, 2);

  const selected = [rows[2], rows[4]];
  await expectRedirect(() => actions.approveAllOrderRisksAction(form(selected)), "/orders?view=export&risk=approve-all&count=2");
  assert.ok(selected.every((row) => row.riskReview === `approved:${row.fingerprint}`));
  const response = await get(true);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition"), /IMPORT-ELKO-2026-10-16.xlsx/);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const cells = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1, { header: 1 });
  assert.deepEqual(cells.slice(1).map((row) => row[0]), ["Safe Buyer", "Repeated Buyer", "Older Block Buyer"]);
  assert.equal(cells[0].length, 10);
  assert.equal(exportMarkers.length, 1);
  assert.equal(exportMarkers[0][0], 11, "preserve sheet order and mark the last selected row");

  rows[1].grad = "Sarajevo";
  const invalidZip = await get(true);
  assert.equal(invalidZip.status, 422);
  assert.match((await invalidZip.json()).error, /Nedostaje ZIP/);
  assert.equal(exportMarkers.length, 1);
  rows[1].grad = "71000";
  readError = true;
  const failedRead = await get(true);
  assert.equal(failedRead.status, 503);
  assert.match(failedRead.headers.get("Cache-Control"), /no-store/);
  assert.doesNotMatch(await failedRead.text(), /private upstream/);
  readError = false;
  markerError = true;
  const failedMarker = await get(true);
  assert.equal(failedMarker.status, 503);
  assert.match((await failedMarker.json()).error, /upis oznake/);
  assert.equal(exportMarkers.length, 1);
  markerError = false;

  await expectRedirect(() => actions.setOrderRiskDecisionAction(form([rows[2]], "duplicate")), "/orders?view=export&risk=duplicate");
  const afterExclusion = await Page({ searchParams: Promise.resolve({ view: "export" }) });
  assert.deepEqual(afterExclusion.props.orders.map((row) => row.sheetRowNumber), [6, 11]);
  await expectRedirect(() => actions.setOrderRiskDecisionAction(form([], "approve")), "/orders?view=export&error=invalid-risk-decision");
  authenticated = false;
  await expectRedirect(() => actions.approveAllOrderRisksAction(form(selected)), "/login");
  const saved = rows.splice(0);
  assert.equal((await get(true)).status, 404);
  rows.push(...saved);
  console.log("Export flow passed: structured errors, review redirect, exact cycle, multi-date approval, exclusion, download control and XLSX output. No live data accessed.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

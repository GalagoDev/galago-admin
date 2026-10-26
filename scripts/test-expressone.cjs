/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQLite and mocked providers. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "galago-expressone-"));
process.env.STORAGE_DIR = tmp;
process.env.DATABASE_PATH = path.join(tmp, "data", "test.db");
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, ...rest) {
  return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
let enabled = true, moves = 0, listCalls = 0, getCalls = 0, quota = false, failedId = "", skipMove = false;
let orders = [];
const messages = new Map(), delays = [];
const gmail = { users: { messages: {
  list: async input => {
    assert.match(input.q, /^in:anywhere from:cs@expressone\.ba(?: after:\d+)?$/);
    assert.equal(input.includeSpamTrash, true); listCalls++;
    if (quota) { quota = false; throw { response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } } }; }
    // Exercise pagination even for a tiny synthetic inbox.
    const ids = [...messages.keys()];
    return { data: input.pageToken ? { messages: ids.slice(2).map(id => ({ id })) }
      : { messages: ids.slice(0, 2).map(id => ({ id })), nextPageToken: ids.length > 2 ? "page2" : undefined } };
  },
  get: async input => { getCalls++; if (input.id === failedId) throw Error("private-provider-error"); return { data: messages.get(input.id) }; },
} } };
Module._load = function(request, parent, isMain) {
  if (request === "@/lib/claim-gmail") return { claimGmailReader: () => enabled ? gmail : null };
  if (request === "node:timers/promises") return { setTimeout: async ms => { delays.push(ms); } };
  if (request === "@/lib/google-order-status") return {
    readReturnImportOrders: async () => orders.map(o => ({ ...o })),
    moveOrdersToReturns: async refs => {
      let moved = 0;
      for (const ref of refs) {
        const order = orders.find(o => o.sheetRowNumber === ref.sheetRowNumber && o.fingerprint === ref.fingerprint);
        if (order && !order.appStatus && !skipMove) { order.appStatus = "returned:" + "a".repeat(32); order.deliveredChecked = true; moved++; moves++; }
      }
      return { moved, skipped: refs.length - moved };
    },
  };
  return load.call(this, request, parent, isMain);
};
const { getDb } = require("../src/lib/db.ts");
const db = getDb();
const parser = require("../src/lib/expressone-parser.ts");
const worker = require("../src/lib/expressone-returns.ts");
function message(id, tracking = "001-12345678", status = "Povrat pošiljaocu", statusAt = "2026-10-26 06:00:00") {
  const fields = { "Broj pošiljke:": tracking, "Primalac:": "Test Kupac", "Kontakt primaoca:": "061 123 456",
    "Integracijski kod:": "Komoda Tanzi Bijela", "Zadnji status:": status, "Vrijeme statusa:": statusAt };
  const html = `<table><tr><td><table>${Object.entries(fields).map(([k,v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join("")}</table></td></tr></table>`;
  return { id, internalDate: String(Date.parse("2026-10-26T06:00:00Z")), payload: { mimeType: "multipart/mixed", headers: [
    { name: "From", value: 'Express One <cs@expressone.ba>' }, { name: "Subject", value: "Status pošiljke " + tracking }], parts: [
      { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } },
      { mimeType: "image/png", filename: "logo.png", body: { data: "AAAA" } },
    ] } };
}
function order(extra = {}) {
  return { sheetRowNumber: 3, fingerprint: "raw-fingerprint", dateLabel: "20/10/2026", primalac: "Kupac Test", brojTelefona: "38761123456",
    artikal: "Tanzi", appStatus: "", deliveredChecked: false, receivedAt: "2026-10-20T12:00:00Z", ...extra };
}
function due() { db.prepare("UPDATE expressone_scan SET next_run_at = 0, lease_until = 0").run(); }
const scan = () => db.prepare("SELECT * FROM expressone_scan WHERE id = 1").get();
(async () => {
  const event = parser.parseExpressOneMessage(message("one"));
  assert.equal(event.status, "povrat posiljaocu"); assert.equal(event.tracking, "001-12345678");
  const spoof = message("spoof"); spoof.payload.headers[0].value = "cs@expressone.ba <bad@example.test>";
  assert.equal(parser.parseExpressOneMessage(spoof), null);
  assert.ok(parser.matchExpressOneReturn(event, event.statusAt, [order()]).order);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order(), order({ sheetRowNumber: 4 })]).order, undefined);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order({ receivedAt: "2026-10-27T00:00:00Z" })]).order, undefined);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order({ appStatus: "delivered:old" })]).order, undefined);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order({ deliveredChecked: true })]).order, undefined);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order({ brojTelefona: "061999999" })]).order, undefined);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order({ artikal: "Lewa" })]).order, undefined);
  assert.equal(parser.matchExpressOneReturn(event, event.statusAt, [order({ appStatus: "returned:old" })]).alreadyReturned, true);
  assert.equal(parser.normalizeExpressText("Đurić Ćosić"), "djuric cosic");
  for (const [input, expected] of [
    ["2026-10-24T05:00:00Z", "2026-10-25T06:00:00Z"], // DST end: 25 hours
    ["2026-03-28T06:00:00Z", "2026-03-29T05:00:00Z"], // DST start: 23 hours
    ["2026-10-26T05:59:00Z", "2026-10-26T06:00:00Z"],
    ["2026-10-26T06:01:00Z", "2026-10-27T06:00:00Z"],
  ]) assert.equal(new Date(parser.nextExpressOneScan(Date.parse(input))).toISOString(), expected.replace("Z", ".000Z"));

  enabled = false; await worker.runExpressOneScan();
  assert.ok(scan().last_error); assert.equal(scan().last_success_at, null);
  enabled = true; due(); quota = true;
  messages.set("one", message("one")); messages.set("two", message("two", "001-12345679"));
  messages.set("refused", message("refused", "001-12345680", "Odbijeno"));
  orders = [order()];
  await Promise.all([worker.runExpressOneScan(), worker.runExpressOneScan()]);
  assert.equal(moves, 1, "two packages for one order move it only once");
  assert.equal(scan().last_added, 1); assert.equal(scan().last_messages, 3);
  assert.equal(worker.getExpressOneScanStatus().review.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM expressone_shipments WHERE resolution = 'applied'").get().n, 2);
  assert.ok(delays.includes(20_000), "403 quota errors back off");
  const before = listCalls; await worker.runExpressOneScan(); assert.equal(listCalls, before, "only one scheduled run per day");
  due(); await worker.runExpressOneScan(); assert.equal(getCalls, 3, "persisted Gmail IDs are not fetched again"); assert.equal(moves, 1);

  orders = [order({ sheetRowNumber: 5 }), order({ sheetRowNumber: 6 })];
  messages.set("ambiguous", message("ambiguous", "001-12345681"));
  due(); await worker.runExpressOneScan(); assert.equal(moves, 1);
  assert.equal(worker.getExpressOneScanStatus().review.length, 1);
  // A later refusal replaces an older return, even when fetched out of chronological order.
  worker.recordExpressOneEvent({ ...event, tracking: "001-12345681", status: "odbijeno", statusAt: "2026-10-27 06:00:00" });
  worker.recordExpressOneEvent({ ...event, tracking: "001-12345681", statusAt: "2026-10-25 06:00:00" });
  due(); await worker.runExpressOneScan(); assert.equal(moves, 1); assert.equal(worker.getExpressOneScanStatus().review.length, 0);
  orders = [order({ sheetRowNumber: 8 })];
  messages.set("failure", message("failure", "001-12345682")); failedId = "failure";
  const lastSuccess = scan().last_success_at;
  due(); await worker.runExpressOneScan(); assert.ok(scan().last_error); assert.equal(scan().last_success_at, lastSuccess);
  assert.ok(!scan().last_error.includes("private-provider"));
  failedId = ""; skipMove = true; due(); await worker.runExpressOneScan();
  assert.ok(scan().last_error, "unconfirmed Sheets writes must not be marked successful");
  assert.notEqual(db.prepare("SELECT resolution FROM expressone_shipments WHERE tracking = '001-12345682'").get().resolution, "applied");
  skipMove = false; due(); await worker.runExpressOneScan(); assert.equal(scan().last_error, null); assert.equal(moves, 2);
  // Manual restore of an already processed shipment never reapplies the old return.
  orders[0].appStatus = ""; orders[0].deliveredChecked = false; due(); await worker.runExpressOneScan(); assert.equal(moves, 2);
  // Exercise the real Sheets transition separately from the mocked Gmail worker.
  const originalLoad = Module._load;
  const header = ["Primalac", "Broj telefona", "Grad", "Adresa", "Artikal", "Broj paketa", "Otkupnina", "Vrijednost posiljke", "DOP", "Zamjena"];
  const today = new Date();
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Sarajevo" }).format(today);
  if (day === "Sat") today.setDate(today.getDate() + 2);
  if (day === "Sun") today.setDate(today.getDate() + 1);
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sarajevo" }).format(today);
  const source = [header, [label], ["Test Kupac", "38761123456", "71000", "Test bb", "Tanzi", "1", "", "89", "1", "0", "telegram:test", "", "", "", "", false]];
  const returned = [[...header, "Status ID"], [label], ...Array.from({ length: 10 }, () => [])];
  let failSourceWrite = false;
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: [
      { properties: { title: "Orders", sheetId: 1, gridProperties: { columnCount: 16 } } },
      { properties: { title: "Povrati", sheetId: 2, gridProperties: { columnCount: 11 } } },
    ] } }),
    batchUpdate: async () => ({ data: {} }),
    values: {
      get: async ({ range }) => {
        if (range === "'Orders'!A:P") return { data: { values: structuredClone(source) } };
        if (range === "'Orders'!L1") return { data: { values: [["App status"]] } };
        if (range === "'Povrati'!A1:K1") return { data: { values: [returned[0]] } };
        if (range === "'Povrati'!K:K") return { data: { values: returned.map(r => [r[10] || ""]) } };
        if (range === "'Povrati'!A:K") return { data: { values: structuredClone(returned) } };
        throw Error("Unexpected range: " + range);
      },
      update: async ({ range, requestBody }) => {
        const match = /^'Povrati'!A(\d+):K\d+$/.exec(range);
        if (match) requestBody.values.forEach((row, i) => { returned[Number(match[1]) - 1 + i] = row; });
        return { data: {} };
      },
      batchUpdate: async ({ requestBody }) => {
        if (failSourceWrite) { failSourceWrite = false; throw Error("simulated source write failure"); }
        for (const update of requestBody.data) {
          const match = /^'Orders'!([LP])(\d+)$/.exec(update.range);
          assert.ok(match); source[Number(match[2]) - 1][match[1] === "L" ? 11 : 15] = update.values[0][0];
        }
        return { data: {} };
      },
    },
  } };
  Module._load = function(request, parent, isMain) {
    if (request === "server-only") return {};
    if (request === "googleapis") return { google: { auth: { GoogleAuth: class {} }, sheets: () => sheets } };
    if (request === "@/lib/google-auth") return { getGoogleServiceAccountCredentials: () => ({}) };
    if (request === "@/lib/google-sheets") return { invalidateSheetCache: () => {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  process.env.GOOGLE_SHEETS_ID = "test-sheet";
  const transitions = require("../src/lib/google-order-status.ts");
  const { createOrderFingerprint } = require("../src/lib/order-fingerprint.ts");
  const [reference] = await transitions.readReturnImportOrders();
  assert.equal(reference.otkupnina, "89", "display fallback is preserved");
  assert.equal(reference.fingerprint, createOrderFingerprint({ ...reference, otkupnina: "" }), "raw source fingerprint is used for transitions");
  source[2][15] = true;
  assert.equal((await transitions.moveOrdersToReturns([reference])).moved, 0, "checkbox is revalidated before auto-return");
  source[2][15] = false; source[2][1] = "changed";
  assert.equal((await transitions.moveOrdersToReturns([reference])).moved, 0, "changed rows are not touched");
  source[2][1] = "38761123456"; failSourceWrite = true;
  await assert.rejects(transitions.moveOrdersToReturns([reference]), /simulated/);
  assert.equal(returned.filter(r => r[10] && r[10] !== "Status ID").length, 1, "destination append happened before failure");
  assert.equal((await transitions.moveOrdersToReturns([reference, reference])).moved, 1);
  assert.equal(returned.filter(r => r[10] && r[10] !== "Status ID").length, 1, "retry does not append a second return");
  assert.match(source[2][11], /^returned:[a-f0-9]{32}$/); assert.equal(source[2][15], true);
  assert.equal(source.length, 3, "source rows remain intact");
  assert.equal((await transitions.moveOrdersToReturns([reference])).moved, 0);
  db.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Express One: parser, matching, DST, daily lease, deduplication, quota retry, review and recovery tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });

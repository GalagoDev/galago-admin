/* eslint-disable @typescript-eslint/no-require-imports -- Isolated server tests with an in-memory Sheets adapter. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);

const requests = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/google-auth") return { getGoogleServiceAccountCredentials: () => ({}) };
  if (request === "googleapis") return { google: {
    auth: { GoogleAuth: class {} },
    sheets: () => ({ spreadsheets: { values: {
      get: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    } } }),
  } };
  return originalLoad.call(this, request, parent, isMain);
};

process.env.GOOGLE_SHEETS_ID = "local-cache-test";
const { getOrdersSheetRows, invalidateSheetCache } = require("../src/lib/google-sheets.ts");
function resolve(index, name) {
  requests[index].resolve({ data: { values: [
    ["Primalac", "Broj telefona", "Grad", "Adresa", "Artikal", "Broj paketa", "Otkupnina", "Vrijednost posiljke", "DOP", "Zamjena"],
    ["16/10/2026"],
    [name, "061111111", "71000", "Test bb", "Item", "1", "95", "95", "1", "0"],
  ] } });
}

(async () => {
  const first = getOrdersSheetRows({ fresh: true });
  const repeated = getOrdersSheetRows({ fresh: true });
  const ordinary = getOrdersSheetRows();
  assert.equal(requests.length, 1, "concurrent refreshes must share one Sheets request");
  resolve(0, "First");
  assert.deepEqual(await first, await repeated);
  await ordinary;
  assert.equal((await getOrdersSheetRows())[0].primalac, "First");
  assert.equal(requests.length, 1);

  const fresh = getOrdersSheetRows({ fresh: true });
  assert.equal(requests.length, 2, "a later refresh must not reuse saved data");
  invalidateSheetCache("Orders");
  const afterWrite = getOrdersSheetRows({ fresh: true });
  assert.equal(requests.length, 3, "a mutation must discard an older in-flight snapshot");
  resolve(2, "Updated");
  await afterWrite;
  resolve(1, "Stale");
  await fresh;
  assert.equal((await getOrdersSheetRows())[0].primalac, "Updated", "late stale read must not overwrite post-mutation data");

  const failure = getOrdersSheetRows({ fresh: true });
  requests[3].reject(new Error("test failure"));
  await assert.rejects(failure, /test failure/);
  const retry = getOrdersSheetRows({ fresh: true });
  assert.equal(requests.length, 5, "failed requests must release their in-flight slot");
  resolve(4, "Recovered");
  assert.equal((await retry)[0].primalac, "Recovered");
  console.log("Sheets cache tests passed: concurrent refresh, freshness, mutation race, failure recovery. No live data accessed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

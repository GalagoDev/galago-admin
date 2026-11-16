/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQLite and server-action tests. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const { randomUUID } = require("node:crypto");
const Database = require("better-sqlite3");
const database = new Database(":memory:");
const os = require("node:os");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "galago-import-invoice-test-"));
process.env.STORAGE_DIR = temp;
database.pragma("foreign_keys=ON");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest); };
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
let authenticated = true;
Module._load = function(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/db") return { getDb: () => database };
  if (request === "@/lib/auth") return { isAuthenticated: async () => authenticated };
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "node:child_process") {
    const native=load.call(this,request,parent,isMain);
    return {...native,execFile:(...args)=>native.execFile(...args)};
  }
  return load.call(this, request, parent, isMain);
};
const lib = require("../src/lib/import-payments.ts");
const { parseImportMoney, importInvoiceProgress } = require("../src/lib/import-payments-types.ts");
const { parseImportInvoiceLines } = require("../src/lib/import-invoice-parser.ts");
const { updateImportsAction } = require("../src/app/actions/imports.ts");
const payment = (id, extra = {}) => ({ id, date: "2026-11-03", partner: "", reference: "Bank reference", amountMinor: 600000, currency: "USD", kind: "payment", supplier: null, statement: "2026/19", account: "USD account", fileId: null, ...extra });
const input = { companyId: "company-a", companyName: "Synthetic company", sourceFrom: "2026-06-01", sourceThrough: "2026-11-14", payments: [payment("one"), payment("two", { supplier: "TADEX" }), payment("fee", { amountMinor: 2626, currency: "BAM", kind: "fee", supplier: "SHENGFENG" })] };
async function main() {
  const parsed = parseImportInvoiceLines(["SHENGFENG E-TEN INTERNATIONAL TRADE CO.,LTD", "INVOICE NO: 20261014", "Unit Price USD", "Goods Total $14,530.99", "COMMISSION 5% $726.55", "This price is an estimate", "TOTAL $20,793.53"]);
  assert.equal(parsed.totalMinor, 2079353); assert.equal(parsed.currency, "USD"); assert.equal(parsed.supplier, "SHENGFENG"); assert.equal(parsed.number, "20261014"); assert.match(parsed.warning, /procijenjeni/);
  assert.equal(parseImportInvoiceLines(["GRAND TOTAL EUR 20.793,53"]).totalMinor, 2079353);
  assert.equal(parseImportInvoiceLines(["TOTAL $123.45"]).currency, null, "dollar without USD cannot guess currency");
  assert.equal(parseImportInvoiceLines(["TOTAL USD 100.00", "TOTAL USD 200.00"]).totalMinor, null, "conflicting final totals require manual review");
  assert.equal(parseImportInvoiceLines(["Goods Total USD 999.00", "SUBTOTAL USD 999.00"]).totalMinor, null);
  assert.equal(parseImportInvoiceLines(["TOTAL USD 100.00", "TOTAL USD 100.00"]).totalMinor,10000);
  for (const [text, expected] of [["1.250,50",125050],["1250.50",125050],["0,01",1],["6.000",600000],["6000",600000]]) assert.equal(parseImportMoney(text), expected);
  for (const bad of ["0","-2","1.2345","1e5","abc","12,3,4"]) assert.throws(() => parseImportMoney(bad));
  assert.throws(() => lib.applyImportSnapshot(input, "other"), /firma/);
  lib.applyImportSnapshot(input, "company-a");
  lib.applyImportSnapshot(input, "company-a");
  assert.equal(lib.getImportsOverview().payments.length, 3, "repeat sync is idempotent");
  lib.saveImportContainer({ name: "MSMU4017564", notes: "Test", status: "planned" });
  lib.saveImportContainer({ name: "SECOND", notes: "", status: "in_transit" });
  assert.throws(() => lib.saveImportContainer({ name: "msmu4017564", notes: "", status: "planned" }), /već postoji/);
  const containers = lib.getImportsOverview().containers;
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const page = pdf.addPage();
  ["SHENGFENG E-TEN", "INVOICE NO: TEST-06", "Goods Total USD 5000.00", "TOTAL USD 6000.00"].forEach((text,index)=>page.drawText(text,{x:40,y:700-index*30,font,size:12}));
  const { uploadImportInvoice, importInvoicePath } = require("../src/lib/import-invoice-upload.ts");
  const draft = await uploadImportInvoice(containers[0].id, new File([await pdf.save()], "test-invoice.pdf", { type: "application/pdf" }));
  assert.equal(draft.totalMinor, 600000); assert.equal(draft.currency, "USD");
  const bankLines=["Konto 53201300","Valuta 840 USD Broj izvoda: 19",
    "03.11.2026 03.11.2026 INVOICE NO.: 202603-GLG 263791625 6,000.00 0.00 10,462.72 0.00",
    "Partial payment-HK TADEX TRADE CO., LIMITED",
    "03.11.2026 03.11.2026 INVOICE NO:20261030 263791801 6,000.00 0.00 10,462.72 0.00",
    "Partial payment-SHENGFENG E-TEN INTERNATIONAL TRADE CO.,LTD",
    "PROMET NA DAN: 03.11.2026 12,000.00 0.00 20,925.43 0.00",
    "Konto 53201200","Valuta 978 EUR Broj izvoda: 9",
    "03.11.2026 03.11.2026 Payment GARMA d. o. o. 263870869 393.00 0.00 768.64 0.00"];
  const {parseImportBankLines}=require("../src/lib/import-bank-parser.ts");
  assert.deepEqual(parseImportBankLines(bankLines).map(row=>row.supplier),["TADEX","SHENGFENG","GARMA"]);
  assert.equal(parseImportBankLines(bankLines.slice(-3).map(line=>line.replace("GARMA d. o. o.","PETRA DIZAJN DOOEL")))[0].supplier,"OTHER");
  const bankPdf=await PDFDocument.create();const bankFont=await bankPdf.embedFont(StandardFonts.Helvetica);const bankPage=bankPdf.addPage();
  bankLines.forEach((text,index)=>bankPage.drawText(text,{x:10,y:780-index*30,font:bankFont,size:7}));
  const bankBytes=Buffer.from(await bankPdf.save()),bankHash=require("node:crypto").createHash("sha256").update(bankBytes).digest("hex");
  const source={...input,payments:[payment("tadex",{reference:"263791625",fileId:"bank-test",account:"Intesa 53201300"}),payment("shengfeng",{reference:"263791801",fileId:"bank-test",account:"Intesa 53201300"}),payment("garma",{reference:"263870869",fileId:"bank-test",account:"Intesa 53201200",currency:"EUR",amountMinor:39300})],documents:[{id:"bank-test",sha256:bankHash,content:bankBytes.toString("base64")}]};
  const {enrichImportBankPayments}=require("../src/lib/import-bank-statements.ts");
  const enriched=await enrichImportBankPayments(source);
  assert.deepEqual(enriched.payments.map(p=>[p.supplier,!!p.excluded]),[["TADEX",false],["SHENGFENG",false],[null,true]]);
  assert.match(enriched.payments[0].reference,/202603-GLG/);
  const cached=await enrichImportBankPayments({...source,documents:[{...source.documents[0],content:null}]});
  assert.deepEqual(cached,enriched,"cached PDF rows preserve exact-reference mappings without re-reading PDF");
  const mismatch=await enrichImportBankPayments({...source,payments:[{...source.payments[0],amountMinor:1}]});
  assert.equal(mismatch.payments[0].supplier,null,"amount mismatch is never auto-assigned");
  lib.applyImportSnapshot({...input,payments:[...input.payments,{...enriched.payments[2]}]},"company-a");
  assert.equal(lib.getImportsOverview().payments.some(p=>p.id==="garma"),false,"Garma is not tracked or displayed");
  database.prepare("DELETE FROM import_payments WHERE id='garma'").run();
  assert.equal(fs.statSync(importInvoicePath(draft.fileId)).mode & 0o777, 0o600);
  assert.equal(lib.getImportsOverview().invoices.length,0,"upload alone never changes target");
  const invoiceCommand = { containerId: containers[0].id, fileId: draft.fileId, number: draft.number, amount: "6000", currency: "USD", supplier: "SHENGFENG" };
  assert.throws(()=>lib.saveImportInvoice({...invoiceCommand,containerId:containers[1].id}),/pripada/);
  lib.saveImportInvoice(invoiceCommand); lib.saveImportInvoice(invoiceCommand);
  assert.equal(lib.getImportsOverview().invoices.length,1);
  const invoice = lib.getImportsOverview().invoices[0];
  const command = { paymentId: "one", containerId: containers[0].id, amount: "2500", requestId: randomUUID() };
  assert.throws(() => lib.allocateImportPayment(command), /dobavljača/);
  lib.classifyImportPayment("one", "SHENGFENG");
  lib.allocateImportPayment(command); lib.allocateImportPayment(command);
  assert.equal(lib.getImportsOverview().allocations.length, 1, "retry does not duplicate payment allocation");
  assert.equal(importInvoiceProgress(invoice,lib.getImportsOverview()).paidMinor,250000);
  const overview=lib.getImportsOverview();
  for(const change of [{currency:"EUR"},{supplier:"TADEX"},{kind:"fee"},{available:false},{ignored:true}]) {
    const mismatched={...overview,payments:overview.payments.map(p=>p.id==="one"?{...p,...change}:p)};
    assert.equal(importInvoiceProgress(invoice,mismatched).paidMinor,0,"wrong supplier/currency/fees/unavailable excluded");
  }
  assert.equal(importInvoiceProgress({...invoice,totalMinor:100000},overview).overpaidMinor,150000);
  assert.throws(() => lib.allocateImportPayment({ ...command, amount: "2600" }), /iskorišten/);
  lib.allocateImportPayment({ ...command, containerId: containers[1].id, amount: "3500", requestId: randomUUID() });
  assert.equal(lib.getImportsOverview().payments.find(p => p.id === "one").allocatedMinor, 600000);
  assert.throws(() => lib.allocateImportPayment({ ...command, amount: "0,01", requestId: randomUUID() }), /veći/);
  assert.throws(() => lib.classifyImportPayment("one", "OTHER"), /raspored/);
  assert.throws(() => lib.removeImportContainer(containers[0].id), /raspored/);
  assert.throws(() => lib.classifyImportPayment("two", "SHENGFENG"), /izvornom/);
  lib.applyImportSnapshot(input, "company-a");
  assert.equal(lib.getImportsOverview().allocations.length, 2, "sync preserves allocations");
  const changed = { ...input, payments: input.payments.map(p => p.id === "one" ? { ...p, currency: "EUR" } : p) };
  lib.applyImportSnapshot(changed, "company-a");
  assert.equal(lib.getImportsOverview().payments.find(p => p.id === "one").available, false, "changed allocated currency cannot silently affect totals");
  assert.equal(importInvoiceProgress(invoice,lib.getImportsOverview()).paidMinor,0);
  for (const a of lib.getImportsOverview().allocations) lib.removeImportAllocation(a.id);
  lib.applyImportSnapshot(changed, "company-a");
  assert.equal(lib.getImportsOverview().payments.find(p => p.id === "one").currency, "EUR");
  lib.classifyImportPayment("one", "OTHER");
  assert.equal(lib.getImportsOverview().payments.find(p => p.id === "one").ignored, true);
  lib.applyImportSnapshot({ ...input, payments: input.payments.slice(1) }, "company-a");
  assert.equal(lib.getImportsOverview().payments.find(p => p.id === "one").available, false, "missing source records remain in the audit");
  assert.throws(() => lib.applyImportSnapshot({ ...input, payments: [input.payments[0],input.payments[0]] }, "company-a"), /ponovljene/);
  assert.equal(lib.getImportsOverview().payments.length, 3);
  lib.removeImportInvoice(containers[0].id);
  assert.equal(lib.getImportsOverview().invoices.length,0);
  assert.ok(lib.getImportInvoiceFile(draft.fileId),"original document retained for audit");
  lib.saveImportInvoice(invoiceCommand);
  lib.removeImportContainer(containers[0].id);
  assert.equal(lib.getImportsOverview().invoices.length,0);
  assert.equal(lib.claimImportSync(), true); assert.equal(lib.claimImportSync(true), false);
  lib.failImportSync();
  assert.ok(lib.getImportsOverview().error);
  database.prepare("UPDATE import_sync SET last_attempt_at=?").run(Date.now()-16*60_000);
  assert.equal(lib.claimImportSync(),true,"failed source gets a bounded retry instead of waiting six hours");
  authenticated = false;
  const result = await updateImportsAction({ action: "saveContainer", name: "Unauthorized", notes: "", status: "planned" });
  assert.equal(result.ok, false);
  assert.equal(lib.getImportsOverview().containers.length, 1);
  authenticated = true;
  assert.equal((await updateImportsAction({ action: "classify", id: "two", supplier: "BAD" })).ok, false);
  assert.ok(database.prepare("SELECT COUNT(*) AS n FROM import_audit").get().n > 0);
  const route = require("../src/app/api/imports/invoice/route.ts");
  authenticated=false;
  assert.equal((await route.POST(new Request("https://test.local/api/imports/invoice",{method:"POST"}))).status,401);
  const download = require("../src/app/api/imports/invoice/[id]/route.ts");
  assert.equal((await download.GET(new Request("https://test.local"),{params:Promise.resolve({id:draft.fileId})})).status,401);
  authenticated=true;
  assert.equal((await route.POST(new Request("https://test.local/api/imports/invoice",{method:"POST",headers:{origin:"https://other.local"}}))).status,403);
  assert.equal((await download.GET(new Request("https://test.local"),{params:Promise.resolve({id:"../../etc/passwd"})})).status,404);
  const original=await download.GET(new Request("https://test.local"),{params:Promise.resolve({id:draft.fileId})});
  assert.equal(original.status,200); assert.equal(original.headers.get("cache-control"),"private, no-store");
  await assert.rejects(()=>uploadImportInvoice(containers[1].id,new File(["not a PDF"],"bad.pdf")),/ispravan PDF/);
  console.log("Imports passed: auth, exact minor units, source scope, duplicate sync, supplier confirmation, split allocations, over-allocation, replay, changed/missing sources, preservation and audit.");
  database.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));

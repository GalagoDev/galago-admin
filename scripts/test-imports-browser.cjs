/* eslint-disable @typescript-eslint/no-require-imports -- Local-only browser regression with isolated synthetic data. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), Module = require("node:module"), ts = require("typescript");
const { spawn } = require("node:child_process"), { once } = require("node:events"), net = require("node:net");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "galago-imports-test-"));
process.env.STORAGE_DIR = temp;
process.env.APP_PASSWORD = "synthetic-imports-browser-only";
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, ...rest) { return resolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest); };
Module._extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
Module._load = function(request, parent, isMain) { if (request === "server-only") return {}; return load.call(this, request, parent, isMain); };
const lib = require("../src/lib/import-payments.ts");
lib.applyImportSnapshot({ companyId: "synthetic", companyName: "Test", sourceFrom: "2026-06-10", sourceThrough: "2026-11-14", payments: [
  { id: "unknown", date: "2026-11-03", partner: "", reference: "TEST-UNKNOWN-001", amountMinor: 600000, currency: "USD", kind: "payment", supplier: null, statement: "2026/19", account: "Test USD account", fileId: null },
  { id: "known", date: "2026-11-04", partner: "HK TADEX TRADE CO., LIMITED", reference: "TEST-KNOWN-002", amountMinor: 500000, currency: "USD", kind: "payment", supplier: "TADEX", statement: "2026/20", account: "Test USD account", fileId: null },
  { id: "fee", date: "2026-11-02", partner: "", reference: "PROVIZIJA ZA INO DOZNAKU, SHENGFENG E-TEN INTERNATIONAL", amountMinor: 2626, currency: "BAM", kind: "fee", supplier: "SHENGFENG", statement: "2026/75", account: "Test BAM account", fileId: null },
] }, "synthetic");
let server, browser, page;
async function main() {
  const listener = net.createServer(); listener.listen(0,"127.0.0.1"); await once(listener,"listening"); const port=listener.address().port; await new Promise(r=>listener.close(r));
  const base=`http://127.0.0.1:${port}`;
  const env = { ...process.env, NALTO_APP_PATH: "", NALTO_COMPANY_ID: "", NEXT_TELEMETRY_DISABLED: "1" };
  for (const name of ["COURIER_TRACKING_SCHEDULER_ENABLED","EXPRESSONE_RETURNS_SCHEDULER_ENABLED","CLAIMS_MESSAGING_SCHEDULER_ENABLED","GOOGLE_ADS_SYNC_ENABLED","ANANAS_INTERNAL_SCHEDULER_ENABLED","META_ADS_SYNC_ENABLED","IMPORT_PAYMENTS_SYNC_ENABLED"]) env[name]="false";
  server=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let logs="";server.stdout.on("data",b=>logs+=b);server.stderr.on("data",b=>logs+=b);
  for(let n=0;n<120;n++){try{if((await fetch(base+"/login")).ok)break;}catch{} await new Promise(r=>setTimeout(r,500));if(n===119)throw Error(logs);}
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:true});
  const context=await browser.newContext();
  const { createSession }=require("../src/lib/session.ts");
  await context.addCookies([{name:"store-admin-session",value:createSession(),url:base}]);
  page=await context.newPage(); const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:1000}); await page.goto(base+"/imports");
  await page.getByRole("heading",{name:"Uvozi",exact:true}).waitFor();
  const nav=page.getByRole("navigation",{name:"Glavna navigacija"});
  assert.equal(await nav.getByRole("link").count(),5);
  for(const name of ["Pregled","Računi","Lager","Statistika","Reklame"])assert.equal(await nav.getByRole("link",{name,exact:true}).count(),0);
  await page.getByRole("button",{name:"Novi kontejner"}).click();
  await page.getByLabel("Kontejner / oznaka uvoza").fill("MSMU4017564");
  await page.getByLabel("Napomena / faktura").fill("Test container");
  await page.getByRole("button",{name:"Sačuvaj",exact:true}).click();
  await page.locator("summary").filter({hasText:"MSMU4017564"}).waitFor();
  let row=page.locator("article").filter({hasText:"TEST-UNKNOWN-001"});
  await row.getByLabel("Dobavljač uplate").selectOption("SHENGFENG");
  await row.getByRole("button",{name:"Potvrdi dobavljača"}).click();
  await row.getByRole("button",{name:"Rasporedi",exact:true}).waitFor();
  await row.getByRole("button",{name:"Rasporedi",exact:true}).click();
  await row.getByLabel("Kontejner",{exact:true}).selectOption({label:"MSMU4017564"});
  await row.getByLabel("Iznos (USD)").fill("2500,50");
  await row.getByRole("button",{name:"Sačuvaj raspored"}).click();
  await row.getByText("Preostalo 3.499,50 USD").waitFor();
  await page.reload();
  row=page.locator("article").filter({hasText:"TEST-UNKNOWN-001"});
  await row.getByText("Preostalo 3.499,50 USD").waitFor();
  await row.getByRole("button",{name:"Rasporedi",exact:true}).click();
  await row.getByLabel("Kontejner",{exact:true}).selectOption({label:"MSMU4017564"});
  await row.getByLabel("Iznos (USD)").fill("5000");
  await row.getByRole("button",{name:"Sačuvaj raspored"}).click();
  await page.getByRole("alert").filter({hasText:"veći od"}).waitFor();
  await row.getByRole("button",{name:"Rasporedi",exact:true}).click();
  await page.getByRole("button",{name:"Zatvori obavijest"}).click();
  await page.locator("summary").filter({hasText:"MSMU4017564"}).click();
  await page.getByRole("button",{name:"Dodaj PDF fakturu"}).click();
  const {PDFDocument,StandardFonts}=require("pdf-lib");const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);const pdfPage=pdf.addPage();
  ["SHENGFENG E-TEN","INVOICE NO: TEST-06","Goods Total USD 5000.00","TOTAL USD 6000.00"].forEach((text,index)=>pdfPage.drawText(text,{x:40,y:700-index*30,font,size:12}));
  await page.getByLabel("PDF faktura",{exact:true}).setInputFiles({name:"test-invoice.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});
  await page.getByRole("button",{name:"Potvrdi fakturu"}).waitFor();
  assert.equal(await page.getByLabel("Ukupan iznos fakture").inputValue(),"6000.00");
  assert.equal(await page.getByLabel("Valuta fakture").inputValue(),"USD");
  await page.getByRole("button",{name:"Potvrdi fakturu"}).click();
  await page.getByRole("progressbar",{name:"Plaćenost fakture"}).waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"),"41.7");
  const pdfLink=await page.getByRole("link",{name:"Otvori PDF",exact:true}).getAttribute("href");
  assert.equal((await context.request.get(base+pdfLink)).headers()["content-type"],"application/pdf");
  fs.mkdirSync(path.join(root,"../outputs"),{recursive:true});
  for(const width of [1440,1024,768,390,320]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow at ${width}`);
    await page.screenshot({path:path.join(root,`../outputs/imports-${width}.png`),fullPage:true});
    if(width<1024){await page.getByRole("button",{name:"Otvori meni"}).click();assert.equal(await page.getByRole("navigation",{name:"Glavna navigacija"}).getByRole("link",{name:"Uvozi",exact:true}).count(),1);await page.getByRole("button",{name:"Zatvori meni",exact:true}).last().click();}
  }
  await page.setViewportSize({width:1440,height:1000});
  await row.getByRole("button",{name:"Ukloni raspored"}).click();
  await row.getByText("Neraspoređeno",{exact:true}).waitFor();
  assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"),"0");
  await page.getByRole("tab",{name:/Provizije/}).click();
  await page.locator("article").getByText("26,26 KM",{exact:true}).waitFor();
  assert.equal(await page.locator("article").count(),1);
  for(const route of ["/","/stats","/stats/today","/inventory","/receipts","/reklame"]){const response=await context.request.get(base+route,{maxRedirects:0});assert.equal(response.status(),307,`${route} redirects`);assert.equal(response.headers().location,"/orders");}
  assert.deepEqual(errors,[]);
  console.log("Browser passed: navigation, supplier confirmation, container creation, allocation, persistence, over-allocation error, undo, fees, redirects and 1440/1024/768/390/320 layouts.");
}
main().catch(async e=>{console.error(e);if(page){await page.screenshot({path:path.join(root,"../outputs/imports-error.png"),fullPage:true});console.error((await page.locator("article").first().innerText()).slice(0,1500));}process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server){server.kill("SIGTERM");await once(server,"exit");}require("../src/lib/db.ts").getDb().close();fs.rmSync(temp,{recursive:true,force:true});});

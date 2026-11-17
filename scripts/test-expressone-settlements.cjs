/* eslint-disable @typescript-eslint/no-require-imports -- Isolated provider and SQLite regression tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), XLSX = require('xlsx');
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'galago-settlements-'));
process.env.STORAGE_DIR = tmp; process.env.DATABASE_PATH = path.join(tmp, 'test.db');
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(r,p,...rest) { return resolve.call(this,r.startsWith('@/') ? path.join(root,'src',r.slice(2)) : r,p,...rest); };
Module._extensions['.ts'] = (m,f) => m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,f);
let orders = [], moves = 0, getCalls = 0, listCalls = 0, failAttachment = '', skipWrite = false, connected = true;
const messages = new Map(), attachments = new Map(), delays = [];
const gmail = {users:{messages:{
  list: async input => { listCalls++; assert.match(input.q,/from:expressone\.ba subject:GALAGO/);
    const ids = [...messages.keys()];return {data:{messages:(input.pageToken ? ids.slice(1) : ids.slice(0,1)).map(id=>({id})),nextPageToken:!input.pageToken && ids.length>1 ? 'next' : undefined}}; },
  get: async ({id}) => {getCalls++;return {data:messages.get(id)};},
  attachments:{get:async({id})=>{if(id===failAttachment)throw Error('private error');return {data:{data:attachments.get(id)}};}},
}}};
Module._load = function(r,p,m) {
  if(r==='server-only')return {};
  if(r==='node:timers/promises')return {setTimeout:async ms=>{delays.push(ms);}};
  if(r==='./claim-gmail')return {claimGmailReader:()=>connected ? gmail : null};
  if(r==='./google-order-status')return {
    readReturnImportOrders:async()=>structuredClone(orders),
    markCourierOrdersDelivered:async refs=>{let moved=0;for(const ref of refs){const o=orders.find(x=>x.sheetRowNumber===ref.sheetRowNumber);
      if(o && !o.appStatus && !skipWrite){o.appStatus='delivered:'+String(o.sheetRowNumber).padStart(32,'0');o.deliveredChecked=true;moved++;moves++;}}
      return {moved,skipped:refs.length-moved};},
  };
  return load.call(this,r,p,m);
};
const db = require('../src/lib/db.ts').getDb();
const parser = require('../src/lib/expressone-settlement-parser.ts');
const worker = require('../src/lib/expressone-settlements.ts');
const header = ['datum_slanja','broj_posiljke','primaoc','primaoc_mjesto','posiljaoc','postanski','mjesto','iznos_otk','Ref1'];
const order = extra=>({sheetRowNumber:3,primalac:'Test Kupac',brojTelefona:'38761123456',dateLabel:'12/11/2026',grad:'71000',adresa:'Test bb',artikal:'Lewa crna',otkupnina:'89',vrijednostPosiljke:'89',brojPaketa:'1',dop:'1',zamjena:'0',sourceId:'test:1',receivedAt:'2026-11-12T08:00:00Z',fingerprint:'raw',appStatus:'',deliveredChecked:false,...extra});
const reportRow = extra=>({row:2,recipient:'Kupac Test',city:'Sarajevo',product:'Lewa',amount:89,shippedOn:'2026-11-13',...extra});
const sheetRow = (recipient='Kupac Test',date='11.13.2026',amount=89)=>[date,193561,recipient,'SARAJEVO','GALAGO D.O.O.',75000,'TUZLA',amount,'LEWA CRNA'];
function workbook(rows){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([header,...rows]),'Report');return XLSX.write(w,{type:'buffer',bookType:'xlsx'});}
function message(id,files=['a']){return {id,internalDate:String(Date.parse('2026-11-17T08:00:00Z')),payload:{headers:[{name:'From',value:'<danira.borovina@expressone.ba>'},{name:'Subject',value:'GALAGO D.O.O. tabela razduzenog novca 17.11.2026 broj 50'}],parts:files.map(a=>({filename:`1000089-GALAGO-${a}.xlsx`,body:{attachmentId:a,size:12000}}))}};}
const due=()=>db.prepare('UPDATE expressone_settlement_scan SET next_run_at=0,lease_until=0').run();
(async()=>{
  assert.equal(parser.settlementAttachments(message('x')).length,1);
  const spoof=message('x');spoof.payload.headers[0].value='danira.borovina@expressone.ba <bad@example.test>';
  assert.equal(parser.settlementAttachments(spoof).length,0);
  const other=message('x');other.payload.headers[1].value='OTHER D.O.O. tabela razduzenog novca';assert.equal(parser.settlementAttachments(other).length,0);
  const serial=(year,month,day)=>(Date.UTC(year,month-1,day)-Date.UTC(1899,11,30))/86400_000;
  const rows=await parser.parseSettlementWorkbook(new File([workbook([sheetRow(),sheetRow('Kupac Dva',serial(2026,12,11))])],'GALAGO.xlsx'),Date.parse('2026-11-17'));
  assert.equal(rows[0].shippedOn,'2026-11-13');assert.deepEqual(rows[1].shipmentDates,['2026-11-12'],'future auto-converted month is not mistaken for the shipping month');
  const ambiguousDate=await parser.parseSettlementWorkbook(new File([workbook([sheetRow('Kupac Test',serial(2026,9,11))])],'GALAGO.xlsx'),Date.parse('2026-11-17'));
  assert.deepEqual(ambiguousDate[0].shipmentDates,['2026-09-11','2026-11-09']);
  assert.ok(parser.matchSettlement(reportRow(),[order()]).order);
  assert.ok(parser.matchSettlement(reportRow({shippedOn:'2026-11-08'}),[order({dateLabel:'09/11/2026',receivedAt:'2026-11-07T10:00:00Z'})]).order,'weekend order belongs to Monday shipping cycle');
  assert.ok(parser.matchSettlement(reportRow(),[order({brojPaketa:'2'})]).order,'full COD remittance covers the financial balance, independent of package count');
  assert.equal(parser.matchSettlement(reportRow({amount:44.5}),[order({brojPaketa:'2'})]).order,undefined,'partial remittance cannot close a whole order');
  for(const extra of [{dateLabel:'18/11/2026'},{otkupnina:'95'},{artikal:'Tanzi'},{appStatus:'returned:x'},{receivedAt:'2026-11-15T09:00:00Z'}]) assert.equal(parser.matchSettlement(reportRow(),[order(extra)]).order,undefined);
  assert.equal(parser.matchSettlement(reportRow({amount:0}),[order({otkupnina:'0'})]).order,undefined);
  assert.equal(parser.matchSettlement(reportRow(),[order(),order({sheetRowNumber:4,appStatus:'delivered:old'})]).order,undefined,'closed matching orders remain ambiguity candidates');
  assert.equal(parser.matchSettlement(reportRow(),[order({appStatus:'delivered:old'})]).alreadyDelivered,true);
  assert.equal(parser.matchSettlement(ambiguousDate[0],[order({dateLabel:'09/11/2026',receivedAt:''}),order({dateLabel:'11/09/2026',receivedAt:'',sheetRowNumber:4})]).order,undefined);
  for(const [input,expected] of [['2026-10-24T13:00:00Z','2026-10-25T14:00:00.000Z'],['2026-03-28T14:00:00Z','2026-03-29T13:00:00.000Z']])assert.equal(new Date(parser.nextSettlementScan(Date.parse(input))).toISOString(),expected);
  const wrong=sheetRow();wrong[4]='OTHER';await assert.rejects(parser.parseSettlementWorkbook(new File([workbook([wrong])],'GALAGO.xlsx'),Date.parse('2026-11-17')),/settlement-format/);
  connected=false;await worker.runSettlementScan();assert.ok(worker.getSettlementScanStatus().scan.last_error);
  connected=true;due();orders=[order()];attachments.set('a',workbook([sheetRow()]).toString('base64url'));messages.set('one',message('one'));
  await Promise.all([worker.runSettlementScan(),worker.runSettlementScan()]);assert.equal(moves,1);assert.equal(worker.getSettlementScanStatus().scan.last_added,1);
  const calls=listCalls;await worker.runSettlementScan();assert.equal(calls,listCalls,'once daily');due();await worker.runSettlementScan();assert.equal(getCalls,1,'persisted mailbox checkpoint');assert.equal(moves,1);
  orders[0].appStatus='';orders[0].deliveredChecked=false;due();await worker.runSettlementScan();assert.equal(moves,1,'applied report never closes a restored order again');
  messages.set('copy',message('copy'));due();await worker.runSettlementScan();assert.equal(moves,1,'duplicate file hash is idempotent');
  orders.push(order({primalac:'Kupac Drugi',sheetRowNumber:4,sourceId:'test:2'}));
  attachments.set('b',workbook([sheetRow('Drugi Kupac')]).toString('base64url'));messages.set('multi',message('multi',['a','b']));
  failAttachment='b';due();await worker.runSettlementScan();assert.ok(worker.getSettlementScanStatus().scan.last_error);
  assert.equal(db.prepare("SELECT 1 FROM expressone_settlement_messages WHERE gmail_id='multi'").get(),undefined,'partial mail is not checkpointed');
  failAttachment='';skipWrite=true;due();await worker.runSettlementScan();assert.match(worker.getSettlementScanStatus().scan.last_error,/Upis/);
  assert.equal(db.prepare("SELECT count(*) n FROM expressone_settlement_rows WHERE resolution='applied'").get().n,1,'unconfirmed write is retried');
  skipWrite=false;due();await worker.runSettlementScan();assert.equal(moves,2);assert.equal(worker.getSettlementScanStatus().scan.last_error,null);
  assert.equal(db.prepare('SELECT count(*) n FROM expressone_settlement_reports').get().n,2);
  db.close();fs.rmSync(tmp,{recursive:true,force:true});console.log('Settlement tests passed: sender, workbooks, locale dates, strict matching, repeat buyers, full/partial amounts, leases, retries, deduplication, and verified Sheets writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});

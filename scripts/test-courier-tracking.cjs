/* eslint-disable @typescript-eslint/no-require-imports -- Real isolated SQLite with mocked vendor and Sheets. */
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),Module=require("node:module"),ts=require("typescript");
const root=path.resolve(__dirname,"..");
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"galago-courier-"));
process.env.STORAGE_DIR=tmp;process.env.DATABASE_PATH=path.join(tmp,"data/test.db");
const resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith("@/")?path.join(root,"src",request.slice(2)):request,parent,...rest);};
Module._extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
let source=[],delivered=0,returned=0,archiveFails=false;
Module._load=function(request,parent,isMain){
 if(request==="node:timers/promises")return{setTimeout:async()=>{}};
 if(request==="@/lib/google-order-status")return{
  readReturnImportOrders:async()=>source.map(o=>({...o})),
  markCourierOrdersDelivered:async refs=>{for(const ref of refs){if(!archiveFails){source.find(o=>o.sheetRowNumber===ref.sheetRowNumber).appStatus="delivered:verified";delivered++;}}return{moved:refs.length,skipped:0};},
  moveOrdersToReturns:async refs=>{for(const ref of refs){source.find(o=>o.sheetRowNumber===ref.sheetRowNumber).appStatus="returned:verified";returned++;}return{moved:refs.length,skipped:0};},
 };
 return load.call(this,request,parent,isMain);
};
const {getDb}=require("../src/lib/db.ts"),db=getDb();
const status=require("../src/lib/courier-status.ts"),store=require("../src/lib/courier-tracking-store.ts"),client=require("../src/lib/courier-tracking-client.ts"),worker=require("../src/lib/courier-tracking-worker.ts");
const now=Date.now();
const order=(extra={})=>({rowNumber:1,sheetRowNumber:3,fingerprint:"reference",dateLabel:"28/10/2026",primalac:"Test Kupac",brojTelefona:"38761111111",grad:"71000",adresa:"Test 1",artikal:"Tanzi",brojPaketa:"2",otkupnina:"100",vrijednostPosiljke:"100",dop:"1",zamjena:"0",sourceId:"telegram:test",receivedAt:"2026-10-27T10:00:00Z",appStatus:"",deliveredChecked:false,riskReview:"",...extra});
const data=(tracking,descriptions)=>({tracking,shippingDate:"28.10.2026",traces:descriptions.map((s,i)=>({date:"28.10.2026",time:`10:00:${String(59-i).padStart(2,"0")}`,location:"Test",status:s,code:""}))});
const state=o=>store.courierTrackingSnapshot([o]).states[o.sheetRowNumber];
let httpCalls=0,httpFails=false;
const responses=new Map();
global.fetch=async(url,input)=>{httpCalls++;assert.equal(url,"https://expressone.ba/api/track");assert.equal(input.method,"POST");assert.equal(input.cache,"no-store");
 if(httpFails)return Response.json({error:"private-provider-error"},{status:503});
 const id=JSON.parse(input.body).shipmentNumber.slice(-8),d=responses.get(id)||data(id,["Definicija podataka"]);
 return Response.json({ShipmentNumber:"70001"+id,ShippingDate:d.shippingDate,Traces:{Trace:d.traces.map(t=>({ParcelNumber:"70001"+id,ScanDate:t.date,ScanTime:t.time,CenterName:t.location,StatusDescription:t.status,StatusCode:t.code}))}});
};
(async()=>{
 assert.equal(status.normalizeCourierTracking("001-12345678"),"12345678");assert.equal(status.normalizeCourierTracking("7000112345678"),"12345678");
 assert.equal(status.normalizeCourierTracking("https://bad.test"),null);
 assert.equal(status.classifyCourierParcel(data("12345678",["Fakturisano"])),"review");
 assert.equal(status.classifyCourierParcel(data("12345678",["Potvrda dostave","Povrat pošiljaocu"])),"returned");
 assert.equal(status.classifyCourierParcel(data("12345678",["Definicija podataka","Izmjena"])),"registered");
 assert.equal(status.classifyCourierParcel(data("12345678",["Utovareno za dostavu","Init"])),"active");
 assert.throws(()=>client.parseCourierTrackingResponse({ShipmentNumber:"7000187654321",ShippingDate:"28.10.2026",Traces:{Trace:[{ScanDate:"28.10.2026",ScanTime:"10:00:00",StatusDescription:"Potvrda dostave"}]}},"12345678"),/identity/);
 assert.throws(()=>client.parseCourierTrackingResponse({error:"error"},"12345678"));
 const o=order();store.linkCourierOrder(o,["12345678","12345679"],"audit");
 assert.equal(state(o).category,"review","unfetched parcels are not active");
 store.recordCourierParcel(data("12345678",["Potvrda dostave"]),now+86400000);
 store.recordCourierParcel(data("12345679",["Definicija podataka"]),now+86400000);
 assert.equal(state(o).category,"partial","one delivered box does not close the order");
 store.recordCourierParcel(data("12345679",["Utovareno za dostavu"]),now+86400000);
 assert.equal(state(o).category,"active");assert.equal(state(o).parcels.filter(p=>p.category==="active").length,1);
 store.recordCourierParcel(data("12345679",["Potvrda dostave"]),now+86400000,now-status.COURIER_MAX_AGE-1000);
 assert.equal(state(o).category,"review","stale data cannot claim delivery");
 store.recordCourierParcel(data("12345679",["Potvrda dostave"]),now+86400000);
 assert.equal(state(o).category,"delivered");
 assert.equal(state(order({dateLabel:"29/10/2026",receivedAt:"2026-10-28T11:00:00Z"})).category,"review","copied order must not inherit the previous parcel");
 assert.equal(state(order({sheetRowNumber:30})).category,"delivered","row sorting preserves the same order identity");
 const dup=store.courierTrackingSnapshot([o,order({sheetRowNumber:4})]);assert.equal(dup.states[3].category,"review");assert.equal(dup.states[4].category,"review");
 assert.throws(()=>store.linkCourierOrder(order({dateLabel:"29/10/2026"}),["12345678","12345680"],"manual"),/already-linked/);
 assert.throws(()=>store.linkCourierOrder(o,["12345678"],"manual"),/parcel-count/);
 db.prepare("UPDATE courier_order_links SET applied_status_id='delivered:verified' WHERE order_key=?").run(status.courierOrderKey(o));
 assert.equal(state(o).category,"review","reactivating a row must not reapply old delivery");
 db.prepare("UPDATE courier_order_links SET applied_status_id=NULL WHERE order_key=?").run(status.courierOrderKey(o));
 store.suppressCourierOrder(o);assert.equal(state(o).category,"review");
 store.linkCourierOrder(o,["12345678","12345679"],"manual");
 source=[o];responses.set("12345678",data("12345678",["Potvrda dostave"]));responses.set("12345679",data("12345679",["Utovareno za dostavu"]));
 store.requestCourierTrackingSync(true);await Promise.all([worker.runCourierTrackingSync(),worker.runCourierTrackingSync()]);assert.equal(delivered,0);assert.equal(httpCalls,2);
 const calls=httpCalls;await worker.runCourierTrackingSync();assert.equal(httpCalls,calls,"only one due scan runs");
 responses.set("12345679",data("12345679",["Potvrda dostave"]));store.requestCourierTrackingSync(true);await worker.runCourierTrackingSync();
 assert.equal(delivered,1);assert.equal(source[0].appStatus,"delivered:verified");
 assert.equal(store.courierTrackingSnapshot(source,Date.now()+3*86400000).states[3].category,"delivered","verified historical delivery does not expire into an unknown status");
 source[0].appStatus="";store.requestCourierTrackingSync(true);await worker.runCourierTrackingSync();assert.equal(delivered,1,"old delivery is not reapplied after restore");
 const r=order({sheetRowNumber:6,sourceId:"new",brojPaketa:"1"});store.linkCourierOrder(r,["12345680"],"manual");source=[r];responses.set("12345680",data("12345680",["Fakturisano","Povrat pošiljaocu"]));
 store.requestCourierTrackingSync();await worker.runCourierTrackingSync();assert.equal(returned,1);
 const f=order({sheetRowNumber:7,sourceId:"failure",brojPaketa:"1"});store.linkCourierOrder(f,["12345681"],"manual");source=[f];responses.set("12345681",data("12345681",["Potvrda dostave"]));archiveFails=true;
 store.requestCourierTrackingSync();await worker.runCourierTrackingSync();assert.ok(store.getCourierSyncStatus().last_error,"unverified Sheets archives are retried");
 assert.equal(db.prepare("SELECT applied_status_id FROM courier_order_links WHERE order_key=?").get(status.courierOrderKey(f)).applied_status_id,null);
 archiveFails=false;httpFails=true;store.requestCourierTrackingSync(true);await worker.runCourierTrackingSync();assert.equal(state(f).category,"review");assert.ok(!store.getCourierSyncStatus().last_error.includes("private-provider"));
 assert.equal(new Date(worker.nextCourierTrackingScan(Date.parse("2026-10-28T06:10:00Z"))).toISOString(),"2026-10-28T06:15:00.000Z");
 assert.equal(new Date(worker.nextCourierTrackingScan(Date.parse("2026-10-28T06:20:00Z"))).toISOString(),"2026-10-29T06:15:00.000Z");
 db.close();fs.rmSync(tmp,{recursive:true,force:true});console.log("Courier tracking passed: response identity, all-parcel completion, partial delivery, stale/error isolation, copied orders, collision guards, daily lease, restore protection and archive verification.");
})().catch(e=>{console.error(e);process.exitCode=1;});

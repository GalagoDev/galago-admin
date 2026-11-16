/* eslint-disable @typescript-eslint/no-require-imports -- Isolated scheduler regression, no external calls. */
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module"),ts=require("typescript"),Database=require("better-sqlite3");
const root=path.resolve(__dirname,".."),resolve=Module._resolveFilename,load=Module._load,database=new Database(":memory:");
Module._resolveFilename=function(request,parent,...rest){return resolve.call(this,request.startsWith("@/")?path.join(root,"src",request.slice(2)):request,parent,...rest);};
Module._extensions[".ts"]=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const calls=[];let reads=0,fail=false,testingRegistration=false;
Module._load=function(request,parent,isMain){
  if(request==="server-only")return {};
  if(request==="@/lib/db")return {getDb:()=>database};
  if(request==="@/lib/meta-ads")return {getMetaAdsDailySpend:async()=>{reads++;return {configured:true,complete:!fail,spendBam:50,accounts:[{accountId:"test",currency:"BAM",spend:50}]};}};
  const schedulers={"@/lib/courier-tracking-worker":"startCourierTrackingScheduler","@/lib/expressone-returns":"startExpressOneScheduler","@/lib/claim-messaging-worker":"startClaimMessagingScheduler","@/lib/ads-sync":"startAdsScheduler","@/lib/ananas-scheduler":"startAnanasScheduler","@/lib/meta-spend-sync":"startMetaSpendScheduler","@/lib/import-payments-sync":"startImportPaymentsScheduler"};
  if(testingRegistration && schedulers[request])return {[schedulers[request]]:()=>calls.push(request)};
  if(request.includes("inventory-shopify"))throw Error("Retired lager scheduler loaded");
  return load.call(this,request,parent,isMain);
};
(async()=>{
  process.env.META_ADS_ACCESS_TOKEN="synthetic";process.env.META_AD_ACCOUNT_IDS="123456";
  const {syncMetaDailySpend}=require("../src/lib/meta-spend-sync.ts");
  await syncMetaDailySpend();assert.equal(reads,3);assert.equal(database.prepare("SELECT COUNT(*) AS n FROM meta_daily_spend").get().n,3);
  await syncMetaDailySpend();assert.equal(reads,3,"hourly lease prevents repeated work");
  const before=database.prepare("SELECT * FROM meta_daily_spend ORDER BY date_key").all();
  database.prepare("UPDATE meta_spend_sync SET last_attempt_at=0").run();fail=true;await syncMetaDailySpend();
  assert.deepEqual(database.prepare("SELECT * FROM meta_daily_spend ORDER BY date_key").all(),before,"failure preserves spend history");
  testingRegistration=true;process.env.NEXT_RUNTIME="nodejs";process.env.ANANAS_INTERNAL_SCHEDULER_ENABLED="true";
  const {register}=require("../src/instrumentation.ts");await register();
  assert.ok(calls.includes("@/lib/ads-sync"));assert.ok(calls.includes("@/lib/meta-spend-sync"));assert.ok(calls.includes("@/lib/ananas-scheduler"));assert.ok(calls.includes("@/lib/import-payments-sync"));assert.equal(calls.length,7);
  calls.length=0;process.env.NEXT_PHASE="phase-production-build";await register();assert.equal(calls.length,0,"build does not start background jobs");
  database.close();console.log("Backend passed: retired lager stays off, Google/Meta tracking and operational integrations remain, hourly leases and last-good Meta history are preserved.");
})().catch(e=>{console.error(e);process.exitCode=1;});

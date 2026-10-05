import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const npmRoot = process.env.PI_TEST_NPM_ROOT || execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
const hostRequire = createRequire(join(npmRoot, "@earendil-works/pi-coding-agent/package.json"));
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
const { registerQuotaStatus, formatRemainingQuota, quotaEndpoint } = await jiti.import("../lib/cliproxyapi-usage.ts");
const snapshot = { five_hour: { total_percent: 225, current_percent: 75 }, weekly: { total_percent: 187, current_percent: 28 } };
const flush = async () => { for (let i=0;i<4;i++) await new Promise(setImmediate); };

function host({ fetch, hasUI=true, provider="cliproxyapi", baseUrl="http://127.0.0.1:8317/backend-api" }={}) {
 const events=new Map(),bus=new Map(),items=[],calls=[];
 let clock=10000, interval, stopped=0,reads=0;
 const ctx={hasUI,model:{provider,id:"gpt-6.1-sol",baseUrl},sessionManager:{getSessionId:()=>"session-one"}};
 const deps={
  now:()=>clock,
  readSecrets:async()=>{reads++;return JSON.stringify({management_key:"test-only-key"});},
  fetch:async(url,options)=>{calls.push({url:new URL(url),options});return fetch?fetch(url,options):{ok:true,json:async()=>snapshot};},
  setInterval:(callback)=>{interval=callback;return {unref(){}};},
  clearInterval:()=>{interval=undefined;stopped++;},
 };
 const pi={on:(event,callback)=>events.set(event,callback),events:{on:(event,callback)=>bus.set(event,callback),emit:(event,data)=>{if(event==="status-item")items.push(data);}}};
 registerQuotaStatus(pi,deps);
 return {ctx,calls,items,get last(){return items.at(-1)?.text;},get stopped(){return stopped;},get reads(){return reads;},
  emit:(event)=>events.get(event)?.({},ctx),request:()=>bus.get("status-item:request")?.(),
  tick:async()=>{clock+=5000;interval?.();await flush();},advance:()=>{clock+=2000;},
  close:()=>events.get("session_shutdown")?.({},ctx),
 };
}

test("format matches total and current percentage contract",()=>{
 assert.equal(formatRemainingQuota(snapshot),"5h 225% (75%) · wk 187% (28%)");
 assert.equal(formatRemainingQuota(null),"5h ? (?) · wk ? (?)");
 assert.equal(formatRemainingQuota({five_hour:{total_percent:250,current_percent:null},weekly:{total_percent:0,current_percent:0}}),"5h 250% (?) · wk 0% (0%)");
 assert.equal(formatRemainingQuota({five_hour:{total_percent:NaN,current_percent:Infinity},weekly:{total_percent:-1,current_percent:28.4}}),"5h ? (?) · wk ? (28%)");
});

test("loopback endpoint forwards exact session/model and rejects remote URLs",()=>{
 const url=quotaEndpoint("http://127.0.0.1:8317/backend-api","gpt-6.1-sol","session /?&");
 assert.equal(url.pathname,"/v8/management/observability/quota/remaining");assert.equal(url.searchParams.get("session_id"),"session /?&");
 for(const base of ["https://remote.example/backend-api","file:///tmp/proxy","http://localhost.evil.invalid","http://user:password@localhost:8317"])assert.throws(()=>quotaEndpoint(base,"model","session"));
 for(const base of ["http://localhost:8317","http://[::1]:8317"])assert.doesNotThrow(()=>quotaEndpoint(base,"model","session"));
});

test("polls local management API and republishes via generic footer protocol",async()=>{
 const h=host();h.emit("session_start");await flush();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url.searchParams.get("session_id"),"session-one");assert.equal(h.calls[0].url.searchParams.get("model"),"gpt-6.1-sol");
 assert.equal(h.calls[0].options.headers.Authorization,"Bearer test-only-key");assert.equal(h.calls[0].options.redirect,"error");
 h.request();await flush();assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");assert.equal(h.calls.length,1);
 await h.tick();assert.equal(h.calls.length,2);h.close();assert.equal(h.last,null);assert.equal(h.stopped,1);
});

test("provider change cancels old response and removes the item",async()=>{
 let release;const h=host({fetch:()=>new Promise(resolve=>{release=resolve;})});
 h.emit("session_start");await flush();const signal=h.calls[0].options.signal;
 h.ctx.model={...h.ctx.model,provider:"bitdeer"};h.emit("model_select");assert.equal(h.last,null);assert.equal(signal.aborted,true);
 release({ok:true,json:async()=>snapshot});await flush();assert.equal(h.last,null);h.close();
});

test("switching session/model never displays a previous account's quota",async()=>{
 const resolvers=[];const h=host({fetch:()=>new Promise(resolve=>resolvers.push(resolve))});
 h.emit("session_start");await flush();const oldSignal=h.calls[0].options.signal;
 h.ctx.model={...h.ctx.model,id:"gpt-5.5"};h.ctx.sessionManager.getSessionId=()=>"session-two";h.emit("model_select");await flush();
 assert.equal(oldSignal.aborted,true);assert.equal(h.last,"5h ? (?) · wk ? (?)");assert.equal(h.calls.length,2);
 resolvers[0]({ok:true,json:async()=>snapshot});await flush();assert.equal(h.last,"5h ? (?) · wk ? (?)");
 resolvers[1]({ok:true,json:async()=>({...snapshot,weekly:{total_percent:150,current_percent:20}})});await flush();assert.equal(h.last,"5h 225% (75%) · wk 150% (20%)");h.close();
});

test("failures clear stale values without exposing credentials",async()=>{
 let fail=false;const h=host({fetch:async()=>{if(fail)throw new Error("test-only-key");return {ok:true,json:async()=>snapshot};}});
 h.emit("session_start");await flush();assert.match(h.last,/225%/);fail=true;await h.tick();assert.equal(h.last,"5h ? (?) · wk ? (?)");assert.ok(!h.items.some(i=>i.text?.includes("test-only-key")));h.close();
});

test("headless/other providers make no requests and remote endpoints never read secrets",async()=>{
 for(const options of [{hasUI:false},{provider:"openai-codex"}]) {const h=host(options);h.emit("session_start");await h.tick();assert.equal(h.calls.length,0);assert.equal(h.last,null);h.close();}
 const h=host({baseUrl:"https://remote.example/backend-api"});h.emit("session_start");await flush();assert.equal(h.calls.length,0);assert.equal(h.reads,0);h.close();
});


test("unused budgets are explicitly marked blocked when no account can route", async () => {
 let blocked=true;
 const h=host({fetch:async()=>({ok:true,json:async()=>({...snapshot,routing_available:!blocked})})});
 h.emit("session_start");await flush();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%) · blocked");
 blocked=false;await h.tick();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");h.close();
});

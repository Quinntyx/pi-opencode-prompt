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
const snapshot = { five_hour: { total_percent: 250, available_percent: 225, current_percent: 75 }, weekly: { total_percent: 187, available_percent: 100, current_percent: 28 }, routing_available: true, current_available: true };
const flush = async () => { for (let i=0;i<4;i++) await new Promise(setImmediate); };

function host({ fetch, hasUI=true, provider="cliproxyapi", baseUrl="http://127.0.0.1:8317/backend-api" }={}) {
 const events=new Map(),bus=new Map(),items=[],calls=[];
 let clock=10000, interval, stopped=0,reads=0;
 const ctx={hasUI,model:{provider,id:"gpt-6.1-sol",baseUrl},modelRegistry:{getApiKeyAndHeaders:async()=>({ok:true,apiKey:"test-client-key"})},sessionManager:{getSessionId:()=>"session-one"}};
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
 assert.equal(formatRemainingQuota({five_hour:{total_percent:250,available_percent:250,current_percent:null},weekly:{total_percent:0,available_percent:0,current_percent:0}}),"5h 250% (?) · wk 0% (0%)");
 assert.equal(formatRemainingQuota({five_hour:{total_percent:250,available_percent:NaN,current_percent:Infinity},weekly:{total_percent:-1,available_percent:100,current_percent:28.4}}),"5h ? (?) · wk ? (28%)");
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
 resolvers[1]({ok:true,json:async()=>({...snapshot,weekly:{total_percent:150,available_percent:50,current_percent:20}})});await flush();assert.equal(h.last,"5h 225% (75%) · wk 150% (20%)");h.close();
});

test("failures clear stale values without exposing credentials",async()=>{
 let fail=false;const h=host({fetch:async()=>{if(fail)throw new Error("test-only-key");return {ok:true,json:async()=>snapshot};}});
 h.emit("session_start");await flush();assert.match(h.last,/225%/);fail=true;await h.tick();assert.equal(h.last,"5h ? (?) · wk ? (?)");assert.ok(!h.items.some(i=>i.text?.includes("test-only-key")));h.close();
});

test("headless/other providers make no requests and remote endpoints never read secrets",async()=>{
 for(const options of [{hasUI:false},{provider:"openai-codex"}]) {const h=host(options);h.emit("session_start");await h.tick();assert.equal(h.calls.length,0);assert.equal(h.last,null);h.close();}
 const h=host({baseUrl:"https://remote.example/backend-api"});h.emit("session_start");await flush();assert.equal(h.calls.length,0);assert.equal(h.reads,0);h.close();
});


test("exhausted five-hour routing displays zero without discarding weekly budget", async () => {
 let blocked=true;
 const h=host({fetch:async()=>({ok:true,json:async()=>({...snapshot,five_hour:{...snapshot.five_hour,available_percent:blocked?0:225},routing_available:!blocked,current_available:!blocked})})});
 h.emit("session_start");await flush();
 assert.equal(h.last,"5h 0% (0%) · wk 187% (28%)");
 blocked=false;await h.tick();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");h.close();
});


test("reserved quota never raises usable totals above the capped 250 percent",()=>{
 const data={five_hour:{total_percent:300,available_percent:250,current_percent:50},weekly:{total_percent:250,available_percent:250,current_percent:50},routing_available:true,current_available:true};
 assert.equal(formatRemainingQuota(data),"5h 250% (50%) · wk 250% (50%)");
});

test("a weekly-capped account contributes neither five-hour nor weekly usable capacity",()=>{
 const data={five_hour:{total_percent:146,available_percent:100,current_percent:46},weekly:{total_percent:57,available_percent:28,current_percent:0},routing_available:true,current_available:false};
 assert.equal(formatRemainingQuota(data),"5h 100% (0%) · wk 57% (0%)");
});

test("unknown usable quota never falls back to known unspent budgets",()=>{
 const data={five_hour:{total_percent:146,available_percent:null,current_percent:75},weekly:{total_percent:57,available_percent:null,current_percent:28},routing_available:true,current_available:true};
 assert.equal(formatRemainingQuota(data),"5h ? (75%) · wk 57% (28%)");
});


test("five-hour exhaustion preserves capped weekly budget and never prints blocked",()=>{
 const data={five_hour:{total_percent:0,available_percent:0,current_percent:0},weekly:{total_percent:100,available_percent:0,current_percent:100},routing_available:false,current_available:false};
 assert.equal(formatRemainingQuota(data),"5h 0% (0%) · wk 100% (100%)");
 assert.ok(!formatRemainingQuota(data).includes("blocked"));
});


test("MagicDNS quota needs no client authorization or management secrets",async()=>{
 const h=host({baseUrl:"http://araveia.tail985727.ts.net:8317/backend-api"});
 h.emit("session_start");await flush();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");
 assert.equal(h.reads,0);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url.pathname,"/v1/quota/remaining");
 assert.equal(h.calls[0].url.hostname,"araveia.tail985727.ts.net");
 assert.deepEqual(h.calls[0].options.headers,{});
 assert.equal(h.calls[0].options.redirect,"error");h.close();
});

test("MagicDNS rejects deceptive hosts and userinfo",()=>{
 assert.equal(quotaEndpoint("https://araveia.tail985727.ts.net","model","session").pathname,"/v1/quota/remaining");
 for(const host of ["http://araveia.tail985727.ts.net.evil.test","http://tail985727.ts.net","http://a.tail985727.ts.net@evil.test","http://user:pass@a.tail985727.ts.net"])
  assert.throws(()=>quotaEndpoint(host,"model","session"));
});


test("tailnet polling works on older Pi without registry auth methods",async()=>{
 const h=host({baseUrl:"http://araveia.tail985727.ts.net:8317/backend-api"});
 h.ctx.modelRegistry={};h.emit("session_start");await flush();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");
 assert.equal(h.reads,0);assert.equal(h.calls.length,1);
 assert.deepEqual(h.calls[0].options.headers,{});h.close();
});

test("tailnet polling never resolves client credentials, even if resolution fails",async()=>{
 const h=host({baseUrl:"http://araveia.tail985727.ts.net:8317/backend-api"});
 h.ctx.modelRegistry.getApiKeyAndHeaders=async()=>{throw new Error("must not resolve auth");};
 h.emit("session_start");await flush();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");
 assert.equal(h.reads,0);assert.equal(h.calls.length,1);h.close();
});

test("Tailscale addresses use read-only quota routes; deceptive hosts stay blocked",()=>{
 for(const base of ["http://100.64.0.1:8317/backend-api","http://100.127.255.254:8317/backend-api",
  "http://[fd7a:115c:a1e0::1]:8317/backend-api"]) {
  const url=quotaEndpoint(base,"gpt-6.1-sol","remote-session");
  assert.equal(url.pathname,"/v1/quota/remaining");
  assert.equal(url.searchParams.get("session_id"),"remote-session");
 }
 for(const base of ["http://100.63.255.255:8317","http://100.128.0.0:8317",
  "http://[fd7a:115c:a1e1::1]:8317","http://192.168.1.1:8317","http://100.64.evil.test:8317"]) {
  assert.throws(()=>quotaEndpoint(base,"model","session"));
 }
});

test("direct tailnet address polling never accesses management credentials",async()=>{
 const h=host({baseUrl:"http://100.110.255.43:8317/backend-api"});
 h.ctx.modelRegistry={};h.emit("session_start");await flush();
 assert.equal(h.last,"5h 225% (75%) · wk 187% (28%)");
 assert.equal(h.reads,0);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].url.pathname,"/v1/quota/remaining");
 assert.deepEqual(h.calls[0].options.headers,{});h.close();
});

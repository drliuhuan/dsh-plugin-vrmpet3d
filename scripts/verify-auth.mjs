#!/usr/bin/env node
// Issue #1 regression: real cookie-gated browser requests, isolated host routes,
// report acknowledgements and the native window's session-aware status poll.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { listenOnUsablePort } from './loopback.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'vrmpet-auth-'));
const require = createRequire(import.meta.url);
const { watchGameVisibility } = require('../desktop/game-visibility.cjs');
for (const [key, name] of Object.entries({ SETTINGS_FILE:'settings.json', MODEL_DIRS_FILE:'models.json',
  MODEL_FILES_FILE:'model-files.json', MOTION_DIRS_FILE:'motions.json', IMPORT_DIR:'imports', SETUP_STATE_FILE:'setup.json' })) {
  process.env['VRMPET3D_' + key] = join(scratch, name);
}
const plugin = await import('../lib/index.js');
await import('../lib/core.js');
const core = globalThis.__VRMPET3D_CORE__;
const { DesktopWindow } = await import('../lib/desktop.js');
const savedOpen = DesktopWindow.prototype.openConfig;
let launched;
DesktopWindow.prototype.openConfig = function (options) { launched = options; return {ok:true,pid:123}; };
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const ack = (seq = 1) => new Response(JSON.stringify({seq}), {headers:{'content-type':'application/json'}});
const flush = () => new Promise(r => setImmediate(r));
const routes = [], effects = [], traffic = [];
const ctx = { logger:{info(){},warn(){}},
  get:key => ['webServer','webserver'].includes(key) ? {register(route){routes.push(route);return ()=>{};}}
    : key === 'agents' ? {list:()=>[],roots:()=>[]} : undefined,
  provide(){return ()=>{};},on(){return ()=>{};},effect(fn){const off=fn();effects.push(off);return off;} };
plugin.apply(ctx, {});
const cross = createServer((req, res) => {
  if (req.url === '/api') {
    res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'*'});
    res.end(JSON.stringify({cookie:req.headers.cookie||''}));return;
  }
  res.setHeader('content-type','text/html'); res.end('proxy login');
});
await listenOnUsablePort(cross);
const crossBase = `http://127.0.0.1:${cross.address().port}`;
let browserHtml = '';
const server = createServer((req,res) => {
  traffic.push({url:req.url,method:req.method,cookie:req.headers.cookie || ''});
  if (req.url === '/auth') {
    res.setHeader('set-cookie','audit_auth=ok; HttpOnly; SameSite=Lax; Path=/');
    res.setHeader('content-type','text/html'); res.end(browserHtml); return;
  }
  if (req.url.startsWith('/audit/')) {
    const name = req.url.slice('/audit/'.length);
    if (['core.js','scene.js'].includes(name)) {
      res.setHeader('content-type','text/javascript'); res.end(readFileSync(join(root,'lib',name))); return;
    }
  }
  if (!(req.headers.cookie || '').includes('audit_auth=ok')) {
    res.writeHead(302,{location:crossBase + '/login'}); res.end(); return;
  }
  if (req.url === '/auth/binary') { res.end(Buffer.from([1,2,3])); return; }
  const pathname = new URL(req.url,'http://localhost').pathname;
  const route = routes.find(r => r.kind === 'exact' ? r.path === pathname : pathname.startsWith(r.path + '/'));
  if (route) route.handler(req,res); else {res.statusCode=404;res.end();}
});
await listenOnUsablePort(server);
const base = `http://127.0.0.1:${server.address().port}`;
const native = (path, body, headers = {}) => fetch(base + '/vrmpet3d/' + path, {
  method:'POST',headers:{cookie:'audit_auth=ok','content-type':'application/json',...headers},body:JSON.stringify(body),
});
try {
  for (const status of [401,403,500]) await check(`HTTP ${status} is not acknowledged and identical report retries`, async () => {
    let calls=0;
    const reporter=core.createStateReporter({fetchImpl:async()=>++calls === 1 ? new Response('',{status}) : ack()});
    assert.equal(await reporter.report('working','audit'),null); assert.equal(reporter.last(),null);
    assert.equal(await reporter.report('working','audit'),'working'); assert.equal(calls,2);
    assert.equal(reporter.last(),'working');
  });
  for (const [name, response] of [
    ['HTML login',()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})],
    ['malformed JSON',()=>new Response('{')], ['unrelated JSON',()=>new Response('{}')],
    ['superseded widget',()=>new Response('{"seq":2,"superseded":true}')],
    ['redirected login',()=>({ok:true,redirected:true,json:async()=>({seq:2})})],
  ]) await check(`${name} is not mistaken for acknowledgement`, async()=>{
    const reporter=core.createStateReporter({fetchImpl:async()=>response()});
    assert.equal(await reporter.report('working'),null); assert.equal(reporter.last(),null);
    assert.equal(await reporter.reportError('error'),null);
  });
  await check('network rejection and synchronous throw both leave a report retryable',async()=>{
    for(const fail of [()=>Promise.reject(new Error('offline')),()=>{throw new Error('offline');}]) {
      let calls=0;const reporter=core.createStateReporter({fetchImpl:()=>++calls===1?fail():Promise.resolve(ack())});
      assert.equal(await reporter.report('working'),null);assert.equal(await reporter.report('working'),'working');assert.equal(calls,2);
    }
  });
  await check('pending duplicates are suppressed and older responses cannot overwrite newer state',async()=>{
    const pending=[];
    const reporter=core.createStateReporter({fetchImpl:()=>new Promise(r=>pending.push(r))});
    const first=reporter.report('working');await reporter.report('working');assert.equal(pending.length,1);
    const second=reporter.report('done');pending[1](ack(2));await second;pending[0](ack(1));await first;
    assert.equal(reporter.last(),'done');
  });
  await check('an older failure cannot clear a newer acknowledgement',async()=>{
    const pending=[];const reporter=core.createStateReporter({fetchImpl:()=>new Promise(r=>pending.push(r))});
    const first=reporter.report('working');const second=reporter.report('done');
    pending[1](ack(2));await second;pending[0](new Response('',{status:403}));await first;assert.equal(reporter.last(),'done');
  });
  await check('heartbeat retries failed state and clock without replaying a touch event',async()=>{
    const bodies=[];const reporter=core.createStateReporter({fetchImpl:async(_,options)=>{
      bodies.push(JSON.parse(options.body));return bodies.length===1?new Response('',{status:403}):ack();
    }});
    await reporter.report('working','audit',{reason:'click',region:'head',at:100},'state',false,2);
    await reporter.beat();assert.equal(bodies.length,2);assert.equal(bodies[1].state,'working');
    assert.equal(bodies[1].clock,'state');assert.equal(bodies[1].unread,2);assert.equal(bodies[1].touch,undefined);
  });
  await check('stalled network or response body times out, aborts and leaves heartbeat retryable',async()=>{
    for(const bodyStalls of [false,true]) {
      let calls=0,signal;
      const reporter=core.createStateReporter({requestTimeoutMs:15,fetchImpl:(_,options)=>{
        calls++;signal=options.signal;
        if(calls>1)return Promise.resolve(ack());
        return bodyStalls?Promise.resolve({ok:true,json:()=>new Promise(()=>{})}):new Promise(()=>{});
      }});
      assert.equal(await reporter.report('working'),null);assert.equal(signal.aborted,true);
      assert.equal(await reporter.beat(),'working');assert.equal(calls,2);
    }
  });
  for(const path of ['settings','preview','setup-state','state','models','motions','desktop','say']) {
    await check(`${path} refuses foreign Origin before executing a write`,async()=>{
      assert.equal((await native(path,{}, {origin:'https://foreign.invalid'})).status,403);
    });
  }
  await check('null Origin, foreign Referer and cross-site metadata are refused',async()=>{
    for(const headers of [{origin:'null'},{referer:'https://foreign.invalid/page'}, {'sec-fetch-site':'cross-site'},
      {origin:base,'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}]) {
      assert.equal((await native('settings',{},headers)).status,403);
    }
  });
  await check('text/plain cannot bypass JSON write protection',async()=>{
    assert.equal((await native('settings',{}, {'content-type':'text/plain'})).status,415);
  });
  await check('same-origin JSON and local native clients remain supported',async()=>{
    assert.equal((await native('settings',{preferences:{size:220}},{origin:base})).status,200);
    assert.equal((await native('settings',{preferences:{size:230}})).status,200);
  });
  await check('HTTPS origin at a TLS-terminating proxy matches its unchanged public Host',async()=>{
    const response = await new Promise((resolveResponse,reject)=>{
      const req=httpRequest(base+'/vrmpet3d/settings',{method:'POST',headers:{host:'public.example',origin:'https://public.example',
        cookie:'audit_auth=ok','content-type':'application/json'}},res=>{res.resume();res.on('end',()=>resolveResponse(res.statusCode));});
      req.on('error',reject);req.end('{}');
    });assert.equal(response,200);
  });
  await check('browser same-origin metadata tolerates a proxy rewriting Host',async()=>{
    assert.equal((await native('settings',{}, {origin:'https://public.example','sec-fetch-site':'same-origin'})).status,200);
    assert.equal((await native('settings',{}, {origin:'null','sec-fetch-site':'same-origin'})).status,403);
  });
  await check('binary model upload rejects foreign origins and safelisted content types',async()=>{
    assert.equal((await native('models?file=a.vrm',{}, {origin:'https://foreign.invalid','content-type':'application/octet-stream'})).status,403);
    for(const type of ['text/plain','application/x-www-form-urlencoded','multipart/form-data']) {
      assert.equal((await native('models?file=a.vrm',{}, {'content-type':type})).status,415);
    }
  });
  await check('a cross-site GET cannot invoke the AI provider',async()=>{
    const response=await fetch(base+'/vrmpet3d/say?state=working',{headers:{cookie:'audit_auth=ok','sec-fetch-site':'cross-site'}});
    assert.equal(response.status,403);
  });
  await check('native window URL uses the local listener, not public Host or forwarded headers',async()=>{
    const response=await new Promise((resolveResponse,reject)=>{
      const req=httpRequest(base+'/vrmpet3d/desktop',{method:'POST',headers:{host:'public.example',
        'x-forwarded-host':'attacker.invalid','x-forwarded-proto':'https',cookie:'audit_auth=ok','content-type':'application/json'}},res=>{
        res.resume();res.on('end',()=>resolveResponse(res.statusCode));
      });req.on('error',reject);req.end('{"action":"settings"}');
    });assert.equal(response,200);assert.equal(new URL(launched.url).origin,base);assert.equal(new URL(launched.url).pathname,'/vrmpet3d/global');
  });
  await check('all shipped frontend fetch options preserve same-origin credentials',async()=>{
    for(const name of ['client.js','core.js','config-page.js','desktop-page.js','mini-game-page.js','setup-page.js','model-picker.js','scene.js','client.core.js','client.scene.js']) {
      const text=readFileSync(join(root,'lib',name),'utf8');assert.doesNotMatch(text,/credentials\s*:\s*['"](?:omit|include)['"]/);
    }
  });

  await check('native visibility poll uses the window session and refuses login/oversized responses',async()=>{
    let visible=true, mode='focused', calls=0;
    const session={async fetch(url,options){
      assert.equal(this,session);assert.equal(url,base+'/vrmpet3d/desktop');assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');calls++;
      return mode==='focused'?new Response('{"gameFocused":true}',{headers:{'content-type':'application/json'}})
        :mode==='large'?new Response(' '.repeat(16385),{headers:{'content-type':'application/json'}})
        :new Response('<html>login</html>',{headers:{'content-type':'text/html'}});
    }};
    const win={webContents:{session},isDestroyed:()=>false,isVisible:()=>visible,hide(){visible=false;},showInactive(){visible=true;}};
    const stop=watchGameVisibility(win,base+'/vrmpet3d/window',15);
    try {
      await new Promise(r=>setTimeout(r,8));assert.equal(visible,false);
      mode='login';await new Promise(r=>setTimeout(r,35));assert.equal(visible,true);
      mode='focused';await new Promise(r=>setTimeout(r,35));assert.equal(visible,false);
      mode='large';await new Promise(r=>setTimeout(r,35));assert.equal(visible,true);assert.ok(calls>=4);
    } finally {stop();}
  });
  await check('stopping the native poll aborts its pending request and ignores late data',async()=>{
    let signal,finish,visible=true;
    const win={webContents:{session:{fetch:(_,options)=>{signal=options.signal;return new Promise(r=>finish=r);}}},
      isDestroyed:()=>false,isVisible:()=>visible,hide(){visible=false;},showInactive(){visible=true;}};
    const stop=watchGameVisibility(win,base+'/vrmpet3d/window');stop();assert.equal(signal.aborted,true);
    finish(new Response('{"gameFocused":true}',{headers:{'content-type':'application/json'}}));await flush();assert.equal(visible,true);
  });

  browserHtml=`<!doctype html><script src="/audit/core.js"></script><script src="/audit/scene.js"></script><script>
  (async()=>{
    const checks=[];const check=(name,ok)=>checks.push({name,ok:!!ok});
    try {
      let blocked=false;try{await fetch('/vrmpet3d/settings',{credentials:'omit'});}catch(_){blocked=true;}
      check('omit reproduces auth redirect CORS failure',blocked);
      const settings=__VRMPET3D_CORE__.watchHostSettings({});
      check('real settings watcher loads through cookie gate',!!(await settings.load()));settings.stop();
      let stateDelivered=false,previewDelivered=false;
      const state=__VRMPET3D_CORE__.watchHostState({onState:(_,body)=>{stateDelivered=typeof body.seq==='number';}});
      await state.load();check('real state watcher loads through cookie gate',stateDelivered);state.stop();
      const preview=__VRMPET3D_CORE__.watchHostPreview({onPreview:()=>{previewDelivered=true;}});
      await preview.load();check('real preview watcher loads through cookie gate',previewDelivered);preview.stop();
      const reporter=__VRMPET3D_CORE__.createStateReporter({});
      check('real state reporter POST authenticates and acknowledges',await reporter.report('working','audit')==='working');
      const saved=__VRMPET3D_CORE__.watchHostSettings({});
      check('real settings POST authenticates',!!(await saved.push({preferences:{size:240}})));saved.stop();
      const model={source:{urlFor:()=>'/auth/binary'},options:{},parse:()=>({ok:true}),onError:()=>{}};
      check('real model loader carries same-origin cookie',(await __VRMPET3D_SCENE__.Scene.prototype.loadModel.call(model,'audit')).ok);
      const response=await fetch('/vrmpet3d/settings',{credentials:'same-origin'});
      check('same-origin credentials work with wildcard ACAO',response.ok&&response.headers.get('access-control-allow-origin')==='*');
      const cross=await fetch('${crossBase}/api',{credentials:'same-origin'});
      check('cross-origin same-origin fetch sends no cookie',(await cross.json()).cookie==='');
      let includeBlocked=false;try{await fetch('${crossBase}/api',{credentials:'include'});}catch(_){includeBlocked=true;}
      check('cross-origin include is refused with wildcard ACAO',includeBlocked);
      document.body.innerText=JSON.stringify({checks});
    }catch(error){document.body.innerText=JSON.stringify({checks,error:String(error)});}
  })();</script>`;
  const browser=[process.env.VRMPET3D_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if(!browser)throw new Error('Chromium browser required (set VRMPET3D_BROWSER)');
  const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--user-data-dir='+join(scratch,'browser'),'--dump-dom','--virtual-time-budget=8000',base+'/auth'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const deadline=setTimeout(()=>child.kill(),25000);
  const [code]=await once(child,'exit');clearTimeout(deadline);assert.equal(code,0,stderr.slice(-1500));
  const body=/<body[^>]*>([\s\S]*?)<\/body>/i.exec(stdout)?.[1];
  const result=JSON.parse(body?.replace(/&quot;/g,'"').replace(/&amp;/g,'&')||'{}');
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.checks?.length,10,stdout.slice(-2000));
  for(const item of result.checks)await check(item.name,()=>assert.equal(item.ok,true));
  await check('authenticated JSON POSTs never require a CORS preflight',async()=>{
    assert.ok(traffic.some(r=>r.method==='POST'&&r.cookie.includes('audit_auth=ok')));
    assert.ok(!traffic.some(r=>r.method==='OPTIONS'));
  });
  const output=join(root,'build/probe-out/auth-results.json');mkdirSync(join(root,'build/probe-out'),{recursive:true});
  writeFileSync(output,JSON.stringify({passed,browser:result,traffic},null,2));
  console.log(`auth: ${passed} checks passed`);
} finally {
  DesktopWindow.prototype.openConfig=savedOpen;
  server.closeAllConnections();server.close();cross.closeAllConnections();cross.close();
  for(const off of effects.reverse())if(typeof off==='function')off();
  // Delete only the exact temporary directory created by this script.
  if(resolve(scratch).startsWith(resolve(tmpdir())+require('node:path').sep+'vrmpet-auth-')) {
    try{rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(error){console.warn('temporary browser profile retained: '+error.message);}
  }
}

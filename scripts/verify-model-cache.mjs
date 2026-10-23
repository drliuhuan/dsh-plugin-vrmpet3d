#!/usr/bin/env node
// Real HTTP + browser disk cache regression, without a running DSH/profile.
// node scripts/verify-model-cache.mjs [--package <unpacked-plugin-directory>]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync, utimesSync, renameSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { listenOnUsablePort } from './loopback.mjs';

const packageArg = process.argv.indexOf('--package');
const root = packageArg >= 0 ? resolve(process.argv[packageArg + 1]) : fileURLToPath(new URL('../',import.meta.url));
const { createAssetHandler } = await import(pathToFileURL(join(root,'lib/index.js')));
const scratch = mkdtempSync(join(tmpdir(),'vrmpet-model-cache-'));
const plain = join(scratch,'model.vrm'), compressed = join(scratch,'model.vrm.br'), texture = join(scratch,'texture.png');
const initial = Buffer.alloc(128*1024,65);
const browserModelBytes = 18*1024*1024;
writeFileSync(plain,initial);writeFileSync(compressed,brotliCompressSync(initial));writeFileSync(texture,Buffer.from('texture'));
const files = new Map([
  ['plain',{absolute:plain,root:scratch}],['compressed',{absolute:compressed,root:scratch}],
]);
const handler = createAssetHandler({files});
let authenticated = true;
const traffic = [];
const server = createServer((req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if(url.pathname==='/scene.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(root,'lib/scene.js')));return;}
  if(url.pathname==='/deny'){authenticated=false;res.end();return;}
  if(url.pathname==='/asset'){
    const entry={url:req.url,method:req.method,conditional:req.headers['if-none-match']||'',cookie:req.headers.cookie||'',bytes:0};
    const write=res.write.bind(res),end=res.end.bind(res);
    res.write=(chunk,...args)=>{if(chunk)entry.bytes+=Buffer.byteLength(chunk);return write(chunk,...args);};
    res.end=(chunk,...args)=>{if(chunk&&typeof chunk!=='function')entry.bytes+=Buffer.byteLength(chunk);return end(chunk,...args);};
    traffic.push(entry);res.on('finish',()=>{entry.status=res.statusCode;});
    // Simulated auth proxy runs BEFORE the plugin, including conditional requests.
    if(!authenticated){res.writeHead(401,{'cache-control':'no-store'});res.end('login required');return;}
    handler(req,res);return;
  }
  if(url.pathname==='/browser'){
    res.setHeader('set-cookie','cache_auth=ok; Max-Age=3600; HttpOnly; SameSite=Lax; Path=/');
    res.setHeader('cache-control','no-store');res.setHeader('content-type','text/html');
    res.end(browserPage(url.searchParams.get('phase')));return;
  }
  res.statusCode=404;res.end();
});
await listenOnUsablePort(server);
const base='http://127.0.0.1:'+server.address().port;
const get=(id,options={})=>fetch(base+'/asset?m='+id,options);
let passed=0;
async function check(name,test){await test();passed++;console.log('PASS '+name);}
function browserPage(phase){return `<!doctype html><script src="/scene.js"></script><script>
(async()=>{const checks=[];const check=(name,ok)=>checks.push({name,ok:!!ok});
try{
  const make=()=>({source:{urlFor:()=>'/asset?m=plain'},options:{},parse:buffer=>({ok:buffer.byteLength===${browserModelBytes}}),onError:()=>{}});
  const scene=__VRMPET3D_SCENE__.Scene.prototype;
  check('phase ${phase}: model loader reads authenticated bytes',(await scene.loadModel.call(make(),'plain')).ok);
  ${phase==='first'?`
  check('second scene uses revalidated cached bytes',(await scene.loadModel.call(make(),'plain')).ok);
  const reload=make();scene.bustModelCache.call(reload);
  check('manual reload fetches complete current bytes',(await scene.loadModel.call(reload,'plain')).ok);
  `:`
  await fetch('/deny');
  const denied=await scene.loadModel.call(make(),'plain');
  check('revoked auth cannot be bypassed with cached bytes',denied.ok===false);
  `}
  document.body.innerText=JSON.stringify({checks});
}catch(error){document.body.innerText=JSON.stringify({checks,error:String(error)});}
})();</script>`;}
async function browserRun(phase){
  const browser=[process.env.VRMPET3D_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
  if(!browser)throw new Error('Chromium required; set VRMPET3D_BROWSER');
  const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--user-data-dir='+join(scratch,'browser-profile'),'--dump-dom','--virtual-time-budget=6000',base+'/browser?phase='+phase],
    {windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const timer=setTimeout(()=>child.kill(),25000);
  let code;try{[code]=await once(child,'exit');}finally{clearTimeout(timer);}
  assert.equal(code,0,stderr.slice(-1500));
  const body=/<body[^>]*>([\s\S]*?)<\/body>/i.exec(stdout)?.[1];
  const result=JSON.parse(body?.replace(/&quot;/g,'"').replace(/&amp;/g,'&')||'{}');
  assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.checks?.length,phase==='first'?3:2,stdout.slice(-1500));
  for(const item of result.checks)await check(item.name,()=>assert.equal(item.ok,true));
}
try{
  for(const id of ['plain','compressed']){
    let tag;
    await check(`${id}: first download is private, revalidated and byte-identical`,async()=>{
      const response=await get(id);assert.equal(response.status,200);tag=response.headers.get('etag');assert.match(tag,/^W\/"[a-f0-9]+"$/);
      assert.equal(response.headers.get('cache-control'),'private, no-cache');assert.deepEqual(Buffer.from(await response.arrayBuffer()),initial);
      assert.ok(!tag.includes(scratch));
    });
    await check(`${id}: matching ETag returns 304 with no model bytes`,async()=>{
      const response=await get(id,{headers:{'if-none-match':tag}});assert.equal(response.status,304);
      assert.equal((await response.arrayBuffer()).byteLength,0);assert.equal(response.headers.get('etag'),tag);
      assert.equal(response.headers.get('cache-control'),'private, no-cache');
    });
    await check(`${id}: weak/strong validators and lists are supported`,async()=>{
      for(const validator of [tag.replace(/^W\//,''), '"unrelated", '+tag,'*']){
        const response=await get(id,{headers:{'if-none-match':validator}});assert.equal(response.status,304);await response.arrayBuffer();
      }
    });
    await check(`${id}: HEAD supports validation without a response body`,async()=>{
      const head=await get(id,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),initial.length);
      assert.equal((await head.arrayBuffer()).byteLength,0);
      const conditional=await get(id,{method:'HEAD',headers:{'if-none-match':tag}});assert.equal(conditional.status,304);
    });
    await check(`${id}: explicit reload ignores validators and is never stored`,async()=>{
      const response=await get(id+'&v=force',{headers:{'if-none-match':tag}});assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),initial);
    });
    await check(`${id}: changed file invalidates its ETag and decoded memory cache`,async()=>{
      const changed=Buffer.alloc(initial.length,66);const path=id==='plain'?plain:compressed;
      writeFileSync(path,id==='plain'?changed:brotliCompressSync(changed));utimesSync(path,new Date(),new Date('2030-01-01'));
      const response=await get(id,{headers:{'if-none-match':tag}});assert.equal(response.status,200);
      assert.notEqual(response.headers.get('etag'),tag);assert.deepEqual(Buffer.from(await response.arrayBuffer()),changed);
    });
  }
  await check('same-size replacement with preserved mtime still invalidates the cached model',async()=>{
    const before=await get('plain');const tag=before.headers.get('etag');await before.arrayBuffer();const stats=statSync(plain);
    const replacement=join(scratch,'replacement.vrm');writeFileSync(replacement,Buffer.alloc(initial.length,67));utimesSync(replacement,stats.atime,stats.mtime);
    // Windows cannot replace a destination until the completed stream's handle closes.
    await new Promise(resolve=>setTimeout(resolve,25));
    if(process.platform==='win32')rmSync(plain);
    renameSync(replacement,plain);
    const response=await get('plain',{headers:{'if-none-match':tag}});assert.equal(response.status,200);
    assert.notEqual(response.headers.get('etag'),tag);assert.equal(new Uint8Array(await response.arrayBuffer())[0],67);
  });
  await check('reassigned model IDs cannot match the old file validator',async()=>{
    const before=await get('plain');const tag=before.headers.get('etag');await before.arrayBuffer();
    const other=join(scratch,'other.vrm');writeFileSync(other,initial);files.set('plain',{absolute:other,root:scratch});
    const response=await get('plain',{headers:{'if-none-match':tag}});assert.equal(response.status,200);assert.notEqual(response.headers.get('etag'),tag);await response.arrayBuffer();
    files.set('plain',{absolute:plain,root:scratch});
  });
  await check('external model textures participate in the same private cache',async()=>{
    const response=await get('plain&p=texture.png');const tag=response.headers.get('etag');assert.equal(await response.text(),'texture');
    const cached=await get('plain&p=texture.png',{headers:{'if-none-match':tag}});assert.equal(cached.status,304);
  });
  await check('unknown, deleted and unsafe paths never return stale 304',async()=>{
    for(const id of ['unknown','plain&p=../escape.vrm']){
      const response=await get(id,{headers:{'if-none-match':'*'}});assert.notEqual(response.status,304);assert.match(response.headers.get('cache-control'),/no-store/);
    }
    rmSync(compressed);const response=await get('compressed',{headers:{'if-none-match':'*'}});assert.equal(response.status,404);
  });
  // Reset fixture bytes, then test the actual Scene loader through a Chromium cache.
  writeFileSync(plain,Buffer.alloc(browserModelBytes,65));traffic.length=0;
  await browserRun('first');
  await check('repeat model request transfers zero bytes; manual reload transfers a full model',()=>{
    assert.equal(traffic.length,3);assert.deepEqual(traffic.map(x=>x.status),[200,304,200]);
    assert.equal(traffic[1].bytes,0);assert.ok(traffic[1].conditional);assert.ok(traffic[2].url.includes('&v='));
    assert.equal(traffic[0].bytes,browserModelBytes);assert.equal(traffic[2].bytes,browserModelBytes);
    assert.ok(traffic.every(x=>x.cookie.includes('cache_auth=ok')));
  });
  const before=traffic.length;await browserRun('second');
  await check('browser restart reuses disk cache but still checks proxy authentication',()=>{
    const later=traffic.slice(before);assert.deepEqual(later.map(x=>x.status),[304,401]);assert.equal(later[0].bytes,0);
    assert.ok(later[0].conditional);assert.ok(later.every(x=>x.cookie.includes('cache_auth=ok')));
  });
  const out=join(fileURLToPath(new URL('../',import.meta.url)),'build/probe-out');mkdirSync(out,{recursive:true});
  writeFileSync(join(out,'model-cache-results.json'),JSON.stringify({passed,traffic},null,2));
  console.log(`model cache: ${passed} checks passed`);
}finally{
  server.closeAllConnections();server.close();
  if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'vrmpet-model-cache-'))throw new Error('unexpected scratch');
  try{rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(error){console.warn('temporary browser profile retained: '+error.message);}
}

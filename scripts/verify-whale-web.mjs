#!/usr/bin/env node
// CLI discovery regression, including the real apply() -> /whale path.
// node scripts/verify-whale-web.mjs [--package <unpacked-plugin-directory>]
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { listenOnUsablePort } from './loopback.mjs';

const packageArg = process.argv.indexOf('--package');
const root = packageArg >= 0 ? resolve(process.argv[packageArg + 1]) : fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'vrmpet-whale-web-'));
const previousEnv = new Map();
function setEnv(key, value) { previousEnv.set(key, process.env[key]); process.env[key] = value; }
for (const [key, name] of Object.entries({ SETTINGS_FILE:'settings.json', MODEL_DIRS_FILE:'models.json', MODEL_FILES_FILE:'files.json',
  MOTION_DIRS_FILE:'motions.json', MOTION_IMPORTS_FILE:'motion-imports.json', IMPORT_DIR:'imports', SETUP_STATE_FILE:'setup.json',
  WHALE_FILE:'missing.apng', DSH_ASAR:'missing.asar' })) setEnv('VRMPET3D_' + key, join(scratch, name));
const plugin = await import(pathToFileURL(join(root, 'lib/index.js')));
const { resolveWhaleMark } = await import(pathToFileURL(join(root, 'lib/whale.js')));
const savedEntry = process.argv[1], savedFetch = globalThis.fetch;
let passed = 0;
async function check(name, test) { await test(); passed++; console.log('PASS ' + name); }
function put(path, data) { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, data); }
// Synthetic image shape for the existing APNG inspector: tests discovery and serving,
// not image decoding, and carries no copy of DSH's artwork.
const image = Buffer.alloc(24);
Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
image.writeUInt32BE(28, 16); image.writeUInt32BE(28, 20);
const mark = Buffer.concat([image, Buffer.from('acTL' + 'fcTL'.repeat(60))]);
function chatAt(installRoot) {
  const chat = join(installRoot, 'node_modules/@deepseek-ai/dsh-client-ui-chat');
  put(join(chat, 'package.json'), JSON.stringify({name:'@deepseek-ai/dsh-client-ui-chat', exports:{'./package.json':'./package.json'}}));
  put(join(chat, 'lib/client.js'), 'var css="mask:url(data:image/png;base64,' + mark.toString('base64') + ')";');
  return chat;
}
const cliRoot = join(scratch, 'global/node_modules/@deepseek-ai/dsh');
const entry = join(cliRoot, 'lib/bin.js'); put(entry, '// synthetic CLI'); chatAt(cliRoot);
const effects = [];
let server;
try {
  await check('ordinary Node entry resolves the DSH-owned chat package', () => {
    assert.equal(plugin.installRootFromDshEntry(entry), realpathSync(cliRoot));
  });
  await check('package exports refuse client.js while exported package.json remains resolvable', () => {
    const fromCli = createRequire(entry);
    assert.throws(() => fromCli.resolve('@deepseek-ai/dsh-client-ui-chat/lib/client.js'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
    assert.ok(fromCli.resolve('@deepseek-ai/dsh-client-ui-chat/package.json').endsWith('package.json'));
  });
  await check('inferred root reaches the existing resolver and yields the animated mark', () => {
    const found = resolveWhaleMark({installRoot:plugin.installRootFromDshEntry(entry)});
    assert.equal(found.frames,60); assert.equal(found.width,28); assert.equal(found.height,28); assert.deepEqual(found.bytes,mark);
  });
  await check('hoisted npm package resolution uses the actual chat package location', () => {
    const hoistedRoot = join(scratch, 'hoisted');
    const bin = join(hoistedRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js'); put(bin,'// CLI'); chatAt(hoistedRoot);
    assert.equal(plugin.installRootFromDshEntry(bin), realpathSync(hoistedRoot));
  });
  await check('pnpm virtual store resolves the real chat package and its bundle', () => {
    const virtualRoot = join(scratch, 'pnpm/node_modules/.pnpm/chat@1'); const chat = chatAt(virtualRoot);
    const dshRoot = join(scratch, 'pnpm/node_modules/.pnpm/dsh@1/node_modules/@deepseek-ai/dsh');
    const bin = join(dshRoot, 'lib/bin.js'); put(bin,'// CLI');
    const link = join(dshRoot,'node_modules/@deepseek-ai/dsh-client-ui-chat');mkdirSync(dirname(link),{recursive:true});
    symlinkSync(chat, link, process.platform === 'win32' ? 'junction' : 'dir');
    const found = resolveWhaleMark({installRoot:plugin.installRootFromDshEntry(bin)});
    assert.equal(found.frames,60);assert.deepEqual(found.bytes,mark);
  });
  await check('entry reached through a directory link resolves from the real CLI location', () => {
    const binLink = join(scratch,'linked-bin');symlinkSync(join(cliRoot,'lib'),binLink,process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(plugin.installRootFromDshEntry(join(binLink,'bin.js')),realpathSync(cliRoot));
  });
  if (process.platform !== 'win32') await check('Unix ~/.local/bin/dsh-style file symlink resolves correctly', () => {
    const link = join(scratch,'local/bin/dsh');mkdirSync(dirname(link),{recursive:true});symlinkSync(entry,link);
    assert.equal(plugin.installRootFromDshEntry(link),realpathSync(cliRoot));
  }); else console.log('SKIP Unix file symlink: Windows directory junction exercises realpath without requiring symlink privilege');
  await check('missing entry, invalid entry and absent chat package return null', () => {
    const missingChat = join(scratch,'no-chat/bin.js');put(missingChat,'// no package');
    for(const value of [null,'',join(scratch,'absent.js'),missingChat,42]) assert.equal(plugin.installRootFromDshEntry(value),null);
  });
  await check('default argument reads the current process entry', () => {
    process.argv[1]=entry;assert.equal(plugin.installRootFromDshEntry(),realpathSync(cliRoot));
    process.argv[1]=undefined;assert.equal(plugin.installRootFromDshEntry(),null);process.argv[1]=entry;
  });
  const routes=[],logs=[];
  const ctx = {logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
    get:key=>['webServer','webserver'].includes(key)?{register(route){routes.push(route);return()=>{};}}
      :key==='agents'?{list:()=>[],roots:()=>[]}:undefined,
    provide(){return()=>{};},on(){return()=>{};},effect(fn){const off=fn();effects.push(off);return off;}};
  // Stop the unrelated dynamic game-level refresh; actual route requests use savedFetch.
  globalThis.fetch = async () => { throw new Error('offline fixture'); };
  plugin.apply(ctx,{});globalThis.fetch=savedFetch;
  server=createServer((req,res)=>{
    const route=routes.find(r=>r.path===new URL(req.url,'http://localhost').pathname);
    if(route)route.handler(req,res);else{res.statusCode=404;res.end();}
  });await listenOnUsablePort(server);
  const base='http://127.0.0.1:'+server.address().port;
  await check('apply discovers from argv and exposes image/apng through the real route',async()=>{
    const response=await savedFetch(base+'/vrmpet3d/whale');assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/apng');assert.deepEqual(Buffer.from(await response.arrayBuffer()),mark);
  });
  await check('activation logs source and frame count and caches the discovered image',()=>{
    assert.ok(logs.some(line=>line.includes('the whale mark came from')&&line.includes('60 frames')));
    assert.deepEqual(readFileSync(join(scratch,'imports/whale-tail.apng')),mark);
  });
  await check('HEAD reports the APNG type without sending its bytes',async()=>{
    const response=await savedFetch(base+'/vrmpet3d/whale',{method:'HEAD'});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/apng');assert.equal((await response.arrayBuffer()).byteLength,0);
  });
  await check('a later activation with no CLI bundle can use the cached copy',()=>{
    const found=resolveWhaleMark({installRoot:join(scratch,'gone'),stateFile:join(scratch,'imports/whale-tail.apng')});
    assert.equal(found.frames,60);assert.deepEqual(found.bytes,mark);
  });
  console.log(`whale web: ${passed} checks passed`);
} finally {
  process.argv[1]=savedEntry;globalThis.fetch=savedFetch;
  if(server){server.closeAllConnections();server.close();}
  for(const off of effects.reverse())if(typeof off==='function')off();
  for(const [key,value] of previousEnv)if(value===undefined)delete process.env[key];else process.env[key]=value;
  if(!resolve(scratch).startsWith(resolve(tmpdir())+sep+'vrmpet-whale-web-'))throw new Error('unexpected scratch path');
  rmSync(scratch,{recursive:true,force:true});
}

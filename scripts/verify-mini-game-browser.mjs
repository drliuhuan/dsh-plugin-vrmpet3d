// Real Chromium smoke test against the shipped page and model, with a local DSH status fixture.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { listenOnUsablePort } from './loopback.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = join(root, 'build/probe'); mkdirSync(build, { recursive: true });
const webMode = process.argv.includes('--web');
const playPreview = process.argv.includes('--preview');
const browser = [process.env.VRMPET3D_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => p && existsSync(p));
if (!browser) throw new Error('Chromium browser required');
const probe = `<script>
(async function () {
  var checks=[], errors=[], opened=[];
  window.addEventListener('error', function(e){ errors.push(e.message); });
  window.open=function(url){ opened.push(url); return {}; };
  var wait=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
  var state=window.__VRMPET3D_GAME_STATE__;
  function check(name, yes){ checks.push({name:name,ok:!!yes}); }
  for(var i=0;i<80&&!state().modelReady;i++) await wait(250);
  check('bundled VRM loads in its own WebGL scene',state().modelReady);
  check('starts ready to serve with 24 rice bowls',state().phase==='serve'&&state().remaining===24);
  // A bridge fixture avoids requesting browser fullscreen during synthetic input.
  var arena=document.getElementById('arena');
  arena.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:500,clientY:600}));
  check('left click launches the game',state().phase==='playing');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  check('Escape pauses and exposes the dialog',state().paused&&!document.getElementById('overlay').hidden);
  document.getElementById('resume').click();
  check('resume continues the game',!state().paused);
  await fetch('/test-notice',{method:'POST'}); await wait(1300);
  check('task notification flashes background',document.getElementById('game').classList.contains('signal'));
  check('notification button is visible',!document.getElementById('notice').hidden&&state().targets===2);
  document.getElementById('notice').click();
  var rows=document.querySelectorAll('#sessions button');
  check('pause offers both affected sessions',state().paused&&rows.length===2);
  rows[0].click(); await wait(150);
  check('selected session opens through the correct surface',${webMode ? "opened.length===1&&new URL(opened[0]).searchParams.get('vrmpet3d-session')==='attention-session'&&state().paused" : "window.__focused===true"});
  // Switch to the browser path by reloading with a web-mode fixture in a second run.
  check('no uncaught page errors',errors.length===0);
  var out=document.createElement('pre');out.id='game-test-report';out.textContent=JSON.stringify({checks:checks,errors:errors,state:state()});document.body.appendChild(out);
  ${playPreview ? "document.getElementById('overlay').hidden=true;" : ''}
})();</script>`;
let notice = false, navigation = null;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  function json(value) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); }
  if (url.pathname === '/test-notice') { notice = true; return json({ ok: true }); }
  if (url.pathname === '/vrmpet3d/state') return json(notice ? { state: 'waiting', why: { waitingSessionIds: ['attention-session'], completedSessionIds: ['completed-session'] } } : { state: 'resting', why: {} });
  if (url.pathname === '/vrmpet3d/desktop') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { navigation = JSON.parse(body); json({ ok: navigation.action === 'game-session' && navigation.sessionId === 'attention-session' }); }); return;
  }
  if (url.pathname === '/vrmpet3d/settings') return json({ preferences: { modelId: 'test-model' } });
  if (url.pathname === '/vrmpet3d/catalog') return json({ models: [{ id: 'test-model' }] });
  if (url.pathname === '/vrmpet3d/asset') {
    res.setHeader('content-type', 'model/gltf-binary'); return res.end(brotliDecompressSync(readFileSync(join(root, 'assets/models/BlueFatFish.vrm.br'))));
  }
  if (url.pathname === '/vrmpet3d/game') {
    let html = readFileSync(join(root, 'lib/mini-game.html'), 'utf8');
    if (!webMode) html = html.replace('<script src=', '<script>window.vrmpet3dDesktop={focusHost:function(){window.__focused=true;}};</script><script src=');
    res.setHeader('content-type', 'text/html'); return res.end(html.replace('</body>', probe + '</body>'));
  }
  const name = url.pathname.replace('/vrmpet3d/window/lib/', '');
  if (/^[a-zA-Z0-9.-]+\.(js|css)$/.test(name) && existsSync(join(root, 'lib', name))) {
    res.setHeader('content-type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(readFileSync(join(root, 'lib', name)));
  }
  res.statusCode = 404; res.end();
});
const address = await listenOnUsablePort(server);
const port = typeof address === 'number' ? address : server.address().port;
try {
  const args = ['--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
    '--no-first-run', '--hide-scrollbars', '--window-size=1440,1000', '--virtual-time-budget=30000',
    '--user-data-dir=' + resolve(build, 'mini-game-browser-profile'),
    '--screenshot=' + resolve(build, playPreview ? 'mini-game-play-preview.png' : 'mini-game-preview.png'), '--dump-dom', `http://127.0.0.1:${port}/vrmpet3d/game`];
  let output = '';
  await new Promise((ok, fail) => {
    const child = spawn(browser, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); fail(new Error('browser timeout')); }, 60000);
    child.stdout.on('data', data => { output += data; });
    child.on('error', e => { clearTimeout(timer); fail(e); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? ok() : fail(new Error('browser exited ' + code)); });
  });
  writeFileSync(join(build, 'mini-game-browser.html'), output);
  const match = /<pre id="game-test-report">([\s\S]*?)<\/pre>/.exec(output);
  if (!match) throw new Error('browser did not finish the game probe');
  const report = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  for (const check of report.checks) console.log((check.ok ? 'PASS ' : 'FAIL ') + check.name);
  if (report.checks.some(c => !c.ok)) { console.log(JSON.stringify(report)); process.exitCode = 1; }
  else console.log(`mini-game browser: ${report.checks.length} passed`);
} finally { server.closeAllConnections(); server.close(); }

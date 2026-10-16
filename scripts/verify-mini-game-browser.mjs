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
const noticeArg = process.argv.find(arg => arg.startsWith('--notice='));
const noticeKind = noticeArg ? noticeArg.split('=')[1] : 'waiting';
if (!['error', 'waiting', 'done'].includes(noticeKind)) throw new Error('notice must be error, waiting or done');
const playPreview = process.argv.includes('--preview') || Boolean(noticeArg);
const fixture = noticeKind === 'error'
  ? { state: 'error', why: { statusSessionId: 'failed-session', waitingSessionIds: ['attention-session'], completedSessionIds: ['completed-session'] } }
  : noticeKind === 'waiting' ? { state: 'waiting', why: { waitingSessionIds: ['attention-session'], completedSessionIds: ['completed-session'] } }
    : { state: 'done', why: { statusSessionId: 'completed-session', completedSessionIds: ['completed-session'] } };
const targetCount = noticeKind === 'error' ? 3 : noticeKind === 'waiting' ? 2 : 1;
const targetId = noticeKind === 'error' ? 'failed-session' : noticeKind === 'waiting' ? 'attention-session' : 'completed-session';
const shippedSprings = JSON.parse(readFileSync(join(root, 'assets/models/vrmpet3d-models.json'), 'utf8')).springs['BlueFatFish.vrm.br'];
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
  var avatar=state().avatar, defaults=${JSON.stringify(shippedSprings)};
  check('bundled VRM uses locked shipped springs and TiePen instead of user settings',state().modelReady&&avatar.locked
    &&avatar.expression===1&&avatar.lookAtPointer===false&&avatar.springs.length>0&&avatar.springs.every(function(chain){
      var expected=defaults[chain.key];return !expected||(chain.stiffness===expected.stiffness&&chain.dragForce===expected.dragForce&&chain.gravityPower===expected.gravityPower);
    }));
  var hud=document.getElementById('score'), hudBox=hud.getBoundingClientRect();
  var arena=document.getElementById('arena'), whites=true;
  for(var col=0;col<8;col++){
    var pixel=arena.getContext('2d').getImageData(Math.round((111.5+col*111)*arena.width/1000),Math.round(142*arena.height/700),1,1).data;
    if(pixel[0]!==244||pixel[1]!==245||pixel[2]!==243) whites=false;
  }
  check('named game starts with 24 rice bowls in the centered HUD',state().phase==='serve'&&state().remaining===24
    &&document.title==='吃白饭 · 桌宠弹球'&&document.querySelector('.brand').firstChild.textContent.trim()==='吃白饭'
    &&hud.textContent==='第 1 关 / 剩余 24 碗饭'&&Math.abs(hudBox.x+hudBox.width/2-innerWidth/2)<2&&whites);
  // A bridge fixture avoids requesting browser fullscreen during synthetic input.
  arena.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:500,clientY:600}));
  check('left click launches the game',state().phase==='playing');
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  var pausedAngle=state().avatar.angle; await wait(100);
  check('Escape pauses the game and axial spin',state().paused&&!document.getElementById('overlay').hidden&&state().avatar.angle===pausedAngle);
  document.getElementById('resume').click();
  check('resume continues the game',!state().paused);
  await fetch('/test-notice',{method:'POST'}); await wait(1300);
  check('notification priority selects ${noticeKind} glow',document.getElementById('game').classList.contains('signal')
    &&document.getElementById('game').dataset.noticeKind==='${noticeKind}');
  check('notification button is visible',!document.getElementById('notice').hidden&&state().targets===${targetCount});
  document.getElementById('notice').click();
  var rows=document.querySelectorAll('#sessions button');
  check('pause offers all affected sessions in priority order',state().paused&&rows.length===${targetCount});
  rows[0].click(); await wait(150);
  check('selected session opens through the correct surface',${webMode ? "opened.length===1&&new URL(opened[0]).searchParams.get('vrmpet3d-session')==='" + targetId + "'&&state().paused" : "window.__focused===true"});
  // Switch to the browser path by reloading with a web-mode fixture in a second run.
  avatar=state().avatar;
  var dot=function(a,b){return a.reduce(function(sum,v,i){return sum+v*b[i];},0);};
  check('no page errors; spinning body follows flight with perpendicular gaze',errors.length===0&&avatar.angle>pausedAngle
    &&dot(avatar.body,avatar.direction)>0.999999&&Math.abs(dot(avatar.body,avatar.gaze))<0.000001);
  var out=document.createElement('pre');out.id='game-test-report';out.textContent=JSON.stringify({checks:checks,errors:errors,state:state()});document.body.appendChild(out);
  ${playPreview ? "document.getElementById('overlay').hidden=true;" : ''}
  ${noticeArg ? "document.getElementById('game').getAnimations({subtree:true}).forEach(function(animation){if(animation.animationName==='signal'){animation.pause();animation.currentTime=840;}});" : ''}
})();</script>`;
let notice = false, navigation = null;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  function json(value) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); }
  if (url.pathname === '/test-notice') { notice = true; return json({ ok: true }); }
  if (url.pathname === '/vrmpet3d/state') return json(notice ? fixture : { state: 'resting', why: {} });
  if (url.pathname === '/vrmpet3d/desktop') {
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { navigation = JSON.parse(body); json({ ok: navigation.action === 'game-session' && navigation.sessionId === targetId }); }); return;
  }
  if (url.pathname === '/vrmpet3d/settings') return json({ preferences: { modelId: 'test-model', physics: false, lookAtPointer: true,
    yaw: 1, viewYaw: 1, springs: { 'test-model': { DaiMao: { stiffness: 9, dragForce: 0.9, gravityPower: 9 } } }, expressions: { weights: { TiePen: 0 } } } });
  if (url.pathname === '/vrmpet3d/catalog') return json({ models: [{ id: 'test-model' }] });
  if (url.pathname === '/vrmpet3d/motions') return json({ springDefaults: { 'test-model': shippedSprings } });
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
    '--screenshot=' + resolve(build, noticeArg ? 'mini-game-' + noticeKind + '-preview.png' : playPreview ? 'mini-game-play-preview.png' : 'mini-game-preview.png'), '--dump-dom', `http://127.0.0.1:${port}/vrmpet3d/game`];
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

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
      var expected=defaults[chain.key];return chain.gravityPower===0&&(!expected||(chain.stiffness===expected.stiffness&&chain.dragForce===expected.dragForce));
    }));
  var hud=document.getElementById('score'), hudBox=hud.getBoundingClientRect();
  var arena=document.getElementById('arena'), whites=true;
  var firstRow=state().bowls.filter(function(b){return b.y===112;});
  firstRow.forEach(function(b){
    var pixel=arena.getContext('2d').getImageData(Math.round((b.x+b.w/2)*arena.width/1000),Math.round((b.y+b.h*0.75)*arena.height/750),1,1).data;
    if(pixel[0]!==244||pixel[1]!==245||pixel[2]!==243) whites=false;
  });
  var levelBox=document.getElementById('level').getBoundingClientRect(), initialField=arena.getBoundingClientRect();
  check('wide DS over BALL bowls with level above left and remaining rice above right',state().phase==='serve'&&state().remaining===79
    &&document.title==='吃白饭 · 桌宠弹球'&&document.querySelector('.brand').firstChild.textContent.trim()==='吃白饭'
    &&hud.textContent==='RICE: 79'&&document.getElementById('level').textContent==='LEVEL:1'
    &&Math.abs(hudBox.right-initialField.right)<2&&Math.abs(levelBox.left-initialField.left)<2
    &&hudBox.bottom<=initialField.top&&levelBox.bottom<=initialField.top&&whites);
  check('every spring joint has zero gravity',avatar.gravity.length>0&&avatar.gravity.every(function(v){return v===0;}));
  check('production defaults match the selected size, spin, flight and boost',state().appearance.size===90&&state().appearance.spin===7
    &&state().flightSpeed===1&&state().paddleBoost===2);
  check('HUD uses local dot matrix glyphs with accessible labels',document.querySelectorAll('#game-hud canvas').length===2
    &&document.getElementById('level').getAttribute('aria-label')==='LEVEL:1'&&hud.getAttribute('aria-label')==='RICE: 79'
    &&getComputedStyle(hud).fontSize==='0px');
  var portraits=document.querySelectorAll('#lives img'), portrait=portraits[0];
  await portrait.decode();
  var pc=document.createElement('canvas');pc.width=portrait.naturalWidth;pc.height=portrait.naturalHeight;
  var pctx=pc.getContext('2d');pctx.drawImage(portrait,0,0);
  var pixels=pctx.getImageData(0,0,pc.width,pc.height).data, transparent=0, opaque=0;
  for(var p=3;p<pixels.length;p+=4){if(pixels[p]===0)transparent++;if(pixels[p]>0)opaque++;}
  var fieldBox=arena.getBoundingClientRect(), livesBox=document.getElementById('lives').getBoundingClientRect();
  check('two reserve portraits stay outside the 4:3 arena for three total chances',portraits.length===2&&transparent>0&&opaque>0
    &&livesBox.right<=fieldBox.left&&portrait.getBoundingClientRect().width===100&&Math.abs(fieldBox.width/fieldBox.height-4/3)<0.001);
  var riceJoined=true;
  for(var ry=113;ry<=127;ry++){
    var sample=arena.getContext('2d').getImageData(Math.round(108*arena.width/1000),Math.round(ry*arena.height/750),1,1).data;
    if(sample[3]<200||sample[0]<150)riceJoined=false;
  }
  check('rice overlaps the bowl rim without a background gap',riceJoined);
  // A bridge fixture avoids requesting browser fullscreen during synthetic input.
  arena.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:500,clientY:600}));
  check('left click launches the game',state().phase==='playing');
  check('playing captures the mouse and hides its cursor',state().mouseCaptured&&document.getElementById('game').classList.contains('mouse-captured'));
  var paddleBefore=state().paddleX;
  arena.dispatchEvent(new PointerEvent('pointermove',{movementX:10,clientX:0}));
  check('captured mouse uses relative movement to steer the paddle',Math.abs(state().paddleX-paddleBefore-10*1000/parseFloat(arena.style.width))<0.001);
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  var pausedAngle=state().avatar.angle; await wait(100);
  check('Escape pauses the game and axial spin',state().paused&&!document.getElementById('overlay').hidden&&state().avatar.angle===pausedAngle);
  check('Escape releases the mouse and restores the cursor',!state().mouseCaptured&&!document.getElementById('game').classList.contains('mouse-captured'));
  document.getElementById('resume').click();
  check('resume continues the game',!state().paused);
  await wait(100);
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
  check('no page errors; body follows flight with perpendicular gaze',errors.length===0
    &&dot(avatar.body,avatar.direction)>0.999999&&Math.abs(dot(avatar.body,avatar.gaze))<0.000001);
  document.getElementById('model-size').value='100';document.getElementById('model-size').dispatchEvent(new Event('input'));
  document.getElementById('spin-speed').value='0';document.getElementById('spin-speed').dispatchEvent(new Event('input'));
  var speedBefore=Math.hypot(state().ball.vx,state().ball.vy);
  document.getElementById('flight-speed').value='1.5';document.getElementById('flight-speed').dispatchEvent(new Event('input'));
  document.getElementById('paddle-boost').value='5';document.getElementById('paddle-boost').dispatchEvent(new Event('input'));
  check('flight speed control scales the moving ball immediately',state().flightSpeed===1.5
    &&Math.abs(Math.hypot(state().ball.vx,state().ball.vy)-speedBefore*1.5)<0.001);
  document.getElementById('resume').click();
  var stoppedAngle=state().avatar.angle;
  await wait(100);
  check('size applies visually and zero speed stops spin while flight continues',state().appearance.size===100&&state().avatar.angle===stoppedAngle
    &&Math.abs(parseFloat(document.getElementById('pet').style.width)/parseFloat(arena.style.width)*1000-100)<0.1);
  document.getElementById('pause').click();
  var saved=state(), reload=document.createElement('iframe'); reload.hidden=true;
  reload.src='/vrmpet3d/game?restore-probe=1&debug=1'; document.body.appendChild(reload);
  await new Promise(function(resolve){reload.onload=resolve;});
  var resumed=reload.contentWindow.__VRMPET3D_GAME_STATE__();
  check('reopening restores the saved level, bowls, chances and paused state',resumed.paused&&resumed.level===saved.level
    &&resumed.remaining===saved.remaining&&resumed.lives===saved.lives
    &&resumed.appearance.size===100&&resumed.appearance.spin===0&&resumed.flightSpeed===1.5&&resumed.paddleBoost===5);
  reload.remove();
  var test=document.createElement('iframe'); test.style.cssText='position:fixed;inset:0;width:100%;height:100%'; test.src='/vrmpet3d/game?restore-probe=1&test=1'; document.body.appendChild(test);
  await new Promise(function(resolve){test.onload=resolve;});
  var td=test.contentDocument, ts=test.contentWindow.__VRMPET3D_GAME_STATE__;
  for(var load=0;load<80&&!ts().modelReady;load++) await wait(250);
  check('standalone test mode exposes controls with separate progress',!td.getElementById('test-controls').hidden&&ts().remaining===79);
  td.getElementById('arena').dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:500,clientY:600}));
  var stepTest=test.contentWindow.__VRMPET3D_GAME_TEST__.step;
  stepTest(0.02); var physicsBefore=ts().avatar.physics, spinBefore=ts().avatar.angle;
  for(var f=0;f<8;f++)stepTest(0.02);
  var physicsAfter=ts().avatar.physics;
  check('flight and spin move the physical rig and spring joints respond with zero gravity',physicsAfter.enabled&&!physicsAfter.error&&ts().avatar.angle>spinBefore
    &&JSON.stringify(physicsBefore.position)!==JSON.stringify(physicsAfter.position)
    &&JSON.stringify(physicsBefore.joints)!==JSON.stringify(physicsAfter.joints)
    &&ts().avatar.gravity.every(function(v){return v===0;}));
  td.getElementById('pause').click(); var frozen=JSON.stringify(ts().avatar.physics); stepTest(0.02);
  check('pause freezes spring physics as well as flight',JSON.stringify(ts().avatar.physics)===frozen);
  var hitTest=test.contentWindow.__VRMPET3D_GAME_TEST__.hitBowl;
  var topHit=hitTest(0,'top');
  check('top rice hit leaves a white empty bowl and updates remaining rice',topHit.some(function(e){return e.type==='eat';})
    &&ts().remaining===78&&ts().bowls[0].hp===1&&!ts().bowls[0].rice&&ts().bowls[0].alive);
  var broken=hitTest(78,'bottom');
  check('white bowl body breaks on first hit and retains loose rice',broken.some(function(e){return e.type==='break';})
    &&ts().bowls[78].hp===0&&ts().bowls[78].rice&&ts().remaining===78);
  var rb=ts().bowls[78], rc=td.getElementById('arena'), rctx=rc.getContext('2d');
  function ricePixel(dx,dy){return rctx.getImageData(Math.round((rb.x+rb.w/2+dx)*rc.width/1000),Math.round((rb.y+rb.h/2+dy)*rc.height/750),1,1).data;}
  var centerRice=ricePixel(0,0), bottomRice=ricePixel(0,4);
  check('loose rice uses fluffy pale rice grains without a dark base',centerRice[0]>200&&centerRice[1]>200&&centerRice[2]>180
    &&bottomRice[0]>200&&bottomRice[1]>200&&bottomRice[2]>180);
  var varieties=ts().riceVariants;
  check('three rice heap shapes are distributed stably across the level',new Set(varieties).size===3
    &&JSON.stringify(varieties)===JSON.stringify(ts().riceVariants));
  var effects=test.contentWindow.__VRMPET3D_GAME_TEST__.effects, fragmentsBefore=ts().fragments;
  check('breaking a bowl emits rotating ceramic fragments',fragmentsBefore.length===9);
  td.getElementById('pause').click();effects(0.05);
  check('pause freezes the breaking animation',JSON.stringify(ts().fragments)===JSON.stringify(fragmentsBefore));
  td.getElementById('resume').click();
  for(var effectFrame=0;effectFrame<15;effectFrame++)effects(0.05);
  var falling=ts().fragments;
  check('fragments rotate and fall under gravity',falling.length>0&&falling[0].y>fragmentsBefore[0].y
    &&falling[0].vy>0&&falling[0].angle!==fragmentsBefore[0].angle&&falling[0].life<fragmentsBefore[0].life);
  for(var finishFrame=0;finishFrame<25;finishFrame++)effects(0.05);
  check('all ceramic fragments disappear after their short animation',ts().fragments.length===0);
  var loose=hitTest(78,'bottom');
  check('loose rice is edible and bowl durability is saved separately',loose.some(function(e){return e.type==='eat';})&&ts().remaining===77
    &&JSON.parse(localStorage.getItem('mini-game:v1:/vrmpet3d/game:test')).bowls[78].rice===false);
  td.getElementById('test-loss').click(); td.getElementById('test-loss').click();
  await wait(100);
  check('last active chance leaves no reserve portraits',ts().lives===1&&td.querySelectorAll('#lives img').length===0);
  td.getElementById('test-loss').click();
  await wait(100);
  check('third test loss resets current level and restores two reserve icons',ts().lives===3&&ts().remaining===79&&ts().phase==='serve'
    &&td.querySelectorAll('#lives img').length===2&&portrait.src===document.querySelector('#lives img').src);
  td.getElementById('test-clear').click();
  check('test clear grants one chance and saves the cleared phase',ts().phase==='cleared'&&ts().remaining===0&&ts().lives===4
    &&ts().bowls.some(function(b){return b.hp>0;})&&JSON.parse(localStorage.getItem('mini-game:v1:/vrmpet3d/game:test')).phase==='cleared');
  td.getElementById('test-notice').click(); td.querySelector('#sessions button').click();
  check('test messages exercise navigation without DSH',ts().paused&&td.getElementById('connection').textContent.includes('测试会话跳转成功'));
  td.getElementById('arena').requestPointerLock=function(){return Promise.reject(new Error('denied'));};
  td.getElementById('resume').click();await wait(100);
  check('pointer capture rejection pauses with a usable cursor',ts().paused&&!ts().mouseCaptured&&!td.getElementById('game').classList.contains('mouse-captured'));
  var selector=td.getElementById('debug-level');
  check('debug menu offers only the two implemented levels',ts().debug&&!td.getElementById('debug-controls').hidden
    &&Array.from(selector.options).map(function(o){return o.value;}).join(',')==='1,2');
  selector.value='2';selector.dispatchEvent(new Event('change'));
  check('selecting level two loads the approved bowl with rice and one-hit blue-white stripes',ts().level===2&&ts().paused&&ts().remaining===104
    &&ts().bowls.filter(function(b){return b.hp>0;}).length===134
    &&ts().bowls.filter(function(b){return b.hp>0;}).every(function(b){return b.hp===1&&['#244c9c','#f4f5f3'].includes(b.color);})
    &&JSON.parse(localStorage.getItem('mini-game:v1:/vrmpet3d/game:test')).level===2);
  selector.value='1';selector.dispatchEvent(new Event('change'));
  check('debug selection retains earned chances when returning to first level',ts().level===1&&ts().remaining===79&&ts().lives===4&&ts().paused);
  selector.value='2';selector.dispatchEvent(new Event('change'));
  // Restore the pointer fixture after the intentional rejection check above.
  td.getElementById('arena').requestPointerLock=test.contentWindow.HTMLElement.prototype.requestPointerLock;
  td.getElementById('resume').click();td.getElementById('test-clear').click();
  for(var finishLevel=0;finishLevel<35;finishLevel++)stepTest(0.05);
  check('finishing level two grants one chance and opens completion menu without a third level',ts().level===2&&ts().paused&&ts().phase==='cleared'&&ts().lives===5
    &&td.getElementById('pause-title').textContent==='两关已全部通关'&&td.getElementById('resume').hidden);
  var layouts=true;
  [[1280,720],[640,900],[390,844],[960,400]].forEach(function(size){
    test.style.width=size[0]+'px';test.style.height=size[1]+'px';test.contentWindow.dispatchEvent(new Event('resize'));
    var a=td.getElementById('arena').getBoundingClientRect(), l=td.getElementById('lives').getBoundingClientRect();
    layouts=layouts&&Math.abs(a.width/a.height-4/3)<0.001&&a.left>=0&&a.top>=0&&a.right<=size[0]+1&&a.bottom<=size[1]+1
      &&(l.right<=a.left||l.bottom<=a.top);
  });
  check('wide, narrow and short layouts keep a 4:3 arena with lives outside',layouts);
  test.remove();
  var productionSave=JSON.parse(localStorage.getItem('mini-game:v1:/vrmpet3d/game:debug'));productionSave.lives=10;
  localStorage.setItem('mini-game:v1:/vrmpet3d/game',JSON.stringify(productionSave));
  var production=document.createElement('iframe');production.style.cssText='position:fixed;inset:0;width:100%;height:100%';
  production.src='/vrmpet3d/game?restore-probe=1';document.body.appendChild(production);
  await new Promise(function(resolve){production.onload=resolve;});
  var pd=production.contentDocument,ps=production.contentWindow.__VRMPET3D_GAME_STATE__;
  check('production hides all adjustment and test controls, retaining one debug entry',!ps().debug
    &&pd.getElementById('debug-controls').hidden&&pd.querySelector('.model-controls:not(#debug-controls)').hidden
    &&pd.getElementById('test-controls').hidden&&typeof production.contentWindow.__VRMPET3D_GAME_TEST__==='undefined'
    &&new URL(pd.getElementById('debug-entry').href).searchParams.get('debug')==='1');
  pd.getElementById('model-size').value='150';pd.getElementById('model-size').dispatchEvent(new Event('input'));
  pd.getElementById('debug-level').value='2';pd.getElementById('debug-level').dispatchEvent(new Event('change'));
  check('production enforces fixed defaults even with older custom settings',ps().appearance.size===90&&ps().appearance.spin===7
    &&ps().flightSpeed===1&&ps().paddleBoost===2&&ps().level===productionSave.level);
  var reserveBox=pd.getElementById('lives').getBoundingClientRect();
  check('ten chances restore as nine reserve icons fitting outside the arena',ps().lives===10&&pd.getElementById('lives').children.length===9
    &&reserveBox.bottom<=production.contentWindow.innerHeight&&reserveBox.right<=pd.getElementById('arena').getBoundingClientRect().left);
  check('debug adjustments remain isolated from production progress',JSON.parse(localStorage.getItem('mini-game:v1:/vrmpet3d/game:debug')).lives!==10);
  production.remove();
  var closed=false; window.close=function(){closed=true;}; document.getElementById('exit').click();
  check('pause exit saves before closing and provides a browser fallback',closed&&state().paused
    &&document.getElementById('pause-title').textContent==='已保存，可以关闭此页'
    &&JSON.parse(localStorage.getItem('mini-game:v1:/vrmpet3d/game:debug')).level===state().level);
  var out=document.createElement('pre');out.id='game-test-report';out.textContent=JSON.stringify({checks:checks,errors:errors,state:state()});document.body.appendChild(out);
  ${playPreview ? "document.getElementById('overlay').hidden=true;" : ''}
  ${noticeArg ? "document.getElementById('game').getAnimations({subtree:true}).forEach(function(animation){if(animation.animationName==='signal'){animation.pause();animation.currentTime=840;}});" : ''}
})().catch(function(error){var out=document.createElement('pre');out.id='game-test-report';out.textContent=JSON.stringify({checks:[{name:'probe completed: '+error.stack,ok:false}],errors:[String(error)]});document.body.appendChild(out);});</script>`;
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
    // Synthetic events cannot authorize OS pointer lock. Exercise the event contract with a DOM fixture.
    html = html.replace('<script src=', '<script>(function(){var locked=null;Object.defineProperty(document,"pointerLockElement",{get:function(){return locked;}});HTMLElement.prototype.requestPointerLock=function(){locked=this;document.dispatchEvent(new Event("pointerlockchange"));return Promise.resolve();};document.exitPointerLock=function(){locked=null;document.dispatchEvent(new Event("pointerlockchange"));};})();</script><script src=');
    if (!webMode) html = html.replace('<script src=', '<script>window.vrmpet3dDesktop={focusHost:function(){window.__focused=true;}};</script><script src=');
    res.setHeader('content-type', 'text/html'); return res.end(url.searchParams.has('restore-probe') ? html : html.replace('</body>', probe + '</body>'));
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
    '--screenshot=' + resolve(build, noticeArg ? 'mini-game-' + noticeKind + '-preview.png' : playPreview ? 'mini-game-play-preview.png' : 'mini-game-preview.png'), '--dump-dom', `http://127.0.0.1:${port}/vrmpet3d/game?debug=1`];
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

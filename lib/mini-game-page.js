(function () {
  'use strict';
  var api = globalThis.__VRMPET3D_MINI_GAME__;
  try { api.setLevels(JSON.parse(document.getElementById('game-level-data').textContent)); } catch (_) {}
  var game = new api.Game();
  var $ = function (id) { return document.getElementById(id); };
  var root = $('game'), canvas = $('arena'), ctx = canvas.getContext('2d'), pet = $('pet');
  var scene = null, modelReady = false, stopped = false, frameId, pollTimer, statusRequest, lastTime = 0;
  var view = { scale: 1, x: 0, y: 0 }, angle = 0, particles = [], targets = [], seen = new Set();
  var noticeKey = '', clearTime = 0, bridge = globalThis.vrmpet3dDesktop;
  var flightRig = null, heading = null, roll = null, up = null, direction = null;
  var testMode = new URLSearchParams(location.search).get('test') === '1';
  var debugMode = testMode || new URLSearchParams(location.search).get('debug') === '1';
  var saveKey = 'mini-game:v1:' + location.pathname + (testMode ? ':test' : debugMode ? ':debug' : ''), saveTime = 0;
  var appearance = { size: 90, spin: 7 };
  var lifePortrait = '', shownLives = -1;
  var flightBall = null;
  var resumeEnd = 0, resumeTimer = null;
  function cancelResume() {
    clearTimeout(resumeTimer); resumeTimer = null; resumeEnd = 0; $('resume-countdown').hidden = true;
  }
  function tickResume(now) {
    if (!resumeEnd) return;
    var remaining = Math.max(0, Math.ceil((resumeEnd - now) / 1000));
    if (!remaining) {
      if (document.pointerLockElement !== canvas || document.hidden || stopped) { pause(true); return; }
      pause(false); root.classList.add('mouse-captured'); lastTime = 0; return;
    }
    $('countdown-number').textContent = remaining;
  }
  function beginResume() {
    if (!game.paused || (game.phase === 'cleared' && game.level === api.levelCount()) || resumeEnd) return;
    resumeEnd = performance.now() + 3000; $('overlay').hidden = true; $('resume-countdown').hidden = false;
    $('countdown-number').textContent = '3'; captureMouse();
    function tick() { tickResume(performance.now()); if (resumeEnd) resumeTimer = setTimeout(tick, 100); }
    if (resumeEnd) resumeTimer = setTimeout(tick, 100);
  }
  var gameWindowFocused = document.hasFocus(), focusTimer = null;
  var focusClient = globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  function reportGameFocus(active, keepalive) {
    if (testMode || stopped && active) return;
    return fetch('/vrmpet3d/desktop', { method: 'POST', credentials: 'same-origin', keepalive: keepalive === true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'game-focus', clientId: focusClient, active: active }) }).catch(function () {});
  }
  function fitLifeIcons() {
    var count = Math.max(1, game.lives - 1), w = root.clientWidth, h = root.clientHeight;
    var size = w >= 720 ? Math.min(100, Math.max(1, (h - 162 - (count - 1) * 3) / (count * 1.33)))
      : Math.min(100, Math.max(1, (w - 32 - (count - 1) * 3) / count));
    $('lives').style.setProperty('--life-width', size + 'px');
  }
  var hudGlyphs = {
    L:['10000','10000','10000','10000','10000','10000','11111'], E:['11111','10000','10000','11110','10000','10000','11111'],
    V:['10001','10001','10001','10001','10001','01010','00100'], R:['11110','10001','10001','11110','10100','10010','10001'],
    I:['11111','00100','00100','00100','00100','00100','11111'], C:['01111','10000','10000','10000','10000','10000','01111'],
    ':':['00000','00100','00100','00000','00100','00100','00000'], ' ':['00000','00000','00000','00000','00000','00000','00000'],
    '0':['01110','10001','10011','10101','11001','10001','01110'], '1':['00100','01100','00100','00100','00100','00100','01110'],
    '2':['01110','10001','00001','00010','00100','01000','11111'], '3':['11110','00001','00001','01110','00001','00001','11110'],
    '4':['00010','00110','01010','10010','11111','00010','00010'], '5':['11111','10000','10000','11110','00001','00001','11110'],
    '6':['01110','10000','10000','11110','10001','10001','01110'], '7':['11111','00001','00010','00100','01000','01000','01000'],
    '8':['01110','10001','10001','01110','10001','10001','01110'], '9':['01110','10001','10001','01111','00001','00001','01110']
  };
  function drawHud(id, text) {
    var element = $(id), dot = Math.min(3, Math.max(0.5, api.WIDTH * view.scale * 0.46 / (text.length * 6)));
    var dpr = Math.min(devicePixelRatio || 1, 2), key = text + ':' + dot + ':' + dpr;
    if (element.dataset.pixels === key) return;
    element.dataset.pixels = key; element.textContent = text; element.setAttribute('aria-label', text);
    var letters = document.createElement('canvas'); letters.setAttribute('aria-hidden', 'true');
    var width = (text.length * 6 - 1) * dot, height = 7 * dot;
    letters.width = Math.ceil(width * dpr); letters.height = Math.ceil(height * dpr);
    letters.style.width = width + 'px'; letters.style.height = height + 'px';
    var ink = letters.getContext('2d'); ink.scale(dpr, dpr); ink.fillStyle = '#e6cf9e';
    text.split('').forEach(function (character, column) {
      hudGlyphs[character].forEach(function (row, y) { row.split('').forEach(function (pixel, x) {
        if (pixel === '1') { ink.beginPath(); ink.arc((column * 6 + x + 0.5) * dot, (y + 0.5) * dot, dot * 0.36, 0, Math.PI * 2); ink.fill(); }
      }); });
    });
    element.appendChild(letters);
  }
  function renderLives() {
    if (shownLives === game.lives) return;
    shownLives = game.lives; $('lives').replaceChildren();
    fitLifeIcons();
    $('lives').setAttribute('aria-label', '备用 ' + Math.max(0, game.lives - 1) + ' 次机会');
    for (var i = 0; i < game.lives - 1; i++) {
      if (lifePortrait) { var img = document.createElement('img'); img.src = lifePortrait; img.alt = ''; $('lives').appendChild(img); }
      else { var fallback = document.createElement('canvas'); fallback.width = 28; fallback.height = 40;
        var c = fallback.getContext('2d'); c.fillStyle = '#efd3a0'; c.beginPath(); c.arc(14, 20, 10, 0, Math.PI * 2); c.fill(); $('lives').appendChild(fallback); }
    }
  }
  function captureLifePortrait() {
    // Capture once while upright, before flight orientation and spin start. Alpha stays transparent.
    scene.resize(96, 128); scene.tick(0);
    lifePortrait = pet.toDataURL('image/png'); scene.resize(128, 128);
    shownLives = -1; renderLives();
  }
  // Keep the controls in the scrolling dialog panel, including on small displays.
  $('overlay').querySelector('.panel').appendChild(document.querySelector('.model-controls'));
  $('overlay').querySelector('.panel').appendChild($('debug-controls'));
  $('overlay').querySelector('.panel').appendChild(document.querySelector('.model-controls:not(#debug-controls)'));
  $('debug-level').replaceChildren();
  api.LEVELS.forEach(function (level) {
    var option = document.createElement('option'); option.value = level.id; option.textContent = '第' + level.id + '关 · ' + level.name;
    $('debug-level').appendChild(option);
  });
  $('debug-controls').querySelector('legend').textContent = 'DEBUG · ' + api.levelCount() + ' 关';
  $('debug-controls').hidden = !debugMode;
  document.querySelector('.model-controls:not(#debug-controls)').hidden = !debugMode;
  if (debugMode) document.querySelector('.brand small').textContent = 'DEBUG · ' + api.levelCount() + ' LEVELS';
  var debugURL = new URL(location.href); debugURL.searchParams.delete('test');
  if (debugMode) debugURL.searchParams.delete('debug'); else debugURL.searchParams.set('debug', '1');
  var debugLink = document.createElement('a'); debugLink.id = 'debug-entry';
  debugLink.href = debugURL.href; debugLink.textContent = debugMode ? '返回正式游戏' : 'Debug 入口';
  $('overlay').querySelector('.panel').appendChild(debugLink);
  $('debug-level').onchange = function () {
    if (!debugMode || !game.selectLevel(Number(this.value), debugMode)) return;
    particles = []; clearTime = 0; flightBall = null; syncAppearance(); draw(0); pause(true); save();
  };
  function syncAppearance() {
    $('model-size').value = appearance.size; $('model-size-value').textContent = appearance.size;
    $('spin-speed').value = appearance.spin; $('spin-speed-value').textContent = appearance.spin;
    $('flight-speed').value = game.flightSpeed || 1; $('flight-speed-value').textContent = game.flightSpeed || 1;
    $('paddle-boost').value = game.paddleBoost === undefined ? 1.5 : game.paddleBoost;
    $('paddle-boost-value').textContent = $('paddle-boost').value;
  }
  function save() {
    try { var snapshot = game.snapshot(); snapshot.appearance = appearance;
      localStorage.setItem(saveKey, JSON.stringify(snapshot)); $('save-status').textContent = '进度已自动保存'; return true; }
    catch (_) { $('save-status').textContent = '无法保存进度，请检查浏览器存储空间或隐私设置。'; return false; }
  }
  var restored = false;
  try { var stored = JSON.parse(localStorage.getItem(saveKey)); restored = game.restore(stored);
    var savedAppearance = stored && stored.appearance;
    if (debugMode && savedAppearance && Number.isFinite(savedAppearance.size) && Number.isFinite(savedAppearance.spin)) {
      appearance.size = Math.max(30, Math.min(150, Math.round(savedAppearance.size / 5) * 5));
      appearance.spin = Math.max(0, Math.min(30, Math.round(savedAppearance.spin)));
    }
  }
  catch (_) { $('save-status').textContent = '存档无法读取，已开始新游戏。'; }
  if (!debugMode) { game.setFlightSpeed(1); game.setPaddleBoost(1.5); }
  syncAppearance();
  $('model-size').oninput = function () { if (!debugMode) return; appearance.size = Number(this.value); syncAppearance(); draw(0); save(); };
  $('spin-speed').oninput = function () { if (!debugMode) return; appearance.spin = Number(this.value); syncAppearance(); save(); };
  $('flight-speed').oninput = function () { if (!debugMode) return; game.setFlightSpeed(Number(this.value)); syncAppearance(); save(); };
  $('paddle-boost').oninput = function () { if (!debugMode) return; game.setPaddleBoost(Number(this.value)); syncAppearance(); save(); };
  function prepareFlightRig() {
    var THREE = scene.THREE, middle = scene.modelHeight / 2;
    flightRig = new THREE.Group(); flightRig.position.y = middle;
    var centered = new THREE.Group(); centered.position.y = -middle;
    scene.scene.add(flightRig); flightRig.add(centered); centered.add(scene.stage);
    heading = new THREE.Quaternion(); roll = new THREE.Quaternion();
    up = new THREE.Vector3(0, 1, 0); direction = new THREE.Vector3(0, 1, 0);
    // No idle chest tilt or pointer gaze: gaze remains perpendicular to the long axis.
    scene.motion.applyBreath = function () {};
    scene.camera.position.set(0, middle, scene.cameraDistance);
    scene.camera.lookAt(0, middle, 0);
    // Model-authored centers can cancel all root movement. Game springs simulate in world space.
    var manager = scene.avatar.vrm && scene.avatar.vrm.springBoneManager;
    if (manager) { manager.joints.forEach(function (joint) { joint.center = null; }); }
  }
  function updateFlight(dt) {
    if (game.paused) return;
    orientFlight();
    // CSS moves the canvas only. Move the actual rig too so the solver sees flight inertia;
    // move the camera by the same amount to keep the avatar centered inside its canvas.
    var unit = scene.modelHeight * 0.003;
    var x = (game.ball.x - api.WIDTH / 2) * unit;
    var y = (api.HEIGHT / 2 - game.ball.y) * unit;
    flightRig.position.set(x, scene.modelHeight / 2 + y, 0);
    scene.camera.position.set(x, scene.modelHeight / 2 + y, scene.cameraDistance);
    scene.camera.lookAt(x, scene.modelHeight / 2 + y, 0);
    scene.scene.updateMatrixWorld(true);
    // A new ball is a respawn, not a high-speed teleport across the arena.
    if (flightBall !== game.ball) {
      var manager = scene.avatar.vrm && scene.avatar.vrm.springBoneManager;
      if (manager) manager.reset();
      scene.motion.physicsAccumulator = 0; flightBall = game.ball;
    }
    scene.tick(dt);
  }
  function orientFlight() {
    if (!flightRig) return;
    var ball = game.ball;
    if (Math.hypot(ball.vx, ball.vy) > 0) direction.set(ball.vx, -ball.vy, 0).normalize();
    else direction.set(0, 1, 0);
    heading.setFromUnitVectors(up, direction);
    roll.setFromAxisAngle(up, angle);
    // Align model Y to flight, then spin around that axis, not around the screen normal.
    flightRig.quaternion.copy(heading).multiply(roll);
  }
  function fit() {
    var w = root.clientWidth, h = root.clientHeight;
    var side = w >= 720, margin = 16, top = side ? 110 : 242, bottom = 52;
    var availableW = Math.max(1, w - margin * 2 - (side ? 120 : 0));
    var availableH = Math.max(1, h - top - bottom);
    view.scale = Math.min(availableW / api.WIDTH, availableH / api.HEIGHT);
    view.x = margin + (side ? 120 : 0) + (availableW - api.WIDTH * view.scale) / 2;
    view.y = top + (availableH - api.HEIGHT * view.scale) / 2;
    var field = $('playfield');
    field.style.left = view.x + 'px'; field.style.top = view.y + 'px';
    field.style.width = api.WIDTH * view.scale + 'px'; field.style.height = api.HEIGHT * view.scale + 'px';
    $('game-hud').style.cssText = 'left:' + view.x + 'px;top:' + (view.y - 30) + 'px;width:' + api.WIDTH * view.scale + 'px';
    $('notice').style.top = (view.y + 12) + 'px';
    $('notice').style.right = (w - view.x - api.WIDTH * view.scale + 12) + 'px';
    var iconWidth = side ? Math.min(100, availableH / 4) : Math.min(100, (w - 32) / 3.06);
    $('lives').style.cssText = 'left:' + (side ? view.x - 120 : margin) + 'px;top:' + (side ? view.y : 72)
      + 'px;flex-direction:' + (side ? 'column' : 'row') + ';--life-width:' + iconWidth + 'px';
    fitLifeIcons();
    var dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(api.WIDTH * view.scale * dpr); canvas.height = Math.round(api.HEIGHT * view.scale * dpr);
    canvas.style.width = api.WIDTH * view.scale + 'px'; canvas.style.height = api.HEIGHT * view.scale + 'px';
    canvas.style.left = '0px'; canvas.style.top = '0px';
    ctx.setTransform(canvas.width / api.WIDTH, 0, 0, canvas.height / api.HEIGHT, 0, 0);
    drawHud('level', 'LEVEL:' + game.level); drawHud('score', 'RICE: ' + game.remainingRice());
  }
  function pause(value) {
    cancelResume();
    game.paused = value; $('overlay').hidden = !value;
    if (value) root.classList.remove('mouse-captured');
    if (value && document.pointerLockElement === canvas) document.exitPointerLock();
    var complete = game.phase === 'cleared' && game.level === api.levelCount();
    $('pause-title').textContent = complete ? (api.levelCount() === 2 ? '两关已全部通关' : '全部关卡已通关') : '休息一下';
    $('resume').hidden = complete;
    $('debug-level').value = game.level;
    if (value) { save(); renderTargets();
      if (complete) $('pause-copy').textContent = '目前的全部关卡已完成，可以选关重玩。';
      (complete ? $('restart') : $('resume')).focus(); }
    else $('pause').focus();
  }
  function renderTargets() {
    var list = $('sessions'); list.replaceChildren();
    targets.forEach(function (target) {
      var button = document.createElement('button');
      button.textContent = (target.kind === 'error' ? '✕ 任务失败' : target.kind === 'done' ? '✓ 任务完成' : '● 需要注意或授权') + ' · ' + target.id.slice(0, 12) + ' →';
      button.onclick = function () { openTarget(target); }; list.appendChild(button);
    });
    $('pause-copy').textContent = targets.length ? 'DSH 有新消息。游戏已经暂停，点击会话即可前往。' : '饭还热着，随时回来继续。';
  }
  function openTarget(target) {
    pause(true);
    if (testMode) { $('connection').textContent = '测试会话跳转成功：' + target.id; return; }
    if (!bridge) {
      // Our own query contract, consumed by the DSH client bridge; no guessed host router paths.
      var url = new URL('/', location.href); url.searchParams.set('vrmpet3d-session', target.id);
      var opened = globalThis.open(url.href, '_blank', 'noopener');
      // noopener may return null even on success, so do not interpret its return value as failure.
      return opened;
    }
    fetch('/vrmpet3d/desktop', { method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'same-origin', body: JSON.stringify({ action: 'game-session', sessionId: target.id }) })
      .then(function (r) { if (!r.ok) throw new Error('会话切换失败'); return r.json(); })
      .then(function (body) { if (!body.ok) throw new Error('该会话已不再等待处理'); bridge.focusHost(); })
      .catch(function (error) { $('connection').textContent = error.message + '，请重试。'; });
  }
  function poll() {
    statusRequest = new AbortController();
    var timeout = setTimeout(function () { statusRequest.abort(); }, 5000);
    fetch('/vrmpet3d/state', { credentials: 'same-origin', cache: 'no-store', signal: statusRequest.signal }).then(function (r) {
      if (!r.ok) throw new Error('status unavailable'); return r.json();
    }).then(function (state) {
      if (stopped) return;
      targets = api.notices(state);
      var next = new Set(), fresh = false;
      targets.forEach(function (t) { var key = t.kind + ':' + t.id; next.add(key); if (!seen.has(key)) fresh = true; });
      seen = next;
      // Error > attention/approval > completion, including mixed notifications.
      var kind = targets.some(function (t) { return t.kind === 'error'; }) ? 'error'
        : targets.some(function (t) { return t.kind === 'waiting'; }) ? 'waiting' : targets.length ? 'done' : '';
      root.dataset.noticeKind = kind;
      if (!kind) root.classList.remove('signal');
      if (fresh) { root.classList.remove('signal'); void root.offsetWidth; root.classList.add('signal'); }
      $('notice').hidden = !targets.length;
      $('notice').textContent = (kind === 'error' ? '任务失败' : kind === 'waiting' ? '需要注意或授权' : '任务完成')
        + ' · ' + targets.length + ' 个会话 · Esc 查看';
      var key = targets.map(function (t) { return t.kind + t.id; }).join('|');
      if (key !== noticeKey && game.paused) renderTargets(); noticeKey = key;
      $('connection').textContent = state.stale ? 'DSH 状态暂未更新；游戏仍可继续。' : 'DSH 已连接';
    }).catch(function () { $('connection').textContent = '暂时无法连接 DSH，正在重试。'; })
      .finally(function () { clearTimeout(timeout); if (!stopped) pollTimer = setTimeout(poll, 900); });
  }
  // Rice and porcelain are drawn locally; no image assets or network dependencies.
  var riceTextures = new Map(), bowlImages = new Map();
  function bowlImage(source) {
    if (!source) return null;
    if (!bowlImages.has(source)) {
      var record = {ready:false,image:new Image()}; bowlImages.set(source,record);
      record.image.onload = function () { record.ready = record.image.naturalWidth <= 2048 && record.image.naturalHeight <= 2048; };
      record.image.onerror = function () {}; record.image.src = source;
    }
    var record = bowlImages.get(source); return record.ready ? record.image : null;
  }
  function riceSeed(index) { return (Math.imul(index + 1, 2654435761) ^ Math.imul(game.level, 2246822519)) >>> 0; }
  function randomSource(seed) { return function () { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
  function riceVariant(index) { return riceSeed(index) % 3; }
  function looseRice(brick, index) {
    var palette = brick.riceStyle;
    var key = game.initialLayoutId + ':' + index, texture = riceTextures.get(key);
    if (!texture) {
      texture = document.createElement('canvas'); texture.width = 96; texture.height = 72;
      var c = texture.getContext('2d'), random = randomSource(riceSeed(index)), variant = riceVariant(index);
      var rx = [29, 32, 27][variant], ry = [21, 18, 24][variant], phase = random() * 6;
      c.translate(48, 36); c.beginPath();
      for (var i = 0; i <= 80; i++) {
        var a = i / 80 * Math.PI * 2, bump = 1 + 0.1 * Math.sin(a * 5 + phase) + 0.06 * Math.cos(a * 9 - phase);
        var x = Math.cos(a) * rx * bump, y = Math.sin(a) * ry * bump;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.closePath(); var shade = c.createLinearGradient(-20, -20, 24, 25);
      shade.addColorStop(0, palette.heapLight); shade.addColorStop(1, palette.heapDark); c.fillStyle = shade; c.fill();
      var grains = [];
      for (var grain = 0; grain < 125; grain++) {
        var theta = random() * Math.PI * 2, distance = Math.sqrt(random()) * (grain < 8 ? 1.2 : 1);
        grains.push({ x: Math.cos(theta) * distance * rx, y: Math.sin(theta) * distance * ry,
          angle: random() * 2.1 - 0.8, length: 3.1 + random() * 1.1, width: 1.2 + random() * 0.45, light: random() });
      }
      grains.sort(function (a, b) { return a.y - b.y; });
      grains.forEach(function (grain) {
        c.save(); c.translate(grain.x, grain.y); c.rotate(grain.angle);
        c.fillStyle = palette.shadow + '55'; c.beginPath(); c.ellipse(0.35, 0.6, grain.length, grain.width, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = grain.light > 0.2 ? palette.grain : palette.grainShade;
        c.beginPath(); c.ellipse(0, 0, grain.length, grain.width, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      });
      riceTextures.set(key, texture);
      if (riceTextures.size > 256) riceTextures.delete(riceTextures.keys().next().value);
    }
    var width = brick.w * 0.8, height = brick.h * 1.2;
    ctx.drawImage(texture, brick.x + (brick.w - width) / 2, brick.y + (brick.h - height) / 2, width, height);
  }
  function rice(brick, index) {
    if (brick.hp === 0) { if (brick.rice) looseRice(brick, index); return; }
    var style = brick.style, palette = brick.riceStyle;
    var x = brick.x + brick.w / 2, y = brick.y + brick.h * 0.45;
    var visualWidth = brick.w;
    ctx.save(); ctx.translate(x, y); ctx.scale(visualWidth / 95, brick.h / 40);
    // A rounded heap rises from inside the rim; the porcelain front covers its base.
    if (brick.rice && brick.hp > 0) {
      ctx.fillStyle = palette.fill; ctx.beginPath(); ctx.ellipse(0, -1, 35, 19, 0, 0, Math.PI * 2); ctx.fill();
      for (var grain = 0; grain < 30; grain++) {
        var gxHeap = Math.sin(grain * 2.399 + index) * (8 + grain % 5 * 4);
        var gyHeap = -3 - grain % 4 * 3;
        ctx.fillStyle = grain % 3 ? palette.highlight : palette.shade; ctx.beginPath(); ctx.ellipse(gxHeap, gyHeap, 3, 1.3, grain % 4 * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (brick.hp > 0) {
      ctx.fillStyle = style.color;
      var image = bowlImage(style.image);
      if (image) ctx.drawImage(image,-40,-2,80,28);
      else { ctx.beginPath(); ctx.moveTo(-40, 0);
        if (style.shape === 'flat') { ctx.lineTo(-22,25);ctx.lineTo(22,25);ctx.lineTo(40,0); }
        else { ctx.quadraticCurveTo(-31,25,0,25);ctx.quadraticCurveTo(31,25,40,0); }
        ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = style.rimColor; ctx.beginPath(); ctx.ellipse(0, 0, 37, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = style.baseColor; ctx.fillRect(-12, 23, 24, 3);
    }
    if (brick.rice) {
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 35, brick.hp > 0 ? 5 : 12, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = palette.fill; ctx.fillRect(-36, -13, 72, 26);
      for (var i = 0; i < 23; i++) {
        var gx = Math.sin(i * 2.399 + index) * (9 + i % 5 * 5), gy = (i % 3 - 1) * (brick.hp > 0 ? 2 : 6);
        ctx.fillStyle = i % 3 ? palette.highlight : palette.shade; ctx.beginPath(); ctx.ellipse(gx, gy, 3.5, 1.4, (i % 4) * 0.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (brick.hp > 0) {
      ctx.strokeStyle = style.edgeColor + 'b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 39, 6, 0, 0, Math.PI * 2); ctx.stroke();
      var damage = brick.maxHp - brick.hp;
      ctx.strokeStyle = style.crackColor; ctx.lineWidth = 2.5;
      if (damage > 0) { ctx.beginPath(); ctx.moveTo(-11, 4); ctx.lineTo(-6, 10); ctx.lineTo(-12, 15); ctx.lineTo(-5, 23); ctx.stroke(); }
      if (damage > 1) { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(8, 9); ctx.lineTo(13, 15); ctx.lineTo(4, 20); ctx.moveTo(8, 9); ctx.lineTo(1, 8); ctx.stroke(); }
    }
    ctx.restore();
  }
  function draw(dt) {
    ctx.clearRect(0, 0, api.WIDTH, api.HEIGHT);
    ctx.strokeStyle = '#afcdd512'; ctx.lineWidth = 1;
    for (var x = 30; x < api.WIDTH; x += 40) { ctx.beginPath(); ctx.moveTo(x, 82); ctx.lineTo(x, 680); ctx.stroke(); }
    ctx.strokeStyle = '#b6d5d430'; ctx.strokeRect(1, 1, api.WIDTH - 2, api.HEIGHT - 2);
    game.bricks.forEach(function (b, index) { if (b.alive) rice(b, index); });
    particles.forEach(function (p) {
      if (!game.paused) {
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += (p.type === 'shard' ? 520 : 180) * dt;
        if (p.type === 'shard') p.angle += p.spin * dt;
      }
    });
    particles = particles.filter(function (p) { return p.life > 0; });
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.min(1, p.life / (p.type === 'shard' ? 0.45 : 1)); ctx.fillStyle = p.color || '#ffe6af';
      if (p.type === 'shard') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle); ctx.beginPath();
        p.shape.forEach(function (point, i) { if (i) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]); });
        ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore();
      } else { ctx.beginPath(); ctx.ellipse(p.x, p.y, 3, 1.8, p.life * 4, 0, Math.PI * 2); ctx.fill(); }
    }); ctx.globalAlpha = 1;
    var p = game.paddle;
    ctx.shadowColor = '#e6c586'; ctx.shadowBlur = 16; ctx.fillStyle = '#efdaaf';
    ctx.beginPath(); ctx.roundRect(p.x - p.w / 2, p.y, p.w, p.h, 8); ctx.fill(); ctx.shadowBlur = 0;
    if (!modelReady) {
      ctx.fillStyle = '#f5d89f'; ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, game.ball.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#243d48'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('饭', game.ball.x, game.ball.y + 8);
    }
    if (game.phase === 'serve' || game.phase === 'cleared') {
      ctx.textAlign = 'center'; ctx.fillStyle = '#f6e7cb'; ctx.font = '20px "Microsoft YaHei",sans-serif';
      ctx.fillText(game.phase === 'cleared' ? (game.level === api.levelCount() ? '全部光盘！' : '这一桌，光盘！下一关…') : '左键发射 · 开饭！', 500, 610);
    }
    if (!game.paused && game.phase === 'playing') angle += dt * appearance.spin;
    var size = appearance.size * view.scale;
    pet.style.width = size + 'px'; pet.style.height = size + 'px';
    pet.style.left = game.ball.x * view.scale - size / 2 + 'px';
    pet.style.top = game.ball.y * view.scale - size / 2 + 'px';
    if (scene && modelReady) updateFlight(dt);
    var remaining = game.remainingRice();
    renderLives();
    drawHud('level', 'LEVEL:' + game.level);
    drawHud('score', 'RICE: ' + remaining);
  }
  function handleEvents(events) {
    events.forEach(function (event) {
      if (event.type === 'eat') for (var i = 0; i < 9; i++) particles.push({ x: event.x, y: event.y, vx: Math.cos(i * 2.4) * 100, vy: Math.sin(i * 2.4) * 100, life: 0.8 });
      if (event.type === 'break') {
        var random = randomSource(riceSeed(event.index || 0));
        var color = game.bricks[event.index || 0].color || '#f4f5f3';
        for (var shard = 0; shard < 9; shard++) {
          var size = 3 + random() * 5;
          particles.push({ type: 'shard', x: event.x + (random() - 0.5) * 24, y: event.y,
            vx: (random() - 0.5) * 260, vy: -70 - random() * 100, life: 1.2 + random() * 0.5,
            angle: random() * 6, spin: (random() - 0.5) * 14, color: color,
            shape: [[-size, -size * 0.3], [size * 0.3, -size * 0.65], [size, size * 0.4], [-size * 0.4, size * 0.7]] });
        }
      }
      if (event.type === 'cleared') clearTime = 1.5;
      if (event.type === 'run-reset') { particles = []; clearTime = 0; $('model-status').textContent = '机会已用完，已回到第1关重新开始。'; }
      save();
    });
  }
  function frame(time) {
    if (stopped) return;
    var dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0; lastTime = time;
    handleEvents(game.step(dt));
    advanceCleared(dt);
    saveTime += dt; if (saveTime >= 1) { saveTime = 0; save(); }
    draw(dt); frameId = requestAnimationFrame(frame);
  }
  function advanceCleared(dt) {
    if (game.phase === 'cleared' && !game.paused) {
      clearTime -= dt;
      if (clearTime <= 0) { if (!game.advance()) pause(true); save(); }
    }
  }
  function fullscreen() {
    if (!document.fullscreenElement) root.requestFullscreen().catch(function () { $('model-status').textContent = '可再次点击「全屏」进入全屏。'; });
    else document.exitFullscreen().catch(function () {});
  }
  function captureMouse() {
    if (document.pointerLockElement === canvas) return;
    if (!canvas.requestPointerLock) { pause(true); $('connection').textContent = '当前浏览器不支持鼠标捕获，请使用桌面浏览器。'; return; }
    try {
      var request = canvas.requestPointerLock();
      if (request && request.catch) request.catch(function () { pause(true); $('connection').textContent = '鼠标捕获失败，请点击继续重试。'; });
    } catch (_) { pause(true); $('connection').textContent = '鼠标捕获失败，请点击继续重试。'; }
  }
  document.addEventListener('pointerlockchange', function () {
    var locked = document.pointerLockElement === canvas;
    root.classList.toggle('mouse-captured', locked && (!game.paused || !!resumeEnd));
    if (locked && game.paused && !resumeEnd) document.exitPointerLock();
    else if (!locked && (!game.paused || resumeEnd)) pause(true);
  });
  document.addEventListener('pointerlockerror', function () { pause(true); $('connection').textContent = '鼠标捕获失败，请点击继续重试。'; });
  canvas.addEventListener('pointermove', function (event) {
    if (document.pointerLockElement === canvas) game.move(game.paddle.x + event.movementX / view.scale);
    else if (game.phase === 'serve') game.move((event.clientX - view.x) / view.scale);
  });
  canvas.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || game.paused) return;
    if (document.pointerLockElement !== canvas) game.move((event.clientX - view.x) / view.scale);
    game.launch(); captureMouse();
  });
  $('pause').onclick = function () { pause(!game.paused); };
  $('notice').onclick = function () { pause(true); };
  $('resume').onclick = beginResume;
  $('restart').textContent = '从第1关重新开始';
  $('restart').onclick = function () { game.reset(); particles = []; clearTime = 0; save(); pause(false); captureMouse(); };
  $('exit').onclick = function () {
    pause(true); if (!save()) return;
    gameWindowFocused = false; clearInterval(focusTimer);
    var released = reportGameFocus(false, true);
    if (bridge && typeof bridge.quit === 'function') {
      // Finish the local release first; a failed host must not prevent closing the game.
      Promise.race([Promise.resolve(released), new Promise(function (resolve) { setTimeout(resolve, 250); })])
        .then(function () { bridge.quit(); });
      return;
    }
    window.close();
    // A manually opened browser tab cannot always close itself.
    $('pause-title').textContent = '已保存，可以关闭此页';
    $('pause-copy').textContent = '下次打开会恢复当前进度。也可以点击继续吃饭。';
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  };
  if (testMode) {
    // Deterministic stepping for headless probes, whose compositor may skip animation frames.
    globalThis.__VRMPET3D_GAME_TEST__ = { countdown: function (elapsed) { if (resumeEnd) tickResume(resumeEnd - 3000 + elapsed); }, hitBowl: function (index, side) {
      var brick = game.bricks[index]; if (!brick || !brick.alive) return [];
      game.paused = false; $('overlay').hidden = true; game.launch(); brick.touching = false;
      game.ball.x = brick.x + brick.w / 2;
      game.ball.y = side === 'bottom' ? brick.y + brick.h + 24 : brick.y - 24;
      game.ball.vx = 0; game.ball.vy = game.speed() * (side === 'bottom' ? -1 : 1);
      var events = game.step(0.02); handleEvents(events); draw(0.02); save(); return events;
    }, effects: function (dt) {
      if (Number.isFinite(dt) && dt > 0 && dt <= 0.05) draw(dt);
    }, step: function (dt) {
      if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05) return [];
      var events = game.step(dt); handleEvents(events); advanceCleared(dt); draw(dt); save(); return events;
    } };
    $('test-controls').hidden = false;
    $('test-rice').onclick = function () {
      var index = game.bricks.findIndex(function (b) { return b.rice; });
      if (index >= 0) globalThis.__VRMPET3D_GAME_TEST__.hitBowl(index, 'top');
    };
    $('test-bowl').onclick = function () {
      // The bottommost bowl is reachable from below without passing through another row.
      for (var i = game.bricks.length - 1; i >= 0; i--) if (game.bricks[i].hp > 0) {
        globalThis.__VRMPET3D_GAME_TEST__.hitBowl(i, 'bottom'); break;
      }
    };
    $('connection').textContent = '独立测试模式 · 无需 DSH';
    $('test-loss').onclick = function () { game.paused = false; $('overlay').hidden = true; game.launch(); game.lose(); particles = []; renderLives(); save(); };
    $('test-clear').onclick = function () { game.bricks.forEach(function (b) { if (b.rice) { b.rice = false; b.alive = b.hp > 0; } }); game.finishLevel(); clearTime = 1.5; draw(0); save(); };
    $('test-notice').onclick = function () { targets = [{ id: 'standalone-test-session', kind: 'waiting' }]; pause(true); };
  }
  $('fullscreen').onclick = fullscreen;
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); pause(true); }
    // Keep keyboard focus inside the pause dialog.
    if (event.key === 'Tab' && game.paused) {
      var buttons = Array.from($('overlay').querySelectorAll('button,input,select,a')).filter(function (b) { return !b.hidden && b.getClientRects().length; });
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  // Browsers reserve Esc to leave fullscreen; that exit must pause the game too.
  document.addEventListener('fullscreenchange', function () { fit(); if (!document.fullscreenElement) pause(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause(true); lastTime = 0;
    reportGameFocus(!document.hidden && gameWindowFocused);
  });
  window.addEventListener('blur', function () { gameWindowFocused = false; pause(true); reportGameFocus(false); });
  window.addEventListener('focus', function () { gameWindowFocused = true; reportGameFocus(!document.hidden); });
  window.addEventListener('resize', fit);
  window.addEventListener('pagehide', function () {
    cancelResume(); clearInterval(focusTimer); reportGameFocus(false, true);
    save();
    stopped = true; clearTimeout(pollTimer); cancelAnimationFrame(frameId);
    if (statusRequest) statusRequest.abort(); if (scene) scene.dispose();
  });
  fit(); renderLives();
  if (!testMode) {
    poll(); reportGameFocus(gameWindowFocused && !document.hidden);
    focusTimer = setInterval(function () { if (gameWindowFocused && !document.hidden) reportGameFocus(true); }, 1000);
  }
  if (restored) pause(true); frameId = requestAnimationFrame(frame);
  // Snapshot the selected model; the game never writes model preferences or moves the pet's scene.
  Promise.all([
    fetch('/vrmpet3d/settings', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('无法读取模型设置'); return r.json(); }),
    fetch('/vrmpet3d/catalog', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('无法读取模型列表'); return r.json(); }),
    fetch('/vrmpet3d/motions', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('无法读取分发的弹簧骨默认参数'); return r.json(); }),
  ]).then(function (values) {
    if (stopped) return;
    var prefs = values[0].preferences || {}, models = values[1].models || [];
    var wanted = new URLSearchParams(location.search).get('model') || prefs.modelId;
    var model = models.find(function (m) { return m.id === wanted; }) || models[0];
    if (!model) throw new Error('还没有可用的桌宠模型');
    var locked = api.avatarPreferences(globalThis.__VRMPET3D_CORE__);
    var springDefaults = JSON.parse(JSON.stringify((values[2].springDefaults || {})[model.id] || {}));
    scene = new globalThis.__VRMPET3D_SCENE__.Scene(pet, { assetBase: '/vrmpet3d/asset', modelId: model.id,
      preferences: locked, onError: function () {} });
    scene.resize(128, 128);
    return scene.loadModel(model.id).then(function (status) {
      if (stopped) { scene.dispose(); return; }
      if (!status.ok) throw new Error(status.error || '模型加载失败');
      // These are per-game immutable snapshots; no settings polling or editing channel is mounted.
      Object.defineProperty(scene, 'preferences', { value: locked, writable: false, configurable: false });
      // Include chains missing from the catalog; every joint must have zero game gravity.
      (scene.springChainInfo || []).forEach(function (chain) {
        var key = chain.key || chain.name;
        springDefaults[key] = Object.assign({}, springDefaults[key], { gravityPower: 0 });
        chain.joints.forEach(function (entry) { entry.joint.settings.gravityPower = 0; });
      });
      Object.keys(springDefaults).forEach(function (key) { springDefaults[key].gravityPower = 0; });
      api.freeze(springDefaults);
      scene.setSpringDefaults(springDefaults);
      Object.defineProperty(scene, 'springDefaults', { value: springDefaults, writable: false, configurable: false });
      prepareFlightRig();
      captureLifePortrait();
      modelReady = true; $('model-status').textContent = ''; pet.hidden = false;
    });
  }).catch(function (error) { pet.hidden = true; $('model-status').textContent = '模型暂不可用，使用饭团球 · ' + error.message; });
  globalThis.__VRMPET3D_GAME_STATE__ = function () { return { phase: game.phase, paused: game.paused, level: game.level,
    lives: game.lives, flightSpeed: game.flightSpeed || 1,
    countdown: resumeEnd ? Number($('countdown-number').textContent) : 0,
    debug: debugMode, unlockedLevel: game.unlockedLevel, availableLevels: api.LEVELS.map(function (level) { return level.id; }),
    fragments: particles.filter(function (p) { return p.type === 'shard'; }).map(function (p) { return { x: p.x, y: p.y, vy: p.vy, angle: p.angle, life: p.life }; }),
    riceVariants: game.bricks.map(function (_, index) { return riceVariant(index); }),
    paddleBoost: game.paddleBoost === undefined ? 1.5 : game.paddleBoost, mouseCaptured: document.pointerLockElement === canvas,
    paddleX: game.paddle.x,
    ball: { x: game.ball.x, y: game.ball.y, vx: game.ball.vx, vy: game.ball.vy }, appearance: { size: appearance.size, spin: appearance.spin },
    remaining: game.remainingRice(), bowls: game.bricks.map(function (b) { return { x: b.x, y: b.y, w: b.w, h: b.h, hp: b.hp, color: b.color, rice: b.rice, alive: b.alive }; }), modelReady: modelReady, targets: targets.length,
    avatar: modelReady ? { locked: Object.isFrozen(scene.preferences) && Object.isFrozen(scene.springDefaults),
      lookAtPointer: scene.preferences.lookAtPointer, expression: scene.expressionApplied.TiePen,
      body: up.clone().applyQuaternion(flightRig.quaternion).toArray(),
      gaze: new scene.THREE.Vector3(0, 0, 1).applyQuaternion(flightRig.quaternion).toArray(),
      direction: direction.toArray(), angle: angle,
      physics: { enabled: scene.motion.physicsEnabled, error: scene.motion.physicsError || null,
        position: flightRig.position.toArray(),
        joints: (scene.springChainInfo || []).flatMap(function (chain) { return chain.joints.map(function (entry) { return entry.joint.bone.quaternion.toArray(); }); }) },
      gravity: (scene.springChainInfo || []).flatMap(function (chain) { return chain.joints.map(function (entry) { return entry.joint.settings.gravityPower; }); }),
      springs: (scene.springChainInfo || []).map(function (chain) { var settings = chain.joints[0].joint.settings;
        return { key: chain.key || chain.name, stiffness: settings.stiffness, dragForce: settings.dragForce, gravityPower: settings.gravityPower }; }) } : null }; };
})();

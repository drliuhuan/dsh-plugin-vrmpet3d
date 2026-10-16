(function () {
  'use strict';
  var api = globalThis.__VRMPET3D_DEV_MINI_GAME__, game = new api.Game();
  var $ = function (id) { return document.getElementById(id); };
  var root = $('game'), canvas = $('arena'), ctx = canvas.getContext('2d'), pet = $('pet');
  var scene = null, modelReady = false, stopped = false, frameId, pollTimer, statusRequest, lastTime = 0;
  var view = { scale: 1, x: 0, y: 0 }, angle = 0, particles = [], targets = [], seen = new Set();
  var noticeKey = '', clearTime = 0, bridge = globalThis.vrmpet3dDevDesktop;
  function fit() {
    var w = root.clientWidth, h = root.clientHeight;
    view.scale = Math.min(w / api.WIDTH, h / api.HEIGHT);
    view.x = (w - api.WIDTH * view.scale) / 2; view.y = (h - api.HEIGHT * view.scale) / 2;
    var dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(api.WIDTH * view.scale * dpr); canvas.height = Math.round(api.HEIGHT * view.scale * dpr);
    canvas.style.width = api.WIDTH * view.scale + 'px'; canvas.style.height = api.HEIGHT * view.scale + 'px';
    canvas.style.left = view.x + 'px'; canvas.style.top = view.y + 'px';
    ctx.setTransform(canvas.width / api.WIDTH, 0, 0, canvas.height / api.HEIGHT, 0, 0);
  }
  function pause(value) {
    game.paused = value; $('overlay').hidden = !value;
    $('pause-title').textContent = game.phase === 'over' ? '吃饱前，再试一次？' : '休息一下';
    $('resume').hidden = game.phase === 'over';
    if (value) { renderTargets(); (game.phase === 'over' ? $('restart') : $('resume')).focus(); }
    else $('pause').focus();
  }
  function renderTargets() {
    var list = $('sessions'); list.replaceChildren();
    targets.forEach(function (target) {
      var button = document.createElement('button');
      button.textContent = (target.kind === 'done' ? '✓ 任务完成' : '● 需要处理') + ' · ' + target.id.slice(0, 12) + ' →';
      button.onclick = function () { openTarget(target); }; list.appendChild(button);
    });
    $('pause-copy').textContent = targets.length ? 'DSH 有新消息。游戏已经暂停，点击会话即可前往。' : '饭还热着，随时回来继续。';
  }
  function openTarget(target) {
    pause(true);
    if (!bridge) {
      // Our own query contract, consumed by the DSH client bridge; no guessed host router paths.
      var url = new URL('/', location.href); url.searchParams.set('vrmpet3d-dev-session', target.id);
      var opened = globalThis.open(url.href, '_blank', 'noopener');
      // noopener may return null even on success, so do not interpret its return value as failure.
      return opened;
    }
    fetch('/vrmpet3d-dev/desktop', { method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'omit', body: JSON.stringify({ action: 'game-session', sessionId: target.id }) })
      .then(function (r) { if (!r.ok) throw new Error('会话切换失败'); return r.json(); })
      .then(function (body) { if (!body.ok) throw new Error('该会话已不再等待处理'); bridge.focusHost(); })
      .catch(function (error) { $('connection').textContent = error.message + '，请重试。'; });
  }
  function poll() {
    statusRequest = new AbortController();
    var timeout = setTimeout(function () { statusRequest.abort(); }, 5000);
    fetch('/vrmpet3d-dev/state', { credentials: 'omit', cache: 'no-store', signal: statusRequest.signal }).then(function (r) {
      if (!r.ok) throw new Error('status unavailable'); return r.json();
    }).then(function (state) {
      if (stopped) return;
      targets = api.notices(state);
      var next = new Set(), fresh = false;
      targets.forEach(function (t) { var key = t.kind + ':' + t.id; next.add(key); if (!seen.has(key)) fresh = true; });
      seen = next;
      if (fresh) { root.classList.remove('signal'); void root.offsetWidth; root.classList.add('signal'); }
      $('notice').hidden = !targets.length;
      $('notice').textContent = targets.length + ' 个 DSH 会话有消息 · Esc 查看';
      var key = targets.map(function (t) { return t.kind + t.id; }).join('|');
      if (key !== noticeKey && game.paused) renderTargets(); noticeKey = key;
      $('connection').textContent = state.stale ? 'DSH 状态暂未更新；游戏仍可继续。' : 'DSH 已连接';
    }).catch(function () { $('connection').textContent = '暂时无法连接 DSH，正在重试。'; })
      .finally(function () { clearTimeout(timeout); if (!stopped) pollTimer = setTimeout(poll, 900); });
  }
  // Rice and porcelain are drawn locally; no image assets or network dependencies.
  function rice(brick, index) {
    var x = brick.x + brick.w / 2, y = brick.y + 18;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#f6eedb'; ctx.beginPath(); ctx.ellipse(0, -5, 37, 15, 0, Math.PI, 0); ctx.fill();
    for (var i = 0; i < 17; i++) {
      var gx = Math.sin(i * 2.399 + index) * (9 + i % 5 * 5), gy = -7 - (i % 3) * 3;
      ctx.fillStyle = i % 3 ? '#fff9ed' : '#dfd5be'; ctx.beginPath(); ctx.ellipse(gx, gy, 3.5, 1.4, (i % 4) * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = ['#b9d5cf', '#d7bd91', '#b6c8df'][index % 3];
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.quadraticCurveTo(-31, 25, 0, 25); ctx.quadraticCurveTo(31, 25, 40, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#effaf180'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 39, 4, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#739c9e'; ctx.fillRect(-12, 23, 24, 3); ctx.restore();
  }
  function draw(dt) {
    ctx.clearRect(0, 0, api.WIDTH, api.HEIGHT);
    ctx.strokeStyle = '#afcdd512'; ctx.lineWidth = 1;
    for (var x = 30; x < api.WIDTH; x += 40) { ctx.beginPath(); ctx.moveTo(x, 82); ctx.lineTo(x, 680); ctx.stroke(); }
    ctx.strokeStyle = '#b6d5d430'; ctx.strokeRect(1, 73, 998, 624);
    game.bricks.forEach(function (b, index) { if (b.alive) rice(b, index); });
    particles = particles.filter(function (p) { return p.life > 0; });
    particles.forEach(function (p) {
      if (!game.paused) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; }
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = '#ffe6af'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 3, 1.8, p.life * 4, 0, Math.PI * 2); ctx.fill();
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
      ctx.fillText(game.phase === 'cleared' ? '这一桌，光盘！下一关…' : '左键发射 · 开饭！', 500, 530);
    }
    if (!game.paused && game.phase === 'playing') angle += dt * 15;
    var size = 60 * view.scale;
    pet.style.width = size + 'px'; pet.style.height = size + 'px';
    pet.style.left = view.x + game.ball.x * view.scale - size / 2 + 'px';
    pet.style.top = view.y + game.ball.y * view.scale - size / 2 + 'px';
    pet.style.transform = 'rotate(' + angle + 'rad)';
    if (scene && modelReady) scene.tick(game.paused ? 0 : dt);
    $('score').textContent = '第 ' + game.level + ' 关  /  ' + game.score + ' 分  /  ' + '♥'.repeat(game.lives);
  }
  function frame(time) {
    if (stopped) return;
    var dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0; lastTime = time;
    game.step(dt).forEach(function (event) {
      if (event.type === 'eat') for (var i = 0; i < 9; i++) particles.push({ x: event.x, y: event.y, vx: Math.cos(i * 2.4) * 100, vy: Math.sin(i * 2.4) * 100, life: 0.8 });
      if (event.type === 'cleared') clearTime = 1.5;
      if (event.type === 'lost' && game.phase === 'over') pause(true);
    });
    if (game.phase === 'cleared' && !game.paused) { clearTime -= dt; if (clearTime <= 0) game.advance(); }
    draw(dt); frameId = requestAnimationFrame(frame);
  }
  function fullscreen() {
    if (!document.fullscreenElement) root.requestFullscreen().catch(function () { $('model-status').textContent = '可再次点击「全屏」进入全屏。'; });
    else document.exitFullscreen().catch(function () {});
  }
  canvas.addEventListener('pointermove', function (event) { game.move((event.clientX - view.x) / view.scale); });
  canvas.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || game.paused) return;
    if (!bridge && !document.fullscreenElement && game.phase === 'serve') fullscreen();
    game.move((event.clientX - view.x) / view.scale); game.launch();
  });
  $('pause').onclick = function () { pause(!game.paused); };
  $('notice').onclick = function () { pause(true); };
  $('resume').onclick = function () { pause(false); };
  $('restart').onclick = function () { game.reset(); particles = []; clearTime = 0; pause(false); };
  $('fullscreen').onclick = fullscreen;
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); pause(game.phase === 'over' || !game.paused); }
    // Keep keyboard focus inside the pause dialog.
    if (event.key === 'Tab' && game.paused) {
      var buttons = Array.from($('overlay').querySelectorAll('button')).filter(function (b) { return !b.hidden; });
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  // Browsers reserve Esc to leave fullscreen; that exit must pause the game too.
  document.addEventListener('fullscreenchange', function () { fit(); if (!document.fullscreenElement) pause(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(true); lastTime = 0; });
  window.addEventListener('blur', function () { pause(true); });
  window.addEventListener('resize', fit);
  window.addEventListener('pagehide', function () {
    stopped = true; clearTimeout(pollTimer); cancelAnimationFrame(frameId);
    if (statusRequest) statusRequest.abort(); if (scene) scene.dispose();
  });
  fit(); poll(); frameId = requestAnimationFrame(frame);
  // Snapshot the selected model; the game never writes model preferences or moves the pet's scene.
  Promise.all([
    fetch('/vrmpet3d-dev/settings', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('无法读取模型设置'); return r.json(); }),
    fetch('/vrmpet3d-dev/catalog', { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('无法读取模型列表'); return r.json(); }),
  ]).then(function (values) {
    if (stopped) return;
    var prefs = values[0].preferences || {}, models = values[1].models || [];
    var wanted = new URLSearchParams(location.search).get('model') || prefs.modelId;
    var model = models.find(function (m) { return m.id === wanted; }) || models[0];
    if (!model) throw new Error('还没有可用的桌宠模型');
    scene = new globalThis.__VRMPET3D_DEV_SCENE__.Scene(pet, { assetBase: '/vrmpet3d-dev/asset', modelId: model.id,
      preferences: Object.assign({}, prefs, { sway: 0, lookAt: false }), onError: function () {} });
    scene.resize(128, 128);
    return scene.loadModel(model.id).then(function (status) {
      if (stopped) { scene.dispose(); return; }
      if (!status.ok) throw new Error(status.error || '模型加载失败');
      modelReady = true; $('model-status').textContent = ''; pet.hidden = false;
    });
  }).catch(function (error) { pet.hidden = true; $('model-status').textContent = '模型暂不可用，使用饭团球 · ' + error.message; });
  globalThis.__VRMPET3D_DEV_GAME_STATE__ = function () { return { phase: game.phase, paused: game.paused, level: game.level,
    score: game.score, lives: game.lives, remaining: game.bricks.filter(function (b) { return b.alive; }).length, modelReady: modelReady, targets: targets.length }; };
})();

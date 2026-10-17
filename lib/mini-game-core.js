// Standalone deterministic breakout rules; no DSH, DOM or pet state dependencies.
(function () {
  'use strict';
  var W = 1000, H = 750, R = 21, PY = 692;
  var clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };
  var LETTERS = {
    D: ['110','101','101','101','110'],
    S: ['111','100','111','001','111'],
    '-': ['000','000','111','000','000'],
    B: ['110','101','110','101','110'],
    A: ['010','101','111','101','101'],
    L: ['100','100','100','100','111']
  };
  var WIDE_LETTERS = {
    D: ['1111110','1100011','1100011','1100011','1111110'],
    S: ['0111111','1100000','0111110','0000011','1111110']
  };
  var remoteLevels = null, builtinIds = null;
  var defaultRice = {heapLight:'#fffdf1',heapDark:'#ddd9ca',grain:'#fffdf4',grainShade:'#e8e4d5',shadow:'#a8a593',fill:'#f6eedb',highlight:'#fff9ed',shade:'#dfd5be'};
  function isColor(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
  function normalizeLevels(manifest) {
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.levels) || !manifest.levels.length || manifest.levels.length > 100) return null;
    var total = 0, levels = [];
    for (var i = 0; i < manifest.levels.length; i++) {
      var level = manifest.levels[i], styles = {}, rice = {};
      if (!level || level.id !== i + 1 || typeof level.name !== 'string' || !level.name.trim() || level.name.length > 80
        || !level.resources || !level.resources.bowls || !level.resources.rice
        || !Array.isArray(level.bricks) || !level.bricks.length || level.bricks.length > 1000 || (total += level.bricks.length) > 10000) return null;
      for (var key of Object.keys(defaultRice)) {
        if (!isColor(level.resources.rice[key])) return null; rice[key] = level.resources.rice[key];
      }
      var names = Object.keys(level.resources.bowls);
      if (names.length > 100) return null;
      for (var name of names) {
        var style = level.resources.bowls[name], clean = {};
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name) || !style || !['round','flat'].includes(style.shape)) return null;
        for (var key of ['color','rimColor','baseColor','edgeColor','crackColor']) {
          if (!isColor(style[key])) return null; clean[key] = style[key];
        }
        if (style.image !== null && (typeof style.image !== 'string' || style.image.length > 131072
          || !/^data:image\/(png|webp|jpeg);base64,[a-zA-Z0-9+/]+=*$/.test(style.image))) return null;
        clean.shape = style.shape; clean.image = style.image; styles[name] = clean;
      }
      var bricks = [];
      for (var j = 0; j < level.bricks.length; j++) {
        var b = level.bricks[j];
        if (!b || !['x','y','w','h'].every(function (k) { return Number.isFinite(b[k]); })
          || b.x < 0 || b.y < 0 || b.w < 8 || b.w > 150 || b.h < 4 || b.h > 100 || b.x + b.w > W || b.y + b.h > 600
          || !Number.isInteger(b.hp) || b.hp < 0 || b.hp > 10 || typeof b.rice !== 'boolean' || (!b.hp && !b.rice)
          || (b.bowl !== null && !Object.prototype.hasOwnProperty.call(styles,b.bowl)) || (b.hp > 0 && b.bowl === null)) return null;
        bricks.push({x:b.x,y:b.y,w:b.w,h:b.h,hp:b.hp,rice:b.rice,bowl:b.bowl});
      }
      if (!bricks.some(function (b) { return b.rice; })) return null;
      levels.push({id:level.id,name:level.name,resources:{bowls:styles,rice:rice},bricks:bricks});
    }
    return {version:1,levels:levels};
  }
  function setLevels(manifest) {
    var clean; try { clean = normalizeLevels(manifest); } catch (_) { return false; } if (!clean) return false;
    if (!builtinIds) { builtinIds = []; for (var i=1;i<=2;i++) { var g = new Game(); g.level=i;g.buildLevel();builtinIds.push(g.initialLayoutId); } }
    remoteLevels = freeze(clean.levels);
    api.LEVELS = remoteLevels.map(function (level) { return {id:level.id,name:level.name}; }); return true;
  }
  function levelCount() { return remoteLevels ? remoteLevels.length : 2; }
  function layoutId(bricks) {
    var text = JSON.stringify(bricks.map(function (b) { return [b.x,b.y,b.w,b.h,b.maxHp,b.rice,b.style,b.riceStyle]; })), hash = 2166136261;
    for (var i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
    return (hash >>> 0).toString(16);
  }
  function finishBuild(game) {
    game.bricks.forEach(function (b) {
      if (!b.style) b.style = {color:b.color || '#f4f5f3',rimColor:'#253d43',baseColor:game.level===1?'#d7dcda':'#739c9e',edgeColor:'#effaf1',crackColor:'#34474e',shape:'round',image:null};
      if (!b.riceStyle) b.riceStyle = defaultRice;
    });
    game.initialLayoutId = layoutId(game.bricks);game.phase='serve';game.readyBall();
  }
  function Game() { this.reset(); }
  Game.prototype.reset = function () {
    this.level = 1; this.lives = 3; this.paused = false;
    this.unlockedLevel = clamp(this.unlockedLevel || 1, 1, levelCount());
    this.paddle = { x: W / 2, y: PY, w: 150, h: 16 };
    this.buildLevel();
  };
  Game.prototype.buildLevel = function () {
    if (!Number.isInteger(this.level) || this.level < 1 || this.level > levelCount()) this.level = 1;
    this.paddle.x = W / 2;
    this.bricks = [];
    if (remoteLevels) {
      this.bricks = remoteLevels[this.level - 1].bricks.map(function (b) {
        var resources = remoteLevels[this.level - 1].resources, style = b.bowl === null ? null : resources.bowls[b.bowl];
        return Object.assign({}, b, {maxHp:b.hp,alive:true,touching:false,style:style,color:style ? style.color : undefined,riceStyle:resources.rice});
      }, this);
      finishBuild(this); return;
    }
    if (this.level === 1) {
      var bricks = this.bricks;
      ['DS', 'BALL'].forEach(function (line, lineIndex) {
        var offset = 0, left = 82;
        line.split('').forEach(function (letter) {
          (lineIndex === 0 ? WIDE_LETTERS[letter] : LETTERS[letter]).forEach(function (row, y) { row.split('').forEach(function (pixel, x) {
            if (pixel === '1') bricks.push({ x: left + (offset + x) * 56, y: 112 + lineIndex * 208 + y * 32,
              w: 52, h: 26, alive: true, rice: true, hp: 1, maxHp: 1, color: '#f4f5f3', touching: false });
          }); });
          offset += lineIndex === 0 ? 8 : 4;
        });
      });
      finishBuild(this); return;
    }
    for (var row = 0; row < 8; row++) {
      var count = [6, 10, 12, 14, 14, 16, 16, 16][row], start = (16 - count) / 2;
      for (var col = start; col < start + count; col++) this.bricks.push({ x: 60 + col * 55.5 + (row % 2 ? 0 : 2),
        y: 8 + row * 24, w: 52, h: 26, alive: true, rice: true, hp: 0, maxHp: 0, touching: false });
    }
    for (var row = 0; row < 12; row++) {
      var count = [16, 16, 16, 15, 14, 13, 12, 10, 8, 6, 4, 4][row], start = (16 - count) / 2;
      var color = Math.floor(row / 2) % 2 === 0 ? '#244c9c' : '#f4f5f3';
      for (var col = start; col < start + count; col++) this.bricks.push({ x: 60 + col * 55.5,
        y: 204 + row * 23, w: 52, h: 26, alive: true, rice: false, hp: 1, maxHp: 1, color: color, touching: false });
    }
    finishBuild(this);
  };
  Game.prototype.readyBall = function () {
    this.bricks.forEach(function (brick) { brick.touching = false; });
    this.hitMultiplier = 1;
    this.ball = { x: this.paddle.x, y: PY - R - 3, vx: 0, vy: 0, r: R };
  };
  Game.prototype.move = function (x) {
    if (this.paused) return;
    this.paddle.x = clamp(x, this.paddle.w / 2 + 12, W - this.paddle.w / 2 - 12);
    if (this.phase === 'serve') this.ball.x = this.paddle.x;
  };
  Game.prototype.launch = function () {
    if (this.paused || this.phase !== 'serve') return;
    this.phase = 'playing';
    var speed = this.speed();
    this.ball.vx = speed * 0.28; this.ball.vy = -speed * Math.sqrt(1 - 0.28 * 0.28);
  };
  Game.prototype.speed = function () { return Math.min(4000, Math.min(850, 390 + this.level * 32) * (this.flightSpeed || 1) * (this.hitMultiplier || 1)); };
  Game.prototype.setPaddleBoost = function (percent) {
    if (Number.isFinite(percent)) this.paddleBoost = clamp(percent, 0, 20);
  };
  Game.prototype.setFlightSpeed = function (value) {
    if (!Number.isFinite(value)) return;
    var old = this.speed(); this.flightSpeed = clamp(value, 0.5, 2);
    var ratio = this.speed() / old;
    this.ball.vx *= ratio; this.ball.vy *= ratio;
  };
  Game.prototype.advance = function () {
    if (this.phase !== 'cleared' || this.level >= levelCount()) return false;
    this.level++; this.unlockedLevel = Math.max(this.unlockedLevel, this.level); this.buildLevel(); return true;
  };
  Game.prototype.finishLevel = function () {
    if (this.phase === 'cleared' || this.remainingRice() !== 0) return false;
    this.phase = 'cleared'; this.lives = Math.min(10, this.lives + 1);
    this.unlockedLevel = Math.max(this.unlockedLevel, Math.min(levelCount(), this.level + 1)); return true;
  };
  Game.prototype.selectLevel = function (level, debug) {
    if (!Number.isInteger(level) || level < 1 || level > levelCount() || (debug !== true && level > this.unlockedLevel)) return false;
    this.level = level; this.buildLevel(); return true;
  };
  Game.prototype.lose = function () {
    if (this.paused || this.phase !== 'playing') return [];
    this.lives--;
    var reset = this.lives === 0;
    if (reset) this.reset();
    else { this.phase = 'serve'; this.readyBall(); }
    return [{ type: reset ? 'run-reset' : 'lost' }];
  };
  Game.prototype.snapshot = function () {
    return JSON.parse(JSON.stringify({ version: 8, layoutId: this.initialLayoutId, level: this.level, unlockedLevel: this.unlockedLevel,
      lives: this.lives, phase: this.phase, flightSpeed: this.flightSpeed || 1,
      paddleBoost: this.paddleBoost === undefined ? 1.5 : this.paddleBoost, hitMultiplier: this.hitMultiplier || 1,
      paddleX: this.paddle.x, ball: this.ball, alive: this.bricks.map(function (b) { return b.alive; }),
      bowls: this.bricks.map(function (b) { return { hp: b.hp, rice: b.rice, touching: b.touching }; }) }));
  };
  Game.prototype.remainingRice = function () { return this.bricks.filter(function (brick) { return brick.rice; }).length; };
  Game.prototype.restore = function (save) {
    if (!save || ![1, 2, 3, 4, 5, 6, 7, 8].includes(save.version) || !Number.isSafeInteger(save.level) || save.level < 1 || save.level > 1000000
      || (save.unlockedLevel !== undefined && (!Number.isInteger(save.unlockedLevel) || save.unlockedLevel < 1 || save.unlockedLevel > 100))
      || !Number.isInteger(save.lives) || save.lives < 1 || save.lives > 10
      || !['serve', 'playing', 'cleared'].includes(save.phase)
      || !Number.isFinite(save.paddleX) || save.paddleX < 87 || save.paddleX > 913) return false;
    var multiplier = save.flightSpeed === undefined ? 1 : save.flightSpeed;
    if (!Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 2) return false;
    var candidate = new Game(); candidate.flightSpeed = multiplier; candidate.level = save.level; candidate.buildLevel();
    var boost = save.paddleBoost === undefined ? 1.5 : save.paddleBoost;
    var hits = save.hitMultiplier === undefined ? 1 : save.hitMultiplier;
    if (!Number.isFinite(boost) || boost < 0 || boost > 20 || !Number.isFinite(hits) || hits < 1 || hits > 100) return false;
    candidate.paddleBoost = boost; candidate.hitMultiplier = hits;
    candidate.unlockedLevel = Math.min(levelCount(), Math.max(save.unlockedLevel || 1, save.level, save.phase === 'cleared' ? save.level + 1 : 1));
    // Earlier builds had a procedural level two and unfinished later levels.
    if (save.version < 7 && save.level >= 2) {
      candidate.level = save.level === 2 ? 2 : 1; candidate.buildLevel(); candidate.paused = true;
      Object.assign(this, candidate); return true;
    }
    if (save.version >= 7 && save.level > levelCount()) return false;
    if ((save.layoutId && save.layoutId !== candidate.initialLayoutId) || (!save.layoutId && remoteLevels && builtinIds[save.level - 1] !== candidate.initialLayoutId)) {
      candidate.lives = save.lives; candidate.paused = true; Object.assign(this, candidate); return true;
    }
    var allowedCounts = save.version >= 7 ? [candidate.bricks.length]
      : [candidate.bricks.length, Math.min(7, 2 + save.level) * 8, Math.min(14, 4 + save.level * 2) * 16];
    if (!Array.isArray(save.alive) || !allowedCounts.includes(save.alive.length)
      || save.alive.some(function (v) { return typeof v !== 'boolean'; })) return false;
    var bowls = save.version >= 4 ? save.bowls : save.alive.map(function (alive) {
      return { hp: alive ? 1 : 0, rice: alive, touching: false };
    });
    if (!Array.isArray(bowls) || bowls.length !== save.alive.length || bowls.some(function (b, i) {
      return !b || !Number.isInteger(b.hp) || b.hp < 0 || b.hp > (save.version >= 7 ? candidate.bricks[i].maxHp : 1)
        || typeof b.rice !== 'boolean' || typeof b.touching !== 'boolean' || save.alive[i] !== (b.hp > 0 || b.rice);
    }) || (save.phase === 'cleared') !== bowls.every(function (b) { return !b.rice; })) return false;
    // Layout upgrades retain bowl/rice state in reading order. A completed old layout advances.
    if (bowls.length !== candidate.bricks.length) {
      if (save.phase === 'cleared') {
        candidate.phase = 'cleared'; candidate.advance(); candidate.paused = true; Object.assign(this, candidate); return true;
      }
      var oldBowls = bowls;
      bowls = candidate.bricks.map(function (_, i) { return Object.assign({}, oldBowls[Math.floor(i * oldBowls.length / candidate.bricks.length)], { touching: false }); });
      if (!bowls.some(function (b) { return b.rice; })) bowls[bowls.length - 1].rice = true;
    }
    var b = save.ball && Object.assign({}, save.ball);
    if (b && save.version === 1 && save.phase === 'serve' && b.y === 619) b.y = PY - R - 3;
    if (!b || !['x', 'y', 'vx', 'vy'].every(function (k) { return Number.isFinite(b[k]); })
      || b.r !== R || b.x < 0 || b.x > W || b.y < 0 || b.y > H + R + 10
      || Math.hypot(b.vx, b.vy) > candidate.speed() + 1
      || (save.phase === 'serve' && (b.vx !== 0 || b.vy !== 0 || b.x !== save.paddleX || b.y !== PY - R - 3))) return false;
    candidate.lives = save.lives; candidate.phase = save.phase;
    candidate.paddle.x = save.paddleX; candidate.ball = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: R };
    candidate.bricks.forEach(function (brick, i) { Object.assign(brick, bowls[i], { alive: bowls[i].hp > 0 || bowls[i].rice }); });
    Object.assign(this, candidate); this.paused = true; return true;
  };
  // Circle against rectangle, with overlap correction so a brick cannot trap a ball.
  function hit(ball, rect) {
    var dx = ball.x - clamp(ball.x, rect.x, rect.x + rect.w);
    var dy = ball.y - clamp(ball.y, rect.y, rect.y + rect.h);
    var d = Math.hypot(dx, dy);
    if (d > ball.r) return false;
    var nx, ny, depth;
    if (d > 0.00001) { nx = dx / d; ny = dy / d; depth = ball.r - d; }
    else {
      var faces = [ball.x - rect.x, rect.x + rect.w - ball.x, ball.y - rect.y, rect.y + rect.h - ball.y];
      var face = faces.indexOf(Math.min.apply(Math, faces));
      nx = face === 0 ? -1 : face === 1 ? 1 : 0;
      ny = face === 2 ? -1 : face === 3 ? 1 : 0;
      depth = ball.r + faces[face];
    }
    ball.x += nx * (depth + 0.01); ball.y += ny * (depth + 0.01);
    var dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vy -= 2 * dot * ny; }
    return dot < 0 ? { nx: nx, ny: ny } : false;
  }
  Game.prototype.step = function (dt) {
    if (this.paused || this.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return [];
    // At most 4px travel per substep, including at the maximum level speed.
    dt = Math.min(dt, 0.05);
    var b = this.ball, events = [], steps = Math.ceil(this.speed() * 1.2 * dt / 4), slice = dt / steps;
    for (var i = 0; i < steps && this.phase === 'playing'; i++) {
      var previousY = b.y;
      b.x += b.vx * slice; b.y += b.vy * slice;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
      if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
      if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); }
      var p = this.paddle;
      if (b.vy > 0 && previousY + R <= PY && b.y + R >= PY && Math.abs(b.x - p.x) <= p.w / 2 + R * 0.6) {
        this.hitMultiplier = Math.min(100, (this.hitMultiplier || 1) * (1 + (this.paddleBoost === undefined ? 1.5 : this.paddleBoost) / 100));
        var angle = clamp((b.x - p.x) / (p.w / 2), -1, 1) * Math.PI / 3;
        b.vx = this.speed() * Math.sin(angle); b.vy = -this.speed() * Math.cos(angle);
        b.y = PY - R - 0.01; events.push({ type: 'paddle' });
      }
      for (var j = 0; j < this.bricks.length; j++) {
        var brick = this.bricks[j];
        if (!brick.alive) continue;
        var separation = Math.hypot(b.x - clamp(b.x, brick.x, brick.x + brick.w), b.y - clamp(b.y, brick.y, brick.y + brick.h));
        if (separation > b.r + 0.5) brick.touching = false;
        var incomingY = b.vy, contactX = b.x, contact = hit(b, brick);
        if (contact) {
          if (brick.touching) continue;
          brick.touching = true;
          var point = { x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 };
          var mouth = contact.ny < -0.5 && incomingY > 0 && contactX >= brick.x + 4 && contactX <= brick.x + brick.w - 4;
          if (brick.rice && (brick.hp === 0 || mouth)) {
            brick.rice = false;
            events.push({ type: 'eat', x: point.x, y: point.y });
          } else if (brick.hp > 0) {
            brick.hp--;
            events.push({ type: brick.hp === 0 ? 'break' : 'crack', x: point.x, y: point.y, index: j });
          }
          brick.alive = brick.hp > 0 || brick.rice;
          if (this.finishLevel()) events.push({ type: 'cleared' });
          break;
        }
      }
      if (b.y - R > H) {
        events = events.concat(this.lose());
      }
    }
    return events;
  };
  // The game only reads the host's existing status channel. Never acknowledges a pet notice.
  function notices(state) {
    if (!state || state.stale || !state.why) return [];
    var why = state.why, result = [], seen = new Set();
    function add(id, kind) {
      if (typeof id !== 'string' || !id || seen.has(id)) return;
      seen.add(id); result.push({ id: id, kind: kind });
    }
    if (state.state === 'error') add(why.statusSessionId, 'error');
    (why.waitingSessionIds || []).forEach(function (id) { add(id, 'waiting'); });
    if (state.state === 'waiting') add(why.statusSessionId, 'waiting');
    (why.completedSessionIds || []).forEach(function (id) { add(id, 'done'); });
    if (state.state === 'done') add(why.statusSessionId, 'done');
    return result;
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(function (key) { freeze(value[key]); }); Object.freeze(value);
    }
    return value;
  }
  // Game configuration never inherits user-edited pet springs, camera or expression settings.
  function avatarPreferences(core) {
    return freeze(core.cleanPreferences({ physics: true, sway: 0, lookAtPointer: false,
      yaw: 0, viewYaw: 0, viewPitch: 0, springs: {}, motions: {}, motion: false,
      expressions: { weights: { TiePen: 1 }, blink: { enabled: false }, emotion: { enabled: false } } }));
  }
  var api = { DEBUG: false, LEVELS: [{ id: 1, name: 'DS / BALL' }, { id: 2, name: '蓝白大碗' }],
    normalizeLevels: normalizeLevels, setLevels: setLevels, levelCount: levelCount, Game: Game, WIDTH: W, HEIGHT: H, notices: notices, freeze: freeze, avatarPreferences: avatarPreferences };
  globalThis.__VRMPET3D_MINI_GAME__ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

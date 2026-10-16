// Standalone deterministic breakout rules; no DSH, DOM or pet state dependencies.
(function () {
  'use strict';
  var W = 1000, H = 700, R = 21, PY = 642;
  var clamp = function (n, a, b) { return Math.max(a, Math.min(b, n)); };
  function Game() { this.reset(); }
  Game.prototype.reset = function () {
    this.level = 1; this.score = 0; this.lives = 3; this.paused = false;
    this.paddle = { x: W / 2, y: PY, w: 150, h: 16 };
    this.buildLevel();
  };
  Game.prototype.buildLevel = function () {
    this.bricks = [];
    var rows = Math.min(7, 2 + this.level), cols = 8;
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      this.bricks.push({ x: 64 + x * 111, y: 112 + y * 53, w: 95, h: 40, alive: true });
    }
    this.phase = 'serve'; this.readyBall();
  };
  Game.prototype.readyBall = function () {
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
  Game.prototype.speed = function () { return Math.min(850, 390 + this.level * 32); };
  Game.prototype.advance = function () {
    if (this.phase !== 'cleared') return;
    this.level++; this.buildLevel();
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
    return true;
  }
  Game.prototype.step = function (dt) {
    if (this.paused || this.phase !== 'playing' || !Number.isFinite(dt) || dt <= 0) return [];
    // At most 4px travel per substep, including at the maximum level speed.
    dt = Math.min(dt, 0.05);
    var b = this.ball, events = [], steps = Math.ceil(this.speed() * dt / 4), slice = dt / steps;
    for (var i = 0; i < steps && this.phase === 'playing'; i++) {
      var previousY = b.y;
      b.x += b.vx * slice; b.y += b.vy * slice;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
      if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
      if (b.y < 70 + R) { b.y = 70 + R; b.vy = Math.abs(b.vy); }
      var p = this.paddle;
      if (b.vy > 0 && previousY + R <= PY && b.y + R >= PY && Math.abs(b.x - p.x) <= p.w / 2 + R * 0.6) {
        var angle = clamp((b.x - p.x) / (p.w / 2), -1, 1) * Math.PI / 3;
        b.vx = this.speed() * Math.sin(angle); b.vy = -this.speed() * Math.cos(angle);
        b.y = PY - R - 0.01; events.push({ type: 'paddle' });
      }
      for (var j = 0; j < this.bricks.length; j++) {
        var brick = this.bricks[j];
        if (brick.alive && hit(b, brick)) {
          brick.alive = false; this.score += 10;
          events.push({ type: 'eat', x: brick.x + brick.w / 2, y: brick.y + brick.h / 2 });
          if (!this.bricks.some(function (entry) { return entry.alive; })) {
            this.phase = 'cleared'; events.push({ type: 'cleared' });
          }
          break;
        }
      }
      if (b.y - R > H) {
        this.lives--; this.phase = this.lives > 0 ? 'serve' : 'over';
        this.readyBall(); events.push({ type: 'lost' });
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
    (why.waitingSessionIds || []).forEach(function (id) { add(id, 'waiting'); });
    if (state.state === 'waiting' || state.state === 'error') add(why.statusSessionId, 'waiting');
    (why.completedSessionIds || []).forEach(function (id) { add(id, 'done'); });
    if (state.state === 'done') add(why.statusSessionId, 'done');
    return result;
  }
  var api = { Game: Game, WIDTH: W, HEIGHT: H, notices: notices };
  globalThis.__VRMPET3D_MINI_GAME__ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

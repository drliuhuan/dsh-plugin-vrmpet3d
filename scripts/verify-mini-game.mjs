import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context = vm.createContext({ console });
vm.runInContext(readFileSync(new URL('../lib/mini-game-core.js', import.meta.url), 'utf8'), context);
const { Game, notices } = context.__VRMPET3D_MINI_GAME__;
let count = 0;
function check(name, run) { run(); count++; console.log('PASS ' + name); }
check('serve follows the clamped paddle; launch has constant speed', () => {
  const g = new Game(); g.move(-900); assert.equal(g.paddle.x, 87); assert.equal(g.ball.x, 87);
  g.launch(); assert.equal(g.phase, 'playing'); assert.ok(Math.abs(Math.hypot(g.ball.vx, g.ball.vy) - g.speed()) < 0.001);
});
check('pause freezes position, input and launching', () => {
  const g = new Game(); g.paused = true; const before = JSON.stringify(g);
  g.move(100); g.launch(); g.step(0.05); assert.equal(JSON.stringify(g), before);
});
check('side walls and ceiling reflect inward', () => {
  const g = new Game(); g.launch(); g.ball.x = 22; g.ball.y = 450; g.ball.vx = -400; g.ball.vy = 0;
  g.step(0.02); assert.ok(g.ball.vx > 0 && g.ball.x >= 21);
  g.ball.x = 980; g.ball.vx = 400; g.step(0.02); assert.ok(g.ball.vx < 0);
  g.ball.y = 22; g.ball.x = 500; g.ball.vx = 0; g.ball.vy = -400;
  g.step(0.02); assert.ok(g.ball.vy > 0);
});
check('paddle steers the ball with a bounded upward angle', () => {
  const g = new Game(); g.launch(); g.ball.x = 550; g.ball.y = g.paddle.y - 24; g.ball.vx = 0; g.ball.vy = 400;
  const events = g.step(0.025); assert.ok(events.some(e => e.type === 'paddle'));
  assert.ok(g.ball.vy < 0 && g.ball.vx > 0); assert.ok(Math.abs(Math.hypot(g.ball.vx, g.ball.vy) - g.speed()) < 0.001);
  assert.ok(Math.abs(g.speed() - 422 * 1.015) < 0.001);
});
check('top impact eats rice and clears with the empty bowl still intact', () => {
  const g = new Game();
  g.bricks.forEach((b, i) => { b.alive = i === 0; b.rice = i === 0; if (i !== 0) b.hp = 0; });
  g.launch(); const b = g.bricks[0]; g.ball.x = b.x + b.w / 2; g.ball.y = b.y - 23;
  g.ball.vx = 0; g.ball.vy = g.speed();
  const events = g.step(0.05); assert.ok(events.some(e => e.type === 'eat'));
  assert.equal('score' in g, false); assert.equal(g.phase, 'cleared');
  assert.equal(b.hp, 1); assert.equal(b.alive, true); assert.equal(b.rice, false);
  g.advance(); assert.equal(g.level, 2); assert.equal(g.phase, 'serve'); assert.equal(g.bricks.length, 238);
});
check('chances carry across levels and exhausting them restarts the entire run', () => {
  const g = new Game();
  g.selectLevel(2, true); g.bricks[0].alive = false; g.bricks[0].hp = 0; g.bricks[0].rice = false;
  g.launch(); g.ball.y = 780; g.step(0.01);
  assert.equal(g.lives, 2); assert.equal(g.bricks[0].alive, false);
  for (let i = 0; i < 2; i++) { g.launch(); g.ball.y = 780; g.step(0.01); }
  assert.equal(g.level, 1); assert.equal(g.lives, 3);
  assert.equal(g.phase, 'serve'); assert.ok(g.bricks.every(b => b.alive));
  g.selectLevel(2, true); g.lives = 1; g.phase = 'cleared'; assert.equal(g.advance(), false); assert.equal(g.level, 2);
  g.reset();
  for (let i = 0; i < 3; i++) { g.launch(); g.ball.y = 780; g.step(0.01); }
  assert.equal(g.lives, 3); assert.equal(g.phase, 'serve');
  g.reset(); assert.equal(g.lives, 3); assert.equal(g.phase, 'serve'); assert.equal('score' in g, false);
});
check('saved game round trips exact progress and resumes paused', () => {
  const g = new Game(); g.bricks[0].alive = false; g.bricks[0].rice = false; g.bricks[0].hp = 0; g.lives = 2; g.launch(); g.step(0.02);
  const saved = g.snapshot(), restored = new Game();
  assert.equal(restored.restore(saved), true); assert.equal(restored.paused, true);
  assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(saved));
  restored.paused = false; g.step(0.02); restored.step(0.02);
  assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(g.snapshot()));
  const before = JSON.stringify(restored);
  for (const bad of [null, {}, { ...saved, lives: 0 }, { ...saved, level: Infinity }, { ...saved, alive: [] },
    { ...saved, bowls: [] }, { ...saved, ball: { ...saved.ball, x: NaN } }]) {
    assert.equal(restored.restore(bad), false); assert.equal(JSON.stringify(restored), before);
  }
});
check('long frames are capped and invalid deltas are harmless', () => {
  const a = new Game(), b = new Game(); a.launch(); b.launch(); a.step(99); b.step(0.05);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); const before = JSON.stringify(a);
  a.step(NaN); a.step(-1); assert.equal(JSON.stringify(a), before);
});
check('notifications prioritize attention, deduplicate and reject stale reports', () => {
  const state = { state: 'waiting', why: { waitingSessionIds: ['a', 'b'], completedSessionIds: ['a', 'c'], statusSessionId: 'b' } };
  assert.equal(JSON.stringify(notices(state)), JSON.stringify([{ id: 'a', kind: 'waiting' }, { id: 'b', kind: 'waiting' }, { id: 'c', kind: 'done' }]));
  state.stale = true; assert.equal(notices(state).length, 0); assert.equal(notices(null).length, 0);
  state.stale = false; state.state = 'error'; state.why.statusSessionId = 'a';
  assert.equal(JSON.stringify(notices(state)), JSON.stringify([{ id: 'a', kind: 'error' }, { id: 'b', kind: 'waiting' }, { id: 'c', kind: 'done' }]));
});
check('flight speed scales current velocity, collisions and saved games', () => {
  const g = new Game(); g.launch(); const before = g.speed(); g.setFlightSpeed(1.5);
  assert.equal(g.speed(), before * 1.5); assert.ok(Math.abs(Math.hypot(g.ball.vx, g.ball.vy) - g.speed()) < 0.001);
  const restored = new Game(); assert.equal(restored.restore(g.snapshot()), true); assert.equal(restored.flightSpeed, 1.5);
  restored.paused = false; restored.ball.x = restored.paddle.x; restored.ball.y = restored.paddle.y - 24; restored.ball.vx = 0; restored.ball.vy = restored.speed();
  assert.ok(restored.step(0.025).some(e => e.type === 'paddle'));
  assert.ok(Math.abs(Math.hypot(restored.ball.vx, restored.ball.vy) - restored.speed()) < 0.001);
  const legacy = g.snapshot(); delete legacy.flightSpeed; legacy.ball.vx /= 1.5; legacy.ball.vy /= 1.5;
  assert.equal(new Game().restore(legacy), true);
  g.setFlightSpeed(99); assert.equal(g.flightSpeed, 2); g.setFlightSpeed(0); assert.equal(g.flightSpeed, 0.5);
  const snapshot = g.snapshot(); g.setFlightSpeed(NaN); assert.equal(JSON.stringify(g.snapshot()), JSON.stringify(snapshot));
});
check('4:3 arena keeps original bowl positions and migrates old serve saves', () => {
  const { WIDTH, HEIGHT } = context.__VRMPET3D_MINI_GAME__;
  assert.equal(WIDTH / HEIGHT, 4 / 3);
  const g = new Game(); assert.equal(g.bricks[0].y, 112);
  const old = g.snapshot(); old.version = 1; old.ball.y = 619;
  const restored = new Game(); assert.equal(restored.restore(old), true);
  assert.equal(restored.ball.y, restored.paddle.y - restored.ball.r - 3);
  assert.equal(restored.lives, 3); assert.equal(restored.paused, true);
});
check('paddle boost compounds, supports zero, survives save and resets on a lost chance', () => {
  const g = new Game(); g.setPaddleBoost(5); g.launch();
  const bounce = () => { g.ball.x = g.paddle.x; g.ball.y = g.paddle.y - 24; g.ball.vx = 0; g.ball.vy = g.speed(); g.step(0.025); };
  bounce(); bounce(); assert.ok(Math.abs(g.speed() - 422 * 1.05 ** 2) < 0.001);
  const restored = new Game(); assert.equal(restored.restore(g.snapshot()), true);
  assert.equal(restored.paddleBoost, 5); assert.equal(restored.speed(), g.speed());
  g.setPaddleBoost(0); const before = g.speed(); bounce(); assert.equal(g.speed(), before);
  g.lose(); assert.equal(g.speed(), 422); assert.equal(g.paddleBoost, 0);
  g.setPaddleBoost(99); assert.equal(g.paddleBoost, 20); g.setPaddleBoost(NaN); assert.equal(g.paddleBoost, 20);
});
check('level two uses approved blue-white bowl layout and migrates old procedural saves', () => {
  const g = new Game(); g.selectLevel(2, true); assert.equal(g.bricks.length, 238);
  assert.equal(g.bricks[0].w, 52); assert.equal(g.bricks[0].h, 26);
  assert.equal(g.remainingRice(), 104); assert.equal(g.bricks.filter(b => b.hp === 1).length, 134);
  assert.ok(g.bricks.filter(b => b.hp).every(b => ['#244c9c', '#f4f5f3'].includes(b.color)));
  assert.ok(g.bricks.filter(b => b.y >= 434).every(b => b.color === '#f4f5f3'));
  assert.equal(g.bricks.filter(b => b.y === 434).length, 4); assert.equal(g.bricks.filter(b => b.y === 457).length, 4);
  const old = g.snapshot(); old.version = 2; old.alive = Array(32).fill(true); old.alive[9] = false; old.score = 10; old.lives = 2;
  const restored = new Game(); assert.equal(restored.restore(old), true);
  assert.equal('score' in restored, false); assert.equal(restored.lives, 3); assert.equal(restored.remainingRice(), 104);
  old.alive.fill(false); old.phase = 'cleared'; old.score = 240;
  assert.equal(restored.restore(old), true); assert.equal(restored.level, 2); assert.equal('score' in restored.snapshot(), false); assert.equal(restored.phase, 'serve');
});
function isolated(level = 1) {
  const g = new Game(); g.level = level; g.buildLevel();
  Object.assign(g.bricks[0], { hp: 1, maxHp: 1, rice: true });
  // Other bowls keep their rice but are moved clear of the test target.
  g.bricks.forEach((b, i) => { if (i) { b.x = 900; b.y = 450; } });
  g.bricks[0].x = 400; g.bricks[0].y = 300; g.launch(); return g;
}
function strike(g, side) {
  const b = g.bricks[0]; g.ball.x = b.x + b.w / 2; g.ball.y = b.y - 24;
  g.ball.vx = 0; g.ball.vy = g.speed();
  if (side === 'bottom') { g.ball.y = b.y + b.h + 24; g.ball.vy = -g.speed(); }
  if (side === 'left') { g.ball.x = b.x - 24; g.ball.y = b.y + b.h / 2; g.ball.vx = g.speed(); g.ball.vy = 0; }
  return g.step(0.02);
}
check('white bowl breaks on one body hit and leaves edible rice without points', () => {
  const g = isolated(); const events = strike(g, 'bottom');
  assert.ok(events.some(e => e.type === 'break')); assert.equal(g.bricks[0].hp, 0);
  assert.equal(g.bricks[0].rice, true); assert.equal(g.remainingRice(), 79); assert.equal('score' in g, false);
  assert.ok(strike(g, 'left').some(e => e.type === 'eat'));
  assert.equal(g.remainingRice(), 78); assert.equal(g.bricks[0].alive, false);
});
check('top rice hit preserves bowl; empty bowl top hit breaks without points', () => {
  const g = isolated(2); assert.ok(strike(g, 'top').some(e => e.type === 'eat'));
  assert.equal(g.bricks[0].hp, 1); assert.equal('score' in g, false);
  assert.ok(strike(g, 'top').some(e => e.type === 'break')); assert.equal(g.bricks[0].alive, false);
  assert.equal('score' in g.snapshot(), false); assert.equal(g.phase, 'playing');
});
check('broken bowls and loose rice round trip; touching cannot consume twice', () => {
  const g = isolated(2); strike(g, 'bottom');
  const hp = g.bricks[0].hp; g.step(0.001); assert.equal(g.bricks[0].hp, hp);
  // Save against the standard layout, since the fixture moved test geometry only.
  const restored = new Game(); assert.equal(restored.restore(g.snapshot()), true);
  assert.equal(restored.bricks[0].hp, 0); assert.equal(restored.bricks[0].rice, true);
  assert.equal(restored.bricks[0].touching, g.bricks[0].touching);
  const bad = g.snapshot(); bad.bowls[0].hp = 9; assert.equal(restored.restore(bad), false);
});
check('2:1 bowls spell wide DS above BALL, with each top letter spanning two lower letters', () => {
  const g = new Game();
  const actual = Array.from({ length: 10 }, (_, row) => Array.from({ length: 15 }, (_, x) =>
    g.bricks.some(b => b.x === 82 + x * 56 && b.y === 112 + Math.floor(row / 5) * 208 + row % 5 * 32) ? '#' : '.').join('')).join('\n');
  const expected = [
    '######...######', '##...##.##.....', '##...##..#####.', '##...##......##', '######..######.',
    '##...#..#...#..', '#.#.#.#.#...#..', '##..###.#...#..', '#.#.#.#.#...#..', '##..#.#.###.###'
  ].join('\n');
  assert.equal(actual, expected); assert.equal(g.remainingRice(), 79);
  assert.equal(g.bricks[0].w, 52); assert.equal(g.bricks[0].w / g.bricks[0].h, 2);
  assert.ok(g.bricks.every(b => b.hp === 1));
  const legacy = g.snapshot(); legacy.version = 4; legacy.score = 999; legacy.levelScore = 100;
  const restored = new Game(); assert.equal(restored.restore(legacy), true);
  assert.equal('score' in restored, false); assert.equal('levelScore' in restored.snapshot(), false);
});
check('debug exposes exactly two levels and selection preserves settings without creating level three', () => {
  const api = context.__VRMPET3D_MINI_GAME__;
  assert.equal(api.DEBUG, false); assert.equal(JSON.stringify(api.LEVELS.map(l => l.id)), '[1,2]');
  const g = new Game(); g.setFlightSpeed(1.5); g.setPaddleBoost(5); g.paused = true;
  assert.equal(g.selectLevel(2, true), true); assert.equal(g.remainingRice(), 104); assert.equal(g.lives, 3);
  assert.equal(g.paused, true); assert.equal(g.flightSpeed, 1.5); assert.equal(g.paddleBoost, 5);
  const restored = new Game(); assert.equal(restored.restore(g.snapshot()), true);
  assert.equal(restored.level, 2); assert.equal(restored.remainingRice(), 104);
  const before = JSON.stringify(g); assert.equal(g.selectLevel(3, true), false); assert.equal(JSON.stringify(g), before);
  g.phase = 'cleared'; assert.equal(g.advance(), false); assert.equal(g.level, 2);
  assert.equal(g.selectLevel(1), true); assert.equal(g.remainingRice(), 79);
});
check('each clear grants one chance up to ten, saved and never reset by level building', () => {
  const g = new Game(); g.lives = 8;
  g.bricks.forEach(b => { b.rice = false; });
  assert.equal(g.finishLevel(), true); assert.equal(g.lives, 9);
  assert.equal(g.finishLevel(), false); assert.equal(g.lives, 9);
  g.advance(); assert.equal(g.lives, 9); assert.equal(g.level, 2);
  const restored = new Game(); assert.equal(restored.restore(g.snapshot()), true); assert.equal(restored.lives, 9);
  g.bricks.forEach(b => { b.rice = false; b.alive = b.hp > 0; });
  assert.equal(g.finishLevel(), true); assert.equal(g.lives, 10);
  g.selectLevel(1); assert.equal(g.lives, 10);
  g.bricks.forEach(b => { b.rice = false; });g.finishLevel();assert.equal(g.lives, 10);
  const bad=g.snapshot();bad.lives=11;assert.equal(restored.restore(bad),false);
});
check('production rejects locked levels and clears unlock only the next level', () => {
  const g=new Game();const before=JSON.stringify(g);assert.equal(g.selectLevel(2),false);assert.equal(JSON.stringify(g),before);
  g.bricks.forEach(b=>{b.rice=false;});assert.equal(g.finishLevel(),true);assert.equal(g.unlockedLevel,2);
  assert.equal(g.selectLevel(2),true);assert.equal(g.selectLevel(3),false);
});
check('unlocked progress persists through saves, run exhaustion and old-save migration',()=>{
  const g=new Game();g.bricks.forEach(b=>{b.rice=false;});g.finishLevel();g.advance();
  const restored=new Game();assert.equal(restored.restore(g.snapshot()),true);assert.equal(restored.unlockedLevel,2);
  restored.lives=1;restored.paused=false;restored.launch();restored.lose();assert.equal(restored.level,1);assert.equal(restored.unlockedLevel,2);
  const legacy=g.snapshot();delete legacy.unlockedLevel;assert.equal(restored.restore(legacy),true);assert.equal(restored.unlockedLevel,2);
  const bad=g.snapshot();bad.unlockedLevel=999;assert.equal(restored.restore(bad),false);
});
console.log(`mini-game: ${count} passed`);

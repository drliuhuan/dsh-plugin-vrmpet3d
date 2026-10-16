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
  g.ball.y = 92; g.ball.x = 500; g.ball.vx = 0; g.ball.vy = -400;
  g.step(0.02); assert.ok(g.ball.vy > 0);
});
check('paddle steers the ball with a bounded upward angle', () => {
  const g = new Game(); g.launch(); g.ball.x = 550; g.ball.y = 618; g.ball.vx = 0; g.ball.vy = 400;
  const events = g.step(0.025); assert.ok(events.some(e => e.type === 'paddle'));
  assert.ok(g.ball.vy < 0 && g.ball.vx > 0); assert.ok(Math.abs(Math.hypot(g.ball.vx, g.ball.vy) - g.speed()) < 0.001);
});
check('a fast ball eats one brick and clears into the next level', () => {
  const g = new Game(); g.level = 30; g.buildLevel();
  g.bricks.forEach((b, i) => { b.alive = i === 0; });
  g.launch(); const b = g.bricks[0]; g.ball.x = b.x + b.w / 2; g.ball.y = b.y + b.h + 25;
  g.ball.vx = 0; g.ball.vy = -850;
  const events = g.step(0.05); assert.ok(events.some(e => e.type === 'eat'));
  assert.equal(g.score, 10); assert.equal(g.phase, 'cleared');
  g.advance(); assert.equal(g.level, 31); assert.equal(g.phase, 'serve'); assert.equal(g.bricks.length, 56);
});
check('missing the paddle consumes exactly one life; restart resets the run', () => {
  const g = new Game();
  for (let i = 0; i < 3; i++) { g.launch(); g.ball.y = 730; g.step(0.01); }
  assert.equal(g.lives, 0); assert.equal(g.phase, 'over'); g.launch(); assert.equal(g.phase, 'over');
  g.reset(); assert.equal(g.lives, 3); assert.equal(g.phase, 'serve'); assert.equal(g.score, 0);
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
});
console.log(`mini-game: ${count} passed`);

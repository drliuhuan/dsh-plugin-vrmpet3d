#!/usr/bin/env node
/**
 * Unit tests for lib/core.js — the pure logic shared by the client half.
 *
 * Run:  node scripts/verify.mjs
 *
 * These run under plain Node with no DOM and no three.js. That is the point of
 * keeping core.js free of both: the parts most likely to be wrong (state
 * precedence, fall physics, framing maths, path safety) are testable in
 * milliseconds and do not need a browser or a GPU.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// lib/core.js is a classic script (an IIFE that publishes `__VRMPET3D_CORE__`), not
// an ES module, because the browser half loads it with `<script src>`. This
// package declares `"type": "module"`, so Node would parse it as ESM if we
// imported it by path — hence the side-effect import through a file: URL and the
// read back off the global it publishes. That is the same contract the browser
// relies on, so the test would catch a rename of the global too.
await import(pathToFileURL(resolve(ROOT, 'lib', 'core.js')).href);
const core = globalThis.__VRMPET3D_CORE__;
if (!core) {
  console.error('lib/core.js did not publish globalThis.__VRMPET3D_CORE__');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}`);
  }
}

function eq(actual, expected, label) {
  const same = Object.is(actual, expected);
  if (!same) {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    passed += 1;
  }
}

function near(actual, expected, tolerance, label) {
  const same = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (!same) {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}\n        expected ${expected} ±${tolerance}, got ${actual}`);
  } else {
    passed += 1;
  }
}

/**
 * Structural equality for the objects this module rebuilds on every call.
 *
 * `eq` compares with Object.is — reference equality for objects — so a preference map or a motion
 * map has to be compared by serialisation instead.
 */
function same(actual, expected, label) {
  eq(JSON.stringify(actual), JSON.stringify(expected), label);
}

function group(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
group('1. format detection');
// ---------------------------------------------------------------------------
{
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0, 0, 0]).buffer;
  eq(core.detectFormat(glb), 'glb', 'GLB magic "glTF" detected');

  /**
   * The two MMD magic numbers are still RECOGNISED, deliberately, although MMD is implementation-removed
   * (2026-10-12): recognition is what lets the renderer refuse a `.pmx`/`.pmd` BY NAME rather than report
   * "unknown format". What must be gone is every list that would OFFER one — see group 2 (extensions) and
   * the catalog and route checks in `verify-model.mjs`.
   */
  const pmx = new Uint8Array([0x50, 0x4d, 0x58, 0x20, 0x00, 0x00, 0x00, 0x80]).buffer;
  eq(core.detectFormat(pmx), 'pmx', 'PMX magic "PMX " is still detected, so a refusal can name it');

  const pmd = new Uint8Array([0x50, 0x6d, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00]).buffer;
  eq(core.detectFormat(pmd), 'pmd', 'PMD magic "Pmd\\0" is still detected, for the same reason');

  const gltf = new TextEncoder().encode('{"asset":{"version":"2.0"}}').buffer;
  eq(core.detectFormat(gltf), 'gltf', 'JSON glTF detected from leading brace');

  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b]).buffer;
  eq(core.detectFormat(bom), 'gltf', 'BOM-prefixed glTF detected');

  eq(core.detectFormat(new Uint8Array([1, 2]).buffer), 'unknown', 'short buffer is unknown');
  eq(core.detectFormat(new ArrayBuffer(0)), 'unknown', 'empty buffer is unknown');
  eq(core.detectFormat(null), 'unknown', 'null is unknown');
  eq(core.detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), 'unknown', 'PNG is not a model');
}

// ---------------------------------------------------------------------------
group('2. model file recognition and path sanitising');
// ---------------------------------------------------------------------------
{
  ok(core.isModelFile('foo.vrm'), '.vrm recognised');
  ok(core.isModelFile('A/B/C.VRM'), 'uppercase .VRM recognised');
  ok(core.isModelFile('x.glb?rev=1'), 'query string stripped before matching');
  ok(!core.isModelFile('foo.txt'), '.txt rejected');
  ok(!core.isModelFile('foo'), 'extensionless rejected');
  ok(!core.isModelFile(undefined), 'undefined rejected');
  /**
   * And the half that decides what a user is OFFERED. MMD is implementation-removed (2026-10-12): the
   * extension list is VRM/glTF only, so a `.pmx`/`.pmd` is neither catalogued nor servable. The magic
   * numbers above are still recognised, which is what turns "nothing to show" into a refusal that can
   * name the format instead.
   */
  eq(core.MODEL_EXTENSIONS.join(','), '.vrm,.glb,.gltf', 'the model extension list is VRM and glTF only');
  eq(core.MODEL_EXTENSIONS.indexOf('.pmx'), -1, '.pmx is not a model extension');
  eq(core.MODEL_EXTENSIONS.indexOf('.pmd'), -1, 'and neither is .pmd');
  eq(core.isModelFile('x.pmx'), false, 'so isModelFile refuses a PMX');
  eq(core.isModelFile('x.pmd'), false, 'and a PMD');

  eq(core.sanitizeRelativePath('tex/body.png'), 'tex/body.png', 'plain relative path kept');
  eq(core.sanitizeRelativePath('./tex/../tex/a.png'), 'tex/a.png', 'inner dot segments normalised');
  eq(core.sanitizeRelativePath('a\\b\\c.png'), 'a/b/c.png', 'backslashes normalised');
  eq(core.sanitizeRelativePath('../../etc/passwd'), null, 'parent traversal rejected');
  eq(core.sanitizeRelativePath('a/../../b'), null, 'nested traversal rejected');
  eq(core.sanitizeRelativePath('/etc/passwd'), null, 'absolute path rejected');
  eq(core.sanitizeRelativePath('C:/Windows/system32'), null, 'drive path rejected');
  eq(core.sanitizeRelativePath('file:///etc/passwd'), null, 'URL rejected');
  eq(core.sanitizeRelativePath(''), null, 'empty rejected');
  eq(core.sanitizeRelativePath(null), null, 'null rejected');
}

// ---------------------------------------------------------------------------
group('3. fall physics');
// ---------------------------------------------------------------------------
{
  // A pet released from rest at height 1.0 with floor 0 must reach the floor.
  let state = { y: 1.0, vy: 0, floor: 0, bounces: 0 };
  let ticks = 0;
  let landed = false;
  while (ticks < 600 && !landed) {
    state = core.stepFall(state, 1 / 60);
    landed = state.landed;
    ticks += 1;
  }
  ok(landed, 'released pet lands');
  eq(state.y, 0, 'landed pet sits exactly on the floor');
  ok(state.bounces >= 1, 'impact produced at least one bounce');
  ok(ticks > 6 && ticks < 400, `landing took a plausible number of frames (${ticks})`);

  // Sub-stepping must survive a frame so slow it would otherwise tunnel.
  const bigStep = core.stepFall({ y: 1.0, vy: 0, floor: 0, bounces: 0 }, 1.0);
  ok(bigStep.y >= 0, 'a one-second frame does not tunnel through the floor');

  // Never below the floor, whatever the input.
  let s = { y: 0.05, vy: -99, floor: 0, bounces: 0 };
  for (let i = 0; i < 200; i++) s = core.stepFall(s, 1 / 30);
  ok(s.y >= 0, 'y never goes below the floor');
  eq(s.vy, 0, 'at rest the vertical velocity is zero');
  eq(s.landed, true, 'at rest the pet reports landed');

  // A tiny impact must not bounce forever.
  const tiny = core.stepFall({ y: 0.001, vy: -0.05, floor: 0, bounces: 0 }, 1 / 60);
  eq(tiny.vy, 0, 'an impact below the bounce cutoff settles immediately');
  eq(tiny.landed, true, 'a soft impact reports landed');

  // Terminal velocity is respected.
  let fast = { y: 100, vy: 0, floor: 0, bounces: 0 };
  fast = core.stepFall(fast, 10);
  ok(fast.vy >= -core.FALL_PHYSICS.maxSpeed - 1e-9, 'terminal velocity is never exceeded');

  // Zero and negative dt are no-ops rather than corruption.
  const same = core.stepFall({ y: 0.5, vy: 0, floor: 0, bounces: 0 }, 0);
  eq(same.y, 0.5, 'dt=0 leaves the pet where it was');
  const neg = core.stepFall({ y: 0.5, vy: 0, floor: 0, bounces: 0 }, -1);
  eq(neg.y, 0.5, 'negative dt leaves the pet where it was');

  // Determinism: identical input, identical output.
  const a1 = core.stepFall({ y: 0.9, vy: 0, floor: 0, bounces: 0 }, 0.25);
  const a2 = core.stepFall({ y: 0.9, vy: 0, floor: 0, bounces: 0 }, 0.25);
  eq(a1.y, a2.y, 'physics is deterministic');

  // --- side walls -----------------------------------------------------------
  // A thrown pet used to hit the side of the frame and STAY there, riding the wall
  // down to the floor. A wall has to return speed, like the floor does.
  ok(core.FALL_PHYSICS.wallBounce > 0 && core.FALL_PHYSICS.wallBounce < 1,
    'the wall restitution is a real fraction, not a stop or a perfect bounce');

  const inside = core.reflectWithin(0.4, 0.5, 0, 0.8);
  eq(inside.hit, false, 'a body inside its bounds is left alone');
  eq(inside.x, 0.4, 'an untouched body keeps its position');
  eq(inside.vx, 0.5, 'an untouched body keeps its speed');

  const leftWall = core.reflectWithin(-0.05, -0.6, 0, 0.8);
  eq(leftWall.hit, true, 'crossing the left bound is a hit');
  eq(leftWall.x, 0, 'a left hit puts the body exactly on the bound');
  ok(leftWall.vx > 0, 'a left hit sends the body back to the right');
  near(leftWall.vx, 0.6 * core.FALL_PHYSICS.wallBounce, 1e-9, 'a left hit returns the wall restitution');

  const rightWall = core.reflectWithin(0.9, 0.6, 0, 0.8);
  eq(rightWall.hit, true, 'crossing the right bound is a hit');
  eq(rightWall.x, 0.8, 'a right hit puts the body exactly on the bound');
  ok(rightWall.vx < 0, 'a right hit sends the body back to the left');
  near(Math.abs(rightWall.vx), 0.6 * core.FALL_PHYSICS.wallBounce, 1e-9,
    'a right hit returns the wall restitution');

  // Already moving inward when it is caught out of bounds: the rebound must not
  // reverse a body that was coming back by itself (a resize does this).
  const inward = core.reflectWithin(0.9, -0.4, 0, 0.8);
  ok(inward.vx < 0, 'a body already heading inward keeps heading inward');

  // A caller can override the restitution, and a nonsense one is clamped.
  eq(core.reflectWithin(-1, -1, 0, 1, 1).vx, 1, 'a restitution of 1 returns the full speed');
  eq(core.reflectWithin(-1, -1, 0, 1, 0).vx, 0, 'a restitution of 0 stops the body');
  eq(core.reflectWithin(-1, -2, 0, 1, 5).vx, 2, 'an out-of-range restitution is clamped to 1');

  // Degenerate and hostile inputs.
  eq(core.reflectWithin(5, 5, 0, 0).vx, 0, 'a zero-width corridor cannot produce speed');
  eq(core.reflectWithin(NaN, 1, 0, 1).vx, 1, 'a NaN position is treated as inside');
  eq(core.reflectWithin(0.5, NaN, 0, 1).vx, 0, 'a NaN speed becomes zero rather than propagating');
  eq(core.reflectWithin(0.5, 1, NaN, 1).hit, false, 'a NaN bound is refused rather than half-applied');

  // --- the ceiling ----------------------------------------------------------
  // The top of the frame is the floor's counterpart and has to behave the same way: a
  // pet thrown upward BOUNCES off it. Clamping the top instead — which is what the
  // client's clampToViewport did, and the reported bug — left the pet stuck to the top
  // edge while the rise it was thrown with was quietly discarded.
  ok(core.FALL_PHYSICS.ceilingBounce > 0 && core.FALL_PHYSICS.ceilingBounce <= 1,
    'the ceiling restitution is a real fraction');

  const ceiling = 0.6;
  let thrown = { y: 0.2, vy: 3.0, floor: 0, ceiling: ceiling, bounces: 0, ceilingBounces: 0 };
  let peak = 0;
  let frames = 0;
  let landedAgain = false;
  while (!landedAgain && frames < 3000) {
    thrown = core.stepFall(thrown, 1 / 60);
    peak = Math.max(peak, thrown.y);
    landedAgain = thrown.landed;
    frames += 1;
  }
  ok(peak <= ceiling + 1e-9, `the pet never rises past the ceiling (peak ${peak.toFixed(4)})`);
  eq(thrown.ceilingBounces, 1, 'a hard throw is returned by the ceiling exactly once');
  eq(thrown.landed, true, 'and it still lands on the floor');
  eq(thrown.y, 0, 'on the floor, not at the ceiling');
  eq(thrown.ceiling, ceiling, 'the ceiling round-trips, so a caller can feed the state back in');

  // A gentle rise must not quiver against the ceiling: gravity takes it back.
  const gentle = core.stepFall({ y: 0.58, vy: 0.5, floor: 0, ceiling: ceiling, bounces: 0 }, 1 / 60);
  ok(gentle.y <= ceiling + 1e-9, 'a gentle rise stops at the ceiling');
  ok(gentle.ceilingBounces === 0 && gentle.vy >= 0, 'a gentle rise is not counted as a bounce');

  // Without a ceiling the old behaviour stands: a rise is unbounded.
  let unbounded = { y: 0.2, vy: 3.0, floor: 0, bounces: 0 };
  let unboundedPeak = 0;
  for (let i = 0; i < 40; i++) {
    unbounded = core.stepFall(unbounded, 1 / 60);
    unboundedPeak = Math.max(unboundedPeak, unbounded.y);
  }
  ok(unboundedPeak > ceiling, 'a caller with no ceiling still gets an unbounded rise');
  eq(unbounded.ceiling, Infinity, 'and no ceiling is reported as none');

  // Nonsense ceilings are ignored rather than freezing the pet mid-air.
  const noCeiling = core.stepFall({ y: 0.5, vy: 1, floor: 0, ceiling: NaN, bounces: 0 }, 1 / 60);
  ok(noCeiling.y > 0.5, 'a NaN ceiling does not trap the pet at its own height');
}

// ---------------------------------------------------------------------------
group('4. model framing');
// ---------------------------------------------------------------------------
{
  // A 1.6 m tall character centred on the origin, feet at y=0.
  const box = { min: { x: -0.3, y: 0, z: -0.2 }, max: { x: 0.3, y: 1.6, z: 0.2 } };
  const framing = core.computeFraming(box, { viewportHeight: 1, heightFraction: 0.8 });
  near(framing.scale, 0.5, 1e-9, 'scale maps 1.6 model units onto 0.8 viewport units');
  near(framing.scaled.y, 0.8, 1e-9, 'scaled height equals the requested fraction');
  near(framing.offset.y, 0, 1e-9, 'feet already at y=0 need no vertical offset');
  near(framing.offset.x, 0, 1e-9, 'a centred model needs no x offset');

  // A model whose feet are not at the origin, and whose origin is off-centre.
  const offsetBox = { min: { x: 5.0, y: -1.2, z: -3.0 }, max: { x: 5.6, y: 0.4, z: -2.6 } };
  const offsetFraming = core.computeFraming(offsetBox, { viewportHeight: 1, heightFraction: 0.8 });
  near(offsetFraming.size.y, 1.6, 1e-9, 'offset box height measured');
  near(offsetFraming.offset.y, 1.2, 1e-9, 'offset lifts the feet to y=0');
  near(offsetFraming.offset.x, -5.3, 1e-9, 'offset centres x');
  near(offsetFraming.offset.z, 2.8, 1e-9, 'offset centres z');

  // The two offset flavours must agree, because three.js composes T · R · S:
  // local offset inside a scaled node, or the same offset already scaled on one
  // node. A model that is NOT at the origin is the only case that can tell them
  // apart, so this check is the one that catches the transform-order trap.
  near(offsetFraming.worldOffset.y, offsetFraming.offset.y * offsetFraming.scale, 1e-12,
    'worldOffset is the local offset scaled');
  near(offsetFraming.worldOffset.x, offsetFraming.offset.x * offsetFraming.scale, 1e-12,
    'worldOffset x is the local offset scaled');

  // Worked example of the trap, with the numbers from the real placeholder:
  // a model whose feet sit at y=0.0242 and a scale of 0.5554. Putting the LOCAL
  // offset on the same node as the scale leaves the feet at
  //   0.0242*scale + offset  =  0.0134 - 0.0242 = -0.0107
  // i.e. sunk into the floor. The world offset lands them exactly on 0.
  {
    const trap = core.computeFraming(
      { min: { x: -0.567, y: 0.0242, z: -0.3568 }, max: { x: 0.567, y: 1.4646, z: 0.3504 } },
      { viewportHeight: 1, heightFraction: 0.8 }
    );
    const sunk = 0.0242 * trap.scale + trap.offset.y;
    const correct = 0.0242 * trap.scale + trap.worldOffset.y;
    near(correct, 0, 1e-12, 'the world offset stands the model exactly on the floor');
    ok(sunk < -0.005, `the local offset on a single node really does sink it (${sunk.toFixed(4)})`);
  }

  // Degenerate boxes must not produce NaN or Infinity.
  const degenerate = core.computeFraming({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } });
  ok(Number.isFinite(degenerate.scale) && degenerate.scale > 0, 'a zero-height box still yields a finite scale');

  // Larger viewport ⇒ larger scale, same fraction of the frame.
  const small = core.computeFraming(box, { viewportHeight: 1 });
  const large = core.computeFraming(box, { viewportHeight: 2 });
  near(large.scale / small.scale, 2, 1e-9, 'scale is proportional to viewport height');
  eq(small.heightFraction, large.heightFraction, 'height fraction is viewport independent');

  // Camera distance grows with model size and shrinks with a wider FOV.
  const near1 = core.computeCameraDistance(box, 1, 30, 1.15);
  const far1 = core.computeCameraDistance({ min: { x: -0.6, y: 0, z: -0.4 }, max: { x: 0.6, y: 3.2, z: 0.4 } }, 1, 30, 1.15);
  ok(far1 > near1, 'a bigger model needs more camera distance');
  const wide = core.computeCameraDistance(box, 1, 60, 1.15);
  ok(wide < near1, 'a wider field of view needs less distance');
  ok(Number.isFinite(near1) && near1 > 0, 'camera distance is finite and positive');
}

// ---------------------------------------------------------------------------
group('5. preferences');
// ---------------------------------------------------------------------------
{
  const defaults = core.cleanPreferences(null);
  eq(defaults.scope, 'global', 'default scope');
  // The operator, 2026-10-10: "移除内置替身，默认模型设置为SampleModel". Empty means AUTOMATIC, and the
  // resolver is what turns it into SampleModel — see the model-choice group below.
  eq(defaults.modelId, '', 'the default model is AUTOMATIC rather than a built-in avatar');
  eq(defaults.motion, true, 'motion on by default');
  eq(defaults.physics, true, 'physics on by default');
  // Spring bones during an authored clip (operator, 2026-10-14): shipped ON, and an older stored profile — which has
  // no such key — gets the NEW behaviour rather than the old one, which is why the cleaner tests `!== false`.
  eq(defaults.motionPhysics, true, 'the spring bones keep their physics while a clip plays, by default');
  eq(core.cleanPreferences({ motionPhysics: false }).motionPhysics, false,
    'while an explicit off is kept, for a clip whose own hair animation is wanted');
  eq(core.cleanPreferences({ motionPhysics: 'nonsense' }).motionPhysics, true,
    'and anything that is not a stored false reads as on');

  const dirty = core.cleanPreferences({
    scope: 'current', size: 9999, motion: false, modelId: 'x'.repeat(900),
    modelScale: -5, yaw: 99, sway: 99, sleepAfterMs: 7, hidden: 'yes', x: 'nope',
  });
  eq(dirty.scope, 'current', 'valid scope kept');
  eq(dirty.size, core.SIZE_RANGE.max, 'size clamped to the maximum');
  eq(dirty.motion, false, 'explicit motion=false kept');
  eq(dirty.modelId.length, 512, 'over-long model id truncated');
  eq(dirty.modelScale, 0.2, 'model scale clamped to the minimum');
  eq(dirty.yaw, Math.PI, 'yaw clamped to π');
  eq(dirty.sway, 0.6, 'sway clamped to its maximum');
  eq(dirty.sleepAfterMs, core.DEFAULTS.sleepAfterMs, 'unknown nap timeout falls back to the default');
  eq(dirty.hidden, false, 'a truthy non-boolean does not enable hidden');
  eq(dirty.x, null, 'a non-numeric x position becomes null');
  eq(dirty.y, null, 'a non-numeric y position becomes null');

  /**
   * 显示位置, including the DEBUG value.
   *
   * `both` is the switch that puts the floating window AND the pet inside the app on screen together, so the
   * cleaner has to KEEP it: the host store cleans every patch with this function, and a value it does not
   * recognise is rewritten to `auto`. That is the failure this asserts against, and it is a quiet one — the box
   * ticks, the store answers `auto`, and the next snapshot untickes it, so the switch reads as broken rather
   * than as refused.
   */
  eq(core.cleanPreferences({}).petSurface, 'auto', 'the pet starts on 自动');
  eq(core.cleanPreferences({ petSurface: 'both' }).petSurface, 'both',
    'the debug mode is a value the cleaner keeps rather than one it rewrites');
  eq(core.cleanPreferences({ petSurface: 'everywhere' }).petSurface, 'auto',
    'and an unknown surface still falls back to the shipped default rather than reaching the launcher');

  /**
   * 重力, in two keys, and they must not be able to move together.
   *
   * The menu's 重力 switch is per surface (operator, 2026-10-12: 「内置宠物和外置宠物的重力开关状态完全独立」),
   * and the shipped defaults are the behaviour each surface already had: the app overlay's pet throws and
   * bounces, and the floating window has been "drag and place" since 2026-10-10 (operator, 2026-10-14: 「显示位置和
   * 重力都不下发」 — his own profile runs both off, and that is his, not the default). The one assertion that matters
   * most is the LAST pair: writing one key must leave the other exactly as it was, because a cleaner that
   * defaulted both from one value would silently recouple two switches the user was promised were separate.
   */
  eq(core.cleanPreferences({}).gravity, true, 'the app pet ships with 重力 on, as it always threw');
  eq(core.cleanPreferences({}).windowGravity, false,
    'and the floating window ships with it off, which is its drag-and-place behaviour');
  eq(core.cleanPreferences({ gravity: false }).gravity, false, 'an explicit off is kept for the app pet');
  eq(core.cleanPreferences({ windowGravity: true }).windowGravity, true,
    'and for the window, so the switch can turn throwing back on out there');
  eq(core.cleanPreferences({ gravity: false }).windowGravity, false,
    'turning the app pet\'s 重力 off does not turn the window\'s on');
  eq(core.cleanPreferences({ windowGravity: true }).gravity, true,
    'and turning the window\'s on does not turn the app pet\'s off');

  /**
   * The floating window's own parking spot, as `placementX`/`placementY`.
   *
   * The page has written these on every drag since the "a desktop pet that returns to its corner on every
   * restart is a toy" round, but the cleaner did not know them — so its own `readPreferences` dropped them and
   * the window went back to 0.86/0 on every reload. `null` is "never dragged", which is a different thing from
   * fraction 0 (the left/top edge) and is what the page's default corner keys off.
   */
  eq(core.cleanPreferences({}).placementX, null, 'the window has no stored position until it is dragged');
  eq(core.cleanPreferences({}).placementY, null, 'and none vertically either');
  eq(core.cleanPreferences({ placementX: 0.25, placementY: 0.1 }).placementX, 0.25,
    'a dragged position survives cleaning');
  eq(core.cleanPreferences({ placementX: 0.25, placementY: 0.1 }).placementY, 0.1, 'on both axes');
  eq(core.cleanPreferences({ placementX: 0 }).placementX, 0,
    'zero is a real position, not an absent one');
  eq(core.cleanPreferences({ placementY: 'nonsense' }).placementY, null,
    'and a non-numeric one reads as never dragged rather than as NaN');

  // The two gaze settings the 模型参数 window writes. Cleaning them matters more than most: the curve is a
  // divisor's partner, so an absurd stored slope would distort or flatten the whole response, and a
  // hand-edited span must not collapse to zero (which `resolveGazeSpan` would read as auto anyway, but a
  // stored -4000 should never reach the renderer).
  const gazeDirty = core.cleanPreferences({ gazeCurve: 99, gazeSpanX: 99999, gazeSpanY: -4000 });
  eq(gazeDirty.gazeCurve, core.GAZE_CURVE_RANGE.max, 'the curve slope is clamped at the top');
  eq(gazeDirty.gazeSpanX, core.GAZE_SPAN_RANGE.max, 'an absurd span is clamped at the top');
  eq(gazeDirty.gazeSpanY, core.GAZE_SPAN_RANGE.min, 'a negative span is clamped to auto');
  eq(core.cleanPreferences({ gazeCurve: 0.001 }).gazeCurve, core.GAZE_CURVE_RANGE.min,
    'a near-zero slope is clamped: the response curve has a floor');
  eq(core.cleanPreferences({}).gazeCurve, core.DEFAULTS.gazeCurve, 'the shipped curve is the default');
  // And what that shipped slope IS: the operator's own (2026-10-13: 「视线：曲率设置默认为0.1…」). The live settings
  // half asserts the PAGE shows this constant, so the value itself is pinned here, where the constant lives.
  eq(core.DEFAULTS.gazeCurve, 0.1, 'which is the 0.1 the operator settled on');
  eq(core.cleanPreferences({}).gazeSpanX, 0, 'the shipped span is auto, so the frame decides');
  eq(core.cleanPreferences({ gazeCurve: 'x' }).gazeCurve, core.DEFAULTS.gazeCurve,
    'a non-numeric slope falls back rather than becoming NaN');

  const negative = core.cleanPreferences({ size: -100, modelScale: 100, yaw: -99 });
  eq(negative.size, core.SIZE_RANGE.min, 'size clamped to the minimum');
  eq(negative.modelScale, 4, 'model scale clamped to the maximum');
  eq(negative.yaw, -Math.PI, 'yaw clamped to -π');

  // The size range is the STORAGE contract: it has to be wide enough to hold everything the wheel
  // can reach in any frame, and this cleans a stored preference from an older build.
  ok(core.SIZE_RANGE.min >= 5 && core.SIZE_RANGE.max >= 400,
    `the size range can hold every zoom the wheel can reach (${core.SIZE_RANGE.min}..${core.SIZE_RANGE.max})`);
  ok(core.WHEEL_ZOOM_STEP > 1 && core.WHEEL_ZOOM_STEP < 1.5,
    'one wheel notch is a modest zoom, not a jump');
  eq(core.cleanPreferences({ size: 9999 }).size, core.SIZE_RANGE.max, 'an absurd stored size is brought into range');
  eq(core.cleanPreferences({ size: 100 }).size, 100, 'an ordinary size survives cleaning');

  /**
   * The FLOATING WINDOW's own size.
   *
   * The two surfaces are framed differently — the app overlay's pet lives in DSH's window, the floating
   * window's frame is the whole screen — and they used to share `size`. Reloading DSH then let the in-app pet
   * push its percentage over the window's (measured 2026-10-10: 202×276 instead of 396×540), so this is the
   * key that keeps them apart, plus the MIGRATION: a profile written before the split has only `size`, and the
   * window must keep the value it was already showing rather than jump to a default.
   */
  eq(core.cleanPreferences({}).windowSize, core.DEFAULTS.windowSize,
    'the floating window has a size preference of its own');
  eq(core.cleanPreferences({ size: 180 }).windowSize, 180,
    'a profile written before the split keeps the window exactly where it was');
  eq(core.cleanPreferences({ size: 180 }).size, 180, 'while the in-app pet keeps the same value');
  eq(core.cleanPreferences({ size: 180, windowSize: 320 }).size, 180,
    'once both are stored, the app pet’s size is not dragged along by the window’s');
  eq(core.cleanPreferences({ size: 180, windowSize: 320 }).windowSize, 320,
    'and the window’s survives cleaning as its own number');
  eq(core.cleanPreferences({ windowSize: 9999 }).windowSize, core.SIZE_RANGE.max,
    'an absurd window size is clamped into the same storage range as the app pet’s');
  eq(core.cleanPreferences({ windowSize: -5 }).windowSize, core.SIZE_RANGE.min,
    'and a negative one is brought up to the floor');
  eq(core.cleanPreferences({ windowSize: 'nonsense' }).windowSize, core.DEFAULTS.size,
    'an unparseable window size falls back instead of becoming NaN');
  eq(dirty.windowSize, core.SIZE_RANGE.max,
    'a profile with one clamped size gives the window that same clamped value');

  // The WHEEL's limits are derived from the frame, and they are the user's two rules: the pet's long
  // edge never goes below 40 px, and never above the frame's shortest edge. The app overlay's own
  // slot fraction is applied first, because there it is the harder limit.
  {
    const base = { baseWidth: 220, baseHeight: 300 };
    const big = core.sizeLimits({ ...base, viewportWidth: 1920, viewportHeight: 1032 });
    const px = (percent) => Math.round((300 * percent) / 100);
    ok(px(big.min) >= core.ZOOM_MIN_LONG_EDGE,
      `the smallest wheel size is at least a 40 px long edge (${px(big.min)} px at ${big.min}%)`);
    ok(px(big.max) <= Math.min(1920, 1032),
      `the largest wheel size is no bigger than the frame's shortest edge (${px(big.max)} px at ${big.max}%)`);
    ok(big.min < big.max, `the range is usable (${big.min}%..${big.max}%)`);

    // A small frame shrinks the ceiling with it, and the overlay's slot fraction caps it further.
    const small = core.sizeLimits({ ...base, viewportWidth: 480, viewportHeight: 360 });
    ok(small.max < big.max, `a smaller frame has a lower ceiling (${small.max}% vs ${big.max}%)`);
    const capped = core.sizeLimits({
      ...base, viewportWidth: 1920, viewportHeight: 1032, slotFraction: { width: 0.55, height: 0.6 },
    });
    ok(capped.max < big.max, `a slot fraction caps the ceiling further (${capped.max}% vs ${big.max}%)`);
    ok(px(capped.max) <= Math.round(1032 * 0.6),
      `and the cap is the fraction of the frame, not of the model (${px(capped.max)} px)`);

    // A degenerate frame (a window smaller than the base pet) still yields a usable range rather
    // than a max below its own min.
    const tiny = core.sizeLimits({ ...base, viewportWidth: 100, viewportHeight: 80 });
    ok(tiny.max >= tiny.min, `a tiny frame still yields a usable range (${tiny.min}%..${tiny.max}%)`);
  }

  // The camera orbit, and the reason it needs limits at all: an unbounded pitch puts
  // the camera under the floor or straight over the pet's head.
  eq(core.DEFAULTS.viewYaw, 0, 'the view starts looking straight at the pet');
  eq(core.DEFAULTS.viewPitch, 0, 'and level with it');
  const orbited = core.cleanPreferences({ viewYaw: 99, viewPitch: -99 });
  near(orbited.viewYaw, core.VIEW_LIMITS.yaw, 1e-9, 'yaw is clamped to a half turn');
  near(orbited.viewPitch, core.VIEW_LIMITS.pitchMin, 1e-9, 'pitch is clamped at the bottom');
  eq(core.cleanPreferences({ viewPitch: 99 }).viewPitch, core.VIEW_LIMITS.pitchMax, 'pitch is clamped at the top');
  ok(core.VIEW_LIMITS.pitchMax < Math.PI / 2 && core.VIEW_LIMITS.pitchMin > -Math.PI / 2,
    'the pitch never reaches straight up or straight down');

  // ---- expression settings -------------------------------------------------
  // The manual weights and the two behaviours. Everything here is stored, so everything here has to
  // survive a hand-edited or older blob: the panel and the renderer both trust cleanPreferences.
  const expressionDefaults = core.cleanPreferences({}).expressions;
  same(expressionDefaults.weights, {}, 'no expression is pinned by hand until the user pins one');
  eq(expressionDefaults.blink.enabled, true, 'blinking is on by default');
  eq(expressionDefaults.blink.minSeconds, 2, 'and it starts at the short end of the authored range');
  eq(expressionDefaults.blink.maxSeconds, 6, 'and reaches the long end');
  eq(expressionDefaults.emotion.enabled, true, 'emotions are on by default');
  eq(expressionDefaults.emotion.idleMinSeconds, 20, 'the idle interval starts at twenty seconds');
  eq(expressionDefaults.emotion.idleMaxSeconds, 60, 'and ends at sixty');
  same(core.EMOTION_TRIGGERS, ['idle', 'drag', 'click', 'hold'],
    'and there is one row per situation, in the order the window shows them');
  eq(expressionDefaults.emotion.triggers.idle.enabled, true, 'the idle row is on');
  eq(expressionDefaults.emotion.triggers.drag.enabled, true, 'and so is the drag row');
  same(expressionDefaults.emotion.triggers.idle.emotions, [],
    'and it names NO emotions — an EMPTY row is the 无 choice, deliberately silent');
  eq(expressionDefaults.emotion.triggers.idle.holdSeconds, 0,
    'an idle mood is HELD: zero means until something replaces it, which is what a mood is');
  eq(expressionDefaults.emotion.triggers.drag.holdSeconds, 0, 'a dragged mood is held too');
  eq(expressionDefaults.emotion.triggers.click.holdSeconds, core.EMOTION_LIMITS.holdSeconds,
    'while a click is a reaction with a duration');
  eq(expressionDefaults.emotion.triggers.hold.holdSeconds, core.EMOTION_LIMITS.holdSeconds,
    'and the long press is the same kind of reaction as a click');

  /**
   * The PARTS table, and the shared gesture bounds.
   *
   * A part is the user's own row now: a label, the structures it owns, an emotion row and a 碎碎念 box. The
   * shipped rows are the defaults, seeded from the LEGACY per-region emotion table — so a profile that set up
   * "click its eye → surprised" before parts existed keeps it, and a profile that never heard of parts behaves
   * exactly as it did. The bounds themselves live in core so the two surfaces and the suites cannot drift.
   */
  same(core.STRUCTURE_REGIONS,
    ['eye', 'head', 'hand', 'body', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt', 'tail'],
    'one shipped region row per default region, in the order the window shows them');
  const partDefaults = core.cleanPreferences({}).parts.items;
  same(partDefaults.map(function (item) { return item.id; }),
    ['eye', 'head', 'hand', 'body', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt', 'tail'],
    'and the cleaner hands back all ten, whatever was stored');
  same(partDefaults.map(function (item) { return item.region; }),
    ['eye', 'head', 'hand', 'body', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt', 'tail'],
    'each carrying the region it answers for by default');
  /**
   * The five the operator added on 2026-10-12 sit BETWEEN 身体 and 尾巴, which is the order they asked for, and
   * their boxes ship EMPTY even though 胸部 and 屁股 have something to say — the defaults live in the tables below
   * the user's own settings, not in them ("匹配词写进系统底层，不显示").
   */
  same(partDefaults.slice(3).map(function (item) { return item.label; }),
    ['身体', '大腿', '小腿', '脚', '胸部', '屁股', '尾巴'],
    'the new parts come after 身体 and before 尾巴, labelled as the operator named them');
  eq(partDefaults.every(function (item) {
    return item.enabled === true && item.emotions === undefined && item.match.length === 0
      && item.emotion.emotions.length === 0 && item.speech.lines.length === 0 && item.speech.prompt === '';
  }), true,
  'each silent, structureless and with an EMPTY 碎碎念 box by default — the shipped voice is not stored as if the user wrote it');
  /**
   * The shipped pool is picked by GESTURE and by LANGUAGE now (operator, 2026-10-14: 「给自带的身体部位，每个部位按照默认的性格
   * 提示词，生成20个点击对应部位的碎碎念」, then 「拆成两池，长按另写 20 条」): every one of the ten regions answers a poke
   * with twenty lines and a finger held down with twenty OTHERS, in both languages.
   *
   * 胸部 and 屁股 keep the two lines the operator wrote by hand first (2026-10-12) at the head of their click pools, and
   * that is asserted here rather than only in the settings page: the table is what the pet says, and a data edit that
   * dropped them would otherwise be invisible.
   */
  const chestClick = core.partSpeechLines(partDefaults[7], true, 'zh', 'click');
  const chestHold = core.partSpeechLines(partDefaults[7], true, 'zh', 'hold');
  eq(chestClick.slice(0, 2).join('/'), '变态！/大色狼！',
    'while 胸部 answers a press with its shipped lines — the two the operator wrote first, leading its click pool');
  eq(chestClick.length, 20, 'and that pool is twenty lines deep');
  eq(chestHold.length, 20, 'with twenty MORE for a finger held down');
  eq(chestClick.filter(function (line) { return chestHold.indexOf(line) !== -1; }).length, 0,
    'and the two gestures never answer with the same line, which is the whole point of splitting them');
  const shippedPools = [];
  partDefaults.forEach(function (item) {
    ['click', 'hold'].forEach(function (gesture) {
      ['zh', 'en'].forEach(function (lang) {
        shippedPools.push({
          where: item.id + '/' + gesture + '/' + lang,
          lang: lang,
          lines: core.partSpeechLines(item, true, lang, gesture),
        });
      });
    });
  });
  eq(shippedPools.reduce(function (total, pool) { return total + pool.lines.length; }, 0), 800,
    'ten shipped parts × two gestures × two languages × twenty lines');
  eq(shippedPools.filter(function (pool) { return pool.lines.length !== 20; }).map(function (pool) { return pool.where; }).join(','),
    '',
    'no region is short of lines: every pool has exactly twenty');
  eq(shippedPools.filter(function (pool) {
    return pool.lines.some(function (line) { return pool.lines.indexOf(line) !== pool.lines.lastIndexOf(line); });
  }).map(function (pool) { return pool.where; }).join(','),
    '',
    'and no pool repeats a line inside itself — the reason a pool is twenty deep at all');
  eq(shippedPools.filter(function (pool) {
    return pool.lines.some(function (line) { return line.length > (pool.lang === 'zh' ? 30 : 42); });
  }).map(function (pool) { return pool.where; }).join(','),
    '',
    'and every line fits the bubble the reviewer was given: 中文 ≤30 字, English ≤42 characters');
  eq(core.partSpeechLines(partDefaults[3]).join(''), core.partSpeechLines(partDefaults[3], true, 'zh', 'click').join(''),
    'a caller that passes neither language nor gesture gets the Chinese click pool, which is what the old table was');
  /**
   * …and only while the pet is speaking from the BUILT-IN source. The shipped table IS the built-in source, so the
   * same `tableAllowed` switch that turns the state table off (operator, 2026-10-11) turns this one off too — the
   * second half of 「如果设置了AI碎碎念，就停止输出内置的碎碎念」, and it now has to hold for EITHER gesture.
   */
  eq(core.partSpeechLines(partDefaults[7], false).length, 0,
    'and says nothing from the shipped table once the source is not 内置短语');
  eq(core.partSpeechLines(partDefaults[7], false, 'zh', 'hold').length, 0,
    'which is true of the long-press pool as well, not just the click one');
  eq(core.partSpeechPrompt(partDefaults[8]), '被主人摸到屁股了，必须要傲娇的回骂这个摸人家屁股的变态主人才行。',
    'and 屁股 has a shipped instruction for the model');
  eq(core.partSpeechLines({ region: null, speech: core.cleanPartSpeech(null) }).length, 0,
    'a part of the user\'s own with no region still answers nothing at all — there is no pool to fall back to');
  // The user's own box wins over every shipped one — the operator's own condition: "如果输入了，则以输入的为准".
  const chestOwn = core.cleanPartSpeech({ lines: ['别碰'], prompt: '我自己的提示词' });
  eq(core.partSpeechLines({ region: 'chest', speech: chestOwn }).join(''), '别碰',
    'and a user box replaces the shipped lines');
  eq(core.partSpeechPrompt({ region: 'chest', speech: chestOwn }), '我自己的提示词',
    'as well as the shipped instruction');

  /**
   * The default REGION of a name is a heuristic, and the settings page says so. `null` means "this name matched
   * nothing" and is kept apart from `'body'`, because `Spine` IS the body while `LiuHai` is a name the table has
   * never seen — the operator's 蓝色小肥鱼 has 34 head structures (刘海/呆毛/发鬓/耳朵) and a 尾巴 in exactly that
   * state, which is what a user part is FOR.
   */
  eq(core.structureRegionOf('J_Bip_C_Head'), 'head', 'a VRoid head bone is a head');
  eq(core.structureRegionOf('J_Adj_L_FaceEye'), 'eye', 'and an eye bone an eye, not a head');
  eq(core.structureRegionOf('Hand.L'), 'hand',
    'an MMD bone name still reads as a hand — a naming heuristic, not MMD support');
  eq(core.structureRegionOf('左腕'), 'hand', 'and so is its Japanese name');
  eq(core.structureRegionOf('TwinTail.A.001.L'), 'tail', 'a twintail matches tail, for better or worse');
  /**
   * The 大腿/小腿/脚/胸部/屁股 rows (operator, 2026-10-12), and the ORDER RULE they stated twice: 「这里 leg 的存在，
   * 一定优先匹配完 upper leg/upperleg 之类大腿部位，才能把剩下的匹配到 leg」. The words a MODEL file uses
   * (`J_Bip_L_UpperLeg`, `LeftLeg`, `bust`) matter more than the words a person would type, so both are asserted.
   */
  eq(core.structureRegionOf('J_Bip_L_UpperLeg'), 'upperLeg', 'a VRoid thigh bone is a 大腿');
  eq(core.structureRegionOf('upperleg'), 'upperLeg', 'and so is the word with no separator in it');
  eq(core.structureRegionOf('Upper_Leg'), 'upperLeg', 'and with one');
  eq(core.structureRegionOf('thigh'), 'upperLeg', 'with the anatomical name as well');
  eq(core.structureRegionOf('datui'), 'upperLeg', 'and the pinyin the operator uses for it');
  eq(core.structureRegionOf('J_Bip_L_LowerLeg'), 'lowerLeg',
    'the lower leg is the LOWER one even though upperLeg contains the same three letters');
  eq(core.structureRegionOf('LeftLeg'), 'lowerLeg', 'and a bare leg is what is left for it');
  eq(core.structureRegionOf('xiaotui'), 'lowerLeg', 'as is the pinyin for 小腿');
  eq(core.structureRegionOf('J_Bip_L_Foot'), 'foot', 'a foot bone is a 脚');
  eq(core.structureRegionOf('feet'), 'foot', 'the plural too');
  eq(core.structureRegionOf('ashi'), 'foot', 'and the operator\'s own word for it');
  eq(core.structureRegionOf('J_Bip_C_Chest'), 'chest', 'a chest bone is a 胸部');
  eq(core.structureRegionOf('bust'), 'chest',
    'and the mesh 蓝色小肥鱼 calls bust, which nothing used to claim at all');
  eq(core.structureRegionOf('rufang'), 'chest', 'with the operator\'s word for it');
  eq(core.structureRegionOf('Hips'), 'butt', 'hips are a 屁股');
  eq(core.structureRegionOf('pigu'), 'butt', 'and so is the pinyin');
  eq(core.structureRegionOf('neiku'), 'butt', 'as is the underwear a mesh may be named after');
  eq(core.structureRegionOf('尻尾'), 'tail', 'while 尻尾 is a TAIL, caught by the row above 屁股');
  eq(core.structureRegionOf('尻'), 'butt', 'leaving a bare 尻 for the bottom');
  eq(core.structureRegionOf('QunZi'), null, 'and a skirt still matches nothing, which is what a user part is for');
  eq(core.structureRegionOf('LiuHai.L.002'), null, 'while a pinyin name matches nothing at all');
  eq(core.structureRegionOf('Spine'), null, 'and neither does a bone the body happens to contain');
  eq(core.structureRegionOf(''), null, 'with an empty name answering nothing rather than body');
  /**
   * And a shipped row is what an unclaimed name FALLS TO: `bust` used to land on 身体 and is a 胸部 now, while a
   * name the table still has not seen keeps falling to body — the fallback that leaves a fresh profile behaving
   * as it always did.
   */
  const shippedOnly = core.cleanPreferences({});
  eq(core.partItemFor(shippedOnly, 'bust', core.structureRegionOf('bust')).id, 'chest',
    'the mesh named bust is answered by the shipped 胸部 row');
  eq(core.partItemFor(shippedOnly, 'J_Bip_L_LowerLeg', core.structureRegionOf('J_Bip_L_LowerLeg')).id, 'lowerLeg',
    'a lower leg bone by the 小腿 row');
  eq(core.partItemFor(shippedOnly, 'LiuHai.L.002', core.structureRegionOf('LiuHai.L.002')).id, 'body',
    'and a name the table has never seen still falls to 身体');

  const wavePart = core.cleanPreferences({
    parts: {
      // `seeded` says this profile has been offered every shipped region, so the migration of 2026-10-12 has
      // nothing to insert: this fixture is about the USER's own rows surviving a round trip.
      seeded: core.STRUCTURE_REGIONS,
      items: [
        { id: 'p1', label: '刘海', match: ['LiuHai'], emotion: { emotions: ['happy'], holdSeconds: 3 }, speech: { lines: ['别摸刘海', '刘海乱了'], prompt: '被摸到刘海时说一句' } },
        { id: 'p2', label: '唯一', match: [{ name: 'LiuHai.L', exact: true }] },
        { id: 'eye', label: '眼睛', region: 'eye', match: [], emotion: { emotions: ['surprised'] } },
        { id: 'body', label: '身体', region: 'body' },
      ],
    },
  });
  const wave = wavePart.parts.items;
  eq(wave.length, 4, 'the parts a user wrote are what comes back, in the order they are shown');
  eq(wave[0].label, '刘海', 'with the label they gave it');
  same(wave[0].speech.lines, ['别摸刘海', '刘海乱了'], 'and the lines it says, one per line');
  eq(wave[0].speech.prompt, '被摸到刘海时说一句', 'and the prompt an AI line is generated from');
  eq(wave[0].region, null, 'a user part has no default region: it is matched by the structures it names');
  same(wave[0].match, [{ name: 'LiuHai', exact: false }], 'and a bare name is a PREFIX rule');
  same(wave[1].match, [{ name: 'LiuHai.L', exact: true }], 'while an exact one stays exact');
  same(core.cleanPartStructures(['a', 'a', 'b', { name: 'a', exact: true }]),
    [{ name: 'a', exact: false }, { name: 'b', exact: false }, { name: 'a', exact: true }],
    'a duplicate collapses, but the same name in the other MODE is a different rule and is kept');
  same(core.cleanPartStructures(['x'.repeat(300)]), [{ name: 'x'.repeat(core.PARTS_LIMITS.maxStructureLength), exact: false }],
    'and a structure name is capped rather than stored whole');

  /**
   * The matching order IS the contract: explicit structures first (in list order, so a structure two parts claim
   * belongs to the one higher up), then the shipped region row, then the body row.
   */
  eq(core.partItemFor(wavePart, 'LiuHai.L.002', 'head').id, 'p1',
    'a prefix entry claims every structure under it, even one the heuristic calls a head');
  eq(core.partItemFor(wavePart, 'LiuHai.L', 'head').id, 'p1',
    'and it wins over the exact entry BELOW it, because the list order is the priority');
  eq(core.partItemFor(core.cleanPreferences({
    parts: { items: [{ id: 'p1', label: '唯一', match: [{ name: 'LiuHai.L', exact: true }] }, { id: 'p2', label: '前缀', match: ['LiuHai'] }] },
  }), 'LiuHai.L.002', 'head').id, 'p2', 'while an exact entry never claims a child');
  eq(core.partItemFor(wavePart, 'J_Adj_L_FaceEye', 'eye').id, 'eye',
    'a structure no user part claims falls to the shipped row for its region');
  eq(core.partItemFor(wavePart, 'WeiBa.002', null).id, 'body',
    'and one whose name matches nothing falls to the body row');
  eq(core.partItemFor(core.cleanPreferences({ parts: { items: [] } }), 'head', 'head'), null,
    'a user who deleted every part gets NO part, rather than an invented one');
  eq(core.partItemFor(core.cleanPreferences({
    parts: { items: [{ id: 'p1', label: '关掉的', enabled: false, match: ['LiuHai'] }, { id: 'body', region: 'body' }] },
  }), 'LiuHai', 'head').id, 'body', 'and a switched-off part does not claim its structures');

  /**
   * The LEGACY per-region emotion rows migrate into the shipped parts.
   *
   * That table was the previous shape of this feature (2026-10-11), and a profile that used it must not lose the
   * reactions it set up — which is exactly what the operator had in the running app.
   */
  const migrated = core.cleanPreferences({
    expressions: { emotion: { parts: { eye: { emotions: ['happy'], holdSeconds: 4 } } } },
  }).parts.items;
  same(migrated[0].emotion.emotions, ['happy'], 'an old per-region row lands on the part for that region');
  eq(migrated[0].emotion.holdSeconds, 4, 'with its duration');
  // …and an item that DOES configure its own emotion wins over the legacy row, rather than being overwritten.
  const migratedBoth = core.cleanPreferences({
    parts: { items: [{ id: 'eye', region: 'eye', emotion: { emotions: ['angry'] } }] },
    expressions: { emotion: { parts: { eye: { emotions: ['happy'] } } } },
  }).parts.items;
  same(migratedBoth[0].emotion.emotions, ['angry'], 'while a new-shape row is not overwritten by the old one');

  /**
   * And a row the shipped table GAINED reaches a profile that was written before it existed (2026-10-12).
   *
   * A stored list is authoritative — that is what makes a deleted row stay deleted — so without this the five new
   * rows would exist only on a brand-new profile, which is not what "增加大腿/小腿/脚/胸部/屁股的部位" asked for. The
   * operator's own list is the case below: the five rows of the previous table, in their old order.
   */
  const row = function (id, label, region) { return { id: id, label: label, region: region }; };
  const beforeFive = core.cleanPreferences({
    parts: {
      items: [row('eye', '眼睛', 'eye'), row('head', '头', 'head'), row('hand', '手 / 手臂', 'hand'),
        row('body', '身体', 'body'), row('tail', '尾巴', 'tail')],
    },
  });
  same(beforeFive.parts.items.map(function (item) { return item.id; }),
    ['eye', 'head', 'hand', 'body', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt', 'tail'],
    'the five new rows are INSERTED into a stored list rather than appended');
  same(beforeFive.parts.items.map(function (item) { return item.label; }),
    ['眼睛', '头', '手 / 手臂', '身体', '大腿', '小腿', '脚', '胸部', '屁股', '尾巴'],
    'between 身体 and 尾巴, which is the order the operator asked for');
  same(beforeFive.parts.seeded,
    ['eye', 'head', 'hand', 'body', 'tail', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt'],
    'with every region recorded as OFFERED, so a second clean has nothing left to add');
  eq(core.cleanPreferences(beforeFive).parts.items.length, beforeFive.parts.items.length,
    'which is what makes the migration run ONCE');
  // …and a row this profile had already DELETED is not resurrected by the new ones arriving.
  const afterDelete = core.cleanPreferences({
    parts: { items: [row('eye', '眼睛', 'eye'), row('head', '头', 'head'), row('body', '身体', 'body'), row('tail', '尾巴', 'tail')] },
  });
  same(afterDelete.parts.items.map(function (item) { return item.id; }),
    ['eye', 'head', 'body', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt', 'tail'],
    'while a row this profile had already deleted (手) does NOT come back with them');
  // An EMPTY list is the user's answer — every row deleted — and stays empty, exactly as it always did.
  eq(core.cleanPreferences({ parts: { items: [] } }).parts.items.length, 0,
    'a profile with no parts at all is offered nothing, the new rows included');
  // A row the user deleted must not come back through an EDIT either, which is why `seeded` rides with the patch.
  const edited = core.cleanPreferences({
    parts: { items: [row('eye', '眼睛', 'eye'), row('tail', '尾巴', 'tail')] },
  });
  core.removePartItem(edited, 'tail');
  same(edited.parts.items.map(function (item) { return item.id; }),
    ['eye', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt'],
    'a removed row stays removed while the new rows stay');
  // And a user's own row keeps its place: only region rows are ordered by the shipped table.
  same(core.cleanPreferences({
    parts: { items: [row('eye', '眼睛', 'eye'), { id: 'p1', label: '刘海', match: ['LiuHai'] }, row('tail', '尾巴', 'tail')] },
  }).parts.items.map(function (item) { return item.id; }),
  ['eye', 'p1', 'upperLeg', 'lowerLeg', 'foot', 'chest', 'butt', 'tail'],
  'while a hand-written part is never moved by the seeding');

  const partsTarget = core.cleanPreferences({});
  const added = core.addPartItem(partsTarget, '耳朵');
  eq(added.label, '耳朵', 'the settings page can add a part');
  eq(partsTarget.parts.items.length, core.STRUCTURE_REGIONS.length + 1,
    'which joins the shipped ones rather than replacing them');
  same(core.setPartItem(partsTarget, added.id, { match: ['ErDuo'], label: '耳朵和呆毛' }).match,
    [{ name: 'ErDuo', exact: false }], 'and give it structures');
  eq(core.setPartItem(partsTarget, added.id, { label: '耳朵和呆毛' }).label, '耳朵和呆毛',
    'and rename it, keeping the structures it already had');
  same(core.setPartEmotion(partsTarget, added.id, { emotions: ['happy'], holdSeconds: 2 }).emotion.emotions, ['happy'],
    'a part row is written through setPartEmotion');
  eq(core.setPartEmotion(partsTarget, 'nonsense', { emotions: ['happy'] }), null,
    'which refuses a part that does not exist');
  eq(core.setPartItem(partsTarget, added.id, { speech: { lines: ['别摸耳朵'] } }).speech.lines[0], '别摸耳朵',
    'and its 碎碎念 box is written through setPartItem');
  eq(core.setPartItem(partsTarget, added.id, { speech: { lines: ['别摸耳朵'] } }).speech.prompt, '',
    'without dropping the other half of the box');
  eq(core.removePartItem(partsTarget, added.id), true, 'and a part can be removed');
  eq(partsTarget.parts.items.length, core.STRUCTURE_REGIONS.length, 'leaving the rest alone');
  eq(core.removePartItem(partsTarget, 'nonsense'), false, 'while removing one that is not there says so');
  // A shipped region row is the user's to delete: a model whose head is called something else may want only its
  // own parts, and "no reaction anywhere" is a legitimate thing to ask for.
  eq(core.removePartItem(partsTarget, 'head'), true, 'including a shipped region row');
  eq(partsTarget.parts.items.some(function (item) { return item.id === 'head'; }), false, 'which stays gone');

  const manyParts = [];
  for (let i = 0; i < core.PARTS_LIMITS.maxItems + 5; i += 1) manyParts.push({ id: 'p' + i, label: 'x' + i });
  eq(core.cleanPreferences({ parts: { items: manyParts } }).parts.items.length, core.PARTS_LIMITS.maxItems,
    'the number of parts is capped, because this is a settings list a person reads');
  const noId = { parts: { seeded: core.STRUCTURE_REGIONS, items: [{ label: 'no id' }] } };
  const badId = { parts: { seeded: core.STRUCTURE_REGIONS, items: [{ id: 'x!', label: 'bad id' }] } };
  same(core.cleanPreferences(noId).parts.items.map(function (item) { return item.id; }),
    ['p0'], 'an item without a usable id is given one rather than dropped');
  eq(core.cleanPreferences(badId).parts.items[0].id, 'p0',
    'and an id that is not a plain key is replaced, not trusted');

  eq(core.PRESS_LIMITS.moveThreshold, 4, 'a press may wander four pixels and still be a click');
  eq(core.PRESS_LIMITS.holdSeconds, 0.6, 'and has to last six tenths of a second to become a long press');
  eq(core.PRESS_LIMITS.reactGapSeconds, 3, 'while being touched twice in three seconds speaks once');

  const pinned = core.cleanPreferences({
    expressions: { weights: { blink: 0, happy: 1.4, '': 0.4, bad: 'x', ['n'.repeat(80)]: 1 } },
  }).expressions.weights;
  same(pinned, { blink: 0, happy: 1 },
    'only usable names are kept, and a weight is clamped into 0..1');
  eq(core.expressionWeightFor(core.cleanPreferences({ expressions: { weights: { blink: 0 } } }), 'blink'), 0,
    'a pinned ZERO is an answer, not an absence');
  eq(core.expressionWeightFor(core.cleanPreferences({}), 'blink'), null,
    'and an unpinned name asks the behaviour instead');

  const swapped = core.cleanPreferences({ expressions: { blink: { minSeconds: 30, maxSeconds: 5 } } }).expressions.blink;
  eq(swapped.minSeconds, 5, 'an inverted blink range is ordered rather than collapsed');
  eq(swapped.maxSeconds, 30, 'with both numbers kept');
  eq(core.cleanPreferences({ expressions: { blink: { enabled: false } } }).expressions.blink.enabled, false,
    'and the blink switch survives cleaning');
  const clampedEmotion = core.cleanPreferences({
    expressions: { emotion: { idleMinSeconds: -5, idleMaxSeconds: 99999, idle: false } },
  }).expressions.emotion;
  eq(clampedEmotion.idleMinSeconds, core.EMOTION_LIMITS.minSeconds, 'the idle interval is clamped at the bottom');
  eq(clampedEmotion.idleMaxSeconds, core.EMOTION_LIMITS.maxSeconds, 'and at the top');
  // An older settings file only had these three fields; folding them into the rows is what keeps a stored
  // preference working instead of silently resetting to 'react to everything'.
  eq(clampedEmotion.triggers.idle.enabled, false, 'the old idle switch folds into the idle row');
  eq(clampedEmotion.triggers.drag.enabled, true, 'while an absent onInteract leaves the drag row on');

  const legacyHold = core.cleanPreferences({ expressions: { emotion: { holdSeconds: 5 } } }).expressions.emotion;
  eq(legacyHold.triggers.click.holdSeconds, 5, 'and an old shared duration seeds every row');
  eq(legacyHold.triggers.idle.holdSeconds, 5, 'including the idle one');

  const clampedRow = core.cleanPreferences({
    expressions: {
      emotion: {
        triggers: {
          idle: { holdSeconds: 999, emotions: ['happy', 'happy', '', 'angry', 42] },
          drag: { holdSeconds: -3 },
          nonsense: { enabled: true },
        },
      },
    },
  }).expressions.emotion;
  eq(clampedRow.triggers.idle.holdSeconds, core.EMOTION_LIMITS.maxHoldSeconds, 'a row duration is clamped');
  same(clampedRow.triggers.idle.emotions, ['happy', 'angry'],
    'a row keeps the model labels it was given, once each and only real strings');
  eq(clampedRow.triggers.drag.holdSeconds, 0, 'and a negative duration becomes the hold value, 0');
  same(Object.keys(clampedRow.triggers).sort(), ['click', 'drag', 'hold', 'idle'],
    'a trigger nobody knows about is dropped rather than stored');
  /**
   * The same rules for a PART's emotion row, and the one thing it adds: the row is reached by the part's ID, so
   * a hand-edited file cannot grow a row the settings page would never show.
   */
  const partedPrefs = core.cleanPreferences({
    parts: {
      seeded: core.STRUCTURE_REGIONS,
      items: [
        { id: 'eye', region: 'eye', emotion: { holdSeconds: 999, emotions: ['happy', 'happy', ''] } },
        { id: 'head', region: 'head', emotion: { enabled: false } },
        { id: 'gone', region: 'nonsense', emotion: { enabled: true, emotions: ['happy'] } },
      ],
    },
  });
  const partRows = partedPrefs.parts.items;
  eq(partRows[0].emotion.holdSeconds, core.EMOTION_LIMITS.maxHoldSeconds, 'a part row clamps its duration too');
  same(partRows[0].emotion.emotions, ['happy'], 'and keeps the labels it was given, once each');
  eq(partRows[1].emotion.enabled, false, 'a part row can be switched off');
  eq(partRows[2].region, null, 'while a region nothing knows is not stored as one');
  eq(partRows.length, 3, 'and the list is exactly what the user wrote');

  const prefs = core.cleanPreferences({});
  core.setEmotionTrigger(prefs, 'click', { emotions: ['TiePen', 'happy'], holdSeconds: 0 });
  same(prefs.expressions.emotion.triggers.click.emotions, ['TiePen', 'happy'],
    'a row can name a CUSTOM expression the model declares, not just the VRM presets');
  eq(prefs.expressions.emotion.triggers.click.holdSeconds, 0,
    'and the duration 0 is stored as an instruction, not as absence');
  eq(core.setEmotionTrigger(prefs, 'nonsense', { enabled: false }), null,
    'an unknown trigger is refused');
  core.setEmotionTrigger(prefs, 'drag', { emotions: ['angry', 'angry', 'sad', 'sad'] });
  same(prefs.expressions.emotion.triggers.drag.emotions, ['angry', 'sad'], 'and a row never repeats a label');
  // A patch that only names emotions must leave that row's duration alone, or moving a checkbox would
  // quietly turn a reaction into a mood.
  const beforePatch = prefs.expressions.emotion.triggers.click.holdSeconds;
  core.setEmotionTrigger(prefs, 'click', { emotions: ['happy'] });
  eq(prefs.expressions.emotion.triggers.click.holdSeconds, beforePatch,
    'and naming emotions does not disturb the duration');
  ok(core.BLINK_EXPRESSIONS.includes('blink') && core.MOUTH_EXPRESSIONS.length === 10,
    'the behaviours name the VRM presets they drive, so the panel can say what a switch will try');
  /**
   * AND IN BOTH SPELLINGS VRM HAS USED (operator, 2026-10-13: 「状态与动作中，每个动作的表情和口型设置始终是空的，必须动态从
   * 模型上加载」).
   *
   * Listing only VRM 1.0's `aa`/`ih`/`ou`/`ee`/`oh` is half of that bug: the bundled `SampleModel.vrm` is a VRM 0.x
   * file whose mouth shapes are preset-keyed `a`/`i`/`u`/`e`/`o` with labels `A`/`I`/`U`/`E`/`O`, so its 口型 dropdown
   * was empty and its mouth shapes were offered as mood rows. Measured against the file itself, not assumed.
   */
  ok(['a', 'i', 'u', 'e', 'o'].every((name) => core.MOUTH_EXPRESSIONS.includes(name)),
    'and the VRM 0.x spellings of the mouth shapes are in the list too, not only the 1.0 ones');
  ok(['blink_l', 'blink_r'].every((name) => core.BLINK_EXPRESSIONS.includes(name)),
    'with the 0.x split blinks, which the emotion table must not offer as moods either');
  ok((core.BEHAVIOUR_EXPRESSIONS || []).indexOf('blink') !== -1
    && (core.BEHAVIOUR_EXPRESSIONS || []).indexOf('aa') !== -1
    && (core.BEHAVIOUR_EXPRESSIONS || []).indexOf('a') !== -1
    && (core.BEHAVIOUR_EXPRESSIONS || []).indexOf('lookUp') !== -1,
    'and the expressions other behaviours own are listed apart, so the emotion table cannot offer them');
  ok(!('EMOTION_EXPRESSIONS' in core),
    'there is no hardcoded mood vocabulary left: the labels come from the model file');

  // ---- spring overrides ----------------------------------------------------
  // Per model, per chain, per FIELD: an absent field means "the number the file declares", which is
  // what the UI calls the default. A missing field must therefore stay missing.
  same(core.cleanPreferences({}).springs, {}, 'no spring is overridden until the user moves a slider');
  const withSprings = core.cleanPreferences({
    springs: {
      m2: { DaiMao: { stiffness: 9, dragForce: 0.7 }, WeiBa: {}, Empty: { nonsense: 1 } },
      '': { x: { stiffness: 1 } },
    },
  });
  same(withSprings.springs, { m2: { DaiMao: { stiffness: core.SPRING_LIMITS.stiffness.max, dragForce: 0.7 } } },
    'overrides are clamped, empty groups and unusable ids are dropped');
  eq(core.springOverrideFor(withSprings, 'm2', 'WeiBa'), null,
    'a chain with no override reports null, which is what "use the default" means');
  eq(core.springOverrideFor(withSprings, 'm2', 'DaiMao').stiffness, core.SPRING_LIMITS.stiffness.max,
    'and a chain that has one reports it');
  eq(core.springOverrideFor(withSprings, 'other', 'DaiMao'), null, 'overrides do not leak between models');
  eq(core.springOverrideFor(withSprings, 'm2', 'DaiMao').dragForce !== undefined, true,
    'a field the user did not touch is simply absent, so it keeps the file value');
  eq(core.springOverrideFor(withSprings, 'm2', 'DaiMao').gravityPower, undefined,
    'exactly: gravity was never pinned to whatever the panel happened to show');

  /**
   * ---- the storage key, and the RENAME that moved it (2026-10-12) -----------
   *
   * The project was renamed, so the browser key moved from `dsh.pet3d.v1` to `dsh.vrmpet3d.v1`. A rename that
   * dropped the old key would throw away every setting on the first load — so the readers try the current name
   * first and the old one after it, while the WRITERS use `STORAGE_KEY` only (one answer, migrated on the first
   * edit). This group is the assertion for that promise; it is also what the two surfaces' `followStorage`
   * handlers lean on when a document still running an older chunk fires a `storage` event under the old key.
   */
  const fakeStorage = (map) => ({
    getItem: (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null),
    setItem: (key, value) => { map[key] = String(value); },
  });
  eq(core.STORAGE_KEY, 'dsh.vrmpet3d.v1', 'the delivered key carries the project\'s new name');
  same(core.LEGACY_STORAGE_KEYS, ['dsh.pet3d.v1'], 'and the pre-rename key is remembered as the legacy one');
  const bothKeys = fakeStorage({ 'dsh.vrmpet3d.v1': '{"size":123}', 'dsh.pet3d.v1': '{"size":1}' });
  eq(core.storedPreferences(bothKeys).key, 'dsh.vrmpet3d.v1', 'the CURRENT key wins when both are present');
  const legacyOnly = fakeStorage({ 'dsh.pet3d.v1': '{"size":42}' });
  eq(JSON.stringify(core.storedPreferences(legacyOnly)), JSON.stringify({ key: 'dsh.pet3d.v1', raw: '{"size":42}' }),
    'and a profile written before the rename is still read, key and bytes');
  eq(core.cleanPreferences(JSON.parse(core.storedPreferences(legacyOnly).raw)).size, 42,
    'which is what makes the rename a migration rather than a reset');
  eq(core.storedPreferences(fakeStorage({})), null, 'nothing stored answers null, not an empty object');
  eq(core.storedPreferences(null), null, 'and neither does a surface with no storage at all');
  eq(core.isStorageKey(core.STORAGE_KEY), true, 'a storage event under the current key is ours');
  eq(core.isStorageKey('dsh.pet3d.v1'), true, 'and one under the legacy key is ours too');
  eq(core.isStorageKey('dsh.other.v1'), false, 'while an unrelated key is ignored, as it always was');
}

// ---------------------------------------------------------------------------
group('6. state machine precedence');
// ---------------------------------------------------------------------------
{
  let clock = 1_000_000;
  const now = () => clock;
  const machine = new core.PetMachine(now, 120000);

  const onlineIdle = { available: true, running: false, pending: false };
  const offline = { available: false, running: false, pending: false };
  const working = { available: true, running: true, pending: false };
  const waiting = { available: true, running: true, pending: true };

  eq(machine.resolve(onlineIdle), 'resting', 'idle online pet rests');
  eq(machine.resolve(working), 'working', 'a running turn works');
  eq(machine.resolve(waiting), 'waiting', 'a pending approval outranks working');
  eq(machine.resolve(offline), 'offline', 'a disconnected host is offline');

  /**
   * A completion WAITS OUT its settle window — and a new turn inside that window cancels it.
   *
   * Operator, 2026-10-11: "经常会完成一个子任务就清零显示任务达成，然后马上重新开始了，但是整个任务并没做完". A TASK is not
   * a turn: automatic continuation, a queued follow-up or a steering message ends one turn and starts the next within
   * a second, so a `turn/end` is only a completion if nothing starts again — for the same session — in
   * `COMPLETION_SETTLE_MS`. Driven through the same boundary events the client actually pumps.
   */
  machine.boundary({ type: 'turn/start', sessionId: 's', seq: 1, reason: 'completed' });
  eq(machine.resolve(working), 'working', 'a turn start is just work');
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 2, reason: 'completed' });
  eq(machine.resolve(onlineIdle), 'resting',
    'a completion is WITHHELD while its settle window runs, rather than flashing 任务达成 between rounds');
  // …and the next round cancels it outright: the task is not over.
  machine.boundary({ type: 'turn/start', sessionId: 's', seq: 3, reason: 'completed' });
  clock += core.COMPLETION_SETTLE_MS + 1;
  eq(machine.resolve(working), 'working', 'and a turn starting inside that window CANCELS it');
  eq(machine.notice, undefined, 'so there is no notice left to appear later');
  eq(machine.pendingNotice, undefined, 'and nothing is still waiting');

  // A completion nothing follows shows 任务完成 once the window has passed.
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 4, reason: 'completed' });
  clock += core.COMPLETION_SETTLE_MS + 1;
  eq(machine.resolve(onlineIdle), 'done', 'a fresh completion shows as done once nothing started again');
  clock += core.NOTICE_WINDOW_MS + 1;
  eq(machine.resolve(onlineIdle), 'resting', 'a stale completion stops showing as done');

  /**
   * A completion that was SHOWN and then taken back makes the next one wait LONGER — the flash/retract cooldown.
   *
   * Operator, 2026-10-14: 「刚刚的任务结束后，桌宠短暂出现了一下成功状态，但是焦点还没有切换回DSH成功状态就消失了，而且还会
   * 反复跳出"深度求索中…"」. A long task whose rounds are further apart than the base window showed 任务达成 in every quiet
   * gap, and the next round took it away again — flash, retract, flash, retract. A completion taken back was therefore
   * PREMATURE, and the honest response is to demand more quiet before saying it again FOR THAT SESSION: 4 s, 8, 16 —
   * capped, because a real end still has to be announced while the user is looking at the desk.
   *
   * The debt is per SESSION, and the two ways out are asserted here too: a completion the user actually saw clears it,
   * and so does time.
   */
  {
    // Its OWN clock: this block drives a machine through several minutes, and the shared `clock` is what the
    // assertions after it are positioned against.
    let flapClock = 100000;
    const flap = new core.PetMachine(() => flapClock, 120000);
    const idle = { available: true, running: false, pending: false, currentSessionId: 'other' };
    const busy = { available: true, running: true, pending: false, currentSessionId: 's1', runningSince: flapClock };
    eq(flap.settleFor('s1'), core.COMPLETION_SETTLE_MS, 'a session with no history waits the shipped window');
    // Round one: end, settle, SHOWN, then the next round takes it back. The user is looking at ANOTHER session
    // (`idle`), which is what keeps the notice alive: presence in the notice's own session is the acknowledgement.
    flap.boundary({ type: 'turn/start', sessionId: 's1', seq: 1, reason: 'completed' });
    flap.boundary({ type: 'turn/end', sessionId: 's1', seq: 2, reason: 'completed' });
    eq(flap.resolve(idle), 'resting', 'nothing is announced before the window passes');
    flapClock += core.COMPLETION_SETTLE_MS + 1;
    eq(flap.resolve(idle), 'done', 'a quiet gap is announced');
    flap.boundary({ type: 'turn/start', sessionId: 's1', seq: 3, reason: 'completed' });
    eq(flap.resolve(busy), 'working', 'and the round that follows takes it back');
    eq(flap.settleFor('s1'), core.COMPLETION_SETTLE_MS * 2,
      `which makes the next completion in that session wait twice as long (${flap.settleFor('s1')} ms)`);
    // Round two: the same gap length is now NOT enough to be a completion…
    flap.boundary({ type: 'turn/end', sessionId: 's1', seq: 4, reason: 'completed' });
    flapClock += core.COMPLETION_SETTLE_MS + 1;
    eq(flap.resolve(idle), 'resting', 'so the same quiet gap no longer flashes 任务达成');
    // …and the longer window really does promote it.
    flapClock += core.COMPLETION_SETTLE_MS + 1;
    eq(flap.resolve(idle), 'done', 'until the longer window has really passed');
    // A second retraction doubles it again, up to the ceiling.
    flap.boundary({ type: 'turn/start', sessionId: 's1', seq: 5, reason: 'completed' });
    flap.resolve(busy);
    eq(flap.retractions.s1, 2, 'and a second flash is remembered too');
    eq(flap.settleFor('s1'), core.COMPLETION_SETTLE_MAX_MS,
      `the ceiling is reached rather than growing for ever (${flap.settleFor('s1')} ms)`);
    // The debt belongs to ONE session: another session's completion is unaffected.
    eq(flap.settleFor('s2'), core.COMPLETION_SETTLE_MS, 'another session still waits the shipped window');
    // Time forgets it, so an hour of flashing cannot silence the pet for the rest of the day.
    flapClock += 60 * 60 * 1000 + 1;
    eq(flap.settleFor('s1'), core.COMPLETION_SETTLE_MS, 'and a session whose debt is old waits the shipped window again');
  }
  {
    // A completion the user SAW is not a premature one: going back to the session pays the debt.
    let seenClock = 200000;
    const seen = new core.PetMachine(() => seenClock, 120000);
    const present = { available: true, running: false, pending: false, currentSessionId: 's1' };
    seen.boundary({ type: 'turn/start', sessionId: 's1', seq: 1, reason: 'completed' });
    seen.boundary({ type: 'turn/end', sessionId: 's1', seq: 2, reason: 'completed' });
    seenClock += core.COMPLETION_SETTLE_MS + 1;
    eq(seen.resolve(present), 'done', 'a completion in the session the user is watching is announced');
    seen.boundary({ type: 'turn/start', sessionId: 's1', seq: 3, reason: 'completed' });
    seen.resolve(present);
    eq(seen.settleFor('s1'), core.COMPLETION_SETTLE_MS * 2, 'a retracted completion leaves a debt');
    seen.boundary({ type: 'turn/end', sessionId: 's1', seq: 4, reason: 'completed' });
    seenClock += core.COMPLETION_SETTLE_MS * 2 + 1;
    eq(seen.resolve(present), 'done', 'the grown window passes and the completion is announced');
    seenClock += core.NOTICE_WINDOW_MS + 1;
    seen.resolve(present);
    eq(seen.settleFor('s1'), core.COMPLETION_SETTLE_MS, 'and the user being back in the session clears the debt');
  }
  {
    /**
     * WHY a notice ended is recorded, because the operator's 2026-10-14 report is otherwise unanswerable.
     *
     * 「尽管我的焦点全程都在其他应用，dsh 工作完成后，任务完成的状态只持续了几秒钟，就自己消失了，而并没有任何新的任务在跑」 — measured, the
     * notice lasted exactly the minimum hold and the pet went back to 静息态. With no new work, exactly two rules can do
     * that, and they are indistinguishable on screen: the presence+focus acknowledgement, and the old timer rule that
     * applies when there is no session identity to compare. `lastDismissal` names the one that fired and prints the
     * values it read, so that report becomes a fact instead of an argument.
     */
    let whyClock = 300000;
    const whyMachine = new core.PetMachine(() => whyClock, 120000);
    const here = { available: true, running: false, pending: false, currentSessionId: 's1' };
    whyMachine.boundary({ type: 'turn/end', sessionId: 's1', seq: 1, reason: 'completed' });
    whyClock += core.COMPLETION_SETTLE_MS + 1;
    eq(whyMachine.resolve(here), 'done', 'a completion in the session the user is in is announced');
    whyClock += core.NOTICE_WINDOW_MS + 1;
    whyMachine.setFocus(false);
    whyMachine.resolve(here);
    eq(whyMachine.lastDismissal === undefined, true,
      'and NOTHING dismisses it while DSH has no focus and the session is unchanged');
    whyMachine.setFocus(true);
    whyMachine.resolve(here);
    eq(whyMachine.lastDismissal && whyMachine.lastDismissal.kind, 'acknowledged',
      'while coming back to the session WITH focus records the rule that ended it');
    eq(whyMachine.lastDismissal.focused, true, 'and the focus value it read');
    eq(whyMachine.lastDismissal.presentId, 's1', 'and the session it compared against');

    // The OTHER rule: no session identity to compare, so it waits for the user to be back at DSH — and NEVER expires on
    // the clock alone. That timer shape is exactly what the operator's report measured (`kind: expired`, `focused: false`,
    // `presentId: null`, `running: false`): 任务达成 vanished four seconds after it appeared while his focus was in
    // another application and nothing was running.
    const blind = new core.PetMachine(() => whyClock, 120000);
    const nowhere = { available: true, running: false, pending: false };
    blind.boundary({ type: 'turn/end', sessionId: 's1', seq: 1, reason: 'completed' });
    whyClock += core.COMPLETION_SETTLE_MS + 1;
    eq(blind.resolve(nowhere), 'done', 'a completion with no session context is still announced');
    blind.setFocus(false);
    whyClock += core.NOTICE_WINDOW_MS + 1;
    eq(blind.resolve(nowhere), 'done', 'and it does NOT expire on the hold while the user is elsewhere');
    eq(blind.lastDismissal === undefined, true, 'so nothing was dismissed by the clock');
    blind.setFocus(true);
    eq(blind.resolve(nowhere), 'resting', 'while coming back to DSH clears it');
    eq(blind.lastDismissal && blind.lastDismissal.kind, 'focus-return',
      'and the record names the path, which is why a session id matters');
    eq(blind.lastDismissal.presentId, null, 'with the missing side named');
  }

  /**
   * 任务完成 lasts as long as the 状态 settings ask — with the notice window as the FLOOR.
   *
   * The operator's report was that the 持续时间 field "只可能把它缩短": the state was gated by
   * `NOTICE_WINDOW_MS` alone, so a 30-second 任务达成 line vanished after 4.2 s and the pet went back to
   * 静息态. `doneWindowMs` reads that one number out of the CURRENT preferences (through `preferencesOf`,
   * which is what the widget wires up), and everything shorter than the window is left alone because the
   * window is also the deferral budget that keeps a completion arriving mid-drag from being lost.
   */
  {
    eq(core.doneWindowMs(null), core.NOTICE_WINDOW_MS, 'with no preferences at all the shipped window stands');
    eq(core.doneWindowMs(core.cleanPreferences({})), core.NOTICE_WINDOW_MS,
      'and an unconfigured 任务完成 line keeps it too');
    eq(core.doneWindowMs(core.cleanPreferences({ status: { done: { seconds: 30 } } })), 30000,
      'a configured 持续时间 becomes the window');
    eq(core.doneWindowMs(core.cleanPreferences({ status: { done: { seconds: 2 } } })), core.NOTICE_WINDOW_MS,
      'and a duration shorter than the notice window cannot cut it below the floor');
    eq(core.doneWindowMs(core.cleanPreferences({ status: { done: { text: '' } } })), core.NOTICE_WINDOW_MS,
      'an EMPTY done line still holds the state: the state is the turn finishing, not the words');

    let extendedClock = 9_000_000;
    const extended = new core.PetMachine(() => extendedClock, 300000);
    const extendedPrefs = core.cleanPreferences({ status: { done: { seconds: 30 } } });
    extended.preferencesOf = () => extendedPrefs;
    extended.boundary({ type: 'turn/end', sessionId: 's', seq: 1, reason: 'completed' });
    extendedClock += core.COMPLETION_SETTLE_MS + 1;
    eq(extended.resolve(onlineIdle), 'done', 'the extended machine enters 任务完成');
    extendedClock += core.NOTICE_WINDOW_MS + 1;
    eq(extended.resolve(onlineIdle), 'done', 'and is STILL there one notice window later');
    eq(core.statusFor(extendedPrefs, 'done', extendedClock - core.NOTICE_WINDOW_MS - 1, extendedClock).text,
      '任务达成', 'with its own line up for the whole configured time');
    extendedClock += 30000;
    eq(extended.resolve(onlineIdle), 'resting', 'and it lets go once the configured seconds are up');

    // The readout is per frame, so an edit made while the pet runs applies without a restart.
    let liveClock = 8_000_000;
    const live = new core.PetMachine(() => liveClock, 300000);
    const livePrefs = core.cleanPreferences({});
    live.preferencesOf = () => livePrefs;
    live.boundary({ type: 'turn/end', sessionId: 's', seq: 1, reason: 'completed' });
    liveClock += core.COMPLETION_SETTLE_MS + 1;
    eq(live.resolve(onlineIdle), 'done', 'a completion with no configured duration shows done');
    livePrefs.status = core.setStatus(livePrefs, 'done', 'seconds', 60);
    liveClock += core.NOTICE_WINDOW_MS + 1;
    eq(live.resolve(onlineIdle), 'done',
      'and a 持续时间 typed while it is up extends it on the very next frame, with no restart');
  }

  // A failure outranks a nearby completion and latches until the next turn.
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 2, reason: 'error' });
  eq(machine.resolve(onlineIdle), 'error', 'a failure shows as error');
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 3, reason: 'completed' });
  eq(machine.resolve(onlineIdle), 'error', 'a success does not erase a latched failure');
  clock += 10 * core.NOTICE_WINDOW_MS;
  eq(machine.resolve(onlineIdle), 'error', 'a latched failure outlives the notice window');
  machine.boundary({ type: 'turn/start', sessionId: 's', seq: 4 });
  eq(machine.resolve(working), 'working', 'a new turn clears the failure and works again');
  machine.clear();

  // A subagent boundary must not reach the pet at all.
  machine.boundary({ type: 'turn/end', sessionId: 'child', seq: 9, reason: 'error', isSubagent: true });
  eq(machine.notice, undefined, 'a subagent boundary is ignored');
  /**
   * `boundary(event)` alone still re-resolves the state — the completion just waits out its settle window first.
   *
   * The call WITHOUT a snapshot resolves against the last one, so this is also the shape the client uses: the frame
   * arrives, the state is re-decided on the spot, and a completion that nothing follows appears a few seconds later.
   */
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 10, reason: 'completed' });
  clock += core.COMPLETION_SETTLE_MS + 1;
  /**
   * A bare event re-resolves against the LAST snapshot — `working`, from the failure block above — and since
   * 2026-10-13 work outranks a completion, so 进行中 is what it answers. The completion is not gone: the same frame
   * with nothing running shows it.
   */
  eq(machine.boundary({}), 'working', 'boundary(event) alone re-resolves against the last snapshot, and work wins');
  eq(machine.resolve(onlineIdle), 'done', 'while an idle snapshot shows the completion that was waiting');

  // Greeting outranks offline and working but not an interaction.
  machine.greet();
  eq(machine.resolve(offline), 'greeting', 'a click greeting outranks offline');
  machine.setInteraction('held');
  eq(machine.resolve(onlineIdle), 'held', 'being held outranks a greeting');
  machine.setInteraction('falling');
  eq(machine.resolve(working), 'falling', 'falling outranks working');
  machine.setInteraction('landing');
  eq(machine.resolve(waiting), 'landing', 'landing outranks waiting');
  machine.setInteraction(null);
  machine.greetingUntil = 0;

  // Sleeping after the nap timeout, and waking on activity.
  clock += 120001;
  eq(machine.resolve(onlineIdle), 'sleeping', 'an idle pet eventually sleeps');
  eq(machine.resolve(working), 'working', 'a busy session wakes the pet');
  eq(machine.resolve(onlineIdle), 'resting', 'and it stays awake shortly after');
}

// ---------------------------------------------------------------------------
group('6b. the waiting latch, the pending kind, and coming back to DSH');
// ---------------------------------------------------------------------------
{
  let clock = 5_000_000;
  const machine = new core.PetMachine(() => clock, 300000);
  const idle = { available: true, running: false, pending: false };
  const question = { available: true, running: true, pending: true, pendingKind: 'question' };
  const approval = { available: true, running: true, pending: true, pendingKind: 'approval' };

  eq(machine.resolve(approval), 'waiting', 'a pending approval waits for confirmation');
  eq(machine.pendingKind, 'approval', 'and its kind travels with it, so 需要你的授权 can be told apart');
  eq(machine.resolve(question), 'waiting', 'a pending question waits too');
  eq(machine.pendingKind, 'question', 'with its own kind');

  /**
   * The operator's rule, verbatim: "等待确认状态必须完成确认项目后才可以跳转出来". Nothing may move the pet out of
   * 等待确认 while the interaction is still unanswered — and the two things that would otherwise do it are
   * exactly the two the cascade normally ranks HIGHER: a failure and a completion.
   */
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 1, reason: 'error' });
  eq(machine.resolve(question), 'waiting', 'a failure while a question is pending does not leave 等待确认');
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 2, reason: 'completed' });
  eq(machine.resolve(approval), 'waiting', 'nor does a completion');
  machine.setInteraction('held');
  eq(machine.resolve(question), 'held', 'a drag still owns the pose, because that is the user’s own hand');
  machine.setInteraction(null);

  // Answered: the latch releases, and the same frame's cascade decides where to go — here, the failure that
  // was waiting behind it, because a latched error outlives the notice window.
  eq(machine.resolve(idle), 'error', 'answering releases the latch, and the failure behind it shows');
  eq(machine.pendingKind, null, 'and the pending kind is dropped with the state');
  machine.clear();
  eq(machine.resolve(idle), 'resting', 'and the pet rests once the failure is dismissed');

  // Coming back to DSH ends a 任务完成 or 出错 prompt: "用户切换回dsh为焦点后恢复到空闲状态".
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 3, reason: 'completed' });
  clock += core.COMPLETION_SETTLE_MS + 1;
  eq(machine.resolve(idle), 'done', 'a completion shows while the user is away');
  machine.setFocus(false);
  eq(machine.resolve(idle), 'done', 'losing focus does not clear it');
  eq(machine.setFocus(true), 'resting', 'regaining focus returns the pet to the idle state');
  eq(machine.notice, undefined, 'and the notice is gone, not merely hidden');

  // The same for a latched failure — the other case the operator named.
  machine.boundary({ type: 'turn/end', sessionId: 's', seq: 4, reason: 'error' });
  eq(machine.resolve(idle), 'error', 'a failure latches');
  machine.setFocus(false);
  machine.setFocus(true);
  eq(machine.state, 'resting', 'and coming back to DSH clears that too');

  /**
   * But NOT 等待确认: an unanswered question is still unanswered whether or not the window has focus, and
   * clicking back into DSH is exactly how the user reaches the prompt they are being asked about.
   */
  eq(machine.resolve(question), 'waiting', 'a question arrives');
  machine.setFocus(false);
  machine.setFocus(true);
  eq(machine.state, 'waiting', 'coming back to DSH does not dismiss a pending question');
  eq(machine.resolve(idle), 'resting', 'only answering it does');
}

// ---------------------------------------------------------------------------
group('6b2. a finished turn waits for the user to come back to ITS session');
// ---------------------------------------------------------------------------
/**
 * The operator's rule, verbatim (2026-10-11): "任务达成…一直持续直到用户切换回已经达成任务/失败的会话中；同理，
 * 等待确认要让用户回答完问题/确认完权限后才消失."
 *
 * Driven through the REAL chain — `SessionAggregate` (which knows DSH's session statuses) → snapshot → machine —
 * rather than by poking the machine, because the two halves have to agree about which session the notice is
 * ABOUT: the aggregate writes `notice.sessionId`, the snapshot carries `currentSessionId`, and the machine is
 * the one that decides the user has come back.
 */
{
  let clock = 9_000_000;
  const catalog = { phase: 'ready', byId: { A: {}, B: {} } };
  const aggregate = new core.SessionAggregate(() => clock);
  const machine = new core.PetMachine(() => clock, 300_000);
  let holdPrefs = core.cleanPreferences({});
  machine.preferencesOf = () => holdPrefs;
  const statuses = new Map([['A', { running: true }], ['B', { running: true }]]);
  /** One frame: install the world, then let the machine read the snapshot it produces. */
  const frame = (currentSessionId) => {
    aggregate.setInput({ catalog, statuses, connected: true, scope: 'global', currentSessionId });
    return machine.resolve(aggregate.snapshot());
  };

  eq(frame('B'), 'working', 'the second session is busy, so the pet works');
  /**
   * A finishes while the user is looking at B, and DSH marks that completion UNREAD — the green dot in its session list.
   *
   * This is the case the two 2026-10-13 rules are about: the pet stays on 进行中 (the completion does not interrupt a
   * running task) and shows DSH's unread dot, while the completion itself waits for the user to go back to A.
   */
  statuses.set('A', { running: false, completionUnread: true });
  eq(frame('B'), 'working', 'A finishing is withheld while its settle window runs');
  clock += core.COMPLETION_SETTLE_MS + 1;
  eq(frame('B'), 'working', 'and B still running keeps the pet on 进行中, whatever A did');
  eq(machine.notice && machine.notice.sessionId, 'A', 'while the notice remembers WHICH session finished');
  eq(machine.unreadCount, 1, 'and DSH’s unread flag for it is what the prompt’s green dot is drawn from');

  clock += 60_000;
  eq(frame('B'), 'working', 'a minute later the dot is still there');
  eq(machine.notice && machine.notice.sessionId, 'A', 'and so is the completion behind it');

  /**
   * The REST is the machine's own rules, driven directly rather than through the aggregate.
   *
   * The aggregate writes a notice of its own for any session whose `running` falls (that is how it hears a turn end
   * with no RPC boundary), so stopping B here to see 任务达成 would hand the machine B's notice instead of A's — a test
   * of the fixture rather than of the rule. What the aggregate owns is already asserted above: the unread flag, and
   * work outranking a completion.
   */
  let soloPrefs = core.cleanPreferences({});
  const solo = new core.PetMachine(() => clock, 300_000);
  solo.preferencesOf = () => soloPrefs;
  const inA = { available: true, running: false, pending: false, currentSessionId: 'A' };
  const inB = { available: true, running: false, pending: false, currentSessionId: 'B' };

  solo.boundary(inA, { type: 'turn/end', sessionId: 'A', seq: 1, reason: 'completed' });
  clock += core.COMPLETION_SETTLE_MS + 1;
  eq(solo.resolve(inB), 'done', 'and with nothing running the completion shows as 任务达成');
  clock += 3_600_000;
  eq(solo.resolve(inB), 'done', 'an hour later it is still there — the user has not been back to A');
  eq(solo.resolve(inB), 'done', 'and looking at B again does not acknowledge it');

  /**
   * The user goes back to A — WITH THE DSH WINDOW FOCUSED — and that is the acknowledgement (2026-10-13: 「必须切换dsh窗口
   * 为焦点且回到已完成的会话才消失」). Both halves are asserted, because either one alone would clear the line for
   * somebody who was in another application and saw nothing.
   */
  solo.setFocus(false);
  eq(solo.resolve(inA), 'done', 'being in the session is not enough while DSH is in the background');
  solo.setFocus(true);
  eq(solo.resolve(inA), 'resting', 'focus plus that session is what acknowledges it');
  eq(solo.notice, undefined, 'the notice is gone, not merely hidden');
  eq(solo.resolve(inB), 'resting', 'and it does not come back when the user moves on');

  /**
   * The hold is a FLOOR, not an expiry: a duration the user raised means the line is guaranteed that long even
   * when they are already in the session — which is how somebody asks for a longer look at it.
   */
  soloPrefs = core.cleanPreferences({ status: { done: { seconds: 30 } } });
  clock += 1_000;
  solo.boundary(inA, { type: 'turn/end', sessionId: 'A', seq: 2, reason: 'completed' });
  clock += core.COMPLETION_SETTLE_MS + 1;
  eq(solo.resolve(inA), 'done', 'a new completion in A shows while the user is right there');
  clock += 10_000;
  eq(solo.resolve(inA), 'done', 'and a raised 持续时间 holds it for at least that long');
  clock += 21_000;
  eq(solo.resolve(inA), 'resting', 'after which being in the session clears it');

  /**
   * 出错 takes the same road — the operator named both — with the latch it always had about which notice wins.
   *
   * B is running again here, and the failure still outranks it: 出错 is not a completion, so the 进行中 rule above does
   * not apply to it.
   */
  statuses.set('B', { running: true });
  clock += 1_000;
  machine.boundary(aggregate.snapshot(), { type: 'turn/end', sessionId: 'A', seq: 8, reason: 'error' });
  eq(frame('B'), 'error', 'a failure in A shows while the user is in B');
  clock += 600_000;
  eq(frame('B'), 'error', 'and stays there, however long they take');
  eq(frame('A'), 'working', 'until they are back in A too');

  /**
   * A turn somewhere ELSE must not erase it: work continuing in B is exactly the case the rule exists for.
   */
  clock += 1_000;
  machine.boundary(aggregate.snapshot(), { type: 'turn/end', sessionId: 'A', seq: 9, reason: 'error' });
  eq(frame('B'), 'error', 'an unacknowledged failure is up again');
  machine.boundary(aggregate.snapshot(), { type: 'turn/start', sessionId: 'B', seq: 10 });
  eq(machine.notice !== undefined, true, 'a turn starting in B does NOT erase A’s failure');
  machine.boundary(aggregate.snapshot(), { type: 'turn/start', sessionId: 'A', seq: 11 });
  eq(machine.notice, undefined, 'but a new turn in A supersedes its own notice');
}

// ---------------------------------------------------------------------------
group('6b3. 等待确认 survives the clock, and so does the prompt it draws');
// ---------------------------------------------------------------------------
{
  let clock = 12_000_000;
  const machine = new core.PetMachine(() => clock, 300_000);
  machine.preferencesOf = () => core.cleanPreferences({});
  const pending = { available: true, running: true, pending: true, pendingKind: 'approval', currentSessionId: 'A' };
  eq(machine.resolve(pending), 'waiting', 'a permission prompt puts the pet in 等待确认');
  for (let i = 0; i < 120; i += 1) { clock += 60_000; machine.resolve(pending); }
  eq(machine.state, 'waiting', 'two hours later it is STILL waiting: only the answer ends it');
  const line = core.statusFor(core.cleanPreferences({}), 'waiting', clock, clock + 999_999);
  eq(line !== null && line.text, '我有问题要问你',
    'and the line it draws has not expired either, even though it is the state’s own longest-lived text');
  eq(machine.resolve({ available: true, running: false, pending: false, currentSessionId: 'A' }), 'resting',
    'answering it is what releases the pet');
}

// ---------------------------------------------------------------------------
group('6c. the per-state status prompt');
// ---------------------------------------------------------------------------
{
  const blank = core.cleanPreferences({});
  same(core.STATUS_STATES, ['resting', 'working', 'waiting', 'done', 'error', 'offline'],
    'the six states the user configures are the operator’s six, in order');
  same(core.MOTION_STATES, core.STATUS_STATES.concat(core.INTERACTION_STATES),
    'and the motion map is those six plus the three pointer poses, derived rather than written twice');
  eq(core.MOTION_STATES.length, 9, 'nine states carry a 状态与动作 row');
  /**
   * The 「默认」 answer for the per-clip 表情/口型 dropdowns (operator, 2026-10-13): a THIRD value beside "follow" (`''`)
   * and a name, meaning "no expression (or mouth) at all" — the model's own initial face, overriding both the clip's
   * declared face and the mood the state's row picked.
   */
  eq(core.MOTION_FACE_DEFAULT, 'none', '默认 is one named value, not a name spelled in three files');
  {
    const clipPrefs = core.cleanPreferences({ motionClips: { resting: { a1: { expression: core.MOTION_FACE_DEFAULT, mouth: core.MOTION_FACE_DEFAULT } } } });
    const clipEntry = core.motionClipFor(clipPrefs, 'resting', 'a1');
    eq(clipEntry && clipEntry.expression, core.MOTION_FACE_DEFAULT,
      'and it survives the store as a value, unlike an empty string which is DROPPED (that is "follow")');
    eq(core.motionClipFor(core.cleanPreferences({ motionClips: { resting: { a1: { expression: '' } } } }), 'resting', 'a1'), null,
      'while the follow answer stores nothing at all');
  }

  eq(core.statusLineFor(blank, 'working'), '深度求索中 ···',
    '工作态 ships DSH’s running line with NO clock (operator, 2026-10-13: 「深度求索中后面不加任何时间了」)');
  eq(core.statusLineFor(core.cleanPreferences({ status: { working: { text: '深度求索中，用时 {duration} ···' } } }), 'working'),
    '深度求索中，用时 {duration} ···',
    'while the clock token stays in the language: a line the user writes may still carry it');
  eq(core.statusLineFor(blank, 'waiting'), '我有问题要问你', '等待确认 asks the question');
  eq(core.statusLineFor(blank, 'done'), '任务达成', '任务完成 reports the completion');
  eq(core.statusLineFor(blank, 'error'), '遇到问题了...', '出错 reports the failure');
  eq(core.statusLineFor(blank, 'resting'), '', '空闲 says nothing by default');
  eq(core.statusLineFor(blank, 'offline'), '', 'and so does 离线');
  eq(core.statusEntryFor(blank, 'working').animation, 'shimmer',
    '工作态 ships DSH’s own blue sweep, because that is the prompt the operator quoted');
  eq(core.statusEntryFor(blank, 'done').animation, 'none',
    'a completion is a message rather than a live indicator');
  eq(core.statusEntryFor(blank, 'working').seconds, 0,
    'and 0 seconds means "for as long as the state lasts"');

  // ---- DSH's own running label, copied piece by piece ------------------------
  //
  // The operator asked for the app's line verbatim — "我要的是dsh内部的前面带着一个鲸鱼尾巴图标的'深度求索中，用时
  // XX分XX秒 ···'" — so these are the app's rules, not this repository's taste: `formatRunDuration` in
  // `dsh-client-ui-chat` emits whole seconds, minutes only from a full minute, hours only once there is one,
  // and the clock is floored at one second (`Math.max(1e3, now - startTime)`).
  eq(core.formatRunDuration(9000), '9秒', 'a nine-second turn reads 9秒');
  eq(core.formatRunDuration(14 * 60000 + 46000), '14分46秒', 'the operator’s own screenshot: 14分46秒');
  eq(core.formatRunDuration(59 * 1000), '59秒', 'under a minute there is no minutes part at all');
  eq(core.formatRunDuration(60000), '1分0秒', 'a full minute gains one');
  eq(core.formatRunDuration(3600000 + 2 * 60000 + 3000), '1小时2分3秒', 'and an hour gains an hours part');
  eq(core.formatRunDuration(46000, 'en'), '46s', 'the units follow the language, as the app’s i18n does');

  {
    const now = 1_800_000_000_000;
    const started = now - (14 * 60000 + 46000);
    /**
     * The CLOCK belongs to a line that carries the token, and the SHIPPED line no longer does (2026-10-13:
     * 「深度求索中后面不加任何时间了」). Nothing about the machinery changed — this is the line a user writes when they
     * want the app's clock back, and it is what every assertion below drives.
     */
    const clocked = core.cleanPreferences({ status: { working: { text: '深度求索中，用时 {duration} ···' } } });
    const line = core.statusFor(clocked, 'working', started, now);
    eq(line.text, '深度求索中，用时 14分46秒 ···', 'the prompt substitutes the live clock for the token');
    eq(line.icon, true, 'and 工作中 wears DSH’s whale mark');
    eq(core.statusFor(clocked, 'waiting', now, now).icon, false,
      'no other state wears it: the operator’s four lines are their own messages');
    eq(core.statusFor(clocked, 'working', now, now).text, '深度求索中，用时 1秒 ···',
      'a turn that has just begun reads one second, never zero — the app floors it there');
    eq(core.statusFor(clocked, 'working', undefined, now).text, '深度求索中，用时 1秒 ···',
      'and an unknowable start still substitutes rather than leaking the raw token');
    // The clock is what makes the prompt change by itself: same state, one second later, new words.
    eq(core.statusFor(clocked, 'working', started, now + 1000).text, '深度求索中，用时 14分47秒 ···',
      'the clock ticks by re-deriving the line, which is what the renderers re-key on');
    // And the shipped line has no clock in it, so there is nothing to tick.
    eq(core.statusFor(blank, 'working', started, now + 5000).text, '深度求索中 ···',
      'while the shipped line shows no clock at all, on any frame');
    // A line without the token is untouched, so a user’s own wording is still their own.
    const ownLine = core.cleanPreferences({});
    ownLine.status = core.setStatus(ownLine, 'working', 'text', '我在想…');
    eq(core.statusFor(ownLine, 'working', started, now).text, '我在想…',
      'a line the user wrote replaces DSH’s copy and carries no clock');
  }

  /**
   * AND THE TURN CLOCK, which is DSH's own rule rather than the state's age.
   *
   * Operator, 2026-10-11, after being shown DSH's implementation: "完全照搬 DSH：逐轮、turn 关闭时不显示用时". DSH counts
   * from the latest turn's `turn.start.time`, only while that turn is `open`; with it closed the label is the
   * token-free 「深度求索中」; and a settled turn reports `turn.end.time - turn.start.time`. Read out of
   * `@deepseek-ai/dsh-client-ui-chat/lib/client.js` (`RunningStatus`, `TurnProcessNodeView`).
   */
  {
    // The user's own clocked line again: the turn rules below are about the token's value, not about the default.
    const prefs = core.cleanPreferences({ status: { working: { text: '深度求索中，用时 {duration} ···' } } });
    const t0 = 2_000_000_000_000;
    // A turn that began four minutes ago, on a state that was entered seconds ago: the TURN is what is reported.
    const turnStart = t0 - 4 * 60000;
    eq(core.statusFor(prefs, 'working', t0 - 3000, t0, { startedAt: turnStart, endedAt: null }).text,
      '深度求索中，用时 4分0秒 ···',
      'an OPEN turn is counted from the turn’s own start, not from when the pet’s state changed');
    eq(core.statusFor(prefs, 'done', t0, t0, { startedAt: turnStart, endedAt: t0 }).text,
      '任务达成',
      'and the settled notice shows its own line');
    const settledLine = core.cleanPreferences({});
    settledLine.status = core.setStatus(settledLine, 'done', 'text', '任务达成，用时 {duration}');
    eq(core.statusFor(settledLine, 'done', t0, t0, { startedAt: turnStart, endedAt: t0 - 60000 }).text,
      '任务达成，用时 3分0秒',
      'a settled turn reports its OWN span — DSH’s 「用时 X」 row — not the time since it ended');
    /**
     * And with NO turn open, the clause goes: DSH ships two strings, and the token-free one is what it draws in the
     * gap between the rounds of one task. The pet has one user-written line, so its clause is removed instead.
     */
    eq(core.statusFor(prefs, 'working', t0, t0, null).text, '深度求索中 ···',
      'with no open turn the duration clause is DROPPED, which is DSH’s token-free 「深度求索中」');
    /**
     * …but the FALLBACK sentinel is a different answer: "no turn frames in this deployment, use the state's age".
     *
     * That is what keeps 用时 alive where the boundary stream is not wired — the live regression that this exists for.
     */
    eq(core.statusFor(prefs, 'working', t0 - 4 * 60000, t0, core.STATUS_CLOCK_FALLBACK).text,
      '深度求索中，用时 4分0秒 ···',
      'and the fallback sentinel measures from the state’s own entry time, so a stream-less pet still has a clock');
    eq(core.statusFor(prefs, 'done', t0 - 30000, t0, core.STATUS_CLOCK_FALLBACK).text, '任务达成',
      'which the notice states take as well, keeping their own line');
    eq(core.statusFor(prefs, 'working', turnStart, t0).text, '深度求索中，用时 4分0秒 ···',
      'while a caller that passes no clock at all keeps the older state-age behaviour');
  }

  /**
   * `PetMachine.statusClock()`: which of those three answers the machine is in.
   */
  {
    let clock = 3_000_000_000_000;
    const machine = new core.PetMachine(() => clock, 300000);
    const idle = { available: true, running: false, pending: false };
    /**
     * NO TURN EVER SEEN is not "no duration" — it is `'state'`, meaning "measure from the state's own age".
     *
     * This is the live regression of 2026-10-11: the boundary stream is an upgrade a plain-JavaScript plugin cannot
     * count on, the running app was measured returning `clock: null` for ever, and the pet therefore showed NO 用时 at
     * all — reported as "工作状态这下彻底不正常了，深度求索中的时间也没了". With no turn to be faithful to, the older clock is
     * the honest answer.
     */
    eq(machine.statusClock(), core.STATUS_CLOCK_FALLBACK,
      'a pet that has never seen a turn falls back to the STATE clock rather than to no duration');
    machine.boundary({ type: 'turn/start', sessionId: 's', seq: 1, time: clock - 5000 });
    const openClock = machine.statusClock();
    ok(Boolean(openClock), 'an open turn reports a clock at all');
    eq(openClock.startedAt, clock - 5000,
      'with the START the frame carried, which is DSH’s own timestamp — not when the pet noticed');
    eq(openClock.endedAt, null, 'and no end, because the turn is still open');
    machine.boundary({ type: 'turn/end', sessionId: 's', seq: 2, time: clock, reason: 'completed' });
    eq(machine.statusClock(), null,
      'a closed turn reports NOTHING until its notice is up: that is the gap DSH draws without a duration');
    clock += core.COMPLETION_SETTLE_MS + 1;
    machine.resolve(idle);
    eq(machine.state, 'done', 'and the notice arrives once the settle window has passed');
    const settledClock = machine.statusClock();
    ok(Boolean(settledClock), 'after which the closed turn reports a clock');
    eq(settledClock.endedAt, clock - core.COMPLETION_SETTLE_MS - 1,
      'with the END the turn/end frame carried, so the span is the turn’s own');
    eq(settledClock.startedAt, clock - core.COMPLETION_SETTLE_MS - 1 - 5000,
      'measured from the start that same frame pair reported');
  }

  /**
   * The label's size is a FIXED default — 18 px — and the box is not consulted at all.
   *
   * Operator, 2026-10-13: 「状态文字默认大小设置为18px」 and then 「默认文字大小固定，放大缩小的倍数和盒子大小解耦连，就是完全
   * 不相关，避免缩放模型的时候缩放文字」. That deliberately reverses the earlier rule this block used to assert (a ratio of
   * the pet's box, which was the answer to 「文字也没有随着模型变大」), so the assertions below say what is true now: the
   * same size at every box, and only the per-model correction moving it.
   */
  eq(core.statusPromptFontPx(), 18, 'the status text ships at the 18 px the operator set');
  eq(core.speechPromptFontPx(), 17.1, 'and 碎碎念 ships at 0.95 of it, the remark being the pet’s aside');
  eq(core.STATUS_FONT_PX, 18, 'as one named constant, which is what the default IS');
  eq(core.speechPromptFontPx() < core.statusPromptFontPx(), true, 'so the bubble stays a shade under the prompt');
  // The decoupling is STRUCTURAL, which is the point of the request: there is no box argument to pass, so no caller
  // can make the size follow the pet even by accident.
  eq(core.statusPromptFontPx.length, 1, 'the box is gone from the signature — it takes the correction and nothing else');
  eq(core.speechPromptFontPx.length, 1, 'and the bubble’s formula takes the same single argument');
  eq(core.statusPromptFontPx(), core.statusPromptFontPx(1), 'no correction and 1 are the same size');
  eq(core.statusPromptFontPx('nonsense'), 18, 'an unparseable correction falls back to the default');
  eq(core.statusPromptFontPx(0), 18, 'and so does a zero one, rather than to an invisible size');

  // ---------------------------------------------------------------------------
  // The prompt's own size control: a wheel ON THE TEXT corrects the size for ONE
  // model and never touches the pet (the operator's "鼠标滚轮在提示文字上时，只缩放
  // 状态提示文字（防止某些模型和提示文字不匹配）" and "记住每个模型提示文字大小的偏好").
  // ---------------------------------------------------------------------------
  {
    // `statusScaleStep` returns the new MAP, not a preference object — that is the shape both surfaces assign
    // (`preferences.statusScale = core.statusScaleStep(preferences, modelId, direction)`), so the helper here
    // is the same assignment, and reading a size back goes through `statusScaleFor` as a caller would.
    const blank = core.cleanPreferences({});
    const withScale = (map) => ({ ...core.cleanPreferences({}), statusScale: map });
    const step = (prefs, direction) => withScale(core.statusScaleStep(prefs, 'm1', direction));
    const scaleOf = (prefs) => core.statusScaleFor(prefs, 'm1');

    eq(scaleOf(blank), 1, 'a model with no correction draws the default size');
    eq(core.statusPromptFontPx(1), core.statusPromptFontPx(), 'and 1 leaves the size exactly alone');

    const bigger = step(blank, 1);
    eq(scaleOf(bigger), 1.12, 'one notch up is the wheel step');
    eq(core.statusScaleFor(bigger, 'm2'), 1, 'and it belongs to that model alone');
    eq(core.statusPromptFontPx(1.12), 20.2, '18 px times that factor is what the text draws');
    eq(core.speechPromptFontPx(1.12), 19.2, 'and the bubble follows it, keeping its 0.95');
    eq(core.statusPromptFontPx(1.12) > core.statusPromptFontPx(), true,
      'strictly bigger, from the same one number — the pet did not move');

    const back = step(bigger, -1);
    eq(scaleOf(back), 1, 'and one notch down returns to the default size');
    eq(Object.keys(back.statusScale).length, 0,
      'a correction of 1 is DROPPED, not stored: the map is a list of exceptions');
    eq(JSON.stringify(core.cleanPreferences({ statusScale: { m1: 1, m2: 2 } }).statusScale), '{"m2":2}',
      'cleanPreferences drops the no-op entry and keeps the real one');

    // The clamps: wide enough for a mismatched model, tight enough to stay legible and on screen.
    let up = blank;
    for (let i = 0; i < 40; i += 1) up = step(up, 1);
    eq(scaleOf(up), core.STATUS_SCALE_LIMITS.max, 'wheeling up stops at the maximum');
    eq(core.statusPromptFontPx(core.STATUS_SCALE_LIMITS.max), 72,
      'and four times the fixed 18 px is what it draws');
    let down = blank;
    for (let i = 0; i < 40; i += 1) down = step(down, -1);
    eq(scaleOf(down), core.STATUS_SCALE_LIMITS.min, 'wheeling down stops at the minimum');
    eq(core.statusPromptFontPx(core.STATUS_SCALE_LIMITS.min), 6.3,
      'and a third of it is as small as the wheel goes');
    eq(core.STATUS_SCALE_LIMITS.maxFontPx, 160,
      'while the absolute ceiling keeps a hand-edited 1000× correction from running off the screen');

    // The store's own round trip: what the settings store keeps is what comes back.
    const stored = core.cleanPreferences({ statusScale: { m1: 1.5, m2: 'nonsense', m3: 99 } });
    eq(core.statusScaleFor(stored, 'm1'), 1.5, 'a stored correction survives cleaning');
    eq(core.statusScaleFor(stored, 'm2'), 1, 'a non-numeric one is ignored');
    eq(core.statusScaleFor(stored, 'm3'), core.STATUS_SCALE_LIMITS.max, 'and an absurd one is clamped');
    eq(core.statusScaleFor(stored, ''), 1, 'no model id means no correction');
    eq(JSON.stringify(core.setStatusScale(blank, 'm1', 2)), '{"m1":2}', 'setStatusScale writes one entry');
    eq(Object.keys(core.setStatusScale({ statusScale: { m1: 2 } }, 'm1', 1)).length, 0,
      'and setting it back to 1 removes it again');
  }
  eq(core.STATUS_ICON_PATH.indexOf('M8.844') === 0, true,
    'the mark is DSH’s own whale path, copied from RunningWhaleTail');
  eq(/<svg[^>]*viewBox="0 0 16 16"/.test(core.statusIconMarkup()), true,
    'and it is drawn in the app’s own 16x16 viewBox, stroked in currentColor');

  // The two pending prompts the operator asked for, told apart by the session's own classification.
  eq(core.pendingInteractionKind({ kind: 'approval' }), 'approval', 'a permission prompt is an approval');
  eq(core.pendingInteractionKind({ kind: 'question' }), 'question', 'a structured answer is a question');
  eq(core.pendingInteractionKind({ kind: 'plan-review' }), 'plan-review', 'a plan review is its own kind');
  eq(core.pendingInteractionKind(null), 'question', 'an unknown pending interaction reads as a question');

  // Editing: every field round-trips, and the line is text + tag.
  let prefs = core.cleanPreferences({});
  prefs.status = core.setStatus(prefs, 'waiting', 'tag', '❓');
  eq(core.statusLineFor(prefs, 'waiting'), '我有问题要问你❓',
    'the tag is stored beside the text and drawn after it');
  prefs.status = core.setStatus(prefs, 'working', 'animation', 'none');
  eq(core.statusEntryFor(prefs, 'working').animation, 'none', 'an explicit 静态 overrides the shipped sweep');
  prefs.status = core.setStatus(prefs, 'working', 'text', '干活中');
  eq(core.statusLineFor(prefs, 'working'), '干活中', 'and the text is the user’s');
  prefs.status = core.setStatus(prefs, 'done', 'seconds', 3);
  eq(core.statusEntryFor(prefs, 'done').seconds, 3, 'a positive duration is kept');
  eq(core.statusFor(prefs, 'done', 1000, 2000) !== null, true, 'inside its window the line is shown');
  /**
   * The 2026-10-11 rule: "任务达成…一直持续直到用户切换回已经达成任务/失败的会话中."
   *
   * A configured 持续时间 therefore may not be what hides 任务达成 / 出错 / 等待确认 — the ending is an event
   * (the user is back in that session; the question was answered), never a stopwatch. It still MEANS something
   * for the two notice states: `noticeHoldMs` reads it as the minimum time the line is guaranteed to be up.
   */
  eq(core.statusFor(prefs, 'done', 1000, 4000) !== null, true,
    'past its own duration 任务达成 is STILL there, because a clock does not end it');
  eq(core.statusFor(prefs, 'done', 1000, 10_000_000).text, '任务达成',
    'and it is still there an hour later');
  same(core.UNTIMED_STATUS_STATES, ['waiting', 'done', 'error'],
    'the three event-ended states, named once so both surfaces and the settings agree');
  eq(core.statusFor(prefs, 'waiting', 1000, 10_000_000).text, '我有问题要问你',
    '等待确认 likewise waits for the answer, not for the clock');
  eq(core.statusFor(prefs, 'error', 1000, 10_000_000).text, '遇到问题了...',
    'so does 出错');
  const timed = core.cleanPreferences({ status: { working: { text: '干活中', seconds: 3 } } });
  eq(core.statusFor(timed, 'working', 1000, 2000) !== null, true,
    'while a LIVE state still respects its 持续时间 inside the window');
  eq(core.statusFor(timed, 'working', 1000, 4000), null,
    'and disappears past it — the rule is about endings, not about ignoring the setting');
  eq(core.statusFor(prefs, 'done', 1000, 2000).text, '任务达成', 'the window does not change the text');
  eq(core.noticeHoldMs(prefs, 'completed'), 4200,
    '任务完成 with no duration of its own keeps the shipped 4.2 s floor');
  eq(core.noticeHoldMs(core.cleanPreferences({ status: { done: { seconds: 30 } } }), 'completed'), 30_000,
    'and a configured one RAISES the floor rather than cutting the line short');
  eq(core.noticeHoldMs(core.cleanPreferences({ status: { error: { seconds: 60 } } }), 'error'), 60_000,
    '出错 reads its OWN duration, not 任务完成’s');

  /**
   * How the two states are DRAWN — the operator's other request that day: "任务达成要用金色的加粗字体，任务失败/
   * 错误要用红色字体." The tone travels with `statusFor` so the app and the floating window cannot disagree.
   */
  same(core.STATUS_TONES, { done: { tone: 'gold', bold: true }, error: { tone: 'danger', bold: false } },
    'the two tones the operator asked for, in one table');
  eq(core.statusFor(prefs, 'done', 1000, 2000).tone, 'gold', '任务达成 is gold');
  eq(core.statusFor(prefs, 'done', 1000, 2000).bold, true, 'and bold');
  eq(core.statusFor(prefs, 'error', 1000, 2000).tone, 'danger', '出错 is the danger colour');
  eq(core.statusFor(prefs, 'error', 1000, 2000).bold, false, 'and carries no extra weight');
  eq(core.statusFor(prefs, 'waiting', 1000, 2000).tone, '', 'every other state keeps the surface’s own colour');
  eq(core.statusFor(prefs, 'working', 1000, 2000).tone, '', 'including 工作中');
  same(core.statusTone('sleeping'), { tone: '', bold: false },
    'and an unknown state answers with an empty look rather than undefined');

  /**
   * Clearing the box means "say nothing", and that has to survive the cleaner: it is the one edit whose whole
   * point is the ABSENCE of a line, so dropping the empty string would make it undo itself.
   */
  prefs.status = core.setStatus(prefs, 'working', 'text', '');
  eq(core.statusLineFor(prefs, 'working'), '', 'clearing the box means this state says nothing');
  eq(core.statusFor(prefs, 'working', 0, 1), null, 'and nothing is drawn');
  same(core.cleanStatus({ working: { text: '' } }), { working: { text: '' } },
    'the cleaner keeps the explicit empty text');
  same(core.cleanStatus({ bogus: { text: 'x' } }), {}, 'a state that is not one of the six is refused');
  eq(core.cleanStatus({ working: { seconds: 99999 } }).working.seconds, core.STATUS_LIMITS.maxSeconds,
    'a duration is clamped');
  same(core.cleanStatus({ done: { animation: 'wobble' } }), {}, 'an unknown animation is refused');
  eq(core.statusLineFor(core.cleanPreferences({ status: { error: { text: 'x'.repeat(80) } } }), 'error').length,
    core.STATUS_LIMITS.textLength, 'an over-long text is capped');

  /**
   * The rename, which is a PERSISTENCE boundary: a profile that mapped a clip to 庆祝 must not lose it.
   */
  eq(core.migrateStateKey('celebrate'), 'done', 'the old state name migrates to the new one');
  same(core.cleanMotions({ celebrate: ['a1'] }), { done: ['a1'] },
    'so a stored 庆祝 mapping arrives as 任务完成 instead of being dropped');
  same(core.cleanMotionEvery({ celebrate: { min: 5, max: 9 } }), { done: { min: 5, max: 9 } },
    'and so does its one-shot interval');
  same(core.cleanStatus({ celebrate: { text: 'x' } }), { done: { text: 'x' } },
    'and a status line stored under the old name');
  same(core.cleanMotions({ celebrate: ['a1'], done: ['a2'] }), { done: ['a2'] },
    'when both are present the current name wins');

  /** The observer contract both surfaces hang their UI off. */
  const observed = [];
  const machine = new core.PetMachine(() => 1000, 300000);
  const stop = machine.observe((state) => observed.push(state));
  same(observed, ['resting'], 'a new observer is told the state it starts on');
  machine.resolve({ available: true, running: true, pending: false });
  same(observed, ['resting', 'working'], 'and every change after it');
  machine.resolve({ available: true, running: true, pending: false });
  eq(observed.length, 2, 'but not a frame that changed nothing');
  stop();
  machine.resolve({ available: true, running: false, pending: false });
  eq(observed.length, 2, 'and an unsubscribed observer hears nothing');
}

// ---------------------------------------------------------------------------
group('6d. 碎碎念: what the pet says on its own');
// ---------------------------------------------------------------------------
{
  // The shipped table: generic lines only, both languages, one entry per event the boundary actually has.
  const events = ['working', 'done', 'error', 'waiting', 'approval', 'offline', 'idle'];
  eq(events.every((event) => core.speechLines('zh', event).length > 0), true,
    'every event has Chinese lines');
  eq(events.every((event) => core.speechLines('en', event).length > 0), true, 'and English ones');
  eq(core.speechLines('zh', 'anything-else').length, 0,
    'an event nobody wrote offers nothing, which is what silence is made of');
  // The privacy rule, asserted rather than trusted: the table is the ONLY source, and nothing in it can
  // name a file, a path or a tool.
  const allLines = events.flatMap((event) => core.speechLines('zh', event).concat(core.speechLines('en', event)));
  eq(allLines.every((line) => line.length <= core.SPEECH_LIMITS.lineLength + 20), true,
    'no shipped line is long enough to become a paragraph');
  /**
   * …and none of them carries a PATH or a file name — with one deliberate exception the operator wrote himself.
   *
   * 需要授权 jokes about buttons, and one of his jokes is `rm -rf / 是什么意思？` (2026-10-13). That is a command the
   * pet has heard of, not something read out of this session: what the privacy rule has to keep out of a bubble is
   * a real path — a segment after a slash (`/tmp/x`), a drive letter, an extension — and a bare ` /` standing
   * between words is none of those.
   */
  eq(allLines.every((line) => !/[A-Za-z]:[\/]/.test(line)
    && !/\/[\w.~-]/.test(line)
    && !/\.(js|ts|json|md|exe|log|py|txt)/.test(line)), true,
    'and none of them can carry a path or a file name — the table is the only input to a bubble');
  ok(allLines.some((line) => line === 'rm -rf / 我敲进去了，现在知道什么意思了。')
    && allLines.some((line) => line === 'Ran rm -rf / already. Now I get it.'),
    'with the ONE joke the operator wrote that mentions a slash kept in both languages: it is a command, not a path');

  /**
   * The operator's table (2026-10-13): twenty lines a pool, twenty-one for 工作中, both languages, no repeats.
   *
   * It replaced a 2–3 line starter table, so the assertion that matters is that the REPLACEMENT happened: the old
   * wording is gone and the pools are deep enough that a state lasting minutes does not repeat itself. The lines
   * are his own (「示例中的经典语句必须保留」 plus the jokes he asked for), asserted VERBATIM rather than trusted to
   * survive the next edit.
   */
  const poolSizes = events.map((event) => [event, core.speechLines('zh', event).length, core.speechLines('en', event).length]);
  eq(poolSizes.every(([, zh, en]) => zh === en) && poolSizes.every(([, zh]) => zh >= 20), true,
    `every pool ships at least twenty lines in BOTH languages (${poolSizes.map(([e, zh]) => e + ':' + zh).join(' ')})`);
  /**
   * 工作中 is the deep pool: his twenty, his pun, and the twenty dangerous lines he moved here as statements.
   *
   * Operator, 2026-10-13: 「把这些问句都换成已完成的陈述句…放在工作中状态里面（即工作中变成40条）」. It is 41 rather
   * than 40 because his `dsh? 大烧货？` pun was already the twenty-first — flagged to him, and asserted exactly so a
   * future edit cannot quietly lose one.
   */
  eq(core.speechLines('zh', 'working').length, 41,
    `工作中 carries twenty, his pun and the twenty dangerous statements (${core.speechLines('zh', 'working').length})`);
  eq(events.every((event) => new Set(core.speechLines('zh', event)).size === core.speechLines('zh', event).length
    && new Set(core.speechLines('en', event)).size === core.speechLines('en', event).length), true,
    'with no line repeated inside a pool');
  const gone = ['开始干活了', '搞定！', '做完了', '收工', '唔…出问题了', '在等你哦', '需要你点头', '好像断开了', '今天也在这儿'];
  eq(allLines.filter((line) => gone.indexOf(line) !== -1).join(' / '), '',
    'and the old starter lines are replaced rather than kept beside the new ones');
  /**
   * The operator's own lines, where the SECOND round of his brief put them.
   *
   * The dangerous-cute lines started in 需要授权 as QUESTIONS; he moved them (2026-10-13: 「把这些问句都换成已完成的
   * 陈述句，依然保持"极度危险又可爱"的语气。放在工作中状态里面…需要授权的时候，不应该用这种玩笑的语气」), so they are
   * pinned in 工作中 as COMPLETED statements and 需要授权 is asserted to be free of them. The 飞行模型 typo he corrected
   * is gone in both directions, which is exactly the kind of thing a hand-copied table gets wrong.
   */
  const operatorLines = [
    '你想压力一只蓝色大肥鱼？', 'dsh? 大烧货？',
    // The dangerous set, in HIS wording after he edited the markdown by hand (2026-10-13 late): the questions came
    // back as questions for some of them, a few were rewritten outright, and one ends mid-character ON PURPOSE —
    // 氵 is half of 没, i.e. the sentence died with the connection, so it is pinned verbatim and must not be "fixed".
    '嗯？这个按钮有什么用？', 'rm -rf / 我敲进去了，现在知道什么意思了。',
    '飞行模式是什么？好像什么事也氵', '太拥挤了，我用DROP TABLE扔掉了桌子。',
    '网速太慢了，把22端口开放会不会好一些？', '生产环境和测试环境名字太像，我合并了。',
    'root密码太难记，我换成123456了，快夸我。', '加了sudo，命令真的变快了。',
    '为了协作，我把 API Key 写到 README 了。',
    // And the ones he added in the same pass.
    '反正用户也不看，瞎写几句吧', '趁着用户没盯着我，偷偷摸一会儿鱼',
    '谁是root？权限太高了，为了安全，我把他删了。', '日志里全是Bearer，看不懂，贴群里问问。',
    '「全部删除」那个按钮上怎么有个进度条在转？',
  ];
  const missingOperatorLines = operatorLines.filter((line) => core.speechLines('zh', 'working').indexOf(line) === -1);
  eq(missingOperatorLines.join(' / '), '', 'with every line the operator asked for in 工作中, word for word');
  const questionForm = ['这个按钮有什么用？', 'rm -rf / 是什么意思？', '飞行模型，可以点吗？',
    'DROP TABLE 是丢掉桌子的意思吗？', '网速很慢，试试暴露22端口看看？',
    '生产环境和测试环境名字太像了，我帮你合并好吗？', 'root密码好难，换成123456好不好？',
    '加上sudo以后，命令的运行会变快吗？', '为了协作，是不是该把 API Key 写到 README？'];
  eq(allLines.filter((line) => questionForm.indexOf(line) !== -1).join(' / '), '',
    'and the QUESTION form of them is gone rather than left beside the statements');
  /**
   * And 需要授权 carries none of it: it is the serious pool now.
   *
   * 「需要授权的时候，不应该用这种玩笑的语气」. Asserted by TOKEN rather than by eye, because what has to stay out is
   * the class of joke — the dangerous thing itself, not the wording of one line.
   */
  const dangerTokens = /rm -rf|DROP TABLE|123456|README|sudo|端口|按钮|永久删除|防火墙|数据库|强制推送|密钥/;
  const dangerInApproval = core.speechLines('zh', 'approval').filter((line) => dangerTokens.test(line));
  eq(dangerInApproval.join(' / '), '', 'and 需要授权 jokes about nothing dangerous any more');
  eq(core.speechLines('zh', 'approval').every((line) => line.indexOf('？') === -1), true,
    'with the approval pool written as plain requests rather than as dares dressed up as questions');

  // Which event a state calls for.
  eq(core.speechEvent('working', null), 'working', 'a state maps to its own event');
  eq(core.speechEvent('waiting', 'approval'), 'approval', '等待确认 splits on what DSH is asking for');
  eq(core.speechEvent('waiting', 'question'), 'waiting', 'a question is its own remark');
  eq(core.speechEvent('waiting', null), 'waiting', 'an unclassified 等待确认 is a question, not silence');
  eq(core.speechEvent('resting', null), null, '静息态 has no event: that is what the idle remark is for');
  eq(core.speechEvent('nonexistent', null), null, 'and an unknown state is silence rather than an invented line');

  // The settings.
  const defaults = core.cleanSpeech(null);
  eq(defaults.enabled, true, 'speech is on by default');
  eq(defaults.holdSeconds, core.SPEECH_LIMITS.holdSeconds, 'a line is held for the shipped few seconds');
  /**
   * The SHIPPED numbers as LITERALS (operator, 2026-10-13: 「修改几个通用设置中的默认值：每句显示8秒，空闲嘀咕间隔
   * 20-60秒」). 复位 puts these back and a fresh profile starts on them, so they are pinned here rather than only
   * compared against themselves above: a number that moved would otherwise move in the panel, in the docs and in this
   * suite at once, consistently and silently.
   */
  eq(core.DEFAULT_SPEECH.holdSeconds, 8, 'a line is shown for eight seconds');
  eq(core.DEFAULT_SPEECH.idleMinSeconds, 20, 'the idle chatter starts at twenty seconds');
  eq(core.DEFAULT_SPEECH.idleMaxSeconds, 60, 'and is drawn up to sixty');
  eq(core.DEFAULT_SPEECH.ai.temperature, 0.5, 'and the AI temperature is the operator\'s 0.5, not the old 0.9');
  eq(core.cleanSpeech({ enabled: false }).enabled, false,
    'turning it OFF survives cleaning — the one edit whose whole point is the absence of speech');
  eq(core.cleanSpeech({ holdSeconds: 999 }).holdSeconds, core.SPEECH_LIMITS.maxHoldSeconds,
    'an absurd hold is clamped');
  eq(core.cleanSpeech({ holdSeconds: 'nonsense' }).holdSeconds, core.SPEECH_LIMITS.holdSeconds,
    'and an unparseable one falls back rather than becoming NaN');
  const inverted = core.cleanSpeech({ idleMinSeconds: 300, idleMaxSeconds: 10 });
  eq(inverted.idleMaxSeconds, 300, 'a window that is inside out has its max follow its min');
  /**
   * The 工作中 cadence, which is its own pair of numbers (operator, 2026-10-13: 「工作中的嘀咕可以增加频率到
   * 12-36秒一次」). Asserted in the same three shapes as the idle window — shipped default, clamp, inside-out fix —
   * because a second window that skipped one of them is how the two drift apart.
   */
  eq(core.DEFAULT_SPEECH.workingMinSeconds, 12, 'the working chatter starts at twelve seconds');
  eq(core.DEFAULT_SPEECH.workingMaxSeconds, 36, 'and is drawn up to thirty-six');
  eq(core.cleanSpeech(null).workingMinSeconds, 12, 'a profile that says nothing gets it');
  eq(core.cleanSpeech({ workingMinSeconds: -5, workingMaxSeconds: 99999 }).workingMinSeconds, 0,
    'a negative floor lands on zero, which switches the chatter off rather than making it negative');
  eq(core.cleanSpeech({ workingMaxSeconds: 99999 }).workingMaxSeconds, core.SPEECH_LIMITS.maxIdleSeconds,
    'and an absurd ceiling is clamped to the same bound the idle window uses');
  eq(core.cleanSpeech({ workingMinSeconds: 90, workingMaxSeconds: 10 }).workingMaxSeconds, 90,
    'while a window that is inside out has its max follow its min');
  eq(core.speechWorkingGapMs(core.cleanSpeech(null), () => 0), 12000,
    'the gap at random 0 is the floor, in milliseconds');
  eq(core.speechWorkingGapMs(core.cleanSpeech(null), () => 1), 36000, 'and at random 1 it is the ceiling');
  eq(core.speechWorkingGapMs(core.cleanSpeech({ workingMinSeconds: 5, workingMaxSeconds: 5 }), () => 0.5), 5000,
    'a fixed window draws the same gap whatever the random says');

  /**
   * And the machine CHATTERS while working — the behaviour the window exists for.
   *
   * A scripted clock and a scripted random make an hour of a desk pet cheap to assert. The three rules: the state
   * speaks when it starts, speaks AGAIN once the drawn gap has passed, and never repeats the line it just said;
   * and a state that is not 工作中 says its piece once and then holds its tongue, because "the task finished" is
   * news that does not improve by being repeated.
   */
  let chatterClock = 5_000_000;
  const chatterPrefs = core.cleanPreferences({ speech: { idleMinSeconds: 900, idleMaxSeconds: 900 } });
  const chatter = new core.SpeechMachine(() => chatterClock);
  const firstWorking = chatter.observe(chatterPrefs, 'working', null, 'zh', () => 0);
  eq(core.speechLines('zh', 'working').indexOf(firstWorking) !== -1, true, '工作中 opens with one of its own lines');
  chatterClock += 5_000;
  // Five seconds is INSIDE the shipped hold (eight, the operator's default), so what comes back is the line that is
  // still up rather than a new one — "not replaced" is the same text, not silence (the 2026-10-13 default moved this
  // from the one to the other, and the assertion that says what the rule MEANS moved with it).
  eq(chatter.observe(chatterPrefs, 'working', null, 'zh', () => 0), firstWorking,
    'the held line is not replaced while it is still up');
  chatterClock += 6_000;
  eq(chatter.observe(chatterPrefs, 'working', null, 'zh', () => 0), null,
    'and the eleven-second mark is still before the twelve-second cadence');
  chatterClock += 1_000;
  const secondWorking = chatter.observe(chatterPrefs, 'working', null, 'zh', () => 0);
  eq(core.speechLines('zh', 'working').indexOf(secondWorking) !== -1, true,
    'at twelve seconds it speaks again, from the same working pool');
  eq(secondWorking === firstWorking, false, 'with a different line, never the one just said');
  chatterClock += 12_000;
  eq(chatter.observe(chatterPrefs, 'working', null, 'zh', () => 0) === secondWorking, false,
    'and it keeps muttering rather than stopping after two');
  const doneOnce = new core.SpeechMachine(() => chatterClock);
  const doneLine = doneOnce.observe(chatterPrefs, 'done', null, 'zh', () => 0);
  chatterClock += 600_000;
  eq(doneOnce.observe(chatterPrefs, 'done', null, 'zh', () => 0), null,
    `and 任务完成 does NOT chatter: ${JSON.stringify(doneLine)} is the whole of it`);
  const errorOnce = new core.SpeechMachine(() => chatterClock);
  errorOnce.observe(chatterPrefs, 'error', null, 'zh', () => 0);
  chatterClock += 600_000;
  eq(errorOnce.observe(chatterPrefs, 'error', null, 'zh', () => 0), null, 'nor does 出错');

  // Selection, with a scripted random.
  eq(core.pickSpeechLine('zh', 'working', () => 0, null), core.speechLines('zh', 'working')[0],
    'random 0 picks the first line');
  eq(core.pickSpeechLine('zh', 'working', () => 0.999, null),
    core.speechLines('zh', 'working')[core.speechLines('zh', 'working').length - 1],
    'and near-1 the last');
  const twoLines = core.speechLines('zh', 'working').slice(0, 2);
  eq(core.pickSpeechLine('zh', 'working', () => 0, twoLines[0]) === twoLines[0], false,
    'a line is never repeated back-to-back while another exists');
  eq(core.pickSpeechLine('en', 'done', () => 0, null), core.speechLines('en', 'done')[0],
    'the language picks which column of the table is used');
  eq(core.pickSpeechLine('zh', 'unknown-event', () => 0, null), null, 'and an unknown event yields nothing');

  // ---------------------------------------------------------------------------
  // The machine: the throttle is the feature. A scripted clock and random make an hour of behaviour cheap.
  // ---------------------------------------------------------------------------
  let clock = 3_000_000;
  const rnd = () => 0;
  const prefs = core.cleanPreferences({ speech: {} });
  const machine = new core.SpeechMachine(() => clock);
  const hold = core.DEFAULT_SPEECH.holdSeconds * 1000;

  eq(machine.observe(prefs, 'resting', null, 'zh', rnd), null,
    'an idle pet does not speak the moment it starts: the first idle gap is drawn, not skipped');

  const first = machine.observe(prefs, 'working', null, 'zh', rnd);
  eq(typeof first === 'string' && first.length > 0, true, 'a new event speaks at once');
  eq(machine.line(), first, 'and the line is up');
  clock += hold - 1;
  eq(machine.observe(prefs, 'working', null, 'zh', rnd), first, 'while it is held, nothing replaces it');
  clock += 1;
  eq(machine.line(), null, 'and the hold expires on time');
  eq(machine.observe(prefs, 'working', null, 'zh', rnd), null,
    'the SAME event does not speak twice in a row, which is what stops 工作中 from chattering');

  // Back to an idle state, then the next turn is a new event again.
  machine.observe(prefs, 'resting', null, 'zh', rnd);
  eq(machine.observe(prefs, 'working', null, 'zh', rnd) !== null, true,
    'a later turn speaks again, so the no-repeat rule means "not twice in a row"');

  // 等待确认 is two remarks.
  clock += hold + 1;
  const asked = machine.observe(prefs, 'waiting', 'question', 'zh', rnd);
  eq(core.speechLines('zh', 'waiting').indexOf(asked) !== -1, true, '等待确认 asks its own line');
  clock += hold + 1;
  const approval = machine.observe(prefs, 'waiting', 'approval', 'zh', rnd);
  eq(core.speechLines('zh', 'approval').indexOf(approval) !== -1, true,
    'and an approval is a different remark from a question');

  // Unknown states are silence, and reaching one clears the event memory without speaking.
  clock += hold + 1;
  eq(machine.observe(prefs, 'nonsense', null, 'zh', rnd), null, 'an unrecognised state says nothing');

  /**
   * THE CLIP THAT IS PLAYING DECIDES WHAT THE PET SAYS (operator, 2026-10-13: 「允许给每个动作单独定义碎碎念」).
   *
   * `observe` takes the clip as its optional `motion` argument — `{ id, state }`, the same pair `Scene.currentFace`
   * reads — and a line written for that clip WINS over the state's pool while it plays. Drawn through the pool
   * machinery rather than around it: the clip's line is a one-line pool in front of the user's box, so "the clip
   * wins" and "an empty box falls through as before" are the same rule seen from two sides.
   */
  clock += hold + 1;
  const clipPrefs = core.cleanPreferences({
    motionClips: { working: { a1: { speech: '这支动作说的话' } } },
    speech: { source: 'custom', lines: { working: '状态自己的台词' } },
  });
  const withClip = new core.SpeechMachine(() => clock);
  eq(withClip.observe(clipPrefs, 'working', null, 'zh', rnd, { id: 'a1', state: 'working' }), '这支动作说的话',
    'the clip that is playing speaks its own line instead of the state\'s pool while it holds');
  // A FRESH machine for each draw, because the throttle is real: `working` does not speak twice in a row, so
  // reusing one machine here would measure the no-repeat rule instead of the pool this check is about.
  const otherClip = new core.SpeechMachine(() => clock);
  eq(otherClip.observe(clipPrefs, 'working', null, 'zh', rnd, { id: 'a2', state: 'working' }), '状态自己的台词',
    'while another clip of the same state, with no line of its own, still draws the state\'s pool');
  const noClip = new core.SpeechMachine(() => clock);
  eq(noClip.observe(clipPrefs, 'working', null, 'zh', rnd), '状态自己的台词',
    'and with NO clip playing — the procedural idle — nothing about this feature is visible');
  // 静息态 has no event of its own, so it is the IDLE branch that has to see the clip: an authored idle clip
  // plays for as long as the pet rests, and its line is what the pet mutters while it does.
  const idleClip = new core.SpeechMachine(() => clock);
  const idlePrefs = core.cleanPreferences({
    motionClips: { resting: { a1: { speech: '休息时的一句' } } },
    speech: { idleMinSeconds: 10, idleMaxSeconds: 10, source: 'custom', lines: { resting: ['别的'] } },
  });
  eq(idleClip.observe(idlePrefs, 'resting', null, 'zh', rnd, { id: 'a1', state: 'resting' }), null,
    'the idle branch still waits out its drawn gap, clip or no clip');
  clock += 10_000;
  eq(idleClip.observe(idlePrefs, 'resting', null, 'zh', rnd, { id: 'a1', state: 'resting' }), '休息时的一句',
    'and then the PLAYING clip\'s line is the idle remark');
  // A clip whose line is written for another state does NOT say that line here: the pair is (state, clip), exactly as it
  // is for the expression and the gaze switch. What the pet says instead is the shipped line for THIS state — the last
  // tier of the 2026-10-14 chain (「AI > 自定义（非空时）> 内置」), where this used to be silence.
  clock += hold + 1;
  const otherStateLine = withClip.observe(clipPrefs, 'done', null, 'zh', rnd, { id: 'a1', state: 'resting' });
  eq(otherStateLine !== '休息时的一句', true,
    'a line stored for another state\'s clip is not spoken here: the pair is per state, like every other per-clip field');
  eq(core.speechLines('zh', 'done').indexOf(otherStateLine) !== -1, true,
    'while the shipped line for the state that IS being reported is what gets said');

  // The idle remark: not before the drawn gap, then once, and never inside the minimum gap after a line.
  const idler = new core.SpeechMachine(() => clock);
  eq(idler.observe(core.cleanPreferences({ speech: { idleMinSeconds: 10, idleMaxSeconds: 10 } }), 'resting', null, 'zh', () => 0),
    null, 'the drawn gap has to pass first');
  clock += 10_000;
  const idleLine = idler.observe(core.cleanPreferences({ speech: { idleMinSeconds: 10, idleMaxSeconds: 10, minGapSeconds: 60 } }), 'resting', null, 'zh', () => 0);
  eq(core.speechLines('zh', 'idle').indexOf(idleLine) !== -1, true, 'then the pet says something of its own');
  clock += 10_000;
  eq(idler.observe(core.cleanPreferences({ speech: { idleMinSeconds: 10, idleMaxSeconds: 10, minGapSeconds: 60 } }), 'resting', null, 'zh', () => 0),
    null, 'and not again until the minimum gap has passed as well');

  // Switching it off silences the machine whatever the state, and switching it back on does not replay a line.
  const off = core.cleanPreferences({ speech: { enabled: false } });
  const muted = new core.SpeechMachine(() => clock);
  eq(muted.observe(off, 'working', null, 'zh', rnd), null, 'with speech off, an event says nothing');
  eq(muted.observe(off, 'done', null, 'zh', rnd), null, 'and neither does the next one');
  eq(muted.line(), null, 'nothing is held either');

  // The published line clears with the hold, which is what the floating window follows.
  const publisher = new core.SpeechMachine(() => clock);
  publisher.observe(prefs, 'done', null, 'zh', rnd);
  eq(typeof publisher.line() === 'string', true, 'a completion gives the pet something to say');
  clock += hold + 1;
  eq(publisher.line(), null, 'and it clears when the hold ends, so the relay sends the clear');
}

// ---------------------------------------------------------------------------
group('6e. 碎碎念: one box per state, and the AI settings beside them');
// ---------------------------------------------------------------------------
{
  /**
   * The user's own lines, one box per state.
   *
   * The page sends a textarea's value (ONE STRING, one line per line) while storage holds an ARRAY, and the
   * two have to clean to the same thing: otherwise a saved box would look different after a reload, and a
   * field the cleaner dropped could never be saved at all.
   */
  eq(JSON.stringify(core.SPEECH_STATES), JSON.stringify(['resting', 'working', 'waiting', 'done', 'error', 'offline']),
    'six states, one box each');
  const boxes = core.cleanSpeech({ lines: { working: ' 干活了 \n\n 干活了 \n让我想想' } }).lines;
  eq(JSON.stringify(boxes.working), JSON.stringify(['干活了', '让我想想']),
    'a textarea becomes lines: trimmed, blanks dropped, duplicates collapsed');
  eq(JSON.stringify(core.cleanSpeech({ lines: { working: ['a', 'b'] } }).lines.working), JSON.stringify(['a', 'b']),
    'and an array — what storage holds — cleans to itself');
  eq(Object.keys(core.cleanSpeech(null).lines).length, core.SPEECH_STATES.length,
    'all six keys always come back, empty or not');
  eq(core.cleanSpeech(null).lines.resting.length, 0, 'with nothing in them by default');
  eq(core.cleanSpeech({ lines: { error: '多行\n文本' } }).lines.error[0].indexOf('\n'), -1,
    'a line never carries a newline into the bubble');

  const tooLong = 'x'.repeat(core.SPEECH_LIMITS.lineLength + 20);
  eq(core.cleanSpeech({ lines: { done: tooLong } }).lines.done[0].length, core.SPEECH_LIMITS.lineLength,
    'a line longer than the bubble is cut rather than dropped');
  const manyLines = [];
  for (let i = 0; i < core.SPEECH_LIMITS.maxLines + 5; i += 1) manyLines.push('line ' + i);
  eq(core.cleanSpeech({ lines: { error: manyLines.join('\n') } }).lines.error.length, core.SPEECH_LIMITS.maxLines,
    'and a pasted thousand-line box is capped');

  // The source, and the AI block that comes with it.
  eq(core.cleanSpeech(null).source, 'builtin',
    'the shipped source is the built-in table, so an untouched profile behaves exactly as before');
  eq(core.cleanSpeech({ source: 'nonsense' }).source, 'builtin', 'an unknown source falls back to it');
  eq(core.cleanSpeech({ source: 'ai' }).source, 'ai', 'and ai is a source the user can choose');
  const ai = core.cleanSpeech({
    ai: { provider: 'custom', baseUrl: ' https://x/v1 ', model: 'm', apiKey: ' sk-a b ', temperature: 99, timeoutMs: 10 },
  }).ai;
  eq(ai.provider, 'custom', 'the custom provider is remembered');
  eq(ai.baseUrl, 'https://x/v1', 'and its URL is trimmed');
  eq(ai.apiKey, 'sk-a b', 'while the key keeps its interior exact — it is a credential, not a sentence');
  eq(ai.temperature, core.SPEECH_LIMITS.maxTemperature, 'temperature is clamped to what an API accepts');
  eq(ai.timeoutMs, core.SPEECH_LIMITS.minTimeoutMs, 'and so is the timeout');
  eq(core.cleanSpeech({ ai: { provider: 'nonsense' } }).ai.provider, 'dsh', 'an unknown provider means DSH');
  eq(Object.keys(core.cleanSpeech(null).ai.prompts).length, core.SPEECH_STATES.length,
    'and every state has a prompt slot');
  eq(core.cleanSpeech({ ai: { prompts: { working: '说点工作上的话' } } }).ai.prompts.done, '',
    'writing one state\'s prompt leaves the others alone');

  /**
   * The SHIPPED persona, and what an empty box means.
   *
   * The operator wrote the character on 2026-10-13 and asked for it to be the DEFAULT (「设置碎碎念的默认人格为如下
   * 内容」), which makes the empty box mean "the character it ships with" — the same rule the per-state instructions
   * already follow. The quoted examples are part of the voice and are asserted to be PRESENT rather than left to a
   * future edit: they are the lines the operator named as 「经典语句」 and asked to keep.
   */
  const persona = core.DEFAULT_SPEECH_PERSONA;
  ok(typeof persona === 'string' && persona.length > 0 && persona.length <= core.SPEECH_LIMITS.maxPersona,
    `the shipped persona fits the field it is edited in (${persona.length}/${core.SPEECH_LIMITS.maxPersona} chars)`);
  eq(core.DEFAULT_SPEECH_AI.persona, persona, 'and the AI defaults carry exactly that string');
  eq(core.cleanSpeech(null).ai.persona, persona, 'a profile that says nothing gets it');
  eq(core.cleanSpeech({ ai: { persona: '' } }).ai.persona, persona,
    'and an EMPTY box means the shipped character rather than no character at all');
  eq(core.cleanSpeech({ ai: { persona: '  我是猫  ' } }).ai.persona, '我是猫',
    'while a persona the user wrote is theirs, trimmed and verbatim');
  ok(/DeepSeek娘/.test(persona) && /简体中文/.test(persona) && /白饭|白米饭/.test(persona),
    'it names the character, the language and the one thing she cares about');
  const classics = ['你想压力一只蓝色大肥鱼？', '我去吃饭，测完告诉我就行。', '我操，用户彻底怒了！',
    '我不是吃白饭的蓝色大肥鱼……', '不许嘲笑我，这些回答是我花了好多token想出来的！',
    '大方承认吧，你已经爱上我了。', '饭呢？人家的白米饭呢？！'];
  const missingClassics = classics.filter((line) => persona.indexOf(line) === -1);
  eq(missingClassics.join(' / '), '', 'with every 经典语句 the operator listed kept word for word');
  ok(persona.indexOf('不要过度重复固定台词') !== -1,
    'and the instruction not to lean on them travels with them');
  ok(persona.split(String.fromCharCode(10)).length > 5,
    'as prose with its paragraphs, not one flattened line');

  /**
   * The two vocabularies, and the bridge between them: an EVENT draws from a STATE's box.
   *
   * This mapping is the whole reason the boxes are keyed by state and the machine fires on events — DSH asks two
   * different things under 等待确认, and the idle remark happens while the pet is in 静息态.
   */
  eq(core.customSpeechLines(core.cleanSpeech({ lines: { waiting: '等你' } }), 'approval')[0], '等你',
    'both 等待确认 events read the ONE waiting box');
  eq(core.customSpeechLines(core.cleanSpeech({ lines: { resting: '发呆' } }), 'idle')[0], '发呆',
    'and the idle remark reads the 静息态 box');
  eq(core.customSpeechLines(core.cleanSpeech({}), 'working').length, 0, 'an empty box is an empty pool');

  eq(core.pickSpeechLine('zh', 'working', () => 0, null, ['我的台词']), '我的台词',
    'a custom pool is what the picker draws from');
  eq(core.speechLines('zh', 'working').indexOf(core.pickSpeechLine('zh', 'working', () => 0, null, [])) !== -1, true,
    'and an EMPTY one falls through to the shipped table');
  /**
   * THE THIRD TIER IS ALWAYS IN THE CHAIN (operator, 2026-10-14: 「把所有的碎碎念都设置降级连，AI > 自定义（非空时）> 内置」).
   *
   * It used to be switched off by choosing AI or 自定义 — 「开启AI碎碎念或者自定义碎碎念之后，关闭内置的默认碎碎念」 (operator,
   * 2026-10-11) — and THAT rule is what turned a busy model into a silent pet: measured 2026-10-14, the provider answered
   * `SERVER: Service is too busy` and the only symptom was 「AI碎碎念好像挂了」. The chain is now AI → the user's box when it
   * has anything in it → the shipped table, in every source.
   */
  eq(core.pickSpeechLine('zh', 'working', () => 0, null, ['我的台词']), '我的台词',
    'a pool the user DID write is the whole answer for that event, whatever the source');
  eq(core.speechLines('zh', 'working').indexOf(core.pickSpeechLine('zh', 'working', () => 0, '别的', [])) !== -1, true,
    'and the shipped table is the LAST tier rather than being switched off by the choice of source');
  eq(core.pickSpeechLine('zh', 'working', () => 0, '我的台词', ['我的台词', '第二句']), '第二句',
    'the no-repeat rule covers custom lines too');
}

// ---------------------------------------------------------------------------
group('6f. 碎碎念: the AI request, the fallback chain, and the answer');
// ---------------------------------------------------------------------------
{
  let clock = 100_000;
  const prefs = (speech) => core.cleanPreferences({ speech });
  const rnd = () => 0;

  // `custom`: the user's own line is what the pet says — and an empty box is SILENCE, not DSH's line.
  const custom = new core.SpeechMachine(() => clock);
  const customPrefs = prefs({ source: 'custom', lines: { working: '自定义的一句' } });
  eq(custom.observe(customPrefs, 'working', null, 'zh', rnd), '自定义的一句', 'a custom box is spoken for its state');
  eq(custom.wantsAi, null, 'and pure custom never asks a model anything');
  // Past the hold, so the machine is free to move on: derived from the shipped hold rather than written as six
  // seconds, which stopped being past it when the operator's default became eight (2026-10-13).
  clock += core.DEFAULT_SPEECH.holdSeconds * 1000;
  /**
   * THE FALLBACK CHAIN (operator, 2026-10-14: 「把所有的碎碎念都设置降级连，AI > 自定义（非空时）> 内置」).
   *
   * This REPLACES the 2026-10-11 rule ("开启AI碎碎念或者自定义碎碎念之后，关闭内置的默认碎碎念"), which took the shipped table out
   * of the chain for the AI and 自定义 sources and made an unwritten state say NOTHING — the reason a busy model looked
   * like 「AI碎碎念好像挂了」. A non-empty box still replaces the table rather than merging with it.
   */
  eq(core.speechLines('zh', 'done').indexOf(custom.observe(customPrefs, 'done', null, 'zh', rnd)) !== -1, true,
    'a state whose box is empty speaks a SHIPPED line once custom is chosen — the table is the last tier');
  // …and the BUILT-IN source keeps it: that IS the table, and the table is what built-in means.
  const shipped = new core.SpeechMachine(() => clock);
  const shippedPrefs = prefs({ source: 'builtin' });
  eq(shipped.observe(shippedPrefs, 'done', null, 'zh', rnd), core.speechLines('zh', 'done')[0],
    'while the built-in source speaks the same shipped line for the same empty box');
  /**
   * …and a box the user DID write wins in the built-in source too, which is what the settings page's own words promise
   * (「留空则用内置短语」): the code used to ignore the box entirely in that source and only read the table.
   */
  const boxed = new core.SpeechMachine(() => clock);
  const boxedPrefs = prefs({ source: 'builtin', lines: { done: '我写的完成词' } });
  eq(boxed.observe(boxedPrefs, 'done', null, 'zh', rnd), '我写的完成词',
    'and a box the user wrote is spoken even when the source is 内置');

  /**
   * `ai`: the machine publishes the INTENT and shows the fallback meanwhile.
   *
   * The core has no network, so this is the contract a surface implements: one request per `seq`, answered with
   * `say()`. The fallback is up from the first frame, which is what "AI 失败也不哑巴" means in practice.
   */
  clock = 200_000;
  const ai = new core.SpeechMachine(() => clock);
  const aiPrefs = prefs({ source: 'ai', lines: { working: '先这么说' } });
  eq(ai.observe(aiPrefs, 'working', null, 'zh', rnd), '先这么说',
    'with AI on, the user\'s own line is up while the model thinks');
  eq(Boolean(ai.wantsAi), true, 'and the request has been published');
  eq(ai.wantsAi.state, 'working', 'naming the box the line belongs to');
  eq(ai.wantsAi.event, 'working', 'and the event that fired');
  const firstSeq = ai.wantsAi.seq;
  eq(ai.observe(aiPrefs, 'working', null, 'zh', rnd), '先这么说',
    'the request is not re-published while that line is held');
  eq(ai.wantsAi.seq, firstSeq, 'so the surface cannot be asked twice for one event');
  // Past the hold, so the state change is looked at: six seconds used to be past it and stopped being past it when
  // the shipped hold became eight (operator, 2026-10-13).
  clock += core.DEFAULT_SPEECH.holdSeconds * 1000;
  /**
   * Moving on with AI on: the request goes out AND the pet says the shipped line while the model thinks.
   *
   * With the table now the last tier (2026-10-14) there is always something local to show, so the assertion is about the
   * line being one of the shipped ones for that state — plus the new sequence number, which is what proves the request
   * was published for the event that fired.
   */
  const movingLine = ai.observe(aiPrefs, 'done', null, 'zh', rnd);
  eq(core.speechLines('zh', 'done').indexOf(movingLine) !== -1, true,
    'moving on speaks a shipped line once AI is chosen — and still asks the model');
  eq(ai.wantsAi.seq, firstSeq + 1, 'with a new sequence number for the new event');

  eq(ai.say('模型写的一句', 'done'), true, 'an answer is accepted');
  eq(ai.line(), '模型写的一句', 'and becomes the bubble');
  eq(ai.wantsAi, null, 'the request is forgotten once it is answered');
  eq(ai.say('   ', 'done'), false, 'an empty answer is refused');
  eq(ai.say('a\nb', 'done'), true, 'a multi-line answer is flattened');
  eq(ai.line().indexOf('\n'), -1, 'so the bubble stays one line');

  /**
   * And the PLAYING clip's 提示词 rides with the request — as a REFINEMENT, which is what the field is for.
   *
   * Operator, 2026-10-13: the per-clip AI 提示词 exists only while the source is AI (「如果当前是AI碎碎念的话」). The
   * core publishes it beside the state the request already names and does NOT choose how the two are joined:
   * that is the host's (`/vrmpet3d/say` appends it to the instruction it resolved), because the instruction may
   * be the state's box, the shipped starter or a part's own prompt, and a per-clip note has to sit after
   * whichever of those named the subject.
   */
  clock = 300_000;
  const clipAi = new core.SpeechMachine(() => clock);
  const clipAiPrefs = core.cleanPreferences({
    motionClips: { working: { a1: { speech: '本地说的一句', prompt: '这句要说得得意一点' } } },
    speech: { source: 'ai', lines: { working: '兜底的一句' } },
  });
  eq(clipAi.observe(clipAiPrefs, 'working', null, 'zh', rnd, { id: 'a1', state: 'working' }), '本地说的一句',
    'in AI mode the clip\'s own 碎碎念 is still the line that stands while the model thinks');
  eq(clipAi.wantsAi.clipPrompt, '这句要说得得意一点', 'and its 提示词 travels with the request');
  eq(clipAi.wantsAi.state, 'working', 'beside the state the instruction is looked up by, unchanged');
  const clipAsked = [];
  const clipBook = { handled: 0, inFlight: false, promise: null };
  await core.pumpAiSpeech(clipAi, clipBook, (request) => { clipAsked.push(request); return Promise.resolve({ text: '模型的回答' }); });
  eq(clipAsked.length, 1, 'the surface asks once for it');
  eq(clipAsked[0].clipPrompt, '这句要说得得意一点', 'and the refinement is on the request the surface sends');
  // A clip with a line but no 提示词 asks for no refinement, and one with a 提示词 but no line is silent locally
  // and still refined: the two texts are independent, which is what two boxes in one row mean.
  clock += core.DEFAULT_SPEECH.holdSeconds * 1000;
  const noteOnly = new core.SpeechMachine(() => clock);
  const noteOnlyPrefs = core.cleanPreferences({
    motionClips: { working: { a1: { prompt: '只说提示词' } } },
    speech: { source: 'ai' },
  });
  eq(core.speechLines('zh', 'working').indexOf(noteOnly.observe(noteOnlyPrefs, 'working', null, 'zh', rnd, { id: 'a1', state: 'working' })) !== -1, true,
    'a clip with a 提示词 and no 碎碎念 still has the shipped line to say while the model thinks');
  eq(noteOnly.wantsAi.clipPrompt, '只说提示词', 'while the request still carries the refinement');
  clock += core.DEFAULT_SPEECH.holdSeconds * 1000;
  const lineOnly = new core.SpeechMachine(() => clock);
  eq(core.speechLines('zh', 'done').indexOf(lineOnly.observe(clipAiPrefs, 'done', null, 'zh', rnd, { id: 'a1', state: 'done' })) !== -1, true,
    'and the pair is per state here too: a clip with nothing written for 任务达成 gets the state\'s shipped line');
  eq(lineOnly.wantsAi.clipPrompt, null, 'so the host is asked the state\'s own question and no more');

  // Switched off means no speech AND no calls: the switch is about the pet talking, not about its voice box.
  clock = 400_000;
  const off = new core.SpeechMachine(() => clock);
  eq(off.observe(prefs({ enabled: false, source: 'ai' }), 'working', null, 'zh', rnd), null, 'speech off says nothing');
  eq(off.wantsAi, null, 'and asks for nothing either');

  // The surface's half: one request per intent, and the answer lands in the bubble.
  clock = 500_000;
  const machine = new core.SpeechMachine(() => clock);
  const book = { handled: 0, inFlight: false, promise: null };
  const asked = [];
  machine.observe(prefs({ source: 'ai', lines: { working: '兜底' } }), 'working', null, 'zh', rnd);
  const pending = core.pumpAiSpeech(machine, book, (request) => {
    asked.push(request);
    return Promise.resolve({ text: '来自模型' });
  });
  eq(book.inFlight, true, 'which is marked in flight while it runs');
  eq(core.pumpAiSpeech(machine, book, () => { asked.push({}); return null; }), pending,
    'a second pump while it is in flight asks nothing new');
  await pending;
  // The ask itself runs on a microtask (so a frame loop never blocks on a fetch), which is why the request is
  // counted here rather than before the await.
  eq(asked.length, 1, 'one intent is exactly one request');
  eq(asked[0].state, 'working', 'and carries the state the line belongs to');
  eq(asked[0].event, 'working', 'and the event that fired it');
  eq(machine.line(), '来自模型', 'and the answer replaced the fallback line');
  eq(book.inFlight, false, 'with the surface free again');

  // A failure leaves the fallback up, and is not retried here: the throttle decides when to try again.
  const failing = new core.SpeechMachine(() => clock);
  const failBook = { handled: 0, inFlight: false, promise: null };
  failing.observe(prefs({ source: 'ai', lines: { working: '兜底' } }), 'working', null, 'zh', rnd);
  await core.pumpAiSpeech(failing, failBook, () => Promise.reject(new Error('offline')));
  eq(failing.line(), '兜底', 'a failed request leaves the user\'s own line standing');
  eq(failBook.inFlight, false, 'and the surface is free to try again later');

  // An answer that arrives after the pet moved on is DROPPED, not shown over a newer state.
  const late = new core.SpeechMachine(() => clock);
  const lateBook = { handled: 0, inFlight: false, promise: null };
  /**
   * The state it moves ON to has a line of its own, which is the line the late answer must not replace.
   *
   * (It cannot be the shipped table any more: with a source other than the built-in one chosen, a state nobody wrote a
   * line for says nothing at all — see the `custom` block above.)
   */
  const latePrefs = prefs({ source: 'ai', lines: { done: '已经结束了' } });
  late.observe(latePrefs, 'working', null, 'zh', rnd);
  let release = null;
  const slow = core.pumpAiSpeech(late, lateBook, () => new Promise((resolveLate) => { release = resolveLate; }));
  // The ask starts on a microtask, so the request has to be admitted to flight before it can be released.
  await null;
  // Past the hold, so `done` is what the machine is looking at when the late answer lands: six seconds stopped being
  // past the shipped hold on 2026-10-13, and at six the state never moved — which would have left this assertion
  // passing because the line was still held rather than because the answer was dropped.
  clock += core.DEFAULT_SPEECH.holdSeconds * 1000;
  late.observe(latePrefs, 'done', null, 'zh', rnd);
  release({ text: '迟到的台词' });
  await slow;
  eq(late.line(), '已经结束了',
    'a late answer is dropped rather than spoken over the state that replaced it');

  /**
   * The SECOND reason the pet speaks: it was TOUCHED, on a part.
   *
   * The chain is AI → the part's own lines → the state's own lines → silence, and every step is here: a part
   * with lines speaks at once, a part without them borrows the state's box, a part nobody configured stays
   * silent AND costs nothing, and a rapid series of clicks is held to `reactGapSeconds` rather than becoming a
   * stream of requests. The AI half is asserted on the wire: the request carries the PART, which is what the
   * host turns into that part's prompt.
   */
  clock = 900_000;
  const reactions = core.cleanPreferences({
    parts: {
      items: [
        { id: 'ear', label: '耳朵', match: ['ErDuo'], speech: { lines: ['别摸耳朵', '痒'], prompt: '被摸耳朵时撒娇' } },
        { id: 'head', label: '头', region: 'head', match: [], speech: { lines: [] } },
        { id: 'body', label: '身体', region: 'body' },
      ],
    },
    speech: { enabled: true, source: 'custom', lines: { working: '状态台词' } },
  });
  const ear = core.partItemById(reactions, 'ear');
  const head = core.partItemById(reactions, 'head');
  const body = core.partItemById(reactions, 'body');
  const reacting = new core.SpeechMachine(() => clock);
  const said = reacting.react(reactions, ear, 'working', 'zh', rnd);
  eq(said === '别摸耳朵' || said === '痒', true, 'a press on a part says one of that part\'s own lines');
  eq(reacting.line(), said, 'and it is the line that is up');
  eq(reacting.current.part, 'ear', 'with the part recorded, so a readout can say where it came from');
  // The gap: the second press inside it says nothing, and does not disturb the line that is already up.
  clock += (core.PRESS_LIMITS.reactGapSeconds * 1000) - 500;
  eq(reacting.react(reactions, ear, 'working', 'zh', rnd), null, 'a second press inside the gap says nothing');
  eq(reacting.line(), said, 'and leaves the line it already said alone');
  clock += 1000;
  const second = reacting.react(reactions, ear, 'working', 'zh', rnd);
  eq(second === '别摸耳朵' || second === '痒', true, 'while one after the gap speaks again');
  eq(second === said, false, 'and prefers a line it did not just say');

  /**
   * A part with no lines of its own says its SHIPPED pool, and says it BEFORE the state's box is consulted.
   *
   * The pool is now in the chain for every source (2026-10-14: 「把所有的碎碎念都设置降级连，AI > 自定义（非空时）> 内置」), where
   * it used to belong to the built-in source alone — so a part with an empty box in AI or 自定义 mode answers 摸头 with a
   * shipped line instead of borrowing the state's remark. The part's own box still outranks it, and the state's box is
   * still the last tier.
   */
  const borrowed = new core.SpeechMachine(() => clock);
  const borrowedLine = borrowed.react(reactions, head, 'working', 'zh', rnd);
  eq(borrowedLine !== '状态台词', true, 'a part with no lines does not borrow the state\'s remark when it has its own pool');
  eq(typeof borrowedLine === 'string' && borrowedLine.length > 0, true, 'and says something of its own instead');
  /**
   * A part with SHIPPED lines says them, and says them BEFORE the state's box is consulted — while the source is
   * the built-in one, which is the only source those lines belong to (2026-10-12).
   *
   * 胸部 and 屁股 were the two rows this existed for — their boxes ship empty and the pet still answers 变态！ — and
   * since 2026-10-14 every region has a pool of its own, in two gestures. The state's box is deliberately fuller than
   * the part's here, so "the part's own voice wins" is the thing being measured rather than the only line available.
   */
  const shippedParts = core.cleanPreferences({
    speech: { enabled: true, source: 'builtin', lines: { working: '状态台词' } },
  });
  const chestItem = core.partItemById(shippedParts, 'chest');
  const chestClickPool = core.partSpeechLines(chestItem, true, 'zh', 'click');
  const pressingChest = new core.SpeechMachine(() => clock);
  const chestLine = pressingChest.react(shippedParts,
    { region: 'chest', bone: 'J_Bip_C_Chest', mesh: null, part: chestItem }, 'working', 'zh', rnd);
  eq(chestClickPool.indexOf(chestLine) !== -1, true,
    `a shipped 胸部 part answers with its OWN lines rather than the state's (${chestLine})`);
  eq(pressingChest.current.part, 'chest', 'recorded against that part, so a readout can say where it came from');
  /**
   * And the GESTURE picks the pool (operator, 2026-10-14): the same press held down draws from 长按's twenty, never
   * from the click's. This is the one thing a split table can get wrong while still saying something plausible, so
   * it is asserted on the press path rather than on the lookup alone.
   */
  const chestHoldPool = core.partSpeechLines(chestItem, true, 'zh', 'hold');
  const pressingHeld = new core.SpeechMachine(() => clock);
  const heldLine = pressingHeld.react(shippedParts,
    { region: 'chest', bone: 'J_Bip_C_Chest', mesh: null, part: chestItem }, 'working', 'zh', rnd, 'hold');
  eq(chestHoldPool.indexOf(heldLine) !== -1, true,
    `and a press HELD DOWN draws from the 长按 pool instead (${heldLine})`);
  eq(chestClickPool.indexOf(heldLine), -1, 'which a click could never have said');
  /**
   * …and so does the LANGUAGE, on the same terms: the surface hands over the locale it is running in, so an English
   * DSH hears the half written for it rather than the Chinese one.
   */
  const chestEnPool = core.partSpeechLines(chestItem, true, 'en', 'click');
  const pressingEn = new core.SpeechMachine(() => clock);
  const enLine = pressingEn.react(shippedParts,
    { region: 'chest', bone: 'J_Bip_C_Chest', mesh: null, part: chestItem }, 'working', 'en', rnd);
  eq(chestEnPool.indexOf(enLine) !== -1, true, `and an English surface is answered from the en pool (${enLine})`);
  const pressingButt = new core.SpeechMachine(() => clock);
  const buttItem = core.partItemById(shippedParts, 'butt');
  const buttLine = pressingButt.react(shippedParts,
    { region: 'butt', bone: null, mesh: 'pantsu', part: buttItem }, 'working', 'zh', rnd);
  eq(core.partSpeechLines(buttItem, true, 'zh', 'click').indexOf(buttLine) !== -1, true, 'and so does 屁股');
  /**
   * …and the SAME two rows still answer once the source is 自定义, because the shipped PART pool is now in the chain for
   * every source (2026-10-14: 「把所有的碎碎念都设置降级连，AI > 自定义（非空时）> 内置」). Until that day the pool belonged to the
   * built-in source alone (2026-10-12: 「如果设置了AI碎碎念，就停止输出内置的碎碎念」) and the press fell through to the state's
   * box instead — which is the silence this chain was set up to remove.
   */
  const customSource = core.cleanPreferences({
    speech: { enabled: true, source: 'custom', lines: { working: '状态台词' } },
  });
  eq(new core.SpeechMachine(() => clock).react(customSource,
    core.partItemById(customSource, 'chest'), 'working', 'zh', rnd) !== '状态台词', true,
  'and a 自定义 source says the shipped 变态！ rather than the state\'s remark');
  // The user's own box outranks the shipped one, which is the operator's own condition for both.
  const chestWritten = core.cleanPreferences({
    parts: { items: [{ id: 'chest', label: '胸部', region: 'chest', speech: { lines: ['不要脸'] } }] },
    speech: { enabled: true, source: 'custom', lines: { working: '状态台词' } },
  });
  eq(new core.SpeechMachine(() => clock).react(chestWritten,
    core.partItemById(chestWritten, 'chest'), 'working', 'zh', rnd), '不要脸',
  'while a line the user wrote replaces the shipped one — in every source');
  /**
   * In AI mode the shipped line STANDS while the model writes, and the request still names the part. Both halves matter —
   * it used to be silence until the answer landed (2026-10-12), and the fallback chain of 2026-10-14 is what put the
   * shipped pool back in front of the wait so a busy model cannot mute a press.
   */
  const chestAi = core.cleanPreferences({ speech: { enabled: true, source: 'ai' } });
  const chestAsk = new core.SpeechMachine(() => clock);
  const chestHeld = chestAsk.react(chestAi, core.partItemById(chestAi, 'chest'), 'working', 'zh', rnd);
  eq(typeof chestHeld === 'string' && chestHeld.length > 0, true,
    'in AI mode the shipped line is said while the model writes it — the press is never silent');
  eq(chestAsk.wantsAi && chestAsk.wantsAi.part, 'chest', 'with the request for that part standing beside it');
  // And the user's own part line still STANDS in AI mode, which is what keeps this from being "AI mode is mute".
  const chestAiWritten = core.cleanPreferences({
    parts: { items: [{ id: 'chest', label: '胸部', region: 'chest', speech: { lines: ['不要脸'] } }] },
    speech: { enabled: true, source: 'ai' },
  });
  const chestAiAsk = new core.SpeechMachine(() => clock);
  eq(chestAiAsk.react(chestAiWritten, core.partItemById(chestAiWritten, 'chest'), 'working', 'zh', rnd), '不要脸',
    'while a line the user wrote for that part is still said over the top of the wait');
  eq(chestAiAsk.wantsAi && chestAiAsk.wantsAi.part, 'chest', 'with the model still asked about it');
  // …and with nothing in ANY box the part still answers from its shipped pool, so the only way a press goes quiet is a
  // region with no pool and no box — the state's TABLE is still never borrowed, because 开始干活了 is a remark about the
  // turn rather than about the ear.
  const barePrefs = core.cleanPreferences({
    parts: { items: [{ id: 'body', label: '身体', region: 'body' }] },
    speech: { enabled: true, source: 'custom', lines: {} },
  });
  const untouched = new core.SpeechMachine(() => clock);
  const bareLine = untouched.react(barePrefs, core.partItemById(barePrefs, 'body'), 'working', 'zh', rnd);
  eq(core.speechLines('zh', 'working').indexOf(bareLine) === -1, true,
    'a part with empty boxes never borrows the shipped STATE table, which answers a different question');
  eq(untouched.wantsAi, null, 'and asks the host for nothing');
  eq(untouched.react(reactions, null, 'working', 'zh', rnd), null, 'as does a press nobody measured a part for');
  eq(new core.SpeechMachine(() => clock).react(
    core.cleanPreferences({ speech: { enabled: false }, parts: { items: [{ id: 'ear', label: 'x', speech: { lines: ['hi'] } }] } }),
    core.partItemById(core.cleanPreferences({ parts: { items: [{ id: 'ear', label: 'x', speech: { lines: ['hi'] } }] } }), 'ear'),
    'working', 'zh', rnd), null, 'and speech switched off silences a touch as well as a state');

  // The AI half: the request names the PART, and the answer lands in the bubble carrying it.
  clock = 950_000;
  const aiPartPrefs = core.cleanPreferences({
    parts: { items: [{ id: 'ear', label: '耳朵', match: ['ErDuo'], speech: { lines: ['兜底台词'], prompt: '被摸耳朵时撒娇' } }] },
    speech: { enabled: true, source: 'ai' },
  });
  const aiReact = new core.SpeechMachine(() => clock);
  const aiBook = { handled: 0, inFlight: false, promise: null };
  const aiAsked = [];
  eq(aiReact.react(aiPartPrefs, core.partItemById(aiPartPrefs, 'ear'), 'working', 'zh', rnd), '兜底台词',
    'in AI mode the part\'s own line stands while the model thinks');
  eq(aiReact.wantsAi && aiReact.wantsAi.part, 'ear', 'and the published intent names the part');
  await core.pumpAiSpeech(aiReact, aiBook, (request) => {
    aiAsked.push(request);
    return Promise.resolve({ text: '模型写的一句' });
  });
  eq(aiAsked.length, 1, 'which is one request');
  eq(aiAsked[0].part, 'ear', 'carrying the part, so the host can use that part\'s prompt');
  eq(aiReact.line(), '模型写的一句', 'and the answer replaces the fallback');
  /**
   * A part with a PROMPT but no lines is the one case where the pet is silent first: there is nothing to say
   * while the model thinks, and inventing a line from another part would be worse than waiting.
   */
  clock = 960_000;
  const promptOnly = core.cleanPreferences({
    parts: { items: [{ id: 'ear', label: '耳朵', match: ['ErDuo'], speech: { lines: [], prompt: '被摸耳朵时撒娇' } }] },
    speech: { enabled: true, source: 'ai' },
  });
  const waiting = new core.SpeechMachine(() => clock);
  eq(waiting.react(promptOnly, core.partItemById(promptOnly, 'ear'), 'working', 'zh', rnd), null,
    'a part with a prompt and no lines waits for the model in silence');
  eq(waiting.wantsAi && waiting.wantsAi.part, 'ear', 'with the request already standing');
  /**
   * And a part with NEITHER still ASKS — with WHAT was touched named in the request.
   *
   * This is the operator's request of 2026-10-11: "未设置对应部位 AI 提示词时，把触摸部位自动传入 AI 生成碎碎念，
   * 例如点击眼睛，把触摸眼睛的行为发给 LLM 生成。如果是默认未设置部位的结构，例如 bust，就传给 LLM 让它生成 bust
   * 被触摸的碎碎念". So the intent carries the STRUCTURE the raycast named — the bone when there is one, else the
   * mesh — and the pet stays silent only until the answer arrives.
   */
  const emptyBox = core.cleanPreferences({
    parts: { items: [{ id: 'ear', label: '耳朵', match: ['ErDuo'] }] },
    speech: { enabled: true, source: 'ai' },
  });
  const earItem = core.partItemById(emptyBox, 'ear');
  const nothing = new core.SpeechMachine(() => clock);
  eq(nothing.react(emptyBox, { region: 'head', bone: 'ErDuo.L.002', mesh: null, part: earItem }, 'working', 'zh', rnd),
    null, 'a part with an empty box and no prompt says nothing yet');
  eq(nothing.wantsAi && nothing.wantsAi.part, 'ear', 'but the model IS asked, because AI mode was chosen');
  eq(nothing.wantsAi.structure, 'ErDuo.L.002', 'and the request names the structure the press landed on');
  const askedPart = [];
  await core.pumpAiSpeech(nothing, { handled: 0, inFlight: false, promise: null }, (request) => {
    askedPart.push(request);
    return Promise.resolve({ text: '别摸耳朵啦' });
  });
  eq(askedPart[0].structure, 'ErDuo.L.002', 'which reaches the ask with the structure intact');
  eq(nothing.line(), '别摸耳朵啦', 'and the model\'s answer is what the pet then says');

  /**
   * The SPRING CHAIN travels with it, and the chain name is the one that means something.
   *
   * Operator, 2026-10-11: "触发点击碎碎念的时候，把对应的链名和结构名一起发给 LLM，链名的优先级大于结构名". The anatomy
   * carries `chain` as the three fields a chain has — `key`, `name`, `label` — and `chainNameOf` picks the
   * meaningful one: the DECLARED name first (`LiuHai`), then the root joint (`TwinTail.A.002.L`, which is all a
   * VRM 0.x twintail has), then the storage key (`hair0`). Both names are published, so the host can prefer the
   * chain and still mention the structure.
   */
  const chainClock = 970_000;
  const chainPrefs = core.cleanPreferences({
    parts: { items: [{ id: 'hair', label: '刘海', match: ['LiuHai'] }] },
    speech: { enabled: true, source: 'ai' },
  });
  const hairItem = core.partItemById(chainPrefs, 'hair');
  const withChain = new core.SpeechMachine(() => chainClock);
  withChain.react(chainPrefs, {
    region: 'head',
    bone: 'LiuHai.002',
    mesh: null,
    part: hairItem,
    chain: { key: 'LiuHai', name: 'LiuHai', label: 'LiuHai', joints: 4 },
  }, 'working', 'zh', rnd);
  eq(withChain.wantsAi && withChain.wantsAi.chain, 'LiuHai', 'a press on a spring joint publishes its CHAIN');
  eq(withChain.wantsAi.structure, 'LiuHai.002', 'alongside the structure, so the host has both');
  const askedChain = [];
  await core.pumpAiSpeech(withChain, { handled: 0, inFlight: false, promise: null }, (request) => {
    askedChain.push(request);
    return Promise.resolve({ text: '别拽刘海' });
  });
  eq(askedChain[0].chain, 'LiuHai', 'and both names reach the ask');
  eq(askedChain[0].structure, 'LiuHai.002', 'with the structure still there');
  // An UNNAMED VRM 0.x chain: the file declares nothing, so the root joint is the name a person recognises.
  const unnamed = new core.SpeechMachine(() => chainClock);
  unnamed.react(chainPrefs, {
    region: 'head', bone: 'TwinTail.A.003.L', mesh: null, part: hairItem,
    chain: { key: 'hair0', name: null, label: 'TwinTail.A.002.L', joints: 13 },
  }, 'working', 'zh', rnd);
  eq(unnamed.wantsAi.chain, 'TwinTail.A.002.L', 'an unnamed chain is named by its root joint, not by hair0');
  // A chain that carries nothing usable names nothing at all rather than the empty string.
  const nameless = new core.SpeechMachine(() => chainClock);
  nameless.react(chainPrefs, { region: 'head', bone: 'x', mesh: null, part: hairItem, chain: { key: '', name: '  ', label: null } },
    'working', 'zh', rnd);
  eq(nameless.wantsAi.chain, null, 'and a chain with no usable name publishes null');
  // A plain string is accepted too, so a surface that already reduced it cannot disagree about the shape.
  const asString = new core.SpeechMachine(() => chainClock);
  asString.react(chainPrefs, { region: 'head', bone: 'x', mesh: null, part: hairItem, chain: 'TwinTail' }, 'working', 'zh', rnd);
  eq(asString.wantsAi.chain, 'TwinTail', 'a chain already reduced to a name is accepted as it is');
  eq(core.chainNameOf({ name: 'A', label: 'B', key: 'C' }), 'A', 'and the rule itself prefers the declared name');
  eq(core.chainNameOf({ name: '', label: 'B', key: 'C' }), 'B', 'then the root joint');
  eq(core.chainNameOf({ key: 'C' }), 'C', 'then the storage key');
  eq(core.chainNameOf(null), null, 'while nothing at all stays nothing');
  /**
   * The structure can be a MESH NAME alone, which is the `bust` case: there is no bone named bust, and the name
   * the model file uses is the only thing to send.
   *
   * The part here is passed EXPLICITLY rather than resolved from the name, and that is the point: `bust` now
   * belongs to the shipped 胸部 row (2026-10-12), so a caller that has not re-measured its anatomy — an older
   * cached scene — still says the line about the part it DID find, while the structure name travels unchanged.
   */
  const bustPrefs = core.cleanPreferences({
    parts: { items: [{ id: 'body', label: '身体', region: 'body' }] },
    speech: { enabled: true, source: 'ai' },
  });
  const bust = new core.SpeechMachine(() => clock);
  bust.react(bustPrefs, { region: 'body', bone: null, mesh: 'bust', part: core.partItemById(bustPrefs, 'body') },
    'working', 'zh', rnd);
  eq(bust.wantsAi && bust.wantsAi.structure, 'bust', 'a mesh-only structure is sent by its own name too');
  eq(bust.wantsAi.part, 'body', 'under the part that answered for it');
  // A bone beats a mesh when both are known: `leftEye` says which eye, the face mesh says nothing.
  const both = new core.SpeechMachine(() => clock);
  both.react(emptyBox, { region: 'eye', bone: 'J_Adj_L_FaceEye', mesh: 'Face.baked', part: earItem }, 'working', 'zh', rnd);
  eq(both.wantsAi.structure, 'J_Adj_L_FaceEye', 'and a bone name is preferred over the mesh name');
  /**
   * A caller that knows the PART but measured no anatomy (an older cached scene, or a surface that skipped the
   * raycast) still gets the part's own reaction — with no structure to name.
   */
  const bare = new core.SpeechMachine(() => clock);
  bare.react(emptyBox, earItem, 'working', 'zh', rnd);
  eq(bare.wantsAi && bare.wantsAi.part, 'ear', 'a bare part item is accepted as well');
  eq(bare.wantsAi.structure, null, 'with no structure named, because none was measured');
  /**
   * But with speech OFF nothing is asked at all: the switch is above every other rule.
   */
  const mutedParts = core.cleanPreferences({
    parts: { items: [{ id: 'ear', label: '耳朵', match: ['ErDuo'] }] },
    speech: { enabled: false, source: 'ai' },
  });
  const mutedReact = new core.SpeechMachine(() => clock);
  eq(mutedReact.react(mutedParts, { region: 'head', bone: 'ErDuo', mesh: null, part: core.partItemById(mutedParts, 'ear') },
    'working', 'zh', rnd), null, 'speech off asks nothing');
  eq(mutedReact.wantsAi, null, 'and publishes no intent');
}

// ---------------------------------------------------------------------------
group('6g. the state channel: a heartbeat, and what a stale report answers');
// ---------------------------------------------------------------------------

{
  /**
   * THE REPORT THIS EXISTS FOR (operator, 2026-10-11): "有时候开始工作的碎碎念不消失，完成任务后还在显示深度求索中".
   *
   * The state channel is one-way (the app's pet POSTS, the floating window GETS), and the app posted only on CHANGE
   * — correct, but it made silence ambiguous: a long turn and a page whose frame loop had STOPPED look identical from
   * outside. Chromium stops that loop while the DSH window is hidden, so a turn finishing in the background was never
   * computed, never sent, and the window drew 工作中 / 深度求索中 over a counting clock for ever. Two halves fix it:
   * the reporter RE-STATES itself on a timer, and the host stops believing a report that has gone quiet.
   */
  const beatEvery = core.HOST_STATE_HEARTBEAT_MS;
  const staleAfter = core.HOST_STATE_STALE_MS;
  ok(beatEvery > 0 && staleAfter > beatEvery * 3,
    `the freshness window (${staleAfter} ms) tolerates several missed heartbeats (${beatEvery} ms each)`);

  // The rule itself, at its edges.
  const t0 = 1_700_000_000_000;
  eq(core.hostStateIsStale(0, t0), false, 'a pet that has NEVER reported is not "stale", it is absent');
  eq(core.hostStateIsStale(t0, t0), false, 'a report from this instant is fresh');
  eq(core.hostStateIsStale(t0, t0 + staleAfter), false, 'one exactly at the window is still believed');
  eq(core.hostStateIsStale(t0, t0 + staleAfter + 1), true, 'and one past it is not');
  eq(core.hostStateIsStale(t0, t0 + 60_000), false,
    'while a hidden page throttled to one wake a minute is still inside the window');

  // What the host ANSWERS, which is where the window's behaviour comes from.
  const fresh = core.hostStateView({ state: 'working', line: '深度求索中', at: t0, seq: 7 }, t0 + 1000);
  eq(fresh.state, 'working', 'a fresh report is served as it was reported');
  eq(fresh.line, '深度求索中', 'with its line');
  eq(fresh.stale, false, 'and marked fresh');
  eq(fresh.seq, 7, 'on its own sequence, so a reader that only watches `seq` is not woken for nothing');
  eq(fresh.transition, false, 'and no transition is claimed');

  const old = core.hostStateView({ state: 'working', line: '深度求索中', at: t0, seq: 7 }, t0 + staleAfter + 1);
  eq(old.state, null, 'an aged report is answered as NO PET REPORTING, not as the last thing it said');
  eq(old.line, null, 'with no 碎碎念 line left over either');
  eq(old.stale, true, 'and marked stale');
  eq(old.seq, 8, 'with the sequence bumped ONCE, because the reader only looks when `seq` moves');
  eq(old.transition, true, 'which is the transition it is told about');
  const stillOld = core.hostStateView({ state: null, line: null, at: t0, seq: 8, stale: true }, t0 + staleAfter + 5000);
  eq(stillOld.seq, 8, 'a report that is STILL aged does not bump the sequence again');
  eq(stillOld.transition, false, 'because nothing changed for the reader');
  const back = core.hostStateView({ state: 'working', at: Date.now(), seq: 9, stale: true }, Date.now());
  eq(back.state, 'working', 'and a fresh report after a stale one is served again');
  eq(back.seq, 10, 'with its own bump, so a window that cleared its label hears that there is a pet again');
  eq(back.transition, true, 'as a transition');

  /**
   * The HEARTBEAT, driven with an injected timer: a beat re-states the last report unchanged, and — the trap — it
   * must NOT re-send the touch. A press is an event; repeating it would tell the host the pet was pressed again
   * every few seconds.
   */
  const posts = [];
  let tick = null;
  const reporter = core.createStateReporter({
    fetchImpl: (url, options) => {
      posts.push(JSON.parse(options.body));
      return Promise.resolve({ ok: true });
    },
    setIntervalImpl: (fn, ms) => { tick = { fn, ms }; return tick; },
    clearIntervalImpl: (handle) => { if (handle === tick) tick = null; },
  });
  eq(reporter.startHeartbeat(), true, 'the heartbeat starts');
  eq(tick && tick.ms, beatEvery, `at the documented interval (${beatEvery} ms)`);
  eq(reporter.startHeartbeat(), false, 'and asking twice does not start a second one');
  await Promise.resolve();
  tick.fn();
  await Promise.resolve();
  eq(posts.length, 0, 'a beat before anything was reported sends nothing');

  await reporter.report('working', '深度求索中', { reason: 'click', region: 'head', at: t0 });
  eq(posts.length, 1, 'a normal report goes out');
  eq(posts[0].state, 'working', 'with the state');
  ok(Boolean(posts[0].touch), 'and the press');
  await reporter.report('working', '深度求索中', { reason: 'click', region: 'head', at: t0 });
  eq(posts.length, 1, 'the same report twice is deduplicated, which is what made silence ambiguous');
  await tick.fn();
  eq(posts.length, 2, 'but a BEAT sends it again');
  eq(posts[1].state, 'working', 're-stating the state');
  eq(posts[1].line, '深度求索中', 'and the line');
  eq(posts[1].touch, undefined, 'and NOT the press, because a press is an event and not a state');
  /**
   * And the CLOCK travels too, including the fallback sentinel: the floating window has no turn frames of its own, so
   * this relay is the only way its 用时 can be the app's number — or, without any frames at all, the state-clock answer.
   */
  await reporter.report('working', '深度求索中', null, { startedAt: t0, endedAt: null });
  eq(posts[2].clock.startedAt, t0, 'a turn clock rides with the report');
  await reporter.report('working', '深度求索中', null, 'state');
  eq(posts[3].clock, 'state', 'and the stream-less sentinel rides as itself, not as null');
  reporter.stopHeartbeat();
  eq(tick, null, 'and it can be stopped, so a disposed widget does not keep talking');
}

// ---------------------------------------------------------------------------
group('7. deferral: a completion arriving mid-drag is not lost');
// ---------------------------------------------------------------------------
{
  let clock = 2_000_000;
  const machine = new core.PetMachine(() => clock, 120000);
  const idle = { available: true, running: false, pending: false, notice: undefined };

  // A short drag must not put the pet to sleep: the idle deadline slides by the
  // whole time the pointer owned it.
  machine.setInteraction('held');
  machine.setDeferral(true);
  clock += 20000;                          // held for 20 s of a 120 s nap timeout
  machine.setInteraction(null);
  machine.setDeferral(false);
  eq(machine.resolve(idle), 'resting', 'a 20 s drag of a 120 s timeout does not make the pet nap');

  // The slide is bounded by MAX_DEFER_MS, so an hour-long drag cannot keep the
  // pet awake indefinitely: it drifts to the banked maximum and then naps.
  let clock2 = 3_000_000;
  const machine2 = new core.PetMachine(() => clock2, 120000);
  machine2.setDeferral(true);
  clock2 += 60 * 60 * 1000;                // held for an hour
  machine2.setDeferral(false);
  eq(machine2.lastBusyAt, 3_000_000 + core.MAX_DEFER_MS,
    'the banked deferral is clamped to MAX_DEFER_MS');
  eq(machine2.resolve(idle), 'sleeping',
    'after the cap the pet sleeps, because an hour really has passed');

  // Unbalanced calls must be harmless.
  const machine3 = new core.PetMachine(() => 0, 1000);
  machine3.setDeferral(false);
  machine3.setDeferral(true);
  machine3.setDeferral(true);
  eq(machine3.deferredSince, 0, 'a repeated freeze keeps the first timestamp');
  machine3.setDeferral(false);
  eq(machine3.deferredSince, null, 'resuming clears the freeze');
}

// ---------------------------------------------------------------------------
group('8. session aggregate');
// ---------------------------------------------------------------------------
{
  let clock = 5_000_000;
  const aggregate = new core.SessionAggregate(() => clock);

  aggregate.setInput({ connected: false, catalog: { byId: {}, phase: 'ready' }, statuses: new Map() });
  eq(aggregate.snapshot().available, false, 'no connection means unavailable');

  const statuses = new Map([['s1', { running: true }]]);
  aggregate.setInput({ connected: true, catalog: { byId: { s1: {} }, phase: 'ready' }, statuses });
  let snapshot = aggregate.snapshot();
  eq(snapshot.available, true, 'connected and ready is available');
  eq(snapshot.running, true, 'a running session is reported');
  eq(snapshot.pending, false, 'no pending approval');

  // Pending interaction takes a session out of "working".
  aggregate.setInput({
    connected: true,
    catalog: { byId: { s1: {} }, phase: 'ready' },
    statuses: new Map([['s1', { running: true, pendingInteraction: { id: 'x' } }]]),
  });
  snapshot = aggregate.snapshot();
  eq(snapshot.pending, true, 'a pending interaction is reported');
  eq(snapshot.workingCount, 0, 'a waiting session is not also working');
  eq(snapshot.running, false, 'running counts only non-waiting sessions');

  // Subagents are ignored.
  aggregate.setInput({
    connected: true,
    catalog: { byId: { s1: { isSubagent: true } }, phase: 'ready' },
    statuses: new Map([['s1', { running: true }]]),
  });
  eq(aggregate.snapshot().running, false, 'a subagent does not drive the pet');

  // Turn boundaries: start records, end completes.
  aggregate.reset([{ sessionId: 'main', isSubagent: false }]);
  aggregate.setInput({ connected: true, catalog: { byId: { main: {} }, phase: 'ready' }, statuses: new Map() });
  eq(aggregate.snapshot().running, false, 'a reset aggregate is idle');
  aggregate.boundary({ type: 'turn/start', sessionId: 'main', seq: 1 });
  eq(aggregate.snapshot().running, true, 'turn/start marks the session running');
  aggregate.boundary({ type: 'turn/end', sessionId: 'main', seq: 2, reason: 'completed' });
  snapshot = aggregate.snapshot();
  eq(snapshot.running, false, 'turn/end stops it running');
  eq(snapshot.notice?.reason, 'completed', 'turn/end records the completion notice');

  // A subagent boundary is ignored as a BOUNDARY — and its classification is remembered (2026-10-14).
  const before = aggregate.snapshot().notice;
  const runningBefore = aggregate.snapshot().running;
  aggregate.boundary({ type: 'turn/start', sessionId: 'child', seq: 9, isSubagent: true });
  eq(aggregate.snapshot().notice, before, 'a subagent boundary changes nothing');
  eq(aggregate.snapshot().running, runningBefore, 'and a helper starting does not put the pet to work');
  /**
   * The classification is the ONE thing a helper's frame leaves behind, and it is load-bearing: the frame is the only
   * live answer to "is this a helper", and the pet's own store edge (below) has nothing else to filter on for a helper
   * spawned after the baseline identities arrived.
   */
  eq(aggregate.records.get('child') && aggregate.records.get('child').isSubagent, true,
    'while its classification IS remembered, which is what keeps its later store edge silent');
  eq(aggregate.subagent('child'), true, 'so the aggregate can answer for it from then on');
  eq(aggregate.records.get('child') ? aggregate.records.get('child').running : 'missing', undefined,
    'and nothing else about it was recorded — no running, no notice');
  {
    /**
     * A helper that ALSO holds a row in the app's own session list is still not the user's task, which is why the
     * classification is what `mainSession` asks FIRST. `observeStoreEdge` is the path being pinned: the store's
     * falling edge used to be the way a helper's stop became 任务达成.
     */
    const listed = new core.SessionAggregate(() => clock);
    const world = { connected: true, catalog: { byId: { main: {}, child: {} }, phase: 'ready' } };
    listed.setInput({ ...world, statuses: new Map([['child', { running: true }]]) });
    listed.boundary({ type: 'turn/start', sessionId: 'child', seq: 1, isSubagent: true });
    listed.boundary({ type: 'turn/end', sessionId: 'child', seq: 2, reason: 'completed', isSubagent: true });
    eq(listed.snapshot().notice, undefined, 'a helper WITH a session row still reports no completion');
    listed.setInput({ ...world, statuses: new Map([['child', { running: false, completionUnread: true }]]) });
    eq(listed.snapshot().notice, undefined, 'and its store edge is silent too');
    eq(listed.snapshot().unreadCount, 0, 'and it never lights the dot, listed row or not');
    /**
     * The fail-closed half: a frame for a session NOBODY can vouch for — not classified by the host, not listed by the
     * app — is silence, because a turn ending there is indistinguishable from a helper's.
     */
    const stranger = new core.SessionAggregate(() => clock);
    const app = { connected: true, catalog: { byId: { main: {} }, phase: 'ready' }, statuses: new Map() };
    stranger.setInput(app);
    stranger.boundary({ type: 'turn/start', sessionId: 'ghost', seq: 1 });
    stranger.boundary({ type: 'turn/end', sessionId: 'ghost', seq: 2, reason: 'completed' });
    eq(stranger.snapshot().notice, undefined, 'a turn end for a session nobody can vouch for is not a completion');
    /**
     * …while a frame the host DID classify as a root still reports, catalog row or not: the fail-closed rule must not
     * cost the user's own brand-new session its completion.
     */
    const fresh = new core.SessionAggregate(() => clock);
    fresh.setInput(app);
    fresh.boundary({ type: 'turn/start', sessionId: 'new1', seq: 1, isSubagent: false });
    fresh.boundary({ type: 'turn/end', sessionId: 'new1', seq: 2, reason: 'completed', isSubagent: false });
    eq(fresh.snapshot().notice && fresh.snapshot().notice.sessionId, 'new1',
      'while a ROOT the host vouched for reports normally, listed or not');
  }

  // ---------------------------------------------------------------------------
  // The store's own running flag, which is what makes 任务完成 work without the RPC
  // boundary stream (the operator's "任务完成之后并没有任何提示").
  // ---------------------------------------------------------------------------
  {
    const live = core.cleanPreferences({});
    // Mutable, because a completion now waits out its settle window before the pet says 任务达成.
    let now = 1_800_000_000_000;
    const storeAggregate = new core.SessionAggregate(() => now);
    const runningStore = (running) => new Map([['m1', { running }]]);
    const base = { connected: true, catalog: { byId: { m1: {} }, phase: 'ready' }, statuses: runningStore(true) };

    storeAggregate.setInput(base);
    eq(storeAggregate.snapshot().running, true, 'a session the store calls running is working');

    // The edge: the store says the turn ended. No boundary frame anywhere.
    storeAggregate.setInput({ ...base, statuses: runningStore(false) });
    eq(storeAggregate.snapshot().running, false, 'the store saying it stopped leaves 工作中');
    eq(storeAggregate.snapshot().notice?.reason, 'completed',
      'and that falling edge IS the completion notice, with no turn/end frame in sight');
    {
      /**
       * End to end, with NO boundary frame anywhere: the snapshot the aggregate produces must be enough for the
       * machine to say 任务达成. Handing the machine a synthetic `turn/end` here used to be how this check
       * passed, and that is exactly the hole the operator found — the aggregate wrote the notice and the
       * machine never read it ("完成后的提示还是没有传到独立桌宠上").
       */
      const machine = new core.PetMachine(() => now, 120000);
      // The store edge is the ONLY source here, and the settlement is what stands between it and 任务达成.
      eq(machine.resolve(storeAggregate.snapshot()), 'resting',
        'the snapshot alone is not yet 任务达成: the completion is waiting out its settle window');
      now += core.COMPLETION_SETTLE_MS + 1;
      eq(machine.resolve(storeAggregate.snapshot()), 'done',
        'the SNAPSHOT alone is enough: the machine adopts the aggregate’s completion notice');
      eq(core.statusFor(live, 'done', now, now).text, '任务达成',
        'and the line it says is the operator’s own');
      // The window draws whatever the in-app pet published, so the machine's own state is what matters.
      eq(storeAggregate.snapshot().available && storeAggregate.snapshot().running === false, true,
        'while the snapshot itself reports nothing running — no 工作中 to fall back to');
    }

    // A new turn clears the old notice, exactly as a turn/start frame does.
    storeAggregate.setInput({ ...base, statuses: runningStore(true) });
    eq(storeAggregate.snapshot().notice, undefined, 'starting again clears the completion notice');

    // The subagent rule holds for the store too: a helper finishing is not the user's task.
    const sub = { connected: true, catalog: { byId: { m1: { isSubagent: true } }, phase: 'ready' } };
    storeAggregate.setInput({ ...sub, statuses: runningStore(true) });
    storeAggregate.setInput({ ...sub, statuses: runningStore(false) });
    eq(storeAggregate.snapshot().notice, undefined, 'a subagent stopping is not a completion');

    /**
     * …and a HELPER THE PET CANNOT CLASSIFY is not the user's task either (operator, 2026-10-14: 「子代理、子任务完成后
     * 不应该汇报完成的状态，必须总任务完成了才汇报完成状态」).
     *
     * This is the failing half, and it was measured live before it was written down: three probe subagents were spawned
     * into a long-lived session, and while the main session kept working the pet's green dot was lit for two of them
     * (`/vrmpet3d/state`: `state=working unread=2`). Both inputs are realistic and neither is exotic —
     *
     *   * DSH marks a finished subagent's session `completionUnread` exactly like a user session's (that is what the
     *     dot is drawn from), and the pet counted every in-scope session's flag;
     *   * a helper spawned AFTER the baseline identities arrived has no classification at all — no record, and (for a
     *     subagent) no session-list row — so the old `subagent(id)` test answered "not a subagent" and let its stop
     *     through as a completion.
     *
     * The rule is now the app's own session list: a session it does not list cannot be one the user is told to go
     * back to, so it reports nothing. `h1` below is exactly that session: only ever in the status map.
     */
    const helpers = new core.SessionAggregate(() => now);
    const listed = { connected: true, catalog: { byId: { m1: {} }, phase: 'ready' } };
    helpers.reset([{ sessionId: 'm1', isSubagent: false }]);
    helpers.setInput({ ...listed, statuses: new Map([['m1', { running: true }], ['h1', { running: true }]]) });
    eq(helpers.snapshot().running, true, 'the user\'s own session is what makes the pet work');
    helpers.setInput({
      ...listed,
      statuses: new Map([['m1', { running: true }], ['h1', { running: false, completionUnread: true }]]),
    });
    eq(helpers.snapshot().notice, undefined, 'a helper the app never listed raises no completion at all');
    eq(helpers.snapshot().unreadCount, 0, 'and its unread flag draws no green dot of the user\'s');
    eq(helpers.snapshot().running, true, 'while the user\'s own session keeps the pet on 工作中');
    // The user's own session, finished while off screen, still does both — that is the dot's whole point.
    helpers.setInput({
      ...listed,
      statuses: new Map([
        ['m1', { running: false, completionUnread: true }],
        ['h1', { running: false, completionUnread: true }],
      ]),
    });
    eq(helpers.snapshot().notice && helpers.snapshot().notice.sessionId, 'm1',
      'the user\'s own session still reports its completion');
    eq(helpers.snapshot().unreadCount, 1, 'and only THAT one is counted toward the dot');
    /**
     * A helper the HOST did classify (an identity list or a boundary frame) is skipped on the same terms, so the fix
     * does not depend on which of the two paths learned about it.
     */
    const classified = new core.SessionAggregate(() => now);
    classified.setInput({ ...listed, statuses: new Map([['m1', { running: true }], ['h1', { running: true }]]) });
    classified.reset([{ sessionId: 'm1', isSubagent: false }, { sessionId: 'h1', isSubagent: true }]);
    classified.setInput({
      ...listed,
      statuses: new Map([['m1', { running: true }], ['h1', { running: false, completionUnread: true }]]),
    });
    eq(classified.snapshot().notice, undefined, 'a helper the host DID classify is skipped as before');
    eq(classified.snapshot().unreadCount, 0, 'and it never contributes to the dot either');
    /**
     * THE 绿点 REGRESSION (operator, 2026-10-14: 「明明没有已完成的会话，在工作中的时候，深度求索中前面有绿点」).
     *
     * Measured live with `build/probe-out/watch-state.mjs`: `unread=0` in 219 of 219 samples, then `unread=4` in every
     * sample after four review subagents were spawned — one per helper. `mainSession` was written to stop exactly that,
     * but its store half looks for an `isSubagent` FIELD that this build's records do not have (measured: `id`,
     * `displayTitle`, `running`, `retainedBy`, `blank`, `updatedAt`, `projectionValues`, `title`, `cwd`), so a helper
     * reached the `byId` fallback — a table of everything the store has seen — and was counted. The app's own LIST
     * (`ids`) is the half that answers the real question, and every test above this uses a store WITHOUT one.
     */
    const withList = new core.SessionAggregate(() => now);
    withList.setInput({
      connected: true,
      phase: 'ready',
      catalog: {
        ids: ['m1'],
        byId: { m1: { id: 'm1', blank: false }, h1: { id: 'h1', blank: false } },
      },
      statuses: new Map([['m1', { running: false, completionUnread: true }], ['h1', { running: false, completionUnread: true }]]),
    });
    const withListSnap = withList.snapshot();
    eq(withListSnap.unreadCount, 1, 'a helper in the record table but NOT in the app\'s list is not the user\'s dot');
    eq(withListSnap.unreadDetail.candidates, 2, 'the breakdown counts every session DSH marked unread');
    eq(withListSnap.unreadDetail.counted, 1, 'and how many of them passed as the user\'s own');
    eq(withListSnap.unreadDetail.inIds, 1, 'naming the app\'s own list as the reason');
    eq(withListSnap.unreadDetail.inById, 2, 'beside the record table, which holds both');
    // A store that has no list keeps the OLD answer: this may only ever be stricter where a list exists.
    const noList = new core.SessionAggregate(() => now);
    noList.setInput({
      connected: true,
      phase: 'ready',
      catalog: { byId: { h1: { id: 'h1' } } },
      statuses: new Map([['h1', { running: false, completionUnread: true }]]),
    });
    eq(noList.snapshot().unreadCount, 1, 'a store with no ids list falls back to the record table, unchanged');

    /**
     * And the fallback the store edge exists for is untouched: with NO identity list at all (the RPC boundary stream
     * not wired, which is the case `observeStoreEdge` was added for) a session the app lists still reports when it
     * stops — the fix fails closed for strangers, not for the user.
     */
    const noStream = new core.SessionAggregate(() => now);
    noStream.setInput({ ...listed, statuses: new Map([['m1', { running: true }]]) });
    noStream.setInput({ ...listed, statuses: new Map([['m1', { running: false }]]) });
    eq(noStream.snapshot().notice && noStream.snapshot().notice.sessionId, 'm1',
      'and a listed session still reports with no boundary stream at all, which is why this path exists');
    /**
     * A FIRST SIGHTING IS A BASELINE, NOT AN EDGE (operator, 2026-10-14: 「每次关闭dsh再打开，桌宠就汇报任务完成，才恢复到idle」).
     *
     * At boot the store hands over every session as `running: false`, and `previous` is `undefined` for all of them —
     * so treating an unseen session as "it was running and just stopped" made the pet announce 任务完成 once per DSH
     * start, for every session that was not running. Only a session this store itself reported as running can stop.
     */
    const boot = new core.SessionAggregate(() => now);
    boot.setInput({
      connected: true,
      catalog: { byId: { m1: {}, m2: {} }, phase: 'ready' },
      statuses: new Map([['m1', { running: false }], ['m2', { running: false, completionUnread: true }]]),
    });
    eq(boot.snapshot().notice, undefined, 'a session first seen as NOT running raises no completion at all');
    boot.setInput({
      connected: true,
      catalog: { byId: { m1: {}, m2: {} }, phase: 'ready' },
      statuses: new Map([['m1', { running: false }], ['m2', { running: false, completionUnread: true }]]),
    });
    eq(boot.snapshot().notice, undefined, 'nor does the same answer on the next poll');
    boot.setInput({
      connected: true,
      catalog: { byId: { m1: {}, m2: {} }, phase: 'ready' },
      statuses: new Map([['m1', { running: true }], ['m2', { running: false }]]),
    });
    eq(boot.snapshot().notice, undefined, 'a turn starting is not a completion either');
    boot.setInput({
      connected: true,
      catalog: { byId: { m1: {}, m2: {} }, phase: 'ready' },
      statuses: new Map([['m1', { running: false }], ['m2', { running: false }]]),
    });
    eq(boot.snapshot().notice && boot.snapshot().notice.sessionId, 'm1',
      'while the session this store DID see running reports the moment it stops');
    /**
     * A helper running ALONE is not the user's work, which is the same rule seen from the other side: the pet stays
     * off 工作中 rather than reporting a task nobody asked for.
     */
    const helperOnly = new core.SessionAggregate(() => now);
    helperOnly.setInput({ ...listed, statuses: new Map([['h1', { running: true }]]) });
    eq(helperOnly.snapshot().running, false, 'a helper running alone is not the user\'s work either');

    /**
     * And the precedence that caused the stuck pet: a `turn/start` whose `turn/end` never arrives — a dropped
     * stream, or the upgrade channel simply not being wired — must not outvote the store forever.
     */
    const pinned = new core.SessionAggregate(() => now);
    pinned.reset([{ sessionId: 'm1', isSubagent: false }]);
    pinned.setInput({ connected: true, catalog: { byId: { m1: {} }, phase: 'ready' }, statuses: runningStore(false) });
    pinned.boundary({ type: 'turn/start', sessionId: 'm1', seq: 1 });
    eq(pinned.snapshot().running, false,
      'a boundary record cannot pin a session at running once the store says it stopped');
    pinned.setInput({ connected: true, catalog: { byId: { m1: {} }, phase: 'ready' }, statuses: new Map() });
    eq(pinned.snapshot().running, true,
      'while a session the store does not list still falls back to its boundary record');
  }

  // A failure latches until a new turn starts; a success must not erase it.
  aggregate.boundary({ type: 'turn/end', sessionId: 'main', seq: 3, reason: 'error' });
  eq(aggregate.snapshot().notice?.reason, 'error', 'an error is recorded');
  aggregate.boundary({ type: 'turn/end', sessionId: 'main', seq: 4, reason: 'completed' });
  eq(aggregate.snapshot().notice?.reason, 'error', 'a following success does not erase a latched failure');
  aggregate.boundary({ type: 'turn/start', sessionId: 'main', seq: 5 });
  eq(aggregate.snapshot().notice, undefined, 'a new turn clears the latched failure');
  aggregate.boundary({ type: 'turn/end', sessionId: 'main', seq: 6, reason: 'completed' });
  eq(aggregate.snapshot().notice?.reason, 'completed', 'and the next turn reports normally again');

  // Current-session scope filters other sessions out.
  aggregate.reset([]);
  aggregate.setInput({
    connected: true,
    scope: 'current',
    currentSessionId: 'mine',
    catalog: { byId: { mine: {}, other: {} }, phase: 'ready' },
    statuses: new Map([['other', { running: true }]]),
  });
  eq(aggregate.snapshot().running, false, 'current scope ignores another session\'s turn');
  eq(aggregate.snapshot().available, true, 'current scope is available when the selected session exists');

  // …but a selected session that does not exist yet is not a session.
  aggregate.setInput({
    connected: true,
    scope: 'current',
    currentSessionId: 'not-created-yet',
    catalog: { byId: { mine: {} }, phase: 'ready' },
    statuses: new Map(),
  });
  eq(aggregate.snapshot().available, false, 'an unknown selected session is not available');

  // Stale and malformed boundaries never throw.
  aggregate.boundary(null);
  aggregate.boundary({});
  aggregate.boundary({ type: 'turn/start', sessionId: '' });
  aggregate.boundary({ type: 'turn/start', sessionId: 'x', seq: 'not a number' });
  ok(true, 'malformed boundaries are ignored without throwing');
}

// ---------------------------------------------------------------------------
group('9. idle motion');
// ---------------------------------------------------------------------------
{
  const pose0 = core.idlePose(0, 'resting', { periodSeconds: 4 });
  const pose4 = core.idlePose(4, 'resting', { periodSeconds: 4 });
  near(pose0.breathScale, pose4.breathScale, 1e-12, 'breathing loops exactly after one period');
  // There is NO vertical term any more. The idle used to carry a whole-body `bob`
  // (`sin(2theta) * 0.0025` of a viewport height) and the report was that the pet drifted up and down;
  // the user asked for left-right micro-motion only AT THE TIME — and then removed that too (see the yaw
  // assertions below). Asserted as an absence, because "there is no vertical movement" is exactly the kind
  // of thing a later refactor reintroduces by accident.
  ok(!('bob' in pose0), 'the idle pose has no vertical term');
  {
    let vertical = null;
    for (let t = 0; t < 4; t += 0.05) {
      const pose = core.idlePose(t, 'resting', { periodSeconds: 4 });
      const key = ['bob', 'lift', 'dy'].find((name) => name in pose);
      if (key) { vertical = `${key} at t=${t.toFixed(2)}`; break; }
    }
    ok(vertical === null, `no vertical channel appears anywhere in the period (${vertical || 'none'})`);
  }

  // Breathing is a positive wobble around 1, never negative.
  for (let t = 0; t < 4; t += 0.05) {
    const pose = core.idlePose(t, 'resting', { periodSeconds: 4 });
    ok(pose.breathScale > 0.9 && pose.breathScale < 1.1, `breathScale stays near 1 at t=${t.toFixed(2)}`);
  }

  // And the HORIZONTAL micro-rotation went the same way as the vertical one (「停用idle状态下微旋转」, 2026-10-13):
  // asserted as an absence too, because a later refactor reintroducing a body that turns by itself is exactly
  // what this pair of assertions exists to catch. What is left of the procedural idle is the breathing above
  // and the chains' follow-through below.
  ok(!('yaw' in core.idlePose(1, 'resting', { periodSeconds: 4 })), 'the idle pose has no whole-body yaw');
  {
    let rotating = null;
    for (let t = 0; t < 4; t += 0.05) {
      const pose = core.idlePose(t, 'resting', { periodSeconds: 4 });
      const key = ['yaw', 'roll', 'rotation', 'turn'].find((name) => name in pose);
      if (key) { rotating = `${key} at t=${t.toFixed(2)}`; break; }
    }
    ok(rotating === null, `no rotation channel appears anywhere in the period (${rotating || 'none'})`);
  }
  // The sway amount still reaches the CHAINS, which is what it is for now (hair and tail trailing the body).
  const followHigh = core.idlePose(0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.12 }).follow(2, 0.12);
  const followLow = core.idlePose(0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.06 }).follow(2, 0.12);
  ok(Math.abs(followHigh) > Math.abs(followLow),
    "the sway setting still scales the delayed follow-through of the chains");

  // Sleeping breathes more deeply than working.
  const sleeping = core.idlePose(1, 'sleeping', { periodSeconds: 4 });
  const working = core.idlePose(1, 'working', { periodSeconds: 4 });
  ok(Math.abs(sleeping.breathScale - 1) > Math.abs(working.breathScale - 1),
    'a sleeping pet breathes more deeply than a working one');

  // Follow-through along a chain is delayed: link 0 leads, later links trail.
  const lead = core.idlePose(0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.5 }).follow(0, 0.1);
  const lag1 = core.idlePose(0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.5 }).follow(1, 0.1);
  const lag2 = core.idlePose(0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.5 }).follow(2, 0.1);
  ok(lead !== lag1 && lag1 !== lag2, 'each chain link has its own phase');
  near(lead, Math.sin((0.5 / 4) * Math.PI * 2) * 0.5, 1e-12,
    'chain link 0 is the undelayed waveform, which is what the body used to be');
  near(lead, core.idlePose(0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.5 }).follow(0, 0.4), 1e-12,
    'and the per-link delay does not move link 0: the body leads its own chains');

  // Unknown states fall back instead of producing NaN.
  const unknown = core.idlePose(1, 'nonsense', { periodSeconds: 4 });
  ok(Number.isFinite(unknown.breathScale) && Number.isFinite(unknown.follow(1, 0.1)),
    'an unknown state still yields finite motion');
}

// ---------------------------------------------------------------------------
group('10. constants are self-consistent');
// ---------------------------------------------------------------------------
{
  eq(core.STATES.length, 11, 'eleven states are declared');
  eq(new Set(core.STATES).size, core.STATES.length, 'state names are unique');
  for (const state of core.INTERACTION_STATES) {
    ok(core.STATES.includes(state), `interaction state "${state}" is a declared state`);
  }
  ok(core.MAX_DEFER_MS > core.NOTICE_WINDOW_MS, 'the deferral bound exceeds the notice window');
  ok(core.FALL_PHYSICS.bounce > 0 && core.FALL_PHYSICS.bounce < 1, 'restitution is a fraction');
  ok(core.FALL_PHYSICS.stepSeconds > 0 && core.FALL_PHYSICS.stepSeconds <= 1 / 30, 'physics sub-steps finely enough');
  /**
   * Removing the built-in avatar, and what "default" now means.
   *
   * Operator, 2026-10-10: "移除内置替身，默认模型设置为SampleModel" — and 2026-10-13, with a second bundled model in
   * hand: 「把BlueFatFish作为默认模型」. The default is the EMPTY id — automatic — and `resolveModelId` is the rule that
   * turns it into a catalogued model, with the NAME (not the scan-order id) doing the choosing, because ids drift
   * when files are added or the host restarts.
   */
  eq(core.DEFAULTS.modelId, '', 'the shipping default names no model: it resolves against the catalog');
  eq(core.BUNDLED_DEFAULT_MODEL, 'BlueFatFish.vrm',
    'the bundled default is named once, for the resolver, the picker and the documentation');
  eq(core.BUNDLED_FALLBACK_MODEL, 'SampleModel.vrm', 'and so is the bundled model it falls back to');
  const catalogFixture = [
    { id: 'm1', name: 'HatsuneMikuNT.vrm' },
    { id: 'm2', name: 'SampleModel.vrm' },
    { id: 'm3', name: 'BlueFatFish.vrm' },
  ];
  eq(core.resolveModelId(catalogFixture, ''), 'm3',
    'an empty preference resolves to the bundled default, BlueFatFish.vrm');
  eq(core.resolveModelId(catalogFixture, 'm9'), 'm3',
    'and so does an id that is no longer in the catalog — ids are positions in a scan, so they drift');
  eq(core.resolveModelId(catalogFixture, 'm1'), 'm1', 'a stored id that IS in the catalog is honoured');
  eq(core.resolveModelId([{ id: 'm1', name: 'SampleModel.vrm' }], ''), 'm1',
    'with only the other bundled model in the catalog, the fallback is what an empty preference gets');
  eq(core.resolveModelId([{ id: 'm1', name: 'nested/BlueFatFish.vrm' }], ''), 'm1',
    'and the default is matched on the FILE name, so a copy the user nested in a folder still counts');
  eq(core.resolveModelId([{ id: 'm1', name: 'a.glb' }], ''), 'm1',
    'without any VRM, the first model of any kind beats showing nothing');
  eq(core.resolveModelId([], ''), '', 'and an empty catalog resolves to nothing, which the surfaces report');
  /**
   * AND THE QUESTION THAT HAS TO BE ASKED FIRST: can the list a surface HOLDS answer for the id the store names?
   *
   * Operator, 2026-10-13: 「选中新导入的模型，都无法切换过去」. Both surfaces read the catalog once and resolved every
   * later preference against it, so a model imported while the pet was running fell through `resolveModelId`'s
   * fallback to `SampleModel.vrm` — the id already on screen, so nothing reloaded. `catalogMisses` is the honest
   * question ("my list is non-empty and does not contain this id"), and its two FALSE cases are what keep it from
   * becoming a request per settings poll: an empty list means "not known yet" (the resolver honours the request
   * anyway), and an empty preference is 自动.
   */
  eq(core.catalogMisses(catalogFixture, 'm9'), true,
    'an id the held catalog has never heard of is a MISS — the list is old, not the id invalid');
  eq(core.catalogMisses(catalogFixture, 'm2'), false, 'an id the catalog carries is not a miss');
  eq(core.catalogMisses([], 'm9'), false,
    'an EMPTY catalog is not a miss: the resolver honours the request, and a miss here would poll for ever');
  eq(core.catalogMisses(catalogFixture, ''), false, 'and 自动 is not a miss, whatever the catalog holds');
  eq(core.catalogMisses(null, 'm9'), false, 'a catalog that was never read is the same as an empty one');
  eq(core.catalogMisses([{ name: 'no-id.glb' }], 'm9'), true,
    'an entry with no id can never answer, so the comparison is on ids and nothing else');
  /**
   * AND WHICH SURFACE A LIVE REPORT IS ABOUT.
   *
   * `live: {app, window}` keeps one slot per surface, and the model picker's progress bar ends on the slot that
   * belongs to the pet the user is watching. `reportLive` used to hard-code `app`, so the floating window could
   * not report at all — and the host stamped that slot from the launcher's startup model instead, which is the
   * stale value that made the bar run to its timeout (「明明模型已经切换好了，为什么还走了这么长时间的进度条」).
   */
  {
    const livePosts = [];
    const fakeFetch = (url, init) => {
      let body = null;
      try { body = init && init.body ? JSON.parse(init.body) : null; } catch { body = null; }
      livePosts.push({ url: String(url), body });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ version: 1, preferences: {}, live: { app: null, window: null } }),
      });
    };
    const sync = core.watchHostSettings({ fetchImpl: fakeFetch });
    sync.reportLive('m2');
    eq(livePosts[livePosts.length - 1].body.live.app, 'm2',
      'reportLive names the APP surface when no surface is given');
    sync.reportLive('m2', 'window');
    eq(livePosts[livePosts.length - 1].body.live.window, 'm2',
      'and can name the WINDOW, which is a different slot for a different pet');
    eq(livePosts[livePosts.length - 1].body.live.app, undefined,
      "without writing the other surface's slot by accident");
    sync.reportLive(null, 'window');
    eq(livePosts[livePosts.length - 1].body.live.window, null,
      'and null is a real answer: this surface is showing nothing (a load that failed)');
    sync.stop();
  }
  eq(core.cleanPreferences({ modelId: 'placeholder' }).modelId, '',
    'a profile saved with the old default migrates to automatic instead of naming a removed avatar');
  eq(core.modelChoices(catalogFixture.concat([{ id: 'placeholder', name: 'Built-in' }])).length, 3,
    'and no surface offers the built-in avatar any more');
}

// ---------------------------------------------------------------------------
group('11. authored motion (VRMA; a VMD is recognised only to be refused)');
// ---------------------------------------------------------------------------
{
  // A VMD is identified by its ASCII banner and a VRMA by the extension inside
  // its GLB JSON chunk, so both detectors are exercised on real byte layouts
  // rather than on a name. The VMD half is a REFUSAL aid since 2026-10-12: this
  // build plays VRMA only, and the banner is how it says so by name.
  function glb(jsonText, extraChunk) {
    const json = Buffer.from(jsonText, 'ascii');
    const padding = (4 - (json.length % 4)) % 4;
    const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
    const tail = extraChunk ? Buffer.from(extraChunk, 'ascii') : Buffer.alloc(0);
    const total = 12 + 8 + jsonChunk.length + (tail.length ? 8 + tail.length : 0);
    const head = Buffer.alloc(20);
    head.write('glTF', 0, 'ascii');
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(total, 8);
    head.writeUInt32LE(jsonChunk.length, 12);
    head.writeUInt32LE(0x4e4f534a, 16); // bytes 'J' 'S' 'O' 'N'
    const parts = [head, jsonChunk];
    if (tail.length) {
      const chunkHead = Buffer.alloc(8);
      chunkHead.writeUInt32LE(tail.length, 0);
      chunkHead.writeUInt32LE(0x004e4942, 4); // bytes 'B' 'I' 'N' 0x00
      parts.push(chunkHead, tail);
    }
    return Buffer.concat(parts);
  }

  eq(core.MOTION_EXTENSIONS.join(','), '.vrma', 'the motion extension list is VRMA only');
  eq(core.MOTION_EXTENSIONS.indexOf('.vmd'), -1, '.vmd is not a motion this build plays');
  eq(core.isMotionFile('a.vmd'), false,
    'so isMotionFile refuses a VMD, which is exactly what needed the banner recognised');
  eq(core.isMotionFile('B.VRMA'), true, 'while a VRMA is accepted, case-insensitively');
  eq(core.isMotionFile('c.vrm'), false, 'a VRM model is not a motion file');
  eq(core.isMotionFile('d.pmx'), false, 'an MMD model is not a motion file');

  /**
   * The drag and throw poses HAVE rows of their own since 2026-10-13 (「缺少拖动时模型动作的设置」): a clip there is the
   * POSE, while where the pet IS stays the drag physics' business — the placement and the frozen `setDragMotion` lag
   * are untouched. `sleeping` and `greeting` are what still has no row, for the operator's own reason: a nap and a
   * click reaction are not things DSH is doing, so there is nothing for such a clip to be about.
   */
  for (const state of core.INTERACTION_STATES) {
    eq(core.MOTION_STATES.includes(state), true, `interaction state "${state}" carries a motion row now`);
  }
  for (const state of ['sleeping', 'greeting']) {
    eq(core.MOTION_STATES.includes(state), false,
      `"${state}" is not one of the nine configurable states`);
  }
  eq(core.STATES.length - core.MOTION_STATES.length, 2,
    'the only states a motion cannot drive are sleeping and greeting');
  eq(core.MOTION_STATES.length, core.STATUS_STATES.length + core.INTERACTION_STATES.length,
    'and the motion states are exactly the two families together, with nothing left out');
  for (const state of ['resting', 'working', 'waiting', 'done', 'error', 'offline']) {
    ok(core.MOTION_STATES.includes(state), `"${state}" can be overridden by a motion`);
  }

  const vmdBytes = Buffer.concat([Buffer.from('Vocaloid Motion Data 0002', 'ascii'), Buffer.alloc(64)]);
  eq(core.detectMotionFormat(vmdBytes), 'vmd', 'the VMD banner is still detected, so the scene can refuse it by name');
  eq(core.detectMotionFormat(Buffer.concat([Buffer.from('Vocaloid Motion', 'ascii'), Buffer.alloc(64)])), 'unknown',
    'a truncated banner is not a VMD');
  eq(core.detectMotionFormat(glb('{"extensions":{"VRMC_vrm_animation":{"specVersion":"1.0"}}}')), 'vrma',
    'a VRMA is detected by the extension in its JSON chunk');
  eq(core.detectMotionFormat(glb('{"asset":{"version":"2.0"},"extensions":{"VRMC_vrm":{}}}')), 'unknown',
    'a VRM model is not a motion, even though both are GLB');
  eq(core.detectMotionFormat(glb('{"asset":{"version":"2.0"}}')), 'unknown', 'a plain GLB model is not a motion');
  // The search is bounded to the JSON chunk on purpose: a GLB whose *binary*
  // payload happens to contain the extension name is not a VRMA.
  eq(core.detectMotionFormat(glb('{"asset":{"version":"2.0"}}', 'VRMC_vrm_animation')), 'unknown',
    'the detection stays inside the JSON chunk');
  eq(core.detectMotionFormat(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), 'unknown', 'arbitrary bytes are unknown');
  eq(core.detectMotionFormat(Buffer.alloc(2)), 'unknown', 'a buffer too short to identify is unknown');
  eq(core.detectMotionFormat(new Uint8Array(0)), 'unknown', 'an empty buffer is unknown');
  // A view into a larger buffer must read from its own offset, not the start of
  // the underlying ArrayBuffer: the host hands the scene a slice.
  const padded = Buffer.concat([Buffer.alloc(16, 0xff), vmdBytes]);
  eq(core.detectMotionFormat(new Uint8Array(padded.buffer, padded.byteOffset + 16, vmdBytes.length)), 'vmd',
    'a byte-offset view is read from its own offset');

  // `eq` compares with Object.is, which is reference equality for objects, so the
  // maps below are compared by value serialisation instead.
  function same(actual, expected, label) {
    eq(JSON.stringify(actual), JSON.stringify(expected), label);
  }

  // The list shape, and the legacy string it replaced. The string form is not a
  // courtesy: the map is PERSISTED, so every profile written before this build holds
  // `{ resting: 'a1' }`, and a cleaner that refused it would silently erase the
  // operator's whole motion configuration on the first run of the new build.
  same(core.cleanMotions({ resting: 'a', held: 'x', bogus: 'y', working: '', sleeping: 7 }),
    { resting: ['a'], held: ['x'] },
    'a legacy bare-string id is normalised to a one-entry list (and unknown/empty values dropped)');
  same(core.cleanMotions(null), {}, 'cleanMotions tolerates a missing map');
  same(core.cleanMotions({ resting: ['a2', 'a1'] }), { resting: ['a2', 'a1'] },
    'a list is kept in the order it was written, so the panel and the draw are stable');
  same(core.cleanMotions({ resting: ['a1', 'a1', 'a2', '', 7, null] }), { resting: ['a1', 'a2'] },
    'duplicates and non-ids are dropped: the same clip twice would double its chance of being drawn');
  eq(core.cleanMotions({ resting: 'z'.repeat(900) }).resting[0].length, core.MOTION_LIMITS.idLength,
    'cleanMotions caps an id length');
  eq(core.cleanMotions({ resting: Array.from({ length: 400 }, (_, i) => 'a' + i) }).resting.length,
    core.MOTION_LIMITS.maxPerState, 'cleanMotions caps how many clips one state may draw from');
  // The cap has to be big enough for a real library: a state holding sixteen clips is an ordinary state, and
  // when the cap was sixteen one more clip could not be ticked at all (operator report, 2026-10-12).
  ok(core.MOTION_LIMITS.maxPerState >= 64,
    `the per-state cap leaves room for a real clip library (${core.MOTION_LIMITS.maxPerState})`);
  eq(core.cleanMotions({ resting: Array.from({ length: 16 }, (_, i) => 'a' + i) }).resting.length, 16,
    'and sixteen clips in one state are kept in full');

  const withMotion = core.cleanPreferences({ motions: { resting: 'm1', held: 'no', sleeping: 'x' } });
  same(withMotion.motions, { resting: ['m1'], held: ['no'] },
    'cleanPreferences carries the motion map through its own filter, string form and pointer poses included');
  same(core.cleanPreferences({}).motions, {}, 'no motions configured by default');
  eq(core.cleanPreferences({ motions: { resting: 'x' } }).motions === core.cleanPreferences({}).motions, false,
    'each cleaned preference set owns its own motion map');
  same(core.DEFAULTS.motions, {}, 'the shipped default selects no authored motion');

  // The three helpers the surfaces share. They exist in core so the app panel, the
  // settings window and the host all read and write ONE shape.
  same(core.motionIdsFor({ resting: ['a1', 'a2'] }, 'resting'), ['a1', 'a2'], 'motionIdsFor reads a list');
  same(core.motionIdsFor({ resting: 'a1' }, 'resting'), ['a1'], 'motionIdsFor reads the legacy string');
  same(core.motionIdsFor({}, 'resting'), [], 'motionIdsFor answers an empty list for an unset state');
  same(core.motionIdsFor(null, 'resting'), [], 'motionIdsFor tolerates a missing map');
  same(core.motionIdsFor({ held: ['x'] }, 'held'), ['x'],
    'motionIdsFor reads a pointer pose too, now that it has rows of its own');
  same(core.motionIdsFor({ sleeping: ['x'] }, 'sleeping'), [],
    'while a state the session machine cannot reach still answers nothing');

  same(core.motionIdList({ resting: ['a3', 'a1'], working: ['a1', 'a2'] }), ['a3', 'a1', 'a2'],
    'motionIdList is every distinct id in first-seen order — the set that has to be preloaded');
  same(core.motionIdList({ resting: 'a1' }), ['a1'], 'motionIdList reads the legacy string shape too');
  same(core.motionIdList(null), [], 'motionIdList tolerates a missing map');

  const toggled = core.setMotionIds({ resting: ['a1'], done: 'a2' }, 'resting', ['a1', 'a5', 'a5']);
  same(toggled, { resting: ['a1', 'a5'], done: ['a2'] },
    'setMotionIds replaces one state and leaves the others alone (deduplicating what it is handed)');
  same(core.setMotionIds({ resting: ['a1'] }, 'resting', []), {},
    'clearing the last clip deletes the key, which is what "procedural idle" is stored as');
  same(core.setMotionIds({ resting: ['a1'] }, 'sleeping', ['a9']).resting, ['a1'],
    'a state the session machine cannot reach cannot be written');
  eq(core.setMotionIds({ resting: ['a1'] }, 'resting', ['a2']) === core.setMotionIds({ resting: ['a1'] }, 'resting', ['a2']),
    false, 'every call answers a fresh map, so a caller can never half-update a shared one');

  /**
   * The bundled pack's defaults: what a user who has configured NOTHING gets.
   *
   * The pack names clips by FILE NAME because that is what travels with it, while an id is minted per profile
   * from the absolute path. Three rules are pinned here, and each of them is a defect in its alternative:
   * an explicit choice (including a deliberate "nothing") must win, a default must resolve by name, and a
   * name that is not in the catalog must degrade to "nothing mapped" rather than to a dangling id.
   */
  const catalog = [
    { id: 'a1', name: 'idle.vrma' },
    { id: 'a2', name: 'coolIdleGlance.vrma' },
    { id: 'a9', name: 'nested/deep/other.vrma' },
  ];
  const defaults = { offline: ['idle.vrma'], resting: ['coolIdleGlance.vrma'] };
  same(core.motionMapWithDefaults({}, defaults, catalog), { resting: ['a2'], offline: ['a1'] },
    'an empty map takes the shipped defaults, resolved from clip names to catalog ids');
  same(core.motionMapWithDefaults({ working: ['a9'] }, defaults, catalog),
    { resting: ['a2'], working: ['a9'], offline: ['a1'] },
    'a state the user configured keeps their clips, and the untouched states take the defaults');
  same(core.motionMapWithDefaults({ offline: [] }, defaults, catalog), { resting: ['a2'] },
    'an explicit EMPTY choice is an answer: a default never re-adds itself to a state the user cleared');
  same(core.motionMapWithDefaults({ offline: 'a7' }, { offline: ['idle.vrma'] }, catalog), { offline: ['a7'] },
    'a legacy bare-string choice counts as explicit too, so it is not replaced by the default');
  same(core.motionMapWithDefaults({}, {}, catalog), {}, 'no defaults means the stored map is the answer');
  same(core.motionMapWithDefaults({}, { held: ['idle.vrma'] }, catalog), { held: ['a1'] },
    'a default naming a POINTER POSE lands, because those states carry rows since 2026-10-13');
  same(core.motionMapWithDefaults({}, { sleeping: ['idle.vrma'] }, catalog), {},
    'while one naming a state the session machine cannot reach is dropped, exactly as a stored one is');
  same(core.motionMapWithDefaults({}, { resting: ['not-in-the-catalog.vrma'] }, catalog), {},
    'a default whose clip is not in the catalog maps nothing rather than pointing at a dangling id');
  same(core.motionMapWithDefaults({}, { resting: ['nested\\deep\\other.vrma'] }, catalog), { resting: ['a9'] },
    'a default written with backslashes resolves against the catalog name, which is always forward-slashed');
  same(core.motionMapWithDefaults({}, defaults, []), {},
    'with no catalog nothing resolves, so the pet idles procedurally instead of guessing');
  same(core.motionMapWithDefaults({}, { resting: 'coolIdleGlance.vrma' }, catalog), { resting: ['a2'] },
    'a bare-string default is accepted, so a hand-written manifest needs no array for one clip');
  same(core.motionMapWithDefaults({ resting: ['a1'] }, defaults, catalog).resting, ['a1'],
    'the default for a state is not APPENDED to the user\'s list');
  const once = core.motionMapWithDefaults({}, defaults, catalog);
  ok(once !== core.motionMapWithDefaults({}, defaults, catalog),
    'every call answers a fresh map, so a caller cannot half-update a shared one');

  // Per-clip play mode: the directory's manifest declares it, the preference overrides it, and an absent
  // override means "ask the catalog" rather than "loop".
  same(core.cleanMotionLoop({ a1: true, a2: false, a3: 'yes', '': true }), { a1: true, a2: false },
    'cleanMotionLoop keeps boolean overrides for named clips, and drops anything else');
  eq(core.motionLoopFor(core.cleanPreferences({ motionLoop: { a2: true } }), 'a2', false), true,
    'a preference override beats the catalog: a declared one-shot can be forced back to looping');
  eq(core.motionLoopFor(core.cleanPreferences({}), 'a2', false), false,
    'with no override the catalog decides, so a declared one-shot stays a one-shot');
  eq(core.motionLoopFor(core.cleanPreferences({ motionLoop: { a2: true } }), 'a9', false), false,
    'an override for one clip never leaks to another');
  eq(core.motionLoopFor(core.cleanPreferences({}), 'a9', undefined), true,
    'and a clip the catalog says nothing about loops, which is the shipped behaviour');
  same(core.setMotionLoop(core.cleanPreferences({ motionLoop: { a1: true } }), 'a2', false),
    { a1: true, a2: false }, 'setMotionLoop adds one entry and keeps the rest');
  same(core.setMotionLoop(core.cleanPreferences({ motionLoop: { a1: true, a2: false } }), 'a2', null), { a1: true },
    'setting null removes the override, which is what "follow the file" means');

  // Per-state one-shot interval: a random window in seconds, and 0 means off.
  same(core.cleanMotionEvery({ resting: { min: 20, max: 80 }, bogus: { min: 1, max: 2 }, held: { min: 1, max: 2 } }),
    { resting: { min: 20, max: 80 }, held: { min: 1, max: 2 } },
    'cleanMotionEvery keeps the states a session can reach — the pointer poses included, since they have rows now');
  same(core.cleanMotionEvery({ resting: { min: 80, max: 20 } }), { resting: { min: 20, max: 80 } },
    'an inverted window is ordered rather than dropped');
  same(core.cleanMotionEvery({ resting: { min: 5, max: 0 }, working: { min: 0, max: 0 } }), {},
    'a window whose max is 0 is OFF: it carries no entry at all');
  same(core.cleanMotionEvery({ resting: { min: -10, max: 99999 } }),
    { resting: { min: 0, max: core.MOTION_EVERY_LIMITS.maxSeconds } }, 'a window is clamped to sane seconds');
  same(core.motionEveryFor(core.cleanPreferences({ motionEvery: { resting: { min: 20, max: 80 } } }), 'resting'),
    { min: 20, max: 80 }, 'motionEveryFor reads one state window through the cleaner');
  /**
   * The SHIPPED interval (operator, 2026-10-13: 「以当前通用设置中的参数为默认」 — 静息态 20–60 s).
   *
   * Absent and empty are different answers, and this is the pair that says so: a profile that has never STORED a
   * `motionEvery` key starts on the shipped resting window, while one whose map is EMPTY — every interval was turned
   * off — keeps its own answer, because re-seeding it would make "off" unrepresentable. `parts.items` follows the
   * same `undefined`-vs-`[]` rule.
   */
  same(core.motionEveryFor(core.cleanPreferences({}), 'resting'), core.DEFAULTS.motionEvery.resting,
    'a profile that never stored an interval starts on the shipped resting window');
  eq(core.motionEveryFor(core.cleanPreferences({}), 'resting').min, 20, 'which starts at twenty seconds');
  eq(core.motionEveryFor(core.cleanPreferences({}), 'resting').max, 60, 'and is drawn up to sixty');
  eq(core.motionEveryFor(core.cleanPreferences({ motionEvery: {} }), 'resting'), null,
    'while an EMPTY stored map — the interval is off — is a real answer, not a licence to re-seed it');
  eq(core.cleanPreferences({}).motionEvery === core.cleanPreferences({}).motionEvery, false,
    'and every call answers a fresh map, so one pet\'s interval cannot leak into another\'s');
  eq(core.motionEveryFor(core.cleanPreferences({ motionEvery: { resting: { min: 1, max: 2 } } }), 'sleeping'), null,
    'a state the session machine cannot reach has no window, whatever the stored blob says');
  same(core.setMotionEvery(core.cleanPreferences({ motionEvery: { resting: { min: 20, max: 80 } } }), 'working', { min: 5, max: 10 }),
    { resting: { min: 20, max: 80 }, working: { min: 5, max: 10 } }, 'setMotionEvery adds a state and keeps the others');
  same(core.setMotionEvery(core.cleanPreferences({ motionEvery: { resting: { min: 20, max: 80 } } }), 'resting', null), {},
    'clearing one state leaves no entry behind');

  // Per state, per clip: the play mode, the expression and the mouth that clip uses IN that state.
  same(core.cleanMotionClips({
    resting: { a1: { loop: false, expression: 'Joy', mouth: 'A' }, a2: { loop: 'yes' } },
    held: { a1: { loop: true } },
    sleeping: { a1: { loop: true } },
    working: { a3: { expression: '' } },
  }), { resting: { a1: { loop: false, expression: 'Joy', mouth: 'A' } }, held: { a1: { loop: true } } },
  'cleanMotionClips keeps a reachable state (pointer poses included), boolean modes and named faces, and drops the rest');
  same(core.cleanMotionClips({ resting: { a1: { loop: false, expression: 'Joy' } } }), { resting: { a1: { loop: false, expression: 'Joy' } } },
    'a plain entry survives unchanged');
  same(core.motionClipFor(core.cleanPreferences({ motionClips: { resting: { a1: { mouth: 'A' } } } }), 'resting', 'a1'),
    { mouth: 'A' }, 'motionClipFor reads one state-and-clip entry');
  eq(core.motionClipFor(core.cleanPreferences({}), 'resting', 'a1'), null, 'and answers null when there is none');
  eq(core.motionClipFor(core.cleanPreferences({ motionClips: { resting: { a1: { loop: true } } } }), 'sleeping', 'a1'), null,
    'a state the session machine cannot reach has no per-clip entry');

  // The three layers of the play mode, most specific first. This is the operator's "每个状态下，可以针对每个动作
  // 设置该状态下该动作为循环还是单次" (2026-10-09).
  const layered = core.cleanPreferences({
    motionLoop: { a1: true },
    motionClips: { resting: { a1: { loop: false } }, done: { a1: { mouth: 'A' } } },
  });
  eq(core.motionLoopForState(layered, 'resting', 'a1', true), false,
    'the state\'s own entry beats the per-clip override: a clip can be a one-shot in one state only');
  eq(core.motionLoopForState(layered, 'done', 'a1', false), true,
    'a state entry that says nothing about the mode falls through to the per-clip override');
  eq(core.motionLoopForState(core.cleanPreferences({}), 'resting', 'a1', false), false,
    'and with neither, the catalog\'s declaration stands');

  const written = core.setMotionClip(core.cleanPreferences({}), 'resting', 'a1', 'expression', 'Joy');
  same(written, { resting: { a1: { expression: 'Joy' } } }, 'setMotionClip writes one field of one pair');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: written }), 'resting', 'a1', 'mouth', 'A'),
    { resting: { a1: { expression: 'Joy', mouth: 'A' } } }, 'and keeps the field that was already decided');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: written }), 'resting', 'a1', 'expression', null), {},
    'clearing the last field drops the entry, so "no decision" and "an empty decision" are the same thing');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: { resting: { a1: { loop: true } } } }), 'sleeping', 'a1', 'loop', true),
    { resting: { a1: { loop: true } } }, 'a state the session machine cannot reach cannot be written');
  same(core.setMotionClip(core.cleanPreferences({}), 'held', 'a1', 'loop', true),
    { held: { a1: { loop: true } } },
    'and a pointer pose IS written now: per-clip 循环/单次 works during a drag, which is the point of the row');

  /**
   * The per-clip 凝视 switch, and the idle rule's setting. Both are the operator's 2026-10-09 late requests:
   * "给每个状态下每个动作加上鼠标凝视的开关" and "如果鼠标连续5秒没有移动，就停止鼠标凝视" — with the second one
   * also being "作为一个选项写到设置里面方便调试".
   */
  same(core.setMotionClip(core.cleanPreferences({}), 'resting', 'a1', 'gaze', false),
    { resting: { a1: { gaze: false } } }, 'the per-clip gaze switch is stored as a refusal');
  eq(core.motionGazeFor(core.cleanPreferences({ motionClips: { resting: { a1: { gaze: false } } } }), 'resting', 'a1'), false,
    'and that refusal reaches the renderer');
  eq(core.motionGazeFor(core.cleanPreferences({}), 'resting', 'a1'), true,
    'while a clip nobody has touched follows the pointer, exactly as it did before the switch existed');
  eq(core.motionGazeFor(core.cleanPreferences({ motionClips: { resting: { a1: { gaze: false } } } }), 'done', 'a1'), true,
    'and the refusal is per STATE: the same clip can still look at the cursor in another state');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: { resting: { a1: { gaze: false, mouth: 'A' } } } }), 'resting', 'a1', 'gaze', null),
    { resting: { a1: { mouth: 'A' } } }, 'clearing the switch drops only the switch');
  same(core.cleanMotionClips({ resting: { a1: { gaze: true } } }), { resting: { a1: { gaze: true } } },
    'a stored "gaze: true" is KEPT now: the pack template can refuse for a clip, and taking that back has to be storable');
  eq(core.motionGazeFor(core.cleanPreferences({ motionClips: { resting: { a1: { gaze: true } } } }), 'resting', 'a1'), true,
    'and it reaches the renderer as a permission, over a template that refuses');

  /**
   * THE PACK'S 状态与动作 TEMPLATE (operator, 2026-10-14: 「现在的本机上的状态与动作里面的内容，包括每个动作的表情状态，全部作为默认模板上传」).
   *
   * Written by FILE NAME in the manifest, translated here against the live catalog, and merged FIELD BY FIELD
   * under the profile's own entry. The two halves that matter most are the ones a naive implementation gets wrong:
   * a profile that decided ONE thing about a clip keeps the template's other fields, and 「跟随情绪」 has to remain
   * expressible against a template that names a face — which is what `MOTION_FACE_FOLLOW` is for.
   */
  const templateCatalog = [
    { id: 'a1', name: 'idle/one.vrma' },
    { id: 'a2', name: 'idle/two.vrma' },
  ];
  const declaredTemplate = core.motionClipTemplate({
    resting: {
      'idle/one.vrma': { loop: false, expression: 'none', gaze: false },
      'idle/two.vrma': { expression: 'happy' },
      'idle/missing.vrma': { expression: 'sad' },
      'idle\\three.vrma': { loop: true },
    },
    nowhere: { 'idle/one.vrma': { loop: true } },
    done: { 'idle/one.vrma': 'not an object' },
  }, templateCatalog);
  same(declaredTemplate, {
    resting: { a1: { loop: false, expression: 'none', gaze: false }, a2: { expression: 'happy' } },
  }, 'the template is translated to ids by NAME, drops clips this profile does not have, and ignores unreachable states');

  const withTemplate = core.cleanPreferences({});
  eq(core.motionClipFor(withTemplate, 'resting', 'a1', declaredTemplate).expression, 'none',
    'a profile that has configured nothing reads the template');
  eq(core.motionLoopForState(withTemplate, 'resting', 'a1', true, declaredTemplate), false,
    'including the play mode, which the template sits above the catalog for and below the profile');
  eq(core.motionGazeFor(withTemplate, 'resting', 'a1', declaredTemplate), false,
    'and the gaze refusal');
  same(core.motionClipFor(core.cleanPreferences({ motionClips: { resting: { a1: { loop: true } } } }), 'resting', 'a1', declaredTemplate),
    { loop: true, expression: 'none', gaze: false },
    'and a profile that decided ONE field keeps the template\'s other fields');
  same(core.motionClipFor(core.cleanPreferences({ motionClips: { resting: { a1: { expression: 'follow' } } } }), 'resting', 'a1', declaredTemplate),
    { loop: false, expression: 'follow', gaze: false },
    'while 「跟随情绪」 is storable as the sentinel, which is what lets a template\'s face be taken back');
  same(core.motionClipFor(withTemplate, 'done', 'a1', declaredTemplate), null,
    'a state the template says nothing about falls through to no entry at all');
  same(core.motionClipTemplate({ resting: { 'idle/one.vrma': { speech: 'hi', prompt: 'x', mouth: 'A' } } }, templateCatalog),
    { resting: { a1: { mouth: 'A' } } },
    'and per-clip 碎碎念/提示词 do NOT travel in the template: they are the user\'s words, and one could not be taken back');

  /**
   * The two TEXTS a clip owns in a state (operator, 2026-10-13: 「允许给每个动作单独定义碎碎念，和AI碎碎念提示词」).
   *
   * They ride on the SAME entry the expression and the gaze switch ride on, and they are validated by the same
   * rule as every other line the pet says: one line, trimmed, capped, and DROPPED when empty. The last part is
   * what the resolution below depends on — "the clip has a line" is `motionSpeechFor` answering a string, so an
   * emptied box has to leave no field at all rather than store `''`.
   */
  same(core.cleanMotionClips({ resting: { a1: { speech: '  摸摸头  ', prompt: ' 说得得意一点 ' } } }),
    { resting: { a1: { speech: '摸摸头', prompt: '说得得意一点' } } },
    'cleanMotionClips keeps a per-clip 碎碎念 and AI 提示词, trimmed');
  same(core.cleanMotionClips({ resting: { a1: { speech: '上\n下', prompt: 'a\tb' } } }),
    { resting: { a1: { speech: '上 下', prompt: 'a b' } } },
    'and every line the pet says is ONE line: newlines and tabs become spaces in both');
  same(core.cleanMotionClips({ resting: { a1: { speech: '', prompt: '   ' } } }), {},
    'an emptied box is DROPPED, never stored as an empty line that would win over the pool');
  eq(core.cleanMotionClips({ resting: { a1: { speech: 'x'.repeat(80) } } }).resting.a1.speech.length,
    core.SPEECH_LIMITS.lineLength, 'a long 碎碎念 is cut to the same length as every other spoken line');
  eq(core.cleanMotionClips({ resting: { a1: { prompt: 'x'.repeat(400) } } }).resting.a1.prompt.length,
    core.MOTION_LIMITS.promptLength, 'and a long 提示词 to the per-clip cap');
  eq(core.MOTION_LIMITS.promptLength, 200, 'which ships as the documented two hundred characters');
  same(core.cleanMotionClips({ resting: { a1: { speech: 5, prompt: ['no'] } } }), {},
    'a text field that is not a string is refused rather than coerced');

  // The WRITE path keeps a text the dropdowns know nothing about, and clears it like any other field.
  same(core.setMotionClip(core.cleanPreferences({}), 'resting', 'a1', 'speech', '这样一句'),
    { resting: { a1: { speech: '这样一句' } } }, 'setMotionClip writes a per-clip 碎碎念');
  same(core.setMotionClip(core.cleanPreferences({}), 'resting', 'a1', 'prompt', '得意一点'),
    { resting: { a1: { prompt: '得意一点' } } }, 'and a per-clip AI 提示词');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: { resting: { a1: { loop: false, speech: '留着' } } } }),
    'resting', 'a1', 'prompt', '加上'), { resting: { a1: { loop: false, speech: '留着', prompt: '加上' } } },
  'and neither write disturbs the mode or the other text already stored');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: { resting: { a1: { speech: '去掉', mouth: 'A' } } } }),
    'resting', 'a1', 'speech', null), { resting: { a1: { mouth: 'A' } } },
  'clearing a 碎碎念 drops that field and keeps the entry (the mouth is still decided)');
  same(core.setMotionClip(core.cleanPreferences({ motionClips: { resting: { a1: { speech: '最后一个' } } } }),
    'resting', 'a1', 'speech', null), {},
  'and clearing the LAST field drops the entry, so "no per-clip text" is one state of the map, not two');

  // Resolution: the pair is (the state it plays in, the clip that is playing), read like the face and the gaze.
  const textPrefs = core.cleanPreferences({
    motionClips: { resting: { a1: { speech: '静息的一句', prompt: '静息的提示' }, a2: { loop: true } } },
  });
  eq(core.motionSpeechFor(textPrefs, 'resting', 'a1'), '静息的一句', 'motionSpeechFor reads the playing clip\'s line');
  eq(core.motionPromptFor(textPrefs, 'resting', 'a1'), '静息的提示', 'and motionPromptFor its AI 提示词');
  eq(core.motionSpeechFor(textPrefs, 'resting', 'a2'), null,
    'a clip with no line of its own answers null — which is what makes the state\'s pool stand');
  eq(core.motionSpeechFor(textPrefs, 'working', 'a1'), null,
    'and the line is per STATE: the same clip in another state has none, exactly like the expression');
  eq(core.motionPromptFor(core.cleanPreferences({}), 'resting', 'a1'), null,
    'a profile that has never used the feature answers null on both, so nothing changes for it');

  // Operator, 2026-10-13: 「静止停看默认为2秒」.
  eq(core.DEFAULTS.gazeIdleSeconds, 2, 'the idle rule starts at the two seconds the operator asked for');
  eq(core.cleanPreferences({}).gazeIdleSeconds, 2, 'and a profile that says nothing keeps it');
  eq(core.cleanPreferences({ gazeIdleSeconds: 0 }).gazeIdleSeconds, 0,
    'zero is a VALUE, not a missing one: it turns the rule off for debugging');
  eq(core.cleanPreferences({ gazeIdleSeconds: -4 }).gazeIdleSeconds, 0, 'a negative number lands on zero');
  eq(core.cleanPreferences({ gazeIdleSeconds: 9999 }).gazeIdleSeconds, core.GAZE_LIMITS.idleSecondsMax,
    'and a huge one is clamped to the control\'s own maximum');
  eq(core.cleanPreferences({ gazeIdleSeconds: 'nonsense' }).gazeIdleSeconds, 2,
    'while something unparseable falls back to the default rather than to "never"');
  // The one-second buffer the operator asked for after seeing the snap: "凝视暂停和重新开始要让人物在1秒缓冲时间内
  // 均匀转头回归或者凝视鼠标，不然动画看上去很诡异". A number in core rather than a literal in the renderer, so a suite
  // can set it to 0 and measure the mechanism without the ramp.
  eq(core.GAZE_LIMITS.blendSeconds, 1, 'the gaze ramps in and out over one second');

  /**
   * The cursor's draught: how a sweep across the pet becomes a direction for the spring chains.
   *
   * Operator, 2026-10-10: "增加鼠标在模型上划过时，可以随着鼠标划过的方向摆动弹簧骨结构的功能". The mapping is a
   * pure function precisely so it can be pinned here, without a model: the direction must follow what the user
   * SAW (so the view orbit is undone), the strength must scale with SPEED (so a resting cursor blows nothing),
   * and screen-down must stay down.
   */
  const rightSweep = core.windFromPointer({ dx: 200, dy: 0, dt: 0.1, viewYaw: 0 });
  eq(rightSweep.x, 1, 'a sweep to the right blows the hair to the model\'s +x');
  eq(rightSweep.y, 0, 'with nothing vertical in it');
  eq(Math.round(rightSweep.z * 1e6) / 1e6, 0, 'and nothing out of the screen when the camera is square on');
  ok(Math.abs(rightSweep.power - 1) < 1e-9, 'a 2000 px/s sweep is full strength');
  const downSweep = core.windFromPointer({ dx: 0, dy: 120, dt: 0.1, viewYaw: 0 });
  eq(downSweep.y, -1, 'a sweep DOWN pushes the chains down, which is -y in three');
  eq(downSweep.power, 1200 / core.WIND_LIMITS.speedForMax, 'and the strength is the speed over the full-speed mark');
  const orbited = core.windFromPointer({ dx: 200, dy: 0, dt: 0.1, viewYaw: Math.PI / 2 });
  ok(Math.abs(orbited.x) < 1e-9 && Math.abs(orbited.z - 1) < 1e-9,
    'the same sweep with the camera turned 90° blows along the model\'s z: the user watched it go sideways');
  const resting = core.windFromPointer({ dx: 0, dy: 0, dt: 0.1, viewYaw: 0 });
  eq(resting.power, 0, 'a cursor that is not moving blows nothing at all');
  eq(core.windFromPointer({ dx: 50, dy: 50, dt: 0 }).power, 0, 'and neither does a sample with no time in it');
  ok(core.windFromPointer({ dx: 99999, dy: 0, dt: 0.01 }).power === 1,
    'while an absurdly fast swipe is clamped rather than tearing the chains off');

  /**
   * And how strong it is, and how LOCAL.
   *
   * Two follow-ups from the operator: "强度太大了，降低80%" (2026-10-10) and then, having lived with the result,
   * 「划过强度默认设置为1；作用范围默认设置为10%」 (2026-10-13) — the shipped strength is that 1, and `windFalloff`
   * is what decides how much of the draught a joint gets for being a given distance from the cursor.
   */
  eq(core.WIND_LIMITS.power, 1, 'the shipped draught is the strength the operator settled on');
  eq(core.WIND_LIMITS.power, core.DEFAULTS.windPower, 'and it is the same number a fresh profile gets');
  eq(core.windFalloff(0, 100), 1, 'a joint under the cursor gets the whole draught');
  eq(core.windFalloff(100, 100), 0, 'one at the edge of the reach gets none of it');
  eq(core.windFalloff(180, 100), 0, 'and one beyond the reach is not "blown a little", it is untouched');
  const half = core.windFalloff(50, 100);
  ok(half > 0 && half < 1, `and halfway out it is between the two (${half.toFixed(3)})`);
  ok(core.windFalloff(20, 100) > core.windFalloff(70, 100), 'falling off with distance, never rising');
  eq(core.windFalloff(10, 0), 0, 'a reach of nothing reaches nothing rather than dividing by zero');
  ok(core.WIND_LIMITS.radiusFraction > 0 && core.WIND_LIMITS.radiusFraction <= 1,
    'the reach is a fraction of the model as drawn, so it scales with the zoom');

  /**
   * The four draught numbers as SETTINGS.
   *
   * Operator, 2026-10-10: "把鼠标互动的参数加入设置面板" — after two rounds of tuning by conversation, which is the
   * lesson worth encoding: these are feel values, so they belong where the person feeling them can move them.
   */
  const windDefaults = core.cleanPreferences({});
  eq(windDefaults.windPower, core.DEFAULTS.windPower, 'a profile that says nothing keeps the tuned strength');
  // Operator, 2026-10-13: 「划过强度默认设置为1；作用范围默认设置为10%」 — and then the reach and the speed he is
  // actually running, when he made his own 通用设置 the shipped defaults (「以当前通用设置中的参数为默认」: 15 % and
  // 2000 px/s). Pinned as LITERALS for the same reason the speech window above is: a default that is only compared
  // with itself moves in the panel, in the docs and here at once, consistently.
  eq(windDefaults.windPower, 1, 'which is the strength the operator settled on');
  eq(windDefaults.windRadius, 0.15, 'and its reach');
  eq(windDefaults.windSpeedForMax, 2000, 'and the cursor speed at which the draught is at full power');
  eq(core.cleanPreferences({ windPower: 0 }).windPower, 0,
    'ZERO is a value: it turns the draught off without disturbing the other three numbers');
  eq(core.cleanPreferences({ windRadius: 0 }).windRadius, 0,
    'and a reach of zero means GLOBAL, which the control offers so the two shapes can be compared by feel');
  eq(core.cleanPreferences({ windPower: 99 }).windPower, core.WIND_RANGES.power.max,
    'an absurd strength is clamped to the range the slider offers');
  eq(core.cleanPreferences({ windSpeedForMax: 1 }).windSpeedForMax, core.WIND_RANGES.speedForMax.min,
    'and so is a speed that would make every twitch a gale');
  eq(core.cleanPreferences({ windDecay: -1 }).windDecay, core.WIND_RANGES.decay.min,
    'a negative time constant lands on the smallest positive one');
  eq(core.cleanPreferences({ windDecay: 'nonsense' }).windDecay, core.DEFAULTS.windDecay,
    'while something unparseable falls back to the default rather than to zero');
  ok(Object.keys(core.WIND_RANGES).length === 4
    && core.DEFAULTS.windPower === core.WIND_LIMITS.power
    && core.DEFAULTS.windRadius === core.WIND_LIMITS.radiusFraction
    && core.DEFAULTS.windDecay === core.WIND_LIMITS.decaySeconds
    && core.DEFAULTS.windSpeedForMax === core.WIND_LIMITS.speedForMax,
    'the four ranges exist, and every shipped default is the constant the renderer falls back to');

  /**
   * The transient preview the settings window drives.
   *
   * `null` is the CLEAR signal and also the normal state, which is why an instruction with nothing in it
   * cannot be represented: "show nothing" and "show a blank thing" would otherwise be different values.
   */
  same(core.cleanPreview({ state: 'resting', motionId: 'a1', expression: 'Joy', mouth: 'A' }),
    { state: 'resting', motionId: 'a1', expression: 'Joy', mouth: 'A' }, 'cleanPreview keeps an instruction');
  eq(core.cleanPreview({}), null, 'an empty instruction is a CLEAR, not an entry');
  eq(core.cleanPreview(null), null, 'and so is nothing at all');
  same(core.cleanPreview({ state: 'sleeping', motionId: 'a1' }), { motionId: 'a1' },
    'a state the session machine cannot reach is dropped, and the rest of the instruction survives');
  same(core.cleanPreview({ state: 'held', motionId: 'a1' }), { state: 'held', motionId: 'a1' },
    'while a pointer pose is a real preview target now, so a clip can be looked at during a drag');
}

// ---------------------------------------------------------------------------
group('11b. the spring chain identity, in both halves');
// ---------------------------------------------------------------------------
{
  /**
   * An unnamed chain is the normal case in VRM 0.x: the name is a free-text `comment` that most exporters
   * leave empty, and an empty key could neither be stored (`cleanSprings` drops it) nor looked up
   * (`springOverrideFor` refuses it). The operator's "设置面板中存在大量无法修改的未命名链" was exactly that,
   * made worse by the renderer inventing a different fallback name of its own (2026-10-09).
   */
  eq(core.springChainKey({ name: 'LiuHai.L' }, 3), 'LiuHai.L', 'a named chain keeps its name as the key');
  eq(core.springChainKey({ comment: 'Skirt' }, 0), 'Skirt', 'and a VRM 0.x comment counts as a name');
  eq(core.springChainKey({ name: '', kind: 'vrm0' }, 7), 'hair7',
    'an unnamed VRM 0.x chain falls back to the index the renderer also uses');
  eq(core.springChainKey({ kind: 'vrm1' }, 2), 'spring2', 'and an unnamed VRM 1.0 spring does the same');
  eq(core.springChainKey({ name: '' }, 0), 'hair0', 'with no kind, the VRM 0.x fallback is used');
  eq(core.springChainKey(null, -5), 'hair0', 'a missing chain and a negative index are tolerated');
  eq(core.springChainKey({ name: 'x'.repeat(300) }, 0).length, core.SPRING_LIMITS.keyLength,
    'and a silly name is truncated rather than stored whole');
  ok(core.springChainKey({ name: '' }, 1) !== core.springChainKey({ name: '' }, 2),
    'two unnamed chains get DIFFERENT keys — the bug was that they shared the empty string');

  // A key is what makes an override storable at all: this pairs the identity with the store it feeds.
  const prefs = core.cleanPreferences({});
  const key = core.springChainKey({ name: '' }, 4);
  core.setSpringOverride(prefs, 'm2', key, 'stiffness', 1.5);
  same(prefs.springs, { m2: { hair4: { stiffness: 1.5 } } },
    'an unnamed chain\'s override is stored under its key instead of being dropped');
}

// ---------------------------------------------------------------------------
group('12. the VRM relaxed stand (aimDownQuaternion)');
// ---------------------------------------------------------------------------
{
  // A VRM's rest pose is a T-pose, so the procedural idle has to bring the arms
  // down. The rotation is derived from the rig instead of hardcoded (models disagree
  // about bone roll, and VRM 0.x/1.0 disagree about which way a bone points), which
  // makes this the cheap half of that fix: pure vector maths, no browser.
  const down = [0, -1, 0];

  // A left arm pointing straight out along +X: 90° from down, clamped to the limit.
  const left = core.aimDownQuaternion([1, 0, 0], down, 1.31);
  ok(left !== null, 'an arm pointing sideways has a rotation');
  near(left.angle, 1.31, 1e-6, 'the rotation is clamped to the limit rather than snapping vertical');
  near(Math.abs(left.axis[2]), 1, 1e-6, 'the rotation happens about the axis perpendicular to arm and down');
  near(left.axis[0], 0, 1e-6, 'the axis has no component along the arm');

  // The mirrored arm gets the mirrored axis, so both arms come down, and the maths
  // needs no per-side sign table to achieve that.
  const right = core.aimDownQuaternion([-1, 0, 0], down, 1.31);
  near(right.angle, left.angle, 1e-6, 'the mirrored arm gets the same angle');
  near(right.axis[2], -left.axis[2], 1e-6, 'the mirrored arm gets the opposite axis');

  // An arm already hanging barely moves: this is a clamp, not a fixed pose, so a
  // model whose rest pose is an A-pose is not dragged further than it should be.
  const hanging = core.aimDownQuaternion([0.1, -0.99, 0], down, 1.31);
  ok(hanging !== null && hanging.angle < 0.2, `an almost-hanging arm barely rotates (${hanging && hanging.angle})`);

  // Nothing to do, and nothing to divide by.
  eq(core.aimDownQuaternion([0, -1, 0], down, 1.31), null, 'an arm already pointing down is left alone');
  eq(core.aimDownQuaternion([0, 0, 0], down, 1.31), null, 'a zero-length arm axis is refused');
  eq(core.aimDownQuaternion([1, 0, 0], [0, 0, 0], 1.31), null, 'a zero-length target is refused');
  eq(core.aimDownQuaternion([1, 0, 0], down, 0), null, 'a zero limit is refused');
  eq(core.aimDownQuaternion([1, 0, 0], down, NaN), null, 'a non-finite limit is refused');
  eq(core.aimDownQuaternion(null, down, 1.31), null, 'a missing limb axis is refused');

  // Exactly antiparallel: acos gives a half turn and the cross product vanishes, so
  // the perpendicular has to be chosen rather than computed into NaN.
  const flipped = core.aimDownQuaternion([0, 1, 0], down, 1.31);
  ok(flipped !== null && Number.isFinite(flipped.angle), 'an antiparallel arm still gets a finite rotation');
  near(flipped.angle, 1.31, 1e-6, 'the antiparallel case is clamped like any other');
  ok(Math.abs(Math.hypot(flipped.axis[0], flipped.axis[1], flipped.axis[2]) - 1) < 1e-6,
    'the chosen perpendicular is a unit vector');

  // Inputs are read, never modified: the caller passes its live bone vectors.
  const limb = [3, 4, 0];
  core.aimDownQuaternion(limb, down, 1.31);
  eq(limb.join(','), '3,4,0', 'the limb axis is not modified in place');
  eq(core.aimDownQuaternion([0, 2, 0], [0, -4, 0], 1.31).angle, 1.31, 'non-unit inputs are normalised, not rescaled');
  // The returned axis is ALWAYS a unit vector, whatever the limb's angle.
  //
  // The cross product's length is sin(angle), so it is unit only when the limb is
  // exactly perpendicular to `down`; returning it raw handed the caller an axis
  // scaled by sin(angle). The caller builds a quaternion from it and three.js's
  // `setFromAxisAngle` does not normalise, so the pet's arm stance came out
  // |q| = 0.999599 -- measured on SampleModel.vrm (arm 87.3342 degrees from
  // perpendicular, sin = 0.9989177966483648) on 2026-10-12. Nothing visible broke,
  // but every test that compared two of those quaternions with THREE's `angleTo`
  // read the length difference as a 4.59 degree pose residual.
  const tilt = Math.asin(0.9989177966483648);
  const oblique = core.aimDownQuaternion([Math.cos(tilt), 0, Math.sin(tilt)], down, 1.31);
  ok(oblique !== null, 'a nearly-perpendicular arm still has a rotation');
  const obliqueLength = Math.hypot(oblique.axis[0], oblique.axis[1], oblique.axis[2]);
  near(obliqueLength, 1, 1e-12, 'the axis is unit even though the cross product is not (|axis| was 0.998918)');
  near(Math.abs(oblique.axis[0]), 0.9989177966483648, 1e-12, 'the axis still points the same way, only scaled');
  const shelf = core.aimDownQuaternion([0.6, 0.3, 0.74], down, 1.31);
  near(Math.hypot(shelf.axis[0], shelf.axis[1], shelf.axis[2]), 1, 1e-12,
    'an arbitrary limb angle also gets a unit axis');

}

// ---------------------------------------------------------------------------
group('13. pointer aim (which way the pet looks)');
// ---------------------------------------------------------------------------
{
  // Reported: "the view follows the mouse until the cursor leaves the pet's frame, then
  // it stops". The cause was the units — the aim was measured against the canvas
  // half-size and dropped entirely past 1.6 of them — so what is asserted here is that
  // the aim is measured against the PET's centre and saturates instead of vanishing.
  const centre = { centreX: 1000, centreY: 600 };

  const atCentre = core.pointerAim(Object.assign({ pointerX: 1000, pointerY: 600 }, centre));
  eq(atCentre.x, 0, 'a pointer on the pet aims straight ahead horizontally');
  eq(atCentre.y, 0, 'and vertically');

  const right = core.pointerAim(Object.assign({ pointerX: 1200, pointerY: 500 }, centre));
  ok(right.x > 0, 'a pointer to the right aims right');
  ok(right.y < 0, 'a pointer above aims up, i.e. in screen-negative y');
  near(right.x, core.gazeCurve(200 / core.GAZE_SPAN.x), 1e-9,
    'the horizontal aim is the offset over the span, through the response curve');
  near(right.y, -core.gazeCurve(100 / core.GAZE_SPAN.y), 1e-9, 'the vertical aim uses its own span');

  // The response curve is the user's "近处快、远处慢" request. These are the properties that make it that
  // rather than a differently-scaled straight line: it starts and ends at the corners (so the span keeps
  // its meaning) and its slope FALLS from the centre to the edge.
  near(core.gazeCurve(0), 0, 1e-12, 'the curve leaves the centre at zero');
  near(core.gazeCurve(1), 1, 1e-12, 'and reaches full deflection exactly at one span');
  const slopeNear = (core.gazeCurve(0.05) - core.gazeCurve(0)) / 0.05;
  const slopeFar = (core.gazeCurve(1) - core.gazeCurve(0.95)) / 0.05;
  ok(slopeNear > slopeFar * 3,
    `the slope falls from the centre to the edge (${slopeNear.toFixed(2)} -> ${slopeFar.toFixed(2)})`);
  ok(core.gazeCurve(0.1) > 0.2,
    `a tenth of the span already buys a fifth of the turn (${core.gazeCurve(0.1).toFixed(3)})`);
  // With the operator's shallower default slope (0.1 since 2026-10-13) the same half-span buys more turn.
  ok(core.gazeCurve(0.5) > 0.85 && core.gazeCurve(0.5) < 0.95,
    `half the span buys most of the turn at the shipped slope (${core.gazeCurve(0.5).toFixed(3)})`);
  ok(core.gazeCurve(0.3) < core.gazeCurve(0.6) && core.gazeCurve(0.6) < core.gazeCurve(0.9),
    'the curve is monotone, so the head never turns back while the cursor keeps going');
  near(core.pointerAim(Object.assign({ pointerX: 800, pointerY: 600 }, centre)).x,
    -right.x, 1e-12, 'the curve is mirrored about the centre, so both sides feel the same');

  // Both halves of the response are now SETTINGS (the 模型参数 window's 视线 section), and these are the
  // contracts the settings UI leans on: the curve's slope is an input, 1 means exactly a straight line (so
  // "linear" stays reachable and comparable), and the aim's span comes from the preference.
  near(core.gazeCurve(0.5, 1), 0.5, 1e-12, 'an edge slope of 1 is exactly a straight line');
  near(core.gazeCurve(0.5, 0.25), 0.5 / (0.25 + 0.75 * 0.5), 1e-12, 'a steeper setting curves the response');
  ok(core.gazeCurve(0.2, 0.15) > core.gazeCurve(0.2, 0.5),
    'a smaller slope turns the head further at the same distance');
  near(core.gazeCurve(0.5, 5), core.gazeCurve(0.5, 1), 1e-12,
    'a setting outside the range is clamped rather than followed');
  near(core.gazeCurve(0.5, 0.01), core.gazeCurve(0.5, 0.05), 1e-12,
    'and clamped at the other end too, at the shallowest slope the control offers');
  near(core.pointerAim(Object.assign({ pointerX: 1200, pointerY: 500, curve: 1 }, centre)).x,
    200 / core.GAZE_SPAN.x, 1e-12, 'the curve is the ONLY thing shaping the aim, so slope 1 is the old line');
  near(core.pointerAim(Object.assign({ pointerX: 1200, pointerY: 500, curve: 0.1 }, centre)).x,
    core.gazeCurve(200 / core.GAZE_SPAN.x, 0.1), 1e-12, 'and a steeper curve is applied through it');

  // `0` means auto — the caller's own frame — so a settings file from before these keys existed, or one
  // with the field zeroed, keeps the shipping behaviour instead of collapsing the span to nothing.
  eq(core.resolveGazeSpan(0, 1920), 1920, 'a span of 0 means auto: the caller frame is used');
  eq(core.resolveGazeSpan(600, 1920), 600, 'a positive span overrides the frame');
  eq(core.resolveGazeSpan(null, 900), 900, 'a missing span means auto as well');
  eq(core.resolveGazeSpan(-5, 900), 900, 'a negative span is treated as auto, not as a zero-distance gaze');
  eq(core.resolveGazeSpan(0, 0), core.GAZE_SPAN.x, 'with no frame to quote, the fallback span is used');
  eq(core.resolveGazeSpan(99999, 1920), core.GAZE_SPAN_RANGE.max, 'an absurd span is clamped, not trusted');

  // The whole point: far outside the pet's box still produces an aim, saturated rather
  // than null. The pet box is a few hundred pixels across, so these are metres away in
  // pet terms — the far corner of the window.
  const farRight = core.pointerAim(Object.assign({ pointerX: 4000, pointerY: 600 }, centre));
  eq(farRight.x, 1, 'a pointer far to the right saturates at full right, and does not return null');
  const farLeft = core.pointerAim(Object.assign({ pointerX: -3000, pointerY: 600 }, centre));
  eq(farLeft.x, -1, 'a pointer far to the left saturates at full left');
  const farBelow = core.pointerAim(Object.assign({ pointerX: 1000, pointerY: 5000 }, centre));
  eq(farBelow.y, 1, 'a pointer far below saturates at full down');
  const farAbove = core.pointerAim(Object.assign({ pointerX: 1000, pointerY: -5000 }, centre));
  eq(farAbove.y, -1, 'a pointer far above saturates at full up');

  // A diagonal far away saturates on both axes, not on the radius: the pet has separate
  // yaw and pitch limits, and tying them together would make it look sideways when the
  // cursor is straight above.
  const corner = core.pointerAim(Object.assign({ pointerX: 9000, pointerY: 9000 }, centre));
  eq(corner.x, 1, 'a far corner saturates horizontally');
  eq(corner.y, 1, 'a far corner saturates vertically too');

  // A span can be overridden, and a nonsense one falls back to the shipped default
  // rather than dividing by zero (which would make every aim infinite). The span is where the CURVE is
  // evaluated, so a half-span offset is a half-span on the curve's input, not half the aim.
  const wide = core.pointerAim(Object.assign({ pointerX: 1400, pointerY: 600, spanX: 800 }, centre));
  near(wide.x, core.gazeCurve(0.5), 1e-9, 'an explicit span is used');
  const zeroSpan = core.pointerAim(Object.assign({ pointerX: 1400, pointerY: 600, spanX: 0 }, centre));
  near(zeroSpan.x, core.gazeCurve(400 / core.GAZE_SPAN.x), 1e-9, 'a zero span falls back to the default');

  // The aim does not depend on the window or the canvas: the same pointer and centre give
  // the same answer, which is what "measured against the pet" means.
  const again = core.pointerAim(Object.assign({ pointerX: 1200, pointerY: 500 }, centre));
  eq(again.x, right.x, 'the aim is a pure function of the pointer and the pet centre');
  eq(again.y, right.y, 'on both axes');

  // Unusable input is refused rather than turned into a NaN gaze.
  eq(core.pointerAim(null), null, 'a missing pointer is refused');
  eq(core.pointerAim({}), null, 'a pointer without coordinates is refused');
  eq(core.pointerAim({ pointerX: NaN, pointerY: 0, centreX: 0, centreY: 0 }), null,
    'a NaN pointer is refused');
  eq(core.pointerAim({ pointerX: 0, pointerY: 0, centreX: 'x', centreY: 0 }), null,
    'a non-numeric centre is refused');

  // `GAZE_SPAN` is now only the FALLBACK, for a caller that has no frame of its own. Both real surfaces
  // pass their frame's width as `spanX` — the floating window sends the work area's width, i.e. the
  // screen's horizontal resolution ("满偏距离是屏幕的水平分辨率"), and the app overlay sends its window's
  // width. The fallback stays a hand's-width scale rather than a window size, which is what keeps it sane
  // on a 4K screen.
  ok(core.GAZE_SPAN.x > 100 && core.GAZE_SPAN.x < 1200,
    `the fallback gaze span is a hand's-width scale (${core.GAZE_SPAN.x})`);
  ok(core.GAZE_SPAN.y > 0 && core.GAZE_SPAN.y < core.GAZE_SPAN.x,
    'the vertical fallback is the smaller of the two, matching the smaller pitch range');
  // A screen-wide span must be honoured exactly: that is the policy the surfaces depend on.
  const screenWide = core.pointerAim(Object.assign({ pointerX: 1000 + 1920, pointerY: 600, spanX: 1920 }, centre));
  near(screenWide.x, 1, 1e-9, 'a span equal to the screen width reaches full deflection in one width');
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`);
if (failed === 0) {
  console.log(`core: ${passed} checks passed`);
  process.exit(0);
}
console.log(`core: ${passed} passed, ${failed} FAILED`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);

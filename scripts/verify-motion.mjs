#!/usr/bin/env node
/**
 * Play a REAL authored motion through the plugin's own Scene and prove the bones
 * actually move.
 *
 * ⚠ NOT WIRED INTO ANY SUITE SINCE 2026-10-12 (VRM-only rename). This file is kept on disk as the history of the
 * authored-motion work, exactly as `build/probe/mmd-probe.js`, `scripts/make-fixtures.mjs` and
 * `scripts/make-motion-fixtures.mjs` are — but `Scene.loadMotion` now refuses anything that is not a `.vrma`, so the
 * `--motion ....vmd` invocation below no longer plays. Only the VRMA form works.
 *
 * Run:  node scripts/verify-motion.mjs --model <path> --motion <path>
 *
 *   node scripts/verify-motion.mjs \
 *     --model build/fixtures/miku/miku_v2.pmd \        (RETIRED: a PMX is refused by name now)
 *     --motion build/fixtures/motions/vrmpet3d-test.vmd
 *
 *   node scripts/verify-motion.mjs \
 *     --model build/fixtures/vrma/vrmpet3d-minimal.vrm \
 *     --motion build/fixtures/vrma/vrmpet3d-test.vrma
 *
 * Why a browser and a loopback server: the whole feature is "bytes -> clip ->
 * mixer -> skeleton", and none of that exists without WebGL, a real
 * `document` for TextureLoader, and the vendored chunk. `file://` pages in this
 * Chromium cannot read a sibling binary, so the model and the motion are served
 * from a local HTTP server with only the JavaScript inlined — exactly the route
 * scripts/vrm-probe.mjs takes, and for the same reason.
 *
 * What it asserts, in order of how much it is worth:
 *
 *   1. a real .vmd / .vrma is accepted by `Scene.loadMotion` and reports a
 *      non-zero track count and a duration;
 *   2. `describeMotions()` shows it playing for a mapped state;
 *   3. the bone that clip drives is measurably somewhere else than it was at
 *      rest, and its quaternion stays finite, and the model still renders a
 *      silhouette — a clip that binds to nothing, or one whose time maths goes
 *      NaN, fails exactly here;
 *   4. a drag state (`held`) draws the clip mapped to it — since 2026-10-13 those poses have rows of their own,
 *      and before that date this line said the opposite;
 *   5. `clearMotions()` returns the model to its rest pose;
 *   6. a malformed payload is reported as a `reason`, not thrown into the loop.
 *
 * PERFORMANCE: `scene.tick()` renders a frame. This probe renders a handful of
 * frames at 128x128 with a small shadow map, because software rendering a
 * skinned mesh at 512x512 with a 1024x1024 shadow pass is minutes of wall clock
 * (see the note in scripts/vrm-probe.mjs). The frame count is deliberately
 * small; clip TIME is advanced with larger deltas instead.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listenOnUsablePort } from './loopback.mjs';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : null;
};
const MODEL = argValue('--model');
const MOTION = argValue('--motion');

if (!MODEL || !MOTION) {
  console.error('usage: node scripts/verify-motion.mjs --model <path> --motion <path>');
  process.exit(2);
}
for (const [label, path] of [['model', MODEL], ['motion', MOTION]]) {
  if (!existsSync(path)) {
    console.error(`${label} not found: ${path}`);
    process.exit(2);
  }
}

/** Candidate Chromium-based browsers, matching verify-browser.mjs. */
const BROWSER_CANDIDATES = [
  envVar('BROWSER'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate;
  return null;
}

const modelBytes = readFileSync(MODEL);
const motionBytes = readFileSync(MOTION);

// ---------------------------------------------------------------------------
// A time-varying derivative of the motion fixture.
//
// Both delivered fixtures happen to be short; the VMD one is a two-keyframe
// STATIC pose, which proves a clip binds and poses a bone but says nothing about
// clip time advancing. So a second VMD is derived from it by rewriting each
// bone's last keyframe quaternion to a clearly different rotation (and adding a
// later keyframe when a bone has only one). That exercises the per-frame path —
// mixer time, interpolation, looping — without inventing a file format.
//
// Returns null when the payload is not a VMD.
// ---------------------------------------------------------------------------
const VMD_BONE_RECORD = 111;
const VMD_BONE_SECTION = 54;

function deriveTimeVaryingVmd(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < VMD_BONE_SECTION) return null;
  if (bytes.subarray(0, 20).toString('latin1') !== 'Vocaloid Motion Data') return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boneCount = view.getUint32(50, true);
  const sectionEnd = VMD_BONE_SECTION + boneCount * VMD_BONE_RECORD;
  if (sectionEnd > bytes.length) return null;

  // Group record offsets by bone name, in file order.
  const groups = new Map();
  for (let i = 0; i < boneCount; i++) {
    const offset = VMD_BONE_SECTION + i * VMD_BONE_RECORD;
    const name = bytes.subarray(offset, offset + 15).toString('latin1').replace(/\0+$/, '');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(offset);
  }
  if (!groups.size) return null;

  const rotateFurther = (qx, qy, qz, qw) => {
    // Double the existing angle and add a quarter turn, about the same axis: the
    // result is guaranteed to differ from the frame-0 value this record sits on.
    const length = Math.hypot(qx, qy, qz, qw) || 1;
    const w = Math.max(-1, Math.min(1, qw / length));
    const angle = 2 * Math.acos(w);
    const sin = Math.sqrt(Math.max(0, 1 - w * w));
    let ax = 0;
    let ay = 1;
    let az = 0;
    if (sin > 1e-4) {
      ax = qx / length / sin;
      ay = qy / length / sin;
      az = qz / length / sin;
    }
    const next = Math.min(170 * Math.PI / 180, angle + 100 * Math.PI / 180);
    const half = next / 2;
    return [ax * Math.sin(half), ay * Math.sin(half), az * Math.sin(half), Math.cos(half)];
  };

  const records = [];
  for (const [name, offsets] of groups) {
    offsets.forEach((offset, index) => {
      const record = Buffer.from(bytes.subarray(offset, offset + VMD_BONE_RECORD));
      const last = index === offsets.length - 1;
      if (last) {
        const q = rotateFurther(
          record.readFloatLE(31), record.readFloatLE(35),
          record.readFloatLE(39), record.readFloatLE(43),
        );
        for (let i = 0; i < 4; i++) record.writeFloatLE(q[i], 31 + i * 4);
        if (offsets.length === 1) {
          // A single-keyframe bone needs a second key or the derived clip is
          // static again; copy the record and push it 30 frames later.
          const extra = Buffer.from(record);
          extra.writeUInt32LE(record.readUInt32LE(15) + 30, 15);
          records.push(extra);
        }
      }
      records.push(record);
    });
  }

  const header = Buffer.from(bytes.subarray(0, VMD_BONE_SECTION));
  header.writeUInt32LE(records.length, 50);
  const tail = bytes.subarray(sectionEnd);
  return Buffer.concat([header, ...records, tail]);
}

const variant = deriveTimeVaryingVmd(motionBytes);
if (variant) {
  console.log(`derived: a time-varying VMD (${variant.length} bytes) from ${basename(MOTION)}`);
}

// ---------------------------------------------------------------------------
// A deliberately MISMATCHED VMD: the same file with every bone renamed to
// something no MMD model has.
//
// This is the failure mode the plugin has to survive best, because it is the one
// a user actually hits: `buildAnimation` DROPS every bone name that is not in the
// skeleton, so a motion authored for a different model parses cleanly, produces a
// clip, and animates nothing at all. It must surface as a reason, not as a pet
// that ignores its motion.
// ---------------------------------------------------------------------------
function deriveMismatchedVmd(source) {
  const bytes = Buffer.from(source);
  if (bytes.length < VMD_BONE_SECTION) return null;
  if (bytes.subarray(0, 20).toString('latin1') !== 'Vocaloid Motion Data') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boneCount = view.getUint32(50, true);
  const sectionEnd = VMD_BONE_SECTION + boneCount * VMD_BONE_RECORD;
  if (sectionEnd > bytes.length || !boneCount) return null;
  const out = Buffer.from(bytes);
  for (let i = 0; i < boneCount; i++) {
    const offset = VMD_BONE_SECTION + i * VMD_BONE_RECORD;
    const name = out.subarray(offset, offset + 15).toString('latin1').replace(/\0+$/, '');
    const renamed = (name + '-X').slice(0, 15);
    out.fill(0, offset, offset + 15);
    out.write(renamed, offset, 15, 'latin1');
  }
  return out;
}

const mismatch = deriveMismatchedVmd(motionBytes);
if (mismatch) {
  console.log(`derived: a mismatched VMD (${mismatch.length} bytes) whose bone names exist in no model`);
}

// ---------------------------------------------------------------------------
// The probe body. Runs inside the page with the real lib/ sources inlined.
//
// Written WITHOUT template literals, backticks, `${`, or regular expressions:
// this string is embedded in one, and a backslash escape would silently rewrite
// the pattern (a `\[` inside a template literal becomes a plain `[`).
// ---------------------------------------------------------------------------
const PROBE = `
(function () {
  var report = { checks: [], errors: [], info: {}, samples: {} };
  var out = document.getElementById('out');

  function check(name, fn) {
    var value, ok;
    try {
      value = fn();
      ok = value !== false && value !== undefined && value !== null;
    } catch (error) {
      value = 'threw: ' + (error && error.message);
      ok = false;
      report.errors.push(name + ': ' + (error && error.message));
    }
    report.checks.push({ name: name, ok: ok, value: String(value) });
    return value;
  }
  function finish() {
    report.ok = report.checks.length > 0 && report.checks.every(function (c) { return c.ok; });
    if (out) out.textContent = JSON.stringify(report);
    document.title = report.ok ? 'MOTION-OK' : 'MOTION-FAIL';
  }
  function round(value) { return Math.round(value * 10000) / 10000; }
  function quatArray(q) { return [round(q.x), round(q.y), round(q.z), round(q.w)]; }

  /**
   * The angle between two quaternions, measured on the ROTATIONS they describe
   * rather than on the numbers stored in them.
   *
   * THREE.Quaternion.angleTo does NOT normalise its operands: it takes the raw dot
   * product, so two quaternions describing the SAME rotation but carrying a length
   * of 0.9996 read as 4.59 degrees apart. That is not hypothetical here:
   * core.aimDownQuaternion returned a non-unit axis until 2026-10-12, which made
   * the dropped-arm stance non-unit, and this probe reported the length difference
   * as a pose residual and failed its two rest-pose checks on every clip that
   * drives an arm. The checks are named after the rotation, so the length is
   * divided out: a pose regression cannot hide behind a scale factor again.
   */
  function rotationBetween(a, b) {
    var dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    var lenA = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w);
    var lenB = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z + b.w * b.w);
    if (!(lenA > 0) || !(lenB > 0)) return 0;
    var cosine = Math.abs(dot / (lenA * lenB));
    if (cosine > 1) cosine = 1;
    return 2 * Math.acos(cosine);
  }

  var V = globalThis.__VRMPET3D_VENDOR__;
  var C = globalThis.__VRMPET3D_CORE__;
  // lib/scene.js publishes a BAG of exports, not the constructor itself, so the
  // scene class is the .Scene property of it.
  var VrmPet3D = globalThis.__VRMPET3D_SCENE__;
  var Scene = VrmPet3D && VrmPet3D.Scene;
  var THREE = V && V.THREE;
  check('vendor chunk, core and scene are present', function () { return Boolean(V && C && Scene && THREE); });
  if (!V || !C || !Scene) { finish(); return; }

  var SIZE = 128;
  var canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  document.body.appendChild(canvas);

  var scene = new Scene(canvas, {
    assetBase: '/asset',
    modelId: 'motion-probe',
    onError: function (message) { report.errors.push('scene.onError: ' + message); },
  });
  scene.resize(SIZE, SIZE);
  // Diagnostic only: the shadow pass is the expensive part of every tick() under
  // SwiftShader and has nothing to do with the motion path under test.
  if (scene.keyLight) scene.keyLight.shadow.mapSize.set(128, 128);

  // ---- model ---------------------------------------------------------------
  fetch('/model.bin')
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    })
    .then(function (buffer) {
      report.info.modelBytes = buffer.byteLength;
      report.info.modelFormat = C.detectFormat(buffer);
      return scene.parse(buffer, 'motion-probe');
    })
    .then(function (parsed) {
      report.info.parseResult = parsed;
      report.info.avatarKind = scene.kind;
      check('the model parsed through the plugin', function () { return parsed && parsed.ok === true; });
      if (!parsed || !parsed.ok) throw new Error('model did not load: ' + JSON.stringify(parsed));
      return fetch('/motion.bin');
    })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    })
    .then(function (buffer) {
      report.info.motionBytes = buffer.byteLength;
      report.info.motionFormatDetected = C.detectMotionFormat(buffer);
      return scene.loadMotion('fixture', buffer);
    })
    .then(function (result) {
      report.info.loadResult = result;
      check('loadMotion() accepted the file', function () { return result && result.ok === true; });
      check('the reported format matches the bytes', function () {
        return result.format === report.info.motionFormatDetected;
      });

      var described = scene.describeMotions();
      report.info.describe = described;
      check('describeMotions() lists the motion with real tracks', function () {
        var entry = described.available.length === 1 ? described.available[0] : null;
        return Boolean(entry) && entry.id === 'fixture' && entry.tracks > 0;
      });
      check('the motion has a playable duration', function () {
        var entry = described.available[0];
        return Boolean(entry) && entry.duration > 0;
      });
      if (!result.ok) throw new Error('motion did not load: ' + result.reason);

      // ---- pick the bones this clip actually drives --------------------------
      // The clip is read only to CHOOSE WHAT TO WATCH; everything being verified
      // below happens through the real Scene path (loadMotion, setMotionMap,
      // setState, tick).
      var record = scene.motionClips.fixture;
      var avatar = scene.avatar;
      var driven = [];
      var raw = [];
      var seen = {};
      for (var i = 0; i < record.clip.tracks.length; i++) {
        var name = record.clip.tracks[i].name || '';
        if (name.indexOf('.quaternion') === -1) continue;
        var node = null;
        var boneName = null;
        if (avatar.kind === 'mmd' && name.indexOf('.bones[') === 0) {
          var end = name.indexOf('].quaternion');
          if (end > 7) boneName = name.slice(7, end);
          var shell = avatar.mmd && avatar.mmd.mesh ? avatar.mmd : (avatar.mmd ? avatar.mmd.mmd : null);
          if (shell && shell.mesh && shell.mesh.skeleton) node = shell.mesh.skeleton.getBoneByName(boneName);
        } else if (name.indexOf('Normalized_') === 0) {
          var nodeName = name.slice(0, name.length - '.quaternion'.length);
          node = avatar.root.getObjectByName(nodeName);
          // The raw bone is what the mesh is skinned to; it only follows the
          // normalized rig because the scene calls humanoid.update(). A model
          // whose raw node names differ from the humanoid names simply has none
          // to watch, which is reported rather than asserted.
          var rawNode = avatar.root.getObjectByName(nodeName.slice('Normalized_'.length));
          if (rawNode) raw.push(rawNode);
        }
        if (!node || seen[node.uuid]) continue;
        seen[node.uuid] = true;
        driven.push({ track: name, name: node.name, node: node });
      }
      report.info.drivenBones = driven.map(function (entry) { return entry.name; });
      check('the clip resolves to bones on this model', function () { return driven.length > 0; });

      function snapshot() {
        return driven.map(function (entry) {
          return { entry: entry, q: entry.node.quaternion.clone(), p: entry.node.position.clone() };
        });
      }
      function rawSnapshot() {
        return raw.filter(Boolean).map(function (node) {
          return { entry: { name: node.name, node: node }, q: node.quaternion.clone(), p: node.position.clone() };
        });
      }
      // Every angle here goes through rotationBetween (see its comment at the top
      // of the probe): THREE's angleTo would fold a quaternion's LENGTH into the
      // answer and invent a residual that is not in the pose.
      function margins(before, after) {
        var worst = { name: null, angle: 0, position: 0, before: null, after: null };
        for (var i = 0; i < before.length; i++) {
          var angle = rotationBetween(before[i].q, after[i].q);
          var position = before[i].p.distanceTo(after[i].p);
          if (angle > worst.angle || (angle === worst.angle && position > worst.position)) {
            worst = {
              name: before[i].entry.name,
              angle: angle,
              position: position,
              before: quatArray(before[i].q),
              after: quatArray(after[i].q),
            };
          }
        }
        return worst;
      }
      function finite() {
        for (var i = 0; i < driven.length; i++) {
          var q = driven[i].node.quaternion;
          var p = driven[i].node.position;
          if (!Number.isFinite(q.x + q.y + q.z + q.w) || !Number.isFinite(p.x + p.y + p.z)) return false;
        }
        return true;
      }
      function silhouette() {
        var gl = scene.renderer.getContext();
        var w = gl.drawingBufferWidth;
        var h = gl.drawingBufferHeight;
        var px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var covered = 0;
        for (var i = 3; i < px.length; i += 4) if (px[i] > 8) covered += 1;
        return covered / (w * h) * 100;
      }

      // ---- baseline: procedural idle, nothing mapped -------------------------
      scene.setState('resting');
      scene.tick(1 / 60);
      var restTargets = snapshot();
      var restRaw = rawSnapshot();

      // ---- play it ----------------------------------------------------------
      scene.setMotionMap({ resting: 'fixture' });
      scene.tick(1 / 60);
      var playing = scene.describeMotions();
      report.info.playingAfterMap = playing.playing;
      check('a mapped motion takes over the state', function () { return playing.playing === 'fixture'; });

      // Clip TIME is advanced in 0.1 s steps: fewer rendered frames for the same
      // amount of animation, which is the whole reason this probe is affordable.
      //
      // Every "did it move" margin below is the WORST one over the sampled frames,
      // not the last one: an authored loop can pass back through its rest pose (a
      // 1 s clip sampled for exactly 1 s ends where it started), and comparing the
      // final frame against rest would then call a perfectly good clip static.
      var first = snapshot();
      var previous = first;
      var latest = first;
      var worstVsFirst = { name: null, angle: 0, position: 0, before: null, after: null };
      var worstPerFrame = { name: null, angle: 0, position: 0, before: null, after: null };
      var worstVsRest = { name: null, angle: 0, position: 0, before: null, after: null };
      var worstRaw = { name: null, angle: 0, position: 0, before: null, after: null };
      for (var step = 0; step < 10; step++) {
        scene.tick(0.1);
        latest = snapshot();
        var vsFirst = margins(first, latest);
        var vsRest = margins(restTargets, latest);
        var perFrame = margins(previous, latest);
        if (vsFirst.angle > worstVsFirst.angle) worstVsFirst = vsFirst;
        if (vsRest.angle > worstVsRest.angle) worstVsRest = vsRest;
        if (perFrame.angle > worstPerFrame.angle) worstPerFrame = perFrame;
        if (raw.length) {
          var rawNow = margins(restRaw, rawSnapshot());
          if (rawNow.angle > worstRaw.angle) worstRaw = rawNow;
        }
        previous = latest;
      }
      report.motion = {
        bone: worstVsRest.name,
        restQuaternion: worstVsRest.before,
        playedQuaternion: worstVsRest.after,
        angleDegrees: round(worstVsRest.angle * 180 / Math.PI),
        positionDelta: round(worstVsRest.position),
        bindingBaseline: {
          bone: worstVsFirst.name,
          firstQuaternion: worstVsFirst.before,
          lastQuaternion: worstVsFirst.after,
          angleDegrees: round(worstVsFirst.angle * 180 / Math.PI),
          perFrameDegrees: round(worstPerFrame.angle * 180 / Math.PI),
        },
      };
      check('a driven bone moved away from its rest pose', function () {
        return worstVsRest.angle > 0.05;
      });
      check('bone rotations stayed finite through playback', function () { return finite(); });
      var coverage = silhouette();
      report.info.silhouettePercent = round(coverage);
      check('the model still renders a silhouette while the clip plays', function () {
        return coverage > 2 && coverage < 98;
      });

      if (raw.length) {
        report.raw = {
          bone: worstRaw.name,
          restQuaternion: worstRaw.before,
          playedQuaternion: worstRaw.after,
          angleDegrees: round(worstRaw.angle * 180 / Math.PI),
        };
        check('the RAW bone (the one the mesh is skinned to) followed the clip', function () {
          return worstRaw.angle > 0.05;
        });
      }

      // ---- a drag state DOES use the authored path, since 2026-10-13 ---------
      /**
       * Operator, 2026-10-13: 「缺少拖动时模型动作的设置」. held / falling / landing joined core.MOTION_STATES, so
       * a clip mapped to 拖动中 is drawn while the pet is carried — the POSE comes from the clip, and WHERE the pet
       * is stays the drag physics' business (this tool's own concerns are the pose and the bones, which is exactly
       * what is measured here). Before that date this same block asserted the OPPOSITE: a drag state dropped the
       * clip and held the procedural pose.
       */
      scene.setMotionMap({ resting: ['fixture'], held: ['fixture'] });
      scene.setState('held');
      scene.tick(0.1);
      var held = scene.describeMotions();
      var heldTargets = snapshot();
      var heldDrift = margins(restTargets, heldTargets);
      report.info.playingWhileHeld = held.playing;
      report.heldDriftDegrees = round(heldDrift.angle * 180 / Math.PI);
      check('a drag state draws its own clip rather than the procedural pose', function () {
        return held.playing === 'fixture' && heldDrift.angle > 0.05;
      });

      // ---- and back ---------------------------------------------------------
      scene.setMotionMap({ resting: ['fixture'] });
      scene.setState('resting');
      scene.tick(0.1);
      check('the state\'s own clip is back when the drag state ends', function () {
        return scene.describeMotions().playing === 'fixture';
      });

      // ---- a malformed payload must be reported, not thrown ------------------
      var junk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]).buffer;
      var badPromise = scene.loadMotion('broken', junk).then(function (bad) {
        report.info.badPayloadResult = bad;
        check('a non-motion payload is refused with a reason', function () {
          return bad && bad.ok === false && typeof bad.reason === 'string' && bad.reason.length > 0;
        });
        return null;
      }, function (error) {
        report.errors.push('loadMotion rejected instead of resolving: ' + (error && error.message));
        check('a non-motion payload resolves rather than rejects', function () { return false; });
        return null;
      });

      // ---- Phase B: does clip TIME advance? ---------------------------------
      function phaseB() {
        if (!globalThis.__VRMPET3D_MOTION_VARIANT__) {
          report.info.variantMotion = 'not supplied';
          return Promise.resolve();
        }
        return fetch('/motion-variant.bin').then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.arrayBuffer();
        }).then(function (buffer) {
          return scene.loadMotion('variant', buffer);
        }).then(function (loaded) {
          report.info.variantLoad = loaded;
          check('the time-varying motion loaded', function () { return loaded && loaded.ok === true; });
          if (!loaded || !loaded.ok) return null;
          scene.setMotionMap({ resting: 'variant' });
          scene.tick(0.05);
          check('the time-varying motion is the one playing', function () {
            return scene.describeMotions().playing === 'variant';
          });
          var base = snapshot();
          var prior = base;
          var total = { name: null, angle: 0, position: 0, before: null, after: null };
          var perFrame = { name: null, angle: 0, position: 0, before: null, after: null };
          for (var step = 0; step < 12; step++) {
            scene.tick(0.1);
            var now = snapshot();
            var vsBase = margins(base, now);
            var stepwise = margins(prior, now);
            if (vsBase.angle > total.angle) total = vsBase;
            if (stepwise.angle > perFrame.angle) perFrame = stepwise;
            prior = now;
          }
          report.variant = {
            bone: total.name,
            firstQuaternion: total.before,
            furthestQuaternion: total.after,
            angleDegrees: round(total.angle * 180 / Math.PI),
            perFrameDegrees: round(perFrame.angle * 180 / Math.PI),
            perFrameBone: perFrame.name,
          };
          check('clip TIME advances the bone, not just its first frame', function () {
            return total.angle > 0.05 && perFrame.angle > 0.005;
          });
          check('bone rotations stayed finite through the varying clip', function () { return finite(); });
          return null;
        });
      }

      // ---- Phase C: a motion authored for a DIFFERENT model ------------------
      // Same format, same structure, bone names that no model has. This is the
      // most likely user error there is, and the one that fails silently: the
      // clip builds, binds to nothing, and the pet would simply ignore it.
      function mismatchPhase() {
        if (!globalThis.__VRMPET3D_MOTION_MISMATCH__) {
          report.info.mismatchMotion = 'not supplied';
          return Promise.resolve();
        }
        return fetch('/motion-mismatch.bin').then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.arrayBuffer();
        }).then(function (buffer) {
          return scene.loadMotion('mismatch', buffer);
        }).then(function (loaded) {
          report.info.mismatchLoad = loaded;
          check('a motion that binds to nothing is refused with a reason', function () {
            return loaded && loaded.ok === false && typeof loaded.reason === 'string' && loaded.reason.length > 0;
          });
          var described = scene.describeMotions();
          var entry = null;
          for (var i = 0; i < described.available.length; i++) {
            if (described.available[i].id === 'mismatch') entry = described.available[i];
          }
          report.info.mismatchEntry = entry;
          check('describeMotions() shows zero tracks and says why', function () {
            return Boolean(entry) && entry.tracks === 0 && typeof entry.reason === 'string' && entry.reason.length > 0;
          });

          scene.setMotionMap({ working: 'mismatch' });
          scene.setState('working');
          scene.tick(0.1);
          var after = scene.describeMotions();
          report.info.mismatchPlaying = after.playing;
          report.info.mismatchReason = after.reason;
          check('an unbindable motion falls back to the procedural pose', function () {
            return after.playing === null && typeof after.reason === 'string' && after.reason.length > 0;
          });

          // Put the good map back, and prove the pet is still healthy.
          scene.setMotionMap({ resting: 'fixture' });
          scene.setState('resting');
          scene.tick(0.1);
          check('the pet recovers and plays a good motion afterwards', function () {
            return scene.describeMotions().playing === 'fixture' && finite() && silhouette() > 2;
          });
          return null;
        });
      }

      /**
       * Phase D: several clips per state, and the one-shot.
       *
       * Neither is visible to any check above, which used ONE mapped id:
       *   * a state with a list draws exactly one clip when it is ENTERED, and keeps it — the draw is
       *     forced from both ends by pinning scene.random to a constant, so "two entries can differ" is
       *     asserted rather than hoped for, and pinning a CONSTANT (rather than a sequence) is deliberate:
       *     the blink timer draws from the same random, and a sequence would be consumed by whichever
       *     caller ran first;
       *   * a clip may declare itself a one-shot, which has to hand the pose back when it ends and must NOT
       *     be restarted on the next frame — the failure mode a naive list implementation has.
       */
      function phaseD() {
        return fetch('/motion.bin').then(function (response) {
          return response.arrayBuffer();
        }).then(function (bytes) {
          // The same bytes under two more ids: two distinct entries whose CONTENT is identical, so any
          // difference between what they play can only come from the draw itself.
          return scene.loadMotion('twin', bytes.slice(0)).then(function (twin) {
            return scene.loadMotion('once', bytes.slice(0), { loop: false }).then(function (once) {
              check('a clip can be loaded as a one-shot', function () {
                return Boolean(once) && once.ok === true && once.loop === false;
              });
              check('and the same clip defaults to looping', function () {
                return Boolean(twin) && twin.ok === true && twin.loop === true;
              });

              function enter(state, leave) {
                scene.setState(leave);
                scene.tick(0.05);
                scene.setState(state);
                scene.tick(0.05);
              }

              // ---- the draw: the LAST entry, then the FIRST --------------------
              scene.setMotionMap({ resting: ['fixture', 'twin'] });
              scene.random = function () { return 0.99; };
              enter('resting', 'working');
              var firstDraw = scene.describeMotions();
              // Away and back: the state is the unit the draw belongs to, so re-entering draws again.
              scene.random = function () { return 0; };
              enter('resting', 'working');
              var secondDraw = scene.describeMotions();
              report.info.phaseD = {
                firstPicked: firstDraw.picked,
                secondPicked: secondDraw.picked,
                mapped: firstDraw.mapped.resting,
              };
              check('a state with two clips draws one of them', function () {
                return firstDraw.picked === 'twin' || firstDraw.picked === 'fixture';
              });
              check('the drawn clip is the one playing', function () {
                return firstDraw.playing === firstDraw.picked;
              });
              check('the draw can differ between two entries of the same state', function () {
                return firstDraw.picked === 'twin' && secondDraw.picked === 'fixture';
              });
              check('describeMotions() reports the whole list rather than one id', function () {
                return Array.isArray(firstDraw.mapped.resting) && firstDraw.mapped.resting.length === 2;
              });
              check('the draw does not change from frame to frame', function () {
                var held = scene.describeMotions().picked;
                for (var steady = 0; steady < 10; steady++) scene.tick(0.1);
                return scene.describeMotions().picked === held;
              });

              // ---- the one-shot plays through and hands the pose back ----------
              scene.setMotionMap({ resting: ['once'] });
              scene.random = function () { return 0.5; };
              // Two states nothing else uses, so the entry below is unambiguous.
              enter('resting', 'offline');
              var started = scene.describeMotions();
              check('a one-shot starts like any other clip', function () {
                return started.picked === 'once' && started.playing === 'once';
              });

              var duration = 0;
              for (var i = 0; i < started.available.length; i++) {
                if (started.available[i].id === 'once') duration = started.available[i].duration;
              }
              report.info.phaseD.duration = duration;
              check('describeMotions() reports the clip as a one-shot', function () {
                var entry = null;
                for (var j = 0; j < started.available.length; j++) {
                  if (started.available[j].id === 'once') entry = started.available[j];
                }
                return Boolean(entry) && entry.loop === false;
              });

              var ticks = Math.ceil(duration / 0.1) + 3;
              for (var step = 0; step < ticks; step++) scene.tick(0.1);
              var ended = scene.describeMotions();
              report.info.phaseD.ended = { playing: ended.playing, picked: ended.picked, reason: ended.reason };
              check('a one-shot hands the pose back when it ends', function () {
                return ended.playing === null;
              });
              check('and it is not restarted on the frames that follow', function () {
                for (var again = 0; again < 5; again++) scene.tick(0.1);
                return scene.describeMotions().playing === null;
              });
              check('handing the pose back is not reported as an error', function () {
                return ended.reason === null && finite();
              });

              // ---- the contrast: a LOOPING clip is still playing after its own duration ----
              scene.setMotionMap({ resting: ['fixture'] });
              enter('resting', 'offline');
              for (var loopStep = 0; loopStep < ticks; loopStep++) scene.tick(0.1);
              check('a looping clip is still playing after its own duration', function () {
                return scene.describeMotions().playing === 'fixture';
              });

              /**
               * ---- Phase D2: the per-state interval fires a one-shot on its own ----
               *
               * A pinned window of 0.4 s is the whole feature in one line: while the pet rests it wears the
               * LOOPING clip, and 0.4 s later the non-looping one plays once and hands the pose back. The
               * window is pinned to a single value so the test does not depend on the draw, and scene.random
               * stays a constant for the same reason as above.
               */
              scene.setMotionMap({ resting: ['fixture', 'once'] });
              scene.preferences.motionEvery = { resting: { min: 0.4, max: 0.4 } };
              scene.random = function () { return 0; };
              enter('resting', 'offline');
              var armed = scene.describeMotions();
              report.info.phaseD.armed = {
                picked: armed.picked,
                window: armed.scheduled.window,
                nextAt: armed.scheduled.nextAt,
                candidates: armed.scheduled.candidates,
              };
              check('the draw prefers the LOOPING clip when the state holds one', function () {
                return armed.picked === 'fixture' && armed.scheduled.candidates.join(',') === 'once';
              });
              check('the interval is armed for the state it was configured on', function () {
                return Boolean(armed.scheduled.window) && armed.scheduled.window.max === 0.4
                  && typeof armed.scheduled.nextAt === 'number';
              });
              check('and nothing has fired yet', function () {
                return armed.scheduled.running === null && armed.scheduled.due === false;
              });

              for (var due = 0; due < 6; due++) scene.tick(0.1);
              var fired = scene.describeMotions();
              report.info.phaseD.fired = { running: fired.scheduled.running, playing: fired.playing };
              check('the interval fires the non-looping clip when it comes due', function () {
                return fired.scheduled.running === 'once' && fired.playing === 'once';
              });

              /**
               * Just past the reaction's own duration, and NOT longer: with a 0.4 s window the next reaction
               * is due 0.4 s after this one ends, so a test that ticked for another whole clip would catch
               * the pet mid-reaction again and call a working interval a failure.
               */
              var reactionTicks = Math.ceil(duration / 0.1) + 1;
              for (var settle = 0; settle < reactionTicks; settle++) scene.tick(0.1);
              var resumed = scene.describeMotions();
              report.info.phaseD.resumed = {
                running: resumed.scheduled.running,
                playing: resumed.playing,
                nextAt: resumed.scheduled.nextAt,
              };
              check('and the state goes back to its looping clip afterwards', function () {
                return resumed.scheduled.running === null && resumed.playing === 'fixture';
              });
              check('the next window starts when the reaction ended, not when the state was entered', function () {
                return typeof resumed.scheduled.nextAt === 'number'
                  && resumed.scheduled.nextAt > fired.scheduled.nextAt;
              });

              // The interval belongs to the STATE: a state with no window never fires, however many
              // one-shots are mapped to it.
              scene.preferences.motionEvery = {};
              scene.setMotionMap({ resting: ['fixture'], celebrate: ['once'] });
              enter('celebrate', 'offline');
              for (var quiet = 0; quiet < ticks; quiet++) scene.tick(0.1);
              var noWindow = scene.describeMotions();
              report.info.phaseD.noWindow = {
                window: noWindow.scheduled.window,
                nextAt: noWindow.scheduled.nextAt,
                playing: noWindow.playing,
              };
              check('a state with no window never fires one, and a mapped one-shot still plays once', function () {
                return noWindow.scheduled.window === null && noWindow.scheduled.nextAt === null
                  && noWindow.playing === null;
              });

              /**
               * ---- Phase D3: the window configured AFTER the state was entered ----
               *
               * The bug this exists for was measured on the real pet (2026-10-09, late): the interval is armed
               * at state entry, and at that moment a clip whose bytes have not arrived yet counts as LOOPING
               * (nothing else is knowable about it), so there was nothing to arm for and nothing ever re-armed
               * it — the published window reported the configured 20–80 s while nextAt stayed null and the pet
               * never fired. The same shape happens when a user drags the interval field while the pet is
               * already resting, which for a desk pet is the normal case. So: enter the state FIRST, with no
               * window configured, and only then configure it.
               */
              scene.preferences.motionEvery = {};
              scene.setMotionMap({ resting: ['fixture', 'once'] });
              enter('resting', 'offline');
              var unarmed = scene.describeMotions();
              scene.preferences.motionEvery = { resting: { min: 0.4, max: 0.4 } };
              // One frame is enough for the late arming; the deadline it sets is 0.4 s away.
              for (var late = 0; late < 6; late++) scene.tick(0.1);
              var lateFired = scene.describeMotions();
              report.info.phaseD.lateWindow = {
                unarmedNextAt: unarmed.scheduled.nextAt,
                nextAt: lateFired.scheduled.nextAt,
                running: lateFired.scheduled.running,
                playing: lateFired.playing,
              };
              check('a window configured after the state was entered still arms itself', function () {
                return unarmed.scheduled.nextAt === null && typeof lateFired.scheduled.nextAt === 'number';
              });
              check('and it fires on that new window rather than never', function () {
                return lateFired.scheduled.running === 'once' && lateFired.playing === 'once';
              });

              /**
               * ---- Phase D4: the deadline survives a state flip ----
               *
               * A desk pet does not stay in one state: it flips between resting and working every time the
               * session it follows goes quiet or busy. Measured on the real pet (2026-10-09, late): a 20–80 s
               * window reported a deadline of 63 s and, thirty seconds later, 219 s — the deadline had been
               * thrown away and redrawn by the flip, so the one-shot could never come due. The deadline is per
               * STATE now, and this is the check that keeps it that way.
               */
              scene.preferences.motionEvery = { resting: { min: 5, max: 5 } };
              scene.setMotionMap({ resting: ['fixture', 'once'], working: ['fixture'] });
              enter('resting', 'offline');
              var beforeFlip = scene.describeMotions();
              // Both flips go through an ordinary status state, so the window is the state's own business: since
              // 2026-10-13 a drag state has windows of its own too, and nothing in this check depends on that.
              enter('working', 'offline');
              enter('resting', 'offline');
              var afterFlip = scene.describeMotions();
              report.info.phaseD.flip = {
                before: beforeFlip.scheduled.nextAt,
                after: afterFlip.scheduled.nextAt,
                armed: afterFlip.scheduled.armed,
              };
              check('re-entering a state keeps the deadline it already had', function () {
                return typeof beforeFlip.scheduled.nextAt === 'number'
                  && afterFlip.scheduled.nextAt === beforeFlip.scheduled.nextAt;
              });
              check('and the state with a window stays the armed one', function () {
                return afterFlip.scheduled.armed.join(',') === 'resting' && afterFlip.scheduled.armed.length === 1;
              });

              /**
               * ---- Phase D5: the preview the settings window drives ----
               *
               * The operator asked for this on 2026-10-09: while a clip's expression and mouth are being chosen,
               * the model should show that combination, and go back to normal when the pointer leaves. Two
               * properties matter and neither is visible in a single picture: a preview OVERRIDES the state's
               * own draw (that is the point), and clearing it puts the state back (that is the other half).
               */
              scene.preferences.motionEvery = {};
              scene.setMotionMap({ resting: ['fixture'], celebrate: ['once'] });
              enter('resting', 'offline');
              var beforePreview = scene.describeMotions();
              scene.setPreview({ state: 'celebrate', motionId: 'once' });
              scene.tick(0.1);
              scene.tick(0.1);
              var duringPreview = scene.describeMotions();
              // The face the clip carries, read through the same call the renderer uses every frame.
              scene.setPreview({ motionId: 'once', expression: 'joy' });
              var facePreview = scene.currentFace();
              scene.setPreview(null);
              scene.tick(0.1);
              var afterPreview = scene.describeMotions();
              report.info.phaseD.preview = {
                before: beforePreview.playing,
                during: duringPreview.playing,
                face: facePreview,
                after: afterPreview.playing,
              };
              check('a preview plays the clip it names, whatever the state', function () {
                return duringPreview.playing === 'once' && beforePreview.playing === 'fixture';
              });
              check('and it carries the expression the settings window chose', function () {
                return Boolean(facePreview) && facePreview.expression === 'joy';
              });
              check('clearing the preview hands the pet back to its state', function () {
                return afterPreview.playing === 'fixture' || afterPreview.playing === null;
              });

              /**
               * ---- Phase D6: a preview suspends the pointer gaze ----
               *
               * The operator's second request in that message: "在'每状态 × 每动作'设置时，暂时关闭视角的鼠标跟随"
               * — while those settings are being chosen the head must hold still, so what is on screen is the
               * clip, the expression and the mouth and nothing else.
               */
              var head = scene.avatar && scene.avatar.gazeBone;
              var rest = head && head.userData ? head.userData.vrmpet3dRestQuat : null;
              // Look-at has to be ON for this to mean anything, and the scene is put back exactly as it was
              // found: a leftover aim keeps turning the head, which is what broke the rest-pose check that
              // runs after this block.
              scene.preferences.lookAt = true;
              scene.motion.lookAtPointer = true;
              var headTurn = function () {
                if (!head || !rest) return 0;
                // How far the head is from its rest pose, in radians: 0 means "not following anything".
                return rotationBetween(rest, head.quaternion);
              };
              scene.motion.setGaze({ yaw: 0.6, pitch: 0.2 });
              scene.tick(0.1);
              var turnWithoutPreview = headTurn();
              scene.setPreview({ motionId: 'fixture' });
              var holdingWhilePreviewing = scene.motion.holdGaze === true;
              // Captured NOW rather than read inside the check: the checks are evaluated after this block has
              // finished, and the block ends by clearing the aim.
              var aimArrivingWhileHolding = scene.motion.gaze !== null;
              scene.tick(0.1);
              var turnWhilePreviewing = headTurn();
              scene.setPreview(null);
              var holdingCleared = scene.motion.holdGaze === false;
              scene.tick(0.1);
              var turnAfterPreview = headTurn();
              // Put the scene back: no aim, head at rest.
              scene.motion.setGaze(null);
              scene.tick(0.1);
              report.info.phaseD.gazeHold = {
                without: +turnWithoutPreview.toFixed(4),
                holding: holdingWhilePreviewing,
                during: +turnWhilePreviewing.toFixed(4),
                after: +turnAfterPreview.toFixed(4),
              };
              check('a preview switches the pointer gaze off', function () {
                return holdingWhilePreviewing === true && holdingCleared === true;
              });
              /**
               * The aim keeps arriving while the preview is up — the cursor is still moving over the window —
               * so it is the SUPPRESSION that stops the head, which is the one line applyGaze was given. The
               * head's own angle is not asserted here: this fixture scene has no gaze bone to measure
               * (gazeBone is null for it), and the browser suite already proves that an aim turns the head
               * when nothing suppresses it (gazeFullYaw, gazeCentre).
               */
              check('while the aim keeps arriving, the suppression is what stops it', function () {
                return aimArrivingWhileHolding === true && holdingWhilePreviewing === true;
              });

              /**
               * ---- Phase D7: the two standing refusals ----
               *
               * The operator's 2026-10-09 late requests: "给每个状态下每个动作加上鼠标凝视的开关" and "如果鼠标连续5
               * 秒没有移动，就停止鼠标凝视，直到下次鼠标开始移动" (with the second one also being a setting, "方便
               * 调试"). Both are measured on what the renderer APPLIED (motion.appliedGaze), which is recorded
               * even on an avatar with no gaze bone — this fixture has none.
               */
              var gazeAim = { yaw: 0.5, pitch: 0.1 };
              /**
               * Frames, not one long step: the motion clock is CLAMPED to 100 ms per tick (a backgrounded tab
               * must not explode the physics when it wakes), so a tick of six seconds advances the clock by
               * 0.1 s, not six. The first version of this test asked for a long tick and then wondered why
               * nothing had idled.
               */
              var runFrames = function (seconds) {
                var frames = Math.ceil(seconds / 0.1);
                for (var frame = 0; frame < frames; frame += 1) scene.tick(0.1);
              };
              /**
               * …and a cursor STREAM is not movement.
               *
               * This is the case the field hit (operator: "超时暂停全局光标凝视功能未生效", 2026-10-10): the
               * floating window feeds the aim on every frame from the launcher's cursor, so with a stamp per
               * call the rule could never fire. Repeating the SAME aim while the clock runs must idle anyway.
               */
              var streamFrames = function (seconds, aim) {
                var frames = Math.ceil(seconds / 0.1);
                for (var frame = 0; frame < frames; frame += 1) {
                  scene.motion.setGaze(aim);
                  scene.tick(0.1);
                }
              };
              // (a) the idle rule, at a two-second value so the test does not have to run for five.
              scene.motion.setGazeIdle(2);
              scene.motion.setGaze(gazeAim);
              scene.tick(0.1);
              var gazeFresh = scene.motion.appliedGaze !== null;
              runFrames(1.8);
              var gazeStillFresh = scene.motion.appliedGaze !== null;
              runFrames(0.5);
              var gazeIdle = scene.motion.appliedGaze === null;
              // A repeated aim does not count as movement, however often it arrives.
              scene.motion.setGazeIdle(2);
              scene.motion.setGaze(gazeAim);
              streamFrames(3, gazeAim);
              var gazeIdleUnderStream = scene.motion.appliedGaze === null;
              // …but a real change does, on the very next frame.
              streamFrames(0.2, { yaw: 0.9, pitch: 0.1 });
              var gazeBackUnderStream = scene.motion.appliedGaze !== null;
              // …and the very next movement brings it back: "直到下次鼠标开始移动".
              scene.motion.setGazeIdle(2);
              scene.motion.setGaze(gazeAim);
              scene.tick(0.1);
              scene.motion.setGaze({ yaw: 0.51, pitch: 0.1 });
              scene.tick(0.1);
              var gazeBack = scene.motion.appliedGaze !== null;
              // 0 means the rule is off, which is what the control is for.
              scene.motion.setGazeIdle(0);
              scene.motion.setGaze(gazeAim);
              runFrames(6);
              var gazeNeverIdles = scene.motion.appliedGaze !== null;
              // A value that never arrived (an older host half) falls back to the core default, not to OFF.
              scene.motion.setGazeIdle(undefined);
              var idleFromUndefined = scene.motion.gazeIdleSeconds;
              // And the setting itself reaches the motion through the preferences.
              scene.preferences.gazeIdleSeconds = 7;
              scene.motion.setGazeIdle(scene.preferences.gazeIdleSeconds);
              var idleFromPrefs = scene.motion.gazeIdleSeconds;

              // (b) the per-clip switch, on the clip this state is actually playing.
              scene.motion.setGazeIdle(0);
              enter('resting', 'offline');
              scene.preferences.motionClips = { resting: { fixture: { gaze: false } } };
              scene.motion.setGaze(gazeAim);
              scene.tick(0.1);
              var clipRefused = scene.motion.appliedGaze === null;
              var refusedInResting = scene.clipGazeAllowed() === false;
              // The two links the refusal travels through, reported so a break shows up as a value rather than
              // as a mystery: the motion must know its scene, and the rule must say no.
              var linkedToScene = scene.motion.scene === scene;
              var refusedByRule = scene.motion.gazeAllowed() === false;
              // The same clip in ANOTHER state was never touched, so it still looks at the cursor there.
              var allowedInCelebrate = scene.core.motionGazeFor(scene.preferences, 'celebrate', 'fixture') === true;
              scene.preferences.motionClips = {};
              scene.motion.setGaze(gazeAim);
              scene.tick(0.1);
              var allowedAgain = scene.motion.appliedGaze !== null;

              /**
               * ---- Phase D8: the one-second BLEND, which is what makes it not look weird ----
               *
               * Operator, 2026-10-10: "凝视暂停和重新开始要让人物在1秒缓冲时间内均匀转头回归或者凝视鼠标，不然动画
               * 看上去很诡异". Three properties, all measured on the blend the applied angles are scaled by: it
               * RAMPS rather than switching, it does so in BOTH directions, and the ramp is EVEN — the same step
               * every frame, which is what "均匀" asks for.
               *
               * The refusal is driven by a PREVIEW here (the holdGaze flag) rather than by the idle rule, so the
               * moment it starts is exact; and the aim CHANGES between the two directions, because a repeated aim
               * is deliberately not movement (see Motion.setGaze) and would not restamp the clock.
               */
              scene.motion.setGazeIdle(0);
              scene.motion.setGaze({ yaw: 0.6, pitch: 0.15 });
              // Settle at full gaze first, so the ease-out starts from 1.
              runFrames(1.2);
              var blendSettled = scene.motion.gazeBlend;
              // The gaze is refused from here on: the head must not be at the front yet, and must get there
              // evenly, a tenth of the blend per 0.1 s frame.
              scene.motion.holdGaze = true;
              scene.tick(0.1);
              var blendAtRefusal = scene.motion.gazeBlend;
              var justAfterRefusal = scene.motion.appliedGaze === null && blendAtRefusal > 0;
              // …and one frame later it is closer to the front, by the same even step.
              scene.tick(0.1);
              var blendOneFrameLater = scene.motion.gazeBlend;
              var outStep1 = blendAtRefusal - blendOneFrameLater;
              scene.tick(0.1);
              var outStep2 = blendOneFrameLater - scene.motion.gazeBlend;
              // A movement now ramps it back up rather than snapping it out.
              scene.motion.holdGaze = false;
              scene.motion.setGaze({ yaw: 0.9, pitch: 0.2 });
              var blendBeforeIn = scene.motion.gazeBlend;
              scene.tick(0.1);
              var blendFirstIn = scene.motion.gazeBlend;
              var inStep1 = blendFirstIn - blendBeforeIn;
              runFrames(1.2);
              var blendBack = scene.motion.gazeBlend;
              // Zero seconds means a SNAP, which is what a caller that wants the mechanism without the ramp sets.
              scene.core.GAZE_LIMITS.blendSeconds = 0;
              scene.motion.setGaze(null);
              scene.tick(0.1);
              var snapToZero = scene.motion.gazeBlend === 0;
              scene.motion.setGaze(gazeAim);
              scene.tick(0.1);
              var snapToOne = scene.motion.gazeBlend === 1;
              scene.core.GAZE_LIMITS.blendSeconds = 1;

              report.info.phaseD.gazeBlend = {
                settled: +blendSettled.toFixed(3),
                atRefusal: +blendAtRefusal.toFixed(3),
                outStep1: +outStep1.toFixed(4),
                outStep2: +outStep2.toFixed(4),
                inStep1: +inStep1.toFixed(4),
                back: +blendBack.toFixed(3),
                snapToZero: snapToZero,
                snapToOne: snapToOne,
              };
              check('the gaze blends out instead of snapping when it is refused', function () {
                return justAfterRefusal === true && blendSettled > 0.99;
              });
              check('and the ramp is even, in both directions', function () {
                // One frame at 0.1 s over a one-second blend is 0.1, in and out alike.
                return Math.abs(outStep1 - 0.1) < 1e-6 && Math.abs(outStep2 - 0.1) < 1e-6
                  && Math.abs(inStep1 - 0.1) < 1e-6;
              });
              check('and it reaches full gaze again about a second after the cursor moves', function () {
                return blendBack > 0.99;
              });
              check('a blend of zero seconds snaps, for a caller that wants no ramp', function () {
                return snapToZero === true && snapToOne === true;
              });

              // Put the scene back: no aim, and enough frames for the blend to finish, so the rest-pose check
              // that follows is not fighting a head that is still easing back to the front.
              scene.motion.setGaze(null);
              runFrames(1.2);

              /**
               * ---- Phase D9: the cursor's draught on the spring chains ----
               *
               * Operator, 2026-10-10: "增加鼠标在模型上划过时，可以随着鼠标划过的方向摆动弹簧骨结构的功能". The
               * fixture's chains are real ones (hair and tail), so this can assert the two things that matter:
               * a sweep actually CHANGES what the solver is pulled by, and a swept pet gets its own physics
               * back afterwards — byte for byte, because a wind that permanently rewrote the model's gravity
               * would be a bug nobody would see until the hair stopped hanging straight.
               */
              var chainJoints = [];
              (scene.springChainInfo || []).forEach(function (chain) {
                chain.joints.forEach(function (entry) {
                  if (entry.joint && entry.joint.settings) chainJoints.push(entry.joint.settings);
                });
              });
              var baseGravity = chainJoints.map(function (settings) {
                return {
                  power: settings.gravityPower,
                  dir: [settings.gravityDir.x, settings.gravityDir.y, settings.gravityDir.z],
                };
              });
              var windJoints = scene.windState().joints;
              /**
               * LOCAL, not global (operator, 2026-10-10: "想要局部风而不是全局风").
               *
               * The scene projects every joint to canvas pixels and weights the force by distance. This fixture's
               * joints project only a few pixels apart, so the locality is proved two ways rather than by hoping
               * for a big separation:
               *
               *  * ORDER — aim at joint A and A is pulled harder than B; aim at B and the two SWAP. If the wind
               *    were global the two would get the same share whatever the cursor did;
               *  * a ZERO — with a reach small enough to separate them, the joint the cursor is NOT on keeps its
               *    own gravity exactly, which is what "local" means as opposed to "blown a bit less".
               */
              var jointPositions = scene.springJointScreenPositions();
              var nearIndex = -1;
              var farIndex = -1;
              for (var ji = 0; ji < jointPositions.length; ji += 1) {
                if (!jointPositions[ji]) continue;
                if (nearIndex === -1) nearIndex = ji;
                else if (farIndex === -1) farIndex = ji;
              }
              var nearPos = nearIndex >= 0 ? jointPositions[nearIndex] : null;
              var farPos = farIndex >= 0 ? jointPositions[farIndex] : null;
              var apartPx = nearPos && farPos ? Math.round(Math.sqrt(
                (nearPos.x - farPos.x) * (nearPos.x - farPos.x) + (nearPos.y - farPos.y) * (nearPos.y - farPos.y)
              )) : 0;
              var shareOf = function (index) {
                var base = baseGravity[index];
                return base ? Math.abs(chainJoints[index].gravityPower - base.power) : 0;
              };
              var aimAt = function (point) {
                scene.pushWind({
                  dx: 220, dy: 0, dt: 0.1, viewYaw: 0,
                  x: point ? point.x : null, y: point ? point.y : null,
                });
                scene.tick(0.1);
              };
              // Aimed at the first joint, then at the second: the stronger share must follow the cursor.
              aimAt(nearPos);
              var windPower = scene.windState().power;
              var shareAtNear = [shareOf(nearIndex), shareOf(farIndex)];
              var leanedRight = nearIndex >= 0 ? chainJoints[nearIndex].gravityDir.x > 0.05 : false;
              // The joint under the cursor is really being pulled, not merely reconfigured.
              var pulledPower = chainJoints.length ? chainJoints[0].gravityPower : 0;
              var baseFirst = baseGravity.length ? baseGravity[0].power : 0;
              // Let it die away, then aim the other way and compare the shares.
              runFrames(2);
              aimAt(farPos);
              var shareAtFar = [shareOf(nearIndex), shareOf(farIndex)];
              runFrames(2);
              var followsCursor = shareAtNear[0] > shareAtNear[1] && shareAtFar[1] > shareAtFar[0];
              // …and the reach is a real boundary, not merely a small number: aimed nowhere NEAR the pet, no joint
              // is touched at all. (Separating this fixture's two joints — 4 px apart, and moving a few px as the
              // pet breathes — is impossible at any reach that still contains the joint the cursor is on, which is
              // why the gradient is proved by the ORDER above and the cutoff by this.)
              aimAt({ x: (nearPos ? nearPos.x : 0) + 300, y: nearPos ? nearPos.y : 0 });
              var awayNear = shareOf(nearIndex);
              var awayFar = shareOf(farIndex);
              var awayReach = scene.windState().radius;
              runFrames(2);
              // Let it die away: the draught is gone within a second or so of the cursor stopping.
              runFrames(2);
              var windAfter = scene.windState().power;
              var restored = chainJoints.every(function (settings, index) {
                var base = baseGravity[index];
                return settings.gravityPower === base.power
                  && settings.gravityDir.x === base.dir[0]
                  && settings.gravityDir.y === base.dir[1]
                  && settings.gravityDir.z === base.dir[2];
              });

              report.info.phaseD.wind = {
                joints: windJoints,
                power: +windPower.toFixed(3),
                leanedRight: leanedRight,
                pulledPower: +pulledPower.toFixed(4),
                basePower: +baseFirst.toFixed(4),
                apartPx: apartPx,
                follow: followsCursor,
                awayNear: awayNear,
                awayFar: awayFar,
                awayReachPx: +awayReach.toFixed(1),
                after: +windAfter.toFixed(3),
                restored: restored,
              };
              check('a sweep across the pet pulls its spring chains sideways', function () {
                return windJoints > 0 && windPower > 0 && leanedRight === true && pulledPower !== baseFirst;
              });
              check('and the draught is LOCAL: the share follows the cursor, joint by joint', function () {
                return followsCursor === true;
              });
              check('and aimed nowhere near the pet it touches no joint at all, which is what local means', function () {
                return awayReach > 0 && awayNear === 0 && awayFar === 0;
              });
              check('and the draught dies away when the cursor stops', function () {
                return windAfter === 0;
              });
              // Double quotes, not an escaped apostrophe: this whole page script is itself inside a template
              // literal, and an escaped apostrophe is consumed by the OUTER literal — leaving a string that ends
              // early, two levels up from where the error points.
              check("leaving the model's own gravity exactly as it was", function () {
                return restored === true;
              });

              report.info.phaseD.gazeRules = {
                fresh: gazeFresh,
                stillFresh: gazeStillFresh,
                idled: gazeIdle,
                idledUnderStream: gazeIdleUnderStream,
                backUnderStream: gazeBackUnderStream,
                back: gazeBack,
                neverIdles: gazeNeverIdles,
                idleFromUndefined: idleFromUndefined,
                idleFromPrefs: idleFromPrefs,
                clipRefused: clipRefused,
                refusedInResting: refusedInResting,
                linkedToScene: linkedToScene,
                refusedByRule: refusedByRule,
                allowedInCelebrate: allowedInCelebrate,
                allowedAgain: allowedAgain,
              };
              check('a cursor that stops moving stops the gaze, and moving again brings it back', function () {
                return gazeFresh === true && gazeStillFresh === true && gazeIdle === true && gazeBack === true;
              });
              check('a repeated aim from a cursor STREAM is not movement, so the rule still fires', function () {
                return gazeIdleUnderStream === true && gazeBackUnderStream === true;
              });
              check('a value of zero turns the idle rule off, for debugging', function () {
                return gazeNeverIdles === true && idleFromPrefs === 7;
              });
              check('and a value that never arrived falls back to five seconds, not to off', function () {
                return idleFromUndefined === 5;
              });
              check('and a clip can refuse the gaze in one state without refusing it in another', function () {
                return clipRefused === true && refusedInResting === true && allowedInCelebrate === true
                  && allowedAgain === true;
              });

              /**
               * ---- Phase D6b: a face that is showing something does not blink ----
               *
               * The operator's request (2026-10-09 late, restated 2026-10-12): "当模型脸上有表情（专门设置或者
               * 动作自带表情时），暂停眨眼". The blink and the expression shapes drive the SAME eyelid morphs, so a
               * blink during an expression is not a blink — it is the expression dropping and coming back for a
               * tenth of a second.
               *
               * The two clip-borne sources (a per-clip expression, and the 表情 table's emotion reactions) were
               * already gated. The HAND-SET one — preferences.expressions.weights, which the settings window's
               * 表情 preview writes and which a stored configuration carries — was not, and that is what this
               * measures. The blink is forced DUE before each half so the test cannot pass by the timer simply
               * not having come round yet.
               */
              var pinnedBlink = function () {
                var originalRandom = scene.random;
                scene.random = function () { return 0.5; };
                scene.preferences.expressions.blink = { enabled: true, minSeconds: 0.5, maxSeconds: 0.5 };
                scene.expressionState.nextBlinkAt = 0;
                scene.preferences.expressions.weights = { happy: 1 };
                runFrames(0.6);
                var whilePinned = {
                  paused: scene.blinkState().paused,
                  blinking: scene.expressionState.blinking === true,
                  happy: scene.expressionTargets().happy,
                  pinned: scene.faceIsPinned(),
                };
                // Cleared: the same due blink must now happen, so this cannot pass by blinking having stopped.
                // A blink is over in ~0.14 s and blinking is a latch that clears when it ends, so what is
                // watched is whether a blink WEIGHT ever appeared inside the window.
                delete scene.preferences.expressions.weights.happy;
                scene.expressionState.nextBlinkAt = 0;
                var sawBlinkAfterClear = false;
                for (var watchFrame = 0; watchFrame < 30; watchFrame += 1) {
                  scene.tick(0.1);
                  if (scene.blinkState().weight > 0) sawBlinkAfterClear = true;
                }
                var afterClear = {
                  paused: scene.blinkState().paused,
                  sawBlink: sawBlinkAfterClear,
                  happy: scene.expressionTargets().happy,
                  nextAt: scene.expressionState.nextBlinkAt,
                };
                scene.expressionState.blinking = false;
                scene.expressionBehaviour.blink = 0;
                scene.preferences.expressions.blink = { enabled: true, minSeconds: 2, maxSeconds: 6 };
                scene.expressionState.nextBlinkAt = null;
                scene.random = originalRandom;
                return { whilePinned: whilePinned, afterClear: afterClear };
              };
              var pinned = pinnedBlink();
              report.info.phaseD.pinnedExpression = pinned;
              check('a hand-set expression pauses the blink', function () {
                return pinned.whilePinned.paused === true
                  && pinned.whilePinned.blinking === false
                  && pinned.whilePinned.happy === 1;
              });
              check('and clearing it lets the due blink happen', function () {
                return pinned.afterClear.paused === false && pinned.afterClear.sawBlink === true
                  && pinned.afterClear.happy === undefined;
              });
              check('the blink expression itself is not treated as an expression', function () {
                // A pinned blink owns the eyelids (a wink); it must not suppress the timer that also owns them.
                var before = scene.faceIsPinned();
                scene.preferences.expressions.weights = { blink: 0.5 };
                var whileBlinkPinned = scene.faceIsPinned();
                delete scene.preferences.expressions.weights.blink;
                return before === false && whileBlinkPinned === false;
              });
              return null;
            });
          });
        });
      }

      // Phase B and the malformed-payload check both resolve out of order, so
      // the report is only finished once both have landed.
      return Promise.all([phaseB().then(mismatchPhase).then(phaseD), badPromise]).then(function () {
        // ---- clearMotions() restores the rest pose ---------------------------
        scene.clearMotions();
        var cleared = scene.describeMotions();
        report.info.afterClear = cleared;
        scene.tick(0.1);
        var afterClear = snapshot();
        var drift = margins(restTargets, afterClear);
        report.clearedDriftDegrees = round(drift.angle * 180 / Math.PI);
        check('clearMotions() stops playback and forgets the bytes', function () {
          return cleared.playing === null && cleared.available.length === 0;
        });
        check('clearMotions() returns the model to its rest pose', function () {
          return drift.angle < 0.05;
        });
        check('the pet still renders after a malformed motion', function () {
          scene.tick(0.1);
          return scene.disposed === false && finite();
        });
        finish();
        return null;
      });
    })
    .catch(function (error) {
      report.errors.push('probe: ' + (error && (error.message || error)));
      check('the motion played through the real Scene path', function () { return false; });
      finish();
    });
})();
`;

// ---------------------------------------------------------------------------
// Page + loopback server
// ---------------------------------------------------------------------------
function inlineScript(path) {
  const source = readFileSync(path, 'utf8');
  return source.replace(/<\/script>/gi, '<\\/script>');
}

function buildPage() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>pending</title></head>
<body>
<div id="out">running…</div>
<script>
// Without this, anything thrown before the probe's own reporting runs leaves the
// div saying "running…" — which reads as "the model never loaded" when the real
// fault is a page-level error.
window.addEventListener('error', function (event) {
  var out = document.getElementById('out');
  if (out) out.textContent = 'page error: ' + (event && (event.message || event.error));
});
window.addEventListener('unhandledrejection', function (event) {
  var out = document.getElementById('out');
  var reason = event && event.reason;
  if (out) out.textContent = 'unhandled rejection: ' + (reason && (reason.message || reason));
});
</script>
<script>globalThis.__VRMPET3D_MOTION_VARIANT__ = ${variant ? 'true' : 'false'};</script>
<script>globalThis.__VRMPET3D_MOTION_MISMATCH__ = ${mismatch ? 'true' : 'false'};</script>
<script>${inlineScript(join(ROOT, 'lib', 'client.vendor.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'core.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'placeholder.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'scene.js'))}</script>
<script>${PROBE.replace(/<\/script>/gi, '<\\/script>')}</script>
</body>
</html>
`;
}

const page = buildPage();
const requests = [];

const server = createServer((request, response) => {
  const url = (request.url || '/').split('?')[0];
  requests.push(url);
  if (url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  const payloads = {
    '/model.bin': [modelBytes, 'application/octet-stream'],
    '/motion.bin': [motionBytes, 'application/octet-stream'],
    '/motion-variant.bin': [variant, 'application/octet-stream'],
    '/motion-mismatch.bin': [mismatch, 'application/octet-stream'],
  };
  const payload = payloads[url];
  if (payload && payload[0]) {
    response.writeHead(200, { 'content-type': payload[1], 'content-length': payload[0].length });
    response.end(payload[0]);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

const browser = findBrowser();
if (!browser) {
  console.error('No Chromium-based browser found. Set VRMPET3D_BROWSER and retry.');
  process.exit(2);
}

// A port the browser will accept: `listen(0)` can be handed one from Chromium's
// blocked list, which surfaces as ERR_UNSAFE_PORT and reads as a broken clip.
const port = await listenOnUsablePort(server);
console.log(`model:   ${MODEL} (${statSync(MODEL).size.toLocaleString()} bytes)`);
console.log(`motion:  ${MOTION} (${statSync(MOTION).size.toLocaleString()} bytes)`);
console.log(`browser: ${browser}`);
console.log(`serving: http://127.0.0.1:${port}/`);

let dom = '';
try {
  // ASYNCHRONOUS on purpose. `execFileSync` blocks Node's event loop for the
  // whole browser run, and the HTTP server that feeds this page lives in the same
  // process — it could never accept a connection or answer the page's `fetch`, so
  // the page would sit there until `--virtual-time-budget` expired and the
  // browser would exit non-zero with nothing but "Command failed" to show for it.
  const result = await execFileAsync(browser, [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    // A profile of our own: an interactive Edge would otherwise absorb this launch
    // and — measured on 2026-10-08 — surface the model URL as a download dialog in
    // the user's own browser instead of running the page. See gotcha 40 in
    // HANDOFF.md, which also records the second hazard: on some Chromium builds under
    // `--virtual-time-budget` this page's `fetch` bodies arrive EMPTY, so a clip looks
    // unloadable when the browser is the fault.
    `--user-data-dir=${join(ROOT, 'build', 'browser-profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    // Generous: a 25 MB VRM is decoded in software here, and the probe renders
    // ~30 small frames on top of that.
    '--virtual-time-budget=300000',
    '--dump-dom',
    `http://127.0.0.1:${port}/`,
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  dom = result.stdout;
} catch (error) {
  // The browser's own stderr is the only clue when it dies before dumping the
  // DOM — a SwiftShader crash and a page that never finished look identical
  // otherwise.
  console.error(`browser run failed: ${error.message}`);
  if (error.stderr) console.error(String(error.stderr).slice(0, 2000));
  server.close();
  process.exit(2);
}
server.close();

const match = /<div id="out">([\s\S]*?)<\/div>/.exec(dom);
if (!match) {
  console.error('the page produced no report');
  console.error(dom.slice(0, 600));
  process.exit(2);
}

let report;
try {
  report = JSON.parse(match[1]);
} catch (error) {
  const title = /<title>([\s\S]*?)<\/title>/.exec(dom);
  console.error(`report was not JSON: ${error.message}`);
  console.error(`  page title: ${title ? title[1] : '(none)'}`);
  console.error(`  report div: ${match[1].slice(0, 1000)}`);
  process.exit(2);
}

console.log('');
for (const check of report.checks) {
  console.log(`  ${check.ok ? 'pass' : 'FAIL'}  ${check.name}${check.ok ? '' : ` -> ${check.value}`}`);
}
console.log('');
for (const [key, value] of Object.entries(report.info)) {
  console.log(`  ${key.padEnd(30)} ${JSON.stringify(value)}`);
}

// The verbatim evidence this runner exists for.
const showMotion = (label, motion) => {
  if (!motion || typeof motion !== 'object') return;
  console.log('');
  console.log(`  ${label}`);
  console.log(`    bone               ${motion.bone}`);
  if (motion.restQuaternion) {
    console.log(`    before (rest)      [${motion.restQuaternion.join(', ')}]`);
    console.log(`    after (played)     [${motion.playedQuaternion.join(', ')}]`);
  } else {
    console.log(`    first              [${motion.firstQuaternion.join(', ')}]`);
    console.log(`    furthest           [${motion.furthestQuaternion.join(', ')}]`);
  }
  console.log(`    rotation change    ${motion.angleDegrees} degrees`);
  if (motion.positionDelta !== undefined) console.log(`    position change    ${motion.positionDelta}`);
  if (motion.perFrameDegrees !== undefined) console.log(`    per-frame change   ${motion.perFrameDegrees} degrees`);
  if (motion.bindingBaseline) {
    console.log(`    (largest change from the first played frame: `
      + `${motion.bindingBaseline.angleDegrees} degrees on ${motion.bindingBaseline.bone})`);
  }
};
showMotion('phase A — the fixture as delivered', report.motion);
if (report.variant) showMotion('phase B — the time-varying derivative', report.variant);
if (report.raw) {
  console.log('');
  console.log('  raw-bone propagation (VRM normalized rig -> skinned bone)');
  console.log(`    bone               ${report.raw.bone}`);
  console.log(`    before (rest)      [${report.raw.restQuaternion.join(', ')}]`);
  console.log(`    after (played)     [${report.raw.playedQuaternion.join(', ')}]`);
  console.log(`    rotation change    ${report.raw.angleDegrees} degrees`);
}

const beside = requests.filter((r) => !['/', '/model.bin', '/motion.bin', '/motion-variant.bin'].includes(r));
if (beside.length) {
  console.log('');
  console.log(`  external requests  ${JSON.stringify(beside.slice(0, 5))}`);
}

if (report.errors.length) {
  console.log('');
  for (const error of report.errors) console.log(`  error: ${error}`);
}

const failed = report.checks.filter((c) => !c.ok);
console.log('');
if (report.ok && failed.length === 0) {
  console.log(`motion: ${report.checks.length} checks passed (${report.info.motionFormatDetected} on ${report.info.avatarKind})`);
  process.exit(0);
}
console.log(`motion: ${failed.length} of ${report.checks.length} checks FAILED`);
process.exit(1);

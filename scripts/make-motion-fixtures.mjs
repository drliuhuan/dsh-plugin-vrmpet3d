#!/usr/bin/env node
/**
 * Synthesize a VMD motion fixture and prove it is valid.
 *
 * Run:  node scripts/make-motion-fixtures.mjs
 *
 * Why a generator instead of committing a .vmd: every MMD motion on the internet
 * carries redistribution restrictions, the same constraint that keeps model files
 * out of this repo (see docs/ASSET-CONTRACT.md and scripts/make-fixtures.mjs).
 * Synthesizing is also the only way the fixture can be *deterministic*: the test
 * needs to know exactly which bone moves, by exactly how much, at exactly which
 * frame.
 *
 * A VMD that parses is not the same as a VMD that animates. `buildAnimation`
 * silently drops every bone keyframe whose name does not match a bone in the
 * skeleton, so a name that is one byte wrong — or in the wrong encoding — yields
 * a perfectly valid clip with zero tracks for that bone. This script therefore
 * checks four things, and nothing here is optional:
 *
 *   1. the bytes it wrote parse back through the REAL vendored `VmdObject`
 *   2. the parsed keyframes name the bones it intended, in the right order
 *   3. `buildAnimation(vmd, mesh)` produces tracks for those bones against the
 *      REAL miku PMD mesh, loaded in a real browser (step 3 needs a `document`)
 *   4. stepping the mixer actually rotates those bones away from their rest pose
 *
 * `--fetch` exists to match the house convention (scripts/verify-model.mjs), but
 * there is nothing to download: this fixture is generated, never redistributed.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listenOnUsablePort } from './loopback.mjs';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'build', 'fixtures', 'motions');
const OUTPUT = join(OUTPUT_DIR, 'vrmpet3d-test.vmd');

/**
 * The model whose skeleton the clip must bind to. Same env override and same
 * default as scripts/verify-model.mjs and scripts/verify-browser.mjs, so the
 * three agree on which fixture is under test.
 */
const MODEL = process.env.MMD_FIXTURE || join(ROOT, 'build', 'fixtures', 'miku', 'miku_v2.pmd');

/** Candidate Chromium-based browsers, in the same preference order as verify-browser.mjs. */
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

// ---------------------------------------------------------------------------
// Reported facts. Every one of these has to hold before the script exits 0.
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function ok(condition, label, detail) {
  if (condition) {
    passed += 1;
    console.log(`  pass  ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

/** Round for display without losing the digits an assertion cares about. */
const r = (value, digits = 4) => Number(Number(value).toFixed(digits));

// ---------------------------------------------------------------------------
// Shift-JIS encoding
//
// MMD bone names are Japanese and a VMD stores them as 15 raw Shift-JIS bytes.
// JavaScript has NO Shift-JIS *encoder*: TextEncoder only does UTF-8, and the
// vendored parser only ever calls TextDecoder("shift-jis"). The bytes therefore
// have to come from somewhere explicit. There are two honest options and this
// script takes the first:
//
//   (a) derive them from a real byte-level decoder, which is what happens below
//   (b) hard-code a table copied out of a model file
//
// Option (a) is preferred over a hard-coded table because a wrong table is
// invisible: the motion silently animates nothing. `buildShiftJisEncoder` inverts
// Node's own ICU Shift-JIS decoder by decoding every one- and two-byte sequence
// and remembering the first bytes that produced each character. The bytes are
// therefore byte-identical to what a Shift-JIS decoder expects by construction,
// not by transcription. `--dump-table` prints them so a reviewer can check them
// by eye against any Shift-JIS chart, and the browser half independently re-reads
// the same bytes through its own TextDecoder("shift-jis") in step 3.
// ---------------------------------------------------------------------------

/**
 * Build a `character -> Shift-JIS bytes` map from a real Shift-JIS decoder.
 *
 * Node ships ICU, so `new TextDecoder('shift-jis')` is available even though the
 * matching encoder is not. Enumerating the full single- and double-byte space and
 * keeping the first encoding that decodes to a one-character string recovers the
 * encoder. Single-byte ASCII is restored explicitly afterwards, because a pair
 * like (0x41, 0x00) decodes to "A\0" and would never win the one-character test.
 *
 * @returns {Map<string, number[]>}
 */
function buildShiftJisEncoder() {
  let decoder;
  try {
    decoder = new TextDecoder('shift-jis', { fatal: false });
  } catch (error) {
    throw new Error(
      'this Node cannot decode Shift-JIS, so the VMD bone names cannot be encoded: ' + error.message,
    );
  }

  const encoder = new Map();
  for (let lead = 0x00; lead <= 0xff; lead++) {
    for (let trail = 0x00; trail <= 0xff; trail++) {
      const decoded = decoder.decode(Uint8Array.of(lead, trail));
      // One character only, and not a replacement character: anything else means
      // this byte pair is not a complete Shift-JIS character.
      if (decoded.length === 1 && decoded !== '\ufffd' && !encoder.has(decoded)) {
        encoder.set(decoded, [lead, trail]);
      }
    }
  }
  for (let byte = 0x20; byte <= 0x7e; byte++) {
    const character = String.fromCharCode(byte);
    if (!encoder.has(character)) encoder.set(character, [byte]);
  }
  return encoder;
}

/**
 * @param {Map<string, number[]>} encoder
 * @param {string} text
 * @returns {number[]} Shift-JIS bytes; throws rather than emitting '?' for a
 *   character with no mapping, because a silent substitution is exactly the
 *   failure mode this fixture exists to catch.
 */
function encodeShiftJis(encoder, text) {
  const bytes = [];
  for (const character of text) {
    const encoded = encoder.get(character);
    if (encoded === undefined) {
      throw new Error(`no Shift-JIS mapping for ${JSON.stringify(character)} in ${JSON.stringify(text)}`);
    }
    bytes.push(...encoded);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// The clip
// ---------------------------------------------------------------------------

/**
 * How long the clip runs. A VMD is 30 fps, so 30 frames is one second, and keys
 * at frame 0 and frame 30 make the clip trivially loopable.
 */
const LAST_FRAME = 30;
const FPS = 30;

/**
 * Frame numbers the clip is keyed at.
 *
 * The first and last keys hold the same rotation, so frame 30 is identical to
 * frame 0 and the clip loops seamlessly. The middle key is where the motion
 * actually happens: with three keys the clip sweeps away from rest and back, and
 * sampling midway proves the interpolation is real rather than a step. Two keys
 * with the same value would satisfy the format and animate nothing.
 */
const REST_FRAME = 0;
const PEAK_FRAME = 15;

/**
 * The bones to animate, and the exact rotation each one reaches at its peak.
 *
 * Both names are real bones of `build/fixtures/miku/miku_v2.pmd`; they were read
 * out of the PMD bone table (140 bones at file offset 608705, each a 20-byte
 * Shift-JIS name followed by parent/tail/type/IK/position) and are re-checked
 * against the loaded skeleton in step 3, so a rename in the fixture fails loudly
 * instead of producing an empty clip.
 *
 * The rotations are deliberately large and axis-aligned so the assertion in
 * step 4 is unambiguous: the bone's quaternion must turn by the full angle.
 */
const MOVES = [
  {
    name: 'センター', // model root bone: "-1" parent, so the whole body turns
    why: 'the root bone, so a wrong name would also break every child bone',
    axis: 'y',
    degrees: 60,
  },
  {
    name: '左腕', // left arm
    why: 'a mid-hierarchy limb bone, so the clip has to bind through the skeleton',
    axis: 'z',
    degrees: 90,
  },
];

/** Unit quaternion for a rotation of `degrees` around a single axis. */
function axisAngleQuaternion(axis, degrees) {
  const half = (degrees * Math.PI) / 180 / 2;
  const sin = Math.sin(half);
  return {
    x: axis === 'x' ? sin : 0,
    y: axis === 'y' ? sin : 0,
    z: axis === 'z' ? sin : 0,
    w: Math.cos(half),
  };
}

/**
 * The 64-byte interpolation block of a VMD bone keyframe.
 *
 * The block is a `[4][4][4]` table of four Bezier curves per axis, each given as
 * (x1, y1, x2, y2). It is NOT laid out in the order the curves are read:
 * `pushInterpolation` in lib/client.vendor.js reads the X curve of axis 0 from
 * bytes 0, 8, 4, 12, the X curve of axis 1 from bytes 1, 9, 5, 13, and the
 * rotation curve from bytes 3, 11, 7, 15. Writing the table out naively therefore
 * scrambles the control points across channels and produces a curve that is not
 * the one you asked for. Measured on the real loader, a naive all-20s block made
 * a 60deg sweep read 27.32deg at the quarter mark instead of 30deg — an eased
 * curve, not a linear one.
 *
 * Each entry below is written at the byte offset the loader actually reads, with
 * x1 == y1 and x2 == y2 so every channel is exactly linear from (0,0) through
 * (20/127, 20/127) to (127,127). A zeroed block is worse than wrong: every
 * control point sits at (0,0), the interpolation ratio collapses to 0, and the
 * clip snaps instead of moving.
 */
function interpolationBytes() {
  const l = 20; // linear control point, in 1/127ths
  const block = new Uint8Array(64);
  // Position curves. Axis i reads (x1, x2, y1, y2) from bytes [i, i+8, i+4, i+12],
  // so those four slots are written to hold (x1, y1, x2, y2) in read order.
  for (let axis = 0; axis < 3; axis++) {
    block[axis + 0] = l;  // x1
    block[axis + 4] = l;  // y1
    block[axis + 8] = l;  // x2
    block[axis + 12] = l; // y2
  }
  // Rotation curve: bytes 3, 11, 7, 15 hold (x1, x2, y1, y2).
  block[3] = l;  // x1
  block[7] = l;  // y1
  block[11] = l; // x2
  block[15] = l; // y2
  // Bytes 16..47 repeat the same four curves for the remaining rows, and 48..63
  // carry the physics flags, which the animation builder never reads.
  for (let row = 1; row < 3; row++) {
    for (let byte = 0; byte < 16; byte++) block[row * 16 + byte] = block[byte];
  }
  if (block.length !== 64) throw new Error(`interpolation block is ${block.length} bytes, not 64`);
  return block;
}

/**
 * @param {Map<string, number[]>} encoder
 * @returns {Buffer} a complete VMD file
 */
function buildVmd(encoder) {
  const chunks = [];
  const length = { total: 0 };

  const push = (buffer) => {
    chunks.push(buffer);
    length.total += buffer.length;
  };
  const u32 = (value) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0, 0);
    push(b);
  };
  const f32 = (value) => {
    const b = Buffer.alloc(4);
    b.writeFloatLE(value, 0);
    push(b);
  };
  /** `size` bytes of Shift-JIS, zero padded; throws if the name does not fit. */
  const sjis = (text, size) => {
    const bytes = encodeShiftJis(encoder, text);
    if (bytes.length > size) {
      throw new Error(`${JSON.stringify(text)} is ${bytes.length} Shift-JIS bytes, max ${size}`);
    }
    const b = Buffer.alloc(size);
    Buffer.from(bytes).copy(b);
    push(b);
  };

  // --- header -------------------------------------------------------------
  // 30-byte signature plus a 20-byte model name. The parser compares only the
  // first 25 signature bytes and then skips the model name blindly, but MMD
  // writes both in full and a real reader is entitled to look at them.
  const signature = 'Vocaloid Motion Data 0002';
  const signatureBytes = Buffer.alloc(30);
  signatureBytes.write(signature, 0, 'latin1');
  push(signatureBytes);
  sjis('vrmpet3d-test', 20);

  // --- bone keyframes -----------------------------------------------------
  // rest -> peak -> rest, so the clip interpolates away from the rest pose and
  // comes back to exactly where it started.
  const rest = axisAngleQuaternion('x', 0); // identity
  const frames = [];
  MOVES.forEach((move, index) => {
    const peak = axisAngleQuaternion(move.axis, move.degrees);
    frames.push({ move, index, frame: REST_FRAME, rotation: rest });
    frames.push({ move, index, frame: PEAK_FRAME, rotation: peak });
    frames.push({ move, index, frame: LAST_FRAME, rotation: rest });
  });

  u32(frames.length);
  for (const entry of frames) {
    sjis(entry.move.name, 15);
    u32(entry.frame);
    // Translations are left at zero: the loader adds them to the bone's rest
    // position, so zero means "animate the rest pose in place", which keeps the
    // assertion about rotation clean.
    f32(0); f32(0); f32(0);
    const rotation = entry.rotation;
    f32(rotation.x); f32(rotation.y); f32(rotation.z); f32(rotation.w);
    push(Buffer.from(interpolationBytes()));
  }

  // --- morph / camera / light / self-shadow / IK sections ------------------
  // All empty. Each is still written, because the parser walks them in order and
  // a missing count desynchronises everything after it.
  u32(0); // morph keyframes
  u32(0); // camera keyframes
  u32(0); // light keyframes
  u32(0); // self-shadow keyframes
  u32(0); // IK / show (property) frames

  return Buffer.concat(chunks, length.total);
}

// ---------------------------------------------------------------------------
// Step 1: write the fixture
// ---------------------------------------------------------------------------
group('1. write the fixture');
mkdirSync(OUTPUT_DIR, { recursive: true });
const encoder = buildShiftJisEncoder();
const vmd = buildVmd(encoder);

if (process.argv.includes('--dump-table')) {
  console.log('\nShift-JIS bytes, derived from Node\'s ICU decoder:');
  for (const move of MOVES) {
    const bytes = encodeShiftJis(encoder, move.name);
    console.log(`  ${JSON.stringify(move.name)} -> ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
  console.log('');
}

writeFileSync(OUTPUT, vmd);
const expectedSize = 30 + 20 + 4 + MOVES.length * 3 * 111 + 4 * 5;
ok(vmd.length === expectedSize, `the file is ${expectedSize} bytes of VMD layout`, `got ${vmd.length}`);
ok(statSync(OUTPUT).size === vmd.length, 'the bytes on disk match the bytes built in memory');
console.log(`  wrote ${OUTPUT} (${vmd.length} bytes)`);

// ---------------------------------------------------------------------------
// Step 2: parse it back in Node, structurally
//
// This is a Node-side sanity check only. `VmdObject` lives inside the browser
// chunk (it needs `TextDecoder` and is published on `__VRMPET3D_VENDOR__`), so the
// authoritative parse happens in step 3; what is checked here is that the byte
// offsets and counts match the format description, which is what makes a failure
// in step 3 diagnosable.
// ---------------------------------------------------------------------------
group('2. structural read-back in Node');

/** Minimal VMD reader; deliberately independent of the writer above. */
function readVmdBack(buffer) {
  const decoder = new TextDecoder('shift-jis');
  const trimmed = (bytes) => {
    const end = bytes.indexOf(0);
    return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
  };
  const signature = buffer.subarray(0, 30).toString('latin1').replace(/\0+$/, '');
  const modelName = trimmed(buffer.subarray(30, 50));
  let offset = 50;

  const boneCount = buffer.readUInt32LE(offset);
  offset += 4;
  const bones = [];
  for (let i = 0; i < boneCount; i++) {
    const name = trimmed(buffer.subarray(offset, offset + 15));
    const frame = buffer.readUInt32LE(offset + 15);
    const position = [0, 1, 2].map(n => buffer.readFloatLE(offset + 19 + n * 4));
    const rotation = [0, 1, 2, 3].map(n => buffer.readFloatLE(offset + 31 + n * 4));
    const interpolation = buffer.subarray(offset + 47, offset + 111);
    bones.push({ name, frame, position, rotation, interpolation });
    offset += 111;
  }

  const morphCount = buffer.readUInt32LE(offset); offset += 4;
  const morphs = [];
  for (let i = 0; i < morphCount; i++) {
    morphs.push({
      name: trimmed(buffer.subarray(offset, offset + 15)),
      frame: buffer.readUInt32LE(offset + 15),
      weight: buffer.readFloatLE(offset + 19),
    });
    offset += 23;
  }

  const cameraCount = buffer.readUInt32LE(offset); offset += 4;
  const lightCount = buffer.readUInt32LE(offset); offset += 4;
  const selfShadowCount = buffer.readUInt32LE(offset); offset += 4;
  const propertyCount = buffer.readUInt32LE(offset); offset += 4;

  return {
    signature, modelName, bones, morphs,
    cameraCount, lightCount, selfShadowCount, propertyCount,
    trailingBytes: buffer.length - offset,
  };
}

const readBack = readVmdBack(vmd);
ok(readBack.signature === 'Vocaloid Motion Data 0002',
  `the signature reads back as "Vocaloid Motion Data 0002"`, readBack.signature);
ok(readBack.modelName === 'vrmpet3d-test', 'the model name survives the Shift-JIS round trip', readBack.modelName);
ok(readBack.bones.length === MOVES.length * 3, `there are ${MOVES.length * 3} bone keyframes`, readBack.bones.length);
ok(readBack.morphs.length === 0, 'there are no morph keyframes');
ok(readBack.cameraCount === 0 && readBack.lightCount === 0 &&
  readBack.selfShadowCount === 0 && readBack.propertyCount === 0,
  'the camera, light, self-shadow and IK sections are empty');
ok(readBack.trailingBytes === 0, 'the file ends exactly where the format says it does',
  `${readBack.trailingBytes} bytes left over`);

const keysOf = (readBackBones, name, frame) => readBackBones.filter(bone => bone.name === name && bone.frame === frame);
const isClose = (actual, expected) => Math.abs(actual - expected) < 1e-6;
const rotationsMatch = (bone, expected) => isClose(bone.rotation[0], expected.x) &&
  isClose(bone.rotation[1], expected.y) && isClose(bone.rotation[2], expected.z) &&
  isClose(bone.rotation[3], expected.w);

for (const move of MOVES) {
  const mine = readBack.bones.filter(bone => bone.name === move.name);
  ok(mine.length === 3, `${JSON.stringify(move.name)} has three keyframes after the Shift-JIS round trip`, mine.length);
  ok(mine.every(bone => [REST_FRAME, PEAK_FRAME, LAST_FRAME].includes(bone.frame)),
    `${JSON.stringify(move.name)} is keyed at frames ${REST_FRAME}, ${PEAK_FRAME} and ${LAST_FRAME}`,
    mine.map(bone => bone.frame).join(','));
  ok(mine.every(bone => bone.position.every(value => value === 0)),
    `${JSON.stringify(move.name)} has no translation, only rotation`);

  const peak = axisAngleQuaternion(move.axis, move.degrees);
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  ok(keysOf(readBack.bones, move.name, REST_FRAME).every(bone => rotationsMatch(bone, identity)),
    `${JSON.stringify(move.name)} starts at the rest rotation on frame ${REST_FRAME}`);
  ok(keysOf(readBack.bones, move.name, PEAK_FRAME).every(bone => rotationsMatch(bone, peak)),
    `${JSON.stringify(move.name)} reaches ${move.degrees}deg about ${move.axis} on frame ${PEAK_FRAME}`);
  // Frame 30 identical to frame 0 is what makes the clip loop.
  ok(keysOf(readBack.bones, move.name, LAST_FRAME).every(bone => rotationsMatch(bone, identity)),
    `${JSON.stringify(move.name)} returns to the rest rotation on frame ${LAST_FRAME}, so the clip loops`);

  ok(mine.every(bone => bone.interpolation.every((byte, i) => byte === interpolationBytes()[i])),
    `${JSON.stringify(move.name)} keeps its 64 interpolation bytes`);
}

// ---------------------------------------------------------------------------
// Step 3: the real parser, the real mesh, a real browser
//
// `MMDLoader` assembles textures through `TextureLoader`, which needs a real
// `document`, so the mesh cannot be built in Node at all. The page below is
// written self-contained (vendor chunk inlined) because `--dump-dom` returns as
// soon as the document is parsed and does not wait for external `file://`
// scripts. The two fixtures are served over a loopback HTTP server instead of
// being inlined, because a `file://` page in this Chromium cannot read a sibling
// binary at all — that is why this script needs a server where
// scripts/verify-browser.mjs could get away with base64.
// ---------------------------------------------------------------------------
group('3. real parser + real skeleton, in the browser');

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Inline a script body: a literal `</script>` in the payload would close the host element. */
function inlineScript(path) {
  return readFileSync(path, 'utf8').replace(/<\/script>/gi, '<\\/script>');
}

/** The probe page, as HTML. Served from the loopback server, never written to the repo. */
function buildPage() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>pending</title></head>
<body>
<div id="out">running</div>
<script>${inlineScript(join(ROOT, 'lib', 'client.vendor.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'core.js'))}</script>
<script>
// Real MMD pipeline for the synthesized motion fixture.
//
// The vendor chunk and lib/core.js are inlined, so neither is an external script;
// the page itself is served over http://127.0.0.1 rather than loaded from
// file://, because a file:// document has an opaque origin and its fetches of the
// two fixtures are refused as cross-origin/private-network requests. Serving the
// page and the fixtures from one loopback origin removes that boundary, and lets
// the page keep the inlined scripts that --dump-dom needs. The skeleton is handed
// to the REAL buildAnimation so the bone-name matching that decides whether the
// clip does anything at all is the shipped one, not a reimplementation.
(function () {
  var V = globalThis.__VRMPET3D_VENDOR__;
  var C = globalThis.__VRMPET3D_CORE__;
  var report = { stage: 'start', errors: [] };

  function finish() {
    var out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(report);
  }

  function bail(stage, error) {
    report.stage = stage;
    report.errors.push(stage + ': ' + (error && (error.message || error)));
    finish();
  }

  // Smallest rotation that takes 'from' to 'to', in degrees. Computed from the
  // absolute dot product so the sign of the quaternion never flips the result.
  function angleBetween(from, to) {
    var dot = Math.abs(from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w);
    dot = Math.max(0, Math.min(1, dot));
    return 2 * Math.acos(dot) * 180 / Math.PI;
  }

  function snapshot(quaternion) {
    return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
  }

  if (!V || !V.MMD) { bail('vendor', new Error('__VRMPET3D_VENDOR__.MMD is missing')); return; }
  report.hasCore = Boolean(C);
  report.stages = ['vendor', 'core'];
  report.stages.push(V.MMD.VmdObject ? 'VmdObject' : 'NO-VmdObject');
  report.stages.push(V.MMD.buildAnimation ? 'buildAnimation' : 'NO-buildAnimation');
  report.stages.push(V.MMD.MMDLoader ? 'MMDLoader' : 'NO-MMDLoader');
  if (!V.MMD.VmdObject || !V.MMD.buildAnimation || !V.MMD.MMDLoader) {
    bail('vendor-exports', new Error('one of VmdObject/buildAnimation/MMDLoader is missing'));
    return;
  }

  Promise.all([
    fetch('/fixture/model.pmd').then(function (response) { return response.arrayBuffer(); }),
    // Served with Access-Control-Allow-Origin so this file:// page may read it.
    fetch('/fixture/motion.vmd').then(function (response) { return response.arrayBuffer(); }),
  ]).then(function (payloads) {
    report.stage = 'fetched';
    report.bytes = { model: payloads[0].byteLength, motion: payloads[1].byteLength };

    // Parse the motion with the real parser before the mesh exists, so a parse
    // failure is reported as a parse failure rather than as a load failure.
    var vmd;
    try {
      vmd = V.MMD.VmdObject.ParseFromBuffer(payloads[1]);
      report.stage = 'vmd-parsed';
    } catch (error) { bail('vmd-parse', error); return; }

    var keyFrames = [];
    for (var i = 0; i < vmd.boneKeyFrames.length; i++) {
      var key = vmd.boneKeyFrames.get(i);
      keyFrames.push({
        boneName: key.boneName,
        frameNumber: key.frameNumber,
        rotation: [key.rotation[0], key.rotation[1], key.rotation[2], key.rotation[3]],
      });
    }
    report.vmdKeyFrames = keyFrames;
    report.morphKeyFrameCount = vmd.morphKeyFrames.length;

    var blob = new Blob([payloads[0]], { type: 'application/octet-stream' });
    var blobUrl = URL.createObjectURL(blob);
    var loader = new V.MMD.MMDLoader();
    loader.setPath('');
    loader.resourcePath = blobUrl.slice(0, blobUrl.lastIndexOf('/') + 1);

    loader.load(blobUrl, function (result) {
      report.stage = 'mesh-loaded';
      var mesh = result.mesh;
      var boneNames = mesh.skeleton.bones.map(function (bone) { return bone.name; });
      report.boneNames = boneNames;
      report.boneCount = boneNames.length;
      report.vertexCount = mesh.geometry.attributes.position.count;

      // The real thing under test: does the shipped builder bind this VMD to
      // this skeleton, or does it silently drop the names it does not recognise?
      var clip;
      try {
        clip = V.MMD.buildAnimation(vmd, mesh);
        report.stage = 'clip-built';
      } catch (error) { bail('build-animation', error); return; }

      report.trackNames = clip.tracks.map(function (track) { return track.name; });
      report.durations = clip.tracks.map(function (track) { return track.times[track.times.length - 1]; });
      report.clipDuration = clip.duration;
      report.trackCount = clip.tracks.length;

      var targets = ['\u30bb\u30f3\u30bf\u30fc', '\u5de6\u8155']; // センター, 左腕

      // Read the rest pose BEFORE the mixer exists. clipAction() evaluates the
      // action against the root object immediately, so a snapshot taken after it
      // is already the animated pose and every "how far did it move" number comes
      // out at the peak with no way to tell that from a clip that never moved.
      var samples = targets.map(function (name) {
        var bone = mesh.skeleton.getBoneByName(name);
        return {
          name: name,
          inSkeleton: Boolean(bone),
          rest: bone ? snapshot(bone.quaternion) : null,
          positions: [],
        };
      });

      // Step the mixer and watch the bones.
      var mixer = new V.THREE.AnimationMixer(mesh);
      mixer.clipAction(clip).play();

      // A handful of frames, never a full sweep: the bones are only quaternions,
      // but this page lives next to a 12k-vertex skinned mesh and every extra
      // step is wasted headless work.
      var times = [0, 0.25, 0.5, 0.75, 1.0];
      times.forEach(function (time) {
        mixer.setTime(time);
        samples.forEach(function (sample) {
          var bone = mesh.skeleton.getBoneByName(sample.name);
          if (!bone) return;
          sample.positions.push({ time: time, quaternion: snapshot(bone.quaternion) });
        });
      });

      report.angles = samples.map(function (sample) {
        return {
          name: sample.name,
          inSkeleton: sample.inSkeleton,
          rest: sample.rest,
          fromRest: sample.positions.map(function (entry) {
            return {
              time: entry.time,
              degrees: sample.rest
                ? Number(angleBetween(sample.rest, entry.quaternion).toFixed(4))
                : null,
            };
          }),
        };
      });
      report.sampledTimes = times;
      report.stage = 'done';
      finish();
    }, undefined, function (error) { bail('mesh-load', error); });
  }).catch(function (error) { bail('fetch', error); });
})();
</script>
</body>
</html>
`;
}

/** Serve the page and the two fixtures over loopback, one origin, no files written. */
async function startFixtureServer() {
  const page = buildPage();
  const server = createServer((request, response) => {
    const path = (request.url || '').split('?')[0];
    if (path === '/' || path === '/probe.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(page);
      return;
    }
    const file = path === '/fixture/model.pmd' ? MODEL
      : path === '/fixture/motion.vmd' ? OUTPUT
        : null;
    if (file === null) {
      response.writeHead(404).end('not found');
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
      // Same origin, so CORS does not apply; the header just keeps the route
      // usable if the page is ever opened from a file:// document instead.
      'access-control-allow-origin': '*',
    });
    response.end(body);
  });
  // Not a bare `listen(0)`: the browser refuses a port on its blocked list with
  // ERR_UNSAFE_PORT, which this script would report as a fixture failure.
  await listenOnUsablePort(server);
  return server;
}

/**
 * Run the probe page once and return the dumped DOM.
 *
 * `--dump-dom` output is written to a FILE, not captured from a pipe, and that is
 * load-bearing rather than stylistic. Measured on this machine: with stdout on a
 * pipe this Edge build never finishes the dump — it sits until killed, with an
 * empty pipe, while the identical run with stdout on a file descriptor completes
 * in about a second. Piping costs a full timeout and then a bogus "no report".
 *
 * A hard timeout is not optional either, because a page that never goes idle
 * leaves the browser alive forever. The exit status is deliberately ignored: this
 * Chromium reports odd non-zero codes on runs that produced a perfectly good DOM,
 * so the DOM is the signal and the status is not.
 */
async function runBrowser(browser, url) {
  const outPath = join(tmpdir(), `vrmpet3d-motion-probe.${process.pid}.html`);
  const outFd = openSync(outPath, 'w');
  try {
    const child = spawn(browser, [
      '--headless=new',
      // SwiftShader gives a software WebGL context on a machine with no GPU
      // available to the headless process, which is the normal CI case.
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--virtual-time-budget=60000',
      // Deliberately NOT --user-data-dir: a fresh profile makes this Edge build
      // start first-run component downloads that keep the browser busy, which
      // starves --virtual-time-budget so --dump-dom never fires.
      '--dump-dom',
      url,
    ], { stdio: ['ignore', outFd, 'ignore'] });

    await new Promise((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectExit(new Error('the browser did not finish dumping the DOM within 150s'));
      }, 150000);
      child.on('error', (error) => { clearTimeout(timer); rejectExit(error); });
      child.on('exit', () => { clearTimeout(timer); resolveExit(); });
    });
    return readFileSync(outPath, 'utf8');
  } finally {
    closeSync(outFd);
    rmSync(outPath, { force: true });
  }
}

/** Run the probe, retrying once: headless Chromium is occasionally flaky here. */
async function runBrowserWithRetry(browser, url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const dom = await runBrowser(browser, url);
      if (/<div id="out">[\s\S]*?<\/div>/.test(dom)) return dom;
      lastError = new Error(`attempt ${attempt}: the dumped DOM contained no report`);
    } catch (error) {
      lastError = error;
    }
    console.error(`  attempt ${attempt} produced no report; retrying`);
  }
  throw lastError;
}

function extractReport(dom) {
  const match = /<div id="out">([\s\S]*?)<\/div>/.exec(dom);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return { stage: 'unparsable', errors: [match[1].slice(0, 300)] };
  }
}

const browser = findBrowser();
// A missing browser or model is a hard failure, not a skip: without them steps 3
// and 4 never ran, so the fixture is written but unproven.
if (!browser) {
  console.error('No Chromium-based browser found.');
  console.error('Set VRMPET3D_BROWSER to a chrome/msedge/chromium executable and retry.');
  console.error('This step is not skippable: it is the only way to run the MMD pipeline.');
  failures.push('no Chromium-based browser found (set VRMPET3D_BROWSER)');
} else if (!existsSync(MODEL)) {
  console.error(`the model fixture is missing: ${MODEL}`);
  console.error('  fetch it with: node scripts/verify-model.mjs --fetch');
  failures.push(`model fixture missing: ${MODEL}`);
} else {
  let server = null;
  let report = null;
  try {
    server = await startFixtureServer();
    const origin = `http://127.0.0.1:${server.address().port}`;
    console.log(`  browser: ${browser}`);
    console.log(`  serving ${MODEL} and ${OUTPUT}`);
    console.log(`  page:    ${origin}/probe.html`);
    const dom = await runBrowserWithRetry(browser, `${origin}/probe.html`);
    report = extractReport(dom);
  } catch (error) {
    console.error(`  browser run failed: ${error.message}`);
  } finally {
    if (server) {
      // `server.close()` only stops new connections; the browser keeps its
      // keep-alive sockets open, so awaiting the callback never resolves and the
      // process hangs with the verdict already decided. Stop accepting and drop
      // the live sockets instead, then let the process exit on its own.
      server.closeAllConnections?.();
      server.close();
    }
  }

  if (!report) {
    ok(false, 'the page produced a report', 'no <div id="out"> payload in the dumped DOM');
  } else {
    if (report.errors?.length) {
      for (const error of report.errors) console.error(`  page error: ${error}`);
    }
    ok(report.stage === 'done', `the page reached the end of the probe`, `stage=${report.stage}`);
    ok(report.hasCore === true, 'lib/core.js loaded alongside the vendor chunk');

    const boneNames = report.boneNames || [];
    const tracks = report.trackNames || [];
    console.log(`  skeleton: ${boneNames.length} bones, ${report.vertexCount} vertices`);
    console.log(`  clip: ${report.trackCount} tracks, last key at ${JSON.stringify(report.durations)}`);

    // The real parser's view of the Shift-JIS names must equal the names this
    // script encoded. If the byte table were wrong, this is where it shows.
    const parsedKeys = report.vmdKeyFrames || [];
    ok(parsedKeys.length === MOVES.length * 3,
      `VmdObject.ParseFromBuffer found ${MOVES.length * 3} bone keyframes`, parsedKeys.length);
    for (const move of MOVES) {
      const mine = parsedKeys.filter(key => key.boneName === move.name);
      ok(mine.length === 3,
        `the real parser decodes ${JSON.stringify(move.name)} from the Shift-JIS bytes`,
        JSON.stringify(parsedKeys.map(key => key.boneName)));
    }

    // Every animated bone must exist in the loaded skeleton, which is the
    // precondition for the builder keeping its tracks.
    for (const move of MOVES) {
      ok(boneNames.includes(move.name),
        `${JSON.stringify(move.name)} exists in the loaded PMD skeleton (${move.why})`);
    }

    for (const move of MOVES) {
      const expectedTracks = [
        `.bones[${move.name}].quaternion`,
        `.bones[${move.name}].position`,
      ];
      for (const track of expectedTracks) {
        ok(tracks.includes(track), `the clip has a track named ${JSON.stringify(track)}`,
          `${tracks.length} tracks: ${JSON.stringify(tracks.slice(0, 8))}`);
      }
    }
    ok(tracks.length > 0, 'the clip is not empty');

    const durations = (report.durations || []).filter(value => Number.isFinite(value));
    ok(durations.length > 0 && durations.every(value => Math.abs(value - LAST_FRAME / FPS) < 1e-6),
      `every track spans 0..${r(LAST_FRAME / FPS, 3)}s (${LAST_FRAME} frames at ${FPS} fps)`,
      JSON.stringify(report.durations));

    // The assertion this whole script exists for: the bone must actually move.
    for (const move of MOVES) {
      const angle = (report.angles || []).find(entry => entry.name === move.name);
      ok(Boolean(angle) && angle.inSkeleton === true,
        `${JSON.stringify(move.name)} was found in the skeleton for sampling`);
      if (!angle || !angle.inSkeleton) continue;

      const fromRest = angle.fromRest || [];
      const degreesAt = (time) => fromRest.find(entry => entry.time === time)?.degrees ?? null;
      const peakTime = PEAK_FRAME / FPS;

      // Framing first: the sampled pose must leave the bone exactly where it
      // started, or the "how far did it move" numbers below are measuring the
      // eval rather than the motion.
      ok(degreesAt(0) !== null && Math.abs(degreesAt(0)) < 0.01,
        `${JSON.stringify(move.name)} is at its rest rotation on frame ${REST_FRAME} `
        + `(${r(degreesAt(0), 4)}deg from rest)`);
      // The assertion this whole script exists for: at its peak the bone must be
      // the authored angle away from the rest pose. A dropped bone name yields no
      // track for it, the pose never changes, and this reads 0.
      ok(degreesAt(peakTime) !== null && Math.abs(degreesAt(peakTime) - move.degrees) < 0.01,
        `${JSON.stringify(move.name)} turns ${move.degrees}deg about ${move.axis} at frame ${PEAK_FRAME} `
        + `(${r(degreesAt(peakTime), 4)}deg from its rest pose)`);
      ok(degreesAt(1.0) !== null && Math.abs(degreesAt(1.0)) < 0.01,
        `${JSON.stringify(move.name)} is back at its rest rotation on frame ${LAST_FRAME}, so it loops `
        + `(${r(degreesAt(1.0), 4)}deg from rest)`);
      // Halfway to the peak the interpolation has to land halfway to the angle,
      // which is what proves the clip interpolates linearly instead of snapping
      // straight to the key value.
      for (const [time, fraction] of [[0.25, 0.5], [0.75, 0.5]]) {
        const expected = move.degrees * fraction;
        const actual = degreesAt(time);
        ok(actual !== null && Math.abs(actual - expected) < 1.0,
          `${JSON.stringify(move.name)} is within 1deg of ${r(expected, 3)}deg at ${time}s `
          + `(${r(actual, 4)}deg from rest)`);
      }
      // And the bone has to actually be rotating, not sitting at a constant pose.
      const travelled = Math.max(...fromRest.map(entry => entry.degrees)) -
        Math.min(...fromRest.map(entry => entry.degrees));
      ok(travelled > move.degrees * 0.9,
        `${JSON.stringify(move.name)} swings through more than 90% of its angle across the clip `
        + `(${r(travelled, 4)}deg peak-to-trough)`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(64)}`);
if (process.argv.includes('--fetch')) {
  console.log('note: --fetch is accepted for consistency with scripts/verify-model.mjs,');
  console.log('      but this fixture is synthesized, not downloaded. Nothing to fetch.');
}
if (failures.length === 0) {
  console.log(`motion: ${passed} checks passed`);
  process.exit(0);
}
console.error(`motion: ${passed} passed, ${failures.length} FAILED`);
for (const failure of failures) console.error(`  - ${failure}`);
process.exit(1);

#!/usr/bin/env node
/**
 * Synthesize a minimal VRM 1.0 model and a VRM Animation 1.0 motion, then prove
 * both really load — and that the motion really moves a bone — through the
 * plugin's own scene code in a headless Chromium.
 *
 * Run:  node scripts/make-vrma-fixtures.mjs
 *       node scripts/make-vrma-fixtures.mjs --out build/fixtures/vrma
 *       node scripts/make-vrma-fixtures.mjs --transport http|file|auto
 *       node scripts/make-vrma-fixtures.mjs --browser "C:\path\to\msedge.exe"
 *
 * Why synthesize rather than ship a model and a motion
 * ---------------------------------------------------
 * Every VRM/VRMA on the internet carries redistribution restrictions, and this
 * project deliberately ships no licensed model or motion data (see
 * docs/ASSET-CONTRACT.md). So both fixtures are built here, byte by byte, from
 * nothing: no network, no npm package, no asset. Being generated also means the
 * test can assert against *known* bone names, pose values and track names rather
 * than whatever a third party happened to export.
 *
 * Why a browser and not Node
 * --------------------------
 * `VRMLoaderPlugin` builds MToon materials, canvases and textures, and
 * `GLTFLoader.parse` needs a real `document` for any of that. There is no way to
 * run the acceptance path — `Scene.parse()` → `VRMAnimationLoaderPlugin` →
 * `createVRMAnimationClip` → `AnimationMixer` — outside an HTML engine.
 *
 * Two transports, and why
 * -----------------------
 * The fixtures are served from a loopback HTTP server, which is the intended
 * shape: the page is inlined JavaScript fetched from `http://127.0.0.1:<port>/`
 * and each fixture is a real URL the page fetches. `--transport http` requires
 * it and fails loudly if the browser cannot reach loopback.
 *
 * On this project's own Windows development host the HTTP attempt fails, and the
 * reason is worth stating precisely, because the obvious reading of it is wrong.
 *
 * The failure is **not** that this sandbox blocks loopback between processes.
 * Measured directly against a listener inside one process: launching the client
 * through `spawnSync` makes the server log **0 requests** and the child time out
 * with `ETIMEDOUT`, while launching the identical client through `spawn` gets an
 * immediate `OK` and the server logs 1 request. `spawnSync` blocks the event loop
 * for the whole child run, so the OS still completes the TCP handshake from the
 * listen backlog but this process never calls `accept()` or reads the request —
 * which is exactly the "handshake completes, no HTTP request ever arrives, curl
 * receives 0 bytes" signature. A blocking launch also explains why a *separate*
 * `curl.exe` failed at the same moment: nothing was serving while the loop was
 * held.
 *
 * Two other scripts in this repository — `scripts/vrm-probe.mjs` and
 * `scripts/verify-motion.mjs` — serve models and motions to this same headless
 * Edge over this same loopback transport and pass, because they `await` an
 * asynchronous `execFile`. So a hanging `--transport http` here says something
 * about how the browser was launched, not about the host.
 *
 * The `file` transport is still worth keeping: an inlined page avoids the
 * transport entirely, which is one less thing that can be flaky, and it is the
 * reason this generator works on a host whose browser cannot reach loopback at
 * all. But do not read a failed HTTP attempt as "loopback does not work here".
 * `--transport file` is an equal citizen: the page is still generated and run in
 * full, and the fixture bytes are still read off disk by *this* process and
 * handed to the page — they are simply not fetched over HTTP. `--transport auto`
 * (the default) tries HTTP first and falls back to `file`, and says which one it
 * used; `--transport http` refuses to fall back, so a host that *should* have
 * working loopback cannot silently pass on the weaker transport.
 *
 * The bytes are hashed on both sides in either transport, so the assertion that
 * "the model the browser parsed is the model written to disk" holds regardless
 * of how they travelled.
 *
 * What each fixture actually needed (empirically, against the vendored builds)
 * ---------------------------------------------------------------------------
 * VRMA (`VRMC_vrm_animation`, spec 1.0):
 *   mandatory — a glTF `asset.version`, a `scene` (the loader calls
 *   `gltf.scene.updateWorldMatrix`), `extensionsUsed` *containing* the extension
 *   name (the plugin returns early otherwise), `extensions.VRMC_vrm_animation`
 *   with `specVersion` in {"1.0", "1.0-draft"} and `humanoid.humanBones`
 *   (`{ name: { node } }`), plus a normal `animations` array. Each animated bone
 *   needs a node, and `hips` must be present for the retarget's parent lookup to
 *   terminate (a bone whose parent chain never reaches a declared bone falls back
 *   to `hipsParent`). A `translation` channel is only legal for `hips`.
 *   omittable — `expressions` and `lookAt` (both read through optional chaining),
 *   and the `hips` node's own `y` only has to be > 1e-3 to avoid a T-pose warning.
 *
 * VRM (`VRMC_vrm`, spec 1.0):
 *   mandatory — `asset.version`, `scenes`/`scene`, `extensionsUsed` containing
 *   `VRMC_vrm`, `extensions.VRMC_vrm` with `specVersion` in {"1.0","1.0-beta"},
 *   `humanoid.humanBones`, and a `meta` whose `licenseUrl` is exactly
 *   "https://vrm.dev/licenses/1.0/" by default (VRMMetaLoaderPlugin *throws* on
 *   any other value). `gltf.userData.vrm` — which `createVRMAnimationClip` reads
 *   for `vrm.meta.metaVersion` and `vrm.humanoid` — is only constructed when both
 *   meta and humanoid survive. All fifteen `VRMRequiredHumanBoneName` bones must
 *   resolve or `_ensureRequiredBonesExist` throws by name.
 *   omittable — every texture, every MToon material, `expressions`, `lookAt`,
 *   `firstPerson`, `VRMC_springBone` and `VRMC_node_constraint`: each plugin
 *   returns early when its extension is absent. The skin *does* have to be real
 *   (an indexed geometry with JOINTS_0/WEIGHTS_0, a `skins` entry with
 *   `joints` + `inverseBindMatrices`, and weight-bearing entries in the first
 *   joint slot) because `Scene.installAvatar` measures the mesh and
 *   `VRMUtils.removeUnnecessaryVertices`/`combineSkeletons` rebuild the skeleton
 *   from the skin attributes.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { listenOnUsablePort } from './loopback.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const OUT_DIR = resolve(argValue('--out', join(ROOT, 'build', 'fixtures', 'vrma')));
const OUT_VRM = join(OUT_DIR, 'pet3d-minimal.vrm');
const OUT_VRMA = join(OUT_DIR, 'pet3d-test.vrma');
/**
 * The generated WAVE. It exists to prove the other direction of the same pipeline: not "a hand-written
 * clip loads" but "a clip produced by a generator (the shape a text-to-motion tool emits) plays on a real
 * model and moves its bones". `--out` moves all three together.
 */
const OUT_WAVE = join(OUT_DIR, 'pet3d-wave.vrma');
/** The resting pose: arms down, elbows and fingers relaxed, the body turning slowly. See uildRestVrma. */
const OUT_REST = join(OUT_DIR, 'pet3d-rest.vrma');
/**
 * The manifest written beside the clips, declaring which of them play ONCE.
 *
 * The name is the HOST's (`MOTION_MANIFEST_FILE` in `lib/index.js`) and is spelled out here rather than
 * imported, because this script is deliberately standalone — it needs only the GLB machinery, so importing
 * the host half (which pulls in the settings store, the launcher and the model parser) to learn one file name
 * would be a poor trade. `verify-model.mjs` asserts the two spellings are equal, so a rename cannot drift.
 */
export const MOTION_MANIFEST_FILE = 'pet3d-motions.json';
const TRANSPORT = argValue('--transport', 'auto');

/** Candidate Chromium-based browsers, matching scripts/verify-browser.mjs. */
const BROWSER_CANDIDATES = [
  argValue('--browser', null),
  process.env.PET3D_BROWSER,
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
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GLB assembly
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67; // bytes 'g' 'l' 'T' 'F'
const CHUNK_JSON = 0x4e4f534a; // bytes 'J' 'S' 'O' 'N'
const CHUNK_BIN = 0x004e4942; // bytes 'B' 'I' 'N' 0x00

/**
 * Pad a chunk to a 4-byte boundary.
 *
 * The chunk's own `chunkLength` must be a multiple of 4, and the *padding* is
 * part of it: JSON pads with spaces so a strict JSON reader still parses it, BIN
 * pads with zeroes. Getting this wrong makes the file a few bytes short and the
 * loader reads the next chunk header out of the middle of a float.
 */
function padTo4(buffer, fill) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

/**
 * Wrap a glTF JSON document and its binary payload in a GLB container.
 *
 * @param {object} json
 * @param {Buffer} binary
 * @returns {Buffer}
 */
function buildGlb(json, binary) {
  const jsonChunk = padTo4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = padTo4(binary, 0x00);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
}

/**
 * A BIN chunk that hands out bufferViews as it goes.
 *
 * Each `add` aligns its view to 4 bytes first, so no accessor can end up with an
 * offset that is illegal for its component type — the alignment rule is the one
 * a hand-built GLB gets wrong most easily.
 */
class BinChunk {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.views = [];
  }

  add(buffer) {
    const padding = (4 - (this.length % 4)) % 4;
    if (padding) {
      this.parts.push(Buffer.alloc(padding));
      this.length += padding;
    }
    const byteOffset = this.length;
    this.parts.push(buffer);
    this.length += buffer.length;
    this.views.push({ buffer: 0, byteOffset, byteLength: buffer.length });
    return this.views.length - 1;
  }

  toBuffer() {
    return Buffer.concat(this.parts, this.length);
  }
}

/** Pack numbers as little-endian float32 / uint16. */
function f32(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function u16(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

/** A glTF quaternion rotates by `angle` about an axis, as [x, y, z, w]. */
function quatAxis(axis, angle) {
  const half = angle / 2;
  const sine = Math.sin(half);
  if (axis === 'x') return [sine, 0, 0, Math.cos(half)];
  if (axis === 'y') return [0, sine, 0, Math.cos(half)];
  return [0, 0, sine, Math.cos(half)];
}

/** FNV-1a, 32-bit. Used on both sides to prove the bytes round-tripped. */
function hash32(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash ^ bytes[i]) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Part A — the .vrma
// ---------------------------------------------------------------------------

/**
 * A 1.0-second (30 frames at 30 fps) VRM Animation 1.0 document.
 *
 * Timeline: keys at t = 0, 0.5, 1.0 with the first and last key identical, so the
 * clip loops without a seam. Three bones are declared: `hips`, `spine` and
 * `head`. `spine` carries no channel — it is there so the retarget's
 * `VRMHumanBoneParentMap` walk for `head` finds a *declared* ancestor instead of
 * falling through to `hipsParent`, and so the node hierarchy matches the bones
 * the extension names.
 *
 * @returns {Buffer} a complete .vrma
 */
export function buildVrma() {
  // Rotations are authored in the animation's own world space; the loader
  // conjugates them by the bone's rest world rotation, which is identity here.
  const hipsRotation = [
    ...quatAxis('y', 0),
    ...quatAxis('y', 0.35),
    ...quatAxis('y', 0),
  ];
  const headRotation = [
    ...quatAxis('x', 0),
    ...quatAxis('x', 0.30),
    ...quatAxis('x', 0),
  ];
  // Only `hips` may carry a translation channel; the rest of the body has to be
  // driven by rotation alone or the loader warns and drops the track. The rest
  // height (0.7) is what `createVRMAnimationClip` scales the track by against the
  // model's own `normalizedRestPose.hips.position[1]`.
  const hipsTranslation = [0, 0.7, 0, 0, 0.72, 0, 0, 0.7, 0];
  const times = [0, 0.5, 1.0];

  const bin = new BinChunk();
  const timesView = bin.add(f32(times));
  const hipsRotationView = bin.add(f32(hipsRotation));
  const hipsTranslationView = bin.add(f32(hipsTranslation));
  const headRotationView = bin.add(f32(headRotation));

  const json = {
    asset: {
      version: '2.0',
      generator: 'dsh-plugin-pet3d scripts/make-vrma-fixtures.mjs',
    },
    scene: 0,
    scenes: [{ name: 'pet3d-test', nodes: [0] }],
    nodes: [
      { name: 'hips', translation: [0, 0.7, 0], children: [1] },
      { name: 'spine', translation: [0, 0.15, 0], children: [2] },
      { name: 'head', translation: [0, 0.45, 0] },
    ],
    // `extensionsUsed` is load-bearing, not decoration: VRMAnimationLoaderPlugin
    // returns immediately when the extension is not listed here *before* it ever
    // looks at `extensions`.
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        // "1.0" is the current released spec. "1.0-draft" is the only other value
        // the pinned parser accepts, and it logs a warning, so a fixture that
        // targeted it would ship a warning by design.
        specVersion: '1.0',
        humanoid: {
          humanBones: {
            hips: { node: 0 },
            spine: { node: 1 },
            head: { node: 2 },
          },
        },
      },
    },
    animations: [
      {
        name: 'pet3d-test',
        samplers: [
          { input: 0, output: 1, interpolation: 'LINEAR' },
          { input: 0, output: 2, interpolation: 'LINEAR' },
          { input: 0, output: 3, interpolation: 'LINEAR' },
        ],
        // Channel order is significant: GLTFLoader emits one track per channel in
        // this order, and VRMAnimationLoaderPlugin zips `channels[i]` with
        // `tracks[i]`. Reordering one without the other silently retargets the
        // wrong bone.
        channels: [
          { sampler: 0, target: { node: 0, path: 'rotation' } },
          { sampler: 1, target: { node: 0, path: 'translation' } },
          { sampler: 2, target: { node: 2, path: 'rotation' } },
        ],
      },
    ],
    accessors: [
      {
        bufferView: timesView,
        componentType: 5126,
        count: times.length,
        type: 'SCALAR',
        // min/max are required on animation input accessors by the glTF spec.
        min: [times[0]],
        max: [times[times.length - 1]],
      },
      { bufferView: hipsRotationView, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: hipsTranslationView, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: headRotationView, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.length }],
  };

  return buildGlb(json, bin.toBuffer());
}

/** Quaternion product `a * b`, both as [x, y, z, w]. Order matters: glTF applies the left one last. */
function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/**
 * A two-second WAVE, authored the way a text-to-motion model would emit one.
 *
 * This is the fixture for "can the pipeline carry a generated VRMA end to end", so it is written from
 * first principles rather than copied from the test clip:
 *
 *   * **In place.** The only translation channel glTF allows here targets `hips`, and a wave does not need
 *     one — but it carries one held exactly at [0, 0.7, 0], because `createVRMAnimationClip` scales that
 *     track to the model's own hips height (`humanoidY / restHipsPosition.y`). A constant rest height,
 *     scaled that way, lands back on the model's rest position on a taller or shorter model.
 *   * **World-aligned axes, so the file is model-agnostic.** `VRMHumanoidRig._setupTransforms` builds the
 *     normalized rig from the raw bones' WORLD positions and leaves every normalized node's rotation at
 *     identity, so a rotation on `rightUpperArm` is about a world axis carried by its animated parent.
 *     Raising the arm is therefore a rotation about **Z**, with no per-model bone-axis guessing.
 *   * **Loop-exact.** Every track is a function of `sin` of `2*pi*1.5*t` over exactly three cycles in
 *     2.0 s, so t=0 and t=2 carry the same value and the clip repeats without a seam.
 *
 * Shape: the right arm lifts ~66 degrees out to the side (-1.15 rad about Z takes the right arm from -X to
 * mostly +Y), the forearm swings +-26 degrees about the same axis three times, the hand follows a little
 * later, and the spine and head lean in so the body is not a statue.
 *
 * @returns {Buffer} a GLB containing one `VRMC_vrm_animation` animation.
 */
export function buildWaveVrma() {
  const FPS = 30;
  const SECONDS = 2;
  const CYCLES = 3;
  const keys = SECONDS * FPS + 1;
  const times = [];
  for (let i = 0; i < keys; i++) times.push(i / FPS);

  const hipsRotation = [];
  const hipsTranslation = [];
  const spineRotation = [];
  const upperArmRotation = [];
  const lowerArmRotation = [];
  const handRotation = [];
  const headRotation = [];
  for (let i = 0; i < keys; i++) {
    const phase = (2 * Math.PI * CYCLES * i) / (FPS * SECONDS);
    // The arm is held up; the oscillation on top of it swings the whole limb, not just the wrist.
    const lift = -1.15 + 0.10 * Math.sin(phase);
    // Per-bone phase lags: the forearm leads, the hand trails it, the body trails everything.
    const bend = -0.30 + 0.45 * Math.sin(phase);
    const wrist = 0.20 * Math.sin(phase - 0.6);
    const lean = 0.03 * Math.sin(phase - 0.4);
    const headTilt = 0.05 * Math.sin(phase - 0.9);

    hipsRotation.push(0, 0, 0, 1);
    hipsTranslation.push(0, 0.7, 0);
    spineRotation.push(...quatAxis('z', lean));
    upperArmRotation.push(...quatAxis('z', lift));
    lowerArmRotation.push(...quatAxis('z', bend));
    handRotation.push(...quatAxis('z', wrist));
    // Yaw toward the raised arm, plus a small tilt in the same rhythm.
    headRotation.push(...quatMul(quatAxis('y', 0.15), quatAxis('z', headTilt)));
  }

  const bin = new BinChunk();
  const timesView = bin.add(f32(times));
  const hipsRotationView = bin.add(f32(hipsRotation));
  const hipsTranslationView = bin.add(f32(hipsTranslation));
  const spineRotationView = bin.add(f32(spineRotation));
  const upperArmRotationView = bin.add(f32(upperArmRotation));
  const lowerArmRotationView = bin.add(f32(lowerArmRotation));
  const handRotationView = bin.add(f32(handRotation));
  const headRotationView = bin.add(f32(headRotation));

  const NODES = [
    { key: 'hips', name: 'hips', translation: [0, 0.7, 0], parent: -1 },
    { key: 'spine', name: 'spine', translation: [0, 0.15, 0], parent: 0 },
    { key: 'head', name: 'head', translation: [0, 0.45, 0], parent: 1 },
    { key: 'rightUpperArm', name: 'rightUpperArm', translation: [-0.16, 0, 0], parent: 1 },
    { key: 'rightLowerArm', name: 'rightLowerArm', translation: [-0.25, 0, 0], parent: 3 },
    { key: 'rightHand', name: 'rightHand', translation: [-0.25, 0, 0], parent: 4 },
  ];
  const index = {};
  NODES.forEach((node, at) => { index[node.key] = at; });
  const nodes = NODES.map((node) => {
    const out = { name: node.name, translation: node.translation.slice() };
    const children = [];
    for (let at = 0; at < NODES.length; at++) {
      if (NODES[at].parent === index[node.key]) children.push(at);
    }
    if (children.length) out.children = children;
    return out;
  });

  const json = {
    asset: {
      version: '2.0',
      generator: 'dsh-plugin-pet3d scripts/make-vrma-fixtures.mjs (wave)',
    },
    scene: 0,
    scenes: [{ name: 'pet3d-wave', nodes: [0] }],
    nodes,
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: {
          humanBones: {
            hips: { node: index.hips },
            spine: { node: index.spine },
            head: { node: index.head },
            rightUpperArm: { node: index.rightUpperArm },
            rightLowerArm: { node: index.rightLowerArm },
            rightHand: { node: index.rightHand },
          },
        },
      },
    },
    animations: [
      {
        name: 'pet3d-wave',
        samplers: [
          { input: 0, output: 1, interpolation: 'LINEAR' },
          { input: 0, output: 2, interpolation: 'LINEAR' },
          { input: 0, output: 3, interpolation: 'LINEAR' },
          { input: 0, output: 4, interpolation: 'LINEAR' },
          { input: 0, output: 5, interpolation: 'LINEAR' },
          { input: 0, output: 6, interpolation: 'LINEAR' },
          { input: 0, output: 7, interpolation: 'LINEAR' },
        ],
        // Channel order is significant: GLTFLoader emits one track per channel in this order and
        // VRMAnimationLoaderPlugin zips `channels[i]` with `tracks[i]`.
        channels: [
          { sampler: 0, target: { node: index.hips, path: 'rotation' } },
          { sampler: 1, target: { node: index.hips, path: 'translation' } },
          { sampler: 2, target: { node: index.spine, path: 'rotation' } },
          { sampler: 3, target: { node: index.rightUpperArm, path: 'rotation' } },
          { sampler: 4, target: { node: index.rightLowerArm, path: 'rotation' } },
          { sampler: 5, target: { node: index.rightHand, path: 'rotation' } },
          { sampler: 6, target: { node: index.head, path: 'rotation' } },
        ],
      },
    ],
    accessors: [
      {
        bufferView: timesView,
        componentType: 5126,
        count: times.length,
        type: 'SCALAR',
        min: [times[0]],
        max: [times[times.length - 1]],
      },
      { bufferView: hipsRotationView, componentType: 5126, count: keys, type: 'VEC4' },
      { bufferView: hipsTranslationView, componentType: 5126, count: keys, type: 'VEC3' },
      { bufferView: spineRotationView, componentType: 5126, count: keys, type: 'VEC4' },
      { bufferView: upperArmRotationView, componentType: 5126, count: keys, type: 'VEC4' },
      { bufferView: lowerArmRotationView, componentType: 5126, count: keys, type: 'VEC4' },
      { bufferView: handRotationView, componentType: 5126, count: keys, type: 'VEC4' },
      { bufferView: headRotationView, componentType: 5126, count: keys, type: 'VEC4' },
    ],
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.length }],
  };

  return buildGlb(json, bin.toBuffer());
}

/**
 * A RESTING pose, the one a pet sits in when nothing is happening: both arms hanging naturally, elbows and
 * fingers relaxed and slightly bent, and the body turning very slowly.
 *
 * Authored from the rig's geometry rather than by feel, because the axes are known exactly:
 * `VRMHumanoidRig._setupTransforms` leaves every normalized node's rotation at identity, so a rotation is
 * about a WORLD axis carried by the parent. A VRM rests in a T-pose (arms along ±X, left = +X), which fixes
 * every sign below:
 *
 *   * **Arms down** = a rotation about Z: (−1,0,0) rotated by +80° goes to y = −sin 80°, i.e. hanging, and
 *     (1,0,0) needs −80° — so LEFT is the negative side of every axis in this file and RIGHT the positive one.
 *   * **Elbows** bend slightly FORWARD: after the shoulder swing the carried Y axis is roughly the world X
 *     axis, and rotating about it moves a hanging forearm toward ±Z — the same left-negative rule.
 *   * **Fingers** curl toward the palm, which after the arms come down faces the body: also Z, also
 *     left-negative — the same sign as the shoulder swing, which is why the whole mirror is one rule.
 *   * **The body turn** is a slow yaw of hips/spine with the head lagging behind it, one full cycle over the
 *     clip so the loop has no seam.
 *
 * The sway bones are sampled every 0.2 s and the held ones carry two keys, so a 6-second clip is a few
 * kilobytes instead of a megabyte: the motion is far slower than the frame rate, and LINEAR keys between
 * those samples are indistinguishable from denser ones.
 *
 * @returns {Buffer} a GLB containing one `VRMC_vrm_animation` animation.
 */
export function buildRestVrma() {
  const SECONDS = 6;
  const SAMPLES = 31;
  const deg = (value) => (value * Math.PI) / 180;
  // Apply Z first, then Y (quaternion products act right-to-left), so the shoulder swing happens in the
  // frontal plane and the forward tilt is applied to the already-lowered arm.
  const tilt = (yDegrees, zDegrees) => quatMul(quatAxis('y', deg(yDegrees)), quatAxis('z', deg(zDegrees)));

  const denseTimes = [];
  for (let i = 0; i < SAMPLES; i++) denseTimes.push(Number(((i * SECONDS) / (SAMPLES - 1)).toFixed(4)));
  const heldTimes = [0, SECONDS];

  const nodes = [];
  const indexOf = {};
  const addNode = (name, parent) => {
    indexOf[name] = nodes.length;
    nodes.push({ name, parent: parent === undefined ? -1 : indexOf[parent] });
    return name;
  };
  // Plausible offsets, mirroring a VRM skeleton. Only `hips` matters on the way in (the loader reads it as
  // `restHipsPosition` and scales the translation track by it); the rest are there so the file is readable.
  addNode('hips');
  addNode('spine', 'hips');
  addNode('chest', 'spine');
  addNode('head', 'chest');
  const fingerTable = [
    ['ThumbMetacarpal', 12, 0, 0],
    ['ThumbProximal', 10, 0, 0],
    ['ThumbDistal', 16, 0, 0],
    ['IndexProximal', 18, 0, 0],
    ['IndexIntermediate', 0, 26, 0],
    ['IndexDistal', 0, 0, 20],
    ['MiddleProximal', 20, 0, 0],
    ['MiddleIntermediate', 0, 30, 0],
    ['MiddleDistal', 0, 0, 22],
    ['RingProximal', 18, 0, 0],
    ['RingIntermediate', 0, 28, 0],
    ['RingDistal', 0, 0, 20],
    ['LittleProximal', 15, 0, 0],
    ['LittleIntermediate', 0, 24, 0],
    ['LittleDistal', 0, 0, 18],
  ];
  for (const side of ['left', 'right']) {
    const upper = side + 'UpperArm';
    addNode(upper, 'chest');
    addNode(side + 'LowerArm', upper);
    addNode(side + 'Hand', side + 'LowerArm');
    let parent = side + 'Hand';
    for (const [finger] of fingerTable) {
      const bone = side + finger;
      addNode(bone, parent);
      parent = bone;
    }
  }

  // Every channel is built here, in order, and the samplers, accessors and channels are emitted from this one
  // list — the file's channel order has to match the track order the loader zips it with.
  const channels = [];
  const rotation = (bone, times, values) => channels.push({ node: bone, path: 'rotation', times, values });
  const translation = (bone, times, values) => channels.push({ node: bone, path: 'translation', times, values });

  // The swaying bones: one slow cycle, sampled, so every value is complete before any channel is created.
  const SWAY_ORDER = ['hips', 'spine', 'chest', 'head',
    'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm'];
  const swayValues = {};
  for (const bone of SWAY_ORDER) swayValues[bone] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const phase = (2 * Math.PI * denseTimes[i]) / SECONDS;
    const sway = Math.sin(phase);
    const lag = Math.sin(phase - 0.7);
    // The pelvis turns, the chest turns a little less the other way, the head lags behind both: a weight
    // shift rather than a turntable. Small amplitudes on purpose — this is a pet standing still.
    const spineYaw = -1.5 * sway;
    swayValues.hips.push(...quatMul(quatAxis('y', deg(2.5 * sway)), quatAxis('z', deg(0.6 * Math.sin(phase - 0.5)))));
    swayValues.spine.push(...quatMul(quatAxis('y', deg(spineYaw)), quatAxis('z', deg(0.8 * Math.sin(phase - 0.6)))));
    swayValues.chest.push(...quatMul(quatAxis('y', deg(-spineYaw * 0.5)), quatAxis('z', deg(0.4 * Math.sin(phase - 0.7)))));
    swayValues.head.push(...quatMul(quatAxis('y', deg(1.6 * Math.sin(phase - 0.9))), quatAxis('z', deg(0.5 * Math.sin(phase - 1.2)))));
    // Arms hang 80 degrees from the T-pose and swing with the body, a little late.
    const armSway = 1.2 * lag;
    swayValues.leftUpperArm.push(...tilt(-8, -(80 + armSway)));
    swayValues.leftLowerArm.push(...tilt(-14 + 0.6 * lag, -6 - 0.4 * lag));
    swayValues.rightUpperArm.push(...tilt(8, 80 + armSway));
    swayValues.rightLowerArm.push(...tilt(14 - 0.6 * lag, 6 + 0.4 * lag));
  }
  for (const bone of SWAY_ORDER) rotation(bone, denseTimes, swayValues[bone]);

  // The held half of the pose: two keys each, because none of it moves.
  rotation('leftHand', heldTimes, [...tilt(-4, -5), ...tilt(-4, -5)]);
  rotation('rightHand', heldTimes, [...tilt(4, 5), ...tilt(4, 5)]);
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    for (const [finger, proximal, middle, distal] of fingerTable) {
      const angle = proximal || middle || distal;
      const pose = tilt(sign * angle * 0.25, sign * angle);
      rotation(side + finger, heldTimes, [...pose, ...pose]);
    }
  }
  // The hips hold their rest height: a constant here, scaled by the loader to the model's own proportions,
  // lands exactly on the model's rest position whatever its size (see the wave's note).
  translation('hips', heldTimes, [0, 0.7, 0, 0, 0.7, 0]);
  const bin = new BinChunk();
  const samplers = [];
  const accessors = [];
  const views = [];
  for (const channel of channels) {
    const inputView = bin.add(f32(channel.times));
    const outputView = bin.add(f32(channel.values));
    const inputAccessor = accessors.length;
    accessors.push({
      bufferView: inputView,
      componentType: 5126,
      count: channel.times.length,
      type: 'SCALAR',
      min: [channel.times[0]],
      max: [channel.times[channel.times.length - 1]],
    });
    const outputAccessor = accessors.length;
    accessors.push({
      bufferView: outputView,
      componentType: 5126,
      count: channel.values.length / (channel.path === 'rotation' ? 4 : 3),
      type: channel.path === 'rotation' ? 'VEC4' : 'VEC3',
    });
    views.push(inputView, outputView);
    samplers.push({ input: inputAccessor, output: outputAccessor, interpolation: 'LINEAR' });
  }

  const humanBones = {};
  for (const node of nodes) humanBones[node.name] = { node: indexOf[node.name] };
  const json = {
    asset: {
      version: '2.0',
      generator: 'dsh-plugin-pet3d scripts/make-vrma-fixtures.mjs (rest)',
    },
    scene: 0,
    scenes: [{ name: 'pet3d-rest', nodes: [0] }],
    nodes: nodes.map((node) => {
      const out = { name: node.name };
      if (node.name === 'hips') out.translation = [0, 0.7, 0];
      else if (node.name === 'spine') out.translation = [0, 0.15, 0];
      else if (node.name === 'chest') out.translation = [0, 0.12, 0];
      else if (node.name === 'head') out.translation = [0, 0.35, 0];
      else if (/UpperArm$/.test(node.name)) out.translation = [node.name.startsWith('left') ? 0.16 : -0.16, 0, 0];
      else if (/LowerArm$/.test(node.name)) out.translation = [node.name.startsWith('left') ? 0.25 : -0.25, 0, 0];
      else if (/Hand$/.test(node.name)) out.translation = [node.name.startsWith('left') ? 0.25 : -0.25, 0, 0];
      else out.translation = [node.name.startsWith('left') ? 0.03 : -0.03, 0, 0];
      const children = [];
      for (let at = 0; at < nodes.length; at++) {
        if (nodes[at].parent === indexOf[node.name]) children.push(at);
      }
      if (children.length) out.children = children;
      return out;
    }),
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones },
      },
    },
    animations: [
      {
        name: 'pet3d-rest',
        samplers,
        channels: channels.map((channel, at) => ({
          sampler: at,
          target: { node: indexOf[channel.node], path: channel.path },
        })),
      },
    ],
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.length }],
  };

  return buildGlb(json, bin.toBuffer());
}

/**
 * The bones a generated gesture may move: hips → spine → chest → head, plus one arm chain per side.
 *
 * Deliberately the resting pose's skeleton MINUS the thirty finger joints. A gesture moves the body, and
 * leaving the fingers out keeps each file a few kilobytes; the fingers a clip does not mention keep whatever
 * the procedural idle gives them. `hips` is the root, and it always carries a translation track, because
 * `createVRMAnimationClip` scales that track by `humanoidY / restHipsPosition.y` — a constant rest height
 * lands exactly on the model's own rest position whatever its proportions (see the wave's note).
 */
const GESTURE_BONES = [
  ['hips', -1, [0, 0.7, 0]],
  ['spine', 'hips', [0, 0.15, 0]],
  ['chest', 'spine', [0, 0.12, 0]],
  ['head', 'chest', [0, 0.35, 0]],
  ['leftUpperArm', 'chest', [0.16, 0, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.25, 0, 0]],
  ['leftHand', 'leftLowerArm', [0.25, 0, 0]],
  ['rightUpperArm', 'chest', [-0.16, 0, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.25, 0, 0]],
  ['rightHand', 'rightLowerArm', [-0.25, 0, 0]],
];

/** Degrees to radians, and the two quaternion helpers every pose below is written with. */
const gestureDeg = (value) => (value * Math.PI) / 180;

/**
 * Build one gesture VRMA from a pose function.
 *
 * `spec.pose(phase, helpers)` is called once per frame with `phase` running 0 → 2π across the clip and
 * returns `{ rotations: { bone: quaternion }, translations: { hips: [x, y, z] } }`. Every bone in
 * `GESTURE_BONES` gets a rotation channel whether the pose names it or not (identity when it does not), so
 * the pivot rig is complete and a clip that moves three joints still leaves the other seven at rest.
 *
 * A LOOPING gesture is written as a function of `sin`/`cos` of `phase`, so the last frame equals the first
 * and the loop has no seam — the same rule the wave and rest clips follow. A one-shot gesture is free to end
 * somewhere else, which is what makes it worth declaring as one.
 *
 * @param {{name: string, seconds: number, pose: Function}} spec
 * @returns {Buffer} a GLB containing one `VRMC_vrm_animation` animation.
 */
export function buildGestureVrma(spec) {
  const FPS = 30;
  const frames = Math.max(2, Math.round(spec.seconds * FPS) + 1);
  const times = [];
  for (let i = 0; i < frames; i++) {
    times.push(Number(((i * spec.seconds) / (frames - 1)).toFixed(4)));
  }

  const nodes = [];
  const indexOf = {};
  for (const [name, parent, offset] of GESTURE_BONES) {
    indexOf[name] = nodes.length;
    nodes.push({ name, parent: parent === -1 ? -1 : indexOf[parent], offset });
  }

  const rotations = {};
  for (const [name] of GESTURE_BONES) rotations[name] = [];
  const hipsTranslation = [];
  for (let i = 0; i < frames; i++) {
    const phase = (2 * Math.PI * i) / (frames - 1);
    const pose = spec.pose(phase, {
      deg: gestureDeg,
      axis: quatAxis,
      mul: quatMul,
      seconds: spec.seconds,
    }) || {};
    const named = pose.rotations || {};
    for (const [name] of GESTURE_BONES) {
      const quaternion = named[name] || [0, 0, 0, 1];
      rotations[name].push(...quaternion);
    }
    const hips = (pose.translations || {}).hips || [0, 0.7, 0];
    hipsTranslation.push(...hips);
  }

  const bin = new BinChunk();
  const channels = [{ node: 'hips', path: 'translation', times, values: hipsTranslation }];
  for (const [name] of GESTURE_BONES) {
    channels.push({ node: name, path: 'rotation', times, values: rotations[name] });
  }

  const accessors = [];
  const samplers = [];
  for (const channel of channels) {
    const inputView = bin.add(f32(channel.times));
    const outputView = bin.add(f32(channel.values));
    const inputAccessor = accessors.length;
    accessors.push({
      bufferView: inputView,
      componentType: 5126,
      count: channel.times.length,
      type: 'SCALAR',
      min: [channel.times[0]],
      max: [channel.times[channel.times.length - 1]],
    });
    const outputAccessor = accessors.length;
    accessors.push({
      bufferView: outputView,
      componentType: 5126,
      count: channel.values.length / 4,
      type: 'VEC4',
    });
    samplers.push({ input: inputAccessor, output: outputAccessor, interpolation: 'LINEAR' });
  }

  const humanBones = {};
  for (const [name] of GESTURE_BONES) humanBones[name] = { node: indexOf[name] };
  const json = {
    asset: {
      version: '2.0',
      generator: 'dsh-plugin-pet3d scripts/make-vrma-fixtures.mjs (gesture)',
    },
    scene: 0,
    scenes: [{ name: spec.name, nodes: [0] }],
    nodes: nodes.map((node) => {
      const out = { name: node.name, translation: node.offset.slice() };
      const children = [];
      for (let at = 0; at < nodes.length; at++) {
        if (nodes[at].parent === indexOf[node.name]) children.push(at);
      }
      if (children.length) out.children = children;
      return out;
    }),
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones },
      },
    },
    animations: [
      {
        name: spec.name,
        samplers,
        channels: channels.map((channel, at) => ({
          sampler: at,
          target: { node: indexOf[channel.node], path: channel.path },
        })),
      },
    ],
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.length }],
  };

  return buildGlb(json, bin.toBuffer());
}

/**
 * The gestures this generator ships, as a table.
 *
 * They exist so the per-state motion LIST has something to draw from: a state with three idle clips does not
 * loop the same six seconds forever, which is the whole point of several clips per state. Each pose is
 * written in the same world-axis language as the wave and the rest clip — a hanging arm is
 * `leftUpperArm: z(-80°)`, because a VRM rests in a T-pose and the normalized rig carries world axes — so a
 * gesture is portable between models for the same reason those two are.
 *
 * `loop: false` here is not decoration: it is what the generator writes into the directory's manifest, and
 * the host turns it into `LoopOnce`. A reaction that loops waves at the user forever.
 */
const GESTURE_TABLE = [
  {
    file: 'pet3d-look-around.vrma',
    name: 'pet3d-look-around',
    seconds: 5,
    loop: true,
    note: '慢速张望：头 ±25° 偏航，胸与胯反向跟随，手臂自然下垂',
    pose: (phase, h) => {
      const yaw = Math.sin(phase);
      const lag = Math.sin(phase - 0.5);
      return {
        rotations: {
          hips: h.axis('y', h.deg(3 * yaw)),
          spine: h.axis('y', h.deg(6 * yaw)),
          chest: h.axis('y', h.deg(-4 * yaw)),
          head: h.mul(h.axis('y', h.deg(25 * lag)), h.axis('z', h.deg(2 * lag))),
          leftUpperArm: h.axis('z', h.deg(-80 + 1.5 * yaw)),
          leftLowerArm: h.axis('z', h.deg(-6)),
          rightUpperArm: h.axis('z', h.deg(80 - 1.5 * yaw)),
          rightLowerArm: h.axis('z', h.deg(6)),
          leftHand: h.axis('z', h.deg(-4)),
          rightHand: h.axis('z', h.deg(4)),
        },
      };
    },
  },
  {
    file: 'pet3d-weight-shift.vrma',
    name: 'pet3d-weight-shift',
    seconds: 6,
    loop: true,
    note: '换重心：胯横向 0.03 单位摆动，上身与头滞后，手臂随身体轻摆',
    pose: (phase, h) => {
      const sway = Math.sin(phase);
      const lag = Math.sin(phase - 0.7);
      return {
        rotations: {
          hips: h.mul(h.axis('y', h.deg(2.5 * sway)), h.axis('z', h.deg(0.6 * Math.sin(phase - 0.5)))),
          spine: h.axis('y', h.deg(-1.5 * sway)),
          chest: h.axis('y', h.deg(0.8 * sway)),
          head: h.mul(h.axis('y', h.deg(1.6 * lag)), h.axis('z', h.deg(0.5 * Math.sin(phase - 1.2)))),
          leftUpperArm: h.axis('z', h.deg(-80 - 1.2 * lag)),
          leftLowerArm: h.axis('z', h.deg(-6 - 0.4 * lag)),
          rightUpperArm: h.axis('z', h.deg(80 + 1.2 * lag)),
          rightLowerArm: h.axis('z', h.deg(6 + 0.4 * lag)),
        },
        translations: { hips: [0.03 * sway, 0.7, 0] },
      };
    },
  },
  {
    file: 'pet3d-stretch.vrma',
    name: 'pet3d-stretch',
    seconds: 4,
    loop: true,
    note: '伸展：双臂抬到水平以上（最高 +20°），身体上提 0.02 单位再落下',
    pose: (phase, h) => {
      // 0 → 1 → 0 over the clip, so the arms are back at rest when it loops.
      const reach = (1 - Math.cos(phase)) / 2;
      return {
        rotations: {
          hips: h.axis('z', h.deg(1.5 * reach)),
          spine: h.axis('z', h.deg(-2 * reach)),
          chest: h.axis('z', h.deg(-3 * reach)),
          head: h.mul(h.axis('y', h.deg(4 * reach)), h.axis('z', h.deg(-6 * reach))),
          leftUpperArm: h.axis('z', h.deg(-80 + 100 * reach)),
          leftLowerArm: h.mul(h.axis('y', h.deg(-8 * reach)), h.axis('z', h.deg(-4))),
          rightUpperArm: h.axis('z', h.deg(80 - 100 * reach)),
          rightLowerArm: h.mul(h.axis('y', h.deg(8 * reach)), h.axis('z', h.deg(4))),
          leftHand: h.axis('z', h.deg(-4)),
          rightHand: h.axis('z', h.deg(4)),
        },
        translations: { hips: [0, 0.7 + 0.02 * reach, 0] },
      };
    },
  },
  {
    file: 'pet3d-happy-hop.vrma',
    name: 'pet3d-happy-hop',
    seconds: 2,
    loop: false,
    note: '成功：跳一下（胯上提 0.12 单位）、双臂上摆，落下后归位 —— 一次性',
    pose: (phase, h) => {
      const t = phase / (2 * Math.PI);
      // One hop inside the first 60% of the clip, then a small settle: a one-shot may end anywhere, and
      // ending near the rest pose is what makes handing the pose back invisible.
      const hop = t < 0.6 ? Math.sin(Math.PI * (t / 0.6)) : 0;
      const settle = t >= 0.6 ? Math.sin(((t - 0.6) / 0.4) * Math.PI) : 0;
      return {
        rotations: {
          hips: h.axis('z', h.deg(2 * hop - 1.5 * settle)),
          spine: h.axis('z', h.deg(-3 * hop)),
          chest: h.axis('z', h.deg(-4 * hop)),
          head: h.mul(h.axis('y', h.deg(4 * hop)), h.axis('z', h.deg(-5 * hop))),
          leftUpperArm: h.axis('z', h.deg(-80 + 60 * hop + 8 * settle)),
          leftLowerArm: h.mul(h.axis('y', h.deg(-12 * hop)), h.axis('z', h.deg(-6))),
          rightUpperArm: h.axis('z', h.deg(80 - 60 * hop - 8 * settle)),
          rightLowerArm: h.mul(h.axis('y', h.deg(12 * hop)), h.axis('z', h.deg(6))),
          leftHand: h.axis('z', h.deg(-4)),
          rightHand: h.axis('z', h.deg(4)),
        },
        translations: { hips: [0, 0.7 + 0.12 * hop, 0] },
      };
    },
  },
];

/**
 * The directory manifest written beside the generated clips.
 *
 * It declares the two clips that must play ONCE — the wave and the hop. Without it every generated clip
 * would loop, which for a wave means waving forever: the exact failure the flag exists to prevent.
 */
const GESTURE_MANIFEST = {
  clips: {
    'pet3d-wave.vrma': { loop: false },
    'pet3d-happy-hop.vrma': { loop: false },
  },
};

/**
 * The fifteen bones `VRMHumanoidLoaderPlugin._ensureRequiredBonesExist` refuses
 * to load a VRM 1.0 without. This list is not a stylistic choice: it is
 * `Object.values(VRMRequiredHumanBoneName)` in the vendored build, and a model
 * missing any one of them throws with the missing names joined by ", ".
 */
const REQUIRED_HUMAN_BONES = [
  'hips', 'spine', 'head',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
];

/**
 * The humanoid skeleton. Index 0 is the skin's root; every bone has an identity
 * rotation, so a joint's world position is simply the sum of its ancestors'
 * translations and the inverse bind matrix is that sum negated.
 */
const VRM_BONES = [
  { name: 'hips', parent: -1, translation: [0, 0.70, 0] },
  { name: 'spine', parent: 0, translation: [0, 0.15, 0] },
  { name: 'head', parent: 1, translation: [0, 0.45, 0] },
  { name: 'leftUpperLeg', parent: 0, translation: [0.09, 0, 0] },
  { name: 'leftLowerLeg', parent: 3, translation: [0, -0.35, 0] },
  { name: 'leftFoot', parent: 4, translation: [0, -0.35, 0] },
  { name: 'rightUpperLeg', parent: 0, translation: [-0.09, 0, 0] },
  { name: 'rightLowerLeg', parent: 6, translation: [0, -0.35, 0] },
  { name: 'rightFoot', parent: 7, translation: [0, -0.35, 0] },
  { name: 'leftUpperArm', parent: 1, translation: [0.16, 0, 0] },
  { name: 'leftLowerArm', parent: 9, translation: [0.25, 0, 0] },
  { name: 'leftHand', parent: 10, translation: [0.25, 0, 0] },
  { name: 'rightUpperArm', parent: 1, translation: [-0.16, 0, 0] },
  { name: 'rightLowerArm', parent: 12, translation: [-0.25, 0, 0] },
  { name: 'rightHand', parent: 13, translation: [-0.25, 0, 0] },
];

/** The single skinned box that stands in for a body, in mesh-node local space. */
const BODY_POSITIONS = [
  [-0.20, 0.00, -0.10], [0.20, 0.00, -0.10], [0.20, 0.00, 0.10], [-0.20, 0.00, 0.10],
  [-0.20, 1.30, -0.10], [0.20, 1.30, -0.10], [0.20, 1.30, 0.10], [-0.20, 1.30, 0.10],
];

const BODY_INDICES = [
  0, 2, 1, 0, 3, 2, // bottom
  4, 5, 6, 4, 6, 7, // top
  0, 4, 7, 0, 7, 3, // left
  1, 2, 6, 1, 6, 5, // right
  0, 1, 5, 0, 5, 4, // back
  3, 7, 6, 3, 6, 2, // front
];

/**
 * Spring-bone chains and morph targets, so the fixture can prove what reads them.
 *
 * Two features need this data to exist: the host's model-info route (expressions and spring groups,
 * read straight out of the file) and the renderer, which applies per-group stiffness/drag/gravity and
 * expression weights. The morph targets are deliberately UNNAMED — the model that drove the feature
 * (蓝色小肥鱼.vrm) does not name them either, so the VRM expression table is the only thing that says
 * what target #0 means, and that is the path the tests have to take.
 *
 * The two chains carry DIFFERENT physics values on purpose: an implementation that applied one
 * group's settings to every joint would pass with identical numbers and fail here.
 */
const VRM_SPRINGS = [
  {
    name: 'hair',
    // `parent` is an index into VRM_BONES (2 = head); the rest is each node's own translation.
    parent: 2,
    nodes: [
      { name: 'hair', translation: [0, 0.08, -0.06] },
      { name: 'hair_mid', translation: [0, -0.05, -0.01] },
      { name: 'hair_end', translation: [0, -0.05, 0] },
    ],
    joints: [
      { hitRadius: 0.02, stiffness: 0.4, dragForce: 0.3, gravityPower: 0.02 },
      { hitRadius: 0.02, stiffness: 0.4, dragForce: 0.3, gravityPower: 0.02 },
      // The terminal entry: it is a TAIL, never a joint of its own, but a VRM 1.0 chain has to list
      // it or the consumer's pairing loop yields one fewer joint than the chain has bones.
      { hitRadius: 0.02, stiffness: 0.4, dragForce: 0.3, gravityPower: 0.02 },
    ],
    colliderGroups: [0],
  },
  {
    name: 'tail',
    parent: 0,
    nodes: [
      { name: 'tail', translation: [0, 0.05, 0.09] },
      { name: 'tail_end', translation: [0, -0.06, 0.02] },
    ],
    joints: [
      { hitRadius: 0.03, stiffness: 1.6, dragForce: 0.6, gravityPower: 0.05 },
      { hitRadius: 0.03, stiffness: 1.6, dragForce: 0.6, gravityPower: 0.05 },
    ],
    colliderGroups: [],
  },
];

/** Morph-target position deltas for the body box: three expressions' worth, in bind order. */
const VRM_MORPH_DELTAS = [
  // blink: squash the top of the box down
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.06, 0, 0, -0.06, 0, 0, -0.06, 0, 0, -0.06, 0],
  // happy: widen the top
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.02, 0, -0.03, 0.02, 0, -0.03, 0.02, 0, 0.03, 0.02, 0],
  // wag: lean the whole box sideways
  [-0.02, 0, 0, -0.02, 0, 0, -0.02, 0, 0, -0.02, 0, 0, 0.02, 0, 0, 0.02, 0, 0, 0.02, 0, 0, 0.02, 0, 0],
];

/**
 * A minimal, texture-free, expression-free VRM 1.0.
 *
 * The body is one indexed box bound to the `hips` and `spine` joints — enough for
 * `combineSkeletons` to have a real two-bone skeleton to rebuild and for the
 * plugin's framing to measure a non-degenerate height, without a single byte of
 * texture data.
 *
 * @returns {Buffer} a complete .vrm
 */
export function buildVrm() {
  const jointCount = VRM_BONES.length;
  const meshNode = jointCount; // the body node follows the bones in the node list

  // World positions: every bone rotation is identity, and parents always precede
  // children in the table, so one forward pass is exact.
  const worldPositions = [];
  for (let i = 0; i < VRM_BONES.length; i++) {
    const bone = VRM_BONES[i];
    const parent = bone.parent >= 0 ? worldPositions[bone.parent] : [0, 0, 0];
    worldPositions.push([
      parent[0] + bone.translation[0],
      parent[1] + bone.translation[1],
      parent[2] + bone.translation[2],
    ]);
  }

  // A column-major glTF MAT4 with identity rotation and translation -world.
  const inverseBind = [];
  for (const position of worldPositions) {
    inverseBind.push(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -position[0], -position[1], -position[2], 1,
    );
  }

  // Normals point away from the box centre so the box is lit rather than flat
  // black; vertices 0-3 sit on `hips`, 4-7 on `spine`, each with weight 1.
  const centre = [0, 0.65, 0];
  const normals = [];
  for (const position of BODY_POSITIONS) {
    const dx = position[0] - centre[0];
    const dy = position[1] - centre[1];
    const dz = position[2] - centre[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    normals.push(dx / length, dy / length, dz / length);
  }

  // JOINTS_0 indexes into `skin.joints`, not into the glTF node list.
  const joints = [];
  const weights = [];
  for (let i = 0; i < BODY_POSITIONS.length; i++) {
    const slot = i < 4 ? 0 : 1; // 0 = hips, 1 = spine
    joints.push(slot, 0, 0, 0);
    weights.push(1, 0, 0, 0);
  }

  const bin = new BinChunk();
  const positionView = bin.add(f32(BODY_POSITIONS.flat()));
  const normalView = bin.add(f32(normals));
  const jointsView = bin.add(u16(joints));
  const weightsView = bin.add(f32(weights));
  const indexView = bin.add(u16(BODY_INDICES));
  const inverseBindView = bin.add(f32(inverseBind));
  const morphViews = VRM_MORPH_DELTAS.map((deltas) => bin.add(f32(deltas)));
  // Morph-target POSITION accessors need min/max, exactly like the base POSITION accessor.
  const morphAccessors = VRM_MORPH_DELTAS.map((deltas, index) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < deltas.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], deltas[i + axis]);
        max[axis] = Math.max(max[axis], deltas[i + axis]);
      }
    }
    return {
      bufferView: morphViews[index],
      componentType: 5126,
      count: BODY_POSITIONS.length,
      type: 'VEC3',
      min,
      max,
    };
  });

  const children = VRM_BONES.map(() => []);
  for (let i = 0; i < VRM_BONES.length; i++) {
    if (VRM_BONES[i].parent >= 0) children[VRM_BONES[i].parent].push(i);
  }

  // Spring chains: each joint owns the NEXT node as its tail, which is how VRM 1.0 gives a joint its
  // length and what three-vrm builds the joint from. The chain's first node hangs off a humanoid bone,
  // so the hair follows the head and the tail follows the hips.
  const springNodes = [];
  const springs = [];
  let nextNode = jointCount + 1; // the body node occupies jointCount
  for (const spring of VRM_SPRINGS) {
    const indices = spring.nodes.map(() => nextNode++);
    spring.nodes.forEach((node, index) => {
      const entry = { name: node.name, translation: node.translation.slice() };
      if (index + 1 < spring.nodes.length) entry.children = [indices[index + 1]];
      springNodes.push(entry);
    });
    children[spring.parent].push(indices[0]);
    springs.push({
      name: spring.name,
      joints: spring.joints.map((joint, index) => ({
        node: indices[index],
        hitRadius: joint.hitRadius,
        stiffness: joint.stiffness,
        dragForce: joint.dragForce,
        gravityPower: joint.gravityPower,
        gravityDir: [0, -1, 0],
      })),
      colliderGroups: spring.colliderGroups,
    });
  }

  const nodes = VRM_BONES.map((bone, index) => {
    const node = { name: bone.name, translation: bone.translation.slice() };
    if (children[index].length) node.children = children[index];
    return node;
  });
  nodes.push({ name: 'Pet3DFixtureBody', mesh: 0, skin: 0 });
  springNodes.forEach((node) => nodes.push(node));

  const humanBones = {};
  for (let i = 0; i < VRM_BONES.length; i++) humanBones[VRM_BONES[i].name] = { node: i };

  const json = {
    asset: {
      version: '2.0',
      generator: 'dsh-plugin-pet3d scripts/make-vrma-fixtures.mjs',
    },
    scene: 0,
    scenes: [{ name: 'Pet3DFixtureScene', nodes: [0, meshNode] }],
    nodes,
    meshes: [
      {
        name: 'pet3d-fixture-mesh',
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              JOINTS_0: 2,
              WEIGHTS_0: 3,
            },
            indices: 4,
            material: 0,
            mode: 4,
            // Three morph targets, referencing the POSITION accessors that follow the six above.
            targets: morphViews.map((_, index) => ({ POSITION: 6 + index })),
          },
        ],
      },
    ],
    skins: [
      {
        name: 'pet3d-fixture-skin',
        skeleton: 0,
        joints: VRM_BONES.map((_, index) => index),
        inverseBindMatrices: 5,
      },
    ],
    materials: [
      {
        name: 'pet3d-fixture-material',
        pbrMetallicRoughness: {
          baseColorFactor: [0.85, 0.55, 0.35, 1],
          metallicFactor: 0,
          roughnessFactor: 0.85,
        },
        doubleSided: false,
      },
    ],
    // VRMC_springBone is a TOP-LEVEL extension (not part of VRMC_vrm), which is why the fixture
    // declares both and the readers have to look in two places.
    extensionsUsed: ['VRMC_vrm', 'VRMC_springBone'],
    extensions: {
      VRMC_vrm: {
        // "1.0-beta" is the only other value the pinned VRMHumanoidLoaderPlugin /
        // VRMMetaLoaderPlugin accept. "1.0" is what the released spec says.
        specVersion: '1.0',
        meta: {
          name: 'pet3d minimal fixture',
          version: '1.0',
          authors: ['dsh-plugin-pet3d scripts/make-vrma-fixtures.mjs'],
          // Not cosmetic: VRMMetaLoaderPlugin throws unless this exact URL is in
          // its acceptLicenseUrls (which defaults to this one value).
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'everyone',
          allowRedistribution: true,
          modification: 'allowModification',
        },
        humanoid: { humanBones },
        /**
         * Expressions, bound by NODE + target index, exactly as a VRM 1.0 exporter writes them.
         *
         * `surprised` is declared and empty on purpose: the model that drove this feature does the
         * same thing, so a reader that assumes every expression has a bind has to fail here. The
         * morph targets themselves are unnamed, which is why the bind is the only way to know that
         * target #0 is `blink`.
         */
        expressions: {
          preset: {
            blink: { morphTargetBinds: [{ node: meshNode, index: 0, weight: 1 }] },
            happy: { morphTargetBinds: [{ node: meshNode, index: 1, weight: 1 }] },
            surprised: {},
          },
          custom: {
            wag: { morphTargetBinds: [{ node: meshNode, index: 2, weight: 1 }] },
          },
        },
      },
      VRMC_springBone: {
        specVersion: '1.0',
        springs,
        colliders: [
          { node: 2, shape: { sphere: { radius: 0.05, offset: [0, 0, 0] } } },
        ],
        colliderGroups: [{ colliders: [0] }],
      },
    },
    accessors: [
      {
        bufferView: positionView,
        componentType: 5126,
        count: BODY_POSITIONS.length,
        type: 'VEC3',
        // POSITION accessors must declare min/max.
        min: [-0.20, 0.00, -0.10],
        max: [0.20, 1.30, 0.10],
      },
      { bufferView: normalView, componentType: 5126, count: BODY_POSITIONS.length, type: 'VEC3' },
      { bufferView: jointsView, componentType: 5123, count: BODY_POSITIONS.length, type: 'VEC4' },
      { bufferView: weightsView, componentType: 5126, count: BODY_POSITIONS.length, type: 'VEC4' },
      { bufferView: indexView, componentType: 5123, count: BODY_INDICES.length, type: 'SCALAR' },
      { bufferView: inverseBindView, componentType: 5126, count: jointCount, type: 'MAT4' },
      ...morphAccessors,
    ],
    bufferViews: bin.views,
    buffers: [{ byteLength: bin.length }],
  };

  return buildGlb(json, bin.toBuffer());
}

// ---------------------------------------------------------------------------
// The probe body. Runs inside the page, with the real lib/ sources inlined.
//
// Written without template literals of its own on purpose: it is embedded in
// one, and only the `${...}` holes this file deliberately leaves open are
// substituted.
// ---------------------------------------------------------------------------
const PROBE = `
(function () {
  var report = { checks: [], errors: [], info: {} };
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
    document.title = report.ok ? 'VRMA-OK' : 'VRMA-FAIL';
  }
  function round(value) { return Number(value.toFixed(6)); }
  // FNV-1a, matching the implementation in the host script.
  function hash32(bytes) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      hash = (hash ^ bytes[i]) >>> 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  var EXPECTED = ${JSON.stringify({})};
  var V = globalThis.__PET3D_VENDOR__;
  var C = globalThis.__PET3D_CORE__;
  // lib/pet3d.js has published the scene as both the bare constructor and, in
  // later revisions, as a namespace object carrying it under a Scene key.
  // Accept both so this probe does not break on a purely internal refactor.
  var SCENE_GLOBAL = globalThis.__PET3D_SCENE__;
  var Scene = (SCENE_GLOBAL && SCENE_GLOBAL.Scene) || SCENE_GLOBAL;
  report.info.sceneGlobalShape = SCENE_GLOBAL && SCENE_GLOBAL.Scene ? 'namespace.Scene' : 'constructor';
  check('vendor chunk, core and scene are present', function () {
    return Boolean(V && C) && typeof Scene === 'function';
  });
  if (!V || !C || typeof Scene !== 'function') { finish(); return; }

  var REQUIRED_BONES = ${JSON.stringify(REQUIRED_HUMAN_BONES)};

  var SIZE = 256;
  var canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  document.body.appendChild(canvas);

  var scene = new Scene(canvas, {
    assetBase: '/asset',
    modelId: 'pet3d-minimal',
    onError: function (message) { report.errors.push('scene.onError: ' + message); }
  });
  scene.resize(SIZE, SIZE);

  // The bytes arrive either from the loopback server or, when the host cannot
  // load http:// at all, from the base64 the host read off disk. Either way the
  // hash below proves it is the same file.
  function loadBytes(url) {
    var inlined = globalThis.__PET3D_FIXTURE_BASE64__;
    if (inlined && inlined[url]) {
      var binary = atob(inlined[url]);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return Promise.resolve(bytes.buffer);
    }
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error(url + ' HTTP ' + response.status);
      return response.arrayBuffer();
    });
  }

  var vrmBytes = null;
  var vrmaBytes = null;

  loadBytes('/fixtures/pet3d-minimal.vrm')
    .then(function (buffer) {
      vrmBytes = buffer;
      return loadBytes('/fixtures/pet3d-test.vrma');
    })
    .then(function (buffer) {
      // ---- 1. the bytes the page holds are the bytes on disk ---------------
      vrmaBytes = buffer;
      report.info.vrmBytes = vrmBytes.byteLength;
      report.info.vrmaBytes = vrmaBytes.byteLength;
      report.info.vrmHash = hash32(new Uint8Array(vrmBytes)) >>> 0;
      report.info.vrmaHash = hash32(new Uint8Array(vrmaBytes)) >>> 0;
      report.info.vrmFormat = C.detectFormat(vrmBytes);
      report.info.vrmaFormat = C.detectFormat(vrmaBytes);
      report.info.vrmaMotionFormat = C.detectMotionFormat(vrmaBytes);
      report.info.vrmMotionFormat = C.detectMotionFormat(vrmBytes);

      check('both fixtures are GLB containers by magic bytes', function () {
        return report.info.vrmFormat === 'glb' && report.info.vrmaFormat === 'glb';
      });
      check('the model bytes match the file the host wrote', function () {
        return report.info.vrmHash === EXPECTED.vrmHash && report.info.vrmBytes === EXPECTED.vrmBytes;
      });
      check('the motion bytes match the file the host wrote', function () {
        return report.info.vrmaHash === EXPECTED.vrmaHash && report.info.vrmaBytes === EXPECTED.vrmaBytes;
      });
      check('core.detectMotionFormat calls the .vrma a motion', function () {
        return report.info.vrmaMotionFormat === 'vrma';
      });
      // The two formats are byte-identical in their header; only the extension in
      // the JSON chunk separates them, so this is a real discrimination test.
      check('core.detectMotionFormat does NOT call the .vrm a motion', function () {
        return report.info.vrmMotionFormat === 'unknown';
      });

      // ---- 2. the VRM through the plugin's own scene code -------------------
      var started = performance.now();
      return scene.parse(vrmBytes, 'pet3d-minimal').then(function (parsed) {
        report.info.parseMs = Math.round(performance.now() - started);
        report.info.parseResult = parsed;
        check('scene.parse() reported success', function () { return parsed.ok === true; });
        check('scene.parse() reported format glb', function () { return parsed.format === 'glb'; });
        check('scene.parse() reported kind vrm', function () { return parsed.kind === 'vrm'; });
        check('scene.kind agrees it is a vrm', function () { return scene.kind === 'vrm'; });
        return parsed;
      });
    })
    .then(function () {
      var avatar = scene.avatar;
      var vrm = avatar && avatar.vrm;
      var root = avatar && avatar.root;

      report.info.avatarKind = avatar ? avatar.kind : null;
      report.info.hasVrmInstance = Boolean(vrm);
      report.info.hasAvatarRoot = Boolean(root);
      check('an avatar root and a VRM instance were installed', function () {
        return Boolean(root && vrm);
      });
      if (!root || !vrm) { finish(); return; }

      // The plugin's own bone bag, built by wrapVRM from getNormalizedBoneNode.
      var sceneBones = avatar.bones || {};
      report.info.sceneAvatarBones = Object.keys(sceneBones).join(',');
      check('the scene resolved hips, spine and head for its motion applier', function () {
        return Boolean(sceneBones.hips && sceneBones.spine && sceneBones.head);
      });

      // And every bone VRM 1.0 requires, straight off the humanoid.
      var resolved = [];
      var missing = [];
      REQUIRED_BONES.forEach(function (name) {
        var node = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(name);
        if (node) { resolved.push(name); } else { missing.push(name); }
      });
      report.info.humanoidBonesResolved = resolved.length;
      report.info.humanoidBonesMissing = missing.join(',');
      check('all 15 required humanoid bones resolved', function () { return missing.length === 0; });

      report.info.metaVersion = vrm.meta ? vrm.meta.metaVersion : null;
      report.info.metaName = vrm.meta ? vrm.meta.name : null;
      check('meta survived the official loader as a VRM 1.0 meta', function () {
        return Boolean(vrm.meta) && vrm.meta.metaVersion === '1';
      });

      report.info.hasSkinnedMesh = false;
      report.info.skinJoints = 0;
      root.traverse(function (object) {
        if (object.isSkinnedMesh) {
          report.info.hasSkinnedMesh = true;
          report.info.skinJoints = object.skeleton ? object.skeleton.bones.length : 0;
        }
      });
      check('the model has a real skinned mesh with a bound skeleton', function () {
        return report.info.hasSkinnedMesh && report.info.skinJoints > 0;
      });

      // ---- 3. the VRMA parses and retargets ---------------------------------
      var loader = new V.addons.GLTFLoader();
      loader.register(function (parser) { return new V.VRM.VRMAnimationLoaderPlugin(parser); });
      return new Promise(function (resolve, reject) {
        loader.parse(vrmaBytes, '', function (gltf) { resolve(gltf); }, function (error) { reject(error); });
      }).then(function (gltf) {
        var animations = gltf.userData.vrmAnimations;
        report.info.vrmAnimationCount = Array.isArray(animations) ? animations.length : 0;
        check('gltf.userData.vrmAnimations is a non-empty array', function () {
          return Array.isArray(animations) && animations.length > 0;
        });
        if (!Array.isArray(animations) || !animations.length) { finish(); return; }

        var vrmAnimation = animations[0];
        report.info.animationDuration = round(vrmAnimation.duration);
        report.info.animationRestHipsY = round(vrmAnimation.restHipsPosition.y);
        report.info.animationRotationBones = Array.from(vrmAnimation.humanoidTracks.rotation.keys()).join(',');
        report.info.animationTranslationBones = Array.from(vrmAnimation.humanoidTracks.translation.keys()).join(',');
        check('the animation carries the rotation bones the file declared', function () {
          var names = Array.from(vrmAnimation.humanoidTracks.rotation.keys());
          return names.indexOf('hips') !== -1 && names.indexOf('head') !== -1;
        });
        check('the hips translation track retargeted', function () {
          return vrmAnimation.humanoidTracks.translation.has('hips');
        });
        check('duration is the authored 1.0 s', function () {
          return Math.abs(vrmAnimation.duration - 1.0) < 1e-6;
        });

        var clip = V.VRM.createVRMAnimationClip(vrmAnimation, vrm);
        report.info.clipName = clip.name;
        report.info.clipDuration = round(clip.duration);
        report.info.clipTrackCount = clip.tracks.length;
        report.info.clipTracks = clip.tracks.map(function (track) { return track.name; });
        check('createVRMAnimationClip produced real tracks', function () {
          return clip.tracks.length >= 2;
        });
        // A track named after a node that is not under the mixer root binds to
        // nothing, so naming is asserted rather than assumed.
        check('the tracks are named after the normalized humanoid rig', function () {
          var names = report.info.clipTracks.join(' ');
          return names.indexOf('Normalized_hips.quaternion') !== -1
            && names.indexOf('Normalized_head.quaternion') !== -1;
        });

        // ---- 4. the clip actually moves a bone ------------------------------
        var THREE = V.THREE;
        var humanoid = vrm.humanoid;
        var hipsNormalized = humanoid.getNormalizedBoneNode('hips');
        var headNormalized = humanoid.getNormalizedBoneNode('head');
        var hipsRaw = humanoid.getRawBoneNode('hips');

        var restHips = hipsNormalized.quaternion.clone();
        var restHead = headNormalized.quaternion.clone();
        var restHipsRaw = hipsRaw.quaternion.clone();

        var mixer = new THREE.AnimationMixer(root);
        var action = mixer.clipAction(clip);
        action.play();

        // Seven samples across the authored timeline. A clip whose tracks bind to
        // nothing leaves every quaternion exactly at rest, which is the failure
        // this whole check exists to catch.
        var samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9];
        var maxHips = 0;
        var maxHead = 0;
        var maxRawHips = 0;
        var atTime = 0;
        for (var i = 0; i < samples.length; i++) {
          mixer.setTime(samples[i]);
          // The normalized rig is the mixer's target; the raw humanoid bones only
          // follow it when the humanoid itself is updated, exactly as the plugin
          // would on a frame.
          humanoid.update();
          var hipsAngle = hipsNormalized.quaternion.angleTo(restHips);
          var headAngle = headNormalized.quaternion.angleTo(restHead);
          var rawAngle = hipsRaw.quaternion.angleTo(restHipsRaw);
          if (hipsAngle > maxHips) { maxHips = hipsAngle; atTime = samples[i]; }
          if (headAngle > maxHead) { maxHead = headAngle; }
          if (rawAngle > maxRawHips) { maxRawHips = rawAngle; }
        }
        report.info.hipsNormalizedMaxAngleRad = round(maxHips);
        report.info.headNormalizedMaxAngleRad = round(maxHead);
        report.info.rawHipsMaxAngleRad = round(maxRawHips);
        report.info.rotationPeakAtSeconds = atTime;

        check('the clip rotates the normalized hips bone away from rest', function () {
          return maxHips > 0.15;
        });
        check('the clip rotates the normalized head bone away from rest', function () {
          return maxHead > 0.15;
        });
        check('the pose reaches the raw humanoid bone the mesh is skinned to', function () {
          return maxRawHips > 0.15;
        });

        // ---- 5. the model renders -------------------------------------------
        var ticked = check('scene.tick() advanced and rendered a frame', function () {
          scene.tick(1 / 30);
          return scene.frame > 0;
        });

        if (ticked) {
          var gl = scene.renderer.getContext();
          var width = gl.drawingBufferWidth;
          var height = gl.drawingBufferHeight;
          var pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          var covered = 0;
          for (var p = 3; p < pixels.length; p += 4) {
            if (pixels[p] > 8) covered += 1;
          }
          report.info.renderedPixels = width * height;
          report.info.coveredPixels = covered;
          report.info.coveragePercent = round(covered / (width * height) * 100);
          check('the synthesized VRM rendered a visible silhouette', function () {
            return covered > width * height * 0.01;
          });
        }

        finish();
      });
    })
    .catch(function (error) {
      report.errors.push('probe: ' + (error && (error.message || error)));
      check('the fixtures loaded through the real scene', function () { return false; });
      finish();
    });
})();
`;

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------
function inlineScript(path) {
  const source = readFileSync(path, 'utf8');
  // A `</script>` inside the payload would close the host element early.
  return source.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * A last-resort reporter, installed before anything else runs.
 *
 * Without it a probe that dies during setup leaves `<div id="out">running…</div>`
 * behind and the only evidence is an absent report. `--dump-dom` does not print
 * the console, so the failure has to be routed back through the report element
 * to be visible at all.
 */
const ERROR_TRAP = `
(function () {
  function publish(what, detail) {
    var out = document.getElementById('out');
    if (!out) return;
    var report = { ok: false, checks: [], errors: [what + ': ' + detail] };
    out.textContent = JSON.stringify(report);
    document.title = 'VRMA-THREW';
  }
  window.addEventListener('error', function (event) {
    publish('uncaught', (event.message || '') + ' @' + (event.filename || '') + ':' + (event.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    publish('unhandled rejection', String(reason && (reason.stack || reason.message || reason)));
  });
})();
`;

/**
 * @param {string} probe the probe source, already carrying its `EXPECTED` values
 * @param {string} fixtureScript an optional `<script>` that publishes the fixture
 *   bytes as base64, used only by the `file` transport
 */
function buildPage(probe, fixtureScript) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>pending</title></head>
<body>
<div id="out">running…</div>
<script>${ERROR_TRAP.replace(/<\/script>/gi, '<\\/script>')}</script>
${fixtureScript}
<script>${inlineScript(join(ROOT, 'lib', 'client.vendor.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'core.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'placeholder.js'))}</script>
<script>${inlineScript(join(ROOT, 'lib', 'pet3d.js'))}</script>
<script>${probe.replace(/<\/script>/gi, '<\\/script>')}</script>
</body>
</html>
`;
}

function renderProbe(expected) {
  return PROBE.replace('var EXPECTED = {};', `var EXPECTED = ${JSON.stringify(expected)};`);
}

function extractReport(dom) {
  const match = /<div id="out">([\s\S]*?)<\/div>/.exec(dom);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Why a probe that loaded still produced nothing.
 *
 * `--dump-dom` returns the document as it stands when the virtual time budget
 * expires, so a page that threw during setup, or whose asynchronous half never
 * settled, comes back with `<div id="out">running…</div>` and no other clue.
 * Reporting the title and the start of the report turns that into a diagnosis.
 */
function describeNonReport(dom) {
  const title = /<title>([\s\S]*?)<\/title>/.exec(dom);
  const out = /<div id="out">([\s\S]{0,300})/.exec(dom);
  return `title=${JSON.stringify(title ? title[1] : null)} out=${JSON.stringify(out ? out[1] : null)}`;
}

// ---------------------------------------------------------------------------
// Browser plumbing
// ---------------------------------------------------------------------------

/**
 * Chromium switches shared by both transports.
 *
 * `--user-data-dir` is pinned to a throwaway directory rather than left to the
 * default profile. Without it a headless launch can be handed off to an
 * already-running browser (the user's own, or a previous probe that is stuck),
 * which turns "the page did not load" into "the browser never started".
 * `--timeout` on the spawn is the other half of that guard: a navigation that
 * never completes has to become an error the host can act on, not a hang.
 */
function browserArgs(profileDir) {
  return [
    '--headless=new',
    // SwiftShader gives a software WebGL2 context on a machine with no GPU
    // available to the headless process, which is the normal CI case.
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    `--user-data-dir=${profileDir}`,
    '--virtual-time-budget=60000',
    '--dump-dom',
  ];
}

/** Kill only the browser processes this run created, matched by profile path. */
function killBrowser(profileDir) {
  const pattern = profileDir.replace(/\\/g, '\\\\');
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${pattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
      { stdio: 'ignore', timeout: 30000 });
  } catch {
    // Nothing to clean up, or no PowerShell; either way it is not fatal.
  }
}

function runBrowser(browser, url, profileDir, timeoutMs) {
  try {
    return {
      ok: true,
      dom: execFileSync(browser, [...browserArgs(profileDir), url], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
      }),
    };
  } catch (error) {
    // Chromium explains itself on stderr and nowhere else, so an ignored stderr
    // turns a diagnosable failure into "Command failed". It is also extremely
    // chatty, so only the first couple of lines survive, trimmed.
    const stderr = String(error.stderr || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 2)
      .map(line => (line.length > 140 ? line.slice(0, 140) + '…' : line))
      .join(' | ');
    return { ok: false, error: error.message.split('\n')[0], stderr };
  } finally {
    killBrowser(profileDir);
  }
}

function sleepSync(ms) {
  // No subprocess and no timer: a synchronous sleep keeps this a plain script
  // and works identically on every platform.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write a file, surviving Synology Drive's intermittent `ReplaceFileW EIO`.
 *
 * This repository lives inside a Synology Drive folder, where consecutive rapid
 * writes to the same path occasionally fail with EIO or "file changed since
 * read". The file is not corrupt and the write succeeds on a retry, so a fixture
 * generator that gave up on the first EIO would be flaky for a reason that has
 * nothing to do with the fixtures.
 */
function writeStable(path, buffer) {
  const delays = [0, 2000, 8000, 8000];
  let lastError = null;
  for (const delay of delays) {
    if (delay) sleepSync(delay);
    try {
      writeFileSync(path, buffer);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('No Chromium-based browser found.');
    console.error('Set PET3D_BROWSER or pass --browser <chrome|msedge|chromium> and retry.');
    return 2;
  }

  // 1. Write both fixtures.
  mkdirSync(OUT_DIR, { recursive: true });
  writeStable(OUT_VRMA, buildVrma());
  writeStable(OUT_VRM, buildVrm());
  writeStable(OUT_WAVE, buildWaveVrma());
  writeStable(OUT_REST, buildRestVrma());
  // The gesture table, plus the manifest that marks the wave and the hop as one-shots. Written together
  // because a flag and the clip it describes are useless apart: without the manifest every generated clip
  // loops, and a looping wave waves at the user forever.
  const gestures = GESTURE_TABLE.map((gesture) => {
    const path = join(OUT_DIR, gesture.file);
    writeStable(path, buildGestureVrma(gesture));
    return { ...gesture, path, bytes: readFileSync(path).length };
  });
  const manifestPath = join(OUT_DIR, MOTION_MANIFEST_FILE);
  writeStable(manifestPath, JSON.stringify(GESTURE_MANIFEST, null, 2) + '\n');

  const vrmaBytes = readFileSync(OUT_VRMA);
  const vrmBytes = readFileSync(OUT_VRM);
  const waveBytes = readFileSync(OUT_WAVE);
  const restBytes = readFileSync(OUT_REST);
  console.log(`wrote: ${OUT_VRMA}`);
  console.log(`       ${vrmaBytes.length} bytes, VRM Animation 1.0 (VRMC_vrm_animation)`);
  console.log(`wrote: ${OUT_VRM}`);
  console.log(`       ${vrmBytes.length} bytes, VRM 1.0 (VRMC_vrm)`);
  console.log(`wrote: ${OUT_WAVE}`);
  console.log(`       ${waveBytes.length} bytes, generated 2.0 s wave (7 channels, 61 keys at 30 fps)`);
  console.log(`wrote: ${OUT_REST}`);
  console.log(`       ${restBytes.length} bytes, generated 6.0 s resting pose (arms down, fingers curled, slow sway)`);
  for (const gesture of gestures) {
    console.log(`wrote: ${gesture.path}`);
    console.log(`       ${gesture.bytes} bytes, generated ${gesture.seconds.toFixed(1)} s ${gesture.loop ? 'loop' : 'one-shot'} — ${gesture.note}`);
  }
  console.log(`wrote: ${manifestPath}`);
  console.log(`       declares ${Object.keys(GESTURE_MANIFEST.clips).length} clip(s) as one-shot: `
    + Object.keys(GESTURE_MANIFEST.clips).join(', '));

  const expected = {
    vrmBytes: vrmBytes.length,
    vrmHash: hash32(vrmBytes),
    vrmaBytes: vrmaBytes.length,
    vrmaHash: hash32(vrmaBytes),
  };
  const probe = renderProbe(expected);

  // The `file` transport needs the bytes as text inside the page; they are read
  // from the files just written, so it is still the on-disk fixture that loads.
  const fixtureScript = '<script>globalThis.__PET3D_FIXTURE_BASE64__ = '
    + JSON.stringify({
      '/fixtures/pet3d-minimal.vrm': vrmBytes.toString('base64'),
      '/fixtures/pet3d-test.vrma': vrmaBytes.toString('base64'),
    })
    + ';</script>';

  const work = mkdtempSync(join(tmpdir(), 'pet3d-vrma-'));
  const requests = [];

  // 2. Loopback HTTP, the intended shape: fixtures as real URLs.
  const server = createServer((request, response) => {
    const url = (request.url || '/').split('?')[0];
    requests.push(url);
    if (url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(buildPage(probe, ''));
      return;
    }
    const fixture = url === '/fixtures/pet3d-minimal.vrm' ? OUT_VRM
      : url === '/fixtures/pet3d-test.vrma' ? OUT_VRMA
        : null;
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    // Read per request, so what the browser parses is provably the file on disk.
    const bytes = readFileSync(fixture);
    response.writeHead(200, {
      'content-type': 'model/gltf-binary',
      'content-length': bytes.length,
    });
    response.end(bytes);
  });

  let report = null;
  let transport = null;
  let httpNote = '';

  if (TRANSPORT === 'http' || TRANSPORT === 'auto') {
    // A blocked port would be reported as ERR_UNSAFE_PORT and read as a fixture
    // failure, so this transport is only tried on a port the browser accepts.
    const port = await listenOnUsablePort(server);
    const url = `http://127.0.0.1:${port}/`;
    console.log(`browser: ${browser}`);
    console.log(`serving: ${url}`);
    // A working navigation finishes in well under a second; a host that cannot
    // reach loopback never opens a socket at all. Twenty seconds is long enough
    // to tell those apart and short enough not to waste a run.
    const attempt = runBrowser(browser, url, join(work, 'profile-http'), 20000);
    report = attempt.ok ? extractReport(attempt.dom) : null;
    if (report) {
      transport = 'http';
    } else {
      httpNote = attempt.ok
        ? describeNonReport(attempt.dom)
        : `${attempt.error}${attempt.stderr ? ` (${attempt.stderr})` : ''}`;
      if (TRANSPORT === 'http') {
        console.error(`loopback HTTP transport failed: ${httpNote}`);
        console.error(`the server received ${requests.length} request(s)`);
      } else {
        console.log(`loopback HTTP unavailable (${httpNote}); retrying over file://`);
      }
    }
    server.close();
  }

  // 3. `file://`, for hosts whose headless browser cannot load http:// at all.
  let inlineNote = '';
  if (!report && TRANSPORT !== 'http') {
    const pagePath = join(work, 'probe.html');
    writeFileSync(pagePath, buildPage(probe, fixtureScript));
    const url = 'file:///' + pagePath.replace(/\\/g, '/');
    const attempt = runBrowser(browser, url, join(work, 'profile-file'), 120000);
    report = attempt.ok ? extractReport(attempt.dom) : null;
    if (report) {
      transport = 'file';
      inlineNote = 'fixtures read off disk by the host and inlined, not fetched';
    } else {
      console.error(`file transport failed: ${attempt.ok ? describeNonReport(attempt.dom) : attempt.error}`);
    }
  }

  rmSync(work, { recursive: true, force: true });

  if (!report) {
    console.error('');
    console.error('the probe never produced a report; no assertion could be evaluated');
    return 2;
  }

  // A report published by the page's error trap has no `info` at all, and it
  // still has to be printed rather than crashing the host.
  if (!report.info) report.info = {};
  report.info.transport = transport;
  if (transport === 'file') report.info.transportNote = inlineNote;

  console.log('');
  for (const check of report.checks ?? []) {
    console.log(`  ${check.ok ? 'pass' : 'FAIL'}  ${check.name}${check.ok ? '' : ` -> ${check.value}`}`);
  }
  console.log('');
  for (const [key, value] of Object.entries(report.info ?? {})) {
    console.log(`  ${key.padEnd(28)} ${JSON.stringify(value)}`);
  }
  const served = transport === 'http'
    ? requests.filter(url => url.startsWith('/fixtures/')).join(', ') || 'none'
    : 'not used (file transport)';
  console.log(`  ${'fixture requests'.padEnd(28)} ${served}`);
  if (httpNote) console.log(`  ${'http transport'.padEnd(28)} ${JSON.stringify(httpNote)}`);
  if (report.errors?.length) {
    console.log('');
    for (const error of report.errors) console.log(`  error: ${error}`);
  }

  const checks = report.checks ?? [];
  const failed = checks.filter(check => !check.ok);
  console.log('');
  if (report.ok && failed.length === 0 && checks.length > 0) {
    console.log(`vrma fixtures: ${checks.length} checks passed over the ${transport} transport`);
    console.log(`  ${OUT_VRMA}`);
    console.log(`  ${OUT_VRM}`);
    return 0;
  }
  console.error(`vrma fixtures: ${failed.length} of ${checks.length} checks FAILED`);
  return 1;
}

// Exported for reuse; only run the browser probe when invoked as a script, so
// importing the builders from a test never spins up a server or a browser.
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exit(await main());
}

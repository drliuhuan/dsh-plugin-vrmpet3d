#!/usr/bin/env node
/**
 * Load a REAL user model through the plugin's own scene and render it to PNG.
 *
 * Run:  node scripts/vrm-probe.mjs --model "D:\Models\HatsuneMikuNT.vrm"
 *
 * Why this is separate from `verify-browser.mjs --page <name>`: that harness has
 * to inline the model as base64 into the page, which is fine for the 712 KB PMD
 * fixture and ruinous for a 25 MB VRM — `--dump-dom` would echo 35 MB of base64
 * back as the DOM. This script instead serves the bytes over a loopback HTTP
 * server and inlines only the JavaScript, so the model is fetched same-origin
 * like a real one would be.
 *
 * It differs from the other suites in what it is for. `verify-browser.mjs` proves
 * the stack is not broken, using fixtures chosen to be redistributable. This
 * proves a *particular* file the user cares about actually loads, is framed, is
 * textured, faces the camera and renders — the check HANDOFF.md lists as
 * "no real user model has been loaded through it".
 *
 * It is a diagnostic, not a test suite: it exits non-zero only when a check
 * fails, and it is deliberately not wired into verify-all.mjs, because it needs
 * a model path that no repository can carry.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listenOnUsablePort } from './loopback.mjs';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

const execFileAsync = promisify(execFile);

/** `--verbose` traces every request this probe accepts and every body it writes. */
const VERBOSE = process.argv.includes('--verbose');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'build', 'probe-out');

/**
 * The browser profile a headless probe run uses.
 *
 * It must NOT be the user's default profile. Edge and Chrome are single-instance
 * per profile directory: with an interactive Edge already open, a launch that
 * shares its profile is handed to that instance instead of starting a headless
 * one. Measured on 2026-10-08: the page never ran, `/model.bin` appeared as a
 * **download dialog** in the user's own browser (25.08 MB, "下载完成"), and the DOM
 * this script captured had an empty body for every fetch — 0 bytes for a 26 MB VRM
 * and for a 4 KB one alike, which reads exactly like a broken model.
 *
 * The directory is kept between runs rather than recreated, so the first-run
 * component work happens once instead of starving `--virtual-time-budget` on every
 * run (see gotcha 25, which this replaces).
 */
const PROBE_PROFILE = join(ROOT, 'build', 'browser-profile');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const modelArgIndex = process.argv.indexOf('--model');
const MODEL = modelArgIndex !== -1 && process.argv[modelArgIndex + 1]
  ? resolve(process.argv[modelArgIndex + 1])
  : null;

if (!MODEL) {
  console.error('usage: node scripts/vrm-probe.mjs --model <path-to-.vrm|.glb|.gltf>');
  process.exit(2);
}
if (!existsSync(MODEL)) {
  console.error(`model not found: ${MODEL}`);
  process.exit(2);
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

// ---------------------------------------------------------------------------
// The probe body. Runs inside the page, with the real lib/ sources inlined.
//
// Written without template literals or `${` on purpose: it is embedded in one.
// ---------------------------------------------------------------------------
const PROBE = `
(function () {
  var report = { checks: [], errors: [], info: {} };
  var out = document.getElementById('out');
  var finished = false;

  // A probe that fails before it reports is worse than useless: the page keeps
  // the "running…" placeholder, the runner sees the same string it started with,
  // and there is no clue whether the model, the loader or the probe itself broke.
  // These two handlers make a synchronous throw or a rejected promise visible.
  function bail(message) {
    if (finished) return;
    finished = true;
    report.ok = false;
    report.errors.push(String(message));
    if (out) out.textContent = JSON.stringify(report);
    document.title = 'VRM-FAIL';
  }
  window.addEventListener('error', function (event) {
    bail('window.onerror: ' + (event && (event.message || event.error)) );
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    bail('unhandledrejection: ' + ((reason && reason.message) || reason));
  });

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
    finished = true;
    report.ok = report.checks.length > 0 && report.checks.every(function (c) { return c.ok; });
    if (out) out.textContent = JSON.stringify(report);
    document.title = report.ok ? 'VRM-OK' : 'VRM-FAIL';
  }

  var V = globalThis.__VRMPET3D_VENDOR__;
  var C = globalThis.__VRMPET3D_CORE__;
  // lib/scene.js publishes a namespace, not the constructor: the class lives at
  // __VRMPET3D_SCENE__.Scene. Taking the global itself yields a truthy object that is
  // not callable, and constructing it fails with a bare "not a constructor".
  var NS = globalThis.__VRMPET3D_SCENE__;
  var Scene = NS && NS.Scene;
  check('vendor chunk, core and scene are present', function () { return Boolean(V && C && typeof Scene === 'function'); });
  if (!V || !C || typeof Scene !== 'function') { finish(); return; }

  var SIZE = 512;
  var canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  document.body.appendChild(canvas);

  var scene = new Scene(canvas, {
    assetBase: '/asset',
    modelId: 'probe',
    onError: function (message) { report.errors.push('scene.onError: ' + message); },
  });
  scene.resize(SIZE, SIZE);

  // Composite a rendered GL frame into a 2D canvas so it can be exported as PNG.
  // readPixels right after a render is the only reliable route here: the context
  // is created without preserveDrawingBuffer, so toDataURL on the GL canvas
  // itself would come back blank.
  // scene.tick() RENDERS a frame, it does not merely advance physics, so this
  // renders exactly one. Looping it 90 times to "let the hair settle" means 90
  // software-rendered frames of a 270k-vertex MToon mesh, which takes minutes
  // under SwiftShader and is what made the first version of this probe hang.
  // NOTE: this whole body is embedded in a template literal, so no backticks and
  // no dollar-brace may appear anywhere below — including in comments.
  function renderPng() {
    scene.tick(1 / 60);
    var gl = scene.renderer.getContext();
    var w = gl.drawingBufferWidth;
    var h = gl.drawingBufferHeight;
    var px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

    var flat = document.createElement('canvas');
    flat.width = w;
    flat.height = h;
    var ctx = flat.getContext('2d');
    var image = ctx.createImageData(w, h);
    var mask = new Uint8Array(w * h);
    var covered = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var si = ((h - 1 - y) * w + x) * 4; // GL rows are bottom-up
        var di = (y * w + x) * 4;
        var a = px[si + 3] / 255;
        // The renderer is premultipliedAlpha, so undo it before compositing or
        // every translucent edge comes out darkened.
        var r = a > 0 ? px[si] / a : 0;
        var g = a > 0 ? px[si + 1] / a : 0;
        var b = a > 0 ? px[si + 2] / a : 0;
        image.data[di] = Math.max(0, Math.min(255, Math.round(r * a + 232 * (1 - a))));
        image.data[di + 1] = Math.max(0, Math.min(255, Math.round(g * a + 232 * (1 - a))));
        image.data[di + 2] = Math.max(0, Math.min(255, Math.round(b * a + 236 * (1 - a))));
        image.data[di + 3] = 255;
        if (a > 0.03) { mask[y * w + x] = 1; covered++; }
      }
    }
    ctx.putImageData(image, 0, 0);
    return { png: flat.toDataURL('image/png'), mask: mask, covered: covered, pixels: w * h };
  }

  fetch('/model.bin')
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    })
    .then(function (buffer) {
      report.info.bytes = buffer.byteLength;
      report.info.format = C.detectFormat(buffer);
      check('format detected from magic bytes', function () { return report.info.format !== 'unknown'; });

      var started = performance.now();
      return scene.parse(buffer, 'probe').then(function (parsed) {
        report.info.parseMs = Math.round(performance.now() - started);
        report.info.parseResult = parsed;
        report.info.kind = parsed.kind;
        check('the plugin parsed it without error', function () { return parsed.ok === true; });
        return parsed;
      });
    })
    .then(function () {
      var root = scene.avatar && scene.avatar.root;
      var vrm = scene.avatar && scene.avatar.vrm;
      check('an avatar root was installed', function () { return Boolean(root); });
      if (!root) { finish(); return; }

      // ---- VRM identity and orientation ------------------------------------
      report.info.metaVersion = vrm && vrm.meta ? vrm.meta.metaVersion : null;
      report.info.meta = vrm && vrm.meta ? {
        title: vrm.meta.title,
        author: vrm.meta.author,
        licenseName: vrm.meta.licenseName,
        otherLicenseUrl: vrm.meta.otherLicenseUrl,
        allowedUserName: vrm.meta.allowedUserName,
        commercialUssageName: vrm.meta.commercialUssageName,
      } : null;
      report.info.rootRotationY = +root.rotation.y.toFixed(6);

      check('it is recognised as a VRM, not a plain glTF', function () { return Boolean(vrm); });
      // VRM 0.x models are authored facing -Z. VRMUtils.rotateVRM0 turns the root
      // by half a turn; without it the pet shows its back to the viewer.
      check('VRM 0.x was rotated to face the viewer', function () {
        if (report.info.metaVersion !== '0') return true;
        return Math.abs(Math.abs(root.rotation.y) - Math.PI) < 1e-6;
      });

      // ---- humanoid bones the motion applier drives ------------------------
      // The assertion is that the VRM humanoid map bound at all. How MANY bones a
      // model declares is a property of the model, not of the pipeline, so the
      // count is reported rather than thresholded: a deliberately minimal fixture
      // resolves 7 and a full character resolves 9-10, and neither is a failure.
      var bones = (scene.avatar.bones || {});
      report.info.humanoidBonesResolved = Object.keys(bones).length;
      check('humanoid bones resolved for animation', function () {
        return Object.keys(bones).length >= 1;
      });

      // ---- spring physics: present means motion is not deterministic -------
      var manager = vrm && vrm.springBoneManager;
      var joints = manager ? (manager.joints ? manager.joints.length : 0) : 0;
      report.info.springBoneJoints = joints;
      var expressions = vrm && vrm.expressionManager && vrm.expressionManager.expressions
        ? Object.keys(vrm.expressionManager.expressions).length : 0;
      report.info.expressions = expressions;

      // ---- geometry, materials, textures -----------------------------------
      var meshes = 0;
      var vertices = 0;
      var triangles = 0;
      var materials = {};
      var withMap = 0;
      var morphs = 0;
      root.traverse(function (object) {
        if (!object.isMesh && !object.isSkinnedMesh) return;
        meshes++;
        var geometry = object.geometry;
        if (geometry) {
          if (geometry.attributes.position) vertices += geometry.attributes.position.count;
          if (geometry.index) triangles += geometry.index.count / 3;
          if (geometry.morphAttributes.position) morphs += geometry.morphAttributes.position.length;
        }
        var list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(function (material) {
          if (!material) return;
          materials[material.uuid] = true;
          if (material.map) withMap++;
        });
      });
      report.info.meshes = meshes;
      report.info.vertices = vertices;
      report.info.triangles = triangles;
      report.info.materials = Object.keys(materials).length;
      report.info.materialsWithTexture = withMap;
      report.info.morphTargets = morphs;
      // Both of these assert that the pipeline produced something, not that the
      // model is big or textured — those are properties of the file. The vertex,
      // triangle and textured-material counts are printed above as measurements
      // so a human can see whether they look right for the model at hand.
      check('geometry arrived', function () { return vertices > 0 && triangles > 0; });
      check('materials were built', function () { return Object.keys(materials).length > 0; });

      // ---- framing, measured by the scene itself ---------------------------
      report.info.height = +scene.height.toFixed(4);
      report.info.scale = +scene.framing.scale.toFixed(6);
      report.info.box = scene.box ? {
        min: [+scene.box.min.x.toFixed(4), +scene.box.min.y.toFixed(4), +scene.box.min.z.toFixed(4)],
        max: [+scene.box.max.x.toFixed(4), +scene.box.max.y.toFixed(4), +scene.box.max.z.toFixed(4)],
      } : null;
      check('the scene framed it to a sane pet height', function () {
        return scene.height > 0.3 && scene.height < 1.2;
      });
      // The framing invariant this project asserts everywhere else: because three
      // composes T · R · S, the offset must be the pre-scaled worldOffset, or
      // the pet sinks by box.min.y * (1 - scale).
      check('framing puts its feet on the stage origin', function () {
        var framedMinY = scene.box.min.y * scene.framing.scale + scene.framing.worldOffset.y;
        return Math.abs(framedMinY) < 1e-4;
      });

      // ---- render it, twice: as installed, and with the 0.x turn undone ----
      var front = renderPng();
      report.info.coveragePercent = +(front.covered / front.pixels * 100).toFixed(2);
      check('renders a visible silhouette', function () {
        return front.covered > front.pixels * 0.03 && front.covered < front.pixels * 0.97;
      });
      report.pngAsInstalled = front.png;

      var saved = root.rotation.y;
      root.rotation.y = 0;
      root.updateMatrixWorld(true);
      var turned = renderPng();
      root.rotation.y = saved;
      root.updateMatrixWorld(true);
      report.pngFacingAway = turned.png;

      var differing = 0;
      for (var i = 0; i < front.mask.length; i++) if (front.mask[i] !== turned.mask[i]) differing++;
      report.info.silhouetteChangeWhenTurnedPercent =
        +(differing / front.pixels * 100).toFixed(2);
      // Only a VRM 0.x is turned by VRMUtils.rotateVRM0, so only for 0.x does the
      // differential mean anything: for a 1.0 model undoing a rotation that was
      // never applied is a no-op, and a "0 % change" there is correct rather than
      // a failure. For 0.x, identical frames would mean the fix is not reaching
      // the model at all.
      check('the orientation fix changes what the viewer sees', function () {
        if (report.info.metaVersion !== '0') return true;
        return differing > front.pixels * 0.01;
      });

      finish();
    })
    .catch(function (error) {
      report.errors.push('load: ' + (error && (error.message || error)));
      check('model loaded through the real scene', function () { return false; });
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
const modelBytes = statSync(MODEL).size;
const requests = [];

const server = createServer((request, response) => {
  const url = (request.url || '/').split('?')[0];
  requests.push(request.url);
  if (VERBOSE) console.error(`[probe] request ${request.method} ${request.url}`);
  if (url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (url === '/model.bin') {
    // Read per request rather than holding 25 MB in memory for the whole run.
    let body;
    try {
      body = readFileSync(MODEL);
    } catch (error) {
      console.error(`[probe] could not read the model: ${error.message}`);
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('model unreadable');
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': body.length,
    });
    // The callback is the only place that proves the body left the process: a
    // response that is written but never drained looks identical to a fetch that
    // returned nothing, which is exactly the failure this logging exists for.
    response.end(body, () => {
      if (VERBOSE) console.error(`[probe] served ${url}: ${body.length} bytes`);
    });
    return;
  }
  // Anything the model asks for beside itself (an external texture, say) lands
  // here. Counting these is how we prove a VRM was self-contained.
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

const browser = findBrowser();
if (!browser) {
  console.error('No Chromium-based browser found. Set VRMPET3D_BROWSER and retry.');
  process.exit(2);
}

// A port the browser will accept: `listen(0)` can be handed one from Chromium's
// blocked list, which surfaces as ERR_UNSAFE_PORT and reads as a broken model.
const port = await listenOnUsablePort(server);
console.log(`model:   ${MODEL}`);
console.log(`size:    ${modelBytes.toLocaleString()} bytes`);
console.log(`browser: ${browser}`);
console.log(`serving: http://127.0.0.1:${port}/`);

let dom = '';
try {
  // This MUST be awaited rather than run through execFileSync. The model is
  // served by the HTTP server in THIS process, so blocking the event loop while
  // the browser runs means the page's fetch never gets a response: the server
  // cannot even accept the connection. The browser then sits until its virtual
  // time budget expires and exits non-zero, which reads as "the model failed to
  // load" when the real fault is the probe's own call style.
  const result = await execFileAsync(browser, [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    // A profile of our own, so an interactive Edge cannot absorb this launch.
    `--user-data-dir=${PROBE_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    // Generous: a 25 MB VRM with 2048² textures is decoded in software here.
    '--virtual-time-budget=300000',
    '--dump-dom',
    `http://127.0.0.1:${port}/`,
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  dom = result.stdout;
} catch (error) {
  console.error(`browser run failed: ${error.message}`);
  // Without this the failure is a bare "Command failed" with no clue in it.
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
  console.error(`report was not JSON: ${error.message}`);
  console.error(match[1].slice(0, 600));
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const stem = basename(MODEL).replace(/\.[^.]+$/, '');
function writePng(key, suffix) {
  if (typeof report[key] !== 'string') return null;
  const target = join(OUT, `${stem}.${suffix}.png`);
  writeFileSync(target, Buffer.from(report[key].split(',')[1], 'base64'));
  return target;
}
const installed = writePng('pngAsInstalled', 'as-installed');
const away = writePng('pngFacingAway', 'facing-away');

console.log('');
for (const check of report.checks) {
  console.log(`  ${check.ok ? 'pass' : 'FAIL'}  ${check.name}${check.ok ? '' : ` -> ${check.value}`}`);
}
console.log('');
for (const [key, value] of Object.entries(report.info)) {
  console.log(`  ${key.padEnd(34)} ${JSON.stringify(value)}`);
}

// A request for anything but the page and the model means the file referenced
// external resources; a VRM in a GLB container never should. /favicon.ico is
// excluded because the browser requests it on its own, unprompted by the page —
// counting it would make every run look like it leaked a request.
const beside = requests.filter(r => r !== '/' && r !== '/model.bin' && r !== '/favicon.ico');
console.log(`  ${'external requests'.padEnd(34)} ${beside.length === 0 ? 'none' : JSON.stringify(beside.slice(0, 5))}`);
// The full server-side log. "The page got 0 bytes" and "the server was never asked"
// are different faults, and only this line tells them apart.
console.log(`  ${'requests the server saw'.padEnd(34)} ${requests.length === 0 ? 'none' : JSON.stringify(requests.slice(0, 8))}`);
if (installed) console.log(`  ${'render as installed'.padEnd(34)} ${installed}`);
if (away) console.log(`  ${'render facing away'.padEnd(34)} ${away}`);

if (report.errors.length) {
  console.log('');
  for (const error of report.errors) console.log(`  error: ${error}`);
}

const failed = report.checks.filter(c => !c.ok);

/**
 * The one failure that is not about the model.
 *
 * If the page received zero bytes while this process served them, the browser
 * delivered the response headers and dropped the body. That is a known behaviour of
 * some Chromium builds under `--virtual-time-budget`: measured on 2026-10-08 with
 * Edge 142, `fetch().arrayBuffer()`, `fetch().text()`, `body.getReader()` and
 * `XMLHttpRequest` all came back empty for a 4 KB file served from loopback, while
 * an `<img>` load of the same page's bytes succeeded. The suite then reports
 * "unrecognised model format", which blames the model for a browser behaviour.
 *
 * Do not re-run this probe in a loop looking for a different answer: it needs a
 * Chromium whose fetch bodies survive virtual time, or a rewrite onto a CDP session
 * with real time (see gotcha 40 in HANDOFF.md).
 */
const servedBytes = requests.includes('/model.bin');
if (servedBytes && report.info.bytes === 0) {
  console.log('');
  console.log('vrm-probe: the browser fetched /model.bin but received NO bytes, while this');
  console.log('           process served them. That is a virtual-time behaviour of this');
  console.log('           Chromium build, not a fault of the model — see HANDOFF.md gotcha 40.');
  console.log('           No amount of retrying this probe will change the result.');
  process.exit(3);
}

console.log('');
if (report.ok && failed.length === 0 && beside.length === 0) {
  console.log(`vrm-probe: ${report.checks.length} checks passed`);
  process.exit(0);
}
console.log(`vrm-probe: ${failed.length} of ${report.checks.length} checks FAILED`);
process.exit(1);

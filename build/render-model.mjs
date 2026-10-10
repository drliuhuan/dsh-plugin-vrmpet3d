/**
 * Render one model with the plugin's own scene code, in a headless browser, and bring back BOTH the pixels
 * and the material table.
 *
 * Why it exists: "the transparent parts of the clothes are black" is a claim about pixels, and every static
 * check I could make said the alpha mode was intact (the glTF says MASK, and three-vrm's VRM 0.x compat layer
 * preserves it). So this loads the real model through the real `lib/pet3d.js`, writes a PNG of it, and
 * reports what the loaded materials actually carry — `alphaTest`, `transparent`, `depthWrite`, `side`, the
 * material's class and its map's name.
 *
 * It also renders a SECOND image with every alpha mask disabled (`alphaTest = 0`), which is the "if the mask
 * were ignored" look: if the two images differ around the clothes, the mask is being applied.
 *
 * Usage: node build/render-model.mjs <model.vrm|pmx> [out.png]
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = process.argv[2];
const outPng = process.argv[3] || join(ROOT, 'build', 'render-model.png');
if (!model || !existsSync(model)) {
  console.error('usage: node build/render-model.mjs <model.vrm|pmx> [out.png]');
  process.exit(2);
}

const BROWSERS = [
  process.env.PET3D_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const browser = BROWSERS.find((candidate) => existsSync(candidate));
if (!browser) {
  console.error('no Chromium-based browser found (set PET3D_BROWSER)');
  process.exit(2);
}

const inline = (path) => readFileSync(path, 'utf8').replace(/<\/script>/gi, '<\\/script>');

const PROBE = `
(function () {
  var V = globalThis.__PET3D_VENDOR__;
  var C = globalThis.__PET3D_CORE__;
  var Pet3D = globalThis.__PET3D_SCENE__;
  var Scene = Pet3D && Pet3D.Scene;
  var report = { ok: false, errors: [], materials: [], info: {}, png: null, pngMaskOff: null };

  function finish() {
    document.getElementById('out').textContent = JSON.stringify(report);
  }
  function fail(message) {
    report.errors.push(String(message));
    finish();
  }
  if (!V || !C || !Scene) {
    fail('vendor/core/scene missing');
    return;
  }

  var WIDTH = 420;
  var HEIGHT = 560;
  var canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.appendChild(canvas);

  var scene = new Scene(canvas, {
    assetBase: '/asset',
    modelId: 'probe',
    onError: function (message) { report.errors.push('scene.onError: ' + message); },
  });
  scene.resize(WIDTH, HEIGHT);
  scene.setState('resting');

  /** Every material the loaded avatar draws with, plus what decides its transparency. */
  function collectMaterials() {
    var seen = {};
    var list = [];
    var root = scene.stage || scene.scene;
    root.traverse(function (node) {
      if (!node.isMesh && !node.isSkinnedMesh) return;
      var materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(function (material) {
        if (!material || seen[material.uuid]) return;
        seen[material.uuid] = true;
        list.push({
          node: node.name,
          name: material.name || '(unnamed)',
          type: material.type,
          transparent: material.transparent === true,
          alphaTest: material.alphaTest,
          depthWrite: material.depthWrite !== false,
          opacity: material.opacity,
          side: material.side,
          map: material.map ? (material.map.name || '(map)') : null,
          colorWrite: material.colorWrite !== false,
        });
      });
    });
    return list;
  }

  /** The canvas as a PNG over mid-grey, so "transparent" and "black" are different pixels. */
  function snapshot() {
    var gl = scene.renderer.getContext();
    var w = gl.drawingBufferWidth;
    var h = gl.drawingBufferHeight;
    var pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    var flat = document.createElement('canvas');
    flat.width = w;
    flat.height = h;
    var context = flat.getContext('2d');
    var image = context.createImageData(w, h);
    var black = 0;
    var transparent = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var source = ((h - 1 - y) * w + x) * 4;
        var target = (y * w + x) * 4;
        var alpha = pixels[source + 3] / 255;
        if (alpha === 0) transparent += 1;
        else if (pixels[source] + pixels[source + 1] + pixels[source + 2] === 0) black += 1;
        image.data[target] = Math.round(pixels[source] * alpha + 128 * (1 - alpha));
        image.data[target + 1] = Math.round(pixels[source + 1] * alpha + 128 * (1 - alpha));
        image.data[target + 2] = Math.round(pixels[source + 2] * alpha + 128 * (1 - alpha));
        image.data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return { png: flat.toDataURL('image/png'), black: black, transparent: transparent };
  }

  fetch('/model.bin')
    .then(function (response) { return response.arrayBuffer(); })
    .then(function (buffer) {
      report.info.bytes = buffer.byteLength;
      report.info.format = C.detectFormat(buffer);
      return scene.parse(buffer, 'probe');
    })
    .then(function (parsed) {
      report.info.parsed = parsed;
      if (!parsed || !parsed.ok) { fail('the model did not load: ' + JSON.stringify(parsed)); return null; }
      report.info.kind = scene.kind;
      /**
       * Every spring chain the document declares and every one the renderer matched.
       *
       * The scene's springChainInfo is what the settings window's sliders are built from, and its
       * springChainSkipped is what the file declares and the renderer could NOT match — the failure that cost
       * 蓝色小肥鱼 16 of its 22 chains, where the window listed a chain whose sliders did nothing at all.
       */
      report.chains = (scene.springChainInfo || []).map(function (chain) {
        return { name: chain.name, joints: chain.joints ? chain.joints.length : 0 };
      });
      report.info.chainCount = report.chains.length;
      report.info.skippedChains = (scene.springChainSkipped || []).map(function (entry) {
        return typeof entry === 'string' ? entry : (entry && (entry.name || entry.root || entry.reason)) || JSON.stringify(entry);
      });
      report.info.joints = (function () {
        try {
          var manager = scene.avatar && scene.avatar.vrm && scene.avatar.vrm.springBoneManager;
          return manager && manager.joints ? manager.joints.length : 0;
        } catch (error) { return -1; }
      })();
      report.info.physics = scene.motion ? scene.motion.physicsEnabled !== false : null;
      // A few frames so the spring step, the stand and the gaze have all run at least once — deliberately
      // few: a 14 MB VRoid model with a 630 k-vertex hair mesh on a SOFTWARE WebGL context costs real time
      // per frame, and this tool is about one frame's appearance rather than about time.
      for (var frame = 0; frame < 4; frame += 1) scene.tick(1 / 60);
      report.materials = collectMaterials();
      report.chainFacts = report.chains.map(function (chain) {
        return chain.name + '(' + chain.joints + ')';
      });
      /**
       * The chains-only mode skips the pixels entirely, which is what makes this usable on a 26 MB model: the
       * spring-chain question needs the parse and one frame, not 28 textures' worth of software rasterising.
       */
      if (location.search.indexOf('chains-only') !== -1) {
        report.ok = true;
        finish();
        return null;
      }
      var normal = snapshot();
      report.png = normal.png;
      report.info.blackPixels = normal.black;
      report.info.transparentPixels = normal.transparent;

      // The same frame with every alpha mask switched off: the difference is the mask doing its job.
      var masked = report.materials.filter(function (material) { return material.alphaTest > 0; });
      report.info.maskedMaterials = masked.length;
      var root = scene.stage || scene.scene;
      root.traverse(function (node) {
        if (!node.isMesh && !node.isSkinnedMesh) return;
        var materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(function (material) { if (material) material.alphaTest = 0; });
      });
      scene.tick(1 / 60);
      report.pngMaskOff = snapshot().png;
      report.ok = true;
      finish();
      return null;
    })
    .catch(function (error) { fail(error && (error.stack || error.message || error)); });
})();
`;

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>pending</title></head>
<body>
<div id="out">running…</div>
<script>${inline(join(ROOT, 'lib', 'client.vendor.js'))}</script>
<script>${inline(join(ROOT, 'lib', 'core.js'))}</script>
<script>${inline(join(ROOT, 'lib', 'placeholder.js'))}</script>
<script>${inline(join(ROOT, 'lib', 'pet3d.js'))}</script>
<script>${PROBE.replace(/<\/script>/gi, '<\\/script>')}</script>
</body>
</html>
`;

const work = mkdtempSync(join(tmpdir(), 'pet3d-render-'));
writeFileSync(join(work, 'index.html'), page);
const modelBytes = readFileSync(model);
const chainsOnly = process.argv.includes('--chains-only');

const server = createServer((request, response) => {
  const url = (request.url || '/').split('?')[0];
  if (url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
    return;
  }
  if (url === '/model.bin') {
    response.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': modelBytes.length });
    response.end(modelBytes);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const port = server.address().port;
const profile = join(work, 'profile');

let dom = '';
try {
  dom = execFileSync(browser, [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=90000',
    '--dump-dom',
    `http://127.0.0.1:${port}/${chainsOnly ? '?chains-only=1' : ''}`,
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
} catch (error) {
  // Chromium's stdout carries the report and its stderr is chatter, so BOTH halves are printed: without the
  // partial DOM, "the browser never started" and "the page threw" look identical.
  const stderr = String(error.stderr || '')
    .split('\n').map((line) => line.trim())
    .filter((line) => line && !/QQBrowser|fallback_task_provider|GPU process|Skia/.test(line))
    .slice(0, 3).join(' | ');
  const out = /<div id="out">([\s\S]{0,400})/.exec(String(error.stdout || ''));
  console.error(`browser failed: status=${error.status} signal=${error.signal} ${stderr}`);
  if (out) console.error('page said: ' + out[1]);
  server.close();
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
} finally {
  server.close();
}

const match = /<div id="out">([\s\S]*?)<\/div>/.exec(dom);
const report = match ? (() => { try { return JSON.parse(match[1]); } catch { return null; } })() : null;
if (!report) {
  console.error('no report; the page said: ' + (/<div id="out">([\s\S]{0,200})/.exec(dom) || [])[0]);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const save = (dataUrl, target) => {
  if (!dataUrl) return null;
  const base64 = String(dataUrl).split(',')[1];
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(base64, 'base64'));
  return target;
};

console.log(`${model}`);
console.log(`  format/kind   ${report.info.format} / ${report.info.kind}`);
console.log(`  spring chains ${report.info.chainCount} matched, ${report.info.skippedChains.length} skipped,` +
  ` ${report.info.joints} joints built by three-vrm, physics ${report.info.physics}`);
if (report.chainFacts && report.chainFacts.length) {
  console.log(`    chains: ${report.chainFacts.join(', ')}`);
}
if (report.info.skippedChains.length) {
  console.log(`    SKIPPED: ${report.info.skippedChains.join(', ')}`);
}
if (chainsOnly) {
  if (report.errors.length) for (const error of report.errors) console.log('  error: ' + error);
  rmSync(work, { recursive: true, force: true });
  process.exit(report.ok ? 0 : 1);
}
console.log(`  black pixels  ${report.info.blackPixels}   transparent ${report.info.transparentPixels}   masked materials ${report.info.maskedMaterials}`);
console.log('  materials:');
for (const material of report.materials) {
  console.log(`    ${material.name.padEnd(34)} ${material.type.padEnd(18)}` +
    ` alphaTest ${String(material.alphaTest).padEnd(5)} transparent ${String(material.transparent).padEnd(5)}` +
    ` depthWrite ${String(material.depthWrite).padEnd(5)} side ${material.side}` +
    ` opacity ${material.opacity} map ${material.map}`);
}
if (report.errors.length) {
  console.log('  errors:');
  for (const error of report.errors) console.log('    ' + error);
}
const written = save(report.png, outPng);
const maskOff = save(report.pngMaskOff, outPng.replace(/\.png$/i, '-mask-off.png'));
console.log(`  wrote ${written}`);
console.log(`  wrote ${maskOff}`);
rmSync(work, { recursive: true, force: true });
process.exit(report.ok ? 0 : 1);

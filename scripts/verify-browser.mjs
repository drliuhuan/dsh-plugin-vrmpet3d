#!/usr/bin/env node
/**
 * Headless browser verification of the 3D stack.
 *
 * Run:  node scripts/verify-browser.mjs
 *
 * Why a browser and not Node: the things most likely to be wrong here — that the
 * placeholder builds real geometry, that the framing transform actually puts the
 * model's feet on the floor, that a WebGL frame contains a visible silhouette,
 * and that the official three.js loaders parse their formats — cannot be
 * observed without a real HTML engine and a real WebGL context.
 *
 * The page is written self-contained (vendor chunk + sources inlined) because
 * `--dump-dom` returns as soon as the document is parsed and does not wait for
 * external `file://` scripts.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build', 'probe');
/**
 * Where the client module system is extracted from for the `chunk-delivery`
 * page. `app.asar` is an archive FILE, so the extractor under `tools/` is the
 * only way in; when it is absent the page reports a skip rather than a pass,
 * because a delivery test that cannot load the real loader proves nothing.
 *
 * The candidates are checked in order so the suite runs without an environment
 * variable on any machine that installed DSH somewhere other than the drive this
 * was first written on — a moved install used to look exactly like "no DSH here".
 */
const ASAR_CANDIDATES = [
  envVar('DSH_ASAR'),
  'D:\\DeepSeek\\dsh\\resources\\app.asar',
  'F:\\DeepSeek\\Harness\\resources\\app.asar',
  join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
  'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar',
];
const DSH_ASAR = ASAR_CANDIDATES.find(candidate => candidate && existsSync(candidate))
  || ASAR_CANDIDATES[1];
const CLIENT_MODULES_INNER = 'dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/client.js';

/** Chunk files the `chunk-delivery` page inlines, keyed by file name. */
// client.placeholder.js was delivered until 2026-10-10, when the built-in avatar was removed; the chunk
// generator no longer produces it and the file is gone from lib/, so asserting it here would assert a 404.
const CHUNK_FILES = ['client.core.js', 'client.scene.js', 'client.menu.js', 'client.vendor.js'];

/**
 * The probe bodies this runner knows, and the whole allowlist.
 *
 * `--page <name>` used to accept any `build/probe/<name>.js` on disk, which was right while the chapters
 * were all part of the product. It is not any more: MMD was implementation-removed on 2026-10-12 and its
 * chapter was left on disk (`build/probe/mmd-probe.js`) rather than deleted, so a name-only lookup would
 * still run it — and a probe for a format this build refuses proves nothing. An unknown name is therefore
 * refused here, by name, instead of silently building a page.
 */
const KNOWN_PAGES = ['browser-test', 'client-test', 'chunk-delivery', 'framing-diag', 'vendor-probe'];

const pageArgIndex = process.argv.indexOf('--page');
const PAGE_NAME = pageArgIndex !== -1 && process.argv[pageArgIndex + 1]
  ? process.argv[pageArgIndex + 1]
  : 'browser-test';
if (KNOWN_PAGES.indexOf(PAGE_NAME) === -1) {
  console.error(`Unknown page "${PAGE_NAME}".`);
  console.error(`  known pages: ${KNOWN_PAGES.join(', ')}`);
  process.exit(2);
}
const PAGE = join(BUILD, PAGE_NAME + '.inline.html');

/** Candidate Chromium-based browsers, in preference order. */
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
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function inlineScript(path) {
  const source = readFileSync(path, 'utf8');
  // A `</script>` inside the payload would close the host element early.
  return source.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * The first-run guide's own markup, for the probe page.
 *
 * `lib/setup-page.js` is a page script that boots against ITS document the moment it loads, so a harness that wants
 * to drive the real page has to carry that document: this returns the wizard's `<body>` content with its `<script>`
 * blocks stripped (the real page's watchdog has nothing to do here), injected before the script is evaluated.
 *
 * The alternative — a boot hook exported for the harness — would be a product carrying a hook for a test, which is
 * the shape this project refuses everywhere else; injecting the markup keeps the probe on the real boot path.
 */
function setupMarkup() {
  const html = readFileSync(join(ROOT, 'lib', 'setup-page.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return (body ? body[1] : '').replace(/<script[\s\S]*?<\/script>/gi, '').trim();
}

function buildPage() {
  mkdirSync(BUILD, { recursive: true });
  // The client-half test needs lib/scene.js AND the plugin half itself, plus a
  // stub for the module loader and React so the real plugin entry runs unmodified.
  // It also gets the minimal synthesized VRM: the gaze axes are derived from a real rig, and
  // a fixture with a head bone is the only way to assert that without a licensed model.
  //
  // Every fixture is inlined as base64. `file://` pages in this Chromium refuse to
  // read sibling binaries through fetch, and an object URL cannot be handed a local
  // file either, so inlining is the only reliable route for a headless run.
  let clientScript = '';
  if (PAGE_NAME === 'client-test') {
    let vrmInlined = '';
    const vrmFixture = join(ROOT, 'build', 'fixtures', 'vrma', 'vrmpet3d-minimal.vrm');
    if (existsSync(vrmFixture)) {
      const base64 = readFileSync(vrmFixture).toString('base64');
      vrmInlined = `<script>globalThis.__VRMPET3D_VRM_BASE64__ = ${JSON.stringify(base64)};</script>`;
      console.log(`fixture: ${vrmFixture} (${(base64.length / 1024).toFixed(1)} kB base64 inlined)`);
    } else {
      console.error(`fixture missing: ${vrmFixture}`);
      console.error('  run: node scripts/make-vrma-fixtures.mjs');
    }
    // The generated WAVE, inlined for the same reason as the model: the desktop page's motion path has to
    // be driven with real VRMA bytes, and this probe page has no host to fetch them from.
    const waveFixture = join(ROOT, 'build', 'fixtures', 'vrma', 'vrmpet3d-wave.vrma');
    if (existsSync(waveFixture)) {
      const waveBase64 = readFileSync(waveFixture).toString('base64');
      vrmInlined += `<script>globalThis.__VRMPET3D_WAVE_BASE64__ = ${JSON.stringify(waveBase64)};</script>`;
      console.log(`fixture: ${waveFixture} (${(waveBase64.length / 1024).toFixed(1)} kB base64 inlined)`);
    } else {
      console.error(`fixture missing: ${waveFixture}`);
      console.error('  run: node scripts/make-vrma-fixtures.mjs');
    }
    // The resting pose, for the same reason: its arms-down and fingers-curled claims are measured from
    // real bytes rather than from the generator's own opinion of them.
    const restFixture = join(ROOT, 'build', 'fixtures', 'vrma', 'vrmpet3d-rest.vrma');
    if (existsSync(restFixture)) {
      const restBase64 = readFileSync(restFixture).toString('base64');
      vrmInlined += `<script>globalThis.__VRMPET3D_REST_BASE64__ = ${JSON.stringify(restBase64)};</script>`;
      console.log(`fixture: ${restFixture} (${(restBase64.length / 1024).toFixed(1)} kB base64 inlined)`);
    } else {
      console.error(`fixture missing: ${restFixture}`);
      console.error('  run: node scripts/make-vrma-fixtures.mjs');
    }
    clientScript = [
      `<script>${inlineScript(join(ROOT, 'lib', 'scene.js'))}</script>`,
      /**
       * The shared right-click MENU, before the widget: `lib/client.js` builds its menu from this module (it
       * arrives as the `client.menu.js` chunk in the app), so an inlined harness has to publish the same global
       * the chunk would. The window's page reads the same file the same way.
       */
      `<script>${inlineScript(join(ROOT, 'lib', 'menu.js'))}</script>`,
      // The desktop window's own page glue, so the same page can drive it with a fake bridge
      // instead of Electron: drag, throw, zoom, orbit, gaze and the rectangle the launcher uses
      // to decide between receiving clicks and passing them through.
      `<script>${inlineScript(join(ROOT, 'lib', 'desktop-page.js'))}</script>`,
      vrmInlined,
      // Minimal React: only the four hooks the plugin uses, plus createElement.
      // Deliberately not a full implementation — this page tests the widget, not
      // React, and a real React would need a renderer to be useful here.
      `<script>
(function () {
  function createElement(type, props, ...children) {
    return { type: type, props: props || {}, children: children };
  }
  globalThis.__VRMPET3D_REACT_STUB__ = {
    createElement: createElement,
    useRef: function (initial) { return { current: initial }; },
    useState: function (initial) { return [initial, function () {}]; },
    useEffect: function () {},
    useCallback: function (fn) { return fn; },
  };
  // The plugin registers itself with the module loader on load. Run it now with
  // the hook surface its factory expects.
  var realLoad = window.__ModuleLoader__.load;
  window.__ModuleLoader__.load = function (registration) {
    if (registration.id !== 'dsh-plugin-vrmpet3d') return realLoad(registration);
    var plugin = registration.factory(function (specifier) {
      if (specifier === 'react') return globalThis.__VRMPET3D_REACT_STUB__;
      throw new Error('unexpected require("' + specifier + '")');
    });
    globalThis.__VRMPET3D_PLUGIN__ = plugin;
    return plugin;
  };
})();
</script>`,
      `<script>${inlineScript(join(ROOT, 'lib', 'client.js'))}</script>`,
      /**
       * THE FIRST-RUN GUIDE, in three parts, and every part is deliberate.
       *
       * 1. A DORMANT HOST SPY. The guide reads its settings through `core.watchHostSettings` as it boots, and the
       *    probe page has no server — but the PET's own client half polls the SAME route, and answering it here
       *    would flip the widget from "this host has no store" (its state in every other check) to "this host has
       *    one", at which point it adopts a snapshot and wipes the preferences the other checks set. Measured:
       *    three motion checks failed exactly that way. So the spy answers NOTHING until the guide's own check
       *    flips `enabled`, and delegates every request to the real fetch until then — which is byte-for-byte the
       *    behaviour the rest of this page already had;
       * 2. the guide's MARKUP as a string, and 3. its SCRIPT as a string, both injected and evaluated from the
       *    check. Inlining them as live tags would boot the guide at page load, which is the whole problem above.
       */
      `<script>
(function () {
  var spy = globalThis.__VRMPET3D_SETUP_SPY__ = { enabled: false, posts: [], requests: [], version: 1, preferences: {} };
  var real = window.fetch;
  var answer = function (payload) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(payload); } });
  };
  var spyFetch = function (url, options) {
    // Dormant: the page behaves exactly as it did before this spy existed.
    if (!spy.enabled) return real.apply(window, arguments);
    var path = String(url).split('?')[0];
    var method = (options && options.method) || 'GET';
    var body = options && options.body ? JSON.parse(options.body) : null;
    var record = function () { spy.requests.push(method + ' ' + path); if (body) spy.posts.push({ path: path, body: body }); };
    if (path === '/vrmpet3d/settings') {
      record();
      if (method === 'POST' && body) {
        Object.keys(body.preferences || {}).forEach(function (key) { spy.preferences[key] = body.preferences[key]; });
        spy.version += 1;
      }
      return answer({ version: spy.version, preferences: spy.preferences, live: null });
    }
    if (path === '/vrmpet3d/setup-state') { record(); return answer({ completed: false, prompted: false, file: '(probe)' }); }
    if (path === '/vrmpet3d/llm') {
      return answer({ dsh: { available: true, provider: 'deepseek-account',
        providers: [{ id: 'other', name: '别的' }, { id: 'deepseek-account', name: 'DeepSeek Account' }],
        models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }] } });
    }
    if (path === '/vrmpet3d/models') {
      if (method === 'POST') {
        record();
        return answer({ importedModels: [{ file: 'C:/plugin-copy/hero.vrm', name: 'hero.vrm', source: (body && body.addFile) || '' }],
          models: [{ id: 'm9', name: 'hero.vrm', source: 'user' }], modelCount: 2, persisted: true });
      }
      return answer({ importedModels: [], importedDirs: [], modelCount: 1 });
    }
    if (path === '/vrmpet3d/motions') {
      if (method === 'POST') {
        record();
        return answer({ motions: [], motionDefaults: {}, importedDirs: [],
          importedMotions: [{ dir: 'C:/plugin-copy/pack', name: 'pack', clips: 3, source: (body && body.importDir) || '' }] });
      }
      return answer({ motions: [], motionDefaults: {}, importedMotions: [], importedDirs: [] });
    }
    if (path === '/vrmpet3d/desktop') { record(); return answer({ state: 'setup-open', pid: 1 }); }
    return real.apply(window, arguments);
  };
  window.fetch = spyFetch;
  globalThis.__VRMPET3D_SETUP_FETCH__ = spyFetch;
})();
</script>`,
      `<script>globalThis.__VRMPET3D_SETUP_MARKUP__ = ${JSON.stringify(setupMarkup())};</script>`,
      `<script>globalThis.__VRMPET3D_SETUP_SOURCE__ = ${JSON.stringify(inlineScript(join(ROOT, 'lib', 'setup-page.js')))};</script>`,
    ].join('\n');
  }
  // The delivery page is the one page that must NOT inline the sources: inlining
  // them is exactly the delivery path that does not exist in the app.
  const isDeliveryPage = PAGE_NAME === 'chunk-delivery';
  const standardSources = isDeliveryPage ? '' : [
    `<script>${inlineScript(join(ROOT, 'lib', 'client.vendor.js'))}</script>`,
    `<script>${inlineScript(join(ROOT, 'lib', 'core.js'))}</script>`,
    `<script>${inlineScript(join(ROOT, 'lib', 'placeholder.js'))}</script>`,
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>pending</title></head>
<body>
<div id="out">running…</div>
${isDeliveryPage ? chunkDeliveryScripts() : ''}
${standardSources}
${clientScript}
<script>${inlineScript(join(BUILD, PAGE_NAME + '.js'))}</script>
</body>
</html>
`;
  writeFileSync(PAGE, html);
}

/**
 * The `chunk-delivery` page, which is the only page that exercises the real
 * delivery path rather than an inlined one.
 *
 * It gets three things the other pages must NOT have:
 *   * the real `@deepseek-ai/dsh-client-modules`, extracted from the installed
 *     app.asar, so the loader under test is the one that will run in the app;
 *   * the four committed chunk files as *payload strings*, not as <script> tags:
 *     the page's transport turns them into script elements on demand, which is
 *     what makes the assertion about the requested URL meaningful;
 *   * `lib/client.js` itself, so its own registration and its own chunk list are
 *     what gets exercised. Without it the page would test a copy of the client's
 *     logic instead of the client.
 *
 * When app.asar cannot be read the page still runs and reports a failed check
 * naming the reason. A skip would be worse: this regression has already shipped
 * once, and the whole point is that it cannot ship unnoticed again.
 */
function chunkDeliveryScripts() {
  const clientModules = extractClientModules();
  const chunks = {};
  for (const name of CHUNK_FILES) {
    const path = join(ROOT, 'lib', name);
    if (!existsSync(path)) {
      console.error(`chunk missing: ${path}\n  run: node scripts/client-chunks.mjs`);
      continue;
    }
    chunks[name] = readFileSync(path, 'utf8');
  }
  console.log(`chunk-delivery: ${Object.keys(chunks).length} chunk(s) inlined, ${(JSON.stringify(chunks).length / 1024 / 1024).toFixed(2)} MB of payload`);

  const rowId = 'dsh-plugin-vrmpet3d';
  const rev = 'test-rev-1';
  // The plugin's own row URL must keep the combo shape
  // `/plugins/??<pkg>/client.js&rev=…`: `chunkUrl` refuses any other form, which
  // is itself part of what makes a chunk request impossible to fake.
  const boot = {
    rev,
    entries: [
      { id: rowId, url: `/plugins/??${rowId}/client.js&rev=${rev}`, rev },
      { id: 'react', url: `/plugins/??react/client.js&rev=${rev}`, rev },
    ],
    batches: [
      { phase: 'bootstrap', url: `/plugins/??react/client.js&rev=${rev}`, rev, entries: ['react'] },
      { phase: 'application', url: `/plugins/??${rowId}/client.js&rev=${rev}`, rev, entries: [rowId] },
    ],
  };

  return [
    `<script>globalThis.__VRMPET3D_CHUNKS__ = ${JSON.stringify(chunks).replace(/<\//g, '<\\/')};</script>`,
    `<script>globalThis.__VRMPET3D_BOOT__ = ${JSON.stringify(boot)};</script>`,
    // The registration facade, installed BEFORE any bundle runs. It plays the
    // part the shell's HTML bootstrap facade plays: `create` drains its pending
    // queue, and the module system refuses to be built once that queue is gone —
    // so a facade created later in the page would swallow every registration
    // instead of failing loudly.
    `<script>
(function () {
  var queued = [];
  window.__ModuleLoader__ = {
    mode: 'queue',
    pendingQueue: queued,
    load: function (registration) { queued.push(registration); },
    create: function (options) {
      var api = globalThis.__DSH_CLIENT_MODULES__;
      if (!api) throw new Error('browser probe: the client module system was not extracted');
      return api.createClientModuleSystem(window.__ModuleLoader__, { id: 'dsh-test-bootstrap', exports: {} }, options);
    }
  };
  globalThis.__VRMPET3D_LOADER__ = window.__ModuleLoader__;
})();
</script>`,
    clientModules === null
      ? `<script>globalThis.__VRMPET3D_CLIENT_MODULES__ = null;</script>`
      : `<script>${clientModules.replace(/<\/script>/gi, '<\\/script>')}</script>`,
    // The extracted loader registers under its own id; run its factory now so
    // the `create` above has something to call. This materialize-then-create
    // order is the one the web shell uses.
    `<script>
(function () {
  var loader = window.__ModuleLoader__;
  var entry = loader.pendingQueue.filter(function (r) { return r.id === '@deepseek-ai/dsh-client-modules'; })[0];
  globalThis.__DSH_CLIENT_MODULES__ = entry
    ? entry.factory(function () { throw new Error('browser probe: the loader required an unexpected module'); })
    : null;
})();
</script>`,
    `<script>
(function () {
  function createElement(type, props, ...children) {
    return { type: type, props: props || {}, children: children };
  }
  // The module system seeds react. Nothing else needs materializing: this page
  // asserts delivery, it does not mount the widget.
  globalThis.__VRMPET3D_REACT_STUB__ = { createElement: createElement };
})();
</script>`,
    `<script>${inlineScript(join(ROOT, 'lib', 'client.js'))}</script>`,
  ].join('\n');
}

/**
 * Read the real client module system out of the installed app.
 *
 * Returns null when it cannot be read, which the probe turns into a failed check.
 * Extracted per run rather than committed: it is DSH's code, not this plugin's,
 * and copying it into the repository would be a licensing problem.
 */
function extractClientModules() {
  if (!existsSync(DSH_ASAR)) {
    console.error(`app.asar not found: ${DSH_ASAR}`);
    console.error('  set VRMPET3D_DSH_ASAR to the installed DSH app.asar to run this page for real');
    return null;
  }
  const extractor = join(ROOT, 'tools', 'asar-extract.mjs');
  try {
    return execFileSync(process.execPath, [
      extractor, '--asar', DSH_ASAR, '--get', CLIENT_MODULES_INNER,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    console.error(`could not extract the client module system: ${error.message}`);
    return null;
  }
}

function runBrowser(browser) {
  const url = 'file:///' + PAGE.replace(/\\/g, '/');
  const args = [
    '--headless=new',
    // SwiftShader gives a software WebGL2 context on a machine with no GPU
    // available to the headless process, which is the normal CI case.
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--virtual-time-budget=60000',
    '--dump-dom',
    url,
  ];
  const output = execFileSync(browser, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return output;
}

function extractReport(dom) {
  const match = /<div id="out">([\s\S]*?)<\/div>/.exec(dom);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return { ok: false, parseError: match[1].slice(0, 400) };
  }
}

const browser = findBrowser();
if (!browser) {
  console.error('No Chromium-based browser found.');
  console.error('Set VRMPET3D_BROWSER to a chrome/msedge/chromium executable and retry.');
  process.exit(2);
}

buildPage();
console.log(`browser: ${browser}`);

let report;
try {
  const dom = runBrowser(browser);
  report = extractReport(dom);
} catch (error) {
  console.error(`browser run failed: ${error.message}`);
  process.exit(2);
}

if (!report) {
  console.error('the page produced no report (it may have failed to parse)');
  process.exit(2);
}

/**
 * A page that wrote something that is NOT its report is a FAILED run, not a diagnostic one.
 *
 * `#out` carries the progress line (`running: <check name>`) while an async check is in flight, so a page
 * that never finished used to arrive here as a bare string, fall through to the "diagnostic page" branch
 * below, and exit 0 — the whole suite reported `browser: diagnostic page (no assertions)` and the operator
 * read that as a pass. Measured 2026-10-12 on a busy machine: `--page client-test` reported exactly that,
 * having reached "the resting clip hangs the arms down…". A timeout has to be loud.
 */
if (report.parseError !== undefined) {
  console.error(`the page never finished: ${report.parseError}`);
  process.exit(2);
}

// A diagnostic page reports a bare object with no `checks`; a test page reports
// `{ok, checks}`. Both shapes are accepted so `--page framing-diag` works.
const isTestPage = Array.isArray(report.checks);

for (const check of report.checks ?? []) {
  const mark = check.ok ? 'pass' : 'FAIL';
  console.log(`  ${mark}  ${check.name}${check.ok ? '' : ` -> ${check.value}`}`);
}
for (const [key, value] of Object.entries(report)) {
  if (key === 'checks' || key === 'errors' || key === 'ok') continue;
  console.log(`  ${key}: ${JSON.stringify(value)}`);
}
if (report.errors?.length) {
  for (const error of report.errors) console.error(`  error: ${error}`);
}

if (!isTestPage) {
  console.log('\nbrowser: diagnostic page (no assertions)');
  process.exit(0);
}

const failed = report.checks.filter(c => !c.ok);
if (report.ok && failed.length === 0) {
  console.log(`\nbrowser: ${report.checks.length} checks passed`);
  process.exit(0);
}
console.error(`\nbrowser: ${failed.length} of ${report.checks.length} checks FAILED`);
process.exit(1);

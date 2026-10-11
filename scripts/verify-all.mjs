#!/usr/bin/env node
/**
 * Run every check this project has, in order, and report one verdict.
 *
 * Run:  node scripts/verify-all.mjs
 *
 * The suites are ordered cheapest-first so a broken core fails before anything
 * launches a browser:
 *
 *   1. core        pure logic, plain Node                     (~0.1 s)
 *   2. host+model  catalog, path safety, HTTP route, hub      (~0.5 s)
 *   3. load        the manifest, host half and activation     (~1 s)
 *   4. clientchunk the real module system delivers the chunks (~1 s)
 *   5. vendor      the committed 3D chunk matches a rebuild   (~20 s)
 *   6. docs        documented paths, commands and counts      (~30 s)
 *   7. browser     3D stack, placeholder, framing, loaders    (needs a browser)
 *   8. client      the widget end to end in a DOM             (needs a browser)
 *   9. desktop     the pet's own window in a borrowed Electron (needs Electron)
 *
 * Suites 7 and 8 need a Chromium-based browser; a missing browser is reported as a
 * skip, not a failure, because a headless environment without one is a legitimate
 * place to run the rest. Suite 9 skips itself in the same spirit when there is no
 * Electron installation to borrow from — and it can be asked to leave its window out
 * altogether with `--no-window` (or `VRMPET3D_SKIP_DESKTOP=1`), which is what a pass
 * that should not put an always-on-top window on someone's screen uses. Its Node half
 * still runs and the skip is printed rather than passed silently.
 *
 * Nothing here runs by itself. The packaged artifact ships no `scripts/` at all, so an
 * installed copy of the plugin has no suites to run and no way to open that window.
 *
 * Suite 4 needs the installed app.asar, because it runs DSH's OWN client module
 * system rather than a copy of it. When that file cannot be read the page still
 * runs and fails loudly, naming the path: an inlined fake loader would be a test
 * of this repository's assumptions, which is precisely what missed the original
 * bug.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The installed DSH archive the `clientchunk` suite reads its loader from. Kept
 * as a plain path here as well as in `verify-browser.mjs` so this file can decide
 * whether to skip without launching a browser to find out. The candidates mirror
 * that file's list; see the note there.
 */
const ASAR_CANDIDATES = [
  envVar('DSH_ASAR'),
  'D:\\DeepSeek\\dsh\\resources\\app.asar',
  'F:\\DeepSeek\\Harness\\resources\\app.asar',
  join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
  'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar',
];
const ASAR = ASAR_CANDIDATES.find(candidate => candidate && existsSync(candidate))
  || ASAR_CANDIDATES[1];

/** Each suite: how to run it, and whether its prerequisites are met. */
const SUITES = [
  {
    name: 'core',
    what: 'state machine, fall physics, framing, idle motion, preferences',
    command: ['node', join(ROOT, 'scripts', 'verify.mjs')],
  },
  {
    name: 'host+model',
    what: 'model catalog, path safety, asset route over real HTTP, boundary hub',
    command: ['node', join(ROOT, 'scripts', 'verify-model.mjs')],
  },
  {
    name: 'load',
    what: 'the plugin manifest, host half and activation contract',
    command: ['node', join(ROOT, 'scripts', 'check-plugin-load.mjs')],
  },
  {
    // The one suite that exercises the real delivery path: DSH's own client
    // module system, extracted from the installed app.asar, loading the real
    // committed chunks. Ordered before `vendor` because a chunk rebuild is the
    // slowest thing here and this is the fastest way to learn the chunks are
    // broken.
    name: 'clientchunk',
    what: 'the real DSH module system delivers every committed client chunk',
    command: ['node', join(ROOT, 'scripts', 'verify-browser.mjs'), '--page', 'chunk-delivery'],
    skip: () => (existsSync(ASAR) ? null : `app.asar absent (${ASAR}); set VRMPET3D_DSH_ASAR`),
  },
  {
    name: 'vendor',
    what: 'the committed 3D chunk is reproducible from the pinned versions',
    command: ['node', join(ROOT, 'scripts', 'vendor-build.mjs'), '--check'],
  },
  {
    // Last of the Node suites: it re-runs the others to read their real check
    // counts, so everything they measure has to exist first.
    name: 'docs',
    what: 'documented paths, commands and check counts match reality',
    command: ['node', join(ROOT, 'scripts', 'check-docs.mjs')],
  },
  {
    name: 'browser',
    what: '3D stack, placeholder, framing, the glTF and VRM loaders',
    command: ['node', join(ROOT, 'scripts', 'verify-browser.mjs')],
  },
  {
    name: 'client',
    what: 'the widget end to end: mount, drag, throw, land, states, dispose',
    command: ['node', join(ROOT, 'scripts', 'verify-browser.mjs'), '--page', 'client-test'],
  },
  {
    // The only suite that starts a real window: it borrows the installed Electron (hard
    // links, no download), spawns the shipped launcher, and asks it to prove the window it
    // made — always on top, transparent, screen-sized, WebGL with an alpha channel — before
    // exiting. A machine without an installation to borrow from skips rather than fails,
    // because the plugin itself works without it.
    name: 'desktop',
    what: "the pet's own window: the runtime it borrows, the spawn, and the window itself",
    command: ['node', join(ROOT, 'scripts', 'verify-desktop.mjs')],
  },
];

/** True when a Chromium-based browser is reachable, matching verify-browser.mjs. */
function browserAvailable() {
  const candidates = [
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
  return candidates.some(candidate => existsSync(candidate));
}

/**
 * `--no-window` is the operator's "run everything, but do not put a window on my screen". It travels as the
 * environment variable the desktop suite already answers to, because `spawnSync` inherits this process's
 * environment: one switch, and no per-suite plumbing to keep in step.
 */
const noWindow = process.argv.includes('--no-window');
if (noWindow) process.env.VRMPET3D_SKIP_DESKTOP = '1';

const results = [];
const needsBrowser = new Set(['clientchunk', 'browser', 'client']);
if (noWindow) console.log('note  --no-window: the desktop suite will skip its live window\n');
const haveBrowser = browserAvailable();

for (const suite of SUITES) {
  if (needsBrowser.has(suite.name) && !haveBrowser) {
    results.push({ ...suite, status: 'skip', detail: 'no Chromium-based browser found (set VRMPET3D_BROWSER)' });
    console.log(`skip  ${suite.name.padEnd(11)} ${suite.what}`);
    continue;
  }
  const preset = suite.skip ? suite.skip() : null;
  if (preset) {
    results.push({ ...suite, status: 'skip', detail: preset });
    console.log(`skip  ${suite.name.padEnd(11)} ${preset}`);
    continue;
  }

  console.log(`run   ${suite.name.padEnd(11)} ${suite.what}`);
  const started = Date.now();
  const [command, ...args] = suite.command;
  const run = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsed = Date.now() - started;

  if (run.status === 0) {
    results.push({ ...suite, status: 'pass', elapsed, output: run.stdout });
    const summary = (run.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
    console.log(`pass  ${suite.name.padEnd(11)} ${elapsed} ms  ${summary}`);
  } else {
    results.push({ ...suite, status: 'fail', elapsed, output: run.stdout, error: run.stderr });
    console.log(`FAIL  ${suite.name.padEnd(11)} ${elapsed} ms`);
    const lines = ((run.stdout || '') + (run.stderr || '')).trim().split('\n');
    for (const line of lines.slice(-25)) console.log(`        ${line}`);
  }
}

const passed = results.filter(result => result.status === 'pass').length;
const failed = results.filter(result => result.status === 'fail').length;
const skipped = results.filter(result => result.status === 'skip').length;

console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
if (skipped) {
  for (const result of results.filter(item => item.status === 'skip')) {
    console.log(`  skipped ${result.name}: ${result.detail}`);
  }
}
process.exit(failed === 0 ? 0 : 1);

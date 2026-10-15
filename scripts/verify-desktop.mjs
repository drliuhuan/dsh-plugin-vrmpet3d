// The `desktop` suite: the pet's own window.
//
// Two halves, because there are two different risks:
//
//   1. the Node half — the bare-Electron runtime this borrows from the installation, and the
//      lifecycle around the child process. All of it is testable without Electron: a fake
//      installation is built out of small files, and the spawn is injected.
//   2. the live half — the real launcher, spawned for real against a real Electron, asked to
//      prove the window it made and then to exit. This is the only check that can catch the
//      class of failure that cannot be reasoned about: a transparent always-on-top window that
//      is not transparent, or a launcher that dies because its environment says "be Node".
//
// The live half SKIPS (it does not fail) when there is no installation to borrow from and no
// `VRMPET3D_DESKTOP_RUNTIME`: the plugin is fully usable without the window, and a suite that
// fails for a missing optional runtime teaches people to ignore failures.
//
// It never downloads anything, never writes into the installation, and always kills the
// processes it starts.
//
// Run:  node scripts/verify-desktop.mjs [--no-window]
//
// THE LIVE HALF CAN BE TURNED OFF, and that is a distribution rule rather than a convenience:
// this section is the only check in the project that puts a real always-on-top window on the
// machine running it (it has to - proving the window it makes is the point). `--no-window`, or
// `VRMPET3D_SKIP_DESKTOP=1`, leaves the Node half running, prints the skip, and opens nothing.
// `verify-all --no-window` passes it down; `scripts/check-docs.mjs` forces it back ON when it
// measures the documented count, so that figure never depends on who ran it.
import { createServer } from 'node:http';
// The loopback helper: `listen(0)` can be handed a port Chromium refuses (ERR_UNSAFE_PORT), which reads as
// "the page never loaded" rather than as the port collision it is. See the helper's own header.
import { listenOnUsablePort } from './loopback.mjs';
// The plugin's own parser: the test server then answers /vrmpet3d/model-info with exactly what the host
// would, for the committed VRM fixture — the same file the browser suite loads as a model.
import { compactModelInfo, describeModel } from '../lib/vrm-info.js';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

import {
  DesktopWindow, NODE_MODE_VARIABLE, RUNTIME_SUPPORT, STATUS_PREFIX, defaultAppDir, ensureRuntime,
  findExecutable, findInstallRoot, launchArgs, parseStatusLine, planRuntimeLinks, removeRuntime,
  resolveStandaloneRuntime, runtimeDirFor, sameVolume, sanitizeSpawnEnv, stateDir,
} from '../lib/desktop.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shipped DEFAULTS, read from the file that owns them.
 *
 * The live half checks that the settings WINDOW is showing the shipped numbers, and the two places it did that used
 * literals — 0.4 for the gaze slope and 0.1 for the draught's reach. Both went stale when the operator moved them
 * (0.1 and 0.15), and nobody saw it, because that half only runs when a real window does. The claim here is "the page
 * agrees with `core.DEFAULTS`"; the claim about WHAT those numbers are is the core suite's, and it pins them by value.
 */
await import(new URL('../lib/core.js', import.meta.url).href);
const core = globalThis.__VRMPET3D_CORE__;
if (!core) {
  console.error('lib/core.js did not publish globalThis.__VRMPET3D_CORE__');
  process.exit(1);
}

/**
 * The model the settings window is tested against.
 *
 * A real VRM, and the committed fixture rather than the operator's library: it carries expressions
 * (one of them declared and empty) and two spring chains with different physics, which is exactly what
 * the page has to render. The default placeholder has neither, so a check against it would pass while
 * the whole feature was broken.
 */
const SETTINGS_MODEL = join(ROOT, 'build', 'fixtures', 'vrma', 'vrmpet3d-minimal.vrm');
const SETTINGS_MODEL_ID = 'fixture';
let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) { passed += 1; return true; }
  failures.push(label);
  return false;
}

function eq(actual, expected, label) {
  return ok(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// ---------------------------------------------------------------------------
console.log('\n0a. the launcher and the pages PARSE, before anything is spawned');
// ---------------------------------------------------------------------------
{
  /**
   * The cheapest possible check, and the one this suite needed twice.
   *
   * Both times the launcher was broken by a stray backtick inside an injected `executeJavaScript` script — which
   * does not fail a test, it stops `desktop/main.js` from parsing: the pet's window cannot open at all and the only
   * symptom is an Electron error dialog on the operator's screen. Without this, the suite reports "no self-test
   * report after 60 s" a minute later and says nothing about the cause.
   *
   * The probe scripts are FILES for exactly this reason (`desktop/probe-parts-editor.js`), so `--check` can prove
   * them; the settings page's own script is checked here too, because nothing else parses it — a syntax error in it
   * renders a blank window that the live check would blame on the window.
   */
  const targets = [
    'desktop/main.js',
    'desktop/probe-parts-editor.js',
    'desktop/probe-motion-picker.js',
    'lib/config-page.js',
    // The first-run guide's script, on the same footing as the settings page's: it is what a user sees FIRST, and
    // a syntax error in it renders a blank window that the live check would blame on the window.
    'lib/setup-page.js',
    // The model picker: the page script and the SHARED component the guide's ② 偏好模型 step mounts. Nothing else
    // parses either of them, and a syntax error in the component blanks the guide AND the 切换模型 page.
    'lib/picker-page.js',
    'lib/model-picker.js',
  ];
  for (const target of targets) {
    let verdict = null;
    try {
      execFileSync(process.execPath, ['--check', join(ROOT, target)], { stdio: 'pipe' });
      verdict = '';
    } catch (error) {
      const output = `${error.stdout || ''}${error.stderr || ''}`;
      verdict = output.split('\n').find((line) => /Error|error/.test(line)) || 'it does not parse';
    }
    ok(verdict === '', `${target} parses (${verdict.trim().slice(0, 120) || 'ok'})`);
  }

  /**
   * AND THE GUIDE'S MARKUP AND SCRIPT HAVE TO AGREE ABOUT THE SCREENS.
   *
   * The wizard drives its own visibility by id, so a screen that exists in one file and not the other is a step
   * that renders as an empty document — the guide would still "open", which is exactly how that failure would
   * survive a live check. Both files are read here (no browser needed) and the six ids are compared.
   */
  const setupHtml = readFileSync(join(ROOT, 'lib', 'setup-page.html'), 'utf8');
  const setupScript = readFileSync(join(ROOT, 'lib', 'setup-page.js'), 'utf8');
  const screens = [...setupHtml.matchAll(/id="(setup-[0-9])"/g)].map((match) => match[1]);
  eq(screens.length, 6, `the first-run guide carries all six screens (${screens.join(', ')})`);
  ok(['setup-back', 'setup-next', 'setup-finish', 'setup-later'].every((id) => setupHtml.includes(`id="${id}"`)),
    'with the navigation the script drives (back, next, finish, later)');
  ok(screens.every((id) => setupScript.includes(`'${id}'`)),
    "and the script's own screen list names every one of them");
  ok(setupScript.includes("post('/vrmpet3d/setup-state', { completed: true })"),
    'the finish button is the one write that ends the guide');
  /**
   * The ② 偏好模型 step is the SHARED picker now (2026-10-13), so the markup and the script have to agree on its
   * mount point exactly as they agree on the screens — and the typed-path box it replaced must be gone from the
   * script as well as from the markup, or a half-removed row would sit there wiring nothing.
   */
  ok(setupHtml.includes('id="setup-model-picker"') && setupScript.includes("el('setup-model-picker')"),
    "the model step's markup and script agree on the shared picker's mount point");
  ok(setupScript.includes('createModelPicker') && !setupScript.includes('setup-model-path')
    && !setupScript.includes("'pickModelFile', importModel"),
    'and the guide mounts the component instead of the typed-path row and the import call it replaced');
  /**
   * AND THE FLOW THE STEPPER DESCRIBES IS THE ONE THE SCRIPT WALKS.
   *
   * Three things about it stopped being constant on 2026-10-13 (operator: 「不要在框架上部的…中不要写数字和序号」
   * and 「隐藏第五项模型动作」): the entries carry no numbers, 模型动作 is hidden outright, and 桌宠界面 is visited only
   * where an independent pet can exist — dsh web has one surface, so the step has nothing to ask. The markup owns
   * the words and the attributes, the script owns the policy, and these are the joins between them.
   */
  const stepperHtml = (/id="setup-steps"[\s\S]*?<\/ol>/.exec(setupHtml) || [''])[0];
  const stepWords = [...stepperHtml.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((match) => match[1]);
  ok(stepWords.length === 6 && !stepWords.some((word) => /[0-9①-⑩]/.test(word)),
    `the stepper's words carry no numbers or ordinals (${stepWords.join(' / ')})`);
  ok(/data-hidden="1"[^>]*>模型动作/.test(setupHtml) && setupScript.includes("node.getAttribute('data-hidden') === '1'"),
    '模型动作 is marked hidden in the stepper and the script drops the hidden entries');
  ok(/data-desktop-only="1"[^>]*>桌宠界面/.test(setupHtml)
    && setupScript.includes("node.getAttribute('data-desktop-only') !== '1'")
    && setupScript.includes("typeof launcher.pickModelFile === 'function'"),
    '桌宠界面 is marked desktop-only, and the script asks the launcher whether that surface exists');
  ok(setupHtml.includes('id="setup-ai-note"') && setupScript.includes("el('setup-ai-note')")
    && setupScript.includes('aiNote.hidden = speech.source'),
    "the AI step's explanation is markup the script shows and hides with the AI 来源 row");
  /**
   * AND 通用设置's 碎碎念 HAS THE SAME RULE FOR ITS OWN AI BLOCK (operator, 2026-10-13: 「如果台词来源是内置台词，则下方的AI
   * 相关设置不显示」, extended the same day to 自定义短语, which never calls a model either: 「自定义短语也隐藏」).
   *
   * The live half asserts the visibility itself, on a source that ships builtin; this is the join that makes that
   * assertion meaningful — the container exists in the markup, the script hides THAT id for every source but AI 生成,
   * and the fact is published so a window can be read for it instead of photographed.
   *
   * The rule itself is a NAMED function (`speechSourceIsAi`) since the per-clip AI 提示词 box is shown by the same
   * decision, and two copies of "is the source AI" is exactly how the block and the box would come to disagree. So
   * what is asserted here is that the block is hidden through THAT function — the one source of the visibility — as
   * well as the markup and the published fact it always was.
   */
  const globalHtml = readFileSync(join(ROOT, 'lib', 'global-page.html'), 'utf8');
  const pageScript = readFileSync(join(ROOT, 'lib', 'config-page.js'), 'utf8');
  ok(globalHtml.includes('id="speech-ai"')
    && pageScript.includes("setRowHidden('speech-ai', !speechSourceIsAi())")
    && pageScript.includes('speech.aiVisible'),
    "碎碎念's AI block is shown for the AI source alone, and that visibility is published");

  /**
   * THE 加载中 COVER ON BOTH PANELS.
   *
   * Operator, 2026-10-14: 「给通用设置和模型参数设置面板加上"加载中"的提示，以免用户看着一个dummy界面干等着」. Asserted statically
   * because the property is static: the markup arrives ALREADY in the loading state (it is what paints first), the overlay
   * is in the HTML rather than created by the script (a script that never runs still has to show something), and the
   * script lifts the state on the first render, on each load failure and on a watchdog — a cover only success can lift is
   * the failure mode this replaces.
   */
  const modelHtml = readFileSync(join(ROOT, 'lib', 'config-page.html'), 'utf8');
  const pagesCss = readFileSync(join(ROOT, 'lib', 'pages.css'), 'utf8');
  ok(globalHtml.includes('data-loading="true"') && modelHtml.includes('data-loading="true"')
    && globalHtml.includes('class="page-loading"') && modelHtml.includes('class="page-loading"')
    && pagesCss.includes('body[data-loading="true"] main'),
    'both panels ship the 加载中 cover in their markup, with the dimming rule beside it');
  ok(pageScript.includes('function setLoading(done)')
    && (pageScript.match(/setLoading\(true\);/g) || []).length >= 4,
    'and the script lifts it on the first render, on both load failures, and on the watchdog');

  /**
   * THE PER-COLLIDER PANEL (operator, 2026-10-14: 「只有body组一个碰撞体组吗？可以做成详细面板一个个开关吗？」).
   *
   * Static, because the interesting part is the WIRING: the panel is built from the model's own collider list and writes
   * `springCollidersOff` — the same preference `lib/scene.js` matches against those keys. A panel of switches that wrote
   * nothing would look identical in a screenshot.
   */
  ok(modelHtml.includes('id="spring-colliders"') && modelHtml.includes('id="spring-collider-list"')
    && pageScript.includes('function renderColliderDetail')
    && pageScript.includes('preferences.springCollidersOff'),
    'the collider switch ships beside a per-collider panel, and that panel writes the preference the renderer reads');

  /**
   * 速度 — a per-clip playback rate in 状态与动作 (operator, 2026-10-14: 「允许给每个动作配置速度，默认100%，范围是1-1000%，同样具有实
   * 时预览功能」). Static, because the wiring is the whole point: the box writes `speed` into the same per-(state, clip) entry
   * the loop mode uses, through `core.setMotionClip`, and its bounds come from the core rather than from a literal here.
   */
  ok(pageScript.includes("setMotionClip(preferences, state, entry.id, 'speed'")
    && pageScript.includes('core.motionSpeedFor(preferences, state, entry.id')
    && pageScript.includes('core.MOTION_SPEED_LIMITS'),
    'the clip controls carry a 速度 box, resolved and bounded through the core');
}

// ---------------------------------------------------------------------------
console.log('\n0. the two halves agree on how the page reports itself');
// ---------------------------------------------------------------------------
{
  // The launcher is a separate process with no imports from the plugin, so the status marker is
  // necessarily duplicated. This is the check that keeps the copies identical: a rename on one
  // side would otherwise silently end the reporting, and "the window is running" would go back to
  // meaning nothing about whether the pet is drawn.
  const launcher = readFileSync(join(ROOT, 'desktop', 'main.js'), 'utf8');
  const declared = /const VRMPET3D_STATUS_PREFIX = '([^']*)'/.exec(launcher);
  ok(Boolean(declared), 'the launcher declares a status prefix');
  eq(declared ? declared[1] : null, STATUS_PREFIX, 'both halves use the same status prefix');

  // And the reader tolerates the shapes a real stdout stream produces.
  const line = `${STATUS_PREFIX}{"ready":true,"webgl2":true}`;
  eq(parseStatusLine(`${line}\n`)?.webgl2, true, 'a whole status line is read');
  eq(parseStatusLine(`${line}\n[123:ERROR] cache\n`)?.webgl2, true,
    'a status line followed by the next log line is still read');
  eq(parseStatusLine(line)?.ready, true, 'a status line cut off right after its JSON is read');
  eq(parseStatusLine(`noise\n${line}\n`)?.ready, true, 'a status line after other output is read');
  eq(parseStatusLine('[26476:ERROR:cache_util_win.cc] Unable to move the cache'), null,
    'ordinary logging is not mistaken for a status');
  eq(parseStatusLine(`${STATUS_PREFIX}{"ready":tr`), null, 'a half-written status is not parsed');
  let carry = '';
  const feed = (chunk) => { carry = (carry + chunk).slice(-2048); return parseStatusLine(carry); };
  eq(feed(`${STATUS_PREFIX}{"ready":`), null, 'a status split across chunks waits');
  eq(feed('true,"webgl2":true}\n')?.webgl2, true, 'and is read once the rest arrives');

  /**
   * Three ways the launcher took the user's screen hostage while it was only meant to report.
   *
   * All three were measured on 2026-10-08, on a probe window started against the live page:
   *
   *  1. A parent that stops reading gives stdout an EPIPE, which Node delivers as an ASYNCHRONOUS
   *     `error` event on the stream - so the `try`/`catch` around the write in `announce()` cannot
   *     see it, and it becomes an uncaught exception. Electron answered with a modal "A JavaScript
   *     error occurred in the main process" (EPIPE at `Socket._write`, through `announce`), which
   *     stayed on the user's screen after the process was gone. The pet was fine throughout: it had
   *     nobody left to talk to.
   *  2. Chromium's process singleton is per `user-data-dir`, so a self-test started while the user's
   *     own pet window is running either exits at once or hangs before its page ever mounts - the
   *     shared profile belongs to the live instance. A probe gets its own profile now.
   *  3. The self-test waits for the PAGE to say it is ready; a page that never gets there used to
   *     leave an always-on-top window and the process alive for ever. It now writes a report with
   *     the reason, before the suite's own 60 s wait expires.
   */
  ok(/process\.stdout\.on\('error'/.test(launcher),
    'the launcher swallows a broken stdout instead of raising an error dialog');
  ok(/process\.stderr\.on\('error'/.test(launcher),
    'and a broken stderr, for the same reason');
  ok(/if \(options\.selfTest\) \{[\s\S]{0,600}?app\.setPath\('userData'/.test(launcher),
    'a self-test gets its own Chromium profile instead of fighting the live window for one');
  ok(/SELF_TEST_TIMEOUT_MS/.test(launcher) && /selfTestTimer = setTimeout/.test(launcher),
    'and the self-test gives up and writes a report rather than living for ever');

  /**
   * The three fixes for the freeze behind the pet.
   *
   * Two of them are statements about the SOURCE and cannot be seen in the running window's report:
   * that `setIgnoreMouseEvents` is called only when its verdict changes (the cursor poll runs at
   * 60 Hz, and repeated SetWindowLong-style updates on a layered window leave stale hit regions),
   * and that the window re-asserts `screen-saver` topmost and drops focus rather than being
   * activated — activation is what the user's freeze starts with.
   */
  // The window is the PET'S BOX, not the work area — the fix for the freeze, and the one thing about
  // it that can only be stated in the source: a work-area-sized transparent topmost window that takes
  // the mouse freezes everything composed behind it (measured: 5 of 8 samples after a click on the pet
  // versus 0 of 8 with a pet-sized window), so the window is created small and then FOLLOWS the box the
  // page reports.
  ok(/const DEFAULT_PET_WINDOW = \{ width: 240, height: 320 \}/.test(launcher),
    'the pet window starts at a pet-sized default rather than the work area');
  ok(/const followPet = \(\) =>/.test(launcher)
    && /win\.setBounds\(\{ x: next\.left, y: next\.top, width: next\.width, height: next\.height \}\)/.test(launcher),
    'and follows the rectangle the page reports, with x/y rather than left/top');
  ok(/mouseThrough/.test(launcher)
    && /if \(win\.isDestroyed\(\) \|\| mouseThrough === through\) return;/.test(launcher),
    'click-through is toggled only when the verdict changes');
  ok(/const keepOnTop = \(\) =>/.test(launcher)
    && /setAlwaysOnTop\(true, 'screen-saver'\)/.test(launcher)
    && /win\.on\('focus'/.test(launcher),
    'and the window keeps itself topmost and un-focused instead of being activated');

  /**
   * The launcher's status payload copies a FIXED list of fields out of the page's own readout.
   *
   * The page has published `status.scale` — the model's own text-size correction, which the wheel ON THE TEXT
   * drives — since that gesture was added, but the copy list did not name it, so the correction was invisible
   * from `/vrmpet3d/desktop` and "the text gesture did nothing" could not be told from "it worked and the size is
   * right". A field that vanished from a report is not something the live half can notice on a machine with no
   * window to run, so the field list is asserted here, by name.
   */
  ok(/scale: lastPageState\.status\.scale === undefined \? null : lastPageState\.status\.scale/.test(launcher),
    'the launcher relays the prompt’s per-model text correction to /vrmpet3d/desktop');

  /**
   * And the same list again for the PRESS readout — which gesture, and which part of the model it landed on.
   *
   * The page measures it (a raycast), the launcher relays it, and the field list is the only place the relay can
   * drop it: `/vrmpet3d/desktop` is where "I clicked its eye and nothing happened" has to be answerable from.
   */
  ok(/touch: lastPageState && lastPageState\.touch/.test(launcher)
    && /region: lastPageState\.touch\.region \|\| null/.test(launcher),
    'the launcher relays the press readout, region and all, to /vrmpet3d/desktop');

  /**
   * The same copy list, for the page's MOTION readout — the second field list that had quietly lost
   * entries.
   *
   * `lib/desktop-page.js` publishes four different answers to "why is my clip not playing": how many
   * clips the page's catalog holds (`offered`), whether `/vrmpet3d/motions` answered at all (`routed`),
   * which of the mapped clips can drive THIS avatar (`available`) and what went wrong loading one
   * (`reason`). The relay rebuilt the object from a fixed list and named only the last two, so from
   * `/vrmpet3d/desktop` "the host never served the route" and "nothing is mapped to a state" were the
   * same answer — measured on the live window on 2026-10-10: 6 clips in the host catalog, `mapped: {}`,
   * `available: []`, and no field that could say which of the two it was.
   */
  ok(/offered: lastPageState\.motion\.offered === undefined \? null : lastPageState\.motion\.offered/.test(launcher),
    'the launcher relays how many clips the page’s own catalog holds');
  ok(/routed: lastPageState\.motion\.routed === undefined \? null : lastPageState\.motion\.routed/.test(launcher),
    'and whether the motion route answered, so "no route" is not read as "nothing mapped"');
  // And the source of those two names, so the relay cannot outlive the page's readout: a rename on
  // the page's side would leave the copy list reading `undefined` for ever, which is exactly the
  // failure mode the two assertions above are here to prevent.
  const windowPage = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
  ok(/offered: \(Array\.isArray\(motionCatalog\.motions\)/.test(windowPage)
    && /routed: motionRouteAvailable/.test(windowPage),
    'and the page still publishes both, so the two names cannot go stale');
}

// ---------------------------------------------------------------------------
console.log('\n0b. the per-frame VRM update reaches every component');
// ---------------------------------------------------------------------------
{
  /**
   * A source assertion, and the defect it exists for is a rendering one that no unit test could see: the VRM
   * wrapper drove `springBoneManager.update()` itself and never called `vrm.update()`, so
   * `material.update(delta)` never ran for the MToon materials. MToon refreshes its own `alphaTest` uniform
   * there, so it stayed 0, `#ifdef USE_ALPHATEST` discarded nothing, and every alpha-0 texel — BLACK in a
   * VRoid garment texture, and 77 % of it — drew opaque. Measured on SampleModel.vrm on 2026-10-09: the
   * renderer painted 38 269 near-black pixels before the fix and 9 431 after, and the dress alone went from
   * 28 034 to 0.
   */
  const scene = readFileSync(join(ROOT, 'lib', 'scene.js'), 'utf8');
  ok(/vrm\.materials\s*&&\s*vrm\.materials\.forEach/.test(scene)
    && /typeof material\.update === 'function'/.test(scene),
    'and three-vrm\'s MToon materials are updated each frame, which is what masks a garment cut-out');
  ok(/nodeConstraintManager\.update\(\)/.test(scene),
    'and VRM 1.0 node constraints are stepped, not only spring bones');
}

// ---------------------------------------------------------------------------
console.log('\n1. the environment the launcher is started with');
// ---------------------------------------------------------------------------
{
  const dirty = { PATH: 'x', [NODE_MODE_VARIABLE]: '1', ELECTRON_EXTRA_LAUNCH_ARGS: '--x', KEEP: 'y' };
  const clean = sanitizeSpawnEnv(dirty);

  // The trap this exists for: Electron treats the PRESENCE of the variable as "run as Node",
  // so it has to be deleted. Setting it to '0' still produced `Cannot find module 'electron'`.
  ok(!(NODE_MODE_VARIABLE in clean), `${NODE_MODE_VARIABLE} is deleted, not blanked`);
  ok(!('ELECTRON_EXTRA_LAUNCH_ARGS' in clean), 'stray extra launch args are deleted');
  eq(clean.PATH, 'x', 'everything else is preserved');
  eq(clean.KEEP, 'y', 'including unrelated variables');
  eq(NODE_MODE_VARIABLE in dirty, true, 'the input object is not mutated');
  eq(sanitizeSpawnEnv(undefined).PATH === undefined, true, 'a missing environment is tolerated');
}

// ---------------------------------------------------------------------------
console.log('\n2. the command line');
// ---------------------------------------------------------------------------
{
  const args = launchArgs({ url: 'http://127.0.0.1:1/vrmpet3d/window', modelId: 'miku', parentPid: 42 });
  eq(args[0], '--url=http://127.0.0.1:1/vrmpet3d/window', 'the page URL comes first');
  eq(args[1], '--model-id=miku', 'the model is passed through');
  eq(args[2], '--parent-pid=42', 'the parent pid is passed for the watchdog');
  eq(args.length, 3, 'and nothing else: a positional argument would be read as an app directory');
  eq(launchArgs({ url: 'u' })[1], '--model-id=placeholder', 'a missing model falls back to the placeholder');
  ok(launchArgs({ url: 'u', selfTest: 'C:\\t.json' })[3] === '--self-test=C:\\t.json', 'the self-test flag is appended last');
}

// ---------------------------------------------------------------------------
console.log('\n3. the bare-Electron layout');
// ---------------------------------------------------------------------------
{
  // A fake installation, small enough to build in a test: the plan and the linking logic are
  // what matter, not the size of the real binaries.
  const scratch = mkdtempSync(join(tmpdir(), 'vrmpet3d-desktop-'));
  const fakeInstall = join(scratch, 'install');
  const fakeTarget = join(scratch, 'runtime');
  try {
    mkdirSync(join(fakeInstall, 'resources'), { recursive: true });
    mkdirSync(join(fakeInstall, 'locales'), { recursive: true });
    writeFileSync(join(fakeInstall, 'DeepSeek Harness.exe'), 'not really an exe');
    writeFileSync(join(fakeInstall, 'resources', RUNTIME_SUPPORT.defaultApp), 'default app');
    writeFileSync(join(fakeInstall, 'resources', 'app.asar'), 'THE REAL APP - must never be linked');
    writeFileSync(join(fakeInstall, 'locales', 'en-US.pak'), 'locale');
    writeFileSync(join(fakeInstall, 'icudtl.dat'), 'icu');
    writeFileSync(join(fakeInstall, 'resources.pak'), 'pak');

    const plan = planRuntimeLinks({ installRoot: fakeInstall, dir: fakeTarget });
    // `default_app.asar` ENDS in `app.asar`, so a substring test would fail on the very file
    // the layout needs. What must never be linked is the application payload, whose basename is
    // exactly `app.asar` — or its `app.asar.unpacked` sibling.
    ok(plan.links.every((entry) => !/(^|[\\/])app\.asar($|[\\/])/.test(entry.to)),
      'the plan never links the application payload into the bare layout');
    ok(plan.links.some((entry) => entry.to.endsWith(RUNTIME_SUPPORT.defaultApp)),
      'the plan links default_app.asar');
    ok(plan.links.some((entry) => entry.kind === 'dir' && entry.to.endsWith('locales')),
      'locales is planned as a directory link');
    ok(plan.missing.includes('chrome_100_percent.pak'),
      'support files the installation does not have are reported, not invented');

    eq(findExecutable(fakeInstall), join(fakeInstall, 'DeepSeek Harness.exe'), 'the executable is found by name');
    eq(findInstallRoot(join(fakeInstall, 'resources', 'runtime', 'node', 'bin')), fakeInstall,
      'the installation is found by walking up from the host runtime');
    eq(findInstallRoot(scratch), null, 'and a directory without one is reported as nothing rather than guessed');

    const first = ensureRuntime({ installRoot: fakeInstall, dir: fakeTarget });
    ok(first.created === true, 'the runtime is created on the first call');
    ok(existsSync(join(fakeTarget, 'DeepSeek Harness.exe')), 'the executable is there');
    ok(existsSync(join(fakeTarget, 'resources', RUNTIME_SUPPORT.defaultApp)), 'and the default app is there');
    eq(existsSync(join(fakeTarget, 'resources', 'app.asar')), false,
      'the real application payload is NOT there, which is what makes Electron run our app');
    // Same volume in this test, so the support files are hard links: identical inode, no bytes.
    const linked = sameVolume(fakeInstall, fakeTarget) && statSync(join(fakeTarget, 'icudtl.dat')).ino === statSync(join(fakeInstall, 'icudtl.dat')).ino;
    ok(linked, 'support files are hard links on one volume, so the layout costs no disk');
    ok(first.copied === false, 'and that is reported as no copy');

    const second = ensureRuntime({ installRoot: fakeInstall, dir: fakeTarget });
    eq(second.created, false, 'a second call reuses the runtime instead of rebuilding it');

    ok(removeRuntime(fakeTarget), 'the runtime can be removed again');
    eq(existsSync(fakeTarget), false, 'and it is gone');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
console.log('\n4. where the runtime lives, and what is used instead');
// ---------------------------------------------------------------------------
{
  eq(sameVolume('C:\\a\\b', 'C:\\c'), true, 'same drive letter is the same volume');
  eq(sameVolume('C:\\a', 'F:\\a'), false, 'a different drive letter is a different volume');
  eq(sameVolume('', 'C:\\a'), false, 'an empty path is never the same volume');

  eq(resolveStandaloneRuntime(''), null, 'no override means no standalone runtime');
  eq(resolveStandaloneRuntime('C:\\definitely\\missing\\electron.exe'), null, 'a missing override is ignored');

  // The state directory is preferred only when hard links would work from it; otherwise the
  // runtime goes beside the installation, which is always on its own volume.
  const insisted = resolve('F:\\install');
  eq(sameVolume(stateDir('C:\\profile'), insisted), false, 'a C: profile is not on F:');
  eq(planRuntimeDir(insisted, 'C:\\profile'), join(dirname(insisted), 'vrmpet3d-desktop-runtime'),
    'a different volume falls back to beside the installation');
  eq(planRuntimeDir(insisted, 'F:\\profile'), resolve('F:\\profile\\vrmpet3d-desktop\\runtime'),
    'a same-volume state directory is used as-is');
  eq(planRuntimeDir(insisted, 'C:\\profile', 'D:\\explicit'), resolve('D:\\explicit'),
    'an explicit directory wins over both');

  function planRuntimeDir(installRoot, profile, preferred) {
    // Mirrors `DesktopWindow.prepareRuntime`'s choice without touching the filesystem.
    return runtimeDirFor({ installRoot, preferred, stateDir: join(profile, 'vrmpet3d-desktop', 'runtime') });
  }
}

// ---------------------------------------------------------------------------
console.log('\n5. the window object: start, idempotence, stop, failure');
// ---------------------------------------------------------------------------
{
  const started = [];
  const makeChild = () => {
    const handlers = {};
    const child = {
      pid: 4242,
      killed: false,
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, handler) { handlers[event] = handler; return child; },
      kill() { child.killed = true; if (handlers.exit) handlers.exit(0, null); },
      emit(event, ...rest) { if (handlers[event]) handlers[event](...rest); },
    };
    return child;
  };
  const window = new DesktopWindow({
    runtime: { dir: 'C:\\runtime', exe: 'C:\\runtime\\electron.exe', copied: false, external: false },
    spawn: (exe, args, options) => {
      started.push({ exe, args, options });
      return makeChild();
    },
    log: () => {},
  });

  const status = window.start({ url: 'http://127.0.0.1:1/vrmpet3d/window', modelId: 'miku' });
  eq(status.state, 'running', 'a start reports running');
  eq(started.length, 1, 'exactly one process was spawned');
  eq(started[0].args[0], defaultAppDir(), 'the first argument is the launcher directory');
  ok(started[0].args[1].startsWith('--url='), 'followed by the page URL');
  ok(!(NODE_MODE_VARIABLE in started[0].options.env), 'the child environment cannot put Electron into Node mode');
  eq(window.start({ url: 'http://127.0.0.1:1/vrmpet3d/window' }).state, 'running', 'starting twice is harmless');
  eq(started.length, 1, 'and does not spawn a second process');

  eq(window.describe().running, true, 'describe() reports it as running');
  eq(window.stop().state, 'stopped', 'stop() reports stopped');
  eq(window.describe().running, false, 'and describe() agrees');
  eq(window.stop().state, 'stopped', 'stopping twice is harmless');

  /*
   * A REPLACED child must not report on its successor.
   *
   * `action: 'restart'` stops the window and starts a new one, and the old process's exit event lands
   * AFTER the new start. Without the guard the host answered `/vrmpet3d/desktop` with
   * `{state: 'stopped', reason: 'signal SIGTERM', pid: null}` while the new window was on screen and
   * drawing — the same payload's `page.ready` was `true`, which is what gave it away. Measured
   * 2026-10-08, on the first live use of `restart`; the panel's switch reads that state, so it would
   * have shown the pet as off while it floated over the desktop.
   */
  {
    const children = [];
    const restarted = new DesktopWindow({
      runtime: { dir: 'C:\\runtime', exe: 'C:\\runtime\\electron.exe' },
      spawn: () => { const child = makeChild(); children.push(child); return child; },
      log: () => {},
    });
    restarted.start({ url: 'u' });
    eq(children.length, 1, 'a first start spawns one process');
    restarted.start({ url: 'u' });
    eq(children.length, 1, 'starting again while running spawns nothing');
    restarted.stop();
    restarted.start({ url: 'u', modelId: 'm1' });
    eq(children.length, 2, 'a restart after a stop spawns a new process');
    eq(restarted.describe().state, 'running', 'and the window reports running');
    children[0].emit('exit', 0, 'SIGTERM');
    eq(restarted.describe().state, 'running', 'the replaced child exiting does not stop the new window');
    eq(restarted.describe().pid, children[1].pid, 'and the new process is still the reported one');
    children[1].emit('exit', 0, null);
    eq(restarted.describe().state, 'stopped', 'while the CURRENT child exiting does stop it');
  }

  // A launcher that dies immediately must be reported, not silently forgotten.
  const dying = new DesktopWindow({
    runtime: { dir: 'C:\\runtime', exe: 'C:\\runtime\\electron.exe' },
    spawn: () => makeChild(),
    log: () => {},
  });
  dying.start({ url: 'u' });
  dying.child.emit('exit', 3, null);
  eq(dying.describe().state, 'failed', 'a non-zero exit is reported as failed');
  ok(/exit 3/.test(dying.describe().reason), 'with the reason');

  // A spawn that throws (a missing runtime, a permission denial) is a status, not an exception.
  const broken = new DesktopWindow({
    runtime: { dir: 'C:\\runtime', exe: 'C:\\runtime\\missing.exe' },
    spawn: () => { throw new Error('spawn ENOENT'); },
    log: () => {},
  });
  const brokenStatus = broken.start({ url: 'u' });
  eq(brokenStatus.state, 'failed', 'a spawn that throws is reported as failed');
  ok(/ENOENT/.test(brokenStatus.lastError), 'with the underlying error');
  eq(broken.start({}).state, 'failed', 'and a start without a URL refuses instead of spawning');

  const logs = [];
  const impossible = new DesktopWindow({
    runtime: { dir: 'C:\\runtime', exe: 'C:\\runtime\\electron.exe' },
    spawn: () => makeChild(),
    log: (message) => logs.push(message),
  });
  impossible.start({ url: 'u' });
  impossible.stop();
  ok(logs.some((line) => /exited/.test(line)), 'the child exiting is logged for the operator');
}

// ---------------------------------------------------------------------------
console.log('\n6. the real launcher, a real window');
// ---------------------------------------------------------------------------
const live = await runLiveWindow();
if (live.skipped) {
  console.log(`  note  skipped: ${live.skipped}`);
} else {
  ok(live.ok, `the launcher reported success (${live.summary})`);

  // The settings window: same launcher, different mode. Asserted because "the button does nothing"
  // is the classic failure of a feature like this, and because every property of this window is the
  // OPPOSITE of the pet window's — which is exactly what a shared code path can get wrong.
  const settings = await runLiveSettingsWindow(live.runtime);
  if (settings.skipped) {
    console.log(`  note  settings window skipped: ${settings.skipped}`);
  } else {
    ok(settings.ok, `the settings window reported success (${settings.summary})`);
    if (settings.report) {
      ok(settings.report.checks.configWindow === true,
        "the launcher knows it is the settings window");
      ok(settings.report.checks.alwaysOnTop === false,
        "it is NOT always on top, unlike the pet");
      ok(settings.report.checks.petSized === false,
        "and is not the pet's box either (it is a form)");
      ok(settings.report.checks.loaded === true, "and it loaded its page");
      const pageErrors = (settings.report.pageLog || [])
        .filter((entry) => /Uncaught|is not defined|not a function|Cannot read/.test(entry.message || ''))
        .map((entry) => entry.message);
      ok(pageErrors.length === 0,
        `with no uncaught error in the settings page (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
      // A page that threw on its way up never publishes what it rendered, and that is the state a user sees
      // as '卡在正在读取': the HTML's own placeholder text, with nothing behind it.

      /**
       * And that it has something IN it.
       *
       * The page publishes what it rendered, so this is the difference between "a window opened" and "a
       * window that can configure a model" — read against a REAL VRM whose expressions and spring chains
       * arrive from the plugin's own parser over HTTP, exactly as the host serves them. A check against the
       * placeholder would pass while every table on the page was empty.
       */
      const shown = settings.report.pageState;
      ok(Boolean(shown), `the settings page published what it rendered (${JSON.stringify(shown)})`);
      if (shown) {
        ok(shown.model === SETTINGS_MODEL_ID,
          `it is configuring the model named in the URL (${shown.model})`);
        /**
         * And the model picker offers REAL models only.
         *
         * The operator asked "为什么会有一个全空的占位模型?" on 2026-10-10: the page used to prepend a synthetic
         * `placeholder` option (占位模型（内置）), and once the built-in procedural avatar was removed that option
         * selected a model that draws nothing — an empty pet, offered by the dropdown. The stub's catalog holds
         * one model, so the list must be exactly that one.
         */
        ok(Array.isArray(shown.modelOptions) && shown.modelOptions.length === 1
          && shown.modelOptions[0] === SETTINGS_MODEL_ID,
          `and its model picker lists the catalog and nothing else (${JSON.stringify(shown.modelOptions)})`);
        ok(!Array.isArray(shown.modelOptions) || shown.modelOptions.indexOf('placeholder') === -1,
          'with no placeholder entry, which is what used to select an empty pet');
        ok(shown.supported === true, 'and the model it read is a VRM it could describe');
        ok(shown.expressions >= 3, `it lists the model's expressions (${shown.expressions})`);
        ok(shown.springs === 2, `and its spring chains (${shown.springs})`);
        /**
         * And a row per SITUATION in the 表情 table — the parts have their OWN table now.
         *
         * This used to count the standalone expression/口型 weight table, which the operator asked to be closed
         * on 2026-10-09 — the expression a clip shows is now that clip's own setting, in the 动作 section. What
         * remains in 表情 is the four `EMOTION_TRIGGERS` rows (空闲 / 拖动时 / 点击时 / 长按时); the per-part rows
         * moved to the 部位 section on 2026-10-11, because a part is the user's own row and carries a 碎碎念 box
         * as well as an emotion.
         */
        ok(shown.emotionRows === 4,
          `and one row per situation in the 表情 table (${shown.emotionRows})`);
        /**
         * The 部位 section: the parts, the structures they own, and the picker behind them.
         *
         * Asserted by count and by label, because this section is the one that can be silently EMPTY: a model
         * whose structure list never arrived leaves a user staring at a box that offers nothing to add, and the
         * shipped parts are what proves the cleaner seeded them.
         *
         * The five the operator added on 2026-10-12 (大腿/小腿/脚/胸部/屁股) are asserted as the ORDER they asked
         * for — after 身体, before 尾巴 — because the row order IS `core.STRUCTURE_REGIONS`.
         */
        const parts = shown.parts || {};
        ok(parts.count === 10, `and the ten shipped parts (${parts.count})`);
        ok(Array.isArray(parts.labels) && parts.labels.indexOf('眼睛') !== -1 && parts.labels.indexOf('尾巴') !== -1,
          `with their shipped labels (${(parts.labels || []).join(' / ')})`);
        ok(JSON.stringify((parts.labels || []).slice(3)) === JSON.stringify(['身体', '大腿', '小腿', '脚', '胸部', '屁股', '尾巴']),
          `the new ones BETWEEN 身体 and 尾巴, in the operator's order (${(parts.labels || []).slice(3).join(' / ')})`);
        ok(parts.rowsDrawn === 10, `each with a row of its own (${parts.rowsDrawn})`);
        ok(parts.speechBoxes === 10 && parts.prompts === 10,
          `and a 碎碎念 box plus an AI prompt on every one of them (${parts.speechBoxes} / ${parts.prompts})`);
        ok(parts.withLines === 0 && parts.withPrompt === 0,
          `with every box EMPTY on a fresh profile, the shipped voice included (${parts.withLines} written lines, ${parts.withPrompt} written prompts)`);
        /**
         * AND EVERY AI PROMPT BOX SHOWS THE SAME GREY HINT — 胸部 and 屁股 included.
         *
         * Operator, 2026-10-13: 「胸部和屁股的AI提示词，默认状态下尽管有内置提示词，但是也应该是和其他部位的默认灰色字体提示
         * 一样，而不是有单独的关于胸部和屁股的灰色字体提示」. The shipped instruction is what the HOST sends the model, so
         * it acts when the box is empty without being spelled out in the box — which is the assertion below: ONE
         * distinct placeholder across all ten rows, and it is the generic one. (The shipped strings themselves are
         * still published, and asserted just after this, so hiding the hint hides nothing from a suite.)
         */
        ok(Array.isArray(parts.promptHints) && parts.promptHints.length === 1
          && parts.promptHints[0] === 'AI 提示词：切到「AI 碎碎念」时用它生成这个部位的一句话',
          `with ONE grey hint shared by every part, shipped prompt or not (${JSON.stringify(parts.promptHints)})`);
        /**
         * And the same for the 碎碎念 boxes (operator, 2026-10-13: 「碎碎念框那行也变成通用灰字」).
         *
         * ONE distinct hint across all ten rows, and it is the 内置短语 wording on a fresh profile — the shipped
         * lines still say themselves when the box is empty, they are simply not announced in the box any more. The
         * AI wording is the other legitimate value and is asserted through the source switch elsewhere.
         */
        ok(Array.isArray(parts.lineHints) && parts.lineHints.length === 1
          && parts.lineHints[0] === '碎碎念：一行一句，摸到这个部位时随机说一句',
          `and ONE grey hint shared by every 碎碎念 box (${JSON.stringify(parts.lineHints)})`);
        /**
         * And EVERY part whose box is empty answers from the SHIPPED table — all ten of them since 2026-10-14, in two
         * pools each (点击 / 长按).
         *
         * The operator's condition (2026-10-12: "默认碎碎念…匹配词和AI提示词写进系统底层，AI提示词那里默认留空，跟未输入状态
         * 一样") is what matters, and it is the PAIR: the defaults are readable AND nothing was written into the user's
         * settings to get them. What is still special about 胸部 and 屁股 is the 提示词 — they are the only two rows
         * with one — and their two original lines still lead their click pools.
         */
        const builtinSpeech = parts.builtinSpeech || [];
        ok(builtinSpeech.length === parts.count
          && builtinSpeech.every((entry) => entry.boxEmpty === true)
          && builtinSpeech.every((entry) => Array.isArray(entry.lines) && entry.lines.length === 20
            && Array.isArray(entry.holdLines) && entry.holdLines.length === 20
            && entry.lines.indexOf(entry.holdLines[0]) === -1)
          && builtinSpeech.some((entry) => entry.label === '胸部'
            && entry.lines[0] === '变态！' && entry.lines[1] === '大色狼！'
            && entry.prompt === '被主人摸到胸部了，必须要傲娇的回骂这个摸人家胸的变态主人才行。')
          && builtinSpeech.some((entry) => entry.label === '屁股'
            && entry.lines[0] === '变态！'
            && entry.prompt === '被主人摸到屁股了，必须要傲娇的回骂这个摸人家屁股的变态主人才行。')
          && builtinSpeech.filter((entry) => entry.prompt !== '').length === 2,
        `all ${parts.count} shipped parts answer from the shipped table while their boxes stay empty — twenty 点击 and twenty 长按 lines each, and 胸部 / 屁股 the only two with a 提示词 (${builtinSpeech.map((entry) => `${entry.label}:${entry.lines && entry.lines.length}+${entry.holdLines && entry.holdLines.length}`).join(' ')})`);
        /**
         * And the shipped table is IN FORCE only while 台词来源 is the built-in one — a second fact, published
         * separately on purpose.
         *
         * The operator's rule (2026-10-12: 「如果设置了AI碎碎念，就停止输出内置的碎碎念」) makes "this row has a built-in
         * voice" and "the pet would say it right now" two different claims, and only the second one is a promise to
         * the user. `speaking` is that second claim, so a build that switched the table off for the pet and left the
         * settings page promising it fails here rather than on the operator's screen.
         */
        ok(builtinSpeech.every((entry) => entry.speaking === true),
          `with the source shipped on 内置短语, so those lines are what a press says (${JSON.stringify(builtinSpeech.map((entry) => entry.speaking))})`);
        ok(parts.max === 24, `the cap the add button obeys is published (${parts.max})`);
        /**
         * The PICKER, from the model's own structure list — and the count of names the heuristic cannot place.
         *
         * `unrecognised` is the number that justifies this whole section: a rig whose hair is `LiuHai` and whose
         * tail is `WeiBa` has structures that answer `null` to "what part is this", and those are the ones a user
         * builds a part for.
         */
        ok(parts.picked > 10, `the structure picker is filled from the model (${parts.picked} names)`);
        ok(parts.unrecognised > 0,
          `and ${parts.unrecognised} of those names cannot be placed by name alone, which is what parts are for`);
        /**
         * And the editor WORKS, driven through the real page in the real window.
         *
         * The counts above prove the section rendered; these prove the four gestures do what they say — a button
         * that did nothing, a structure box that dropped what was typed and a mode toggle that did not toggle
         * would all publish the same counts. The launcher performs them (`probePartsEditor` in `desktop/main.js`)
         * and this is where the numbers are judged.
         */
        const edit = settings.report.partsEdit || {};
        /**
         * And the 部位 box hint follows the SOURCE and names no part, driven through the real page.
         *
         * It used to spell out 胸部's shipped lines (「留空则说内置的 变态！ / 大色狼！」); the operator removed that
         * (2026-10-13: 「碎碎念框那行也变成通用灰字」), so what is asserted now is the pair of GENERIC wordings —
         * 内置短语's, and the one AI mode uses while the model is the source — and that the shipped lines themselves
         * are still in force (the `builtinSpeech`/`speaking` assertions above are that half).
         *
         * It is driven through the STORE rather than through the 台词来源 picker, and that is the honest path: the
         * picker lives on 通用设置 while the 部位 table lives on 模型参数, so this page can never see it move; what it
         * does see is another document writing the store, which is its own `storage` listener. Measured on the DOM
         * the probe read back, because the published state is republished on a poll.
         */
        ok(edit.partLinesBuiltin === '碎碎念：一行一句，摸到这个部位时随机说一句'
          && edit.partLinesAi === '碎碎念：一行一句；留空则由 AI 按这个部位的提示词生成',
        `the 部位 hint follows the source and spells out no shipped line (${JSON.stringify(edit.partLinesBuiltin)} -> ${JSON.stringify(edit.partLinesAi)})`);
        ok(edit.partLinesRestored === edit.partLinesBuiltin,
          `and the table is repainted back when the store says the built-in source again (${JSON.stringify(edit.partLinesRestored)})`);
        // The shipped row count is read off the page rather than written here: it moved once already (2026-10-12,
        // when 大腿/小腿/脚/胸部/屁股 joined the table) and a literal in this assertion is what made that a failure
        // instead of a number. `beforeAdd`/`afterAdd` differing by one is the gesture being asserted.
        ok(edit.before === parts.count && edit.afterAdd === edit.before + 1,
          `新增部位 adds exactly one part (${edit.before} -> ${edit.afterAdd}, ${parts.count} shipped)`);
        ok(edit.chip === 'LiuHai',
          `a structure typed into a part becomes a chip (${JSON.stringify(edit.chip)})`);
        ok(edit.chipHint === '未识别',
          `and the chip says the name alone cannot place it (${JSON.stringify(edit.chipHint)})`);
        ok(edit.structures >= 1, `which the part then owns (${edit.structures})`);
        ok(edit.modeBefore === '前缀' && edit.modeAfter === '精确',
          `its match mode toggles between prefix and exact (${edit.modeBefore} -> ${edit.modeAfter})`);
        ok(edit.chipsAfterDrop === 0,
          `and removing the chip leaves the part standing (${edit.chipsAfterDrop} chips, ${edit.after} parts)`);
        /**
         * And the other two things the section promises: RENAME and DELETE.
         *
         * They are separate gestures with separate failure modes — a label box that never writes back and a
         * 删除 button wired to the wrong row both leave a section that looks and counts perfectly right.
         */
        ok(edit.renamedLabel === '刘海',
          `a part can be renamed (${JSON.stringify(edit.renamedLabel)})`);
        ok(edit.afterDelete === edit.before,
          `and deleted, leaving the shipped parts alone (${edit.afterDelete} rows)`);
        /**
         * And the structure BROWSER: it opens, it is full, it SCROLLS, it filters, and a click adds.
         *
         * The scroll assertions are the ones this check exists for. The operator's report was "添加结构的下拉框无法滚动，
         * 也没有滚动条" against the native `<input list>` popup it used to be — and a panel that renders 160 rows into
         * a box that does not overflow is indistinguishable, from every other angle, from one that works. So the
         * probe reads the box's real `scrollHeight`/`clientHeight` and then moves `scrollTop`, which only a box
         * that actually scrolls can do.
         */
        ok(edit.pickerOpen === true, '浏览… opens the structure browser');
        ok(edit.pickerRows > 10,
          `with the model's own structures listed (${edit.pickerRows} rows)`);
        ok(edit.pickerHasModelNames === true,
          `including the anatomical ones (${(edit.pickerSample || []).join(' / ')})`);
        ok(edit.pickerScrollHeight > edit.pickerClientHeight,
          `the list is TALLER than its box (${edit.pickerScrollHeight} > ${edit.pickerClientHeight}), which is what makes a scrollbar real`);
        ok(edit.pickerScrolledTo > 0,
          `and it really scrolls: scrollTop moved to ${edit.pickerScrolledTo}`);
        ok(edit.pickerFilteredRows > 0 && edit.pickerFilteredRows < edit.pickerRows,
          `typing in the filter narrows the list (${edit.pickerRows} -> ${edit.pickerFilteredRows} for "hair")`);
        ok(Boolean(edit.pickerPicked) && edit.chipsFromPicker >= 1,
          `and clicking a row adds that structure to the part (${JSON.stringify(edit.pickerPicked)}, ${edit.chipsFromPicker} chip)`);
        ok(edit.pickerClosed === true, 'and 关闭 puts the browser away');
        ok(edit.pickerReopened === true,
          'and 浏览… opens it again after 关闭 — this panel keeps its state in module state, so it has no stale reference to be trapped by');
        ok(edit.pickerClosedAgain === true, 'with 关闭 working the second time as well');
        ok(edit.rowsDrawn === edit.before,
          `with one control row per part once the edit is undone (${edit.rowsDrawn})`);
        /**
         * And the EXPRESSION pickers: one dropdown per row, no checkbox pile, and no jump when one is ticked.
         *
         * The reported bug was "在部位中勾选或者取消表情时，每次点击都会让页面返回到最上面一条": every tick repainted the
         * whole table, and emptying a `<tbody>` momentarily collapses the document, so the browser clamped the scroll
         * to the top. `stayedPut` is that bug, measured — the page is scrolled down, a name is ticked from the menu,
         * and `scrollTop` must not move. `pageScrolls` guards the assertion from being vacuous on a page too short
         * to scroll, and `inlineBoxes` proves the pile is really gone rather than merely hidden.
         */
        const pickers = shown.pickers || {};
        ok(pickers.buttons >= 9,
          `every row has an expression dropdown (${pickers.buttons} buttons for ${pickers.emotionRows} 情境 rows plus parts)`);
        ok(pickers.inlineBoxes === 0,
          `with no expression checkbox left piled in a row (${pickers.inlineBoxes})`);
        ok(edit.pageScrolls === true, 'the settings page is long enough to scroll, so the jump can be measured');
        ok(edit.menuOpen === true && edit.menuBoxes >= 3,
          `a row's dropdown opens with the model's expressions in it (${edit.menuBoxes} boxes)`);
        ok(edit.menuBounded === true,
          `and that menu is bounded (overflow-y: ${edit.menuOverflow}, max-height: ${edit.menuMaxHeight}) rather than a growing row`);
        ok(edit.inlineBoxes === 0,
          `and it keeps the expressions OUT of the row (${edit.inlineBoxes} inline boxes)`);
        ok(Boolean(edit.tickedName) && edit.pickTriggerAfter !== edit.pickTriggerBefore,
          `ticking one updates that row's label (${JSON.stringify(edit.pickTriggerBefore)} -> ${JSON.stringify(edit.pickTriggerAfter)})`);
        ok(edit.stayedPut === true,
          `and the page does NOT jump back to the top (scrollTop ${edit.scrollBefore} -> ${edit.scrollAfter})`);
        /**
         * AND IT OPENS AGAIN — the second report against this picker: "选中一个表情后，再点表情的下拉列表就无效了，必须刷新
         * 页面重新进". Closing detached the panel but left the row's own reference to it, so every later click took the
         * "close" branch: the row was dead until a repaint, and a tick no longer repaints anything. All three closing
         * paths are driven, because they leave through different code (the trigger, Escape, an outside pointerdown),
         * and the reopened panel has to show the live row rather than the row it was first built from.
         */
        ok(edit.closedByTrigger === true, 'clicking the trigger again closes the menu');
        ok(edit.reopenedAfterTrigger === true,
          'and clicking it ONCE MORE opens it again, instead of leaving the row dead until a reload');
        ok(edit.reopenedTicked === true, 'with the rebuilt menu showing the row as it is now (the tick is still there)');
        ok(edit.closedByEscape === true, 'Escape closes the menu');
        ok(edit.reopenedAfterEscape === true, 'and the row still opens afterwards, whichever way it was closed');
        ok(edit.closedByOutside === true, 'a click outside closes it too');
        ok(edit.reopenedAfterOutside === true, 'and the row still opens after that as well');
        ok(edit.menuClosedAtEnd === true, 'with the menu put away once the probe is done');
        ok(edit.pickTriggerRestored === '无',
          `while unticking it goes back to 无 (${JSON.stringify(edit.pickTriggerRestored)})`);
        ok(shown.expressionRows === undefined,
          'with the standalone expression/口型 table gone, not merely hidden');
        ok(shown.springChains === 2, `and a control block per chain (${shown.springChains})`);
        // The 视线 section: the two variables the user asked to be settable rather than baked in, and the
        // resolved "auto" span, which is what proves the section is wired rather than merely present.
        const gaze = shown.gaze || {};
        ok(gaze.controls === true, 'and the gaze controls (curve + both spans) exist');
        /**
         * The page must be SHOWING the shipped slope, and the expectation is read from `core.DEFAULTS` rather than
         * written here.
         *
         * It was a literal (0.4) and went stale the moment the operator moved the default to 0.1 — a red that no one
         * saw, because this half only runs when the window does. The literal pin for WHAT that number is belongs to
         * the core suite, which owns the constant; this half's claim is that the PAGE agrees with it.
         */
        ok(Math.abs(Number(gaze.curve) - core.DEFAULTS.gazeCurve) < 1e-9,
          `whose curve defaults to the shipped slope (${gaze.curve}, shipped ${core.DEFAULTS.gazeCurve})`);
        ok(Number(gaze.spanX) > 0 && Number(gaze.spanY) > 0,
          `and whose "auto" spans resolve to a real distance (${gaze.spanX} x ${gaze.spanY})`);
        /**
         * And the line that says what the RENDERER is applying.
         *
         * It exists because "the gaze curve doesn't take effect live" could not be answered from this window:
         * the setting did arrive (the host's version bumped, and both surfaces feed the curve into
         * `core.pointerAim` every frame), but the visible effect is small near the pet and nothing here said
         * which curve the head was using. The check is on the ELEMENT rather than on a value, because the
         * value only exists when a floating window is running — and this window is not one.
         */
        ok(gaze.appliedElement === true,
          'and the line that reports what the renderer applies, which is what makes a "no effect" report answerable');
        ok(gaze.applied === null || typeof gaze.applied === 'object',
          'which stays empty until a floating window answers, rather than showing a guess');
        /**
         * And TWO size controls, one per surface.
         *
         * `size` moves the pet inside DSH's window; `windowSize` moves the floating window, whose frame is the
         * whole screen. They shared one key until 2026-10-10, so reloading DSH handed the window the in-app
         * pet's percentage. The page reports both numbers AND the presence of both controls, which is the
         * difference between "the split exists" and "the 其他 section did not render".
         */
        /**
         * AND THE TWO SETTINGS PAGES ARE TWO PAGES (operator, 2026-10-11: "模型导入和动作导入，AI碎碎念，状态，视线，鼠标互动和其他等
         * 不涉及模型定制的内容，要分流到总设置面板中，然后针对每个模型有自己的模型参数面板", and then the follow-up that made them
         * separate documents: "模型参数和通用设置（原总设置）是两个单独的页面").
         *
         * The launcher opened the model's page (`/vrmpet3d/config`) and then NAVIGATED the same window to the sibling ROUTE
         * (`/vrmpet3d/global`), reading both: so this asserts each page said which page it is (`data-page`, compared against
         * the markup that was served rather than inferred from section counts), that the two answers differ, and that the
         * global keys came from the global reading (the two pages run one script, so a naive merge would look right while
         * showing the wrong page).
         */
        ok(Array.isArray(shown.pages) && shown.pages.length === 2
          && shown.pages[0] === 'model' && shown.pages[1] === 'global'
          && Boolean(shown.globalPage) && shown.globalPage.page === 'global'
          && Boolean(shown.modelPage) && shown.modelPage.page === 'model',
          `the settings window is two PAGES, opened as two routes, and each reading is the page it claims to be (${JSON.stringify(shown.pages)})`);
        /**
         * And the SPLIT is real in the markup, not only in the readout: each page carries its own half and none of the
         * other's. This is the assertion the one-page split could not have made — a hidden section still has its ids in
         * the document, so `element('motion-list')` answered on both panels and nothing said so.
         */
        const modelPage = shown.modelPage || {};
        const globalPage = shown.globalPage || {};
        ok(modelPage.speech && modelPage.speech.controls === false
          && modelPage.motions && modelPage.motions.controls === false
          && globalPage.parts && globalPage.parts.rowsDrawn === 0
          && globalPage.springChains === 0
          && globalPage.modelOptions === null,
          'and neither page carries the other\'s sections (no 碎碎念/状态 on the model page,'
            + ' no 部位/弹簧骨/model picker on the 通用设置 page)');
        /**
         * AND THE 通用设置 PAGE KNOWS THE MODEL'S VOCABULARY, which it has to fetch to know.
         *
         * Operator, 2026-10-13: 「通用设置面板中，状态与动作中，每个动作的表情和口型设置始终是空的，必须动态从模型上加载」. The
         * per-clip 表情/口型 dropdowns are built from the model's own expression list, and this page used to refuse to
         * ask for it (the guard tested for the MODEL PICKER, which only the other page has) — so every one of those
         * dropdowns held its single 跟随 entry and nothing else, for good. The fixture model declares expressions, so
         * "loaded" means options beyond 跟随, in both dropdowns.
         *
         * The MOUTH count is not asserted here because this fixture has no mouth presets at all (blink, happy,
         * surprised, wag) — the empty-mouth half of the same report is a VOCABULARY bug, pinned against the bundled
         * 0.x `SampleModel.vrm` in the core suite.
         */
        const clipFaces = (globalPage.motions || {}).clipFaceOptions || {};
        ok(clipFaces.expression > 0 && clipFaces.selects >= 2,
          `and the per-clip 表情/口型 dropdowns list the MODEL's own words, loaded on this page`
            + ` (${clipFaces.expression} expressions, ${clipFaces.mouth} mouth shapes in this fixture, model ${clipFaces.model})`);
        const sizes = shown.sizes || {};
        ok(sizes.controls === true,
          'and two separate size controls, one per surface, rather than one shared key');
        ok(Number(sizes.app) > 0 && Number(sizes.window) > 0,
          `with a stored percentage behind each (app ${sizes.app}%, window ${sizes.window}%)`);
        /**
         * And 空闲休眠: the nap timeout, which the deleted pet settings panel was the ONLY control for.
         *
         * The failure this names is the one deleting that panel created: `cleanPreferences` still honours the
         * preference, the machine still naps on it, and with the panel gone no surface could change it — a row
         * that is missing (`control` false) or rendered but unbound (`selected` disagreeing with `value`) reads
         * from every other angle like a preference nobody wants to change. `options` is asserted because the
         * three values the cleaner accepts ARE the whole domain.
         */
        const sleep = globalPage.sleep || {};
        ok(sleep.control === true && sleep.options === 3 && sleep.selected === sleep.value
          && Number(sleep.value) > 0,
          `and the 空闲休眠 row, bound to the stored nap timeout (${JSON.stringify(sleep)})`);
        /**
         * And 调试模式: the switch that puts BOTH surfaces on screen (`petSurface: 'both'`).
         *
         * It belongs on this page — it is about the two surfaces together, next to 应用内大小 and 悬浮窗大小 —
         * and it is asserted as the control AND the preference behind it, read off the 通用设置 page's own
         * reading (`globalPage`), which is the page that draws it. A box that rendered without being bound is
         * the failure worth naming here: from every other angle it looks exactly like a working debug switch.
         */
        const debugMode = globalPage.debugMode || {};
        ok(debugMode.control === true && debugMode.surface === core.DEFAULTS.petSurface && debugMode.checked === false,
          `and the 调试模式 switch, shipped off on the shipped surface (${JSON.stringify(debugMode)}, shipped ${core.DEFAULTS.petSurface})`);
        /**
         * And the 碎碎念 section: the pet's own voice, its per-state lines and the AI half.
         *
         * Three layers, asserted as COUNTS and FLAGS rather than as Chinese labels: the throttle's four numbers,
         * one lines box and one prompt box per state, and the AI controls plus 试一句. A section that failed to
         * bind would leave the pet chattering with no way to stop it; a state box that failed to render would
         * leave the user editing a box that is not there.
         */
        const speech = shown.speech || {};
        ok(speech.controls === true, 'and the 碎碎念 controls (on/off, hold, gap, idle window)');
        ok(speech.enabled === true, 'which ship switched on, as the operator asked for');
        ok(Number(speech.holdSeconds) > 0 && Number(speech.idleMaxSeconds) >= Number(speech.idleMinSeconds),
          `with a usable throttle (hold ${speech.holdSeconds}s, idle ${speech.idleMinSeconds}-${speech.idleMaxSeconds}s)`);
        ok(speech.sourceControls === true && speech.source === 'builtin',
          `a source picker, shipped on the built-in table (${speech.source})`);
        ok(speech.stateRows === 6 && speech.lineBoxes === 6 && speech.promptBoxes === 6,
          `one lines box AND one prompt box per state (${speech.stateRows} rows, ${speech.lineBoxes} + ${speech.promptBoxes} boxes)`);
        /**
         * And what an EMPTY box is CALLED follows the source.
         *
         * The report was "AI碎碎念开启后，面板里的各种状态后面就不应该写'用内置短语'了，应该是写'用内置AI生成提示词'" — a label that
         * kept promising the built-in table after the table had been switched off. The shipped source is `builtin`, so
         * what this asserts on a fresh profile is that label; the table itself is pinned in the core suite
         * (`EMPTY_LINES_LABEL`'s three entries are what `showSpeech` reads), and `rowLabels` is the DOM's own account of
         * what every collapsed state row actually shows.
         */
        ok(speech.emptyLabel === '用内置短语',
          `an empty box is called what the SOURCE makes it (${JSON.stringify(speech.emptyLabel)} for source ${speech.source})`);
        ok(speech.emptyPlaceholder === '留空则用内置短语' && speech.placeholders === '留空则用内置短语',
          `and the box itself says the same thing (${JSON.stringify(speech.placeholders)})`);
        ok((speech.rowLabels || []).length === 1 && speech.rowLabels[0] === speech.emptyLabel,
          `with every collapsed state row showing that one label, not a stale one (${JSON.stringify(speech.rowLabels)})`);
        ok(Object.keys(speech.lineCounts || {}).length === 6,
          'with the per-state line counts published, so an empty box is readable from outside');
        ok(speech.aiControls === true, 'the AI half\'s provider, URL, model, key and persona controls');
        ok(speech.testControls === true, 'and the 试一句 picker, wired whether or not its block is on screen');
        /**
         * THE AI HALF IS NOT ON SCREEN while the built-in table is chosen (operator, 2026-10-13: 「如果台词来源是
         * 内置台词，则下方的AI相关设置不显示」).
         *
         * A different fact from the two checks above, which are about the controls EXISTING: with 内置短语 the model
         * is never asked, so its provider, persona, temperature and 试一句 are settings for a feature that is not in
         * use. The source is asserted to be builtin four lines up, in the same published snapshot, which is what
         * makes this deterministic rather than a race.
         */
        ok(speech.aiVisible === false,
          `and it is HIDDEN while the source is the built-in table (visible=${speech.aiVisible})`);
        /**
         * The shipped route, and the persona that now ships WITH it.
         *
         * The persona used to be empty here ("no key, no persona and a temperature"); the operator's own character
         * became the default on 2026-10-13, so the page carries it out of the box while the credential still ships
         * unset. The EXACT string is pinned by the core suite, which owns the constant — this half is the page's own
         * account of what it put in the box.
         */
        ok(speech.ai && speech.ai.provider === 'dsh' && speech.ai.keySet === false
          && speech.ai.personaLength > 0 && Number(speech.ai.temperature) > 0,
          `whose route ships as DSH with no key, the shipped persona (${speech.ai.personaLength} chars) and a temperature`);
        ok(JSON.stringify(speech).indexOf('apiKey') === -1,
          'and the credential FIELD is never published — only whether one is set');
        ok(speech.llm === null || typeof speech.llm.available === 'boolean',
          `with the live provider catalog reported as data (${JSON.stringify(speech.llm)})`);
        /**
         * And the CATALOG'S ANSWER reaches the STORE, not merely the pickers.
         *
         * This is the operator's 2026-10-12 report as a check: 「即便配置了DeepSeek Account，点击试一句那里的生成，仍然会
         * 报错'失败：还没有选择 DSH 的 provider 和模型'」. `/vrmpet3d/llm` offers two providers, and two models once one is
         * named, while the fresh stub store has NO `dshProvider` and NO `dshModel` — and a `<select>` with no
         * matching value still DISPLAYS its first option, so both pickers read as configured while the pair the
         * host would use is empty. What is asserted is the fix: the page adopts the option it is already showing,
         * and the pair LEAVES the page (the patches the stub store received), because 试一句 asks the HOST.
         */
        ok(speech.ai && speech.ai.dshProvider === 'fake-official' && speech.ai.dshModel === 'fake-1',
          `the catalog's provider and its first model are ADOPTED, not merely displayed (${(speech.ai || {}).dshProvider || 'none'} / ${(speech.ai || {}).dshModel || 'none'})`);
        ok((speech.models || []).indexOf((speech.ai || {}).dshModel) !== -1,
          `and the model in the store is one the picker itself offers (${JSON.stringify(speech.models)})`);
        const speechPatches = (settings.settingsPatches || [])
          .map((patch) => patch && patch.preferences && patch.preferences.speech)
          .filter(Boolean);
        ok(speechPatches.some((entry) => entry.ai && entry.ai.dshProvider === 'fake-official'
          && entry.ai.dshModel === 'fake-1'),
        `and the adopted pair was WRITTEN to the store, which is what a line is generated from (${speechPatches.length} speech patches)`);
        ok(speech.testResultSameRow === true,
          "and 试一句's answer shares the row with 生成, rather than appearing elsewhere on the page");
        /**
         * And the 模型导入 section: a folder picker and the list of what is already imported.
         *
         * The backend has existed since §21 (the page only reads and writes the host's `/vrmpet3d/models`), so what
         * this asserts is that the section EXISTS and that the page knows whether it has a launcher bridge to
         * open a dialog with. The stub host in this suite does not serve that route — which is exactly the case
         * the page has to survive with a readable message rather than an empty section.
         */
        const imports = shown.import || {};
        ok(imports.controls === true, 'and the 模型导入 controls (a folder picker and the imported list)');
        ok(typeof imports.picker === 'boolean',
          `which knows whether a native folder picker is available here (${imports.picker})`);
        ok(Array.isArray(imports.dirs),
          `and lists what the host has imported (${(imports.dirs || []).length})`);
        /**
         * And 动作导入, the parallel section over `/vrmpet3d/motions`.
         *
         * A separate route and a separate list file from the model one, so it is asserted separately: this
         * section is what makes an authored clip usable without editing the profile's config, and the 状态 rows
         * below it offer nothing to tick without it.
         */
        const motionImports = shown.motionImport || {};
        ok(motionImports.controls === true, 'and the 动作导入 controls (its own picker and imported list)');
        ok(typeof motionImports.picker === 'boolean',
          `whose picker availability is reported too (${motionImports.picker})`);
        ok(Array.isArray(motionImports.dirs) && Number.isFinite(Number(motionImports.clips)),
          `and which counts the motion directories and the clips behind them (${(motionImports.dirs || []).length} dirs, ${motionImports.clips} clips)`);
        // The 状态 section: one box set per state — the status line the pet shows above its head, plus the
        // motion it plays — listing the catalog the host serves and counting how many of those clips declare
        // themselves as playing once. The page publishes these numbers rather than the DOM's text, so the
        // check does not depend on the language.
        //
        // NINE rows since 2026-10-13 (拖动中 / 抛掷中 / 落地中 carry a motion row now, 「缺少拖动时模型动作的设置」)
        // against SIX status boxes: the prompt above the pet's head is a claim about what DSH is doing, and being
        // carried is not something DSH is doing, so `buildStatusRow` is skipped for the three pointer poses.
        const motions = shown.motions || {};
        ok(motions.controls === true, 'and the 状态 section exists');
        ok(motions.rows === 9, `with one box set per state (${motions.rows})`);
        ok(motions.statusRows === 6, `and a status line in each of the six DSH states (${motions.statusRows})`);
        /**
         * The five prompts the operator asked for, checked as the SHIPPED defaults rather than as text on the
         * screen: this stub's preferences carry no `status` map, so what comes back is exactly what a fresh
         * profile would put above the pet's head.
         */
        const statusTexts = motions.statusTexts || {};
        /**
         * 工作中 is DSH's running line WITHOUT a clock (operator, 2026-10-13: 「深度求索中后面不加任何时间了」).
         *
         * The `{duration}` token is still the language a line may use — the settings page documents it and the core
         * suite pins the substitution — but it is no longer what ships: the default is the app's token-free label.
         */
        ok(statusTexts.working === '深度求索中 ···',
          `工作中 shows DSH's running line with no clock (${statusTexts.working})`);
        ok(statusTexts.waiting === '我有问题要问你', `等待确认 asks its question (${statusTexts.waiting})`);
        ok(statusTexts.done === '任务达成', `任务完成 reports it (${statusTexts.done})`);
        ok(statusTexts.error === '遇到问题了...', `出错 reports the failure (${statusTexts.error})`);
        ok(statusTexts.resting === '' && statusTexts.offline === '',
          'while 空闲 and 离线 say nothing, which is the shipped default');
        ok((motions.statusAnimations || {}).working === 'shimmer',
          'and 工作中 is the one state drawn with DSH\'s own blue sweep');
        /**
         * The 2026-10-11 rules, as the page expresses them: the two notices are gold/bold and red, and the
         * 持续时间 field is refused where a clock may not end the line — 等待确认 waits for the answer, and the
         * two notice states wait for the user to go back to the session that reported them.
         */
        const timing = motions.statusTiming || {};
        ok(JSON.stringify(timing.untimed) === JSON.stringify(['waiting', 'done', 'error']),
          `the event-ended states are named by core and shown here (${JSON.stringify(timing.untimed)})`);
        ok(timing.waitingLocked === true,
          'and the 等待确认 持续时间 field is disabled, because only an answer ends that line');
        ok(Number(timing.noticeSeconds && timing.noticeSeconds.done) >= 4.2,
          `while 任务达成/出错 read theirs as a minimum hold (${timing.noticeSeconds && timing.noticeSeconds.done}s)`);
        const tones = timing.tones || {};
        ok(tones.done && tones.done.tone === 'gold' && tones.done.bold === true,
          '任务达成 is published as gold and bold');
        ok(tones.error && tones.error.tone === 'danger', 'and 出错 as the danger colour');
        ok(motions.offered === 2, `listing the catalog the host serves (${motions.offered})`);
        ok(motions.oneShot === 1, `and counting the one-shot PAIR it declares (${motions.oneShot})`);
        /**
         * The per-state controls of the 2026-10-09 round: a play-mode dropdown and two face dropdowns
         * (expression, mouth) for every clip ticked IN A STATE. The stub ticks both clips in `resting`, so two
         * modes and four face selects — and the play mode is a per-state decision now, which is why the old
         * "one row per clip" table is gone and this counts pairs.
         */
        ok(motions.modeRows === 2, `with a play-mode dropdown per ticked clip in a state (${motions.modeRows})`);
        ok(motions.faceRows === 4, `and an expression and a mouth dropdown beside each (${motions.faceRows})`);
        // The 凝视 switch the operator asked for on 2026-10-09 late: one per ticked clip, beside the three
        // dropdowns.
        ok(motions.gazeRows === 2, `and a gaze switch on each row too (${motions.gazeRows})`);
        ok(motions.everyRows === 9, `and one interval line per state (${motions.everyRows})`);
        /**
         * AND THE TICK BOX COLLECTS ONLY CLIPS.
         *
         * Operator report, 2026-10-12: "最后一项 idle/touch hair2.vrma 无法选中". The cause was inside the page —
         * `onMotionToggle` gathered every checked checkbox in the state's row, so each ticked clip's 凝视 switch
         * (a checkbox written without a `value`, whose DOM default is `'on'`) was stored as a clip id, and the
         * junk entries then took slots in the per-state list until the clip the user had just ticked was the one
         * dropped. The clip ids are clean when they reach the host, so no server-side check can see it: the probe
         * ticks the last clip in 空闲 and reports what the page thinks is selected against what the core keeps.
         */
        const pick = settings.report.motionPick || {};
        ok(!pick.error, `the clip picker is driven (${pick.error || 'ok'})`);
        ok(pick.offered > 0 && pick.gazeRows > 0,
          `with ${pick.offered} clip tick boxes beside ${pick.gazeRows} 凝视 switches in the same row`);
        ok(Array.isArray(pick.junkBefore) && pick.junkBefore.length === 0
          && Array.isArray(pick.junkAfter) && pick.junkAfter.length === 0,
          `and every stored id is a clip the catalogue offers, before and after a tick `
            + `(${JSON.stringify(pick.junkBefore)} -> ${JSON.stringify(pick.junkAfter)})`);
        ok(pick.lastStillTicked === true,
          `the last clip's tick sticks, which is the report itself (${pick.lastId} ${pick.lastStillTicked})`);
        ok(pick.tickedAfter === pick.offered,
          `and every offered clip ends up in the state's list (${pick.tickedAfter} of ${pick.offered})`);
        /**
         * AND THE FOLDERS SCOPE THE LISTS — both shapes in one run.
         *
         * Operator's request, 2026-10-12: "把对应的动作直接解析到指定目录，这样在选择动作的时候就不会出现很长一串".
         * The stub declares ONE mapping (`done` → `plain`, where both its clips live) and leaves the other EIGHT
         * states undeclared, so a state with an entry is offered only its own folders' clips and a state
         * without one is offered the catalogue, exactly as every build before this block did. (Eight, not five,
         * since 2026-10-13: 拖动中 / 抛掷中 / 落地中 have rows of their own — 「缺少拖动时模型动作的设置」.)
         *
         * The mapping USED to be missing here, and that empty case is why the suite stayed green while the
         * shipped pack's six mappings came up with no clips at all: the page compared a state's folder LIST to
         * a single folder name, which is never true (operator: "明明有26支可选，下面每一条却都是空着的").
         * `scoped.done.drawn` is the number that catches it — 2 with the mapping read, 0 with it.
         */
        const scoped = pick.rows || {};
        const folderNames = (value) => (Array.isArray(value) ? value : (value ? [value] : []));
        ok(Object.keys(scoped).length === 9, `all nine states are drawn (${Object.keys(scoped).length})`);
        ok(Object.values(scoped).every((row) => row.outsideFolder.length === 0)
          && folderNames(scoped.done && scoped.done.folder).indexOf('plain') !== -1
          && Object.entries(scoped).filter(([state]) => state !== 'done').every(([, row]) => row.folder === null),
          `the mapping is read per state and nothing is drawn from outside it (${JSON.stringify(scoped.done)})`);
        ok(Object.values(scoped).every((row) => row.drawn === pick.offered),
          `and every state's list is populated, mapped or not (${Object.values(scoped).map((row) => row.drawn).join(',')})`);
        /**
         * The mouse-interaction controls (2026-10-10: "把鼠标互动的参数加入设置面板"), and the folding rule for a
         * model with many chains ("如果弹簧骨选项超过5个，就折叠起来").
         *
         * The fixture has TWO chains, so the fold must NOT be there — that is the ≤5 half of the rule. The other
         * half needs a model with more than five, which is why the stub can be asked for a chain count.
         */
        const wind = shown.wind || {};
        ok(wind.rows === 4, `with the four mouse-interaction controls (${wind.rows})`);
        ok(Math.abs(Number(wind.power) - core.DEFAULTS.windPower) < 1e-9,
          `showing the strength the operator settled on (${wind.power})`);
        // Read from the same constant the page's cleaner falls back to, for the reason given at the gaze block: this
        // literal was 0.1 and went stale when the operator moved the reach to 0.15.
        ok(Math.abs(Number(wind.radius) - core.DEFAULTS.windRadius) < 1e-9,
          `and its reach (${wind.radius}, shipped ${core.DEFAULTS.windRadius})`);
        ok(shown.springFolded === null,
          `and no folding group for a model with only two chains (${JSON.stringify(shown.springFolded)})`);
      }
    }
  }

  /**
   * The OTHER half of the folding rule, and it needs a second window.
   *
   * "如果弹簧骨选项超过5个，就折叠起来，用户可以主动展开" (2026-10-10) is only testable against a model with more
   * than five chains, and the fixture has two — so the stub is asked for nine (`?chains=9`, its own chains
   * repeated) and the page must come up FOLDED, with the count in the summary and the rows built inside it.
   */
  const foldedWindow = await runLiveSettingsWindow(live.runtime, '&chains=9');
  if (foldedWindow.skipped) {
    console.log(`  note  folded settings window skipped: ${foldedWindow.skipped}`);
  } else {
    ok(foldedWindow.ok, `the settings window renders a nine-chain model too (${foldedWindow.summary})`);
    const nineShown = foldedWindow.report && foldedWindow.report.pageState;
    ok(Boolean(nineShown), 'and published what it rendered');
    if (nineShown) {
      ok(nineShown.springs === 9, `with all nine chains listed (${nineShown.springs})`);
      ok(nineShown.springChains === 9, `and a control block per chain inside the group (${nineShown.springChains})`);
      ok(Boolean(nineShown.springFolded) && nineShown.springFolded.open === false,
        `and the group SHUT by default (${JSON.stringify(nineShown.springFolded)})`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`);
if (failures.length === 0) {
  console.log(`desktop: ${passed} checks passed${live.skipped ? ' (live window skipped)' : ''}`);
  process.exit(0);
}
console.log(`desktop: ${passed} passed, ${failures.length} FAILED`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);

// ===========================================================================
// The live half
// ===========================================================================

/**
 * Serve the window's page the way the plugin's host half does, so the launcher can be pointed
 * at a real URL without starting DSH.
 *
 * Deliberately a real HTTP server on the plugin's own origin: the page fetches its sources and
 * its model bytes with relative `/vrmpet3d/...` URLs, and a `file://` page would change exactly
 * that behaviour.
 */
async function startPageServer() {
  /**
   * How many spring chains the model-info route should claim.
   *
   * 0 is the fixture as it is. A page opened with `?chains=9` sets it, because the page then fetches model-info
   * with `?m=` alone — so the override has to live on the server between those two requests.
   */
  let chainOverride = 0;
  /**
   * Every settings patch the page POSTed, in order.
   *
   * Kept because one thing this suite has to prove is not visible in the page's own readout: that a pair the
   * page adopted from the catalog actually LEFT the page. 试一句 asks the HOST, so a pair that only lives in
   * the window is exactly the failure being covered.
   */
  const settingsPatches = [];
  // The page's own sources, exactly as the host's whitelist serves them — `menu.js` included: the page builds its
  // right-click menu from the shared module, so a stub that omitted it would fail the window for a reason that does
  // not exist in the app. `pages.css` is not in this set because the branch below answers it with its own type.
  const sources = new Set([
    'client.vendor.js', 'core.js', 'scene.js', 'client.js', 'desktop-page.js',
    'config-page.js', 'menu.js',
    // The model picker the guide's ② 偏好模型 step mounts: the component and the page script that mounts it.
    'model-picker.js', 'picker-page.js',
  ]);
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      res.end(body);
    };
    if (url.pathname === '/vrmpet3d/window' || url.pathname === '/vrmpet3d/window/') {
      send(200, 'text/html; charset=utf-8', readFileSync(join(ROOT, 'lib', 'desktop-page.html')));
      return;
    }
    // The settings window's page, served the same way the host serves it. Its own fetches (catalog,
    // model info) 404 here and the page is written to say so rather than to break, which is itself
    // worth exercising.
    // The two routes the settings page reads. Answered from the VRM FIXTURE, through the plugin's own
    // parser, so this is the real path and not a stub: a model with expressions and two spring chains,
    // which is what the page has to render.
    if (url.pathname === '/vrmpet3d/catalog') {
      send(200, 'application/json', JSON.stringify({
        models: [{ id: SETTINGS_MODEL_ID, name: basename(SETTINGS_MODEL), format: 'vrm', bytes: statSync(SETTINGS_MODEL).size }],
      }));
      return;
    }
    /**
     * The settings, as the host serves them.
     *
     * Served here from this round on, because the 动作 section's controls only exist for a clip that is TICKED
     * in a state: with no store the page renders the box sets with nothing selected and there would be no
     * per-state control to check at all. `resting` holds both clips, one of which the catalog declares a
     * one-shot — which is exactly the pair the new per-state settings are about.
     *
     * AND IT IS WHAT KEEPS THIS SUITE OFF THE OPERATOR'S LIVE PROFILE. The 部位 probe adds, renames and deletes a
     * part, and the page posts every one of those edits to THIS route: answering them here (rather than letting the
     * window talk to the real host) is why a suite run cannot rewrite the store the operator is using. A POST is
     * answered with the same snapshot as a GET, which is what the host does and what the page expects back — the
     * page's own latch (`hasSnapshot` in `lib/config-page.js`) needs the first answer to be a real snapshot.
     */
    if (url.pathname === '/vrmpet3d/settings') {
      // What the page POSTs is kept: the 试一句 bug this suite now covers is about a chosen pair REACHING the
      // store, and the store is this route. The snapshot below is deliberately version 1 for ever, so the
      // answer is not adopted back — which is how the page's own copy stays readable here.
      if (req.method === 'POST') {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
          try { settingsPatches.push(JSON.parse(raw)); } catch (_error) { settingsPatches.push(null); }
        });
      }
      send(200, 'application/json', JSON.stringify({
        version: 1,
        preferences: { modelId: SETTINGS_MODEL_ID, motions: { resting: ['a1', 'a2'] } },
        live: null,
      }));
      return;
    }
    /**
     * The LLM catalog, as the host serves it — the route 试一句's settings depend on.
     *
     * Answered here rather than left to 404 because the page has to DO something with it: `/vrmpet3d/llm` lists the
     * providers always and a provider's models only for `?provider=`, so a page that fetches it is holding a
     * catalog the store may know nothing about. What that means is the 2026-10-12 operator report — DeepSeek
     * Account configured, 试一句 → 「失败：还没有选择 DSH 的 provider 和模型」 — because the model picker DISPLAYS
     * its first option even while the stored `dshModel` is empty. The fixture's two providers and two models are
     * the live shapes, renamed.
     */
    if (url.pathname === '/vrmpet3d/llm') {
      const wanted = url.searchParams.get('provider') || '';
      send(200, 'application/json', JSON.stringify({
        dsh: {
          available: true,
          providers: [
            { id: 'fake-official', name: '假官方' },
            { id: 'fake-account', name: '假账号（DeepSeek Account）' },
          ],
          models: wanted
            ? [{ id: 'fake-1', name: '假模型一' }, { id: 'fake-2', name: '假模型二' }]
            : [],
          provider: wanted,
          error: null,
        },
        custom: { configured: false, hasKey: false, baseUrl: '', model: '' },
      }));
      return;
    }
    if (url.pathname === '/vrmpet3d/model-info') {
      if (url.searchParams.get('m') !== SETTINGS_MODEL_ID) {
        send(404, 'application/json', '{"error":"unknown model id"}');
        return;
      }
      const info = compactModelInfo(describeModel(SETTINGS_MODEL));
      /**
       * A chain count the fixture does not have, on request.
       *
       * The fixture declares two chains, and the operator's rule is "collapse when there are more than five"
       * (2026-10-10) — so the folding needs a model with more than five to be testable at all. `?chains=9`
       * answers with nine copies of the fixture's own chains, which is the smallest honest way to get there:
       * same shape, same fields, nothing invented.
       */
      const wanted = chainOverride;
      if (Number.isFinite(wanted) && wanted > 0 && info.springs && Array.isArray(info.springs.groups)) {
        const template = info.springs.groups;
        const groups = [];
        for (let i = 0; i < wanted; i += 1) {
          const source = template[i % template.length];
          groups.push({ ...source, index: i, key: `chain${i}`, name: `chain${i}` });
        }
        info.springs = { ...info.springs, groups };
      }
      send(200, 'application/json', JSON.stringify({ ...info, id: SETTINGS_MODEL_ID, name: basename(SETTINGS_MODEL) }));
      return;
    }
    if (url.pathname === '/vrmpet3d/config' || url.pathname === '/vrmpet3d/config/') {
      /**
       * A chain count the fixture does not have (?chains=9), remembered for the model-info the PAGE will ask
       * for. It cannot ride on that request: the page fetches ?m=<id> and nothing else.
       */
      const wantedChains = Number(url.searchParams.get('chains'));
      chainOverride = Number.isFinite(wantedChains) && wantedChains > 0 ? wantedChains : 0;
      send(200, 'text/html; charset=utf-8', readFileSync(join(ROOT, 'lib', 'config-page.html')));
      return;
    }
    /**
     * The 通用设置 page, and the stylesheet both pages link.
     *
     * Served here because the launcher's self-test NAVIGATES the settings window to its sibling route and reads it: a
     * 404 would make the second reading impossible, and "the two pages are two pages" could then only be asserted
     * about the first one. `pages.css` matters for the same reason as in the app — a page whose stylesheet 404s still
     * runs its script, so the failure would be invisible in every number this suite checks.
     */
    if (url.pathname === '/vrmpet3d/global' || url.pathname === '/vrmpet3d/global/') {
      // The global page asks for nothing model-shaped, so the override the model page's URL set is cleared here:
      // it is server state between two requests, and leaving it set would let the model reading be the one that is
      // stale rather than the global one.
      chainOverride = 0;
      send(200, 'text/html; charset=utf-8', readFileSync(join(ROOT, 'lib', 'global-page.html')));
      return;
    }
    if (url.pathname === '/vrmpet3d/window/lib/pages.css') {
      send(200, 'text/css; charset=utf-8', readFileSync(join(ROOT, 'lib', 'pages.css')));
      return;
    }
    // The motion catalog, as the host serves it: one looping clip and one that declares itself a
    // one-shot, which is what the 动作 section lists and counts.
    //
    // AND ONE DECLARED FOLDER MAPPING, because the shipped pack has six of them and this stub used to declare
    // none. That omission is why the suite stayed green while 通用设置 → 状态与动作 came up empty on every
    // mapped state: the page compared a state's folder LIST against a single folder name (`'idle' === ['idle']`,
    // never true), and the only scoping assertions here covered the unmapped case. Both clips live in `plain/`,
    // and only `done` is mapped to it — a state nothing pre-ticks, so its row is measured on what the mapping
    // alone puts there.
    if (url.pathname === '/vrmpet3d/motions') {
      send(200, 'application/json', JSON.stringify({
        motions: [
          { id: 'a1', name: 'plain/vrmpet3d-rest.vrma', format: 'vrma', bytes: 24796, source: 'user', loop: true },
          { id: 'a2', name: 'plain/vrmpet3d-wave.vrma', format: 'vrma', bytes: 9348, source: 'user', loop: false },
        ],
        motionDirs: [],
        importedDirs: [],
        stateFolders: { done: ['plain'] },
      }));
      return;
    }
    if (url.pathname.startsWith('/vrmpet3d/window/lib/')) {
      const name = decodeURIComponent(url.pathname.slice('/vrmpet3d/window/lib/'.length));
      if (!sources.has(name)) { send(404, 'application/json', '{"error":"no such source"}'); return; }
      send(200, 'text/javascript; charset=utf-8', readFileSync(join(ROOT, 'lib', name)));
      return;
    }
    /**
     * The fixture's bytes, so the live pet window can show a REAL model.
     *
     * This route used to be a 404 while the window was started with the built-in procedural avatar — which the
     * operator removed on 2026-10-10 ("内置的占位模型还是没删掉，把Sample Model设为内置模型"). A window with no model
     * paints nothing, and "the pet takes clicks" cannot be asserted against an empty stage, so the fixture is
     * served here instead.
     */
    if (url.pathname === '/vrmpet3d/asset') {
      const bytes = readFileSync(SETTINGS_MODEL);
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': bytes.length,
        'cache-control': 'no-store',
      });
      res.end(bytes);
      return;
    }
    send(404, 'application/json', '{"error":"no asset route in this page server"}');
  });
  /**
   * A port the BROWSER will accept, not merely one the OS handed out.
   *
   * `listen(0)` alone is the flake this file used to carry: the machine's dynamic range starts at 1024 here, so
   * an ephemeral port can land on one of Chromium's "unsafe" ports (6665–6669 among them) and the window then
   * fails with `ERR_UNSAFE_PORT` — which reads as "the settings page did not load" and cost a whole `check-docs`
   * run to diagnose on 2026-10-10. The shared helper retries until the port is usable; every other suite in this
   * repository already used it.
   */
  const port = await listenOnUsablePort(server);
  return { server, port, settingsPatches };
}

/**
 * Start a real launcher in config mode and read its self-test.
 *
 * The window it makes must be an ordinary one: not always-on-top, not screen-sized, not click-through.
 * Its page is the real settings page, served by this suite's own server, so a page that fails to load
 * or throws shows up here rather than in a bug report.
 */
async function runLiveSettingsWindow(runtime, extraQuery) {
  if (!runtime) return { skipped: 'no runtime from the pet window run' };
  const { server, port, settingsPatches } = await startPageServer();
  // The model in the URL, exactly as the host passes it: without it a fresh profile has no stored
  // preference and the page would open on the placeholder.
  const url = `http://127.0.0.1:${port}/vrmpet3d/config?model=${SETTINGS_MODEL_ID}${extraQuery || ''}`;
  const resultFile = join(tmpdir(), `vrmpet3d-desktop-settings-${process.pid}.json`);
  rmSync(resultFile, { force: true });
  const shown = [];
  try {
    const child = spawn(runtime.exe, [
      defaultAppDir(),
      ...launchArgs({ url, parentPid: process.pid, config: true, selfTest: resultFile }),
      // The environment the real path uses: `ELECTRON_RUN_AS_NODE` present — whatever its value — makes
      // Electron behave as Node and try to run the app directory as a script, which is exactly what
      // `sanitizeSpawnEnv` exists to prevent.
    ], { cwd: runtime.dir, env: sanitizeSpawnEnv(process.env), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => shown.push(String(chunk)));
    child.stderr.on('data', (chunk) => shown.push(String(chunk)));
    const report = await waitForFile(resultFile, 60_000);
    if (!report) {
      return { ok: false, summary: `no self-test report after 60 s (${shown.join(' ').slice(0, 200)})` };
    }
    const summary = [
      `loaded=${report.checks.loaded}`,
      // The page's own console, because an uncaught error in it is why a settings page can sit on its
      // placeholder text for ever.
      report.pageLog && report.pageLog.length
        ? `pageLog=${report.pageLog.slice(0, 3).map((entry) => entry.message).join(' | ')}`
        : '',
      `model=${report.pageState ? report.pageState.model : '?'}`,
      `expressions=${report.pageState ? report.pageState.expressions : '?'}`,
      `springs=${report.pageState ? report.pageState.springs : '?'}`,
      `configWindow=${report.checks.configWindow}`,
      `alwaysOnTop=${report.checks.alwaysOnTop}`,
      `electron=${report.versions ? report.versions.electron : '?'}`,
      report.errors && report.errors.length ? `errors=${report.errors.join('; ')}` : '',
    ].filter(Boolean).join(' ');
    return { ok: report.ok === true, report, summary, runtime, settingsPatches: settingsPatches.slice() };
  } catch (error) {
    return { ok: false, summary: `spawn failed: ${error.message}` };
  } finally {
    rmSync(resultFile, { force: true });
    server.close();
  }
}

async function runLiveWindow() {
  /**
   * The live half's OFF switch, in the two spellings its two callers use: a person types `--no-window`,
   * and `verify-all --no-window` sets the variable for every suite it spawns.
   *
   * Off is not the default, deliberately — this is the only check that can catch "the window is real but
   * not what it claims", and the only one that puts a window on the machine running it.
   */
  const askedOff = process.argv.includes('--no-window');
  if (askedOff || envVar('SKIP_DESKTOP') === '1') {
    return { skipped: askedOff ? '--no-window' : 'VRMPET3D_SKIP_DESKTOP=1' };
  }

  let runtime = null;
  try {
    runtime = resolveStandaloneRuntime(envVar('DESKTOP_RUNTIME'));
    if (!runtime) {
      // Under the suite, `process.execPath` is the workspace's own Node, whose ancestry leads
      // nowhere near the app. The installation is found the way every other script here finds
      // it: from the known locations of `resources/app.asar`.
      const installRoot = installationRoot();
      if (!installRoot) {
        return { skipped: 'no DSH installation found; set VRMPET3D_DESKTOP_RUNTIME, DSH_ASAR or VRMPET3D_DSH_ASAR' };
      }
      // The runtime goes BESIDE THE INSTALLATION, exactly as the host half puts it: hard links
      // require one volume, so a workspace-relative path would either copy 244 MB or (on a
      // synced tree like this one) hand a 244 MB executable to the sync client.
      const target = runtimeDirFor({ installRoot });
      console.log(`  note  runtime: ${target}`);
      const prepared = ensureRuntime({ installRoot, dir: target, log: (message) => console.log(`  note  ${message}`) });
      runtime = prepared;
      if (prepared.copied) {
        console.log(`  note  runtime had to be copied (different volume): ${prepared.dir}`);
      }
    }
  } catch (error) {
    return { skipped: `could not prepare a runtime: ${error.message}` };
  }

  const { server, port } = await startPageServer();
  const url = `http://127.0.0.1:${port}/vrmpet3d/window`;
  const resultFile = join(tmpdir(), `vrmpet3d-desktop-selftest-${process.pid}.json`);
  rmSync(resultFile, { force: true });

  const window = new DesktopWindow({
    runtime,
    runtimeDir: runtime.dir,
    log: (message) => console.log(`  note  ${message}`),
  });

  try {
    // A real model, by the id the launcher would pass: the built-in avatar is gone (2026-10-10).
      window.start({ url, modelId: SETTINGS_MODEL_ID, parentPid: process.pid, selfTest: resultFile });
    const report = await waitForFile(resultFile, 60_000);
    if (!report) {
      return { ok: false, summary: `no self-test report after 60 s (${window.describe().state}${window.describe().lastError ? ': ' + window.describe().lastError : ''})` };
    }
    /**
     * The names of the launcher's own checks that came out false.
     *
     * "The launcher reported success" without them is unanswerable: the launcher judges a pet window on a dozen
     * things (pixels, transparency, page readiness, the per-pixel hit test, the menu's hit test, the zoom about
     * the cursor) and any one of them being false looks exactly like the others from here.
     */
    const failedChecks = Object.keys(report.checks || {})
      .filter((name) => report.checks[name] !== true && typeof report.checks[name] === 'boolean');
    const summary = [
      `alwaysOnTop=${report.checks.alwaysOnTop}`,
      `petSized=${report.checks.petSized}`,
      `pixels=${report.checks.capture ? report.checks.capture.opaquePixels + report.checks.capture.translucentPixels : 0}`,
      `transparent=${report.checks.capture ? report.checks.capture.transparentPixels : 0}`,
      `webgl2=${report.page ? report.page.webgl2 : null}`,
      `electron=${report.versions ? report.versions.electron : '?'}`,
      failedChecks.length ? `falseChecks=${failedChecks.join(',')}` : '',
      report.errors && report.errors.length ? `errors=${report.errors.join('; ')}` : '',
    ].filter(Boolean).join(' ');

    ok(report.checks.alwaysOnTop === true, 'the window is always on top');
    // The pet window is the PET'S BOX: measured as "smaller than the work area", asserted here on the
    // live window rather than on the source, because the size that matters is the one it ends up with.
    ok(report.checks.petSized === true, "the window is the pet's box, not the work area");
    ok(report.checks.clickThroughAccepted === true, 'click-through is accepted');
    ok(report.checks.pageReady === true, 'the pet page mounted and reported a WebGL context');
    ok(report.page && report.page.webgl2 === true, 'the page has WebGL 2');
    ok(Boolean(report.checks.capture), 'the window was captured for pixel evidence');
    if (report.checks.capture) {
      ok(report.checks.capture.opaquePixels + report.checks.capture.translucentPixels > 500,
        'the pet actually drew pixels');
      ok(report.checks.capture.transparentPixels > 500,
        'and most of the window is genuinely transparent, which is what a desktop pet needs');
    }
    ok(Array.isArray(report.errors) && report.errors.length === 0, `the launcher reported no errors (${summary})`);

    // The click-through policy, measured rather than assumed: clicks must land on painted pixels
    // and pass through everything else. The probe points are synthetic cursors sent to the page,
    // because a script cannot move a real mouse.
    const hit = report.checks.hitTest;
    ok(report.checks.perPixelHitTest === true,
      `the window takes clicks on painted pixels and passes everything else through (${JSON.stringify(hit)})`);
    if (hit) {
      ok(hit.insidePainted > 0, 'at least one point inside the pet is painted, so the pet takes clicks');
      ok(hit.overFar === false, 'a point far from the pet is not painted, so the desktop keeps its clicks');
    }
    const state = report.pageState;
    if (state) {
      // Throwing is switched off in this window: a drag places the pet and it stays there. The flag
      // is the switch, and the physics behind it is untouched for the feature that wants it later.
      ok(state.throwEnabled === false, 'the window reports throwing switched off (drag and place)');
      // The right-click menu, and the half of the hit test that cannot come from pixels: it is DOM.
      ok(report.checks.menu && report.checks.menu.open === true, 'right-clicking opens the pet menu');
      /**
       * And the menu came from the SHARED module — the same one the app's pet builds — which is the whole of the
       * reason `lib/menu.js` exists: the window used to hand-roll its own rows AND, after that, build a panel of
       * its own, so the entry set could differ between the two pets and the only symptom was a user noticing. The
       * flag is published by the page (`menu.module`), so this is measured in the real window rather than asserted
       * about the source.
       */
      ok(report.checks.menu && report.checks.menu.module === true,
        'and it is the shared definition both pets build from, not a hand-rolled copy');
      ok(report.checks.menuHitTest === true,
        `the menu takes clicks although none of it is painted into the canvas (${JSON.stringify(report.checks.menu)})`);
      // The pet's box is the canvas, and the canvas is the pet-sized thing the model is framed to.
      // A canvas the size of the screen is the bug this asserts against: it produced a pet as large
      // as the display.
      ok(state.canvas.width < state.screen.width, `the canvas is not the whole screen (${state.canvas.width} of ${state.screen.width})`);
      ok(state.canvas.height < state.screen.height, `nor the whole height (${state.canvas.height} of ${state.screen.height})`);
      ok(state.placement.width <= Math.ceil(state.screen.width * 0.23),
        `and the pet's box is a small share of the screen (${state.placement.width} of ${state.screen.width})`);
    }

    // ---- the freeze fix: the window is the pet, not a screen-wide layer --------------------
    //
    // The user's report: clicking the model froze everything composed behind it, browsers and Electron
    // apps first. Reproduced locally with a reference Chromium window and screen captures — 5 of 8
    // samples frozen after a click on the pet with a work-area-sized window, 0 of 8 with a pet-sized
    // one — so the window now follows the pet's own rectangle. These two assertions are the shape of
    // that fix, on the live window: it does NOT cover the work area, and its bounds track the box the
    // page reports (within a pixel, because the page rounds).
    ok(report.checks.petSized === true, "the live window is the pet's box");
    if (report.checks.bounds && report.display && report.display.workArea) {
      const area = report.display.workArea;
      ok(report.checks.bounds.width < area.width && report.checks.bounds.height < area.height,
        `and does not cover the work area (${report.checks.bounds.width}x${report.checks.bounds.height} of ${area.width}x${area.height})`);
    }
    if (report.checks.bounds && report.checks.petRect) {
      const bounds = report.checks.bounds;
      const box = report.checks.petRect;
      /**
       * The window CONTAINS the pet rather than being exactly it.
       *
       * It always carried the frame margin (`petSized` and the probe's own box checks are about that), and since
       * 2026-10-13 it also reserves a fixed band for 碎碎念 above the pet — a constant, so that a longer remark cannot
       * resize the window and make the pet jump near a screen edge (「彻底杜绝宠物盒子大小变化的问题」). What has to hold
       * is therefore containment, on both axes and on both edges.
       */
      ok(bounds.x <= box.left + 1 && bounds.y <= box.top + 1
        && bounds.x + bounds.width >= box.left + box.width - 1
        && bounds.y + bounds.height >= box.top + box.height - 1
        && bounds.width >= box.width - 1 && bounds.height >= box.height - 1,
        `and holds it (window ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} vs pet ${box.left},${box.top} ${box.width}x${box.height})`);
    }
    if (report.ok !== true) {
      // The numbers, not just the verdict: a capture whose size differs from the window's, or a
      // page error that never reached `report.errors`, is only visible in the raw report.
      console.log('  note  self-test report:');
      console.log(JSON.stringify(report, null, 2).split('\n').map((line) => '    ' + line).join('\n'));
    } else {
      // Printed on success too: the window's own measurements are the evidence this suite exists
      // to produce, and a green check with no numbers is not inspectable later.
      console.log(`  note  live window: ${summary}`);
      /**
       * 指针锁是环境事实，不是断言：这个窗口刻意 `focusable: false`，而 Chromium 只给聚焦的文档发锁。
       * 把实测结果打出来（操作者 2026-10-12 要求独立桌宠的旋转也锁鼠标），这样"这台机器上锁得上/锁不上"
       * 是可查的，而不是靠猜。
       */
      if (report.checks && report.checks.pointerLock) {
        console.log(`  note  pointer lock in the floating window: ${JSON.stringify(report.checks.pointerLock)}`);
      }
      /**
       * 独立桌宠的旋转：断言**能看见的行为**，不把机制当成必要条件。
       *
       * 上一版这里断言的是"窗口能不能拿到指针锁"，而操作者机器上的实测是
       * `{"supported":true,"locked":false,"hasFocus":false}` —— 这个窗口刻意不持有焦点，Windows 的前台规则就
       * 不允许它抢到焦点，所以指针锁在那台机器上根本不可用。机制不可靠，行为才是承诺：
       * **按下右键、把指针移开，视角必须继续转；松开必须停。** 自检用真实鼠标事件测这一条。
       */
      if (report.checks && report.checks.orbit) {
        console.log(`  note  right-drag orbit: ${JSON.stringify(report.checks.orbit)}`);
      }
      ok(report.checks && report.checks.orbitFollowsThePointer === true,
        `right-dragging the floating pet turns the view while the pointer travels away from it (${JSON.stringify(report.checks && report.checks.orbit)})`);
      const state = report.pageState;
      if (state) {
        console.log(`  note  the page ran ${state.frames} frames; the pet is at ${JSON.stringify(state.pixels)} (${state.placement.width}x${state.placement.height} in a ${state.viewport.join('x')} frame)`);
      }
    }
    // The runtime travels with the result: the settings window is the same launcher in another mode, and
    // preparing a second one would be 244 MB of hard links for no reason.
    return { ok: report.ok === true, summary, runtime };
  } finally {
    window.stop();
    server.close();
    rmSync(resultFile, { force: true });
    // Keep the runtime: it is the real cache the host half reuses, and on one volume it costs
    // nothing. `VRMPET3D_CLEAN_DESKTOP=1` removes it for a machine that wants the disk back.
    if (envVar('CLEAN_DESKTOP') === '1') removeRuntime(runtimeDir);
  }
}

/**
 * The installation to borrow an Electron from, by the same search the other scripts use.
 *
 * `findInstallRoot` walks up from a path, which is right for the host half (it runs inside the
 * installation) and wrong here (the suite runs under the workspace's own Node), so the known
 * `resources/app.asar` locations are consulted as well.
 */
function installationRoot() {
  const candidates = [
    envVar('DSH_ASAR'),
    process.env.DSH_ASAR,
    'D:\\DeepSeek\\dsh\\resources\\app.asar',
    'F:\\DeepSeek\\Harness\\resources\\app.asar',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
    'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar',
  ];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const root = dirname(dirname(resolve(candidate)));
    if (findExecutable(root)) return root;
  }
  return findInstallRoot(dirname(process.execPath));
}

function waitForFile(path, timeoutMs) {
  const started = Date.now();
  return new Promise((resolveWait) => {
    const tick = () => {
      if (existsSync(path)) {
        try {
          resolveWait(JSON.parse(readFileSync(path, 'utf8')));
          return;
        } catch (_error) {
          // Half-written: try again.
        }
      }
      if (Date.now() - started > timeoutMs) { resolveWait(null); return; }
      setTimeout(tick, 250);
    };
    tick();
  });
}

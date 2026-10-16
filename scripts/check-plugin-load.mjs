#!/usr/bin/env node
/**
 * Preflight: can this plugin actually load and activate?
 *
 * Run:  node scripts/check-plugin-load.mjs [--profile <profile dir>]
 *
 * Why this exists: a plugin that cannot resolve, or whose `apply` throws, makes
 * DSH skip the bundle with a warning at boot. The pet then simply never appears,
 * with nothing in the UI to say why. This runs the same steps in isolation and
 * fails loudly instead.
 *
 * It checks, in order:
 *   1. `package.json` is valid and declares the two halves DSH needs
 *      (`main` for the host, `dsh.client` for the browser bundle).
 *   2. `lib/index.js` imports and exports `apply`.
 *   3. `apply(ctx)` activates against a minimal stub: it provides the service,
 *      subscribes to `session/event`, and disposes cleanly through `ctx.effect`.
 *   4. `lib/client.js` registers a factory on `window.__ModuleLoader__` and that
 *      factory, then the plugin it returns, activates against a minimal stub —
 *      the same two calls DSH's web boot makes, in the same order.
 *   5. If a profile is given, the package resolves from that profile's directory —
 *      the base URL the DSH Loader anchors on.
 *
 * Step 4 runs `lib/client.js` in a `node:vm` sandbox, which is NOT the browser:
 * it proves the client half activates at all, not that it draws. The browser
 * suites cover drawing. This split is deliberate and was learned the hard way —
 * see the note on the check itself for the failure that got through while every
 * other suite was green.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const profileDir = argOf('--profile');

/**
 * Scratch files for everything this preflight would otherwise read or write in the operator's own
 * profile — and they are set HERE, before the first `apply`, not next to the assertions.
 *
 * Applying the plugin constructs the settings store, which WRITES its file immediately. Setting the
 * override later left the first `apply` writing the operator's `vrmpet3d-settings.json` (measured
 * 2026-10-08: the live store said version 13 while the file said version 1, because this preflight's
 * apply had rewritten it). Both overrides belong above the first apply, and the model-dirs list was
 * already being set too late for the same reason.
 */
const scratch = join(ROOT, 'build', 'probe', 'model-dirs-preflight.json');
const settingsScratch = join(ROOT, 'build', 'probe', 'settings-preflight.json');
process.env.VRMPET3D_MODEL_DIRS_FILE = scratch;
process.env.VRMPET3D_SETTINGS_FILE = settingsScratch;
/**
 * And every store the plugin resolves inside the running profile, named here even though this preflight does not
 * POST an import: `verify-model.mjs` learned the same lesson the hard way on 2026-10-12 — a suite that named only
 * the directory lists left the two IMPORT stores (and the wizard's flag) pointing at the operator's real profile,
 * and the first POST created them there. A preflight that applies the plugin should never be one route change away
 * from writing the user's own state.
 */
process.env.VRMPET3D_MOTION_DIRS_FILE = join(ROOT, 'build', 'probe', 'motion-dirs-preflight.json');
process.env.VRMPET3D_IMPORT_DIR = join(ROOT, 'build', 'probe', 'import-state-preflight');
process.env.VRMPET3D_MODEL_FILES_FILE = join(ROOT, 'build', 'probe', 'model-files-preflight.json');
process.env.VRMPET3D_MOTION_IMPORTS_FILE = join(ROOT, 'build', 'probe', 'motion-imports-preflight.json');
process.env.VRMPET3D_SETUP_FILE = join(ROOT, 'build', 'probe', 'setup-preflight.json');

let failures = 0;
function report(ok, label, detail) {
  if (ok) {
    console.log(`  pass  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

console.log(`plugin: ${ROOT}`);

// --- 1. manifest -----------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
report(pkg.name === 'dsh-plugin-vrmpet3d', 'package name is dsh-plugin-vrmpet3d', pkg.name);
report(typeof pkg.main === 'string' && existsSync(join(ROOT, pkg.main)),
  `main entry exists (${pkg.main})`);
report(Boolean(pkg.dsh?.bundle?.patch) && existsSync(join(ROOT, pkg.dsh.bundle.patch)),
  `dsh.bundle.patch exists (${pkg.dsh?.bundle?.patch})`);
report(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform is web', pkg.dsh?.client?.platform);
report(Array.isArray(pkg.dsh?.client?.inject), 'dsh.client.inject is declared');

// The patch must add exactly one row, named like the package, because the client
// module system resolves a plugin's bundle from its Loader entry name. These
// checks look for YAML keys at the start of a line rather than substrings anywhere
// in the file: `patch.includes('replace')` matched the prose comment above the
// YAML ("replaces no official DSH component") and reported a false failure.
const patch = readFileSync(join(ROOT, pkg.dsh.bundle.patch), 'utf8');
report(patch.includes(`name: ${pkg.name}`), 'the bundle patch names this package');
report(/^\s*replace\s*:/m.test(patch) === false, 'the patch inserts a row and replaces nothing');
report(/^\s*(?:-\s*)?insert\s*:/m.test(patch), 'the patch uses an insert operation');

// --- 2/3. host half --------------------------------------------------------
const host = await import(pathToFileURL(join(ROOT, pkg.main)).href);
report(typeof host.apply === 'function', 'lib/index.js exports apply()');
report(host.name === 'vrmpet3d', 'the plugin registers under the service name "vrmpet3d"', host.name);

const provided = new Map();
const listeners = [];
const effects = [];
const logger = { warn: (message) => { logger.warnings.push(String(message)); }, warnings: [] };
const ctx = {
  logger,
  get: (key) => (key === 'agents' ? { list: () => [], get: () => undefined, roots: () => [] } : undefined),
  provide: (key, value) => { provided.set(key, value); return () => provided.delete(key); },
  on: (event, handler, options) => { listeners.push({ event, handler, options }); return () => {}; },
  effect: (callback, label) => { const dispose = callback(); effects.push({ dispose, label }); return dispose; },
};

let activated = true;
let activationError = null;
try {
  host.apply(ctx, {});
} catch (error) {
  activated = false;
  activationError = error;
}
report(activated, 'apply(ctx) activates without throwing', activationError && (activationError.stack || activationError.message));
report(provided.has('vrmpet3d'), 'it provides the vrmpet3d service');
report(listeners.some(entry => entry.event === 'session/event' && entry.options?.global === true),
  'it subscribes to session/event globally');
report(effects.length > 0, `it registers cleanup effects (${effects.length})`);

const service = provided.get('vrmpet3d');
report(Boolean(service) && typeof service.watch === 'function', 'the service exposes watch()');
report(Boolean(service?.typertRemote), 'the service exposes its typertRemote contract');
report(Boolean(service?.describe) && typeof service.describe === 'function', 'the service exposes describe()');

// No web carrier in this stub: the plugin must still activate, and must say so.
report(service?.assetRoutes === null,
  'without a webServer the asset routes are absent but activation still succeeds');

// A web server that appears AFTER activation must still be given the routes.
//
// This is the regression check for "catalog route returned HTTP 404": the plugin
// read `ctx.get('webServer')` once, during apply, and nothing re-runs apply — so a
// service provided later left it with no routes and no way to notice. `ctx.inject`
// is what makes the callback run on arrival, and this drives exactly that.
{
  const lateRegistrations = [];
  const lateEffects = [];
  let lateService = null;
  const lateCtx = {
    logger,
    get: () => undefined,
    provide: (key, value) => { if (key === 'vrmpet3d') lateService = value; return () => {}; },
    on: () => () => {},
    effect: (callback, label) => { const dispose = callback(); lateEffects.push({ dispose, label }); return dispose; },
    // The declarative form: keep the consumer so the test can trigger it, the way
    // Cordis does when the service it names becomes available.
    inject: (services, callback) => { lateCtx.pending.push({ services, callback }); return () => {}; },
    pending: [],
  };

  const lateHost = await import(pathToFileURL(join(ROOT, pkg.main)).href);
  // Both scratch paths were set at the top of this file, before the first apply: see the comment
  // there for why "before" is the whole point.
  let lateError = null;
  try {
    lateHost.apply(lateCtx, {});
  } catch (error) {
    lateError = error;
  }
  report(lateError === null, 'an apply with no webServer still activates', lateError && lateError.message);
  report(lateCtx.pending.length === 1 && lateCtx.pending[0].services.includes('webServer'),
    'it declares webServer as an optional injected dependency');

  const disposed = [];
  const webServer = {
    register: (route) => {
      lateRegistrations.push(`${route.kind} ${route.path}`);
      return () => disposed.push(route.path);
    },
  };

  // The service arrives: Cordis calls the pending consumer with a scope that has it.
  const scope = {
    webServer,
    get: (key) => (key === 'webServer' ? webServer : undefined),
    effect: (callback, label) => { const dispose = callback(); lateEffects.push({ dispose, label }); return dispose; },
  };
  lateCtx.pending[0].callback(scope);

  // Twenty-one routes: the five asset/motion ones, the desktop window's page and sources and its on/off
  // control, what a model file contains plus the THUMBNAIL a picker shows beside it, the TWO settings pages
  // (模型参数 and 通用设置, separate documents since 2026-10-11) plus the FIRST-RUN GUIDE (its page and its own
  // state) and the MODEL PICKER's page (切换模型, added 2026-10-13), the settings store, the transient preview
  // the settings window drives, the live state the in-app pet publishes for the floating window, the AI 碎碎念
  // pair (one generated line, and the provider catalog the settings offer), and DSH's own animated whale mark
  // for the status prompt's mask.
  report(lateRegistrations.length === 22,
    `a late webServer receives all twenty-two routes (${lateRegistrations.join(', ') || 'none'})`);
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/catalog'),
    'the catalog route is among them');
  report(lateRegistrations.some((entry) => entry === 'prefix /vrmpet3d/asset'),
    'the asset route is among them');
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/window'),
    "the desktop window's page route is among them");
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/model-info'),
    "and the route that describes a model's contents");
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/model-thumbnail'),
    'and the route that serves one model\'s own thumbnail image');
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/config'),
    "and the model-parameter window's page");
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/global'),
    'and the 通用设置 page, a second document rather than a hidden half of the first');
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/picker'),
    "and 切换模型's page, the model picker the guide's 偏好模型 step is also built from");
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/preview'),
    'and the preview channel the settings window drives');
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/state'),
    'and the live state the in-app pet publishes for the floating window');
  report(lateRegistrations.some((entry) => entry === 'exact /vrmpet3d/whale'),
    "and DSH's animated whale mark, which the status prompt masks");

  // The mark's path is written in three places — the route, and a mask declaration in each stylesheet, because
  // neither stylesheet can read the core when it is built (the in-app one is evaluated before the core chunk
  // arrives; the window's styles are built at module scope). Three copies of one string is exactly what
  // drifts, so they are compared here instead of trusted.
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const coreSource = readFileSync(join(ROOT, 'lib', 'core.js'), 'utf8');
    report(coreSource.includes("var STATUS_ICON_URL = '/vrmpet3d/whale'"),
      "the shared core publishes the mark's URL");
    report(clientSource.includes('url(/vrmpet3d/whale)'), "the in-app prompt's mask names it");
    report(windowSource.includes('url(/vrmpet3d/whale)'), "the window prompt's mask names it");
    report(clientSource.includes('vrmpet3d-whale-animated') && windowSource.includes('vrmpet3d-whale-animated'),
      'and both style the animated layer the shared markup emits');
  }

  /**
   * The prompt's per-model text correction must be in BOTH push lists.
   *
   * Each surface sends the host store only the keys it owns, and the host merges them — so a key that is
   * missing from a push list is silently dropped from the host's copy, and the next snapshot answers without
   * it. That is exactly how "文字单独缩放后…缩放模型的时候又恢复原状了" happened: the window's list had no
   * `statusScale`, so its own zoom (which writes through the same function) threw the correction away.
   *
   * A behavioural check covers the in-app list (the probe asserts the pushed patch carries the correction);
   * the window's list is a literal in a page this suite cannot mount, so it is asserted here, by name, with the
   * failure it prevents written down next to it.
   */
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const localKeys = /var LOCAL_KEYS = \[([\s\S]*?)\];/.exec(clientSource);
    const windowKeys = /var LOCAL_KEYS = \[([^\]]*)\];/.exec(windowSource);
    report(Boolean(localKeys) && localKeys[1].includes("'statusScale'"),
      "the in-app pet's push list carries the prompt's per-model correction");
    report(Boolean(windowKeys) && windowKeys[1].includes("'statusScale'"),
      "and so does the floating window's, so its own zoom cannot drop it");
  }

  /**
   * The two surfaces own two DIFFERENT size keys.
   *
   * `size` is the pet inside DSH's window; `windowSize` is the floating window, whose frame is the whole
   * screen. They used to share one key, so reloading DSH handed the window the in-app pet's percentage
   * (measured 2026-10-10: 202×276 instead of 396×540). The two push lists are literals in two files, and this
   * is what keeps them from drifting back into one: the window must send `windowSize`, must NOT send `size`,
   * and the app's pet must keep `size` and never learn about `windowSize`.
   */
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const appKeys = /var LOCAL_KEYS = \[([\s\S]*?)\];/.exec(clientSource);
    const windowKeys = /var LOCAL_KEYS = \[([^\]]*)\];/.exec(windowSource);
    report(Boolean(windowKeys) && windowKeys[1].includes("'windowSize'"),
      "the floating window's push list carries its OWN size key");
    report(Boolean(windowKeys) && !windowKeys[1].includes("'size'"),
      'and never the shared one, so its zoom cannot overwrite the in-app pet');
    report(Boolean(appKeys) && appKeys[1].includes("'size'"),
      "the in-app pet's push list still owns the shared size");
    report(Boolean(appKeys) && !appKeys[1].includes("'windowSize'"),
      'and does not push a size that belongs to the other surface');
    report(/placement\.sizeKey = 'windowSize'/.test(windowSource),
      'the window tells its placement which key to read, so the box comes from windowSize');
    report(/out\.windowSize = Number\.isFinite\(Number\(source\.windowSize\)\)/.test(
      readFileSync(join(ROOT, 'lib', 'core.js'), 'utf8')),
      'and the cleaner validates it next to `size`, which is what makes it survive a host snapshot');
    /**
     * And the window's PARKING SPOT is in both places too.
     *
     * `placementX`/`placementY` are written on every drag, but two separate omissions each put the window back
     * in its default corner: the cleaner did not know the keys (so the page's own `readPreferences` dropped
     * them), and the push list did not name them (so every host snapshot answered without them). Both are
     * asserted here because the symptom — "it forgets where I put it" — is identical for either.
     */
    const coreSource = readFileSync(join(ROOT, 'lib', 'core.js'), 'utf8');
    report(Boolean(windowKeys) && windowKeys[1].includes("'placementX'") && windowKeys[1].includes("'placementY'"),
      "the floating window's push list carries where it was left");
    report(/out\.placementX = Number\.isFinite\(Number\(source\.placementX\)\)/.test(coreSource)
      && /out\.placementY = Number\.isFinite\(Number\(source\.placementY\)\)/.test(coreSource),
      'and the cleaner keeps both, so a reload does not drop the position');
  }

  /**
   * The right-click MENU is ONE definition, built by both surfaces.
   *
   * `lib/menu.js` is the only place an entry, its order or its words exists: the app overlay loads it as a chunk
   * and the floating window loads the same file from the host's source whitelist, and both build the menu with
   * `createMenu`. It replaced the settings PANEL each pet used to grow — operator, 2026-10-11: 「内置桌宠和独立桌宠
   * 各自有一套设置，这样是不对的。删掉两个单独的设置面板。」 — and the failure this block exists to stop is the one that
   * produced those two panels: an entry that exists on one pet and not on the other.
   *
   * Six things are asserted, because any one of them alone can drift back:
   *   1. the app really LOADS the module — it is a chunk in `lib/client.js`'s list, and the generated copy exists
   *      (a missing chunk is a pet whose right-click does nothing, which is silent);
   *   2. BOTH surfaces build their menu with the shared `createMenu`;
   *   3. neither surface writes the menu's markup or one of its labels itself;
   *   4. the shared list is the operator's entries in the operator's order — 重启/退出 DeepSeek Harness were
   *      removed on 2026-10-12 and 重力 added in the same round, so this list is also what says the removed
   *      entries did not come back;
   *   5. the row that differs between the two pets names the direction the operator asked for (窗口外 inside the
   *      app, 窗口内 in the window), and 关闭宠物's two meanings are two DIFFERENT words;
   *   6. 重力 is a TOGGLE in both surfaces, read at OPEN time from each surface's OWN key — one shared key would
   *      be the coupling 「状态完全独立」 rules out.
   */
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const menuSource = readFileSync(join(ROOT, 'lib', 'menu.js'), 'utf8');
    report(/file: '\.\/client\.menu\.js'[\s\S]{0,80}global: '__VRMPET3D_MENU__'/.test(clientSource),
      'the app loads the shared menu definition as a chunk');
    report(existsSync(join(ROOT, 'lib', 'client.menu.js')),
      'the generated chunk the app asks for exists (run scripts/client-chunks.mjs)');
    report(/api\.createMenu\(\{/.test(clientSource) && /api\.createMenu\(\{/.test(windowSource),
      'and BOTH surfaces build their menu with the shared createMenu');
    report(!clientSource.includes('vrmpet3d-menu-item') && !windowSource.includes('vrmpet3d-menu-item'),
      "with neither writing the menu's markup or its labels itself");
    const list = /var ITEMS = \[([\s\S]*?)\];/.exec(menuSource);
    const ids = list ? [...list[1].matchAll(/'([a-zA-Z]+)'/g)].map((match) => match[1]) : [];
    report(JSON.stringify(ids) === JSON.stringify([
      'resetView', 'resetSize', 'globalSettings', 'switchModel', 'dance', 'miniGame', 'reloadModel', 'modelSettings', 'surface', 'gravity', 'closePet',
    ]), `the shared list is the operator's entries in order, without 重启/退出 (${ids.join(', ') || 'none'})`);
    report(/surfaceWindow: '切换为独立宠物'/.test(menuSource) && /surfaceApp: '切换回窗口内'/.test(menuSource),
      'and the 切换 row still carries both directions in the table');
    report(/closePetApp: '隐藏宠物'/.test(menuSource) && /closePetWindow: '关闭独立宠物'/.test(menuSource),
      "and 关闭宠物's two meanings are two words: the app's pet is hidden, the window's is handed back");
    /**
     * 切换行只由应用内的宠物提供 —— 外置窗不再显示它。
     *
     * 操作者（2026-10-12）：「外置桌宠的'切换回窗口内'选项现在和'关闭独立宠物'功能重复了，移除'切换回窗口内'选项」。
     * 这两条断言分别钉住两端：页面显式声明自己不显示它，模块必须照办（`showSurface: false` 才算数）；而**应用内的
     * 一个仍然要有** —— 那是宠物离开 DSH 的唯一出口，删掉它就是把宠物关在应用里。
     */
    report(/showSurface: false/.test(windowSource) && !/toSurface: 'window'/.test(windowSource),
      '外置窗不显示 切换行（它自己的 关闭独立宠物 就是那个动作），而应用内的宠物保留 切换回窗口外');
    report(/if \(id === 'surface' && !showSurface\) return;/.test(menuSource),
      '并且这个"不显示"是模块照办的，而不是页面自己拼菜单');
    report(/toSurface: 'window'/.test(clientSource) && /toSurface: 'app'/.test(windowSource),
      'with the app handing the pet OUT and the window handing it back INSIDE');
    report(/setSurfaceAllowed\(/.test(clientSource) && /setSurfaceAllowed\(/.test(windowSource),
      'and both read 非debug模式生效 when the menu is OPENED, so 调试模式 disables that row where it exists');
    /**
     * 重力 — a switch, and an INDEPENDENT one per surface.
     *
     * The failure this stops is a single shared key, which would look perfect until the moment both pets are on
     * screen (调试模式) and throwing the app pet's switch stopped the window's fall as well.
     */
    report(/var TOGGLES = \['gravity'\]/.test(menuSource) && /setChecked\(/.test(clientSource),
      '重力 is a TOGGLE the menu marks, and the app reads it when the menu opens');
    report(/setChecked\('gravity', this\.preferences\.gravity === true\)/.test(clientSource)
      && /setChecked\('gravity', preferences\.windowGravity === true\)/.test(windowSource),
      "and each surface reads its OWN key, so the two switches cannot move together");
    report(/'gravity',/.test(clientSource) && /'windowGravity',/.test(windowSource),
      'with both keys in their surface\'s push list, so a host snapshot cannot drop either');
  }

  /**
   * 独立桌宠旋转时的指针锁：一条四环的链，每一环断了锁都拿不到。
   *
   * 操作者（2026-10-12）：「独立桌宠的旋转功能一直都异常，从来没能把鼠标真正锁住过，把窗口内桌宠的锁定鼠标旋转的方法
   * 搬到独立桌宠上。」 这个页面此前根本没有锁代码，而它比主窗更需要锁：窗口只有宠物那么大，右拖几个像素鼠标就出窗。
   *
   * 而"请求锁"在这里不是一个调用，是四步：页面 `orbit(true)` → preload 过桥 → 启动器把窗口设为可聚焦并聚焦 →
   * 回 `orbit-focus` → 页面这才 `requestPointerLock()`。顺序是硬要求：Chromium 只给聚焦的文档发锁，未聚焦时请求
   * 会被直接拒绝 —— 这不是推测，是启动器自检在这台机器上实测出来的（`The root document of this element is not
   * valid for pointer lock.`，聚焦之后同一段探测报 `locked: true`）。
   */
  {
    const pageSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const preloadSource = readFileSync(join(ROOT, 'desktop', 'preload.js'), 'utf8');
    const launcherSource = readFileSync(join(ROOT, 'desktop', 'main.js'), 'utf8');
    report(/bridge\.orbit\(true\)/.test(pageSource) && /bridge\.orbit\(false\)/.test(pageSource),
      '独立桌宠在旋转开始时通知启动器，结束时再通知一次');
    report(/viewDrag\.moved = true;\s+beginOrbitGesture\(\);/.test(pageSource),
      '通知发生在按压确实成为旋转的那一刻，而不是按下的那一刻');
    /**
     * 页面**不再自己请求锁** —— 这是操作者第二次反馈（「并没有成功，光标没有被锁住」）换来的规则。
     *
     * 页面发出的请求在生产里注定失败：Chromium 要"发起请求的那一刻文档已聚焦且处于用户激活状态"，而请求前必须先
     * 过一次 IPC 让启动器把窗口设为可聚焦。自检上一版给了请求一个 `userGesture` 标记，于是它成功了，而页面给不了。
     * 所以有启动器时取锁整件交给启动器，页面只读 `pointerlockchange`；没有启动器（浏览器标签页）时才自己来。
     */
    report(/if \(bridge && typeof bridge\.orbit === 'function'\) \{\s*bridge\.orbit\(true\);\s*return;/.test(pageSource),
      '有启动器时，取锁整件交给它（页面只读结果），而不是自己请求');
    report(/orbit: \(active\) => ipcRenderer\.send\('vrmpet3d:orbit', active === true\)/.test(preloadSource)
      && !/onOrbitFocus/.test(preloadSource),
      'preload 只暴露这一个方法：没有第二个回合需要页面参与');
    report(/const ORBIT_LOCK_JS/.test(launcherSource) && /ORBIT_UNLOCK_JS/.test(launcherSource),
      '启动器自己带着取锁/放锁的脚本');
    report(/ipcMain\.on\('vrmpet3d:orbit'/.test(launcherSource)
      && /win\.setFocusable\(true\)/.test(launcherSource) && /win\.focus\(\)/.test(launcherSource),
      '它先把窗口设为可聚焦并聚焦');
    report(/executeJavaScript\(ORBIT_LOCK_JS, true\)/.test(launcherSource),
      '然后用 Electron 的 userGesture 标记替页面请求 —— 这是唯一实测能拿到锁的路径');
    report(/setTimeout\(\(\) => \{[\s\S]{0,200}executeJavaScript\(ORBIT_LOCK_JS, true\)/.test(launcherSource)
      && /if \(win\.isDestroyed\(\) \|\| !orbitFocus\) return;/.test(launcherSource),
      '晚一拍再请求（focus() 到文档真正聚焦之间有一个消息往返），且松手之后不再补一刀');
    report(/orbitFocus = false;[\s\S]{0,120}win\.setFocusable\(false\);/.test(launcherSource)
      && /if \(!orbitFocus && win\.isFocused\(\)\) win\.blur\(\)/.test(launcherSource),
      '旋转一结束就恢复不可聚焦、交回焦点、放锁，且 keepOnTop 不会把刚拿到的焦点 blur 掉');
    report(/report\.checks\.pointerLockOrbit/.test(launcherSource)
      && /report\.checks\.orbitFollowsThePointer/.test(launcherSource),
      '自检既走页面那条桥接口，也**用真实鼠标事件**断言"右键拖动时视角跟着转"');
    /**
     * 而真正让旋转"跟得住"的两条，都在窗口这一侧 —— 它们比指针锁重要得多，因为锁需要窗口可聚焦，而这个窗口
     * 刻意永不持有焦点（操作者机器上实测 `{"locked":false,"hasFocus":false}`）。
     *
     *   1. 右键按下要**捕获指针**（主窗一直这么做，这个页面此前只有左键拖动才捕获）：捕获之后，只要右键按着，
     *      指针事件就继续投递给画布，光标跑到窗口外也一样；
     *   2. 旋转期间要报 `orbiting: true`，并且启动器要**因此保持窗口可交互** —— 否则光标一离开宠物像素，启动器就
     *      把窗口设为穿透，事件立刻断掉，旋转停在那里（操作者：「旋转功能一直都异常」）。
     */
    report(/if \(event\.button === 2\) \{[\s\S]{0,2000}canvas\.setPointerCapture\(event\.pointerId\)/.test(pageSource),
      '独立桌宠的右键按下捕获指针，和窗口内桌宠一样');
    report(/orbiting: viewDrag !== null/.test(pageSource),
      '并把"正在旋转"报给启动器');
    report(/interacting = rect\.dragging === true \|\| rect\.orbiting === true;/.test(launcherSource),
      '启动器据此在整段旋转期间保持窗口可交互，指针才留得住');
    report(/win\.on\('focus', \(\) => \{\s*if \(!win\.isDestroyed\(\) && !orbitFocus\) win\.blur\(\);/.test(launcherSource),
      '而 focus→blur 的守卫也在：它此前会把旋转刚要到的焦点立刻抢走');
  }
  /**
   * 碎碎念: one chain, four links, in four different files.
   *
   * The pet's own remark travels app → host → window, and every link is a place the feature can go quiet
   * without any test failing elsewhere: the app must DECIDE a line (and publish it with the state), the host
   * must carry it (sanitised), the window must read it from the poll body, and the launcher must union its
   * rectangle into the window's bounds or the bubble is clipped by the window it is drawn in.
   */
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const hostSource = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8');
    const launcherSource = readFileSync(join(ROOT, 'desktop', 'main.js'), 'utf8');
    report(/new this\.core\.SpeechMachine\(function \(\) \{ return Date\.now\(\); \}\)/.test(clientSource),
      'the app owns a speech machine (the window has no session to react to)');
    report(/this\.publishState\(state, speech, touch, clock, null, snapshot\.completedUnreadCount \|\| 0, this\.decisionWhy\(\)\)/.test(clientSource),
      'and publishes the line WITH the state, the press, and the TURN clock, so none of the three can be dropped on the way');
    report(/const nextStateLine = cleanSpeechLine\(body && body\.line\)/.test(hostSource)
      && /petStateLine = nextStateLine/.test(hostSource),
      'the host sanitises and stores the line on /vrmpet3d/state');
    // The window reads the line out of the SAME body it reads the state from (one `applyHostState` call keeps
    // the two halves of one observation together).
    report(/applyHostState\(state, body && body\.at, body && body\.line/.test(windowSource),
      'the window reads it from the state poll body');
    report(/const speech = speechRect && speechRect\.width > 1/.test(launcherSource)
      && /const extras = \[menu, status, speech\]/.test(launcherSource),
      'and the launcher grows the window to hold the bubble without making it clickable');
    report(/speech: \(function \(\) \{[\s\S]{0,240}?speechBand\(\)/.test(windowSource),
      'the page reports the bubble rectangle, which is what the launcher unions');
    report(!/function hitTest\([\s\S]{0,600}?speechBox/.test(windowSource),
      'and the bubble is deliberately NOT in the hit test: it is there to be read, not clicked');
  }

  /**
   * 失联: a heartbeat in the app, a freshness window in the host, and the window told WHY it went quiet.
   *
   * The report this exists for (operator, 2026-10-11): "有时候开始工作的碎碎念不消失，完成任务后还在显示深度求索中". The
   * app posts only on CHANGE, so silence was ambiguous — a long turn and a page whose frame loop had stopped (which
   * Chromium does whenever the DSH window is hidden) looked identical, and the window, which reacts only to a moved
   * `seq`, drew 工作中 over a counting clock for ever. Four links, four files, and every one of them can go quiet on
   * its own: the app must RE-STATE itself, the host must AGE the report out, the reader must be able to tell why, and
   * the window must pass that reason through.
   */
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const coreSource = readFileSync(join(ROOT, 'lib', 'core.js'), 'utf8');
    const hostSource = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    report(/HOST_STATE_HEARTBEAT_MS = (\d+)/.test(coreSource)
      && /HOST_STATE_STALE_MS = (\d+)/.test(coreSource)
      && Number(coreSource.match(/HOST_STATE_STALE_MS = (\d+)/)[1])
        > Number(coreSource.match(/HOST_STATE_HEARTBEAT_MS = (\d+)/)[1]) * 3,
      'the freshness window is several heartbeats long, so a throttled page is not mistaken for a dead one');
    report(/function hostStateIsStale\(/.test(coreSource) && /function hostStateView\(/.test(coreSource),
      'and the rule is one pure function, which is where it is unit-tested');
    report(/startHeartbeat\(\)/.test(clientSource),
      'the app re-states itself on a timer, which is what makes silence mean something');
    report(/core\.hostStateView\(\{/.test(hostSource),
      'the host ages the report out on /vrmpet3d/state rather than serving it for ever');
    report(/petStateStale = false;/.test(hostSource),
      'and a report of any kind clears the flag, because a report is proof of life');
    report(/body && body\.error, body && body\.stale/.test(windowSource),
      'the window is told WHY the pet went quiet, so the readout can name it');
    report(/stale: hostStateStale,/.test(windowSource),
      'and publishes that reason for the launcher');
  }

  /**
   * 模型导入: the picker is the launcher's, the LIST is the host's.
   *
   * The backend has existed since §21 — a plugin-owned list file, an `add`/`remove` route, a catalog rebuilt per
   * request — and the UI is a folder picker plus that list. Three things have to hold, and the third is the one
   * the suites depend on: a web page cannot open a native dialog, so the LAUNCHER exposes it through the preload
   * bridge; the settings window must actually receive that bridge; and the chosen path is handed to the HOST
   * over `/vrmpet3d/models` rather than written by the page — which is what keeps `VRMPET3D_MODEL_DIRS_FILE`
   * (gotcha 37) in force for every suite.
   */
  {
    const preloadSource = readFileSync(join(ROOT, 'desktop', 'preload.js'), 'utf8');
    const launcherSource = readFileSync(join(ROOT, 'desktop', 'main.js'), 'utf8');
    const configSource = readFileSync(join(ROOT, 'lib', 'config-page.js'), 'utf8');
    report(/pickModelFile: \(language\) => ipcRenderer\.invoke\('vrmpet3d:pick-path', \{\s*kind: 'model', language: language === 'zh' \|\| language === 'en' \? language : undefined,\s*\}\)/.test(preloadSource),
      'the preload bridge exposes the native FILE picker for a model import');
    report(/pickMotionDir: \(language\) => ipcRenderer\.invoke\('vrmpet3d:pick-path', \{\s*kind: 'motion', language: language === 'zh' \|\| language === 'en' \? language : undefined,\s*\}\)/.test(preloadSource),
      'and a folder picker for motion directories, on the same channel');
    /**
     * The titles come from the launcher's OWN two-language table rather than from literals here.
     *
     * The launcher is a separate process with no `lib/core.js`, so it keeps its own copy of the repository's
     * `{ zh: {...}, en: {...} }` shape (2026-10-15). What this assertion is for has not changed — the dialog is
     * titled after what is being imported, a MODEL is a file dialog and a MOTION a folder one — but it now also
     * pins that BOTH languages are written, because the launcher draws its words from the request's language.
     */
    const dialogTable = /const DIALOG_TEXT = \{([\s\S]*?)\n\};/.exec(launcherSource);
    const dialogKeys = (half) => {
      if (!dialogTable) return null;
      const at = dialogTable[1].indexOf(`${half}: {`);
      if (at === -1) return null;
      const body = dialogTable[1].slice(at, dialogTable[1].indexOf('}', at));
      return [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((match) => match[1]).filter((key) => key !== half);
    };
    const zhKeys = dialogKeys('zh') || [];
    const enKeys = dialogKeys('en') || [];
    report(/kind === 'motion' \? \{/.test(launcherSource)
      && /title: text\.motionTitle/.test(launcherSource) && /title: text\.modelTitle/.test(launcherSource),
      'the launcher titles the dialog after what is being imported, and a MODEL is a file dialog while a MOTION is a folder one');
    report(zhKeys.length === 3 && zhKeys.join(' ') === enKeys.join(' '),
      `and the title it draws is written in both languages (${zhKeys.join(', ')})`);
    report(/motionTitle: '导入动作目录'[\s\S]*?modelTitle: '导入模型文件'/.test(launcherSource)
      && /motionTitle: 'Import motion folder'[\s\S]*?modelTitle: 'Import model file'/.test(launcherSource)
      && /modelFilter: 'VRM \/ glTF 模型'/.test(launcherSource)
      && /modelFilter: 'VRM \/ glTF model'/.test(launcherSource),
      'with the Chinese and English wording the two interfaces expect');
    report(/ipcMain\.handle\('vrmpet3d:pick-path'[\s\S]{0,700}?defaultPath/.test(launcherSource),
      'which opens at the home directory rather than guessing where models live');
    report(/properties: \['openFile'\][\s\S]{0,200}?extensions: \['vrm', 'glb', 'gltf'\]/.test(launcherSource),
      'and the model dialog is filtered to the three formats the asset route can serve');
    report(/fetch\('\/vrmpet3d\/models'[\s\S]{0,260}?method: 'POST'/.test(configSource),
      'the page hands the chosen path to the host over /vrmpet3d/models');
    report(configSource.includes('{ addFile: path }') && configSource.includes('{ removeFile: file }')
      && configSource.includes('{ remove: dir }'),
      "with the route's FILE verbs, plus the legacy directory removal, and nothing else");
    report(!/require\('node:fs'\)|writeFileSync/.test(configSource),
      'and never writes the list itself: the host is the only writer, which is what the file override needs');
    /**
     * 动作导入, the same three rules over `/vrmpet3d/motions`.
     *
     * Motions have their own route, their own list file and their own catalog — and, until this section, no way
     * in from the UI at all: the 状态 note told the user to import a directory with nothing to click. The one
     * thing that differs from the model section is what a write has to refresh, and that is asserted too: a new
     * clip has to reach the per-state checkboxes, not just a dropdown.
     */
    report(/fetch\('\/vrmpet3d\/motions'[\s\S]{0,260}?method: 'POST'/.test(configSource),
      'and hands a motion directory to the host over /vrmpet3d/motions');
    report(/writeImportedMotion\(\{ importDir: path \}\)/.test(configSource)
      && /writeImportedMotion\(\{ unimportDir: dir \}\)/.test(configSource)
      && /writeImportedMotion\(\{ remove: dir \}\)/.test(configSource),
      'with the motion route\'s IMPORT verbs, through their own writer, the legacy removal kept');
    report(/var motions = Array\.isArray\(payload\.motions\) \? payload\.motions : null;[\s\S]{0,400}?renderMotions\(\)/
      .test(configSource),
      'a successful motion write re-renders the 状态 rows from the catalog in the reply');
    report(!/motion-import[\s\S]{0,200}?writeFileSync/.test(configSource)
      && !/require\('node:fs'\)/.test(configSource),
      'and the page still writes no file: the host owns both lists, which is what the overrides need');
  }

  /**
   * A stale delivery must cost the FEATURE, not the PET.
   *
   * Not hypothetical: on 2026-10-11 the app loaded a new `lib/client.js` against a core chunk the browser had
   * cached under an unchanged revision, so `new this.core.SpeechMachine(...)` threw inside the widget's
   * constructor, the widget never mounted, `/vrmpet3d/state` carried `state: null` plus the TypeError, and the
   * floating window — which has no session of its own — drew 工作中 with the clock counting up for seventeen
   * minutes. The menu chunk added the same day has exactly the same exposure.
   *
   * The rule these assertions encode: a symbol the core might not have is CHECKED before it is used, and
   * nothing in the client half throws because a chunk is old.
   */
  {
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    /**
     * The two lines are asserted IN ORDER rather than within a character budget, which is what this check was when
     * the guard was the first thing in `buildMenu`. The 界面语言 round (2026-10-15) put a rebuild step in front of
     * it — the menu carries its labels from `createMenu` and cannot be re-worded in place — so the distance between
     * them grew for a reason that has nothing to do with the rule. What the rule IS has not changed: the module is
     * looked for and may be absent, and the widget survives that.
     */
    report(/var api = globalThis\.__VRMPET3D_MENU__;/.test(clientSource)
      && /if \(!api \|\| typeof api\.createMenu !== 'function'\) return null;/.test(clientSource)
      && clientSource.indexOf('typeof api.createMenu') > clientSource.indexOf('var api = globalThis.__VRMPET3D_MENU__;'),
      'the widget checks for the shared menu module instead of requiring it');
    report(!clientSource.includes('lib/menu.js is not loaded'),
      'and no longer throws when it is absent — the menu is a feature, the pet is the product');
    report(/this\.speech = typeof this\.core\.SpeechMachine === 'function'/.test(clientSource),
      'and the speech machine is built only when the core actually has one');
    report(/if \(!this\.menu\) return false;/.test(clientSource),
      'with the menu-dependent paths guarded, so a menu-less widget still runs its frame loop');
    /**
     * And the SURFACE rule, for the same reason. `petSurface: 'both'` (调试模式) is a value an older core chunk
     * does not know, and its cleaner rewrites it to `auto` — which happened for real on 2026-10-11: the store
     * said `both`, the cached cleaner dropped it, and the in-app pet hid itself exactly as if nobody had asked.
     * Where the pet lives is decided in the ENTRY, so the entry keeps the snapshot's own word for that value.
     */
    report(/function petSurfaceFrom\(raw, cleaned\) \{\s*return raw === 'both' \? 'both' : cleaned;/.test(clientSource),
      'and 调试模式 survives a core chunk that predates it, because the entry keeps the value it was handed');
    report(/next\.petSurface = petSurfaceFrom\(snapshot\.preferences && snapshot\.preferences\.petSurface/.test(clientSource),
      'with the host snapshot routed through that rule rather than through the cleaner alone');
    /**
     * And every method this half asks the menu module for must be CHECKED, because the two are delivered
     * separately and a page can hold one of them in its cache.
     *
     * This is not a hypothetical either — it is the second half of 「内置宠物右键单击无效」 (2026-10-12): the 重力
     * switch added `setChecked` to the module, an app that had a newer `lib/client.js` beside a cached
     * `client.menu.js` threw on that line INSIDE the right-click handler, and the menu never opened at all.
     * A right-click that does nothing is the worst version of this failure, because the pet looks broken
     * rather than old.
     *
     * The window's page has its own copy of the line and must be guarded too — asserted separately, because
     * the two surfaces are two files and fixing one is a mistake that looks finished.
     */
    report(/if \(typeof this\.menu\.setChecked === 'function'\)/.test(clientSource),
      'the app pet asks the shared menu for setChecked only when that chunk has it');
    report(/if \(typeof menu\.setChecked === 'function'\)/.test(
      readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8')),
      'and so does the floating window, which is a different file with the same exposure');
  }

  /**
   * The 2026-10-11 rules: the two notices WAIT, and they are gold and red.
   *
   * Each part lives in a different file, and each can go quiet on its own: the DECISION is core's
   * (`STATUS_TONES` + `UNTIMED_STATUS_STATES`), both surfaces must WEAR it (`data-tone`/`data-bold` in
   * `lib/client.js` and `lib/desktop-page.js`), the launcher must relay it (or `/vrmpet3d/desktop` cannot answer
   * "why is the prompt not gold"), and the settings page must not offer a 持续时间 that silently does nothing
   * for 等待确认. Nothing may pick a colour from a state name outside core — that is how the app and the window
   * end up disagreeing about which state is gold.
   */
  {
    const coreSource = readFileSync(join(ROOT, 'lib', 'core.js'), 'utf8');
    const clientSource = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
    const windowSource = readFileSync(join(ROOT, 'lib', 'desktop-page.js'), 'utf8');
    const launcherSource = readFileSync(join(ROOT, 'desktop', 'main.js'), 'utf8');
    const configSource = readFileSync(join(ROOT, 'lib', 'config-page.js'), 'utf8');
    report(/var UNTIMED_STATUS_STATES = \['waiting', 'done', 'error'\]/.test(coreSource),
      'core names the three event-ended states once');
    report(/var STATUS_TONES = \{\s*done: \{ tone: 'gold', bold: true \},\s*error: \{ tone: 'danger', bold: false \}/.test(coreSource),
      'and owns the gold/bold and red decisions in one table');
    report(/tone: look\.tone,/.test(coreSource) && /bold: look\.bold,/.test(coreSource),
      'which `statusFor` reports with the line, so no renderer has to guess');
    report(/node\.setAttribute\('data-tone', line\.tone\)/.test(clientSource)
      && /statusNode\.setAttribute\('data-tone', line\.tone\)/.test(windowSource),
      'both surfaces wear the tone the core decided');
    report(/data-tone="gold"\]\[data-bold="1"\]\{font-weight:700\}/.test(clientSource)
      && /data-tone="gold"\]\[data-bold="1"\]\{font-weight:700\}/.test(windowSource),
      'and both draw 任务达成 bold, each in its own palette');
    report(/tone: lastPageState\.status\.tone \|\| null/.test(launcherSource),
      'the launcher relays it, so /vrmpet3d/desktop can answer "is it gold?"');
    report(/\(core\.UNTIMED_STATUS_STATES \|\| \[\]\)\.indexOf\(state\) !== -1/.test(configSource)
      && /duration\.disabled = awaitingAnswer/.test(configSource),
      'and the settings page refuses a 持续时间 for 等待确认 instead of storing a number that does nothing');
    report(!/state === 'done' \? 'gold'/.test(clientSource) && !/state === 'done' \? 'gold'/.test(windowSource),
      'with no surface mapping a state to a colour on its own');
    /**
     * And an EMPTY 台词 box is NAMED per source, in the source's own words.
     *
     * The operator's report was "AI碎碎念开启后，面板里的各种状态后面就不应该写'用内置短语'了，应该是写'用内置AI生成提示词'": the
     * label kept promising the built-in table after choosing AI/custom had switched that table off. Three sources, three
     * labels, and the page reads the one that matches `speech.source` — so a new source cannot silently inherit
     * 「用内置短语」.
     */
    report(/emptyLinesBuiltin: '用内置短语'/.test(configSource)
      && /emptyLinesAi: '用内置 AI 生成提示词'/.test(configSource)
      && /emptyLinesBuiltin: 'uses the built-in phrases'/.test(configSource)
      && /emptyLinesAi: 'generated from the built-in AI prompt'/.test(configSource)
      && /function emptyLinesLabel\(source\)[\s\S]{0,200}?source === 'ai' \? t\('emptyLinesAi'\) : t\('emptyLinesBuiltin'\)/.test(configSource),
      'the settings page names an empty box per SOURCE — the built-in table, or the AI prompt — in both languages');
    report(/row\.count\.textContent = lines\.length \? fill\(t\('lineCount'\), \{ n: lines\.length \}\) : emptyLabel;/.test(configSource)
      && /row\.lines\.placeholder = emptyPlaceholder;/.test(configSource),
      'and both the count beside each state and the box placeholder follow it, recomputed on every change');
    /**
     * And the SHIPPED PART lines obey the same source, in all three readers at once.
     *
     * They are the third shipped table (after the state lines and the region heuristic), and they were added by the
     * fortieth pass with no source argument at all — so with 台词来源 on AI a press on 胸部 still answered 变态！ while
     * the model was asked to write the line. The rule now lives in ONE function (`core.partSpeechLines(item, allowed)`)
     * and the argument is `speech.source === 'builtin'` in the app's machine AND in the window's own press path: two
     * copies of a shipped-default rule is how these two surfaces have drifted every time before (2026-10-12: the
     * drag, the fall and the landing each cost a pass).
     *
     * The SETTINGS page used to pass that expression too, because 部位's placeholder spelled the shipped lines out
     * (「碎碎念：留空则说内置的 变态！」). The operator removed the announcement (2026-10-13: 「碎碎念框那行也变成通用灰字」),
     * so the page has nothing left to compute: it reads the table ONLY to publish its content for the panel's
     * self-test (deliberately, source or not, and since 2026-10-14 BOTH gesture pools), and it must not grow a second
     * copy of the source rule to keep the old wording alive. This pair is what says so.
     *
     * The two arguments after the source switch are new on 2026-10-14 (operator: 「拆成两池，长按另写 20 条」): the
     * shipped table is picked by GESTURE and by the LOCALE the surface is running in, so both press paths now hand
     * over their own reason for the press and their own language. Pinned in the source because the two surfaces
     * drifting apart on a shipped-default rule is the failure this project has paid for most often.
     */
    report(/partSpeechLines\(item, true, language, gesture\)/.test(coreSource)
      && /core\.partSpeechLines\(item, true, language, reason\)/.test(windowSource),
      'both press paths pass the SAME source argument to the shipped part lines, plus the gesture and the locale');
    report(/core\.partSpeechLines\(item, true, language, 'click'\)/.test(configSource)
      && /core\.partSpeechLines\(item, true, language, 'hold'\)/.test(configSource)
      && !/partSpeechLines\(item, partSource/.test(configSource)
      && !/partSpeechLines\(item, true, 'zh'/.test(configSource),
      'and the settings page reads the table ONLY to publish it — both pools of it, in the language it is drawn in and never a literal, never to word a hint with it');
    /**
     * The DATA-LOSS LATCH, pinned in the source.
     *
     * The accident this guards is the worst one this plugin has had: the settings page keeps the WHOLE preferences
     * object and writes it back on every change, so a page that failed before it adopted the host's snapshot posted
     * its DEFAULTS over everything the user had configured — the store file rewritten, on disk. `hasSnapshot` is the
     * guard: `persist()` is the only write path in the file and it must REFUSE before the first snapshot, and the
     * latch must be opened on the one path that has no snapshot to wait for (`onUnsupported`, and a core too old to
     * have the watcher at all) or an older host would silently lose every edit.
     *
     * Asserted on the source because the failure mode is silent and total: a suite that only drove a healthy page
     * would pass a build with no latch at all.
     */
    report(/var hasSnapshot = false;/.test(configSource)
      && /function persist\(\) \{\s*\n\s*if \(!hasSnapshot\) return;/.test(configSource)
      && (configSource.match(/hasSnapshot = true;/g) || []).length >= 3,
      'and the settings page may not write before it has read: `persist` refuses until `hasSnapshot` is latched');
    /**
     * EVERY id the settings pages' JS asks for exists in SOME page's markup, or is created at boot.
     *
     * This is the audit for a real accident (2026-10-11): a pass that deleted the page's explanatory prose also deleted
     * eight elements the code WRITES to, the first write threw, the page stopped before the host snapshot was applied, and
     * every control sat at its default — which the operator read, entirely reasonably, as "all my settings are gone",
     * while the store file had not been touched at all. A static audit of these files catches that in a second; the
     * runtime list is the set the page deliberately creates itself (`ensureStatusElements`).
     *
     * TWO pages since the same day, so the audit is over the UNION of their markup: one script drives both, and an id
     * that lives on either page is found by `element()` on the page that carries it. That is the honest question —
     * "does this lookup resolve on at least one of the two pages" — and it is deliberately NOT "on the page that asks
     * for it", because the script cannot tell which page it is on until it has read the DOM. What keeps a lookup from
     * silently resolving nowhere is the pair of assertions that each page carries its own half and none of the other's
     * (`scripts/verify-desktop.mjs`), which the union audit cannot see by construction.
     */
    {
      const pages = ['config-page.html', 'global-page.html'].map((file) => ({
        file,
        html: readFileSync(join(ROOT, 'lib', file), 'utf8'),
      }));
      const asked = [...new Set([...configSource.matchAll(/element\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]))];
      const runtimeCreated = new Set([...configSource.matchAll(/\['([a-zA-Z0-9_-]+)', '/g)].map((m) => m[1]));
      const missing = asked.filter((id) => !pages.some((page) => page.html.includes(`id="${id}"`))
        && !runtimeCreated.has(id));
      const perPage = pages.map((page) => `${page.file} ${asked.filter((id) => page.html.includes(`id="${id}"`)).length}`).join(', ');
      report(missing.length === 0,
        missing.length === 0
          ? `every one of the ${asked.length} ids the page asks for is in one of the two pages' markup or created at boot (${perPage}, ${runtimeCreated.size} created)`
          : `the page writes to elements that are in neither page's markup nor created at boot: ${missing.join(', ')}`);
    }
  }

  // Registering twice must not happen: the server throws on a duplicate (kind, path).
  lateCtx.pending[0].callback(scope);
  report(lateRegistrations.length === 22,
    `a second arrival does not re-register (${lateRegistrations.length} total)`);

  // Read the service THIS activation provided, not a Map entry: a second apply
  // overwrites the first, so the map holds the wrong instance.
  report(lateService?.assetRoutes?.catalog === '/vrmpet3d/catalog'
      && lateService.assetRoutes.motion === '/vrmpet3d/motion',
    `the service reports its routes once they exist (${JSON.stringify(lateService?.assetRoutes ?? null)})`);
// ---- imported model directories -------------------------------------------
// The settings panel writes through this store, so a failure here is an import that
// silently does not survive a restart.
{
  const { readImportedModelDirs, writeImportedModelDirs, modelDirsFilePath } = lateHost;
  report(typeof readImportedModelDirs === 'function' && typeof writeImportedModelDirs === 'function',
    'the host exports the imported-directory store');
  report(modelDirsFilePath() === scratch, 'the override path is honoured');
  report(readImportedModelDirs().length === 0, 'a missing list reads as empty');

  const tempDir = join(ROOT, 'build', 'probe');
  report(writeImportedModelDirs([tempDir, tempDir, '   ']) === null, 'writing the list succeeds');
  const roundTrip = readImportedModelDirs();
  report(roundTrip.length === 1 && roundTrip[0] === resolve(tempDir),
    `the list round-trips and de-duplicates (${JSON.stringify(roundTrip)})`);

  // A corrupt file must not take the pet down with it.
  writeFileSync(scratch, '{ not json');
  report(readImportedModelDirs().length === 0, 'a corrupt list reads as empty rather than throwing');
  try { rmSync(scratch, { force: true }); } catch { /* best effort */ }

  // ---- and the SETTINGS store must not have touched the operator's file -----
  // Applying the plugin constructs the settings store, and without the override that construction
  // wrote the operator's own `vrmpet3d-settings.json` (measured 2026-10-08: the live store said version
  // 13 while the file said version 1). The preferences survived by luck of ordering, so this is
  // asserted rather than reasoned about.
  const { settingsFileFor } = await import(pathToFileURL(join(ROOT, 'lib', 'settings.js')).href);
  const settingsPath = settingsFileFor('C:\\a-profile\\vrmpet3d-desktop');
  report(settingsPath === resolve(settingsScratch), `the settings override is honoured (${settingsPath})`);
  report(existsSync(settingsScratch), 'and applying the plugin wrote the scratch settings file');
  try { rmSync(settingsScratch, { force: true }); } catch { /* best effort */ }
}
}


// The status stream must open with a baseline and close cleanly.
if (service && typeof service.watch === 'function') {
  const controller = new AbortController();
  const iterator = service.watch(controller.signal);
  const first = await iterator.next();
  report(first?.value?.type === 'baseline', 'the status stream opens with a baseline');
  controller.abort();
  const done = await iterator.next();
  report(done?.done === true, 'aborting closes the status stream');
}

// --- 4. the client half, activated the way DSH activates it -----------------
//
// Why this exists at all, measured 2026-10-09: `lib/client.js` read a bare `core` in `apply`, which under
// `'use strict'` is a ReferenceError (not `undefined` — `typeof` does not make a property access safe).
// `apply` threw, the client entry settled FAILED, and DSH's web boot REFUSES to start while any entry has
// not activated: the operator got "应用无法启动 / dsh-plugin-vrmpet3d: failed" and the application would not
// open. Ten suites and 1212 checks were green, because the inlined browser pages load `lib/core.js` as a
// <script> tag (so a bare `core` would still have been undeclared) and, more to the point, the one page
// that uses the REAL client module system says in its own comment that it "does not mount the widget" —
// nothing anywhere called `apply` on the client half.
//
// So this calls exactly what the shell calls, in the shell's order: evaluate the classic script, take the
// registration, call its factory with the platform module table, then `apply(ctx)`. `lib/core.js` is
// deliberately NOT loaded here — in the real app it arrives as a chunk that begins fetching only after
// registration, so "activates with no core global yet" is the honest condition, and the one that broke.
{
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Error,
    TypeError,
    ReferenceError,
    JSON,
    Date,
    Map,
    Set,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Symbol,
    URL,
    URLSearchParams,
    // Real browser globals the activation path reaches for. Supplying them is the sandbox's job; a
    // missing one is the sandbox's gap, not the plugin's bug, and `AbortController` is the first the
    // boundary subscription touches.
    AbortController,
    Event: class Event { constructor(type) { this.type = type; } },
    // The state reporter POSTs to /vrmpet3d/state; nothing here needs a real answer.
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  let registration = null;
  sandbox.window = {
    __ModuleLoader__: { load: (entry) => { registration = entry; } },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    location: { href: 'dsh-app://app/' },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  let scriptError = null;
  try {
    createContext(sandbox);
    runInContext(readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8'), sandbox, { filename: 'lib/client.js' });
  } catch (error) {
    scriptError = error;
  }
  report(scriptError === null, 'lib/client.js evaluates as a classic script',
    scriptError && (scriptError.stack || scriptError.message));
  report(registration !== null && registration.id === pkg.name,
    `it registers its module table row under the package name (${registration?.id ?? 'nothing registered'})`);
  report(typeof registration?.factory === 'function', 'the registration carries a factory');

  // The platform module table the shell seeds; `react` is the only entry this half asks for by name.
  const reactStub = {
    createElement: () => null,
    useRef: () => ({ current: null }),
    useState: () => [null, () => {}],
    useEffect: () => {},
  };
  let clientPlugin = null;
  let factoryError = null;
  try {
    clientPlugin = registration.factory((id) => {
      if (id === 'react') return reactStub;
      throw new Error(`the client half required an unexpected platform module: ${id}`);
    });
  } catch (error) {
    factoryError = error;
  }
  report(factoryError === null, 'the factory runs against the platform module table',
    factoryError && (factoryError.stack || factoryError.message));
  report(Array.isArray(clientPlugin?.inject) && ['slots', 'sessions', 'locale'].every((s) => clientPlugin.inject.includes(s)),
    `the client half names its hard services (${JSON.stringify(clientPlugin?.inject ?? null)})`);

  const slotRows = [];
  const clientCtx = {
    slots: {
      inject: (slot, callback) => callback(),
      register: (row) => { slotRows.push(row); return () => {}; },
    },
    effect: () => {},
    get: () => undefined,
    on: () => {},
  };
  let clientApplyError = null;
  try {
    clientPlugin.apply(clientCtx);
  } catch (error) {
    clientApplyError = error;
  }
  report(clientApplyError === null,
    'the client apply(ctx) activates with no core global yet (the real activation-time state)',
    clientApplyError && (clientApplyError.stack || clientApplyError.message));
  report(slotRows.some((row) => row.name === 'shell.overlay' && row.id === 'vrmpet3d'),
    `it registers into the shell.overlay slot (${JSON.stringify(slotRows)})`);
}

// --- 5. disposal -----------------------------------------------------------
let disposeError = null;
for (const effect of [...effects].reverse()) {
  try {
    if (typeof effect.dispose === 'function') effect.dispose();
  } catch (error) {
    disposeError = error;
  }
}
report(disposeError === null, 'every cleanup effect disposes without throwing',
  disposeError && (disposeError.stack || disposeError.message));

// --- 6. profile resolution -------------------------------------------------
if (profileDir) {
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) {
    report(false, `profile manifest exists (${manifestPath})`);
  } else {
    const profileRequire = createRequire(manifestPath);
    let resolved = null;
    let resolutionError = null;
    try {
      resolved = profileRequire.resolve(pkg.name + '/package.json');
    } catch (error) {
      resolutionError = error;
    }
    report(Boolean(resolved), `the package resolves from the profile (${pkg.name})`,
      resolutionError && resolutionError.message);

    const profileManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    report(Boolean(profileManifest.dependencies?.[pkg.name]),
      'the profile declares the dependency');
    report(Boolean(profileManifest.dsh?.profile?.bundles?.includes(pkg.name)),
      'the profile lists the bundle');
  }
} else {
  console.log('  note  no --profile given; skipping profile resolution checks');
}

console.log(`\n${'-'.repeat(60)}`);
if (failures === 0) {
  console.log('plugin load preflight: PASSED');
  process.exit(0);
}
console.log(`plugin load preflight: ${failures} FAILED`);
process.exit(1);

// dsh-plugin-vrmpet3d ?host half.
//
// Responsibilities, and deliberately nothing else:
//
//   1. Watch turn boundaries and publish them to subscribed clients, exactly
//      like dsh-plugin-fatfish-pet. The pet's mood comes from these; session
//      text, tool arguments and attachments are never read, stored or forwarded.
//   2. Serve the user's own model and authored-motion files to the page over the
//      web carrier's `/vrmpet3d` routes. A plugin's `assets/` directory is NOT served
//      to the browser by DSH ?the only plugin-owned browser routes are
//      `/plugins/<id>/client*.js` ?so a model or a `.vrma` the user drops
//      on disk can only reach the page through a host route. Every route is
//      allowlisted to the configured directories and never exposes an absolute
//      path.
//
// Compatibility: both capabilities degrade cleanly. With no `agents` service the
// boundary hub still provides a baseline; with no `webServer` service the pet
// still runs from its built-in placeholder avatar and reports why.

import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SettingsStore, settingsFileFor } from './settings.js';
// `VRMPET3D_*` with the pre-rename `PET3D_*` names as a fallback — see the module's own note.
import { envVar } from './env.js';

// `lib/core.js` is a classic script that publishes itself on the global ?that is
// how the client half reads it too, so importing it here is what keeps ONE list
// of file extensions in the project. A host-side copy of the motion extensions is
// exactly the kind of mirror that drifts: the browser would offer the user a
// `.vrma` the host never scanned, or the two catalogs would slowly stop being
// disjoint, and neither side could tell.
import './core.js';

// The window's launcher management: the bare-Electron runtime, the spawn, and the lifecycle.
// Its own module because it is the one part of this half that starts a process, and because
// its pure helpers (env sanitisation, the link plan, the install-root search) are what the
// suite tests directly.
import { DesktopWindow, stateDir } from './desktop.js';
// Reads expressions, spring chains, materials and licence straight out of a model file, so the
// settings window can describe a model with no renderer running. `clearModelInfoCache` is the explicit
// half of that cache: the import route says "this file changed" rather than hoping the size/mtime check
// notices.
import { clearModelInfoCache, compactModelInfo, describeModelCached, imageMimeType, readGlb, thumbnailImage } from './vrm-info.js';
// Unpacks the pack's brotli-compressed clips (`<name>.vrma.br`). Node-only on purpose: the HOST unpacks, so
// the renderer is always handed a plain VRMA. See `createMotionHandler`.
import { COMPRESSED_SUFFIX, decompressBrotli, isCompressedMotionName } from './brotli.js';

/** The shared pure logic, published by the import above. */
const core = globalThis.__VRMPET3D_CORE__;

export const name = 'vrmpet3d';

/**
 * Hard dependency on the Loader-provided services is intentionally avoided:
 * `inject` lists only what the plugin cannot work without at all. Everything
 * else is looked up lazily through `ctx.get`, so a composition that lacks the
 * web carrier still activates the pet.
 */
export const inject = ['agents'];

/** Maximum number of turn boundaries queued for one client before a reset. */
export const BRIDGE_QUEUE_LIMIT = 128;

/** Files larger than this are refused by the asset and motion routes. */
export const MAX_ASSET_BYTES = 512 * 1024 * 1024;

/** Directory names skipped while scanning a models directory. */
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', '.svn', '__pycache__', '.DS_Store']);

/**
 * Model file extensions the catalog advertises, lower-case.
 *
 * Taken from `lib/core.js` rather than listed again here. The motion catalog
 * beside it is built from `core.MOTION_EXTENSIONS`, and the two must stay
 * disjoint ?a file offered by both catalogs, or by neither, is a class of bug
 * that no single route can see, so membership is decided in one place.
 */
const MODEL_EXTENSIONS = new Set(core.MODEL_EXTENSIONS);

/** Extension to MIME type for everything the asset and motion routes serve. */
const MIME_TYPES = {
  '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  // A VRMA is a binary glTF whose JSON chunk carries `VRMC_vrm_animation`, so it
  // is served with the type a GLB gets rather than as an opaque blob.
  '.vrma': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.tga': 'image/x-tga',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.mtl': 'text/plain; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.sph': 'image/x-tga',
  '.spa': 'image/x-tga',
  '.json': 'application/json; charset=utf-8',
};

/** Route paths owned by this plugin. Kept distinct; collisions throw. */
export const ROUTES = {
  catalog: '/vrmpet3d/catalog',
  models: '/vrmpet3d/models',
  /**
   * One model's own thumbnail, as IMAGE BYTES: `?m=<model id>`.
   *
   * A route of its own rather than a field in `/vrmpet3d/models`, and for the same reason the asset route is
   * separate from the catalog: a picker shows a GRID of models, so a catalog that carried every thumbnail
   * would be one base64 blob per model on every list refresh, while an `<img src>` asks for exactly the tiles
   * on screen and lets the browser cache them. `?m=` matches the asset and motion routes rather than inventing
   * a second query name.
   *
   * 404 (not an empty image) when a model carries none: a plain `.glb`, a VRM whose meta names no image, and
   * a `.gltf` whose image lives beside it are all normal, and the page draws its own placeholder for them.
   */
  modelThumbnail: '/vrmpet3d/model-thumbnail',
  asset: '/vrmpet3d/asset',
  motions: '/vrmpet3d/motions',
  motion: '/vrmpet3d/motion',
  /** The desktop window's page, its sources, and its on/off control. */
  window: '/vrmpet3d/window',
  /**
   * The page's own sources, as a prefix ?WITHOUT a trailing slash.
   *
   * DSH's matcher decides a prefix hit with `pathname === prefix || pathname.startsWith(prefix + '/')`,
   * so a registered prefix that already ends in `/` can only ever match the literal
   * `/vrmpet3d/window/lib//...`, which no browser sends. The first version of this route had the
   * trailing slash and every source 404'd: the window opened, the page loaded, the glue never
   * ran, and the pet was simply invisible. Every other prefix here works because it has no
   * trailing slash ?which is the tell that this one was wrong.
   */
  windowLib: '/vrmpet3d/window/lib',
  desktop: '/vrmpet3d/desktop',
  /**
   * What a model contains: expressions, spring-bone chains, materials, licence.
   *
   * Read from the FILE by the host, not from a running renderer, so the settings window can list a
   * model's expressions with no pet open — and so the list always matches the file that is loaded.
   */
  modelInfo: '/vrmpet3d/model-info',
  /**
   * The model-parameter window's page.
   *
   * A page of this plugin like the pet's own window, opened on demand: in DSH Desktop by the
   * launcher (so it is a real window), and anywhere else as a browser tab, which is why it lives
   * on the host rather than inside the pet window.
   */
  config: '/vrmpet3d/config',
  /**
   * The 通用设置 page: 模型导入 / 动作导入 / 状态 / 碎碎念 / 视线 / 鼠标互动 / 其他.
   *
   * A SECOND page rather than a hidden half of `config` (operator, 2026-10-11: "模型参数和通用设置是两个单独的
   * 页面"). Both are pages of this plugin, opened on demand by the launcher and shareable as a browser tab.
   *
   * Deliberately NOT `/vrmpet3d/settings`: that path is the settings STORE (GET the snapshot, POST a patch), and a
   * page and a JSON API on one route is the kind of collision this route table exists to keep out.
   */
  global: '/vrmpet3d/global',
  /**
   * The settings themselves: one store, read and written by every surface.
   *
   * It exists because `localStorage` does NOT cross application boundaries — the floating pet lives in
   * the plugin's own launcher app and the pet inside DSH lives in DSH, so the two never saw each other's
   * changes. The host is the only process that sees both, so it owns the settings and the surfaces poll
   * its version.
   */
  settings: '/vrmpet3d/settings',
  /**
   * The transient preview the settings window drives while a clip's expression/mouth is being chosen.
   * In memory only: nothing about a hover belongs in a stored preference.
   */
  preview: '/vrmpet3d/preview',
  /**
   * The first-run wizard's own state: has it been finished, and has THIS activation already offered it?
   *
   * `GET` answers `{completed, prompted}`. `POST {completed:true}` is the wizard's 完成 button and the ONLY thing
   * that stops the wizard coming back; `POST {prompted:true}` records that this activation has already opened it,
   * so a page refresh does not pop a second window. `prompted` is in memory on purpose: it must reset with the
   * process, which is exactly the operator's 「每次插件运行都会弹配置引导」.
   */
  setupState: '/vrmpet3d/setup-state',
  /**
   * The wizard's own page: 欢迎 / 偏好模型 / 桌宠界面 / AI 碎碎念 / 完成 — 模型动作 is hidden and 桌宠界面 is skipped where
   * no independent pet can exist, so which of the six screens a run VISITS is the page's own business
   * (`lib/setup-page.js`, and the stepper it builds from its own markup).
   *
   * A third page beside `config` and `global`, opened the same way — by the launcher on DSH Desktop (a real
   * window, with the preload bridge, so a file picker is native) and as a browser tab anywhere else.
   */
  setup: '/vrmpet3d/setup',
  /**
   * The model PICKER's page: 切换模型 — a big 选择/拖入 area over a grid of the model thumbnails.
   *
   * A fourth page beside `config`, `global` and `setup`, opened the same way (by the launcher on DSH Desktop as
   * a real window with the native file dialog, and as a browser tab anywhere else). It exists as a page rather
   * than as a panel inside the pet for two reasons: the pet's floating window is a click-through box that would
   * have to grow and become interactive for a grid of tiles, and the SAME content has to appear in the first-run
   * guide's 偏好模型 step — one page plus one shared component, instead of two hand-kept copies of a grid.
   */
  picker: '/vrmpet3d/picker',
  /**
   * The pet's live state, reported by the in-app pet and read by the floating window.
   *
   * Not a preference: it changes many times a minute, it must never be persisted, and the floating window
   * cannot derive it at all (it is a page in the launcher app, with no session catalog of its own). Same
   * shape as the preview channel — one in-memory value plus a counter — for the same reasons.
   */
  state: '/vrmpet3d/state',
  /**
   * One generated 碎碎念 line, on demand.
   *
   * The pet asks for a line when its 碎碎念 source is `ai`; the HOST makes the model call, because the custom
   * provider's credential and DSH's own LLM service both live on this side and a page must never hold either.
   * The answer is one line of text, which the asking surface puts into the same bubble the built-in lines use.
   *
   * `GET` with `?event=` is the probe form (it is what `scripts/live-probe.mjs` and the suite use); `POST`
   * with `{ event, state }` is what the page sends.
   */
  say: '/vrmpet3d/say',
  /**
   * Which model routes this app can actually reach, for the AI 碎碎念 settings.
   *
   * `?provider=<id>` adds that provider's model list. Answered from the LIVE LLM service rather than from a
   * copy in the settings, so the settings page can never offer a provider the app does not have.
   */
  llm: '/vrmpet3d/llm',
  /**
   * DSH's animated whale mark, as the status prompt's mask.
   *
   * Served by the host rather than inlined into a page, because there are TWO prompts (the in-app pet and the
   * floating window) and the mark is the same 21 KB image for both. See `whaleHandler`.
   */
  whale: '/vrmpet3d/whale',
};

/**
 * The page's own sources, by NAME.
 *
 * A whitelist rather than a path join: the `/vrmpet3d/window/lib` route is reachable from the windows' pages, and
 * `../` in a URL must never be able to read the profile, a model directory, or anything else outside the files
 * a page needs. `config-page.js` is here rather than at its own path because it is a page script like the
 * others and shares their directory — the whitelist is what keeps that safe.
 *
 * At MODULE level, and exported, rather than a `const` inside `apply`: the verification suite has to ask the
 * REAL handler for each of these names, and a copy of the list in the suite is how the list and the suite drift
 * apart. That copy is exactly how `pages.css` came to be served as JavaScript for a day (see `WINDOW_SOURCE_TYPES`).
 */
export const WINDOW_SOURCES = new Set([
  // `placeholder.js` was served here until 2026-10-10: the built-in avatar is gone (the operator's "内置的占位
  // 模型还是没删掉，把Sample Model设为内置模型"), so no page may fetch the module that builds one.
  'client.vendor.js', 'core.js', 'scene.js', 'client.js', 'desktop-page.js',
  'config-page.js',
  // The first-run guide's own script: a page of this plugin like the two settings pages, and served through the
  // same whitelist rather than a path of its own.
  'setup-page.js',
  // The model picker: ONE component, used by the guide's 偏好模型 step and by the 切换模型 page. Two copies of a
  // grid of thumbnails is exactly how the two would drift (and the operator asked for them to be identical).
  'model-picker.js',
  'picker-page.js',
  // The stylesheet the TWO settings pages share. One file rather than a copy in each page's `<head>`: the two
  // render the same rows, tables and status lines, and a copy is how the two drift apart.
  'pages.css',
  // The right-click MENU, shared by both pets: one definition, so the eight entries, their order and their
  // words cannot differ between the pet inside the app and the pet in its own window. It replaced
  // `panel.js` on 2026-10-11 — see `lib/menu.js`'s header for why one panel for both pets was still the
  // wrong shape — and that file was deleted on 2026-10-12 rather than left in the tree as a second
  // definition nobody served.
  'menu.js',
]);

/**
 * What a whitelisted name is served AS, by extension.
 *
 * Not cosmetic, and not optional: a `<link rel="stylesheet">` whose response is not CSS is refused by the
 * browser before a single rule is applied — Chrome blocks it outright with "Refused to apply style ... its MIME
 * type ('text/javascript') is not a supported stylesheet MIME type, and strict MIME checking is enabled". This
 * route hard-coded the JavaScript type for EVERY name in the whitelist, `pages.css` included, so the two
 * settings windows were a wall of unstyled text while every status code said 200 and the scripts ran normally
 * (found 2026-10-10 by the operator: "插件面板设置窗口完全变成了无格式文本的堆积").
 *
 * No suite could see it: the FAKE page server in `verify-desktop.mjs` answers `pages.css` itself, with
 * `text/css`, so the one request that mattered was the one no harness made. `verify-model.mjs` now drives the
 * real handler and asserts this table per name.
 *
 * An extension with no entry falls back to JavaScript, which is what every entry but the stylesheet is.
 */
export const WINDOW_SOURCE_TYPES = { '.css': 'text/css; charset=utf-8' };

/**
 * Resolve the plugin's own directory. Used to locate the bundled `assets/models` folder, which ships exactly TWO
 * models: `BlueFatFish.vrm` (the default) and `SampleModel.vrm`. Both may be redistributed with this plugin — the
 * first because its author gave permission, the second because the licence embedded in the file grants it — and
 * both are credited in `BUNDLED_MODEL_CREDITS` below, in `assets/models/README.md` and in README.md. Every other
 * model is the user's own.
 */
export const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * The two models this plugin SHIPS, and who made them — the ONE place these credits are written.
 *
 * Operator, 2026-10-13: 「需要注明来源和作者」, with the author's permission for the second file to be distributed
 * inside the plugin. The credit travels to the picker inside the catalogue (a `credit` object on every
 * `source: 'bundled'` entry) rather than being spelled out a second time in `lib/model-picker.js`, for the same
 * reason the picker itself is one component instead of two: two spellings of a credit are two credits the moment
 * one of them is edited. The docs quote the same names, and `scripts/check-docs.mjs` asserts that they do.
 *
 * `title`/`author` are what the model's own embedded metadata says, except where the author publishes under a
 * different name; `source` is where the file came from, and `license` is the basis on which it ships here, in the
 * words the documentation uses.
 */
export const BUNDLED_MODEL_CREDITS = {
  'BlueFatFish.vrm': {
    title: '蓝色小肥鱼Deepseek',
    author: '木子恶魔',
    source: 'https://www.aplaybox.com/details/model/ayXkRzVflmnd',
    license: '经作者授权分发，需注明来源与作者',
  },
  'SampleModel.vrm': {
    title: 'ヴィータ',
    author: 'VRoid プロジェクト',
    source: 'https://vroid.com/en/studio',
    license: '内嵌许可允许再分发与修改，无需署名',
  },
};

/**
 * The credit for one catalogued file, or null when it is not a file this plugin shipped.
 *
 * Compared on the base name and case-insensitively: a bundled entry is catalogued under its bare file name, but
 * the same helper has to answer for a name that arrived from a page or a suite.
 */
export function bundledModelCredit(name) {
  const base = String(name || '').split(/[\\/]/).pop().toLowerCase();
  for (const [file, credit] of Object.entries(BUNDLED_MODEL_CREDITS)) {
    if (file.toLowerCase() === base) return credit;
  }
  return null;
}

/**
 * Where the directories a user imports from the settings panel are remembered.
 *
 * Deliberately NOT the running profile's `cordis.patch.yml`: that file belongs to
 * the user and to DSH's own config editor, and a plugin silently rewriting it would
 * fight both. A plugin-owned file in the profile directory is written only by us,
 * takes effect without a restart, and is trivial to inspect or delete.
 *
 * `VRMPET3D_MODEL_DIRS_FILE` overrides the location, which is what the tests use.
 */
export function modelDirsFilePath() {
  const override = envVar('MODEL_DIRS_FILE');
  if (override) return resolve(override);
  const profile = process.env.DSH_PROFILE_DIR;
  const base = profile ? resolve(profile) : join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'vrmpet3d-model-dirs.json');
}

/**
 * Where the imported-model list lived before the 2026-10-12 rename, or null when there is nothing to migrate.
 *
 * Only the SHIPPED name migrates: an override (`VRMPET3D_MODEL_DIRS_FILE`, which is what the suites use) names a
 * file this project did not write under another name, so it must never pick up the operator's real list.
 */
export function legacyModelDirsFilePath() {
  if (envVar('MODEL_DIRS_FILE')) return null;
  const profile = process.env.DSH_PROFILE_DIR;
  const base = profile ? resolve(profile) : join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'pet3d-model-dirs.json');
}

/**
 * The CURRENT file first, then the pre-rename one ONCE, so a profile that had imported directories keeps them.
 *
 * Read-only migration: the next write puts the same list under the current name, and the old file is left alone
 * (it is the user's data, and deleting it is not this plugin's business).
 */
function modelDirsFileToRead() {
  const file = modelDirsFilePath();
  if (existsSync(file)) return file;
  const legacy = legacyModelDirsFilePath();
  return legacy && existsSync(legacy) ? legacy : file;
}

/**
 * The persisted list, or an empty one.
 *
 * Every failure is non-fatal by design: a missing file is the normal first run, and
 * a corrupt one must not stop the pet from loading. Entries are resolved and
 * de-duplicated here so the caller never has to; paths that no longer exist are
 * KEPT, because a directory on an unmounted drive should come back when it does.
 */
export function readImportedModelDirs(file = modelDirsFileToRead()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.modelDirs;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const dir of list) {
      if (typeof dir !== 'string' || !dir.trim()) continue;
      const absolute = resolve(dir.trim());
      if (out.indexOf(absolute) === -1) out.push(absolute);
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the list. @returns {string|null} an error message, or null on success. */
export function writeImportedModelDirs(dirs, file = modelDirsFilePath()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ modelDirs: dirs }, null, 2) + '\n');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------
// IMPORTED FILES: what the user brings in is COPIED into the plugin's storage
// ---------------------------------------------------------------------------

/**
 * Bounds for one import.
 *
 * A folder picker is one click away from a synced drive or a whole `Downloads`, and this copies bytes into the
 * profile — so an import is bounded. Far more than a motion pack, far less than an accident.
 */
const IMPORT_LIMITS = { maxFiles: 400, maxBytes: 512 * 1024 * 1024 };

/**
 * Where the plugin keeps its own copy of whatever the user imported.
 *
 * Operator, 2026-10-12: 「允许用户选择VRM模型所在的文件，并导入到插件的本地配置中去，不再是选中一个文件夹了，万一文件夹
 * 移位了，也会出bug」. A recorded directory — and a recorded file path just the same — is a live dependency on
 * somebody else's folder: move it, rename it, or let a sync client rewrite it, and the pet quietly loses a model.
 * So an import COPIES the bytes HERE, both catalogues read them from here, and after the import the original
 * folder is nobody's business.
 *
 * It sits inside the profile's own state directory, beside the settings, which is what keeps "uninstall" meaning
 * "remove the checkout": the imported bytes are the user's and are never deleted with this package.
 * `VRMPET3D_IMPORT_DIR` overrides the location — the suites use it so a run can never copy into the operator's
 * real storage.
 */
export function importRootDir() {
  const override = envVar('IMPORT_DIR');
  if (override) return resolve(override);
  const profile = process.env.DSH_PROFILE_DIR;
  const base = profile ? resolve(profile) : join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'vrmpet3d-desktop');
}

/** The two folders inside the import root, one per kind. */
export function importedModelsDir() { return join(importRootDir(), 'models'); }
export function importedMotionsDir() { return join(importRootDir(), 'motions'); }

/**
 * The provenance lists, siblings of the directory lists they extend.
 *
 * The COPY is what the catalogue scans (through the two folders above); these files are what the panels list, so
 * the user can see where a model came from and remove it again. Same shape and same write rules as the directory
 * lists: a plugin-owned file in the profile, a missing or corrupt one read as empty, an override for the suites.
 */
function importStoreFile(name, overrideName) {
  const named = envVar(overrideName);
  if (named) return resolve(named);
  return join(dirname(importRootDir()), name);
}
export function modelFilesFilePath() { return importStoreFile('vrmpet3d-model-files.json', 'MODEL_FILES_FILE'); }
export function motionImportsFilePath() { return importStoreFile('vrmpet3d-motion-imports.json', 'MOTION_IMPORTS_FILE'); }

/** The imported-model provenance, or an empty list. @returns {{file:string,name:string,source:string,importedAt:number}[]} */
export function readImportedModelFiles(file = modelFilesFilePath()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.models;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const entry of list) {
      if (!entry || typeof entry.file !== 'string' || !entry.file.trim()) continue;
      const absolute = resolve(entry.file.trim());
      if (out.some((seen) => seen.file === absolute)) continue;
      out.push({
        file: absolute,
        name: typeof entry.name === 'string' && entry.name ? entry.name : basename(absolute),
        source: typeof entry.source === 'string' ? entry.source : '',
        importedAt: Number.isFinite(Number(entry.importedAt)) ? Number(entry.importedAt) : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the imported-model provenance. @returns {string|null} an error message, or null on success. */
export function writeImportedModelFiles(models, file = modelFilesFilePath()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ models }, null, 2) + '\n');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The imported-motion provenance, or an empty list. @returns {{dir:string,name:string,source:string,clips:number,importedAt:number}[]} */
export function readImportedMotionImports(file = motionImportsFilePath()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.imports;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const entry of list) {
      if (!entry || typeof entry.dir !== 'string' || !entry.dir.trim()) continue;
      const absolute = resolve(entry.dir.trim());
      if (out.some((seen) => seen.dir === absolute)) continue;
      out.push({
        dir: absolute,
        name: typeof entry.name === 'string' && entry.name ? entry.name : basename(absolute),
        source: typeof entry.source === 'string' ? entry.source : '',
        clips: Number.isFinite(Number(entry.clips)) ? Number(entry.clips) : 0,
        importedAt: Number.isFinite(Number(entry.importedAt)) ? Number(entry.importedAt) : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the imported-motion provenance. @returns {string|null} an error message, or null on success. */
export function writeImportedMotionImports(imports, file = motionImportsFilePath()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ imports }, null, 2) + '\n');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A free path inside `dir` for `name`: the name itself, else `name-2`, `name-3`, … before the extension. */
function freePathIn(dir, name) {
  const ext = extname(name);
  const stem = ext ? name.slice(0, name.length - ext.length) : name;
  let candidate = join(dir, name);
  for (let n = 2; existsSync(candidate) && n < 1000; n += 1) candidate = join(dir, `${stem}-${n}${ext}`);
  return candidate;
}

/** True when `target` is inside `dir` (so a removal can never reach out of the plugin's own storage). */
function insideDir(dir, target) {
  const root = resolve(dir);
  const path = resolve(target);
  return path === root || path.startsWith(root + sep);
}

/**
 * Copy ONE model file into the plugin's storage.
 *
 * Idempotent by name + size: importing the same file twice records the copy that is already there rather than
 * piling up `SampleModel-2.vrm`. A DIFFERENT file with the same name gets a suffix, because two models called
 * `SampleModel.vrm` are a normal thing to own.
 *
 * @returns {{entry: object, existed: boolean}|{error: string}}
 */
export function importModelFile(source, existing = readImportedModelFiles()) {
  const raw = typeof source === 'string' ? source.trim() : '';
  if (!raw) return { error: 'expected a file path' };
  const absolute = resolve(raw);
  if (!existsSync(absolute)) return { error: `no such file: ${absolute}` };
  let stats;
  try { stats = statSync(absolute); } catch (error) { return { error: `could not read ${absolute}: ${error.message}` }; }
  if (!stats.isFile()) return { error: `not a file: ${absolute}` };
  if (!isModelFileName(basename(absolute))) {
    return { error: `${basename(absolute)} is not a model this plugin loads (.vrm / .glb / .gltf)` };
  }
  const known = existing.find((entry) => entry.name === basename(absolute)
    && existsSync(entry.file) && statSync(entry.file).size === stats.size);
  if (known) return { entry: known, existed: true };

  const dir = importedModelsDir();
  mkdirSync(dir, { recursive: true });
  const target = freePathIn(dir, basename(absolute));
  copyFileSync(absolute, target);
  return {
    entry: { file: target, name: basename(target), source: absolute, importedAt: Date.now() },
    existed: false,
  };
}

/**
 * Copy ONE model file into the plugin's storage — the same import, from BYTES.
 *
 * The picker can be handed a file two ways and both have to land in the same store: the launcher's native
 * dialog returns a PATH (above), while a file dropped onto the page — or chosen through a plain
 * `<input type="file">` in a browser tab, where no launcher exists — only ever produces a `File`. So the page
 * uploads the bytes and the host writes them here, which is also what keeps the host the ONLY writer of the
 * import store, exactly as the path import does.
 *
 * The rules are deliberately the path import's rules: `.vrm` / `.glb` / `.gltf` by name, a name that collides
 * gets `-2` rather than overwriting, and the same name + the same size is the same import rather than a second
 * copy. `source` records that it arrived as an upload, because there is no original path to name.
 *
 * @returns {{entry: object, existed: boolean}|{error: string}}
 */
export function importModelBytes(name, bytes, existing = readImportedModelFiles()) {
  const raw = typeof name === 'string' ? name.trim().replace(/\\/g, '/') : '';
  const base = basename(raw);
  if (!base || base === '.' || base === '..') return { error: 'expected a file name' };
  if (!isModelFileName(base)) {
    return { error: `${base} is not a model this plugin loads (.vrm / .glb / .gltf)` };
  }
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!body.length) return { error: 'the uploaded file was empty' };

  const known = existing.find((entry) => entry.name === base
    && existsSync(entry.file) && statSync(entry.file).size === body.length);
  if (known) return { entry: known, existed: true };

  const dir = importedModelsDir();
  mkdirSync(dir, { recursive: true });
  const target = freePathIn(dir, base);
  writeFileSync(target, body);
  return {
    entry: { file: target, name: basename(target), source: `upload:${base}`, importedAt: Date.now() },
    existed: false,
  };
}

/** Remove a copy this plugin made, and never anything else. @returns {boolean} whether it was there. */
export function removeImportedModelFile(file) {
  const absolute = resolve(String(file || ''));
  if (!insideDir(importedModelsDir(), absolute)) return false;
  try {
    rmSync(absolute, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect the motion files under a folder, bounded, WITHOUT following anything out of it.
 *
 * Only clips and the two manifest names travel: an import is the user's motion library, not a copy of whatever
 * else happened to sit beside it (a `.txt`, a 4 GB video, a nested git checkout).
 *
 * @returns {{clips: {from:string,rel:string}[], manifests: {from:string,rel:string}[], bytes:number, error:string|null}}
 */
export function collectMotionImport(root) {
  const dir = resolve(String(root || ''));
  const clips = [];
  const manifests = [];
  let bytes = 0;
  const error = (message) => ({ clips, manifests, bytes, error: message });
  if (!existsSync(dir)) return error(`no such directory: ${dir}`);
  let stats;
  try { stats = statSync(dir); } catch (e) { return error(`could not read ${dir}: ${e.message}`); }
  if (!stats.isDirectory()) return error(`not a directory: ${dir}`);
  const own = importedMotionsDir();
  if (insideDir(own, dir)) return error('that folder is already inside the plugin\'s own motion storage');

  const walk = (current, rel) => {
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch (e) { return `could not read ${current}: ${e.message}`; }
    for (const entry of entries) {
      const next = join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      let kind;
      try { kind = statSync(next); } catch { continue; }
      if (kind.isDirectory()) {
        const problem = walk(next, nextRel);
        if (problem) return problem;
        continue;
      }
      if (!kind.isFile()) continue;
      if (core.isMotionFile(entry.name)) {
        if (clips.length + 1 > IMPORT_LIMITS.maxFiles) return `more than ${IMPORT_LIMITS.maxFiles} files in that folder`;
        bytes += kind.size;
        if (bytes > IMPORT_LIMITS.maxBytes) return `more than ${Math.round(IMPORT_LIMITS.maxBytes / (1024 * 1024))} MB in that folder`;
        clips.push({ from: next, rel: nextRel });
        continue;
      }
      // The folder's own manifest travels with it: it is where a clip's 循环/单次 lives, and leaving it behind
      // would turn a declared one-shot into a loop the moment it was imported.
      if (entry.name === MOTION_MANIFEST_FILE || entry.name === LEGACY_MOTION_MANIFEST_FILE) {
        manifests.push({ from: next, rel: nextRel });
      }
    }
    return null;
  };
  const problem = walk(dir, '');
  if (problem) return error(problem);
  if (!clips.length) return error('no .vrma or .vrma.br files in that folder');
  return { clips, manifests, bytes, error: null };
}

/**
 * Copy a folder of clips into the plugin's storage, tree and manifest included.
 *
 * One subfolder per import (`<imports>/<folder name>/…`), so two imports that share a file name can never
 * overwrite each other and the user can point at which import a clip came from.
 *
 * @returns {{entry: object, existed: boolean, clips: number, bytes: number}|{error: string}}
 */
export function importMotionFolder(source, existing = readImportedMotionImports()) {
  const collected = collectMotionImport(source);
  if (collected.error) return { error: collected.error };
  const from = resolve(String(source));
  const name = basename(from);
  const known = existing.find((entry) => entry.source === from);
  if (known && existsSync(known.dir)) {
    return { entry: known, existed: true, clips: known.clips, bytes: collected.bytes };
  }
  const root = importedMotionsDir();
  mkdirSync(root, { recursive: true });
  const target = freePathIn(root, name);
  for (const file of [...collected.clips, ...collected.manifests]) {
    const to = join(target, ...file.rel.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(file.from, to);
  }
  return {
    entry: {
      dir: target,
      name: basename(target),
      source: from,
      clips: collected.clips.length,
      importedAt: Date.now(),
    },
    existed: false,
    clips: collected.clips.length,
    bytes: collected.bytes,
  };
}

/** Remove a motion import this plugin made, and never anything else. @returns {boolean} whether it was there. */
export function removeImportedMotionFolder(dir) {
  const absolute = resolve(String(dir || ''));
  if (!insideDir(importedMotionsDir(), absolute) || absolute === resolve(importedMotionsDir())) return false;
  try {
    rmSync(absolute, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The first-run wizard: has it been finished on this machine?
// ---------------------------------------------------------------------------

/**
 * Where "the user has finished the setup wizard" is remembered.
 *
 * A plugin-owned file rather than a preference, for the same reason the import lists are: the HOST has to answer
 * "should the wizard open?" at activation, before any page exists to read a preference, and the answer must
 * survive a restart. `VRMPET3D_SETUP_FILE` overrides it for the suites.
 *
 * The flag is set by ONE thing — the wizard's own 完成 button — so closing the page early keeps the wizard coming
 * back on the next run, which is what the operator asked for: 「安装成功后，彻底配置完之前，每次插件运行都会弹配置
 * 引导」.
 */
export function setupFilePath() {
  const override = envVar('SETUP_FILE');
  if (override) return resolve(override);
  const profile = process.env.DSH_PROFILE_DIR;
  const base = profile ? resolve(profile) : join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'vrmpet3d-setup.json');
}

/** @returns {{completed:boolean, completedAt:number, version:number}} */
export function readSetupState(file = setupFilePath()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      completed: parsed?.completed === true,
      completedAt: Number.isFinite(Number(parsed?.completedAt)) ? Number(parsed.completedAt) : 0,
      version: Number.isFinite(Number(parsed?.version)) ? Number(parsed.version) : 0,
    };
  } catch {
    return { completed: false, completedAt: 0, version: 0 };
  }
}

/** Persist the setup state. @returns {string|null} an error message, or null on success. */
export function writeSetupState(state, file = setupFilePath()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      completed: state?.completed === true,
      completedAt: Number.isFinite(Number(state?.completedAt)) ? Number(state.completedAt) : 0,
      version: Number.isFinite(Number(state?.version)) ? Number(state.version) : 1,
    }, null, 2) + '\n');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The same pair for MOTION directories.
 *
 * Motions used to come only from the plugin's own `config.motionDirs`, which meant a `.vrma` could not be
 * put to use without editing the profile's config and restarting DSH — the exact friction that makes an
 * authored-motion feature feel broken ("I dropped the file in and nothing happened"). Model directories
 * already solve this with a plugin-owned file; motions now use the same mechanism, and the motion catalog
 * is rebuilt per request, so an import is live immediately.
 *
 * `VRMPET3D_MOTION_DIRS_FILE` overrides the location, which is what the tests use.
 */
export function motionDirsFilePath() {
  const override = envVar('MOTION_DIRS_FILE');
  if (override) return resolve(override);
  const profile = process.env.DSH_PROFILE_DIR;
  const base = profile ? resolve(profile) : join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'vrmpet3d-motion-dirs.json');
}

/**
 * The pre-rename motion-directory file, and the read that falls back to it — the same pair as the model list.
 *
 * Only the SHIPPED name migrates; an override is authoritative and gets no legacy read (see above).
 */
export function legacyMotionDirsFilePath() {
  if (envVar('MOTION_DIRS_FILE')) return null;
  const profile = process.env.DSH_PROFILE_DIR;
  const base = profile ? resolve(profile) : join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'pet3d-motion-dirs.json');
}

function motionDirsFileToRead() {
  const file = motionDirsFilePath();
  if (existsSync(file)) return file;
  const legacy = legacyMotionDirsFilePath();
  return legacy && existsSync(legacy) ? legacy : file;
}

/** The persisted motion directory list, or an empty one. Failures are non-fatal, exactly as above. */
export function readImportedMotionDirs(file = motionDirsFileToRead()) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.motionDirs;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const dir of list) {
      if (typeof dir !== 'string' || !dir.trim()) continue;
      const absolute = resolve(dir.trim());
      if (out.indexOf(absolute) === -1) out.push(absolute);
    }
    return out;
  } catch {
    return [];
  }
}

/** Persist the motion directory list. @returns {string|null} an error message, or null on success. */
export function writeImportedMotionDirs(dirs, file = motionDirsFilePath()) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ motionDirs: dirs }, null, 2) + '\n');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The manifest a motion directory may carry: `<dir>/vrmpet3d-motions.json`.
 *
 * A `.vrma` says how the bones move; it has no way to say whether it is a 6-second ambient loop or a
 * 2-second wave that should play ONCE and hand the pose back. That distinction is not decoration — a
 * one-shot clip played with `LoopRepeat` waves at the user forever, and a looping clip played with
 * `LoopOnce` freezes the pet in its last frame until the state changes. So the flag lives beside the
 * clips, in a file the plugin owns, discovered in the same scan that finds the files it describes:
 *
 *     { "clips": { "vrmpet3d-wave.vrma": { "loop": false } } }
 *
 * Keys are FILE NAMES RELATIVE TO THAT MOTION DIRECTORY (the same string the catalog reports as `name`),
 * never absolute paths and never ids: the id is minted per profile and can differ on the next machine,
 * while the file name travels with the directory.
 *
 * Every failure is non-fatal and means "no clips were declared": a missing file is the normal case, and a
 * corrupt one must not stop the pet from loading any motion at all. An unrecognised field is ignored
 * rather than refused, so a manifest written by a later build still loads here.
 */
export const MOTION_MANIFEST_FILE = 'vrmpet3d-motions.json';

/**
 * The manifest name this project used before the 2026-10-12 rename — read beside the current one, never written.
 *
 * A motion directory is the USER's (often outside the repository, e.g. the folder their clips live in), so a
 * directory whose manifest was written under the old name keeps its per-clip `loop` flags instead of silently
 * falling back to "every clip loops".
 */
export const LEGACY_MOTION_MANIFEST_FILE = 'pet3d-motions.json';

/** Bounds on the manifest: a preferences-adjacent file the operator can hand-edit. */
const MOTION_MANIFEST_LIMITS = {
  maxEntries: 512,
  maxNameLength: 512,
  maxStates: 64,
};

/**
 * Read one motion directory's manifest.
 *
 * The shape is `{ clips: { '<relative name>': { loop } } }`, optionally with a `defaults` block naming the
 * clips a user who has configured nothing should get. `defaults` is validated here rather than at the point
 * of use: a state name that is not a motion state, or a clip name that is not a string, is dropped, because
 * a manifest is a hand-editable file next to the user's clips and a typo in it must not become a settings
 * value nobody can see or clear.
 *
 * @param {string} file absolute path of the manifest.
 * @returns {{clips: object, stateFolders: object, defaults: object}} all empty when there is nothing usable.
 */
export function readMotionManifest(file) {
  const empty = { clips: {}, stateFolders: {}, defaults: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return empty;
    const clips = parsed.clips && typeof parsed.clips === 'object' ? parsed.clips : null;
    const out = {};
    let count = 0;
    for (const rawName of clips ? Object.keys(clips) : []) {
      if (count >= MOTION_MANIFEST_LIMITS.maxEntries) break;
      const entry = clips[rawName];
      if (typeof rawName !== 'string' || !rawName || rawName.length > MOTION_MANIFEST_LIMITS.maxNameLength) continue;
      if (!entry || typeof entry !== 'object' || typeof entry.loop !== 'boolean') continue;
      // Normalised to forward slashes so a manifest written on Windows by hand matches the catalog,
      // which reports relative paths with `/` on every platform.
      out[rawName.replace(/\\/g, '/')] = { loop: entry.loop };
      count += 1;
    }
    return {
      clips: out,
      stateFolders: readMotionStateFolders(parsed.stateFolders),
      defaults: readMotionDefaults(parsed.defaults),
      template: readMotionTemplate(parsed.template),
    };
  } catch {
    return empty;
  }
}

/**
 * A manifest's `stateFolders` block, cleaned: `{ [state]: ['<folder name>', ...] }`.
 *
 * The mapping that keeps the 状态与动作 picker short: each state is offered the clips inside ITS folders, so a
 * pack with one folder per state is six short lists instead of one long one. Each value is a SINGLE path
 * segment — a clip's own folder is the first component of its relative name, so `idle/2026/x.vrma` still
 * belongs to `idle` — and it is always a LIST here, even for the one-folder case, so no reader has to ask
 * which shape it was given. (`lib/config-page.js`'s `stateFolderNames` still accepts a bare string, for a
 * host older than this one.)
 *
 * Validated like the other blocks, because this is a hand-editable file: a state the session machine cannot
 * reach, an empty value, or one that is not a plain segment is dropped rather than trusted. A state with no
 * entry here is offered the WHOLE catalogue, which is what every build did before this block existed — so
 * omitting `stateFolders` is the compatible choice, not the broken one.
 */
export function readMotionStateFolders(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const states = Array.isArray(core.MOTION_STATES) ? core.MOTION_STATES : [];
  const clean = (value) => {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    // One segment only: a path here could never equal a folder name, and the page would compare two strings
    // that cannot match while reporting the block as accepted.
    if (!name || name.length > MOTION_MANIFEST_LIMITS.maxNameLength || name.indexOf('/') !== -1) return null;
    return name;
  };
  for (const state of Object.keys(raw)) {
    if (states.indexOf(state) === -1) continue;
    /**
     * One folder, or a LIST of them.
     *
     * A state usually draws from one folder, but not always: the pack keeps a `dance/` collection that belongs
     * to no state until the operator says where it goes, and "任务完成 could also show a dance" is a decision
     * that should need a manifest edit rather than a code change. A bare string stays accepted, so the simple
     * case reads simply — and the shape is normalised to a list here so nothing downstream has to ask which it
     * was given.
     */
    const value = raw[state];
    const names = Array.isArray(value) ? value : [value];
    const kept = [];
    for (const candidate of names) {
      const name = clean(candidate);
      if (name && kept.indexOf(name) === -1) kept.push(name);
    }
    if (kept.length) out[state] = kept;
  }
  return out;
}

/**
 * A manifest's `defaults` block, cleaned: `{ [state]: ['<relative clip name>', ...] }`.
 *
 * Only state names the session machine can reach are kept, and only non-empty string clip names: an entry
 * that names a state the renderer refuses would otherwise sit in the panel as a tick nobody could explain.
 * The clip names are NOT checked against the files here — that is `core.motionMapWithDefaults`, which is the
 * one place that knows the catalog, and a default whose clip is missing degrades to "nothing mapped".
 */
/**
 * A manifest's `template` block, cleaned the way `defaults` is.
 *
 * `{ [state]: { '<clip name>': { loop?, expression?, mouth?, gaze? } } }` — the operator's own 状态与动作
 * configuration, shipped so a new user's pet plays his clips AND wears the faces he gave them. Validated here
 * rather than trusted because this file is hand-editable, and the FIELD-level rules live in one place:
 * `core.cleanMotionClipEntry` is what both this and the profile's own map are built from, so a template entry
 * cannot be accepted by one and refused by the other.
 *
 * A state the session machine cannot reach, a name that is not a plain string, or an entry that cleans to
 * nothing is DROPPED — an unknown clip is not an error (the pack may declare one this profile has not imported).
 */
export function readMotionTemplate(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const states = Array.isArray(core.MOTION_STATES) ? core.MOTION_STATES : [];
  const cleanEntry = typeof core.cleanMotionTemplateEntry === 'function' ? core.cleanMotionTemplateEntry : null;
  let mappedStates = 0;
  for (const state of Object.keys(raw)) {
    if (mappedStates >= MOTION_MANIFEST_LIMITS.maxStates) break;
    if (states.indexOf(state) === -1) continue;
    const entries = raw[state];
    if (!entries || typeof entries !== 'object') continue;
    const settings = {};
    let count = 0;
    for (const name of Object.keys(entries)) {
      if (count >= MOTION_MANIFEST_LIMITS.maxEntries) break;
      if (typeof name !== 'string' || !name || name.length > MOTION_MANIFEST_LIMITS.maxNameLength) continue;
      const entry = entries[name];
      if (!entry || typeof entry !== 'object') continue;
      const value = cleanEntry ? cleanEntry(entry) : null;
      if (!value) continue;
      settings[name.replace(/\\/g, '/')] = value;
      count += 1;
    }
    if (count) {
      out[state] = settings;
      mappedStates += 1;
    }
  }
  return out;
}

export function readMotionDefaults(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const states = Array.isArray(core.MOTION_STATES) ? core.MOTION_STATES : [];
  let mappedStates = 0;
  for (const state of Object.keys(raw)) {
    if (mappedStates >= MOTION_MANIFEST_LIMITS.maxStates) break;
    if (states.indexOf(state) === -1) continue;
    const value = raw[state];
    const names = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const chosen = [];
    for (const name of names) {
      if (typeof name !== 'string' || !name || name.length > MOTION_MANIFEST_LIMITS.maxNameLength) continue;
      const normalised = name.replace(/\\/g, '/');
      if (chosen.indexOf(normalised) === -1) chosen.push(normalised);
    }
    if (chosen.length) {
      out[state] = chosen;
      mappedStates += 1;
    }
  }
  return out;
}

/**
 * The bundled pack's manifest, read once, with the legacy name as the fallback.
 *
 * @returns {{clips: object, stateFolders: object, defaults: object, template: object}}
 */
function bundledMotionManifest() {
  const file = join(bundledMotionDir(), MOTION_MANIFEST_FILE);
  if (existsSync(file)) return readMotionManifest(file);
  const legacy = join(bundledMotionDir(), LEGACY_MOTION_MANIFEST_FILE);
  return existsSync(legacy) ? readMotionManifest(legacy) : { clips: {}, stateFolders: {}, defaults: {}, template: {} };
}

/**
 * The bundled pack's own `defaults`: what a user who has configured NOTHING should get.
 *
 * Read from `assets/motions/vrmpet3d-motions.json`, so the mapping is data rather than code — a clip name
 * is what travels with the pack, while an id is minted per profile. An empty block is the honest default
 * and the state this ships in until the operator says which clip belongs to which state; nothing plays
 * without a mapping.
 */
export function bundledMotionDefaults() {
  return bundledMotionManifest().defaults;
}

/**
 * The bundled pack's `template`: how each of those clips PLAYS, and what face it wears.
 *
 * The same idea as `defaults`, one layer deeper and for the same reason: `{ [state]: { '<clip name>': { loop?,
 * expression?, mouth?, gaze? } } }`, written by name, resolved against the live catalog by
 * `core.motionClipTemplate` and merged UNDER whatever the profile itself says (`core.motionClipFor`). It exists
 * because the operator configured his own 状态与动作 down to the per-clip 循环/表情/口型/凝视 and asked for that whole
 * configuration to be the shipped default (2026-10-14: 「现在的本机上的状态与动作里面的内容，包括每个动作的表情状态，全部作为
 * 默认模板上传」) — and a default that only names the CLIPS would still leave a new user's pet faceless.
 */
export function bundledMotionTemplate() {
  return bundledMotionManifest().template || {};
}

/**
 * The bundled pack's `stateFolders`: which folder in `assets/motions` belongs to which state.
 *
 * What it is FOR is the length of a picker: every state's box set is offered the clips inside its own folder,
 * so the operator's pack reads as six short lists (空闲 → `idle/`, 工作中 → `working/`, …) instead of one list
 * of every clip they have ever authored. A state the pack says nothing about keeps the old behaviour and is
 * offered everything, which is why an empty block is safe to ship.
 */
export function bundledMotionStateFolders() {
  return bundledMotionManifest().stateFolders;
}

/**
 * THE PACK'S SPRING VALUES, for a model that ships with the plugin.
 *
 * Operator, 2026-10-14: 「把当前 BlueFatFish 弹簧骨的参数作为默认参数推上去」. Same shape as the motion pack's `defaults`, and
 * for the same reason: a profile's own `springs` map is keyed by the machine's model ID (`m1`), which is positional and
 * therefore cannot travel. This block is keyed by the model's FILE NAME and the chain's own key —
 * `{ "BlueFatFish.vrm": { "DaiMao": { stiffness, dragForce, gravityPower } } }` — and it is merged UNDER the user's own
 * sliders by `Scene.applySprings`, so a fresh profile gets the tuned hair while any slider the user moves still wins.
 */
export const MODEL_MANIFEST_FILE = 'vrmpet3d-models.json';
const SPRING_FIELDS = ['stiffness', 'dragForce', 'gravityPower'];
const MODEL_MANIFEST_LIMITS = { maxModels: 64, maxChains: 256, maxKey: 96 };

/**
 * Read the models manifest, or an empty block.
 *
 * Every field is clamped with `core.SPRING_LIMITS`, the same limits the panel and the profile cleaner use: a manifest is
 * data, and data that disagrees with the sliders would be silently unusable.
 */
export function readModelManifest(file) {
  const empty = { springs: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const raw = parsed && typeof parsed.springs === 'object' && parsed.springs ? parsed.springs : {};
    const springs = {};
    let models = 0;
    for (const modelName of Object.keys(raw)) {
      if (models >= MODEL_MANIFEST_LIMITS.maxModels) break;
      if (typeof modelName !== 'string' || !modelName || modelName.length > MODEL_MANIFEST_LIMITS.maxKey) continue;
      const chains = raw[modelName];
      if (!chains || typeof chains !== 'object') continue;
      const clean = {};
      let count = 0;
      for (const key of Object.keys(chains)) {
        if (count >= MODEL_MANIFEST_LIMITS.maxChains) break;
        if (typeof key !== 'string' || !key || key.length > MODEL_MANIFEST_LIMITS.maxKey) continue;
        const entry = chains[key];
        if (!entry || typeof entry !== 'object') continue;
        const values = {};
        for (const field of SPRING_FIELDS) {
          const number = Number(entry[field]);
          if (!Number.isFinite(number)) continue;
          const limits = core.SPRING_LIMITS[field];
          const clamped = limits ? Math.min(limits.max, Math.max(limits.min, number)) : number;
          values[field] = clamped;
        }
        if (Object.keys(values).length) {
          clean[key] = values;
          count += 1;
        }
      }
      if (count) {
        springs[modelName] = clean;
        models += 1;
      }
    }
    return { springs };
  } catch (error) {
    return empty;
  }
}

/** The models manifest as shipped, read once. */
function bundledModelManifest() {
  const file = join(PLUGIN_ROOT, 'assets', 'models', MODEL_MANIFEST_FILE);
  return existsSync(file) ? readModelManifest(file) : { springs: {} };
}

/** Every model's shipped spring values, keyed by file name — what the client resolves against its own catalog. */
export function bundledSpringDefaults() {
  return bundledModelManifest().springs;
}

/** One model's shipped spring values, by file name — what the settings page shows. */
export function bundledSpringDefaultsFor(modelName) {
  if (typeof modelName !== 'string' || !modelName) return {};
  const all = bundledSpringDefaults();
  return all[modelName] || all[basename(modelName)] || {};
}

/**
 * Whether one catalogued clip is meant to loop.
 *
 * The default is `true`, and that default is the whole compatibility story: every clip that existed
 * before the manifest did was played with `setLoop(LoopRepeat, Infinity)`, so a directory without a
 * manifest keeps behaving exactly as it did.
 */
export function motionLoops(manifest, name) {
  const entry = manifest && typeof manifest === 'object' ? manifest[name] : null;
  return !(entry && entry.loop === false);
}

/**
 * True when the session runs as a child of another session (subagent).
 *
 * Compares by ID, never by object identity. `agents.list()` is a live registry
 * whose returned objects are not guaranteed to be the same references that
 * `agents.roots()` holds ?a copy, a proxy or a re-read all produce
 * `roots().includes(agent) === false` and would silently classify EVERY session
 * as a subagent, which turns the whole pet off. That failure is invisible: the
 * pet simply never reacts.
 */
export function runtimeIdentity(agents, sessionId) {
  try {
    if (typeof agents?.roots !== 'function') return {};
    if (typeof sessionId !== 'string' || !sessionId) return {};
    const roots = agents.roots();
    if (!Array.isArray(roots)) return {};
    let isRoot = false;
    for (const root of roots) {
      const id = typeof root === 'string' ? root : root?.id;
      if (id !== undefined && String(id) === sessionId) { isRoot = true; break; }
    }
    return { isSubagent: !isRoot };
  } catch {
    return {};
  }
}

// ===========================================================================
// Path safety
// ===========================================================================

/**
 * Decide whether `absolute` is inside `root`.
 *
 * Two details matter and are easy to get wrong:
 *   * a plain `startsWith` lets `/models-evil` pass as a child of `/models`;
 *   * on Windows, `normalize` gives backslashes, so a `/` separator literal
 *     would never match and the check would reject everything.
 * Both are handled by normalizing the separator and requiring either an exact
 * match or a separator boundary.
 */
export function isInside(root, absolute) {
  if (typeof root !== 'string' || typeof absolute !== 'string') return false;
  const normRoot = resolve(root);
  const normTarget = resolve(absolute);
  if (normRoot === normTarget) return true;
  const withSep = normRoot.endsWith(sep) ? normRoot : normRoot + sep;
  return normTarget.startsWith(withSep);
}

/**
 * Turn a browser-supplied relative path into a safe path under `root`.
 * Returns null for anything absolute, empty, or containing a traversing segment.
 *
 * Note what this does NOT do: it does not merely check that the resolved result
 * lands inside `root`. That weaker check has a real hole. A model's `root` is the
 * directory that holds it, but a legitimate request also addresses the model's own
 * file, so paths are interpreted relative to that directory. With `..` permitted,
 * a path can climb above the declared directory and still resolve to something
 * inside the root's parent ?a containment check against the wrong baseline serves
 * it quite happily. Rejecting `..` outright removes the class instead of arguing
 * about which baselines happen to be safe.
 */
export function resolveAssetPath(root, relative) {
  if (typeof root !== 'string' || typeof relative !== 'string') return null;
  if (relative.length === 0 || relative.length > 4096) return null;
  if (relative.includes('\0')) return null;
  // Reject absolute paths and URL-ish inputs before touching the filesystem.
  if (isAbsolute(relative) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relative)) return null;

  const normalised = relative.replace(/\\/g, '/');
  for (const segment of normalised.split('/')) {
    // '.' is harmless but pointless; '..' is a traversal attempt and is refused
    // even when it appears to cancel out, because "appears to cancel out" is
    // exactly the reasoning that produced the hole above.
    if (segment === '..' || segment === '.') return null;
  }

  const candidate = resolve(root, normalize(relative));
  return isInside(root, candidate) ? candidate : null;
}

// ===========================================================================
// Model catalog
// ===========================================================================

let modelIdCounter = 0;

/** Absolute path ?id, so a rescan hands the same file back the same id. */
const modelIdsByPath = new Map();

/**
 * Mint a short, opaque id for one model's absolute path, memoised per path.
 *
 * Memoised for the same measured reason as `mintMotionId`, and this one is not
 * theoretical: `/vrmpet3d/catalog` calls `rebuildModels()` on **every** request, so a
 * counter that advanced per scan handed the same file a new id each time. Observed
 * live in the running app: the import reply listed `HatsuneMikuNT.vrm` as `m1`, and
 * the very next catalog read listed the same file as `m3`.
 *
 * That breaks the page in a way that looks like a broken model rather than a broken
 * id: the client persists the selected `modelId`, reloads it on mount and after a
 * page refresh, and asks `/vrmpet3d/asset?m=<saved id>` ?which then 404s and drops the
 * pet back to the placeholder. The id is therefore a property of the path, not of the
 * scan.
 *
 *   * The id does not encode the path, because an id travels to the browser and the
 *     browser is not a trust boundary. The server keeps the mapping.
 *   * The `'m'` prefix gives models a namespace of their own: model and motion ids
 *     come from separate counters, and the two maps hold different files, so a page
 *     asking one route for the other's id must not be served a lookalike.
 */
function mintModelId(absolute) {
  const existing = modelIdsByPath.get(absolute);
  if (existing !== undefined) return existing;
  modelIdCounter += 1;
  const id = 'm' + modelIdCounter.toString(36);
  modelIdsByPath.set(absolute, id);
  return id;
}

/** True when a file name carries a model extension this plugin can load. */
function isModelFileName(fileName) {
  return MODEL_EXTENSIONS.has(extname(fileName).toLowerCase());
}

/**
 * Recursively collect files under one directory.
 *
 * Bounded on purpose: a user pointing the plugin at a huge tree should get a
 * useful error, not a frozen host. `maxEntries` caps directories visited.
 *
 * One walk serves both catalogs, and `options.accept` decides which file names
 * are collected. A second copy of this function is how the two catalogs would
 * drift apart on the bounds that are the only thing standing between a
 * user-supplied directory and a frozen host.
 *
 * Symlinks and junctions are never followed: `readdirSync` reports one as
 * neither a directory nor a file, so a link planted inside a configured root
 * cannot pull a file from outside it into a catalog.
 */
function scanDirectory(root, options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 4000;
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 8;
  const accept = typeof options.accept === 'function' ? options.accept : isModelFileName;
  const found = [];
  let visited = 0;

  const walk = (dir, relative, depth) => {
    if (depth > maxDepth || visited > maxEntries) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Deterministic order keeps the settings list stable between reloads.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (visited > maxEntries) return;
      if (entry.name.startsWith('.')) continue;
      const childRelative = relative ? relative + '/' + entry.name : entry.name;
      const childAbsolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        visited += 1;
        walk(childAbsolute, childRelative, depth + 1);
      } else if (entry.isFile()) {
        visited += 1;
        if (accept(entry.name)) {
          let bytes = 0;
          try {
            bytes = statSync(childAbsolute).size;
          } catch {
            bytes = 0;
          }
          found.push({ absolute: childAbsolute, relative: childRelative, bytes });
        }
      }
    }
  };

  walk(resolve(root), '', 0);
  return found;
}

/**
 * Build the catalog and the id ?file mapping in one pass.
 *
 * @param {object} config
 * @param {string[]} [config.modelDirs] extra directories supplied by the user
 * @param {object} [limits] override of the scan bounds; see `scanDirectory`
 * @returns {{models: object[], files: Map<string, {absolute:string, root:string}>}}
 */
export function buildCatalog(config = {}, limits = {}) {
  const roots = [];
  const bundled = join(PLUGIN_ROOT, 'assets', 'models');
  if (existsSync(bundled)) roots.push({ root: bundled, source: 'bundled' });
  for (const dir of Array.isArray(config.modelDirs) ? config.modelDirs : []) {
    if (typeof dir !== 'string' || !dir.trim()) continue;
    const absolute = resolve(dir.trim());
    if (!existsSync(absolute)) continue;
    // A user directory must not shadow the bundled one by accident.
    if (roots.some(entry => entry.root === absolute)) continue;
    roots.push({ root: absolute, source: 'user' });
  }

  const models = [];
  const files = new Map();
  const seenPaths = new Set();

  for (const { root, source } of roots) {
    for (const found of scanDirectory(root, limits)) {
      if (seenPaths.has(found.absolute)) continue;
      seenPaths.add(found.absolute);
      const id = mintModelId(found.absolute);
      const extension = extname(found.relative).toLowerCase();
      files.set(id, { absolute: found.absolute, root });
      models.push({
        id,
        name: found.relative,
        format: extension.slice(1),
        bytes: found.bytes,
        source,
        // Who made it, for the files this plugin ships; null for the user's own. Always present, so a page (and a
        // suite) reads one shape rather than asking whether the key exists.
        credit: source === 'bundled' ? bundledModelCredit(found.relative) : null,
      });
    }
  }

  return { models, files };
}

// ===========================================================================
// Motion catalog
// ===========================================================================

let motionIdCounter = 0;

/** Absolute path ?id, so a rescan hands the same file back the same id. */
const motionIdsByPath = new Map();

/**
 * Mint a short, opaque id for one motion's absolute path.
 *
 * Three properties are deliberate:
 *
 *   * The `'a'` prefix gives motions a namespace of their own. Model ids carry an
 *     `'m'` and come from a separate counter that also starts at 1, so without
 *     the prefix the first motion and the first model would both be `1` ?the two
 *     maps hold different files, and a page asking one route for the other's id
 *     would be served the wrong kind of file by a lookup that reported success.
 *   * The id does not encode the path, because an id travels to the browser and
 *     the browser is not a trust boundary. The server keeps the mapping.
 *   * The id is memoised per path, so the same file keeps the same id across
 *     rescans. Unlike the model catalog, this one is rebuilt whenever the
 *     settings panel asks for it, and the page persists a per-state motion map
 *     (`cleanMotions` in core.js) that has to survive that: an id that moved on
 *     every rebuild would point at a different clip, or at nothing.
 */
function mintMotionId(absolute) {
  const existing = motionIdsByPath.get(absolute);
  if (existing !== undefined) return existing;
  motionIdCounter += 1;
  const id = 'a' + motionIdCounter.toString(36);
  motionIdsByPath.set(absolute, id);
  return id;
}

/**
 * The bundled motion directory: the `.vrma` clips this plugin SHIPS, beside `assets/models`.
 *
 * Exported rather than spelled out in two places, because the catalogue reports it (`bundledDir`) and the
 * settings page labels the clips that come from it.
 */
export function bundledMotionDir() {
  return join(PLUGIN_ROOT, 'assets', 'motions');
}

/**
 * Build the motion catalog and the id ?file mapping in one pass.
 *
 * The plugin's own `assets/motions` is scanned FIRST (source `bundled`), exactly as `assets/models` is for
 * models, so the shipped pack is offered out of the box instead of waiting for a user to import a directory.
 * A directory the user imports afterwards may hold a clip with the same relative name as a bundled one; that
 * clip is still listed — a user file is never hidden — and it carries `source: 'user'`, so the two are told
 * apart by the same key the model catalog uses.
 *
 * Membership is decided by the extension, never by the bytes. That is the only
 * test that can keep this catalog disjoint from the model catalog ?a GLB that
 * happens to carry `VRMC_vrm_animation` is still a `.glb`, and it must not turn
 * up in both lists because the page fetches the two lists by different routes.
 * `core.detectMotionFormat` remains the client's check that a file it was handed
 * is really the format it claims.
 *
 * Each entry also carries `loop`, read from the directory's own `vrmpet3d-motions.json`
 * (see `MOTION_MANIFEST_FILE`). A directory without a manifest yields `loop: true`
 * for every clip, which is what every build before the manifest did.
 *
 * @param {object} config
 * @param {string[]} [config.motionDirs] directories supplied by the user
 * @param {object} [limits] override of the scan bounds; see `scanDirectory`
 * @returns {{motions: object[], files: Map<string, {absolute:string, root:string}>}}
 */
export function buildMotionCatalog(config = {}, limits = {}) {
  const roots = [];
  const bundled = bundledMotionDir();
  if (existsSync(bundled)) roots.push({ root: bundled, source: 'bundled' });
  for (const dir of Array.isArray(config.motionDirs) ? config.motionDirs : []) {
    if (typeof dir !== 'string' || !dir.trim()) continue;
    const absolute = resolve(dir.trim());
    if (!existsSync(absolute)) continue;
    // The same directory named twice must not list its files twice, and a user naming the bundled
    // directory must not list the shipped clips a second time under a second id.
    if (roots.some(entry => entry.root === absolute)) continue;
    roots.push({ root: absolute, source: 'user' });
  }

  const motions = [];
  const files = new Map();
  const seenPaths = new Set();

  for (const { root, source } of roots) {
    // One read per directory, not per file: the manifest is the directory's own declaration about the
    // clips inside it, and a directory without one simply declares nothing (see `motionLoops`). The
    // pre-rename name is read too, so a manifest written before 2026-10-12 keeps its `loop` flags.
    // The reader returns `{ clips, stateFolders, defaults }`; this loop only wants the clips, and the other
    // two blocks are read once for the whole pack by `bundledMotionStateFolders()` / `bundledMotionDefaults()`.
    const manifestFile = join(root, MOTION_MANIFEST_FILE);
    const manifest = existsSync(manifestFile)
      ? readMotionManifest(manifestFile)
      : readMotionManifest(join(root, LEGACY_MOTION_MANIFEST_FILE));
    const clips = manifest.clips;
    const found = scanDirectory(root, { ...limits, accept: core.isMotionFile });
    /**
     * A COMPRESSED clip REPLACES the uncompressed file beside it.
     *
     * `<name>.vrma.br` and `<name>.vrma` are the same animation, one packed (the operator's dance clips are
     * megabytes, so the packed one is what ships) and one not. Listing both would put one clip in the picker
     * twice under two names, and claiming eight megabytes of it, which is the noise the folders were reorganised
     * to remove. So a plain file whose `.br` twin is in the same directory is skipped — and only then, so
     * deleting the archive brings the uncompressed clip back with no other change.
     */
    const compressedNames = new Set(
      found.filter((entry) => isCompressedMotionName(entry.relative)).map((entry) => entry.relative),
    );
    for (const entry of found) {
      if (!isCompressedMotionName(entry.relative)
        && compressedNames.has(entry.relative + '.' + COMPRESSED_SUFFIX)) {
        continue;
      }
      if (seenPaths.has(entry.absolute)) continue;
      seenPaths.add(entry.absolute);
      const id = mintMotionId(entry.absolute);
      files.set(id, { absolute: entry.absolute, root });
      motions.push({
        id,
        name: entry.relative,
        /**
         * The FORMAT, not the extension. A compressed clip is `<name>.vrma.br`, and reporting `br` as the
         * format would tell every reader that this is a container this build does not play — the page filters
         * its pickers by format (`vrm` → `vrma`). `motionFormatOfName` looks through the compression suffix, so
         * a compressed clip is a `vrma` here and the renderer never learns it had to be unpacked.
         */
        format: core.motionFormatOfName(entry.relative),
        /**
         * And whether the file has to be unpacked before it is a clip.
         *
         * Carried so the UI can say so (「已压缩」) and so a reader can tell a `.vrma.br` from a plain `.vrma`
         * without re-deriving it from the name. The byte route unpacks; see `createMotionHandler`.
         */
        compressed: isCompressedMotionName(entry.relative),
        bytes: entry.bytes,
        source,
        /**
         * Whether the clip is meant to be played as a loop.
         *
         * Carried in the CATALOG rather than decided by the page, because it is a property of the clip
         * and not of the state it is mapped to: the same file is a one-shot wherever it is used. The page
         * passes it to the scene with the bytes (`scene.loadMotion`), which is what turns it into
         * `LoopRepeat, Infinity` or `LoopOnce`.
         */
        loop: motionLoops(clips, entry.relative),
      });
    }
  }

  return { motions, files };
}

// ===========================================================================
// Boundary hub
// ===========================================================================

export class VrmPet3DBoundaryHub {
  constructor({ agents, epoch = globalThis.crypto.randomUUID(), queueLimit = BRIDGE_QUEUE_LIMIT } = {}) {
    this.agents = agents;
    this.hostEpoch = epoch;
    this.streamSeq = 0;
    this.queueLimit = Math.max(2, Math.min(1024, queueLimit));
    this.clients = new Set();
    this.closed = false;
    this.seen = new Map();
  }

  baseline() {
    let identities = [];
    try {
      identities = [...this.agents.list()].slice(0, 4096).map(agent => ({
        sessionId: String(agent.id),
        ...runtimeIdentity(this.agents, agent.id),
      }));
    } catch {
      // Identity is optional; never invent an ownership classification.
    }
    return { type: 'baseline', hostEpoch: this.hostEpoch, streamSeq: this.streamSeq, identities };
  }

  accept(session, event) {
    if (this.closed || !event) return;
    if (event.type !== 'turn/start' && event.type !== 'turn/end') return;
    const sessionId = session?.id;
    if (typeof sessionId !== 'string' || !sessionId) return;
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) return;
    // Bound per-session replay memory; a lower seq than the watermark is stale.
    if (event.seq <= (this.seen.get(sessionId) ?? -1)) return;
    this.seen.delete(sessionId);
    this.seen.set(sessionId, event.seq);
    if (this.seen.size > 4096) this.seen.delete(this.seen.keys().next().value);

    const frame = {
      type: event.type,
      hostEpoch: this.hostEpoch,
      streamSeq: ++this.streamSeq,
      sessionId,
      seq: event.seq,
      time: typeof event.time === 'string'
        ? event.time.slice(0, 64)
        : Number.isFinite(event.time) ? event.time : Date.now(),
      ...runtimeIdentity(this.agents, sessionId),
    };
    if (event.type === 'turn/end') {
      const kind = event.data?.reason?.kind;
      frame.reason = typeof kind === 'string' ? kind.slice(0, 80) : 'unknown';
    }
    for (const client of this.clients) client.push(frame);
  }

  watch(signal) {
    const hub = this;
    const queue = [];
    let resolveNext;
    let ended = this.closed || signal?.aborted === true;

    const finish = () => {
      if (ended) return;
      ended = true;
      hub.clients.delete(client);
      signal?.removeEventListener('abort', finish);
      queue.length = 0;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = undefined;
        resolve({ done: true });
      }
    };

    const client = {
      push(frame) {
        if (ended) return;
        if (resolveNext) {
          const resolve = resolveNext;
          resolveNext = undefined;
          resolve({ done: false, value: frame });
        } else if (queue.length >= hub.queueLimit) {
          // Drop stale boundaries and re-send a watermark rather than replaying
          // a stale success that is no longer true.
          queue.length = 0;
          queue.push(hub.baseline());
        } else {
          queue.push(frame);
        }
      },
      next() {
        if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
        if (ended) return Promise.resolve({ done: true });
        if (resolveNext) return Promise.reject(new Error('Only one bridge iterator read may be pending'));
        return new Promise(resolve => { resolveNext = resolve; });
      },
      return() { finish(); return Promise.resolve({ done: true }); },
      [Symbol.asyncIterator]() { return this; },
      close: finish,
    };

    if (!ended) {
      this.clients.add(client);
      signal?.addEventListener('abort', finish, { once: true });
      client.push(this.baseline());
    }
    return client;
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const client of [...this.clients]) client.close();
    this.seen.clear();
  }
}

// ===========================================================================
// Asset route
// ===========================================================================

/** Write a small JSON/text response and end it. Never throws. */
function sendStatus(res, status, message) {
  try {
    const body = JSON.stringify({ error: message });
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    try { res.destroy(); } catch { /* already gone */ }
  }
}

/** Write a catalog payload and end it. */
function sendJson(req, res, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(body);
}

/**
 * Read a small JSON request body, or answer 413/400 and return without calling back.
 *
 * One policy for every POST route: a bounded body, an honest status for each refusal. Two
 * copies of this drifted before ?one capped at 64 KB and one not ?and the route without the
 * cap is the one that reads an arbitrary upload into memory.
 */
function readJsonBody(req, res, limit, onBody) {
  const chunks = [];
  let size = 0;
  let refused = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      refused = true;
      sendStatus(res, 413, 'request body too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (refused) return;
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      sendStatus(res, 400, 'invalid JSON body');
      return;
    }
    onBody(body);
  });
}

/**
 * The largest model a page may UPLOAD to `/vrmpet3d/models?file=<name>`.
 *
 * A path import copies whatever the file system holds, so its limit is the disk; an upload is read into the
 * host's heap first, which is why it is capped and why the cap is stated rather than discovered. 256 MB is
 * generous for a VRM avatar — the operator's largest measured model is 40 MB — and a body over it is refused
 * with 413 before a byte of it is kept.
 */
const MODEL_UPLOAD_LIMIT = 256 * 1024 * 1024;

/**
 * Read a BINARY request body, or answer 413 and return without calling back.
 *
 * The sibling of `readJsonBody`, with the same one policy: a bounded body, `req.destroy()` on the way over it,
 * and no callback at all once the response has been sent.
 */
function readRawBody(req, res, limit, onBody) {
  const chunks = [];
  let size = 0;
  let refused = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > limit) {
      refused = true;
      sendStatus(res, 413, 'request body too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (refused) return;
    onBody(Buffer.concat(chunks));
  });
}

/** Parse the request URL, or answer 400 and return null. */
function requestUrl(req, res) {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    sendStatus(res, 400, 'malformed url');
    return null;
  }
}

/** True when the request method may be served at all; answers 405 and returns false. */
function methodAllowed(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  sendStatus(res, 405, 'method not allowed');
  return false;
}

/**
 * Stream one allowlisted file. Shared by the asset route and the motion route.
 *
 * Shared rather than copied: the size cap, the MIME table and the read-error
 * handling are the parts a second implementation would get subtly wrong, and a
 * motion has to be served exactly like a model.
 *
 * `root` is the directory the entry was scanned from. The id map is the
 * allowlist, but containment is re-checked here, so an entry that was somehow
 * built with a path outside its own root is refused rather than streamed.
 */
function sendFile(req, res, target, root) {
  if (!isInside(root, target)) {
    sendStatus(res, 404, 'file not found');
    return;
  }

  let stats;
  try {
    stats = statSync(target);
  } catch {
    sendStatus(res, 404, 'file not found');
    return;
  }
  if (!stats.isFile()) {
    sendStatus(res, 404, 'not a file');
    return;
  }
  if (stats.size > MAX_ASSET_BYTES) {
    sendStatus(res, 413, 'file exceeds the ' + MAX_ASSET_BYTES + ' byte limit');
    return;
  }

  const extension = extname(target).toLowerCase();
  const headers = {
    'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'content-length': stats.size,
    // The page is a different origin from this route in some shells, and the
    // bytes are the user's own local files, so a permissive read is correct.
    'access-control-allow-origin': '*',
    // `no-store`: a user replacing a model file on disk must see the new one on
    // reload, and these bytes are cheap to re-read locally.
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };

  try {
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(target);
    // A read error after the headers are sent can only close the socket; the
    // browser then surfaces a network error rather than silently truncated bytes.
    stream.on('error', () => { try { res.destroy(); } catch { /* already gone */ } });
    res.on('close', () => { try { stream.destroy(); } catch { /* already gone */ } });
    stream.pipe(res);
  } catch {
    sendStatus(res, 500, 'read failed');
  }
}

/**
 * `/vrmpet3d/model-info?m=<id>` - what is inside one model file.
 *
 * Resolved through the same server-held id map as the asset route, so a crafted id cannot name a
 * file outside the allowlisted roots. The answer is the COMPACT projection: expressions, spring
 * groups with their authored physics, materials, images and licence - what the settings window
 * lists, and nothing that is only interesting in a full report.
 *
 * What is DESCRIBED lives in memory, process-wide, in `lib/vrm-info.js`: the settings window asks for the
 * same model on every open and on every edit, and re-reading plus re-parsing a 10-100 MB file each time is
 * what made 模型参数 slow to open (operator, 2026-10-11). There is deliberately no second cache here: the
 * parsed report is the expensive thing, the compact projection below is derived from it in milliseconds,
 * and a second map keyed by the same size+mtime pair only added a layer that `forgetModelInfo` and
 * `clearModelInfoCache` could NOT reach — which is how a cache stops being invalidatable.
 *
 * A model this build cannot describe is an ANSWER, not an error: a PMX/PMD is not a model it offers at all
 * (VRM only since 2026-10-12), and saying so is what lets the UI explain itself instead of showing an empty list.
 */
export function createModelInfoHandler(store) {
  return function handleModelInfoRequest(req, res) {
    if (!methodAllowed(req, res)) return;
    const url = requestUrl(req, res);
    if (url === null) return;

    const id = url.searchParams.get('m');
    const entry = typeof id === 'string' ? store.files.get(id) : undefined;
    if (!entry) {
      sendStatus(res, 404, 'unknown model id');
      return;
    }
    let stats;
    try {
      stats = statSync(entry.absolute);
    } catch (error) {
      sendStatus(res, 404, 'model file is unreadable');
      return;
    }
    let info;
    try {
      // The size+mtime pair `stats` already carries is the freshness check: an edited file is re-parsed,
      // an unchanged one is answered from the report that is already in memory.
      info = compactModelInfo(describeModelCached(entry.absolute, stats));
    } catch (error) {
      info = {
        supported: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    sendJson(req, res, {
      id,
      name: entry.name || null,
      relative: entry.relative || null,
      /**
       * The PACK's spring values for this model, by chain key — what 模型参数 → 弹簧骨 shows when the user has not
       * overridden a chain (operator, 2026-10-14: 「把当前 BlueFatFish 弹簧骨的参数作为默认参数推上去」). Keyed by file
       * name in `assets/models/vrmpet3d-models.json`, because the model id in this payload is positional.
       */
      springDefaults: bundledSpringDefaultsFor(entry.relative || entry.name),
      ...info,
    });
  };
}

/**
 * `/vrmpet3d/asset?m=<id>&p=<relative>` ?stream one model or texture file.
 *
 * Streamed rather than buffered: VRM files are routinely tens of MB and
 * a read-into-memory route would spike the host's heap on every reload. Only
 * files reachable from an allowlisted model root are served, and the lookup goes
 * through the server-held id map, so a crafted id cannot name a file outside it.
 */
export function createAssetHandler(store) {
  return function handleAssetRequest(req, res) {
    if (!methodAllowed(req, res)) return;
    const url = requestUrl(req, res);
    if (url === null) return;

    const id = url.searchParams.get('m');
    const relative = url.searchParams.get('p');
    const entry = typeof id === 'string' ? store.files.get(id) : undefined;
    if (!entry) {
      sendStatus(res, 404, 'unknown model id');
      return;
    }
    // The model's own path is the default; a relative path addresses a texture
    // beside it.
    let target;
    if (relative === null || relative === '') {
      target = entry.absolute;
    } else {
      target = resolveAssetPath(entry.root, relative);
      if (target === null) {
        sendStatus(res, 400, 'unsafe asset path');
        return;
      }
    }
    sendFile(req, res, target, entry.root);
  };
}

/**
 * `/vrmpet3d/model-thumbnail?m=<id>` — the picture a model carries of itself.
 *
 * Read out of the FILE, like `/vrmpet3d/model-info`, so the picker works with no renderer running. The bytes
 * are cached in memory against the file's size and mtime, because the caller is a GRID: opening the picker
 * asks for one image per model, and re-parsing a 14 MB avatar for each tile on every open is the kind of cost
 * that shows up as a slow window rather than as a bug. The cache is bounded and keyed by the file's identity,
 * so an import that replaces a model's contents is a new entry rather than a stale image.
 *
 * A model with no embeddable thumbnail answers 404 with the reason: a plain `.glb`, a `.gltf` whose image sits
 * beside it, and a VRM whose meta names no image are all normal, and the page draws a placeholder for them.
 */
export function createModelThumbnailHandler(store) {
  /** How many extracted thumbnails stay in memory. A handful of tiles fits; a whole library does not. */
  const CACHE_LIMIT = 12;
  const cache = new Map();

  return function handleModelThumbnail(req, res) {
    if (!methodAllowed(req, res)) return;
    const url = requestUrl(req, res);
    if (url === null) return;

    const id = url.searchParams.get('m');
    const entry = typeof id === 'string' ? store.files.get(id) : undefined;
    if (!entry) {
      sendStatus(res, 404, 'unknown model id');
      return;
    }
    let stats;
    try {
      stats = statSync(entry.absolute);
    } catch (error) {
      sendStatus(res, 404, `cannot read the model: ${error.message}`);
      return;
    }

    const key = `${entry.absolute}|${stats.size}|${stats.mtimeMs}`;
    let hit = cache.get(key);
    if (!hit) {
      let found = null;
      try {
        found = thumbnailImage(readGlb(entry.absolute));
      } catch {
        // Not a GLB at all, or a truncated one: "no thumbnail" is the honest answer, not a 500.
        found = null;
      }
      if (!found) {
        sendStatus(res, 404, 'this model carries no thumbnail');
        return;
      }
      hit = {
        mimeType: imageMimeType(found.bytes) || found.mimeType,
        bytes: Buffer.from(found.bytes),
      };
      cache.set(key, hit);
      while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }

    res.writeHead(200, {
      'content-type': hit.mimeType,
      'content-length': hit.bytes.length,
      // `no-store` like every other route here, so a re-imported model cannot be answered from a stale tile.
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(hit.bytes);
  };
}

/**
 * `/vrmpet3d/motion?m=<id>` ?stream one authored-motion file.
 *
 * Deliberately has no `p` parameter. A model needs one because its textures sit
 * in the same directory; a `.vrma` is self-contained, so the only file
 * this route can ever name is the exact one an id was scanned from ?nothing
 * beside it becomes reachable, and there is no relative path to get wrong.
 *
 * A COMPRESSED clip (`<name>.vrma.br`, the dance pack) is unpacked HERE, so the bytes that reach the renderer
 * are always a plain VRMA and the browser half never learns that a clip arrived compressed. That is the point
 * of doing it on this side: `scene.loadMotion` is handed one format either way, and there is one code path to
 * test. The cost is that a compressed clip is read into the host's heap — see `MOTION_UNPACK_CACHE_LIMIT` for
 * what bounds it.
 */
export function createMotionHandler(store) {
  /**
   * One unpacked clip, kept so a repeat request does not pay the decompression twice.
   *
   * A dance clip is megabytes (the operator's first one is 8.0 MB from 2.8 MB compressed, and brotli takes
   * seconds on it), and the two halves of the pet ask for the same id when the model is reloaded or the
   * settings window previews it. Exactly ONE clip is kept, and only if it fits the limit: the alternative is
   * a cache that grows with the pack and holds every dance the user owns in memory for the session.
   */
  const MOTION_UNPACK_CACHE_LIMIT = 32 * 1024 * 1024;
  let cachedPath = null;
  let cachedBytes = null;

  return function handleMotionRequest(req, res) {
    if (!methodAllowed(req, res)) return;
    const url = requestUrl(req, res);
    if (url === null) return;

    const id = url.searchParams.get('m');
    const entry = typeof id === 'string' ? store.files.get(id) : undefined;
    if (!entry) {
      sendStatus(res, 404, 'unknown motion id');
      return;
    }
    // No `p`: see above. The id is the whole request.
    if (!isCompressedMotionName(entry.absolute)) {
      sendFile(req, res, entry.absolute, entry.root);
      return;
    }
    if (cachedPath === entry.absolute && cachedBytes) {
      sendBuffer(req, res, cachedBytes, entry.absolute);
      return;
    }
    let plain;
    try {
      const compressed = readFileSync(entry.absolute);
      plain = decompressBrotli(compressed);
    } catch (error) {
      /**
       * A clip that cannot be unpacked is a 500 with the REASON, never a truncated 200.
       *
       * A half-written body would be handed to `scene.loadMotion`, which would report it as a malformed VRMA —
       * pointing at the clip's contents instead of at the archive or the tool that made it.
       */
      sendStatus(res, 500, `motion "${id}" could not be unpacked: ${(error && error.message) || error}`);
      return;
    }
    if (plain.length <= MOTION_UNPACK_CACHE_LIMIT) {
      cachedPath = entry.absolute;
      cachedBytes = plain;
    } else {
      cachedPath = null;
      cachedBytes = null;
    }
    sendBuffer(req, res, plain, entry.absolute);
  };
}

/**
 * Answer with a buffer this process owns, so the caller must not mutate it.
 *
 * The headers mirror `sendFile`'s deliberately — same MIME lookup (after the compression suffix, so an unpacked
 * clip is `model/gltf-binary` and not `application/octet-stream`), same permissive read, same `no-store`, same
 * `nosniff`. Two routes serving the same clip with different content types is how a browser ends up refusing
 * one of them, and the extension is what the MIME table is keyed on.
 */
function sendBuffer(req, res, bytes, name) {
  // A caller may pass the file's own name, compression suffix and all; the MIME table is keyed on the FORMAT's
  // extension, so the suffix is stripped here and both routes follow one rule.
  let target = String(name);
  if (isCompressedMotionName(target)) target = target.slice(0, -(COMPRESSED_SUFFIX.length + 1));
  const extension = extname(target).toLowerCase();
  const headers = {
    'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'content-length': bytes.length,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  try {
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(bytes);
  } catch {
    sendStatus(res, 500, 'read failed');
  }
}

// ===========================================================================
// Plugin
// ===========================================================================

/**
 * `apply` is called by the Loader with the plugin's Cordis context.
 *
 * Everything here is registered through `ctx.effect` so an unload removes the
 * routes, the service and the stream listeners in one step.
 */
export function apply(ctx, config = {}) {
  const agents = ctx.get('agents');
  const hub = new VrmPet3DBoundaryHub({ agents });

  // ---- 1. the pet's status stream ----------------------------------------
  const service = {
    watch(signal) { return hub.watch(signal); },
  };
  service.typertRemote = Object.freeze({ service, serviceKey: name, namespace: name });
  ctx.provide(name, service);
  ctx.on('session/event', (session, event) => hub.accept(session, event), { global: true });
  ctx.effect(() => () => hub.dispose(), 'vrmpet3d.boundary-hub');

  // ---- 2. model and motion bytes for the page ----------------------------
  // Scan once at activation, then rescan when the client asks for a catalog.
  // The catalogs live here rather than in the page because only the host may
  // touch the filesystem.
  const store = buildCatalog(config);
  const assetHandler = createAssetHandler(store);
  const modelThumbnailHandler = createModelThumbnailHandler(store);
  const modelInfoHandler = createModelInfoHandler(store);
  const motionStore = buildMotionCatalog(config);
  const motionHandler = createMotionHandler(motionStore);

  /**
   * Directories the user imported from the settings panel, newest last.
   *
   * Kept as its own list rather than merged into `config.modelDirs`: the config is
   * the operator's declaration (a profile patch or a bundle default) and this is the
   * user's, so they must be readable, removable and persisted independently.
   */
  const importedDirs = readImportedModelDirs();

  /**
   * What the user imported by FILE, and what the plugin COPIED for them.
   *
   * Two lists, deliberately: `importedDirs` above is the pre-2026-10-12 way (a directory the user pointed at, and
   * a live dependency on somebody else's folder — the bug the operator reported), and this one is the provenance
   * of the copies in `importedModelsDir()`, which the catalogue scans from the plugin's own storage.
   */
  let importedModelFiles = readImportedModelFiles();

  /**
   * The motion directories the user imported, in the same shape and for the same reason as the model ones.
   *
   * Held in memory and re-read from the plugin's file on every request, so an import lands immediately
   * (the motion catalog is rebuilt per request). Before this existed a `.vrma` could only be put to use by
   * editing the profile config and restarting DSH, which is indistinguishable from the feature not working.
   */
  const importedMotionDirs = readImportedMotionDirs();

  /** What the user imported by FOLDER, and what the plugin copied out of it. Same pair as the model one. */
  let importedMotionImports = readImportedMotionImports();

  /**
   * Config for a scan: the declared directories, the user's imported directories, and the plugin's own copies.
   *
   * The last entry is what makes an IMPORT self-contained: a model the user brought in lives in
   * `importedModelsDir()` and is scanned from there, so the folder they picked it out of can move, be renamed or
   * disappear without the pet losing its model.
   */
  const modelScanConfig = () => ({
    ...config,
    modelDirs: [
      ...(Array.isArray(config.modelDirs) ? config.modelDirs : []),
      ...importedDirs,
      // Only once the plugin's own copy folder exists: a path that is not there is not a directory this run
      // scanned, and reporting one would read as "the user imported something" in a page that lists them.
      ...(existsSync(importedModelsDir()) ? [importedModelsDir()] : []),
    ],
  });

  /** Rebuild both stores from the merged view, so every reader sees the same list. */
  const rebuildModels = () => {
    const rebuilt = buildCatalog(modelScanConfig());
    store.models = rebuilt.models;
    store.files = rebuilt.files;
    return rebuilt;
  };
  rebuildModels();

  /**
   * `{ [model id]: { [chain key]: { stiffness?, dragForce?, gravityPower? } } }` — the pack's spring values, resolved
   * against the models the live catalog actually has.
   *
   * The manifest is keyed by file name; this is the same data keyed the way a running client can use it (see the note
   * where it is sent). A model whose file name the manifest does not mention simply has no entry, which is the whole
   * fallback story: the scene then uses the model file's own authored values, exactly as before.
   */
  const springDefaultsById = () => {
    const all = bundledSpringDefaults();
    if (!Object.keys(all).length) return {};
    const byId = {};
    // The id is the Map's KEY, not a field on the value: `buildCatalog` stores `{ absolute, root }` (measured the hard
    // way — a guard on `entry.id` skipped every model and shipped an empty block).
    for (const [id, entry] of store.files) {
      if (typeof id !== 'string' || !id) continue;
      const name = entry && entry.name ? entry.name : (entry && entry.absolute ? basename(entry.absolute) : '');
      const chains = name ? all[name] : null;
      if (chains) byId[id] = chains;
    }
    return byId;
  };

  const catalogHandler = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    rebuildModels();
    sendJson(req, res, {
      models: store.models,
      modelDirs: (Array.isArray(config.modelDirs) ? config.modelDirs : []).map(dir => resolve(dir)),
      importedDirs: importedDirs.slice(),
      bundledDir: join(PLUGIN_ROOT, 'assets', 'models'),
    });
  };

  /**
   * `/vrmpet3d/motions` ?the motion catalog, shaped like `/vrmpet3d/catalog`.
   *
   * Its own route rather than a field of the model catalog: the two are rebuilt
   * from separate directories, and the settings panel opens one picker at a time.
   * `motions` and `motionDirs` are the parallel of `models` and `modelDirs`, and
   * `bundledDir` is the parallel of the model catalogue's own: the plugin ships a
   * motion pack in `assets/motions`, so its clips are listed from the first scan
   * with `source: 'bundled'`, the way `SampleModel.vrm` already is.
   *
   * `motionDefaults` is the pack's own suggestion for a user who has configured
   * nothing: `{ state: [id, ...] }`, resolved from the clip NAMES its manifest
   * declares against the catalogue just built. Sent as its own key rather than
   * folded into the preferences, because it must stay a fallback — see
   * `core.motionMapWithDefaults` for why writing it into the store would make it
   * impossible to turn off.
   *
   * `stateFolders` is `{ state: '<folder name>' }`, straight from the pack's manifest. The page uses it to offer
   * each state only ITS folder's clips — the operator's own request, because one picker listing every clip they
   * have ever authored is unusable. Read by the host and sent rather than derived by the page from the clip
   * NAMES, so there is one answer to "which folder is this clip in" and it is the same relative name the
   * catalogue reports. A state the pack does not name is offered everything, which is what every build before
   * this block did.
   *
   * GET is the whole story for reading, and a POST mirrors `/vrmpet3d/models` with two ways in:
   *
   *   * `importDir` / `unimportDir` — the CURRENT way. The folder the user picked is COPIED into
   *     `importedMotionsDir()` (clips and the folder's own manifest, tree preserved) and remembered in
   *     `importedMotionImports`; the catalogue scans the copy. Nothing about the folder they picked it from is
   *     recorded, which is the point: it may move, be renamed or vanish.
   *   * `add` / `remove` — a DIRECTORY, the pre-2026-10-12 way. Still accepted so a profile (or a client) older
   *     than this route keeps working, still listed as `importedDirs`, and no longer what the panels offer.
   *
   * The catalog is rebuilt on every request, so an import is live on the next fetch rather than on the next DSH
   * start.
   */
  const motionCatalogHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const motions = rebuildMotionCatalog();
      sendJson(req, res, {
        motions,
        motionDirs: motionDirsInForce(),
        importedDirs: importedMotionDirs.slice(),
        importedMotions: importedMotionImports.slice(),
        motionsDir: importedMotionsDir(),
        bundledDir: bundledMotionDir(),
        motionDefaults: core.motionMapWithDefaults({}, bundledMotionDefaults(), motions),
        motionClipDefaults: core.motionClipTemplate(bundledMotionTemplate(), motions),
        /**
         * The pack's spring values for the model on screen, keyed by the LIVE model id.
         *
         * The manifest is written by FILE NAME (a model id is positional, `m1` today and something else tomorrow), and
         * the catalog that turns one into the other lives here — so the resolution happens here too and the client only
         * has to index by the id it already knows. Served from THIS payload because it is the one a running pet polls:
         * no fourth request at boot, and a model switch is picked up with the same poll that fetches its clips.
         */
        springDefaults: springDefaultsById(),
        stateFolders: bundledMotionStateFolders(),
        catalogFile: motionDirsFilePath(),
        motionsFile: motionImportsFilePath(),
      });
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 64 * 1024, (body) => {
      const add = typeof body?.add === 'string' ? body.add.trim() : '';
      const remove = typeof body?.remove === 'string' ? body.remove.trim() : '';
      const importDir = typeof body?.importDir === 'string' ? body.importDir.trim() : '';
      const unimportDir = typeof body?.unimportDir === 'string' ? body.unimportDir.trim() : '';
      // Whether the IMPORT store was touched, so a legacy `{add: <directory>}` request writes nothing (see the
      // same guard in `modelsHandler`: it is what keeps a suite that only names the directory lists from creating
      // the import stores in the operator's real profile).
      let importChanged = false;
      if (importDir) {
        const imported = importMotionFolder(importDir, importedMotionImports);
        if (imported.error) {
          sendStatus(res, 400, imported.error);
          return;
        }
        if (!imported.existed) {
          importedMotionImports = [...importedMotionImports, imported.entry];
          importChanged = true;
        }
      } else if (unimportDir) {
        const at = importedMotionImports.findIndex((entry) => entry.dir === resolve(unimportDir));
        if (at !== -1) {
          removeImportedMotionFolder(importedMotionImports[at].dir);
          importedMotionImports = importedMotionImports.filter((_entry, index) => index !== at);
          importChanged = true;
        }
      } else if (add) {
        const absolute = resolve(add);
        if (!existsSync(absolute)) {
          sendStatus(res, 400, `no such directory: ${absolute}`);
          return;
        }
        if (!statSync(absolute).isDirectory()) {
          sendStatus(res, 400, `not a directory: ${absolute}`);
          return;
        }
        if (importedMotionDirs.indexOf(absolute) === -1) importedMotionDirs.push(absolute);
      } else if (remove) {
        const absolute = resolve(remove);
        const at = importedMotionDirs.indexOf(absolute);
        if (at !== -1) importedMotionDirs.splice(at, 1);
      } else {
        sendStatus(res, 400, 'expected {importDir}, {unimportDir}, {add} or {remove}');
        return;
      }
      const writeError = writeImportedMotionDirs(importedMotionDirs);
      const importError = importChanged ? writeImportedMotionImports(importedMotionImports) : null;
      const motions = rebuildMotionCatalog();
      sendJson(req, res, {
        motions,
        motionDirs: motionDirsInForce(),
        importedDirs: importedMotionDirs.slice(),
        importedMotions: importedMotionImports.slice(),
        motionsDir: importedMotionsDir(),
        bundledDir: bundledMotionDir(),
        motionDefaults: core.motionMapWithDefaults({}, bundledMotionDefaults(), motions),
        motionClipDefaults: core.motionClipTemplate(bundledMotionTemplate(), motions),
        springDefaults: springDefaultsById(),
        stateFolders: bundledMotionStateFolders(),
        persisted: writeError === null && importError === null,
        persistError: writeError || importError,
      });
    });
  };

  /** Every directory the motion catalog is built from: the configured ones, the imported ones, and the copies. */
  function motionDirsInForce() {
    const configured = (Array.isArray(config.motionDirs) ? config.motionDirs : [])
      .filter((dir) => typeof dir === 'string' && dir.trim())
      .map((dir) => resolve(dir.trim()));
    const all = configured.slice();
    /**
     * Each IMPORT is scanned as its OWN root, and that is not a detail.
     *
     * `buildMotionCatalog` reads ONE manifest per root (`<root>/vrmpet3d-motions.json`), and the manifest is where
     * a clip's 循环/单次 lives — so scanning the imports folder as a single root would silently ignore the manifest
     * every import brought with it, and a declared one-shot would play as a loop. The copy's own folder IS its root,
     * which also keeps the clip names the user recognises.
     *
     * Absent paths are skipped for the same reason as the models half: a path that is not there is not a directory
     * this run scanned.
     */
    for (const dir of [...importedMotionDirs, ...importedMotionImports.map((entry) => entry.dir)]) {
      if (existsSync(dir) && all.indexOf(dir) === -1) all.push(dir);
    }
    return all;
  }

  /** Rebuild the motion catalog from the directories in force. @returns {object[]} the motions */
  function rebuildMotionCatalog() {
    const rebuilt = buildMotionCatalog({ ...config, motionDirs: motionDirsInForce() });
    motionStore.motions = rebuilt.motions;
    motionStore.files = rebuilt.files;
    return motionStore.motions;
  }

  /**
   * `/vrmpet3d/models` — the imported-model lists, readable and mutable.
   *
   * TWO lists, because there are two ways in and only one of them is still offered:
   *
   *   * `addFile` / `removeFile` — the CURRENT way. The file the user picked is COPIED into
   *     `importedModelsDir()` and remembered in `importedModelFiles`; the catalogue scans the copy. Nothing about
   *     the folder they picked it from is recorded, which is the point: it may move, be renamed or vanish.
   *   * `add` / `remove` — a DIRECTORY, the pre-2026-10-12 way. Still accepted so a profile (or a client) older
   *     than this route keeps working, still listed as `importedDirs`, and no longer what the panels offer.
   *
   * A POST parses its own JSON body instead of taking a query parameter: a Windows path is full of characters that
   * a query string would mangle, and the client is the only caller.
   *
   * An import is idempotent, and every response carries the refreshed catalog, so the panel updates from the reply
   * rather than from a second round trip that could race the rebuild.
   */
  const modelsHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      /**
       * The read side answers with the CATALOG too, not only the imported lists.
       *
       * The picker draws its grid from ONE request — the built-in model included, since 「现有模型」 means the ones a
       * user can switch to, not only the ones they imported — and it reads the same reply the POST side hands back
       * after an import. Leaving `models` out of the GET is how the grid came up EMPTY on a fresh profile while
       * `/vrmpet3d/catalog` listed the built-in model all along (operator, 2026-10-13: 「现有模型没有显示自带的内置
       * 模型」): the component asked this route for the list and this route did not carry it. The two halves of one
       * route must answer the same shape, which is also what the suite now pins.
       *
       * `rebuildModels()` first, exactly as `/vrmpet3d/catalog` does: a catalogue reply that describes a stale
       * directory is the same defect in a quieter form.
       */
      rebuildModels();
      sendJson(req, res, {
        models: store.models,
        importedDirs: importedDirs.slice(),
        importedModels: importedModelFiles.slice(),
        modelsDir: importedModelsDir(),
        modelCount: store.models.length,
        catalogFile: modelDirsFilePath(),
        modelsFile: modelFilesFilePath(),
      });
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }

    /**
     * Write both stores, drop the described-model cache when it moved, and answer with the rebuilt catalog.
     *
     * Factored out because the route now has TWO ways in — a path from the launcher's dialog and an upload from
     * a dropped file — and an answer that differed between them would be the kind of drift a page notices as
     * "the grid did not refresh after a drop".
     */
    const answer = (changed, fileChanged) => {
      const writeError = writeImportedModelDirs(importedDirs);
      const fileError = fileChanged ? writeImportedModelFiles(importedModelFiles) : null;
      // An import (or a REMOVAL of a directory) is the moment this process knows a model file appeared or
      // went away, so the described-model cache is dropped outright rather than left to the size/mtime
      // check: a re-import can hand the same path back with the same size and a different model inside,
      // and a stale answer must never outlive it. Only on a request that actually changed the list, so
      // an idempotent add does not cost every cached model its parse.
      if (changed) clearModelInfoCache();
      rebuildModels();
      sendJson(req, res, {
        importedDirs: importedDirs.slice(),
        importedModels: importedModelFiles.slice(),
        modelsDir: importedModelsDir(),
        modelCount: store.models.length,
        // A failure to persist is reported, not hidden: the import is live for this
        // session either way, and the user should know it will not survive a restart.
        persisted: writeError === null && fileError === null,
        persistError: writeError || fileError,
        models: store.models,
      });
    };

    /**
     * A DROPPED model — or one picked through a plain `<input type="file">` in a browser tab, where the
     * launcher and its native dialog do not exist — arrives as BYTES rather than as a path.
     *
     * `?file=<name>` marks the upload, and the name is the only thing the page can tell us about it: the
     * bytes are written into the plugin's own storage exactly as a path import is, so the two ways in end at
     * the same place and the host stays the only writer of the list.
     *
     * The body limit is the one thing that differs from the JSON path, by three orders of magnitude: a JSON
     * body carries a path (64 KB is already generous), while this one carries an avatar.
     */
    const url = requestUrl(req, res);
    if (url === null) return;
    const uploadName = url.searchParams.get('file');
    const contentType = String(req.headers['content-type'] || '');
    if (uploadName !== null && !/^application\/json\b/i.test(contentType)) {
      readRawBody(req, res, MODEL_UPLOAD_LIMIT, (body) => {
        const imported = importModelBytes(uploadName, body, importedModelFiles);
        if (imported.error) {
          sendStatus(res, 400, imported.error);
          return;
        }
        // The list first, then the answer: the reply IS the rebuilt catalog, and it has to carry the new copy.
        if (!imported.existed) importedModelFiles = [...importedModelFiles, imported.entry];
        answer(!imported.existed, !imported.existed);
      });
      return;
    }

    // The only JSON body this route accepts is one path. Anything larger is a client bug or an
    // abuse, and reading it would be the bug.
    readJsonBody(req, res, 64 * 1024, (body) => {
      const add = typeof body?.add === 'string' ? body.add.trim() : '';
      const remove = typeof body?.remove === 'string' ? body.remove.trim() : '';
      const addFile = typeof body?.addFile === 'string' ? body.addFile.trim() : '';
      const removeFile = typeof body?.removeFile === 'string' ? body.removeFile.trim() : '';
      // Whether this request changed any list at all; an idempotent add did not.
      let changed = false;
      /**
       * And whether it touched the IMPORT store specifically.
       *
       * A legacy `{add: <directory>}` request must not write the file store at all: it changes nothing in it, and
       * a write for no reason is how a suite that only sets `VRMPET3D_MODEL_DIRS_FILE` came to create
       * `vrmpet3d-model-files.json` in the operator's real profile — measured on 2026-10-12, and the reason the
       * suites now name every store they do not own.
       */
      let fileChanged = false;
      if (addFile) {
        const imported = importModelFile(addFile, importedModelFiles);
        if (imported.error) {
          sendStatus(res, 400, imported.error);
          return;
        }
        if (!imported.existed) {
          importedModelFiles = [...importedModelFiles, imported.entry];
          changed = true;
          fileChanged = true;
        }
      } else if (removeFile) {
        const at = importedModelFiles.findIndex((entry) => entry.file === resolve(removeFile));
        if (at !== -1) {
          removeImportedModelFile(importedModelFiles[at].file);
          importedModelFiles = importedModelFiles.filter((_entry, index) => index !== at);
          changed = true;
          fileChanged = true;
        }
      } else if (add) {
        const absolute = resolve(add);
        if (!existsSync(absolute)) {
          sendStatus(res, 400, `no such directory: ${absolute}`);
          return;
        }
        if (!statSync(absolute).isDirectory()) {
          sendStatus(res, 400, `not a directory: ${absolute}`);
          return;
        }
        if (importedDirs.indexOf(absolute) === -1) {
          importedDirs.push(absolute);
          changed = true;
        }
      } else if (remove) {
        const absolute = resolve(remove);
        const at = importedDirs.indexOf(absolute);
        if (at !== -1) {
          importedDirs.splice(at, 1);
          changed = true;
        }
      } else {
        sendStatus(res, 400, 'expected {addFile}, {removeFile}, {add} or {remove}');
        return;
      }

      answer(changed, fileChanged);
    });
  };

  /**
   * The first-run wizard's state, and the ONE write that ends it.
   *
   * `completed` lives in its own file so the HOST can answer "should the wizard open?" at activation, before any
   * page exists to read a preference, and so the answer survives a restart. `prompted` does NOT live there: it is
   * "this activation has already offered the wizard", which must reset when the process does — that reset IS the
   * operator's 「每次插件运行都会弹配置引导」.
   *
   * The wizard's 完成 button is the only caller that sets `completed`, so closing the page early keeps the wizard
   * coming back, which is the requested behaviour rather than a bug.
   */
  let setupPrompted = false;
  const setupStateHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(req, res, { ...readSetupState(), prompted: setupPrompted, file: setupFilePath() });
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 16 * 1024, (body) => {
      if (body?.prompted === true) setupPrompted = true;
      if (body?.completed === true) {
        const error = writeSetupState({ completed: true, completedAt: Date.now(), version: 1 });
        if (error) {
          sendStatus(res, 500, error);
          return;
        }
        setupPrompted = true;
      }
      sendJson(req, res, { ...readSetupState(), prompted: setupPrompted });
    });
  };

  // ---- 3. the pet's own window -------------------------------------------
  /**
   * The always-on-top window, as a separate process.
   *
   * A plugin cannot ask DSH for a window (the host half has no Electron, the client half's IPC
   * surface has no such channel ?see HANDOFF sec.12), so the window is started here: the
   * launcher in `desktop/` is run against a bare-Electron runtime borrowed from the
   * installation by hard links. `lib/desktop.js` owns all of that; this half owns the routes
   * that switch it on and off, and the requirement that it dies with the plugin.
   */
  const desktopWindow = new DesktopWindow({
    profileDir: process.env.DSH_PROFILE_DIR,
    log: (message) => ctx.logger?.info?.(message),
  });
  ctx.effect(() => () => { desktopWindow.stop(); }, 'vrmpet3d.desktop-window');

  /**
   * The settings store, in the plugin's own state directory.
   *
   * Persisted so a restart keeps what the user configured, and owned by the host so that a change from
   * ANY surface is visible to all of them. `live.window` is filled in here from the launcher rather than
   * reported by the page, because the launcher is what decides which model the window shows.
   */
  const settingsStore = new SettingsStore({
    file: settingsFileFor(stateDir(process.env.DSH_PROFILE_DIR)),
    log: (message) => ctx.logger?.info?.(message),
  });

  /** `GET` returns the snapshot; `POST` applies a patch. Both answer with the new snapshot. */
  const settingsHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      /**
       * No stamping of `live.window` from the launcher here, on purpose (2026-10-13).
       *
       * This used to run on every GET: `settingsStore.setWindowModel(desktopWindow.describe().modelId)`. That
       * field is the model the window was STARTED with (`--model-id`), so from the first switch it was stale — and
       * because every poll of the settings store is a GET, the stale value was re-stamped over the honest one on
       * each poll. The model picker reads `live` to decide when a switch has ARRIVED, so the effect was a progress
       * bar that ran to its timeout while the model was already on screen (operator: 「明明模型已经切换好了，为什么还
       * 走了这么长时间的进度条」). The window's page reports its own model now, on mount and on every load
       * (`reportLoadedModel` in lib/desktop-page.js), which is the only account of what the renderer actually did.
       */
      sendJson(req, res, settingsStore.snapshot());
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 256 * 1024, (body) => {
      try {
        sendJson(req, res, settingsStore.update(body));
      } catch (error) {
        sendStatus(res, 400, `the settings could not be applied: ${error.message}`);
      }
    });
  };

  /**
   * `/vrmpet3d/preview` — the settings window's transient "show me this" channel.
   *
   * The operator asked for the model to preview a clip + expression + mouth while the corresponding setting is
   * being edited, and to go back to normal when the pointer leaves (2026-10-09). It cannot ride on the
   * settings: nothing here may be persisted, and a hover changes far too often to bump a settings version for.
   *
   * So it is one in-memory value plus a counter. `seq` is what a surface polls for — the value itself is
   * repeatable, the counter is not, so a preview that is set twice in a row is still noticed once.
   */
  let previewValue = null;
  let previewSeq = 0;
  const previewHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(req, res, { seq: previewSeq, preview: previewValue });
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 16 * 1024, (body) => {
      previewValue = core.cleanPreview(body && body.preview !== undefined ? body.preview : body);
      previewSeq += 1;
      sendJson(req, res, { seq: previewSeq, preview: previewValue });
    });
  };

  /**
   * `/vrmpet3d/state` — which state the pet is in, published by the surface that can actually tell.
   *
   * The state machine lives in the app's own pet, because that is the only half that sees DSH's sessions,
   * statuses and turn boundaries. The floating window has no session data at all, so without this it could
   * never show 深度求索中 while the model is thinking — which is the whole point of the status prompt.
   *
   * `seq` rather than the value alone, exactly like the preview channel: a state is repeatable (the pet
   * returns to `resting` between turns), so a poller that compared values would miss every second entry
   * into the same state.
   */
  const petStates = core.STATES;
  let petStateValue = null;
  let petStateAt = 0;
  let petStateSeq = 0;
  /**
   * Whether what is held here has been aged out — see the GET half of `stateHandler`, and `core.hostStateView`.
   *
   * Kept per REPORT rather than recomputed on every read, so the `seq` bump happens exactly once per transition: a
   * reader that only looks when `seq` moves must be told about the change, not told about it repeatedly.
   */
  let petStateStale = false;
  /**
   * How old a report may be before `/vrmpet3d/state` calls it "no pet is reporting".
   *
   * `config.stateStaleMs` exists because this window is a timing decision rather than a constant of nature: the
   * shipped 90 s (several missed heartbeats, so a page throttled to one wake a minute is still believed) is the right
   * default, and a suite needs to prove the host's own use of the rule without waiting that long.
   */
  const stateStaleMs = Number.isFinite(Number(config?.stateStaleMs)) && Number(config.stateStaleMs) > 0
    ? Number(config.stateStaleMs)
    : core.HOST_STATE_STALE_MS;
  /**
   * Why the CLIENT half cannot run, if it said so.
   *
   * Added after 2026-10-10, when the pet stopped appearing and there was nothing to look at: a client half that
   * throws before it registers renders NOTHING — no badge, no console-only clue the host can see — and "the
   * plugin is broken" is indistinguishable from "the page was not reloaded". So the client reports its own
   * failure here, and `/vrmpet3d/state` carries it, which makes it readable from outside the browser with one
   * HTTP request.
   */
  let petStateError = null;
  /**
   * WHY the pet said what it said — the machine's inputs, relayed for exactly one reader: whoever is debugging
   * "it keeps saying 深度求索中 with nothing running" (2026-10-14). Not a preference, not persisted, and sanitised here
   * because it crosses a page boundary: numbers, flags, state names and session IDS, each capped.
   */
  const WHY_NUMBERS = ['working', 'waiting', 'unread'];
  const WHY_FLAGS = ['running', 'pending', 'available', 'focused'];
  const WHY_ENTRIES = ['notice', 'held', 'settling'];
  const cleanWhyReport = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const key of WHY_FLAGS) if (typeof raw[key] === 'boolean') out[key] = raw[key];
    for (const key of WHY_NUMBERS) {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) out[key] = Math.floor(value);
    }
    for (const key of ['scope', 'session', 'interaction']) {
      if (typeof raw[key] === 'string' && raw[key]) out[key] = raw[key].slice(0, 64);
    }
    if (Array.isArray(raw.runningIds)) {
      out.runningIds = raw.runningIds
        .filter((id) => typeof id === 'string' && id)
        .slice(0, 8)
        .map((id) => id.slice(0, 64));
    }
    for (const key of WHY_ENTRIES) {
      const entry = raw[key];
      if (!entry || typeof entry !== 'object') continue;
      out[key] = {
        reason: typeof entry.reason === 'string' && entry.reason ? entry.reason.slice(0, 24) : null,
        at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : null,
        sessionId: typeof entry.sessionId === 'string' && entry.sessionId ? entry.sessionId.slice(0, 64) : null,
      };
    }
    const turn = raw.turn;
    if (turn && typeof turn === 'object') {
      out.turn = {
        open: turn.open === true,
        startedAt: Number.isFinite(Number(turn.startedAt)) ? Number(turn.startedAt) : null,
        endedAt: Number.isFinite(Number(turn.endedAt)) ? Number(turn.endedAt) : null,
      };
    }
    /**
     * And the LAST dismissal: which rule ended the notice, with the values it read (`focused`, `presentId`). Rewritten
     * like the rest — a page writes it, and the whole point of it is to be trusted while debugging exactly the report
     * that asked for it (「任务完成的状态只持续了几秒钟，就自己消失了」).
     */
    /**
     * And the SHAPES of the stores the page reported — field names and their types, plus the page's own location. They
     * exist to make "the selected session could not be read" actionable (`catalogKeys` measured on 2026-10-14:
     * `ids`/`byId`/`phase`/`projectionsBySession`, with NO field naming the session on screen), are capped, and say
     * nothing about any session's content.
     */
    for (const key of ['catalogKeys', 'sessionRecordKeys', 'projectionKeys', 'statusKeys']) {
      if (!Array.isArray(raw[key])) continue;
      out[key] = raw[key]
        .filter((item) => typeof item === 'string' && item)
        .slice(0, 16)
        .map((item) => item.slice(0, 40));
    }
    if (typeof raw.location === 'string' && raw.location) out.location = raw.location.slice(0, 80);
    /** Which widget answered — a label for the two-reporter diagnosis, see instance in lib/client.js. */
    if (typeof raw.instance === 'string' && raw.instance) out.instance = raw.instance.slice(0, 12);
    /**
     * The page token and the build sequence the ordering guard reads — without these two the guard is INERT.
     *
     * They were emitted by the client, carried by core.cleanWhy, and then dropped HERE, which is why the first live
     * reading after the restart showed page:/seq: empty on a route that was still flipping between three widgets
     * (operator, 2026-10-14). Both halves of the sanitiser have to agree about why, including about the fields that
     * decide which report counts.
     */
    if (typeof raw.page === 'string' && raw.page) out.page = raw.page.slice(0, 12);
    if (Number.isFinite(Number(raw.seq)) && Number(raw.seq) > 0) out.seq = Math.floor(Number(raw.seq));
    /** The bubble's own numbers — the same rule as `core.cleanWhy`, so the two halves cannot disagree about `why`. */
    if (raw.speechWrap && typeof raw.speechWrap === 'object') {
      const speechWrap = {};
      for (const key of ['width', 'scroll', 'pet', 'petDrawn', 'drawn', 'letters']) {
        const value = Number(raw.speechWrap[key]);
        if (Number.isFinite(value) && value > 0) speechWrap[key] = Math.round(value);
      }
      for (const key of ['css', 'size', 'pad']) {
        if (typeof raw.speechWrap[key] === 'string' && raw.speechWrap[key]) speechWrap[key] = raw.speechWrap[key].slice(0, 12);
      }
      out.speechWrap = speechWrap;
    }
    /** The 3D scene's physics state — see the note beside `physics` in `decisionWhy` (operator, 2026-10-14). */
    if (raw.physics && typeof raw.physics === 'object') {
      out.physics = {
        enabled: raw.physics.enabled !== false,
        error: typeof raw.physics.error === 'string' && raw.physics.error ? raw.physics.error.slice(0, 32) : null,
        chains: Number.isFinite(Number(raw.physics.chains)) ? Math.floor(Number(raw.physics.chains)) : 0,
        dropped: Number.isFinite(Number(raw.physics.dropped)) ? Math.floor(Number(raw.physics.dropped)) : 0,
        frames: Number.isFinite(Number(raw.physics.frames)) ? Math.floor(Number(raw.physics.frames)) : 0,
      };
      if (Number.isFinite(Number(raw.physics.ticked))) out.physics.ticked = Math.floor(Number(raw.physics.ticked));
    }
    /**
     * The unread breakdown, as numbers — added with the 绿点 fix of 2026-10-14 (`unreadDetail`): WHY the green dot is
     * lit, as counts rather than ids or titles. `candidates: 4, counted: 0, inIds: 0` is the shape that proved four
     * helper sessions were being counted as the user's own completions.
     */
    if (raw.unreadDetail && typeof raw.unreadDetail === 'object') {
      const detail = {};
      for (const key of ['candidates', 'counted', 'inIds', 'inById', 'subagent', 'blank', 'withCwd', 'running']) {
        if (raw.unreadDetail[key] === null || raw.unreadDetail[key] === undefined) continue;
        const value = Number(raw.unreadDetail[key]);
        if (Number.isFinite(value) && value >= 0) detail[key] = Math.floor(value);
      }
      out.unreadDetail = detail;
    }
    const dismissed = raw.dismissed;
    if (dismissed && typeof dismissed === 'object' && typeof dismissed.kind === 'string' && dismissed.kind) {
      out.dismissed = {
        kind: dismissed.kind.slice(0, 24),
        at: Number.isFinite(Number(dismissed.at)) ? Number(dismissed.at) : null,
        sessionId: typeof dismissed.sessionId === 'string' && dismissed.sessionId ? dismissed.sessionId.slice(0, 64) : null,
        reason: typeof dismissed.reason === 'string' && dismissed.reason ? dismissed.reason.slice(0, 24) : null,
        focused: dismissed.focused === true,
        presentId: typeof dismissed.presentId === 'string' && dismissed.presentId ? dismissed.presentId.slice(0, 64) : null,
        running: dismissed.running === true,
      };
    }
    return Object.keys(out).length ? out : null;
  };
  let petStateWhy = null;
  /**
   * The page token and build sequence of the widget whose reports this route currently accepts — see the guard in the
   * state POST handler. Ordering by WIDGET, not by module evaluation: the latter is what answered superseded to the live
   * pet once and left the route at seq: 0.
   */
  let petStatePage = null;
  let petStatePageSeq = 0;
  /**
   * The pet's own remark (碎碎念), relayed alongside the state.
   *
   * Published by the app's pet, which is the half that owns the state machine and the phrase table; the
   * floating window has no state of its own and draws whatever arrives here. Sanitised on the way in — one
   * line, capped — because it is a bubble drawn over the desktop and a multi-line string would grow the window
   * past the pet: the CLIENT already caps it from the shipped table, and this is the boundary that does not
   * trust that.
   */
  const SPEECH_LINE_MAX = 80;
  let petStateLine = null;
  const cleanSpeechLine = (value) => {
    if (typeof value !== 'string') return null;
    const oneLine = value.replace(/[\r\n\t]+/g, ' ').trim();
    return oneLine ? oneLine.slice(0, SPEECH_LINE_MAX) : null;
  };
  /**
   * The last press the app's pet reacted to — which gesture, and WHICH PART of the model it landed on.
   *
   * Relayed for the same reason the state and the line are: "I clicked its eye and nothing happened" is
   * answerable from outside only if the region the raycast found travels. `region` is the stable word
   * (`eye`/`head`/`hand`/`body`/`tail`) and `bone` the model's own name for it, which is what makes a wrong
   * mapping visible rather than mysterious. Sanitised at this boundary like everything else a page sends.
   */
  let petStateTouch = null;
  /**
   * The TURN clock the app reported, so the window's 用时 is DSH's own number and not the window's guess.
   *
   * `{ startedAt, endedAt }`: `endedAt` null while the turn is open (the window counts up from `startedAt`), set once
   * the turn has ended (the window shows the turn's own span, which is DSH's "用时 X" rule). Sanitised here like every
   * other value that crosses this boundary — two finite positive numbers, nothing else.
   */
  let petStateClock = null;
  /**
   * How many sessions have an unread completion, as the in-app pet last reported it.
   *
   * Relayed for the floating window's green dot: that window has no state machine and no session store of its own, so
   * the count DSH keeps (`completionUnread`) reaches it through the app's pet. `null` means "nobody has said", which
   * leaves the window's dot as it was.
   */
  let petStateUnread = null;
  const cleanClockReport = (value) => {
    /**
     * The FALLBACK sentinel passes through: it means "this deployment has no turn frames, so the duration is measured
     * from the state's own entry time" (see `core.STATUS_CLOCK_FALLBACK`). Collapsing it to null here would make the
     * window drop the duration entirely — exactly the regression that made a live, working pet look broken.
     */
    if (value === core.STATUS_CLOCK_FALLBACK) return core.STATUS_CLOCK_FALLBACK;
    if (!value || typeof value !== 'object') return null;
    const startedAt = Number(value.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    const endedAt = Number(value.endedAt);
    return { startedAt, endedAt: Number.isFinite(endedAt) && endedAt > 0 ? endedAt : null };
  };
  const cleanTouchReport = (value) => {
    if (!value || typeof value !== 'object') return null;
    const field = (name, max) => (typeof value[name] === 'string' && value[name]
      ? value[name].replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) || null
      : null);
    const out = {
      reason: field('reason', 24),
      /**
       * WHICH part the user built owns this structure, and what they called it.
       *
       * The default region alone cannot answer "I clicked its ear and nothing happened" once the parts are the
       * user's own rows: the ear may be a part they made, in which case `region` says `head` and `part` says
       * `ear` — and `label` is the word the settings list shows, which is what a person recognises.
       */
      part: field('part', 32),
      label: field('label', 24),
      region: field('region', 24),
      bone: field('bone', 64),
      at: Number.isFinite(Number(value.at)) ? Number(value.at) : null,
    };
    return out.reason || out.region ? out : null;
  };
  const stateHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      /**
       * AGE the report out, and answer "no pet is reporting" once it is old.
       *
       * Operator, 2026-10-11: "有时候开始工作的碎碎念不消失，完成任务后还在显示深度求索中". This route used to serve
       * whatever it was last told, for ever, with an unchanged `seq` — and the floating window reacts only to a
       * changed `seq`, so a pet whose page had stopped (Chromium stops the frame loop while the DSH window is
       * hidden, so a turn that ends in the background is never computed nor sent) left 工作中 / 深度求索中 on
       * screen underneath a clock that kept counting. Nothing could distinguish that from a real long turn, because
       * the app only ever re-stated itself on CHANGE. `core.hostStateView` is the whole rule, and it is unit-tested
       * at its edges; here it only has to be applied.
       */
      const view = core.hostStateView({
        state: petStateValue,
        line: petStateLine,
        at: petStateAt,
        seq: petStateSeq,
        stale: petStateStale,
      }, Date.now(), stateStaleMs);
      if (view.transition) {
        petStateStale = view.stale;
        petStateSeq = view.seq;
      }
      sendJson(req, res, {
        seq: petStateSeq, state: view.state, line: view.line, at: view.at,
        stale: petStateStale,
        /**
         * The TURN clock, relayed so the window's 用时 is the app's number.
         *
         * A stale report drops it: `state` is already null then, so a clock would only invite the window to format a
         * duration for a turn nobody is claiming any more. The touch and the error ARE kept — neither is a claim about
         * what the pet is doing now, and wiping the diagnostic is how "I clicked its ear and nothing happened" stops
         * being answerable.
         */
        touch: petStateTouch, clock: petStateStale ? null : petStateClock, error: petStateError,
        /**
         * The WHY block, dropped with the report it explains: a stale report's inputs are about a pet that stopped
         * talking, and leaving them up would invite reading a decision nobody is claiming any more.
         */
        why: petStateStale ? null : petStateWhy,
        /**
         * The unread-completion count, for the floating window's green dot. NOT dropped when the report is stale: the
         * count is a fact about the session list, not about the pet's frame loop.
         */
        unread: petStateUnread,
      });
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 8 * 1024, (body) => {
      const wanted = body && typeof body.state === 'string' ? body.state : '';
      const reported = body && typeof body.error === 'string' && body.error
        ? body.error.slice(0, 500)
        : null;
      // An unknown name is refused rather than stored: the reader renders it through the same tables the
      // renderer uses, and a state nothing knows about would render as nothing at all. A report that names
      // no state at all is still useful — it is the error that matters then.
      petStateValue = petStates.indexOf(wanted) === -1 ? null : wanted;
      // NO line in the body CLEARS it: the pet stopped talking, and a bubble that outlives its turn is how a
      // pet ends up saying something over a finished one. The touch is the same kind of report: a newer one
      // replaces it, and a report without one is not a press at all.
      petStateLine = cleanSpeechLine(body && body.line);
      petStateTouch = cleanTouchReport(body && body.touch);
      petStateClock = cleanClockReport(body && body.clock);
      // A whole number or nothing: an older pet that does not send it leaves the last count standing rather than
      // inventing one, and `0` is a real answer (nothing is unread) that must clear the window's dot.
      if (body && Number.isFinite(Number(body.unread)) && Number(body.unread) >= 0) {
        petStateUnread = Math.floor(Number(body.unread));
      }
      // The diagnostic, rewritten rather than trusted: a page writes it, and it is read from outside.
      const why = cleanWhyReport(body && body.why);
      /**
       * A SUPERSEDED WIDGET CANNOT SPEAK — the ordering rule the live log demanded.
       *
       * Operator, 2026-10-14: 「外置桌宠状态反复横跳依然存在」, and `build/probe-out/watch-state.mjs` showed THREE instances
       * alternating on this one route inside a single second: `2fszuc` and `boygiv` still drawing the old 110 px plate,
       * `v8qgem` on the new 220 px one. The client-side self-disposal only ever covered widgets built by the same build (a
       * cached module copy keeps serving the renderer to later activations), so the ordering has to be enforced HERE, where
       * every report must pass: a page mints one token, each widget in it carries a build sequence, and only the highest
       * sequence on the CURRENT page may write. A different page token is a new page — a restart — adopted immediately.
       *
       * Learned the hard way: an earlier guard of this kind counted MODULE evaluations and answered `superseded` to the
       * live pet itself, leaving `/vrmpet3d/state` at `seq: 0`. This one orders by WIDGET, which is the only thing that
       * means "a newer pet now owns the page". It sits at the TOP of the handler, before anything is written — placed
       * beside the diagnostic it reads, it had already lost the argument.
       */
      const whyPage = why && typeof why.page === 'string' && why.page ? why.page.slice(0, 12) : null;
      const whySeq = why && Number.isFinite(Number(why.seq)) ? Math.floor(Number(why.seq)) : 0;
      /**
       * …and once a page HAS identified itself, a report with no page at all is an older CLIENT — which is exactly what the
       * two 110 px widgets in his log were: builds from before this field existed, still publishing every frame. They cannot
       * be ordered, so they are refused outright. The cost is bounded: if the newest widget ever stops reporting, the route
       * goes stale by the ordinary rule and says so, instead of being kept alive by a leftover.
       */
      if (petStatePage && !whyPage) {
        sendJson(req, res, { seq: petStateSeq, superseded: true, reason: 'no page' });
        return;
      }
      if (whyPage && petStatePage === whyPage && whySeq > 0 && whySeq < petStatePageSeq) {
        sendJson(req, res, { seq: petStateSeq, superseded: true, page: whyPage, seq: whySeq });
        return;
      }
      if (whyPage) {
        if (petStatePage !== whyPage) {
          petStatePage = whyPage;
          petStatePageSeq = 0;
        }
        if (whySeq > petStatePageSeq) petStatePageSeq = whySeq;
      }
      petStateWhy = why;
      if (reported || wanted) petStateError = reported;
      petStateAt = Date.now();
      // A report is a report: whatever it says, this pet is alive, so the staleness flag is cleared here rather
      // than left for the next reader to infer from `at`.
      petStateStale = false;
      petStateSeq += 1;
      if (reported) ctx.logger?.warn?.(`vrmpet3d: the client half reported: ${reported}`);
      sendJson(req, res, {
        seq: petStateSeq, state: petStateValue, line: petStateLine, at: petStateAt, stale: false,
        touch: petStateTouch, clock: petStateClock, error: petStateError,
      });
    });
  };

  /**
   * The AI 碎碎念 channel, and the four decisions behind it.
   *
   *   1. **The call happens HERE, never in a page.** A custom provider's key and DSH's own provider routes are
   *      host-side facts; a page holding the key would put the credential into the DOM of every surface, and a
   *      page calling out directly would bypass the one place that can report WHY a line never arrived.
   *   2. **Nothing about the session reaches the model.** The request is built from the user's own persona, the
   *      state's own instruction and the state's NAME. This function has no reference to any session text at
   *      all, which is how the privacy rule the built-in lines already followed survives being handed to a
   *      model: it is a property of what the code can see, not a filter applied afterwards.
   *   3. **The answer is sanitised at the same boundary the bubble uses** — one line, trimmed, capped. A model
   *      told to keep it short still sometimes writes a paragraph, and a paragraph in the bubble would grow the
   *      pet's window across whatever is behind it.
   *   4. **A failure is reported, never retried here.** The asking surface falls back to the user's own lines
   *      and keeps drawing; the reason travels back so 试一句 in the settings can show it. When the next attempt
   *      is allowed is the speech machine's throttle to decide, not a loop's — which is also why there is no
   *      time-based rate limit here: `每句显示` can legitimately be one second, and a floor would refuse the
   *      second line of a fast user. What IS refused is a second call while one is still running.
   */
  let sayInFlight = false;
  let saySeq = 0;

  /** DSH's own LLM service, looked up lazily — a composition with no adapter is a legal one. */
  const llmService = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('llm') : null;
    } catch (_error) {
      return null;
    }
  };

  /**
   * The system prompt: who the pet IS, plus the rules that make a line drawable.
   *
   * The persona comes first and verbatim, because "把人格灌进 system prompt" is exactly this; the rules after
   * it are not negotiable, because they are what keeps the result a short line in a bubble rather than an
   * essay, and what keeps it free of anything from the session.
   */
  const speechSystemPrompt = (speech, language) => [
    speech.ai.persona,
    '你在为一只有自己性格的桌面宠物写「碎碎念」：它偶尔冒出一句自言自语，显示在它头顶的气泡里。',
    language === 'en' ? 'Answer in English.' : '用中文回答。',
    '只输出这一句话本身：不要引号、不要前后缀、不要解释、不要换行；不超过 30 个字。',
    '不要提到代码、文件名、路径、工具名、报错信息或任何会话内容。',
  ].filter(Boolean).join('\n');

  /** The per-state instruction: the user's own when they wrote one, a generic starter when they did not. */
  const speechStatePrompt = (speech, state) => speech.ai.prompts[state]
    || core.DEFAULT_SPEECH_PROMPTS[state]
    || '现在说一句。';

  /**
   * The instruction a request draws its line from: the part's own prompt, or one built from WHAT WAS TOUCHED.
   *
   * A press is the second reason the pet speaks (2026-10-11): `part` names the row the user built in the
   * settings, and its prompt is "what does this pet say when its ear is touched". The operator's follow-up is why
   * this is not just a fallback to the state: "未设置对应部位 AI 提示词时，把触摸部位自动传入 AI 生成碎碎念…如果是默认
   * 未设置部位的结构，例如 bust，就传给 LLM 让它生成 bust 被触摸的碎碎念". So when a part has no prompt, the
   * STRUCTURE the raycast named becomes the instruction — `bust` is a mesh nothing claims, `ErDuo.L.002` is a bone
   * a user part owns — and the model writes about that.
   *
   * **A SHIPPED part's own instruction comes next** (2026-10-12): 胸部 and 屁股 answer a press with a line about
   * being scolded for touching it, and that is more specific than a structure NAME — the same reason a prompt the
   * user wrote outranks both. Everything below is unchanged for every part that has neither.
   *
   * **The SPRING CHAIN comes first when there is one** (same day): "把对应的链名和结构名一起发给 LLM，链名的优先级
   * 大于结构名". Both names are in the instruction, and the chain leads it, because a chain is the name a person
   * recognises (`LiuHai`, `WeiBa`, a twintail's root bone) while the structure is the rig's own bookkeeping
   * (`J_Sec_L_SkirtSide1`). Both go through VERBATIM: a model file is telling the truth about its own rig, and a
   * translation invented here would be a guess.
   *
   * The state's own instruction stays as the last resort, for a request that names neither (an older cached page
   * sending only a state).
   */
  const speechPromptFor = (speech, preferences, state, part, structure, chain) => {
    const item = part ? core.partItemById(preferences, part) : null;
    const own = item && item.speech ? core.cleanSpeechText(item.speech.prompt, 300) : '';
    if (own) return { item, prompt: own };
    /**
     * Then the SHIPPED instruction for the part's region, before anything about the structure or the chain.
     *
     * 胸部 and 屁股 have one of their own (operator, 2026-10-12: "默认AI提示词'被主人摸到胸部了，必须要傲娇的回骂这个摸人家
     * 胸的变态主人才行。'"), and a part with an instruction is more specific than a structure NAME — the same reason a
     * user-written prompt outranks both. An empty box on a part with no shipped instruction answers `''` here and
     * falls through to the structure, the chain and finally the state, unchanged.
     */
    const shipped = item && typeof core.partSpeechPrompt === 'function' ? core.partSpeechPrompt(item) : '';
    if (shipped) return { item, prompt: shipped };
    const touched = core.cleanSpeechText(structure, 64);
    const spring = core.cleanSpeechText(chain, 64);
    if (spring) {
      const label = item && item.label ? item.label : '';
      const detail = touched && touched !== spring ? `（结构：${touched}）` : '';
      const where = label && label !== spring ? `（部位：${label}）` : '';
      return {
        item,
        prompt: `用户摸了一下它的 ${spring} 这条弹簧骨链${detail}${where}。就这一下，说一句自言自语。`,
      };
    }
    if (touched) {
      const label = item && item.label ? item.label : '';
      const where = label && label !== touched ? `（部位：${label}）` : '';
      return {
        item,
        prompt: `用户摸了一下它的 ${touched}${where}。就这一下，说一句自言自语。`,
      };
    }
    return { item, prompt: speechStatePrompt(speech, state) };
  };

  /**
   * A 碎碎念 is one short line, so the token budget is small — but it is shared with the model's THINKING.
   *
   * `26` would be enough for the answer itself. The budget is larger because a route may enable reasoning, and a
   * reasoning block is billed against the same `max_tokens`: at 64 the whole budget could be spent thinking, the
   * stream ended `max-tokens` with no visible text, and the pet fell back to the state's own line. That was the
   * live failure on 2026-10-10, on the DeepSeek Account route with `deepseek-flash`.
   */
  const SPEECH_MAX_TOKENS = 256;

  /**
   * The reasoning effort asked for, and DSH's own precedent is the reason for the value.
   *
   * Measured in the installed `app.asar` (`dsh-llm-deepseek`): with no explicit effort the adapter resolves
   * `high`, so a remark costs seconds of thinking and a budget it can exhaust; and for its OWN auxiliary short
   * call it forces `"off"` — `options.purpose === "session-title" ? "off" : …`. A speech bubble is that same kind
   * of call: no tools, no history, one line out. "off" is in the adapter's accepted set, so this cannot be
   * rejected as an unsupported effort.
   */
  const SPEECH_REASONING_EFFORT = 'off';

  /**
   * Consume a streamed answer: keep the TEXT, remember what the terminal chunk said, and count what arrived.
   *
   * **The chunk shapes are read out of the installed `app.asar`, not out of prose.** A delta is
   * `{ type: 'text-delta' | 'reasoning-delta', index, text }`, and the terminal chunk is
   * `{ type: 'finish', reason: { kind, failure? } }` — the KIND lives INSIDE `reason`, which is what
   * `BlockAssembler` reads (`this._finish = chunk.reason`). An earlier version of this function read
   * `chunk.kind`, which is always `undefined`, so EVERY stream failure (AUTH, QUOTA, RATE_LIMIT, an aborted
   * call) was silently treated as a success with no text and reported as "the model produced no usable line" —
   * the wrong diagnosis, and one the suite could not catch because its stub stream was built from the same wrong
   * assumption. The stub now uses the real shape.
   *
   * @returns {{text: string, reasoning: number, finish: object|null, types: Map<string, number>}}
   */
  const readLlmStream = async (stream) => {
    let text = '';
    let reasoning = 0;
    let finish = null;
    const types = new Map();
    for await (const chunk of stream) {
      if (!chunk || typeof chunk !== 'object') continue;
      const type = String(chunk.type || 'unknown');
      types.set(type, (types.get(type) || 0) + 1);
      if (type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
      else if (type === 'reasoning-delta' && typeof chunk.text === 'string') reasoning += chunk.text.length;
      else if (type === 'finish') finish = chunk.reason && typeof chunk.reason === 'object' ? chunk.reason : null;
      // A 碎碎念 longer than a few lines is already a failure to be one; stop paying for the rest of it.
      if (text.length > SPEECH_LINE_MAX * 4) break;
    }
    return { text, reasoning, finish, types };
  };

  /**
   * One streamed answer as a line, or a refusal that says WHAT ARRIVED.
   *
   * The detail list is the whole point: "the model produced nothing" has four causes a user cannot tell apart
   * (a terminal failure, a budget spent on thinking, a genuinely empty answer, a route that sent no deltas), and
   * 试一句 has nowhere else to look.
   */
  const speechTextFrom = (result) => {
    const reason = result.finish || {};
    const kind = typeof reason.kind === 'string' ? reason.kind : null;
    const failure = reason.failure && typeof reason.failure === 'object' ? reason.failure : {};
    const detail = [
      `finish=${kind || 'none'}`,
      failure.code ? `${failure.code}${failure.message ? `: ${failure.message}` : ''}` : null,
      result.reasoning ? `思考 ${result.reasoning} 字` : null,
      `正文 ${result.text.length} 字`,
      `分片 ${[...result.types.entries()].map(([type, count]) => `${type}×${count}`).join(' ') || 'none'}`,
    ].filter(Boolean).join('；');
    /**
     * A stream that FAILED is a failure even when it produced text on the way down: half a sentence from a
     * request that never finished is not something to put in the pet's mouth, and what the caller needs is the
     * reason — `AUTH`, `QUOTA`, a cancellation — not the fragment that preceded it.
     */
    if (kind === 'error' || kind === 'aborted') return { error: `模型请求失败（${detail}）` };
    const text = core.cleanSpeechText(result.text, SPEECH_LINE_MAX);
    // `max-tokens` and `tool-calls` are NOT failures here: a budget that ran out after the one line we asked for
    // is a line, and the sentence is already capped. Only "nothing usable arrived" is a refusal.
    if (text) return { text };
    return { error: `模型没有给出可用的一句话（${detail}）` };
  };

  /** One call through DSH's own LLM service, which owns DSH's own credentials. */
  const askDshLlm = async (speech, prompt, language) => {
    const llm = llmService();
    if (!llm || typeof llm.stream !== 'function') throw new Error('这个 DSH 没有提供 LLM 服务');
    /**
     * The two fields are refused SEPARATELY, and that is worth a line of its own.
     *
     * They shared one message («还没有选择 DSH 的 provider 和模型») until 2026-10-12, when the operator reported that
     * 试一句 failed while DeepSeek Account was configured: the provider WAS set, only `dshModel` was empty, and the
     * window's model picker still DISPLAYED one — a `<select>` whose options do not match its value shows its
     * first option, so the pair looked complete. One message for two missing fields is what made that
     * unanswerable from the screen; naming the model is what points at the picker that was lying.
     */
    if (!speech.ai.dshProvider) throw new Error('还没有选择 DSH 的 provider');
    if (!speech.ai.dshModel) throw new Error('还没有选择 DSH 的模型');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), speech.ai.timeoutMs);
    try {
      return speechTextFrom(await readLlmStream(llm.stream({
        provider: speech.ai.dshProvider,
        model: speech.ai.dshModel,
        system: speechSystemPrompt(speech, language),
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: speech.ai.temperature,
        maxTokens: SPEECH_MAX_TOKENS,
        reasoningEffort: SPEECH_REASONING_EFFORT,
        purpose: 'vrmpet3d-speech',
        signal: controller.signal,
      })));
    } finally {
      clearTimeout(timer);
    }
  };

  /** One call to the OpenAI-compatible endpoint the user named. */
  const askCustomLlm = async (speech, prompt, language) => {
    if (!speech.ai.baseUrl) throw new Error('还没有填写 Base URL');
    if (!speech.ai.model) throw new Error('还没有填写模型名');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), speech.ai.timeoutMs);
    try {
      const response = await fetch(`${speech.ai.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(speech.ai.apiKey ? { authorization: `Bearer ${speech.ai.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: speech.ai.model,
          temperature: speech.ai.temperature,
          max_tokens: SPEECH_MAX_TOKENS,
          // No reasoning controls are sent: an OpenAI-compatible endpoint that does not know them would reject
          // the request, and a short answer needs none. `max_tokens` leaves room for a route that thinks anyway.
          messages: [
            { role: 'system', content: speechSystemPrompt(speech, language) },
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`provider 返回 HTTP ${response.status}`);
      const body = await response.json();
      const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
      const message = choice && choice.message ? choice.message : null;
      const text = message && typeof message.content === 'string' ? message.content : '';
      /**
       * A 200 with no text is its own diagnosis, so it is reported as one: an endpoint that answered with a
       * tool call, a refusal, or an empty `choices` array looks identical from here otherwise.
       */
      if (!core.cleanSpeechText(text, SPEECH_LINE_MAX)) {
        return {
          error: `模型没有给出可用的一句话（HTTP 200；choices=${Array.isArray(body && body.choices) ? body.choices.length : 'none'}；`
            + `finish=${(choice && choice.finish_reason) || 'none'}；正文 ${text.length} 字）`,
        };
      }
      return { text };
    } finally {
      clearTimeout(timer);
    }
  };

  /** Which state's box a request names. The event is accepted too, and maps to the box it draws from. */
  const speechBoxFor = (event, state) => {
    if (typeof state === 'string' && core.SPEECH_STATES.indexOf(state) !== -1) return state;
    if (typeof event === 'string' && core.SPEECH_STATE_FOR_EVENT[event]) return core.SPEECH_STATE_FOR_EVENT[event];
    return null;
  };

  /**
   * `GET /vrmpet3d/say?event=working` and `POST /vrmpet3d/say {event, state, language, part}`.
   *
   * Answers `{ seq, state, part, text, provider, model, ms }` on success and `{ text: null, error }` on every
   * other outcome — including "one is already running", which is an answer rather than an error to the caller:
   * the page's fallback line is already up in that case, and 试一句 has a sentence to show.
   *
   * `part` is the other reason this route exists (a press, not a state): it names the row the user built in the
   * settings, and it is what the instruction is looked up by. An id nothing knows falls back to the state's
   * instruction rather than failing — a page that was open while the user deleted a part must still work.
   *
   * `structure` is WHAT was touched, in the model's own words (`leftEye`, `LiuHai`, or `bust` for a mesh no part
   * claims). It is what makes a part with no prompt answerable: the instruction is built from that name.
   *
   * `clipPrompt` is the 提示词 the clip PLAYING in that state carries, and it is appended rather than resolved: see
   * the note where it is read below.
   */
  const sayHandler = (req, res) => {
    const run = (event, state, language, part, structure, chain, clipPrompt) => {
      const box = speechBoxFor(event, state);
      if (!box) {
        sendJson(req, res, {
          seq: saySeq, state: null, part: null, structure: null, chain: null, text: null, error: 'unknown state',
        });
        return;
      }
      if (sayInFlight) {
        sendJson(req, res, {
          seq: saySeq, state: box, part: null, structure: null, chain: null, text: null,
          error: '已经有一句在生成中了',
        });
        return;
      }
      sayInFlight = true;
      saySeq += 1;
      const seq = saySeq;
      const speech = core.cleanSpeech(settingsStore.preferences.speech);
      const wanted = core.cleanPartId(part);
      // The structure and chain names are capped and flattened like every other string that crosses this boundary:
      // they come from a page, and they go into a prompt.
      const touched = core.cleanSpeechText(structure, 64) || null;
      const spring = core.cleanSpeechText(chain, 64) || null;
      const resolved = speechPromptFor(speech, settingsStore.preferences, box, wanted, touched, spring);
      /**
       * The PLAYING clip's own instruction, APPENDED to whatever was resolved above.
       *
       * A per-clip 提示词 refines the state's instruction instead of replacing it, and the order is what says
       * so: the state (or the part) names the SUBJECT — "说一句正在干活时的自言自语" — and this adds how the line
       * about that subject should be spoken. Replacing it would hand the model a style note with no subject
       * at all, which is the one way this field could make a request worse than no field.
       *
       * Capped like every other string a page sends, before it goes into a prompt. The length is
       * `MOTION_LIMITS.promptLength` — the same number the settings store accepts, so what the panel shows and
       * what the model is told cannot disagree about how much of the text survived.
       */
      const clipNote = core.cleanSpeechText(clipPrompt, core.MOTION_LIMITS.promptLength) || null;
      const prompt = clipNote ? `${resolved.prompt}\n${clipNote}` : resolved.prompt;
      const startedAt = Date.now();
      const call = speech.ai.provider === 'custom'
        ? askCustomLlm(speech, prompt, language)
        : askDshLlm(speech, prompt, language);
      Promise.resolve(call)
        .then((answer) => {
          // Both providers answer the same way: `{ text }` or `{ error }` with the reason it could not be one.
          if (answer && answer.error) throw new Error(answer.error);
          const text = core.cleanSpeechText(answer && answer.text, SPEECH_LINE_MAX);
          if (!text) throw new Error('模型没有给出可用的一句话（没有任何回应）');
          sendJson(req, res, {
            seq,
            state: box,
            // Which part the line is about, as RESOLVED: an id the settings no longer hold answers null, so a
            // caller cannot believe its own stale id was used.
            part: resolved.item ? resolved.item.id : null,
            // And WHAT the line was about, echoed so a caller can see the names its instruction was built from.
            structure: touched,
            chain: spring,
            text,
            provider: speech.ai.provider,
            model: speech.ai.provider === 'custom'
              ? speech.ai.model
              : `${speech.ai.dshProvider}/${speech.ai.dshModel}`,
            ms: Date.now() - startedAt,
          });
        })
        .catch((error) => {
          const reason = error && error.name === 'AbortError'
            ? `超过 ${speech.ai.timeoutMs} 毫秒没有回应`
            : (error && error.message ? error.message : String(error));
          ctx.logger?.info?.(`vrmpet3d: the 碎碎念 request failed: ${reason}`);
          sendJson(req, res, {
            seq, state: box, part: resolved.item ? resolved.item.id : null, structure: touched, chain: spring,
            text: null, error: reason, ms: Date.now() - startedAt,
          });
        })
        .then(() => { sayInFlight = false; });
    };
    if (req.method === 'GET' || req.method === 'HEAD') {
      const query = new URL(req.url || '/', 'http://localhost').searchParams;
      run(query.get('event'), query.get('state'), query.get('language') === 'en' ? 'en' : 'zh',
        query.get('part'), query.get('structure'), query.get('chain'));
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 8 * 1024, (body) => {
      run(body && body.event, body && body.state, body && body.language === 'en' ? 'en' : 'zh',
        body && body.part, body && body.structure, body && body.chain, body && body.clipPrompt);
    });
  };

  /**
   * `GET /vrmpet3d/llm` — what the AI settings section needs in order to offer a choice.
   *
   * The provider list comes from the LIVE service rather than from a copy in the settings, so the page can
   * never offer a route this app does not have; `?provider=<id>` adds that route's model list, which is the
   * expensive half and therefore only fetched once a provider is chosen.
   */
  const llmHandler = async (req, res) => {
    const speech = core.cleanSpeech(settingsStore.preferences.speech);
    const query = new URL(req.url || '/', 'http://localhost').searchParams;
    const wanted = query.get('provider') || '';
    const llm = llmService();
    const payload = {
      dsh: {
        available: Boolean(llm && typeof llm.stream === 'function'),
        providers: [],
        models: [],
        provider: wanted,
        error: null,
      },
      custom: {
        configured: Boolean(speech.ai.baseUrl && speech.ai.model),
        hasKey: Boolean(speech.ai.apiKey),
        baseUrl: speech.ai.baseUrl,
        model: speech.ai.model,
      },
    };
    if (payload.dsh.available && typeof llm.listProviders === 'function') {
      try {
        payload.dsh.providers = (llm.listProviders() || []).map((entry) => ({
          id: String((entry && (entry.provider || entry.id)) || ''),
          name: String((entry && (entry.displayName || entry.name || entry.provider)) || ''),
        })).filter((entry) => entry.id);
      } catch (error) {
        payload.dsh.error = error && error.message ? error.message : String(error);
      }
    }
    if (payload.dsh.available && wanted && typeof llm.listModels === 'function') {
      try {
        payload.dsh.models = (await llm.listModels(wanted) || []).map((entry) => ({
          id: String((entry && entry.id) || ''),
          name: String((entry && (entry.name || entry.id)) || ''),
        })).filter((entry) => entry.id);
      } catch (error) {
        payload.dsh.error = error && error.message ? error.message : String(error);
      }
    }
    sendJson(req, res, payload);
  };

  /**
   * Where a window's page lives, derived from the request so no port is guessed.
   *
   * The route is a parameter because there are two windows now, and both URLs come from the same host
   * header — the one the caller actually reached the plugin on.
   */
  const pageUrlFor = (req, route) => {
    const host = req?.headers?.host;
    return host ? `http://${host}${route || ROUTES.window}` : null;
  };

  const desktopPageHandler = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    let html = null;
    try {
      html = readFileSync(join(PLUGIN_ROOT, 'lib', 'desktop-page.html'));
    } catch (error) {
      sendStatus(res, 500, `cannot read the pet's page: ${error.message}`);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': html.length,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(html);
  };

  /**
   * A settings page, served by file name.
   *
   * `/vrmpet3d/config` (模型参数) and `/vrmpet3d/global` (通用设置) are TWO pages since 2026-10-11 — the operator asked
   * for them to be separate documents rather than two halves of one hidden page — and they are served identically,
   * so the reader is written once from the file name. Served like the pet's page and for the same reason: the
   * window is a page of this plugin, so the host is where it comes from, with `no-store` so a rebuilt plugin is
   * picked up on the next open. Neither needs any injection: everything they list they fetch from
   * `/vrmpet3d/model-info`, `/vrmpet3d/catalog` and `/vrmpet3d/settings`.
   */
  const settingsPageHandler = (file, label) => (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    let html = null;
    try {
      html = readFileSync(join(PLUGIN_ROOT, 'lib', file));
    } catch (error) {
      sendStatus(res, 500, `cannot read the ${label}: ${error.message}`);
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': html.length,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(html);
  };

  /** `/vrmpet3d/config` — the 模型参数 page: 模型 / 表情 / 部位 / 弹簧骨. */
  const configPageHandler = settingsPageHandler('config-page.html', 'model-parameter page');
  /** `/vrmpet3d/global` — the 通用设置 page: 模型导入 / 动作导入 / 状态 / 碎碎念 / 视线 / 鼠标互动 / 其他. */
  const globalPageHandler = settingsPageHandler('global-page.html', 'general-settings page');
  /**
   * `/vrmpet3d/setup` — the first-run guide, whose flow is 欢迎 / 偏好模型 / 桌宠界面 / AI 碎碎念 / 完成.
   *
   * Served like the other two, and for the same reason: a guide has to be a real window on DSH Desktop (so the
   * pickers are native) and a plain page anywhere else, and only the host can be both.
   */
  const setupPageHandler = settingsPageHandler('setup-page.html', 'first-run guide');

  /**
   * 切换模型's own page: the model picker, opened from either pet's right-click menu.
   *
   * The same page the guide's 偏好模型 step renders its content from (`lib/model-picker.js`), which is the
   * point: the operator asked for the panel and the wizard step to be identical, and one component behind two
   * mounts is the only version of that which cannot drift.
   */
  const pickerPageHandler = settingsPageHandler('picker-page.html', 'model-picker page');

  /**
   * The page's own sources, by NAME — the module-level `WINDOW_SOURCES`, so the verification suite reads the
   * real whitelist instead of restating it. See its own declaration for why the two live up there.
   */
  const DESKTOP_SOURCES = WINDOW_SOURCES;

  const desktopSourceHandler = (req, res) => {
    const url = requestUrl(req, res);
    if (!url) return;
    // The prefix is registered without a trailing slash; the separator is added here, so the
    // name can never begin with one.
    const prefix = ROUTES.windowLib + '/';
    if (!url.pathname.startsWith(prefix)) {
      sendStatus(res, 404, 'no such page source');
      return;
    }
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!DESKTOP_SOURCES.has(name)) {
      sendStatus(res, 404, 'no such page source');
      return;
    }
    let bytes = null;
    try {
      bytes = readFileSync(join(PLUGIN_ROOT, 'lib', name));
    } catch (error) {
      sendStatus(res, 500, `cannot read ${name}: ${error.message}`);
      return;
    }
    res.writeHead(200, {
      // By the NAME's own extension rather than one type for the whole whitelist: `pages.css` has to be
      // served as CSS or the browser refuses to apply it. See `WINDOW_SOURCE_TYPES`.
      'content-type': WINDOW_SOURCE_TYPES[extname(name).toLowerCase()] ?? 'text/javascript; charset=utf-8',
      'content-length': bytes.length,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(bytes);
  };

  /**
   * `/vrmpet3d/whale` — DSH's own animated whale mark, for the prompt above the pet's head.
   *
   * The app's running label draws its mark by masking `currentColor` through a 60-frame APNG
   * (`RunningWhaleTail` in `dsh-client-ui-chat`), with a static SVG for reduced motion, forced colours, or a
   * browser without alpha masks. This serves the animated half of that pair to the pet's two prompts.
   *
   * The bytes are NOT committed to this repository: `docs/ASSET-CONTRACT.md` §1 is the rule for assets the
   * project did not make — load them where they already live, never copy them into the tree. So
   * `scripts/whale-asset.mjs` reads the image out of the installed DSH and writes it to
   * `assets/whale-tail.apng`, and this route streams that file. A checkout with no DSH, or one where the
   * script has not been run, answers 404 — and both prompts fall back to the static SVG, which is the app's
   * own fallback and a complete mark on its own.
   */
  const whaleHandler = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    let bytes = null;
    try {
      bytes = readFileSync(join(PLUGIN_ROOT, 'assets', 'whale-tail.apng'));
    } catch (error) {
      sendStatus(res, 404, 'the animated whale mark is not extracted; run: node scripts/whale-asset.mjs');
      return;
    }
    res.writeHead(200, {
      'content-type': 'image/apng',
      'content-length': bytes.length,
      /**
       * `no-store` like every other route here: the file is 21 KB, it is read from the same disk, and a
       * prompt that kept a stale mark after the asset was re-extracted would be a mystery rather than a
       * cache hit.
       */
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(bytes);
  };

  /**
   * Switch the window on and off, and report what it is doing.
   *
   * POST rather than a Remote so the pet can use the same relative-fetch path everything
   * else in this plugin uses; the body carries `action` and the model the user is looking at,
   * so the window opens showing the pet they chose rather than the placeholder.
   */
  /**
   * What the floating window's own page last reported about its bubble (see the metrics action below).
   *
   * The window's page block in describe() is a snapshot the launcher takes, and on this machine it goes stale within
   * seconds — so the one measurement needed to explain 「内置只有外置的一半」 had no way of reaching the host. This is that
   * way: numbers and short CSS lengths only, sanitised here the way every other report is.
   */
  let desktopPageMetrics = null;
  function cleanPageMetrics(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const key of ['width', 'scroll', 'pet', 'petDrawn', 'drawn', 'letters']) {
      const value = Number(raw[key]);
      if (Number.isFinite(value) && value >= 0) out[key] = Math.round(value * 1000) / 1000;
    }
    for (const key of ['css', 'size', 'pad']) {
      if (typeof raw[key] === 'string' && raw[key]) out[key] = raw[key].slice(0, 12);
    }
    out.at = Date.now();
    return out;
  }

  const desktopHandler = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(req, res, {
        ...desktopWindow.describe(),
        /**
         * The WINDOW's OWN bubble measurements, posted by its page (action metrics below).
         *
         * Added because 「内置碎碎念气泡只有外置的一半」 could not be settled from this side: the app half reports its own
         * numbers through /vrmpet3d/state (why.speechWrap), and the window's page block in describe() is a stale
         * snapshot on this machine. A dedicated action on THIS route carries the missing half without adding a route to
         * the table every suite asserts on.
         */
        pageMetrics: desktopPageMetrics,
        routes: { window: ROUTES.window },
      });
      return;
    }
    if (req.method !== 'POST') {
      sendStatus(res, 405, 'method not allowed');
      return;
    }
    readJsonBody(req, res, 16 * 1024, (body) => {
      const action = typeof body?.action === 'string' ? body.action : '';
      /**
       * The window reporting its own bubble numbers — see pageMetrics in the GET above. Answered by the HOST rather than
       * forwarded to the launcher, so an older launcher cannot reject it.
       */
      if (action === 'metrics') {
        desktopPageMetrics = cleanPageMetrics(body?.metrics);
        sendJson(req, res, { ok: true, pageMetrics: desktopPageMetrics });
        return;
      }
      if (action === 'disable' || action === 'stop') {
        sendJson(req, res, desktopWindow.stop());
        return;
      }
      /**
       * TWO PANELS, TWO ACTIONS (operator, 2026-10-11).
       *
       * `settings` opens the 通用设置 window — 模型导入 / 动作导入 / 状态 / 碎碎念 / 视线 / 鼠标互动 / 其他, everything that is
       * not about one model — and `config` opens the 模型参数 window for the model on screen (表情 / 部位 / 弹簧骨 / 大小).
       * They are separate PAGES on separate routes (`/vrmpet3d/global`, `/vrmpet3d/config`), so a user can keep both open: the
       * global one while setting up, and a model's while tuning it. The actions keep the names they have always had, so
       * a surface older than this split still opens the right window.
       */
      /**
       * The first-run guide, opened on request and never by the host itself.
       *
       * WHO ASKS: the in-app pet, once per activation, after its own boot (`maybeOfferSetup` in `lib/client.js`),
       * having read `completed`/`prompted` from `/vrmpet3d/setup-state`. The host stays passive here because
       * "open a window" is a thing only a surface that is already running can ask for, and a host that opened one
       * by itself would have no page to fall back to on a machine with no launcher.
       */
      if (action === 'setup') {
        const setupUrl = pageUrlFor(req, ROUTES.setup);
        if (!setupUrl) {
          sendStatus(res, 400, 'no host header to build the page URL from');
          return;
        }
        const opened = desktopWindow.openConfig({ url: setupUrl });
        if (!opened.ok) {
          sendStatus(res, 500, opened.error || 'the first-run guide could not be opened');
          return;
        }
        sendJson(req, res, { state: 'setup-open', pid: opened.pid || null, url: setupUrl });
        return;
      }
      if (action === 'picker') {
        /**
         * 切换模型, opened from either pet's menu.
         *
         * No model in the URL and no preference written: this window's whole job is to CHANGE the model, so
         * adopting the one on screen first (which `config` does) would be a write nothing asked for. It opens
         * on the store's current value and each click is a write of its own.
         */
        const pickerUrl = pageUrlFor(req, ROUTES.picker);
        if (!pickerUrl) {
          sendStatus(res, 400, 'no host header to build the page URL from');
          return;
        }
        const opened = desktopWindow.openConfig({ url: pickerUrl });
        if (!opened.ok) {
          sendStatus(res, 500, opened.error || 'the model picker could not be opened');
          return;
        }
        sendJson(req, res, { state: 'picker-open', pid: opened.pid || null, url: pickerUrl });
        return;
      }
      if (action === 'config' || action === 'settings') {
        const page = action === 'settings' ? 'global' : 'model';
        // The model the pet is SHOWING goes in the URL: a fresh profile has no stored preference, and a
        // settings page that opened on the placeholder while a VRM was on screen would look broken. The
        // page treats it as a fallback, so opening the window never switches the model by itself.
        const wanted = typeof body?.modelId === 'string' && body.modelId
          ? body.modelId
          : desktopWindow.describe().modelId;
        // The surface that opened the window knows which model is ON SCREEN, so the host adopts it: with a
        // fresh settings file the store would otherwise say 'placeholder' and the window would describe a
        // model nobody is showing. The model is one shared setting, so adopting the live one is the truth.
        if (wanted && wanted !== 'placeholder') {
          settingsStore.update({ preferences: { modelId: wanted } });
        }
        const query = [];
        // A model parameter window is ABOUT a model, so it carries one; the 通用设置 window has no model in its URL.
        if (page === 'model' && wanted) query.push('model=' + encodeURIComponent(wanted));
        const route = page === 'global' ? ROUTES.global : ROUTES.config;
        const settingsUrl = pageUrlFor(req, route) + (query.length ? '?' + query.join('&') : '');
        if (!settingsUrl) {
          sendStatus(res, 400, 'no host header to build the page URL from');
          return;
        }
        const opened = desktopWindow.openConfig({ url: settingsUrl });
        if (!opened.ok) {
          sendStatus(res, 500, opened.error || 'the settings window could not be opened');
          return;
        }
        sendJson(req, res, { state: 'config-open', pid: opened.pid || null, url: settingsUrl });
        return;
      }
      if (action !== 'enable' && action !== 'start' && action !== 'restart') {
        sendStatus(res, 400, "expected {action: 'enable'|'disable'|'config'}");
        return;
      }
      if (action === 'restart') desktopWindow.stop();
      const url = pageUrlFor(req);
      if (!url) {
        sendStatus(res, 400, 'no host header to build the page URL from');
        return;
      }
      const modelId = typeof body?.modelId === 'string' && body.modelId ? body.modelId : 'placeholder';
      const status = desktopWindow.start({ url, modelId });
      if (status.state === 'failed') {
        sendStatus(res, 500, status.lastError || 'the window could not be started');
        return;
      }
      sendJson(req, res, status);
    });
  };


  /**
   * Register the byte routes, once a web server exists to register them on.
   *
   * This is deliberately NOT a bare `ctx.get('webServer')` at apply time, and that
   * distinction is why `/vrmpet3d/catalog` answered 404 in the app:
   *
   *   * a plugin's `apply` can run BEFORE the web server service is provided -   *     composition order is not the plugin's to choose;
   *   * `ctx.get` is a one-shot read, so the miss was permanent: nothing re-runs
   *     `apply` when the service appears, the plugin kept `assetRoutes = null`, and
   *     no route was ever registered;
   *   * the server answers every unclaimed path with 404 until its owner registers,
   *     so the symptom was a 404 on the catalog fetch and a badge on the pet.
   *
   * `ctx.inject` is the declarative fix: Cordis calls the callback with a scope in
   * which `webServer` exists, whenever that becomes true, and disposes the scope if
   * it goes away. The service is an OPTIONAL dependency on purpose ?a hard
   * `inject: ['webServer']` would leave the plugin waiting for activation forever
   * in a composition with no web server, which is a far worse failure than a pet
   * that cannot load model files.
   */
  service.assetRoutes = null;

  const registerRoutes = (scope) => {
    const webServer = scope.webServer ?? scope.get?.('webServer') ?? scope.get?.('webserver');
    if (!webServer || typeof webServer.register !== 'function') {
      service.assetRoutes = null;
      return;
    }
    // The service can become available more than once (an HMR reload, a second
    // composition); registering the same (kind, path) twice throws by contract.
    if (service.assetRoutes) return;

    const disposers = [];
    try {
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.catalog, handler: catalogHandler }));
      disposers.push(webServer.register({ kind: 'prefix', path: ROUTES.asset, handler: assetHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.modelInfo, handler: modelInfoHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.modelThumbnail, handler: modelThumbnailHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.config, handler: configPageHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.global, handler: globalPageHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.picker, handler: pickerPageHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.settings, handler: settingsHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.preview, handler: previewHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.setup, handler: setupPageHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.setupState, handler: setupStateHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.state, handler: stateHandler }));
      // The AI 碎碎念 pair: one generated line on demand, and the provider list the settings offer.
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.say, handler: sayHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.llm, handler: llmHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.models, handler: modelsHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.motions, handler: motionCatalogHandler }));
      disposers.push(webServer.register({ kind: 'prefix', path: ROUTES.motion, handler: motionHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.window, handler: desktopPageHandler }));
      disposers.push(webServer.register({ kind: 'prefix', path: ROUTES.windowLib, handler: desktopSourceHandler }));
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.desktop, handler: desktopHandler }));

      // DSH's animated whale mark, for the prompt's mask (the static SVG in the markup is the fallback).
      disposers.push(webServer.register({ kind: 'exact', path: ROUTES.whale, handler: whaleHandler }));
    } catch (error) {
      // A duplicate route means another copy of this plugin is composed, or the
      // path belongs to someone else. Report it instead of failing activation:
      // the pet is still usable from its placeholder.
      ctx.logger?.warn?.(`vrmpet3d: could not register asset routes: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (disposers.length) {
      const cleanup = () => { for (const dispose of disposers) dispose(); };
      if (typeof scope.effect === 'function') scope.effect(() => cleanup, 'vrmpet3d.asset-routes');
      else if (typeof ctx.effect === 'function') ctx.effect(() => cleanup, 'vrmpet3d.asset-routes');
    }
    service.assetRoutes = disposers.length ? Object.freeze({ ...ROUTES }) : null;
    service.importedModelDirs = () => importedDirs.slice();
  };

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => registerRoutes(scope));
  } else {
    // A context without the declarative form: fall back to reading it now, which is
    // all the previous revision ever did.
    registerRoutes(ctx);
  }

  // Expose the resolved directories for diagnostics without leaking them into
  // the page's own request path.
  service.describe = () => ({
    modelCount: store.models.length,
    motionCount: motionStore.motions.length,
    webRoutes: Boolean(service.assetRoutes),
    desktop: desktopWindow.describe(),
    bundledDir: join(PLUGIN_ROOT, 'assets', 'models'),
  });
}
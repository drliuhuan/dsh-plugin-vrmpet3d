#!/usr/bin/env node
/**
 * Build the DEV TWIN: a second copy of this plugin, under a second identity, so DSH can
 * load it BESIDE the released one.
 *
 *   node scripts/make-dev-package.mjs              # (re)write build/dev-package/
 *   node scripts/make-dev-package.mjs --check      # is the copy still current? (1 s, no writes)
 *   node scripts/make-dev-package.mjs --out <dir>  # somewhere else (default build/dev-package)
 *
 * Then:
 *   node scripts/install-desktop-plugin.mjs --package build/dev-package
 *   ...restart DSH. Both plugins are then composed: `dsh-plugin-vrmpet3d` (the real one)
 *   and `dsh-plugin-vrmpet3d-dev` (this copy).
 *
 * Why a generated twin, and not a rename in the source
 * ---------------------------------------------------
 * The operator asked for the dev branch to load as `…-dev` so both versions can be debugged
 * at once (2026-10-16). A plugin's NAME, though, is not one string: it is woven through
 * ~2400 places — every route (`/vrmpet3d/...`, and DSH's webserver THROWS on a duplicate
 * route, so a plain rename of the package is a second plugin that cannot register a single
 * one), the service name and `ctx.remote.vrmpet3d`, every `__VRMPET3D_*` global and chunk
 * id, the `localStorage` key, the settings/setup/import files in the profile, the Electron
 * runtime directory and its IPC channels, and the CSS class names. Two instances sharing any
 * one of those would fight: the second route registration throws, the second settings write
 * clobbers the first, and both pets would read each other's stored size and position.
 *
 * Renaming all of that IN THE TREE would work too — and is what this repository did on
 * 2026-10-12 (PMX → VRM) — but `main` and `dev` are not a merge: `main` carries 34 commits
 * dev does not have, dev carries 118 `main` does not have, and the release tree is generated
 * FROM dev (`scripts/make-release-pages.mjs`). Permanent identity divergence between the two
 * branches means every future sync conflicts on every line that mentions the name, and the
 * release transform would have to rename it back. So the identity shift lives HERE, in a
 * generated artifact, and the source tree keeps exactly one name.
 *
 * This is the same idiom the tree already uses for a tree that must differ from the source:
 * `client-chunks.mjs`, `vendor-build.mjs`, `make-release-pages.mjs`, `make-release-readme.mjs`.
 *
 * What the copy is
 * ----------------
 * Exactly what an INSTALL of this package carries — `package.json`'s `files[]`, honouring its
 * two exclusions — with every occurrence of the identity shifted:
 *
 *   dsh-plugin-vrmpet3d → dsh-plugin-vrmpet3d-dev      (the package, the bundle row, the chunk ids)
 *   vrmpet3d            → vrmpet3d-dev                 (routes, file names, CSS) …
 *   vrmpet3dX           → vrmpet3dDevX                 (… and the camel-cased identifiers)
 *   VRMPET3D            → VRMPET3D_DEV                 (globals, env vars, status prefix)
 *   VrmPet3D            → VrmPet3DDev                  (class names)
 *
 * Three shapes need care and are handled by name below: `dsh-plugin-vrmpet3d` (or the
 * `vrmpet3d-dev` it would become gets a second `-dev`), the camel-cased identifiers (a hyphen
 * there is a syntax error), and `remote.vrmpet3d` (a property access — a shifted service name
 * is not a valid property, so it becomes `remote['vrmpet3d-dev']`). After the shift every
 * generated `.js` is fed to `node --check` and every text file is scanned for an unshifted
 * token, so a shape nobody thought of fails HERE rather than at load time in DSH.
 *
 * The PRE-RENAME names stay as they are, deliberately. `pet3d-settings.json`, `pet3d-model-dirs.json`
 * and the `PET3D_*` environment fallback are what the 2026-10-12 rename's migration READS, not this
 * plugin's identity: a twin looking for `pet3d-dev-settings.json` would be a twin whose migration can
 * never fire. Nothing on this machine carries them any more, so they are dead either way — but they
 * are dead for the honest reason.
 *
 * `assets/whale-tail.apng` is deliberately absent, exactly as it is from a real install (`files[]` excludes
 * it, and `docs/ASSET-CONTRACT.md` §1 forbids copying an asset the project did not make). Since 2026-10-16
 * that costs the twin nothing: the host reads the mark out of the RUNNING DSH at activation
 * (`lib/whale.js`), so `/vrmpet3d-dev/whale` answers exactly as the released plugin's `/vrmpet3d/whale`
 * does — from the app's own bundle, with the same fallbacks. (Before that change the twin's route 404'd
 * here, because the twin is generated and the mark was a file in the tree.)
 *
 * Cost of keeping it alive: one command after an edit to `lib/` or `desktop/`, and `--check`
 * in the same breath as `client-chunks.mjs --check`. A stale twin is not silent — it fails
 * `--check`, and it would otherwise be a dev pet quietly running yesterday's code.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const CHECK = args.includes('--check');
const OUT = resolve(argOf('--out') ?? join(ROOT, 'build', 'dev-package'));

/** The one name this tree has; the source of the shift, and the guard against shifting twice. */
const SOURCE_NAME = 'dsh-plugin-vrmpet3d';
/** What the copy is called. Also the Loader entry name, so it must be the copy's package name. */
const DEV_NAME = 'dsh-plugin-vrmpet3d-dev';

/** Written into the output so an existing directory can be proven to be ours before it is deleted. */
const MARKER = '.dev-package.json';

/**
 * What an install carries: `package.json`'s `files[]`, plus the manifest itself, minus its two
 * exclusions. Spelled out here rather than read from `files[]` because a pattern-expander for
 * npm's glob syntax would be more code than the list, and the list is what a reviewer can check
 * against the manifest in one glance.
 */
const COPY_FILES = ['package.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'HANDOFF.md'];
const COPY_DIRS = ['lib', 'desktop', 'docs', 'assets'];
const COPY_EXCLUDE = new Set([
  'assets/screenshots',      // `!assets/screenshots` — marketplace media
  'assets/whale-tail.apng',  // `!assets/whale-tail.apng` — extracted from DSH, never redistributed
]);

/** Extensions whose contents are shifted as text; everything else is payload and is hard-linked. */
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.yml', '.yaml', '.txt']);

/**
 * The four identity shapes, in ONE alternation so that no replacement is ever re-scanned.
 *
 * Sequential `replaceAll` calls cannot be used here: shifting `vrmpet3d` → `vrmpet3d-dev` first
 * would turn `vrmpet3dDesktop` into `vrmpet3d-devDesktop`, which is not parseable, and shifting
 * the camel case first would leave `vrmpet3dDev` for the generic rule to shift again
 * (`vrmpet3d-devDevDesktop`). One pass, one match, one decision each.
 *
 * `vrmpet3d(?=[A-Z])` (camel) and `(?<=[A-Za-z0-9_$])vrmpet3d` (glued to the left) are the
 * identifier shapes; the bare `vrmpet3d` alternative is last so the specific ones win.
 */
const SHIFT = /dsh-plugin-vrmpet3d|VrmPet3D|VRMPET3D|vrmpet3d(?=[A-Z])|(?<=[A-Za-z0-9_$])vrmpet3d|vrmpet3d/g;

/** How many `remote.vrmpet3d` accesses were rewritten, for the note the shift prints. */
let remoteAccessors = 0;

/**
 * The identity shift, as a pure function of the text.
 * @param {string} text any source, file name or doc
 * @returns {string} the same text under the dev identity
 */
function shiftText(text) {
  const shifted = text.replace(SHIFT, (match, offset, whole) => {
    if (match === 'dsh-plugin-vrmpet3d') return DEV_NAME;
    if (match === 'VrmPet3D') return 'VrmPet3DDev';
    if (match === 'VRMPET3D') return 'VRMPET3D_DEV';
    const before = whole[offset - 1] ?? '';
    const after = whole[offset + match.length] ?? '';
    return /[A-Z]/.test(after) || /[A-Za-z0-9_$]/.test(before) ? 'vrmpet3dDev' : 'vrmpet3d-dev';
  });
  /**
   * `remote.vrmpet3d` is a PROPERTY ACCESS, and `remote.vrmpet3d-dev()` is not syntax. It is
   * rewritten after the pass above rather than inside it, because the text it matches
   * (`remote.vrmpet3d-dev`) only exists once the pass has run — and because doing it afterwards
   * means the rewrite cannot be re-scanned either.
   */
  return shifted.replace(/remote\.vrmpet3d-dev/g, () => {
    remoteAccessors += 1;
    return "remote['vrmpet3d-dev']";
  });
}

/** A file or directory NAME, shifted by the same rules (the two shipped manifests carry it). */
const shiftName = (name) => shiftText(name);

// ---------------------------------------------------------------------------
// building
// ---------------------------------------------------------------------------
let written = 0;
let linked = 0;

/** Copy one file: text is shifted, payload is hard-linked (41 MB of models and motions). */
function copyOne(src, dst) {
  if (TEXT_EXT.has(extname(src).toLowerCase())) {
    writeFileSync(dst, shiftText(readFileSync(src, 'utf8')), 'utf8');
    written += 1;
    return;
  }
  try {
    linkSync(src, dst);
    linked += 1;
  } catch {
    // A different volume (or a filesystem without hard links): a copy is the honest fallback,
    // and the payload is read-only, so which one it is cannot be observed at runtime.
    copyFileSync(src, dst);
    written += 1;
  }
}

function copyDir(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const rel = relative(ROOT, src).split(sep).join('/');
    if (COPY_EXCLUDE.has(rel)) continue;
    const dst = join(dstDir, shiftName(entry.name));
    if (entry.isDirectory()) copyDir(src, dst);
    else copyOne(src, dst);
  }
}

/** Every file in a built tree, relative and `/`-separated, marker excluded. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (rel === MARKER) continue;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const hashOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * Write the marker, and write it FIRST — before a single file is copied.
 *
 * The marker is what licenses the next run to delete the directory, so a build that dies
 * half-way (a full disk, a Ctrl-C, an unreadable source) must leave one behind: writing it
 * last would turn every crash into a directory this script then refuses to touch, and the
 * operator into someone deleting `build/` by hand. The file count is added at the end.
 */
function writeMarker(outDir, files) {
  writeFileSync(join(outDir, MARKER), `${JSON.stringify({
    generatedBy: 'scripts/make-dev-package.mjs',
    from: SOURCE_NAME,
    as: DEV_NAME,
    generatedAt: new Date().toISOString(),
    ...(files === undefined ? {} : { files }),
  }, null, 2)}\n`, 'utf8');
}

/**
 * Wipe and rebuild `outDir`.
 *
 * The deletion is guarded: only a directory this script made (it carries the marker) is ever
 * removed, so a mistyped `--out` cannot take a checkout with it.
 */
function build(outDir) {
  if (outDir === ROOT || ROOT.startsWith(outDir + sep)) {
    fail(`--out ${outDir} is this repository or one of its parents; refusing to write there`);
  }
  if (existsSync(outDir)) {
    if (!existsSync(join(outDir, MARKER))) {
      fail(`refusing to delete ${outDir}: it carries no ${MARKER}, so this script did not make it`);
    }
    rmSync(outDir, { recursive: true, force: true });
  }
  written = 0;
  linked = 0;
  mkdirSync(outDir, { recursive: true });
  writeMarker(outDir);
  for (const file of COPY_FILES) copyOne(join(ROOT, file), join(outDir, shiftName(file)));
  for (const dir of COPY_DIRS) copyDir(join(ROOT, dir), join(outDir, shiftName(dir)));
  writeMarker(outDir, listFiles(outDir).length);
}

// ---------------------------------------------------------------------------
// verifying
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];

function report(ok, label, detail) {
  if (ok) {
    passed += 1;
    console.log(`  pass  ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

/** `detail` for a report, without printing a whole file. */
const clip = (text) => String(text ?? '').trim().split('\n').slice(0, 3).join(' | ');

function fail(message) {
  console.error(`make-dev-package: ${message}`);
  process.exit(2);
}

/**
 * The patterns no shifted file may still contain.
 *
 * Every one of them allows the SHIFTED form and rejects the source form, so this is the check
 * that "the whole identity moved" rather than "the strings I remembered moved": the lookahead
 * is what makes `vrmpet3d-dev` and `vrmpet3dDev` pass and a bare `vrmpet3d` fail.
 */
const LEFTOVERS = [
  [/dsh-plugin-vrmpet3d(?!-dev)/, 'dsh-plugin-vrmpet3d'],
  [/VrmPet3D(?!Dev)/, 'VrmPet3D'],
  [/VRMPET3D(?!_DEV)/, 'VRMPET3D'],
  [/vrmpet3d(?!-dev|Dev)/, 'vrmpet3d'],
];

/**
 * Everything that can be checked without DSH: the manifest and the bundle row, the shift's
 * completeness, that the copy still parses, that the two shipped manifests moved with the
 * constant that names them, and that the host half ACTIVATES and registers its routes under
 * the dev prefix.
 */
async function verify(dir) {
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  report(pkg.name === DEV_NAME, `the copy's package name is ${DEV_NAME}`, pkg.name);
  report(pkg.main === 'lib/index.js' && existsSync(join(dir, pkg.main)), `its main entry exists (${pkg.main})`);
  report(pkg.dsh?.bundle?.patch !== undefined && existsSync(join(dir, pkg.dsh.bundle.patch)),
    `its bundle patch exists (${pkg.dsh?.bundle?.patch})`);
  report(pkg.dsh?.client?.platform === 'web', "its dsh.client declaration still says platform 'web'");

  {
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8');
    report(patch.includes(`name: ${DEV_NAME}`), 'the bundle patch names the dev package');
    report(/^\s*(?:-\s*)?id:\s*vrmpet3d-dev\s*$/m.test(patch), 'and inserts a row under the dev id');
    report(/^\s*replace\s*:/m.test(patch) === false, 'while still replacing no official component');
  }

  {
    const clientEntry = readFileSync(join(dir, 'lib', 'client.js'), 'utf8');
    report(clientEntry.includes(`var PLUGIN_ID = '${DEV_NAME}'`),
      'the client half registers under the dev package name');
    const chunks = ['client.core.js', 'client.scene.js', 'client.menu.js', 'client.vendor.js'];
    const wrong = chunks.filter((name) => !readFileSync(join(dir, 'lib', name), 'utf8')
      .includes(`id: '${DEV_NAME}/${name}'`));
    report(wrong.length === 0, 'and every delivered chunk is registered under it too',
      wrong.length ? `not registered: ${wrong.join(', ')}` : undefined);
  }

  {
    const missing = ['assets/models/vrmpet3d-dev-models.json', 'assets/motions/vrmpet3d-dev-motions.json']
      .filter((rel) => !existsSync(join(dir, rel)));
    report(missing.length === 0, 'the two shipped manifests moved with the names they are read by',
      missing.length ? `missing: ${missing.join(', ')}` : undefined);
    const index = readFileSync(join(dir, 'lib', 'index.js'), 'utf8');
    report(index.includes("'vrmpet3d-dev-models.json'") && index.includes("'vrmpet3d-dev-motions.json'"),
      'and the constants that name them were shifted with them');
  }

  {
    const files = listFiles(dir);
    const unshifted = [];
    let javascript = 0;
    let json = 0;
    const badSyntax = [];
    for (const rel of files) {
      const path = join(dir, ...rel.split('/'));
      const ext = extname(rel).toLowerCase();
      if (ext === '.json') {
        json += 1;
        try { JSON.parse(readFileSync(path, 'utf8')); } catch (error) { badSyntax.push(`${rel}: ${error.message}`); }
      } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        javascript += 1;
        try {
          execFileSync(process.execPath, ['--check', path], { stdio: ['ignore', 'ignore', 'pipe'] });
        } catch (error) {
          badSyntax.push(`${rel}: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
        }
      }
      if (!TEXT_EXT.has(ext)) continue;
      const text = readFileSync(path, 'utf8');
      for (const [pattern, token] of LEFTOVERS) {
        if (pattern.test(text)) {
          unshifted.push(`${rel} still carries \`${token}\``);
          break;
        }
      }
    }
    report(unshifted.length === 0, `no file in the copy still carries an unshifted token (${files.length} files)`,
      unshifted.slice(0, 5).join('\n        '));
    report(badSyntax.length === 0, `every generated JavaScript and JSON parses (${javascript} .js, ${json} .json)`,
      badSyntax.slice(0, 5).join('\n        '));
  }

  await verifyActivation(dir, pkg);
}

/**
 * Apply the copy's host half against a stub, the way `check-plugin-load.mjs` does, and look at
 * what it registers.
 *
 * This is the half of the identity that a text scan cannot see: the routes are built inside
 * `apply`, and a route that did NOT move would not be a leftover string — it would be a
 * working plugin fighting the real one over the same path. DSH's webserver throws on a
 * duplicate route, so the failure would look like "the dev pet never appeared".
 *
 * Every store the plugin resolves is redirected to a scratch directory FIRST: applying the
 * plugin constructs the settings store, which writes its file immediately, and a verification
 * script must never be one `apply` away from writing the operator's own profile.
 */
async function verifyActivation(dir, pkg) {
  const scratch = join(ROOT, 'build', 'probe-out', 'dev-package-smoke');
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  for (const [name, file] of [
    ['SETTINGS_FILE', 'settings.json'],
    ['MODEL_DIRS_FILE', 'model-dirs.json'],
    ['MOTION_DIRS_FILE', 'motion-dirs.json'],
    ['MODEL_FILES_FILE', 'model-files.json'],
    ['MOTION_IMPORTS_FILE', 'motion-imports.json'],
    ['SETUP_FILE', 'setup.json'],
  ]) process.env[`VRMPET3D_DEV_${name}`] = join(scratch, file);
  process.env.VRMPET3D_DEV_IMPORT_DIR = join(scratch, 'imported');

  try {
    // A cache-busting query, because this process may already have imported the SOURCE tree's
    // `lib/index.js` through some other script's import graph.
    const host = await import(`${pathToFileURL(join(dir, pkg.main)).href}?dev-package=${Date.now()}`);
    report(host.name === 'vrmpet3d-dev', 'the host half exports the dev service name', host.name);

    const provided = new Map();
    const effects = [];
    const logger = { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} };
    const ctx = {
      logger,
      get: (key) => (key === 'agents' ? { list: () => [], get: () => undefined, roots: () => [] } : undefined),
      provide: (key, value) => { provided.set(key, value); return () => provided.delete(key); },
      on: () => () => {},
      effect: (callback, label) => { const dispose = callback(); effects.push({ dispose, label }); return dispose; },
    };
    let activationError = null;
    try {
      host.apply(ctx, {});
    } catch (error) {
      activationError = error;
    }
    report(activationError === null, 'apply(ctx) activates without throwing',
      activationError && (activationError.stack || activationError.message));
    report(provided.has('vrmpet3d-dev'), 'it provides the dev service rather than the real one');

    /**
     * A web server that arrives AFTER activation must still be given the routes — the same
     * regression `check-plugin-load.mjs` pins, re-pinned here because it is also the only way
     * to see the route table without a running DSH.
     */
    const routes = [];
    let pending = null;
    const lateCtx = {
      logger,
      get: () => undefined,
      provide: () => () => {},
      on: () => () => {},
      effect: (callback) => { const dispose = callback(); effects.push({ dispose }); return dispose; },
      inject: (services, callback) => { pending = { services, callback }; return () => {}; },
    };
    try {
      host.apply(lateCtx, {});
    } catch (error) {
      report(false, 'an apply with no webServer still activates', error.message);
    }
    const webServer = { register: (route) => { routes.push(`${route.kind} ${route.path}`); return () => {}; } };
    pending?.callback({ webServer, get: (key) => (key === 'webServer' ? webServer : undefined), effect: (callback) => { callback(); return () => {}; } });

    const strays = routes.filter((route) => !route.includes(' /vrmpet3d-dev/'));
    report(routes.length > 0 && strays.length === 0,
      `every route it registers is under /vrmpet3d-dev/ (${routes.length} routes)`,
      strays.join(', ') || undefined);
    for (const wanted of ['exact /vrmpet3d-dev/catalog', 'prefix /vrmpet3d-dev/asset',
      'exact /vrmpet3d-dev/window', 'exact /vrmpet3d-dev/state', 'exact /vrmpet3d-dev/whale']) {
      report(routes.includes(wanted), `it registers ${wanted}`);
    }

    for (const { dispose } of effects.reverse()) if (typeof dispose === 'function') dispose();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// --check: rebuild somewhere else and compare
// ---------------------------------------------------------------------------
function compareTrees(built, existing) {
  const a = new Map(listFiles(built).map((rel) => [rel, hashOf(join(built, ...rel.split('/')))]));
  const b = new Map(listFiles(existing).map((rel) => [rel, hashOf(join(existing, ...rel.split('/')))]));
  const missing = [...a.keys()].filter((rel) => !b.has(rel));
  const extra = [...b.keys()].filter((rel) => !a.has(rel));
  const changed = [...a.keys()].filter((rel) => b.has(rel) && a.get(rel) !== b.get(rel));
  return { missing, extra, changed };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
console.log(`source:  ${ROOT}`);
console.log(`twin:    ${OUT}`);

if (CHECK) {
  if (!existsSync(OUT) || !existsSync(join(OUT, MARKER))) {
    fail(`no built twin at ${OUT} — run: node scripts/make-dev-package.mjs`);
  }
  const scratch = join(ROOT, 'build', '.dev-package-check');
  build(scratch);
  const drift = compareTrees(scratch, OUT);
  rmSync(scratch, { recursive: true, force: true });
  const stale = drift.missing.length + drift.extra.length + drift.changed.length;
  report(stale === 0, 'the built twin matches the current source',
    [
      drift.missing.length ? `not in the twin: ${drift.missing.slice(0, 5).join(', ')}` : '',
      drift.changed.length ? `stale: ${drift.changed.slice(0, 5).join(', ')}` : '',
      drift.extra.length ? `no longer in the source: ${drift.extra.slice(0, 5).join(', ')}` : '',
    ].filter(Boolean).join('\n        ')
    + (stale ? `\n        rebuild with: node scripts/make-dev-package.mjs` : ''));
  await verify(OUT);
} else {
  build(OUT);
  await verify(OUT);
  console.log(`\nthe copy: ${written} files written, ${linked} payload files hard-linked, ${remoteAccessors} remote accessors rewritten`);
  console.log('\nNext:');
  console.log(`  node scripts/install-desktop-plugin.mjs --package "${OUT}"`);
  console.log('  restart DSH if the twin is not composed already — measured 2026-10-16: a running app');
  console.log('  composed the new bundle on its own within seconds (routes answered, client half reported).');
  console.log('  Ask it: node scripts/live-check.mjs --dev   and   node scripts/check-profile.mjs --dev');
}

if (failures.length === 0) {
  console.log(`\ndev-package: ${passed} checks passed`);
  process.exit(0);
}
console.log(`\ndev-package: ${passed} passed, ${failures.length} FAILED`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);

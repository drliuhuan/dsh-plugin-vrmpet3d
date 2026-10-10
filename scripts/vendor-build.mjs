#!/usr/bin/env node
/**
 * Build `lib/client.vendor.js` — the lazy three.js + VRM + MMD chunk.
 *
 * Why a build step exists at all
 * ------------------------------
 * DSH serves a plugin's client half as ONE classic script (`lib/client.js`) that
 * calls `window.__ModuleLoader__.load({id, factory})`. The module system only
 * understands two kinds of extra dependency:
 *
 *   1. another installed plugin package declared in `dsh.client.external`, or
 *   2. a package-local *chunk*, requested as `require.async('./client.<name>.js')`
 *      and served from `/plugins/<id>/client.<name>.js`.
 *
 * npm packages are neither, and a CDN path is unavailable inside the app. So the
 * vendor graph is compiled ahead of time into one chunk that registers itself on
 * the module loader under a stable id. `lib/client.js` then asks the module
 * system for it, not the network. The build is reproducible from the versions
 * pinned in `vendor/package.json`; the compiled chunk is committed so the plugin
 * installs and runs with no toolchain present.
 *
 * The emitted chunk carries BOTH deliveries, and both are load-bearing:
 *
 *   * a `__ModuleLoader__.load({ chunk: 'client.vendor.js', factory })`
 *     registration, which is what makes `require.async('./client.vendor.js')`
 *     work in the app. The registration names `chunk`, not `id`: the loader
 *     derives the module-table key itself from the importing package
 *     (`chunkId(ownerId, chunk)`), so nothing here has to know the plugin's id.
 *   * the `globalThis.__VRMPET3D_VENDOR__` assignment written by `vendor/entry.js`,
 *     which the inline browser harnesses read. A plain `<script src>` path cannot
 *     work in the app — it loses the `?rev=` the server requires, and resolves
 *     against the plugin's combo URL rather than its per-package path.
 *
 * Usage:
 *   node scripts/vendor-build.mjs [--check] [--out <file>]
 *
 *   --check   fail if the committed chunk does not match a fresh build
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'vendor', 'entry.js');
const VENDOR_MODULES = join(ROOT, 'vendor', 'node_modules');
const DEFAULT_OUT = join(ROOT, 'lib', 'client.vendor.js');
const MANIFEST = join(ROOT, 'vendor', 'manifest.json');

/**
 * esbuild lives in the build-only `vendor/` workspace, not in the plugin's own
 * (deliberately empty) dependency tree, so resolve it from there explicitly.
 * The same anchor is handed to esbuild as `nodePaths` for `three` and friends.
 */
const vendorRequire = createRequire(join(ROOT, 'vendor', 'package.json'));
const { build } = vendorRequire('esbuild');

/** Stable module id of the vendored renderer graph (see vendor/entry.js). */
const VENDOR_MODULE_ID = 'dsh-plugin-vrmpet3d/vendor';

/**
 * The file name this chunk is delivered under. It has to match `CLIENT_CHUNK` in
 * DSH's client module system — `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` — or
 * the request is rejected before any URL is composed.
 */
const VENDOR_CHUNK = 'client.vendor.js';

/** The global `vendor/entry.js` assigns, which the harnesses read. */
const VENDOR_GLOBAL = '__VRMPET3D_VENDOR__';

/**
 * The owning package, which is the package name DSH resolves the plugin under.
 * Read from `package.json` rather than repeated, so the chunk's module id cannot
 * drift from the identity the loader keys it by.
 */
const OWNER_ID = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;

/**
 * The registration block appended to the compiled chunk.
 *
 * `id` is the FULL module-table key, `<package>/<fileName>`, and there must be no
 * `chunk` field beside it. The loader's `register` reads `registration.id`
 * unconditionally and only then treats `chunk` as an optional suffix:
 *
 *     const ownerId = stripClientSuffix(registration.id);   // throws on undefined
 *     const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
 *
 * so `{ chunk }` alone throws `Cannot read properties of undefined (reading
 * 'endsWith')`, and `{ id, chunk }` registers under the doubled key
 * `pkg/client.vendor.js/client.vendor.js`. Both were measured against the real
 * loader; this is the only shape that works.
 *
 * The block is appended (rather than written inside `vendor/entry.js`) so the
 * appended text is input to the hash: `--check` then fails on a changed
 * registration exactly as it does on changed vendored code.
 */
function vendorRegistration() {
  return [
    '',
    '// --- DSH client module registration (appended by scripts/vendor-build.mjs) ---',
    '// The id is the full module-table key: the loader reads it unconditionally, and',
    '// a `chunk` field beside it would append the file name a second time.',
    `if (typeof window !== 'undefined' && window.__ModuleLoader__ &&`,
    `    typeof window.__ModuleLoader__.load === 'function') {`,
    `  window.__ModuleLoader__.load({`,
    `    id: '${OWNER_ID}/${VENDOR_CHUNK}',`,
    '    factory: function () {',
    `      return globalThis.${VENDOR_GLOBAL};`,
    '    }',
    '  });',
    '}',
    '',
  ].join('\n');
}

/**
 * Fail loudly on the ways a chunk can be built but useless.
 *
 * `vendor/entry.js` is the only thing that assigns the global, and esbuild
 * tree-shakes whatever the entry does not list — so a rewritten entry is a
 * runtime `undefined` with no build error. A name outside `CLIENT_CHUNK` is never
 * requested at all, and a wrong owner id asks for a package that does not exist.
 */
function assertChunkShape(body) {
  if (!/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(VENDOR_CHUNK)) {
    throw new Error(`'${VENDOR_CHUNK}' does not match DSH's CLIENT_CHUNK pattern, so it would never be served`);
  }
  if (!body.includes(VENDOR_GLOBAL)) {
    throw new Error(`the compiled chunk does not publish globalThis.${VENDOR_GLOBAL} — check vendor/entry.js`);
  }
  if (!body.includes(`id: '${OWNER_ID}/${VENDOR_CHUNK}'`)) {
    throw new Error(`the compiled chunk does not register '${OWNER_ID}/${VENDOR_CHUNK}' on the module loader`);
  }
}

function parseArgs(argv) {
  const out = { check: false, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') out.check = true;
    else if (argv[i] === '--out') out.out = resolve(argv[++i]);
  }
  return out;
}

/** The exact versions that produced the committed chunk, for the manifest. */
function dependencyVersions() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'vendor', 'package.json'), 'utf8'));
  const versions = {};
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    try {
      versions[name] = JSON.parse(readFileSync(join(VENDOR_MODULES, name, 'package.json'), 'utf8')).version;
    } catch {
      versions[name] = null;
    }
  }
  return versions;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(ENTRY)) {
    console.error(`vendor entry missing: ${ENTRY}`);
    process.exit(1);
  }
  if (!existsSync(VENDOR_MODULES)) {
    console.error(
      'vendor dependencies are not installed.\n' +
        `  cd "${join(ROOT, 'vendor')}" && npm install\n` +
        'The committed chunk under lib/ still works; this install is only needed to rebuild it.',
    );
    process.exit(1);
  }

  const result = await build({
    entryPoints: [ENTRY],
    absWorkingDir: ROOT,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    // No minify: this ships inside a user's app, where a legible chunk is worth
    // more than the size, and the sources are already release builds.
    minify: false,
    legalComments: 'inline',
    // three's addons import bare "three"; resolve that to the pinned install.
    nodePaths: [VENDOR_MODULES],
    write: false,
    logLevel: 'warning',
  });

  const compiled = result.outputFiles[0].text;
  const banner =
    `// dsh-plugin-vrmpet3d — vendored 3D stack (generated by scripts/vendor-build.mjs; do not edit)\n` +
    `// three.js (MIT) + @pixiv/three-vrm (MIT) + @pixiv/three-vrm-animation (MIT)\n` +
    `// Bundled for ${VENDOR_MODULE_ID}; publishes globalThis.${VENDOR_GLOBAL} and registers\n` +
    `// itself as the client chunk '${VENDOR_CHUNK}' on window.__ModuleLoader__.\n`;
  const body = banner + compiled + vendorRegistration();
  assertChunkShape(body);
  const hash = createHash('sha256').update(body).digest('hex');

  const manifest = {
    moduleId: VENDOR_MODULE_ID,
    entry: 'vendor/entry.js',
    clientChunk: VENDOR_CHUNK,
    globalName: VENDOR_GLOBAL,
    output: args.out.startsWith(ROOT) ? args.out.slice(ROOT.length + 1).replace(/\\/g, '/') : args.out,
    sha256: hash,
    bytes: Buffer.byteLength(body),
    esbuild: JSON.parse(readFileSync(join(VENDOR_MODULES, 'esbuild', 'package.json'), 'utf8')).version,
    dependencies: dependencyVersions(),
  };

  if (args.check) {
    const current = existsSync(args.out) ? readFileSync(args.out, 'utf8') : null;
    if (current === null) {
      console.error(`vendor chunk missing: ${args.out}\n  run: node scripts/vendor-build.mjs`);
      process.exit(1);
    }
    // Shape before hash: a committed chunk that lost its registration is a
    // different failure from one that is merely out of date, and the hash
    // message alone would send a reader looking for a version bump.
    assertChunkShape(current);
    const currentHash = createHash('sha256').update(current).digest('hex');
    if (currentHash !== hash) {
      console.error(
        `vendor chunk is stale.\n  committed ${currentHash}\n  rebuilt   ${hash}\n  run: node scripts/vendor-build.mjs`,
      );
      process.exit(1);
    }
    console.log(`vendor chunk up to date (${manifest.bytes} bytes, sha256 ${hash.slice(0, 16)}…)`);
    console.log(`  delivered as chunk '${VENDOR_CHUNK}', still publishes globalThis.${VENDOR_GLOBAL}`);
    return;
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, body);
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${manifest.output} — ${manifest.bytes} bytes, sha256 ${hash.slice(0, 16)}…`);
  console.log(`  chunk '${VENDOR_CHUNK}' registered; globalThis.${VENDOR_GLOBAL} published`);
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    console.log(`  ${name}@${version ?? 'MISSING'}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

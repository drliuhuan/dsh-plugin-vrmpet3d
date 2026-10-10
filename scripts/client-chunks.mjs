#!/usr/bin/env node
/**
 * Generate the client half's own source chunks: `lib/client.core.js`,
 * `lib/client.placeholder.js` and `lib/client.scene.js`.
 *
 * Why this exists
 * ---------------
 * DSH's client module system serves a package-local *chunk* only when its file
 * name matches `CLIENT_CHUNK`:
 *
 *     const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
 *
 * `core.js`, `placeholder.js` and `pet3d.js` never match, so they were never
 * served, `globalThis.__PET3D_CORE__` / `__PET3D_SCENE__` were always undefined
 * in the real app, and the pet never appeared. That was the whole of the first
 * live-load failure, and no suite in this repository could see it because every
 * browser harness inlined the sources itself.
 *
 * The fix is to deliver them as real chunks, which needs each file to register
 * itself on the module loader. The registration carries the FULL module id,
 * `<package>/<fileName>`:
 *
 *     register(registration) {
 *       const ownerId = stripClientSuffix(registration.id);   // read unconditionally
 *       if (registration.chunk !== void 0 && !CLIENT_CHUNK.test(registration.chunk)) throw ...
 *       const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
 *
 * `id` is not optional and `chunk` is not a substitute for it: `chunk` is an
 * extra that gets APPENDED, so passing both yields `pkg/client.x.js/client.x.js`
 * and passing only `chunk` throws `Cannot read properties of undefined (reading
 * 'endsWith')`. All three shapes were measured against the real loader.
 *
 * What a generated chunk is
 * --------------------------
 *   1. the ORIGINAL source, byte for byte, so a failure is always traceable to
 *      `lib/<name>.js` and the tests still inline the originals;
 *   2. a two-line registration block that republishes the global that source
 *      already set as this chunk's module exports.
 *
 * The original stays the single source of truth: this file only copies it. The
 * `--check` mode fails when a copy has drifted, so a stale chunk can never ship
 * silently — the same contract `scripts/vendor-build.mjs --check` gives the
 * vendored 3D stack.
 *
 * Usage:
 *   node scripts/client-chunks.mjs [--check]
 *
 *   --check   fail if a committed chunk does not match its source
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The owning package. Also the key every chunk request is made under, so it has
 * to be the real package name; `assertOwnerId()` below fails the build if
 * `lib/client.js` disagrees.
 */
const OWNER_ID = 'dsh-plugin-pet3d';

/**
 * One entry per delivered chunk.
 *
 * `global` is the symbol the ORIGINAL source publishes and the registration
 * republishes. It is spelled out here rather than derived because a wrong value
 * would produce a chunk that loads cleanly and hands its consumer `undefined` —
 * exactly the class of silent failure this whole file exists to end. Both the
 * presence of the symbol in the source and its appearance in the output are
 * asserted below, so the table cannot drift from the code.
 */
const CHUNKS = [
  { source: 'lib/core.js', output: 'lib/client.core.js', global: '__PET3D_CORE__' },
  /**
   * `lib/placeholder.js` was delivered here until 2026-10-10, when the operator removed the built-in avatar
   * ("内置的占位模型还是没删掉，把Sample Model设为内置模型"). It is no longer shipped and no longer reachable:
   * `lib/client.js` does not load it, the host's source whitelist does not serve it, and the scene has no
   * fallback that builds one. The file itself stays in the tree as what the geometry suites inline directly —
   * the browser suite's framing and rendering checks need a model-free avatar, and deleting the only one would
   * gut those checks rather than improve them.
   */
  { source: 'lib/pet3d.js', output: 'lib/client.scene.js', global: '__PET3D_SCENE__' },
  /**
   * The right-click MENU, shared by both pets.
   *
   * `lib/desktop-page.html` loads `lib/menu.js` directly — the window is a page in the plugin's own launcher and
   * reads it from the host's source whitelist — while the app overlay can only load `client.<name>.js`, so the
   * app gets this generated copy of the SAME file. One definition, two delivery paths. It replaced
   * `lib/panel.js` on 2026-10-11: the two pets each had a settings PANEL, which is the debt one shared menu pays
   * instead (operator: 「内置桌宠和独立桌宠各自有一套设置，这样是不对的。删掉两个单独的设置面板。」). That file is
   * gone as of 2026-10-12 — it was left behind with no whitelist entry and no caller, which is the one state a
   * second definition must never be left in.
   */
  { source: 'lib/menu.js', output: 'lib/client.menu.js', global: '__PET3D_MENU__' },
];

/**
 * The registration block, appended verbatim.
 *
 * `id` MUST be `<owner>/<fileName>`, in full, and `chunk` must NOT also be
 * passed. The loader's `register` is not symmetric about this:
 *
 *     register(registration) {
 *       const ownerId = stripClientSuffix(registration.id);   // throws on undefined
 *       if (registration.chunk !== void 0 && !CLIENT_CHUNK.test(registration.chunk)) throw ...
 *       const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
 *
 * so `id` is read UNCONDITIONALLY and is what names the module, while `chunk` is
 * an optional extra that is appended to it — sending both produces the key
 * `pkg/client.x.js/client.x.js`, which nothing ever asks for. Sending only
 * `chunk` throws `Cannot read properties of undefined (reading 'endsWith')`,
 * which names neither the chunk nor the id. All three shapes were measured
 * against the real loader; this is the only one that works.
 *
 * The factory is lazy by construction: the loader only calls it when something
 * first imports the chunk, and the source script has already run by then, so the
 * global is set. It is also the module's export, which is what makes
 * `await require.async('./client.core.js')` resolve to the same object the old
 * global read produced.
 */
function registration(chunk) {
  const fileName = chunk.output.slice('lib/'.length);
  return [
    '',
    '// --- DSH client module registration (appended by scripts/client-chunks.mjs) ---',
    '// The id is the full module-table key. The loader reads it unconditionally,',
    '// so it cannot be omitted, and adding a `chunk` field as well would append the',
    '// file name a second time.',
    'if (typeof window !== \'undefined\' && window.__ModuleLoader__ &&',
    '    typeof window.__ModuleLoader__.load === \'function\') {',
    '  window.__ModuleLoader__.load({',
    `    id: '${OWNER_ID}/${fileName}',`,
    '    factory: function () {',
    `      return globalThis.${chunk.global};`,
    '    }',
    '  });',
    '}',
    '',
  ].join('\n');
}

/** Assert the generated file name is one the loader will accept at all. */
function assertChunkName(chunk) {
  const fileName = chunk.output.slice('lib/'.length);
  if (!/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(fileName)) {
    throw new Error(
      `${chunk.output} does not match DSH's CLIENT_CHUNK pattern, so it would never be ` +
      'served: expected client.<name>.js',
    );
  }
}

function banner(chunk) {
  return [
    `// dsh-plugin-pet3d — generated by scripts/client-chunks.mjs; do not edit.`,
    `//`,
    `// This is lib/${chunk.source.slice('lib/'.length)} verbatim, plus the DSH client module`,
    `// registration that makes it deliverable: only client.<name>.js files are served`,
    `// to the browser, so the source cannot be loaded under its own name.`,
    `//`,
    `// Edit lib/${chunk.source.slice('lib/'.length)}, not this file. Then run:`,
    `//   node scripts/client-chunks.mjs`,
    ``,
  ].join('\n');
}

/** The exact committed body a fresh generation must reproduce. */
function render(chunk) {
  assertChunkName(chunk);
  const source = readFileSync(join(ROOT, chunk.source), 'utf8');
  if (!source.includes(chunk.global)) {
    throw new Error(
      `${chunk.source} does not publish ${chunk.global}; the chunk table in ` +
      `scripts/client-chunks.mjs is stale`,
    );
  }
  return banner(chunk) + source.replace(/\s*$/, '\n') + registration(chunk);
}

/**
 * The owner id is written into every generated chunk AND used by `lib/client.js`
 * to key its `require.async` requests, which DSH composes as
 * `/plugins/<id>/<file>?rev=…`. Two spellings of it must agree, and both must be
 * the package name: a mismatch asks for a package that does not exist, and the
 * only symptom is a chunk that never arrives.
 *
 * @returns {string|null} the problem, or null when all three agree.
 */
function ownerIdMismatch() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (OWNER_ID !== pkg.name) {
    return `scripts/client-chunks.mjs generates chunks owned by '${OWNER_ID}' but the package is '${pkg.name}'`;
  }
  const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
  const declared = /var\s+PLUGIN_ID\s*=\s*'([^']*)'/.exec(client);
  if (!declared) {
    return 'lib/client.js no longer declares PLUGIN_ID, which its chunk requests are keyed by';
  }
  if (declared[1] !== pkg.name) {
    return `lib/client.js registers as '${declared[1]}' but the package is '${pkg.name}'`;
  }
  return null;
}

function main() {
  const check = process.argv.includes('--check');
  const idProblem = ownerIdMismatch();
  const results = [];
  let stale = 0;
  let drift = 0;

  for (const chunk of CHUNKS) {
    const expected = render(chunk);
    const path = join(ROOT, chunk.output);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const expectedHash = createHash('sha256').update(expected).digest('hex');

    if (check) {
      if (current === null) {
        console.error(`client chunk missing: ${chunk.output}`);
        console.error('  run: node scripts/client-chunks.mjs');
        stale += 1;
        continue;
      }
      const currentHash = createHash('sha256').update(current).digest('hex');
      if (currentHash !== expectedHash) {
        console.error(
          `client chunk is stale: ${chunk.output}\n` +
          `  committed ${currentHash}\n` +
          `  rebuilt   ${expectedHash}\n` +
          '  run: node scripts/client-chunks.mjs',
        );
        stale += 1;
        continue;
      }
      results.push(`${chunk.output} up to date (${Buffer.byteLength(current)} bytes, sha256 ${currentHash.slice(0, 16)}…)`);
      continue;
    }

    if (current !== expected) {
      writeFileSync(path, expected);
      drift += 1;
    }
    results.push(`${chunk.output} — ${Buffer.byteLength(expected)} bytes, sha256 ${expectedHash.slice(0, 16)}…${current === expected ? ' (unchanged)' : ''}`);
  }

  for (const line of results) console.log(line);

  if (check) {
    if (idProblem) {
      console.error(`\nclient chunk ownership: ${idProblem}`);
      process.exit(1);
    }
    if (stale > 0) {
      console.error(`\nclient chunks: ${stale} of ${CHUNKS.length} are stale or missing`);
      process.exit(1);
    }
    console.log(`\nclient chunks up to date (${CHUNKS.length} of ${CHUNKS.length}); owner id matches the package name`);
    return;
  }

  if (idProblem) throw new Error(idProblem);
  console.log(`\nwrote ${CHUNKS.length} client chunks (${drift} changed) from ${CHUNKS.map(c => relative(ROOT, join(ROOT, c.source))).join(', ')}`);
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
}

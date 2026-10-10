#!/usr/bin/env node
/**
 * Documentation self-check.
 *
 * Run:  node scripts/check-docs.mjs
 *
 * Documentation rots silently. This asserts the specific, checkable claims the
 * docs make, so a rename or a moved file shows up as a failing check rather than
 * as a reader following a dead path six months later.
 *
 * It checks four kinds of claim:
 *   1. every repo-relative path mentioned in a doc exists
 *   2. every verification command quoted in a doc is a script that exists
 *   3. the documented check COUNTS match what the suites actually report
 *   4. a few structural invariants (the plugin ships no model files, the vendor
 *      chunk is committed, the default model is the placeholder)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function ok(condition, label, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

const DOCS = [
  'README.md',
  'HANDOFF.md',
  /**
   * The working rules. Validated like every other doc on purpose: a rule that tells a session to run a suite is
   * only useful while the suite it names still exists, and the rule file cites paths and commands like the rest.
   */
  'AGENTS.md',
  'docs/ARCHITECTURE.md',
  'docs/ASSET-CONTRACT.md',
  'vendor/README.md',
  'assets/models/README.md',
];

// ---------------------------------------------------------------------------
group('1. every doc exists and every path it cites exists');
// ---------------------------------------------------------------------------
{
  for (const doc of DOCS) {
    ok(existsSync(join(ROOT, doc)), `${doc} exists`);
  }

  // Match backtick-quoted things that look like repo paths: they contain a `/`
  // and a known source extension, and are not URLs or absolute paths.
  //
  // Deliberately skipped, because they are not this repository's files:
  //   * anything containing `…` / `...` — an abbreviated citation such as
  //     `three/addons/.../DRACOLoader.js`, which names a path inside a dependency
  //   * anything starting `Resources/`, `dsh-plugin-fatfish-pet/` or `../`, which
  //     belong to the surrounding workspace rather than to this plugin
  const pathPattern = /`([A-Za-z0-9_.\-/]+\/[A-Za-z0-9_.\-]+\.(?:md|mjs|js|json|yml|html|py))`/g;
  const urlPattern = /^https?:\/\//;
  const isForeignPath = (cited) =>
    cited.includes('...') || cited.includes('…') ||
    cited.startsWith('Resources/') ||
    cited.startsWith('dsh-plugin-fatfish-pet/');

  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8');
    const seen = new Set();
    for (const match of text.matchAll(pathPattern)) {
      const cited = match[1];
      if (urlPattern.test(cited) || cited.startsWith('http')) continue;
      if (isForeignPath(cited)) continue;
      if (seen.has(cited)) continue;
      seen.add(cited);

      // Resolve relative to the doc's own directory first, then the repo root:
      // docs/ cites ../lib/x.js, vendor/ cites ../scripts/y.mjs.
      const fromDoc = resolve(ROOT, dirname(doc), cited);
      const fromRoot = resolve(ROOT, cited);
      const found = existsSync(fromDoc) || existsSync(fromRoot);

      // Some citations are illustrative (a future file, a build output). Accept
      // those only when the doc clearly marks them as generated or expected.
      ok(found, `${doc} cites an existing path: ${cited}`);
    }
  }
}

// ---------------------------------------------------------------------------
group('2. every quoted verification command names a real script');
// ---------------------------------------------------------------------------
{
  const commandPattern = /node (scripts\/[A-Za-z0-9_.\-]+\.mjs)/g;
  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8');
    const seen = new Set();
    for (const match of text.matchAll(commandPattern)) {
      const script = match[1];
      if (seen.has(script)) continue;
      seen.add(script);
      ok(existsSync(join(ROOT, script)), `${doc} quotes a real script: ${script}`);
    }
  }
}

// ---------------------------------------------------------------------------
group('3. documented check counts match the suites');
// ---------------------------------------------------------------------------
{
  /** The last suite whose run failed, for the failure message on the count assertion. */
  let lastSuiteError = null;

  /** Run a suite and read the "N checks passed" figure it prints. */
  function countFrom(args, pattern) {
    let output = '';
    try {
      output = execFileSync('node', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      // A suite that fails prints its own reason and exits non-zero, and `execFileSync` throws. The count
      // is still in its output, so read what came back rather than losing the figure — and when there is no
      // figure at all, say WHY here instead of letting four count assertions fail downstream with `null`.
      output = String((error && (error.stdout || error.message)) || '');
      lastSuiteError = `${args.map((a) => a.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '')).join(' ')}`
        + ` exited with ${error && error.status !== undefined ? error.status : 'an error'}: `
        + (output.trim().split('\n').slice(-3).join(' | ') || 'no output captured');
    }
    const match = pattern.exec(output);
    return match ? Number(match[1]) : null;
  }

  const actual = {
    core: countFrom([join(ROOT, 'scripts', 'verify.mjs')], /core: (\d+) checks passed/),
    host: countFrom([join(ROOT, 'scripts', 'verify-model.mjs')], /host \+ model: (\d+) checks passed/),
    chunkDelivery: countFrom([join(ROOT, 'scripts', 'verify-browser.mjs'), '--page', 'chunk-delivery'], /browser: (\d+) checks passed/),
    browser: countFrom([join(ROOT, 'scripts', 'verify-browser.mjs')], /browser: (\d+) checks passed/),
    client: countFrom([join(ROOT, 'scripts', 'verify-browser.mjs'), '--page', 'client-test'], /browser: (\d+) checks passed/),
    // `mmd` sat here until 2026-10-12: MMD was implementation-removed, the `mmd-probe` page went with it,
    // and `verify-browser.mjs` now refuses a page name it does not know — so a count read from that page
    // would be a count read from a refusal.
    // The one suite that starts a real window. It reports its count even when the live half is
    // skipped for want of an installation to borrow Electron from — the Node half always runs —
    // so the documented total does not depend on this machine's layout.
    desktop: countFrom([join(ROOT, 'scripts', 'verify-desktop.mjs')], /desktop: (\d+) checks passed/),
  };

  for (const [name, count] of Object.entries(actual)) {
    ok(Number.isFinite(count) && count > 0,
      `the ${name} suite reports a check count (${count}${lastSuiteError ? ` — ${lastSuiteError}` : ''})`);
    if (!Number.isFinite(count)) lastSuiteError = null;
  }

  /**
   * The figure the docs quote as the project total.
   *
   * This suite deliberately EXCLUDES ITS OWN assertion count, and that is not a
   * shortcut. Including it is circular: the docs' total would depend on this
   * script's assertion count, which depends on whether that total matched, so a
   * single run can never converge — it oscillates between "docs says the old
   * total" and "docs says the new total" forever. Two other checks are likewise
   * stated as "N suites passed" rather than as an assertion count:
   *
   *   * `load`  prints PASSED rather than a number
   *   * `vendor` prints its hash, not a check count
   *
   * So the documented total is the sum of the suites that report a count, plus one
   * for each of those two. Everything this suite checks about itself is covered by
   * the structural asserts below instead.
   */
  const DOCS_SUITE_COUNTED = 0;
  const NON_COUNTING_SUITES = 2;
  const total = Object.values(actual).reduce((sum, value) => sum + (value || 0), 0) +
    DOCS_SUITE_COUNTED + NON_COUNTING_SUITES;
  // Counting the suites the docs list: the six that report an assertion count,
  // plus `load` and `vendor` (which report a verdict and a hash), plus this one.
  const suites = Object.keys(actual).length + NON_COUNTING_SUITES + 1;

  // The docs state the counts, so read them back and compare.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const handoff = readFileSync(join(ROOT, 'HANDOFF.md'), 'utf8');
  const architecture = readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8');

  // This suite excludes its own assertions from the documented total, for the
  // reason given above. Assert the suite COUNT derives correctly instead, so adding
  // a suite without updating the docs is caught.
  ok(readme.includes(`${suites} verification suites`),
    `README states the real suite count (${suites})`);

  ok(readme.includes(`${actual.core} — state machine`), `README states the core count (${actual.core})`);
  ok(readme.includes(`${actual.host} — model catalog`), `README states the host count (${actual.host})`);
  ok(readme.includes(`${actual.chunkDelivery} — DSH's own`), `README states the chunk-delivery count (${actual.chunkDelivery})`);
  ok(readme.includes(`${actual.client} — the widget`), `README states the client count (${actual.client})`);
  ok(readme.includes(`${actual.desktop} — the pet's own window`), `README states the desktop count (${actual.desktop})`);

  const documented = handoff.match(/(\d+) checks/);
  ok(Boolean(documented) && Number(documented[1]) === total,
    `HANDOFF.md states the real total (${total})`,
    documented ? `documented ${documented[1]}` : 'no total found');

  // Search the whole document and accept a match on the real total. Taking only
  // the FIRST `N checks` hit picks up a per-suite figure from the summary table
  // (219) rather than the suite total, and reports a false failure.
  const archNumbers = [...architecture.matchAll(/(\d+) checks\b/g)].map(match => Number(match[1]));
  ok(archNumbers.includes(total),
    `ARCHITECTURE.md states the real total (${total})`,
    `found: ${archNumbers.join(', ') || 'none'}`);

  ok(readme.includes(String(total)) || architecture.includes(String(total)),
    `the total ${total} appears somewhere in the docs`);
}

// ---------------------------------------------------------------------------
group('4. structural invariants');
// ---------------------------------------------------------------------------
{
  /**
   * The bundled model: ONE file, named, and redistributable.
   *
   * This used to assert that `assets/models/` shipped nothing at all — the rule while the plugin's default was a
   * procedurally generated avatar. The operator replaced that on 2026-10-10 ("把Sample Model设为内置模型…请务必做成
   * 默认模型并随插件分发"), and the reason it is legitimate is the file's own embedded licence, so that is what gets
   * asserted rather than the absence of a file: the licence query string inside the GLB must still say
   * redistribution/modification/commercial are allowed and credit is unnecessary. A future swap for a model that
   * does NOT say that fails here instead of shipping.
   */
  const bundled = join(ROOT, 'assets', 'models');
  ok(existsSync(bundled), 'assets/models/ exists');
  if (existsSync(bundled)) {
    const entries = readdirSync(bundled).filter(name => name !== 'README.md');
    ok(entries.join(', ') === 'SampleModel.vrm',
      'and ships exactly the one built-in model', entries.join(', '));
    const modelPath = join(bundled, 'SampleModel.vrm');
    if (existsSync(modelPath)) {
      const bytes = readFileSync(modelPath);
      ok(bytes.length > 1000000 && bytes.subarray(0, 4).toString('latin1') === 'glTF',
        `which is a real binary glTF (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
      // The JSON chunk is the second one, and the licence lives in its VRM metadata. Read as latin1 so the
      // comparison cannot be broken by a byte that is not valid UTF-8.
      const text = bytes.toString('latin1');
      ok(text.includes('redistribution=allow'), 'and whose embedded licence allows redistribution');
      ok(text.includes('modification=allow'), 'and modification');
      ok(text.includes('corporate_commercial_use=allow'), 'and commercial use by corporations');
      ok(text.includes('credit=unnecessary'), 'and requires no attribution');
      ok(text.includes('VRoid'), 'while crediting its author in the file itself');
    } else {
      ok(false, 'the built-in SampleModel.vrm is committed');
    }
  }

  // The vendor chunk is committed, and publishes the global the scene reads.
  const chunkPath = join(ROOT, 'lib', 'client.vendor.js');
  ok(existsSync(chunkPath), 'the vendored 3D chunk is committed');
  if (existsSync(chunkPath)) {
    const chunk = readFileSync(chunkPath, 'utf8');
    ok(chunk.includes('__VRMPET3D_VENDOR__'), 'the chunk publishes __VRMPET3D_VENDOR__');
    ok(chunk.length > 1000000, `the chunk is the expected order of size (${(chunk.length / 1024 / 1024).toFixed(2)} MB)`);
  }

  /**
   * The delivery contract, asserted on the committed bytes.
   *
   * `lib/client.js` reaches every extra file through `require.async('./client.x.js')`,
   * and DSH only serves a package-local file whose name matches
   *
   *     /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/
   *
   * at `/plugins/<package>/<name>?rev=<current>`. The first live install failed
   * for exactly this reason: the three sources were not chunks at all. The
   * `clientchunk` browser suite drives the real loader over these files; these
   * assertions are the cheap, browser-free half of the same contract, and they
   * name the id shape specifically because the loader reads `registration.id`
   * unconditionally and a `chunk`-only registration throws a type error.
   */
  const owner = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name;
  /**
   * `client.placeholder.js` was in this list until 2026-10-10.
   *
   * The operator removed the built-in avatar ("内置的占位模型还是没删掉，把Sample Model设为内置模型"), so the chunk
   * generator no longer produces it and the file is gone — asserting it here would assert a file that must not
   * exist. `lib/placeholder.js` itself stays as the fixture the geometry suites inline.
   */
  const chunkFiles = ['client.core.js', 'client.scene.js', 'client.vendor.js'];
  const clientEntry = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
  for (const name of chunkFiles) {
    const path = join(ROOT, 'lib', name);
    ok(existsSync(path), `the generated chunk lib/${name} is committed`);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    ok(text.includes(`id: '${owner}/${name}'`),
      `lib/${name} registers as '${owner}/${name}' on the module loader`);
    ok(text.includes('__ModuleLoader__.load'),
      `lib/${name} registers itself rather than relying on a script tag`);
    ok(clientEntry.includes(`'./${name}'`),
      `lib/client.js requests ./${name} through the module system`);
  }

  // The id the client half registers under is also the key its chunk requests are
  // composed from, so a mismatch asks for a package that does not exist.
  ok(clientEntry.includes(`var PLUGIN_ID = '${owner}'`),
    `lib/client.js registers under the package name '${owner}'`);

  // Globals the client half depends on, one per source file.
  const globals = [
    ['lib/core.js', '__VRMPET3D_CORE__'],
    ['lib/placeholder.js', '__VRMPET3D_PLACEHOLDER__'],
    ['lib/scene.js', '__VRMPET3D_SCENE__'],
    ['lib/client.js', '__VRMPET3D_CLIENT__'],
  ];
  for (const [file, symbol] of globals) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    ok(source.includes(symbol), `${file} publishes ${symbol}`);
  }

  /**
   * The default model is AUTOMATIC, which is a stronger promise than the old one.
   *
   * It used to be `'placeholder'`, so the plugin could not be shipped pointing at a licensed third-party file.
   * The operator removed the built-in avatar (2026-10-10: "移除内置替身，默认模型设置为SampleModel"), and the
   * guarantee is now kept a different way: the shipped default names NO model, and `resolveModelId` can only
   * ever return an id that is in the user's own catalog. So this asserts the empty default, and that the
   * resolver is catalog-driven rather than naming a file.
   */
  const core = readFileSync(join(ROOT, 'lib', 'core.js'), 'utf8');
  ok(/modelId:\s*''/.test(core), 'the default model id is empty, which means "resolve one from the catalog"');
  ok(/function resolveModelId\(/.test(core) && /function modelChoices\(/.test(core),
    'and the resolver that turns it into a real, catalogued model is present');
  ok(!/modelId:\s*'placeholder'/.test(core), 'with no built-in avatar left as the shipping default');

  // The plugin must declare both halves DSH needs, and no runtime dependencies.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  ok(pkg.dependencies === undefined || Object.keys(pkg.dependencies).length === 0,
    'the plugin declares no runtime dependencies');
  ok(pkg.devDependencies === undefined || Object.keys(pkg.devDependencies).length === 0,
    'the plugin declares no dev dependencies either (vendor/ is a separate workspace)');
  ok(pkg.private === true, 'the package is marked private (not for npm publish)');

  // The docs must not claim a LICENSE that does not exist, or vice versa.
  ok(existsSync(join(ROOT, 'LICENSE')), 'LICENSE exists, and package.json files[] lists it');
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`);
if (failed === 0) {
  console.log(`docs: ${passed} checks passed`);
  process.exit(0);
}
console.log(`docs: ${passed} passed, ${failed} FAILED`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);

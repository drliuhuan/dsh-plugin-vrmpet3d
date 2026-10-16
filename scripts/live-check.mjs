#!/usr/bin/env node
/**
 * Is the RUNNING app serving the current code?
 *
 * The suites prove what the tree does; they cannot see the app the operator is looking at. This asks it directly,
 * over HTTP, and it exists because of the failure mode that cost this project the most time: the host half is NOT
 * hot-reloaded, so a change can be green in every suite and simply absent from the pet on screen — and the first
 * symptom is a route answering 404 or a page script that is one revision behind.
 *
 * What is checked, all of it from the RUNNING process (under the selected prefix, `/vrmpet3d`):
 *   * the guide's own routes (`<prefix>/setup-state`, `<prefix>/setup`) and what its state file says;
 *   * the page sources the two settings pages and the guide actually fetch (`<prefix>/window/lib/<name>`), each
 *     against a marker that only exists in the current revision — so "the app is current" is a fact and not a hope;
 *   * 通用设置's 其他 section, which is where 重新运行引导 lives.
 *
 * The DELIVERED CHUNKS (`lib/client.core.js`, `lib/client.scene.js`, `lib/client.menu.js`) are not fetched here:
 * DSH's own module loader serves them from its asset route, not from this plugin's, so their freshness is what
 * `node scripts/client-chunks.mjs --check` proves — a build assertion rather than an HTTP one.
 *
 * Usage:
 *   node scripts/live-check.mjs                # the app on 127.0.0.1:19387
 *   node scripts/live-check.mjs --port 1234    # another port
 *   node scripts/live-check.mjs --dev          # the DEV TWIN's routes (/vrmpet3d-dev/...)
 *   VRMPET3D_PORT=1234 node scripts/live-check.mjs
 *
 * `--dev` exists because two plugins may now be composed at once: the released one
 * (`dsh-plugin-vrmpet3d`) and the generated twin (`dsh-plugin-vrmpet3d-dev`, see
 * `scripts/make-dev-package.mjs`). They are two halves of one running app and two
 * independent route prefixes, so "the app is serving the current code" is a different
 * question about each — and the same assertion, asked twice.
 *
 * Non-zero exit when anything is missing, so it can be chained.
 */
const argv = process.argv.slice(2);
const PORT = (() => {
  const at = argv.indexOf('--port');
  if (at !== -1 && argv[at + 1]) return argv[at + 1];
  return process.env.VRMPET3D_PORT || '19387';
})();
const BASE = `http://127.0.0.1:${PORT}`;
const PREFIX = argv.includes('--dev') ? '/vrmpet3d-dev' : '/vrmpet3d';

async function get(path) {
  try {
    const response = await fetch(BASE + path);
    return { status: response.status, body: response.ok ? await response.text() : '' };
  } catch (error) {
    return { status: 0, body: '', error: error.message };
  }
}

/**
 * Each marker is a string that exists ONLY in the current revision of that file.
 *
 * A bare 200 is not enough: a stale page script answers 200 with the old code, which is exactly the state this
 * check exists to catch.
 */
const CHECKS = [
  [`${PREFIX}/setup-state`, '"completed"', 'the host serves the first-run guide\'s own state'],
  [`${PREFIX}/setup`, 'setup-page.js', 'and serves the guide page itself'],
  /**
   * The motion-state expression, and it is pinned by its CURRENT shape: `dancing` was appended to
   * `STATUS_STATES.concat(INTERACTION_STATES)` (six status states + three interaction ones), and the
   * old marker had been answering MISS for every checkout that carried it — a false alarm for a tool
   * whose whole job is to tell a stale app from a current one.
   */
  [`${PREFIX}/window/lib/core.js`, "STATUS_STATES.concat(INTERACTION_STATES, ['dancing'])",
    'the served core derives the ten motion states from both families, dancing included'],
  [`${PREFIX}/window/lib/scene.js`, 'computeBoundingBox',
    'the served scene refreshes the skin bounds on every press'],
  [`${PREFIX}/window/lib/config-page.js`, '拖动中', 'the served panel labels the pointer poses'],
  [`${PREFIX}/window/lib/setup-page.js`, 'setup-state', 'the served guide script writes its own state'],
  // The model picker (2026-10-13): 切换模型's page and the ONE component it shares with the guide's ② 偏好模型 step.
  [`${PREFIX}/picker`, 'model-picker.js', "the served app has 切换模型's page, built from the shared picker"],
  [`${PREFIX}/window/lib/model-picker.js`, 'createModelPicker',
    'and serves that component to both the picker page and the guide'],
  [`${PREFIX}/window/lib/setup-page.js`, 'setup-model-picker', "with the guide's ② 偏好模型 step mounting it"],
  [`${PREFIX}/global`, 'settings-7', '通用设置 has the 其他 section (重新运行引导)'],
];

async function main() {
  console.log(`prefix: ${PREFIX}`);
  const rows = [];
  for (const [path, marker, label] of CHECKS) {
    const answer = await get(path);
    rows.push({ path, status: answer.status, found: answer.body.includes(marker), label, error: answer.error });
  }

  const state = await get(`${PREFIX}/setup-state`);
  let setup = null;
  try { setup = JSON.parse(state.body); } catch { /* not JSON: reported as null below */ }

  for (const row of rows) {
    console.log(`  ${row.found && row.status === 200 ? 'pass' : 'MISS'}  ${row.path}  ${row.label}`
      + (row.error ? `  (${row.error})` : row.status === 200 ? '' : `  (HTTP ${row.status})`));
  }
  console.log(`\n  setup state: ${setup
    ? `completed=${setup.completed} prompted=${setup.prompted} file=${setup.file}`
    : '(no JSON answer)'}`);

  const missing = rows.filter((row) => !row.found || row.status !== 200);
  console.log(missing.length
    ? `\nlive-check ${PREFIX}: ${missing.length} of ${rows.length} MISSING — the app is not serving the current code`
    : `\nlive-check ${PREFIX}: all ${rows.length} present, and the guide's state answered`);
  process.exit(missing.length ? 1 : 0);
}

main();

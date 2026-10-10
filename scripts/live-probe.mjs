#!/usr/bin/env node
/**
 * Probe a *running* DSH app's own plugin routes.
 *
 * Run:  node scripts/live-probe.mjs [--id-race] [--add <dir>] [--asset <modelId>]
 *
 * Why this exists: every other suite in this repository tests the code, not the
 * running app. This is the one script that answers "is this plugin live in the app
 * I am looking at?" — the pet's own routes are reachable over loopback without the
 * auth the index needs (`/` answers 401, `/vrmpet3d/catalog` answers 200), so a single
 * request settles questions that otherwise need a screenshot:
 *
 *   * did the host half activate at all (a 404 here means it did not, or that its
 *     `webServer.register` calls never ran — see the `ctx.inject` note in §4 of
 *     HANDOFF.md);
 *   * what does the model catalog actually contain right now;
 *   * does a model id still resolve after another catalog read (`--id-race`; the
 *     property that was broken, see §11 of HANDOFF.md).
 *
 * It writes nothing except with `--add`, which goes through the plugin's own
 * `/vrmpet3d/models` route and therefore persists the imported list exactly as the
 * settings panel would.
 *
 * The URL comes from `DSH_WEB_URL` (set for every DSH shell), so a second app
 * instance on another port needs no flag.
 */
const base = process.env.DSH_WEB_URL || 'http://127.0.0.1:19387';
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function get(path) {
  const response = await fetch(base + path);
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* a non-JSON body is reported as text */ }
  return { status: response.status, headers: response.headers, text, payload };
}

console.log(`app: ${base}`);

const added = argOf('--add');
if (added) {
  const response = await fetch(base + '/vrmpet3d/models', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ add: added }),
  });
  console.log(`\nPOST /vrmpet3d/models {add: ${added}} -> ${response.status}`);
  console.log('  ' + (await response.text()));
}

for (const path of ['/vrmpet3d/catalog', '/vrmpet3d/motions', '/vrmpet3d/models']) {
  const result = await get(path);
  console.log(`\nGET ${path} -> ${result.status}`);
  console.log('  ' + JSON.stringify(result.payload ?? result.text.slice(0, 200)));
}

const assetId = argOf('--asset');
if (assetId) {
  const response = await fetch(`${base}/vrmpet3d/asset?m=${encodeURIComponent(assetId)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  console.log(`\nGET /vrmpet3d/asset?m=${assetId} -> ${response.status}`);
  console.log(`  ${bytes.length} bytes, content-type ${response.headers.get('content-type')}`);
}

if (args.includes('--id-race')) {
  // Exactly what the page does on mount (lib/client.js: refreshCatalog() then
  // loadModel(preferences.modelId)), with the extra catalog read a settings-panel
  // visit adds. Every `/vrmpet3d/catalog` request rebuilds the store, so an id read
  // first must still stream its file afterwards.
  const first = await get('/vrmpet3d/catalog');
  const id = first.payload?.models?.[0]?.id;
  if (id === undefined) {
    console.log('\n--id-race: no model in the catalog, nothing to race');
  } else {
    const served = await get(`/vrmpet3d/asset?m=${id}`);
    console.log(`\n1. catalog                -> id ${id}`);
    console.log(`2. asset                  -> ${served.status}`);
    const second = await get('/vrmpet3d/catalog');
    console.log(`3. catalog again          -> id ${second.payload?.models?.[0]?.id} (rebuilds the store)`);
    const afterRebuild = await get(`/vrmpet3d/asset?m=${id}`);
    console.log(`4. asset with step 1's id -> ${afterRebuild.status} ${afterRebuild.text.slice(0, 120)}`);
    console.log(afterRebuild.status === 200
      ? '\nid-race: PASS (a model id survives a catalog rebuild)'
      : '\nid-race: FAIL (the running app still has the pre-fix host half; see HANDOFF.md §11)');
  }
}

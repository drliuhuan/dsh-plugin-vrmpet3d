#!/usr/bin/env node
/**
 * Is the plugin actually WIRED INTO the profile, and is it LIVE in the running app?
 *
 * Run:  node scripts/check-profile.mjs [--profile <dir>] [--no-http]
 *
 * ## Why this exists
 *
 * Measured on 2026-10-10, and it cost the operator the pet: the running DSH app WRITES the profile back to
 * disk — `package.json` and the materialised `cordis.yml` — from whatever composition it holds in memory,
 * and a bundle its in-memory tree does not know about is dropped on the way out. The plugin had been
 * disabled in the manager, the host rewrote the profile at 16:13:50, and `dsh-plugin-vrmpet3d` was gone from
 * `dsh.profile.bundles`. On the NEXT restart the plugin was simply not composed: no pet, no `/vrmpet3d/*`
 * routes, nothing to look at. "插件挂了" was, exactly, "the profile forgot it".
 *
 * Every other check in this repository starts from the SOURCE TREE and therefore cannot see this: the code
 * is perfect and the profile is empty. This script checks the two things that are outside the tree —
 *
 *   1. THE PROFILE: the package is a dependency, it is listed in `dsh.profile.bundles`, and the symlink
 *      under the profile's `node_modules` resolves to this checkout;
 *   2. THE RUNNING APP: the plugin's own routes answer over loopback. `/vrmpet3d/state` speaks first because it
 *      can distinguish three very different failures in one request — 404 means the host half is not
 *      composed, a 200 with `state: null` and no `error` means the host is up but the CLIENT half has not
 *      run (the page needs a reload, or the client bundle failed), and a non-null `error` is the client
 *      half's own report of why it could not start.
 *
 * Exit code is 0 when the profile is correct, 1 when it needs `scripts/install-desktop-plugin.mjs`, and 2
 * when only the running app disagrees (a restart or a page reload is what is missing, not a repair).
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const profileDir = resolve(argOf('--profile')
  ?? process.env.DSH_PROFILE_DIR
  ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'desktop'));
const skipHttp = args.includes('--no-http');
const base = process.env.DSH_WEB_URL || 'http://127.0.0.1:19387';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NAME = pkg.name;

let passed = 0;
const failures = [];
const notes = [];
function report(ok, label) {
  if (ok) { passed += 1; console.log(`  pass  ${label}`); }
  else { failures.push(label); console.error(`  FAIL  ${label}`); }
}

console.log(`plugin:  ${ROOT}`);
console.log(`profile: ${profileDir}\n`);

// ---------------------------------------------------------------------------------------------
// 1. The profile
// ---------------------------------------------------------------------------------------------
const manifestPath = join(profileDir, 'package.json');
if (!existsSync(manifestPath)) {
  console.error(`  FAIL  no profile manifest at ${manifestPath}`);
  console.error('\nPoint --profile at a DSH profile directory.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const bundles = manifest?.dsh?.profile?.bundles;
const declared = manifest?.dependencies?.[NAME];

report(Array.isArray(bundles), 'the profile declares a bundle list');
/**
 * The check that would have caught it.
 *
 * `dependencies` alone is NOT enough: the plugin declares `dsh.bundle.patch`, so it only joins the
 * composition through the bundle list. A profile with the dependency and without the bundle is exactly the
 * state a manager-written profile was left in, and the plugin does not load from it.
 */
report(Array.isArray(bundles) && bundles.includes(NAME),
  `${NAME} is listed in dsh.profile.bundles (the one that matters)`);
report(typeof declared === 'string' && declared.length > 0,
  `${NAME} is a declared dependency${declared ? ` (${declared})` : ''}`);
if (typeof declared === 'string' && declared.startsWith('link:')) {
  const target = resolve(declared.slice('link:'.length));
  report(target === ROOT, `the dependency links to THIS checkout (${target})`);
}
const linkPath = join(profileDir, 'node_modules', ...NAME.split('/'));
report(existsSync(linkPath), `the profile's node_modules resolves ${NAME}`);
if (existsSync(linkPath)) {
  try {
    const real = realpathSync(linkPath);
    report(resolve(real) === ROOT, `and it points at this checkout (${real})`);
  } catch (error) {
    report(false, `the link could be read (${error.message})`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. The running app
// ---------------------------------------------------------------------------------------------
/**
 * How many checks failed BEFORE the app was probed, i.e. inside the profile itself.
 *
 * The verdict at the bottom turns on this number rather than on `failures.length`, and that is a fix, not a
 * detail. On 2026-10-09 the profile had just been repaired while the app was still running the composition it
 * booted with, so `/vrmpet3d/catalog` answered 404 — and this script then reported "profile wiring: 1 FAILED,
 * repair it with install-desktop-plugin.mjs", pointing the operator at a repair that was already done. What
 * was actually missing was a RESTART. The two are now told apart, which is what the exit codes always
 * claimed: 1 is the profile, 2 is "the profile is right, the running app disagrees".
 */
const profileFailures = failures.length;
let httpState = null;
if (!skipHttp) {
  console.log(`\napp:     ${base}`);
  const probe = async (path, init) => {
    try {
      const response = await fetch(base + path, init);
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch { /* reported as text */ }
      return { status: response.status, payload, text };
    } catch (error) {
      return { status: 0, payload: null, text: String(error?.message || error) };
    }
  };

  const catalog = await probe('/vrmpet3d/catalog');
  const reachable = catalog.status !== 0;
  if (!reachable) {
    notes.push(`the app is not answering at ${base} — start it, or set DSH_WEB_URL`);
  } else {
    report(catalog.status === 200,
      `the host half is live (/vrmpet3d/catalog -> ${catalog.status}${catalog.status === 404 ? '; 404 means the plugin is not composed' : ''})`);
  }

  if (reachable) {
    const state = await probe('/vrmpet3d/state');
    report(state.status === 200, `the state channel answers (/vrmpet3d/state -> ${state.status})`);
    httpState = state.payload;
    if (state.status === 200 && state.payload) {
      const error = state.payload.error;
      const value = state.payload.state;
      report(!error, `the client half reports no start-up failure${error ? ` (it reported: ${error})` : ''}`);
      if (!error && value === null) {
        notes.push('the host is up but the CLIENT half has not published a state yet: reload the DSH page. '
          + 'If the pet still does not appear after a reload, the client bundle did not run — its own reason '
          + 'will appear here as `error` on the next attempt.');
      }
      if (value !== null) notes.push(`the client half is running and last reported state "${value}"`);
    }
  }
}

console.log('');
if (httpState) console.log(`state payload: ${JSON.stringify(httpState)}`);
for (const note of notes) console.log(`  note  ${note}`);

console.log('\n------------------------------------------------------------');
const profileOk = profileFailures === 0;
/**
 * `process.exitCode` rather than `process.exit()`: `fetch` keeps its sockets alive, and exiting with them
 * open trips a libuv assertion on Windows ("!(handle->flags & UV_HANDLE_CLOSING)"), which makes a CLEAN
 * result look like a crash. Setting the code lets the event loop drain and exit normally.
 */
if (!profileOk) {
  console.log(`profile wiring: ${profileFailures} FAILED`);
  console.error(`\nRepair it with:\n  node scripts/install-desktop-plugin.mjs --profile "${profileDir}"\nthen restart DSH.`);
  process.exitCode = 1;
} else if (failures.length > 0) {
  // The profile is right; only the running app disagrees. Both app-side failures at once mean the plugin is
  // simply not in the tree this process booted with, which no page reload can change.
  console.log(`profile wiring: PASSED (${passed} checks)`);
  console.error(`running app:  the plugin is NOT composed in the app that is running at ${base}`);
  console.error('  A restart is what is missing here — the profile itself needs no change, so do NOT rerun');
  console.error('  install-desktop-plugin.mjs. The composition is built at startup, so a running app keeps');
  console.error('  the tree it booted with. Restart DSH, then reload the page.');
  process.exitCode = 2;
} else {
  console.log(`profile wiring: PASSED (${passed} checks)`);
  process.exitCode = httpState && httpState.state === null && !httpState.error ? 2 : 0;
}

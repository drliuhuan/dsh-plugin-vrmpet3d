#!/usr/bin/env node
/**
 * Install this plugin into a DSH profile, reversibly.
 *
 * Run:  node scripts/install-desktop-plugin.mjs --profile "<...>/profiles/desktop" [--dry-run]
 *       node scripts/install-desktop-plugin.mjs --package build/dev-package    # the DEV TWIN
 *
 * `--package <dir>` registers a tree OTHER than this checkout — in practice the dev twin that
 * `scripts/make-dev-package.mjs` generates, so DSH composes this plugin twice: once as
 * `dsh-plugin-vrmpet3d` and once as `dsh-plugin-vrmpet3d-dev`, side by side. The name, the patch and
 * every route come from the tree that is named, so the two never collide.
 *
 * Why a script instead of `dsh plugin add`: the Electron application manages the
 * `desktop` profile exclusively and the CLI refuses it, and pnpm is not on PATH in
 * this environment. So this performs exactly the state change that command would
 * leave behind:
 *
 *   * a `dependencies` entry in the profile manifest, pointing at this folder
 *   * the package visible under the profile's `node_modules`
 *   * the package listed in `dsh.profile.bundles`, which its `dsh.bundle` declaration
 *     makes legal
 *
 * The manifest is copied to `package.json.bak-<stamp>` before anything is written.
 * To roll back: restore that file and delete `<profile>/node_modules`.
 *
 * Run `scripts/check-plugin-load.mjs --profile <dir>` afterwards to confirm the
 * profile still resolves the package, and restart DSH to pick the change up — this
 * version has no user-patch watcher, so a running app will not notice.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = args.includes('--dry-run');

// This file lives in <plugin>/scripts/, so the package root is one level up.
const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The tree to register. `--package` exists for the generated dev twin
 * (`scripts/make-dev-package.mjs`), which is a second copy of the package under a second
 * name: it declares its own `dsh.bundle.patch` and everything below is derived from ITS
 * manifest, so nothing here has to know which of the two it is registering.
 */
const packageDir = resolve(argOf('--package') ?? pluginDir);
const profileDir = argOf('--profile')
  ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh', 'profiles', 'desktop');

const manifestPath = join(profileDir, 'package.json');
if (!existsSync(manifestPath)) {
  console.error(`no profile manifest at ${manifestPath}`);
  process.exit(2);
}
if (!existsSync(join(packageDir, 'package.json'))) {
  console.error(`no package manifest at ${join(packageDir, 'package.json')}`);
  console.error('Build the dev twin first: node scripts/make-dev-package.mjs');
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const NAME = pkg.name;

if (pkg.dsh?.bundle?.patch === undefined) {
  console.error(`${NAME} declares no dsh.bundle.patch, so it cannot join a profile layer stack`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${manifestPath}.bak-${stamp}`;
const modulesDir = join(profileDir, 'node_modules');
const linkPath = join(modulesDir, ...NAME.split('/'));

const changes = [];
manifest.dependencies ??= {};
if (manifest.dependencies[NAME] === undefined) {
  manifest.dependencies[NAME] = `link:${packageDir.replace(/\\/g, '/')}`;
  changes.push(`dependencies["${NAME}"] = link:${packageDir}`);
}
manifest.dsh ??= {};
manifest.dsh.profile ??= {};
manifest.dsh.profile.bundles ??= [];
if (!manifest.dsh.profile.bundles.includes(NAME)) {
  manifest.dsh.profile.bundles.push(NAME);
  changes.push(`dsh.profile.bundles += ${NAME}`);
}
const linkExists = existsSync(linkPath);
changes.push(linkExists ? `node_modules link already present: ${linkPath}` : `create link ${linkPath} -> ${packageDir}`);

console.log(JSON.stringify({ packageDir, profileDir, manifestPath, backupPath, dryRun, changes }, null, 2));

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

copyFileSync(manifestPath, backupPath);
console.log(`\nbacked up the manifest to ${backupPath}`);

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`updated ${manifestPath}`);

if (!linkExists) {
  mkdirSync(modulesDir, { recursive: true });
  try {
    // A junction on Windows, a directory symlink elsewhere. `junction` needs no
    // elevation and survives the target being a relative path.
    symlinkSync(packageDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    console.log(`linked ${linkPath}`);
  } catch (error) {
    console.error(`could not create the link: ${error.message}`);
    console.error('The manifest is already updated; restore the backup and retry, or create the link by hand:');
    console.error(`  ${linkPath}  ->  ${packageDir}`);
    process.exit(1);
  }
}

console.log('\nInstalled. Next:');
console.log(`  node scripts/check-plugin-load.mjs --profile "${profileDir}"`);
console.log('  restart DSH');
console.log(`\nTo roll back: restore ${backupPath} over ${manifestPath} and delete ${modulesDir}`);

#!/usr/bin/env node
/**
 * Capture the OPERATOR's live plugin configuration into the repository.
 *
 * Operator, 2026-10-13: 「每一步都要上传到github，包括我还没有构造好的初始配置文件，即当前配置」 and, earlier the same
 * day: 「我现在在插件里修改的所有和插件相关的配置文件，都要同步到github作为正式版的初始配置下发，记得提醒我配置好初始配
 * 置后，把配置文件修改回本地配置，不再影响新用户的初始配置。」
 *
 * So this is the step-by-step channel: the plugin writes its configuration into the profile
 * (`<profile>/vrmpet3d-desktop/vrmpet3d-settings.json` and the stores beside it), a release's initial configuration
 * is what a NEW user should start from, and the operator wants the current state of that configuration in git on
 * every step — finished or not.
 *
 * WHERE IT GOES, and why not `assets/`: `package.json`'s `files[]` ships `lib`, `desktop`, `assets` and `docs`, so
 * anything under those reaches every npm user. This snapshot is the operator's own machine — absolute paths and all
 * — which is exactly why it lives in `initial-config/`, a folder the package does not carry. What SHIPS is the pack
 * manifest (`assets/motions/vrmpet3d-motions.json`), whose `defaults` name clips by FILE NAME rather than by the
 * per-profile id this snapshot stores; see `initial-config/README.md` for the two release-time jobs that turn this
 * capture into a shippable default.
 *
 * WHAT IT REFUSES. `vrmpet3d-setup.json` is NOT captured, and that is a decision rather than an omission: it holds
 * the first-run guide's `completed` flag, so shipping it would make the guide skip itself for every new user.
 *
 * Usage:
 *   node scripts/capture-config.mjs                 # capture into initial-config/
 *   node scripts/capture-config.mjs --check         # say whether the copy matches the live configuration
 *   node scripts/capture-config.mjs --source <dir>  # another profile (or a fixture) to read
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'initial-config');

/**
 * The files a capture takes, and where each one comes from in the profile.
 *
 * The first is the panel's own preferences — every row the user changed in 通用设置 / 模型参数 — and the rest are
 * the import stores the two pickers write. `vrmpet3d-motion-imports.json` is optional because a profile that has
 * only ever imported models does not have one yet.
 */
const CAPTURED = [
  { from: join('vrmpet3d-desktop', 'vrmpet3d-settings.json'), to: 'vrmpet3d-settings.json', required: true,
    what: 'the panel\'s preferences: motions, speech, expressions, parts, placement' },
  { from: 'vrmpet3d-model-files.json', to: 'vrmpet3d-model-files.json', required: false,
    what: 'the model FILES imported through 模型导入' },
  { from: 'vrmpet3d-model-dirs.json', to: 'vrmpet3d-model-dirs.json', required: false,
    what: 'the directories an older build imported (still listed, still removable)' },
  { from: 'vrmpet3d-motion-imports.json', to: 'vrmpet3d-motion-imports.json', required: false,
    what: 'the motion FOLDERS imported through 动作导入' },
];

/** Read from the profile the running app uses, unless `--source` names another one. */
function profileDir(argv) {
  const at = argv.indexOf('--source');
  if (at !== -1 && argv[at + 1]) return resolve(argv[at + 1]);
  return join(homedir(), '.dsh', 'profiles', 'desktop');
}

function parse(argv) {
  const port = process.env.VRMPET3D_PORT || '19387';
  return { check: argv.includes('--check'), catalog: argv.includes('--catalog'), source: profileDir(argv), port };
}

/**
 * The catalogue the running app serves — the id → FILE NAME map a release needs.
 *
 * The motion map this capture stores is keyed by per-profile ids (`a8`, `a9`, …), which mean nothing on another
 * machine; the shippable default in `assets/motions/vrmpet3d-motions.json` names clips by file. This is what makes
 * that translation possible later, offline, from the snapshot. Optional and non-fatal: a capture that cannot reach
 * the app still captures the files, because the configuration is what matters and the catalogue can be re-fetched.
 */
async function captureCatalog(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/vrmpet3d/motions`);
    if (!response.ok) return `skipped  motion-catalog.json  (the app answered HTTP ${response.status})`;
    const body = await response.json();
    const named = (Array.isArray(body.motions) ? body.motions : []).map((motion) => ({
      id: motion.id, name: motion.name, format: motion.format, source: motion.source,
    }));
    writeFileSync(join(OUT_DIR, 'motion-catalog.json'),
      JSON.stringify({ capturedFrom: `/vrmpet3d/motions on port ${port}`, motions: named }, null, 2) + '\n');
    return `wrote    motion-catalog.json  (${named.length} clips: the id -> file name map a release needs)`;
  } catch (error) {
    return `skipped  motion-catalog.json  (no app on port ${port}: ${error.message})`;
  }
}

function main() {
  const options = parse(process.argv.slice(2));
  if (!existsSync(options.source)) {
    console.error(`capture-config: no such profile: ${options.source}`);
    console.error('  pass --source <dir> to capture from somewhere else');
    process.exit(2);
  }
  // The catalogue is an HTTP read, so the capture becomes asynchronous from here on: the FILES are the point and
  // they are handled by the same code path either way.
  if (options.catalog && !options.check) {
    captureCatalog(options.port).then((line) => { run(options, [line]); });
    return;
  }
  run(options);
}

function run(options, extraLines) {
  const lines = [];
  let missingRequired = 0;
  let stale = 0;
  let found = 0;
  if (!options.check) mkdirSync(OUT_DIR, { recursive: true });

  for (const entry of CAPTURED) {
    const from = join(options.source, entry.from);
    const to = join(OUT_DIR, entry.to);
    if (!existsSync(from)) {
      lines.push(`${entry.required ? 'MISSING (required)' : 'absent '}  ${entry.from}`);
      if (entry.required) missingRequired += 1;
      continue;
    }
    found += 1;
    const live = readFileSync(from, 'utf8');
    const same = existsSync(to) && readFileSync(to, 'utf8') === live;
    if (options.check) {
      if (!same) stale += 1;
      lines.push(`${same ? 'same   ' : 'STALE  '}  ${entry.to}  (${entry.what})`);
      continue;
    }
    writeFileSync(to, live);
    lines.push(`${same ? 'same   ' : 'wrote  '}  ${entry.to}  (${entry.what})`);
  }

  /**
   * THE REFUSAL IS PRINTED, not silently skipped: a reader of this output has to be able to see that the guide's
   * own flag was considered and left out on purpose.
   */
  const setup = join(options.source, 'vrmpet3d-setup.json');
  if (existsSync(setup)) {
    lines.push(`refused  vrmpet3d-setup.json  (the first-run guide's completed flag: shipping it would make the`);
    lines.push('         guide skip itself for every new user)');
  }

  console.log(lines.concat(extraLines || []).join('\n'));

  if (options.check) {
    const ok = stale === 0 && missingRequired === 0;
    console.log(ok
      ? `\ninitial-config: up to date (${found} file(s) match the live configuration)`
      : `\ninitial-config: ${stale} file(s) differ from the live configuration`);
    process.exit(ok ? 0 : 1);
  }

  const written = readdirSync(OUT_DIR).filter((name) => name.endsWith('.json'));
  console.log(`\ninitial-config: ${written.length} file(s) in ${OUT_DIR}`);
  console.log('REMINDER (operator, standing): this snapshot is the operator\'s own machine, absolute paths and all.');
  console.log('  Before a release, revert these to the values a NEW user should start from — and put the motion');
  console.log('  mapping into assets/motions/vrmpet3d-motions.json `defaults` BY FILE NAME, not by the per-profile');
  console.log('  ids this capture stores. initial-config/README.md has both jobs written out.');
  if (missingRequired) {
    console.error(`capture-config: ${missingRequired} required file(s) were not found in ${options.source}`);
    process.exit(1);
  }
}

main();

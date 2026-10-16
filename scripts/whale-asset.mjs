#!/usr/bin/env node
/**
 * Pre-seed `assets/whale-tail.apng` from the installed DSH — the OFFLINE half of the whale mark.
 *
 * Run:  node scripts/whale-asset.mjs [--check]
 *
 * ## The mark now has a runtime source; this script is the fallback it pre-seeds
 *
 * Since 2026-10-16 the HOST half reads the mark out of the running DSH at activation (`lib/whale.js`,
 * falling back to this file and then to the copy it caches in the plugin's state directory), so nothing here
 * is required for the pet to show the animated tail. What this script is still for:
 *
 *   * a checkout with no asar-readable DSH (a terminal `dsh web` deployment whose packages are real
 *     directories is covered by the runtime search too, but a CI box with no DSH at all is not);
 *   * `--check`, which is the cheap assertion that the file in `assets/` — when a checkout has one — really is
 *     the animated mark rather than a still PNG.
 *
 * ## Why the bytes are not in the repository
 *
 * The operator's pet shows DSH's own running label, and that label's mark is a **60-frame APNG**: the app
 * embeds it in `dsh-client-ui-chat`'s stylesheet as a `mask:url(data:image/png;base64,…)`, animates it, and
 * paints `currentColor` through it. A static SVG stands in only when masks or motion are unavailable.
 *
 * That image is DeepSeek's, not this project's, and `docs/ASSET-CONTRACT.md` §1 is the rule this repository
 * follows for assets it did not make: the plugin loads them from where they already live and never copies
 * them into the tree. `assets/whale-tail.apng` is therefore git-ignored, and this script writes it only for a
 * deployment that cannot read the running app. The parse rule itself lives in `lib/whale.js` — one copy, the
 * one the host uses — so this script cannot drift from what `/vrmpet3d/whale` actually serves.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';
// The ONE parse rule: the marker, the base64 decode and the "is it really animated" check.
import { WHALE_BUNDLE_MEMBER, parseWhaleBundle, inspectWhaleImage } from '../lib/whale.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'whale-tail.apng');
const CHECK = process.argv.includes('--check');

/**
 * Where the mark lives inside the installation, relative to the archive's own root: the packaged app holds
 * the whole tree under `dsh/`, which is what `WHALE_BUNDLE_MEMBER` is relative to.
 */
const CHAT_CLIENT = `dsh/${WHALE_BUNDLE_MEMBER}`;

const ASAR_CANDIDATES = [
  envVar('DSH_ASAR'),
  'D:\\DeepSeek\\dsh\\resources\\app.asar',
  'F:\\DeepSeek\\Harness\\resources\\app.asar',
  join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
  'C:\\Program Files\\DeepSeek Harness\\resources\\app.asar',
].filter(Boolean);
const ASAR = ASAR_CANDIDATES.find(candidate => existsSync(candidate));

/** Read one member out of the installed archive, through the repository's own extractor. */
function readMember(inner) {
  return execFileSync(process.execPath, [
    join(ROOT, 'tools', 'asar-extract.mjs'), '--asar', ASAR, '--get', inner,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The APNG bytes, or a reason they could not be found. */
function extract() {
  if (ASAR === undefined) return { error: `no installed app.asar found (tried ${ASAR_CANDIDATES.join(', ')})` };
  let bundle;
  try {
    bundle = readMember(CHAT_CLIENT);
  } catch (error) {
    return { error: `could not read ${CHAT_CLIENT} from ${ASAR}: ${error.message}` };
  }
  const parsed = parseWhaleBundle(bundle);
  if (parsed.error) return { error: `${CHAT_CLIENT}: ${parsed.error}` };
  return { ...parsed, asar: ASAR };
}

if (CHECK) {
  if (!existsSync(OUT)) {
    /**
     * ABSENT IS A PASS NOW, and that is a change of meaning rather than a relaxation.
     *
     * The host reads the mark out of the running DSH at activation, so a checkout with no pre-seeded file
     * still shows the animated tail — there is nothing here to be wrong. What this check is FOR is the file
     * that IS present: that it is the animated mark and not, say, a still PNG a script wrote by mistake.
     */
    console.log(`whale mark: no pre-seeded ${OUT} (nothing to check; the host reads the running DSH's own mark)`);
    process.exit(0);
  }
  // The same rule the host applies, so `--check` cannot pass a file `/vrmpet3d/whale` would refuse.
  const checked = inspectWhaleImage(readFileSync(OUT));
  if (checked.error) {
    console.error(`whale mark: ${OUT} is not usable: ${checked.error}`);
    process.exit(1);
  }
  puts(checked.bytes, checked.frames);
  process.exit(0);
}

const found = extract();
if (found.error !== undefined) {
  console.error(`whale mark: ${found.error}`);
  console.error('The static SVG mark is used instead; nothing else changes. Re-run after DSH is installed,');
  console.error('or point VRMPET3D_DSH_ASAR at the installation.');
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, found.bytes);
console.log(`whale mark: ${found.asar}`);
puts(found.bytes, found.frames);

function puts(bytes, frames) {
  console.log(`  -> ${OUT}`);
  console.log(`  ${(bytes.length / 1024).toFixed(1)} KB, ${frames} frames (APNG)`);
}

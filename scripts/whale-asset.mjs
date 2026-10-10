#!/usr/bin/env node
/**
 * Extract DSH's animated whale mark from the installed application.
 *
 * Run:  node scripts/whale-asset.mjs [--check]
 *
 * ## Why this exists instead of a committed file
 *
 * The operator's pet shows DSH's own running label, and that label's mark is a **60-frame APNG**: the app
 * embeds it in `dsh-client-ui-chat`'s stylesheet as a `mask:url(data:image/png;base64,…)`, animates it, and
 * paints `currentColor` through it. A static SVG stands in only when masks or motion are unavailable.
 *
 * That image is DeepSeek's, not this project's, and `docs/ASSET-CONTRACT.md` §1 is the rule this repository
 * follows for assets it did not make: the plugin loads them from where they already live and never copies
 * them into the tree. So the bytes are read out of the DSH installation that is running this plugin, written
 * to `assets/whale-tail.apng` (git-ignored, like every generated fixture in `build/`), and served from there
 * by the host's `/vrmpet3d/whale` route. A checkout with no DSH to read simply has no file: the route answers
 * 404 and both prompts fall back to the static SVG, which is exactly the app's own fallback.
 *
 * `--check` verifies an already-extracted file rather than rewriting it, and is what the suites run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// VRMPET3D_* with the pre-rename PET3D_* names as a fallback (lib/env.js).
import { envVar } from '../lib/env.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'whale-tail.apng');
const CHECK = process.argv.includes('--check');

/** The chat plugin whose stylesheet carries the mark. */
const CHAT_CLIENT = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js';
/** The declaration that carries it: `mask:url(data:image/png;base64,…)`. */
const MARKER = 'mask:url(data:image/png;base64,';

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
  const at = bundle.indexOf(MARKER);
  if (at < 0) return { error: `${CHAT_CLIENT} carries no ${JSON.stringify(MARKER)} declaration` };
  const start = at + MARKER.length;
  let end = start;
  while (end < bundle.length && ![')', '"', "'", ';', ' ', '\n'].includes(bundle[end])) end += 1;
  const base64 = bundle.slice(start, end);
  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch (error) {
    return { error: `the embedded mask is not valid base64: ${error.message}` };
  }
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return { error: 'the embedded mask is not a PNG' };
  const text = bytes.toString('latin1');
  if (!text.includes('acTL') || !text.includes('fcTL')) {
    return { error: 'the embedded mask is a still PNG, not the animated one' };
  }
  return {
    bytes,
    frames: (text.match(/fcTL/g) || []).length,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    asar: ASAR,
  };
}

if (CHECK) {
  if (!existsSync(OUT)) {
    console.log(`whale mark: absent (${OUT}); run: node scripts/whale-asset.mjs`);
    process.exit(1);
  }
  const text = readFileSync(OUT).toString('latin1');
  const frames = (text.match(/fcTL/g) || []).length;
  puts(readFileSync(OUT), frames);
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

#!/usr/bin/env node
/**
 * Compress motion clips for the bundled pack: `<name>.vrma` -> `<name>.vrma.br`.
 *
 * WHY THIS SCRIPT EXISTS. The operator authors dance clips that are megabytes (the first one is 8.0 MB), and
 * the pack ships them compressed so the plugin's own download stays small. The plugin unpacks a `.vrma.br` into
 * memory on the way to the renderer — see `lib/brotli.js` for why brotli and not LZMA2, and
 * `createMotionHandler` in `lib/index.js` for where the unpacking happens.
 *
 * It compresses with the SAME settings the loader is tested against, so a clip made here cannot be one the
 * plugin refuses. A `.br` is written only after the bytes have been decompressed back and compared, because an
 * archive that does not round-trip is worse than no archive: the plugin would find it at play time.
 *
 * USAGE
 *   node scripts/compress-motions.mjs <file-or-dir> [...]
 *   node scripts/compress-motions.mjs assets/motions/dance
 *   node scripts/compress-motions.mjs --quality 9 assets/motions/dance
 *   node scripts/compress-motions.mjs --dry-run assets/motions/dance
 *
 * A directory is walked for clips that are NOT already compressed. An existing `.vrma.br` is overwritten, since
 * that is what re-running the tool means; pass `--dry-run` to see what it would do without writing anything.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const SUFFIX = '.br';
/** The extension a clip is authored as. Kept in step with `MOTION_EXTENSIONS` in `lib/core.js`. */
const CLIP_EXTENSION = '.vrma';

const BROTLI_OPTIONS = (quality, sizeHint) => ({
  params: {
    [constants.BROTLI_PARAM_QUALITY]: quality,
    // A 16 MiB window, which covers these clips whole, so a repeat several megabytes back is still findable.
    [constants.BROTLI_PARAM_LGWIN]: 24,
    [constants.BROTLI_PARAM_SIZE_HINT]: sizeHint,
  },
});

function parseArgs(argv) {
  const files = [];
  let quality = 11;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--quality' || arg === '-q') {
      quality = Number(argv[i + 1]);
      i += 1;
      if (!Number.isInteger(quality) || quality < 0 || quality > 11) {
        throw new Error('--quality must be an integer between 0 and 11');
      }
    } else if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/compress-motions.mjs [--quality 0-11] [--dry-run] <file-or-dir> [...]');
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option "${arg}" (try --help)`);
    } else {
      files.push(arg);
    }
  }
  return { files, quality, dryRun };
}

/** Every clip under a path, in a stable order, skipping ones that are already archives. */
function clipsUnder(path) {
  const found = [];
  const stats = statSync(path);
  if (stats.isFile()) {
    if (path.toLowerCase().endsWith(CLIP_EXTENSION)) found.push(path);
    return found;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...clipsUnder(child));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(CLIP_EXTENSION)) found.push(child);
  }
  return found;
}

const { files, quality, dryRun } = parseArgs(process.argv.slice(2));
if (files.length === 0) {
  console.error('nothing to do: name a clip or a directory (--help for usage)');
  process.exit(2);
}

let totalRaw = 0;
let totalPacked = 0;
let written = 0;
let skipped = 0;

for (const input of files) {
  const absolute = resolve(input);
  let targets;
  try {
    targets = clipsUnder(absolute);
  } catch (error) {
    console.error(`cannot read ${input}: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  if (targets.length === 0) {
    console.error(`no ${CLIP_EXTENSION} clips under ${input}`);
    process.exitCode = 1;
    continue;
  }
  for (const target of targets) {
    const raw = readFileSync(target);
    const started = Date.now();
    const packed = brotliCompressSync(raw, BROTLI_OPTIONS(quality, raw.length));
    // Proving the round trip before writing is the whole point: a corrupt archive would be found at play time,
    // in the pet, with nothing pointing back at this tool.
    const back = brotliDecompressSync(packed);
    if (!back.equals(raw)) {
      console.error(`REFUSED ${target}: the archive did not decompress back to the same bytes. Nothing written.`);
      process.exitCode = 1;
      continue;
    }
    const out = target + SUFFIX;
    const ratio = ((packed.length * 100) / raw.length).toFixed(1);
    if (dryRun) {
      console.log(`${target}${sep} -> ${basename(out)}  ${raw.length} -> ${packed.length} (${ratio}%)  [dry run]`);
      skipped += 1;
      continue;
    }
    writeFileSync(out, packed);
    console.log(`${target}${sep} -> ${basename(out)}  ${raw.length} -> ${packed.length} (${ratio}%)  ${((Date.now() - started) / 1000).toFixed(1)}s`);
    totalRaw += raw.length;
    totalPacked += packed.length;
    written += 1;
  }
}

if (written > 0) {
  console.log(`\n${written} clip(s): ${totalRaw} -> ${totalPacked} bytes (${((totalPacked * 100) / totalRaw).toFixed(1)}%)`);
} else if (skipped > 0) {
  console.log(`\n${skipped} clip(s) would be compressed (dry run: nothing written)`);
}

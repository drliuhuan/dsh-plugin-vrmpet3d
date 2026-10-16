/**
 * DSH's own animated whale mark: where it lives, how to read it, and what to fall back on.
 *
 * WHY THIS IS NOT A FILE IN THE PACKAGE
 * ------------------------------------
 * The mark is the 60-frame APNG the app animates behind its running label, and it belongs to DeepSeek, not
 * to this project. `docs/ASSET-CONTRACT.md` §1 is the rule for an asset the project did not make: load it
 * from where it already lives, never copy it into the tree. It lives as a `mask:url(data:image/png;base64,…)`
 * declaration inside DSH's own chat client bundle —
 *
 *     <install>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js
 *
 * — so the running DSH IS the source, and the honest way to serve it is to read it out of the installation
 * that is running this plugin. That also makes the mark track the app: an updated DSH hands over its updated
 * mark, with nothing to re-extract by hand and nothing committed.
 *
 * The host can read it: Electron's `fs` resolves the member inside `app.asar` transparently, and this half
 * runs in the same process that already reads that archive to serve `/favicon.svg` and the client bundles.
 * Under a plain-node deployment (`dsh web` on a terminal) there is no asar to read, but the same member is a
 * real file under the installation's `node_modules`, which is the second half of `whaleBundleCandidates`.
 *
 * THE CHAIN, IN ORDER (the operator, 2026-10-16: 「宿主最早加载插件的时候就抄下来，抄不到就逐级回落」)
 * -------------------------------------------------------------------------------------------------------
 *   1. the running DSH's own bundle, parsed out of its CSS declaration;
 *   2. `assets/whale-tail.apng` — a checkout that pre-seeded one (`scripts/whale-asset.mjs`), or a user who
 *      dropped their own mark there;
 *   3. the copy a PREVIOUS activation cached in the plugin's own state directory, which is what keeps the
 *      mark alive across a DSH layout change this code has not learned yet;
 *   4. nothing: `/whale` answers 404 and both prompts fall back to the static SVG, which is the app's own
 *      fallback and a complete mark on its own.
 *
 * Rung 1 runs at ACTIVATION, once, and its result is what the route serves: 552 KB read and 21 KB decoded,
 * measured in single-digit milliseconds, against a request that would otherwise repeat it per prompt. The
 * cached copy is refreshed on every successful rung 1, so it can never be the stale answer while the source
 * is readable — it is a fallback, not a cache in front of the source.
 *
 * Every path is an ARGUMENT rather than an environment read, which is what lets `verify-model.mjs` drive the
 * whole chain — order, decoding, rejection of a still PNG, the cached copy — without a DSH installation.
 *
 * Host-side only: nothing here is served to a browser (`lib/` ships it, `WINDOW_SOURCES` does not).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The declaration DSH's chat stylesheet carries the mark in. */
export const WHALE_MARKER = 'mask:url(data:image/png;base64,';

/**
 * The member of a DSH installation that carries it, relative to whichever root it is found under:
 * `<app.asar>/dsh/node_modules/…` for the packaged app, `<install>/node_modules/…` for a plain install.
 */
export const WHALE_BUNDLE_MEMBER = 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js';

/** The name the mark is kept under, both in `assets/` and in the state directory. */
export const WHALE_FILE_NAME = 'whale-tail.apng';

/** A PNG signature, and the two chunks that make a PNG an APNG. */
const PNG_SIGNATURE = '89504e470d0a1a0a';

/** Characters that end the base64 payload in a CSS declaration. */
const MARKER_END = [')', '"', "'", ';', ' ', '\n'];

/**
 * Is this buffer the ANIMATED whale mark?
 *
 * Deliberately not a PNG decoder: it checks the signature, that an `acTL` chunk is present and that at least
 * one `fcTL` frame control follows. That is enough to tell the animated mark from the still PNG that would
 * silently never animate — which is the failure this route exists to make visible — without carrying an image
 * library into the host half.
 *
 * @param {Buffer} bytes candidate image bytes
 * @returns {{bytes: Buffer, frames: number, width: number, height: number}|{error: string}}
 */
export function inspectWhaleImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) {
    return { error: `the mark is ${bytes ? bytes.length : 0} bytes, too short to be an APNG` };
  }
  if (bytes.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return { error: 'the mark is not a PNG' };
  const text = bytes.toString('latin1');
  const frames = (text.match(/fcTL/g) || []).length;
  if (!text.includes('acTL') || frames === 0) return { error: 'the mark is a still PNG, not the animated one' };
  return { bytes, frames, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Read the mark out of a chat client bundle's text.
 *
 * @param {string} bundle the whole `client.js` source
 * @returns {{bytes: Buffer, frames: number, width: number, height: number}|{error: string}}
 */
export function parseWhaleBundle(bundle) {
  const at = bundle.indexOf(WHALE_MARKER);
  if (at < 0) return { error: `the bundle carries no ${WHALE_MARKER} declaration` };
  const start = at + WHALE_MARKER.length;
  let end = start;
  while (end < bundle.length && !MARKER_END.includes(bundle[end])) end += 1;
  const base64 = bundle.slice(start, end);
  if (base64.length === 0) return { error: 'the embedded mask declaration is empty' };
  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch (error) {
    return { error: `the embedded mask is not valid base64: ${error.message}` };
  }
  return inspectWhaleImage(bytes);
}

/**
 * Every place the chat bundle may be, in the order worth trying.
 *
 * `asar` is the archive itself (`…/resources/app.asar`), `resourcesPath` is Electron's own answer for where
 * `resources/` is, and `installRoot` is what the launcher's search finds — the directory holding the
 * executable and `resources/`. All three are optional, and each contributes the layouts that make sense for
 * it, so a packaged app, a plain install and a test fixture are all just "some roots".
 *
 * @param {{asar?: string, resourcesPath?: string, installRoot?: string}} roots
 * @returns {string[]} candidate file paths, deduplicated, in preference order
 */
export function whaleBundleCandidates({ asar, resourcesPath, installRoot } = {}) {
  const candidates = [];
  const push = (base) => {
    if (typeof base === 'string' && base) candidates.push(join(base, WHALE_BUNDLE_MEMBER));
  };
  // The packaged application: the whole DSH tree sits under `dsh/` inside the archive.
  push(asar);
  if (asar) push(join(asar, 'dsh'));
  if (resourcesPath) {
    push(join(resourcesPath, 'app.asar'));
    push(join(resourcesPath, 'app.asar', 'dsh'));
  }
  // A plain install (npm, or the CLI's own tree): the packages are real directories.
  push(installRoot);
  if (installRoot) {
    push(join(installRoot, 'resources', 'app.asar'));
    push(join(installRoot, 'resources', 'app.asar', 'dsh'));
  }
  return [...new Set(candidates)];
}

/** Cache a copy beside the settings, best effort: a read-only or missing directory must not cost the mark. */
function writeStateCopy(file, bytes, log) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    return true;
  } catch (error) {
    log?.(`vrmpet3d-dev: could not cache the whale mark at ${file}: ${error.message}`);
    return false;
  }
}

/** Read one whole file, or a reason why not — the two file rungs share this so their reports match. */
function readWholeFile(file) {
  try {
    return { bytes: readFileSync(file) };
  } catch (error) {
    return { error: error.code === 'ENOENT' ? 'absent' : error.message };
  }
}

/**
 * Walk the chain and return the mark.
 *
 * @param {object} options
 *   asar, resourcesPath, installRoot  where to look for DSH's own bundle (see {@link whaleBundleCandidates})
 *   localFile                         the plugin's own `assets/whale-tail.apng`
 *   stateFile                         the fallback copy this keeps in the plugin's state directory
 *   log                               optional `(message) => void` for a failed state copy
 * @returns {{bytes: Buffer, frames: number, width: number, height: number, source: string}|{error: string, tried: string[]}}
 */
export function resolveWhaleMark({ asar, resourcesPath, installRoot, localFile, stateFile, log } = {}) {
  const tried = [];
  for (const bundle of whaleBundleCandidates({ asar, resourcesPath, installRoot })) {
    if (!existsSync(bundle)) { tried.push(`${bundle} (absent)`); continue; }
    const file = readWholeFile(bundle);
    if (file.error) { tried.push(`${bundle} (${file.error})`); continue; }
    const parsed = parseWhaleBundle(file.bytes.toString('utf8'));
    if (parsed.error) { tried.push(`${bundle} (${parsed.error})`); continue; }
    if (stateFile) writeStateCopy(stateFile, parsed.bytes, log);
    return { ...parsed, source: bundle };
  }
  for (const [file, label] of [[localFile, "the plugin's own mark"], [stateFile, 'the copy a previous activation left']]) {
    if (!file) continue;
    const read = readWholeFile(file);
    if (read.error) { tried.push(`${file} (${read.error})`); continue; }
    const parsed = inspectWhaleImage(read.bytes);
    if (parsed.error) { tried.push(`${file} (${parsed.error})`); continue; }
    return { ...parsed, source: `${label}: ${file}` };
  }
  return { error: 'no animated mark could be read', tried };
}

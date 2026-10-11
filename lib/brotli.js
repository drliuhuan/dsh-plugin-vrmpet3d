// Brotli decompression for the bundled motion pack's compressed clips.
//
// WHY BROTLI, AND WHY NOT LZMA2. The operator's dance clips are large (their first one is 8.0 MB), so the pack
// stores them compressed and the bytes are unpacked into memory on the way to the renderer. LZMA2 would be
// about 10% smaller — 46% of the original against brotli's 51% on a real clip — but Node's `zlib` does NOT
// speak LZMA (measured 2026-10-12: `unzipSync`/`inflateSync`/`gunzipSync` all fail with Z_DATA_ERROR on a file
// the reference liblzma wrote), and this plugin ships with NO npm dependencies, so LZMA would mean maintaining
// a hand-written LZMA2 decoder in `lib/xz.js`. That decoder was written and does NOT yet decode real binary
// content correctly, so it is NOT in this path: a decompressor that returns plausible garbage would hand the
// renderer a malformed model, which is worse than not supporting the format at all.
//
// Brotli, by contrast, is IN Node and in every Chromium the pet runs in. On the operator's own dance clip:
// 8,080,556 bytes -> 2,836,574 (35%), byte-identical, in about 13 seconds.
//
// Node is the only side that needs this file: the HOST unpacks the clip and serves plain VRMA bytes, so the
// browser half never learns that a clip arrived compressed. See `motionBytesFor` in lib/index.js.
import { brotliDecompressSync } from 'node:zlib';

/** How large an unpacked clip may be before the host refuses it, as a decompression-bomb guard. */
export const MOTION_PACK_LIMIT = 512 * 1024 * 1024;

/** The extension a compressed clip carries, appended to the format's own: `x.vrma.br`. */
export const COMPRESSED_MOTION_EXTENSION = '.br';

/**
 * The suffix appended WITHOUT a dot, for a caller composing "the compressed twin of this name".
 *
 * `COMPRESSED_MOTION_EXTENSION` is what a reader sees in a file name; this is what a catalogue builds to ask
 * "is there an archive beside this clip?". Keeping both spelled out is what stops one of them drifting into the
 * other's job — a schedule that appends `.br` here would look for `x.vrma..br`.
 */
export const COMPRESSED_SUFFIX = 'br';

/**
 * Decompress one brotli-compressed clip.
 *
 * @param {Buffer|Uint8Array} bytes the file exactly as it sits on disk.
 * @param {object} [options]
 * @param {number} [options.limit] most bytes to produce before refusing.
 * @returns {Buffer} the original bytes.
 * @throws {Error} with a message a caller can show — never a half-decoded clip.
 */
export function decompressBrotli(bytes, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : MOTION_PACK_LIMIT;
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
    throw new Error('the compressed clip is empty');
  }
  let out;
  try {
    out = brotliDecompressSync(bytes, { maxOutputLength: limit });
  } catch (error) {
    /**
     * `maxOutputLength` is what turns a decompression bomb into a refusal rather than an out-of-memory crash,
     * and Node reports it by code. The message is rewritten because the raw one ("Cannot create a Buffer
     * larger than...") says nothing about which clip or why.
     */
    if (error && error.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`the clip unpacks to more than ${limit} bytes`);
    }
    throw new Error(`the compressed clip could not be unpacked: ${(error && error.message) || error}`);
  }
  return out;
}

/**
 * Does this file name describe a brotli-compressed clip?
 *
 * Total and cheap, like every other format check in this plugin: the extension decides, and the bytes are
 * never sniffed to guess. A file whose name says `.br` but whose bytes are not brotli is REFUSED by
 * `decompressBrotli` with a reason, which is the honest outcome — the alternative is loading it as a model.
 */
export function isCompressedMotionName(fileName) {
  return typeof fileName === 'string' && fileName.toLowerCase().endsWith(COMPRESSED_MOTION_EXTENSION);
}

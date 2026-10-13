#!/usr/bin/env node
/**
 * Replace (or add) the thumbnail a VRM/GLB carries, without disturbing anything else in the file.
 *
 * Why a tool and not a hex edit: the image lives in the BIN chunk and is addressed by a bufferView, so its
 * bytes cannot simply be overwritten unless the new image is exactly the same length. This rewrites the
 * container properly:
 *
 *   * the common case — the thumbnail's bufferView is the TAIL of the buffer and nothing else points at it —
 *     truncates at the old byteOffset and appends the new image, so not one other bufferView/accessor offset
 *     moves;
 *   * any other case — the view is shared or sits mid-buffer — appends a fresh bufferView and repoints the
 *     image at it, leaving every existing byte where it was (the file grows, nothing is displaced).
 *
 * The index semantics of the two VRM flavours differ and both are handled:
 *   * VRM 0.x — `extensions.VRM.meta.texture` is a TEXTURE index, resolved through `textures[i].source`;
 *   * VRM 1.0 — `extensions.VRMC_vrm.meta.thumbnailImage` is an IMAGE index, used directly.
 * A model with a VRM meta block but no thumbnail at all gets one added (the minimal fixtures are that case).
 *
 * `images[i].mimeType` is rewritten from the new file's magic bytes, because GLTFLoader builds its blob from
 * that string: a JPEG labelled image/png does not load.
 *
 * Usage:
 *   node build/set-thumbnail.mjs <model.vrm> <image.png|jpg> [--out <file>] [--dry-run]
 *
 * Without --out the model is rewritten IN PLACE, after a `<model>.bak-<stamp>` copy is made.
 * --dry-run prints the plan and touches nothing.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { imageBytes, imageSize, readGlb, readGlbBuffer } from '../lib/vrm-info.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const args = process.argv.slice(2);
const flagOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = args.includes('--dry-run');
const positional = args.filter((argument, index) => !argument.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')));
const [modelPath, imagePath] = positional;
if (!modelPath || !imagePath) {
  console.error('usage: node build/set-thumbnail.mjs <model.vrm> <image.png|jpg> [--out <file>] [--dry-run]');
  process.exit(2);
}

const model = resolve(modelPath);
const image = resolve(imagePath);
const out = flagOf('--out') ? resolve(flagOf('--out')) : model;
const align4 = (n) => (n + 3) & ~3;

/** The mime type the bytes actually are (never trust the file extension). */
function sniffMime(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return null;
}

/** Which image is the thumbnail, and through which field. */
function findThumbnail(json) {
  const vrm0 = json.extensions && json.extensions.VRM;
  const vrm1 = json.extensions && json.extensions.VRMC_vrm;
  if (vrm0 && vrm0.meta && typeof vrm0.meta.texture === 'number') {
    const texture = (json.textures || [])[vrm0.meta.texture];
    const index = texture && typeof texture.source === 'number' ? texture.source : null;
    return { index, via: `VRM 0.x meta.texture=${vrm0.meta.texture} -> textures[${vrm0.meta.texture}].source=${index}`, field: 'vrm0' };
  }
  if (vrm1 && vrm1.meta && typeof vrm1.meta.thumbnailImage === 'number') {
    return { index: vrm1.meta.thumbnailImage, via: `VRM 1.0 meta.thumbnailImage=${vrm1.meta.thumbnailImage}`, field: 'vrm1' };
  }
  if (vrm0 && vrm0.meta) return { index: null, via: 'VRM 0.x meta has no texture', field: 'vrm0' };
  if (vrm1 && vrm1.meta) return { index: null, via: 'VRM 1.0 meta has no thumbnailImage', field: 'vrm1' };
  return { index: null, via: 'no VRM meta block', field: null };
}

const glb = readGlb(model);
const json = glb.json;
const original = glb.buffer;
const originalBufferLength = json.buffers[0].byteLength;
if (!glb.bin) {
  console.error(`${basename(model)}: no BIN chunk, so there is nowhere to put an image`);
  process.exit(1);
}

const nextBytes = readFileSync(image);
const mime = sniffMime(nextBytes);
if (!mime) {
  console.error(`${basename(image)}: not a PNG or JPEG (VRM thumbnails are one of those two)`);
  process.exit(1);
}
const nextSize = imageSize(nextBytes, mime);

const thumb = findThumbnail(json);
const plan = [];
let bin;
let bufferLength;

if (thumb.index === null) {
  // No thumbnail yet: append one and point the meta at it.
  if (!thumb.field) {
    console.error(`${basename(model)}: no extensions.VRM / extensions.VRMC_vrm meta block to attach a thumbnail to`);
    process.exit(1);
  }
  const offset = align4(glb.bin.length);
  bin = Buffer.concat([glb.bin, Buffer.alloc(offset - glb.bin.length), nextBytes, Buffer.alloc(align4(nextBytes.length) - nextBytes.length)]);
  bufferLength = offset + nextBytes.length;
  json.images = json.images || [];
  json.bufferViews = json.bufferViews || [];
  const imageIndex = json.images.length;
  const viewIndex = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: nextBytes.length });
  json.images.push({ name: 'Thumbnail', mimeType: mime, bufferView: viewIndex });
  if (thumb.field === 'vrm0') json.extensions.VRM.meta.texture = json.textures.push({ sampler: 0, source: imageIndex }) - 1;
  else json.extensions.VRMC_vrm.meta.thumbnailImage = imageIndex;
  json.buffers[0].byteLength = bufferLength;
  plan.push(`added a thumbnail: images[${imageIndex}] -> bufferViews[${viewIndex}] @${offset} (${thumb.via})`);
} else {
  const image0 = json.images[thumb.index];
  const viewIndex = image0.bufferView;
  const view = json.bufferViews[viewIndex];
  const offset = view.byteOffset || 0;
  // Read the old bytes BEFORE anything is mutated: imageBytes() slices through the json's own byteLength.
  const previousBytes = imageBytes(glb, thumb.index);
  const previousMime = image0.mimeType || null;
  const previousSize = imageSize(previousBytes, previousMime);
  const shared = json.images.some((other, index) => index !== thumb.index && other.bufferView === viewIndex)
    || (json.accessors || []).some((accessor) => accessor.bufferView === viewIndex);
  const isTail = offset + view.byteLength === json.buffers[0].byteLength;

  if (shared || !isTail) {
    // Nothing existing may move: append a fresh bufferView and repoint the image.
    const start = align4(json.buffers[0].byteLength);
    const pad = start - json.buffers[0].byteLength;
    const tailPad = align4(nextBytes.length) - nextBytes.length;
    bin = Buffer.concat([glb.bin.subarray(0, json.buffers[0].byteLength), Buffer.alloc(pad), nextBytes, Buffer.alloc(tailPad)]);
    bufferLength = start + nextBytes.length;
    json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: nextBytes.length });
    image0.bufferView = json.bufferViews.length - 1;
    json.buffers[0].byteLength = bufferLength;
    plan.push(`thumbnail view bufferViews[${viewIndex}] is ${shared ? 'shared with other data' : 'not at the end of the buffer'}`);
    plan.push(`appended images[${thumb.index}] at ${start} as bufferViews[${image0.bufferView}] (every existing byte kept)`);
  } else {
    // The tail case: truncate at the old offset, append, drop the padding the old image needed.
    const tailPad = align4(nextBytes.length) - nextBytes.length;
    bin = Buffer.concat([glb.bin.subarray(0, offset), nextBytes, Buffer.alloc(tailPad)]);
    bufferLength = offset + nextBytes.length;
    view.byteLength = nextBytes.length;
    json.buffers[0].byteLength = bufferLength;
    plan.push(`thumbnail is the tail: truncated at ${offset} and rewrote bufferViews[${viewIndex}].byteLength`);
  }

  image0.mimeType = mime;
  plan.push(`images[${thumb.index}] "${image0.name || ''}" ${previousBytes ? previousBytes.length : 0} bytes`
    + `${previousSize ? ` ${previousSize.width}x${previousSize.height}` : ''}${previousMime ? ` ${previousMime}` : ''}`
    + `  ->  ${nextBytes.length} bytes ${nextSize ? `${nextSize.width}x${nextSize.height} ` : ''}${mime}`);
  if (!image0.name) image0.name = 'Thumbnail';
}

// ---- validate the result before anything is written -------------------------------------------
const problems = [];
json.bufferViews.forEach((view, index) => {
  const end = (view.byteOffset || 0) + view.byteLength;
  if (end > bufferLength) problems.push(`bufferViews[${index}] ends at ${end}, past the buffer's ${bufferLength}`);
});
const images = json.images || [];
images.forEach((picture, index) => {
  if (typeof picture.bufferView !== 'number') problems.push(`images[${index}] has no bufferView`);
  else if (!json.bufferViews[picture.bufferView]) problems.push(`images[${index}] points at a missing bufferView`);
});
const targetIndex = thumb.index === null ? images.length - 1 : thumb.index;
if (!images[targetIndex] || images[targetIndex].mimeType !== mime) problems.push('the thumbnail image was not repointed at the new bytes');

const jsonText = Buffer.from(`${JSON.stringify(json)}\n`, 'utf8');
const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(align4(jsonText.length) - jsonText.length, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(GLB_MAGIC, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
const chunkHeader = (type, length) => { const out = Buffer.alloc(8); out.writeUInt32LE(length, 0); out.writeUInt32LE(type, 4); return out; };
const written = Buffer.concat([header, chunkHeader(JSON_CHUNK, jsonChunk.length), jsonChunk, chunkHeader(BIN_CHUNK, bin.length), bin]);

// Read the bytes back the same way the report does: a plan that does not round-trip never gets written.
let verify = 'not checked';
if (problems.length === 0) {
  try {
    const reread = readGlbBuffer(written, basename(out));
    const bytes = imageBytes(reread, targetIndex);
    if (!bytes || !bytes.equals(nextBytes)) problems.push('the thumbnail does not read back as the bytes that were handed in');
    else verify = `reads back as images[${targetIndex}] (${bytes.length} bytes, ${mime})`;
  } catch (error) {
    problems.push(`the rewritten file does not parse: ${error.message}`);
  }
}

console.log(`${basename(model)}  ->  ${out}`);
plan.forEach((line) => console.log(`  ${line}`));
console.log(`  buffer ${originalBufferLength} -> ${bufferLength} bytes; file ${original.length} -> ${written.length} bytes`);
console.log(`  ${problems.length ? 'PROBLEMS' : 'verified'}: ${problems.length ? problems.join('; ') : verify}`);

if (problems.length) process.exit(1);
if (dryRun) {
  console.log('  --dry-run: nothing written');
  process.exit(0);
}
if (resolve(out) === model) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${model}.bak-${stamp}`;
  copyFileSync(model, backup);
  console.log(`  backup: ${backup}`);
}
writeFileSync(out, written);
console.log(`  wrote ${out}`);

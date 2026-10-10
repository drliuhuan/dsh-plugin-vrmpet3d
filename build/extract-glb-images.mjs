/**
 * Pull images straight out of a GLB (a .vrm is one): the official thumbnail VRoid stores, and any material
 * texture, plus what the alpha channel of a texture actually says.
 *
 * Written to answer "is the clothes' transparency broken, or is that just the design": the file carries its
 * own render of the model, so the question stops being a matter of taste. The alpha statistics answer the
 * other half — a cut-out whose RGB is BLACK is exactly what a failing alpha mask looks like on screen.
 *
 * Usage: node build/extract-glb-images.mjs <file.vrm> <outDir> [nameFilter]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [file, outDir, filter] = process.argv.slice(2);
if (!file || !outDir) {
  console.error('usage: node build/extract-glb-images.mjs <file.vrm> <outDir> [nameFilter]');
  process.exit(2);
}

const bytes = readFileSync(file);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const chunks = [];
let offset = 12;
let json = null;
let bin = null;
while (offset < bytes.length) {
  const length = view.getUint32(offset, true);
  const type = view.getUint32(offset + 4, true);
  const body = bytes.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
  else if (type === 0x004e4942) bin = body;
  chunks.push({ length, type });
  offset += 8 + length;
}
if (!json || !bin) {
  console.error('need a GLB with a BIN chunk');
  process.exit(2);
}

const imageBytes = (index) => {
  const image = (json.images || [])[index];
  if (!image) return null;
  if (image.bufferView === undefined) return null;
  const bufferView = json.bufferViews[image.bufferView];
  const start = bufferView.byteOffset || 0;
  return bin.subarray(start, start + bufferView.byteLength);
};

/** Minimal PNG header read: enough to know the size, and to say whether it has an alpha channel. */
const describePng = (buffer) => {
  if (!buffer || buffer.length < 26 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
};

mkdirSync(outDir, { recursive: true });

const vrm = json.extensions && json.extensions.VRM;
// VRM 0.x keeps the thumbnail in `meta.texture`; VRM 1.0 uses `meta.thumbnailImage`. Both are indices into
// `images`, and the exporter usually names the image too.
const thumbnailIndex = vrm && vrm.meta
  ? (vrm.meta.texture !== undefined ? vrm.meta.texture : vrm.meta.thumbnailImage)
  : undefined;
console.log(`images: ${(json.images || []).length}, VRM thumbnail index: ${thumbnailIndex}`);

const wanted = [];
if (thumbnailIndex !== undefined) wanted.push({ index: thumbnailIndex, name: 'vrm-thumbnail' });
(jjsonImages(json)).forEach((name, index) => {
  if (index === thumbnailIndex) return;
  if (filter && !new RegExp(filter, 'i').test(name)) return;
  wanted.push({ index, name });
});

for (const { index, name } of wanted) {
  let buffer = imageBytes(index);
  if (!buffer) {
    console.log(`#${index} ${name}: no embedded bytes (external URI)`);
    continue;
  }
  const kind = describePng(buffer);
  // A PNG that is a JPEG? glTF allows mimeType; trust the magic bytes over the declaration.
  const isPng = Boolean(kind);
  const extension = isPng ? 'png' : 'bin';
  const target = join(outDir, `${String(index).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '_')}.${extension}`);
  writeFileSync(target, buffer);
  console.log(`#${index} ${name.padEnd(34)} ${buffer.length} B  ${isPng ? `${kind.width}x${kind.height} colorType ${kind.colorType}` : 'not a PNG'}  -> ${target}`);
}

function jjsonImages(source) {
  // The image's own name first (VRoid writes one), then the first texture that points at it: unnamed images
  // are named after their texture, so `--filter Onepice` is useful on either kind of file.
  const names = new Array((source.images || []).length).fill('');
  (source.textures || []).forEach((texture) => {
    const index = texture.source;
    if (index === undefined || names[index]) return;
    names[index] = (texture.name || '').trim() || `texture${index}`;
  });
  return names.map((name, index) => {
    const own = (source.images[index] && source.images[index].name) || '';
    return (own || name || `image${index}`).trim();
  });
}

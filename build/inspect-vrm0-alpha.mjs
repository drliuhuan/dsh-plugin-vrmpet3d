/**
 * What a VRM 0.x file says about its materials' transparency, in BOTH places that can say it.
 *
 * Why this exists: three-vrm's `VRMMaterialsV0CompatPlugin` REWRITES every material definition before
 * GLTFLoader parses it, and its `alphaMode` comes from the VRM 0.x `keywordMap`
 * (`_ALPHABET_ON` / `_ALPHABLEND_ON`) — the glTF-level `alphaMode` of the same material is replaced by
 * whatever that conversion decides. So a material whose glTF declaration is `MASK` can end up OPAQUE, and
 * an alpha cut-out then draws as opaque black.
 *
 * This prints, per material: the glTF declaration, the VRM 0.x shader and keyword map, and what the
 * conversion above will produce.
 *
 * Usage: node build/inspect-vrm0-alpha.mjs <file.vrm>
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node build/inspect-vrm0-alpha.mjs <file.vrm>');
  process.exit(2);
}

const bytes = readFileSync(file);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
if (view.getUint32(0, true) !== 0x46546c67) {
  console.error('not a GLB');
  process.exit(2);
}
let offset = 12;
let json = null;
while (offset < bytes.length) {
  const length = view.getUint32(offset, true);
  const type = view.getUint32(offset + 4, true);
  if (type === 0x4e4f534a) json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
  offset += 8 + length;
}
if (!json) {
  console.error('no JSON chunk');
  process.exit(2);
}

const vrm = (json.extensions && (json.extensions.VRM || (json.extensions.VRMC_vrm && null))) || null;
const v0 = vrm && Array.isArray(vrm.materialProperties) ? vrm.materialProperties : null;
console.log(`materials: ${(json.materials || []).length}, VRM 0.x materialProperties: ${v0 ? v0.length : 0}`);
if (!v0) {
  console.log('no VRM 0.x material properties: this file is not VRM 0.x (or declares none)');
}

let mismatches = 0;
(json.materials || []).forEach((material, index) => {
  const properties = v0 ? v0[index] : null;
  const keywordMap = (properties && properties.keywordMap) || {};
  const floats = (properties && properties.floatProperties) || {};
  const isTransparent = keywordMap._ALPHABLEND_ON === true;
  const isCutoff = keywordMap._ALPHATEST_ON === true;
  const converted = isTransparent ? 'BLEND' : isCutoff ? 'MASK' : 'OPAQUE';
  const declared = material.alphaMode || 'OPAQUE';
  const flagged = converted !== declared ? '  <-- CHANGED by the VRM 0.x compat layer' : '';
  if (flagged) mismatches += 1;
  // WHICH texture the material draws with. `_MainTex` is a TEXTURE index; the name printed is the name of
  // the IMAGE that texture points at, and the two indices are not the same in general. A garment whose
  // material points at a dummy 8x8 `Shader_NoneBlack` is how it renders solid black.
  const textureIndex = (properties && properties.textureProperties && properties.textureProperties._MainTex);
  const texture = textureIndex === undefined ? null : (json.textures || [])[textureIndex];
  const imageIndex = texture ? texture.source : undefined;
  const imageName = imageIndex === undefined || !json.images
    ? '-'
    : ((json.images[imageIndex] && json.images[imageIndex].name) || `image${imageIndex}`);
  console.log(
    `#${String(index).padStart(2)} ${(material.name || '').padEnd(34)}` +
    ` glTF ${declared.padEnd(6)} cutoff ${String(material.alphaCutoff === undefined ? '-' : material.alphaCutoff).padEnd(4)}` +
    ` | shader ${(properties && properties.shader) || '-'} -> ${converted.padEnd(6)}` +
    `  _ALPHABLEND_ON ${String(isTransparent).padEnd(5)} _ALPHATEST_ON ${String(isCutoff).padEnd(5)}` +
    ` _Cutoff ${floats._Cutoff === undefined ? '-' : floats._Cutoff} _ZWrite ${floats._ZWrite === undefined ? '-' : floats._ZWrite} _CullMode ${floats._CullMode === undefined ? '-' : floats._CullMode}` +
    ` doubleSided ${material.doubleSided === true}` +
    ` _MainTex ${textureIndex === undefined ? '-' : textureIndex} -> ${imageName}` +
    flagged
  );
});
console.log(`\nmaterials whose alpha mode the compat layer CHANGES: ${mismatches}`);

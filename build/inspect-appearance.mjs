/**
 * What a VRM/GLB actually contains, at the level a UI could switch: meshes, their primitives, the material
 * each primitive draws with, every morph target, and the node names.
 *
 * Written to answer one question about one file — "does it have clothing or appearance options" — because
 * `vrm-report.mjs` answers "what does this model contain" at the model level and not "is the dress a thing
 * you could hide".
 *
 * Usage: node build/inspect-appearance.mjs <file.glb|vrm>
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node build/inspect-appearance.mjs <file.glb|vrm>');
  process.exit(2);
}

const bytes = readFileSync(file);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
if (view.getUint32(0, true) !== 0x46546c67) {
  console.error('not a GLB (no glTF magic)');
  process.exit(2);
}
let offset = 12;
let json = null;
while (offset < bytes.length) {
  const length = view.getUint32(offset, true);
  const type = view.getUint32(offset + 4, true);
  const body = bytes.subarray(offset + 8, offset + 8 + length);
  if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
  offset += 8 + length;
}
if (!json) {
  console.error('no JSON chunk');
  process.exit(2);
}

const materials = (json.materials || []).map((material, index) => material.name || `material${index}`);
const meshes = json.meshes || [];
console.log(`meshes: ${meshes.length}, materials: ${materials.length}, nodes: ${(json.nodes || []).length}`);

for (let m = 0; m < meshes.length; m += 1) {
  const mesh = meshes[m];
  const primitives = mesh.primitives || [];
  console.log(`\nmesh #${m} ${mesh.name || '(unnamed)'} — ${primitives.length} primitive(s), ` +
    `${(mesh.weights || []).length} morph target(s)`);
  for (let p = 0; p < primitives.length; p += 1) {
    const material = primitives[p].material;
    const name = material === undefined ? '(none)' : materials[material];
    const position = primitives[p].attributes && primitives[p].attributes.POSITION;
    const vertices = position !== undefined && json.accessors && json.accessors[position]
      ? json.accessors[position].count
      : 0;
    console.log(`  prim #${p}  material ${material} ${name}  vertices ${vertices}`);
  }
}

/** Node names, grouped so a wall of bones does not bury the few that matter. */
const nodes = json.nodes || [];
const interesting = nodes
  .map((node, index) => ({ index, name: node.name || '' }))
  .filter((entry) => entry.name && !/^(J_|Bip|Normalized)/i.test(entry.name));
console.log(`\nnodes that are not bones (${interesting.length} of ${nodes.length}):`);
console.log('  ' + interesting.map((entry) => `${entry.index}:${entry.name}`).join(', '));

const withMeshes = nodes
  .map((node, index) => ({ index, name: node.name || '', mesh: node.mesh, skin: node.skin }))
  .filter((entry) => entry.mesh !== undefined);
console.log('\nnodes that DRAW a mesh:');
for (const entry of withMeshes) {
  console.log(`  #${entry.index} ${entry.name} -> mesh #${entry.mesh}` +
    `${entry.skin !== undefined ? ` (skinned ${entry.skin})` : ' (not skinned)'}`);
}

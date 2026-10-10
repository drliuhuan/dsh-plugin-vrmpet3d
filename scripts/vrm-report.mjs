// Print what is inside a .vrm (or .glb).
//
// A thin CLI over `lib/vrm-info.js`, which is where the parsing lives: the host half needs the same
// answers (the settings window lists a model's expressions and spring chains over
// `/vrmpet3d/model-info`), and two implementations of one parser drift. This file is only the
// human-readable rendering plus the thumbnail extraction.
//
// Usage:
//   node scripts/vrm-report.mjs <model.vrm>                  human-readable report
//   node scripts/vrm-report.mjs <model.vrm> --json           the same data as JSON
//   node scripts/vrm-report.mjs <model.vrm> --thumb out.png  write the VRM thumbnail
import { writeFileSync } from 'node:fs';
import { describeModel, imageBytes, imageSize, readGlb } from '../lib/vrm-info.js';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function line(label, value) {
  if (value === null || value === undefined || value === '') return;
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function printReport(report) {
  console.log(`${report.name || report.file}  (${formatBytes(report.bytes)})`);
  console.log('');
  console.log('-- container --');
  line('glTF version', report.gltfVersion);
  line('generator', report.generator);
  line('VRM spec', report.vrmSpec);
  line('extensions used', report.extensionsUsed.join(', ') || 'none');
  line('extensions required', report.extensionsRequired.join(', ') || 'none');

  console.log('');
  console.log('-- meta --');
  for (const [key, value] of Object.entries(report.meta || {})) {
    if (value && typeof value === 'object') line(key, JSON.stringify(value));
    else line(key, String(value));
  }

  console.log('');
  console.log('-- counts --');
  for (const [key, value] of Object.entries(report.counts)) line(key, String(value));

  if (report.lookAt) {
    console.log('');
    console.log('-- look at --');
    line('type', report.lookAt.type);
    line('offsetFromHeadBone', JSON.stringify(report.lookAt.offsetFromHeadBone));
  }

  if (report.humanoid) {
    console.log('');
    console.log(`-- humanoid bones (${report.humanoid.count}) --`);
    console.log(`  ${report.humanoid.bones.map((bone) => `${bone.bone}=${bone.name}`).join(', ')}`);
  }

  console.log('');
  console.log(`-- expressions (${report.expressions.length}) --`);
  for (const expression of report.expressions) {
    const targets = expression.binds.length
      ? expression.binds.map((bind) => {
          const name = bind.targetName || `#${bind.target}`;
          const mesh = bind.meshName ? `${bind.meshName}:` : '';
          const weight = bind.weight !== undefined && bind.weight !== 1 ? ` x${bind.weight}` : '';
          return `${mesh}${name}${weight}`;
        }).join(', ')
      : '(none)';
    const binary = expression.isBinary ? ' binary' : '';
    console.log(`  ${String(expression.name || expression.presetName || '?').padEnd(18)} preset=${expression.presetName || '-'}${binary}  -> ${targets}`);
    if (expression.materialValues && expression.materialValues.length) {
      console.log(`      material: ${expression.materialValues.map((value) => `${value.materialName}.${value.propertyName}`).join(', ')}`);
    }
    if (expression.textureTransformBinds && expression.textureTransformBinds.length) {
      console.log(`      uv: ${expression.textureTransformBinds.map((value) => `${value.materialName}.${value.propertyName}`).join(', ')}`);
    }
  }

  if (report.expressionTargets && report.expressionTargets.some((entry) => entry.targets.length)) {
    console.log('');
    console.log('-- which expression drives which morph target --');
    for (const entry of report.expressionTargets) {
      if (!entry.targets.length) continue;
      console.log(`  mesh #${entry.mesh} ${entry.meshName || ''}`);
      entry.targets.forEach((names, target) => {
        console.log(`      target #${String(target).padEnd(3)} ${names.length ? '<- ' + names.join(', ') : '(unused)'}`);
      });
    }
  }

  console.log('');
  console.log('-- meshes --');
  for (const mesh of report.meshes) {
    console.log(`  #${mesh.index} ${mesh.name || '(unnamed)'}: ${mesh.primitives} primitives, ${mesh.vertices} vertices, ${mesh.triangles} triangles, ${mesh.morphTargets} morph targets${mesh.hasSkin ? ', skinned' : ''}`);
    if (mesh.morphTargetNames.length) console.log(`      targets: ${mesh.morphTargetNames.join(', ')}`);
  }

  console.log('');
  console.log('-- materials --');
  for (const material of report.materials) {
    const extras = [];
    if (material.mtoon) extras.push(`mtoon0:${material.mtoon.shader || '?'}`);
    if (material.unlit) extras.push('unlit');
    if (material.extensions.length) extras.push(material.extensions.join('+'));
    console.log(`  #${material.index} ${material.name || '(unnamed)'}: ${material.alphaMode}${material.doubleSided ? ' double-sided' : ''}${extras.length ? ` [${extras.join(', ')}]` : ''}`);
    if (material.mtoon1) {
      const m = material.mtoon1;
      const detail = [
        `outline=${m.outlineWidthFactor}(${m.outlineWidthMode})`,
        `toony=${m.shadingToonyFactor}`,
        `shift=${m.shadingShiftFactor}`,
        `rim=${m.rimLightingMixFactor}`,
        `gi=${m.giEqualizationFactor}`,
        `shade=${JSON.stringify(m.shadeColorFactor)}`,
        m.textures.length ? `tex=${m.textures.join('+')}` : null,
      ].filter(Boolean).join(' ');
      console.log(`      mtoon1 ${detail}`);
    }
  }

  console.log('');
  console.log('-- textures --');
  for (const image of report.images) {
    const size = image.width && image.height ? `${image.width}x${image.height}` : '?';
    console.log(`  #${image.index} ${image.name || '(unnamed)'}: ${image.mimeType || '?'} ${size} ${formatBytes(image.bytes)}`);
  }

  if (report.springBones) {
    console.log('');
    console.log(`-- spring bones (${report.springBones.source}) --`);
    line('groups', String((report.springBones.groups || []).length));
    line('colliders', String(report.springBones.colliders));
    line('collider groups', String(report.springBones.colliderGroups));
    for (const group of report.springBones.groups || []) {
      console.log(`  #${group.index} ${group.comment || ''} bones=${group.bones} colliders=${group.colliderGroups} stiffness=${group.stiffness} drag=${group.dragForce} gravity=${group.gravityPower}`);
    }
  }

  if (report.animations.length) {
    console.log('');
    console.log('-- animations --');
    for (const animation of report.animations) {
      console.log(`  #${animation.index} ${animation.name || '(unnamed)'}: ${animation.channels} channels, ${animation.seconds}s`);
    }
  }
}

const args = process.argv.slice(2);
const path = args.find((argument) => !argument.startsWith('--'));
if (!path) {
  console.error('usage: node scripts/vrm-report.mjs <model.vrm> [--json] [--thumb out.png]');
  process.exit(2);
}

let info;
try {
  info = describeModel(path);
} catch (error) {
  console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (args.includes('--json')) {
  console.log(JSON.stringify(info, null, 2));
} else {
  printReport(info);
}

const thumbIndex = args.indexOf('--thumb');
if (thumbIndex >= 0 && args[thumbIndex + 1]) {
  const index = info.meta && typeof info.meta.thumbnailImageIndex === 'number' ? info.meta.thumbnailImageIndex : null;
  if (index === null) {
    console.error('\nno thumbnail in this model');
  } else {
    // Re-read for the bytes: the report deliberately carries dimensions and sizes, not pixels.
    const glb = readGlb(path);
    const bytes = imageBytes(glb, index);
    if (!bytes) {
      console.error('\nthe thumbnail has no bytes in this file');
    } else {
      writeFileSync(args[thumbIndex + 1], bytes);
      const size = imageSize(bytes, (glb.json.images[index] || {}).mimeType);
      console.log(`\nthumbnail written to ${args[thumbIndex + 1]} (${formatBytes(bytes.length)}${size ? `, ${size.width}x${size.height}` : ''})`);
    }
  }
}

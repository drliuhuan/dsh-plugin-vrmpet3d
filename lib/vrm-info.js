/**
 * What is inside a model file, read straight out of the container.
 *
 * The plugin needs to know a model's expressions, its spring-bone chains, its materials and the
 * licence its author wrote into it — and it needs that WITHOUT a renderer: the settings window has to
 * list a model's expressions even when no pet is running, and the list must always match the file.
 * So the parsing lives here, in the host half, and `scripts/vrm-report.mjs` is a thin CLI over it.
 *
 * Everything is read from the GLB itself: the JSON chunk is the glTF document, the BIN chunk holds
 * the buffers. No engine, no dependency beyond `node:fs`, no network.
 *
 * Both VRM flavours are handled, because the field names are different enough that reading only one
 * makes the other look empty:
 *   * VRM 0.x — `extensions.VRM`: `blendShapeMaster.blendShapeGroups` (with `presetName`),
 *     `secondaryAnimation.boneGroups` (spring chains, named by `comment`), and MToon settings inside
 *     `materialProperties`.
 *   * VRM 1.0 — `extensions.VRMC_vrm`: `expressions.preset` / `expressions.custom` (bound by NODE +
 *     target index), plus the separate top-level `VRMC_springBone` extension and MToon's named
 *     fields in `VRMC_materials_mtoon`.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/**
 * A spring chain's identity for the settings store, mirrored from `core.springChainKey`.
 *
 * The rule is not "the chain's name", because VRM names a chain with a free-text `comment` and most exporters
 * leave it EMPTY — SampleModel.vrm's ten hair strands have no name at all. An empty key cannot be stored
 * (`cleanSprings` drops it) and cannot be looked up (`springOverrideFor` refuses it), so every unnamed chain
 * showed sliders that snapped back: the operator's "设置面板中存在大量无法修改的未命名链", 2026-10-09. The
 * renderer had also invented its own fallback (`hair0`, `hair1`, …), so even a stored value would have been
 * looked up under a different key.
 *
 * This file imports nothing, deliberately (no dependency beyond `node:fs`), so the rule is duplicated here and
 * `scripts/verify-model.mjs` asserts the two halves agree — the same drift guard the motion manifest uses.
 */
function springChainKey(name, kind, index) {
  const declared = typeof name === 'string' ? name.trim() : '';
  if (declared) return declared.slice(0, 128);
  const position = Math.max(0, Math.floor(Number(index)) || 0);
  return `${kind === 'vrm1' ? 'spring' : 'hair'}${position}`;
}

/** Parse the container: header plus its chunks. */
export function readGlbBuffer(buffer, label) {
  if (!buffer || buffer.length < 12 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error(`${label || 'model'}: not a GLB/VRM (the magic is missing)`);
  }
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);
  const chunks = [];
  for (let offset = 12; offset + 8 <= Math.min(length, buffer.length);) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    chunks.push({ type: chunkType, start: offset + 8, length: chunkLength });
    offset += 8 + chunkLength;
  }
  const jsonChunk = chunks.find((chunk) => chunk.type === CHUNK_JSON);
  const binChunk = chunks.find((chunk) => chunk.type === CHUNK_BIN);
  if (!jsonChunk) throw new Error(`${label || 'model'}: the GLB has no JSON chunk`);
  const json = JSON.parse(buffer.subarray(jsonChunk.start, jsonChunk.start + jsonChunk.length).toString('utf8'));
  const bin = binChunk ? buffer.subarray(binChunk.start, binChunk.start + binChunk.length) : null;
  return { buffer, json, bin, version, declaredLength: length, chunks };
}

/** Read a .vrm/.glb from disk and split it. */
export function readGlb(path) {
  return readGlbBuffer(readFileSync(path), basename(path));
}

/** The bytes an image wants: its own bufferView, per the glTF spec. */
export function imageBytes(glb, imageIndex) {
  const image = (glb.json.images || [])[imageIndex];
  if (!image) return null;
  if (typeof image.bufferView === 'number') {
    const view = glb.json.bufferViews[image.bufferView];
    const start = view.byteOffset || 0;
    return glb.bin ? glb.bin.subarray(start, start + view.byteLength) : null;
  }
  return null; // external URIs are not used by VRM exporters in practice
}

/** Pixel size of a PNG or JPEG, straight from its header. */
export function imageSize(bytes, mimeType) {
  if (!bytes || bytes.length < 24) return null;
  if (/png$/i.test(mimeType || '') || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (/jpe?g$/i.test(mimeType || '') || bytes[0] === 0xff) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const size = bytes.readUInt16BE(offset + 2);
      // SOF0..SOF15, excluding the DHT/DAC/RST markers that share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + size;
    }
  }
  return null;
}

/** The image type the bytes actually are, or null. Same two formats VRM allows. */
export function imageMimeType(bytes) {
  if (bytes && bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return null;
}

/**
 * The thumbnail a VRM carries, as the image a model picker can show.
 *
 * The two flavours index DIFFERENT tables and that is the whole reason this helper exists rather than a
 * `meta.thumbnailImage` read at each call site:
 *
 *   * VRM 0.x — `extensions.VRM.meta.texture` is a TEXTURE index, so it is only the image after
 *     `textures[i].source`. On most VRoid exports the two happen to be equal (the bundled `SampleModel.vrm`
 *     is one: texture 26 -> image 26), which is exactly how a raw read looks correct for months and then
 *     hands back somebody's eyebrow texture on the first model whose textures share or reorder images.
 *   * VRM 1.0 — `extensions.VRMC_vrm.meta.thumbnailImage` IS an image index, used as it stands.
 *
 * `null` covers every "there is no thumbnail here" case the caller must survive: a plain `.glb` with no VRM
 * extension, a VRM whose meta names an index that does not exist, and an image stored behind an external URI
 * rather than in the BIN chunk (only the bundled `bufferView` form is read — see `imageBytes`).
 *
 * @returns {{index:number, bytes:Buffer, mimeType:string, via:string, width:number|null, height:number|null}|null}
 */
export function thumbnailImage(glb) {
  const json = (glb && glb.json) || {};
  const vrm0 = json.extensions && json.extensions.VRM;
  const vrm1 = json.extensions && json.extensions.VRMC_vrm;
  let index = null;
  let via = null;
  if (vrm0 && vrm0.meta && typeof vrm0.meta.texture === 'number') {
    const texture = (json.textures || [])[vrm0.meta.texture];
    index = texture && typeof texture.source === 'number' ? texture.source : null;
    via = 'VRM 0.x meta.texture';
  } else if (vrm1 && vrm1.meta && typeof vrm1.meta.thumbnailImage === 'number') {
    index = vrm1.meta.thumbnailImage;
    via = 'VRM 1.0 meta.thumbnailImage';
  }
  if (typeof index !== 'number' || index < 0) return null;
  const image = (json.images || [])[index];
  if (!image) return null;
  const bytes = imageBytes(glb, index);
  if (!bytes || !bytes.length) return null;
  const mimeType = /^image\//.test(image.mimeType || '') ? image.mimeType : (imageMimeType(bytes) || 'application/octet-stream');
  const size = imageSize(bytes, mimeType);
  return {
    index,
    bytes,
    mimeType,
    via,
    width: size ? size.width : null,
    height: size ? size.height : null,
  };
}

/**
 * Morph-target names per mesh, as authored.
 *
 * Blender writes them into `primitive.extras.targetNames`. Plenty of models — including the one that
 * drove this feature — have none, and then a target is only a number: the VRM expression table is
 * the only thing that knows what "#0" means. That is the whole reason `expressionTargets` below
 * exists.
 */
export function morphTargetNames(gltf, meshIndex) {
  const mesh = (gltf.meshes || [])[meshIndex];
  if (!mesh) return [];
  for (const primitive of mesh.primitives || []) {
    const names = primitive.extras && primitive.extras.targetNames;
    if (Array.isArray(names)) return names;
  }
  return [];
}

function accessorCount(gltf, index) {
  const accessor = (gltf.accessors || [])[index];
  return accessor ? accessor.count : null;
}

/**
 * How much of a model's structure list travels to the settings page.
 *
 * Every node, mesh and material name is offered as something a user can add to a part, so the list is the
 * model's whole rig — 162 to 343 entries on the models measured on 2026-10-11. Capped rather than trusted: a
 * generated or broken file can declare tens of thousands of nodes, and this crosses the wire on every open of
 * the settings window.
 */
const STRUCTURE_LIMITS = {
  maxStructures: 600,
  maxNameLength: 128,
};

function nodeName(gltf, index) {
  const node = (gltf.nodes || [])[index];
  if (!node) return `#${index}`;
  return node.name || `#${index}`;
}

/** Everything worth knowing about one model, as plain data. */
export function describeGlb(glb, label) {
  const gltf = glb.json;
  const vrm0 = gltf.extensions && gltf.extensions.VRM;
  const vrm1 = gltf.extensions && gltf.extensions.VRMC_vrm;
  const report = {
    file: label || null,
    name: label ? basename(label) : null,
    bytes: glb.buffer.length,
    glbVersion: glb.version,
    generator: (gltf.asset || {}).generator || null,
    copyright: (gltf.asset || {}).copyright || null,
    gltfVersion: (gltf.asset || {}).version || null,
    extensionsUsed: gltf.extensionsUsed || [],
    extensionsRequired: gltf.extensionsRequired || [],
    vrmSpec: vrm0 ? '0.x (extensions.VRM)' : (vrm1 ? '1.0 (extensions.VRMC_vrm)' : 'none'),
    supported: Boolean(vrm0 || vrm1),
    counts: {
      scenes: (gltf.scenes || []).length,
      nodes: (gltf.nodes || []).length,
      meshes: (gltf.meshes || []).length,
      materials: (gltf.materials || []).length,
      textures: (gltf.textures || []).length,
      images: (gltf.images || []).length,
      skins: (gltf.skins || []).length,
      animations: (gltf.animations || []).length,
      accessors: (gltf.accessors || []).length,
      bufferBytes: gltf.buffers && gltf.buffers[0] ? gltf.buffers[0].byteLength : null,
    },
    meta: null,
    humanoid: null,
    lookAt: null,
    firstPerson: null,
    expressions: [],
    expressionTargets: [],
    meshes: [],
    materials: [],
    images: [],
    springBones: null,
    animations: [],
  };

  // ---- meta -----------------------------------------------------------------------------------
  if (vrm0 && vrm0.meta) {
    report.meta = {
      title: vrm0.meta.title || null,
      author: vrm0.meta.author || null,
      version: vrm0.meta.version || null,
      contactInformation: vrm0.meta.contactInformation || null,
      reference: vrm0.meta.reference || null,
      thumbnailImageIndex: typeof vrm0.meta.texture === 'number' ? vrm0.meta.texture : null,
      licenseName: vrm0.meta.licenseName || null,
      otherLicenseUrl: vrm0.meta.otherLicenseUrl || null,
      permissions: {
        allowedUserName: vrm0.meta.allowedUserName,
        violentUses: vrm0.meta.violentUses,
        sexualUses: vrm0.meta.sexualUses,
        commercialUses: vrm0.meta.commercialUses,
      },
      exporterVersion: vrm0.exporterVersion || null,
      specVersion: vrm0.specVersion || null,
    };
  } else if (vrm1 && vrm1.meta) {
    const meta = vrm1.meta;
    report.meta = {
      name: meta.name || null,
      version: meta.version || null,
      authors: meta.authors || [],
      copyrightInformation: meta.copyrightInformation || null,
      thirdPartyLicenses: meta.thirdPartyLicenses || null,
      thumbnailImageIndex: typeof meta.thumbnailImage === 'number' ? meta.thumbnailImage : null,
      licenseUrl: meta.licenseUrl || null,
      avatarPermission: meta.avatarPermission || null,
      allowExcessivelyViolentUsage: meta.allowExcessivelyViolentUsage,
      allowExcessivelySexualUsage: meta.allowExcessivelySexualUsage,
      commercialUsage: meta.commercialUsage || null,
      allowPoliticalOrReligiousUsage: meta.allowPoliticalOrReligiousUsage,
      allowAntisocialOrHateUsage: meta.allowAntisocialOrHateUsage,
      creditNotation: meta.creditNotation || null,
      allowRedistribution: meta.allowRedistribution || null,
      modification: meta.modification || null,
      otherLicenseUrl: meta.otherLicenseUrl || null,
      exporterVersion: vrm1.specVersion || null,
    };
  }

  // ---- humanoid bones -------------------------------------------------------------------------
  const humanBones = (vrm0 && vrm0.humanoid && vrm0.humanoid.humanBones)
    || (vrm1 && vrm1.humanoid && vrm1.humanoid.humanBones)
    || null;
  if (humanBones) {
    const bones = [];
    for (const [bone, entry] of Object.entries(humanBones)) {
      if (!entry) continue;
      const index = entry.node;
      bones.push({ bone, node: index, name: typeof index === 'number' ? nodeName(gltf, index) : null });
    }
    bones.sort((left, right) => left.bone.localeCompare(right.bone));
    report.humanoid = { count: bones.length, bones };
  }

  // ---- expressions ----------------------------------------------------------------------------
  const groups = (vrm0 && vrm0.blendShapeMaster && vrm0.blendShapeMaster.blendShapeGroups) || [];
  for (const group of groups) {
    report.expressions.push({
      kind: 'vrm0',
      name: group.name || null,
      presetName: group.presetName || null,
      isBinary: group.isBinary === true,
      binds: (group.binds || []).map((bind) => {
        const names = morphTargetNames(gltf, bind.mesh);
        return {
          mesh: bind.mesh,
          meshName: (gltf.meshes && gltf.meshes[bind.mesh] ? gltf.meshes[bind.mesh].name : null) || null,
          target: bind.index,
          targetName: names[bind.index] || null,
          weight: bind.weight,
        };
      }),
      materialValues: (group.materialValues || []).map((value) => ({
        materialName: value.materialName,
        propertyName: value.propertyName,
        targetValue: value.targetValue,
      })),
      textureTransformBinds: [],
    });
  }
  if (vrm1 && vrm1.expressions) {
    for (const kind of ['preset', 'custom']) {
      const table = vrm1.expressions[kind] || {};
      for (const [name, expression] of Object.entries(table)) {
        report.expressions.push({
          kind: `vrm1:${kind}`,
          name,
          presetName: kind === 'preset' ? name : null,
          isBinary: expression.isBinary === true,
          // VRM 1.0 binds a NODE (usually the mesh's own node), not a mesh index, so the morph
          // target's authored name has to be reached through that node's mesh.
          binds: (expression.morphTargetBinds || []).map((bind) => {
            const node = (gltf.nodes || [])[bind.node] || {};
            const meshIndex = typeof node.mesh === 'number' ? node.mesh : null;
            const names = meshIndex === null ? [] : morphTargetNames(gltf, meshIndex);
            return {
              node: bind.node,
              nodeName: nodeName(gltf, bind.node),
              mesh: meshIndex,
              meshName: meshIndex !== null && gltf.meshes && gltf.meshes[meshIndex]
                ? gltf.meshes[meshIndex].name
                : null,
              target: bind.index,
              targetName: names[bind.index] || null,
              weight: bind.weight,
            };
          }),
          materialValues: (expression.materialColorBinds || []).map((bind) => ({
            materialName: (gltf.materials && gltf.materials[bind.material] ? gltf.materials[bind.material].name : null) || null,
            propertyName: bind.type,
            targetValue: bind.targetValue,
          })),
          textureTransformBinds: (expression.textureTransformBinds || []).map((bind) => ({
            materialName: (gltf.materials && gltf.materials[bind.material] ? gltf.materials[bind.material].name : null) || null,
            propertyName: bind.type,
            scale: bind.scale,
            offset: bind.offset,
          })),
        });
      }
    }
  }

  // ---- how the model wants to be looked at ----------------------------------------------------
  // `type: 'expression'` means the model's own look* morph targets do the work, and a gaze driven by
  // BONES would leave the eyes still; `type: 'bone'` is the opposite. Worth knowing before wiring one.
  report.lookAt = (vrm1 && vrm1.lookAt)
    ? {
        type: vrm1.lookAt.type || null,
        offsetFromHeadBone: vrm1.lookAt.offsetFromHeadBone || null,
        rangeMap: vrm1.lookAt.rangeMap || null,
      }
    : null;
  report.firstPerson = (vrm1 && vrm1.firstPerson)
    ? {
        annotations: (vrm1.firstPerson.meshAnnotations || []).length,
        lookAtType: vrm1.firstPerson.lookAtType || null,
      }
    : null;

  // ---- meshes and their morph targets ---------------------------------------------------------
  (gltf.meshes || []).forEach((mesh, meshIndex) => {
    const names = morphTargetNames(gltf, meshIndex);
    let vertices = 0;
    let triangles = 0;
    let targets = 0;
    const attributes = new Set();
    for (const primitive of mesh.primitives || []) {
      vertices += accessorCount(gltf, primitive.attributes.POSITION) || 0;
      if (typeof primitive.indices === 'number') triangles += Math.floor((accessorCount(gltf, primitive.indices) || 0) / 3);
      targets = Math.max(targets, (primitive.targets || []).length);
      Object.keys(primitive.attributes || {}).forEach((key) => attributes.add(key));
    }
    report.meshes.push({
      index: meshIndex,
      name: mesh.name || null,
      primitives: (mesh.primitives || []).length,
      vertices,
      triangles,
      morphTargets: targets,
      morphTargetNames: names,
      hasSkin: (mesh.primitives || []).some((primitive) => typeof primitive.attributes.JOINTS_0 === 'number'),
      attributes: [...attributes].sort(),
    });
  });

  // ---- materials ------------------------------------------------------------------------------
  (gltf.materials || []).forEach((material, index) => {
    const pbr = material.pbrMetallicRoughness || {};
    const extensions = material.extensions || {};
    const mtoon = extensions.VRM && extensions.VRM.materialProperties;
    const mtoon1 = extensions.VRMC_materials_mtoon || null;
    report.materials.push({
      index,
      name: material.name || null,
      alphaMode: material.alphaMode || 'OPAQUE',
      doubleSided: material.doubleSided === true,
      baseColor: pbr.baseColorFactor || null,
      baseColorTexture: typeof pbr.baseColorTexture === 'object' ? pbr.baseColorTexture.index : null,
      metallicFactor: pbr.metallicFactor,
      roughnessFactor: pbr.roughnessFactor,
      normalTexture: typeof material.normalTexture === 'object' ? material.normalTexture.index : null,
      emissiveFactor: material.emissiveFactor || null,
      extensions: Object.keys(extensions),
      unlit: Boolean(extensions.KHR_materials_unlit),
      // MToon 0.x keeps every setting as a "property" inside one blob; 1.0 writes named fields. Both
      // are reported so a 1.0 model does not look as if it had no toon settings at all.
      mtoon: mtoon
        ? {
            shader: mtoon.shader || null,
            renderQueue: mtoon.renderQueue,
            floatProperties: mtoon.floatProperties || {},
            vectorProperties: Object.keys(mtoon.vectorProperties || {}),
            textureProperties: Object.keys(mtoon.textureProperties || {}),
            keywordMap: mtoon.keywordMap || {},
          }
        : null,
      mtoon1: mtoon1
        ? {
            specVersion: mtoon1.specVersion || null,
            outlineWidthFactor: mtoon1.outlineWidthFactor,
            outlineWidthMode: mtoon1.outlineWidthMode || null,
            outlineColorFactor: mtoon1.outlineColorFactor || null,
            shadingToonyFactor: mtoon1.shadingToonyFactor,
            shadingShiftFactor: mtoon1.shadingShiftFactor,
            shadeColorFactor: mtoon1.shadeColorFactor || null,
            giEqualizationFactor: mtoon1.giEqualizationFactor,
            rimLightingMixFactor: mtoon1.rimLightingMixFactor,
            transparentWithZWrite: mtoon1.transparentWithZWrite === true,
            renderQueueOffsetNumber: mtoon1.renderQueueOffsetNumber,
            textures: Object.keys(mtoon1).filter((key) => mtoon1[key]
              && typeof mtoon1[key] === 'object'
              && typeof mtoon1[key].index === 'number'),
          }
        : null,
    });
  });

  // ---- images (dimensions, not just byte counts) ----------------------------------------------
  (gltf.images || []).forEach((image, index) => {
    const bytes = imageBytes(glb, index);
    const size = bytes ? imageSize(bytes, image.mimeType) : null;
    report.images.push({
      index,
      name: image.name || null,
      mimeType: image.mimeType || null,
      bytes: bytes ? bytes.length : null,
      width: size ? size.width : null,
      height: size ? size.height : null,
    });
  });

  // ---- spring bones (hair, tails, cloth) ------------------------------------------------------
  if (vrm0 && vrm0.secondaryAnimation) {
    const secondary = vrm0.secondaryAnimation;
    report.springBones = {
      source: 'VRM.secondaryAnimation',
      specVersion: vrm0.specVersion || null,
      groups: (secondary.boneGroups || []).map((group, index) => ({
        index,
        // `key` is what an override is stored under (never empty); `comment` stays what the file says, which
        // for most VRM 0.x hair strands is nothing at all.
        key: springChainKey(group.comment, 'vrm0', index),
        comment: group.comment || null,
        // VRM 0.x has no pairing: every listed bone is animated, so the two counts agree.
        entries: (group.bones || []).length,
        bones: (group.bones || []).length,
        first: group.bones && group.bones.length ? nodeName(gltf, group.bones[0]) : null,
        colliderGroups: (group.colliderGroups || []).length,
        stiffness: group.stiffiness,
        dragForce: group.dragForce,
        gravityPower: group.gravityPower,
      })),
      colliders: (secondary.colliderGroups || []).reduce((total, group) => total + (group.colliders || []).length, 0),
      colliderGroups: (secondary.colliderGroups || []).length,
    };
  } else if (vrm1 && vrm1.springBone) {
    // VRM 1.0 keeps spring bones in a SEPARATE top-level extension; some exporters also nest a copy.
    report.springBones = describeSpringBone(gltf, vrm1.springBone, 'VRMC_vrm.springBone');
  } else if (gltf.extensions && gltf.extensions.VRMC_springBone) {
    report.springBones = describeSpringBone(gltf, gltf.extensions.VRMC_springBone, 'VRMC_springBone');
  }

  // ---- animations -----------------------------------------------------------------------------
  (gltf.animations || []).forEach((animation, index) => {
    let duration = 0;
    for (const sampler of animation.samplers || []) {
      const input = (gltf.accessors || [])[sampler.input];
      if (input && Array.isArray(input.max) && Number.isFinite(input.max[0])) duration = Math.max(duration, input.max[0]);
    }
    report.animations.push({
      index,
      name: animation.name || null,
      channels: (animation.channels || []).length,
      samplers: (animation.samplers || []).length,
      seconds: Number(duration.toFixed(3)),
    });
  });

  // ---- the reverse map: which expression drives which morph target -----------------------------
  // This is the table a caller actually needs, because a target may have no name of its own: the mesh
  // says "#7" and only the VRM expression table knows that "#7" is the `aa` mouth shape.
  report.expressionTargets = report.meshes.map((mesh) => ({
    mesh: mesh.index,
    meshName: mesh.name,
    targets: Array.from({ length: mesh.morphTargets }, () => []),
  }));
  for (const expression of report.expressions) {
    for (const bind of expression.binds) {
      const entry = report.expressionTargets.find((item) => item.mesh === bind.mesh);
      if (!entry || typeof bind.target !== 'number') continue;
      while (entry.targets.length <= bind.target) entry.targets.push([]);
      if (!entry.targets[bind.target].includes(expression.name)) entry.targets[bind.target].push(expression.name);
    }
  }

  /**
   * ---- the structures a press can land on ------------------------------------------------------
   *
   * The settings page lets a user build their own PARTS and add "the structures this part owns" to them, so it
   * needs the names the renderer can actually report: NODE names are what a bone-driven hit resolves to
   * (`J_Bip_C_Head`, `LiuHai`, `TwinTail.A.001.L`), and mesh and material names are what an unskinned hit falls
   * back to (`Face`, `Hair`). Names only — and that is deliberate: which default region a name falls into is a
   * heuristic that lives in `core.structureRegionOf`, and a second copy here would be a second answer.
   *
   * Measured against the operator's models: 162–343 nodes, so this is a few kilobytes per model, capped rather
   * than trusted.
   */
  report.structures = [];
  const seenStructures = {};
  const addStructure = (name, kind) => {
    if (typeof name !== 'string') return;
    const trimmed = name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, STRUCTURE_LIMITS.maxNameLength);
    if (!trimmed || seenStructures[trimmed]) return;
    if (report.structures.length >= STRUCTURE_LIMITS.maxStructures) return;
    seenStructures[trimmed] = true;
    report.structures.push({ name: trimmed, kind });
  };
  // Nodes first: a bone name is the better evidence, so a name that is both a node and a mesh keeps its node
  // identity — and with it the position the picker lists it in.
  for (const node of gltf.nodes || []) addStructure(node.name, 'node');
  for (const mesh of gltf.meshes || []) addStructure(mesh.name, 'mesh');
  for (const material of gltf.materials || []) addStructure(material.name, 'material');

  return report;
}

/**
 * The spring-bone extension, whichever shape it arrived in.
 *
 * A VRM 1.0 chain is a list of PAIRS: entry k is a joint whose tail is entry k+1. N entries therefore
 * animate N-1 joints, and the final entry is only a tail — which is exactly how three-vrm imports
 * them, and therefore what the renderer can move at all. Both numbers are reported: "entries" is what
 * the file says, "bones" is what a consumer animates, and a window built on "entries" would offer
 * sliders for a joint nothing moves. VRM 0.x lists every bone as its own joint, so there the two
 * agree.
 */
function describeSpringBone(gltf, spring, source) {
  const paired = source !== 'VRM.secondaryAnimation';
  const groups = (spring.springs || []).map((group, index) => {
    const joints = (group.joints || []).map((joint) => ({
      node: joint.node,
      name: nodeName(gltf, joint.node),
      hitRadius: joint.hitRadius,
      stiffness: joint.stiffness,
      gravityPower: joint.gravityPower,
      dragForce: joint.dragForce,
    }));
    const animated = paired ? Math.max(0, joints.length - 1) : joints.length;
    return {
      index,
      // The same rule as the renderer's: `springs[i].name` is optional in VRM 1.0 too, so an unnamed spring
      // falls back to its index — the identity an override is stored under.
      key: springChainKey(group.name, paired ? 'vrm1' : 'vrm0', index),
      comment: group.name || null,
      entries: joints.length,
      bones: animated,
      first: joints.length ? joints[0].name : null,
      colliderGroups: (group.colliderGroups || []).length,
      stiffness: joints.length ? joints[0].stiffness : null,
      dragForce: joints.length ? joints[0].dragForce : null,
      gravityPower: joints.length ? joints[0].gravityPower : null,
      joints,
    };
  });
  return {
    source,
    specVersion: spring.specVersion || null,
    groups,
    colliders: (spring.colliders || []).length,
    colliderGroups: (spring.colliderGroups || []).length,
    /**
     * EVERY collider, named and measured, so the settings window can offer one switch per collider.
     *
     * Operator, 2026-10-14: 「只有body组一个碰撞体组吗？可以做成详细面板一个个开关吗？」. The counts above answer "how many"; a
     * switch per collider needs to know WHICH — the bone it was declared on and the radius it was given, because the
     * radius is exactly what decides whether a chain gets pushed out into a plate (see `lib/scene.js`).
     *
     * `key` is `"<group>:<collider within that group>"`, the same pair the renderer's filter matches against, and it is
     * positional on purpose: it is stable for one file and meaningless for another, which is what a stored preference
     * needs to be. VRM 1.0 keeps colliders in one flat list that groups INDEX INTO; VRM 0.x inlines them in each group.
     */
    detail: (() => {
      const describe = (spec) => {
        const shape = spec && spec.shape && typeof spec.shape === 'object' ? spec.shape : null;
        const kind = shape ? Object.keys(shape)[0] || null : null;
        const body = kind && shape[kind] && typeof shape[kind] === 'object' ? shape[kind] : null;
        return {
          kind,
          radius: body && Number.isFinite(Number(body.radius)) ? Number(body.radius) : Number(spec && spec.radius) || null,
          inside: Boolean(body && body.inside === true),
        };
      };
      const list = [];
      (spring.colliderGroups || []).forEach((group, groupIndex) => {
        (group.colliders || []).forEach((ref, colliderIndex) => {
          // VRM 1.0: the entry is an INDEX into `spring.colliders`. VRM 0.x: the entry IS the spec, and the group
          // itself carries the bone.
          const spec = typeof ref === 'number' || typeof ref === 'string' ? (spring.colliders || [])[Number(ref)] || null : ref;
          const described = describe(spec);
          list.push({
            key: groupIndex + ':' + colliderIndex,
            group: groupIndex,
            groupName: typeof group.name === 'string' && group.name ? group.name : null,
            bone: nodeName(gltf, spec && spec.node !== undefined ? spec.node : group.node),
            kind: described.kind,
            radius: described.radius,
            inside: described.inside,
          });
        });
      });
      return list.slice(0, 64);
    })(),
  };
}

// ===========================================================================
// The described-model cache
// ===========================================================================

/**
 * How many described models are kept in memory at once.
 *
 * The report of a real VRM is tens of kilobytes of plain objects, so a handful is a few hundred
 * kilobytes at most — nothing like the tens of megabytes the FILE weighs. Four is what a session
 * needs: the pet's model, the one the settings window is open on, and the one being switched to,
 * with a spare. Bounded on purpose, because a user may walk a whole directory of models
 * (`/vrmpet3d/catalog` lists them all) and this must never become a second copy of everything imported.
 */
export const MODEL_INFO_CACHE_CAPACITY = 4;

/**
 * The entries, in use order: the first key is the least recently used one.
 *
 * A `Map` rather than an object because insertion order is the access order here — a hit re-inserts
 * its key, so `keys().next()` is always the eviction candidate.
 */
const modelInfoCache = new Map();

/** What the cache has done, for the suite and for anyone asking "is this actually resident?". */
const modelInfoCounters = { hits: 0, misses: 0, parses: 0, evictions: 0 };

/**
 * Read a model from disk and describe it, through the process-wide cache.
 *
 * The freshness check is a `statSync` — size plus `mtimeMs`, the pair the old route-level cache used —
 * because it is the only cheap way to tell "the same file I already parsed" from "the file the user just
 * replaced". A file edited IN PLACE with the same byte count inside the same millisecond of mtime is the
 * one case this cannot see; `forgetModelInfo`/`clearModelInfoCache` are the answer to that, and the
 * import routes call them (see `lib/index.js`'s `/vrmpet3d/models` POST).
 *
 * Returns the CACHED report itself, not a copy: the route wraps it into a fresh response object, and
 * copying a report of this size on every request is the cost this cache exists to remove. Callers must
 * therefore treat the result as read-only.
 *
 * @param {string} path a model file, `.vrm`/`.glb`
 * @param {{size:number, mtimeMs:number}} [stats] a `statSync` result the caller already has
 * @returns {object} the report `describeGlb` produces
 */
export function describeModelCached(path, stats) {
  const absolute = resolve(path);
  let current = stats;
  if (!current) {
    try {
      current = statSync(absolute);
    } catch {
      // Gone, or unreadable: the cache cannot be checked against it, and `readGlb` below is what
      // raises the error the caller already handles. Drop the stale entry on the way.
      modelInfoCache.delete(absolute);
      modelInfoCounters.misses += 1;
      modelInfoCounters.parses += 1;
      return describeGlb(readGlb(absolute), absolute);
    }
  }

  const size = Number(current.size);
  const mtimeMs = Number(current.mtimeMs);
  const cached = modelInfoCache.get(absolute);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    // A hit is also the access that makes this the most recently used entry.
    modelInfoCache.delete(absolute);
    modelInfoCache.set(absolute, cached);
    modelInfoCounters.hits += 1;
    return cached.info;
  }

  modelInfoCounters.misses += 1;
  modelInfoCache.delete(absolute);
  modelInfoCounters.parses += 1;
  // Deliberately NOT wrapped in try/catch: a file that cannot be described has to raise exactly the
  // error it raised before there was a cache, because `/vrmpet3d/model-info` turns that error into its
  // `{ supported: false, reason }` answer. A failure is never a cache entry.
  const info = describeGlb(readGlb(absolute), absolute);

  modelInfoCache.set(absolute, { size, mtimeMs, info });
  while (modelInfoCache.size > MODEL_INFO_CACHE_CAPACITY) {
    const oldest = modelInfoCache.keys().next().value;
    modelInfoCache.delete(oldest);
    modelInfoCounters.evictions += 1;
  }
  return info;
}

/**
 * Read a model from disk and describe it, through the cache above.
 *
 * The same entry point as before there was a cache, on purpose: every existing caller (`scripts/vrm-report.mjs`,
 * `scripts/verify-desktop.mjs`) keeps reading a fresh-enough report without knowing this exists.
 */
export function describeModel(path) {
  return describeModelCached(path);
}

/**
 * Drop one path's entry, so the next `describeModel` re-reads the file.
 *
 * The explicit half of the invalidation: a route that KNOWS the file changed must not wait for the
 * size/mtime check to notice. Does nothing when the path was never cached.
 *
 * @param {string} path
 * @returns {boolean} whether an entry was dropped
 */
export function forgetModelInfo(path) {
  return modelInfoCache.delete(resolve(path));
}

/** Drop every entry, so nothing is ever served from a previous life of the catalog. */
export function clearModelInfoCache() {
  modelInfoCache.clear();
}

/**
 * What the cache currently holds and has done.
 *
 * `parses` is the number that matters to a test: two requests for the same unchanged file must leave
 * it where it was, which is the only way to prove the second was answered from memory rather than
 * re-parsed into an identical-looking object.
 *
 * @returns {{size:number, capacity:number, keys:string[], hits:number, misses:number, parses:number, evictions:number}}
 */
export function cacheStats() {
  return {
    size: modelInfoCache.size,
    capacity: MODEL_INFO_CACHE_CAPACITY,
    keys: [...modelInfoCache.keys()],
    ...modelInfoCounters,
  };
}

/**
 * The projection the settings window needs, over HTTP.
 *
 * Everything the UI lists, and nothing that is only interesting in a full report: the whole parse
 * of a real model carries every joint, every material key and every image, which is tens of
 * kilobytes that a page does not need. Keeping this separate also means the wire format can stay
 * stable while the report grows.
 */
export function compactModelInfo(info) {
  return {
    supported: info.supported === true,
    vrmSpec: info.vrmSpec,
    generator: info.generator,
    counts: info.counts,
    meta: info.meta,
    lookAt: info.lookAt,
    humanoid: info.humanoid ? { count: info.humanoid.count } : null,
    /**
     * The names a press can land on, for the parts editor.
     *
     * The union of node, mesh and material names, deduplicated and capped. The page turns each one into a
     * default region itself (`core.structureRegionOf`), which is why no region is computed here — one table,
     * one answer.
     */
    structures: (info.structures || []).map((entry) => ({ name: entry.name, kind: entry.kind })),
    // Expression names, their kind, and the morph targets they drive — everything a control needs.
    expressions: info.expressions.map((expression) => ({
      name: expression.name,
      presetName: expression.presetName,
      kind: expression.kind,
      isBinary: expression.isBinary,
      binds: expression.binds.map((bind) => ({
        mesh: bind.mesh,
        meshName: bind.meshName,
        target: bind.target,
        targetName: bind.targetName,
        weight: bind.weight,
      })),
      materialBinds: expression.materialValues ? expression.materialValues.length : 0,
      textureBinds: expression.textureTransformBinds ? expression.textureTransformBinds.length : 0,
    })),
    // Spring chains with the physics the FILE declares: the authored values are what "default" means
    // in the UI, so they have to travel with the list.
    springs: info.springBones
      ? {
          source: info.springBones.source,
          specVersion: info.springBones.specVersion,
          colliders: info.springBones.colliders,
          colliderGroups: info.springBones.colliderGroups,
          /**
           * One entry per collider — see the detail note in describeSpringBone: the key the renderer filters by,
           * the group it belongs to, the bone it sits on, and the radius it was authored with.
           */
          detail: (info.springBones.detail || []).map((entry) => ({
            key: entry.key,
            group: entry.group,
            groupName: entry.groupName,
            bone: entry.bone,
            kind: entry.kind,
            radius: entry.radius,
            inside: entry.inside,
          })),
          groups: (info.springBones.groups || []).map((group) => ({
            index: group.index,
            /**
             * `key` is the identity a spring override is STORED under, and it is never empty.
             *
             * `name` is what the file declares, which for most VRM 0.x hair strands is nothing at all; the key
             * falls back to the index so ten unnamed chains stop sharing the empty string, which could not be
             * stored and could not be looked up (operator: "设置面板中存在大量无法修改的未命名链", 2026-10-09).
             */
            key: group.key,
            name: group.comment,
            // bones is what a consumer animates; entries is what the file lists.
            bones: group.bones,
            entries: group.entries,
            first: group.first,
            colliderGroups: group.colliderGroups,
            stiffness: group.stiffness,
            dragForce: group.dragForce,
            gravityPower: group.gravityPower,
          })),
        }
      : null,
    meshes: info.meshes.map((mesh) => ({
      index: mesh.index,
      name: mesh.name,
      vertices: mesh.vertices,
      triangles: mesh.triangles,
      morphTargets: mesh.morphTargets,
    })),
    materials: info.materials.map((material) => ({
      index: material.index,
      name: material.name,
      alphaMode: material.alphaMode,
      doubleSided: material.doubleSided,
      extensions: material.extensions,
    })),
    images: info.images.map((image) => ({
      index: image.index,
      name: image.name,
      mimeType: image.mimeType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    })),
  };
}

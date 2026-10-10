/**
 * Vendor entry for the bundled 3D renderer chunk.
 *
 * This file is NOT shipped. `scripts/vendor-build.mjs` compiles it with esbuild
 * into `lib/client.vendor.js` and then appends the DSH client module
 * registration, so the committed chunk has two working delivery paths:
 *
 *   1. the module system — `await require.async('./client.vendor.js')` in
 *      `lib/client.js`, which is the only sanctioned way to reach a
 *      package-local chunk: the loader composes the per-package URL and carries
 *      the `?rev=` the server requires;
 *   2. this global, which the inline browser harnesses — and any plain
 *      `<script src>` path — still read directly.
 *
 * Both are needed, and the reason is worth keeping. The global alone never
 * worked in the app: the hand-rolled `<script src>` that produced it dropped the
 * `?rev=`, which the server rejects, and resolved against the plugin's *combo*
 * URL (`/plugins/??…`) rather than its per-package path. The registration alone
 * would break the harnesses, which run no module system at all.
 *
 * Keeping this a separate, lazily loaded chunk means `lib/client.js` (the pet
 * logic) stays small and readable, and a session that never shows the pet never
 * pays for the ~2.5 MB vendor blob.
 */

// --- three.js core ---------------------------------------------------------
import * as THREE from 'three';

// --- VRM 1.0 / 0.x ---------------------------------------------------------
// VRMLoaderPlugin parses the VRMC_vrm + VRMC_springBone + VRMC_materials_mtoon
// extensions after GLTFLoader has read the underlying glTF.
//
// `.vrma` authored motion lives in its own package. It is bundled because the
// pet can play a user-supplied motion per state: `VRMAnimationLoaderPlugin`
// parses the `VRMC_vrm_animation` extension into `gltf.userData.vrmAnimations`,
// and `createVRMAnimationClip` retargets one of those onto an already-loaded VRM.
//
// The *procedural* idle stays the default, because it loops exactly and needs no
// asset — an authored clip is only as loopable as its author made it. See
// docs/ASSET-CONTRACT.md.
import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import {
  VRMLoaderPlugin,
  VRMUtils,
  VRMHumanBoneName,
  VRMExpressionPresetName,
  VRMHumanoid,
  VRMExpressionManager,
  VRMSpringBoneManager,
} from '@pixiv/three-vrm';

// --- MMD (PMX / PMD / VMD / VPD) ------------------------------------------
// MMDLoader parses itself (it bundles its own PMX/PMD reader) and assembles the
// result into geometry, skeleton, materials and morph targets.
//
// `buildAnimation` and `VmdObject` are listed here for a reason that is easy to
// undo by accident: `VMDLoader.load()` hands back a parsed `VmdObject`, NOT an
// AnimationClip, and `buildAnimation(vmd, mesh)` is the function that turns one
// into the other. They are only reachable through this bag, so if either is
// dropped from the list below esbuild tree-shakes it out of the chunk and the
// plugin is left with no route from a `.vmd` file to a playable clip — with no
// error until a user selects a motion. `VmdObject.ParseFromBuffer` is also the
// only in-memory VMD entry point (the loader is URL-only), which matters because
// the pet receives its bytes from a host route, not a URL it can hand a loader.
//
// Physics is deliberately NOT wired. @moeru/three-mmd ships no physics engine and
// expects the host to supply one (an `ammo.js` or spring-bone package); a
// desktop pet wants explicit bone animation instead, because a rigid-body
// simulation is not deterministic between runs and cannot be looped exactly.
// VMD playback does not need one: every physics call in the package is
// optional-chained, so an unrigged skeleton still animates. See
// docs/ASSET-CONTRACT.md.
import {
  MMDLoader,
  VMDLoader,
  VPDLoader,
  MMD,
  MMDAnimationManager,
  buildAnimation,
  VmdObject,
} from '@moeru/three-mmd';

// --- addons ---------------------------------------------------------------
// MMDLoader itself imports TGALoader, so it is in the graph regardless; the rest
// are the fallbacks a user's own model files realistically need.
//
// DRACOLoader and KTX2Loader are deliberately NOT bundled. Both build their
// decoder URLs from `import.meta.url` as a module side effect, and an IIFE
// bundle has no `import.meta`, so merely importing them throws `TypeError:
// Invalid URL` at load time — taking the whole chunk down. Neither is used by
// VRM or PMX, so the fix is to omit them rather than ship a broken shim.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

globalThis.__PET3D_VENDOR__ = {
  THREE,
  VRM: {
    VRMLoaderPlugin,
    VRMUtils,
    VRMHumanBoneName,
    VRMExpressionPresetName,
    VRMHumanoid,
    VRMExpressionManager,
    VRMSpringBoneManager,
    VRMAnimationLoaderPlugin,
    createVRMAnimationClip,
  },
  MMD: { MMDLoader, VMDLoader, VPDLoader, MMD, MMDAnimationManager, buildAnimation, VmdObject },
  addons: { GLTFLoader, TGALoader, MTLLoader, OBJLoader, RGBELoader, OrbitControls },
  revision: THREE.REVISION,
};

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

// The MMD block that used to sit here (MMDLoader / VMDLoader / VPDLoader / MMD /
// MMDAnimationManager / buildAnimation / VmdObject, from `@moeru/three-mmd`) was
// removed on 2026-10-12 with the rename to dsh-plugin-vrmpet3d: this plugin loads
// VRM only now, so nothing imports that package and the chunk no longer carries
// it. `docs/ASSET-CONTRACT.md` keeps the description of what it used to do.

// --- addons ---------------------------------------------------------------
// GLTFLoader is the one addon the plugin needs: a VRM is a glTF, and
// `@pixiv/three-vrm` plugs into it. VRM only, since 2026-10-12 — the PMX/PMD
// path (and with it the MMD stack, `MMDLoader`/`VMDLoader`/`VPDLoader` and the
// TGA/MTL/OBJ loaders that served it) was removed with the rename to
// dsh-plugin-vrmpet3d.
//
// DRACOLoader and KTX2Loader are deliberately NOT bundled. Both build their
// decoder URLs from `import.meta.url` as a module side effect, and an IIFE
// bundle has no `import.meta`, so merely importing them throws `TypeError:
// Invalid URL` at load time — taking the whole chunk down.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.__VRMPET3D_VENDOR__ = {
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
  addons: { GLTFLoader },
  revision: THREE.REVISION,
};

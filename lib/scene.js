// dsh-plugin-vrmpet3d — the 3D scene.
//
// This file owns everything that needs a WebGL context or a real model file:
// the renderer, the scene graph, the model loaders (VRM, and glTF/GLB without
// the VRM extension), the idle-motion applier, the authored-motion (VRMA) player,
// and the pointer gaze. It deliberately does NOT know about React, DSH slots,
// settings or the session state machine — the client half drives it through the
// small API at the bottom of this file.
//
// VRM ONLY since the 2026-10-12 rename (dsh-plugin-vrmpet3d): the PMX/PMD loader
// path, the MMD avatar wrapper and the `.vmd` player are out of this file, out of
// `vendor/entry.js` and out of the delivered chunk. `core.detectFormat` still
// RECOGNISES a PMX/PMD by its magic number so the refusal can name the format.
//
// Loaded as a classic script after lib/core.js. Requires:
//   globalThis.__VRMPET3D_VENDOR__  the bundled three.js + VRM graph
//   globalThis.__VRMPET3D_CORE__    computeFraming, idlePose, detectFormat, ...
(function () {
  'use strict';

  // ===========================================================================
  // Constants
  // ===========================================================================

  /** Vertical field of view. Narrow, to keep a chibi character from barrel-distorting. */
  var FOV = 30;

  /** How much of the viewport height the pet's head-to-toe span occupies. */
  var HEIGHT_FRACTION = 0.62;

  /** Extra room around the model when computing the camera distance. */
  var FIT_MARGIN = 1.22;

  /**
   * The idle writes NO world rotation any more.
   *
   * `idlePose.yaw` used to be scaled by a gain here and added to `stage.rotation.y`, which is the slow
   * left-right turning the operator asked to be rid of (「停用idle状态下微旋转」, 2026-10-13). The stage's yaw is
   * therefore the USER's own `yaw` preference and nothing else — the procedural idle keeps breathing and
   * trailing its chains, and the body stays where it was put.
   */

  /** Weight of the applied gaze relative to the bone's rest pose. */
  var GAZE_WEIGHT = 0.85;

  /**
   * How much the aim must CHANGE, in radians, before it counts as the mouse moving.
   *
   * About 0.11°, i.e. far below one pixel at any real span and far above the jitter a streamed cursor position
   * can carry. The idle rule measures movement by this, so a cursor stream that keeps repeating the same
   * position cannot keep the gaze alive for ever — see `Motion.setGaze`.
   */
  var GAZE_MOVE_EPSILON = 0.002;

  /**
   * How far the head turns toward the pointer, in radians AT THE EXTREME: 80° left and right.
   *
   * "90 度好像有点夸张，80 度可能合适一些" — and the constant is written through `GAZE_WEIGHT` because that
   * weight is applied on top of it. Spelled as a plain `Math.PI / 2` this would *read* as a right angle
   * while the model delivered 76°, which is precisely the "the number is right and the picture is not"
   * failure this file keeps coming back to (see the height/units gotcha, and the idle yaw that was removed
   * because a gain made a correct number look wrong).
   *
   * How far the pointer must travel for that full turn is the CALLER's business: both surfaces pass their
   * frame's width as `pointerAim`'s `spanX`, so a screen-wide offset is a full turn.
   */
  var GAZE_YAW_LIMIT = ((80 * Math.PI) / 180) / GAZE_WEIGHT;

  /**
   * Pitch is left where it was: a head does not tip 90° forward or back without looking broken, and the
   * request was for the turn. Raise this the same way if a bigger nod is ever wanted.
   */
  var GAZE_PITCH_LIMIT = 0.3;

  /**
   * How far the head may turn IN TOTAL while an authored clip is driving it, in radians.
   *
   * 70°, and it is a TOTAL rather than an addition: the pointer's contribution is
   * `max(0, HEAD_LAYER_LIMIT - the clip's own turn)`, so a clip that already turns the head 20° leaves 50°
   * for the gaze, and a clip past 70° gets nothing added — the alternative is two systems fighting over one
   * bone and the head snapping between them. See `applyGaze`.
   */
  var HEAD_LAYER_LIMIT = (70 * Math.PI) / 180;

  /** A spring bone simulation step, in seconds. Fixed for determinism. */
  var PHYSICS_STEP = 1 / 60;

  /** Breathing amplitude as a fraction of torso scale. */
  var BREATH_AMPLITUDE = 0.035;

  /** Idle period in seconds. 96 frames at 12 fps, as in the project's art spec. */
  var IDLE_PERIOD = 8;

  /** Chain follow-through per link, as a fraction of one idle period. */
  var CHAIN_SPREAD = 0.075;

  /**
   * Duration floor for a clip whose keyframes all sit at t = 0.
   *
   * three's LoopRepeat computes `time % duration`, which is NaN at a duration of
   * 0; the NaN reaches the bone quaternions two calls later and the model simply
   * disappears. Such a clip is one authored pose held forever, so a single
   * frame's worth of duration is enough to make the loop safe and invisible.
   */
  var MIN_CLIP_DURATION = 1 / 30;

  // ===========================================================================
  // Small helpers
  // ===========================================================================

  function errorText(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try { return JSON.stringify(error); } catch { return String(error); }
  }

  /** A promise that resolves after `ms`, used to poll for the vendor chunk. */
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** Console lines already emitted, so a per-frame path cannot spam the log. */
  var warned = {};

  function warnOnce(message) {
    if (warned[message]) return;
    warned[message] = true;
    if (typeof console !== 'undefined' && console.warn) console.warn('vrmpet3d: ' + message);
  }

  /**
   * Set once the vendored graph has been resolved by ANY route — including the
   * module system handing back nothing. "Already have it" and "already asked for
   * it" are different facts: the inline harnesses can supply the global without
   * ever loading the chunk, so the global alone cannot answer this.
   */
  var vendorResolved = false;

  /** `require` objects already warned about, so the notice is emitted per loader. */
  var asyncRequireSeen = new WeakSet();

  // ===========================================================================
  // Matched colour space
  // ===========================================================================

  /**
   * Pick the output colour-space constant for this three.js revision.
   *
   * three renamed the colour-space API across r150-r160. A desktop pet that only
   * renders correctly on one exact three.js version is a maintenance trap, so
   * both spellings are supported and the choice is made once, here.
   */
  function resolveColorSpace(THREE) {
    if (THREE.SRGBColorSpace !== undefined) return THREE.SRGBColorSpace;
    if (THREE.sRGBEncoding !== undefined) return THREE.sRGBEncoding;
    return undefined;
  }

  /** Apply a texture colour space across the API rename. */
  function applyTextureColorSpace(THREE, texture) {
    if (!texture) return texture;
    var space = resolveColorSpace(THREE);
    if (space === undefined) return texture;
    if (typeof space === 'string') texture.colorSpace = space;
    else texture.encoding = space;
    return texture;
  }

  // ===========================================================================
  // Motion — the idle applier
  // ===========================================================================

  /**
   * Turns `core.idlePose()` output into actual bone rotations, and owns the
   * per-frame clock, breathing, gait and gaze.
   *
   * One avatar shape is supported behind this interface: a parsed VRM, driven
   * through its normalized humanoid bones, its expression manager and its
   * SpringBone manager. (It used to be two — a PMX went through its bone and morph
   * objects with MMD's GrantSolver/IK update — and that second shape was removed on
   * 2026-10-12 with the rename to dsh-plugin-vrmpet3d.)
   *
   * The placeholder avatar is a second case: it exposes the same named chains but
   * has no humanoid, so it falls back to the chain-only path.
   *
   * @param {object} THREE the three.js namespace
   * @param {object} core the vrmpet3d core module
   */
  function Motion(THREE, core) {
    this.THREE = THREE;
    this.core = core;
    this.avatar = null;
    this.elapsed = 0;
    this.state = 'resting';
    this.period = IDLE_PERIOD;
    this.sway = 0.12;
    this.gaze = null;         // {yaw, pitch} in radians, in view space
    this.physicsAccumulator = 0;
    this.physicsEnabled = true;
    this.lookAtPointer = true;
    /**
     * True while a PREVIEW is up, which suspends the pointer gaze.
     *
     * The operator's request (2026-10-09): while the per-state clip settings are being chosen, the mouse
     * follow is switched off, so the preview shows the clip, the expression and the mouth and nothing else.
     * Set and cleared by `Scene.setPreview`.
     */
    this.holdGaze = false;
    this.scene = null;
    /**
     * The gaze RAMP, and the aim it ramps along.
     *
     * `gazeBlend` is 0 when the head is not following at all and 1 when it is following fully; it walks
     * between the two over `core.GAZE_LIMITS.blendSeconds` (see `applyGaze`). `gazeLastAim` is the last
     * direction the pet was given, kept because by the time the ramp has to run the live aim is often already
     * null — there would otherwise be no direction to ease out along.
     *
     * Both are initialised HERE rather than left undefined: `undefined` in the ramp arithmetic produces NaN,
     * and a NaN blend turns the gaze off silently and for ever — the same shape of failure as the idle rule
     * that took three reports to find.
     */
    this.gazeBlend = 0;
    this.gazeLastAim = null;
    /** True while an authored clip owns this state's pose. */
    this.authored = false;
    /** True when that clip also animates the head the pointer gaze drives. */
    this.authoredHead = false;
    /** Reused temporaries; allocating per frame would be the only real GC cost. */
    this._quat = new THREE.Quaternion();
    this._quat2 = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._vec = new THREE.Vector3();
  }

  Motion.prototype.attach = function (avatar, scene) {
    this.avatar = avatar;
    this.scene = scene || null;
    this.elapsed = 0;
    this.physicsAccumulator = 0;
  };

  Motion.prototype.setState = function (state, sway) {
    this.state = state;
    if (Number.isFinite(sway)) this.sway = sway;
  };

  Motion.prototype.setGaze = function (gaze) {
    /**
     * Only a CHANGE of aim counts as the mouse moving.
     *
     * This is what made the idle rule look broken in the field (operator: "超时暂停全局光标凝视功能未生效",
     * 2026-10-10): the floating window's cursor arrives from the launcher as a STREAM, and a stream keeps telling
     * the pet where the cursor is even when the cursor has not moved a pixel. Restamping on every call therefore
     * reset the five seconds for ever, and the rule could never fire — in the suite, where the aim was only ever
     * set when the test meant to move it, it passed. A threshold in aim units (radians) rather than in pixels,
     * because that is what "the same direction" means here; the epsilon is far below one pixel at any real span
     * and far above cursor jitter.
     */
    var previous = this.gaze;
    var moved = true;
    if (previous && gaze) {
      var dy = Math.abs(Number(gaze.yaw) - Number(previous.yaw));
      var dp = Math.abs(Number(gaze.pitch) - Number(previous.pitch));
      moved = !(dy < GAZE_MOVE_EPSILON && dp < GAZE_MOVE_EPSILON);
    } else if (!previous && !gaze) {
      // No aim before and no aim now: that is not movement either.
      moved = false;
    }
    this.gaze = gaze;
    if (moved) {
      /**
       * When the aim last CHANGED, which is what the idle rule is measured against.
       *
       * The operator's rule (2026-10-09 late): "如果鼠标连续5秒没有移动，就停止鼠标凝视，直到下次鼠标开始移动".
       * Stamped here rather than where the aim is computed, so every surface that aims the pet (the app widget,
       * the floating window, a launcher replaying a cursor stream) gets the same rule for free. `elapsed` is the
       * scene's own clock, so a suite can step it and nothing depends on wall time.
       */
      this.gazeAt = this.elapsed;
      // A new direction deserves a fresh application: the applied record belongs to the old one until the next
      // frame decides, and `gazeAllowed` is about to say yes anyway.
      this.appliedGaze = null;
    }
    if (!gaze) this.appliedGaze = null;
  };

  Motion.prototype.setPhysics = function (enabled) {
    this.physicsEnabled = enabled !== false;
  };

  Motion.prototype.setLookAtPointer = function (enabled) {
    this.lookAtPointer = enabled !== false;
  };

  /**
   * How long a motionless cursor is still followed, in seconds. 0 turns the rule off.
   *
   * Fed from the preferences by the scene, so the settings window's control reaches it; see
   * `Motion.gazeAllowed`. A value that is missing or unparseable falls back to the CORE default (five seconds)
   * rather than to zero: this half is deployed separately from the half that cleans preferences, so a running
   * host that does not know the field yet must not be able to switch the rule off by omission — which is a
   * second reason the operator saw "未生效" before the host was restarted.
   */
  Motion.prototype.setGazeIdle = function (seconds) {
    var value = Number(seconds);
    if (!Number.isFinite(value)) {
      value = Number(this.core && this.core.GAZE_LIMITS ? this.core.GAZE_LIMITS.idleSeconds : 2);
      if (!Number.isFinite(value)) value = 5;
    }
    this.gazeIdleSeconds = value > 0 ? value : 0;
  };

  /**
   * Whether the pet may look at the cursor RIGHT NOW.
   *
   * Two refusals, and both are the operator's:
   *
   *  1. the clip playing in this state can turn the gaze off for itself (the per-state per-clip 凝视 switch),
   *     which is why this asks the scene rather than deciding here;
   *  2. a cursor that has not moved for `gazeIdleSeconds` is not being used as a pointer — "如果鼠标连续5秒没有
   *     移动，就停止鼠标凝视，直到下次鼠标开始移动". Any new aim stamps `gazeAt` again, so the very next
   *     movement brings it straight back; 0 disables the rule, which is what to set while debugging.
   */
  Motion.prototype.gazeAllowed = function () {
    var scene = this.scene;
    if (scene && typeof scene.clipGazeAllowed === 'function' && !scene.clipGazeAllowed()) return false;
    var idle = Number(this.gazeIdleSeconds);
    if (!Number.isFinite(idle) || idle <= 0) return true;
    var since = Number(this.elapsed) - (Number.isFinite(this.gazeAt) ? this.gazeAt : 0);
    return since < idle;
  };

  /**
   * Tell the idle that an authored clip owns the pose this frame.
   *
   * @param {boolean} active an authored clip is driving the model.
   * @param {boolean} headDriven that clip also animates the head bone.
   */
  Motion.prototype.setAuthored = function (active, headDriven) {
    this.authored = active === true;
    this.authoredHead = this.authored && headDriven === true;
  };

  /**
   * Advance the idle by `dt` seconds.
   *
   * @returns {object|null} the pose that was applied, for diagnostics and tests.
   */
  Motion.prototype.tick = function (dt) {
    var avatar = this.avatar;
    if (!avatar) return null;
    if (!Number.isFinite(dt) || dt <= 0) return null;
    // A backgrounded tab can hand back a multi-second delta; clamping keeps the
    // physics from exploding on the first frame after the tab wakes.
    var step = Math.min(dt, 0.1);
    this.elapsed += step;

    var pose = this.core.idlePose(this.elapsed, this.state, {
      periodSeconds: this.period,
      swayAmplitude: this.sway,
      breathAmplitude: BREATH_AMPLITUDE,
    });

    // While a clip drives the body, the procedural writes for this state stand
    // down: they are absolute (not additive), so breathing the chest or swinging
    // the tail would erase the authored pose rather than layer on top of it.
    if (!this.authored) {
      this.applyBreath(pose);
      this.applyChains(pose);
    }
    // The step is passed BOTH to the frame and to the gaze: the gaze ramps its blend over a second, so it
    // needs the same `dt` the frame was given (and the clamped one, not the raw delta of a woken-up tab).
    this.lastStep = step;
    this.applyGaze(step);

    // VRM only, and load-bearing: everything written above landed on the NORMALIZED
    // humanoid rig, which is a separate node tree from the bones the mesh is skinned
    // to. Until `humanoid.update()` copies that rig across, the mesh keeps its own
    // rest pose — for a VRM, a T-pose — and the SpringBone step below reads stale
    // bones. Measured in the live app on 2026-10-08: a real VRM loaded, rendered, and
    // stood frozen in a T.
    if (avatar.syncBones) avatar.syncBones();

    // SpringBone is not part of a mixer, so its fixed step always runs, and it still
    // needs to see the pose the mixer just wrote. (An MMD avatar used to be the
    // exception: `updateWithMixer` ran that library's own IK and grant pass, and
    // stepping physics as well is what it documents against. MMD support was removed
    // on 2026-10-12, so there is no exception left.)
    if (this.physicsEnabled) this.stepPhysics(step);

    return pose;
  };

  Motion.prototype.applyBreath = function (pose) {
    var avatar = this.avatar;

    // VRM: a small PITCH of the chest, not a lift.
    //
    // The obvious implementation — nudging the normalized chest's Y — cannot ever be
    // seen: three-vrm's `humanoid.update()` copies rotation for every humanoid bone
    // but translation for the hips only, so a chest position write is discarded on the
    // way to the skinned bones. That was invisible before the sync fix and would have
    // stayed invisible after it, which is exactly the kind of thing this file has
    // already been wrong about once. Rotations do propagate, so breathing is a rotation.
    if (avatar.kind === 'vrm' && avatar.bones) {
      var chest = avatar.bones.chest || avatar.bones.upperChest || avatar.bones.spine;
      if (chest && chest.userData.vrmpet3dRestQuat) {
        var lift = (pose.breathScale - 1) * VRM_BREATH_PITCH_GAIN;
        this._euler.set(lift, 0, 0, 'XYZ');
        this._quat.setFromEuler(this._euler);
        chest.quaternion.copy(chest.userData.vrmpet3dRestQuat).multiply(this._quat);
      }
      return;
    }

    if (avatar.parts && avatar.parts.torso) {
      var torso = avatar.parts.torso;
      var scale = pose.breathScale;
      torso.scale.set(1, scale, 1);
    }
    if (avatar.parts && avatar.parts.bodice) {
      var bodice = avatar.parts.bodice;
      bodice.position.y = bodice.userData.vrmpet3dRestY !== undefined
        ? bodice.userData.vrmpet3dRestY
        : bodice.position.y;
    }
  };

  /**
   * Drive the tail, ears and hair chains with delayed follow-through.
   *
   * The chain root takes the body's motion immediately; each link behind it uses
   * `idlePose.follow(index, spread)`, which is the same waveform delayed by a
   * fraction of the period. That is what makes a tail look dragged by the body
   * rather than welded to it — and unlike a physics chain it returns to the exact
   * starting pose after one period, so the idle has no loop seam.
   */
  Motion.prototype.applyChains = function (pose) {
    var avatar = this.avatar;
    if (!avatar.chains) return;
    var spread = avatar.chainSpread || CHAIN_SPREAD;
    var names = Object.keys(avatar.chains);

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var nodes = avatar.chains[name];
      if (!nodes || !nodes.length) continue;
      var perLink = Number.isFinite(spread[name]) ? spread[name] : CHAIN_SPREAD;
      var rest = avatar.rest && avatar.rest[name] ? avatar.rest[name] : null;

      for (var link = 0; link < nodes.length; link++) {
        var node = nodes[link];
        if (!node) continue;
        var base = rest && rest[link] ? rest[link] : { x: 0, y: 0, z: 0 };
        var swing = pose.follow(link, perLink);
        // Tail and ears swing about z (sideways); hair locks about x (back and
        // forth). Driving the wrong axis is the difference between a sway and a
        // twitch, and it is per-chain rather than global.
        if (name === 'tail') {
          node.rotation.z = base.z + swing * 0.85;
          node.rotation.x = base.x + swing * 0.25;
        } else if (name === 'earL' || name === 'earR') {
          node.rotation.y = base.y + swing * 0.9;
          node.rotation.z = base.z + swing * 0.3;
        } else {
          node.rotation.x = base.x + swing * 0.7;
          node.rotation.z = base.z + swing * 0.35;
        }
      }
    }
  };

  /**
   * The node that does the looking, for any kind of avatar.
   *
   * One function for all three because "which node is the head" is the last thing that
   * should differ per model: the gaze itself is the same rotation for every avatar, and
   * `installAvatar` uses this too, to record the rest pose of whatever node this returns.
   *
   * VRM's head is found through the humanoid map; glTF and the procedural placeholder
   * expose `parts`; a wrapped avatar may carry its own `gazeBone`.
   */
  function gazeNodeFor(avatar) {
    if (!avatar) return null;
    if (avatar.kind === 'vrm' && avatar.bones && avatar.bones.head) return avatar.bones.head;
    if (avatar.parts && avatar.parts.head) return avatar.parts.head;
    return avatar.gazeBone || null;
  }

  /** Field names a spring joint carries, in the order the settings window shows them. */
  var SPRING_FIELDS = ['stiffness', 'dragForce', 'gravityPower'];

  /**
   * Group a VRM's spring joints back into the chains its author named.
   *
   * three-vrm's manager holds a flat set of joints and nothing about the groups they came from, while
   * the file — and therefore the settings window — talks in chains: `DaiMao`, `LiuHai.R`, `WeiBa`.
   * So the chains are rebuilt here from the document's own extension, matching each declared joint
   * NODE to the joint three-vrm built for it.
   *
   * Matching is by node NAME, not by the loader's internal object/index maps: names are what the
   * file itself uses, they are what the settings window shows, and a name that turns out to be
   * ambiguous is reported rather than guessed at (a chain keeps the joints it could place and counts
   * the rest as `missing`).
   *
   * The two names are NOT the same string, and that cost the 蓝色小肥鱼 model sixteen of its
   * twenty-two chains: GLTFLoader runs every node name through `PropertyBinding.sanitizeNodeName`,
   * which turns spaces into `_` and DELETES `[ ] . : /`. A bone the file calls `LiuHai.L` is loaded as
   * `LiuHaiL`, so a strict comparison matched the six chains whose names happened to be clean and
   * skipped the rest — the settings window listed them from the FILE (which is parsed separately) while
   * the renderer had no chain to apply an override to, so their sliders did nothing. Both sides are
   * therefore compared on the same normalized key.
   *
   * Each joint's AUTHORED settings are snapshotted here, at install time, because that is what
   * "default" means later: an override has to be able to go back to the number the file declares.
   */
  function sanitizedNodeName(name) {
    // The transformation itself lives in `core.js`, so it is unit-tested against three's documented rule
    // instead of being re-derived here (the re-derivation is what got it wrong the first time).
    var core = globalThis.__VRMPET3D_CORE__;
    return core && core.sanitizeNodeName ? core.sanitizeNodeName(name) : String(name);
  }

  /**
   * A chain's identity for the override map, from the same rule the host's parser uses.
   *
   * A local wrapper rather than a call site, for the same reason as `sanitizedNodeName`: the rule is shared,
   * and the last time each half derived it separately the two disagreed and every unnamed chain's sliders were
   * inert (2026-10-09).
   */
  function springChainKey(chain, index) {
    var core = globalThis.__VRMPET3D_CORE__;
    if (core && core.springChainKey) return core.springChainKey(chain, index);
    return (chain && (chain.name || chain.comment)) || ('hair' + index);
  }

  function collectSpringChains(avatar) {
    var manager = avatar && avatar.vrm && avatar.vrm.springBoneManager;
    var document = avatar && avatar.document;
    var extensions = (document && document.extensions) || null;
    if (!manager || !manager.joints || !extensions) return { chains: [], skipped: [] };

    var joints = [];
    manager.joints.forEach(function (joint) { if (joint && joint.bone) joints.push(joint); });
    if (!joints.length) return { chains: [], skipped: [] };

    var byName = {};
    var ambiguous = {};
    for (var i = 0; i < joints.length; i += 1) {
      // Keyed by the SANITIZED name: the loaded bone carries the sanitized one while the document
      // carries the raw one (see the note above `sanitizedNodeName`).
      var loadedName = sanitizedNodeName(joints[i].bone.name);
      if (!loadedName) continue;
      if (byName[loadedName]) ambiguous[loadedName] = true;
      else byName[loadedName] = joints[i];
    }

    var declarations = [];
    var vrm1 = extensions.VRMC_springBone;
    if (vrm1 && Array.isArray(vrm1.springs)) {
      for (var s = 0; s < vrm1.springs.length; s += 1) {
        var spring = vrm1.springs[s] || {};
        declarations.push({
          // The KEY is the shared identity an override is stored under; the label is what the window shows.
          // Both come from `core.springChainKey` so this half and the host's parser cannot disagree — they
          // did, and every unnamed chain's sliders were silently inert (2026-10-09).
          key: springChainKey({ name: spring.name, kind: 'vrm1' }, s),
          name: spring.name || null,
          label: spring.name || null,
          kind: 'vrm1',
          // VRM 1.0 lists its members as NODE INDICES; the document turns those into names below.
          joints: (spring.joints || []).map(function (entry) { return entry ? entry.node : null; }),
          colliderGroups: (spring.colliderGroups || []).length,
        });
      }
    }
    // VRM 0.x keeps them under `secondaryAnimation`, named by `comment`, with the bones listed
    // directly. Both shapes are read so an older model is not silently without settings.
    if (!declarations.length && extensions.VRM && extensions.VRM.secondaryAnimation) {
      var groups = extensions.VRM.secondaryAnimation.boneGroups || [];
      for (var g = 0; g < groups.length; g += 1) {
        var group = groups[g] || {};
        declarations.push({
          key: springChainKey({ name: group.comment, kind: 'vrm0' }, g),
          name: group.comment || null,
          label: group.comment || null,
          // VRM 0.x lists every bone of the chain as a joint of its own: no pairing, no terminal
          // entry, so all of them are animate-able.
          kind: 'vrm0',
          joints: (group.bones || []).slice(),
          colliderGroups: (group.colliderGroups || []).length,
        });
      }
    }
    if (!declarations.length) return { chains: [], skipped: [] };

    // Node indices are the only thing both VRM flavours agree on, so the document is where the names
    // come from — and names are what three-vrm's joints carry and what the settings window shows.
    var nodes = (document && document.nodes) || [];
    var chains = [];
    var skipped = [];
    for (var d = 0; d < declarations.length; d += 1) {
      var declaration = declarations[d];
      var resolved = [];
      var missing = 0;
      /**
       * The LAST entry of a VRM 1.0 chain is only a tail.
       *
       * three-vrm imports `spring.joints` as PAIRS — entry k is a joint whose tail is entry k+1 — so N
       * entries produce N-1 joints and the final entry is never a joint of its own. Iterating the
       * declared nodes instead is what made a first attempt report "hair: 1 joint" for a chain with
       * two, and drop a one-entry chain entirely: a chain the settings window can list but no
       * consumer animates. Pairing the same way keeps the two halves agreeing on the same model.
       */
      var animates = declaration.kind === 'vrm1' ? Math.max(0, declaration.joints.length - 1) : declaration.joints.length;
      for (var j = 0; j < animates; j += 1) {
        var nodeIndex = declaration.joints[j];
        var nodeName = nodeIndex !== null && nodes[nodeIndex] ? nodes[nodeIndex].name : null;
        if (!nodeName) { missing += 1; continue; }
        var key = sanitizedNodeName(nodeName);
        if (ambiguous[key]) { missing += 1; continue; }
        var joint = byName[key];
        if (!joint) { missing += 1; continue; }
        resolved.push({
          joint: joint,
          name: nodeName,
          authored: {
            stiffness: joint.settings.stiffness,
            dragForce: joint.settings.dragForce,
            gravityPower: joint.settings.gravityPower,
          },
        });
      }
      if (!resolved.length) {
        // Reported rather than hidden: the chain exists in the file, and a window that silently omits
        // it looks like the model has fewer chains than it does.
        skipped.push({
          name: declaration.name,
          entries: declaration.joints.length,
          reason: declaration.kind === 'vrm1'
            ? 'a VRM 1.0 chain needs at least two entries for a consumer to animate one joint'
            : 'no joint of this chain could be matched to the loaded model',
        });
        continue;
      }
      chains.push({
        // `key` is the identity the override map is stored under (see core.springChainKey); `name` stays what
        // the model declares, and `label` is what the settings window shows — so a chain with no name gets its
        // root bone's name instead of ten identical "未命名链" rows.
        key: declaration.key,
        name: declaration.name,
        label: declaration.label || (resolved[0] && resolved[0].name) || declaration.key,
        colliderGroups: declaration.colliderGroups,
        entries: declaration.joints.length,
        joints: resolved,
        missing: missing,
        authored: {
          stiffness: resolved[0].authored.stiffness,
          dragForce: resolved[0].authored.dragForce,
          gravityPower: resolved[0].authored.gravityPower,
        },
      });
    }
    return { chains: chains, skipped: skipped };
  }

  /**
   * The bone → chain index, built once per install.
   *
   * Keyed by the bone OBJECT, not by its name: `springChainInfo[i].joints[j].joint` IS the three.js bone the
   * skeleton hands to the raycast, so a press and a chain meet on the same object — and no node-name rule (three
   * rewrites characters in node names, and this plugin mirrors that rule in `core.sanitizeNodeName`) can come
   * between them. A bone claimed by two chains keeps the FIRST, which is the order the file declares.
   */
  function indexSpringChains(chains) {
    if (typeof Map !== 'function') return null;
    var index = new Map();
    for (var i = 0; i < (chains || []).length; i += 1) {
      var chain = chains[i];
      var joints = chain && chain.joints ? chain.joints : [];
      for (var j = 0; j < joints.length; j += 1) {
        var bone = joints[j].joint ? joints[j].joint.bone : null;
        if (bone && !index.has(bone)) index.set(bone, chain);
      }
    }
    return index;
  }

  /**
   * Turn the head toward the pointer.
   *
   * Applied as a fraction of the bone's rest quaternion rather than a replacement,
   * so the model's authored head tilt survives and the gaze reads as attention
   * instead of a snap to a weird angle.
   *
   * ONE algorithm, for every avatar kind, and no per-model case: the rotation is built
   * about axes measured from the rig (`gazeAxes`) instead of about the head's own X and Y.
   * Which local axis is "up" or "right" is a property of how a model is oriented, not
   * something to assume — assuming it is what made the VRM 1.0 model tip its head the wrong
   * way while the VRM 0.x one was fine, and what left the procedural placeholder inverted
   * after that was fixed, because its head is an unrotated group (so its local X is the
   * stage's X and the same naive rotation tips it down).
   */
  Motion.prototype.applyGaze = function (dt) {
    var avatar = this.avatar;
    if (!avatar) return;
    var step = Number.isFinite(dt) ? dt : (Number.isFinite(this.lastStep) ? this.lastStep : 1 / 60);
    var gaze = this.lookAtPointer ? this.gaze : null;
    /**
     * And a PREVIEW suspends the follow entirely.
     *
     * The operator asked for this (2026-10-09): "在'每状态 × 每动作'设置时，暂时关闭视角的鼠标跟随" — while the
     * per-state clip settings are being chosen the head must hold still, so what is on screen is the clip, the
     * expression and the mouth and nothing else. `holdGaze` is set by `Scene.setPreview` and cleared with the
     * preview, so the follow is back the moment the pointer leaves that row.
     */
    if (gaze && this.holdGaze) gaze = null;
    /**
     * And the two standing refusals: the playing clip's own 凝视 switch, and a cursor that has stopped moving.
     * The result is RECORDED either way, because the settings window's readout should show what the renderer
     * applied rather than what it was asked for.
     */
    if (gaze && !this.gazeAllowed()) gaze = null;
    this.appliedGaze = gaze ? { yaw: gaze.yaw, pitch: gaze.pitch } : null;

    /**
     * The BLEND, which is what keeps this from looking weird.
     *
     * The operator, 2026-10-10: "凝视暂停和重新开始要让人物在1秒缓冲时间内均匀转头回归或者凝视鼠标". So the gaze
     * does not switch; it RAMPS. `gazeBlend` walks toward 1 while the gaze is allowed and toward 0 while it is
     * refused, at a constant rate of `1 / blendSeconds` per second — "均匀" is a uniform speed, so the step is
     * linear rather than eased — and the angles below are scaled by it. That single scale is what gives the
     * smooth turn in BOTH directions, including the paths that used to snap: the idle rule, a preview, the
     * per-clip switch, the global 看向光标 switch and a cleared aim.
     *
     * The last aim is remembered separately, because the aim is often already null by the time the ramp has to
     * run (a cleared cursor, a refused gaze): without it there would be no direction to ease OUT along.
     */
    var blendSeconds = Number(this.core && this.core.GAZE_LIMITS ? this.core.GAZE_LIMITS.blendSeconds : 1);
    var target = gaze ? 1 : 0;
    // A blend that is not a number can only come from something having set the field to nonsense; recovering to
    // the target is better than freezing the gaze off for the rest of the session.
    if (!Number.isFinite(this.gazeBlend)) this.gazeBlend = target;
    if (!Number.isFinite(blendSeconds) || blendSeconds <= 0) {
      this.gazeBlend = target;
    } else {
      var rate = step / blendSeconds;
      var remaining = target - this.gazeBlend;
      this.gazeBlend += Math.max(-rate, Math.min(rate, remaining));
      if (this.gazeBlend < 0) this.gazeBlend = 0;
      if (this.gazeBlend > 1) this.gazeBlend = 1;
    }
    if (gaze) this.gazeLastAim = { yaw: gaze.yaw, pitch: gaze.pitch };

    var head = gazeNodeFor(avatar);
    if (!head) return;

    // The rest quaternion is recorded for every avatar in `installAvatar`, so there is no
    // kind-specific fallback here.
    var rest = head.userData.vrmpet3dRestQuat || null;

    var layeredOnClip = Boolean(this.authored && this.authoredHead);

    /**
     * Fully out: the head is not turning at all.
     *
     * On the idle path that means the rest pose (an earlier revision copied it the instant the gaze was
     * refused, which is the snap this replaced). When a clip owns the head, "nothing from the gaze" means
     * leaving the mixer's pose exactly as it is.
     */
    var aim = this.gazeLastAim;
    if (this.gazeBlend <= 0 || !aim) {
      if (!layeredOnClip && rest) head.quaternion.copy(rest);
      return;
    }

    var yaw = Math.max(-GAZE_YAW_LIMIT, Math.min(GAZE_YAW_LIMIT, aim.yaw)) * GAZE_WEIGHT * this.gazeBlend;
    var pitch = Math.max(-GAZE_PITCH_LIMIT, Math.min(GAZE_PITCH_LIMIT, aim.pitch)) * GAZE_WEIGHT * this.gazeBlend;
    var axes = rest ? this.gazeAxes(head) : null;

    if (layeredOnClip) {
      // How far the clip has already turned this bone, in radians: the angle of the rotation from rest.
      var clipTurn = 0;
      if (rest) {
        this._quat.copy(rest).invert().multiply(head.quaternion);
        clipTurn = 2 * Math.acos(Math.min(1, Math.abs(this._quat.w)));
      }
      var budget = Math.max(0, HEAD_LAYER_LIMIT - clipTurn);
      yaw = Math.max(-budget, Math.min(budget, yaw));
      // Pitch keeps its own (smaller) limit, but never more than what is left of the budget either.
      pitch = Math.max(-Math.min(GAZE_PITCH_LIMIT * GAZE_WEIGHT, budget),
        Math.min(Math.min(GAZE_PITCH_LIMIT * GAZE_WEIGHT, budget), pitch));
      if (axes) {
        this._quat.setFromAxisAngle(axes.yaw, yaw);
        this._quat2.setFromAxisAngle(axes.pitch, pitch);
      } else {
        this._euler.set(pitch, yaw, 0, 'YXZ');
        this._quat.setFromEuler(this._euler);
        this._quat2.set(0, 0, 0, 1);
      }
      // POST-multiplied: the clip's pose is the base and the gaze turns the head further about its own
      // axes, which is what "add a look on top of the animation" means on a bone.
      head.quaternion.multiply(this._quat).multiply(this._quat2);
      return;
    }

    if (axes) {
      // Composed as `rest * yaw * pitch`, which is what the 'YXZ' euler order produced
      // before — only the axes changed, so a rig whose axes really are its local X and Y
      // gets exactly the rotation it used to.
      this._quat.setFromAxisAngle(axes.yaw, yaw);
      this._quat2.setFromAxisAngle(axes.pitch, pitch);
      head.quaternion.copy(rest).multiply(this._quat).multiply(this._quat2);
      return;
    }

    // Degenerate rig: no usable axes to measure (or no rest pose to compose with). Rotating
    // about the local axes is the best guess left, and it is a guess — which is why it is
    // the last resort rather than the main path.
    this._euler.set(pitch, yaw, 0, 'YXZ');
    this._quat.setFromEuler(this._euler);
    if (rest) head.quaternion.copy(rest).multiply(this._quat);
    else head.quaternion.copy(this._quat);
  };

  /**
   * The axes this head must turn about, measured from the rig and cached on the bone.
   *
   * The measurement costs two world-matrix reads and three vector transforms, so it is
   * done once per avatar rather than per frame; the head node belongs to one avatar, so a
   * model switch cannot inherit the previous model's axes.
   */
  Motion.prototype.gazeAxes = function (head) {
    if (head.userData.vrmpet3dGazeAxes !== undefined) return head.userData.vrmpet3dGazeAxes;
    // The frame is the model's PARENT — the stage that carries the pet's own heading — and
    // not `this.scene`, which is the renderer's scene and has no stage on it. Asking the
    // wrong object for the stage is how this silently fell back to the old local-axis code
    // on the first attempt: the derivation was correct and never ran.
    var avatar = this.avatar;
    var stage = (avatar && avatar.root && avatar.root.parent) || null;
    var axes = gazeAxesFor(this.THREE, head, stage);
    head.userData.vrmpet3dGazeAxes = axes;
    return axes;
  };

  /**
   * Advance SpringBone physics on a fixed timestep.
   *
   * Fixed-step on purpose: a physics chain advanced by a variable delta settles
   * differently at 60 Hz and 144 Hz, so the pet would visibly behave differently
   * on two monitors. The accumulator carries the remainder across frames.
   */
  Motion.prototype.stepPhysics = function (dt) {
    var avatar = this.avatar;
    if (!avatar) return;
    this.physicsAccumulator += dt;
    var steps = 0;
    while (this.physicsAccumulator >= PHYSICS_STEP && steps < 5) {
      this.physicsAccumulator -= PHYSICS_STEP;
      steps += 1;
      try {
        if (avatar.updatePhysics) avatar.updatePhysics(PHYSICS_STEP);
      } catch (error) {
        // A physics chain that fails must not take the whole pet down; disable it
        // and carry on with the explicit chain animation.
        this.physicsEnabled = false;
        this.physicsError = errorText(error);
        return;
      }
    }
    // Do not let a long stall build up an unbounded backlog.
    if (this.physicsAccumulator > PHYSICS_STEP * 5) this.physicsAccumulator = 0;
  };

  // ===========================================================================
  // Loading
  // ===========================================================================

  /** Where a model's bytes and its sibling assets come from. */
  function AssetSource(options) {
    this.assetBase = (options && options.assetBase) || '/vrmpet3d/asset';
    this.modelId = options && options.modelId;
    this.manager = null;
  }

  AssetSource.prototype.urlFor = function (relative) {
    if (!this.modelId) return null;
    var url = this.assetBase + '?m=' + encodeURIComponent(this.modelId);
    if (relative) url += '&p=' + encodeURIComponent(relative);
    return url;
  };

  /** Absolute URL of the model's own directory, as a base for relative textures. */
  AssetSource.prototype.directoryUrl = function () {
    if (!this.modelId) return '';
    // A trailing slash matters: three resolves relative paths against it.
    return this.assetBase + '?m=' + encodeURIComponent(this.modelId) + '&p=';
  };

  /**
   * Loading manager that redirects a model's relative asset references to the
   * plugin's own asset route.
   *
   * A model file refers to `tex/body.png`; the browser would otherwise resolve that
   * against the document URL and 404. Rewriting here keeps the glTF/VRM loader
   * working with one rule instead of a per-loader special case.
   */
  function createManager(THREE, source) {
    var manager = new THREE.LoadingManager();
    manager.setURLModifier(function (url) {
      if (!url) return url;
      if (/^(?:data:|blob:|https?:)/i.test(url)) return url;
      // Bare names and relative paths both mean "beside the model".
      var relative = url.replace(/^\.\//, '');
      var rewritten = source.urlFor(relative);
      return rewritten || url;
    });
    return manager;
  }

  /**
   * The axes a gaze has to turn THIS head about, in the head bone's own local space.
   *
   * Derived from the rig rather than assumed, and that is the whole point: the gaze used to
   * be applied about the head's own X and Y, which are the character's right and up only
   * for a model whose orientation happens to work out that way. Measured on the two VRMs in
   * this workspace:
   *
   *   * `HatsuneMikuNT.vrm` — **VRM 0.x**, so `VRMUtils.rotateVRM0` turns it 180° about Y.
   *     A positive rotation about its local X tips the nose UP, and the gaze looked right.
   *   * `蓝色小肥鱼.vrm` — **VRM 1.0**, left as authored. The same rotation tips the nose
   *     DOWN. Reported as "left and right are fine, up and down are inverted".
   *
   * That split is forced by the maths: conjugating a rotation by that 180° yaw flip negates
   * a tilt about the right axis (R_y(π) R_x(θ) R_y(π)⁻¹ = R_x(−θ)) and leaves a turn about
   * the up axis alone (R_y(π) R_y(φ) R_y(π)⁻¹ = R_y(φ)) — which is exactly why only the
   * pitch inverted. Measuring the axes removes the assumption instead of patching the sign
   * for one model.
   *
   * The character's axes come from the STAGE, so the pet's idle heading (which yaws the whole
   * stage) cancels out of the measurement: `inv(headWorld) · stageWorld` is
   * `inv(headLocalWorld)`, independent of how the stage is turned.
   *
   * @returns {{yaw:object, pitch:object}|null} unit axes, or null when the rig is degenerate
   */
  function gazeAxesFor(THREE, head, stage) {
    if (!head || !stage) return null;
    try {
      head.updateWorldMatrix(true, false);
      stage.updateWorldMatrix(true, false);
      var headWorld = new THREE.Quaternion();
      var stageWorld = new THREE.Quaternion();
      head.getWorldQuaternion(headWorld);
      stage.getWorldQuaternion(stageWorld);
      var toLocal = function (x, y, z) {
        return new THREE.Vector3(x, y, z)
          .applyQuaternion(stageWorld)
          .applyQuaternion(headWorld.clone().invert())
          .normalize();
      };
      var forward = toLocal(0, 0, 1);
      var up = toLocal(0, 1, 0);
      var right = toLocal(1, 0, 0);
      // Rotating `forward` about `forward × target` by a positive angle tips it toward
      // `target`: (f × t) × f = t − f(f·t), the component of the target across the forward.
      var yaw = new THREE.Vector3().crossVectors(forward, right);
      var pitch = new THREE.Vector3().crossVectors(forward, up);
      var usable = function (axis) {
        return axis.lengthSq() > 1e-8 && Number.isFinite(axis.x) && Number.isFinite(axis.y)
          && Number.isFinite(axis.z);
      };
      if (!usable(yaw) || !usable(pitch)) return null;
      return { yaw: yaw.normalize(), pitch: pitch.normalize() };
    } catch (error) {
      return null;
    }
  }

  /**
   * How far a VRM's arm is allowed to swing down from its rest pose, in radians.
   *
   * A VRM rest pose is a T-pose, so the arm starts pointing straight out; 1.31 rad
   * (75°) leaves it hanging ~15° off vertical, which reads as a relaxed stand. It is
   * a CLAMP rather than a fixed rotation on purpose: a model whose rest pose is already
   * an A-pose only moves the remaining few degrees.
   */
  var VRM_ARM_DROP_LIMIT = 1.31;

  /**
   * How much of the idle's breath amplitude becomes chest pitch, in radians.
   *
   * The idle's `breathScale` deviates from 1 by roughly ±0.02, so this lands around
   * ±0.03 rad — enough to read as breathing on a pet a few hundred pixels tall, and
   * small enough not to look like a bow. See `applyBreath` for why the VRM breath is
   * a rotation at all.
   */
  var VRM_BREATH_PITCH_GAIN = 1.5;

  /**
   * Drag secondary motion: how far the body lags, and how quickly it catches up.
   *
   * `DRAG_LAG_SECONDS` converts a drag velocity into a lag distance (a pet dragged at 1000 px/s lags
   * as if it had fallen 0.08 s behind); the cap keeps a fast flick from throwing the body out of its
   * frame, and the time constant is what gives the hair its overshoot-and-settle instead of a snap.
   */
  var DRAG_LAG_SECONDS = 0.08;
  var DRAG_LAG_MAX_PX = 18;
  var DRAG_LAG_TAU = 0.09;

  /**
   * A vertical drag also PITCHES the body, and that is mechanics rather than decoration.
   *
   * A hanging chain cannot be swung by moving its anchor along its own axis: the joints only bend, and the
   * spring solver holds the distance between them, so lifting or dropping the pet straight down barely
   * moves the hair at all — even though `applyDragLag` never left the vertical axis out of the lag. That is
   * exactly the report "左右移动会晃，上下移动不晃". Pitching the root is an input a chain of that shape CAN
   * answer (its root rotates, the strands trail it and swing like a pendulum in the sagittal plane), so the
   * vertical velocity becomes a lean and the springs do the rest.
   *
   * Radians per pixel-per-second, capped, with its own time constant: 900 px/s reaches about 6.2°, and the
   * lean decays after the drag stops, which is what makes the hair settle rather than snap back.
   */
  var DRAG_PITCH_PER_PIXEL = 0.00012;
  var DRAG_PITCH_MAX = 0.14;
  var DRAG_PITCH_TAU = 0.12;

  /**
   * Aim one normalized upper arm downward, in that bone's own local space.
   *
   * Both vectors are taken in local space rather than world space, which is what makes
   * this a plain post-multiply on the bone's quaternion — no parent bookkeeping, and no
   * assumption about which way the normalized rig is oriented. See
   * `core.aimDownQuaternion` for why the rotation is derived instead of hardcoded.
   *
   * @returns {boolean} whether anything was applied
   */
  function dropArm(THREE, core, upperArm, lowerArm) {
    if (!upperArm || !lowerArm || !core) return false;
    try {
      var shoulder = new THREE.Vector3();
      var elbow = new THREE.Vector3();
      upperArm.getWorldPosition(shoulder);
      lowerArm.getWorldPosition(elbow);
      var worldAxis = elbow.sub(shoulder);
      if (worldAxis.lengthSq() < 1e-12) return false;
      worldAxis.normalize();

      // World → this bone's local space. `getWorldQuaternion` is valid here because
      // the caller updated the world matrices for the freshly loaded model.
      var worldQuat = new THREE.Quaternion();
      upperArm.getWorldQuaternion(worldQuat);
      var inverse = worldQuat.clone().invert();
      var localAxis = worldAxis.clone().applyQuaternion(inverse);
      var localDown = new THREE.Vector3(0, -1, 0).applyQuaternion(inverse);

      var aim = core.aimDownQuaternion(
        [localAxis.x, localAxis.y, localAxis.z],
        [localDown.x, localDown.y, localDown.z],
        VRM_ARM_DROP_LIMIT
      );
      if (!aim) return false;

      var delta = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(aim.axis[0], aim.axis[1], aim.axis[2]),
        aim.angle
      );
      // Local post-multiply: the rotation is expressed in the frame the vectors were
      // measured in.
      upperArm.quaternion.multiply(delta);
      upperArm.updateMatrixWorld(true);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Build a VRM avatar from a parsed glTF/VRM scene.
   *
   * Applies the documented VRM hygiene steps. `removeUnnecessaryVertices` and
   * `combineSkeletons` are not cosmetic: without them a VRM renders with the
   * duplicated vertex set Blender exports, which hurts performance and produces
   * visible seams.
   */
  function wrapVRM(THREE, VRM, gltf, scene, core) {
    //
  // The two optional 'hygiene' steps below are NOT called, and that is a measured decision rather than a
  // preference:
  //
  //   * `removeUnnecessaryVertices` rewrites the JOINTS_0 / WEIGHTS_0 attributes (which bone each vertex is
  //     bound to) and `combineSkeletons` re-parents bones across skeletons.
  //   * With BOTH in place, the user's HatsuneMikuNT.vrm and 蓝色小肥鱼.vrm come out deformed: the fringe
  //     lies flat and the skirt is pulled out into a plate while the body, limbs and skin are fine.
  //   * With BOTH removed (and gravity supplied for VRM 0.x - see `supplyMissingGravity`), both models were
  //     reported correct; restoring them brought the deformation straight back.
  //
  // The cost of dropping them is the duplicated vertex set a Blender export leaves behind, which is memory
  // and not correctness. If they are ever wanted back, re-add ONE of them at a time and compare against a
  // model in hand - and note that whichever one it is, it is the geometry rewrite that has to go, not the
  // physics: supplying gravity is what makes the chains fall at all.
    // A VRM 0.x model faces the camera's opposite way; the helper rotates it to
    // match VRM 1.0 so the pet always faces the viewer.
    try {
      VRM.VRMUtils.rotateVRM0(gltf.userData.vrm);
    } catch (error) {
      // Older three-vrm revisions differ here; the pet still renders.
    }

    var vrm = gltf.userData.vrm;
    var bones = {};
    if (vrm && vrm.humanoid) {
      var names = {
        hips: 'hips', spine: 'spine', chest: 'chest', upperChest: 'upperChest',
        neck: 'neck', head: 'head',
        leftUpperArm: 'leftUpperArm', rightUpperArm: 'rightUpperArm',
        leftLowerArm: 'leftLowerArm', rightLowerArm: 'rightLowerArm',
      };
      Object.keys(names).forEach(function (key) {
        try {
          var node = vrm.humanoid.getNormalizedBoneNode(names[key]);
          if (node) {
            bones[key] = node;
            // Record the rest transform so gaze and breathing stay additive.
            node.userData.vrmpet3dRestQuat = node.quaternion.clone();
            node.userData.vrmpet3dRestX = node.position.x;
            node.userData.vrmpet3dRestY = node.position.y;
            node.userData.vrmpet3dRestZ = node.position.z;
          }
        } catch (error) { /* bone absent in this model */ }
      });
    }

    /**
     * The relaxed stand this avatar was built with, per bone.
     *
     * A VRM's rest pose is a T-pose, and the idle only writes breathing and gaze, so
     * without this the pet is a statue standing in a T (observed in the live app,
     * 2026-10-08). The stance is computed from the rig itself at load time (see
     * `dropArm`) and applied here; `applyStance` re-applies it after
     * `resetNormalizedPose`, which would otherwise put the arms straight back out.
     */
    var stance = {};
    var applyStance = function () {
      Object.keys(stance).forEach(function (key) {
        var bone = bones[key];
        if (bone) bone.quaternion.copy(stance[key]);
      });
    };

    if (vrm && vrm.humanoid && bones.leftUpperArm && bones.rightUpperArm) {
      try {
        gltf.scene.updateMatrixWorld(true);
        dropArm(THREE, core, bones.leftUpperArm, bones.leftLowerArm);
        dropArm(THREE, core, bones.rightUpperArm, bones.rightLowerArm);
        if (vrm.humanoid.update) vrm.humanoid.update();
        gltf.scene.updateMatrixWorld(true);
        // Record the stanced pose as the rest pose every additive write builds on.
        ['leftUpperArm', 'rightUpperArm'].forEach(function (key) {
          var bone = bones[key];
          if (!bone) return;
          stance[key] = bone.quaternion.clone();
          bone.userData.vrmpet3dRestQuat = bone.quaternion.clone();
        });
      } catch (error) {
        // A rig the maths cannot read simply keeps its own rest pose.
      }
    }

    /**
     * No spring colliders.
     *
     * MEASURED, not theorised. The state the user confirmed correct ('这次完全正常了') had these cleared;
     * restoring them brought the deformation back, and clearing them again is the only difference left
     * between that state and the broken one - the physics-delta clamp was a no-op because the caller passes a
     * constant step. (The other suspect at the time, the MMD material pass, could not have touched a `.vrm` at
     * all: it lived in the `kind === 'mmd'` branch, which is gone as of 2026-10-12.)
     *
     * A collider whose radius does not match the skeleton it shipped with drags a ring of skirt chains out
     * into a plate and flattens the fringe against the head, while everything the solver does not touch (the
     * body, the limbs) stays correct - which is the picture that started this. For a desk pet colliders are
     * optional: they only stop hair passing through the body at rest, and the chains still swing.
     */
    if (vrm && vrm.springBoneManager && vrm.springBoneManager.joints) {
      try {
        vrm.springBoneManager.joints.forEach(function (joint) {
          if (joint) joint.colliderGroups = [];
        });
        if (vrm.springBoneManager._colliderGroups) vrm.springBoneManager._colliderGroups = [];
      } catch (error) {
        // A manager with a different shape keeps its own colliders.
      }
    }

    // VRM hair and tail are spring chains. The avatar intentionally exposes no
    // named chains for them: three-vrm's SpringBone manager animates them, and
    // hand-animating the same bones would fight it.
    return {
      root: gltf.scene,
      kind: 'vrm',
      vrm: vrm,
      bones: bones,
      expressions: vrm && vrm.expressionManager ? vrm.expressionManager : null,
      /**
       * The parsed glTF document this avatar came from.
       *
       * The spring-bone chains' NAMES live here and nowhere else: three-vrm's manager keeps joints,
       * not the groups the author named, and the settings window has to be able to talk about "the
       * tail" rather than "joint #19". `gltf.parser.json` is the document GLTFLoader parsed.
       */
      document: (gltf.parser && gltf.parser.json) || null,
      chains: {},
      chainSpread: {},
      rest: {},
      /**
       * Copy the normalized humanoid rig onto the bones the mesh is skinned to.
       *
       * This is NOT optional and its absence was a visible bug: the procedural idle
       * writes the NORMALIZED rig, which is a separate node tree, so with no
       * `humanoid.update()` the mesh keeps whatever pose the raw bones already had —
       * for a fresh model, its T-pose rest, forever. Calling it also gives the
       * SpringBone step below a current pose for the hair to follow.
       */
      syncBones: function () {
        if (vrm && vrm.humanoid && vrm.humanoid.update) vrm.humanoid.update();
      },
      /** Put the relaxed stand back after a pose reset. */
      applyStance: applyStance,
      /**
       * Everything three-vrm has to be told about once per frame.
       *
       * `VRM.update(delta)` is the library's own entry point — its doc comment is literally "You need to call
       * this on your update loop" — and it does three things: node constraints, spring bones, and
       * `material.update(delta)` for every MToon material. This wrapper drives the rig itself (the procedural
       * idle writes the normalized rig and `syncBones` copies it), so it used to call only the spring manager
       * and silently skipped the other two. What that cost, measured on SampleModel.vrm on 2026-10-09:
       *
       *  * **A VRoid garment's see-through parts rendered as solid black.** MToon keeps its own `alphaTest`
       *    uniform and refreshes it in `material.update(delta)`; skipping that left it at 0, so
       *    `#ifdef USE_ALPHATEST` discarded nothing and every alpha-0 texel (which is BLACK in these files,
       *    and 77 % of the garment texture) drew opaque. The dress is white and cyan in the file.
       *  * **VRM 1.0 node constraints never ran** — a rotating accessory or a constraint-driven bone simply
       *    did not move.
       *
       * The spring step stays as it was: it is the one part this wrapper already had.
       */
      updatePhysics: function (delta) {
        if (!vrm) return;
        if (vrm.springBoneManager) vrm.springBoneManager.update(delta);
        if (vrm.nodeConstraintManager) vrm.nodeConstraintManager.update();
        if (vrm.materials && vrm.materials.forEach) {
          vrm.materials.forEach(function (material) {
            if (material && typeof material.update === 'function') material.update(delta);
          });
        }
      },
      /** Layer 1 first-person meshes; a desktop pet should not show them. */
      hideFirstPersonMeshes: function () {
        try {
          VRM.VRMUtils.deepDispose; // touch to keep the import meaningful
          if (vrm && vrm.firstPerson && vrm.firstPerson.meshes) {
            vrm.firstPerson.meshes.forEach(function (mesh) { mesh.visible = true; });
          }
        } catch (error) { /* optional */ }
      },
    };
  }

  /** Build a plain glTF/GLB avatar (no VRM extensions). */
  function wrapGLTF(THREE, gltf) {
    gltf.scene.traverse(function (node) {
      if (node.isMesh) {
        node.castShadow = true;
        node.frustumCulled = false;
        if (node.material && node.material.map) applyTextureColorSpace(THREE, node.material.map);
      }
    });
    var head = null;
    gltf.scene.traverse(function (node) {
      if (!head && (node.name === 'head' || node.name === 'Head' || node.name === 'mixamorigHead')) head = node;
    });
    if (head) head.userData.vrmpet3dRestQuat = head.quaternion.clone();
    return {
      root: gltf.scene,
      kind: 'gltf',
      bones: {},
      gazeBone: head,
      expressions: null,
      chains: {},
      chainSpread: {},
      rest: {},
      updatePhysics: null,
    };
  }

  // ===========================================================================
  // Authored motion — the shared pieces
  // ===========================================================================
  //
  // A user-supplied `.vrma` can replace the procedural idle for the states the
  // settings map it to. Two facts shape all of it:
  //
  //   * a clip belongs to ONE model — a VRMA is retargeted through one VRM's
  //     humanoid — so the BYTES are cached per motion id and the clip is built
  //     lazily for whatever avatar is installed, and thrown away when the model
  //     changes;
  //   * the drag physics owns `held`/`falling`/`landing`, so those states always
  //     take the procedural path whatever the map says.
  //
  // Nothing here may throw into the render loop: a malformed file, or one that
  // cannot bind to the current model, has to become a `reason` string and leave
  // the pet rendering exactly as it did before.

  /** Put an avatar back into the pose it had before any clip ran. */
  function resetAvatarPose(avatar) {
    if (!avatar) return;
    try {
      if (avatar.kind === 'vrm') {
        if (avatar.vrm && avatar.vrm.humanoid) {
          // A VRMA drives the NORMALIZED rig, so that is what has to be reset;
          // the following update() copies the result back onto the raw bones.
          avatar.vrm.humanoid.resetNormalizedPose();
          // ...but the reset pose is the model's own rest pose, which for a VRM is a
          // T-pose. The relaxed stand has to be put back on top of it, or every drag
          // and every unmapped state would snap the pet back to a T.
          if (avatar.applyStance) avatar.applyStance();
          avatar.vrm.humanoid.update();
        }
      }
      // A glTF or the procedural placeholder exposes no rig a clip can drive. The MMD
      // branch that restored `skeletonRest` went with MMD support (2026-10-12): nothing
      // left here writes bone poses absolutely, so there is nothing to put back.
    } catch (error) {
      // A reset that fails must not stop the pet from rendering.
    }
  }

  /**
   * Normalise the several buffer shapes a caller may hand us into one ArrayBuffer.
   *
   * The result is always a COPY. A clip's parser keeps a view over these bytes for as
   * long as it is cached, so the caller's buffer must not be able to change or detach
   * underneath it.
   */
  function toArrayBuffer(buffer) {
    if (buffer instanceof ArrayBuffer) return buffer.slice(0);
    if (buffer && buffer.buffer instanceof ArrayBuffer) {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    return null;
  }

  // ===========================================================================
  // Scene
  // ===========================================================================

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options { assetBase, modelId, onError }
   */
  function Scene(canvas, options) {
    options = options || {};
    var vendor = globalThis.__VRMPET3D_VENDOR__;
    if (!vendor) throw new Error('vrmpet3d: the 3D chunk is not loaded.');
    var core = globalThis.__VRMPET3D_CORE__;
    if (!core) throw new Error('vrmpet3d: lib/core.js is not loaded.');

    this.THREE = vendor.THREE;
    this.VRM = vendor.VRM;
    // `vendor.MMD` is gone with the MMD stack (2026-10-12): the chunk publishes THREE, VRM and a glTF addon.
    this.addons = vendor.addons;
    this.core = core;
    this.canvas = canvas;
    this.options = options;
    this.onError = typeof options.onError === 'function' ? options.onError : function () {};
    this.avatar = null;
    this.kind = 'placeholder';
    this.disposed = false;
    this.preferences = core.cleanPreferences(options.preferences);
    this.source = new AssetSource({ assetBase: options.assetBase, modelId: options.modelId });
    this.motion = new Motion(this.THREE, core);
    /**
     * The motion needs the SCENE to answer two questions that are not its business: which clip is playing in
     * which state (the per-clip 凝视 switch), and whether a preview is up. `holdGaze` is pushed explicitly,
     * but the clip switch is asked for per frame, so the back-reference is set here rather than threading a
     * callback through every call site.
     */
    this.motion.scene = this;
    this.height = 1;
    this.frame = 0;
    this.currentModelId = null;
    this.loading = null;
    /** Motion bytes by id: { buffer, format }, format detected from the bytes. */
    this.motionBytes = {};
    /** Clips built for the CURRENT avatar, by motion id. Dropped on installAvatar. */
    this.motionClips = {};
    /** `{ state: [motionId, ...] }` — which motions a state draws from. */
    this.motionMap = core.cleanMotions(this.preferences.motions);
    /**
     * The clip drawn for the state the pet is currently in.
     *
     * A state draws ONE clip from its list, and it draws it when the state is ENTERED rather than on every
     * frame: a per-frame draw would flicker between the clips of a list several times a second, and
     * `playing` would be meaningless. `pickState` is what detects the entry, and it is also the latch that
     * stops a one-shot clip from being replayed forever — see `pickSpent`.
     */
    this.pickState = null;
    this.pickId = null;
    /** True once a one-shot clip for `pickState` has played to its end. Cleared on the next state entry. */
    this.pickSpent = false;
    /**
     * The one-shot that is playing because its state's interval came due, and when each state's next one is due.
     *
     * `oneShot` is `{ state, id }` while a scheduled clip runs. `motionWindows` is `{ state: { nextAt, window } }`
     * — one deadline PER STATE, because the interval belongs to the state and the pet moves between them: a
     * single field meant that entering another state threw the deadline away, which is how a 20–80 s window kept
     * being redrawn and never rang (measured on the real pet, 2026-10-09). A state with no window (or no
     * non-looping clip mapped) has no entry at all.
     */
    this.oneShot = null;
    this.motionWindows = {};
    /**
     * A transient PREVIEW: `{ state?, motionId?, expression?, mouth? }` while the settings window is showing
     * what a choice would look like, and null the rest of the time. Never persisted — see `cleanPreview`.
     */
    this.preview = null;
    /** What a mixer is driving right now, or null while the procedural idle runs. */
    this.playback = null;
    /** Why the last motion could not play, for describeMotions(). */
    this.motionReason = null;
    /**
     * The model's spring chains, as the settings window sees them: names, per-joint AUTHORED physics,
     * and the joints themselves. Empty for a model without spring bones, which is why every method
     * below has to tolerate an empty list rather than assume a VRM.
     */
    this.springChainInfo = [];
    /**
     * The bone → chain index, rebuilt with `springChainInfo` (see `indexSpringChains`).
     *
     * A press has to be able to say WHICH spring chain it grabbed — "its twintail", "its skirt" — and that question
     * is answered by the bone the raycast already names. Kept as a Map keyed by the bone OBJECT: the index and the
     * raycast meet on the same object, so no node-name rule (three rewrites characters) can come between them.
     */
    this.springChainOf = null;
    /**
     * The cursor's draught, and the gravity it is pushing against.
     *
     * `wind` is `{x,y,z,power}` in the model's own frame (see `core.windFromPointer`), or null when there is
     * none. `springBase` is a snapshot of every joint's own gravity direction and power, taken whenever the
     * chains are (re)applied: the wind is applied by STEERING those values, so the snapshot is what lets a
     * swept pet be handed back its own physics instead of staying blown sideways for ever.
     */
    this.wind = null;
    this.springBase = [];
    /**
     * Expression state. `behaviour` is what the blink timer and the emotion reactions currently want;
     * `applied` is what was last handed to three-vrm, so a value that goes away can be released
     * instead of sticking on the face forever.
     */
    this.expressionState = {};
    this.expressionApplied = {};
    this.expressionBehaviour = { blink: 0, blinkExpression: 'blink', emotion: null, emotionWeight: 0 };
    /**
     * Injectable randomness.
     *
     * The blink and emotion timers are the only places in this module that would otherwise be
     * unpredictable, and unpredictable is untestable: a suite can hand in a sequence instead.
     */
    this.random = typeof options.random === 'function' ? options.random : Math.random;

    var THREE = this.THREE;

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      // The page behind the pet must show through: this is an overlay, not a panel.
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
      /**
       * Keep the drawing buffer readable after the frame.
       *
       * Off by default — it costs a copy of the frame — and on for the desktop window, whose
       * hit test asks "did we paint the pixel under the cursor?" by reading the framebuffer
       * back. Without it the buffer may already be cleared when the question is asked, and the
       * answer would be "nothing was painted" everywhere: every click would pass through the
       * pet. See `lib/desktop-page.js`.
       */
      preserveDrawingBuffer: options.preserveDrawingBuffer === true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    if ('outputColorSpace' in this.renderer) this.renderer.outputColorSpace = resolveColorSpace(THREE);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    // Lighting is deliberately simple and unconfigurable: a desktop pet should
    // look the same on every machine, and an HDR environment would need an asset
    // the plugin does not ship.
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x2a3350, 1.6));
    var key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.2, 4.0, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -0.5;
    key.shadow.bias = -0.0015;
    this.scene.add(key);
    this.keyLight = key;

    var fill = new THREE.DirectionalLight(0x9fc6ee, 0.7);
    fill.position.set(-2.5, 1.5, -1.5);
    this.scene.add(fill);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
    this.camera.position.set(0, 0.5, 2);

    /**
     * The stage is the thing the client moves around the viewport. The model
     * lives inside it, already framed so its feet are at the stage origin.
     */
    this.stage = new THREE.Group();
    this.scene.add(this.stage);

    /** Ground blob shadow, drawn only when the model has no real shadow caster. */
    this.shadowPlane = null;

    /**
     * The resting Y `setPlacement` resolved, WITHOUT the idle bob. The idle adds
     * the bob on top of this each frame rather than accumulating into the stage —
     * see the note in `tick`.
     */
    this.baseY = 0;
    /** Drag velocity in screen pixels per second, and the damped body offset it drives. */
    this.dragMotion = { vx: 0, vy: 0 };
    this.dragOffset = { x: 0, y: 0 };
    /** The damped lean a vertical drag drives, in radians. See `DRAG_PITCH_PER_PIXEL`. */
    this.dragPitch = 0;
    /**
     * How much bigger the CANVAS is than the pet's slot, as a multiplier (1 = the canvas is the slot).
     *
     * A clip can reach past the slot — a wave puts a hand well outside the box the pet is framed in — and
     * because the window's rectangle IS that box, the hand was drawn straight into the window's edge and cut
     * off. The surface expands the canvas for the clip and calls `setFrameMargin`, which scales the camera
     * distance by the same factor so the pet keeps its size in pixels and simply gains room around it.
     */
    this.frameMargin = 1;
  }

  /**
   * Set the canvas-to-slot ratio and refit. Clamped, because this is the one field that decides whether the
   * model fills its window: a margin below 1 would crop the pet itself, and an absurd one would shrink it to
   * a dot in a window far larger than the pet.
   */
  Scene.prototype.setFrameMargin = function (margin) {
    var next = Number(margin);
    if (!Number.isFinite(next) || next <= 0) next = 1;
    next = Math.min(3, Math.max(1, next));
    if (Math.abs(next - this.frameMargin) < 1e-6) return this.frameMargin;
    this.frameMargin = next;
    this.refitCamera();
    return this.frameMargin;
  };

  /** Resize the drawing buffer and the camera aspect to a CSS size. */
  Scene.prototype.resize = function (width, height) {
    if (this.disposed) return;
    var w = Math.max(1, Math.round(width));
    var h = Math.max(1, Math.round(height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w;
    this.height = h;
    this.refitCamera();
  };

  /** Recompute the camera distance from the current model's measured size. */
  Scene.prototype.refitCamera = function () {
    if (!this.avatar || !this.box) return;
    var framing = this.framing;
    // FIT_MARGIN is applied once, through computeCameraDistance's own margin. An
    // earlier revision multiplied and divided by HEIGHT_FRACTION here, which
    // cancelled out and then applied the margin twice.
    var distance = this.core.computeCameraDistance(this.box, framing.scale, FOV, FIT_MARGIN);
    // The canvas may be LARGER than the pet's slot (`frameMargin`), which is how a clip whose arm reaches
    // past the slot stops being clipped by the window. The camera pulls back by exactly that factor, so the
    // model keeps the same size in PIXELS while it gains room around it — without this the model would be
    // framed into the bigger canvas and grow with it, which is the opposite of the request.
    distance *= this.frameMargin > 0 ? this.frameMargin : 1;
    // Guard against a degenerate model producing a camera inside the geometry.
    distance = Math.max(distance, this.framing.scaled.y * 0.9);
    this.cameraDistance = distance;
    var eyeY = this.framing.scaled.y * 0.55;
    // The view orbit: the right-drag turns the CAMERA around the pet rather than
    // turning the pet, so it composes with whatever pose the idle or a clip is
    // writing. The orbit is in the horizontal plane scaled by cos(pitch) so the
    // distance stays `distance` at every angle — without that factor the pet drifts
    // closer as the view tilts, and a tilt would read as a zoom.
    var yaw = this.preferences.viewYaw || 0;
    var pitch = this.preferences.viewPitch || 0;
    var sweep = Math.cos(pitch);
    this.camera.position.set(
      distance * Math.sin(yaw) * sweep,
      eyeY + distance * Math.sin(pitch),
      distance * Math.cos(yaw) * sweep
    );
    this.camera.lookAt(0, this.framing.scaled.y * 0.5, 0);
    if (this.keyLight) {
      this.keyLight.position.set(distance * 0.9, this.framing.scaled.y * 2.4, distance * 1.3);
      this.keyLight.shadow.camera.updateProjectionMatrix();
    }
  };

  /**
   * Measure an object and frame it on the stage.
   *
   * `Box3.setFromObject(object, false)` is used deliberately. The `precise` path
   * transforms every vertex individually and can disagree with the non-precise
   * path by a few millimetres, which would make the framing depend on which path
   * measured it. One path, measured and applied consistently.
   */
  Scene.prototype.frameAvatar = function (root) {
    var THREE = this.THREE;
    root.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(root, false);
    if (!Number.isFinite(box.min.y) || box.max.y - box.min.y <= 0) {
      throw new Error('vrmpet3d: the model has no measurable geometry.');
    }
    var framing = this.core.computeFraming(box, { viewportHeight: 1, heightFraction: HEIGHT_FRACTION });

    // One node carries both scale and position, using `worldOffset`. three
    // composes T · R · S, so the LOCAL offset on a scaled node would not be
    // scaled and the pet would sink into the floor; see core.computeFraming.
    //
    // `modelScale` is NOT applied here any more. It used to scale the model inside a
    // slot the camera was already fitted to, which is exactly what let an enlarged
    // model spill past the canvas edges; it is folded into the slot size instead (see
    // the client's Placement.setSize), so the canvas, the drawing buffer and the camera
    // all grow together and nothing can be cut off.
    root.scale.setScalar(framing.scale);
    root.position.set(framing.worldOffset.x, framing.worldOffset.y, framing.worldOffset.z);

    this.box = box;
    this.framing = framing;
    // The model's own height in world units. Deliberately NOT `this.height`, which is
    // the canvas height in pixels and is what the pointer-to-gaze mapping measures
    // against: the two used to share one field, and loading any avatar replaced the
    // pixel height with a fraction of a world unit. Every gaze target then landed
    // hundreds of screen-heights away, which switched "follow pointer" off in silence.
    this.modelHeight = framing.scaled.y;
  };

  /** Replace the current avatar with a hardware-ready one. */
  Scene.prototype.installAvatar = function (avatar, root) {
    // Stop before the old avatar is replaced: stopping is what undoes the clip's
    // pose, and it has to happen while the old model is still installed. Every
    // clip is then dropped, because a clip is fitted to one model — the cached
    // BYTES survive and are rebuilt lazily for the avatar being installed.
    this.stopPlayback(null);
    this.dropAllMotionClips();
    while (this.stage.children.length) {
      var child = this.stage.children.pop();
      // Never dispose a shared geometry/material graph here: VRM avatars reuse
      // both across meshes, and disposing one would blank the next.
      this.stage.remove(child);
    }
    this.frameAvatar(root);
    this.stage.add(root);
    this.avatar = avatar;
    this.kind = avatar.kind;

    // The gaze's starting point, recorded here because this is the one place EVERY avatar
    // passes through — VRM, glTF and the procedural placeholder alike. A wrap path that
    // forgot this used to fall back to a rotation about the head's own local axes, which is
    // how the placeholder ended up the only kind whose head tipped the wrong way. The cached
    // axes are cleared with it: they are measured against this model's orientation, so they
    // must not outlive it.
    var gazeHead = gazeNodeFor(avatar);
    if (gazeHead) {
      if (!gazeHead.userData.vrmpet3dRestQuat) {
        gazeHead.userData.vrmpet3dRestQuat = gazeHead.quaternion.clone();
      }
      delete gazeHead.userData.vrmpet3dGazeAxes;
    }

    // The SCENE, not `this.scene`: inside the Scene there is no such property, so this argument used to be
    // `undefined` and the motion's back-reference was silently null. Nothing needed it until the per-clip 凝视
    // switch did (2026-10-09 late), which is exactly the kind of breakage a null back-reference hides.
    this.motion.attach(avatar, this);
    // Spring chains are rebuilt from the document the model came from, so the settings window can
    // name them the way the author did, and this avatar's own authored physics becomes the baseline
    // that "default" returns to. A model with neither spring bones nor expressions yields an empty
    // list and an empty manager, and every method above tolerates both.
    var springChains = collectSpringChains(avatar);
    this.springChainInfo = springChains.chains;
    this.springChainSkipped = springChains.skipped;
    // …and the bone → chain index that lets a PRESS name the chain it grabbed (see `springChainForBone`).
    this.springChainOf = indexSpringChains(this.springChainInfo);
    // A VRM 0.x file declares no gravity at all, so a chain from one would never fall: supply it here,
    // before the preferences are applied, so the supplied value is what the settings window calls the
    // chain's default and the user can still change or remove it.
    this.supplyMissingGravity();
    this.expressionApplied = {};
    /**
     * …and the wind's baseline is taken HERE, where the chains come into existence.
     *
     * `captureSpringBase` also runs at the end of `applyPreferences`, but preferences are applied before a
     * model is loaded, so on a fresh pet that call finds nothing to snapshot and the first sweep would have
     * had no gravity to lean against (measured: `windState().joints === 0` on a real model with two chains).
     */
    this.captureSpringBase();
    this.expressionBehaviour = { blink: 0, blinkExpression: 'blink', emotion: null, emotionWeight: 0 };
    this.expressionState = { nextBlinkAt: null, blinkUntil: 0, nextIdleEmotionAt: null, emotionUntil: 0 };
    this.motion.setPhysics(this.preferences.physics);
    this.motion.setLookAtPointer(this.preferences.lookAtPointer);
    this.motion.setGazeIdle(this.preferences.gazeIdleSeconds);
    this.updateShadowPlane();
    this.refitCamera();
  };

  /** A soft ground blob, so the pet does not appear to float. */
  Scene.prototype.updateShadowPlane = function () {
    var THREE = this.THREE;
    if (this.shadowPlane) {
      this.stage.remove(this.shadowPlane);
      this.shadowPlane.geometry.dispose();
      this.shadowPlane.material.dispose();
      this.shadowPlane = null;
    }
    var width = this.framing ? this.framing.scaled.x * 1.3 : 0.6;
    var depth = this.framing ? Math.max(this.framing.scaled.z, this.framing.scaled.x * 0.4) * 1.3 : 0.4;
    // A radial-gradient canvas texture gives a soft blob without a second asset.
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.42)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    var texture = new THREE.CanvasTexture(canvas);
    applyTextureColorSpace(THREE, texture);

    var geometry = new THREE.PlaneGeometry(width, depth);
    var material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    var plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.001;
    plane.renderOrder = -1;
    this.stage.add(plane);
    this.shadowPlane = plane;
  };

  /**
   * Build and install the procedural avatar — for the GEOMETRY FIXTURES, not for the product.
   *
   * The operator removed the built-in avatar on 2026-10-10 ("内置的占位模型还是没删掉，把Sample Model设为内置模型").
   * What that means is implemented in three places rather than here:
   *
   *   * `lib/client.js` no longer loads `client.placeholder.js`, and the chunk generator no longer builds it;
   *   * the host's source whitelist no longer serves `placeholder.js` to any page;
   *   * `Scene.loadModel` no longer falls back to it — a model that fails reports the failure and leaves the
   *     stage exactly as it was.
   *
   * The method STAYS because `build/probe/*` and the browser suite use it as a model-free avatar to test framing,
   * the gaze algorithm and the render loop with; deleting the only such fixture would delete those checks rather
   * than improve them. `globalThis.__VRMPET3D_PLACEHOLDER__` is the gate, and in the shipped plugin nothing defines
   * it, so this throws before it can draw anything.
   */
  Scene.prototype.usePlaceholder = function () {
    var placeholder = globalThis.__VRMPET3D_PLACEHOLDER__;
    if (!placeholder) throw new Error('vrmpet3d: lib/placeholder.js is not loaded.');
    var avatar = placeholder.build(this.THREE);
    this.installAvatar(avatar, avatar.root);
    this.currentModelId = 'placeholder';
    this.kind = 'placeholder';
    return avatar;
  };

  /**
   * Load a model by catalog id and install it.
   *
   * Returns a promise resolving to a status object rather than throwing on a model-level failure, and it does
   * NOT substitute anything for a model that will not load.
   *
   * That substitution — a built-in procedural avatar — was removed on 2026-10-10 (operator: "内置的占位模型还是没
   * 删掉，把Sample Model设为内置模型"). It had two effects worth remembering: it reported `ok: true` for a pet that
   * was not the model anyone chose, and it hid parse failures behind a fake pet that looked deliberate. Now a
   * failure is a failure: the error goes to `onError`, the avatar that was on screen stays where it is, and the
   * caller decides what to say.
   *
   * An EMPTY id (nothing catalogued, or nothing resolved yet) is not a failure to report either — it is
   * "no model chosen", which the surfaces say in words rather than by showing a stand-in.
   */
  Scene.prototype.loadModel = function (modelId) {
    var self = this;

    if (!modelId || modelId === 'placeholder') {
      return Promise.resolve({ ok: false, kind: null, error: null, note: 'no model selected' });
    }

    // Coalesce concurrent loads of the same id.
    if (this.loading && this.loading.id === modelId) return this.loading.promise;

    if (!this.source || this.options.assetBase === null) {
      return Promise.resolve({ ok: false, error: 'no asset route is available' });
    }

    this.source.modelId = modelId;
    var url = this.source.urlFor(null);
    var promise = fetch(url, { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('asset route returned HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(function (buffer) { return self.parse(buffer, modelId); })
      .then(function (status) {
        if (!status.ok) {
          // Reported, not papered over: whatever is on the stage stays there, and the message says why the
          // model the user picked is not.
          self.onError(status.error || ('could not load ' + modelId));
        }
        return status;
      })
      .catch(function (error) {
        var status = { ok: false, error: errorText(error) };
        self.onError(status.error);
        return status;
      })
      .finally(function () {
        if (self.loading && self.loading.id === modelId) self.loading = null;
      });

    this.loading = { id: modelId, promise: promise };
    return promise;
  };

  /** Route a buffer to the right loader by inspecting its bytes, not its name. */
  Scene.prototype.parse = function (buffer, modelId) {
    var self = this;
    var format = this.core.detectFormat(buffer);
    var manager = createManager(this.THREE, this.source);

    var done = function (avatar, root) {
      self.installAvatar(avatar, root);
      self.currentModelId = modelId;
      return { ok: true, kind: avatar.kind, format: format };
    };
    var fail = function (error) {
      var message = errorText(error);
      self.onError(message);
      return { ok: false, error: message, format: format };
    };

    /**
     * A PMX or PMD file is REFUSED, with the reason, and that is the whole of the MMD story since the
     * 2026-10-12 rename: this plugin loads VRM only, so the MMD stack (`@moeru/three-mmd`'s MMDLoader, the
     * `wrapMMD` avatar wrapper with its IK/grant solvers, the `.vmd` player) is out of the chunk. The bytes are
     * still SNIFFED — `core.detectFormat` reads the magic number — because "this is a PMX, which this build does
     * not load" is a far better answer than "unrecognised model format", and it is what a user dragging in an
     * old model needs to read.
     */
    if (format === 'pmx' || format === 'pmd') {
      var refusal = format.toUpperCase() + ' is not supported: this build loads VRM only (see docs/ASSET-CONTRACT.md).';
      this.onError(refusal);
      return Promise.resolve({ ok: false, format: format, error: refusal });
    }

    if (format === 'glb' || format === 'gltf') {
      var gltfLoader = new this.addons.GLTFLoader(manager);
      gltfLoader.register(function (parser) { return new self.VRM.VRMLoaderPlugin(parser); });
      return new Promise(function (resolve) {
        gltfLoader.parse(buffer, self.source.directoryUrl(), function (gltf) {
          try {
            var avatar = gltf.userData && gltf.userData.vrm
              ? wrapVRM(self.THREE, self.VRM, gltf, gltf.scene, self.core)
              : wrapGLTF(self.THREE, gltf);
            resolve(done(avatar, gltf.scene));
          } catch (error) { resolve(fail(error)); }
        }, function (error) { resolve(fail(error)); });
      });
    }

    return Promise.resolve({
      ok: false,
      format: format,
      error: 'unrecognised model format (expected VRM/GLB/glTF).',
    });
  };

  // ---------------------------------------------------------------------------
  // Authored motion — the client-facing API
  // ---------------------------------------------------------------------------

  /**
   * Cache one motion's bytes and build its clip for the CURRENT avatar.
   *
   * The bytes are what is cached per id; the clip is built (and thrown away)
   * per avatar, because a VRMA is retargeted through one VRM's humanoid. A failed
   * build is still cached — as a record carrying a `reason` — so the failure is
   * reported once per avatar instead of being retried on every frame.
   *
   * @param {string} motionId
   * @param {ArrayBuffer|ArrayBufferView} buffer the whole `.vrma` file.
   * @param {object} [options]
   * @param {boolean} [options.loop] play this clip as a loop (default) or exactly once.
   * @returns {Promise<{ok: boolean, format: string, loop: boolean, reason?: string}>}
   */
  Scene.prototype.loadMotion = function (motionId, buffer, options) {
    var self = this;
    if (typeof motionId !== 'string' || !motionId) {
      return Promise.resolve({ ok: false, format: 'unknown', reason: 'a motion id is required' });
    }
    var bytes = toArrayBuffer(buffer);
    if (!bytes) {
      return Promise.resolve({ ok: false, format: 'unknown', reason: 'the motion payload is not an ArrayBuffer' });
    }

    /**
     * VRMA only since the 2026-10-12 rename. A `.vmd` is still RECOGNISED by
     * `core.detectMotionFormat` (its banner is a magic string), so the refusal can name
     * what it found rather than saying "not a motion file" — and this path caches
     * nothing, so a VMD never appears as an available clip.
     */
    var format = this.core.detectMotionFormat(bytes);
    if (format !== 'vrma') {
      this.motionReason = format === 'vmd'
        ? 'motion "' + motionId + '" is a VMD, which this build does not play (VRMA only; see docs/ASSET-CONTRACT.md)'
        : 'motion "' + motionId + '" is not a VRMA file (detected: ' + format + ')';
      return Promise.resolve({ ok: false, format: format, reason: this.motionReason });
    }

    // New bytes invalidate whatever clip was built from the old ones, and stopping
    // first means the pet is never left posed by a clip that no longer exists.
    this.dropMotionClip(motionId);
    /**
     * Whether this clip loops.
     *
     * The flag comes from the caller, which reads it from the host's catalog (the motion directory's own
     * `vrmpet3d-motions.json`). Absent or anything but `false` means LOOP, which is what every clip did
     * before the flag existed and therefore the only safe default: a clip wrongly marked as looping still
     * animates, while a clip wrongly marked as one-shot would stop after one pass and look broken.
     */
    var loop = !(options && options.loop === false);
    this.motionBytes[motionId] = { buffer: bytes, format: format, loop: loop };

    return this.buildMotionClip(motionId).then(function (record) {
      if (!record) {
        self.motionReason = 'motion "' + motionId + '" is not cached';
        return { ok: false, format: format, loop: loop, reason: self.motionReason };
      }
      var ok = !record.error && record.tracks > 0;
      if (ok) {
        self.motionReason = null;
        return { ok: true, format: format, loop: loop };
      }
      self.motionReason = record.error
        || ('motion "' + motionId + '" binds to no bone in this model');
      return { ok: false, format: format, loop: loop, reason: self.motionReason };
    }).catch(function (error) {
      self.motionReason = errorText(error);
      return { ok: false, format: format, loop: loop, reason: self.motionReason };
    });
  };

  /**
   * Forget every cached motion — bytes and clips — and stop playback.
   *
   * The state map is NOT cleared: it is the user's configuration, and it is set
   * through setMotionMap. An entry whose bytes are gone simply falls back to the
   * procedural idle, and describeMotions() says why.
   */
  Scene.prototype.clearMotions = function () {
    this.stopPlayback(null);
    this.dropAllMotionClips();
    this.motionBytes = {};
    this.motionReason = null;
  };

  /**
   * `{ state: [motionId, ...] }` — which motions a state draws from.
   *
   * `core.cleanMotions` drops every key outside `core.MOTION_STATES`, so
   * `held`/`falling`/`landing` are refused here rather than being filtered again
   * on every frame, and an empty list or a missing key means "use the procedural
   * idle". A single id is accepted as a bare string, because that is the shape
   * every build before the list existed persisted.
   *
   * @returns {object} the cleaned map that is now in force.
   */
  Scene.prototype.setMotionMap = function (mapping) {
    var cleaned = this.core.cleanMotions(mapping);
    /**
     * Re-applying the SAME map is not a change, and treating it as one costs two visible things.
     *
     * A surface that re-applies the map it already has — a settings poll, a panel that re-reads on every
     * event — used to restart the state's clip and throw away the one-shot window every time. Measured on the
     * real pet on 2026-10-09: `scheduled.nextAt` moved by exactly the elapsed time between two reads thirty
     * seconds apart, i.e. it was being redrawn continuously and the interval could never come due.
     *
     * The comparison is on the CLEANED maps, whose keys come out in `MOTION_STATES` order, so it is a stable
     * serialisation rather than a guess about key order.
     */
    if (this.motionMap && JSON.stringify(cleaned) === JSON.stringify(this.motionMap)) return this.motionMap;
    this.motionMap = cleaned;
    // Mirror it into the preferences view so a caller that reads (or persists)
    // `scene.preferences.motions` sees what is actually in force.
    this.preferences.motions = this.core.cleanMotions(this.motionMap);
    // The list changed under the state the pet is in, so the clip that was drawn from the old list may
    // not be in the new one: forget the draw and let the next frame draw again. Without this, editing the
    // map while the pet rests would leave it on a clip that is no longer selected (or on nothing at all).
    // The scheduled one-shot goes with it: its window and its clip were chosen for the old list.
    this.forgetMotionPick();
    return this.motionMap;
  };

  /**
   * Diagnostics for the settings panel and for tests.
   *
   * @returns {{mapped: object, available: Array, playing: string|null, picked: string|null,
   *   scheduled: object|null, reason: string|null}}
   *   `mapped` is `{state: [id, ...]}` in the same canonical shape the cleaner produces; `available`
   *   entries are `{id, format, loop, tracks, duration}`, where `loop` is the mode in force (the user's
   *   override, else the catalog's) and `tracks` is 0 until a clip has been built for the current avatar;
   *   `picked` is the base clip drawn for the current state (which is `playing` once its build lands, and
   *   tells them apart while an asynchronous build is still running); `scheduled` says whether a one-shot
   *   interval is armed for the current state, when it next comes due, and which clip is running because
   *   of it. `pending` and `reason` are extra: a build still running, and why one failed.
   */
  Scene.prototype.describeMotions = function () {
    var self = this;
    var available = [];
    Object.keys(this.motionBytes).forEach(function (id) {
      var bytes = self.motionBytes[id];
      var record = self.motionClips[id];
      available.push({
        id: id,
        format: bytes.format,
        // The mode IN FORCE, not merely what the bytes were handed with: a preference change must be
        // visible here even before the clip is re-loaded.
        loop: self.motionLoops(id, state),
        tracks: record && record.tracks ? record.tracks : 0,
        duration: record && Number.isFinite(record.duration) ? record.duration : 0,
        pending: Boolean(record && record.pending),
        reason: record ? record.error : null,
      });
    });
    // Sorted so the settings panel lists motions in a stable order.
    available.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });

    var mapped = {};
    var states = Object.keys(this.motionMap || {});
    for (var i = 0; i < states.length; i++) mapped[states[i]] = this.motionMap[states[i]].slice();

    var state = this.pickState || null;
    var window_ = this.core.motionEveryFor ? this.core.motionEveryFor(this.preferences, state) : null;

    return {
      mapped: mapped,
      available: available,
      playing: this.playback ? this.playback.id : null,
      picked: this.pickId || null,
      scheduled: {
        state: state,
        window: window_ || null,
        // `null` when nothing is armed: either the state has no window or it has no one-shot to fire.
        nextAt: state ? this.scheduledMotionAt(state) : null,
        // Every state that has a deadline right now, which is what shows whether a window survived a state flip.
        armed: Object.keys(this.motionWindows || {}),
        due: this.scheduledMotionDue(state),
        running: this.oneShot ? this.oneShot.id : null,
        candidates: state ? this.scheduledCandidates(state) : [],
      },
      reason: this.motionReason || null,
    };
  };

  // ---------------------------------------------------------------------------
  // Authored motion — building and playing
  // ---------------------------------------------------------------------------

  /**
   * Build one cached motion into a clip for the CURRENT avatar, once.
   *
   * @returns {Promise<object|null>} the record, which is also left in
   *   `motionClips[id]`. The promise never rejects; failures live in
   *   `record.error`.
   */
  Scene.prototype.buildMotionClip = function (motionId) {
    var cached = this.motionBytes[motionId];
    if (!cached) return Promise.resolve(null);
    var existing = this.motionClips[motionId];
    if (existing) return existing.ready || Promise.resolve(existing);

    var record = {
      id: motionId,
      format: cached.format,
      clip: null,
      mixer: null,
      action: null,
      /** The object the mixer is rooted at; needed to uncache the bindings. */
      root: null,
      tracks: 0,
      duration: 0,
      /** True while an asynchronous (VRMA) build is still running. */
      pending: false,
      /** Whether the clip writes the head the pointer gaze drives. */
      headTrack: false,
      /** Whether this clip repeats (default) or plays once; set by `adoptClip` from the cached flag. */
      loop: true,
      /** Set when a one-shot clip has reached its end; cleared by `startPlayback`. */
      finished: false,
      /** Why this motion cannot drive the current avatar, or null. */
      error: null,
      ready: null,
    };
    this.motionClips[motionId] = record;

    // VRMA only since 2026-10-12; `loadMotion` has already refused anything else, so
    // there is no `.vmd` branch left to dispatch to.
    if (cached.format === 'vrma') this.buildVrmaRecord(record, cached);
    else record.error = 'unrecognised motion format "' + cached.format + '"';

    if (!record.ready) record.ready = Promise.resolve(record);
    return record.ready;
  };

  /** Retarget a VRMA onto the installed VRM through a GLTFLoader plugin. */
  Scene.prototype.buildVrmaRecord = function (record, cached) {
    var self = this;
    var VRM = this.VRM;
    var avatar = this.avatar;
    if (!VRM || !VRM.VRMAnimationLoaderPlugin || typeof VRM.createVRMAnimationClip !== 'function') {
      record.error = 'this build of the 3D chunk cannot play VRMA files';
      return;
    }
    if (!avatar || avatar.kind !== 'vrm' || !avatar.vrm) {
      record.error = 'a VRMA drives VRM humanoid bones, so it needs a VRM model; the current avatar is '
        + (avatar ? avatar.kind : 'none');
      return;
    }

    record.pending = true;
    record.ready = new Promise(function (resolve) {
      var loader;
      try {
        loader = new self.addons.GLTFLoader();
        loader.register(function (parser) { return new self.VRM.VRMAnimationLoaderPlugin(parser); });
      } catch (error) {
        record.error = errorText(error);
        record.pending = false;
        resolve(record);
        return;
      }
      // The VRMA plugin's `afterRoot` is awaited by GLTFLoader before this
      // callback runs, so `userData.vrmAnimations` is already populated.
      loader.parse(cached.buffer, '', function (gltf) {
        var current = self.motionClips[record.id];
        if (current !== record) {
          // The model was swapped while the parse was in flight; a clip fitted to
          // the previous avatar must never be handed to the new one.
          record.error = 'the avatar changed while the motion was loading';
          record.pending = false;
          resolve(record);
          return;
        }
        try {
          var animations = gltf.userData ? gltf.userData.vrmAnimations : null;
          var animation = animations && animations.length ? animations[0] : null;
          if (!animation) {
            record.error = 'no VRMC_vrm_animation data in this file (is it really a .vrma?)';
          } else {
            self.adoptClip(record, self.VRM.createVRMAnimationClip(animation, avatar.vrm), avatar.root);
          }
        } catch (error) {
          record.error = errorText(error);
        }
        record.pending = false;
        resolve(record);
      }, function (error) {
        record.error = errorText(error);
        record.pending = false;
        resolve(record);
      });
    });
    return record.ready;
  };

  /**
   * Take ownership of a freshly built clip: check that it binds to anything at
   * all, give it a mixer rooted where its tracks resolve, and cache the action.
   */
  Scene.prototype.adoptClip = function (record, clip, mixerRoot) {
    if (!clip || !clip.tracks) {
      record.error = 'the motion produced no clip';
      return;
    }
    record.clip = clip;
    record.tracks = clip.tracks.length;

    if (!record.tracks) {
      // A clip whose tracks bind to nothing parses perfectly and animates nothing —
      // the single most likely user error (motion authored for another model), and
      // worth saying so instead of rendering a pet that ignores its motion. The old
      // MMD note here was about `buildAnimation` dropping unknown VMD bone names;
      // that path is gone (2026-10-12), the failure it describes is not.
      record.error = "the motion binds to none of this model's bones (it was authored for a different model)";
      return;
    }

    // three's LoopRepeat computes `time % duration`, which is NaN at a duration of
    // 0 — a clip whose keyframes all sit at t=0 would erase the model instead of
    // posing it. One frame's worth of duration is invisible and keeps it safe.
    if (!(clip.duration > 0)) clip.duration = MIN_CLIP_DURATION;
    record.duration = clip.duration;

    record.root = mixerRoot;
    record.mixer = new this.THREE.AnimationMixer(mixerRoot);
    record.action = record.mixer.clipAction(clip);
    /**
     * Loop or play once — the clip's own declaration, not the state's.
     *
     * The default is LOOP, which is what every clip did before the flag existed and what a state that can
     * last minutes needs. A one-shot clip is a wave or a reaction: it plays through once and then the pose
     * goes back to the procedural idle (`motionFinished` notices the end), because a state can outlast its
     * clip by minutes and freezing in the final frame is exactly the failure to avoid.
     */
    record.loop = !(this.motionBytes[record.id] && this.motionBytes[record.id].loop === false);
    if (record.loop) {
      record.action.setLoop(this.THREE.LoopRepeat, Infinity);
    } else {
      record.action.setLoop(this.THREE.LoopOnce, 1);
      // NOT clamped: a clamped action holds its last frame, which is the freeze. Letting it fall out of
      // influence is what hands the pose back, and the frame loop reports the end on top of that.
      record.action.clampWhenFinished = false;
      var self = this;
      record.onFinished = function (event) {
        if (event && event.action && event.action !== record.action) return;
        record.finished = true;
      };
      try { record.mixer.addEventListener('finished', record.onFinished); } catch (error) { /* optional */ }
    }
    record.headTrack = this.clipDrivesHead(clip, this.avatar);
    /**
     * And whether the CLIP ITSELF carries a face ("动作本身带有表情"): a VRMA may animate the morphs the blink
     * writes, and the blink gate has to know that before it can leave the face alone (see `clipDrivesFace`).
     */
    record.faceTracks = this.clipDrivesFace(clip);
  };

  /**
   * Whether a ONE-SHOT clip has played to its end.
   *
   * Measured from the action's own clock as well as from the mixer's `finished` event, because the two
   * signals are the mixer's account and the action's, and the latch that hands the pose back must not depend
   * on which one arrives. Either signal is enough.
   */
  Scene.prototype.motionFinished = function (record) {
    if (!record) return false;
    /**
     * Whether THIS playback loops — decided at `startPlayback` from the state's own override, with the clip's
     * own declaration as the fallback for a record no playback has touched (a suite asking the question
     * directly). `record.loop` alone was the build-time answer, and the two can differ per state.
     */
    var loops = record.playingLoop === undefined ? record.loop !== false : record.playingLoop !== false;
    if (loops) return false;
    if (record.finished) return true;
    var action = record.action;
    if (!action || !(record.duration > 0)) return false;
    return action.time >= record.duration - 1e-4;
  };

  /** Whether a clip writes the head bone the pointer gaze drives. */
  Scene.prototype.clipDrivesHead = function (clip, avatar) {
    if (!clip || !clip.tracks || !avatar) return false;
    var head = null;
    if (avatar.kind === 'vrm' && avatar.bones) head = avatar.bones.head;
    else if (avatar.parts) head = avatar.parts.head;
    if (!head || !head.name) return false;
    // A VRM track addresses the NORMALIZED node (`Normalized_J_Bip_C_Head`), which is
    // what `avatar.bones` holds and what `createVRMAnimationClip` writes to.
    var vrmTarget = head.name + '.quaternion';
    for (var i = 0; i < clip.tracks.length; i++) {
      var name = clip.tracks[i] && clip.tracks[i].name;
      if (!name || name.indexOf('.quaternion') === -1) continue;
      if (name.indexOf(vrmTarget) === 0) return true;
    }
    return false;
  };

  /**
   * Whether a clip writes the FACE — its own expression tracks, not the one a preference assigns to it.
   *
   * Operator, 2026-10-13: 「当动作本身带有表情的时候，停用眨眼」. A VRMA animates morphs by name
   * (`..._Face.morphTargetInfluences[blink]`), and those are the same eyelids the blink timer writes: blinking
   * over such a clip is not a blink, it is the clip's expression dropping and coming back for a tenth of a
   * second. `currentFace()` cannot see this — it knows the expression the USER assigned to the clip — so the
   * clip file's own tracks are what is asked about here, and the answer is remembered per built clip.
   *
   * Any morph track counts, whatever it drives: the question is "is this clip expressing a face", and a clip
   * that shutters an eyelid or opens a mouth is doing exactly that. A bone-only clip (which is every clip in
   * the bundled pack) answers false, so nothing about the shipped pack changes.
   */
  Scene.prototype.clipDrivesFace = function (clip) {
    if (!clip || !clip.tracks) return false;
    for (var i = 0; i < clip.tracks.length; i += 1) {
      var track = clip.tracks[i];
      var name = track && track.name ? String(track.name) : '';
      if (name.indexOf('morphTargetInfluences') !== -1) return true;
    }
    return false;
  };

  /**
   * Decide, for one frame, whether an authored clip owns the pose.
   *
   * A state can list several clips, and this is where ONE of them is drawn — on the frame the state is
   * ENTERED, never per frame (see `pickMotionFor`). From then on the frame loop keeps returning that same
   * clip until the state changes, or until a one-shot clip has finished, which hands the pose back to the
   * procedural idle for the rest of the state.
   *
   * @returns {object|null} the playback record to advance, or null to let the
   *   procedural idle run. Never throws.
   */
  Scene.prototype.resolveAuthored = function (state) {
    /**
     * A PREVIEW owns the pose while it is set, ahead of every other consideration.
     *
     * The operator asked for it (2026-10-09): while the settings window is being used to choose a clip's
     * expression and mouth, the model should BE that combination, and go back to normal when the pointer
     * leaves. Two deliberate choices here: the previewed clip always LOOPS (a one-shot would end after a
     * second and read as a broken preview), and the drag states are not exempt — a preview is an instruction
     * from the person configuring the pet, not a state the machine is in.
     */
    if (this.preview && this.preview.motionId && this.preferences.motion !== false) {
      var previewId = this.preview.motionId;
      var previewBytes = this.motionBytes[previewId];
      if (previewBytes) {
        var previewRecord = this.motionClips[previewId];
        if (!previewRecord) {
          this.buildMotionClip(previewId);
          previewRecord = this.motionClips[previewId];
        }
        var previewUsable = Boolean(previewRecord) && !previewRecord.pending && !previewRecord.error
          && previewRecord.clip && previewRecord.tracks > 0;
        if (previewUsable) {
          if (this.playback && this.playback.id === previewId && this.playback.record === previewRecord) {
            return this.playback;
          }
          return this.startPlayback(previewId, previewRecord);
        }
        this.motionReason = 'preview clip "' + previewId + '" could not be built';
      } else {
        this.motionReason = 'preview clip "' + previewId + '" has not been loaded';
      }
      // Fall through to the normal path rather than freezing the pet on a preview it cannot play.
    }
    if (this.preferences.motion === false) {
      // Forget the draw as well: switching the feature back on inside the same state must re-draw rather
      // than resume a clip that was interrupted minutes ago.
      this.forgetMotionPick();
      this.stopPlayback('motion is switched off in the settings');
      return null;
    }
    /**
     * A state NO clip may drive falls back to the procedural pose, and since 2026-10-13 that no longer covers
     * `held` / `falling` / `landing`: they are in `core.MOTION_STATES` because the operator asked for a motion on
     * the drag and throw poses (「缺少拖动时模型动作的设置」). Their clips contribute the POSE, and where the pet IS —
     * the placement and the lag the frozen `setDragMotion` channel feeds it — stays the drag physics' business,
     * unchanged. What is left here is the states outside that list (`sleeping`, `greeting`), which are not things
     * DSH is doing and so have nothing for a clip to be about.
     */
    if (this.core.MOTION_STATES.indexOf(state) === -1) {
      this.forgetMotionPick();
      this.stopPlayback(this.playback
        ? '"' + state + '" is a pointer-owned or ambient state, which always uses the procedural pose'
        : null);
      return null;
    }

    if (this.pickState !== state) this.pickMotionFor(state);

    /**
     * A scheduled one-shot, and the interval that schedules it.
     *
     * A state can hold a mix of clips: a looping base (the pet's posture) and non-looping reactions (a
     * yawn, a stretch). The reactions are not drawn on entry — they are what the state's
     * `motionEvery: {min, max}` window is for: once the scene clock passes `motionNextAt`, ONE of the
     * non-looping clips plays, and the next window starts when it ends.
     *
     * THE ORDER MATTERS, and it is the operator's rule (2026-10-13): a due reaction fires FIRST, while the
     * base clip is STILL PLAYING (「单次动作可以在循环动作未完成时触发」), and only then is the finished clip
     * dealt with. A held one-shot is checked after that, so the next reaction can still interrupt a frozen
     * pose.
     */
    var scheduled = this.scheduledMotionDue(state);
    if (this.oneShot && this.oneShot.state === state) {
      var running = this.resolveOneShot(state);
      if (running) return running;
      // It finished: `resolveOneShot` already chained into a loop or held its last frame.
    } else if (scheduled) {
      var started = this.startScheduledMotion(state);
      if (started) return started;
    }

    /**
     * A pose that is being HELD: a one-shot played to its end in a state with no loop to hand over to, and its
     * last frame stays on screen (「如果没有循环动作，单次动作结束后停止在最后一帧」).
     *
     * Returned as the live playback so the frame loop keeps drawing it; the latch is what stops the decision
     * below from running again on every frame, which would restart the chain each time.
     */
    if (this.playback && this.playback.held === true) return this.playback;

    // A one-shot clip that already played in THIS state entry, with nothing to chain into: the held frame
    // above is what is on screen. Without this latch the clip would restart on the very next frame, forever.
    if (this.pickSpent) {
      this.stopPlayback(null);
      return null;
    }

    var motionId = this.pickId;
    if (!motionId) {
      this.stopPlayback(null);
      return null;
    }
    if (!this.motionBytes[motionId]) {
      this.stopPlayback('state "' + state + '" is mapped to motion "' + motionId
        + '", whose bytes have not been loaded');
      return null;
    }

    var record = this.motionClips[motionId];
    if (!record) {
      // Lazy build. A VRMA build is asynchronous, so the procedural idle covers
      // the frames until the clip is ready rather than stalling the render loop.
      this.buildMotionClip(motionId);
      record = this.motionClips[motionId];
    }

    var usable = Boolean(record) && !record.pending && !record.error && record.clip && record.tracks > 0;
    if (!usable) {
      var why = !record ? null
        : record.pending ? null
          : (record.error || ('motion "' + motionId + '" binds to no bone in this model'));
      this.stopPlayback(why);
      return null;
    }
    /**
     * The end of a one-shot, noticed HERE, before the clip can be started again for the next frame.
     *
     * What happens next is one rule in one place (`afterOneShotEnded`): chain into a loop when the state has
     * one, otherwise HOLD this clip's last frame. It is never "play this clip again" — a one-shot that loops is
     * the defect the operator named (「严禁单次动作循环播放」).
     */
    if (this.motionFinished(record)) {
      this.pickSpent = true;
      return this.afterOneShotEnded(state);
    }
    if (this.playback && this.playback.id === motionId && this.playback.record === record) {
      return this.playback;
    }
    return this.startPlayback(motionId, record, state);
  };

  /** The state's LOOPING clips, in the state's own order. The mirror of `scheduledCandidates`. */
  Scene.prototype.loopCandidates = function (state) {
    var ids = this.core.motionIdsFor(this.motionMap, state);
    var out = [];
    for (var i = 0; i < ids.length; i += 1) {
      if (this.motionLoops(ids[i], state)) out.push(ids[i]);
    }
    return out;
  };

  /**
   * What follows a one-shot that has just played to its end — the operator's rule, in one place.
   *
   * 「当状态的动作列表里有循环动作时，单次动作结束后，必须衔接循环动作，严禁单次动作循环播放；如果没有循环动作，
   * 单次动作结束后停止在最后一帧」 (2026-10-13). So:
   *
   *   * a looping clip in this state → draw one AT RANDOM and start it, because the loop is the posture the pet
   *     wears between reactions and a fixed order would make every reaction end the same way (「循环动作和单次动作
   *     的触发都是随机的（即没有固定顺序）」);
   *   * no looping clip → hold the frame that is already on screen. NOT the procedural idle: the operator asked
   *     for the last frame, and the idle would quietly walk away from the pose the clip just struck.
   *
   * @returns {object|null} the playback the frame loop should keep advancing.
   */
  Scene.prototype.afterOneShotEnded = function (state) {
    var loops = this.loopCandidates(state);
    if (loops.length) {
      var id = loops[Math.min(loops.length - 1, Math.floor(this.random() * loops.length))];
      if (!this.motionBytes[id]) {
        // The chained clip's bytes are still on their way: hold what is on screen rather than snapping to the
        // procedural idle and back again a moment later.
        return this.holdPlayback(this.playback);
      }
      var record = this.motionClips[id];
      if (!record) {
        this.buildMotionClip(id);
        record = this.motionClips[id];
      }
      var usable = Boolean(record) && !record.pending && !record.error && record.clip && record.tracks > 0;
      if (usable) return this.startPlayback(id, record, state);
    }
    return this.holdPlayback(this.playback);
  };

  /**
   * Keep a finished one-shot's LAST FRAME on screen.
   *
   * `clampWhenFinished` is what makes three hold the final pose instead of releasing the bones back to the rest
   * pose, and `held` is what tells the frame loop that this playback is finished AND wanted — without it the
   * decision above would run again on every frame.
   */
  Scene.prototype.holdPlayback = function (playback) {
    if (!playback || !playback.record) return null;
    playback.held = true;
    playback.record.held = true;
    try { playback.record.action.clampWhenFinished = true; } catch (error) { /* optional */ }
    this.motionReason = null;
    return playback;
  };

  /**
   * Draw one clip for a state that has just been entered.
   *
   * The draw prefers a LOOPING clip when the state holds one, because that is the posture the pet wears
   * while it waits; the non-looping clips are what the interval fires. When every mapped clip is a
   * one-shot the draw is uniform over all of them, exactly as it was before intervals existed.
   *
   * The interval is armed here as well, so a state that has just been entered starts its window from the
   * moment it was entered rather than from whenever the previous state's window happened to end.
   *
   * @returns {string|null} the id that was drawn.
   */
  Scene.prototype.pickMotionFor = function (state) {
    var ids = this.core.motionIdsFor(this.motionMap, state);
    var loops = [];
    var oneShots = [];
    for (var i = 0; i < ids.length; i += 1) {
      if (this.motionLoops(ids[i], state)) loops.push(ids[i]);
      else oneShots.push(ids[i]);
    }
    var pool = loops.length ? loops : ids;
    this.pickState = state;
    this.pickSpent = false;
    this.pickId = pool.length
      ? pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))]
      : null;
    this.armScheduledMotion(state, oneShots.length > 0);
    return this.pickId;
  };

  /**
   * Set (or clear) the transient preview the settings window drives.
   *
   * Clearing it also forgets the draw, so the pet goes back to its own state's clip on the next frame rather
   * than finishing whatever the preview left playing — that is the "离开对应设置的位置后恢复正常状态" half of the
   * operator's request.
   */
  Scene.prototype.setPreview = function (preview) {
    var next = this.core.cleanPreview ? this.core.cleanPreview(preview) : (preview || null);
    var before = this.preview ? JSON.stringify(this.preview) : null;
    var after = next ? JSON.stringify(next) : null;
    if (before === after) return this.preview;
    this.preview = next;
    /**
     * And the pointer gaze is suspended for as long as the preview lasts.
     *
     * Operator's request, 2026-10-09: "在'每状态 × 每动作'设置时，暂时关闭视角的鼠标跟随". A preview is exactly
     * "the settings window is being used to choose a clip's expression and mouth", so the head holds still and
     * the clip, the expression and the mouth are what is being looked at. `Motion.applyGaze` reads this.
     */
    if (this.motion) this.motion.holdGaze = Boolean(next);
    // The pose belongs to the preview now, so whatever was drawn for the state is dropped: if the preview
    // names no clip, the state's own draw happens again on the next frame.
    this.forgetMotionPick();
    this.stopPlayback(null);
    return this.preview;
  };

  /** Forget the current draw, so the next frame in any state draws again. */
  Scene.prototype.forgetMotionPick = function () {
    this.pickState = null;
    this.pickId = null;
    this.pickSpent = false;
    this.oneShot = null;
    // Every deadline belongs to a state whose mapping may have just changed, so they all go.
    this.motionWindows = {};
  };

  /**
   * Whether the catalog, the per-clip override and the STATE's entry say this clip repeats in this state.
   *
   * Three layers, most specific first (`core.motionLoopForState`), because the operator asked for the play mode
   * to be settable PER STATE AND CLIP on 2026-10-09: "每个状态下，可以针对每个动作设置该状态下该动作为循环还是单次".
   * A clip that has not been loaded yet answers from the preferences alone, which is why the loader's own flag
   * is only the fallback.
   */
  Scene.prototype.motionLoops = function (motionId, state) {
    var bytes = this.motionBytes ? this.motionBytes[motionId] : null;
    var declared = bytes ? bytes.loop !== false : true;
    if (this.core.motionLoopForState) {
      return this.core.motionLoopForState(this.preferences, state || this.pickState, motionId, declared);
    }
    return this.core.motionLoopFor
      ? this.core.motionLoopFor(this.preferences, motionId, declared)
      : declared;
  };

  /**
   * Arm (or disarm) the one-shot window for one state, and answer when it is next due.
   *
   * The deadline lives in `motionWindows[state]` rather than in a single field, because the interval belongs to
   * the STATE and a desk pet does not stay in one state: it flips between `resting` and `working` every time
   * the session it follows goes quiet or busy. Two measured failures came out of getting this wrong on
   * 2026-10-09:
   *
   *  * a single field meant that entering the OTHER state disarmed the window, so the deadline was recomputed
   *    from scratch on every return — a 20–80 s window reported 63 s and, thirty seconds later, 219 s, and the
   *    pet never fired at all;
   *  * and re-arming on every entry was itself the cause, because "one one-shot somewhere in this window"
   *    only means anything if the clock survives the flip.
   *
   * The window that produced a deadline is stored with it, so changing the interval in the settings window
   * re-arms immediately instead of waiting for a deadline computed from the old numbers.
   *
   * @param {string} state
   * @param {boolean} hasOneShot whether any mapped clip for that state is a one-shot. A window with nothing to
   *   fire is not armed: it would be a timer that can never ring.
   */
  Scene.prototype.armScheduledMotion = function (state, hasOneShot) {
    var window_ = this.core.motionEveryFor ? this.core.motionEveryFor(this.preferences, state) : null;
    if (!window_ || !hasOneShot) {
      delete this.motionWindows[state];
      return null;
    }
    var current = this.motionWindows[state];
    if (current && Number.isFinite(current.nextAt)
      && current.window.min === window_.min && current.window.max === window_.max) {
      return current.nextAt;
    }
    var nextAt = this.motion.elapsed
      + this.randomBetween(window_.min, window_.max, window_.min, window_.max);
    this.motionWindows[state] = { nextAt: nextAt, window: { min: window_.min, max: window_.max } };
    return nextAt;
  };

  /**
   * Whether a state's window has come due, and there is a one-shot to fire.
   *
   * The arming happens HERE as well as at state entry, and that is the difference between a feature that works
   * and one that silently never fires. Two ways the entry-time arming finds nothing to arm for, both normal:
   *
   *  * **The clip's bytes have not arrived yet.** `motionLoops` has to assume a clip it has never seen loops,
   *    so a state entered while its motion is still being fetched arms nothing — and nothing ever re-armed it,
   *    because the state does not change again. Measured on the real pet on 2026-10-09: `scheduled.window`
   *    reported the configured 20–80 s while `scheduled.nextAt` stayed null and the pet never fired.
   *  * **The interval was configured while the pet was already in that state** — which is exactly what happens
   *    when someone drags the interval field in the settings window, and a desk pet's state does not change for
   *    hours.
   *
   * So an unarmed window is (re)armed on the first frame where the state has both a window and a loaded
   * one-shot candidate. It returns false for that frame — the new deadline is in the future by construction.
   */
  Scene.prototype.scheduledMotionDue = function (state) {
    var entry = this.motionWindows[state];
    if (!entry || !Number.isFinite(entry.nextAt)) {
      this.armScheduledMotion(state, this.scheduledCandidates(state).length > 0);
      return false;
    }
    if (!(this.motion.elapsed >= entry.nextAt)) return false;
    return this.scheduledCandidates(state).length > 0;
  };

  /** When this state's next one-shot is due, or null when nothing is armed for it. */
  Scene.prototype.scheduledMotionAt = function (state) {
    var entry = this.motionWindows[state];
    return entry && Number.isFinite(entry.nextAt) ? entry.nextAt : null;
  };

  /** Drop one state's deadline, so the next arm draws a fresh window (used when a reaction has finished). */
  Scene.prototype.clearScheduledMotion = function (state) {
    delete this.motionWindows[state];
  };

  /** The non-looping clips a state may fire on its interval, in the state's own order. */
  Scene.prototype.scheduledCandidates = function (state) {
    var ids = this.core.motionIdsFor(this.motionMap, state);
    var out = [];
    for (var i = 0; i < ids.length; i += 1) {
      if (!this.motionLoops(ids[i], state)) out.push(ids[i]);
    }
    return out;
  };

  /**
   * Fire one scheduled one-shot: draw it from the state's non-looping clips and start it.
   *
   * @returns {object|null} the playback record, or null when nothing could start (the clip's bytes are not
   *   loaded yet, or it failed to build) — in which case the state's base clip plays instead, and the
   *   window is pushed a second out rather than ringing every frame.
   */
  Scene.prototype.startScheduledMotion = function (state) {
    var candidates = this.scheduledCandidates(state);
    if (!candidates.length) return null;
    var id = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    if (!this.motionBytes[id]) {
      // The window restarts rather than ringing every frame: the clip simply has not been fetched yet, and the
      // fetch is on its way.
      this.clearScheduledMotion(state);
      return null;
    }
    var record = this.motionClips[id];
    if (!record) {
      this.buildMotionClip(id);
      record = this.motionClips[id];
    }
    var usable = Boolean(record) && !record.pending && !record.error && record.clip && record.tracks > 0;
    if (!usable) {
      this.clearScheduledMotion(state);
      return null;
    }
    this.oneShot = { state: state, id: id };
    return this.startPlayback(id, record);
  };

  /**
   * Keep a scheduled one-shot running, and hand the pose back when it ends.
   *
   * @returns {object|null} the playback record to advance, or null once the clip has finished (the caller
   *   then plays the state's base clip on the same frame).
   */
  Scene.prototype.resolveOneShot = function (state) {
    var oneShot = this.oneShot;
    if (!oneShot) return null;
    var record = this.motionClips[oneShot.id];
    var usable = Boolean(record) && !record.pending && !record.error && record.clip && record.tracks > 0;
    if (!usable) {
      this.oneShot = null;
      this.clearScheduledMotion(state);
      return null;
    }
    if (this.motionFinished(record)) {
      this.oneShot = null;
      /**
       * The next window starts NOW, so the interval measures the gap between reactions rather than between
       * state entries — which is what "once every 20–80 seconds" means to someone watching.
       *
       * The stored deadline is the one that has just been CONSUMED, so it is dropped first: keeping it would
       * leave the new window already due, and the pet would chain one reaction into the next.
       */
      this.clearScheduledMotion(state);
      this.armScheduledMotion(state, true);
      /**
       * And hand the pose over by the ONE rule: the state's looping clip if it has one, otherwise this
       * reaction's last frame (「单次动作结束后，必须衔接循环动作…如果没有循环动作…停止在最后一帧」).
       */
      return this.afterOneShotEnded(state);
    }
    if (this.playback && this.playback.id === oneShot.id && this.playback.record === record) {
      return this.playback;
    }
    return this.startPlayback(oneShot.id, record, state);
  };

  /**
   * Begin driving the model with one built clip.
   *
   * THE LOOP MODE IS DECIDED HERE, per PLAYBACK, and not when the clip was built.
   *
   * A clip's play mode can differ per state (「每个状态下，可以针对每个动作设置该状态下该动作为循环还是单次」), and
   * the same clip can be a posture in one state and a reaction in another — so a mode baked in at build time
   * was wrong for whichever state came second, and the two halves could disagree: the scheduler classified a
   * clip as a one-shot while the action itself was looping for ever, so it never finished and the reaction
   * window never re-armed. Applying it here also makes 「严禁单次动作循环播放」 structural: a clip classified as a
   * one-shot IS `LoopOnce`, whatever the file says.
   *
   * `clampWhenFinished` follows the same decision one step further: a one-shot in a state with NO looping clip
   * is CLAMPED, because its last frame is what stays on screen (see `holdPlayback`).
   */
  Scene.prototype.startPlayback = function (motionId, record, state) {
    // Stop first: switching motions has to undo the previous clip's pose, or the
    // two clips blend into each other frame by frame.
    this.stopPlayback(null);
    var inState = state || this.pickState || null;
    var loops = this.motionLoops(motionId, inState);
    try {
      record.action.reset();
      // A one-shot reborn as a fresh playback: the finished flag belongs to the PREVIOUS run, and leaving
      // it set would end the clip on the first frame it was started for.
      record.finished = false;
      record.held = false;
      if (loops) {
        record.action.setLoop(this.THREE.LoopRepeat, Infinity);
        record.action.clampWhenFinished = false;
      } else {
        record.action.setLoop(this.THREE.LoopOnce, 1);
        record.action.clampWhenFinished = this.loopCandidates(inState).length === 0;
      }
      record.playingLoop = loops;
      record.action.play();
    } catch (error) {
      this.motionReason = 'motion "' + motionId + '" could not start: ' + errorText(error);
      return null;
    }
    var avatar = this.avatar;
    this.playback = {
      id: motionId,
      record: record,
      format: record.format,
      kind: avatar ? avatar.kind : 'unknown',
      mixer: record.mixer,
      action: record.action,
      /** False once this playback's clip has played to its end — see `holdPlayback`. */
      held: false,
    };
    this.motionReason = null;
    return this.playback;
  };

  /**
   * Stop the authored clip, if any, and put the model back into its rest pose.
   *
   * @param {string|null} reason recorded for describeMotions().
   */
  Scene.prototype.stopPlayback = function (reason) {
    if (reason) this.motionReason = reason;
    var playback = this.playback;
    if (!playback) return;
    this.playback = null;
    try {
      if (playback.action) playback.action.stop();
      else if (playback.mixer) playback.mixer.stopAllAction();
    } catch (error) {
      // A mixer that refuses to stop must not stop the pet.
    }
    // The clip wrote the pose absolutely and nothing else restores it: without
    // this the pet would stay frozen in the clip's last frame through every drag
    // and every unmapped state.
    resetAvatarPose(this.avatar);
  };

  /**
   * Advance the playing clip by one frame.
   *
   * One route now, and the MMD route it used to be paired with is gone (2026-10-12). A
   * VRMA animates the NORMALIZED humanoid rig, a separate node tree from the bones the
   * mesh is skinned to: nothing visibly moves until `humanoid.update()` copies the pose
   * across, so that call is not optional, and the expression manager is what turns the
   * clip's `.weight` tracks into actual morph-target weights.
   */
  Scene.prototype.advancePlayback = function (playback, dt) {
    var step = Math.min(dt, 0.1);
    try {
      playback.mixer.update(step);
      var vrm = this.avatar ? this.avatar.vrm : null;
      if (!vrm) return;
      if (vrm.humanoid) vrm.humanoid.update();
      if (vrm.expressionManager) vrm.expressionManager.update();
    } catch (error) {
      // One bad motion file must not be able to kill the pet: report it and hand
      // the pose back to the procedural idle on the next frame.
      this.stopPlayback('motion "' + playback.id + '" failed while playing: ' + errorText(error));
    }
  };

  /** Drop one built clip, releasing its mixer's bindings. */
  Scene.prototype.dropMotionClip = function (motionId) {
    var record = this.motionClips ? this.motionClips[motionId] : null;
    if (!record) return;
    if (this.playback && this.playback.id === motionId) this.stopPlayback(null);
    try {
      if (record.onFinished && record.mixer) record.mixer.removeEventListener('finished', record.onFinished);
      if (record.action) record.action.stop();
      if (record.mixer) record.mixer.stopAllAction();
      // `uncacheRoot` is the part that matters: three keeps its binding tables —
      // and therefore a reference to every bound bone — until it is called, so
      // without it every model switch would leak one mixer per motion.
      if (record.mixer && record.root) record.mixer.uncacheRoot(record.root);
    } catch (error) {
      // A mixer that is already torn down is fine.
    }
    delete this.motionClips[motionId];
  };

  /**
   * Drop every clip built for the current avatar. The bytes stay cached.
   *
   * The draw is forgotten as well: it names a clip that is about to cease to exist, and a stale id would
   * make the next frame report "whose bytes have not been loaded" for a clip that is merely unbuilt.
   */
  Scene.prototype.dropAllMotionClips = function () {
    var ids = Object.keys(this.motionClips || {});
    for (var i = 0; i < ids.length; i++) this.dropMotionClip(ids[i]);
    this.forgetMotionPick();
  };

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  /**
   * Centre the model in its canvas. Placement is the CLIENT's job.
   *
   * This is the fix for "the pet only shifts a little when dragged", and it took
   * two wrong attempts to get here, so the reasoning is worth keeping:
   *
   * The canvas is only as large as the pet element (220x300 by default), and the
   * client moves that element around the window with CSS. The scene was ALSO
   * offsetting the model inside that little canvas by the same placement fraction,
   * so the two motions fought: the element translated the full distance while the
   * model translated again within it, and the visible result crawled — the model
   * could reach only about 37% of its own canvas, because the centre was mapped
   * over `(1 - widthFraction)` of it.
   *
   * Mapping the model's centre across the canvas "properly" was the second attempt
   * and it only widened that crawl to 100% of a 220 px box — still tiny next to the
   * window. The right answer is the one the user asked for: the frame moves, and
   * the model stays centred in it. One motion, the full distance, one to one.
   *
   * Nothing is lost by this. The camera frames the model identically wherever the
   * element happens to be, gaze is computed from pointer coordinates rather than
   * from the model's offset, and the idle bob is applied on top of the centre.
   *
   * @param {number} [_x] ignored; kept so the client's call signature is stable.
   * @param {number} [_y] ignored; see above.
   * @param {number} [lift] extra height while the pointer holds the pet, as a
   *   fraction of the frame.
   */
  Scene.prototype.setPlacement = function (_x, _y, lift) {
    if (!this.stage) return;
    var frame = this.viewportWorldSize();
    this.baseY = (lift || 0) * frame.height;
    this.stage.position.set(0, this.baseY, 0);
  };

  /**
   * How fast the pet is being dragged right now, in SCREEN pixels per second (+x right, +y down).
   *
   * This exists because of how the pet is carried around: the app overlay moves its slot, and the
   * floating window moves the WINDOW itself. In both cases the model's own world position never
   * changes — so the spring bones have nothing to react to and the hair sits rigid while the pet is
   * dragged (the reported "the hair does not swing"). Feeding the drag velocity in restores the motion
   * the rig needs to see: the body lags a few pixels opposite to the drag (see `applyDragLag`), which
   * puts a real translation into the skeleton, and the springs follow the bones they hang from.
   */
  Scene.prototype.setDragMotion = function (vx, vy) {
    this.dragMotion.vx = Number.isFinite(vx) ? vx : 0;
    this.dragMotion.vy = Number.isFinite(vy) ? vy : 0;
  };

  /**
   * Apply the lagging body offset for this frame. Called BEFORE the physics step, so the springs see
   * this frame's motion rather than the previous one.
   *
   * World units, converted from the velocity in canvas pixels: the target offset is the distance the pet
   * would travel in `DRAG_LAG_SECONDS`, capped, and the actual offset chases it with a time constant —
   * which is what makes the hair overshoot and settle when a drag stops instead of snapping back.
   */
  Scene.prototype.applyDragLag = function (dt) {
    if (!this.stage) return;
    var motion = this.dragMotion;
    var lag = this.dragOffset;
    var perPixel = (this.modelHeight || 1) / Math.max(1, this.height || 1);
    var cap = DRAG_LAG_MAX_PX * perPixel;
    var vx = Number.isFinite(motion.vx) ? motion.vx : 0;
    var vy = Number.isFinite(motion.vy) ? motion.vy : 0;
    // Opposite the drag, so the body falls behind the frame it is being carried in.
    var targetX = Math.min(cap, Math.max(-cap, -vx * DRAG_LAG_SECONDS * perPixel));
    // Screen y grows downward and the stage's y grows upward, hence the sign.
    var targetY = Math.min(cap, Math.max(-cap, vy * DRAG_LAG_SECONDS * perPixel));
    // Exponential smoothing: frame-rate independent, and dt of 0 lands exactly on the target.
    var alpha = Number.isFinite(dt) && dt > 0 ? 1 - Math.exp(-dt / DRAG_LAG_TAU) : 1;
    lag.x += (targetX - lag.x) * alpha;
    lag.y += (targetY - lag.y) * alpha;
    // An exponential approach never actually arrives, and a stage that is a floating-point hair away from
    // zero is not the same thing as a stage at rest: `setPlacement` promises the exact position, and a
    // suite asserts it. Snap to zero when nothing is being dragged and the residue is far below a pixel.
    if (targetX === 0 && Math.abs(lag.x) < 1e-6) lag.x = 0;
    if (targetY === 0 && Math.abs(lag.y) < 1e-6) lag.y = 0;
    this.stage.position.x = lag.x;
    this.stage.position.y = (this.baseY || 0) + lag.y;

    // The vertical half of the same idea: see DRAG_PITCH_PER_PIXEL. A chain hanging down the pet's back
    // cannot be excited by a translation along its own axis, so the vertical velocity becomes a lean of the
    // whole rig — which the spring bones DO answer, with the strands trailing and swinging in the sagittal
    // plane. Positive screen y is downward, and a positive rotation about X tips the model toward the
    // camera, so moving down leans forwards and moving up leans back: the body goes where it is pushed.
    var pitchCap = DRAG_PITCH_MAX;
    var targetPitch = Math.min(pitchCap, Math.max(-pitchCap, vy * DRAG_PITCH_PER_PIXEL));
    var pitchAlpha = Number.isFinite(dt) && dt > 0 ? 1 - Math.exp(-dt / DRAG_PITCH_TAU) : 1;
    this.dragPitch += (targetPitch - this.dragPitch) * pitchAlpha;
    if (targetPitch === 0 && Math.abs(this.dragPitch) < 1e-6) this.dragPitch = 0;
    this.stage.rotation.x = this.dragPitch;
  };

  /** World-space size of the visible frame at the pet's depth, for the client. */
  Scene.prototype.viewportWorldSize = function () {
    var height = 2 * Math.tan((FOV * Math.PI / 180) / 2) * (this.cameraDistance || 2);
    return { width: height * (this.camera.aspect || 1), height: height };
  };

  /**
   * Turn a normalized aim into a gaze target in radians.
   *
   * The aim comes from `core.pointerAim`, which measures the pointer against the PET's
   * centre rather than the canvas, so this is reached wherever the cursor is on screen.
   * The old version of this function took canvas-local pixels and returned `null` beyond
   * 1.6 canvas half-widths — which is exactly why the head stopped following as soon as
   * the cursor left the pet's box.
   *
   * Saturation is the caller's job (`pointerAim` clamps to ±1) and repetition here is
   * harmless; the limits live beside the rest of the look tuning.
   */
  Scene.prototype.gazeFromAim = function (aim) {
    if (!aim || !Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return null;
    var x = Math.max(-1, Math.min(1, aim.x));
    var y = Math.max(-1, Math.min(1, aim.y));
    // Screen y grows downward, pitch grows upward.
    return { yaw: x * GAZE_YAW_LIMIT, pitch: -y * GAZE_PITCH_LIMIT };
  };

  /** Advance one frame. `dt` is in seconds. */
  Scene.prototype.tick = function (dt) {
    if (this.disposed || !this.avatar) return;
    var state = this.state || 'resting';
    this.motion.setState(state, this.preferences.sway);

    // WHERE THE BODY IS comes first this frame, before the physics step.
    //
    // `applyDragLag` is what puts the pet's own translation into the rig
    // while something else (the app slot, the floating window) is carrying it around. Without that, the
    // spring bones see a model that never moves and the hair stays rigid while the pet is dragged —
    // which is the report this exists for. Both write the stage BEFORE `motion.tick` runs the SpringBone
    // step, or the springs react a frame late.
    //
    // COMPUTED, never accumulated, and no vertical bob: an earlier revision did `stage.position.y +=
    // pose.bob`, which made the resting height a running integral of an oscillating term — a slow DC
    // offset that walked the pet upward over a long session, invisible in any single frame.
    //
    // And no yaw from the idle either (`YAW_GAIN` is gone with it): the stage's yaw is the user's own
    // preference, so the pet stays facing where it was put. The procedural motion driver below still owns the
    // breathing and the chains' follow-through — `motion.setState` is what hands it the sway amount.
    this.stage.rotation.y = this.preferences.yaw || 0;
    this.applyDragLag(dt);

    // An authored clip takes the pose for this state when one is mapped, it could
    // bind to this avatar, and this is not a drag state. The clip is advanced
    // BEFORE the idle runs, so the idle's gaze step sits on top of the pose the
    // mixer just wrote and the SpringBone fixed step sees it.
    var authored = this.resolveAuthored(state);
    this.motion.setAuthored(Boolean(authored), Boolean(authored && authored.record.headTrack));
    if (authored && Number.isFinite(dt) && dt > 0) this.advancePlayback(authored, dt);

    // The cursor's draught is applied to the spring chains BEFORE the tick, because the tick is what steps the
    // solver — and the solver reads `gravityDir`/`gravityPower` when it runs.
    this.advanceWind(dt);
    this.motion.tick(dt);

    // Expressions are advanced AND applied every frame. Advancing here rather than on a timer means a
    // suite can step them exactly; applying here means a weight set by the settings window or by the
    // blink timer actually reaches the face, because three-vrm writes the morph targets inside
    // `expressionManager.update()` and an earlier revision only called that while a clip was playing.
    this.advanceExpressions(dt);
    this.applyExpressions(this.preferences);

    this.renderer.render(this.scene, this.camera);
    this.frame += 1;
  };

  Scene.prototype.setState = function (state) {
    this.state = state;
  };

  Scene.prototype.applyPreferences = function (preferences) {
    var raw = preferences && typeof preferences === 'object' ? preferences : {};
    this.preferences = this.core.cleanPreferences(preferences);
    // A preferences push only carries `motions` when the caller meant to change
    // it. cleanPreferences always produces a (possibly empty) key, so adopting it
    // unconditionally would silently wipe a map set through setMotionMap.
    if (Object.prototype.hasOwnProperty.call(raw, 'motions')) this.setMotionMap(raw.motions);
    this.motion.setPhysics(this.preferences.physics);
    this.motion.setLookAtPointer(this.preferences.lookAtPointer);
    this.motion.setGazeIdle(this.preferences.gazeIdleSeconds);
    if (this.avatar && this.framing) {
      // The model keeps the scale the framing gave it; size and per-model scale are
      // slot concerns now (see frameAvatar). What this call is FOR is the camera: the
      // view orbit, the aspect after a resize, and every pref that changes the fit land
      // in refitCamera.
      this.avatar.root.scale.setScalar(this.framing.scale);
      this.modelHeight = this.framing.scaled.y;
      this.refitCamera();
    }
    // The two features the settings window drives. Both are no-ops on a model with neither spring
    // bones nor expressions, so a plain glTF or the procedural placeholder costs nothing here.
    this.applySprings(this.preferences);
    this.applyExpressions(this.preferences);
    // The wind baseline is captured AFTER the overrides, so "blown" is relative to the gravity actually in
    // force and restoring it cannot quietly undo a spring override the user made.
    this.captureSpringBase();
  };

  // ===========================================================================
  // The cursor's draught (wind on the spring chains)
  // ===========================================================================

  /**
   * Remember each joint's own gravity, so the wind can be taken back off again.
   *
   * `gravityDir`/`gravityPower` are the model's (or the override's) values, and the wind is applied by STEERING
   * them — which is the only force the spring solver will take from outside. That makes the snapshot
   * load-bearing: without it, a sweep would leave the hair permanently blown sideways, because nothing would
   * know what the gravity used to be.
   */
  Scene.prototype.captureSpringBase = function () {
    var base = [];
    for (var i = 0; i < (this.springChainInfo || []).length; i += 1) {
      var chain = this.springChainInfo[i];
      for (var j = 0; j < chain.joints.length; j += 1) {
        var settings = chain.joints[j].joint ? chain.joints[j].joint.settings : null;
        if (!settings) continue;
        var dir = settings.gravityDir;
        base.push({
          settings: settings,
          // The BONE, not just the settings: the draught is LOCAL, and where a joint is on screen is what decides
          // how much of it that joint gets.
          bone: chain.joints[j].joint ? chain.joints[j].joint.bone : null,
          power: Number(settings.gravityPower),
          dir: dir && Number.isFinite(dir.x)
            ? { x: dir.x, y: dir.y, z: dir.z }
            : { x: 0, y: -1, z: 0 },
        });
        // Give every joint a mutable direction to steer: a model that declares none would otherwise be blown
        // by a wind that has nowhere to write.
        if (!dir || !Number.isFinite(dir.x)) {
          settings.gravityDir = new this.THREE.Vector3(0, -1, 0);
        }
      }
    }
    this.springBase = base;
    return base.length;
  };

  /**
   * Feed the spring chains a draught, in the model's own frame.
   *
   * `pointer` is a raw sample — how far the cursor moved (`dx`,`dy` in CSS pixels), over how long (`dt`), the
   * view orbit at the time, and where the cursor IS (`x`,`y` in canvas pixels) — and `core.windFromPointer`
   * turns the movement into a unit direction and a strength. The scene remembers it; `advanceWind` pushes it
   * into the chains every frame, weighted by how close each joint is to that position, and lets it die away.
   */
  Scene.prototype.pushWind = function (pointer) {
    var core = this.core;
    if (!core || !core.windFromPointer) return null;
    /**
     * The draught's numbers are SETTINGS now.
     *
     * Operator, 2026-10-10: "把鼠标互动的参数加入设置面板". They come from the preferences and only fall back to
     * the shipped `core.WIND_LIMITS` when a profile predates them — so the window can tune the feel without a
     * rebuild, and a stale profile still behaves exactly as it did.
     */
    var prefs = this.preferences || {};
    var sample = core.windFromPointer({
      dx: pointer && pointer.dx,
      dy: pointer && pointer.dy,
      dt: pointer && pointer.dt,
      viewYaw: pointer && pointer.viewYaw,
      speedForMax: Number.isFinite(Number(prefs.windSpeedForMax))
        ? Number(prefs.windSpeedForMax)
        : (core.WIND_LIMITS && core.WIND_LIMITS.speedForMax),
    });
    if (!(sample.power > 0)) return this.wind;
    var scale = Number(prefs.windPower);
    if (!Number.isFinite(scale)) scale = Number(core.WIND_LIMITS && core.WIND_LIMITS.power);
    if (!Number.isFinite(scale)) scale = 1;
    var at = pointer || {};
    this.wind = {
      x: sample.x,
      y: sample.y,
      z: sample.z,
      // The strongest sweep since the last frame wins rather than the sum: two samples in one frame are the
      // same gesture measured twice, and adding them would make a fast flick blow twice as hard as it did.
      power: Math.max(this.wind && this.wind.power > 0 ? this.wind.power : 0, sample.power * scale),
      speed: sample.speed,
      /**
       * Where the cursor is, in CANVAS pixels — the centre of the draught.
       *
       * This is what makes the wind local rather than global (operator, 2026-10-10: "想要局部风而不是全局风").
       * The scene projects each joint to the same pixel space and lets the force fall off with distance, so a
       * sweep past the head lifts the hair and never touches the tail.
       */
      atX: Number.isFinite(Number(at.x)) ? Number(at.x) : null,
      atY: Number.isFinite(Number(at.y)) ? Number(at.y) : null,
    };
    return this.wind;
  };

  /**
   * The on-screen pixel positions of this avatar's spring joints.
   *
   * Used by `advanceWind` to decide which joints a sweep actually reaches, and published for the settings
   * readout and for tests, because "the wind did nothing to that chain" and "the cursor was nowhere near it"
   * look identical from outside.
   */
  Scene.prototype.springJointScreenPositions = function () {
    var out = [];
    var base = this.springBase || [];
    var avatar = this.avatar;
    var root = avatar && avatar.root;
    var camera = this.camera;
    if (!root || !camera || !this.THREE) return out;
    var project = this.projectToCanvas;
    for (var i = 0; i < base.length; i += 1) {
      var bone = base[i].bone;
      if (!bone) { out.push(null); continue; }
      try {
        bone.getWorldPosition(this._windVec || (this._windVec = new this.THREE.Vector3()));
      } catch (error) {
        out.push(null);
        continue;
      }
      out.push(project ? project.call(this, this._windVec) : null);
    }
    return out;
  };

  /**
   * A world point as canvas pixels, or null when it is behind the camera.
   *
   * One conversion, used for the draught's centre and its reach: the cursor arrives in canvas pixels from both
   * surfaces, so the joints have to be measured in the same space or "near the cursor" would mean something
   * different in each.
   */
  Scene.prototype.projectToCanvas = function (world) {
    var THREE = this.THREE;
    var camera = this.camera;
    if (!THREE || !camera || !world) return null;
    var vec = this._projVec || (this._projVec = new THREE.Vector3());
    vec.copy(world).project(camera);
    if (!Number.isFinite(vec.x) || !Number.isFinite(vec.y)) return null;
    // `project` gives NDC in [-1,1]; the canvas is pixels with y down.
    return {
      x: (vec.x + 1) / 2 * this.width,
      y: (1 - vec.y) / 2 * this.height,
      z: vec.z,
    };
  };

  /**
   * Apply the draught to the chains, decay it, and keep it LOCAL.
   *
   * Called from the frame BEFORE the VRM update, because the solver reads `gravityDir`/`gravityPower` when it
   * steps. The fall-off is exponential with `WIND_LIMITS.decaySeconds` as its time constant, so the hair is
   * pushed while the cursor travels and then keeps swinging on its own — the solver's energy, not an animation.
   *
   * Each joint is weighted by `core.windFalloff` against its own distance from the cursor, measured in canvas
   * pixels and against a reach that is a FRACTION OF THE MODEL'S OWN on-screen height, so the patch is the same
   * size relative to the pet however far the view is zoomed. A joint beyond the reach is handed its own gravity
   * back exactly — not "blown a little".
   */
  Scene.prototype.advanceWind = function (dt) {
    var base = this.springBase || [];
    if (!base.length) return 0;
    var core = this.core || {};
    var limits = core.WIND_LIMITS || {};
    var wind = this.wind;
    var steered = 0;
    if (wind && wind.power > 0 && Number.isFinite(dt) && dt > 0) {
      var decay = Number((this.preferences || {}).windDecay);
      if (!Number.isFinite(decay) || decay <= 0) decay = Number(limits.decaySeconds);
      if (!Number.isFinite(decay) || decay <= 0) decay = 0.28;
      var next = wind.power * Math.exp(-dt / decay);
      wind.power = next < 0.01 ? 0 : next;
    }
    var active = Boolean(this.wind && this.wind.power > 0);
    /**
     * The reach, in canvas pixels: a fraction of the model as DRAWN.
     *
     * Measured by projecting the model's own top and bottom rather than by reading a constant, so zooming the
     * pet (or a model of a different height) keeps the draught the same size relative to what the user sees.
     */
    var radius = 0;
    if (active && wind.atX !== null && wind.atY !== null) {
      var project = this.projectToCanvas;
      var avatar = this.avatar;
      var root = avatar && avatar.root;
      if (project && root && this.THREE) {
        var half = Math.max(0.01, Number(this.modelHeight) > 0 ? Number(this.modelHeight) / 2 : 0.5);
        var top = project.call(this, root.getWorldPosition(this._topVec || (this._topVec = new this.THREE.Vector3())).clone().add(new this.THREE.Vector3(0, half, 0)));
        var bottom = project.call(this, root.getWorldPosition(this._botVec || (this._botVec = new this.THREE.Vector3())).clone().add(new this.THREE.Vector3(0, -half, 0)));
        if (top && bottom) radius = Math.abs(bottom.y - top.y);
      }
      // 0 is a VALUE here: it turns the draught global again, which is what the settings control offers.
      var fraction = Number((this.preferences || {}).windRadius);
      if (!Number.isFinite(fraction)) fraction = Number(limits.radiusFraction);
      if (!Number.isFinite(fraction)) fraction = 0.45;
      radius *= fraction;
    }
    // Published for the readout and for tests: "was the wind local?" cannot be checked without knowing how far
    // the draught reached, and the reach depends on how big the model happens to be on screen.
    this.windRadius = radius;
    var falloff = core.windFalloff;
    var positions = radius > 0 && falloff ? this.springJointScreenPositions() : null;
    for (var i = 0; i < base.length; i += 1) {
      var entry = base[i];
      var settings = entry.settings;
      if (!settings) continue;
      /**
       * How much of the draught reaches THIS joint.
       *
       * No position, no falloff function, or a joint that could not be projected means the whole strength: the
       * locality is an improvement on a working feature, never a way to switch it off by accident.
       */
      var weight = 1;
      if (positions && wind.atX !== null) {
        var at = positions[i];
        if (!at) weight = 0;
        else {
          var dx = at.x - wind.atX;
          var dy = at.y - wind.atY;
          weight = falloff(Math.sqrt(dx * dx + dy * dy), radius);
        }
      }
      if (!active || weight <= 0) {
        // Restore EXACTLY what the model (or an override) said, so a swept pet is never left blown.
        if (settings.gravityPower !== entry.power) settings.gravityPower = entry.power;
        var rest = settings.gravityDir;
        if (rest && Number.isFinite(rest.x)) {
          if (rest.x !== entry.dir.x || rest.y !== entry.dir.y || rest.z !== entry.dir.z) {
            if (typeof rest.set === 'function') rest.set(entry.dir.x, entry.dir.y, entry.dir.z);
            else {
              rest.x = entry.dir.x;
              rest.y = entry.dir.y;
              rest.z = entry.dir.z;
            }
            steered += 1;
          }
        }
        continue;
      }
      /**
       * gravity = own gravity + wind, as a vector sum.
       *
       * The chains' own gravity is the pull that already holds the hair down, so the wind's strength is expressed
       * as a fraction of that pull rather than as a number of its own — and it is scaled here by `weight`, the
       * LOCAL share this joint gets from its distance to the cursor.
       */
      var share = this.wind.power * weight;
      var gx = entry.dir.x * (Number.isFinite(entry.power) ? entry.power : 0) + this.wind.x * share;
      var gy = entry.dir.y * (Number.isFinite(entry.power) ? entry.power : 0) + this.wind.y * share;
      var gz = entry.dir.z * (Number.isFinite(entry.power) ? entry.power : 0) + this.wind.z * share;
      var length = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (!(length > 1e-6)) continue;
      var dir = settings.gravityDir;
      if (dir && typeof dir.set === 'function') dir.set(gx / length, gy / length, gz / length);
      else if (dir) { dir.x = gx / length; dir.y = gy / length; dir.z = gz / length; }
      // The magnitude carries the strength: a unit direction times this is the force the solver applies.
      settings.gravityPower = length;
      steered += 1;
    }
    return steered;
  };

  /** What the draught is doing right now, for the settings readout and for tests. */
  Scene.prototype.windState = function () {
    var wind = this.wind || null;
    return {
      power: wind && wind.power > 0 ? wind.power : 0,
      x: wind ? wind.x : 0,
      y: wind ? wind.y : 0,
      z: wind ? wind.z : 0,
      speed: wind && Number.isFinite(wind.speed) ? wind.speed : 0,
      joints: (this.springBase || []).length,
      // How far the draught reached, in canvas pixels, and where its centre was — the two numbers that say
      // whether a sweep was local, and where it was aimed.
      radius: Number.isFinite(this.windRadius) ? this.windRadius : 0,
      at: wind && wind.atX !== null && wind.atY !== null
        ? { x: Math.round(wind.atX), y: Math.round(wind.atY) }
        : null,
    };
  };

  // ===========================================================================
  // Spring-bone settings
  // ===========================================================================

  /**
   * The model's spring chains: what the file declares, and what is in force now.
   *
   * `authored` is the number the model file gave the joint — the thing "default" means — and
   * `current` is after any override, so a caller can show both and tell them apart.
   */
  Scene.prototype.springChains = function () {
    return (this.springChainInfo || []).map(function (chain) {
      var first = chain.joints.length ? chain.joints[0].joint : null;
      var settings = first ? first.settings : null;
      return {
        name: chain.name,
        joints: chain.joints.length,
        missing: chain.missing || 0,
        colliderGroups: chain.colliderGroups || 0,
        authored: chain.authored,
        current: settings
          ? { stiffness: settings.stiffness, dragForce: settings.dragForce, gravityPower: settings.gravityPower }
          : null,
      };
    });
  };

  /** How many joints the model has across every chain, for a one-line summary. */
  Scene.prototype.springJointCount = function () {
    var total = 0;
    for (var i = 0; i < (this.springChainInfo || []).length; i += 1) total += this.springChainInfo[i].joints.length;
    return total;
  };

  /**
   * Apply the per-model spring overrides.
   *
   * An absent FIELD is not "zero": it is "whatever this joint's own authored value was", captured at
   * install time. That is what makes "默认" a real state rather than a number the UI guessed, and it
   * is why the baseline is a snapshot per JOINT — two joints in one chain may legitimately differ.
   *
   * @returns {number} how many joint settings actually changed
   */
  /**
   * Gravity for a chain that declares none.
   *
   * VRM 1.0 puts `gravityDir` and `gravityPower` in the file, so a model describes its own fall. VRM 0.x has
   * no such fields at all - three-vrm's v0 import leaves them undefined - and a viewer is expected to supply
   * the gravity itself. Not supplying it is why 初音's twintails sat at 45 degrees and her skirt stayed
   * flared while every other theory (the animation, the skeleton merge, the colliders, the spring rest state)
   * turned out to change nothing: with no gravity a chain simply keeps the pose it was bound in, for ever.
   *
   * The values are the ones the settings window already offers per chain, and they become that chain's
   * 'default' - so the window can still take them away or make them stronger, and a model that DOES declare
   * its own physics is never touched.
   */
  var DEFAULT_GRAVITY_POWER = 0.5;

  Scene.prototype.supplyMissingGravity = function () {
    var chains = this.springChainInfo || [];
    for (var c = 0; c < chains.length; c += 1) {
      var joints = chains[c].joints || [];
      for (var j = 0; j < joints.length; j += 1) {
        var settings = joints[j].joint && joints[j].joint.settings;
        if (!settings) continue;
        var power = Number(settings.gravityPower);
        if (!Number.isFinite(power) || power <= 0) {
          settings.gravityPower = DEFAULT_GRAVITY_POWER;
          joints[j].gravitySupplied = true;
        }
        // A direction of (0, 0, 0) is as good as none: it cancels whatever power is set.
        var dir = settings.gravityDir;
        var length = dir ? Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) : 0;
        if (!Number.isFinite(length) || length < 1e-6) {
          settings.gravityDir = new this.THREE.Vector3(0, -1, 0);
        }
      }
    }
  };

  Scene.prototype.applySprings = function (preferences) {
    var prefs = preferences || this.preferences;
    var modelId = this.currentModelId || (prefs && prefs.modelId) || null;
    var changed = 0;
    for (var i = 0; i < (this.springChainInfo || []).length; i += 1) {
      var chain = this.springChainInfo[i];
      // The override is looked up by the chain's KEY, never by its name: an unnamed chain has no name, and
      // the empty string was a key that could not be stored anywhere (2026-10-09).
      var override = this.core.springOverrideFor(prefs, modelId, chain.key || chain.name) || {};
      for (var j = 0; j < chain.joints.length; j += 1) {
        var entry = chain.joints[j];
        var settings = entry.joint.settings;
        if (!settings) continue;
        for (var k = 0; k < SPRING_FIELDS.length; k += 1) {
          var field = SPRING_FIELDS[k];
          var wanted = Number(override[field]);
          var next = Number.isFinite(wanted) ? wanted : entry.authored[field];
          if (settings[field] !== next) {
            settings[field] = next;
            changed += 1;
          }
        }
      }
    }
    return changed;
  };

  // ===========================================================================
  // Expressions
  // ===========================================================================

  /** The expression names this model actually has. Empty when it has no expression manager. */
  Scene.prototype.expressionNames = function () {
    var manager = this.avatar && this.avatar.expressions;
    if (!manager || !manager.expressionMap) return [];
    return Object.keys(manager.expressionMap);
  };

  /** The weight one expression is at right now, as the manager sees it. */
  Scene.prototype.expressionValue = function (name) {
    var manager = this.avatar && this.avatar.expressions;
    if (!manager || typeof manager.getValue !== 'function') return null;
    var value = manager.getValue(name);
    return Number.isFinite(value) ? value : null;
  };

  /**
   * Pin one expression by hand, or release it back to the behaviour.
   *
   * `null` releases it — the blink timer and the emotion reactions own it again — while a number
   * pins it, INCLUDING 0, which is a different instruction from "no opinion".
   */
  Scene.prototype.setExpression = function (name, weight) {
    if (!name || typeof name !== 'string') return null;
    var weights = this.preferences.expressions.weights;
    if (weight === null || weight === undefined) delete weights[name];
    else {
      weights[name] = this.core.clamp(
        Number(weight) || 0,
        this.core.EXPRESSION_LIMITS.weightMin,
        this.core.EXPRESSION_LIMITS.weightMax,
      );
    }
    this.applyExpressions(this.preferences);
    return weights[name] === undefined ? null : weights[name];
  };

  /**
   * The face a CLIP carries, or null.
   *
   * The operator asked for this (2026-10-09): in each state, each clip can name an expression and a mouth
   * shape, and the mouth overrides the expression's own mouth. Two sources, most specific first:
   *
   *  * a live PREVIEW — the settings window is being used, so the model shows what is being chosen;
   *  * the entry for the clip that is playing, in the state it was drawn for.
   *
   * Derived every frame rather than bookkept at start/stop, so it cannot go stale: a clip that ended, a
   * preview that was cleared and a mapping that changed all resolve to the truth on the next frame.
   */
  Scene.prototype.currentFace = function () {
    if (this.preview && (this.preview.expression || this.preview.mouth)) {
      return { expression: this.preview.expression || null, mouth: this.preview.mouth || null };
    }
    var id = this.playback ? this.playback.id : null;
    var state = this.pickState || null;
    if (!id || !state || !this.core.motionClipFor) return null;
    var entry = this.core.motionClipFor(this.preferences, state, id);
    if (!entry || (!entry.expression && !entry.mouth)) return null;
    return { expression: entry.expression || null, mouth: entry.mouth || null };
  };

  /**
   * May the pet look at the cursor while the clip that is playing right now plays?
   *
   * The per-state per-clip 凝视 switch, read the same way `currentFace` reads the expression: the clip that is
   * actually playing, in the state it is playing in. A preview answers for the clip it previews, because that
   * is the clip the user is looking at on screen — and a preview suppresses the gaze anyway (§24.2), so the two
   * cannot disagree about what is being shown.
   *
   * Default TRUE: the switch is stored as a refusal, so adding it changed nothing for any existing profile.
   */
  Scene.prototype.clipGazeAllowed = function () {
    if (!this.core.motionGazeFor) return true;
    var id = this.preview && this.preview.motionId ? this.preview.motionId : (this.playback ? this.playback.id : null);
    var state = (this.preview && this.preview.state) ? this.preview.state : (this.pickState || null);
    if (!id || !state) return true;
    return this.core.motionGazeFor(this.preferences, state, id);
  };

  /** Which expressions the user has pinned, plus what the behaviours want for the rest. */
  Scene.prototype.expressionTargets = function (preferences) {
    var prefs = preferences || this.preferences;
    var weights = (prefs && prefs.expressions && prefs.expressions.weights) || {};
    var behaviour = this.expressionBehaviour || { blink: 0, blinkExpression: 'blink', emotion: null, emotionWeight: 0 };
    var values = {};
    var pinned = Object.keys(weights);
    for (var i = 0; i < pinned.length; i += 1) values[pinned[i]] = weights[pinned[i]];
    // The behaviours only fill in what the user has NOT pinned: a manual 0 has to keep winning, or a
    // deliberately closed eye would blink anyway.
    var blinkName = behaviour.blinkExpression || 'blink';
    if (behaviour.blink > 0 && weights[blinkName] === undefined) values[blinkName] = behaviour.blink;
    /**
     * The CLIP's own face, which is more specific than the emotion table and therefore takes the slot the
     * emotion would have used: a clip configured as "Joy, mouth A" shows exactly that while it plays, instead
     * of fighting whatever mood the state's row picked.
     */
    var face = this.currentFace ? this.currentFace() : null;
    if (face && face.expression && weights[face.expression] === undefined) values[face.expression] = 1;
    if (face && face.mouth && weights[face.mouth] === undefined) values[face.mouth] = 1;
    if (!face && behaviour.emotion && behaviour.emotionWeight > 0 && weights[behaviour.emotion] === undefined) {
      values[behaviour.emotion] = behaviour.emotionWeight;
    }
    return values;
  };

  /**
   * Push the current weights into three-vrm and let it write the morph targets.
   *
   * `update()` is what actually applies a weight to the model, and it has to run EVERY frame: an
   * earlier revision called it only while an authored clip was playing, so a weight set by the
   * settings window — or by the blink timer — never reached the face during the idle at all.
   *
   * @returns {number} how many expressions were set this frame
   */
  Scene.prototype.applyExpressions = function (preferences) {
    var manager = this.avatar && this.avatar.expressions;
    if (!manager || typeof manager.setValue !== 'function') return 0;
    var values = this.expressionTargets(preferences);
    var names = Object.keys(values);
    for (var i = 0; i < names.length; i += 1) manager.setValue(names[i], values[names[i]]);
    // Anything that had a value last frame and has none now must be released, or a one-shot emotion
    // stays on the face for good.
    var previous = this.expressionApplied || {};
    var old = Object.keys(previous);
    for (var j = 0; j < old.length; j += 1) {
      if (values[old[j]] === undefined) manager.setValue(old[j], 0);
    }
    this.expressionApplied = values;
    if (typeof manager.update === 'function') manager.update();
    return names.length;
  };

  /**
   * The user did something to the pet: clicked it, pressed and held it, or finished dragging it.
   *
   * Called by the hosts, because only they see a pointer event; the pet's own state machine sees a
   * drag as `held`, which is the other half of the same trigger.
   *
   * `part` is what {@link Scene.prototype.anatomyAt} answered for the press — which PART of the model the
   * pointer landed on, as the user's own label for it — or null when nobody measured it. It changes nothing
   * unless the user has configured that part (see the chain below).
   */
  Scene.prototype.noteInteraction = function (reason, part) {
    var config = this.preferences && this.preferences.expressions && this.preferences.expressions.emotion;
    var gesture = reason || 'click';
    var item = part && typeof part === 'object' ? (part.part || null) : null;
    /**
     * Recorded before anything can refuse to react, and that is the point: "I clicked its ear and nothing
     * happened" is answered by this line even when no row matched. `part` is the label, `region` the default
     * classification the label came from, and `bone`/`mesh` the model's own words — three levels of detail,
     * because which one explains the surprise depends on the surprise.
     */
    this.lastInteraction = {
      reason: gesture,
      part: item ? item.id : null,
      label: item ? item.label : null,
      region: item ? item.region : (part && typeof part.region === 'string' ? part.region : null),
      bone: (part && part.bone) || null,
      mesh: (part && part.mesh) || null,
      /**
       * The SPRING CHAIN this press grabbed, when it grabbed one — `{ key, name, label, joints }`, else null.
       *
       * Published because the chain is the name a person recognises for a hanging part of the model (`LiuHai`,
       * `WeiBa`), and because it is what the AI request prefers over the raw structure name.
       */
      chain: (part && part.chain) || null,
      at: this.motion ? this.motion.elapsed : null,
    };
    if (!config || config.enabled === false) return null;
    /**
     * The PART chain, in the same spirit as the 碎碎念 boxes: a part whose row names at least one emotion is
     * what the press uses, and a part whose row names none falls through to the generic row for that gesture —
     * so adding one part never silences the reaction the user already had.
     */
    var partRow = item ? item.emotion : null;
    if (partRow && partRow.enabled !== false && partRow.emotions && partRow.emotions.length) {
      return this.triggerEmotionRow(partRow, gesture, item);
    }
    return this.triggerEmotionRow(config.triggers ? config.triggers[gesture] : null, gesture, null);
  };

  /**
   * Put one emotion on the face, and let it fade after `holdSeconds`.
   *
   * An interaction prefers an emotion that reads as a reaction to being touched; the idle timer may
   * pick anything the model has. Both skip expressions the user has pinned by hand — a manual weight
   * is an instruction, not a suggestion.
   */
  /**
   * Which emotion this model can really show.
   *
   * An expression with no binds drives nothing - 蓝色小肥鱼 declares `surprised` and leaves it empty - so it
   * must not be picked: the pet would look frozen while the state said it was reacting.
   */
  Scene.prototype.showableEmotions = function () {
    var manager = this.avatar && this.avatar.expressions;
    var map = (manager && manager.expressionMap) || {};
    var names = this.expressionNames();
    var out = [];
    for (var i = 0; i < names.length; i += 1) {
      var expression = map[names[i]];
      // `binds` is what the expression actually drives. Not `expressionTargets`, which is the WEIGHT map
      // for a frame - asking it whether an expression is usable answers a different question and always
      // says no.
      if (expression && expression.binds && expression.binds.length) out.push(names[i]);
    }
    return out;
  };

  /**
   * React to a situation: `idle`, `drag`, `click` or `hold`.
   *
   * The row for that trigger says which emotions may be used and for how long. The list is EXACTLY what
   * may be used; an EMPTY list means no expression at all, which is the 无 choice in the window and the
   * shipped default, so an idle pet has a still face until the user picks moods for it. It used to mean
   * "whatever this model declares", which made "no expression" impossible to ask for.
   *
   * `holdSeconds: 0` means 'hold it': the mood stays until another trigger replaces it, which is what a
   * mood is. A positive number holds it and then fades, which is what a reaction is.
   */
  Scene.prototype.triggerEmotion = function (reason) {
    var config = this.preferences && this.preferences.expressions && this.preferences.expressions.emotion;
    if (!config || config.enabled === false) return null;
    var trigger = reason || 'click';
    var row = config.triggers && config.triggers[trigger] ? config.triggers[trigger] : null;
    return this.triggerEmotionRow(row, trigger, null);
  };

  /**
   * Apply ONE row — the shared body of the trigger path and the per-part path.
   *
   * One function because the two differ only in WHICH row was found: a second copy of the picking rules is how
   * a part reaction would end up able to do something a trigger reaction cannot.
   */
  Scene.prototype.triggerEmotionRow = function (row, reason, part) {
    var manager = this.avatar && this.avatar.expressions;
    if (!manager || !manager.expressionMap) return null;
    var config = this.preferences && this.preferences.expressions && this.preferences.expressions.emotion;
    if (!config || config.enabled === false) return null;
    var trigger = reason || 'click';
    var item = part && typeof part === 'object' ? part : null;
    if (!row || row.enabled === false) return null;

    var showable = this.showableEmotions() || [];
    /**
     * Which emotions this row may use: the labels the user ticked, and nothing else.
     *
     * An empty list is the 无 row — deliberately silent. The old fallback ("no list means whatever the
     * model declares") is gone with the 无 checkbox that replaced it: the model's own mood words are no
     * longer used behind the user's back, and asking for a still face is now possible.
     */
    var wanted = row.emotions ? row.emotions.slice() : [];
    if (!wanted.length) return null;
    var candidates = wanted.filter(function (name) { return showable.indexOf(name) !== -1; });
    // A model with none of the named emotions is not a failure: the pet simply does not react.
    if (!candidates.length) return null;

    var weights = this.preferences.expressions.weights;
    var unpinned = candidates.filter(function (name) { return weights[name] === undefined; });
    if (!unpinned.length) return null;
    var picked = unpinned[Math.min(unpinned.length - 1, Math.floor(this.random() * unpinned.length))];

    var hold = Number(row.holdSeconds);
    if (!Number.isFinite(hold) || hold < 0) hold = 0;
    this.expressionBehaviour.emotion = picked;
    this.expressionBehaviour.emotionWeight = 1;
    var state = this.expressionState || (this.expressionState = {});
    state.emotionStartedAt = this.motion.elapsed;
    // A zero duration is not 'until now': it is a mood, kept until something replaces it.
    state.emotionPersistent = hold === 0;
    state.emotionHold = hold;
    state.emotionUntil = this.motion.elapsed + (hold === 0 ? Infinity : hold);
    state.lastEmotionReason = trigger;
    /**
     * WHICH part reacted, kept for the readout: the user's label (what the settings list shows), the id the
     * part's speech is looked up by, and the default region that label came from — three answers, because "it
     * reacted as 身体" and "it reacted as the part I called 耳朵" are different questions.
     */
    state.lastEmotionPart = item ? item.id : null;
    state.lastEmotionPartLabel = item ? item.label : null;
    state.lastEmotionRegion = item ? item.region : null;
    return picked;
  };

  /**
   * The default region a bone or mesh name belongs to.
   *
   * The patterns themselves live in `core.STRUCTURE_PATTERNS` now, because the PARTS are the user's own rows and
   * the settings page has to say which default region a structure WOULD fall into — two copies of this table
   * would be two answers to "what is a LiuHai". This wrapper only adds the bone-then-mesh order: the model's own
   * bone name is the better evidence, and the mesh name is what is left when there is no skeleton.
   */
  function partRegionFor(bone, mesh) {
    // `core` is NOT a module-scope name in this file: it is read out of `globalThis`, exactly like `THREE` (a
    // bare `core.` here threw "core is not defined" the first time this ran — the probe caught it).
    var core = globalThis.__VRMPET3D_CORE__;
    // The bone first, the mesh only when the bone name says nothing: `structureRegionOf` answers null for a name
    // it has never seen, which is what lets the mesh name be the second opinion rather than the only one.
    var candidates = [bone, mesh];
    for (var c = 0; c < candidates.length; c += 1) {
      var region = core && core.structureRegionOf ? core.structureRegionOf(candidates[c]) : null;
      if (region) return region;
    }
    return 'body';
  }

  /**
   * The two names a hit can carry, most authoritative first.
   *
   * The BONE name is better evidence than the mesh name — a face mesh called `Face` says nothing about which
   * edge of it was touched, while `J_Adj_L_FaceEye` does — so the raycast reports both and the PART matcher
   * tries them in this order.
   */
  function namesForHit(hit) {
    var bone = boneForHit(hit);
    var mesh = hit && hit.object
      ? (hit.object.name || (hit.object.material && hit.object.material.name) || null)
      : null;
    return {
      // The OBJECT is kept as well as its name: the spring-chain index is keyed by the object (see
      // `indexSpringChains`), so a press can ask "which chain did I grab" without going through a name.
      bone: bone,
      boneName: bone && bone.name ? String(bone.name) : null,
      mesh: mesh ? String(mesh) : null,
    };
  }

  /**
   * The bone that drives the hit triangle — by SKIN WEIGHTS, which is the question actually being asked.
   *
   * "Which part did you touch" is not "which bone is nearest": a coat, a skirt or a sleeve is skinned to the
   * hips or the chest while hanging far away from it, so nearest-bone names the wrong part on exactly the
   * models where it matters. The mesh's own `skinIndex`/`skinWeight` attributes say which joints move each
   * vertex, so the answer is the joint with the most influence over the triangle that was hit.
   *
   * The nearest-bone path stays as a FALLBACK for a mesh that carries no skinning data but is bound to a
   * skeleton, and both are best-effort: a mesh with neither answers null, and the caller falls back to the
   * model's mesh/material name.
   *
   * NOTE: `THREE` is NOT a module-scope name in this file — it arrives per Scene as `this.THREE`, read out of
   * `globalThis.__VRMPET3D_VENDOR__`. A `new THREE.Vector3()` at module scope therefore throws while the script is
   * loading (measured: the whole scene chunk failed to load and the client probe reported "nothing is loaded").
   * The scratch vector is taken from the intersection's own class instead, which is both version-proof and free
   * of that trap.
   */
  function boneForHit(hit) {
    var mesh = hit && hit.object ? hit.object : null;
    var skeleton = mesh && mesh.skeleton ? mesh.skeleton : null;
    var bones = skeleton && skeleton.bones ? skeleton.bones : null;
    if (!bones || !bones.length) return null;
    var attributes = mesh.geometry && mesh.geometry.attributes ? mesh.geometry.attributes : null;
    var skinIndex = attributes ? attributes.skinIndex : null;
    var skinWeight = attributes ? attributes.skinWeight : null;
    var face = hit.face;
    var first = face && Number.isFinite(face.a) ? face.a : -1;

    if (skinIndex && skinWeight && first >= 0) {
      var totals = {};
      var vertices = [first, face.b, face.c];
      for (var v = 0; v < vertices.length; v += 1) {
        var index = vertices[v];
        if (!Number.isFinite(index) || index < 0) continue;
        var joints = [skinIndex.getX(index), skinIndex.getY(index), skinIndex.getZ(index), skinIndex.getW(index)];
        var weights = [skinWeight.getX(index), skinWeight.getY(index), skinWeight.getZ(index), skinWeight.getW(index)];
        for (var k = 0; k < 4; k += 1) {
          if (!(weights[k] > 0)) continue;
          totals[joints[k]] = (totals[joints[k]] || 0) + weights[k];
        }
      }
      var bestJoint = -1;
      var bestWeight = 0;
      Object.keys(totals).forEach(function (key) {
        if (totals[key] > bestWeight) { bestWeight = totals[key]; bestJoint = Number(key); }
      });
      if (bestJoint >= 0 && bones[bestJoint]) return bones[bestJoint] || null;
    }

    if (!hit.point) return null;
    var Vector = hit.point.constructor;
    if (typeof Vector !== 'function') return null;
    var world = new Vector();
    var nearest = null;
    var nearestDistance = Infinity;
    for (var b = 0; b < bones.length; b += 1) {
      var bone = bones[b];
      if (!bone) continue;
      // A bone's world matrix is only current for bones three.js has already visited this frame, so it is
      // asked for explicitly — that is what makes this work for a mesh that was never drawn this frame.
      bone.updateWorldMatrix(true, false);
      world.setFromMatrixPosition(bone.matrixWorld);
      var distance = world.distanceTo(hit.point);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = bone; }
    }
    return nearest || null;
  }

  /**
   * Which SPRING CHAIN a bone belongs to, or `null`.
   *
   * The answer a press makes possible (operator, 2026-10-11): "触发点击碎碎念的时候，把对应的链名和结构名一起发给
   * LLM，链名的优先级大于结构名". A hair or skirt joint IS a bone, so the press already knows it — this is the
   * lookup that turns it into the chain the file declares, keeping the three fields the settings window uses:
   * `key` (what an override is stored under), `name` (what the author called it, often absent in VRM 0.x) and
   * `label` (the root bone's name, which is what a person recognises when there is no name at all).
   */
  Scene.prototype.springChainForBone = function (bone) {
    if (!bone || !this.springChainOf || typeof this.springChainOf.get !== 'function') return null;
    var chain = this.springChainOf.get(bone);
    if (!chain) return null;
    return {
      key: chain.key || null,
      name: chain.name || null,
      label: chain.label || null,
      joints: chain.joints ? chain.joints.length : 0,
    };
  };

  /**
   * WHERE a press landed, in the stable vocabulary the settings page shows.
   *
   * The hit test that decides whether the pet takes a pointer at all is a framebuffer readback (per-pixel
   * alpha), which answers "is something painted here" and nothing else. This answers the other question with
   * GEOMETRY: one ray from the camera through the point, against the avatar, then the dominant bone of the
   * triangle it hit, then {@link PART_PATTERNS} maps that name into a region.
   *
   * It is called once per PRESS, never per frame: a raycast against a whole avatar costs more than a frame on
   * a heavy model, and the answer cannot change while the pointer is held.
   *
   * The coordinates are canvas-local CSS pixels with the origin at the canvas's top-left — the same space the
   * callers already compute for the alpha test, so the two agree about where the pointer is.
   *
   * @param {number} x
   * @param {number} y
   * @returns {{region: string, bone: string|null, mesh: string|null, distance: number}|null} null when the
   *   ray misses the model entirely, which is a different answer from "the model has no named parts".
   */
  Scene.prototype.anatomyAt = function (x, y) {
    // `THREE` is a per-Scene field in this file, never a module-scope name: reading it here is what keeps this
    // method loadable on a page where the vendor chunk arrives before the scene does (see `boneNameForHit`).
    var THREE = this.THREE;
    var canvas = this.canvas;
    var root = this.avatar && this.avatar.root;
    if (!THREE || !canvas || !root || !this.camera) return null;
    var width = canvas.clientWidth || canvas.width;
    var height = canvas.clientHeight || canvas.height;
    if (!width || !height || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    /**
     * THE BOUNDS ARE REFRESHED TO THE POSE THIS FRAME HAS, and this is the operator's bug of 2026-10-13:
     * 「当在执行动作时，点击身体部位的碎碎念反馈消失了」 — on BOTH surfaces at once, which is what pointed here rather
     * than at either press path.
     *
     * three's own `SkinnedMesh.raycast` starts by rejecting the ray against a cached bounding volume:
     *
     *   if (this.boundingSphere === null) this.computeBoundingSphere();
     *   if (raycaster.ray.intersectsSphere(sphere) === false) return;
     *   if (this.boundingBox !== null && ray.intersectsBox(this.boundingBox) === false) return;
     *
     * Each volume is computed ONCE and kept — and a clip only moves the PIXELS, because the mixer re-poses the
     * bones without touching them. So the first press of a session cached the REST pose, every press after a clip
     * had moved the model was measured against that rest pose, and a hand (or a head, or a tail) outside it was
     * rejected before a single triangle was tested: `anatomyAt` answered null, no part was named, and the pet said
     * nothing. Measured in `client-test`'s posed-anatomy check: an arm lifted 163 px answered `butt` at rest and
     * `null` when posed, with `boundingBox` still spanning the rest pose.
     *
     * `SkinnedMesh.computeBoundingBox`/`computeBoundingSphere` are pose-aware in this build (they go through
     * `getVertexPosition` → `applyBoneTransform`), so recomputing is the whole fix — and it is paid ONCE PER PRESS,
     * which is what this method already promised: a raycast against a whole avatar costs more than a frame, and
     * the answer cannot change while the pointer is held.
     */
    if (typeof root.traverse === 'function') {
      root.traverse(function (node) {
        if (!node || node.isSkinnedMesh !== true) return;
        // Only refresh what three is going to consult: a null box stays null and is not consulted at all.
        if (node.boundingBox !== null && typeof node.computeBoundingBox === 'function') node.computeBoundingBox();
        if (typeof node.computeBoundingSphere === 'function') node.computeBoundingSphere();
      });
    }
    var raycaster = this.raycaster || (this.raycaster = new THREE.Raycaster());
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -((y / height) * 2 - 1)), this.camera);
    var hits = raycaster.intersectObject(root, true);
    for (var i = 0; i < hits.length; i += 1) {
      var hit = hits[i];
      if (!hit.object || hit.object.visible === false) continue;
      var names = namesForHit(hit);
      var bone = names.boneName;
      var mesh = names.mesh;
      var region = partRegionFor(bone, mesh);
      return {
        region: region,
        /**
         * The user's own PART for this structure — the row that decides the reaction and the remark.
         *
         * Resolved here rather than by the caller because this is where the structure's NAME is known, and a
         * part is matched by name (`LiuHai` owning everything under it). `null` when the user deleted every
         * part, which is an answer: no reaction rather than an invented one.
         */
        part: this.core && this.core.partItemFor
          ? this.core.partItemFor(this.preferences, bone || mesh, region)
          : null,
        /**
         * The SPRING CHAIN that bone belongs to, when it belongs to one — `{ key, name, label, joints }`, else null.
         *
         * A press on hair, a twintail, a skirt or a tail is a press on a spring JOINT, and the chain is the thing
         * a person (and the model) can name: on 蓝色小肥鱼 the chains are literally `LiuHai` / `DaiMao` / `WeiBa`.
         * The name travels to the AI 碎碎念 request with the structure name and takes PRIORITY over it (2026-10-11).
         */
        chain: this.springChainForBone(names.bone),
        bone: bone,
        mesh: mesh,
        distance: Math.round(hit.distance * 1000) / 1000,
      };
    }
    return null;
  };

  /** What the emotion is doing right now, for a suite or a log. */
  Scene.prototype.emotionState = function () {
    var behaviour = this.expressionBehaviour || {};
    var state = this.expressionState || {};
    return {
      name: behaviour.emotion || null,
      weight: behaviour.emotionWeight || 0,
      until: state.emotionUntil || 0,
      reason: state.lastEmotionReason || null,
      /**
       * Which PART that reaction came from, when it came from one.
       *
       * Published because "I clicked its ear and nothing happened" has three answers — the press landed on a
       * structure no part owns, the part it landed on names no emotion, or the reaction did fire and the user
       * misread it — and they need different fixes. `part` is the id (what a speech prompt is stored under),
       * `partLabel` the name the settings list shows, `region` the default the label was matched from.
       */
      part: state.lastEmotionPart || null,
      partLabel: state.lastEmotionPartLabel || null,
      region: state.lastEmotionRegion || null,
      persistent: state.emotionPersistent === true,
      hold: state.emotionHold === undefined ? null : state.emotionHold,
    };
  };

  /** The last press this pet reacted to: which gesture, and WHERE it landed. For a suite or a log. */
  Scene.prototype.lastInteractionState = function () {
    return this.lastInteraction ? { ...this.lastInteraction } : null;
  };

  /**
   * Does the user have an expression PINNED on the face right now?
   *
   * `preferences.expressions.weights` is the hand-set half of the face — "专门设置" — written by the stored
   * configuration and by the settings window's 表情 preview. It is the most persistent of the three sources and
   * it was the one the blink pause did not look at, while `expressionTargets` writes a pinned weight into the
   * morphs every frame: a blink during one is not a blink, it is the expression dropping and coming back for a
   * tenth of a second — the defect the pause exists to prevent.
   *
   * The BLINK names are excluded for the reason `expressionTargets` documents: the behaviour writes its own
   * weight only where the user has NOT pinned one, so a pinned `blink`/`blinkLeft`/`blinkRight` is a deliberate
   * pose that owns the eyelids itself (a wink) and there is nothing for the timer to overwrite.
   *
   * An explicit 0 counts as pinned: dropping the name here would let a deliberate "eyes shut" be blinked open,
   * which is the failure mode spelled out beside the blink weight in `expressionTargets`.
   */
  Scene.prototype.faceIsPinned = function () {
    var prefs = this.preferences || {};
    var weights = (prefs.expressions && prefs.expressions.weights) || {};
    var blinkNames = this.core.BLINK_EXPRESSIONS || ['blink', 'blinkLeft', 'blinkRight'];
    var names = Object.keys(weights);
    for (var i = 0; i < names.length; i += 1) {
      if (blinkNames.indexOf(names[i]) === -1) return true;
    }
    return false;
  };

  /** What the blink timer is doing right now. */
  Scene.prototype.blinkState = function () {
    var behaviour = this.expressionBehaviour || {};
    var state = this.expressionState || {};
    var face = this.currentFace ? this.currentFace() : null;
    return {
      weight: behaviour.blink || 0,
      expression: behaviour.blinkExpression || 'blink',
      nextAt: state.nextBlinkAt || 0,
      // Blinking is PAUSED while the face is expressing something (see `advanceExpressions`): reported here
      // so the readout says why nothing is blinking instead of leaving it to be inferred. The FOUR sources
      // must stay in step with the gate itself — `faceIsPinned` is the shared answer for the hand-set one, and
      // `faceTracks` is the expression the CLIP ITSELF carries (「当动作本身带有表情的时候，停用眨眼」).
      paused: Boolean(face)
        || Boolean(this.playback && this.playback.record && this.playback.record.faceTracks)
        || Boolean(behaviour.emotion && behaviour.emotionWeight > 0) || this.faceIsPinned(),
    };
  };

  /**
   * Advance the two behaviours that move expressions by themselves.
   *
   * Driven by the frame's own `dt` rather than by timers: a suite can then step it exactly, and a
   * backgrounded window cannot come back with a backlog of blinks queued up.
   */
  Scene.prototype.advanceExpressions = function (dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    var settings = (this.preferences && this.preferences.expressions) || {};
    var now = this.motion.elapsed;
    var state = this.expressionState || (this.expressionState = {});
    var behaviour = this.expressionBehaviour;

    // ---- blink -------------------------------------------------------------------------------
    /**
     * A FACE THAT IS ALREADY EXPRESSING SOMETHING DOES NOT BLINK.
     *
     * The operator's request (2026-10-09 late): "当模型脸上有表情的时候，暂停眨眼". In a VRM the blink and the
     * expression shapes drive the SAME eyelid morphs — `expressionTargets` writes the clip's face or the
     * emotion into them, and the blink would overwrite that for a tenth of a second. On screen that is not a
     * blink; it is the expression dropping and coming back. So a face that is showing something (an emotion
     * with a weight, or a clip whose own expression/mouth is playing, or a preview) holds the eyes open.
     *
     * Only the START of a blink is gated: one that is already running finishes, because cutting it mid-way
     * would snap the eyes open. The schedule is left alone too, so a blink that came due while the face was
     * busy happens on the first frame the face is clear again, and blinking resumes its normal rhythm.
     */
    var clipFace = this.currentFace ? this.currentFace() : null;
    /**
     * The clip's OWN expression counts as a face (2026-10-13: 「当动作本身带有表情的时候，停用眨眼」): a VRMA with
     * morph tracks drives the same eyelids the blink does, so blinking over it is the expression dropping and
     * coming back. `currentFace` covers the expression the USER assigned to the clip; `faceTracks` covers the
     * one the FILE brought with it, which no preference can see.
     */
    var clipMorphs = Boolean(this.playback && this.playback.record && this.playback.record.faceTracks);
    var faceIsExpressing = Boolean(clipFace) || clipMorphs
      || Boolean(behaviour.emotion && behaviour.emotionWeight > 0) || this.faceIsPinned();
    var blink = settings.blink || { enabled: false };
    if (blink.enabled === false) {
      behaviour.blink = 0;
      state.blinking = false;
      state.nextBlinkAt = null;
    } else {
      var limits = this.core.BLINK_LIMITS || {};
      var singleDuration = Number(limits.durationSeconds) > 0 ? Number(limits.durationSeconds) : 0.14;
      if (state.nextBlinkAt === null || state.nextBlinkAt === undefined) {
        state.nextBlinkAt = now + this.randomBetween(blink.minSeconds, blink.maxSeconds, 2, 6);
      }
      // `state.blinking` rather than `behaviour.blink > 0`: the weight starts the blink at ZERO now, so it
      // ramps in from open eyes instead of snapping fully shut for one frame. That one-frame snap was
      // invisible at 60 fps on a single blink and very visible as a stutter on the double.
      if (state.blinking) {
        var total = Number(state.blinkTotal) > 0 ? Number(state.blinkTotal) : singleDuration;
        var cycles = state.blinkCycles === 2 ? 2 : 1;
        var progress = total > 0 ? (now - (state.blinkStartedAt || 0)) / total : 1;
        if (progress >= 1) {
          behaviour.blink = 0;
          state.blinking = false;
          state.blinkCycles = 1;
          state.blinkTotal = singleDuration;
          state.nextBlinkAt = now + this.randomBetween(blink.minSeconds, blink.maxSeconds, 2, 6);
        } else {
          // One triangle per blink. A single blink is one rise and fall over its duration; a DOUBLE blink
          // does that twice inside a total that is only 1.5x as long, so each half is 0.75 of a blink and
          // the weight passes through 0 between them — the instant of open eyes that reads as two blinks
          // instead of one slow squint.
          var within = (progress * cycles) % 1;
          behaviour.blink = Math.max(0, 1 - Math.abs(within * 2 - 1));
        }
      } else if (!faceIsExpressing && now >= state.nextBlinkAt) {
        // Decided at the START of each blink, and from the scene's own injected random, so a suite can pin
        // both kinds instead of waiting for a 20 % chance to come round.
        var chance = Number(limits.doubleChance);
        var double = this.random() < (Number.isFinite(chance) ? chance : 0.2);
        state.blinkCycles = double ? 2 : 1;
        state.blinkTotal = singleDuration * (double
          ? (Number(limits.doubleDurationRatio) > 0 ? Number(limits.doubleDurationRatio) : 1.5)
          : 1);
        behaviour.blink = 0;
        behaviour.blinkExpression = this.pickBlinkExpression();
        state.blinking = true;
        state.blinkStartedAt = now;
      }
    }

    // ---- emotion -----------------------------------------------------------------------------
    //
    // The row the emotion came from decides how it ends: `holdSeconds: 0` is a MOOD that stays until
    // another trigger replaces it, and a positive number is a REACTION that fades. The settings window
    // says which is which with the number 0, so the two cases have to be told apart here.
    var emotion = settings.emotion || { enabled: false };
    var idleRow = (emotion.triggers && emotion.triggers.idle) || null;
    if (behaviour.emotion) {
      var elapsed = now - (state.emotionStartedAt || 0);
      var fade = this.core.EMOTION_LIMITS.fadeSeconds;
      if (state.emotionPersistent === true) {
        // Held: only the fade-in applies, and nothing counts down.
        behaviour.emotionWeight = fade > 0 ? Math.min(1, elapsed / fade) : 1;
      } else {
        var hold = Number(state.emotionHold);
        if (!Number.isFinite(hold) || hold <= 0) hold = Number(emotion.holdSeconds) || 1.8;
        if (elapsed >= hold) {
          behaviour.emotion = null;
          behaviour.emotionWeight = 0;
          state.emotionUntil = 0;
        } else {
          // Fade in, hold, fade out: a hard cut on and off reads as a glitch rather than a mood.
          var rising = fade > 0 ? Math.min(1, elapsed / fade) : 1;
          var falling = fade > 0 ? Math.min(1, (hold - elapsed) / fade) : 1;
          behaviour.emotionWeight = Math.max(0, Math.min(rising, falling));
        }
      }
    } else if (emotion.enabled !== false && (!idleRow || idleRow.enabled !== false)) {
      if (state.nextIdleEmotionAt === null || state.nextIdleEmotionAt === undefined) {
        state.nextIdleEmotionAt = now + this.randomBetween(emotion.idleMinSeconds, emotion.idleMaxSeconds, 20, 60);
      } else if (now >= state.nextIdleEmotionAt) {
        state.nextIdleEmotionAt = null;
        this.triggerEmotion('idle');
      }
    }
  };

  /** A uniform number in [low, high], with the bounds trusted only as far as they are sane. */
  Scene.prototype.randomBetween = function (low, high, fallbackLow, fallbackHigh) {
    var min = Number.isFinite(Number(low)) ? Number(low) : fallbackLow;
    var max = Number.isFinite(Number(high)) ? Number(high) : fallbackHigh;
    if (min > max) {
      var swap = min;
      min = max;
      max = swap;
    }
    return min + this.random() * Math.max(0, max - min);
  };

  /**
   * Which blink expression to use — always BOTH eyes.
   *
   * This used to pick one eye a quarter of the time ("a pet that only ever blinks symmetrically looks
   * mechanical"). The user asked for that gone: a one-eyed blink reads as a glitch rather than as
   * character, and on a model whose morph targets are asymmetric it is worse than that. `blink` is
   * preferred whenever the model has it; the single-eye names survive only as the fallback for a
   * model that has no `blink` at all.
   */
  Scene.prototype.pickBlinkExpression = function () {
    var available = this.expressionNames();
    if (available.indexOf('blink') !== -1) return 'blink';
    var singles = ['blinkLeft', 'blinkRight'].filter(function (name) { return available.indexOf(name) !== -1; });
    return singles[0] || 'blink';
  };

  Scene.prototype.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    // Stop and uncache every mixer before the renderer goes: a mixer holds a
    // binding table that references the model's bones, so leaving them behind
    // leaks a whole skeleton per motion.
    this.stopPlayback(null);
    this.dropAllMotionClips();
    this.motionBytes = {};
    try { this.renderer.dispose(); } catch (error) { /* already gone */ }
    if (this.avatar && this.avatar.vrm && this.VRM.VRMUtils) {
      try { this.VRM.VRMUtils.deepDispose(this.avatar.vrm); } catch (error) { /* optional */ }
    }
  };

  // ===========================================================================
  // Vendor chunk loading
  // ===========================================================================

  /** The chunk's global, or undefined while it is still loading. */
  function vendorReady() {
    return globalThis.__VRMPET3D_VENDOR__;
  }

  /**
   * Accept the vendored 3D graph from a caller that already obtained it.
   *
   * `lib/client.js` reaches the chunk through DSH's module system
   * (`require.async('./client.vendor.js')`), because that is the only request
   * form the loader can compose a servable URL for. Publishing the result here
   * means every later reader — `Scene`, and the inline browser harnesses that
   * only ever read the global — sees one idempotent source of truth.
   *
   * Passing `undefined` still counts as a resolution attempt and is remembered,
   * so a caller that resolved the request to nothing cannot send a later
   * `loadVendor()` off to fetch the same missing chunk again.
   */
  function requireVendor(vendor) {
    if (vendor) globalThis.__VRMPET3D_VENDOR__ = vendor;
    vendorResolved = true;
    return vendor || null;
  }

  /** `require.async` is documented on the loader's synchronous require. */
  function canImportChunk(require) {
    if (require && typeof require.async === 'function') return true;
    // Only worth saying once per require, and only when it would have helped:
    // a global that is already published resolves before this is ever reached.
    if (require && typeof require === 'function' && !asyncRequireSeen.has(require)) {
      asyncRequireSeen.add(require);
      warnOnce('the module loader has no require.async; falling back to <script src> for chunk delivery');
    }
    return false;
  }

  /**
   * Make sure the vendored 3D chunk is present.
   *
   * Two routes, tried in this order, because only one of them works inside the
   * real app:
   *
   *   1. **the module system** — `require.async('./client.vendor.js')`. The
   *      loader composes `/plugins/<id>/client.vendor.js?rev=<current>` itself,
   *      which is the only URL the server will serve: it rejects a request whose
   *      revision is not the current one, and it rejects a file name that is not
   *      `client.<name>.js` outright.
   *   2. **a classic `<script src>`** — resolved against this file's own URL.
   *      This is what the inline browser harnesses keep working through, and the
   *      last resort if a future loader drops `require.async`. It cannot work in
   *      the app: a relative URL drops the query string the server requires, and
   *      the plugin's own script is served through a combo URL whose path is
   *      `/plugins/`, so the sibling resolves with the plugin id lost.
   *
   * @param {string} [baseUrl] resolves `./client.vendor.js` for the script route;
   *   defaults to the current script's own URL, falling back to the document base.
   * @param {number} [timeoutMs] how long to wait for the script route.
   * @param {Function} [require] the plugin's synchronous require, whose `async`
   *   member is the sanctioned route. Omitted by callers that only have a global.
   */
  function loadVendor(baseUrl, timeoutMs, require) {
    if (vendorReady()) return Promise.resolve(vendorReady());
    if (vendorResolved) {
      return Promise.reject(new Error('vrmpet3d: the 3D chunk was resolved to nothing by the client half'));
    }
    if (loadVendor.pending) return loadVendor.pending;

    if (canImportChunk(require)) {
      loadVendor.pending = require.async('./client.vendor.js').then(function (vendor) {
        if (vendor) return requireVendor(vendor);
        // The chunk registered but handed back nothing. Do not fall through to
        // the script route: it would fetch the same bytes again, and the real
        // problem (a registration that publishes no exports) is worth naming.
        throw new Error('vrmpet3d: the 3D chunk registered but published no exports');
      }).finally(function () {
        loadVendor.pending = null;
      });
      return loadVendor.pending;
    }

    var base = baseUrl;
    if (!base && typeof document !== 'undefined') {
      // `document.currentScript` is null inside an async callback, so read the
      // last script the plugin loaded instead.
      var scripts = document.querySelectorAll('script[src*="client."]');
      if (scripts.length) base = scripts[scripts.length - 1].src;
      if (!base) base = document.baseURI;
    }
    var url;
    try {
      url = new URL('client.vendor.js', base || document.baseURI).href;
    } catch (error) {
      url = 'client.vendor.js';
    }

    loadVendor.pending = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('the 3D chunk did not finish loading in time (' + url + ')'));
      }, Number.isFinite(timeoutMs) ? timeoutMs : 30000);
      script.onload = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // The chunk may have loaded from cache without re-executing; poll once
        // rather than trusting onload alone.
        if (vendorReady()) resolve(vendorReady());
        else delay(0).then(function () {
          if (vendorReady()) resolve(vendorReady());
          else reject(new Error('the 3D chunk loaded but did not publish its exports'));
        });
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('could not load the 3D chunk from ' + url));
      };
      (document.head || document.documentElement).appendChild(script);
    }).finally(function () {
      loadVendor.pending = null;
    });

    return loadVendor.pending;
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  var VrmPet3DScene = {
    FOV: FOV,
    HEIGHT_FRACTION: HEIGHT_FRACTION,
    IDLE_PERIOD: IDLE_PERIOD,
    Motion: Motion,
    Scene: Scene,
    AssetSource: AssetSource,
    wrapVRM: wrapVRM,
    wrapGLTF: wrapGLTF,
    createManager: createManager,
    resolveColorSpace: resolveColorSpace,
    applyTextureColorSpace: applyTextureColorSpace,
    loadVendor: loadVendor,
    requireVendor: requireVendor,
    vendorReady: vendorReady,
    errorText: errorText,
  };

  globalThis.__VRMPET3D_SCENE__ = VrmPet3DScene;
  if (typeof module !== 'undefined' && module.exports) module.exports = VrmPet3DScene;
})();

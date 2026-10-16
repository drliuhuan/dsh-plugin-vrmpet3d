// dsh-plugin-vrmpet3d-dev — the built-in placeholder avatar.
//
// Why this exists: the plugin must never render an empty box. A user who has not
// yet pointed it at a VRM file still gets a complete, animated desktop pet,
// and every code path (framing, idle motion, drag physics, toon shading) is
// exercised by real geometry rather than by a special case.
//
// The model is built from three.js primitives at roughly the same proportions as
// the project's character sheet: a chibi blue-haired whale-girl in a navy and
// white maid dress with whale-fin ears, a bow, and a whale tail. It deliberately
// does NOT try to be a finished character — the real asset is meant to be a VRM
// file the user supplies.
//
// Part names are the contract: `registerParts` exposes the chains the idle
// animation drives (`tail`, `earL`, `earR`, `hairL`, `hairR`) and the joints it
// bends (`head`, `torso`, `armL`, `armR`).
(function () {
  'use strict';

  /**
   * Character palette, kept in one place so the placeholder reads as the
   * project's character rather than generic primitives.
   */
  var PALETTE = {
    hair: 0x1f4a8f,
    hairTip: 0x4a8fd4,
    skin: 0xf6d9c6,
    dressNavy: 0x1c2f57,
    apron: 0xf7f9fc,
    emblem: 0x3f7fd0,
    bow: 0x2f6bd0,
    eye: 0x1b2a4a,
    eyeShine: 0xffffff,
    sock: 0xf2f5fa,
    shoe: 0x24334f,
    tail: 0x2f6bd0,
    tailTip: 0x9fc6ee,
  };

  /** Named animation chains, in the order the idle motion drives them. */
  var CHAINS = {
    tail: ['tail', 'tail2', 'tail3'],
    earL: ['earL', 'earL2'],
    earR: ['earR', 'earR2'],
    hairL: ['hairL', 'hairL2'],
    hairR: ['hairR', 'hairR2'],
  };

  /** Per-link delay, as a fraction of one idle period. */
  var CHAIN_SPREAD = {
    tail: 0.09,
    earL: 0.11,
    earR: 0.11,
    hairL: 0.14,
    hairR: 0.14,
  };

  function ease(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value * value * (3 - 2 * value);
  }

  /** Small deterministic pseudo-random so the speckle is stable across reloads. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Build a lower-poly sphere with a deterministic, symmetric vertex speckle.
   *
   * A real 3D ball reads as a manufactured primitive next to hand-drawn art. A
   * few hundred thousandths of a unit of stable, mirrored displacement makes it
   * read as sculpted without adding triangles or a texture.
   */
  function organicSphere(THREE, radius, segments, rings, jitter, seed) {
    var geometry = new THREE.SphereGeometry(radius, segments, rings);
    var position = geometry.attributes.position;
    var count = position.count;

    // Displace by a function of the QUANTISED position, not by vertex index.
    // An index-based offset would be arbitrary per vertex, and an earlier
    // attempt at a mirrored lookup produced a different value for the two ends
    // of the same edge, tearing the seam. A pure function of position is
    // automatically seam-free and exactly mirror-symmetric in x.
    function noise(value) {
      return mulberry32((Math.round(value * 4096) ^ seed) >>> 0)();
    }
    for (var j = 0; j < count; j++) {
      var x = position.getX(j);
      var y = position.getY(j);
      var z = position.getZ(j);
      var key = Math.abs(x) * 97.13 + y * 57.31 + z * 31.77;
      var magnitude = (noise(key) - 0.5) * 2 * jitter;
      var length = Math.sqrt(x * x + y * y + z * z) || 1;
      position.setXYZ(
        j,
        x + (x / length) * magnitude,
        y + (y / length) * magnitude,
        z + (z / length) * magnitude
      );
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  /** A tapered fin/fluke blade, built as an extruded shape and then scaled. */
  function finGeometry(THREE, length, spread, thickness) {
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(spread * 0.9, length * 0.25, spread * 0.35, length * 0.82);
    shape.quadraticCurveTo(spread * 0.15, length, 0, length);
    shape.quadraticCurveTo(-spread * 0.15, length, -spread * 0.35, length * 0.82);
    shape.quadraticCurveTo(-spread * 0.9, length * 0.25, 0, 0);
    var geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: thickness * 0.4,
      bevelSize: spread * 0.12,
      bevelSegments: 1,
      curveSegments: 8,
    });
    geometry.translate(0, 0, -thickness / 2);
    geometry.computeVertexNormals();
    return geometry;
  }

  /** A fluke (whale tail tip): a wide, notched horizontal blade. */
  function flukeGeometry(THREE, width, depth, thickness) {
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(width * 0.5, depth * 0.35, width * 0.62, depth * 0.95);
    shape.quadraticCurveTo(width * 0.3, depth * 0.7, 0, depth);
    shape.quadraticCurveTo(-width * 0.3, depth * 0.7, -width * 0.62, depth * 0.95);
    shape.quadraticCurveTo(-width * 0.5, depth * 0.35, 0, 0);
    var geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 10,
    });
    // Deliberately NO rotateX. The blade stays in the XY plane: `width` spans
    // local x and `depth` runs along local +y, with `thickness` on z. That lets
    // a caller place the fluke at the end of a bone chain by rotating it, which
    // is what a whale tail needs — an earlier revision baked in a π/2 rotation
    // here, which made every placement fight the geometry.
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Build the placeholder avatar.
   *
   * @param {object} THREE the three.js namespace (injected so this file has no import)
   * @returns {{root: object, parts: object, chains: object, chainSpread: object, height: number}}
   */
  function build(THREE) {
    var root = new THREE.Group();
    root.name = 'vrmpet3d-dev-placeholder';

    // --- materials -------------------------------------------------------
    // MeshToonMaterial with an explicit gradient map is what gives the MToon-like
    // banded look of the project's other art; a plain MeshLambertMaterial would
    // look flat and wrong next to the reference sheet.
    var gradientMap = createGradientMap(THREE);
    function toon(color, extra) {
      var material = new THREE.MeshToonMaterial({
        color: color,
        gradientMap: gradientMap,
      });
      if (extra) Object.assign(material, extra);
      return material;
    }

    var materials = {
      hair: toon(PALETTE.hair),
      hairTip: toon(PALETTE.hairTip),
      skin: toon(PALETTE.skin),
      dress: toon(PALETTE.dressNavy),
      apron: toon(PALETTE.apron),
      emblem: toon(PALETTE.emblem),
      bow: toon(PALETTE.bow),
      eye: toon(PALETTE.eye),
      shine: new THREE.MeshBasicMaterial({ color: PALETTE.eyeShine }),
      sock: toon(PALETTE.sock),
      shoe: toon(PALETTE.shoe),
      fin: toon(PALETTE.bow, { side: THREE.DoubleSide }),
      finInner: toon(PALETTE.tailTip, { side: THREE.DoubleSide }),
    };

    // --- proportions -----------------------------------------------------
    // Units are metres in the character's own scale; computeFraming measures the
    // result, so these numbers only need to be internally consistent.
    var HEAD_RADIUS = 0.30;
    var TORSO_HEIGHT = 0.42;
    var LEG_LENGTH = 0.30;
    var HIP_Y = LEG_LENGTH;
    var TORSO_Y = HIP_Y + TORSO_HEIGHT / 2;
    var NECK_Y = HIP_Y + TORSO_HEIGHT;
    var HEAD_Y = NECK_Y + HEAD_RADIUS * 0.86;

    // --- legs ------------------------------------------------------------
    for (var side = -1; side <= 1; side += 2) {
      var leg = new THREE.Group();
      leg.name = side < 0 ? 'legL' : 'legR';
      leg.position.set(side * 0.105, HIP_Y, 0);

      var sock = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.12, 4, 12), materials.sock);
      sock.position.y = -0.10;
      leg.add(sock);

      var shoe = new THREE.Mesh(new THREE.SphereGeometry(0.082, 16, 12), materials.shoe);
      shoe.scale.set(1.0, 0.62, 1.45);
      shoe.position.set(0, -0.225, 0.03);
      leg.add(shoe);

      leg.traverse(function (child) { if (child.isMesh) markMesh(child, 'leg'); });
      root.add(leg);
    }

    // --- torso (dress) ---------------------------------------------------
    var torso = new THREE.Group();
    torso.name = 'torso';
    torso.position.y = HIP_Y;
    root.add(torso);

    var bodice = new THREE.Mesh(organicSphere(THREE, 0.215, 24, 18, 0.006, 1337), materials.dress);
    bodice.scale.set(1.0, 1.18, 0.82);
    bodice.position.y = TORSO_HEIGHT * 0.46;
    torso.add(bodice);

    // Flared skirt.
    var skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.34, 0.26, 24, 1, true), materials.dress);
    skirt.position.y = 0.06;
    skirt.material = materials.dress.clone();
    skirt.material.side = THREE.DoubleSide;
    torso.add(skirt);

    // Apron: a slightly larger front panel, so it reads as layered, not painted on.
    var apronShape = new THREE.Shape();
    apronShape.moveTo(-0.14, 0.24);
    apronShape.lineTo(0.14, 0.24);
    apronShape.quadraticCurveTo(0.20, -0.02, 0.16, -0.16);
    apronShape.quadraticCurveTo(0, -0.21, -0.16, -0.16);
    apronShape.quadraticCurveTo(-0.20, -0.02, -0.14, 0.24);
    var apron = new THREE.Mesh(
      new THREE.ExtrudeGeometry(apronShape, { depth: 0.02, bevelEnabled: false, curveSegments: 8 }),
      materials.apron
    );
    apron.position.set(0, 0.16, 0.185);
    apron.rotation.x = -0.06;
    torso.add(apron);

    // Whale emblem on the apron: a white disc with a blue fluke mark in front of
    // it. The fluke's blade runs along +y, so rotating it π turns the tips
    // downward and scaling it fits inside the disc.
    var emblem = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), materials.apron);
    emblem.position.set(0, 0.185, 0.222);
    torso.add(emblem);

    var emblemFluke = new THREE.Mesh(flukeGeometry(THREE, 0.05, 0.075, 0.005), materials.emblem);
    emblemFluke.position.set(0, 0.207, 0.226);
    emblemFluke.rotation.z = Math.PI;
    torso.add(emblemFluke);

    // Collar + bow at the neckline.
    var collar = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.022, 8, 24), materials.apron);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = TORSO_HEIGHT - 0.03;
    torso.add(collar);

    var bow = new THREE.Group();
    bow.name = 'bow';
    bow.position.set(0, TORSO_HEIGHT - 0.055, 0.145);
    for (var bowSide = -1; bowSide <= 1; bowSide += 2) {
      var loop = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), materials.bow);
      loop.scale.set(1.25, 0.72, 0.5);
      loop.position.x = bowSide * 0.062;
      loop.rotation.z = bowSide * 0.4;
      bow.add(loop);
    }
    var knot = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), materials.bow);
    bow.add(knot);
    torso.add(bow);

    // --- arms ------------------------------------------------------------
    var arms = {};
    for (var armSide = -1; armSide <= 1; armSide += 2) {
      var arm = new THREE.Group();
      arm.name = armSide < 0 ? 'armL' : 'armR';
      arm.position.set(armSide * 0.205, TORSO_HEIGHT * 0.78, 0);

      var sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.10, 4, 12), materials.dress);
      sleeve.position.y = -0.07;
      arm.add(sleeve);

      var forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.10, 4, 10), materials.skin);
      forearm.position.y = -0.185;
      arm.add(forearm);

      var hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), materials.skin);
      hand.scale.set(1, 1.1, 0.8);
      hand.position.y = -0.255;
      arm.add(hand);

      // Relaxed natural arm angle: the approved F01 pose has relaxed hands, so
      // the placeholder keeps them near the body rather than out at a T-pose.
      arm.rotation.z = armSide * 0.16;
      arm.rotation.x = 0.06;

      arm.traverse(function (child) { if (child.isMesh) markMesh(child, 'arm'); });
      torso.add(arm);
      arms[armSide < 0 ? 'L' : 'R'] = arm;
    }

    // --- head ------------------------------------------------------------
    var head = new THREE.Group();
    head.name = 'head';
    head.position.y = HEAD_Y;
    root.add(head);

    var skull = new THREE.Mesh(organicSphere(THREE, HEAD_RADIUS, 28, 22, 0.004, 4242), materials.skin);
    skull.scale.set(1.0, 0.98, 0.96);
    head.add(skull);

    // Back hair mass, then a separate bang cap in front: two shells read as
    // layered hair instead of a helmet.
    var backHair = new THREE.Mesh(organicSphere(THREE, HEAD_RADIUS * 1.075, 26, 20, 0.005, 909), materials.hair);
    backHair.scale.set(1.02, 1.06, 1.04);
    backHair.position.set(0, -0.012, -0.028);
    head.add(backHair);

    var bangs = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS * 1.055, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), materials.hair);
    bangs.position.set(0, 0.014, 0.006);
    head.add(bangs);

    // Ahoge: the single curved antenna strand.
    var ahogeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.01, HEAD_RADIUS * 0.92, -0.02),
      new THREE.Vector3(0.03, HEAD_RADIUS * 1.30, 0.02),
      new THREE.Vector3(-0.02, HEAD_RADIUS * 1.52, 0.12),
      new THREE.Vector3(-0.06, HEAD_RADIUS * 1.58, 0.24),
    ]);
    var ahoge = new THREE.Mesh(new THREE.TubeGeometry(ahogeCurve, 18, 0.013, 6, false), materials.hair);
    head.add(ahoge);

    // Long side locks, each a two-link chain so the idle can add follow-through.
    var hairChains = {};
    for (var hairSide = -1; hairSide <= 1; hairSide += 2) {
      var lock1 = new THREE.Group();
      lock1.name = hairSide < 0 ? 'hairL' : 'hairR';
      lock1.position.set(hairSide * HEAD_RADIUS * 0.86, -HEAD_RADIUS * 0.18, -0.04);
      var strand1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.20, 5, 12), materials.hair);
      strand1.position.y = -0.13;
      strand1.scale.set(1, 1, 0.72);
      lock1.add(strand1);

      var lock2 = new THREE.Group();
      lock2.name = hairSide < 0 ? 'hairL2' : 'hairR2';
      lock2.position.y = -0.26;
      var strand2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 5, 12), materials.hairTip);
      strand2.position.y = -0.10;
      strand2.scale.set(1, 1, 0.72);
      lock2.add(strand2);
      lock1.add(lock2);

      head.add(lock1);
      hairChains[hairSide < 0 ? 'L' : 'R'] = [lock1, lock2];
    }

    // Maid headband: a white band with a small ruffle.
    var headband = new THREE.Mesh(new THREE.TorusGeometry(HEAD_RADIUS * 0.99, 0.022, 8, 28, Math.PI * 1.1), materials.apron);
    headband.rotation.set(Math.PI / 2 - 0.35, 0, Math.PI - Math.PI * 0.55);
    headband.position.y = HEAD_RADIUS * 0.36;
    head.add(headband);
    for (var ruffle = -2; ruffle <= 2; ruffle++) {
      var frill = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), materials.apron);
      frill.scale.set(1, 0.7, 1);
      frill.position.set(0, HEAD_RADIUS * 0.62, HEAD_RADIUS * (0.82 - Math.abs(ruffle) * 0.10));
      frill.position.x = ruffle * 0.045;
      head.add(frill);
    }

    // Whale-fin ears: two-link chains so they can flap with follow-through.
    var earChains = {};
    for (var earSide = -1; earSide <= 1; earSide += 2) {
      var ear1 = new THREE.Group();
      ear1.name = earSide < 0 ? 'earL' : 'earR';
      ear1.position.set(earSide * HEAD_RADIUS * 0.92, HEAD_RADIUS * 0.20, -0.02);
      ear1.rotation.y = earSide * -0.35;

      // The fin blade runs along local +y; rotating about z by -earSide*π/2 aims
      // that +y outward along ±x, so the ear sweeps sideways off the head. The
      // extra 0.25 rad pulls the tip slightly upward, as in the reference art.
      ear1.rotation.z = -earSide * (Math.PI / 2 - 0.25);

      var blade = new THREE.Mesh(finGeometry(THREE, 0.20, 0.115, 0.016), materials.fin);
      blade.position.z = 0.008;
      ear1.add(blade);

      var ear2 = new THREE.Group();
      ear2.name = earSide < 0 ? 'earL2' : 'earR2';
      ear2.position.y = 0.185;
      var blade2 = new THREE.Mesh(finGeometry(THREE, 0.11, 0.07, 0.012), materials.finInner);
      ear2.add(blade2);
      ear1.add(ear2);

      head.add(ear1);
      earChains[earSide < 0 ? 'L' : 'R'] = [ear1, ear2];
    }

    // Eyes: a dark almond with a highlight, flat-on so they read at small sizes.
    for (var eyeSide = -1; eyeSide <= 1; eyeSide += 2) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), materials.eye);
      eye.scale.set(0.72, 1.05, 0.42);
      eye.position.set(eyeSide * 0.10, -0.012, HEAD_RADIUS * 0.94);
      head.add(eye);

      var shine = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), materials.shine);
      shine.position.set(eyeSide * 0.10 + 0.014, 0.018, HEAD_RADIUS * 0.975);
      head.add(shine);
    }

    // Mouth: a tiny smile.
    var mouthCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.032, -0.10, HEAD_RADIUS * 0.96),
      new THREE.Vector3(0, -0.125, HEAD_RADIUS * 0.99),
      new THREE.Vector3(0.032, -0.10, HEAD_RADIUS * 0.96)
    );
    var mouth = new THREE.Mesh(new THREE.TubeGeometry(mouthCurve, 10, 0.006, 5, false), materials.eye);
    head.add(mouth);

    var blushMaterial = toon(0xf0a0a8);
    for (var blushSide = -1; blushSide <= 1; blushSide += 2) {
      var blush = new THREE.Mesh(new THREE.CircleGeometry(0.033, 14), blushMaterial);
      blush.position.set(blushSide * 0.165, -0.058, HEAD_RADIUS * 0.90);
      blush.rotation.y = blushSide * 0.5;
      head.add(blush);
    }

    // --- whale tail ------------------------------------------------------
    // Three links so the idle can produce the requested "root leads, mid lags,
    // tip lags more" follow-through without any physics.
    var tail1 = new THREE.Group();
    tail1.name = 'tail';
    tail1.position.set(0, HIP_Y + 0.10, -0.20);
    tail1.rotation.x = 0.62;

    var tailBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.14, 4, 12), materials.tail);
    tailBody.position.y = 0.11;
    tailBody.scale.set(1, 1, 0.85);
    tail1.add(tailBody);

    var tail2 = new THREE.Group();
    tail2.name = 'tail2';
    tail2.position.y = 0.20;
    var tailMid = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 12), materials.tail);
    tailMid.position.y = 0.09;
    tail2.add(tailMid);

    var tail3 = new THREE.Group();
    tail3.name = 'tail3';
    tail3.position.y = 0.16;
    // The fluke blade spans local x (width) and runs along +y (length), so it
    // simply continues the chain's direction. It is nudged off the axis and
    // widened so the tail reads as a whale's, not as a spear point.
    var fluke = new THREE.Mesh(flukeGeometry(THREE, 0.24, 0.19, 0.022), materials.tailTip);
    fluke.position.y = 0.02;
    tail3.add(fluke);
    tail2.add(tail3);
    tail1.add(tail2);
    root.add(tail1);

    var parts = {
      head: head,
      torso: torso,
      armL: arms.L,
      armR: arms.R,
      tail: tail1,
      earL: earChains.L[0],
      earR: earChains.R[0],
      hairL: hairChains.L[0],
      hairR: hairChains.R[0],
      bodice: bodice,
      bow: bow,
    };

    var chains = {
      tail: [tail1, tail2, tail3],
      earL: earChains.L,
      earR: earChains.R,
      hairL: hairChains.L,
      hairR: hairChains.R,
    };

    // Capture the rest pose so the idle can add deltas rather than overwrite it.
    var rest = captureRest(chains, parts);

    root.updateMatrixWorld(true);
    return {
      root: root,
      parts: parts,
      chains: chains,
      chainSpread: CHAIN_SPREAD,
      rest: rest,
      materials: materials,
      /** Nominal height, used as a sanity value; computeFraming measures the real box. */
      height: HEAD_Y + HEAD_RADIUS,
    };
  }

  /** Record every animated node's rest rotation so idle motion can be additive. */
  function captureRest(chains, parts) {
    var rest = {};
    Object.keys(chains).forEach(function (name) {
      rest[name] = chains[name].map(function (node) {
        return { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
      });
    });
    rest.head = { x: parts.head.rotation.x, y: parts.head.rotation.y, z: parts.head.rotation.z };
    rest.torso = { x: parts.torso.rotation.x, y: parts.torso.rotation.y, z: parts.torso.rotation.z };
    return rest;
  }

  function markMesh(mesh, role) {
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.userData.vrmpet3dDevRole = role;
  }

  /**
   * A tiny colour ramp for MeshToonMaterial.
   *
   * `NearestFilter` is essential: with linear filtering the bands blur back into
   * ordinary smooth shading and the cel look is lost.
   */
  function createGradientMap(THREE) {
    if (!THREE || !THREE.DataTexture) return undefined;
    var steps = new Uint8Array([80, 140, 200, 255]);
    var texture = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  var VrmPet3DDevPlaceholder = {
    PALETTE: PALETTE,
    CHAINS: CHAINS,
    CHAIN_SPREAD: CHAIN_SPREAD,
    build: build,
    createGradientMap: createGradientMap,
    flukeGeometry: flukeGeometry,
    finGeometry: finGeometry,
    ease: ease,
  };

  globalThis.__VRMPET3D_DEV_PLACEHOLDER__ = VrmPet3DDevPlaceholder;
  if (typeof module !== 'undefined' && module.exports) module.exports = VrmPet3DDevPlaceholder;
})();

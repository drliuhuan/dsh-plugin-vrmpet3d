// Browser test body for the pet3d 3D stack, inlined by scripts/verify-browser.mjs.
//
// This is the part that cannot be checked under Node: that the placeholder
// builds real geometry, that computeFraming on the MEASURED box produces a sane
// transform, that a WebGL render of the real scene produces non-empty pixels,
// and that the official VRM and MMD loader paths construct against real buffers.
(function () {
  var report = { ok: false, checks: [], errors: [] };

  function check(name, fn) {
    try {
      var value = fn();
      var ok = value !== false && value !== undefined && value !== null;
      report.checks.push({ name: name, ok: ok, value: String(value) });
      return value;
    } catch (error) {
      report.checks.push({ name: name, ok: false, value: 'threw: ' + (error && error.message) });
      report.errors.push(name + ': ' + (error && error.message));
      return undefined;
    }
  }

  var V = globalThis.__PET3D_VENDOR__;
  var P = globalThis.__PET3D_PLACEHOLDER__;
  var C = globalThis.__PET3D_CORE__;
  var THREE = V && V.THREE;

  check('vendor present', function () { return Boolean(V && P && C); });
  if (!V || !P || !C) {
    finish();
    return;
  }

  // -------------------------------------------------------------------------
  check('placeholder builds', function () {
    var avatar = P.build(THREE);
    globalThis.__avatar = avatar;
    return Boolean(avatar.root && avatar.parts && avatar.chains);
  });

  var avatar = globalThis.__avatar;
  if (!avatar) { finish(); return; }

  check('placeholder has real geometry', function () {
    var meshes = 0;
    var vertices = 0;
    avatar.root.traverse(function (node) {
      if (node.isMesh && node.geometry && node.geometry.attributes.position) {
        meshes += 1;
        vertices += node.geometry.attributes.position.count;
      }
    });
    report.avatar = { meshes: meshes, vertices: vertices };
    return meshes >= 25 && vertices > 2000;
  });

  check('measured bounding box is sane', function () {
    var box = new THREE.Box3().setFromObject(avatar.root);
    var size = box.getSize(new THREE.Vector3());
    report.measuredBox = {
      min: [+box.min.x.toFixed(4), +box.min.y.toFixed(4), +box.min.z.toFixed(4)],
      max: [+box.max.x.toFixed(4), +box.max.y.toFixed(4), +box.max.z.toFixed(4)],
      size: [+size.x.toFixed(4), +size.y.toFixed(4), +size.z.toFixed(4)],
    };
    // Feet at ~0, head at ~1.0-1.6, and not degenerate in any axis.
    return size.y > 0.8 && size.y < 3 && size.x > 0.15 && size.z > 0.1 && Math.abs(box.min.y) < 0.05;
  });

  check('computeFraming places the measured model on the floor', function () {
    var box = new THREE.Box3().setFromObject(avatar.root);
    var framing = C.computeFraming(box, { viewportHeight: 1, heightFraction: 0.8 });
    report.framing = {
      scale: +framing.scale.toFixed(4),
      scaledHeight: +framing.scaled.y.toFixed(4),
      localOffset: [+framing.offset.x.toFixed(4), +framing.offset.y.toFixed(4), +framing.offset.z.toFixed(4)],
      worldOffset: [+framing.worldOffset.x.toFixed(4), +framing.worldOffset.y.toFixed(4), +framing.worldOffset.z.toFixed(4)],
    };
    var distance = C.computeCameraDistance(box, framing.scale, 30, 1.15);
    report.cameraDistance = +distance.toFixed(4);

    // Two supported transform orders, both of which must land the feet on y=0
    // and the centre on x=z=0, and both must fill exactly the requested fraction.
    //
    //   A: outer node scales, inner node carries the LOCAL offset
    //   B: one node carries both, using the pre-scaled worldOffset
    //
    // B is the case that broke first: three.js composes T · R · S, so the local
    // offset on a scaled node is NOT scaled, and the pet sinks by
    // box.min.y * (1 - scale). Check A alone would not have caught it.
    function stage(useWorldOffset) {
      var outer = new THREE.Group();
      var inner = avatar.root.clone(true);
      outer.add(inner);
      var scaleTarget = useWorldOffset ? inner : outer;
      var offsetTarget = inner;
      scaleTarget.scale.setScalar(framing.scale);
      offsetTarget.position.set(
        useWorldOffset ? framing.worldOffset.x : framing.offset.x,
        useWorldOffset ? framing.worldOffset.y : framing.offset.y,
        useWorldOffset ? framing.worldOffset.z : framing.offset.z
      );
      outer.updateMatrixWorld(true);
      // precise=false, because that is the path computeFraming measures with.
      // precise=true transforms every vertex individually and can disagree by a
      // few millimetres; comparing across the two paths invents a framing error.
      return new THREE.Box3().setFromObject(inner, false);
    }

    function describe(framed) {
      var size = framed.getSize(new THREE.Vector3());
      return {
        minY: +framed.min.y.toFixed(5),
        height: +size.y.toFixed(5),
        centreX: +((framed.min.x + framed.max.x) / 2).toFixed(5),
        centreZ: +((framed.min.z + framed.max.z) / 2).toFixed(5),
      };
    }

    var orderA = stage(false);
    var orderB = stage(true);
    report.orderA = describe(orderA);
    report.orderB = describe(orderB);

    // Feet exactly on the floor and the model exactly the requested fraction of
    // the viewport are exact consequences of the maths, so they are held tight.
    // Centring is only as exact as the measured box, so it gets a looser bound:
    // 1 mm on a 1.44-unit model.
    function isPlaced(framed) {
      var size = framed.getSize(new THREE.Vector3());
      return Math.abs(framed.min.y) < 1e-6 &&
        Math.abs(size.y - 0.8) < 1e-6 &&
        Math.abs((framed.min.x + framed.max.x) / 2) < 1e-3 &&
        Math.abs((framed.min.z + framed.max.z) / 2) < 1e-3;
    }

    report.orderAOk = isPlaced(orderA);
    report.orderBOk = isPlaced(orderB);
    return isPlaced(orderA) && isPlaced(orderB);
  });

  check('idle motion moves the chains and returns to rest', function () {
    var poses = [];
    for (var i = 0; i < 9; i++) poses.push(C.idlePose(i * 0.5, 'resting', { periodSeconds: 4, swayAmplitude: 0.2 }));
    var yaws = poses.map(function (p) { return p.yaw; });
    var spread = Math.max.apply(null, yaws) - Math.min.apply(null, yaws);
    var loops = Math.abs(C.idlePose(0, 'resting', { periodSeconds: 4, swayAmplitude: 0.2 }).yaw -
      C.idlePose(4, 'resting', { periodSeconds: 4, swayAmplitude: 0.2 }).yaw);
    report.idleSwing = { spread: +spread.toFixed(4), loopSeam: +loops.toFixed(12) };
    return spread > 0.05 && loops < 1e-9;
  });

  check('every animation chain node exists', function () {
    var missing = [];
    Object.keys(P.CHAINS).forEach(function (name) {
      var nodes = avatar.chains[name];
      if (!Array.isArray(nodes) || !nodes.length) { missing.push(name + ':empty'); return; }
      nodes.forEach(function (node, index) {
        if (!node || !node.isObject3D) missing.push(name + '[' + index + ']');
      });
    });
    report.chains = Object.keys(P.CHAINS).map(function (name) {
      return name + '=' + avatar.chains[name].length;
    }).join(',');
    return missing.length === 0;
  });

  // -------------------------------------------------------------------------
  check('WebGL scene renders a visible silhouette', function () {
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    document.body.appendChild(canvas);

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    var scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    var key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(1.5, 2.5, 2.0);
    scene.add(key);

    var box = new THREE.Box3().setFromObject(avatar.root);
    var framing = C.computeFraming(box, { viewportHeight: 1, heightFraction: 0.8 });
    var staged = avatar.root.clone(true);
    staged.scale.setScalar(framing.scale);
    staged.position.set(framing.offset.x, framing.offset.y, framing.offset.z);
    scene.add(staged);

    var camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    var distance = C.computeCameraDistance(box, framing.scale, 30, 1.15);
    camera.position.set(0, framing.scaled.y * 0.55, distance);
    camera.lookAt(0, framing.scaled.y * 0.5, 0);

    renderer.render(scene, camera);

    // Read the framebuffer back and count covered pixels. `toDataURL` alone
    // would report success for a fully transparent frame, which is exactly the
    // failure this check exists to catch.
    var gl = renderer.getContext();
    var pixels = new Uint8Array(256 * 256 * 4);
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    var covered = 0;
    var opaque = 0;
    for (var i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 8) {
        covered += 1;
        if (pixels[i + 3] > 250) opaque += 1;
      }
    }
    report.render = {
      coveredPixels: covered,
      coveragePercent: +(covered / (256 * 256) * 100).toFixed(2),
      fullyOpaque: opaque,
    };
    // A framed character should fill a meaningful part of the frame: not blank,
    // and not the whole canvas (which would mean the camera is inside the model).
    return covered > 256 * 256 * 0.05 && covered < 256 * 256 * 0.92 && opaque > 500;
  });

  // -------------------------------------------------------------------------
  // GLTFLoader.register only STORES the factory; it is invoked per parse. So this
  // check must not expect the plugin to exist yet — an earlier revision did, and
  // reported a false failure.
  check('VRM loader plugin constructs and GLTFLoader accepts its factory', function () {
    var loader = new V.addons.GLTFLoader();
    loader.register(function (parser) { return new V.VRM.VRMLoaderPlugin(parser); });
    var plugin = new V.VRM.VRMLoaderPlugin({ json: {}, options: {} });
    report.vrmPlugin = plugin && plugin.name ? plugin.name : typeof plugin;
    return typeof V.VRM.VRMLoaderPlugin === 'function' && plugin !== null && plugin !== undefined;
  });

  check('VRMUtils exposes the required cleanup helpers', function () {
    // These are the documented VRM hygiene helpers applied after load. If a
    // three-vrm upgrade renamed one, this fails here instead of the pet silently
    // rendering with duplicated vertices or a z-fighting avatar.
    return typeof V.VRM.VRMUtils.removeUnnecessaryVertices === 'function' &&
      typeof V.VRM.VRMUtils.combineSkeletons === 'function' &&
      typeof V.VRM.VRMUtils.rotateVRM0 === 'function';
  });

  check('GLTFLoader parses a real minimal glTF document', function () {
    // A complete, valid glTF with one triangle, handed to the real parser through
    // a data: URL so no network and no fixtures on disk are needed.
    var gltf = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{
        byteLength: 36,
        uri: 'data:application/octet-stream;base64,' + btoa(String.fromCharCode.apply(null, (function () {
          var values = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
          var bytes = new Uint8Array(values.buffer);
          var list = [];
          for (var i = 0; i < bytes.length; i++) list.push(bytes[i]);
          return list;
        })())),
      }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    };
    globalThis.__gltfSource = JSON.stringify(gltf);
    globalThis.__gltfResult = 'pending';
    new V.addons.GLTFLoader().load(
      'data:model/gltf+json;base64,' + btoa(globalThis.__gltfSource),
      function (result) {
        var mesh = null;
        result.scene.traverse(function (node) { if (node.isMesh) mesh = node; });
        globalThis.__gltfResult = mesh ? 'mesh:' + mesh.geometry.attributes.position.count : 'no-mesh';
      },
      undefined,
      function (error) { globalThis.__gltfResult = 'error:' + (error && error.message); }
    );
    return true;
  });

  check('MMDLoader assembly path is reachable', function () {
    var loader = new V.MMD.MMDLoader();
    // assembleMMD is the format-agnostic assembly step; the PMX parse in front of
    // it needs a real binary file, which is what verify-pmx.mjs supplies. Here we
    // only assert the assembly entry point exists and is callable.
    return typeof loader.assembleMMD === 'function' && typeof loader.load === 'function';
  });

  finish();

  function finish() {
    // The glTF parse is asynchronous, so wait one macrotask before reporting.
    setTimeout(function () {
      report.checks.push({
        name: 'GLTFLoader parsed the minimal glTF',
        ok: globalThis.__gltfResult === 'mesh:3',
        value: String(globalThis.__gltfResult),
      });
      report.ok = report.checks.every(function (c) { return c.ok; });
      document.getElementById('out').textContent = JSON.stringify(report);
      document.title = report.ok ? 'BROWSER-OK' : 'BROWSER-FAIL';
    }, 400);
  }
})();

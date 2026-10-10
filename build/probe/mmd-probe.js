// Browser probe: load a REAL PMD/PMX model through the full MMD pipeline,
// including its sibling texture files, and measure the result.
//
// Run: node scripts/verify-browser.mjs --page mmd-probe
//
// This is the check that cannot be done in Node: three's TextureLoader needs a
// real `document` to create an <img>, so the material path only works in a
// browser engine. The fixture is served relative to this page.
(function () {
  var report = { checks: [], errors: [] };
  var V = globalThis.__PET3D_VENDOR__;
  var C = globalThis.__PET3D_CORE__;
  var THREE = V && V.THREE;

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

  function finish() {
    report.ok = report.checks.length > 0 && report.checks.every(function (c) { return c.ok; });
    var out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(report);
    document.title = report.ok ? 'MMD-OK' : 'MMD-FAIL';
  }

  check('vendor and core present', function () { return Boolean(V && C); });
  if (!V || !C) { finish(); return; }

  // The model is supplied by scripts/verify-browser.mjs as
  // `globalThis.__PET3D_PMD_BASE64__`, read from build/fixtures/. It is inlined
  // rather than fetched because a `file://` page in this Chromium cannot read a
  // sibling binary, and an object URL cannot be handed a local file either.
  var base64 = globalThis.__PET3D_PMD_BASE64__;
  check('a model payload was supplied', function () { return typeof base64 === 'string' && base64.length > 1000; });
  if (typeof base64 !== 'string') { finish(); return; }

  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  var format = C.detectFormat(bytes.buffer);
  check('format detected from magic bytes', function () { return format === 'pmd' || format === 'pmx'; });
  report.format = format;
  report.bytes = bytes.length;

  var blob = new Blob([bytes], { type: 'application/octet-stream' });
  var blobUrl = URL.createObjectURL(blob);
  var resourcePath = blobUrl.slice(0, blobUrl.lastIndexOf('/') + 1);

  var loader = new V.MMD.MMDLoader();
  loader.setPath('');
  loader.resourcePath = resourcePath;

  loader.load(blobUrl, function (result) {
    var mesh = result.mesh;
    report.mesh = {
      isSkinnedMesh: mesh.isSkinnedMesh,
      positions: mesh.geometry.attributes.position.count,
      triangles: mesh.geometry.index ? mesh.geometry.index.count / 3 : 0,
      bones: mesh.skeleton ? mesh.skeleton.bones.length : 0,
      morphTargets: mesh.geometry.morphAttributes.position ? mesh.geometry.morphAttributes.position.length : 0,
    };

    check('is a skinned mesh', function () { return mesh.isSkinnedMesh === true; });
    check('has real geometry', function () { return mesh.geometry.attributes.position.count > 1000; });
    check('has a skeleton', function () { return Boolean(mesh.skeleton) && mesh.skeleton.bones.length > 10; });
    check('has triangles', function () { return Boolean(mesh.geometry.index) && mesh.geometry.index.count > 3000; });
    check('has morph targets', function () {
      return Boolean(mesh.geometry.morphAttributes.position) && mesh.geometry.morphAttributes.position.length > 0;
    });

    var materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    var withMap = materials.filter(function (m) { return Boolean(m && m.map); }).length;
    report.materials = { count: materials.length, withMap: withMap, firstType: materials[0] && materials[0].type };
    check('materials were built', function () { return materials.length > 0; });

    // Measured exactly as the scene does; the framing maths then has to stand it
    // on the floor.
    var box = new THREE.Box3().setFromObject(mesh, false);
    var size = box.getSize(new THREE.Vector3());
    report.bbox = {
      min: [+box.min.x.toFixed(4), +box.min.y.toFixed(4), +box.min.z.toFixed(4)],
      size: [+size.x.toFixed(4), +size.y.toFixed(4), +size.z.toFixed(4)],
    };
    check('measurable human-sized box', function () {
      return size.y > 1 && size.y < 30 && size.x > 0.1 && Number.isFinite(box.min.y);
    });

    var framing = C.computeFraming(box, { viewportHeight: 1, heightFraction: 0.62 });
    report.framing = {
      scale: +framing.scale.toFixed(5),
      worldOffsetY: +framing.worldOffset.y.toFixed(5),
    };
    check('framing stands it on the floor', function () {
      var framedMinY = box.min.y * framing.scale + framing.worldOffset.y;
      return Math.abs(framedMinY) < 1e-6;
    });
    check('framing reaches the requested height fraction', function () {
      return Math.abs(framing.scaled.y - 0.62) < 1e-6;
    });

    // Render it, and prove the frame is not blank.
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    document.body.appendChild(canvas);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    var scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    var key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(2, 4, 3);
    scene.add(key);
    mesh.scale.setScalar(framing.scale);
    mesh.position.set(framing.worldOffset.x, framing.worldOffset.y, framing.worldOffset.z);
    scene.add(mesh);
    var camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    var distance = C.computeCameraDistance(box, framing.scale, 30, 1.22);
    camera.position.set(0, framing.scaled.y * 0.55, distance);
    camera.lookAt(0, framing.scaled.y * 0.5, 0);
    renderer.render(scene, camera);

    var gl = renderer.getContext();
    var pixels = new Uint8Array(256 * 256 * 4);
    gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    var covered = 0;
    for (var p = 0; p < pixels.length; p += 4) if (pixels[p + 3] > 8) covered += 1;
    report.render = { covered: covered, percent: +(covered / (256 * 256) * 100).toFixed(2) };
    check('renders a visible silhouette', function () {
      return covered > 256 * 256 * 0.05 && covered < 256 * 256 * 0.95;
    });

    finish();
  }, undefined, function (error) {
    report.errors.push('load: ' + (error && (error.message || error)));
    check('model loaded', function () { return false; });
    finish();
  });
})();

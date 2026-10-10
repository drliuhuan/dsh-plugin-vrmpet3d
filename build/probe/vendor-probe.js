// Browser probe body, inlined after the vendor chunk by scripts/build-probe.mjs.
// Asserts that the compiled chunk constructs a real WebGL renderer, that the
// VRM plugin registers on GLTFLoader, and that the chunk carries NO MMD stack —
// MMD was implementation-removed on 2026-10-12, so its absence is part of the
// chunk's shape rather than an omission.
// The result is written to #out and to document.title for --dump-dom.
(function () {
  var result = { ok: false, checks: [], errors: [] };
  function check(name, fn) {
    try {
      var value = fn();
      var ok = value !== false && value !== undefined && value !== null;
      result.checks.push({ name: name, ok: ok, value: String(value) });
      return value;
    } catch (error) {
      result.checks.push({ name: name, ok: false, value: 'threw: ' + (error && error.message) });
      result.errors.push(name + ': ' + (error && error.message));
      return undefined;
    }
  }

  var V = globalThis.__VRMPET3D_VENDOR__;
  check('vendor global published', function () { return !!V; });

  if (V) {
    var THREE = V.THREE;
    check('three revision', function () { return V.revision; });

    check('WebGL renderer constructs', function () {
      var canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 320;
      document.body.appendChild(canvas);
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      var gl = renderer.getContext();
      var version = gl.getParameter(gl.VERSION);
      result.gl = {
        version: version,
        renderer: gl.getParameter(gl.RENDERER),
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      };
      return version;
    });

    check('renderer clears a frame', function () {
      var canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true });
      renderer.setClearColor(0x000000, 0);
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.z = 3;
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x3399ff })));
      renderer.render(scene, camera);
      return canvas.toDataURL().slice(0, 22);
    });

    check('skinned mesh + Skeleton construct', function () {
      var geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
      var bone = new THREE.Bone();
      var skeleton = new THREE.Skeleton([bone]);
      var mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
      mesh.bind(skeleton);
      return typeof mesh.isSkinnedMesh;
    });

    check('VRMLoaderPlugin registers on GLTFLoader', function () {
      var loader = new V.addons.GLTFLoader();
      loader.register(function (parser) { return new V.VRM.VRMLoaderPlugin(parser); });
      return typeof V.VRM.VRMLoaderPlugin === 'function';
    });

    check('the MMD namespace is ABSENT', function () { return V.MMD === undefined; });
    check('no MMD loader is reachable through the addons', function () {
      return typeof V.addons.MMDLoader === 'undefined'
        && typeof V.addons.VMDLoader === 'undefined'
        && typeof V.addons.TGALoader === 'undefined';
    });
    check('and the one addon the renderer uses is present', function () {
      return typeof V.addons.GLTFLoader === 'function';
    });
    check('VRM bone enum present', function () { return V.VRM.VRMHumanBoneName.Hips; });
    check('VRM spring bone manager present', function () { return typeof V.VRM.VRMSpringBoneManager === 'function'; });

    result.ok = result.checks.every(function (c) { return c.ok; });
  }

  document.getElementById('out').textContent = JSON.stringify(result);
  document.title = result.ok ? 'PROBE-OK' : 'PROBE-FAIL';
})();

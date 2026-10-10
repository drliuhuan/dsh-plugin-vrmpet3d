// Diagnostic: does applying computeFraming to a CLONED placeholder land the
// model's centre on x=z=0, and if not, is it the framing maths or Box3?
//
// Kept in the repo because "the cloned bounding box disagrees with the original"
// is exactly the kind of thing that gets misdiagnosed as a framing bug.
(function () {
  var V = globalThis.__PET3D_VENDOR__;
  var P = globalThis.__PET3D_PLACEHOLDER__;
  var C = globalThis.__PET3D_CORE__;
  var THREE = V.THREE;
  var out = {};

  var avatar = P.build(THREE);
  avatar.root.updateMatrixWorld(true);
  var box = new THREE.Box3().setFromObject(avatar.root);
  var framing = C.computeFraming(box, { viewportHeight: 1, heightFraction: 0.8 });

  out.originalBox = {
    min: [+box.min.x.toFixed(5), +box.min.y.toFixed(5), +box.min.z.toFixed(5)],
    max: [+box.max.x.toFixed(5), +box.max.y.toFixed(5), +box.max.z.toFixed(5)],
  };
  out.centre = [
    +((box.min.x + box.max.x) / 2).toFixed(5),
    +((box.min.z + box.max.z) / 2).toFixed(5),
  ];

  // Walk every mesh and record its own world-space box, so we can find which
  // mesh owns each extreme of the whole-model box.
  var extremes = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  var owners = {};
  avatar.root.traverse(function (node) {
    if (!node.isMesh || !node.geometry) return;
    node.geometry.computeBoundingBox();
    var own = new THREE.Box3().copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    var name = node.name || node.userData.pet3dRole || 'mesh';
    if (own.min.x < extremes.minX) { extremes.minX = own.min.x; owners.minX = name; }
    if (own.max.x > extremes.maxX) { extremes.maxX = own.max.x; owners.maxX = name; }
    if (own.min.z < extremes.minZ) { extremes.minZ = own.min.z; owners.minZ = name; }
    if (own.max.z > extremes.maxZ) { extremes.maxZ = own.max.z; owners.maxZ = name; }
  });
  out.extremes = {
    minX: +extremes.minX.toFixed(5), maxX: +extremes.maxX.toFixed(5),
    minZ: +extremes.minZ.toFixed(5), maxZ: +extremes.maxZ.toFixed(5),
  };
  out.owners = owners;

  // Now stage the framing on a clone in an identity parent, and measure BOTH the
  // clone and (separately) a freshly built avatar, using the same transform.
  function stageClone(run) {
    var outer = new THREE.Group();
    var inner = (run ? P.build(THREE) : { root: avatar.root.clone(true) }).root;
    outer.add(inner);
    inner.scale.setScalar(framing.scale);
    inner.position.set(framing.worldOffset.x, framing.worldOffset.y, framing.worldOffset.z);
    outer.updateMatrixWorld(true);
    return { outer: outer, inner: inner };
  }

  var cloneStage = stageClone(false);
  var cloneInner = cloneStage.inner;
  var handBox = new THREE.Box3();
  cloneInner.traverse(function (node) {
    if (!node.isMesh || !node.geometry) return;
    node.geometry.computeBoundingBox();
    var own = new THREE.Box3().copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    handBox.union(own);
  });
  // Box3.setFromObject has TWO code paths. `precise=false` unions each mesh's
  // cached geometry box transformed by its world matrix; `precise=true`
  // transforms every vertex individually. They can disagree slightly, and mixing
  // them in one comparison produces a phantom framing bug — which is exactly what
  // the first version of this diagnostic did. computeFraming measures the
  // non-precise box, so that is the reading that has to match.
  var loose = new THREE.Box3().setFromObject(cloneInner, false);
  var precise = new THREE.Box3().setFromObject(cloneInner, true);
  out.cloneLoose = { min: +loose.min.z.toFixed(5), max: +loose.max.z.toFixed(5) };
  out.clonePrecise = { min: +precise.min.z.toFixed(5), max: +precise.max.z.toFixed(5) };
  out.cloneHand = { min: +handBox.min.z.toFixed(5), max: +handBox.max.z.toFixed(5) };

  // Scaling an axis-aligned box about an identity origin is exact, so the framed
  // box MUST equal the original box scaled then offset. Report the difference.
  out.expectedFramed = {
    minZ: +(box.min.z * framing.scale + framing.worldOffset.z).toFixed(5),
    maxZ: +(box.max.z * framing.scale + framing.worldOffset.z).toFixed(5),
    minX: +(box.min.x * framing.scale + framing.worldOffset.x).toFixed(5),
    maxX: +(box.max.x * framing.scale + framing.worldOffset.x).toFixed(5),
  };

  // Which mesh owns the staged clone's z extremes?
  var stagedExtremes = { minZ: Infinity, maxZ: -Infinity };
  var stagedOwners = {};
  cloneInner.traverse(function (node) {
    if (!node.isMesh || !node.geometry) return;
    node.geometry.computeBoundingBox();
    var own = new THREE.Box3().copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    var name = node.name || node.userData.pet3dRole || 'mesh';
    if (own.min.z < stagedExtremes.minZ) { stagedExtremes.minZ = own.min.z; stagedOwners.minZ = name; }
    if (own.max.z > stagedExtremes.maxZ) { stagedExtremes.maxZ = own.max.z; stagedOwners.maxZ = name; }
  });
  out.stagedExtremes = {
    minZ: +stagedExtremes.minZ.toFixed(5), maxZ: +stagedExtremes.maxZ.toFixed(5),
  };
  out.stagedOwners = stagedOwners;

  out.worldOffset = [
    +framing.worldOffset.x.toFixed(6),
    +framing.worldOffset.y.toFixed(6),
    +framing.worldOffset.z.toFixed(6),
  ];
  out.localOffset = [
    +framing.offset.x.toFixed(6),
    +framing.offset.y.toFixed(6),
    +framing.offset.z.toFixed(6),
  ];

  document.getElementById('out').textContent = JSON.stringify(out);
  document.title = 'DIAG-DONE';
})();

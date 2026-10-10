# assets/motions — the bundled motion pack

These `.vrma` clips are **authored by this project's operator** and ship with the plugin under the same MIT licence as
the rest of this repository: no third-party terms, no borrowed model data. Each file's own `asset.generator` names the
pipeline that produced it (`text-to-motion`).

They are real VRM animations — a GLB whose JSON chunk carries `VRMC_vrm_animation` 1.0 over 44 humanoid bones — so
`Scene.loadMotion` accepts them as they are.

| file | bytes | channels | drives |
|---|---|---|---|
| `coolIdleGlance.vrma` | 20,644 | 37 | the humanoid rig, plus `J_hips.translation` and the off-rig `E_neutral` / `E_blink` |
| `innocentStandIdle.vrma` | 18,984 | 35 | the humanoid rig, plus `J_hips.translation` and the off-rig `E_relaxed` / `E_blink` |

## Known caveat, measured 2026-10-12

The `E_*` channels are **not on the VRM humanoid rig**, and the reset that puts an avatar back into its rest pose when a
clip stops (`resetAvatarPose` → `humanoid.resetNormalizedPose()` in [lib/scene.js](../../lib/scene.js)) covers only the
humanoid rig — so after playback these clips leave the model **slightly off its rest pose**, which is the "the pet
keeps a leftover pose after a drag" failure this project has fixed once before for another motion format.

[scripts/verify-motion.mjs](../../scripts/verify-motion.mjs) measures exactly that, and it is the tool to re-check any
new clip with:

```bash
node scripts/verify-motion.mjs --model assets/models/SampleModel.vrm --motion assets/motions/coolIdleGlance.vrma
```

Two of its checks fail with these two files — "a drag state drops the clip and returns to the procedural pose" and
"clearMotions() returns the model to its rest pose" — while a humanoid-only clip (the test fixtures in
`build/fixtures/vrma/`) passes all 61. **The same failure reproduces on the pre-rename code**, so it is a property of
the clips, not of the VRM-only rename. The rest of the run is green for both files: the humanoid rig is driven, the
rotations stay finite, and the RAW skinned bone follows the clip.

Two ways out, and they are not exclusive:

* **export the clips without the `E_*` tracks** — they address nodes a VRM humanoid retarget has no use for;
* **make the reset cover the whole skeleton** — snapshot every node's rest transform when an avatar is installed and
  restore it when a clip stops, which is what the removed MMD path used to do for its own skeletons.

## Not wired up yet

The motion catalogue scans the plugin's `config.motionDirs` plus the directories the user imports (通用设置 → 动作导入),
so nothing under `assets/` is offered out of the box. Making this folder a BUNDLED motion source — and mapping some of
these clips to default states — is the next step; the suite that asserts the motion list is
[scripts/verify-model.mjs](../../scripts/verify-model.mjs) group 11 and the client page's own fixtures.

`scripts/make-vrma-fixtures.mjs` is a different thing: it is this repository's own authoring script for the TEST clips
in `build/fixtures/vrma/`, not the source of this pack.

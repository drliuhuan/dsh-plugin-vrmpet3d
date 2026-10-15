# assets/motions — the bundled motion pack

These `.vrma` clips are **authored by this project's operator** and ship with the plugin under the same MIT licence as
the rest of this repository: no third-party terms, no borrowed model data. Each file's own `asset.generator` names the
pipeline that produced it (`text-to-motion`).

They are real VRM animations — a GLB whose JSON chunk carries `VRMC_vrm_animation` 1.0 over 44 humanoid bones — so
`Scene.loadMotion` accepts them as they are.

## The folders ARE the states (operator, 2026-10-12)

> 「把对应的动作直接解析到指定目录，这样在选择动作的时候就不会出现很长一串」

The pack is filed **one folder per state**, and that filing is not a convention — it is the mapping. A folder name
in `stateFolders` below decides which clips a state's box set in 通用设置 → 状态与动作 is offered, so 空闲 shows the
idle clips and 工作中 shows the working ones instead of one list of everything:

| folder | state | 状态名 |
|---|---|---|
| `idle/` | `resting` | 空闲 |
| `working/` | `working` | 工作中 |
| `attention/` | `waiting` | 等待确认 |
| `success/` | `done` | 任务完成 |
| `fail/` | `error` | 出错 |
| `offline/` | `offline` | 离线 |

**`dance/` is deliberately NOT in that table.** It is a holding folder for the operator's dance clips (see
「Compressed clips」 below): the clips are recognised and catalogued, but they belong to **no state** until the
operator says which one, so nothing plays a dance behind their back. Giving the folder to a state is a one-line
edit here — `"resting": ["idle", "dance"]` — and needs no code change.

**This is strict**: a state's picker offers only its own folder's clips. To give a clip to a state, put the file in
that state's folder. A state whose folder is missing or empty says so in the panel rather than showing an empty box
set. A clip that was ticked before the folders existed is still DRAWN in its state, even from another folder,
because hiding a stored mapping would read as losing it.

Renaming a folder is a supported edit: change it here in `stateFolders` too. A state with **no** entry is offered the
**whole** catalogue, which is how every build before this block behaved.

## Compressed clips (`.vrma.br`), and why brotli and not LZMA2

Dance clips are large — the operator's first one is **8,080,556 bytes** — so a dance is stored compressed as
`<name>.vrma.br` and the plugin **unpacks it into memory** on the way to the renderer. Nothing else changes: a
compressed clip is listed as the VRMA it is (the panel marks it 已压缩), and the bytes that reach `Scene.loadMotion`
are always a plain VRMA.

Measured on that clip: `8,080,556 -> 2,836,574 bytes (35.1%)`, byte-identical after unpacking.

**LZMA2 would be about 10% smaller and is NOT supported.** Node's `zlib` cannot decode LZMA — measured 2026-10-12:
`unzipSync` / `inflateSync` / `gunzipSync` all fail with `Z_DATA_ERROR` on a file the reference liblzma wrote — and
this plugin ships with no npm dependencies, so LZMA would mean maintaining a hand-written LZMA2 decoder. One was
written and **did not decode real binary content correctly** (raw chunks and simple streams round-tripped; a real
VRMA diverged on the matched-literal path), so it was never wired in and the operator had it **deleted** rather than
carry unfinished code: a decompressor that returns plausible garbage hands the renderer a malformed model, which is
worse than not supporting the format. Brotli is in Node and in every Chromium the pet runs in, and it costs about
2.8 MB on an 8 MB clip against LZMA2's 2.4 MB.

To compress a clip (the tool uses the same settings the loader is tested against, and refuses to write an archive
that does not decompress back to the same bytes):

```bash
node scripts/compress-motions.mjs assets/motions/dance   # add --dry-run to preview, --quality 0-11 to tune
```

**A compressed file REPLACES the uncompressed one beside it.** If both `x.vrma` and `x.vrma.br` exist in the same
folder, only the archive is catalogued — otherwise one animation would be offered twice, under two names, claiming
8 MB. Delete the archive and the plain clip comes back with no other change.

## The `E_*` channels, and the defect they were blamed for (RESOLVED 2026-10-12)

Every clip here carries one or two `E_*` channels (`E_neutral` / `E_relaxed` / `E_blink`, all `translation`). They are
**not on the VRM humanoid rig**, so `resetAvatarPose` → `humanoid.resetNormalizedPose()` in
[lib/scene.js](../../lib/scene.js) does not touch them, and on 2026-10-12 they were named as the cause of a measured
"the model keeps a leftover pose after a clip stops".

**That attribution was wrong.** It was disproven by running the probe on the repository's own all-humanoid test clips
in `build/fixtures/vrma/`: `vrmpet3d-wave.vrma` and `vrmpet3d-rest.vrma` contain **no `E_*` track at all** and failed the
same two checks, while `vrmpet3d-test.vrma` — which drives only hips and head, and **no upper arm** — passed all 61.
The real cause was in the plugin, not in these files: `core.aimDownQuaternion` returned a **non-unit axis** (its cross
product's length is `sin(angle)`), so the caller built a non-unit arm quaternion (`|q| = 0.999599`), and the probe's
`Quaternion.angleTo` — which does not normalise — read that length as a **4.59° pose residual**. The pose was always
correct; the measurement was not. Fixed in both places: the maths now returns a unit axis, and the probe compares
rotations rather than quaternion lengths.

**So no clip needs re-exporting for this**, and the whole-skeleton snapshot idea is not required for it either.
The tool reads a clip and a model, serves them to a real browser, and reports 61 checks:

```bash
node scripts/verify-motion.mjs --model assets/models/SampleModel.vrm.br --motion assets/motions/idle/idle.vrma.br
```

Both files are compressed (`.br`), because that is how the pack ships, and the tool unpacks them itself (`lib/brotli.js`) — so
checking a shipped clip needs no manual step.

> ⚠️ **Known broken on 2026-10-15, and not by compression.** On this machine the run ends with
> `page error: Uncaught SyntaxError: missing ) after argument list` before any check is reported. The inlined scripts
> (`lib/client.vendor.js`, `lib/core.js`, `lib/placeholder.js`, `lib/scene.js`) contain no stray `</script`, and the tool's own
> page body parses clean, so the fault is inside the harness that only this tool builds — none of the nine suites runs this file,
> which is why nothing else noticed. It is recorded here rather than silently dropped.

The three files named here before (`coolIdleGlance.vrma`, `idle.vrma` and `innocentStandIdle.vrma`) had already moved into `idle/`
and been packed, and the operator trimmed the first and the last from the pack on 2026-10-15.

That script is the tool to re-check any new clip with, and it is **not** wired into any suite, so nothing else runs it.
What it confirms for each file: the humanoid rig is driven, the rotations stay finite, the RAW skinned bone follows the
clip, and a clip that stops returns the model to its procedural pose and to its rest pose.

## `vrmpet3d-motions.json` — this folder's own manifest

The file beside the clips is what the host reads once per directory, and it declares three things:

```json
{
  "clips": {
    "idle/idle.vrma": { "loop": true },
    "idle/hungry1.vrma": { "loop": false },
    "attention/wave hand 1.vrma": { "loop": true },
    "fail/fall down1.vrma": { "loop": false }
  },
  "stateFolders": {
    "resting": ["idle"],
    "working": ["working"],
    "waiting": ["attention"],
    "done": ["success"],
    "error": ["fail"],
    "offline": ["offline"]
  },
  "defaults": {
    "resting": ["idle/hungry1.vrma", "idle/idle.vrma"],
    "waiting": ["attention/wave hand 1.vrma"]
  }
}
```

(The real file lists every clip the operator has configured, and `defaults` is his own mapping — see below.)

* **`clips`** is the 循环 / 单次 mode of each clip. `loop: false` makes it a one-shot — a reaction, not a posture —
  and the pack carries BOTH kinds: the idle postures loop, the hungry / stretch / look-around / touch-hair / fall-down
  clips are one-shots. A clip named in no entry defaults to `true`, the behaviour every build had before the flag
  existed. **Keys are the path relative to this folder**, so a clip in a subfolder is declared `idle/name.vrma`: a key
  written without its folder silently matches nothing, and the flag would not apply. A compressed clip's key is its
  **file** name, suffix and all (`dance/极乐净土.vrma.br`).

  What the modes MEAN is the renderer's rule (operator, 2026-10-13), and it is one rule in one place
  (`Scene.afterOneShotEnded`, [lib/scene.js](../../lib/scene.js)): when a reaction ends and the state has a looping
  clip, the pet **chains into that loop** (drawn at random); when the state has no loop, the reaction **holds its
  last frame**. A one-shot is never played as a loop. The mode is applied per PLAYBACK, so the same file can be a
  posture in one state and a reaction in another, and a state's own preference wins over this block.
* **`stateFolders`** is the state → folder mapping that keeps each picker short (see the table at the top). A value
  is a folder name **or a list of them**, so one state can be offered several folders
  (`"resting": ["idle", "dance"]`); a bare string is accepted because that is what a person hand-writes, and it is
  normalised to a one-item list. A path, an empty value and a duplicate are dropped.
* **`defaults`** is which clips a user who has configured NOTHING gets, per state:
  `{ "resting": ["idle/idle.vrma"], "working": ["working/typing.vrma"] }`. Keys are state names the session machine
  can reach (`resting` `working` `waiting` `done` `error` `offline` — NOT `sleeping`, which is an internal state
  that folds into `resting`), and values are **file names relative to THIS folder**, never ids: an id is minted
  per profile from the absolute path, so it does not travel, and this file does.

  It ships the OPERATOR'S OWN mapping since 2026-10-13 (「状态与动作：把目前的插件内的配置作为最终默认配置」): the clips
  his profile had ticked per state, translated from his profile's ids to file names. A fresh install therefore
  draws real clips with nothing to configure, and a state the user has configured — including one they
  deliberately cleared — still wins over a default here. `verify-model.mjs` (group 5b) asserts the invariant that
  matters for a hand-edited block: every name it declares resolves to a clip that exists, so a typo cannot ship as
  a state that quietly draws nothing. See `core.motionMapWithDefaults`
  ([lib/core.js](../../lib/core.js)) for the three rules and why they are read-time only.

## How the pack reaches a user

This folder is a **bundled motion source**, scanned first by `buildMotionCatalog`
([lib/index.js](../../lib/index.js)) exactly as `assets/models` is for models, so the clips above are offered
in 通用设置 → 状态与动作 out of the box and are catalogued with `source: 'bundled'`. Nothing needs importing;
`assets` is in `package.json`'s `files[]`, so a packed install carries them. The suites that assert all of this
are [scripts/verify-model.mjs](../../scripts/verify-model.mjs) (group 5b) and, for the defaults rule,
[scripts/verify.mjs](../../scripts/verify.mjs) (the motion-map group).

`scripts/make-vrma-fixtures.mjs` is a different thing: it is this repository's own authoring script for the TEST clips
in `build/fixtures/vrma/`, not the source of this pack.

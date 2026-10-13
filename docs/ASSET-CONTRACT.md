# Asset contract — what the plugin expects from a model file, and what you may ship

## 1. What this repository ships, and why it is so little

Most VRM models distributed online carry terms that **forbid
redistribution**, and many forbid commercial use outright. Committing one into a
plugin repository would make the repository itself undistributable, whatever the
author's intent. So:

* `assets/models/` holds **exactly two model files**, and each one ships for a reason this repository can
  name: `BlueFatFish.vrm` (蓝色小肥鱼Deepseek, by 木子恶魔), the shipped default, **redistributed with its
  author's permission**, and `SampleModel.vrm` (VRoid's ヴィータ), the fallback, whose **own embedded licence**
  grants redistribution. `scripts/check-docs.mjs` asserts which files are there and what each one's basis is,
  so a future swap for a model with neither fails there instead of shipping. Everything else about the
  folder — including the source and author to credit for each — is in
  [`../assets/models/README.md`](../assets/models/README.md).
* **A permission is not a licence.** Where a model ships on its author's consent rather than on terms carried
  inside the file, that consent covers *this* distribution only: the credit (source and author) travels with
  the file, and nothing here re-licenses it for anyone else.
* The **procedurally generated placeholder** avatar is a **fixture, not a fallback**: `usePlaceholder` in
  `lib/scene.js` builds it for the geometry probes and the browser suite, gated on
  `globalThis.__VRMPET3D_PLACEHOLDER__`, which nothing in the shipped plugin defines. A model that fails to
  load reports the failure and leaves the stage exactly as it was — nothing is substituted for it — and a
  catalogue with nothing in it shows no pet and says so. Both of those changed on 2026-10-10, when the
  built-in avatar was removed.
* You point the plugin at your own model files, and you are responsible for their
  terms.

The same rule covers **motion files** (`.vrma`, the only format this build plays — see §5), which are
licensed separately from models.

### A clip may be stored compressed: `<name>.vrma.br` (2026-10-12)

A motion file may also arrive as **`<name>.vrma.br`** — the same VRMA, brotli-compressed. The operator's dance
clips are megabytes (their first is 8.0 MB), so the pack stores them compressed and the **host unpacks them into
memory** on the way to the renderer (`createMotionHandler` in `lib/index.js`, `lib/brotli.js`). Three consequences
worth knowing:

* the clip is still a **`vrma`** to every reader (`core.motionFormatOfName` looks through the suffix), so the format
  sets quoted below are unchanged and the model/motion split is still decided by extension, never by sniffing;
* if both `x.vrma` and `x.vrma.br` sit in one folder, **only the archive is catalogued** — one animation, one entry;
* the compression is **brotli, not LZMA2**, because Node's `zlib` cannot decode LZMA and this plugin has no npm
  dependencies. See `assets/motions/README.md` for the measurements and for
  `scripts/compress-motions.mjs`, which is how a clip is packed.

### MMD is not supported (2026-10-12), and the MMD chapter below is kept as history

This plugin used to load PMX/PMD models and play VMD motions. It does not any more: the operator's
2026-10-12 decision was **VRM (and plain glTF/GLB) only**. `core.MODEL_EXTENSIONS` is
`['.vrm', '.glb', '.gltf']` and `core.MOTION_EXTENSIONS` is `['.vrma']`; the `@moeru/three-mmd` and
`mmd-parser` packages are out of the pinned chunk; and an MMD file is **recognised by its magic bytes and
refused by name** rather than silently ignored:

* a PMX/PMD model — `PMX is not supported: this build loads VRM only (see docs/ASSET-CONTRACT.md).`
* a VMD motion — `motion "<id>" is a VMD, which this build does not play (VRMA only; …)`

Every MMD section of this document is marked **RETIRED** where it appears, rather than deleted, because
the reasoning behind the refusal messages and the licensing rule is still the reason this plugin asks for
VRM files. The MMD-era tooling (`scripts/verify-motion.mjs`, `scripts/make-fixtures.mjs`,
`scripts/make-motion-fixtures.mjs`, `build/probe/mmd-probe.js`) stays on disk but is not wired into any of
the nine suites.

### The one image this plugin draws that it did not make

The 工作中 prompt is DSH's own running label, and that label's mark is DeepSeek's: a 60-frame APNG that the
app embeds in `dsh-client-ui-chat`'s stylesheet and masks `currentColor` through, with a static SVG for
reduced motion, forced colours, or a browser without alpha masks.

It follows the rule above rather than an exception to it. Nothing is committed here: `scripts/whale-asset.mjs`
reads the image out of the **installed** DSH (`resources/app.asar`) into `assets/whale-tail.apng`, the host
serves it from `/vrmpet3d/whale`, and `assets/whale-tail.apng` is excluded from the package's `files` list. A
checkout with no DSH, or one where the script has not been run, has no file and shows the static SVG — the
app's own fallback.

### About the project's own reference model

`Resources/GenerationHistory/VRM-MODEL-REPORT.md` in the parent workspace documents
a specific VRM used during this project's earlier research. Its author's published
distribution rules are: **modification allowed, no commercial use, no
redistribution, no full attribution table required** — while the file's *embedded*
metadata is stricter (`modification: prohibited`). Where the two disagree, that
report recommends the more conservative reading.

The practical consequences for this plugin, unchanged:

| Use | Verdict |
|---|---|
| Using it yourself as your own desktop pet | allowed |
| Installing the plugin privately with that model | allowed |
| **Committing the `.vrm` into this repository** | **no — redistribution** |
| **Shipping rendered frames of it** | **no — also a derived redistribution** |
| Commercial use | no |
| Extracting its meshes/textures to build a *different* model | no |

The plugin needs none of that: it loads a model from wherever **you** keep it, and
never copies it.

## 2. Supported formats

**VRM and plain glTF/GLB only**, since 2026-10-12. The format is detected from the file's **magic bytes**,
not the extension — which is also why an unsupported file can be named rather than merely rejected.

| Format | Magic | Extensions | Loader |
|---|---|---|---|
| VRM 1.0 / 0.x | `glTF` (binary) | `.vrm` | `GLTFLoader` + `VRMLoaderPlugin` |
| glTF / GLB | `glTF` or `{` | `.glb`, `.gltf` | `GLTFLoader` |
| MMD PMX — **RETIRED** | `PMX ` | `.pmx` | *none: refused by name* |
| MMD PMD — **RETIRED** | `Pmd\0` | `.pmd` | *none: refused by name* |

The two retired rows are kept because their magic numbers are still read. A PMX/PMD is not catalogued and
has no loader, but it is **recognised**, so the answer names the format instead of shrugging:

```
PMX is not supported: this build loads VRM only (see docs/ASSET-CONTRACT.md).
```

Anything else is reported as an unrecognised format in the pet's status badge. In no case is a stand-in
avatar substituted for the model you asked for: a failure is reported and the stage is left as it was.

### Compression is not supported

DRACO and KTX2 are **out** — see `ARCHITECTURE.md` §"Known limits". A glTF that
requires either will fail to decode. Uncompressed models are fine.

## 3. What the plugin does to your model

It only ever reads. Nothing is written back, and no model file is copied into the
plugin directory.

| Step | Effect |
|---|---|
| Measure | `Box3.setFromObject(root, false)` over the whole scene |
| Frame | uniform scale so the model is 62 % of the viewport height, feet at y = 0, centred on x/z |
| Orient | VRM 0.x is rotated to face like 1.0 (`VRMUtils.rotateVRM0`) |
| Clean up (VRM) | `removeUnnecessaryVertices` + `combineSkeletons` |
| Texture lookup | sibling files resolve through the plugin's own asset route |
| Light | one hemisphere light, one shadow-casting key light, one fill. No HDR environment |

Your model's own scale and origin are therefore **irrelevant** — a 1.6-metre VRM and a model authored in
centimetres are framed identically. *(RETIRED 2026-10-12: this sentence used to compare a 20-unit MMD model
against a 1.6-metre VRM, verified on a 20.18-unit PMD that framed to exactly the same 62 % as the 1.44-unit
placeholder. Neither an MMD model nor the placeholder is loaded by the shipped plugin any more — see §1 —
so those two measurements are kept as history rather than as a live claim.)*

### Scene requirements

* A model must have **measurable geometry**. A file whose bounding box is empty or
  zero-height is rejected with a message rather than rendering nothing.
* **Transparent textures should use alpha**, not additive blending. *(RETIRED 2026-10-12: this bullet used to
  read "MMD materials are forced to `alphaTest = 0.5` with `transparent = false`, so a hair texture that
  relies on blending will read as opaque" — that forcing lived in the MMD load path, which is gone. What
  survives is the advice, because a VRM's MToon materials keep their own alpha settings and the author is
  still the one who decides them.)*
* **Up axis is +Y and the model should face +Z** (towards the viewer); a model
  authored with a different up axis will appear rotated. *(The parenthetical about MMD models being converted
  from their left-handed coordinate system automatically is RETIRED 2026-10-12 with the loader that did it.)*

## 4. Animation: what is driven, and what is not

The idle is **procedural**, not keyframed. It returns exactly to its starting pose
after one 8-second period, so the loop has no seam. That is the default for every
model, and it needs no asset at all.

**Authored motion is opt-in, VRMA-only, and per state.** You may point the plugin at `.vrma` files and
assign one to each session state; any state you leave alone keeps the procedural idle. The plugin SHIPS one
pack of them in `assets/motions/` (see its own README), and those are catalogued from the first scan — but
they still play only where a state is mapped to them, and the pack's manifest ships that mapping empty. Nothing
is played until you choose something — see "Authored motion" below.

| Model kind | Driven by the plugin | Left alone |
|---|---|---|
| **VRM** | breathing (chest bone lift), head gaze toward the pointer; SpringBone settles hair and tail | the model's bone hierarchy, expressions, look-at |
| **glTF** | whole-body sway, bob, head gaze if a `head` bone is found | — |
| ~~PMX / PMD~~ — **RETIRED** | *used to be:* whole-body sway, bob, head gaze; a bone chain whose name suggests a tail is animated if found | everything else, including MMD IK and grant solving (they are stepped, not authored) |
| ~~Placeholder~~ — **RETIRED** | *used to be:* tail (3 links), ear fins (2 links each), side hair (2 links each), breathing, whole-body sway and bob | — |

The two struck-through rows describe kinds this plugin can no longer load or install (see §1). They are kept
so the table still reads as the history of what was driven.

### Why physics was off for MMD — RETIRED 2026-10-12

> **This section is about models this build does not load.** It is kept because the reasoning is what any
> future physics feature would run into again, and because "no physics" was never a VRM limit.

`@moeru/three-mmd` ships no physics engine and expects the host to supply one (an
`ammo.js` adapter or a spring-bone package). The pet deliberately does not, for two
reasons:

1. **Determinism.** A rigid-body simulation gives different results on two runs of
   the same scene, which makes "did this change break the pet?" unanswerable and
   makes screenshots unreproducible.
2. **Loops.** A physics chain cannot be made to return to its exact starting pose
   after a fixed period, so the idle would have a visible seam.

VRM SpringBone is a different case and **is** enabled: it is a distance-constraint
chain rather than a rigid-body simulation, three-vrm implements it, and the user can
turn it off on the 通用设置 page. (The older text named a "settings panel" and a "Hair
physics" row; that panel was deleted on 2026-10-12 and every preference now lives on one of the two
settings pages.)

### Authored motion: VRMA only, and VMD RETIRED

One format for one avatar family. The `.vmd` row is kept as history — the plugin will not offer it, and a
VMD handed to the renderer is refused by name:

| Format | Drives | Carries | Assigned in |
|---|---|---|---|
| `.vmd` — Vocaloid Motion Data 0002 — **RETIRED 2026-10-12** | PMX / PMD (no longer loaded) | bone names, morph weights, camera and IK data | *nowhere: refused by name* |
| `.vrma` — VRM Animation 1.0 | VRM 1.0 / 0.x | VRM humanoid bone tracks via `VRMC_vrm_animation` | settings, per state |

A `.vmd` cannot drive a VRM — and that is exactly why it is **refused rather than attempted**: VMD addresses
MMD bones by name while VRMA addresses the VRM humanoid bone standard, and there is no correct general
mapping between the two naming schemes. 通用设置 → 状态与动作 therefore lists only the motions that can
actually drive the model you have loaded, and says so when none can.

### The bone-name trap — RETIRED 2026-10-12, kept because it explains why VRMA exists

> **No VMD is played here any more, so this failure cannot happen in this build.** It is kept because it is
> the argument for VRMA addressing the humanoid standard instead of a name list.

**A VMD bound by exact bone name, and unmatched names were dropped silently.** The
MMD loader built one animation track per VMD bone name that existed in the target
skeleton and quietly skipped every name that did not — no warning, no error, nothing
visible in the file. What you got was a clip that loaded successfully, reported a
plausible duration, and animated nothing.

So a motion that played correctly on one model and did nothing on another was almost
always a name mismatch rather than a corrupt file. The usual causes:

* the motion was authored for a different skeleton convention — for example a model
  whose bones are named in English or romanised, against a motion using the
  Japanese names every MMD tool writes;
* a Unicode difference, since the loader compares skeletal bone names literally and
  names that look identical can differ in normalisation;
* a motion authored for a different character whose bone set simply does not
  overlap.

The settings UI reported the number of tracks the clip actually built, so
"0 tracks" was a visible diagnosis instead of a mystery.

### Per-state assignment, and what it does not override

Each of the eight session states — `resting`, `working`, `waiting`, `celebrate`,
`sleeping`, `error`, `greeting`, `offline` — can have its own motion, or none.

`held`, `falling` and `landing` are deliberately **not** configurable. Those poses
belong to the drag physics: a clip that moved the body while it was airborne would
fight the very integration that decides where the pet lands. The pet stays draggable
and throwable while a motion is playing.

A state with no motion assigned behaves exactly as it always has.

### Loops and determinism, with a motion loaded

The determinism argument above is about *idle* motion, which is why the procedural
idle is the default: it loops exactly.

An authored clip is only as loopable as its author made it. If its last keyframe
does not match its first, the loop has a seam, and the plugin will not hide that —
it plays what the file says. A motion directory may declare the exception per clip (a `loop: false` in its
own `vrmpet3d-motions.json`), and a one-shot hands the pose back to the state's idle rather than freezing in
its last frame. *(RETIRED 2026-10-12: this paragraph used to add that "MMD physics stays off even with a
motion loaded; the library's physics calls are optional, so an unrigged skeleton still animates" — there is
no MMD clip to load any more.)*

## 5. Licensing checklist before you add a model **or a motion**

- [ ] I have the right to use this model **personally**.
- [ ] It is **not** being committed into this repository.
- [ ] I have not rendered and committed frames of it either.
- [ ] If this plugin is ever published or shared, I have re-checked whether the
      model's terms permit that — and if in doubt, I shipped no model of my own
      instead (the files this repository ships are the two bundled models, and each is there because its
      author permitted the distribution or its own licence allows it — see §1).
- [ ] I have read any embedded metadata (`extensions.VRMC_vrm.meta`), because it is
      frequently **stricter** than the author's public distribution rules.
- [ ] I have the right to use every **motion** file too. Motion files are licensed
      **separately from models**: a motion that is free to download is not
      automatically free to redistribute, and many are authored for one specific
      character, game or platform (a Steam Workshop item's terms, for instance,
      apply to that platform and not to redistribution).
- [ ] No `.vrma` is committed into this repository either. (A `.vmd` needs no checklist entry: this build
      cannot play one.)

The embedded-metadata point is not hypothetical: the reference model in this
project's history has `modification: prohibited` in its metadata while its author
publicly allows modification. When the two disagree, assume the stricter one.

## 6. Where to put your models and motions

Point the plugin at one or more directories and it scans them recursively:

```yaml
- id: vrmpet3d
  name: dsh-plugin-vrmpet3d
  config:
    modelDirs:
      - D:/models/vrm
      - F:/models/mine
    motionDirs:
      - D:/motions
```

`modelDirs` is searched for models and `motionDirs` for motions, and the two
extension sets are kept disjoint on purpose (`['.vrm', '.glb', '.gltf']` against `['.vrma']`): a `.vrma`
must never be offered as a model, and a model must never be offered as a motion, so that a mix-up fails at
the catalogue rather than deep inside a loader. A `.pmx`/`.pmd`/`.vmd` in either directory is simply not
catalogued — no loader is built that could be handed one.

**Two directories are always scanned, and they belong to the plugin, not to you:** `assets/models` and
`assets/motions` inside the installed plugin. The first is where the one redistributable sample model comes
from; the second is the operator's own `.vrma` pack, which is why those clips appear in 状态与动作 with nothing
imported. Entries from them are tagged `source: 'bundled'`, and a directory you import is never merged into or
hidden by one — a clip of yours with the same file name is listed beside the bundled one. A clip in the pack may be
stored compressed, as `<name>.vrma.br` (see the compression note above); the same suffix is accepted in a directory
you import.

Scanning is bounded — 4000 entries and 8 directory levels — and skips dotfiles,
`node_modules`, `.git`, `.svn` and `__pycache__`. Names appear on 通用设置's import rows
as their path relative to the scanned directory, with their size. (The "settings panel" the older text named
was deleted on 2026-10-12; the two settings pages and the pet's right-click menu replaced it.)

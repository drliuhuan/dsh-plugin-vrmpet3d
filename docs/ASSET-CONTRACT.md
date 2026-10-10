# Asset contract — what the plugin expects from a model file, and what you may ship

## 1. This repository ships no model files, on purpose

Most VRM and MMD models distributed online carry terms that **forbid
redistribution**, and many forbid commercial use outright. Committing one into a
plugin repository would make the repository itself undistributable, whatever the
author's intent. So:

* `assets/models/` exists and is **empty by design**.
* The plugin's default is the **procedurally generated placeholder** avatar, which
  the project owns outright and which makes every code path work with no model at
  all.
* You point the plugin at your own model files, and you are responsible for their
  terms.

The same rule covers **motion files** (`.vmd` / `.vrma`), which are licensed
separately from models — see §5.

### The one image this plugin draws that it did not make

The 工作中 prompt is DSH's own running label, and that label's mark is DeepSeek's: a 60-frame APNG that the
app embeds in `dsh-client-ui-chat`'s stylesheet and masks `currentColor` through, with a static SVG for
reduced motion, forced colours, or a browser without alpha masks.

It follows the rule above rather than an exception to it. Nothing is committed here: `scripts/whale-asset.mjs`
reads the image out of the **installed** DSH (`resources/app.asar`) into `assets/whale-tail.apng`, the host
serves it from `/pet3d/whale`, and `assets/whale-tail.apng` is excluded from the package's `files` list. A
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

The format is detected from the file's **magic bytes**, not the extension.

| Format | Magic | Extensions | Loader |
|---|---|---|---|
| VRM 1.0 / 0.x | `glTF` (binary) | `.vrm` | `GLTFLoader` + `VRMLoaderPlugin` |
| glTF / GLB | `glTF` or `{` | `.glb`, `.gltf` | `GLTFLoader` |
| MMD PMX | `PMX ` | `.pmx` | `MMDLoader` |
| MMD PMD | `Pmd\0` | `.pmd` | `MMDLoader` |

Anything else is reported as an unrecognised format in the pet's status badge, and
the placeholder stays loaded.

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

Your model's own scale and origin are therefore **irrelevant** — a 20-unit-tall MMD
model and a 1.6-metre VRM are framed identically. The verified sample is a
20.18-unit PMD that frames to exactly the same 62 % as the 1.44-unit placeholder.

### Scene requirements

* A model must have **measurable geometry**. A file whose bounding box is empty or
  zero-height is rejected with a message rather than rendering nothing.
* **Transparent textures should use alpha**, not additive blending: MMD materials
  are forced to `alphaTest = 0.5` with `transparent = false`, so a hair texture that
  relies on blending will read as opaque. That is the standard MMD look, but it is a
  deliberate choice, not an accident.
* **Up axis is +Y and the model should face +Z** (towards the viewer). MMD models
  are converted from their left-handed coordinate system automatically; a model
  authored with a different up axis will appear rotated.

## 4. Animation: what is driven, and what is not

The idle is **procedural**, not keyframed. It returns exactly to its starting pose
after one 8-second period, so the loop has no seam. That is the default for every
model, and it needs no asset at all.

**Authored motion is opt-in and per state.** You may point the plugin at `.vmd` and
`.vrma` files and assign one to each session state; any state you leave alone keeps
the procedural idle. Nothing is played until you choose something — see "Authored
motion" below.

| Model kind | Driven by the plugin | Left alone |
|---|---|---|
| **Placeholder** | tail (3 links), ear fins (2 links each), side hair (2 links each), breathing, whole-body sway and bob | — |
| **VRM** | breathing (chest bone lift), head gaze toward the pointer; SpringBone settles hair and tail | the model's bone hierarchy, expressions, look-at |
| **PMX / PMD** | whole-body sway, bob, head gaze; a bone chain whose name suggests a tail is animated if found | everything else, including MMD IK and grant solving (they are stepped, not authored) |
| **glTF** | whole-body sway, bob, head gaze if a `head` bone is found | — |

### Why physics is off for MMD

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
turn it off in the settings panel ("Hair physics").

### Authored motion: VMD and VRMA

Two formats for two avatar families. They are **not** interchangeable, and the
plugin will not offer you the wrong one:

| Format | Drives | Carries | Assigned in |
|---|---|---|---|
| `.vmd` — Vocaloid Motion Data 0002 | PMX / PMD | bone names, morph weights, camera and IK data | settings, per state |
| `.vrma` — VRM Animation 1.0 | VRM 1.0 / 0.x | VRM humanoid bone tracks via `VRMC_vrm_animation` | settings, per state |

A `.vmd` cannot drive a VRM, and a `.vrma` cannot drive a PMX/PMD model. This is not
a restriction the plugin invents — VMD addresses MMD bones by name while VRMA
addresses the VRM humanoid bone standard, and there is no correct general mapping
between the two naming schemes. The settings panel therefore lists only the motions
that can actually drive the model you have loaded, and says so when none can.

### The bone-name trap — read this before reporting a "broken" motion

**A VMD binds by exact bone name, and unmatched names are dropped silently.** The
MMD loader builds one animation track per VMD bone name that exists in the target
skeleton and quietly skips every name that does not — no warning, no error, nothing
visible in the file. What you get is a clip that loads successfully, reports a
plausible duration, and animates nothing.

So a motion that plays correctly on one model and does nothing on another is almost
always a name mismatch rather than a corrupt file. The usual causes:

* the motion was authored for a different skeleton convention — for example a model
  whose bones are named in English or romanised, against a motion using the
  Japanese names every MMD tool writes;
* a Unicode difference, since the loader compares skeletal bone names literally and
  names that look identical can differ in normalisation;
* a motion authored for a different character whose bone set simply does not
  overlap.

The settings panel reports the number of tracks the clip actually built, so
"0 tracks" is a visible diagnosis instead of a mystery.

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
it plays what the file says. MMD physics stays off even with a motion loaded; the
library's physics calls are optional, so an unrigged skeleton still animates.

## 5. Licensing checklist before you add a model **or a motion**

- [ ] I have the right to use this model **personally**.
- [ ] It is **not** being committed into this repository.
- [ ] I have not rendered and committed frames of it either.
- [ ] If this plugin is ever published or shared, I have re-checked whether the
      model's terms permit that — and if in doubt, I shipped the placeholder
      instead.
- [ ] I have read any embedded metadata (`extensions.VRMC_vrm.meta`), because it is
      frequently **stricter** than the author's public distribution rules.
- [ ] I have the right to use every **motion** file too. Motion files are licensed
      **separately from models**: a motion that is free to download is not
      automatically free to redistribute, and many are authored for one specific
      character, game or platform (a Steam Workshop item's terms, for instance,
      apply to that platform and not to redistribution).
- [ ] No `.vmd` / `.vrma` is committed into this repository either.

The embedded-metadata point is not hypothetical: the reference model in this
project's history has `modification: prohibited` in its metadata while its author
publicly allows modification. When the two disagree, assume the stricter one.

## 6. Where to put your models and motions

Point the plugin at one or more directories and it scans them recursively:

```yaml
- id: pet3d
  name: dsh-plugin-pet3d
  config:
    modelDirs:
      - D:/models/vrm
      - F:/mmd/mine
    motionDirs:
      - D:/motions
```

`modelDirs` is searched for models and `motionDirs` for motions, and the two
extension sets are kept disjoint on purpose: a `.vmd` must never be offered as a
model, and a model must never be offered as a motion, so that a mix-up fails at the
catalogue rather than deep inside a loader.

Scanning is bounded — 4000 entries and 8 directory levels — and skips dotfiles,
`node_modules`, `.git`, `.svn` and `__pycache__`. Names appear in the settings panel
as their path relative to the scanned directory, with their size.

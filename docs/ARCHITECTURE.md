# Architecture

How the pieces fit, and why each boundary sits where it does.

```
  +----------------------- DSH host process -------------------------+
  |  lib/index.js                                                    |
  |                                                                  |
  |  session events --> VrmPet3DBoundaryHub --> vrmpet3d service ----------+--+
  |                                                                  |  |
  |  profile config --> buildCatalog(modelDirs)  --> /vrmpet3d/asset ---+--+--+
  |   assets/models ---/  (bundled, always scanned)                       |  |
  |                 \-> buildMotionCatalog(motionDirs) --> /vrmpet3d/motion --+--+
  |   assets/motions --/  (bundled, always scanned)                       |  |
  +------------------------------------------------------------------+  |  |
                                                                        |  |
  +---------------------- DSH browser page --------------------------+   |  |
  |  GET /vrmpet3d/catalog ---------------------------------------------+---+  |
  |  GET /vrmpet3d/motions ---------------------------------------------+---+  |
  |  GET /vrmpet3d/models   (read, add or drop an imported directory) --+---+  |
  |  GET /vrmpet3d/asset?m=..&p=..  (model + sibling textures) <--------+------+
  |  GET /vrmpet3d/motion?m=..      (one motion file) <-----------------+------+
  |                                                                  |
  |  lib/client.js   React slot "shell.overlay"                      |
  |    |-- session --> pet state (PetMachine, SessionAggregate)       |
  |    |-- pointer --> drag / throw / land (Placement)                |
  |    |-- right-click menu (shared with the window), persistence      |
  |    `-- require.async --> client.core.js / client.scene.js       |
  |                         client.menu.js / client.vendor.js        |
  |                        |                                         |
  |                        v                                         |
  |  client.scene.js Scene: renderer, camera, lights, Motion         |
  |    |-- idle motion            procedural, exactly loopable        |
  |    |-- authored motion        .vrma (VRM) only, per state        |
  |    |-- client.scene.js        scene, avatar, gaze                  |
  |    `-- client.vendor.js       three.js + VRM loaders              |
  +------------------------------------------------------------------+
```

## The five boundaries

### 1. Host half vs client half

DSH plugins have two halves with genuinely different powers. The split here is not
a formality:

* **The host may touch the filesystem.** A user's model files live on disk, and
  only the host half can read them.
* **The client may touch the DOM and WebGL.** Everything visual happens there.

Nothing crosses that line except model bytes and turn boundaries.

### 2. Why model bytes go over an HTTP route

A plugin's `assets/` folder is **not** served to the browser by DSH. The only
plugin-owned browser routes are `/plugins/<id>/client.js` and package-local
`client.<name>.js` chunks. So a model the user drops on disk can only reach the
page through a route the plugin registers itself — which is what
`webServer.register({ kind, path, handler })` is for.

The route is `/vrmpet3d/asset`, and it is allowlisted down to: *the exact file each
catalog id was scanned from, plus relative paths under that file's directory*. The
id — path map lives on the server, so the browser never names a path directly. See
`resolveAssetPath` in `lib/index.js` for the traversal rules and why a
containment-only check was not enough.

Files are **streamed**, not buffered. VRM files are routinely tens of
megabytes, and reading one into memory per reload would spike the host's heap for
no benefit.

### 2b. Why there is a second, writable route

`/vrmpet3d/catalog` is read-only on purpose: it is a projection of the directories the
host already knows about. A user whose models live elsewhere can name extra
directories in the plugin config, but that means editing YAML and restarting, so
`/vrmpet3d/models` exists as the small mutable counterpart:

* `GET` returns the imported list, the current model count, and the file the list is
  persisted to;
* `POST {add}` and `POST {remove}` update the list, rebuild the catalog, and reply
  with the refreshed catalog — so the page updates from the reply instead of racing
  a second request against the rebuild.

The list lives in a plugin-owned file in the profile directory
(`vrmpet3d-model-dirs.json`), deliberately **not** in the profile's `cordis.patch.yml`:
that file belongs to the user and to DSH's own config editor, and a plugin that
rewrote it would fight both. A failed write is reported rather than hidden — the
import is live for the session either way, and the user should know it will not
survive a restart. Paths are resolved and validated before they are stored, and a
directory that has gone missing is **kept**, so a drive that comes back comes back as
itself.

**The rename is a read-only migration, not a move.** The current names are tried first and the pre-rename
ones second: `vrmpet3d-settings.json` / `vrmpet3d-model-dirs.json` / `vrmpet3d-motion-dirs.json` in the
profile directory each fall back once to their `pet3d-*.json` twin, a motion directory's own manifest
(`vrmpet3d-motions.json`) the same way, and the browser's `dsh.vrmpet3d.v1` storage key falls back to
`dsh.pet3d.v1` on the first read. The old file is then left where it is — it is the user's data, and when to
delete it is not this plugin's business — and the next write lands under the current name, which is what
completes the migration. An override (`VRMPET3D_MODEL_DIRS_FILE`, the one the suites use) names a file this
project never wrote under another name, so it deliberately opts out of the fallback.

### 3. Why the 3D stack is one committed chunk

The client half is served as a single classic script that calls
`window.__ModuleLoader__.load({id, factory})`. The module system understands two
kinds of extra dependency: another installed plugin package, or a package-local
chunk. npm packages are neither, and a CDN is unreachable inside the app.

So the three.js + `@pixiv/three-vrm` + `@pixiv/three-vrm-animation` graph is compiled ahead
of time into `lib/client.vendor.js`. It is loaded lazily, through
`require.async('./client.vendor.js')`, only when the pet mounts — a session that
never shows the pet never pays for the 2.17 MB it measures (the MMD stack this graph used to
carry was removed on 2026-10-12, and the file is smaller for it).

The chunk is committed, and `scripts/vendor-build.mjs --check` fails if it does
not match a fresh build from the pinned versions in `vendor/package.json`. That
means the shipped artefact is verifiably the one the pins describe, and no
toolchain is needed to install the plugin. See `vendor/README.md`.

### 3b. Why the plugin's own sources are chunks too

The same rule that forces the vendor graph into a chunk applies to this plugin's
own three source files, and missing that is what made the first live install show
nothing at all.

DSH serves a package-local file only when its name matches
`/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`, and only at
`/plugins/<package>/<name>?rev=<current revision>`. `core.js`, `placeholder.js` and
`scene.js` match neither, so they were never served and the globals
`lib/client.js` read were always undefined.

`scripts/client-chunks.mjs` therefore generates `lib/client.core.js`,
`lib/client.scene.js` and `lib/client.menu.js`, each of which is the original
file **verbatim** plus a registration block. The originals stay the single source of
truth, the generated copies are checked in, and `--check` fails when one has drifted
— the same contract the vendor chunk has.

Two details are load-bearing and both were measured against the real loader rather
than inferred:

* **The registration id is the full module key**, `<package>/client.<name>.js`. The
  loader reads `registration.id` unconditionally, so a registration carrying only a
  `chunk` field throws; passing both appends the file name twice.
* **A registration is not an execution.** `__ModuleLoader__.load` only stores the
  factory; the exports appear when something first imports the chunk. Every harness
  that reads a chunk's exports directly must materialize it first, which is what the
  real web shell does.

`lib/client.js` asks for all FOUR chunks in a fixed order — the scene chunk reads the
other globals when it runs, and the menu chunk is the right-click menu BOTH pets build
from (the floating window loads `lib/menu.js` itself, from the host's source whitelist,
because it is a page of its own) — and keeps a global fallback per chunk, because the
inline browser harnesses load the sources with plain `<script>` tags and run no
module system at all. `lib/scene.js`'s `loadVendor` takes the resolved vendor from
the client half first and only falls back to injecting a `<script src>`, which cannot
work in the app: a relative URL drops the `?rev=` the server requires, and the
plugin's own script is served through a combo URL whose path is `/plugins/`.

`node scripts/verify-browser.mjs --page chunk-delivery` is the regression test:
39 checks that run DSH's **own** module system, extracted from the installed
`app.asar`, over the committed chunks.

### 4. Why logic is split off from the DOM

`lib/core.js` contains the state machine, fall physics, framing maths, idle motion,
motion-format detection and preference cleaning, and imports neither DOM nor
three.js. That is not tidiness for its own sake: those are the parts most likely to
be subtly wrong, and keeping them pure lets the core suite's 1270 checks run in well
under a second under plain Node instead of needing a browser and a GPU.

The same file is loaded in the browser as the `client.core.js` chunk and read off
`globalThis.__VRMPET3D_CORE__`. One implementation, no mirror to drift.

### 5. Why the scene is split off from the plugin

`lib/scene.js` owns WebGL and the model loaders. `lib/client.js` owns React, the
slot, pointer events, settings and the session bridge. The seam is:
`lib/client.js` drives `lib/scene.js` through a small imperative API
(`initScene`, `loadModel`, `setState`, `tick`, `setPlacement`, `resize`).

This is what makes the widget testable in a real DOM with a stub React, and the
scene testable in a browser with no React at all.

## The state machine

Eleven states, one `resolve()` with strict precedence. Highest wins:

| Order | State | Why here |
|---|---|---|
| 1 | `held` / `falling` / `landing` | the pointer owns these; nothing may interrupt a drag |
| 2 | `greeting` | an explicit user action |
| 3 | `offline` | a disconnected host can do nothing else |
| 4 | `waiting` | an approval is the most urgent thing a session does |
| 5 | `error` | a turn died |
| 6 | `celebrate` | a turn completed, inside its notice window |
| 7 | `working` / `resting` | the ordinary cases |
| 8 | `sleeping` | idle past the nap timeout |

Two decisions worth recording:

* **A failure latches; a completion expires.** `error` stays on screen until the
  next turn starts, because a user may not be looking when a turn dies and an
  error that vanishes after 4.2 s is worse than useless. `celebrate` is only worth
  showing inside its window.
* **The idle clock freezes during a drag.** Otherwise a completion arriving
  mid-drag is silently lost when its window expires while the pet is airborne.
  `PetMachine.setDeferral` slides the idle-progress timestamps forward on release,
  bounded by `MAX_DEFER_MS` so an hour-long drag cannot keep the pet awake.

The machine owns `notice`. `SessionAggregate` exposes the same information for the
settings page, but having both feed `resolve` made the outcome depend on which
caller set which field, with no test able to say which was right.

## Model loading

**VRM and plain glTF/GLB only, since 2026-10-12.** The format comes from the file's **magic bytes**,
never its extension. Users rename files, and an incompatible file must fail with a clear message rather
than a mysterious parse error deep inside a loader — which is why the bytes are still sniffed for the
formats this build no longer loads.

| Detected | What happens |
|---|---|
| `glTF` (GLB) / `{` (JSON glTF) | `GLTFLoader` + `VRMLoaderPlugin` — a VRM is a glTF with extensions |
| `PMX ` / `Pmd\0` | **refused by name**, with no loader in the chunk: `PMX is not supported: this build loads VRM only (see docs/ASSET-CONTRACT.md).` |
| anything else | `unrecognised model format (expected VRM/GLB/glTF).` |

A model that fails to load **reports why** and leaves the stage as it was — `Scene.loadModel` substitutes
nothing for it (the built-in avatar was removed on 2026-10-10), and the caller puts the reason on screen.
`usePlaceholder` survives only as a fixture the geometry probes and the browser suite build a model-free
avatar with, and it throws unless something has defined `globalThis.__VRMPET3D_PLACEHOLDER__` — which the
shipped plugin never does.

### VRM

`VRMLoaderPlugin` handles `VRMC_vrm`, `VRMC_springBone` and
`VRMC_materials_mtoon`. After load, `VRMUtils.removeUnnecessaryVertices` and
`combineSkeletons` are applied — not cosmetic, since without them a Blender-exported
VRM renders with the duplicated vertex set and visible seams. `rotateVRM0` makes a
0.x model face the same way as 1.0.

Hair and tails are left to three-vrm's SpringBone manager. Hand-animating the same
bones would fight it.

### MMD (PMX / PMD) — RETIRED 2026-10-12

> **This section describes a capability this build does NOT have.** MMD support was removed on
> 2026-10-12 (VRM only): `core.MODEL_EXTENSIONS` is `['.vrm', '.glb', '.gltf']`, the `@moeru/three-mmd`
> and `mmd-parser` packages are out of `vendor/package.json` and out of the committed chunk, and a PMX/PMD
> file is refused by name. It is kept, rather than deleted, because it is the reasoning behind two things
> that survive: the magic-byte sniff, and the refusal message.

What the retired path did, and why it was built that way:

`MMDLoader` exposes no public `parse(buffer)` — its `parse` is three's abstract
no-op, and its internal readers are not exported. So the bytes, already fetched and
magic-checked, are handed back as an **object URL** and loaded through `loadPMX` /
`loadPMD`. That keeps the official loader's own parse, left-to-right coordinate
conversion and assembly intact rather than reimplementing them.

The model's sibling textures resolve because `MMDLoader.resourcePath` is set to the
plugin's own asset route, so `tex/body.png` becomes
`/vrmpet3d/asset?m=<id>&p=tex%2Fbody.png`.

MMD physics was deliberately **not** wired. `@moeru/three-mmd` ships no physics
engine and expects the host to supply one. A desktop pet wants explicit bone
animation instead: a rigid-body simulation is not deterministic between runs and
cannot be looped exactly.

### Framing

`computeFraming` turns a measured bounding box into the two transforms that stand
the model on the floor, centred, filling a predictable fraction of the viewport.
This is the 3D equivalent of the fatfish plugin's "anchor every frame to the same
ground line and centre" step.

It is also the single most error-prone piece of maths in the project, because
three.js composes a node's world matrix as **T · R · S** — translation is applied
*after* scale, and a parent's scale does not multiply a child's translation. So an
offset assigned to the same node as the scale arrives in units that have already
been scaled, and the pet sinks by `box.min.y * (1 - scale)`. Both correct
placements are offered (`offset` for a node inside the scaled one, `worldOffset` for
a single node), and both are asserted in the browser suite.

`Box3.setFromObject(object, false)` is used deliberately: the `precise` path
transforms every vertex individually and can disagree with the non-precise path by
a few millimetres, which would make the framing depend on which path measured it.

### Size, the camera, and why both live in one place

There is exactly **one** size concept: the pet's slot, in CSS pixels, from
`size` (the wheel) times `modelScale` (a per-model preference). The canvas, the drawing
buffer and the camera all follow it, so any size the user can reach is fully visible.

That is a correction of an earlier design in which `modelScale` scaled the *model*
inside a slot the camera had already been fitted to. Enlarging the model then pushed it
past the canvas edges — the reported "it sticks out of its frame" — and no amount of
clamping could recover it, because the thing that overflowed was inside the canvas.

The slot is capped to a **fraction** of the frame — 55 % of its width, 60 % of its height
**in the app overlay**, and the whole frame in the floating window, whose frame is the screen
— and that cap is about the pet's HIT AREA rather than about the picture. The overlay is
click-through except for the pet's own box, which opts back into pointer events, so a pet
free to fill the window would take every click and drag in the app with it; and with
`maxX`/`maxY` at zero it could not be dragged out of the way either. Every size the wheel
can reach leaves a real margin on both axes, which the widget suite asserts on a viewport
too small for the requested size — the case where an uncapped slot would be largest.

**The wheel's own limits are derived from the frame the pet is in** (`core.sizeLimits`), not
from a fixed percentage: the box's long edge never goes below **40 px** and never above the
frame's **shortest edge**, with the slot fraction above applied first as the harder limit.
That is why the same stored `size` is a pet in an app window and a monster on a laptop, and
why the two surfaces disagree about the maximum on purpose.

The camera's job is therefore only to *look* at the model, which gives two independent
knobs and one rule:

* `refitCamera` computes a distance from the measured box and the canvas aspect. It is
  called on a resize, on a preference push, and after a model loads — the three events
  that change the fit.
* The **view orbit** (`viewYaw` / `viewPitch`) moves the camera on a sphere of that
  radius, and multiplies the horizontal component by `cos(pitch)` to stay on it. Without
  that factor a tilt shortens the radius, and a turn of the view reads as a zoom; the
  widget suite asserts the invariant directly.
* The orbit is a *preference*, not scene state: it survives a model switch and a reload,
  and it composes with whatever pose the idle or an authored clip is writing, because it
  never touches a bone.

The throw physics is the same story, and it took two attempts to get every edge right:
`core.stepFall` owns gravity plus **both vertical bounds** — the floor it lands on and the
ceiling it bounces off — and `core.reflectWithin` owns the side walls. The pet therefore
rebounds off all four bounds and settles on the floor. All of it is pure functions of
numbers, which is why the logic suite can cover a whole flight without a DOM.

The ceiling was the last one, and it is worth naming why it looked like it worked: the
client clamped `y` after each step, so a throw upward was caught by the clamp and the pet
stuck to the top edge while the rise it was thrown with was discarded — the same shape as
the side-wall bug, one axis over. A bound is only simulated if the simulation knows about
it; clamping afterwards is a different behaviour wearing the same numbers.

### Why the gaze is measured against the pet, not against the frame

The pointer listener is on the **document**, so the widget receives cursor positions from
anywhere in the window — the information never stopped at the pet's box. What stopped there
was the *unit of measurement*: the old `gazeFromPointer` normalised against the canvas
half-size and returned `null` past 1.6 of those, so the head followed the cursor to just
outside the pet and then went blank. Reported as "the view follows until the mouse leaves
the frame".

The aim is now `core.pointerAim`: the offset from the **pet's own centre**, divided by the
frame's own `spanX`, clamped to ±1, and then fed through a **response curve** — the aim is not
the offset any more, it is what the offset *buys*. Consequences that are the point of the design:

* the reference is the pet, so the aim stays correct while the pet is dragged, falling or
  resized — and the pet can be 200 px or 800 px on screen without changing how far the
  cursor has to travel;
* the span is a **setting** (`gazeSpanX`/`gazeSpanY`, the 模型参数 window's 视线 section) whose `0`
  means AUTO — the caller's own frame: the floating pet passes the work area's width, which is the
  screen's horizontal resolution ("满偏距离是屏幕的水平分辨率), and the app overlay passes its
  window's width. `core.resolveGazeSpan(setting, frame)` is the single place that decision is made,
  so both surfaces answer "what is auto" identically; `GAZE_SPAN`'s 420 × 320 CSS px is only the
  fallback for a caller with no frame of its own, kept at a hand's-width scale so it stays sane on a
  4K display;
* the response is `gazeCurve(t, a) = t / (a + (1 - a) t)`, also a setting (`gazeCurve`, default
  0.4): `a` is the curve's slope at the frame's edge, and **1 is exactly a straight line**, which is
  what keeps "linear" reachable and comparable to the behaviour this replaced. A straight line turned
  the head at a constant rate, which reads as sluggish where the user actually looks and twitchy far
  away ("鼠标靠近的时候变化快，离远了反而变化慢，是一个斜率逐渐降低的曲线). The curve starts at 0 and
  ends at 1 exactly, so the span keeps its meaning; at a = 0.4 a tenth of the span already buys 22 %
  of the turn and half the span buys 71 %. Both axes use it, and the caller mirrors the sign, so the
  two sides feel the same;
* the head's own limit is applied separately, in radians, by the scene: the turn saturates at
  80° left and right (`GAZE_YAW_LIMIT` is written through the gaze weight, so the *delivered*
  rotation is what the number says);
* while an authored clip drives the head, the gaze is LAYERED on top of the clip's pose
  (post-multiplied, so the clip stays the base) instead of standing down — and the addition is
  budgeted as `max(0, 70° - the clip's own turn)` (`HEAD_LAYER_LIMIT`). A clip that turns the head
  8.6° leaves 61.4° for the pointer; one past 70° gets nothing, because the alternative is two
  systems fighting over one bone. The clip's turn is measured from the rest quaternion each frame;
* beyond the span the aim **saturates** instead of disappearing: "keep looking that way" is
  what following a distant cursor means, and dropping the gaze was the bug;
* leaving the window clears it (`mouseleave` on the root element, `blur` for an alt-tab),
  because the last position is only meaningful while the cursor is actually there.

The alternative — making the pet's frame as large as the window so the pointer is always
inside it — was rejected: that box is the pet's *hit area* over a click-through overlay, so
a window-sized pet takes every click and drag in the app; it would also frame the model into
a window-sized slot and pay for a full-window WebGL buffer permanently.

### Which axes a gaze turns, and why they are measured

The aim is in the pet's frame; turning the head to match it is a rotation about two axes, and
**which** axes those are cannot be assumed. That assumption has now been the bug twice, on two
different avatar kinds, and the second time is what turned it into a rule:

| avatar | orientation | assuming the head's local X/Y |
|---|---|---|
| `HatsuneMikuNT.vrm` (VRM 0.x) | `rotateVRM0` turns it 180° about Y | pitch was correct |
| `蓝色小肥鱼vrm` (VRM 1.0) | left as authored | **pitch inverted** |
| the procedural placeholder | an unrotated group | **pitch inverted** (after the VRM fix) |

The VRM half of that split is forced by the maths: conjugating a rotation by a 180° yaw flip
negates a tilt about the right axis — `R_y(π)·R_x(θ)·R_y(π)⁻¹= R_x(−θ` — and leaves a turn
about the up axis alone, `R_y(π)·R_y(φ)·R_y(π)⁻¹= R_y(φ)`. Hence pitch inverted and yaw did
not, on exactly the model that is not flipped. The placeholder's case was simpler and worse: it
never reached the derived axes at all, because it had no rest *quaternion* and took a separate
`vrmpet3dRestRot` euler branch — so fixing one model's axes did nothing for it. Two branches meant
"general" was only ever true of one of them.

There is now **one algorithm and no per-kind case**:

* `gazeNodeFor(avatar)` is the single answer to "which node looks", used both by the gaze and by
  installation. VRM goes through the humanoid map, and glTF and the placeholder
  through `parts` — the choice of node is the only thing that legitimately differs. (The removed MMD
  avatar went by bone name; that branch is gone with it.)
* `installAvatar` — the one place every avatar passes through — records that node's rest
  **quaternion** and clears the cached axes. Nothing else has to remember to do it, which is
  exactly why the placeholder cannot be forgotten again.
* `gazeAxesFor` measures the axes from the rig: the character's forward, up and right come from
  the **stage** (so the pet's own heading cancels out), expressed in the head's local space, and
  the rotation axes are `forward × right` for yaw and `forward × up` for pitch — the cross
  product with the target, because rotating a vector about `f × t` by a positive angle tips it
  toward `t`. Cached on the bone, dropped with the model.
* The old local-axis euler survives only as a documented last resort for a degenerate rig.

The tests assert the user-visible property — a positive pitch tips the head's nose toward the
stage's up — and, for the general claim, that the numbers **agree across kinds**: the synthesized
VRM fixture and the procedural placeholder both measure `0.2522` pitch and `0.3335` yaw, to
within floating point, because those values are `sin(angle × weight)` and do not depend on the
model at all. The VRM check additionally repeats the measurement after rotating the model's root
by that same 180°, reproducing the 0.x/1.0 split with no third-party asset. Reverting the
derivation makes both checks fail (`upright −.2522 / flipped +0.2522`, and the placeholder
`−.1848` against the VRM's `+0.2522`).

### The pet's own window

The pet can leave the app window entirely. This is the one part of the plugin that starts a
process, and every choice in it is a consequence of something measured rather than assumed
(the measurements are in HANDOFF §12, the traps in §13).

**Why a second process.** A plugin cannot ask DSH for a window: the host half runs in a child
process with no Electron APIs, and the client half's IPC surface has no window channel and
validates its sender. So the window is started by the host half (`lib/desktop.js`) as a
separate Electron process running `desktop/`, this repository's own tiny Electron app.

**Why a "bare Electron" directory.** The application's own executable *is* Electron, but as
installed it always loads its own `resources/app.asar`; passing it an app directory does
nothing. Put the same executable in a directory whose `resources/` holds only
`default_app.asar`, and Electron falls back to the default app, which loads the directory it
is given. `planRuntimeLinks` is the whole of that rule, as a pure function, and the property
that matters is asserted: the application payload is **never** linked — only
`default_app.asar` — so the borrowed runtime cannot accidentally become a second copy of DSH.

The support files (`icudtl.dat`, the `.pak` files, the snapshot, the DLLs, `locales/`) are
**hard links**, which is why the runtime costs no disk space and why it has to live on the
installation's volume. A different volume degrades to copying, and says so in the log. Two
escapes exist: `VRMPET3D_DESKTOP_HOST_DIR` chooses the location, `VRMPET3D_DESKTOP_RUNTIME` names a
standalone Electron and skips the borrowing entirely.

**The shape of the window**, and the two numbers behind it: it covers the display's **work
area** rather than its full bounds, because Windows clamps a normal window to the work area
anyway (a 1440-tall request came back 1392 on a 48-pixel taskbar) and because a pet covering
the taskbar is a bug; and it is `alwaysOnTop` at the `screen-saver` level, because the plain
level still sits below some full-screen-ish windows.

**The settings windows are pages, and the window around them is a choice.** There are TWO of them since
2026-10-11, on two host routes: {{bt}}/vrmpet3d/config{{bt}} is 模型参数 (模型 / 表情 / 部位 / 弹簧骨, the sections that are
about one model) and {{bt}}/vrmpet3d/global{{bt}} is 通用设置 (显示与外观 / 视线 / 鼠标互动与物理 / 状态与动作 / 碎碎念 /
模型导入 / 动作导入). They are separate DOCUMENTS, not one page with half of it hidden: the earlier split kept one file and
toggled sections with {{bt}}?panel={{bt}}, which left a hidden section's ids in the document and made the two windows
the same page twice. Both read the model through {{bt}}/vrmpet3d/model-info{{bt}}, write the shared preferences, and
load the SAME {{bt}}lib/config-page.js{{bt}} and {{bt}}lib/pages.css{{bt}} — one script and one stylesheet, guarded per
lookup, so a section that is not on the page renders nothing rather than throwing. Neither needs anything from a
renderer, which is what lets the SAME pages be opened two ways. In DSH Desktop the launcher starts a second,
ordinary window for them (resizable, focusable, not always-on-top - every property the pet window needs is one a
form must not have, which is why the two share the launcher and nothing else). Anywhere else the same pages open
as browser tabs, and that is a first-class way to use them rather than a fallback.

**A third page of the same kind PICKS the model.** 切换模型 ({{bt}}/vrmpet3d/picker{{bt}}, added 2026-10-13) is opened the
same two ways and by the same launcher action, and it is a page rather than a panel inside the pet for one reason:
its content IS the first-run guide's ② 偏好模型 step (「面板中和初次安装向导模型页完全一样」), so one component
({{bt}}lib/model-picker.js{{bt}}) sits behind both mounts — a big choose-or-drop target over a grid of the models'
own thumbnails, served by {{bt}}/vrmpet3d/model-thumbnail?m=<id>{{bt}}.
Every switch is covered by a PROGRESS BAR, and the picker refuses input while one is in flight (operator,
2026-10-13: 「增加一个切换进度条，防止用户快速反复切换导致故障」): a VRM parse is seconds long, so an impatient second
click would otherwise start a second parse on the same skeleton. The bar ends when a SURFACE reports the model as
loaded (the store's {{bt}}live{{bt}} report) rather than when the write lands, and it has its own 300 ms clock because
a page only sees a snapshot when the store's VERSION moves — which its own write already did. That report is
{{bt}}reportLive(id, surface){{bt}}: ONE SLOT PER SURFACE, written by each pet after every load (not once at boot, which
is what made the bar outlive the model), and no longer stamped by the host from the launcher's {{bt}}--model-id{{bt}} —
that value is the model the window STARTED with, so re-stamping it on every settings poll overwrote the honest
report with a stale one. A dropped file is a `File` and nothing else,
so that route has a second way in beside the launcher's dialog: the page uploads the bytes
({{bt}}POST /vrmpet3d/models?file=<name>{{bt}}) and the host writes them into the same store a path import uses.

**These settings pages are the ONLY settings surfaces — the pet's right-click is a MENU, not a third one.** Until
2026-10-12 each pet also grew a settings PANEL of its own (and before that, two hand-rolled ones), which is how
"where do I turn physics off" came to depend on which pet you were looking at. That panel is deleted, and
{{bt}}lib/menu.js{{bt}} — one file, both pets, one order — replaced it. The menu is about the PET
(its view, its size, WHICH model it is wearing, its 重力, which surface shows it, and whether it is on screen);
every PREFERENCE lives on one of these two pages. 切换模型 is the one row that is not a setting: it decides which
model the other pages are ABOUT, which is why it is a page of its own rather than a row inside 当前模型参数设置. The one preference the deleted panel owned with no other home — 空闲休眠
({{bt}}sleepAfterMs{{bt}}) — was given a row on 通用设置 rather than left unreachable.

Two entries are the ones a later pass is most likely to "unify" wrongly, and they are not the same kind of thing:

* {{bt}}closePet{{bt}} is the same id with a DIFFERENT meaning per surface: 隐藏宠物 on the app's pet (the pet goes away
  until the 显示宠物 button in DSH's bottom-right corner is pressed) and 关闭独立宠物 in the floating window (the pet
  is handed back INSIDE the app, because the window IS the pet's box — a window with no pet in it is nothing);
* {{bt}}surface{{bt}} (切换回窗口外) is shown by ONE surface only. The window does not offer it, because its own
  关闭独立宠物 IS that action — the operator removed the duplicate on 2026-10-12 (「外置桌宠的'切换回窗口内'选项现在和
  '关闭独立宠物'功能重复了，移除'切换回窗口内'选项」). The app's pet keeps it, being the only way out of DSH, and a
  surface says it does not offer the row with {{bt}}showSurface: false{{bt}}. The id stays in the shared list so the
  ORDER is still one definition; only its PRESENCE differs. 重启/退出 DeepSeek Harness were the last two entries until the same day, when the operator removed them
and everything behind them: the `/vrmpet3d/harness` route, the host module that ran {{bt}}ctx.appExit{{bt}} and spawned the
detached relauncher, and both surfaces' failure lines.

**重力 is a TOGGLE with two independent keys.** {{bt}}core.DEFAULTS.gravity{{bt}} (the app pet, shipped ON) and
{{bt}}windowGravity{{bt}} (the window, shipped OFF — the "drag and place" behaviour it has had since 2026-10-10) are
separate on purpose: 「内置宠物和外置宠物的重力开关状态完全独立」. Both keys are read from `DEFAULTS` (the cleaner used to
spell them into `!== false` / `=== true`, so the app pet's "shipped ON" was not visible anywhere), and
{{bt}}DEFAULTS.petSurface{{bt}} is the shipped `auto` — the operator's own `window` and his two off switches are HIS
profile, not the default (2026-10-14: 「显示位置和重力都不下发」). The menu row reports and flips the state
({{bt}}setChecked{{bt}}, read at OPEN time like 非debug模式生效), and each surface pushes its own key into
{{bt}}placement.throwEnabled{{bt}}, with `endFall()` to stop a fall already in progress — "no throwing and no falling"
is not "no new throws". The menu module delivers 重力 through one line of CSS instead of a child node, because
the label IS the button's {{bt}}textContent{{bt}} and a mark added as a child would become part of the entry's name.

**A menu that closes ITSELF has to tell the page.** {{bt}}createMenu{{bt}} closes on an entry click, on Escape and on an
outside press, and only the host page's own {{bt}}closeMenu(){{bt}} path was ever wired before 2026-10-12: the floating
window's {{bt}}menuOpen{{bt}} stayed true after a click on an entry, so the launcher kept the extra room for a menu that
was already gone. It is {{bt}}onClose{{bt}} now, and the browser probe is what found it — every earlier menu check in
that file called {{bt}}closeMenu(){{bt}} rather than clicking an entry.

**And the pages may not write before they have read**: the whole preferences object is written on every edit, so
a page that failed to boot (a thrown error, an element the markup lost) would post its defaults over everything
the user configured — the accident of 2026-10-11. {{bt}}hasSnapshot{{bt}} latches every write path until a host
snapshot has been adopted.

**'Default' is stored as an absence.** An override keeps only the fields the user moved; the rest fall back
to the numbers the model file declares, snapshotted per joint at install time. The settings page and both
pets all edit through the same mutators in the core, so the clamp, the delete rule and the
meaning of 'cleared' exist once. And the two surfaces that own a pet subscribe to {{bt}}storage{{bt}}, which
fires only in the documents that did not write - the mechanism that makes an edit in the settings window
show up on the pet with no reload and no polling.

**Settings live in the preferences, and the model stays the source of default.** Expression pins, the
blink and emotion switches and the per-spring overrides are all ordinary preferences, so both pets and
the settings pages share them through one storage key. An override stores only
the FIELDS the user changed: an absent field falls back to the number the model file declares,
snapshotted per joint when the avatar was installed. That is what makes "default" a real state rather
than a number the UI happened to be showing.

**The two halves must agree about the same model, so the pairing rule is shared.** A VRM 1.0 spring
chain is a list of pairs — entry k is a joint whose tail is entry k+1 — so N entries animate N-1 joints,
and three-vrm implements exactly that. The host parser reports both counts (`entries` and
`bones`) for that reason: a window built on the file's entry count would offer sliders for
joints nothing moves, and the renderer and the file would disagree about the same avatar.

**Blinking is a pulse train, not a timer that toggles.** One blink is a single triangular pulse over
`BLINK_LIMITS.durationSeconds`; a double blink is the same triangle run TWICE inside a total that is only
`doubleDurationRatio` (1.5x) as long, so the weight passes through zero between them and the eyes are
visibly open for an instant. That instant is the whole difference between "two quick blinks" and "one slow
squint", which is why the suite asserts the number of times the weight rises through the closed half and
the dip between the two peaks, rather than the duration alone. The kind is chosen at the START of each
blink (`doubleChance`, 20 %) from the scene's injectable `random`, so a test pins both kinds instead of
waiting for a one-in-five to come round. The blink also ramps IN from open: the older code set the weight
to 1 on the starting frame, which snapped the eyes shut for one frame — invisible on a single blink at
60 fps, and a stutter in the middle of a double.

**A face that is showing something does NOT blink, and "showing something" has THREE sources.** The blink and the
expression shapes drive the same eyelid morphs, so a blink during an expression is not a blink — it is the
expression dropping and coming back for a tenth of a second (operator's own words, 2026-10-09 late and again
2026-10-12: 「当模型脸上有表情（专门设置或者动作自带表情时），暂停眨眼」). `advanceExpressions` therefore gates the START
of a blink only, on any of:

* a **clip-borne** face — the per-clip 表情/口型 configured in 状态与动作 (`currentFace`);
* the **表情 table's** emotion, while a reaction or a held mood has a weight (`expressionBehaviour.emotionWeight`);
* a **hand-set** weight in `preferences.expressions.weights` (`Scene.faceIsPinned`, added 2026-10-12).

That third one was the gap: it is the most persistent of the three (a stored configuration and the settings
window's 表情 preview both write it), and `expressionTargets` writes it into the morphs every frame, so blinking
over it is the same defect. The blink preset names (`blink`, `blinkLeft`, `blinkRight`) are deliberately NOT
counted by `faceIsPinned`: a pinned `blink` is a deliberate wink that owns the eyelids itself, and the behaviour
writes its own weight only where the user has not pinned one. A pinned weight of **0** does count, because leaving
it out would let a deliberate "eyes shut" be blinked open. Only the start is gated: a blink already running
finishes (cutting it would snap the eyes open), and the schedule is left alone, so a blink that came due while the
face was busy happens on the first clear frame. `blinkState().paused` reports all three sources, because it is the
readout a person uses to answer "why is it not blinking".

**Both surfaces play authored motion, and that was not always true.** The app overlay loads a clip for each
state the user assigned (`/vrmpet3d/motions` for the catalog, `/vrmpet3d/motion?m=<id>` for the bytes, `loadMotion`
into the scene), and the floating window now runs the same path: filter the catalog by avatar family
(`vrm` →`.vrma`; the `mmd` →`.vmd` pairing went with MMD support on 2026-10-12), fetch each mapped motion's bytes **once** (they outlive a model switch),
build a clip **per avatar** (a clip is fitted to a skeleton, so a model switch drops the clips and keeps the
bytes), and let `setMotionMap` decide what plays where. Until this round the window had no motion path at all,
so a correct `.vrma` animated the in-app pet and left the desktop window frozen — the surface a desktop-pet
user actually watches. The page publishes its own account of it (`motion: {kind, format, mapped, playing,
available, reason}`) because the four ways a motion can do nothing look identical from outside.

**Motion directories are importable, like model directories.** `config.motionDirs` is the declared list;
`vrmpet3d-motion-dirs.json` (plugin-owned, beside the settings, `VRMPET3D_MOTION_DIRS_FILE` to redirect it in tests)
is the imported one, and the two are unioned when the catalog is rebuilt — which happens on **every request**,
so an import is live on the next fetch instead of on the next DSH start. This exists because the alternative
was "edit the profile config and restart the whole application to try one file", which is indistinguishable
from the feature not working.

**...and the plugin ships a motion pack, scanned first.** `assets/motions` is a bundled root, exactly as
`assets/models` is for models, so the operator's own clips are offered from the first scan with
`source: 'bundled'` instead of waiting for anyone to import a directory. `buildMotionCatalog` therefore builds
`{ root, source }` pairs rather than bare paths, and `/vrmpet3d/motions` reports `bundledDir` beside
**A fourth page carries the first-run guide** (`/vrmpet3d/setup`, `lib/setup-page.html` + `lib/setup-page.js`; the
third of the settings kind is the model picker above), and it
is the one page the plugin OFFERS rather than waits to be asked for: the in-app pet reads `GET /vrmpet3d/setup-state`
after its own boot and opens it at most once per activation, with `completed` in the profile
(`vrmpet3d-setup.json`) and `prompted` in the host's memory. Its two imports go through the same routes the panels
use and they COPY (`importModelFile` / `importMotionFolder`), which is what makes the folder they came from
irrelevant afterwards — and since 2026-10-13 its MODEL half is not this page's own markup at all: the step mounts
`lib/model-picker.js`, the component 切换模型 is built from, so the wizard and the menu cannot drift apart.

`motionDirs` — the parallel of the model catalogue's own key. A user directory that names the bundled one is not
scanned twice; a user directory holding a clip with the same relative name is still listed, and the two are told
apart by `source`, because a user's file is never hidden.

**...and the folder a clip sits in decides which state's picker offers it.** The pack's manifest carries
`stateFolders` (`{ "resting": ["idle"], "working": ["working"], … }` — a state may name SEVERAL folders, and a
bare string is normalised to a one-item list), `/vrmpet3d/motions` reports it, and the page
offers each state only the clips under its folder. The operator's reasoning is the whole design: 「把对应的动作直接
解析到指定目录，这样在选择动作的时候就不会出现很长一串」 — one picker listing every clip they have ever authored is
unusable, and the folders were already the mapping they were keeping in their head. Consequences worth naming:

* it is **strict** — a state's box set offers only its own folder, and a clip at the pack's ROOT belongs to no state
  (it stays catalogued, so nothing is destroyed, but no state offers it);
* a **ticked** clip from another folder is still DRAWN, because hiding a stored mapping reads as losing it;
* a state with **no** `stateFolders` entry is offered the whole catalogue, so a host or pack that says nothing
  behaves exactly as every build before this did — which is what makes the block safe to omit;
* the folder comes from the catalogue's own relative name (`idle/x.vrma` → `idle`), so "which folder is this clip
  in" has ONE answer rather than a slice the page and the scan each compute;
* a declared folder that is empty is a STATE, not a broken mapping: the panel says so in words for that state.
* `dance/` is the case the list form exists for: it holds the operator's dance clips and is mapped to NO state until
  they say which one, so nothing plays a dance behind their back.

**A clip may also arrive compressed, as `<name>.vrma.br`, and the HOST unpacks it.** Dance clips are megabytes (the
operator's first is 8.0 MB), so the pack stores them brotli-compressed and `createMotionHandler` decompresses on the
way out: the response to `/vrmpet3d/motion?m=` is always a plain VRMA with the GLB media type and the UNPACKED
length, so the renderer keeps one load path and never learns a clip was packed. `core.motionFormatOfName` looks
through the suffix, which is why a compressed clip is a `vrma` everywhere the format is asked about (nothing is
sniffed, and the model/motion extension sets stay disjoint); the catalogue adds `compressed: true` and reports the
FILE's size. **A compressed file replaces the uncompressed one beside it**, so one animation is never offered twice.
Three refusals are deliberate rather than incidental: a clip that cannot be unpacked is a 500 NAMING the failure
(a truncated 200 would be reported by `scene.loadMotion` as malformed clip content), a decompression bomb is cut off
by `maxOutputLength`, and only ONE unpacked clip is retained per handler so the pack cannot sit in the host's heap.
Brotli rather than LZMA2 is a measured decision — Node's `zlib` cannot decode LZMA and this plugin has no
dependencies, and the hand-written LZMA2 decoder that was tried did not decode real binary content correctly, so it
was DELETED rather than shipped unwired — and it is recorded in
[assets/motions/README.md](../assets/motions/README.md), together with [scripts/compress-motions.mjs](../scripts/compress-motions.mjs),
which is how a clip is packed.

**A bundled clip's NAME is what a default refers to, never its id.** `mintMotionId` derives an id from the
absolute path, so ids differ per profile and per machine, while the pack's own manifest travels with the clips.
`core.motionMapWithDefaults(stored, defaults, catalog)` is the single implementation of that rule, and it is
deliberately a READ-time merge: the resolved map is what the renderer and the panel act on, and the store keeps
the user's own map. Three rules, each one the fix for a defect in its alternative:

* **an explicit choice wins, including an explicit EMPTY one** — a state the user's map mentions is never
  overridden, so unticking the last box in 状态与动作 is not undone on the next poll;
* **a default resolves by name against the catalog just built** — a clip that is missing or renamed degrades to
  "nothing mapped" rather than to a dangling id;
* **nothing is persisted** — a default written back to the store would be indistinguishable from a choice on the
  next load, which is what makes a default impossible to turn off.

The pack ships its `defaults` block in `assets/motions/vrmpet3d-motions.json`; while it is empty (the state it
ships in until the operator chooses a mapping) nothing plays without a mapping, and filling it in needs no code
change. `readMotionDefaults` validates that block rather than trusting it: a state the session machine cannot
reach, a duplicate, a non-name, or a backslash path is dropped, because this is a file a person hand-edits.

**The same file's `template` block is the operator's whole 状态与动作 configuration** — `{ [state]: { '<relative
name>': { loop?, expression?, mouth?, gaze? } } }` — shipped so a fresh profile's pet is not merely pointed at his
clips but wears the faces he gave them (2026-10-14: 「…包括每个动作的表情状态，全部作为默认模板上传」). The path is the
same one `defaults` takes: `readMotionTemplate` validates the block, `core.motionClipTemplate` resolves its names
against the catalog just built, `/vrmpet3d/motions` sends the result as `motionClipDefaults` beside `motionDefaults`,
both surfaces hand it to their scene (`setMotionClipDefaults`), and `core.motionClipFor(…, template)` merges it FIELD
BY FIELD **under** the profile's own entry — a profile that decided the play mode for a clip still inherits the
template's face, and one that picked a face keeps the template's 凝视. Two values exist only because a template does, and
both are what keeps a default from being a setting nobody can turn off: `MOTION_FACE_FOLLOW` (`'follow'`), the stored
way to say 「跟随情绪」 against a template that names a face, and `gaze: true`, which takes a template's refusal back for
one clip. Per-clip 碎碎念/提示词 are deliberately NOT part of the template — they are the user's own words, and an absent
string already means "use the state's pool", so a template line could not be overruled back to "no line"
(`MOTION_TEMPLATE_FIELDS` is the whitelist, applied once in `core.cleanMotionTemplateEntry`).

**A state draws ONE clip from a LIST, at the moment it is entered.** The persisted map is
`{ state: [id, ...] }`, and the canonical shape is a list even for one clip. Two things follow, and both are
contracts rather than conveniences:

* **The draw happens on state ENTRY, never per frame.** `Scene.resolveAuthored` compares the state against
  the one it drew for (`pickState`) and only then calls `pickMotionFor`, which takes one id uniformly from
  `core.motionIdsFor` using the scene's injectable `random`. A per-frame draw would flicker between clips
  several times a second and make `playing` meaningless, so a suite pins `scene.random` to a constant and
  asserts that the two entries of one state **can differ** — which is the whole feature — and that the draw
  does not change while the state holds.
* **A bare string is still accepted by the cleaner.** `core.cleanMotions` normalises `{ resting: 'a1' }` to
  `{ resting: ['a1'] }`, because the map is PERSISTED: every profile written before the list existed holds
  the string form, and a cleaner that refused it would silently erase the operator's motion configuration on
  the first run of the new build. `core.motionIdsFor`, `motionIdList` (the set that must be preloaded) and
  `setMotionIds` (the pure write both surfaces share) all read the old shape too.

**`loop` is a property of the CLIP in the catalog, and of the PLAYBACK in the renderer.** A motion directory may
hold a `vrmpet3d-motions.json` declaring `{ "clips": { "<relative name>": { "loop": false } } }` (and, beside it,
the `defaults` block that now ships the operator's own state→clip mapping); `buildMotionCatalog` reads it once per
directory and every entry gains `loop` (absent means `true`, which is what every clip did before the flag
existed).

The MODE ITSELF is decided when a playback starts, from `Scene.motionLoops(id, state)`: the catalog's declaration,
then the user's per-state per-clip override, most specific first. Not at build time — a clip can be a posture in one
state and a reaction in another, and a mode baked in at build time was wrong for whichever state came second (the
scheduler classified a clip as a one-shot while the action itself looped for ever, so it never finished and the
reaction window never re-armed). Applying it per playback is also what makes 「严禁单次动作循环播放」 structural: a clip
that is a one-shot in this state IS `LoopOnce`, whatever the file says.

What happens when one ENDS is one rule in one place (`Scene.afterOneShotEnded`, operator 2026-10-13
「单次动作结束后，必须衔接循环动作…如果没有循环动作…停止在最后一帧」):

* the state has a looping clip → draw one **at random** and start it: the loop is the posture the pet wears between
  reactions, so a reaction hands over to it rather than dropping to the procedural idle;
* the state has none → **hold the last frame** (`clampWhenFinished` plus a `held` latch on the playback), because
  the operator asked for the last frame and the idle would quietly walk away from the pose the clip struck.

A due reaction fires BEFORE the base clip is reconsidered in that frame's decision, which is what lets it interrupt
a loop that has not finished (「单次动作可以在循环动作未完成时触发」). Both draws go through the scene's own injected
random, so the order is not fixed (「循环动作和单次动作的触发都是随机的」) and a suite can pin either end.

`Scene.motionFinished` checks the action's own clock as well as the mixer's `finished` event — the two signals are
the mixer's account and the action's, so neither is interchangeable, and the removed MMD path was what first made
that visible (it drove the mixer from inside `updateWithMixer`); `pickSpent` latches the state so a one-shot does not
restart on the next frame.

**A clip that carries its own expression stops the blink.** `clipDrivesFace` asks whether the built clip animates
any morph target, and `advanceExpressions` treats that exactly like a user-assigned expression: the blink timer is
the same eyelid morphs, so blinking over such a clip is the clip's face dropping and coming back (operator,
2026-10-13: 「当动作本身带有表情的时候，停用眨眼」). `blinkState().paused` reports all four sources, because a readout that
disagreed with the gate is how "why is nothing blinking" becomes a mystery. Every clip in the bundled pack is
bone-only, so nothing about the shipped pack changes.

**A generated VRMA is portable between models when it respects two things.** `scripts/make-vrma-fixtures.mjs`
emits `vrmpet3d-wave.vrma` as a fixture (2.0 s, 7 channels, 61 keys) and `verify-motion.mjs` plays it on a real
model, which is what makes it a test rather than an example:

* **World-aligned axes.** `VRMHumanoidRig._setupTransforms` builds the normalized rig from the raw bones' world
  positions and leaves every normalized node's rotation at identity, so `rightUpperArm` about **Z** raises the
  arm on any VRM — no per-model bone-axis guessing, and no reference skeleton to ship.
* **A rest-height hips translation.** `createVRMAnimationClip` scales that track by
  `humanoidY / restHipsPosition.y`, so a hips track held at the animation's own rest height lands exactly on
  the model's rest position whatever its proportions. Leaving the channel out entirely also works for an
  in-place clip; putting a wrong constant in it is what makes a pet float or sink.

Every track is a function of `sin` over an integer number of cycles in the clip's duration, so the loop has no
seam — which matters because the pipeline loops with `LoopRepeat` and a state can last minutes.

**Secondary motion from a drag needs the right KIND of input, not more of it.** Both surfaces CARRY the
pet — the app moves its slot, the floating window moves the window — so the model's own world position
never changes and the spring bones would see a pet standing still. `Scene.setDragMotion(vx, vy)` puts the
motion back: the body lags opposite the drag (`DRAG_LAG_SECONDS`, capped, damped), which restores the
TRANSLATION the rig is missing. That is not enough for the vertical axis, and the reason is mechanical: a
chain hanging down cannot be excited by moving its anchor along its own axis — its joints only bend, and
the spring solver holds the distance between them — so lifting or dropping the pet straight down barely
moves the hair, which is exactly the report "左右移动会晃，上下移动不晃. What such a chain CAN answer is a
rotation of its root, so vertical velocity also PITCHES the stage (`DRAG_PITCH_PER_PIXEL`, capped, its own
time constant, decaying to zero when the drag stops). Measured on the committed fixture: the same vertical
impulse bends the chains **0.069** world units with the lean and **0.0012** without it — the lean is not a
flourish on top of the sway, it is the sway.

**A model's contents come from the FILE, not from a frame.** The settings window has to list
a model's expressions, its spring chains and the licence its author chose — including when no pet is
running, and including when the previous frame was never rendered because the window is closed. So
the host half parses the GLB (`lib/vrm-info.js`) and serves a compact projection over
`GET /vrmpet3d/model-info?m=<id>`. Three consequences are deliberate:

* the answer is the file, so a model replaced on disk shows up on the next request — the cache is
  keyed by (path, size, mtime) rather than by id;
* a file that is not a GLB/VRM is an ANSWER (`supported: false` with a reason), not an error,
  because "this file has no expressions to list" is something the UI should say rather than blank out.
  (A PMX/PMD no longer gets that far — it is not catalogued, and the renderer refuses it by name — so the
  answer is now about a GLB whose VRM extension is missing);
* the CLI (`scripts/vrm-report.mjs`) is a thin renderer over the same module, so there is one
  parser and no chance of the two drifting.

The parse also has to survive a subtlety that this project's own fixture now encodes: morph targets
may be **unnamed**, and then a bind's node + target index is the only description of what an
expression does. The report therefore carries the reverse map (target →expression names) instead of
relying on `targetNames`.

**The wheel zooms about the cursor, and the gesture outlives the pointer.** Growing the
pet's box from its top-left corner walks the model out from under the pointer, and in a window that
is click-through wherever nothing was painted, the next notch is then delivered to whatever is
behind the window: the gesture dies after one step. So the resize holds the point under the cursor
still (`Placement.resizeAnchored`, which preserves the anchor's FRACTION of the box — the
model is framed to the box, so a point on the model keeps its place on the model), and for a moment
after each notch both halves keep the door open: the launcher holds the window interactive, the page
keeps answering the wheel even from a pixel-less spot. The launcher's hold is deliberately the
longer of the two. The clamp still wins when the pet is parked against an edge of the screen — the
box cannot be pushed off the display to honour an anchor exactly — and the live probe asserts the
property that survives there: the cursor is still on the pet, so the next notch still lands.

**The right-click MENU is answered separately, because it is not made of pixels.** It is DOM, so
the framebuffer knows nothing about it: the hit test is the union of "the pet painted this pixel"
and "this point is inside the menu's rectangle", or a right-click would open a control surface
that cannot be clicked. A right-click that moves is an orbit and one that does not opens the menu —
the same threshold that already keeps a drag from being a click. Its entries are buttons rather than native widgets for the
same reason the window is `focusable: false`: a native dropdown needs an active window to open, and this window must
never take focus from what the user is doing. The module also binds its outside-press guard one TASK after the open
rather than during it, which is what makes "the press that opened the menu cannot close it" a structural fact instead
of a race between two coarsened clocks (it was a `performance.now()` vs `event.timeStamp` comparison until 2026-10-12).

**Throwing is a switch, not a feature.** `Placement.throwEnabled === false` makes
`endDrag` return without creating a fall: the pet is placed where it was released and stays
there. Each surface sets it from ITS OWN 重力 preference (see above — the window shipped with it off, the app
pet with it on, and neither can reach the other's key). `stepFall` and the wall and ceiling bounces are
untouched and still tested, because a later feature wants them, and `endFall()` is what stops a fall that is
already in progress when the switch is thrown off.

**Click-through is per PIXEL, not per rectangle.** The window is click-through by
default (`setIgnoreMouseEvents(true, { forward: true })`), and the launcher makes it interactive
only while the page says the cursor is on pixels it actually painted. The page answers that from
the framebuffer (`readPixels`, one pixel, with `preserveDrawingBuffer` on so the answer is
available between frames as well as inside one). The pet's RECTANGLE is published too, but only
for diagnostics: a rectangle swallows every transparent pixel inside the box, which is precisely
the "clicks pass through the hair gaps but land on the hair" behaviour the user asked for, and it
would also have made the earlier bug worse rather than better. During a drag the window receives
events **anywhere** for the whole gesture: the pet follows the cursor, so the cursor leaves the
painted pixels immediately, and a window that turned click-through mid-drag would lose the pointer
stream that is dragging it.

Two consequences worth stating, because both were learned live. The canvas must be the pet's own
BOX, positioned inside the screen-sized window with CSS: `Scene.setPlacement` ignores x/y and
frames the model to its canvas, so a screen-sized canvas draws a screen-sized pet — which is what
the user saw ("too big, it covers most of the screen"). And the drawing buffer must never be
resized per frame: comparing `canvas.width` (device pixels, 330) against the box width (CSS pixels,
220) is true on every frame, so the frame ends by resizing the buffer *after* the render — the
window composes an empty canvas and the hit test reads zeros. The guard belongs against the Scene's
own record in CSS pixels, and the buffer size is the renderer's business.

**The cursor comes from the OS, not from events.** A click-through window receives no pointer
events at all outside the pet, so events cannot drive the gaze there. `screen.getCursorScreenPoint()`
is polled at frame rate instead and pushed to the page, which feeds it to the same
`core.pointerAim` →`Scene.gazeFromAim` path the overlay uses — which is also why
`forward: true` is deliberately not relied upon.

**The page reuses everything.** `lib/desktop-page.html` loads the *same* `client.vendor.js`,
`core.js`, `placeholder.js`, `scene.js` and `client.js` the overlay loads, over the plugin's own
HTTP origin (so the `/vrmpet3d/asset` fetches are same-origin), plus one small glue
(`lib/desktop-page.js`) that adds what is different: the screen as the frame, the launcher's
cursor as the pointer, and the rectangle report. It applies position through the same
`Placement` — throw physics, wall and ceiling bounces, the size range — and draws through the
same `Scene`, so the two windows cannot drift apart in behaviour. Model loading goes through
`Scene.loadModel`, which already fetches the bytes, parses them and installs the avatar (reporting a
failure rather than substituting a stand-in); the glue's
first version reimplemented that and never installed an avatar at all, which is how a pet can
run 120 error-free frames painting nothing.

**Failure is reported, never swallowed.** The frame loop is guarded and publishes its own state
(`window.__VRMPET3D_DESKTOP_STATE__`: frames, last error, placement, rectangle); the launcher
collects the page's console messages and asks for that state when it self-tests; the host half
reports the child's state — including a copy that had to happen, a runtime that could not be
built, and **what the page itself reported** — through `GET /vrmpet3d/desktop`, and the 通用设置 page shows
it. A launcher whose parent dies quits on a watchdog, and the host half kills the window when the
plugin is disposed.

That last part exists because of a live report: the window opened, the page loaded, the glue never
ran and the pet was invisible — while the suite was green and the host cheerfully said "running".
Two independent mistakes had to line up, so both are closed:

* the page's source prefix was registered **with a trailing slash**, and this server matches a
  prefix as `pathname === prefix || pathname.startsWith(prefix + '/')`, so every source 404'd.
  `verify-model.mjs` now requests the page, all eleven sources, a non-whitelisted name and a traversal
  attempt over real HTTP, and asserts the property that no prefix route ends in a slash — the
  requests the desktop suite never made, because it serves the page itself;
* "the process is alive" was being reported as success. The launcher prints one machine-readable
  status line, the host parses it out of the child's stdout (across chunk boundaries), and the page
  distinguishes **on**, **starting**, and **on but not drawing** with the page's own error text. The
  two halves share that marker deliberately; a suite check keeps the copies identical;
* a source was served with the **wrong content type**, and the browser refused it silently. The
  `/vrmpet3d/window/lib` route hard-coded `text/javascript` for every name in its whitelist, so when the
  two settings pages began sharing `lib/pages.css` the stylesheet came back as JavaScript: the pages
  loaded, their scripts ran, every request was a 200, and the browser applied none of the CSS — the
  windows were a wall of unstyled text. Nothing in the suite could see it, because the desktop suite
  serves the page (and its stylesheet) from its OWN stub server and the host suite asked only whether
  `pages.css` was a 200 with a non-empty body. Now the whitelist and the extension-to-type table are
  exported constants of `lib/index.js`, and `verify-model.mjs` asks the **real** handler for every
  whitelisted name and asserts the type it answers with — so a name added to the whitelist is checked
  on the run that adds it.

A route path is an interface with someone else's matcher, so it is asserted as a shape and
exercised over real HTTP rather than merely listed.

## Verification

Nine suites, 2542 checks, and they live on the **`dev` branch** (this branch carries the plugin; `dev` carries the
suites, the `build/` tools and the notes) — the `mmd` suite that used to make it ten went with MMD support on
2026-10-12, and every figure here (per-suite and total) is the one its own run printed; `scripts/check-docs.mjs`
recomputes them. The
design rule is that **each defect found during
development got a test that would have caught it**, and several tests carry a
comment saying which bug they exist for.

| Suite | Runs in | Covers |
|---|---|---|
| `core` | Node, 50 ms | state machine (including the event-ended notices: a 任务达成/出错 waits for the user to be back in the session that reported it, a completion whose own session starts working again is RETRACTED and remembered (`noteRetraction`/`settleFor`: that session's quiet window doubles, 4 s → 8 → 16, capped by `COMPLETION_SETTLE_MAX_MS`, and a completion the user actually saw pays the debt), 等待确认 waits for the answer, and each is drawn with its own tone), 碎碎念 (the phrase table, the event mapping, the throttle, the silence rule, the user's OWN per-state boxes — cleaned from either a textarea or an array, read through the event→state bridge, replacing the shipped table for that state and falling through to it when empty — and the AI half: the request intent, the AI → box → table fallback chain, `say()`'s flattening and cap, and `pumpAiSpeech`'s one-request-per-intent with a late answer dropped, and the PER-CLIP texts: the pair `{clip, state}` resolved like the expression and the gaze switch, the clip's line beating the state's pool, an emptied box DROPPED rather than stored empty, and the clip's AI 提示词 travelling with the request as a refinement — plus a PRESS reaction: `react()` speaking from the part's own box, else the SHIPPED pool for its region — chosen by GESTURE (`click` / `hold`) and by LANGUAGE, twenty lines each — and then from the state's own box, never from the shipped STATE table, its `reactGapSeconds` floor, and silence for a part nobody configured), the PARTS (the user's own rows: a label, the structures it owns matched by prefix unless pinned exact, an emotion row and a 碎碎念 box each — with the legacy per-region emotion rows migrated into the shipped five, the cap on how many, and the matching order that lets a user part override the name heuristic), the emotion tables (four trigger rows — 空闲 / 拖动时 / 点击时 / 长按时 — and the parts' own rows, all empty by default so a profile that predates body parts behaves identically, plus the `PRESS_LIMITS` bounds both surfaces read and the shared row-patching rules), `structureRegionOf` as a clearly-labelled HEURISTIC whose `null` means "this name says nothing" rather than "body", fall physics with wall AND ceiling bouncing, framing, idle motion, preferences (the two size keys — `size` for the in-app pet and `windowSize` for the floating window — the window's own parked corner `placementX`/`placementY`, 显示位置 `petSurface` including `both`, the DEBUG value that puts the window and the in-app pet on screen at once, the view limits, and the migration that keeps an older profile's single size for both), pointer aim for the gaze, motion-format detection, the VRM stand rotation |
| `host+model` | Node, 500 ms | model and motion catalogues, path safety, the two byte routes, both catalogues and the imported-directory route over **real HTTP**, boundary hub, the live-state channel with the 碎碎念 line it carries (flattened, capped, cleared), the WHY block it relays (the machine's inputs — running/working/runningIds/notice/settling/focus — rewritten field by field at the host and dropped when the report ages out), and the PRESS it carries (which gesture, which of the user's own PARTS owns the structure, the model's own name for it, each field capped, and anything without a reason or a region refused as "not a press"), the STRUCTURE list the 部位 editor offers (every node, mesh and material name of the model, deduplicated, kinded and capped), the DESCRIBED MODEL HELD IN MEMORY (a process-wide LRU of four parsed reports, so the settings window stops re-reading and re-parsing the file on every open — asserted by the cache's own counters: a second request for an unchanged file is a HIT and does not parse, a changed one is re-parsed, `forgetModelInfo` forces a re-read, and the cache never grows past its capacity), and the AI 碎碎念 pair over real HTTP against a stub provider that records the request (the persona and the state's own instruction, and nothing else — or, for a request that names a PART, that part's own prompt; or, for one that names only a STRUCTURE, an instruction built from that name VERBATIM, which is how a part with no prompt still gets answered — with a stale id falling back to the state rather than failing the page, and a long or multi-line structure name capped and flattened), the DSH path through a stub stream that speaks the REAL chunk protocol (`{ type: 'finish', reason: { kind, failure } }` — the shape `BlockAssembler` reads, and the one the first stub got wrong), its terminal failure codes, the asked-for reasoning effort and token budget asserted by name, a thinking-only stream refused with what it spent, one call in flight, and the live provider catalog, and — the check the unstyled-settings bug proved was missing — **the content type of every page source, asked of the real handler by name** (the whitelist and the extension table are the plugin's own exported constants, so `pages.css` is asserted to be `text/css; charset=utf-8` and every script `text/javascript; charset=utf-8`) |
| `load` | Node, 50 ms | manifest, host half, activation, cleanup, stream lifecycle |
| `clientchunk` | browser | DSH's **own** module system delivering the committed chunks, and the request-shape guards |
| `vendor` | Node, 20 s | the committed chunk matches a fresh build from the pins |
| `browser` | browser | vendor chunk, procedural avatar, framing, glTF/VRM loaders (VRM only) |
| `client` | browser | the widget: mount, drag (handler-driven AND listener-driven), throw, wall and ceiling rebounds, wheel zoom, view orbit, gaze beyond the pet's frame and its reset, size reset, the per-state motion box sets (two clips in one state, the loop/once marker, the one-shot flag reaching the scene, a stale clip kept visible but unpickable), the floating-window switch and its three host answers, all 11 states, dispose, the AI 碎碎念 path (one `POST /vrmpet3d/say` per event across four frames, the fallback line up until the answer lands, the answer in the bubble), and the PRESS path: a wobbling press is a click that moves nothing, a still press held for 0.6 s is a 长按 while it is still down and adds no click, the part is measured with a real raycast against the model (renaming the meshes moves the region from body to eye, and a miss is not a region), a part whose row names an emotion answers before the generic row is fallen through to, a USER part claims a structure the name heuristic would give another region to, and a press says that part's line — locally, and then with the part named in the `POST /vrmpet3d/say` the host answers (a drag says nothing at all). Also drives the desktop page's glue against a fake bridge: drag, throw, zoom limits, orbit, the gaze from the launcher's cursor, the rectangle click-through depends on, and a press on ITS pet saying the part's line in its own bubble. And it boots the REAL 通用设置 document for the per-clip texts the operator asked for (2026-10-13): a 碎碎念 box on every ticked clip's row showing the stored line, an AI 提示词 box beside it that is HIDDEN while 台词来源 is the built-in table and shown the moment the source goes to AI 生成 — the same decision that hides the AI block — the edit reaching the store as a patch through the row's own write path, and the widget's own resolution (`scene.playback`/`scene.pickState` handed to `SpeechMachine.observe`, with both the state's box and the clip given a line so a machine that ignored the clip would answer the pool and fail), a click and a hold drawing from their own shipped pools through `notePress`, and — the fix for a pet that froze in a throttled window (2026-10-14) — the BACKGROUND pump driven on a page whose ticks are all by hand: the drivers installed the way `start()` installs them, the frame clock stamped into the past, a pump required anyway, one more required SYNCHRONOUSLY on a `focus` event, and the page handed back with no interval left running |
| `desktop` | Node + a real Electron window | the bare-Electron runtime borrowed from the installation by hard links, the spawn environment (the `ELECTRON_RUN_AS_NODE` trap), the command line, the lifecycle, the right-click menu the REAL window opens (from the shared module, module flag and DOM hit test included), **the right-drag orbit measured with real mouse events (the view must keep turning while the pointer travels away from the pet), the pointer CAPTURE on the secondary press that makes it hold, and the `orbiting` report that stops the launcher making the window click-through mid-drag** — the pointer lock is attempted too but is a bonus, since Windows refuses to focus this deliberately unfocusable window, the settings page's own sections (状态 / 视线 / 大小 / 碎碎念 with its per-state boxes and AI controls / 部位, whose editor is DRIVEN in the real window: 新增部位, a typed structure becoming a chip, the chip's 前缀→精确 toggle and its removal / 模型导入 / 动作导入), and a **real launcher window** asked to prove itself: always on top, transparent, screen-sized, drawing pixels with an alpha channel |
| `docs` | Node, 8 s | documented paths, commands and check counts match reality |

`node scripts/verify-all.mjs` runs them all. Browser suites skip (not fail) when no
Chromium is available; `clientchunk` also skips when the installed `app.asar` cannot
be found, because a delivery test against a fake loader would prove nothing. The
`desktop` suite runs its Node half everywhere and **skips only the live window** when
there is no installation to borrow an Electron from (set `VRMPET3D_DESKTOP_RUNTIME` to
name a standalone one), because the pet is fully usable without the window.

`clientchunk` is the newest and the least obvious. It extracts
`@deepseek-ai/dsh-client-modules/lib/client.js` **verbatim from the installed
`app.asar`** and runs it in a page beside the real chunk files, which are handed to
the loader's transport as payload strings rather than inlined as `<script>` tags — so
the URL the loader composes is observable, and asserting its shape means something.
It is the only suite that could have caught the failure described in §3b.

**Authored motion is verified outside this list**, by `scripts/verify-motion.mjs`:
it needs a model and a motion file, and neither may be committed here. The fixtures
are synthesized by `scripts/make-motion-fixtures.mjs` and
`scripts/make-vrma-fixtures.mjs`, so they carry no third-party terms. That suite is
where "the clip actually moves a bone" is asserted, because a clip that parses and
binds to nothing is the characteristic failure of both formats. **It is not one of the nine suites**, and
since 2026-10-12 it is kept on disk rather than wired in — together with
`scripts/make-fixtures.mjs` (the downloaded MMD sample) and `scripts/make-motion-fixtures.mjs` (the `.vmd`
fixture): both feed only a format `Scene.loadMotion` now refuses, so only the VRMA half of this paragraph
still describes this build.

The **2331** the docs quote is the sum of the suites that print an assertion count,
plus one for each suite that reports a verdict or a hash instead (`load`, `vendor`).
`docs` deliberately excludes its own assertion count: including it is circular,
because that count depends on whether the documented total matched, so a single run
could never converge. (This paragraph used to quote 874, a figure it had carried since
long before the current suites; it was replaced by the real total on 2026-10-12, when
`check-docs.mjs` was re-run over the renamed, VRM-only tree.)

The asset route is served from a real `node:http` server in `host+model`, not a
hand-rolled fake response: the handler streams with `createReadStream(...).pipe(res)`,
which needs a real writable stream, and a stub that only implements
`writeHead`/`end` turns every successful serve into a 500 — so a fake could not
tell a working route from a broken one.

Browser suites inline everything into one page. `--dump-dom` returns as soon as the
document is parsed and does not wait for external `file://` scripts, so a
`<script src>` probe reports a false failure.

## Known limits

* **Not published to npm.** Install by pointing a profile at this folder.
* **MMD is not supported at all (2026-10-12), which supersedes the old "no physics for MMD" limit.**
  A PMX/PMD model is refused by name before a loader is reached, and a `.vmd` likewise, so there is no MMD
  avatar whose hair could swing or not swing. A VRM's SpringBone is the only chain physics here, and it
  works with an authored motion loaded. (The retired limit read: "Hair and tails on a PMX model do not
  swing; a VRM's SpringBone does.")
* **Authored motion is opt-in, VRMA-only, and not retargeted.** The idle is
  procedural by default; a `.vrma` file plays only where the user assigns
  one to a state. It drives VRM humanoid bones, so it cannot drive an avatar with no humanoid rig, and it
  is never converted from or to another format — a `.vmd` is recognised and refused rather than converted.
  NINE states carry a row since 2026-10-13 (「缺少拖动时模型动作的设置」): the six DSH is in, plus `held` / `falling` /
  `landing`. A clip on one of those three is the POSE; where the pet IS stays the drag physics' business, and the
  frozen `setDragMotion` lag and the placement integration are untouched by it.
* **VMD camera, light and self-shadow tracks are moot (RETIRED 2026-10-12).** No VMD is played at all now.
  When one was, only its bone and morph tracks were read, because the pet's camera belongs to the viewport
  framing and this is a desktop pet rather than a video renderer.
* **A VRM stands in a relaxed pose made by the plugin, not in its own rest pose.**
  A VRM's rest pose is a **T-pose** by specification, so a freshly loaded VRM renders
  with both arms straight out, and the plugin's idle only writes breathing and gaze.
  The scene therefore derives a stand from the rig at load time
  (`core.aimDownQuaternion` + `dropArm`: take the bone's own shoulder→elbow direction
  and swing it toward world down, clamped to 75°, expressed in that bone's local space
  so no sign table or bone-roll assumption is needed) and re-applies it after every
  `resetNormalizedPose()`. Measured on a real 26 MB VRM: the arm's downward component
  goes from **0** (horizontal, the model's rest) to **−.9662** on the normalized rig
  and the *skinned* bones follow. An authored clip overrides the stand while it plays,
  which is why the stand is re-applied on reset rather than baked in once.
  * **`aimDownQuaternion` must return a UNIT axis, and it did not until 2026-10-12.**
    The axis is the cross product of the limb direction and the target, whose length is
    `sin(angle)` — unit only when the limb happens to be exactly perpendicular to down.
    The old code called `normalize3` purely as a truthiness test and returned the raw
    cross product, so the caller handed `setFromAxisAngle` (which does **not** normalise)
    an axis scaled by `sin(angle)`, and the arm quaternion came out `|q| = 0.999599` on
    `SampleModel.vrm` (arm 87.3342° from perpendicular). Nothing visible broke — three.js
    normalises on the way to the matrix — but any consumer that treats a pose quaternion
    as unit reads the length as a rotation. `verify-motion.mjs` did exactly that: its two
    rest-pose checks compared two byte-identical quaternions with `Quaternion.angleTo`
    and reported a **4.59° residual**, failing on every clip that drives an upper arm —
    including all-humanoid test fixtures. Both halves are fixed: the maths returns a unit
    axis, and the probe divides the lengths out (`rotationBetween`) so a scale factor can
    never masquerade as a pose regression again.
* **VRM bone writes must go through `humanoid.update()` — the procedural path now
  does, every frame.** three-vrm keeps the normalized humanoid nodes in a separate tree
  from the bones the mesh is skinned to. Without the sync, the idle writes land on a
  rig nobody can see: measured in the live app on 2026-10-08, a real VRM loaded and
  rendered as a frozen T-pose. Two consequences are easy to get wrong:
  * the sync also has to happen **before** the SpringBone step, or the hair follows the
    previous frame's pose;
  * `update()` propagates **rotation for every bone but translation only for the hips**,
    so a breathing *lift* written on the chest is discarded no matter what. The VRM
    breath is therefore a small chest **pitch** (measured: the skinned chest turns
    0.54° over ten idle frames, with 0.0008 of positional drift).
* **DRACO and KTX2 compression are unsupported.** Both loaders build decoder URLs
  from `import.meta.url` as a module side effect, and an IIFE bundle has no
  `import.meta`, so importing either throws `TypeError: Invalid URL` at load and
  takes the whole chunk down. Neither is used by a VRM (nor by the plain glTF/GLB models this plugin
  loads beside it).
* **The pet does not survive a page refresh as a running instance** — the plugin
  remounts and reloads the model. That is DSH's plugin lifecycle, not a bug here.
* **The imported-directory route is driven by the settings page, not by the pet.** `/vrmpet3d/models` is
  implemented and verified over real HTTP, and 通用设置 → 模型导入 reads and writes it; a user cannot reach it from
  the pet's own controls, which is the point — the pet's right-click menu is about the pet.
* **`modelScale` is a config-only preference now.** It has no slider any more — it was
  the control that let an enlarged model overflow its frame — but the profile config
  still honours it, and it is folded into the pet's slot alongside `size`. The 复位
  button beside 应用内大小 on the 通用设置 page restores both.
* **The view orbit has no on-screen readout.** A long right-drag
  can leave the camera at an odd angle; the pet's own menu has 重置视角 for exactly that
  (camera only), and 通用设置 → 显示与外观 has a 复位视角 button.
  `VrmPet3DWidget.prototype.reset` — the deleted panel's whole-pet 重置, which cleared every
  preference — is now unreachable from any surface; it was kept rather than deleted because
  the distinction between it and `resetView` is the decision, and a future entry may want it.
  Nothing surfaces the current yaw or pitch.
* **Both pet plugins can be installed at once.** `dsh-plugin-fatfish-pet` and this
  one both register into `shell.overlay` and would draw on top of each other.
  Disable one.

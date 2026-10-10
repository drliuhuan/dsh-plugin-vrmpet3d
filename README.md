# dsh-plugin-vrmpet3d

A **3D desktop pet** for DeepSeek Harness. It renders a VRM — or a plain glTF/GLB — on a transparent WebGL layer,
floats it over the application frame, and drives it from live session status: working while a turn runs, asking for
attention when an approval is waiting, celebrating when a turn completes, napping when nothing has happened.

It ships **one redistributable model** ([assets/models/SampleModel.vrm](assets/models/SampleModel.vrm)) as the
default, so a fresh install shows a real pet with nothing to configure.

```
no runtime dependencies · 9 verification suites · 1945 checks · works offline
```

**VRM and plain glTF only.** A `.pmx`/`.pmd` model or a `.vmd` motion is refused by name — the bytes are still
sniffed, so the error says which format it found — and [docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md) keeps the
retired MMD chapters.

## What it does

| | |
|---|---|
| **Models** | VRM 1.0 / 0.x, glTF/GLB — MToon materials, expressions, SpringBone and node constraints intact |
| **Motions** | `.vrma`, assignable per state, looping or one-shot |
| **Behaviour** | idle breathing, tail / ear / hair follow-through, pointer gaze, the cursor's draught across the pet, drag, throw, wall and ceiling bounce, landing |
| **States** | `resting` `working` `waiting` `celebrate` `sleeping` `error` `greeting` `offline` `held` `falling` `landing`, all driven by DSH's own turn boundaries |
| **Two surfaces** | the pet inside DSH's overlay, and a floating always-on-top, click-through window |
| **One menu** | right-click either pet: 重置视角 / 重置大小 / 通用设置 / 当前模型参数设置 / 切换表面 / 重力 / 隐藏宠物 |
| **Two settings pages** | 模型参数 (per model) and 通用设置, over `/vrmpet3d/config` and `/vrmpet3d/global` |
| **Voice** | the status prompt above the head, plus 碎碎念 from built-in tables, your own lines, or a model (a DSH provider or any OpenAI-compatible endpoint) |
| **Parts** | your own 部位 rows — a label, the structures it owns, an emotion and a 碎碎念 — matched against the model's real bone/mesh names |
| **Privacy** | turn boundaries and session counts only. Never session text, tool arguments or attachments |
| **Dependencies** | none at runtime; the 3D stack is one committed chunk ([lib/client.vendor.js](lib/client.vendor.js)) |

## Requirements

* **DeepSeek Harness** 0.2.0-rc.2 or later (the plugin is a DSH bundle; it declares `dsh.bundle.patch`).
* For the floating window: an **Electron runtime**, which the launcher borrows from the DSH installation by hard
  links. Without one the pet still works inside DSH.
* For the scripts: **Node 22+**. A Chromium-based browser (Edge or Chrome) for the browser suites.
* A model file. The bundled SampleModel is the default; your own VRMs go in any folder you import (see below).

## Install

The plugin is **not published to npm**. Two ways in:

**Through the running app's plugin manager** — add this folder as a bundle with a `link:<absolute path>` spec. It
applies to a live profile immediately, with no restart.

**By hand**, exactly as `dsh plugin add` would:

```bash
node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop" --dry-run
node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
```

The manual route needs a DSH restart (this build watches no module roots, so a running app will not pick the plugin
up); so does a later **edit** to the plugin, because the host half is not hot-reloaded. To roll back, restore
`package.json.bak-<stamp>` in the profile directory and delete the profile's `node_modules` — or remove the bundle
through the plugin manager, which reverses the same three changes.

> **⚠️ A restart is not enough: check the PROFILE, not just the code.** A running DSH writes its profile back to
> disk, and **a bundle its in-memory tree does not know about is dropped** — so a plugin that was disabled in the
> manager and then had the app write the profile is gone from `dsh.profile.bundles`, and the next restart composes
> no pet at all: no window, no `/vrmpet3d/*` routes, nothing on screen to explain it. One command answers that, and
> it is the only check in this project that looks outside this tree:
>
> ```bash
> node scripts/check-profile.mjs --profile "$HOME/.dsh/profiles/desktop"
> ```
>
> Disable any other pet first — `dsh-plugin-fatfish-pet` and `dsh-plugin-whale-pet` register into the same
> `shell.overlay` slot.

## Quick start

1. Restart DSH (or use the plugin manager) and the pet appears in the corner of the window.
2. **Right-click it** → 通用设置 → 碎碎念 to choose whether it speaks, from which source, and how often.
3. **Right-click it** → 当前模型参数设置 → 模型导入 to add the folder your `.vrm` files live in; pick one from
   模型 and it loads immediately.
4. Everything else — per-state motion, expressions, mouth shapes, gaze, the two sizes, hair physics, the nap
   timeout — is on those two pages, and each change applies without a restart.

### Using it

| Gesture | What happens |
|---|---|
| drag | the pet follows the cursor, leaning and trailing with it |
| release after a throw | it flies, bounces off the walls and the floor, and lands |
| click | a greeting, and the part you clicked reacts (see 部位) |
| long press | 长按 — a state the 表情 table can answer |
| wheel over the pet | zooms **the pet and its text** together |
| wheel over the text | scales **only** the text |
| right-drag | orbits the view (the pointer is captured, so it keeps turning as the mouse travels) |
| right-click | the shared menu above |

## VRM only

A `.pmx`/`.pmd`, or a `.vmd` motion, is **refused by name** rather than half-loaded: the file's magic bytes (or the
VMD banner) are still recognised, so the message can name the format and point at
[docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md), where the retired MMD chapters are kept. Models are yours and stay
yours: nothing is copied into the plugin folder, and the catalog is built from the directories you import.

## Verification

**9 verification suites, 1945 checks.** The narrow suite for a change is in [AGENTS.md](AGENTS.md); the whole tree is
one command, and it is the operator's call rather than a reflex:

```bash
node scripts/verify-all.mjs     # runs the nine below, cheapest first
```

| Command | Checks |
|---|---|
| `node scripts/verify.mjs` | 1018 — state machine |
| `node scripts/verify-model.mjs` | 541 — model catalog |
| `node scripts/verify-browser.mjs --page chunk-delivery` | 39 — DSH's own module system delivering the committed chunks |
| `node scripts/verify-browser.mjs` | 13 — the 3D stack, framing and loaders in a real browser |
| `node scripts/verify-browser.mjs --page client-test` | 90 — the widget, the menu and the desktop page end to end |
| `node scripts/verify-desktop.mjs` | 242 — the pet's own window, borrowed Electron and all |
| `node scripts/check-plugin-load.mjs` | the manifest, activation and clean disposal |
| `node scripts/vendor-build.mjs --check` | the committed 3D chunk is reproducible from the pinned versions |
| `node scripts/check-docs.mjs` | documented paths, commands and counts match reality |

The suites that need a browser skip (not fail) without one, and `verify-desktop.mjs` skips when there is no
installation to borrow an Electron from. Two habits this project cares about: after editing
[lib/core.js](lib/core.js), [lib/scene.js](lib/scene.js) or [lib/menu.js](lib/menu.js) run
`node scripts/client-chunks.mjs` (the delivered chunks are committed copies, and a stale one is a silent failure —
`--check` is the one-second assertion), and report a partial run as a partial run ("core: 1018 passed"), never as
"all green".

## Project layout

```
lib/        the plugin: core.js (rules) · index.js (host routes) · scene.js (renderer)
            client.js (in-app pet) · desktop-page.js (floating window) · config-page.js (settings)
            client.*.js — the DELIVERED chunks, generated, never hand-edited
desktop/    the launcher: the window, the always-on-top rules, the self-test
scripts/    the suites and the tools
docs/       ARCHITECTURE.md (design) · ASSET-CONTRACT.md (model/motion files) · models/
assets/     the one bundled model
vendor/     the pinned 3D stack (build-time only; the chunk is committed)
```

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how it is put together and why, in depth.
* [HANDOFF.md](HANDOFF.md) — the current state: what to do next, frozen zones, environment facts, gotchas.
* [AGENTS.md](AGENTS.md) — the working rules: which suite covers which change, and what "partial" never means.
* [docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md) — what a model or motion file must be, and the retired MMD
  chapters.

## License

MIT — see [LICENSE](LICENSE). It bundles other MIT-licensed software as one generated file
([lib/client.vendor.js](lib/client.vendor.js)): three.js, `@pixiv/three-vrm` and `@pixiv/three-vrm-animation`. It
ships exactly one 3D model file, [assets/models/SampleModel.vrm](assets/models/SampleModel.vrm), whose own embedded
metadata allows redistribution, modification and commercial use with no attribution required; every other model is
the user's and stays under its own author's terms.

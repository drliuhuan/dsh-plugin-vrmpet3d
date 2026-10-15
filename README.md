# dsh-plugin-vrmpet3d

A **3D desktop pet** for DeepSeek Harness. It renders a VRM — or a plain glTF/GLB — on a transparent WebGL layer,
floats it over the application frame, and drives it from live session status: working while a turn runs, asking for
attention when an approval is waiting, celebrating when a turn completes, napping when nothing has happened.

It ships **two models**, both redistributable with it, so a fresh install shows a real pet with nothing to
configure: [assets/models/BlueFatFish.vrm.br](assets/models/BlueFatFish.vrm.br) (蓝色小肥鱼Deepseek, by 木子恶魔 — the
default) and [assets/models/SampleModel.vrm.br](assets/models/SampleModel.vrm.br) (ヴィータ, by VRoid プロジェクト — the
fallback). The source, the author and the terms of each are in
[assets/models/README.md](assets/models/README.md), and the same credit is printed under the grid on 切换模型.

```
no runtime dependencies · works offline
```

**VRM and plain glTF only.** A `.pmx`/`.pmd` model or a `.vmd` motion is refused by name: the file's own bytes are
sniffed as it is loaded, so the message names the format it found instead of failing halfway through a load.

## What it does

| | |
|---|---|
| **Models** | VRM 1.0 / 0.x, glTF/GLB — MToon materials, expressions, SpringBone and node constraints intact |
| **Motions** | `.vrma`, per state and per clip 循环/单次 — a finished one-shot chains into the state's loop or holds its last frame, never loops itself — and the bundled pack ships in `assets/motions/` with the operator's own state→clip mapping as the default |
| **Behaviour** | idle breathing, tail / ear / hair follow-through, pointer gaze, the cursor's draught across the pet, drag, throw, wall and ceiling bounce, landing |
| **States** | `resting` `working` `waiting` `done` `sleeping` `error` `greeting` `offline` `dancing`, plus the pointer poses `held` `falling` `landing` — all driven by DSH's own turn boundaries, except 跳舞 which is yours (跳支舞 on the menu) |
| **Two surfaces** | the pet inside DSH's overlay, and a floating always-on-top, click-through window |
| **One menu** | right-click either pet: 重置视角 / 重置大小 / 通用设置 / 切换模型 / 跳支舞 / 重载模型 / 当前模型参数设置 / 切换表面 / 重力 / 隐藏宠物 |
| **Two settings pages** | 模型参数 (per model) and 通用设置, over `/vrmpet3d/config` and `/vrmpet3d/global` |
| **Model picker** | 切换模型, over `/vrmpet3d/picker`: drop a `.vrm`/`.glb` on the big target (or click it) and click a thumbnail to switch — a progress bar covers the load, the picker refuses input while it runs, and it is the SAME component the guide's 偏好模型 step mounts |
| **First-run guide** | 欢迎 / 偏好模型 / 桌宠界面 / AI 碎碎念 / 完成, over `/vrmpet3d/setup` — 模型动作 is hidden and 桌宠界面 is skipped where no independent pet can exist (dsh web), which is why the stepper carries no numbers; it appears once per start until it is finished |
| **Voice** | the status prompt above the head, plus 碎碎念 from built-in tables (20–41 lines per state, Chinese and English, in the shipped character's voice), your own lines, or a model (a DSH provider or any OpenAI-compatible endpoint) — the shipped lines arrive IN your own boxes, so they are yours to edit |
| **Parts** | your own 部位 rows — a label, the structures it owns, an emotion and a 碎碎念 — matched against the model's real bone/mesh names |
| **Privacy** | turn boundaries and session counts only. Never session text, tool arguments or attachments |
| **Dependencies** | none at runtime; the 3D stack is one committed chunk ([lib/client.vendor.js](lib/client.vendor.js)) |

## Requirements

* **DeepSeek Harness** 0.2.0-rc.2 or later (the plugin is a DSH bundle; it declares `dsh.bundle.patch`).
* For the floating window: an **Electron runtime**, which the launcher borrows from the DSH installation by hard
  links. Without one the pet still works inside DSH.
* A model file. The bundled BlueFatFish is the default; your own VRMs are imported as files, copied into the
  plugin's own storage (see below).

## Install

The plugin is **not published to npm**. Add it through the running app's **plugin manager** as a bundle with a
`link:<absolute path to this folder>` spec, then restart DSH: this build watches no module roots, so a running app
does not pick a new bundle up by itself, and the host half is not hot-reloaded.

A later **edit** to the plugin needs the same restart. To remove it, drop the bundle in the plugin manager — that
reverses the same changes — or restore the `package.json.bak-<stamp>` the manager left in your profile directory.

> **⚠️ A restart is not enough: check the PROFILE, not just the code.** A running DSH writes its profile back to disk,
> and **a bundle its in-memory tree does not know about is dropped** — so a plugin that was disabled in the manager and
> then had the app write the profile is gone from `dsh.profile.bundles`, and the next restart composes no pet at all:
> no window, no `/vrmpet3d/*` routes, nothing on screen to explain it. Open the plugin manager and check that
> `dsh-plugin-vrmpet3d` is still listed before you blame the pet.
>
> Disable any other pet first — `dsh-plugin-fatfish-pet` and `dsh-plugin-whale-pet` register into the same
> `shell.overlay` slot.
## Quick start

1. Restart DSH (or use the plugin manager) and the pet appears in the corner of the window — with the **first-run
   guide** open in front of it, which walks through the five steps below and then never comes back (重新运行引导 in
   通用设置 opens it again). 稍后配置 closes it without finishing, and the next start offers it once more.
2. **Right-click it** → 通用设置 → 碎碎念 to choose whether it speaks, from which source, and how often.
3. **Right-click it** → 通用设置 → 模型导入 to pick a `.vrm`/`.glb` **file**; it is copied into the plugin and loads
   immediately, and 模型 on the model page switches between what is imported.
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
VMD banner) are still recognised, so the message names the format it found.

**An import COPIES, and that is the point.** A model is imported as a FILE (通用设置 → 模型导入, or the first-run
guide) and a motion pack as a FOLDER; either way the bytes are copied into the plugin's own state directory
(`<profile>/vrmpet3d-desktop/`) and both catalogues read them from there. So the folder you picked it out of can move,
be renamed or disappear without the pet losing anything — a recorded path was a live dependency on somebody else's
folder, which is exactly the bug the file import replaced. Removing an import deletes **only** the plugin's own copy,
and `assets/motions/` — the shipped pack — is never touched by any of it.

**A motion pack ships with the plugin.** `assets/motions/` holds the operator's own `.vrma` clips, and — unlike
imported model or motion directories — they are offered from the first scan, with no directory to import: they
are read from the plugin's own folder, the way the bundled `SampleModel.vrm.br` is. The pack is filed **one folder per
state** (`idle/`, `working/`, `attention/`, `success/`, `fail/`, `offline/`), and that filing IS the mapping: each
state's picker offers only its own folder, so one list is never every clip the operator has authored. That folder's
`vrmpet3d-motions.json` is the pack's own answer for a fresh install, in three blocks: `clips` (per file, 循环/单次),
`defaults` (which clips each state draws) and `template` (per state AND clip: 循环/表情/口型/凝视). All three ship
**filled with the operator's own configuration** — his state mapping and the face, gaze and play mode he gave every
clip — written by FILE NAME rather than by a profile's ids, so the defaults survive a different machine and the next
clip added to the pack. Anything you set in 通用设置 → 状态与动作 wins over it, field by field, and 「跟随情绪」 is there
to take a template's face back.

**A large clip may be stored compressed, as `<name>.vrma.br`.** Dance clips are megabytes, so the pack keeps them
brotli-compressed and the plugin unpacks one into memory when it plays; nothing else changes, and the clip is
listed as the VRMA it is (marked 已压缩). Brotli rather than LZMA2 because Node cannot decode LZMA without a dependency
this plugin does not have; the measurements are in [assets/motions/README.md](assets/motions/README.md).

## What ships

```
lib/        the plugin: core.js (rules) · index.js (host routes) · scene.js (renderer)
            client.js (in-app pet) · desktop-page.js (floating window) · config-page.js (settings)
            client.*.js — the DELIVERED chunks, generated, never hand-edited
desktop/    the launcher: the window, the always-on-top rules, the self-test
assets/     the two bundled models (BlueFatFish.vrm.br · SampleModel.vrm.br)
            and the motion pack (assets/motions/, one folder per state)
initial-config/  the settings this release was built from, as a record
```

## License

MIT — see [LICENSE](LICENSE). It bundles other MIT-licensed software as one generated file
([lib/client.vendor.js](lib/client.vendor.js)): three.js, `@pixiv/three-vrm` and `@pixiv/three-vrm-animation`. It
ships exactly two 3D model files, and both may be redistributed with it:

| file | model | author | source | terms |
| --- | --- | --- | --- | --- |
| [assets/models/BlueFatFish.vrm.br](assets/models/BlueFatFish.vrm.br) | 蓝色小肥鱼Deepseek | 木子恶魔 | <https://www.aplaybox.com/details/model/ayXkRzVflmnd> | 经作者授权分发 — credited here as the author asks |
| [assets/models/SampleModel.vrm.br](assets/models/SampleModel.vrm.br) | ヴィータ | VRoid プロジェクト | <https://vroid.com/en/studio> | its own embedded licence: redistribution, modification and commercial use allowed, no attribution required |

The first is what a fresh profile resolves to; the second is the fallback. Every other model is the user's and stays
under its own author's terms.

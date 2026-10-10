# dsh-plugin-vrmpet3d

A **3D desktop pet** for DeepSeek Harness. It renders a VRM — or a plain glTF/GLB — on a
transparent WebGL layer that floats above the whole application frame, and drives
its behaviour from live session status — so the pet works while a turn runs, asks
for attention when an approval is waiting, celebrates when a turn completes, and
naps when nothing has happened for a while.

It also ships **one redistributable model** — the default, `assets/models/SampleModel.vrm` — so a fresh
install shows a real pet with nothing to configure and no third-party asset of your own.

```
npm-free at runtime · 9 verification suites · 1945 checks · works offline
```

---

## What it does

| | |
|---|---|
| **Model formats** | VRM 1.0 / 0.x (`.vrm`), glTF/GLB (`.glb`, `.gltf`) — **VRM and plain glTF only**: a `.pmx`/`.pmd` is sniffed by its magic bytes and refused by name |
| **Motion formats** | VRM `.vrma`, assignable per state — **VRMA only**: a `.vmd` is sniffed by its banner and refused by name |
| **Rendering** | three.js r186 + `@pixiv/three-vrm` + `@pixiv/three-vrm-animation`, MToon materials intact |
| **Companion behaviours** | idle breathing, tail / ear / hair follow-through, pointer gaze, drag, throw, wall bounce, land |
| **Session-driven states** | `resting` `working` `waiting` `celebrate` `sleeping` `error` `greeting` `offline` `held` `falling` `landing` |
| **Settings** | TWO pages — 模型参数 (per model) and 通用设置 — hold every preference: model picker, per-state motion picker, the two sizes, motion, pointer gaze, hair physics, nap timeout, hide/restore, 调试模式 (both pets on screen at once) |
| **Pet menu** | a right-click on either pet opens the SAME menu (重置视角 / 重置大小 / 通用设置 / 当前模型参数设置 / 切换表面 / 重力 / 隐藏宠物-or-关闭独立宠物), from one shared definition |
| **Privacy** | reads turn boundaries and session counts only. Never session text, tool arguments or attachments |
| **Dependencies** | none at runtime. The 3D stack is vendored as one committed chunk |

## Install

The plugin is **not published to npm**. There are two ways in, and the first needs
no restart:

**Through the running app's plugin manager.** Add this folder as a bundle with a
`link:<absolute path>` spec — it applies to a live profile immediately, so the app
picks the plugin up without a restart.

**By hand**, exactly as `dsh plugin add` would:

```bash
# from the folder that contains this project
node dsh-plugin-vrmpet3d/scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop" --dry-run
node dsh-plugin-vrmpet3d/scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
```

The manual route needs a DSH restart (this version has no user-patch watcher, so a
running app will not pick the plugin up). The plugin-manager route does not — but a
later **edit** to the plugin still needs one, because host modules are not
hot-reloaded here.

Both pets register into `shell.overlay`, so if `dsh-plugin-fatfish-pet` or
`dsh-plugin-whale-pet` is installed, disable one of them.

To roll back, restore `package.json.bak-<stamp>` in the profile directory and
delete the profile's `node_modules` — or remove the bundle through the plugin
manager, which reverses the same three changes.

### ⚠️ After any restart: check the profile, not just the code

**The pet can vanish while every test in this repository stays green**, because the
failure is in the profile rather than in the tree. A running DSH app writes the
profile back to disk from the composition it holds in memory, and **a bundle its tree
does not know about is dropped** — so a plugin that was disabled in the manager and
then had the app write the profile is gone from `dsh.profile.bundles`. The next
restart composes no `vrmpet3d` row at all: no pet, no `/vrmpet3d/*` routes, nothing on
screen to explain it.

Measured on 2026-10-10: `package.json` was rewritten at 16:13:50 and
`dsh-plugin-vrmpet3d` was no longer in `dsh.profile.bundles`; `/vrmpet3d/catalog` answered
**404**. That is the whole of "插件挂了".

One command answers it, and it is the only check here that looks outside this tree:

```bash
node scripts/check-profile.mjs                 # or: pnpm run verify:profile
```

* **exit 0** — the profile is wired and the running app's client half is live;
* **exit 2** — the profile is correct and the RUNNING APP is what disagrees, in either of
  two ways, and the output says which: the plugin is not composed in the app at all
  (**restart DSH** — the composition is built at startup, so a running app keeps the tree
  it booted with), or it is composed but the client half has not published a state yet
  (**reload the DSH page** — the browser module table is built at page load, so a bundle
  enabled after the page was opened is not in it). If it still does not appear after a
  reload, the client half's own reason is reported as `error` by `/vrmpet3d/state`;
* **exit 1** — the profile itself is broken. The output names the missing piece and
  the repair:

```bash
node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
# then restart DSH
```

The same script is what a fresh install uses, so "reinstall after a restart" is a
one-liner and never a re-edit of the profile by hand.

## Quick start

1. **See it work with no model of your own.** On first run the pet is the bundled
   `assets/models/SampleModel.vrm`, which `core.resolveModelId` picks out of the
   catalogue; it appears bottom-right of the window. With nothing catalogued at all the
   pet shows nothing and says so — there is no stand-in avatar any more.
2. **Add your own models.** Put `.vrm` / `.glb` / `.gltf` files in a folder and
   tell the plugin where it is by adding a config row:

   ```yaml
   # in the profile's cordis config, on the vrmpet3d row
   - id: vrmpet3d
     name: dsh-plugin-vrmpet3d
     config:
       modelDirs:
         - D:/my-models
       motionDirs:
         - D:/my-motions
   ```

   The files are scanned recursively (bounded to 4000 entries and 8 levels deep).
   Open the pet's menu with a **right-click** or **double-click**, choose 当前模型参数设置, and pick a
   model from the list.
   **Or add a folder from the UI**: 通用设置 → **模型导入** has a 选择文件夹— button (a native
   folder picker, through the launcher), a 手动输入路径 fallback for a window without that bridge, the list of
   directories already imported with a 移除 beside each, and the host's own message when a path is refused.
   Imports are live immediately — the model list is rebuilt on every request — and survive a restart.
   **Motions have their own section, 动作导入**, over the same pattern and the same dialog: point it at a folder of
   `.vrma` and the clips appear in the 状态 checkboxes at once (the write's own reply carries the rebuilt
   catalog, so no reload is needed), and an imported directory can be removed without touching the files.
   A `.vmd` in there is not played at all: it is recognised by its banner and refused by name (VRMA only).
3. **Give it a motion, if you have one.** Pick a `.vrma` for any state
   in 通用设置 → 状态与动作; see "Authored motion" below.
4. **Play with it.** Drag it anywhere, throw it and watch it fall, click it for a
   greeting, scroll on it to resize it, right-click for the pet's own menu.

## Using it

| Gesture | Effect |
|---|---|
| Drag | Lift the pet; it dangles while held |
| Release | Falls under gravity and bounces off the floor, the side walls **and the top edge**, then holds a landing pose |
| Wheel | Resize the pet — from a 40 px long edge up to the frame's shortest edge (the only size control on the pet itself) |
| Right-drag | Orbit the camera — turn the view, without turning the pet |
| Click | Greeting |
| Right-click / double-click | The pet's own menu |
| `Enter` / `Space` on the pet | Greeting (keyboard) |

A right-**click** opens the pet's menu and a right-**drag** orbits the view, on the
same button: the two are told apart by whether the pointer moved. The right button opens it on the app pet AND in
the floating window; a DOUBLE-click does not (it did until 2026-10-12). The menu is the SAME
seven rows on both pets, from one shared definition (`lib/menu.js`), in this order:

| Entry | What it does |
|---|---|
| 重置视角 | Puts the CAMERA back to its default angle — deliberately not a whole-pet reset |
| 重置大小 | Puts the pet's size back to 100% |
| 通用设置 | Opens `/vrmpet3d/global` (显示与外观 / 视线 / 鼠标互动与物理 / 状态与动作 / 碎碎念 / 模型导入 / 动作导入) |
| 当前模型参数设置 | Opens `/vrmpet3d/config` for the model on screen (模型 / 表情 / 部位 / 弹簧骨) |
| 切换回窗口外 | Hands the pet to the floating window — **only the in-app pet has this row**, because it is the only way out of DSH. The window does not show it: its own 关闭独立宠物 already hands the pet back, so the duplicate was removed (operator, 2026-10-12). **非debug模式生效**: under 调试模式 both pets are already on screen, so the row is DISABLED with a tooltip saying why |
| 重力 | A SWITCH, and each pet has its OWN: off means no throwing and no falling, so the pet can be put down anywhere and it stays; on restores both. A check mark shows which way it is thrown, and a tooltip explains the off state |
| 隐藏宠物 (in-app pet) / 关闭独立宠物 (floating window) | ONE row with the two meanings the two surfaces actually have: the app's pet goes away until the **显示宠物** button in DSH's bottom-right corner is pressed, and the window's pet is handed back INSIDE the app — which is the only thing closing that window can mean, since the window IS the pet's box |

**This menu replaced two settings panels.** Until 2026-10-12 each pet grew its own panel of settings,
so "where do I turn physics off" depended on which pet you were looking at. Every preference now has
exactly one home — one of the two settings pages above — and the menu is only about the PET: its view,
its size, its gravity, which surface shows it, and whether it is on screen.

**重启 DeepSeek Harness and 退出 DeepSeek Harness are GONE**, and so is everything behind them: the entries, the
two failure lines, the harness module and the `/vrmpet3d/harness` route it served (operator, 2026-10-12: 「内置宠物和外置宠物都去掉
关闭和重启dsh的功能和项目」). A plugin can only ask the host to quit — it cannot quit or relaunch itself — so
those two rows were the app's lifetime behind a right-click, and the operator removed them.

## What a model contains

The host reads a model file and answers `GET /vrmpet3d/model-info?m=<id>` with everything the settings
window needs to build itself: **expressions** (name, preset, and the morph target each one drives),
**spring-bone chains** with the physics the file declares, materials, textures, mesh counts, and the
**licence** the author wrote into the model. It is read from the file rather than from a running
renderer, so the list exists with no pet open and always matches the model that is loaded.

That is not a nicety: plenty of authored models leave their morph targets **unnamed**
(`primitive.extras.targetNames` absent), and then the VRM expression table is the only thing
that knows target #0 is `blink` rather than, say, `aa`. The route reports the reverse
map for exactly that reason, and 蓝色小肥鱼.vrm is such a model — see
`docs/models/蓝色小肥鱼.md`.

Both VRM flavours are handled (0.x `VRM.blendShapeMaster` / `secondaryAnimation`, and
1.0 `VRMC_vrm.expressions` / the separate `VRMC_springBone` extension). A file that is
not a GLB or VRM is answered as *undescribable*, with a reason, rather than failing. A PMX/PMD never
reaches that answer: it is not catalogued, and the renderer sniffs it and refuses it by name —
`PMX is not supported: this build loads VRM only (see docs/ASSET-CONTRACT.md).`

The same parser is a command line, for looking at a model by hand:

```bash
node scripts/vrm-report.mjs "<model.vrm>"           # readable report
node scripts/vrm-report.mjs "<model.vrm>" --json    # the same data as JSON
node scripts/vrm-report.mjs "<model.vrm>" --thumb thumb.png
```

## The two settings pages: 模型参数 and 通用设置

Everything a model can be told to do lives in one window: **the expressions it has**, offered by name to the
things that choose one — a state's or a clip's 表情 / 口型 row in 状态与动作, and the emotion rows of a 部位 —
plus the **behaviour switches** (blinking with its interval; emotions
on click, on drag release, and on their own while idle), the **spring chains** with per-chain
{{bt}}stiffness{{bt}} / {{bt}}dragForce{{bt}} / {{bt}}gravityPower{{bt}} and a 'default' for each field. The
preferences that are not about one model — physics, animation, gaze, the two sizes (应用内大小 for the pet inside
DSH and 悬浮窗大小 for the floating window), the nap timeout, view, hide — are the sibling page, 通用设置.

Open them from **either** pet's right-click menu — 当前模型参数设置 for this one, 通用设置 for the other — and it
comes up as a real window in DSH Desktop (ordinary, resizable, focusable: it is a form, not a pet), or as a
browser tab anywhere without Electron, which works because each page is a host route that reads everything over
HTTP.

Three deliberate choices are worth knowing:

* **The page is described by the model FILE, not by a running renderer.** It reads
  {{bt}}GET /vrmpet3d/model-info?m=<id>{{bt}}, which the host parses out of the GLB, so the expressions and
  spring chains it lists exist whether or not the pet is running - and always match the file. A file this
  parser cannot describe, or a model with no expressions, says so instead of showing empty tables.
* **'Default' is a real state.** An override stores only the FIELDS you changed, and clearing one puts the
  joint back on the number the model file declares, snapshotted when the avatar was installed. So a chain
  you only touched the stiffness of keeps its own drag and gravity.
* **Changes land immediately.** The two pets and the settings pages share one storage key, and the two that
  own a pet re-apply on the {{bt}}storage{{bt}} event. Nothing needs a restart, and nothing polls.

A note on the numbers: a VRM 1.0 spring chain lists PAIRS, so N entries animate N-1 joints and the last
entry is only a tail (that is three-vrm's reading, and therefore this plugin's). The window shows the count
you can actually tune - 蓝色小肥鱼.vrm has 91 entries and **69 joints** - and mentions the file's own count
beside it.

## The pet outside the app (floating window)

Right-click the pet and choose **切换回窗口外** — or tick 调试模式 on 通用设置 to watch both at once — and the pet
moves into a window of its own:
always on top of every other window, transparent, no taskbar entry, and **click-through wherever
it has not drawn something** — not "everywhere except a rectangle around the pet", but per pixel,
so the gap between two strands of hair passes the click to whatever is behind it while the hair
itself takes the click and the wheel. Left-drag moves it and it stays where you put it; right-drag
turns it; the wheel resizes it; and a **right-click that does not wander opens the pet's own
menu** (right-drag turns the view, so a click and a drag are told apart by whether the
press moved). That menu is the same rows the in-app pet shows, minus one: this window does NOT offer 切换回窗口内,
because its own 关闭独立宠物 already hands the pet back inside DSH — the two were the same action, and the duplicate
was removed. 关闭独立宠物 is therefore the way home from here.

**旋转跟得住，靠的是抓住指针，不是锁住光标。** Right-drag turns the view, and the view keeps turning however far the
mouse travels — because on the secondary press this page **captures the pointer** (`canvas.setPointerCapture`), which
is what the in-app pet has always done and this page did not: without it, the cursor left the pet-sized window within
a few pixels and the `pointermove` events simply stopped, which is the 「旋转功能一直都异常」 the operator reported.

Two more pieces are needed and both are asserted: while the drag lasts the page reports `orbiting: true`, and the
launcher keeps the window **interactive** for its duration (it otherwise makes a window click-through the moment the
cursor is off the pet's painted pixels, which is exactly where a rotation goes). While the view is being turned it
follows `movementX`/`movementY` if a pointer lock happens to be held, and the client pair otherwise.

A pointer lock is requested as well, by the **launcher** (Chromium refuses a lock to a document that is not focused,
and this window is deliberately `focusable: false`), but it is a bonus rather than the mechanism: on the operator's
machine `win.focus()` is refused by Windows' foreground rules — the measurement is
`{"locked":false,"hasFocus":false}` — so the launcher's self-test asserts the BEHAVIOUR instead: with real mouse
events, right-dragging the pet must turn the view while the pointer travels away from it, and releasing must stop it.

**Throwing is switched off in this window.** A drag places the pet and it stays there — no
velocity, no fall from a height, no bounce. The physics is kept, not removed (`throwEnabled`
in `lib/client.js`), and the in-app overlay still throws its pet the way it always did, so a
later feature can use it.

**Where you put it is remembered.** The end of a drag writes the position to this window's own storage *and* to
the host's settings store (`placementX`/`placementY`), so the pet comes back to the same spot next time instead
of to the default corner — which is what it used to do, because the shared cleaner did not know the two keys
and threw them away on the way in.

**Its menu is the same menu as the app pet's — one definition, not two.** Right-click either pet and the eight
entries come from `lib/menu.js`, in the operator's order and in both languages; a surface only says which way its
switch row goes (`toSurface`) and what each id DOES. That is what stops "an entry the other pet has and this one
does not", which is the failure two hand-rolled menus produce, and it is why the two pets cannot drift. Right-click
the pet again — or press Escape, or click anywhere outside — to close it.

**Its size is its own setting.** The window is sized as a percentage of the same 220x300 base slot the in-app
pet uses, but the two live under different keys — `windowSize` for this window, `size` for the pet inside DSH — because their frames are different things: this window's frame is the whole screen, the app pet's is DSH's
window, and the same percentage is a different pet in each. They shared one key until 2026-10-10, so reloading
DSH let the in-app pet push its percentage over the window's (measured: 202×276 instead of 396×540). 通用设置 →
显示与外观 has a **悬浮窗大小** row beside the pet's own **应用内大小**, and this window's
wheel edits its own number; a profile that knows only one size keeps it for both.

**What the window is doing is the HOST's answer, not the click's.** The launcher reports it through
`GET /vrmpet3d/desktop`, the app pet keeps that answer as data (`desktopStatus`/`desktopNote`), and the 通用设置
page's own status line says 悬浮窗运行中 — with 已渲染 when the page is really drawing — or which surface is
showing the pet instead. A window that is up but not drawing therefore stays visible as a fact rather than
looking like a successful switch.

**调试模式 puts BOTH pets on screen at once.** The two surfaces are exclusive everywhere else — while this
window has the pet, the copy inside DSH is hidden on purpose — which is exactly what makes any difference
between the two renderers impossible to see: a prompt drawn in one and missing in the other, a pose, a size, a
gaze. The switch is 通用设置 → 显示与外观 → **调试模式** (the `both` value of 显示位置, kept beside the two
size controls because it is about the two surfaces together); setting it starts this window and leaves the
in-app pet visible, and clearing it goes back to 自动. Every state, prompt and patch is shared, so the two pets
show the same session at the same time — that is the point. It is a debug switch rather than a preference to
sit in: two WebGL scenes cost two renders, and the in-app copy is what normally steps aside. Switching it on in a
window that is already open needs its delivered chunks refetched once — the preference lives in the host, the
surface rule is client code, and DSH serves a bundle under a `rev=` URL an in-place edit does not change, so an
Electron renderer keeps the old bytes in its disk cache even across a restart. In DSH Desktop that is DevTools
(`F12`) → the reload button → right-click → **「清空缓存并硬性重新加载」** (or Network → ☑ `Disable cache` →
reload), since there is no address bar to hard-reload from; reloading the bundle in the plugin manager does the
same thing through DSH's own `rebuilt()` path.

How it works, in one line: the plugin starts a second process (`desktop/`, an Electron app)
against a runtime built by **hard-linking** the Electron that shipped with DSH into a
scratch directory beside the installation. Nothing is downloaded, the installation itself is
never written to, and the links cost no disk space. If that cannot work — no write access
beside the installation, a different volume, an installation that moved — the pet stays in
the app and the 通用设置 page's status line says so. `VRMPET3D_DESKTOP_RUNTIME` names a standalone Electron to use
instead, which is also the escape hatch for a machine where the runtime cannot be built.

| Variable | Effect |
|---|---|
| `VRMPET3D_DESKTOP_RUNTIME` | Path to an Electron executable or directory to use instead of borrowing the installation's |
| `VRMPET3D_DESKTOP_HOST_DIR` | Where to build the borrowed runtime (default: beside the installation) |
| `VRMPET3D_SKIP_DESKTOP` | `1` makes the `desktop` suite skip its live window |
| `VRMPET3D_CLEAN_DESKTOP` | `1` removes the borrowed runtime after that suite runs |

The runtime directory is safe to delete at any time; the next start rebuilds it.

The pre-rename `PET3D_*` names are still read as a fallback by the same lookups (`lib/env.js`: the new
name first, the old one second), so a shell or a DSH environment that still sets one keeps working — the
same courtesy the settings files and the browser's storage key get (see `docs/ARCHITECTURE.md`).

## The status prompt (what the pet says DSH is doing)

Six situations, one row each in the settings window's **状态** section: **空闲 / 工作中 / 等待确认 /
任务完成 / 出错 / 离线**. Each one can show a line **above the model's head** and play a clip, and both are
configured in the same row because they answer the same question.

The shipped lines are the ones the operator asked for, and every one of them is editable — clearing the box
means "say nothing", which is also the default for 空闲 and 离线:

| State | Default line | How it is drawn |
|---|---|---|
| 空闲 | *(nothing)* | — |
| 工作中 | 深度求索中，用时 `{duration}` ··· | **DSH's own running label**, copied from the app: the whale mark, the live clock the `{duration}` token becomes, and `TextShimmer`'s sweep over the words |
| 等待确认 | 我有问题要问 / 需要你的授权 | the session's own `pendingInteraction.kind` decides which of the two |
| 任务完成 | 任务达成 | — |
| 出错 | 遇到问题了… | — |
| 离线 | *(nothing)* | — |

The 工作中 line is the app's own, not a lookalike: `chat.deepDivingFor` is 「深度求索中，用时 {duration} ···」
`formatRunDuration` counts it (`9秒`, `14分6秒`, `1小时2分秒`), the mark is DSH's whale — an animated APNG
masked over a static SVG — and the sweep is `TextShimmer`'s two copies of the line with opposite transforms.
`{duration}` is a token, so your own wording can carry a live clock too, and a line without it is shown
exactly as typed. The label's size is derived from the pet's box, so it grows with the pet.

**The animated mark comes from your DSH installation, not from this repository.** The app embeds it in a
stylesheet, and `docs/ASSET-CONTRACT.md` §1 is the rule for assets the project did not make: load them where
they live, never copy them into the tree. Extract it once with

```bash
pnpm run fetch:whale          # node scripts/whale-asset.mjs
```

which reads the image out of the installed `app.asar` into `assets/whale-tail.apng`, and is served from
there by `/vrmpet3d/whale`. Without it both prompts show the static SVG — which is the app's own fallback and a
complete mark on its own — so nothing breaks if you skip it.

**Two wheel gestures, and they are not the same gesture.** Where the cursor is decides:

| Wheel over— | What resizes |
|---|---|
| **the prompt text** | the text **only**, and the correction is remembered **per model** (`statusScale`) |
| **the model** | the model **and** the text with it (the size is derived from the pet's box), leaving any text correction alone |

The per-model correction exists because the derived size cannot suit every model — a chibi whose head is half
its height, a tall model whose head is small — and that mismatch belongs to the model, so the correction comes
back with it. The step is the same 1.12× the pet's own zoom uses, clamped to 0.35— × and to 6— 60 px; wheeling
back to 1× **removes** the entry rather than storing a correction that says nothing. On the floating window the
prompt's rectangle is part of what makes the window interactive, which is how a wheel over it reaches the page
at all — the prompt is DOM and nothing of it is painted.

**The line never wraps.** One line, however long it is: the plate is as wide as its text, and the limit on
length is the input box's own (`STATUS_LIMITS.textLength`), which is where a user can see it.

**持续时间** is per state, and it only governs the states that end on their own. `0` (the default) keeps the
line up for as long as the state lasts, and a positive number shows it for that many seconds after the state is
entered — that is 工作中 and the rest. **Three states are exempt, because their ending is an event, not a
clock** (see below): 等待确认/需要授权 and the two notice states.

## 金色、红色，以及"什么时候消失"（持久提示）

Two rules the operator asked for on 2026-10-11, and both are about **not missing the prompt**:

**How they look.** 任务达成 is drawn in **gold and bold**; 任务失败/出错 is drawn in **red**; every other state
keeps the surface's ordinary colour. The decision lives in one table in `core.js` (`STATUS_TONES`), so the pet
inside DSH and the floating window cannot disagree about which state is gold — only the shades are local,
because the app draws on DSH's theme tokens and the window draws on a transparent desktop.

**When they go away.** These three prompts are event-ended, and a 持续时间 may never hide one:

| State | Ends when |
|---|---|
| 等待确认 / 需要授权 | the user **answers the question / approves the permission** — DSH stops reporting the pending interaction |
| 任务达成 | the user is **back in the session that reported it** |
| 任务失败 / 出错 | the same — back in the session that reported it |

So if a turn finishes in session A while you are looking at session B, 任务达成 stays above the pet — for
minutes, for an hour, however long you take — and it clears when you switch to A. The 持续时间 you set for
those two rows is a **minimum**, not an expiry: the shipped 4.2 s is the floor, so `30` guarantees at least
thirty seconds on screen even when you were already in that session. For 等待确认 the field is disabled in the
settings, with the reason written next to it, because a number that can never take effect is worse than no
field. A notice that has been acknowledged never comes back; a new turn in the same session replaces it, and a
turn starting in *another* session leaves it alone (that is the whole point).

## 碎碎念 (the pet's own voice)

Above the 状态 prompt, a small bubble: the pet's own reaction to the same events, in its own words. The two are
SEPARATE elements and are often up together — 深度求索中 is the app's readout of what DSH is doing (and you edit
it), while the bubble is the pet talking:

| Event | Shipped lines (zh / en) |
|---|---|
| 工作中 | 开始干活了 / 让我想想— / 我盯着呢 · *Working on it / Let me think— / Watching closely* |
| 任务完成 | 搞定啦 做完了 / 收工 · *Done! / All finished / That's a wrap* |
| 出错 | 唔…出问题了 / 有点不对劲 · *Hmm, that failed / Something looks off* |
| 等待确认 | 在等你哦 / 等你回话 · *Waiting for you / Your turn* |
| 需要授权 | 需要你点头 / 等你授权 · *Need your go-ahead / Awaiting approval* |
| 离线 | 好像断开了 / 我先眯一会儿 · *Connection lost / Taking a short nap* |
| 空闲 | 今天也在这儿 / 摸摸成 / 在呢 · *Just hanging out / Pat me / Right here* |

**Every line in that table is a DEFAULT you can replace.** 碎碎念 has three sources, chosen by **台词来源** in the
settings window:

* **内置短语** — the table above, one column per language;
* **自定义短语** — one box per STATE, **one line per line**, drawn at random when that state is entered. An empty
  box keeps the shipped line, so customizing one state leaves the rest alone. Both 等待确认 events (a question and
  an approval) read the one `waiting` box, and the periodic 空闲 remark reads `resting`: `core.SPEECH_STATE_FOR_EVENT`
  is the only place the event vocabulary and the state boxes meet;
* **AI 生成** — the pet asks the host for a line (`POST /vrmpet3d/say`) and the HOST calls a model: either **DSH's own
  provider** (through `ctx.llm`, so it uses whatever this app is already configured with — the pet never sees that
  credential) or **any OpenAI-compatible endpoint** (Base URL + model + key, kept with the rest of the settings).
  The request is your **persona** (the system prompt), the fixed rules, and that state's own **生成提示语** — and
  nothing else. The answer is flattened to one line and capped at 80 characters.

**The AI chain never leaves the pet silent:** AI → that state's own lines → the shipped table. A model that is slow,
refused, rate-limited or unreachable costs the pet a sentence, not its voice — the fallback line is up from the
first frame and the answer simply replaces it when it arrives. **试一句** in the settings asks for one line right
now and shows either the line or the host's own refusal text (a wrong key, a bad URL, a provider that answered 500),
which is how a configuration is checked without waiting for a state change.

**The privacy rule is a rule, not a style choice: a bubble NEVER contains session content.** No code, no paths, no
file names, no model output, no error text. The built-in lines are a fixed table; the custom lines are what YOU
typed; and the request the host builds for a model carries the persona, the fixed rules and the state's own prompt — the code that builds it has no reference to any session at all, which is why the rule survives being handed to a
model. Two checks hold it: one asserts the request body ON THE WIRE against a stub provider that records it, and
another drives the app's own bubble with a session id in hand and requires that the bubble not contain it.

The throttle is what keeps it occasional, and it is configurable in the settings window's **碎碎念** section:

* **one line at a time** — a line stays up for 每句显示 (5 s by default) and nothing replaces it;
* **events speak at once** when they are entered, and the **same event never repeats itself** while it is still
  running (that is what stops 工作中 from chattering); going back to an idle state makes the next turn a new
  event again;
* **空闲嘀咕间隔** (1—  minutes by default) is drawn once per idle period, and **最短间隔** is the floor between
  two lines — so the pet does not narrate itself;
* anything unrecognised — an unknown state — is **silence**, never an invented line.

The app's pet decides all of this (it is the half that has the state) and publishes the line with the state over
`/vrmpet3d/state`; the floating window draws whatever it is told, grows its window to hold the bubble, and leaves
that area **click-through** — a bubble is there to be read, not clicked.

Two rules are built into the state machine rather than into the settings:

* **等待确认 is latched.** While a session reports a pending question or approval, nothing else may move the
  pet out of that state — not a turn that completes, not one that fails. Answering the prompt is what
  releases it. (A drag still wins: that is the user's own hand.)
* **Coming back to DSH ends a 任务完成 or 出错 prompt.** The pet notices that the window has focus again —   polled, because Windows does not fire `focus`/`blur` on an application switch — and returns to 空闲.

Both pet surfaces show the prompt. The in-app pet resolves the state and publishes it to `/vrmpet3d/state`; the
floating window has no session data of its own, so it reads that one value and draws the same line and the
same clip. **This route is host-half code, so the floating window's prompt needs a DSH restart to go live.**

## How the pet is driven

Two independent signals, so losing one degrades rather than breaks:

* **Host RPC** (`ctx.remote.vrmpet3d`) — a stream of turn-start and turn-end
  boundaries from the host half, used to know when to celebrate and when a turn
  failed.
* **React status hooks** (`useSessions` / `useSessionStatus`) — session counts and
  pending-approval flags, pushed into the widget on every change.

If the RPC binding is unavailable the pet still reacts to session status.

## Authored motion (VRMA only)

**One format, and one avatar family.** Authored motion is `.vrma` — a VRM humanoid clip — and it drives
a VRM (or a plain glTF whose rig offers the bones it names):

| Format | Drives | Bound by |
|---|---|---|
| `.vrma` | VRM 1.0 / 0.x models | the VRM humanoid bone standard |

**A `.vmd` is refused by name, not ignored.** The plugin still sniffs a motion file's banner, so a VMD
gets an answer instead of a silent no-op: `motion "<id>" is a VMD, which this build does not play
(VRMA only; see docs/ASSET-CONTRACT.md)`. MMD support — the PMX/PMD loader, the VMD player, and the
`@moeru/three-mmd` + `mmd-parser` stack they needed — was removed on 2026-10-12; the retired chapter and
its reasoning are kept in [`docs/ASSET-CONTRACT.md`](docs/ASSET-CONTRACT.md). 通用设置 → 状态与动作
lists only the motions that can drive the model you actually have
loaded, and says so when none can.

**The idle stays procedural by default.** Nothing is played until you choose a
motion for a state, and a state you leave alone behaves exactly as it always has.
The procedural idle remains the default because it loops exactly; an authored clip
is only as loopable as its author made it.

**Per state, not global — and a state can hold SEVERAL clips.** Each of the eight session states keeps its own
list of clips, and the pet draws **one at random each time it enters that state**: a resting pet with three
idle clips does not loop the same six seconds forever. Unticking every box is the way back to the
procedural idle, and the row's summary says how many are ticked. `held`, `falling` and `landing` are
deliberately not configurable: those poses belong to the drag physics, and a clip that moved the body while
it was airborne would fight the integration that decides where the pet lands. The pet stays draggable and
throwable while a motion plays.

**A clip says whether it loops or plays once.** A `.vrma` describes how the bones move; it has no way to say
whether it is a six-second ambient loop or a two-second wave. So a motion directory may carry its own
`vrmpet3d-motions.json` next to the clips, and the host reads it into the catalog:

```json
{ "clips": { "vrmpet3d-wave.vrma": { "loop": false } } }
```

Keys are file names relative to that motion directory, and anything absent **loops**, which is what every
clip did before the flag existed. A one-shot plays through once and then hands the pose back to the state's
procedural idle — it does not restart, and it does not freeze in its last frame. 通用设置 → 状态与动作 marks each clip
`loop` or `once`, and the per-clip rows show it.

**The old VMD trap went with VMD.** A `.vmd` bound by exact MMD bone name and dropped unmatched names
**silently**, so a clip that worked on one model and did nothing on another was almost always a name
mismatch rather than a corrupt file. Nothing plays a VMD here any more, so that failure cannot happen;
the trap is kept, marked RETIRED, in
[`docs/ASSET-CONTRACT.md`](docs/ASSET-CONTRACT.md), because it is the reason a `.vrma` addresses the VRM
humanoid standard instead of a name list.

**The window grows while a clip plays.** A pose can reach past the box a model is framed in — a wave puts a
hand outside it — and the floating window's rectangle IS that box, so the hand used to be drawn into the
window's edge and cut off. While a motion plays the canvas (and therefore the window) expands by
`MOTION_FRAME_MARGIN` and the camera pulls back by the same factor, so the pet keeps the same size in pixels
and simply gains room around it. The margin is measured rather than guessed (the raised hand reaches 1.17× the
slot's half width; the margin is 1.35), and a browser check asserts both halves — the pose really does exceed
the slot, and it fits the expanded canvas.

**The head still follows the pointer while a clip plays.** A VRMA that writes the head no longer takes the
gaze over completely: the pointer's turn is layered ON TOP of the clip's pose, budgeted so the two never fight
over one bone:

```
addition = clamp(desired, ±max(0, 70° → the clip's own turn))
```

A clip that already turns the head 8.6° therefore leaves 61.4° for the pointer, and a clip past 70° gets
nothing added. Measured on the generated wave at full aim: `clipTurn 8.6° → added 61.41°`.

**Motion directories are importable, and it takes effect at once.** `motionDirs` in the plugin config works,
but editing a profile config to try one file is friction, so a directory can also be imported the way a model
directory is: it is remembered in a plugin-owned `vrmpet3d-motion-dirs.json` beside the settings, and the catalog
is rebuilt on every request, so the next time the picker opens the files are there — no restart. Point it at a
folder of `.vrma` files and assign one to each state.

**Both surfaces play the motion, not just the app's.** The floating window has its own motion path with the
same rules as the overlay (VRMA on a VRM, bytes fetched once, clips dropped on a model
switch). Before this round a motion assigned on the pet's own panel animated the pet inside DSH and left the floating
window still — and the window is the pet most people watch, which made a correct clip look broken. The page
publishes what it is doing (`motion: {kind, format, mapped, playing, available, reason}`), so "my motion does
nothing" has a readable answer instead of a silent frame loop.

**Generated motions are a first-class case, not a workaround.** VRMA is the format text-to-motion tools emit,
and the repository generates its own example to prove the path: `node scripts/make-vrma-fixtures.mjs` writes
`build/fixtures/vrma/vrmpet3d-wave.vrma`, a two-second wave (arm raised ~66°, forearm swinging ±26° over exactly
three cycles, so it loops seamlessly). Verify it against a model with:

```sh
node scripts/verify-motion.mjs --model build/fixtures/vrma/vrmpet3d-minimal.vrm \
  --motion build/fixtures/vrma/vrmpet3d-wave.vrma
```

There is a second generated clip for the state a pet spends most of its time in:
`build/fixtures/vrma/vrmpet3d-rest.vrma` — six seconds of **arms hanging, elbows and fingers relaxed, and the body
turning very slowly** (one cycle, so it loops). Its signs come from the rig rather than from taste: a VRM rests
in a T-pose with the left arm along +X, so "arm down" is a rotation about Z of **180° on the left and +80° on
the right**, and the same left-negative rule carries through the elbows (about the carried Y axis, which is what
tips a hanging forearm forward) and the fingers (about Z, because a lowered palm faces the body). Measured on
the fixture: the hand hangs **0.16 units below the hips** (26 % of the model's height) and **0.10 to the side**
(16 % — a T-pose would be near a full arm span), the elbow is bent **14.9°**, and the head's sway relative to
the hips covers **0.01 units** over the clip. The thirty finger-joint tracks are checked from the file's own
JSON, because the committed fixture has no finger bones for them to bind to.

Two properties make a file like that portable between models, and both are worth copying when you author one:
the rotation axes are **world-aligned** (three-vrm's normalized rig keeps identity rotations, so `rightUpperArm`
about Z is "raise the arm" on any VRM), and a constant hips translation at the rest height is scaled by the
loader to each model's own proportions, so the pet does not float or sink.

## Model files and licensing

**This project ships exactly ONE model file and no motion files, and that is deliberate.**
`assets/models/SampleModel.vrm` is committed only because the licence **embedded in the file itself**
allows redistribution, modification and commercial use with no attribution — see
[`assets/models/README.md`](assets/models/README.md), and `scripts/check-docs.mjs` asserts the folder
ships nothing else. Every other VRM on the internet is a separate question: most are distributed under
terms that forbid redistribution, and several explicitly forbid commercial use. Bundling one would make
this repository undistributable and would be a licensing violation regardless of intent.

**Motion files are licensed separately from models**, and are no more
redistributable by default: many are authored for one specific character or
platform. This project ships none — and since 2026-10-12 the only motion it can play is a `.vrma`.

You supply your own model and motion files, and you are responsible for their
terms. See [`docs/ASSET-CONTRACT.md`](docs/ASSET-CONTRACT.md) for the full picture,
including what the plugin's texture resolution and orientation handling assume.

## Documentation

| Read this | For |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | how the pieces fit, and why each boundary is where it is |
| [`docs/ASSET-CONTRACT.md`](docs/ASSET-CONTRACT.md) | what a model or motion file must provide, licensing, and the transform order trap |
| [`HANDOFF.md`](HANDOFF.md) | resuming work on this project: environment, gotchas, next steps |
| [`vendor/README.md`](vendor/README.md) | the pinned 3D stack and how to rebuild the chunk |

## Verification

```bash
node scripts/verify-all.mjs          # everything, one verdict
```

**That whole-tree run is the operator's call, not a reflex.** A change is verified with the narrowest suite that
covers it — one row of the table below — and the report says which suite ran rather than claiming "all green";
[`AGENTS.md`](AGENTS.md) is the rule and the change→suite table. The full run stays a deliberate act because it
starts three browsers and a real always-on-top window, and because its `docs` step shells out to every other suite
to recompute the counts below.

Individual suites:

| Command | Checks |
|---|---|
| `node scripts/verify.mjs` | 1018 — state machine (including the 等待确认 latch, the completion notice the machine ADOPTS from the aggregate's snapshot instead of only from a boundary frame, and the 2026-10-11 rule that a notice WAITS for the user instead of expiring: which session it is about, the minimum hold, presence as the acknowledgement, the watermark that stops a dismissed notice coming back, and the tone each notice is drawn in), the completion notice derived from DSH's OWN running flag (a turn ending with no boundary frame in sight), 碎碎念 (the shipped zh/en phrase table — asserted to be the only thing that can reach a bubble — the event mapping, the settings' clamps, and the throttle: one line at a time, a held line, no event twice in a row, a drawn idle gap, and silence for anything unrecognised — plus the user's OWN per-state boxes: one line per line, trimmed, blank-dropped, de-duplicated and capped, read through the event→state bridge, REPLACING the shipped table for that one state and falling through to it when the box is empty — but only while the BUILT-IN source is in force, because choosing 自定义 or AI switches the table off entirely — and the AI half: the request intent with its sequence number, the fallback chain AI → the state's box → SILENCE once a source other than the built-in one is chosen (operator, 2026-10-11: "开启AI碎碎念或者自定义碎碎念之后，关闭内置的默认碎碎念"), `say()`'s flattening and cap, and `pumpAiSpeech` asking once per intent, landing the answer in the bubble, leaving the fallback up when the request fails and DROPPING an answer that arrives after the pet moved on — and the PRESS half: `react()` speaking from the part's own box and then from the SHIPPED lines its region ships with (胸部/屁股's 变态！, which belong to the built-in source and are switched off with it — the same rule the state table obeys, so AI or 自定义 makes the press fall through to the state's own box and, under AI, wait for the model), and then the state's, NEVER from the shipped STATE table, its own `reactGapSeconds` floor, and — in AI mode — asking the model for EVERY touched part, prompt or no prompt, with the STRUCTURE the raycast named (`ErDuo.L.002` from a bone, `bust` from a mesh, the bone preferred when both are known) carried in the published intent and in the request the surface makes — and the SPRING CHAIN when the structure hangs from one: `chainNameOf` picks the author's name, else the chain's root joint, else its storage key, so `TwinTail.A.002.L` names an unnamed VRM 0.x chain while `hair0` never reaches a prompt), and the two rules the operator chose after reading DSH's OWN implementation: a completion now waits out `COMPLETION_SETTLE_MS` and is CANCELLED by a turn that starts inside it — proven both through a `turn/end` frame and through the store's falling edge, so "一个子任务完成" no longer flashes 任务达成 — and the 用时 token is measured on DSH's own TURN clock: an open turn counts from the `time` its frame carried (NOT from when the pet's state changed), a settled notice reports `end - start` (DSH's 「用时 X」 row), and with no turn to report the clause is DROPPED, which is DSH's token-free 「深度求索中」 — with `null` (no turn) kept distinct from an omitted clock (a caller that knows nothing about turns) and from the STREAM-LESS SENTINEL `'state'`, which is what a deployment with no boundary stream gets: measure from the state's own entry time, because with no turn to be faithful to the older clock is the honest answer (the live regression "深度求索中的时间也没了" came from treating that case as no duration at all), and the STATE CHANNEL's freshness: the heartbeat `createStateReporter` sends so going quiet means something (a beat re-states the last state and line, and deliberately NOT the press, which is an event), the rule that a report older than the window is no longer believed while one that was never made is merely absent, and what the host ANSWERS for a stale report — `state: null` with the sequence bumped exactly once per transition, so a window that only looks when `seq` moves is told the pet went quiet and told again when it comes back), the emotion tables (four trigger rows — 空闲 / 拖动时 / 点击时 / 长按时 — plus the user's own PARTS, whose default five ship empty so nothing changes until one is written), the PARTS themselves (a label, the structures it owns matched by PREFIX unless pinned EXACT, an emotion row and a 碎碎念 box per part — with the migration of the legacy per-region emotion rows into the shipped parts, the cap on how many there may be, an id that is regenerated rather than trusted, and the matching order that makes a user part override the name heuristic), `structureRegionOf` as a HEURISTIC with `null` for a name it does not know (`J_Bip_C_Head` is a head, `LiuHai` is nothing at all), the `PRESS_LIMITS` bounds the two surfaces share, the prompt's per-model text correction (the wheel step, its clamps, and the rule that a correction of 1 is never stored), fall physics, wall and ceiling bounce, framing, idle motion, the frame-derived zoom limits, preferences (including the floating window's OWN `windowSize`, split from `size`, plus `placementX`/`placementY` — the corner it was left in — and the migration that keeps an older profile's single size for both), the per-state motion map (several clips per state, and the legacy single-id shape it replaced), the per-state 状态文字 / 标记 / 动画 / 持续时间间 and the per-state per-clip 循环/单次, 表情, 口型 and 凝视 settings and the per-state one-shot interval, DSH's own running label (its `formatRunDuration` rules, the live clock the `{duration}` token becomes, the whale mark's state, and the font size derived from the pet's box), the gaze idle rule's own setting, the node-name sanitiser the spring-chain matcher needs, pointer aim, the VRM stand |
| `node scripts/verify-model.mjs` | 541 — model catalog, path safety, asset and directory routes over real HTTP, the motion import list and its per-directory loop/once manifest, boundary hub, and the DESCRIBED MODEL LIVING IN MEMORY, which is what makes 模型参数 open instantly (operator, 2026-10-11: "模型参数加载太慢了，让它的信息和当前模型一样常驻内存"): a process-wide LRU of four parsed reports keyed by absolute path, checked for freshness on the same size+mtime pair the route used to key on, asserted through the cache's own counters — the FIRST request parses, the second for the same unchanged file does NOT (it is a hit, and it is answered from memory), a file that CHANGED is parsed again and described from disk rather than from the report still held, `forgetModelInfo` drops exactly that entry so the next request re-reads, and the cache never holds more than its capacity however many models are asked for — with the old route-level map GONE, because a second cache the invalidation functions cannot reach is a cache that , , asset and directory routes over real HTTP, the motion import list and its per-directory loop/once manifest, boundary hub, the live-state channel the floating window reads (including the 碎碎念 line it carries: flattened to one line, capped, refused when it is not a string, and CLEARED by a report that names none — and the PRESS it carries: which gesture, which of the user's own PARTS owns the structure, the model's own name for it, each field capped, and a body with neither a reason nor a region refused as "not a press"), the RULE THAT STOPS A QUIET PET FROM CLAIMING TO BE WORKING FOR EVER: a report older than the window is answered as `state: null` with the sequence bumped exactly once — the assertion that a window which only looks when `seq` moves is told the pet went quiet, is not told again on every read, and is told again when a fresh report revives it — while a pet that has NEVER reported is not "stale" but absent, and a TURN CLOCK is relayed with the state (including the sentinel a deployment with no boundary stream sends, which must arrive as itself rather than as null, or the window loses the duration: the live "深度求索中的时间也没了"), the STRUCTURE list the 部位 editor offers (every node, mesh and material name of the model, deduplicated and capped, with the kind of thing each one is), the window's page, sources and control routes, DSH's animated whale mark delivered as an APNG (or 404, honestly, when it was never extracted), and the AI 碎碎念 pair (`/vrmpet3d/say` and `/vrmpet3d/llm` driven over real HTTP against a stub provider that RECORDS the request: the persona in the system message, the state's own instruction as the user turn and nothing else — the privacy rule asserted on the wire — a request that names a PART using that part's own prompt instead, a request that names only a STRUCTURE (`bust`) getting an instruction built from that name — verbatim, because translating a rig's own word would be a guess — while a part that HAS a prompt keeps it, a stale part id falling back to the state rather than failing the page, a long or multi-line structure name capped and flattened, a request that names a CHAIN as well getting an instruction that OPENS with the chain and still mentions the structure — the position of the two names on the wire is asserted, because that is what "链名的优先级大于结构名" means — the answer trimmed/flattened/capped, a provider failure reported with its status, one call in flight at a time, the whole DSH path through a stub stream that speaks the REAL chunk protocol (`{ type: 'finish', reason: { kind, failure } }`, the shape `BlockAssembler` reads) including its terminal failure code, the reasoning budget and the asked-for effort asserted by name, a thinking-only stream refused with what it spent, the live provider/model catalog, and no credential anywhere but the settings), and — the check that was MISSING until 2026-10-10 — WHICH TYPE each page source is served with, asked of the route handler itself for EVERY name in the whitelist: `pages.css` must come back `text/css; charset=utf-8`, because the route used to hard-code `text/javascript` for the whole whitelist and a browser refuses to apply a stylesheet that is not CSS, which turned both settings windows into unstyled text while every status code said 200 |
| `node scripts/check-plugin-load.mjs` | the manifest, the host half, activation and clean disposal — and the CLIENT half activated the way the shell activates it: the classic script evaluated, its module-table row taken, its factory run against the platform modules, then `apply(ctx)` with no `lib/core.js` global yet, which is the state that exists at activation time |
| `node scripts/check-profile.mjs` | 9 — the PROFILE is wired (dependency, bundle entry, link target) and the running app answers; the only check that looks outside this source tree |
| `node scripts/verify-browser.mjs --page chunk-delivery` | 39 — DSH's own module system delivers every committed chunk |
| `node scripts/vendor-build.mjs --check` | the committed 3D chunk is reproducible from the pinned versions |
| `node scripts/check-docs.mjs` | 211 — documented paths, commands and counts match reality (including `AGENTS.md`, whose cited suites have to keep existing) |
| `node scripts/verify-browser.mjs` | 13 — 3D stack, procedural avatar, framing, glTF/VRM loaders (VRM only; the MMD loader and its probe are gone) |
| `node scripts/verify-browser.mjs --page client-test` | 90 — the widget end to end in a real DOM, in front of which stands the SHARED right-click MENU that replaced the two settings panels: the operator's rows in order, the two settings entries posting the right page and model, 重置大小 and 重置视角 driven by real clicks on the real items, the switch row DISABLED under 调试模式 (its tooltip saying why) and live again outside it, the box clamped into the viewport, the opening press and an inside press NOT closing it while a later outside press and Escape do — the module binds its guards one task after the open, so that rule is structural rather than a race on two coarsened clocks — the RIGHT BUTTON really opening it while a double-click no longer does, 隐藏宠物 hiding the pet and the 显示宠物 button in the corner bringing it back under the operator's own Chinese name, and the 重力 switch on BOTH pets (the row's check mark and `aria-checked` read off the node, the preference AND `placement.throwEnabled` moving together, a released drag producing no fall with it off and a real fall with it on, and the two keys proved INDEPENDENT by starting the window's store with the app pet's key already off, which a shared key could not survive) — and the pet's own chrome now carrying no size control at all (including, on the 碎碎念 path, the AI call: four frames of one event produce exactly one `POST /vrmpet3d/say`, the user's fallback line stays up until the answer lands, and the answer is what the bubble then says — and, on the INTERACTION path, the two bounds: a press that only wobbles 3 px is still a click and moves the pet by nothing, a press held still for 0.6 s becomes a 长按 WHILE it is held and adds no click, the press is measured against the MODEL by a real raycast (renaming the meshes moves the region from `body` to `eye`, and a ray that misses is not a region), the per-part chain answers a press on a part whose row names an emotion and falls through to the generic row when that row is empty, and the part travels to the host with the state even though a click does not change the state — with the CHAIN behind a press driven for real: a joint of the fixture's own `tail` chain comes back as `tail`, a bone that is not a spring joint answers `null`, the raycast's answer carries the field either way, and an UNNAMED chain reaches the request as its root joint (`TwinTail.A.002.L`) rather than as the positional key `hair0`): wheel zoom (including a resize anchored at the cursor and stopping at the frame's own limits), the TWO wheel gestures (a wheel on the prompt's own rectangle scales only the text and stores the correction against that model; a wheel on the pet scales the pet and leaves the correction alone — with the line's `white-space` asserted `nowrap`), the view orbit — including a right-drag whose pointer leaves the pet's frame, which must keep turning and must release, a release that never arrives, a release that happened outside the frame leaving nothing latched, and the POINTER LOCK the orbit takes (requested the moment the press BECOMES an orbit — never on the press itself, which is what used to capture the cursor on a plain right-click and swallow the menu — driven by movement deltas while the cursor position is frozen, released on release and by Escape, with the lock spy asserted to stay at ZERO calls until the press actually moves) — the drag reaction firing as the drag starts, the gaze beyond the pet's frame, the gaze axes on every avatar kind, the blink (and its pause while the face is already expressing something), the per-state motion box sets (several clips per state, the loop/once marker, and the one-shot flag reaching the scene), the floating-window switch, and the desktop page's drag/place, wheel gestures, orbit, gaze, settings panel and head-status prompt — including its own `windowSize`: the mount is sized by it, the wheel writes it back, and the patch pushed to the host names `windowSize` and never `size`, with the prompt's `scale` published and live under a correction — and, for the panel both pets share, that the window's panel IS the shared definition: the shared class and stylesheet, every shared row it asks for present, the app-only rows absent, the model row a button (this window is never focusable, so a dropdown could not open), and one `sync` reflecting a preference set into every control — and 碎碎念 on BOTH surfaces: the app's own bubble (a line from the shipped table, held, then cleared when the hold ends, silent with the switch off, and carrying nothing the session handed it), and the window's (drawn above the 状态 prompt, reported exactly where it is drawn, click-through while the prompt beside it stays interactive, and gone with a null rectangle when the host sends no line). Two of these go through the PLUGIN instead of around it — `createPlugin` → `apply` → the registered `shell.overlay` component rendered with DSH's session standard kit → the widget — and require the pet to be connected, resolve 工作中 from a running session, announce `{"state":"working"}` to `/vrmpet3d/state`, and draw DSH's own label: the whale, both copies of the line from one string, and a font size derived from the pet's box |
| `node scripts/verify-desktop.mjs` | 242 — the pet's own window: the right-click MENU it opens coming from the SHARED module with a real DOM hit test (`checks.menu` / `checks.menuHitTest`), the 空闲休眠 row on 通用设置 bound to the stored `sleepAfterMs`, the status line both halves share (including the field list the launcher copies into `/vrmpet3d/desktop`, so the prompt's per-model `scale`, the 碎碎念 bubble's own text and rectangle, the page's own `state` view, the 任务达成/出错 `status.tone` AND the PRESS readout (`touch`: which gesture, which of the user's own parts, which structure) are relayed rather than silently dropped — and the same list asserted for the motion readout, so `offered`, how many clips the page's own catalogue holds, and `routed`, whether `/vrmpet3d/motions` answered at all, cannot be dropped either), the Electron it borrows, the spawn, the lifecycle, the three anti-freeze measures, the per-frame VRM update reaching every component, the TWO PAGES the settings window is split into — the launcher opens the model's 模型参数 page (`/vrmpet3d/config`) and then NAVIGATES the same window to the sibling ROUTE (`/vrmpet3d/global`), reading both, and what is asserted is that each page said which page it is (`data-page`, against the markup that was served), that the two readings DIFFER, and that the 通用设置 keys came from the global reading rather than from the model page's own (one script drives both pages, so a naive merge looks right while showing the wrong one) — the settings window's 状态 section (per-state status lines, the per-state box sets, the per-clip play-mode rows, the gaze switches, the interval lines, and which 持续时间 fields the clock does not own — with 等待确认's field actually refused), its 视线 readout of what the renderer applies, its two size controls — 大小 for the pet inside DSH and 悬浮窗大小 for the window — its 碎碎念 section (on/off, the three timing numbers, a 台词来源 picker shipped on the built-in table, one lines box AND one prompt box per state with their counts published, and the LABEL on an empty box following the source — an empty 台词 box is called 用内置短语 only while the built-in table is the source in force, with every collapsed state row asserted to show that one label rather than a stale one, the AI half's provider/URL/model/key/persona controls, the 试一句 picker that has to answer while the source is built-in, and the rule that the credential FIELD is never published — only whether one is set), its 部位 section (a row per part plus a detail row for its 碎碎念 box and its AI prompt, the five shipped parts by name, the structure PICKER filled from the model's own node/mesh/material names and the count of names the heuristic cannot place, the two shipped-voice rows read back with `speaking` following the source in force, and 胸部's placeholder losing its 「留空则说内置的 变态！」 promise when the STORE says a source other than 内置短语 — then regaining it when it does, which is the path that carries a source change to the 部位 table at all, since the picker and the table are on different pages — and then the four gestures DRIVEN in the real window: 新增部位 adds a row, a typed structure becomes a chip marked 未识别, the chip's match mode toggles 前缀 → 精确, removing it leaves the part standing, and the part can then be RENAMED and DELETED — with the structure BROWSER's own panel driven too: 浏览… opens it, it lists the model's names, its box is SHORTER than its content and `scrollTop` really moves (the operator's "下拉框无法滚动，也没有滚动条", asserted against the panel that replaced the popup), typing narrows the list, clicking a row adds that structure, and 关闭 puts it away — with the EXPRESSION pickers driven too: one dropdown per 表情 and 部位 row, the choices inside a bounded scrollable menu and NO expression checkbox left in the row, and — the bug this was built for, "勾选或者取消表情时，每次点击都会让页面返回到最上面一条" — ticking one from that menu updates only that row's label and the page does NOT jump: the probe scrolls the window down first, so the assertion cannot pass on a page too short to move — and the menu OPENS AGAIN every time, after all three ways of closing it (the trigger, Escape, an outside click), because a picker that can only be opened once per page load is the second bug this block pins: "选中一个表情后，再点表情的下拉列表就无效了"). It also checks, BEFORE spawning anything, that `desktop/main.js`, `desktop/probe-parts-editor.js` and `lib/config-page.js` still PARSE — a stray backtick in an injected script once left the launcher unparseable, and the only symptom was an Electron error dialog), its 模型导入 section (a folder picker and the imported list, with the picker's own availability reported) AND its 动作导入 section (its own picker, its own directory list, and the number of clips behind it — a separate route and a separate list file), and, in the real window, that its panel is the SHARED definition (`panel.module`), against a real window, and a real window proven always-on-top, transparent and work-area sized |

The project total the docs quote is **1945**: the sum of the suites that print an
assertion count (1018 + 541 + 39 + 13 + 90 + 242), plus one each for
`check-plugin-load.mjs` and `vendor-build.mjs --check`, which report a verdict and a
hash instead of a count. The `mmd` suite that used to sit in that list went with MMD support on
2026-10-12; its 13 checks are gone and every surviving suite's figure is the one its own run printed.
**The MMD-only files stay on disk but are not wired in**:
`build/probe/mmd-probe.js`, `scripts/verify-motion.mjs`, `scripts/make-fixtures.mjs` and
`scripts/make-motion-fixtures.mjs` are kept as the history of the removed capability (and as tooling a
future pass may re-use), while no suite list names them.

`verify-all.mjs` itself prints only a suite verdict (`9 passed, 0 failed, 0 skipped`).
`check-docs.mjs` recomputes the 1945 from the real
suites, so a changed count fails there rather than quietly going stale — but it
deliberately excludes **its own** assertion count, because that count would depend
on the total it is checking. The `check-docs.mjs` row above is therefore the one
figure in this table that nothing verifies automatically, and it is the row to check
by hand when that suite gains or loses assertions: 211 is what a fully green run
reports. It was 199 before the described-model cache pass, which added six assertions
to `check-docs.mjs` itself — one for each suite whose count the docs quote. The 199 it
displaced was itself derived from a run that passed 194 while the 5 count assertions in
it were blocked by the desktop suite's port flake (fixed in the same pass — see
`scripts/loopback.mjs`). The 205 → 206 step is the stylesheet-MIME fix: the host count
moved 504 → 514, and only the total assertion re-derives from it. The 1842 → 1847 step
is 调试模式: core 946 → 949 (the cleaner keeps `both`), client 86 → 87 (both surfaces
drawn at once) and desktop 229 → 230 (the switch on the 通用设置 page). The 1847 → 1843 step is the pass that
deleted the two pet settings panels and replaced them with the shared right-click menu: the client suite
87 → 82 (the panel and per-state motion rows are gone; the menu is asserted in their place, and it is fewer
assertions than the controls it replaced) and desktop 230 → 231 (the 空闲休眠 row the deleted panel had owned with no
other home — the one preference that had become unreachable, and the reason the row exists). The 1843 → 1852 step is
the menu change: 重启/退出 DeepSeek Harness removed from both pets (with the harness module and its route), the app pet's
menu moved from double-click to the right button, 隐藏宠物 / 关闭独立宠物 given their two meanings, and the
INDEPENDENT 重力 switch added to both (core 949 → 955 for the two keys and their independence, client 82 → 85 for
the switch, the gesture and the two meanings). The 1852 → 1854 step is the operator's next report,
「内置宠物右键单击无效」: the right-drag threshold was a 4 px MANHATTAN distance, so a 2 px wobble on each axis
counted as an orbit and the `contextmenu` that followed was swallowed as if it were a drag — a right-click with a
real hand therefore opened nothing, in BOTH pets (client 85 → 87: the app pet's whole press/release/menu-event
sequence, and the floating window's three wobble cases). Its own count moved
206 → 211 for the same pass, and not because a rule was added: `check-docs.mjs` asserts one thing per UNIQUE path a
doc cites, the new HANDOFF entry cites five more of them, and the two it stopped citing (the deleted panel and its
chunk) took their assertions with them. The 1858 → 1867 step is 试一句's 「还没有选择 DSH 的 provider 和模型」: host
514 → 519 (the two fields are refused SEPARATELY, each read against the same stub) and desktop 232 → 236 (the
catalog's provider and its first model are ADOPTED by a page whose store holds neither, the pair is POSTed to the
settings route, and 试一句's answer shares the row with 生成). The 1867 → 1918 step is the six 部位 rows the operator added on
2026-10-12 (大腿/小腿/脚/胸部/屁股, with their match words in the name table and 胸部/屁股 answering a press from
the shipped table): core 955 → 998 (the region order and its three ordering traps, the two shipped speech tables,
the press chain and the ONE-TIME seeding of rows a stored list has never been offered — including the rule that
a row the user deleted does not come back), host 519 → 524 (a shipped part's own instruction reaching the model,
and the user's own box replacing it) and desktop 236 → 239 (ten rows, empty boxes, and the shipped pair read back
as data). The client probe's window check gained the same fact through a real raycast without adding a check, so
the client count did not move. The 1918 → 1925 step is 「如果设置了AI碎碎念，就停止输出内置的碎碎念」 reaching those
same shipped PART lines — the second half of the 2026-10-11 source rule, which the fortieth pass had left out:
core 998 → 1002 (the table behind the switch, the 自定义 press falling through to the state's own box, and AI
mode going silent while still asking the model, with the user's own box still winning in every source), desktop
239 → 242 (the `speaking` flag, and 胸部's placeholder losing the built-in promise and regaining it through the
store path), and client-test stayed 90 — the window's own press path gained the same fact as one more sub-check
inside its existing window check (a real raycast, a real press, and the host really asked). The 1925 → 1945 step is
the RENAME to `dsh-plugin-vrmpet3d` and the end of MMD support (2026-10-12): core 1002 → 1018 (the extended
`MODEL_EXTENSIONS`/`MOTION_EXTENSIONS` rules, **the storage-key migration** — the current key wins, the legacy
`dsh.pet3d.v1` is still read, an unrelated key is still ignored), host 524 → 541 (a pre-rename
`pet3d-settings.json` opened by the shipped file name and its user-authored content asserted to survive — the
assertion that caught the Windows-separator bug that had made that migration dead), while the `mmd` suite's 13
checks are gone and desktop 242, client 90, browser 13 and chunk-delivery 39 are unchanged.

### How the client half is delivered

This is worth knowing before touching `lib/`, because getting it wrong produces a
plugin that installs cleanly and shows nothing at all.

DSH serves a plugin's client half as one classic script and reaches every extra
file through its **client module system**. Only two things can be loaded that way:

* another installed package declared in `dsh.client.external`, or
* a package-local **chunk** — a file whose name matches
  `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/`, requested as
  `require.async('./client.<name>.js')` and served from
  `/plugins/<package>/<name>?rev=<current revision>`.

A request without the current `rev`, or under any other name, is refused. So
`core.js`, `placeholder.js` and `scene.js` cannot be loaded under their own names,
which is exactly why the first live install showed no pet: the client half read
three globals that could never be set.

`scripts/client-chunks.mjs` therefore generates `lib/client.core.js`,
`lib/client.scene.js` from those sources — each is the original file plus a registration that publishes the global it already
sets as that chunk's module exports. `node scripts/client-chunks.mjs --check` fails
if a generated copy has drifted, and the originals stay the single source of truth.
The vendored 3D stack is delivered the same way, as `client.vendor.js`. Each
registration names its **full module id** — the package name, a slash, and the
chunk's own file name — because the loader reads that id unconditionally; a
registration carrying only a `chunk` field throws. See `docs/ARCHITECTURE.md`.

### Motion playback is verified separately, and outside the nine suites

`verify-motion.mjs` drives a real motion through the real scene and asserts that a
bone actually **moves**. That needs a model and a motion, and neither can ship in
this repository, so it is not part of the sweep above — run it explicitly. Since
2026-10-12 it is one of the MMD-era files kept on disk but **not wired into any suite**
(together with `scripts/make-motion-fixtures.mjs` and the `.vmd` fixture that script
generates), so only its VRMA half still applies:

```bash
node scripts/make-vrma-fixtures.mjs        # synthesizes a .vrma and a minimal .vrm

node scripts/verify-motion.mjs --model build/fixtures/vrma/vrmpet3d-minimal.vrm \
  --motion build/fixtures/vrma/vrmpet3d-test.vrma
```

The fixtures are **synthesized, not downloaded**, so they carry no third-party
terms. A clip that parses but binds to nothing is the failure these catch: the
suite samples a driven bone's quaternion before and after stepping the mixer and
requires a real change. The `.vmd` invocation this section used to give no longer
applies — a VMD is refused by name now — and it survives only in that script's own header.

Diagnostics that stay runnable:

```bash
node scripts/verify-browser.mjs --page framing-diag    # measured box vs the framing transform
node scripts/verify-browser.mjs --page vendor-probe    # the raw vendor chunk in a browser
node scripts/vrm-probe.mjs --model <path-to.vrm>       # load any real model, render it to PNG
```

`vrm-probe.mjs` is the way to answer "why does my model look wrong": it reports the
measured bounding box, the framing transform, the bone and material counts, the
rendered silhouette coverage, whether the VRM 0.x orientation fix was applied, and
whether the model asked for any file beside itself.

The browser suites need a Chromium-based browser; set `VRMPET3D_BROWSER` if it is not
in a standard location. Nothing else in the nine suites needs a downloaded fixture: the
MMD model sample `verify-model.mjs --fetch` used to fetch belonged to the `mmd` suite,
which is gone.

The `chunk-delivery` suite needs the installed DSH archive, because it runs DSH's
own client module system rather than a copy of it. It is found automatically; set
`VRMPET3D_DSH_ASAR` if yours lives elsewhere. It is skipped in `verify-all.mjs` when
that file is missing, and fails loudly when it is present but unreadable.

## Project layout

```
lib/core.js               pure logic: state machine, physics, framing, idle motion (no DOM, no WebGL)
lib/placeholder.js        the procedural avatar, built from three.js primitives (a probe fixture, not a default)
lib/scene.js              the WebGL scene: renderer, VRM/glTF loaders, VRMA motion applier
lib/client.js             the DSH client half: slot, pointer handling, settings, session bridge
lib/index.js              the DSH host half: boundary stream, model catalog, asset route
lib/client.core.js        generated from lib/core.js (do not edit; see scripts/client-chunks.mjs)
lib/client.scene.js       generated from lib/scene.js (do not edit)
lib/client.menu.js        generated from lib/menu.js (do not edit)
lib/client.vendor.js      the compiled three.js + VRM + VRMA chunk (generated; do not edit)

vendor/                   build-time-only dependency pins + the chunk's entry point
scripts/                  verification, vendoring, chunk generation, fixtures, install
docs/                     architecture and asset contract
build/probe/              browser test bodies, run by scripts/verify-browser.mjs
build/fixtures/           downloaded and synthesized sample models (not shipped)
tools/                    the asar reader used to inspect the DSH runtime
```

## License

MIT for the plugin's own code. The vendored chunk contains MIT-licensed
three.js, `@pixiv/three-vrm` and `@pixiv/three-vrm-animation`; their notices are preserved in the
generated file's banner. The bundled `assets/models/SampleModel.vrm` is a third-party model under its own
embedded licence (see [`assets/models/README.md`](assets/models/README.md)), and is the only asset that
ships; motion files are **not** covered and none is included.

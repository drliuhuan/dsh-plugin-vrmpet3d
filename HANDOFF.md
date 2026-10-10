# HANDOFF.md — resuming work on dsh-plugin-vrmpet3d

Last updated: 2026-10-12. **This file is STATE, not history.** The pass-by-pass log that used to fill ~6600 lines is
in git (see §10); what is here is what a session on another machine needs to pick the project up without asking
anything.

**▶ NEXT SESSION, in the operator's own order (§3):** finish today's install and run the first LIVE pass (one reload
of the DSH page is the operator's click, §2) → 「继续修复状态显示」, which still needs a reproduction → 碎碎念 to the
model with the TIME plus the greeting feature (早/中/晚, 吃饭了没有, 睡觉了没有, 辛苦了) → the VRMA motion pack: it is
committed and shipping, and what is left is more clips, the rest-pose defect that stops them driving default states
today, and the bundled-motions wiring behind it.

**The tree is green: 9 suites, 1945 checks.** `node scripts/check-docs.mjs` re-derives every one of those figures by
running the real suites, and validates the counts quoted here, in [README.md](README.md) and in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — so its verdict is the statement. Running
`node scripts/verify-all.mjs` is the OPERATOR's call, never a finishing reflex: [AGENTS.md](AGENTS.md) says which
narrow suite covers which change, and a partial run has to be reported as a partial run.

## 1. What this is

A **3D desktop pet** for DeepSeek Harness: a VRM on a transparent WebGL layer, driven by live session state. It runs
in two places and they are fed by ONE host half:

* **the in-app pet** — mounted into DSH's `shell.overlay` slot by [lib/client.js](lib/client.js);
* **the floating window** — an always-on-top, click-through Electron window the launcher
  ([desktop/main.js](desktop/main.js)) starts, whose page is [lib/desktop-page.js](lib/desktop-page.js);
* **the host half** ([lib/index.js](lib/index.js)) serves both over `/vrmpet3d/*` routes, owns the settings store
  ([lib/settings.js](lib/settings.js)) and watches turn boundaries.

**VRM only** since 2026-10-12. A `.pmx`/`.pmd` model and a `.vmd` motion are refused BY NAME — the magic numbers are
still sniffed so the refusal can say which format it found — and the retired MMD chapters are kept in
[docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md). Plain `.glb`/`.gltf` files load as themselves, without the VRM
extensions.

The project was renamed from `dsh-plugin-pet3d` in the same pass, so the package id, every route (`/pet3d/*` →
`/vrmpet3d/*`), every browser global (`__PET3D_*` → `__VRMPET3D_*`), the renderer file (pet3d.js →
[lib/scene.js](lib/scene.js)) and the docs all moved. **A running install therefore needs §2.**

## 2. THE INSTALL: DONE ON THIS MACHINE, and one click short of complete

**Installed into `C:\Users\LIUHUAN\.dsh\profiles\desktop` on 2026-10-12** (the operator asked for it in the session
that cleaned this file). What the profile says now:

| Thing | State right now |
|---|---|
| `dependencies["dsh-plugin-vrmpet3d"]` | `link:F:/SynologyDrive/FatFish-pet/dsh-plugin-pet3d` (the folder keeps its old name on purpose) |
| `dsh.profile.bundles` | `… , dsh-plugin-vrmpet3d` — the OLD package name is gone from both places |
| `node_modules\dsh-plugin-vrmpet3d` | a junction to this checkout |
| `dsh-plugin-fatfish-pet` | dependency + junction still present, **already absent from `bundles`** — left exactly as it was. It registers the SAME `shell.overlay` slot, so the two must never both be enabled |
| imported model directory | `F:\SynologyDrive\FatFish-pet\Models` → 4 models in the picker (bundled SampleModel + HatsuneMikuNT + a user SampleModel + 蓝色小肥鱼), persisted in `vrmpet3d-model-dirs.json` |
| state directory | `…\profiles\desktop\vrmpet3d-desktop\` — `vrmpet3d-settings.json` (fresh profile: this profile had no pre-rename settings, so nothing was migrated) and `runtime\` (the Electron borrowed by HARD LINKS, `copied: false`) |

**What is already live, without a restart** — DSH's profile watcher composed the new bundle the moment the manifest
changed:

```
check-plugin-load.mjs --profile …   → plugin load preflight: PASSED
check-profile.mjs     --profile …   → profile wiring: PASSED (9 checks)
/vrmpet3d/{catalog,motions,state,settings,desktop}  → 200
/pet3d/{catalog,state}                              → 404  (no old half left running)
/vrmpet3d/desktop → state: running, pid 44588, webgl2: true, ANGLE (NVIDIA RTX 5070 Ti), motion.kind: vrm
```

**THE ONE STEP LEFT: reload the DSH page (Ctrl+R).** The in-app pet's client half is fetched by the shell when the
page boots, and the bundle appeared after this page was already loaded — `/vrmpet3d/state` still answers
`{"seq":0,"state":null}` because nothing in the page has mounted. The floating window does not need it (it is its own
page, and it is already up). Then the first live pass in §3.

**Backups and rollback** (all in the profile): `package.json.bak-before-vrmpet3d-2026-10-10T23-41-21` (hand-made,
before the install), `package.json.bak-2026-10-10T15-41-21-215Z` (written by the installer) and
`package.json.bak-bundles-2026-10-10T15-41-37-675Z` (a no-op edit that removed nothing). Roll back by copying the
first over `package.json` and deleting `node_modules\dsh-plugin-vrmpet3d`, or by removing the bundle through the
plugin manager.

### If this has to be done on ANOTHER machine (or after the old package returns)

The general shape of the rename swap, because the profile names the package and the FOLDER still carries the old
name:

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"

# 1. What the profile says (read-only). On a pre-rename install expect the OLD name in both places.
node -e "const m=require(process.argv[1]+'/package.json');console.log(m.dependencies['dsh-plugin-pet3d'],(m.dsh.profile.bundles||[]).includes('dsh-plugin-pet3d'))" $profile

# 2. Delete dependencies["dsh-plugin-pet3d"] and drop the same string from dsh.profile.bundles, then:
Remove-Item -Recurse -Force "$profile\node_modules\dsh-plugin-pet3d"

# 3. Install the new name (the installer writes package.json.bak-<stamp> itself):
node scripts/install-desktop-plugin.mjs --profile $profile

# 4. Prove the profile resolves it — PASSED before anyone looks at the screen:
node scripts/check-plugin-load.mjs --profile $profile

# 5. If cordis.yml carries a row for the old name, re-materialize it (plugin manager install_bundle with the
#    link: spec) or edit that row; an unresolved insert row fails the entry.
```

**Nothing is reset by the rename.** Every renamed key has a READ fallback, and the new name is written from the next
edit on: `pet3d-settings.json` → `vrmpet3d-settings.json`; `pet3d-model-dirs.json` and `pet3d-motion-dirs.json` →
the same with `vrmpet3d`; a motion directory's `pet3d-motions.json` → `vrmpet3d-motions.json`; the browser key
`dsh.pet3d.v1` → `dsh.vrmpet3d.v1` ([lib/core.js](lib/core.js)'s `storedPreferences`); and `PET3D_*` environment
variables → `VRMPET3D_*` ([lib/env.js](lib/env.js) reads both). The old files are left alone — they are the user's
data, not this plugin's.

**The working DIRECTORY is still `…\dsh-plugin-pet3d`.** Renaming it would break the profile's `link:` path, so that
is a deliberate, separate decision.

## 3. What to do next

Written down at the end of the 2026-10-12 session, in the operator's own order: finish what today left open, then the
greeting feature, then another batch of VRMA.

1. **FINISH TODAY'S INSTALL AND RUN THE FIRST LIVE PASS.** One click of it is the operator's (§2: reload the DSH
   page so the in-app pet's client half mounts); then, once and for all, exercise against the RUNNING app what the
   last four passes only asserted statically: the in-app pet appearing beside the floating window's (调试模式 puts
   both on screen), the two settings pages over `/vrmpet3d/config` and `/vrmpet3d/global`, model switching between
   the four imported models, a motion assigned to a state, a press on a 部位 (the shipped 胸部/屁股 lines under
   内置短语, and under AI the model answering instead), the status line against a real turn, and the AI 碎碎念 in
   each of the three 台词来源 modes. **Nothing in the last four passes has been seen live yet** (§9), so this is the
   pass that can still find a wiring mistake no suite can see.
2. **「继续修复状态显示」 — ASK FIRST.** No reproduction was ever given, and the item has been open since the
   fortieth pass. What 「状态显示」 covers is one visible thing drawn by BOTH halves: the per-state box sets on the
   通用设置 page's 状态 section, the whale mask, the live clock, the tone (任务达成 gold / 出错 red), the rectangle and
   the font scale. Ask which surface, which state, what it shows and what it should show. Then check, in this order:
   * **the launcher's copy list** — `announce()` in [desktop/main.js](desktop/main.js) relays a FIXED list of fields
     out of the window's published state. A field the page publishes but the launcher does not relay looks exactly
     like a page that never published it. This class of bug has happened twice (`status.scale`, and the motion
     readout's `offered`/`routed`).
   * **the staleness path** — `/vrmpet3d/state` answers `state: null` once the in-app half's report ages out; a label
     that outlives its report is a defect that was measured before.
   * **the clock and the duration rules** — the turn clock comes from DSH's own running flag rather than from a
     boundary frame, 等待确认's 持续时间 field is refused, and `done`/`error` use the notice hold.
   Tests that pin what must not move: `verify.mjs` (the status tables and machines), `verify-desktop.mjs`
   (`motions.statusTexts` / `statusAnimations` / `statusRows`, the tones, the refused field) and
   `verify-browser.mjs --page client-test` (the `status` block: text, clock, icon path, rectangle, scale, tone
   colours, cleared-on-null). A fix that moves none of those changed nothing.
3. **碎碎念 to the model WITH THE TIME, and a greeting feature.** Operator, 2026-10-12, verbatim:
   「碎碎念再给LLM传数据的时候带上时间，增加问候功能：早中午问候，关心主人吃饭了没有，睡觉了没有，说主人辛苦了。」

   **The time on the wire is the easy half.** The request is built in ONE place — `speechPromptFor` and the
   `/vrmpet3d/say` handler in [lib/index.js](lib/index.js) — and both surfaces call that route
   ([lib/client.js](lib/client.js)'s AI path and [lib/desktop-page.js](lib/desktop-page.js)'s `askPartLine`). So the
   host prepends a line to the INSTRUCTION (the user turn) from its own clock, e.g. 「现在是 2026-10-12 23:41，深夜」:
   enough for 「早/中/晚」 and for 「该睡觉了」, and nothing drawn from the session. Two assertions already pin that
   wire and must be EXTENDED rather than loosened: the stub provider in `verify-model.mjs` records the request and
   asserts the persona plus the state's own instruction, and the privacy rule (no session text, no tool arguments)
   is asserted there too.

   **The greetings are the design question, so ask before building.** 早/中/晚问候, 吃饭了没有, 睡觉了没有 and
   辛苦了 are the CONTENT; the content needs a MOMENT to arrive in. Put these to the operator:
   * a **time-of-day bucket** (早上 / 中午 / 下午 / 晚上 / 深夜) crossed while the pet is idle;
   * the **first 碎碎念 after a long gap** — the 空闲 settings already exist (`idleMinSeconds` / `idleMaxSeconds`),
     as does the 休眠 timeout `sleepAfterMs`;
   * **coming back from 休眠**, where 吃饭了没有 / 睡觉了没有 reads as care rather than as nagging;
   * the **任务达成 moment**, which is where 「辛苦了」 fits most naturally.
   Whichever it is, it deserves its OWN event beside `idle`, with a built-in table and its own AI prompt box, so
   台词来源 keeps the shape the forty-first pass settled: the shipped table belongs to the built-in source and is
   switched OFF in AI/自定义 mode, while the TIME reaches the model in every mode. Greetings want a switch of their
   own in the 碎碎念 section, and the greeting lines want the same 「如果输入了，则以输入的为准」 rule as everything
   else. Tests: `verify.mjs` (the time formatting, the greeting table, the source rule), `verify-model.mjs` (the
   instruction on the wire carries the time), `build/probe/client-test.js` (the local line still stands while the
   model thinks).
4. **THE VRMA MOTION PACK — committed, and one measured defect to fix before it drives default states.** Operator,
   2026-10-12, verbatim: 「这是我自己设计的要随插件分发的动作包，没有版权问题，我只是构造的很慢，所有动作都配置好后，
   我还要把这些都配置到默认状态里，所以都要上传，要随插件分发。」

   So this is settled: the pack is the operator's own work, it belongs in the repository, and it SHIPS with the plugin.
   It lives in `assets/motions/` (committed 2026-10-12 together with its own README, which records the provenance, the
   licence position and the caveat below), and `assets` is already listed in `package.json`'s `files[]`, so a packed
   install carries it. What is still to come, in the operator's own order: **more clips** (they generate them slowly),
   and then **wiring the folder up as a bundled motion source and mapping clips to default states**.

   | file | bytes | channels | drives |
   |---|---|---|---|
   | `coolIdleGlance.vrma` | 20,644 | 37 | the humanoid rig, plus `J_hips.translation` and the off-rig `E_neutral` / `E_blink` |
   | `innocentStandIdle.vrma` | 18,984 | 35 | the humanoid rig, plus `J_hips.translation` and the off-rig `E_relaxed` / `E_blink` |

   Both are valid VRM animations (GLB magic, a parseable JSON chunk, `VRMC_vrm_animation` 1.0 over 44 humanoid bones),
   and both really drive a real model: the rig moves, the rotations stay finite, and the RAW skinned bone follows the
   clip — measured with `scripts/verify-motion.mjs` against the bundled VRM.

   **THE DEFECT, and it has to be fixed before these drive default states: stopping a clip does not fully restore the
   rest pose.** Both files drive channels that are NOT on the humanoid rig (`E_*`), and the reset
   (`resetAvatarPose` → `humanoid.resetNormalizedPose()` in [lib/scene.js](lib/scene.js)) covers only the humanoid rig —
   so the model keeps a leftover offset. That is the "frozen in the clip's last frame" family of bug this project has
   already fixed once, and it is the difference between a clip pack that is a feature and one that makes the pet's pose
   wrong after every drag. The measurement: `scripts/verify-motion.mjs` fails exactly its two rest-pose checks on these
   two files ("a drag state drops the clip and returns to the procedural pose", "clearMotions() returns the model to
   its rest pose") and passes all 61 on a humanoid-only clip; **the same failure reproduces on the pre-rename commit**,
   so it is a property of the clips and not of the rename. Two fixes, not exclusive:
   * **export the clips without the `E_*` tracks** — they address nodes a VRM humanoid retarget has no use for;
   * **snapshot and restore the WHOLE skeleton on stop** — what the removed MMD path used to do for its own rigs, which
     is the general fix and makes any future clip behave.
   Whichever is chosen, the four drag/fall assertions in `verify-browser.mjs --page client-test` must stay green, and
   each new clip has to be re-checked by hand: `scripts/verify-motion.mjs --model assets/models/SampleModel.vrm
   --motion assets/motions/<clip>.vrma` (that script is NOT wired into any suite, so nothing else will run it).

   **And the wiring, which is a real feature and not just files.** The motion catalogue scans only
   `config.motionDirs` plus the imported directories, so NOTHING under `assets/` is offered out of the box today — a
   bundled motions source is new code, the way `assets/models` already works for models. Each clip also needs 循环/单次
   (a `vrmpet3d-motions.json` manifest beside the files, or the per-clip row in 状态与动作), and then the default
   mapping the operator wants: which states get which clips when a user has configured nothing.

## 4. Frozen zones — do not touch these on the way past

> **⛔ 冻结区（操作者指令，2026-10-12）：「重力、移动时的物理反馈这部分完结，轻易不要动了。」**

The motion this pet feeds the MODEL when it is dragged, thrown, falling or landing: `Scene.setDragMotion`, its two
call sites (`reportDragMotion` / `reportFallMotion` in [lib/client.js](lib/client.js) AND the same two in
[lib/desktop-page.js](lib/desktop-page.js)), and the tuning constants in [lib/scene.js](lib/scene.js)
(`DRAG_LAG_SECONDS` / `DRAG_LAG_MAX_PX` / `DRAG_LAG_TAU` / `DRAG_PITCH_*`).

* **Not a place to tidy up** — not "while I am refactoring", not "one more parameter would look better".
* **The two surfaces' symmetry is a hard constraint.** Every historical "one surface has this effect and the other
  does not" had the same root cause: the two were fed different physics. It happened twice (drag, then fall).
* If it really must change, say what the feel should become first, and the four assertions in
  `verify-browser.mjs --page client-test` (`dragMotion` / `dragWind` / `fallMotion` / `windowFallMotion`) must still
  describe the same thing afterwards. The full rule is in [AGENTS.md](AGENTS.md).

## 5. Verifying a change

`node scripts/check-docs.mjs` is the local suite for a documentation change (it recomputes every count the docs
quote). For code, [AGENTS.md](AGENTS.md) has the table; in short:

| What changed | Run this |
|---|---|
| [lib/core.js](lib/core.js) — rules, cleaning, the state and speech machines | `node scripts/verify.mjs` |
| [lib/index.js](lib/index.js), [lib/settings.js](lib/settings.js), [lib/desktop.js](lib/desktop.js) — routes, catalogs, the settings store | `node scripts/verify-model.mjs` |
| the manifest, activation, `apply`/dispose, the route table | `node scripts/check-plugin-load.mjs` |
| [lib/config-page.js](lib/config-page.js), [lib/global-page.html](lib/global-page.html), [desktop/](desktop/) — the two settings pages and the launcher | `node scripts/verify-desktop.mjs` |
| [lib/client.js](lib/client.js), [lib/menu.js](lib/menu.js), [lib/desktop-page.js](lib/desktop-page.js), [lib/scene.js](lib/scene.js), [build/probe/client-test.js](build/probe/client-test.js) | `node scripts/verify-browser.mjs --page client-test` |
| a delivered chunk's name, or the loader registration | `node scripts/verify-browser.mjs --page chunk-delivery` |
| [vendor/](vendor/) — the pinned 3D stack | `node scripts/vendor-build.mjs --check` |
| the profile wiring, or "is the running app current?" | `node scripts/check-profile.mjs` |

Two habits that are not optional:

* **Regenerate the delivered chunks** after any edit to [lib/core.js](lib/core.js), [lib/scene.js](lib/scene.js) or
  [lib/menu.js](lib/menu.js): `node scripts/client-chunks.mjs`. They are committed copies, and a stale one is a
  SILENT failure — the browser half then disagrees with the host half. The cheap check is
  `node scripts/client-chunks.mjs --check` (under a second).
* **Report what actually ran**, e.g. "core: 1018 passed". Never "all green" from a partial run.

## 6. Where things are

| Path | What |
|---|---|
| [lib/index.js](lib/index.js) | the host half: the `/vrmpet3d/*` routes, the model/motion catalogs, the turn hub |
| [lib/core.js](lib/core.js) | the rules, in ONE place for both halves: states, speech, parts, cleaning, physics, framing |
| [lib/scene.js](lib/scene.js) | the renderer: three.js, the VRM loader, SpringBone, gaze, idle motion, authored clips |
| [lib/client.js](lib/client.js) | the in-app pet: mount into the overlay, gestures, the status line, the speech bubble |
| [lib/desktop-page.js](lib/desktop-page.js) | the floating window's page — its own copy of the gestures and the speech |
| [lib/desktop.js](lib/desktop.js) | the launcher's host-side half: find/borrow an Electron, spawn, stop, describe |
| [desktop/main.js](desktop/main.js) | the launcher itself: the window, the cursor stream, the always-on-top rules, the self-test |
| [lib/settings.js](lib/settings.js) | the settings store (the file, the version counter, the reset refusal) |
| [lib/config-page.js](lib/config-page.js) | BOTH settings pages' script; the markup carries which page it is |
| [lib/config-page.html](lib/config-page.html), [lib/global-page.html](lib/global-page.html) | 模型参数 and 通用设置 |
| [lib/client.core.js](lib/client.core.js), [lib/client.scene.js](lib/client.scene.js), [lib/client.menu.js](lib/client.menu.js), [lib/client.vendor.js](lib/client.vendor.js) | the DELIVERED chunks — generated, committed, never hand-edited |
| [scripts/](scripts/) | the suites and the tools; [AGENTS.md](AGENTS.md) maps them |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the design in depth: why the split is where it is, the vendors, the traps |
| [docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md) | what a model/motion file must be, and the RETIRED MMD chapters |
| [assets/models/SampleModel.vrm](assets/models/SampleModel.vrm) | the ONE bundled model (redistributable; see its README) |

## 7. Environment facts for THIS machine

* the DSH profile is `%USERPROFILE%\.dsh\profiles\desktop`, and the plugin is INSTALLED into it (§2). The running app
  is at `http://127.0.0.1:19387`, which is also where the floating window's page is served (`/vrmpet3d/window`) — the
  address `check-profile.mjs` and the live probes use;
* the operator's own VRMs live in `F:\SynologyDrive\FatFish-pet\Models` and are already imported (four models in the
  picker, §2). No motion directory is imported yet — the two clips in `assets/motions/` are committed but not imported,
  so the picker does not offer them yet (§3 item 4);
* **the operator's motion pack lives in `assets/motions/` and is COMMITTED** (`coolIdleGlance.vrma`,
  `innocentStandIdle.vrma`, plus the folder's README) — it ships with the plugin; see §3 item 4 for the defect to fix
  before it drives default states;
* the installed DSH archive is `F:\DeepSeek\Harness\resources\app.asar`; the chunk-delivery suite finds it by
  itself, and `VRMPET3D_DSH_ASAR` is only needed for an unusual install path;
* the floating window borrows the Electron runtime from that installation by HARD LINKS into
  `<plugin-parent>/vrmpet3d-desktop-runtime` (same volume required — a synced folder can force a 244 MB copy, and
  `verify-desktop.mjs` says so when it does);
* a Chromium-based browser (Edge or Chrome) is needed by the browser suites; `VRMPET3D_BROWSER` overrides the search;
* **the tree lives on a Synology-synced folder.** That is why writes intermittently fail with `ReplaceFileW EIO` /
  `ERROR_SHARING_VIOLATION`, and why the browser suites occasionally rewrite a 3.8 MB inline page into a file the
  sync client is holding.

## 8. Gotchas already paid for — do not re-learn these

1. **The host half is not hot-reloaded.** `hmr.config.root` is empty, so a change under `lib/` takes effect only
   after DSH is restarted. The two settings PAGES are served `no-store` and do follow a reload.
2. **A delivered chunk must be regenerated, and its name must match the loader's rule**
   (`/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` at `/plugins/<package>/<name>?rev=<current>`). The first live
   install failed because the three sources were not chunks at all.
3. **A `<select>` whose options do not match its value still DISPLAYS its first option.** That is how a configured
   provider with an empty model looked complete while the host refused with 「还没有选择 DSH 的模型」. The page now
   ADOPTS the option it is already showing, through its data-loss latch.
4. **The settings page must not write before it has READ.** The whole preferences object is written back on every
   edit, so a page that boots into defaults and then writes replaces everything the user configured. The latch is
   `hasSnapshot`; `persist()` refuses until it is set, and the host refuses an all-default patch on top of that.
5. **A test may not read or write state it does not own.** The suites point the model list, the motion list and the
   settings file at `build/fixtures/`-style scratch paths before they apply the plugin — otherwise a run rewrites
   the operator's real configuration.
6. **The settings are TWO PAGES on two routes** (`/vrmpet3d/config` = 模型参数, `/vrmpet3d/global` = 通用设置). One
   script drives both, so a section that does not exist on the current page returns early rather than throwing — and
   the launcher's self-test NAVIGATES the window between them and merges the two readouts key by key.
7. **A synthetic event that skips the gesture's own steps cannot fail the way a user does.** A pass was spent on a
   right-click swallowed by the pointer lock taken on the PRESS; the probe had been dispatching a bare
   `contextmenu`. Drive press → move → release, with real timers.
8. **A harness that supplies a precondition the product cannot is not a test.** A pointer lock "proved" with a
   `userGesture` flag only the main process can pass worked in the harness and failed in the app. Assert the
   BEHAVIOUR (the view turns while the pointer travels away) instead of the mechanism.
9. **A probe that fails because of where it started is measuring its own setup.** Throwing the pet to the right from
   the bottom-right corner hits an existing clamp, records zero horizontal velocity, and looks like a product bug.
10. **`--page client-test` can hang in this folder** (the page never finishes, so the DOM holds a progress line).
    `verify-browser.mjs` now exits 2 with `the page never finished: …` instead of treating that as a diagnostic page
    and exiting 0 — a silent pass for a suite that ran nothing is worse than a flake.
11. **The tree's own location is load-bearing for the profile.** `dependencies["<package>"]` is a `link:` to this
    folder; renaming the folder or the package without §2 breaks the install.
12. **Two pets cannot both own `shell.overlay`.** `dsh-plugin-whale-pet` must stay disabled while this one is
    active — an install was silently dropped exactly this way once.

## 9. What is NOT proven

**The host half IS live and proven to that point**: the routes answer, `/pet3d/*` is gone, the profile preflight
passes and the floating window is up with a real WebGL2 context (§2). What is NOT proven is anything that needs the
in-app half or a human at the screen:

* the **in-app pet** has not mounted yet — the client half is fetched when the DSH page boots, and the bundle arrived
  after this page loaded (§2: reload it);
* therefore no live pass has seen the two surfaces TOGETHER, the settings pages driven through their real controls,
  a model switch, a 部位 press, the status line over a real turn, or the AI 碎碎念 in its three 台词来源 modes. Every
  one of those is asserted only statically so far;
* a live session is what proves the routes and the two surfaces together — the suites cannot, and neither replaces
  the other.

## 10. Where the history went

The pass-by-pass log (forty-two passes, ~6600 lines: every defect, every measurement, every false start) was moved
out of this file on 2026-10-12 because it buried the state a session actually needs. It is not lost — it is in git:

```bash
git show d9e9785:HANDOFF.md    # the whole log as it stood when this file was cleaned
git log --oneline              # 4993d20 first public snapshot, d9e9785 the rename + VRM only
```

What a pass SHOULD still write down lives in §1-§9 above (state, next step, the frozen zones, the gotchas) and in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (the design). A new pass appends to those rather than re-growing a
chronicle.

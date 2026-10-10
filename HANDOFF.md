# HANDOFF.md — resuming work on dsh-plugin-vrmpet3d

Last updated: 2026-10-12. **This file is STATE, not history.** The pass-by-pass log that used to fill ~6600 lines is
in git (see §10); what is here is what a session on another machine needs to pick the project up without asking
anything.

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

## 2. THE INSTALL NEEDS ONE STEP, and it is this

The profile still names the OLD package, and that mismatch is the whole problem: the folder declares
`dsh-plugin-vrmpet3d` while the profile asks for `dsh-plugin-pet3d`.

| Thing | State right now |
|---|---|
| `dependencies["dsh-plugin-pet3d"]` | `link:F:/SynologyDrive/FatFish-pet/dsh-plugin-pet3d` — the OLD name, pointing at this same folder |
| `dsh.profile.bundles` | lists `dsh-plugin-pet3d`; the bundle's own patch now inserts `vrmpet3d` |
| `cordis.yml` | materialized (69 KB). A row for the old name is an unresolved insert row, and DSH fails that entry |
| `dsh-plugin-whale-pet` | still a dependency, **disabled** and not in `bundles` (both pets own `shell.overlay`) |
| imported model directory | `F:\SynologyDrive\FatFish-pet\Models`, persisted in `pet3d-model-dirs.json` — a name the new build still READS |

Stop DSH first (the host half is not hot-reloaded), then:

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"

# 1. What the profile says today (read-only). Expect the OLD name in both places.
node -e "const m=require(process.argv[1]+'/package.json');console.log(m.dependencies['dsh-plugin-pet3d'],(m.dsh.profile.bundles||[]).includes('dsh-plugin-pet3d'))" $profile

# 2. Two edits in <profile>/package.json: delete dependencies["dsh-plugin-pet3d"], and drop the same string from
#    dsh.profile.bundles. Then remove the stale link (a junction, not a copy):
Remove-Item -Recurse -Force "$profile\node_modules\dsh-plugin-pet3d"

# 3. Install the new name. The installer writes package.json.bak-<stamp> itself.
node scripts/install-desktop-plugin.mjs --profile $profile

# 4. Prove the profile resolves it — PASSED before anyone looks at the screen:
node scripts/check-plugin-load.mjs --profile $profile

# 5. If cordis.yml still carries a row for the old name, re-materialize it (plugin manager install_bundle with the
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

1. **「继续修复状态显示」 — ASK FIRST.** No reproduction was ever given. What 「状态显示」 covers is one visible thing
   drawn by BOTH halves: the per-state box sets on the 通用设置 page's 状态 section, the whale mask, the live clock,
   the tone (任务达成 gold / 出错 red), the rectangle and the font scale. Ask which surface, which state, what it
   shows and what it should show. Then check, in this order:
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
2. **Nothing else is open.** Everything the operator has asked for is implemented and asserted; the last three
   passes were the 部位 rows, the AI 碎碎念 source rule, and the rename (§1).

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

* the DSH profile is `%USERPROFILE%\.dsh\profiles\desktop` (its state is in §2);
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

**Nothing in the last four passes has been exercised against a running DSH since the rename.** The suites cover the
code paths, and `verify-desktop.mjs` borrows a real Electron and opens a real window — but a live session is what
proves the routes and the two surfaces together. The first live check is §2 step 4
(`node scripts/check-plugin-load.mjs --profile …` must print PASSED), then the pet on screen.

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

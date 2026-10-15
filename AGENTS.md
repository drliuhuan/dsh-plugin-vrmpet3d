# AGENTS.md — the working rules for this repository

These rules are for whoever (or whatever) edits this tree. They sit beside the code so a session that has read
nothing else still gets them right.

> **任务做完只跑局部验证。全量验证的时机由操作者决定。**
>
> A finished task is verified with the NARROWEST suite that covers the change. `node scripts/verify-all.mjs` is
> **not** part of finishing a task — the operator runs it, when the operator decides to.

## Why this rule exists

`verify-all.mjs` is the operator's instrument, not a reflex:

* it runs **nine suites**, including two that start a real browser and one that borrows an Electron runtime and
  opens a **real always-on-top window** on the operator's screen — so a run takes tens of seconds and, on a busy
  machine, interferes with whatever the operator is doing;
* the `docs` suite shells out to **every other suite** to recompute their counts, which makes it the most expensive
  one of all — and it is the one a partial change almost never needs;
* running the whole tree after every edit buries the ONE suite that mattered in pages of output, which is how a
  real failure gets skimmed past.

A partial run is still a real run: it just has to be the RIGHT part, and its result has to be reported as what it
is.

## What to do when a task is finished

1. **Run the suites whose inputs changed**, from the table below. Nothing else.
2. **Regenerate what the change invalidates.** `node scripts/client-chunks.mjs` after any edit to `lib/core.js`,
   `lib/scene.js` or `lib/menu.js` — the delivered chunks are committed copies, and a stale one is a *silent*
   failure. That is a build step, not verification; the cheap freshness assertion is
   `node scripts/client-chunks.mjs --check`.
3. **Report which suites ran and what they said** — "core: 786 passed", not "all green". Never write
   "the tree is green", "verify-all passes" or any equivalent from a partial run; that claim belongs to whoever
   ran the whole tree.
4. **Update the counts the docs quote if the change added or removed an assertion.** The numbers in `README.md`,
   `docs/ARCHITECTURE.md` and `HANDOFF.md` are part of the change, not a later chore. You do not need a suite run
   to know that a count moved.
5. **Run the whole tree only when:** the operator asks for it (「全量验证」/「跑一遍全部」/ "verify-all"), a task
   genuinely spans every suite (a manifest, activation or route-table change that several suites assert on), or
   this is a session's opening check that the operator asked for.

## Verification never runs itself

The packaged artifact carries no `scripts/` (`files[]` excludes it), so an installation — plugin manager, package
manager or `github:` spec — gets the pet and not the suites; nothing in `apply()`, the launcher or a route ever
reaches one. The suites live in the repository and are run by hand.

The `desktop` suite is the one exception to "verification is invisible": it opens a **real always-on-top window**
on the machine running it, because proving the window it makes is the point. Ask for a pass without it:

```bash
node scripts/verify-all.mjs --no-window      # the same nine suites; the desktop live half is skipped and says so
node scripts/verify-desktop.mjs --no-window  # or VRMPET3D_SKIP_DESKTOP=1 for that one suite
```

Its Node half still runs, the skip is PRINTED rather than passed silently, and `check-docs.mjs` forces the live
half back ON when it measures the documented count — so a switch left in someone's shell cannot make the numbers
in the docs look wrong.

## Which suite covers what

| What changed | Run this |
|---|---|
| `lib/core.js` — rules, cleaning, the state and speech machines | `node scripts/verify.mjs` |
| `lib/index.js`, `lib/settings.js`, `lib/desktop.js` — routes, catalogs, the settings store | `node scripts/verify-model.mjs` |
| the manifest, activation, `apply`/dispose, the route TABLE | `node scripts/check-plugin-load.mjs` |
| `lib/config-page.html`, `lib/global-page.html`, `lib/config-page.js`, `desktop/` — the two settings pages and the launcher | `node scripts/verify-desktop.mjs` |
| the shipped line sheets — `speech-lines-review.md` (碎碎念) or `part-speech-lines-review.md` (部位台词) | `node scripts/speech-lines.mjs --check` and `node scripts/part-lines.mjs --check` (each REWRITES `lib/core.js` from its sheet, so the check is the local suite for them — then `node scripts/client-chunks.mjs` and `node scripts/verify.mjs`) |
| `lib/setup-page.html`, `lib/setup-page.js`, or anything that triggers the first-run guide | `node scripts/verify-desktop.mjs` (the page parses, and its screens match the markup) **and** `node scripts/verify-browser.mjs --page client-test` (the guide walked end to end) |
| `lib/model-picker.js`, `lib/picker-page.html`, `lib/picker-page.js` — the model picker: 切换模型's page, and the SAME component the guide's ② 偏好模型 step mounts | `node scripts/verify-desktop.mjs` (both scripts parse, the mount agrees) **and** `node scripts/verify-browser.mjs --page client-test` (the guide walked, drop and all) |
| `lib/client.js`, `lib/menu.js`, `lib/desktop-page.js`, `lib/scene.js`, `build/probe/client-test.js` — the widget, the shared right-click menu and the renderer | `node scripts/verify-browser.mjs --page client-test` |
| a delivered chunk's name, or the loader registration | `node scripts/verify-browser.mjs --page chunk-delivery` |
| `vendor/`, the pinned 3D stack | `node scripts/vendor-build.mjs --check` |
| documentation, or any count those docs quote | `node scripts/check-docs.mjs` (it recomputes the totals, so it IS the local suite for this case) |
| the profile wiring, or "is the running app current?" | `node scripts/check-profile.mjs` |
| what the RUNNING app is actually serving (routes, page sources), after a restart | `node scripts/live-check.mjs` |

Overlapping changes mean the union of those rows — still not the whole tree.

## 冻结区：模型物理反馈（操作者指令，2026-10-12）

> 「重力、移动时的物理反馈这部分完结，轻易不要动了。」

**这块已经定稿，不要顺手改。** 具体指：宠物被拖动 / 抛掷 / 下坠 / 落地时喂给模型的运动反馈，也就是
`Scene.setDragMotion` 这条通道、它的两个调用点（`lib/client.js` 的 `reportDragMotion` / `reportFallMotion`，
`lib/desktop-page.js` 的同名两份）、以及 `lib/scene.js` 里 `applyDragLag` 的调校常数
（`DRAG_LAG_SECONDS` / `DRAG_LAG_MAX_PX` / `DRAG_LAG_TAU` / `DRAG_PITCH_*`）。它按手感定过、也按上面的读数测过。

* **不要为了别的事情动它**：不是"重构顺便统一一下"的地方，也不是"加个参数看起来更好"的地方。
* **两界面的对称是硬约束**：同一个手势必须喂同一种物理。历史上每一次"一个界面有这个效果、另一个没有"，根因都是
  这条被破坏（拖动、下坠各一次）。
* **真要改就先说清楚**：为什么要改、期望的手感变成什么样，再动手；改完 `verify-browser.mjs --page client-test`
  里那四条断言（`dragMotion` / `dragWind` / `fallMotion` / `windowFallMotion`）必须仍然说明同一件事。

## What "partial" never means

* **It never means "no verification."** A change with no run behind it is an unverified change, and the report has
  to say so.
* **It never means skipping the cheap freshness check.** `node scripts/client-chunks.mjs --check` catches a stale
  delivered chunk in under a second; a stale chunk ships a browser half that disagrees with the host half, which is
  the failure mode this repository has hit most often.
* **It never means a live check instead of a suite.** A running app proves what a suite cannot (see `HANDOFF.md`'s
  live pass) and proves nothing about the cases a suite pins; both have their place, and neither replaces the other.

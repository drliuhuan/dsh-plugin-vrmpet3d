# HANDOFF.md — resuming work on dsh-plugin-vrmpet3d

Last updated: 2026-10-12. **This file is STATE, not history.** The pass-by-pass log that used to fill ~6600 lines is
in git (see §10); what is here is what a session on another machine needs to pick the project up without asking
anything.

**▶ NEXT SESSION, in the operator's own order (§3):** finish today's install and run the first LIVE pass (one reload
of the DSH page is the operator's click, §2) → 「继续修复状态显示」, which still needs a reproduction → 碎碎念 to the
model with the TIME plus the greeting feature (早/中/晚, 吃饭了没有, 睡觉了没有, 辛苦了) → the VRMA motion pack: it is
committed and shipping, and the rest-pose defect that was going to stop it driving default states is FIXED (§3 item 4;
it was in this plugin's maths, not in the clips), and the folder is now a BUNDLED motion source that needs no import —
what is left there is more clips, and the operator's own state→clip mapping, which is one manifest block.
**`assets/motions/idle.vrma` is new and still UNTRACKED in git** — the operator generated it, it is part of the pack,
and it needs committing with the others.

**BRANCHES: this file describes the `dev` branch.** `main` carries the plugin itself — `lib/`, `desktop/`,
`assets/`, `docs/`, `initial-config/`, the manifest, `README.md` and this file — while the suites, the `build/`
tools, the probes and `AGENTS.md` live on `dev`, where development happens (operator, 2026-10-13: 「这些调试相关的
内容不要放进main…main 只放插件本身」). Merge `dev` into `main` by PATH, not with a bare `git merge`:
`git checkout main && git checkout dev -- lib desktop assets docs README.md HANDOFF.md package.json cordis.patch.yml LICENSE`,
then commit — a plain merge would bring the tooling back with it.

**The tree is green: 9 suites, 2281 checks.** `node scripts/check-docs.mjs` re-derives every one of those figures by
running the real suites, and validates the counts quoted here, in [README.md](README.md) and in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — so its verdict is the statement. Running
`node scripts/verify-all.mjs` is the OPERATOR's call, never a finishing reflex: [AGENTS.md](AGENTS.md) says which
narrow suite covers which change, and a partial run has to be reported as a partial run.

⚠️ **The `desktop` figure is only real with the WINDOW OPEN, and it had drifted.** Its live half is where the settings
window's own defaults are asserted, and two of those checks held LITERALS (the gaze slope 0.4, the draught's reach 0.1)
that stopped being the defaults when the operator moved them — so the live half had been failing two checks, unseen,
every run since (nobody runs it without a window on purpose). Both now read `core.DEFAULTS` instead, the shipped values
are pinned by VALUE in `verify.mjs`, and a real green run on 2026-10-13 printed **desktop: 268** — which is where the
documented total's 268 comes from rather than from adding a remembered live count to a measured Node half.

**An import COPIES, and a first-run guide ships with it.** A model is imported as a FILE and a motion pack as a
FOLDER; the host copies the bytes into the profile's own state directory
(`<profile>/vrmpet3d-desktop/models|motions`) and both catalogues read them from there, so the folder they came from
may move, be renamed or vanish. The panels still LIST a directory an older build imported, and still remove it, but
no new one can be added — a recorded path was a live dependency on somebody else's folder, which is the defect the
file import replaced. The guide itself (`/vrmpet3d/setup`, `lib/setup-page.*`) is 欢迎 / 偏好模型 / 桌宠界面 /
AI 碎碎念 / 完成 — 模型动作 is HIDDEN and 桌宠界面 is skipped where no independent pet can exist (dsh web), which is
why the stepper's entries carry no numbers (operator, 2026-10-13: 「不要在框架上部的…中不要写数字和序号」). The
in-app pet offers the guide once per plugin ACTIVATION until 完成 writes `completed` in
`<profile>/vrmpet3d-setup.json`, while `prompted` is the host's memory — so a page reload is quiet and a restart
asks again, exactly as the operator specified.

**The shipped DEFAULTS are his, as of 2026-10-13** (「修改几处默认配置」, and then 「以当前通用设置中的参数为默认，作为初始
设置参数推上去」): 视线 曲率 0.1 with a 0.05–1 control, 静止停看 2 s, 划过强度 1, 作用范围 15 %, 满力速度 2000 px/秒, 碎碎念
每句显示 8 s / 空闲嘀咕 20–60 s / 工作嘀咕 12–36 s, AI 温度 0.5, and 静息态一次性动作间隔 20–60 s — all in `lib/core.js`
(`DEFAULTS` + `GAZE_CURVE_RANGE` + `WIND_LIMITS` + `SPEECH_LIMITS`), with the page's slider bounds AND its placeholder values
matched. Every one of those numbers is pinned as a LITERAL in `verify.mjs`, because a default that is only compared with itself
moves in the panel, in the docs and in the suite at once — consistently and silently.
**状态与动作 ships his mapping too**: the
`defaults` block of [assets/motions/vrmpet3d-motions.json](assets/motions/vrmpet3d-motions.json) is his per-state clip
list, translated from profile ids to FILE NAMES (resting 14, waiting 3, done 3, error 2, offline 1), and the `clips`
block carries his 循环/单次 per clip. The one part of that section that CANNOT ship in the manifest is the per-clip 凝视
switch — the format has no place for it — but the per-state 间隔 no longer needs one: `DEFAULTS.motionEvery` is his
`resting {min:20,max:60}`, and only a profile that has STORED an interval (an empty map included, which is how "off" is
stored) keeps its own. Say the word if the 凝视 switch should be added to the manifest file.

**The two TEXTS have a FIXED default size, and the pet's box is not consulted** (operator, 2026-10-13: 「状态文字默认大小设置
为18px」, then 「默认文字大小固定，放大缩小的倍数和盒子大小解耦连，就是完全不相关，避免缩放模型的时候缩放文字」): `STATUS_FONT_PX`
is 18, 碎碎念 is its 0.95 (`core.speechPromptFontPx`, 17.1 px), and the signature takes the model's correction and NOTHING else —
so `statusPromptFontPx.length === 1`, asserted, because a box argument is how the coupling would come back. That deliberately
REVERSES the rule this file used to carry (0.033 of the pet's box, the answer to 「文字也没有随着模型变大」): do not "fix" it back.
The only thing that moves the size is the per-model wheel correction (`statusScale`, 0.35×–4×, absolute 6–160 px), and since this
round the wheel works over EITHER text — one number behind both, so the bubble keeps its 0.95. On the floating-window side the
bubble is now IN the page's hit test (`isOverSpeech`) because the launcher only delivers a wheel where the window says it wants the
mouse; it used to be deliberately left out when a bubble was only something to read. `core.speechPromptFontPx` owns the ratio so the
two surfaces cannot drift. And neither plate WRAPS or CAPS its width (「不管碎碎念和状态信息多长，都不要换行。给盒子的宽度留大一点」):
the speech bubble's old `max-width:18em` is gone, because with `nowrap` a cap leaves the background short of the text it is behind —
the same defect the prompt's own `max-width` was removed for on 2026-10-09.

**碎碎念 now ships the operator's own CHARACTER as the default persona** (2026-10-13): `core.DEFAULT_SPEECH_PERSONA` is the
DeepSeek娘 prose (453 chars, 17 lines, the 经典语句 verbatim), `DEFAULT_SPEECH_AI.persona` carries it, and an EMPTY 人格 box
means it — `cleanSpeechAi` falls back to it, so the panel, the host and the suites read one value and his existing profile
picks the character up without a settings edit. One subtlety that is load-bearing: `authoredWeight` in `lib/settings.js`
compares the persona with the shipped one instead of testing it for emptiness, because otherwise every profile would
score above 0, `update`'s "refuse an all-defaults patch" guard could never fire, and the protection added on 2026-10-11
would silently retire.

**And the built-in 碎碎念 table is now HIS lines** (same day, second round): `SPEECH_LINES` replaced its 2–3 line
starter sets with 20 lines per event in BOTH languages — 21 for 工作中 — with 等待确认 split into `waiting` (等你回话)
and `approval` (需要授权) as he asked, with his lines kept verbatim (`这个按钮有什么用？` `rm -rf / 是什么意思？`
`飞行模式，可以点吗？` — a typo he fixed the same day — plus the six he added: DROP TABLE / 暴露22端口 / 合并生产与测试
环境 / root密码123456 / sudo会变快吗 / API Key 写进 README — and `dsh? 大烧货？` in 工作中). The WHOLE 需要授权 pool is
written in his register, 「极度危险又可爱的问句」: all twenty lines are questions, which the suite asserts by shape so a
future edit cannot quietly turn them back into statements. The `rm -rf /` line is the ONE shipped line that mentions a slash, so the
suite's path rule now refuses path-LIKE text (a segment after a slash, a drive letter, an extension) and asserts that
joke's presence instead of failing on it. The generator and the review copy live in `build/probe-out/`
(`gen-speech-lines.mjs`, `speech-lines-review.md`).

**The 碎碎念 table round-trips through a MARKDOWN file he edits by hand.** `speech-lines-review.md` (repo root) is
regenerated from what is SHIPPED and written back by `build/probe-out/speech-lines-md.mjs` (`export` / `report` /
`import [--dry-run]`). He edited it on 2026-10-13 late — 30 working lines rewritten, 15 left with an empty English cell
and 2 more whose Chinese changed under a stale translation — and all 17 were translated and imported. The importer
REFUSES structural damage (a renamed pool, an empty pool, a row with no Chinese or English, an illegal cadence) and only
WARNs about length and in-pool repeats, which is the line between "he is writing lines" and "he broke the table".
⚠️ One line ends MID-CHARACTER **on purpose**: working's `飞行模式是什么？好像什么事也氵`. He explained the joke —
氵 is the left half of 没, so the sentence died with the connection — and the English cuts the word instead
(`What's flight mode? Nothing happe-`), because a letter cannot be half-written. It looks like corruption and is not:
the suite pins that exact string so nobody "fixes" it, and `SPEECH_LINES`' own comment says so.

🛠 **The importer's anchors are newline-AGNOSTIC, and there is a reason to check that before editing it.** On
2026-10-13 the tool searched for a `CRLF`-prefixed terminator while `lib/core.js` held a bare-LF table block (an
earlier write had left one), so the "end of the table" it found was the NEXT one and it deleted `SPEECH_STATES`,
`DEFAULT_SPEECH_PROMPTS` and their comments. Nothing shipped — `verify.mjs` failed on the very next run with
`SPEECH_STATES is not defined` — and it was restored byte-for-byte from `lib/client.core.js`, which is `lib/core.js`
VERBATIM (that is what the chunk is), a fact worth remembering as a recovery source. The anchors are regexes now.

**The 工作中 pool is 41 lines and the pet CHATTERS while working** (second round, same day). His dangerous-cute lines
began in 需要授权 as questions; he moved them into 工作中 as COMPLETED statements (「我把那个按钮点了，看看有什么用。」…) and
asked for approval to be serious again, so `approval` is now twenty plain requests with none of the jokes — asserted by
TOKEN, not by eye. 工作中 is 41 rather than his predicted 40 because `dsh? 大烧货？` was already its twenty-first (told to
him). And it talks on its own cadence: `workingMinSeconds`/`workingMaxSeconds` (12/36 by default) are a SECOND window
beside the idle one, wired into `SpeechMachine.chatterAt` — the one event that speaks more than once while it lasts,
never back-to-back and never sooner than `minGapSeconds`. That window has its own row in 通用设置 → 碎碎念
(「工作嘀咕间隔」), because a feel value belongs where the person feeling it can move it.

**The AI half of 碎碎念 is shown for the AI source ALONE** (operator, 2026-10-13: 「如果台词来源是内置台词，则下方的AI相关
设置不显示」, and when asked whether 自定义短语 should keep it: 「自定义短语也隐藏」 — 自定义 never calls a model either): with
内置短语 or 自定义短语 chosen, the provider, model, persona, temperature and 试一句 are controls for a feature that is not in
use. `showSpeech` hides the `#speech-ai` BLOCK and nothing inside it — the dsh/custom rows keep their own toggle, and the
per-state boxes stay, because a 台词 box is where 自定义短语's own lines live. The page publishes `speech.aiVisible`, which is
a DIFFERENT fact from `speech.aiControls` (the controls exist either way); the live settings-window half asserts
`aiVisible === false` against a source it has just asserted is builtin, and the Node half owns the markup↔script join.

**The 通用设置 page reads the MODEL for its 状态与动作 dropdowns** (operator, 2026-10-13: 「通用设置面板中，状态与动作中，每个动作
的表情和口型设置始终是空的，必须动态从模型上加载」). Two bugs behind one symptom:

  * `loadModelInfo` refused to ask unless the MODEL PICKER was in the document — true while the only expression names on screen
    were the model page's emotion table, and false the moment 状态与动作 grew a per-clip 表情/口型 dropdown, because those options
    ARE the model's expression list. The guard now asks `needsModelVocabulary()` (`model-select` OR `motion-list`); the 通用设置
    page loads the catalog too (so a fresh profile with nothing live can still resolve a model); the info is re-read when a model
    was switched from another window (`modelInfoId`); and one in-flight read is shared instead of asking twice per boot (measured:
    two identical `model-info` requests before that guard went in).
  * the VOCABULARY: `MOUTH_EXPRESSIONS`/`BLINK_EXPRESSIONS` listed only VRM 1.0's spellings (`aa`, `blinkLeft`), while the bundled
    VRM 0.x `SampleModel.vrm` carries `a`/`i`/`u`/`e`/`o` and `blink_l`/`blink_r` (read out of the file, not guessed). Its 口型
    dropdown was empty for that reason as well, and its mouth shapes were offered as MOODS in the 表情 table. Both spellings are
    listed now, and `expressionAnswersTo` in [lib/config-page.js](lib/config-page.js) matches an expression's name OR its
    presetName, case-insensitively. Asserted both ways: the vocabulary against the file's own keys in `verify.mjs`, the loaded
    options in the desktop suite's live half (`motions.clipFaceOptions`), and both were measured in a real Chromium against the
    real pages — 6 expressions / 3 mouths on a stub, and 15 expressions / **5 mouths (A E I O U)** against `SampleModel.vrm`.

**The AI-prompt box in 部位 carries ONE generic grey hint, whatever the part is** (2026-10-13: 「胸部和屁股的AI提示词，
默认状态下尽管有内置提示词，但是也应该是和其他部位的默认灰色字体提示一样」): 胸部/屁股 keep their shipped INSTRUCTIONS — the host
still sends them when the box is empty — but the box no longer spells them out. The 碎碎念 box follows the SAME
rule since the operator asked for it too (「碎碎念框那行也变成通用灰字」): one hint per SOURCE, for every part, and the two
generic wordings stay because they are about the mode. Both shipped strings still ACT when a box is empty, and
`builtinSpeech` in the page's published state still carries them. The assertions live in the desktop suite's LIVE
settings-window half (`promptHints` and `lineHints` in the page readout), which `--no-window` skips.

**The procedural idle no longer moves the BODY at all** (「停用idle状态下微旋转」, 2026-10-13): `idlePose` writes no
yaw (the vertical bob went the same way on 2026-10-09) and `Scene.tick` sets `stage.rotation.y` to the user's own
`yaw` preference and nothing else — `YAW_GAIN` is gone with it. What is left of the idle is BREATHING and the
chains' delayed follow-through, which is what the `sway` preference still scales. Both suites assert the ABSENCE,
because a body that turns by itself is exactly what a later refactor reintroduces.

**The 单次/循环 playback rules are the operator's (2026-10-13) and live in `Scene.afterOneShotEnded`:** a finished
one-shot chains into a RANDOM loop when the state has one, holds its LAST FRAME when it does not, and is never played
as a loop (`LoopOnce` is applied per playback from `motionLoops(id, state)`, not baked in at build time); a due
reaction may interrupt a running loop, and both draws are random. A clip that carries its OWN expression tracks
suppresses blinking (`clipDrivesFace`). The probe's `oneShotRules` check drives all of it on a real avatar.

**His CURRENT configuration is captured in `initial-config/`** — operator instruction, 2026-10-13: every step of the
release's initial configuration goes into git, finished or not (「每一步都要上传到github，包括我还没有构造好的初始配置
文件，即当前配置」). `node scripts/capture-config.mjs` copies the live profile's plugin config into that folder, `--check`
compares without writing, and `--catalog` adds the id → file-name map a release needs. The folder is deliberately
OUTSIDE `files[]`, so his machine's absolute paths never reach a user; `vrmpet3d-setup.json` is refused on purpose,
because shipping the guide's `completed` flag would make every new user skip the guide. What SHIPS is the pack
manifest's `defaults`, keyed by FILE NAME — the settings store's ids are minted per profile — and the two
release-time jobs (that translation, and reverting his local-only values) are written out in
`initial-config/README.md`.

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
4. **THE VRMA MOTION PACK — committed, shipping, and the rest-pose defect is FIXED.** Operator,
   2026-10-12, verbatim: 「这是我自己设计的要随插件分发的动作包，没有版权问题，我只是构造的很慢，所有动作都配置好后，
   我还要把这些都配置到默认状态里，所以都要上传，要随插件分发。」

   So this is settled: the pack is the operator's own work, it belongs in the repository, and it SHIPS with the plugin.
   It lives in `assets/motions/` (committed 2026-10-12 together with its own README, which records the provenance and
   the licence position), and `assets` is already listed in `package.json`'s `files[]`, so a packed install carries it.
   What is still to come, in the operator's own order: **more clips** (they generate them slowly), and then **wiring
   the folder up as a bundled motion source and mapping clips to default states**.

   **The pack is filed BY STATE as of 2026-10-12 (second pass), and it is no longer three loose files.** Operator,
   verbatim: 「把对应的动作直接解析到指定目录，这样在选择动作的时候就不会出现很长一串，另外加一个working的文件夹，对应工作中的状态。」
   and 「你把对应的文件夹名字改成你先前的英语，我的英语不是那么标准。」 So the folder names ARE the state keys:
   `idle/` `working/` `attention/` `success/` `fail/` `offline/`, declared in the manifest's `stateFolders`, and a
   state's picker offers **only its own folder's clips**. `dance/` is deliberately mapped to NO state — it is the
   holding folder for the dance clips below, and giving it to a state is a one-line manifest edit
   (`"resting": ["idle", "dance"]`). A `stateFolders` value may be a folder name **or a list of them**.

   **COMPRESSED CLIPS (`.vrma.br`) — brotli, and the LZMA2 decoder is NOT in the path.** Operator: 「因为舞蹈的VRMA特别大，
   我需要你引入LZMA2解压缩的能力，我会把舞蹈VRMA压缩，用的时候直接解压缩到内存使用，而不是直接调用文件。」 Measured first,
   because it decided the answer: **Node's `zlib` cannot decode LZMA** (`unzipSync` / `inflateSync` / `gunzipSync` all
   return `Z_DATA_ERROR` on a file the reference liblzma wrote), and this plugin has NO npm dependencies — so LZMA2
   would mean maintaining a hand-written decoder. A pure-JS LZMA2 decoder (one module in `lib/`, driving itself
   against the reference liblzma from one script in `scripts/`) was written in that pass and **did not decode real
   binary content correctly**: the XZ container, the LZMA2 chunk framing, raw chunks and simple streams all
   round-tripped, and
   CRC/corruption/bomb cases refused properly, but any realistic payload — a real VRMA, or anything with float32
   or JSON structure — diverged after a few symbols on the matched-literal path and raised a bad-distance error.
   It was therefore never wired in: a decompressor that returns plausible garbage hands the renderer a malformed
   model, which is worse than not supporting the format. **The operator chose to DELETE both files (2026-10-12)
   rather than carry unfinished code**, so LZMA2 is not supported by this build at all. Brotli is in Node and in
   every Chromium the pet runs in, so the operator chose brotli, and the cost is about 10%: on their first dance
   clip **LZMA2 2,401,262 against brotli 2,836,574** out of 8,080,556 raw — 46% against 35.1%, both
   byte-identical. Whoever wants that 10% back is writing the decoder again, and the two traps are worth keeping:
   the LZMA2 chunk size fields are encoded as `N - 1` (both of them, and the unpacked size's high five bits ride in
   the control byte RAW rather than as a count), and the `posDecoders` tree is reverse-indexed rather than indexed
   by the growing node.

   How compression works end to end: `<name>.vrma.br` is accepted by `core.motionFormatOfName`, so a compressed clip
   is a **`vrma`** to every reader (the format sets stay disjoint, nothing is sniffed) and the catalogue adds
   `compressed: true` with the FILE's size; if `x.vrma` and `x.vrma.br` sit in one folder, the archive REPLACES the
   plain file so one animation is never offered twice. The **host** unpacks in `createMotionHandler`
   ([lib/index.js](lib/index.js)) with [lib/brotli.js](lib/brotli.js), so `/vrmpet3d/motion?m=` always answers with
   plain VRMA bytes, `model/gltf-binary` and the UNPACKED length, and the renderer keeps its one load path. One
   unpacked clip is kept per handler (bounded, so the pack cannot sit in the host's heap), and a clip that cannot be
   unpacked is a **500 with the reason**, never a truncated 200 that would be reported as malformed clip content. A
   bomb refuses on `maxOutputLength`. [scripts/compress-motions.mjs](scripts/compress-motions.mjs) is the operator's
   tool (`npm run pack:motions`); it refuses to write an archive that does not decompress back to the same bytes. The
   panel says 已压缩 and the note counts them, because a 2.7 MB entry that plays as an 8 MB animation otherwise reads
   as a broken number.

   | folder | clips | state | git |
   |---|---|---|---|
   | `idle/` | 16 (the three originals moved in here) | `resting` | committed, moves pending |
   | `working/` | 0 — created for the 工作中 clips, and it declares the state | `working` | empty dir (git ignores it) |
   | `attention/` | 3 | `waiting` | committed |
   | `success/` | 3 | `done` | committed |
   | `fail/` | 2 | `error` | committed |
   | `offline/` | 1 | `offline` | committed |
   | `dance/` | 1 clip, stored compressed only (`.vrma.br`) | **NONE — deliberately unmapped** | the archive is the only copy |

   `assets/motions/coolIdleGlance.vrma` and `innocentStandIdle.vrma` show as `D` in git status because they MOVED into
   `idle/`; they are not lost. On the operator's instruction (2026-10-12) the `.7z` and the uncompressed `.vrma` were DELETED, so `dance/` holds
   one 2.71 MB archive and the folder ships at that size instead of 12.9 MB.

   All the original clips are valid VRM animations (GLB magic, a parseable JSON chunk, `VRMC_vrm_animation` 1.0 over
   humanoid bones), and they really drive a real model: the rig moves, the rotations stay finite, and the RAW skinned
   bone follows the clip — measured with `scripts/verify-motion.mjs` against the bundled VRM. **The dance clip passes
   all 64 checks of that script after being unpacked from its archive** (2026-10-12), which is what proves the archive
   holds a real animation and not merely bytes that decompress.

   **THE DEFECT IS FIXED, AND IT WAS NEVER IN THE CLIPS.** The previous state of this file recorded a measured
   "stopping a clip does not fully restore the rest pose", attributed to the `E_*` channels being off the humanoid rig
   that `resetAvatarPose` → `humanoid.resetNormalizedPose()` covers. **That attribution was wrong**, and the way it was
   disproven is worth keeping: the probe failed the same two checks on the repository's OWN all-humanoid test clips
   (`build/fixtures/vrma/vrmpet3d-wave.vrma`, `-rest.vrma`, `-stretch.vrma`, `-happy-hop.vrma`, `-look-around.vrma`,
   `-weight-shift.vrma`), **none of which contains an `E_*` track at all**, while `vrmpet3d-test.vrma` — which drives
   only hips and head and **no upper arm** — passed all 61. The shared property that mattered was *driving an upper
   arm*, not the `E_*` channels.

   The real cause was in this plugin. `core.aimDownQuaternion` built its axis as the cross product of the limb
   direction and the target, whose LENGTH is `sin(angle)`, and then called `normalize3` **only as a truthiness test**,
   returning the raw cross product. Unit only when the limb is exactly perpendicular to down; measured on
   `SampleModel.vrm` the axis came back **0.9989177966483648** long (arm 87.3342° from perpendicular). The caller turns
   that straight into a quaternion and three.js's `setFromAxisAngle` does **not** normalise, so the pet's arm stance
   was **|q| = 0.999599**. Nothing the eye could see broke — three.js normalises on the way to the matrix — but the
   probe read it as a pose: `Quaternion.angleTo` does not normalise either, so it measured `acos(1 − 0.0008)` and
   reported **4.59°**, with `dot = |q|² = 0.9991972774074883` being the giveaway that the two "differing" quaternions
   were byte-identical. The arms were always in the correct pose; the pose *measurement* was wrong.

   Fixed on both sides, and both halves matter:
   * [lib/core.js](lib/core.js) `aimDownQuaternion` now **returns the normalised cross product** (`unitCross`), so the
     axis is unit by contract — the `@returns` says so. A new assertion in group 12 of `verify.mjs` pins it with the
     exact 0.998918-length geometry this model produced.
   * [scripts/verify-motion.mjs](scripts/verify-motion.mjs) now measures with `rotationBetween()`, which divides the
     quaternion lengths out, instead of `Quaternion.angleTo`; so a scale factor can never masquerade as a pose
     regression again. This did NOT need the `E_*` tracks exported, and it did NOT need a whole-skeleton snapshot —
     both former "ways out" are withdrawn as unnecessary for this bug.

   Re-check any new clip by hand, because that script is NOT wired into any suite and nothing else will run it:
   `scripts/verify-motion.mjs --model assets/models/SampleModel.vrm --motion assets/motions/<clip>.vrma`.

   **And the wiring — DONE 2026-10-12, and it was new code as predicted.** `assets/motions` is now a BUNDLED
   motion source: `buildMotionCatalog` scans it FIRST with `source: 'bundled'`, exactly as `buildCatalog` scans
   `assets/models`, so the pack is offered out of the box with nothing imported. `/vrmpet3d/motions` reports
   `bundledDir` (the parallel of the model catalogue's key) and `motionDefaults`; a user directory naming the
   bundle is not scanned twice, and a user clip sharing a bundled file name is still listed, told apart by
   `source`. Per-clip 循环/单次 comes from this folder's own `vrmpet3d-motions.json`, which now exists and
   declares all three clips as loops.

   **What is left for the operator, and only this:** the pack's manifest carries an EMPTY `defaults` block —
   `{ "resting": ["idle.vrma"], ... }`, keyed by state name, valued by file name relative to `assets/motions`.
   It ships empty on purpose: nothing plays without a mapping, so the pack cannot change a user's pet behind
   their back. Filling it in needs **no code change**; the resolution rule is
   `core.motionMapWithDefaults`, which reads at render time and never persists (an explicit choice wins,
   including an explicitly cleared state, and a name that is not in the catalogue maps nothing).
   Suite coverage: `verify.mjs` (the motion-map group), `verify-model.mjs` group 5b (the bundled pack), and the
   two surfaces' `effectiveMotions`.

   **The 状态与动作 note now names the pack** (`lib/config-page.js`, `renderMotions`): "其中 N 支随插件分发
   （assets/motions），不需要导入。" Without it, a tick list that already holds three clips reads as "somebody
   imported these", and a user trying to remove them through 动作导入 finds nothing to remove — that list only
   knows the directories THEY imported. Nothing is asserted about that sentence; `verify-desktop.mjs` covers the
   section's controls, which is why it stayed green either way.

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
| [lib/model-picker.js](lib/model-picker.js), [lib/picker-page.js](lib/picker-page.js), [lib/setup-page.html](lib/setup-page.html) — the shared model picker, its page and the guide's ② step | `node scripts/verify-desktop.mjs` **and** `node scripts/verify-browser.mjs --page client-test` (the guide walked, drop included) |
| a delivered chunk's name, or the loader registration | `node scripts/verify-browser.mjs --page chunk-delivery` |
| [vendor/](vendor/) — the pinned 3D stack | `node scripts/vendor-build.mjs --check` |
| the profile wiring, or "is the running app current?" | `node scripts/check-profile.mjs` |

Two habits that are not optional:

* **Regenerate the delivered chunks** after any edit to [lib/core.js](lib/core.js), [lib/scene.js](lib/scene.js) or
  [lib/menu.js](lib/menu.js): `node scripts/client-chunks.mjs`. They are committed copies, and a stale one is a
  SILENT failure — the browser half then disagrees with the host half. The cheap check is
  `node scripts/client-chunks.mjs --check` (under a second).
* **Report what actually ran**, e.g. "core: 1042 passed". Never "all green" from a partial run.

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
| [lib/picker-page.html](lib/picker-page.html), [lib/picker-page.js](lib/picker-page.js), [lib/model-picker.js](lib/model-picker.js) | 切换模型's page, and the ONE picker component it shares with the guide's ② 偏好模型 step |
| [lib/client.core.js](lib/client.core.js), [lib/client.scene.js](lib/client.scene.js), [lib/client.menu.js](lib/client.menu.js), [lib/client.vendor.js](lib/client.vendor.js) | the DELIVERED chunks — generated, committed, never hand-edited |
| [scripts/](scripts/) | the suites and the tools; [AGENTS.md](AGENTS.md) maps them |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the design in depth: why the split is where it is, the vendors, the traps |
| [docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md) | what a model/motion file must be, and the RETIRED MMD chapters |
| [assets/models/](assets/models/) | the TWO bundled models: `BlueFatFish.vrm` (蓝色小肥鱼Deepseek / 木子恶魔 — the default, redistributed with the author's permission) and `SampleModel.vrm` (ヴィータ / VRoid プロジェクト — the fallback, allowed by its own embedded licence); sources and terms in its README |
| [assets/motions/](assets/motions/) | the bundled `.vrma` pack, scanned as a bundled motion source; its `vrmpet3d-motions.json` declares each clip's 循环/单次 and the (currently empty) default state mapping |

## 7. Environment facts for THIS machine

* the DSH profile is `%USERPROFILE%\.dsh\profiles\desktop`, and the plugin is INSTALLED into it (§2). The running app
  is at `http://127.0.0.1:19387`, which is also where the floating window's page is served (`/vrmpet3d/window`) — the
  address `check-profile.mjs` and the live probes use;
* the operator's own VRMs live in `F:\SynologyDrive\FatFish-pet\Models` and are already imported (four models in the
  picker, §2). No motion directory is imported yet — the clips in `assets/motions/` are committed but not imported,
  so the picker does not offer them yet (§3 item 4);
* **the operator's motion pack lives in `assets/motions/`** (`coolIdleGlance.vrma`, `innocentStandIdle.vrma`,
  `idle.vrma` — the last one still UNTRACKED, plus the folder's README) — it ships with the plugin; see §3 item 4.
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
   the launcher's self-test NAVIGATES the window between them and merges the two readouts key by key. **A THIRD page
   of the same kind PICKS the model** (`/vrmpet3d/picker`, added 2026-10-13): its content is the guide's ② 偏好模型
   step, both mount the ONE component `lib/model-picker.js`, and either pet's menu opens it with the `picker` action.
   A switch shows a progress bar and LOCKS the picker until the model has arrived (operator, 2026-10-13:
   「增加一个切换进度条，防止用户快速反复切换导致故障」), and both pets re-read the catalog when the store names a model
   their held list cannot answer for — the fix for 「选中新导入的模型，都无法切换过去」 (`core.catalogMisses`).
   The bar ends on the pet's OWN live report (`reportLive(id, surface)`, one slot per surface, written after EVERY
   load) — not on the write, and not on the launcher's `--model-id`, which is why it used to outlive the model
   (「明明模型已经切换好了，为什么还走了这么长时间的进度条」). `settingsStore.setWindowModel` is gone with that fix.
   **The pages carry NO explanatory prose** (operator, 2026-10-13: 「删除掉所有设置面板中所有解释性的非正式UI的语言」):
   descriptions, notes, hints and example placeholders are gone from all four, and the 使用中 marker is a badge on the
   thumbnail rather than a line under it, so a tile in use is exactly as tall as one that is not. **The welcome step is
   the ONE exception and it is deliberate** — 「欢迎页的内容不要删，那些很重要」: its 早期版本/性能风险 paragraph and the
   warning stay, stylesheet rule included. And 完成 now CLOSES the window itself instead of revealing a 关闭窗口 button
   (「点击完成后直接退出」): the write lands first, then `closeWindow()`, and the button appears only when the browser
   refused (a tab that script did not open). **Before removing any
   text, check `ensureStatusElements()` in [lib/config-page.js](lib/config-page.js)**: an earlier prose sweep deleted
   eight elements the page WRITES to, the boot threw on the first `.textContent` of null, and the panel looked like it
   had lost every setting.
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
13. **A pose comparison must divide the quaternion lengths out.** THREE's `Quaternion.angleTo` does NOT normalise its
    operands, so two quaternions describing the SAME rotation but carrying a length of 0.9996 read as **4.59°** apart.
    That is how a real maths bug in `core.aimDownQuaternion` (it returned a raw cross product, whose length is
    `sin(angle)`, instead of the normalised axis) presented itself as a clip defect, and how a wrong diagnosis survived
    into three documents: the probe failed its two rest-pose checks on every clip that drove an **upper arm** — all the
    pack clips AND four all-humanoid test fixtures, none of which contains the `E_*` channel that was blamed.
    `scripts/verify-motion.mjs` now measures with `rotationBetween()`. Two habits follow: when a measurement says a pose
    is wrong, print the **dot product** next to the angle (byte-identical quaternions with `dot ≈ |q|²` are the tell),
    and before believing a defect is in the DATA, reproduce it with a fixture that lacks the suspect property — here
    `build/fixtures/vrma/vrmpet3d-test.vrma` (no upper-arm track) passed 61/61 the whole time.
14. **A checkbox with no `value` attribute is worth the string `'on'`.** That is not a curiosity: it is how the
    状态与动作 picker stored a clip id the operator saw as 「on（不在动作目录中）」, and how one more junk id per ticked
    clip pushed the last tick out of the per-state list until the last clip 「无法选中」. `onMotionToggle` in
    `lib/config-page.js` collected EVERY checked checkbox in the state's row — the 凝视 switch beside each tick box
    is one, and the discarded stale-id rows are two. It now collects `.picks label.pick input[type=checkbox]` only.
    Two habits follow: **when a collect step is shared with controls that are not the thing being collected, scope
    it by the label it owns**, and **never let a cap drop input silently** — `maxPerState` (16) was hit exactly by a
    16-clip library, and the drop was invisible, so it is 64 now and the panel SAYS so when it bites.
    `core.MOTION_LIMITS`, the stale-id rows, and the published `motions.stateIds` are the pieces. Regression
    coverage: `desktop/probe-motion-picker.js` (driven by `desktop/main.js`, asserted in `verify-desktop.mjs`, which
    ticks the last clip in the REAL page and checks no stored id is a non-clip).
15. **`assets/motions/` is the OPERATOR'S library, and `files: ["assets"]` means it SHIPS.** Its contents are data,
    not fixtures: this repository's suites must not assert a clip count or a clip name from it (group 5b asserts the
    shape — source, resolvable ids, and the pack's own manifest — and compares `describe().motionCount` against what
    the route just listed). As of 2026-10-12 it is **25 clips / ~2.5 MB in six per-state folders** (`idle/ working/
    attention/ success/ fail/ offline/`), and the folders ARE the state mapping: the manifest's `stateFolders` decides
    which clips each state's picker offers, so **moving a clip into another folder is how it is given to another
    state**. `verify-motion.mjs` is the tool that re-checks a clip; nothing runs it automatically. `idle/idle2.vrma`
    and `idle/idle3.vrma` are byte-identical, so one state lists two names for one animation.
16. **A manifest key is a PATH RELATIVE TO ITS OWN FOLDER, and a wrong key is silent.** `clips` and `defaults` in
    `assets/motions/vrmpet3d-motions.json` are keyed by the same relative name the catalogue reports — `idle/x.vrma`,
    not `x.vrma`. When the pack was reorganised into per-state folders, the three committed keys stopped matching
    anything, and because every clip's `loop` was `true` (the default) nothing LOOKED broken: a `loop: false` there
    would simply have been ignored — the "declared one-shot that loops anyway" defect the flag exists to prevent.
    **Re-check the keys after any reshuffle** (`git status` showing a `.vrma` as `D` beside an untracked folder is the
    tell), and note `verify-motion.mjs` never reads the manifest, so it cannot catch this.

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

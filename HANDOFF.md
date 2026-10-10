# HANDOFF.md — resuming work on dsh-plugin-pet3d

Last updated: 2026-10-12 (**the forty-first pass is FINISHED — see the FIRST entry below; ▶NEXT UP at the top holds the ONE item the operator left**)

Read this file to pick the project up on another machine. It is written so that
nothing needs to be remembered or explained verbally.

> **⛔ 冻结区（操作者指令，2026-10-12）：「重力、移动时的物理反馈这部分完结，轻易不要动了。」** 拖动 / 抛掷 /
> 下坠 / 落地喂给模型的那条通道（`setDragMotion` 及其两个调用点）与 `applyDragLag` 的调校常数**不要顺手改**；
> 细则和硬约束见 `AGENTS.md` 的「冻结区」一节。
>
> **The tree is green: 10 suites, 1925 checks** — `check-docs.mjs` re-derives every one of them from the real
> suites, so its own verdict is the statement (see the bottom of this file).
>
> **▶NEXT UP (operator, 2026-10-12, end of session — 「收手，准备下班」. ONE item is left, in the operator's own words,
> written down so the session that picks this up does not have to guess at it. `## 5. Immediate next steps` has the
> long form.)**
>
> 1. **「继续修复状态显示」** — no reproduction was given, so the first step is to ASK (which surface, which state, what
>    it shows, what it should): the status line is drawn by BOTH halves and the suites already pin its texts, tones,
>    clock, mask and both rectangles, so a blind change breaks a pinned behaviour more easily than it fixes a report.
>    The three soft spots this line has failed at before are listed in §5.
>
> **✅ AND THE OTHER ITEM IS DONE — 「如果设置了AI碎碎念，就停止输出内置的碎碎念」 (forty-first pass).** The shipped per-part
> 碎碎念 now obeys the same source switch the state lines do: with 台词来源 on AI or 自定义 a press on 胸部 says the user's
> own line (or, under AI, nothing while the model writes it) instead of 变态！. The shipped part PROMPT is deliberately
> NOT switched — it is the instruction sent to the model, so switching it off would delete the operator's own 傲娇
> instruction for exactly the mode it exists for.
>
> **▶START HERE (2026-10-12, forty-first pass):** the newest entry gives the shipped part lines the `tableAllowed`
> argument the state lines already had — one function, passed by BOTH press paths (`SpeechMachine.react` and the
> window's `reactToPart`), with the user's own box untouched in every source. **A finding worth keeping: the trap §5
> predicted — "the source `change` handler does not repaint the 部位 table" — cannot happen, because 部位 and 台词来源 are on
> different PAGES (模型参数 / 通用设置), so the model page can never see that picker move. What carries a source change to
> the table is the `storage` path that was already there, and the new desktop check drives THAT.**

>
> **▶START HERE (2026-10-12, fortieth pass):** the newest entry adds the five 部位 rows the operator asked for
> (大腿/小腿/脚/胸部/屁股) with their match words in the name table, the two ordering traps that table has (a thigh
> would answer as a 小腿 if `leg` were tested first), 胸部/屁股 answering a press from the SHIPPED table while their
> boxes stay empty, and the ONE-TIME seeding that gets those rows onto a profile whose stored part list predates
> them. **A stored part list is authoritative — the seeding is what a new shipped row needs, and the same rule keeps
> a deleted row deleted.**
>
> **▶The entry below it (thirty-ninth pass):** the entry below is 试一句's refusal — 「还没有选择 DSH 的 provider
> 和模型」 while both pickers read as configured. The cause is a property of `<select>` worth remembering: **a select
> whose options do not match its value still DISPLAYS its first option**, so choosing a provider cleared `dshModel`
> and the refilled model list showed a model nothing had written. The page now ADOPTS the option it is already
> showing (one-shot, catalog-driven, through the data-loss latch), the host's refusal names WHICH field is missing,
> and the answer is printed in 试一句's own row instead of above the whole AI block.
>
> **▶The entry below it (thirty-eighth pass):** the thirty-eighth pass removes the floating window's 切换回窗口内 row —
> it was the same action as its own 关闭独立宠物. A surface can now omit that row (`showSurface: false`); the app's
> pet keeps 切换回窗口外 because it is the only way out of DSH. **Note the shape: the entry stays in the shared list
> (order is one definition) and only its PRESENCE is per surface.**
>
> **▶The entry below it (thirty-seventh pass):** the newest entry closes the same flight-feedback gap on the
> FLOATING window (「一起补上」), and adds `stepFrame` to the page's API so a probe can advance the simulation
> deterministically instead of waiting on rAF frames. Both surfaces now feed the same physics for drag, fall and
> landing — **if a third difference between them ever appears, diff what each one FEEDS the model first.**
>
> **▶The entry below it (thirty-sixth pass):** the newest entry gives the in-app pet physics feedback while it
> FALLS or is thrown — the flight was being fed to the model as zero, so the hair hung rigid on the way down. Note
> the shape of this pair of passes: the drag, the fall and the landing are all "the pet is moving while its world
> position inside the canvas does not change", and the ONLY correct answer is to feed the motion in through
> `setDragMotion`. If a third such case appears, look there first.
>
> **▶The entry below it (thirty-fifth pass):** the newest entry makes the in-app pet's hair blow while it is
> dragged, the way the floating window's already did. The cause was one line: the window pushed the cursor's draught
> into the springs with no gesture condition, the app pet had `!dragging && !viewDrag` on the same call, so the same
> gesture fed two different physics. **When two surfaces look different, diff what each one FEEDS the model** — the
> existing `dragMotion` check only proved the body lagged, which is why this survived every run.
>
> **▶The entry below it (thirty-fourth pass):** the floating pet's rotation works, and the reason the two
> passes before it did not is worth reading: the window **never captured the pointer** (the in-app pet always did)
> and the launcher made it **click-through in the middle of the drag**, so the view stopped the moment the mouse left
> the pet. The pointer lock the operator asked for is attempted but is NOT the mechanism — Windows refuses to focus
> this deliberately unfocusable window (`{"locked":false,"hasFocus":false}` on their machine), so the suite now
> asserts the BEHAVIOUR with real mouse events instead: right-drag turns the view while the pointer travels away, and
> releasing stops it.
>
> **▶The entry below it (thirty-third pass):** the pointer lock, requested by the launcher The pass before it asked the launcher for focus and then had the PAGE request the lock — which
> Chromium refuses, because by then the request has crossed an IPC boundary; the self-test had "proved" it with a
> `userGesture` flag only the main process can pass. The launcher now owns both halves (focus, then request with
> that flag; release, then give focus back), the self-test drives the page's own bridge, and the suite asserts
> `locked === true`. **A harness that supplies a precondition the product cannot is not testing the product.**
>
> **▶The entry below it (thirty-second pass):** the floating pet's pointer lock (「独立桌宠的旋转功能一直都异常，从来没能把鼠标真正锁住过」) — the page had no lock code at all,
> and that window is only pet-sized so a right-drag left it immediately. It is a four-link chain through the
> launcher, because Chromium refuses a lock to an unfocusable document — measured in the live window, and now
> asserted there.
>
> **▶The entry below it (thirty-first pass):** the right button FOR REAL. The menu
> never opened because the POINTER LOCK was requested on the press: the cursor was captured and hidden (the
> operator's own words: 「有点像3D游戏中锁定光标」), the capture fed the orbit its `movementX` deltas, and the press
> became a drag whose menu event was swallowed. The lock is now requested only when the press actually BECOMES an
> orbit, and the menu is decided by the RELEASE — the design the floating window already used, which is why its
> right-click always worked. **The probe assertion that should have caught it instead ENCODED it**
> (`lockCalls === 1` right after `pointerdown`); it is now `lockOnPress === 0`.
>
> **▶The two entries below it (thirtieth then twenty-ninth):** 右键无效 was chased in two halves — the 4 px
> Manhattan drag threshold (a wobbling hand counted as a drag) and an unguarded `setChecked` on an older delivered
> menu chunk. Both are real and both are fixed; neither alone was the whole story, which is what the thirtieth
> entry's closing line already warned about.
>
> **▶The entry below it (twenty-ninth pass):** the menus were cut down and given a switch. 重启/退出
> DeepSeek Harness are GONE from both pets (and so are the route, the host module and both failure lines); the
> app pet's menu moved from double-click to the right button; 关闭宠物 became 隐藏宠物 inside the app (with the
> 显示宠物 button in DSH's corner) and 关闭独立宠物 in the window (which hands the pet back inside); and both
> pets gained a 重力 switch whose two states are INDEPENDENT. Read that entry for the two defects found on the
> way: the window's page never heard a menu close it did not initiate, and the app pet's 显示桌宠/显示宠物
> wording was asserted in the wrong language until the probe read it from the sources that own it.
>
> **Still NOT done: nothing in the last three passes has been exercised against a running DSH.**

> # ✅ 2026-10-12 (forty-first pass) — AI 碎碎念 stops the BUILT-IN part lines too: 胸部 answers 变态！ only while 台词来源 is 内置短语
>
> **The ask (operator, 2026-10-12, verbatim from the fortieth pass's handoff):** 「如果设置了AI碎碎念，就停止输出内置的碎碎念」.
> The state lines had obeyed it since the nineteenth pass (`pickSpeechLine`'s `tableAllowed` is `speech.source === 'builtin'`,
> decided in ONE place in `SpeechMachine.observe`). What did not was the SHIPPED per-part 碎碎念 the fortieth pass had just
> shipped: `core.partSpeechLines(item)` was source-blind, so with 台词来源 = AI 生成 a press on 胸部 still said 变态！ while the
> model was asked to write the line — and the fortieth pass's own test asserted that as if it were correct.
>
> **The fix is ONE argument through ONE function.** `partSpeechLines(item, tableAllowed)` now takes the same switch
> `pickSpeechLine` takes (`tableAllowed === false` → no shipped lines; the user's own box is checked FIRST and is unaffected
> in every source), and both press paths pass the same expression: `SpeechMachine.react` (core) and the window's
> `reactToPart` (`lib/desktop-page.js`, still guarded on the function so an older delivered chunk loses the argument and not
> the pet's voice). The chain is unchanged otherwise: the part's own box → the shipped lines for its region → the state's
> own box → silence, and under AI the model is still asked about the part, so the press is silence while it writes rather
> than a lost reaction.
>
> **The shipped part PROMPT is deliberately NOT in this rule**, and the fortieth pass's warning about that is what it was
> for: `partSpeechPrompt` is the instruction sent to the MODEL (`被主人摸到胸部了，必须…`), not a line the pet says. Switching
> it off with AI mode would delete the operator's own 傲娇 instruction in exactly the mode it exists for. Only the LINES
> follow the source.
>
> **Where the settings page promised it, the promise now follows the source too.** 胸部's box ships empty with
> 「碎碎念：留空则说内置的 变态！ / 大色狼！」 under it; with a source that is not 内置短语 it says
> 「碎碎念：一行一句；留空则由 AI 按这个部位的提示词生成」 instead. `parts.builtinSpeech` gained `speaking`: the entry's `lines`
> are the TABLE's content (still readable while switched off) and `speaking` says whether the pet would say them NOW — published
> because "this row has a built-in voice" and "the pet would say it" stopped being the same claim.
>
> **A FINDING THAT CORRECTS §5 OF THIS FILE: the trap it predicted cannot happen.** §5 said the source `change` handler
> does not repaint the 部位 table, so a source-dependent placeholder would keep lying until something else repainted. It
> does not, and the reason is the two-PAGE split of 2026-10-11: the 部位 table is on 模型参数 (`#part-body`) while the 台词来源
> picker is on 通用设置, so **`renderParts()` on the global page returns before doing anything** — there is no part table in
> that document to go stale, and a page loaded later draws the placeholder from the stored source in the first place. What
> carries a source change to that table is the `storage` listener that was already there (another document writing the
> store). So NO repaint was added to the picker's handler — a call that can never fire would be worse than none — and the new
> desktop check drives the STORAGE path instead: it writes the store with `source: 'ai'`, dispatches the event, reads 胸部's
> placeholder off the DOM, and puts the store back. The comment at the handler says all of this.
>
> **Counts moved:** 1918 → 1925 (core 998 → **1002**, desktop 239 → **242**; browser/client-test stayed **90** — the window's
> own press path gained the same fact as one more sub-check inside its existing window check, and chunk-delivery 39,
> browser 13, mmd 13, host+model 524 are untouched). **Verified:** `verify.mjs` → `core: 1002 checks passed`;
> `verify-desktop.mjs` → `desktop: 242 checks passed` (the live Electron self-test included);
> `verify-browser.mjs --page client-test` → `browser: 90 checks passed`, with
> `shippedPressAi: {"text":"宿主的一句话","hidden":false,"sayCalls":1,"state":{"region":"butt",…},"published":"宿主的一句话"}`
> — a real press on the fixture's `hips` under source `ai`, with the app's published line still up (so the shipped 变态！ was
> NOT said) and exactly one `/pet3d/say` request (so silence is the wait, not a dead reaction); `check-plugin-load.mjs` →
> `plugin load preflight: PASSED` (it gained a static assertion that all three readers of the shipped part lines pass the
> same source argument); `client-chunks.mjs` regenerated `lib/client.core.js` (a chunk edit) and `--check` is clean;
> `check-docs.mjs` → `docs: 211 checks passed` with every documented count recomputed from the suites.
>
> **What was REMOVED, and why that is the honest direction:** the fortieth pass's assertion
> 「in AI mode the shipped line is what the pet says while the model thinks」 is FLIPPED rather than deleted — it now requires
> `null` plus the request standing beside it — and the sibling that used to run on the `custom` source was moved to `builtin`
> (where the shipped lines belong) with a new `custom` sibling asserting the press falls through to the state's own box.
> `build/probe/client-test.js`'s `shippedPressOk` still runs on the shipped `builtin` source, as §5 said it would.
>
> **One flake seen and worth knowing about:** the first `check-docs.mjs` run of this pass reported the client suite's count as
> `null` — the browser run produced no report at all that time, which prints its reason on stderr and is swallowed by
> `check-docs`'s `countFrom`. A retry was green (`docs: 211 checks passed`), and the page itself passed 3/3 when run alone,
> so it is a browser-launch flake rather than a wrong assertion — the new AI sub-check adds ~3.1 s of TIMER waits to the
> heaviest browser page (the press gap, which is real and not faked), and this tree lives on a synced folder that has already
> produced two `ReplaceFileW EIO` errors on writes during this pass. Nothing was changed to paper over it; if it recurs, that
> is where to look.


> # ✅ 2026-10-12 (fortieth pass) — five more 部位: 大腿/小腿/脚/胸部/屁股, their match words, and the voice 胸部 and 屁股 answer with
>
> **The ask (operator, verbatim):** 「模型设置中的部位：增加"大腿"的部位（默认匹配upper leg,upperleg,thigh,datui等可能的词汇）（匹配词写进系统底层，不显示）
> 增加"小腿"的部位（默认匹配lower leg,lowerleg,leg,xiaotui等可能的词汇）（…）(注意，这里有leg的存在，一定优先匹配完upper leg/upperleg之类大腿部位，
> 才能把剩下的匹配到leg) 增加"脚"的部位（默认匹配foot,feet,ashi,jiao等可能的词汇）(…) 增加"胸部"的部位（默认匹配chest,bust,breast,xiong,rufang
> 等可能的词汇）默认碎碎念："变态！""大色狼！"，默认AI提示词"被主人摸到胸部了，必须要傲娇的回骂这个摸人家胸的变态主人才行。"（匹配词和AI提示词写进系统底层，
> AI提示词那里默认留空，跟未输入状态一样，如果输入了，则以输入的为准）增加"屁股"的部位（默认匹配butt,pussy,ass,pigu,pantsu,neiku等可能的词汇）
> 默认碎碎念："变态！""大色狼！"，默认AI提示词"被主人摸到屁股了，必须要傲娇的回骂这个摸人家屁股的变态主人才行。"（…）以上内容全部放在"身体"的后面，
> "尾巴"的前面。」
>
> **Five rows, in the order asked for.** `STRUCTURE_REGIONS` is now `['eye','head','hand','body','upperLeg','lowerLeg','foot','chest','butt','tail']`
> — the row order the settings page draws AND the region vocabulary the stored rows use — with the labels 大腿/小腿/脚/胸部/屁股.
>
> **The match words live in `STRUCTURE_PATTERNS`, never in the user's settings**, which is what 「写进系统底层，不显示」 means: the
> 部位 table's structure chips stay EMPTY for these rows, and the heuristic places a name (the operator's own words, plus
> the Chinese names and the standard rig synonyms: `J_Bip_L_UpperLeg`, `bust`, `Hips`, `pantsu`…). **Three ordering traps, and
> the operator named the first one themselves:** the lower leg's word is `leg`, which is INSIDE `upperLeg`/`upperleg`, so the
> thigh is tested first (「一定优先匹配完 upper leg/upperleg 之类大腿部位，才能把剩下的匹配到leg」); `foot` closes over
> `ankle`/`toe`; and `tail` sits ABOVE 屁股 because `尻尾` is a tail while a bare `尻` is a bottom. 足 alone is deliberately NOT
> matched: in an MMD skeleton 足 is the THIGH bone while 足首 is the ankle, and a substring table cannot have both — a name
> it does not know is what a user part is for.
>
> **胸部 and 屁股 have a VOICE that is not stored in anyone's settings.** `DEFAULT_PART_LINES` and `DEFAULT_PART_PROMPTS`
> (per REGION, so a renamed row answers the same) are read by `core.partSpeechLines` / `core.partSpeechPrompt`, and the boxes
> ship EMPTY — 「AI提示词那里默认留空，跟未输入状态一样，如果输入了，则以输入的为准」. The part's own box always wins; a part with
> neither box and no table entry still answers nothing. The press chain is now: the part's own lines → the SHIPPED lines for
> its region → the state's own box → silence (the shipped STATE table is still not in it). **Both press paths read the one
> function** (`SpeechMachine.react` and the floating window's `reactToPart`), because two copies of this rule is how the two
> surfaces have drifted every time before. The host resolves the AI instruction: the user's prompt → the SHIPPED prompt → the
> structure → the chain → the state.
>
> **The row that was the hard part is not the row at all: a stored parts list is authoritative.** `cleanParts` has always
> refused to resurrect a row the user deleted, so a NEW shipped row would have reached brand-new profiles only — and the
> operator's own store holds the five old rows. `parts.seeded` (a list of the regions this profile has already been OFFERED)
> is the fix: a region missing from it is inserted in shipped order — in front of the first stored row whose region comes
> later, which is what puts the five between 身体 and 尾巴 while never moving a row the user wrote — and only once. A profile
> written before that field existed is read as "everything it holds, plus the five regions the table had then", so a row the
> user DELETED is in neither place and does not come back. An empty list stays empty, and `seeded` rides with every edit so a
> later write cannot re-offer anything.
>
> **What the settings page shows:** every box EMPTY on a fresh profile (`withLines: 0`, `withPrompt: 0`), and the two rows
> whose voice comes from the table are published as `parts.builtinSpeech` with `boxEmpty: true` — so "the defaults exist" and
> "the user wrote them" cannot be confused. The placeholders name the built-in lines and prompt, which is the page's answer
> to 「跟未输入状态一样」 without pretending the user typed them.
>
> **Counts moved:** 1867 → 1918 (core 955 → 998, host 519 → 524, desktop 236 → 239; browser/client-test stayed 90 — its
> window check gained the same fact through a real raycast without a new check). **Verified:** `verify.mjs` → 998;
> `verify-model.mjs` → 524; `verify-desktop.mjs` → 239 (live Electron self-test); `verify-browser.mjs --page client-test` →
> 90, with `shippedPress: {"text":"变态！", "state":{"part":"butt","region":"butt","bone":"hips"}}` — the fixture's hips bone
> answered by the shipped 屁股 row, through a live raycast on a real VRM; `client-chunks.mjs` regenerated `lib/client.core.js`
> (a chunk edit) and `--check` is clean. `verify-all.mjs` was NOT run.
>
> **One thing this pass found by running rather than reading:** the window probe's own press used to be silent on the fixture's
> centre, because `hips` matched nothing; it now answers 变态！, which opened the local press GAP and swallowed the NEXT press —
> a check that had quietly depended on the previous press saying nothing. The probe now waits the gap out (`reactGapSeconds`,
> read from core) and asserts the shipped line as well, which is more than it proved before.

> # ✅ 2026-10-12 (thirty-ninth pass) — 试一句 said 「还没有选择 DSH 的 provider 和模型」, and the model picker was LYING
>
> **The report:** 「模型的碎碎念设置中，即便配置了DeepSeek Account，点击试一句那里的生成，仍然会报错'失败：还没有选择 DSH 的
> provider 和模型'，而且报错的提示位置和'生成'按钮太远，不仔细找都找不到。」
>
> **Reproduced against the running app BEFORE touching anything, and the three readings are the proof.** `GET
> /pet3d/llm` answered two providers (`deepseek-official` = DeepSeek, `deepseek-account` = DeepSeek Account);
> `?provider=deepseek-account` answered two models (`deepseek-flash`, `deepseek-v4-pro`); the operator's store held
> `'dshProvider': 'deepseek-account', 'dshModel': ''`; and `POST /pet3d/say {state: working}` answered
> `{text: null, error: '还没有选择 DSH 的 provider 和模型', ms: 0}`. So the provider WAS configured, the MODEL was
> empty, and the window's picker was displaying 「DeepSeek-V41-Flash」.
>
> **The cause is one property of `<select>`, and it is the thing to remember: a select whose options do not match
> its value still DISPLAYS its first option.** Choosing a provider clears `dshModel` on purpose (a model belongs to
> a provider) and then refills the model list from the catalog — and nothing ever writes the model that the
> refilled list is showing. The pair therefore LOOKED complete on screen and was empty in the store, and the HOST
> (which is who 试一句 asks) refused. The provider picker had the same shape on a fresh profile: the catalog's first
> provider was displayed while `dshProvider` was `''`.
>
> **The fix makes the display and the store agree, in the one place the catalog answers** — `adoptCatalogChoice` in
> `lib/config-page.js`, called from `loadLlm`. What is adopted is the option the picker is ALREADY showing, so
> nothing on screen moves and only the store catches up. Three bounds, each with a reason: it is ONE-SHOT per
> catalog answer (a host that answers a patch with a snapshot that does not carry it would otherwise be adopted
> into and reverted out of for ever); it only fills a field the store has NO answer for; and an answer that arrived
> before the first snapshot is HELD and applied by `adoptSnapshot` — the page's data-loss latch, which is also why
> the write waits for it. A model list settles a model only when the answer named the provider the picker shows
> (`?provider=`), and a provider an answer adopted but did not cover is asked about ONCE (`askedLlmProvider` is what
> stops that being a loop). The model picker is also emptied when the provider changes, so a stale list can no
> longer be displayed as a choice.
>
> **The second half of the report — the answer was too far from the button.** `#pref-speech-test-result` was a `<p>`
> above the whole AI block, several rows from 生成; it is a SIBLING of the button now, on a line of its own
> (`flex: 1 1 100%` in `lib/pages.css`) and gold (`warn`) while it is a refusal. The button is held while a line is
> in flight, because the host's own 「已经有一句在生成中了」 would otherwise land on top of the answer the user is
> waiting for.
>
> **And the host's refusal now names WHICH of the two is missing** (`还没有选择 DSH 的 provider` / `还没有选择 DSH 的模型`,
> `lib/index.js`). One message for two fields is what made this report unanswerable from the screen: naming the
> model points at the picker that was lying.
>
> **Counts moved:** 1858 → 1867 (host 514 → 519, desktop 232 → 236). **What was run, per `AGENTS.md`:**
> `verify-model.mjs` → `host + model: 519 checks passed`; `verify-desktop.mjs` → `desktop: 236 checks passed` (the
> live Electron self-test included); `client-chunks.mjs --check` clean (no chunk was edited); `check-docs.mjs` for
> the count change. `verify-all.mjs` was NOT run.
>
> **The assertion that IS the fix:** the desktop suite's stub now serves `/pet3d/llm` (two providers, two models for
> the one asked about) and opens the settings window on a store with NO pair at all. It asserts that the page ends
> up holding `fake-official / fake-1` — the option its own picker shows — that the model in the store is one the
> picker offers, that the pair was POSTed to `/pet3d/settings` (the page's own copy is NOT what 试一句 reads), and
> that 试一句's answer shares the row with 生成 (`speech.testResultSameRow`). In `verify-model.mjs` the two refusals
> are asserted by name, with no call reaching the LLM service in either case.
>
> **Unproven on screen:** the host half needs a **DSH restart** (`lib/index.js`). The page half does not — both
> settings pages are served `no-store` on every open — so on the operator's own store (`dshProvider:
> deepseek-account`, `dshModel: ''`) reopening 通用设置 → 碎碎念 should show the model adopted and written, and 生成
> should answer with a line instead of that refusal.

> # ✅ 2026-10-12 (thirty-eighth pass) — 移除外置窗的 切换回窗口内: it was the same action as 关闭独立宠物
>
> **The ask:** 「外置桌宠的'切换回窗口内'选项现在和'关闭独立宠物'功能重复了，移除'切换回窗口内'选项」 — which closes a
> duplication the twenty-ninth pass had flagged and offered to remove.
>
> **The removal is per SURFACE, not per entry.** `surface` is still in `MENU_ITEMS`, because the app's pet needs it:
> 切换回窗口外 is the only way out of DSH. What changed is that a surface can now say it does not offer the row —
> `createMenu({ showSurface: false })`, honoured in `render()` — and only the floating window passes it. That keeps
> the order and the id one definition while letting the row's PRESENCE differ, which is the honest shape of the
> thing: the window has nowhere to hand the pet that its 关闭独立宠物 does not already do.
>
> **Both ends are asserted, because "removed" and "lost" look identical from the outside.** The browser probe
> asserts the ABSENCE on the window (`noSwitchRow`: no `surface` item AND no row whose words are 切换回窗口内, so it
> cannot come back under another id) and the app's own check still requires its 切换回窗口外; `check-plugin-load.mjs`
> asserts `showSurface: false` in the window page AND that the module is what honours it, so a page that hand-rolled
> its own row list would fail. Verified by breaking it: deleting the module's filter line fails BOTH layers.
>
> **Two deliberate leftovers, both documented in place:** `surfaceApp` (切换回窗口内) now has no caller — kept,
> because the row is defined per DIRECTION and deleting a direction turns `toSurface` into a constant, which reads
> as a bug rather than a decision. And the window's `onMenuChoice` keeps its `if (id === 'surface')` branch: the menu
> module is delivered separately, so a page can find itself with an older `client.menu.js` that still draws that row,
> and a menu entry that then did nothing would be far harder to diagnose than one that is simply not shown. (Same
> precedent as the 重启/退出 branches kept in the thirty-third pass.)
>
> **Counts unchanged** — browser (client-test) 90, core 955, host+model 514, chunk-delivery 39, browser 13, mmd 13,
> desktop 232; total **1858**. The change replaced what an existing assertion checks, not how many there are.
> **Verified:** `verify-browser.mjs --page client-test` → 90 passed with
> `sharedMenu: {… "ids":["resetView","resetSize","globalSettings","modelSettings","gravity","closePet"],
> "noSwitchRow":true, "closeLabel":"关闭独立宠物" …}`; `verify-desktop.mjs` → 232 passed; `check-plugin-load.mjs`
> PASSED (and FAILED as expected with the filter removed); `client-chunks.mjs --check` clean after regenerating
> `lib/client.menu.js` (a chunk edit).

> # ✅ 2026-10-12 (thirty-seventh pass) — 外置窗补上下坠物理: the same gap, closed on both surfaces
>
> **The ask:** 「一起补上」 — after the thirty-sixth pass fixed the in-app pet's flight feedback, the floating window
> had the identical gap, so it got the identical three lines.
>
> **What was added:** `reportFallMotion()` in `lib/desktop-page.js`, called from the page's frame body right after
> `placement.stepFall` — the SAME conversion as `lib/client.js`'s copy (frame fractions → CSS px/s, and `fall.vy` is
> positive UPWARD while `setDragMotion` takes screen coordinates). Both copies carry a comment saying the two must not
> drift, which is the whole reason this pass exists: for two days every one of these defects has been the two
> surfaces being fed DIFFERENT physics for the same gesture.
>
> **One structural addition, and it is what makes the window's version testable at all:** the frame loop's body was
> extracted into `advance(dt)` and exposed as **`stepFrame`** on the mount's returned API. The page's own loop is
> rAF-driven, and a browser probe cannot wait for real frames — this repository has already hung a suite once doing
> exactly that ("awaiting a run of them starved the page's two rAF loops of their virtual-time budget"). Exposed for
> the same reason `publish()`, `scan()` and `hitTest()` are: so the test drives the product's own path instead of a
> second one. Production still calls it from exactly one place.
>
> **The assertion** mirrors the in-app pet's: `windowGravity` is switched ON through the mount's own store (that
> window ships with gravity off, which is why the gap was dormant), the pet is thrown through the real listeners,
> and the flight is stepped deterministically while `setDragMotion` is spied on — requiring an upward sample while
> rising, a downward one after the apex, a sideways one from the throw, and a final `(0, 0)` on the landing frame.
> Measured: `windowFallMotion: {"thrown":true,"frames":54,"samples":58,"rising":23,"falling":26,"sideways":53,
> "last":{"vx":0,"vy":0,"airborne":false}}`. Verified by breaking it: removing the call gives
> `samples:4, rising:0, falling:0, sideways:0` and the check fails.
>
> **A probe mistake worth recording, because it is the third of its kind:** the first version threw the pet to the
> RIGHT, and the window parks at the bottom-right corner where `placement.maxX()` is already reached — so the
> horizontal drag was clamped away, `moveDrag` recorded a horizontal velocity of zero, and the check failed with
> `sideways: 0` while everything else passed. The throw goes up-LEFT now. **A probe that fails because of where it
> started is measuring its own setup.**
>
> **Counts:** browser (client-test) 89 → **90**; core 955, host+model 514, chunk-delivery 39, browser 13, mmd 13,
> desktop 232 unchanged. **Project total 1857 → 1858.** **Verified:** `verify-browser.mjs --page client-test` → 90
> passed with the readout above; `verify-desktop.mjs` → 232 passed; `check-plugin-load.mjs` PASSED;
> `client-chunks.mjs --check` clean (both files are served, not chunked).

> # ✅ 2026-10-12 (thirty-sixth pass) — 下坠与抛掷时没有物理反馈: the flight was fed to the model as ZERO
>
> **The report:** 「修重力下坠和抛掷时的物理反馈，先修内置桌宠。」 — and the cause was the exact twin of the
> thirty-fifth pass. The drag feeds `setDragMotion`; the FALL fed nothing, and worse, the release path writes
> `setDragMotion(0, 0)` on the way out (`onPointerUp` / `cancelGesture`). So for the whole flight the model was told
> "the pet is standing perfectly still" — which is literally true from inside the canvas, because what moves is the
> SLOT the pet lives in — and the hair hung rigid while the pet flew.
>
> **The fix is one call per airborne frame:** `Pet3DWidget.prototype.reportFallMotion` converts the fall's velocity
> and feeds the same channel the drag uses. Not a second mechanism: one number ("how fast, and which way") drives
> both the body lag and the lean the chains answer. Two unit conversions are load-bearing and both are in the
> comment — viewport FRACTIONS/s → screen PIXELS/s, and `fall.vy` is positive UPWARD (`core.stepFall` does
> `vy -= gravity`) while `setDragMotion` takes screen coordinates where y grows DOWNWARD. Getting that sign wrong
> is invisible in a symmetric drop and very visible on a bounce.
>
> **The landing comes free, and that is why nothing extra was added.** On the frame it lands `placement.fall` is
> already null, so the same call writes zero and the trailing offset converges back through `DRAG_LAG_TAU` — the
> settle IS the landing. That also settles an old piece of debris: `stepFall` computed
> `var impact = Math.abs(before);` on the landing frame and **never used it**, which reads as "a landing impulse
> already exists". It does not; it is deleted, with a note saying what a real landing kick would have to do
> (publish the speed, let the scene express it).
>
> **What is asserted** (new check, `verify-browser.mjs --page client-test`): a real throw through the real
> listeners, then the flight is stepped frame by frame while `setDragMotion` is spied on, requiring
> (a) an UPWARD sample while rising, (b) a DOWNWARD one after the apex — the whip that only exists if the sign is
> right — (c) a sideways sample from the horizontal throw, (d) the magnitudes are hundreds of px/s, which is what
> catches a fractions-for-pixels mistake that would otherwise be silent, and (e) a final `(0, 0)` sample on the
> frame it landed. Measured: `fallMotion: {"thrown":true,"frames":44,"samples":49,"rising":14,"falling":25,
> "sideways":12,"apexFlips":true,"last":{"vx":0,"vy":0,"airborne":false}}`. Verified by breaking it: removing the
> call gives `rising:0, falling:0, sideways:0` and the check fails.
>
> **Counts:** browser (client-test) 88 → **89**; core 955, host+model 514, chunk-delivery 39, browser 13, mmd 13,
> desktop 232 unchanged. **Project total 1856 → 1857.** **Verified:** `verify-browser.mjs --page client-test` → 89
> passed with the readout above; `verify-desktop.mjs` → 232 passed; `check-plugin-load.mjs` PASSED;
> `client-chunks.mjs --check` clean (`lib/client.js` is served, not chunked).
>
> **Not done on purpose:** the floating window has the same gap, and the operator asked for the in-app pet first
> (「先修内置桌宠」). That window only falls when its own 重力 switch is on, so the gap is dormant by default — but it
> is the same three lines, and it is the obvious next step.

> # ✅ 2026-10-12 (thirty-fifth pass) — 内置宠物拖动时头发不飘: the two surfaces were fed different physics for the same gesture
>
> **The report:** 「内置宠物移动时的模型物理，外置宠物移动时头发会飘动，内置没有，修一下。」
>
> **The cause was a one-line asymmetry between the two surfaces, and both halves were deliberate.** The floating
> window pushes the cursor's DRAUGHT into the spring chains from its cursor stream (`onCursor` in
> `lib/desktop-page.js`) with no gesture condition at all — a sweep blows the hair, and a drag blows it too, because
> the window is carried by the cursor. The in-app pet had the same `pushWind` call behind
> `&& !this.placement.dragging && !this.viewDrag`, added with the note that a drag "already has its own effect on
> the hair (`setDragMotion`, which knows how fast the pet is moving)". That note was only half true: `setDragMotion`
> puts in the body LAG (and a lean), and the draught is a separate force. So while dragging, the window's hair was
> excited by both and the app pet's by one — which reads exactly as 「外置会飘，内置没有」.
>
> **The fix:** the exclusion is gone, so a sweep blows the hair, a drag blows it AND lags the body, and the two
> surfaces are fed the same physics for the same gesture. Nothing about the earlier 划过 feature changed — the wind
> is still only fed while the cursor is over the pet's own box, with the same 200 ms guard.
>
> **The assertion, and why the previous one could not see it:** `verify-browser.mjs --page client-test` already had a
> `dragMotion` check proving the body lags — which is why the difference survived every run. The new check
> (`dragging the app pet blows its hair, exactly as the floating window does`) spies on `scene.pushWind` through the
> real listeners and requires samples to arrive **while `placement.dragging` is true**, with the drag's own
> direction; it also re-asserts that a plain sweep still blows the hair, so the fix cannot become "wind always on".
> Verified by breaking it: putting the exclusion back makes it fail (`duringDrag: 0`) while `swept` stays true —
> which is precisely the reported asymmetry.
>
> **Two measurement mistakes of mine, both in that new check** (and both the same species as the last two passes):
> the probe dispatched three `pointermove`s inside one tick, so `Date.now()` did not advance, `dt === 0`, and the
> widget correctly ignored them — the check failed on HOW IT MEASURED, not on the product. It is an `asyncCheck` now,
> waiting a real timer between moves, which is what a real mouse produces. And it restored the spy before counting
> the sweep samples, so `swept` was permanently false.
>
> **Counts:** browser (client-test) 87 → **88**; core 955, host+model 514, chunk-delivery 39, browser 13, mmd 13,
> desktop 232 unchanged. **Project total 1855 → 1856.** **Verified:** `verify-browser.mjs --page client-test` →
> `browser: 88 checks passed` with `dragWind: {"samples":5,"duringDrag":3,"firstDx":14,"firstDy":9,"swept":true}`;
> `verify-desktop.mjs` → 232 passed; `check-plugin-load.mjs` PASSED; `client-chunks.mjs --check` clean
> (`lib/client.js` is served, not chunked).

> # ✅ 2026-10-12 (thirty-fourth pass) — 抓住指针: the window never captured it, and the launcher made it click-through mid-drag
>
> **The report:** 「并没有成功，光标没有被锁住」, plus the operator's own measurement from `verify-desktop.mjs`:
> `{"supported":true,"locked":false,"hasFocus":false}`.
>
> **That measurement killed the previous approach, and correctly.** The window is deliberately `focusable: false`,
> and Windows' foreground rules refuse `win.focus()` for it — so a pointer lock is not available on that machine at
> all. Two further causes were in the code, and both are what actually made the rotation "异常":
>
> 1. **The window never captured the pointer.** `lib/client.js`'s secondary-press branch has always called
>    `setPointerCapture`; `lib/desktop-page.js` only did it for the LEFT-button drag. Without a capture, the cursor
>    left the pet-sized window within a few pixels and `pointermove` stopped arriving — the rotation simply stopped.
>    This is the mechanism the operator was describing as "从来没能把鼠标真正锁住过", and the fix is the one the
>    request asked for, just named differently.
> 2. **The launcher made the window click-through in the middle of the drag.** `interacting` was
>    `rect.dragging === true` only, and the launcher's whole click-through rule is "is the cursor over painted
>    pixels" — which a rotation leaves almost immediately. The page now reports `orbiting: viewDrag !== null` and the
>    launcher holds the window interactive for the duration.
> 3. **And a guard I had missed in the pass before:** `win.on('focus', () => win.blur())` — the second half of "this
>    window never holds focus" — had no `orbitFocus` exemption, so it took back the focus the lock needed the instant
>    `win.focus()` granted it. Guarded now.
>
> **The assertion changed from a mechanism to a behaviour, and that is the point of this pass.**
> `verify-desktop.mjs` no longer asserts "this window can hold a pointer lock" (it cannot, on the machine that
> matters). It asserts what the operator can see: with real `sendInputEvent` mouse events, right-dragging the pet
> must turn the view while the pointer travels away from it, and releasing must stop it. Measured on this machine:
> `note right-drag orbit: {"before":0,"during":-18.096,"yawMoved":true,"stoppedAfterRelease":true}`. The pointer-lock
> result is still PRINTED (as a note) because it is an environment fact worth having, but nothing depends on it.
>
> **Two probe/static assertions were added for the parts the live test cannot reach:** the page must report
> `orbiting: true` while dragging and `false` after (`orbitingReported` / `orbitingCleared` in the browser probe —
> a synthetic pointer cannot take a real capture, so the capture call itself is asserted statically in
> `check-plugin-load.mjs`, which also pins `interacting = rect.dragging || rect.orbiting` and the new focus guard).
>
> **Counts unchanged:** desktop 232, browser (client-test) 87, core 955, host+model 514, chunk-delivery 39, browser
> 13, mmd 13; total **1855**. **Verified:** `verify-desktop.mjs` → 232 passed with the orbit note above;
> `verify-browser.mjs --page client-test` → 87 passed; `check-plugin-load.mjs` PASSED; `client-chunks.mjs --check`
> clean.
>
> **The lesson, third time in two days:** the first two attempts asserted a MECHANISM (a lock request succeeding in
> a harness that could satisfy a precondition the product cannot). This one asserts the BEHAVIOUR the operator
> described — and it is measured with real input in the real window, so it can fail for the reason a user would hit.

> # ✅ 2026-10-12 (thirty-third pass) — 锁由启动器代劳: the page's own lock request could never succeed
>
> **The report:** 「并没有成功，光标没有被锁住。」 — the thirty-second pass's mechanism did not work in the real app,
> and the reason is the interesting part.
>
> **What was wrong with it.** The page asked the launcher to focus the window, waited for the launcher's answer, and
> then called `requestPointerLock()` itself. The self-test that "proved" this worked was **testing the wrong
> requester**: it called `executeJavaScript(..., true)` from the main process, and that `userGesture` flag is exactly
> what the page cannot supply. Once the request comes from the page — *after* an async IPC round trip — Chromium
> refuses it, focus or no focus. So the feature was verified through a path production never takes. The probe
> asserted the shape of the chain and could not see the difference either.
>
> **The fix: the launcher owns the lock, both directions.** `desktop/main.js` holds the request and release scripts
> (`ORBIT_LOCK_JS` / `ORBIT_UNLOCK_JS`) and runs them with `executeJavaScript(script, true)` — the very call the
> self-test had been making, now on the production path. On `pet3d:orbit(true)` it sets the window focusable,
> focuses it, waits 30 ms (there is a message round trip between `focus()` and the renderer actually being the
> focused document) and requests the lock; on `false` it exits the lock, restores `focusable: false`, hands focus
> back and re-asserts always-on-top. The page sends one message per direction and only READS the result
> (`pointerlockchange`) — one writer per environment, with the page's own `requestPointerLock` kept solely for the
> browser-tab case where there is no launcher and no focus constraint.
>
> **And the self-test now drives the production path:** `pet3dDesktop.orbit(true)` from inside the page — through
> preload, through the real IPC handler — then reads `document.pointerLockElement`, then `orbit(false)` and confirms
> it was released. Measured result:
> `{"supported":true,"locked":true,"hasFocus":true,"releasedAfter":true}`, and the suite asserts `locked === true`.
>
> **Two probe changes that follow from the same lesson:** `pageLeftTheLockAlone` (the page must NOT call
> `requestPointerLock` when a launcher is present — an assertion that would have caught this pass's bug directly),
> and `turnedOnMovement` (with the page believing it is locked, a `pointermove` whose `clientX` does not change but
> whose `movementX` does must still turn the view — otherwise "locked" would mean "frozen").
>
> **Counts unchanged** — desktop 232, browser (client-test) 87, core 955, host+model 514, chunk-delivery 39,
> browser 13, mmd 13; total **1855**. The pass changed WHO requests and HOW it is measured, not how many assertions
> there are. **Verified:** `verify-desktop.mjs` → `desktop: 232 checks passed` with the note above;
> `verify-browser.mjs --page client-test` → 87 passed; `check-plugin-load.mjs` PASSED (its orbit-chain block was
> rewritten for the new four links); `client-chunks.mjs --check` clean.
>
> **The lesson, written down because this repository has now paid it twice in one day:** a self-test that supplies a
> precondition the product cannot supply is not a test of the product. The `userGesture` flag made the lock succeed
> in the harness and fail in the app, and nothing in the suite could tell the two apart — only the operator's screen
> could.

> # ✅ 2026-10-12 (thirty-second pass) — 独立桌宠的旋转也锁鼠标了: the floating window takes a real pointer lock, via the launcher's focus
>
> **The report:** 「独立桌宠的旋转功能一直都异常，从来没能把鼠标真正锁住过，把窗口内桌宠的锁定鼠标旋转的方法搬到独立桌宠上。」
>
> **The cause was simply that the code was never there.** `lib/desktop-page.js` had no pointer-lock code at all —
> the lock existed only in `lib/client.js`, for the in-app pet. And this window needs it MORE than that one: it is
> only as big as the pet's box, so a right-drag leaves it within a few pixels and the pointer events stop arriving
> altogether. That is the "异常" the operator was seeing.
>
> **But the lock cannot simply be requested here, and that was MEASURED rather than assumed.** The window is
> created `focusable: false` on purpose (a click-through desk pet must not steal focus), and Chromium grants a lock
> only to a focused document. The launcher's own self-test now requests one for real, with the `userGesture` flag,
> and reports what came back:
>
> ```
> note  pointer lock in the floating window: {"rejected":"The root document of this element is not valid for pointer lock."}
> ```
>
> — and, with the window made focusable first (the production order), the same probe answers
> `{"supported":true,"locked":true,"hasFocus":true}`. So the feature is now **asserted**, not hoped for:
> `verify-desktop.mjs` fails if that window cannot hold a lock, because that failure is user-visible.
>
> **The chain is four links, and each is asserted statically in `check-plugin-load.mjs`:**
> 1. the page asks the launcher for focus the moment the press BECOMES an orbit (`bridge.orbit(true)`), never on
>    the press itself — the thirty-first pass's lesson, and the probe pins it (`noFocusOnStill`);
> 2. `desktop/preload.js` carries it over the bridge (`pet3d:orbit` / `pet3d:orbit-focus`);
> 3. `desktop/main.js` sets the window focusable, focuses it, and answers — **and `keepOnTop` no longer blurs it
>    for the duration of the orbit**, which would have thrown the lock's own precondition away;
> 4. only on that answer does the page call `requestPointerLock()`. Ending the orbit releases the lock, restores
>    `focusable: false`, hands focus back and re-asserts always-on-top.
>
> While locked the orbit runs on `movementX`/`movementY`, exactly as the in-app pet's does — `clientX`/`clientY` are
> frozen by the lock. `pointercancel` no longer opens a menu. A lost lock (Escape, the system taking it back) ends
> the orbit, which is the same rule as the other surface.
>
> **Two probe defects of my own, both caught by the new assertions:** the first version asked for focus BEFORE
> setting `viewDrag.moved`, so the `orbit-focus` answer arrived to a test that was still false (`lockCalls: 0`); and
> `endOrbitGesture` fired unconditionally, so every plain right-click nudged the window's focus state
> (`orbitCalls: [false,false,false,true,false]`). Both are fixed and both are now asserted.
>
> **Counts:** desktop 231 → **232** (the live pointer-lock assertion); browser (client-test) 87, core 955,
> host+model 514, chunk-delivery 39, browser 13, mmd 13 unchanged. **Project total 1854 → 1855.**
> **Verified:** `verify-desktop.mjs` → `desktop: 232 checks passed` with
> `note pointer lock in the floating window: {"supported":true,"locked":true,"hasFocus":true}`;
> `verify-browser.mjs --page client-test` → 87 passed; `check-plugin-load.mjs` PASSED; `client-chunks.mjs --check`
> clean. Verified by breaking the rule too: putting the focus request back on the press makes the probe fail.
>
> **What the operator gets, and the cost:** right-dragging the floating pet now turns the view with the cursor
> captured, so the rotation no longer stops when the mouse leaves the pet. The cost is that the window is
> focusable for the duration of that drag — it takes focus when the orbit starts and gives it back when it ends. A
> plain right-click never touches it. **The host half changed again (`desktop/main.js`), so DSH must be restarted;
> the client half needs a hard reload.**

> # 🛠 2026-10-12 (thirty-first pass) — 右键把光标锁住了: the pointer lock was taken on the PRESS, so the menu never opened
>
> **The report:** 「右键依然无法弹出菜单。我有一个猜想，右键现在是旋转功能，位置也被锁定了，只能旋转模型，哪怕大幅度移动鼠标，
> 松开之后，鼠标仍然在原始位置，有点像3D游戏中锁定光标。」 — and that hypothesis was exactly right. The thirtieth pass had
> raised the drag threshold, which was necessary but not sufficient, and this is the other half.
>
> **The cause.** `onPointerDown`'s secondary branch called `requestOrbitLock()` **on the press**. A locked pointer
> freezes `clientX`/`clientY` and reports `movementX`/`movementY` instead — the very measurement the orbit reads —
> so a plain right-click (a) captured and hid the cursor, and (b) let a hand's tremor accumulate past the
> threshold, which turned the press into an orbit and made `finishOrbit` swallow the menu event. In DSH Desktop
> the lock is granted, so the menu was unreachable; the floating window never had a lock at all, which is why its
> right-click worked all along.
>
> **The fix, three parts:**
> 1. **The lock belongs to the ORBIT, not to the press.** `requestOrbitLock()` moved from `onPointerDown` into
>    `onPointerMove`, at the moment the press crosses the threshold. A plain right-click now never touches the
>    cursor, `clientX`/`clientY` keep flowing, and the platform's `contextmenu` arrives normally.
> 2. **The RELEASE decides whether a secondary press was a click** (`onPointerUp`), exactly as the floating window
>    has always done — so the menu no longer depends on receiving a `contextmenu` event from a host page, an
>    Electron shell or a lock at all. `contextmenu` is now the SECOND way in (for platforms that deliver it while
>    the button is still down), and `secondaryMenuOpened` keeps whichever arrives first from opening it twice.
> 3. `suppressContextMenu` still arms for a real drag, so the platform's own menu event cannot open a menu over
>    the view that was just turned.
>
> **The assertion that pins it, and the reason it was needed:** the probe's lock check asserted
> `lockCalls === 1` **immediately after `pointerdown`** — it ENCODED the bug. It now asserts `lockOnPress === 0`
> and `lockRequested` (exactly one call) only after the press moves. Verified by putting the call back on the
> press: the check FAILS (`lockOnPress: 1`).
>
> **Counts unchanged** (browser client-test 87, core 955, host+model 514, chunk-delivery 39, browser 13, mmd 13,
> desktop 231 — total **1854**): the pass changed what an existing assertion checks, not how many there are.
> **Verified:** `verify-browser.mjs --page client-test` 87 passed, `verify-desktop.mjs` 231 passed,
> `check-plugin-load.mjs` PASSED, `client-chunks.mjs --check` clean (`lib/client.js` is served, not chunked).
>
> **The lesson, and it is now the third time this repository has paid it:** the suite could not take a real
> pointer lock ("no user gesture in the harness"), so it happily pinned a lock request that a real browser turns
> into a captured cursor. The operator's own reading of their screen — 「有点像3D游戏中锁定光标」 — was worth more
> than the green run. When a report is about what the cursor DOES, ask the person holding the mouse.

> # 🛠 2026-10-12 (thirtieth pass) — 「内置宠物右键单击无效」: the right-drag threshold was 4 px, so a wobbling hand never got the menu
>
> **The report, from the running app:** 「内置宠物右键单击无效」. The right button opened nothing. And the request
> that preceded it was the clue: 「内置宠物把双击打开菜单变成右键打开菜单」 — the operator had been opening the menu
> by DOUBLE-CLICKING, because a right-click did not work.
>
> **The cause, measured rather than guessed.** `VIEW_DRAG_THRESHOLD` was **4**, compared as a MANHATTAN distance
> (`|dx| + |dy| < threshold`), so a wobble of 2 px on each axis was already a VIEW DRAG — and a moved secondary
> press is an orbit: on release the app pet sets `suppressContextMenu`, and the `contextmenu` that follows is
> swallowed **by design**, so that a right-DRAG does not open a menu over the view it just turned. A real mouse
> wobbles on every click, so the gesture the operator asked for worked only for a perfectly still hand, and a
> double-click — which had no such rule — was the only reliable way in.
>
> **How it was found, and it is the lesson of the pass: the probe had never driven the real gesture.** Its menu
> check dispatched a bare `contextmenu`, which is not what a right-click is — the press arms the orbit and the
> RELEASE is what sets the suppression. The rewritten check drives press → optional wobble → release → menu event,
> and it failed immediately (`afterStillClick: false`), which is the whole reason a one-line threshold change can
> now be trusted. **A synthetic event that skips the gesture's own steps is a check that cannot fail for the
> reason the user sees.**
>
> **The fix, in both pets:** `VIEW_DRAG_THRESHOLD` 4 → **10** (0.08 rad ≈ 4.6°, still nothing as an orbit, and no
> hand trips it). My first probe version dispatched the `contextmenu` on the WINDOW, where it reaches only the
> capture listener and not the pet's own handler — and the window's copy of the threshold was found by writing the
> same three cases for it: it decides on `pointerup` rather than from `contextmenu`, so it never had the swallow,
> but it shared the 4 px number and therefore the same "no menu for a wobbling hand".
>
> **And the SECOND cause, fixed while the first was being measured.** `openMenuAt` called the menu module's new
> `setChecked` UNGUARDED. The two halves are delivered under separate `rev=` URLs a page can cache separately, so
> a newer `lib/client.js` beside an older `client.menu.js` threw inside the `contextmenu` handler — **a menu that
> never opened, for a reason visible only in a console**. Both surfaces now check
> `typeof menu.setChecked === 'function'` first, `check-plugin-load.mjs` audits that guard in both files (verified
> by breaking it: the assertion fails), and the probe gained
> `an older menu chunk loses the 重力 mark, not the menu`.
>
> **Counts:** browser (client-test) 85 → **87** (the app pet's full gesture sequence; the window's three wobble
> cases); core 955, host+model 514, chunk-delivery 39, browser 13, mmd 13, desktop 231 unchanged.
> **Project total 1852 → 1854.**
>
> **Verified:** `verify-browser.mjs --page client-test` → `browser: 87 checks passed`; `verify-desktop.mjs` →
> `desktop: 231 checks passed`; `check-plugin-load.mjs` PASSED (and FAILED as expected with the guard removed);
> `client-chunks.mjs --check` clean (no chunk changed — `client.js` and `desktop-page.js` are served, not chunked).
> The two new checks were also run against the OLD threshold and both fail there, which is what makes them
> regression tests rather than decoration.
>
> ## What the operator will see
>
> A right-click on the in-app pet opens the menu with a real hand now, and so does one on the floating window.
> **The client half needs a hard reload** (DevTools 「清空缓存并硬性重新加载」) — the old `client.js` is what is
> running in the app at the moment of this writing, and the threshold lives in it.

> # ✅ 2026-10-12 (twenty-ninth pass) — the menus lose the app's lifetime, gain 重力, and the two pets' 关闭 rows become their own words
>
> ## What was asked (operator, verbatim)
>
> > 内置宠物把双击打开菜单变成右键打开菜单；内置宠物和外置宠物都去掉关闭和重启dsh的功能和项目，外置宠物的"关闭宠物"改成
> > "关闭独立宠物"，作用是"切换回窗口内"，内置宠物的"关闭宠物"改成"隐藏宠物"，隐藏之后，在dsh右下角显示一个"显示宠物"的按钮。
> > 内置和外置宠物菜单各增加一个"重力"开关，关闭后停用抛掷和重力下坠，可以随意摆放，开启后恢复重力和抛掷，内置宠物和外置
> > 宠物的重力开关状态完全独立。
>
> ## What is DONE
>
> * **重启/退出 DeepSeek Harness are GONE, with everything behind them.** The two entries, both languages'
>   labels, the two failure strings, `harness.js` (whole file) and `ROUTES.harness` + `harnessHandler` +
>   its registration in `lib/index.js`. Nothing else in the product ever called that route, so this is a
>   deletion rather than a disable. The ROUTE TABLE went 18 → 17 entries, which `check-plugin-load.mjs` and
>   `verify-model.mjs` both assert by name — that is the pair that would have caught a half-removal.
>   **One deliberate leftover:** the window's `onMenuChoice` keeps a bare `if (id === 'restartHarness' || id ===
>   'quitHarness') return;` branch. An older delivered `client.menu.js` — a cached chunk is this repository's
>   most repeated failure — would otherwise hand this function an id it does not know, and a no-op is a better
>   answer than a fall-through.
> * **The app pet's menu opens on the RIGHT BUTTON only.** The `dblclick` → `openMenuAt` handler is deleted
>   (operator: 「内置宠物把双击打开菜单变成右键打开菜单」). `contextmenu` was already the other way in, so this is
>   the removal of a second one: a double-click can be something else later, and the two pets now accept the
>   same gesture.
> * **关闭宠物 is one id with two meanings, and they are two different WORDS.** In `lib/menu.js`,
>   `labelFor('closePet')` answers `closePetApp` (隐藏宠物 / Hide pet) or `closePetWindow` (关闭独立宠物 / Close the
>   floating pet) from `toSurface`. The app's row still calls `setHidden(true)`; the window's row now writes
>   `petSurface: 'app'` and NOTHING else — it used to write `hidden: true` as well, which would have hidden the
>   pet exactly when the operator asked for it to come back. **It is therefore the same write as 切换回窗口内**,
>   and that duplication is the operator's own instruction rather than an oversight: 「外置宠物的'关闭宠物'改成
>   '关闭独立宠物'，作用是'切换回窗口内'」. It carries the SAME 非debug模式生效 gate as the switch row, because
>   under 调试模式 it would silently turn the debug mode off — the one thing that gate exists to prevent.
> * **显示宠物 is the operator's word now.** The restore button was already a real element outside the menu
>   (a hidden pet cannot be right-clicked) and was already in DSH's bottom-right corner
>   (`position:fixed;right:16px;bottom:16px`); only the label changed, 显示桌宠 → 显示宠物. The probe asserts
>   the LABEL (in Chinese, from a second widget mounted in `zh`) and the RECTANGLE, because a button that exists
>   off-screen is not a way back.
> * **重力, on both pets, with independent keys.** `core.DEFAULTS.gravity` (app pet, shipped **on** — it has
>   always thrown) and `windowGravity` (floating window, shipped **off** — "drag and place" since 2026-10-10,
>   so the switch is what turns throwing back ON out there rather than off). The cleaner keeps them apart and
>   `verify.mjs` pins the independence in both directions. The menu row is a real SWITCH: `lib/menu.js` gained
>   `TOGGLES`/`setChecked(id, value)`/`checked` on its records, renders `role="menuitemcheckbox"` +
>   `aria-checked` + `data-checked`, and draws the mark with a `::before` — not a child node, because the label
>   IS the button's `textContent` and a mark added as a child would become part of the entry's name. Each
>   surface sets its own key at OPEN time and pushes it into `placement.throwEnabled`; `endFall()` is new and
>   stops a fall that is already in progress, because "no throwing and no falling" is not "no new throws" and a
>   pet frozen in mid-air is the worse bug. Both keys are in their surface's `LOCAL_KEYS`, and the window's
>   `gravity()` accessor publishes the preference AND `throwEnabled` so the pair can be checked from outside.
>
> ## Two DEFECTS found while doing it
>
> 1. **The floating window's page never heard a menu close that it did not initiate.** `createMenu` closes
>    itself on an entry click, on Escape and on an outside press; the page's `menuOpen` was only ever reset by
>    the page's OWN `closeMenu()`, so after a click on an entry the page still believed the menu was up — and
>    `menuOpen` is what the WINDOW is sized from, so the launcher kept the extra room for a menu that was gone
>    and `__PET3D_DESKTOP_STATE__.menu.open` kept reporting it. Fixed with `onClose`, which now owns the
>    "give the window its pet-sized box back" work so there is ONE path. **Found by the new 重力 probe check,
>    which is the first check in that file to CLICK an entry in this window** — every earlier menu check called
>    `closeMenu()` and so exercised the one path that was wired.
> 2. **The 关闭/显示 wording was asserted in the wrong language.** The probe mounts the app pet with
>    `language: 'en'` and then compared its labels to the Chinese literals: the check passed before this pass
>    only because it never read them. It reads them from the sources that own them now — the row from
>    `lib/menu.js`'s table for the widget's own language, the button from a second widget mounted in `zh` —
>    since a literal in both languages passes while the product shows the wrong one.
>
> ## Counts
>
> core 949 → **955** (the two keys, their defaults and their independence in both directions); browser
> (client-test) 82 → **85** (the right-button gesture, the app pet's 重力 switch, and the window's — the last
> one also carrying the `menuClosed` assertion for defect 1); host+model 514, chunk-delivery 39, browser 13,
> mmd 13, desktop 231 unchanged. **Project total 1843 → 1852.** `check-plugin-load.mjs` now asserts **17
> routes** (was 18) and the menu block also pins the two 关闭 words and the two 重力 keys.
>
> ## Files touched in this pass
>
> * DELETED: the harness module (and its route, its handler and its import)
> * EDITED: `lib/menu.js`, `lib/core.js`, `lib/client.js`, `lib/desktop-page.js`, `lib/index.js`,
>   `lib/client.core.js` + `lib/client.menu.js` (regenerated), `scripts/verify.mjs`, `scripts/verify-model.mjs`,
>   `scripts/check-plugin-load.mjs`, `build/probe/client-test.js`, `README.md`, `docs/ARCHITECTURE.md`,
>   `HANDOFF.md`
>
> ## NOT done — the live pass
>
> Nothing in the last two passes was exercised against a running DSH. Specifically unmeasured: the 重力 switch
> on the real floating window (where the launcher, not the page, sizes the box), the 关闭独立宠物 row handing
> the pet back without a flash of an empty window, and the 显示宠物 button's corner on a real screen with a
> taskbar. The plugin directory is a junction to this checkout, so a host restart picks the host half up —
> **and this pass changed the HOST half** (`lib/index.js` lost a route), so a restart is required before the
> route table matches. The client half needs a hard reload (DevTools 「清空缓存并硬性重新加载」).



> # ✅ 2026-10-12 (twenty-eighth pass, RESUMED AND FINISHED) — the two settings panels are GONE, and both pets share ONE right-click menu
>
> **SUPERSEDED IN PART by the entry above (twenty-ninth pass):** the 重启/退出 DeepSeek Harness entries this entry
> describes as shipped — and `harness.js` with them — were REMOVED the same day at the operator's request.
> Everything else here still stands.
>
> **This is the entry of 2026-10-12, continued.** The pass below it (`🚧 …STOPPED MID-WAY`) left the work on disk:
> the panels deleted, `lib/menu.js` written, the host's `harness` route in place. This session finished it.
> **Resuming is what it looked like: the panel SOURCE was still in the tree** — the interrupted pass had deleted
> only its delivered chunk — so the first thing done was to read the tree rather than the entry.
>
> ## What was asked (operator, verbatim, in two messages)
>
> > 内置桌宠和独立桌宠各自有一套设置，这样是不对的。删掉两个单独的设置面板。
> > 内置桌宠右键弹出菜单"重置视角，重置大小，通用设置，当前模型参数设置，切换回窗口外（非debug模式生效），关闭宠物，重启DeepSeek Harness，退出DeepSeek Harness"
> > 独立桌宠右键弹出菜单"重置视角，重置大小，通用设置，当前模型参数设置，切换回窗口内（非debug模式生效），关闭宠物，重启DeepSeek Harness，退出DeepSeek Harness"
>
> And, when asked how 重启/退出 should be implemented (a plugin cannot call Electron's quit/relaunch), the
> operator chose **A: 宿主优雅退出 + 分离进程重启**, knowing that DSH Desktop reports a host-initiated exit as a
> failure and therefore shows its own 「启动失败」 dialog with 退出/重启 buttons afterwards.
>
> ## What is DONE
>
> * **The two settings panels are GONE — and the panel SOURCE is now really deleted.** The delivered chunk
>   (`client.panel.js`) went in the interrupted pass; this session removed `panel.js` too. It had no whitelist
>   entry (`WINDOW_SOURCES` names `menu.js`), no page loaded it, and its `__PET3D_PANEL__` global was read by
>   nothing — **a second definition of the pet's right-click UI left in the tree with no caller is exactly the
>   debt this repository keeps paying for**, and it is the one state a replaced file must never be left in.
>   `lib/client.js` (app pet) and `lib/desktop-page.js` (floating window) no longer build a panel: no panel
>   markup, no panel CSS, no per-state motion checkbox rows, no model picker row, no size stepper, no draggable
>   title bar, no close button. Their panel-owned preferences are still READ (they are settings now), they simply
>   have no control on the pet.
> * **`lib/menu.js` is the ONE right-click menu, for both pets** — published as `globalThis.__PET3D_MENU__`,
>   delivered to the app as the generated chunk `lib/client.menu.js` (chunk table updated; `menu.js` replaced the
>   panel in the host's `WINDOW_SOURCES`, and `lib/desktop-page.html` loads it).
>   `MENU_ITEMS` is the operator's order, once: `resetView, resetSize, globalSettings, modelSettings, surface,
>   closePet, restartHarness, quitHarness`. The module owns the markup, the eight labels in BOTH languages, the
>   hover/keyboard behaviour, the outside-press/Escape close, and `place()`; each surface owns WHERE it goes and
>   what each id DOES. The only row that differs is `surface`: the app's menu says 切换回窗口外
>   (`toSurface: 'window'`), the window's says 切换回窗口内 (`toSurface: 'app'`).
>   **非debug模式生效 is implemented as a DISABLED row**: `setSurfaceAllowed(petSurface !== 'both')`, read at
>   OPEN time on both surfaces (the probe asserts it disabled, and its tooltip present, under `both`, and enabled
>   again outside it, reading the NODE as well as the module's own record).
> * **App pet (`lib/client.js`)**: `buildMenu()`/`bindMenu()`/`openMenuAt()`/`closeMenu()`/`onMenuChoice()`/
>   `harnessAction()`/`resetView()` replace `buildPanel`/`bindPanel`/`togglePanel`/`placePanel`/`setPanelOpen`/
>   `onPanelDrag*`; `PANEL_KEYS` → `LOCAL_KEYS` (and `panelOpen` dropped from it). 重置大小 = `resetSize()`,
>   重置视角 = `resetView()` (camera only — deliberately NOT `reset()`, which clears everything),
>   通用设置/当前模型参数设置 = the existing `openSettingsWindow('global'|'model')`, 关闭宠物 = `setHidden(true)`
>   (the 显示桌宠 restore button stays, because a hidden pet cannot be right-clicked), 切换回窗口外 writes
>   `petSurface: 'window'` + `applySurface('loud')`. **`motionNotice`, `desktopStatus`, `desktopNote` are DATA
>   now**: `motionNotice` replaces the old `motionNote` ELEMENT, so any `.hidden`/`.textContent` read of
>   `widget.motionNote` is a bug.
> * **Floating window (`lib/desktop-page.js`)**: same menu, `toSurface: 'app'`; 切换回窗口内 writes
>   `petSurface: 'app'` and lets the APP stop the window (one writer; the window must not race it), 关闭宠物
>   writes `hidden: true` **and** `petSurface: 'app'` (so the pet comes back inside DSH with its 显示桌宠 button
>   rather than leaving an empty window) and then asks the launcher to close it via `bridge.quit()`.
>   `petSurface` was ADDED to that page's `LOCAL_KEYS` and `panelOpen` removed. The window still GROWS to hold
>   the menu: `menuBox`/`menuOpen`/`placeMenu()` replaced `panelBox`/`panelOpen`/`layoutPanel()`, `hitTest` uses
>   `isOverMenu`, and the page's published `reportRect` field is now **`menu:`** (was `panel:`), with
>   `hit.overMenu` (was `overPanel`) and `menu: { open, rect, module }` in `__PET3D_DESKTOP_STATE__`.
>   `globalThis.__PET3D_DESKTOP_MENU__(true|x,y|false)` replaced `__PET3D_DESKTOP_PANEL__`, and the mount's
>   returned API is `openMenuAt/closeMenu/isMenuOpen/menu()/menuApi()/menuRect()`.
> * **`harness.js` + `ROUTES.harness = '/pet3d/harness'`** implement 重启/退出 DeepSeek Harness.
>   `POST {action:'quit'|'restart'}`; the handler answers FIRST (`{ok, action, graceful, helperPid}`) and defers
>   the action one tick, because the response is the last thing the page will ever hear. `quit` =
>   `ctx.get('appExit')(0)` (the launcher's own bounded shutdown; `process.exitCode = 0` when a composition has
>   no `appExit`). `restart` = a DETACHED `process.execPath` helper that waits for THIS pid to leave, then
>   relaunches the app with `ELECTRON_RUN_AS_NODE` **deleted** from the env, followed by the same quit. Both
>   surfaces `fetch('/pet3d/harness')` and report a refusal (app: the badge; window: the 碎碎念 bubble); the two
>   failure strings live in `lib/menu.js`'s `LABELS` because they are about ITS entries.
> * **`desktop/main.js`** follows the rename: `panelRect` → `menuRect`, `rect.panel` → `rect.menu`,
>   `extras = [menu, status, speech]`, `report.checks.menu` / `checks.menuHitTest`, and its self-test drives
>   `window.__PET3D_DESKTOP_MENU__(true/false)`.
>
> ## Two DECISIONS this session had to make (both are in the code with their reasons)
>
> 1. **"The press that opened the menu cannot close it" is now STRUCTURAL, not a clock comparison.**
>    `lib/menu.js` guarded the outside press with `event.timeStamp <= openedAt`, where `openedAt` came from
>    `performance.now()`. That is fragile in exactly the way a clock comparison is: `timeStamp` is COARSENED
>    (Chrome rounds it to 100 µs), so the probe — which dispatched its "outside" press microseconds after
>    `open()` — passed or failed on ROUNDING, and it failed here. Measured rather than guessed: with the press
>    constructed inline in the `dispatchEvent` call the stamp equalled `openedAt` (guard tripped, the menu
>    stayed open); with one extra statement between them it did not (the guard passed, and the check went green
>    for a reason that had nothing to do with the product). **The rule is now a deferred bind**: `scheduleBind()`
>    puts the document guards up one TASK after the open, so while the opening press is still dispatching the
>    listener does not exist yet — and a later press is a later task. `close()` and `destroy()` cancel a pending
>    bind, which is what keeps a closed menu from growing listeners nothing owns. The probe became an
>    `asyncCheck` that asserts BOTH halves deterministically: a press in the opening task does not close it, and
>    a press one task later does.
> 2. **空闲休眠 was the one preference the deleted panel owned with NO other home.** `sleepAfterMs`
>    (30 s / 2 min / 5 min, a closed list in `cleanPreferences`) had exactly one control in the whole product —
>    the panel's nap row — so deleting the panels left it unreachable: the menu is about the pet and its eight
>    entries do not carry it, and neither settings page had a field. **Put to the operator, who chose to add it
>    back to 通用设置**: `<select id="pref-sleep">` in 显示与外观, bound to the stored number, with
>    `config-page.js` publishing `sleep: { value, control, selected, options }` so "the row is missing" and "the
>    row rendered but is not bound" are distinguishable from outside. `lib/menu.js`'s header claims every panel
>    setting "already has a home in the two settings pages"; that claim is TRUE again rather than documented as
>    false. (模型选择 needed nothing: 模型参数's 当前模型 `<select>` writes `modelId` for every surface.)
>
> ## The three things the interrupted pass left broken, and how each was fixed
>
> 1. **`build/probe/client-test.js` was RED (4 of 82 after the one-line fix; 8 before it).** The trivial first
>    failure was the swallowed `var host2 = document.createElement('div')` in the stale-delivery check — and
>    because `host2` was undefined, that check's `finally` threw on `host2.remove()` BEFORE it restored
>    `globalThis.__PET3D_MENU__`, which is why two later checks failed with a missing module. **A `finally` that
>    can throw is how one bug becomes three.** The other real failures were all the probe disagreeing with the
>    product: a `hasReset` assertion for a `.pet3d-size-reset` button that went with the panel (now: the pet's
>    chrome carries no size control at all), `debugRow.title` read off `menu.items()` records that do not carry a
>    title (now: read off the NODE — `disabled` and the tooltip are what the browser acts on), and a `/inside/i`
>    regex on the window's switch label (now: asserted against `menu.js`'s own table, because a regex on English
>    is a report about the probe's `language`). Final: **`browser: 82 checks passed`**.
> 2. **`scripts/verify-desktop.mjs` disagreed with the launcher.** Its stub page server served the deleted panel
>    module (now `menu.js`; the whitelist's `pages.css` stays on its own branch, and `placeholder.js` was
>    dropped, since the host does not serve it — keeping a name the host refuses HIDES a page that asks for it);
>    its three panel assertions became three MENU ones (`checks.menu.open`, `checks.menu.module`,
>    `checks.menuHitTest`); and it gained the 空闲休眠 assertion. Final: **`desktop: 231 checks passed`**, with
>    the live Electron window really started on this machine.
> 3. **Docs were stale in every count and described a panel that no longer exists.** `README.md` (banner, the
>    PET MENU/SETTINGS summary rows, the 工具 table's client row, the two-settings-pages section, the
>    floating-window section, the project total), `docs/ARCHITECTURE.md` (the chunk list, the settings-surfaces
>    paragraph, the hit-test paragraph, the known-limitations list) and `AGENTS.md` (which chunk to regenerate,
>    and which suite covers `lib/menu.js`) all now describe the menu. **`check-docs.mjs` is the suite for this,
>    and it is what said the real total is 1843.**
>
> ## Counts
>
> browser (client-test) 87 → **82**; desktop 230 → **231** (the reopened 空闲休眠 row); core 949, host+model 514,
> chunk-delivery 39, browser 13, mmd 13 unchanged. **Project total 1847 → 1843.** `check-plugin-load.mjs` now
> audits **99 ids** (global-page.html 76) over 18 routes.
>
> ## Files touched in this session
>
> * DELETED: the panel SOURCE (`panel.js`); its delivered chunk went in the interrupted pass
> * EDITED: `lib/menu.js`, `lib/client.js`, `lib/config-page.js`, `lib/index.js`, `lib/global-page.html`,
>   `lib/client.menu.js` (regenerated), `scripts/verify-desktop.mjs`, `scripts/check-plugin-load.mjs` (prose),
>   `scripts/client-chunks.mjs` (prose), `build/probe/client-test.js`, `README.md`, `docs/ARCHITECTURE.md`,
>   `AGENTS.md`, `HANDOFF.md`
>
> ## NOT done — the live pass
>
> Nothing in this pass was exercised against a running DSH: the menu's appearance in the app overlay, the window
> growing to hold it, the disabled `surface` row under 调试模式, the 空闲休眠 row on the real 通用设置 page, and
> the harness route's real behaviour (whether 退出 really shows DSH Desktop's 「启动失败」 dialog, and whether
> 重启 brings a second instance up once the port is free) are all UNMEASURED. The plugin directory is a junction
> to this checkout, so a host restart picks the host half up; **the client half needs a hard reload** — in DSH
> Desktop that is the DevTools 「清空缓存并硬性重新加载」, not F5 (see the twenty-seventh entry).

> # 🚧 2026-10-12 (twenty-eighth pass, STOPPED MID-WAY: the power was about to go out) — SUPERSEDED by the entry above
>
> **Kept for the record.** The work below is on disk and was finished by the session above; its list of what was
> broken is what that session worked from.
>

> ## What was asked (operator, verbatim, in two messages)
>
> > 内置桌宠和独立桌宠各自有一套设置，这样是不对的。删掉两个单独的设置面板。
> > 内置桌宠右键弹出菜单"重置视角，重置大小，通用设置，当前模型参数设置，切换回窗口外（非debug模式生效），关闭宠物，重启DeepSeek Harness，退出DeepSeek Harness"
> > 独立桌宠右键弹出菜单"重置视角，重置大小，通用设置，当前模型参数设置，切换回窗口内（非debug模式生效），关闭宠物，重启DeepSeek Harness，退出DeepSeek Harness"
>
> And, when asked how 重启/退出 should be implemented (a plugin cannot call Electron's quit/relaunch), the
> operator chose **A: 宿主优雅退出 + 分离进程重启**, knowing that DSH Desktop reports a host-initiated exit as a
> failure and therefore shows its own 「启动失败」 dialog with 退出/重启 buttons afterwards.
>
> ## What is DONE (all of this is on disk, syntax-checked, and `client-chunks.mjs --check` is clean)
>
> * **The two settings panels are GONE.** `panel.js` and its delivered chunk `client.panel.js` are
>   DELETED. `lib/client.js` (app pet) and `lib/desktop-page.js` (floating window) no longer build a panel:
>   no panel markup, no panel CSS, no per-state motion checkbox rows, no model picker row, no size stepper, no
>   draggable title bar, no close button. Their panel-owned preferences are still READ (they are settings now),
>   they simply have no control on the pet.
> * **`lib/menu.js` (NEW) is the ONE right-click menu, for both pets** — published as `globalThis.__PET3D_MENU__`,
>   delivered to the app as the generated chunk `lib/client.menu.js` (chunk table updated; `menu.js` replaced
>   `panel.js` in the host's `WINDOW_SOURCES`, and `lib/desktop-page.html` loads it).
>   `MENU_ITEMS` is the operator's order, once: `resetView, resetSize, globalSettings, modelSettings, surface,
>   closePet, restartHarness, quitHarness`. The module owns the markup, the eight labels in BOTH languages, the
>   hover/keyboard behaviour, the outside-press/Escape close, and `place()`; each surface owns WHERE it goes and
>   what each id DOES. The only row that differs is `surface`: the app's menu says 切换回窗口外
>   (`toSurface: 'window'`), the window's says 切换回窗口内 (`toSurface: 'app'`).
>   **非debug模式生效 is implemented as a DISABLED row**: `setSurfaceAllowed(petSurface !== 'both')`, read at
>   OPEN time on both surfaces (the probe asserts it disabled under `both` and enabled again outside it).
> * **App pet (`lib/client.js`)**: `buildMenu()`/`bindMenu()`/`openMenuAt()`/`closeMenu()`/`onMenuChoice()`/
>   `harnessAction()`/`resetView()` replace `buildPanel`/`bindPanel`/`togglePanel`/`placePanel`/`setPanelOpen`/
>   `onPanelDrag*`; `PANEL_KEYS` → `LOCAL_KEYS` (and `panelOpen` dropped from it). 重置大小 = `resetSize()`,
>   重置视角 = the new `resetView()` (camera only — deliberately NOT `reset()`, which clears everything),
>   通用设置/当前模型参数设置 = the existing `openSettingsWindow('global'|'model')`, 关闭宠物 = `setHidden(true)`
>   (the 显示桌宠 restore button stays, because a hidden pet cannot be right-clicked), 切换回窗口外 writes
>   `petSurface: 'window'` + `applySurface('loud')`. **`motionNotice`, `desktopStatus`, `desktopNote` are DATA
>   now** (the panel's note elements are gone): `motionNotice` replaces the old `motionNote` ELEMENT, so any
>   `.hidden`/`.textContent` read of `widget.motionNote` is a bug — the probe was rewritten accordingly.
> * **Floating window (`lib/desktop-page.js`)**: same menu, `toSurface: 'app'`; 切换回窗口内 writes
>   `petSurface: 'app'` and lets the APP stop the window (one writer; the window must not race it), 关闭宠物
>   writes `hidden: true` **and** `petSurface: 'app'` (so the pet comes back inside DSH with its 显示桌宠 button
>   rather than leaving an empty window) and then asks the launcher to close it via `bridge.quit()`.
>   `petSurface` was ADDED to that page's `LOCAL_KEYS` and `panelOpen` removed. The window still GROWS to hold
>   the menu: `menuBox`/`menuOpen`/`placeMenu()` replaced `panelBox`/`panelOpen`/`layoutPanel()`, `hitTest` uses
>   `isOverMenu`, and the page's published `reportRect` field is now **`menu:`** (was `panel:`), with
>   `hit.overMenu` (was `overPanel`) and `menu: { open, rect, module }` in `__PET3D_DESKTOP_STATE__`.
>   `globalThis.__PET3D_DESKTOP_MENU__(true|x,y|false)` replaced `__PET3D_DESKTOP_PANEL__`, and the mount's
>   returned API is `openMenuAt/closeMenu/isMenuOpen/menu()/menuApi()/menuRect()`.
> * **`harness.js` (NEW) + `ROUTES.harness = '/pet3d/harness'`** implement 重启/退出 DeepSeek Harness.
>   `POST {action:'quit'|'restart'}`; the handler answers FIRST (`{ok, action, graceful, helperPid}`) and defers
>   the action one tick, because the response is the last thing the page will ever hear. `quit` =
>   `ctx.get('appExit')(0)` (the launcher's own bounded shutdown; `process.exitCode = 0` when a composition has
>   no `appExit`). `restart` = a DETACHED `process.execPath` helper (`RESTART_HELPER_PROGRAM`) that waits for
>   THIS pid to leave, then relaunches the app with `ELECTRON_RUN_AS_NODE` **deleted** from the env (`detached`,
>   `unref`, cwd = the executable's directory), followed by the same quit. Both surfaces `fetch('/pet3d/harness')`
>   and report a refusal (app: the badge; window: the 碎碎念 bubble). The two failure strings live in
>   `lib/menu.js`'s `LABELS` (they are about ITS entries) and both surfaces read them from there.
> * **`desktop/main.js`** (the launcher) follows the rename: `panelRect` → `menuRect`, `rect.panel` → `rect.menu`,
>   `extras = [menu, status, speech]`, `report.checks.menu` / `checks.menuHitTest` (was `checks.panel` /
>   `panelHitTest`), and its self-test drives `window.__PET3D_DESKTOP_MENU__(true/false)`.
> * **`scripts/check-plugin-load.mjs` ran GREEN** after the rewrite: `plugin load preflight: PASSED`, with
>   `98 ids` (config-page.html 23, global-page.html 75, 5 created) and **18 routes** — its panel-is-one-definition
>   block became the menu-is-one-definition block, and it gained a block for the harness chain (route → handler →
>   `appExit` → detached APP relaunch → both surfaces asking for it).
> * **`scripts/verify-model.mjs` ran GREEN: `host + model: 514 checks passed`** (unchanged count; the route-table
>   assertion gained `exact /pet3d/harness`).
> * `scripts/client-chunks.mjs` regenerated: `client.core.js` (unchanged), `client.scene.js` (unchanged),
>   **`lib/client.menu.js` (NEW, 15904 bytes)**; `--check` reports `client chunks up to date (3 of 3)`.
> * `scripts/verify-browser.mjs` inlines/serves `lib/menu.js` and its `CHUNK_FILES` names `client.menu.js`.
> * `build/probe/client-test.js` was rewritten: the panel checks became menu checks (eight entries in order,
>   the operator's own zh words, 非debug模式生效 disabling the row, viewport clamping, outside-press/Escape
>   closing it, an inside press NOT closing it, 重置大小/重置视角/关闭宠物 run through real clicks on the real
>   items, the two settings entries POSTing the right actions and model), the motion-picker checks read
>   `compatibleMotions()`/`staleMotionIds()`/`motionNotice` instead of checkbox rows, a new
>   `chooseMotion(state, ids)` helper writes the same preference the settings page writes, the desktop-status
>   check reads `desktopStatus`/`desktopNote`, the window's panel check became the window's menu check, and the
>   probe drives `pet.openMenuAt/closeMenu/menu()/menuRect()`.
>
> ## What was BROKEN / NOT DONE — start here (all of it fixed by the entry above; kept as the list that session worked from)
>
> 1. **`build/probe/client-test.js` is RED: `browser: 8 of 82 checks FAILED`** (`verify-browser.mjs --page
>    client-test`). **The first failure is trivial and cascades into at least two more:**
>    `a stale delivery costs the voice and the menu, never the pet: host2 is not defined`. The rewritten check
>    lost the two lines that the replaced span had swallowed —
>    `var host2 = document.createElement('div'); document.body.appendChild(host2);` — which must be re-inserted
>    just before `var stale = null;` in that check (`lib/client.js` is fine; this is probe-only). Because
>    `host2` is undefined, the `finally` block throws on `host2.remove()` **before** it restores
>    `globalThis.__PET3D_MENU__`, so every check after it runs with the menu module deleted — which is why
>    `the right-click menu is the shared definition…` (`menuApi` undefined) and the window page's
>    `pet.menu()` (`null`) also fail. **Fix that one line, re-run, then look at whatever is genuinely left.**
>    The other known-shape failures to expect: the probe's own new checks may need the `stubFetch` route stubs
>    for `/pet3d/harness`, and check counts changed (87 → 82: the removed panel/motion-row checks outnumber the
>    added menu ones — **the docs' browser figure must be corrected to whatever the suite finally reports**).
> 2. **`scripts/verify-desktop.mjs` has NOT been touched** and now disagrees with the launcher. It must:
>    (a) serve `'menu.js'` instead of `'panel.js'` in its fake page server's source list (~line 950);
>    (b) replace its three panel assertions (~lines 1257-1268) — `report.checks.panel.open === true` →
>    `report.checks.menu.open === true`, `checks.panel.module` → `checks.menu.module`, `checks.panelHitTest` →
>    `checks.menuHitTest` — and re-word the 「right-clicking opens the settings panel」 label;
>    (c) its self-test's window page now mounts a menu, so `probeOtherPage`/`probeHitTest` expectations about
>    the panel element no longer apply. Its count was 229 and WILL move.
> 3. **Docs are NOT updated**: `README.md` (banner + the three suite rows + the project-total paragraph),
>    `docs/ARCHITECTURE.md` (the settings/panel paragraph), and this file's own counts/`expect … checks` line.
>    `node scripts/check-docs.mjs` has not been run (it re-derives the totals, so it is the local suite once the
>    counts are final). Anything that still says 「设置面板」 about the pet's right-click is now wrong: it is a
>    MENU, and the two settings PAGEs are the only settings surfaces.
> 4. **`node scripts/verify.mjs` (core) has not been re-run** — `lib/core.js` was not touched, but the tree's
>    stated totals are not trustworthy until the browser and desktop suites have settled.
> 5. **Not yet verified live at all.** Nothing in this pass has been exercised against a running DSH: the menu's
>    appearance in the app overlay, the window growing to hold it, and the harness route's real behaviour
>    (especially that DSH Desktop's own failure dialog appears after 退出, and that 重启 really brings a second
>    instance up once the port is free) are all UNMEASURED. The plugin directory is a junction to this checkout,
>    so a host restart picks the host half up; the client half needs a hard reload (see the twenty-seventh entry).
>
> ## Files touched in this pass
>
> * ADDED: `lib/menu.js`, `lib/client.menu.js` (generated), `harness.js`
> * DELETED: `panel.js`, `client.panel.js`
> * EDITED: `lib/client.js`, `lib/desktop-page.js`, `lib/desktop-page.html`, `lib/index.js`,
>   `desktop/main.js`, `scripts/client-chunks.mjs`, `scripts/check-plugin-load.mjs`, `scripts/verify-model.mjs`,
>   `scripts/verify-browser.mjs`, `build/probe/client-test.js`, `HANDOFF.md`
> * NOT touched (and probably needs to be): `scripts/verify-desktop.mjs`, `README.md`,
>   `docs/ARCHITECTURE.md`, `lib/config-page.js` / `lib/global-page.html` (the two settings pages are the only
>   settings UI now — worth a look at whether 模型选择 and 空闲休眠 still have a field there).

> ## ✅ 2026-10-11 (twenty-seventh pass) — 调试模式: the floating window AND the pet inside the app, at once
>
> **What was asked:** "设置当前插件为debug模式，独立桌宠和内置桌宠同时显示".
>
> **There was no debug mode, and the two pets were exclusive ON PURPOSE.** `petSurface` was `auto` / `window` /
> `app`, and `applySurface` hides the in-app copy the moment the window reports itself running
> (`showInAppPet(!running)`) — so "watch the two renderers side by side" was not a setting anybody could
> reach: a prompt, a pose or a size that differs between them is invisible by construction while only one of
> them is on screen.
>
> **The debug mode is a fourth VALUE, not a second flag.** `core.PET_SURFACES` is now
> `['auto', 'window', 'app', 'both']`, and `applySurface` answers `both` by starting the window exactly as
> `auto` does and simply never hiding this copy; a host that cannot open a window leaves the in-app pet up,
> which is the state `auto` falls back to anyway. A separate boolean beside the surface was rejected: the
> cleaner would then own two keys that can contradict each other, and the panel's own 独立窗口桌宠 switch
> writes the surface.
>
> **Its control is 通用设置 → 显示与外观 → 调试模式.** Setting it writes `petSurface: 'both'`, clearing it
> writes `auto`, and the page publishes `debugMode` (the surface, whether the box rendered, and what it shows)
> so "the box is there but not bound" is a failing check rather than a screenshot nobody can read.
>
> **A snapshot now RE-APPLIES the surface, and that is a fix rather than a detail.** Every other preference is
> a value the scene re-applies; this one decides which surfaces EXIST, so it has to reach the launcher
> (`POST /pet3d/desktop`). `adoptSurface()` compares the incoming value with the one last applied and calls
> `applySurface('quiet')` when it moved — without it, ticking 调试模式 in the settings window started the
> window only after a page reload, which reads as a switch that does nothing. `petSurface` therefore joins
> `PANEL_KEYS`: the panel's switch is the other writer, and a choice that never reached the store would be
> undone by the next poll.
>
> **The shared panel knows the fourth value too.** `panel.js`'s 显示位置 select gained
> `<option value="both">同时显示（调试）</option>` and its label, because a select that did not offer it would
> render the FIRST option for a profile that is on `both` — a control reporting a surface the pet is not on. No
> surface requests that row today (the app's panel has the 独立窗口桌宠 switch, the settings window has
> 调试模式), so this is the definition being kept honest rather than a new control.
>
> **Switching it ON in the running app needed the settings FILE, and that is a host-restart fact worth
> keeping.** `cleanPreferences` runs in the HOST for the settings store, so the copy loaded at activation
> rewrites an unknown `both` back to `auto`. Measured live before the edit was picked up:
> `POST /pet3d/settings {"preferences":{"petSurface":"both"}}` answered `version 9, petSurface auto` — the
> value accepted by nothing and the version not even bumped, i.e. the switch would have ticked and unticked
> itself with no error anywhere. The store file was therefore written directly
> (`~/.dsh/profiles/desktop/pet3d-desktop/pet3d-settings.json`, backup `.bak-20261010-both`, only
> `petSurface` changed), which is what the NEXT host boot reads; the client half needs the usual page reload.
> Revert with the backup, or just clear the box on the 通用设置 page once the host is new.
>
> **A CACHED `client.core.js` must not be able to cancel it — found on the operator's machine, minutes after the
> first restart.** `POST`ing the surface twice told the whole story: `app` stopped the window and `both` started
> it again, so the page was running the NEW `lib/client.js` (nothing else in either half sends enable/disable) —
> and the in-app pet stayed hidden anyway, because the CORE chunk it was paired with came from the browser cache
> and its `cleanPreferences` predates `both`: it rewrote the store's `both` to `auto`, which is the one value that
> hides this copy. The same mismatch this file already records for `SpeechMachine` (the delivered chunks are
> cached under a revision an edit does not change), with a nastier symptom: a switch that reports success and
> moves nothing. The entry now owns that value — `petSurfaceFrom(raw, cleaned)` keeps the snapshot's own word for
> `both` whatever the cleaner answers, `readStorage` keeps it for the local copy, and both are pinned (the
> browser probe's `debugSurface.staleRule`, and the stale-delivery section of `check-plugin-load.mjs`, which
> reports a verdict rather than a count — so the documented total did not move for this part).
> **The operator's fix is a HARD reload, not a restart — and in DSH DESKTOP that is a DevTools action, not a
> keystroke.** The renderer is Electron: there is no address bar and no F5, and restarting the app reloads the
> page **from its own disk cache**, which is why two restarts changed nothing at all. What works is DevTools
> (`F12`, already open) → the reload button in its toolbar → right-click → **「清空缓存并硬性重新加载」**
> (Empty Cache and Hard Reload), or Network → ☑ `Disable cache` → reload; the supported alternative for a bundle
> is the plugin manager's own reload/rebuild, which is the documented `rebuilt()` path for bundle content. With
> the entry rule above in place, the cached chunk no longer decides anything once the entry is refetched.
>
> **And the diagnosis was settled from the page itself, not from a theory.** In the DevTools console,
> `document.querySelector('.pet3d-pet')` was MOUNTED with an inline `visibility: hidden` — the surface rule, not
> the 隐藏 preference (that one sets the `hidden` ATTRIBUTE, which inline visibility cannot undo) — and setting
> `visibility = ''` brought the second pet back on the spot. So the pet, its scene and its state channel were
> healthy the whole time; only the value the hide-rule read was wrong, i.e. the chunk. `fetch('/pet3d/settings')`
> from the same console agreed with this file: `petSurface: both` in the store while the page behaved as `auto`.
>
> **Also measured while chasing it:** `/pet3d/preview` answers `{"seq":0,"preview":null}` and the in-app widget
> polls it every 400 ms (`watchHostPreview`), the settings store every 1500 ms (`watchHostSettings`). That is the
> designed poll behind the settings window's 预览, not a reload loop — worth writing down, because a request log
> full of `preview` lines reads like a runaway refresh when the real problem is a cached chunk.
>
> **Counts moved UP:** core 946 → **949** (the cleaner keeps `both`, an unknown surface still falls back, and
> the shipped default), client 86 → **87** (both visible AND the window asked for, against `auto` hiding the
> same copy on the same host), desktop 229 → **230** (the 调试模式 row on the 通用设置 page) — project total
> 1842 → **1847** — with the README banner, the three README rows, the README project-total paragraph and
> `docs/ARCHITECTURE.md` updated to match. `check-docs.mjs` re-derives the total, so it is the one that proves
> the four figures agree.
>
> **Run per `AGENTS.md`:** `verify.mjs` → `core: 949 checks passed`; `verify-browser.mjs --page client-test` →
> `browser: 87 checks passed` (its `debugSurface` readout:
> `{"bothVisible":true,"enablePosts":1,"applied":"both","autoHidden":true}`); `verify-desktop.mjs` →
> `desktop: 230 checks passed` with the live window started on this machine (`alwaysOnTop=true`, 45196 lit
> pixels, Electron 44.0.0). `verify-all.mjs` was NOT run — that is the operator's call.
>
> ## 🐛 2026-10-11 (twenty-sixth pass) — the settings windows were UNSTYLED because `pages.css` was served as JAVASCRIPT
>
> **The report:** "插件面板设置窗口完全变成了无格式文本的堆积，排查原因。"
>
> **The cause, measured rather than guessed.** `GET http://127.0.0.1:19387/pet3d/window/lib/pages.css` answered
> `200` with `content-type: text/javascript; charset=utf-8` — the route that serves every `/pet3d/window/lib/`
> source hard-coded ONE type for the whole whitelist (`desktopSourceHandler` in `lib/index.js`), and the twenty-fifth
> pass had added the shared stylesheet to that whitelist. A stylesheet response that is not CSS is refused by the
> browser before a single rule is applied (Chrome: "Refused to apply style ... its MIME type ('text/javascript') is
> not a supported stylesheet MIME type, and strict MIME checking is enabled"), so both pages loaded, both scripts ran,
> every status code said 200, and every rule in `lib/pages.css` was dropped. The window was the raw HTML: headings,
> labels, tables and buttons stacked as text. Not a 404, not a parse error, not a stylesheet that failed to load —
> it loaded and was ignored.
>
> **Why no suite saw it.** `verify-desktop.mjs` runs against its own stub HTTP server, which answers `pages.css`
> ITSELF with `text/css` (line ~1038) — so the real handler was never asked for the one file that mattered, and
> every browser assertion in that suite was made against a correctly-served stylesheet. The host suite DID request
> `pages.css` through the real handler (`verify-model.mjs`) and asserted only `status === 200` and a non-empty body:
> a 200 with 16 KB of bytes looks the same whatever type it claims to be.
>
> **The fix.** `WINDOW_SOURCES` (the whitelist) and a new `WINDOW_SOURCE_TYPES` (`{ '.css': 'text/css; charset=utf-8' }`)
> are now module-level EXPORTS in `lib/index.js`; the handler picks the type by the requested name's own extension and
> falls back to `text/javascript` for everything else. The extension table is the point: a new entry in the whitelist
> can no longer inherit a type that is wrong for it.
>
> **The assertion that closes the hole.** `verify-model.mjs` now walks `WINDOW_SOURCES` and asks the REAL handler for
> each name, asserting the response's `content-type` against `WINDOW_SOURCE_TYPES` (`pages.css` → `text/css;
> charset=utf-8`, every `.js` → `text/javascript; charset=utf-8`), plus that the table's `.css` entry is CSS and that
> the whitelist it walks is the route's own. Nine assertions, and they are the kind that would have caught this on the
> day it shipped: the suite reads the same constants the handler does, so there is no second copy to drift.
>
> **Counts moved UP:** host 504 → **514** (project total 1832 → **1842**; core 946, chunk-delivery 39, browser 13,
> client 86, mmd 13, desktop 229 unchanged). `check-docs.mjs` re-derives the total and reports **206** (it gained the
> one assertion for the moved host count); the README banner, both README rows, the README project-total paragraph and
> `docs/ARCHITECTURE.md` were updated to match.
>
> **This one needs a HOST restart to be visible in a running app** — the type is chosen by host code, not by the page:
> the page is served fresh on every request (`no-store`), but the handler that answers it is the copy loaded at
> activation. Verified after the edit with the live route still reporting `text/javascript`, i.e. the running DSH was
> still answering with the old handler at that moment; the plugin directory is a junction to this tree
> (`~/.dsh/profiles/desktop/node_modules/dsh-plugin-pet3d` → this checkout), so a restart picks the fix up with no
> install step.
>
> **Run per `AGENTS.md`:** `verify-model.mjs` reported `host + model: 514 checks passed` (and `504` before the new
> assertions, so the nine are accounted for); `check-plugin-load.mjs` PASSED with the new exports (97 ids, 17 routes);
> `check-docs.mjs` reported `docs: 206 checks passed` after the doc updates. `verify-all.mjs` was NOT run — that is the
> operator's call.
>
> ## ✅ 2026-10-11 (twenty-fifth pass) — the settings are TWO REAL PAGES, and a LATCH now stands between a page and the store
>
> **What was asked:** "彻底把设置重构，设置里面的排版非常混乱，顺序也很混乱，就彻底优化一下，模型参数和通用设置（原总设置）是两个单独的
> 页面，通用设置可以用静态页面实现。" (The other half — the model information resident in memory — was the twenty-fourth pass
> and was left alone.)
>
> **Two pages, not two panels of one.** The twenty-second pass kept ONE file and hid half of it per `?panel=`. That
> worked and read badly: a hidden section is still in the document (its controls are built, its ids are in the markup,
> a screenshot of the wrong half looks plausible), and the two windows were the same page twice. Now
> `lib/config-page.html` is 模型参数 only (模型 → 表情 → 部位 → 弹簧骨, in that order) and the NEW `lib/global-page.html`
> is 通用设置 only (模型导入 → 动作导入 → 状态 → 碎碎念 → 视线 → 鼠标互动 → 其他, in that order), each opening with
> `<body data-page="model|global">`. `SECTION_PANEL`, `PANEL` and `applyPanel()` are DELETED, and `?panel=` is no
> longer read by anything. **One shared script drives both** (`lib/config-page.js`, whose every lookup goes through a
> guarded `element()` and whose every builder returns early) — a second copy would be a second implementation of the
> same rules, which is the debt `panel.js`'s own header says this repository has paid for twice. A NEW
> `lib/pages.css` holds the `<style>` block both pages share, so the split did not duplicate 154 lines of CSS into two
> files that can drift.
>
> **Route shapes.** `ROUTES.config` = `/pet3d/config` (unchanged) and the NEW `ROUTES.global` = `/pet3d/global`, both
> served by one factory (`settingsPageHandler(file, label)`: `readFileSync` per request, `cache-control: no-store`,
> `GET`/`HEAD` only) — deliberately NOT `/pet3d/settings`, which is the settings STORE. `pages.css` joined the
> `/pet3d/window/lib` whitelist. The launcher's two actions keep their names (`settings` → the global page,
> `config` + `modelId` → the model page) and now open two PAGES; `probeOtherPanel` became `probeOtherPage` and swaps
> the ROUTE (`url.pathname`) instead of a query parameter it could not rely on being present. `lib/client.js` and
> `lib/desktop-page.js` build the sibling route for their tab fallback, and `panel.js`'s second row is relabelled
> **总设置 → 通用设置** (the operator's own word for the page) — `client.panel.js` regenerated.
>
> **THE DATA-LOSS LATCH.** `hasSnapshot` (`lib/config-page.js`, declared beside `lastPushed`, set in `adoptSnapshot`
> and in `onUnsupported`) gates `persist()`, which is the ONLY write path in the file — every control, `writeSpeech`
> and `chooseEditingModel` go through it. Nothing leaves the page (not even the localStorage cache) before a host
> snapshot has been adopted, so a page that fails to boot cannot post its defaults over everything the user
> configured. `chooseEditingModel` and the `?model=` URL adoption no longer write during boot for the same reason; the
> URL's choice is pushed once, from `adoptSnapshot`, and only when the store has no model of its own. `onUnsupported`
> opens the latch deliberately: a host with no `/pet3d/settings` has no store to overwrite and its own storage IS the
> store.
>
> **The id audit is now over the UNION of the two pages** (`scripts/check-plugin-load.mjs`): "does this lookup resolve
> on at least one of the two pages" is the honest question for one script driving two documents, and it reports
> `config-page.html 23, global-page.html 74, 5 created` for 97 ids. The per-page half is asserted where it can be: the
> desktop suite checks that neither page carries the other's sections, and the host suite checks the two served
> documents directly. Six status elements that used to be created at runtime now live in the card they report on
> (`#model-import-note`, `#motion-import-note`, `#motion-note`, `#pref-speech-test-result`, `#speech-llm-note`,
> `#pref-gaze-span-auto`); `#spring-note` stays created by `ensureStatusElements()`, and `#footer-note` (prose the
> operator asked to have removed) is gone with its write.
>
> **The desktop suite's two panel assertions became two PAGE assertions and the count did NOT move** (229): the
> launcher opens `/pet3d/config` and navigates the same window to `/pet3d/global`, and what is asserted is the two
> readings' own `page`, that neither page carries the other's sections, and that the 通用设置 keys came from the global
> reading. Two existing assertions failed first and were right to: `sizes.controls` and `wind.rows` are published by
> the 通用设置 page, so `probeOtherPage`'s merge now takes `sizes` and `wind` from the global reading too.
>
> **Counts did NOT move:** desktop 229, host 504, project total **1832** — the three host-side page assertions replaced
> three container assertions one-for-one, and the two new desktop assertions replaced two. The route-count assertions
> in `check-plugin-load.mjs` moved 16 → 17 (the new route register, no new assertion) and `verify-model.mjs`'s route
> table gained `exact /pet3d/global`. Since the counts are unchanged, the README/ARCHITECTURE/HANDOFF totals needed no
> edit; the README's `verify-desktop.mjs` row and ARCHITECTURE's settings-window paragraph were still reworded,
> because both described the deleted `?panel=` mechanism.
>
> **The live profile was checked, not just assumed.** The desktop suite drives the launcher against its OWN stub HTTP
> server, which answers `/pet3d/settings` itself — so the 部位 probe's add/rename/delete writes a response body in
> `scripts/verify-desktop.mjs`, not the operator's store, and the window it opens has been given its own Chromium
> profile (`app.setPath('userData', …-selftest)`) since 2026-10-08. Neither of those was changed here; what is now
> written down is why the suite is safe to run against a live DSH. The launcher's own `--self-test` flag does open
> its window against the REAL host, so a self-test an operator triggers still probes the real 部位 list (it puts the
> list back by removing the part it added and unticking what it ticked, but it does write the store while it runs);
> pointing THAT at a temporary profile was deliberately not attempted, because the store belongs to the host process and the
> page has no way to be told about a different one — the only cheap version of it would have been to post the whole
> snapshot back, which is exactly the write this pass exists to make impossible.
>
> **Run per `AGENTS.md`:** `check-plugin-load.mjs` PASSED (97 ids, 17 routes); `verify-model.mjs` `host + model: 504
> checks passed`; `verify-desktop.mjs` `desktop: 229 checks passed`; `verify-browser.mjs --page client-test`
> `browser: 86 checks passed`; `client-chunks.mjs` regenerated (`panel.js`) and `--check` clean
> (`client chunks up to date (3 of 3)`). `verify-all.mjs` and `check-docs.mjs` were NOT run — that is the operator's
> call.

> ## ⚡ 2026-10-11 (twenty-fourth pass) — the model's information is now RESIDENT IN MEMORY, so 模型参数 opens without re-parsing
>
> **What was asked:** "模型参数加载太慢了，让它的信息和当前模型一样常驻内存。"
>
> **What was actually slow.** `/pet3d/model-info` did cache — a handler-local `Map` keyed by `path:size:mtime`
> holding the COMPACT projection — but it cached the wrong thing and put it where nothing could invalidate it.
> The expensive part is `describeModel`'s read+parse of the 10–100 MB file, and that ran whenever the key was
> absent: after every size/mtime change (correct, but it means every edit of the model re-parses twice — once
> for the projection, once for the pet), for every model reached through a freshly created handler, and — the
> one that matters for a stale cache — it could not be dropped by any outside code, because the `Map` lived in
> a closure. There was also a hard `cache.clear()` at eight entries, so a panel walking a directory of models
> threw away the model currently on screen.
>
> **What is resident now.** `lib/vrm-info.js` owns a process-wide LRU of **four** described models
> (`MODEL_INFO_CACHE_CAPACITY`, `describeModelCached`), keyed by absolute path, with the same `statSync`
> size+`mtimeMs` freshness check the route used to key on — so an edited file is still re-parsed. `describeModel`
> is now a thin wrapper over it, so every existing caller (`scripts/vrm-report.mjs`, `scripts/verify-desktop.mjs`)
> keeps working unchanged. Invalidation is EXPLICIT as well as incidental: `forgetModelInfo(path)` and
> `clearModelInfoCache()` are exported, and `/pet3d/models` POST calls `clearModelInfoCache()` when a request
> actually CHANGED the directory list — the one place this process learns a model file appeared or went away.
> An idempotent add does not clear it.
>
> **The route lost its own cache, deliberately.** `/pet3d/model-info` now calls `compactModelInfo(describeModelCached(
> absolute, stats))` and nothing else. Two caches keyed on the same pair meant the outer one answered and the
> inner one never even saw the request — and it was the outer one that `forgetModelInfo` could not reach. The suite
> caught this on its first run: with the route-level map still present, "the first request parses the file" FAILED,
> because no parse had been made at all. Response shape, the `{ supported: false, reason }` answer for a non-GLB,
> the 404s and `STRUCTURE_LIMITS` are all untouched.
>
> **How it is asserted (`cacheStats()` exists for this).** The suite reads the counters DIRECTLY — two HTTP answers,
> one cached and one parsed, are byte-identical, so the count is the only witness — and every assertion is a DELTA,
> because the cache is process-wide and earlier groups may already have described a model: first request parses
> (`parses +1`, `size 1`); the second for the same unchanged file does NOT (`parses +1` total, `hits +1`) — this is
> the assertion that fails if the hit path is broken, verified by breaking it; a file that changed under the SAME
> path (two meshes added to the fixture's own glTF, mtime moved forward) is parsed again and reports
> `counts.meshes + 2`; `forgetModelInfo` drops exactly that entry and the next request re-parses; and five distinct
> models past the capacity leave `size === capacity` with `evictions > 0`, so the cache cannot grow into a second
> copy of the directory.
>
> **Counts moved UP:** 1813 → **1832** (host 485 → 504: nineteen cache assertions; core 946, chunk-delivery 39,
> browser 13, client 86, mmd 13, desktop 229 unchanged). The README banner, the README `verify-model.mjs` row, the
> README project-total paragraph, `docs/ARCHITECTURE.md` and this file's first line and `expect … checks` line were
> updated to match. Because documentation changed, `check-docs.mjs` was run as well (`AGENTS.md`'s row for "any
> count those docs quote"), and it now reports **205** — the README's own row for it was stale at 199 and is
> updated to the measured figure.
>
> **Run per `AGENTS.md`:** `verify-model.mjs` reported `host + model: 504 checks passed`; `verify-desktop.mjs`
> reported `desktop: 229 checks passed` (it imports `describeModel`, so the cache is in its path);
> `client-chunks.mjs --check` reported `client chunks up to date (3 of 3); owner id matches the package name`;
> `check-docs.mjs` reported `docs: 205 checks passed`. `verify-all.mjs` was NOT run — that is the operator's call.

> ## 🛠 2026-10-11 (twenty-third pass) — "参数全丢了" was MY BUG, and nothing was lost: an id audit now guards it
>
> **The report:** "我刚刚让你改布局，为什么改完之后原先所有的参数都丢了？"
>
> **First, the file.** `C:\Users\drliu\.dsh\profiles\desktop\pet3d-desktop\pet3d-settings.json` had a LastWriteTime of
> **2026/10/10 14:20** — untouched all day — and its contents were intact: `modelId: m1`, `parts: 5` with the operator's
> OWN labels (眼睛/头/手, 手臂/身体/尾巴), and `speech`, `status`, `expressions` all present. The store had never been
> written by any of that day's passes.
>
> **The cause was the prose strip of the previous pass.** Deleting all 28 `<p class="hint">` blocks also deleted EIGHT
> elements the page's code WRITES to — `model-import-note`, `motion-import-note`, `spring-note`, `motion-note`,
> `pref-speech-test-result`, `speech-llm-note`, `pref-gaze-span-auto`, `footer-note`. The first `.textContent` on null threw
> during boot, so the page stopped BEFORE the host snapshot was applied: every control sat at its DEFAULT, which reads
> exactly like "all my settings are gone" while the file is untouched. Two lessons, both now enforced:
> * **"Delete the explanatory text" is a code change, not a copy change.** Those `<p class="hint" id="…-note">` blocks
>   looked like prose and were status lines the page writes into.
> * **A status line must never cost the whole panel.** `ensureStatusElements()` recreates any of the eight the markup lacks
>   — beside its control, left EMPTY — and `scripts/check-plugin-load.mjs` now AUDITS the two files statically: *every id the
>   page asks for is either in its markup or in that runtime list* (98 ids today). The audit caught a hole in the very fix
>   that introduced it (`['footer-note', null]` is not statically recognisable as a created element, so it read as missing)
>   — which is the check earning its place on its first run.
>
> **Telling the two failures apart, for next time:** a WIPED store leaves the file changed (and the store carries a version
> counter); a page that cannot BOOT leaves the file untouched and the controls empty. `Get-Item` on the settings file takes a
> second and settles it before any code is read.
>
> **Counts did not move:** 1813 (the audit lives in `check-plugin-load.mjs`, which reports a verdict rather than a count;
> the desktop suite stays at 229). **Run per `AGENTS.md`:** `check-plugin-load.mjs` and `verify-desktop.mjs`.

> ## ✅ 2026-10-11 (twenty-second pass) — the settings page becomes TWO panels, and the prose goes
>
> **What was asked:** "把模型参数面板重新排版，模型导入和动作导入，AI碎碎念，状态，视线，鼠标互动和其他等不涉及模型定制的内容，要分流到
> 总设置面板中，然后针对每个模型有自己的模型参数面板，保留剩下的项目。删除所有debug或者解释性的语言." Three decisions were put to the
> operator first, and they chose: **two independent windows** (not tabs), the model panel keeps **表情 / 部位 / 弹簧骨 / 大小**,
> and the text purge is **on-screen only** (the machine-readable readout stays — the suites assert against it).
>
> **How it is built, and why this shape.** One page, two panels, told apart by `?panel=`:
> * the 总设置 window keeps 模型导入 / 动作导入 / 状态 / 碎碎念 / 视线 / 鼠标互动 / 其他;
> * a 模型参数 window (one per model, opened with `?model=`) keeps 模型 / 表情 / 部位 / 弹簧骨.
> One page rather than two HTML files because every section builder, every control binding and the whole published
> readout are shared — a second copy would be a second implementation of the same rules, which is the debt this
> repository has already paid for twice (see `panel.js`'s own header). The grouping is done from the HEADINGS at
> load (`applyPanel`), because the markup has no section wrapper: an `<h2>` starts a group and the group runs until the
> next one, matched by title PREFIX since several headings carry a live count (`状态 12`). Each node of a foreign group
> gets `hidden`; the title and the status line belong to both.
>
> **The entry points.** `panel.js` gained a `globalSettings` row (总设置 → 打开窗口) BESIDE the existing one, whose
> label 模型参数 / 打开窗口 now reads exactly right for the per-model window; the app's pet builds the row through
> `panelMarkup` and wires it by class (with a guard, because an older delivered chunk has no such row), the floating
> window passes the callback, and both surfaces now call `openSettingsWindow('global' | 'model')`, which the host turns
> into `action: 'settings'` (global) or `action: 'config'` (model) — a URL carrying `panel=` and, for the model window,
> the model on screen.
>
> **Prose removed:** 28 `<p class="hint">` blocks and the page's subtitle, gone from the file (a Node `fs` transform, not
> a PowerShell text cmdlet — that is how a README was corrupted here once). Labels, the live status line, per-chip notes
> (未识别 / 已加入) and the published readout all stay: those are data or operational feedback, not explanation.
>
> **The suite problem, and the trick that avoided a 30-assertion rewrite.** The launcher's self-test opened ONE settings
> window and read one readout; with the sections moved, half those assertions would have read 0. So the self-test now
> reads the panel it opened, runs the 部位 probe THERE (部位 stayed on the model panel), and then **navigates the same
> window to `?panel=global`** and reads again, merging the two readouts by KEY (`speech`, `import`, `motionImport`,
> `gaze`, `motions` come from the global reading; everything else from the model one) — because one page renders both, a
> shallow spread would look right while showing the wrong panel. The merge is what makes the flat `shown.*` assertions in
> the suite keep meaning what they meant.
> **And a check that would have caught the first version's lie:** `probeOtherPanel` used `replace(/panel=model/, …)`,
> which silently does nothing when the URL has no such parameter (the suite opens `?model=` only) — so the second reading
> never happened and the navigation proved nothing. The suite's new assertions (`panels === ['model','global']`, and each
> reading's own `panel` field) failed on exactly that, and the fix is the URL API.
>
> **Counts moved:** 1811 → 1813 (desktop 227→229: the two panel assertions; core 946, host 485, client 86 unchanged).
> **Run per `AGENTS.md`:** `verify-desktop.mjs`, `verify.mjs`, `verify-model.mjs`, `check-plugin-load.mjs`,
> `verify-browser.mjs --page client-test`, `client-chunks.mjs` (regenerated: `panel.js` changed). `verify-all.mjs`
> and `check-docs.mjs` were NOT run.

> ## 🛠 2026-10-11 (twenty-first pass) — a LIVE REGRESSION I caused: the floating window lost its clock, then everything
>
> **The report, from the running app:** "外置宠物中，工作状态这下彻底不正常了，深度求索中的时间也没了，过了一会儿深度求索中也掉了，
> 任务完成也没有状态通知了." Four symptoms, and two of them were mine. The first thing to do was not to guess but to ask the
> running instance, and that one request named the cause outright:
>
> ```
> GET /pet3d/state -> {"seq":47,"state":"working","at":14863 ms old,"stale":false,"clock":null}
> ```
>
> **Symptom 2 (no 用时) — my eighteenth pass.** The clock was made to come from the TURN frames the host relays, and
> `clock: null` says **no turn frame had EVER arrived**. That is not a broken setup: the boundary stream is an RPC
> upgrade a plain-JavaScript plugin cannot count on, and `SessionAggregate`'s own comment says so. I built the DSH-exact
> clock on top of a channel this deployment does not have, so `statusFor` had nothing to measure and drew the token-free
> label for ever. **Fixed with a sentinel:** `core.STATUS_CLOCK_FALLBACK` (`'state'`) means "no turn frames, measure from
> the state's own entry time" — the behaviour before the turn clock existed. `statusClock()` returns it when no turn has
> ever been seen, `statusFor` renders the state clock for it, the reporter relays it AS ITSELF (collapsing it to null
> would re-create the bug), the host's sanitiser passes it through, and the window reads it as "use this page's state
> age". `null` still means "a turn IS known and closed with no notice" — DSH's token-free gap — so the DSH rule is kept
> exactly where DSH's own data exists.
>
> **Symptom 3 (深度求索中 dropped after a while) — also my eighteenth pass.** The 90 s staleness window assumed the 5 s
> heartbeat would keep arriving. It does not while the page is throttled: the measured report was **14.8 s** old on a
> healthy app, and Chromium clamps a hidden page's timers to roughly one wake a minute (an occluded window can stop them
> longer). So a live, working pet was declared 失联 and BOTH its status label and its 碎碎念 bubble were cleared — which
> is also why symptom 4 (no completion notice) had nothing left to appear in. **Raised to 5 minutes**, which still bounds
> "for ever" — the whole point of the rule — without ever flushing a pet that is merely in the background.
>
> **What the window can now be asked.** `/pet3d/desktop`'s `state.clock` reports which of the three clocks the label is
> drawn from (`{ startedAt, endedAt }`, the sentinel `'state'`, or null), because two of them have now been shipped
> wrong once and the readouts were otherwise identical.
>
> **Counts moved:** 1804 → 1811 (core 942→946: the sentinel's rule and its rendering, `statusClock`'s fourth answer and
> the reporter's relay of it; host 482→485: the sentinel relayed as itself, a turn clock relayed, and a clock that is not
> a clock refused; desktop 227 and client 86 unchanged in number). The client probe now drives the window with the
> sentinel and asserts the label it produces — `深度求索中，用时 1秒 ···` with `clock: 'state'` — measured, not assumed.
> **Run per `AGENTS.md`:** `verify.mjs`, `verify-model.mjs`, `verify-desktop.mjs`, `check-plugin-load.mjs`,
> `verify-browser.mjs --page client-test`, `client-chunks.mjs` (regenerated; `--check` clean). `verify-all.mjs` and
> `check-docs.mjs` were NOT run.
>
> **The lesson, which is the same one as the 之前那次 stale-state incident:** a feature built on an OPTIONAL channel must
> degrade to its older behaviour when the channel is absent, and the way to find out whether it is absent is to ASK THE
> RUNNING APP — one `GET` here was worth more than any amount of reasoning about the code.

> ## ✅ 2026-10-11 (twentieth pass) — the label on an empty 台词 box follows the SOURCE
>
> **What was asked:** "AI碎碎念开启后，面板里的各种状态后面就不应该写'用内置短语'了，应该是写'用内置AI生成提示词'."
>
> The nineteenth pass switched the shipped table off for `custom`/`ai`, but the panel kept promising it: the count
> beside every 状态 in the collapsed list said 「用内置短语」 and the box's placeholder said 「留空则用内置短语」, whatever the
> source was. A label that contradicts the rule is worse than no label — it is what made the source switch look like it
> had done nothing.
>
> **Now:** `EMPTY_LINES_LABEL` / `EMPTY_LINES_PLACEHOLDER` keyed by source — `builtin` → 用内置短语 / 留空则用内置短语,
> `custom` → 不说话 / 留空则这个状态不说话, `ai` → **用内置 AI 生成提示词** / 留空则用内置 AI 提示词生成一句. `showSpeech` reads them
> from `speech.source` on every change and every settings snapshot, so flipping the picker updates all seventeen labels
> and placeholders at once (and the count still shows `N 条` when the box has lines, in every mode).
>
> **Assertions (desktop +3 → 227, load +2):** the page publishes `speech.emptyLabel`, `speech.emptyPlaceholder`,
> `speech.placeholders` and `speech.rowLabels` — the last one collected from the DOM, so "every collapsed state row shows
> the same words" is asserted rather than assumed — and the suite checks them against the source in force. The load
> suite pins the three label entries and the two lines that read them, so a new source cannot silently inherit
> 「用内置短语」.
>
> **Counts moved:** 1801 → 1804 (desktop 224→227; core 942, host 482, client 86 unchanged). **Run per `AGENTS.md`:**
> `verify-desktop.mjs`, `check-plugin-load.mjs`, and `client-chunks.mjs --check` (nothing chunked changed: the edits are
> `lib/config-page.js` and the two suites). `verify-all.mjs` and `check-docs.mjs` were NOT run.

> ## ✅ 2026-10-11 (nineteenth pass) — choosing a source switches the built-in lines OFF
>
> **What was asked, in one line:** "开启AI碎碎念或者自定义碎碎念之后，关闭内置的默认碎碎念."
>
> **The rule, exactly.** The shipped phrase table IS the `builtin` source and nothing else. With `source: 'custom'` or
> `'ai'`, the table is out of the chain: an empty box for a state means **silence** for that state, not DSH's line. The
> chain is therefore AI → the state's own box → silence in those modes, and the table → the box (a non-empty box still
> REPLACES the table for that state) in built-in mode. `pickSpeechLine(language, event, random, previous, custom,
> tableAllowed)` takes the mode as its sixth argument, and `SpeechMachine.observe` passes
> `speech.source === 'builtin'` for both the event branch and the idle branch — so there is one place that decides, and
> the two branches cannot drift.
>
> **Why this is the right reading of "关闭内置的默认碎碎念":** the old behaviour fell through to the shipped line whenever
> a box was empty, which left the pet speaking in the APP's voice in exactly the states the user had chosen not to use
> it — and made "I set it to AI" impossible to believe. What the user writes stays: a state whose box has lines still
> speaks them, and in AI mode the box is still the fallback while the model thinks (and the answer still wins).
> **Failures are unchanged:** an AI request that fails leaves the user's own line standing, and with an empty box it now
> leaves silence rather than DSH's line.
>
> **The settings page says so now**, in the 碎碎念 section: a second hint under 台词来源 states that choosing 自定义短语 or
> AI 生成 switches the built-in lines off entirely, so a state without a line simply says nothing — the alternative was a
> control whose effect nobody could predict.
>
> **Counts moved:** 1798 → 1801 (core 939→942: the table off for an empty pool in the non-built-in modes, on for the
> same empty pool in built-in mode, and the `pickSpeechLine` contract at its edges; host 482, client 86, desktop 224
> unchanged but all re-run). Three existing assertions pinned the OLD fall-through and were rewritten to the new rule
> rather than deleted — the `custom`-mode one now asserts silence, the AI-group one asserts that the REQUEST still goes
> out while the pet stays quiet, and the "late answer is dropped" check now moves to a state that has a line of its own
> (the shipped table can no longer be the thing a late answer must not overwrite). **Run per `AGENTS.md`:**
> `verify.mjs`, `verify-model.mjs`, `check-plugin-load.mjs`, `verify-browser.mjs --page client-test`,
> `verify-desktop.mjs`, `client-chunks.mjs` (regenerated; `--check` clean). `verify-all.mjs` and `check-docs.mjs` were
> NOT run.

> ## ✅ 2026-10-11 (eighteenth pass) — DSH's OWN 用时, read out of its bundle, and a task that is not a turn
>
> **What was asked:** "你读取一下dsh内部的'深度求索中'的时间汇报，因为宠物的工作时间汇报和dsh不一样，经常会完成一个子任务就清零
> 显示任务达成，然后马上重新开始了，但是整个任务并没做完."
>
> **How to read DSH at all.** The implementation is a PACKED `app.asar` (121 MB) — the "checkout" path in the harness
> notes is inside the archive, not on disk. Two gotchas, both now scripts in `%TEMP%` (`asar-read2.mjs`): an asar
> header is a Pickle (`[u32 4][u32 headerSize][json]`, data at `8 + headerSize`), and **electron-builder writes each
> member's `offset` as a STRING** — filtering on `typeof offset === 'number'` finds zero members and every hit maps to
> "not inside any indexed member". With that fixed, one pass over the buffer finds every occurrence and extracts the
> owning file.
>
> **What DSH actually does** (`@deepseek-ai/dsh-client-ui-chat/lib/client.js`):
> * `RunningStatus` takes the LATEST turn's `location.turn.start?.time` and shows the duration only while
>   `turn.status === 'open'`; otherwise the label is the token-free 「深度求索中」. Minimum one second
>   (`Math.max(1e3, now - startTime)`).
> * `formatRunDuration` — whole seconds, hours only when there are hours, minutes only at ≥60 s, seconds always. The
>   plugin already copied that rule for rule (checked line by line this pass).
> * A settled turn (`TurnProcessNodeView`) reports `turn.end.time - turn.start.time`, and shows no duration at all for
>   `aborted` / `error`.
> * The running flag the plugin reads (`useSessionStatus`) is `agent/status === 'running'`, which is TURN-scoped
>   (`@deepseek-ai/dsh-agent-loop`: `phase.kind !== 'idle'`), and the status record exposed to plugins is exactly
>   `{ running, pendingInteraction, completionUnread }` — **no turn id and no start time**, which is why the pet could
>   not simply read DSH's clock and had to be given one.
> * `completionUnread` is DSH's own "finished while you were away" marker and it is only set for NON-main sessions
>   (`dsh-client-ui-session`), so there is no per-turn 任务达成 in the app to copy either.
>
> **The operator chose, after seeing that: "完全照搬 DSH：逐轮、turn 关闭时不显示用时"** (and 4 s for the settle window).
> Implemented as asked:
> * `PetMachine` now tracks the TURN from the frames the host already relays, **using the frame's own `time`** (the
>   boundary hub has carried it all along — `lib/index.js` — and the machine used to ignore it): `statusClock()` returns
>   `{ startedAt }` while a turn is open, `{ startedAt, endedAt }` once its notice is up, and **null** otherwise.
> * `statusFor(preferences, state, enteredAt, now, clock)` renders the token from that clock: open → `now - start`;
>   settled notice → `end - start` (DSH's 「用时 X」); **null → the token's CLAUSE is dropped** (from the nearest preceding
>   separator to the token, so the shipped line reads `深度求索中 ···`, DSH's token-free variant); and an OMITTED clock
>   keeps the old state-age behaviour for callers that know nothing about turns. The two surfaces pass it: the app from
>   its machine, the window from the relay (`POST /pet3d/state`'s `clock`, sanitised by the host, which also drops it
>   once the report is stale).
> * **A task is not a turn:** a `turn/end` — or the store's falling edge — now lands in `pendingNotice` and is promoted
>   only after `COMPLETION_SETTLE_MS` (4 s) with nothing starting again, and is CANCELLED outright by a `turn/start` in
>   the same session. **Failures are never settled** (an error is a fact, not a judgement about whether work continues),
>   and the promoted notice's `at` is the promotion moment so the hold starts when the user can first see it.
> * The cancel rule needed an ORDERING fact, and getting it wrong is the story of this pass: the first version cancelled
>   on `snap.running === true`, which is exactly what the last snapshot still says right after a `turn/end` — so the
>   frame path could never report a completion at all. `SessionAggregate.snapshot()` now publishes `runningSince` (when
>   its answer last became true), and the machine cancels only when that is NEWER than the turn that ended. The second
>   version stamped it with `Date.now()` inside an object built with an INJECTABLE clock, so every suite saw
>   "resumed" — caught by the tests, fixed to `this.now()`.
>
> **Counts moved:** 1777 → 1798 (core 918→939: the settle window, its cancellation by a new turn, the store-edge road
> into it, the three clock answers at their edges, and `statusClock`'s three states; host 482, client 86, desktop 224
> unchanged in number but all four re-run). **Run per `AGENTS.md`:** `verify.mjs`, `verify-model.mjs`,
> `check-plugin-load.mjs`, `verify-browser.mjs --page client-test`, `verify-desktop.mjs`, `client-chunks.mjs`
> (regenerated; `--check` clean). `verify-all.mjs` and `check-docs.mjs` were NOT run.
>
> **Probe changes worth knowing:** the client probe's prompt checks now hand the widget a `turn/start` (with the frame's
> own `time`) because 用时 is DSH's turn clock and nothing else — and the desktop page's `setState` test hook takes an
> optional clock for the same reason. Both were failing loudly rather than quietly, which is the point.

> ## ✅ 2026-10-11 (seventeenth pass) — 失联: a heartbeat, a freshness window, and the end of "for ever 深度求索中"
>
> **The report:** "有时候开始工作的碎碎念不消失，完成任务后还在显示深度求索中."
>
> **What was actually wrong, and it was not the 碎碎念 box.** "深度求索中" is the STATUS prompt (`DEFAULT_STATUS_TEXT.working`),
> and `GET /pet3d/state` in the operator's live app returned `seq=96, state=working, at 87 s old`. That 87 s was
> legitimate — but it exposed the real defect: **nothing in the pipeline could tell "still working" from "the page
> stopped reporting".** The chain, in three files: the app POSTs only on CHANGE (its dedupe, `createStateReporter`), the
> host then served that report FOR EVER with an unchanged `seq` (`stateHandler`), and the floating window reacts only to
> a moved `seq` (`watchHostState` → `body.seq === seen`) so it never looked at how old the report was. The window even
> documented the sibling case (the app publishing a null state: 17 frozen minutes, 2026-10-11) and not this one.
> **Why "sometimes":** the state machine lives in the app's own pet and ticks on its frame loop, and Chromium stops that
> loop while the DSH window is hidden — so a turn that ended in the background was never COMPUTED, never sent, and the
> window (a separate process, still polling) drew 工作中 / 深度求索中 over a clock that kept counting.
>
> **The fix — two halves, because the ambiguity is the bug:**
> * `createStateReporter` gained `beat` / `startHeartbeat` / `stopHeartbeat`: the app re-states its last state and line
>   every `HOST_STATE_HEARTBEAT_MS` (5 s), forcing past its own dedupe. **A beat carries NO touch** — a press is an
>   event, and repeating it would tell the host the pet was pressed again every five seconds. `lib/client.js` starts it
>   lazily with the reporter (and the fallback object tolerates a core chunk without it).
> * `core.hostStateIsStale(at, now, staleMs)` + `core.hostStateView(held, now, staleMs)`: a report older than
>   `HOST_STATE_STALE_MS` (90 s — several missed beats, so a page throttled to Chromium's worst case of one wake a
>   minute is still believed) is answered as **NO PET IS REPORTING**: `state: null`, no line, `stale: true`, and the
>   `seq` bumped EXACTLY ONCE per transition — because the reader only looks when `seq` moves. Coming back bumps it
>   again, so a window that cleared its label is told there is a pet again. A report that was NEVER made is not stale,
>   it is absent (a different answer).
> * The host applies that rule (`stateStaleMs` from config, defaulting to the constant) and clears the flag on any
>   POST, because a report of any kind is proof of life. The window passes `body.stale` through to its readout, so
>   "the app crashed" and "the app's window was hidden long enough for its frame loop to stop" stop looking identical.
>   The bubble and the label clear through the existing null-state path — the operator's choice when asked: 清空状态栏与气泡.
>
> **Counts moved:** 1728 → 1777 (core 884→918 — the freshness rule at its edges plus the heartbeat driven with an
> injected timer; host 467→482 — the flip proven over real HTTP with a 30 ms window, which is why the window is a
> config knob and not a constant of nature; client 86 and desktop 224 unchanged). **Run per `AGENTS.md`:**
> `verify.mjs`, `verify-model.mjs`, `check-plugin-load.mjs` (four new wiring assertions), `verify-browser.mjs --page
> client-test`, `verify-desktop.mjs`, and `client-chunks.mjs` (regenerated twice: core changed after the first pass, and
> a stale chunk is exactly what a `--check` catches). `verify-all.mjs` and `check-docs.mjs` were NOT run.
>
> **⚠️ A PRE-EXISTING RED, found by running the suite this change warranted:** `check-plugin-load.mjs` asserted
> `/publishState\(state, speech\)/` in `lib/client.js`, but the 点击部位 work had added a third argument
> (`this.publishState(state, speech, touch)`) and that round never ran this suite — so the tree had a stale source-level
> assertion failing silently since then. Corrected to the current shape (the LINE travelling with the state is what it
> was guarding), and the suite is PASSED again. **A reminder of the rule that made it visible: run the suite whose
> inputs changed — and when a change touches WIRING, that is `check-plugin-load.mjs`.**
>
> **Not changed on purpose:** a stale report keeps the last `touch` and `error`. Neither is a claim about what the pet
> is doing now, and wiping the diagnostic is how "I clicked its ear and nothing happened" stops being answerable.

> ## ✅ 2026-10-11 (sixteenth pass) — the expression picker is a dropdown, and ticking one no longer throws you to the top
>
> **What was asked:** "在部位中勾选或者取消表情时，每次点击都会让页面返回到最上面一条。把所有的表情都用下拉框的多选列表，
> 不要直接用checkbox堆积在一起."
>
> **Why it jumped.** Every tick called `rerender()`, which repainted the whole table — and a repaint empties its
> `<tbody>` first. For that instant the document is short, so the browser CLAMPS the scroll position to the top, and
> the rebuild cannot bring it back. The fix is in two layers: the tick no longer repaints anything (see below), and
> `holdScroll()` now saves `document.scrollingElement.scrollTop` around both table renders, because every OTHER
> change (a new structure, a renamed part, a new part) still repaints and had the same latent bug.
>
> **The picker itself.** `appendEmotionCells` — shared by the 表情 table and the 部位 table, so both changed at once —
> no longer builds a `label.pick` + checkbox per expression. Each row gets ONE button (`.pick-select`) showing the
> selection (`无`, or `happy、angry`) and, on click, a `.pick-menu`: a bounded, scrollable panel
> (`max-height: 220px; overflow-y: auto`, with an explicit `::-webkit-scrollbar` because Chromium hides overlay
> scrollbars) holding 无 plus one checkbox per expression. Ticking writes the value, persists, and updates that one
> button label and the open menu's boxes — the table is not touched, which is what makes the jump impossible rather
> than merely fixed. The menu closes on an outside pointerdown or Escape, only one is ever open, and `renderParts`
> drops it (it belongs to a row that has just been replaced).
>
> **Deliberately NOT changed:** the per-clip 播放方式 rows and the motion box sets still use their own controls —
> they pick MOTIONS, not 表情, and the request was about the expression piles. If the same treatment is wanted there,
> it is the same two helpers (`holdScroll`, the menu pattern) and one more call site.
>
> **Assertions (desktop +9 → 214).** In the real window, with the page scrolled down: a row's dropdown opens, the
> model's expressions are inside it and NOT in the row (`input[data-name]` outside a `.pick-menu` must be zero), the
> menu is bounded (`overflow-y: auto` + a pixel `max-height`, read in the probe — the page's published snapshot is a
> poll behind the menu the probe just opened, which is how the first version of this check failed), ticking one
> changes that row's label, **`scrollTop` does not move** (`stayedPut`), and unticking returns the row to 无.
> `pageScrolls` is asserted too, so the jump check cannot pass vacuously on a page too short to scroll.
>
> **Counts moved:** 1709 → 1718 (desktop 205→214; core 884, host 467, client 86 unchanged — no core/renderer code was
> touched, so no chunk regeneration was needed). **Run per `AGENTS.md`:** `verify-desktop.mjs` only (the change is
> `lib/config-page.js` + `lib/config-page.html` + `desktop/probe-parts-editor.js`, whose row in the table is exactly
> this suite), plus `client-chunks.mjs --check` for freshness. `verify-all.mjs` and `check-docs.mjs` were NOT run.
>
> **⚠️ THE SECOND REPORT against the same picker, hours later: "选中一个表情后，再点表情的下拉列表就无效了，必须刷新页面
> 重新进" — and my own bug.** `closePickMenu()` detached the panel and nulled the module-level reference, but the ROW's
> closure still held its own `menu` variable, and the trigger's first line was `if (menu) { closePickMenu(); return; }`.
> So after any close — the trigger itself, Escape, an outside click — that row's button took the "close" branch for the
> rest of the page's life. The tick no longer repaints anything, so not even a stray repaint rescued it: only a reload
> did, which is exactly what was reported. **Fixed by asking the DOM, not the closure**: the test is now
> `openPickMenuNode && wrap.contains(openPickMenuNode)`, and the menu is REBUILT on every open so the boxes always
> reflect the live row. A second defect was hiding behind the first: the outside-click listener removed itself only
> when it actually closed something, so a menu closed by its own trigger left an orphan whose `wrap` was the old row —
> it then read a click inside the NEXT row's menu as an outside click and closed it. One module-level reference
> (`openPickMenuAway`), removed on every open and every close, is that fix.
> **Assertions (desktop +10 → 224):** the menu is closed by the trigger, by Escape and by an outside pointerdown, and
> after EACH of the three it OPENS AGAIN; the rebuilt panel shows the row's live tick; `浏览…` on the STRUCTURE panel
> reopens after 关闭 too (that panel keeps its state in module state and a static element, so it has no such trap —
> now pinned rather than assumed). The outside-click case needs its own tick of patience: the `away` listener is
> attached on a `setTimeout(0)` so the opening click is not read as an outside one, and dispatching pointerdown
> synchronously made three assertions fail downstream of it before that was clear.
> **The lesson worth keeping:** "is this open?" asked of a variable that a different function owns is the whole bug.
> Two reports, both about a control that could not be used twice — check the SECOND interaction of anything stateful.

> ## ✅ 2026-10-11 (fifteenth pass) — the SPRING CHAIN behind a press, and it outranks the structure name
>
> **What was asked:** "触发点击碎念的时候，把对应的链名和结构名一起发给 LLM，链名的优先级大于结构名." (It came after a
> round where the operator asked whether the chain behind a clicked part could be known at all — the answer was
> "the joint name is already in `touch.bone`; the chain is derivable but not wired". This pass wires it.)
>
> **The lookup.** `collectSpringChains` already walks every joint of every chain, so `installAvatar` now also builds
> `this.springChainOf` — a `Map` from the BONE OBJECT to its chain — via `indexSpringChains`, and
> `Scene.prototype.springChainForBone(bone)` answers `{ key, name, label, joints }` or null. Keyed by the OBJECT on
> purpose: that is the same three.js bone the skeleton hands to the raycast, so no node-name rule (three rewrites
> characters; this plugin mirrors that in `core.sanitizeNodeName`) can come between a press and its chain.
> `Scene.anatomyAt` therefore returns `chain` beside `bone`/`mesh`/`region`/`part`, `noteInteraction` publishes it,
> and the raycast answer always CARRIES the field — `null` included, because "no chain here" is an answer and a
> missing field would be a different one. (Measured on the operator's models: 蓝色小肥鱼 names 22 chains after its own
> structures — `LiuHai`, `DaiMao`, `ErDuo.L`, `WeiBa`… — while MikuNT's VRM 0.x file names none, so its two chains
> are positional keys `hair0`/`hair1` and the useful name is the ROOT JOINT, `TwinTail.A.002.L`.)
>
> **The naming rule, in core, exported:** `chainNameOf(chain)` = declared `name` → `label` (the root joint) → `key`.
> Meaningful-first, so an unnamed VRM 0.x chain is named by its root bone and `hair0` never reaches a prompt. The
> chain is reduced to ONE string in the intent (`requestAi(..., structure, chain)`), so both surfaces send a plain
> name and cannot disagree about the shape.
>
> **Priority, on the wire.** `/pet3d/say` takes `chain` (capped and flattened like every other string from a page)
> and `speechPromptFor` builds, when the part has no prompt of its own:
> `用户摸了一下它的 <chain> 这条弹簧骨链（结构：<structure>）（部位：<label>）。就这一下，说一句自言自语。`
> — the chain first, the structure as detail. The host suite asserts the ORDER of the two names in the instruction,
> not just their presence, because the position is what "链名的优先级大于结构名" means on the wire. A part's own
> prompt still beats both; a chain with no structure at all is still answerable; both names are echoed back.
>
> **Two testing traps, both worth remembering.** (1) A check that returns a PROMISE must be registered with
> `asyncCheck`, not `check` — the runner reads a truthy Promise as "passed", so the new check silently passed while
> its assertions never ran (and reported `fromTail: null` into the bargain). (2) The chain index is keyed by the
> BONE, while three-vrm wraps it in a joint object: asking with `chain.joints[0].joint` (the wrapper) answers null
> and asking with `.joint.bone` answers the chain — the check now does the latter, and says so in a comment.
>
> **One measurement left open, deliberately.** In the client probe the WIDGET's scene reports
> `springChainInfo: []` and no `bones` map, while a scene the same probe parses from the same fixture reports
> `['hair','tail']` through the production install path. The probe's widget is constructed without a model load of
> its own, so this looks like a harness artifact rather than a product fact — but it has NOT been proven either way,
> and it matters: if the app's own scene had no chains, this feature could never fire live. **Check it after the
> restart** with `GET /pet3d/desktop` → the window publishes `springs.chains` and `springs.joints`, so one request
> answers it.
>
> **Counts moved:** 1687 → 1709 (core 873→884, host 457→467, client 85→86, desktop 205 unchanged). **Run per
> `AGENTS.md`:** `verify.mjs`, `verify-model.mjs`, `verify-desktop.mjs`, `verify-browser.mjs --page client-test`,
> plus `client-chunks.mjs` (regenerated: core and scene chunks changed). `verify-all.mjs` and `check-docs.mjs` were
> NOT run.

> ## ✅ 2026-10-11 (fourteenth pass) — the structure list scrolls, the structure NAME goes to the model, and a backtick broke the launcher
>
> **Two requests, both from using the thirteenth pass on screen:** "添加结构的下拉框无法滚动，也没有滚动条" and "当开启 AI
> 碎碎念时，未设置对应部位 AI 提示词时，把触摸部位自动传入 AI 生成碎碎念，例如点击眼睛，把触摸眼睛的行为发给 LLM 生成。
> 如果是默认未设置部位的结构，例如 bust，就传给 LLM 让它生成 bust 被触摸的碎碎念".
>
> **1. The dropdown was a native `<input list>` + `<datalist>`.** Chromium draws that popup itself: it cannot be
> scrolled from the page, cannot be styled, and from inside the settings window it showed no scrollbar at all — so
> the last ~150 of a 160-name rig were unreachable. It is now a panel the page draws (`#part-picker`): a filter box,
> a bounded list (`max-height: 180px; overflow-y: auto`) with a scrollbar styled so Chromium cannot hide it as an
> overlay, one row per structure showing its default region and kind, and 浏览… / 关闭 buttons per part row. The
> panel stays open while adding (adding one structure is rarely adding only one) and survives the table's repaint
> because the target part and the filter live in page state, not in the DOM.
>
> **2. In AI mode the model is now asked for EVERY touched part**, prompt or no prompt, and the request carries the
> STRUCTURE the raycast named. `SpeechMachine.react` takes the whole anatomy (`{ region, bone, mesh, part }`) and
> publishes `structure` in its intent; both surfaces forward it (`lib/client.js` in the POST body, `lib/desktop-page.js`
> in its own `fetch`); and the host's `speechPromptFor` builds the instruction when the part has none:
> `用户摸了一下它的 <structure>（部位：<label>）。就这一下，说一句自言自语。` The name goes through VERBATIM — `bust`
> is what 蓝色小肥鱼 calls that mesh and translating a rig's own word would be a guess — and a bone beats a mesh when
> both are known (`J_Adj_L_FaceEye` says which eye; `Face.baked` does not). The chain is unchanged otherwise:
> the part's own prompt still wins, then its lines, then the state's own lines, then silence; the shipped table is
> still never in it. The old rule (ask only when the part had a prompt or lines) is what made an unconfigured part
> go silent in AI mode — the exact case that was reported.
>
> **⚠️ INCIDENT — a stray BACKTICK in an injected script broke the launcher, twice.** The 部位 probe is a script
> evaluated in the settings window, and it was written as a template literal INSIDE `desktop/main.js`. A backtick in
> a comment (once while mentioning a route, once while mentioning the `<datalist>` it replaced) ended that literal
> early, so `desktop/main.js` stopped PARSING. That is not a test failure, it is the pet's window being unable to
> open at all — and the only symptom was an Electron "A JavaScript error occurred in the main process" dialog on the
> operator's screen, which is exactly what they saw. The old suite reported it a minute later as "no self-test report
> after 60 s", naming nothing.
> **Fixed structurally, three ways:** the script now lives in `desktop/probe-parts-editor.js` and is read with
> `fs.readFileSync` (`executeJavaScript` takes a plain string, so no template literal exists to break);
> `scripts/verify-desktop.mjs` begins with `node --check` on `desktop/main.js`, `desktop/probe-parts-editor.js` AND
> `lib/config-page.js`, so an unparseable launcher fails in a second with the parser's own message instead of
> spawning two Electron windows first; and `check-plugin-load.mjs`'s existing read of the launcher is unaffected.
> **The rule, again:** in this tree a backtick is only safe inside a file that is not itself embedded in a template
> literal — the same trap as `THREE`/`core` being non-module-scope names in `lib/pet3d.js`, and it has now cost two
> incidents.
>
> **Counts moved:** 1661 → 1687 (core 863→873, host 450→457, client 85 unchanged, desktop 196→205 — of which 3 are
> the new parse guards and 6 the panel). **Run per `AGENTS.md`:** `verify.mjs`, `verify-model.mjs`,
> `verify-desktop.mjs`, `verify-browser.mjs --page client-test`, plus `client-chunks.mjs` (regenerated: the core
> chunk changed). `verify-all.mjs` and `check-docs.mjs` were NOT run — the operator owns the full run, and this is
> the pass where that matters most: the parse guards only protect the suites' own spawn, and a broken launcher also
> breaks the operator's window.
>
> **Still owed:** DSH restart + page reload (the host half is unchanged in shape but the client chunk is), then on
> screen: 设置 → 部位 → 浏览… should open a scrollable, filterable list; and with AI 碎碎念 on, clicking the pet's
> `bust` (or any structure no part owns) should send that name — `/pet3d/say`'s response echoes `structure`, and the
> host logs the line it asked for.

> ## ✅ 2026-10-11 (thirteenth pass) — the parts became the USER'S, and a warning about how this file was nearly lost
>
> **What was asked:** "在设置页允许用户自己建立『部位』的标签，并把相对应的结构添加进来。给每个『部位』设置表情和碎碎念（如果是
> AI 模式则是 prompts）." The twelfth pass had shipped five FIXED regions (eye/head/hand/body/tail) matched by a
> name heuristic, and the operator's own models showed why that cannot be the last word: 蓝色小肥鱼 names its
> bangs `LiuHai`, its ahoge `DaiMao`, its ears `ErDuo` and its tail `WeiBa` — none of which the heuristic can
> place — while MikuNT's TWINTAILS are `TwinTail.*` and land in `tail`.
>
> **The model.** `preferences.parts.items` is a list of the user's own rows: `{ id, label, enabled, region, match,
> emotion, speech }`. A `match` entry is `{ name, exact }` — PREFIX by default (`LiuHai` covers `LiuHai.L.002`) and
> pinnable to EXACT — and `region` is only set on the five SHIPPED rows, which are matched by the heuristic. The
> order is the contract: explicit structures first, in list order, then the shipped row for the region the name
> suggests, then the body row, then `null` (a user who deleted every part gets no reaction, not an invented one).
> All five shipped parts are seeded from the LEGACY `expressions.emotion.parts` rows, so the operator's existing
> ticks moved into them instead of vanishing; that legacy table is gone from the cleaner (one question, one answer).
>
> **Speech grew a second trigger.** `SpeechMachine.react(preferences, part, stateEvent, …)` fires when a part is
> TOUCHED, with the chain **AI (that part's own prompt) → the part's own lines → the state's own lines → silence**.
> The shipped TABLE is deliberately not in it: answering a touched ear with 开始干活了 is a non-sequitur. A part
> nobody configured says nothing AND asks the host for nothing; `PRESS_LIMITS.reactGapSeconds` (3 s) is the floor
> between two reactions — much shorter than the idle gap, because touching the pet is a direct request. A DRAG
> says nothing at all (the pet is being carried, not patted).
>
> **Three surfaces, one chain.** The app's widget owns a `SpeechMachine`; the floating window has none, so it
> picks from the same `core.pickLine`/`core.customSpeechLines` itself and, in AI mode, POSTs `/pet3d/say` with the
> part id — the window's pet can be clicked while the app's pet is elsewhere on the desktop, so its throttle and
> its local line are its own. The host resolves a request's instruction through `speechPromptFor`: the part's own
> prompt, else the state's, and a stale id falls back to the state rather than failing a page that was left open.
> `/pet3d/model-info` grew the STRUCTURE list (every node, mesh and material name, kinded and capped) because a
> picker has to offer what the model actually has; `/pet3d/state`'s `touch` now carries `part` and `label` too.
>
> **⚠️ INCIDENT — README.md was damaged by the agent, and this is how.** Updating the doc COUNTS, the agent wrote
> the file with `Get-Content -Raw` + `Set-Content -Encoding utf8` instead of the UTF-8-safe edit tool. Windows
> PowerShell read the file as cp936 and wrote it back as UTF-8, so every non-ASCII character was double-encoded,
> 198 of them lost a byte to a `?` replacement, and four eaten newlines joined four pairs of lines.
> **Recovered:** the double encoding was reversed at the BYTE level (re-encode as cp936 to get the original bytes),
> which restored everything except those 198 spots; 129 were em dashes (`E2 80 ??` between words, certain), 15 more
> were resolved by SELF-CONSISTENCY (a repaired character whose neighbourhood also occurs elsewhere in the file),
> and 54 whose surrounding prose is unique were left as a visible `?` and then filled by hand from context in the
> same session — the file now has no replacement characters and only the three legitimate `?` query strings.
> **Still verify it:** open `README.md` and skim for a `?` that should be a Chinese character; the four suites are
> asserted by `check-docs.mjs`, so a lost COUNT would fail loudly, but a lost word would not.
> **The rule this leaves behind: never rewrite a tracked text file through PowerShell's text cmdlets.** Use the
> edit tool, or Node with explicit UTF-8 — the harness keeps a pre-edit capture for the edit tool and none for a
> shell write, which is exactly why this was recoverable only by hand.
>
> **Counts moved:** 1561 → 1661 (core 801→863, host 430→450, client 85 unchanged in NUMBER but one obsolete check
> was REMOVED and a press-speech check added, desktop 177→196). The removed check is named in `client-test.js`
> with its reason: "the placeholder turns its head" measured the PROCEDURAL avatar, which stopped shipping on
> 2026-10-10, and it had been passing on load timing alone. The desktop +4 are the 部位 editor's own gestures,
> driven in the real window (see next block).
> **Run per `AGENTS.md`:** `verify.mjs`, `verify-model.mjs`, `verify-desktop.mjs`,
> `verify-browser.mjs --page client-test`, plus `client-chunks.mjs` (regenerate, then `--check`). `verify-all.mjs`
> was NOT run, and `check-docs.mjs` was NOT run either — the counts were updated by hand and should be checked by
> the operator's full run.
>
> **One more round on the same pass (still 2026-10-11, after the count update).** Checking the objective clause by
> clause turned up a real GAP: the 部位 editor was asserted for "add a part / add a structure / toggle its mode /
> remove the chip", but the objective also promises **命名** and **删除** — the label box and the 删除 button were
> neither of them driven. Both are now, in `desktop/main.js`'s `probePartsEditor`: the label is rewritten to 刘海
> and read back, the part is deleted and the count returns to five, and the structure `<datalist>` is read back
> too (options > 10, with anatomical names among the samples) so "filled from the model" is asserted on the element
> a user types into rather than on a count. Two traps worth naming: **a stray BACKTICK inside an injected
> `executeJavaScript` comment** ended the template literal in `desktop/main.js` early, so the page received
> `pet3d/model-info` as a bare expression and the probe reported "pet3d is not defined" — `node --check` cannot see
> that, exactly like the `THREE`/`core` module-scope traps in `lib/pet3d.js`; and the probe must count parts from
> the DOM, because the page's published state is republished on a poll and answers with the PREVIOUS moment.
>
> **And the live app is still the OLD code — measured, not assumed.** With DSH untouched since before this pass,
> `GET /pet3d/model-info?m=m4` answers without a `structures` key and `GET /pet3d/settings` answers with a
> `preferences` object that has no `parts`. So nothing about this feature is live yet: the operator's restart is
> what turns it on, and the checks in the block above are the ones to repeat afterwards.
>
> **Live pass still owed:** the parts editor and the press speech have only run in suites. On screen, the first
> things to look at are: 设置 → 部位 shows five rows and a filled structure picker; adding `LiuHai` to a part makes
> a press on the bangs report that part (`/pet3d/state`'s `touch.part`/`label` name it); and in AI mode a press
> sends that part's prompt (the host logs the request).

> ## ✅ 2026-10-11 (twelfth pass) — 点击 vs 拖动 gets two bounds, and a press now knows WHICH PART it hit
>
> **The question that started it:** "模型互动上，现在能否区分点击和拖动？" The honest answer was *only by movement,
> with zero tolerance*: any `pointermove` at all — one pixel of hand shake — was a drag, so the click reaction was
> unreachable for anyone whose hand is not perfectly still. And the second question — "能否检测到点击的位置是模型的
> 哪个内置结构的名字？" — had the answer *no*, because the hit test is a framebuffer alpha readback (`gl.readPixels`
> in `lib/desktop-page.js`), which knows a pixel was painted and nothing about geometry.
>
> **1. Two bounds, and they answer two different questions.** `core.PRESS_LIMITS` (shared by both surfaces, asserted
> by name):
>
> * `moveThreshold: 4` px — the same slop the SECONDARY button already had (`VIEW_DRAG_THRESHOLD`). Below it the
>   pet does not move and nothing reacts; crossing it is the drag, and the grab is re-anchored at the ORIGINAL press
>   point so the pet catches up in one step instead of lagging by the slop for the rest of the drag. What the
>   threshold absorbs is the JITTER, not the movement — the first version re-anchored at the CURRENT point, which
>   swallowed the whole first move (the probe caught it: a single 40 px move produced zero displacement).
> * `holdSeconds: 0.6` — a press that stays put for long enough becomes a **长按** and reacts WHILE it is still
>   down, because a pat that answers only after the user lets go reads as a late click. Distance separates click
>   from drag; TIME separates click from hold.
>
> A press that neither wanders nor waits is a click, decided on release — and pressing and holding no longer
> produces a click on release as well. The gesture vocabulary is now `idle / drag / click / hold`, and the settings
> page grew a **长按时** row for free because the table is built from `core.EMOTION_TRIGGERS`.
>
> **2. The part is measured with geometry.** `Scene.anatomyAt(x, y)` raycasts the avatar
> (`THREE.Raycaster`, and `SkinnedMesh.raycast` honours the posed skeleton — measured: the vendored three is
> **r186** and calls `applyBoneTransform`), then takes the dominant bone of the hit triangle **by skin weights**,
> not by nearest bone: a coat or a skirt is skinned to the hips while hanging far away from them, so nearest-bone
> names the wrong part on exactly the models where it matters. `leftEye`/`頭`/`Hair`/`Tail` map through
> `PART_PATTERNS` into the stable vocabulary `core.PART_REGIONS` = **eye / head / hand / body / tail**, and anything
> unmatched falls to `body` — an honest answer, not a guess.
>
> **3. The per-part reaction chain**, in the same spirit as the 碎碎念 boxes: a region whose row names at least one
> emotion answers the press, and a region whose row names none **falls through** to the generic `click`/`hold` row.
> All five part rows ship EMPTY, and an empty row is the 无 choice — so a profile that predates body parts behaves
> exactly as it did. The settings table now shows nine rows (four triggers + five parts) and one shared builder, so
> the two cannot drift.
>
> **4. The press is diagnosable from outside.** `scene.lastInteraction` (reason, region, bone, mesh) travels: the
> app publishes it in the state it already posts (`/pet3d/state` grew `touch`, sanitised and capped), the window
> publishes it in its own readout and the launcher relays it (`/pet3d/desktop`'s `page.touch`). "I clicked its eye
> and nothing happened" now has an answer: the press landed elsewhere, or that region's row names no emotion.
>
> **Two traps this pass hit, both worth remembering.** `THREE` is NOT a module-scope name in `lib/pet3d.js` — it
> arrives per Scene as `this.THREE` — so a `new THREE.Vector3()` at module scope threw while the script was loading
> and the client probe reported "core, scene and client are all loaded -> false"; `node --check` cannot see that.
> And the window's threshold was first measured in `clientX`, which is wrong for a window that MOVES with the pet —
> the probe's anti-lag case (events carrying deliberately wrong client coordinates and the true screen position)
> caught it.
>
> **Counts moved:** 1532 → 1561 (core 786→801, host 422→430, client 80→85, desktop 177→178). **Run per
> `AGENTS.md`:** `verify.mjs`, `verify-model.mjs`, `verify-desktop.mjs`, `verify-browser.mjs --page client-test`,
> and `client-chunks.mjs` (regeneration, then `--check`). `verify-all.mjs` was NOT run.
>
> **Unproven on screen:** the raycast has only ever run against the committed fixture (an unnamed, unskinned mesh
> that maps to `body`, plus the renamed-mesh case that proves the mapping). On a real VRM it should name
> `head`/`leftEye`/`leftHand`; that is the first thing to look at, and `/pet3d/state`'s `touch.bone` is where the
> answer appears.

> ## ✅ 2026-10-11 (eleventh pass) — 试一句 said "the model produced nothing", and the truth was in a field I read wrong
>
> **The report:** DSH Provider selected, DeepSeek Account → `deepseek-flash`, persona written, 试一句 → 生成 →
> 「失败：模型没有给出可用的一句话」. Reproduced live over the route: `GET /pet3d/say?event=working` answered in
> **1130 ms** with `text: null` and that message.
>
> **Two defects, and the second is the one worth remembering.**
>
> 1. **The terminal chunk was read WRONG.** `ctx.llm.stream` ends with `{ type: 'finish', reason: { kind, failure? } }`
>    — the kind lives INSIDE `reason`, which is what `BlockAssembler` itself reads (`this._finish = chunk.reason`,
>    measured in the installed `app.asar`). The host read `chunk.kind`, which is always `undefined`, so **every**
>    stream failure (AUTH, QUOTA, RATE_LIMIT, an abort) was silently treated as a successful stream with no text and
>    reported as "the model produced nothing". The README's prose ("失败为 `{ kind: 'error', failure }`") describes the
>    REASON object, not the chunk — and the suite could not catch it because its stub stream was built from the same
>    wrong assumption as the code. The stub now speaks the real shape, and that is asserted.
> 2. **The budget was spent on THINKING.** `dsh-llm-deepseek` resolves the reasoning effort to `high` when the
>    caller says nothing (`options.reasoningEffort ?? connection.defaults.reasoningEffort ?? … : "high"`), and
>    `max_tokens` is billed against the thinking as well as the answer — at **64** the stream can end `max-tokens`
>    with no visible text at all. DSH's own precedent for an auxiliary short call is right there in the adapter:
>    `options.purpose === "session-title" ? "off" : …`. A 碎碎念 is that same kind of call, so it now asks for
>    `reasoningEffort: 'off'` and 256 tokens, both asserted by name (nothing else in the tree can see them).
>
> **A refusal now says what arrived**, because "the model produced nothing" has four causes a user cannot tell
> apart: `finish=max-tokens；思考 24 字；正文 0 字；分片 reasoning-delta×1 finish×1`. A stream that FAILED is a
> failure even when it emitted text on the way down — half a sentence from a request that never finished is not
> something to put in the pet's mouth. The custom (OpenAI-compatible) path reports its own shape the same way:
> `HTTP 200；choices=1；finish=stop；正文 0 字`.
>
> **Counts moved:** 1525 → 1532 (host 415→422). **What was run, per `AGENTS.md`:** `verify-model.mjs` (the suite
> for `lib/index.js`) and `client-chunks.mjs --check`. `verify-all.mjs` was not run.
>
> **Unproven on screen:** the fix needs a **DSH restart** (host half). If 试一句 still fails after it, the message
> now names the reason — and the two candidates it will separate are an exhausted budget (fixed) and a terminal
> failure the old code was hiding (e.g. an account quota, which the account adapter reports as
> `ACCOUNT_QUOTA_EXCEEDED`).

> ## ✅ 2026-10-11 (tenth pass) — the verification SCOPE rule, and the port flake that proves why it exists
>
> **The operator's instruction:** "任何任务完成后，只跑局部验证。用户会把控全量验证的时机." Written up as
> `AGENTS.md` — a workspace instruction file, so a session that has read nothing else still gets it right — with
> the change→suite table, the two things "partial" never means (a change with no run behind it, and skipping
> `node scripts/client-chunks.mjs --check`), and the rule that a report NAMES the suites it ran instead of claiming
> "all green". `AGENTS.md` is also in `check-docs.mjs`'s `DOCS` list, so a rule that quotes a suite which no longer
> exists fails the docs check like any other stale citation.
>
> **The pass immediately earned its keep.** Running `node scripts/check-docs.mjs` — the local suite for a
> documentation change, because it is what recomputes the counts — red with five failures whose cause was one
> line: `verify-desktop.mjs` started its page server with a bare `listen(0)`, the OS handed it port **6669**, and
> Chromium refuses that port (`ERR_UNSAFE_PORT`). The window never loaded, the suite reported `null` for its own
> count, and every count assertion downstream failed. Every other suite already used `scripts/loopback.mjs`'s
> `listenOnUsablePort` — this was the last raw `listen(0)` in the tree, and it is now gone. The failure mode is
> documented in the helper's own header; it had been read as "the settings page did not render".
>
> **Counts:** unchanged — **1525**, desktop 177. The port fix adds no assertions; the docs suite's OWN figure moved
> 174 → 199 (it was already stale by three, and the row is the one figure nothing verifies: see the paragraph under
> the README table, which now says where 199 comes from).
>
> **What was run, per the rule:** `check-docs` once (it found the flake), `verify-desktop` twice (red on the flake,
> green after the fix). **`verify-all.mjs` was deliberately NOT run** — that is the operator's call.

> ## ✅ 2026-10-11 (ninth pass) — 碎碎念: the user's own lines per state, and an AI that writes them
>
> **The request:** "给碎碎念加上设置，加上工作状态的选项，在每个工作状态下，允许用户输入碎碎念的字符串，一行一个，根据
> 当前的工作状态随机调用显示；或者使用AI碎碎念，允许用户调用LLM每次随机生成碎碎念（包括DSH Provider和自定义
> Provider），允许用户设置当前桌宠模型的人格信息（灌入system prompts）以及不同工作状态的碎碎念生成prompts."
>
> **Three layers, and they answer the three questions a user actually has.** The switch and the three timing
> numbers were already there; what this pass adds is (2) WHAT IT SAYS — one box per state, **one line per line**,
> drawn at random when that state is entered — and (3) WHERE THE LINE COMES FROM: 内置短语 / 自定义短语 / AI 生成.
>
> **The state/event bridge is the one design decision worth knowing.** The user asked for a box per STATE; the
> machine fires on EVENTS. `core.SPEECH_STATE_FOR_EVENT` is the only place the two meet: both 等待确认 events (a
> question and an approval) read the ONE `waiting` box, and the periodic idle remark reads the `resting` one — so
> a user never has to learn that "需要授权" is filed separately from "我有问题要问你". A box that is EMPTY falls
> through to the shipped table, which is what makes "customize 工作中 and leave the rest alone" work instead of
> silencing the pet.
>
> **The fallback chain is AI → the state's own box → the shipped table** (the operator chose this over "AI or
> silence"): a model that is slow, refused, rate-limited or unreachable costs the pet a sentence, never its voice.
> The machine shows the fallback IMMEDIATELY and lets the answer replace it, so a bubble appears on the state
> change and simply gets better a moment later.
>
> **Where the model call happens, and why it is the host.** `POST /pet3d/say` builds the request and makes it: the
> custom provider's key and DSH's own routes are host-side facts, and a page holding the key would put the
> credential in the DOM of every surface. The request is the **persona (system), the fixed rules, and the state's
> own instruction (user turn)** — nothing else. That is the privacy rule the built-in lines already followed,
> asserted ON THE WIRE in `verify-model.mjs` against a stub provider that records the body: the code that builds the
> request has no reference to any session text at all, which is why the rule survives being handed to a model. The
> answer is sanitised at the same boundary the bubble uses (one line, trimmed, capped at 80).
>
> **DSH's own provider** goes through `ctx.llm` — `ctx.llm.stream({provider, model, system, messages, temperature,
> maxTokens, reasoningEffort, purpose, signal})`, consumed as `text-delta` / `reasoning-delta` chunks. **This block's
> first claim about the terminal chunk was WRONG** — it said the finish was honoured by reading `chunk.kind`, and the
> real protocol puts the kind inside `reason` (`{ type: 'finish', reason: { kind, failure } }`); see the ELEVENTH
> block, which found it against the live route and fixed it. The service
> is looked up LAZILY, so a composition with no LLM adapter is legal and reports itself honestly in `/pet3d/llm`.
> **The custom provider** is any OpenAI-compatible `POST {baseUrl}/chat/completions` with a bearer key.
>
> **The settings page** grew a 台词来源 picker, six collapsible boxes (each holding that state's lines AND its
> generation prompt), the AI half's provider/URL/model/key/persona/temperature/timeout controls, and a **试一句**
> button that answers even while the source is `builtin` — it is how a user finds out whether their key, URL,
> provider or prompt works. The credential travels in the settings snapshot because the operator chose that
> ("跟其他设置一起存在 pet3d-settings.json"); the suite asserts the FIELD is never published in the page's own
> readout and never appears in the state channel. **No time-based rate limit:** 每句显示 can legitimately be one
> second, so a floor would refuse the second line of a fast user — what is refused is a second call while one is
> still running.
>
> **Counts moved:** 1410 → 1525 (core 732→786, host 363→415, client 79→80, desktop 169→177). The client probe
> covers the whole AI path in a real DOM (four frames of one event produce exactly ONE `POST /pet3d/say`, the
> fallback stays up, the answer is what the bubble then says) and the desktop suite covers the settings section.
>
> **Unproven on screen:** all of it. The host routes need a **DSH restart** (`/pet3d/say`, `/pet3d/llm`), the
> client half a page reload, and the settings page is served fresh on every open — so the first thing to do is
> restart, then open 模型参数 → 碎碎念 and press 试一句.

> ## ✅ 2026-10-11 (eighth pass) — the motion readout stops hiding WHICH failure it is
>
> **Found by measuring the running app rather than reading it:** `GET /pet3d/motions` listed six clips while
> `GET /pet3d/desktop` answered `motion: {mapped: {}, available: [], …}` — and nothing in that answer could say
> whether the host had served the route at all or whether no clip was mapped to any state. It was the second:
> `pet3d-settings.json` carries `"motions": {}`. The pet therefore had no authored motion to play and no
> readout that said why.
>
> **The cause is a copy list, exactly like `status.scale` before it.** `lib/desktop-page.js` publishes four
> answers to "why is my clip not playing" — `offered` (how many clips the page's own catalog holds), `routed`
> (whether `/pet3d/motions` answered at all), `available` (which of the mapped clips can drive THIS avatar) and
> `reason` (what went wrong loading one) — and the launcher's `announce()` rebuilt that object naming only the
> last two. Both are relayed now, and an older page that does not publish them reports `null` rather than a
> lie, which is the rule `scale` already followed.
>
> **Counts moved:** 1407 → 1410 (desktop 166→169). The three new assertions are source assertions by name,
> the only kind available for a launcher that Electron runs rather than the suite: the two relayed fields, and
> that the page still publishes both, so the copy list cannot outlive its source.
>
> **Unproven on screen:** the fields themselves — launcher code, so a DSH restart, after which
> `GET /pet3d/desktop` should read `offered: 6` and `routed: true` beside the empty `mapped`/`available`.
> **A note on this file's dates:** they run a day ahead of the machine clock that writes them (this block was
> written at 2026-10-10 08:5x local), so line up sessions by the newest source mtime, not by the heading.

> ## 📌 2026-10-11, the whole session in one screen (start at ▶START HERE for tomorrow's list)
>
> Seven passes in one day, each with its tests, its docs and a green `verify-all`. **1358 → 1407 checks.**
>
> | # | What it changed | Block |
> |---|---|---|
> | 1 | the floating window's OWN size (`windowSize`), its parked corner surviving, the 任务完成 window following the 状态 持续时间, `status.scale` relayed | first |
> | 2 | 面板统一化: `panel.js` is the only panel definition, delivered to the app as a fifth chunk | second |
> | 3 | 碎碎念: the pet's own bubble on both surfaces, with a phrase table, a throttle and the privacy rule asserted | third |
> | 4 | 模型导入: the settings page's card — native picker, typed fallback, imported list, 移除 | fourth |
> | 5 | a crash I introduced in 3 fixed: an optional symbol must cost the FEATURE, not the pet; an absent state CLEARS the prompt (§42) | fifth |
> | 6 | 任务达成 gold+bold / 出错 red, and both notices now WAIT for the user instead of expiring (等待确认 for the answer, the notices for "back in that session") | sixth |
> | 7 | 动作导入: the motion route finally has its UI, with its own dialog title and a re-render of the 状态 checkboxes | seventh |
>
> **All four of §24's feature items are done, and both import pairs (model + motion) have interface AND UI.**
> Everything is offline-green; the live pass is the one thing left, and the ▶START HERE section says exactly which
> half of the running app is already updated so it does not get re-tested.

> ## ✅ 2026-10-11 (seventh pass) — 动作导入: the motion route gets the UI it never had
>
> The operator asked "模型和动作的导入接口和界面做好了吗?" and the honest answer was: **the model pair was finished,
> the motion INTERFACE was finished with no UI at all** — `/pet3d/motions` already accepted `{add}`/`{remove}`,
> refused non-directories and persisted to `pet3d-motion-dirs.json`, but the only ways to reach it were the
> profile's `motionDirs` config or a hand-made POST, while the 状态 section's own note told the user to "import
> that directory from the host" with nothing to click. This pass closes that gap.
>
> What was added, mirroring the model section deliberately (one pattern, two routes):
>
> * The settings window's **动作导入** card: 选择文件夹… (native dialog), 手动输入路径 fallback, the imported list with
>   **移除** per row, and the host's refusal text shown verbatim.
> * `desktop/preload.js` gained **`pickMotionDir`**, and `pet3d:pick-dir` now takes a `{kind}` so the launcher can
>   title the dialog 导入动作目录 / 导入模型目录 instead of calling every folder a model directory. One handler, two
>   entry points — launcher code, so a **DSH restart**.
> * The one thing genuinely different from models: a write's reply carries the rebuilt catalog, so a new clip
>   reaches the per-state CHECKBOXES (`renderMotions()`) rather than a dropdown — and if an older host replies
>   without `motions`, the page re-reads `/pet3d/motions`. A motion import is therefore visible in the 状态 rows
>   with no reload.
> * The misleading note inside 状态 is fixed: it now points at the section that can actually do the import.
> * `motionImport` is published beside `import` (`controls`, `picker`, `dirs`, `clips`, `catalogFile`, `error`), so
>   the live suite can tell "no directory was ever imported" from "the section did not render".
>
> **Counts moved:** 1404 → 1407 (desktop 163→166). The host route was already covered by `verify-model.mjs`
> (GET/POST/refusals/removal over real HTTP) and the page's write path by the load suite's new assertions (its own
> writer, its own two verbs, the re-render, and no filesystem access in the page).
>
> **Unproven on screen:** clicking the new picker — launcher code, so a DSH restart, and a human.

> ## ✅ 2026-10-11 (sixth pass) — THE TWO NOTICES NOW WAIT, AND THEY ARE GOLD AND RED
>
> **The request:** "任务达成要用金色的加粗字体，任务失败/错误要用红色字体，一直持续直到用户切换回已经达成任务/失败
> 的会话中；同理，等待确认要让用户回答完问题/确认完权限后才消失."
>
> **The rule, as implemented** — three states end on an EVENT, and a 持续时间 may not hide any of them
> (`core.UNTIMED_STATUS_STATES`):
>
> | State | Ends when |
> |---|---|
> | 等待确认 / 需要授权 | DSH stops reporting the pending interaction (the user answered / approved) |
> | 任务达成 | the user is IN the session that reported it (`snap.currentSessionId === notice.sessionId`) |
> | 任务失败 / 出错 | the same |
>
> **How it hangs together.** The notice already carried a session id in the AGGREGATE (`notice.sessionId`,
> written by both the boundary path and the store-edge path); what was missing was the comparison. So:
>
> * `SessionAggregate.snapshot()` now publishes `currentSessionId` — the raw id, beside the existing
>   scope-qualified `sessionId`, because the notice's id has to be matched against it and a scope prefix never
>   would.
> * `PetMachine.resolve` clears a notice only when it has been up at least `noticeHoldMs` AND the user is
>   present in its session. Past the hold, an unacknowledged notice survives indefinitely — an hour, a day.
> * The hold is a FLOOR read from that state's own 持续时间 (`noticeHoldMs`, with `doneWindowMs` delegating to
>   it, and 出错 reading ITS OWN row rather than borrowing 任务完成's). With no session identity on either side
>   the older rules stand — a completion times out, a failure latches, and the focus rule clears it — so a host
>   without sessions (and every core test driving a bare snapshot) behaves as before.
> * **A dismissed notice must stay dismissed**: the aggregate keeps offering it in every snapshot, so the
>   machine records `dismissedNoticeAt` and refuses to re-adopt it. Without that watermark the prompt came back
>   on the very next frame — which is what the first version of this change did.
> * `boundary(turn/start)` now only supersedes ITS OWN session's notice: work continuing in B is precisely the
>   case the new rule exists for, and erasing A's completion there would defeat it.
> * The tone: `core.STATUS_TONES` (done → `gold` + bold, error → `danger`) is reported by `statusFor`, both
>   surfaces write `data-tone`/`data-bold` and style them in their own palette, and the launcher relays
>   `status.tone`/`bold` so `/pet3d/desktop` can answer "is it gold?".
> * The settings page DISABLES 等待确认's 持续时间 field (a number that can never take effect is worse than no
>   field) and says what the other two now mean; `statusTiming` publishes all of it for the live suite.
>
> **Counts moved:** 1358 → 1404 (core 692→732, client 78→79, desktop 158→163).
>
> **Verified in a real browser, on both surfaces:** the app's prompt computes to `rgb(138, 90, 0)` at weight
> 700 for 任务达成 and `rgb(179, 38, 30)` for 出错, against the ordinary blue at weight 500; the window's
> computes to `rgb(255, 201, 77)` / `rgb(255, 107, 107)` and publishes the tones. The persistence is asserted
> through the REAL chain (aggregate → snapshot → machine): a completion in A stays up for an hour while the
> user is in B, clears when they switch to A, and does not come back afterwards.
>
> **Unproven on screen:** all of it — client-half code, so a page reload (and a DSH restart for the launcher's
> relayed `tone`).

> ## 🔴 2026-10-11 (fifth pass) — THE FLOATING PET FROZE ON 工作中, AND IT WAS A CRASH IN THE APP HALF
>
> **The report:** "独立桌宠再次没有收到任务完成的提醒，甚至现在已经结束了…还在显示'深度求索中…'"
>
> **What was actually true, from two HTTP requests (no guessing):**
>
> * `GET /pet3d/state` → `{"seq":53,"state":null,"at":<16 min ago>,"error":"TypeError: this.core.SpeechMachine is
>   not a constructor at new Pet3DWidget (…client.js&rev=c7a693d3c03f:704:19) …"}` — the IN-APP pet was DEAD.
> * `GET /pet3d/desktop` → `page.status.text = "深度求索中，用时 23分1秒 ···"` — the window was faithfully drawing
>   the last state it had ever been told, and counting the clock up.
>
> **Root cause, and it is this session's own regression:** the app loaded the NEW `lib/client.js` (which builds
> `new this.core.SpeechMachine(...)` in its constructor) against a core chunk that did NOT have that symbol —
> either the disk chunk had not been regenerated yet at the moment the page was loaded, or the browser served a
> cached copy under an unchanged revision. The widget therefore never mounted: no pet in DSH, no state
> publication, and the floating window had nothing to follow. The 任务完成 notice was never lost in transit —
> the app never sent anything again.
>
> **Two defects, two fixes (both with tests):**
>
> 1. **An optional symbol must never kill the pet.** `SpeechMachine` is now built only when the core has it
>    (`this.speechMissing` records the absence), and the shared panel module is checked rather than required —
>    `panelAvailable` plus guards on every panel-dependent path (`applyStrings`, `bindPanel`, `syncControls`,
>    `togglePanel`, `setPanelOpen`, `buildMotionRows`, `populateModels`). The `throw new Error('pet3d:
>    lib/panel.js is not loaded.')` is GONE. A stale chunk now costs the voice or the panel, never the pet.
>    *Probe:* "a stale delivery costs the voice and the panel, never the pet" deletes both globals, builds a
>    widget, ticks a frame, and requires it to mount.
> 2. **"No state" must clear the prompt, not freeze the last one.** The window's host channel used to
>    `if (typeof state !== 'string' || !state) return;` — an invalid/null state was IGNORED, so the previous
>    prompt stayed up for ever (seventeen minutes of 工作中 in this report). Both the host arrival and the
>    probe's `setState` now go through ONE `applyHostState`, which treats an unknown state as NO state: prompt
>    cleared, bubble cleared, `state: null` published. *Probe:* the desktop-page check now asserts a null state
>    clears the prompt AND that a live prompt came back before it (`status.noState` in the report).
> 3. **The launcher now relays the page's own view of the state** (`state: {drawn, published, at, error}` in
>    the announce payload, so `/pet3d/desktop` carries `page.state.*`). This is a LAUNCHER change — a DSH
>    restart — and it is what makes this exact question answerable from one request next time: the host's
>    state and the page's state are different facts, and the fixed field list had hidden the second one.
>
> **Counts moved:** 1357 → 1358 (client 77→78).
>
> **Read this twice (new gotcha, §42):** `lib/client.js` and the chunks it loads (`client.core.js`,
> `client.panel.js`) are delivered SEPARATELY under the same revision. Editing one and reloading before the
> other is in step produces exactly this failure — and the pet disappears with a TypeError that only shows up in
> `/pet3d/state`. Always: edit → `node scripts/client-chunks.mjs` → THEN reload; and hard-reload (Ctrl+Shift+R)
> when a chunk changed, because the URL's revision does not change with the file.
>
> **Still unproven:** the fix on screen. The operator's running app is the pre-fix build; a reload (or restart)
> is required, and after that `/pet3d/state` should read `error: null` with a state that follows the turn.

> ## ✅ 2026-10-11 (fourth pass) — 模型导入: the UI the backend was waiting for
>
> The last of the operator's four feature items. The BACKEND has been finished and tested since §21 (a
> plugin-owned `pet3d-model-dirs.json`, `/pet3d/models`' `{add}`/`{remove}` with refused paths, a catalog rebuilt
> on every request); what was missing was any way for a user to reach it. The settings window's new **模型导入**
> section is that way:
>
> * **选择文件夹…** opens a NATIVE folder dialog. A web page cannot, so the LAUNCHER exposes it:
>   `desktop/preload.js` gained `pickModelDir` (`pet3d:pick-dir`), `desktop/main.js` handles it with
>   `dialog.showOpenDialog`, and **the settings window now gets the preload too** — it previously had none, which
>   is why this needed a launcher change (a **DSH restart** for it to be live).
> * **手动输入路径** is the fallback when there is no bridge (the page opened as a browser tab, or an older
>   launcher): it reveals a path field rather than failing silently.
> * The section lists what is already imported, each row with a **移除**, and shows the host's own refusal text
>   (`no such directory: …`, `not a directory: …`) verbatim — the honest failure the route already produced.
> * **The page never writes the list.** The chosen path goes back to the host over `/pet3d/models`, so the host
>   stays the single writer and `PET3D_MODEL_DIRS_FILE` (gotcha 37) keeps every suite off the operator's file.
>   `check-plugin-load.mjs` asserts exactly that, plus the preload/handler pair.
> * An import is live immediately (the catalog is rebuilt per request, and the page re-reads it), and the page
>   publishes `import: { controls, picker, dirs, modelCount, catalogFile, error }`, so the live suite can tell
>   "the section did not render" from "the host did not answer".
>
> **Counts moved:** 1354 → 1357 (desktop 155→158). Nothing else changed.
>
> **Still unproven:** the picker in a real window. The section renders live (asserted), but the dialog itself
> needs the DSH restart and a human to click it.
>
> **With this, all four of §24's feature items are DONE** (碎碎念, multi-clip motion, panel unification, model
> import). What is left in this file is the 小尾巴 list below and the live pass.

> ## ✅ 2026-10-11 (third pass) — 碎碎念: the pet talks, in both surfaces
>
> The last of the operator's four feature items except 模型导入 (§24 item 1). One chain, four links:
>
> * **`lib/core.js` owns the words and the throttle.** `SPEECH_LINES` is a zh/en table keyed by EVENT
>   (working / done / error / waiting / approval / offline / idle), `speechEvent` maps a state plus DSH's
>   `pendingKind` onto one, and `SpeechMachine` is the stateful part: one line at a time, held for
>   `holdSeconds`; a NEW event speaks at once; the SAME event never repeats while it is running (returning to
>   an idle state clears that memory, so the next turn speaks again); an idle remark waits for a gap drawn once
>   from `idleMin..idleMax` and for `minGapSeconds` since the last line; an unknown state is SILENCE. The clock
>   and the random are injected, so the core suite drives an hour of behaviour with no waiting.
> * **The PRIVACY RULE is asserted, not trusted.** A bubble may only ever contain a line from that table — no
>   code, paths, file names, model output or error text. The client probe drives the app's own bubble with a
>   session id in hand and asserts the id never appears, and core asserts no shipped line can carry a path.
> * **The app decides, the window draws.** The in-app pet (`lib/client.js`) runs the machine, draws
>   `.pet3d-speech` above the status prompt (offset by the prompt's measured height), and publishes the line
>   WITH the state; `lib/index.js`'s `/pet3d/state` flattens it to one line, caps it at 80 chars, clears it on
>   a report that names none, and serves it back; `lib/desktop-page.js` draws its own bubble from the poll body
>   and reports `speech` in `rect`, and `desktop/main.js` unions that rectangle into the window's bounds WITHOUT
>   adding it to the hit test — the window grows to show the bubble, and the bubble stays click-through.
> * **Settings.** A new 碎碎念 section in the settings window: on/off, 每句显示, 最短间隔 and the idle window,
>   all written through `core.cleanSpeech` so what is stored is what the renderer reads back.
>
> **Counts moved:** 1303 → 1354 (core 652→692, host 357→363, client 75→77, desktop 152→155). `lib/client.core.js`
> was regenerated. New load-suite assertions hold the four links of the chain in place.
>
> **Trap worth remembering, and it bit once during this pass:** `SPEECH_LIMITS` briefly had no `lineLength`,
> which made the relay `slice(0, NaN)` and send an EMPTY line — a silent "the pet says nothing" that only the
> core check caught. Anything the relay reads out of a limits table needs its own assertion.
>
> **Still unproven:** the bubble on screen. Client-half (the bubble itself, the settings section) needs a page
> reload; the launcher's `speech` field and the window's grown bounds need a **DSH restart**.

> ## ✅ 2026-10-11 (second pass) — PANEL UNIFICATION: one panel, both pets
>
> The 2026-10-08 debt (§14/§15 item 3) is paid: `panel.js` is now the ONLY definition of the settings
> panel, and BOTH surfaces build from it.
>
> * **The floating window uses `createPanel`.** `lib/desktop-page.js`'s hand-rolled `buildPanel`/`refreshPanel`/
>   `wirePanel` are gone: the page passes `panelCallbacks` (one per row it wants) and gets rows, labels,
>   wiring and `sync` from the shared module. Its own leftovers are the two things the module cannot know —
>   the hint line, and the `pointerdown`/`contextmenu`/Escape guards. `role()` now maps row names to the
>   shared CLASSES via `PANEL_SELECTORS`, so a renamed class fails loudly instead of silently.
> * **The app overlay builds its markup from the same file.** `panelMarkup` (a new export) renders its panel
>   rows, and `panel.js` is delivered to the app as a fifth client chunk (`client.panel.js`) — the app
>   can only load `client.<name>.js`, so the window reads `panel.js` directly and the app reads the
>   generated copy of the SAME file. `lib/client.js` now throws if the module is missing, like core and the
>   scene, instead of shipping a panel-less pet.
> * **New rows, shared:** the size row gained an optional `-`/`+` stepper (both surfaces now use it; the app's
>   stepper calls `zoomBy`, the window's calls `zoom`), the model row has a BUTTON variant (`modelCycle`) for
>   the window, which is created `focusable: false` and could never open a native dropdown, and the actions
>   row gained an optional `quit`. `setModelChoices` lets a surface fill the model row after the catalog
>   arrives, and `sync(preferences, extra)` now also takes `modelLabel` and writes EVERY size readout.
>   The app-only rows (显示位置, 作用范围, 隐藏, 动作) and the window-only ones (退出, the button model row) exist
>   only where a surface supplies their callback, so neither panel can own a control that does nothing.
> * **Two bugs found and fixed on the way.** (1) The desktop suite's stub host server did not serve `panel.js`
>   at all, so the live window's page would have failed with "lib/panel.js did not load" — the stub now serves
>   the whole whitelist, and `setPanel` throws that sentence by name instead of "Cannot read properties of
>   null". (2) `panel.module` is now published in the page's state and asserted in the live suite, so "the
>   panel came from the shared module" is measured in a real window rather than reasoned about.
>
> **Counts moved:** 1299 → 1303 (clientchunk 37→39 for the fifth chunk, client 74→75 for the shared-panel
> assertion, desktop 151→152 for `panel.module`). `node scripts/client-chunks.mjs` was re-run; the five chunk
> files are in step. New load-suite assertions hold the single definition in place (`check-plugin-load.mjs`).
>
> **Still unproven:** the panel on screen, and everything from the first pass below. A page reload picks up the
> client half; the launcher's `scale`/`panel.module` fields need a **DSH restart**.

> ## ✅ 2026-10-11 (first pass) — the three ▶START HERE items are done: the window's own size, the relayed `scale`, the extendable 任务达成
>
> **What changed** (each has a comment and a test at the place it matters):
>
> 1. **The floating window has its own size preference.** `core.DEFAULTS.windowSize`, cleaned beside `size` in
>    `cleanPreferences` — and the MIGRATION is the fallback: a profile with only `size` gives the window that
>    same value, so the operator's window does not move on the first run after this change. The window's
>    `Placement` reads it through a new `sizeKey = 'windowSize'` (`lib/client.js`), `lib/desktop-page.js` sizes,
>    zooms and labels from it, its `LOCAL_KEYS` carries `windowSize` and NOT `size`, and the settings window
>    gained a **悬浮窗大小** row (`lib/config-page.html` + `config-page.js`) beside the in-app pet's **大小**.
>    The page's own state readout now publishes `sizes` (`app`, `window`, `controls`), which is what the live
>    desktop suite asserts.
> 2. **`status.scale` is relayed.** The page has published it since the wheel-on-the-text gesture; the
>    launcher's fixed field list for `/pet3d/desktop` did not name it, so the correction was invisible from
>    outside. `desktop/main.js` copies it now, `scripts/verify-desktop.mjs` asserts the field list by name
>    (a launcher change needs a **DSH restart** to be live), and the client probe asserts the page's side of it
>    plus that it moves under a real correction.
> 3. **任务完成 can be extended.** `core.doneWindowMs(preferences)` = `max(NOTICE_WINDOW_MS, done.seconds*1000)`,
>    read through `PetMachine.preferencesOf` — a THUNK, because both surfaces replace their whole preference set
>    on every host snapshot and a stored object would freeze the first frame's settings. The 4.2 s window
>    stays the floor; before this, `resolve` was gated by the constant alone and the 状态 box could only cut it
>    short. The 状态 section of the settings page also documents the `{duration}` token and this rule.
>
> **Also found while in there, and FIXED in the same pass:** the floating window's POSITION never persisted.
> `lib/desktop-page.js` wrote `preferences.placementX`/`placementY` on every drag and read them at mount, but
> **two** separate omissions each put the window back in its default corner: `core.cleanPreferences` did not
> know the two keys (so the page's own `readPreferences` dropped them) and the page's `LOCAL_KEYS` did not name
> them (so every host snapshot answered without them). Both now carry them, `applyExternalPreferences` keeps the
> page's own position when the store has never been told one (`null` — a profile written before this), and the
> client probe asserts the whole loop: the parked corner comes back, a drag moves it, and the new position
> reaches both the page's storage and the host patch.
>
> **Counts moved:** 1269 → 1299 checks (core 626→652, client 73→74, desktop 148→151). `node scripts/client-chunks.mjs`
> was re-run, so `lib/client.core.js` is in step with `lib/core.js`. (The second pass above moved the total on
> again, to 1303.)
>
> **Still unproven:** the pet on screen with any of this. The page and the launcher are compiled and tested
> offline; the running app needs a page reload (client half) and a DSH restart (launcher half), and the
> operator's own live report is the only thing that can close that.

> ## ⚠️ 2026-10-09 17:00 — the APP WOULD NOT START. The cause was the CLIENT half, and it was one word.
>
> **The symptom, verbatim** (a modal dialog, and the app never opened):
>
> ```
> DeepSeek Harness 无法使用
> 应用无法启动或已意外停止。
> web boot: 1 entry did not activate
> dsh-plugin-pet3d: failed
> 诊断报告: …\crash-2026-10-09T09-00-21-946Z-web-boot.log
> ```
>
> **The cause, measured:** `lib/client.js`'s `apply` read a **bare `core`** —
> `var reporter = typeof core.createStateReporter === 'function' ? … : …`. `lib/client.js` is wrapped in
> `'use strict'`, `core` is declared nowhere in it (`lib/core.js` publishes `globalThis.__PET3D_CORE__`, and
> every other reader in the file goes through that global or through `this.core`), and `typeof` does not make
> a **property access** safe: `typeof core.x` evaluates `core` first. So `apply` threw
> `ReferenceError: core is not defined` before it registered anything.
>
> **Why that stops the whole application.** The host half only WARNS about an optional row that did not
> activate; the browser half does not. `@deepseek-ai/dsh-web-frontend`'s boot runner walks every Loader entry
> after settling and throws `web boot: N entries did not activate` if any entry's fibre is not `active`
> (`eM()` in `dist/assets/index-*.js`), and the shell turns that into the modal above. One broken client
> plugin is therefore fatal to startup — not a missing pet, a missing app.
>
> **Reproduced offline, which is what pinned it:** evaluate `lib/client.js` with a stubbed
> `window.__ModuleLoader__`, take the registration it hands over, call `factory(require)` with a `react` stub,
> then `apply(ctx)` with a `slots` stub — the same three calls the shell makes, in the same order — and the
> old code threw `ReferenceError: core is not defined` at `lib/client.js:3416`, inside `apply`.
>
> **Why nothing caught it (the honest part):** the string `core` was only ever read inside `apply`, and
> nothing in this repository called `apply` on the client half. `scripts/check-plugin-load.mjs` said so in
> its own header ("Deliberately does NOT load `lib/client.js`"), and the one browser page that uses the REAL
> `@deepseek-ai/dsh-client-modules` loader says in its own comment that it "asserts delivery, it does not
> mount the widget". Ten suites, all green, on a build that could not start.
>
> **The fix** (`lib/client.js`): the reporter is now resolved on first use from
> `globalThis.__PET3D_CORE__`, behind `stateReporter()`. Lazy is not tidiness — `lib/core.js` arrives as a
> chunk that only *begins* fetching when the factory runs, so an eager read would always take the fallback
> and the floating window would silently stop following the pet. The fallback also gained `reportError`, which
> it never had: a reporter without it turned "the pet could not start" into a `TypeError` inside the catch.
>
> **The guard, so it cannot come back silently:** `scripts/check-plugin-load.mjs` gained a fifth section that
> does exactly the three calls above and asserts the script evaluates, the row is registered under the package
> name, the factory runs against the platform module table, `apply(ctx)` activates **with no core global yet**
> (the real activation-time state), and `shell.overlay` is claimed. Seven new assertions, all under
> `node scripts/check-plugin-load.mjs` (`pnpm run verify:load`, and `verify-all` runs it as `load`).
>
> **The pet is still absent, and that is a SECOND, unrelated fault — the profile.** The operator used the
> dialog's own recovery button (「禁用第三方插件、备份 profile patch 并重启」), which does what it says:
> measured, `cordis.patch.yml` was backed up at 16:59:36, `package.json` was rewritten at 17:00:27 with
> `dsh.profile.bundles` = `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app]` only, and the app then started
> (no further `web-boot` crash logs after 17:00:21). `dsh-plugin-pet3d` is still a *dependency*, so it is
> installed and linked — it is simply no longer in the bundle list, which is the only place that puts its
> `cordis.patch.yml` row into the composition. Repair and restart:
>
> ```bash
> node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
> node scripts/check-profile.mjs          # expect exit 0, or 2 = "reload/restart the page"
> ```
>
> **Unproven until the restart:** the pet on screen with this fix in the running app. Everything offline is
> green again — ten suites, `load` included, plus the new client-activation section.

> ## ⚠️ 2026-10-10 — "插件挂了" was the PROFILE, not the code. Read this before debugging anything.
>
> **The symptom:** after a restart the pet was gone, and the operator disabled the plugin to get the app back.
>
> **What actually happened** (measured, not inferred): the running DSH app WRITES the profile back to disk —
> `package.json` and the materialised `cordis.yml` — from the composition it holds in memory, and a **bundle
> its in-memory tree does not know about is dropped on the way out**. `dsh-plugin-pet3d` had been disabled in
> the manager; `package.json` was rewritten at **16:13:50** with the plugin no longer in
> `dsh.profile.bundles`; the next restart composed no `pet3d` row at all. `/pet3d/catalog` answered **404**,
> `shell.overlay` had no `pet3d` occupant, and there was nothing on screen to look at. The source tree was
> perfect the whole time — which is why **all ten suites stayed green**. Same class of trap as §5's
> "whichever pet you want active must be the one the manager knows about"; README's Install section now
> carries it too.
>
> **The repair** (applied, and confirmed: `/pet3d/catalog`, `/pet3d/settings` and `/pet3d/state` all answer
> 200 again):
>
> ```bash
> node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
> node scripts/check-plugin-load.mjs --profile "$HOME/.dsh/profiles/desktop"   # expect PASSED
> ```
>
> **The new guard, so this is never a mystery again:**
>
> ```bash
> node scripts/check-profile.mjs        # pnpm run verify:profile
> ```
>
> It is the only check in the repository that looks OUTSIDE the source tree: the dependency, the
> `dsh.profile.bundles` entry, the `node_modules` link target, and then the RUNNING app —
> `/pet3d/catalog` (is the host half composed?) and `/pet3d/state` (is the client half alive?). Its exit code
> separates the three states: **0** all good, **2** profile fine but the page needs a RELOAD (the browser
> module table is built at page load), **1** the profile needs `install-desktop-plugin.mjs`, whose exact
> command it prints.
>
> **Also added in the same pass, so a client-half failure can never be silent again:** the client half now
> reports its own start-up failure to `/pet3d/state`, which carries it as an `error` field. A chunk that never
> arrives and a widget that throws while being constructed both report, so "the pet is gone" becomes a named
> cause readable with one HTTP request instead of a browser console nobody is watching.
>
> **Still unproven:** the pet on screen since the repair. The host half is verified live; the client half needs
> a page reload or a restart to mount, and `check-profile.mjs` reports exit **2** with `state: null` until it
> does — which is exactly "reload the page".

> ## ✅ 2026-10-09 21:10 — two one-line faults: the notice was never READ, and the push list forgot the correction
>
> **The report, verbatim:** "1.完成后的提示还是没有传到独立桌宠上；2.文字单独缩放后，再去缩放模型的时候，文字应该
> 是以缩放后的状态为基准再次缩放（本就是为了修正文字和模型大小不匹配的情况，文字调整好了，结果缩放模型的时候又恢复
> 原状了，这样就失去了意义）".
>
> Both are the same shape of mistake — a value computed on one side and never read on the other — and both were
> one line.
>
> ### 1. `PetMachine.resolve` only ever read its OWN notice
>
> The previous fix made `SessionAggregate.observeStoreEdge` write a completion notice from DSH's own `running`
> flag going false. It was correct, it was in the snapshot, and **the machine never looked at it**: `resolve()`
> read `this.notice`, which only a `turn/end` FRAME could set — and the frame is the channel that is not wired.
> So the aggregate said "completed", the machine said 工作中, and the window drew whatever the in-app pet
> published. Now `resolve()` adopts `snap.notice` when it is newer by `at` (both sources share one timeline; a
> latched failure still outranks an older completion, and the aggregate applies the same latch before writing).
>
> The core check that "proved" the previous fix called `machine.boundary(snapshot, {type:'turn/end'})` — i.e. it
> handed the machine the very frame production never gets. It now calls `machine.resolve(snapshot)` and nothing
> else, which is the whole point: **the snapshot alone must be enough**.
>
> ### 2. The window's push list had no `statusScale`
>
> Each surface sends the host store only the keys it owns, and the host merges them. `LOCAL_KEYS` in
> `lib/desktop-page.js` listed every preference the window edits except the new one — and `zoom()` writes
> through that same function, so the first wheel on the PET pushed a patch without the correction, the next
> snapshot answered without it, and the text snapped back to the derived size. That is precisely the operator's
> complaint: the correction was meant to survive the model being resized, and resizing the model was what
> destroyed it. `statusScale` is in the list now, and the in-app panel's `PANEL_KEYS` has it too.
>
> **Guards:** the core check above (the snapshot alone reaches `done`), the probe's wheel-gesture check now also
> asserts the PATCH a surface pushes carries the correction — `pushedScale: {"wheel-model":1.3}` — because the
> page's own copy never loses it, which is why this bug was invisible from inside the page; and
> `check-plugin-load.mjs` asserts both push lists name `statusScale` by name, with this failure written next to
> it. (A behavioural check for the window's list was tried and removed: stubbing `/pet3d/settings` made the page
> apply an empty snapshot mid-check and broke three unrelated checks — worse than the bug it was guarding.)
>
> **No DSH restart needed** — both are client-half fixes; reload the page, or restart only the floating window.

> ## ✅ 2026-10-09 20:30 — two wheel gestures for the prompt, and a line that never wraps
>
> **The request, verbatim:** "鼠标滚轮在提示文字上时，只缩放状态提示文字（防止某些模型和提示文字不匹配）；鼠标滚轮在
> 模型上时，提示文字和模型同步缩放；记住每个模型提示文字大小的偏好；提示文字永不换行".
>
> ### Wheel routing: the pointer decides, and the prompt had to be made hittable first
>
> The prompt's size is DERIVED from the pet's box, so a wheel on the pet already scaled both — that half needed
> nothing. The new half is the other one: a wheel ON THE TEXT corrects the text alone.
>
> * `lib/core.js` owns the correction: `DEFAULTS.statusScale` (`{ [modelId]: multiplier }`), `cleanStatusScale`
>   (clamped 0.35–4×, and **1 is dropped, not stored** — the map is a list of exceptions), `statusScaleFor`,
>   `setStatusScale` and `statusScaleStep` (the same 1.12× step as the pet's own zoom). `statusPromptFontPx` now
>   takes the correction as a second argument, so both surfaces still draw one size from one rule; the absolute
>   clamps are 6–160 px.
> * the in-app pet measures the prompt's own `getBoundingClientRect()` and compares it with the event's
>   coordinates. The prompt is `pointer-events:none`, so the event already arrives at the pet either way — the
>   cursor's position is what distinguishes the two gestures.
> * **the window needed a hit-test change, not just a handler.** Its prompt is DOM and nothing of it is painted,
>   so the launcher's per-pixel test answered "not mine" over the prompt and the page never saw a wheel there.
>   The prompt's rectangle now answers `hitTest` like the panel's does (`isOverStatus`, sharing one `insideBox`),
>   and the page listens on `body` as well as on the canvas — body, because that is the event's target over a
>   `pointer-events:none` prompt, and skipping canvas-targeted events so one notch is never counted twice.
> * the readout publishes `status.scale` next to `status.fontPx`, so "the gesture did nothing" and "the gesture
>   worked" are distinguishable from outside the window.
>
> ### 永不换行
>
> `white-space: nowrap` on the text in both stylesheets, and both `max-width` caps removed — the one in the
> stylesheet and the JS assignment in `placeHeadStatus`. A cap that assumed wrapping would have left the plate's
> own background narrower than the line it is behind. Length is bounded where it is TYPED instead
> (`STATUS_LIMITS.textLength`), which is the place a user can see the limit.
>
> ### The trap this walked into, and the suite that caught it
>
> `STATUS_SCALE_LIMITS` was first written with `step: WHEEL_ZOOM_STEP`, and that literal is evaluated near the
> top of `core.js` while `WHEEL_ZOOM_STEP` is assigned far below it: `var` hoisting meant the step captured
> `undefined`, the arithmetic produced `NaN`, and the gesture did nothing at all while every other check still
> passed. The core suite failed on exactly four assertions, which is how it was found; the step is read at CALL
> time now, with a comment saying why it cannot live in that literal.
>
> **Guards:** twenty new core checks (the step, the per-model isolation, the drop-at-1 rule, both multiplier
> clamps, the 6/160 px floors and ceilings, and the store round trip) and one new behavioural probe check that
> dispatches real `WheelEvent`s — one at the prompt's own rectangle, one at the pet's — and asserts that the
> first moves only the text while storing the correction against that model, that the second resizes the pet and
> leaves the correction untouched, and that the line's computed `white-space` is `nowrap`.

> ## ✅ 2026-10-09 19:45 — 任务完成 now comes from DSH's OWN running flag, not from an RPC that may not be there
>
> **The report:** "尾巴动了，但是任务完成之后并没有任何提示，显示还是深度求索中".
>
> **Two faults, one cause.** The pet's state had two inputs, and both were wired the wrong way round:
>
> 1. `SessionAggregate.running(id)` read the **boundary record first** and the store second. A record exists
>    only because a frame arrived, so a `turn/start` whose `turn/end` never follows — a dropped stream, or the
>    `ctx.remote.pet3d().watch()` upgrade channel simply not being wired for a plain-JavaScript plugin — pinned
>    that session at "running" for the life of the page: 工作中, with the clock still counting up under it.
> 2. The completion **notice** was written only by `SessionAggregate.boundary()` — i.e. only by that same RPC
>    stream. No stream, no 任务达成 and no 出错, ever.
>
> **The vocabulary was checked first, so the plugin's mapping was not blamed by mistake:** DSH's own
> `TurnEndReasonMap` (read out of the installed `app.asar`) is exactly
> `completed | aborted | blocked | error | max-tokens | interrupted | forked`, so `reason === 'completed'` is
> the app's own word for a finished turn and the bug was never a string mismatch.
>
> **The fix, in `lib/core.js`, using data the pet already has.** `useSessionStatus` hands the client half DSH's
> own status map — `{ running, pendingInteraction, completionUnread }` — and `running` flips false the moment a
> turn ends. That falling edge IS a finished turn, so:
>
> * `observeStoreEdge()` (called from `setInput`, i.e. whenever the store changes) watches each session's own
>   flag and writes a `completed` notice on `true → false`. No RPC needed, and it is the same edge the app's
>   session list uses to stop a row spinning;
> * a rising edge clears that notice, exactly as a `turn/start` frame does;
> * subagents are skipped, exactly as the boundary path skips them;
> * a real `turn/end` frame still overrides the reason when the stream IS available (that is the only way to
>   tell 出错 from 完成 — the store cannot), and a latched failure still outranks a later completion;
> * `running()` now reads the **store first** and the record as the FALLBACK, which is what a record is for:
>   a session the store does not list at all.
>
> **The window is 4.2 s** (`NOTICE_WINDOW_MS`), so 任务完成 is a brief 任务达成 above the pet's head and then
> 空闲. That is the app's own notice window; making the settings' 持续时间 extend it is a separate change.
>
> **Guards:** nine new core checks — the store's falling edge produces the notice with no boundary frame in
> sight, the machine resolves it to `done` and the line is the operator's own 任务达成, a rising edge clears it,
> a subagent's stop is not a completion, and a boundary record can no longer outvote the store while a session
> the store does not know still falls back to it.
>
> **No DSH restart needed for this one** — it is client-half code, so a page reload is enough.

> ## ✅ 2026-10-09 19:05 — the mark is ANIMATED now, and the label is exactly centred on the pet
>
> **Two more reports:** "dsh的鲸鱼尾巴是动画。而且文字还是没和模型居中".
>
> ### The centring was a device-pixel-ratio bug, in BOTH prompts
>
> `Scene.projectToCanvas` answers in the SCENE's pixels — `scene.resize` is called with the box's CSS size —
> and **not** the drawing buffer's, which is that times `devicePixelRatio` (`renderer.setPixelRatio`). Both
> prompts then converted with `box.width / canvas.width`, i.e. they divided by the device pixel ratio a second
> time. Measured live before the fix: the label's centre sat **89 px left of the pet's** in a 396 px box, and
> `1 - 1/1.5 = 0.333…`, `396 × 0.3333 = 132`, `132 × (1 - 1.5/1.5·…)` — put plainly, the projected point was
> being placed at two thirds of its distance from the canvas's top-left corner. On a 100 %-scaling display the
> factor is 1 and the bug is invisible, which is why it survived every probe: the probe's headless browser runs
> at dpr 1. Fixed by using the projection as it comes (no ratio); measured after: **offset 0 px**.
>
> ### The animated half of DSH's mark
>
> The app's `RunningWhaleTail` masks `currentColor` through a **60-frame APNG** (28×28, 21 KB) embedded in the
> chat plugin's stylesheet as base64, and draws the static SVG only where alpha masks, motion or forced colours
> say otherwise. The pet was drawing just the fallback, which is exactly what the operator saw: a still outline
> where the app has a moving tail.
>
> Shipping it follows `docs/ASSET-CONTRACT.md` §1 rather than bending it — the plugin does not commit another
> project's image:
>
> * `scripts/whale-asset.mjs` (`pnpm run fetch:whale`) reads the APNG out of the **installed** `app.asar` into
>   `assets/whale-tail.apng`, which is excluded from the package's `files` list;
> * the host serves it at **`/pet3d/whale`** (route 14 now);
> * both stylesheets mask through it under DSH's own activation conditions —
>   `@supports (mask-mode:alpha) and (mask-image:url(''))` + `prefers-reduced-motion:no-preference` +
>   `forced-colors:none` — with the app's declaration verbatim:
>   `mask:url(…) 50%/100% 100% no-repeat alpha`;
> * the static SVG stays UNDERNEATH instead of being hidden, one deliberate divergence from the app: the asset
>   can legitimately be absent (a checkout where the extractor never ran), and a mark that vanishes with its
>   asset is a worse failure than a mark that stops moving;
> * the path is written three times (the core constant, two stylesheets that cannot read the core when they are
>   built), so `check-plugin-load.mjs` compares all three instead of trusting them.
>
> **⚠️ This needs a DSH RESTART, not a page reload.** The route is host-half code and the host half in the
> running app was applied before this change: measured live, `/pet3d/whale` answered **404** while the new host
> half was still only on disk. The host suite proves the handler correct in the meantime (it serves the route
> over real HTTP and asserts the APNG signature, `acTL`/`fcTL`, the frame count and byte-equality with the
> extracted file — or an honest 404 when the asset is absent).
>
> **Guards added:** the host suite (+5) for the delivery; the client probe now asserts the animated layer is
> ACTIVE in a real browser (`mask-image` resolving to the route, `display: block`), not merely present.

> ## ✅ 2026-10-09 18:20 — the prompt IS DSH's own running label now (whale, live clock, scaled text)
>
> **The operator's four points, in their words:** "文字不在正中间，渐变显示异常。文字也没有随着模型变大（用窗口尺寸来计算
> 大小而非模型放大倍率）。而且我要的是dsh内部的前面带着一个鲸鱼尾巴图标的'深度求索中，用时XX分XX秒 ···'".
>
> **Where the truth lives.** Not guessed and not imitated: `@deepseek-ai/dsh-client-ui-chat`'s
> `RunningStatus`/`RunningWhaleTail` and `@deepseek-ai/dsh-client-ui-primitives`' `TextShimmer`, read out of
> the installed `app.asar`. The four pieces that matter:
>
> 1. **the wording** — the app's own i18n string `chat.deepDivingFor`: 「深度求索中，用时 {duration} ···」,
>    with `chat.deepDiving` (「深度求索中」) for the no-clock case;
> 2. **the clock** — `formatRunDuration` (whole seconds; minutes only from a full minute; hours only once
>    there is one) refreshed by a 1000 ms interval, floored at `Math.max(1e3, now - startTime)`;
> 3. **the whale** — a stroked path in a 16x16 viewBox, `stroke="currentColor" stroke-width="1"`, drawn
>    OUTSIDE the shimmer so the highlight never tints the mark. DSH ships an animated APNG mask for it with
>    this static SVG as the reduced-motion/forced-colors fallback; the pet draws the SVG always, because the
>    APNG is a binary asset inside DSH's stylesheet and copying it into this repository would be
>    redistributing an image the project does not own;
> 4. **the sweep** — `TextShimmer`: the line rendered TWICE, the second copy inside a
>    `mask-image: linear-gradient(105deg,transparent 0,black 40% 60%,transparent 100%)` layer whose
>    `translateX` and whose inner counter-`translateX` are OPPOSITE, both `1.5s steps(48,end) .3s infinite`,
>    and both rendering the words through `content:attr(data-shimmer-text)` so one string feeds both copies.
>
> **What was actually wrong before** (the operator's first two points, one cause each): the plate centred its
> text with `text-align` on a shrink-to-fit box, which reads off-centre the moment the line wraps or a mark is
> added; and the sweep was ONE absolutely-positioned copy carrying its own transform — half of DSH's
> mechanism, which is why it looked like a broken gradient rather than a band travelling over still glyphs.
>
> **What changed:**
>
> * `lib/core.js` owns the label: `STATUS_DURATION_TOKEN` (`{duration}`), `formatRunDuration` (the app's own
>   rules, zh and en units), `STATUS_ICON_STATES` (`working` only — the other four lines are the operator's own
>   messages, and a whale in front of 「我有问题要问你」 would claim the app is thinking), `STATUS_ICON_PATH`
>   (DSH's path, verbatim) + `statusIconMarkup()`, and `statusPromptFontPx()`. `statusFor` substitutes the live
>   clock and reports `icon`, so BOTH surfaces draw the same line from one function;
> * `DEFAULT_STATUS_TEXT.working` is the app's own string — 「深度求索中，用时 {duration} ···」 — and a line the
>   user types is still theirs: no token, no clock;
> * **the size** is derived from the pet's box, which is the operator's own prescription ("用窗口尺寸来计算大小
>   而非模型放大倍率"): `statusPromptFontPx(boxHeight) = boxHeight * 0.033`, clamped 10–48 px, written into
>   `--pet3d-status-font` / `--pet3d-desktop-status-font` every frame. 0.033 of a 387 px box is 12.8 px — the
>   app's own label size — and the whale is sized in `em`, so the whole label grows together. Derived rather
>   than multiplied by a scale factor, so the size preference, the model's own scale and the window all reach it;
> * both prompts (in-app `lib/client.js`, window `lib/desktop-page.js`) were rebuilt to DSH's structure and their
>   stylesheets rewritten from `TextShimmer.module.css`; the in-app one keeps the app's tokens
>   (`--dsw-alias-label-deep-diving{,-shimmer}`), the window's writes the colours out because it is a plain page
>   with no DSH stylesheet.
>
> **Measured live, after restarting the window:** `/pet3d/desktop` → `text: 深度求索中，用时 4分42秒 ···`,
> `animation: shimmer`, `icon: true`, `fontPx: 17.8px` for a 540 px slot. The readout now publishes the label's
> text, its mark and its **size**, so "the text did not grow with the pet" is one HTTP request away instead of a
> guess.
>
> **The guards:** the core suite gained nineteen checks for the app's rules (9秒 / 14分46秒 / 59秒 / 1分0秒 /
> 1小时2分3秒, the en units, the substitution, the one-second floor, the icon state, and the font curve in both
> directions), and the client probe gained a check that drives the IN-APP prompt and asserts both copies of the
> line, DSH's path (`M8.844 1…`), the visible mask, and the font variable against
> `core.statusPromptFontPx(boxHeight)`. The window's own check asserts the same shape through its readout.

> ## ⚠️ 2026-10-09 17:45 — the 状态 prompt was drawn OUTSIDE its own window, and the window was too small
>
> **Two reports, one region of the code:** "小宠物这边没有任何工作状态的显示" and then "把独立宠物窗口大一些，有时候宠物
> 把手举起来会超出框架，多出来的部分正好可以显示文字".
>
> **First, which pet was on screen.** `petSurface: 'auto'` prefers the standalone window and hides the in-app
> copy (`showInAppPet(!running)`), and `/pet3d/desktop` said `state: running`, so the operator was looking at
> the floating window — whose prompt is `lib/desktop-page.js`'s own DOM, driven by the state the in-app pet
> publishes over `/pet3d/state`.
>
> **Why nothing showed, measured rather than guessed.** `/pet3d/desktop` reported the prompt UP and correct —
> `status.text = 深度求索中...`, `animation: shimmer`, `rect = (1633, 832, 94x24)` — while the page had drawn it
> one full height higher. `layoutStatus` computes the box's FINAL top-left itself (`centreX - width/2`,
> `headTop - height - 4`) and clamps THAT into the frame; the stylesheet then applied
> `translate(-50%,-100%)` **on top of those already-centred numbers**, so the element landed one half-width
> left and one full height up — entirely above the window's top edge. The same wrong rectangle is what the
> launcher sizes the window from, so the window never grew to hold the prompt either. The in-app prompt is
> unaffected: `placeHeadStatus` hands it the ANCHOR point and the transform does the centring there. **The two
> paths must not be mixed**, and now they are not: the transform is gone from `.pet3d-desktop-status`.
>
> **Why every check was green.** The one assertion about this compared the page's report with the page's own
> report — `shownRect` was read straight back out of `pet.rect()` — so it could not fail. It now measures the
> DOM (`getBoundingClientRect`, which includes transforms) and compares it against `status.rect - origin`,
> with `layoutOrigin` published in the readout to make the two comparable; and it asserts the prompt is INSIDE
> the window it is drawn in. **Negative-tested:** with the transform put back, the DOM sits at `(55, 25)`
> where the page says `(101.5, 49.5)` — a `(46.5, 24.5)` offset, exactly (half width, full height) — and the
> check fails.
>
> **Second, the window really was too small, and the fix is the same number.** `MOTION_FRAME_MARGIN` (1.35)
> used to apply only while a clip was PLAYING, so a pose that outlived its clip — or one only the idle wrote —
> was cropped again the moment the scheduler moved on, which is why the clipping read as "sometimes". It is
> now **permanent**: the canvas, and therefore the window, is the slot × 1.35, and `setFrameMargin` pulls the
> camera back by exactly that factor so the pet keeps its size in PIXELS. The band that opens above the head
> is where the 状态 prompt lives, so one number answers both halves of the request. Measured live after the
> change: slot `284x387` (size 129), canvas CSS `383`, **window `383.4x522.45`**, `status.rect`
> `(2233, 977, 94x24)` inside it, stable over 24 s.
>
> **New readouts, so this never has to be guessed again.** `desktop/main.js` now relays the page's `status`
> (rect, text, animation) and its sizing `metrics` (placement, pixels, canvas, screen, devicePixelRatio);
> before that, "the window is the wrong size" could be a grown slot, a grown canvas or a mis-measured frame,
> and the three were indistinguishable from the host. `lib/desktop-page.js` publishes `layoutOrigin` inside
> `status` for the same reason. The probe's `desktopPage` check also records `found.flags`, naming which of
> its twenty-odd sub-assertions failed, because `ok: false` alone cost two debugging runs.
>
> **One transient, explained and not a loop:** a restart once reported `941x1284` — the union of a dying page
> instance's rectangle with the new one's, while the launcher's single `petRect` briefly held both. The page
> never derives its size from the window (no `innerWidth`/`innerHeight` anywhere in it), so the margin cannot
> feed back.

> ## ⚠️ 2026-10-09 17:25 — 状态汇报 was NOT reaching the pet: `connected` had no writer
>
> **The question that found it:** "你的宠物工作状态提示做好了吗?" — and the honest answer was *no*, even
> though every suite was green and the code for every visible piece existed.
>
> **The measurement, taken from outside the app:** `GET /pet3d/state` answered
> `{"seq":1,"state":"offline","at":1791537411916}`. `seq: 1` proves the client half HAD started (so the
> boot fix above is live); `offline` while the agent was streaming a turn proves the pet could not see the
> session it was supposed to be reporting on.
>
> **The cause, traced through `lib/core.js` and `lib/client.js`:** `PetMachine.resolve` answers `offline`
> whenever `snapshot.available !== true`, and `SessionAggregate.snapshot` computes
> `available = input.connected === true && hasAnything && hasSelectedSession`. `input.connected` starts
> `false` and is written only by `Pet3DWidget.prototype.setConnected` — **which nothing in this repository
> ever called.** The setter was dead code, so 工作中 / 任务达成 / 出错 / 空闲 / 睡觉 were all unreachable
> on screen; only the states that outrank `available` in the cascade (拖动 / 打招呼 / 等待确认) could ever
> appear. The component's effect pushed `setSessionContext` on every store change and never said
> "connected".
>
> **Why nothing caught it:** every existing check drives a `Pet3DWidget` directly and calls
> `aggregate.setInput({ connected: true, … })` itself (`build/probe/client-test.js` did that in thirty-odd
> places). The plugin's REAL route — `apply` → the registered `shell.overlay` component → the two hooks DSH
> hands that component → the widget — was executed by no suite at all.
>
> **The fix:** the effect that pushes the session context now calls `widget.setConnected(true)` first, and
> `status` joined that effect's dependency list. The dependency is not cosmetic: the widget does not exist
> on the first run (the chunks land seconds later) and `setStatus('ready')` re-renders *without* changing
> catalog or statuses, so without it a page loaded on an idle machine could stay 离线 until something else
> moved. A live session standard kit is the honest meaning of "connected" — those hooks exist only while
> DSH's client store is installed — and `hasAnything` still gates 空闲 on the store actually being ready,
> so this cannot paint a cheerful idle pet over an empty panel.
>
> **The DSH contract this rests on** (read out of the installed `app.asar`, 0.2.0-rc.2): `shell.overlay` is
> declared by `client-ui-layout` with `standardProps: [useResource, useWorkspaces, usePanelInfo,
> useSessions, useSessionStatus, useSessionRetainInfo]` (`AppFrame` renders it as
> `renderSlot("shell.overlay", {})` — the owner passes nothing), and `@deepseek-ai/dsh-client-ui-slots`
> states that *every* registered component "receives props composed from five framework shares: the runtime
> share (`owner` … plus the session standard kit and global seat), …". So an entry is handed
> `useSessions`/`useSessionStatus` **without declaring them**, which is why this plugin's registration needs
> no `inject` face. The store is `{ byId, phase }` and `useSessionStatus` returns a
> `Map<sessionId, { running, pendingInteraction, completionUnread }>` — exactly the shapes
> `SessionAggregate` already consumes, which is why the one missing flag was the whole fault.
>
> **The guard:** `build/probe/client-test.js` gained its first check that goes through the PLUGIN rather
> than around it — `CLIENT.createPlugin` → `apply` against a capturing `slots` service → the registered
> component rendered with the session standard kit → the widget's own `tick`. It asserts the widget is
> connected, resolves 工作中, and POSTs `{"state":"working"}` to `/pet3d/state` (the channel the floating
> window polls and `check-profile.mjs` reads). **Negative-tested:** with the `setConnected` line removed it
> reports `{"connected":false,"state":"offline","posted":["{\"state\":\"offline\"}"]}` — the live symptom
> reproduced exactly, and the client suite failed on exactly that one check.
>
> **Not fixed, and deliberately not claimed to be:** the RPC boundary stream is still an upgrade rather than
> a second source. It does not set `connected` at all, and even if it did, `snapshot()` derives its session
> ids from the catalog and the status map, so turn boundaries alone could reach 任务达成 / 出错 after a
> turn ended but never 工作中 *during* one. The store path is the one the pet depends on, and it is the one
> that was broken.
>
> **Still unproven:** the prompt on screen with this fix in the running app — the page must be reloaded
> (the browser module table is built at page load). `/pet3d/state` is how to confirm it from outside: it
> must report `resting` (空闲) or `working` (工作中) instead of `offline`.

> ## ✅ 2026-10-10 — DSH 状态汇报 is DONE, and verified (ten suites, **1269 checks**)
>
> The operator's request: show what DSH is doing **above the model's head** — 「深度求索中...」 in DSH's own blue
> sweep while it is thinking, and a bubble for each of the other situations — with every line editable, the
> old 动作 section renamed **状态**, the actions renamed to the operator's six, and the other actions deleted.
>
> **Where each answer lives:**
>
> | # | Request | State |
> |---|---|---|
> | 1 | 工作中 shows 「深度求索中...」 with DSH's built-in blue gradient | done — the real label, not an imitation: the base colour and the sweep are the app's own `--dsw-alias-label-deep-diving{,-shimmer}` tokens, and the mask keyframes are the same `steps(48,end) 1.5s` sweep its chat label uses. Both pet surfaces (in-app overlay and floating window) |
> | 2 | 「我有问题要问你❓」/「需要你的授权❓」/「遇到问题了...」/「任务达成✅」 | done — `core.DEFAULT_STATUS_TEXT` + `core.STATUS_TAGS`. The two pending prompts are told APART by the session's own `pendingInteraction.kind` (`approval` vs `question` vs `plan-review`), which the app's session list already classifies |
> | 3 | all text editable in the settings window | done — the 状态 section: per state a text box, a tag picker, 静态/蓝渐变动画, and 持续时间. Clearing the box means "say nothing" |
> | 4 | 「动作」→「状态」, and the six names | done — the section is 状态 and the six states are 空闲 / 工作中 / 等待确认 / 任务完成 / 出错 / 离线. `core.STATUS_STATES` is the one list, and `core.MOTION_STATES` is a copy of it, so the two halves cannot drift |
> | 5 | delete the other actions | done — 睡觉 / 打招呼 / 庆祝 are gone from the configuration. The machine still HAS `sleeping` and `greeting` (a nap and a click reaction are real behaviours), but neither is offered as a row. `celebrate` was **renamed to `done`**, with `core.STATE_MIGRATIONS` reading an old stored map under the new name so nobody's 庆祝 clip is silently dropped |
> | 6 | 持续时间, default 0 = always | done — `seconds` per state; 0 means "while the state lasts", a positive number means "for N seconds after entering it" |
> | 7 | 完成/出错 后切回 DSH 就恢复空闲 | done — `PetMachine.setFocus`, driven by `document.hasFocus()` polled every eighth frame (Windows does not fire `focus`/`blur` on an application switch) |
> | 8 | 等待确认 必须完成确认后才能跳转出来 | done — the pending state is LATCHED: while the session reports a pending interaction, every branch that would outrank 等待确认 (a failure, a completion) is skipped. A drag still wins, because that is the user's own hand |
>
> **Two architectural additions this needed:**
>
> * **`/pet3d/state`** — the floating window is a page in the launcher app and has NO session data at all (no
>   catalog, no statuses, no boundary stream), so it cannot work out what DSH is doing. The in-app pet resolves
>   the state and POSTs it there; the window polls it, exactly like `/pet3d/settings` and `/pet3d/preview`. It is
>   `seq`-counted, not value-compared: the pet returns to `resting` between turns, so a value comparison would
>   miss every second entry into 工作中.
> * **the window now DRAWS the state too**, not only the prompt: it used to send a hard `resting` for every
>   non-drag frame, so a clip mapped to 工作中 played in the app and never in the window the operator was
>   actually watching. The two pointer-owned poses still win (`held`/`falling`), and `sleeping`/`greeting` fall
>   back to `resting`.
>
> **⚠️ THE ONE THING THAT NEEDS A RESTART:** the `/pet3d/state` route and the host's route table are HOST-half
> code. The running app has been probed and answers `/pet3d/settings` 200 but `/pet3d/state` **404**, so the
> floating window's prompt cannot work until DSH is restarted. Everything else — the prompt over the app's own
> pet, the settings section, the migration — is client/page code and is live on the next page load.
>
> **Verification:** `core 577` · `host+model 352` · `load` ✓ · `clientchunk 37` · `vendor` ✓ · `docs 165` ·
> `browser 13` · `mmd 13` · `client 70` · `desktop 148` — **ten suites, 1212 checks, green**. The new coverage:
> the waiting latch and the focus rule (core 6b), the status prompt and the migration (core 6c), the state
> channel over real HTTP (host+model), the 状态 section's six rows and their five shipped lines (desktop), and
> the window's own prompt + per-state clip switch (client probe).

> ## ✅ 2026-10-09, LATE — the five-item order from the operator is DONE, and verified
>
> Everything below this block is history. This is the current state.
>
> **What the operator asked for, and where each answer lives:**
>
> | # | Request | State |
> |---|---|---|
> | 1 | 弹簧骨排版混乱，控件要自适应 | done, §20.1 — the fixed grid became a wrapping block; checked by eye with 18 chains on screen (§22.2) |
> | 2 | 头发不摆动 | done, §20.2 — 16 of the fish's 22 chains were unmatched (`LiuHai.L` and friends: `GLTFLoader` deletes the dot), `chains 6 → 22`; **every model now loads every chain** (§21.4) |
> | 3 | 表情加「无」并默认 | done, §20.3 — `emotions: []` now means NO expression; the window ticks 「无」 on all three rows by default (§22.2) |
> | 4 | 视线曲率不实时生效 | done, §20.4 + §22.1 — it *was* live; the section now reports what the renderer applies (curve, spans, the last frame's aim), polled every 2 s |
> | 5 | 每动作循环/单次 + 每状态单次动作区间 | done, §20.5 + §22.3 — per-clip play mode and per-state `min–max` seconds, both persisted and both live on the real pet |
>
> And one bug found on the way that the operator reported as **"衣服透明的地方变成黑色"**: our VRM wrapper never
> called `VRM.update()`, so MToon's `material.update(delta)` — which refreshes the `alphaTest` uniform — never
> ran (§21). Fixed; a VRoid garment's 77 %-transparent texture now cuts out instead of painting black.
>
> **Current live state on THIS machine:** the host has been restarted, so the new preferences persist;
> `modelId = m2` (`SampleModel.vrm`, VRoid ヴィータ), 18 spring chains matched / 0 skipped, and
> `motionEvery = { resting: { min: 20, max: 80 } }` on purpose — the resting state is mapped to the one-shot
> `a1 = pet3d-happy-hop.vrma`, so the pet hops once every 20–80 seconds (§22.3). All ten suites:
> **1212 checks, green**.
>
> ### What is actually left, in the order I would do it
>
> 1. **Model ids drift when the catalog changes** (found 2026-10-09, not yet fixed — *ask before changing*).
>    Ids are minted in scan order and the memoisation lives in the running host, so adding `SampleModel.vrm`
>    re-minted the fish as `m3` and the stored `modelId: m2` **silently became a different file** — that is why
>    the pet changed models by itself. The fix is to key an id by the model's relative path and persist that
>    mapping (the motion side already memoises per path); it needs the host half, a one-time migration of the
>    stored `modelId`, and a DSH restart. It is deliberately NOT done without the operator's word: re-keying
>    touches the preference every surface reads.
> 2. **Hair "swings enough?"** is now purely a matter of taste (§21.4): the solver runs, the sliders reach every
>    chain, and sweeping `sway` plus the per-chain stiffness/drag/gravity is the remaining lever.
> 3. **Panel unification** — the 2026-10-08 debt that is still half done: `panel.js` exists, but
>    `lib/desktop-page.js`'s own `buildPanel`/`refreshPanel`/`wirePanel` were never swapped onto it.
> 4. **The supplied `gravityPower` default (0.5) as a preference** rather than a constant (`lib/pet3d.js`)
>    — the spring table already shows it; the default itself is hardcoded.
>
> ### The one operational trap that has cost the most
>
> This machine's shell is **Windows PowerShell 5.1**, where `Set-Content` writes ANSI and `-Encoding utf8NoBOM`
> does not exist. A `Get-Content | Set-Content` round trip destroyed `HANDOFF.md` and `docs/ARCHITECTURE.md`
> once (§19). **Edit text files with the editor tools, never through the shell.**
>
> ## ⚠️ 2026-10-08, EVENING STOP — read this first
>
> The user was shown a working pet and then left for the day. Two things matter for whoever resumes:
> **three model bugs are fixed and CONFIRMED BY THE USER**, and **one bug is still open** (the desktop behind
> the pet freezes like a screenshot when the model is clicked). Below: what is fixed, what is not, the exact
> next step for the open one, and the debts.
>
> ### Fixed, and confirmed by the user — do NOT revert these three
>
> The user's own words after the third fix: *"现在好了"* (the hair and skirt are right). All three are needed:
>
> 1. **VRM 0.x has no gravity, so a viewer must supply it.** Measured from the user's files: `HatsuneMikuNT.vrm`
>    reports `gravityPower = -` and `gravityDir = null` for both of its spring chains (the VRM 0.x spec has no
>    such fields), while 蓝色小肥鱼vrm (VRM 1.0) declares `gravityDir = [0,-1,0]`, `gravityPower = 0.05`.
>    With no gravity every chain keeps its bind pose for ever: the twintails sat at 45°, the skirt stayed
>    flared. Fix: `Scene.prototype.supplyMissingGravity` in `lib/pet3d.js`, called at install time — it supplies
>    `gravityPower = 0.5` and `gravityDir = (0,-1,0)` ONLY where the file gives none, so a VRM 1.0 model that
>    declares its own physics is untouched. The supplied value becomes that chain's "default" in the settings
>    window, so it is tunable per chain.
> 2. **Do not call `VRMUtils.removeUnnecessaryVertices` or `VRMUtils.combineSkeletons`.** Both are
>    optional "hygiene" steps and both rewrite what the skinning depends on (JOINTS_0/WEIGHTS_0, and bone
>    parenting). With them in place the user's models come out deformed — fringe flat, skirt pulled into a
>    plate — while the body and limbs stay correct. Measured, not theorised: they were off in the state the
>    user confirmed correct, restoring them reproduced the deformation immediately, and taking them out again
>    was part of what fixed it.
> 3. **Clear the spring colliders** (`joint.colliderGroups = []` after load, plus the manager's
>    `_colliderGroups`). This is the one that took the longest to find, by elimination: it was the only
>    difference left between the state the user confirmed correct and the broken one. A collider whose radius
>    does not match the skeleton it shipped with drags a ring of skirt chains out into a horizontal plate and
>    flattens the fringe. Colliders are optional for a desk pet (they only stop hair passing through the body
>    at rest).
>
> **Method note, because it cost a regression:** the three changes above were originally made while guessing,
> the user asked for the "unrelated" changes to be reverted, and reverting them broke the pet again — because
> two of them were load-bearing and only the *explanation* attached to them had been wrong. **Bisect by
> difference, not by inference**: compare the working tree against the broken one and change ONE thing. And ask
> for a screenshot early — the one screenshot received narrowed this from "everything" to "the clothing meshes"
> in a single step, after three wrong guesses about animation, skeletons and materials.
>
> ### Still open: the desktop behind the pet freezes like a screenshot
>
> **Symptom, verbatim:** *点击模型时，模型后面的内容会被定住变成截四 — clicking the model (which activates the
> window) leaves everything behind it frozen on a stale frame. The pet itself keeps working.
>
> **Tried already (all five switches are in `desktop/main.js`, appended to `app.commandLine` near the
> top):** `disable-features=CalculateNativeWinOcclusion`, `disable-backgrounding-occluded-windows`,
> `disable-renderer-backgrounding`, `disable-direct-composition`,
> `enable-transparent-visuals`. The user reports it **still happens** after the occlusion ones, and the
> composition ones were added after that report — so **first check whether those last two are actually live**:
> the launcher is re-read from disk on every window start, so toggling the window off and on is enough
> (no DSH restart), but a window started earlier keeps the old switches.
>
> **Checked 2026-10-08 at 20:17, before doing any of the next steps:** the launcher was restarted with
> the app at 20:08 (a live `/pet3d/desktop` reports `state: running`, page `ready: true`), so **all five
> switches are live in the running window now**.
>
> **Then the user reported it STILL freezes** — browsers and Electron-based applications first — so
> steps 1— below were implemented the same evening and are verified by the `desktop` suite (105
> checks) plus four new source assertions. See §15. **They take effect on the next window start** (the
> launcher is re-read from disk every time), which is what the user is being asked to test: close the
> floating window and turn it on again, then click the model. If it still freezes, step 4 — the window
> that is only as big as the pet — is the remaining structural answer, and the user has already
> approved falling back to it.
>
> **Next steps, in this order** (each is small and independently testable) — **1, 2 and 3 are DONE,
> see §15; 4 is the remaining fallback:**
>
> 1. ~~**Stop the window from being ACTIVATED.**~~ **DONE.** `desktop/main.js` keeps the window
>    un-focused: a `focus` listener blurs it, and every click-through change re-asserts
>    `setAlwaysOnTop(true, 'screen-saver')` (`keepOnTop()`). `focusable: false` was already set.
>    Windows offers a screen-sized borderless topmost window the "fullscreen optimisations" /
>    independent-flip path once it is foreground, which is why the symptom starts at the first click.
> 2. ~~**Guard the click-through toggling.**~~ **DONE.** One `mouseThrough` variable decides and
>    `setIgnoreMouseEvents` is called only when the verdict actually changes; the 60 Hz cursor poll
>    used to call it on every tick.
> 3. ~~**Inset the window by 1px** from the work area.~~ **DONE.** `SCREEN_INSET = 1` on all four
>    sides, and the page is handed that origin so every reported rectangle stays in screen
>    coordinates. The `desktop` suite asserts the inset from the live window's own report.
> 4. If none of that works, the fallback is to stop being transparent-and-screen-sized: keep the window sized
>    to the pet's own box (the scene already frames the model into its canvas) and move it with the pet. That
>    removes the fullscreen-optimisation classification entirely at the cost of a larger rewrite.
>
> ### Debts, in the order they should be paid
>
> 1. **Lock the three confirmed fixes with assertions** so nobody (including a future me) reverts them again:
>    a VRM 0.x chain must have non-zero gravity after install; `lib/pet3d.js` must not call
>    `removeUnnecessaryVertices`/`combineSkeletons` (source assertion, with the measured reason in the
>    message); `desktop/main.js` must keep the anti-freeze switches.
> 2. **`gravityPower`'s supplied default (0.5) should be a preference**, shown in the config window's spring
>    section (the field already exists there — a chain with no file value currently shows the supplied number,
>    which is right, but the default itself is hardcoded).
> 3. **Panel unification is HALF DONE.** `panel.js` is written (the single definition: the app panel's
>    markup verbatim, `createPanel` rendering only the rows a surface supplies callbacks for, plus
>    `PANEL_STYLE`), whitelisted in `lib/index.js` and loaded by `lib/desktop-page.html`. What is NOT
>    done is swapping the floating window's own panel over to it: `buildPanel`/`refreshPanel`/`wirePanel` in
>    `lib/desktop-page.js` are entangled with the mount closure, the panel hit-test rectangle, zoom and the
>    quit button, so the swap must change all three together and then be checked with the live window half of
>    `verify-desktop.mjs`.
> 4. ~~One red assertion in the client suite~~ **FIXED 2026-10-08, evening.** `emotionOk` read
>    `found.showable` — a property of the report object that never exists, so the
>    `(found.showable || [])` fallback made the "offers `wag`" term false. It meant
>    `found.emotion.showable`. The client suite is 58/58 again.
> 5. ~~docs counts~~ **FIXED with it, and the two were one failure.** `check-docs.mjs` shells
>    out to the client suite to read its count and THREW when that suite exited 1, so the docs
>    red was collateral — nothing about the counts had been measured. With the assertion fixed
>    the real staleness showed: README quoted core 361 and a total of 874. The real figures are
>    core **379** and total **896**, and this round moved both again — see §15 for the current
>    figures (**471** and **1078**; 471 + 339 + 43 + 13 + 68 + 13 + 129, plus `load` and
>    `vendor`). The route table did NOT need the pass this note predicted: all 149 other docs
>    assertions passed, ELEVEN routes included.
> 6. ~~New host surface that needs a restart to be live~~ — **LIVE since the 20:08 restart.** `GET/POST
>    /pet3d/settings` plus `lib/settings.js` (the one settings store, because `localStorage` does NOT cross
>    the boundary between DSH's profile and the launcher's — same origin, different browser profile). Every
>    surface polls its `version`. Verified: host+model suite, and the settings page's own
>    `__PET3D_CONFIG_STATE__` — and now live: on 2026-10-08 at 20:08 the app was restarted, and
>    `/pet3d/{catalog,motions,models,settings,config,window,desktop}` all answer **200** against the running
>    host, so the six "needs a restart" items of "What is left" are in the running app now. Live
>    evidence for the floating window at 20:17: `/pet3d/desktop` reported
>    `state: running, page.ready: true, webgl2: true, renderer: ANGLE (NVIDIA RTX 2060)` with the pet's
>    rect at 220×300.
>
> ### Verification state at the stop — and after the evening's detail round
>
> `core 577` ✓ · `host+model 352` ✓ · `load` ✓ · `clientchunk 37` ✓ · `vendor` ✓ ·
> `browser 13` ✓ · `mmd 13` ✓ · `client 70` ✓ · `desktop 148` ✓ — **all ten
> suites pass (1212 checks).** The settings window's real-window check (desktop) asserts that the page rendered a real
> VRM's expressions and spring chains, so "the settings page is blank" can never come back silently: that is
> how the `resetAllSprings` ReferenceError was finally found (it left the page on its placeholder text). Since
> §19 the same check also asserts the 状态 section: one box set per state, the status line each one shows above
> the pet's head, the catalog it lists, and how many of those clips declare themselves as playing once — since
> §20 the per-clip play-mode rows and the per-state interval lines, since §21 that the per-frame VRM update
> reaches the MToon materials, and since §22 the 视线 line that reports what the renderer applies.

> **Status in one line:** all 10 verification suites pass (**1212 checks**), the tree
> is green after the interrupted work of 2026-10-07/08, and **the pet has now been
> seen running in the real app**: on 2026-10-08 it was hot-installed into this
> machine's live profile (no restart), appeared in `shell.overlay`, and its own
> routes answered `/pet3d/catalog`, `/pet3d/motions` and `/pet3d/models` with 200 —
> which closes the 404 that the 2026-10-07 install hit.
>
> The first real model loaded in the app rendered as a **frozen T-pose**, which is
> now diagnosed (a VRM's rest pose IS a T-pose, and the procedural path never synced
> the normalized rig) and fixed with a derived relaxed stand + a per-frame
> `humanoid.update()` — measured on the real model, see §11.
>
> **The interaction round of 2026-10-08** (§11, last part): the wheel resizes the pet
> and replaced both size sliders, a right-drag orbits the camera, a thrown pet now
> **rebounds off the side walls** instead of sticking to them, and enlarging the pet
> can no longer push it outside its frame — `modelScale` is folded into the slot rather
> than scaling the model inside it. That round also fixed a silent bug: the scene's
> `height` field held pixels and world units at once, which had switched the advertised
> pointer gaze off entirely.
>
> Read §9 for that first failure and its fix, and §10 for what is still unproven.
> **§11 is the live session of 2026-10-08**: what was proven, the model-id defect it
> exposed, the T-pose fix, and what still needs a DSH restart.
>
> **2026-10-08, this machine:** this plugin **is** installed in
> `~/.dsh/profiles/desktop` (user `LIUHUAN`) and active; `dsh-plugin-whale-pet` is
> installed but **disabled**, because both register into `shell.overlay`. The project
> also moved drives (`D:\SynologyDrive` →`F:\SynologyDrive`), so the profile path in
> §5 and the `.bak` filenames in §9 belong to the other machine. Profile backups
> taken before the install: `package.json.bak-pet3d-2026-10-08T09-15-28` and
> `cordis.patch.yml.bak-pet3d-2026-10-08T09-15-28`.
>
> **Found while resuming, and fixed:** the previous session left two suites red —
> the host suite still expected four routes after `/pet3d/models` was added, and
> `verify-model.mjs` died intermittently with `fetch failed` / `cause: bad port`,
> because `listen(0)` can be handed a port `fetch` refuses on this machine's
> dynamic range (it starts at 1024, not 49152). Both are fixed and covered: the new
> route has checks of its own over real HTTP, and every probe server now goes
> through `scripts/loopback.mjs` (gotcha 36).

---

## ▶START HERE — state saved at the end of 2026-10-11 (read the dated blocks at the top first)

**The tree is green: 10 suites, 1843 checks.** First command of a session, and the OPERATOR's call rather than a
per-edit habit — a finished change is verified with the one suite that covers it (`AGENTS.md`):

```sh
node scripts/verify-all.mjs                                  # expect 10 passed, 1843 checks
```

`node scripts/check-docs.mjs` recomputes that total from the other suites, so a count that drifts fails there
rather than going stale.

### Where the RUNNING app stood when this file was written (measured, not remembered)

Three requests, and they are the first thing to repeat tomorrow — they say which half is already live, so no time
is wasted re-testing what shipped:

```sh
node scripts/check-profile.mjs                                     # 9 checks, exit 0 = wired; exit 2 = reload the page
curl.exe -s http://127.0.0.1:19387/pet3d/state                     # the in-app pet's own report
curl.exe -s http://127.0.0.1:19387/pet3d/desktop                   # the launcher's view of its window
```

(In PowerShell `curl` is an alias for `Invoke-WebRequest`, so use `curl.exe` or
`(Invoke-WebRequest -UseBasicParsing <url>).Content`. `node` is not on PATH either — prefix every command with
`$env:Path = "C:\Users\LIUHUAN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;" + $env:Path`, which is
what the commands in this section assume.)

| Half | Evidence in those answers | Verdict, re-measured at 2026-10-10 08:34 |
|---|---|---|
| host half (`lib/index.js`) | `/pet3d/state` carries a `line` field, `error: null` | **LIVE as of the eighth pass**; the ninth pass's `/pet3d/say` and `/pet3d/llm` were written afterwards, so they need a restart — `curl.exe -s http://127.0.0.1:19387/pet3d/llm` answers 404 until then |
| launcher (`desktop/`) | `/pet3d/desktop` carries `page.state`, `page.status.scale`, `page.status.tone`/`bold` and `page.speech` — fields the launcher only copies after a restart | **LIVE**: DSH itself started at 2026-10-10 08:22, after the newest launcher edit (2026-10-09 23:16), so the seventh pass's `pickMotionDir` and dialog titles are live too. The eighth pass's `offered`/`routed` were written after that start and DO need a restart |
| client half (the page inside DSH) | `/pet3d/state` reports `working` with no `error` — the pet is mounted and tracking the running turn | **LIVE if the tab was loaded after 08:22**; a tab left open across the restart still runs the old chunks in memory, and Ctrl+Shift+R is the one thing that settles it. The ninth pass's AI request path is client-half code, so it needs that reload |

So the first action is a test run after all, and the measured verdict above is what makes it one: with both halves
current as of the eighth pass, what a reload/restart is still owed is the **ninth pass** (`/pet3d/say`,
`/pet3d/llm`, the AI request path and the regenerated `lib/client.core.js`), the eighth pass's two motion fields,
and a possibly stale tab. Walk the acceptance list below, and note that the two `placementX`/`placementY` values in
`pet3d-settings.json` matched the running window's own metrics exactly — that item is proven at the data layer and
needs only a close-and-reopen to be seen.

### Tomorrow's list, in order

1. **The live pass.** Everything below is offline-green and, with the two exceptions named in the table, unproven
   on screen. After a reload + restart, check each in one sitting:
   * 悬浮窗大小 is independent of 大小, and the window reopens where it was parked (`windowSize`,
     `placementX`/`placementY`);
   * the pet's 碎碎念 bubble appears above the prompt and is click-through while the prompt is not;
   * **the 碎碎念 settings work end to end** (the ninth block): open 模型参数 → 碎碎念, write two lines into 工作中,
   set 台词来源 to 自定义短语, and watch the bubble on the next turn; then set it to AI 生成, pick a route (or fill
   the custom Base URL + model + key) and press **试一句** — it must answer with a line or with the host's own
   refusal text. The fallback chain is what to watch: with a deliberately wrong key the bubble must still show
   the state's own line rather than nothing;
   * **任务达成 is gold and bold, 出错 is red, and a notice STAYS until you switch back to the session that
     reported it** (the sixth block) — the one thing to watch is whether it clears in the same session after the
     minimum hold, which is the documented reading of "切回";
   * 等待确认 does not time out, and its 持续时间 field is disabled in the settings;
   * **both import cards work**: 模型导入 and 动作导入 each open a native dialog (模型/动作 in the title), the chosen
     folder appears in the list, the models/clips appear at once (motions in the 状态 checkboxes), 移除 takes
     effect immediately, and the files are never deleted;
   * `node scripts/check-profile.mjs` says the wiring is live (exit 0).
2. **If any of those disappoints, the failure is already instrumented**: `/pet3d/state` names the client half's own
   error, `/pet3d/desktop`'s `page.state`/`page.status.tone` say what the window believes, and both import cards
   publish `import`/`motionImport` (`controls`, `picker`, `dirs`, `error`) so "no route", "no dialog" and "the
   section did not render" are three different answers. A motion that does not play has its own four: the eighth
   pass made `/pet3d/desktop`'s `page.motion` carry `offered` and `routed` beside `available`/`reason`, so "the
   host never served the route", "nothing is mapped" and "this avatar cannot drive that clip" stop looking alike —
   after a DSH restart, since the relay is launcher code.
3. **The one thing that blocks the motion feature outright:** `pet3d-settings.json` has `"motions": {}`, so no clip
   is mapped to any state and the window will play no authored motion however healthy the rest is. Mapping two or
   three of the six imported clips (`a1`–`a6`) to 静息态 and 工作中 is what turns the whole 动作 feature visible,
   and it is the 2026-10-09 list's item 1, still open.
4. **Then 小尾巴**, in this order of value: the settings PAGE still not being built from `panel.js`'s field
   definitions (debt 3's remaining tail), `/pet3d/desktop`'s `modelId` disagreeing with what is rendered,
   `HEAD_LAYER_LIMIT` (70°) and `MOTION_FRAME_MARGIN` (1.35) as settings, and the freeze question (§16, kept as a
   rig rather than a belief). The per-line editing of 碎碎念 lines is DONE (ninth pass); what is still open there is
   a reaction beyond speech (an expression or a motion tied to the same events), and the phrase table itself being
   editable per language rather than one list for both.

### Done on 2026-10-11 (the three items this section used to list, plus two bugs, one debt and three features)

All of it is in the dated blocks at the top of this file, with the tests:

1. **The floating window's own size** — `windowSize`, cleaned beside `size`, read through
   `Placement.sizeKey`, pushed in `LOCAL_KEYS` instead of `size`, and editable as **悬浮窗大小** in the
   settings window's 其他 section. A profile with only `size` keeps that value for both (the migration).
2. **`status.scale` relayed** by `desktop/main.js`, so `/pet3d/desktop` reports the prompt's per-model
   correction. Launcher code: a **DSH restart** is needed for it to be live — and for `windowSize`, which the
   launcher's page reads from that same report, and for `panel.module`, `speech` and the folder picker.
3. **任务完成 follows the 状态 持续时间** (`core.doneWindowMs`), with the 4.2 s notice window as the floor, and
   the settings page documents both that rule and the `{duration}` token.
4. **The window remembers where it was put** — `placementX`/`placementY` now survive the cleaner AND travel in
   the window's push list, with the migration guard that keeps the page's own corner when the store has never
   been told one.
5. **面板统一化 (§14 debt 3) is DONE** — `panel.js` is the only panel definition and both surfaces build
   from it: the window through `createPanel`, the app through `panelMarkup` delivered as the fifth client
   chunk. See the second 2026-10-11 block for the rows, the two stub-host bugs it exposed, and what is
   asserted where.
6. **碎碎念 DONE (§24 item 1)** — the pet's own bubble, in both surfaces, with the phrase table and the
   throttle in core, the line relayed through `/pet3d/state`, a 碎碎念 section in the settings window, and the
   privacy rule asserted. See the third 2026-10-11 block.
7. **模型导入 DONE (§24 item 4)** — the settings page's 模型导入 section: a native folder picker through the
   launcher (the settings window now gets the preload), a typed-path fallback, the imported list with 移除, and
   the host's own refusal text. See the fourth block.
8. **The 工作中-that-never-ended fixed (§42, fifth block)** — the app half crashed on a core chunk that did not
   have `SpeechMachine`, so nothing published a state and the floating window drew the last one for ever. Both
   halves are fixed: an optional symbol now degrades (voice or panel lost, pet alive) and an absent state CLEARS
   the prompt. This was a regression from item 6 in this same session, found from the operator's report.
9. **任务达成/出错 now WAIT, in gold and red (sixth block)** — the two notices persist until the user is back in
   the session that reported them, 等待确认 until the answer arrives, and a 持续时间 can no longer hide any of
   them (it is the notices' minimum hold, and refused for 等待确认).
10. **动作导入 DONE (seventh block)** — the motion route finally has its UI: 选择文件夹… / 手动输入路径 / imported
   list with 移除, on its own dialog title, refreshing the 状态 checkboxes from the write's own reply.

11. **The motion readout's lost fields (eighth block)** — `/pet3d/desktop`'s `page.motion` now relays `offered`
    and `routed`, so "the host never served the route" and "nothing is mapped to a state" stopped being the same
    answer. Found by measuring the running app on 2026-10-10, and the same measurement is what proved both halves
    were already running the newest code.
12. **碎碎念 with per-state lines and AI generation (ninth block)** — one box of lines per state, drawn at random
    when that state is entered; 台词来源 built-in / custom / AI; the AI half with DSH's own providers or any
    OpenAI-compatible endpoint, a persona that becomes the system prompt, per-state generation prompts and a
    试一句 button. The chain falls back AI → that state's box → the shipped table, and the request the host sends
    contains nothing but what the user wrote.

**All four of §24's feature items are now DONE, and both import pairs (model + motion) have interface AND UI.**
What is left is the 小尾巴 list, the mapping of clips to states, and the live pass.

### Do these first next session

The ordered list is in **Tomorrow's list** above, right after the table that says which half of the app is already
live. The short version: the ninth pass added host routes and client-half code, so **restart DSH and reload the
page**, then walk the acceptance list in one sitting — including 碎碎念 → 试一句 with the provider you actually
intend to use — **map two or three clips to states** so the motion feature has something to show, then pick from
小尾巴.

### What the 2026-10-10 session changed (kept as the record of the last verified-live round)

| Fix | Where the truth lives |
|---|---|
| the 状态 prompt IS DSH's own running label | the wording (`chat.deepDivingFor`), the live clock, the whale mark and the sweep are the app's; the size is derived from the pet's box and corrected per model |
| the mark is the ANIMATED one | `scripts/whale-asset.mjs` reads DSH's 60-frame APNG out of the installed application, the host serves it at `/pet3d/whale`, and both prompts mask through it (`mask-mode:alpha` + motion + forced-colours gates, with the static SVG underneath) |
| the label is centred on the pet | `projectToCanvas` answers in CSS pixels; both prompts divided by `box.width / canvas.width` (the drawing buffer — devicePixelRatio twice). Measured 89 px off at 1.5×, now 0 |
| 任务完成 actually arrives | `PetMachine.resolve` reads the AGGREGATE's notice out of the snapshot; the aggregate derives it from DSH's own `running` flag going false, so no RPC frame is needed |
| two wheel gestures | on the TEXT it corrects that model's size (`statusScale`, 0.35–4×, 6–160 px, and 1 is dropped); on the PET it resizes the pet and the text with it |
| the line never wraps | `white-space:nowrap`, and both `max-width` caps removed in both surfaces |
| the correction survives a model zoom | `statusScale` was missing from both push lists (`LOCAL_KEYS`, `PANEL_KEYS`), so the next host snapshot answered without it |

**Verified live at the end of that session** (floating window restarted, model m2): `page.status` =
`深度求索中，用时 7分3秒 ···`, `icon: true`, `fontPx: 17.8px` for a 396×540 box, centring offset 0 px, and
`/pet3d/whale` → 200 `image/apng`, 21631 bytes. **Nothing from 2026-10-11 has been seen live yet**: the client
half needs a page reload and the launcher half a DSH restart, and `node scripts/check-profile.mjs` exit 2 is
what "reload the page" looks like.

### Reminders that cost an hour each time they are forgotten

* **Only the suite that covers the change, per task — `node scripts/verify-all.mjs` is the OPERATOR's call.** A
  finished change is verified with the narrowest suite that covers it, the report names that suite instead of
  claiming "all green", and the whole tree runs when the operator asks for it. `AGENTS.md` is the rule, with the
  change→suite table and the two things "partial" never means (no run behind a change, or skipping
  `node scripts/client-chunks.mjs --check`). The "first command of the session" below is that same operator-owned
  run — do not turn it into a per-edit habit, and do not skip it when the operator asks for it.
* **Client-half changes need a page reload; host-half changes need a DSH restart.** The route table, the
  settings store and the whale route are host half; the prompts, the gestures and the state machine are client
  half. `/pet3d/desktop`'s readout is relayed by the LAUNCHER, so a new field in it needs a DSH restart even
  when the page that produces it was reloaded.
* The animated mark is **not** in this repository (`docs/ASSET-CONTRACT.md` §1): a fresh checkout has none
  until `pnpm run fetch:whale` reads it out of the installed DSH, and without it the static SVG is drawn.
* Do not edit the text files with PowerShell — the editor tools only, and re-read a file after every write.
  Expect transient `ReplaceFileW EIO (Win32 1175)` failures on this Synology path; the same edit succeeds on
  a retry a few seconds later.

---

## (previous session) ▶START HERE TOMORROW — state saved at the end of 2026-10-09 (§19)

**The four-clip round (§19) is done and the tree is green (10 suites, 1018 checks).** What changed on
2026-10-09:

| Check | Live value |
|---|---|
| the motion map is a LIST per state | `{ state: [id, ...] }`, one clip drawn at random on state ENTRY; a legacy bare string is still accepted by `core.cleanMotions` |
| the loop/once flag | read from a `pet3d-motions.json` manifest in the motion directory; absent means loop |
| new clips | `scripts/make-vrma-fixtures.mjs` now also writes `pet3d-look-around`, `pet3d-weight-shift`, `pet3d-stretch` (loops) and `pet3d-happy-hop` (one-shot), plus that manifest |
| the settings window | a new 动作 section: one box set per state, the clip list from `/pet3d/motions`, and the count of one-shot clips |
| **still needs a DSH restart** | the HOST half (the manifest read and the `loop` field in the catalog). The renderer half, the panel and the settings page are live on the next window/page load |

**First commands of the session**

```sh
node scripts/verify-all.mjs                                  # expect 10 passed, 1018 checks
node scripts/make-vrma-fixtures.mjs                          # rewrites the VRM + 4 clips + the manifest
node scripts/verify-motion.mjs --model build/fixtures/vrma/pet3d-minimal.vrm \
  --motion build/fixtures/vrma/pet3d-rest.vrma               # 31 checks; real loader, real mixer, the draw and the one-shot
GET http://127.0.0.1:19387/pet3d/desktop                     # `page.motion` says what is playing, `picked` what was drawn
```

**A diagnostic wart worth knowing:** `/pet3d/desktop`'s `modelId` is the launcher's STARTUP argument, and it
still reads `placeholder` — the page loads the real model from the shared settings a moment later. The
rendered truth is `page.motion.kind` (`"vrm"` here), not that field. Making those agree (or documenting it) is
a good first small task.

**A flake you will probably meet (and now can read):** `verify-all.mjs` occasionally fails its `docs` step
while `node scripts/check-docs.mjs` passes on its own. The cause is measured — `check-docs` shells out to every
other suite to read their counts, and under load (it runs right after the browser-heavy `clientchunk` step on
this machine) the nested `client-test` run sometimes reports NO count, which then failed four count assertions
with `null` as collateral. Three consecutive standalone runs passed, and the failure reproduces inside
`verify-all` — so it is load, not logic. `check-docs.mjs` now catches a failing suite, reports WHY on the count
assertion (`<script> exited with N: …`), and still reads the count out of the output when there is one. If it
reds again, re-run; the message now names the culprit.

**Then, in order of value**

1. **Restart DSH, then import the generated clips and map several to 静息态** — the draw only becomes
   visible with two or more clips on one state, and the `loop` flag only exists after the host half is
   reloaded. Command: pointing the generator at the motion directory (`--out`), then the panel's 动作
   section.
2. **Look at the pet and judge the resting pose** — arms hanging, elbows and fingers relaxed, body turning
   slowly, head still following the cursor under the `70° −clipTurn` budget. §18 has the measured numbers;
   what no test can answer is whether it *reads* as natural.
3. **Try the 视线 section** of 模型参数 (曲率 / 满偏距离). It is live, and `0` in either span field means
   "auto = the frame's width".

### 明天要做的四件事（2026-10-08 收工时定下）

**Status on 2026-10-10: item 2 is DONE (§19). Items 1, 3 and 4 are STILL OPEN and are described in full
below.** The operator's live defect reports (DSH's running label, 任务完成, the wheel gestures, the animated
whale) preempted them twice, so they were never started. They remain the intended feature work once the three
small items in ▶START HERE are done.

Each item below is written to be *startable*: where the code already is, what the approach would be, what
"done" means as an assertion rather than an impression, and the trap that will bite. Where a file does not
exist yet it is named in prose rather than as a path, because `check-docs.mjs` requires every backticked repo
path to exist.

**1. 碎碎念 + DSH 状态提醒（the pet talks, and tells you what DSH is doing）— ✅ DONE 2026-10-11 (third pass)**

*Target*: the pet occasionally says something short in a speech bubble — idle remarks, and remarks tied to
session events (turn started / finished, a tool failed, something needs confirmation).

*What it is now*: `core.SPEECH_LINES` (zh + en, keyed by event) plus `core.SpeechMachine` (the throttle: one
line at a time, a held line, no event twice in a row, a drawn idle gap, silence for anything unrecognised);
the app's pet runs the machine and publishes the line WITH the state over `/pet3d/state`; the host flattens and
caps it; the floating window draws it and reports its rectangle, which the launcher unions into the window's
bounds while leaving the area click-through; and the settings window has a 碎碎念 section for the on/off switch
and the three timing numbers. The privacy rule — a bubble never contains session content — is asserted in the
core and in the client probe rather than trusted. The full record is in the third 2026-10-11 block.

*What was NOT done*: the lines are not editable per event in the settings UI (a table in core, not a field set),
and no reaction is wired to expressions or authored motion — the remark is speech only. A tool failure has no
event of its own at the boundary either (only `turn/end` with a reason), so 出错's line covers it.

**2. 多支 VRMA 动作，按状态随机调用（several clips per state, chosen at random）*

*Target*: 静息态3— 支、工作态1— 支（以及成功/失败各一支之类），同一状态每次进入随机抽一支、
*What already exists*: the map is one id per state (`motions: {state: id}`) and `core.cleanMotions` is its
persisted contract; the bytes are cached per id and outlive a model switch; `Scene.random` is injectable;
`describeMotions()` already reports `mapped`, `playing` and per-clip `tracks`/`duration`; the generator
(`scripts/make-vrma-fixtures.mjs`) already builds the wave and the rest clip from a table of rotations and
needs only more entries.

*Approach*: widen the map's value to a list (with the old string form still accepted by the cleaner), pick one
with `Scene.random` when a state is ENTERED, preload every id that state lists, and give each clip a
loop/once flag — today `setLoop(LoopRepeat, Infinity)` is unconditional, and a one-shot clip would leave the
pet frozen in its last frame unless "finished" hands the pose back to the procedural idle or draws the next
clip. Then add the clips: 张望 / 伸展 / 打哈次/ 换重快for resting, a small work fidget, and one each for
success and failure.

*Done means*: `{resting: [a1, a3, a5]}` picks among them (a scripted random can assert "two entries can differ"),
all listed clips are preloaded and reported, the panel offers multi-select, and the counts move in the docs.

*Trap*: the cleaner is a persistence boundary — a stored string from today must keep working. And a one-shot
clip needs an explicit end state, or the pet stands still until the state changes.

**3. 面板统一化（one panel, three surfaces）— ✅ DONE 2026-10-11 (second pass)**

*Target*: the same settings UI wherever they are edited, instead of three drifting copies.

*What it was*: `panel.js` was a shared panel with rows, callbacks and a `sync` contract, loaded by
`lib/desktop-page.html` and used by neither surface; the floating window had its OWN hand-rolled panel inside
`lib/desktop-page.js`; the app overlay kept a copy of the markup in `lib/client.js`; and the settings window is
`lib/config-page.js` plus `lib/config-page.html`.

*What was done*: the shared module is now the only definition — the window builds a whole panel with
`createPanel` (rows, labels, wiring, `sync`), and the app builds its markup with `panelMarkup` from the same
file delivered as the fifth client chunk. The rows the window alone needs (a BUTTON model row, the size
stepper, quit) are options in the definition rather than a second panel. Details, tests and the two bugs this
exposed are in the second 2026-10-11 block at the top of this file.

*Still open from the original target*: the SETTINGS PAGE (`lib/config-page.js` + `.html`) is still its own set of
sections. It already derives every range from `core` (gaze, wind, springs, status), so no label or range is
duplicated — but the page does not build its rows from `panel.js`'s field definitions. If that is ever
wanted it is a page rewrite, not a swap: the 状态/动作/视线 sections have no counterpart in a right-click panel.

*Trap*: the panel is DOM and the pet is canvas — the window has to hold both, which is the union mechanism
again; do not move panel logic into the renderer.

**4. 模型导入（import models from the UI）— ✅ DONE 2026-10-11 (fourth pass)**

*Target*: add and manage model directories from the app, not by editing a config file.

*What was there*: the whole BACKEND, done and tested since §21 — a plugin-owned `pet3d-model-dirs.json`, the
`/pet3d/models` route's `{add}`/`{remove}` with refused paths, and a catalog rebuilt on every request (so an
import is live without a restart). The UI was missing entirely.

*What was done*: the settings window's **模型导入** section — a 选择文件夹… button that opens a NATIVE folder
picker through the launcher (`pet3d:pick-dir` over `desktop/preload.js`; the settings window now gets the preload
it never had), a 手动输入路径 fallback for a window without that bridge, the imported list with 移除 per row, and
the host's own refusal text shown verbatim. The page hands the path to the HOST over `/pet3d/models` and never
writes the list itself, so `PET3D_MODEL_DIRS_FILE` (gotcha 37) still governs every suite. Full record in the
fourth 2026-10-11 block at the top of this file.

*Still unproven*: the dialog in a real window (launcher code — a DSH restart, and a human to click it).

### 小尾巴（不阻塞，随手可做）
* ✅ **The size preference is split** (2026-10-11): `size` is the in-app pet's, `windowSize` the floating
  window's, with an older profile's single value migrating to both. The launcher needs a DSH restart.
* ✅ **`/pet3d/desktop`'s `status.scale` is relayed** (2026-10-11) — launcher code, so a DSH restart.
* ✅ **The 完成 prompt follows the 状态 持续时间** (2026-10-11, `core.doneWindowMs`), with `NOTICE_WINDOW_MS` as
  the floor rather than the ceiling.
* ✅ **The `{duration}` token is documented in the settings page** (2026-10-11), in the 状态 section's own hints.
* ✅ **The floating window remembers where it was put** (2026-10-11): `placementX`/`placementY` survive
  `cleanPreferences` and travel in the window's push list, so a drag is not undone by the next snapshot.
* ✅ **面板统一化** (2026-10-11): `panel.js` is the only panel definition — the window builds a whole panel
  with `createPanel`, the app builds its markup with `panelMarkup` from the same file as a client chunk — so a
  row (and its labels) exists once. The settings PAGE is still its own sections; see item 3 above for what that
  would take.
* ✅ **碎碎念** (2026-10-11): the pet's own bubble, both surfaces, with the phrase table and the throttle in
  `core` and the privacy rule asserted. Not done: per-line editing in the UI, and any reaction beyond speech.
  **The bubble makes the floating window taller while it is up** — watch §16's freeze history when judging it.
* ✅ **模型导入** (2026-10-11): the settings page's section — a native folder picker through the launcher, a typed
  path fallback, and the imported list with removal. The DIALOG is launcher code, so it needs a DSH restart.
* **`/pet3d/desktop`'s `modelId` disagrees with what is rendered** — it reports the launcher's startup
  argument (`placeholder`) while the page shows the real VRM from the shared settings. Making them agree (or
  documenting the field as "startup model") is a ten-minute job.
* **The freeze question is still open** (§16): YourMom proves a screen-sized, interactive, transparent window
  can exist without freezing its neighbours, the coverage theory is retracted, and the current pet-sized window
  has never frozen. Not blocking; the rig is kept for whoever wants the real mechanism.
* **VMD→VRM** (§17) is research only: the retarget formula, the name-table gap and the four blockers (leg IK
  needing the source PMX, rest-pose alignment, whole-body translation, interpolation/morphs) are written down.
* `HEAD_LAYER_LIMIT` (70°) and `MOTION_FRAME_MARGIN` (1.35) are constants; both are obvious candidates for the
  settings window now that the 视线 section proves the pattern.
* Motion maps are global per state rather than per model, so one set of clips has to serve a VRM and a PMX.
* `make-vrma-fixtures.mjs`'s HTTP transport times out on Edge's importer noise; its file transport reports 26
  checks fine, so the probe is not silent about it.

---

## 1. What this is

A 3D desktop pet plugin for DeepSeek Harness. It renders a VRM/PMX model on a
transparent WebGL layer above the whole app frame and drives its behaviour from
session status.

It is the **3D sibling** of `../dsh-plugin-fatfish-pet` (the 2D sprite pet). They
share a state model and an interaction feel on purpose, so muscle memory carries
across. They are separate plugins with separate installs.

**Both installed at once would draw on top of each other** — both register into
`shell.overlay`. Disable one.

### Decisions already made (do not relitigate)

| Decision | Value | Why |
|---|---|---|
| Project name | `dsh-plugin-pet3d` | sibling to the 2D plugin, not a replacement |
| 3D stack | **vendored three.js + official VRM/MMD loaders** | user's explicit choice: broadest format support over a hand-rolled renderer |
| Dependencies | pinned in `vendor/`, built into one committed chunk | runtime stays dependency-free and offline-capable |
| Sample model | **none shipped** | VRM/MMD licensing forbids redistribution; placeholder avatar instead |
| Sample motion | **none shipped, but synthesized on demand** | motion files are licensed separately from models; the fixtures are generated by script, so they carry no third-party terms |
| Physics | **off for MMD, on for VRM SpringBone** | determinism and exact idle loops |
| Idle motion | **procedural, 8 s period, still the default** | loops exactly, no `.vmd`/`.vrma` needed |
| Authored motion | **opt-in, per state, supersedes the idle only for that state** | the user asked for it; keeping the idle as the default preserves the "no asset needed" property |
| Motion scope | **`held`/`falling`/`landing` never overridable** | those poses belong to the drag physics; a clip that moved the body mid-air would fight where the pet lands |
| VRM motion format | **`.vrma` only** (`@pixiv/three-vrm-animation`) | VRM humanoid bones; there is no correct general VMD→VRM mapping |

---

## 2. Environment

* **Node.js ≥22** — for every script and all Node suites. **No `npm install` is
  needed to run or verify the plugin**; the vendor chunk is committed.
* **A Chromium-based browser** — for the `clientchunk`, `browser`, `client` and
  `mmd` suites. Auto-detected in the standard Edge/Chrome locations; override with
  `PET3D_BROWSER`.
* **The installed DSH `app.asar`** — for the `clientchunk` suite only, because that
  suite runs DSH's own client module system instead of a copy of it. Found at the
  standard Windows install path; override with `PET3D_DSH_ASAR`. Without it the
  suite is skipped.
* **Node only for rebuilding the 3D chunk** — `cd vendor && npm install` pulls
  esbuild + three + three-vrm + three-vrm-animation + three-mmd. Not needed
  otherwise.
* **A GPU-free machine is fine**: headless WebGL runs on SwiftShader.

Check it all at once:

```bash
node scripts/verify-all.mjs
```

Expected: `9 passed, 0 failed, 0 skipped`.

---

## 3. Verify commands

```bash
node scripts/verify-all.mjs                 # everything, one verdict

node scripts/verify.mjs                     # 520 checks, ~100 ms
node scripts/verify-model.mjs               # 339 checks, ~1.1 s
node scripts/check-plugin-load.mjs          # plugin manifest + activation
node scripts/verify-browser.mjs --page chunk-delivery  # 43 checks, DSH's own loader
node scripts/vendor-build.mjs --check       # the committed chunk is reproducible
node scripts/client-chunks.mjs --check      # the generated chunks match their sources
node scripts/check-docs.mjs                 # 160 checks, docs vs reality
node scripts/verify-browser.mjs             # 13 checks, needs a browser
node scripts/verify-browser.mjs --page client-test   # 70 checks
node scripts/verify-browser.mjs --page mmd-probe     # 13 checks, needs a fixture
node scripts/verify-desktop.mjs            # 129 checks; the live windows skip without an install
```

Read what a model actually contains — expressions, the morph targets each one drives, spring bones,
materials, textures — straight out of the GLB, with no engine and no browser:

```bash
node scripts/vrm-report.mjs "F:/SynologyDrive/FatFish-pet/Models/蓝色小肥鱼vrm"          # readable
node scripts/vrm-report.mjs "<model.vrm>" --json                            # same data, JSON
node scripts/vrm-report.mjs "<model.vrm>" --thumb thumb.png                 # the model's own picture
```

Both VRM flavours are handled (0.x `VRM.blendShapeMaster` / MToon
`materialProperties`, and 1.0 `VRMC_vrm` / `VRMC_materials_mtoon`). A worked
example — every expression, the reverse map to morph-target indices, 22 spring-bone chains and the
licence the author wrote into the file — is in `docs/models/蓝色小肥鱼md`.

Talk to a **running** app's own plugin routes — no browser and no auth needed for
these paths, which is what makes it the fastest way to tell "the plugin is live"
from "the plugin is not":

```bash
node scripts/live-probe.mjs                          # catalog / motions / models
node scripts/live-probe.mjs --id-race                # the model-id property of §11
node scripts/live-probe.mjs --add "D:/models"        # import a directory, live
node scripts/live-probe.mjs --asset m1               # stream one model's bytes
```

Regenerate the three source chunks after editing `lib/core.js`,
`lib/placeholder.js` or `lib/pet3d.js` — and check them in CI:

```bash
node scripts/client-chunks.mjs              # writes lib/client.{core,placeholder,scene}.js
node scripts/client-chunks.mjs --check      # fails if a generated copy has drifted
```

Download the model fixture the `mmd` suite needs:

```bash
node scripts/verify-model.mjs --fetch
```

The motion suites are **not** part of `verify-all.mjs`, because they need a model
and a motion file that this repository cannot carry. Synthesize both (no network,
no third-party terms) and run them:

```bash
node scripts/make-motion-fixtures.mjs        # -> build/fixtures/motions/pet3d-test.vmd
node scripts/make-vrma-fixtures.mjs          # -> build/fixtures/vrma/{pet3d-test.vrma,pet3d-minimal.vrm}

node scripts/verify-motion.mjs --model build/fixtures/miku/miku_v2.pmd \
  --motion build/fixtures/motions/pet3d-test.vmd

node scripts/verify-motion.mjs --model build/fixtures/vrma/pet3d-minimal.vrm \
  --motion build/fixtures/vrma/pet3d-test.vrma
```

Load any real model you own and render it to a PNG, with measurements:

```bash
node scripts/vrm-probe.mjs --model "D:/models/Yours.vrm"
```

Diagnostics that are kept runnable on purpose:

```bash
node scripts/verify-browser.mjs --page framing-diag   # measured box vs framing transform
node scripts/verify-browser.mjs --page vendor-probe   # the raw chunk in a browser
```

`scripts/verify-browser.mjs --page <name>` runs any body in `build/probe/<name>.js`
with the real sources inlined, which is the fastest way to test a change to the
scene. `scripts/vrm-probe.mjs` and `scripts/verify-motion.mjs` instead serve their
model over a loopback HTTP server — see gotcha 14 for why that forces an async
browser launch, and **gotcha 40 for why both of them currently cannot pass on this
machine** (this Chromium hands `fetch` an empty body under `--virtual-time-budget`).
Do not spend a session re-running them here: use `scripts/live-probe.mjs` against the
running app instead, which is not subject to virtual time.

---

## 4. What is done

| Piece | State |
|---|---|
| `lib/core.js` — state machine, physics with wall and ceiling bounce, framing, idle motion (sway only, no vertical term), the per-state motion map (a list per state, legacy single-id accepted, the shared helpers), the per-state per-clip 循环/单次 + 表情 + 口型 settings, per-state one-shot intervals, the node-name and spring-chain-key rules, the preview channel, the frame-derived size limits, pointer aim, the VRM stand rotation | done, 471 checks |
| `lib/placeholder.js` — procedural avatar | done, verified in a browser (47 meshes) |
| `lib/pet3d.js` — scene, VRM/PMX/glTF loading, idle applier (both-eye blink), VMD/VRMA playback, the per-state draw and the one-shot end state, VRM stand + bone sync, camera orbit, gaze from an aim | done, verified with a real PMD and a real VRM |
| `lib/client.js` — slot, pointer, wheel zoom inside the frame's own limits, drag reaction on first movement, right-drag orbit, gaze beyond the frame, settings, per-state motion box sets, session bridge | done, 66 checks |
| `lib/client.{core,placeholder,scene}.js` — the generated delivery chunks | done, 43 checks against DSH's real loader |
| `lib/index.js` — boundary stream, model catalog, motion catalog with its per-directory loop manifest, asset routes, imported-directory route, the window's page/sources/control routes, the settings store and the transient preview channel | done, 339 checks |
| `lib/client.vendor.js` — three r186 + three-vrm 3.5.5 + three-vrm-animation 3.5.5 + three-mmd | rebuilt and hash-pinned |
| Verification: 10 suites, 1141 checks | all green |
| Documentation | README, ARCHITECTURE, ASSET-CONTRACT, vendor README, this file |

### Authored motion, specifically

| Piece | State |
|---|---|
| `.vmd` playback on PMX/PMD | **verified**: a bone rotates 82.95° from rest over the clip (90.52° on a time-varying variant); 38 checks (the draw and the one-shot are asserted on this path too) |
| `.vrma` playback on VRM | **verified**: a normalized bone rotates 19.39° and the raw skinned bone follows it identically; 31 checks — including on the real 25 MB VRM 0.x below |
| Per-state assignment | done: **several clips per state**, one drawn at random on state entry, 8 states configurable, `held`/`falling`/`landing` excluded |
| Loop / one-shot | done: declared per directory in `pet3d-motions.json`, absent means loop; a one-shot hands the pose back and is latched against a restart |
| Interaction with the drag physics | **verified**: `playingWhileHeld` is null — the clip drops out for the drag states and resumes after |
| Failure handling | **verified**: a non-motion payload is refused with a reason, and the pet still renders after a malformed motion |
| VMD camera / light / self-shadow tracks | **not played** — only bone and morph tracks |

### What is *not* done

- [x] **Installed in a live profile, and the pet was seen — 2026-10-08.** Installed
      hot into this machine's `~/.dsh/profiles/desktop` through the plugin manager's
      `install_bundle`. The pet appeared in `shell.overlay`, rendered the procedural
      placeholder, and its routes answered 200. Details and caveats in §11.
- [ ] **No real model has been loaded through an *installed* plugin, yet.** A real
      26 MB VRM 0.x (kept outside this repository) renders through the scene code via
      `scripts/vrm-probe.mjs`, and a real PMD is exercised by the `mmd` suite — and
      the live asset route was confirmed to stream that 26 MB file byte-for-byte — but
      the model has not been *loaded and displayed* inside the app. The live session
      made it reachable: the model directory is now imported, so the picker lists both
      VRMs. See §11 for the one step that is left.
- [x] **The composition has a `webServer` service — confirmed 2026-10-07** by asking
      the live host through the `Service` inspect provider:
      `register(route: WebRoute): () => void` with `kind: 'exact' | 'prefix'`, and a
      duplicate `(kind, path)` throws. So `/pet3d/asset`, `/pet3d/motion`,
      `/pet3d/catalog`, `/pet3d/motions` and `/pet3d/models` have a carrier.
      **The first live run then proved the subtle half of this**: reading the service
      once with `ctx.get('webServer')` during `apply` missed it, nothing re-runs
      `apply`, and `/pet3d/catalog` answered **404 in the app** while the pet itself
      rendered. The fix is `ctx.inject(['webServer'], — ` — declarative, so Cordis
      calls back when the service appears and disposes the scope if it goes away —      kept optional on purpose, because a hard `inject` in a composition with no web
      server would leave the plugin waiting for activation forever. That fix has run
      against a stub (`check-plugin-load.mjs` drives a late-arriving web server) and
      **has not been seen in a live app.**
- [ ] **The `/pet3d/models` route has no client UI.** The host half is complete and
      covered over real HTTP (list, add, remove, persistence, refusals), but
      `lib/client.js` never calls it, so a user cannot import a directory from the
      settings panel yet. Extra directories still have to be named in the plugin
      config. Recorded in `docs/ARCHITECTURE.md` under Known limits.
- [ ] **`ctx.remote.pet3d` is still unproven, and is now deliberately optional.**
      The client `Service` catalog publishes layout, locale, sessions, slots, theme,
      timer, uiWorkspace and workspaces — there is no `remote` entry, and no
      `connection` entry either. The shipped chat plugin does inject `remote`, so the
      name is real, but the catalog is not the whole story and a third-party binding
      is exactly what was never verified. So the client half lists neither in
      `inject`: an unsatisfiable hard dependency would leave the entry *waiting for
      activation forever*, which looks identical to the pet never appearing. The
      stream is resolved with `ctx.get('remote')` instead, and the pet runs on the
      React status hooks without it.
- [ ] **No `.vmd`/`.vrma` motion has been seen in the live app**, only through the
      probe harness.
- [ ] **VMD IK and grant solving with a motion loaded** is untested against a model
      that actually uses them.
- [ ] No DRACO/KTX2 (deliberate; see `vendor/README.md`).
- [ ] Not published to npm.

---

## 5. Immediate next steps

0. **▶ THE OPEN ITEM (operator, 2026-10-12, end of session). This is what to do next; the older items below are the
   standing state of the install.** The other item the operator left — 「如果设置了AI碎碎念，就停止输出内置的碎碎念」 — was
   FINISHED in the forty-first pass (see the first dated entry); its long form is kept below as the record, with the one
   correction the pass had to make.

   **(a) ✅ DONE (forty-first pass): 「如果设置了AI碎碎念，就停止输出内置的碎碎念」 — the shipped PART lines followed the source.**

   The rule already exists for STATE events and is worth reading before touching this: the nineteenth pass's
   「开启AI碎碎念或者自定义碎碎念之后，关闭内置的默认碎碎念」 made `pickSpeechLine(language, event, random, previous, custom,
   tableAllowed)` take the mode as its SIXTH argument, and `SpeechMachine.observe` passes `speech.source === 'builtin'`
   for both the event and the idle branch — one place decides, so the two branches cannot drift (§ the nineteenth-pass
   entry for why an empty box in AI mode means SILENCE rather than DSH's line).

   What that rule did NOT cover, because they did not exist until the fortieth pass, were the shipped 碎碎念 of a PART —
   and the forty-first pass gave them the same argument:

   | where | before | now |
   |---|---|---|
   | `core.partSpeechLines(item, tableAllowed)` (`lib/core.js`) | `item.speech.lines` if the user wrote any, else `DEFAULT_PART_LINES[region]` — **source-blind** | the shipped table only when the source is `builtin`; the user's own box is checked FIRST and counts in every source |
   | `SpeechMachine.react` (`lib/core.js`) | called it with no mode | passes `speech.source === 'builtin'`, the SAME expression `observe` uses |
   | `reactToPart` (`lib/desktop-page.js`) | called it with no mode | passes the same, still guarded on the function so an older delivered chunk loses the argument and not the pet's voice |
   | the 部位 row's placeholder (`lib/config-page.js`) | 「碎碎念：留空则说内置的 变态！ / 大色狼！」 whatever the source was | that only while 台词来源 is 内置短语; under AI the box says it is a fallback while the model writes |

   **The trap this file predicted was WRONG, and measuring it is part of the pass.** §5 used to say the source `change`
   handler does not repaint the 部位 table. It cannot matter: 部位 (`#part-body`, on 模型参数) and 台词来源
   (`#pref-speech-source`, on 通用设置) are on different PAGES, so `renderParts()` on the global page returns at
   `element('part-body')` before doing anything and a model page loaded later draws the placeholder from the stored source.
   **The path that carries a source change to that table is the existing `storage` listener**, which is what the new desktop
   check drives (write the store, dispatch the event, read the placeholder, put the store back). NO repaint was added to
   the picker's handler — a call that can never fire is worse than none — and the comment there says all of this.

   * **The shipped part PROMPT (`core.partSpeechPrompt`) is still NOT part of this rule** — confirmed at the site, and it is
     why this is a small pass: it is the instruction the host sends the model (「被主人摸到胸部了，必须要傲娇的回骂…」), not a
     line the pet says, and switching it off with AI mode would delete the operator's own text for exactly that mode.
   * **The assertions that encoded the old behaviour were FLIPPED, not deleted:** `scripts/verify.mjs`'s
     「in AI mode the shipped line is what the pet says while the model thinks」 now requires `null` plus the request standing
     beside it, its `custom`-source fixture moved to `builtin` (where the shipped lines belong) and a new `custom` sibling
     asserts the press falls through to the state's own box. `build/probe/client-test.js`'s `shippedPressOk` runs on the
     shipped `builtin` source, as this file predicted, and gained a sibling press under `ai`.

   Run set per `AGENTS.md`, all run and reported in the fortieth-first entry: `verify.mjs` (core — the rule and the
   machines), `verify-desktop.mjs` (the page's placeholder and the readout), `verify-browser.mjs --page client-test` (the
   window's press path), `check-plugin-load.mjs` (the cross-surface static guard), then `client-chunks.mjs` because
   `lib/core.js` is a delivered chunk.

   **(b) 「继续修复状态显示」 — ask before changing anything.** ← **THE ITEM STILL OPEN.**

   No reproduction came with it, and this line has been "fixed" several times (the 17th pass's 失联 label, the 18th's
   DSH 用时 clock, the sixth's two WAITING notices, the 22nd's 视线 readout). What it covers, in the operator's words
   「状态显示」, is one visible thing with many parts: the per-state box sets on the 通用设置 page's 状态 section, the whale
   mask, the live clock, the tone (任务达成 gold / 出错 red), the rectangle and the font scale — and the SAME line drawn by
   BOTH halves (the pet inside DSH and the floating window), which is why AGENTS.md's symmetry rule applies.

   Ask for: which surface, which state, what it shows, what it should show. Then check the three places this line has
   failed before, in this order:
   1. **The launcher's copy list** — `announce()` in `desktop/main.js` (the `scale:` line among others) relays a FIXED
      list of fields out of the window's published state. A field the page publishes but the launcher does not relay
      looks exactly like a page that never published it; that class of bug has already happened twice (`status.scale`,
      and the motion readout's `offered`/`routed`).
   2. **The staleness path** — `/pet3d/state` answers `state: null` once the in-app half's report ages out (`stale`),
      which is how a frozen label is supposed to clear; a label that outlives its report is the defect the 17th pass
      measured.
   3. **The clock and the duration rules** — the turn clock comes from DSH's OWN running flag rather than from a
      boundary frame, 等待确认's 持续时间 field is refused (a clock may not end an answer), and `done`/`error` use the
      notice hold.

   Tests that pin what must not move: `verify.mjs` (the status tables and machines), `verify-desktop.mjs`
   (`motions.statusTexts` / `statusAnimations` / `statusRows`, the tones, the refused field), and
   `verify-browser.mjs --page client-test` (the `status` block: text, clock, icon path, rectangle, scale, tone colours,
   and cleared-on-null). A fix that changes the status line without moving one of those is a fix that changed nothing;
   one that moves the count needs the docs' totals updated in the same pass.

1. **This machine (2026-10-08): the plugin IS installed and live.** It was installed
   hot with the plugin manager — no restart — and the pet appeared. The profile state
   now is:

   | Thing | State |
   |---|---|
   | `dependencies["dsh-plugin-pet3d"]` | `link:F:/SynologyDrive/FatFish-pet/dsh-plugin-pet3d` |
   | `dsh.profile.bundles` | includes `dsh-plugin-pet3d` |
   | `dsh-plugin-whale-pet` | still a dependency, **disabled** and no longer in `bundles` (both pets own `shell.overlay`) |
   | imported model directories | `F:\SynologyDrive\FatFish-pet\Models` (persisted in `pet3d-model-dirs.json`) |
   | `cordis.yml` | **materialized**: the plugin manager wrote the flattened bundle composition over the empty entry list (69 KB). It does not name `pet3d` — that row comes from the bundle's own patch — and `cordis.patch.yml` is untouched |
   | backups before the install | `package.json.bak-pet3d-2026-10-08T09-15-28`, `cordis.patch.yml.bak-pet3d-2026-10-08T09-15-28` |

   **What is left, and it needs a restart:** the running host half is still the
   *pre-fix* code. Editing `lib/index.js` does **not** hot-reload — this composition
   watches no module roots (`hmr.config.root: []`), so §11's model-id fix takes effect
   only after DSH is restarted. Nothing else is pending.

   To reinstall from scratch on the next machine, either route works:

   * **The plugin manager, live** (what was used): a `link:<absolute path>` spec to
     `install_bundle`. This DSH build (0.2.0-rc.2) applies it to the running profile,
     so the session doing the debugging survives.
   * **The manual installer**, which needs a restart:

     ```bash
     node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
     node scripts/check-plugin-load.mjs --profile "$HOME/.dsh/profiles/desktop"
     # -> plugin load preflight: PASSED
     ```

   Either way the preflight must print `PASSED` before anyone looks at the screen, and
   the other pet must be disabled first — `plugin_manager set_bundle` does that without
   uninstalling. Note that a plugin-manager operation rewrites the profile
   `package.json` and `cordis.yml`, which is exactly how the 2026-10-07 install was
   silently dropped once: whichever pet you want active must be the one the manager
   knows about.

   **History from the 2026-10-07 attempt on the other machine** (paths there were
   `D:\SynologyDrive\…` and the rollback is in §9): the install replaced
   `@linxin666/dsh-pet`, and the swap had to remove that package from
   `dependencies` **and** `bundles` **and** delete its `cordis.patch.yml` row —   an `insert` row for a package that is no longer a bundle is an unresolved plugin
   row, and DSH fails the entry rather than ignoring it. The `.bak` / patch files that
   restore it are still in that profile, not in this one.

   If the pet does not appear, `scripts/live-probe.mjs` answers "is the host half
   live" in one command, and `node scripts/verify-browser.mjs --page chunk-delivery`
   reproduces the client delivery path with DSH's own loader. The client chunk suite
   now finds this machine's installed `app.asar`
   (`F:\DeepSeek\Harness\resources\app.asar`) by itself; `PET3D_DSH_ASAR` is only
   needed for an unusual install path.

2. **Observe, in this order.** Each step isolates one unknown:
   * Does the pet appear at all? If not, the slot registration or the chunk delivery
     failed — check the console for `pet3d:` lines, then inspect the DOM for a
     `[data-pet3d]` wrapper. That attribute carries `loading`, `ready` or `error:…`,
     so its absence means the slot never rendered, while `error:…` names the cause.
   * Does it render the **placeholder**? If the canvas is blank, the failure is in
     `Scene`/`initScene`, not in model loading.
   * Open settings (right-click). Is the model list populated? If it shows only
     "Built-in placeholder", `/pet3d/catalog` is not being served. The composition
     *does* have a `webServer` (confirmed — see §4), so a failure here is the
     plugin's own `register` call, not a missing service.
   * Configure a model. Does `/pet3d/asset` return bytes? Does the model appear?
   * Does the **status stream** work? The pet reacts either way, so compare: turn
     boundaries make it celebrate and notice failures, while the React status hooks
     alone give coarser changes. `ctx.remote.pet3d` has still never been exercised
     for a third-party plugin, and it is deliberately not a hard dependency — see
     the note in §4. Silence here is an expected, survivable outcome.
   * Configure a **motion** on a model of the matching kind. Does the dropdown list
     it, and does the pose change? If the track count reads 0, it is the bone-name
     trap in `docs/ASSET-CONTRACT.md`, not a broken file.
3. **Fix whatever step 2 exposes**, then re-run `node scripts/verify-all.mjs`.
4. **Consider** VMD camera/light track playback or `.vpd` pose loading, if a user
   asks — `VPDLoader` and `applyVPD` are already in the vendored graph.

---

## 6. Gotchas already paid for — do not re-learn these

These all cost real time. Each has a test or a comment at the site.

1. **`three/addons/.../DRACOLoader.js` and `KTX2Loader.js` cannot be bundled into an
   IIFE.** They build decoder URLs from `import.meta.url` as a module side effect,
   so importing either throws `TypeError: Invalid URL` at chunk load and takes the
   whole chunk down — with an error that names neither. They are omitted.

2. **three.js composes a world matrix as T · R · S.** An offset on the *same node*
   as a scale is not itself scaled, so the pet sinks by `box.min.y * (1 - scale)`.
   `computeFraming` returns both `offset` (local, for a node inside the scaled one)
   and `worldOffset` (pre-scaled, for one node). Both are asserted.

3. **`Box3.setFromObject(obj, true)` is not `setFromObject(obj, false)`.** The `precise`
   path transforms every vertex; the non-precise path unions transformed geometry
   boxes. They can differ by millimetres. Mixing them across a measurement and its
   verification invents a framing bug. The project uses `false` everywhere.

4. **`MMDLoader` has no public `parse(buffer)`, and no `loadPMX` / `loadPMD`.**
   `parse` is three's abstract no-op, its readers are not exported, and the only
   load entry point is `load(url, ...)` — the loader sniffs PMD from PMX itself.
   Getting this wrong cost the project a real, long-lived bug: `Scene.parse` called
   `loader.loadPMX` / `loader.loadPMD`, so **every PMX/PMD model threw
   `loader[handling] is not a function` and silently fell back to the placeholder**,
   and the `mmd` suite never caught it because that probe drives `MMDLoader`
   directly instead of through `Scene.parse`. Fetch the bytes, then hand them back
   through an object URL to `load`.

5. **`MMDLoader` needs a real `document`** even when you already have the bytes:
   `assembleMMD` loads textures through `TextureLoader`, which creates an `<img>`.
   This works in a browser and throws `ReferenceError: document is not defined` in
   Node — so MMD material loading can only be tested in a browser.

6. **`@moeru/three-mmd` needs `three >= 0.184`,** and `three` removed `MMDLoader`
   from its own addons in r172. Do not "fix" this by pinning three down to r170.

7. **A plugin's `assets/` folder is not served to the browser.** Only
   `/plugins/<id>/client.js` and `client.<name>.js` chunks are. Model bytes must go
   through a host route. This was the single biggest architectural constraint, and
   motion bytes inherit it.

8. **`--dump-dom` does not wait for external `file://` scripts.** A probe using
   `<script src>` reports a false failure. Every `--page` browser suite inlines its
   sources into one page.

9. **Headless WebGL needs `--enable-unsafe-swiftshader`** (and `--no-sandbox`) on a
   machine with no GPU visible to the headless process.

10. **`agents.roots().includes(agent)` is not a safe identity test.** The registry's
    returned objects are not guaranteed to be the same references, and a mismatch
    classifies *every* session as a subagent, turning the pet off invisibly.
    `runtimeIdentity` compares by id.

11. **`.asm`-style file locks.** This folder is in Synology Drive. Consecutive rapid
    writes to one file intermittently fail with `ReplaceFileW EIO` (Win32 1175) or
    "file changed since read". **Wait a few seconds and retry** — do not conclude the
    file is corrupt. `edit` frequently needs a fresh `read` first for the same reason.

12. **The shell sandbox could not grant write ACLs on this folder** in the session
    that built this (`SetNamedSecurityInfoW failed (Win32 5)`). Every `pwsh` call
    failed until the file policy was raised to full access. If commands fail
    instantly with that message, it is not your command.

13. **esbuild tree-shakes anything `vendor/entry.js` does not list, and the browser
    code only ever reads symbols off `__PET3D_VENDOR__`.** So a missing bag entry is
    a missing function at runtime, with no build error. This already bit once:
    `VMDLoader.load()` returns a parsed `VmdObject`, and `buildAnimation` — the
    separate export that turns it into a playable `AnimationClip` — was imported
    nowhere, so it was shaken out and the plugin shipped a `.vmd` parser with no way
    to build a clip. It only fails when a user picks a motion. After touching
    `vendor/entry.js`, confirm the name survived:
    `grep -c buildAnimation lib/client.vendor.js`.

14. **A probe that serves its model from an in-process HTTP server must launch the
    browser asynchronously.** `execFileSync` blocks Node's event loop for the whole
    browser run, so the server in the same process cannot accept the connection or
    answer the page's `fetch`; the page then idles until `--virtual-time-budget`
    expires and the browser exits non-zero, which looks exactly like "the model
    failed to load". Use `promisify(execFile)` and **await** it. Also capture the
    browser's stderr rather than discarding it, and print its tail on failure — the
    first diagnosis of this cost a run to a bare "Command failed".

    **Measured, because the failure misreads as an environment limit.** One process,
    one listener, the same client code, only the launch style changed:

    | Launch | Child said | Server logged |
    |---|---|---|
    | `spawnSync` | nothing, `ETIMEDOUT` | **0 requests** |
    | `spawn` (awaited) | `OK` | **1 request** |

    The OS completes the TCP handshake from the listen backlog while the blocked
    process never calls `accept()`, so the symptom is "the handshake succeeds but
    the HTTP request never arrives, and a separate `curl` gets 0 bytes". That looks
    like sandboxed loopback and is not: `scripts/vrm-probe.mjs` and
    `scripts/verify-motion.mjs` both serve to headless Edge over loopback and pass.
    If a loopback probe hangs, suspect the launch call before the network.

15. **`globalThis.__PET3D_SCENE__` is a namespace object, not the constructor.** The
    class is `__PET3D_SCENE__.Scene`. The global itself is truthy, so a naive
    presence check passes and then construction fails with "not a constructor".

16. **A `.vrma` and a VRM model are both GLB files.** They are distinguishable only
    by the extension named inside the JSON chunk (`VRMC_vrm_animation`), which is
    why `core.detectMotionFormat` reads that chunk and bounds its search to it. Do
    not "simplify" this to an extension or magic-byte test.

17. **The browser probe body in `scripts/vrm-probe.mjs` lives inside a template
    literal**, so a backtick or `${` anywhere in it — **including in a comment** —    terminates the string early and produces a syntax error pointing at prose. This
    was hit three times in one session. Run `node --check scripts/vrm-probe.mjs`
    after every edit.

18. **A VMD binds by exact bone name and drops non-matching names silently.** A clip
    can load, report a plausible duration, build zero tracks for every bone, and
    animate nothing at all. Diagnose with the track count (`describeMotions()`),
    never by assuming the file is corrupt.

19. **`scene.tick()` renders a frame; it does not merely advance physics.** Looping
    it to "let the hair settle" means that many software-rendered frames — 90
    iterations of a 270k-vertex MToon mesh ran for over 20 minutes under SwiftShader.
    Render only the frames a probe actually needs.

20. **`MMDLoader` hands its callback the `MMD` instance itself**, not a wrapper with
    `.mesh` / `.mmd`. `wrapMMD` read `result.mmd`, which is `undefined`, so its
    `updatePhysics` was a silent no-op and MMD IK and the grant solver never ran at
    all. `avatar.mmd` **is** the `MMD`; the code now accepts both spellings.

21. **A `.vrma` animates the *normalized* rig, which is a separate node tree from the
    skinned bones.** Without a `vrm.humanoid.update()` after the mixer advances, the
    clip plays, reports its tracks, and moves nothing visible. **Resolved for the
    procedural path on 2026-10-08, and it was worse than "the breath is invisible":**
    with no sync at all the pet rendered its rest pose, and a VRM's rest pose is a
    **T-pose** — a real 26 MB VRM loaded, rendered, and stood frozen in a T (the
    operator's report). The scene now calls `syncBones()` every frame before the
    SpringBone step, and gives VRM avatars a derived relaxed stand, because the idle
    only ever wrote breathing and gaze and never posed the arms. See §11 and the two
    entries in `docs/ARCHITECTURE.md` (Known limits).
    Two traps remain worth knowing:
    * `update()` propagates **rotation for every bone, translation only for the hips**,
      so a breath implemented as a chest *lift* is discarded no matter how often the
      sync runs. The VRM breath is a chest **pitch** for that reason.
    * a pose reset (`resetNormalizedPose`) restores the model's own rest pose — the
      T — so the stand has to be re-applied there, or every drag snaps the pet back.

22. **A zero-duration clip makes three's `LoopRepeat` compute `time % 0` →`NaN`,**
    which propagates into every bone quaternion and makes the mesh disappear
    entirely. Clips with `duration <= 0` are floored to a single frame.

23. **An authored clip writes bone poses absolutely, so stopping one restores
    nothing by itself.** Without an explicit reset the pet freezes in the clip's last
    frame on every drag and in every unmapped state. MMD resets from a captured
    skeleton rest snapshot; VRM calls `humanoid.resetNormalizedPose()`.

24. **A headless run whose stdout is a pipe can wedge.** `--dump-dom` sometimes never
    returns when the browser's stdout is a pipe, while the identical run finishes in
    about a second with stdout redirected to a file. The symptom is a probe that
    prints its setup lines and then nothing, forever, or a "no report" failure.
    Measured both ways on the same command:
    `node scripts/make-motion-fixtures.mjs | Select-Object -Last 12` hung and then
    failed with no report, whereas `node scripts/make-motion-fixtures.mjs > log 2>&1`
    printed `49 checks passed` and exited 0. **Redirect browser-driven scripts to a
    file, and be suspicious of any "no report" that follows a pipe.**

25. **Do not let a headless probe share the user's browser profile — pass
    `--user-data-dir` pointing at a probe-owned directory.** Superseded and sharpened
    on 2026-10-08; the older form of this gotcha ("never pass `--user-data-dir`") was
    half right for the wrong reason. There are two separate hazards:
    * A **fresh** profile triggers first-run component downloads that starve
      `--virtual-time-budget`, so `--dump-dom` never fires. Suppress that with
      `--no-first-run --no-default-browser-check --disable-component-update
      --disable-background-networking --disable-sync`, and keep the directory between
      runs so the one-time work happens once.
    * **Sharing the default profile is worse than a slow first run.** Edge and Chrome
      are single-instance per profile directory, so with an interactive Edge already
      open the launch is handed to *that* instance: the page never runs headlessly, and
      the model URL surfaced as a **download dialog in the user's own browser**
      (observed 2026-10-08 — a stack of "下载完成 / 25.08 MB" windows, one per probe
      run). `scripts/vrm-probe.mjs` and `scripts/verify-motion.mjs` both launch with
      `--user-data-dir=<repo>/build/browser-profile` now.

26. **`server.close()` never resolves while the browser's keep-alive sockets are
    open.** A script that prints its verdict and then hangs is doing exactly this:
    call `closeAllConnections()` before `close()`.

27. **This loader reads the VMD 64-byte interpolation block out of file order.**
    `pushInterpolation` takes the rotation curve from block bytes 3, 11, 7, 15 and
    the position-X curve from 0, 8, 4, 12. A naive all-`0x20` block is therefore
    **not** linear here — a 60° sweep measured 27.32° at the quarter mark instead of
    30°. If you synthesize a VMD, write each control point at the offset the loader
    actually reads (so `x1 == y1` and `x2 == y2`) or the timing will be silently
    wrong.

28. **A chunk registration's `id` is read unconditionally; `chunk` is an optional
    suffix, not a substitute.** In `ClientModuleSystem.register`:

    ```js
    const ownerId = stripClientSuffix(registration.id);   // line 570: throws on undefined
    if (registration.chunk !== void 0 && !CLIENT_CHUNK.test(registration.chunk)) throw ...
    const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
    ```

    All three shapes were measured against the real loader:

    | Registration | Result |
    |---|---|
    | `chunk` only | **throws** `Cannot read properties of undefined (reading 'endsWith')` — an error that names neither the chunk nor the id |
    | `id` only, spelled `&lt;package&gt;/client.&lt;name&gt;.js` | registers under exactly that id — **correct** |
    | both `id` and `chunk` | registers under the doubled key `&lt;package&gt;/client.&lt;name&gt;.js/client.&lt;name&gt;.js` — a key nothing ever requests |

    So write the full id and nothing else. (Entities above only to keep a doc path
    checker from reading these as real files.)

29. **The registration facade must exist before any bundle runs, and `create` must
    be called while its queue still has entries.** `ClientModuleSystem`'s constructor
    drains `pendingQueue` with `splice(0)` and then replaces the facade's `load`, and
    it refuses a second construction: *"window.__ModuleLoader__.create called after
    module-system boot"*. A test page that installs its facade at the end of the
    document registers nothing and reports zero registrations rather than an error.

30. **A registered bundle has not been executed.** `__ModuleLoader__.load({id,
    factory})` only stores the factory. In the app that is harmless — the loader
    materializes on first import — but a probe that reads the tool's exports
    directly off the global before materializing gets `undefined` and a misleading
    `Cannot read properties of undefined (reading 'createClientModuleSystem')`. Call
    `moduleSystem.materialize(id).exports` first; the web shell uses exactly this
    materialize-then-create order.

31. **Headless Edge caches `file://` pages across runs, and a stale page lies about
    line numbers.** A stack that points into the middle of a comment is the symptom.
    Clear `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache` (or
    `--disable-http-cache`) before believing a stack trace from a probe.

32. **A `\n` inside a `<script>` template literal in a harness becomes a real
    newline in the emitted page, which silently breaks a string literal in the
    page.** `split('\n')` in a script built with a template literal must be written
    `split('\\n')`. This is the same family as gotcha 17 and it fails as a syntax
    error pointing at prose.

33. **The scene chunk must load before the vendor chunk, and the reason is not
    obvious.** The client half's `publish()` calls
    `globalThis.__PET3D_SCENE__.requireVendor(vendor)` when the vendor lands. With
    the vendor ordered earlier, `__PET3D_SCENE__` is still `undefined` at that
    moment, the call is silently skipped, and nothing anywhere reports it — the
    scene would have read the global itself and worked anyway. Order is core,
    placeholder, **scene**, **vendor**: the scene needs the first two because it
    reads their globals when it runs, and it must precede the vendor so the
    hand-off has a receiver. `__PET3D_CLIENT__.handedVendor()` reports what was
    handed over, and the delivery suite asserts it is the vendor chunk's own export.

34. **You cannot spy on `globalThis.__PET3D_SCENE__` from outside the client half.**
    Two attempts failed before the assertion was written against the client's own
    record instead. A stand-in installed before `lib/client.js` is *replaced* when
    the scene chunk loads, so the hand-off hits the real scene and the spy records
    nothing; a stand-in installed after is simply never called. Anything that needs
    to observe this hand-off must be read back from the client, not intercepted.

35. **A `[data-pet3d]` wrapper that never appears is not the same failure as a
    plugin that never activated.** The slot renders that attribute with `loading`,
    `ready` or `error:…`. Check for its absence before concluding the entry failed
    to import — the plugin can be fully active with its slot output missing.

36. **An ephemeral loopback port can be one the consumer refuses to use, and the
    failure reads as a broken *route*.** Windows assigns from the machine's dynamic
    range, and on this machine that range starts at **1024**
    (`netsh int ipv4 show dynamicport tcp` →start 1024, 13977 ports), not 49152. Both
    `fetch` and Chromium reject a list of well-known ports (`fetch`:
    `TypeError: fetch failed` / `cause: Error: bad port`, before a byte is sent;
    Chromium: `ERR_UNSAFE_PORT`), so `listen(0, '127.0.0.1')` has roughly a 1-in-900
    chance of handing out a port nothing will connect to. Measured: the host suite
    died mid-group with `bad port` on one run and passed unchanged on the next, which
    looks exactly like a route that works intermittently. `scripts/loopback.mjs`
    (`listenOnUsablePort`) now binds, checks the port, closes and retries, and throws
    rather than returning a URL that cannot work; every server in `scripts/` that a
    browser or `fetch` talks to goes through it. If a probe ever fails as
    "connection refused" or "bad port", suspect this before the handler.

37. **A suite that resolves a path inside the running profile is coupled to the
    operator's own data.** `PET3D_MODEL_DIRS_FILE` defaults to
    `<profile>/pet3d-model-dirs.json`, so before 2026-10-08 `verify-model.mjs` read
    whatever the live plugin had imported — and its route groups wrote the same file.
    Measured: one live import of a real model directory made the suite report three
    models where one was expected, i.e. a green suite went red for a reason that had
    nothing to do with the code under test, and a test run could have edited the
    user's import list. The suite now points that variable at a scratch file *before*
    any group applies the plugin. Any new `apply`-time path that reads the profile
    needs the same treatment, and the rule generalises: a test may not read or write
    state it does not own.

    **Extended 2026-10-08, evening, and the general rule paid for itself immediately.** The same
    thing was true of the SETTINGS file, one level deeper: `check-plugin-load.mjs` sets both scratch
    paths *after* its first `apply` had already constructed the settings store, and
    `SettingsStore`'s constructor **writes its file at once**. Measured symptom: the live plugin's
    store answered `version: 13` while the file on disk said `version: 1` — a suite run had replaced
    the operator's settings file with a fresh store's snapshot of it. The preferences survived only
    because the constructor reads before it writes, which is luck rather than design, and a group
    that POSTs a patch would have overwritten them. `settingsFileFor` now honours
    `PET3D_SETTINGS_FILE`, both suites set it **at the top of the file, before the first `apply`**,
    and `check-plugin-load.mjs` asserts that the preflight wrote the scratch file. The tell worth
    remembering: **a version counter that goes backwards across a run means somebody else wrote the
    store's file.**

38. **Hot-installing a plugin does not hot-reload it, and editing its host half does
    not either.** `plugin_manager install_bundle` applied live, the pet appeared and
    its routes answered immediately — but a later edit to `lib/index.js` changed
    nothing in the running app, because this composition watches no module roots
    (`hmr.config.root: []`). Verify a live fix with `scripts/live-probe.mjs` before
    believing it: it reported the *old* behaviour (ids still advancing per request)
    while the source and every Node suite already had the fix. A restart is the only
    way to move host code into a running app here.

39. **A profile plugin operation rewrites more of the profile than it names.** The
    2026-10-08 `install_bundle` wrote `package.json` (dependency + `bundles`) *and*
    replaced the profile's `cordis.yml` — a 4-line "empty entry list, edit
    `cordis.patch.yml` instead" file — with the **flattened 69 KB composition of the
    bundles**. It was harmless and the plugin still activates, but the file is no
    longer what its own comment says it is, and it does not become a place to look for
    plugin rows either: `pet3d` does not appear in it at all (its row comes from the
    bundle's own patch). So after any manager operation, neither "read `cordis.yml` to
    see what is composed" nor "hand-edit `cordis.yml`" is right; the patch layer to
    edit is still `cordis.patch.yml`, and the live composition is what the `Config`
    inspect provider reports.

40. **On this Chromium build, `--virtual-time-budget` gives `fetch` and `XMLHttpRequest`
    an EMPTY body — and that looks exactly like a corrupt model.** Measured
    2026-10-08 with Edge 142 on this machine, in a minimal throwaway page whose whole
    job was to report a byte count:

    | channel (same page, same server, 4456-byte body, `content-length` correct) | result |
    |---|---|
    | `fetch().arrayBuffer()` | `bytes=0`, `response.ok === true` |
    | `fetch().body.getReader()` | no chunk at all |
    | `fetch().text()` | `text=0` |
    | `XMLHttpRequest` with `responseType='arraybuffer'` | `bytes=0` |
    | `<img>` load of the same bytes | **works** |

    Consequences:
    * `scripts/vrm-probe.mjs` and `scripts/verify-motion.mjs` **cannot work on this
      machine**. They serve the model over loopback and the page fetches it, so the
      page receives 0 bytes, `detectFormat` says `unknown`, and the probe reports
      "unrecognised model format" — blaming the model for a browser behaviour. The
      probe now detects exactly that combination (the server served the bytes, the page
      got none) and exits 3 with this explanation, instead of a misleading parse error.
      **Do not re-run it in a loop hoping for a different answer.**
    * The four browser suites are unaffected because every one of them **inlines** its
      sources into one `file://` page and fetches nothing (they pass consistently here).
    * A real fix means either a Chromium whose fetch bodies survive virtual time, or
      rewriting these two probes onto a CDP session with real time — the `--dump-dom`
      crutch is what forces virtual time in the first place.
    * **The plugin itself is fine**: the same model bytes were streamed by the *live
      app's* own route (`/pet3d/asset?m=…` →200, 26 MB) and the in-app loader path is
      the one that matters. `scripts/live-probe.mjs --asset <id>` checks it.

41. **One field, two units: `Scene.height` was both the canvas height in pixels and the
    model's height in world units.** `resize()` set it to the drawing-buffer height;
    `frameAvatar()` and `applyPreferences()` then overwrote it with a fraction of a
    world unit (`framing.scaled.y`, ≈.8). `gazeFromPointer` normalises the pointer
    against it —
    ```js
    var ny = (pointerY - this.height / 2) / (this.height / 2);
    ```

    — so after any avatar installed, a pointer 150 px down the canvas produced
    `ny ≈374`, the "too far away" guard returned `null`, and **pointer gaze was dead
    for every model**. It never threw and nothing logged; the head simply never turned.
    The fix splits the fields (`height` = pixels, `modelHeight` = world units), which is
    why the stand/orbit work in §11 found it: anything new that reads "the pet's height"
    has to know which of the two it wants.

    The general lesson, and the reason this is a gotcha rather than a footnote: a unit
    is part of a field's meaning, so two units in one name is not a naming problem, it
    is a bug waiting for a reader.

42. **`lib/client.js` and the chunks it loads are delivered SEPARATELY, under the SAME
    revision — so a symbol added to `lib/client.js` can be used before the chunk that
    defines it is ever loaded.** Measured live on 2026-10-11:
    ```
    /pet3d/state -> {"seq":53,"state":null,"error":"TypeError: this.core.SpeechMachine
                     is not a constructor at new Pet3DWidget (client.js&rev=c7a693d3c03f:704:19)"}
    ```
    The app had the NEW `client.js` (whose constructor builds `new
    this.core.SpeechMachine(...)`) against a `client.core.js` without that symbol — the
    chunk had not been regenerated yet when the page was loaded, or the browser served a
    cached copy under an unchanged `rev`. The widget never mounted, so the IN-APP pet was
    gone, `/pet3d/state` published `state: null` for ever, and the floating window (which
    has no session of its own) kept drawing 工作中 with its clock counting up — reported
    by the operator as "任务完成的提醒又没收到，还在显示深度求索中…".

    Three rules came out of it, and all three are now enforced by tests:

    * **Edit → `node scripts/client-chunks.mjs` → THEN reload.** Never reload between the
      two, and hard-reload (Ctrl+Shift+R) when a chunk changed: the delivered URL's
      revision does not change with the file's contents, so a cached chunk can outlive
      the edit that needed it.
    * **A symbol the core might not have is CHECKED, never required.** `SpeechMachine`
      and the shared panel module are both optional now: a stale chunk costs the voice or
      the panel, not the pet. The client probe builds a widget with both globals deleted
      and requires it to mount.
    * **An absent state is a state.** A channel that reports nothing must CLEAR the prompt
      rather than keep the last one; ignoring a null state is how a window lies for
      seventeen minutes.

    Corollary for diagnosis: `/pet3d/state` carries the client half's own `error`, and the
    launcher now relays `state: {drawn, published, at, error}` into `/pet3d/desktop`. The
    two halves disagreeing is a fact worth being able to read, not something to infer from
    a frozen label.

---

## 7. File map

| File | Role |
|---|---|
| `README.md` | user-facing: what it does, install, quick start, motion |
| `docs/ARCHITECTURE.md` | how the pieces fit; why each boundary is where it is |
| `docs/ASSET-CONTRACT.md` | model and motion requirements, licensing, the bone-name trap |
| `vendor/README.md` | the pinned stack, how to rebuild, the three traps |
| `lib/core.js` | **pure logic.** No DOM, no WebGL. Start here |
| `lib/placeholder.js` | the procedural avatar, from three.js primitives |
| `lib/pet3d.js` | the WebGL scene, loaders, idle and authored-motion playback |
| `lib/client.js` | the DSH client half |
| `lib/index.js` | the DSH host half |
| `lib/client.core.js` | generated from `lib/core.js`. **Do not edit** |
| `lib/client.scene.js` | generated from `lib/pet3d.js`. **Do not edit** |
| `lib/client.scene.js` | generated from `lib/pet3d.js`. **Do not edit** |
| `lib/client.vendor.js` | generated 3D chunk. **Do not edit** |
| `scripts/verify-all.mjs` | run everything |
| `scripts/loopback.mjs` | bind a probe server to a port `fetch`/Chromium accept (gotcha 36) |
| `scripts/live-probe.mjs` | talk to a **running** app's own routes; `--id-race`, `--add`, `--asset` |
| `scripts/client-chunks.mjs` | generate the three source chunks; `--check` for CI |
| `scripts/verify-browser.mjs` | the browser harness; `--page <name>` runs any probe |
| `scripts/verify-motion.mjs` | real VMD/VRMA playback; asserts a bone actually moves |
| `scripts/vrm-probe.mjs` | load any real model, measure it, render it to PNG |
| `scripts/make-motion-fixtures.mjs` | synthesizes the `.vmd` fixture |
| `scripts/make-vrma-fixtures.mjs` | synthesizes the `.vrma` + minimal `.vrm` fixtures |
| `build/probe/*.js` | browser test bodies |
| `build/fixtures/` | downloaded and synthesized sample models (not shipped) |
| `build/probe-out/` | PNGs written by `vrm-probe.mjs` |
| `tools/asar-extract.mjs` | reads DSH's `app.asar` to inspect the runtime |

---

## 8. How this was verified, and what that does not cover

Verified: **874 automated checks** across 361 pure-logic assertions, 258
host/model assertions (including the asset and motion routes and the
imported-directory route over a **real HTTP
server**, adversarial path traversal, disjoint model/motion catalogues, and the
model-id stability the live run proved was missing), a
manifest/activation preflight, a reproducible-build check on the 2.6 MB chunk, and
**four** browser suites: the vendor chunk, the procedural avatar's real geometry,
the framing transform against a **measured** bounding box, a real glTF parse, a real
PMD model (12,354 vertices, 140 bones, 30 morphs) loaded and rendered, the widget
end to end in a real DOM, and — new, and the one that closes the live-install gap — **43 checks that drive DSH's own extracted client module system over the four real
committed chunks**.

That delivery suite is not a simulation of the loader.
`scripts/verify-browser.mjs` extracts `@deepseek-ai/dsh-client-modules/lib/client.js`
verbatim from the installed `app.asar` and runs it in a page whose boot wire keeps
the combo URL shape `chunkUrl` requires. It asserts that each chunk arrives, that its
exports are the same object the old global read produced, that **every requested URL
carries the current `rev` and is a per-package `client.<name>.js` path**, and it
keeps four negative controls alive: a non-`client.<name>.js` request is refused, a
replayed registration is a duplicate error, a registration with no id throws, and a
chunk request from a package outside the boot graph fails. Those four are what make
the page more than a smoke test — the original bug was invisible precisely because
nothing asserted the *shape* of the request.

Verified separately, on demand: **authored motion actually moves bones** — 25
checks for a `.vmd` on a PMD (a bone rotating 82.95°, 90.52° on a time-varying
variant), 18 for a `.vrma` on a VRM (a normalized bone rotating 19.39° with the raw
skinned bone following it identically), plus that a drag state drops the clip and
resumes it afterwards, that a clip whose bone names match nothing is refused with a
reason instead of playing silently, and that the pet still renders after a
malformed motion. The `.vrma` path additionally ran against the real 25 MB VRM 0.x
kept outside this repository, with the same 19.3851° on both the normalized and the
raw bone.

**Not verified, and the reason to be careful:** none of it ran inside the real DSH
application. The plugin has never been seen in a live GUI, and `ctx.remote.pet3d` has
never been exercised for a third-party plugin. One item on this list *was* resolved
without a restart, by asking the live host through the inspect provider: the
composition does have a `webServer` with `register({kind, path, handler})` — see §4.
What the new suite buys is narrower than "it works", and worth stating exactly: **the
chunk-delivery failure of §9 can no longer recur silently.** Nothing in this
repository can tell you whether the pet *appears* — that needs a restart.

---

## 9. The first live load (2026-10-07) — it failed, and the fix is in

### What was done

```bash
node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop" --dry-run
node scripts/install-desktop-plugin.mjs --profile "$HOME/.dsh/profiles/desktop"
node scripts/check-plugin-load.mjs --profile "$HOME/.dsh/profiles/desktop"
```

The dry run and the profile-composition preflight both passed, including
`the package resolves from the profile`, `the profile declares the dependency` and
`the profile lists the bundle`. The install itself was correct and complete, with
the backup at `package.json.bak-2026-10-07T05-55-16-269Z`. DSH restarted normally
and was healthy. **The install has since been rolled back**: the profile is clean
again, so the next attempt is a first install rather than a repair.

### What happened

The pet did not appear. The app showed one notice:

```
pet3d: lib/pet3d.js is not loaded.
```

### Root cause — three verified facts about DSH's own plugin loader

Read from `@deepseek-ai/dsh-client-modules` inside `app.asar` (extract with
`node tools/asar-extract.mjs --asar <app.asar> --get <inner> --out <file>`).
**`app.asar` is a 121 MB archive file, not a directory** — the real filesystem
cannot see inside it, so this tool is the only way in.

1. **Only `client.<name>.js` files are servable at all.** In
   `dsh-client-modules/.../client.js`:

   ```js
   const CLIENT_CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;   // line 470
   ...
   if (!CLIENT_CHUNK.test(fileName)) return void 0;                    // the resource route
   ```

   `client.vendor.js` matches. **`pet3d.js`, `core.js` and `placeholder.js` never
   match, so they are never served**, and `globalThis.__PET3D_SCENE__` /
   `__PET3D_CORE__` / `__PET3D_PLACEHOLDER__` are therefore always undefined in the
   real app. `lib/client.js` reads exactly those globals (lines 261-262) and throws
   the message above. This is the whole of the reported failure.

2. **The URL must carry the exact current revision.**

   ```js
   if (resourceUrl !== chunkUrl(record.entry.id, fileName, record.entry.rev, sourceMap)) return void 0;  // line 922
   ```

   with the comment at line 158: *"Versioned code is immutable; mismatched revisions
   are rejected instead of serving newer bytes."* A request without `?rev=` falls
   through to `{ status: 404 }`.

3. **The old `loadVendor()` could not work either, for two independent reasons** — so
   the 2.5 MB chunk would still not have loaded once (1) was fixed. It did
   `new URL('client.vendor.js', base)`, and:
   * relative resolution **drops the query string**, losing the `?rev=` that fact 2
     requires; and
   * the plugin entry is loaded through a *combo* URL
     (`/plugins/??dsh-plugin-pet3d/client.js&rev=…`), whose pathname is `/plugins/`,
     so the sibling resolves to `/plugins/<id>/client.vendor.js` with the id lost — the wrong path.

   That route survives only as the harness fallback; the app path is the module
   system below.

### The supported mechanism

`dsh-client-modules/.../client.js` line 704:

```js
require.async = async (spec) => {
  if (!spec.startsWith("./")) return await this.import(spec);
  const fileName = spec.slice(2);
  if (!CLIENT_CHUNK.test(fileName)) throw new Error(`client-modules: invalid relative chunk request ${JSON.stringify(spec)}`);
  return await this.importChunk(ownerId, fileName);   // →chunkUrl(row, fileName, rev)
};
```

`chunkUrl()` (line 480) rewrites the plugin's own combo URL into
`/plugins/<id>/<fileName>?rev=<rev>` — exactly what fact 2 demands. And a chunk that
arrives this way **must register itself** (line 739):

```js
if (!this.factories.has(id)) throw new Error(`client-modules: bundle ${url} loaded without registering "${id}" via __ModuleLoader__.load`);
```

where the id is `chunkId(ownerId, fileName)` = `` `${ownerId}/${fileName}` `` (line
477), e.g. `<pluginId>/client.vendor.js`. So each chunk file must contain

```js
window.__ModuleLoader__.load({ id: 'dsh-plugin-pet3d/client.<name>.js', factory: function () { /* — */ } });
```

**The `id` is mandatory and there is no shorter form.** `register` (line 566) reads
it before it looks at anything else:

```js
const ownerId = stripClientSuffix(registration.id);   // read UNCONDITIONALLY
if (registration.chunk !== void 0 && !CLIENT_CHUNK.test(registration.chunk)) throw ...
const id = registration.chunk === void 0 ? ownerId : chunkId(ownerId, registration.chunk);
```

so `chunk` is an optional *suffix* appended to the id — passing both registers under
a doubled key, and passing only `chunk` throws
`Cannot read properties of undefined (reading 'endsWith')`. All three shapes were
measured; see gotcha 28. `require.async` wants the leading `./`: anything else is
treated as an absolute module id.

### Why every suite missed it

Every browser harness **inlines the sources itself** with `<script>` tags
(`scripts/verify-browser.mjs` pulls in `core.js`, `placeholder.js`, `pet3d.js`
directly), so the 37 `client`, 13 `browser` and 13 `mmd` checks all exercise a
delivery path that does not exist in the app. `check-plugin-load.mjs` tests the
**host** half only. So no test in this repository could ever have caught this, and
the then-491-check total was not evidence that the plugin runs.

### The fix — implemented (option A)

Option A was chosen and is in the tree. The three rejected shapes are recorded
because each one was tempting:

* inlining everything into `lib/client.js` works but makes the entry ~2.6 MB
  downloaded on every app start;
* a hand-rolled `<script src>` cannot work at all for the reasons in fact 3;
* a registration carrying only `chunk` throws (gotcha 28).

What is in place:

* **`scripts/client-chunks.mjs`** generates `lib/client.core.js`,
  `lib/client.scene.js` from
  `lib/core.js`, `lib/placeholder.js` and `lib/pet3d.js`. Each generated file is the
  original **verbatim** plus a registration block that republishes the global the
  original already sets. `--check` fails if a copy has drifted, and the same script
  asserts that the owner id it writes, the id `lib/client.js` registers under, and
  `package.json`'s name all agree — a mismatch produces a chunk that can never be
  fetched, with no runtime complaint.
* **`vendor/entry.js` + `scripts/vendor-build.mjs`** now emit `lib/client.vendor.js`
  with **both** deliveries: the module-system registration *and* the
  `globalThis.__PET3D_VENDOR__` assignment the inline harnesses read. The build
  asserts both survived, because esbuild tree-shakes whatever the entry does not
  list.
* **`lib/client.js`** asks for all four chunks through
  `require.async('./client.<name>.js')`, sequentially (the scene chunk reads the
  other two globals when it runs, so neither may be left to a race), and keeps a
  global fallback per chunk so the inlined harnesses still pass. `loadChunks`
  collects every failure and names the files DSH refused, so a future delivery
  regression reports *which* chunk is missing instead of a bare "not loaded".
* **`lib/pet3d.js`** gained `requireVendor(vendor)` and a three-argument
  `loadVendor(baseUrl, timeoutMs, require)`: the module system is tried first, and
  the old `<script src>` route survives as the harness path and as a fallback if a
  future loader drops `require.async`. `lib/client.js` hands the vendor it already
  resolved to the scene, so there is one source of truth for the 2.5 MB graph.
* **The chunk order is core →placeholder →scene →vendor**, and both constraints
  are load-bearing: the scene reads the first two globals when it runs, and it must
  exist before the vendor arrives or the hand-off is silently skipped. See gotchas
  33 and 34.
* **`lib/client.vendor.js`** was rebuilt and the manifest re-pinned.

### The regression test that closes the gap

`node scripts/verify-browser.mjs --page chunk-delivery` — 43 checks, and part of
`verify-all.mjs` as the `clientchunk` suite.

It is deliberately not a stub. The harness extracts
`@deepseek-ai/dsh-client-modules/lib/client.js` **verbatim from the installed
`app.asar`** and runs it in a page alongside the four real committed chunk files,
which it hands to the loader's transport as payload strings rather than inlining
them as `<script>` tags — so the URL the loader composes is observable and the
assertion about it means something. It then:

* boots the module system over a boot wire whose pet3d row keeps the combo URL shape
  `chunkUrl` requires;
* asserts the client entry registered under the package name, materializes it, and
  gets back a plugin with `inject` and `apply`;
* loads every chunk through `require.async` exactly as `lib/client.js` does, and
  asserts each one's exports is the **same object** the old global read produced;
* asserts every requested URL carries the current `rev` **and** is a per-package
  `client.<name>.js` path — the two things the old path got wrong;
* asserts the client half **handed the vendor graph to the scene**, read back from
  `__PET3D_CLIENT__.handedVendor()` because spying on `__PET3D_SCENE__` cannot work
  (gotcha 34) — this is the assertion that caught the chunk-order bug above;
* keeps four negative controls, so the page cannot pass by accident: a
  non-`client.<name>.js` request is refused, a replayed registration is a duplicate
  error, a registration with no id throws, and a chunk request from a package outside
  the boot graph fails.

Building it paid for itself twice: it revealed that a `chunk`-only registration
throws, which the design in the previous revision of this file had wrong, and then
that the vendor chunk was being loaded before the scene that receives it.

### Rollback

The install has already been rolled back, so the profile is clean. The same commands
work for a future attempt:

```powershell
Copy-Item "$HOME\.dsh\profiles\desktop\package.json.bak-2026-10-07T05-55-16-269Z" "$HOME\.dsh\profiles\desktop\package.json" -Force
Remove-Item "$HOME\.dsh\profiles\desktop\node_modules" -Recurse -Force
```

### Evidence commands

```powershell
# which port the app listens on, then whether plugin resources are served
$pids = (Get-Process -Name 'DeepSeek Harness').Id
Get-NetTCPConnection -State Listen | Where-Object { $pids -contains $_.OwningProcess } |
  Select-Object LocalPort -Unique
```

An unauthenticated request to `/` returns **401**, and unknown paths return **404**,
so raw `curl` cannot confirm what the browser can fetch. The loader source above is
the authority, not a probe.

---

## 10. What is still unproven, and how to prove it

The delivery fix closed one failure; it did not close the question "does the pet
appear". The 2026-10-08 live session (§11) answered the first three rows below for
this machine; the rest is ordered because each answer narrows the next.

An important caveat about the rows marked *observed live*: unless the row says
otherwise, they were observed on **2026-10-08 on this machine**.

| Unknown | How it shows up | What to read |
|---|---|---|
| Does the client half receive its four chunks? | the pet appears, or a badge names the files DSH refused | console `pet3d:` lines, and the badge text, which is built from the refused file list. **Answered: the pet rendered** |
| Is `shell.overlay` accepting the registration? | a `data-pet3d` attribute on a wrapper div, carrying `ready` or `error:…` | inspect the DOM for `[data-pet3d]`; the live `Slots` inspect provider lists the occupants of `shell.overlay` by id. **Answered: `pet3d`, order 80, active** |
| Do the plugin's own `webServer.register` calls succeed? | the settings panel lists models, or offers only "Built-in placeholder" | `/pet3d/catalog` in the network tab, or `node scripts/live-probe.mjs`. **Answered: all three routes answer 200 live** — this is the `ctx.inject` fix working, where 2026-10-07 got a 404 |
| Does a **saved** model survive a reload? | the pet falls back to the placeholder with an "unknown model id" badge | `node scripts/live-probe.mjs --id-race`. **Answered: no** — the defect of §11, fixed in the source, needs a restart to reach the app |
| Does a real model load and display in the app? | the placeholder is replaced by the VRM/PMX | pick one in the settings panel; the two VRMs in `F:\SynologyDrive\FatFish-pet\Models` are importable now |
| Does `ctx.remote.pet3d` bind for a third-party plugin? | turn boundaries arrive, or the pet only reacts to session status | the pet works without it — deliberately not a hard dependency, so silence is survivable |
| Is the pet positioned and sized correctly? | visible but clipped, tiny, or off-screen | the `Placement` fractions and `--page framing-diag` |
| Can a user import a model directory from the panel? | nothing in the settings panel offers it | `/pet3d/models` exists and is verified over HTTP, but `lib/client.js` never calls it — see the Known limit in `docs/ARCHITECTURE.md` |

**Nothing in this repository can answer the rendering questions** — only the app can — and the delivery suite must not be read as though it could: it proves the chunks are
deliverable and requested correctly, which is exactly the thing that was silently
false before.

Parts of it can be answered without reading a screen, and that is now the cheap first
move: `scripts/live-probe.mjs` reports the host half's routes over loopback, the client
`Slots` inspect provider reports the live occupants of `shell.overlay`, and the host
`Config` provider reports whether the Loader composed the `pet3d` entry at all.

---

## 11. The live session of 2026-10-08 — what it proved, and what it found

This is the first time the plugin ran inside a real DSH app, and the first time anyone
saw the pet. Everything here was done on this machine (profile user `LIUHUAN`), with
the running app that this session is itself attached to.

### What was done, in order

```powershell
# 1. Back up the two profile files the manager rewrites.
Copy-Item "$HOME\.dsh\profiles\desktop\package.json"     "...\package.json.bak-pet3d-2026-10-08T09-15-28"
Copy-Item "$HOME\.dsh\profiles\desktop\cordis.patch.yml" "...\cordis.patch.yml.bak-pet3d-2026-10-08T09-15-28"
```

2. `plugin_manager set_bundle dsh-plugin-whale-pet enabled=false` — both pets own
   `shell.overlay`, so only one can be debugged at a time.
3. `plugin_manager install_bundle link:F:\SynologyDrive\FatFish-pet\dsh-plugin-pet3d`
   →`"application": "applied"`. **No restart.** pnpm took 1m54s because it re-checked
   the registry for the *other* dependency in the profile; the install itself was
   offline-capable.
4. Verified, without looking at the screen:
   * client `Slots` →`shell.overlay` occupants: `pet3d` at order 80, `active: true`
     (and no `whale-pet`);
   * host `Config` →one entry, `id: include:pet3d`, `name: dsh-plugin-pet3d`,
     `status: absent` (which means "declares no Config schema", not "not loaded" —     shipped entries show the same);
   * `curl http://127.0.0.1:19387/pet3d/{catalog,motions,models}` →**200 with real
     payloads**, while `/` →401. The plugin's routes need no auth; the index does.
     Scripted as `scripts/live-probe.mjs`.
5. `POST /pet3d/models {add: "F:\SynologyDrive\FatFish-pet\Models"}` →`200`,
   `persisted: true`, `modelCount: 2`. This is the first real use of the new route, and
   it is how the picker got something to offer.
6. Confirmed the byte route streams the 26 MB VRM (`GET /pet3d/asset?m=…` →200).
7. Asked the operator: **the pet appeared, rendering the procedural placeholder.** The
   delivery fix that was written on 2026-10-07 and never tested is now tested.

### What it found: model ids were re-minted on every catalog read

`/pet3d/catalog` calls `rebuildModels()` on **every** request, and `mintModelId()` was
a bare counter rather than a path-keyed map (the motion path already did it right).
The live sequence, reproducible with `node scripts/live-probe.mjs --id-race`:

```
1. catalog                -> id m9          HatsuneMikuNT.vrm
2. asset                  -> 200            the 26 MB file, streamed
3. catalog again          -> id mb          the same file, new id
4. asset with step 1's id -> 404 {"error":"unknown model id"}
```

Why it matters, exactly: `lib/client.js` mounts by doing
`refreshCatalog().then(() => loadModel(preferences.modelId))` — the id it saved in the
previous session — and the catalog it just fetched has already invalidated that id. So
a model the user picked **never survives a page reload or an app restart**: the pet
silently falls back to the placeholder with an "unknown model id" badge. Within one
session the first pick works, which is what makes it look like a flaky model file
rather than a broken id.

The fix (in the tree, not yet in the running app): `mintModelId(absolute)` is memoised
per path, exactly like `mintMotionId`, plus three checks — ids are stable across a
rescan (unit), a catalog read does not change an id, and an id captured before a
rebuild still streams its model over real HTTP. `verify-model.mjs` is now 226 checks.

### The second live report: "it loads, but only in a standard T-pose"

The operator loaded a real model into the app and reported exactly that. It is the
clearest example in this project of a *visible* symptom with two independent causes, and
both are now fixed and measured.

**Cause 1 — a VRM's rest pose IS a T-pose.** The procedural idle writes breathing and
gaze; it never posed the arms, and nothing else did either, so the model simply stood in
its rest pose. Measured on `HatsuneMikuNT.vrm` in an inlined probe (`file://` page, no
HTTP, its own browser profile — see gotcha 40 for why the HTTP-serving probe cannot be
used on this machine):

| state | normalized shoulder→elbow `dy` | skinned (`raw`) `dy` |
|---|---|---|
| after the fix | **−.9662** (hanging, ~15° off vertical) | **−.0823** |
| the model's own rest pose | **0.0** (horizontal — the T) | 0.0 |
| after a pose reset | −.9662 (stand restored) | −.0823 |

The fix derives the rotation from the rig instead of hardcoding signs
(`core.aimDownQuaternion`, unit-tested in `verify.mjs`; `dropArm` in `lib/pet3d.js`
applies it in the bone's own local space and clamps it to 75°), records the result as the
rest pose every additive write builds on, and **re-applies it after every
`resetNormalizedPose()`** — otherwise every drag would snap the pet back into a T.

**Cause 2 — the normalized rig was never copied to the skinned bones.** The idle writes
the normalized humanoid nodes; `humanoid.update()` is what carries them to the mesh, and
only the authored-motion path ever called it. `syncBones()` now runs every frame, *before*
the SpringBone step, so the hair also follows the current pose instead of the previous one.

That second fix exposed a third, smaller trap: `update()` carries **rotation for every
bone but translation only for the hips**, so the old chest-*lift* breath could never have
been visible no matter how often the sync ran. The VRM breath is now a chest **pitch** — measured on the same model: the skinned chest turns 0.54° over ten idle frames, with
0.0008 of positional drift.

Both fixes live in `lib/core.js` + `lib/pet3d.js`, and therefore in the generated
`lib/client.{core,scene}.js` chunks, which were regenerated.

### What it also found: the suite read the operator's real profile

While the live import was in place, the host suite reported three models where one was
expected — because it resolved the imported-directory list from the **running profile**
by default. A user's own imports could therefore turn a green suite red for reasons
that have nothing to do with the code under test, and the route groups could write the
user's list. The suite now redirects `PET3D_MODEL_DIRS_FILE` to a scratch file at the
top of the file, before any group applies the plugin. See gotcha 37.

### The interaction round: wheel zoom, view orbit, size reset, wall bounces

Four requests arrived together, and two of them turned out to be one design problem plus
one long-standing bug.

**The wheel resizes the pet, and the sliders are gone.** `size` (40 %–60 % of a
220 × 300 slot) is now the only size concept: the wheel over the pet drives it, and one
button in the settings panel resets it and reports the percentage. Both range inputs were
removed, `Model scale` included — deliberately, because that one was the bug.

**The "enlarged model sticks out of its frame" report was `modelScale`.** It multiplied
the model's scale inside a slot the camera had already been fitted to
(`root.scale = framing.scale * modelScale`), so enlarging the model pushed it past the
canvas edges while the camera stayed put. `modelScale` is now folded into the SLOT
(`Placement.setSize`), which makes the canvas, the drawing buffer and the camera grow
together, and `applyPlacement` resizes the renderer so a zoomed pet is a bigger render
rather than a stretched bitmap. The slot is also capped at the viewport: a slot wider than
the frame has `maxX === 0`, so it could not be dragged fully into view at all.

**A right-drag orbits the camera.** The secondary button now does double duty — a click
opens the panel, a drag turns the view — and they are told apart by pointer movement
(4 px), not by a timer, because a slow drag and a slow click last the same time. The orbit
is stored as `viewYaw`/`viewPitch` (clamped to ±π and −.45— .95 rad, so the view can
never end up under the floor or over the pet's head) and lives in preferences, so it
survives a model switch and a reload. It moves the CAMERA, so it composes with whatever
pose the idle or a clip is writing, and `refitCamera` scales the horizontal radius by
`cos(pitch)` to keep the camera on a sphere — without that factor a tilt reads as a zoom,
which the widget suite now asserts against.

**A thrown pet bounces off the walls.** Reported: hitting the side of the frame, it stopped
dead horizontally and rode the wall down to the floor. A wall has to behave the way the
floor already did, so `core.reflectWithin` returns `FALL_PHYSICS.wallBounce` (0.55) of the
inbound horizontal speed, aimed back inside, and `Placement.stepFall` applies it before
clamping. Measured in the widget suite: one rebound off the left wall, never outside the
frame, and the flight ends at `y === 0` — the bottom edge.

**Then: "the side bounce works now, but the top edge does not."** Correct, and for the same
reason one axis over — **the ceiling was never a bound at all**. `core.stepFall` knew only
about the floor, and `Placement.stepFall` clamped `y` after each step, so a throw upward was
caught by that clamp: the pet stuck to the top edge and hung there while the rise it was
thrown with was quietly discarded. The ceiling is now simulated like the floor
(`FALL_PHYSICS.ceilingBounce`, the same 0.38, with the same `bounceCutoff` so a gentle rise
stalls there instead of quivering), the client passes `maxY()` in as the ceiling, and the
clamp stays as a safety net for a frame whose bounds changed mid-flight. Measured: peak
`0.5721` under a ceiling of `0.625`, never above it, landing at `y = 0`.

One API detail hid this for a round: `stepFall` returned `floor` but **not** `ceiling`, so
the obvious way to drive it — feed the result straight back in — lost the top bound after the
first step. Both bounds round-trip now, with a check that asserts it.

**One silent bug fell out of the work:** `Scene.height` held pixels in one place and world
units in another, which had switched the advertised pointer gaze off for every model. See
gotcha 41.

### The follow-up report: "dragging is completely broken"

Reported right after the interaction round, with the symptom "the pet does not follow the
pointer / will not move / jumps". What the investigation found, in order:

1. **A real hazard, removed.** Folding `modelScale` into the slot meant a *stored*
   `modelScale` — the old slider went to 1.8, and `cleanPreferences` allows 4 — could
   multiply the slot up to the size of the window. The pet's box is its hit area over an
   otherwise click-through overlay, so that pet swallows every click in the app, and with
   `maxX`/`maxY` at 0 it cannot be dragged anywhere either. The slot is now capped to a
   fraction of the frame (55 % × 60 %), which `Placement.setSize` enforces and two checks
   assert — including on a viewport too small for the requested size.
2. **The drag itself was innocent, and the old checks could not have said so.** Every
   drag check in the widget suite called `onPointerDown/Move/Up` **directly**, which
   exercises the maths and is blind to the wiring: a press that never arms, a swallowed
   event or a clamped start all pass such a check and fail in the app. Two new checks
   dispatch what a mouse really sends — a press on the pet, then moves on the *document*,
   where a captured pointer's events arrive — and assert the pet tracks them pixel for
   pixel. One of them replays preferences written by the **previous build**
   (`size: 160, modelScale: 1.8`), which is the combination that can go wrong.
   Both pass, with the slot capped and the drag 1:1 on both axes.
3. **The likely explanation for what was seen:** a page loaded *during* the edit window.
   The interaction round regenerated `client.core.js` and `client.scene.js` after changing
   `lib/client.js`, and `modelScale` moved from "scale the model" (the old scene chunk) to
   "scale the slot" (the new client). A page holding the new entry with an old scene would
   scale the model **twice** — a model far larger than the box that is being dragged, which
   reads exactly as "it does not follow the pointer". A full restart loads all four chunks
   from one revision. If the symptom survives a restart, the next thing to read is the
   size row in the settings panel (it now prints the percentage), because it reports the
   stored preferences directly.

### The gaze: "it stops following as soon as the mouse leaves the frame"

Two options were proposed, and the evaluation is worth keeping because the losing one looks
cheap and is not:

| Option | Verdict |
|---|---|
| Pass the outside-the-frame coordinates in | **Chosen.** The widget already listens on the *document*, so window-wide coordinates were arriving all along; only the units stopped at the box. A mapping change, no rendering or layout change. |
| Make the frame as large as the window | **Rejected.** That box is the pet's *hit area* over a click-through overlay, so a window-sized pet takes every click and drag in the app — the hazard the 55 %×60 % slot cap exists for. It would also frame the model into a window-sized slot (so `size` and the wheel stop meaning anything) and pay for a full-window WebGL buffer permanently, for a pet 300 px tall. |

What was wrong in the units: the aim was `(pointer −canvasCentre) / (canvas / 2)`, then
`null` beyond 1.6 of those half-sizes. So the head followed the cursor to just outside the
pet and went blank — and the *further* the cursor was, the more complete the silence.

The fix is `core.pointerAim`: offset from the **pet's own centre**, divided by the frame's own
`spanX` (the floating pet passes the work area's width, which is the screen's horizontal
resolution; `GAZE_SPAN`'s 420 × 320 px is only the fallback for a caller with no frame), clamped
to ±1 and then shaped by `core.gazeCurve` — a slope that FALLS from the centre to the edge, added
later on request ("鼠标靠近的时候变化快，离远了反而变化慢，是一个斜率逐渐降低的曲线). Saturation replaces the
cutoff, so "far away" means "looking as far as it can" instead of "not looking".
`Scene.gazeFromAim` turns that into radians with the existing limits — 80° left and right.
Leaving the window now clears the gaze (`mouseleave` on the root element, plus `blur` for an
alt-tab), because the last cursor position is only meaningful while the cursor is actually there.

Measured in the widget suite: a pointer at the window's top-left corner, **6.11** old
units from the pet (the cutoff was 1.6) now yields `yaw −.5, pitch +0.262`; a pointer on
the pet's centre yields exactly `0, 0`; and a `mouseleave` leaves `pointer === null` and
`gaze === null`.

### The gaze, part two: "up and down are inverted on the fish, left and right are fine"

Reported for one model only. Measured on both, with the same gaze angles, as the **world-space**
tilt of the character's forward direction — the user-visible property, not the rig's axis names:

| model | `metaVersion` | local-X pitch | local-Y yaw |
|---|---|---|---|
| `HatsuneMikuNT.vrm` | 0 — `rotateVRM0` turns it 180° about Y | up | correct |
| `蓝色小肥鱼vrm` | 1 — left as authored | **down** | correct |

So the models were not "wrong": the gaze was applied about the head's own local X and Y, and
those are the character's right and up only for a model that happens to be oriented that way. A
180° yaw flip negates a tilt about the right axis (`R_y(π)·R_x(θ)·R_y(π)⁻¹= R_x(−θ`) and
leaves a turn about the up axis alone (`R_y(π)·R_y(φ)·R_y(π)⁻¹= R_y(φ)`), which is exactly the
reported split — pitch broken, yaw fine, on precisely the model that is *not* flipped.

`gazeAxesFor` now measures the axes per avatar (character forward/up/right from the **stage**,
so the idle heading cancels; rotation axes `forward × right` and `forward × up`), caches them on
the bone and drops them with the model. After the fix both models measure **identically**
(`forwardUp ±0.2522`, `forwardRight ±0.3335`), which is what an orientation-independent
derivation should do.

One false start worth recording: the first version of the fix changed nothing at all, because
`Motion.attach` is given the renderer's **scene**, not the stage, so `gazeAxesFor` was handed
`undefined`, returned null and fell back to the old code. The numbers were identical to four
decimals, which is what gave it away — a "fix" that changes no measurement has not run. The
stage is now resolved from the model's own parent (`avatar.root.parent`).

The regression is automatable with the synthesized VRM fixture, no third-party asset: measure
the tilt, rotate the model's root by that same 180°, measure again, and require the same
numbers. Verified to **fail** without the derivation (`upright −.2522 / flipped +0.2522` →`agrees: false`) and pass with it.

### The gaze, part three: "the built-in stand-in is still wrong — I want ONE general algorithm"

That is the right ask, and the report was accurate: the placeholder was the only avatar kind
still taking the **old** branch. Measured on it directly (the widget in the browser suite renders
the placeholder, so no asset is needed): `pitchUp −.1848` against the VRM fixture's `+0.2522`.

The reason is structural, not a sign to flip. There were two paths:

* avatars whose wrap recorded a rest **quaternion** (VRM, MMD, glTF) →the derived axes;
* everything else →`pet3dRestRot`, a local **euler** (`rotation.x = rest.x + pitch`,
  `rotation.y = rest.y + yaw`) — the original assumption, verbatim.

The placeholder took the second, so "measuring the axes" had only ever fixed one of the two
branches. Fixing the model that was reported would have left the next kind to report.

Now there is one path and no per-kind case:

* `gazeNodeFor(avatar)` is the single answer to "which node looks", used by the gaze **and** by
  installation — the choice of node is the only thing that legitimately differs by kind;
* `installAvatar`, the one place every avatar passes through, records that node's rest
  quaternion and clears the cached axes, so a new wrap path cannot forget to;
* `applyGaze` composes `rest × yaw × pitch` about the **measured** axes for every kind;
* the old euler survives only as a documented last resort for a degenerate rig.

The check that makes the claim general is a cross-kind comparison, and it is exact: the VRM
fixture and the placeholder must both measure `0.2522` pitch and `0.3335` yaw, because those are
`sin(angle × weight)` and do not depend on the model at all. Verified to **fail** when the
install-time rest capture is disabled (`−.1848` vs `+0.2522`, `sameAsVrm: false`).

Two measuring mistakes of my own are worth recording, both of which produced a "failure" that
was the test's fault — and the second is the reason the shared `gazeEffect` helper compares
**gaze against rest** rather than against the head's live pose:

1. comparing a raw double with a `toFixed(4)`-rounded report value (`0.2522 !== 0.2522`);
2. measuring the delta from the head's current pose while the widget's idle was posing it, so
   the idle's own head rotation was folded into the result (a phantom mismatch in both
   magnitude and axis).

## 12. "Can the pet float above every window?" — asked, investigated, and answered (2026-10-08)

The question was whether the plugin can detach from the DSH window and stay on top of the
screen. **Not from inside the plugin**, and the reasons are structural, not effort:

* the plugin's **host** half runs in a child process DSH spawns: the Electron main script (which
  lives inside the installed app.asar, not in this repository) spawns
  `resources/runtime/primary-runtime/dependencies/node/bin/node.exe`, so there is no
  `BrowserWindow` to reach;
* the plugin's **client** half runs in the app renderer, whose IPC surface is a fixed table of
  26 channels (`DESKTOP_IPC`: shortcuts, boot, directory-pick, updates, native-theme,
  window-fullscreen, windows-appearance/menu— with **no window-creation or topmost channel**,
  and every handler validates its sender as `dsh-app://app`;
* neither service catalogue has a window/desktop service (host: `subprocess`, `webServer`, —
  client: `layout`, `slots`, `theme`, `locale`, — ;
* DSH *does* build frameless transparent windows itself — its `DesktopUpdateOverlays` class uses
  `frame:false, transparent:true, skipTaskbar:true, hasShadow:false` — but that is product code,
  not exposed to plugins;
* the app takes a single-instance lock (`requestSingleInstanceLock`), so re-launching the exe
  merely focuses the existing window;
* the installation carries a runtime manifest with a **sha256 for every file** inside it
  (`desktop-runtime.json` next to the app's own payload), so patching the installation is both
  detectable and vulnerable to updates.

**What does work, verified by probe rather than by reading docs** (probe app in `%TEMP%`, result
kept as `%TEMP%\pet3d-electron\app\result.json`; nothing downloaded, nothing in the installation
modified, no stray process left):

| route | result |
|---|---|
| standalone Electron (v40.10.2 from `%LOCALAPPDATA%\electron\Cache`) running the probe app | `alwaysOnTop:true` (level `screen-saver`), transparent + frameless + click-through accepted, window resized to the **full screen** 2560×1440, WebGL2 on the RTX 4090 (`alpha:true`), 40 frames drawn, and `capturePage()` showing **0 opaque, 72 956 translucent, 323 944 transparent** pixels |
| the **installed** `DeepSeek Harness.exe` (Electron 44) hardlinked into a scratch dir that has only `resources/default_app.asar` — no `app.asar` — then given the probe app dir | same result, `ok:true`, `appPath` = the probe app. Zero disk cost (20 hardlinks), no second DSH window, no download |

So a desktop-pet overlay is reachable **without touching DSH and without downloading a runtime**,
by building a bare-Electron layout on the install's own volume at run time (hardlinks + a
`default_app.asar`-only `resources/`), and spawning that exe with the plugin's own app directory.

Three findings worth keeping:

1. **`ELECTRON_RUN_AS_NODE` must be DELETED from the child's environment, not set to `0`.**
   DSH's host runs with it set to `1` and the probe inherits it; Electron treats *any* value as
   "run as Node", so setting `0` still produced `Cannot find module 'electron'` and an immediate
   exit. This is the first thing that will look like "the window does not appear".
2. **The pet's frame becomes the screen.** The whole in-app design assumes the DSH window is the
   frame — the slot's 55 %×60 % hit-area cap, the throw bounds, `GAZE_SPAN`. In a screen-sized
   click-through window those are the wrong constants, and the "frame as large as the window"
   option rejected for the in-app overlay becomes the *correct* shape here (it can no longer
   swallow the app's clicks).
3. **Global cursor tracking needs no native code and no event forwarding:**
   `screen.getCursorScreenPoint()` in the launcher's main process gives the OS cursor position,
   which both drives the gaze and decides when to toggle `setIgnoreMouseEvents(false)` over the
   pet's own rectangle (clicks pass through everywhere else). `forward: true` was therefore left
   unverified on purpose — the design does not depend on it.

Not built yet: this section records the feasibility only. Building it is a real feature (launcher
app, bare-Electron host dir, spawn/lifecycle in the host half, a standalone pet page reusing the
scene, re-tuned bounds) and changes the plugin's shape, so it wants an explicit decision.

## 13. The floating window — built (2026-10-08)

Asked for and delivered the same day, on the strength of §12's measurements. What exists now:

| Piece | Where | What it does |
|---|---|---|
| the launcher | `desktop/` (`main.js`, `preload.js`, `package.json`) | an Electron app: the transparent always-on-top window, cursor polling, the click-through policy, the parent watchdog, and a `--self-test` mode that proves the window and writes a JSON report |
| the runtime | `lib/desktop.js` | builds a bare-Electron directory beside the installation out of **hard links**, sanitises the child environment, spawns and stops the launcher, and reports every outcome |
| the page | `lib/desktop-page.html` + `lib/desktop-page.js` | the pet on the screen-sized frame: the same `Placement`, `Scene`, gaze and physics the overlay uses, plus the rectangle the launcher needs |
| the routes | `lib/index.js` | `GET /pet3d/window`, `GET /pet3d/window/lib/<name>` (a whitelist of six files), `GET|POST /pet3d/desktop` |
| the switch | `lib/client.js` | the panel's **Floating window** checkbox, which asks the host and shows what it answered (on / off / starting / why it failed) |
| the coverage | `scripts/verify-desktop.mjs` (83 checks) + the `client-test` page | the runtime plan, the spawn environment, the lifecycle, the page's interactions — and **a real Electron window** told to prove itself |

Live evidence from the suite, on this machine: `alwaysOnTop=true screenSized=true
pixels=1392055 transparent=6625865 webgl2=true electron=44.0.0` — 1.39 M painted pixels inside
6.6 M fully transparent ones, the pet at `{left: 2202, top: 1092}` of a 2560×1392 frame.

### The five traps this cost, in the order they appeared

1. **`ELECTRON_RUN_AS_NODE` must be DELETED, not zeroed.** DSH's host runs with it set to `1`;
   Electron decides by the variable's **presence**, so `=0` and `=false` both still mean "be
   Node" and the launcher dies instantly with `Cannot find module 'electron'`. First symptom:
   "the window never appears".
2. **Windows clamps a window to the display's WORK area.** Requesting the full 1440 px height
   got 1392 back (a 48 px taskbar), so the launcher's own report disagreed with its request.
   Fixed by asking for the work area — which is also the right frame for a pet.
3. **`capturePage()` returns PHYSICAL pixels.** The window is 2560×1392 DIP and the capture
   came back 3840×2088 at `scaleFactor 1.5`, so any assertion comparing the two numbers fails
   for a reason that has nothing to do with the window.
4. **A `Scene` has no avatar until something installs one.** The first glue fetched model bytes
   itself and called `parse`, and for the placeholder it called neither: the pet ran **120
   error-free frames painting nothing**, because `Scene.tick` returns early without an avatar.
   The fix is to call `Scene.loadModel` (which fetches *and* falls back to the placeholder)
   rather than to reimplement it — a parallel implementation of an existing method, again.
5. **A throw inside the frame loop was invisible.** The page had already reported ready, so a
   failure in frame 2 ended the loop and nothing said why. The loop is now guarded and publishes
   `window.__PET3D_DESKTOP_STATE__` (frames, last error, placement, rectangle); the launcher
   collects console messages and reads that state during its self-test.

Two smaller ones worth knowing: the launcher's config omitted the screen's `x`/`y`, so the page
computed `undefined + 2202 = NaN` for every rectangle — and the launcher's `Number(x) || 0`
turned that into `0,0`, i.e. a pet whose click-through hit area was nowhere near the pet. And the
suite's first runtime directory was placed **inside this repository**, which is a Synology-synced
tree: 17 entries including a hard link to a 244 MB executable, handed to the sync client. It now
lives beside the installation (`F:\DeepSeek\pet3d-desktop-runtime`), which is also where the host
half puts it, and the workspace stays clean.

### The sixth trap, found by using it: "I turned it on and nothing happened"

The first live report after the window was built, and the suite was green when it happened. Cause:

**A prefix route registered with a trailing slash can never match.** The page's sources were
registered as `prefix /pet3d/window/lib/`, and DSH's matcher decides a prefix hit with

```js
if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
```

so it looked for the prefix followed by a SECOND slash before the file name — a path no browser
sends. All six sources 404'd, the page loaded, the glue never ran, and the pet was an invisible
transparent window. The existing routes were unaffected precisely because *they* have no trailing
slash, which was the tell.

Two things made it survive a green suite, and both are now closed:

* **The suite never asked the plugin for its own sources.** `verify-desktop.mjs` inlines the glue
  and serves the page from its *own* test server, and the `client` page inlines the sources too —  so the route that the real window depends on was never requested. `verify-model.mjs` now makes
  those requests over real HTTP (page, each of the six sources, a non-whitelisted name, a
  traversal attempt, and the control route's safe surface), and it asserts the *property* as well
  as the string: no prefix route may end in a slash.
* **"Running" was reported as success.** The host knew only that the process was alive, so a
  window whose page had died looked exactly like a working pet. The launcher now prints one
  machine-readable line (`pet3d-desktop: {"ready":true,"webgl2":true,…}`), the host parses it out
  of the child's stdout — carrying across chunk boundaries — and the panel has three distinct
  states: on, starting (no page verdict yet), and **on but not drawing** (with the page's own
  error text). The prefix is duplicated in the two processes on purpose; the suite asserts the two
  copies are identical, so a rename cannot silently end the reporting.

Verified the same way as every other trap here: with the trailing slash restored, the new checks
fail loudly (`the page's source core.js is served`, `no prefix route ends in a slash`, and 30
others); with it fixed, they pass. The diagnostic that found it was a one-off probe that started a
self-test window against the **live** host and the user's own model, which reported
`"errors": ["Cannot read properties of undefined (reading 'mount')"]` — the page saying precisely
what was missing.

### The seventh trap: it looked like it worked

Reported after the window worked at all: *"I enabled the floating window and it seems to have no
effect — every click passes through the pet, and the default model covers most of the screen."*
Three separate faults, each invisible from the others' symptoms:

1. **The pet was framed to the whole screen.** `Scene.setPlacement` ignores its x/y arguments — it
   only applies a vertical lift — so the model is always framed to its CANVAS. The window's canvas
   was screen-sized, so the pet was screen-sized. Fixed by making the canvas the pet's own box,
   moved around inside the window with CSS exactly as the in-app overlay does it, plus a smaller
   size ceiling for a desktop frame (22 % of the width, 45 % of the height, against the overlay's
   55 %×60 % of an app window).
2. **The window painted nothing at all, from a one-character mistake.** The guard that decided
   whether to resize the canvas compared `canvas.width` (device pixels: 220 at 1.5 DPR becomes 330)
   with the box width (CSS pixels: 220), so it was true on every frame and each frame ended by
   resizing the drawing buffer — after the render, wiping the picture before the window composited
   it and before the hit test read it. Both independent measurements said "empty canvas" (`capturePage`
   and `readPixels`) while the scene reported a healthy avatar, camera and renderer, which is what
   pointed at the buffer rather than at the model.
3. **Click-through was all-or-nothing over a rectangle.** Now it is per pixel: the page reads the
   framebuffer at the cursor (`preserveDrawingBuffer` on, one pixel per query) and the launcher makes
   the window interactive only over painted pixels. Gaps between hair strands pass the click through;
   the hair takes the click and the wheel. `desktop/main.js` keeps the rectangle for diagnostics only.

Two smaller lessons from the same round, both about tests rather than about the pet:

* **The suite's check hung on animation frames.** Awaiting eight `requestAnimationFrame` ticks while
  the page already ran two rAF loops consumed the headless run's virtual-time budget, so the check
  never settled and the page reported "running— with no assertions at all. The hit test needs no
  frame (the cursor callback answers synchronously), and the test now calls `scene.tick(1/60)` once
  so that something has been drawn — determinism instead of a frame race. The suite also names the
  check in progress now, which is how the hang was found.
* **Never round-trip a source file through PowerShell.** `Get-Content -Raw` + `Set-Content` decoded
  with the console codepage and re-encoded, so `lib/index.js` and `lib/desktop-page.js` ended up
  invalid UTF-8, and my "collapse repeated ?" cleanup then destroyed three legitimate `??` operators
  (`??` became `?`). Repaired by rule — byte-preserving Latin-1 decode, mojibake table, restore the
  nullish operators, verify with `node --check` and the load preflight. 76 comment characters became
  ASCII equivalents; no code was lost. Use the file tools for source, and if a shell edit is
  unavoidable, never let it touch encoding.

### The panel, and turning the throw off without deleting it

Asked for next: a right-click that opens settings, throwing switched off (kept for later), and
"drag and place" instead of "throw and drop".

* **Right-click vs right-drag** is the same gesture told apart by whether the press moved, using the
  threshold that already existed for the orbit. A click toggles the panel; a drag that turned the
  view leaves no panel behind, which the suite asserts because that failure mode is a panel
  appearing every time the user looks at the pet from another side.
* **The panel is DOM, and the hit test is per pixel**, so the two do not know about each other: the
  page answers for the panel's rectangle as well, and the launcher's self-test opens the panel,
  probes a point on it with a synthetic cursor, and requires the answer to be "this window takes the
  click". Without that the panel would be visible and completely click-through.
* **No native dropdowns.** The window is created `focusable: false` so it never steals focus;
  a `<select>` needs an active window to open its list, so the model control is a button that
  steps through the catalog. Pointer events arrive regardless of focus — that is how the pet is
  dragged at all — so buttons and checkboxes work.
* **Throwing off is one flag** (`placement.throwEnabled = false` in the window's mount).
  `endDrag` returns `null` instead of building a fall, and `stepFall` with both
  bounces stays exactly as it was, still covered by the core suite's physics checks. The client suite
  asserts the counterpart too: a fresh `Placement` has throwing ON, so the feature has not
  quietly disappeared.
* **Placed means placed.** After a release the suite ticks two frames and requires the pet not to
  have moved a pixel and not to be airborne.

### The eighth trap: the gesture that dies after one step

Reported next: *"zooming should be centred on the pointer, inside or outside the window; otherwise
once the pointer lands on a pixel-less area, continuous zooming stops."* Two halves, and only one of
them was about arithmetic.

* **The resize grew from the box's top-left**, so enlarging walked the model away from the pointer.
  `Placement.resizeAnchored` holds an anchor point still by preserving its fraction of the
  box, and the page anchors at the launcher's cursor (in screen coordinates, minus the window's own
  origin). Asserted exactly in the widget suite on a placement with room on every side
  (`relativeBefore === relativeAfter`, box 220 -> 572, and the unanchored form holds the
  centre to the pixel), and loosely in the live window, where the pet sits on the bottom of the work
  area and the clamp legitimately bends the vertical anchor.
* **The hit test itself ended the gesture.** The window is click-through wherever nothing was
  painted, so one pixel-less frame under the cursor — a gap between hair strands, or a head sway
  mid-scroll — handed the rest of the burst to whatever is behind the window. Both halves now hold
  on after each notch: the page for 450 ms, the launcher for 700 ms (longer, so the window is still
  receiving when the page is still willing). Every notch bumps `zoomSeq` in the rect report,
  which is what refreshes the launcher's hold — a report that is skipped when nothing changed would
  have let it expire mid-scroll.
* **Electron's injected wheel has the opposite sign to the DOM's.** `sendInputEvent` with a
  POSITIVE `deltaY` arrives as `deltaY < 0`, i.e. zoom in. The first live probe sent
  `-120` and measured a pet that shrank (220 -> 156: exactly three zoom-OUT steps), which is
  how the convention was found rather than assumed.

### Reading a model's contents, and why that is a host-side job

Asked for: *"parse 蓝色小肥鱼vrm — it is rich, expressions included."* Then, from that: a unified
model-parameter window, which needs to know what a model HAS before it can offer switches for it.

* **The parse lives in the host half** (`lib/vrm-info.js`), reachable as
  `GET /pet3d/model-info?m=<id>`. A renderer-side answer would only exist while the pet is
  running, and the window is exactly the place you open when it is not.
* **Findings about the actual model** (`docs/models/蓝色小肥鱼md`): VRM 1.0 from VRM Add-on for
  Blender 4.5.0; 53 humanoid bones; **19 expressions** (all 18 presets plus a custom `TiePen`)
  over 16 unnamed morph targets, with `surprised` declared and EMPTY; **22 spring-bone chains**
  (ahoge, bangs, fin-ears, hair, skirt, whale tail); `lookAt.type = "bone"`, so the plugin's
  existing bone-driven gaze is what the author intended; licence `onlyAuthor` /
  `modification: prohibited`.
* **The unnamed-morph-target trap.** The model's morph targets have no `targetNames`, so
  `morphTargetDictionary['blink']` does not exist and target #0 is only knowable through the VRM
  expression table. The fixture was extended to carry the same situation on purpose, so the tests
  take that path: `build/fixtures/vrma/pet3d-minimal.vrm` now has three unnamed morph targets,
  four expressions (one of them empty) and two spring chains with different physics.
* **Both MToon shapes.** Reading only `materialProperties` (MToon 0.x) makes a 1.0 model look
  as if it had no toon settings at all; `VRMC_materials_mtoon` writes named fields instead.
  Both are reported.

### Model settings, and the pairing rule that makes them real

Building the settings window turned up two things about the runtime that no amount of reading the
model file would have found.

* **three-vrm imports a VRM 1.0 spring chain as PAIRS.** In
  `VRMSpringBoneLoaderPlugin` the schema joints are walked with a `prevSchemaJoint` and
  a joint is only created for each (k, k+1) pair — so **N entries animate N-1 joints and the final
  entry is only a tail**. A first fixture listed the joints alone, and the renderer reported "hair: 1
  joint" for a two-bone chain and dropped a one-entry chain entirely, while the host parser (reading
  the file) reported 2 and 1. The two halves disagreed about one model, which is the class of bug this
  project keeps meeting. Both now apply the pairing rule; the real 蓝色小肥鱼vrm reads 91 entries and
  **69 animate-able joints**, which is the number the settings window shows.
* **`expressionManager.update()` was only called while an authored clip played.** Setting a
  weight without it changes nothing: three-vrm writes the morph targets inside `update()`. So
  expressions never moved during the idle at all — the fix is a per-frame call in
  `Scene.tick`, which is also what makes a weight set by the settings window show up at once.

The settings themselves are data, not code: `preferences.expressions` (per-expression manual
weights, where a pinned 0 is an instruction and an ABSENT name means "the behaviour decides", plus the
blink and emotion switches with their intervals) and `preferences.springs` (per model, per
chain, per FIELD, so touching stiffness does not pin drag and gravity). An override is resolved through
`core.springOverrideFor` and applied to the live `joint.settings`, with the file's own
numbers snapshotted per joint at install time — that snapshot is what "default" means.

### The settings window, and testing it against a real model

The window is three pieces: a page ({{bt}}lib/config-page.html{{bt}} + {{bt}}lib/config-page.js{{bt}}), a host
route that serves it ({{bt}}/pet3d/config{{bt}}), and a launcher mode that puts a real window around it
({{bt}}--config{{bt}}). It opens from either panel; without Electron the same page opens as a tab.

Two traps, both found by the tests rather than by reading:

* **A settings window has no preload, so it never sends {{bt}}pet3d:ready{{bt}}.** The launcher waits for that
  message in pet mode; in config mode the first version therefore wrote no self-test at all and the suite
  timed out waiting for one. Its verdict is now written when the page has LOADED, and its definition of
  working is its own: loaded, an ordinary window, not pretending to be the pet.
* **Testing the page against the default placeholder proves nothing.** The first live check pointed the
  window at a page whose {{bt}}/pet3d/catalog{{bt}} and {{bt}}/pet3d/model-info{{bt}} answered 404, so it was
  configuring the built-in avatar: the expression and spring tables were legitimately empty and the check
  passed anyway. The suite now serves BOTH routes out of the committed VRM fixture through the plugin's own
  parser, names that model in the URL ({{bt}}/pet3d/config?model=fixture{{bt}} - the same parameter the host
  fills in with the model the pet is showing), and asserts what the PAGE rendered: 4 expressions, 2 spring
  chains, a row per expression and a control block per chain.

The settings page publishes {{bt}}__PET3D_CONFIG_STATE__{{bt}} for exactly that reason, the way the pet page
publishes its own state: 'the window opened' and 'the window has something in it' are different claims.
### Verifying and undoing it

* `node scripts/verify-desktop.mjs` — 114 checks; the live windows are skipped (not failed) when
  there is no installation to borrow from, and `PET3D_DESKTOP_RUNTIME` points it at a standalone
  Electron instead. `PET3D_CLEAN_DESKTOP=1` removes the borrowed runtime afterwards.
* Turning it off in the panel stops the process; unloading the plugin does too (`ctx.effect`).
* Deleting the runtime directory is always safe — it is rebuilt on the next start, at zero disk
  cost, because every file in it is a hard link.

### What is deliberately not done yet (step 2)

* The settings panel lives in the app window, so the floating pet has no controls of its own
  (right-clicking it does nothing yet).
* The pet's *state* still comes from the app's session status, which the floating window does not
  receive: it rests, is held, falls and lands, but it does not celebrate a turn from out there.
* One monitor: the primary display only.
* `forward: true` is left unverified because nothing depends on it.

## 14. The live verification round (2026-10-08, 20:20–20:40)

Everything in §13 had been measured against the suite's *own* page server. This round is the first
time the running app was driven with a real model and the plugin's own routes, and it is the round
that also found three bugs in the launcher itself.

### What was verified live, in this order

```powershell
node scripts/live-probe.mjs --add "D:\SynologyDrive\FatFish-pet\Models"   # import the operator's models
node scripts/live-probe.mjs --id-race                                     # the §11 property, in the app
node scripts/live-probe.mjs --asset m2                                    # the byte route, one model
```

| Claim | Evidence, from the running host |
|---|---|
| the import route works live | `POST /pet3d/models {add}` →200, `persisted: true`, `modelCount: 2` — `HatsuneMikuNT.vrm` (26 306 676 B, `m1`) and `蓝色小肥鱼vrm` (18 480 432 B, `m2`) |
| **the model-id fix is live** | `--id-race` →`PASS`: `m1` read from the catalog, bytes served, the catalog read again (which rebuilds the store), and the **same id still serves 200**. Before the 20:08 restart this printed `m9` →`mb` →404 |
| the asset route streams real bytes | `/pet3d/asset?m=m2` →200, 18 480 432 bytes, `model/type gltf-binary` — byte-for-byte the file's size |
| a surface picks a change up without a restart | `POST /pet3d/settings {preferences:{modelId:"m1"}}` →`version 5`, and both the app's pet and the floating window follow the host store's version (the floating window's own rect changed within the poll interval) |
| **a real VRM renders in the floating window** | a real launcher self-test against the LIVE page with `--model-id=m1`: `checks.canvasPixels` →`avatar: "vrm"`, `painted: 27 884 / 111 540`, `stageChildren: 2`, `modelHeight: 0.62`, no page errors, `perPixelHitTest: true`, `panelHitTest: true` |

Two labels that look like evidence and are not, worth knowing before the next session trusts them:
`GET /pet3d/desktop →modelId` comes from the launcher's `--model-id` argv (a spawn-time value), and
`live.app` / `live.window` are pushed when a surface *starts* or when the panel writes
(`Pet3DWidget.followHostSettings` reports once). All three stay `placeholder` after the pet
successfully loads another model. The page's own `canvasPixels.avatar` is the honest field.

### The three launcher bugs this round found, all from one probe

The probe above was started by hand, twice, and each time left something on the operator's screen.

1. **A broken stdout became a modal dialog.** Killing a probe closed its stdout; the launcher wrote
   its next status line anyway, and Node delivered the EPIPE as an **asynchronous `error` event on
   the stream** — not as a throw, so the `try`/`catch` already around `announce()`'s
   `process.stdout.write` could not see it. Result: *"A JavaScript error occurred in the main
   process — EPIPE — at announce (desktop/main.js:658)"*, several dialogs, still on screen after the
   processes were gone. Fixed with `process.stdout.on('error', () => {})` (and stderr), with the
   measured reason in the comment. **A closed stdout is not a pet failure**: when the host half goes
   away, the window should simply stop reporting.
2. **A self-test shared the live window's Chromium profile.** Both processes use the default
   `user-data-dir` (nothing passes `--user-data-dir`; `launchArgs` has exactly three arguments and
   the suite asserts that count). Chromium's process singleton is per profile, so the second
   instance — the probe — either exits at once or hangs before its page ever mounts, which is
   exactly what happened on runs 2 and 3. A self-test now sets its own `userData`
   (`<userData>-selftest`) before `app.whenReady()`, kept between runs so the one-time work happens
   once. This is the desktop-side twin of gotcha 25.
3. **A self-test had no deadline.** It writes its report when the *page* says it is ready, so a page
   that never gets there left an always-on-top window and the process alive for ever (that is the
   hang above, and it needed `Stop-Process` by hand). There is now a 45 s deadline that writes a
   report saying why, before the suite's own 60 s wait expires.

Four source assertions in `verify-desktop.mjs` pin all three (the suite was 100 checks then, 105 after
§15's anti-freeze assertions), because each of them is invisible from the behaviour the suite
otherwise measures.

### Two more things worth remembering

* **A launcher fix needs no DSH restart.** `lib/desktop.js` spawns the launcher from disk on every
  window start, so the three fixes above are live the next time the window is toggled — unlike
  anything in `lib/`, which waits for a restart (gotcha 38). The running window keeps the old code
  until it is restarted.
* **A probe against the LIVE page writes the operator's settings.** The self-test's wheel probe
  drives the real page, and the page pushes zoom to the host store — so a probe run against the live
  route changed the user's stored `size` from 100 to 184. Point a probe at the suite's own server
  (which answers `/pet3d/settings` with 404, so the page never pushes) when the point is the
  launcher, and restore `size` afterwards when the point is the live page. This is gotcha 37's rule
  one layer out: a test may not write state it does not own.

## 15. The detail round and the anti-freeze fixes (2026-10-08, ~20:45–22:00)

The user reported the freeze again — *"still freezes, browsers and Electron-based apps first"* — and
asked for four detail changes in the same message. Both are in the tree; this is what each one was
and how it is locked down.

### The four details

| Ask, in the user's words | What was wrong | What changed |
|---|---|---|
| 去掉单眼眨眼 (remove the single-eye blink) | `Scene.pickBlinkExpression` picked `blinkLeft`/`blinkRight` **a quarter of the time**, on purpose ("a pet that only ever blinks symmetrically looks mechanical") | always `blink` when the model has it; the single names survive only as a fallback for a model with no `blink` (`lib/pet3d.js`) |
| 去掉微动，去掉高度的移动，只构造左右的微动 (keep breathing, drop the vertical motion) | `core.idlePose` returned a whole-body `bob` — `sin(2θ) × 0.0025` of a viewport height — and the frame step wrote `stage.position.y = baseY + bob` | the `bob` channel and its per-state multipliers are **gone**; the idle writes `yaw` (left-right sway) and `breathScale` (the chest pitch) only. `verify.mjs` asserts the ABSENCE of a vertical channel, over a whole period, because that is the kind of thing a refactor reintroduces |
| 缩放限制：最小长边≥40 px，最大不超过屏幕最短边 (zoom limits from the frame) | the wheel clamped to a fixed `SIZE_RANGE` of 40 %–60 %, and `Placement.setSize` had hard floors of 80 × 100 px that made the promised 40 px unreachable | new pure function `core.sizeLimits({baseWidth, baseHeight, viewportWidth, viewportHeight, slotFraction})` →`{min, max}` with `min` = the percent whose long edge is 40 px and `max` = the frame's shortest edge, reduced by the surface's own slot fraction first. `Placement.zoomLimits()` uses it; both surfaces' wheels clamp to that. On a 1920 × 1032 work area that is **14 % — 344 %** against the old 40 %–60 %; the app overlay keeps its 55 %×60 % hit-area cap, so its ceiling is 206 % on that frame. `SIZE_RANGE` is now the STORAGE bound only (10–400) |
| 拖动时的表情/动画应在按下开始位移时就切换(react when the drag starts, not when it ends) | both surfaces called `scene.noteInteraction('drag')` on **pointerup**, so the drag reaction arrived as the pet was already falling — it read as a landing reaction | the widget and the floating window fire it on the **first movement** of the press, once per drag (`dragReactionFired` / `drag.reacted`), and only a press that never moved is a `click` on release. Asserted in `client-test.js` for both surfaces, by recording what the page told the scene and reading it BEFORE the release |

### The three anti-freeze measures (§ "Next steps" above)

1. `keepOnTop()` — re-assert `setAlwaysOnTop(true, 'screen-saver')` on every click-through change, and a
   `focus` listener that blurs the window: activation is what the report starts with.
2. `mouseThrough` — `setIgnoreMouseEvents` is called only when the verdict changes, not sixty times a
   second.
3. `SCREEN_INSET = 1` — the window is the work area inset by one pixel on every side, so it is not the
   exact fullscreen shape Windows promotes; the page gets that origin, so screen coordinates still line up.

`verify-desktop.mjs` asserts all three: two from the launcher's source (the guard and `keepOnTop`), and
the inset from the **live** window's own report (`checks.inset === 1`, and its bounds are the work area
minus two pixels). The suite is 114 checks now (§16 changed what "the window" means).

**Not yet proven: that they fix it.** The running window was restarted by hand
(`POST /pet3d/desktop {action:"disable"}` then `{"action":"enable","modelId":"m1"}`) so the new launcher
and page are live, and the freeze only appears when a real click activates it. The test is: click the
model. If the desktop behind it still freezes, step 4 (a window only as big as the pet) is the
structural answer and the user has approved it.

### The ninth trap, met while making the fixes live: a replaced child reported on its successor

`action: 'restart'` stops the window and starts a new one, and the OLD process's exit event lands
*after* the new start. `DesktopWindow`'s `exit` handler wrote the status unconditionally, so
`GET /pet3d/desktop` answered `{state: "stopped", reason: "signal SIGTERM", pid: null}` while the new
window was on screen and drawing — and the panel's switch reads exactly that state, so it showed the
pet as off while it floated over the desktop. The same payload's `page.ready: true` is what gave it
away: "stopped" and "the page just reported a frame" cannot both be true.

The fix is the guard that was already half-written (`if (this.child === child) this.child = null`) now
covering the whole handler, for `error` as well as `exit`: **only the current child owns the status**.
Seven checks in `verify-desktop.mjs` pin it, including the one that matters — the replaced child's exit
must leave the new window `running`. It is a host-half change, so it needs a DSH restart to be live;
toggling the window off and on works around it, which is how the live window was brought up.

### One more thing this round paid for

The four detail changes moved every suite count, and the docs check caught it exactly as designed:
`415 + 312 + 43 + 13 + 64 + 13 + 117 + 2 = 979` after §16. The lesson is not the number — it is that
`check-docs.mjs` is the only thing that notices a suite grew, so a change that adds assertions is not
finished until the docs are updated.

## 16. The freeze: measured, root-caused and fixed (2026-10-08, late)

The freeze that survived §13's five command-line switches was **reproduced on this machine**, and the
cause was not the switches at all.

### The measurement rig (kept, and worth rebuilding next time)

| Piece | Where | What it is |
|---|---|---|
| `check.ps1` | `%TEMP%\pet3d-freeze-probe\` | captures a screen rectangle twice, 1 s apart, and says FROZEN when the two are byte-identical |
| `experiment.ps1` | the same directory | restarts the pet window, **waits until the pet is really painted**, moves the cursor to a PAINTED pixel, clicks, then samples the rectangle above 8 times |
| the reference window | `%TEMP%\pet3d-freeze-probe\app\` | an ordinary Electron window that repaints a counter every 80 ms, always-on-top, at a fixed spot |

Two traps in the rig itself, both paid for: the reference window must NOT pass
`disable-backgrounding-occluded-windows` or `backgroundThrottling: false` (they make it immune to the
mechanism under test), and it must be always-on-top (with the DSH window in front, every run reported
FROZEN before anything happened). And the experiment must wait for `page.over === true`: a 26 MB VRM
takes seconds to install, and until it is painted the window is click-through, so the click goes to the
app behind and the run measures nothing.

### The numbers — and what they do NOT prove (corrected later the same evening)

| Window shape | Click on the pet |
|---|---|
| the work area, inset 1 px, as the page was then | **5 of 8 samples FROZEN**, recovering after ~1.5 s |
| 360 × 480, same page | **0 of 8** |

It is tempting to read that as "coverage is the cause". **Do not.** Two later runs made it untenable:

* With the CURRENT page code, a **valid** screen-sized probe (the window really was 1918 × 1030, asserted
  before the click, with a raise-and-verify step for the reference window) froze **0 of 8** — the
  phenomenon did not reproduce at all. The 5/8 above was measured against an older page build, so size is
  "what our window looked like when it happened", not a demonstrated cause.
* **YourMom** — a Unity desktop pet installed on this machine — is a screen-sized (1918 × 1080), topmost,
  `WS_EX_LAYERED`, per-pixel-transparent (no `LWA`), **interactive and activatable** window, and it was the
  *foreground* window while a Chromium (DSH) window behind it kept rendering. Measured with `EnumWindows` +
  `GetWindowLong` + `GetLayeredWindowAttributes`. So screen coverage, topmost-ness, layered transparency,
  taking mouse input and being activated are each, on their own, **not sufficient** to freeze the windows
  behind. 

What remains true and useful: the pet-sized window is the shape that never froze **for this user**, so it
ships; and the freeze is not a Windows limitation, because a full-screen interactive transparent pet does
exist on this machine without it.

### Two ways the rig lies (both cost a run)

1. **The window under test must be the window you think it is.** `followPet` resizes the window onto the
   pet's rectangle on every report, so a "screen-sized" probe silently became pet-sized after the first
   report and two different variants measured the same thing (both 0/8). Assert the real bounds from the
   process (`GetWindowRect`) before clicking, and refuse to measure otherwise.
2. **The reference window must be a valid victim**: a plain window (not always-on-top), explicitly raised
   above the DSH window before the click, and verified animating *before* the click. Covering it, or
   leaving it behind another window, reads as "FROZEN" when nothing happened at all — that is how a locked
   screen produced two bogus rounds.

### The fix

**The pet's window is the pet's own box and follows it.** `desktop/main.js` creates a 240 × 320 window
and then, on every `pet3d:rect` report, sizes and places it on the rectangle the page reports — unioned
with the settings panel while that is open, because the panel is DOM and has to be inside the window to
be visible. `lib/desktop-page.js` keeps working in the VIRTUAL work-area frame it always used, so
placement, drag, zoom anchoring, gaze and the panel needed no rewrite: only the canvas offset and the
pointer conversion became window-relative.

### The drag lag, and why it was there

The window moves with the pet, so `clientX/clientY` are measured against a frame whose position is
itself a consequence of the drag — feeding them back makes the pet chase the cursor one window-move
behind. The drag now runs on the pointer's **global** position (`screenX/screenY`), and while dragging
the canvas sits at 0 inside the window (the window is about to be moved to exactly that spot), so the
latency is one window move instead of a feedback loop. `client-test.js` pins it with a drag whose
client coordinates are deliberately `0,0` and whose screen coordinates are right — a build that used
client coordinates drops the pet in the frame's corner.

Three more of the same shape, each measured: the left-button press no longer re-checks `over` (that
value is a 16 Hz-stale cursor verdict, so a press just after the cursor landed was dropped — "the first
drag does nothing"); `followPet` must not re-send the REAL cursor while a self-test is probing (it
overwrote the probe's synthetic cursor and the wheel check anchored at the physical mouse); and the
self-test asks the launcher for `getBounds()` rather than the page's cached `windowOrigin` when it
injects a wheel event (the page's copy is stale while the cursor stream is paused, which put the
injected point outside the window).

### Three traps in the fix itself

1. **`setBounds` takes `{x, y, width, height}`, not `{left, top, ...}`** — Electron ignores unknown
   keys, so the window resized and stayed where it was, and the canvas (positioned at
   `pixels.left - windowOrigin.x`) was drawn a few pixels left of the window and clipped.
2. **A page variable named `frame` shadowed the frame-loop function** (`function frame(now)`), so
   `requestAnimationFrame(frame)` threw `parameter 1 is not of type 'Function'` and the page never drew.
3. **A locked Windows session breaks every measurement**: the desktop shows the lock screen, so the
   reference window reads as FROZEN and the pet page can sit at `ready: false` for minutes. Two runs
   were thrown away before that was noticed. If a run looks inexplicable, **capture the whole screen and
   look at it first**.

### The documentation incident

A PowerShell batch replace went wrong in a way worth remembering: `@( @('a','b') )` — a ONE-element
outer array — is unwrapped by PowerShell, so `foreach ($pair in ...)` yielded the two strings and
`$pair[0]`/`$pair[1]` became single CHARACTERS. `text.Replace($pair[0], $pair[1])` therefore ran
`Replace('T', 'e')` across `docs/ARCHITECTURE.md`, destroying every capital T (433 lines affected).
It was repaired by a program that only replaces a token when the project's own vocabulary or
identifiers prove the T (`ehe` →`The`, `GEe` →`GET`, `eHREE` →`THREE`, `eextureLoader` →`TextureLoader`), 149 tokens in all, with a residual detector reporting none; `check-docs.mjs` and the
suite totals are green, and the damaged copy is kept as `ARCHITECTURE.md.corrupt` beside the probe rig.
**Do not use a shell here to edit source or docs** — that rule already exists in §13 and this is what
ignoring it costs.

## 17. The gaze became a setting (2026-10-08, last round)

Four requests in a row, each one sentence, each one an actual change of behaviour:

| Said | Done |
|---|---|
| "头部跟随鼠标转向，最高可以到90度 | `GAZE_YAW_LIMIT` written as `(90°)/GAZE_WEIGHT` |
| "90度好像有点夸张，80度可能合适一了 | 80°, and the assertion moved to the WORLD effect (`sideways = sin 80°`) |
| "满偏距离是屏幕的水平分辨率 | the floating window passes the work-area width as `pointerAim`'s `spanX` |
| "鼠标靠近的时候变化快，离远了反而变化慢，是一个斜率逐渐降低的曲线 | `core.gazeCurve(t, a) = t / (a + (1 - a) t)` |
| "把曲率和span都变成可以在模型参数中设置的变量后 | `gazeCurve` / `gazeSpanX` / `gazeSpanY` preferences + the 视线 section |

### The two traps this round had

1. **A limit is not the delivered rotation.** `applyGaze` multiplies the gaze by `GAZE_WEIGHT` (0.85)
   before it reaches the bone, so `Math.PI / 2` reads as 90° and delivers 76°. Both the 90° and the 80°
   version are therefore written *through* the weight, and the suite asserts the head's forward axis in
   the stage's frame (`sin 80° = 0.9848`) rather than the constant — a check on the constant would have
   passed on a build whose head turned 76°.
2. **`0` must mean auto, not zero.** `gazeSpanX`/`gazeSpanY` default to 0, where 0 = "the caller's frame
   width" (the screen in the floating window, the window in the overlay) via `core.resolveGazeSpan`. A
   stored settings file from before these keys existed, or a field a user zeroed, must keep the shipping
   behaviour instead of collapsing the span to nothing — and a *negative* value must not become a
   zero-distance gaze either. Six core assertions cover that ladder, and the settings page prints what
   "auto" currently resolves to so the number is visible rather than implied.

The curve is written as `t / (a + (1 - a) t)` for a reason worth keeping: `f(0) = 0` and `f(1) = 1`
EXACTLY, so the span keeps its meaning ("满偏" still happens at one span), it is smooth (no kink in front
of the pet) and monotone, and **a = 1 is exactly a straight line** — which is what makes the new behaviour
comparable to the old one in a test rather than only in a screenshot.

### 17b. Blinking, and the vertical half of the drag sway

Two more one-line requests, both of which turned out to have a mechanism worth writing down.

**"最0%的概率快速连续眨眼次（两次总时长为单次眨眼的.5倍）"** — a blink is now a pulse TRAIN: one triangle
for a single blink, the same triangle twice inside `1.5 x` the time for a double, so the weight passes
through zero between the two and the eyes are visibly open for an instant. That instant is the difference
between two quick blinks and one slow squint, so the check counts the RISES through the closed half and the
dip between them, not just the duration — measured `single {rises: 1, 133 ms}`, `double {rises: 2, 200 ms,
dip: 0.095}`, and the 20 % boundary pinned at 0.19 vs 0.21 with the scene's injectable `random`.

Fixed on the way past: the blink used to set its weight to **1** on the starting frame, so the eyes snapped
shut for one frame before the ramp began. Invisible on a single blink at 60 fps; a stutter in the middle of
a double. The state machine now carries `state.blinking`, and the weight starts at 0.

**"不只左右移动会触发头发等的晃动，上下移动时也要有自然的摆动** — the cause is mechanical, not a missing
factor: a chain hanging DOWN cannot be excited by moving its anchor ALONG its own axis (the joints only bend,
and the solver holds their distances), so the drag lag's vertical translation barely moves the hair at all.
A chain like that answers a ROTATION of its root, so the vertical velocity now pitches the stage too, and
the tip of the hair swings like a pendulum in the sagittal plane instead of sliding.

Measured on the committed fixture, as an A/B rather than an absolute: the same vertical impulse bends the
chains **0.0689** world units with the lean and **0.0012** with the lean suppressed (the test intercepts
`applyDragLag` inside `tick` and zeroes the rotation right after it) — 57x, so the lean is the sway and not
a flourish on top of it. Lateral bending from a pure translation is small on this fixture (0.002) because
its two chains are short and stiff; that is a property of the fixture, which is why the assertion is the
A/B and not a ratio against the horizontal case.

## 18. The VRMA pipeline, and a generated wave to prove it (2026-10-08, last)

The ask was "switch the pipeline to VRMA and render a waving VRMA to test it". The renderer half already
supported VRMA (`buildVrmaRecord` →`createVRMAnimationClip`), so the work was everything AROUND it.

### What was actually missing

1. **The floating window had no motion path at all.** `client.js` (the in-DSH overlay) had the whole thing —   catalog, per-state map, byte cache, clip per avatar — and `desktop-page.js` had **nothing**. So a `.vrma`
   assigned in the panel animated the pet inside DSH and left the desktop window frozen, and the window is the
   pet a desktop-pet user actually watches. That is why "no `.vmd`/`.vrma` has been seen in the live app" was
   still true after the motion feature shipped. The page now mirrors the overlay: filter by avatar family
   (`vrm` →`.vrma`, `mmd` →`.vmd`), fetch bytes once, build clips per avatar, drop them on a model switch,
   and publish `motion: {kind, format, mapped, playing, available, reason}` so a silent failure is readable.
2. **A `.vrma` could only be used by editing the profile config and restarting DSH.** `config.motionDirs` was
   the only source. Now there is an imported list too — plugin-owned `pet3d-motion-dirs.json` beside the
   settings, unioned with the configured dirs, and the catalog is rebuilt **per request**, so an import is live
   on the next fetch. `PET3D_MOTION_DIRS_FILE` redirects it in tests (gotcha 37: a suite must not write the
   operator's file).

### The wave, and why it is a test rather than an example

`scripts/make-vrma-fixtures.mjs` now also writes `build/fixtures/vrma/pet3d-wave.vrma`: 2.0 s, 7 channels,
61 keys at 30 fps, the right arm raised ~66° with the forearm swinging ±26° over exactly three cycles. Two
properties make a generated file portable between models, and they are the ones to copy when authoring:

* **World-aligned axes.** three-vrm's normalized rig is built from the raw bones' WORLD positions with every
  normalized node's rotation left at identity, so "raise `rightUpperArm` about Z" works on any VRM.
* **A rest-height hips translation.** `createVRMAnimationClip` scales that track by
  `humanoidY / restHipsPosition.y`, so a constant at the animation's own rest height lands on the model's rest
  position at any proportions. (Omitting the channel also works for an in-place clip; a wrong constant is what
  makes a pet float or sink.)

Measured, not judged by eye: `node scripts/verify-motion.mjs --model build/fixtures/vrma/pet3d-minimal.vrm
--motion build/fixtures/vrma/pet3d-wave.vrma` →**18 checks passed**, `format vrma`, `7 tracks`, `2.0 s`, six
driven humanoid bones, the right upper arm 146.5° from rest, largest per-frame change 29.1° on the forearm.
The browser probe drives the WINDOW'S own path with the same bytes and asserts a bone's rotation changes
between two frames (`boneMoved 0.0374`) while the published state says `playing: "a1"`.

### Two behaviours the wave exposed (same round, both measured)

**The window was too small for a pose.** The window's rectangle IS the pet's box, and a raised arm is drawn
outside that box — so the hand was cut off at the window's edge. While a clip plays the page expands the
canvas (and therefore the window) by `MOTION_FRAME_MARGIN` and the camera pulls back by the same factor
(`Scene.setFrameMargin`), so the pet keeps its size in PIXELS and gains room around it. Measured on the
wave: the hand reaches **129 px from the centre against a 110 px half slot** (it genuinely does not fit), and
**inside the 1.35x canvas** (149 px half). The probe asserts both directions, so neither "the margin was
unnecessary" nor "the margin is not enough" can pass unnoticed.

**The gaze used to stand down while a clip drove the head**, because assigning the rest pose would erase the
authored head track every frame. It now layers ON TOP of the clip (post-multiplied) with a budget:
`addition = clamp(desired, +-max(0, 70 deg - clipTurn))`. Measured: `clipTurn 8.6 deg -> added 61.41 deg`
at full aim, which is exactly "70 - the original motion". A clip past 70° gets no addition at all rather than
a fight over one bone.

### The resting pose, authored from the rig's signs rather than by feel

`build/fixtures/vrma/pet3d-rest.vrma` (6.0 s, 41 channels, ~25 kB) is the pose a pet sits in when nothing is
happening: arms hanging, elbows and fingers relaxed, the body turning slowly. A VRM rests in a T-pose with the
left arm along +X and every normalized node's rotation at identity, which fixes every sign analytically — "arm down" is Z **−0 (left) / +80 (right)**, the elbow's forward bend is about the carried **Y** axis (which
for a lowered arm is roughly the world X axis, so it tips the forearm forward), and the fingers curl about
**Z** toward a palm that faces the body after the arms come down. One rule covers the mirror: **left is the
negative side of every axis**, and both arms use the SAME sign for forward motion.

Measured on the fixture (the probe asserts all of it, and the first run of that check was measuring the
procedural stand instead — `playing: null`, 75° = `VRM_ARM_DROP_LIMIT`. That is worth remembering: "the arms
look right" is not evidence that the clip is playing):

| Claim | Measured |
|---|---|
| hands hang below the hips | **0.16 units = 26 %** of the model's height |
| hands at the sides, not spread | **0.10 units = 16 %** laterally (a T-pose would be near a full arm span) |
| elbows bent | **14.9°** between the upper arm and the forearm |
| fingers curled | **30 finger-joint tracks**, 18–30° each (read from the file's JSON: the fixture has no fingers) |
| body turning slowly | head-vs-hips lateral sway spans **0.01 units** over the clip |

### What still needs a DSH restart

The host half is new code: the motion-dirs import, and the gaze settings from §17. The renderer half (the page,
the chunks) is re-read per window start and is already live. So the live wave appears after the next DSH
restart — and to make that one step productive, `pet3d-motion-dirs.json` was written pointing at
`D:\SynologyDrive\FatFish-pet\Motions` (with the wave in it) and `motions: {resting: "a1"}` was set through the
settings route, so the pet waves as soon as the new host serves the catalog. Plainly: **the wave is proven in a
real renderer (Chromium, the real loader, the real mixer) but not yet in the operator's own window.**

## 19. Several clips per state, and the one-shot (2026-10-09)

Asked for: **多支 VRMA 动作，按状态随机调用** — three to five clips for 静息态, one or two for 工作态, one each
for success and failure, and a different one drawn each time a state is entered.

### The contract, and why it is a LIST even for one clip

`motions` is now `{ state: [motionId, ...] }`. A legacy bare string (`{ resting: 'a1' }`) is still accepted
by `core.cleanMotions`, and that is not a courtesy: the map is PERSISTED, so every profile written before
this round holds the string form, and a cleaner that refused it would have erased the operator's whole
motion configuration on the first run of the new build — a loss that looks like "the pet forgot my motions".
Three helpers moved into `lib/core.js` so both panels and the host read ONE shape: `motionIdsFor` (one
state's list), `motionIdList` (every id, which is what has to be preloaded) and `setMotionIds` (the pure
write, returning a fresh map).

### The draw happens on state ENTRY

`Scene.resolveAuthored` compares the state against the one it drew for (`pickState`); only a change draws,
via `pickMotionFor`, which takes one id uniformly from the list using the scene's injectable `random`.
A per-frame draw would flicker between the clips of a list several times a second and make `playing`
meaningless. The browser suite pins `scene.random` to a CONSTANT — not a sequence, because the blink timer
draws from the same random and a sequence would be consumed by whichever caller ran first — and asserts that
two entries of one state CAN differ, that the drawn clip is the one playing, and that the draw does not
change while the state holds.

### `loop` is a property of the clip, and a one-shot hands the pose back

A `.vrma` says how the bones move; it cannot say whether it is a six-second ambient loop or a two-second
wave. So a motion directory may carry its own `pet3d-motions.json`:

```json
{ "clips": { "pet3d-wave.vrma": { "loop": false } } }
```

`buildMotionCatalog` reads it once per directory, keys are file names RELATIVE to that directory (never
absolute paths, never ids — an id is minted per profile), and anything absent means LOOP, which is what every
clip did before the flag existed. The page passes the flag with the bytes (`scene.loadMotion(id, bytes,
{ loop })`), which is the only place that can turn it into `LoopRepeat, Infinity` or `LoopOnce`.

**The end of a one-shot is the part that needed care.** Three mechanisms, and each exists for a failure that
was measured or is one line away:

* `LoopOnce` + `clampWhenFinished = false`, so the action falls out of influence instead of holding its last
  frame — a clamped one-shot is a pet frozen mid-wave until the state changes.
* the mixer's `finished` event AND the action's own clock (`Scene.motionFinished`). Both, because the MMD
  path drives the mixer from inside `updateWithMixer` rather than from `mixer.update`, so the two signals are
  not interchangeable and a latch that depends on one of them freezes the pet on the other path.
* `pickSpent` — the latch that stops the clip from being restarted on the next frame. Without it "play once"
  is a loop with extra steps, and the browser suite asserts exactly that: after the clip's own duration, the
  pet reports `playing: null`, and five further frames do not bring it back. The contrast is asserted too: a
  LOOPING clip is still playing after the same number of ticks.

### The UI

* **The settings window (模型参数) gained a 动作 section.** One collapsible box set per state, the clips
  listed from `/pet3d/motions` (so an import is live without a restart), each labelled `循环` or `播放一次`,
  and a summary line that says how many are ticked or 程序化待机. Unticking the last box deletes the key —
  that IS the procedural idle, which is why there is no "procedural idle" checkbox to explain. It publishes
  `motions: {controls, offered, oneShot, rows, ticked}` for the live suite.
* **The app panel's motion rows became box sets too.** They had to: a `<select>` reads `motions[state]` as a
  string, and with a list the row would have looked empty while the scene was being fed two clips. The rows
  are `<details>` with a count in the summary, and `onMotionChange` rebuilds the state's list through
  `core.setMotionIds` rather than editing the map.

### The generator, and the clips that make the feature visible

`scripts/make-vrma-fixtures.mjs` gained a table-driven gesture builder (`buildGestureVrma`) sharing the
wave's and the rest clip's world-axis language, and a table of four gestures: `pet3d-look-around`,
`pet3d-weight-shift`, `pet3d-stretch` (all loops, written as functions of `sin`/`cos` so the loop has no
seam) and `pet3d-happy-hop` (a one-shot: a hop, then a settle back toward rest). It writes the manifest
beside them, declaring the wave and the hop as one-shots. A generated clip is verified on a REAL model the
same way the wave is: `verify-motion.mjs --motion build/fixtures/vrma/pet3d-look-around.vrma` loads it (10
tracks, 5 s) and drives the pose.

Note for anyone adding gestures: the fixture VRM has no `chest` bone, so that track is dropped in the probe
— the documented "binds by name, silently" behaviour. The operator's own VRM has 53 humanoid bones.

### What needs a DSH restart

**The host half**: the manifest read and the `loop` field in the catalog. Until the restart, `/pet3d/motions`
serves entries with no `loop`, the page treats that as "loops", and the manifest is ignored. Everything else
in this round — the cleaner/list contract, the draw, the one-shot end state, both panels, the settings
section — is renderer-half code, live on the next window or page load.

### The incident: two documents were corrupted and repaired

The HANDOFF and ARCHITECTURE counts were updated with a PowerShell `Get-Content`/`Set-Content` round trip,
and this machine's PowerShell read and wrote them as **ANSI (cp936)**, not UTF-8. Valid GBK byte pairs
survived untouched; wherever the decoder met an invalid pair it swallowed one or two bytes and emitted `?`,
which took out 390 byte positions in HANDOFF and 91 in ARCHITECTURE — every non-ASCII character in the two
files was at risk, and the damaged spots also lost the byte that followed them (usually a space, sometimes a
digit or a newline).

A one-off Node script (written, run and deleted in the same session) rebuilt them: a UTF-8 character whose
third byte was eaten is recoverable because its first two bytes are known, so the candidates are the bytes
that prefix is followed by ELSEWHERE in the same file — a character that appears intact somewhere resolves
every damaged occurrence of itself. Ambiguous prefixes (several characters sharing two bytes) and dashes were decided from
the sentence, and the eaten byte was restored where the surrounding text proved what it was (a space after a
clause dash, a NEWLINE when the next line starts a blockquote, the leading digit of a date). Both files end
valid UTF-8 with no replacement characters, and the documented counts and paths are re-verified by
`check-docs.mjs`, which is what would have caught a wrong digit.

**The lesson is not "be careful with PowerShell"** — it is that `Set-Content` on this machine does not
default to UTF-8, so a text round trip through the shell is a lossy operation. Edit files with the editor
tools; if a shell round trip is unavoidable, pass `-Encoding utf8` explicitly and diff afterwards. (Measured
again the hard way: this shell is **Windows PowerShell 5.1**, where `utf8NoBOM` does not even exist and a
plain `Set-Content` writes ANSI.)

## 20. Five answers from the operator (2026-10-09, after §19)

Five reports from the person using it, in the order they were worked, with what was actually wrong.

### 20.1 The spring section's layout was a fixed grid

`模型参数`'s spring rows were `grid-template-columns: 132px repeat(3, minmax(150px,1fr)) auto` — about 700 px
of columns, each cell holding a label, a slider, a number box and a button. With 22 chains (蓝色小肥鱼) the
section overflowed its window and every row read as broken. It is now a wrapping flex block: the chain's name
on its own line, then the three fields, which reflow onto more rows as the window narrows.

### 20.2 The hair hung but never swung — sixteen of the fish's chains were invisible to the renderer

The model declares **22** spring chains; the renderer's chain analysis reported **6**, and `physics: {enabled:
true}` (published by the launcher, §20.6). The cause is a name mismatch nobody would guess: `GLTFLoader` runs
every node name through `PropertyBinding.sanitizeNodeName`, which turns spaces into `_` and **deletes**
`[ ] . : /`. A bone the file calls `LiuHai.L` is loaded as `LiuHaiL`, so matching the document's names against
the loaded bones' names matched only the chains whose names happened to be clean. The other **16** chains were
reported as `skipped`, which meant the settings window listed them (from the FILE, parsed separately) while
the renderer had no chain object to apply an override to — their sliders did nothing at all.

`sanitizeNodeName` now lives in `lib/core.js` (unit-tested against three's rule), both sides of the match are
normalised through it, and the launcher publishes what the renderer actually has. Verified live: `chains` went
from **6 to 22**, `skipped 0`.

**What that does not prove**: that the hair moves MORE now. The solver always ran on the joints three-vrm
built (our matching only feeds the settings), so if the pet's hair still looks too still, the levers are the
spring sliders — which now do something — and `sway`. That is the next thing to try, and it is why the
diagnostic was added rather than guessed at.

### 20.3 The 表情 table gained 无, and 无 is now the default

`emotions: []` used to mean "any emotion this model declares", so a still-faced pet was impossible to ask
for. It now means **no expression**, the three rows ship ticked as 无, and the window puts a 无 box first on
every row: ticking it clears the others, ticking a label clears it, and un-ticking it with nothing else ticked
puts it back (a row with nothing selected IS 无). Ticking every label no longer collapses back to the empty
list, because that list now means silence rather than "all".

A stored profile from before this round holds `[]` for rows whose owner expected the model's own moods; after
it, those rows are silent until labels are ticked. That is the requested behaviour, and it is written down
here because it is a visible change to an existing pet.

### 20.4 The 视线 curve was live — and now provable

Checked before changing anything: a `gazeCurve` PATCH **does** bump the host's version (`61 → 62` measured),
the window's renderer publishes the curve it used (`curve: 0.8` after posting 0.8), and both surfaces pass
`preferences.gazeCurve` into `core.pointerAim` every frame. So the setting reaches the head.

What was missing was any way to SEE that: the effect on the head is small when the cursor is near the pet
(a tenth of the span buys ~22 % of the turn at 0.4 and ~10 % at 1.0), and nothing in the window said which
curve was in force. The launcher now publishes `gaze: {curve, spanX, spanY, aim}` from the page's own state
(§20.6), so "the slider did nothing" and "the slider arrived and the pet is barely off-centre" are
distinguishable from outside. If it still reads as dead, that is a magnitude/expectation question rather than
a wiring one, and the resolved aim is the number to look at.

### 20.5 循环/单次 per clip, and a per-state one-shot interval

Two settings, both persisted and both in the 动作 section:

* **`motionLoop: { [motionId]: boolean }`** — the play mode belongs to the CLIP, so the window lists each
  catalog clip **once** with a 循环/单次 menu. The motion directory's `pet3d-motions.json` stays the
  declaration; this is the user's override of it, and `motionLoopFor(prefs, id, declared)` is the one place
  the two are combined. A mapped clip whose mode changed is **re-loaded** (the surfaces already cache by
  `(id, mode)`), because the flag only reaches the renderer with the bytes.
* **`motionEvery: { [state]: {min, max} }`** in seconds — while the pet is in that state it wears the
  LOOPING clip, and once the scene clock passes a delay drawn randomly from the window, ONE of that state's
  non-looping clips plays and hands the pose back; the next window starts when it ends. `max: 0` is OFF
  (checked before the ordering, so clearing the upper bound cannot invent a window), an inverted pair is
  ordered, and the draw prefers a looping clip so a state with a mix still has a posture.

Asserted in three places: the cleaners and helpers in `verify.mjs`, the panel/preferences round trip in the
client probe, and — the one that matters — a real scene in `verify-motion.mjs`: the interval is armed, the
non-looping clip fires when the window comes due, the state goes back to its looping clip afterwards, the next
window starts from the END of the reaction, and a state with no window never fires at all.

### 20.6 Diagnostics the launcher now publishes

`GET /pet3d/desktop` gained `page.gaze` (the curve, spans and the aim the last frame fed the head),
`page.physics` (`enabled`, `error`, the preference, `chains`, `joints`, `skipped`) and `loop` on every
`page.motion.available[]` entry. All three exist because this round's two hardest questions — "is the curve
reaching the renderer" and "is the spring solver running" — could not be answered from outside without them.

## What is left

> **The current list is the "START HERE TOMORROW" block at the top of this file.** What follows is the
> historical record of earlier rounds, kept because each item carries the reason it was done.

* ~~**A DSH restart.**~~ **DONE 2026-10-08 at 20:08** — the app was restarted, so every item below is
  now in the running process. What that restart had to carry (all regenerated before it; the six
  items of the original list):
  1. the model-id fix — host half;
  2. the T-pose stand — client chunks;
  3. the interaction round: wheel zoom, the size reset, the right-drag orbit, the slot cap
     that keeps a big pet draggable, and the listener-driven drag fix;
  4. the bounce: off the side walls and now off the top edge;
  5. the gaze: following the cursor anywhere in the window, resetting when it leaves, and
     turning the head about axes measured per model so both VRMs tip the same way;
  6. the floating window: the launcher, the borrowed runtime, the window routes and the panel's
     switch — **both halves**, so this one needed the restart more than any of the others.

  Confirmed live against the running host at 20:17 (not inferred): `/pet3d/{catalog,motions,models,
  settings,config,window,desktop}` →200, and `/pet3d/desktop` →`state: running` with the page
  reporting `ready: true, webgl2: true` on this machine's RTX 2060.

  **Still to check by eye, not by probe:** `node scripts/live-probe.mjs --id-race` should print
  `PASS` (it needs a model directory imported; the catalog is empty on this machine), the loaded
  model should stand with its arms down instead of in a T, the head should follow the cursor
  **outside** the pet's box on both models — the fish's pitch was the one that was wrong — and the
  floating window should stay correct when the pet is clicked (the open freeze bug at the top).
  **The catalog is empty here because `D:\SynologyDrive\FatFish-pet\Models` has never been imported
  into this profile** — the two VRMs are on disk but absent from `/pet3d/models`, so the pet is
  showing the placeholder right now.
* **Confirm the animation in the app.** The model loads and is visible; the T-pose report
  answered "does it move at all", and this fix is what makes the answer yes.
* **Step 2 of the floating window**, listed at the end of §13: a panel of its own, the session
  state stream, and multi-monitor.
* **Then** consider the `/pet3d/models` settings UI (`docs/ARCHITECTURE.md`, Known
  limits), which would make the import step possible without this repository at all.
* To undo everything on this machine: `plugin_manager remove_bundle dsh-plugin-pet3d`,
  `set_bundle dsh-plugin-whale-pet enabled=true`, then restore the two `.bak` files
  above if the manager's own rewrite is not wanted. The borrowed Electron runtime
  (`F:\DeepSeek\pet3d-desktop-runtime`, or wherever `PET3D_DESKTOP_HOST_DIR` points) is
  disposable: delete it and it is rebuilt on the next start.

## 21. The VRoid garment, and what "call vrm.update" really means (2026-10-09, evening)

The operator dropped a new model in — `SampleModel.vrm`, VRoid's sample **ヴィータ / Vita** — and reported
that **the transparent parts of its clothes render as solid black**, which is also why they first thought the
model had an outfit switcher. Every static check said the material was fine, and the fix turned out to be one
missing call.

### 21.1 What was actually wrong

Our VRM wrapper drives the rig itself, so it called `vrm.springBoneManager.update(delta)` and nothing else.
three-vrm's own entry point — **`VRM.update(delta)`, whose doc comment is literally "You need to call this on
your update loop"** — does three things:

```js
    update( delta ) {
      super.update( delta );                                  // humanoid, lookAt, expressions
      if ( this.nodeConstraintManager ) this.nodeConstraintManager.update();
      if ( this.springBoneManager ) this.springBoneManager.update( delta );
      if ( this.materials ) this.materials.forEach( ( material ) => material.update( delta ) );
    }
```

The last line is the one that mattered. MToon keeps its **own** `alphaTest` uniform and refreshes it inside
`Material.update(delta)`:

```js
    _updateUVAnimation( delta ) {
      ...
      this.uniforms.alphaTest.value = this.alphaTest;   // <- never ran
      this.uniformsNeedUpdate = true;
    }
```

With it never running, the uniform stayed **0**, so `#ifdef USE_ALPHATEST` in MToon's fragment shader
discarded nothing. A VRoid garment texture is **77 % alpha-0 texels whose RGB is pure black** (measured:
`F00_002_Onepiece_01.png`, 2048², 77.5 % at alpha 0, mean RGB [0,0,0]; of the pixels that *should* draw,
96.4 % are bright). So the cut-out drew as opaque black and the dress — white and cyan in the file — read as a
black dress. `nodeConstraintManager.update()` was the other half of the same omission (VRM 1.0 only; none of
this machine's three models declares a constraint, so it was latent rather than visible).

### 21.2 The fix, and how it was measured

`updatePhysics` now steps the spring bones, the node constraints, and `material.update(delta)` for every
MToon material. Measured on the real renderer with the page's own framebuffer, in the same pose:

| | near-black pixels, whole pet | near-black pixels, garment alone |
|---|---|---|
| before | 38 269 | 28 034 |
| after | 9 431 | **0** |

9 431 is the baseline the body's own dark under-dress paint produces (hiding the garment entirely measured
9 284), so after the fix the garment contributes no black at all. The screenshot below is the same frame
before and after.

### 21.3 The tools this produced, and why they are worth keeping

`build/render-model.mjs` renders one model with the plugin's own scene code in a headless browser and returns
the pixels *and* the material table, with `--chains-only` for a 26 MB model that is too slow to rasterise on
SwiftShader. `build/inspect-vrm0-alpha.mjs` compares a VRM 0.x material's glTF `alphaMode` with the keyword
map three-vrm's compatibility layer converts from (they agreed; the layer is not at fault).
`build/inspect-appearance.mjs` answers "is the clothing a separate mesh or a primitive", which is what a
clothing/appearance feature would need. `build/texture-alpha-stats.py` and `build/texture-luminance.py` print
the numbers that separated "the mask is broken" from "the fabric really is dark". And the launcher's self-test
now writes **screenshots**: `-canvas.png` from the page's own framebuffer (because `capturePage()` returned
353 430 fully transparent pixels for a window whose canvas held 58 938 painted ones — it goes through window
compositing and cannot be trusted), plus `no-outline` / `only-cloth` / `no-cloth` / `alpha-test-2` variants
whose differences are what identified the garment as the culprit.

### 21.4 Every model's spring chains load — measured, not assumed

The other report was "confirm every model's spring bones load completely". They do, and the numbers are from
the renderer's own account (`chains` matched, `skipped` unmatched):

| Model | VRM spec | Declared chains | Renderer matched | Skipped |
|---|---|---|---|---|
| `HatsuneMikuNT.vrm` | 0.x | 2 | 2 | 0 |
| `SampleModel.vrm` (VRoid) | 0.x | 18 | 18 | 0 |
| `蓝色小肥鱼.vrm` | 1.0 | 22 | 22 | 0 |

The fish is the interesting one: its chains are named `DaiMao`, `LiuHai`, `LiuHai.L`, `LiuHai.R`, `FaBing.L` —
**names with dots**, which is exactly what `sanitizeNodeName` (§20.2) has to fold before they can be matched; 16
of the 22 were invisible to the renderer before that fix. `/pet3d/desktop` publishes `page.physics`
(`chains`, `joints`, `skipped`, `enabled`, `error`), so a chain the renderer cannot match can never hide again:
it shows up as `skipped` instead of as a slider that does nothing.

**Still a taste question, not a bug:** whether the hair swings *enough*. The solver runs on every model now,
the sliders reach all their chains, and the remaining levers are stiffness/drag/gravity per chain and `sway` —
which is what the settings window is for.

## 22. Finishing the five items: the 视线 readout, and what looking at the window caught (2026-10-09, late)

The host restarted in between, so the two settings that needed the host half (`motionLoop`, `motionEvery`) now
persist — verified by a POST that bumped the version and read back. What was still missing was the user-visible
half of item 4, and the visual pass over the window that items 1/3/5 never got.

### 22.1 The 视线 section now reports what the RENDERER applies

The report was "the gaze curve doesn't seem to take effect live". It did — the patch reaches the host, the host
bumps its version, and both surfaces feed `preferences.gazeCurve` into `core.pointerAim` every frame — but at
10 % of full deflection a curve of 0.4 turns the head ~22 % while a curve of 1.0 turns it ~10 %, so the effect is
genuinely small near the pet, and nothing in the window said which curve the head was using. The section now
carries one line, refreshed every 2 s from `/pet3d/desktop`:

> 渲染器正在使用：曲率 0.20 · 满偏 1707×320 px · 当前视线 -0.86, -0.81

The numbers come from the running pet (`page.gaze`), not from the store, so "the setting never arrived" and "it
arrived and the pet is barely off centre" are now different sentences. Checked live: the host said `0.1` and the
window said `0.1` — they agree — and a transient 0.20 while the slider was moving is exactly the kind of thing
this line is for. Asserted in the desktop suite on the ELEMENT (a value only exists while a floating window
runs) plus "it stays empty rather than guessing".

### 22.2 What looking at the real settings window caught

Two defects that no assertion had covered, both found by screenshotting the window the operator actually uses:

1. The 表情 hint still said **"一项都不勾选表示'这个模型能显示的都可以'"** — the semantics §20.3 replaced. The
   table was right (「无」 ticked everywhere) and the sentence beside it described the old behaviour, which is
   the worst kind of stale text: the page contradicts itself. Rewritten to say what 「无」 does.
2. A deep link into a long page did not work: `…/pet3d/config#spring-list` stays at the top, because the
   sections are rebuilt by `renderAll` after load and the browser's fragment jump happens before the target
   exists. `?scroll=spring-list` now does it, AFTER the render — which is what let the spring layout and the
   视线 line below be checked by eye at all.

Also confirmed by eye, in the real window against the live host (model `m2`, 18 chains): the spring section
lays out one chain per block with the three fields wrapping under the name — no overflow with 18 (and the fish's
22) rows — the 表情 table opens with 「无」 ticked on all three rows, and the 动作 section lists 6 clips with 2
one-shots plus an interval line per state.

### 22.3 The interval, and the four bugs it took to make it real

`motionEvery: { resting: { min: 20, max: 80 } }` is set on this profile deliberately: the pet's 静息态 is mapped
to `a1 = pet3d-happy-hop.vrma`, which the catalog declares as a one-shot, so the pet hops once somewhere in
every 20–80 seconds. Setting `max` to 0 in the window turns it off; mapping `a4 = pet3d-stretch.vrma` (伸懒腰)
or `a5 = pet3d-wave.vrma` alongside it is how to vary what appears.

Getting there took **four** fixes, all found by watching the real pet rather than by reasoning, and three of them
are now checks in `verify-motion.mjs` (Phase D2/D3/D4 — the suite went from 38 to 42 checks):

1. **The window was armed at state entry, before the clip's bytes had arrived.** `motionLoops` can only assume
   that a clip it has never seen loops, so at entry there was nothing to arm for — and nothing ever re-armed it,
   because the state does not change again. Symptom: `scheduled.window` reported the configured 20–80 s while
   `scheduled.nextAt` stayed `null` and the pet never fired. Fixed by arming lazily, on the first frame where the
   state has both a window and a loaded one-shot candidate.
2. **A state flip threw the deadline away.** The deadline lived in one field, so entering `working` (no window)
   disarmed `resting`'s window, and returning redrew it from scratch: measured on the real pet, a 20–80 s window
   reported 63 s and, thirty seconds later, 219 s. The deadline is now **per state**
   (`motionWindows[state] = { nextAt, window }`), and the window that produced it is stored beside it, so changing
   the interval in the settings window re-arms immediately instead of waiting out a deadline drawn from old numbers.
3. **A consumed deadline was reused.** After a reaction ended, the new window was drawn on top of the one just
   consumed, leaving it already due — the pet chained reaction into reaction. It is dropped first now.
4. **Re-applying an unchanged map reset everything.** `setMotionMap` forgot the draw on every call, so a surface
   that re-applies the map it already has restarted the state's clip and threw the window away. This was the one
   that survived the first three fixes and looked exactly like them: `nextAt` moved by precisely the elapsed time
   between two reads 30 s apart. `setMotionMap` now returns early when the cleaned map is unchanged.

**Confirmed on the live pet, 2026-10-09 late, in this order:** `nextAt` held steady across 25 s
(`52.857… → 52.857…`, `armed = [resting]`), and the walk-away test then caught it firing — `playing=a1`,
`scheduled.running=a1`, 30 s into the watch. The pet hops on its own schedule.

Two more things this round taught, both about looking rather than reasoning:

* `page.motion` in the launcher's payload was built field by field, so the two fields that answer "is the interval
  even armed, and for which state" were silently dropped. Adding `picked` and `scheduled` is what turned "nothing
  happens" into "the state and the window are right and `nextAt` is null".
* The screenshot pass (§22.2) is what caught the stale 表情 hint; the same trick is how the spring layout and the
  视线 line were checked at all, via the new `?scroll=<id>` parameter.

## 23. Four more from the operator: the mouth table, the unnamed chains, per-state clips, and the preview

The same evening, four requests in one message (2026-10-09, late). All four are implemented; **one needs a DSH
restart to be live**, which is stated where it matters.

### 23.1 单独的口型设置 is GONE

`设置面板关闭单独的口型设置`. The 表情 section used to carry a table of every expression with a manual weight
slider ("口型（aa/ih/ou/ee/oh）目前只支持手动"), which made the panel read as a mouth-shape editor and duplicated a
choice the 动作 section now owns. The table, its hint, `renderExpressions` and `describeTargets` are deleted;
the emotion table (one row per situation, 「无」 included) is what remains, and `core.expressionWeightFor` /
`setExpressionWeight` stay because pins are still honoured when they exist in a stored profile.

### 23.2 大量无法修改的未命名链 — a key that could never be stored

`设置面板中存在大量无法修改的未命名链`. Two faults, both about the IDENTITY of a chain:

* a VRM 0.x chain is named by a free-text `comment`, and most exporters leave it empty — SampleModel.vrm's ten
  hair strands have no name at all. The settings window keyed the override by that name, so it wrote the EMPTY
  string into `springs[m][""]`, which `cleanSprings` **drops** and `springOverrideFor` **refuses**. The slider
  therefore snapped back on the next render: unmodifiable, exactly as reported;
* and the renderer had invented its own fallback of `hair0`, `hair1`, … so even a stored value would have been
  looked up under a different key.

One rule now, in `core.springChainKey`: the declared name if there is one, else `hair<index>` (VRM 0.x) /
`spring<index>` (VRM 1.0) — the spelling the renderer already used. `lib/vrm-info.js` mirrors it (that file
imports nothing by design, so it cannot import core) and `verify-model.mjs` **asserts the two agree** and that
no key is empty. The label is separate from the key: an unnamed chain is shown by its root bone
(`HairJoint-245c78de…（未命名）`), because ten rows all called "未命名链" is the other half of the complaint.

### 23.3 Per state AND per clip: 循环/单次, 表情, 口型 — with a live preview

`每个状态下，可以针对每个动作设置该状态下该动作为循环还是单次，并可以设置该状态下该动作的表情（下拉框）和口型
（下拉框）（覆盖表情的口型），当用户正在修改这部分时，模型变成动作+表情+口型的预览，离开对应设置的位置后恢复正常状态`.

* **Data**: `motionClips: { [state]: { [motionId]: { loop?, expression?, mouth? } } }`, cleaned by
  `core.cleanMotionClips`; `motionClipFor`, `setMotionClip` (one field at a time, `null` clears it, and an
  entry with nothing left is dropped) and `motionLoopForState` — three layers, most specific first: the state's
  entry, then the old per-clip `motionLoop`, then the catalog's manifest. `setMotionClip` keeps the field that
  was already decided, which is what makes three dropdowns on one row behave like three settings.
* **Renderer**: `motionLoops(id, state)` (every call site now passes the state), `currentFace()` — the face is
  derived EVERY FRAME from the playing clip's entry, so it cannot go stale — and `expressionTargets` gives the
  clip's expression/mouth the slot the emotion would have used, which is what "覆盖表情的口型" means.
* **UI**: inside each state's box set, every TICKED clip gets three dropdowns (循环/单次, 表情, 口型, each with a
  "跟随" default so a choice can be undone). The old per-clip mode table is gone: the play mode is per state now.
* **Preview**: a separate host channel, `/pet3d/preview` — **in memory only, never persisted**, with its own
  `seq` counter so a cleared preview is distinguishable from a stale one. `POST {}` clears; both pet surfaces
  poll it (400 ms) through `core.watchHostPreview`, load the previewed clip on demand, and LOOP it (a one-shot
  would end after a second and read as broken). The scene's `setPreview` forgets the draw, so clearing puts the
  pet straight back to its state — which is why `mouseleave`/`focusout` on the row is all it takes.
* **Asserted**: the cleaners, the three-layer precedence and the preview's "empty is CLEAR" in `verify.mjs`; the
  route (start empty → set → a counter that moves → clear → and nothing persisted) in `verify-model.mjs`; a real
  scene in `verify-motion.mjs` where a preview plays a clip the state does NOT map, carries `joy` on the face,
  and clearing hands the pet back; and the page's `modeRows`/`faceRows` counts in `verify-desktop.mjs` (whose
  stub now serves settings, because a control only exists for a TICKED clip).

**⚠️ This section needs a DSH restart to be live**: `/pet3d/preview` is a new host route and `motionClips` a new
preference the host's cleaner has to keep. Until the app is restarted the framework is inert — the dropdowns
render and their writes are dropped by the older cleaner, and `watchHostPreview` reports itself unsupported and
the pets carry on normally. That graceful degradation is deliberate: a missing channel must not look like a
broken pet.

### 23.4 And a third PowerShell lesson, this time mine

Updating the counts, I ran the replacement through the shell with a **single** pair. PowerShell flattened
`@(@('Ten suites, 1040 checks.', 'Ten suites, 1076 checks.'))` into a two-element STRING array, so the loop did
`$p[0]` / `$p[1]` **of a string** — the characters `T` and `e` — and replaced every `T` in
`docs/ARCHITECTURE.md` with `e`: `The` → `ehe`, `GET` → `GEe`, `BLINK_LIMITS` → `BLINK_LIMIeS`.

It was repaired mechanically and the repair is checkable, because the damage was one character wide:
`build/repair-arch-t.mjs` applies an explicit word table, then a second pass that treats any identifier-shaped
token which is UNKNOWN to the rest of the repository but becomes KNOWN when an `e` is read as a `T` as damage
(`eRANSLAeION` → `TRANSLATION`, `KeX2` → `KTX2`, `eypeError` → `TypeError`), then REPORTS every token that
still looks damaged and refuses to guess further. 125 replacements, 0 left, 0 replacement characters.

The lesson is not new and is now on its third strike: **the shell on this machine is not a text editor.** The
counts in this file and its siblings were afterwards updated with the editor tools only, and every count is
re-derived by `check-docs.mjs` (`160 checks`) rather than trusted.

## 24. Two more: an orbit that survives leaving the frame, and no eye-following while previewing

### 24.1 右键旋转：鼠标离开小框架后必须继续转，并且必须释放

`右键旋转时鼠标一旦挪动离开小框架，旋转就是失效了，而且模型属于未释放状态`.

The gesture used to depend on two things that are both fragile in a DSH slot: `setPointerCapture` on the pet
element, and `pointermove`/`pointerup` listeners on the **document**. The capture is lost whenever the element
is re-rendered or detached, and any handler between the pointer and the document — the app's own React UI, a
panel, anything that calls `stopPropagation()` — silences the document listener. Either way the orbit stopped
the moment the pointer left the pet's little frame, and the release never arrived, so the pet stayed latched.

Now, for the duration of a gesture (orbit or placement drag):

* `pointermove` / `pointerup` / `pointercancel` are bound to the **WINDOW in the CAPTURE phase** — the top of
  the propagation chain, which nothing can silence, and which still fires when the pointer is outside the pet,
  outside the slot, and (for a mouse) outside the window. They are removed the moment the gesture ends, and
  `window.blur` cancels whatever is left;
* `lostpointercapture` no longer ENDS the gesture: that event is exactly what a re-render produces, and it is
  what used to leave the pet stuck;
* the **button state** is the honest test for a gesture that is still alive: a move carrying `buttons: 0` ends
  it (`onPointerMove`), which catches a release that was never delivered at all. `buttons` undefined — a
  synthetic event — is treated as unknown rather than as released;
* `cancelGesture()` also abandons a placement drag where it stands, so a window that loses focus mid-drag drops
  the pet instead of leaving it glued to a pointer that is gone.

Asserted in the client suite, which grew from 66 to **68** checks: a right-drag whose moves and release are
dispatched **at the window** (outside the pet) still turns the view, still reports `data-orbiting`, and still
releases; and an undelivered release is caught by the button state. The synthetic gestures in that suite now
declare `buttons` honestly, which is what surfaced the difference.

### 24.2 每状态 × 每动作 设置时，暂时关闭视角的鼠标跟随

`在"每状态 × 每动作：循环/单次 + 表情 + 口型"设置时，暂时关闭视角的鼠标跟随`.

A preview IS "the settings window is choosing that clip's expression and mouth", so `Scene.setPreview` now sets
`Motion.holdGaze` for as long as the preview lasts, and `Motion.applyGaze` treats the aim as absent while it is
set (§23.3). The cursor keeps moving and the aim keeps arriving; the suppression is what stops the head, so the
preview shows the clip, the expression and the mouth and nothing else — and the follow is back the moment the
pointer leaves that row. Asserted in `verify-motion.mjs` (47 checks): a preview sets the flag, clearing it
clears the flag, and the aim is still arriving while it is suppressed. The head's own ANGLE is deliberately not
asserted there: that fixture scene has no gaze bone to measure, and the browser suite already proves an aim
turns the head when nothing suppresses it.

### 24.3 The second orbit report: a release nobody saw, and the latch that kept turning

`右键旋转还是有故障，鼠标离开框架后旋转就卡住了，鼠标移动回来，哪怕没有按下右键，也会继续旋转`.

That is a LATCHED gesture: the drag survived a release it never observed, so the first move after coming back
turned the view without any button held. Two things were done about it.

**First, the state of the running app was checked rather than assumed.** `GET /pet3d/preview` answered
`{"seq":42}` on the live host — so the host half IS the new one (§23 had been restarted into) — and the
`lib/client.js` the host serves does contain `beginWindowGesture`, the buttons check and the removed
`lostpointercapture` binding. The client half is fetched once per page load, so a page that was already open
could still be running the pre-fix copy: **a reload of the DSH page is the first thing to try, and the file on
disk is not the question.**

**Second, the release is now detected four independent ways**, because "the browser tells us" is exactly what
failed:

1. `pointerup` / `pointercancel` on the window, in the capture phase (the normal path);
2. `mouseup` on the window — the same release through the other event family;
3. **`contextmenu`** — a right-button release ALWAYS produces one, our own listener only suppresses the panel
   rather than preventing the event, and it arrives on whatever element is under the pointer at that moment.
   So an orbit that is still armed when the menu event lands is over, whatever any `buttons` field claims. This
   is the signal that matches the reported flow (released far from the pet, then came back);
4. the BUTTON STATE on the next move, for a release that produced no event in this document at all.

All four end through one function (`finishOrbit`), so no path can forget to persist the view, to keep the panel
shut, or to remove the window listeners. Asserted in the client suite (69 checks): a right-drag released outside
the frame cannot leave the orbit turning — once via the menu event, once via the returning move's button state —
and `windowGesture` is released in both.

**If it still turns after a page reload**, the remaining suspect is not this code: it would be the browser
reporting a button as still held on the re-entry move, and the next place to look is a `pointerenter`-based
check against the DOM's own `:active`/`buttons` state.

### 24.4 The operator's own answer: lock the pointer while orbiting

`不行，鼠标抬起来的事件还是没传到框架里。可以旋转的时候把鼠标锁定吗？很多游戏里都是旋转的时候鼠标位置是锁定的，但是对鼠标的位移有反应。`

That is the Pointer Lock API, and it is the right answer for a reason no amount of listener plumbing fixes: a
LOCKED pointer cannot leave the frame, so there is no "outside" for the release to happen in. The events keep
being delivered to the locked element, `pointerup`/`mouseup` included.

What the widget does now, on a right-button press:

* `requestPointerLock()` on the pet element, from inside the press — a user gesture, which is what the API
  requires. A refusal (another element holds a lock, the document is not focused, an iframe without
  `allow="pointer-lock"`) is caught and changes NOTHING: the four release signals of §24.3 remain;
* while locked, the orbit runs on **`movementX`/`movementY`**. That is the half that is easy to get wrong:
  `clientX`/`clientY` are FROZEN under a lock, so the old difference-based delta is always zero and the view
  would stop dead — "位置锁定但对位移有反应" is exactly these two lines. The stored cursor position is not
  updated while locked either, or the first move after unlocking would jump by however far the mouse travelled;
* `finishOrbit` releases the lock through `document.exitPointerLock()`, so the cursor comes back however the
  orbit ended (release, menu event, button state, Escape, window blur);
* `pointerlockchange` is watched: if the lock goes away while an orbit is armed — Escape, another element
  taking it — the orbit ENDS rather than continuing with no button held. That is the latch this whole section
  exists to prevent, so losing the lock is treated as losing the gesture;
* `pointerlockerror` just clears the flag.

Also added in the same round: the gesture listeners are bound to the **parent window** as well when the pet is
inside a same-origin frame (`window.top`, guarded so cross-origin throws are swallowed). A release outside an
iframe is delivered to the PARENT document, not to the frame's, so that is the one hop the frame's own window
can never see.

Asserted in the client suite (**70** checks): the press requests the lock; with the cursor position FROZEN,
moves carrying `movementX`/`movementY` still turn the view, and a move reporting zero movement does not (a
frozen `clientX` must never be read as a delta); the release hands the cursor back; and a lock dropped mid-drag
(Escape) ends the orbit and frees the window listeners. The probe fakes the lock — the harness has no user
gesture and a real lock would capture the cursor — which is exactly the right scope: what is asserted is the
widget's behaviour, not Chromium's.

### 24.5 A face that is already expressing something does not blink

`同时修一个小问题，当模型脸上有表情的时候，暂停眨眼。`

Small, but it is the kind of thing that reads as a glitch rather than as detail: in a VRM the blink and the
expression shapes drive the **same eyelid morphs** — `expressionTargets` writes the clip's face or the emotion
into them — so a blink during a smile is not seen as a blink, it is seen as the expression dropping for a tenth
of a second and coming back.

`advanceExpressions` now computes one boolean before the blink section:

```
faceIsExpressing = currentFace() || (emotion && emotionWeight > 0)
```

and only the **START** of a blink is gated on it. Three deliberate choices:

* a blink that is already running **finishes** — cutting it mid-way would snap the eyes open, which is worse
  than the blink;
* the schedule is **not** reset, so a blink that came due while the face was busy happens on the first frame
  the face is clear again, and the rhythm carries on rather than restarting;
* both face sources count: a clip whose per-state expression/mouth is playing (or is being previewed), and an
  emotion that is on. `blinkState()` reports `paused`, so the readout says why nothing is blinking instead of
  leaving it to be inferred.

Asserted in the client probe (inside the settings check, so the suite's count is unchanged): a mood (`wag`) is
triggered and held, the blink deadline is put in the past, thirty frames pass — **no blink at all**
(`heldPeak: 0`, `paused: true`) — and the moment the face is released the blink comes through
(`releasedPeak: 0.952`), which is what makes it a pause rather than a switch-off.

## 25. The gaze gets a per-clip switch and an idle rule (with the rule as a setting)

Two requests in one message (2026-10-09 late), plus a third line that arrived while they were being built:

```
给每个状态下每个动作加上鼠标凝视的开关，
对于鼠标凝视整体加一个规则，如果鼠标连续5秒没有移动，就停止鼠标凝视，直到下次鼠标开始移动。
这个5秒也要作为一个选项写到设置里面方便调试。
```

### 25.1 每个状态 × 每个动作 的凝视开关

A fourth control on the row that already carries 循环/单次, 表情 and 口型: a checkbox, unchecked meaning "this clip,
in this state, does not look at the cursor".

* **Stored as a REFUSAL**: `motionClips[state][id].gaze = false`, and `core.cleanMotionClips` DROPS a stored
  `gaze: true` rather than keeping it. That is what makes the switch safe to add to a profile that already
  exists — every clip nobody has touched follows the pointer exactly as before — and it is why checking the box
  clears the field instead of writing true.
* **Per STATE, like the other three**: the same clip can refuse the gaze in 休息态 and still follow it in 庆祝态,
  which is the whole point of putting the switch on this row.
* **The global switch stays the outer gate**: 其他 里的 看向光标 can still turn the gaze off for everything, and
  this can only narrow it, never widen it.
* Read through `core.motionGazeFor(preferences, state, motionId)` (new, and asserted in `verify.mjs`), and asked
  for once per frame by `Motion.gazeAllowed` via `Scene.clipGazeAllowed()` — which answers for the clip that is
  actually playing, in the state it is playing in, or for the previewed one while a preview is up.

**A latent bug fell out of this**: `Motion.prototype.attach(avatar, scene)` was being called with `this.scene`
from inside the Scene, where no such property exists — so the motion's back-reference had been `null` since it
was written, and nothing noticed because nothing had needed it. The per-clip switch is the first thing that
does. Fixed (`attach(avatar, this)`), and the motion test now reports `linkedToScene` so a null back-reference
cannot hide again.

### 25.2 静止 5 秒就停止凝视，动了就回来

`Motion.setGaze` stamps `gazeAt` with the scene's own clock every time the aim CHANGES, and `gazeAllowed`
compares `elapsed - gazeAt` against the setting. Three consequences worth stating:

* nothing needed to change in the two surfaces that aim the pet (the app widget and the floating window), and a
  launcher replaying a cursor stream gets the same rule for free, because the stamp lives where the aim arrives;
* the clock is the MOTION's (`elapsed`, advanced by `Motion.tick` and clamped to 100 ms a frame), so a suite
  steps it and nothing depends on wall time. That clamp is worth remembering: the first version of the test asked
  for one six-second tick and measured a tenth of a second;
* any new movement restamps and the gaze returns on the very next frame — "直到下次鼠标开始移动".

### 25.3 那个 5 秒是一个设置

`preferences.gazeIdleSeconds`, default 5, clamped by `core.cleanPreferences` to `0 .. core.GAZE_LIMITS.idleSecondsMax`
(600). **0 is a value, not a missing one**: it turns the rule off, which is what to set while watching whether the
gaze itself is right — and an unparseable value falls back to 5 rather than to "off", so a corrupted profile
cannot quietly disable the rule. The control is a number field in the 视线 section (静止停看 … 秒) with a 复位
button, and the field is read with the same `write()` path as the curve and the spans, so it persists and syncs
like every other preference.

`Motion.appliedGaze` was added for this: the readout (and the tests) can now ask what the renderer APPLIED rather
than what the launcher asked for, which is the difference a refusal makes.

### 25.4 What asserts it

* `verify.mjs` (483 checks, +12): the switch is stored as a refusal and dropped when it says true; the refusal is
  per state; clearing it leaves the other fields alone; and the idle setting's four edges — default, 0, negative,
  clamped, unparseable.
* `verify-motion.mjs` (50 checks, +3): a two-second rule idles the gaze after ~2 s of frames, the next movement
  brings it back, 0 never idles, the preference reaches the motion, a clip refuses in one state and not in
  another, and the scene link the refusal travels through is asserted (`linkedToScene`).
* `verify-desktop.mjs` (130 checks, +1): a real settings window renders one 凝视 switch per ticked clip.

## 26. The idle rule in the field, and the built-in avatar comes out

Both from one message (2026-10-10): `超时暂停全局光标凝视功能未生效。另外移除内置替身，默认模型设置为SampleModel。`

### 26.1 Why the rule "未生效" — a cursor STREAM is not movement

The rule was correct and the test passed, which is exactly why the failure is worth writing down: **the suite
only ever set the aim when it meant to move it, and the floating window sets it every frame.**

`lib/desktop-page.js` computes the aim in `applyGaze()` from the launcher's cursor and calls
`scene.motion.setGaze(...)` on EVERY FRAME — a stream. `setGaze` stamped `gazeAt` on every call, so the five
seconds restarted sixty times a second and could never elapse. The in-app pet was fine (it aims on
`pointermove`), which is also why this only showed up on the floating pet.

Two fixes, either of which would have been enough, and both are asserted:

* **only a CHANGE of aim counts as movement.** `setGaze` compares with the previous aim and restamps only when
  it differs by more than `GAZE_MOVE_EPSILON` (0.002 rad, about 0.11° — far below one pixel at any real span,
  far above jitter). A stream repeating the same position no longer holds the gaze open, and a real move still
  resumes it on the next frame;
* **a missing setting can no longer mean "off".** `Motion.setGazeIdle` falls back to `core.GAZE_LIMITS.idleSeconds`
  (5) when the value is absent or unparseable, instead of to 0. The two halves of this plugin deploy separately,
  and a running host that does not know `gazeIdleSeconds` yet strips it — so before any restart the field simply
  was not there, and the old fallback turned the whole rule off. `0` still turns it off, because 0 is a value.

The regression test is the case that failed: `streamFrames(3, sameAim)` with a two-second rule must idle
(`idledUnderStream`), then a changed aim must bring it back (`backUnderStream`). The published page state also
grew `gaze.applied`, `gaze.idleSeconds`, `gaze.idleFor` and `gaze.holdGaze`, so the 视线 readout can say WHY the
head is not following instead of leaving it to be inferred — the aim and what the renderer applied are different
things, and that difference was invisible.

### 26.2 移除内置替身，默认模型是 SampleModel

* `core.DEFAULTS.modelId` is now **empty**, meaning AUTOMATIC. `core.resolveModelId(models, requested)` answers
  the question in one place: the requested id if it is still in the catalog, else the model named
  **`SampleModel.vrm`**, else the first VRM, else the first model of any kind, else `''`.
* The NAME does the choosing, not the id, because ids are positions in a scan — the drift that once made a saved
  pet change model by itself. A stored id that has gone stale now falls back to SampleModel instead of to
  nothing.
* A stored `'placeholder'` (the old default) is read as empty, so existing profiles migrate rather than pointing
  at an avatar that no longer exists.
* `core.modelChoices(models)` is the list the surfaces offer, with any `'placeholder'` entry filtered out; the
  panel's picker and the load path both go through `currentModelId()`, so the picker, the settings window's POST,
  the live report and the load cannot disagree.
* **Nothing is substituted when there is no model**: an empty catalog offers an empty list, the load is skipped,
  and the status line says so. A fake pet dressed as a model was the thing being removed.

**What is NOT done yet, stated plainly**: `lib/placeholder.js` (504 lines) and the `kind: 'placeholder'` path in
`lib/pet3d.js` are still in the tree. They are now unreachable from the product — no list entry, no default, no
fallback — but the module and its code path remain, and so do the suites that exercise it directly (the client
probe mounts it deliberately, `verify-browser.mjs` loads it as a chunk). Deleting them is a follow-up that has to
rewire `scripts/client-chunks.mjs`, the delivery chunk list, and four suites; doing it half-way would leave the
tree broken, so it is queued rather than rushed. Reported here so nobody has to rediscover it.

Asserted: `verify.mjs` (490 checks, +7) covers the resolver's whole ladder — SampleModel by name, stale id, valid
id, no VRM, empty catalog — plus the migration and `modelChoices`; `check-docs.mjs` now asserts the empty default
and the ABSENCE of `modelId: 'placeholder'` in core, which is the same promise as before (the plugin is never
shipped pointing at a licensed file) kept a different way; and the client probe asserts an empty catalog lists
nothing while a real one lists exactly its own entries.

## 27. The one-second buffer: the gaze ramps instead of snapping

`凝视暂停和重新开始要让人物在1秒缓冲时间内均匀转头回归或者凝视鼠标，不然动画看上去很诡异。`

Correct, and it was the last rough edge of §26: the idle rule worked, the gaze switched off, and the head went
from 80° to straight ahead **in one frame**. Coming back was the same snap in reverse.

**The mechanism is one scalar.** `Motion.gazeBlend` runs 0→1 while the gaze is allowed and 1→0 while it is
refused, walking at a constant `step / GAZE_LIMITS.blendSeconds` per frame — "均匀" is a uniform speed, so the
step is linear rather than eased — and the applied yaw/pitch are simply **multiplied by it**. Every refusal path
therefore ramps for free, because they all end in the same `gaze = null`: the idle rule, a preview
(`holdGaze`), the per-clip 凝视 switch, the global 看向光标 switch, and a cleared aim.

Three details that were not optional:

* **the last aim is kept separately** (`gazeLastAim`). By the time the ramp has to run the live aim is often
  already null — a cleared cursor, a switched-off gaze — and without a remembered direction there would be
  nothing to ease *out* along;
* **`dt` is passed in** (`tick` hands `applyGaze` the same clamped step it used for the frame), so the ramp is
  frame-rate independent and a suite can step it exactly;
* **both fields are initialised in the constructor**, and a non-finite blend recovers to the target. `undefined`
  in that arithmetic is NaN, and a NaN blend turns the gaze off silently and for ever — the same shape as the
  idle-rule bug that had just taken three reports to find.

`blendSeconds` is a number in `core.GAZE_LIMITS` (1 by default) rather than a literal in the renderer, so a
suite can set it to **0** and get the old snap when it wants to measure the mechanism without the ramp. The
published page state gained `gaze.blend`, so the floating window's readout can show which part of the ramp the
head is on.

**Asserted** in `verify-motion.mjs` (56 checks, +4), driven through the preview's `holdGaze` so the moment of
refusal is exact:

```
gazeBlend: { settled: 1, atRefusal: 0.9, outStep1: 0.1, outStep2: 0.1, inStep1: 0.1, back: 1,
             snapToZero: true, snapToOne: true }
```

settled at 1, still at **0.9 one frame after the refusal** (not 0 — that is the snap being gone), then 0.8, 0.7
— the same tenth per 0.1 s frame on the way out and on the way back, back to full gaze about a second after the
cursor moves, and an instant snap when the blend is set to 0.

Three existing measurements had to be told which side of the ramp they mean, and that is the honest kind of test
churn: the client probe's layering-budget check wants the SETTLED gaze (it is about the 70° budget, not the
ramp) and drives `gazeBlend = 1`; its `gazeEffect` helper, which measures the gaze algorithm's axes and limits,
forces 0 for the rest pose and 1 for the turn; and the motion suite's own rest-pose check now gives the head its
second to ease back before measuring drift. One test also had to stop re-setting the same aim and expecting a
fresh stamp — a repeated aim is deliberately not movement (§26.1), which is the rule working as designed.

## 28. The cursor's draught: sweeping across the pet swings its spring bones

`增加鼠标在模型上划过时，可以随着鼠标划过的方向摆动弹簧骨结构的功能。`

The chains are already there and already simulated; they simply had no reason to move while the pet stood
still. The question was how to push them, and the answer is the only force three-vrm's solver takes from
outside: **gravity**.

### 28.1 The mechanism: steer the gravity, then give it back

For each joint the effective gravity is `gravityDir * gravityPower`, and the draught is applied as a vector sum:

```
gravity = own gravity + wind * windPower        (then normalised, with |…| as the new power)
```

`Scene.pushWind` takes a raw pointer sample and stores the direction and strength; `Scene.advanceWind` runs
every frame **before** `motion.tick` (which is what steps the solver) and decays the strength exponentially
with `WIND_LIMITS.decaySeconds` as its time constant. So the hair is pushed while the cursor travels and then
keeps swinging on the spring's own energy — which is the difference between wind and an animation.

**The snapshot is load-bearing.** `captureSpringBase` records every joint's own direction and power, and when
the strength reaches zero `advanceWind` writes them back **exactly**. Without that, one sweep would leave the
hair permanently blown sideways and the model's own gravity silently rewritten — a bug nobody would see until
the hair stopped hanging straight. It is captured where the chains come into existence (on avatar install) as
well as at the end of `applyPreferences`, because preferences are applied *before* a model is loaded: the first
version captured nothing on a fresh pet (`windState().joints === 0` on a model with two chains).

### 28.2 What counts as a sweep

`core.windFromPointer` is the whole mapping, a pure function so it can be pinned without a model:

* **speed, not position** — the input is a delta over a time, the output a unit direction and a 0..1 strength
  (`speedForMax`, 1600 px/s). A cursor resting on the model blows nothing, which is what keeps the hair from
  standing permanently blown. Samples older than 200 ms are ignored, so a cursor that jumped after a gap is not
  read as a gale;
* **the view, not the world** — a sweep to the right must blow the hair to the right *on screen* even after the
  camera has been orbited, so the vector is turned back through `viewYaw`; that is also where the z component
  comes from rather than being invented;
* **screen-down is model-down** (three's up is +y), which is the axis a user will actually predict.

Both surfaces feed it: the floating window in its cursor callback — where `over` is already the scene's own hit
test against painted pixels, so it is "across the MODEL" — and the in-app pet on `pointermove`, gated on the
pet's own box and on no button being held (a DRAG already has its own effect on the hair through
`setDragMotion`, and the two should not be added together).

### 28.3 What asserts it

* `verify.mjs` (501 checks, +10): the mapping's whole shape — right sweep is +x, down sweep is -y, a 90° orbit
  turns it into +z, a resting cursor and a zero-duration sample blow nothing, and an absurd swipe is clamped.
  (`-0 ≠ 0` under `Object.is` caught the vertical component, which is why the function normalises it.)
* `verify-motion.mjs` (59 checks, +3) on the fixture's real hair and tail chains:
  `wind: { joints: 3, power: 1.6, leanedRight: true, pulledPower: 1.1197, basePower: 0.02, after: 0, restored: true }`
  — three joints steered sideways, the force they are pulled by going from the authored 0.02 to **1.12**, the
  draught dying to exactly 0, and every joint's own gravity back **byte for byte**.
* And the floating window publishes `wind` in its page state, so "sweeping does nothing" can be told apart from
  "the sweep never reached the chains".

## 29. The draught, tuned: 80% weaker and LOCAL

`强度太大了，降低80%，想要局部风而不是全局风。`

### 29.1 The strength: 1.6 → 0.32

`WIND_LIMITS.power` is a fraction of the chains' own gravity, and 1.6 of it was a gale. It is now **0.32** —
exactly a fifth, which is what "降低80%" means. Asserted as a number AND as the arithmetic, so a later edit
cannot quietly drift it back:

```
eq(core.WIND_LIMITS.power, 0.32, 'the draught is a fifth of what it was: 1.6 cut by 80%');
eq(core.WIND_LIMITS.power, Math.round(1.6 * 0.2 * 100) / 100, 'which is exactly 20% of the earlier strength');
```

### 29.2 Local, not global

The force now falls off with the distance between each joint and the cursor:

* both surfaces send **where the cursor is**, in canvas pixels — the in-app pet converts from its own box, the
  floating window the same way `paintedAt` does it, because the draught and the joints have to be measured in one
  space;
* `Scene.springJointScreenPositions()` projects every joint to that space (`projectToCanvas`), and
  `core.windFalloff(distance, radius)` turns each distance into a share of the force — a smoothstep, so the hair
  nearest the edge of the patch eases in rather than snapping, and exactly **0** beyond the reach;
* the reach is `WIND_LIMITS.radiusFraction` (**0.45**) of the model's own **on-screen height**, measured by
  projecting the model's top and bottom every frame. So the patch is the same size relative to the pet at any
  zoom, and a tall model gets a tall patch — rather than a pixel count that would mean something different on
  every screen;
* a joint beyond the reach is handed **its own gravity back exactly**, not blown a little: local means local.

`windState()` now reports `radius` (the reach in pixels) and `at` (where it was aimed), because "was that
local?" is not answerable without them.

### 29.3 What asserts it

* `verify.mjs` (510 checks, +9): the strength and its arithmetic; `windFalloff` at 0, at the edge, beyond it, and
  halfway (strictly decreasing, and a zero reach is a zero rather than a division).
* `verify-motion.mjs` (61 checks, +2), on the fixture's real chains:
  `wind: { joints: 3, power: 0.224, apartPx: 4, follow: true, awayNear: 0, awayFar: 0, awayReachPx: 46.7, after: 0, restored: true }`
  — **`follow: true`** is the locality: aimed at joint A, A takes the larger share; aimed at B, the two SWAP,
  which a global wind could never do. **`awayNear/awayFar: 0`** is the boundary: aimed 300 px off the pet, no
  joint is touched at all.
* Two honest test-side notes. This fixture's joints project only **4 px apart** and shift a few px as the pet
  breathes, so no reach can separate them while still containing the joint under the cursor — hence the gradient
  is proved by ORDER and the cutoff by aiming off the pet entirely. And the first version of that cutoff test
  derived its reach from `windState().radius` read while the draught was **inactive** (0), fell back to the full
  fraction, and "proved" a 46.7 px reach across a 4 px gap: it passed the wrong assertion for the wrong reason
  until the reach was read live.

## 30. The draught as settings, a folding spring list, and the built-in avatar finally gone

Three requests in one message (2026-10-10): `把鼠标互动的参数加入设置面板，然后设置面板中，如果弹簧骨选项超过5个，
就折叠起来，用户可以主动展开。另外，内置的占位模型还是没删掉，把Sample Model设为内置模型。`

### 30.1 鼠标互动的参数 in the settings window

The four draught numbers are preferences now — `windPower` (0.32), `windRadius` (0.45), `windDecay` (0.28),
`windSpeedForMax` (1600) — cleaned through `core.WIND_RANGES`, rendered in a new **鼠标互动** section, and read by
the scene from the preferences rather than from `WIND_LIMITS` (which stays as the fallback a profile that predates
them uses). `windPower: 0` is a legitimate value: it turns the draught off without disturbing the other three, and
`windRadius: 0` turns it global again so the two shapes can be compared by feel.

The section's own state is published (`wind.rows`, and each number), so the live-window check asserts both that
the controls rendered and that they show the tuned values rather than the HTML's defaults.

### 30.2 弹簧骨超过 5 个就折叠

`renderSprings` wraps the rows in a `<details>` — shut, with a summary reading 展开全部 N 条弹簧骨链 — as soon as
there are more than five, and leaves five or fewer flat. A real model has ten to twenty-two chains (SampleModel.vrm
eighteen, 蓝色小肥鱼 twenty-two) and each row is a label plus three sliders and a button, so expanded they bury
every other section. A native `<details>` rather than a hand-rolled toggle: keyboard accessible for free.

Asserted in a real window, both halves: the two-chain fixture comes up with **no** group, and a stub that answers
with nine chains (`?chains=9`) comes up with the group **shut** and all nine control blocks inside it.

### 30.3 内置替身 removed; SampleModel is the built-in model

This is the third time this was asked ("还是没删掉"), so this round removed the *reachability* rather than the
listing — three separate places, because any one of them left a way to show it:

* **delivery**: `scripts/client-chunks.mjs` no longer generates the placeholder chunk (the file itself is now
  deleted), `lib/client.js` no longer loads it, and the host's `DESKTOP_SOURCES` whitelist no longer serves
  `placeholder.js` to any page — a whitelist is only worth having if it also says no, and verify-model now
  asserts a 404;
* **fallbacks**: `Scene.loadModel` no longer substitutes anything. A bad model file reports the error and leaves
  the stage as it was; an EMPTY id means "no model chosen" and installs nothing. The old behaviour reported
  `ok: true` for a pet that was not the model anyone chose, and hid parse failures behind a fake pet.
* **the window's page**: its model cycle is the catalog and nothing else, its button says （无模型）rather than
  naming a stand-in, and every load goes through `core.resolveModelId`.

**What "built-in model is SampleModel" means here, precisely**: the shipped default names no model
(`DEFAULTS.modelId = ''` = automatic) and the resolver picks `SampleModel.vrm` **by name**, then the first VRM,
then the first catalogued model. It is not a copy of the file bundled in the repo — `assets/models/` must ship no
model files (asserted in check-docs) — and with nothing catalogued the pet shows nothing and says so. If they want
the 26 MB VRM *shipped* inside the plugin instead, that is a separate decision to make deliberately.

`lib/placeholder.js` **stays in the tree**, and the reason is worth stating: it is the only model-free avatar the
geometry suites have. The browser suite inlines it directly to test framing, the gaze algorithm and the render
loop, and the client probe uses `Scene.usePlaceholder()` for the same purpose. Deleting it would delete those
checks. It is unreachable from the product (nothing defines `globalThis.__PET3D_PLACEHOLDER__` in a shipped
plugin), and `usePlaceholder`'s comment says exactly that so nobody has to rediscover it.

**Two consequences that only showed up in the live suites**, both worth remembering:

* the floating window's page used to resolve its model through an empty catalog and paint **nothing** — an empty
  catalog means "not known yet", so `core.resolveModelId` now honours the requested id and only a catalog WITH
  entries can decide that an id is gone;
* the launcher's wheel self-check aimed at a fixed 30 % / 70 % of the pet's box, which the procedural avatar
  painted and a humanoid VRM does not — so `wheelZoomOk` went false with every number correct, because the window
  (by design) ignores a wheel that is not over painted pixels. It now asks the page for a painted point.

Totals after the removal: core 520, host+model **337** (two served-source checks became one refusal check),
chunk-delivery **37** (a chunk fewer), desktop **139**, client 70 — **1131** in all, ten suites green.

## 31. SampleModel is now shipped, and it is the built-in default

The operator's answer to §30.3's caveat (2026-10-10):

> 为什么可以把SampleModel做成出厂自带的默认模型，是因为这个模型是VRoid的模型，可再配布、可改、可商用（个人和法人都行）、
> 免署名，同时拥有标准的VRM的身体结构和弹簧链。请务必做成默认模型并随插件分发。彻底改掉最早那个断言。

They were right, and the file says so itself. What was a licensing JUDGEMENT became a licensing FACT read out of the
model:

```
redistribution=allow  modification=allow  corporate_commercial_use=allow  credit=unnecessary
personal_commercial_use=profit  allowed_to_use_user=everyone
```

(VRoid Hub licence query string in `extensions.VRM.meta.otherLicenseUrl`; author `VRoidプロジェクト`, title `ヴィータ`,
15 expressions, 18 spring chains, 14 159 872 bytes.) It is committed at `assets/models/SampleModel.vrm`.

**Almost nothing had to be built to make it the default**, because `buildCatalog` has always scanned
`assets/models` FIRST as a `bundled` root — so the file appears in every catalog with `source: 'bundled'`, the asset
route resolves its id through the same map, and `core.resolveModelId` already prefers the entry NAMED
`SampleModel.vrm`. Dropping the bytes in was the feature; the rest of this round is the consequences.

**The assertion is inverted, not deleted.** `check-docs` used to require `assets/models/` to be empty ("most VRM
models forbid redistribution, and committing one would make this repository undistributable"). It now requires
exactly one file there, that it is a real binary glTF, and that its embedded licence still says
redistribution/modification/commercial are allowed and credit is unnecessary — so a future swap for a model that
does NOT say that fails here instead of shipping. `assets/models/README.md` carries the same table for a human.

**End to end, not merely committed**: `verify-model` fetches the bundled model over the real asset route and checks
the bytes (glTF magic, full length, licence string intact), which is the difference between "the file is in the
repository" and "a page can load it with no user configuration".

**And the ids moved, exactly as this codebase keeps warning.** The built-in is scanned first, so it takes `m1` and
every fixture shifts by one: five catalog assertions in `verify-model` counted models and had to become
name-based, source-aware, or `+1`. The requirement in `resolveModelId` that the default is chosen BY NAME rather
than by id is what keeps that drift from mattering to a user.

Totals: core 520, host+model **345**, chunk-delivery 37, browser 13, client 70, mmd 13, desktop 139, plus the two
verdict suites — **1139** across ten suites, with `check-docs` at 164.

## 32. "为什么会有一个全空的占位模型?"

Because removing the avatar left a MODEL PICKER entry behind that pointed at it.

`lib/config-page.js` built the settings window's model list like this:

```js
var choices = [{ id: 'placeholder', name: '占位模型（内置）' }].concat(catalog);
```

That entry was the only way to select the procedural avatar, and while the avatar existed it was a real choice.
Once it was removed (§30.3) the entry stayed — and it selected a model that **draws nothing**, so the dropdown
offered an empty pet. Nothing in the page state reported the list, so the only way to see it was to look at it.

Fixed, in the three places that still treated `placeholder` as a model:

* the synthetic option is gone; the picker is the catalog, and it skips any `placeholder` entry a stale host might
  still send;
* `modelIdInUse()` returns EMPTY for "no model chosen" rather than the string `'placeholder'`, and
  `loadModelInfo` treats empty as "nothing to describe";
* `chooseEditingModel` still refuses to adopt `'placeholder'` from a surface's live report — which matters right
  now, because the running client half predates the removal and STILL reports `'placeholder'` as its model. It
  resolves from the catalog instead, and does so again after the catalog arrives. Measured on a fresh profile
  before that fix: `supported=false, expressions=0, springs=0` — the page was describing a phantom while the
  picker showed its first real option.

The pill's "no model" state reads 没有模型 with an explanation instead of describing the built-in avatar's limits,
and the avatar-kind fallback in `lib/client.js` says `unknown` rather than `placeholder`.

**And the picker is now asserted, not just fixed**: the settings page publishes `modelOptions`, and the live-window
check requires it to be exactly the catalog and to contain no `placeholder` entry — the regression test for the
thing the operator had to spot by eye.

Totals: core 520, host+model 345, chunk-delivery 37, browser 13, client 70, mmd 13, desktop **141**, plus the two
verdict suites — **1141** across ten suites, with `check-docs` at 165.


















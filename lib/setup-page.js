/**
 * The first-run guide's script: the screens and a finish, over `/vrmpet3d-dev/setup`.
 *
 * WHY IT EXISTS. Operator, 2026-10-12: 「增加一个初次安装引导界面，安装成功后，彻底配置完之前，每次插件运行都会弹配置引导」.
 * So the page has one job beyond showing text: it must be FINISHABLE. `完成` is the only thing that writes
 * `completed` (over `POST /vrmpet3d-dev/setup-state`), which is what stops the host offering the guide on the next
 * activation; closing the window early deliberately does not, because that is the requested behaviour.
 *
 * WHAT IT WRITES, and when. Every preference edit goes through the same host store the settings pages use
 * (`core.watchHostSettings` → `POST /vrmpet3d-dev/settings`), and NOTHING is written before the first snapshot has
 * arrived — the data-loss latch the settings pages learned the hard way (`hasSnapshot` in `lib/config-page.js`): a
 * page that boots into defaults and then writes replaces everything the user configured.
 *
 * The two import sections both hand the work to the host and let it write its own stores — the model step through
 * the shared picker (`lib/model-picker.js`: `addFile` for a path from the launcher's dialog, or the file's bytes
 * when the page has no launcher) and the action step as a PATH (`importDir`). A web page cannot open a dialog (the
 * launcher's `pickModelFile` / `pickMotionDir` bridge does) and must not write the host's files itself — which is
 * also what keeps `VRMPET3D_DEV_*_FILE` in force for the suites.
 */
(function () {
  'use strict';

  var core = globalThis.__VRMPET3D_DEV_CORE__;
  if (!core) return;

  /**
   * This page's own words, in the two languages — the shape every surface here uses (`lib/menu.js`'s `LABELS`,
   * `lib/model-picker.js`'s `TEXT`): `{ zh: {...}, en: {...} }`, one table per surface rather than one dictionary
   * for the whole plugin, and the SAME KEYS in both halves (a suite asserts that).
   *
   * The markup carries its Chinese inline as the no-JS fallback and names the key that replaces it
   * (`core.applyI18n`); the entries below are what this script writes at run time, read through `t()` at CALL time
   * and never captured in a module-level variable — a captured string would freeze the first language the page
   * happened to boot in. `{...}` tokens are filled from `t`'s second argument, which is also how the core's own
   * status lines name their clock.
   *
   * What is NOT here: data (provider, model and file names, folder paths, counts — they are translated around,
   * never translated), and the 碎碎念 content, which belongs to `core.js` and already ships in both languages.
   */
  var TEXT = {
    zh: {
      // The chrome, and the stepper the script reads its own words back from.
      pageTitle: 'vrmpet3d-dev · 初次安装引导',
      guideTitle: '初次安装引导',
      guideDoneTitle: '配置完成',
      reading: '正在读取…',
      stepsAria: '引导进度',
      stepWelcome: '欢迎',
      stepModel: '偏好模型',
      stepSurface: '桌宠界面',
      stepSpeech: 'AI 碎碎念',
      stepMotions: '模型动作',
      stepDone: '完成',
      // 界面语言 — the one control the welcome screen adds, and the only choice applied before 完成.
      language: '界面语言',
      languageAuto: '自动',
      languageZh: '中文',
      languageEn: 'English',
      // ① 欢迎
      welcomeTitle: '欢迎，也先说清楚风险',
      welcomeRisk: '这是一个<strong>早期版本</strong>的插件，作者也是第一次开发 DSH 插件。它<strong>还没有经过系统性的验证</strong>，可能存在 bug，也可能带来性能下降；设置页面的排版也可能比较混乱。',
      welcomeWarning: '如果你在使用中遇到任何性能问题，请<strong>第一时间禁用这个插件</strong>，再慢慢排查。',
      // ③ 桌宠界面, including the runtime folder the launcher is about to create.
      surfaceTitle: '桌宠出现在哪里',
      surfaceAuto: '自动',
      surfaceAutoNote: 'Desktop端自动开启独立桌宠',
      surfaceApp: '只在内置桌宠',
      runtimeBorrow: '<strong>浮窗会借用一份 DSH 自带的运行时。</strong>独立浮窗需要无边框、置顶、点击穿透的系统窗口，这只有 Electron 能给，而插件不自带（那会多出两百多兆）。所以启用浮窗时，启动器会在 <strong>DSH 安装目录所在的分区</strong>里建一个运行时目录，用 <strong>硬链接</strong>指向 DSH 自己的那批客户端文件 —— 于是它看起来就是一份没改动过的 DSH。',
      runtimeLinks: '<strong>硬链接与 DSH 共享同一份数据，不额外占盘</strong>（新增的只有一个小 app 壳），并且它<strong>必须与 DSH 同盘</strong>：硬链接不能跨卷。删掉这个目录是安全的，下次启用浮窗会重新建一份。',
      runtimeDir: '这次用的运行时目录：{dir}',
      // ④ AI 碎碎念
      speechTitle: 'AI 碎碎念',
      speechEnabled: '开启碎碎念',
      speechBuiltin: '内置台词',
      speechBuiltinNote: '内置台词基本已经够用',
      speechAi: 'AI 生成',
      speechProvider: 'AI 来源',
      speechAiNote: '人格信息和不同状态的提示词，都在 通用设置 → 碎碎念 里设置。',
      speechDisclaimerA: '<strong>碎碎念只是玩笑，请勿当真。</strong>这些话要么来自内置台词，要么由你配置的模型即兴生成，都属于角色扮演：不是宠物的真实判断，也不构成任何建议。',
      speechDisclaimerB: '插件<strong>不会对你的项目或文件做任何实际操作</strong>（不执行命令、不改动代码），只读取会话的<strong>运行状态</strong>（进行中 / 等待确认 / 完成 等）来决定表情和动作，会话文字、工具参数与附件都不会被它读取；你导入的模型或动作，只会被复制到插件自己的目录里。<strong>它也不会干扰 DSH 本身的运行</strong>，且不带任何运行时依赖。不过在配置较差的机器上，3D 渲染与弹簧骨物理可能带来轻微的性能影响 —— 关掉桌宠，或把尺寸调小一些，就能缓解。',
      noProviders: '没有可用的 provider。',
      // ⑤ 模型动作
      motionsTitle: '模型动作',
      motionsPick: '选择动作文件夹…',
      motionsManual: '手动输入路径',
      motionsPath: '文件夹路径',
      motionsAdd: '导入',
      motionsImportedCount: '已导入 {count} 个动作文件夹',
      motionsImportedRow: '已导入',
      motionsClips: '{name}（{clips} 支）',
      motionsRemove: '移除',
      motionDefaultsKnown: '各状态的默认动作：{list}。这些默认值可以在通用设置 → 状态与动作里改。',
      motionDefaultsNone: '动作包已按工作状态分好目录（{count} 支）：每个状态的选择框里只会列出它自己目录里的动作。当前这版还没有预置状态→动作的默认映射，所以你需要在通用设置 → 状态与动作里为状态勾选动作。',
      motionImporting: '正在导入动作…',
      motionImportedName: '已导入动作文件夹：{name}（{clips} 支）',
      motionImported: '已导入动作。',
      motionImportFailed: '导入失败：{error}',
      motionRemoved: '已移除插件复制的那一份。',
      motionRemoveFailed: '移除失败：{error}',
      // The list separators `motionDefaultsKnown` is assembled with — prose punctuation, so it travels with the words.
      sepList: '、',
      sepClause: '；',
      // 完成, and the footer.
      doneTitle: '完成',
      doneSaved: '配置已保存。',
      finishButton: '完成',
      closeWindow: '关闭窗口',
      later: '稍后配置',
      back: '上一步',
      next: '下一步',
      // Status lines this script writes (the picker's own status is the component's, not this table's).
      hostNoStore: '这个宿主没有提供设置接口，改动只在本页生效。',
      coreNoStore: '这个版本的 core 没有设置接口，页面只能展示默认值。',
      pickerMissing: '这个页面没有加载模型选择组件（model-picker.js）。',
      noNativePicker: '这个窗口没有原生选择器（不是在 DSH 桌面版里打开的），请在下面直接输入路径。',
      readSettings: '已读取当前设置。',
      savedNoGuide: '已保存：这个引导不会再出现了。',
      setupComplete: '配置完成。',
      saveFailed: '保存失败：{error}',
      skipped: '已跳过：下次插件启动时会再提醒你一次。',
    },
    en: {
      pageTitle: 'vrmpet3d-dev · First-run guide',
      guideTitle: 'First-run guide',
      guideDoneTitle: 'Setup complete',
      reading: 'Reading…',
      stepsAria: 'Guide progress',
      stepWelcome: 'Welcome',
      stepModel: 'Preferred model',
      stepSurface: 'Pet surface',
      stepSpeech: 'AI chit-chat',
      stepMotions: 'Model motions',
      stepDone: 'Done',
      language: 'Interface language',
      languageAuto: 'Auto',
      languageZh: '中文',
      languageEn: 'English',
      welcomeTitle: 'Welcome — and the risks first',
      welcomeRisk: 'This is an <strong>early build</strong> of the plugin, and its author is writing a DSH plugin for the first time. It has <strong>not been through systematic testing</strong> yet: it may have bugs and may cost you performance, and the settings pages may be laid out awkwardly.',
      welcomeWarning: 'If you run into any performance problem while using it, <strong>disable the plugin first</strong> and then work out what happened.',
      surfaceTitle: 'Where the pet appears',
      surfaceAuto: 'Automatic',
      surfaceAutoNote: 'On DSH Desktop the floating pet opens by itself',
      surfaceApp: 'In-app pet only',
      runtimeBorrow: '<strong>The floating pet borrows a runtime that ships with DSH.</strong> An independent floating window needs a borderless, always-on-top, click-through system window, and only Electron can provide one — which this plugin does not ship (that would add a couple of hundred megabytes). So when the floating pet is enabled, the launcher creates a runtime folder <strong>on the same volume as the DSH install</strong> and <strong>hard-links</strong> it to DSH\'s own client files, which is why it looks like an untouched copy of DSH.',
      runtimeLinks: '<strong>Hard links share DSH\'s own data and take no extra disk space</strong> (the only new thing is a small app shell), and the folder <strong>has to be on the same volume as DSH</strong>: hard links cannot cross volumes. Deleting the folder is safe — the next time the floating pet is enabled, it is created again.',
      runtimeDir: 'Runtime folder in use: {dir}',
      speechTitle: 'AI chit-chat',
      speechEnabled: 'Turn chit-chat on',
      speechBuiltin: 'Built-in lines',
      speechBuiltinNote: 'The built-in lines are usually enough',
      speechAi: 'Generated by AI',
      speechProvider: 'AI source',
      speechAiNote: 'The persona and the per-state prompts live in General settings → Chit-chat.',
      speechDisclaimerA: '<strong>The chit-chat is a joke — do not take it seriously.</strong> The lines either come from the built-in script or are improvised by the model you configured; either way it is role-play, not the pet\'s real judgement, and not advice of any kind.',
      speechDisclaimerB: 'The plugin <strong>takes no real action on your project or files</strong> (it runs no commands and changes no code). It reads only the session\'s <strong>run state</strong> (working / waiting for confirmation / done, and so on) to choose expressions and motions — session text, tool arguments and attachments are never read, and the models or motions you import are only copied into the plugin\'s own folder. <strong>It does not interfere with DSH itself</strong> and has no runtime dependencies. On a weak machine, though, the 3D rendering and spring-bone physics can cost a little performance — turning the pet off or making it smaller eases that.',
      noProviders: 'No provider is available.',
      motionsTitle: 'Model motions',
      motionsPick: 'Choose a motions folder…',
      motionsManual: 'Type a path',
      motionsPath: 'Folder path',
      motionsAdd: 'Import',
      motionsImportedCount: '{count} motion folders imported',
      motionsImportedRow: 'Imported',
      motionsClips: '{name} ({clips} clips)',
      motionsRemove: 'Remove',
      motionDefaultsKnown: 'Default motions by state: {list}. They can be changed in General settings → States & motions.',
      motionDefaultsNone: 'The pack is already split into per-state folders ({count} clips): a state\'s picker only lists the clips in its own folder. This build ships no state→motion defaults yet, so you need to tick motions per state in General settings → States & motions.',
      motionImporting: 'Importing motions…',
      motionImportedName: 'Imported the motions folder {name} ({clips} clips)',
      motionImported: 'Motions imported.',
      motionImportFailed: 'Import failed: {error}',
      motionRemoved: 'Removed the plugin\'s own copy.',
      motionRemoveFailed: 'Could not remove it: {error}',
      sepList: ', ',
      sepClause: '; ',
      doneTitle: 'Done',
      doneSaved: 'Your settings are saved.',
      finishButton: 'Finish',
      closeWindow: 'Close window',
      later: 'Configure later',
      back: 'Back',
      next: 'Next',
      hostNoStore: 'This host offers no settings API — a change applies to this page only.',
      coreNoStore: 'This build of core offers no settings API; the page can only show the defaults.',
      pickerMissing: 'This page did not load the model picker (model-picker.js).',
      noNativePicker: 'This window has no native picker (it was not opened by DSH Desktop) — type the path below instead.',
      readSettings: 'Read the current settings.',
      savedNoGuide: 'Saved: this guide will not appear again.',
      setupComplete: 'Setup complete.',
      saveFailed: 'Could not save: {error}',
      skipped: 'Skipped: the guide will ask once more the next time the plugin starts.',
    },
  };

  /**
   * Every screen the markup carries — INCLUDING the ones this run may not visit.
   *
   * It is the list `goto` hides against, so a section that is not the current one is never left visible. Which of
   * them the flow actually walks is the stepper's own list (see `activeSteps`), not this one.
   */
  var SCREENS = ['setup-0', 'setup-1', 'setup-2', 'setup-3', 'setup-4', 'setup-5'];

  var current = 0;
  /** The first host snapshot is the permission to write. See the header. */
  var hasSnapshot = false;
  var preferences = core.cleanPreferences({});
  var hostSync = null;
  /**
   * The language this page is drawn in RIGHT NOW: the stored answer resolved against the page's own environment.
   *
   * It starts as the markup's own language and is replaced by `applyLanguage` before anything is drawn. Every string
   * is read through `t()` against this value, so a language change has no captured copy to go stale.
   */
  var language = 'zh';
  /**
   * A 界面语言 pick made BEFORE the first snapshot — the one case where "local first, write when allowed" is not
   * enough on its own.
   *
   * `patchPreferences` refuses to write before the snapshot (the data-loss latch, see the header), and this page's
   * language control sits on the FIRST screen: a reader who cannot read the page reaches it in the first second,
   * well before the store has answered. The pick is applied locally either way, and this remembers it so the first
   * snapshot can write it rather than putting the stored answer back over it.
   */
  var pendingLanguage = null;
  /** The imported lists, as the host reports them: what to show and what a 移除 acts on. */
  var importedModels = [];
  var importedMotions = [];
  /**
   * The last `/vrmpet3d-dev/motions` payload, kept so a language change can re-say the defaults line.
   *
   * That line is built from the pack's own data (`renderMotionDefaults`) and the route is fetched once at boot;
   * caching the payload is what makes it re-renderable without asking the host a second time. `null` until the
   * first reply, and `renderMotionDefaults` is skipped while it is — the line's "no data" branch would otherwise
   * claim an empty pack on every boot.
   */
  var motionBody = null;
  /** The shared model picker the ② 偏好模型 step mounts (`lib/model-picker.js`). */
  var picker = null;
  /** Which model a surface reports it is showing, from the snapshot's `live` — what ends the progress bar. */
  var liveModel = null;
  /** The DSH provider/model catalog, from `/vrmpet3d-dev/llm`. */
  var llm = null;

  function el(id) { return document.getElementById(id); }

  /** One of this page's own strings, in the language it is drawn in right now; `{name}` tokens are filled in. */
  function t(key, values) {
    var out = core.textOf(TEXT, language, key);
    if (!values) return out;
    Object.keys(values).forEach(function (name) {
      out = out.split('{' + name + '}').join(String(values[name]));
    });
    return out;
  }

  /**
   * The status line's own last state, so a LANGUAGE CHANGE can say it again in the new language.
   *
   * `core.applyI18n` walks the whole document, and without this it would put the shipped 「正在读取…」 back over a
   * line this page has since replaced ("已导入动作文件夹：…", "保存失败：…"). Every line this page writes comes from a
   * table KEY, which is what makes re-saying it possible; the shared picker's own status is the exception (those
   * words are the component's, and arrive in the component's language), so it passes through as raw text.
   */
  var statusLine = { key: 'reading', values: null, kind: '', text: '' };

  /** Say one of this page's own strings — and remember the key, so a language change says it again. */
  function say(key, values, kind) {
    statusLine = { key: key, values: values || null, kind: kind || '', text: '' };
    setStatus(t(key, values), kind);
  }

  /** Say a line whose words are NOT this table's (the shared picker's own status). */
  function noteStatus(text, kind) {
    statusLine = { key: '', values: null, kind: kind || '', text: text || '' };
    setStatus(text, kind);
  }

  /** The status line again, in the current language — what `applyLanguage` calls after the markup table. */
  function restateStatus() {
    setStatus(statusLine.key ? t(statusLine.key, statusLine.values) : statusLine.text, statusLine.kind);
  }

  function setStatus(text, kind) {
    var node = el('status');
    if (!node) return;
    node.setAttribute('data-ready', '1');
    node.textContent = text || '';
    node.className = kind === 'warn' ? 'warn' : '';
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function text(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (detail) {
          throw new Error(detail || ('HTTP ' + response.status));
        });
      }
      return response.json().catch(function () { return null; });
    });
  }

  function getJson(path) {
    return fetch(path, { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .catch(function () { return null; });
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Can an INDEPENDENT desktop pet exist in this session?
   *
   * The launcher bridge is the answer this page already trusts for its native file dialog (`bridge()` below): it is
   * injected by the window DSH Desktop opens, so a document without it is a plain browser tab — `dsh web`, where the
   * in-app pet is the ONLY surface there is (`petSurface: 'auto'` means "the floating window when there is one, the
   * in-app pet when there is not"). Nothing has to be asked of the host: being unable to spawn Electron is exactly
   * what a missing launcher means here, and ③ 桌宠界面 has no second choice to offer without it.
   */
  function hasDesktop() {
    var launcher = globalThis.vrmpet3dDevDesktop;
    return Boolean(launcher && typeof launcher === 'object'
      && typeof launcher.pickModelFile === 'function');
  }

  /**
   * The stepper's entries for a run, in order: the markup's own words, filtered by the markup's own attributes.
   *
   * `data-hidden` is a step the guide does not visit at all (⑤ 模型动作, operator 2026-10-13) and `data-desktop-only`
   * one that needs a surface only DSH Desktop has. The desktop question is a PARAMETER rather than a reading of the
   * live bridge, which is what lets a suite ask what dsh web's guide carries without booting the page a second time
   * (see `__VRMPET3D_DEV_SETUP_STEPS__`); the words themselves are the markup's, so there is one copy of them.
   */
  function stepsFor(desktop) {
    var box = el('setup-steps');
    if (!box) return [];
    return Array.prototype.filter.call(box.children, function (node) {
      if (node.getAttribute('data-hidden') === '1') return false;
      return desktop || node.getAttribute('data-desktop-only') !== '1';
    });
  }

  function activeSteps() { return stepsFor(hasDesktop()); }

  /** The last index of THIS run's flow — the finish, which is always one of them. */
  function lastIndex() { return Math.max(0, activeSteps().length - 1); }

  /**
   * One screen at a time, and a stepper that says where you are in THIS run's flow.
   *
   * The active entry is marked by its position IN THE ACTIVE LIST, not by its position among the markup's children:
   * a skipped step would otherwise shift every mark after it by one — the failure a numbered stepper hides and this
   * one cannot afford. There are no numbers to renumber either (operator, 2026-10-13: 「不要写数字和序号」).
   */
  function goto(index) {
    var list = activeSteps();
    var last = Math.max(0, list.length - 1);
    current = Math.max(0, Math.min(last, index));
    var active = list[current] ? list[current].getAttribute('data-screen') : null;
    SCREENS.forEach(function (id) {
      var screen = el(id);
      if (screen) screen.hidden = id !== active;
    });
    var steps = el('setup-steps');
    if (steps) {
      Array.prototype.forEach.call(steps.children, function (node) {
        var position = list.indexOf(node);
        node.hidden = position === -1;
        node.setAttribute('data-active', position === current ? '1' : '0');
        node.setAttribute('data-done', position > -1 && position < current ? '1' : '0');
      });
    }
    var back = el('setup-back');
    var next = el('setup-next');
    if (back) back.disabled = current === 0;
    // Both of these are re-stated from the table rather than written once: `goto` is what `applyLanguage` calls, so
    // this is the function that has to know the language as it is NOW.
    if (next) next.textContent = t(current === last ? 'finishButton' : 'next');
    var header = document.querySelector('.page-header h1');
    if (header) header.textContent = t(current === last ? 'guideDoneTitle' : 'guideTitle');
    // The finish screen's own button is the one that WRITES; the footer says the same thing for a user who
    // navigates by keyboard.
    if (next) next.hidden = false;
    var finish = el('setup-finish');
    if (finish) finish.hidden = current === last;
  }

  /**
   * Write a preference patch through the host store.
   *
   * Refused before the first snapshot (see the header), and the local copy is updated either way so the UI shows
   * what the user just chose even on a host that cannot be reached.
   */
  function patchPreferences(patch) {
    Object.keys(patch).forEach(function (key) { preferences[key] = patch[key]; });
    if (!hasSnapshot || !hostSync || typeof hostSync.push !== 'function') {
      if (!hostSync) say('hostNoStore', null, 'warn');
      return;
    }
    hostSync.push({ preferences: patch });
  }

  /** The whole speech object with changes applied — the store merges by KEY, so a nested write sends all of it. */
  function speechWith(changes) {
    var speech = JSON.parse(JSON.stringify(core.cleanSpeech(preferences.speech)));
    Object.keys(changes).forEach(function (key) {
      if (key === 'ai') return;
      speech[key] = changes[key];
    });
    if (changes.ai) {
      Object.keys(changes.ai).forEach(function (key) { speech.ai[key] = changes.ai[key]; });
    }
    return speech;
  }

  // ---------------------------------------------------------------------------
  // ② 偏好模型 — the shared picker (lib/model-picker.js), mounted here
  // ---------------------------------------------------------------------------

  /**
   * The ONE model picker, and the only place this page's step ② gets its markup.
   *
   * It is not written here because the operator asked for the guide's step and the 切换模型 page to be IDENTICAL
   * (「面板中和初次安装向导模型页完全一样」): both mount `createModelPicker`, so the big 选择/拖入 area, the
   * thumbnail grid and the click-to-switch behaviour have one definition. What this page owns is only the two
   * callbacks — where the status goes, and what a click writes.
   *
   * The import no longer has a typed-path row (「去掉手动输入路径框，这个框没有意义」): the component asks the
   * launcher for a native dialog when there is one, and uploads the dropped/selected file's bytes when there is
   * not, so the box had nothing left to do.
   */
  function mountModelPicker() {
    var mount = el('setup-model-picker');
    var api = globalThis.__VRMPET3D_DEV_MODEL_PICKER__;
    if (!mount || !api || typeof api.createModelPicker !== 'function') {
      say('pickerMissing', null, 'warn');
      return null;
    }
    picker = api.createModelPicker({
      mount: mount,
      // The component is BUILT in this language; `applyLanguage` hands it a later change through `setLanguage`
      // (which relabels the same nodes and keeps the catalog and any switch in flight).
      language: language,
      currentModelId: function () { return preferences.modelId || ''; },
      /**
       * Which model a pet reports it is SHOWING (`snapshot.live`), so the progress bar is about the LOAD rather
       * than about the write — the same wiring the 切换模型 page uses, because it is the same component.
       */
      liveModelId: function () { return liveModel; },
      // Choosing a model in a guide called 「偏好模型」 and then not choosing it would be a strange half-step:
      // the component calls this for a CLICK and after an import, and both mean "this is my model now".
      onSwitch: function (id) { patchPreferences({ modelId: id }); },
      // The component's own lines, in the component's own language (see `statusLine`).
      onStatus: noteStatus,
    });
    return picker;
  }

  /** The imported-model count, from the component's own account (the state probe and nothing else reads this). */
  function importedModelCount() {
    if (!picker || typeof picker.state !== 'function') return importedModels.length;
    var state = picker.state();
    return state && typeof state.imported === 'number' ? state.imported : importedModels.length;
  }

  function refreshModels() {
    if (!picker) return Promise.resolve(null);
    return picker.refresh();
  }

  // ---------------------------------------------------------------------------
  // ③ 桌宠界面 — 自动 / 只在内置桌宠
  // ---------------------------------------------------------------------------

  function renderSurface() {
    var box = el('setup-surface');
    var note = el('setup-surface-note');
    var value = preferences.petSurface === 'app' ? 'app' : 'auto';
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('input[name="setup-surface"]'), function (input) {
        input.checked = input.value === value;
      });
    }
    if (note) {
      // No prose: the two radio labels already say what the choice is. Only a FAILURE has something to add.
      note.textContent = '';
    }
    renderRuntimeNote();
  }

  /**
   * The runtime folder's own line, filled from the HOST rather than written by hand.
   *
   * Operator, 2026-10-15: 「加上建立插件runtime文件夹和dsh客户端硬链接的事情，并告知文件夹的位置，以免用户不知道文件夹怎么回事」 — the
   * location is the part a reader cannot guess, and the host already computes it, so the guide asks instead of describing: the real
   * path appears here, and a window that has never started still shows the path the launcher WOULD use.
   *
   * A host without the route (or a failed fetch) leaves the line EMPTY rather than inventing a path — the same rule as every other
   * readout on these pages.
   */
  function renderRuntimeNote() {
    var line = el('setup-runtime-path');
    if (!line || typeof fetch !== 'function') return;
    fetch('/vrmpet3d-dev/desktop', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (status) {
        var dir = status && typeof status.runtimeDir === 'string' ? status.runtimeDir : '';
        // The path is data; the sentence around it is this table's, and is read at THIS moment.
        line.textContent = dir ? t('runtimeDir', { dir: dir }) : '';
      })
      .catch(function () { line.textContent = ''; });
  }

  // ---------------------------------------------------------------------------
  // ④ AI 碎碎念
  // ---------------------------------------------------------------------------

  /** The providers this running DSH can actually reach, straight from the live service. */
  function providerList() {
    return (llm && llm.dsh && Array.isArray(llm.dsh.providers)) ? llm.dsh.providers : [];
  }

  /**
   * The AI source this page defaults to, in the operator's own order:
   * 「默认是 DeepSeek Account（如已经接入 Account 的话），否则是 DeepSeek API（同 dsh 配置的 API）」.
   *
   * Read from the LIVE provider list rather than assumed: `deepseek-account` when it is there, else whatever
   * provider the host says this app is configured with, else the first one it offers. Nothing is written until the
   * user actually picks AI — a guide must not change a store the user did not ask it to.
   */
  function defaultProvider() {
    var providers = providerList();
    var account = providers.filter(function (entry) {
      return /deepseek-account|account|账号/i.test(String(entry.id || '') + ' ' + String(entry.name || ''));
    })[0];
    if (account) return account.id;
    if (llm && llm.dsh && typeof llm.dsh.provider === 'string' && llm.dsh.provider) return llm.dsh.provider;
    return providers.length ? providers[0].id : '';
  }

  function currentSpeech() { return core.cleanSpeech(preferences.speech); }

  function renderSpeech() {
    var speech = currentSpeech();
    var enabled = el('setup-speech-enabled');
    if (enabled) enabled.checked = speech.enabled !== false;
    var box = el('setup-speech-source');
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('input[name="setup-speech-source"]'), function (input) {
        input.checked = input.value === (speech.source === 'ai' ? 'ai' : 'builtin');
      });
    }
    var aiRow = el('setup-ai-row');
    if (aiRow) aiRow.hidden = speech.source !== 'ai';
    // Its explanation travels WITH it: the persona and the per-state prompts are configured on 通用设置, and the
    // row that chooses a provider is the only place that promise makes sense.
    var aiNote = el('setup-ai-note');
    if (aiNote) aiNote.hidden = speech.source !== 'ai';
    var provider = el('setup-ai-provider');
    var model = el('setup-ai-model');
    if (provider) {
      clear(provider);
      providerList().forEach(function (entry) {
        var option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name || entry.id;
        provider.appendChild(option);
      });
      provider.value = speech.ai.dshProvider || defaultProvider();
    }
    if (model) {
      clear(model);
      ((llm && llm.dsh && Array.isArray(llm.dsh.models)) ? llm.dsh.models : []).forEach(function (entry) {
        var option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.name || entry.id;
        model.appendChild(option);
      });
      model.value = speech.ai.dshModel || (model.options.length ? model.options[0].value : '');
    }
    var note = el('setup-speech-note');
    if (note) {
      var available = providerList().length;
      // The count is data; the sentence around it was explanation, so only a real problem is stated.
      note.textContent = speech.source === 'ai' && !available ? t('noProviders') : '';
    }
  }

  /** Load the provider list, and — when AI is already the choice — that provider's models. */
  function loadLlm(providerId) {
    var wanted = providerId || '';
    return getJson('/vrmpet3d-dev/llm' + (wanted ? '?provider=' + encodeURIComponent(wanted) : ''))
      .then(function (body) {
        if (!body) return null;
        llm = body;
        var chosen = currentSpeech().ai.dshProvider || defaultProvider();
        if (!wanted && chosen) return loadLlm(chosen);
        renderSpeech();
        return body;
      });
  }

  function chooseAiSource(source) {
    if (source !== 'ai') {
      patchPreferences({ speech: speechWith({ source: 'builtin' }) });
      renderSpeech();
      return Promise.resolve();
    }
    var provider = (el('setup-ai-provider') || {}).value || defaultProvider();
    var model = (el('setup-ai-model') || {}).value || '';
    var apply = function () {
      patchPreferences({ speech: speechWith({ enabled: true, source: 'ai', ai: { provider: 'dsh', dshProvider: provider, dshModel: model } }) });
      renderSpeech();
    };
    // The model list belongs to a provider, so a provider chosen here is asked about once before the pair is
    // written — the same lesson the settings page paid for ("还没有选择 DSH 的模型").
    return (llm && llm.dsh && llm.dsh.provider === provider) ? Promise.resolve().then(apply) : loadLlm(provider).then(apply);
  }

  // ---------------------------------------------------------------------------
  // ⑤ 模型动作
  // ---------------------------------------------------------------------------

  function renderMotions() {
    var list = el('setup-motion-list');
    var note = el('setup-motion-note');
    var count = el('setup-motion-count');
    if (count) count.textContent = importedMotions.length ? t('motionsImportedCount', { count: importedMotions.length }) : '';
    if (list) {
      clear(list);
      importedMotions.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'row';
        row.appendChild(text('span', 'k', t('motionsImportedRow')));
        // The name and the clip count are the host's data; only the words around them are translated.
        row.appendChild(text('span', 'grow note', t('motionsClips', { name: entry.name, clips: entry.clips }))).title = entry.source || entry.dir;
        var remove = text('button', 'ghost', t('motionsRemove'));
        remove.addEventListener('click', function () { removeMotion(entry.dir); });
        row.appendChild(remove);
        list.appendChild(row);
      });
    }
    if (note) {
      note.textContent = '';
    }
  }

  function refreshMotions() {
    return getJson('/vrmpet3d-dev/motions').then(function (body) {
      importedMotions = body && Array.isArray(body.importedMotions) ? body.importedMotions : [];
      // Kept for `applyLanguage`: this route is fetched once, and the defaults line below is built from its payload.
      motionBody = body || null;
      renderMotions();
      renderMotionDefaults(body);
      return body;
    });
  }

  /**
   * 「告知在各个工作状态下已有默认动作」 — said with the pack's OWN data rather than as a claim.
   *
   * The operator will fill `defaults` in `assets/motions/vrmpet3d-dev-motions.json` before the official release, and
   * this line then names what each state will play. Until they do, it says what is true (the pack offers the clips
   * per state and nothing is assigned yet) instead of promising something the data does not carry.
   */
  function renderMotionDefaults(body) {
    var node = el('setup-motion-defaults');
    if (!node) return;
    var defaults = body && body.motionDefaults && typeof body.motionDefaults === 'object' ? body.motionDefaults : {};
    var names = body && Array.isArray(body.motions) ? body.motions : [];
    var byId = {};
    names.forEach(function (entry) { byId[entry.id] = entry.name; });
    var states = (core.MOTION_STATES || []).filter(function (state) { return (defaults[state] || []).length; });
    if (states.length) {
      // The states and the clips are the pack's own names; the sentence and its list punctuation are this table's.
      node.textContent = t('motionDefaultsKnown', {
        list: states.map(function (state) {
          return state + ' → ' + (defaults[state] || []).map(function (id) { return byId[id] || id; }).join(t('sepList'));
        }).join(t('sepClause')),
      });
      return;
    }
    node.textContent = t('motionDefaultsNone', { count: names.length });
  }

  function importMotion(path) {
    if (!path) return Promise.resolve();
    say('motionImporting');
    return post('/vrmpet3d-dev/motions', { importDir: path }).then(function (payload) {
      importedMotions = payload && Array.isArray(payload.importedMotions) ? payload.importedMotions : importedMotions;
      renderMotions();
      if (payload) {
        // The same shape `refreshMotions` caches: an import reply carries the whole catalog (`lib/index.js`).
        motionBody = payload;
        renderMotionDefaults(payload);
      }
      var last = importedMotions[importedMotions.length - 1];
      if (last) say('motionImportedName', { name: last.name, clips: last.clips });
      else say('motionImported');
    }).catch(function (error) {
      say('motionImportFailed', { error: error && error.message ? error.message : error }, 'warn');
    });
  }

  function removeMotion(dir) {
    return post('/vrmpet3d-dev/motions', { unimportDir: dir }).then(function (payload) {
      importedMotions = payload && Array.isArray(payload.importedMotions) ? payload.importedMotions : importedMotions;
      renderMotions();
      say('motionRemoved');
    }).catch(function (error) {
      say('motionRemoveFailed', { error: error && error.message ? error.message : error }, 'warn');
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function bridge() { return globalThis.vrmpet3dDevDesktop || null; }

  /** Wire a pick button: the native picker when the launcher has one, the typed row otherwise. */
  function wirePicker(pickId, manualId, rowId, inputId, addId, method, onChosen) {
    var pick = el(pickId);
    var manual = el(manualId);
    var row = el(rowId);
    var input = el(inputId);
    var add = el(addId);
    var launcher = bridge();
    if (pick) {
      pick.addEventListener('click', function () {
        var choose = launcher && typeof launcher[method] === 'function' ? launcher[method] : null;
        if (!choose) {
          if (row) row.hidden = false;
          if (input) input.focus();
          say('noNativePicker', null, 'warn');
          return;
        }
        Promise.resolve(choose()).then(function (chosen) { return chosen ? onChosen(chosen) : null; });
      });
    }
    if (manual && row) {
      manual.addEventListener('click', function () {
        row.hidden = !row.hidden;
        if (!row.hidden && input) input.focus();
      });
    }
    if (add && input) {
      var submit = function () { onChosen(input.value.trim()); input.value = ''; };
      add.addEventListener('click', submit);
      input.addEventListener('keydown', function (event) { if (event.key === 'Enter') submit(); });
    }
  }

  function wireFinish() {
    var finish = el('setup-finish');
    var close = el('setup-close');
    var note = el('setup-finish-note');
    /**
     * Close this window, and take no answer for granted.
     *
     * A window the launcher opened closes; a browser TAB may refuse — Chromium only lets a script close a window it
     * opened itself — so there has to be a way out that does not depend on it.
     */
    var closeWindow = function () {
      try { globalThis.close(); } catch (error) { /* the button below is the fallback */ }
    };
    /**
     * 完成 ends the guide AND closes the window: one click, not two.
     *
     * Operator, 2026-10-13: 「点击完成后直接退出，而不是要再点一下关闭窗口」. It used to only write `completed` and then
     * reveal a 关闭窗口 button, which left a finished guide on screen asking to be dismissed. The write still has to
     * land first — a window that vanished before the host recorded it would ask for the guide again on the next start
     * — so this closes in the POST's reply, and only then.
     */
    var complete = function () {
      post('/vrmpet3d-dev/setup-state', { completed: true }).then(function () {
        if (note) note.textContent = t('savedNoGuide');
        if (finish) finish.disabled = true;
        say('setupComplete');
        closeWindow();
        /**
         * And if the window is STILL here, offer the button rather than a dead end.
         *
         * `globalThis.closed` is the only honest answer to "did that work?", and it is checked a moment later
         * because the close is asynchronous — a `window.close()` that succeeded means this timer never runs.
         */
        var view = globalThis;
        if (view && typeof view.setTimeout === 'function') {
          view.setTimeout(function () {
            if (view.closed === true) return;
            if (close) close.hidden = false;
            if (note) note.textContent = t('savedNoGuide');
          }, 300);
        }
      }).catch(function (error) {
        if (note) note.textContent = t('saveFailed', { error: error && error.message ? error.message : error });
      });
    };
    if (finish) finish.addEventListener('click', complete);
    var next = el('setup-next');
    if (next) {
      next.addEventListener('click', function () {
        if (current === lastIndex()) { complete(); return; }
        goto(current + 1);
      });
    }
    var back = el('setup-back');
    if (back) back.addEventListener('click', function () { goto(current - 1); });
    if (close) {
      close.addEventListener('click', function () {
        // The fallback for a tab that refused to close itself (see `closeWindow`).
        closeWindow();
      });
    }
    var later = el('setup-later');
    if (later) {
      later.addEventListener('click', function () {
        say('skipped');
        closeWindow();
      });
    }
  }

  function wireChoices() {
    /**
     * 界面语言, on the welcome screen — and the ONE choice here that is not saved for 完成.
     *
     * Operator, 2026-10-15: 「在初始安装引导页的第一页欢迎页面中加上语言选择」, and the point of putting it on the FIRST
     * screen is that it has to work BEFORE the reader has finished reading: a reader who cannot read 中文 picks
     * English and wants the sentence in front of them to change, not the next screen. So this patches the setting
     * through the page's own path ({@link patchPreferences}, snapshot-guarded and local-first) and then re-labels
     * everything in place ({@link applyLanguage}).
     *
     * The value written is the STORED answer — `auto` included, never a resolved 'zh'/'en' (`core.cleanLanguage`
     * documents why: a profile that froze the resolved language could never follow the machine again).
     */
    var lang = el('setup-language');
    if (lang) {
      lang.addEventListener('change', function () {
        var choice = core.cleanLanguage(lang.value);
        // See `pendingLanguage`: before the first snapshot this pick cannot be written yet, and the snapshot that
        // arrives next would otherwise overwrite it with the stored answer.
        pendingLanguage = hasSnapshot ? null : choice;
        patchPreferences({ language: choice });
        applyLanguage();
      });
    }
    var surface = el('setup-surface');
    if (surface) {
      Array.prototype.forEach.call(surface.querySelectorAll('input[name="setup-surface"]'), function (input) {
        input.addEventListener('change', function () {
          if (!input.checked) return;
          patchPreferences({ petSurface: input.value === 'app' ? 'app' : 'auto' });
          renderSurface();
        });
      });
    }
    var enabled = el('setup-speech-enabled');
    if (enabled) {
      enabled.addEventListener('change', function () {
        patchPreferences({ speech: speechWith({ enabled: enabled.checked }) });
      });
    }
    var source = el('setup-speech-source');
    if (source) {
      Array.prototype.forEach.call(source.querySelectorAll('input[name="setup-speech-source"]'), function (input) {
        input.addEventListener('change', function () { if (input.checked) chooseAiSource(input.value); });
      });
    }
    var provider = el('setup-ai-provider');
    if (provider) provider.addEventListener('change', function () { chooseAiSource('ai'); });
    var model = el('setup-ai-model');
    if (model) {
      model.addEventListener('change', function () {
        patchPreferences({ speech: speechWith({ enabled: true, source: 'ai', ai: { provider: 'dsh', dshModel: model.value } }) });
      });
    }
  }

  /** The language THIS page would draw in: the stored answer resolved against the page's own environment. */
  function resolvedLanguage() {
    // `browserLanguageHints` is the browser's answer first and the document's own `lang` second (see core). The
    // document is marked by `applyLanguage` itself, so on every pass after the first the second hint is the
    // language already in force — stable, and still overruled by an explicit 中文/English or by the browser.
    return core.resolveLanguage(preferences.language, core.browserLanguageHints());
  }

  /** The selector shows the STORED answer — `auto` included — never the language it resolved to. */
  function renderLanguage() {
    var select = el('setup-language');
    if (select) select.value = core.cleanLanguage(preferences.language);
  }

  /**
   * Draw this page in the language it should be drawn in — the ONE place that knows how, and the only thing a
   * language change calls.
   *
   * It has three jobs rather than one, because this page's words live in three places and each needs its own step:
   *
   *   1. the MARKUP, which keeps its Chinese inline as the no-JS fallback and names its key — `core.applyI18n`;
   *   2. the strings this script writes — every one of them is read through `t()` at call time, so re-running the
   *      section renderers (`goto`, `renderSurface`, `renderSpeech`, `renderMotions`, `renderMotionDefaults`) is
   *      what re-states them;
   *   3. the SHARED model picker, which is BUILT in one language (`createModelPicker`'s `language`) and relabels
   *      through its own `setLanguage` — the same nodes, the same catalog, a switch in flight left alone. A picker
   *      without that call (an older component) is mounted again instead: `destroy` removes exactly the subtree it
   *      owns, and the mount point, the store callbacks and the catalog refresh are all reused.
   *
   * `documentElement.lang` follows the resolved language, which is what makes a host-served page honest about its
   * own language (and is where `browserLanguageHints`' second hint comes from on the next pass).
   *
   * The status line is the one node `applyI18n` would overwrite with a shipped default, so it is re-stated from
   * the key it was last written with — see `statusLine`.
   */
  function applyLanguage() {
    language = resolvedLanguage();
    if (document.documentElement) document.documentElement.lang = language;
    core.applyI18n(document, TEXT, language);
    renderLanguage();
    if (!picker) {
      mountModelPicker();
      refreshModels();
    } else if (typeof picker.setLanguage === 'function') {
      picker.setLanguage(language);
    } else {
      // An older component that only takes its words at construction: mount it again, and re-read the catalog the
      // new instance does not have yet. `destroy` is its own API and the mount is cleared as well, so a component
      // that grew a different teardown cannot leave a stale grid behind the new one.
      if (typeof picker.destroy === 'function') picker.destroy();
      var mount = el('setup-model-picker');
      if (mount) clear(mount);
      picker = null;
      mountModelPicker();
      refreshModels();
    }
    goto(current);
    renderSurface();
    renderSpeech();
    renderMotions();
    // Skipped until the first `/vrmpet3d-dev/motions` reply: its "no data" branch would claim an empty pack.
    if (motionBody) renderMotionDefaults(motionBody);
    restateStatus();
  }

  /**
   * The host's settings store, the same contract the two settings pages use.
   *
   * Nothing is written before the first snapshot (`hasSnapshot`), and the values shown are refreshed from every
   * snapshot so a change made in the settings window while this page is open is reflected here.
   */
  function watchSettings() {
    if (typeof core.watchHostSettings !== 'function') {
      say('coreNoStore', null, 'warn');
      renderSurface();
      renderSpeech();
      return;
    }
    hostSync = core.watchHostSettings({
      // The guide's model step mounts the same picker, so it wants the same responsiveness: the progress bar
      // ends on the snapshot that carries the live report, and 1.5 s of poll lag is a bar that outstays the load.
      intervalMs: 700,
      onSnapshot: function (snapshot) {
        preferences = core.cleanPreferences(snapshot.preferences || {});
        hasSnapshot = true;
        if (pendingLanguage) {
          // The reader's own pick, made while the page had no write permission: this is the first moment it can be
          // written, and it outranks the snapshot that was already in flight when they made it. The store merges by
          // key, so the patch carries this one setting and nothing else.
          preferences.language = pendingLanguage;
          if (hostSync && typeof hostSync.push === 'function') hostSync.push({ preferences: { language: pendingLanguage } });
          pendingLanguage = null;
        }
        /**
         * THE LANGUAGE FIRST, because the snapshot is where the stored answer arrives.
         *
         * The selector always follows the STORE, and when the answer RESOLVES to a different language than the one
         * the page booted in — a profile set to 中文 opened on an English machine, or the other way round — the
         * whole page is re-labelled before the rest of this snapshot paints. A change that resolves to the same
         * language needs nothing but the selector.
         */
        var before = language;
        renderLanguage();
        if (resolvedLanguage() !== before) applyLanguage();
        // The live report, for the picker's progress bar: which model a pet says it is actually showing.
        var live = snapshot && snapshot.live ? snapshot.live : null;
        liveModel = live ? (live.app || live.window || null) : null;
        renderSurface();
        renderSpeech();
        // The picker's 使用中 marker follows the STORE, so a switch made from another window lands here too —
        // and this is the call that asks whether an in-flight switch has finished.
        if (picker) picker.setCurrent();
        // Never over a switch's own line: while the bar is up, that line is what the user is reading.
        if (!(picker && picker.state().switching)) say('readSettings');
      },
    }).start();
  }

  function boot() {
    // The language is resolved FIRST: every line below is written through `t`, and the model picker takes its own
    // language when `applyLanguage` mounts it.
    language = resolvedLanguage();
    say('reading');
    wireChoices();
    wireFinish();
    // The model step is the shared picker, mounted by `applyLanguage` because its words are fixed at construction;
    // the motion step keeps its pick-or-type row (a folder cannot be dropped into a form field, and the picker's
    // own component has no folder mode).
    wirePicker('setup-motion-pick', 'setup-motion-manual', 'setup-motion-manual-row', 'setup-motion-path', 'setup-motion-add',
      'pickMotionDir', importMotion);
    applyLanguage();
    watchSettings();
    loadLlm();
    refreshMotions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // For the launcher's self-test and the browser probe: the page's own account of where it is.
  globalThis.__VRMPET3D_DEV_SETUP_STATE__ = function () {
    return {
      step: current,
      total: activeSteps().length,
      /** The words this run's stepper shows, in order — read off the same nodes `goto` walks. */
      steps: activeSteps().map(function (node) { return node.textContent; }),
      desktop: hasDesktop(),
      hasSnapshot: hasSnapshot,
      importedModels: importedModelCount(),
      importedMotions: importedMotions.length,
      petSurface: preferences.petSurface,
      speech: currentSpeech(),
      providers: providerList().length,
    };
  };

  /**
   * The stepper's own words as a function of "can an independent pet exist here", so a suite can assert BOTH guides
   * — DSH Desktop's and dsh web's shorter one — from a single boot of the real page.
   */
  globalThis.__VRMPET3D_DEV_SETUP_STEPS__ = function (desktop) {
    return stepsFor(desktop === true).map(function (node) { return node.textContent; });
  };
})();

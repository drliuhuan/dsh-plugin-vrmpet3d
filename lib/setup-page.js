/**
 * The first-run guide's script: five screens and a finish, over `/vrmpet3d/setup`.
 *
 * WHY IT EXISTS. Operator, 2026-10-12: 「增加一个初次安装引导界面，安装成功后，彻底配置完之前，每次插件运行都会弹配置引导」.
 * So the page has one job beyond showing text: it must be FINISHABLE. `完成` is the only thing that writes
 * `completed` (over `POST /vrmpet3d/setup-state`), which is what stops the host offering the guide on the next
 * activation; closing the window early deliberately does not, because that is the requested behaviour.
 *
 * WHAT IT WRITES, and when. Every preference edit goes through the same host store the settings pages use
 * (`core.watchHostSettings` → `POST /vrmpet3d/settings`), and NOTHING is written before the first snapshot has
 * arrived — the data-loss latch the settings pages learned the hard way (`hasSnapshot` in `lib/config-page.js`): a
 * page that boots into defaults and then writes replaces everything the user configured.
 *
 * The two import sections both hand the work to the host and let it write its own stores — the model step through
 * the shared picker (`lib/model-picker.js`: `addFile` for a path from the launcher's dialog, or the file's bytes
 * when the page has no launcher) and the action step as a PATH (`importDir`). A web page cannot open a dialog (the
 * launcher's `pickModelFile` / `pickMotionDir` bridge does) and must not write the host's files itself — which is
 * also what keeps `VRMPET3D_*_FILE` in force for the suites.
 */
(function () {
  'use strict';

  var core = globalThis.__VRMPET3D_CORE__;
  if (!core) return;

  /** The six screens, in order. The last one is not a configuration page: it is the finish. */
  var SCREENS = ['setup-0', 'setup-1', 'setup-2', 'setup-3', 'setup-4', 'setup-5'];
  var LAST = SCREENS.length - 1;

  var current = 0;
  /** The first host snapshot is the permission to write. See the header. */
  var hasSnapshot = false;
  var preferences = core.cleanPreferences({});
  var hostSync = null;
  /** The imported lists, as the host reports them: what to show and what a 移除 acts on. */
  var importedModels = [];
  var importedMotions = [];
  /** The shared model picker the ② 偏好模型 step mounts (`lib/model-picker.js`). */
  var picker = null;
  /** Which model a surface reports it is showing, from the snapshot's `live` — what ends the progress bar. */
  var liveModel = null;
  /** The DSH provider/model catalog, from `/vrmpet3d/llm`. */
  var llm = null;

  function el(id) { return document.getElementById(id); }

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

  function goto(index) {
    current = Math.max(0, Math.min(LAST, index));
    SCREENS.forEach(function (id, position) {
      var screen = el(id);
      if (screen) screen.hidden = position !== current;
    });
    var steps = el('setup-steps');
    if (steps) {
      Array.prototype.forEach.call(steps.children, function (node, position) {
        node.setAttribute('data-active', position === current ? '1' : '0');
        node.setAttribute('data-done', position < current ? '1' : '0');
      });
    }
    var back = el('setup-back');
    var next = el('setup-next');
    if (back) back.disabled = current === 0;
    if (next) next.textContent = current === LAST ? '完成' : '下一步';
    var header = document.querySelector('.page-header h1');
    if (header) header.textContent = current === LAST ? '配置完成' : '初次安装引导';
    // The finish screen's own button is the one that WRITES; the footer says the same thing for a user who
    // navigates by keyboard.
    if (next) next.hidden = false;
    var finish = el('setup-finish');
    if (finish) finish.hidden = current === LAST;
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
      if (!hostSync) setStatus('这个宿主没有提供设置接口，改动只在本页生效。', 'warn');
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
    var api = globalThis.__VRMPET3D_MODEL_PICKER__;
    if (!mount || !api || typeof api.createModelPicker !== 'function') {
      setStatus('这个页面没有加载模型选择组件（model-picker.js）。', 'warn');
      return null;
    }
    picker = api.createModelPicker({
      mount: mount,
      language: 'zh',
      currentModelId: function () { return preferences.modelId || ''; },
      /**
       * Which model a pet reports it is SHOWING (`snapshot.live`), so the progress bar is about the LOAD rather
       * than about the write — the same wiring the 切换模型 page uses, because it is the same component.
       */
      liveModelId: function () { return liveModel; },
      // Choosing a model in a guide called 「偏好模型」 and then not choosing it would be a strange half-step:
      // the component calls this for a CLICK and after an import, and both mean "this is my model now".
      onSwitch: function (id) { patchPreferences({ modelId: id }); },
      onStatus: setStatus,
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
      note.textContent = speech.source === 'ai' && !available
        ? '没有可用的 provider。'
        : '';
    }
  }

  /** Load the provider list, and — when AI is already the choice — that provider's models. */
  function loadLlm(providerId) {
    var wanted = providerId || '';
    return getJson('/vrmpet3d/llm' + (wanted ? '?provider=' + encodeURIComponent(wanted) : ''))
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
    if (count) count.textContent = importedMotions.length ? '已导入 ' + importedMotions.length + ' 个动作文件夹' : '';
    if (list) {
      clear(list);
      importedMotions.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'row';
        row.appendChild(text('span', 'k', '已导入'));
        row.appendChild(text('span', 'grow note', entry.name + '（' + entry.clips + ' 支）')).title = entry.source || entry.dir;
        var remove = text('button', 'ghost', '移除');
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
    return getJson('/vrmpet3d/motions').then(function (body) {
      importedMotions = body && Array.isArray(body.importedMotions) ? body.importedMotions : [];
      renderMotions();
      renderMotionDefaults(body);
      return body;
    });
  }

  /**
   * 「告知在各个工作状态下已有默认动作」 — said with the pack's OWN data rather than as a claim.
   *
   * The operator will fill `defaults` in `assets/motions/vrmpet3d-motions.json` before the official release, and
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
      node.textContent = '各状态的默认动作：' + states.map(function (state) {
        return state + ' → ' + (defaults[state] || []).map(function (id) { return byId[id] || id; }).join('、');
      }).join('；') + '。这些默认值可以在通用设置 → 状态与动作里改。';
      return;
    }
    node.textContent = '动作包已按工作状态分好目录（' + names.length + ' 支）：每个状态的选择框里只会列出它自己目录里的动作。'
      + '当前这版还没有预置状态→动作的默认映射，所以你需要在通用设置 → 状态与动作里为状态勾选动作。';
  }

  function importMotion(path) {
    if (!path) return Promise.resolve();
    setStatus('正在导入动作…');
    return post('/vrmpet3d/motions', { importDir: path }).then(function (payload) {
      importedMotions = payload && Array.isArray(payload.importedMotions) ? payload.importedMotions : importedMotions;
      renderMotions();
      if (payload) renderMotionDefaults(payload);
      var last = importedMotions[importedMotions.length - 1];
      setStatus(last ? '已导入动作文件夹：' + last.name + '（' + last.clips + ' 支）' : '已导入动作。');
    }).catch(function (error) {
      setStatus('导入失败：' + (error && error.message ? error.message : error), 'warn');
    });
  }

  function removeMotion(dir) {
    return post('/vrmpet3d/motions', { unimportDir: dir }).then(function (payload) {
      importedMotions = payload && Array.isArray(payload.importedMotions) ? payload.importedMotions : importedMotions;
      renderMotions();
      setStatus('已移除插件复制的那一份。');
    }).catch(function (error) {
      setStatus('移除失败：' + (error && error.message ? error.message : error), 'warn');
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function bridge() { return globalThis.vrmpet3dDesktop || null; }

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
          setStatus('这个窗口没有原生选择器（不是在 DSH 桌面版里打开的），请在下面直接输入路径。', 'warn');
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
      post('/vrmpet3d/setup-state', { completed: true }).then(function () {
        if (note) note.textContent = '已保存：这个引导不会再出现了。';
        if (finish) finish.disabled = true;
        setStatus('配置完成。');
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
            if (note) note.textContent = '已保存：这个引导不会再出现了。';
          }, 300);
        }
      }).catch(function (error) {
        if (note) note.textContent = '保存失败：' + (error && error.message ? error.message : error);
      });
    };
    if (finish) finish.addEventListener('click', complete);
    var next = el('setup-next');
    if (next) {
      next.addEventListener('click', function () {
        if (current === LAST) { complete(); return; }
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
        setStatus('已跳过：下次插件启动时会再提醒你一次。');
        closeWindow();
      });
    }
  }

  function wireChoices() {
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

  /**
   * The host's settings store, the same contract the two settings pages use.
   *
   * Nothing is written before the first snapshot (`hasSnapshot`), and the values shown are refreshed from every
   * snapshot so a change made in the settings window while this page is open is reflected here.
   */
  function watchSettings() {
    if (typeof core.watchHostSettings !== 'function') {
      setStatus('这个版本的 core 没有设置接口，页面只能展示默认值。', 'warn');
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
        // The live report, for the picker's progress bar: which model a pet says it is actually showing.
        var live = snapshot && snapshot.live ? snapshot.live : null;
        liveModel = live ? (live.app || live.window || null) : null;
        renderSurface();
        renderSpeech();
        // The picker's 使用中 marker follows the STORE, so a switch made from another window lands here too —
        // and this is the call that asks whether an in-flight switch has finished.
        if (picker) picker.setCurrent();
        // Never over a switch's own line: while the bar is up, that line is what the user is reading.
        if (!(picker && picker.state().switching)) setStatus('已读取当前设置。');
      },
    }).start();
  }

  function boot() {
    setStatus('正在读取…');
    wireChoices();
    wireFinish();
    // The model step is the shared picker; the motion step keeps its pick-or-type row (a folder cannot be
    // dropped into a form field, and the picker's own component has no folder mode).
    mountModelPicker();
    wirePicker('setup-motion-pick', 'setup-motion-manual', 'setup-motion-manual-row', 'setup-motion-path', 'setup-motion-add',
      'pickMotionDir', importMotion);
    watchSettings();
    renderSurface();
    renderSpeech();
    renderMotions();
    goto(0);
    loadLlm();
    refreshModels();
    refreshMotions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // For the launcher's self-test and the browser probe: the page's own account of where it is.
  globalThis.__VRMPET3D_SETUP_STATE__ = function () {
    return {
      step: current,
      total: SCREENS.length,
      hasSnapshot: hasSnapshot,
      importedModels: importedModelCount(),
      importedMotions: importedMotions.length,
      petSurface: preferences.petSurface,
      speech: currentSpeech(),
      providers: providerList().length,
    };
  };
})();

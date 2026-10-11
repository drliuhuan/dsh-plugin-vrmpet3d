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
 * The two import sections hand a PATH to the host and let it write its own stores (`addFile` / `importDir`): a
 * web page cannot open a dialog (the launcher's `pickModelFile` / `pickMotionDir` bridge does) and must not write
 * the host's files itself — which is also what keeps `VRMPET3D_*_FILE` in force for the suites.
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
  // ② 偏好模型 — a FILE, copied into the plugin's own storage
  // ---------------------------------------------------------------------------

  function renderModels() {
    var list = el('setup-model-list');
    var note = el('setup-model-note');
    var count = el('setup-model-count');
    if (count) count.textContent = importedModels.length ? '已导入 ' + importedModels.length + ' 个模型' : '';
    if (list) {
      clear(list);
      importedModels.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'row';
        row.appendChild(text('span', 'k', '已导入'));
        row.appendChild(text('span', 'grow note', entry.name));
        row.lastChild.title = entry.source || entry.file;
        var remove = text('button', 'ghost', '移除');
        remove.addEventListener('click', function () { removeModel(entry.file); });
        row.appendChild(remove);
        list.appendChild(row);
      });
    }
    if (note) {
      note.textContent = importedModels.length
        ? '文件已复制到插件自己的目录。原文件之后再移动、改名或删除，都不影响这里。'
        : '';
    }
  }

  function refreshModels() {
    return getJson('/vrmpet3d/models').then(function (body) {
      importedModels = body && Array.isArray(body.importedModels) ? body.importedModels : [];
      renderModels();
    });
  }

  /**
   * Import one model file, then MAKE IT the preferred model.
   *
   * Choosing a model in a guide called 「偏好模型」 and then not choosing it would be a strange half-step: the
   * import reply carries the rebuilt catalog, so the id is looked up there and written as `modelId`.
   */
  function importModel(path) {
    if (!path) return Promise.resolve();
    setStatus('正在导入模型…');
    return post('/vrmpet3d/models', { addFile: path }).then(function (payload) {
      importedModels = payload && Array.isArray(payload.importedModels) ? payload.importedModels : importedModels;
      renderModels();
      var entry = importedModels.filter(function (candidate) {
        return candidate.file === (payload && payload.importedModels || []).slice(-1)[0]?.file;
      })[0] || importedModels[importedModels.length - 1];
      var name = entry ? entry.name : '';
      var model = (payload && Array.isArray(payload.models) ? payload.models : []).filter(function (candidate) {
        return candidate.source === 'user' && candidate.name === name;
      })[0];
      if (model && model.id) patchPreferences({ modelId: model.id });
      setStatus(model ? '已导入并设为偏好模型：' + name : '已导入：' + (name || path));
    }).catch(function (error) {
      setStatus('导入失败：' + (error && error.message ? error.message : error), 'warn');
    });
  }

  function removeModel(file) {
    return post('/vrmpet3d/models', { removeFile: file }).then(function (payload) {
      importedModels = payload && Array.isArray(payload.importedModels) ? payload.importedModels : importedModels;
      renderModels();
      setStatus('已移除插件复制的那一份。');
    }).catch(function (error) {
      setStatus('移除失败：' + (error && error.message ? error.message : error), 'warn');
    });
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
      note.textContent = value === 'app'
        ? '只开内置桌宠：不会再有浮在所有窗口之上的那一只。'
        : '自动：在 DSH 桌面版里打开独立桌宠；网页版等没有桌面端的场合只有内置桌宠。';
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
      note.textContent = speech.source === 'ai'
        ? (available
          ? 'AI 生成会用上面这个 DSH provider（' + available + ' 个可选）。'
          : '这个 DSH 没有可用的 provider，AI 生成暂时不可用——可以改回内置台词，或去通用设置里配置自定义 API。')
        : '内置台词不联网，随时可用。';
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
      note.textContent = importedMotions.length
        ? '文件夹已复制到插件自己的目录（含它自己的清单）。原文件夹之后再移动或删除，都不影响。'
        : '';
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
    var complete = function () {
      post('/vrmpet3d/setup-state', { completed: true }).then(function () {
        if (note) note.textContent = '已保存：这个引导不会再出现了。';
        if (close) close.hidden = false;
        if (finish) finish.disabled = true;
        setStatus('配置完成。');
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
        // In the launcher's own window this closes it; in a tab the browser may refuse, so the message stays.
        try { globalThis.close(); } catch (error) { /* the user can close it themselves */ }
      });
    }
    var later = el('setup-later');
    if (later) {
      later.addEventListener('click', function () {
        setStatus('已跳过：下次插件启动时会再提醒你一次。');
        try { globalThis.close(); } catch (error) { /* the user can close it themselves */ }
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
      onSnapshot: function (snapshot) {
        preferences = core.cleanPreferences(snapshot.preferences || {});
        hasSnapshot = true;
        setStatus('已读取当前设置。');
        renderSurface();
        renderSpeech();
      },
    }).start();
  }

  function boot() {
    setStatus('正在读取…');
    wireChoices();
    wireFinish();
    wirePicker('setup-model-pick', 'setup-model-manual', 'setup-model-manual-row', 'setup-model-path', 'setup-model-add',
      'pickModelFile', importModel);
    wirePicker('setup-motion-pick', 'setup-motion-manual', 'setup-motion-manual-row', 'setup-motion-path', 'setup-motion-add',
      'pickMotionDir', importMotion);
    watchSettings();
    renderSurface();
    renderSpeech();
    renderModels();
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
      importedModels: importedModels.length,
      importedMotions: importedMotions.length,
      petSurface: preferences.petSurface,
      speech: currentSpeech(),
      providers: providerList().length,
    };
  };
})();

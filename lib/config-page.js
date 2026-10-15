// The settings pages' script — TWO PAGES, ONE SCRIPT.
//
// `lib/config-page.html` (模型参数: 模型 / 表情 / 部位 / 弹簧骨) and `lib/global-page.html` (通用设置: 模型导入 /
// 动作导入 / 状态 / 碎碎念 / 视线 / 鼠标互动 / 其他) are two real pages served by two real routes
// (`/vrmpet3d/config`, `/vrmpet3d/global`) and both load THIS file. Every DOM lookup here goes through
// `element()`, and every builder it feeds returns early when its container is absent, so each page runs
// only the half that belongs to it. A second copy of this file would be a second implementation of the
// same rules — the debt this repository has already paid for twice, in the two pets' settings panels
// (deleted 2026-10-12) and in the two renderer halves.
//
// It is deliberately dumb about the model: everything it lists comes from `GET /vrmpet3d/model-info`, which
// the HOST parses out of the model file. That is what lets this page describe a model with no pet
// running, and what keeps the list of expressions and spring chains identical to the file on disk.
//
// Every edit goes through the shared preferences in localStorage, through the mutators in `lib/core.js`
// (the same ones the app panel uses), and then out to whatever is showing the pet:
//
//   * this page writes `dsh.vrmpet3d.v1`;
//   * the app's own pet and the floating window's page are same-origin documents, so they receive a
//     `storage` event and re-apply — the change is visible on the pet without a reload;
//   * nothing here talks to a renderer directly, so the window works whether the pet window is open,
//     closed, or running in the app.
//
// ONE RULE OUTRANKS THE REST: nothing is written before a host snapshot has been adopted (see
// `hasSnapshot`). The whole object is written on every edit, so a page that booted into defaults and then
// wrote would replace everything the user configured.
(function () {
  'use strict';

  var core = globalThis.__VRMPET3D_CORE__;
  if (!core) {
    // Not a throw: a thrown error here leaves the page saying '正在读取…' for ever, which is the least
    // useful thing a settings page can do. Say it on screen instead.
    var stuck = document.getElementById('status');
    if (stuck) {
      stuck.textContent = '初始化失败：lib/core.js 没有加载（/vrmpet3d/window/lib/core.js）。';
      stuck.className = 'warn';
    }
    return;
  }
  var STORE = core.STORAGE_KEY;

  function element(id) {
    return document.getElementById(id);
  }

  /**
   * WHICH of the two pages this is: the `<body data-page>` the markup declares.
   *
   * Declared by the page rather than derived from which controls exist, so the published readout can be
   * compared against the file the host served. `'model'` is the answer for markup that declares nothing,
   * because the model page is the older of the two and is what any other page of this plugin would be
   * trying to be.
   */
  function pageName() {
    var declared = document.body && document.body.getAttribute ? document.body.getAttribute('data-page') : null;
    return declared === 'global' ? 'global' : 'model';
  }

  /**
   * The local cache of the settings, under the CURRENT key or one this project used before it was renamed.
   *
   * The cache is not the authority — the HOST's snapshot is — but a page that reads nothing here boots into
   * defaults, and `persist()` writes the whole object back, so reading the old name is what keeps a pre-rename
   * profile from being replaced by defaults on the first edit. Every write goes to `STORE` (the current name).
   */
  function readPreferences() {
    try {
      var stored = typeof core.storedPreferences === 'function'
        ? core.storedPreferences(globalThis.localStorage)
        : { raw: globalThis.localStorage.getItem(STORE) };
      var raw = stored ? stored.raw : null;
      return core.cleanPreferences(raw ? JSON.parse(raw) : {});
    } catch (_error) {
      return core.cleanPreferences({});
    }
  }

  var preferences = readPreferences();

  /**
   * The model named in the URL, if any: `/vrmpet3d/config?model=<id>`.
   *
   * The host puts the model the pet is actually showing in the URL, because a fresh profile has no
   * stored preference and this page is about THAT model — opening it on the placeholder while a VRM is
   * on screen would show two empty tables and look broken. It is only a FALLBACK: a stored choice wins,
   * so opening the window never silently switches the pet's model.
   */
  /**
   * The model this page is configuring.
   *
   * NOT `preferences.modelId`, and that distinction is the bug this whole round is about. A spring
   * override is stored per model id and resolved per model id, and the pet on screen is not necessarily
   * the id storage happens to hold: the floating window is launched with the model the host decided, and
   * a fresh profile has no modelId at all. So the page asks what is actually being shown (the host's
   * `live` report, or the model in its own URL) and keys the overrides by THAT.
   *
   * A stale key is invisible in the UI and does nothing at all in the renderer, which is exactly how the
   * spring sliders were reported as having no effect.
   */
  var editingModelId = null;
  var hostSync = null;
  var lastPushed = null;
  var live = { app: null, window: null, appliedGaze: null };

  /**
   * THE DATA-LOSS LATCH: not one byte is written anywhere until a host snapshot has been adopted.
   *
   * This is the guard for the accident of 2026-10-11, and the reason it is a latch rather than a comment.
   * The page keeps the WHOLE preferences object in memory and writes it back on every change. If the page
   * fails before it adopts the host's snapshot — a thrown boot error, an element the markup no longer has —
   * then `preferences` is still `core.cleanPreferences({})`, i.e. DEFAULTS, and the first patch that leaves
   * this page is those defaults written over everything the user ever configured. The store file is
   * rewritten by the HOST when the patch arrives, so the damage is on disk: this is the one failure in
   * this plugin that loses data rather than a window.
   *
   * `false` until `adoptSnapshot` (or `onUnsupported`, where there is no store to overwrite) has run once.
   * Every write path in this file goes through `persist`, and `persist` returns early while it is false —
   * so a page that failed to boot cannot reach a write at all: `publish()` still reports, the controls
   * still render, and nothing is sent to the store.
   */
  var hasSnapshot = false;

  var urlModel = null;
  try {
    urlModel = new URL(globalThis.location.href).searchParams.get('model');
  } catch (_error) {
    urlModel = null;
  }
  /**
   * The model in the URL is a PROVISIONAL choice, and this flag says so.
   *
   * A model window is opened about the model a surface is SHOWING (`/vrmpet3d/config?model=<id>`), which on a
   * fresh profile is the only thing that knows it. It is adopted here so the page fetches the right model
   * before any snapshot lands — but it is NOT written to the store yet: that write waits for
   * `adoptSnapshot`, which prefers what the store says (a stale URL must not switch the pet), and pushes
   * this only when the store has no answer of its own. Before the latch this write happened during boot,
   * i.e. exactly the defaults-over-everything patch the latch exists to stop.
   */
  var urlModelProvisional = false;
  if (urlModel && (!preferences.modelId || preferences.modelId === core.DEFAULTS.modelId)) {
    preferences.modelId = urlModel;
    urlModelProvisional = true;
  }

  /**
   * Remember the edit: locally as a cache, and in the HOST, which is the copy every surface reads.
   *
   * Only the top-level keys that changed are sent. The host merges top-level keys, so sending the whole
   * object would let this page's snapshot of `springs` (taken before somebody else moved a slider) undo
   * their edit.
   *
   * REFUSED before the first host snapshot — this is the data-loss latch (see `hasSnapshot`). Both halves
   * of the write are behind it, the local cache included: a page that booted into defaults must not cache
   * them either, or the next load would start from the defaults it had just poisoned itself with.
   */
  function persist() {
    if (!hasSnapshot) return;
    try {
      globalThis.localStorage.setItem(STORE, JSON.stringify(preferences));
    } catch (error) {
      setStatus('写入设置失败：' + (error && error.message));
    }
    if (!hostSync) return;
    var patch = {};
    var previous = lastPushed || {};
    Object.keys(preferences).forEach(function (key) {
      if (JSON.stringify(preferences[key]) !== JSON.stringify(previous[key])) patch[key] = preferences[key];
    });
    if (!Object.keys(patch).length) return;
    lastPushed = JSON.parse(JSON.stringify(preferences));
    hostSync.push({ preferences: patch });
  }

  /**
   * Whether the first render is still pending — see `setLoading`.
   *
   * The markup ships `data-loading="true"` (a settings page has no data of its own), so this starts true and only
   * ever moves one way. Operator, 2026-10-14: 「给通用设置和模型参数设置面板加上"加载中"的提示，以免用户看着一个dummy界面干等着」.
   */
  var loading = true;

  /**
   * Show or clear the 加载中 cover, and dim the form while it is up.
   *
   * Three things clear it, and all three matter: the first successful render (the normal path), every load
   * failure (so a broken host does not spin forever — `setStatus` carries the reason), and a watchdog for a fetch
   * that neither resolves nor rejects. A spinner that never stops is worse than the dummy it replaced, which is
   * the whole reason this exists.
   */
  function setLoading(done) {
    if (!done) {
      loading = true;
      if (document.body) document.body.setAttribute('data-loading', 'true');
      return;
    }
    if (!loading) return;
    loading = false;
    if (document.body) document.body.removeAttribute('data-loading');
  }

  // A fetch that hangs must not leave the cover up: 8 s is longer than any of these reads takes on a warm host.
  globalThis.setTimeout(function () {
    if (!loading) return;
    setLoading(true);
    setStatus('读取设置超时：宿主没有在 8 秒内回应（其余功能仍可手动重试）。', 'warn');
  }, 8000);

  function setStatus(text, kind) {
    var node = element('status');
    if (!node) return;
    node.textContent = text;
    node.className = kind === 'warn' ? 'warn' : '';
  }

  // ---------------------------------------------------------------------------
  // The model list, the licence, and what the model contains
  // ---------------------------------------------------------------------------
  var catalog = [];
  var modelInfo = null;

  /**
   * The model this page is configuring: the id from the catalog, or EMPTY for "resolve one".
   *
   * `'placeholder'` used to be the answer here, and it is not a model any more — the built-in procedural avatar
   * was removed on 2026-10-10, and the shipped default is now a bundled file (`BlueFatFish.vrm` since 2026-10-13).
   * Empty means "ask
   * `core.resolveModelId`", which is what both pet surfaces do as well, so this page cannot end up configuring an
   * id that draws nothing.
   */
  function modelIdInUse() {
    return preferences.modelId || '';
  }

  /**
   * The model to configure: THE model, because there is only one.
   *
   * Both surfaces draw the same model out of the same setting, so this page cannot configure a model nobody
   * is showing and a spring override cannot end up under a key the renderer never reads. What it does have to
   * handle is a profile that has never chosen one: then it adopts what a surface is actually drawing (the host
   * reports it) — and failing that, it resolves one from the catalog exactly as the surfaces do.
   *
   * It does NOT write. Every branch here only fills `preferences.modelId` so the page describes the right model;
   * the write belongs to the snapshot handler (`adoptSnapshot`), which is the first moment this page knows what
   * the store holds and therefore the first moment at which writing is not a guess.
   */
  function chooseEditingModel() {
    if (preferences.modelId) return preferences.modelId;
    /**
     * What a surface is actually drawing — but `'placeholder'` is not a model any more.
     *
     * A client half from before 2026-10-10 still reports `'placeholder'` as its live model (it is the OLD default),
     * and adopting that verbatim made this page configure an id that no longer exists: measured on a fresh profile
     * as `supported=false, expressions=0, springs=0` with an empty pill, because the picker fell back to showing
     * its first option while the page was describing a phantom. So the value is skipped, and the catalog decides.
     */
    var candidates = [urlModel, live.app, live.window];
    for (var i = 0; i < candidates.length; i += 1) {
      var candidate = candidates[i];
      if (typeof candidate === 'string' && candidate && candidate !== 'placeholder') {
        preferences.modelId = candidate;
        return preferences.modelId;
      }
    }
    // Nothing real chose one: resolve against the catalog, so a fresh profile opens on the bundled default
    // rather than on an empty stage. This runs again AFTER the catalog arrives (see `begin`), because before
    // that there is nothing to resolve against.
    var fallback = core.resolveModelId && catalog.length ? core.resolveModelId(catalog, '') : '';
    if (fallback) preferences.modelId = fallback;
    return fallback;
  }

  /**
   * Does THIS page name the model's own vocabulary anywhere?
   *
   * The two pages run one script and it asks this question instead of assuming, because assuming is what broke the
   * 状态与动作 section: `loadModelInfo` used to bail out unless the MODEL PICKER was in the document, on the reasoning
   * that "nothing on the 通用设置 page describes a model". That was true when the only expression names on screen were
   * the model page's emotion table — and it stopped being true when the 动作 section grew a per-clip 表情 and 口型
   * dropdown, because those options ARE the model's expression list. The symptom is the operator's report
   * (2026-10-13): 「状态与动作中，每个动作的表情和口型设置始终是空的，必须动态从模型上加载」 — a select with only its
   * "跟随" entry, on a page that never asked what the model can do.
   *
   * `motion-list` is the marker for the 通用设置 page for the same reason `model-select` is the marker for the 模型参数
   * page: it is the container those two dropdowns are built into (`clipFaceSelect`).
   */
  function needsModelVocabulary() {
    return Boolean(element('model-select') || element('motion-list'));
  }

  function loadCatalog() {
    /**
     * The catalog is fetched wherever the page might have to NAME a model.
     *
     * The 模型参数 page has the picker; the 通用设置 page has no picker but does need a model id to ask about — for the
     * per-clip 表情/口型 options — and `chooseEditingModel` resolves one from the catalog when nothing is live yet. So
     * it is the same predicate as `loadModelInfo`'s, not "is the picker here".
     */
    if (!needsModelVocabulary()) return Promise.resolve(null);
    return fetch('/vrmpet3d/catalog', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) {
        catalog = body && Array.isArray(body.models) ? body.models : [];
        var select = element('model-select');
        if (!select) return;
        while (select.firstChild) select.removeChild(select.firstChild);
        /**
         * The catalog, and NOTHING else.
         *
         * This used to prepend `{ id: 'placeholder', name: '占位模型（内置）' }` — the only way to reach the
         * procedural avatar. Once that avatar was removed the entry became a model that draws NOTHING: picking it
         * emptied the stage, which is exactly what "为什么会有一个全空的占位模型?" was looking at. The bundled
         * models are in the catalog now, so a fresh profile opens on a real model.
         */
        catalog.forEach(function (model) {
          if (!model || typeof model.id !== 'string' || model.id === 'placeholder') return;
          var option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name || model.id;
          select.appendChild(option);
        });
        select.value = modelIdInUse();
      })
      .catch(function () {
        // A failure is an ANSWER: the cover comes off so the reason in `#status` can be read, and nothing spins on.
        setLoading(true);
        setStatus('未能读取模型列表：宿主没有提供 /vrmpet3d/catalog', 'warn');
      });
  }

  /**
   * 模型导入: the imported model directories, over `/vrmpet3d/models`.
   *
   * The BACKEND was finished and tested long before this UI existed: a plugin-owned list file, an `add`/`remove`
   * route that refuses paths that are not directories, and a catalog rebuilt on every request so an import is
   * live without a restart. What was missing is what a user actually needs — a way to add a folder, and a list
   * of what is already imported — and that is all this section is.
   *
   * The native picker is asked of the LAUNCHER (`vrmpet3dDesktop.pickModelFile`), because a web page cannot open a
   * dialog and this page has no filesystem access by design. The chosen path comes back here and is handed to
   * the HOST over HTTP, which COPIES the file into the plugin's own storage and stays the single writer of every
   * import store — the one thing the suites depend on, since they redirect those files with `VRMPET3D_*_FILE`. A
   * typed path is the fallback when there is no launcher bridge (the page opened as a browser tab).
   *
   * A DIRECTORY imported by an older build is still LISTED and still removable; no new one can be added here.
   */
  var imported = { models: [], dirs: [], modelCount: 0, catalogFile: null, error: null };

  /** One row of the imported list: a label, the path, and the button that takes it back out. */
  function importedRow(label, value, title, onRemove, legacy) {
    var row = document.createElement('div');
    row.className = 'row';
    var key = document.createElement('span');
    key.className = 'k';
    key.textContent = label;
    var text = document.createElement('span');
    text.className = 'grow note';
    text.textContent = value;
    text.title = title || value;
    var remove = document.createElement('button');
    remove.className = 'ghost model-import-remove' + (legacy ? ' legacy' : '');
    remove.textContent = '移除';
    remove.addEventListener('click', function () { onRemove(); });
    row.appendChild(key);
    row.appendChild(text);
    row.appendChild(remove);
    return row;
  }

  function renderImported() {
    var list = element('model-import-list');
    var note = element('model-import-note');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    imported.models.forEach(function (entry) {
      // The SOURCE is what the user recognises ("the one I picked out of my Downloads"), while the copy's own path
      // is what gets removed — so the row shows the former and acts on the latter.
      list.appendChild(importedRow('已导入', entry.name, entry.source || entry.file,
        function () { removeImported(entry.file); }));
    });
    imported.dirs.forEach(function (dir) {
      list.appendChild(importedRow('旧版目录', dir, dir, function () { removeImportedDir(dir); }, true));
    });
    if (!note) return;
    if (imported.error) {
      note.className = 'hint warn';
      note.textContent = imported.error;
      return;
    }
    note.className = 'hint';
    var total = imported.models.length + imported.dirs.length;
    note.textContent = total
      ? '已导入 ' + imported.models.length + ' 个模型文件'
        + (imported.dirs.length ? '、' + imported.dirs.length + ' 个旧版目录' : '')
        + '，当前模型列表里有 ' + imported.modelCount + ' 个模型。'
      : '当前模型列表里只有插件自带的模型。';
  }

  function loadImported() {
    return fetch('/vrmpet3d/models', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) {
        imported.models = body && Array.isArray(body.importedModels) ? body.importedModels : [];
        imported.dirs = body && Array.isArray(body.importedDirs) ? body.importedDirs : [];
        imported.modelCount = body && Number.isFinite(Number(body.modelCount)) ? Number(body.modelCount) : 0;
        imported.catalogFile = body && body.catalogFile ? body.catalogFile : null;
        imported.error = body ? null : '宿主没有提供 /vrmpet3d/models，模型导入在这个版本里不可用。';
        renderImported();
        return imported;
      })
      .catch(function () {
        imported.error = '读取已导入模型失败：宿主没有提供 /vrmpet3d/models。';
        renderImported();
        return imported;
      });
  }

  /**
   * One write to the host. `{addFile}` / `{removeFile}` are the route's current vocabulary (`{add}` / `{remove}` a
   * DIRECTORY are the older pair, still used to drop a legacy entry), and a refused file comes back as a 400 whose
   * text is the most useful thing to show — it names what was wrong with the path.
   */
  function writeImported(body) {
    return fetch('/vrmpet3d/models', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          imported.error = text || ('导入失败（HTTP ' + response.status + '）');
          renderImported();
          return null;
        });
      }
      return response.json().then(function (payload) {
        imported.models = Array.isArray(payload.importedModels) ? payload.importedModels : imported.models;
        imported.dirs = Array.isArray(payload.importedDirs) ? payload.importedDirs : imported.dirs;
        imported.modelCount = Number(payload.modelCount) || 0;
        imported.error = payload.persisted === false
          ? '导入已生效，但没能写入清单文件（' + (payload.persistError || '未知原因') + '），重启后会丢失。'
          : null;
        renderImported();
        // The catalog is rebuilt on every request, so the model picker picks the new models up immediately.
        return loadCatalog();
      });
    }).catch(function () {
      imported.error = '写入失败：宿主没有提供 /vrmpet3d/models。';
      renderImported();
      return null;
    });
  }

  /** Import one model FILE: the host copies it into its own storage and records where it came from. */
  function addImported(file) {
    var path = typeof file === 'string' ? file.trim() : '';
    if (!path) return Promise.resolve(null);
    return writeImported({ addFile: path });
  }

  /** Remove the plugin's COPY of an imported model. The user's original file is never touched. */
  function removeImported(file) {
    return writeImported({ removeFile: file });
  }

  /** Remove a legacy imported DIRECTORY from the list. Nothing on disk is deleted — the entry is a reference. */
  function removeImportedDir(dir) {
    return writeImported({ remove: dir });
  }

  function bindImportControls() {
    var pick = element('model-import-pick');
    var manual = element('model-import-manual');
    var manualRow = element('model-import-manual-row');
    var pathInput = element('model-import-path');
    var add = element('model-import-add');
    var bridge = globalThis.vrmpet3dDesktop;

    if (pick) {
      pick.addEventListener('click', function () {
        var picker = bridge && typeof bridge.pickModelFile === 'function' ? bridge.pickModelFile : null;
        if (!picker) {
          // No launcher bridge: the typed path IS the import UI, so reveal it rather than failing silently.
          if (manualRow) manualRow.hidden = false;
          imported.error = '这个窗口没有文件选择器（不是在 DSH 桌面版里打开的），请在下面直接输入模型文件的路径。';
          renderImported();
          return;
        }
        Promise.resolve(picker()).then(function (chosen) { return addImported(chosen); });
      });
    }
    if (manual && manualRow) {
      manual.addEventListener('click', function () {
        manualRow.hidden = !manualRow.hidden;
        if (!manualRow.hidden && pathInput) pathInput.focus();
      });
    }
    if (add && pathInput) {
      add.addEventListener('click', function () {
        addImported(pathInput.value).then(function () { pathInput.value = ''; });
      });
      pathInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') addImported(pathInput.value).then(function () { pathInput.value = ''; });
      });
    }
  }

  /**
   * 动作导入: the imported MOTION directories, over `/vrmpet3d/motions`.
   *
   * The same shape as 模型导入 above, and for the same reason it exists at all: the backend (a plugin-owned list
   * file, an `add`/`remove` route with the same refusals, a catalog rebuilt per request) was finished and tested
   * long before any UI reached it. Until this section existed, the only way to add a motion directory was to edit
   * `motionDirs` in the profile's config or POST the route by hand — while the 状态 section's own note told the
   * user to "import that directory from the host" with nothing to click.
   *
   * The difference from the model section is what happens AFTER a write: the model catalog feeds a dropdown, so
   * re-fetching it is enough, whereas this catalog feeds the per-state clip checkboxes — so a successful import
   * takes the rebuilt catalog out of the reply (and re-reads it if the reply is from an older host), which is what
   * makes a freshly imported clip tickable without a reload.
   */
  var importedMotions = { imports: [], dirs: [], clips: 0, catalogFile: null, error: null };

  function renderImportedMotions() {
    var list = element('motion-import-list');
    var note = element('motion-import-note');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    // An import is a FOLDER the host COPIED (clips plus the folder's own manifest, tree preserved). The folder it
    // was picked from is not recorded, so moving it later cannot break the pack — the operator's reason for the
    // change: 「万一文件夹移位了，也会出bug」. A directory an older build imported is still listed, and removable.
    importedMotions.imports.forEach(function (entry) {
      list.appendChild(importedRow('已导入', entry.name + '（' + entry.clips + ' 支）', entry.source || entry.dir,
        function () { removeImportedMotion(entry.dir); }));
    });
    importedMotions.dirs.forEach(function (dir) {
      list.appendChild(importedRow('旧版目录', dir, dir, function () { removeLegacyMotionDir(dir); }, true));
    });
    if (!note) return;
    if (importedMotions.error) {
      note.className = 'hint warn';
      note.textContent = importedMotions.error;
      return;
    }
    note.className = 'hint';
    var total = importedMotions.imports.length + importedMotions.dirs.length;
    note.textContent = total
      ? '已导入 ' + importedMotions.imports.length + ' 个动作文件夹'
        + (importedMotions.dirs.length ? '、' + importedMotions.dirs.length + ' 个旧版目录' : '')
        + '，当前可选 ' + importedMotions.clips + ' 支动作。'
      : '当前只有插件自带的动作包。';
  }

  function loadImportedMotions() {
    return fetch('/vrmpet3d/motions', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (body) {
        importedMotions.imports = body && Array.isArray(body.importedMotions) ? body.importedMotions : [];
        importedMotions.dirs = body && Array.isArray(body.importedDirs) ? body.importedDirs : [];
        importedMotions.clips = body && Array.isArray(body.motions) ? body.motions.length : 0;
        importedMotions.catalogFile = body && body.catalogFile ? body.catalogFile : null;
        importedMotions.error = body ? null : '宿主没有提供 /vrmpet3d/motions，动作导入在这个版本里不可用。';
        renderImportedMotions();
        return importedMotions;
      })
      .catch(function () {
        importedMotions.error = '读取已导入动作失败：宿主没有提供 /vrmpet3d/motions。';
        renderImportedMotions();
        return importedMotions;
      });
  }

  /** One write to the host; the reply carries the rebuilt catalog, so the state rows refresh from it. */
  function writeImportedMotion(body) {
    return fetch('/vrmpet3d/motions', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          importedMotions.error = text || ('导入失败（HTTP ' + response.status + '）');
          renderImportedMotions();
          return null;
        });
      }
      return response.json().then(function (payload) {
        importedMotions.imports = Array.isArray(payload.importedMotions) ? payload.importedMotions : importedMotions.imports;
        importedMotions.dirs = Array.isArray(payload.importedDirs) ? payload.importedDirs : importedMotions.dirs;
        var motions = Array.isArray(payload.motions) ? payload.motions : null;
        if (motions) {
          motionCatalog = motions;
          // The folder map travels with every catalog reply, not only the GET, or an import would leave the
          // pickers unscoped until the next reload.
          motionStateFolders = payload.stateFolders && typeof payload.stateFolders === 'object'
            ? payload.stateFolders
            : {};
          renderMotions();
          importedMotions.clips = motions.length;
        }
        importedMotions.error = payload.persisted === false
          ? '导入已生效，但没能写入清单文件（' + (payload.persistError || '未知原因') + '），重启后会丢失。'
          : null;
        renderImportedMotions();
        return motions ? null : loadMotions();
      });
    }).catch(function () {
      importedMotions.error = '写入失败：宿主没有提供 /vrmpet3d/motions。';
      renderImportedMotions();
      return null;
    });
  }

  /** Import one motion FOLDER: the host copies its clips and manifest into its own storage. */
  function addImportedMotion(dir) {
    var path = typeof dir === 'string' ? dir.trim() : '';
    if (!path) return Promise.resolve(null);
    return writeImportedMotion({ importDir: path });
  }

  /** Remove the plugin's COPY of an imported motion folder. The user's original folder is never touched. */
  function removeImportedMotion(dir) {
    return writeImportedMotion({ unimportDir: dir });
  }

  /** Remove a legacy imported motion DIRECTORY from the list. Nothing on disk is deleted. */
  function removeLegacyMotionDir(dir) {
    return writeImportedMotion({ remove: dir });
  }

  function bindMotionImportControls() {
    var pick = element('motion-import-pick');
    var manual = element('motion-import-manual');
    var manualRow = element('motion-import-manual-row');
    var pathInput = element('motion-import-path');
    var add = element('motion-import-add');
    var bridge = globalThis.vrmpet3dDesktop;

    if (pick) {
      pick.addEventListener('click', function () {
        var picker = bridge && typeof bridge.pickMotionDir === 'function' ? bridge.pickMotionDir : null;
        if (!picker) {
          if (manualRow) manualRow.hidden = false;
          importedMotions.error = '这个窗口没有文件夹选择器（不是在 DSH 桌面版里打开的），请在下面直接输入动作文件夹的路径。';
          renderImportedMotions();
          return;
        }
        Promise.resolve(picker()).then(function (chosen) { return addImportedMotion(chosen); });
      });
    }
    if (manual && manualRow) {
      manual.addEventListener('click', function () {
        manualRow.hidden = !manualRow.hidden;
        if (!manualRow.hidden && pathInput) pathInput.focus();
      });
    }
    if (add && pathInput) {
      add.addEventListener('click', function () {
        addImportedMotion(pathInput.value).then(function () { pathInput.value = ''; });
      });
      pathInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') addImportedMotion(pathInput.value).then(function () { pathInput.value = ''; });
      });
    }
  }

  /**
   * The model id the `modelInfo` in hand describes, so a model switched from ANOTHER window is noticed here.
   *
   * `null` until an answer lands. Kept as an id rather than a boolean because the question is "is what I hold about
   * the model I am now describing?" — a page that asked once and never again left the 状态与动作 dropdowns listing the
   * PREVIOUS model's expressions after a switch.
   */
  var modelInfoId = null;

  /**
   * The read that is OUT right now, if any: `{ id, promise }`.
   *
   * Two callers ask for the same model within a boot — `begin` does, and so does the first snapshot — and without this
   * the page fetched the same description twice (measured: two `GET /vrmpet3d/model-info?m=m1` on one load). One read
   * per model, shared.
   */
  var modelInfoInFlight = null;

  function loadModelInfo() {
    /**
     * Fetched wherever the page names the model's vocabulary — see `needsModelVocabulary`.
     *
     * The model PICKER used to be the marker, which was invisible while both panels were one page and wrong the moment
     * they were two: the 通用设置 page builds the 动作 section's per-clip 表情/口型 dropdowns out of this answer, and
     * without the request they were empty for good (operator, 2026-10-13: 「必须动态从模型上加载」).
     */
    if (!needsModelVocabulary()) {
      modelInfo = null;
      modelInfoId = null;
      return Promise.resolve(null);
    }
    var id = modelIdInUse();
    // An empty id is "no model chosen", not a model: there is nothing to describe.
    if (!id) {
      modelInfo = null;
      modelInfoId = null;
      renderModel();
      renderSprings();
      // The motion rows are drawn either way — with no model they simply offer 跟随 and nothing else.
      renderMotions();
      return Promise.resolve(null);
    }
    // Already described: a snapshot that did not move the model must not re-fetch it (this page polls).
    if (id === modelInfoId) return Promise.resolve(modelInfo);
    // Already being described: share the read rather than asking twice for one boot.
    if (modelInfoInFlight && modelInfoInFlight.id === id) return modelInfoInFlight.promise;
    var settle = function () {
      if (modelInfoInFlight && modelInfoInFlight.id === id) modelInfoInFlight = null;
    };
    var promise = fetch('/vrmpet3d/model-info?m=' + encodeURIComponent(id), { credentials: 'omit' })
      .then(function (response) {
        if (response.status === 404) return null;
        return response.ok ? response.json() : null;
      })
      .then(function (body) {
        modelInfo = body;
        modelInfoId = id;
        renderModel();
        renderSprings();
        /**
         * AND the 动作 section, which is why this page asks at all now.
         *
         * Its per-clip 表情/口型 dropdowns are built from `expressionRows()`/`mouthNames()`, so they were drawn BEFORE
         * this answer arrived on a boot, and must be rebuilt after it — and again after every model switch.
         */
        renderMotions();
        publish();
        settle();
        return body;
      })
      .catch(function (error) {
        settle();
        // Same rule as the catalog's failure: the cover lifts so the reason is readable rather than covered.
        setLoading(true);
        setStatus('未能读取模型信息：' + (error && error.message), 'warn');
        return null;
      });
    modelInfoInFlight = { id: id, promise: promise };
    return promise;
  }

  function describeLicence(meta) {
    if (!meta) return '（文件里没有授权信息）';
    var parts = [];
    if (meta.name || meta.title) parts.push('名称：' + (meta.name || meta.title));
    if (meta.authors) parts.push('作者：' + (meta.authors || []).join('、'));
    if (meta.author) parts.push('作者：' + meta.author);
    if (meta.avatarPermission) parts.push('使用许可：' + meta.avatarPermission);
    if (meta.modification) parts.push('修改：' + meta.modification);
    if (meta.commercialUsage) parts.push('商用：' + meta.commercialUsage);
    if (meta.creditNotation) parts.push('署名：' + meta.creditNotation);
    if (meta.licenseUrl) parts.push('协议：' + meta.licenseUrl);
    return parts.length ? parts.join(' · ') : '（文件里没有授权信息）';
  }

  function renderModel() {
    var spec = element('model-spec');
    var meta = element('model-meta');
    if (!spec || !meta) return;
    if (!modelInfo) {
      /**
       * No model info at all — which is now "nothing is selected", not "the built-in avatar".
       *
       * The old text described the procedural avatar's limits (no expressions, no spring chains), and after that
       * avatar was removed (2026-10-10) it was describing a model that cannot be shown. This says the true thing
       * instead: pick one, or the pet has nothing to draw.
       */
      spec.textContent = '没有模型';
      spec.className = 'pill off';
      meta.textContent = '当前没有选择模型：宠物不会显示任何东西。上面选一个，设置会立刻生效。';
      return;
    }
    spec.textContent = modelInfo.supported ? (modelInfo.vrmSpec || 'VRM') : '非 VRM/GLB';
    spec.className = 'pill ' + (modelInfo.supported ? 'on' : 'off');
    var counts = modelInfo.counts || {};
    var summary = [];
    if (modelInfo.generator) summary.push(modelInfo.generator);
    summary.push((counts.meshes || 0) + ' 网格 / ' + (counts.materials || 0) + ' 材质 / ' + (counts.images || 0) + ' 贴图');
    if (typeof modelInfo.humanoid === 'object' && modelInfo.humanoid) summary.push(modelInfo.humanoid.count + ' 人形骨');
    if (modelInfo.lookAt && modelInfo.lookAt.type) summary.push('视线：' + modelInfo.lookAt.type);
    meta.textContent = describeLicence(modelInfo.meta) + ' — ' + summary.join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------------
  function expressionRows() {
    if (!modelInfo || !Array.isArray(modelInfo.expressions)) return [];
    return modelInfo.expressions.slice().sort(function (left, right) {
      // Presets first and in the order the VRM spec lists them; a custom expression goes last, since it
      // is the one a user has to be told about.
      var leftCustom = left.kind === 'vrm1:custom' || !left.presetName;
      var rightCustom = right.kind === 'vrm1:custom' || !right.presetName;
      if (leftCustom !== rightCustom) return leftCustom ? 1 : -1;
      return String(left.name).localeCompare(String(right.name));
    });
  }

  /**
   * The standalone expression/口型 weight table that used to live here is GONE (operator, 2026-10-09:
   * "设置面板关闭单独的口型设置").
   *
   * It listed every expression with a manual weight slider, which made the panel read as a mouth-shape editor
   * and duplicated a choice the 动作 section now owns per state and per clip: a clip can name the expression and
   * the mouth shape it plays with, and those are the settings a user actually makes. `expressionRows()` stays,
   * because the emotion table above still lists the model's own labels — it is the TABLE that went.
   */


  /** How a trigger row is titled. The LABELS below are UI words; the emotion names come from the model. */
  var TRIGGER_LABELS = { idle: '空闲', drag: '拖动时', click: '点击时', hold: '长按时' };

  /**
   * The body parts a press can land on, as the settings page says them, for the DEFAULT regions.
   *
   * A part is the user's own row now; these words only label the regions a structure falls into when nobody has
   * claimed it (`core.STRUCTURE_REGIONS`), which is what the 部位 table shows beside each structure. READ OUT OF
   * core rather than copied: the two tables drifting is how 大腿 would show up as `upperLeg` on a row the user is
   * looking at, and the region list itself already comes from there.
   */
  var PART_LABELS = core.DEFAULT_PART_LABELS || {};

  /**
   * Does this model expression answer to any of `names` — by its own LABEL, or by the PRESET key beside it?
   *
   * Both, because a file carries both and which one matches depends on the VRM version: 1.0 reports `name === presetName`
   * (`aa`), while 0.x reports a label (`A`, `Blink_L`) with a lowercase preset key (`a`, `blink_l`) — and the bundled
   * `SampleModel.vrm` is a 0.x file. Case-insensitively as well, since `A` and `a` are the same mouth to a person and
   * two exporters disagree about the spelling.
   */
  function expressionAnswersTo(expression, names) {
    var wanted = [];
    for (var i = 0; i < (names || []).length; i += 1) wanted.push(String(names[i]).toLowerCase());
    var spellings = [expression && expression.presetName, expression && expression.name];
    for (var j = 0; j < spellings.length; j += 1) {
      var word = typeof spellings[j] === 'string' ? spellings[j].toLowerCase() : '';
      if (word && wanted.indexOf(word) !== -1) return true;
    }
    return false;
  }

  /**
   * The expression labels the emotion rows may offer.
   *
   * The model's own, minus the ones another behaviour drives: `blink`, the mouth shapes and the gaze presets have
   * their own controls, and picking them as a mood would fight that control. One function because the 表情 table
   * and the 部位 table offer the SAME list — a part whose反应 could name an expression the table cannot would be a
   * control that writes a value nothing shows.
   */
  function emotionNames() {
    return expressionRows()
      .filter(function (expression) { return !expressionAnswersTo(expression, core.BEHAVIOUR_EXPRESSIONS); })
      .map(function (expression) { return expression.name; });
  }

  /** The structures the loaded model declares, for the 部位 picker; empty when no model has been described. */
  function modelStructures() {
    return modelInfo && Array.isArray(modelInfo.structures)
      ? modelInfo.structures.filter(function (entry) { return entry && typeof entry.name === 'string'; })
      : [];
  }

  /**
   * The emotion table: one row per situation, and the columns are the MODEL'S OWN expression labels.
   *
   * That is the whole point of the table. A mood vocabulary hardcoded here would name expressions the file
   * does not have (`sad` on a model that never declared it) while hiding the ones it does (a custom
   * `TiePen`), and the row would then be stored under a name nothing can show. The names offered are the
   * same strings `/vrmpet3d/model-info` reports, which are the same strings the renderer resolves.
   *
   * An empty selection means 'any this model can show', which is why a row can be left untouched: not every
   * user wants to enumerate expressions, and a model swapped in later should not need re-ticking.
   */
  function renderEmotionTriggers() {
    var body = element('emotion-body');
    if (!body) return;
    var restoreScroll = holdScroll();
    while (body.firstChild) body.removeChild(body.firstChild);

    var names = emotionNames();
    var emotion = preferences.expressions.emotion;

    core.EMOTION_TRIGGERS.forEach(function (trigger) {
      var tr = document.createElement('tr');
      var title = document.createElement('td');
      title.textContent = TRIGGER_LABELS[trigger] || trigger;
      tr.appendChild(title);
      appendEmotionCells(tr, body, names, {
        key: trigger,
        row: emotion.triggers[trigger],
        write: function (patch) { return core.setEmotionTrigger(preferences, trigger, patch); },
        read: function () { return preferences.expressions.emotion.triggers[trigger]; },
      });
      body.appendChild(tr);
    });
    restoreScroll();
  }

  /**
   * Keep the reader where they were across a repaint.
   *
   * A repaint empties its container first, and an empty `<tbody>` collapses the document: the browser clamps the
   * scroll position to the top and the rebuild cannot bring it back. That is the reported jump ("每次点击都会让页面
   * 返回到最上面一条"), and the dropdown removed it for expression ticks — but every OTHER change (a new structure, a
   * renamed part, a new part) still repaints, so the offset is saved and put back here instead.
   */
  function holdScroll() {
    var scroller = document.scrollingElement || document.documentElement;
    var top = scroller ? scroller.scrollTop : 0;
    return function restore() {
      if (scroller && top) scroller.scrollTop = top;
    };
  }

  /**
   * The one open expression menu, and the two ways it closes.
   *
   * One at a time because a table of rows offering twenty expressions each is a table of overlapping panels
   * otherwise; closing on an outside click and on Escape because a dropdown that only closes by clicking its own
   * button is a trap. Neither handler touches the table: the point of the dropdown is that a tick costs one label.
   */
  var openPickMenuNode = null;
  /**
   * The outside-click listener that belongs to the CURRENT menu, kept so it can be removed exactly.
   *
   * It used to remove itself only when it actually closed something, so a menu closed by its own trigger left its
   * listener behind — and that orphan's `wrap` was the OLD row, which made it treat a click inside the NEXT row's
   * menu as an outside click and close it. One reference, cleaned on every open and every close, is the whole fix.
   */
  var openPickMenuAway = null;

  function closePickMenu() {
    if (openPickMenuAway) {
      document.removeEventListener('pointerdown', openPickMenuAway, true);
      openPickMenuAway = null;
    }
    if (!openPickMenuNode) return;
    if (openPickMenuNode.parentNode) openPickMenuNode.parentNode.removeChild(openPickMenuNode);
    openPickMenuNode = null;
  }

  function openPickMenu(menu, wrap) {
    closePickMenu();
    openPickMenuNode = menu;
    // Deferred by a tick so the click that opened it does not immediately count as "outside".
    setTimeout(function () {
      // Closed, or replaced by another row's menu, before the timer ran: this listener would belong to neither.
      if (openPickMenuNode !== menu) return;
      openPickMenuAway = function (event) {
        if (openPickMenuNode && wrap.contains(event.target)) return;
        closePickMenu();
      };
      document.addEventListener('pointerdown', openPickMenuAway, true);
    }, 0);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closePickMenu();
  });

  /**
   * The emotion cells of one row: 使用, the expression picker, and 持续时间.
   *
   * Shared with the 部位 table, because a part carries the same kind of row and the two must not drift: a part
   * whose 反应 offers a different set of choices from a situation's would be a second implementation of the same
   * rules. The caller supplies the row it appends to (the 部位 table has cells of its own to the left and right)
   * and a `read` for re-reading the row after a write.
   */
  function appendEmotionCells(tr, body, names, spec) {
    var row = spec.row;
    if (!row) return;
    var key = spec.key;

    var onCell = document.createElement('td');
    var on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = row.enabled !== false;
    on.title = '关掉这一行，这个情境就不再触发情绪';
    on.addEventListener('change', function () {
      spec.write({ enabled: on.checked });
      persist();
    });
    onCell.appendChild(on);
    tr.appendChild(onCell);

    var listCell = document.createElement('td');
    if (!names.length) {
      listCell.className = 'note';
      listCell.textContent = '这个模型没有可用的表情';
    }
    /**
     * The expressions are a DROPDOWN multi-select, not a pile of checkboxes.
     *
     * Operator, 2026-10-11: "把所有的表情都用下拉框的多选列表，不要直接用checkbox堆积在一起". Twenty expressions
     * spread across a row made every row as tall as the list and the table impossible to read; one line per row plus
     * a scrollable menu is the same information in the space of a button.
     *
     * It is ALSO the fix for the jump: ticking a box used to call `rerender()`, which repaints the whole table —
     * and emptying a `<tbody>` momentarily collapses the document, so the browser clamped the scroll position to the
     * top and every click threw the user back to the first row. Here a tick writes the value and updates ONE
     * button's label, and the table is never touched.
     */
    if (names.length) {
      var wrap = document.createElement('span');
      wrap.className = 'pick-wrap';
      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'pick-select';
      trigger.setAttribute('data-trigger', key);
      /**
       * The 无 choice is the EMPTY list, and it is a real state rather than an "unset": the shipped default, so a
       * fresh profile has a still-faced pet. It used to mean "any emotion this model declares", which made a still
       * face impossible to ask for. Un-ticking the last label therefore goes back to 无 rather than showing a state
       * the settings cannot represent.
       */
      var summary = function () {
        return row.emotions.length ? row.emotions.join('、') : '无';
      };
      trigger.textContent = summary();
      trigger.title = row.emotions.length
        ? '已选 ' + row.emotions.length + ' 个表情；点开可多选'
        : '无：这一行不显示任何表情（默认）';
      var menu = null;
      var buildMenu = function () {
        var panel = document.createElement('div');
        panel.className = 'pick-menu';
        var none = document.createElement('label');
        none.className = 'pick';
        var noneBox = document.createElement('input');
        noneBox.type = 'checkbox';
        noneBox.checked = row.emotions.length === 0;
        noneBox.title = '不显示任何表情（这一行的默认）';
        noneBox.addEventListener('change', function () {
          if (!noneBox.checked) { noneBox.checked = true; return; }
          spec.write({ emotions: [] });
          persist();
          refresh();
        });
        none.appendChild(noneBox);
        none.appendChild(document.createTextNode('无'));
        panel.appendChild(none);
        names.forEach(function (name) {
          var label = document.createElement('label');
          label.className = 'pick';
          var box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = row.emotions.indexOf(name) !== -1;
          // The list is exactly what the user ticked: nothing is ticked by default, which is what 「无」 shows.
          box.addEventListener('change', function () {
            var ticked = names.filter(function (candidate) {
              var input = panel.querySelector('input[data-name="' + CSS.escape(candidate) + '"]');
              return input && input.checked;
            });
            // No more "all of them goes back to the empty list": the empty list means NONE, and collapsing a full
            // selection into it would turn "all" into "silent".
            spec.write({ emotions: ticked });
            persist();
            refresh();
          });
          box.setAttribute('data-name', name);
          label.appendChild(box);
          label.appendChild(document.createTextNode(name));
          panel.appendChild(label);
        });
        return panel;
      };
      /**
       * Re-read the row after a write and update the button — and, when the menu is open, its boxes.
       *
       * `row` is the object the whole table was built from, so it is re-read from the live preferences: the cleaner
       * may have dropped a name the model cannot show, and a button that kept claiming it would be lying.
       */
      var refresh = function () {
        var live = spec.read ? spec.read() : row;
        if (live && live.emotions) row = live;
        trigger.textContent = summary();
        // Only while it is really on screen: a menu closed by an outside click or by Escape is DETACHED, and its
        // boxes are rebuilt from the live row the next time it opens.
        if (menu && menu.parentNode) {
          var boxes = menu.querySelectorAll('input');
          for (var i = 0; i < boxes.length; i += 1) {
            var name = boxes[i].getAttribute('data-name');
            boxes[i].checked = name ? row.emotions.indexOf(name) !== -1 : row.emotions.length === 0;
          }
        }
      };
      /**
       * The trigger: open, or close if THIS row's menu is the one open.
       *
       * "Is it open" is asked of the DOM — `openPickMenuNode` and the wrap that holds it — and NOT of the `menu`
       * variable, which used to be the test and made the trigger dead for the rest of the page's life: closing
       * removes the node but leaves the closure's reference in place, so every later click took the "close" branch
       * (operator, 2026-10-11: "选中一个表情后，再点表情的下拉列表就无效了，必须刷新页面重新进"). The menu is
       * rebuilt on every open for the same reason: the boxes have to reflect the live row, not the row as it was when
       * the panel was first built.
       */
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        if (openPickMenuNode && wrap.contains(openPickMenuNode)) { closePickMenu(); return; }
        menu = buildMenu();
        wrap.appendChild(menu);
        openPickMenu(menu, wrap);
      });
      wrap.appendChild(trigger);
      listCell.appendChild(wrap);
    }
    tr.appendChild(listCell);

    var holdCell = document.createElement('td');
    var hold = document.createElement('input');
    hold.type = 'number';
    hold.min = '0';
    hold.max = '30';
    hold.step = '0.5';
    hold.value = String(row.holdSeconds);
    hold.title = '0 = 一直保持到下一次变化';
    var unit = document.createElement('span');
    unit.className = 'note';
    unit.textContent = ' 秒' + (row.holdSeconds === 0 ? '（保持）' : '');
    hold.addEventListener('change', function () {
      spec.write({ holdSeconds: hold.value });
      persist();
      // The duration only changes its own unit text, so the row is re-read rather than the table repainted: the
      // same reason the expression menu updates a label instead of calling back into the renderer.
      var live = spec.read ? spec.read() : row;
      if (live) row = live;
      unit.textContent = ' 秒' + (row.holdSeconds === 0 ? '（保持）' : '');
    });
    holdCell.appendChild(hold);
    holdCell.appendChild(unit);
    tr.appendChild(holdCell);
  }

  /**
   * The 部位 table: the user's own parts, one block each.
   *
   * A part is a LABEL the user writes, the STRUCTURES it owns, an emotion row and a 碎碎念 box. That is why this
   * is not the 表情 table with more rows: a structure is chosen from what the MODEL actually calls things, and the
   * names a default region cannot place (`LiuHai`, `DaiMao`, `WeiBa` on the operator's 蓝色小肥鱼) are exactly the
   * ones a user builds a part for. Each part therefore gets a row of controls and a detail row underneath it for
   * the box and the prompt — a textarea in a table cell would make every row as tall as the longest line.
   */
  function renderParts() {
    var body = element('part-body');
    if (!body) return;
    var restoreScroll = holdScroll();
    while (body.firstChild) body.removeChild(body.firstChild);
    var count = element('part-count');
    if (count) count.textContent = preferences.parts.items.length + ' / ' + core.PARTS_LIMITS.maxItems;
    var names = emotionNames();

    preferences.parts.items.forEach(function (item, index) {
      var tr = document.createElement('tr');

      var labelCell = document.createElement('td');
      var label = document.createElement('input');
      label.type = 'text';
      label.className = 'part-label';
      label.value = item.label;
      label.maxLength = core.PARTS_LIMITS.maxLabelLength;
      label.title = '这只宠物对这个部位的说法，随便取';
      label.addEventListener('change', function () {
        core.setPartItem(preferences, item.id, { label: label.value });
        persist();
        renderParts();
      });
      labelCell.appendChild(label);
      if (item.region) {
        var regionNote = document.createElement('span');
        regionNote.className = 'note';
        regionNote.textContent = ' 默认 ' + (PART_LABELS[item.region] || item.region);
        labelCell.appendChild(regionNote);
      }
      tr.appendChild(labelCell);

      appendEmotionCells(tr, body, names, {
        key: item.id,
        row: item.emotion,
        write: function (patch) { return core.setPartEmotion(preferences, item.id, patch); },
        read: function () {
          var live = core.partItemById(preferences, item.id);
          return live ? live.emotion : null;
        },
      });

      var matchCell = document.createElement('td');
      matchCell.className = 'part-match';
      renderMatchChips(matchCell, item, index);
      tr.appendChild(matchCell);

      var removeCell = document.createElement('td');
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'part-remove';
      remove.textContent = '删除';
      remove.title = '删掉这个部位：它的结构会回落到按名字判断的默认部位';
      remove.addEventListener('click', function () {
        core.removePartItem(preferences, item.id);
        persist();
        renderParts();
      });
      removeCell.appendChild(remove);
      tr.appendChild(removeCell);
      body.appendChild(tr);

      // The detail row: the 碎碎念 box and the prompt, which are what this part SAYS.
      var detail = document.createElement('tr');
      detail.className = 'part-detail';
      var detailCell = document.createElement('td');
      detailCell.colSpan = 6;
      var lines = document.createElement('textarea');
      lines.className = 'part-lines';
      lines.rows = 2;
      /**
       * ONE grey hint for every part here too — and it still follows the SOURCE, which is not a part's business.
       *
       * 胸部 and 屁股 have SHIPPED lines, and their boxes stay empty — a default is not text the user is treated as
       * having written (operator, 2026-10-12: "匹配词和AI提示词写进系统底层，AI提示词那里默认留空，跟未输入状态一样，
       * 如果输入了，则以输入的为准"), and those lines still SAY themselves when the box is empty.
       *
       * What changed (2026-10-13) is only the ANNOUNCEMENT: this box used to spell the shipped lines out
       * (「碎碎念：留空则说内置的 变态！/ 大色狼！」), which is the same defect the AI prompt box had — one part's row
       * looking different from the other nine (「碎碎念框那行也变成通用灰字」). The two generic wordings stay, because
       * they are about the MODE rather than the part: under 内置短语 the shipped lines ARE the source, and under AI
       * or 自定义 they are switched off for the pet as well (`core.partSpeechLines(item, false)`, the expression
       * `SpeechMachine.react` and the floating window pass), so the box is then a fallback for while the model
       * writes. Whichever wording applies, EVERY part shows it.
       */
      var partSource = core.cleanSpeech(preferences.speech).source;
      lines.placeholder = partSource === 'ai'
        ? '碎碎念：一行一句；留空则由 AI 按这个部位的提示词生成'
        : '碎碎念：一行一句，摸到这个部位时随机说一句';
      lines.value = item.speech.lines.join('\n');
      lines.addEventListener('change', function () {
        core.setPartItem(preferences, item.id, { speech: { lines: lines.value } });
        persist();
        renderParts();
      });
      var prompt = document.createElement('input');
      prompt.type = 'text';
      prompt.className = 'part-prompt';
      /**
       * ONE grey hint, for every part — shipped prompt or not.
       *
       * 胸部 and 屁股 have a shipped INSTRUCTION, and this box used to spell it out in its placeholder
       * (「留空则用内置的「被主人摸到胸部了…」」). The operator removed that (2026-10-13: 「胸部和屁股的AI提示词，默认状态
       * 下尽管有内置提示词，但是也应该是和其他部位的默认灰色字体提示一样」): the shipped prompt is an instruction the HOST
       * sends the model — system-level, not something the user wrote or needs to read in a text field — so it acts
       * when the box is empty without being announced in it.
       *
       * The 碎碎念 box above follows the same rule since the operator asked for it too (「碎碎念框那行也变成通用灰字」):
       * ONE hint per source, for every part. Both shipped strings still ACT when a box is empty, and `builtinSpeech`
       * in the published state still carries them — what is gone is only the announcement in the field.
       */
      prompt.placeholder = 'AI 提示词：切到「AI 碎碎念」时用它生成这个部位的一句话';
      prompt.value = item.speech.prompt;
      prompt.maxLength = core.SPEECH_LIMITS ? core.SPEECH_LIMITS.maxPrompt : 300;
      prompt.addEventListener('change', function () {
        core.setPartItem(preferences, item.id, { speech: { prompt: prompt.value } });
        persist();
      });
      detailCell.appendChild(lines);
      detailCell.appendChild(prompt);
      detail.appendChild(detailCell);
      body.appendChild(detail);
    });

    // The browser's own list, redrawn with the table: every add repaints every row, so a panel left open has to
    // be repainted too or it would show the structures the part had a moment ago.
    renderStructurePicker();
    // An open expression menu belongs to a row that has just been replaced: it is dropped rather than left
    // floating over a table it no longer describes.
    closePickMenu();
    restoreScroll();
  }

  /** One part's structures: a chip each, with its match mode and a way to remove it, and a box to add one. */
  function renderMatchChips(cell, item, index) {
    item.match.forEach(function (entry) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.appendChild(document.createTextNode(entry.name));
      var mode = document.createElement('button');
      mode.type = 'button';
      mode.className = 'chip-mode';
      mode.textContent = entry.exact ? '精确' : '前缀';
      mode.title = entry.exact
        ? '只匹配这个名字本身；点一下变成前缀匹配'
        : '匹配这个名字和它下面的一切（LiuHai.L.002 也算）；点一下变成只匹配它本身';
      mode.addEventListener('click', function () {
        var next = item.match.map(function (candidate) {
          return candidate.name === entry.name && candidate.exact === entry.exact
            ? { name: candidate.name, exact: !candidate.exact }
            : candidate;
        });
        core.setPartItem(preferences, item.id, { match: next });
        persist();
        renderParts();
      });
      var drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'chip-drop';
      drop.textContent = '×';
      drop.title = '不再让这个部位拥有这个结构';
      drop.addEventListener('click', function () {
        var next = item.match.filter(function (candidate) {
          return !(candidate.name === entry.name && candidate.exact === entry.exact);
        });
        core.setPartItem(preferences, item.id, { match: next });
        persist();
        renderParts();
      });
      chip.appendChild(mode);
      chip.appendChild(drop);
      // What the NAME alone would say, so a user can see why a structure needs a part at all: `未识别` here is
      // the honest answer for 刘海/呆毛/尾巴, and the reason this row exists.
      var region = core.structureRegionOf(entry.name);
      var hint = document.createElement('span');
      hint.className = 'note';
      hint.textContent = ' ' + (region ? (PART_LABELS[region] || region) : '未识别');
      chip.appendChild(hint);
      cell.appendChild(chip);
    });

    var add = document.createElement('input');
    add.type = 'text';
    add.className = 'part-add-structure';
    add.placeholder = '结构名，回车添加';
    add.title = '直接输入模型里的结构名，回车添加';
    var commit = function () {
      var name = add.value.trim();
      if (!name) return;
      addStructureToPart(item, name);
      add.value = '';
    };
    add.addEventListener('change', commit);
    add.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
    });
    cell.appendChild(add);

    /**
     * And a BROWSER, because the model has hundreds of names and nobody types them from memory.
     *
     * This replaced a native `<input list=…>` + `<datalist>`: in the settings window that popup could not be
     * scrolled and showed no scrollbar (operator, 2026-10-11), which made the last ~150 of 160 structures
     * unreachable. A panel this page draws itself is bounded, scrollable, filterable, and — not incidentally —
     * assertable from a suite, which a browser-internal popup is not.
     */
    var browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'part-browse';
    browse.textContent = '浏览…';
    browse.title = '浏览这个模型的所有结构名（可筛选）';
    browse.addEventListener('click', function () { openStructurePicker(item.id); });
    cell.appendChild(browse);
  }

  /** Add one structure to a part, if it is not already owned in the same mode. */
  function addStructureToPart(item, name) {
    var next = item.match.slice();
    var exists = next.some(function (candidate) { return candidate.name === name && candidate.exact === false; });
    if (!exists) next.push({ name: name, exact: false });
    core.setPartItem(preferences, item.id, { match: next });
    persist();
    renderParts();
  }

  /**
   * The structure browser: which part it is adding to, what is typed in the filter, and what it lists.
   *
   * Kept in module state rather than in the DOM so a repaint (every add repaints the table) reopens the panel on
   * the same part with the same filter — the alternative is a panel that closes itself every time the user picks
   * something, which is exactly when they want it to stay.
   */
  var pickerPartId = null;
  var pickerFilter = '';

  function openStructurePicker(partId) {
    pickerPartId = partId || null;
    pickerFilter = '';
    var filter = element('part-picker-filter');
    if (filter) filter.value = '';
    renderStructurePicker();
    if (filter) filter.focus();
  }

  function closeStructurePicker() {
    pickerPartId = null;
    renderStructurePicker();
  }

  /**
   * Draw the panel: the model's structures, filtered, as clickable rows.
   *
   * Scrollability is a FEATURE here, not a styling detail: the operator's report was that the list could not be
   * scrolled, so the list is a bounded box with `overflow-y: auto` and a scrollbar styled to be always visible (a
   * Chromium overlay scrollbar hides itself until hovered, which reads as "no scrollbar" in a small window).
   */
  function renderStructurePicker() {
    var panel = element('part-picker');
    if (!panel) return;
    var list = element('part-picker-list');
    var count = element('part-picker-count');
    if (!pickerPartId || !list) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    while (list.firstChild) list.removeChild(list.firstChild);
    var item = core.partItemById(preferences, pickerPartId);
    var needle = pickerFilter.trim().toLowerCase();
    var structures = modelStructures().filter(function (entry) {
      return !needle || entry.name.toLowerCase().indexOf(needle) !== -1;
    });
    structures.forEach(function (entry) {
      var region = core.structureRegionOf(entry.name);
      var owned = item && item.match.some(function (candidate) { return candidate.name === entry.name; });
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'part-picker-row' + (owned ? ' owned' : '');
      row.setAttribute('data-structure', entry.name);
      var name = document.createElement('span');
      name.className = 'part-picker-name';
      name.textContent = entry.name;
      var meta = document.createElement('span');
      meta.className = 'note';
      meta.textContent = (region ? (PART_LABELS[region] || region) : '未识别') + ' · ' + entry.kind
        + (owned ? ' · 已加入' : '');
      row.appendChild(name);
      row.appendChild(meta);
      row.addEventListener('click', function () {
        if (item) {
          addStructureToPart(item, entry.name);
          // The panel stays open on purpose: adding one structure is rarely adding only one.
          renderStructurePicker();
        }
      });
      list.appendChild(row);
    });
    if (count) count.textContent = structures.length + ' / ' + modelStructures().length + ' 个结构';
  }

  function bindBehaviourControls() {
    var blinkEnabled = element('blink-enabled');
    var blinkMin = element('blink-min');
    var blinkMax = element('blink-max');
    var emotionEnabled = element('emotion-enabled');
    var idleMin = element('emotion-idle-min');
    var idleMax = element('emotion-idle-max');

    function applyBlink() {
      core.setExpressionBehaviour(preferences, 'blink', 'enabled', blinkEnabled.checked);
      core.setExpressionBehaviour(preferences, 'blink', 'minSeconds', blinkMin.value);
      core.setExpressionBehaviour(preferences, 'blink', 'maxSeconds', blinkMax.value);
      // The setter orders a crossed pair, so the inputs are re-read from what was stored.
      blinkMin.value = String(preferences.expressions.blink.minSeconds);
      blinkMax.value = String(preferences.expressions.blink.maxSeconds);
      persist();
    }

    function applyEmotion() {
      core.setExpressionBehaviour(preferences, 'emotion', 'enabled', emotionEnabled.checked);
      core.setExpressionBehaviour(preferences, 'emotion', 'idleMinSeconds', idleMin.value);
      core.setExpressionBehaviour(preferences, 'emotion', 'idleMaxSeconds', idleMax.value);
      idleMin.value = String(preferences.expressions.emotion.idleMinSeconds);
      idleMax.value = String(preferences.expressions.emotion.idleMaxSeconds);
      persist();
    }

    [blinkEnabled, blinkMin, blinkMax].forEach(function (node) {
      if (node) node.addEventListener('change', applyBlink);
    });
    [emotionEnabled, idleMin, idleMax].forEach(function (node) {
      if (node) node.addEventListener('change', applyEmotion);
    });
  }

  function renderBehaviour() {
    var blink = preferences.expressions.blink;
    var emotion = preferences.expressions.emotion;
    if (element('blink-enabled')) element('blink-enabled').checked = blink.enabled !== false;
    if (element('blink-min')) element('blink-min').value = String(blink.minSeconds);
    if (element('blink-max')) element('blink-max').value = String(blink.maxSeconds);
    if (element('emotion-enabled')) element('emotion-enabled').checked = emotion.enabled !== false;
    if (element('emotion-idle-min')) element('emotion-idle-min').value = String(emotion.idleMinSeconds);
    if (element('emotion-idle-max')) element('emotion-idle-max').value = String(emotion.idleMaxSeconds);
    renderEmotionTriggers();
  }

  /**
   * The 部位 section's own controls: the add button, and the maximum the core enforces.
   *
   * The button is DISABLED at the cap rather than silently refusing the click: a user who presses 新增部位 and
   * sees nothing happen has been told nothing, and the count in the heading already says where the limit is.
   */
  function bindParts() {
    var add = element('part-add');
    if (element('part-max')) element('part-max').textContent = String(core.PARTS_LIMITS.maxItems);
    if (add) {
      add.addEventListener('click', function () {
        core.addPartItem(preferences, '新部位');
        persist();
        renderParts();
      });
    }
    /**
     * The browser's own controls: the filter, and the way out.
     *
     * The filter re-draws the LIST only — not the table — so typing does not fight the caret: repainting the part
     * rows under a focused input is the one thing that makes a filter box unusable.
     */
    var filter = element('part-picker-filter');
    if (filter) {
      filter.addEventListener('input', function () {
        pickerFilter = filter.value;
        renderStructurePicker();
      });
      filter.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); closeStructurePicker(); }
      });
    }
    var close = element('part-picker-close');
    if (close) close.addEventListener('click', closeStructurePicker);
    renderParts();
  }

  var SPRING_LABELS = { stiffness: '刚度', dragForce: '阻尼', gravityPower: '重力' };

  /**
   * One control block per spring chain of the configured model.
   *
   * Every field offers the model file's own number as its placeholder, a '默认' button per field, and a
   * '本组复位' per chain: an override stores only the FIELDS the user moved, so 'default' is a real state and
   * touching stiffness must not pin drag and gravity along with it.
   */
  /**
   * The per-collider panel — one checkbox for every collider the model file declares.
   *
   * Operator, 2026-10-14: 「只有body组一个碰撞体组吗？可以做成详细面板一个个开关吗？」. His model declares two groups (`body` with
   * seven spheres, `wail` with five), and the reason a per-collider switch is worth having is that the ROUND ONE is the
   * suspect for the old breakage: a 0.196 sphere on the head is what flattens a fringe, while the hands and legs are
   * harmless. The keys are `<group>:<collider>`, positional in the file, and the scene matches them against the model's
   * own groups — the same pair, one place each.
   *
   * Rendered from the MODEL rather than from the preference, so a stored key that matches nothing simply shows nothing
   * (and `core.cleanSpringCollidersOff` keeps such keys from accumulating).
   */
  function renderColliderDetail(info) {
    var box = element('spring-collider-list');
    var summary = element('spring-collider-count');
    var details = element('spring-colliders-detail');
    if (!box) return;
    var springs = info && info.springs ? info.springs : null;
    var detail = springs && Array.isArray(springs.detail) ? springs.detail : [];
    // Only 自定义 has anything to tick: the other two modes answer for every collider at once.
    var custom = (preferences.springColliders || 'off') === 'custom';
    if (summary) summary.textContent = detail.length ? '(' + detail.length + ')' : '';
    if (details) details.hidden = !detail.length || !custom;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!detail.length) return;
    var off = Array.isArray(preferences.springCollidersOff) ? preferences.springCollidersOff : [];
    detail.forEach(function (entry) {
      var row = document.createElement('label');
      row.className = 'inline';
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      var keyBox = document.createElement('input');
      keyBox.type = 'checkbox';
      keyBox.checked = off.indexOf(entry.key) === -1;
      keyBox.addEventListener('change', function () {
        var next = (Array.isArray(preferences.springCollidersOff) ? preferences.springCollidersOff : []).slice();
        var at = next.indexOf(entry.key);
        if (keyBox.checked && at !== -1) next.splice(at, 1);
        if (!keyBox.checked && at === -1) next.push(entry.key);
        preferences.springCollidersOff = next;
        persist();
      });
      var text = document.createElement('span');
      // 「身体 · 头 · 球」 — the group the file named and the bone it sits on; the radius lives in the box beside it, which is
      // where it can be changed.
      var radius = Number(entry.radius);
      text.textContent = [
        entry.groupName || ('组 ' + entry.group),
        entry.bone || '（未命名骨骼）',
        entry.kind === 'sphere' ? '球' : (entry.kind || '形状'),
      ].filter(Boolean).join(' · ');
      /**
       * …and the SIZE box (operator, 2026-10-14: 「增加修改弹簧骨碰撞体球尺寸的方法」).
       *
       * It starts at the number the FILE declares, so the page shows what is in force and typing another is the whole edit.
       * A value equal to the file's removes the override rather than storing it — the two mean the same thing, and only
       * one of them survives a model being re-exported with different numbers. Empty clears it too, which is the
       * keyboard-friendly way back. Range and step come from the core, so the box cannot offer a value the cleaner would
       * throw away.
       */
      var range = core.SPRING_RADIUS_RANGE || { min: 0, max: 2 };
      var size = document.createElement('input');
      size.type = 'number';
      size.min = String(range.min);
      size.max = String(range.max);
      size.step = '0.005';
      size.style.width = '86px';
      size.title = '碰撞球半径（模型单位）：越大越挡得住，越小越容易被穿过';
      var overrides = preferences.springColliderRadius && typeof preferences.springColliderRadius === 'object'
        ? preferences.springColliderRadius
        : {};
      var override = Number(overrides[entry.key]);
      size.value = Number.isFinite(override)
        ? String(override)
        : (Number.isFinite(radius) ? String(Number(radius.toFixed(3))) : '');
      size.addEventListener('change', function () {
        var map = {};
        Object.keys(preferences.springColliderRadius || {}).forEach(function (key) {
          map[key] = preferences.springColliderRadius[key];
        });
        var wanted = Number(size.value);
        if (size.value === '' || !Number.isFinite(wanted) || (Number.isFinite(radius) && Math.abs(wanted - radius) < 1e-6)) {
          delete map[entry.key];
        } else {
          map[entry.key] = wanted;
        }
        preferences.springColliderRadius = map;
        persist();
      });
      row.appendChild(keyBox);
      row.appendChild(text);
      row.appendChild(size);
      box.appendChild(row);
    });
  }

  function renderSprings() {
    var list = element('spring-list');
    var count = element('spring-count');
    var note = element('spring-note');
    /**
     * Whether the spring bones keep being simulated while a clip plays (operator, 2026-10-14). Read from the same
     * preference the scene reads, so the box and the 3D half cannot disagree about it.
     */
    var motionPhysics = element('spring-motion-physics');
    if (motionPhysics) motionPhysics.checked = preferences.motionPhysics !== false;
    /**
     * The collider switch and its per-collider panel (operator, 2026-10-14: 「全部关闭（默认状态），全部开启和自定义…自定义状态默认是
     * 所有碰撞体全勾选状态。修改勾选后实时更新模型」).
     *
     * Same rule as every control here: the select writes the preference the scene reads, so the panel and the 3D half cannot
     * disagree about it. 全部关闭 is the shipped answer and the behaviour of every build before this one; the panel appears
     * only for 自定义, where every collider starts ticked.
     */
    var springColliders = element('spring-colliders');
    if (springColliders) springColliders.value = preferences.springColliders || 'off';
    renderColliderDetail(modelInfo);
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    var springs = modelInfo && modelInfo.springs;
    var chains = springs && Array.isArray(springs.groups) ? springs.groups : [];
    if (count) count.textContent = modelInfo ? '(' + chains.length + ')' : '';

    if (!chains.length) {
      if (note) {
        note.textContent = modelInfo ? '这个模型没有弹簧骨。' : '';
      }
      return;
    }
    if (note) {
      var joints = chains.reduce(function (total, chain) { return total + (chain.bones || 0); }, 0);
      note.textContent = '共 ' + chains.length + ' 条链、' + joints + ' 个可调 joint。';
    }

    var modelId = modelIdInUse();
    /**
     * More than five chains COLLAPSE, and the user can open them.
     *
     * Operator, 2026-10-10: "如果弹簧骨选项超过5个，就折叠起来，用户可以主动展开". A real model has ten to
     * twenty-two chains (SampleModel.vrm has eighteen, 蓝色小肥鱼 twenty-two), and each row is a label plus three
     * sliders and a button — left expanded they bury every other section of the page.
     *
     * A `<details>` rather than a hand-rolled toggle: it is keyboard accessible and remembered by the browser's
     * own find-in-page behaviour for free. The rows are built into it exactly as before, so nothing downstream
     * changes; five or fewer stay plain, because a group of five does not bury anything.
     */
    var COLLAPSE_ABOVE = 5;
    var collapsed = chains.length > COLLAPSE_ABOVE;
    var host = list;
    if (collapsed) {
      var details = rememberFold(document.createElement('details'), 'springs');
      details.className = 'spring-more';
      // NOT `open`: the point is that the section starts folded. `data-grouped` is for the stylesheet and for
      // the page state a live check reads.
      details.setAttribute('data-grouped', String(chains.length));
      var summary = document.createElement('summary');
      summary.textContent = '展开全部 ' + chains.length + ' 条弹簧骨链';
      details.appendChild(summary);
      list.appendChild(details);
      host = details;
    }
    chains.forEach(function (chain, chainIndex) {
      var row = document.createElement('div');
      row.className = 'chain';

      var head = document.createElement('div');
      // The class is what the stylesheet puts on its own row: with 22 chains in a real model (蓝色小肥鱼 has
      // 22) a fixed grid cannot hold a label, a slider, a number box and a button per field, and the
      // section has to wrap instead.
      head.className = 'head';
      var name = document.createElement('div');
      /**
       * What to CALL this chain, and the key an override is stored under — two different things.
       *
       * `key` is never empty (a VRM 0.x chain is named by a free-text `comment` that most exporters leave out),
       * and it is what the renderer looks up too, from the same rule in `core.springChainKey`. The LABEL is for
       * a human: an unnamed chain is identified by its root bone (`HairJoint-245c78de…`), because ten rows all
       * called "未命名链" is what made the operator report "大量无法修改的未命名链" — they were also unmodifiable,
       * which is the other half of that bug and is what this key fixes.
       */
      var chainKey = core.springChainKey({
        name: chain.comment || chain.name,
        kind: modelInfo && modelInfo.vrmSpec && String(modelInfo.vrmSpec).indexOf('1.0') === 0 ? 'vrm1' : 'vrm0',
      }, Number.isFinite(chain.index) ? chain.index : chainIndex);
      name.textContent = chain.comment || chain.name
        || (chain.first ? chain.first + '（未命名）' : '未命名链 #' + (chainIndex + 1));
      var meta = document.createElement('div');
      meta.className = 'note';
      meta.textContent = (chain.bones || 0) + ' joint'
        + (chain.entries && chain.entries !== chain.bones ? '（文件列了 ' + chain.entries + ' 项）' : '')
        + (chain.colliderGroups ? ' · ' + chain.colliderGroups + ' 碰撞组' : '');
      head.appendChild(name);
      head.appendChild(meta);
      row.appendChild(head);

      core.SPRING_FIELDS.forEach(function (field) {
        var cell = document.createElement('div');
        cell.className = 'field';
        var label = document.createElement('label');
        label.textContent = SPRING_LABELS[field] || field;
        var range = document.createElement('input');
        range.type = 'range';
        range.min = String(core.SPRING_LIMITS[field].min);
        range.max = String(core.SPRING_LIMITS[field].max);
        range.step = '0.05';
        var number = document.createElement('input');
        number.type = 'number';
        number.min = String(core.SPRING_LIMITS[field].min);
        number.max = String(core.SPRING_LIMITS[field].max);
        number.step = '0.05';
        var authored = Number(chain[field]);
        var override = core.springOverrideFor(preferences, modelId, chainKey);
        /**
         * THREE LAYERS, most specific first: what this user set, what the pack suggests, what the model file says.
         *
         * Operator, 2026-10-14: 「把当前 BlueFatFish 弹簧骨的参数作为默认参数推上去」. The middle layer is the manifest block the
         * host resolves for this model (`modelInfo.springDefaults`, keyed by chain), shown here rather than hidden
         * because the slider has to start where the pet actually IS: a box reading the file's 0.2 while the hair behaves
         * as 0.05 is exactly the disagreement this page exists to prevent. 复位 writes nothing and the middle layer
         * still applies, which is the honest meaning of 默认.
         */
        var shippedEntry = modelInfo && modelInfo.springDefaults ? modelInfo.springDefaults[chainKey] : null;
        var shipped = shippedEntry ? Number(shippedEntry[field]) : NaN;
        var current = override && override[field] !== undefined
          ? override[field]
          : (Number.isFinite(shipped) ? shipped : authored);
        range.value = String(current);
        number.value = String(Number(current).toFixed(2));
        number.title = '模型原值 ' + (Number.isFinite(authored) ? Number(authored).toFixed(3) : '?')
          + (Number.isFinite(shipped) ? ' · 随包默认 ' + Number(shipped).toFixed(3) : '');

        var write = function (value) {
          var stored = core.setSpringOverride(preferences, modelId, chainKey, field, value);
          persist();
          var next = stored === null ? (Number.isFinite(shipped) ? shipped : authored) : stored;
          range.value = String(next);
          number.value = String(Number(next).toFixed(2));
          cell.setAttribute('data-state', stored === null ? '默认' : '已改');
        };
        range.addEventListener('input', function () { write(Number(range.value)); });
        number.addEventListener('change', function () { write(Number(number.value)); });

        var reset = document.createElement('button');
        reset.className = 'ghost';
        reset.textContent = '默认';
        reset.addEventListener('click', function () { write(null); });

        cell.appendChild(label);
        cell.appendChild(range);
        cell.appendChild(number);
        cell.appendChild(reset);
        cell.setAttribute('data-state', override && override[field] !== undefined ? '已改' : '默认');
        row.appendChild(cell);
      });

      var actions = document.createElement('div');
      var resetChain = document.createElement('button');
      resetChain.className = 'ghost';
      resetChain.textContent = '本组复位';
      resetChain.addEventListener('click', function () {
        core.clearSpringOverrides(preferences, modelId, chainKey);
        persist();
        renderSprings();
      });
      actions.appendChild(resetChain);
      row.appendChild(actions);

      // Into the folding group when there is one, otherwise straight into the list.
      host.appendChild(row);
    });
  }
  /**
   * Drop every spring override, for every model.
   *
   * Referenced by the reset button and by the empty-chain state. It went missing once during a refactor and
   * the reference threw during init, which left the whole page on its placeholder text - the failure mode
   * this file now also reports on screen (see the bootstrap script in config-page.html).
   */
  function resetAllSprings() {    core.clearSpringOverrides(preferences, null);
    persist();
    renderSprings();
  }

  // ---------------------------------------------------------------------------
  // Authored motion: which clips each state draws from
  // ---------------------------------------------------------------------------
  /**
   * The motion catalog, as `/vrmpet3d/motions` reports it.
   *
   * Read HERE rather than through the pet: the host rebuilds this catalog on every request, so a
   * directory imported a moment ago is listed without a restart and without the pet running at all - the
   * same property the spring tables get from `/vrmpet3d/model-info`.
   */
  var motionCatalog = [];

  /**
   * Which folders belong to which state, as the pack's own manifest declares it (`stateFolders`).
   *
   * This is what keeps a state's box set SHORT: a state with an entry here is offered only the clips inside
   * those folders, and a state may name SEVERAL. A state without one is offered the whole catalogue, so a host
   * or a pack that says nothing behaves exactly as it did before the block existed.
   *
   * Each value arrives as a LIST — the host normalises a manifest's `stateFolders` to one (`lib/index.js`'s
   * `readMotionStateFolders`) — which is why nothing here compares it to a single folder name directly. Read it
   * through `stateFolderNames`.
   */
  var motionStateFolders = {};
  /**
   * The pack's 状态与动作 template, keyed by this profile's ids, exactly as the host resolved it.
   *
   * The page renders the RESOLVED answer for every per-clip control — the profile's own field, else the
   * template's — because a panel that showed only what the profile stores would draw 「跟随情绪」 over a clip the
   * pet is playing with a face, which is the "面板上看不出来" complaint this section keeps earning.
   */
  var motionClipDefaults = {};

  /** One clip's folder: the first segment of its catalogue name, or '' when it sits at the root. */
  function motionFolderOf(entry) {
    var name = String((entry && entry.name) || '');
    var slash = name.indexOf('/');
    return slash === -1 ? '' : name.slice(0, slash);
  }

  /**
   * The folders a state draws from, as a LIST — whatever shape the payload gave.
   *
   * The host normalises a manifest's `stateFolders` to a list (`readMotionStateFolders` in `lib/index.js`),
   * because a state may name SEVERAL folders (`"resting": ["idle", "dance"]`) and one folder is the common
   * case rather than the only one. A bare string is accepted here too, for an older host, so this page does
   * not depend on which side normalised it.
   *
   * THIS IS A FIX, NOT A TIDY-UP. This comparison used to be `motionFolderOf(entry) === value`, and with the
   * host's list that is `'idle' === ['idle']` — always false. Every mapped state's list therefore came up
   * EMPTY, and because the shipped pack maps all six states, 通用设置 → 状态与动作 advertised "26 支可选" above
   * six rows that each held nothing but the 「里还没有 .vrma」 hint (operator, 2026-10-12: "明明有26支可选，下面
   * 每一条却都是空着的").
   *
   * The suites could not see it: `verify-desktop.mjs`'s stub declared NO mapping at all, so the assertions
   * about scoping passed on the compatible case while the shipped shape was never exercised. It declares one
   * now, which is what pins this.
   */
  function stateFolderNames(state) {
    var value = motionStateFolders[state];
    var list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    return list.filter(function (name) { return typeof name === 'string' && name; });
  }

  /** The clips to OFFER for one state: its folders', or all of them when no folder is declared. */
  function clipsForState(state, offered) {
    var wanted = stateFolderNames(state);
    if (!wanted.length) return offered;
    return offered.filter(function (entry) {
      return wanted.indexOf(motionFolderOf(entry)) !== -1;
    });
  }

  /** Which rows the user has opened, so a re-render does not fold them all back up. */
  /**
   * Which FOLDS are open, by key, across a re-render — the one place that remembers it.
   *
   * Operator, 2026-10-14: 「弹簧骨面板展开后，如果点击空白处会被折叠回，这样影响用户操作，看看其他折叠的面板有没有类似问题，一起修了」. The
   * cause is the same for every fold this page BUILDS: a re-render throws the `<details>` away and makes a new one, and a new
   * one is shut. A click on empty space commits whatever box was focused, that commit re-renders, and the panel the user was
   * working in closes under their hands.
   *
   * It was fixed once for 状态与动作 (`openMotionStates`, still here as the key prefix) and never generalised, so 弹簧骨 and
   * 碎碎念 had the bug. This map is that generalisation: `rememberFold` is called with the element and a key that is stable
   * across renders, restores what the user last chose, and records every toggle.
   */
  var openFolds = {};

  /** Restore (and then track) one fold's open state. Every `<details>` this page builds goes through here. */
  function rememberFold(details, key) {
    if (!details || !key) return details;
    if (Object.prototype.hasOwnProperty.call(openFolds, key)) details.open = openFolds[key] === true;
    details.addEventListener('toggle', function () { openFolds[key] = details.open; });
    return details;
  }

  function loadMotions() {
    return fetch('/vrmpet3d/motions', { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (body) {
        motionCatalog = body && Array.isArray(body.motions) ? body.motions : [];
        motionStateFolders = body && body.stateFolders && typeof body.stateFolders === 'object'
          ? body.stateFolders
          : {};
        motionClipDefaults = body && body.motionClipDefaults && typeof body.motionClipDefaults === 'object'
          ? body.motionClipDefaults
          : {};
        renderMotions();
        // Published here as well as after the model arrives: "the catalog is empty" and "the catalog never
        // loaded" look identical on screen, and the two fetches race.
        publish();
        return motionCatalog;
      })
      .catch(function () {
        // A host without the route is a real case (an older build): the section explains itself rather
        // than throwing, exactly like the model tables.
        motionCatalog = [];
        motionClipDefaults = {};
        renderMotions();
        publish();
        return null;
      });
  }

  /** The clips this page offers, sorted by name so the list is stable between reloads. */
  function offeredMotions() {
    return motionCatalog.slice().sort(function (left, right) {
      var a = String(left.name || left.id);
      var b = String(right.name || right.id);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  /**
   * One clip's line: its file name, its format, its size and whether it arrived compressed.
   *
   * The loop/once marker is NOT here — it is its own element beside the box, because it is the one fact
   * that changes what the user will see (a clip that plays once and hands the pose back, versus one that
   * runs for as long as the state lasts).
   *
   * The size shown for a compressed clip is the FILE's, which is the smaller one, and it says 已压缩 so the
   * number is not read as "this clip is tiny on screen" — the host unpacks it before the renderer sees it. The
   * format stays VRMA either way, because that is what the clip IS.
   */
  function motionLabel(entry) {
    var size = Number(entry.bytes);
    var head = String(entry.name || entry.id) + '  (' + String(entry.format || '').toUpperCase();
    var tail = size > 0 ? ', ' + Math.max(1, Math.round(size / 1024)) + ' KB' : '';
    return head + (entry.compressed ? ' · 已压缩' : '') + tail + ')';
  }

  /** The 循环/单次 marker for one clip IN ONE STATE, showing the mode in force rather than the file's word. */
  function docMode(entry, state) {
    var mode = document.createElement('span');
    mode.className = 'mode';
    mode.textContent = core.motionLoopForState(preferences, state, entry.id, entry.loop, motionClipDefaults) === false
      ? '单次' : '循环';
    return mode;
  }

  /** This state's entry for one clip — the profile's own field, else the pack's template — or an empty object. */
  function clipFaceEntry(state, motionId) {
    return core.motionClipFor(preferences, state, motionId, motionClipDefaults) || {};
  }

  /** Whether the pack's template answers for one field of one (state, clip), or undefined when it does not. */
  function clipFaceDeclared(state, motionId, field) {
    var entry = motionClipDefaults[state] ? motionClipDefaults[state][motionId] : null;
    return entry ? entry[field] : undefined;
  }

  /** The mouth expressions this model actually has: the mouth presets, in either VRM vocabulary. */
  function mouthNames() {
    return expressionRows()
      .filter(function (expression) { return expressionAnswersTo(expression, core.MOUTH_EXPRESSIONS); })
      .map(function (expression) { return expression.name; });
  }

  /**
   * One of the two face dropdowns for a clip in a state: 表情 or 口型.
   *
   * The first option is 「跟随」 — the emotion table for the expression, the expression itself for the mouth —
   * and it is a VALUE rather than an empty box, because the pack's template can name a face for a clip
   * (`core.MOTION_FACE_FOLLOW`). Clearing the field would let the template's answer come straight back in and
   * make this row look like a control that does nothing; writing the sentinel is what makes it undoable in both
   * directions. A profile with no template to fight stores nothing for it (see the change handler), so the map
   * stays as small as it was before templates existed.
   */
  function clipFaceSelect(state, entry, field) {
    var select = document.createElement('select');
    select.className = 'clip-face clip-' + field;
    select.title = field === 'expression'
      ? '这支动作播放时显示的表情（覆盖情绪表的挑选）'
      : '这支动作播放时的口型（覆盖表情自带的口型）';
    var names = field === 'mouth' ? mouthNames() : expressionRows().map(function (row) { return row.name; });
    var followValue = core.MOTION_FACE_FOLLOW || 'follow';
    var follow = document.createElement('option');
    follow.value = followValue;
    follow.textContent = field === 'mouth' ? '口型：跟随表情' : '表情：跟随情绪';
    select.appendChild(follow);
    /**
     * And 「默认」: no expression (or mouth) at all — the model's own initial face, overriding both the clip's own
     * declared face and the mood the state's row picked (operator, 2026-10-13: 「表情和口型中增加"默认"选项，即没有任何表情或者
     * 口型，以模型的初始状态覆盖动作中的表情或者口型」).
     */
    var blankFace = document.createElement('option');
    blankFace.value = core.MOTION_FACE_DEFAULT || 'none';
    blankFace.textContent = field === 'mouth' ? '口型：默认（无口型）' : '表情：默认（无表情）';
    select.appendChild(blankFace);
    names.forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = (field === 'mouth' ? '口型：' : '表情：') + name;
      select.appendChild(option);
    });
    // The RESOLVED answer: the profile's own field, else the template's, else 「跟随」 — which is what the pet is
    // actually wearing while this clip plays.
    var resolved = clipFaceEntry(state, entry.id)[field];
    select.value = resolved === undefined || resolved === null ? followValue : resolved;
    select.addEventListener('change', function () {
      var chosen = select.value;
      /**
       * 「跟随」 is stored as the sentinel only when the template is the thing being overruled; with no template
       * (or one that says nothing about this field) the field is CLEARED, exactly as it was before the template
       * existed — an entry that records a non-decision would make every untouched clip look configured.
       */
      var write = chosen === followValue ? (clipFaceDeclared(state, entry.id, field) === undefined ? null : followValue) : chosen;
      preferences.motionClips = core.setMotionClip(preferences, state, entry.id, field, write);
      persist();
      publish();
      // The preview says what the SETTING says: 「默认」 goes over the wire as "no expression" rather than as a name the
      // renderer would have to know about, and 「跟随」 as nothing at all.
      var blankNow = core.MOTION_FACE_DEFAULT || 'none';
      var faceEntry = clipFaceEntry(state, entry.id);
      var previewFace = function (value) {
        if (value === undefined || value === null || value === followValue) return '';
        return value === blankNow ? '' : value;
      };
      sendPreview({
        state: state,
        motionId: entry.id,
        expression: previewFace(faceEntry.expression),
        mouth: previewFace(faceEntry.mouth),
      });
    });
    return select;
  }

  /**
   * Whether the 碎碎念 SOURCE is the AI one.
   *
   * ONE decision, read by both places that depend on it: `showSpeech` hides the whole `#speech-ai` block with
   * it, and the per-clip 提示词 input is shown only while it is true. The two must not be able to drift —
   * "the AI settings are hidden but the AI prompt box is not" is exactly the confusion the operator reported
   * on 2026-10-13 (「如果台词来源是内置台词，则下方的AI相关设置不显示」) — so the rule lives here rather than in
   * either caller.
   */
  function speechSourceIsAi() {
    return core.cleanSpeech(preferences.speech).source === 'ai';
  }

  /**
   * One of the two TEXTS a clip owns in a state: its 碎碎念 line, or its AI 提示词.
   *
   * The operator's 2026-10-13 request (「允许给每个动作单独定义碎碎念，和AI碎碎念提示词（如果当前是AI碎碎念的话）」), and
   * the parenthetical is a RULE rather than a remark: the 提示词 box appears only while the source IS the AI
   * one, through the same `speechSourceIsAi` the AI settings block uses.
   *
   * Both write with `core.setMotionClip` and then persist and publish, exactly as the two dropdowns and the
   * 凝视 switch beside them do — so the change reaches the app and the window through the host's version
   * counter, and this row is redrawn from what was stored. A box left empty is CLEARED rather than stored
   * empty: `setMotionClip(…, null)` drops the field, which is what makes an empty box mean "no per-clip
   * text" and lets the state's own pool (or the state's own instruction) stand again.
   *
   * `maxLength` is the cap the CLEANER enforces, taken from core rather than typed here, so a box that
   * accepts a character the store would drop cannot exist.
   */
  function clipTextInput(state, entry, field) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'clip-text clip-' + field;
    input.spellcheck = false;
    if (field === 'speech') {
      input.maxLength = core.SPEECH_LIMITS.lineLength;
      input.placeholder = '碎碎念：这句台词';
      input.title = '这支动作在这个状态里播放时说的话；留空就用该状态自己的台词';
    } else {
      input.maxLength = core.MOTION_LIMITS.promptLength;
      input.placeholder = 'AI 提示词：这句要怎么说';
      input.title = '这支动作播放时，附加给 AI 的生成提示词（接在该状态的提示词后面）；只在台词来源为 AI 生成时显示';
    }
    input.value = clipFaceEntry(state, entry.id)[field] || '';
    /**
     * The 提示词 box exists only while the SOURCE is the AI one — the same rule, and the same helper, that
     * hides the 碎碎念 section's whole AI block. The element is built either way and marked `hidden`, so the
     * visibility is a fact about the DOM a check can read (`.clip-prompt` with `hidden`), and the box is
     * already there the moment the source is switched back.
     */
    if (field === 'prompt' && !speechSourceIsAi()) input.hidden = true;
    input.addEventListener('change', function () {
      preferences.motionClips = core.setMotionClip(preferences, state, entry.id, field, input.value || null);
      persist();
      publish();
    });
    return input;
  }

  /**
   * Tell the host what the pet should be showing right now, or clear it with `{}`.
   *
   * Fire and forget on purpose: this is a hover, and a preview that failed to send must not put an error in
   * front of someone who is just moving the mouse. The route is best-effort by design (`watchHostPreview`
   * reports itself unsupported and every surface carries on).
   */
  function sendPreview(preview) {
    try {
      fetch('/vrmpet3d/preview', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preview || {}),
      }).catch(function () { return null; });
    } catch (_error) {
      return null;
    }
    return null;
  }

  /**
   * One collapsible box set per state.
   *
   * A state draws ONE clip at random from whatever is ticked, so the control is a list of checkboxes
   * rather than a dropdown: "which one" is not a question with a single answer any more. Unticking the
   * last box is the documented way back to the procedural idle, which is why there is no "程序化待机"
   * box - an empty list IS that choice.
   */
  function renderMotions() {
    var list = element('motion-list');
    var count = element('motion-count');
    var note = element('motion-note');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    var offered = offeredMotions();
    var states = core.MOTION_STATES || [];
    var mapped = core.cleanMotions(preferences.motions);
    if (count) {
      var total = core.motionIdList(mapped).length;
      count.textContent = '(' + offered.length + ' 支可选'
        + (total ? ' · 已映射 ' + total + ' 支' : '') + ')';
    }
    if (note) {
      /**
       * The shipped pack is named separately from the user's own clips.
       *
       * The pack is catalogued out of the plugin's own `assets/motions` folder from the first scan, so without
       * this line a tick list that already holds three clips reads as "somebody imported these" — and a user
       * who tries to remove them through 动作导入 would find nothing to remove, because that list only knows the
       * directories THEY imported. The count stays separate for the same reason.
       */
      var bundled = offered.filter(function (entry) { return entry.source === 'bundled'; }).length;
      var summary = bundled
        ? '其中 ' + bundled + ' 支随插件分发（assets/motions），不需要导入。'
        : '';
      /**
       * Compressed clips are counted too, because their size would otherwise read as a lie: a dance clip listed
       * as 2.7 MB while it plays as an 8 MB animation looks like a broken number rather than like an archive.
       */
      var packed = offered.filter(function (entry) { return entry.compressed === true; }).length;
      var packing = packed
        ? '其中 ' + packed + ' 支是压缩存放（.br），播放时自动解压到内存，体积按压缩后的文件计。'
        : '';
      note.textContent = offered.length ? summary + packing : '没有可用的动作文件。';
    }

    states.forEach(function (state) {
      var chosen = core.motionIdsFor(mapped, state);
      /**
       * What THIS state may be offered.
       *
       * A state the pack maps to a folder (`stateFolders` in `assets/motions/vrmpet3d-motions.json`) is
       * offered only that folder's clips — the whole point of the folders, since one list of every clip the
       * operator has ever authored is unusable. An already-ticked clip from anywhere is still DRAWN below, so
       * a stored mapping is never hidden by this scoping: hiding it would read as "my configuration was lost".
       */
      var inFolder = clipsForState(state, offered);
      var folders = stateFolderNames(state);
      var wrap = document.createElement('div');
      wrap.className = 'motion-state';
      wrap.setAttribute('data-state', state);

      var details = rememberFold(document.createElement('details'), 'motions:' + state);
      var summary = document.createElement('summary');
      var name = document.createElement('span');
      name.className = 'state';
      name.textContent = stateName(state);
      var stateCount = document.createElement('span');
      stateCount.className = 'count';
      stateCount.textContent = chosen.length ? '已选 ' + chosen.length + ' 支' : '程序化待机';
      summary.appendChild(name);
      /**
       * The folder this state's clips come from, in the summary line.
       *
       * Named rather than implied: "只有 4 支" would otherwise read as "the pack is missing clips", and the
       * folder is exactly what the operator edits — or adds clips to — in order to change the list.
       */
      if (folders.length) {
        var folderTag = document.createElement('span');
        folderTag.className = 'folder';
        // Every folder the state draws from, because a state may name several and the operator edits exactly
        // this line to change the list.
        folderTag.textContent = folders.map(function (name) { return name + '/'; }).join(' ')
          + ' · ' + inFolder.length + ' 支';
        summary.appendChild(folderTag);
      }
      summary.appendChild(stateCount);
      details.appendChild(summary);
      // An open row stays open across a re-render, so ticking a second box does not fold the list away.

      /**
       * The 状态线 for this state — and only for the states DSH is actually IN.
       *
       * One row per status state, in the same box set as that state's motion, because the two questions belong to
       * the same subject — "what does the pet look like, and what does it say". The operator's five prompts ship as
       * the defaults (`core.DEFAULT_STATUS_TEXT`), so the boxes open already filled and can simply be edited;
       * clearing a box means this state says NOTHING, which is not the same as leaving it alone.
       *
       * NOT for the three pointer poses, and that asymmetry is deliberate rather than an oversight: 拖动中 /
       * 抛掷中 / 落地中 carry a MOTION row since 2026-10-13 (「缺少拖动时模型动作的设置」), but the prompt above the
       * pet's head is a claim about what DSH is doing, and being carried is not something DSH is doing —
       * `core.statusFor` answers null for them, so a text box here would edit a value nothing ever shows.
       *
       * The tag is a separate picker rather than typed text: ❓ and ✅ are emoji-plus-variation-selector
       * sequences and an `<input>` hands back only the base code point, so a hand-typed ❓ would quietly lose
       * half of itself on the next load.
       */
      if ((core.STATUS_STATES || []).indexOf(state) !== -1) details.appendChild(buildStatusRow(state));

      /**
       * The one-shot interval for this state: `min – max` seconds, 0 meaning "never".
       *
       * The renderer waits a random time inside the window, plays ONE non-looping clip from this state's
       * list, and then starts the next window — so "20–80" reads as "a yawn somewhere in every 20 to 80
       * seconds". It is armed only when the state actually has a non-looping clip ticked, which is why the
       * line says so instead of silently doing nothing.
       */
      var range = core.motionEveryFor(preferences, state);
      var every = document.createElement('div');
      every.className = 'every';
      var everyLabel = document.createElement('span');
      everyLabel.textContent = '单次动作间隔';
      var everyMin = document.createElement('input');
      everyMin.type = 'number';
      everyMin.min = String(core.MOTION_EVERY_LIMITS.minSeconds);
      everyMin.max = String(core.MOTION_EVERY_LIMITS.maxSeconds);
      everyMin.step = '5';
      var everyDash = document.createElement('span');
      everyDash.textContent = '–';
      var everyMax = document.createElement('input');
      everyMax.type = 'number';
      everyMax.min = String(core.MOTION_EVERY_LIMITS.minSeconds);
      everyMax.max = String(core.MOTION_EVERY_LIMITS.maxSeconds);
      everyMax.step = '5';
      var everyUnit = document.createElement('span');
      everyUnit.textContent = '秒';
      var everyNote = document.createElement('span');
      everyNote.className = 'note';
      var oneShotCount = chosen.filter(function (id) {
        var entry = offered.filter(function (candidate) { return candidate.id === id; })[0];
        return Boolean(entry) && core.motionLoopFor(preferences, id, entry.loop) === false;
      }).length;
      everyNote.textContent = oneShotCount
        ? '（本状态有 ' + oneShotCount + ' 支单次动作）'
        : '（本状态还没有勾选「单次」动作，不会触发）';
      everyMin.value = String(range ? range.min : 0);
      everyMax.value = String(range ? range.max : 0);
      var writeEvery = function () {
        var min = Math.max(0, Number(everyMin.value) || 0);
        var max = Math.max(0, Number(everyMax.value) || 0);
        preferences.motionEvery = core.setMotionEvery(preferences, state, { min: min, max: max });
        persist();
        renderMotions();
        publish();
      };
      everyMin.addEventListener('change', writeEvery);
      everyMax.addEventListener('change', writeEvery);
      every.appendChild(everyLabel);
      every.appendChild(everyMin);
      every.appendChild(everyDash);
      every.appendChild(everyMax);
      every.appendChild(everyUnit);
      every.appendChild(everyNote);
      details.appendChild(every);

      var picks = document.createElement('div');
      picks.className = 'picks';
      /**
       * The rows to draw: the state's folder FIRST, then any ticked clip from outside it.
       *
       * The second half is not a nicety. A mapping that was stored before the folders existed — or one the
       * user made on purpose — must stay visible and tickable, or scoping the list would silently hide a clip
       * that is still playing in this state, and "my configuration disappeared" is a worse bug than a long
       * list. `onMotionToggle` collects what is drawn here, so those rows stay part of the state's list too.
       */
      var shown = inFolder.slice();
      chosen.forEach(function (id) {
        if (shown.some(function (entry) { return entry.id === id; })) return;
        var found = offered.filter(function (entry) { return entry.id === id; })[0];
        if (found) shown.push(found);
      });
      if (folders.length && !inFolder.length) {
        var empty = document.createElement('p');
        empty.className = 'hint';
        // Only when the folders really hold nothing: with the mapping read correctly this is the one honest
        // case left (a state mapped to a folder the pack does not fill, like 工作中's `working/`), and it is
        // the line that told the operator the list was empty while the clips were sitting in `idle/`.
        empty.textContent = 'assets/motions/' + folders.map(function (name) { return name + '/'; }).join(' ')
          + ' 里还没有 .vrma：把面向这个状态的动作放进那个目录，它们会立刻出现在这里。';
        picks.appendChild(empty);
      }
      shown.forEach(function (entry) {
        var label = document.createElement('label');
        label.className = 'pick';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = entry.id;
        box.setAttribute('data-state', state);
        box.checked = chosen.indexOf(entry.id) !== -1;
        box.addEventListener('change', function () { onMotionToggle(state); });
        var text = document.createElement('span');
        text.textContent = motionLabel(entry);
        var mode = docMode(entry, state);
        label.appendChild(box);
        label.appendChild(text);
        label.appendChild(mode);
        picks.appendChild(label);

        /**
         * The three answers this state gives about THIS clip, and the preview they drive.
         *
         * The operator's 2026-10-09 request: "每个状态下，可以针对每个动作设置该状态下该动作为循环还是单次，并可以
         * 设置该状态下该动作的表情（下拉框）和口型（下拉框）（覆盖表情的口型），当用户正在修改这部分时，模型变成
         * 动作+表情+口型的预览". So the controls appear for a clip that is TICKED in this state (an unticked clip
         * has no answer to give), and pointing at them makes the pet show the combination through the host's
         * preview channel — leaving puts the pet back the way it was.
         */
        if (chosen.indexOf(entry.id) === -1) return;
        var controls = document.createElement('span');
        controls.className = 'clip-controls';

        var modeSelect = document.createElement('select');
        modeSelect.className = 'clip-mode';
        modeSelect.title = '这支动作在这个状态里播放一次还是循环';
        [['loop', '循环'], ['once', '单次']].forEach(function (pair) {
          var option = document.createElement('option');
          option.value = pair[0];
          option.textContent = pair[1];
          modeSelect.appendChild(option);
        });
        // The default shown is the mode in force when this state's entry says nothing: the pack's template, then
        // the per-clip override, then the catalog's declaration — the same layers the renderer resolves.
        modeSelect.value = core.motionLoopForState(preferences, state, entry.id, entry.loop, motionClipDefaults) === false
          ? 'once' : 'loop';
        modeSelect.addEventListener('change', function () {
          preferences.motionClips = core.setMotionClip(preferences, state, entry.id, 'loop', modeSelect.value === 'loop');
          persist();
          renderMotions();
          publish();
        });
        controls.appendChild(modeSelect);
        /**
         * 速度 — the playback rate for this clip in this state (operator, 2026-10-14: 「允许给每个动作配置速度，默认100%，范围是
         * 1-1000%，同样具有实时预览功能。这一步会延长或者缩短单次/循环动作的时间，但是动作结束后的后续动作接续逻辑依然不变」).
         *
         * A number box in percent, starting at the value in force (the profile's, else the pack's template, else 100) so
         * the page shows what the clip is actually doing. The rate goes into the SAME per-(state, clip) entry the loop mode
         * and the faces use, and 100 is stored as "no decision" — the default is the answer, so a clip nobody slowed down
         * keeps the map holding decisions and nothing else. The scene reacts on the next preference push, which is what
         * makes it a live preview: the clip on screen slows down or speeds up where it is, and its END — and therefore
         * whatever follows it — moves with it rather than being re-scheduled.
         */
        var speedNow = core.motionSpeedFor(preferences, state, entry.id, motionClipDefaults);
        var speedLimits = core.MOTION_SPEED_LIMITS || { min: 1, max: 1000, default: 100 };
        var speedLabel = document.createElement('label');
        speedLabel.className = 'clip-speed';
        speedLabel.title = '这支动作在这个状态里的播放速度（百分比）';
        var speedText = document.createElement('span');
        speedText.textContent = '速度';
        var speedBox = document.createElement('input');
        speedBox.type = 'number';
        speedBox.className = 'clip-speed-box';
        speedBox.min = String(speedLimits.min);
        speedBox.max = String(speedLimits.max);
        speedBox.step = '10';
        speedBox.style.width = '72px';
        speedBox.value = String(speedNow);
        var speedUnit = document.createElement('span');
        speedUnit.textContent = '%';
        speedBox.addEventListener('change', function () {
          var wanted = Math.round(Number(speedBox.value));
          if (!isFinite(wanted)) wanted = speedLimits.default;
          if (wanted < speedLimits.min) wanted = speedLimits.min;
          if (wanted > speedLimits.max) wanted = speedLimits.max;
          /**
           * 100 goes back to "no decision" unless a template names a different speed — the same rule the face dropdowns
           * follow, so 恢复默认 is typing 100 rather than a separate button, and a template's answer is still overridable.
           */
          var templateSpeed = Number(clipFaceDeclared(state, entry.id, 'speed'));
          var write = wanted === speedLimits.default
            ? (Number.isFinite(templateSpeed) && templateSpeed !== speedLimits.default ? speedLimits.default : null)
            : wanted;
          preferences.motionClips = core.setMotionClip(preferences, state, entry.id, 'speed', write);
          persist();
          renderMotions();
          publish();
        });
        speedLabel.appendChild(speedText);
        speedLabel.appendChild(speedBox);
        speedLabel.appendChild(speedUnit);
        controls.appendChild(speedLabel);

        controls.appendChild(clipFaceSelect(state, entry, 'expression'));
        controls.appendChild(clipFaceSelect(state, entry, 'mouth'));
        // The two TEXTS this clip owns in this state (the operator's 2026-10-13 request): what it says, and
        // how the AI should say it.
        controls.appendChild(clipTextInput(state, entry, 'speech'));
        controls.appendChild(clipTextInput(state, entry, 'prompt'));

        /**
         * And the 凝视 switch: may the pet look at the cursor while THIS clip plays in THIS state?
         *
         * A checkbox rather than a dropdown, because it is a switch and not a third answer with a "follow"
         * state — but it is THREE-state underneath now that the template can refuse for a clip: an unchecked
         * box stores `gaze: false`, a checked box stores `gaze: true` ONLY against a template that refuses
         * (otherwise the field is cleared, so the map keeps holding decisions and nothing else), and every clip
         * nobody has touched follows the pointer exactly as before. The outer gate stays the app's own 看向光标
         * switch in 其他 — this can turn the gaze off for one clip, never on for a pet whose gaze is off.
         */
        var gazeLabel = document.createElement('label');
        gazeLabel.className = 'clip-gaze';
        gazeLabel.title = '这支动作在这个状态里播放时，是否看向鼠标（关掉就是不看）';
        var gazeBox = document.createElement('input');
        gazeBox.type = 'checkbox';
        gazeBox.className = 'clip-gaze-box';
        // The RESOLVED entry, so the box shows the template's refusal as well as the profile's own.
        var gazeEntry = clipFaceEntry(state, entry.id);
        gazeBox.checked = !(gazeEntry && gazeEntry.gaze === false);
        var gazeText = document.createElement('span');
        gazeText.textContent = '凝视';
        gazeLabel.appendChild(gazeBox);
        gazeLabel.appendChild(gazeText);
        gazeBox.addEventListener('change', function () {
          var templateRefuses = clipFaceDeclared(state, entry.id, 'gaze') === false;
          var write = gazeBox.checked ? (templateRefuses ? true : null) : false;
          preferences.motionClips = core.setMotionClip(preferences, state, entry.id, 'gaze', write);
          persist();
          publish();
        });
        controls.appendChild(gazeLabel);

        /**
         * A preview while the pointer or the keyboard is on this row.
         *
         * `mouseleave` fires when the pointer leaves the folded `<details>` too, and `previewOff` is what puts
         * the pet back: whatever the user is looking at, letting go of it restores the state machine.
         */
        var previewOn = function () {
          // The same mapping the dropdown's own change handler uses: 「跟随」 and 「默认」 both go over the wire as
          // "no expression", so the renderer never has to know about either literal.
          var face = clipFaceEntry(state, entry.id);
          var blankNow = core.MOTION_FACE_DEFAULT || 'none';
          var followNow = core.MOTION_FACE_FOLLOW || 'follow';
          var previewFace = function (value) {
            if (value === undefined || value === null || value === followNow) return '';
            return value === blankNow ? '' : value;
          };
          sendPreview({
            state: state,
            motionId: entry.id,
            expression: previewFace(face.expression),
            mouth: previewFace(face.mouth),
          });
        };
        var previewOff = function () { sendPreview({}); };
        controls.addEventListener('mouseenter', previewOn);
        controls.addEventListener('focusin', previewOn);
        controls.addEventListener('mouseleave', previewOff);
        controls.addEventListener('focusout', previewOff);
        // Changing a dropdown previews the NEW value immediately rather than waiting for the next hover.
        modeSelect.addEventListener('change', previewOn);
        picks.appendChild(controls);
      });

      // A stored id the catalog no longer lists stays visible and ticked: it is still stored, and a row
      // that silently dropped it would hide the reason a state plays nothing.
      chosen.forEach(function (id) {
        var known = offered.some(function (entry) { return entry.id === id; });
        if (known) return;
        var label = document.createElement('label');
        label.className = 'pick';
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = id;
        box.checked = true;
        box.disabled = true;
        var text = document.createElement('span');
        text.textContent = id + '（不在动作目录中）';
        label.appendChild(box);
        label.appendChild(text);
        picks.appendChild(label);
      });

      details.appendChild(picks);
      wrap.appendChild(details);
      list.appendChild(wrap);
    });
  }

  /**
   * One state's status line: the text, the tag, how it is drawn, and how long it stays up.
   *
   * Every field writes through `core.setStatus` and then persists and publishes, exactly like the motion
   * rows, so the pet in the app and the floating window both pick the change up through the host's version
   * counter rather than through a reload.
   */
  function buildStatusRow(state) {
    var entry = core.statusEntryFor(preferences, state);
    var fallback = core.DEFAULT_STATUS_TEXT && typeof core.DEFAULT_STATUS_TEXT[state] === 'string'
      ? core.DEFAULT_STATUS_TEXT[state]
      : '';
    var wrap = document.createElement('div');
    wrap.className = 'status-line';
    wrap.setAttribute('data-state', state);

    var label = document.createElement('span');
    label.className = 'status-label';
    label.textContent = '状态文字';
    wrap.appendChild(label);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'status-text';
    input.maxLength = core.STATUS_LIMITS ? core.STATUS_LIMITS.textLength : 40;
    input.value = entry.text;
    input.placeholder = fallback ? fallback + '（默认）' : '（不显示文字）';
    input.title = '这个状态下宠物头顶显示的文字；清空则什么都不显示';
    input.addEventListener('change', function () {
      preferences.status = core.setStatus(preferences, state, 'text', input.value);
      persist();
      publish();
      renderMotions();
    });
    wrap.appendChild(input);

    var tag = document.createElement('select');
    tag.className = 'status-tag';
    tag.title = '文字后面的标记';
    (core.STATUS_TAGS || ['']).forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value || '无标记';
      tag.appendChild(option);
    });
    tag.value = entry.tag;
    tag.addEventListener('change', function () {
      preferences.status = core.setStatus(preferences, state, 'tag', tag.value);
      persist();
      publish();
      renderMotions();
    });
    wrap.appendChild(tag);

    var animation = document.createElement('select');
    animation.className = 'status-animation';
    animation.title = '蓝渐变动画就是 DSH 自己的「深度求索中」扫光效果';
    [['none', '静态'], ['shimmer', '蓝渐变动画']].forEach(function (pair) {
      var option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      animation.appendChild(option);
    });
    animation.value = entry.animation;
    animation.addEventListener('change', function () {
      preferences.status = core.setStatus(preferences, state, 'animation', animation.value);
      persist();
      publish();
      renderMotions();
    });
    wrap.appendChild(animation);

    var duration = document.createElement('input');
    duration.type = 'number';
    duration.className = 'status-seconds';
    duration.min = '0';
    duration.max = String(core.STATUS_LIMITS ? core.STATUS_LIMITS.maxSeconds : 3600);
    duration.step = '1';
    duration.value = String(entry.seconds);
    /**
     * What this number MEANS depends on the state, and the row says which.
     *
     * 等待确认 / 任务达成 / 出错 are event-ended (see `core.UNTIMED_STATUS_STATES`): a clock may not hide the very
     * prompt the user has to act on. For 等待确认 the field is therefore pointless — the operator's rule is
     * "让用户回答完问题/确认完权限后才消失" — so it is disabled and explains itself rather than silently doing
     * nothing. For the two notice states the number survives as a MINIMUM: how long the line is guaranteed to
     * be up before going back to that session can clear it.
     */
    var untimed = (core.UNTIMED_STATUS_STATES || []).indexOf(state) !== -1;
    var awaitingAnswer = state === 'waiting';
    duration.disabled = awaitingAnswer;
    duration.title = awaitingAnswer
      ? '等待确认不受时间影响：一直显示到你回答完问题 / 确认完权限'
      : (state === 'done' || state === 'error'
        ? '至少显示多久；之后一直留到你切回这个会话（默认 4.2 秒是下限）'
        : '这个状态下文字显示多久；0 表示一直显示到状态结束');
    duration.addEventListener('change', function () {
      var seconds = Math.max(0, Number(duration.value) || 0);
      preferences.status = core.setStatus(preferences, state, 'seconds', seconds > 0 ? seconds : null);
      persist();
      publish();
      renderMotions();
    });
    wrap.appendChild(duration);

    var unit = document.createElement('span');
    unit.className = 'note';
    unit.textContent = awaitingAnswer ? '秒（此状态不受时间影响）'
      : (untimed ? '秒（至少）' : '秒（0 = 始终）');
    wrap.appendChild(unit);

    return wrap;
  }

  /** A tick writes the state's whole list through core, then hands the change to every surface. */
  function onMotionToggle(state) {
    /**
     * Collect ONLY the clip tick boxes — not the 凝视 switch beside them.
     *
     * This used to be `row.querySelectorAll('input[type=checkbox]')`, and that is wrong in a way that WRITES
     * data: every ticked clip carries a 凝视 switch in the same row, and a checkbox written without a `value`
     * attribute has the DOM default `'on'`. So each tick stored the literal string `on` as a clip id — which is
     * exactly the entry the operator reported as "不在动作目录中" — and the discarded stale-id rows were
     * collected too, because they are `checked` even though they are `disabled`.
     *
     * `label.pick` is the tick box's own label: the switch is `label.clip-gaze`, so this excludes it. The stale
     * rows ARE `label.pick` and stay collected on purpose — a stored id keeps its place in the map until the
     * user changes the state's list, and the cap below is what makes that visible instead of silent.
     */
    var row = element('motion-list')
      ? element('motion-list').querySelector('.motion-state[data-state="' + state + '"]')
      : null;
    var ids = [];
    if (row) {
      var boxes = row.querySelectorAll('.picks label.pick input[type=checkbox]');
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) ids.push(boxes[i].value);
      }
    }
    preferences.motions = core.setMotionIds(preferences.motions || {}, state, ids);
    renderMotions();
    /**
     * Say so when the cap bites.
     *
     * `core.cleanMotionIds` keeps the first `maxPerState` ids and drops the rest by design (a state draws ONE
     * clip at random, so a longer list only dilutes every entry). Dropping them SILENTLY is what made "the last
     * box will not tick" read as a broken clip, so the count is compared and the note says it — using the
     * STORED length, because that is what the reader will see come back.
     */
    var cap = (core.MOTION_LIMITS || {}).maxPerState;
    var kept = core.motionIdsFor(preferences.motions, state).length;
    if (Number.isFinite(cap) && ids.length > cap) {
      var warn = element('motion-note');
      if (warn) {
        warn.className = 'hint warn';
        warn.textContent = '每个状态最多勾选 ' + cap + ' 支动作：' + stateName(state) + ' 只保留了前 ' + kept + ' 支。';
      }
    }
    persist();
    publish();
  }

  /**
   * A state's name in the window — the operator's own words, and only the nine that remain.
   *
   * The old list carried 庆祝/睡觉/打招呼 rows; those states are gone from `core.MOTION_STATES`, so a row for one
   * could not be configured even if it were drawn. The three pointer poses join the six status ones on 2026-10-13
   * (「缺少拖动时模型动作的设置」), which is why 拖动中 / 抛掷中 / 落地中 have rows of their own now — a clip there is
   * the POSE, and where the pet IS stays the drag physics' business. The labels are what the user calls the states,
   * which is why the mapping exists at all rather than showing the raw id.
   */
  function stateName(state) {
    return {
      resting: '空闲', working: '工作中', waiting: '等待确认',
      done: '任务完成', error: '出错', offline: '离线',
      held: '拖动中', falling: '抛掷 / 下落中', landing: '落地',
    }[state] || state;
  }

  // ---------------------------------------------------------------------------
  // The other preferences, and the live status line
  // ---------------------------------------------------------------------------
  function bindPreferenceControls() {
    var physics = element('pref-physics');
    var motion = element('pref-motion');
    var look = element('pref-look');
    var size = element('pref-size');
    var sizeValue = element('pref-size-value');
    var sizeReset = element('pref-size-reset');
    /**
     * The FLOATING WINDOW's own size, a separate preference (see `core.DEFAULTS.windowSize`).
     *
     * Two controls rather than one, because the surfaces are framed differently: `size` moves the pet inside
     * DSH's window, `windowSize` the one whose frame is the whole screen. Editing one used to move both,
     * which is how a DSH reload left the floating window at the in-app pet's percentage.
     */
    var windowSize = element('pref-window-size');
    var windowSizeValue = element('pref-window-size-value');
    var windowSizeReset = element('pref-window-size-reset');
    var viewReset = element('pref-view-reset');
    var hidden = element('pref-hidden');
    /**
     * 调试模式 — the one control whose preference is not a boolean but a value of 显示位置.
     *
     * `core.PET_SURFACES` is the closed list (`auto` / `window` / `app` / `both`), so this is written as the
     * value itself rather than as an extra flag beside it: a second key could disagree with the surface, and the
     * cleaner would then rewrite whichever one it does not know. Setting it starts the floating window AND keeps
     * the pet inside the app (see `applySurface` in `lib/client.js`); clearing it goes back to 自动, which is the
     * behaviour a profile that never touched this had.
     */
    var both = element('pref-both');
    var syncBoth = function () {
      if (both) both.checked = (preferences.petSurface || 'auto') === 'both';
    };
    /**
     * 空闲休眠 — how long the pet may sit idle before it naps.
     *
     * `core.cleanPreferences` accepts exactly three values (`DEFAULTS.sleepAfterMs` and the other two), so the
     * markup's three options ARE the whole domain; selecting one writes the NUMBER, and `syncSleep` puts the
     * stored number back. This row exists because the deleted pet settings panel was the only control that ever
     * owned this preference, and the right-click menu that replaced the panel does not carry it — a preference
     * the cleaner still honours and no surface can change.
     */
    var sleep = element('pref-sleep');
    var syncSleep = function () {
      if (sleep) sleep.value = String(preferences.sleepAfterMs);
    };

    var write = function (key, value) {
      preferences[key] = value;
      persist();
    };
    var writeSize = function () {
      if (sizeValue) sizeValue.textContent = Math.round(preferences.size) + '%';
      if (size) size.value = String(preferences.size);
      if (windowSizeValue) windowSizeValue.textContent = Math.round(preferences.windowSize) + '%';
      if (windowSize) windowSize.value = String(preferences.windowSize);
    };

    if (physics) physics.addEventListener('change', function () { write('physics', physics.checked); });
    if (motion) motion.addEventListener('change', function () { write('motion', motion.checked); });
    if (look) look.addEventListener('change', function () { write('lookAtPointer', look.checked); });
    if (size) {
      size.addEventListener('input', function () {
        write('size', Number(size.value));
        writeSize();
      });
    }
    if (sizeReset) {
      sizeReset.addEventListener('click', function () {
        write('size', core.DEFAULTS.size);
        writeSize();
      });
    }
    if (windowSize) {
      windowSize.addEventListener('input', function () {
        write('windowSize', Number(windowSize.value));
        writeSize();
      });
    }
    if (windowSizeReset) {
      windowSizeReset.addEventListener('click', function () {
        write('windowSize', core.DEFAULTS.windowSize);
        writeSize();
      });
    }
    if (viewReset) {
      viewReset.addEventListener('click', function () {
        write('viewYaw', 0);
        write('viewPitch', 0);
      });
    }
    if (hidden) hidden.addEventListener('change', function () { write('hidden', hidden.checked); });
    if (both) {
      both.addEventListener('change', function () {
        write('petSurface', both.checked ? 'both' : 'auto');
        syncBoth();
      });
    }
    if (sleep) {
      sleep.addEventListener('change', function () {
        write('sleepAfterMs', Number(sleep.value));
        syncSleep();
      });
    }

    if (physics) physics.checked = preferences.physics !== false;
    if (motion) motion.checked = preferences.motion !== false;
    if (look) look.checked = preferences.lookAtPointer !== false;
    if (hidden) hidden.checked = preferences.hidden === true;
    syncBoth();
    syncSleep();
    writeSize();
  }

  /**
   * The 碎碎念 section: the throttle, the per-state 台词 boxes, and the AI half.
   *
   * Three layers, and they are the three questions a user actually has:
   *
   *   1. WHETHER and HOW OFTEN — the switch and the three numbers, unchanged from the round that added 碎碎念;
   *   2. WHAT IT SAYS — one box per state, one line per line. A state whose box is empty keeps the shipped
   *      line, which is what makes "customize 工作中 and leave the rest" work instead of silencing the pet —
   *      but only while the BUILT-IN source is the one chosen;
   *   3. WHERE THE LINE COMES FROM — `builtin` / `custom` / `ai`, with the AI half's provider, persona and
   *      per-state instruction under it. The chain is AI → the state's own box → SILENCE once `custom` or `ai` is
   *      chosen (see `core.SpeechMachine.observe`): the shipped table IS the built-in source, so picking another one
   *      switches it off — operator, 2026-10-11: "开启AI碎碎念或者自定义碎碎念之后，关闭内置的默认碎碎念". A model
   *      that is slow or unreachable therefore costs the pet that one line, never its voice on a state the user wrote.
   *
   * The whole `speech` object is written through `core.cleanSpeech` on every change, so what is stored is
   * exactly what the renderer will read back — a field the cleaner would drop cannot be saved here.
   */
  var speechRows = {};
  var speechLlm = null;
  /**
   * The provider whose MODEL LIST the last `/vrmpet3d/llm` answer carried, and the providers asked about.
   *
   * `/vrmpet3d/llm` answers the provider list always and a model list only for a named provider, so which answer a
   * model list belongs to is part of reading it: a list that arrived for provider A must never settle the picker
   * while b is shown.
   */
  var askedLlmProvider = null;
  /**
   * A provider/model pair the catalog settled on BEFORE this page was allowed to write (see `hasSnapshot`).
   *
   * Held rather than dropped, because the page asks for the catalog at boot — possibly before the settings
   * snapshot lands — and the choice it makes is about the STORE, not about this page's copy: dropping it would
   * leave the store without the pair the page is showing, which is the whole defect this exists to fix.
   */
  var pendingLlmChoice = null;

  /**
   * Merge an adopted provider/model pair into the speech settings and write it.
   *
   * Through `core.cleanSpeech` like every other write on this page, so what is stored is what the renderer will
   * read back. Only ever called once the data-loss latch is open (see `applyLlmChoice`).
   */
  function writeLlmChoice(aiPatch) {
    var speech = core.cleanSpeech(preferences.speech);
    if (aiPatch.dshProvider) speech.ai.dshProvider = aiPatch.dshProvider;
    if (aiPatch.dshModel) speech.ai.dshModel = aiPatch.dshModel;
    preferences.speech = core.cleanSpeech(speech);
    persist();
  }

  /**
   * Write an adopted pair, or HOLD it until the store is known.
   *
   * A page that has not adopted a snapshot may not write (the data-loss latch), and the held patch is applied by
   * `adoptSnapshot` — the first moment writing is not a guess. Pairs accumulate rather than replace, because the
   * provider is adopted from the answer that carried no models and the model from the answer that did.
   */
  function applyLlmChoice(aiPatch) {
    if (!aiPatch || (!aiPatch.dshProvider && !aiPatch.dshModel)) return;
    if (!hasSnapshot) {
      pendingLlmChoice = pendingLlmChoice || {};
      if (aiPatch.dshProvider) pendingLlmChoice.dshProvider = aiPatch.dshProvider;
      if (aiPatch.dshModel) pendingLlmChoice.dshModel = aiPatch.dshModel;
      return;
    }
    writeLlmChoice(aiPatch);
  }

  /** One state's name as this page says it; 空闲 carries the idle remark, which has no state of its own. */
  function speechStateName(state) {
    return {
      resting: '空闲 / 静息态', working: '工作中', waiting: '等待确认',
      done: '任务完成', error: '出错', offline: '离线',
    }[state] || state;
  }

  /** Show or hide one of the AI rows; `hidden` alone would lose to `.row{display:flex}`. */
  function setRowHidden(id, hidden) {
    var row = element(id);
    if (row) row.hidden = hidden === true;
  }

  /** Make sure a select offers `value`, so a stored choice survives a catalog that no longer lists it. */
  function ensureOption(select, value) {
    if (!select || !value) return;
    var known = Array.prototype.some.call(select.options, function (option) { return option.value === value; });
    if (known) return;
    var option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }

  /** What `/vrmpet3d/llm` put in the model picker — the proof, from outside, that the catalog reached this page. */
  function dshModelIds() {
    var select = element('pref-speech-dsh-model');
    if (!select) return [];
    return Array.prototype.map.call(select.options, function (option) { return option.value; });
  }

  /**
   * Empty a select.
   *
   * The counterpart of `ensureOption`, and it exists for options that describe something which has CHANGED — one
   * provider's model list, once another provider is chosen. Leaving them in place is not neutral: the browser
   * displays the first one as the chosen value, so the picker reads as configured while the store holds nothing.
   * That disagreement is what 试一句 reported as 「还没有选择 DSH 的 provider 和模型」 (2026-10-12).
   */
  function clearOptions(select) {
    if (!select) return;
    while (select.firstChild) select.removeChild(select.firstChild);
  }

  /**
   * What an EMPTY 台词 box means, per source — the same fact `core.SpeechMachine.observe` acts on.
   *
   * The chain the page describes is the one the machine runs (operator, 2026-10-14: 「把所有的碎碎念都设置降级连，AI > 自定义
   * （非空时）> 内置」): the model's line when the source is AI, else the box, else the SHIPPED table — so an empty box is
   * never silence in any source. Until that day the shipped table was switched off by choosing 自定义/AI (2026-10-11) and
   * these labels said 「不说话」 for one of them, which is exactly what a busy model made the whole pet do.
   */
  var EMPTY_LINES_LABEL = {
    builtin: '用内置短语',
    custom: '用内置短语',
    ai: '用内置 AI 生成提示词',
  };
  var EMPTY_LINES_PLACEHOLDER = {
    builtin: '留空则用内置短语',
    custom: '留空则用内置短语',
    ai: '留空则用内置 AI 提示词生成一句（生成期间先显示内置短语）',
  };
  var emptyLinesLabel = function (source) {
    return EMPTY_LINES_LABEL[source] || EMPTY_LINES_LABEL.builtin;
  };

  /**
   * Build the per-state boxes ONCE, then write into them.
   *
   * Not re-rendered per keystroke, unlike the 动作 list: this section is nothing but textareas, and rebuilding
   * one while it has focus throws the caret away.
   */
  function renderSpeechStates() {
    var list = element('speech-states');
    if (!list) return;
    /**
     * Built ONCE, and that guard is load-bearing: `renderAll` calls back in on every settings snapshot, and a
     * rebuild would collapse the open boxes and take the caret out of one being typed in — the reason it is not
     * re-rendered per keystroke in the first place.
     */
    if (list.firstChild && Object.keys(speechRows).length) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    speechRows = {};
    (core.SPEECH_STATES || []).forEach(function (state) {
      var wrap = document.createElement('div');
      wrap.className = 'speech-state';
      wrap.setAttribute('data-state', state);

      var details = rememberFold(document.createElement('details'), 'speech:' + state);
      var summary = document.createElement('summary');
      var name = document.createElement('span');
      name.className = 'state';
      name.textContent = speechStateName(state);
      var count = document.createElement('span');
      count.className = 'count';
      summary.appendChild(name);
      summary.appendChild(count);
      details.appendChild(summary);

      var body = document.createElement('div');
      body.className = 'speech-body';
      var linesLabel = document.createElement('span');
      linesLabel.className = 'speech-label';
      linesLabel.textContent = '台词（一行一条）';
      var lines = document.createElement('textarea');
      lines.className = 'speech-lines';
      lines.rows = 3;
      lines.spellcheck = false;
      // Written per SOURCE in `showSpeech`, which runs on every change and on every settings snapshot.
      lines.placeholder = EMPTY_LINES_PLACEHOLDER.builtin;
      var promptLabel = document.createElement('span');
      promptLabel.className = 'speech-label';
      promptLabel.textContent = 'AI 生成提示词';
      var prompt = document.createElement('input');
      prompt.type = 'text';
      prompt.className = 'speech-prompt';
      prompt.spellcheck = false;
      prompt.placeholder = (core.DEFAULT_SPEECH_PROMPTS || {})[state] || '现在说一句。';
      body.appendChild(linesLabel);
      body.appendChild(lines);
      body.appendChild(promptLabel);
      body.appendChild(prompt);
      details.appendChild(body);
      wrap.appendChild(details);
      list.appendChild(wrap);
      speechRows[state] = { details: details, count: count, lines: lines, prompt: prompt };
    });
  }

  function bindSpeechControls() {
    var enabled = element('pref-speech');
    var hold = element('pref-speech-hold');
    var holdReset = element('pref-speech-hold-reset');
    var gap = element('pref-speech-gap');
    var gapReset = element('pref-speech-gap-reset');
    var idleMin = element('pref-speech-idle-min');
    var idleMax = element('pref-speech-idle-max');
    var idleReset = element('pref-speech-idle-reset');
    var workMin = element('pref-speech-work-min');
    var workMax = element('pref-speech-work-max');
    var workReset = element('pref-speech-work-reset');
    var source = element('pref-speech-source');
    var provider = element('pref-speech-provider');
    var dshProvider = element('pref-speech-dsh-provider');
    var dshModel = element('pref-speech-dsh-model');
    var baseUrl = element('pref-speech-base-url');
    var model = element('pref-speech-model');
    var apiKey = element('pref-speech-api-key');
    var keyClear = element('pref-speech-key-clear');
    var persona = element('pref-speech-persona');
    var temperature = element('pref-speech-temperature');
    var temperatureValue = element('pref-speech-temperature-value');
    var timeout = element('pref-speech-timeout');
    var testButton = element('pref-speech-test');
    var testState = element('pref-speech-test-state');
    var testResult = element('pref-speech-test-result');
    var llmNote = element('speech-llm-note');

    /**
     * Merge a patch into the speech settings, one more level deep than the host's own merge.
     *
     * `lines` and `ai.prompts` are OBJECTS OF OBJECTS: patching one state's lines without this would send
     * `{ lines: { working: … } }`, and a shallow merge would drop the other five states' boxes on the floor.
     */
    var mergeInto = function (target, patch) {
      Object.keys(patch || {}).forEach(function (key) {
        var value = patch[key];
        if (value && typeof value === 'object' && !Array.isArray(value)
          && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
          var next = {};
          Object.keys(target[key]).forEach(function (inner) { next[inner] = target[key][inner]; });
          mergeInto(next, value);
          target[key] = next;
        } else {
          target[key] = value;
        }
      });
      return target;
    };

    var writeSpeech = function (patch) {
      preferences.speech = core.cleanSpeech(mergeInto(core.cleanSpeech(preferences.speech), patch));
      persist();
      showSpeech();
    };

    /** Reflect the stored settings into every control, including the boxes the user is not editing. */
    function showSpeech() {
      var speech = core.cleanSpeech(preferences.speech);
      if (enabled) enabled.checked = speech.enabled !== false;
      if (hold) hold.value = String(speech.holdSeconds);
      if (gap) gap.value = String(speech.minGapSeconds);
      if (idleMin) idleMin.value = String(speech.idleMinSeconds);
      if (workMin) workMin.value = String(speech.workingMinSeconds);
      if (workMax) workMax.value = String(speech.workingMaxSeconds);
      if (idleMax) idleMax.value = String(speech.idleMaxSeconds);
      if (source) source.value = speech.source;
      /**
       * The AI HALF belongs to the AI source, and to nothing else.
       *
       * With 内置短语 the model is never asked — the shipped table IS what the pet says — so its provider, its
       * model, its persona, its temperature and 试一句 are controls for a feature that is not in use. Operator,
       * 2026-10-13: 「如果台词来源是内置台词，则下方的AI相关设置不显示」, and then, asked whether 自定义短语 should keep them:
       * 「自定义短语也隐藏」 — 自定义 talks from the user's own boxes and never calls a model either, so the block is
       * shown for ONE source: AI 生成.
       *
       * What is hidden is the BLOCK; the dsh/custom rows inside it keep their own toggle just below, because which
       * route the user had chosen is a setting rather than a visibility, and it has to be there again the moment
       * the source goes back to AI. The per-state boxes stay put too: a 台词 box is where 自定义短语's own lines
       * live, and the table they sit in is not an AI setting.
       */
      setRowHidden('speech-ai', !speechSourceIsAi());
      /**
       * What an empty box MEANS is a property of the SOURCE, so both the count beside each state and the box's own
       * placeholder say it in the source's own words: 内置短语 keeps the shipped line, AI generates from that state's
       * prompt, and 自定义 says nothing at all. Read from `speech.source` here rather than captured at build time, so
       * switching the source updates 17 labels at once (operator, 2026-10-11: "AI碎碎念开启后，面板里的各种状态后面就不应该写
       * '用内置短语'了，应该是写'用内置AI生成提示词'").
       */
      var emptyLabel = emptyLinesLabel(speech.source);
      var emptyPlaceholder = EMPTY_LINES_PLACEHOLDER[speech.source] || EMPTY_LINES_PLACEHOLDER.builtin;
      (core.SPEECH_STATES || []).forEach(function (state) {
        var row = speechRows[state];
        if (!row) return;
        var lines = speech.lines[state] || [];
        // A focused field is never rewritten: it would move the caret while the user is still typing in it.
        if (document.activeElement !== row.lines) row.lines.value = lines.join('\n');
        if (document.activeElement !== row.prompt) row.prompt.value = speech.ai.prompts[state] || '';
        if (row.lines.placeholder !== emptyPlaceholder) row.lines.placeholder = emptyPlaceholder;
        row.count.textContent = lines.length ? lines.length + ' 条' : emptyLabel;
      });
      if (provider) provider.value = speech.ai.provider;
      var custom = speech.ai.provider === 'custom';
      setRowHidden('speech-dsh-provider-row', custom);
      setRowHidden('speech-dsh-model-row', custom);
      setRowHidden('speech-custom-url-row', !custom);
      setRowHidden('speech-custom-model-row', !custom);
      setRowHidden('speech-custom-key-row', !custom);
      // The stored route survives a catalog that does not list it: an option is what makes it visible again.
      ensureOption(dshProvider, speech.ai.dshProvider);
      ensureOption(dshModel, speech.ai.dshModel);
      if (dshProvider && speech.ai.dshProvider) dshProvider.value = speech.ai.dshProvider;
      if (dshModel && speech.ai.dshModel) dshModel.value = speech.ai.dshModel;
      if (baseUrl && document.activeElement !== baseUrl) baseUrl.value = speech.ai.baseUrl;
      if (model && document.activeElement !== model) model.value = speech.ai.model;
      if (apiKey && document.activeElement !== apiKey) apiKey.value = speech.ai.apiKey;
      if (persona && document.activeElement !== persona) persona.value = speech.ai.persona;
      if (temperature) temperature.value = String(Math.round(speech.ai.temperature * 10));
      if (temperatureValue) temperatureValue.textContent = speech.ai.temperature.toFixed(2);
      if (timeout) timeout.value = String(Math.round(speech.ai.timeoutMs / 1000));
    }

    /**
     * What the picker is SHOWING while the store holds no answer of its own.
     *
     * A `<select>` with no matching value still displays its FIRST option, so a picker can read 「DeepSeek Account
     * / DeepSeek-V41-Flash」 while the store holds an empty `dshModel` — and 试一句 then answered 「失败：还没有选择 DSH
     * 的 provider 和模型」 while both controls looked configured (operator, 2026-10-12). What is adopted here is the
     * option the picker is ALREADY showing, so nothing on screen moves; only the store catches up, which is what
     * the host reads when a line is asked for.
     *
     * ONE-SHOT per catalog answer, and that bound matters: a host that answers a patch with a snapshot that does
     * not carry it would otherwise be adopted into and reverted out of, for ever.
     */
    function adoptCatalogChoice(dsh) {
      var speech = core.cleanSpeech(preferences.speech);
      var shownProvider = dshProvider ? dshProvider.value : '';
      var listed = String((dsh && dsh.provider) || '');
      var shownModel = dshModel ? dshModel.value : '';
      var adopted = {};
      if (!speech.ai.dshProvider && shownProvider) adopted.dshProvider = shownProvider;
      // The model list belongs to the provider that was ASKED about, so a list that arrived for another one
      // settles nothing here: it would be an id this route does not serve.
      var provider = adopted.dshProvider || speech.ai.dshProvider;
      if (!speech.ai.dshModel && shownModel && listed && listed === provider) adopted.dshModel = shownModel;
      if (!adopted.dshProvider && !adopted.dshModel) return null;
      // The adopted pair is returned even when it had to be HELD: the caller has to know which provider was just
      // settled, because that is the one whose models this answer did not carry.
      applyLlmChoice(adopted);
      return adopted;
    }

    /**
     * Which providers this app can actually reach, and — once one is chosen — that provider's models.
     *
     * Fetched live rather than stored, so the page cannot offer a route the running app does not have; the
     * model list is the expensive half, so it is asked for only when a provider is selected.
     */
    var loadLlm = function (wanted) {
      askedLlmProvider = wanted || '';
      return fetch('/vrmpet3d/llm' + (wanted ? '?provider=' + encodeURIComponent(wanted) : ''), { credentials: 'omit' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (body) {
          if (!body) return;
          speechLlm = body;
          var dsh = body.dsh || {};
          if (dshProvider && wanted !== undefined) {
            clearOptions(dshProvider);
            (dsh.providers || []).forEach(function (entry) {
              var option = document.createElement('option');
              option.value = entry.id;
              option.textContent = entry.name || entry.id;
              dshProvider.appendChild(option);
            });
            ensureOption(dshProvider, core.cleanSpeech(preferences.speech).ai.dshProvider);
          }
          if (dshModel && Array.isArray(dsh.models)) {
            var chosen = core.cleanSpeech(preferences.speech).ai.dshModel;
            clearOptions(dshModel);
            dsh.models.forEach(function (entry) {
              var option = document.createElement('option');
              option.value = entry.id;
              option.textContent = entry.name || entry.id;
              dshModel.appendChild(option);
            });
            ensureOption(dshModel, chosen);
          }
          if (llmNote) {
            var parts = [dsh.available
              ? 'DSH 的 LLM 服务可用（' + (dsh.providers || []).length + ' 个 provider）'
              : '这个 DSH 没有可用的 LLM 服务，AI 碎碎念只能用自定义 Provider'];
            if (dsh.available && !(dsh.providers || []).length) parts.push('还没有配置任何 provider');
            if (dsh.available && dsh.provider && !(dsh.models || []).length) {
              parts.push('这个 provider 没有返回任何模型');
            }
            if (dsh.error) parts.push('读取失败：' + dsh.error);
            parts.push('自定义 Provider 用 OpenAI 兼容的 /chat/completions。');
            llmNote.textContent = parts.join('；');
          }
          showSpeech();
          /**
           * The pickers now hold what the catalog offered; the STORE may not. See `adoptCatalogChoice`.
           *
           * Then, an answer that carried no model list cannot settle the model, so the provider it just adopted
           * is asked about ONCE — and `adopted` is what names it, because a pair that had to be HELD until the
           * first snapshot is not in `preferences` yet and its models would otherwise never be asked for. The
           * check is against the provider the ANSWER named rather than the one that was requested, so a host
           * that ignores `?provider=` is asked once and not for ever.
           */
          var adopted = adoptCatalogChoice(dsh);
          var route = (adopted && adopted.dshProvider) || core.cleanSpeech(preferences.speech).ai.dshProvider;
          if (route && route !== String(dsh.provider || '') && askedLlmProvider !== route) loadLlm(route);
          /**
           * LAST, and only here: the readout has to describe what is on screen, and the adoption above can fill
           * the store with no user gesture to publish it — a settings snapshot publishes when IT lands, which
           * may have been before this answer.
           */
          publish();
        })
        .catch(function () {
          if (llmNote) llmNote.textContent = '读不到 provider 列表（宿主没有回应）。';
        });
    };

    if (enabled) enabled.addEventListener('change', function () { writeSpeech({ enabled: enabled.checked === true }); });
    if (hold) hold.addEventListener('change', function () { writeSpeech({ holdSeconds: Number(hold.value) }); });
    if (holdReset) holdReset.addEventListener('click', function () { writeSpeech({ holdSeconds: core.DEFAULT_SPEECH.holdSeconds }); });
    if (gap) gap.addEventListener('change', function () { writeSpeech({ minGapSeconds: Number(gap.value) }); });
    if (gapReset) gapReset.addEventListener('click', function () { writeSpeech({ minGapSeconds: core.DEFAULT_SPEECH.minGapSeconds }); });
    if (idleMin) idleMin.addEventListener('change', function () { writeSpeech({ idleMinSeconds: Number(idleMin.value) }); });
    if (idleMax) idleMax.addEventListener('change', function () { writeSpeech({ idleMaxSeconds: Number(idleMax.value) }); });
    if (workMin) workMin.addEventListener('change', function () { writeSpeech({ workingMinSeconds: Number(workMin.value) }); });
    if (workMax) workMax.addEventListener('change', function () { writeSpeech({ workingMaxSeconds: Number(workMax.value) }); });
    if (workReset) {
      workReset.addEventListener('click', function () {
        writeSpeech({
          workingMinSeconds: core.DEFAULT_SPEECH.workingMinSeconds,
          workingMaxSeconds: core.DEFAULT_SPEECH.workingMaxSeconds,
        });
      });
    }
    if (idleReset) {
      idleReset.addEventListener('click', function () {
        writeSpeech({
          idleMinSeconds: core.DEFAULT_SPEECH.idleMinSeconds,
          idleMaxSeconds: core.DEFAULT_SPEECH.idleMaxSeconds,
        });
      });
    }

    /**
     * The source itself. NO 部位 repaint is issued here, and that is a measured fact rather than an omission: the
     * 部位 table lives on the OTHER page (模型参数, `#part-body`) while this picker is on 通用设置, so `renderParts`
     * would return before doing anything (`element('part-body')` is null). What carries a source change to that
     * table is the path that already exists for every cross-document edit — the `storage` listener below, which
     * repaints the parts table when another document writes the store — and a page loaded later renders it from the
     * stored source in the first place. Both read `core.cleanSpeech(preferences.speech).source` at draw time.
     */
    if (source) {
      source.addEventListener('change', function () {
        /**
         * The per-clip 提示词 boxes are repainted FIRST, because their visibility is this same rule.
         *
         * They are built by `renderMotions` — a different section of the page from the AI block that
         * `showSpeech` hides — so without this redraw a source switched to 内置短语 would leave a row of
         * prompt boxes on screen describing a feature that is no longer in use. `showSpeech` is called by the
         * write below, so the order here is only about the two sections agreeing on the value the user just
         * picked.
         */
        renderMotions();
        writeSpeech({ source: source.value });
      });
    }

    // The per-state boxes. `change` rather than `input`: one write per finished edit, not per keystroke.
    (core.SPEECH_STATES || []).forEach(function (state) {
      var row = speechRows[state];
      // Bound once per row: `renderAll` runs this again on every snapshot, and a second `change` listener
      // would write the same value twice.
      if (!row || row.bound) return;
      row.bound = true;
      row.lines.addEventListener('change', function () {
        var lines = {};
        lines[state] = row.lines.value;
        writeSpeech({ lines: lines });
      });
      row.prompt.addEventListener('change', function () {
        var prompts = {};
        prompts[state] = row.prompt.value;
        writeSpeech({ ai: { prompts: prompts } });
      });
    });

    if (provider) {
      provider.addEventListener('change', function () { writeSpeech({ ai: { provider: provider.value } }); });
    }
    if (dshProvider) {
      dshProvider.addEventListener('change', function () {
        // A model belongs to a provider, so changing the provider clears the model rather than leaving a pair
        // that no adapter can serve.
        writeSpeech({ ai: { dshProvider: dshProvider.value, dshModel: '' } });
        /**
         * And the model PICKER is emptied with it. Its options belong to the provider that is no longer chosen,
         * and a select whose options do not match the stored value still shows its first one — which is how
         * 试一句 came to be told 「还没有选择 DSH 的 provider 和模型」 by a window whose two pickers both read as
         * configured. The fetch below refills it, and until it answers the row shows nothing rather than a model
         * this provider may not serve.
         */
        clearOptions(dshModel);
        loadLlm(dshProvider.value);
      });
    }
    if (dshModel) {
      dshModel.addEventListener('change', function () { writeSpeech({ ai: { dshModel: dshModel.value } }); });
    }
    if (baseUrl) baseUrl.addEventListener('change', function () { writeSpeech({ ai: { baseUrl: baseUrl.value } }); });
    if (model) model.addEventListener('change', function () { writeSpeech({ ai: { model: model.value } }); });
    if (apiKey) apiKey.addEventListener('change', function () { writeSpeech({ ai: { apiKey: apiKey.value } }); });
    if (keyClear) keyClear.addEventListener('click', function () { writeSpeech({ ai: { apiKey: '' } }); });
    if (persona) persona.addEventListener('change', function () { writeSpeech({ ai: { persona: persona.value } }); });
    if (temperature) {
      temperature.addEventListener('input', function () {
        writeSpeech({ ai: { temperature: Number(temperature.value) / 10 } });
      });
    }
    if (timeout) {
      timeout.addEventListener('change', function () { writeSpeech({ ai: { timeoutMs: Number(timeout.value) * 1000 } }); });
    }

    if (testState && !testState.firstChild) {
      (core.SPEECH_STATES || []).forEach(function (state) {
        var option = document.createElement('option');
        option.value = state;
        option.textContent = speechStateName(state);
        testState.appendChild(option);
      });
      testState.value = 'working';
    }
    /**
     * 试一句: the one control that asks the host to generate a line RIGHT NOW.
     *
     * It ignores the source switch on purpose — this is how a user finds out whether their key, URL, provider or
     * prompt works, and it has to answer while the pet is set to `builtin` too. The answer is shown verbatim,
     * including the host's own refusal text.
     *
     * The answer lands IN THIS ROW — the markup puts the line beside 生成, not at the top of the AI block, where
     * the operator could not find it (2026-10-12: "报错的提示位置和「生成」按钮太远") — and a refusal is the one
     * answer worth colouring, which is what `warn` is for.
     */
    var showTestResult = function (text, failed) {
      if (!testResult) return;
      testResult.textContent = text;
      testResult.className = failed ? 'hint warn' : 'hint';
    };
    if (testButton) {
      testButton.addEventListener('click', function () {
        var state = testState && (core.SPEECH_STATES || []).indexOf(testState.value) !== -1 ? testState.value : 'working';
        showTestResult('生成中…', false);
        // One at a time: the host refuses a second call while the first is running, and that refusal would
        // otherwise land on top of the answer the user is waiting for.
        testButton.disabled = true;
        var settle = function () { testButton.disabled = false; };
        fetch('/vrmpet3d/say', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ state: state, language: 'zh' }),
        }).then(function (response) { return response.json(); })
          .then(function (body) {
            settle();
            if (body && body.text) {
              showTestResult('「' + body.text + '」' + (Number.isFinite(body.ms) ? '（' + body.ms + ' ms）' : ''), false);
            } else {
              showTestResult('失败：' + ((body && body.error) || '宿主没有回应'), true);
            }
          })
          .catch(function (error) {
            settle();
            showTestResult('失败：' + (error && error.message), true);
          });
      });
    }

    renderSpeechStates();
    showSpeech();
    loadLlm(core.cleanSpeech(preferences.speech).ai.dshProvider || '');
  }

  /**
   * The 视线 section: the gaze response curve and the two full-deflection distances.
   *
   * Both are SETTINGS rather than constants in the renderer (they were `GAZE_CURVE_EDGE_SLOPE` and a fixed
   * span), because the right shape depends on the display and on the person: on a wide monitor the default
   * span makes the head turn very little, and anyone who wants it livelier lowers the curve's edge slope
   * instead of reaching for a different pet. `0` in either span field means AUTO — the frame's own width —
   * and the hint under the row says which number that resolves to for the floating window.
   */
  function bindGazeControls() {
    var curve = element('pref-gaze-curve');
    var curveValue = element('pref-gaze-curve-value');
    var curveReset = element('pref-gaze-curve-reset');
    var spanX = element('pref-gaze-span-x');
    var spanY = element('pref-gaze-span-y');
    var spanReset = element('pref-gaze-span-reset');
    var idle = element('pref-gaze-idle');
    var idleReset = element('pref-gaze-idle-reset');
    // The draught's four numbers live in the same section — one place for everything that answers "how does the
    // pet react to my cursor". See 鼠标互动 in the page.
    var windPower = element('pref-wind-power');
    var windPowerValue = element('pref-wind-power-value');
    var windPowerReset = element('pref-wind-power-reset');
    var windRadius = element('pref-wind-radius');
    var windRadiusValue = element('pref-wind-radius-value');
    var windRadiusReset = element('pref-wind-radius-reset');
    var windDecay = element('pref-wind-decay');
    var windDecayReset = element('pref-wind-decay-reset');
    var windSpeed = element('pref-wind-speed');
    var windSpeedReset = element('pref-wind-speed-reset');

    var write = function (key, value) {
      preferences[key] = value;
      persist();
    };
    var showCurve = function () {
      var slope = Number(preferences.gazeCurve);
      if (curveValue) curveValue.textContent = slope.toFixed(2) + (slope >= 0.995 ? '（直线）' : '');
      if (curve) curve.value = String(Math.round(slope * 100));
    };
    var showSpans = function () {
      if (spanX) spanX.value = String(Math.round(Number(preferences.gazeSpanX) || 0));
      if (spanY) spanY.value = String(Math.round(Number(preferences.gazeSpanY) || 0));
    };
    var showIdle = function () {
      if (idle) idle.value = String(Math.round(Number(preferences.gazeIdleSeconds) || 0));
    };
    /**
     * The four draught numbers.
     *
     * The slider positions are derived from the value rather than the other way round, so a stored profile that
     * holds something outside the shipped range still shows truthfully — the cleaner is what enforces the range.
     */
    var showWind = function () {
      var power = Number(preferences.windPower);
      if (windPowerValue) windPowerValue.textContent = (Number.isFinite(power) ? power : 0).toFixed(2);
      if (windPower) windPower.value = String(Math.round((Number.isFinite(power) ? power : 0) * 100));
      var radius = Number(preferences.windRadius);
      if (windRadiusValue) {
        windRadiusValue.textContent = Math.round((Number.isFinite(radius) ? radius : 0) * 100) + '%'
          + (radius <= 0 ? '（全局）' : '');
      }
      if (windRadius) windRadius.value = String(Math.round((Number.isFinite(radius) ? radius : 0) * 100));
      if (windDecay) windDecay.value = String(Number(preferences.windDecay));
      if (windSpeed) windSpeed.value = String(Math.round(Number(preferences.windSpeedForMax)));
    };

    if (curve) {
      curve.addEventListener('input', function () {
        write('gazeCurve', Number(curve.value) / 100);
        showCurve();
      });
    }
    if (curveReset) {
      curveReset.addEventListener('click', function () {
        write('gazeCurve', core.DEFAULTS.gazeCurve);
        showCurve();
      });
    }
    if (spanX) {
      spanX.addEventListener('change', function () {
        write('gazeSpanX', Math.max(0, Number(spanX.value) || 0));
        showSpans();
      });
    }
    if (spanY) {
      spanY.addEventListener('change', function () {
        write('gazeSpanY', Math.max(0, Number(spanY.value) || 0));
        showSpans();
      });
    }
    if (spanReset) {
      spanReset.addEventListener('click', function () {
        write('gazeSpanX', core.DEFAULTS.gazeSpanX);
        write('gazeSpanY', core.DEFAULTS.gazeSpanY);
        showSpans();
      });
    }
    if (idle) {
      idle.addEventListener('change', function () {
        // 0 is a real choice here — it turns the idle rule off — so an empty or unparseable field means 0
        // rather than "leave it alone": the hint says so, and a cleared box that silently kept 5 would be the
        // opposite of what this control is for (debugging the gaze).
        write('gazeIdleSeconds', Math.max(0, Number(idle.value) || 0));
        showIdle();
      });
    }
    if (idleReset) {
      idleReset.addEventListener('click', function () {
        write('gazeIdleSeconds', core.DEFAULTS.gazeIdleSeconds);
        showIdle();
      });
    }
    // ---- the cursor's draught -------------------------------------------------
    if (windPower) {
      windPower.addEventListener('input', function () {
        write('windPower', Number(windPower.value) / 100);
        showWind();
      });
    }
    if (windPowerReset) {
      windPowerReset.addEventListener('click', function () {
        write('windPower', core.DEFAULTS.windPower);
        showWind();
      });
    }
    if (windRadius) {
      windRadius.addEventListener('input', function () {
        // 0 means GLOBAL here, which is a real choice the hint spells out: it is the shape the operator rejected
        // once, and being able to switch back is how they can tell the two apart by feel.
        write('windRadius', Number(windRadius.value) / 100);
        showWind();
      });
    }
    if (windRadiusReset) {
      windRadiusReset.addEventListener('click', function () {
        write('windRadius', core.DEFAULTS.windRadius);
        showWind();
      });
    }
    if (windDecay) {
      windDecay.addEventListener('change', function () {
        write('windDecay', Math.max(0.02, Number(windDecay.value) || core.DEFAULTS.windDecay));
        showWind();
      });
    }
    if (windDecayReset) {
      windDecayReset.addEventListener('click', function () {
        write('windDecay', core.DEFAULTS.windDecay);
        showWind();
      });
    }
    if (windSpeed) {
      windSpeed.addEventListener('change', function () {
        write('windSpeedForMax', Math.max(100, Number(windSpeed.value) || core.DEFAULTS.windSpeedForMax));
        showWind();
      });
    }
    if (windSpeedReset) {
      windSpeedReset.addEventListener('click', function () {
        write('windSpeedForMax', core.DEFAULTS.windSpeedForMax);
        showWind();
      });
    }
    showCurve();
    showSpans();
    showIdle();
    showWind();
  }

  /**
   * What is showing the pet right now.
   *
   * The page never talks to a renderer, so this is how it can still say whether a change will land on
   * something visible: the host knows whether the floating window is up, and its answer is the truth
   * about "is anything drawing this model".
   */
  function refreshStatus() {
    return fetch('/vrmpet3d/desktop', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (status) {
        if (!status) {
          setStatus('悬浮窗不可用（宿主没有提供 /vrmpet3d/desktop）；app 内的宠物仍会跟随这些设置。');
          return null;
        }
        var page = status.page || {};
        if (status.modelId) live.window = status.modelId;
        // Say what each surface is showing, because that is what a spring override is keyed by: a user
        // configuring a model nobody is showing would otherwise see sliders that do nothing.
        var parts = [];
        parts.push('模型 ' + modelIdInUse() + '（两个界面共用）');
        parts.push('悬浮窗 ' + (status.running ? '运行中' : '未开启'));
        setStatus(parts.join(' · '));
        var shown = status.running
          ? '悬浮窗运行中' + (page.ready ? '（已渲染，模型 ' + (status.modelId || '?') + '）' : '（页面还没就绪）')
          : '悬浮窗未开启';
        setStatus('当前模型：' + modelIdInUse() + ' · ' + shown + ' · app 内宠物同样跟随设置');
        // What "自动" resolves to, for the surface the user is most likely looking at. The host reports the
        // work area, and the floating pet's horizontal full deflection IS that width.
        var auto = element('pref-gaze-span-auto');
        if (auto) {
          var work = status.display && status.display.workArea ? Math.round(status.display.workArea.width) : 0;
          auto.textContent = work > 0 ? '（当前 ' + work + ' px）' : '（宿主没有报告屏幕尺寸）';
        }
        showAppliedGaze(status);
        return status;
      })
      .catch(function () {
        setStatus('未能读取悬浮窗状态；改动仍会写入设置。', 'warn');
        return null;
      });
  }

  /**
   * What the RENDERER is doing with the gaze, as opposed to what this page has stored.
   *
   * This line exists because of a report that could not be answered from the window: "the gaze curve doesn't
   * take effect live". It did — the patch reaches the host, the host bumps its version, and both surfaces feed
   * `preferences.gazeCurve` into `core.pointerAim` every frame — but the visible effect is small when the
   * cursor is near the pet (at 10 % of full deflection, a curve of 0.4 turns the head ~22 % and a curve of 1.0
   * only ~10 %), and nothing on the page said which curve the head was actually using. So the number comes
   * from the running pet, through `/vrmpet3d/desktop`, and includes the aim of the LAST frame — which is what
   * separates "the setting never arrived" from "it arrived and the pet is barely off centre".
   */
  function showAppliedGaze(status) {
    var host = element('pref-gaze-applied');
    var gaze = status && status.page ? status.page.gaze : null;
    if (!status || !status.running || !gaze || typeof gaze.curve !== 'number') {
      live.appliedGaze = null;
    } else {
      live.appliedGaze = {
        curve: Number(gaze.curve),
        spanX: Math.round(Number(gaze.spanX) || 0),
        spanY: Math.round(Number(gaze.spanY) || 0),
        aim: { x: Number((gaze.aim && gaze.aim.x) || 0), y: Number((gaze.aim && gaze.aim.y) || 0) },
      };
    }
    if (!host) return;
    if (!status || !status.running) {
      host.textContent = '悬浮窗未开启：看不到实时数值，但设置已经写入，app 内的宠物同样使用它。';
      return;
    }
    if (!live.appliedGaze) {
      // A window from before this diagnostic existed: say so rather than showing a stale number.
      host.textContent = '悬浮窗还没有报告视线数值（重启悬浮窗后这里会显示它实际使用的曲率与朝向）。';
      return;
    }
    var aim = live.appliedGaze;
    host.textContent = '渲染器正在使用：曲率 ' + aim.curve.toFixed(2)
      + ' · 满偏 ' + aim.spanX + '×' + aim.spanY + ' px'
      + ' · 当前视线 ' + aim.aim.x.toFixed(2) + ', ' + aim.aim.y.toFixed(2)
      + '（每 2 秒读取一次；如果它随滑杆变化，就说明改动已经到达渲染器）';
  }

  function bindModelSelect() {
    var select = element('model-select');
    if (!select) return;
    select.addEventListener('change', function () {
      // There is ONE model, so choosing it here switches every surface - the app's pet, the floating
      // window and this page - and that is the point rather than a side effect.
      preferences.modelId = select.value;
      persist();
      renderSprings();
      loadModelInfo();
      refreshStatus();
    });
  }

  /**
   * The two resets that are not a control's own 复位 button: the 弹簧骨 section's 全部恢复默认.
   *
   * The `#footer-note` write that used to live here is gone with the element: it filled the page's footer with a
   * sentence explaining where the settings live, which is exactly the kind of prose the operator asked to have
   * removed, and it was the only thing `ensureStatusElements` had to create for a page that no longer wanted it.
   */
  function bindResets() {
    var all = element('spring-reset-all');
    if (all) all.addEventListener('click', resetAllSprings);
    /**
     * 「动作播放时 头发与裙摆继续摆动」 — one boolean, written through the same cleaner every other preference uses, so
     * an older stored profile (which has no such key) reads as ON rather than as a special case here.
     */
    var motionPhysics = element('spring-motion-physics');
    if (motionPhysics) {
      motionPhysics.addEventListener('change', function () {
        preferences.motionPhysics = motionPhysics.checked;
        persist();
      });
    }
    /**
     * …and the collider switch beside it. Live rather than load-time: `lib/scene.js` remembers the model's own groups and
     * re-applies the filter on every preference push, so picking 关闭 / 身体组 / 全部 here changes the next frame — which is
     * the only way to answer 「是不是穿模」 by looking at both states in one sitting (operator, 2026-10-14: 「开body组测试一下」).
     */
    var springColliders = element('spring-colliders');
    if (springColliders) {
      springColliders.addEventListener('change', function () {
        var wanted = ['off', 'all', 'custom'].indexOf(springColliders.value) !== -1 ? springColliders.value : 'off';
        preferences.springColliders = wanted;
        // The panel belongs to 自定义, so switching modes re-renders it rather than waiting for the next model read.
        renderColliderDetail(modelInfo);
        persist();
      });
    }
  }

  // The page re-reads its own preferences when another document writes them, so two open settings
  // windows (or a change made from the app panel) stay in step instead of overwriting each other.
  globalThis.addEventListener('storage', function (event) {
    if (event && event.key && event.key !== STORE) return;
    preferences = readPreferences();
    renderBehaviour();
    renderParts();
    renderSprings();
    renderMotions();
    bindPreferenceControls();
  });

  /**
   * What this page ended up showing.
   *
   * Published for the same reason the pet page publishes its own state: "the window opened" and "the
   * window has something in it" are different claims, and only the page can make the second one. A live
   * check reads this to see that a real model's expressions and spring chains arrived.
   */
  function publish() {
    // The emotion table is what the 表情 section renders now: one row per trigger, with a 「无」 box and the
    // model's own labels. The standalone expression/mouth table was removed on 2026-10-09, so this counts
    // the rows that are actually there.
    var rows = element('emotion-body') ? element('emotion-body').querySelectorAll('tr').length : 0;
    var chains = element('spring-list') ? element('spring-list').querySelectorAll('.chain').length : 0;
    /**
     * The folding group, reported so a live check can tell "there was nothing to fold" from "the fold is there
     * and shut" — the two look identical in a screenshot of a collapsed list.
     */
    var springFold = element('spring-list') ? element('spring-list').querySelector('details.spring-more') : null;
    globalThis.__VRMPET3D_CONFIG_STATE__ = {
      ready: true,
      /**
       * WHICH PAGE this window is.
       *
       * Published because the two windows are otherwise indistinguishable from a readout: the 通用设置 page and a
       * model's 参数 page run the same script, and a check that could not tell them apart would pass a build that
       * opened the same page twice. The value is the page's own `data-page` attribute (read here rather than
       * inferred from the section lists), so a check can compare it against the markup that was actually served —
       * `lib/config-page.html` declares `model` and `lib/global-page.html` declares `global`.
       */
      page: pageName(),
      model: modelIdInUse(),
      /**
       * The options the model picker actually holds.
       *
       * Published because the failure this replaces was invisible from every other angle: the list carried a
       * synthetic `placeholder` entry — 占位模型（内置）— which, once the built-in avatar was removed, selected a
       * model that draws NOTHING. The dropdown offered an empty pet and nothing in the page state said so. The
       * ids make that unrepresentable in a check.
       */
      modelOptions: (function () {
        var select = element('model-select');
        if (!select) return null;
        var ids = [];
        for (var i = 0; i < select.options.length; i += 1) ids.push(select.options[i].value);
        return ids;
      })(),
      supported: Boolean(modelInfo && modelInfo.supported),
      expressions: modelInfo && Array.isArray(modelInfo.expressions) ? modelInfo.expressions.length : 0,
      // Renamed with the table it counts: this is the EMOTION table's row count (one per trigger), which is
      // the 表情 section now. `expressionRows` counted the table that was removed on 2026-10-09.
      emotionRows: rows,
      /**
       * The EXPRESSION pickers, in both tables: one dropdown per row, and none of their checkboxes left in the row.
       *
       * Published because "the checkboxes are gone" is the point of the change (operator, 2026-10-11: "把所有的表情都用
       * 下拉框的多选列表，不要直接用checkbox堆积在一起") and a stray pile left in a cell would be invisible from every
       * other count here — `inlineBoxes` is how many expression checkboxes sit OUTSIDE a menu, and it has to be zero.
       */
      pickers: (function () {
        var buttons = document.querySelectorAll('.pick-select');
        var inlineBoxes = 0;
        // Only the EXPRESSION boxes are counted (they carry `data-name`), and only those NOT inside a menu: a row's
        // 使用 checkbox is not an expression choice and is meant to stay where it is.
        var all = document.querySelectorAll('#emotion-body input[data-name], #part-body input[data-name]');
        for (var i = 0; i < all.length; i += 1) {
          if (!all[i].closest || !all[i].closest('.pick-menu')) inlineBoxes += 1;
        }
        var openMenu = document.querySelector('.pick-menu');
        /**
         * Whether the menu is BOUNDED — the property that matters, rather than "does it overflow right now".
         *
         * A model with four expressions produces a menu shorter than its ceiling, so `scrollHeight > clientHeight`
         * would be false on it while the CSS is exactly what keeps a twenty-expression model from growing the row:
         * the computed style is what is published, `overflow-y: auto` plus a real pixel `max-height`.
         */
        var style = openMenu && globalThis.getComputedStyle ? globalThis.getComputedStyle(openMenu) : null;
        return {
          buttons: buttons.length,
          emotionRows: rows,
          inlineBoxes: inlineBoxes,
          menuOpen: Boolean(openMenu),
          menuBoxes: openMenu ? openMenu.querySelectorAll('input[data-name]').length : 0,
          menuScrolls: Boolean(openMenu) && openMenu.scrollHeight > openMenu.clientHeight,
          menuOverflow: style ? style.overflowY : null,
          menuMaxHeight: style ? style.maxHeight : null,
          menuBounded: Boolean(style) && style.overflowY === 'auto' && /px$/.test(String(style.maxHeight)),
        };
      })(),
      /**
       * The 部位 section: how many parts, how many structures they own, and how many of those the name alone
       * could not place.
       *
       * `unrecognised` is the number that says whether this section is doing its job: a model whose rig is
       * `LiuHai`/`DaiMao`/`WeiBa` has structures the heuristic answers `null` for, and those are exactly the ones
       * a user builds a part for. `picked` is the model's structure count, so "the picker is empty" is
       * distinguishable from "no part owns anything yet"; `pickerRows` and `pickerScrolls` are the panel itself,
       * which is the part that has to be scrollable.
       */
      parts: (function () {
        var items = preferences.parts.items;
        var structures = modelStructures();
        /**
         * Whether the shipped PART lines are in the pet's chain at all, which is a property of 台词来源 rather than
         * of the row: `speaking` below is published so "this row has a built-in voice" and "the pet would say it"
         * cannot be read as the same fact. The shipped PROMPT is not part of that switch — it is the instruction the
         * host sends the model, and it is the whole reason it exists in AI mode.
         */
        var builtinSource = core.cleanSpeech(preferences.speech).source === 'builtin';
        var unrecognised = 0;
        for (var i = 0; i < structures.length; i += 1) {
          if (!core.structureRegionOf(structures[i].name)) unrecognised += 1;
        }
        var chips = element('part-body') ? element('part-body').querySelectorAll('.chip').length : 0;
        var speechBoxes = element('part-body') ? element('part-body').querySelectorAll('.part-lines').length : 0;
        var prompts = element('part-body') ? element('part-body').querySelectorAll('.part-prompt').length : 0;
        /**
         * The DISTINCT grey hints the AI-prompt boxes actually carry, so "every part looks the same" is a fact
         * about the DOM rather than a claim about the code (operator, 2026-10-13: no part may show a hint of its
         * own, 胸部 and 屁股 included).
         */
        var promptHints = [];
        if (element('part-body')) {
          var promptNodes = element('part-body').querySelectorAll('.part-prompt');
          for (var h = 0; h < promptNodes.length; h += 1) {
            var hint = String(promptNodes[h].placeholder || '');
            if (promptHints.indexOf(hint) === -1) promptHints.push(hint);
          }
        }
        /** The same for the 碎碎念 boxes: the distinct grey hints they actually carry. */
        var lineHints = [];
        if (element('part-body')) {
          var lineNodes = element('part-body').querySelectorAll('.part-lines');
          for (var n = 0; n < lineNodes.length; n += 1) {
            var lineHint = String(lineNodes[n].placeholder || '');
            if (lineHints.indexOf(lineHint) === -1) lineHints.push(lineHint);
          }
        }
        // The CONTROL rows only: every part also draws a detail row underneath it, and counting both would make
        // "five parts" and "ten rows" the same number to a reader.
        var rowsDrawn = element('part-body')
          ? element('part-body').querySelectorAll('tr:not(.part-detail)').length
          : 0;
        var detailRows = element('part-body') ? element('part-body').querySelectorAll('tr.part-detail').length : 0;
        return {
          count: items.length,
          labels: items.map(function (item) { return item.label; }),
          structures: items.reduce(function (total, item) { return total + item.match.length; }, 0),
          withLines: items.filter(function (item) { return item.speech.lines.length > 0; }).length,
          withPrompt: items.filter(function (item) { return item.speech.prompt !== ''; }).length,
          /**
           * And the parts whose voice comes from the shipped table rather than from a box.
           *
           * Published because the requirement is an empty box that still has a voice (operator, 2026-10-12: "匹配词和
           * AI提示词写进系统底层，AI提示词那里默认留空，跟未输入状态一样"). An empty box that means silence and an empty
           * box that means 变态！ are the same DOM from every other angle; `boxEmpty` travels beside the defaults so
           * this pair cannot be satisfied by writing them into the user's own settings instead.
           *
           * `lines` is the TABLE's own content, so it stays readable while the source has it switched off; `speaking`
           * says whether the pet would say it right now (operator, 2026-10-12: "如果设置了AI碎碎念，就停止输出内置的碎碎念").
           *
           * Since 2026-10-14 the table has TWO pools per region (点击 / 长按), so the readout publishes both — `lines`
           * is the click pool and `holdLines` the long-press one, both in Chinese, which is the language this page
           * speaks. It reads them with `tableAllowed` TRUE for the reason above: a readout is not a source.
           */
          builtinSpeech: items.filter(function (item) {
            return !item.speech.lines.length && !item.speech.prompt;
          }).map(function (item) {
            var builtinLines = core.partSpeechLines ? core.partSpeechLines(item, true, 'zh', 'click') : [];
            var builtinHold = core.partSpeechLines ? core.partSpeechLines(item, true, 'zh', 'hold') : [];
            var builtinPrompt = core.partSpeechPrompt ? core.partSpeechPrompt(item) : '';
            if (!builtinLines.length && !builtinHold.length && !builtinPrompt) return null;
            return {
              label: item.label,
              region: item.region,
              lines: builtinLines.slice(),
              holdLines: builtinHold.slice(),
              prompt: builtinPrompt,
              boxEmpty: item.speech.lines.length === 0 && item.speech.prompt === '',
              speaking: builtinSource,
            };
          }).filter(Boolean),
          rowsDrawn: rowsDrawn,
          detailRows: detailRows,
          chips: chips,
          speechBoxes: speechBoxes,
          prompts: prompts,
          promptHints: promptHints,
          lineHints: lineHints,
          picked: structures.length,
          unrecognised: unrecognised,
          max: core.PARTS_LIMITS.maxItems,
          /**
           * The BROWSER panel as it stands: how many rows it holds, whether it is open, and whether those rows
           * overflow the box.
           *
           * Published because the report that started this was "下拉框无法滚动，也没有滚动条": a panel that renders
           * 160 rows inside a 0-height box looks identical to a working one from every other angle.
           */
          picker: (function () {
            var list = element('part-picker-list');
            var panel = element('part-picker');
            return {
              open: Boolean(panel) && panel.hidden === false,
              rows: list ? list.querySelectorAll('.part-picker-row').length : 0,
              scrollHeight: list ? list.scrollHeight : 0,
              clientHeight: list ? list.clientHeight : 0,
              scrolls: Boolean(list) && list.scrollHeight > list.clientHeight + 1,
            };
          })(),
        };
      })(),
      springs: modelInfo && modelInfo.springs && Array.isArray(modelInfo.springs.groups) ? modelInfo.springs.groups.length : 0,
      springChains: chains,
      // Shut by default when there are more than five chains, and ONLY then.
      springFolded: springFold ? { open: springFold.open === true, chains: chains } : null,
      pinned: Object.keys((preferences.expressions && preferences.expressions.weights) || {}).length,
      /**
       * The two size controls and the two numbers behind them.
       *
       * Published as a PAIR because they used to be one shared key: "the floating window went back to the
       * in-app pet's size" is exactly one of these moving when the other does, and a check that cannot see
       * both cannot tell that apart from "the section did not render".
       */
      sizes: {
        app: Number(preferences.size),
        window: Number(preferences.windowSize),
        controls: Boolean(element('pref-size') && element('pref-window-size')),
      },
      /**
       * 空闲休眠 — the nap timeout, published with the control that owns it.
       *
       * `control` false and `selected` disagreeing with `value` are two different failures: a page that does not
       * carry the row at all, and a row that rendered but is not bound to the store — which is exactly how the
       * deleted panel's own nap row could have looked while writing nothing.
       */
      sleep: {
        value: Number(preferences.sleepAfterMs),
        control: Boolean(element('pref-sleep')),
        selected: element('pref-sleep') ? Number(element('pref-sleep').value) : null,
        options: element('pref-sleep') ? element('pref-sleep').options.length : 0,
      },
      /**
       * 调试模式 — the switch that puts BOTH surfaces on screen, published with the preference behind it.
       *
       * The three fields answer the three ways this can fail, and they are not the same failure: `control`
       * false is a page that does not carry the row at all, and `checked` disagreeing with `surface` is a box
       * that rendered but is not bound — which is exactly how a debug switch looks like it works while doing
       * nothing. The value is the preference itself, so a check can see that clearing the box really wrote
       * 自动 rather than merely unticking.
       */
      debugMode: {
        surface: preferences.petSurface || 'auto',
        control: Boolean(element('pref-both')),
        checked: Boolean(element('pref-both') && element('pref-both').checked),
      },
      /**
       * The 碎碎念 controls, and the numbers behind them.
       *
       * Published for the same reason every other section is: "the section did not render" and "it rendered
       * with the stored values" must be distinguishable from outside, and the throttle's four numbers are what
       * a live check can compare against what was stored.
       *
       * The per-state boxes and the AI half are reported as COUNTS and FLAGS — `stateRows`, `lineBoxes`, the
       * per-state `lineCounts`, the provider choice, the models the live catalog offered — so "six boxes
       * rendered" is checkable without reading Chinese labels off the screen. The KEY is published as a boolean
       * and never as itself: this readout is printed by the suites, and a credential in a test log is a
       * credential leaked.
       */
      speech: (function () {
        var speech = core.cleanSpeech(preferences.speech);
        speech.controls = Boolean(element('pref-speech') && element('pref-speech-hold') && element('pref-speech-idle-min')
          && element('pref-speech-work-min'));
        var list = element('speech-states');
        speech.stateRows = list ? list.querySelectorAll('.speech-state').length : 0;
        speech.lineBoxes = list ? list.querySelectorAll('textarea.speech-lines').length : 0;
        speech.promptBoxes = list ? list.querySelectorAll('input.speech-prompt').length : 0;
        speech.sourceControls = Boolean(element('pref-speech-source'));
        speech.aiControls = Boolean(element('pref-speech-provider') && element('pref-speech-dsh-provider')
          && element('pref-speech-persona') && element('pref-speech-base-url') && element('pref-speech-model')
          && element('pref-speech-api-key'));
        /**
         * And whether that half is ON SCREEN, which is a different fact from whether it exists.
         *
         * It belongs to the AI source (`showSpeech` hides the block while 内置短语 is chosen, at the operator's
         * request), so publishing it as data is what lets a window check the rule without a screenshot.
         */
        speech.aiVisible = (function () {
          var box = element('speech-ai');
          return Boolean(box && box.hidden !== true);
        })();
        speech.testControls = Boolean(element('pref-speech-test') && element('pref-speech-test-state'));
        /**
         * And WHERE 试一句's answer appears: the same row as 生成, not somewhere else on the page.
         *
         * Published as the DOM relationship rather than as a coordinate, because that is the fact that was wrong:
         * the refusal was printed above the whole AI block, several rows away from the button that produced it
         * (operator, 2026-10-12: "报错的提示位置和「生成」按钮太远，不仔细找都找不到"). A sibling of the button is
         * what "beside the button" means structurally, and it survives any restyling that keeps the row.
         */
        speech.testResultSameRow = (function () {
          var result = element('pref-speech-test-result');
          var button = element('pref-speech-test');
          return Boolean(result && button && result.parentNode && result.parentNode === button.parentNode);
        })();
        speech.lineCounts = {};
        (core.SPEECH_STATES || []).forEach(function (state) {
          speech.lineCounts[state] = (speech.lines[state] || []).length;
        });
        /**
         * What an EMPTY box currently says, and in whose words.
         *
         * Published because it is a LABEL that has to follow the source (`EMPTY_LINES_LABEL`), and a label that drifts
         * back to 「用内置短语」 while the source is AI is exactly the confusion the operator reported: "AI碎碎念开启后，
         * 面板里的各种状态后面就不应该写'用内置短语'了，应该是写'用内置AI生成提示词'."
         */
        (function () {
          var empty = emptyLinesLabel(speech.source);
          var row = speechRows[(core.SPEECH_STATES || [])[0]];
          var boxes = list ? list.querySelectorAll('textarea.speech-lines') : [];
          var counts = list ? list.querySelectorAll('.speech-state .count') : [];
          speech.emptyLabel = empty;
          speech.emptyPlaceholder = row ? row.lines.placeholder : null;
          // The DOM's own account of it: every collapsed state row shows the same words, or the table is not what is
          // on screen. Collected rather than assumed, and deduplicated so the report stays one line.
          var seen = {};
          for (var i = 0; i < counts.length; i += 1) seen[counts[i].textContent] = true;
          speech.rowLabels = Object.keys(seen);
          speech.placeholders = boxes.length ? boxes[0].placeholder : null;
        })();
        speech.models = dshModelIds();
        speech.llm = speechLlm ? {
          available: Boolean((speechLlm.dsh || {}).available),
          providers: ((speechLlm.dsh || {}).providers || []).length,
          error: (speechLlm.dsh || {}).error || null,
        } : null;
        speech.ai = {
          provider: speech.ai.provider,
          dshProvider: speech.ai.dshProvider,
          dshModel: speech.ai.dshModel,
          baseUrl: speech.ai.baseUrl,
          model: speech.ai.model,
          keySet: Boolean(speech.ai.apiKey),
          personaLength: speech.ai.persona.length,
          prompts: speech.ai.prompts,
          temperature: speech.ai.temperature,
          timeoutMs: speech.ai.timeoutMs,
        };
        return speech;
      })(),
      /**
       * 模型导入, as the page currently sees it.
       *
       * `dirs` is the list the HOST holds (the page only reads it), `modelCount` is how many models that list
       * amounts to, `picker` is whether a launcher bridge is there to open a native dialog, and `error` is the
       * host's own refusal text when one happened. Published because "the import did nothing" has four
       * different causes and only the page can tell them apart.
       */
      import: {
        controls: Boolean(element('model-import-pick') && element('model-import-list')),
        picker: Boolean(globalThis.vrmpet3dDesktop && typeof globalThis.vrmpet3dDesktop.pickModelFile === 'function'),
        dirs: imported.dirs.slice(),
        modelCount: imported.modelCount,
        catalogFile: imported.catalogFile,
        error: imported.error,
      },
      /**
       * 动作导入, the same readout for `/vrmpet3d/motions`.
       *
       * Separate sections over separate routes and separate list files, so they are published separately: "the
       * clip list is empty" has to separate into "no motion directory was ever imported" and "the section did not
       * render", and only this can do that from outside.
       */
      motionImport: {
        controls: Boolean(element('motion-import-pick') && element('motion-import-list')),
        picker: Boolean(globalThis.vrmpet3dDesktop && typeof globalThis.vrmpet3dDesktop.pickMotionDir === 'function'),
        dirs: importedMotions.dirs.slice(),
        clips: importedMotions.clips,
        catalogFile: importedMotions.catalogFile,
        error: importedMotions.error,
      },
      // An error only when a model WAS chosen and could not be described: no model at all is a state, not a
      // failure, and the panel says so in words.
      infoError: modelInfo === null && Boolean(modelIdInUse()) ? 'no model info' : null,
      /**
       * The 鼠标互动 controls, reported the way the 视线 ones are: the four numbers as the page currently
       * believes them, so a live check can prove the section rendered AND that it is showing the stored values.
       */
      wind: {
        power: Number(preferences.windPower),
        radius: Number(preferences.windRadius),
        decay: Number(preferences.windDecay),
        speedForMax: Number(preferences.windSpeedForMax),
        rows: element('pref-wind-power') ? 4 : 0,
      },
      /**
       * The 视线 controls, reported the same way as the tables above: a settings page can open and still
       * have no gaze section (a renamed id, a script that threw before it bound), and only the page can say
       * which it is. The resolved spans are what "auto" currently means, so the number is checkable.
       */
      gaze: {
        controls: Boolean(element('pref-gaze-curve') && element('pref-gaze-span-x') && element('pref-gaze-span-y')),
        curve: Number(preferences.gazeCurve),
        spanX: core.resolveGazeSpan(preferences.gazeSpanX, 0),
        spanY: core.resolveGazeSpan(preferences.gazeSpanY, 0),
        // The readout of what the RENDERER applies, and the numbers behind it: `applied` is null until the
        // first /vrmpet3d/desktop answer lands, which is why a check asserts the element exists rather than a
        // value that depends on a running window.
        appliedElement: Boolean(element('pref-gaze-applied')),
        applied: live.appliedGaze || null,
      },
      /**
       * The 状态 section. `rows` is how many states got a box set (one per STATUS_STATES entry), `ticked` is
       * how many clips are selected in total, and `oneShot` is how many of the OFFERED clips declare
       * themselves as playing once — the three numbers a check can compare against the catalog without
       * trusting the DOM's text.
       */
      motions: {
        controls: Boolean(element('motion-list')),
        offered: motionCatalog.length,
        /**
         * How many clip/state combinations are one-shots IN FORCE.
         *
         * Counted over the pairs a state actually holds, not over the clips: the play mode is a per-state
         * decision now (2026-10-09), so "one-shot" is a property of `(state, clip)` and the same clip can be
         * a loop in one state and a one-shot in another.
         */
        oneShot: (function () {
          var total = 0;
          var states = core.MOTION_STATES || [];
          var mapped = core.cleanMotions(preferences.motions);
          states.forEach(function (state) {
            core.motionIdsFor(mapped, state).forEach(function (id) {
              var entry = motionCatalog.filter(function (candidate) { return candidate.id === id; })[0];
              if (!entry) return;
              if (core.motionLoopForState(preferences, state, id, entry.loop, motionClipDefaults) === false) total += 1;
            });
          });
          return total;
        })(),
        rows: element('motion-list') ? element('motion-list').querySelectorAll('.motion-state').length : 0,
        ticked: core.motionIdList(preferences.motions).length,
        /**
         * The CLEANED list per state, published so a check can tell a clip id from noise.
         *
         * This is what catches the class of bug that reached the operator on 2026-10-12 — the page stored `on`
         * (the DOM default value of a checkbox written without one, i.e. the 凝视 switches beside the tick
         * boxes) as a clip id, and nothing outside the page could see it: the junk travels to the host as a
         * valid-looking POST. Published, it is one comparison against the catalogue the page is showing.
         */
        stateIds: (function () {
          var map = {};
          (core.MOTION_STATES || []).forEach(function (state) {
            map[state] = core.motionIdsFor(preferences.motions, state);
          });
          return map;
        })(),
        // The per-state controls: one mode dropdown per ticked clip, and the interval line per state. Counted
        // rather than read, so a live check does not depend on labels.
        modeRows: element('motion-list') ? element('motion-list').querySelectorAll('.clip-mode').length : 0,
        faceRows: element('motion-list') ? element('motion-list').querySelectorAll('.clip-face').length : 0,
        gazeRows: element('motion-list') ? element('motion-list').querySelectorAll('.clip-gaze').length : 0,
        everyRows: element('motion-list') ? element('motion-list').querySelectorAll('.every').length : 0,
        /**
         * The per-clip TEXTS, and the rule the second one follows.
         *
         * `clipSpeechRows` is one 碎碎念 box per ticked clip in a state — every source uses it, so it is
         * always there. `clipPromptRows` is the AI 提示词 boxes, counted OFF THE DOM as the ones actually on
         * screen, which is the same distinction `speech.aiVisible` draws for the AI block: the boxes exist
         * for every row either way (they are built beside the dropdowns), and they are `hidden` unless the
         * source is the AI one — the rule the operator's parenthetical states (「如果当前是AI碎碎念的话」).
         * `clipPromptVisible` is that source decision itself, published beside the count so a check can tell
         * "the boxes are hidden" from "the section did not render".
         */
        clipSpeechRows: element('motion-list') ? element('motion-list').querySelectorAll('.clip-speech').length : 0,
        clipPromptRows: (function () {
          var boxes = element('motion-list') ? element('motion-list').querySelectorAll('.clip-prompt') : [];
          var shown = 0;
          for (var i = 0; i < boxes.length; i += 1) if (boxes[i].hidden !== true) shown += 1;
          return shown;
        })(),
        clipPromptVisible: speechSourceIsAi(),
        /**
         * How many clips each state's box set actually OFFERS, and which folder it came from.
         *
         * The scoping rule is a state → folder mapping declared by the pack, so this is the readout that says
         * whether it took effect: a state mapped to a folder must offer fewer clips than the catalogue holds,
         * and a state with no mapping must offer all of them.
         */
        offeredNames: (function () {
          var map = {};
          offeredMotions().forEach(function (entry) { map[entry.id] = String(entry.name || ''); });
          return map;
        })(),
        perState: (function () {
          var offered = offeredMotions();
          var out = {};
          (core.MOTION_STATES || []).forEach(function (state) {
            var folders = stateFolderNames(state);
            out[state] = {
              // Normalised, so this readout says what the box set actually used rather than what the payload
              // happened to spell: an older host's bare string and the current list both land here as a list.
              folder: folders.length ? folders : null,
              offered: clipsForState(state, offered).length,
              ticked: core.motionIdsFor(preferences.motions, state).length,
            };
          });
          return out;
        })(),
        stateFolders: motionStateFolders,
        every: core.cleanMotionEvery(preferences.motionEvery),
        clips: core.cleanMotionClips(preferences.motionClips),
        /**
         * And the two TEXTS out of those same entries, keyed `state/clip` → `{ speech, prompt }`.
         *
         * `clips` above already carries them, so this is a second reading of one thing — and it is published
         * separately because it is what a check compares against the BOXES: "the row rendered the stored line"
         * and "the stored line is what the page believes it has" are two different failures, and only a
         * readout that names the pair can tell them apart without reading a value out of a screenshot.
         */
        clipTexts: (function () {
          var map = core.cleanMotionClips(preferences.motionClips);
          var out = {};
          Object.keys(map).forEach(function (state) {
            Object.keys(map[state]).forEach(function (id) {
              var entry = map[state][id];
              if (!entry.speech && !entry.prompt) return;
              out[state + '/' + id] = {
                speech: entry.speech || null,
                prompt: entry.prompt || null,
              };
            });
          });
          return out;
        })(),
        /**
         * What the per-clip 表情/口型 dropdowns actually OFFER — the model's own vocabulary, or only 跟随.
         *
         * Published because "always empty" and "the model has one expression" look identical from the outside, and the
         * operator reported exactly that in the 通用设置 page (2026-10-13: 「每个动作的表情和口型设置始终是空的，必须动态从
         * 模型上加载」). The count is per dropdown, taken from the DOM the section really built, so it cannot be satisfied
         * by the page holding a list it never rendered.
         */
        clipFaceOptions: (function () {
          var list = element('motion-list');
          if (!list) return { expression: 0, mouth: 0, selects: 0 };
          var expressionSelects = list.querySelectorAll('select.clip-expression');
          var mouthSelects = list.querySelectorAll('select.clip-mouth');
          return {
            expression: expressionSelects.length ? expressionSelects[0].options.length - 1 : 0,
            mouth: mouthSelects.length ? mouthSelects[0].options.length - 1 : 0,
            selects: expressionSelects.length + mouthSelects.length,
            model: modelInfoId || null,
          };
        })(),
        /**
         * The status lines: one row per state, and what each of them currently says.
         *
         * Published for the same reason every other number here is: a live check can then prove the section
         * rendered AND that it is showing the stored values, without depending on the DOM's text.
         */
        statusRows: element('motion-list') ? element('motion-list').querySelectorAll('.status-line').length : 0,
        statusTexts: (function () {
          var out = {};
          (core.STATUS_STATES || []).forEach(function (state) {
            out[state] = core.statusLineFor(preferences, state);
          });
          return out;
        })(),
        statusAnimations: (function () {
          var out = {};
          (core.STATUS_STATES || []).forEach(function (state) {
            out[state] = core.statusEntryFor(preferences, state).animation;
          });
          return out;
        })(),
        /**
         * Which 持续时间 fields the clock does not own (2026-10-11), and what the two notice rows are read as.
         *
         * `untimed` is core's own list, `waitingLocked` is whether the 等待确认 row actually refused the input,
         * and `noticeSeconds` is the minimum hold those two rows now express. Published because "the setting
         * did nothing" and "the row is disabled on purpose" look identical from outside the page.
         */
        statusTiming: {
          untimed: (core.UNTIMED_STATUS_STATES || []).slice(),
          waitingLocked: (function () {
            var rows = element('motion-list') ? element('motion-list').querySelectorAll('.status-line') : [];
            for (var i = 0; i < rows.length; i += 1) {
              if (rows[i].getAttribute('data-state') !== 'waiting') continue;
              var field = rows[i].querySelector('.status-seconds');
              return Boolean(field && field.disabled);
            }
            return null;
          })(),
          noticeSeconds: {
            done: core.noticeHoldMs(preferences, 'completed') / 1000,
            error: core.noticeHoldMs(preferences, 'error') / 1000,
          },
          tones: core.STATUS_TONES,
        },
      },
    };
  }

  bindBehaviourControls();
  bindParts();
  bindPreferenceControls();
  bindSpeechControls();
  bindGazeControls();
  bindImportControls();
  bindMotionImportControls();
  /**
   * 其他 → 重新运行引导: open `/vrmpet3d/setup` again, on demand.
   *
   * The guide appears by itself until it is finished, and this is the way BACK to it afterwards — the promise the
   * guide's own last screen makes. It goes through the launcher (`POST /vrmpet3d/desktop {action:'setup'}`) so DSH
   * Desktop gets a real window with the native pickers, and falls back to a tab, which is exactly how the two
   * settings pages are opened from the pet.
   */
  (function bindSetupEntry() {
    var button = element('pref-setup-open');
    var note = element('pref-setup-note');
    if (!button) return;
    button.addEventListener('click', function () {
      var fallback = function (reason) {
        if (note) note.textContent = reason || '已在新标签页里打开引导。';
        try { globalThis.open('/vrmpet3d/setup', '_blank'); } catch (error) { /* the user can open it by hand */ }
      };
      fetch('/vrmpet3d/desktop', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'setup' }),
      }).then(function (response) {
        if (!response.ok) { fallback('启动器没能打开窗口，改在新标签页里打开。'); return; }
        if (note) note.textContent = '引导已在新窗口里打开。';
      }).catch(function () { fallback('宿主没有提供 /vrmpet3d/desktop。'); });
    });
  })();
  bindModelSelect();
  bindResets();
  renderBehaviour();
  refreshStatus();
  // One look at what is already imported — models and motions alike. `renderAll` does not re-fetch them: they are
  // not preferences, and a settings snapshot arriving mid-edit must not re-render a list the user is working in.
  loadImported();
  loadImportedMotions();
  /**
   * Is the user in the middle of a control?
   *
   * Re-rendering a slider out from under a drag is worse than being a poll behind, so a snapshot that
   * arrives while something here has focus is remembered but not painted yet.
   */
  function busyWithAControl() {
    var active = document.activeElement;
    // TEXTAREA joined the list with the 碎碎念 boxes: a repaint while one of those has focus would take the
    // caret out of a line the user is in the middle of writing.
    return Boolean(active && active.tagName
      && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA'));
  }

  /** Repaint everything from `preferences`. */
  function renderAll() {
    renderModel();
    renderBehaviour();
    // The 部位 table is repainted here too: its STRUCTURE picker comes from `/vrmpet3d/model-info`, so a model that
    // has just been described has to reach the datalist as well as the rows.
    renderParts();
    renderSprings();
    // The motion section is repainted from `preferences` too, but its LIST of offered clips comes from
    // `/vrmpet3d/motions` — an unloaded catalog simply renders the states with nothing to tick.
    renderMotions();
    bindPreferenceControls();
    bindSpeechControls();
    bindGazeControls();
  }

  /**
   * Adopt a snapshot from the host.
   *
   * This is how an edit made in the app's panel - or by a second settings window - shows up here. The
   * model being CONFIGURED is recomputed only while the user has not chosen one on this page, so a
   * snapshot cannot yank the page off the model somebody is editing.
   *
   * THIS IS THE FIRST MOMENT THIS PAGE MAY WRITE (see `hasSnapshot`), and the moment the provisional model in
   * the URL becomes a real choice: the snapshot REPLACES `preferences`, so an id the URL put there is gone
   * unless the store had nothing to say. A window opened as `?model=X` on a profile that has never chosen a
   * model therefore writes X here — once, through the latch — and a window opened on a profile that already
   * has a model leaves the store's answer alone.
   */
  function adoptSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.live) {
      live.app = snapshot.live.app || null;
      live.window = snapshot.live.window || null;
    }
    if (snapshot.preferences) {
      preferences = core.cleanPreferences(snapshot.preferences);
      lastPushed = JSON.parse(JSON.stringify(preferences));
    }
    var adoptingUrlModel = false;
    if (urlModelProvisional && !preferences.modelId) {
      preferences.modelId = urlModel;
      adoptingUrlModel = true;
    }
    urlModelProvisional = false;
    hasSnapshot = true;
    chooseEditingModel();
    /**
     * A model that arrived from somewhere else (the picker page, the menu, a live report) has its OWN expressions, and
     * the 动作 rows name them: re-read the model when the id this page describes has moved on. `loadModelInfo` is a
     * no-op when it already holds that id, so this costs nothing on the ordinary poll.
     */
    if (modelIdInUse() !== modelInfoId) loadModelInfo();
    // The URL's choice is the FIRST thing this latch lets through, and only when the store had no model of its
    // own. `persist` diffs against `lastPushed`, so this patch carries `modelId` and nothing else.
    if (adoptingUrlModel) persist();
    /**
     * And the provider/model pair a catalog answer settled on before this moment.
     *
     * `/vrmpet3d/llm` is asked for at boot — before the snapshot lands — so its answer can be the first thing this
     * page knows about the store's AI settings, and the pair it adopted is about the STORE (it is what the host
     * reads when 试一句 asks for a line). Waiting for the next answer would leave the store without the pair the
     * picker is showing, which is the defect the adoption exists to remove; the latch is why it waits for HERE.
     */
    if (pendingLlmChoice) {
      var held = pendingLlmChoice;
      pendingLlmChoice = null;
      writeLlmChoice(held);
    }
    if (busyWithAControl()) return;
    renderAll();
    refreshStatus();
    publish();
  }

  //
  // The host owns the settings; this page reads them, writes patches, and follows the version. The local
  // storage copy stays as the fallback for a host that does not serve the route.
  //
  /**
   * The STATUS elements the page writes to, created if the markup does not carry them.
   *
   * This exists because of a real accident (2026-10-11): a pass that removed the page's explanatory prose also removed
   * eight elements the code WRITES to (`#model-import-note`, `#spring-note`, `#pref-speech-test-result`, …). Writing
   * `.textContent` on null threw during boot, the page stopped before the host snapshot was applied, and every control sat
   * at its default — which reads exactly like "all my settings are gone", while the store file had not been touched at all.
   * Losing a status line must never cost the whole panel.
   *
   * Each one is appended to the container it belongs to (so its text still lands beside its control) and left EMPTY: these
   * carry live state, not prose, and an empty line of news is better than a sentence nobody asked for.
   */
  function ensureStatusElements() {
    /**
     * The elements the page writes to that live on NO page's markup, created here so a missing one can never stop
     * the boot. Everything else is now declared where it belongs: the 通用设置 page carries `#model-import-note`,
     * `#motion-import-note`, `#motion-note`, `#pref-speech-test-result`, `#speech-llm-note` and
     * `#pref-gaze-span-auto` INSIDE the card each one reports on (so a status line lands beside its control), and
     * this list is what neither page has.
     *
     * `#spring-note` is the one that matters here: it is written by the spring section, which only the 模型参数
     * page renders, and the container it belongs to is not in the markup either — so it is created empty beside
     * the chains on that page and never exists on the other. The key is that on EITHER page this function has run
     * before any section renders, which is the whole of its job (see the accident quoted above).
     */
    var wanted = [
      ['spring-note', 'spring-list'],
    ];
    for (var i = 0; i < wanted.length; i += 1) {
      var id = wanted[i][0];
      if (element(id)) continue;
      var host = wanted[i][1] ? element(wanted[i][1]) : null;
      var node = document.createElement('p');
      node.className = 'hint';
      node.id = id;
      (host || document.body).appendChild(node);
    }
  }

  /**
   * TWO PAGES, TWO ROUTES — the split, second attempt (operator, 2026-10-11, and again the same day).
   *
   * "模型参数和通用设置（原总设置）是两个单独的页面，通用设置可以用静态页面实现."
   *
   * The first attempt kept ONE page and hid half of it per `?panel=`. It worked and read badly: a hidden section is
   * still on the page (its controls are built, its ids are in the markup, a screenshot of the wrong half looks
   * plausible), and the two windows were the same document with a query string between them. Now
   * `lib/config-page.html` (模型参数) and `lib/global-page.html` (通用设置) are separate documents on separate routes,
   * each carrying only the sections that belong to it, and this one script drives both. The whole `SECTION_PANEL` /
   * `PANEL` / `applyPanel` mechanism is gone with the page it existed for.
   *
   * What each page owns, in the order the headings appear:
   *   模型参数 (`/vrmpet3d/config`, `data-page="model"`)   — 模型 → 表情 → 部位 → 弹簧骨
   *   通用设置 (`/vrmpet3d/global`, `data-page="global"`) — 模型导入 → 动作导入 → 状态 → 碎碎念 → 视线 → 鼠标互动 → 其他
   *
   * `publish().page` reports which one this is, read from the `data-page` the markup declares, so a check can tell
   * the two apart instead of guessing from section counts.
   */

  // BEFORE anything renders: the status elements every section writes to have to exist, or a boot-time write to a
  // missing one stops the page before the host snapshot lands (see `ensureStatusElements` for the accident).
  ensureStatusElements();

  if (core.watchHostSettings) {
    hostSync = core.watchHostSettings({
      onSnapshot: adoptSnapshot,
      onUnsupported: function () {
        hostSync = null;
        /**
         * The latch OPENS here too, and it has to.
         *
         * `supported: false` means the host serves no settings store at all (an older install, or a half-loaded
         * plugin), so there is no snapshot to adopt and nothing this page could overwrite: its own storage IS the
         * store, exactly as it was before the host learned to serve one. Leaving the latch shut would make every
         * control silently do nothing on such a host — a worse failure than the one it guards.
         */
        hasSnapshot = true;
        setStatus('当前宿主没有 /vrmpet3d/settings：设置只保存在这个页面所在的存储里。', 'warn');
      },
    });
  } else {
    /**
     * A core too old to have the watcher at all: same answer as `onUnsupported`, for the same reason. There is no
     * store to poll and no snapshot to wait for, so this page's own storage is the only copy and the latch has
     * nothing to guard against — without this, an old core would leave every control silently read-only.
     */
    hasSnapshot = true;
  }

  /**
   * Paint, then catch up.
   *
   * The host's snapshot arrives as an UPDATE rather than as a precondition. Waiting for it is how this page
   * sat on its own placeholder text for ever - '正在读取…' is the HTML's initial status, so a route that was
   * slow or never answered looked exactly like a page that had not started. Everything below can render from
   * what is already known (this profile's cache, the model in the URL) and adopt the host's truth when it
   * shows up.
   */
  function begin() {
    /**
     * The two folds that live in the MARKUP (部位 and the per-collider list) are wired once, here, rather than in a renderer:
     * they survive a re-render by construction, and binding them per render would stack a listener on every pass. They still
     * go through the same memory, so a future change that rebuilds them keeps the user's choice.
     */
    rememberFold(element('parts-fold'), 'parts');
    rememberFold(element('spring-colliders-detail'), 'colliders');
    if (hostSync) hostSync.load().then(adoptSnapshot);
    chooseEditingModel();
    refreshStatus();
    // The motion catalog is fetched alongside the model, and RENDERED from both: the clips come from the
    // host, while which of them are ticked comes from `preferences`, which the snapshot above may still
    // be replacing. Rendering after each of the two is what makes either one arriving late harmless.
    loadMotions();
    return loadCatalog().then(loadModelInfo).then(function (info) {
      chooseEditingModel();
      renderAll();
      /**
       * THE COVER COMES OFF HERE — after the first render, the moment the form stops being a dummy.
       *
       * Operator, 2026-10-14: 「给通用设置和模型参数设置面板加上"加载中"的提示，以免用户看着一个dummy界面干等着」. Placed after
       * `renderAll` rather than after `loadModelInfo` so the lists are already filled in when the dimming lifts;
       * both happen in the same task, so no frame shows a half-empty page.
       */
      setLoading(true);
      refreshStatus();
      // Last, so the published state describes the DOM that is actually on screen: `renderAll` rebuilds
      // the motion box sets, and a report published before it would undercount them.
      publish();
      scrollToRequested();
      return info;
    });
  }

  /**
   * Scroll to a section the URL asks for: `?scroll=spring-list`.
   *
   * A URL fragment cannot do it here, and the reason is worth writing down: the sections are rebuilt by
   * `renderAll` a moment after load, so the browser's own fragment jump happens before the element it aimed
   * at exists (or before the rebuild replaces it) and the page ends up at the top. This runs AFTER the
   * render, which is the only moment at which the target is the element that is actually on screen — and it
   * is how the launcher (or a screenshot of the real window) can show one section of a long page.
   */
  function scrollToRequested() {
    var wanted = null;
    try {
      var query = String((globalThis.location && globalThis.location.search) || '');
      var match = /[?&]scroll=([^&]+)/.exec(query);
      if (match) wanted = decodeURIComponent(match[1]);
    } catch (_error) {
      wanted = null;
    }
    if (!wanted) return null;
    var target = element(wanted);
    if (!target || typeof target.scrollIntoView !== 'function') return null;
    target.scrollIntoView({ block: 'start' });
    return target;
  }

  if (hostSync) hostSync.start();
  begin();

  /**
   * Keep the "what the renderer applies" line current.
   *
   * It is the one thing on this page that describes the PET rather than the stored settings, so a value
   * painted once would answer "did my change arrive" with a number from before the change — which is exactly
   * the confusion it exists to remove. Two seconds, because it is a status line and not a frame counter.
   */
  if (globalThis.setInterval) {
    globalThis.setInterval(function () { refreshStatus(); }, 2000);
  }
})();

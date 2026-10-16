/**
 * ONE model picker, mounted twice: the guide's ② 偏好模型 step and the 切换模型 page.
 *
 * Operator, 2026-10-13: 「第一部分是模型导入，改成一个很大的选择模型文件或者拖入模型，去掉手动输入路径框，这个框没有意义；
 * 下半部分显示现有模型（自带模型+已导入模型）的缩略图，点击对应的缩略图可以切换当前使用的模型」 and, for the menu entry,
 * 「面板中和初次安装向导模型页完全一样」. The last clause is why this file exists rather than a second copy of the
 * markup: two hand-kept grids are two things to fix, and the operator's own history in this project is a list of
 * what that costs (the two settings panels, the two prompts, the drag feedback that existed on one pet only).
 *
 * What it owns: the drop zone, the file input it falls back to, the grid of thumbnails, and the two writes an
 * import needs. What it does NOT own is the settings store and the status line: the caller hands the current
 * model in (`currentModelId`) and is told what to do when a tile is clicked (`onSwitch`), so the guide keeps
 * writing through its own snapshot-guarded store and the picker page through its own.
 *
 * TWO WAYS IN, and the difference is a real one rather than a preference:
 *
 *   * the launcher's native dialog (`vrmpet3dDevDesktop.pickModelFile`) returns a PATH, and the host copies from
 *     it — the original import, and the only one a real settings window needs;
 *   * a DROPPED file, or one chosen through `<input type="file">`, is only ever a `File`, so the page uploads
 *     its bytes (`POST /vrmpet3d-dev/models?file=<name>`) and the host writes them. That path is what makes the
 *     picker work in a plain browser tab, where there is no launcher at all — the case the removed 手动输入路径
 *     box was trying to serve, with a text box where a drop target belongs.
 *
 * Both end in the same host store, and the host stays its only writer (see `importModelBytes`).
 */
(function () {
  'use strict';

  /** The three formats the host will accept. Kept in one place so the input, the drop test and the text agree. */
  var MODEL_ACCEPT = '.vrm,.glb,.gltf';
  var MODEL_PATTERN = /\.(vrm|glb|gltf)$/i;

  /**
   * This surface's own wording, in the two languages it draws in: `TEXT.zh` is the Chinese half, and the English
   * twin is the literal {@link resolveText} returns for `'en'`.
   *
   * TWO LITERALS, one per language, rather than two columns of one table — because each half has to be written as
   * its own language rather than as a translation of the other, which is also why `lib/menu.js` spells its
   * `LABELS` out twice. Both halves are written in FULL: a half that is merely a gloss on the other is what makes
   * a half-translated interface.
   *
   * THE TWO KEY SETS MUST BE IDENTICAL. A key the Chinese half has and the English does not falls back to Chinese
   * mid-sentence (`core.textFor`), which is the defect a suite asserts against — and that includes the
   * FUNCTION-valued entries: they stay functions in both halves because that is what lets the English put its
   * words in its own order (`creditAuthor(author)`) rather than in the Chinese sentence's order.
   */
  var TEXT = {
    zh: {
      dropTitle: '点击选择模型文件',
      dropSub: '或把 ' + MODEL_ACCEPT.split(',').join(' / ') + ' 拖到这里',
      reading: '正在读取模型列表…',
      listFailed: '模型列表读取失败。',
      empty: '还没有可用的模型。',
      gridLabel: '现有模型',
      count: function (total, imported) {
        return '共 ' + total + ' 个模型' + (imported ? '（其中 ' + imported + ' 个是导入的）' : '') + '。';
      },
      tagBundled: '自带',
      tagUser: '已导入',
      using: '使用中',
      remove: '移除这个导入的模型',
      importing: '正在导入模型…',
      importingFile: function (name) { return '正在导入 ' + name + '…'; },
      imported: function (name) { return '已导入并切换：' + name; },
      importedNoSwitch: function (name) { return '已导入：' + name; },
      importFailed: '导入失败：',
      switched: function (name) { return '已切换模型：' + name; },
      switching: function (name) { return '正在切换模型：' + name + '…'; },
      switchingBusy: '正在切换中，等这一只加载完再点。',
      switchingSlow: '仍在加载。',
      switchingTimeout: function (name) { return '切换超时：' + name + ' 可能没能加载，看看桌宠上的提示。'; },
      noModel: '这个文件不是模型（只接受 .vrm / .glb / .gltf）。',
      dropBusy: '正在导入，请等它读完。',
      noFetchUpload: '这个页面不能上传文件。',
      removed: '已移除插件复制的那一份。',
      removeFailed: '移除失败：',
      /**
       * 自带模型的来源与作者 — the operator's own requirement (2026-10-13: 「需要注明来源和作者」).
       *
       * The WORDS live here with every other string; the FACTS come from the host, which is the only writer of a
       * catalogue entry's `credit` (`BUNDLED_MODEL_CREDITS` in `lib/index.js`). A credit typed into this file as
       * well would be a second copy of who made what.
       */
      creditTitle: '插件自带模型',
      creditName: function (title, file) { return title ? title + '（' + file + '）' : file; },
      creditAuthor: function (author) { return '作者：' + author; },
      creditLicense: function (license) { return '授权：' + license; },
      creditSource: function (source) { return '来源：' + source; },
    },
  };

  /**
   * This surface's words in one of its two languages — the accessor every caller goes through, and what
   * `__VRMPET3D_DEV_MODEL_PICKER__.strings` exposes to a suite.
   *
   * `'zh'` (and anything that is not `'en'`, which includes a caller that passed no language at all) gets the
   * Chinese half, the default this component has always had. `'auto'` is NOT resolved here: the caller knows what
   * the environment says and passes the answer in, so a component that never sees a store cannot guess wrong.
   */
  function resolveText(language) {
    if (language === 'en') {
      return {
        dropTitle: 'Choose a model file',
        dropSub: 'or drop a ' + MODEL_ACCEPT.split(',').join(' / ') + ' here',
        reading: 'Reading the model list…',
        listFailed: 'Could not read the model list.',
        empty: 'No models available yet.',
        gridLabel: 'Available models',
        count: function (total, imported) {
          return total + (total === 1 ? ' model' : ' models') + (imported ? ' (' + imported + ' imported)' : '') + '.';
        },
        tagBundled: 'built-in',
        tagUser: 'imported',
        using: 'in use',
        remove: 'Remove this imported model',
        importing: 'Importing a model…',
        importingFile: function (name) { return 'Importing ' + name + '…'; },
        imported: function (name) { return 'Imported and switched to ' + name; },
        importedNoSwitch: function (name) { return 'Imported ' + name; },
        importFailed: 'Import failed: ',
        switched: function (name) { return 'Switched to ' + name; },
        switching: function (name) { return 'Switching to ' + name + '…'; },
        switchingBusy: 'A switch is already running — wait for this one to load.',
        switchingSlow: 'Still loading.',
        switchingTimeout: function (name) { return 'The switch timed out: ' + name + ' may not have loaded (check the pet for a message).'; },
        noModel: 'That file is not a model this plugin can load (.vrm / .glb / .gltf only).',
        dropBusy: 'An import is already running — wait for it to finish.',
        noFetchUpload: 'This page cannot upload files.',
        removed: 'Removed the plugin\'s own copy.',
        removeFailed: 'Could not remove it: ',
        creditTitle: 'Bundled models',
        creditName: function (title, file) { return title ? title + ' (' + file + ')' : file; },
        creditAuthor: function (author) { return 'Author: ' + author; },
        creditLicense: function (license) { return 'License: ' + license; },
        creditSource: function (source) { return 'Source: ' + source; },
      };
    }
    return TEXT.zh;
  }

  function element(doc, tag, className, value) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = value;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /** The first character of a model's name, for the placeholder a model without a thumbnail gets. */
  function initial(name) {
    var clean = String(name || '').replace(/^.*[\\/]/, '').trim();
    return clean ? clean[0].toUpperCase() : '?';
  }

  /**
   * Build the picker inside `options.mount`.
   *
   * @param {object} options
   *   document        the document to build in (defaults to the global one)
   *   mount           the element to fill — the component owns everything inside it
   *   language        'zh' (default) or 'en' — the language it is BUILT in; `api.setLanguage` changes it later
   *                   without a rebuild, which is how a caller whose language comes from the settings store
   *                   (the 切换模型 page) follows a change while the grid is on screen
   *   bridge          the launcher bridge, or null to force the browser path (defaults to
   *                   `globalThis.vrmpet3dDevDesktop`); a page with no bridge still gets a working picker
   *   fetchImpl       fetch override, for a probe
   *   currentModelId  the model id in use, or a function returning it (the STORE's value)
   *   liveModelId     optional function returning the id a SURFACE is actually showing, or null when unknown.
   *                   This is what tells the progress bar when a switch has finished rather than merely been
   *                   written; without it the bar ends as soon as the store takes the id.
   *   onSwitch        called with (id, model) after a tile is clicked; the CALLER writes the preference
   *   onStatus        called with (text, kind) — 'warn' for a failure, undefined otherwise
   *   switchTimeoutMs how long a switch may take before the bar gives up on it (default 20 s)
   *   switchMinMs     the shortest time the bar stays up, so a fast switch is still SEEN (default 600 ms)
   *   importedFile    optional: an already-known imported-file list, so the first paint is not blank
   *   endpoints       optional overrides: { catalog, upload, thumbnail }
   */
  function createModelPicker(options) {
    var settings = options || {};
    var doc = settings.document || globalThis.document;
    var mount = settings.mount;
    if (!doc || !mount) throw new Error('createModelPicker needs a document and a mount element');

    /**
     * The language this picker draws in, and its table.
     *
     * Resolved ONCE here, from `options.language` — 'zh' unless the caller says 'en', which is the default this
     * option has always had (the wizard mounts with 'zh'). A caller whose language can change while the picker is on
     * screen calls {@link api.setLanguage} instead of rebuilding: the 切换模型 page is exactly that caller, because
     * its language comes from the settings store it polls.
     */
    var language = settings.language === 'en' ? 'en' : 'zh';
    var text = resolveText(language);
    var onSwitch = typeof settings.onSwitch === 'function' ? settings.onSwitch : function () {};
    var onStatus = typeof settings.onStatus === 'function' ? settings.onStatus : function () {};
    var doFetch = settings.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    var bridge = settings.bridge !== undefined ? settings.bridge : (globalThis.vrmpet3dDevDesktop || null);
    var endpoints = settings.endpoints || {};
    var catalogUrl = endpoints.catalog || '/vrmpet3d-dev/models';
    var uploadUrl = endpoints.upload || '/vrmpet3d-dev/models';
    var thumbnailUrl = endpoints.thumbnail || '/vrmpet3d-dev/model-thumbnail';

    /** Everything the host last reported, in catalog order: the built-in first, then the imports. */
    var models = [];
    var imported = [];
    var busy = false;
    /**
     * The tile that was clicked a moment ago, shown as 使用中 before the caller's store has round-tripped.
     *
     * The write is asynchronous (the guide and the picker page both push it through the host's settings store),
     * so without this the click would look like it did nothing until the next snapshot arrived. Cleared by
     * `setCurrent`, which is what a snapshot calls: from then on the caller's own value is the truth, including
     * a change made from another window.
     */
    var pendingId = null;
    /** Whether the mounted picker may show a 移除 control. Off in a surface that cannot write the list. */
    var showRemove = settings.showRemove !== false;
    var switchTimeoutMs = Number(settings.switchTimeoutMs) > 0 ? Number(settings.switchTimeoutMs) : 20000;
    var switchMinMs = Number(settings.switchMinMs) >= 0 ? Number(settings.switchMinMs) : 600;
    /**
     * A switch that is IN FLIGHT: `{id, name, startedAt, slow, timer, capTimer}`.
     *
     * The operator asked for this to exist at all (「增加一个切换进度条，防止用户快速反复切换导致故障」): a model load is
     * seconds of parsing, and every tile click writes the settings store — so without a lock, five impatient clicks
     * are five loads racing on one skeleton. While this is set, the whole picker refuses input: the tiles, the drop
     * target and the ✕ all go inert, and the bar says what is happening. It clears when the model has actually
     * ARRIVED (`setCurrent` is what a settings snapshot calls, and it checks the live report), or when the timeout
     * says the switch is not coming.
     */
    var switching = null;

    // ---- markup -------------------------------------------------------------------------------
    var root = element(doc, 'div', 'model-picker');
    var drop = element(doc, 'div', 'model-drop');
    drop.setAttribute('role', 'button');
    drop.setAttribute('tabindex', '0');
    var dropMark = element(doc, 'div', 'model-drop-mark', '＋');
    var dropTitle = element(doc, 'div', 'model-drop-title', text.dropTitle);
    var dropSub = element(doc, 'div', 'model-drop-sub', text.dropSub);
    drop.appendChild(dropMark);
    drop.appendChild(dropTitle);
    drop.appendChild(dropSub);

    var input = doc.createElement('input');
    input.type = 'file';
    input.accept = MODEL_ACCEPT;
    input.className = 'model-file-input';
    input.hidden = true;

    var gridHead = element(doc, 'div', 'model-grid-head');
    var gridLabel = element(doc, 'span', 'k', text.gridLabel);
    var gridCount = element(doc, 'span', 'note model-grid-count');
    gridHead.appendChild(gridLabel);
    gridHead.appendChild(gridCount);

    /**
     * The switch's progress bar, between the two halves of the picker and hidden until a switch starts.
     *
     * Indeterminate on purpose: the browser gets no usable progress out of a 14 MB VRM parse, and a bar that
     * invents a percentage is worse than one that says "working". `role="progressbar"` with no `aria-valuenow` is
     * exactly that state, and the text beside it is the real message for a screen reader and for a user.
     */
    var progress = element(doc, 'div', 'model-progress');
    progress.hidden = true;
    progress.setAttribute('role', 'progressbar');
    var progressTrack = element(doc, 'div', 'model-progress-track');
    var progressFill = element(doc, 'div', 'model-progress-fill');
    progressTrack.appendChild(progressFill);
    var progressText = element(doc, 'span', 'model-progress-text');
    var progressNote = element(doc, 'span', 'model-progress-note');
    progress.appendChild(progressTrack);
    progress.appendChild(progressText);
    progress.appendChild(progressNote);

    var grid = element(doc, 'div', 'model-grid');
    grid.setAttribute('role', 'list');

    /**
     * Where the bundled models' 来源 and 作者 are written out in full, under the grid.
     *
     * Under, not on a tile: every tile is deliberately the same height (see the 使用中 badge in `art`), and a
     * credit line on the two bundled ones would make exactly those two taller than an imported one. The tile's
     * tooltip carries the author; this carries the whole credit, with the source as a link.
     */
    var credits = element(doc, 'div', 'model-credits');
    credits.hidden = true;

    root.appendChild(drop);
    root.appendChild(input);
    root.appendChild(progress);
    root.appendChild(gridHead);
    root.appendChild(grid);
    root.appendChild(credits);
    mount.appendChild(root);

    // ---- helpers ------------------------------------------------------------------------------

    function currentId() {
      if (pendingId) return pendingId;
      var value = typeof settings.currentModelId === 'function' ? settings.currentModelId() : settings.currentModelId;
      if (typeof value === 'string' && value) return value;
      // An empty preference means AUTOMATIC, which the host resolves to the bundled default — the operator's
      // 「把BlueFatFish作为默认模型」 (2026-10-13; it was 「默认模型设置为SampleModel」 before that). Marking that tile
      // 使用中 is the truth the user needs to see; leaving the grid unmarked would read as "no model is in use"
      // on a fresh profile, which is the state every new user is in when the guide opens.
      //
      // The RULE comes from core rather than from this file. With two bundled models, "the first `bundled` entry"
      // is a different answer from "the model an empty preference resolves to" as soon as scan order changes, and
      // the tile marked 使用中 has to be the model the pet is actually drawing. Every page that mounts this
      // component loads `core.js` first, and a page without it keeps the old scan-order fallback instead of
      // throwing — the same guard the widget uses for the shared menu.
      var core = globalThis.__VRMPET3D_DEV_CORE__;
      if (core && typeof core.resolveModelId === 'function') {
        var resolved = core.resolveModelId(models, '');
        if (resolved) return resolved;
      }
      var bundled = models.filter(function (model) { return model.source === 'bundled'; })[0];
      return bundled ? bundled.id : null;
    }

    function setBusy(next, message) {
      busy = next === true;
      root.setAttribute('data-busy', busy ? '1' : '0');
      if (message) onStatus(message);
    }

    /** True while the picker refuses input: an import is running, or a switch is loading. */
    function locked() {
      return busy || Boolean(switching);
    }

    /** The id a surface is actually showing, or null when the caller has no such channel. */
    function liveId() {
      if (typeof settings.liveModelId !== 'function') return null;
      var value = settings.liveModelId();
      return typeof value === 'string' && value ? value : null;
    }

    /** Start the bar for one model, and arm both timers: the "still loading" note and the give-up cap. */
    function beginSwitch(model) {
      if (switching) return switching;
      switching = { id: model.id, name: model.name, startedAt: Date.now(), slow: false, timer: 0, capTimer: 0 };
      pendingId = model.id;
      root.setAttribute('data-switching', '1');
      drop.setAttribute('aria-disabled', 'true');
      // The tiles are REPAINTED so their buttons come back disabled; `card()` reads this same state.
      render();
      progress.hidden = false;
      progressText.textContent = text.switching(model.name);
      progressNote.textContent = '';
      progress.setAttribute('aria-valuetext', text.switching(model.name));
      var view = doc.defaultView;
      if (view && typeof view.setTimeout === 'function') {
        switching.timer = view.setTimeout(function () {
          if (!switching) return;
          switching.timer = 0;
          switching.slow = true;
          progressNote.textContent = text.switchingSlow;
        }, 5000);
        switching.capTimer = view.setTimeout(function () {
          var name = switching ? switching.name : '';
          endSwitch();
          if (name) onStatus(text.switchingTimeout(name), 'warn');
        }, switchTimeoutMs);
      }
      /**
       * And the bar's OWN clock, which is what asks "has it arrived?" every 300 ms.
       *
       * Not left to the settings poll, and that is a measured distinction rather than caution: a page that polls
       * the store sees a snapshot only when the VERSION moves, and the reply to its own write already moved the
       * page's `seen` past it. So on a host whose live report is silent (no pet is running this moment), waiting
       * for a snapshot the store never changes means waiting for the whole 20 s cap. The check reads two local
       * values — the store's id and the live report — so it can run on any clock.
       */
      if (view && typeof view.setInterval === 'function') {
        switching.poll = view.setInterval(function () { settleSwitch(); }, 300);
      }
      return switching;
    }

    /** Take the bar down. Silent about success: the 使用中 marker moving is that feedback, and the caller owns the line. */
    function endSwitch() {
      if (!switching) return;
      var view = doc.defaultView;
      if (view && typeof view.clearTimeout === 'function') {
        if (switching.timer) view.clearTimeout(switching.timer);
        if (switching.capTimer) view.clearTimeout(switching.capTimer);
      }
      if (switching.poll && view && typeof view.clearInterval === 'function') view.clearInterval(switching.poll);
      switching = null;
      root.removeAttribute('data-switching');
      drop.removeAttribute('aria-disabled');
      progress.hidden = true;
      progressText.textContent = '';
      progressNote.textContent = '';
      progress.removeAttribute('aria-valuetext');
      // And the tiles come back to life: they were rendered disabled for the duration.
      render();
    }

    /**
     * Is the model the user asked for actually ON SCREEN yet?
     *
     * Two facts, in this order, and both are needed:
     *
     *   * the STORE has to name the target — the click only asked for it, and a write can fail;
     *   * a SURFACE has to report it back through `liveModelId`, which is the only proof that a 14 MB parse
     *     finished. Without that channel (a caller that did not wire it) the store's word is all there is, and the
     *     minimum visible time keeps a fast switch from flickering.
     *
     * Called from `setCurrent`, i.e. from every settings snapshot — the same poll that carries the store also
     * carries the live report, so one cadence answers both questions.
     */
    function settleSwitch() {
      if (!switching) return;
      if (Date.now() - switching.startedAt < switchMinMs) return;
      var stored = typeof settings.currentModelId === 'function' ? settings.currentModelId() : settings.currentModelId;
      if (stored !== switching.id) return;
      var live = liveId();
      if (live === null || live === switching.id) endSwitch();
    }

    function requestJson(path, body) {
      if (!doFetch) return Promise.reject(new Error(text.noFetchUpload));
      return doFetch(path, {
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

    /** The tile's picture: the host's own route, with the model's initial as the fallback. */
    function art(model, isCurrent) {
      var box = element(doc, 'span', 'model-card-art');
      var img = doc.createElement('img');
      img.className = 'model-card-img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = thumbnailUrl + '?m=' + encodeURIComponent(model.id);
      // No thumbnail is NORMAL (a plain .glb, a VRM with no meta image, a .gltf whose picture sits beside
      // it), so a 404 becomes a drawn placeholder rather than a broken-image icon.
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        box.setAttribute('data-blank', '1');
        if (!box.firstChild) box.appendChild(element(doc, 'span', 'model-card-initial', initial(model.name)));
      });
      box.appendChild(img);
      /**
       * 使用中 rides ON the picture, not under it.
       *
       * It used to be one more line in the card, which made the model in use a TALLER tile than every other one
       * (operator, 2026-10-13: 「把使用中和未使用中的缩略图卡调整成一样大小」). A badge inside the art box is
       * absolutely positioned, so it takes no room and every tile is exactly the same height whatever state it is in.
       */
      if (isCurrent) box.appendChild(element(doc, 'span', 'model-card-badge', text.using));
      return box;
    }

    function card(model) {
      var isCurrent = currentId() === model.id;
      var wrap = element(doc, 'div', 'model-card');
      wrap.setAttribute('role', 'listitem');
      wrap.setAttribute('data-model-id', model.id);
      wrap.setAttribute('data-source', model.source || 'user');
      if (isCurrent) wrap.setAttribute('data-current', '1');

      var pick = element(doc, 'button', 'model-card-pick');
      pick.type = 'button';
      pick.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
      if (switching) pick.title = text.switchingBusy;
      // A switch in flight disables the tiles outright, not only through CSS: a keyboard activation would
      // otherwise slip past `pointer-events: none` and start the second parse this state exists to prevent.
      if (switching) pick.disabled = true;
      pick.appendChild(art(model, isCurrent));
      var name = element(doc, 'span', 'model-card-name', model.name);
      // The credit rides in the tooltip rather than as a fourth line, so the bundled tiles stay exactly as tall as
      // an imported one; `renderCredits` is where it is actually readable.
      name.title = model.credit ? model.name + ' · ' + text.creditAuthor(model.credit.author) : model.name;
      pick.appendChild(name);

      // ONE line for every tile, current or not: the badge above is what marks the model in use.
      pick.appendChild(element(doc, 'span', 'model-card-tag',
        model.source === 'bundled' ? text.tagBundled : text.tagUser));
      pick.addEventListener('click', function () { select(model); });
      wrap.appendChild(pick);

      if (showRemove && model.source !== 'bundled') {
        var entry = imported.filter(function (candidate) { return candidate.name === model.name; })[0];
        var remove = element(doc, 'button', 'model-card-remove', '✕');
        remove.type = 'button';
        remove.title = text.remove;
        remove.setAttribute('aria-label', text.remove);
        if (switching) remove.disabled = true;
        remove.addEventListener('click', function (event) {
          if (event && event.stopPropagation) event.stopPropagation();
          if (entry) removeModel(entry.file);
        });
        wrap.appendChild(remove);
      }
      return wrap;
    }

    function render() {
      clear(grid);
      models.forEach(function (model) { grid.appendChild(card(model)); });
      if (!models.length) grid.appendChild(element(doc, 'p', 'note', text.empty));
      gridCount.textContent = models.length ? text.count(models.length, imported.length) : '';
      var current = models.filter(function (model) { return model.id === currentId(); })[0];
      if (current) {
        grid.setAttribute('data-current-name', current.name);
      } else {
        grid.removeAttribute('data-current-name');
      }
      renderCredits();
    }

    /** The models this plugin ships that the host sent a credit for, in catalogue order. */
    function creditedModels() {
      return models.filter(function (model) {
        return model && model.credit && model.credit.author;
      });
    }

    /**
     * Draw everything again in the CURRENT `text` — the whole of a language change.
     *
     * Three static labels are written at construction (the drop zone's two lines and the grid's heading) and one
     * more is stateful (the progress bar, whose two lines are set when a switch STARTS). Everything else already
     * comes out of `render()`, so repainting the grid covers the tiles, the tags, the 使用中 badge, the count, the
     * empty note and the credit lines — and the bar is rewritten here so a switch that is in flight says the same
     * thing in the new language instead of freezing in the old one until it settles.
     */
    function relabel() {
      dropTitle.textContent = text.dropTitle;
      dropSub.textContent = text.dropSub;
      gridLabel.textContent = text.gridLabel;
      if (switching) {
        progressText.textContent = text.switching(switching.name);
        progressNote.textContent = switching.slow ? text.switchingSlow : '';
        progress.setAttribute('aria-valuetext', text.switching(switching.name));
        // And the CALLER's line, which is where the same sentence usually lives: without this the bar would say
        // 「正在切换模型…」 while the status line above it stayed in the language the switch STARTED in. The
        // component owns this text, so it is the component that says it again — through the same channel it was
        // first said on.
        onStatus(text.switching(switching.name));
      }
      render();
    }

    /**
     * Write out 来源 and 作者 for every bundled model the host sent a credit for.
     *
     * Built from the catalogue's own `credit`, never from a table in this file: the host shipped the model, so the
     * host says who made it (`BUNDLED_MODEL_CREDITS` in `lib/index.js`). A catalogue with no credits — an older
     * host, a probe's stub — renders nothing at all rather than an empty heading, which is why the container is
     * `hidden` until there is a line to put in it.
     */
    function renderCredits() {
      clear(credits);
      var credited = creditedModels();
      if (!credited.length) {
        credits.hidden = true;
        return;
      }
      credits.hidden = false;
      credits.appendChild(element(doc, 'span', 'k', text.creditTitle));
      credited.forEach(function (model) {
        var line = element(doc, 'div', 'note model-credit');
        line.setAttribute('data-model-name', model.name);
        line.appendChild(element(doc, 'span', 'model-credit-name',
          text.creditName(model.credit.title, model.name)));
        line.appendChild(element(doc, 'span', 'model-credit-author', text.creditAuthor(model.credit.author)));
        if (model.credit.license) {
          line.appendChild(element(doc, 'span', 'model-credit-license', text.creditLicense(model.credit.license)));
        }
        if (model.credit.source) {
          var link = element(doc, 'a', 'model-credit-source', text.creditSource(model.credit.source));
          link.href = model.credit.source;
          link.target = '_blank';
          link.rel = 'noreferrer noopener';
          line.appendChild(link);
        }
        credits.appendChild(line);
      });
    }

    /**
     * Adopt a reply as the new list, or re-read the catalog when a caller has nothing to hand.
     *
     * Both import paths answer with the rebuilt catalog, so the grid updates from the reply rather than from a
     * second round trip — and a caller that only wants a refresh (a removal, the first paint) asks the host.
     */
    function apply(payload) {
      if (payload && Array.isArray(payload.models)) {
        models = payload.models.slice();
        imported = Array.isArray(payload.importedModels) ? payload.importedModels.slice() : imported;
        render();
        return true;
      }
      return false;
    }

    function refresh() {
      if (!doFetch) {
        onStatus(text.listFailed, 'warn');
        return Promise.resolve(null);
      }
      return doFetch(catalogUrl, { credentials: 'omit' })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) {
          if (!apply(payload)) onStatus(text.listFailed, 'warn');
          return payload;
        })
        .catch(function () {
          onStatus(text.listFailed, 'warn');
          return null;
        });
    }

    /** The model in a fresh catalog that an import just created, so it can be switched to by itself. */
    function modelForImport(payload, name) {
      var list = payload && Array.isArray(payload.models) ? payload.models : [];
      var newest = (payload && Array.isArray(payload.importedModels) ? payload.importedModels : []).slice(-1)[0];
      var target = newest && newest.name ? newest.name : name;
      return list.filter(function (model) {
        return model.name === target && model.source !== 'bundled';
      })[0] || list.filter(function (model) { return model.name === target; })[0] || null;
    }

    function afterImport(payload, name) {
      apply(payload);
      var model = modelForImport(payload, name);
      if (model) {
        select(model);
        onStatus(text.imported(model.name));
      } else {
        onStatus(text.importedNoSwitch(name));
      }
      return model;
    }

    function fail(prefix, error) {
      setBusy(false);
      onStatus(prefix + (error && error.message ? error.message : error), 'warn');
    }

    /** Import from a PATH the launcher's dialog returned. */
    function importPath(path) {
      if (!path) return Promise.resolve(null);
      if (locked()) {
        onStatus(switching ? text.switchingBusy : text.dropBusy, 'warn');
        return Promise.resolve(null);
      }
      setBusy(true, text.importing);
      return requestJson(uploadUrl, { addFile: path }).then(function (payload) {
        setBusy(false);
        return afterImport(payload, String(path).replace(/^.*[\\/]/, ''));
      }).catch(function (error) {
        fail(text.importFailed, error);
        return null;
      });
    }

    /** Import the BYTES of a dropped or picked file, which is what a page without a launcher can offer. */
    function importFile(file) {
      if (!file) return Promise.resolve(null);
      var name = file.name || 'model.vrm';
      if (!MODEL_PATTERN.test(name)) {
        onStatus(text.noModel, 'warn');
        return Promise.resolve(null);
      }
      if (locked()) {
        onStatus(switching ? text.switchingBusy : text.dropBusy, 'warn');
        return Promise.resolve(null);
      }
      if (!doFetch) {
        onStatus(text.noFetchUpload, 'warn');
        return Promise.resolve(null);
      }
      setBusy(true, text.importingFile(name));
      return doFetch(uploadUrl + '?file=' + encodeURIComponent(name), {
        method: 'POST',
        credentials: 'omit',
        // The extension decided what this is; the CONTENT TYPE is what tells the host to read a raw body
        // rather than JSON, so it is stated even when the browser has no type for the file.
        headers: { 'content-type': file.type && file.type !== 'application/json' ? file.type : 'application/octet-stream' },
        body: file,
      }).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (detail) { throw new Error(detail || ('HTTP ' + response.status)); });
        }
        return response.json().catch(function () { return null; });
      }).then(function (payload) {
        setBusy(false);
        return afterImport(payload, name);
      }).catch(function (error) {
        fail(text.importFailed, error);
        return null;
      });
    }

    function removeModel(file) {
      if (locked()) {
        onStatus(switching ? text.switchingBusy : text.dropBusy, 'warn');
        return Promise.resolve(null);
      }
      return requestJson(uploadUrl, { removeFile: file }).then(function (payload) {
        apply(payload);
        onStatus(text.removed);
      }).catch(function (error) {
        fail(text.removeFailed, error);
      });
    }

    /**
     * Click a tile: ask for the model, and LOCK the picker until it has arrived.
     *
     * A second click while the first is loading is not "another switch" — it is a second VRM parse racing the
     * first one on the same skeleton, which is the fault this whole state exists to prevent. So it is answered
     * with a line of text and nothing else. Clicking the model that is already loading is not even that: it is
     * the same request twice, and it is ignored in silence.
     */
    function select(model) {
      if (!model || !model.id) return null;
      if (switching) {
        if (switching.id !== model.id) onStatus(text.switchingBusy, 'warn');
        return switching;
      }
      if (busy) {
        onStatus(text.dropBusy, 'warn');
        return null;
      }
      var started = beginSwitch(model);
      onSwitch(model.id, model);
      render();
      onStatus(text.switching(model.name));
      return started;
    }

    // ---- the two ways in ----------------------------------------------------------------------

    /** The launcher's native dialog, when this document has one. */
    function pickNative() {
      var chooser = bridge && typeof bridge.pickModelFile === 'function' ? bridge.pickModelFile : null;
      if (!chooser) return false;
      Promise.resolve(chooser(language)).then(function (chosen) { return chosen ? importPath(chosen) : null; });
      return true;
    }

    drop.addEventListener('click', function () {
      if (locked()) { onStatus(switching ? text.switchingBusy : text.dropBusy, 'warn'); return; }
      if (pickNative()) return;
      // No launcher: a browser tab's own file input, whose File is uploaded rather than copied by path.
      input.click();
    });
    drop.addEventListener('keydown', function (event) {
      if (!event) return;
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        if (event.preventDefault) event.preventDefault();
        drop.click();
      }
    });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) importFile(file);
    });

    /** A drop anywhere on the component, because a user who misses the box by 10 px means the same thing. */
    root.addEventListener('dragover', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      drop.setAttribute('data-over', '1');
    });
    root.addEventListener('dragleave', function (event) {
      // Only when the pointer really left the component: dragging over a child fires dragleave on it.
      if (event && event.relatedTarget && root.contains(event.relatedTarget)) return;
      drop.removeAttribute('data-over');
    });
    root.addEventListener('drop', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      drop.removeAttribute('data-over');
      var files = event && event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null;
      if (!files || !files.length) return;
      if (locked()) { onStatus(switching ? text.switchingBusy : text.dropBusy, 'warn'); return; }
      var file = files[0];
      var isModel = MODEL_PATTERN.test(file.name || '');
      // An Electron window hands a dropped file over as a File too, and then the bytes are as good as a path
      // — one upload path for both surfaces, rather than a second transport that only works in one of them.
      if (!isModel) {
        onStatus(text.noModel, 'warn');
        return;
      }
      importFile(file);
    });

    var api = {
      element: root,
      /** Re-read the catalog and repaint. */
      refresh: refresh,
      /**
       * The model in use changed (a settings snapshot): repaint the marker, and ask whether an in-flight switch
       * has finished. This is the ONLY completion signal the bar has, which is why every caller's snapshot
       * handler calls it — see `settleSwitch`.
       */
      setCurrent: function () { pendingId = null; render(); settleSwitch(); },
      /**
       * Draw in another language, WITHOUT being rebuilt.
       *
       * `options.language` is fixed at construction, and that is right for a wizard step whose language was settled
       * before the step was reached. The 切换模型 page is the other case: its language comes from the settings store
       * it polls, so it can change while the picker is on screen. Rebuilding would be the easy answer and the wrong
       * one — it would throw away a switch's progress bar, its pending tile and the catalogue it already has, so a
       * language change would cost a second round trip and lose the user's click. `relabel()` is what this changes:
       * the same nodes, the same state, new words.
       *
       * A language this component does not know ('auto', undefined, a typo) is IGNORED rather than treated as
       * Chinese: the picker keeps the table it has, so a caller that passes the store's raw preference through
       * cannot flip a page to Chinese by accident.
       *
       * @returns {boolean} whether the picker redrew — false for "same language" and for "not a language I know"
       */
      setLanguage: function (next) {
        var wanted = next === 'en' ? 'en' : (next === 'zh' ? 'zh' : null);
        if (!wanted || wanted === language) return false;
        language = wanted;
        text = resolveText(language);
        relabel();
        return true;
      },
      /** Adopt a catalog payload a caller already has (the guide's own GET, a probe). */
      apply: apply,
      /** Import a path (the launcher's dialog) or a File (a drop, a browser input). */
      importPath: importPath,
      importFile: importFile,
      /** The picker's own account of itself, for a probe. */
      state: function () {
        return {
          models: models.map(function (model) {
            return { id: model.id, name: model.name, source: model.source, author: model.credit ? model.credit.author : null };
          }),
          credits: creditedModels().map(function (model) {
            return { name: model.name, author: model.credit.author, source: model.credit.source || null };
          }),
          total: models.length,
          imported: imported.length,
          language: language,
          current: currentId(),
          busy: busy,
          switching: switching ? switching.id : null,
          progressVisible: progress.hidden !== true,
          locked: locked(),
          dropOver: drop.getAttribute('data-over') === '1',
          hasNativePicker: Boolean(bridge && typeof bridge.pickModelFile === 'function'),
        };
      },
      destroy: function () {
        endSwitch();
        clear(root);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
    return api;
  }

  var api = {
    createModelPicker: createModelPicker,
    MODEL_ACCEPT: MODEL_ACCEPT,
    MODEL_PATTERN: MODEL_PATTERN,
    strings: resolveText,
  };
  if (typeof globalThis !== 'undefined') globalThis.__VRMPET3D_DEV_MODEL_PICKER__ = api;
})();

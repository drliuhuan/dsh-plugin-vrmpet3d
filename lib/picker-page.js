/**
 * 切换模型's page script: mount the shared picker, and write the choice through the host's settings store.
 *
 * Deliberately thin. Everything a user sees or clicks — the drop zone, the file input, the thumbnail grid —
 * belongs to `lib/model-picker.js`, because the guide's ② 偏好模型 step mounts the same component and the operator
 * asked for the two to be identical. What lives HERE is the one thing that differs between the two mounts: this
 * page owns no other step, so it writes `modelId` straight through `core.watchHostSettings`, while the guide
 * keeps its own snapshot-guarded `patchPreferences`.
 *
 * The snapshot latch is the settings pages' rule, and it applies here for the same reason it does there
 * (`hasSnapshot` in `lib/config-page.js`): nothing is written before the first read, or a page that booted into
 * defaults would overwrite everything the user configured.
 *
 * AND THE LANGUAGE IS THE SECOND THING THIS PAGE OWNS. The two settings pages pick theirs when they boot, and so
 * does the guide; this page can be sitting open while the user changes 界面语言 in 通用设置, because the setting
 * lives in the same store the page already polls. So every snapshot re-resolves it (`resolveLanguage`), the
 * page's own lines are written in it (`t`), and the mounted component is RE-LABELLED rather than rebuilt — see
 * `applyLanguage` for why that is not just an optimisation.
 *
 * For the browser probe and the launcher's self-test: `window.__VRMPET3D_DEV_PICKER_STATE__`.
 */
(function () {
  'use strict';

  var core = globalThis.__VRMPET3D_DEV_CORE__;
  var pickerApi = globalThis.__VRMPET3D_DEV_MODEL_PICKER__;

  /**
   * This page's own words, in both languages — `{ zh, en }`, the shape `core.textFor` and `core.applyI18n` take.
   *
   * The first five are the ones the MARKUP also carries: `lib/picker-page.html` marks its title, eyebrow, heading,
   * status placeholder and section heading with `data-i18n`, and keeps the Chinese inline, so a page whose script
   * never ran still says something in one language rather than showing nothing. The rest exist only here, because
   * they are the lines THIS SCRIPT writes (the six status/error lines), and there is no markup to fall back to.
   *
   * THE TWO HALVES MUST HOLD THE SAME KEYS: a key the English half lacks falls back to Chinese mid-page
   * (`core.textFor`), which is the half-translated interface this table exists to prevent.
   */
  var TEXT = {
    zh: {
      title: 'vrmpet3d-dev · 切换模型',
      eyebrow: 'VRMPET3D_DEV · MODELS',
      heading: '切换模型',
      statusLoading: '正在读取…',
      sectionModels: '模型',
      reading: '正在读取模型列表…',
      settingsRead: '已读取当前设置。',
      noHostSync: '这个宿主没有提供设置接口，切换只在本页生效。',
      noCoreSettings: '这个版本的 core 没有设置接口，页面只能展示默认值。',
      missingPicker: '页面脚本缺失：model-picker.js 没有加载。',
      missingMount: '页面结构缺失：找不到 #picker-mount。',
    },
    en: {
      title: 'vrmpet3d-dev · Switch model',
      eyebrow: 'VRMPET3D_DEV · MODELS',
      heading: 'Switch model',
      statusLoading: 'Reading…',
      sectionModels: 'Model',
      reading: 'Reading the model list…',
      settingsRead: 'Settings loaded.',
      noHostSync: 'This host has no settings API, so a switch only affects this page.',
      noCoreSettings: 'This build of core has no settings API, so the page can only show defaults.',
      missingPicker: 'Page script missing: model-picker.js did not load.',
      missingMount: 'Page markup missing: #picker-mount was not found.',
    },
  };

  /** The first host snapshot is the permission to write. */
  var hasSnapshot = false;
  var preferences = core ? core.cleanPreferences({}) : {};
  var hostSync = null;
  var picker = null;
  /** Which model a SURFACE reports it is showing (`snapshot.live`), which is what ends the progress bar. */
  var liveModel = null;
  /**
   * The language this page draws in — `'zh'` or `'en'`, never `'auto'` (see `resolveLanguage`).
   *
   * `null` until the first resolution, which is what makes the boot pass the one that fills the markup in.
   */
  var language = null;

  function el(id) { return document.getElementById(id); }

  /**
   * The line on `#status` right now: `{key}` when it is one of THIS page's own, `{text}` when the picker or the
   * bootstrap watchdog wrote it, and `null` before anything has been written.
   *
   * The distinction is what a language change needs. One of this page's lines can be said again in the new
   * language because it is stored as a KEY; a finished sentence from the component cannot be re-derived, so it is
   * left exactly as it is rather than replaced by a translation of the placeholder — which would read as "reading
   * the model list" while a model is in fact still loading.
   */
  var statusLine = null;
  /** What this page last painted, so a line written by somebody ELSE (the watchdog) can be told apart from it. */
  var paintedStatus = null;

  function paintStatus() {
    var node = el('status');
    if (!node || !statusLine) return;
    node.textContent = statusLine.key ? t(statusLine.key) : statusLine.text;
    node.className = statusLine.kind === 'warn' ? 'warn' : '';
    paintedStatus = node.textContent;
  }

  /** A line this page wrote, as the key it came from — so a later language change can write it again. */
  function setStatusKey(key, kind) {
    statusLine = { key: key, kind: kind };
    paintStatus();
  }

  /** A finished line, from the picker's `onStatus`. */
  function setStatus(message, kind) {
    statusLine = { text: message || '', kind: kind };
    paintStatus();
  }

  /** The markup's own placeholder — the one line in `#status` that a translation is allowed to replace. */
  function isPlaceholder(text) {
    return text === TEXT.zh.statusLoading || text === TEXT.en.statusLoading;
  }

  /**
   * One of THIS page's own lines, in the language on screen.
   *
   * `core.textFor` when core is there — so the lookup rule (and the fallback to the other language for a gap) is
   * the shared one rather than a second implementation of it — and the table itself when core is old enough not to
   * have it. A key with no entry shows as the KEY rather than as a blank line, which is how a missing entry gets
   * reported instead of silently disappearing.
   */
  function t(key) {
    var words = core && typeof core.textFor === 'function'
      ? core.textFor(TEXT, language)
      : (language === 'en' ? TEXT.en : TEXT.zh);
    var value = words[key];
    return typeof value === 'string' ? value : key;
  }

  /**
   * The id a pet is ACTUALLY showing, from the store's own live report.
   *
   * The settings store keeps `live: {app, window}` — each surface says which model it has on screen — and the
   * progress bar needs exactly that: "the store took my click" is not "the model has loaded". The in-app pet is
   * preferred because it is the one always there (a floating window may not be open at all); a null answer means
   * the component falls back to the store's word.
   */
  function liveModelIdOf(snapshot) {
    var live = snapshot && snapshot.live ? snapshot.live : null;
    if (!live) return null;
    if (typeof live.app === 'string' && live.app) return live.app;
    if (typeof live.window === 'string' && live.window) return live.window;
    return null;
  }

  /** The model in use, exactly as the store holds it — '' means 自动 (the bundled model). */
  function modelId() {
    return typeof preferences.modelId === 'string' ? preferences.modelId : '';
  }

  /**
   * Which language this page draws in, from the USER's setting and this surface's own environment.
   *
   * `preferences.language` is the store's answer — `'auto' | 'zh' | 'en'` (`core.LANGUAGE_SETTINGS`), which
   * `core.cleanPreferences` passes through — so a choice made in 通用设置, in the guide or by another window
   * reaches this page on its next snapshot. `'auto'` falls to `core.browserLanguageHints()`, which asks the
   * browser BEFORE the document's own `lang`: every page in this plugin ships `<html lang="zh">`, so a page that
   * read its own markup first could never auto-detect English.
   *
   * A core too old to know about languages keeps this page's own shipped answer, `'zh'` — the value this page
   * passed unconditionally before it could resolve one, so an old host degrades to the old behaviour rather than
   * failing to boot.
   */
  function resolveLanguage() {
    if (core && typeof core.resolveLanguage === 'function') {
      var hints = typeof core.browserLanguageHints === 'function' ? core.browserLanguageHints() : null;
      return core.resolveLanguage(preferences.language, hints);
    }
    return 'zh';
  }

  /**
   * Put the resolved language everywhere it is needed: the marked-up text, `html lang`, this page's own lines
   * (through `t` at the point of use) and the mounted component.
   *
   * The component is RE-LABELLED, not rebuilt, and that is a real distinction rather than tidiness: a rebuild
   * throws away a switch's progress bar, the tile it is pending on and the catalogue the grid already has — and a
   * language change is exactly when a switch may be in flight, because the user has just come back from 通用设置
   * to look at the window. `setLanguage` is the component's documented path for this; a component old enough not
   * to have it keeps the language it was built with rather than being destroyed, so a language change can never
   * cost the user the click they just made.
   *
   * The bootstrap watchdog writes into `#status` too, and it is the FIRST script on the page — it reports a
   * core.js that threw before this script ran. `core.applyI18n` fills every marked node including that one, so a
   * line the watchdog has already written is put back; the placeholder the markup ships is the only text the
   * translation is allowed to replace.
   *
   * @returns {boolean} whether the language changed — false on the 700 ms polls that change nothing
   */
  function applyLanguage() {
    var next = resolveLanguage();
    if (next === language) return false;
    language = next;
    /**
     * What is on the status line right now, if this page did NOT put it there.
     *
     * The bootstrap watchdog is the first script on the page and it writes into `#status` itself — it reports a
     * core.js that threw while this script was still loading. `core.applyI18n` fills every marked node, that one
     * included, so a line written by somebody else is captured here and put back: the placeholder the markup ships
     * is the only text a translation may replace.
     */
    var status = el('status');
    var foreign = status && !isPlaceholder(status.textContent) && status.textContent !== paintedStatus
      ? status.textContent
      : null;
    if (core && typeof core.applyI18n === 'function') core.applyI18n(document, TEXT, language);
    if (foreign !== null) {
      status.textContent = foreign;
      status.className = 'warn';
    } else {
      // One of this page's own lines — or the placeholder, which `applyI18n` has just translated.
      paintStatus();
    }
    // The document says which language it is in, which is what a screen reader, a spell checker and a hyphenator
    // read it for — and it is NOT the hint this page resolves from (that one was read before this line).
    if (document.documentElement) document.documentElement.lang = language;
    if (picker && typeof picker.setLanguage === 'function') picker.setLanguage(language);
    return true;
  }

  function patchPreferences(patch) {
    Object.keys(patch).forEach(function (key) { preferences[key] = patch[key]; });
    if (!hasSnapshot || !hostSync || typeof hostSync.push !== 'function') {
      setStatusKey('noHostSync', 'warn');
      return;
    }
    hostSync.push({ preferences: patch });
  }

  /**
   * 点击缩略图 → write the preference.
   *
   * One key, and the same store the two settings pages and both pets read, which is what makes the switch land
   * on the running pet without a reload: the surfaces poll this store's version.
   */
  function choose(id) {
    if (!id) return;
    patchPreferences({ modelId: id });
  }

  function watchSettings() {
    if (!core || typeof core.watchHostSettings !== 'function') {
      setStatusKey('noCoreSettings', 'warn');
      return;
    }
    hostSync = core.watchHostSettings({
      /**
       * Polled FASTER than the surfaces' default 1.5 s.
       *
       * The progress bar ends on the live report, which reaches this page through a snapshot — so the poll
       * interval is added directly to how long the bar lingers after the model is already on screen. At 700 ms
       * that extra wait is under a second; at the default it can be nearly two, which is the complaint this bar
       * was written for (「明明模型已经切换好了，为什么还走了这么长时间的进度条」). It is cheap: one small JSON GET,
       * and only while this window is open.
       */
      intervalMs: 700,
      onSnapshot: function (snapshot) {
        preferences = core.cleanPreferences(snapshot.preferences || {});
        hasSnapshot = true;
        // The store's 界面语言 may have moved while this window was open (another window, or the guide), so the
        // language is re-resolved BEFORE the lines below are written: a status line written first would be the one
        // thing left in the old language.
        applyLanguage();
        // Which model a pet reports it is SHOWING: the progress bar waits for this, not merely for the write.
        liveModel = liveModelIdOf(snapshot);
        // The value that wins is the STORE's, so a switch made from another window repaints this grid — and
        // the tile clicked a moment ago stops being "pending" and becomes the stored truth. `setCurrent` is also
        // what asks whether an in-flight switch has finished.
        if (picker) picker.setCurrent();
        // A snapshot that COMPLETES a switch must not have its line overwritten by this one.
        if (!(picker && picker.state().switching)) setStatusKey('settingsRead');
      },
    }).start();
  }

  function boot() {
    var mount = el('picker-mount');
    // The language FIRST, so that even the failure lines below are in the language the user asked for. The store
    // has not answered yet, so this resolves `'auto'` from the browser; the first snapshot resolves it again and
    // re-labels if the store says otherwise.
    applyLanguage();
    if (!pickerApi || typeof pickerApi.createModelPicker !== 'function') {
      setStatusKey('missingPicker', 'warn');
      return;
    }
    if (!mount) {
      setStatusKey('missingMount', 'warn');
      return;
    }
    picker = pickerApi.createModelPicker({
      mount: mount,
      // The RESOLVED language, not the store's preference: the component owns two tables and no opinion about
      // 'auto' (see `resolveText` in lib/model-picker.js). A change after this point goes through `setLanguage`,
      // which is what `applyLanguage` calls.
      language: language,
      currentModelId: modelId,
      // The live report is what makes the bar about the LOAD rather than about the write. See `liveModelIdOf`.
      liveModelId: function () { return liveModel; },
      onSwitch: choose,
      onStatus: setStatus,
    });
    watchSettings();
    setStatusKey('reading');
    picker.refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  globalThis.__VRMPET3D_DEV_PICKER_STATE__ = function () {
    return {
      hasSnapshot: hasSnapshot,
      current: modelId(),
      language: language,
      picker: picker ? picker.state() : null,
    };
  };
})();

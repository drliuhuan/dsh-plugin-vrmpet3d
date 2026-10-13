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
 * For the browser probe and the launcher's self-test: `window.__VRMPET3D_PICKER_STATE__`.
 */
(function () {
  'use strict';

  var core = globalThis.__VRMPET3D_CORE__;
  var pickerApi = globalThis.__VRMPET3D_MODEL_PICKER__;

  /** The first host snapshot is the permission to write. */
  var hasSnapshot = false;
  var preferences = core ? core.cleanPreferences({}) : {};
  var hostSync = null;
  var picker = null;
  /** Which model a SURFACE reports it is showing (`snapshot.live`), which is what ends the progress bar. */
  var liveModel = null;

  function el(id) { return document.getElementById(id); }

  function setStatus(text, kind) {
    var node = el('status');
    if (!node) return;
    node.textContent = text || '';
    node.className = kind === 'warn' ? 'warn' : '';
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

  function patchPreferences(patch) {
    Object.keys(patch).forEach(function (key) { preferences[key] = patch[key]; });
    if (!hasSnapshot || !hostSync || typeof hostSync.push !== 'function') {
      setStatus('这个宿主没有提供设置接口，切换只在本页生效。', 'warn');
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
      setStatus('这个版本的 core 没有设置接口，页面只能展示默认值。', 'warn');
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
        // Which model a pet reports it is SHOWING: the progress bar waits for this, not merely for the write.
        liveModel = liveModelIdOf(snapshot);
        // The value that wins is the STORE's, so a switch made from another window repaints this grid — and
        // the tile clicked a moment ago stops being "pending" and becomes the stored truth. `setCurrent` is also
        // what asks whether an in-flight switch has finished.
        if (picker) picker.setCurrent();
        // A snapshot that COMPLETES a switch must not have its line overwritten by this one.
        if (!(picker && picker.state().switching)) setStatus('已读取当前设置。');
      },
    }).start();
  }

  function boot() {
    var mount = el('picker-mount');
    if (!pickerApi || typeof pickerApi.createModelPicker !== 'function') {
      setStatus('页面脚本缺失：model-picker.js 没有加载。', 'warn');
      return;
    }
    if (!mount) {
      setStatus('页面结构缺失：找不到 #picker-mount。', 'warn');
      return;
    }
    picker = pickerApi.createModelPicker({
      mount: mount,
      language: 'zh',
      currentModelId: modelId,
      // The live report is what makes the bar about the LOAD rather than about the write. See `liveModelIdOf`.
      liveModelId: function () { return liveModel; },
      onSwitch: choose,
      onStatus: setStatus,
    });
    watchSettings();
    setStatus('正在读取模型列表…');
    picker.refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  globalThis.__VRMPET3D_PICKER_STATE__ = function () {
    return {
      hasSnapshot: hasSnapshot,
      current: modelId(),
      picker: picker ? picker.state() : null,
    };
  };
})();

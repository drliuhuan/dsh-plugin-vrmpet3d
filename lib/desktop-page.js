// The desktop pet's page: the same pet as the in-app overlay, in a window of its own.
//
// It reuses everything the overlay proved ?`Placement` for position, throw physics and the
// wall/ceiling bounces, `Scene` for the model, framing, idle, gaze and the orbit ?and adds only
// what is different about living on the desktop:
//
//   * the frame is the SCREEN, so the pet can be thrown across the whole display and lands on the
//     bottom of the working area;
//   * the CANVAS is the pet's own box, positioned inside that frame with CSS, exactly as the
//     overlay does it. This is not a detail: `Scene.setPlacement` ignores x/y and frames the model
//     to the canvas, so a screen-sized canvas draws a screen-sized pet. The first version did that
//     and the pet covered most of the display;
//   * the cursor comes from the launcher (`screen.getCursorScreenPoint()`), because a click-through
//     window receives no pointer events at all outside the pet;
//   * the HIT TEST is per pixel: the launcher passes clicks through unless the pixel under the
//     cursor was actually painted, so a gap between hair strands is click-through while the hair
//     itself takes the click and the wheel.
//
// Published as `globalThis.__VRMPET3D_DESKTOP__` so the browser suite can mount it against a fake
// bridge and assert the behaviour without Electron.
(function () {
  'use strict';

  // The three sources are read when `mount` is called, NOT here: capturing them at load time
  // makes this file depend on the order of the page's <script> tags, which is an implementation
  // detail of whoever assembled the page. It broke exactly that way once ?the glue was inlined
  // before `client.js`, so `Placement` was missing and every mount threw.

  /** Right-drag: how far the view turns per pixel, and how far a press may wander first. */
  var VIEW_YAW_PER_PIXEL = 0.008;
  var VIEW_PITCH_PER_PIXEL = 0.006;
  /**
   * How far a secondary press may wander before it is an ORBIT rather than a right-click.
   *
   * **The same bug as the app overlay's copy of this number, and the same fix** (operator, 2026-10-12:
   * 「内置宠物右键单击无效」, and this window decides the gesture the same way). It was 4, measured as a MANHATTAN
   * distance, so 2 px of hand wobble on each axis was already an orbit — and the menu is only opened on the
   * release of a press that did NOT move (`onPointerUp` below), so a right-click with a normal hand produced
   * no menu at all. 10 px leaves room for a hand and is still nothing as an orbit (0.08 rad ≈ 4.6°).
   *
   * This window has no `suppressContextMenu` flag and does not need one: it decides on `pointerup`, where the
   * app overlay has to decide from the `contextmenu` event and therefore has to SWALLOW one. That is why the
   * failure looked different in the two places with the same number behind it.
   */
  var VIEW_DRAG_THRESHOLD = 10;

  /**
   * The pet's share of the screen, as a ceiling on its box.
   *
   * The WHOLE frame. This used to be 22 % x 45 %, and the user asked for the ceiling to be the
   * screen's own shortest edge instead: "the largest zoom must not exceed the screen's shortest
   * edge". The rule itself lives in `core.sizeLimits` — the wheel stops when the pet's long edge
   * reaches that edge — so this fraction only has to not be the tighter of the two. The app overlay
   * keeps its own, much smaller fraction, because there the pet's box is a hit area sitting over an
   * app the user is still working in.
   */
  var SCREEN_SLOT_FRACTION = { width: 1, height: 1 };

  /** Alpha above this counts as painted. Below it, that pixel is the desktop showing through. */
  var PAINTED_ALPHA = 8;

  /**
   * The menu's own measuring margin: the same 4 px the frame's clamps use, so a menu opened at the very edge
   * of the work area is fully on screen rather than one border-width off it.
   */
  var MENU_MARGIN = 4;

  /**
   * This page's own stylesheet, injected once.
   *
   * Injected rather than left to the page's <style>, because the suite mounts this module into its own
   * document: the status prompt and the 碎碎念 bubble are this page's own, and a probe has to be able to measure
   * them anywhere. The MENU is styled by the shared module (`lib/menu.js`'s `STYLE`, injected by `buildMenu`),
   * which is what makes the two surfaces' menus the same object rather than two look-alikes.
   */
  function installDesktopStyles(doc) {
    if (!doc || !doc.head || doc.getElementById('vrmpet3d-desktop-style')) return;
    var style = doc.createElement('style');
    style.id = 'vrmpet3d-desktop-style';
    style.textContent = [
      /**
       * The head-status prompt: DSH's own running label.
       *
       * The window is a plain page with no DSH stylesheet, so its colours are written out here instead of
       * read from the app's tokens — the shape, the sizes and the animation are the app's, though, because
       * the operator asked for DSH's own label ("我要的是dsh内部的前面带着一个鲸鱼尾巴图标的'深度求索中，用时
       * XX分XX秒 ···'"). The structure follows `RunningStatus` + `TextShimmer`; the whale is the app's own
       * stroked path in a 16x16 viewBox, drawn OUTSIDE the shimmer so it keeps the base colour while the
       * highlight travels over the words, and the words themselves are rendered twice from one string.
       *
       * NO `transform` on the plate, deliberately: this is also the fix for "小宠物这边没有任何工作状态的显示"
       * (2026-10-09). `layoutStatus` computes the box's final top-left itself — half the width to the left of
       * the head's projected centre, one full height above its top — and clamps THAT into the frame, which is
       * only correct if the element is drawn exactly where `left`/`top` say. The stylesheet used to apply
       * `translate(-50%,-100%)` on top of those already-centred numbers, so the prompt was drawn one full
       * width further left and one full height further up: entirely ABOVE the window's top edge, invisible.
       * It also meant the rectangle the page reports (and the launcher sizes the window from) did not describe
       * what was on screen, so the window never grew to hold the prompt either. The in-app prompt keeps its
       * transform because `placeHeadStatus` hands it the ANCHOR point instead; this path hands over a
       * top-left, and the two must not be mixed.
       *
       * The window is transparent, so without a plate behind it the text would be unreadable over a bright
       * desktop. The font size is a variable written from the pet's box, so the whole label grows with the pet.
       */
      /**
       * desktop. The font size is a variable written from the model's own correction — and NOT from the box: the
       * default is the fixed 18 px the operator set, and zooming the pet must not resize the text
       * (2026-10-13: 「默认文字大小固定，放大缩小的倍数和盒子大小解耦连…避免缩放模型的时候缩放文字」).
       */
      '.vrmpet3d-desktop-status{position:absolute;z-index:3;box-sizing:border-box;',
      'display:inline-flex;align-items:center;gap:.5em;',
      /* NO `max-width`: the line never wraps ("提示文字永不换行"), so the plate is as wide as its text. */
      'padding:.16em .8em;border-radius:.75em;pointer-events:none;',
      'font:500 var(--vrmpet3d-desktop-status-font,18px)/1.55 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif;',
      'color:#8fb4ff;background:rgba(22,23,28,.82);border:1px solid rgba(143,180,255,.22)}',
      '.vrmpet3d-desktop-status[hidden]{display:none}',
      /**
       * 任务达成 gold and bold, 任务失败/出错 red — the operator's words (2026-10-11). Here the shades are the
       * WINDOW's own: it draws over whatever is on the desktop rather than on DSH's theme tokens, so the gold
       * has to stay readable on a light and on a dark background, and the red matches the app's failure colour.
       */
      '.vrmpet3d-desktop-status[data-tone="gold"]{color:#ffc94d}',
      '.vrmpet3d-desktop-status[data-tone="gold"][data-bold="1"]{font-weight:700}',
      '.vrmpet3d-desktop-status[data-tone="danger"]{color:#ff6b6b}',
      /**
       * 碎碎念: the pet's own short remark, above the prompt.
       *
       * A plate like the prompt's, in the page's own colours (the window has no DSH stylesheet to read tokens from).
       * Nothing of it is painted into the framebuffer, so it is DECLARED interactive — `isOverSpeech` is in the page's
       * hit test — which is what lets the wheel over the bubble resize the text (operator, 2026-10-13: 「给碎碎念也加上
       * 同样的鼠标滚轮放大功能」). It used to be left out of the hit test, when a bubble was only something to read.
       * The window also grows to hold it, because `reportRect` unions its box.
       */
      /**
       * 碎碎念 WRAPS (operator, 2026-10-13: 「状态文字不允许换行，但是给碎碎念增加换行功能…彻底杜绝宠物盒子大小变化的问题」):
       * a one-line remark as long as the pool's longest made this WINDOW wider, and near a screen edge the bounds were
       * clamped by the OS while the page compensated for the origin it had computed — the jump he reported. Wrapping at
       * the pet's own width bounds the bubble, and `-webkit-line-clamp: 3` bounds its height.
       */
      '.vrmpet3d-desktop-speech{position:absolute;z-index:4;box-sizing:border-box;',
      'max-width:var(--vrmpet3d-desktop-speech-width,220px);',
      /* Wrapped, centred, and NOT clipped — see the same rule in `lib/client.js` for why the line clamp went. */
      'text-align:center;padding:.18em .7em;border-radius:.9em;pointer-events:none;white-space:normal;overflow-wrap:anywhere;',
      'font:400 var(--vrmpet3d-desktop-speech-font,17.1px)/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif;',
      'color:#e9eaf0;background:rgba(30,31,37,.9);border:1px solid rgba(255,255,255,.18);',
      'box-shadow:0 6px 18px rgba(0,0,0,.4)}',
      '.vrmpet3d-desktop-speech[hidden]{display:none}',
      '.vrmpet3d-desktop-status-icon{width:1.17em;height:1.17em;flex:none;display:inline-flex;position:relative;contain:strict}',
      '.vrmpet3d-desktop-status-icon[hidden]{display:none}',
      /**
       * DSH's unread-completion dot, rule for rule from its `StateDot.module.css` — the same shape the app's pet draws,
       * with the literal green because this window has no DSH stylesheet to read the token from.
       */
      '.vrmpet3d-desktop-status-dot{position:relative;display:inline-block;flex:none;width:.56em;height:.56em;',
      '  color:#22c55e}',
      '.vrmpet3d-desktop-status-dot[hidden]{display:none}',
      '.vrmpet3d-desktop-status-dot::after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}',
      /**
       * DSH's own two-layer mark: the static SVG, and the animated APNG masked over it.
       *
       * `mask:url(…) 50%/100% 100% no-repeat alpha` is the app's declaration verbatim — `RunningWhaleTail`'s
       * stylesheet, activation conditions and all (alpha masks available, motion allowed, no forced colours) —
       * with the image served by this plugin's host instead of inlined as base64. The path is `/vrmpet3d/whale`,
       * the same string `lib/core.js` publishes as `STATUS_ICON_URL` and the same one the in-app stylesheet
       * names; `check-plugin-load.mjs` asserts the route and both declarations agree. This builder is
       * module-scope, so the core global is not a safe read here — hence the literal, checked.
       */
      '.vrmpet3d-whale{width:100%;height:100%;display:block}',
      '.vrmpet3d-whale-animated{display:none;position:absolute;inset:0}',
      "@supports (mask-mode:alpha) and (mask-image:url('')){",
      '  @media (prefers-reduced-motion:no-preference) and (forced-colors:none){',
      '    .vrmpet3d-whale-animated{background:currentColor;display:block;',
      '      mask:url(/vrmpet3d/whale) 50%/100% 100% no-repeat alpha;',
      '      -webkit-mask:url(/vrmpet3d/whale) 50%/100% 100% no-repeat}',
      '  }}',
      '.vrmpet3d-desktop-status-shimmer{position:relative;display:inline-grid;width:max-content;max-width:100%;',
      'min-width:0;vertical-align:top;color:inherit}',
      '.vrmpet3d-desktop-status-content{display:flex;align-items:center;min-width:0}',
      /* `nowrap`, always: the operator's "提示文字永不换行". One line, however long the line is. */
      '.vrmpet3d-desktop-status-text{color:inherit;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.vrmpet3d-desktop-status-text[data-shimmer-text]::after{content:attr(data-shimmer-text)}',
      '.vrmpet3d-desktop-status-decoration{position:absolute;inset:0;overflow:clip;pointer-events:none;user-select:none}',
      '.vrmpet3d-desktop-status-decoration[hidden]{display:none}',
      '.vrmpet3d-desktop-status-sweep{position:absolute;inset:0;overflow:hidden;color:#cfdfff;',
      'mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);',
      '-webkit-mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);',
      'transform:translateX(-100%);animation-name:vrmpet3d-desktop-status-sweep}',
      '.vrmpet3d-desktop-status-sweep *{color:inherit!important}',
      /* Opposite transforms keep every glyph aligned while their shared mask moves. Copied verbatim from
         `dsh-client-ui-primitives/TextShimmer.module.css`; one half alone is a broken gradient. */
      '.vrmpet3d-desktop-status-highlight{width:100%;height:100%;transform:translateX(100%);',
      'animation-name:vrmpet3d-desktop-status-highlight}',
      '.vrmpet3d-desktop-status-sweep,.vrmpet3d-desktop-status-highlight{animation-duration:1.5s;animation-delay:.3s;',
      'animation-timing-function:steps(48,end);animation-iteration-count:infinite}',
      '@keyframes vrmpet3d-desktop-status-sweep{0%{transform:translateX(-100%)}66.6667%,100%{transform:translateX(100%)}}',
      '@keyframes vrmpet3d-desktop-status-highlight{0%{transform:translateX(100%)}66.6667%,100%{transform:translateX(-100%)}}',
      '@media(prefers-reduced-motion:reduce){.vrmpet3d-desktop-status-decoration{display:none}}',
    ].join('');
    doc.head.appendChild(style);
  }



  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function storageFor(options) {
    if (options.storage) return options.storage;
    try {
      return globalThis.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function readPreferences(store, core) {
    if (!store) return core.cleanPreferences({});
    try {
      /**
       * The stored preferences under the CURRENT name or an older one (`core.storedPreferences`).
       *
       * This page and `client.core.js` are delivered separately, so the helper is checked for: a page served
       * beside an older chunk reads the current key alone, which is what that chunk knows about. The write
       * (`writePreferences`) always uses `core.STORAGE_KEY`, so the migration happens on the first edit.
       */
      var stored = typeof core.storedPreferences === 'function' ? core.storedPreferences(store) : null;
      var raw = stored ? stored.raw : store.getItem(core.STORAGE_KEY);
      return core.cleanPreferences(raw ? JSON.parse(raw) : {});
    } catch (_error) {
      return core.cleanPreferences({});
    }
  }

  /**
   * The page's link to the host, set by mount().
   *
   * Only the keys THIS page owns are pushed. Pushing the whole preference set would mean that zooming the
   * pet could revert a spring slider somebody had just moved in the settings window, because this page's
   * copy was a poll behind.
   */
  var hostLink = null;
  /**
   * The keys THIS page owns, and therefore the keys it sends to the host store.
   *
   * Only its own, because the patch is MERGED: sending a stale copy of a key another surface owns — the
   * settings window's springs, or the prompt's text lines — would undo whatever that surface had just set.
   *
   * `statusScale` is here because `zoom()` writes through this function, and the prompt's per-model text
   * correction must survive the model being resized: it was missing, so every wheel on the pet replaced the
   * host's preferences with a copy that had no correction in it, the next snapshot dropped it, and the text
   * snapped back to the derived size — the operator's "文字调整好了，结果缩放模型的时候又恢复原状了".
   *
   * `windowSize`, not `size`: this page's frame is the whole screen, so its size percent is its OWN key (see
   * `core.DEFAULTS.windowSize`). Pushing `size` from here was what let a DSH reload hand the floating window
   * the in-app pet's percentage — measured 2026-10-10, 202×276 instead of 396×540.
   *
   * `placementX`/`placementY` are here for the same reason the size key is: the HOST's copy is what survives a
   * reload for this page (its localStorage is a different profile from DSH's), so a position that never reached
   * the store is a position every snapshot overwrites — which is why the window used to return to its default
   * corner even though the drag wrote it.
   */
  var LOCAL_KEYS = [
    'windowSize', 'viewYaw', 'viewPitch', 'hidden', 'scope', 'sleepAfterMs', 'statusScale',
    'placementX', 'placementY',
    /**
     * `petSurface` is here because this surface's two entries write it (切换回窗口内, 关闭宠物) and the APP's
     * pet is what acts on it: a choice that never reached the host store would be undone by the next snapshot,
     * and the window would stay on screen after the user asked for it to go.
     *
     * `panelOpen` used to be here — the panel's own open state. The menu has no state to restore (it is built
     * fresh on every right-click), so the key is gone rather than pushed as a value nothing reads.
     */
    'petSurface',
    /**
     * 重力 on this surface's OWN key (`windowGravity`), which is what makes it independent of the app pet's
     * (`gravity`). Pushed so the host store carries it and a snapshot cannot undo the switch; the app's pet
     * never writes this key and this page never writes that one.
     */
    'windowGravity',
  ];

  function writePreferences(store, core, preferences) {
    if (store) {
      try {
        store.setItem(core.STORAGE_KEY, JSON.stringify(preferences));
      } catch (_error) {
        // A full or blocked storage must not stop the pet from being dragged.
      }
    }
    if (hostLink) {
      var patch = {};
      LOCAL_KEYS.forEach(function (key) {
        if (key in preferences) patch[key] = preferences[key];
      });
      hostLink.push({ preferences: patch });
    }
  }

  /**
   * Which model a snapshot says this window is showing.
   *
   * The launcher decides that, not the page, and the host reports it back in `live.window`. It matters
   * because a spring override is keyed BY MODEL ID: a page that guessed 'placeholder' from its empty
   * storage while the launcher had loaded m2 wrote every override under a key the renderer never read -
   * which is how 'the spring sliders do nothing' was reported.
   */
  function snapshotModel(snapshot) {
    if (snapshot && snapshot.live && typeof snapshot.live.window === 'string' && snapshot.live.window) {
      return snapshot.live.window;
    }
    return null;
  }

  /**
   * Mount the pet into `options.canvas` and start its frame loop.
   *
   * @param {object} options
   *   canvas      the pet's canvas; positioned and sized to the pet's box by this module
   *   bridge      `{ reportRect, ready, onCursor }`, or null in a test
   *   modelId     the model to load; anything falsy keeps the procedural placeholder
   *   screen      `{ x, y, width, height }` of the window's own origin on the desktop
   *   storage     a localStorage-like object; defaults to the page's own
   */
  function mount(options) {
    // Resolved at mount time, so the page's script order cannot break the pet.
    var core = options.core || globalThis.__VRMPET3D_CORE__;
    var client = options.client || globalThis.__VRMPET3D_CLIENT__;
    var sceneApi = options.sceneApi || globalThis.__VRMPET3D_SCENE__;
    if (!core || !client || !sceneApi) throw new Error('vrmpet3d desktop: sources are not loaded');

    var canvas = options.canvas;
    var bridge = options.bridge || null;
    // x/y defaulted rather than trusted: they are added to every rectangle this page reports, and
    // an undefined origin turns that rectangle into NaN ?which a consumer reading numbers out of
    // IPC turns into 0,0, leaving a pet whose hit area is nowhere near the pet.
    var box = options.screen || {};
    var screenBox = {
      x: Number(box.x) || 0,
      y: Number(box.y) || 0,
      width: Number(box.width) || 1,
      height: Number(box.height) || 1,
    };
    var store = storageFor(options);
    var preferences = readPreferences(store, core);

    var placement = new client.Placement(preferences, function () { return performance.now(); }, core);
    /**
     * This page's size percent lives in `windowSize`, never in the shared `size`.
     *
     * The frame here is the whole screen and the app overlay's is DSH's window, so one percentage is a
     * different pet in each; with a shared key, whichever surface wrote last won.
     */
    placement.sizeKey = 'windowSize';
    placement.setViewport(screenBox.width, screenBox.height);
    placement.maxSlotFraction = SCREEN_SLOT_FRACTION;
    placement.setSize(client.BASE_PET_SIZE.width, client.BASE_PET_SIZE.height);
    // Parked on the visible desktop rather than in a corner of the frame: the bottom-right of the
    // WORK area is where a desktop pet belongs, and the launcher does not know the taskbar. `null` is what
    // `cleanPreferences` answers for "never dragged" — the same as absent, and NOT a valid position.
    placement.x = preferences.placementX === undefined || preferences.placementX === null ? 0.86 : preferences.placementX;
    placement.y = preferences.placementY === undefined || preferences.placementY === null ? 0 : preferences.placementY;
    placement.clampToViewport();
    /**
     * 重力 in this window — and it SHIPS OFF, which is the behaviour this window has had since 2026-10-10
     * ("drag and place"): a drag puts the pet down where the user let go, and it stays there.
     *
     * The line used to be a hard-coded `placement.throwEnabled = false`. It is a preference now (operator,
     * 2026-10-12: 「内置和外置宠物菜单各增加一个'重力'开关」), because the menu's 重力 row has to be able to turn
     * throwing and falling back ON out here — and because the two pets' states are independent, this surface
     * reads `windowGravity` while the app's pet reads `gravity`. `applyGravity` is defined below with the menu
     * handlers; it is called here so the shipped default is in force from the first frame.
     */
    applyGravity();

    var scene = new sceneApi.Scene(canvas, {
      assetBase: options.assetBase || '/vrmpet3d/asset',
      modelId: options.modelId || '',
      onError: options.onError,
      /**
       * The hit test reads the framebuffer, and it is asked from TWO places: inside the frame
       * (right after the render) and from a cursor event (between frames, so the launcher can
       * answer without waiting for the next one). Without this the second read sees a buffer that
       * has already been cleared and reports "nothing was painted" everywhere — every click would
       * pass through the pet. The cost is one copy of a pet-sized buffer per frame: a few hundred
       * kilobytes.
       */
      preserveDrawingBuffer: true,
    });

    var cursor = null;
    /**
     * The previous cursor SAMPLE, for the draught's velocity: position plus when it arrived.
     *
     * Kept here rather than derived from the frame clock, because the wind is a property of the cursor's own
     * motion — two samples 8 ms apart are a fast sweep whatever the frame rate happens to be doing.
     */
    var previousCursor = null;
    var drag = null;
    var viewDrag = null;
    /**
     * 旋转用的指针锁 —— 与窗口内桌宠同一套方法（`lib/client.js` 的 `requestOrbitLock`）。
     *
     * 操作者的报告（2026-10-12）：「独立桌宠的旋转功能一直都异常，从来没能把鼠标真正锁住过，把窗口内桌宠的锁定鼠标
     * 旋转的方法搬到独立桌宠上。」 原因很直接：这个页面此前**根本没有锁代码**。而它比主窗更需要锁 —— 这个窗口只有
     * 宠物那么大，右拖几个像素鼠标就离开了窗口，指针事件随之停止，旋转就断在那里。
     *
     * 锁只属于"旋转"，不属于"按下"：主窗上一轮的教训（`lib/client.js` 里那段注释）在这里同样成立 —— 一次普通右键
     * 绝不该捕获光标，否则菜单就再也弹不出来。
     */
    var pointerLocked = false;

    /**
     * 开始/结束一次旋转 —— 顺便告诉启动器该不该放开焦点。
     *
     * 页面自己拿不到锁：Chromium 只给**聚焦的文档**发锁，而这个窗口刻意 `focusable: false`
     * （启动器自检里的 `pointerLock` 探测实测到的拒绝理由：「The root document of this element is not valid for
     * pointer lock.」）。所以顺序是：通知启动器 → 它把窗口设为可聚焦并聚焦 → 回一条 `vrmpet3d:orbit-focus` →
     * 页面这才请求锁。顺序反了就是那次被拒的请求。
     *
     * 在浏览器标签页里打开这个页面时没有 bridge，就直接请求（那种文档本来就有焦点）。
     */
    /**
     * 这次按压有没有向启动器要过焦点。
     *
     * 只有真的要过才还回去：一次普通右键点击从头到尾不该碰窗口的焦点状态（探针断言的就是这个 —— 第一版的
     * `endOrbitGesture` 无条件发 `orbit(false)`，于是每次点击都去动一次焦点，序列里全是 `false`）。
     */
    var orbitAsked = false;

    function beginOrbitGesture() {
      orbitAsked = true;
      /**
       * 有启动器时，取锁这件事**整件**交给它 —— 它是一个写者，页面只读结果。
       *
       * 页面自己请求是不行的：Chromium 要"请求那一刻文档已聚焦且处于用户激活状态"，而请求前必须先过一次 IPC
       * 让启动器把窗口设为可聚焦。操作者 2026-10-12 的反馈「并没有成功，光标没有被锁住」就是因为这个 —— 自检里
       * 我给了请求一个 `userGesture` 标记，于是它成功，而页面在生产里给不了。启动器用 Electron 的同一个标记
       * 替页面请求（见 `desktop/main.js` 的 `ORBIT_LOCK_JS`）。
       */
      if (bridge && typeof bridge.orbit === 'function') {
        bridge.orbit(true);
        return;
      }
      // 浏览器标签页里没有启动器，也没有那个 focusable 的约束：文档本来就有焦点，自己请求。
      requestOrbitLock();
    }

    function endOrbitGesture() {
      if (!orbitAsked) return;
      orbitAsked = false;
      if (bridge && typeof bridge.orbit === 'function') {
        bridge.orbit(false);
        return;
      }
      releaseOrbitLock();
    }

    /**
     * Turn the FALL into motion for the model, exactly as the in-app pet does.
     *
     * A fall is the drag's twin: what moves is the WINDOW, so the model's own world position inside the canvas never
     * changes and the spring bones see a pet standing still while it flies across the screen. `setDragMotion` is the
     * channel that puts the motion back — deliberately the SAME one the drag uses rather than a second mechanism.
     *
     * Two conversions, both load-bearing (and both identical to `lib/client.js`'s copy, which is the point — the two
     * surfaces must not drift):
     *   * the simulation is in FRAME FRACTIONS per second (`placement.viewportWidth/Height` is the whole work area
     *     here, not the pet's box), and the model wants CSS pixels per second;
     *   * `fall.vy` is positive UPWARD (`core.stepFall` does `vy -= gravity`) while `setDragMotion` takes screen
     *     coordinates, where y grows DOWNWARD. A flipped sign here is invisible in a straight drop and obvious on a
     *     bounce, where the lean would whip the wrong way.
     */
    function reportFallMotion() {
      if (!scene || typeof scene.setDragMotion !== 'function') return;
      var fall = placement.fall;
      if (!fall) {
        scene.setDragMotion(0, 0);
        return;
      }
      scene.setDragMotion(
        (fall.vx || 0) * (placement.viewportWidth || 1),
        -(fall.vy || 0) * (placement.viewportHeight || 1),
      );
    }

    /** 请求锁。被拒绝（窗口不可聚焦、没有用户手势）时什么都不发生，旋转仍走窗口内的位移。 */
    function requestOrbitLock() {
      try {
        if (!canvas || typeof canvas.requestPointerLock !== 'function') return null;
        if (doc && doc.pointerLockElement === canvas) return null;
        var result = canvas.requestPointerLock();
        // 新版 Chromium 返回 promise，被拒时 reject。
        if (result && typeof result.catch === 'function') {
          result.catch(function () { pointerLocked = false; });
        }
        return result;
      } catch (_error) {
        return null;
      }
    }

    /** 交回光标。松手、Escape、窗口失焦都走这里。 */
    function releaseOrbitLock() {
      try {
        if (doc && doc.pointerLockElement && typeof doc.exitPointerLock === 'function') doc.exitPointerLock();
      } catch (_error) { /* 没有锁 */ }
    }

    /**
     * 结束一次视角旋转 —— 唯一的收尾路径，松手、菜单事件、锁丢失都调它。
     *
     * `fromMenu` 为 true 时表示"这次是右键点击，不是拖拽"，由调用方决定要不要弹菜单：菜单由**松手**决定
     * （见 `onPointerUp`），这里只负责收尾。
     */
    function finishViewDrag() {
      if (!viewDrag) {
        endOrbitGesture();
        return false;
      }
      var orbited = viewDrag.moved === true;
      var pointerId = viewDrag.id;
      viewDrag = null;
      if (canvas.releasePointerCapture && pointerId !== undefined) {
        try { canvas.releasePointerCapture(pointerId); } catch (_error) { /* already gone */ }
      }
      endOrbitGesture();
      // 旋转结束：把 `orbiting: false` 报出去，启动器可以恢复"按像素穿透"的常态。
      reportRect();
      if (orbited) {
        // 转过了就把视角存起来：拖动时每个 pointermove 都写一次存储太贵，收尾时写一次。
        writePreferences(store, core, preferences);
      }
      return orbited;
    }
    var lastRect = null;
    var lastFrame = performance.now();
    var running = true;
    /**
     * The WINDOW's origin on screen, sent with every cursor sample.
     *
     * The window is the pet's own box (it used to be the whole work area, which froze everything
     * composed behind it — see HANDOFF §16), so this is what turns the virtual work-area frame the
     * placement lives in into window coordinates for the canvas and for pointer events.
     */
    var windowOrigin = { x: 0, y: 0 };
    var loadedModel = null;
    var frames = 0;
    var lastError = null;
    var errors = [];
    var over = false;
    var hitReads = 0;
    var gl = scene.renderer ? scene.renderer.getContext() : null;
    var pixel = new Uint8Array(4);
    /** The last hit-test read: where it looked and what it found. Diagnostic only. */
    var lastHit = null;
    /**
     * The aim the gaze last used, and the settings it was computed from. Published so a launcher-side
     * probe can tell "the 视线 setting reached the renderer" from "the slider did nothing" — the two look
     * identical from outside otherwise.
     */
    var lastAim = null;
    /**
     * How long a wheel gesture keeps the window interactive and the wheel answering, even if the
     * cursor slips off the painted pixels between notches.
     *
     * A scroll arrives as a burst of notches while the model is turning, and a head sway can uncover
     * a pixel-less spot under the cursor for a frame. Without this the burst is cut short and the
     * user has to find the pet again for every notch. The launcher holds slightly longer than this,
     * so the page's answer and the window's state agree.
     */
    var ZOOM_HOLD_MS = 450;
    var lastZoomAt = -Infinity;
    /** Bumped per notch, so every notch produces a rect report and refreshes the launcher's hold. */
    var zoomSeq = 0;

    /** Is a wheel gesture still in progress, as far as the page is concerned? */
    function zoomHolding() {
      return performance.now() - lastZoomAt < ZOOM_HOLD_MS;
    }

    // ---------------------------------------------------------------------------------------
    // The right-click MENU, and the one place this page's settings are reached from the pet itself.
    //
    // It is DOM rather than canvas, and that has one consequence worth stating: none of its pixels are
    // in the framebuffer, so the per-pixel hit test cannot see it. `hitTest` below answers from the
    // menu's own rectangle as well — and `reportRect` hands that rectangle to the launcher, because
    // the window is only the pet's box and a menu outside it would be clipped. The menu replaced the
    // settings panel this page used to build (operator, 2026-10-11: 「内置桌宠和独立桌宠各自有一套设置，这样
    // 是不对的。删掉两个单独的设置面板。」); every setting it used to offer is on one of the two settings pages.
    // ---------------------------------------------------------------------------------------
    var doc = canvas.ownerDocument || globalThis.document || null;
    var language = options.language
      || ((globalThis.navigator && /^zh/i.test(globalThis.navigator.language || '')) ? 'zh' : 'en');
    installDesktopStyles(doc);
    var menu = null;
    var menuOpen = false;
    /** Where the open menu sits, in FRAME coordinates; null while it is closed. */
    var menuBox = null;

    /**
     * The menu's entries, and what each one DOES in this window.
     *
     * The entries, their order and their words come from the shared `lib/menu.js` — the same eight the pet
     * inside DSH offers, so an entry cannot exist on one surface and not the other. What this page supplies is
     * what each entry does, and the one row that differs: 切换回窗口内, because this pet hands the pet BACK
     * inside the app.
     *
     * Every branch writes through `writePreferences`, the store every other window preference uses, so an edit
     * here reaches this page's own storage, the host store, the app's pet and the settings window.
     */
    function onMenuChoice(id) {
      if (id === 'resetView') {
        preferences.viewYaw = 0;
        preferences.viewPitch = 0;
        writePreferences(store, core, preferences);
        scene.applyPreferences(preferences);
        return;
      }
      if (id === 'resetSize') {
        preferences.windowSize = core.DEFAULTS.windowSize;
        writePreferences(store, core, preferences);
        placement.preferences = preferences;
        placement.setSize(client.BASE_PET_SIZE.width, client.BASE_PET_SIZE.height);
        placement.clampToViewport();
        layout();
        reportRect();
        publish();
        return;
      }
      if (id === 'globalSettings') { openSettingsWindow('global'); return; }
      // 切换模型: the model picker's page, the same one the guide's 偏好模型 step is built from.
      if (id === 'switchModel') { openSettingsWindow('picker'); return; }
      if (id === 'modelSettings') { openSettingsWindow('model'); return; }
      if (id === 'surface') {
        /**
         * 切换回窗口内 —— 这一行本页已经**不再显示**（它与 关闭独立宠物 重复，操作者 2026-10-12 要求移除）。
         *
         * 分支保留，理由和下面 restart/quit 那两个一样：菜单模块是**单独交付**的，页面换新之后浏览器仍可能拿着
         * 旧的 `client.menu.js`，而那个 chunk 里这一行还在。这时它必须照旧工作，而不是掉出函数末尾什么都不做 ——
         * 一个点了没反应的菜单项，比一个不显示的行难查得多。
         *
         * 动作本身没变：宠物回到 DSH 里，而这个窗由 APP 关掉（一个写者；见 `applySurface`/`adoptSurface`）。
         */
        preferences.petSurface = 'app';
        writePreferences(store, core, preferences);
        return;
      }
      /**
       * 重力: this pet's own physics switch, on this surface's own key (`windowGravity`).
       *
       * The app's pet's switch writes `gravity`, so the two are independent by construction — the operator's
       * 「内置宠物和外置宠物的重力开关状态完全独立」. The state is applied through `applyGravity` below, which is
       * also what a host snapshot and a `storage` event go through.
       */
      if (id === 'gravity') {
        preferences.windowGravity = preferences.windowGravity !== true;
        writePreferences(store, core, preferences);
        applyGravity();
        return;
      }
      if (id === 'closePet') {
        /**
         * 关闭独立宠物: the pet goes back INSIDE the app, which is the only thing closing this window can mean.
         *
         * It is the same write as 切换回窗口内 — this window is the pet's box, so a window with no pet in it is
         * nothing at all, and the app is what stops this window (one writer; see the `surface` branch above).
         * The row was 关闭宠物 until 2026-10-12 and used to HIDE the pet as well; the operator split the two
         * meanings then, keeping hiding for the app's pet (隐藏宠物) and this one for handing the pet back.
         */
        preferences.petSurface = 'app';
        writePreferences(store, core, preferences);
        return;
      }
      if (id === 'restartHarness' || id === 'quitHarness') {
        // Gone with the entries themselves (operator, 2026-10-12: 「都去掉关闭和重启dsh的功能和项目」). The
        // branch is kept as a NO-OP rather than deleted so an older delivered `client.menu.js` — a cached chunk
        // is this repository's most repeated failure — cannot walk off the end of this function.
        return;
      }
    }

    /**
     * Push this surface's 重力 (`windowGravity`) into the placement.
     *
     * One place decides, and it reads the key that belongs to THIS surface: the app's pet reads `gravity`. The
     * shipped default here is OFF, which is the behaviour this window has had since 2026-10-10 ("drag and
     * place"), so the switch is what turns throwing and falling ON out here — not what turns them off.
     *
     * Switching it off ends a fall that is already in progress (`endFall`), because "no throwing and no falling"
     * is not "no new throws": a pet frozen in mid-air would be worse than the fall it replaced.
     */
    function applyGravity() {
      var enabled = preferences.windowGravity === true;
      placement.throwEnabled = !enabled ? false : true;
      if (!enabled && typeof placement.endFall === 'function') placement.endFall();
    }

    /**
     * Build the menu from the SHARED definition (`lib/menu.js`).
     *
     * A missing module degrades rather than throws: the chunk is loaded by the page's own `<script>` list, and
     * when it is not there a right-click simply does nothing — which is strictly better than a page that cannot
     * mount its pet at all. The menu is built into the BODY rather than the canvas's parent, because it is
     * `position:fixed` and has to sit above everything else this page draws.
     */
    function buildMenu() {
      var api = globalThis.__VRMPET3D_MENU__;
      if (!api || typeof api.createMenu !== 'function' || !doc) return null;
      api.injectStyle(doc, 'vrmpet3d-menu-style');
      return api.createMenu({
        document: doc,
        container: doc.body,
        language: language,
        toSurface: 'app',
        /**
         * 不显示 切换回窗口内 —— 它与本菜单的 关闭独立宠物 是同一个动作（操作者，2026-10-12：
         * 「外置桌宠的'切换回窗口内'选项现在和'关闭独立宠物'功能重复了，移除'切换回窗口内'选项」）。
         *
         * `toSurface: 'app'` 留着不是装饰：它决定 关闭宠物 那一行说什么话（关闭独立宠物），而那个 id 的动作就是
         * 把宠物交回应用内。行由 `lib/menu.js` 统一决定，这里只说自己有没有它。
         */
        showSurface: false,
        onChoose: onMenuChoice,
        onClose: onMenuClosed,
      });
    }

    /**
     * Put the open menu where `menuBox` says, in the WINDOW's own coordinates.
     *
     * The same conversion the canvas uses: `menuBox` lives in the virtual frame, the menu is `position:fixed`
     * inside a window whose origin this page is planning (`plannedOrigin`), and the difference is the offset.
     * It is called from `layout()` on every frame the menu is up, because the origin moves when the window
     * grows to hold the menu itself — a one-shot placement would put it at the previous origin and read as a
     * menu that jumps the first time it is opened.
     */
    function placeMenu() {
      if (!menu || !menuOpen || !menuBox) return;
      var origin = plannedOrigin();
      menu.place(menuBox.left - origin.x, menuBox.top - origin.y);
    }

    /**
     * Open the menu at a point in FRAME coordinates, clamped into the frame.
     *
     * The frame, not the window: the window is only ever as big as what it must hold, so a menu opened near the
     * pet's edge has to be allowed to extend the window rather than be squeezed into it. That is also why the
     * clamp is against `placement.viewportWidth/Height` — the whole work area — and not against the canvas.
     */
    function openMenuAt(frameX, frameY) {
      if (!menu) return false;
      /**
       * 非debug模式生效, read at OPEN time.
       *
       * 调试模式 (`petSurface: 'both'`) is a settings-page switch and this page keeps running while it is
       * flipped, so a menu that cached the mode would offer a 切换回窗口内 that does nothing. The state can only
       * be honest if it is read when the menu is built.
       */
      menu.setSurfaceAllowed((preferences.petSurface || 'auto') !== 'both');
      /**
       * 重力's check mark, read at the same moment and for the same reason: a host snapshot can change the
       * preference while this window keeps running, so a cached state would show the wrong way the switch is
       * thrown. This page reads ITS key (`windowGravity`); the app's pet reads `gravity`.
       *
       * GUARDED for the same measured reason as the app pet's copy of this line (operator, 2026-10-12:
       * 「内置宠物右键单击无效」): `setChecked` is newer than the delivered menu chunk, a page can keep that chunk in
       * its cache while fetching a newer `desktop-page.js`, and an unguarded call threw inside the page's own
       * right-click handler — a menu that never opened, for a reason visible only in a console.
       */
      if (typeof menu.setChecked === 'function') {
        menu.setChecked('gravity', preferences.windowGravity === true);
      }
      var size = menu.open();
      var width = Math.min(size.width, Math.max(80, placement.viewportWidth - MENU_MARGIN * 2));
      var height = Math.min(size.height, Math.max(80, placement.viewportHeight - MENU_MARGIN * 2));
      menuBox = {
        left: Math.round(clamp(frameX, MENU_MARGIN, Math.max(MENU_MARGIN, placement.viewportWidth - width - MENU_MARGIN))),
        top: Math.round(clamp(frameY, MENU_MARGIN, Math.max(MENU_MARGIN, placement.viewportHeight - height - MENU_MARGIN))),
        width: Math.round(width),
        height: Math.round(height),
      };
      menuOpen = true;
      // `layout` seats the canvas against the window the menu just grew, and places the menu in it; the launcher
      // is told the new rectangle on the same frame, or the window stays pet-sized and clips it.
      layout();
      reportRect();
      publish();
      return true;
    }

    /** Put the menu away, and give the window its pet-sized box back. */
    function closeMenu() {
      if (!menu || !menuOpen) return;
      menu.close();
    }

    /**
     * The menu went away — for ANY reason, and the page has to hear about all of them.
     *
     * This is `createMenu`'s `onClose`, and it exists because a menu closes itself in three ways the page does
     * not initiate: an entry was picked, Escape was pressed, or something outside was clicked. Only the third
     * would otherwise be noticed, because the module owns those keys and this page owns neither.
     *
     * WITHOUT IT the page's own `menuOpen` stayed true after a click on an entry, and `menuOpen` is what the
     * WINDOW is sized from: the launcher would keep the extra room for a menu that was already gone, and
     * `__VRMPET3D_DESKTOP_STATE__.menu.open` would keep reporting a menu nobody could see. Found by the browser
     * probe's 重力 check, which is the first one to CLICK an entry in this window rather than call `closeMenu`.
     */
    function onMenuClosed() {
      if (!menuOpen) return;
      menuOpen = false;
      menuBox = null;
      layout();
      reportRect();
      publish();
    }

    menu = buildMenu();
    /**
     * The model catalog, fetched once — and re-read whenever the store names a model this list cannot answer for
     * (`refreshCatalog`). See the snapshot handler for the import-while-running case that made that necessary.
     */
    var catalog = null;
    /** The queue that keeps model loads serial, and the id the latest request wants. See `loadModelSerialized`. */
    var modelLoadWanted = null;
    var modelLoadChain = Promise.resolve();

    // ---------------------------------------------------------------------------------------
    // The status prompt: 深度求索中 / 我有问题要问你 / 需要你的授权 / 遇到问题了 / 任务达成
    //
    // The floating window has NO session data of its own — no catalog, no statuses, no boundary stream — so
    // it cannot work out what DSH is doing. The in-app pet works it out and publishes it to `/vrmpet3d/state`,
    // and this page draws the same prompt from that one value. See `core.watchHostState`.
    //
    // It is DOM rather than canvas for the same reason the menu is: it is text with a CSS animation (DSH's
    // own blue sweep), and a canvas would mean re-implementing that shimmer in WebGL.
    // ---------------------------------------------------------------------------------------
    var statusNode = null;
    /** The whale, outside the shimmer so the highlight never tints the mark itself. */
    var statusIconNode = null;
    /** DSH's unread-completion dot, in front of the whale: see `renderStatus` and the stylesheet below. */
    var statusDotNode = null;
    /**
     * How many sessions have an unread completion, as the app's pet last reported it.
     *
     * This window has no session store, so the count rides with the state over `/vrmpet3d/state` — and `null` (an older
     * host, or a page that has not reported yet) means "say nothing" rather than "nothing is unread".
     */
    var hostUnread = null;
    /** Both copies of the line — the real one and the masked highlight — which render the same string. */
    var statusTextNodes = [];
    var statusDecorationNode = null;
    /**
     * What the prompt is showing, kept beside `statusKey`.
     *
     * The key is a change detector (`animation + icon + text`), so it is not a place to read the words from —
     * and with DSH's own label the words change once a second as the clock ticks.
     */
    var statusShown = null;
    var statusAnimation = null;
    var statusBox = null;
    /**
     * The 碎碎念 bubble: the element, its frame-space box while it is up, the line the host reported, and what
     * is drawn from it.
     *
     * `statusBox` and `speechBox` are both unioned into the window's bounds by `reportRect`, because both are
     * DOM above the pet's head — the window is only the pet's box otherwise, and a bubble outside it is
     * clipped.
     */
    var speechNode = null;
    var speechBox = null;
    var hostSpeech = null;
    var speechShown = null;
    /**
     * A line THIS page said, because its own pet was touched, and until when.
     *
     * The window has no speech machine — the app owns the clock for the lines it publishes — but a press on the
     * window's pet still has to answer, and the answer must not be overruled by the next state poll. So a local
     * line takes precedence while it lasts, with a timer that hands the bubble back to the app's own line.
     */
    var localSpeech = null;
    var localSpeechTimer = null;
    var lastReactAt = 0;
    /**
     * The window origin `statusBox` was expressed against, kept so the readout can say where the prompt was
     * actually DRAWN: the element's page position is `statusBox - layoutOrigin`.
     *
     * Published because a prompt's rectangle alone cannot be checked: the page computes `statusBox` itself, so
     * comparing the report with the report proves nothing, and that circularity is exactly how a doubled CSS
     * offset (the prompt drawn one full height above the window) stayed invisible to every check for a day.
     */
    var layoutOrigin = { x: 0, y: 0 };
    /** The state the host last reported, and when — `seconds` on a status line is measured from that. */
    var hostState = 'resting';
    var hostStateAt = 0;
    /**
     * Why the host reports NO state, if it said why.
     *
     * `/vrmpet3d/state` carries the in-app pet's own account of a start-up failure, and a channel that stops
     * reporting is the case this window cannot work out for itself: it has no session, so "nothing arrived"
     * looks exactly like "the turn is still running". Kept beside the state so every reader — the readout the
     * launcher relays, the settings pages — says the same thing.
     */
    var hostStateError = null;
    /**
     * Whether the host has aged the report out — "no pet is reporting", as opposed to a state it is drawing.
     *
     * Published so the launcher's readout can tell "the app crashed" from "the app's window was in the background
     * long enough for its frame loop to stop", which look identical from the label alone (operator, 2026-10-11:
     * "完成任务后还在显示深度求索中").
     */
    var hostStateStale = false;
    /**
     * The TURN clock the app reported with that state, `{ startedAt, endedAt }` or null.
     *
     * Relayed rather than derived: this page has no session and no turn frames, so `now - hostStateAt` (its old
     * measure) was the age of the STATE — which reset on every round of a multi-turn task and was not the app's
     * number at all. With the clock it draws what the app draws, and drops the duration when there is no turn.
     */
    var hostStateClock = null;
    /**
     * What the page will REPORT about that clock — the sentinel as the sentinel, an object as two numbers.
     *
     * Published because the two failures this feature has already produced look identical in every other readout: a
     * duration that vanished (a clock read as null) and a clock the window could not read.
     */
    var clockForReport = function () {
      if (hostStateClock === 'state') return 'state';
      return hostStateClock && Number.isFinite(Number(hostStateClock.startedAt))
        ? { startedAt: Number(hostStateClock.startedAt), endedAt: hostStateClock.endedAt || null }
        : null;
    };
    var statusKey = null;
    /**
     * The states this window may draw a MOTION for.
     *
     * `core.MOTION_STATES`, which is the six the 状态 section offers. Read once here rather than per frame:
     * the frame loop asks whether the published state is one of them, and the answer cannot change while the
     * page runs.
     */
    var motionStates = Array.isArray(core.MOTION_STATES) ? core.MOTION_STATES : ['resting'];

    /**
     * Build the prompt once: DSH's own running label.
     *
     * The structure is `RunningStatus`'s, and the inner pair comes from `TextShimmer` — read them in
     * `dsh-client-ui-chat` / `dsh-client-ui-primitives` rather than approximating: the real copy and an inert
     * masked copy of the SAME string, the second one counter-transformed so the band travels while the glyphs
     * stand still. Each copy renders the words through `content:attr(data-shimmer-text)`, so there is one
     * string to keep in step, not two.
     */
    function buildStatus() {
      if (!doc || !doc.body) return;
      statusTextNodes = [];
      /** One copy of the line (the base one, or the one inside the moving mask). */
      function copyOfLine(extraClass) {
        var content = doc.createElement('span');
        content.className = 'vrmpet3d-desktop-status-content' + (extraClass ? ' ' + extraClass : '');
        var text = doc.createElement('span');
        text.className = 'vrmpet3d-desktop-status-text';
        content.appendChild(text);
        statusTextNodes.push(text);
        return content;
      }
      statusNode = doc.createElement('div');
      statusNode.className = 'vrmpet3d-desktop-status';
      statusNode.hidden = true;
      statusDotNode = doc.createElement('span');
      statusDotNode.className = 'vrmpet3d-desktop-status-dot';
      statusDotNode.setAttribute('aria-hidden', 'true');
      statusDotNode.hidden = true;
      statusIconNode = doc.createElement('span');
      statusIconNode.className = 'vrmpet3d-desktop-status-icon';
      statusIconNode.setAttribute('aria-hidden', 'true');
      statusIconNode.hidden = true;
      // DSH's own whale path, from the shared core: one home for the geometry, both surfaces draw it.
      if (typeof core.statusIconMarkup === 'function') statusIconNode.innerHTML = core.statusIconMarkup();
      var shimmer = doc.createElement('span');
      shimmer.className = 'vrmpet3d-desktop-status-shimmer';
      shimmer.appendChild(copyOfLine(''));
      statusDecorationNode = doc.createElement('span');
      statusDecorationNode.className = 'vrmpet3d-desktop-status-decoration';
      statusDecorationNode.setAttribute('aria-hidden', 'true');
      statusDecorationNode.hidden = true;
      var sweep = doc.createElement('span');
      sweep.className = 'vrmpet3d-desktop-status-sweep';
      sweep.appendChild(copyOfLine('vrmpet3d-desktop-status-highlight'));
      statusDecorationNode.appendChild(sweep);
      shimmer.appendChild(statusDecorationNode);
      statusNode.appendChild(statusDotNode);
      statusNode.appendChild(statusIconNode);
      statusNode.appendChild(shimmer);
      doc.body.appendChild(statusNode);
    }

    /**
     * Build the 碎碎念 bubble once.
     *
     * A sibling of the prompt, not a replacement: the prompt is the app's readout of what DSH is doing (and
     * the settings window edits it), while this is the pet's own voice — the two are often up together
     * ("深度求索中" while the pet says "我盯着呢"). The text arrives from the app's pet over `/vrmpet3d/state`,
     * because this page has no session of its own to react to.
     */
    function buildSpeech() {
      if (!doc || !doc.body) return;
      speechNode = doc.createElement('div');
      speechNode.className = 'vrmpet3d-desktop-speech';
      speechNode.hidden = true;
      doc.body.appendChild(speechNode);
    }

    /**
     * Put the bubble's bottom centre above the prompt, and remember its box.
     *
     * Mirrors `layoutStatus`: the same projected head point, the same clamping to the frame, and the prompt's
     * measured height as the offset so the two never overlap. The box is what `reportRect` unions into the
     * window's bounds — the bubble is DOM, so the window has to grow to hold it or it is clipped.
     */
    function layoutSpeech() {
      if (!speechNode || !speechBox || !scene) return;
      /**
       * The bubble's size comes from `core.speechPromptFontPx`, exactly as the in-app pet's does.
       *
       * It used to be `statusPromptFontPx(...) * 0.95` written out HERE and again in `lib/client.js` — two copies of
       * one ratio, which is the drift this project keeps paying for. The rule lives in the core now (the fixed 18 px
       * default the operator set, the box's own factor, and the same per-model correction the wheel moves), and this
       * page only decides WHERE the bubble goes.
       */
      if (typeof core.speechPromptFontPx === 'function') {
        var scale = typeof core.statusScaleFor === 'function'
          ? core.statusScaleFor(preferences, resolvedModelId(preferences.modelId || options.modelId))
          : 1;
        speechNode.style.setProperty('--vrmpet3d-desktop-speech-font', core.speechPromptFontPx(scale) + 'px');
      }
      /**
       * The width it wraps at: never narrower than the SHARED floor (operator, 2026-10-14: 「内置桌宠的碎碎念换行规则设置成和
       * 外置一样，以外置为准」). This surface's own box is the roomier one, so the floor changes nothing at his sizes — it is
       * here so that both surfaces read ONE rule (`core.SPEECH_LIMITS.wrapPx`) instead of two that happen to agree today,
       * which is exactly how the app half came to wrap a remark into three or four lines while this one used two.
       */
      var wrapPx = core.SPEECH_LIMITS && core.SPEECH_LIMITS.wrapPx ? core.SPEECH_LIMITS.wrapPx : 220;
      speechNode.style.setProperty('--vrmpet3d-desktop-speech-width', wrapPx + 'px');
      var box = canvasBox();
      var modelHeight = Number(scene.modelHeight) > 0 ? Number(scene.modelHeight) : 1;
      var top = null;
      if (scene.THREE && typeof scene.projectToCanvas === 'function') {
        top = scene.projectToCanvas(new scene.THREE.Vector3(0, modelHeight, 0));
      }
      var centreX = top ? box.left + top.x : box.left + box.width / 2;
      var width = speechNode.offsetWidth || 0;
      var height = speechNode.offsetHeight || 0;
      var promptHeight = statusBox && statusBox.width > 0 ? statusBox.height : 0;
      var origin = plannedOrigin();
      layoutOrigin = { x: origin.x, y: origin.y };
      /**
       * Clamped into the RESERVED BAND rather than into the frame.
       *
       * The band is what the window reports for the bubble (see `speechBand`), so a bubble centred on a head near the
       * frame's edge would otherwise hang outside the window and be clipped. Keeping it inside the band is the same
       * rule the in-app pet already follows by clamping into the pet's box.
       */
      var band = speechBand();
      var left = clamp(centreX - width / 2, band.left, Math.max(band.left, band.left + band.width - width));
      var topY = clamp(
        (top ? box.top + top.y : box.top) - promptHeight - height - 8,
        2,
        Math.max(2, placement.viewportHeight - height - 2)
      );
      speechBox = { left: Math.round(left), top: Math.round(topY), width: Math.round(width), height: Math.round(height) };
      speechNode.style.left = Math.round(left - origin.x) + 'px';
      speechNode.style.top = Math.round(topY - origin.y) + 'px';
    }

    /**
     * Draw (or clear) the bubble from the line the host last reported.
     *
     * No timer here: the app's pet decides when a line ENDS (it publishes the clear), so this page only has to
     * draw what it is told. That keeps one clock for the whole feature instead of two that can disagree.
     */
    function renderSpeech() {
      if (!speechNode) return;
      // A line THIS page said takes precedence while it lasts: the pet was touched here, and the next state poll
      // must not wipe the answer before it has been read.
      var localUp = localSpeech && Date.now() < localSpeech.until ? localSpeech : null;
      var line = localUp ? localUp.text : hostSpeech;
      if (!line) {
        speechShown = null;
        speechNode.hidden = true;
        speechNode.textContent = '';
        speechBox = null;
        return;
      }
      if (line !== speechShown) {
        speechShown = line;
        speechNode.textContent = line;
        speechNode.hidden = false;
        // A line that just appeared has no measured box yet: laying it out on this same frame keeps the
        // window from lagging a frame behind the text.
        speechBox = { left: 0, top: 0, width: 0, height: 0 };
      }
      layoutSpeech();
    }

    /**
     * The state box a press reaction borrows from, when the part itself has nothing to say.
     *
     * The pending KIND is deliberately null: 等待确认 is the app's own session fact and this window is never told
     * it (it has no session to read), so the window maps the state it was given and nothing more.
     */
    function stateEventName() {
      return (core.speechEvent && core.speechEvent(hostState, null)) || 'idle';
    }

    /** Put a line up for `holdSeconds`, then hand the bubble back to whatever the app is publishing. */
    function showLocalSpeech(text, holdSeconds) {
      var hold = Number.isFinite(Number(holdSeconds)) ? Math.max(1, Number(holdSeconds)) : 4;
      localSpeech = { text: text, until: Date.now() + hold * 1000 };
      if (localSpeechTimer) clearTimeout(localSpeechTimer);
      localSpeechTimer = setTimeout(function () {
        localSpeechTimer = null;
        localSpeech = null;
        renderSpeech();
        layout();
        reportRect();
      }, hold * 1000 + 30);
      renderSpeech();
      // The bubble is DOM above the pet's head: the window has to grow to hold it, exactly as for a host line.
      layout();
      reportRect();
    }

    /**
     * Ask the host for a line about this part.
     *
     * The answer is guarded by a request id: a newer press must not have this one drawn over it, and a slow model
     * answering after the next click is answering an older question. `part` selects that part's prompt on the host
     * side, and `structure`/`chain` say WHAT was touched — the chain first in the host's instruction, because a
     * spring chain's name (`LiuHai`, `TwinTail.A.002.L`) is the one that means something.
     */
    var partRequestId = 0;
    function askPartLine(item, structure, chain, holdSeconds) {
      partRequestId += 1;
      var id = partRequestId;
      fetch('/vrmpet3d/say', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          state: hostState || null,
          event: stateEventName(),
          language: preferences.language === 'en' ? 'en' : 'zh',
          part: item.id,
          structure: structure || null,
          chain: chain || null,
        }),
      }).then(function (response) {
        return response.ok ? response.json() : null;
      }).then(function (body) {
        if (id !== partRequestId) return;
        var text = body && typeof body.text === 'string' ? core.cleanSpeechText(body.text, 80) : '';
        if (!text) return;
        showLocalSpeech(text, holdSeconds);
      }).catch(function () { /* a failed request leaves the local line, or silence, standing */ });
    }

    /**
     * Say something about the PART that was touched, on this page's own account.
     *
     * The chain is the app's: the part's own lines (or the SHIPPED lines for its region, while 台词来源 is
     * 内置短语), then the user's own lines for the current state, then silence — the SHIPPED state table is
     * deliberately not in it, because answering a touched ear with 开始干活了 is a non-sequitur. In AI mode the model
     * is ALWAYS asked (2026-10-11): the request names the part AND the structure the raycast found, so a part with no
     * prompt of its own is still answered about what was touched.
     *
     * `PRESS_LIMITS.reactGapSeconds` is re-applied here rather than inherited from the app: this page's pet can be
     * clicked while the app's pet is somewhere else entirely, so the two clocks are genuinely two.
     */
    function reactToPart(part, reason) {
      if (reason !== 'click' && reason !== 'hold') return null;
      var item = part && part.part ? part.part : null;
      if (!item) return null;
      var speech = core.cleanSpeech(preferences.speech);
      if (!speech.enabled) return null;
      var now = Date.now();
      var gap = (core.PRESS_LIMITS ? core.PRESS_LIMITS.reactGapSeconds : 3) * 1000;
      if (lastReactAt && now - lastReactAt < gap) return null;
      /**
       * The part's own box, else the shipped pool for its region — THE SAME function the app's machine uses, and now
       * with the SAME arguments too: the shipped pool is ALWAYS in the chain (operator, 2026-10-14: 「把所有的碎碎念都设置
       * 降级连，AI > 自定义（非空时）> 内置」, and then 「从内置切换到外置后，点击身体的碎碎念会失效」).
       *
       * It used to hand over `speech.source === 'builtin'`, i.e. the old 2026-10-11 rule that switched the shipped pools
       * off for the AI and 自定义 sources. On the app half that rule was replaced, and this copy stayed behind — so with
       * 台词来源 on AI (his own setting) a press on a part with an empty box had NOTHING local to say and depended entirely
       * on the model answering: when the provider was busy, the press went silent. That is the asymmetry this file keeps
       * warning about, caught live this time. `true` is the same argument `core.SpeechMachine.react` passes.
       */
      var own = typeof core.partSpeechLines === 'function'
        ? core.partSpeechLines(item, true, language, reason)
        : (item.speech && Array.isArray(item.speech.lines) ? item.speech.lines : []);
      var structure = (part && (part.bone || part.mesh)) || null;
      // The chain name, by the SAME rule the app's machine uses (`core.chainNameOf`): declared name, else the root
      // joint, else the storage key. This page has no state machine, so it picks the name itself.
      var chain = part && part.chain && typeof core.chainNameOf === 'function' ? core.chainNameOf(part.chain) : null;
      var wantsAi = speech.source === 'ai';
      var pool = own.length ? own : core.customSpeechLines(speech, stateEventName());
      var text = core.pickLine(pool, Math.random, speechShown || null);
      if (!text && !wantsAi) return null;
      lastReactAt = now;
      if (text) showLocalSpeech(text, speech.holdSeconds);
      if (wantsAi) askPartLine(item, structure, chain, speech.holdSeconds);
      return text;
    }

    /**
     * Apply ONE observation from the host's state channel.
     *
     * `state` may be NULL, and that case is load-bearing rather than defensive: it means NO PET IS REPORTING —
     * the in-app half crashed before it could publish, or the page that owns the machine is gone. The early
     * return this used to have (`if (typeof state !== 'string' || !state) return`) left the last state on
     * screen for ever: measured live on 2026-10-11, the window drew 工作中 with the clock counting up for
     * seventeen minutes while `/vrmpet3d/state` carried `state: null` and a TypeError from the app's pet. This
     * page has no session of its own, so "nothing arrived" can only be drawn as nothing.
     *
     * `error` is the client half's own account of such a failure; it is published so the launcher's readout
     * names the cause instead of leaving a frozen label to be interpreted.
     */
    function applyHostState(state, at, line, error, stale, clock) {
      var known = typeof state === 'string' && Array.isArray(core.STATES) && core.STATES.indexOf(state) !== -1;
      hostState = known ? state : null;
      hostStateAt = Number(at) > 0 ? Number(at) : Date.now();
      hostSpeech = typeof line === 'string' && line ? line : null;
      hostStateError = typeof error === 'string' && error ? error : null;
      hostStateClock = clock === 'state'
        // The sentinel from a deployment with no turn frames: the duration is measured on this page's own state age.
        ? 'state'
        : (clock && Number(clock.startedAt) > 0
          ? { startedAt: Number(clock.startedAt), endedAt: Number(clock.endedAt) > 0 ? Number(clock.endedAt) : null }
          : null);
      /**
       * And whether the host has STOPPED BELIEVING the report it is relaying.
       *
       * The host ages a report out (see `core.hostStateView`), and when it does it sends `state: null` — so the
       * label and the bubble clear through the same path a pet that never reported takes. This flag is kept only so
       * the launcher's readout can say WHY the pet went quiet, which is the difference between "the app crashed" and
       * "the window was in the background long enough for its frame loop to stop".
       */
      hostStateStale = stale === true;
      // A state change is a new entry, so a prompt with its own duration starts counting again.
      statusKey = null;
      renderStatus();
      renderSpeech();
      layout();
      reportRect();
      publish();
    }

    /**
     * Put the prompt's bottom centre on the model's projected top edge, and remember the box.
     *
     * `projectToCanvas` answers in CANVAS pixels and the canvas's drawing buffer is its CSS size times the
     * device pixel ratio, so the ratio converts one to the other.
     */
    function layoutStatus() {
      if (!statusNode || !statusBox || !scene) return;
      /**
       * The label's size, from the model's own correction and NOT from the box — before anything is measured below,
       * because the font size is what decides the measured width and height.
       *
       * A fixed default it is (operator, 2026-10-13: 「状态文字默认大小设置为18px」 … 「放大缩小的倍数和盒子大小解耦连…避免缩放
       * 模型的时候缩放文字」), which reverses the older complaint this comment used to carry. `core.statusPromptFontPx` owns
       * the arithmetic, and the in-app pet draws the same size for the same model.
       */
      if (typeof core.statusPromptFontPx === 'function') {
        var statusScale = typeof core.statusScaleFor === 'function'
          ? core.statusScaleFor(preferences, resolvedModelId(preferences.modelId || options.modelId))
          : 1;
        statusNode.style.setProperty(
          '--vrmpet3d-desktop-status-font',
          core.statusPromptFontPx(statusScale) + 'px'
        );
      }
      var box = canvasBox();
      var modelHeight = Number(scene.modelHeight) > 0 ? Number(scene.modelHeight) : 1;
      var top = null;
      if (scene.THREE && typeof scene.projectToCanvas === 'function') {
        top = scene.projectToCanvas(new scene.THREE.Vector3(0, modelHeight, 0));
      }
      /**
       * No unit conversion here, and that is the fix for "文字还是没和模型居中" (2026-10-09).
       *
       * `projectToCanvas` answers in the SCENE's pixels, which are CSS pixels — `layout` calls
       * `scene.resize` with the canvas's CSS size — and NOT the drawing buffer's, which is that times
       * `devicePixelRatio` (`renderer.setPixelRatio`). Multiplying by `box.width / canvas.width` divided by
       * the device pixel ratio a SECOND time, so on a 1.5x display the label was drawn at two thirds of the
       * distance from the canvas's top-left corner: measured live, its centre sat 89 px left of the pet's in a
       * 396 px box, exactly `(1 - 1/1.5)` of the way there.
       */
      var centreX = top ? box.left + top.x : box.left + box.width / 2;
      /**
       * Measured, not assumed: a prompt wraps, so its height and width depend on the text. `offsetWidth`
       * is a layout read, which is one read per frame while a prompt is up — the cheapest correct way to
       * keep a three-line line inside the window instead of clipped by it.
       */
      var width = statusNode.offsetWidth || 0;
      var boxHeight = statusNode.offsetHeight || 0;
      var origin = plannedOrigin();
      layoutOrigin = { x: origin.x, y: origin.y };
      // The window is the pet's box unioned with this prompt's, so the prompt may hang outside the canvas;
      // only the frame's own edges clamp it.
      //
      // `left`/`topY` are the element's FINAL top-left in frame coordinates — the stylesheet must not move it
      // again (see the note on `.vrmpet3d-desktop-status`). `plannedOrigin` below reads this back to grow the
      // window upward, so a report that does not describe the drawn box is a prompt outside its own window.
      var left = clamp(centreX - width / 2, 2, Math.max(2, placement.viewportWidth - width - 2));
      var topY = clamp(
        (top ? box.top + top.y : box.top) - boxHeight - 4,
        2,
        Math.max(2, placement.viewportHeight - boxHeight - 2)
      );
      statusBox = {
        left: Math.round(left),
        top: Math.round(topY),
        width: Math.round(width),
        height: Math.round(boxHeight),
      };
      statusNode.style.left = Math.round(left - origin.x) + 'px';
      statusNode.style.top = Math.round(topY - origin.y) + 'px';
    }

    /** Draw (or clear) the prompt from the state the host last reported. */
    function renderStatus() {
      if (!statusNode) return;
      // The TURN clock the app sent with the state, not this page's own age for it: 用时 is a claim about DSH's turn,
      // and with no turn to report the token is dropped (DSH's own token-free 「深度求索中」). See `PetMachine.statusClock`.
      var line = core.statusFor(preferences, hostState, hostStateAt, Date.now(), hostStateClock);
      if (!line) {
        statusKey = null;
        statusShown = null;
        statusAnimation = null;
        statusNode.hidden = true;
        if (statusDecorationNode) statusDecorationNode.hidden = true;
        statusBox = null;
        return;
      }
      var shown = line.text + line.tag;
      /**
       * The key carries the icon and the whole line. With DSH's own label the line changes once a second —
       * 「用时 14分46秒」 — so the clock ticks by re-keying, exactly as the app's own label counts.
       */
      var key = line.animation + '\u0000' + (line.icon ? '1' : '0') + '\u0000'
        + (line.state === 'working' && Number(hostUnread) > 0 ? 'dot' : '') + '\u0000' + shown;
      /**
       * The tone — 任务达成 gold and bold, 任务失败/出错 red — written every frame rather than on a re-key.
       *
       * `line.tone` is decided in `core.statusFor`, so this window and the pet inside DSH cannot disagree
       * about which state is gold; only the shades below are the window's own, because it draws on a
       * transparent desktop instead of DSH's theme tokens.
       */
      if (line.tone) statusNode.setAttribute('data-tone', line.tone);
      else statusNode.removeAttribute('data-tone');
      if (line.bold) statusNode.setAttribute('data-bold', '1');
      else statusNode.removeAttribute('data-bold');
      if (key !== statusKey) {
        statusKey = key;
        statusShown = shown;
        statusAnimation = line.animation;
        statusNode.hidden = false;
        // Both copies from ONE string: each renders it with `content:attr(data-shimmer-text)`.
        for (var i = 0; i < statusTextNodes.length; i += 1) {
          statusTextNodes[i].setAttribute('data-shimmer-text', shown);
        }
        // The mask travels only for an animated line; `prefers-reduced-motion` hides it in CSS as well.
        if (statusDecorationNode) statusDecorationNode.hidden = line.animation !== 'shimmer';
        // The whale belongs to the states that wear it — 工作中, where DSH shows it.
        if (statusIconNode) statusIconNode.hidden = line.icon !== true;
        // And the green dot, when another session's completion is still unread (DSH's own marker for it).
        if (statusDotNode) {
          statusDotNode.hidden = !(line.state === 'working' && Number(hostUnread) > 0);
        }
        // A line that just appeared has no measured box yet: laying it out on this same frame keeps the
        // window from lagging a frame behind the text.
        statusBox = { left: 0, top: 0, width: 0, height: 0 };
      }
      layoutStatus();
    }

    /** Is this point over the open menu? The menu is DOM, so the per-pixel read cannot see it. */
    function isOverMenu(clientX, clientY) {
      if (!menuOpen || !menuBox) return false;
      var x = clientX - screenBox.x;
      var y = clientY - screenBox.y;
      return x >= menuBox.left && x < menuBox.left + menuBox.width
        && y >= menuBox.top && y < menuBox.top + menuBox.height;
    }

    /** Is this FRAME-space point inside a box? The one place the containment rule lives. */
    function insideBox(box, x, y) {
      return Boolean(box) && Number.isFinite(x) && Number.isFinite(y)
        && x >= box.left && x < box.left + box.width
        && y >= box.top && y < box.top + box.height;
    }

    /**
     * Is this point over the status prompt?
     *
     * The prompt is DOM like the menu, so nothing of it is painted and the per-pixel hit test cannot see it.
     * It has to be declared interactive for the wheel-over-the-text gesture to exist at all: the launcher only
     * delivers a wheel event to the window where `hitTest` says the window wants the mouse. Same coordinate
     * convention as `isOverMenu` — both rectangles are in frame coordinates.
     */
    function isOverStatus(clientX, clientY) {
      if (!statusBox || statusBox.width <= 0) return false;
      return insideBox(statusBox, clientX - screenBox.x, clientY - screenBox.y);
    }

    /**
     * Is this point over the 碎碎念 bubble?
     *
     * The same declaration as `isOverStatus`, for the same reason: the bubble is DOM, so nothing of it is painted,
     * and the launcher only delivers a wheel event where `hitTest` says the window wants the mouse. Without this the
     * bubble's own wheel gesture could not exist in the floating window at all — the notch would fall through to
     * whatever is behind it (operator, 2026-10-13: 「给碎碎念也加上同样的鼠标滚轮放大功能」).
     */
    function isOverSpeech(clientX, clientY) {
      if (!speechBox || speechBox.width <= 0) return false;
      return insideBox(speechBox, clientX - screenBox.x, clientY - screenBox.y);
    }

    /**
     * The launcher's question: should the window receive the mouse at this point?
     *
     * The pet's painted pixels, the MENU's rectangle, or either TEXT's — the prompt's and the bubble's, both of which
     * exist only as DOM. Nothing else: the rest of the screen belongs to whatever is behind the window.
     */
    function hitTest(clientX, clientY) {
      if (isOverMenu(clientX, clientY)) return true;
      if (isOverStatus(clientX, clientY)) return true;
      if (isOverSpeech(clientX, clientY)) return true;
      return paintedAt(clientX, clientY);
    }

    function loadCatalog() {
      if (catalog) return Promise.resolve(catalog);
      return refreshCatalog();
    }

    /**
     * Read the catalog AGAIN, whatever we hold.
     *
     * The memoised read above is right for a boot and wrong after an import: a model the host has just taken in
     * has an id this page has never seen, and only a fresh list can resolve it (see the snapshot handler). A
     * failure leaves an EMPTY list on purpose — `resolveModelId` honours the requested id against an empty list,
     * so the load is still attempted and the asset route has the last word.
     */
    function refreshCatalog() {
      if (typeof fetch !== 'function') return Promise.resolve([]);
      return fetch('/vrmpet3d/catalog', { credentials: 'omit' })
        .then(function (response) {
          if (!response.ok) throw new Error('catalog route returned HTTP ' + response.status);
          return response.json();
        })
        .then(function (body) {
          catalog = body && Array.isArray(body.models) ? body.models : [];
          return catalog;
        })
        .catch(function () {
          // A missing catalog is a reason for an empty list, not a reason to break the pet or to offer a
          // built-in avatar — that avatar was removed on 2026-10-10. The list is what tells a STALE stored model
          // id from a live one (`resolvedModelId`).
          catalog = [];
          return catalog;
        });
    }

    /** The id this page should be showing: the stored one if it is still catalogued, else the resolver's. */
    function resolvedModelId(wanted) {
      var models = Array.isArray(catalog) ? catalog : [];
      // The empty-catalog case is handled by core.resolveModelId itself, so both surfaces share one rule: an
      // empty list means "not known yet" and the requested id is honoured.
      if (core.resolveModelId) return core.resolveModelId(models, wanted);
      return wanted || '';
    }

    /**
     * Tell the store which model this WINDOW has on screen.
     *
     * The window never used to report it at all: `live.window` was stamped by the HOST from the launcher's
     * `--model-id`, which is the model the window was STARTED with and therefore stale from the first switch. The
     * model picker ends its progress bar on this value (「明明模型已经切换好了，为什么还走了这么长时间的进度条」), so a stale
     * one meant the bar waited for the full timeout however fast the model appeared. The page is the only thing
     * that knows what the renderer actually loaded, so the page is what says so — on mount and on every load.
     */
    function reportLoadedModel(modelId) {
      if (hostLink && typeof hostLink.reportLive === 'function') hostLink.reportLive(modelId || null, 'window');
    }

    /**
     * ONE model load at a time, and a load the next snapshot has already replaced is DROPPED.
     *
     * The twin of `loadModel`'s queue in `lib/client.js`, and it exists for the same operator request
     * (「增加一个切换进度条，防止用户快速反复切换导致故障」): 切换模型 writes the store on every click, this page polls
     * that store, and two `scene.loadModel` calls in flight at once is one VRM parse racing another on the same
     * skeleton. Queueing them and skipping the superseded ones is what makes a fast A → B → A end on A with two
     * parses rather than three.
     */
    function loadModelSerialized(modelId) {
      modelLoadWanted = modelId;
      var run = function () {
        if (modelLoadWanted !== modelId) return Promise.resolve(null);
        return scene.loadModel(modelId).then(function (status) {
          reportLoadedModel(status && status.ok ? modelId : null);
          return status;
        });
      };
      var chained = modelLoadChain.then(run, run);
      modelLoadChain = chained.then(function () {}, function () {});
      return chained;
    }

    /** Switch the pet's model, and remember the choice like any other preference. */
    function chooseModel(modelId) {
      preferences.modelId = modelId;
      writePreferences(store, core, preferences);
      return scene.loadModel(modelId).then(function (status) {
        // Framing depends on the avatar, exactly as it does at mount.
        layout();
        scene.applyPreferences(preferences);
        publish();
        return status;
      });
    }

    /**
     * Ask the host to open one of the settings pages.
     *
     * This window is screen-sized, frameless, transparent and not focusable, so it is the worst possible
     * thing to open a form in. The host starts a real window instead; if it cannot (no Electron, or an
     * older host), the same page opens as a browser tab, which reads everything it needs over HTTP — and the
     * tab is the SAME route the host would have opened (`/vrmpet3d/global`, `/vrmpet3d/config` or, since
     * 2026-10-13, `/vrmpet3d/picker` for 切换模型), so the fallback lands on the same page rather than on a
     * query parameter this build no longer reads.
     */
    function openSettingsWindow(page) {
      var which = page === 'global' ? 'settings' : (page === 'picker' ? 'picker' : 'config');
      var url = which === 'settings'
        ? '/vrmpet3d/global'
        : (which === 'picker'
          ? '/vrmpet3d/picker'
          : '/vrmpet3d/config?model=' + encodeURIComponent(resolvedModelId(preferences.modelId || loadedModel) || ''));
      var fallback = function () {
        try { globalThis.open(url, '_blank'); } catch (_error) { /* a blocked popup is not fatal */ }
      };
      try {
        fetch('/vrmpet3d/desktop', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'omit',
          // Same reason as the app's pet: name the model that is on screen, so the window opens on it.
          body: JSON.stringify({ action: which, modelId: resolvedModelId(preferences.modelId || loadedModel) }),
        }).then(function (response) { if (!response.ok) fallback(); })
          .catch(fallback);
      } catch (_error) {
        fallback();
      }
    }
    /**
     * The pet's box in frame coordinates, WITH its size.
     *
     * `Placement.pixels()` returns the top-left only (every earlier caller paired it with
     * `placement.width`), and the motion margin below needs the whole rectangle — so this is where the box
     * gets its size, once, instead of at each call site.
     */
    function boxPixels() {
      var at = placement.pixels();
      return { left: at.left, top: at.top, width: placement.width, height: placement.height };
    }

    /**
     * How much bigger the canvas — and therefore the window — is than the pet's slot.
     *
     * A pose can reach well past the box the model is framed in — a wave puts a hand outside it — and since
     * the window's rectangle IS that box, the hand was drawn into the window's edge and cut off. The canvas
     * is that box times this factor and the camera pulls back by the same factor (`setFrameMargin`), so the
     * pet keeps its size in pixels and simply has room around it.
     *
     * MEASURED rather than guessed: on the generated wave (`make-vrma-fixtures.mjs`) the raised hand reaches
     * 1.17x the slot's half width from the centre — so the pose genuinely does NOT fit the slot, which is the
     * report this answers — and 1.35 leaves room for a clip that reaches further. The browser probe asserts
     * both directions (the pose exceeds the slot, and it fits inside this margin), so a change that makes
     * either false fails a check instead of quietly cropping an arm.
     *
     * ALWAYS ON since 2026-10-09, at the operator's request: "把独立宠物窗口大一些，有时候宠物把手举起来会超出
     * 框架，多出来的部分正好可以显示文字". It used to apply only while a clip was PLAYING, so a pose that
     * outlived its clip — or one only the idle wrote — was cropped again the moment the scheduler moved on,
     * which is why the clipping read as "sometimes". The band above the head that the window gains is also
     * where the 状态 prompt lives, so this one number answers both halves of that request.
     */
    var MOTION_FRAME_MARGIN = 1.35;

    /** The pet's box expanded by the frame margin: what the CANVAS is, and therefore what the window is. */
    function canvasBox() {
      var box = boxPixels();
      var growX = (box.width * (MOTION_FRAME_MARGIN - 1)) / 2;
      var growY = (box.height * (MOTION_FRAME_MARGIN - 1)) / 2;
      return {
        left: box.left - growX,
        top: box.top - growY,
        width: box.width * MOTION_FRAME_MARGIN,
        height: box.height * MOTION_FRAME_MARGIN,
      };
    }

    /**
     * Put the canvas where the pet is, and keep the drawing buffer the size of its box.
     *
     * The canvas ATTRIBUTES are deliberately left to the renderer. Setting them here as well looks
     * harmless and is not: `scene.resize` sets them to `box * devicePixelRatio` (220 becomes 330 at
     * 1.5), so a guard comparing them against the CSS size is true on every single frame and each
     * frame ends by resizing the drawing buffer — after the render, wiping the picture before the
     * window composites it and before the hit test reads it. The frame the user sees is then
     * always empty. The guard is therefore against the SCENE's own record, in CSS pixels, and the
     * buffer size is the renderer's business.
     */
    /**
     * Where the WINDOW will be, in the virtual frame: the pet's box, unioned with the MENU while it is open.
     *
     * The launcher puts the window exactly here — it follows the rectangle this page reports — so this
     * is what the canvas and the menu are laid out against, rather than `windowOrigin`, which is the
     * window as it was up to one cursor tick ago. Using the stale origin made a wheel notch draw the pet
     * at an offset inside a window that had not resized yet, and the correction a tick later read as a
     * jump. The page is the one that decides where the window goes, so the page can lay out for it.
     */
    function plannedOrigin() {
      var pixels = canvasBox();
      var x = pixels.left;
      var y = pixels.top;
      if (menuOpen && menuBox) {
        x = Math.min(x, menuBox.left);
        y = Math.min(y, menuBox.top);
      }
      /**
       * And the status prompt, which is the whole reason this function exists rather than a constant: the
       * prompt sits ABOVE the model, so the window has to grow upward to hold it or the launcher would clip
       * it. It is measured into `statusBox` on the previous frame, so a prompt that just appeared is
       * positioned for a window one frame stale — which the next frame corrects, and the launcher's own
       * guard against sub-pixel `setBounds` churn absorbs.
       */
      if (statusBox && statusBox.width > 0) {
        x = Math.min(x, statusBox.left);
        y = Math.min(y, statusBox.top);
      }
      /**
       * AND THE 碎碎念 BAND — because it is REPORTED, and this function's one job is to predict the window the launcher
       * will make from what this page reports.
       *
       * It was missing, and the operator's report is what that costs (2026-10-13: 「独立桌宠会莫名奇妙鼠标穿透，右键点击后菜单
       * 点击没反应」): the launcher unions `petRect ∪ menuRect ∪ statusRect ∪ speechRect`, so its window began a full band
       * ABOVE the origin this page assumed for `canvas.style.top/left`, `placeMenu` and the per-pixel hit test
       * (`paintedAt`, `isOverMenu`, `isOverStatus`). Everything was therefore PAINTED about a band higher than the page
       * believed, the launcher was told "transparent pixel" over its own visible pet and called
       * `setIgnoreMouseEvents(true)` — clicks fell through the pet, and the menu's rows were not where its hit test said
       * they were. It looked intermittent because a 状态 prompt IS in this union, so a prompt up cancelled most of the
       * offset; since the band is reported unconditionally (see `speechBand`) it would have become permanent.
       */
      var band = speechBand();
      x = Math.min(x, band.left);
      y = Math.min(y, band.top);
      return { x: x, y: y };
    }

    function layout() {
      var pixels = canvasBox();
      var origin = plannedOrigin();
      // The camera pulls back by exactly the frame margin, so the pet's size in PIXELS is the same as it
      // would be in a window sized to its slot — the window is simply bigger around it, which is what leaves
      // room for a raised hand and a band above the head for the 状态 prompt.
      scene.setFrameMargin(MOTION_FRAME_MARGIN);
      canvas.style.left = (pixels.left - origin.x) + 'px';
      canvas.style.top = (pixels.top - origin.y) + 'px';
      canvas.style.width = pixels.width + 'px';
      canvas.style.height = pixels.height + 'px';
      if (scene.width !== pixels.width || scene.height !== pixels.height) {
        scene.resize(pixels.width, pixels.height);
      }
      // The menu follows the window's origin, which is what makes it stay put while the window is resized to
      // hold it — see `placeMenu`.
      if (menuOpen) placeMenu();
      // ...and so is the prompt, which additionally has to be measured before `plannedOrigin` can account
      // for it — hence the second pass: one layout with the previous box, one with the fresh one. The
      // 碎碎念 bubble goes LAST because its position depends on the prompt's measured height.
      if (statusBox) {
        layoutStatus();
        var corrected = plannedOrigin();
        if (corrected.x !== origin.x || corrected.y !== origin.y) {
          canvas.style.left = (pixels.left - corrected.x) + 'px';
          canvas.style.top = (pixels.top - corrected.y) + 'px';
        }
      }
      if (speechBox) layoutSpeech();
    }

    /**
     * Did we actually paint the pixel under the cursor?
     *
     * This is the whole of the click-through policy: the launcher makes the window interactive only
     * while this is true, so a gap between hair strands passes the click to whatever is behind it
     * while the hair itself takes the click and the wheel. Reading the framebuffer is what makes it
     * exact ?a rectangle would swallow the gaps, and a raycast would call a see-through pixel
     * solid.
     *
     * @param {number} clientX cursor in SCREEN coordinates (the launcher's own)
     */
    function paintedAt(clientX, clientY) {
      var pixels = canvasBox();
      // SCREEN coordinates in, canvas-local out: the cursor comes from the launcher's own
      // `getCursorScreenPoint()`, and the placement lives in the virtual work-area frame. The window's
      // origin is deliberately NOT part of this — the two cancel, which is why the window can move
      // without this arithmetic changing.
      var localX = clientX - screenBox.x - pixels.left;
      var localY = clientY - screenBox.y - pixels.top;
      if (localX < 0 || localY < 0 || localX >= pixels.width || localY >= pixels.height) return false;
      if (!gl) return true;
      // The framebuffer is in device pixels with a bottom-left origin; the cursor arrives in CSS
      // pixels from the top-left.
      var scaleX = canvas.width / Math.max(1, pixels.width);
      var scaleY = canvas.height / Math.max(1, pixels.height);
      var x = Math.min(canvas.width - 1, Math.max(0, Math.round(localX * scaleX)));
      var y = Math.min(canvas.height - 1, Math.max(0, canvas.height - 1 - Math.round(localY * scaleY)));
      try {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        hitReads += 1;
        // Kept for the diagnostic path: "the pet takes no clicks" is otherwise indistinguishable
        // from "the readback returned a transparent pixel", and those need different fixes.
        lastHit = { local: [localX, localY], device: [x, y], rgba: [pixel[0], pixel[1], pixel[2], pixel[3]] };
        return pixel[3] > PAINTED_ALPHA;
      } catch (error) {
        // A context that cannot be read leaves the pet clickable rather than unreachable: an
        // unreachable pet cannot even be dragged out of the way.
        lastError = String((error && error.message) || error);
        return true;
      }
    }

    /**
     * How many pixels of the canvas are actually painted.
     *
     * A diagnostic, and a deliberate one: "the pet takes no clicks" has two very different causes
     * ?nothing was drawn at all, or the readback disagrees with what is on screen ?and they
     * cannot be told apart from outside the page. This reads the whole framebuffer, once.
     */
    function scan() {
      if (!gl) return null;
      try {
        var width = canvas.width;
        var height = canvas.height;
        var all = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, all);
        var painted = 0;
        for (var i = 3; i < all.length; i += 4) {
          if (all[i] > PAINTED_ALPHA) painted += 1;
        }
        // The scene's own account, because "nothing is painted" has several causes that look
        // identical from outside: no avatar, an avatar outside the frustum, or a camera looking at
        // empty space.
        var fact = { width: width, height: height, painted: painted, total: width * height };
        try {
          var THREE = scene.THREE;
          fact.avatar = scene.avatar ? scene.avatar.kind : null;
          fact.stageChildren = scene.stage ? scene.stage.children.length : -1;
          fact.cameraDistance = scene.cameraDistance || null;
          fact.modelHeight = scene.modelHeight || null;
          fact.aspect = scene.camera ? scene.camera.aspect : null;
          fact.cameraPosition = scene.camera ? scene.camera.position.toArray() : null;
          fact.rendererSize = scene.renderer ? scene.renderer.getSize(new THREE.Vector2()).toArray() : null;
          fact.pixelRatio = scene.renderer ? scene.renderer.getPixelRatio() : null;
          if (THREE && scene.stage) {
            var bounds = new THREE.Box3().setFromObject(scene.stage);
            fact.box = bounds.isEmpty()
              ? { empty: true }
              : { min: bounds.min.toArray(), max: bounds.max.toArray() };
          }
        } catch (error) {
          fact.error = String((error && error.message) || error);
        }
        return fact;
      } catch (error) {
        return { error: String((error && error.message) || error) };
      }
    }

    /**
     * The framebuffer as a PNG, plus what a colour histogram says about it.
     *
     * `scan()` answers "did anything get painted"; this answers "what does it LOOK like", which is the
     * question a report like "the transparent parts of the clothes are black" actually asks. The two
     * differences from `capturePage` in the launcher matter: this reads the renderer's own buffer, so no
     * window compositing (a transparent, always-on-top window can capture as empty), and it is the exact
     * pixels the WebGL renderer produced.
     *
     * The composite is over mid grey on purpose: a transparent pixel and a black pixel are the same thing
     * in a PNG with no background, and telling those two apart is the whole point of the tool.
     */
    function snapshot() {
      if (!gl) return null;
      try {
        var width = canvas.width;
        var height = canvas.height;
        var all = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, all);
        var flat = document.createElement('canvas');
        flat.width = width;
        flat.height = height;
        var context = flat.getContext('2d');
        var image = context.createImageData(width, height);
        var painted = 0;
        var black = 0;
        var sum = [0, 0, 0];
        for (var y = 0; y < height; y++) {
          for (var x = 0; x < width; x++) {
            // WebGL reads bottom-up; the 2D canvas is top-down.
            var source = ((height - 1 - y) * width + x) * 4;
            var target = (y * width + x) * 4;
            var alpha = all[source + 3] / 255;
            if (all[source + 3] > PAINTED_ALPHA) {
              painted += 1;
              sum[0] += all[source];
              sum[1] += all[source + 1];
              sum[2] += all[source + 2];
              if (all[source] + all[source + 1] + all[source + 2] < 24) black += 1;
            }
            image.data[target] = Math.round(all[source] * alpha + 128 * (1 - alpha));
            image.data[target + 1] = Math.round(all[source + 1] * alpha + 128 * (1 - alpha));
            image.data[target + 2] = Math.round(all[source + 2] * alpha + 128 * (1 - alpha));
            image.data[target + 3] = 255;
          }
        }
        context.putImageData(image, 0, 0);
        return {
          png: flat.toDataURL('image/png'),
          painted: painted,
          black: black,
          average: painted
            ? [Math.round(sum[0] / painted), Math.round(sum[1] / painted), Math.round(sum[2] / painted)]
            : [0, 0, 0],
          // The materials ride along because "why is it black" is the question this snapshot is usually
          // asked, and `alphaTest` on the loaded material is the half of the answer the file cannot give.
          materials: materials(),
        };
      } catch (error) {
        return { error: String((error && error.message) || error) };
      }
    }

    /**
     * Every material the avatar draws with, and the fields that decide how it looks.
     *
     * Added for one question that no amount of reading the file could settle: a VRoid model's clothing comes
     * from a texture that is 77 % cut-out (alpha 0, RGB black), so "the transparent parts of the clothes are
     * black" means EITHER the material's `alphaTest` was lost on the way through the VRM 0.x compatibility
     * layer OR the black is the base colour. `alphaTest`, `transparent`, `depthWrite`, the map and the colour
     * tell those apart, and only the loaded material can answer.
     */
    function materials() {
      var out = [];
      var root = scene.stage;
      if (!root) return out;
      var seen = {};
      root.traverse(function (node) {
        if (!node.isMesh && !node.isSkinnedMesh) return;
        var list = Array.isArray(node.material) ? node.material : [node.material];
        for (var i = 0; i < list.length; i += 1) {
          var material = list[i];
          if (!material || seen[material.uuid]) continue;
          seen[material.uuid] = true;
          out.push({
            node: node.name || null,
            name: material.name || null,
            type: material.type,
            alphaTest: material.alphaTest,
            transparent: material.transparent === true,
            depthWrite: material.depthWrite !== false,
            opacity: material.opacity,
            side: material.side,
            hasMap: Boolean(material.map),
            color: material.color ? material.color.getHexString() : null,
            // MToon keeps its own colours in uniforms, and `color` above is not one of them: `litFactor`
            // multiplies the texture on the lit side and `shadeColorFactor` on the shaded side, so a
            // near-black `litFactor` is one way a white texture ends up painting a black dress.
            lit: uniformHex(material, 'litFactor'),
            shade: uniformHex(material, 'shadeColorFactor'),
            emissive: uniformHex(material, 'emissive'),
            outline: uniformHex(material, 'outlineColorFactor'),
            outlineWidth: uniformValue(material, 'outlineWidthFactor'),
            // The key of the program this material is actually running. Two materials with the same cache key
            // share a compiled shader, and a key that does not mention `alphaTest` is why raising it changed
            // nothing: the program was built for the first value it ever saw.
            program: programKey(material),
          });
        }
        return undefined;
      });
      return out;
    }

    /** A colour-valued uniform as `rrggbb`, or null when the material has no such uniform. */
    function uniformHex(material, name) {
      var uniform = material.uniforms ? material.uniforms[name] : null;
      var value = uniform ? uniform.value : null;
      return value && typeof value.getHexString === 'function' ? value.getHexString() : null;
    }

    /** A number-valued uniform, or null. */
    function uniformValue(material, name) {
      var uniform = material.uniforms ? material.uniforms[name] : null;
      return uniform && typeof uniform.value === 'number' ? uniform.value : null;
    }

    /** The cache key of the program the renderer has this material on, or null. */
    function programKey(material) {
      try {
        var record = scene.renderer && scene.renderer.properties
          ? scene.renderer.properties.get(material)
          : null;
        var program = record ? record.currentProgram : null;
        return program ? String(program.cacheKey).slice(0, 200) : null;
      } catch (error) {
        return 'error: ' + String((error && error.message) || error);
      }
    }

    /** Every material the avatar draws with, once each. */
    function eachMaterial(visit) {
      var root = scene.stage;
      if (!root) return;
      var seen = {};
      root.traverse(function (node) {
        if (!node.isMesh && !node.isSkinnedMesh) return;
        var list = Array.isArray(node.material) ? node.material : [node.material];
        for (var i = 0; i < list.length; i += 1) {
          var material = list[i];
          if (!material || seen[material.uuid]) continue;
          seen[material.uuid] = true;
          visit(material);
        }
        return undefined;
      });
    }

    /**
     * What each material looked like when the model finished loading.
     *
     * A variant that changed `alphaTest` used to leak into the next one, and the leak was invisible: every
     * later variant inherited it, so "hiding the outline changed nothing" actually meant "the alpha test was
     * already 2". Recording the originals and restoring them before each variant is what makes the difference
     * between two screenshots mean the single thing it claims to mean.
     */
    var MATERIAL_ORIGINALS = null;

    function restoreMaterials() {
      if (!MATERIAL_ORIGINALS) {
        MATERIAL_ORIGINALS = {};
        eachMaterial(function (material) {
          MATERIAL_ORIGINALS[material.uuid] = { alphaTest: material.alphaTest, visible: material.visible !== false };
        });
      }
      eachMaterial(function (material) {
        var original = MATERIAL_ORIGINALS[material.uuid];
        if (!original) return;
        if (material.alphaTest !== original.alphaTest) {
          material.alphaTest = original.alphaTest;
          material.needsUpdate = true;
        }
        material.visible = original.visible;
      });
    }

    /**
     * Screenshot variants, for "which material paints that".
     *
     * One image says a black dress is there; it cannot say WHAT drew it. Each variant changes one thing and
     * takes the same picture, so the answer becomes a difference between two files instead of a theory:
     * outlines off (three-vrm adds an inverted-hull outline as a SECOND material on the mesh, and a cut-out
     * that the outline pass draws anyway is the classic way a see-through garment turns black), alpha test off
     * (does the cut-out depend on the mask at all), and cloth-only (is the black even the dress).
     *
     * `as-loaded` restores visibility, so the variants can be taken in any order.
     */
    var MATERIAL_VARIANTS = {
      'as-loaded': function () {},
      'no-outline': function () {
        eachMaterial(function (material) {
          if (material.isOutline === true) material.visible = false;
        });
      },
      'only-outline': function () {
        eachMaterial(function (material) {
          if (material.isOutline !== true) material.visible = false;
        });
      },
      'no-cloth': function () {
        eachMaterial(function (material) {
          if (/Onepice|Shoes/.test(String(material.name || ''))) material.visible = false;
        });
      },
      'only-cloth': function () {
        eachMaterial(function (material) {
          if (!/Onepice|Shoes/.test(String(material.name || ''))) material.visible = false;
        });
      },
      /**
       * `alphaTest = 2` discards everything (no texel has alpha 2), so this is the one variant that answers "is
       * the alpha test doing anything at all". If the garment survives it, the shader is running without
       * `USE_ALPHATEST` and no value of `alphaTest` can mask a cut-out — which is what a garment whose
       * transparent parts render black looks like.
       */
      'alpha-test-2': function () {
        eachMaterial(function (material) {
          material.alphaTest = 2;
          material.needsUpdate = true;
        });
      },
      /** Recompile everything with the values it already has, to tell "wrong value" from "stale program". */
      'recompile': function () {
        eachMaterial(function (material) { material.needsUpdate = true; });
      },
      /**
       * The fix candidate: hand the masked materials the `USE_ALPHATEST` define explicitly.
       *
       * If the cut-out disappears with this and survives `alpha-test-2`, then the shader was running WITHOUT
       * the define — i.e. the program was compiled for a material whose `alphaTest` was 0, and no value of
       * `alphaTest` afterwards can bring the discard back.
       */
      'force-define': function () {
        eachMaterial(function (material) {
          if (!(material.alphaTest > 0)) return;
          var defines = {};
          for (var key in material.defines || {}) defines[key] = material.defines[key];
          defines.USE_ALPHATEST = '';
          material.defines = defines;
          material.needsUpdate = true;
        });
      },
    };

    /** Publish the pet's box and whether the cursor is on painted pixels. */
    /**
     * The rectangle the window reserves for the 碎碎念 — a CONSTANT, never the bubble's own measured box.
     *
     * THE point of this round (operator, 2026-10-13: 「彻底杜绝宠物盒子大小变化的问题」). The window's bounds are the
     * union of the pet, the menu, the prompt and this, and while this WAS the measured bubble every longer remark
     * pushed the window further left and further up — so near a screen edge the OS clamped the bounds back into the
     * work area while the page kept compensating for the origin it had computed, and the pet appeared to jump.
     *
     * A fixed band removes that input entirely: the window's size is decided by the pet and the prompt alone, and
     * whether a bubble is up, and how long its text is, cannot move it. The bubble WRAPS inside the band (three lines
     * at most, see the stylesheet) and grows upward from the prompt's top edge, so it cannot overlap the prompt either.
     */
    function speechBand() {
      var box = canvasBox();
      var fontPx = typeof core.speechPromptFontPx === 'function' ? core.speechPromptFontPx() : 17.1;
      /**
       * FOUR lines of the bubble at 1.5 line-height, plus a line + padding for the prompt it sits above and the gaps.
       *
       * Four is what the longest remark can need: the pool's lines and the model's own answers are both capped at
       * `SPEECH_LIMITS.lineLength` (40 characters), and 40 characters wrap to four lines at the pet's width. It was
       * three, which clipped the fourth line — the 「显示不全」 the operator reported. Constant for a given font, and the
       * font is a constant now (18px, see `STATUS_FONT_PX`), so the window still cannot resize with the text.
       */
      /**
       * EIGHT lines of the bubble at 1.5 line-height, plus the prompt's own line and the gaps.
       *
       * Measured rather than reasoned: a remark of the longest length the product allows
       * (`SPEECH_LIMITS.lineLength`, 40 characters) comes out around 210px tall in this page at the pet's width, because
       * `overflow-wrap:anywhere` breaks CJK at the box edge and the plate's padding is inside its own width. Four lines
       * was short and the operator saw the top of the bubble clipped (「2 行也显示不全」, 2026-10-13); eight lines is the
       * measured worst case with margin. It is still a CONSTANT, so the window cannot resize with the text.
       */
      var height = Math.ceil(fontPx * 1.5 * 8 + fontPx * 1.55 + 24);
      /**
       * Anchored ABOVE THE PROMPT, not above the pet's box.
       *
       * This is the 「2 行也显示不全」 the operator reported on 2026-10-13: the bubble's bottom edge sits `8px` above the
       * prompt's top, so the room it needs starts at the PROMPT, and a band measured down from the pet's box can begin
       * below the bubble's own top — the window then clips the first line, however tall the band is. The prompt's box
       * is the honest anchor (and it is in the window's union in its own right, so this adds no new instability); with
       * no prompt up, the pet's box is.
       */
      var anchor = statusBox && statusBox.width > 0 && statusBox.top < box.top ? statusBox.top : box.top;
      return { left: box.left, top: anchor - height, width: box.width, height: height };
    }

    function reportRect() {
      var pixels = canvasBox();
      var menuRect = menuOpen && menuBox ? menuBox : null;
      var rect = {
        left: screenBox.x + pixels.left,
        top: screenBox.y + pixels.top,
        width: pixels.width,
        height: pixels.height,
        // The MENU travels with the box so the launcher can size the WINDOW to hold both: it is DOM, so
        // nothing of it is painted, and a window that is only the pet's box would clip it.
        menu: menuRect
          ? {
            left: screenBox.x + menuRect.left,
            top: screenBox.y + menuRect.top,
            width: menuRect.width,
            height: menuRect.height,
          }
          : null,
        /**
         * The status prompt, in the same screen coordinates and for the same reason the menu is here: it is
         * DOM above the model's head, so a window that were only the pet's box would clip the one thing this
         * feature exists to show.
         */
        status: statusBox && statusBox.width > 0
          ? {
            left: screenBox.x + statusBox.left,
            top: screenBox.y + statusBox.top,
            width: statusBox.width,
            height: statusBox.height,
          }
          : null,
        /**
         * The 碎碎念 bubble, for exactly the reason the prompt is here: it is DOM above the model's head, and
         * a window sized to the pet's box alone would clip it. It IS in the page's hit test now (`isOverSpeech`),
         * because the wheel over the bubble has to resize the text and the launcher only delivers a wheel where the
         * window says it wants the mouse — it was left out when a bubble was only something to read.
         */
        /**
         * The 碎碎念's RESERVED BAND, never the measured bubble — see `speechBand`. Reported whether or not a bubble is
         * up, because a rect that appears and disappears is a window that resizes when the pet speaks.
         */
        speech: (function () {
          var band = speechBand();
          return {
            left: screenBox.x + band.left,
            top: screenBox.y + band.top,
            width: band.width,
            height: band.height,
          };
        })(),
        dragging: placement.dragging === true,
        /**
         * 视角旋转正在进行 —— 与 `dragging` 分开的一个字段，因为它是**另一种手势**，而启动器对它的处理
         * 恰恰是"旋转异常"的答案。
         *
         * 这个窗口只有宠物那么大，启动器又按"光标是否在宠物像素上"决定要不要让窗口穿透。旋转时鼠标必然离开
         * 宠物（越转越远），于是窗口立刻穿透、指针事件断掉、旋转就停在那里 —— 操作者说的「旋转功能一直都异常」。
         * 报出这个字段，启动器就会在整段旋转期间保持窗口可交互。
         */
        orbiting: viewDrag !== null,
        over: over,
        // The launcher keeps the window interactive for a moment after each notch; `zoomSeq` is what
        // makes every notch a CHANGE, so a report is really sent to refresh that hold.
        zooming: zoomHolding(),
        zoomSeq: zoomSeq,
      };
      if (lastRect
        && lastRect.left === rect.left && lastRect.top === rect.top
        && lastRect.width === rect.width && lastRect.height === rect.height
        && lastRect.dragging === rect.dragging && lastRect.orbiting === rect.orbiting
        && lastRect.over === rect.over
        && lastRect.zoomSeq === rect.zoomSeq
        && JSON.stringify(lastRect.menu) === JSON.stringify(rect.menu)
        && JSON.stringify(lastRect.status) === JSON.stringify(rect.status)
        && JSON.stringify(lastRect.speech) === JSON.stringify(rect.speech)) {
        return;
      }
      lastRect = rect;
      if (bridge && typeof bridge.reportRect === 'function') bridge.reportRect(rect);
    }

    /**
     * The gaze, from the launcher's cursor rather than from an event.
     *
     * Aim is measured against the PET's centre (`core.pointerAim`, the same function the in-app
     * overlay uses), so the pet looks at the cursor wherever it is on the desktop ?including
     * outside the pet, which is the whole point of a desktop pet.
     */
    function applyGaze() {
      if (!cursor || preferences.lookAtPointer === false) {
        scene.motion.setGaze(null);
        lastAim = null;
        return;
      }
      var pixels = boxPixels();
      var aim = core.pointerAim({
        pointerX: cursor.x - screenBox.x,
        pointerY: cursor.y - screenBox.y,
        centreX: pixels.left + placement.width / 2,
        centreY: pixels.top + placement.height / 2,
        // Both of these are SETTINGS (the 模型参数 window's 视线 section) with an "auto" default: a span of
        // 0 means one frame width, which on the floating pet is the screen's horizontal resolution, and the
        // curve defaults to the shipped notch between "sluggish near, twitchy far" and "straight line".
        spanX: core.resolveGazeSpan(preferences.gazeSpanX, screenBox.width),
        spanY: core.resolveGazeSpan(preferences.gazeSpanY, core.GAZE_SPAN.y),
        curve: preferences.gazeCurve,
      });
      lastAim = aim;
      scene.motion.setGaze(scene.gazeFromAim(aim));
    }

    /**
     * One frame: physics, idle, gaze, the canvas position, and the hit test.
     *
     * The body is guarded. A throw here used to end the animation loop for good, and because the
     * page had already reported itself ready, the failure was invisible from outside ?the pet
     * simply never drew another frame and nothing said why. Now the error is recorded, published in
     * the page state, and the loop continues on the next frame.
     */
    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      advance(dt);
      globalThis.requestAnimationFrame(frame);
    }

    /**
     * 一帧的全部工作，`dt` 由调用方给出。
     *
     * 生产里唯一的调用者是上面的 rAF 循环；另外两个是启动器的自检和浏览器探针，它们需要**确定性地**推进时间。
     * 探针此前只能用 `scene.tick()` 手动跑渲染，而"下坠"这件事由这个函数推进 —— 少了这个入口，检查就只能去等真实
     * 的 rAF 帧，而这个仓库已经为"等一串帧把虚拟时钟耗光、套件挂住"付过一次代价。
     *
     * 暴露它的理由和 `publish()`、`scan()`、`hitTest()` 一样：让测试驱动产品的那一条路径，而不是另开一条。
     */
    function advance(dt) {
      try {
        if (placement.isAirborne()) {
          placement.stepFall(dt, core.FALL_PHYSICS);
          /**
           * 下坠/抛掷的物理反馈 —— 与窗口内桌宠同一套，见 `lib/client.js` 的 `reportFallMotion`。
           *
           * 这个窗只有把菜单里的 重力 打开才会下坠，所以缺这一句平时看不见；但缺口是一样的：飞行期间模型收到的
           * 是零，身体不滞后也不前倾，弹簧骨看到一只在世界坐标里站着不动的宠物，头发直挺挺地跟着掉。
           *
           * 落地那一帧 `placement.fall` 已是 null，这一句写进去的就是 0 —— 滞后按 `DRAG_LAG_TAU` 收束，那一下
           * 收束就是落地，不需要额外冲量。
           */
          reportFallMotion();
        }
        /**
         * The state the RENDERER draws.
         *
         * The two pointer-owned poses come first, for the reason `MOTION_STATES` exists: a clip that displaced
         * the body would fight the very integration that decides where the pet lands. With the pet in hand (or
         * in the air) the session's state is therefore irrelevant.
         *
         * Otherwise it is the state the in-app pet published, which is what makes the 状态 section's per-state
         * MOTION work in this window and not only in the app. Until 2026-10-10 this page sent a hard `resting`
         * for every non-drag frame, so a clip mapped to 工作中 played in the app's pet and never in the window
         * the user was actually watching.
         *
         * `sleeping` and `greeting` are deliberately folded into `resting`: they are not configurable states,
         * `setMotionMap` refuses them, and a clip assigned to 空闲 is the right thing to show during a nap.
         */
        var drawn = 'resting';
        if (placement.dragging) drawn = 'held';
        else if (placement.isAirborne()) drawn = 'falling';
        else if (motionStates.indexOf(hostState) !== -1) drawn = hostState;
        scene.setState(drawn);
        // The size and position come BEFORE the render, and that order is the whole flicker fix:
        // `layout()` calls `scene.resize` when the box changed, and resizing a canvas REALLOCATES its
        // drawing buffer, which clears it. Run after `scene.tick` (as it was), the buffer was cleared a
        // few microseconds after the frame had been drawn and stayed empty until the next one — so every
        // wheel notch presented a blank canvas, which is exactly what "the zoom flickers" was.
        layout();
        scene.tick(dt);
        applyGaze();
        /**
         * The prompt, after the frame is drawn: its position is projected from the model's own head, so it
         * has to be measured against the pose the user is looking at rather than the previous frame's.
         */
        renderStatus();
        // Asked AFTER the frame is drawn, so the pixels read are the ones the user is looking at —
        // and it covers the MENU too, which is DOM and has no pixels of its own.
        if (cursor) over = hitTest(cursor.x, cursor.y);
        scene.setPlacement(placement.x, placement.y, 0);
        reportRect();
        frames += 1;
        if (frames === 1 || frames % 30 === 0) publish();
      } catch (error) {
        lastError = String((error && error.message) || error);
        if (frames === 0) errors.push(lastError);
        publish();
      }
    }

    // ---------------------------------------------------------------------------------------------
    // Authored motion
    // ---------------------------------------------------------------------------------------------
    //
    // The floating window had NO motion path until now: the app overlay could play a motion and the desktop
    // pet could not, so a `.vrma` a user assigned in the settings page worked in the app and did nothing in the
    // window they were actually watching. This is that path, and it mirrors the overlay's rather than
    // inventing a second one:
    //
    //   * the CATALOG decides what is offered, filtered by avatar family (`vrm` -> `.vrma`; the `mmd` ->
    //     `.vmd` half of that filter went with MMD support on 2026-10-12);
    //   * the BYTES are fetched once each and outlive a model switch, so re-applying a motion costs no
    //     second download;
    //   * the CLIPS do not outlive it: a clip is fitted to the skeleton it was built against, so a model
    //     switch drops them (`scene.clearMotions`), which is also what stops a stale clip posing the new
    //     model.
    var motionCatalog = { motions: [] };
    var motionLoaded = {};
    var motionPending = {};
    var motionBuffers = {};
    var motionNotice = null;
    var motionRouteAvailable = true;

    /** One line of text for anything throwable, the way the rest of this page reports failures. */
    function errorText(error) {
      if (!error) return 'unknown error';
      return String((error && error.message) || error);
    }

    /**
     * Which motion format can drive an avatar of this kind; `null` means none can.
     *
     * `.vrma` for a VRM and nothing for anything else — the `.vmd`/MMD case this used to answer went with MMD
     * support on 2026-10-12. The same rule lives in `lib/client.js`; both read `core.MOTION_EXTENSIONS`.
     */
    function motionFormatFor(kind) {
      if (kind === 'vrm') return 'vrma';
      return null;
    }

    function avatarKind() {
      var avatar = scene.avatar;
      if (avatar && typeof avatar.kind === 'string' && avatar.kind) return avatar.kind;
      // 'unknown' rather than 'placeholder': the built-in avatar is gone (2026-10-10), so this is the kind of
      // an avatar the page could not classify, not a name for one that exists.
      return typeof scene.kind === 'string' && scene.kind ? scene.kind : 'unknown';
    }

    /** A catalog entry's format: its declared one, else its name through core's own extension list. */
    function motionFormatOf(entry) {
      if (!entry) return 'unknown';
      if (typeof entry.format === 'string' && entry.format) {
        return entry.format.toLowerCase().replace(/^\./, '');
      }
      var name = typeof entry.name === 'string' && entry.name ? entry.name : entry.id;
      return core.isMotionFile(name) ? core.extensionOf(name).slice(1) : 'unknown';
    }

    function motionById(id) {
      var motions = Array.isArray(motionCatalog.motions) ? motionCatalog.motions : [];
      for (var i = 0; i < motions.length; i++) {
        if (motions[i] && motions[i].id === id) return motions[i];
      }
      return null;
    }

    /**
     * The mapped motions that can drive the avatar loaded right now.
     *
     * Every id of every state's LIST: a state draws one clip at random when it is entered, so a clip that
     * was never fetched could not be drawn when its state arrived — the pet would fall back to the idle
     * for one state entry in N, intermittently and with no explanation.
     *
     * The ids come from `effectiveMotions`, so a state the bundled pack's defaults filled in is loaded the
     * same way as one the user ticked.
     */
    function compatibleMotions() {
      var wanted = motionFormatFor(avatarKind());
      if (!wanted) return [];
      var entries = [];
      var ids = core.motionIdList(effectiveMotions());
      for (var i = 0; i < ids.length; i++) {
        var entry = motionById(ids[i]);
        if (entry && motionFormatOf(entry) === wanted) entries.push(entry);
      }
      return entries;
    }

    function fetchMotionBytes(id) {
      return fetch('/vrmpet3d/motion?m=' + encodeURIComponent(id), { credentials: 'omit' })
        .then(function (response) {
          if (!response.ok) throw new Error('the motion route answered HTTP ' + response.status);
          return response.arrayBuffer();
        });
    }

    /**
     * Make one clip available on the current avatar, fetching its bytes at most once.
     *
     * `loop` is the catalog's declaration for that clip (the motion directory's own manifest); it is
     * carried through to the scene, which is the only place that can turn it into `LoopOnce`.
     */
    function ensureMotion(id, loop) {
      if (!id || motionLoaded[id]) return Promise.resolve(Boolean(motionLoaded[id]));
      if (motionPending[id]) return motionPending[id];
      var pending = Promise.resolve(motionBuffers[id] || fetchMotionBytes(id))
        .then(function (buffer) {
          motionBuffers[id] = buffer;
          return scene.loadMotion(id, buffer, { loop: loop !== false });
        })
        .then(function (result) {
          motionPending[id] = null;
          if (result && result.ok) motionLoaded[id] = true;
          else motionNotice = 'motion "' + id + '": ' + ((result && result.reason) || 'it built no tracks');
          return Boolean(result && result.ok);
        })
        .catch(function (error) {
          motionPending[id] = null;
          motionNotice = 'motion "' + id + '" could not be loaded: ' + errorText(error);
          return false;
        });
      motionPending[id] = pending;
      return pending;
    }

    /**
     * The motion map this window should ACT on: the user's choices, with the bundled pack's defaults
     * filling the states they have not touched.
     *
     * The twin of `VrmPet3DWidget.prototype.effectiveMotions` in [lib/client.js](client.js); both go through
     * `core.motionMapWithDefaults`, so the "an explicit choice wins, including an explicit empty one" rule is
     * implemented once and cannot drift between the two surfaces. Nothing is written back to `preferences`:
     * a default stored as a value could never be told apart from a choice.
     */
    function effectiveMotions() {
      var stored = preferences && preferences.motions ? preferences.motions : {};
      if (typeof core.motionMapWithDefaults !== 'function') return stored;
      return core.motionMapWithDefaults(
        stored,
        motionCatalog && motionCatalog.motionDefaults ? motionCatalog.motionDefaults : {},
        motionCatalog && Array.isArray(motionCatalog.motions) ? motionCatalog.motions : [],
      );
    }

    /** Tell the scene which motion plays in which state, and load the ones that apply to this avatar. */
    function applyMotionMap() {
      scene.setMotionMap(effectiveMotions());
      /**
       * And the pack's own 状态与动作 template, which the window renders faces, gaze and play mode through: the
       * SAME key the app pet's widget hands its scene, so the two surfaces cannot disagree about what a clip wears
       * in a state nobody has configured (the symmetry rule that has bitten this repository before).
       */
      if (typeof scene.setMotionClipDefaults === 'function') {
        scene.setMotionClipDefaults(
          motionCatalog && motionCatalog.motionClipDefaults ? motionCatalog.motionClipDefaults : {}
        );
      }
      /**
       * …and the pack's spring values for this window's model. Same payload and same key the app pet reads: the host
       * resolved them against the live model id, so the two surfaces cannot disagree about how the hair behaves on a
       * profile that has never touched a slider (operator, 2026-10-14: 「把当前 BlueFatFish 弹簧骨的参数作为默认参数推上去」).
       */
      if (typeof scene.setSpringDefaults === 'function') {
        var springAll = motionCatalog && motionCatalog.springDefaults ? motionCatalog.springDefaults : null;
        var springId = preferences ? preferences.modelId : null;
        scene.setSpringDefaults(springAll && springId && springAll[springId] ? springAll[springId] : null);
      }
      var entries = compatibleMotions();
      if (!entries.length) {
        publish();
        return Promise.resolve([]);
      }
      return Promise.all(entries.map(function (entry) {
        // The mode IN FORCE: the directory's manifest declares the clip, the settings override it, and the
        // scene is the only place that can turn the answer into LoopOnce.
        var loop = core.motionLoopFor
          ? core.motionLoopFor(preferences, entry.id, entry.loop)
          : entry.loop;
        return ensureMotion(entry.id, loop);
      }))
        .then(function () {
          publish();
          // AGAIN on the next frame: a clip that has just been built is not PLAYING until the frame loop
          // resolves the state against the map, so publishing only here reports `playing: null` and makes a
          // working motion look broken in the diagnostics.
          if (typeof globalThis.requestAnimationFrame === 'function') {
            globalThis.requestAnimationFrame(function () { publish(); });
          }
          return entries;
        });
    }

    /**
     * Re-read the catalog.
     *
     * The host rebuilds the catalog on every request, so a directory imported in the settings page becomes
     * visible here without a restart — which is why the map is re-applied afterwards rather than trusting
     * what was loaded a moment ago.
     */
    function refreshMotions() {
      if (!motionRouteAvailable || typeof fetch !== 'function') return Promise.resolve(null);
      return fetch('/vrmpet3d/motions', { credentials: 'omit' })
        .then(function (response) {
          if (response.status === 404 || response.status === 405) {
            motionRouteAvailable = false;
            motionNotice = 'Motion clips unavailable: the host is not serving /vrmpet3d/motions in this session.';
            return null;
          }
          return response.ok ? response.json() : null;
        })
        .then(function (body) {
          motionCatalog = body && Array.isArray(body.motions) ? body : { motions: [] };
          return applyMotionMap();
        })
        .catch(function (error) {
          motionNotice = 'the motion catalog could not be read: ' + errorText(error);
          return null;
        });
    }

    /** Drop the clips, not the bytes: a clip belongs to the skeleton it was built for. */
    function dropMotions() {
      scene.clearMotions();
      motionLoaded = {};
      motionPending = {};
    }

    /** The page's own account of itself, for the launcher's diagnostics. */
    function publish() {
      var pixels = boxPixels();
      globalThis.__VRMPET3D_DESKTOP_STATE__ = {
        frames: frames,
        lastError: lastError,
        errors: errors.slice(0, 5),
        over: over,
        hitReads: hitReads,
        lastHit: lastHit,
        visible: !preferences.hidden,
        placement: {
          x: placement.x, y: placement.y,
          width: placement.width, height: placement.height,
          dragging: placement.dragging === true,
        },
        pixels: pixels,
        canvas: { width: canvas.width, height: canvas.height },
        canvasRect: typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null,
        rect: lastRect,
        cursor: cursor,
        screen: screenBox,
        viewport: [placement.viewportWidth, placement.viewportHeight],
        devicePixelRatio: globalThis.devicePixelRatio || 1,
        // The MENU, and the two halves of the hit test: the launcher can then report WHY the window is
        // interactive, which is the difference between "on the pet" and "on the menu".
        menu: { open: menuOpen, rect: menuOpen ? menuBox : null, module: Boolean(globalThis.__VRMPET3D_MENU__) },
        hit: {
          over: over,
          overModel: cursor ? paintedAt(cursor.x, cursor.y) : false,
          overMenu: cursor ? isOverMenu(cursor.x, cursor.y) : false,
        },
        /**
         * The last press this pet reacted to — which gesture, and WHICH PART of the model it landed on.
         *
         * Published because "I clicked its eye and nothing happened" has two indistinguishable causes from
         * outside: the press landed on the body (the raycast missed the eye), or it landed on the eye and the
         * eye's row names no emotion. `region` answers the first, `reason` the second.
         */
        touch: typeof scene.lastInteractionState === 'function' ? scene.lastInteractionState() : null,
        // The wheel gesture's own state: whether the page is still willing to take notches, and how
        // many it has taken (the launcher refreshes its interactivity hold on each one).
        zoomHolding: zoomHolding(),
        zoomSeq: zoomSeq,
        // The gaze: what the 视线 settings currently resolve to, and the aim the last frame fed the head.
        // Published so a launcher-side probe can tell "the setting reached the renderer" from "the slider
        // did nothing" — the two are indistinguishable from outside otherwise.
        gaze: {
          curve: preferences.gazeCurve,
          spanX: core.resolveGazeSpan(preferences.gazeSpanX, screenBox.width),
          spanY: core.resolveGazeSpan(preferences.gazeSpanY, core.GAZE_SPAN.y),
          aim: lastAim,
          /**
           * What the RENDERER applied, which is not the same thing as the aim.
           *
           * The aim is what the launcher asked for; `applied` is null whenever the gaze was refused — the 看向光标
           * switch, a preview, the per-clip 凝视 switch, or the idle rule — and that difference is precisely what
           * was invisible when the operator reported "超时暂停全局光标凝视功能未生效" (2026-10-10). The idle
           * setting and how long the cursor has been still travel with it, so a readout can say WHY the head is
           * not following instead of leaving it to be guessed.
           */
          applied: scene.motion.appliedGaze || null,
          idleSeconds: scene.motion.gazeIdleSeconds,
          idleFor: Math.max(0, (scene.motion.elapsed || 0) - (scene.motion.gazeAt || 0)),
          holdGaze: scene.motion.holdGaze === true,
          // 0 = looking straight ahead, 1 = fully following the cursor. The head spends about a second between
          // the two, and this is the number that says which part of that ramp it is on.
          blend: Number.isFinite(scene.motion.gazeBlend) ? scene.motion.gazeBlend : 0,
        },
        /**
         * Whether the spring-bone solver is actually running.
         *
         * `stepPhysics` disables every chain for the rest of the avatar's life after ONE thrown step, and a
         * disabled solver keeps each chain in the pose it was bound in — which is precisely what "the hair
         * hangs naturally but never swings" looks like from the outside. The flag and the reason travel so
         * that state is readable instead of guessed at.
         */
        physics: {
          enabled: scene.motion.physicsEnabled !== false,
          error: scene.motion.physicsError || null,
          preference: preferences.physics !== false,
          chains: (scene.springChainInfo || []).length,
          /**
           * How many chains three-vrm actually built joints for, and how many the document declares but
           * the renderer could not match. A chain the FILE lists and the renderer skipped is a chain whose
           * sliders in 模型参数 do nothing — the failure that hid sixteen of 蓝色小肥鱼's twenty-two chains.
           */
          joints: (function () {
            try {
              var manager = scene.avatar && scene.avatar.vrm && scene.avatar.vrm.springBoneManager;
              return manager && manager.joints ? manager.joints.length : 0;
            } catch (error) { return 0; }
          })(),
          skipped: (scene.springChainSkipped || []).length,
        },
        /**
         * The cursor's draught on those chains: 0 while the hair hangs under its own gravity, and up to
         * `core.WIND_LIMITS.power` while the cursor sweeps across the pet. Published so "sweeping does nothing"
         * can be told apart from "the sweep never reached the chains" — the same distinction the gaze readout
         * needed.
         */
        wind: typeof scene.windState === 'function' ? scene.windState() : null,
        /**
         * 重力, both as the preference and as what the physics is actually doing.
         *
         * Published as a PAIR for the same reason `sizes` is on the settings page: `windowGravity` is what the
         * store says and `throwEnabled` is what this placement was told, and "the switch moved nothing" is
         * exactly one of them changing while the other does not. The app's pet's key is NOT this one — the
         * independence the operator asked for is checkable from outside precisely because both keys are here.
         */
        windowGravity: preferences.windowGravity === true,
        /**
         * 当前视角 —— 发布出来，因为"旋转有没有在转"是这件事唯一的用户可见结果。
         *
         * 它此前只能从 `mount()` 的返回值里读到，而启动器的自检在另一个进程，读不到；于是自检只能间接地猜。
         * 现在它和 `rect.orbiting` 一起，让"光标移开之后视角还在不在转"可以在真实窗口里被测量。
         */
        view: {
          yaw: Number(preferences.viewYaw) || 0,
          pitch: Number(preferences.viewPitch) || 0,
        },
        throwEnabled: placement.throwEnabled !== false,
        language: language,
        // The WINDOW's origin, which is not `screen` (that is the virtual work-area frame the placement
        // is expressed in). The self-test needs it to turn a screen point into a client event.
        windowOrigin: { x: windowOrigin.x, y: windowOrigin.y },
        // Authored motion, from the scene's own account: what is mapped, what can drive this avatar, what
        // is playing and why not. Published because "my motion does nothing in the floating window" has
        // four different causes (no route, no compatible file, a clip that binds to no bone, a state that
        // is not reachable) and only the renderer can tell them apart.
        motion: (function () {
          var described = scene.describeMotions ? scene.describeMotions() : null;
          return {
            kind: avatarKind(),
            format: motionFormatFor(avatarKind()),
            offered: (Array.isArray(motionCatalog.motions) ? motionCatalog.motions.length : 0),
            routed: motionRouteAvailable,
            mapped: described ? described.mapped : (preferences.motions || {}),
            playing: described ? described.playing : null,
            available: described ? described.available : [],
            reason: (described && described.reason) || motionNotice,
            /**
             * What the state's one-shot interval is doing, and on WHICH state.
             *
             * Published because "I set 20–80 seconds and nothing happened" has a cause that is invisible
             * otherwise: the interval belongs to a state, so a window configured for `resting` fires nothing
             * while the pet sits in `working` or `offline`. `state` is the state the scheduler drew for,
             * `nextAt` is when the next one-shot is due (null = not armed), and `running` is the clip that is
             * playing because of it.
             */
            picked: described ? described.picked : null,
            scheduled: described ? described.scheduled : null,
          };
        })(),
        /**
         * The state the page is DRAWING, which is not quite the state the host published: the two pointer-owned
         * poses win while the pet is in hand or in the air, and a state this window has no row for (睡眠, 打招呼)
         * is drawn as `resting`. Published so "the per-state clip does not play in the window" can be answered
         * without guessing which of the two states the renderer was given.
         */
        state: {
          drawn: scene.state,
          published: hostState,
          at: hostStateAt,
          /**
           * Why there is no state, when the channel said so.
           *
           * The host carries the client half's own report of its failure (see `/vrmpet3d/state`'s `error`), and
           * publishing it here is what turns "the window is stuck on 工作中" into a named cause readable from
           * one HTTP request. Measured 2026-10-11: the app's pet was dead with a TypeError and this page had
           * no way to say it.
           */
          error: hostStateError,
          /**
           * And whether the host had to AGE THE REPORT OUT to bring the pet to `published: null`.
           *
           * Without this the readout shows exactly what it showed for the reported bug: nothing, while the label
           * said 深度求索中. With it, "the app's frame loop stopped (its window was in the background)" is a fact on
           * record rather than an inference.
           */
          stale: hostStateStale,
          /**
           * And the CLOCK the label's 用时 is being measured on — `{ startedAt, endedAt }`, the sentinel `'state'`, or null.
           *
           * The three answers are three different behaviours on screen, and two of them have already been shipped wrong
           * once, so which one this page is in has to be readable without a screenshot.
           */
          clock: clockForReport(),
        },
        /**
         * The prompt above the model's head: the rectangle it OCCUPIES, the line it shows, and the window
         * origin that rectangle is expressed against.
         *
         * `rect` is frame coordinates, so the element's page position is `rect - origin`. Both are published
         * because only together do they say where the prompt actually is: a reader that has just `rect` can
         * only compare the page's claim with itself, which is how a prompt drawn above its own window went
         * unnoticed (and the window is sized from `rect`, so a wrong one clips the line it was meant to hold).
         */
        status: {
          rect: statusBox,
          origin: { x: layoutOrigin.x, y: layoutOrigin.y },
          text: statusShown,
          animation: statusAnimation,
          /**
           * Whether the whale is drawn. Published because the mark and the words fail separately: a line with
           * no icon is a bug in `STATUS_ICON_STATES` or in this page, while a line with no words is a settings
           * edit — and from outside the window the two look the same.
           */
          icon: Boolean(statusIconNode) && statusIconNode.hidden === false,
          /**
           * The size the label is DRAWN at. Published because "the text did not grow with the pet" is otherwise
           * unanswerable from outside: the CSS variable is written every frame from the pet's box, and this is
           * the number that proves it moved.
           */
          fontPx: statusNode ? statusNode.style.getPropertyValue('--vrmpet3d-desktop-status-font') : null,
          /**
           * This model's own correction to that size — 1 unless the wheel has been used ON THE TEXT. Published
           * for the same reason the size is: "the text gesture did nothing" and "the text gesture worked and
           * the size is right" look identical from outside without it.
           */
          scale: typeof core.statusScaleFor === 'function'
            ? core.statusScaleFor(preferences, resolvedModelId(preferences.modelId || options.modelId))
            : 1,
          /**
           * How the line is drawn: `gold`+bold for 任务达成, `danger` for 任务失败/出错, empty otherwise.
           *
           * Published because the colour is a DECISION (taken in `core.statusFor`) that this page merely
           * renders: "the prompt is not gold" then separates into "the host state is not 任务达成" and "the page
           * did not apply the tone", which are different bugs.
           */
          tone: statusNode ? statusNode.getAttribute('data-tone') : null,
          bold: Boolean(statusNode) && statusNode.getAttribute('data-bold') === '1',
        },
        /**
         * 碎碎念: the pet's own remark, published the way the prompt is.
         *
         * `text` is what the HOST said, not what this page would have chosen — the page has no session of its
         * own to react to — and `rect` is what the launcher unions into the window's bounds. Both are here so
         * that "the bubble did not appear" separates into three cases from outside: nothing arrived, it
         * arrived and the bubble is up, or it is up with a box somewhere the window does not reach.
         */
        speech: {
          rect: speechBox,
          origin: { x: layoutOrigin.x, y: layoutOrigin.y },
          text: speechShown,
          fontPx: speechNode ? speechNode.style.getPropertyValue('--vrmpet3d-desktop-speech-font') : null,
        },
      };
    }

    /**
     * One wheel notch, anchored at the cursor and clamped exactly as the in-app size control is.
     *
     * Anchoring is what makes a wheel GESTURE possible. Growing the box from its top-left walks the
     * model out from under the pointer; the window is click-through wherever nothing was painted, so
     * the next notch is then delivered to whatever is behind it and the gesture dies after a step or
     * two. The anchor keeps the point under the cursor on the model. `anchor` is in FRAME
     * coordinates; without one (a wheel with no cursor sample) the box centre is held instead and the pet does
     * not jump.
     *
     * `lastZoomAt` additionally holds the hit test open for a moment after each notch, so a cursor
     * that does reach a pixel-less spot — a hair gap, or the millisecond while the model is mid-turn
     * — does not end the gesture.
     */
    function zoom(direction, anchor) {
      var step = core.WHEEL_ZOOM_STEP || 1.12;
      // The FRAME's limits, not a global range: a 40 px long edge at the bottom, the screen's
      // shortest edge at the top. On a 1920x1032 work area that is 14 % .. 344 % of the base slot,
      // against the 40 %..260 % this page used to clamp to.
      var range = placement.zoomLimits(client.BASE_PET_SIZE.width, client.BASE_PET_SIZE.height);
      // `windowSize`: this page's OWN percentage, never the shared `size` the in-app pet owns. Writing `size`
      // here was what made a DSH reload hand this window the app pet's much smaller percentage.
      var next = Math.round(clamp(preferences.windowSize * (direction > 0 ? step : 1 / step), range.min, range.max));
      if (next === Math.round(preferences.windowSize)) return;
      preferences.windowSize = next;
      writePreferences(store, core, preferences);
      placement.preferences = preferences;
      placement.resizeAnchored(
        client.BASE_PET_SIZE.width,
        client.BASE_PET_SIZE.height,
        anchor ? anchor.x : undefined,
        anchor ? anchor.y : undefined,
      );
      lastZoomAt = performance.now();
      zoomSeq += 1;
      // NO `layout()` here. A wheel notch changes the box, and `layout()` is what resizes the drawing
      // buffer — doing that inside the wheel handler reallocates the canvas between two frames, which
      // clears it and leaves it empty when the compositor samples it. The frame loop lays out BEFORE it
      // renders, so the resize and the frame that fills it happen together; the notch only decides the
      // new size, and the next frame (≤16 ms) shows it.
      //
      // `reportRect` stays: it is what carries `zoomSeq` to the launcher, which keeps the window
      // interactive through a burst of notches while the cursor sits on a pixel-less spot.
      reportRect();
      publish();
    }

    /** Right-drag turns the view; the angle is persisted like any other preference. */
    function orbitBy(dx, dy) {
      preferences.viewYaw = (preferences.viewYaw || 0) + dx * VIEW_YAW_PER_PIXEL;
      preferences.viewPitch = clamp(
        (preferences.viewPitch || 0) + dy * VIEW_PITCH_PER_PIXEL,
        core.VIEW_LIMITS.pitchMin,
        core.VIEW_LIMITS.pitchMax,
      );
      scene.applyPreferences(preferences);
      writePreferences(store, core, preferences);
    }

    /**
     * Where the pointer is, in the VIRTUAL work-area frame.
     *
     * From the GLOBAL position (`screenX/screenY`) whenever the event carries one, and that is the
     * whole of the smooth-drag fix. `clientX/clientY` are measured against the window, and this window
     * MOVES with the pet: feeding client coordinates back into the placement makes the pet chase a
     * target that keeps running away, one window-move behind (the reported "drag lags"). Global
     * coordinates do not depend on where the window ended up, so the placement is computed once and the
     * window simply follows it — one hop of latency instead of a feedback loop.
     *
     * Synthetic events (and this page's own probes) carry no screen position, so they fall back to
     * client coordinates plus the window origin, which is exactly the same point.
     */
    function pointerFrame(event) {
      var hasScreen = Number.isFinite(event.screenX) && Number.isFinite(event.screenY)
        && (event.screenX !== 0 || event.screenY !== 0);
      if (hasScreen) return { x: event.screenX - screenBox.x, y: event.screenY - screenBox.y };
      return { x: event.clientX + windowOrigin.x - screenBox.x, y: event.clientY + windowOrigin.y - screenBox.y };
    }

    /**
     * The press bounds, with a stand-in for a core chunk that predates them.
     *
     * The same fallback the app overlay carries, for the same reason: a cached chunk must cost the FEATURE and
     * not the pet. The numbers are the ones `core.PRESS_LIMITS` ships.
     */
    function pressLimits() {
      var limits = core.PRESS_LIMITS;
      return limits && Number.isFinite(limits.moveThreshold) && Number.isFinite(limits.holdSeconds)
        ? limits
        : { moveThreshold: 4, holdSeconds: 0.6 };
    }

    /**
     * WHERE a press landed on the model, or null when there is nothing to measure with.
     *
     * The canvas-local conversion is the same arithmetic the alpha hit test does — a FRAME coordinate minus the
     * canvas's own offset — so the raycast and the pixel test cannot disagree about where the pointer is. A
     * scene without `anatomyAt` (an older cached chunk) costs the PART reaction and nothing else: the pet still
     * greets, drags and holds.
     */
    function anatomyAtEvent(event) {
      if (!scene || typeof scene.anatomyAt !== 'function') return null;
      var pixels = canvasBox();
      var at = pointerFrame(event);
      var x = at.x - pixels.left;
      var y = at.y - pixels.top;
      if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return null;
      return scene.anatomyAt(x, y);
    }

    function onPointerDown(event) {
      if (event.button === 2) {
        viewDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        /**
         * CAPTURE THE POINTER — the mechanism that actually makes "旋转时鼠标被锁住" work.
         *
         * The in-app pet has always done this (`lib/client.js` 的右键分支)；这个页面此前只有左键拖动才捕获，
         * 右键旋转没有 —— 于是鼠标一离开窗口，`pointermove` 就再也不来了，旋转停在那里。捕获之后，**只要右键
         * 还按着**，事件就继续投递给这个元素，光标跑到窗口外也一样，直到 `pointerup` 到达。
         *
         * 这也是「从来没有真正锁住鼠标」的真正含义：不是因为缺少 Chromium 的 pointer lock（那需要窗口可聚焦，
         * 而启动器刻意让这个窗口永不持有焦点，操作者机器上实测 `hasFocus: false`），而是因为没有抓住指针。
         */
        if (canvas.setPointerCapture && event.pointerId !== undefined) {
          try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* a lost capture is recoverable */ }
        }
        // 立刻报一次：启动器要马上知道"旋转中"，否则它会在光标离开宠物的那一刻把窗口设为穿透。
        reportRect();
        return;
      }
      if (event.button !== undefined && event.button !== 0) return;
      // No `over` check here, deliberately. This window only RECEIVES pointer events while the launcher
      // has made it interactive, and that verdict comes from this page's own hit test — so a press that
      // arrives at all is already on a painted pixel. Asking again here read a value the 60 Hz cursor
      // stream updates, so a press in the 16 ms after the cursor landed on the pet was silently dropped:
      // "the first drag does nothing".
      /**
       * A PRESS is not yet a drag and not yet a click — the same two bounds the app overlay uses, out of the
       * same place (`core.PRESS_LIMITS`), so the two surfaces cannot disagree about what a tap is.
       *
       * The part is measured ONCE, here, with the same canvas-local arithmetic the alpha hit test uses: a
       * raycast per press and never per frame.
       */
      drag = {
        id: event.pointerId,
        moved: false,
        held: false,
        part: anatomyAtEvent(event),
        timer: null,
        x: event.clientX,
        y: event.clientY,
      };
      var press = drag;
      press.timer = setTimeout(function () {
        if (drag !== press || press.moved) return;
        press.held = true;
        scene.noteInteraction('hold', press.part);
        // The long press says the part's line, exactly as the click does: the two gestures are told apart by
        // TIME, and both are "the user touched this pet here".
        reactToPart(press.part, 'hold');
        // Published at once rather than at the next of the loop's thirty-frame reports: a press is what the
        // readout exists for, and the launcher's `/vrmpet3d/desktop` should not be half a second behind it.
        publish();
      }, Math.round(pressLimits().holdSeconds * 1000));
      var at = pointerFrame(event);
      // The press point in FRAME coordinates, kept for the re-anchor below: when the press crosses the
      // threshold the pet catches up to the pointer in ONE step instead of lagging behind it for the drag.
      drag.frame = { x: at.x, y: at.y };
      placement.beginDrag(at.x, at.y);
      // The pet is about to be carried by the WINDOW, so from the model's point of view nothing moves —
      // and the spring bones have nothing to react to. The drag velocity is fed to the scene instead
      // (see `lib/scene.js`'s `setDragMotion`), which turns it back into real motion for the rig.
      scene.setDragMotion(0, 0);
      drag.lastAt = undefined;
      drag.lastX = at.x;
      drag.lastY = at.y;
      drag.vx = 0;
      drag.vy = 0;
      if (canvas.setPointerCapture && event.pointerId !== undefined) {
        try { canvas.setPointerCapture(event.pointerId); } catch (_error) { /* a lost capture is recoverable */ }
      }
      reportRect();
    }

    function onPointerMove(event) {
      if (viewDrag && (event.pointerId === undefined || event.pointerId === viewDrag.id)) {
        /**
         * 锁定期间只能用 `movementX/movementY`：光标位置被冻结，`clientX/clientY` 的差恒为 0，用它算增量
         * 画面会一动不动 —— 主窗的 `onPointerMove` 里是同一条规则，这次是把那套方法搬过来。
         */
        var lockedNow = pointerLocked && typeof event.movementX === 'number';
        var dx = lockedNow ? event.movementX : event.clientX - viewDrag.x;
        var dy = lockedNow
          ? (typeof event.movementY === 'number' ? event.movementY : 0)
          : event.clientY - viewDrag.y;
        if (!viewDrag.moved && Math.abs(dx) + Math.abs(dy) < VIEW_DRAG_THRESHOLD) return;
        if (!viewDrag.moved) {
          /**
           * 确定是旋转了，此刻才取锁 —— 而 `moved` 必须**先**置位。
           *
           * 顺序有实质影响：启动器回 `orbit-focus` 之后才会请求锁，而回调会检查"这次旋转还成立吗"
           * （`viewDrag.moved === true`）。先要焦点、后置位，等于把锁请求交给一个永远为假的判断；探针里桥是
           * 同步的，这个顺序错误直接表现为 `lockCalls: 0`，而真实环境里它只是慢一拍。
           */
          viewDrag.moved = true;
          beginOrbitGesture();
        }
        orbitBy(dx, dy);
        // 锁定时这两个值本来就是冻的，写回去无害；未锁定时它们是下一次增量的基准。
        viewDrag.x = event.clientX;
        viewDrag.y = event.clientY;
        return;
      }
      if (!drag || !placement.dragging) return;
      if (event.pointerId !== undefined && event.pointerId !== drag.id) return;
      /**
       * THE PRESS HAS TO WANDER BEFORE IT IS A DRAG, exactly as in the app overlay: below the threshold the
       * pet does not move and nothing reacts, which is what makes a shaky tap a tap rather than a tiny drag.
       */
      if (!drag.moved) {
        /**
         * The threshold is measured in FRAME coordinates, which is the space `moveDrag` works in.
         *
         * Using `clientX` here was wrong for the same reason the drag itself must not: this window MOVES with
         * the pet, so a pointer's client position is measured against a frame whose own position is a
         * consequence of the drag. The probe caught it with events that carry deliberately wrong client
         * coordinates and the true screen position — exactly what a moving window produces — and the press
         * looked stationary, so the drag never started.
         */
        var where = pointerFrame(event);
        var travelled = Math.abs(where.x - drag.frame.x) + Math.abs(where.y - drag.frame.y);
        if (travelled < pressLimits().moveThreshold) return;
        drag.moved = true;
        if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
        // Anchored at the ORIGINAL press point, so the pet catches up in one step rather than lagging behind
        // the pointer for the rest of the drag (the threshold absorbed the JITTER, not the movement).
        placement.beginDrag(drag.frame.x, drag.frame.y);
      }
      // A press that moves is a drag: the DRAG's reaction fires HERE, at the crossing, exactly as it does in
      // the app overlay. It used to fire on pointer-up, where "you picked me up" arrives after the pet has
      // already been put down again.
      if (!drag.reacted) {
        drag.reacted = true;
        scene.noteInteraction('drag', drag.part);
      }
      var dragAt = pointerFrame(event);
      placement.moveDrag(dragAt.x, dragAt.y);
      /**
       * The drag velocity, in frame pixels per second, smoothed.
       *
       * Pointer events arrive far faster than frames (and irregularly), so a single delta is a noisy
       * number: feeding it raw makes the hair twitch. A short exponential average gives the scene a
       * velocity that reads as "the pet is moving this way, this fast", which is what the lag and
       * therefore the spring motion is computed from. Screen y grows downward, and the scene's own
       * conversion accounts for it.
       */
      var now = performance.now();
      if (drag.lastAt !== undefined && now - drag.lastAt >= 4) {
        var instantX = (dragAt.x - drag.lastX) / ((now - drag.lastAt) / 1000);
        var instantY = (dragAt.y - drag.lastY) / ((now - drag.lastAt) / 1000);
        drag.vx = drag.vx * 0.65 + instantX * 0.35;
        drag.vy = drag.vy * 0.65 + instantY * 0.35;
        drag.lastAt = now;
        drag.lastX = dragAt.x;
        drag.lastY = dragAt.y;
        scene.setDragMotion(drag.vx, drag.vy);
      } else if (drag.lastAt === undefined) {
        drag.lastAt = now;
        drag.lastX = dragAt.x;
        drag.lastY = dragAt.y;
      }
      layout();
      reportRect();
    }

    function onPointerUp(event) {
      if (viewDrag && (event.pointerId === undefined || event.pointerId === viewDrag.id)) {
        // 取消（`pointercancel`）不是点击：手势被平台收走时不该弹菜单。
        var cancelled = Boolean(event && event.type === 'pointercancel');
        var moved = viewDrag.moved === true;
        finishViewDrag();
        // A right-click that did NOT turn the view opens the MENU; one that did turn it was an orbit, and
        // orbits must not leave a menu behind. Same gesture, told apart by whether the press wandered —
        // which is why the threshold exists. The point is the FRAME point, because the menu lives in the
        // frame and this window moves under the cursor.
        if (!moved && !cancelled) {
          var atMenu = pointerFrame(event);
          if (menuOpen) closeMenu();
          else openMenuAt(atMenu.x, atMenu.y);
        }
        return;
      }
      if (!drag || !placement.dragging) return;
      if (event.pointerId !== undefined && event.pointerId !== drag.id) return;
      // The press is over, so its long-press timer dies with it: a timer left running would pat the pet after
      // the user let go, which is the one thing a 长按 must not do.
      var press = drag;
      if (press.timer) { clearTimeout(press.timer); press.timer = null; }
      drag = null;
      // With throwing off this returns null and the pet simply stays where it was put; the throw
      // (and the fall that follows it) is still there behind `placement.throwEnabled`.
      placement.endDrag();
      // The drag is over: stop feeding the scene a velocity, which lets the body's lag decay back to the
      // rest position — that decay IS the hair settling instead of snapping.
      scene.setDragMotion(0, 0);
      /**
       * Only a press that neither WANDERED nor WAITED is a CLICK. A drag reacted when it crossed the
       * threshold and a long press reacted while the pointer was still down, so reacting here as well would
       * restart the same emotion at the moment the pet is put down.
       */
      if (press.moved !== true && press.held !== true) {
        scene.noteInteraction('click', press.part);
        reactToPart(press.part, 'click');
      }
      // Remember where the user left it: a desktop pet that returns to its corner on every restart
      // is a toy, not a resident.
      preferences.placementX = placement.x;
      preferences.placementY = placement.y;
      writePreferences(store, core, preferences);
      reportRect();
    }

    /**
     * One wheel notch on the TEXT: this model's correction, and never the pet's size.
     *
     * The operator's "鼠标滚轮在提示文字上时，只缩放状态提示文字（防止某些模型和提示文字不匹配）", and then 「给碎碎念也加上
     * 同样的鼠标滚轮放大功能」 — one correction for both texts, as in `lib/client.js`, so a notch over the prompt and a
     * notch over the bubble move the same number. Stored per model (`statusScale`), because a prompt that reads wrong
     * at the derived size is a property of the model — a chibi whose head is half its height, a tall model with a
     * small head — and it has to come back when that model is loaded again. Written through `writePreferences`, the
     * same store every other window preference uses, which also pushes it to the host so the in-app pet and the
     * settings window see it.
     */
    function stepStatusScale(direction) {
      if (typeof core.statusScaleStep !== 'function') return;
      var modelId = resolvedModelId(preferences.modelId || options.modelId);
      preferences.statusScale = core.statusScaleStep(preferences, modelId, direction);
      writePreferences(store, core, preferences);
    }

    function onWheel(event) {
      // Where the pointer is, in FRAME coordinates: the launcher's cursor when it has one (screen
      // coordinates, so the window's origin comes off), otherwise the event's own position.
      var point = null;
      if (cursor) {
        point = { x: cursor.x - screenBox.x, y: cursor.y - screenBox.y };
      } else if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        point = pointerFrame(event);
      }
      /**
       * Either TEXT first, because both are DOM and nothing of either is painted: a wheel over the prompt or over the
       * 碎碎念 bubble belongs to the TEXT, and the window is interactive there only because `hitTest` says so
       * (`isOverStatus`, `isOverSpeech`).
       *
       * A gesture that already started on the pet keeps the pet, so one burst of notches is never split
       * between the two.
       */
      var onText = (insideBox(statusBox, point && point.x, point && point.y)
        || insideBox(speechBox, point && point.x, point && point.y)) && !zoomHolding();
      // Over painted pixels, OR still inside the wheel gesture that just started, OR over either text. The
      // window is interactive for the whole box while the cursor is on the pet, so a wheel event from the
      // transparent part of the box belongs to whatever is behind it — that is what "the gaps pass through"
      // means — but a burst of notches must not be cut in half by one pixel-less frame.
      if (!onText && !over && !zoomHolding()) return;
      if (event.preventDefault) event.preventDefault();
      if (onText) {
        stepStatusScale(event.deltaY < 0 ? 1 : -1);
        return;
      }
      zoom(event.deltaY < 0 ? 1 : -1, point);
    }

    function onContextMenu(event) {
      if (event.preventDefault) event.preventDefault();
    }

    /**
     * 锁在旋转途中消失（Escape、被系统收回、切到别的窗口）—— 结束旋转，而不是让它继续转。
     *
     * 与主窗同一条规则（`lib/client.js` 的 `pointerlockchange`）：锁是旋转存在的理由，锁没了旋转就该停，
     * 否则光标已经自由了、视角还在被上一次的位移拖着走。
     *
     * 另一半是**迟到的锁**：锁落地时这次旋转已经结束了 —— 那种锁同样要当场交回。
     */
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('pointerlockchange', function () {
        var locked = Boolean(doc.pointerLockElement && doc.pointerLockElement === canvas);
        if (pointerLocked === locked) return;
        pointerLocked = locked;
        if (!locked && viewDrag) { finishViewDrag(); return; }
        /**
         * 授权迟到 —— 立刻交回去。
         *
         * 取锁不是同步的：启动器在 `orbit(true)` 之后 30 ms 才发请求，Chromium 再往返回一趟，所以一次快速的
         * 右拖可以在锁落地之前就松手。那时 `endOrbitGesture` 已经清掉 `orbitAsked`、启动器也已经把窗口交回焦点
         * 并 blur 过，于是这把锁**没有任何东西会释放它**：鼠标事件的投递目标是那个被锁的元素，菜单的点击再也到
         * 不了菜单项（操作者：「右键点击后菜单点击没反应」），光标被扣住却并没有人在拖动（操作者：「没有在拖动，
         * 却把右键锁住了」）—— 而启动器按冻结的光标位置决定穿透，所以看起来又像"莫名其妙鼠标穿透"。
         *
         * 判据只有一个：这次授权还有没有主人。`orbitAsked` 就是"我向启动器要过锁、而且还没说放手"，它与锁的
         * 生存期是同一件事（主窗那条规则的另一面：锁只属于旋转，不属于一次已经结束的按压）。
         */
        if (locked && !orbitAsked) releaseOrbitLock();
      });
    }
    if (globalThis.addEventListener) {
      globalThis.addEventListener('blur', function () {
        // 窗口失焦时松手的事件可能永远不会到达：把锁交回去，并结束这次旋转。
        if (viewDrag) finishViewDrag();
        else releaseOrbitLock();
      });
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    /**
     * And the same handler on the body, because a wheel over the PROMPT never reaches the canvas: the prompt is
     * DOM with `pointer-events:none`, so the event's target is the page's own body. The launcher is what makes
     * the event arrive at all — `hitTest` answers yes over the prompt's rectangle (`isOverStatus`).
     *
     * Canvas events bubble up here too, so they are skipped explicitly: two listeners, one notch.
     */
    if (doc && doc.body && typeof doc.body.addEventListener === 'function') {
      doc.body.addEventListener('wheel', function (event) {
        if (event.target === canvas) return;
        onWheel(event);
      }, { passive: false });
    }

    if (bridge && typeof bridge.onCursor === 'function') {
      bridge.onCursor(function (point) {
        if (!point) return;
        // The window's origin arrives with every sample: it moves when the pet is dragged or zoomed,
        // and both the canvas position (`layout`) and the pointer conversion (`toFrame`) need it.
        if (point.frame) {
          windowOrigin = { x: Number(point.frame.x) || 0, y: Number(point.frame.y) || 0 };
        }
        cursor = {
          x: point.x - (options.cursorOrigin ? options.cursorOrigin.x : 0),
          y: point.y - (options.cursorOrigin ? options.cursorOrigin.y : 0),
        };
        // Answered here as well as in the frame, so the launcher learns the hit state without
        // waiting for the next frame and a synthetic probe gets an immediate reply.
        over = hitTest(cursor.x, cursor.y);
        /**
         * And a sweep that goes ACROSS the pet blows its hair.
         *
         * The operator's request (2026-10-10): "增加鼠标在模型上划过时，可以随着鼠标划过的方向摆动弹簧骨结构的功能".
         * The floating window is where a mouse is actually swept past a pet, and `over` is already the scene's
         * own hit test against painted pixels — so this is "across the MODEL", not "across its window". The
         * sample is the cursor's delta over the time since the last one; the scene decays it and pushes it into
         * the spring chains.
         */
        var sampleAt = performance.now();
        if (over && previousCursor && scene && typeof scene.pushWind === 'function') {
          var windDt = (sampleAt - previousCursor.at) / 1000;
          // Under 200 ms, or the "velocity" of a cursor that jumped after an idle gap would be a gale.
          if (windDt > 0 && windDt < 0.2) {
            // CANVAS pixels, computed exactly the way `paintedAt` does it: the draught is local, so the scene
            // compares this point with each joint's own projection and they have to be the same space.
            var windBox = canvasBox();
            scene.pushWind({
              dx: cursor.x - previousCursor.x,
              dy: cursor.y - previousCursor.y,
              dt: windDt,
              viewYaw: Number(preferences.viewYaw) || 0,
              x: cursor.x - screenBox.x - windBox.left,
              y: cursor.y - screenBox.y - windBox.top,
            });
          }
        }
        previousCursor = { x: cursor.x, y: cursor.y, at: sampleAt };
        reportRect();
        publish();
      });
    }

    /**
     * Load the model through the scene's own `loadModel`, which fetches it from the asset route and
     * REPORTS a failure rather than substituting anything: the built-in fallback avatar was removed on
     * 2026-10-10 (operator: 「内置的占位模型还是没删掉，把 Sample Model 设为内置模型」), and since then
     * `loadModel('')` and `loadModel('placeholder')` both mean "no model selected" and install nothing.
     *
     * THE CATALOG COMES FIRST, and that order is the fix. `resolveModelId` cannot resolve an id against a
     * list it has not received yet - with an empty catalog it returns the request as-is, and on a FRESH
     * install that request is '' (or the launcher's `--model-id` sentinel), which installs nothing. This
     * page used to call `loadCatalog()` at the END of mount and load the model HERE, so the first resolve
     * always ran against the empty list - and nothing re-resolved afterwards, because the snapshot path
     * only reloads a model that CHANGED, and an empty stored id never changes.
     *
     * Measured 2026-10-11 on a fresh install, before this fix: `page.motion.kind` 'placeholder',
     * `physics.chains` 0, `page.errors` [] - the window drew its status prompt and no pet at all, while
     * the bundled SampleModel sat in the catalog. With a stored id it LOOKED fine, because that id later
     * arrived as a changed snapshot preference and was loaded against a catalog that had arrived by then.
     */
    // Fetched HERE rather than at the end of mount: the model cannot be resolved without the catalog.
    // The id is resolved ONCE and the same one is reported as loaded - `status.id` is normally it, but a
    // scene that answered a success without an id must not fall back to the launcher's sentinel.
    var wantedModelId = '';
    var loadPromise = loadCatalog()
      .then(function () {
        wantedModelId = resolvedModelId(preferences.modelId || options.modelId);
        return scene.loadModel(wantedModelId);
      })
      .then(function (status) {
        if (status && status.ok) loadedModel = status.id || wantedModelId;
        // The window's first live report, so the store knows what the floating pet is showing from the start.
        reportLoadedModel(loadedModel);
        // Framing depends on BOTH the canvas size and the avatar, so the box is laid out first and
        // the preferences applied after: framing a model into a canvas that is still screen-sized
        // is how the first version produced a giant pet.
        layout();
        scene.applyPreferences(preferences);
        // Authored motion comes after the avatar exists: a clip is built FOR a skeleton, so loading one
        // before the model would build it against nothing.
        dropMotions();
        refreshMotions();
        if (status && !status.ok && options.onError) options.onError(new Error(status.error || 'the model did not load'));
        return status || null;
      })
      .catch(function (error) {
        if (options.onError) options.onError(error);
        return null;
      });

    /**
     * Follow settings changed in another document.
     *
     * The settings window is a different document (a second Electron window, or a browser tab), and
     * `storage` fires only in the documents that did NOT write — which makes this the mechanism that
     * turns an edit there into a change here, with no reload and no polling. Size, view, gazes and the
     * model are all preferences, so re-reading and re-applying is the whole update.
     */
    /**
     * Apply preferences that came from somewhere else.
     *
     * `shownModel` is the model the WINDOW is showing, which is what a spring override has to be keyed
     * by: the host reports it (the launcher decided it), so the override key can no longer disagree with
     * the model the renderer resolves overrides for.
     */
    function applyExternalPreferences(next, shownModel) {
      // Empty rather than a built-in id: with no avatar installed there is nothing to compare against, and a
      // stand-in name here is what used to make the page describe a pet that was not on screen.
      var current = scene.currentModelId || '';
      var modelChanged = Boolean(shownModel) && shownModel !== current;
      /**
       * A position the STORE has never been told about stays where it is.
       *
       * `null` is `cleanPreferences`'s "never dragged", and a store written before this key reached the page
       * answers exactly that — while this page's own storage may hold the corner the user last left it in.
       * Taking the null would put the window back in the default corner on the first snapshot after a reload.
       * Once the drag pushes a real position, the host's copy is a number and this stops mattering.
       */
      if (next.placementX === null && preferences && preferences.placementX !== null && preferences.placementX !== undefined) {
        next.placementX = preferences.placementX;
        next.placementY = preferences.placementY;
      }
      preferences = next;
      placement.preferences = next;
      placement.setSize(client.BASE_PET_SIZE.width, client.BASE_PET_SIZE.height);
      placement.clampToViewport();
      /**
       * 重力 comes from the store like everything else, and it is PHYSICS rather than a value the scene
       * re-applies — so it has to be pushed here too. Without this line the switch would work until the next
       * snapshot quietly put the old answer back, which is the failure this whole path exists to prevent.
       */
      applyGravity();
      // The scene re-reads the whole preference set: springs and expressions are applied from it, so
      // a change made anywhere lands on the pet through this one call.
      scene.applyPreferences(next);
      if (modelChanged) {
        loadModelSerialized(shownModel).then(function () {
          layout();
          scene.applyPreferences(next);
          // A clip belongs to the skeleton it was built for, so the new model gets fresh ones.
          dropMotions();
          return refreshMotions();
        }).then(function () {
          reportRect();
          publish();
        });
      } else {
        // The motion MAP is a preference like any other: a state assigned or cleared elsewhere has to
        // reach the renderer through the same path, or the two surfaces disagree.
        applyMotionMap();
      }
      layout();
      reportRect();
      publish();
    }

    /**
     * The host's store is the real source.
     *
     * `localStorage` does NOT cross application boundaries: this page and the settings window live in the
     * launcher app, while the pet inside DSH lives in DSH - same origin, different browser profile, two
     * different stores. The host sees all of them, so it keeps the settings and this page follows its
     * version. The storage listener below stays as the fallback for a host without the route.
     */
    if (core.watchHostSettings) {
      hostLink = core.watchHostSettings({
        onSnapshot: function (snapshot) {
          var next = core.cleanPreferences(snapshot.preferences || {});
          /**
           * The model is the shared setting, so this page shows exactly what the app's pet shows; the
           * launcher's --model-id is only the value before the first snapshot arrives.
           *
           * AND THE CATALOG IS RE-READ WHEN IT CANNOT ANSWER. `loadCatalog()` memoises its list, so a model
           * imported while this window is open is an id the list has never heard of — and `resolveModelId` then
           * falls back to `BlueFatFish.vrm`, which is the model already on screen, so nothing reloads and the
           * switch in 切换模型 looks ignored (operator, 2026-10-13: 「选中新导入的模型，都无法切换过去」).
           * `core.catalogMisses` is the question, and the answer is to look again rather than to resolve harder.
           */
          var show = function () { applyExternalPreferences(next, resolvedModelId(next.modelId || options.modelId)); };
          if (core.catalogMisses && core.catalogMisses(catalog, next.modelId)) {
            refreshCatalog().then(show, show);
            return;
          }
          show();
        },
      }).start();
    }

    /**
     * And the PREVIEW channel, which is not a preference.
     *
     * While the settings window is choosing a clip's expression and mouth, the pet shows that combination and
     * then goes back to normal — the operator's "当用户正在修改这部分时，模型变成动作+表情+口型的预览，离开对应设置
     * 的位置后恢复正常状态" (2026-10-09). The previewed clip may not be one of the mapped ones, so it is loaded
     * on demand before it is handed to the scene, exactly as a mapped clip is.
     */
    if (core.watchHostPreview) {
      core.watchHostPreview({
        onPreview: function (preview) {
          if (!preview || !preview.motionId) {
            scene.setPreview(preview);
            return;
          }
          // Loop it: a one-shot would end after a second and read as a broken preview.
          ensureMotion(preview.motionId, true).then(function () {
            scene.setPreview(preview);
          }, function () {
            scene.setPreview(preview);
          });
        },
      }).start();
    }

    buildStatus();
    buildSpeech();
    /**
     * And follow the pet's own state, which is the one fact this page cannot work out for itself.
     *
     * `watchHostState` polls a counter, so the SAME state entered twice is noticed twice — which matters
     * here because the pet returns to `resting` between turns and a value comparison would miss every
     * second entry into 工作中. A prompt whose `seconds` window is set expires on its own: the renderer
     * checks the deadline every frame against the timestamp the state arrived with.
     *
     * The 碎碎念 line arrives in the SAME body: the app's pet decides when the pet speaks and when it stops,
     * and this page draws whatever it is told. One clock for the feature, not two that can disagree.
     */
    if (core.watchHostState) {
      core.watchHostState({
        onState: function (state, body) {
          // The unread count first: `renderStatus` reads it when it decides whether the dot is drawn, and it runs
          // inside `applyHostState`.
          if (body && Number.isFinite(Number(body.unread)) && Number(body.unread) >= 0) {
            hostUnread = Math.floor(Number(body.unread));
          }
          applyHostState(state, body && body.at, body && body.line, body && body.error, body && body.stale,
            body && body.clock);
        },
      }).start();
    }

    if (globalThis.addEventListener) {
      globalThis.addEventListener('storage', function (event) {
        // Any name this project has stored under — an older delivered chunk in another document writes the old
        // key, and that edit is as real as one written by the current half.
        var known = typeof core.isStorageKey === 'function'
          ? core.isStorageKey(event && event.key)
          : (event && event.key) === core.STORAGE_KEY;
        if (event && event.key && !known) return;
        var next = readPreferences(store, core);
        /**
         * A model change, as opposed to an empty preference.
         *
         * The cleaned preferences cannot tell 'this profile has never chosen a model' from 'this profile
         * chose the placeholder', and treating the first as a change is how an unrelated settings edit
         * (turning physics off, say) reloaded the pet as the built-in avatar. So the RAW stored blob is what
         * answers it: only a value the user actually stored counts as a choice.
         */
        var chosen = null;
        try {
          // The stored blob, under whichever name this project last wrote it: a model the user chose BEFORE the
          // 2026-10-12 rename is still a choice, and reading only the new key would reload the pet as the
          // built-in avatar on the first settings edit.
          var storedRaw = typeof core.storedPreferences === 'function'
            ? core.storedPreferences(store)
            : (store ? { raw: store.getItem(core.STORAGE_KEY) } : null);
          var rawStored = storedRaw ? storedRaw.raw : null;
          if (rawStored) {
            var parsedStored = JSON.parse(rawStored);
            if (parsedStored && typeof parsedStored.modelId === 'string' && parsedStored.modelId) {
              chosen = parsedStored.modelId;
            }
          }
        } catch (_error) {
          chosen = null;
        }
        var modelChanged = Boolean(chosen) && chosen !== (scene.currentModelId || '');
        preferences = next;
        placement.preferences = next;
        placement.setSize(client.BASE_PET_SIZE.width, client.BASE_PET_SIZE.height);
        placement.clampToViewport();
        // The scene re-reads the whole preference set: springs and expressions are applied from it, so
        // a change made in the settings window lands on the pet through this one call.
        scene.applyPreferences(next);
        if (modelChanged) {
          // Same serial queue as the host-snapshot path: a storage write is another way for the model to change.
          loadModelSerialized(resolvedModelId(next.modelId)).then(function () {
            layout();
            scene.applyPreferences(next);
            dropMotions();
            return refreshMotions();
          }).then(function () {
            reportRect();
            publish();
          });
        } else {
          applyMotionMap();
        }
        layout();
        reportRect();
        publish();
      });
    }

    layout();
    // The catalog is fetched once, by `loadPromise` above - which is also what WAITS for it before resolving
    // the model. Its list is what tells a STALE stored model id from a live one, which the status prompt's
    // per-model correction and the settings window's URL both depend on.

    // Before the first frame, so a prompt the host already published is up as soon as the window opens rather
    // than one frame later.
    renderStatus();
    globalThis.requestAnimationFrame(frame);
    reportRect();
    publish();
    // Reachable from the launcher's self-test, which runs in another process and can only ask
    // through `executeJavaScript`.
    globalThis.__VRMPET3D_DESKTOP_SCAN__ = scan;
    // The renderer's own pixels, as a PNG: what `scan()` counts, this shows.
    globalThis.__VRMPET3D_DESKTOP_SNAPSHOT__ = snapshot;
    /**
     * One variant of that picture, after letting the frame loop draw it.
     *
     * Resolves rather than returning, because a material change only reaches the framebuffer on the next
     * render: a synchronous read would photograph the frame BEFORE the change and report "no difference" for
     * every variant, which is worse than having no diagnostic at all.
     */
    globalThis.__VRMPET3D_DESKTOP_VARIANT__ = function (label) {
      var variant = MATERIAL_VARIANTS[label];
      if (!variant) return Promise.resolve(null);
      // Every variant starts from the state the model was LOADED with: without this, a variant that raised
      // `alphaTest` leaks into the next one and "hiding the outline changed nothing" is really "the alpha test
      // was already at 2".
      restoreMaterials();
      variant();
      return new Promise(function (resolve) {
        var frames = 0;
        function step() {
          frames += 1;
          if (frames < 3) { globalThis.requestAnimationFrame(step); return; }
          resolve(JSON.stringify(snapshot()));
        }
        globalThis.requestAnimationFrame(step);
      });
    };
    /**
     * Open or close the MENU from outside, for the launcher's self-test.
     *
     * Opened at the pet's own centre unless a frame point is given, because the menu's position IS the
     * right-click point and a probe has no mouse: `__VRMPET3D_DESKTOP_MENU__(true)` is "the user right-clicked the
     * pet", which is the gesture the hit test then has to answer for.
     */
    globalThis.__VRMPET3D_DESKTOP_MENU__ = function (open, x, y) {
      if (open === false) { closeMenu(); return false; }
      var pixels = boxPixels();
      return openMenuAt(
        Number.isFinite(x) ? x : pixels.left + placement.width / 2,
        Number.isFinite(y) ? y : pixels.top + placement.height / 2,
      );
    };
    /**
     * Re-read the motion catalog and re-apply the state map.
     *
     * For the browser probe and the launcher's self-test, which run out of process and cannot reach a
     * closure. It is also the honest entry point for "a motion directory was just imported": the host
     * rebuilds the catalog on every request, so asking again is all an import needs.
     */
    globalThis.__VRMPET3D_DESKTOP_MOTIONS__ = function () { return refreshMotions(); };
    /**
     * Park the pet at a fraction of the frame, clamped. A self-test hook, and it exists for a measured
     * reason: the wheel probe asks whether the point under the cursor stays put during a resize, and
     * the frame's own clamp bends that answer whenever the pet happens to sit near an edge — which made
     * the check depend on wherever the operator's last drag left it (gotcha 37's rule again: a test may
     * not read state it does not own).
     */
    globalThis.__VRMPET3D_DESKTOP_PLACE__ = function (fractionX, fractionY) {
      placement.x = Number(fractionX);
      placement.y = Number(fractionY);
      placement.clampToViewport();
      layout();
      reportRect();
    };

    return {
      placement: placement,
      scene: scene,
      preferences: preferences,
      /**
       * The link to the host's settings store.
       *
       * Exposed so a test can drive one poll instead of waiting for the timer, and so the page's own code
       * has exactly one thing to talk to when it pushes a menu edit.
       */
      settingsSync: hostLink,
      /** Resolves when the first model load has been attempted. */
      ready: loadPromise,
      loadedModel: function () { return loadedModel; },
      zoom: zoom,
      orbitBy: orbitBy,
      layout: layout,
      /** The page's own account of itself, refreshed on demand — the launcher's diagnostics read it. */
      publish: publish,
      /**
       * 推进一帧（`dt` 秒），供启动器自检与浏览器探针确定性地驱动飞行、拖动与渲染。
       *
       * 不是给生产用的：页面自己的 rAF 循环在跑。
       */
      stepFrame: advance,
      paintedAt: paintedAt,
      scan: scan,
      reportRect: reportRect,
      rect: function () { return lastRect; },
      isOver: function () { return over; },
      openMenuAt: openMenuAt,
      closeMenu: closeMenu,
      isMenuOpen: function () { return menuOpen; },
      /**
       * The menu ELEMENT, not the shared module's API record.
       *
       * The launcher's self-test and the browser probes ask this page for its menu to measure and click it,
       * and an Element is what they need; `menuApi()` below is for anything that wants the entries themselves.
       */
      menu: function () { return menu ? menu.element : null; },
      menuApi: function () { return menu; },
      menuRect: function () { return menuBox; },
      /**
       * 重力, as the STORE has it and as the physics is doing it.
       *
       * Both halves are published because "the switch moved nothing" is one of them changing while the other
       * does not, and the app's pet reads a DIFFERENT key (`gravity`) — so a probe can assert the independence
       * the operator asked for from outside this page.
       */
      gravity: function () {
        return { preference: preferences.windowGravity === true, throwEnabled: placement.throwEnabled !== false };
      },
      hitTest: hitTest,
      /**
       * The status prompt, for the launcher's self-test and for the browser probes.
       *
       * `setState` exists because the page cannot work the state out for itself: a probe that wants to see
       * 深度求索中 has to say so, exactly as the host does over `/vrmpet3d/state`. A null or unknown state means
       * "nothing is reporting" and clears the prompt — the same path the host channel takes, so a probe cannot
       * pass while the real arrival is broken.
       */
      status: function () { return statusBox; },
      setState: function (state, clock) {
        // The TURN clock is part of a state observation now (see `applyHostState`), so the self-test can drive one —
        // without it the page correctly draws DSH's token-free label, which is what a page with no turn should show.
        applyHostState(state, Date.now(), hostSpeech, hostStateError, hostStateStale, clock || null);
        return hostState;
      },
      /**
       * 碎碎念, driven directly — the same contract `setState` has, and for the same reason.
       *
       * In the app the line arrives with the state over `/vrmpet3d/state`; a probe (or the launcher's self-test)
       * that wants to see a bubble has no host to publish one, so this is that arrival without a network. A
       * null/empty line clears it, exactly as a POST with no `line` does.
       */
      speech: function () { return speechBox; },
      setSpeech: function (line) {
        hostSpeech = typeof line === 'string' && line ? line : null;
        renderSpeech();
        layout();
        reportRect();
        publish();
        return speechShown;
      },
      destroy: function () {
        running = false;
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        if (menu && typeof menu.destroy === 'function') menu.destroy();
        if (statusNode && statusNode.parentNode) statusNode.parentNode.removeChild(statusNode);
        if (speechNode && speechNode.parentNode) speechNode.parentNode.removeChild(speechNode);
        if (typeof scene.dispose === 'function') scene.dispose();
      },
    };
  }

  globalThis.__VRMPET3D_DESKTOP__ = {
    mount: mount,
    constants: { VIEW_DRAG_THRESHOLD: VIEW_DRAG_THRESHOLD, SCREEN_SLOT_FRACTION: SCREEN_SLOT_FRACTION },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.__VRMPET3D_DESKTOP__;
})();

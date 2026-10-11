// dsh-plugin-vrmpet3d — client half.
//
// Mounts a WebGL canvas into the shell's `shell.overlay` slot and renders a 3D
// desktop pet on top of the whole frame. The scene itself lives in lib/scene.js;
// this file owns the parts that are DSH-shaped:
//
//   * the plugin registration and slot injection
//   * the session → pet-state bridge (via ctx.remote, plus React status hooks)
//   * pointer drag, throw and landing physics
//   * the right-click menu and its persistence
//   * loading the vendored 3D chunk
//
// Loaded as a classic script and registered on the DSH client module loader.
(function () {
  'use strict';

  /** Storage key; versioned so a future shape change cannot misread old data. */
  var SETTINGS_SEQ = 0;

  /**
   * The module id this bundle is registered under, which is also the `ownerId`
   * every chunk request is keyed by. DSH registers a plugin's client half under
   * its package name, and `require.async('./x')` composes
   * `/plugins/<this id>/<x>?rev=…`, so this string must be the package name
   * exactly. `scripts/client-chunks.mjs` asserts it against `package.json` for
   * that reason: a drift here is a chunk that can never be fetched.
   */
  var PLUGIN_ID = 'dsh-plugin-vrmpet3d';

  /**
   * The files this half asks the module system for, and the globals an inlined
   * harness supplies instead.
   *
   * Only `client.<name>.js` can be served at all: the loader matches
   * `/^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/` and rejects anything else
   * before composing a URL. `lib/core.js`, `lib/placeholder.js` and
   * `lib/scene.js` therefore cannot be loaded under their own names, which is
   * exactly why the pet never appeared on the first live install. The
   * `lib/client.*.js` copies are generated from those files by
   * `scripts/client-chunks.mjs`.
   *
   * Loaded in a fixed order, and both halves of that order are load-bearing: the
   * scene chunk reads the other two globals when it runs, so it must follow them,
   * and it is what the vendor hand-off talks to, so it must precede the vendor.
   * See the note on the list itself.
   */
  var CHUNKS = [
    { file: './client.core.js', global: '__VRMPET3D_CORE__', label: 'lib/core.js' },
    // `./client.placeholder.js` was loaded here until 2026-10-10, when the operator removed the built-in avatar
    // ("内置的占位模型还是没删掉，把Sample Model设为内置模型"). The scene no longer builds one, so loading it would
    // only ship a model nothing can show.
    // The scene BEFORE the vendor, and that order is load-bearing. The scene reads
    // `__VRMPET3D_CORE__` when it runs, so it must follow it; and it is what the vendor
    // hand-off below talks to, so it must precede the vendor. Loading the vendor first
    // left `globalThis.__VRMPET3D_SCENE__` undefined at hand-off time, which silently
    // skipped it.
    { file: './client.scene.js', global: '__VRMPET3D_SCENE__', label: 'lib/scene.js' },
    /**
     * The right-click MENU, which is the SINGLE definition both pets build from.
     *
     * A chunk like the others because the app overlay can only load `client.<name>.js`: the same reason the
     * core and the scene are copied. The floating window loads `lib/menu.js` directly (it is a page in the
     * plugin's own launcher, served from the host's source whitelist), so the two surfaces read the same file
     * and an entry, its order or its words cannot exist twice.
     */
    { file: './client.menu.js', global: '__VRMPET3D_MENU__', label: 'lib/menu.js' },
    { file: './client.vendor.js', global: '__VRMPET3D_VENDOR__', label: 'lib/client.vendor.js' },
  ];

  /** What this half handed to the scene, for tests and for a diagnostic read. */
  var handedVendor = null;

  function errorText(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try { return JSON.stringify(error); } catch (e) { return String(error); }
  }

  /**
   * Every chunk request this half makes, resolved through the module system.
   *
   * Why `require.async` and not a `<script src>`: only the module system can
   * build a URL the server will answer. It rewrites the plugin's own combo URL
   * into `/plugins/<id>/client.<name>.js?rev=<current revision>`, and the server
   * rejects both a request without the current `rev` and a file name that is not
   * `client.<name>.js`. A hand-rolled relative URL loses the query string, and
   * the plugin's combo URL has `/plugins/` as its pathname, so the sibling
   * resolves with the plugin id dropped — both were live bugs.
   *
   * Each entry keeps a global fallback, which is not a legacy path: the inline
   * browser harnesses that ship with this project load the sources with plain
   * `<script>` tags and never run a module system, so a global is the only thing
   * they can offer.
   */
  function loadChunks(require) {
    var loaded = {};
    var pending = Promise.resolve();
    var missing = [];

    CHUNKS.forEach(function (chunk) {
      pending = pending.then(function () {
        var present = globalThis[chunk.global];
        // Already published: an inlined harness, or a second widget on the same
        // page. Asking again would be a wasted network round trip at best.
        if (present) {
          loaded[chunk.global] = present;
          return publish(chunk, present);
        }
        return require.async(chunk.file).then(function (exports) {
          var value = exports || globalThis[chunk.global];
          if (!value) throw new Error('vrmpet3d: ' + chunk.file + ' loaded without publishing ' + chunk.global);
          loaded[chunk.global] = value;
          return publish(chunk, value);
        }, function (error) {
          // A refused request must not stop the chunks after it: core alone is
          // worth having, and each failure is reported below with its request.
          missing.push(chunk.label + ': ' + errorText(error));
          return null;
        });
      });
    });

    return pending.then(function () {
      if (missing.length) {
        throw new Error('vrmpet3d: DSH did not deliver ' + missing.join('; '));
      }
      return loaded;
    });
  }

  /**
   * Hand the arrived chunk to whichever module needs it, at the moment it lands.
   *
   * Only the vendor chunk has a consumer: the scene reads
   * `globalThis.__VRMPET3D_VENDOR__` when it runs and when a `Scene` is constructed,
   * so telling it "the graph is here" is what keeps one source of truth for 2.5 MB
   * that would otherwise be searched for twice.
   *
   * This CANNOT be done up front, in one pass before the loop: the vendor chunk is
   * the last one loaded, so a pre-flight `requireVendor(globalThis.__VRMPET3D_VENDOR__)`
   * reads `undefined` in the real app on every run. It looked correct only because
   * the inlined harnesses publish the global before `lib/client.js` is evaluated.
   */
  function publish(chunk, value) {
    if (chunk.global === '__VRMPET3D_VENDOR__') {
      var api = globalThis.__VRMPET3D_SCENE__;
      if (api && typeof api.requireVendor === 'function') handedVendor = api.requireVendor(value) || value;
    }
    return value;
  }

  // ===========================================================================
  // Styles
  // ===========================================================================

  /**
   * All colours come from DSH theme tokens with a light-dark() fallback, so the
   * page tracks the app theme instead of guessing at it. The canvas itself only
   * ever paints the pet: the page behind it must show through.
   */
  var CSS = [
    '.vrmpet3d-root{position:fixed;inset:0;pointer-events:none;z-index:5}',
    '.vrmpet3d-pet{position:absolute;pointer-events:auto;cursor:grab;',
    '  will-change:left,top;touch-action:none;-webkit-user-select:none;user-select:none}',
    '.vrmpet3d-pet[data-dragging=true]{cursor:grabbing}',
    '.vrmpet3d-pet canvas{display:block;width:100%;height:100%;background:transparent}',
    '.vrmpet3d-badge{position:absolute;left:50%;bottom:2px;transform:translateX(-50%);',
    '  max-width:100%;padding:2px 8px;border-radius:999px;font-size:11px;line-height:16px;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;',
    '  background:var(--dsw-alias-bg-module-platform,light-dark(#f9fafb,#353638));',
    '  color:var(--dsw-alias-text-2,light-dark(#4b5563,#b6bac1));',
    '  border:1px solid var(--dsw-alias-border-l2,light-dark(#0000001a,#ffffff1f))}',
    '.vrmpet3d-badge[hidden]{display:none}',
    /*
       The DSH status prompt, above the model's head.
       
       Positioned every frame from the model's own projected top (`Scene.projectToCanvas`), so it follows the
       pet when the camera orbits, when the window resizes and when the wheel zooms — a caption pinned to
       the slot rather than to the head reads as detached from the pet as soon as anything moves.
       
       `transform:translate(-50%,-100%)` puts the element's BOTTOM CENTRE on that point, which is what keeps
       a two-line prompt growing upward instead of covering the face.
    */
    '.vrmpet3d-status{position:absolute;left:0;top:0;transform:translate(-50%,-100%);z-index:1;',
    '  display:inline-flex;align-items:center;gap:.5em;',
    /* NO `max-width`: the line never wraps ("提示文字永不换行"), so the plate is as wide as its text. */
    '  padding:.16em .8em;border-radius:.75em;',
    '  font-size:var(--vrmpet3d-status-font,13px);line-height:1.55;font-weight:500;',
    '  pointer-events:none;color:var(--dsw-alias-label-deep-diving,light-dark(#4d6ad8,#7aa7ff));',
    /* DSH's chat row re-points the shimmer alias at the deep-diving one; the sweep below reads the alias. */
    '  --dsw-alias-label-shimmer:var(--dsw-alias-label-deep-diving-shimmer);',
    '  background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,light-dark(#f9fafb,#353638)) 72%,transparent);',
    '  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,light-dark(#0000001a,#ffffff1f)) 90%,transparent)}',
    '.vrmpet3d-status[hidden]{display:none}',
    /**
     * 任务达成 gold and bold, 任务失败/出错 red — the operator's own words (2026-10-11).
     *
     * `data-tone` comes from `core.statusFor`, so the TWO pets cannot disagree about which state is gold; only
     * the shade is local. The gold is a warm amber rather than a pure yellow, because the plate behind the line
     * is a translucent surface and a pure yellow washes out on a light theme; the red is kept clear of the app's
     * own danger aliases so it reads the same in both themes. The highlight copy of the line inherits through
     * `color:inherit`, and the shimmer alias is re-pointed so the sweep does not tint a gold line blue.
     */
    '.vrmpet3d-status[data-tone="gold"]{color:light-dark(#8a5a00,#ffc94d);--dsw-alias-label-shimmer:light-dark(#ffe0a3,#fff0c9)}',
    '.vrmpet3d-status[data-tone="gold"][data-bold="1"]{font-weight:700}',
    '.vrmpet3d-status[data-tone="danger"]{color:light-dark(#b3261e,#ff6b6b);--dsw-alias-label-shimmer:light-dark(#ffc9c4,#ffd0cc)}',
    /**
     * 碎碎念: the pet's own short remark, in a bubble above the status prompt.
     *
     * A SEPARATE element from the prompt on purpose. The prompt is the app's readout of what DSH is doing and
     * is edited in the settings; this is the pet's voice, and the two are often up at once ("深度求索中" while
     * the pet says "我盯着呢"). Sharing one element would mean one of them silently replacing the other.
     *
     * The anchor is the prompt's own (the model head's projected top, bottom-centre via the transform); the
     * bubble simply sits a prompt's height higher, through `--vrmpet3d-speech-offset`, which the frame loop
     * measures from the prompt actually on screen.
     */
    '.vrmpet3d-speech{position:absolute;left:0;top:0;z-index:2;',
    '  transform:translate(-50%,calc(-100% - var(--vrmpet3d-speech-offset,0px)));',
    '  max-width:18em;padding:.18em .7em;border-radius:.9em;',
    '  font-size:var(--vrmpet3d-speech-font,12px);line-height:1.5;',
    '  white-space:nowrap;pointer-events:none;',
    '  color:var(--dsw-alias-label-primary,light-dark(#1f2937,#f3f4f6));',
    '  background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,light-dark(#ffffff,#3a3b3f)) 92%,transparent);',
    '  border:1px solid var(--dsw-alias-border-l2,light-dark(#0000001f,#ffffff26));',
    '  box-shadow:0 4px 14px #0002}',
    '.vrmpet3d-speech[hidden]{display:none}',
    /* The tail: a rotated square tucked under the bubble, so the remark reads as the pet speaking. */
    '.vrmpet3d-speech::after{content:"";position:absolute;left:50%;bottom:-3px;width:6px;height:6px;',
    '  transform:translateX(-50%) rotate(45deg);',
    '  background:inherit;border-right:1px solid var(--dsw-alias-border-l2,light-dark(#0000001f,#ffffff26));',
    '  border-bottom:1px solid var(--dsw-alias-border-l2,light-dark(#0000001f,#ffffff26))}',
    /* DSH draws the whale 14px beside a 12px label; 1.17em keeps that ratio at every size the pet takes. */
    '.vrmpet3d-status-icon{width:1.17em;height:1.17em;flex:none;display:inline-flex;position:relative;contain:strict}',
    '.vrmpet3d-status-icon[hidden]{display:none}',
    /**
     * DSH's own two-layer mark: the static SVG, and the animated APNG masked over it.
     *
     * `mask:url(…) 50%/100% 100% no-repeat alpha` is the app's declaration verbatim — copied from
     * `RunningWhaleTail`'s stylesheet, activation conditions included (alpha masks available, motion allowed,
     * no forced colours) — with the image served by this plugin's host instead of inlined as base64. The path
     * is `/vrmpet3d/whale`; `lib/core.js`'s `STATUS_ICON_URL` is the same string, and `check-plugin-load.mjs`
     * asserts the route and both declarations agree. It cannot be interpolated here: this stylesheet is built
     * when the client bundle is evaluated, which is BEFORE the core chunk arrives.
     */
    '.vrmpet3d-whale{width:100%;height:100%;display:block}',
    '.vrmpet3d-whale-animated{display:none;position:absolute;inset:0}',
    "@supports (mask-mode:alpha) and (mask-image:url('')){",
    '  @media (prefers-reduced-motion:no-preference) and (forced-colors:none){',
    '    .vrmpet3d-whale-animated{background:currentColor;display:block;',
    '      mask:url(/vrmpet3d/whale) 50%/100% 100% no-repeat alpha;',
    '      -webkit-mask:url(/vrmpet3d/whale) 50%/100% 100% no-repeat}',
    '  }}',
    /* The working line is DSH's own activity label: the real text, then a moving copy of it in the sweep
       colour behind a mask that travels across the whole element. `color-mix`/`mask-image` degrade to the
       plain label above, which is the same failure mode DSH's own label has (@supports in its stylesheet). */
    /* TextShimmer's own box: an inline grid, so the real copy and the masked copy share ONE cell and the
       highlight can only ever sit exactly on the glyphs it is highlighting. */
    '.vrmpet3d-status-shimmer{position:relative;display:inline-grid;width:max-content;max-width:100%;min-width:0;',
    '  vertical-align:top;color:inherit}',
    '.vrmpet3d-status-content{display:flex;align-items:center;min-width:0}',
    /* `nowrap`, always: the operator's "提示文字永不换行". One line, however long the line is. */
    '.vrmpet3d-status-text{color:inherit;font-variant-numeric:tabular-nums;white-space:nowrap}',
    /* The words are rendered twice from ONE string: `attr()` feeds both copies, so the two cannot drift. */
    '.vrmpet3d-status-text[data-shimmer-text]::after{content:attr(data-shimmer-text)}',
    '.vrmpet3d-status-decoration{position:absolute;inset:0;overflow:clip;pointer-events:none;user-select:none}',
    '.vrmpet3d-status-decoration[hidden]{display:none}',
    '.vrmpet3d-status-sweep{position:absolute;inset:0;overflow:hidden;',
    '  color:var(--dsw-alias-label-shimmer,var(--dsw-alias-label-deep-diving,light-dark(#4d6ad8,#7aa7ff)));',
    '  mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);',
    '  -webkit-mask-image:linear-gradient(105deg,transparent 0%,black 40% 60%,transparent 100%);',
    '  transform:translateX(-100%);animation-name:vrmpet3d-status-sweep}',
    '.vrmpet3d-status-sweep *{color:inherit!important}',
    /* Opposite transforms keep every glyph aligned while their shared mask moves: the band travels, the words
       do not. This pair — and the two keyframes below — are copied verbatim from
       `dsh-client-ui-primitives/TextShimmer.module.css`; dropping either half is what made the sweep look
       broken while the words still showed. */
    '.vrmpet3d-status-highlight{width:100%;height:100%;transform:translateX(100%);animation-name:vrmpet3d-status-highlight}',
    '.vrmpet3d-status-sweep,.vrmpet3d-status-highlight{animation-duration:1.5s;animation-delay:.3s;',
    '  animation-timing-function:steps(48,end);animation-iteration-count:infinite}',
    '@keyframes vrmpet3d-status-sweep{0%{transform:translateX(-100%)}66.6667%,100%{transform:translateX(100%)}}',
    '@keyframes vrmpet3d-status-highlight{0%{transform:translateX(100%)}66.6667%,100%{transform:translateX(-100%)}}',
    '@media(prefers-reduced-motion:reduce){.vrmpet3d-status-decoration{display:none}}',
    /* The way back from 关闭宠物, which is a menu entry now: a hidden pet cannot be right-clicked, so
       this button has to live outside the menu that hid it. */
    '.vrmpet3d-restore{position:fixed;right:16px;bottom:16px;pointer-events:auto;padding:6px 12px;',
    '  border-radius:999px;cursor:pointer;font-size:12px;color:inherit;',
    '  border:1px solid var(--dsw-alias-border-l2,light-dark(#0000001a,#ffffff1f));',
    '  background:var(--dsw-alias-bg-module-platform,light-dark(#f9fafb,#353638))}',
    '.vrmpet3d-restore[hidden]{display:none}',
    /* Motion gating: one switch for the user preference, one for the OS setting. Stilling the idle must not
       stop placement, dragging or the menu. */
    ':host([data-motion=false]) .vrmpet3d-pet{transition:none}',
    '@media(prefers-reduced-motion:reduce){.vrmpet3d-pet{transition:none}}'
  ].join('\n');

  // ===========================================================================
  // Drag + placement
  // ===========================================================================

  /**
   * Owns where the pet is, how big it is, and what happens when you throw it.
   *
   * Placement is stored as viewport FRACTIONS (0..1, origin bottom-left) rather
   * than pixels, so the pet keeps its corner when the window is resized. Pixels
   * are derived on demand.
   *
   * @param {object} preferences cleaned preferences
   * @param {Function} now injectable clock
   * @param {object} core the vrmpet3d core module, which supplies stepFall. Passed
   *   in rather than read from a global so the fall simulation cannot silently
   *   depend on load order — an earlier revision had the caller attach it
   *   afterwards, and a directly constructed Placement then crashed mid-fall.
   */
  function Placement(preferences, now, core) {
    if (!core || typeof core.stepFall !== 'function') {
      throw new Error('vrmpet3d: Placement needs the core module (stepFall).');
    }
    this.core = core;
    this.preferences = preferences;
    /**
     * Which preference key holds this placement's size percent. `null` means `size`, which is the app
     * overlay's own key; the floating window sets `'windowSize'`. See `setSize` for why they are separate.
     */
    this.sizeKey = null;
    this.now = typeof now === 'function' ? now : function () { return Date.now(); };
    /** x/y are fractions; defaults park it bottom-right, clear of the composer. */
    this.x = preferences.x !== null && preferences.x !== undefined ? preferences.x : 0.82;
    this.y = preferences.y !== null && preferences.y !== undefined ? preferences.y : 0.12;
    this.width = 220;
    this.height = 300;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
    this.dragging = false;
    this.grabbedAt = null;
    this.offset = { x: 0, y: 0 };
    this.fall = null;
    this.lastPointer = null;
    this.velocity = null;
  }

  Placement.prototype.setViewport = function (width, height) {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  };

  /**
   * Pet size in CSS pixels, from the size preference and the model's own scale.
   *
   * `modelScale` is folded in HERE rather than applied to the model inside a fixed
   * slot, which is what it used to do and what produced the reported "the enlarged
   * model sticks out of its frame": scaling the model while the camera was fitted to
   * the unscaled one pushed it past the canvas edges, and no amount of clamping could
   * bring it back. Multiplying the SLOT instead means the canvas, the drawing buffer
   * and the camera all grow together, so any size is fully visible.
   */
  Placement.prototype.setSize = function (baseWidth, baseHeight) {
    /**
     * WHICH key holds this surface's size percent.
     *
     * `size` by default, because the app overlay's pet is the one inside DSH's window. The floating window
     * sets `sizeKey = 'windowSize'`: its frame is the whole screen, so the same percentage means a different
     * pet, and the two used to fight over one key every time DSH reloaded.
     */
    var rawSize = this.sizeKey ? this.preferences[this.sizeKey] : this.preferences.size;
    var scale = ((rawSize || 100) / 100) * (this.preferences.modelScale || 1);
    // A tiny safety floor only. The real lower bound is the wheel's own range (a 40 px long edge,
    // `core.sizeLimits`), and the hard floors that used to live here — 80 x 100 — quietly made that
    // promise impossible to keep: 40 px was unreachable because every size came back at 80.
    var width = Math.max(8, Math.round(baseWidth * scale));
    var height = Math.max(8, Math.round(baseHeight * scale));
    // Capped to a FRACTION of the frame, not to the frame itself, and that distinction
    // is the whole point. The pet's box is its hit area — `.vrmpet3d-pet` opts back into
    // pointer events over the otherwise click-through overlay — so a slot as large as
    // the window swallows every click and drag in the app, and `maxX`/`maxY` reach 0 so
    // the pet cannot even be dragged out of the way. Every size the wheel can reach must
    // leave the frame usable and the pet movable.
    // `maxSlotFraction` overrides the cap per placement: the desktop window's frame is the whole
    // SCREEN, where the user's rule is the frame's own shortest edge, not a fraction of an app window.
    var fraction = this.maxSlotFraction || MAX_SLOT_FRACTION;
    var limitWidth = Math.max(1, Math.round(this.viewportWidth * fraction.width));
    var limitHeight = Math.max(1, Math.round(this.viewportHeight * fraction.height));
    this.width = Math.min(width, limitWidth);
    this.height = Math.min(height, limitHeight);
  };

  /**
   * The wheel's zoom limits for the frame this pet is in, as percentages.
   *
   * Derived from the FRAME rather than fixed, because the same percentage is an unremarkable pet in
   * an app window and a monster on a laptop screen. The two rules are the user's: the long edge never
   * drops below 40 px, and it never exceeds the frame's shortest edge. This placement's own
   * `maxSlotFraction` — the app overlay's "do not swallow the window" guard — is applied first,
   * because it is the harder physical limit; the floating window passes the whole frame.
   */
  Placement.prototype.zoomLimits = function (baseWidth, baseHeight) {
    if (this.core && typeof this.core.sizeLimits === 'function') {
      return this.core.sizeLimits({
        baseWidth: baseWidth,
        baseHeight: baseHeight,
        viewportWidth: this.viewportWidth,
        viewportHeight: this.viewportHeight,
        slotFraction: this.maxSlotFraction,
      });
    }
    return this.core && this.core.SIZE_RANGE ? this.core.SIZE_RANGE : { min: 10, max: 400 };
  };

  /**
   * Resize while holding one point of the pet still, in frame coordinates.
   *
   * The wheel zooms about the CURSOR, and that is not a nicety: growing the box from its top-left
   * corner walks the model out from under the pointer, and in the desktop window — click-through
   * wherever nothing was painted — the next notch is then delivered to whatever is behind the
   * window instead of to the pet. The wheel gesture dies after a step or two, which is exactly what
   * the user reported ("the pointer ends up on a pixel-less area and continuous zooming stops").
   *
   * The anchor's position INSIDE the box, as a fraction, is what survives the resize: the model is
   * framed to the box, so a point on the model keeps its place on the model.
   *
   * @param {number} baseWidth the size at 100 %, as `setSize` takes it
   * @param {number} baseHeight
   * @param {number} [anchorX] frame coordinate to hold still; the box's centre by default
   * @param {number} [anchorY]
   */
  Placement.prototype.resizeAnchored = function (baseWidth, baseHeight, anchorX, anchorY) {
    var before = this.pixels();
    var anchored = Number.isFinite(anchorX) && Number.isFinite(anchorY);
    var anchor = anchored
      ? { x: anchorX, y: anchorY }
      : { x: before.left + this.width / 2, y: before.top + this.height / 2 };
    var across = this.width > 0 ? (anchor.x - before.left) / this.width : 0.5;
    var down = this.height > 0 ? (anchor.y - before.top) / this.height : 0.5;

    this.setSize(baseWidth, baseHeight);

    this.x = (anchor.x - across * this.width) / this.viewportWidth;
    this.y = (this.viewportHeight - (anchor.y - down * this.height) - this.height) / this.viewportHeight;
    // An anchor near an edge cannot be honoured exactly without leaving the frame, so the clamp
    // wins; that is the only case where the point under the cursor drifts.
    this.clampToViewport();
  };

  /** The largest x that still keeps the pet wholly inside the frame. */
  Placement.prototype.maxX = function () {
    return Math.max(0, 1 - this.width / this.viewportWidth);
  };

  /** The largest y — bottom-anchored — that keeps the pet wholly inside the frame. */
  Placement.prototype.maxY = function () {
    return Math.max(0, 1 - this.height / this.viewportHeight);
  };

  /** Keep the pet inside the frame after a resize. */
  Placement.prototype.clampToViewport = function () {
    var maxX = this.maxX();
    var maxY = this.maxY();
    this.x = Math.min(Math.max(0, this.x), maxX);
    this.y = Math.min(Math.max(0, this.y), maxY);
  };

  /** CSS pixels (left/top) for the current fractional placement. */
  Placement.prototype.pixels = function () {
    return {
      left: Math.round(this.x * this.viewportWidth),
      top: Math.round((1 - this.y) * this.viewportHeight - this.height)
    };
  };

  /** Begin a drag at a pointer position in CSS pixels. */
  Placement.prototype.beginDrag = function (pointerX, pointerY) {
    var pixels = this.pixels();
    this.dragging = true;
    this.grabbedAt = this.now();
    this.offset = { x: pointerX - pixels.left, y: pointerY - pixels.top };
    this.fall = null;
    this.lastPointer = null;
  };

  /**
   * Track the pointer during a drag and remember the velocity, which becomes the
   * throw speed on release. Velocity is smoothed over a short window so one
   * jittery frame cannot fling the pet.
   */
  Placement.prototype.moveDrag = function (pointerX, pointerY) {
    if (!this.dragging) return;
    var left = pointerX - this.offset.x;
    var top = pointerY - this.offset.y;
    this.x = left / this.viewportWidth;
    this.y = (this.viewportHeight - (top + this.height)) / this.viewportHeight;
    this.clampToViewport();

    var moment = this.now();
    var position = this.pixels();
    if (this.lastPointer && moment > this.lastPointer.at) {
      var dt = (moment - this.lastPointer.at) / 1000;
      if (dt > 0) {
        var vx = (position.left - this.lastPointer.left) / dt;
        var vy = (position.top - this.lastPointer.top) / dt;
        var blend = Math.min(1, dt / 0.05);
        this.velocity = {
          x: (this.velocity ? this.velocity.x : 0) * (1 - blend) + vx * blend,
          y: (this.velocity ? this.velocity.y : 0) * (1 - blend) + vy * blend
        };
      }
    }
    this.lastPointer = { left: position.left, top: position.top, at: moment };
  };

  /**
   * Release the pet: hand it to the fall simulation with the throw velocity,
   * converted to viewport fractions per second.
   */
  Placement.prototype.endDrag = function () {
    if (!this.dragging) return null;
    this.dragging = false;
    var velocity = this.velocity || { x: 0, y: 0 };
    this.velocity = null;
    /**
     * Throwing is a switch, not a feature to be deleted.
     *
     * With `throwEnabled === false` the pet is put down exactly where the user let go and STAYS
     * there: no velocity is turned into a fall, so nothing drops from a height and nothing bounces.
     * The window sets it (drag and place); the in-app overlay does not, so the pet in the app still
     * behaves as it always has. `stepFall` and the wall/ceiling bounces below are untouched — a
     * later feature wants them, and turning them back on is this one flag.
     */
    if (this.throwEnabled === false) return null;
    this.fall = {
      y: this.y,
      vy: -velocity.y / this.viewportHeight,
      vx: velocity.x / this.viewportWidth,
      bounces: 0,
      ceilingBounces: 0,
      floor: 0
    };
    return this.fall;
  };

  /**
   * End a fall that is in progress, wherever the pet has got to.
   *
   * 重力 being switched OFF has to stop a pet that is ALREADY falling — "no throwing and no falling" is not
   * "no new throws" — and a pet left airborne with the flag off would be a pet stuck in mid-air, which is a
   * worse bug than the one the switch exists to fix. The position it had reached is where it now stays, and
   * `isAirborne` going false is what makes the next frame's `tick` treat it as landed, so the pose settles
   * through the ordinary touchdown path rather than freezing mid-pose.
   */
  Placement.prototype.endFall = function () {
    if (!this.fall) return false;
    this.fall = null;
    this.velocity = null;
    return true;
  };

  /** Advance the fall; returns true while the pet is still airborne. */
  Placement.prototype.stepFall = function (dt, physics) {
    var fall = this.fall;
    if (!fall) return false;
    var before = fall.vy;
    // The pet's own frame is the simulation's frame: the floor is its bottom edge and
    // the ceiling its top. Passing the ceiling in (rather than clamping afterwards) is
    // what makes a throw upward BOUNCE; clamping it made the pet stick to the top edge
    // and hang there while the rise it was thrown with was quietly discarded.
    var next = this.core.stepFall({
      y: fall.y,
      vy: fall.vy,
      floor: fall.floor,
      ceiling: this.maxY(),
      bounces: fall.bounces,
      ceilingBounces: fall.ceilingBounces
    }, dt, physics);
    fall.y = next.y;
    fall.vy = next.vy;
    fall.bounces = next.bounces;
    fall.ceilingBounces = next.ceilingBounces;

    // Horizontal inertia, damped so a thrown pet skids rather than slides forever,
    // then REFLECTED off a side wall rather than clamped flat against it. Clamping was
    // the reported bug: the pet reached the edge, stopped dead horizontally and rode
    // the wall down to the floor, instead of bouncing off it and landing on the bottom
    // edge like a thrown object.
    fall.vx = (fall.vx || 0) * Math.pow(HORIZONTAL_DAMPING, dt);
    this.x += fall.vx * dt;
    var wall = this.core.reflectWithin(this.x, fall.vx, 0, this.maxX(), physics && physics.wallBounce);
    this.x = wall.x;
    fall.vx = wall.vx;
    if (wall.hit) fall.wallHits = (fall.wallHits || 0) + 1;
    this.y = fall.y;
    // A safety net for a frame whose bounds changed under the simulation (a resize, a
    // zoom while airborne); it must not be what stops the pet, or the bounce above is
    // undone here.
    this.clampToViewport();
    fall.y = this.y;

    if (next.landed) {
      /**
       * 落地这一帧没有冲量，`this.fall` 直接清空 —— 这是刻意的，也是**删掉的那一行**要说清楚的事。
       *
       * 这里曾经写着 `var impact = Math.abs(before);`，算了落地速度却没人用。它读起来像"落地已经有一个冲量"，
       * 而实际上落地的可见反应来自另一处：飞行期间 widget 一直把速度喂给模型（`reportFallMotion`），落地后喂进去
       * 的是 0，于是身体滞后按 `DRAG_LAG_TAU` 收束回中位 —— 那一下收束就是落地。
       *
       * 如果以后要让落地更"砸"（多一次过冲），要的是在这里把速度**发布**出去，再由场景表达，而不是留一个
       * 算了不用的局部变量。
       */
      this.fall = null;
      return false;
    }
    return true;
  };

  Placement.prototype.isAirborne = function () {
    return Boolean(this.fall);
  };

  // ===========================================================================
  // Widget
  // ===========================================================================

  /**
   * @param {HTMLElement} host the element the slot gave us
   * @param {object} options { vendor, language, onScopeChange, onModelChange }
   */
  function VrmPet3DWidget(host, options) {
    options = options || {};
    this.host = host;
    this.core = globalThis.__VRMPET3D_CORE__;
    this.sceneApi = globalThis.__VRMPET3D_SCENE__;
    if (!this.core) throw new Error('vrmpet3d: lib/core.js is not loaded.');
    if (!this.sceneApi) throw new Error('vrmpet3d: lib/scene.js is not loaded.');

    this.language = options.language === 'zh' ? 'zh' : 'en';
    this.onScopeChange = typeof options.onScopeChange === 'function' ? options.onScopeChange : function () {};
    this.onModelChange = typeof options.onModelChange === 'function' ? options.onModelChange : function () {};
    this.document = host.ownerDocument || document;

    this.preferences = this.readStorage();
    this.placement = new Placement(this.preferences, function () { return Date.now(); }, this.core);

    this.machine = new this.core.PetMachine(function () { return Date.now(); }, this.preferences.sleepAfterMs);
    /**
     * The machine reads the settings it needs through the WIDGET, not from a copy.
     *
     * `preferences` is replaced wholesale on every host snapshot, and the one thing the machine reads out of
     * it is the 任务完成 line's own 持续时间 (see `core.doneWindowMs`). A thunk means an edit made while the
     * pet is running applies on the next frame, and that there is no second copy to keep in step — which is
     * exactly how `machine.sleepAfterMs` has to be assigned by hand in three places.
     */
    var widget = this;
    this.machine.preferencesOf = function () { return widget.preferences; };
    /**
     * 碎碎念: the pet's own voice, with its throttle.
     *
     * Built here rather than per frame because its whole job is to REMEMBER — the line that is up, the last
     * event it spoke for, and when the next idle remark is due. Its clock is real time; a test injects its own
     * through the same constructor.
     *
     * A MISSING `SpeechMachine` IS NOT FATAL, and that is the 2026-10-09 lesson repeated with a different
     * symbol. Measured live on 2026-10-11: the app loaded this NEW `lib/client.js` against a core chunk the
     * browser had CACHED under an unchanged revision — one that predated `SpeechMachine` — so an eager
     * `new this.core.SpeechMachine(...)` threw inside the constructor, the widget never mounted, and
     * `/vrmpet3d/state` carried `state: null` plus the TypeError while the floating window (which has no session
     * of its own) kept drawing the last state it had ever been told: 工作中, counting up, for seventeen minutes.
     * The pet is the feature; its voice is a detail, so a core without it means a silent pet, not a dead one.
     */
    this.speech = typeof this.core.SpeechMachine === 'function'
      ? new this.core.SpeechMachine(function () { return Date.now(); })
      : null;
    /** True when the voice is unavailable, so `speechLine` can say why instead of pretending to think. */
    this.speechMissing = this.speech === null;
    /**
     * What the AI 碎碎念 path owes the host.
     *
     * The machine publishes an INTENT (`wantsAi`) rather than making a call — it has no network — and this is
     * the bookkeeping that turns each intent into exactly one request: `handled` is the last `seq` asked about,
     * `inFlight` stops a slow model from being asked again while it thinks, and `promise` is kept so a test can
     * await the answer instead of guessing when it lands.
     */
    this.speechAi = { handled: 0, inFlight: false, promise: null };
    /** What the host last heard, so a line that CLEARS is published too (see `tick`). */
    this.lastPublishedSpeech = null;
    this.aggregate = new this.core.SessionAggregate(function () { return Date.now(); });
    /**
     * The gesture machinery, all of it per-widget state.
     *
     * `windowGesture` is true while the window-level move/up listeners are bound (they must be removed the
     * moment a gesture ends, or the pet would orbit a pointer nobody is holding); `gestureTop` is the parent
     * window when the pet is embedded in a same-origin frame, so a release delivered out there still lands;
     * `pointerLocked` mirrors `document.pointerLockElement === this.pet`, which is what makes the orbit read
     * movement deltas instead of cursor positions.
     */
    this.windowGesture = false;
    this.gestureTop = null;
    this.pointerLocked = false;
    this.scene = null;
    this.canvas = null;
    this.disposed = false;
    this.frameHandle = null;
    this.lastFrameAt = null;
    this.loadedModelId = null;
    this.modelStatus = null;
    this.catalog = null;
    this.pointer = null;
    this.statusTimer = null;
    /**
     * The status prompt's own bookkeeping.
     *
     * `documentFocused` is what makes the operator's rule work — "在工作完成或者错误状态时，用户切换回dsh为焦点后
     * 恢复到空闲状态" — and it starts as `true`, because this widget is created by a page the user is already
     * looking at. `headStatusKey` is the last line drawn, so a caption that has not changed is not rewritten
     * (and its CSS animation not restarted) sixty times a second.
     */
    this.documentFocused = true;
    this.headStatusKey = null;
    /**
     * Publish the pet's state for the other surface, and for the host's diagnostics.
     *
     * The floating window is a page in the plugin's own Electron app and has no session data at all — it
     * cannot see DSH's statuses, its boundaries or its pending interactions. The in-app pet is the one that
     * can, so it reports what the state IS and the window draws the same prompt from it. Left unset here and
     * wired by the plugin half: a standalone widget (a probe, a test) simply never publishes.
     */
    this.publishState = typeof options.publishState === 'function' ? options.publishState : null;

    /**
     * The right-click menu, built by `buildMenu()`.
     *
     * `null` when the shared module did not arrive — the same degradation rule as `SpeechMachine`: a stale or
     * absent chunk costs the menu, never the pet.
     */
    this.menu = null;
    /** Whether `lib/menu.js` arrived; published so a probe can tell "no menu" from "the menu did nothing". */
    this.menuAvailable = false;
    /**
     * What the scene said about the current motion map, and what the motion catalog said about it.
     *
     * These two used to be a note element inside the panel. The panel is gone and 状态与动作 on the 通用设置 page is
     * where clips are assigned now, so the answer is kept as DATA — "the pet is silent because no clip can drive
     * this model" is still answerable, just not by reading a label on the pet.
     */
    this.motionNotice = null;
    /** What the host last said the floating window was doing, as data (see `syncDesktop`). */
    this.desktopStatus = null;
    this.desktopNote = null;

    /**
     * The motion catalog body, or null when the route could not be read. `null`
     * is a normal state here, not a failure: the running composition may have no
     * `webServer` service, and `refreshMotionNotice` reports that rather than
     * leaving the pet silent with nothing to explain it.
     */
    this.motionCatalog = null;
    /**
     * Fetched motion bytes, `{ [id]: Promise<ArrayBuffer> }`.
     *
     * Keyed by id and kept for the widget's lifetime because fetching is the
     * expensive half: two states may map to the same clip, and swapping the
     * avatar invalidates the CLIP but never the BYTES. A rejected promise is
     * dropped again so a transient failure can be retried without a reload.
     */
    this.motionBuffers = {};
    /** `{ [id]: {ok, format} }` for clips already built into the current avatar. */
    this.motionLoaded = {};
    /**
     * `{ [id]: boolean }` — the loop flag each loaded clip was built with.
     *
     * Kept beside `motionLoaded` because the flag can change without the bytes changing: the motion
     * directory's manifest is edited and re-read, and the scene only learns the flag when the bytes are
     * handed over again. Without this, a clip would keep looping until the page was reloaded.
     */
    this.motionLoadedLoop = {};
    /** `{ [id]: Promise }` so a clip is never built twice concurrently. */
    this.motionPending = {};
    /** The last reason the scene gave for not playing something, for `refreshMotionNotice`. */
    this.motionReason = null;

    this.build();
    this.bindViewport();
    this.start();
  }

  // ---- preferences ---------------------------------------------------------

  /**
   * 显示位置 from a raw snapshot, with 调试模式 kept even when the CORE does not know it yet.
   *
   * The delivered chunks are cached under a revision an edit does not change, so a browser can run a NEW
   * `lib/client.js` against a `lib/client.core.js` that predates the value — the failure this repository already
   * ate once for `SpeechMachine` (see the stale-delivery rule in `check-plugin-load.mjs`). Measured again on
   * 2026-10-11 while switching 调试模式 on: the store said `both`, the older cleaner rewrote it to `auto`, and the
   * in-app pet hid itself exactly as if nobody had asked for both — a switch that reports success and does nothing.
   *
   * WHERE the pet lives is decided HERE, in the entry, so the entry keeps the snapshot's own word for the one
   * value a cleaner may not know rather than trusting it blindly. That is the same rule as everywhere else in this
   * file: a stale delivery may cost a feature, never the pet.
   */
  function petSurfaceFrom(raw, cleaned) {
    return raw === 'both' ? 'both' : cleaned;
  }

  VrmPet3DWidget.prototype.readStorage = function () {
    var core = this.core;
    try {
      /**
       * The stored preferences, under the CURRENT name or an older one (`core.storedPreferences`).
       *
       * The key is renamed with the project (2026-10-12), and this is the read that makes the rename a migration
       * rather than a reset: a profile written before it holds `dsh.pet3d.v1`, and the first write puts the same
       * object back under `dsh.vrmpet3d.v1`.
       */
      var stored = typeof core.storedPreferences === 'function'
        ? core.storedPreferences(this.document.defaultView.localStorage)
        : { raw: this.document.defaultView.localStorage.getItem(core.STORAGE_KEY) };
      if (!stored || !stored.raw) return core.cleanPreferences(null);
      var parsed = JSON.parse(stored.raw);
      var cleaned = core.cleanPreferences(parsed);
      cleaned.petSurface = petSurfaceFrom(parsed && parsed.petSurface, cleaned.petSurface);
      return cleaned;
    } catch (error) {
      return core.cleanPreferences(null);
    }
  };

  /**
   * Follow settings written in another document.
   *
   * The model-parameter window is a separate page (its own Electron window, or a browser tab) and
   * `storage` fires only in the documents that did NOT write, so this is what makes an edit there show
   * up here. A model change is reloaded; everything else is a preference the scene already knows how to
   * re-apply.
   */
  /** Keys this SURFACE owns. The settings window owns the rest. */
  var LOCAL_KEYS = [
    'modelId', 'scope', 'motion', 'lookAtPointer', 'physics', 'sleepAfterMs',
    // `panelOpen` used to be here: the panel's own open state. The panel is gone (the menu is built fresh on
    // every right-click and has no state to restore), so the key is dropped from this surface's patch rather
    // than pushed as a value nothing reads.
    'size', 'viewYaw', 'viewPitch', 'hidden',
    /**
     * `petSurface` is here because this surface's 切换回窗口外 entry is one of its two writers.
     *
     * A snapshot now re-APPLIES the surface (`adoptSurface`), so a choice that never reached the host would be
     * undone by the next poll — the switch would flip itself back a moment after it was used. It is also what
     * keeps the debug mode honest: the settings window sets `both`, this switch clears it to `window` or
     * `app`, and whichever was used last is the one the store holds.
     */
    'petSurface',
    // The prompt's per-model text correction (a wheel on the text itself). Owned by the pet surfaces rather
    // than by the settings window, so it travels in this surface's patch to the host store.
    'statusScale',
    /**
     * 重力 — and the key is this surface's OWN, which is the whole of "完全独立".
     *
     * The window's switch writes `windowGravity`, so turning this one off cannot reach the other pet's fall
     * however the two are started, and a host snapshot carrying both keys cannot collapse them into one. The
     * same shape as `size`/`windowSize` above, for the same reason.
     */
    'gravity',
  ];

  /**
   * Follow the HOST's settings store.
   *
   * This is the half that reaches the pet inside the app when something is changed in the settings
   * window: the window is a page in the plugin's own launcher app, this pet is a page in DSH, and
   * `localStorage` does not cross that boundary. The host sees both, so it owns the settings and this
   * polls its version. A host without the route leaves this a no-op and the local storage path keeps
   * working exactly as before.
   */
  VrmPet3DWidget.prototype.followHostSettings = function () {
    var self = this;
    if (!this.core || !this.core.watchHostSettings) return;
    this.hostSync = this.core.watchHostSettings({
      onSnapshot: function (snapshot) {
        var next = self.core.cleanPreferences(snapshot.preferences || {});
        // A cleaner that predates 调试模式 would rewrite it away (see `petSurfaceFrom`): keep the store's word.
        next.petSurface = petSurfaceFrom(snapshot.preferences && snapshot.preferences.petSurface, next.petSurface);
        // The model is ONE setting for both surfaces, so a change made in the window or in the settings
        // window moves this pet too - there is no per-surface model to keep in step.
        self.preferences = next;
        var resolved = self.currentModelId();
        var modelChanged = resolved !== (self.loadedModelId || '');
        if (self.scene) self.scene.applyPreferences(next);
        self.applyPlacement();
        self.syncControls();
        // The one preference a snapshot has to ACT on rather than merely store: 显示位置 decides whether this
        // copy is on screen at all, so 调试模式 — or the switch back out of it — has to reach the launcher here.
        self.adoptSurface();
        if (modelChanged) self.loadModel(resolved);
      },
    }).start();
    // What the settings window needs in order to key a spring override by the model actually on screen.
    this.hostSync.reportLive(this.currentModelId());

    /**
     * And the PREVIEW channel: the in-app pet previews too.
     *
     * The operator's request (2026-10-09) is about "the model", and both surfaces show one — a preview that
     * only reached the floating window would look broken to anyone watching the pet inside DSH, which is the
     * surface that is always there.
     */
    if (this.core.watchHostPreview) {
      this.previewSync = this.core.watchHostPreview({
        onPreview: function (preview) {
          if (!preview || !preview.motionId) {
            if (self.scene) self.scene.setPreview(preview);
            return;
          }
          // The previewed clip may not be one of the mapped ones, so it is fetched on demand — and LOOPED,
          // because a one-shot would end after a second and read as a broken preview.
          self.ensureMotion(preview.motionId, true).then(function () {
            if (self.scene) self.scene.setPreview(preview);
          }, function () {
            if (self.scene) self.scene.setPreview(preview);
          });
        },
      }).start();
    }
  };

  VrmPet3DWidget.prototype.followStorage = function () {
    var self = this;
    var view = this.document.defaultView;
    if (!view || typeof view.addEventListener !== 'function') return;
    view.addEventListener('storage', function (event) {
      // Any name this project has stored under: a document still running an older delivered chunk writes the OLD
      // key, and that edit is as real as one written by the current half.
      var known = typeof self.core.isStorageKey === 'function'
        ? self.core.isStorageKey(event && event.key)
        : (event && event.key) === self.core.STORAGE_KEY;
      if (event && event.key && !known) return;
      var next = self.readStorage();
      self.preferences = next;
      var resolved = self.currentModelId();
      var modelChanged = resolved !== (self.loadedModelId || '');
      if (self.scene) self.scene.applyPreferences(next);
      self.applyPlacement();
      self.syncControls();
      // Same as the host snapshot: a surface written by another document is a change of WHERE the pet is,
      // which the scene cannot apply on its own.
      self.adoptSurface();
      // The springs and expressions are applied by the scene from the preferences it was just given;
      // a DIFFERENT MODEL is the one thing that needs a load rather than an application.
      if (modelChanged) self.loadModel(resolved);
    });
  };

  VrmPet3DWidget.prototype.writeStorage = function () {
    try {
      this.document.defaultView.localStorage.setItem(
        this.core.STORAGE_KEY,
        JSON.stringify(this.preferences)
      );
    } catch (error) {
      // A quota or privacy-mode failure must not break the pet.
    }
    //
    // The host is the source of truth, because localStorage cannot cross the boundary between DSH's
    // profile and the launcher's (which is where the floating window lives).
    //
    // Only the keys THIS SURFACE owns are pushed: `springs` and `expressions` belong to the settings
    // window, and sending a stale copy of them here would undo a slider the user had just moved.
    //
    if (this.hostSync) {
      var patch = {};
      var self = this;
      LOCAL_KEYS.forEach(function (key) {
        if (key in self.preferences) patch[key] = self.preferences[key];
      });
      this.hostSync.push({ preferences: patch });
    }
  };

  // ---- DOM -----------------------------------------------------------------

  VrmPet3DWidget.prototype.build = function () {
    var doc = this.document;
    var root = doc.createElement('div');
    root.className = 'vrmpet3d-root';
    root.setAttribute('data-vrmpet3d', '1');
    /**
     * A MISSING MENU MODULE DEGRADES, IT DOES NOT THROW — the same rule as `SpeechMachine` above and for the
     * same measured reason: the chunk is delivered separately from this file, and a stale or absent one must
     * cost the right-click menu, not the pet. The menu itself is built by `buildMenu()` below, from the shared
     * `lib/menu.js`, which owns the entries, their order and their words; this file owns what each entry DOES.
     */
    root.innerHTML = [
      '<div class="vrmpet3d-pet" data-state="resting" role="button" tabindex="0">',
      '  <canvas aria-hidden="true"></canvas>',
      /*
         The status prompt: DSH's OWN running label, copied from the app rather than approximated.
         
         The operator asked for exactly this — "我要的是dsh内部的前面带着一个鲸鱼尾巴图标的'深度求索中，用时XX分
         XX秒 ···'" — so the shape follows `RunningStatus` + `TextShimmer` in `dsh-client-ui-chat` /
         `dsh-client-ui-primitives`:
         
           * the whale is the app's own stroked path in a 16x16 viewBox, drawn OUTSIDE the shimmer so it keeps
             the base colour while the highlight travels across the words;
           * the words are rendered TWICE — the real copy, and an inert copy inside the moving mask — from ONE
             string, because each copy renders it with `content:attr(data-shimmer-text)` on a pseudo-element;
           * the innermost copy counter-transforms against the mask, which is what keeps the glyphs still while
             the band sweeps. Both halves are required; one alone is the "渐变显示异常" the operator reported.
      */
      '  <span class="vrmpet3d-status" hidden>',
      '    <span class="vrmpet3d-status-icon" aria-hidden="true" hidden></span>',
      '    <span class="vrmpet3d-status-shimmer">',
      '      <span class="vrmpet3d-status-content"><span class="vrmpet3d-status-text"></span></span>',
      '      <span class="vrmpet3d-status-decoration" aria-hidden="true">',
      '        <span class="vrmpet3d-status-sweep">',
      '          <span class="vrmpet3d-status-content vrmpet3d-status-highlight"><span class="vrmpet3d-status-text"></span></span>',
      '        </span>',
      '      </span>',
      '    </span>',
      '  </span>',
      '  <span class="vrmpet3d-badge" hidden></span>',
      /* 碎碎念: the pet's own remark, INSIDE the pet's box — its position is that box's coordinates. */
      '  <span class="vrmpet3d-speech" hidden></span>',
      '</div>',
      /* The way back from 关闭宠物, which is a menu entry now. */
      '<button type="button" class="vrmpet3d-restore vrmpet3d-k-restore" hidden></button>'
    ].join('\n');
    this.host.appendChild(root);

    var style = doc.createElement('style');
    style.textContent = CSS;
    this.host.appendChild(style);

    this.root = root;
    this.pet = root.querySelector('.vrmpet3d-pet');
    this.canvas = root.querySelector('.vrmpet3d-pet canvas');
    this.badge = root.querySelector('.vrmpet3d-badge');
    this.statusNode = root.querySelector('.vrmpet3d-status');
    this.statusIcon = root.querySelector('.vrmpet3d-status-icon');
    this.statusDecoration = root.querySelector('.vrmpet3d-status-decoration');
    /**
     * The prompt's two text copies — the real one and the masked highlight — which always render the SAME
     * string (each through `content:attr(data-shimmer-text)`, so there is one string to keep, not two).
     */
    this.statusTexts = root.querySelectorAll('.vrmpet3d-status-text');
    /** The 碎碎念 bubble, and what it is showing — a change detector, like `headStatusKey`. */
    this.speechNode = root.querySelector('.vrmpet3d-speech');
    this.speechShown = null;
    if (this.statusIcon && this.core && typeof this.core.statusIconMarkup === 'function') {
      // DSH's own whale path, drawn here rather than in the template so the geometry has one home (core.js).
      this.statusIcon.innerHTML = this.core.statusIconMarkup();
    }
    this.restore = root.querySelector('.vrmpet3d-restore');
    /** The restore button's own label — the one string this surface still writes by hand. */
    this.restoreLabel = root.querySelector('.vrmpet3d-k-restore');
    /**
     * The right-click menu, from the SHARED definition (`lib/menu.js`): the same eight entries, in the same
     * order, with the same words as the floating window's — this surface only says which way its 切换 row goes
     * and what each entry does.
     */
    this.buildMenu();

    this.applyStrings();
    this.bindMenu();
    this.applyPlacement();
  };

  VrmPet3DWidget.prototype.applyStrings = function () {
    var text = STRINGS[this.language];
    /**
     * The ONE label this surface still writes by hand.
     *
     * Everything else a user reads in a right-click belongs to the shared menu, and every preference that used
     * to have a row here has a field on one of the two settings pages. The restore button is the exception
     * because it has to be readable while the pet is HIDDEN — the menu that hid it cannot be opened.
     */
    if (this.restoreLabel) this.restoreLabel.textContent = text.restore;
    this.pet.setAttribute('aria-label', text.ariaPet);
  };

  VrmPet3DWidget.prototype.bindMenu = function () {
    var self = this;

    /**
     * The gesture listeners live on the WINDOW, in the CAPTURE phase, for as long as a gesture lasts.
     *
     * The user's report (2026-10-09): "右键旋转时鼠标一旦挪动离开小框架，旋转就失效了，而且模型属于未释放状态" —
     * the orbit died the moment the pointer left the pet's little frame, and the gesture never released. The
     * document-level listeners below are not enough, and the reason is the capture phase: the pet lives in a
     * DSH slot, so moving the cursor over any other part of the app hands the pointer to THAT element's
     * handlers, and one `stopPropagation()` there — or a re-render that drops the capture — and the document
     * never sees another move. The window is the top of the capture chain: nothing can silence it, and it
     * still fires when the pointer is outside the pet, outside the slot, and (for a mouse) outside the window.
     *
     * `lostpointercapture` deliberately does NOT end the gesture any more: it fires when the element that
     * held the capture is re-rendered or detached, which is exactly the case that used to leave the pet
     * latched. The button state is the honest test — see `onPointerMove` — and a real release arrives on the
     * window.
     *
     * FOUR independent release signals, because the second report was "鼠标离开框架后旋转就卡住了，鼠标移动回来，
     * 哪怕没有按下右键，也会继续旋转" (2026-10-09 late): a gesture that survived a release it never saw keeps
     * turning the view for ever. In order of reliability:
     *
     *  1. `pointerup` / `pointercancel` on the window (capture) — the normal path;
     *  2. `mouseup` on the window — the same release through the other event family, in case the pointer
     *     stream is not being delivered at all;
     *  3. `contextmenu`, which a right-button RELEASE always produces (our own listener only suppresses the
     *     BROWSER's menu, it does not prevent the event): if an orbit is still armed when the menu event arrives, the
     *     button is up, whatever any `buttons` field claims. This is the one signal that arrives even when the
     *     release happened with the pointer outside the pet, and it is exactly the reported flow;
     *  4. the BUTTON STATE on the next move (`onPointerMove`), for a release that produced no event in this
     *     document at all.
     */
    var gestureMove = function (event) { self.onPointerMove(event); };
    var gestureUp = function (event) { self.onPointerUp(event); };
    var gestureCancel = function () { self.cancelGesture(); };
    /**
     * A right-button release that was not followed by a `pointerup` we saw.
     *
     * Bound to the window in the capture phase, and only meaningful for an orbit that actually MOVED: a menu
     * event carries no evidence about a press that never turned the view, and some platforms deliver it BEFORE
     * the release — treating that as a release would swallow the MENU on a plain right-click. A drag is
     * different: it cannot be a right-click, so the menu event is the release signal that arrives even when
     * the pointer was far from the pet.
     */
    var gestureMenu = function () {
      if (!self.viewDrag || self.viewDrag.moved !== true) return;
      self.finishOrbit(true);
    };
    /**
     * The same listeners on the TOP window, when the pet lives in a same-origin frame.
     *
     * A release outside an iframe is delivered to the PARENT document, not to the frame's own window, so this
     * is where the event still arrives when the pet is embedded. Cross-origin access throws, which is why the
     * whole thing is guarded and simply skipped: the frame's own window is then the only net, and the pointer
     * lock below is the primary answer anyway.
     */
    var topView = function () {
      try {
        var view = self.pet.ownerDocument.defaultView;
        return view && view.top && view.top !== view && view.top.addEventListener ? view.top : null;
      } catch (error) {
        return null;
      }
    };
    var bindView = function (view, add) {
      if (!view) return;
      var method = add ? 'addEventListener' : 'removeEventListener';
      if (typeof view[method] !== 'function') return;
      view[method]('pointermove', gestureMove, true);
      view[method]('pointerup', gestureUp, true);
      view[method]('pointercancel', gestureUp, true);
      view[method]('mouseup', gestureUp, true);
      view[method]('contextmenu', gestureMenu, true);
      view[method]('blur', gestureCancel);
    };
    this.beginWindowGesture = function () {
      if (self.windowGesture) return;
      self.windowGesture = true;
      self.gestureTop = topView();
      bindView(self.pet.ownerDocument.defaultView, true);
      bindView(self.gestureTop, true);
    };
    this.endWindowGesture = function () {
      if (!self.windowGesture) return;
      self.windowGesture = false;
      bindView(self.pet.ownerDocument.defaultView, false);
      bindView(self.gestureTop, false);
      self.gestureTop = null;
    };

    /**
     * POINTER LOCK while the view is being orbited — the answer to "the release never reaches the frame".
     *
     * The operator's third report, and their own suggestion (2026-10-09 late): "鼠标抬起来的事件还是没传到框架里。
     * 可以旋转的时候把鼠标锁定吗？很多游戏里都是旋转的时候鼠标位置是锁定的，但是对鼠标的位移有反应."
     *
     * A locked pointer CANNOT leave: the cursor stops moving, so there is no "outside the frame" for the
     * release to happen in, and the events keep being delivered to the locked element — including the
     * `pointerup`/`mouseup` that ends the orbit. Movement keeps arriving as `movementX`/`movementY`, which is
     * what `onPointerMove` orbits by while locked, because `clientX`/`clientY` are frozen while it is on.
     *
     * It needs a user gesture (the right-button press is one), it can be refused, and Escape always takes it
     * back — so it is an ADDITION to the window listeners above, never a replacement: a browser that says no
     * leaves the previous behaviour exactly as it was.
     */
    this.requestOrbitLock = function () {
      try {
        if (typeof self.pet.requestPointerLock !== 'function') return null;
        var result = self.pet.requestPointerLock();
        // Newer Chromium returns a promise and rejects when the request is not allowed.
        if (result && typeof result.catch === 'function') {
          result.catch(function () { self.pointerLocked = false; });
        }
        return result;
      } catch (error) {
        return null;
      }
    };
    this.releaseOrbitLock = function () {
      try {
        var locked = self.pet.ownerDocument;
        if (locked && locked.pointerLockElement && typeof locked.exitPointerLock === 'function') {
          locked.exitPointerLock();
        }
      } catch (error) { /* nothing was locked */ }
    };
    var doc = this.pet.ownerDocument;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('pointerlockchange', function () {
        var locked = Boolean(doc.pointerLockElement && doc.pointerLockElement === self.pet);
        if (self.pointerLocked === locked) return;
        self.pointerLocked = locked;
        // Escape (or the page) can take the lock away mid-drag: that ENDS the orbit, because a locked drag is
        // the only reason we asked for it, and a drag that outlives its lock is the latch this whole section
        // exists to prevent.
        if (!locked && self.viewDrag) self.finishOrbit();
      });
      doc.addEventListener('pointerlockerror', function () { self.pointerLocked = false; });
    }

    this.pet.addEventListener('pointerdown', function (event) { self.onPointerDown(event); });
    // Move and release on the document, for the same reason as the gesture listeners above: the
    // pet captures the pointer to itself, so these events are retargeted and bubble
    // from the pet — but a capture that FAILS (an unsupported pointer id, a detached
    // node) would leave a drag listening to a node the pointer has already left.
    this.pet.ownerDocument.addEventListener('pointermove', function (event) { self.onPointerMove(event); });
    this.pet.ownerDocument.addEventListener('pointerup', function (event) { self.onPointerUp(event); });
    this.pet.ownerDocument.addEventListener('pointercancel', function (event) { self.onPointerUp(event); });
    this.pet.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      self.greet();
    });
    /**
     * The MENU opens on a secondary CLICK; a secondary DRAG orbits the camera instead, and the two are told
     * apart by whether the press MOVED (`onPointerMove` / `onPointerUp`).
     *
     * This listener is a SECOND way in rather than the only one, and that is deliberate (2026-10-12: 「右键依然
     * 无法弹出菜单」). Relying on `contextmenu` alone means an Electron shell, a host page that stops the event,
     * or a pointer lock that withholds it can each cost the menu entirely — while the RELEASE is an event we
     * are always given. So the release decides (see `onPointerUp`), and this handler covers the platforms that
     * deliver the menu event FIRST, while the button is still down. Whichever arrives first wins; the other
     * finds `secondaryMenuOpened` set.
     */
    this.pet.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      // 1. An orbit is never a menu.
      if (self.viewDrag && self.viewDrag.moved) return;
      // 2. The press is still DOWN and has not moved: this event IS the click (the Linux/macOS order, where
      //    the menu event precedes the release). Treat it as the release — the orbit ends and the menu opens —
      //    so a platform that never sends us a `pointerup` after it still gets a menu.
      if (self.viewDrag) {
        // The SAME teardown the release uses, rather than a second copy of it: the orbit ends (nothing to
        // persist — it never moved), the lock is handed back and the window listeners come off.
        self.finishOrbit();
        self.secondaryMenuOpened = true;
        self.openMenuAt(event.clientX, event.clientY);
        return;
      }
      // 3. The RELEASE already opened it for this press: a second open would be a menu that jumps.
      if (self.secondaryMenuOpened) {
        self.secondaryMenuOpened = false;
        return;
      }
      // 4. A drag whose release we never saw armed this, so the platform's menu event must not undo it.
      if (self.suppressContextMenu) {
        self.suppressContextMenu = false;
        return;
      }
      self.openMenuAt(event.clientX, event.clientY);
    });
    // The wheel is the size control; the slider it replaced is gone. `passive: false`
    // is required to be allowed to preventDefault: without it the app behind the pet
    // scrolls as well, and the zoom fights the page. The listener is on the pet only,
    // so a wheel over the MENU still scrolls it normally.
    this.pet.addEventListener('wheel', function (event) {
      var delta = Number(event.deltaY);
      if (!Number.isFinite(delta) || delta === 0) return;
      event.preventDefault();
      /**
       * A wheel ON THE TEXT scales the text alone; anywhere else on the pet scales the pet (and the text with
       * it, since the size is derived from the pet's box). The operator's request, verbatim: "鼠标滚轮在提示文
       * 字上时，只缩放状态提示文字（防止某些模型和提示文字不匹配）；鼠标滚轮在模型上时，提示文字和模型同步缩放".
       *
       * The prompt is `pointer-events:none`, so the event arrives HERE either way — with the cursor's real
       * position, which is what makes the distinction possible without putting a listener on the text.
       */
      if (self.isPointerOverStatus(event)) {
        self.stepStatusScale(delta < 0 ? 1 : -1);
        return;
      }
      self.zoomBy(delta < 0 ? 1 : -1);
    }, { passive: false });
    /**
     * DOUBLE-CLICK does NOT open the menu — the right button is the menu's own gesture.
     *
     * It did until 2026-10-12 (operator: 「内置宠物把双击打开菜单变成右键打开菜单」). The handler existed so a
     * user whose platform does not deliver `contextmenu` still had a way in, but it also meant a double-click
     * could not be used for anything else, and it made the menu appear on a gesture the OTHER pet does not
     * accept. Both pets are right-click only now, which is the one thing the two menus are allowed to agree on.
     */

    /**
     * Settings written by a settings page reach this pet through the shared storage key (`storage` fires only
     * in the documents that did NOT write — which is this one), and the HOST's store is the channel that reaches
     * it from the other profile entirely, where the floating window and the settings windows live. Both are
     * wired here, once, for the widget's lifetime.
     */
    this.followStorage();
    this.followHostSettings();
    // Where the pet should live. Deferred to the end of the frame so the pet has mounted and a failure can be
    // reported rather than swallowed.
    var self2 = this;
    this.document.defaultView.requestAnimationFrame(function () { self2.applySurface('quiet'); });
    // The way back from 关闭宠物: the button has to work without the menu, because a hidden pet cannot be
    // right-clicked.
    this.restore.addEventListener('click', function () { self.setHidden(false); });
  };

  /** Reflect preferences into the controls. */
  /**
   * Reflect the preferences this surface still MIRRORS into the DOM.
   *
   * One attribute, and that is the honest total: every control that used to be synced here is a field on one of
   * the two settings pages (`lib/config-page.js`), and the menu has no state to reflect — it is rebuilt from the
   * preferences every time it opens, which is what keeps 非debug模式生效 truthful.
   *
   * 重力 is the exception, and it is not a DOM control: it is PHYSICS, so it has to reach the placement rather
   * than an element. Every path that can change the preferences ends up here (a host snapshot, a `storage`
   * event, a local write), which is what makes the switch survive a reload and a settings-window edit.
   */
  VrmPet3DWidget.prototype.syncControls = function () {
    this.root.setAttribute('data-motion', String(this.preferences.motion));
    this.applyGravity();
  };

  /**
   * Open one of the two settings pages.
   *
   * `page` is `'model'` (the model's own 模型参数 page: 表情 / 部位 / 弹簧骨 / 大小) or `'global'` (通用设置: 导入 / 状态 /
   * 碎碎念 / 视线 / 鼠标互动 / 其他). They are TWO PAGES on two routes since 2026-10-11 — `/vrmpet3d/config` and
   * `/vrmpet3d/global` — and the host picks the route from the action. A host too old to know the `settings` action falls
   * back to opening the page as a tab, so the route is built here too rather than only in the host.
   */
  VrmPet3DWidget.prototype.openSettingsWindow = function (page) {
    var self = this;
    var which = page === 'global' ? 'settings' : 'config';
    // A host route, like the asset route: no port or base is guessed from the page. The 模型参数 page keeps the model
    // in its URL — the page treats it as a fallback for a profile that has never chosen one, so opening the window
    // never switches the model by itself.
    var url = which === 'settings'
      ? '/vrmpet3d/global'
      : '/vrmpet3d/config?model=' + encodeURIComponent(self.currentModelId() || '');
    var fallback = function (reason) {
      var opened = null;
      try { opened = globalThis.open(url, '_blank'); } catch (error) { opened = null; }
      if (!opened) self.showStatus((STRINGS[self.language].configNote || '') + ' ' + (reason || ''));
    };
    try {
      fetch('/vrmpet3d/desktop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        // The model goes with the request: the model window must configure the model that is ON SCREEN, and this
        // surface is the only one that knows it at that moment. Without it the host can only fall back to the
        // launcher's model (or nothing), which is how the settings window ended up describing the built-in
        // placeholder while a VRM was being shown.
        body: JSON.stringify({ action: which, modelId: self.currentModelId() }),
      }).then(function (response) {
        if (!response.ok) fallback('the launcher could not open a window');
      }).catch(function () {
        fallback('the host is not reachable');
      });
    } catch (error) {
      fallback(error && error.message);
    }
  };

  /**
   * The first-run guide: ask the host, then open it at most ONCE per plugin activation.
   *
   * Operator, 2026-10-12: 「安装成功后，彻底配置完之前，每次插件运行都会弹配置引导」. Both halves of "should it be
   * offered?" live on the HOST, and neither is this page's to guess:
   *
   *   * `completed` is on disk (`<profile>/vrmpet3d-setup.json`), written by the guide's own 完成 button, so a
   *     finished guide never comes back — across reloads AND restarts;
   *   * `prompted` is in the host's MEMORY, so one activation offers it once and a page reload does not pop a
   *     second window. It resets when the process does, which is what "每次插件运行" means.
   *
   * The `prompted` mark is written BEFORE the window is opened: a guide that fails to open must not be offered
   * again on the next reload in a loop, and the user can always open it from 通用设置.
   */
  VrmPet3DWidget.prototype.maybeOfferSetup = function () {
    var send = function (body) {
      return fetch('/vrmpet3d/setup-state', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    };
    return fetch('/vrmpet3d/setup-state', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (state) {
        if (!state || state.completed === true || state.prompted === true) return null;
        return send({ prompted: true })
          .then(function () {
            return fetch('/vrmpet3d/desktop', {
              method: 'POST',
              credentials: 'omit',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'setup' }),
            });
          })
          .then(function (response) {
            if (response && response.ok) return null;
            /**
             * No launcher to open a window: the guide is a page like the settings ones, so it opens as a tab —
             * and a tab opened from outside a user gesture is exactly what a popup blocker eats, which would look
             * like "the guide never appeared". So the pet SAYS where it can be opened by hand.
             */
            var opened = null;
            try { opened = globalThis.open('/vrmpet3d/setup', '_blank'); } catch (error) { opened = null; }
            if (!opened) self.showStatus((STRINGS[self.language].setupNote || ''));
            return null;
          });
      })
      .catch(function () { return null; });
  };

  /** Gap kept between the menu and every edge of the frame. */
  var MENU_MARGIN = 8;

  /**
   * Open the right-click menu at a point in the page.
   *
   * The menu IS what a right-click does now. It replaced the pet's own settings panel (operator, 2026-10-11:
   * 「内置桌宠和独立桌宠各自有一套设置，这样是不对的。删掉两个单独的设置面板。」), and both settings pages are opened from its
   * 通用设置 / 当前模型参数设置 entries — so every entry is about the PET (its view, its size, which surface shows
   * it, whether it is on screen) while the settings themselves have exactly one home each.
   *
   * The box is clamped into the frame by its own measured size: a menu whose last entry hangs off an edge is an
   * entry that cannot be clicked.
   */
  VrmPet3DWidget.prototype.openMenuAt = function (clientX, clientY) {
    if (!this.menu) return false;
    var doc = this.document;
    var view = doc.defaultView;
    var viewportWidth = Number(view && view.innerWidth) || doc.documentElement.clientWidth || 0;
    var viewportHeight = Number(view && view.innerHeight) || doc.documentElement.clientHeight || 0;
    /**
     * 非debug模式生效, read at OPEN time.
     *
     * 调试模式 (`petSurface: 'both'`) is a settings-page switch and this page keeps running while it is flipped,
     * so a menu that cached the mode would offer a 切换回窗口外 that does nothing. The state can only be honest if
     * it is read when the menu is built.
     */
    this.menu.setSurfaceAllowed(this.preferences.petSurface !== 'both');
    /**
     * 重力's check mark, read at the same moment and for the same reason: a host snapshot or a settings-window
     * edit can change the preference while the page keeps running, so a menu that cached it would show the
     * state it was built with rather than the state the physics is in.
     *
     * **GUARDED, and this is not defensive habit — it is the bug the operator reported on 2026-10-12.**
     * 「内置宠物右键单击无效」: `setChecked` is NEWER than the delivered menu chunk, and the two halves are fetched
     * separately under a `rev=` a page can keep in its cache (see `lib/menu.js`'s `TOGGLES` and HANDOFF's
     * stale-delivery entries). An old chunk therefore has no `setChecked`, this line THREW inside the
     * `contextmenu` handler, and the menu never opened — a right-click that does nothing at all, with the
     * reason only visible in a console nobody had open. A stale chunk must cost the 重力 MARK, never the menu:
     * the rule the core and the scene chunks already follow, and what `check-plugin-load.mjs` audits.
     */
    if (typeof this.menu.setChecked === 'function') {
      this.menu.setChecked('gravity', this.preferences.gravity === true);
    }
    var size = this.menu.open();
    var left = Number.isFinite(clientX) ? clientX : 0;
    var top = Number.isFinite(clientY) ? clientY : 0;
    if (size.width && viewportWidth) {
      left = Math.min(Math.max(left, MENU_MARGIN), Math.max(MENU_MARGIN, viewportWidth - size.width - MENU_MARGIN));
    }
    if (size.height && viewportHeight) {
      top = Math.min(Math.max(top, MENU_MARGIN), Math.max(MENU_MARGIN, viewportHeight - size.height - MENU_MARGIN));
    }
    this.menu.place(left, top);
    return true;
  };

  /** Put the menu away, if it is up. */
  VrmPet3DWidget.prototype.closeMenu = function () {
    if (this.menu) this.menu.close();
  };

  /**
   * Build the menu from the SHARED definition (`lib/menu.js`).
   *
   * The entries, their order and their words come from that one file — the floating window builds the same menu
   * from the same source, so the two pets cannot offer different menus. What this surface supplies is what each
   * entry DOES, and the one row that differs between the surfaces: this pet hands the pet OUT (切换回窗口外).
   */
  VrmPet3DWidget.prototype.buildMenu = function () {
    var api = globalThis.__VRMPET3D_MENU__;
    if (!api || typeof api.createMenu !== 'function') return null;
    this.menuAvailable = true;
    api.injectStyle(this.document, 'vrmpet3d-menu-style');
    var self = this;
    this.menu = api.createMenu({
      document: this.document,
      container: this.root,
      language: this.language,
      toSurface: 'window',
      onChoose: function (id) { self.onMenuChoice(id); },
    });
    return this.menu;
  };

  /**
   * What one entry does on THIS surface.
   *
   * Every branch is one line of intent, because the interesting decisions live elsewhere: `resetView` and
   * `resetSize` are the pet's own, `openSettingsWindow` picks the page, `applySurface` is the surface rule (and
   * `adoptSurface` is what makes it reach the launcher), and `setGravity` is the pet's own physics switch.
   *
   * 重启/退出 DeepSeek Harness had the last two branches until 2026-10-12, when the operator removed them from
   * both menus — and with them `harnessAction`, the `/vrmpet3d/harness` route and the host module it called.
   */
  VrmPet3DWidget.prototype.onMenuChoice = function (id) {
    if (id === 'resetView') { this.resetView(); return; }
    if (id === 'resetSize') { this.resetSize(); return; }
    if (id === 'globalSettings') { this.openSettingsWindow('global'); return; }
    if (id === 'modelSettings') { this.openSettingsWindow('model'); return; }
    if (id === 'surface') {
      /**
       * 切换回窗口外: the pet moves into its own window.
       *
       * `petSurface` is written and pushed like every other preference, and then APPLIED rather than merely
       * stored: this is the one preference that decides which surfaces exist at all, so `applySurface` is what
       * starts the window (`POST /vrmpet3d/desktop`). Without it the entry would only take effect on the next
       * reload — a switch that reports success and moves nothing.
       */
      this.preferences.petSurface = 'window';
      this.writeStorage();
      this.applySurface('loud');
      return;
    }
    /**
     * 重力: this pet's own physics switch, and the state it flips is this surface's alone.
     *
     * Toggled rather than set, because the entry is a SWITCH and the menu's check mark is the only place its
     * state is shown; the label itself stays 重力 so the two states are the same row.
     */
    if (id === 'gravity') { this.setGravity(this.preferences.gravity !== true); return; }
    /**
     * 隐藏宠物: the pet goes away until 显示宠物 — the button in DSH's bottom-right corner — is pressed.
     *
     * This row was 关闭宠物 until 2026-10-12, which read as "quit" rather than "hide" (operator: 「内置宠物的
     * '关闭宠物'改成'隐藏宠物'」). The restore button is the reason hiding is not a one-way door: a hidden pet
     * cannot be right-clicked, so its own menu cannot be the way back.
     */
    if (id === 'closePet') { this.setHidden(true); return; }
  };

  /**
   * Set this surface's 重力, and APPLY it.
   *
   * The preference is what survives a reload; `placement.throwEnabled` is what makes it true this frame. Both
   * are written here because they are one decision: a menu that flipped the preference and left the physics
   * alone would look like a switch that does nothing until the next reload.
   *
   * OFF also ends a fall that is ALREADY in progress, which is the difference between "no new throws" and "no
   * gravity": a pet frozen in mid-air would be a pet stuck in mid-air. It keeps the position it had reached.
   */
  VrmPet3DWidget.prototype.setGravity = function (enabled) {
    this.preferences.gravity = enabled === true;
    this.writeStorage();
    this.applyGravity();
  };

  /**
   * Push this surface's 重力 into the placement.
   *
   * Called from every path that can change the preference — the menu, a host snapshot, a local storage write —
   * so there is ONE place that decides what the physics does, and it reads the key that belongs to this
   * surface. The window's copy of this method reads `windowGravity` instead; neither can reach the other.
   */
  VrmPet3DWidget.prototype.applyGravity = function () {
    if (!this.placement) return;
    var enabled = this.preferences.gravity !== false;
    this.placement.throwEnabled = enabled;
    if (!enabled && typeof this.placement.endFall === 'function') this.placement.endFall();
  };

  /**
   * 重置视角: the camera, and nothing else.
   *
   * Deliberately NOT `reset()`, which is the old panel's 重置 button and clears EVERY preference. A user who has
   * just turned the pet around wants its angle back, not their motion map, their part labels and their speech
   * settings thrown away.
   */
  VrmPet3DWidget.prototype.resetView = function () {
    var defaults = this.core.DEFAULTS || {};
    this.preferences.viewYaw = defaults.viewYaw || 0;
    this.preferences.viewPitch = defaults.viewPitch || 0;
    this.writeStorage();
    if (this.scene) this.scene.applyPreferences(this.preferences);
  };

  VrmPet3DWidget.prototype.setHidden = function (hidden) {
    this.preferences.hidden = hidden;
    this.writeStorage();
    this.applyPlacement();
  };

  VrmPet3DWidget.prototype.reset = function () {
    var scope = this.preferences.scope;
    var modelId = this.preferences.modelId;
    this.preferences = this.core.cleanPreferences({ scope: scope, modelId: modelId });
    this.machine.sleepAfterMs = this.preferences.sleepAfterMs;
    // A reset is a fresh start for the pet's voice too: no half-held remark from before, and no memory of
    // which event it last spoke for.
    if (this.speech) this.speech.clear();
    this.renderSpeech(null);
    this.writeStorage();
    this.syncControls();
    this.applyPlacement();
    if (this.scene) this.scene.applyPreferences(this.preferences);
    // Reset clears the map too, so the scene has to be told the clips the user
    // just discarded are no longer wanted.
    this.applyMotions();
  };

  // ---- placement -----------------------------------------------------------

  VrmPet3DWidget.prototype.applyPlacement = function () {
    this.placement.preferences = this.preferences;
    this.placement.setSize(BASE_PET_WIDTH, BASE_PET_HEIGHT);
    this.placement.clampToViewport();
    var pixels = this.placement.pixels();
    this.pet.style.left = pixels.left + 'px';
    this.pet.style.top = pixels.top + 'px';
    this.pet.style.width = this.placement.width + 'px';
    this.pet.style.height = this.placement.height + 'px';
    this.pet.hidden = this.preferences.hidden === true;
    this.restore.hidden = this.preferences.hidden !== true;
    if (!this.preferences.hidden) this.restore.hidden = true;
    // The canvas follows the slot. Without this the CSS box grew while the drawing
    // buffer did not, so a zoomed pet was the same render stretched by the browser —
    // soft, and with the camera still framed for the old size. Guarded on the size
    // because this runs on every pointer move during a drag.
    if (this.scene) {
      var changed = !this.sceneSize
        || this.sceneSize.width !== this.placement.width
        || this.sceneSize.height !== this.placement.height;
      if (changed) {
        this.sceneSize = { width: this.placement.width, height: this.placement.height };
        this.scene.resize(this.placement.width, this.placement.height);
      }
      this.scene.setPlacement(this.placement.x, this.placement.y, 0);
    }
  };

  /**
   * One wheel notch: scale the pet, then persist and re-frame it.
   *
   * Multiplicative rather than additive so a notch feels the same at 14% and at 200%, and clamped to
   * the FRAME's own limits (`Placement.zoomLimits`): a long edge of at least 40 px and at most the
   * frame's shortest edge. `core.SIZE_RANGE` is only the storage sanity bound now — clamping to it
   * here is what made the pet able to grow past the screen on a laptop and unable to shrink below
   * 80 px at all.
   */
  VrmPet3DWidget.prototype.zoomBy = function (direction) {
    var step = this.core.WHEEL_ZOOM_STEP || 1.12;
    var range = this.placement.zoomLimits(BASE_PET_WIDTH, BASE_PET_HEIGHT);
    var next = this.preferences.size * (direction > 0 ? step : 1 / step);
    next = Math.round(Math.min(range.max, Math.max(range.min, next)));
    if (next === Math.round(this.preferences.size)) return;
    this.preferences.size = next;
    this.writeStorage();
    this.applyPlacement();
  };

  /**
   * Is this pointer over the prompt above the pet's head?
   *
   * Measured from the DOM rather than assumed: the prompt's size changes with the state, the settings and the
   * model, so its rectangle is the only honest answer — and `placeHeadStatus` has just positioned it.
   */
  VrmPet3DWidget.prototype.isPointerOverStatus = function (event) {
    var node = this.statusNode;
    if (!node || node.hidden) return false;
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    if (typeof node.getBoundingClientRect !== 'function') return false;
    var rect = node.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };

  /**
   * One wheel notch on the TEXT: this model's correction, and never the pet's size.
   *
   * The operator's "鼠标滚轮在提示文字上时，只缩放状态提示文字（防止某些模型和提示文字不匹配）". The correction
   * is stored per model (`statusScale`), because a prompt that reads wrong at the derived size is a property of
   * the model — a chibi whose head is half its height, a tall model with a small head — and it has to come
   * back when that model is loaded again.
   *
   * The status key is cleared so the next frame rewrites the line and re-measures the box; the pet's own size
   * is untouched, which is the whole difference from `zoomBy`.
   */
  VrmPet3DWidget.prototype.stepStatusScale = function (direction) {
    var core = this.core;
    if (!core || typeof core.statusScaleStep !== 'function') return;
    var modelId = this.currentModelId();
    var next = core.statusScaleStep(this.preferences, modelId, direction);
    if (!next) return;
    this.preferences.statusScale = next;
    this.headStatusKey = null;
    this.writeStorage();
  };

  /** Put the size (and the per-model scale) back to the shipped defaults. */
  VrmPet3DWidget.prototype.resetSize = function () {
    this.preferences.size = this.core.DEFAULTS.size;
    this.preferences.modelScale = this.core.DEFAULTS.modelScale;
    this.writeStorage();
    this.applyPlacement();
  };

  VrmPet3DWidget.prototype.bindViewport = function () {
    var self = this;
    var update = function () {
      self.placement.setViewport(
        self.document.defaultView.innerWidth,
        self.document.defaultView.innerHeight
      );
      self.placement.clampToViewport();
      self.applyPlacement();
      // An open MENU is placed in viewport pixels, so a resize can strand it — off the new frame entirely, if
      // the window shrank. Closing it is the honest answer: the point it was opened at no longer exists.
      if (self.menu && self.menu.isOpen()) self.closeMenu();
      if (self.scene) {
        var pixels = self.placement.pixels();
        self.scene.resize(self.placement.width, self.placement.height);
        self.scene.setPlacement(self.placement.x, self.placement.y, 0);
      }
    };
    this.onResize = update;
    this.document.defaultView.addEventListener('resize', update);

    /**
     * Stop looking when the cursor leaves the window.
     *
     * Now that the aim spans the whole window, the last position is only meaningful while
     * the cursor is actually there: without this the pet would keep its head turned
     * towards wherever the cursor happened to exit — and would still be doing it after an
     * alt-tab — because no further pointer events arrive to correct it.
     *
     * `mouseleave` on the root element is the window exit; `blur` covers the app losing
     * focus while the cursor stays put. Neither bubbles, so both are bound directly.
     */
    var leave = function () {
      self.pointer = null;
      if (self.scene) self.scene.motion.setGaze(null);
    };
    this.document.documentElement.addEventListener('mouseleave', leave);
    this.document.defaultView.addEventListener('blur', leave);

    update();
  };

  // ---- the pet's own window ------------------------------------------------

  /**
   * Start or stop the always-on-top window that lives outside the app.
   *
   * Asked of the host, not done here: a window is a process, and only the host half may start
   * one (the client half runs in the app renderer with no such ability — see HANDOFF §12).
   *
   * Every outcome is REPORTED. The request can fail for reasons the user can act on — the
   * installation is on a volume that cannot be hard-linked into, there is no Electron to
   * borrow, the launcher died on start — and a switch that silently does nothing teaches the
   * user that the feature is broken rather than why it is unavailable.
   */
  /**
   * Show or hide the pet inside the app, without touching the stored `hidden` preference.
   *
   * `hidden` is the user's own switch and is remembered; this is the launcher's answer to 'the window has
   * the pet, so this copy must not draw a second one'. Storing it would mean that a session which falls
   * back to the web (no Electron) could never show the pet again.
   */
  VrmPet3DWidget.prototype.showInAppPet = function (shown) {
    this.surfaceHidden = shown !== true;
    if (!this.pet) return;
    this.pet.style.visibility = shown === true ? '' : 'hidden';
    // The menu stays usable either way: it is how somebody turns the window back off.
  };

  /**
   * Decide where the pet lives, and make it so.
   *
   * `auto` (the default) prefers the standalone window and falls back to the in-app pet: the window is what
   * a desktop pet is FOR, and the in-app copy is the web build's answer, not the other way round. The
   * fallback is a failed start rather than a guess about the host, so a Desktop session whose runtime is
   * missing lands on the in-app pet too, with the reason on screen.
   *
   * `both` is the DEBUG mode (`core.PET_SURFACES`): the window AND the in-app copy, so the two renderers can
   * be watched side by side. It starts the window exactly as `auto` does and simply never hides this copy —
   * so a host that cannot open a window still leaves a pet on screen, which is the state `auto` falls back to.
   */
  VrmPet3DWidget.prototype.applySurface = function (attempt) {
    var self = this;
    var strings = STRINGS[this.language] || STRINGS.en;
    var surface = this.preferences.petSurface || 'auto';
    /**
     * What was last ASKED for, which is not the same as what is running: the window can fail to start. It is
     * what lets a surface change that arrives from the settings store (see `adoptSurface`) be told apart from
     * the value this widget already applied, so an unchanged snapshot does not re-spawn a window on every poll.
     */
    this.appliedSurface = surface;
    if (surface === 'app') {
      this.showInAppPet(true);
      return this.setDesktopWindow(false);
    }
    if (surface === 'both') {
      this.showInAppPet(true);
      return this.setDesktopWindow(true).then(function (status) {
        var running = Boolean(status && status.running);
        if (!running && attempt !== 'quiet') {
          // The in-app pet is up either way — this is the note that says the OTHER one is not.
          self.syncDesktop(null, strings.desktopUnavailable);
        }
        return status;
      });
    }
    return this.setDesktopWindow(true).then(function (status) {
      var running = Boolean(status && status.running);
      self.showInAppPet(!running);
      if (!running && attempt !== 'quiet') {
        // No Electron, or no runtime to borrow: say so once, then stay the in-app pet.
        self.syncDesktop(null, strings.desktopUnavailable);
      }
      return status;
    });
  };

  /**
   * Adopt a `petSurface` that arrived from somewhere else — the settings window, or another document.
   *
   * Every other preference is a value the SCENE re-applies, so the two follow-the-store paths below can hand
   * them to `scene.applyPreferences` and be done. This one decides which surfaces exist at all: it has to
   * reach the launcher (`POST /vrmpet3d/desktop`) rather than the renderer. Without this, turning 调试模式 on in
   * the settings window started the window only after a page reload, and turning it off left the window up —
   * the switch appeared to do nothing, which is worse than not offering it.
   */
  VrmPet3DWidget.prototype.adoptSurface = function () {
    var surface = this.preferences.petSurface || 'auto';
    if (this.appliedSurface === surface) return;
    this.applySurface('quiet');
  };

  VrmPet3DWidget.prototype.setDesktopWindow = function (enabled) {
    var self = this;
    var strings = STRINGS[this.language] || STRINGS.en;
    this.syncDesktop(null, strings.desktopStarting);
    return fetch('/vrmpet3d/desktop', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: enabled ? 'enable' : 'disable',
        modelId: this.currentModelId(),
      }),
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok) throw new Error((payload && payload.error) || ('HTTP ' + response.status));
        return payload;
      });
    }).then(function (status) {
      self.syncDesktop(status, null);
      return status;
    }).catch(function (error) {
      self.syncDesktop(null, error && error.message ? error.message : String(error));
      return null;
    });
  };

  /** Ask the host what the window is doing, and show it. */
  VrmPet3DWidget.prototype.refreshDesktopStatus = function () {
    var self = this;
    return fetch('/vrmpet3d/desktop', { credentials: 'omit' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (status) { self.syncDesktop(status, null); return status; })
      .catch(function () {
        // A session without the route (an older host half) is RECORDED rather than thrown: `desktopNote` is kept
        // as data (see `syncDesktop`), so "the window could not start" stays answerable.
        var strings = STRINGS[self.language] || STRINGS.en;
        self.syncDesktop(null, strings.desktopUnavailable);
        return null;
      });
  };

  /**
   * Remember what the host says the floating window is doing.
   *
   * It used to be written into the panel's switch and its note line. Both are gone — this pet's 切换回窗口外
   * entry and the window's own 切换回窗口内 write `petSurface` now (with 调试模式 on the 通用设置 page writing
   * `both`/`auto`) — and the note has no row to live in, so the host's answer is kept as DATA and published with
   * the widget's own state. "The window is up but the pet is not drawing in it" stays answerable that way, which
   * is the whole reason the host reports the page's own verdict.
   */
  VrmPet3DWidget.prototype.syncDesktop = function (status, note) {
    var strings = STRINGS[this.language] || STRINGS.en;
    this.desktopStatus = status || null;
    if (note) {
      this.desktopNote = note;
      return;
    }
    if (!status) {
      this.desktopNote = null;
      return;
    }
    if (status.state === 'running') {
      if (status.page && status.page.webgl2 === false) {
        var detail = status.page.errors && status.page.errors.length ? ' ' + status.page.errors.join('; ') : '';
        this.desktopNote = strings.desktopNoRender + detail;
        return;
      }
      if (!status.page) {
        this.desktopNote = strings.desktopStarting;
        return;
      }
      this.desktopNote = status.externalRuntime ? strings.desktopRunningExternal : strings.desktopRunning;
      return;
    }
    this.desktopNote = status.state === 'failed'
      ? strings.desktopFailed + ' ' + (status.lastError || '')
      : strings.desktopOff;
  };

  // ---- pointer -------------------------------------------------------------

  /**
   * The press bounds, with a stand-in for a core chunk that predates them.
   *
   * A cached `client.core.js` must cost the FEATURE and not the pet — the lesson of the 2026-10-11 freeze,
   * where an optional symbol the app assumed took the whole widget down. These numbers are duplicated here on
   * purpose: they are what a stale chunk falls back to, and they are the ones `core.PRESS_LIMITS` ships.
   */
  var PRESS_LIMITS_FALLBACK = { moveThreshold: 4, holdSeconds: 0.6 };

  /**
   * React to a press, tell the host where it landed, and let the part say something.
   *
   * One function for the three call sites (click, long press, drag crossing) so none of them can forget the
   * other halves: the reaction is the pet's own business, the part is what makes "I clicked its ear" answerable
   * from outside the page, and the third is the remark the user configured for THAT part (2026-10-11). The
   * machine owns the throttle — a rapid series of clicks speaks once per `PRESS_LIMITS.reactGapSeconds` — so
   * nothing here counts presses.
   */
  VrmPet3DWidget.prototype.notePress = function (reason, part) {
    if (this.scene) this.scene.noteInteraction(reason, part);
    var item = part && typeof part === 'object' ? part.part || null : null;
    this.pendingTouch = {
      reason: reason,
      part: item ? item.id : null,
      label: item ? item.label : null,
      region: (part && part.region) || null,
      bone: (part && part.bone) || null,
      mesh: (part && part.mesh) || null,
      // The spring chain the press grabbed, when it grabbed one (`{ key, name, label, joints }`): the readout then
      // says "its twintail" instead of only the rig's own joint name.
      chain: (part && part.chain) || null,
      at: Date.now(),
    };
    /**
     * A DRAG is not a remark: the pet is being carried, and the user's own lines for a part are about being
     * TOUCHED. Only the click and the long press speak — which is what makes the two gestures worth telling
     * apart in the settings.
     */
    if (item && (reason === 'click' || reason === 'hold')) this.reactSpeech(part);
    return this.pendingTouch;
  };

  /**
   * Say the part's line, and ask the host for one when the source is AI.
   *
   * The ANATOMY travels, not just the part: in AI mode the host is told what was touched (`leftEye`, `LiuHai`, or
   * a mesh name nothing claims) so it can write a line about it even when the part has no prompt of its own —
   * the operator's request of 2026-10-11. The state event in force is the last step of the chain, and the machine
   * owns both the throttle and the decision to ask at all (see `SpeechMachine.react`).
   */
  VrmPet3DWidget.prototype.reactSpeech = function (anatomy) {
    if (!this.speech) return null;
    var random = this.scene && typeof this.scene.random === 'function' ? this.scene.random : null;
    var line = this.speech.react(this.preferences, anatomy, this.speechEvent || 'idle', this.language, random);
    this.pumpSpeechAi();
    return line;
  };

  VrmPet3DWidget.prototype.pressLimits = function () {
    var limits = this.core && this.core.PRESS_LIMITS;
    return limits && Number.isFinite(limits.moveThreshold) && Number.isFinite(limits.holdSeconds)
      ? limits
      : PRESS_LIMITS_FALLBACK;
  };

  /**
   * WHERE a press landed on the model, or null when there is nothing to measure with.
   *
   * The conversion is the whole of it: a pointer event carries VIEWPORT coordinates and the scene's raycast
   * wants canvas-local ones. `getBoundingClientRect()` is the honest source, because the canvas is scaled by
   * the frame and by the device pixel ratio — and the raycast normalizes by `clientWidth`, so both cancel out.
   *
   * A scene without `anatomyAt` (an older cached chunk) costs the PART reaction and nothing else: the pet still
   * greets, drags and holds.
   */
  VrmPet3DWidget.prototype.anatomyAt = function (clientX, clientY) {
    if (!this.canvas || !this.scene || typeof this.scene.anatomyAt !== 'function') return null;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    if (typeof this.canvas.getBoundingClientRect !== 'function') return null;
    var rect = this.canvas.getBoundingClientRect();
    return this.scene.anatomyAt(clientX - rect.left, clientY - rect.top);
  };

  VrmPet3DWidget.prototype.onPointerDown = function (event) {
    // Secondary button: begin a possible VIEW ORBIT. Whether this turns out to be an
    // orbit or a plain right-click (which opens the MENU) is decided by movement, on
    // release — see onPointerMove and the contextmenu listener. Clearing the suppress
    // flag here is what stops a drag that produced no contextmenu event from
    // swallowing the NEXT right-click.
    if (event.button === 2) {
      this.suppressContextMenu = false;
      // Whether THIS press has already produced a menu. Two events can be the click — the release and the
      // platform's own menu event — and whichever arrives first opens it; this is what stops the second one
      // from opening it again a moment later at a different point.
      this.secondaryMenuOpened = false;
      this.viewDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      try { this.pet.setPointerCapture(event.pointerId); } catch (error) { /* not supported */ }
      // The capture is a convenience, not the mechanism: the WINDOW listeners are what make a pointer that
      // leaves the pet's little frame keep turning the view and still release it (2026-10-09).
      this.beginWindowGesture();
      /**
       * The pointer lock is NOT requested here, and that was a real bug — the reason the operator's menu never
       * appeared (2026-10-12: 「右键依然无法弹出菜单」, and their own diagnosis: 「右键现在是旋转功能，位置也被
       * 锁定了…有点像3D游戏中锁定光标」).
       *
       * Locking on the PRESS means a plain right-click hides and freezes the cursor before anybody knows
       * whether the user wanted to turn the view — and once locked, `clientX`/`clientY` stop moving while
       * `movementX`/`movementY` keep arriving, so the smallest tremor accumulates into an orbit, which then
       * suppresses the menu event. A cursor that has been captured also looks exactly like a broken pet.
       *
       * The lock is still what makes a long orbit survivable (see `requestOrbitLock`): it is requested the
       * moment the press ACTUALLY becomes an orbit, in `onPointerMove` below, and released on the release.
       */
      this.pet.setAttribute('data-orbiting', 'false');
      // Deliberately NOT `preventDefault()` here. The press may still turn out to be a
      // plain right-click, and swallowing the pointer event is how the pet's own MENU
      // stops opening on a platform that derives the menu event from it. The contextmenu
      // listener is where OUR menu is suppressed, and only when the pointer moved.
      return;
    }
    if (event.button !== undefined && event.button !== 0) return;
    // Re-entrancy guard: a second pointer (or a stale drag that never ended) must
    // not inherit the grab offset of the one already in progress.
    if (this.placement.dragging) return;
    this.dragPointerId = event.pointerId;
    /**
     * A PRESS is not yet a drag and not yet a click.
     *
     * `core.PRESS_LIMITS` decides what it becomes, and the two bounds answer two different questions:
     * wandering more than a few pixels makes it a DRAG (the reaction fires at that moment and the pet starts
     * following), and staying put for long enough makes it a 长按 (fires WHILE the pointer is still down,
     * because a pat that reacts only after you let go reads as a late click). A press that does neither is a
     * click, decided on release.
     *
     * That is what a shaky hand needs: the old rule called ANY movement a drag, so a click that wobbled by one
     * pixel never greeted anything, and the click reaction was unreachable for anyone whose hand is not still.
     */
    var self = this;
    var limits = this.pressLimits();
    var press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      /** Which part of the model the press landed on, measured ONCE — the answer cannot change while it is held. */
      part: this.anatomyAt(event.clientX, event.clientY),
      moved: false,
      held: false,
      timer: null,
    };
    press.timer = setTimeout(function () {
      // The press may already be over (or replaced by a newer one); a stale timer must not react.
      if (self.press !== press || press.moved || !self.scene) return;
      press.held = true;
      self.notePress('hold', press.part);
    }, Math.round(limits.holdSeconds * 1000));
    this.press = press;
    try { this.pet.setPointerCapture(event.pointerId); } catch (error) { /* not supported */ }
    this.beginWindowGesture();
    this.placement.beginDrag(event.clientX, event.clientY);
    // A fresh grab starts from a standstill: no leftover velocity from the previous drag.
    this.dragMotionState = { at: undefined, x: 0, y: 0, vx: 0, vy: 0 };
    if (this.scene && typeof this.scene.setDragMotion === 'function') this.scene.setDragMotion(0, 0);
    this.pet.setAttribute('data-dragging', 'true');
    this.machine.setInteraction('held');
    this.machine.setDeferral(true);
    this.movePointer(event.clientX, event.clientY);
  };

  VrmPet3DWidget.prototype.onPointerMove = function (event) {
    /**
     * The BUTTON STATE is the honest test for whether a gesture is still alive.
     *
     * A pointerup that never arrives — the pointer left the frame and the release happened somewhere that
     * silenced it, which is the report this exists for — used to leave the pet latched: still orbiting, still
     * "held". The event says whether the button is still down, so a stale gesture ends on the next move
     * instead of waiting for a release that is not coming. `buttons` is undefined on a synthetic event, which
     * is treated as "unknown" rather than as "released".
     */
    if (this.viewDrag && typeof event.buttons === 'number' && (event.buttons & 2) === 0) {
      this.onPointerUp(event);
      return;
    }
    if (this.placement.dragging && typeof event.buttons === 'number' && (event.buttons & 1) === 0) {
      this.onPointerUp(event);
      return;
    }
    // The listener is on the document, so it sees pointers this widget never
    // claimed — another widget's, or a second finger. Only the owning pointer moves
    // this pet.
    if (this.viewDrag && event.pointerId === this.viewDrag.id) {
      /**
       * WHILE LOCKED, the orbit runs on the DELTAS the lock reports.
       *
       * `clientX`/`clientY` stop changing the moment the pointer is locked — that is what "位置锁定" means —
       * so the difference between them is always zero and the view would freeze. `movementX`/`movementY` are
       * the same "how far did the mouse move" signal a game reads, and they keep arriving wherever the
       * physical mouse goes, which is exactly what the operator asked for (2026-10-09 late).
       */
      var dx;
      var dy;
      if (this.pointerLocked && typeof event.movementX === 'number') {
        dx = event.movementX;
        dy = typeof event.movementY === 'number' ? event.movementY : 0;
      } else {
        dx = event.clientX - this.viewDrag.x;
        dy = event.clientY - this.viewDrag.y;
      }
      if (!this.viewDrag.moved && Math.abs(dx) + Math.abs(dy) < VIEW_DRAG_THRESHOLD) {
        this.movePointer(event.clientX, event.clientY);
        return;
      }
      if (!this.viewDrag.moved) {
        /**
         * THE MOMENT IT BECOMES AN ORBIT — and therefore the moment to take the pointer lock.
         *
         * The press has now travelled far enough that it cannot be a click, so the user is turning the view and
         * a cursor that cannot leave the frame is a help rather than a hijack. Requesting it here instead of on
         * the press is the whole fix for 「右键无法弹出菜单」: a plain right-click never touches the lock, so the
         * cursor is not captured, `clientX`/`clientY` keep flowing, and the platform's `contextmenu` arrives
         * normally. A refused lock still changes nothing — everything below works off the window listeners.
         */
        this.requestOrbitLock();
      }
      this.viewDrag.moved = true;
      // The stored position is only meaningful while unlocked; under lock it is frozen and keeping it up to
      // date would make the first move after unlocking jump by however far the mouse travelled.
      if (!this.pointerLocked) {
        this.viewDrag.x = event.clientX;
        this.viewDrag.y = event.clientY;
      }
      this.pet.setAttribute('data-orbiting', 'true');
      this.orbitBy(dx, dy);
      return;
    }
    if (this.placement.dragging && event.pointerId === this.dragPointerId) {
      /**
       * THE PRESS HAS TO WANDER BEFORE IT IS A DRAG.
       *
       * Below `PRESS_LIMITS.moveThreshold` the press is still a candidate CLICK: the pet does not move at all
       * and the drag reaction does not fire, which is what makes a click with a shaky hand a click. Crossing
       * the threshold is the moment the drag begins and the reaction fires — the operator's earlier report
       * ("it should switch as soon as the press starts to move, not after the drag ends") still holds, it just
       * means the press really moved.
       */
      var press = this.press;
      if (press && !press.moved && press.id === event.pointerId) {
        // Both axes, summed: a hand shakes diagonally, and the secondary button's own test reads the same way.
        var travelled = Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y);
        if (travelled < this.pressLimits().moveThreshold) return;
        press.moved = true;
        /**
         * The grab is anchored at the ORIGINAL press point, so the pet catches up to the pointer in one step
         * instead of lagging behind it for the rest of the drag. What the threshold absorbed was the JITTER —
         * the pet did not move at all while the press stayed inside it — and not the movement: `moveDrag` below
         * then moves it by the whole vector from where the press began.
         */
        this.placement.beginDrag(press.x, press.y);
      }
      this.dragMoved = true;
      // FIRE THE REACTION NOW, at the moment it becomes a drag, not on release.
      //
      // The user's report: "the expression and animation while dragging are wrong — it should switch
      // as soon as the press starts to move, not after the drag ends". It was fired on pointer-up, by
      // which time the pet is already falling and the drag reaction reads as a landing reaction. One
      // shot per drag (`dragReactionFired`), so a long drag does not restart the emotion on every move.
      if (!this.dragReactionFired) {
        this.dragReactionFired = true;
        this.notePress('drag', (press && press.part) || null);
      }
      this.placement.moveDrag(event.clientX, event.clientY);
      // Feed the scene the drag VELOCITY, exactly as the floating window's page does: the pet is
      // carried by its slot here and by its window there, and in both cases the model's own world
      // position never changes — so without this the spring bones see a pet that is standing still and
      // the hair stays rigid while it is dragged.
      this.reportDragMotion(event.clientX, event.clientY);
      // Write the new position to the DOM RIGHT HERE. This line is the whole of
      // the "the model does not move while dragged, then jumps to the pointer on
      // release" report: `moveDrag` only updated the fractional placement, and the
      // only call that ever pushed it to CSS was the one in `tick`'s landing
      // branch — so nothing moved until the throw had finished, and then the pet
      // appeared at wherever the pointer had left it.
      this.applyPlacement();
    }
    this.movePointer(event.clientX, event.clientY);
  };

  /**
   * Turn a drag pointer position into a velocity for the scene, smoothed, in pixels per second.
   *
   * Pointer events arrive faster and less regularly than frames, so one delta is a noisy number and
   * feeding it raw makes the hair twitch. A short exponential average is what "the pet is moving this
   * way, this fast" needs, and `Scene.setDragMotion` turns it into the body lag the springs react to.
   */
  VrmPet3DWidget.prototype.reportDragMotion = function (x, y) {
    if (!this.scene || typeof this.scene.setDragMotion !== 'function') return;
    var view = this.document.defaultView;
    var now = view && view.performance && view.performance.now ? view.performance.now() : Date.now();
    var drag = this.dragMotionState || (this.dragMotionState = { at: undefined, x: 0, y: 0, vx: 0, vy: 0 });
    if (drag.at === undefined) {
      drag.at = now;
      drag.x = x;
      drag.y = y;
      this.scene.setDragMotion(0, 0);
      return;
    }
    var elapsed = now - drag.at;
    if (elapsed < 4) return;
    var instantX = (x - drag.x) / (elapsed / 1000);
    var instantY = (y - drag.y) / (elapsed / 1000);
    drag.vx = drag.vx * 0.65 + instantX * 0.35;
    drag.vy = drag.vy * 0.65 + instantY * 0.35;
    drag.at = now;
    drag.x = x;
    drag.y = y;
    this.scene.setDragMotion(drag.vx, drag.vy);
  };

  /**
   * Turn the FALL into motion for the model, the same way a drag does.
   *
   * A fall is the drag's twin: the pet's own world position inside the canvas never changes — the slot it lives in
   * is what moves — so the spring bones see a model standing perfectly still while the pet flies across the screen,
   * and the hair hangs rigid. `setDragMotion` is the channel that puts that motion back, and it is deliberately the
   * SAME one the drag uses rather than a second mechanism: one number ("how fast is the pet moving, and which
   * way") drives both the body lag and the lean that the chains answer.
   *
   * Two unit conversions, both load-bearing:
   *   * the simulation is in VIEWPORT FRACTIONS per second, the model wants screen PIXELS per second;
   *   * `fall.vy` is positive UPWARD (`core.stepFall` does `vy -= gravity`), while `setDragMotion` takes screen
   *     coordinates, where y grows DOWNWARD. Getting this sign wrong is invisible in a symmetric fall and very
   *     visible on a bounce, where the lean would whip the wrong way.
   *
   * Called every airborne frame, so the offset follows the flight — including the apex, where the sign flips and
   * the body swings the other way, and each bounce, which flips it again. On the frame it lands, `placement.fall`
   * is already null and this writes zero, which is what makes the trailing pose settle rather than snap.
   */
  VrmPet3DWidget.prototype.reportFallMotion = function () {
    if (!this.scene || typeof this.scene.setDragMotion !== 'function') return;
    var fall = this.placement.fall;
    if (!fall) {
      this.scene.setDragMotion(0, 0);
      return;
    }
    var width = this.placement.viewportWidth || 1;
    var height = this.placement.viewportHeight || 1;
    this.scene.setDragMotion((fall.vx || 0) * width, -(fall.vy || 0) * height);
  };

  VrmPet3DWidget.prototype.onPointerUp = function (event) {
    if (this.viewDrag
      && (event === undefined || event.pointerId === undefined || event.pointerId === this.viewDrag.id)) {
      if (event && event.pointerId !== undefined) {
        try { this.pet.releasePointerCapture(event.pointerId); } catch (error) { /* already gone */ }
      }
      /**
       * THE RELEASE DECIDES whether a secondary press was a click or a drag — not the platform's menu event,
       * and this is the app pet's half of the lesson the floating window had already learned.
       *
       * That window opens its menu in exactly this place (`onPointerUp` in `lib/desktop-page.js`), which is why
       * its right-click worked while this one did not (operator, 2026-10-12: 「右键依然无法弹出菜单」). Deciding
       * here depends on nothing but events we generate ourselves: a `contextmenu` that a host page, an Electron
       * shell or a pointer lock withholds can no longer cost the menu, and there is no "swallow the next menu
       * event" flag in the way, because there is no menu event to swallow.
       *
       * `finishOrbit` still arms `suppressContextMenu` for a real drag, so the platform's own menu event — which
       * does arrive on most platforms, after the release — cannot open a menu over the view that was just turned.
       */
      var orbited = this.viewDrag.moved === true;
      var at = event ? { x: event.clientX, y: event.clientY } : null;
      /**
       * A CANCELLED gesture is not a click. `pointercancel` arrives when the platform takes the pointer away
       * (a touch that turned into a scroll, a window that lost the device), and it runs through this same
       * handler because it is the same "the press is over" signal. Opening the menu for it would pop it up on a
       * gesture the user never completed, so it ends the orbit and nothing else.
       */
      var cancelled = Boolean(event && event.type === 'pointercancel');
      this.finishOrbit();
      if (!orbited && !cancelled && at) {
        this.secondaryMenuOpened = true;
        this.openMenuAt(at.x, at.y);
      }
      return;
    }
    if (this.placement.dragging && event && event.pointerId !== undefined
      && this.dragPointerId !== undefined && event.pointerId !== this.dragPointerId) {
      return;
    }
    if (this.placement.dragging) {
      var press = this.press;
      this.press = null;
      // The press is over, so its long-press timer has to die with it: a timer left running would pat the pet
      // after the user let go, which is the one thing a 长按 must not do.
      if (press && press.timer) {
        clearTimeout(press.timer);
        press.timer = null;
      }
      this.dragPointerId = undefined;
      this.placement.endDrag();
      this.pet.setAttribute('data-dragging', 'false');
      this.machine.setInteraction('falling');
      /**
       * Only a press that neither WANDERED nor WAITED is a CLICK — the pet being greeted rather than picked up
       * or patted. A drag already fired its reaction when it crossed the threshold and a long press already
       * fired while the pointer was down, so firing here as well would restart the same emotion at the moment
       * the pet is dropped.
       *
       * The part measured at press time travels with the click, which is what lets a user react differently to
       * an eye than to a hand.
       */
      if (press && !press.moved && !press.held && this.scene) {
        this.notePress('click', press.part);
      }
      this.dragReactionFired = false;
      // Released: stop feeding a velocity, so the body's lag decays back to rest — that decay is the
      // hair settling rather than snapping.
      if (this.scene && typeof this.scene.setDragMotion === 'function') this.scene.setDragMotion(0, 0);
    }
    if (event && event.pointerId !== undefined) {
      try { this.pet.releasePointerCapture(event.pointerId); } catch (error) { /* already gone */ }
    }
    this.endWindowGesture();
  };

  /**
   * End an orbit that is in progress: persist the view, and keep the MENU shut.
   *
   * ONE function for every way an orbit can end — a `pointerup`, a `mouseup`, a `contextmenu` (which a
   * right-button release always produces) and the button state on the next move — so no path can forget to
   * persist the view or to suppress the menu, and none of them can leave the gesture armed.
   *
   * @param {boolean} [fromMenu] true when the release was inferred from the menu event rather than seen.
   */
  VrmPet3DWidget.prototype.finishOrbit = function (fromMenu) {
    if (!this.viewDrag) {
      this.endWindowGesture();
      this.releaseOrbitLock();
      return false;
    }
    var orbited = this.viewDrag.moved === true;
    this.viewDrag = null;
    this.pet.setAttribute('data-orbiting', 'false');
    // The lock exists for the orbit and nothing else: give the cursor back the moment the orbit is over,
    // however it ended (release, menu event, button state, Escape, window blur).
    this.releaseOrbitLock();
    if (orbited || fromMenu === true) {
      // Persist once, on release: the orbit writes a preference per pointer move, and
      // storage is a synchronous JSON write plus a publish.
      this.writeStorage();
      // A right-DRAG is not a right-CLICK. The menu event that follows on most
      // platforms must not open the right-click MENU over the view just turned.
      this.suppressContextMenu = true;
    }
    this.endWindowGesture();
    return true;
  };

  /**
   * Abandon whatever gesture is in progress, without a drop.
   *
   * Bound to the window's `blur`: a gesture whose release happens outside this window never arrives at all,
   * and the pet would be left holding a pointer it does not have — the "未释放状态" half of the operator's
   * report. The orbit simply stops; a placement drag is ended where the pet is, which drops it from there
   * rather than leaving it stuck to the cursor for ever.
   */
  VrmPet3DWidget.prototype.cancelGesture = function () {
    // The orbit ends through the same single path as a real release, so the view is persisted once and the
    // menu stays shut — a cancelled orbit is still an orbit the user made.
    if (this.viewDrag) this.finishOrbit();
    if (this.placement.dragging) {
      this.dragPointerId = undefined;
      this.placement.endDrag();
      this.pet.setAttribute('data-dragging', 'false');
      this.machine.setInteraction('falling');
      this.dragReactionFired = false;
      if (this.scene && typeof this.scene.setDragMotion === 'function') this.scene.setDragMotion(0, 0);
    }
    // Nothing is captured any more, but a stale capture would keep retargeting events to a pet that is not
    // dragging: releasing is harmless when there is none.
    try { this.pet.releasePointerCapture(undefined); } catch (error) { /* nothing captured */ }
    this.endWindowGesture();
  };

  /**
   * Turn the camera by a pointer delta, in CSS pixels.
   *
   * The orbit is a PREFERENCE, not scene state: it survives a model switch and a
   * reload, and the scene reads it when it fits the camera. Clamped through
   * `core.VIEW_LIMITS` here as well as in `cleanPreferences`, so a long drag cannot
   * invert the view between two writes.
   */
  VrmPet3DWidget.prototype.orbitBy = function (dx, dy) {
    var limits = this.core.VIEW_LIMITS || { yaw: Math.PI, pitchMin: -0.45, pitchMax: 0.95 };
    var yaw = (this.preferences.viewYaw || 0) + dx * VIEW_YAW_PER_PIXEL;
    var pitch = (this.preferences.viewPitch || 0) + dy * VIEW_PITCH_PER_PIXEL;
    this.preferences.viewYaw = Math.min(limits.yaw, Math.max(-limits.yaw, yaw));
    this.preferences.viewPitch = Math.min(limits.pitchMax, Math.max(limits.pitchMin, pitch));
    if (this.scene) this.scene.applyPreferences(this.preferences);
  };

  /**
   * Remember where the pointer is, in VIEWPORT pixels.
   *
   * Viewport coordinates, not canvas-local ones: the listener is on the document, so
   * these arrive from anywhere in the window, and the aim is computed against the pet's
   * own centre in `tick`. Converting to canvas-local here is what used to throw the
   * outside-the-box information away — the head then had nothing to follow.
   *
   * Nothing is stored when the pointer leaves the window; see `bindViewport`.
   */
  VrmPet3DWidget.prototype.movePointer = function (clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    /**
     * A sweep ACROSS the pet is what blows its hair.
     *
     * The operator's request (2026-10-10): "增加鼠标在模型上划过时，可以随着鼠标划过的方向摆动弹簧骨结构的功能".
     * The sample is the pointer's own delta over the time since the last one, and the velocity is computed from
     * the raw event time so a slow browser cannot turn a flick into a gale.
     *
     * **There is deliberately NO "not while dragging" exclusion here any more** (it was
     * `&& !this.placement.dragging && !this.viewDrag`, with the note that a drag "already has its own effect on
     * the hair" through `setDragMotion`). That note was only half true, and it was the difference the operator
     * reported on 2026-10-12: 「外置宠物移动时头发会飘动，内置没有」. The floating window's cursor stream
     * (`onCursor` in `lib/desktop-page.js`) pushes the draught **whether or not it is dragging** — the two
     * surfaces were being fed different physics for the same gesture. Both now push it: a sweep blows the hair,
     * a drag blows it AND lags the body, and the two surfaces agree.
     */
    var previous = this.pointer;
    var now = Date.now();
    if (previous && this.scene && typeof this.scene.pushWind === 'function') {
      var dt = (now - (this.pointerAt || now)) / 1000;
      // "Over the model" means over the pet's own box: this half listens on the DOCUMENT (the aim has to work
      // from anywhere in the window), so without this test a sweep past the app would blow hair from a distance.
      var box = this.placement.pixels();
      var over = clientX >= box.left && clientX <= box.left + this.placement.width
        && clientY >= box.top && clientY <= box.top + this.placement.height;
      if (over && dt > 0 && dt < 0.2) {
        this.scene.pushWind({
          dx: clientX - previous.x,
          dy: clientY - previous.y,
          dt: dt,
          // The wind must blow the way the user SAW the sweep, so the orbit is undone by the same yaw the
          // camera is turned through.
          viewYaw: Number(this.preferences.viewYaw) || 0,
          // …and canvas pixels, because the draught is LOCAL: the scene measures each joint's distance from
          // this point to decide how much of the force that joint gets.
          x: clientX - box.left,
          y: clientY - box.top,
        });
      }
    }
    this.pointer = { x: clientX, y: clientY };
    this.pointerAt = now;
  };

  VrmPet3DWidget.prototype.greet = function () {
    this.machine.greet();
  };

  // ---- scene ---------------------------------------------------------------

  /** Create the WebGL scene on the slot's canvas. */
  VrmPet3DWidget.prototype.initScene = function () {
    if (this.scene || this.disposed) return;
    var self = this;
    this.scene = new this.sceneApi.Scene(this.canvas, {
      assetBase: '/vrmpet3d/asset',
      preferences: this.preferences,
      onError: function (message) {
        self.showStatus(message);
      }
    });
    this.scene.resize(this.placement.width, this.placement.height);
    this.scene.setPlacement(this.placement.x, this.placement.y, 0);
    this.scene.applyPreferences(this.preferences);
    this.scene.onError = function (message) { self.showStatus(message); };
  };

  /**
   * Resolve the model catalog from the host and load the selected model.
   * A failure at any step leaves the built-in placeholder in place and reports
   * the reason in the badge rather than leaving an empty box.
   */
  VrmPet3DWidget.prototype.refreshCatalog = function () {
    var self = this;
    return fetch('/vrmpet3d/catalog', { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('catalog route returned HTTP ' + response.status);
        return response.json();
      })
      .then(function (body) {
        self.catalog = body;
        return body;
      })
      .catch(function (error) {
        self.catalog = { models: [] };
        self.showStatus(errorText(error));
        return null;
      });
  };

  /**
   * The model that should be on screen right now.
   *
   * One answer for every caller — the load, the settings window's POST, the live report, the picker — so the
   * surfaces cannot disagree about which model the pet is showing. Empty means "resolve one from the catalog",
   * which is how the default became SampleModel without hard-coding a scan-order id.
   */
  VrmPet3DWidget.prototype.currentModelId = function () {
    var models = this.catalog && this.catalog.models ? this.catalog.models : [];
    if (this.core && this.core.resolveModelId) return this.core.resolveModelId(models, this.preferences.modelId);
    return this.preferences.modelId || '';
  };

  VrmPet3DWidget.prototype.loadModel = function (modelId) {
    var self = this;
    if (!this.scene) return Promise.resolve(null);
    // An empty id has nothing to load: the catalog is empty, and the status line already says so. Nothing is
    // substituted for it — that is what removing the built-in avatar means.
    if (!modelId) {
      this.loadedModelId = '';
      return Promise.resolve(null);
    }
    return this.scene.loadModel(modelId).then(function (status) {
      self.modelStatus = status;
      self.loadedModelId = status && status.ok ? modelId : '';
      if (status && !status.ok && status.error) self.showStatus(status.error);
      // The avatar's kind decides which motion formats can even be offered, and
      // it invalidates every clip already built — a clip binds to a skeleton —
      // so the picker and the scene are both refreshed on every model change.
      return self.afterAvatarChange().then(function () { return status; });
    });
  };

  // ---- authored motion -----------------------------------------------------

  /**
   * Read the motion catalog.
   *
   * A missing route is an EXPECTED situation, not a failure: the running
   * composition may have no `webServer` service at all, exactly as with the
   * model catalog. So this resolves to null and lets `refreshMotionNotice`
   * explain, and it deliberately does not push anything into the pet's status
   * badge — the pet itself is perfectly fine without authored motion.
   */
  VrmPet3DWidget.prototype.refreshMotions = function () {
    var self = this;
    return fetch('/vrmpet3d/motions', { credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('motion catalog route returned HTTP ' + response.status);
        return response.json();
      })
      .then(function (body) {
        self.motionCatalog = body && Array.isArray(body.motions) ? body : { motions: [] };
        return self.applyMotions();
      })
      .catch(function () {
        self.motionCatalog = null;
        return self.applyMotions().then(function () { return null; });
      });
  };

  /**
   * The one format an avatar kind can be driven by.
   *
   * This is the rule users get wrong, so it is written down once and nowhere else:
   *
   *   * a `.vrma` addresses VRM humanoid bones through `VRMC_vrm_animation`, so only
   *     a VRM has a rig it can bind to;
   *   * nothing else can be driven by an authored clip at all — a plain glTF has no
   *     humanoid contract, so the honest answer is to offer nothing and say why. The
   *     third case that used to be here (a `.vmd` driving an MMD avatar) went with MMD
   *     support on 2026-10-12.
   *
   * The catalog's declared format is trusted for OFFERING; the scene re-detects
   * the real format from the bytes when a clip is loaded (a renamed file is
   * refused there), and the reason it gives is reported by `refreshMotionNotice`.
   */
  VrmPet3DWidget.prototype.motionFormatFor = function (kind) {
    if (kind === 'vrm') return 'vrma';
    return null;
  };

  /** The loaded avatar's kind: `avatar.kind`, falling back to the scene's. */
  VrmPet3DWidget.prototype.avatarKind = function () {
    if (!this.scene) return 'unknown';
    var avatar = this.scene.avatar;
    if (avatar && typeof avatar.kind === 'string' && avatar.kind) return avatar.kind;
    // 'unknown' rather than 'placeholder': the procedural avatar is gone (2026-10-10), so this is the kind of an
    // avatar that could not be classified, not the name of one that exists.
    return typeof this.scene.kind === 'string' && this.scene.kind ? this.scene.kind : 'unknown';
  };

  VrmPet3DWidget.prototype.catalogMotions = function () {
    return this.motionCatalog && Array.isArray(this.motionCatalog.motions) ? this.motionCatalog.motions : [];
  };

  /** The catalog entries that can drive the avatar loaded right now. */
  VrmPet3DWidget.prototype.compatibleMotions = function () {
    var wanted = this.motionFormatFor(this.avatarKind());
    if (!wanted) return [];
    var motions = this.catalogMotions();
    var out = [];
    for (var i = 0; i < motions.length; i++) {
      if (motionFormatOf(this.core, motions[i]) === wanted) out.push(motions[i]);
    }
    return out;
  };

  /** Mapped ids the loaded avatar cannot be driven by. */
  VrmPet3DWidget.prototype.staleMotionIds = function () {
    var offered = this.compatibleMotions();
    // The effective map, so a clip the bundled pack mapped is checked like any other: a stale-id notice that
    // ignored the defaults would either miss a genuinely unpickable clip or invent one.
    var ids = this.core.motionIdList(this.effectiveMotions());
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      if (!hasMotionId(offered, ids[i])) out.push(ids[i]);
    }
    return out;
  };

  /**
   * Ask the scene what it makes of the current map, and keep the answer.
   *
   * `describeMotions().reason` is the only place a failed build or a clip with no usable tracks becomes visible,
   * and a pet that quietly does nothing looks identical to a working one — so the reason is captured for the
   * widget's own state instead of being dropped on the floor.
   */
  VrmPet3DWidget.prototype.sceneMotionReason = function () {
    if (!this.scene || typeof this.scene.describeMotions !== 'function') return null;
    try {
      var description = this.scene.describeMotions();
      var reason = description && typeof description.reason === 'string' ? description.reason : '';
      this.motionReason = reason || null;
    } catch (error) {
      // A scene that cannot describe itself must not take the pet down.
    }
    return this.motionReason;
  };

  /**
   * The single place the motion status explains itself, in priority order — as DATA.
   *
   * A missing route explains everything below it; a scene that cannot describe itself beats a generic note; the
   * scene's own reason (a clip that failed to build, or built with no usable tracks) beats the generic cases;
   * then "nothing can drive this avatar"; then a stale preference. Silence is only correct when there is
   * genuinely nothing to say. The per-state picker this used to annotate lives on the 通用设置 page's 状态与动作
   * section now, so the answer travels to `this.motionNotice` and the settings page keeps saying the same thing
   * where the clips are chosen.
   */
  VrmPet3DWidget.prototype.refreshMotionNotice = function () {
    var text = STRINGS[this.language];
    var message = null;

    if (!this.motionCatalog) {
      message = text.noMotionsRoute;
    } else if (!this.motionSceneReady()) {
      message = text.noMotionApi;
    } else if (this.sceneMotionReason()) {
      message = this.motionReason;
    } else if (!this.compatibleMotions().length) {
      message = text.noMotionsKind[motionFamily(this.avatarKind())];
    } else {
      var stale = this.staleMotionIds();
      if (stale.length) message = text.staleMotions.replace('{n}', String(stale.length));
    }
    this.motionNotice = message;
  };

  /**
   * The motion map this pet should ACT on: the user's own choices, with the bundled pack's defaults filling
   * the states they have not touched.
   *
   * Read through `core.motionMapWithDefaults` rather than merged here, so the rule ("an explicit choice wins,
   * including an explicit empty one") is one implementation for both surfaces and is covered by the core
   * suite. The result is NOT written back to `this.preferences`: a default that became a stored value could
   * never be told apart from a choice, which is what makes a default impossible to turn off.
   */
  VrmPet3DWidget.prototype.effectiveMotions = function () {
    var stored = this.preferences ? this.preferences.motions : null;
    var payload = this.motionCatalog;
    if (!this.core || typeof this.core.motionMapWithDefaults !== 'function') return stored || {};
    var declared = payload && typeof payload === 'object' ? payload.motionDefaults : null;
    var clips = payload && typeof payload === 'object' ? payload.motions : null;
    return this.core.motionMapWithDefaults(stored || {}, declared || {}, clips || []);
  };

  VrmPet3DWidget.prototype.motionSceneReady = function () {
    return Boolean(this.scene &&
      typeof this.scene.setMotionMap === 'function' &&
      typeof this.scene.loadMotion === 'function');
  };

  /**
   * Feed the scene the preference map, then make sure its clips are loaded.
   *
   * Resolves when the outstanding loads settle and never rejects: a broken clip
   * is something to report, not something that may take the pet down with it.
   */
  VrmPet3DWidget.prototype.applyMotions = function () {
    var self = this;
    if (!this.motionSceneReady()) {
      this.refreshMotionNotice();
      return Promise.resolve(null);
    }
    this.scene.setMotionMap(this.effectiveMotions());

    /**
     * Every id every state lists is preloaded, not just the one a state is mapped to.
     *
     * A state draws one clip at random when it is ENTERED, and a clip that has not been fetched cannot be
     * drawn: the pet would fall back to the procedural idle for one state entry in N — intermittently, with
     * nothing on screen to explain it. The loop flag travels with the bytes, because it comes from
     * the catalog (the motion directory's manifest) and the scene has no other way to learn it.
     *
     * The ids come from `effectiveMotions`, not from the stored map: a state filled in by the bundled pack's
     * defaults needs its clip preloaded exactly like a state the user ticked, or the pet would idle
     * procedurally through that state's first entry.
     */
    var ids = this.core.motionIdList(this.effectiveMotions());
    var loads = ids.map(function (id) { return self.ensureMotion(id, self.motionLoopOfId(id)); });
    // The notice is refreshed here because this is the one call a preference change reaches: a clip that
    // cannot drive the avatar, or a clip the scene refused to build, is exactly what the note is about.
    return Promise.all(loads).then(function () { self.refreshMotionNotice(); },
      function () { self.refreshMotionNotice(); });
  };

  /**
   * The play mode in force for this clip: the user's per-clip choice, else the catalog's declaration.
   *
   * The catalog's flag comes from the motion directory's own manifest, so a clip is a one-shot for everyone
   * who copies that folder; the preference is what the person in front of THIS pet decided, and it wins.
   */
  VrmPet3DWidget.prototype.motionLoopOfId = function (motionId) {
    var entry = findMotionById(this.catalogMotions(), motionId);
    var declared = !entry || entry.loop !== false;
    return this.core.motionLoopFor
      ? this.core.motionLoopFor(this.preferences, motionId, declared)
      : declared;
  };

  /** Fetch one motion's bytes from the host's byte route. */
  VrmPet3DWidget.prototype.fetchMotionBytes = function (motionId) {
    var url = '/vrmpet3d/motion?m=' + encodeURIComponent(motionId);
    return fetch(url, { credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error('motion route returned HTTP ' + response.status);
      return response.arrayBuffer();
    });
  };

  /**
   * Make one clip available on the current avatar, fetching its bytes at most
   * once for the widget's whole lifetime.
   *
   * Four bits of bookkeeping, each for a different failure it prevents:
   *   * `motionPending` — two states mapped to one clip, or a re-apply while a
   *     load is in flight, must not build the same clip twice;
   *   * `motionLoaded`  — a clip already built for THIS avatar is reused as-is,
   *     which is what makes re-selecting it free;
   *   * `motionBuffers` — the BYTES outlive the clip: changing the model throws
   *     the clip away but not the download, so a re-apply rebuilds from memory;
   *   * `motionTokens`  — a load that was in flight when the avatar changed must
   *     not record itself as loaded, or the scene would be told a clip for the
   *     old skeleton is ready.
   */
  VrmPet3DWidget.prototype.ensureMotion = function (motionId, loop) {
    var self = this;
    if (!motionId || !this.motionSceneReady()) return Promise.resolve(null);
    // A loaded clip is reused, but the LOOP flag can change under it (the motion directory's manifest was
    // edited and the catalog re-read), and the flag lives on the cached bytes rather than on the clip: a
    // re-load is the only way it reaches the scene. `scene.loadMotion` is idempotent for unchanged bytes
    // and cheap in that case — it is the same file, parsed again into a fresh clip.
    var declaredLoop = loop !== false;
    if (this.motionLoaded[motionId] && this.motionLoadedLoop[motionId] === declaredLoop) {
      return Promise.resolve(this.motionLoaded[motionId]);
    }
    if (this.motionPending[motionId]) return this.motionPending[motionId];

    // A format already known to be wrong for this avatar is refused here rather
    // than handed to the scene: a stale preference kept pointing at a VRM would
    // otherwise light the status badge up on every single reload. The stale choice is
    // reported instead (see `refreshMotionNotice`), and the bytes are never fetched for it.
    //
    // A kind this file has no format FOR (the placeholder, or a plain glTF) is
    // NOT refused: the scene's own reason names the model kind, which is more
    // use to the user than this file guessing, and nothing is offered for that
    // kind anyway so the branch is only reachable from a stale preference.
    var wanted = this.motionFormatFor(this.avatarKind());
    var format = this.motionFormatOfId(motionId);
    if (format && wanted && format !== wanted) return Promise.resolve(null);

    this.motionTokens = this.motionTokens || {};
    var token = (this.motionTokens[motionId] || 0) + 1;
    this.motionTokens[motionId] = token;

    var bytes = this.motionBuffers[motionId] ||
      (this.motionBuffers[motionId] = this.fetchMotionBytes(motionId));

    var promise = bytes
      .then(function (buffer) { return self.scene.loadMotion(motionId, buffer, { loop: declaredLoop }); })
      .then(function (status) {
        if (self.motionTokens[motionId] !== token) return status || null;
        if (status && status.ok) {
          self.motionLoaded[motionId] = status;
          self.motionLoadedLoop[motionId] = declaredLoop;
        } else self.showStatus((status && status.reason) || ('vrmpet3d: could not load motion ' + motionId));
        return status || null;
      })
      .catch(function (error) {
        // A failure must not poison the cache: a transient 500 would otherwise
        // need a page reload before the clip could ever be tried again.
        delete self.motionBuffers[motionId];
        self.showStatus(errorText(error));
        return null;
      })
      .then(function (status) {
        if (self.motionTokens[motionId] === token) delete self.motionPending[motionId];
        return status;
      });

    this.motionPending[motionId] = promise;
    return promise;
  };

  /** The catalog's declared format for an id, or null when it says nothing. */
  VrmPet3DWidget.prototype.motionFormatOfId = function (motionId) {
    var entry = findMotionById(this.catalogMotions(), motionId);
    return entry ? motionFormatOf(this.core, entry) : null;
  };

  /**
   * The avatar changed, so every clip built for the old one is meaningless — a
   * clip is fitted to one skeleton. The scene's clips are
   * dropped (its byte cache is its own business) while this widget's byte cache
   * survives, and the map is re-applied so the new avatar gets its clips.
   */
  VrmPet3DWidget.prototype.afterAvatarChange = function () {
    this.motionLoaded = {};
    this.motionLoadedLoop = {};
    this.motionPending = {};
    this.motionReason = null;
    if (this.motionTokens) this.motionTokens = {};
    if (this.scene && typeof this.scene.clearMotions === 'function') {
      try { this.scene.clearMotions(); } catch (error) { /* optional */ }
    }
    return this.applyMotions();
  };

  VrmPet3DWidget.prototype.showStatus = function (message) {
    if (!this.badge) return;
    if (!message) {
      this.badge.hidden = true;
      this.badge.textContent = '';
      return;
    }
    this.badge.hidden = false;
    this.badge.textContent = String(message).slice(0, 120);
    this.badge.title = String(message);
  };

  // ---- frame loop ----------------------------------------------------------

  VrmPet3DWidget.prototype.start = function () {
    var self = this;
    var view = this.document.defaultView;
    var step = function (timestamp) {
      if (self.disposed) return;
      self.frameHandle = view.requestAnimationFrame(step);
      var delta = self.lastFrameAt === null ? 1 / 60 : (timestamp - self.lastFrameAt) / 1000;
      self.lastFrameAt = timestamp;
      self.tick(delta);
    };
    this.frameHandle = view.requestAnimationFrame(step);
  };

  /**
   * Draw (or clear) the prompt above the model's head, and put it where the head is.
   *
   * Kept out of `tick`'s body because it is the one part of a frame that touches the DOM and layout: the
   * text only changes on a state or settings change, and the POSITION is projected from the model rather
   * than read back from the DOM (`Scene.projectToCanvas`), so a frame where nothing moved writes nothing.
   */
  VrmPet3DWidget.prototype.renderHeadStatus = function (state) {
    var node = this.statusNode;
    if (!node) return;
    // The TURN clock, not the state's own age: 用时 is a claim about DSH's turn (`PetMachine.statusClock`), and the
    // token is dropped entirely while no turn is open — DSH's own token-free 「深度求索中」.
    var clock = this.machine && typeof this.machine.statusClock === 'function' ? this.machine.statusClock() : undefined;
    var line = this.core.statusFor(this.preferences, state, this.machine.stateSince, Date.now(), clock);
    /**
     * A state with no line clears the prompt rather than leaving the previous one up: a caption that
     * outlives its state is how a pet ends up saying 深度求索中 over a finished turn.
     *
     * Unconditional, not guarded on the last key: the clear has to be idempotent, because `hidden` and the
     * tracked key can disagree — a settings edit that empties the line, a preview, or the status element being
     * re-created all reach here with a key that no longer describes what is on screen.
     */
    if (!line) {
      this.headStatusKey = null;
      node.hidden = true;
      if (this.statusDecoration) this.statusDecoration.hidden = true;
      return;
    }
    var shown = line.text + line.tag;
    /**
     * The key carries the icon and the whole line, and with DSH's own label the line changes once a second —
     * 「用时 14分46秒」 — so the clock ticks by re-keying, which is exactly how the app's own label counts.
     */
    var key = line.animation + '\u0000' + (line.icon ? '1' : '0') + '\u0000' + shown;
    /**
     * The tone — 任务达成 gold and bold, 任务失败/出错 red — written every frame rather than only on a re-key.
     *
     * It belongs to the STATE, and the key is about the WORDS: a settings edit can change either without the
     * other, and the attribute is cheap. `data-tone` is what the stylesheet reads, so the colours live in CSS
     * (where the two surfaces can differ) and the DECISION lives in `core.statusFor` (where they cannot).
     */
    if (line.tone) node.setAttribute('data-tone', line.tone);
    else node.removeAttribute('data-tone');
    if (line.bold) node.setAttribute('data-bold', '1');
    else node.removeAttribute('data-bold');
    if (key !== this.headStatusKey) {
      this.headStatusKey = key;
      node.hidden = false;
      // Both copies from ONE string: each renders it with `content:attr(data-shimmer-text)`.
      if (this.statusTexts) {
        for (var i = 0; i < this.statusTexts.length; i += 1) {
          this.statusTexts[i].setAttribute('data-shimmer-text', shown);
        }
      }
      /**
       * The mask and its counter-transform, which is how DSH's own activity label is built
       * (`TextShimmer`): the decoration exists only for an animated line, and `prefers-reduced-motion`
       * hides it in CSS, so the plain text is always the fallback.
       */
      if (this.statusDecoration) this.statusDecoration.hidden = line.animation !== 'shimmer';
      /**
       * The whale, for the states that wear it — 工作中, where DSH shows it. Its own copy of the mark sits
       * inside the decoration and is hidden with it, so a static line carries neither.
       */
      if (this.statusIcon) this.statusIcon.hidden = line.icon !== true;
    }
    // Every frame, not only when the words change: the caption is anchored to the HEAD, so an orbit, a zoom
    // or a breath that moved the model has to move it too.
    this.placeHeadStatus();
  };

  /**
   * The model's projected top edge, in the pet's box coordinates — the point both the status prompt and the
   * 碎碎念 bubble hang from.
   *
   * The model's top in world units is `framing.scaled.y` — what `computeFraming` measured — and the camera
   * turns that into canvas pixels, which are already CSS pixels (`scene.resize` is called with the box's CSS
   * size). One vector is reused: this runs every frame while either element is up, and a fresh `Vector3` per
   * frame is the kind of garbage the frame loop is otherwise careful not to make.
   *
   * @returns {{x: number, y: number}|null}
   */
  VrmPet3DWidget.prototype.headTop = function () {
    var scene = this.scene;
    if (!scene || !scene.camera || typeof scene.projectToCanvas !== 'function') return null;
    var THREE = scene.THREE;
    if (!THREE) return null;
    var height = typeof scene.modelHeight === 'number' && scene.modelHeight > 0
      ? scene.modelHeight
      : (scene.framing && scene.framing.scaled ? scene.framing.scaled.y : 1);
    var vec = this._statusVec || (this._statusVec = new THREE.Vector3());
    return scene.projectToCanvas(vec.set(0, height, 0));
  };

  /**
   * Put the prompt's bottom centre on the model's projected top edge.
   *
   * The canvas is wider than the pet's slot when a clip or the frame margin grew it, so the origin comes off
   * the box before the ratio is applied.
   */
  VrmPet3DWidget.prototype.placeHeadStatus = function () {
    var node = this.statusNode;
    if (!node || !this.canvas) return;
    var top = this.headTop();
    if (!top) return;
    var boxWidth = this.placement.width;
    var boxHeight = this.placement.height;
    /**
     * The label's size: the box's ratio, times THIS MODEL's own correction.
     *
     * Written every frame because the box moves under it — the wheel, the MENU and the model's own
     * scale all change it — and the caption is not allowed to stay 13px while the pet grows (the operator's
     * complaint: "文字也没有随着模型变大"). `core.statusPromptFontPx` owns the ratio and `statusScaleFor` the
     * per-model correction (the wheel-over-the-text gesture), so both surfaces draw the same size for the same
     * pet and the same model; the whale is sized in `em` and follows automatically.
     */
    if (this.core && typeof this.core.statusPromptFontPx === 'function') {
      var statusScale = typeof this.core.statusScaleFor === 'function'
        ? this.core.statusScaleFor(this.preferences, this.currentModelId())
        : 1;
      node.style.setProperty('--vrmpet3d-status-font', this.core.statusPromptFontPx(boxHeight, statusScale) + 'px');
    }
    /**
     * No unit conversion here, and that is the fix for "文字还是没和模型居中" (2026-10-09).
     *
     * `projectToCanvas` answers in the SCENE's pixels, which are CSS pixels — `scene.resize` is called with the
     * box's CSS size — and NOT the drawing buffer's, which is that times `devicePixelRatio`
     * (`renderer.setPixelRatio`). Multiplying by `boxWidth / canvas.width` therefore divided by the device
     * pixel ratio a SECOND time, so on a 1.5x display the caption was drawn at two thirds of the distance
     * from the canvas's top-left corner: measured live, 89 px left of the pet's centre in a 396 px box, which
     * is exactly `(1 - 1/1.5)` of the way there. The projection is already in the space the box is expressed
     * in.
     */
    /**
     * No `max-width` any more (2026-10-09): the line never wraps ("提示文字永不换行"), so a cap that assumed it
     * could would leave the plate's background too narrow for the text it is behind. A line long enough to
     * outgrow the screen is bounded where it is TYPED instead — `STATUS_LIMITS.textLength`, in the settings
     * window — which is the place a user can see the limit.
     */
    /**
     * An upward bias of a few pixels, so the caption clears the hair rather than sitting on the crown: the
     * framing box is the model's BIND pose, and a VRM whose spring chains stand up reaches above it.
     *
     * Clamped into the pet's own box, because the prompt is DOM inside `.vrmpet3d-pet` — a negative `top`
     * would put it above the slot, where the overlay's own hit area ends and nothing else draws.
     */
    var left = top.x;
    var upper = top.y - 4;
    var limit = Math.max(0, boxHeight - 20);
    node.style.left = Math.round(Math.min(boxWidth, Math.max(0, left))) + 'px';
    node.style.top = Math.round(Math.min(limit, Math.max(0, upper))) + 'px';
  };

  /**
   * 碎碎念: ask the machine what the pet is saying, if anything.
   *
   * The state, the pending kind and the language are this half's to know; the machine owns the throttle and
   * the memory. `scene.random` is used when it exists, because it is the one injectable random the scene and
   * the widget already share — which is what lets a test pin which line is chosen.
   *
   * The AI half is pumped on the same call, so a generated line arrives through the ordinary path: `say()`
   * puts it in the machine, the next frame returns it here, and `tick`'s change detection publishes it to the
   * floating window exactly like a built-in one.
   */
  VrmPet3DWidget.prototype.speechLine = function (state) {
    if (!this.speech) return null;
    var random = this.scene && typeof this.scene.random === 'function' ? this.scene.random : null;
    var line = this.speech.observe(this.preferences, state, this.machine.pendingKind, this.language, random);
    /**
     * The EVENT in force, remembered for the press reaction's last step.
     *
     * A touch speaks from the part's own box first and then from the STATE's own lines, and this is which state
     * that is — `observe` computes it internally, so it is computed again here through the same exported rule
     * rather than guessed at.
     */
    this.speechEvent = typeof this.core.speechEvent === 'function'
      ? this.core.speechEvent(state, this.machine.pendingKind)
      : null;
    this.pumpSpeechAi();
    return line;
  };

  /**
   * Ask the host for a generated line, when the machine has asked for one and nobody has yet.
   *
   * The HOST makes the model call (`POST /vrmpet3d/say`): the provider's credential lives there, and the request
   * it builds carries no session content at all — this half sends the state's name and the language, nothing
   * else. A failure is deliberately silent here: the machine has already shown the user's own fallback line, so
   * there is nothing to apologise for and nothing to retry — the next attempt is the throttle's decision.
   */
  VrmPet3DWidget.prototype.pumpSpeechAi = function () {
    var self = this;
    if (!this.speech || !this.speechAi || typeof this.core.pumpAiSpeech !== 'function') return;
    this.core.pumpAiSpeech(this.speech, this.speechAi, function (request) {
      return fetch('/vrmpet3d/say', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        // `part`, `structure` and `chain` travel when the line is about a press: the host turns them into that
        // part's own prompt, or — when the part has none — into an instruction built from what was touched, with
        // the CHAIN name preferred over the structure name (the chain is what a person and the model both know).
        body: JSON.stringify({
          event: request.event,
          state: request.state,
          language: self.language,
          part: request.part || null,
          structure: request.structure || null,
          chain: request.chain || null,
        }),
      }).then(function (response) {
        return response.ok ? response.json() : null;
      }).then(function (body) {
        return body && typeof body.text === 'string' && body.text ? { text: body.text } : null;
      }).catch(function () { return null; });
    });
  };

  /**
   * Draw (or clear) the bubble.
   *
   * Change-detected on the text, and positioned EVERY frame it is up — the bubble hangs from the model's
   * projected head like the prompt does, so an orbit, a zoom or a breath has to move it too. A cleared line
   * hides the element rather than leaving the last remark on screen.
   */
  VrmPet3DWidget.prototype.renderSpeech = function (line) {
    var node = this.speechNode;
    if (!node) return;
    if (!line) {
      this.speechShown = null;
      node.hidden = true;
      node.textContent = '';
      return;
    }
    if (line !== this.speechShown) {
      this.speechShown = line;
      node.textContent = line;
      node.hidden = false;
    }
    this.placeSpeech();
  };

  /**
   * Put the bubble's bottom centre just above the status prompt's top edge.
   *
   * The anchor is the SAME point the prompt uses (the model's projected top, with the element's own
   * `translate(-50%,-100%)` doing the centring), plus `--vrmpet3d-speech-offset`: the prompt's measured height
   * while it is up, so the two never overlap, and a few pixels of clearance when it is not. The font is the
   * prompt's own ratio, a shade smaller — the remark is the pet's aside, not the app's readout.
   */
  VrmPet3DWidget.prototype.placeSpeech = function () {
    var node = this.speechNode;
    if (!node || node.hidden) return;
    var top = this.headTop();
    if (!top) return;
    var boxWidth = this.placement.width;
    var boxHeight = this.placement.height;
    var promptUp = this.statusNode && this.statusNode.hidden === false;
    node.style.setProperty('--vrmpet3d-speech-offset', (promptUp ? (this.statusNode.offsetHeight || 0) + 6 : 4) + 'px');
    if (this.core && typeof this.core.statusPromptFontPx === 'function') {
      var scale = typeof this.core.statusScaleFor === 'function'
        ? this.core.statusScaleFor(this.preferences, this.currentModelId())
        : 1;
      var px = this.core.statusPromptFontPx(boxHeight, scale) * 0.95;
      node.style.setProperty('--vrmpet3d-speech-font', Math.max(6, Math.round(px * 10) / 10) + 'px');
    }
    var upper = top.y - 4;
    var limit = Math.max(0, boxHeight - 20);
    node.style.left = Math.round(Math.min(boxWidth, Math.max(0, top.x))) + 'px';
    node.style.top = Math.round(Math.min(limit, Math.max(0, upper))) + 'px';
  };

  VrmPet3DWidget.prototype.tick = function (delta) {
    if (!this.scene) return;

    // Falling owns the placement until it lands.
    if (this.placement.isAirborne()) {
      var stillFalling = this.placement.stepFall(delta, this.core.FALL_PHYSICS);
      /**
       * 下坠/抛掷的物理反馈：把飞行速度喂给模型，和拖动用的是同一条通道。
       *
       * 报告（操作者，2026-10-12）：「修重力下坠和抛掷时的物理反馈」。此前飞行期间这条通道是**零**（释放拖动的
       * 那一刻写的就是 `setDragMotion(0, 0)`），于是身体既不滞后也不前倾，弹簧骨看到一个在世界坐标里纹丝不动的
       * 模型，头发就直挺挺地跟着一起掉 —— 而拖动时同一套机构是工作的。
       *
       * 落地后 `placement.fall` 变成 null，这一句喂进去的就是 0：滞后偏移按 `DRAG_LAG_TAU` 收束，这一下收束本身
       * 就是"落地"看得见的样子，而不是硬切。
       */
      this.reportFallMotion();
      if (!stillFalling) {
        // Touchdown. `landing` is a real state, so its window has to be ARMED
        // here — `landingUntil` lives on the machine, next to the interaction it
        // expires, and an earlier revision wrote it to the widget while the clear
        // condition read the machine's stale value. The pose therefore cleared
        // instantly and never appeared.
        this.machine.setInteraction('landing');
        this.machine.landingUntil = Date.now() + LANDING_HOLD_MS;
        this.machine.setDeferral(false);
      }
      this.applyPlacement();
    } else if (this.machine.interaction === 'landing') {
      if (Date.now() >= this.machine.landingUntil) this.machine.setInteraction(null);
    }

    var snapshot = this.aggregate.snapshot();
    var state = this.machine.resolve(snapshot);
    this.pet.setAttribute('data-state', state);
    this.scene.setState(state);
    /**
     * Announce a CHANGE, not the state. `createStateReporter` de-duplicates as well, so the two together
     * mean a frame loop that resolves the same state sixty times a second performs no work and sends
     * nothing.
     *
     * The 碎碎念 LINE travels with it and the comparison covers both: the pet can say something while the
     * state stays 静息态, and a line that ENDS without the state moving is a change the floating window has to
     * hear about — otherwise its bubble would outlive the app's by a whole hold.
     */
    var speech = this.speechLine(state);
    /**
     * A press rides along with the state report, and it has to be part of the CHANGE test: clicking the pet
     * does not move the state, so a reporter watching the state alone would never send it — and the answer to
     * "which part did that land on" would never leave the page.
     */
    var touch = this.pendingTouch || null;
    this.pendingTouch = null;
    /**
     * The turn clock travels WITH the state, because the window has no turn frames of its own.
     *
     * Its 用时 has to be DSH's number, and only this half receives the boundaries that carry it (see
     * `PetMachine.statusClock`): the relay is the window's only source, exactly as it is for the 碎碎念 line.
     */
    var clock = this.machine && typeof this.machine.statusClock === 'function' ? this.machine.statusClock() : null;
    var clockKey = clock ? clock.startedAt + ':' + (clock.endedAt || '') : '';
    if (state !== this.lastPublishedState || speech !== this.lastPublishedSpeech || touch !== null
      || clockKey !== this.lastPublishedClockKey) {
      this.lastPublishedState = state;
      this.lastPublishedSpeech = speech;
      this.lastPublishedClockKey = clockKey;
      if (this.publishState) this.publishState(state, speech, touch, clock);
    }

    /**
     * Focus, which is what ends a 任务完成 or 出错 prompt.
     *
     * Polled rather than event-driven on purpose. `focus`/`blur` on `window` do not fire when the user
     * switches between two applications on Windows — the page keeps its focus, only the OS-level foreground
     * window changes — and `document.hasFocus()` is the one call that does reflect it. Once every eighth
     * frame is often enough for a human-scale event and keeps the cost off the hot path.
     */
    this.frameCount = (this.frameCount || 0) + 1;
    if (this.frameCount % 8 === 0) {
      var doc = this.document;
      var focused = true;
      try {
        focused = typeof doc.hasFocus === 'function' ? doc.hasFocus() !== false : true;
      } catch (_error) {
        focused = true;
      }
      if (focused !== this.documentFocused) {
        this.documentFocused = focused;
        this.machine.setFocus(focused);
      }
    }
    this.renderHeadStatus(state);
    this.renderSpeech(speech);

    // Only the idle motion moves the pet; with motion off the pose is frozen but
    // dragging and placement still work, so the preference never bricks it.
    this.scene.tick(this.preferences.motion ? delta : 0);

    // The aim is measured against the pet's own centre each frame, from the placement
    // the pet has THIS frame: the cursor can sit anywhere in the window (the listener is
    // on the document), and the pet can be dragged or falling while it looks. Using the
    // placement instead of `getBoundingClientRect` keeps this out of layout.
    if (this.preferences.lookAtPointer && this.pointer) {
      var pixels = this.placement.pixels();
      var aim = this.core.pointerAim({
        pointerX: this.pointer.x,
        pointerY: this.pointer.y,
        centreX: pixels.left + this.placement.width / 2,
        centreY: pixels.top + this.placement.height / 2,
        // The same two settings as the floating window's (the 模型参数 window's 视线 section), with the
        // same "auto" default: 0 px means this frame's width, which here is the app window.
        spanX: this.core.resolveGazeSpan(this.preferences.gazeSpanX, this.placement.viewportWidth),
        spanY: this.core.resolveGazeSpan(this.preferences.gazeSpanY, this.core.GAZE_SPAN.y),
        curve: this.preferences.gazeCurve
      });
      this.scene.motion.setGaze(this.scene.gazeFromAim(aim));
    } else {
      this.scene.motion.setGaze(null);
    }

    this.scene.setPlacement(this.placement.x, this.placement.y, 0);
  };

  // ---- session bridge ------------------------------------------------------

  VrmPet3DWidget.prototype.setInput = function (input) {
    this.aggregate.setInput(input);
    var snapshot = this.aggregate.snapshot();
    this.machine.resolve(snapshot);
  };

  VrmPet3DWidget.prototype.boundary = function (event) {
    this.aggregate.boundary(event);
    this.machine.boundary(this.aggregate.snapshot(), event);
  };

  VrmPet3DWidget.prototype.resetAggregate = function (identities) {
    this.aggregate.reset(identities);
  };

  VrmPet3DWidget.prototype.setConnected = function (connected) {
    this.connected = connected === true;
    var current = this.aggregate.input;
    this.setInput({
      catalog: current.catalog,
      statuses: current.statuses,
      connected: this.connected,
      scope: this.preferences.scope,
      currentSessionId: current.currentSessionId
    });
  };

  VrmPet3DWidget.prototype.publish = function () {
    var current = this.aggregate.input;
    this.setInput({
      catalog: current.catalog,
      statuses: current.statuses,
      connected: this.connected === true,
      scope: this.preferences.scope,
      currentSessionId: current.currentSessionId
    });
  };

  VrmPet3DWidget.prototype.setSessionContext = function (catalog, statuses) {
    this.setInput({
      catalog: catalog,
      statuses: statuses,
      connected: this.connected === true,
      scope: this.preferences.scope,
      currentSessionId: selectedSessionId(catalog)
    });
  };

  VrmPet3DWidget.prototype.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    /**
     * A press in progress dies with the widget, timer and all: a long-press timer that outlives its pet would
     * call into a disposed scene.
     */
    if (this.press) {
      if (this.press.timer) clearTimeout(this.press.timer);
      this.press = null;
    }
    var view = this.document.defaultView;
    if (this.frameHandle !== null) {
      try { view.cancelAnimationFrame(this.frameHandle); } catch (error) { /* already gone */ }
      this.frameHandle = null;
    }
    if (this.onResize) {
      try { view.removeEventListener('resize', this.onResize); } catch (error) { /* already gone */ }
    }
    if (this.scene) {
      try { this.scene.dispose(); } catch (error) { /* already gone */ }
      this.scene = null;
    }
    // The menu listens on the DOCUMENT while it is open, so it is disposed explicitly: removing the root
    // would take the element with it and leave an outside-press listener pointing at a dead node.
    if (this.menu) {
      try { this.menu.destroy(); } catch (error) { /* already gone */ }
      this.menu = null;
    }
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================

  var BASE_PET_WIDTH = 220;
  var BASE_PET_HEIGHT = 300;

  /**
   * The pet's shipped size, as one value.
   *
   * Exported because the desktop window (a separate process, `lib/desktop-page.js`) mounts the
   * same `Placement` against the whole screen, and a second copy of these two numbers is
   * exactly the kind of mirror that drifts: the two windows would frame the same model at
   * different sizes and nothing would explain why.
   */
  var BASE_PET_SIZE = Object.freeze({ width: BASE_PET_WIDTH, height: BASE_PET_HEIGHT });

  /**
   * How much horizontal throw speed survives one second of flight.
   *
   * Deliberately strong: this is a desktop toy, not a puck, and a lateral skid that
   * outlives the fall reads as drift. A wall hit returns `FALL_PHYSICS.wallBounce` of
   * whatever is left, so a hard sideways throw is two or three visible rebounds and
   * then a landing on the floor.
   */
  var HORIZONTAL_DAMPING = 0.12;

  /**
   * The largest fraction of the frame the pet's slot may occupy, per axis.
   *
   * Not a taste decision — a limit on the pet's HIT AREA. The overlay is click-through
   * except for the pet's own box, so a pet allowed to fill the window would take every
   * click and drag in the app with it, and its clamps would reach 0 and pin it in place.
   * At these numbers the pet still gets large (≈590 px tall on a 1000 px window, more
   * than the old 160 % slider reached) with a real margin left to drag it into.
   */
  var MAX_SLOT_FRACTION = { width: 0.55, height: 0.6 };

  /**
   * Movement, in CSS pixels, that turns a secondary press into a VIEW DRAG.
   *
   * The secondary button does double duty: a click opens the MENU, a drag orbits the camera. Distance
   * decides rather than time, because a slow deliberate drag and a slow deliberate click are
   * indistinguishable by duration — and some slop is what a hand needs before a press counts as movement.
   *
   * **It was 4, and 4 was the bug** (operator, 2026-10-12: 「内置宠物右键单击无效」). The test is
   * `|dx| + |dy| < threshold` on a MANHATTAN distance, so 4 means a wobble of 2 px on each axis — which a
   * real mouse produces on almost every click, because a right-click is a press, a small drag of the hand
   * and a release. Crossing it sets `viewDrag.moved`, and a moved press is an ORBIT: on release
   * `finishOrbit` sets `suppressContextMenu`, and the `contextmenu` that follows is swallowed by design so
   * a right-DRAG does not open a menu over the view it just turned. So the gesture the operator asked for
   * (「把双击打开菜单变成右键打开菜单」) worked only for a perfectly still hand, and a double-click — which has no
   * such rule — was the only reliable way in. That is exactly what they reported before and after the swap.
   *
   * 10 px of Manhattan slop is still imperceptible as an orbit (a real one is tens of pixels, and 10 px is
   * 0.08 rad ≈ 4.6°), while no hand trips it by accident. The pet's own press keeps its smaller
   * `PRESS_LIMITS.moveThreshold` on purpose: a left-drag starts MOVING the pet, so it must feel immediate,
   * while the camera can wait a few pixels for the user to commit.
   */
  var VIEW_DRAG_THRESHOLD = 10;

  /** Radians of camera orbit per CSS pixel dragged. */
  var VIEW_YAW_PER_PIXEL = 0.008;
  var VIEW_PITCH_PER_PIXEL = 0.006;

  /**
   * How long the impact pose is held after touchdown.
   *
   * Deliberately longer than one frame and shorter than the eye registers as a
   * stall: it is what makes a drop read as a landing rather than a teleport.
   */
  var LANDING_HOLD_MS = 550;

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---- motion helpers ------------------------------------------------------

  /**
   * A catalog entry's format: its declared `format`, or failing that its name
   * through the core's own extension list. Never a second copy of that list
   * here — the extensions are core's business, and a local list would
   * drift the moment another format appears.
   */
  function motionFormatOf(core, entry) {
    if (!entry) return 'unknown';
    if (typeof entry.format === 'string' && entry.format) {
      return entry.format.toLowerCase().replace(/^\./, '');
    }
    var name = typeof entry.name === 'string' && entry.name ? entry.name : entry.id;
    return core.isMotionFile(name) ? core.extensionOf(name).slice(1) : 'unknown';
  }

  /**
   * One tickable clip in a state's box set.
   *
   * The label carries the file name, its format and size — the three things that tell two clips apart —
   * plus whether the clip LOOPS or plays ONCE, because that is the difference between "the pet will do
   * this for as long as the state lasts" and "the pet will do this once and then idle", and the user
   * cannot see it anywhere else.
   */
  function findMotionById(list, motionId) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === motionId) return list[i];
    }
    return null;
  }

  function hasMotionId(list, motionId) {
    return Boolean(findMotionById(list, motionId));
  }

  /**
   * Which family of motion notice a loaded avatar gets.
   *
   * 'mmd' was the third answer until 2026-10-12: an MMD avatar could not load, so no
   * avatar can be one now, and `motionFamily` answers `'vrm'` or `'other'`.
   */
  function motionFamily(kind) {
    if (kind === 'vrm') return 'vrm';
    return 'other';
  }

  function selectedSessionId(catalog) {
    if (!catalog) return undefined;
    if (typeof catalog.currentSessionId === 'string') return catalog.currentSessionId;
    if (catalog.selectedSessionId) return catalog.selectedSessionId;
    if (catalog.current && typeof catalog.current.id === 'string') return catalog.current.id;
    return undefined;
  }

  /** UI strings. Two languages, chosen from the DSH locale service. */
  var STRINGS = {
    en: {
      /* The floating window's own state, kept as data by `syncDesktop`. */
      desktopOff: 'Off — the pet stays inside this window.',
      desktopStarting: 'Starting the window…',
      desktopRunning: 'On — the pet floats above every window and follows the cursor there.',
      desktopRunningExternal: 'On — using the Electron named by VRMPET3D_DESKTOP_RUNTIME.',
      desktopNoRender: 'The window is open but the pet is not drawing in it:',
      desktopFailed: 'Could not start:',
      desktopUnavailable: 'This host is not serving /vrmpet3d/desktop, so the window cannot be opened.',
      configNote: 'Opened in its own window: expressions, spring chains, and everything the model file declares.',
      /*
       * Said when the first-run guide could not be given a window: the fallback is a tab, and a tab opened without
       * a user gesture is what a popup blocker eats. Without this line the guide would simply never appear.
       */
      setupNote: 'The first-run guide could not open a window (no desktop launcher here): open it from 通用设置 → 其他 → 重新运行引导.',
      restore: 'Show pet',
      ariaPet: 'Desktop pet. Drag to move, click for a greeting, wheel to resize, right-drag to orbit, right-click for the menu.',
      /* Motion is MAPPED on the 通用设置 page; these say why nothing plays when nothing can. */
      noMotionsRoute: 'Motion clips unavailable: the host is not serving /vrmpet3d/motions in this session.',
      noMotionApi: 'Authored motion unavailable: this build of the 3D scene has no motion API.',
      staleMotions: '{n} selected clip cannot drive this model.',
      noMotionsKind: {
        vrm: 'This VRM model is driven by humanoid bones, so only .vrma clips work here — no .vrma clip was found.',
        other: 'The loaded avatar has no skeleton, so no motion clip can drive it. Load a VRM model first.',
      },
    },
    zh: {
      /* 悬浮窗自身的状态，由 `syncDesktop` 作为数据保存。 */
      desktopOff: '已关闭——宠物只在本窗口里。',
      desktopStarting: '正在启动悬浮窗…',
      desktopRunning: '已开启——宠物浮在所有窗口之上，并在那里跟随鼠标。',
      desktopRunningExternal: '已开启——使用 VRMPET3D_DESKTOP_RUNTIME 指定的 Electron。',
      desktopNoRender: '窗口已打开，但宠物没有在里面绘制：',
      desktopFailed: '启动失败：',
      desktopUnavailable: '当前宿主没有提供 /vrmpet3d/desktop 路由，无法打开悬浮窗。',
      configNote: '在独立窗口中打开：表情、弹簧骨，以及模型文件里声明的一切。',
      /* 引导没能开成窗口时说的：退化成标签页，而没有用户手势的标签页会被弹窗拦截；没有这句就等于"引导没出现"。 */
      setupNote: '初次安装引导没能打开窗口（这里没有桌面启动器）：可在「通用设置 → 其他 → 重新运行引导」里打开。',
      restore: '显示宠物',
      ariaPet: '桌面宠物。拖动可移动，单击打招呼，滚轮缩放，右键拖动转视角，右键单击打开菜单。',
      /* 动作映射在「通用设置」页；这里说明“为什么没有动作在播放”。 */
      noMotionsRoute: '动作文件不可用：当前会话没有提供 /vrmpet3d/motions 路由。',
      noMotionApi: '动作文件不可用：此版本的 3D 场景没有动作接口。',
      staleMotions: '有 {n} 个已选动作无法驱动此模型。',
      noMotionsKind: {
        vrm: 'VRM 模型使用人形骨骼，因此只能用 .vrma 动作文件——未找到 .vrma 文件。',
        other: '当前替身没有骨骼，任何动作文件都无法驱动它。请先加载 VRM 模型。',
      },
    }
  };

  // ===========================================================================
  // Plugin
  // ===========================================================================

  function readLanguage(locale) {
    try {
      var snapshot = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined;
      var value = snapshot && (snapshot.language || snapshot.locale || snapshot.current);
      if (typeof value === 'string' && value.toLowerCase().indexOf('zh') === 0) return 'zh';
      var lang = document.documentElement.lang || '';
      return lang.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    } catch (error) {
      return 'en';
    }
  }

  /**
   * Subscribe to live turn boundaries over the plugin's own host service.
   *
   * `ctx.remote.vrmpet3d` is the RPC face of the host half's `vrmpet3d` service, and
   * this is resolved through `ctx.get('remote')` rather than through a declared
   * `inject` on purpose. The binding is an upgrade, not a requirement: the React
   * status hooks drive the pet on their own, so a composition without it should
   * cost a little state fidelity, never the whole plugin. Declaring `remote` as a
   * hard dependency would do the opposite — wait for activation forever.
   *
   * `ctx.get` is the documented optional-access form for a Cordis context, and it
   * is also what the plugin's own manifest is inspected for, so the failure mode
   * is an `undefined` here rather than a stalled entry.
   */
  function observeBoundaries(ctx, handlers) {
    var controller = new AbortController();
    var remote = typeof ctx.get === 'function' ? ctx.get('remote') : ctx.remote;
    var service = remote && typeof remote.vrmpet3d === 'function'
      ? remote.vrmpet3d()
      : remote && remote.vrmpet3d;
    if (!service || typeof service.watch !== 'function') return function () {};

    var iterator;
    try { iterator = service.watch(controller.signal); } catch (error) { return function () {}; }
    if (!iterator || typeof iterator.next !== 'function') return function () {};

    (function pump() {
      iterator.next().then(function (result) {
        if (!result || result.done) return;
        var frame = result.value;
        if (!frame || typeof frame !== 'object') return pump();
        if (frame.type === 'baseline') {
          if (handlers.onReset) handlers.onReset(frame);
        } else if (frame.type === 'turn/start' || frame.type === 'turn/end') {
          if (handlers.onBoundary) handlers.onBoundary({
            sessionId: frame.sessionId,
            seq: frame.seq,
            type: frame.type,
            reason: frame.type === 'turn/end' ? frame.reason : undefined,
            isSubagent: frame.isSubagent
          });
        }
        pump();
      }, function () { /* stream ended; stay silent */ });
    })();

    return function () { try { controller.abort(); } catch (error) { /* ignore */ } };
  }

  /**
   * @param {Function} require the loader's synchronous require, whose `async`
   *   member is how the chunks arrive.
   * @param {Promise} chunks a promise for every chunk this half needs. Resolved
   *   once by the factory and shared by every widget instance; a rejection is
   *   reported by the widget rather than thrown into the module system, because
   *   a missing chunk is something to show the user, not something that should
   *   take the app's plugin entry down.
   */
  function createPlugin(require, chunks) {
    var React = require('react');
    var h = React.createElement;
    SETTINGS_SEQ += 1;

    return {
      /**
       * Hard dependencies only. An `inject` entry the running composition cannot
       * satisfy leaves the plugin waiting for activation forever, and the boot
       * audit says only "is waiting for activation" — so a service this half does
       * not strictly need must not be listed here.
       *
       * `remote` is deliberately absent even though the boundary stream uses it,
       * and `connection` is absent because this half never touched it: it was in
       * this list and referenced nowhere. The pet's primary signal is the React
       * status hooks and the RPC stream is an upgrade, so making that a hard
       * dependency would let an unavailable binding cost the user the whole pet.
       * It is resolved optionally in `observeBoundaries` instead.
       */
      inject: ['slots', 'sessions', 'locale'],
      apply: function (ctx) {
        /**
         * Every live widget, so the application-lifetime boundary stream can feed
         * whichever instances are currently mounted. A plain Set rather than a
         * captured single reference: the slot can mount more than once (a second
         * window, or a remount during HMR), and a captured reference would go
         * stale silently and stop updating the pet.
         */
        var widgets = new Set();

        /**
         * The one reporter for this plugin activation, shared by every widget.
         *
         * Shared rather than per-widget because it de-duplicates on the last value SENT: two mounted widgets
         * both resolving `working` should cost one POST between them, and a widget that unmounts and comes
         * back does not re-announce a state the host already has.
         *
         * Resolved on FIRST USE rather than here, and both halves of that matter.
         *
         * `lib/core.js` is not loaded yet at this point in the real app: this bundle registers itself, the
         * loader calls `apply` immediately, and the chunk fetch only then begins. A value read here would
         * therefore always be the fallback, and the floating window would silently stop following the pet for
         * the whole session. Every other reader in this file already goes through the global at the moment it
         * needs the core (`VrmPet3DWidget`'s constructor), which is what makes this the one place that got it
         * wrong.
         *
         * And it read a BARE `core`, which is the failure that bricked the app on 2026-10-09: this file is
         * `'use strict'`, an undeclared identifier throws a ReferenceError even inside `typeof`, `apply` threw
         * before it had registered anything, the client entry settled FAILED, and DSH's web boot refuses to
         * start while any entry has not activated — the operator saw "应用无法启动 / dsh-plugin-vrmpet3d: failed"
         * and the app would not open at all. The two halves of the fix are one expression: read the global,
         * lazily.
         */
        var reporterInstance = null;
        function stateReporter() {
          if (reporterInstance === null) {
            var core = globalThis.__VRMPET3D_CORE__;
            reporterInstance = core && typeof core.createStateReporter === 'function'
              ? core.createStateReporter({})
              // `reportError` belongs in the fallback: it is the reporter's own report of a failure, so a
              // fallback missing it turned "the pet could not start" into a TypeError inside the catch.
              : { report: function () {}, reportError: function () {}, last: function () { return null; } };
            /**
             * Start the HEARTBEAT, so that going quiet means something.
             *
             * Without it the host cannot tell a long turn from a page that stopped — and this page's frame loop is
             * exactly what Chromium stops while the DSH window is hidden, which is how a finished turn kept reading
             * 深度求索中 in the floating window for ever (operator, 2026-10-11). Started lazily with the reporter
             * because that is the first moment there is anything to re-state.
             */
            if (reporterInstance && typeof reporterInstance.startHeartbeat === 'function') {
              reporterInstance.startHeartbeat();
            }
          }
          return reporterInstance;
        }

        function usePet(onScopeChange) {
          var elementRef = React.useRef(null);
          var widgetRef = React.useRef(null);
          var changeScope = React.useRef(onScopeChange);
          changeScope.current = onScopeChange;
          var [status, setStatus] = React.useState('loading');

          React.useEffect(function () {
            var host = elementRef.current;
            if (!host) return undefined;
            var widget = null;
            var disposed = false;

            chunks.then(function () {
              if (disposed) return;
              try {
                widget = new VrmPet3DWidget(host, {
                  language: readLanguage(ctx.locale),
                  onScopeChange: function (scope) { if (changeScope.current) changeScope.current(scope); },
                  /**
                   * Report the state to the host, so the floating window can show the same prompt.
                   *
                   * The WIDGET drives this rather than a `machine.observe` here, because a widget is built
                   * outside React's render (in an effect) and the reporter has to be per-widget: with two
                   * slots mounted, only the one that is resolving frames should be talking.
                   *
                   * `clock` is the TURN clock (`{ startedAt, endedAt }` or null). It rides along because the window
                   * has no turn frames of its own and its 用时 must be DSH's number, not its own guess — see
                   * `PetMachine.statusClock`.
                   */
                  publishState: function (state, line, touch, clock) {
                    stateReporter().report(state, line, touch, clock);
                  }
                });
                widgetRef.current = widget;
                widgets.add(widget);
                setStatus('ready');
              } catch (error) {
                setStatus('error:' + errorText(error));
                // Both channels: the badge for whoever is looking at the screen, and the host route for
                // whoever is looking at the app from outside (a shell, a probe, me).
                stateReporter().reportError(error);
                if (host.ownerDocument) {
                  var note = host.ownerDocument.createElement('div');
                  note.className = 'vrmpet3d-badge';
                  note.textContent = errorText(error);
                  host.appendChild(note);
                }
                return;
              }
              if (!widget) return;
              widget.initScene();
              widget.refreshCatalog().then(function () {
                var modelId = widget.preferences.modelId;
                return widget.loadModel(modelId);
              }).then(function () {
                // After the model, so the picker filters against the avatar that
                // actually loaded and the saved map can be applied to it. The
                // motion route may not exist at all; refreshMotions resolves
                // either way and `refreshMotionNotice` carries the explanation.
                return widget.refreshMotions();
              }).then(function () {
                // The first-run guide, asked LAST and never awaited: a guide that cannot open must not delay the
                // pet or turn into a mount failure. It reads `completed`/`prompted` from the host itself.
                widget.maybeOfferSetup();
              });
            }, function (error) {
              if (disposed) return;
              setStatus('error:' + errorText(error));
              // A CHUNK that never arrived is the one failure that otherwise renders nothing at all, so this
              // is the report that matters most: it turns "the pet is gone" into a named cause.
              stateReporter().reportError(error);
              if (host.ownerDocument) {
                var note = host.ownerDocument.createElement('div');
                note.className = 'vrmpet3d-badge';
                note.textContent = errorText(error);
                host.appendChild(note);
              }
            });

            return function () {
              disposed = true;
              if (widget) {
                widgets.delete(widget);
                widget.dispose();
              }
              if (widgetRef.current === widget) widgetRef.current = null;
            };
          }, []);

          return [elementRef, widgetRef, status];
        }

        function VrmPet3DRoot(props) {
          var useSessions = props && props.useSessions;
          var useSessionStatus = props && props.useSessionStatus;
          var supported = typeof useSessions === 'function' && typeof useSessionStatus === 'function';
          var pet = usePet();
          var elementRef = pet[0];
          var widgetRef = pet[1];
          var status = pet[2];

          var catalog = supported ? useSessions(function (snapshot) { return snapshot; }) : null;
          var statuses = supported ? useSessionStatus(function (map) { return map; }) : null;
          var latest = React.useRef({ catalog: catalog, statuses: statuses });
          latest.current = { catalog: catalog, statuses: statuses };

          // Push the current session context into the widget. This runs on every
          // catalog/status change and is what makes the pet react even when the
          // RPC boundary stream is unavailable.
          //
          // It deliberately does NOT touch `widget.preferences.scope`. An earlier
          // revision read a `scope` prop here, but no such seat exists, so the
          // branch always wrote 'global' and silently overrode the user's saved
          // choice on every catalog change. Scope is owned by the 通用设置 page
          // and by the widget's own storage; the React half only reports sessions.
          //
          // `status` is in the dependency list for a reason that is easy to miss:
          // the widget does not exist on the first run. It is built inside `usePet`
          // once the three chunks land — seconds later, for the 2.5 MB vendor chunk —
          // and `setStatus('ready')` re-renders without changing catalog or statuses.
          // Without this dependency the push happened only on the FIRST store change
          // after a page load, and a machine sitting idle at that moment could keep
          // the pet at 离线 until something else moved.
          React.useEffect(function () {
            var widget = widgetRef.current;
            if (!widget || !supported) return;
            /**
             * A live session standard kit IS the connection.
             *
             * `SessionAggregate` gates `available` on `connected === true`, and `resolve`
             * answers `offline` for everything below it in the cascade — so a flag nobody
             * writes does not degrade the pet, it pins it to 离线 and makes 工作中 / 任务达成 /
             * 出错 / 空闲 / 睡觉 unreachable. That is what happened: `setConnected` existed and
             * nothing called it, so the pet reported `offline` through a whole working turn
             * while every suite stayed green (measured live 2026-10-09: `/vrmpet3d/state` said
             * `offline` with a session streaming).
             *
             * DSH's slot machinery hands EVERY registered component the session standard kit
             * (`useSessions`, `useSessionStatus`), and those hooks exist only while the client
             * store is installed — which is exactly what "connected" means here. It is not a
             * claim that a session is active: `hasAnything` still gates availability on the
             * store being ready, so this cannot show a cheerful 空闲 over an empty session list.
             */
            widget.setConnected(true);
            widget.setSessionContext(latest.current.catalog, latest.current.statuses);
          }, [catalog, statuses, supported, status]);

          // `data-vrmpet3d` reports load state, which is the first thing to look at
          // when the pet does not appear. The error detail also lands in a badge on
          // the element itself.
          return h('div', { ref: elementRef, 'data-vrmpet3d': status });
        }

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({ name: 'shell.overlay', id: 'vrmpet3d', order: 80 }, VrmPet3DRoot);
        });

        // The boundary stream is wired once per plugin activation, outside React,
        // because it is an application-lifetime subscription rather than a
        // render-time concern. It feeds whichever widgets are mounted right now.
        var stopBoundaries = observeBoundaries(ctx, {
          onReset: function (baseline) {
            widgets.forEach(function (widget) {
              widget.resetAggregate(baseline && baseline.identities);
            });
          },
          onBoundary: function (event) {
            widgets.forEach(function (widget) { widget.boundary(event); });
          }
        });

        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return function () {
              try { stopBoundaries(); } catch (error) { /* already gone */ }
              widgets.clear();
            };
          }, 'vrmpet3d.boundary-stream');
        }
      }
    };
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  var VrmPet3DClient = {
    createPlugin: createPlugin,
    VrmPet3DWidget: VrmPet3DWidget,
    Placement: Placement,
    BASE_PET_SIZE: BASE_PET_SIZE,
    STRINGS: STRINGS,
    CSS: CSS,
    formatBytes: formatBytes,
    // The surface rule the entry owns rather than the core (see `petSurfaceFrom`), exposed so the browser
    // probe can pin it: the stale-chunk case cannot be reproduced by a fresh chunk, so the rule itself is
    // what has to be asserted.
    petSurfaceFrom: petSurfaceFrom,
    selectedSessionId: selectedSessionId,
    observeBoundaries: observeBoundaries,
    /**
     * The 3D graph this half handed to the scene, or null while it has not
     * arrived. Exposed as a function rather than a value because the hand-off
     * happens after this object is built, and a copy taken now would stay null
     * forever — the same trap the hand-off itself had.
     */
    handedVendor: function () { return handedVendor; },
  };

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: PLUGIN_ID,
      factory: function (require) {
        // One promise, awaited only when the slot first renders, so the three
        // source chunks and the 3D stack arrive while the rest of the app boots.
        // A widget that never mounts never pays for any of it.
        var ready = loadChunks(require);
        return createPlugin(require, ready);
      }
    });
  }

  if (typeof globalThis !== 'undefined') globalThis.__VRMPET3D_CLIENT__ = VrmPet3DClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = VrmPet3DClient;
})();

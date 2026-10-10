// Browser integration test for the client half.
//
// Exercises the real Pet3DWidget against a real DOM, a real WebGL context and a
// real frame clock: mounting, the drag → fall → land sequence, preference
// persistence, state changes, and disposal. The host's `/pet3d/*` routes do not
// exist here, so this also proves the widget degrades to the built-in
// placeholder instead of leaving an empty box when the routes are missing.
(function () {
  var report = { checks: [], errors: [] };

  function check(name, fn) {
    try {
      var value = fn();
      var ok = value !== false && value !== undefined && value !== null;
      report.checks.push({ name: name, ok: ok, value: String(value) });
      return value;
    } catch (error) {
      report.checks.push({ name: name, ok: false, value: 'threw: ' + (error && error.message) });
      report.errors.push(name + ': ' + (error && error.message));
      return undefined;
    }
  }

  function finish() {
    report.ok = report.checks.length > 0 && report.checks.every(function (c) { return c.ok; });
    var out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(report);
    document.title = report.ok ? 'CLIENT-OK' : 'CLIENT-FAIL';
  }

  /**
   * A check whose verdict is only known once promises settle.
   *
   * The synchronous `check` above cannot express this: it decides `ok` from the
   * returned value, so a returned promise reads as "pass" whatever it resolves
   * to. Pending async checks are awaited before the report is written, and a
   * rejected one is recorded as a failure rather than escaping as an unhandled
   * rejection that the page would never report.
   *
   * They are SERIALIZED, not fired in parallel: every one of them drives the same
   * widget through the same scene spies and the same fetch stub, so overlapping
   * them measured whichever check happened to act last — the first version of the
   * motion checks reported a preference map belonging to a different check.
   */
  var pending = [];
  var queued = Promise.resolve();
  /**
   * Say which check is running.
   *
   * The report is only written at the end, so a check that never settles left the page saying
   * "running…" with no way to tell which one — the whole suite looked as if it had not started.
   * The page's own output element is the channel the runner reads.
   */
  function progress(name) {
    var out = document.getElementById('out');
    if (out) out.textContent = 'running: ' + name;
  }
  function asyncCheck(name, fn) {
    var entry = { name: name, ok: false, value: 'pending' };
    report.checks.push(entry);
    queued = queued
      .then(function () { progress(name); return fn(); })
      .then(function (value) {
        entry.ok = value !== false && value !== undefined && value !== null;
        entry.value = String(value);
      }, function (error) {
        entry.ok = false;
        entry.value = 'threw: ' + (error && error.message);
        report.errors.push(name + ': ' + (error && error.message));
      });
    pending.push(queued);
  }

  var CLIENT = globalThis.__PET3D_CLIENT__;
  var CORE = globalThis.__PET3D_CORE__;
  var SCENE = globalThis.__PET3D_SCENE__;
  var VENDOR = globalThis.__PET3D_VENDOR__;

  /**
   * Wait out a completion's SETTLE window, on the same clock the widget runs on.
   *
   * A finished turn is no longer a finished task (operator, 2026-10-11: "完成一个子任务就…任务达成，然后马上重新开始了"):
   * the machine holds a completion for `core.COMPLETION_SETTLE_MS` and drops it if work resumes, so a check that wants
   * to see 任务达成 has to let that window pass. Read from core rather than hard-coded, so the knob stays one number.
   */
  function settleCompletion() {
    var wait = Number(CORE.COMPLETION_SETTLE_MS) > 0 ? Number(CORE.COMPLETION_SETTLE_MS) : 4000;
    return new Promise(function (resolve) { setTimeout(resolve, wait + 200); });
  }

  /**
   * The VRM fixture's raw gaze effect, kept out of the report so the cross-kind comparison
   * is made against full precision rather than against the rounded numbers printed for a
   * human to read. (Comparing a raw double with a `toFixed(4)` string is how the first
   * version of the placeholder check reported "0.2522 !== 0.2522".)
   */
  var vrmGazeReference = null;

  /**
   * The world-space rotation one gaze applies to a head, expressed in the STAGE's frame:
   * how far the character's forward direction tips toward the stage's up, and its right.
   *
   * Measured as "the gaze applied" against "no gaze applied", NOT against whatever pose the
   * head happened to be in. The gaze assigns the head from its rest pose, so comparing with a
   * live idle pose folds the idle's own head rotation into the result — the first version of
   * this measurement did exactly that on the widget's avatar (which is mid-idle) and
   * "found" a mismatch that was its own arithmetic.
   *
   * Shape-independent on purpose: two different avatar kinds must return the same numbers
   * for the same angles, which is what makes "one algorithm, no per-model cases" testable.
   */
  function gazeEffect(scene, head, yaw, pitch) {
    var THREE = VENDOR.THREE;
    var saved = head.quaternion.clone();
    scene.motion.lookAtPointer = true;
    scene.motion.setGaze(null);
    /**
     * Both ends of the RAMP are forced, because this helper measures the gaze ALGORITHM — which axes, which
     * limits, how the angles compose — and not the one-second blend the operator added on top of it
     * (2026-10-10, "1秒缓冲时间内均匀转头"). `applyGaze` reads `gazeBlend`: 0 is the rest pose, 1 is the full
     * turn. Without forcing them this helper would measure wherever the ramp happened to be.
     */
    scene.motion.gazeBlend = 0;
    scene.motion.applyGaze();
    var rested = new THREE.Quaternion();
    head.getWorldQuaternion(rested);
    scene.motion.setGaze({ yaw: yaw, pitch: pitch });
    scene.motion.gazeBlend = 1;
    scene.motion.applyGaze();
    var gazed = new THREE.Quaternion();
    head.getWorldQuaternion(gazed);
    head.quaternion.copy(saved);
    scene.motion.setGaze(null);
    var stage = new THREE.Quaternion();
    scene.stage.getWorldQuaternion(stage);
    var forward = new THREE.Vector3(0, 0, 1).applyQuaternion(stage);
    var up = new THREE.Vector3(0, 1, 0).applyQuaternion(stage);
    var right = new THREE.Vector3(1, 0, 0).applyQuaternion(stage);
    var delta = gazed.clone().multiply(rested.clone().invert());
    var tilted = forward.clone().applyQuaternion(delta);
    return { up: tilted.dot(up), right: tilted.dot(right) };
  }

  check('client, core, scene and vendor are all loaded', function () {
    return Boolean(CLIENT && CORE && SCENE && VENDOR);
  });
  if (!CLIENT || !CORE || !SCENE || !VENDOR) { finish(); return; }

  // --- Placement is pure enough to test without a DOM ----------------------
  check('Placement maps fractions to viewport pixels', function () {
    var placement = new CLIENT.Placement(CORE.cleanPreferences({ size: 100 }), function () { return 0; }, CORE);
    placement.setViewport(1000, 800);
    placement.setSize(200, 300);
    placement.x = 0.5;
    placement.y = 0.5;
    var pixels = placement.pixels();
    // y is measured from the BOTTOM, so a half-height pet centred vertically has
    // its top at 800*(1-0.5) - 300 = 100.
    return pixels.left === 500 && pixels.top === 100;
  });

  check('Placement refuses to work without the core module', function () {
    // Guards the failure mode that made the first version of these tests crash
    // mid-fall: a caller forgetting to attach `core` after construction.
    try {
      new CLIENT.Placement(CORE.cleanPreferences(null), function () { return 0; });
      return false;
    } catch (error) {
      return /core module/.test(error.message);
    }
  });

  check('Placement clamps the pet inside the frame', function () {
    var placement = new CLIENT.Placement(CORE.cleanPreferences(null), function () { return 0; }, CORE);
    placement.setViewport(500, 400);
    placement.setSize(200, 300);
    placement.x = 5;
    placement.y = -3;
    placement.clampToViewport();
    return placement.x <= 1 && placement.y >= 0 && placement.x >= 0 && placement.y <= 1;
  });

  /**
   * The reported bug: a pet thrown at the side of the frame reached the edge and
   * STAYED there, riding the wall down to the floor. A wall has to return speed.
   *
   * Asserted on the simulation rather than on the maths (which the logic suite
   * covers), because the property is about the whole flight: never outside the frame,
   * at least one rebound, and a landing on the bottom edge.
   */
  check('a pet thrown at a side wall rebounds and lands on the bottom edge', function () {
    var placement = new CLIENT.Placement(CORE.cleanPreferences({ size: 100 }), function () { return 0; }, CORE);
    placement.setViewport(1000, 800);
    placement.setSize(200, 300);
    placement.x = 0.4;
    placement.y = 0.6;
    // A hard throw to the left: the velocity is set directly, because a pointer path
    // that produced it would make the check depend on the drag maths instead.
    placement.fall = { y: 0.6, vy: 0, vx: -1.4, bounces: 0, floor: 0 };
    var rebounds = 0;
    var previous = -1.4;
    var outside = false;
    var frames = 0;
    while (placement.isAirborne() && frames < 3000) {
      placement.stepFall(1 / 60, CORE.FALL_PHYSICS);
      if (placement.x < 0 || placement.x > placement.maxX()) outside = true;
      if (Math.sign(placement.fall ? placement.fall.vx : previous) !== Math.sign(previous)) rebounds += 1;
      previous = placement.fall ? placement.fall.vx : previous;
      frames += 1;
    }
    report.wallBounce = {
      rebounds: rebounds,
      x: +placement.x.toFixed(4),
      y: +placement.y.toFixed(4),
      frames: frames,
      outside: outside
    };
    return rebounds >= 1 && !outside && placement.y === 0;
  });

  /**
   * The same property on the OTHER axis, and the second half of the same report: "the
   * side bounce works now, but the top edge does not".
   *
   * `Placement.stepFall` used to clamp `y` after each step, so a throw upward was caught
   * by the clamp: the pet stuck to the top edge and hung there while the rise it was
   * thrown with was discarded. The ceiling is now part of the simulation (`core.stepFall`),
   * which means the pet must come back off the top under its own restitution and finish
   * on the floor.
   */
  check('a pet thrown upward rebounds off the top edge and lands', function () {
    var placement = new CLIENT.Placement(CORE.cleanPreferences({ size: 100 }), function () { return 0; }, CORE);
    placement.setViewport(1000, 800);
    placement.setSize(200, 300);
    var ceiling = placement.maxY();
    placement.x = 0.4;
    placement.y = 0.1;
    // Thrown hard straight up. `vy` is positive upward, as the drag release computes it.
    placement.fall = { y: 0.1, vy: 2.6, vx: 0, bounces: 0, ceilingBounces: 0, floor: 0 };
    var peak = placement.y;
    var rebounds = 0;
    var previous = placement.fall.vy;
    var above = false;
    var frames = 0;
    while (placement.isAirborne() && frames < 3000) {
      placement.stepFall(1 / 60, CORE.FALL_PHYSICS);
      peak = Math.max(peak, placement.y);
      if (placement.y > ceiling + 1e-9) above = true;
      if (placement.fall && previous > 0 && placement.fall.vy <= 0) rebounds += 1;
      previous = placement.fall ? placement.fall.vy : previous;
      frames += 1;
    }
    report.ceilingBounce = {
      ceiling: +ceiling.toFixed(4),
      peak: +peak.toFixed(4),
      rebounds: rebounds,
      y: +placement.y.toFixed(4),
      frames: frames,
      above: above
    };
    return rebounds >= 1 && !above && peak <= ceiling + 1e-9 && placement.y === 0;
  });

  /**
   * The slot, and the reason `modelScale` is no longer applied to the model: scaling
   * the model inside a slot the camera was already fitted to pushed it past the canvas
   * edges. Folding it into the slot means the frame grows with it — and the slot is
   * capped at the viewport, because a slot larger than the frame cannot be brought
   * into view at all.
   */
  check('the pet slot folds in the model scale and stays a fraction of the frame', function () {
    var placement = new CLIENT.Placement(CORE.cleanPreferences({ size: 100, modelScale: 2 }), function () { return 0; }, CORE);
    placement.setViewport(4000, 4000);
    placement.setSize(220, 300);
    var doubled = placement.width === 440 && placement.height === 600;

    // A window too small for the requested size: the slot shrinks to a FRACTION of it,
    // not to the window itself. The pet's box is its hit area over a click-through
    // overlay, so a slot the size of the frame would take every click in the app — and
    // with `maxX` at 0 the pet could not even be dragged out of the way again. Both
    // halves are asserted: capped, and still movable.
    placement.setViewport(300, 200);
    placement.setSize(220, 300);
    var capped = placement.width < 300 && placement.height < 200;
    var movable = placement.maxX() > 0 && placement.height / 200 <= 0.6 + 1e-9;
    placement.x = 0.9;
    placement.clampToViewport();
    var clamped = placement.x === placement.maxX();

    report.slot = {
      doubled: doubled,
      capped: capped,
      movable: movable,
      width: placement.width,
      height: placement.height,
      maxX: +placement.maxX().toFixed(4)
    };
    return doubled && capped && movable && clamped;
  });

  check('a drag then release produces a falling pet that lands', function () {
    var clock = 0;
    var placement = new CLIENT.Placement(CORE.cleanPreferences(null), function () { return clock; }, CORE);
    placement.setViewport(1000, 800);
    placement.setSize(200, 300);
    placement.x = 0.5;
    placement.y = 0.9;

    placement.beginDrag(500, 80);
    // Move upward quickly, which is a throw.
    clock += 16; placement.moveDrag(500, 40);
    clock += 16; placement.moveDrag(500, 10);
    var fall = placement.endDrag();
    if (!fall) return false;

    var tick = 0;
    var airborne = true;
    while (airborne && tick < 1200) {
      clock += 1000 / 60;
      airborne = placement.stepFall(1 / 60, CORE.FALL_PHYSICS);
      tick += 1;
    }
    report.drag = { ticks: tick, landedY: +placement.y.toFixed(5), x: +placement.x.toFixed(5) };
    // It must come down, settle on a floor position, and stay in the frame.
    return !airborne && placement.y >= 0 && placement.y <= 1 && placement.x >= 0 && placement.x <= 1 && tick > 5;
  });

  check('throwing upward makes the pet rise before it falls', function () {
    var clock = 0;
    var placement = new CLIENT.Placement(CORE.cleanPreferences(null), function () { return clock; }, CORE);
    placement.setViewport(1000, 800);
    placement.setSize(200, 300);
    placement.x = 0.5;
    placement.y = 0.3;
    placement.beginDrag(500, 600);
    clock += 16; placement.moveDrag(500, 500);
    clock += 16; placement.moveDrag(500, 400);
    placement.endDrag();
    var startY = placement.y;
    var peak = startY;
    for (var i = 0; i < 60; i++) {
      clock += 1000 / 60;
      if (!placement.isAirborne()) break;
      placement.stepFall(1 / 60, CORE.FALL_PHYSICS);
      peak = Math.max(peak, placement.y);
    }
    report.throw = { startY: +startY.toFixed(4), peak: +peak.toFixed(4) };
    return peak > startY;
  });

  // --- the real widget -----------------------------------------------------
  var host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  document.body.appendChild(host);

  var widget = null;

  /** One entry of the OPEN menu, by the id `lib/menu.js` gives it. */
  function menuItem(id) {
    if (!widget.menu) return null;
    var nodes = widget.menu.element.querySelectorAll('.pet3d-menu-item');
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute('data-item') === id) return nodes[i];
    }
    return null;
  }

  /**
   * Click one entry the way a user does: a real click event on the item's own node.
   *
   * The menu closes and runs the action in that one handler, so this is also the assertion that the click
   * path exists — a menu that opened and did nothing would pass a check that only counted its entries.
   */
  function chooseMenuItem(id) {
    var item = menuItem(id);
    if (!item) return false;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  check('widget constructs and mounts its DOM', function () {
    widget = new CLIENT.Pet3DWidget(host, { language: 'en' });
    globalThis.__widget = widget;
    return Boolean(widget.root && widget.canvas && widget.pet && widget.menu);
  });
  if (!widget) { finish(); return; }

  /**
   * A MISSING OPTIONAL MODULE DEGRADES; IT DOES NOT KILL THE PET.
   *
   * This is the failure that was live on 2026-10-11: the app loaded a NEW `lib/client.js` against a core chunk
   * the browser had cached under an unchanged revision, so `new this.core.SpeechMachine(...)` threw inside the
   * widget's constructor, the widget never mounted, and the floating window — which has no session of its own —
   * kept drawing the last state it had been told (工作中, clock counting up) while `/pet3d/state` carried
   * `state: null` and that TypeError for seventeen minutes.
   *
   * The check removes BOTH optional globals (`SpeechMachine` and the shared panel module) and builds a widget
   * the way a stale delivery would: it must mount, render a frame, and answer "no voice, no panel" instead of
   * throwing.
   */
  check('a stale delivery costs the voice and the menu, never the pet', function () {
    var coreApi = globalThis.__PET3D_CORE__;
    var menuApi = globalThis.__PET3D_MENU__;
    var savedSpeech = coreApi.SpeechMachine;
    delete coreApi.SpeechMachine;
    delete globalThis.__PET3D_MENU__;
    // Its own host: the widget owns `root`, and a second mount in the same div is not what a second
    // delivery looks like.
    var host2 = document.createElement('div');
    document.body.appendChild(host2);
    var stale = null;
    var mounted = false;
    var rightClickSafe = false;
    try {
      stale = new CLIENT.Pet3DWidget(host2, { language: 'en' });
      stale.initScene();
      stale.tick(1 / 60);
      mounted = Boolean(stale.root && stale.canvas && stale.pet) && stale.menu === null;
      // The gesture that reaches the menu: with no module it must do NOTHING rather than throw, because a
      // right-click that kills the frame loop is the whole pet, not a feature.
      rightClickSafe = stale.openMenuAt(10, 10) === false;
    } finally {
      if (stale && typeof stale.dispose === 'function') { try { stale.dispose(); } catch (_error) { /* gone */ } }
      host2.remove();
      coreApi.SpeechMachine = savedSpeech;
      globalThis.__PET3D_MENU__ = menuApi;
    }
    report.staleDelivery = {
      mounted: mounted,
      menu: stale ? Boolean(stale.menu) : null,
      rightClickSafe: rightClickSafe,
      speech: stale ? Boolean(stale.speech) : null,
      speechMissing: stale ? stale.speechMissing === true : null,
      menuAvailable: stale ? stale.menuAvailable === false : null,
    };
    return mounted
      && report.staleDelivery.menu === false
      && report.staleDelivery.rightClickSafe === true
      && report.staleDelivery.speech === false
      && report.staleDelivery.speechMissing === true
      && report.staleDelivery.menuAvailable === true;
  });

  /**
   * An OLD menu chunk costs the 重力 MARK, never the menu.
   *
   * This is the other half of 「内置宠物右键单击无效」 (operator, 2026-10-12), and it is the failure this
   * repository has hit more often than any other: `lib/client.js` is fetched as one bundle and the menu as
   * another, both under a `rev=` a page can keep in its cache, so a newer host half can be paired with an
   * older menu module. `setChecked` is newer than the shipped chunk, so the unguarded call threw inside the
   * `contextmenu` handler and the menu never opened — a right-click that does nothing, for a reason visible
   * only in a console.
   *
   * The simulation is the honest one: the module is PRESENT and usable, with the one new method missing —
   * deleting the whole module (the check above) is a different failure and was already covered.
   */
  check('an older menu chunk loses the 重力 mark, not the menu', function () {
    var menuApi = globalThis.__PET3D_MENU__;
    var savedSetChecked = menuApi.setChecked;
    delete menuApi.setChecked;
    var host3 = document.createElement('div');
    document.body.appendChild(host3);
    var older = null;
    var opened = false;
    var rows = [];
    var threw = null;
    try {
      older = new CLIENT.Pet3DWidget(host3, { language: 'en' });
      older.initScene();
      try {
        opened = older.openMenuAt(40, 40) === true && older.menu.isOpen() === true;
        rows = older.menu.items().map(function (item) { return item.id; });
      } catch (error) {
        threw = String(error && error.message);
      }
    } finally {
      if (older && typeof older.dispose === 'function') { try { older.dispose(); } catch (_error) { /* gone */ } }
      host3.remove();
      menuApi.setChecked = savedSetChecked;
    }
    report.olderMenuChunk = { opened: opened, rows: rows.length, threw: threw };
    return threw === null && opened === true && rows.length > 0;
  });

  check('the canvas has a real WebGL context after initScene', function () {
    widget.initScene();
    var gl = widget.scene && widget.scene.renderer && widget.scene.renderer.getContext();
    return Boolean(gl && gl.getParameter(gl.VERSION));
  });

  check('the placeholder avatar is installed', function () {
    if (!widget.scene.avatar) widget.scene.usePlaceholder();
    return widget.scene.kind === 'placeholder' && widget.scene.avatar.root.children.length > 0;
  });

  check('the pet tick renders frames without throwing', function () {
    var before = widget.scene.frame;
    for (var i = 0; i < 5; i++) widget.tick(1 / 60);
    return widget.scene.frame > before;
  });

  check('every declared state is accepted by the scene and mirrored to the DOM', function () {
    // Drive each state through the machine, then let one tick propagate it. Poking
    // `data-state` directly would test nothing: tick() recomputes it from the
    // machine and would immediately overwrite the poke. The first version did
    // exactly that and could not fail for the right reason.
    var machine = widget.machine;
    for (var i = 0; i < CORE.STATES.length; i++) {
      var state = CORE.STATES[i];

      // A known baseline before every state: global scope, a ready catalog, one
      // session, nothing running. Without this the aggregate carries over the
      // previous iteration's scope and session id, and `resting` came out as
      // `offline` purely because the earlier `offline` case had cleared the
      // catalog while the scope was still 'current'.
      widget.aggregate.setInput({
        connected: true,
        scope: 'global',
        catalog: { byId: { s1: {} }, phase: 'ready' },
        statuses: new Map(),
        currentSessionId: 's1',
      });
      machine.reset();

      if (CORE.INTERACTION_STATES.indexOf(state) !== -1) {
        machine.setInteraction(state);
        // `landing` is the one interaction with a deadline: tick() clears it once
        // `landingUntil` has passed, which is how the impact pose ends. Arming the
        // window is therefore part of entering that state, not a test workaround.
        machine.landingUntil = Date.now() + 500;
      } else if (state === 'offline') {
        widget.aggregate.setInput({
          connected: false,
          scope: 'global',
          catalog: { byId: { s1: {} }, phase: 'ready' },
          statuses: new Map(),
          currentSessionId: 's1',
        });
      } else if (state === 'greeting') {
        machine.greet();
      } else if (state === 'waiting') {
        widget.aggregate.setInput({
          connected: true, scope: 'global',
          catalog: { byId: { s1: {} }, phase: 'ready' },
          statuses: new Map([['s1', { running: true, pendingInteraction: { id: 'x' } }]]),
          currentSessionId: 's1',
        });
      } else if (state === 'error') {
        machine.notice = { reason: 'error', at: Date.now() };
      } else if (state === 'done') {
        machine.notice = { reason: 'completed', at: Date.now() };
      } else if (state === 'working') {
        widget.aggregate.setInput({
          connected: true, scope: 'global',
          catalog: { byId: { s1: {} }, phase: 'ready' },
          statuses: new Map([['s1', { running: true }]]),
          currentSessionId: 's1',
        });
      } else if (state === 'sleeping') {
        machine.lastBusyAt = Date.now() - machine.sleepAfterMs - 1000;
      }

      widget.tick(1 / 60);
      var applied = widget.scene.state;
      var dom = widget.pet.getAttribute('data-state');
      if (applied !== state || dom !== state) {
        report.stateMismatch = { wanted: state, scene: applied, dom: dom };
        return false;
      }
    }
    return true;
  });

  /**
   * The in-app prompt: DSH's own running label, in the app's own theme.
   *
   * Asserted here rather than left to the window's check, because the two surfaces build the label in
   * different files — this one inside DSH, the window's in a standalone page — and only the shared core (the
   * wording, the clock, the whale path, the size) is common. Everything around that core is written twice, so
   * it is checked twice.
   */
  check('the in-app prompt is DSH’s own label, sized from the pet', function () {
    widget.aggregate.setInput({
      connected: true,
      scope: 'global',
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: true }]]),
      currentSessionId: 's1',
    });
    widget.machine.reset();
    /**
     * A TURN, because 用时 is DSH's turn clock and nothing else.
     *
     * The duration comes from the latest turn (`PetMachine.statusClock`), which the app learns from the boundary
     * frames — so a probe that wants DSH's own label has to hand it one, exactly as the stream does. The frame's
     * `time` is the turn's start, and that is what the label counts from.
     */
    widget.boundary({
      type: 'turn/start',
      sessionId: 's1',
      seq: 90,
      time: Date.now() - (14 * 60000 + 46000),
    });
    widget.tick(1 / 60);

    var label = widget.pet.querySelector('.pet3d-status');
    var texts = label ? label.querySelectorAll('.pet3d-status-text') : [];
    var icon = label ? label.querySelector('.pet3d-status-icon') : null;
    var decoration = label ? label.querySelector('.pet3d-status-decoration') : null;
    var shown = texts[0] ? texts[0].getAttribute('data-shimmer-text') : null;
    var fontPx = label ? label.style.getPropertyValue('--pet3d-status-font') : null;
    var path = icon ? icon.querySelector('path') : null;
    /**
     * The animated half of DSH's mark: a span masked through the APNG the host serves. Asserted because the
     * operator's own words were "dsh的鲸鱼尾巴是动画" — a static outline is the fallback, not the feature.
     */
    var animated = icon ? icon.querySelector('.pet3d-whale-animated') : null;
    var animatedStyle = animated && globalThis.getComputedStyle ? globalThis.getComputedStyle(animated) : null;
    report.inAppStatus = {
      text: shown,
      copies: texts.length,
      highlightMatches: Boolean(texts[1]) && texts[1].getAttribute('data-shimmer-text') === shown,
      iconDrawn: Boolean(icon) && icon.hidden === false,
      iconPath: path ? path.getAttribute('d').slice(0, 8) : null,
      animatedMask: animatedStyle ? animatedStyle.maskImage : null,
      animatedDisplay: animatedStyle ? animatedStyle.display : null,
      decorationVisible: Boolean(decoration) && decoration.hidden === false,
      fontPx: fontPx,
      expectedFontPx: CORE.statusPromptFontPx(widget.placement.height) + 'px',
    };
    var ok = Boolean(label) && label.hidden === false
      && String(shown).indexOf('深度求索中，用时 ') === 0
      && /秒 ···$/.test(String(shown))
      && texts.length === 2
      && report.inAppStatus.highlightMatches === true
      && report.inAppStatus.iconDrawn === true
      && report.inAppStatus.iconPath === 'M8.844 1'
      // The animated layer is ACTIVE in this browser (alpha masks, motion allowed) and points at the route.
      && String(report.inAppStatus.animatedMask).indexOf('pet3d/whale') !== -1
      && report.inAppStatus.animatedDisplay !== 'none'
      && report.inAppStatus.decorationVisible === true
      && report.inAppStatus.fontPx === report.inAppStatus.expectedFontPx;
    widget.machine.reset();
    return ok;
  });

  /**
   * 任务达成 gold and bold, 任务失败/出错 red — the operator's request of 2026-10-11, on the app's side.
   *
   * The DECISION is core's (`statusFor().tone`); what this checks is that the app actually WEARS it: the
   * `data-tone`/`data-bold` attributes and, more to the point, the COMPUTED style — a colour rule that never
   * matches a real element is exactly the failure this is here for. The shades are not asserted literally:
   * the app draws with `light-dark()` tokens, so the check is that the two notices differ from the ordinary
   * line and from each other, and that 任务达成 is the only one of the three that is bold.
   */
  check('the app draws 任务达成 in gold and bold, and 出错 in red', async function () {
    var readStyle = function () {
      var node = widget.pet.querySelector('.pet3d-status');
      var text = node ? node.querySelector('.pet3d-status-text') : null;
      var style = globalThis.getComputedStyle ? globalThis.getComputedStyle(node) : null;
      return {
        // The words live in `data-shimmer-text` and are drawn by `content:attr(...)`: the span itself is empty.
        text: text ? text.getAttribute('data-shimmer-text') : null,
        tone: node ? node.getAttribute('data-tone') : null,
        bold: node ? node.getAttribute('data-bold') : null,
        weight: style ? style.fontWeight : null,
        color: style ? style.color : null,
        hidden: node ? node.hidden : null,
      };
    };

    widget.machine.reset();
    widget.machine.boundary(widget.aggregate.snapshot(),
      { type: 'turn/end', sessionId: 's1', seq: 41, reason: 'completed' });
    // A completion waits out its settle window before the pet says 任务达成 (`COMPLETION_SETTLE_MS`), so the clock
    // this check runs on is the real one: wait it out rather than assert the old immediate behaviour.
    await settleCompletion();
    widget.tick(1 / 60);
    var done = readStyle();

    widget.machine.reset();
    widget.machine.boundary(widget.aggregate.snapshot(),
      { type: 'turn/end', sessionId: 's1', seq: 42, reason: 'error' });
    widget.tick(1 / 60);
    var failed = readStyle();

    widget.machine.reset();
    widget.tick(1 / 60);
    var ordinary = readStyle();

    report.toneStyles = { done: done, error: failed, ordinary: ordinary };
    widget.machine.reset();
    return done.text === '任务达成' && done.tone === 'gold' && done.bold === '1'
      && failed.text === '遇到问题了...' && failed.tone === 'danger' && failed.bold === null
      && ordinary.tone === null && ordinary.bold === null
      && done.weight === '700' && failed.weight !== '700'
      && Boolean(done.color) && done.color !== ordinary.color && failed.color !== ordinary.color
      && done.color !== failed.color;
  });

  /**
   * 碎碎念 in the app: the pet's own short line, throttled, and NEVER anything but a shipped one.
   *
   * The privacy rule is asserted here rather than trusted: the aggregate hands the widget a session id and a
   * status, and the bubble must still contain only a line from `SPEECH_LINES` — no ids, no paths, nothing the
   * session produced. The throttle is asserted through the machine's own clock: a second frame keeps the same
   * line, an expired hold clears it, and an idle pet does not immediately invent a new one.
   */
  check('the pet says a shipped line of its own, once, and then goes quiet', async function () {
    var node = widget.pet.querySelector('.pet3d-speech');
    var running = {
      connected: true,
      scope: 'global',
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: true }]]),
      currentSessionId: 's1',
    };
    var idleInput = {
      connected: true,
      scope: 'global',
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: false }]]),
      currentSessionId: 's1',
    };

    widget.aggregate.setInput(running);
    widget.machine.reset();
    // A CLEAN voice for this check: earlier checks drove the same widget through other states, and a line they
    // left held is (correctly) still up — "one line at a time" is the rule under test, not a fixture.
    widget.speech.clear();
    widget.tick(1 / 60);
    var line = widget.speechShown;
    // The widget's OWN language decides which column of the table is used, so the check reads the same column
    // rather than assuming Chinese in a browser whose locale is English.
    var workingLines = CORE.speechLines(widget.language, 'working');
    var visible = Boolean(node) && node.hidden === false;
    var text = node ? node.textContent : null;
    // The 状态 prompt is up as well (工作中), and the bubble is offset above it rather than on top of it.
    var promptUp = Boolean(widget.statusNode) && widget.statusNode.hidden === false;
    var offset = node ? node.style.getPropertyValue('--pet3d-speech-offset') : null;
    var abovePrompt = Number(String(offset).replace('px', '')) > 0;
    // One line at a time: another frame keeps exactly the same words.
    widget.tick(1 / 60);
    var held = widget.speechShown === line;

    // The hold expires while the SAME event is still running: the pet goes quiet rather than repeating itself,
    // which is what clears the bubble (and therefore what the host relays as "no line").
    if (widget.speech.current) widget.speech.current.until = Date.now() - 1;
    widget.tick(1 / 60);
    var cleared = Boolean(node) && node.hidden === true && widget.speechShown === null;

    // A DIFFERENT event speaks again, so the rule is "not twice in a row" rather than "once per session".
    widget.aggregate.setInput({
      connected: true,
      scope: 'global',
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: false }]]),
      currentSessionId: 's1',
    });
    widget.machine.reset();
    widget.machine.boundary({ type: 'turn/end', sessionId: 's1', seq: 1, reason: 'completed' });
    // The 任务达成 state is what speaks the done line, and it arrives after the settle window.
    await settleCompletion();
    widget.tick(1 / 60);
    var second = widget.speechShown;
    var secondFromTable = CORE.speechLines(widget.language, 'done').indexOf(second) !== -1;

    // And the off switch is silence, whatever the state does.
    widget.preferences.speech = CORE.cleanSpeech({ enabled: false });
    widget.aggregate.setInput(running);
    widget.machine.reset();
    widget.tick(1 / 60);
    var muted = Boolean(node) && node.hidden === true;
    widget.preferences.speech = CORE.cleanSpeech({});

    report.inAppSpeech = {
      visible: visible,
      text: text,
      fromTheTable: workingLines.indexOf(line) !== -1,
      mentionsSession: String(text || '').indexOf('s1') !== -1,
      promptUp: promptUp,
      offset: offset,
      abovePrompt: abovePrompt,
      held: held,
      cleared: cleared,
      second: second,
      secondFromTable: secondFromTable,
      muted: muted,
    };
    return Boolean(node) && visible && text === line
      && report.inAppSpeech.fromTheTable === true
      && report.inAppSpeech.mentionsSession === false
      && promptUp && abovePrompt && held && cleared && secondFromTable && muted;
  });

  /**
   * The AI 碎碎念 path: the widget asks the host, and the answer is what the bubble says.
   *
   * The core cannot make this call — it is a pure machine with an injected clock and no network — so the whole
   * point of the split is that the SURFACE turns an intent into a request. Two things are asserted here that no
   * unit test can see: exactly ONE request per event (this code runs sixty times a second), and the fallback line
   * staying up until the answer arrives rather than the bubble going empty in the meantime.
   */
  asyncCheck('with AI 碎碎念 on, the widget asks the host once and then says what came back', function () {
    var node = widget.pet.querySelector('.pet3d-speech');
    var realFetch = globalThis.fetch;
    var calls = [];
    globalThis.fetch = function (url, options) {
      var href = String(url);
      if (href.indexOf('/pet3d/say') === -1) {
        return realFetch
          ? realFetch.apply(globalThis, arguments)
          : Promise.reject(new Error('unexpected fetch ' + href));
      }
      var body = null;
      try { body = JSON.parse((options && options.body) || 'null'); } catch (_error) { body = null; }
      calls.push({ url: href, method: options && options.method, body: body });
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ text: '来自宿主的一句', state: 'working', ms: 12 }); },
      });
    };

    var restore = function () { globalThis.fetch = realFetch; };
    return Promise.resolve()
      .then(function () {
        widget.speech.clear();
        widget.speechAi = { handled: 0, inFlight: false, promise: null };
        widget.preferences.speech = CORE.cleanSpeech({ source: 'ai', lines: { working: '兜底的一句' } });
        /**
         * The state is passed IN rather than resolved from the aggregate: this check is about the AI plumbing
         * (intent → request → answer), and the checks before it have left the machine on a completion notice,
         * which would otherwise decide which state — and therefore which box — this check tests.
         */
        var fallback = widget.speechLine('working');
        widget.tick(1 / 60);
        // Frames while the model "thinks": the frame loop must not queue a second request.
        widget.tick(1 / 60);
        widget.tick(1 / 60);
        widget.tick(1 / 60);
        // The ask itself starts on a microtask, so the count is read after one turn of the loop rather than
        // before it — four frames must still mean exactly one request.
        return Promise.resolve().then(function () {
          var asked = calls.length;
          return Promise.resolve(widget.speechAi.promise).then(function () {
            widget.tick(1 / 60);
            report.speechAi = {
              askedForFourFrames: asked,
              calls: calls.length,
              method: calls[0] ? calls[0].method : null,
              state: calls[0] && calls[0].body ? calls[0].body.state : null,
              event: calls[0] && calls[0].body ? calls[0].body.event : null,
              fallback: fallback,
              shown: widget.speechShown,
              hidden: Boolean(node) && node.hidden === true,
            };
            widget.preferences.speech = CORE.cleanSpeech({});
            return calls.length === 1
              && report.speechAi.askedForFourFrames === 1
              && report.speechAi.fallback === '兜底的一句'
              && report.speechAi.shown === '来自宿主的一句'
              && report.speechAi.state === 'working'
              && report.speechAi.event === 'working'
              && report.speechAi.method === 'POST'
              && report.speechAi.hidden === false;
          });
        });
      })
      .then(function (result) { restore(); return result; }, function (error) { restore(); throw error; });
  });

  /**
   * A press on a PART says that part's line — the second reason the pet speaks (2026-10-11).
   *
   * Driven through `notePress`, which is what all three gesture call sites use, so this asserts the whole chain
   * the settings page configures: the structure the user added, the part it belongs to, the line that part owns,
   * and the touch the host is told about. Then the AI half: with the source on `ai`, the request must name the
   * PART (that is what selects its prompt on the host) and the answer must land in the bubble.
   */
  asyncCheck('a press on a part says that part\'s line, and asks the host about that part', function () {
    var realFetch = globalThis.fetch;
    var calls = [];
    globalThis.fetch = function (url, options) {
      var href = String(url);
      if (href.indexOf('/pet3d/say') === -1) {
        return realFetch
          ? realFetch.apply(globalThis, arguments)
          : Promise.reject(new Error('unexpected fetch ' + href));
      }
      var body = null;
      try { body = JSON.parse((options && options.body) || 'null'); } catch (_error) { body = null; }
      calls.push({ url: href, method: options && options.method, body: body });
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve({ text: '模型写的耳朵台词', state: 'working', part: 'ear', ms: 9 }); },
      });
    };
    var restore = function () { globalThis.fetch = realFetch; };
    return Promise.resolve()
      .then(function () {
        widget.speech.clear();
        widget.speechAi = { handled: 0, inFlight: false, promise: null };
        var prefs = CORE.cleanPreferences({
          speech: { enabled: true, source: 'custom', holdSeconds: 5, lines: { working: '状态台词' } },
          parts: {
            items: [
              { id: 'ear', label: '耳朵', match: ['ErDuo'], speech: { lines: ['别摸耳朵', '痒'] } },
              { id: 'body', label: '身体', region: 'body' },
            ],
          },
        });
        widget.preferences.speech = prefs.speech;
        widget.preferences.parts = prefs.parts;
        widget.speechEvent = null;
        var ear = CORE.partItemById(widget.preferences, 'ear');
        var body = CORE.partItemById(widget.preferences, 'body');
        /**
         * The chain is deliberately an UNNAMED one (`name: null`) with a root-joint label: that is the VRM 0.x
         * twintail case, and it makes this check cover the fallback as well — the name that travels must be the root
         * bone (`TwinTail.A.002.L`), not the positional key `hair0`.
         */
        var springChain = { key: 'hair0', name: null, label: 'TwinTail.A.002.L', joints: 13 };
        var said = widget.notePress('click', { region: 'head', part: ear, bone: 'ErDuo.L.002', mesh: null, chain: springChain });
        var out = {
          said: widget.speech.current ? widget.speech.current.text : null,
          partOnLine: widget.speech.current ? widget.speech.current.part : null,
          touchPart: widget.pendingTouch ? widget.pendingTouch.part : null,
          touchLabel: widget.pendingTouch ? widget.pendingTouch.label : null,
          touchMesh: widget.pendingTouch ? widget.pendingTouch.mesh : null,
          touchChain: widget.pendingTouch && widget.pendingTouch.chain ? widget.pendingTouch.chain.key : null,
        };
        // A DRAG is not a remark: the pet is being carried, so nothing is said about the part.
        widget.speech.clear();
        widget.notePress('drag', { region: 'head', part: ear, bone: 'ErDuo.L.002', mesh: null });
        out.dragSaid = widget.speech.current ? widget.speech.current.text : null;
        // The part with an empty box borrows the state's own line (NOT the shipped table, which answers a
        // different question). The event in force is set explicitly: the widget remembers it from `speechLine`,
        // and this check drives presses without a state machine behind them.
        widget.speech.clear();
        widget.speechEvent = 'working';
        widget.notePress('click', { region: 'body', part: body, bone: 'Spine', mesh: null });
        out.borrowed = widget.speech.current ? widget.speech.current.text : null;
        widget.speech.clear();
        widget.preferences.speech = CORE.cleanSpeech({ source: 'ai', holdSeconds: 5, lines: { working: 'AI 兜底' } });
        widget.speechAi = { handled: 0, inFlight: false, promise: null };
        widget.notePress('click', { region: 'head', part: ear, bone: 'ErDuo.L.002', mesh: null, chain: springChain });
        out.aiFallback = widget.speech.current ? widget.speech.current.text : null;
        out.wantsPart = widget.speech.wantsAi ? widget.speech.wantsAi.part : null;
        out.wantsStructure = widget.speech.wantsAi ? widget.speech.wantsAi.structure : null;
        out.wantsChain = widget.speech.wantsAi ? widget.speech.wantsAi.chain : null;
        return Promise.resolve(widget.speechAi.promise).then(function () {
          widget.tick(1 / 60);
          out.aiShown = widget.speechShown;
          out.calls = calls.length;
          out.sentPart = calls[0] && calls[0].body ? calls[0].body.part : null;
          out.sentState = calls[0] && calls[0].body ? calls[0].body.state : null;
          // WHAT was touched travels too: it is what lets a part with no prompt of its own be answered, and the
          // browser request is the only place the page's own wording of that can be checked.
          out.sentStructure = calls[0] && calls[0].body ? calls[0].body.structure : null;
          out.sentChain = calls[0] && calls[0].body ? calls[0].body.chain : null;
          report.pressSpeech = out;
          // Put the widget back where the checks after this one expect it.
          widget.speech.clear();
          widget.preferences.speech = CORE.cleanSpeech({});
          widget.preferences.parts = CORE.cleanPreferences({}).parts;
          return out.said !== null && out.dragSaid === null
            && out.partOnLine === 'ear' && out.touchPart === 'ear' && out.touchLabel === '耳朵'
            && out.touchMesh === null && out.touchChain === 'hair0'
            && out.borrowed === '状态台词'
            && (out.aiFallback === '别摸耳朵' || out.aiFallback === '痒')
            && out.wantsPart === 'ear' && out.wantsStructure === 'ErDuo.L.002'
            && out.wantsChain === 'TwinTail.A.002.L'
            && out.sentPart === 'ear' && out.sentState === 'working'
            && out.sentStructure === 'ErDuo.L.002' && out.sentChain === 'TwinTail.A.002.L'
            && out.aiShown === '模型写的耳朵台词';
        });
      })
      .then(function (result) { restore(); return result; }, function (error) { restore(); throw error; });
  });

  /**
   * The two gestures, and the rule that separates them.
   *
   * The operator's own words: "鼠标滚轮在提示文字上时，只缩放状态提示文字（防止某些模型和提示文字不匹配）；鼠标滚轮
   * 在模型上时，提示文字和模型同步缩放；记住每个模型提示文字大小的偏好；提示文字永不换行".
   *
   * Asserted behaviourally — a real WheelEvent at real coordinates — because the whole feature is *where the
   * pointer is*, and a test that called `stepStatusScale` directly would prove nothing about that.
   */
  check('a wheel on the text scales only the text; a wheel on the pet scales both', function () {
    widget.aggregate.setInput({
      connected: true,
      scope: 'global',
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: true }]]),
      currentSessionId: 's1',
    });
    widget.machine.reset();
    widget.tick(1 / 60);

    var label = widget.pet.querySelector('.pet3d-status');
    if (!label || label.hidden) {
      report.wheelGesture = { shown: false };
      return false;
    }
    /**
     * A model to correct. `currentModelId` resolves against the catalog, so the catalog has to know it: the
     * correction is stored PER MODEL, and with no model there is nothing to store it under — the core refuses
     * an empty id on purpose, because a correction belongs to a model.
     */
    widget.catalog = { models: [{ id: 'wheel-model', name: 'wheel-model' }] };
    widget.preferences.modelId = 'wheel-model';
    var modelId = widget.currentModelId();
    if (!modelId) {
      report.wheelGesture = { shown: true, modelId: null };
      return false;
    }
    var rect = label.getBoundingClientRect();
    var sizeBefore = widget.preferences.size;
    var scaleBefore = CORE.statusScaleFor(widget.preferences, modelId);

    // Dispatched ON the element the pointer would be over, so the browser's own bubbling decides who hears it:
    // the prompt for the text gesture, the canvas for the pet gesture. Both reach the `.pet3d-pet` listener.
    function wheelOn(node, x, y, deltaY) {
      node.dispatchEvent(new WheelEvent('wheel', {
        deltaY: deltaY, clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
    }

    // ON THE TEXT: the prompt's own rectangle, dead centre.
    wheelOn(label, rect.left + rect.width / 2, rect.top + rect.height / 2, -100);
    var textOnly = {
      size: widget.preferences.size,
      scale: CORE.statusScaleFor(widget.preferences, modelId),
      stored: widget.preferences.statusScale,
    };

    // ON THE PET: the middle of the box, well below the prompt.
    var box = widget.pet.getBoundingClientRect();
    wheelOn(widget.canvas, box.left + box.width / 2, box.top + box.height * 0.8, -100);
    var onPet = {
      size: widget.preferences.size,
      scale: CORE.statusScaleFor(widget.preferences, modelId),
    };

    /**
     * And the correction has to LEAVE the surface.
     *
     * The host store is the source of truth both pets read, so a preference a surface does not push is a
     * preference the next snapshot takes away again. That was the window's bug — its push list had no
     * `statusScale`, so wheeling the model undid the wheel on the text ("缩放模型的时候又恢复原状了") — and the
     * only way to see it from inside the page is to look at the PATCH, because the page's own copy never lost
     * the correction.
     */
    var pushed = [];
    var hostSync = widget.hostSync;
    var realPush = hostSync ? hostSync.push : null;
    if (hostSync) hostSync.push = function (body) { pushed.push(body); return Promise.resolve(null); };
    widget.preferences.statusScale = CORE.setStatusScale(widget.preferences, modelId, 1.3);
    widget.writeStorage();
    if (hostSync) hostSync.push = realPush;
    var pushedPatch = pushed.length && pushed[0].preferences ? pushed[0].preferences : null;

    report.wheelGesture = {
      modelId: modelId,
      sizeBefore: sizeBefore,
      scaleBefore: scaleBefore,
      textOnly: textOnly,
      onPet: onPet,
      pushedScale: pushedPatch ? pushedPatch.statusScale : null,
      whiteSpace: globalThis.getComputedStyle(widget.pet.querySelector('.pet3d-status-text')).whiteSpace,
      promptRect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) },
    };

    var ok = textOnly.scale > scaleBefore            // the text grew…
      && textOnly.size === sizeBefore                // …and the PET did not move at all
      && onPet.size !== sizeBefore                   // a wheel on the pet resizes the pet…
      && onPet.scale === textOnly.scale              // …without touching the correction the text gesture set
      && Boolean(textOnly.stored) && textOnly.stored[modelId] === textOnly.scale // remembered PER MODEL
      && Boolean(pushedPatch) && Boolean(pushedPatch.statusScale)                // and pushed to the host…
      && pushedPatch.statusScale[modelId] === 1.3                                // …so a snapshot cannot drop it
      && report.wheelGesture.whiteSpace === 'nowrap'; // "提示文字永不换行"

    // Put the preference back the way it was, so no other check inherits a correction.
    widget.preferences.statusScale = CORE.setStatusScale(widget.preferences, modelId, 1);
    widget.preferences.size = sizeBefore;
    widget.applyPlacement();
    widget.machine.reset();
    return ok;
  });

  check('the machine drives the DOM state from a session snapshot', function () {
    widget.machine.reset();
    widget.aggregate.setInput({
      connected: true,
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: true }]]),
      scope: 'global',
      currentSessionId: 's1',
    });
    widget.tick(1 / 60);
    var working = widget.pet.getAttribute('data-state');

    widget.aggregate.setInput({
      connected: true,
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map([['s1', { running: true, pendingInteraction: { id: 'x' } }]]),
      scope: 'global',
      currentSessionId: 's1',
    });
    widget.tick(1 / 60);
    var waiting = widget.pet.getAttribute('data-state');

    widget.aggregate.setInput({
      connected: false,
      catalog: { byId: {}, phase: 'ready' },
      statuses: new Map(),
      scope: 'global',
    });
    widget.tick(1 / 60);
    var offline = widget.pet.getAttribute('data-state');

    report.states = { working: working, waiting: waiting, offline: offline };
    return working === 'working' && waiting === 'waiting' && offline === 'offline';
  });

  check('a turn boundary shows 任务完成', async function () {
    widget.aggregate.setInput({
      connected: true,
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map(),
      scope: 'global',
      currentSessionId: 's1',
    });
    widget.boundary({ type: 'turn/start', sessionId: 's1', seq: 1 });
    widget.boundary({ type: 'turn/end', sessionId: 's1', seq: 2, reason: 'completed' });
    widget.tick(1 / 60);
    // Withheld at first: a task is not a turn, so the pet waits out `COMPLETION_SETTLE_MS` before congratulating.
    var withheld = widget.pet.getAttribute('data-state') !== 'done';
    await settleCompletion();
    widget.tick(1 / 60);
    report.turnBoundary = { withheld: withheld, state: widget.pet.getAttribute('data-state') };
    return withheld && widget.pet.getAttribute('data-state') === 'done';
  });

  check('dragging the widget enters held, and releasing makes it fall', function () {
    // Clear everything that outranks an interaction — the previous check left a
    // completion notice and a greeting live, so `data-state` read "done" and
    // this test measured the residue of the test before it.
    widget.machine.reset();
    widget.aggregate.setInput({
      connected: true,
      catalog: { byId: { s1: {} }, phase: 'ready' },
      statuses: new Map(),
      scope: 'global',
      currentSessionId: 's1',
    });

    var pet = widget.pet;
    var rect = pet.getBoundingClientRect();
    var opts = { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: rect.left + 10, clientY: rect.top + 10 };
    pet.dispatchEvent(new PointerEvent('pointerdown', opts));
    // OnPointerDown sets the interaction synchronously, so read it before ticking:
    // tick() derives data-state from the machine and would otherwise be racing the
    // assertion.
    var interactionHeld = widget.machine.interaction === 'held';
    widget.tick(1 / 60);
    var held = widget.pet.getAttribute('data-state');

    pet.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, opts, {
      clientX: rect.left + 60, clientY: rect.top + 60,
    })));
    pet.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opts, {
      clientX: rect.left + 60, clientY: rect.top + 60,
    })));
    var falling = widget.machine.interaction === 'falling' || widget.placement.isAirborne();
    report.dragLifecycle = { held: held, interactionHeld: interactionHeld, falling: falling };
    return interactionHeld && held === 'held' && falling;
  });

  check('a completed fall returns the pet to the session-driven state', function () {
    var guard = 0;
    while (widget.placement.isAirborne() && guard < 2000) {
      widget.tick(1 / 60);
      guard += 1;
    }
    // The landing pose holds briefly on the real wall clock, so wait for it rather
    // than asserting on the first frame after touchdown. It is also why this page
    // finishes on a timer: the asynchronous checks need a real turn to settle.
    var landingStart = Date.now();
    while (widget.machine.interaction === 'landing' && Date.now() - landingStart < 2000) {
      widget.tick(1 / 60);
    }
    var landingMs = Date.now() - landingStart;
    widget.tick(1 / 60);
    var state = widget.pet.getAttribute('data-state');
    report.afterLanding = { state: state, fallFrames: guard, landingMs: landingMs };
    return !widget.placement.isAirborne() && state !== 'falling' && state !== 'held' && state !== 'landing';
  });

  check('preferences round-trip through localStorage', function () {
    widget.preferences.size = 130;
    widget.preferences.motion = false;
    widget.writeStorage();
    var raw = window.localStorage.getItem(CORE.STORAGE_KEY);
    var parsed = JSON.parse(raw);
    return parsed.size === 130 && parsed.motion === false;
  });

  /**
   * The size slider is gone and the wheel is the control. Three things have to hold,
   * and each of them was a way the first draft of this could have been wrong:
   * no range input is left in the pet, the wheel changes the pet's own slot, and
   * the change is persisted so it survives a reload.
   *
   * 重置大小 is NOT asserted here any more: it is a MENU entry now (the panel and its
   * `.pet3d-size-reset` button went with the panel), and the menu check below clicks the real item.
   * What this one adds is the other half — that no size control was left behind on the pet's own
   * chrome, which a leftover stepper would have been.
   */
  check('the size slider is gone and the wheel zooms the pet', function () {
    var ranges = widget.root.querySelectorAll('input[type=range]');
    var leftovers = widget.root.querySelectorAll('.pet3d-size-reset, .pet3d-stepper, .pet3d-model-cycle');
    widget.resetSize();
    var before = widget.placement.width;
    var rect = widget.pet.getBoundingClientRect();
    widget.pet.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -100, clientX: rect.left + 5, clientY: rect.top + 5
    }));
    var grew = widget.preferences.size > CORE.DEFAULTS.size && widget.placement.width > before;
    // The canvas follows the slot: the drawing buffer is what makes the model bigger
    // rather than a stretched bitmap, and it is also what keeps it inside the frame.
    var bufferFollowed = widget.scene ? widget.scene.width === widget.placement.width : true;
    widget.pet.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: 100, clientX: rect.left + 5, clientY: rect.top + 5
    }));
    var shrank = widget.preferences.size === CORE.DEFAULTS.size;
    var stored = JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}');
    report.zoom = {
      ranges: ranges.length,
      leftovers: leftovers.length,
      size: widget.preferences.size,
      width: widget.placement.width,
      stored: stored.size
    };
    return ranges.length === 0 && leftovers.length === 0 && grew && bufferFollowed && shrank && stored.size === CORE.DEFAULTS.size;
  });

  /**
   * Zooming out to the top of the range must not push the pet outside the frame —
   * the "the enlarged model sticks out of its frame" report, checked at the extreme
   * the wheel can reach.
   */
  check('the wheel cannot zoom the pet outside the frame', function () {
    var rect = widget.pet.getBoundingClientRect();
    for (var i = 0; i < 60; i++) {
      widget.pet.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -100, clientX: rect.left + 5, clientY: rect.top + 5
      }));
    }
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    // Two limits, both load-bearing. The slot must fit the frame, and in the APP overlay it must
    // stay a FRACTION of it: the pet's box is its hit area, so a full-frame pet would swallow
    // every click in the app and could not be dragged anywhere (maxX/maxY would be 0). The wheel's
    // own ceiling is derived from the frame now — the frame's shortest edge, reduced by that
    // fraction — so the assertion compares against the frame's limits rather than a fixed maximum.
    var inside = widget.placement.width <= viewportWidth
      && widget.placement.height <= viewportHeight
      && widget.placement.x >= 0
      && widget.placement.x <= widget.placement.maxX();
    var roomToDrag = widget.placement.maxX() > 0.1
      && widget.placement.width < viewportWidth;
    // Read the size BEFORE putting it back: the first version of this check returned
    // `preferences.size === SIZE_RANGE.max` after calling resetSize(), so it asserted
    // the default against the maximum and failed on its own bookkeeping.
    var limits = widget.placement.zoomLimits(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height);
    var atMax = widget.preferences.size === limits.max;
    report.zoomMax = {
      size: widget.preferences.size,
      limits: limits,
      width: widget.placement.width,
      height: widget.placement.height,
      viewport: [viewportWidth, viewportHeight],
      inside: inside,
      roomToDrag: roomToDrag,
      maxX: +widget.placement.maxX().toFixed(4)
    };
    // Back to the default for the checks that follow.
    widget.resetSize();
    return atMax && inside && roomToDrag;
  });

  /**
   * 重置大小 and 重置视角, through the menu the user actually uses.
   *
   * The entries ARE the controls now (the panel's own buttons are gone with the panel), so this drives a real
   * click on the real item: an entry that is listed but not wired looks exactly like one that works from
   * anywhere except a click.
   *
   * 重置视角 is deliberately NOT the whole-pet reset the old panel's 重置 button was: a user who has just turned
   * the pet around wants its angle back, and the bystander key asserted below is what says so.
   */
  check('the 重置大小 and 重置视角 entries do exactly what they say', function () {
    widget.closeMenu();
    widget.zoomBy(1);
    widget.zoomBy(1);
    var zoomed = widget.preferences.size;
    widget.openMenuAt(80, 80);
    var listed = Boolean(menuItem('resetSize'));
    var clickedSize = chooseMenuItem('resetSize');
    var stored = JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}');
    var closedAfterClick = widget.menu.isOpen() === false;

    widget.preferences.viewYaw = 0.42;
    widget.preferences.viewPitch = 0.18;
    widget.preferences.sleepAfterMs = 120000;
    widget.openMenuAt(80, 80);
    var clickedView = chooseMenuItem('resetView');
    var storedView = JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}');

    report.sizeReset = { zoomed: zoomed, after: widget.preferences.size, stored: stored.size };
    report.viewReset = {
      yaw: widget.preferences.viewYaw,
      pitch: widget.preferences.viewPitch,
      storedYaw: storedView.viewYaw,
      bystander: widget.preferences.sleepAfterMs,
    };
    return listed && clickedSize && clickedView && closedAfterClick
      && zoomed > CORE.DEFAULTS.size
      && widget.preferences.size === CORE.DEFAULTS.size
      && stored.size === CORE.DEFAULTS.size
      && widget.preferences.viewYaw === CORE.DEFAULTS.viewYaw
      && widget.preferences.viewPitch === CORE.DEFAULTS.viewPitch
      && Math.abs(storedView.viewYaw || 0) < 1e-9
      && widget.preferences.sleepAfterMs === 120000;
  });

  /**
   * The two settings entries ask the HOST for a window, with the model that is on screen.
   *
   * They are the only way to reach the settings from the pet now, so the action names and the model in the
   * body are asserted against the route the host reads (`POST /pet3d/desktop`), not against a label.
   */
  asyncCheck('the settings entries ask the host for the right page', function () {
    var asked = [];
    var restoreFetch = stubFetch({
      '/pet3d/desktop': function (url, options) {
        asked.push({ url: String(url), method: (options && options.method) || 'GET', body: options && options.body });
        return { ok: true, json: function () { return Promise.resolve({ state: 'config-open' }); } };
      },
    });
    widget.catalog = { models: [{ id: 'miku', name: 'HatsuneMikuNT.vrm' }] };
    widget.preferences.modelId = 'miku';
    widget.closeMenu();
    widget.openMenuAt(80, 80);
    chooseMenuItem('modelSettings');
    widget.openMenuAt(80, 80);
    chooseMenuItem('globalSettings');
    restoreFetch();
    var bodies = asked.map(function (entry) {
      try { return JSON.parse(entry.body); } catch (error) { return null; }
    });
    report.settingsEntries = { asked: bodies };
    return bodies.length === 2
      && bodies[0] && bodies[0].action === 'config' && bodies[0].modelId === 'miku'
      && bodies[1] && bodies[1].action === 'settings';
  });

  /**
   * The secondary button does two jobs, and the difference is movement: a drag orbits
   * the camera, a click opens the panel. Both paths are asserted, because a version
   * that only did one of them would still look right in a screenshot.
   */
  check('a right-drag orbits the view and leaves the menu shut', function () {
    widget.closeMenu();
    widget.preferences.viewYaw = 0;
    widget.preferences.viewPitch = 0;
    var rect = widget.pet.getBoundingClientRect();
    // `buttons: 2` on the press and the move: the widget reads the BUTTON STATE to notice a release that was
    // never delivered (the operator's "未释放状态", 2026-10-09), so a synthetic right-drag has to say the button
    // is down, exactly as a real one does. The release declares 0.
    var base = { bubbles: true, cancelable: true, pointerId: 77, button: 2, buttons: 2, clientX: rect.left + 20, clientY: rect.top + 20 };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', base));
    widget.pet.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, {
      clientX: rect.left + 90, clientY: rect.top + 60
    })));
    widget.pet.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, {
      buttons: 0, clientX: rect.left + 90, clientY: rect.top + 60
    })));
    // The menu event that follows a real right-button release.
    widget.pet.dispatchEvent(new MouseEvent('contextmenu', Object.assign({}, base, { button: 2 })));
    var orbited = widget.preferences.viewYaw > 0 && widget.preferences.viewPitch > 0;
    var stored = JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}');
    report.orbit = {
      yaw: +widget.preferences.viewYaw.toFixed(4),
      pitch: +widget.preferences.viewPitch.toFixed(4),
      menuOpen: widget.menu.isOpen(),
      stored: +((stored.viewYaw || 0)).toFixed(4)
    };
    return orbited && widget.menu.isOpen() === false && Math.abs(stored.viewYaw) > 0;
  });

  /**
   * ---- and the two halves of the operator's report (2026-10-09) ----
   *
   * "右键旋转时鼠标一旦挪动离开小框架，旋转就失效了，而且模型属于未释放状态": the orbit died as soon as the pointer
   * left the pet's little frame, and the gesture never released. Both are measured by dispatching the moves
   * and the release at the WINDOW — outside the pet entirely, which is where the pointer goes and where the
   * document-level listener could be silenced by anything in between.
   */
  check('a right-drag that leaves the pet keeps turning the view', function () {
    var yawBefore = widget.preferences.viewYaw || 0;
    var rect = widget.pet.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, pointerId: 79, button: 2, buttons: 2,
      clientX: rect.left + 20, clientY: rect.top + 20 };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', base));
    // Well outside the pet's box, and dispatched on the window rather than on the pet.
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, {
      clientX: rect.left - 300, clientY: rect.top - 200,
    })));
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, {
      clientX: rect.left - 360, clientY: rect.top - 240,
    })));
    var moved = Math.abs((widget.preferences.viewYaw || 0) - yawBefore) > 0.05;
    var orbiting = widget.pet.getAttribute('data-orbiting');
    // The release happens out there too, and it has to be noticed.
    window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, {
      buttons: 0, clientX: rect.left - 360, clientY: rect.top - 240,
    })));
    var released = widget.viewDrag === null && widget.pet.getAttribute('data-orbiting') === 'false';
    report.orbitOutside = {
      moved: moved,
      orbitingWhileDragging: orbiting,
      released: released,
      freedPointer: widget.windowGesture === false,
    };
    return moved && orbiting === 'true' && released && widget.windowGesture === false;
  });

  /**
   * And a release that is NEVER delivered — the pointer left the window entirely — is caught by the BUTTON
   * STATE on the next move, rather than leaving the pet latched for ever.
   */
  check('a release that never arrives is caught by the button state', function () {
    var rect = widget.pet.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, pointerId: 80, button: 2, buttons: 2,
      clientX: rect.left + 20, clientY: rect.top + 20 };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', base));
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, { clientX: rect.left + 60 })));
    var armed = widget.viewDrag !== null;
    // A move with no buttons held: the release happened somewhere that told nobody.
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, {
      buttons: 0, clientX: rect.left + 80,
    })));
    var released = widget.viewDrag === null && widget.pet.getAttribute('data-orbiting') === 'false';
    report.orbitRelease = { armed: armed, released: released, freedPointer: widget.windowGesture === false };
    return armed && released && widget.windowGesture === false;
  });

  /**
   * ---- the reported flow, verbatim: released outside, came back and it KEPT TURNING ----
   *
   * "鼠标离开框架后旋转就卡住了，鼠标移动回来，哪怕没有按下右键，也会继续旋转" (2026-10-09 late). Two independent
   * ways out are asserted, because either one alone would leave a latch on a platform where the other signal
   * does not arrive:
   *
   *  a. the right-button RELEASE produces a `contextmenu` — even when the release happened far from the pet —
   *     and an orbit that is still armed at that moment is over;
   *  b. a move that comes back reporting no button held ends it (the button state is the fallback).
   */
  check('a release outside the frame cannot leave the orbit turning', function () {
    // (a) the menu event is the release signal a right-drag always produces.
    var rect = widget.pet.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, pointerId: 81, button: 2, buttons: 2,
      clientX: rect.left + 20, clientY: rect.top + 20 };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', base));
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, { clientX: rect.left - 200 })));
    var armedForMenu = widget.viewDrag !== null;
    // The release happened outside the pet; the browser follows it with a menu event somewhere in the page.
    window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    var endedByMenu = widget.viewDrag === null && widget.pet.getAttribute('data-orbiting') === 'false';
    // The left-drag path must still open the panel on a plain right-click, so the suppression is consumed.
    var suppressed = widget.suppressContextMenu === true;

    // (b) the same flow, but with no menu event at all: the returning move carries the button state.
    widget.suppressContextMenu = false;
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, { pointerId: 82, buttons: 2 })));
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, { pointerId: 82, clientX: rect.left - 200 })));
    var armedForReturn = widget.viewDrag !== null;
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, {
      pointerId: 82, buttons: 0, clientX: rect.left + 10, clientY: rect.top + 10,
    })));
    var endedOnReturn = widget.viewDrag === null && widget.pet.getAttribute('data-orbiting') === 'false';

    report.orbitLatch = {
      armedForMenu: armedForMenu,
      endedByMenu: endedByMenu,
      suppressedMenu: suppressed,
      armedForReturn: armedForReturn,
      endedOnReturn: endedOnReturn,
      freedPointer: widget.windowGesture === false,
    };
    return armedForMenu && endedByMenu && suppressed && armedForReturn && endedOnReturn
      && widget.windowGesture === false;
  });

  /**
   * ---- POINTER LOCK while orbiting: the operator's own suggestion ----
   *
   * "鼠标抬起来的事件还是没传到框架里。可以旋转的时候把鼠标锁定吗？很多游戏里都是旋转的时候鼠标位置是锁定的，但是
   * 对鼠标的位移有反应" (2026-10-09 late). A locked pointer cannot leave the frame, so the release is always
   * delivered — and while it is locked the cursor POSITION is frozen, so the orbit has to run on the movement
   * deltas or the view would stop dead. Both halves are asserted here, plus the two ways the lock can go away.
   */
  check('orbiting locks the pointer, and a locked orbit follows the movement deltas', function () {
    var lockCalls = 0;
    var exitCalls = 0;
    var realRequest = Object.getOwnPropertyDescriptor(Element.prototype, 'requestPointerLock');
    var realExit = document.exitPointerLock;
    // The probe cannot take a real lock (no user gesture in the harness, and it would capture the cursor), so
    // the request, the release and the locked ELEMENT are all faked — what is asserted is the WIDGET's
    // behaviour, not Chromium's. `pointerLockElement` is a prototype getter, so an own property shadows it.
    try { widget.pet.requestPointerLock = function () { lockCalls += 1; return undefined; }; } catch (error) { /* frozen */ }
    document.exitPointerLock = function () { exitCalls += 1; };
    var setLockElement = function (element) {
      try { Object.defineProperty(document, 'pointerLockElement', { value: element, configurable: true }); } catch (error) { /* frozen */ }
    };
    var clearLockElement = function () {
      try { delete document.pointerLockElement; } catch (error) { /* frozen */ }
    };
    setLockElement(widget.pet);

    var rect = widget.pet.getBoundingClientRect();
    widget.preferences.viewYaw = 0;
    widget.preferences.viewPitch = 0;
    var base = { bubbles: true, cancelable: true, pointerId: 83, button: 2, buttons: 2,
      clientX: rect.left + 20, clientY: rect.top + 20 };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', base));
    /**
     * A PRESS IS NOT A DRAG, so it must not take the cursor — and this one line is the regression test for
     * 「右键依然无法弹出菜单」 (operator, 2026-10-12, with their own diagnosis: 「右键现在是旋转功能，位置也被锁定
     * 了…有点像3D游戏中锁定光标」).
     *
     * The widget used to request the pointer lock on the PRESS. A locked cursor stops moving, so
     * `clientX`/`clientY` freeze while `movementX`/`movementY` keep arriving — the same measurement the orbit
     * wants — which means a plain right-click captured the cursor, any tremor accumulated into an orbit, and
     * the menu event that followed was swallowed as if the user had dragged. The lock belongs to the ORBIT, so
     * it is asserted here (nothing on the press) and one check later (exactly one request, once it moves).
     */
    var lockOnPress = lockCalls;

    // The lock is taken: from here the browser freezes clientX/clientY and reports deltas.
    widget.pointerLocked = true;
    var frozen = { clientX: rect.left + 20, clientY: rect.top + 20 };
    var yawBefore = widget.preferences.viewYaw || 0;
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, frozen, {
      buttons: 2, movementX: 40, movementY: 12,
    })));
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, frozen, {
      buttons: 2, movementX: 30, movementY: 8,
    })));
    var lockRequested = lockCalls === 1;
    var orbitedOnDeltas = Math.abs((widget.preferences.viewYaw || 0) - yawBefore) > 0.05;
    // …and a move that reports NO movement does not move the view, which is the other half of "the position
    // is locked": a frozen clientX must not be read as a delta.
    var yawAfterDeltas = widget.preferences.viewYaw || 0;
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, frozen, {
      buttons: 2, movementX: 0, movementY: 0,
    })));
    var stillAfterStill = Math.abs((widget.preferences.viewYaw || 0) - yawAfterDeltas) < 1e-9;

    // A real release: the orbit ends AND the cursor is handed back.
    window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, { buttons: 0 })));
    widget.pointerLocked = false;
    var released = widget.viewDrag === null && exitCalls === 1;

    // Escape takes the lock away mid-drag: that must end the orbit rather than leave it turning.
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, { pointerId: 84 })));
    widget.pointerLocked = true;
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, {
      pointerId: 84, buttons: 2, movementX: 50, movementY: 10,
    })));
    var armedBeforeEscape = widget.viewDrag !== null;
    // Escape: the browser really does drop the lock, so the element stops being the locked one. The widget
    // still BELIEVES it holds the lock — that belief is exactly what the change event corrects.
    setLockElement(null);
    document.dispatchEvent(new Event('pointerlockchange'));
    var endedByEscape = widget.viewDrag === null && widget.pet.getAttribute('data-orbiting') === 'false';
    clearLockElement();

    // Put the DOM back the way the rest of the suite expects it.
    document.exitPointerLock = realExit;
    try {
      if (realRequest) Object.defineProperty(Element.prototype, 'requestPointerLock', realRequest);
      else delete widget.pet.requestPointerLock;
    } catch (error) { /* frozen */ }
    widget.suppressContextMenu = false;

    report.orbitLock = {
      lockOnPress: lockOnPress,
      lockRequested: lockRequested,
      orbitedOnDeltas: orbitedOnDeltas,
      stillAfterStill: stillAfterStill,
      released: released,
      armedBeforeEscape: armedBeforeEscape,
      endedByEscape: endedByEscape,
      freedPointer: widget.windowGesture === false,
    };
    return lockOnPress === 0 && lockRequested && orbitedOnDeltas && stillAfterStill && released && armedBeforeEscape
      && endedByEscape && widget.windowGesture === false;
  });

  check('a right-click with no movement still opens the menu', function () {
    widget.closeMenu();
    var rect = widget.pet.getBoundingClientRect();
    var base = { bubbles: true, cancelable: true, pointerId: 78, button: 2, clientX: rect.left + 20, clientY: rect.top + 20 };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', base));
    widget.pet.dispatchEvent(new PointerEvent('pointerup', base));
    widget.pet.dispatchEvent(new MouseEvent('contextmenu', base));
    var opened = widget.menu.isOpen() === true;
    // And it opened AT the pointer, which is what a context menu promises.
    var box = widget.menu.element.getBoundingClientRect();
    var atPointer = Math.abs(box.left - base.clientX) <= 2 && Math.abs(box.top - base.clientY) <= 2;
    widget.closeMenu();
    report.menuAtPointer = { opened: opened, atPointer: atPointer, box: [Math.round(box.left), Math.round(box.top)] };
    return opened && atPointer;
  });

  /**
   * The orbit is a CAMERA move, so the scene has to show it — and the distance to the
   * pet has to stay put while it happens. Without the cos(pitch) factor the pet drifts
   * closer as the view tilts, and a tilt reads as a zoom.
   */
  check('the scene camera orbits and keeps its distance', function () {
    var scene = widget.scene;
    if (!scene || !scene.camera) return false;
    var clean = function (viewYaw, viewPitch) {
      return widget.core.cleanPreferences({ viewYaw: viewYaw, viewPitch: viewPitch });
    };
    var target = new scene.THREE.Vector3(0, scene.framing.scaled.y * 0.5, 0);

    scene.applyPreferences(clean(0, 0));
    var level = scene.camera.position.clone();
    var levelRadius = level.distanceTo(target);

    scene.applyPreferences(clean(0.9, 0));
    var turned = scene.camera.position.clone();
    var turnRadius = turned.distanceTo(target);

    scene.applyPreferences(clean(0.9, 0.4));
    var tilted = scene.camera.position.clone();
    var horizontal = Math.sqrt(tilted.x * tilted.x + tilted.z * tilted.z);
    var expectedHorizontal = scene.cameraDistance * Math.cos(0.4);

    report.orbitCamera = {
      level: [+level.x.toFixed(4), +level.y.toFixed(4), +level.z.toFixed(4)],
      turned: [+turned.x.toFixed(4), +turned.z.toFixed(4)],
      radius: +turnRadius.toFixed(4),
      distance: +levelRadius.toFixed(4),
      horizontal: +horizontal.toFixed(4),
      expectedHorizontal: +expectedHorizontal.toFixed(4)
    };
    scene.applyPreferences(clean(0, 0));
    return Math.abs(turned.x) > 0.01
      && Math.abs(turnRadius - levelRadius) < 1e-6
      && Math.abs(horizontal - expectedHorizontal) < 1e-6
      && tilted.y > turned.y;
  });

  /**
   * Reported: "the view follows the mouse until the cursor leaves the pet's frame, then
   * it stops."
   *
   * The events were never the problem — the listener is on the document, so they arrive
   * window-wide. The UNITS were: the aim was measured against the canvas half-size and
   * returned `null` past 1.6 of them. So this puts the pointer at the far corner of the
   * window, well beyond the pet's box in the old units, and asserts the pet is still
   * aiming — and in the right direction.
   */
  check('the gaze follows the pointer far outside the pet frame', function () {
    widget.closeMenu();
    widget.resetSize();
    widget.preferences.lookAtPointer = true;
    widget.placement.x = 0.82;
    widget.placement.y = 0.12;
    widget.applyPlacement();

    var pixels = widget.placement.pixels();
    var centreX = pixels.left + widget.placement.width / 2;
    var centreY = pixels.top + widget.placement.height / 2;
    // The window's top-left corner: far above and to the left of a pet parked bottom-right.
    var far = { x: 2, y: 2 };
    var oldUnits = Math.sqrt(
      Math.pow((far.x - centreX) / (widget.placement.width / 2), 2)
        + Math.pow((far.y - centreY) / (widget.placement.height / 2), 2)
    );

    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 71, clientX: far.x, clientY: far.y
    }));
    widget.tick(1 / 60);
    var gaze = widget.scene.motion.gaze;
    report.gazeOutside = {
      beyondOldCutoff: oldUnits > 1.6,
      oldUnits: +oldUnits.toFixed(2),
      gaze: gaze ? { yaw: +gaze.yaw.toFixed(4), pitch: +gaze.pitch.toFixed(4) } : null
    };
    return oldUnits > 1.6 && Boolean(gaze) && gaze.yaw < -0.2 && gaze.pitch > 0.2;
  });

  check('the gaze resets when the pointer leaves the window', function () {
    var aiming = Boolean(widget.scene.motion.gaze);
    widget.pointer = { x: 10, y: 10 };
    widget.tick(1 / 60);
    var aimingBeforeLeave = Boolean(widget.scene.motion.gaze);
    widget.document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    widget.tick(1 / 60);
    report.gazeLeave = {
      aimingBeforeLeave: aimingBeforeLeave,
      pointerAfterLeave: widget.pointer,
      gazeAfterLeave: widget.scene.motion.gaze
    };
    return aiming && aimingBeforeLeave && widget.pointer === null && widget.scene.motion.gaze === null;
  });

  /**
   * The aim is measured against the PET, so a cursor sitting on the pet's centre is a
   * dead-ahead gaze. Asserting this pins the reference frame: measured against the
   * window instead, the same point would aim up and left from a bottom-right pet.
   */
  check('a pointer on the pet centre aims straight ahead', function () {
    var pixels = widget.placement.pixels();
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 72,
      clientX: pixels.left + widget.placement.width / 2,
      clientY: pixels.top + widget.placement.height / 2
    }));
    widget.tick(1 / 60);
    var gaze = widget.scene.motion.gaze;
    report.gazeCentre = gaze ? { yaw: +gaze.yaw.toFixed(6), pitch: +gaze.pitch.toFixed(6) } : null;
    return Boolean(gaze) && Math.abs(gaze.yaw) < 1e-9 && Math.abs(gaze.pitch) < 1e-9;
  });

  /**
   * The reported bug: "the view follows correctly on Miku, but on the little blue fish up
   * and down are inverted, left and right are fine."
   *
   * The gaze was applied about the head's own local X and Y. Those are the character's up
   * and right only for a model that happens to be oriented that way, and a VRM 0.x model is
   * turned 180° about Y by `VRMUtils.rotateVRM0` while a VRM 1.0 one is not — which negates
   * a tilt about the right axis and leaves a turn about the up axis alone. Exactly the
   * asymmetry reported, and it needs no third-party model to reproduce: this measures the
   * tilt in world space, then flips the model's root by that same 180° and measures again.
   *
   * The property asserted is the user-visible one — a positive pitch tips the head's nose
   * toward the stage's UP — because the rig's own axis names are precisely what cannot be
   * trusted here.
   */
  asyncCheck('the gaze tips the head up on a model oriented either way round', function () {
    var base64 = globalThis.__PET3D_VRM_BASE64__;
    if (!base64) return Promise.resolve(false);
    var canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    document.body.appendChild(canvas);
    var probe = new SCENE.Scene(canvas, { assetBase: '/asset', modelId: 'gaze', onError: function () {} });
    probe.resize(128, 128);
    var bytes = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });

    // The world-space effect of one gaze on the head, in the STAGE's frame: how far the
    // character's forward direction tips toward the stage's up, and toward its right.
    var effect = function (yaw, pitch) {
      return gazeEffect(probe, probe.avatar.bones.head, yaw, pitch);
    };

    return probe.parse(bytes.buffer, 'gaze').then(function (parsed) {
      if (!parsed.ok) throw new Error('fixture did not load: ' + parsed.error);
      if (!probe.avatar.bones || !probe.avatar.bones.head) throw new Error('the fixture has no head bone');

      var upright = effect(0, 0.3);
      var uprightYaw = effect(0.4, 0);
      vrmGazeReference = { pitchUp: upright.up, yawRight: uprightYaw.right };
      /**
       * The user's cap: at full aim the head must turn a RIGHT ANGLE left and right ("左右 90 度").
       *
       * Asserted as the world-space effect rather than as the constant in the source, because the
       * constant is applied through a weight on the way to the bone: a limit written as `Math.PI / 2`
       * delivers 76° and reads as correct. `effect()` measures the head's forward axis in the stage's
       * frame, so ~90° of turn shows up as `right ≈ 1`.
       */
      var fullAim = probe.gazeFromAim({ x: 1, y: 0 });
      var atFullYaw = effect(fullAim.yaw, 0);
      report.gazeFullYaw = {
        aimYaw: +fullAim.yaw.toFixed(4),
        sideways: +atFullYaw.right.toFixed(4),
        degrees: +(Math.asin(Math.max(-1, Math.min(1, atFullYaw.right))) * 180 / Math.PI).toFixed(1),
      };
      // Now the same 180° that rotateVRM0 applies to a VRM 0.x model, and the cached axes
      // are dropped so they are measured again for the new orientation — which is what a
      // freshly loaded model of the other version gets.
      probe.avatar.root.rotateY(Math.PI);
      delete probe.avatar.bones.head.userData.pet3dGazeAxes;
      var flipped = effect(0, 0.3);
      var flippedYaw = effect(0.4, 0);

      report.gazeAxes = {
        upright: { up: +upright.up.toFixed(4), right: +upright.right.toFixed(4) },
        flipped: { up: +flipped.up.toFixed(4), right: +flipped.right.toFixed(4) },
        uprightYaw: +uprightYaw.right.toFixed(4),
        flippedYaw: +flippedYaw.right.toFixed(4),
        agrees: Math.abs(upright.up - flipped.up) < 1e-6 && Math.abs(uprightYaw.right - flippedYaw.right) < 1e-6
      };
      return upright.up > 0.01 && flipped.up > 0.01
        && uprightYaw.right > 0.01 && flippedYaw.right > 0.01
        && atFullYaw.right > 0.95
        && report.gazeAxes.agrees;
    });
  });

  /**
   * The two things the settings window drives, on a real model: spring chains and expressions.
   *
   * Asserted on the committed VRM fixture, which carries exactly the shape the real model has — two
   * spring chains with DIFFERENT physics (so an implementation that applied one chain's numbers to
   * every joint fails here), and four expressions, one of them declared and empty.
   *
   * The blink and emotion timers are the only unpredictable thing in this module, so a fixed random
   * sequence is injected: the check has to be strict, not lucky.
   */
  asyncCheck('the scene applies spring-chain and expression settings', function () {
    var base64 = globalThis.__PET3D_VRM_BASE64__;
    if (!base64) return Promise.resolve(false);
    var canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    document.body.appendChild(canvas);
    var sequence = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5];
    var cursor = 0;
    var scripted = function () {
      var value = sequence[cursor % sequence.length];
      cursor += 1;
      return value;
    };
    var probe = new SCENE.Scene(canvas, {
      assetBase: '/asset',
      modelId: 'settings',
      random: scripted,
      onError: function () {},
    });
    probe.resize(128, 128);
    var bytes = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });
    var found = {};

    return probe.parse(bytes.buffer, 'settings').then(function (parsed) {
      if (!parsed.ok) throw new Error('fixture did not load: ' + parsed.error);

      // Diagnostics: what three-vrm actually built versus what the document declared. Kept in the
      // report, because "the chain is not there" has two very different causes.
      found.jointNames = probe.avatar && probe.avatar.vrm && probe.avatar.vrm.springBoneManager
        ? Array.from(probe.avatar.vrm.springBoneManager.joints).map(function (joint) { return joint.bone.name; })
        : null;
      var settingsDocument = probe.avatar && probe.avatar.document;
      found.declared = settingsDocument && settingsDocument.extensions && settingsDocument.extensions.VRMC_springBone
        ? settingsDocument.extensions.VRMC_springBone.springs.map(function (spring) {
            return {
              name: spring.name,
              nodes: spring.joints.map(function (entry) { return (settingsDocument.nodes[entry.node] || {}).name; }),
            };
          })
        : null;
      found.documentNodes = settingsDocument
        ? settingsDocument.nodes.map(function (node, index) { return index + ':' + node.name; })
        : null;

      // ---- spring chains: names, sizes and the physics the FILE declares ----------------------
      var chains = probe.springChains();
      found.chains = chains.map(function (chain) {
        return {
          name: chain.name,
          joints: chain.joints,
          stiffness: chain.authored.stiffness,
          dragForce: chain.authored.dragForce,
          gravityPower: chain.authored.gravityPower,
        };
      });
      var hair = chains.filter(function (chain) { return chain.name === 'hair'; })[0] || null;
      var tail = chains.filter(function (chain) { return chain.name === 'tail'; })[0] || null;
      var namedOk = Boolean(hair && tail && hair.joints === 2 && tail.joints === 1);
      var authoredOk = Boolean(hair && tail
        && Math.abs(hair.authored.stiffness - 0.4) < 1e-6
        && Math.abs(hair.authored.dragForce - 0.3) < 1e-6
        && Math.abs(hair.authored.gravityPower - 0.02) < 1e-6
        && Math.abs(tail.authored.stiffness - 1.6) < 1e-6
        && Math.abs(tail.authored.gravityPower - 0.05) < 1e-6);

      // ONE field overridden and the other two left alone: that is what "default" has to mean per
      // field, or touching stiffness would silently pin drag and gravity too.
      var withOverride = CORE.cleanPreferences({
        modelId: 'settings',
        springs: { settings: { hair: { stiffness: 3 } } },
      });
      var changed = probe.applySprings(withOverride);
      var after = probe.springChains();
      var hairAfter = after.filter(function (chain) { return chain.name === 'hair'; })[0] || null;
      var tailAfter = after.filter(function (chain) { return chain.name === 'tail'; })[0] || null;
      found.override = {
        changed: changed,
        hair: hairAfter && hairAfter.current,
        authored: hairAfter && hairAfter.authored,
        tail: tailAfter && tailAfter.current,
      };
      var overrideOk = Boolean(changed > 0 && hairAfter && tailAfter
        && Math.abs(hairAfter.current.stiffness - 3) < 1e-6
        && Math.abs(hairAfter.current.dragForce - hairAfter.authored.dragForce) < 1e-6
        && Math.abs(hairAfter.current.gravityPower - hairAfter.authored.gravityPower) < 1e-6
        && Math.abs(tailAfter.current.stiffness - tailAfter.authored.stiffness) < 1e-6);

      // Going back to the default restores the FILE's number — not the last value the panel showed.
      probe.applyPreferences(CORE.cleanPreferences({ modelId: 'settings' }));
      var restored = probe.springChains().filter(function (chain) { return chain.name === 'hair'; })[0];
      found.restored = restored && restored.current;
      var restoreOk = Boolean(restored && Math.abs(restored.current.stiffness - restored.authored.stiffness) < 1e-6
        && Math.abs(restored.current.stiffness - 0.4) < 1e-6);

      // ---- expressions: names, pins, and releasing a pin --------------------------------------
      var expressionNames = probe.expressionNames();
      found.expressionNames = expressionNames;
      var namesOk = expressionNames.indexOf('blink') !== -1
        && expressionNames.indexOf('happy') !== -1
        && expressionNames.indexOf('wag') !== -1
        && expressionNames.indexOf('surprised') !== -1;

      probe.setExpression('happy', 1);
      var pinned = probe.expressionValue('happy');
      // A manual ZERO is an instruction ("hold this closed"), not the absence of one.
      probe.setExpression('blink', 0);
      var pinnedClosed = probe.expressionValue('blink');
      probe.setExpression('happy', null);
      var released = probe.expressionValue('happy');
      found.pins = { happy: pinned, blinkZero: pinnedClosed, released: released };
      var pinOk = Math.abs((pinned === null ? -1 : pinned) - 1) < 1e-6
        && Math.abs(pinnedClosed || 0) < 1e-6
        && Math.abs(released || 0) < 1e-6;

      // The blink: nothing, a blink, nothing again — stepped by dt rather than by a timer, so this
      // is deterministic in a way a real clock could never be.
      var prefs = probe.preferences;
      prefs.expressions.blink.enabled = true;
      prefs.expressions.blink.minSeconds = 0.5;
      prefs.expressions.blink.maxSeconds = 0.5;
      prefs.expressions.emotion.enabled = false;
      probe.applyPreferences(prefs);
      probe.expressionState.nextBlinkAt = 0;
      var openFrames = 0;
      var peak = 0;
      var weightAfter = 0;
      for (var frame = 0; frame < 20; frame += 1) {
        probe.tick(1 / 60);
        var weight = probe.blinkState().weight;
        peak = Math.max(peak, weight);
        if (weight === 0) openFrames += 1;
        weightAfter = weight;
      }
      found.blink = { peak: +peak.toFixed(3), after: +weightAfter.toFixed(3), openFrames: openFrames };
      var blinkOk = peak > 0.5 && weightAfter === 0 && openFrames > 0;

      /**
       * ---- and a face that is already expressing something does NOT blink ----
       *
       * Operator's request (2026-10-09 late): "当模型脸上有表情的时候，暂停眨眼". In a VRM the blink and the
       * expression shapes drive the SAME eyelid morphs, so blinking through a smile does not read as a blink —
       * it reads as the expression dropping for a tenth of a second.
       *
       * The face here comes from an EMOTION (a mood, so it stays up): that is one of the two things that can
       * put an expression on the face, the clip's own face is the other, and the gate is one boolean for both.
       */
      prefs.expressions.blink.enabled = true;
      prefs.expressions.blink.minSeconds = 0.1;
      prefs.expressions.blink.maxSeconds = 0.1;
      prefs.expressions.emotion.enabled = true;
      prefs.expressions.emotion.triggers.click.enabled = true;
      prefs.expressions.emotion.triggers.click.emotions = ['wag'];
      // A hold of 0 is a MOOD: it stays on the face until something replaces it.
      prefs.expressions.emotion.triggers.click.holdSeconds = 0;
      probe.applyPreferences(prefs);
      probe.noteInteraction('click');
      // Let the weight ramp in BEFORE asking for a blink: the gate reads the previous frame's weight.
      for (var ramp = 0; ramp < 6; ramp += 1) probe.tick(1 / 60);
      var moodShown = probe.emotionState().name;
      probe.expressionState.nextBlinkAt = 0;
      var heldPeak = 0;
      var heldPaused = false;
      for (var held = 0; held < 30; held += 1) {
        probe.tick(1 / 60);
        heldPeak = Math.max(heldPeak, probe.blinkState().weight);
        heldPaused = probe.blinkState().paused;
      }
      // Taking the face away lets a blink through again — the pause is a pause, not a switch-off.
      probe.expressionBehaviour.emotion = null;
      probe.expressionBehaviour.emotionWeight = 0;
      probe.expressionState.nextBlinkAt = 0;
      var releasedPeak = 0;
      var releasedPaused = true;
      for (var free = 0; free < 30; free += 1) {
        probe.tick(1 / 60);
        releasedPeak = Math.max(releasedPeak, probe.blinkState().weight);
        releasedPaused = probe.blinkState().paused;
      }
      found.blinkFace = {
        mood: moodShown,
        heldPeak: +heldPeak.toFixed(3),
        heldPaused: heldPaused,
        releasedPeak: +releasedPeak.toFixed(3),
        releasedPaused: releasedPaused,
      };
      var blinkFaceOk = moodShown === 'wag' && heldPeak === 0 && heldPaused === true
        && releasedPeak > 0.5 && releasedPaused === false;

      // An emotion on interaction: on the face straight away, gone once the hold has passed.
      prefs.expressions.emotion.enabled = true;
      prefs.expressions.emotion.onInteract = true;
      // The reaction row: a click with a short duration must be gone by the time the ticks are done.
      prefs.expressions.emotion.triggers.idle.enabled = false;
      prefs.expressions.emotion.triggers.click.holdSeconds = 0.5;
      // And the row may name exactly ONE label, which is the model's own name for the expression.
      prefs.expressions.emotion.triggers.click.emotions = ['wag'];
      probe.applyPreferences(prefs);
      var triggered = probe.noteInteraction('click');
      var atTrigger = probe.emotionState();
      for (var held = 0; held < 60; held += 1) probe.tick(1 / 60);
      var afterHold = probe.emotionState();
      // A duration of ZERO is not 'no emotion': it is a mood that stays until something replaces it.
      prefs.expressions.emotion.triggers.click.holdSeconds = 0;
      prefs.expressions.emotion.triggers.click.emotions = ['wag'];
      probe.applyPreferences(prefs);
      var moodName = probe.noteInteraction('click');
      for (var moodTick = 0; moodTick < 120; moodTick += 1) probe.tick(1 / 60);
      var mood = probe.emotionState();
      // Naming an emotion the row does not list must be refused rather than silently swapped.
      prefs.expressions.emotion.triggers.click.emotions = ['happy'];
      prefs.expressions.emotion.triggers.click.holdSeconds = 2;
      probe.applyPreferences(prefs);
      var restricted = probe.noteInteraction('click');
      found.emotion = {
        triggered: triggered,
        at: atTrigger,
        after: afterHold,
        moodName: moodName,
        mood: mood,
        restricted: restricted,
        showable: probe.showableEmotions(),
      };
      var emotionOk = triggered === 'wag'
        && atTrigger.weight > 0.5
        && atTrigger.persistent === false
        // Held for 0.5 s, then gone: 60 ticks is a second.
        && afterHold.name === null
        // A zero duration keeps the same emotion on the face instead of clearing it.
        && moodName === 'wag' && mood.name === 'wag' && mood.weight > 0.5 && mood.persistent === true
        // A row that names one label can only ever produce that label.
        && restricted === 'happy'
        // `surprised` is declared by the fixture and drives nothing, so it is never offered.
        && (found.emotion.showable || []).indexOf('surprised') === -1
        && (found.emotion.showable || []).indexOf('wag') !== -1
        && afterHold.weight === 0 && afterHold.name === null;

      // A pinned expression is not touched by a behaviour: the pin wins.
      prefs.expressions.weights = { happy: 0 };
      probe.applyPreferences(prefs);
      var pinnedTrigger = probe.expressionState;
      pinnedTrigger.nextIdleEmotionAt = null;
      var pinnedIdle = typeof probe.triggerEmotion('idle');
      found.pinnedBlocksBehaviour = pinnedIdle;
      var pinWinsOk = pinnedIdle === 'string' ? probe.emotionState().name !== 'happy' : true;
      prefs.expressions.weights = {};

      // The idle timer fires on its own, and says so.
      prefs.expressions.weights = {};
      prefs.expressions.emotion.idle = true;
      prefs.expressions.emotion.idleMinSeconds = 2;
      prefs.expressions.emotion.idleMaxSeconds = 2;
      // The click tests had to switch the idle row off; this is the idle test, so it goes back on and the
      // click row goes off (each row is its own switch now, which is the point of the table).
      prefs.expressions.emotion.triggers.idle.enabled = true;
      prefs.expressions.emotion.triggers.click.enabled = false;
      // And the idle row has to NAME a mood: an empty list is the 无 row, which is silent by design, so a
      // still-faced pet is now the default rather than the model's own mood words being used unasked.
      prefs.expressions.emotion.triggers.idle.emotions = ['wag'];
      probe.applyPreferences(prefs);
      // An emotion already on the face is what the advance step is busy with, and the idle timer is only
      // consulted when there is none - so the step that tests the idle timer starts from a clean face.
      probe.expressionBehaviour.emotion = null;
      probe.expressionBehaviour.emotionWeight = 0;
      probe.expressionState.nextIdleEmotionAt = null;
      var idleEmotion = null;
      for (var step = 0; step < 180 && idleEmotion === null; step += 1) {
        probe.tick(1 / 60);
        var state = probe.emotionState();
        if (state.name) idleEmotion = state;
      }
      found.idleEmotion = idleEmotion;
      var idleOk = Boolean(idleEmotion && idleEmotion.reason === 'idle');

      // And a switch that is off triggers nothing at all.
      prefs.expressions.emotion.enabled = false;
      probe.applyPreferences(prefs);
      found.disabledInteraction = probe.noteInteraction('click');
      var offOk = found.disabledInteraction === null;

      /**
       * The 无 row: an empty list means NO expression.
       *
       * This is the default and the reason the 无 checkbox exists. It used to mean "any emotion the model
       * declares", so a user who wanted a still-faced pet had no way to ask for one and every model's own
       * mood words were used whether they wanted them or not.
       */
      prefs.expressions.emotion.enabled = true;
      prefs.expressions.emotion.triggers.click.enabled = true;
      prefs.expressions.emotion.triggers.click.holdSeconds = 2;
      prefs.expressions.emotion.triggers.click.emotions = [];
      probe.applyPreferences(prefs);
      probe.expressionBehaviour.emotion = null;
      probe.expressionBehaviour.emotionWeight = 0;
      var noneTriggered = probe.noteInteraction('click');
      var noneFace = probe.emotionState().name;
      found.noneIsSilent = { triggered: noneTriggered, face: noneFace };
      var noneOk = noneTriggered === null && noneFace === null;

      /**
       * Secondary motion from a VERTICAL drag, measured on the fixture's real spring chains.
       *
       * The user reported that only left-right movement swings the hair. The reason is mechanical: a chain
       * hanging down cannot be excited by moving its anchor along its own axis (its joints only bend, and the
       * solver holds the distance between them), so `applyDragLag`'s vertical TRANSLATION alone barely moves
       * it. What a chain of that shape answers is a rotation of its root, so the vertical velocity also
       * pitches the stage — and this measures that the vertical case now bends the chains about as much as
       * the horizontal one, and that the lean has the right sign and settles.
       *
       * Deviations are measured RELATIVE to the stage, so the lag's translation is factored out and what is
       * left is the bending the springs did. The idle sway is switched off for the measurement: it moves the
       * root on its own, and a drifting baseline would be indistinguishable from a swing.
       */
      var swingPrefs = probe.preferences;
      swingPrefs.sway = 0;
      swingPrefs.yaw = 0;
      probe.applyPreferences(swingPrefs);
      var joints = probe.avatar && probe.avatar.vrm && probe.avatar.vrm.springBoneManager
        ? Array.from(probe.avatar.vrm.springBoneManager.joints).map(function (joint) { return joint.bone; })
        : [];
      var relative = function (bone) {
        probe.stage.updateMatrixWorld(true);
        var e = bone.matrixWorld.elements;
        return {
          x: e[12] - probe.stage.position.x,
          y: e[13] - probe.stage.position.y,
          z: e[14] - probe.stage.position.z,
        };
      };
      var snapshot = function () { return joints.map(relative); };
      var deviation = function (base) {
        var worst = 0;
        joints.forEach(function (bone, index) {
          var now = relative(bone);
          var dx = now.x - base[index].x;
          var dy = now.y - base[index].y;
          var dz = now.z - base[index].z;
          worst = Math.max(worst, Math.sqrt(dx * dx + dy * dy + dz * dz));
        });
        return worst;
      };
      var settle = function (frames) { for (var i = 0; i < frames; i += 1) probe.tick(1 / 60); };

      probe.setDragMotion(0, 0);
      settle(90);
      var restJoints = snapshot();
      probe.setDragMotion(900, 0);
      settle(30);
      var lateral = deviation(restJoints);
      probe.setDragMotion(0, 0);
      settle(180);

      var downJoints = snapshot();
      probe.setDragMotion(0, 900);
      settle(30);
      var vertical = deviation(downJoints);
      var pitchDown = probe.stage.rotation.x;
      probe.setDragMotion(0, -900);
      settle(30);
      var pitchUp = probe.stage.rotation.x;
      probe.setDragMotion(0, 0);
      settle(240);
      var pitchSettled = probe.stage.rotation.x;

      /**
       * The A/B that matters: the SAME vertical impulse with the lean suppressed.
       *
       * "Vertical bends the chain" is not enough on its own — the lag's translation is along the vertical
       * axis too, so whether that number reads as a pass depends on the fixture. This intercepts
       * `applyDragLag` (which runs inside `tick`, before the physics step) and zeroes the rotation right
       * after it, so the springs receive everything EXCEPT the pitch. The difference is the pitch's doing.
       */
      probe.setDragMotion(0, 0);
      settle(180);
      var noLeanJoints = snapshot();
      var realApply = probe.applyDragLag;
      probe.applyDragLag = function (dt) {
        realApply.call(probe, dt);
        probe.stage.rotation.x = 0;
      };
      probe.setDragMotion(0, 900);
      settle(30);
      var verticalNoLean = deviation(noLeanJoints);
      probe.applyDragLag = realApply;
      probe.setDragMotion(0, 0);
      settle(240);
      probe.stage.rotation.x = 0;

      found.swing = {
        lateral: +lateral.toFixed(5), vertical: +vertical.toFixed(5),
        verticalWithoutLean: +verticalNoLean.toFixed(5),
        pitchDown: +pitchDown.toFixed(4), pitchUp: +pitchUp.toFixed(4),
        pitchSettled: +pitchSettled.toFixed(6),
      };
      var swingOk = vertical > 0.01 && verticalNoLean >= 0
        && vertical > 4 * verticalNoLean
        && pitchDown > 0.02 && pitchUp < -0.02
        && Math.abs(pitchSettled) < 1e-6;

      probe.dispose();
      if (canvas.parentNode) canvas.remove();
      found.flags = {
        namedOk: namedOk,
        authoredOk: authoredOk,
        overrideOk: overrideOk,
        restoreOk: restoreOk,
        namesOk: namesOk,
        pinOk: pinOk,
        blinkOk: blinkOk,
        blinkFaceOk: blinkFaceOk,
        emotionOk: emotionOk,
        pinWinsOk: pinWinsOk,
        idleOk: idleOk,
        offOk: offOk,
        noneOk: noneOk,
        swingOk: swingOk,
      };
      report.settings = found;
      return namedOk && authoredOk && overrideOk && restoreOk && namesOk && pinOk
        && blinkOk && blinkFaceOk && emotionOk && pinWinsOk && idleOk && offOk && noneOk && swingOk;
    });
  });

  /**
   * (REMOVED 2026-10-11) "the placeholder turns its head by the same algorithm as a VRM".
   *
   * It measured the PROCEDURAL avatar, and that avatar no longer ships: `lib/client.js` stopped loading
   * `./client.placeholder.js` on 2026-10-10 when the operator removed the built-in stand-in ("移除内置替身，默认模型
   * 设置为SampleModel"). The check kept passing on TIMING — while the widget had no model installed yet it
   * happened to still hold the procedural avatar — and it turned red the moment a new check moved that timing.
   *
   * A check whose subject is not in the product any more is worse than no check: it can only report the load
   * order. `lib/placeholder.js` still builds that rig (it is used by its own probe), and the gaze algorithm it
   * was comparing is asserted on the VRM above — including the 90° cap and the up/down orientation.
   */

  /**
   * The right-click MENU: the operator's six entries, from the shared definition.
   *
   * It replaced the pet's own settings panel (operator, 2026-10-11: 「内置桌宠和独立桌宠各自有一套设置，这样是不对的。
   * 删掉两个单独的设置面板。」), so the things worth asserting are exactly the things a hand-rolled menu gets
   * wrong: an entry that exists on one pet but not the other, an entry that is listed but not wired, and a row
   * that promises to act while the mode it needs is off.
   *
   * It was EIGHT entries until 2026-10-12, when the operator removed 重启/退出 DeepSeek Harness from both menus
   * (「内置宠物和外置宠物都去掉关闭和重启dsh的功能和项目」) and added the 重力 switch. The list below is the
   * whole contract, so a stale menu — or the previous delivered chunk — fails here rather than at a right-click.
   */
  check('the right-click menu is the shared definition, with the operator\'s entries', function () {
    var menuApi = globalThis.__PET3D_MENU__;
    widget.closeMenu();
    var opened = widget.openMenuAt(120, 140);
    var items = widget.menu ? widget.menu.items() : [];
    var ids = items.map(function (item) { return item.id; });
    // The module's own record, by class: a surface that hand-rolled a look-alike would fail here even if the
    // labels happened to match.
    var sharedClass = Boolean(widget.menu) && widget.menu.element.classList.contains('pet3d-menu');
    var stylesheet = Boolean(document.getElementById('pet3d-menu-style'));
    var surfaceRow = items.filter(function (item) { return item.id === 'surface'; })[0] || null;
    // This pet hands the pet OUT, and the operator's own words for that row are asserted from the module's
    // table rather than from a surface's strings — one definition, so it cannot differ between the two pets.
    var zh = menuApi.strings('zh');
    var words = zh.resetView === '重置视角' && zh.resetSize === '重置大小'
      && zh.globalSettings === '通用设置' && zh.modelSettings === '当前模型参数设置'
      && zh.surfaceWindow === '切换回窗口外' && zh.surfaceApp === '切换回窗口内'
      && zh.gravity === '重力'
      // The two meanings of the last row, and they are NOT the same words: the app's pet is hidden, the
      // window's pet is handed back inside. Asserted from the table, so a surface cannot invent its own.
      && zh.closePetApp === '隐藏宠物' && zh.closePetWindow === '关闭独立宠物'
      && zh.restartHarness === undefined && zh.quitHarness === undefined;
    // 非debug模式生效: 调试模式 has both pets on screen, so the switch row must be DISABLED rather than acting.
    // Read the NODE as well as the module's own record: `disabled` and the tooltip are what the browser acts on
    // and what the user is shown, so a record that agreed with itself while the element stayed live would pass a
    // check made of bookkeeping alone.
    widget.preferences.petSurface = 'both';
    widget.openMenuAt(120, 140);
    var debugRow = widget.menu.items().filter(function (item) { return item.id === 'surface'; })[0] || null;
    var debugNode = menuItem('surface');
    var disabledInDebug = Boolean(debugRow && debugRow.disabled === true)
      && Boolean(debugNode && debugNode.disabled === true && debugNode.title);
    widget.preferences.petSurface = 'auto';
    widget.openMenuAt(120, 140);
    var autoRow = widget.menu.items().filter(function (item) { return item.id === 'surface'; })[0] || null;
    var autoNode = menuItem('surface');
    var enabledOutsideDebug = Boolean(autoRow && autoRow.disabled !== true)
      && Boolean(autoNode && autoNode.disabled !== true && !autoNode.title);
    widget.closeMenu();
    report.menu = {
      opened: opened,
      ids: ids,
      module: sharedClass,
      stylesheet: stylesheet,
      surfaceLabel: surfaceRow ? surfaceRow.label : null,
      disabledInDebug: disabledInDebug,
      enabledOutsideDebug: enabledOutsideDebug,
    };
    return opened && sharedClass && stylesheet && words
      && ids.join(',') === 'resetView,resetSize,globalSettings,modelSettings,surface,gravity,closePet'
      && disabledInDebug && enabledOutsideDebug;
  });

  /**
   * The GESTURE: a REAL right-click opens this pet's menu, a double-click does not, and a right-DRAG still orbits.
   *
   * Every other menu check in this file calls `openMenuAt` directly, so none of them says the menu can be
   * reached at all. The operator's 2026-10-12 change was exactly about which gesture reaches it — 「内置宠物把双击
   * 打开菜单变成右键打开菜单」 — so all three are asserted here.
   *
   * **A bare `contextmenu` is NOT the gesture, and this check is what proved it.** It used to dispatch one, and
   * it passed while the operator was reporting 「内置宠物右键单击无效」 against the running app: a real right-click is
   * a press, a release and THEN the menu event, and it is the press that arms the orbit and the release that can
   * set `suppressContextMenu`. Driving the whole sequence is the only version of this check that can fail for
   * the reason the user sees.
   */
  check('a real right-click opens the app pet\'s menu, and a double-click does not', function () {
    /** The three events a real secondary click produces, in order. */
    function rightClick(x, y, pointerId, wobble) {
      var down = { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: pointerId, clientX: x, clientY: y };
      widget.pet.dispatchEvent(new PointerEvent('pointerdown', down));
      if (wobble) {
        widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: pointerId,
          clientX: x + wobble, clientY: y + wobble,
        }));
      }
      widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: pointerId, clientX: x, clientY: y,
      }));
      // Targeted at the PET, which is what a real right-click over the pet produces: the event then runs the
      // window's CAPTURE listener (the orbit's release signal) and the pet's own handler, in that order.
      // Dispatching it on the WINDOW instead would reach only the capture listener and prove nothing.
      widget.pet.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
      }));
    }

    widget.closeMenu();
    var before = widget.menu.isOpen() === true;

    // 1. A double-click does NOT open it any more (it did until 2026-10-12).
    widget.pet.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 90, clientY: 90 }));
    var afterDoubleClick = widget.menu.isOpen() === true;

    // 2. A still right-click opens it, at the cursor.
    rightClick(96, 92, 91, 0);
    var afterStillClick = widget.menu.isOpen() === true;
    var stillBox = afterStillClick ? widget.menu.element.getBoundingClientRect() : null;
    var placedNearCursor = Boolean(stillBox)
      && Math.abs(stillBox.left - 96) <= 12 && Math.abs(stillBox.top - 92) <= 12;
    widget.closeMenu();

    /**
     * 3. Right-clicks whose hand WOBBLED are still clicks — the case the operator reported.
     *
     * 「内置宠物右键单击无效」 was this: the threshold that turns a secondary press into an orbit was
     * `|dx|+|dy| < 4`, so 2 px on each axis was already a drag, `suppressContextMenu` was set on release, and
     * the menu event that followed was swallowed. A real mouse wobbles on every click, so the menu was
     * effectively unreachable and a double-click — which had no such rule — was the only way in.
     *
     * 2 px and 4 px per axis are both measured because the threshold is MANHATTAN: the first is what a careful
     * click does, the second is what a normal one does, and the check must survive both with room to spare.
     */
    rightClick(150, 150, 92, 2);
    var afterWobbleClick = widget.menu.isOpen() === true;
    var yawAfterWobble = widget.preferences.viewYaw;
    widget.closeMenu();
    rightClick(150, 150, 95, 4);
    var afterBigWobbleClick = widget.menu.isOpen() === true;
    widget.closeMenu();

    // 4. A right-DRAG is NOT a click: it turns the view, and the menu event that follows must not open the menu
    //    over the view the user just turned.
    var yawBeforeDrag = widget.preferences.viewYaw;
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 93, clientX: 200, clientY: 200,
    }));
    widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 93, clientX: 260, clientY: 218,
    }));
    widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, button: 2, buttons: 0, pointerId: 93, clientX: 260, clientY: 218,
    }));
    widget.pet.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 260, clientY: 218,
    }));
    var afterDragMenu = widget.menu.isOpen() === true;
    var orbited = widget.preferences.viewYaw !== yawBeforeDrag;
    widget.closeMenu();

    // 5. And the NEXT right-click after that drag still works: the suppression is one-shot by design, and a
    //    flag that stuck would be a menu that dies for the rest of the session.
    rightClick(96, 92, 94, 0);
    var afterDragThenClick = widget.menu.isOpen() === true;
    widget.closeMenu();

    report.menuGesture = {
      before: before, afterDoubleClick: afterDoubleClick,
      afterStillClick: afterStillClick, placedNearCursor: placedNearCursor,
      afterWobbleClick: afterWobbleClick, yawAfterWobble: yawAfterWobble,
      afterBigWobbleClick: afterBigWobbleClick,
      afterDragMenu: afterDragMenu, orbited: orbited, afterDragThenClick: afterDragThenClick,
    };
    return before === false && afterDoubleClick === false
      && afterStillClick && placedNearCursor
      && afterWobbleClick && afterBigWobbleClick
      && afterDragMenu === false && orbited === true
      && afterDragThenClick === true;
  });

  /**
   * 重力 on the APP pet: the switch bites on the physics, and on THIS pet only.
   *
   * Four things, and each is a way a switch like this ships broken:
   *   * the row reports the state it is in (a check mark and `aria-checked`, read off the NODE — a record that
   *     agreed with itself while the element stayed unmarked would pass a check made of bookkeeping);
   *   * clicking it writes the preference AND the physics (`placement.throwEnabled`), because a preference that
   *     never reached the fall looks exactly like a switch that does nothing;
   *   * with 重力 OFF a released drag produces NO fall, which is the behaviour the operator asked for
   *     (「关闭后停用抛掷和重力下坠，可以随意摆放」) and is measured by actually releasing a drag;
   *   * and the window's key is untouched, which is 「状态完全独立」 — the one thing a single shared key
   *     would silently break.
   */
  check('the 重力 switch drives this pet\'s physics and leaves the window\'s alone', function () {
    var before = widget.preferences.gravity;
    widget.preferences.gravity = true;
    widget.openMenuAt(70, 70);
    var onRow = widget.menu.items().filter(function (item) { return item.id === 'gravity'; })[0] || null;
    var onNode = menuItem('gravity');
    var markedOn = Boolean(onRow && onRow.checked === true)
      && Boolean(onNode && onNode.getAttribute('aria-checked') === 'true' && onNode.getAttribute('data-checked') === 'true')
      && !onNode.title;

    // A window preference in the SAME preferences object: it must come out the other side unchanged.
    var windowKeyBefore = widget.preferences.windowGravity;
    var toggled = chooseMenuItem('gravity');
    var closedAfterClick = widget.menu.isOpen() === false;
    var offState = {
      preference: widget.preferences.gravity,
      throwEnabled: widget.placement.throwEnabled,
      windowGravity: widget.preferences.windowGravity,
      stored: JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}').gravity,
    };
    widget.openMenuAt(70, 70);
    var offRow = widget.menu.items().filter(function (item) { return item.id === 'gravity'; })[0] || null;
    var offNode = menuItem('gravity');
    var toldWhy = Boolean(offNode && offNode.title);
    widget.closeMenu();

    // A released drag with 重力 off: no fall, and the pet stays where it was put — through the REAL
    // listeners, the same way the drag checks above drive it. The pet's own position is put back at the
    // end of this check, so the checks that follow start from where this one found them.
    var positionBefore = { x: widget.placement.x, y: widget.placement.y };
    var releaseAt = widget.pet.getBoundingClientRect();
    var dragged = {
      x: releaseAt.left + Math.round(releaseAt.width / 2),
      y: releaseAt.top + Math.round(releaseAt.height / 2),
    };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 71,
      clientX: dragged.x, clientY: dragged.y,
    }));
    widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 71,
      clientX: dragged.x + 24, clientY: dragged.y - 18,
    }));
    widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 71,
      clientX: dragged.x + 24, clientY: dragged.y - 18,
    }));
    var airborneWithGravityOff = widget.placement.isAirborne();
    var held = { x: widget.placement.x, y: widget.placement.y };
    widget.tick(1 / 60);
    var driftWithGravityOff = [widget.placement.x - held.x, widget.placement.y - held.y];

    // Back ON: the same release now falls, which is what "开启后恢复重力和抛掷" means.
    widget.openMenuAt(70, 70);
    chooseMenuItem('gravity');
    var restored = widget.preferences.gravity === true && widget.placement.throwEnabled === true;
    var again = widget.pet.getBoundingClientRect();
    var from = { x: again.left + Math.round(again.width / 2), y: again.top + Math.round(again.height / 2) };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 72,
      clientX: from.x, clientY: from.y,
    }));
    widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 72,
      clientX: from.x - 20, clientY: from.y - 30,
    }));
    widget.pet.ownerDocument.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 72,
      clientX: from.x - 20, clientY: from.y - 30,
    }));
    var airborneWithGravityOn = widget.placement.isAirborne();
    // Land it again so the checks that follow start from a pet on the ground.
    if (widget.placement.fall) widget.placement.endFall();
    widget.placement.x = positionBefore.x;
    widget.placement.y = positionBefore.y;
    widget.placement.clampToViewport();
    widget.preferences.gravity = before !== false;
    widget.writeStorage();
    widget.applyGravity();
    widget.applyPlacement();

    report.gravitySwitch = {
      markedOn: markedOn, toggled: toggled, offState: offState, offRow: offRow,
      toldWhy: toldWhy, closedAfterClick: closedAfterClick,
      airborneWithGravityOff: airborneWithGravityOff, driftWithGravityOff: driftWithGravityOff,
      restored: restored, airborneWithGravityOn: airborneWithGravityOn,
      windowKeyBefore: windowKeyBefore,
    };
    return markedOn && toggled && toldWhy && closedAfterClick
      && offState.preference === false && offState.throwEnabled === false
      && offState.stored === false && offState.windowGravity === windowKeyBefore
      && airborneWithGravityOff === false
      && driftWithGravityOff[0] === 0 && driftWithGravityOff[1] === 0
      && restored && airborneWithGravityOn === true;
  });
  /**
   * The menu is clamped into the frame by its own measured box.
   *
   * Opened at the bottom-right corner — where a context menu is most likely to run off the frame — the WHOLE
   * box has to stay on screen: a menu whose last entry hangs off an edge is an entry that cannot be clicked.
   */
  check('an open menu stays fully inside the viewport', function () {
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    widget.openMenuAt(viewportWidth - 2, viewportHeight - 2);
    var rect = widget.menu.element.getBoundingClientRect();
    report.menuClamp = {
      viewport: [viewportWidth, viewportHeight],
      rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
    };
    var inside = rect.left >= 0 && rect.top >= 0 && rect.right <= viewportWidth
      && rect.bottom <= viewportHeight && rect.width > 0 && rect.height > 0;
    widget.closeMenu();
    return inside;
  });

  /**
   * The two ways out, and the two presses that must NOT close it.
   *
   * A press outside and Escape both put it away; a press INSIDE it does not, which is what makes the entries
   * clickable at all. The outside press is dispatched in the CAPTURE phase's own terms — on the document —
   * because that is where the module listens.
   *
   * And the press that OPENED it does not either. `lib/menu.js` binds its document guards one TASK after the
   * open for exactly that reason, so the probe has to model the two as what they are: a press in the opening
   * task (the surface is still inside its own `contextmenu` handler) and a press in a later one (the user's
   * next click). This check was a same-tick dispatch until 2026-10-12, which made it measure whether two
   * `event.timeStamp` values happened to round to the same 100 µs — it passed or failed on timing.
   */
  asyncCheck('an outside press and Escape put the menu away, a press inside does not', function () {
    /** Press the document the way a user's outside click arrives. */
    function pressDocument(x, y, pointerId) {
      document.dispatchEvent(new window.PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, pointerId: pointerId, clientX: x, clientY: y,
      }));
    }
    /** One task, which is what lets the menu's deferred guards exist. */
    function settle() {
      return new Promise(function (resolve) { window.setTimeout(resolve, 4); });
    }

    widget.openMenuAt(80, 80);
    var opened = widget.menu.isOpen() === true;
    pressDocument(5, 5, 11);
    var survivedOpeningPress = widget.menu.isOpen() === true;
    return settle().then(function () {
      var item = menuItem('resetView');
      if (item) {
        item.dispatchEvent(new window.PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, button: 0, pointerId: 12, clientX: 90, clientY: 90,
        }));
      }
      var survivedInsidePress = widget.menu.isOpen() === true;
      pressDocument(5, 5, 13);
      var closedByPress = widget.menu.isOpen() === false;
      widget.openMenuAt(80, 80);
      return settle().then(function () {
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        var closedByEscape = widget.menu.isOpen() === false;
        report.menuClose = {
          opened: opened,
          survivedOpeningPress: survivedOpeningPress,
          survivedInsidePress: survivedInsidePress,
          closedByPress: closedByPress,
          closedByEscape: closedByEscape,
        };
        return opened && survivedOpeningPress && survivedInsidePress && closedByPress && closedByEscape;
      });
    });
  });

  /**
   * The DOM must follow the pointer WHILE dragging.
   *
   * This is the assertion for "the model does not move while I drag it, then appears
   * under the pointer when I let go": the placement changed on every move, but only
   * the landing path in `tick` ever wrote it to CSS, so nothing moved until the
   * throw finished. Asserting the state was not enough — the check has to read the
   * element's own style, which is what the user sees.
   */
  check('the pet DOM follows the pointer during a drag', function () {
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    widget.closeMenu();
    // 65% is the smallest the size control allows, and the short probe window needs
    // it: at 100% the pet is 390 px tall in a 488 px frame and the vertical axis has
    // 98 px of travel, so a -60 px move is fine but a larger one would be clamped.
    widget.preferences.size = 65;
    widget.applyPlacement();

    // A start with room in every direction, so a clamp cannot mask the failure.
    var dx = 90;
    var dy = -60;
    var spanX = Math.max(1, viewportWidth - widget.placement.width);
    var spanY = Math.max(1, viewportHeight - widget.placement.height);
    widget.placement.x = (4 - dx) / spanX;
    widget.placement.y = (4 - dy) / spanY;
    widget.applyPlacement();

    var before = widget.pet.getBoundingClientRect();
    var startX = before.left + 20;
    var startY = before.top + 20;
    widget.onPointerDown({ button: 0, pointerId: 11, clientX: startX, clientY: startY });
    widget.onPointerMove({ pointerId: 11, clientX: startX + dx, clientY: startY + dy });
    var after = widget.pet.getBoundingClientRect();
    widget.onPointerUp({ pointerId: 11 });

    var moved = [Math.round(after.left - before.left), Math.round(after.top - before.top)];
    report.dragDom = {
      moved: moved,
      pointer: [dx, dy],
      style: [widget.pet.style.left, widget.pet.style.top]
    };
    return moved[0] === dx && moved[1] === dy;
  });

  /**
   * The same 1:1 follow, driven through the LISTENERS instead of by calling the
   * handlers.
   *
   * The check above is strong about the maths and blind to the wiring: an arming path
   * that never runs, a swallowed event, or a capture that retargets the moves passes it
   * and fails in the app. This one dispatches what a mouse actually sends — a press on
   * the pet, then moves on the DOCUMENT, which is where a captured pointer's events
   * arrive — and asserts the pet tracks them pixel for pixel.
   */
  check('a dispatched drag follows the pointer through the real listeners', function () {
    widget.closeMenu();
    widget.resetSize();
    var pet = widget.pet;

    // Start in the MIDDLE of the travel on both axes, and move by an amount that fits.
    // Both halves of that matter: `y` is measured from the bottom and `pixels()` derives
    // top as `(1 - y) * H - height`, so a y picked as a fraction of the height puts the
    // pet half off the top of the window and the clamp, not the drag, decides the
    // result. (The first version of this check did exactly that and "proved" a vertical
    // drag bug that was its own arithmetic.)
    var spanX = Math.max(1, window.innerWidth - widget.placement.width);
    var spanY = Math.max(1, window.innerHeight - widget.placement.height);
    var dx = Math.min(40, Math.floor(spanX / 2));
    var dy = -Math.min(25, Math.floor(spanY / 2));
    if (dx < 10 || Math.abs(dy) < 10) {
      report.dragEvents = { skipped: true, span: [spanX, spanY] };
      return false;
    }
    widget.placement.x = (spanX / 2) / window.innerWidth;
    widget.placement.y = (spanY / 2) / window.innerHeight;
    widget.applyPlacement();

    var before = pet.getBoundingClientRect();
    var startX = before.left + 15;
    var startY = before.top + 15;

    // The REACTION is recorded as well as the geometry. The user's report is about timing: a drag has
    // to react when the press STARTS TO MOVE, not when it ends (where it reads as a landing).
    var notes = [];
    var realNote = widget.scene.noteInteraction;
    widget.scene.noteInteraction = function (reason) {
      notes.push(reason);
      return realNote.call(widget.scene, reason);
    };

    pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 91, clientX: startX, clientY: startY
    }));
    var armed = widget.placement.dragging === true;
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, pointerId: 91, clientX: startX + dx, clientY: startY + dy
    }));
    var reactedOnMove = notes.slice();
    var after = pet.getBoundingClientRect();
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 91, clientX: startX + dx, clientY: startY + dy
    }));
    widget.scene.noteInteraction = realNote;

    var moved = [Math.round(after.left - before.left), Math.round(after.top - before.top)];
    var reactedOnce = notes.filter(function (reason) { return reason === 'drag'; }).length === 1;
    report.dragEvents = {
      armed: armed, moved: moved, pointer: [dx, dy], span: [spanX, spanY],
      reactedOnMove: reactedOnMove, notes: notes,
    };
    return armed && moved[0] === dx && moved[1] === dy
      && reactedOnMove.indexOf('drag') !== -1 && reactedOnce;
  });

  /**
   * The other half of the timing fix: a press that never moves is still a CLICK.
   *
   * Without this, "react on the first movement" could quietly become "react on every press", and the
   * greeting a click is supposed to produce would fire while the user was only picking the pet up.
   */
  check('a press with no movement is a click, reacted to once', function () {
    widget.closeMenu();
    var pet = widget.pet;
    var box = pet.getBoundingClientRect();
    var at = { x: box.left + 15, y: box.top + 15 };

    var notes = [];
    var realNote = widget.scene.noteInteraction;
    widget.scene.noteInteraction = function (reason) {
      notes.push(reason);
      return realNote.call(widget.scene, reason);
    };
    pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 92, clientX: at.x, clientY: at.y
    }));
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 92, clientX: at.x, clientY: at.y
    }));
    widget.scene.noteInteraction = realNote;

    report.clickReaction = notes;
    return notes.length === 1 && notes[0] === 'click';
  });

  /**
   * A press that only WOBBLES is still a click — and the pet does not move while it wobbles.
   *
   * The report this exists for: "点击和拖动区分不了". The old rule called any pointermove a drag, so a click
   * with three pixels of hand shake fired the DRAG reaction and never the click one — the greeting was
   * unreachable for anyone whose hand is not perfectly still. `core.PRESS_LIMITS.moveThreshold` is the slop the
   * secondary button already had; this check is the primary button getting the same treatment.
   */
  check('a press that only wobbles is still a click, and the pet does not move', function () {
    widget.closeMenu();
    var pet = widget.pet;
    var box = pet.getBoundingClientRect();
    var at = { x: box.left + 15, y: box.top + 15 };
    var limit = (CORE.PRESS_LIMITS || { moveThreshold: 4 }).moveThreshold;
    // Inside the threshold on BOTH axes, so the sum is what has to hold — not one axis at a time.
    var wobble = { x: Math.max(1, Math.floor(limit / 2) - 1), y: Math.max(1, Math.floor(limit / 2) - 1) };
    var notes = [];
    var realNote = widget.scene.noteInteraction;
    widget.scene.noteInteraction = function (reason, part) {
      notes.push(reason);
      return realNote.call(widget.scene, reason, part);
    };
    var before = pet.getBoundingClientRect();
    pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 93, clientX: at.x, clientY: at.y
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, pointerId: 93, clientX: at.x + wobble.x, clientY: at.y + wobble.y
    }));
    var duringWobble = notes.slice();
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 93, clientX: at.x + wobble.x, clientY: at.y + wobble.y
    }));
    widget.scene.noteInteraction = realNote;
    var after = pet.getBoundingClientRect();
    report.wobbleClick = {
      wobble: wobble, limit: limit,
      duringWobble: duringWobble, notes: notes,
      moved: [Math.round(after.left - before.left), Math.round(after.top - before.top)],
    };
    return duringWobble.length === 0
      && notes.length === 1 && notes[0] === 'click'
      && report.wobbleClick.moved[0] === 0 && report.wobbleClick.moved[1] === 0;
  });

  /**
   * A press that stays put for long enough becomes a 长按 — WHILE it is still held, and INSTEAD of a click.
   *
   * Distance separates click from drag; time separates click from hold, and the reaction has to arrive while
   * the finger is still down: a pat that reacts only after the user lets go reads as a late click, which is the
   * same complaint the drag reaction was fixed for.
   */
  asyncCheck('a press held still becomes a 长按 while it is held, and not a click as well', function () {
    widget.closeMenu();
    var pet = widget.pet;
    var box = pet.getBoundingClientRect();
    var at = { x: box.left + 15, y: box.top + 15 };
    var holdMs = Math.round(((CORE.PRESS_LIMITS || { holdSeconds: 0.6 }).holdSeconds) * 1000);
    var notes = [];
    var realNote = widget.scene.noteInteraction;
    widget.scene.noteInteraction = function (reason, part) {
      notes.push(reason);
      return realNote.call(widget.scene, reason, part);
    };
    pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 94, clientX: at.x, clientY: at.y
    }));
    return new Promise(function (resolve) {
      setTimeout(function () {
        // Read BEFORE the release: this is the half that says the reaction did not wait for pointerup.
        var whileHeld = notes.slice();
        document.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, pointerId: 94, clientX: at.x, clientY: at.y
        }));
        widget.scene.noteInteraction = realNote;
        report.longPress = { holdMs: holdMs, whileHeld: whileHeld, afterRelease: notes.slice() };
        resolve(whileHeld.length === 1 && whileHeld[0] === 'hold' && notes.length === 1);
      }, holdMs + 120);
    });
  });

  /**
   * A press is measured against the MODEL, not against the pet's rectangle.
   *
   * The alpha hit test answers "is something painted here"; this answers the other question with geometry, and
   * the two must agree about where the pointer is. A ray that misses the model is a real answer (`null`) and
   * must not be turned into an invented region.
   */
  check('the press position is measured against the model, and a miss is not a region', function () {
    var scene = widget.scene;
    var canvasRect = widget.canvas.getBoundingClientRect();
    var box = widget.pet.getBoundingClientRect();
    var local = {
      x: (box.left + box.width / 2) - canvasRect.left,
      y: (box.top + box.height / 2) - canvasRect.top,
    };
    var hit = scene.anatomyAt(local.x, local.y);
    var miss = scene.anatomyAt(-40, -40);
    /**
     * The NAME → REGION mapping, driven through the same ray.
     *
     * This fixture's mesh carries no name of its own and no skeleton, so the honest answer for it is `body` —
     * the fallback, and the reason the assertion below does not demand a bone. Giving the mesh a name and
     * asking again is what proves the mapping follows the NAME, and that is the whole difference between an eye
     * and a head.
     */
    var remapped = null;
    var meshes = [];
    if (scene.avatar && scene.avatar.root && typeof scene.avatar.root.traverse === 'function') {
      // EVERY mesh, not the first one found: the ray decides which one it hits, and renaming only the first
      // measured nothing at all the first time this check ran.
      scene.avatar.root.traverse(function (node) {
        if (node && node.isMesh) meshes.push({ node: node, name: node.name });
      });
    }
    meshes.forEach(function (entry) { entry.node.name = 'leftEye'; });
    if (meshes.length) remapped = scene.anatomyAt(local.x, local.y);
    meshes.forEach(function (entry) { entry.node.name = entry.name; });
    report.anatomy = {
      local: local, hit: hit, miss: miss, remapped: remapped, meshCount: meshes.length,
      regions: (CORE.STRUCTURE_REGIONS || []).slice(),
    };
    return Boolean(hit)
      && (CORE.STRUCTURE_REGIONS || []).indexOf(hit.region) !== -1
      && Boolean(hit.part) && hit.part.region === hit.region
      && miss === null
      && Boolean(remapped) && remapped.region === 'eye' && remapped.part && remapped.part.id === 'eye';
  });

  /**
   * A press on a SPRING JOINT knows which CHAIN it grabbed.
   *
   * The operator asked whether the chain behind a clicked part could be named, and this is that mapping driven for
   * real: the chain index is keyed by the bone OBJECT the raycast reports, so the check takes a joint out of the
   * fixture's own `tail` chain and requires it back as `tail` — while a bone that is NOT a spring joint (the
   * humanoid head) answers null rather than guessing. The raycast's answer carries the field too, `null` included:
   * "no chain here" is an answer, and a missing field would be a different one.
   */
  asyncCheck('a press on a spring joint knows which chain it grabbed', function () {
    var scene = widget.scene;
    // What the WIDGET's own scene holds, recorded because THAT is the scene the app runs: an empty chain list
    // here would mean the feature can never fire, however well the mapping works on a scene built by the probe.
    var widgetInfo = scene.springChainInfo || [];
    var headBone = scene.avatar && scene.avatar.bones ? scene.avatar.bones.head : null;
    var widgetReport = {
      chains: widgetInfo.map(function (chain) { return chain.key; }),
      skipped: (scene.springChainSkipped || []).map(function (entry) { return entry.name + ':' + entry.reason; }),
      boneKeys: scene.avatar && scene.avatar.bones ? Object.keys(scene.avatar.bones).length : null,
      kind: scene.avatar ? scene.avatar.kind : null,
      fromHead: headBone ? scene.springChainForBone(headBone) : 'no-head-bone',
    };
    var canvasRect = widget.canvas.getBoundingClientRect();
    var box = widget.pet.getBoundingClientRect();
    var anatomy = scene.anatomyAt(
      (box.left + box.width / 2) - canvasRect.left,
      (box.top + box.height / 2) - canvasRect.top,
    );
    widgetReport.anatomyHasChain = Boolean(anatomy) && Object.prototype.hasOwnProperty.call(anatomy, 'chain');
    widgetReport.anatomyChain = anatomy ? anatomy.chain : null;

    // The MAPPING itself, on a scene this check parses from the fixture — the path the gaze checks already use, and
    // independent of whatever state the widget's scene is in.
    var canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    document.body.appendChild(canvas);
    var probe = new SCENE.Scene(canvas, { assetBase: '/asset', modelId: 'chains', onError: function () {} });
    probe.resize(128, 128);
    var base64 = globalThis.__PET3D_VRM_BASE64__;
    var bytes = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });
    return probe.parse(bytes.buffer, 'chains').then(function (parsed) {
      if (!parsed.ok) throw new Error('fixture did not load: ' + parsed.error);
      var info = probe.springChainInfo || [];
      var tail = null;
      for (var i = 0; i < info.length; i += 1) {
        if (info[i] && info[i].key === 'tail') tail = info[i];
      }
      // The index is keyed by the BONE, not by three-vrm's joint wrapper: `anatomyAt` looks up the bone the
      // skeleton names, so the check has to ask with the same object — asking with the wrapper answered null the
      // first time this ran, which is how the distinction got written down here.
      var fromTail = tail && tail.joints.length ? probe.springChainForBone(tail.joints[0].joint.bone) : null;
      var probeHead = probe.avatar && probe.avatar.bones ? probe.avatar.bones.head : null;
      report.springChain = {
        widget: widgetReport,
        chains: info.map(function (chain) { return chain.key; }),
        tailJoints: tail ? tail.joints.length : 0,
        fromTail: fromTail,
        fromHead: probeHead ? probe.springChainForBone(probeHead) : 'no-head-bone',
      };
      return Boolean(tail) && Boolean(fromTail) && fromTail.key === 'tail'
        && fromTail.label === tail.label
        && report.springChain.fromHead === null
        && widgetReport.anatomyHasChain === true;
    });
  });

  /**
   * The part travels to the host with the state: a click does not change the state, so a reporter that watched
   * the state alone would never carry it.
   */
  check('a press tells the host which part it landed on', function () {
    var sent = [];
    var realPublish = widget.publishState;
    widget.publishState = function (state, line, touch) { sent.push({ state: state, line: line, touch: touch || null }); };
    widget.notePress('click', { region: 'eye', bone: 'leftEye', mesh: 'Face' });
    widget.tick(1 / 60);
    widget.publishState = realPublish;
    report.touchWire = { sent: sent };
    var first = sent.length ? sent[0].touch : null;
    return Boolean(first) && first.reason === 'click' && first.region === 'eye' && first.bone === 'leftEye';
  });

  /**
   * The per-part chain, driven through the REAL scene: a region whose row names an emotion answers the press,
   * and a region whose row is empty falls through to the generic click row rather than going silent.
   */
  check('a part row answers a press on that part, and an empty one falls through to the click row', function () {
    var scene = widget.scene;
    var realPreferences = scene.preferences;
    var realAvatar = scene.avatar;
    var realNames = scene.expressionNames;
    /**
     * A STUBBED expressions manager, because this check is about the CHAIN and not about whichever model this
     * fixture happens to load: `showableEmotions()` reads `manager.expressionMap` and the scene's own name list,
     * so supplying both makes the outcome exactly predictable — and the earlier version of this check proved
     * nothing on a fixture whose expressions have no binds (`showable` came back empty and the check bailed).
     */
    scene.avatar = {
      root: realAvatar && realAvatar.root,
      expressions: { expressionMap: { happy: { binds: ['b'] }, wag: { binds: ['w'] } } },
    };
    scene.expressionNames = function () { return ['happy', 'wag']; };
    /**
     * The parts are the USER'S rows now, so this builds them the way the settings page does: a part that names
     * the structure it owns, and one that owns nothing (so a press on it must fall through to the generic row).
     */
    var withParts = function (eyeEmotions, genericEmotions) {
      var prefs = CORE.cleanPreferences({
        parts: {
          items: [
            { id: 'eye', label: '眼睛', region: 'eye', match: [], emotion: { emotions: eyeEmotions, holdSeconds: 2 } },
            { id: 'ear', label: '耳朵', match: ['ErDuo'], emotion: { emotions: ['happy'], holdSeconds: 3 } },
            { id: 'body', label: '身体', region: 'body', emotion: { emotions: [], holdSeconds: 2 } },
          ],
        },
      });
      prefs.expressions.emotion.triggers.click = { enabled: true, emotions: genericEmotions, holdSeconds: 1 };
      scene.preferences = prefs;
      return prefs;
    };
    var out = { showable: scene.showableEmotions() };
    var first = withParts(['happy'], ['wag']);
    var earPart = CORE.partItemFor(first, 'ErDuo.L.002', 'head');
    out.earPart = earPart ? { id: earPart.id, label: earPart.label, match: earPart.match } : null;
    // The eye names an emotion: the PART row is what answers, and both the reason and the part say so.
    out.partPicked = scene.noteInteraction('click', { region: 'eye', part: CORE.partItemById(first, 'eye'), bone: 'leftEye', mesh: null });
    out.partState = scene.emotionState();
    // A structure a USER part claims answers with THAT part, whatever region the name heuristic would give it.
    out.earPicked = scene.noteInteraction('click', { region: 'head', part: earPart, bone: 'ErDuo.L.002', mesh: null });
    out.earState = scene.emotionState();
    // A part whose row is EMPTY falls through to the generic click row, and reports no part.
    out.fallthroughPicked = scene.noteInteraction('click', { region: 'body', part: CORE.partItemById(first, 'body'), bone: 'Spine', mesh: null });
    out.fallthroughState = scene.emotionState();
    // A press with no part at all (no raycast answered) still reacts — and records that it had no part.
    out.missPicked = scene.noteInteraction('click', null);
    out.missState = scene.emotionState();
    out.missInteraction = scene.lastInteractionState();
    scene.preferences = realPreferences;
    scene.avatar = realAvatar;
    scene.expressionNames = realNames;
    report.partChain = out;
    return out.showable.length === 2
      && out.earPart && out.earPart.id === 'ear' && out.earPart.match[0].name === 'ErDuo'
      && out.partPicked === 'happy' && out.partState.part === 'eye' && out.partState.reason === 'click'
      && out.partState.hold === 2 && out.partState.partLabel === '眼睛'
      && out.earPicked === 'happy' && out.earState.part === 'ear' && out.earState.hold === 3
      && out.fallthroughPicked === 'wag' && out.fallthroughState.part === null
      && out.missPicked === 'wag' && out.missState.part === null
      && out.missInteraction.part === null && out.missInteraction.reason === 'click';
  });

  /**
   * The 视线 settings reach the renderer, and "auto" really means the frame.
   *
   * `gazeCurve` / `gazeSpanX` / `gazeSpanY` are editable in the 模型参数 window, and the failure mode of a
   * setting like that is SILENT: the slider moves, the page stores it, and the head keeps answering the
   * constant that used to be compiled in. So this drives the widget's own frame with distinctive values —
   * a straight line (`curve: 1`) and a 100 px span — and checks the applied gaze equals what `pointerAim`
   * predicts for them, then puts the shipped settings back and checks "auto" resolves to the frame's width.
   */
  check('the gaze settings drive the applied gaze, and auto means the frame', function () {
    var scene = widget.scene;
    if (!scene || !scene.motion) return false;
    var placement = widget.placement;
    var centreX = placement.pixels().left + placement.width / 2;
    var centreY = placement.pixels().top + placement.height / 2;
    // Somewhere to the side, so the aim is well inside the curve and a wrong span shows up loudly.
    widget.movePointer(centreX + 300, centreY);
    var predict = function (spanX, curve) {
      return scene.gazeFromAim(CORE.pointerAim({
        pointerX: widget.pointer.x, pointerY: widget.pointer.y,
        centreX: centreX, centreY: centreY,
        spanX: spanX, spanY: CORE.GAZE_SPAN.y, curve: curve,
      })).yaw;
    };

    widget.preferences.gazeCurve = 1;
    widget.preferences.gazeSpanX = 100;
    widget.preferences.gazeSpanY = 0;
    widget.tick(1 / 60);
    var straight = scene.motion.gaze ? scene.motion.gaze.yaw : null;

    widget.preferences.gazeCurve = CORE.DEFAULTS.gazeCurve;
    widget.preferences.gazeSpanX = 0;
    widget.tick(1 / 60);
    var auto = scene.motion.gaze ? scene.motion.gaze.yaw : null;
    var autoSpan = CORE.resolveGazeSpan(widget.preferences.gazeSpanX, placement.viewportWidth);

    report.gazeSettings = {
      straight: straight === null ? null : +straight.toFixed(4),
      expectedStraight: +predict(100, 1).toFixed(4),
      auto: auto === null ? null : +auto.toFixed(4),
      expectedAuto: +predict(placement.viewportWidth, CORE.DEFAULTS.gazeCurve).toFixed(4),
      autoSpan: autoSpan,
      viewportWidth: placement.viewportWidth,
    };
    return straight !== null && auto !== null
      && Math.abs(straight - predict(100, 1)) < 1e-9
      && Math.abs(auto - predict(placement.viewportWidth, CORE.DEFAULTS.gazeCurve)) < 1e-9
      && Math.abs(straight - auto) > 1e-6
      && autoSpan === placement.viewportWidth;
  });

  /**
   * 抛出去之后的飞行也要有物理反馈 —— 和拖动同一条通道。
   *
   * 操作者（2026-10-12）：「修重力下坠和抛掷时的物理反馈」。此前的飞行期间 `setDragMotion` 一直是零（释放拖动的
   * 那一刻写的就是 `(0, 0)`），模型在世界坐标里纹丝不动，弹簧骨看到的是一只站着不动的宠物，头发就直挺挺地跟着
   * 一起掉。这条检查测的是三件事，每一件都是那次报告的一半：
   *
   *   * 上升阶段喂进去的是**向上**的速度（屏幕坐标，y 向上为负）；
   *   * 越过顶点之后翻成**向下** —— 这正是身体与头发来回甩的那一下，也是符号写反时唯一看得见的地方；
   *   * 落地那一帧喂进去的是 0，且此时已经不在空中 —— 收束本身是落地，而不是硬切。
   *
   * 单位也是断言的一部分：喂给模型的是**屏幕像素/秒**（几百到几千），而模拟里用的是"视口分数/秒"（个位数）。
   * 把分数直接喂进去不会抛错，只会让物理弱到看不见 —— 这种错误只能靠数量级来抓。
   */
  asyncCheck('a throw feeds the flight into the rig: up while rising, down while falling, zero on landing', async function () {
    var scene = widget.scene;
    if (!scene || typeof scene.setDragMotion !== 'function') return false;
    widget.closeMenu();
    widget.resetSize();
    var samples = [];
    var realSet = scene.setDragMotion;
    scene.setDragMotion = function (vx, vy) {
      samples.push({ vx: Number(vx), vy: Number(vy), airborne: widget.placement.isAirborne() });
      return realSet.call(scene, vx, vy);
    };

    var wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 14); }); };
    var box = widget.pet.getBoundingClientRect();
    var from = { x: box.left + 20, y: box.top + Math.round(box.height * 0.6) };
    var send = function (type, x, y) {
      document.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 96, clientX: x, clientY: y,
      }));
    };
    // 往上、往右甩：屏幕 y 向上为负，所以三次移动的 y 一路减小。
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 96, clientX: from.x, clientY: from.y,
    }));
    for (var step = 1; step <= 3; step += 1) {
      await wait();
      send('pointermove', from.x + step * 26, from.y - step * 34);
    }
    send('pointerup', from.x + 78, from.y - 102);
    var thrown = widget.placement.isAirborne();

    // 让飞行跑完（重力是 7 个视口高度/秒²，够高的抛掷在半秒内落地）。
    var guard = 0;
    while (widget.placement.isAirborne() && guard < 180) {
      widget.tick(1 / 60);
      guard += 1;
    }
    scene.setDragMotion = realSet;

    var rising = samples.filter(function (sample) { return sample.airborne && sample.vy < -50; });
    var falling = samples.filter(function (sample) { return sample.airborne && sample.vy > 50; });
    var sideways = samples.filter(function (sample) { return sample.airborne && sample.vx > 50; });
    var settled = samples.length ? samples[samples.length - 1] : null;

    report.fallMotion = {
      thrown: thrown, frames: guard, samples: samples.length,
      rising: rising.length, falling: falling.length, sideways: sideways.length,
      apexFlips: rising.length > 0 && falling.length > 0,
      last: settled,
    };
    return thrown && samples.length > 0
      && rising.length > 0 && falling.length > 0 && sideways.length > 0
      && Boolean(settled) && settled.airborne === false && settled.vx === 0 && settled.vy === 0;
  });
  /**
   * The drag lag: the pet is CARRIED — by its slot in the app, by its window when floating — so the
   * model's own world position never changes and the spring bones see a pet that is standing still.
   * That is the reported "the hair does not swing while dragging". `setDragMotion` puts the motion back
   * into the rig, and this asserts the three properties that make it look right: the body lags OPPOSITE
   * the drag, downward drag lags upward in world units (screen y grows downward), and it settles back to
   * rest when the drag stops — the settle is the swing rather than a snap.
   */
  check('a drag feeds real motion to the rig, and it settles when the drag stops', function () {
    var scene = widget.scene;
    if (!scene || typeof scene.setDragMotion !== 'function') return false;
    var rest = function () { return (scene.stage ? scene.stage.position.y : 0) - (scene.baseY || 0); };

    scene.setDragMotion(0, 0);
    for (var settle = 0; settle < 60; settle += 1) scene.tick(1 / 60);
    var restX = scene.stage.position.x;
    var restY = rest();

    // Dragged to the RIGHT: the body falls behind, i.e. to the left.
    scene.setDragMotion(900, 0);
    for (var right = 0; right < 30; right += 1) scene.tick(1 / 60);
    var lagX = scene.stage.position.x - restX;

    // Dragged DOWN at the same speed: the body lags up (the stage's y grows upward).
    scene.setDragMotion(0, 900);
    for (var down = 0; down < 30; down += 1) scene.tick(1 / 60);
    var lagY = rest() - restY;

    // Released: back to rest.
    scene.setDragMotion(0, 0);
    for (var back = 0; back < 150; back += 1) scene.tick(1 / 60);
    var settledX = Math.abs(scene.stage.position.x - restX);
    var settledY = Math.abs(rest() - restY);

    report.dragMotion = {
      lagX: +lagX.toFixed(5), lagY: +lagY.toFixed(5),
      settledX: +settledX.toFixed(5), settledY: +settledY.toFixed(5),
    };
    return lagX < -0.001 && lagY > 0.001 && settledX < 0.001 && settledY < 0.001;
  });

  /**
   * Blinking: one pulse normally, and a quick DOUBLE in a fifth of them.
   *
   * The request was "有20%的概率快速连续眨眼2次（两次总时长为单次眨眼的1.5倍）", and the interesting half is the
   * second one: two blinks squeezed into 1.5x the time of one means the eyes must come fully OPEN for an
   * instant in between, or it reads as one slow squint instead. So this measures the SHAPE — how many times
   * the weight rises through the closed half, and how long the whole thing lasts — by stepping the scene's
   * own frames, with the random injected on both sides of the 20 % boundary.
   */
  check('a blink is one pulse, and a fifth of them are a quick double', function () {
    var scene = widget.scene;
    if (!scene || typeof scene.advanceExpressions !== 'function' || !scene.motion) return false;
    var limits = CORE.BLINK_LIMITS;
    var frame = 1 / 60;
    var realRandom = scene.random;
    var realState = scene.expressionState;
    var realBlink = scene.expressionBehaviour.blink;

    var run = function (randomValue, seconds) {
      scene.random = function () { return randomValue; };
      scene.expressionBehaviour.blink = 0;
      // Blink NOW rather than in 2-6 s: a `nextBlinkAt` in the past fires on the first frame.
      scene.expressionState = { nextBlinkAt: scene.motion.elapsed, blinkUntil: 0 };
      var samples = [];
      var frames = Math.round(seconds / frame);
      for (var i = 0; i < frames; i += 1) {
        scene.tick(frame);
        samples.push(scene.expressionBehaviour.blink || 0);
      }
      return samples;
    };
    var analyse = function (samples) {
      var start = -1;
      var end = -1;
      var rises = 0;
      var previous = 0;
      var peaks = [];
      for (var i = 0; i < samples.length; i += 1) {
        var value = samples[i];
        if (value > 0.02) {
          if (start < 0) start = i;
          end = i;
        }
        if (previous < 0.5 && value >= 0.5) {
          rises += 1;
          peaks.push(i);
        }
        previous = value;
      }
      var dip = 1;
      if (peaks.length === 2) {
        for (var j = peaks[0]; j <= peaks[1]; j += 1) dip = Math.min(dip, samples[j]);
      }
      return {
        rises: rises,
        spanMs: start < 0 ? 0 : Math.round((end - start + 1) * frame * 1000),
        dip: peaks.length === 2 ? +dip.toFixed(3) : null,
      };
    };

    var span = limits.durationSeconds * 2.2;
    var single = analyse(run(0.9, span));
    var doubled = analyse(run(0.1, span));
    var atChance = analyse(run(limits.doubleChance - 0.01, span));
    var overChance = analyse(run(limits.doubleChance + 0.01, span));

    scene.random = realRandom;
    scene.expressionState = realState;
    scene.expressionBehaviour.blink = realBlink;

    var singleMs = Math.round(limits.durationSeconds * 1000);
    var doubleMs = Math.round(singleMs * limits.doubleDurationRatio);
    report.blink = {
      single: single, double: doubled,
      atChance: atChance.rises, overChance: overChance.rises,
      singleMs: singleMs, doubleMs: doubleMs,
    };
    var near = function (value, wanted) { return Math.abs(value - wanted) <= 60; };
    return single.rises === 1 && doubled.rises === 2
      && near(single.spanMs, singleMs) && near(doubled.spanMs, doubleMs)
      && doubled.dip !== null && doubled.dip < 0.2
      && atChance.rises === 2 && overChance.rises === 1;
  });

  /**
   * A drag with preferences as the PREVIOUS build stored them: `size: 160` from the old
   * slider and `modelScale: 1.8`, which is now folded into the pet's slot.
   *
   * That combination is the one that can silently produce a pet larger than its frame,
   * and a geometric fault reads as "the pet will not follow the pointer". Asserted with
   * a second widget so the shared one keeps its state for the checks that follow.
   */
  check('a drag works with preferences written by the previous build', function () {
    var previous = window.localStorage.getItem(CORE.STORAGE_KEY);
    window.localStorage.setItem(CORE.STORAGE_KEY, JSON.stringify({
      scope: 'global', size: 160, modelScale: 1.8, motion: true, modelId: 'placeholder'
    }));

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    document.body.appendChild(host);
    var old = null;
    var ok = false;
    var detail = {};
    try {
      old = new CLIENT.Pet3DWidget(host, { language: 'en' });
      var spans = {
        x: Math.max(1, window.innerWidth - old.placement.width),
        y: Math.max(1, window.innerHeight - old.placement.height)
      };
      // The slot must still fit the frame, and still leave real room to drag in — the
      // whole reason the fraction cap exists.
      var insideFrame = old.placement.width <= window.innerWidth
        && old.placement.height <= window.innerHeight
        && spans.x > 10 && spans.y > 10;
      var dx = Math.min(30, Math.floor(spans.x / 2));
      var dy = -Math.min(20, Math.floor(spans.y / 2));
      old.placement.x = (spans.x / 2) / window.innerWidth;
      old.placement.y = (spans.y / 2) / window.innerHeight;
      old.applyPlacement();
      var before = old.pet.getBoundingClientRect();
      var startX = before.left + 15;
      var startY = before.top + 15;
      old.pet.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 92, clientX: startX, clientY: startY
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, buttons: 1, pointerId: 92, clientX: startX + dx, clientY: startY + dy
      }));
      var after = old.pet.getBoundingClientRect();
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 92 }));
      var moved = [Math.round(after.left - before.left), Math.round(after.top - before.top)];
      detail = {
        stored: [old.preferences.size, old.preferences.modelScale],
        slot: [old.placement.width, old.placement.height],
        viewport: [window.innerWidth, window.innerHeight],
        moved: moved,
        pointer: [dx, dy]
      };
      ok = insideFrame && moved[0] === dx && moved[1] === dy;
    } catch (error) {
      detail = { error: String(error && error.message) };
    } finally {
      if (old) old.dispose();
      if (host.parentNode) host.parentNode.removeChild(host);
      if (previous === null) window.localStorage.removeItem(CORE.STORAGE_KEY);
      else window.localStorage.setItem(CORE.STORAGE_KEY, previous);
    }
    report.oldPrefsDrag = detail;
    return ok;
  });

  /**
   * The reported "the pet only shifts a little when dragged" bug, asserted at its
   * root: the scene must not offset the model inside its own canvas.
   *
   * The client moves the pet element across the window with CSS, so any in-canvas
   * offset is a SECOND motion fighting the first — and because the canvas is only
   * as large as the pet, that second motion is a few dozen pixels wide, which reads
   * as a crawl. The frame moves; the model stays centred in it.
   */
  check('the scene leaves the model centred in its canvas at any placement', function () {
    var scene = widget.scene;
    if (!scene || !scene.stage) return false;
    var atOrigin = [scene.stage.position.x, scene.stage.position.y];
    scene.setPlacement(1, 1, 0);
    var atFar = [scene.stage.position.x, scene.stage.position.y];
    scene.setPlacement(0, 0, 0);
    var back = [scene.stage.position.x, scene.stage.position.y];
    report.centredStage = { atOrigin: atOrigin, atFar: atFar, back: back };
    // Identical at every fraction, and horizontally dead centre.
    return atFar[0] === atOrigin[0]
      && atFar[1] === atOrigin[1]
      && back[0] === atOrigin[0]
      && Math.abs(atOrigin[0]) < 1e-9;
  });

  /**
   * 拖动内置宠物时，头发也要飘 —— 与外置窗同一条规则。
   *
   * 操作者（2026-10-12）：「外置宠物移动时头发会飘动，内置没有」。原因在两个界面的输入不同：外置窗的光标流
   * (`lib/desktop-page.js` 的 `onCursor`)**不论是否在拖动**都往弹簧骨推风，而内置宠物此前写着
   * `!dragging && !viewDrag`，拖动时只喂 `setDragMotion`（身体滞后）。所以这里钉住的是"拖动期间确实有风"，
   * 而不只是"身体会滞后"——后者早就通过了，正是它掩盖了这个差别。
   *
   * 三次移动而不是一次：风是"与上一次采样的差"，第一次移动只是把基准点立起来。
   */
  asyncCheck('dragging the app pet blows its hair, exactly as the floating window does', async function () {
    var scene = widget.scene;
    if (!scene || typeof scene.pushWind !== 'function') return false;
    widget.closeMenu();
    widget.resetSize();
    var samples = [];
    var realPush = scene.pushWind;
    scene.pushWind = function (sample) {
      samples.push({
        dx: Number(sample && sample.dx),
        dy: Number(sample && sample.dy),
        dragging: widget.placement.dragging === true,
      });
      return realPush.call(scene, sample);
    };

    var box = widget.pet.getBoundingClientRect();
    var from = { x: box.left + 15, y: box.top + 15 };
    var step = { x: 14, y: 9 };
    var send = function (type, x, y) {
      document.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 95, clientX: x, clientY: y,
      }));
    };
    widget.pet.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 95, clientX: from.x, clientY: from.y,
    }));
    /**
     * 每次移动之间等真实的几毫秒。
     *
     * 风是"这次采样与上次之差除以时间"，而探针原来在同一个 tick 里连发三次 move：`Date.now()` 相同，
     * `dt === 0`，于是 widget 正确地跳过了它们 —— 检查失败在**测量方式**上，不在产品上。真实鼠标的移动之间
     * 本来就有间隔，`await` 一个真实的定时器才是同一种输入。
     */
    var wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 14); }); };
    for (var i = 1; i <= 3; i += 1) {
      await wait();
      send('pointermove', from.x + step.x * i, from.y + step.y * i);
    }
    var duringDrag = samples.filter(function (sample) { return sample.dragging === true; });
    send('pointerup', from.x + step.x * 3, from.y + step.y * 3);
    // 一次划过（不按任何键）仍然照旧吹风：拖动不是唯一来源。**spy 还要在**，第一版在这里就先还原了它，
    // 于是 `swept` 永远是 false —— 又一次"测量方式"的错误。
    var sweepBefore = samples.length;
    await wait();
    send('pointermove', from.x + 60, from.y + 30);
    await wait();
    send('pointermove', from.x + 90, from.y + 45);
    var swept = samples.length > sweepBefore;
    scene.pushWind = realPush;

    report.dragWind = {
      samples: samples.length,
      duringDrag: duringDrag.length,
      firstDx: duringDrag.length ? duringDrag[0].dx : null,
      firstDy: duringDrag.length ? duringDrag[0].dy : null,
      swept: swept,
    };
    return duringDrag.length > 0
      && duringDrag[0].dx > 0 && duringDrag[0].dy > 0
      && swept;
  });
  // Captured so the motion checks below can wait for it. This check ends in a
  // real model load, and a model load re-applies the motion map — running the two
  // at once made the first version of those checks measure that reload instead of
  // their own action.
  var modelFallback = check('a model select with a bad id falls back to the placeholder', function () {
    // No /pet3d/asset route exists in this page, so the fetch must fail and the
    // widget must keep rendering rather than blank out.
    return widget.loadModel('m-does-not-exist').then(function (status) {
      return status && status.ok === false && widget.scene.kind === 'placeholder';
    });
  });

  /**
   * 隐藏宠物, and the way back — the row and the button are the operator's own words now.
   *
   * The entry is what hides the pet (the panel's 隐藏 button is gone), and the restore button is deliberately
   * still a real element outside the menu: a hidden pet cannot be right-clicked, so a menu-only way back would
   * be unreachable by construction. The row was 关闭宠物 until 2026-10-12 (operator: 「内置宠物的'关闭宠物'改成
   * '隐藏宠物'，隐藏之后，在dsh右下角显示一个'显示宠物'的按钮」), so BOTH the row's label and the button's label
   * are asserted here: a rename that reached only one of them is a pet whose way back says the old word.
   */
  check('隐藏宠物 hides the pet, and the 显示宠物 button brings it back', function () {
    widget.closeMenu();
    widget.openMenuAt(60, 60);
    var row = menuItem('closePet');
    var rowLabel = row ? String(row.textContent) : null;
    var clicked = chooseMenuItem('closePet');
    var hidden = widget.pet.hidden === true && widget.restore.hidden === false
      && widget.menu.isOpen() === false && widget.preferences.hidden === true;
    // The button is the pet's own DOM and the operator asked for it in DSH's bottom-right corner, so its
    // rectangle is asserted rather than its class: a button that exists off-screen is not a way back.
    var box = widget.restore.getBoundingClientRect();
    var atBottomRight = box.right > window.innerWidth / 2 && box.bottom > window.innerHeight / 2
      && box.right <= window.innerWidth && box.bottom <= window.innerHeight;
    var buttonLabel = String(widget.restore.textContent);
    widget.restore.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    var shown = widget.pet.hidden === false && widget.preferences.hidden === false;
    /**
     * The WORDS, in the operator's own language — and read from the sources that own them rather than from a
     * literal here.
     *
     * The row's label comes from the shared module, so it is checked against the table this widget's language
     * selects; the button's comes from `lib/client.js`'s own `STRINGS`, which no probe can reach, so a SECOND
     * widget is mounted in Chinese (and disposed) for the one string that has to be 显示宠物. A literal in both
     * languages here would pass while the product showed the wrong one.
     */
    var menuApi = globalThis.__PET3D_MENU__;
    var rowWordsRight = rowLabel === menuApi.strings(widget.language).closePetApp
      && menuApi.strings('zh').closePetApp === '隐藏宠物';
    var zhHost = document.createElement('div');
    document.body.appendChild(zhHost);
    var zhWidget = null;
    var zhButtonLabel = null;
    try {
      zhWidget = new CLIENT.Pet3DWidget(zhHost, { language: 'zh' });
      zhButtonLabel = String(zhWidget.restore.textContent);
    } finally {
      if (zhWidget && typeof zhWidget.dispose === 'function') { try { zhWidget.dispose(); } catch (_error) { /* gone */ } }
      zhHost.remove();
    }
    report.hideRestore = {
      clicked: clicked, hidden: hidden, shown: shown,
      rowLabel: rowLabel, buttonLabel: buttonLabel, zhButtonLabel: zhButtonLabel,
      atBottomRight: atBottomRight, box: [Math.round(box.left), Math.round(box.top)],
    };
    return clicked && hidden && shown && rowWordsRight && zhButtonLabel === '显示宠物' && atBottomRight;
  });

  // --- authored motion picker ----------------------------------------------
  //
  // The scene half of this contract (loadMotion / setMotionMap / describeMotions
  // / clearMotions) is implemented in lib/pet3d.js by a separate change, so
  // these checks install spies over it. That is the point, not a shortcut: this
  // page tests the WIDGET's half of the boundary — which rows exist, what is
  // offered for a given avatar, what gets persisted, and what the widget calls —
  // not the renderer's ability to build a clip from a buffer.
  var MOTIONS = [
    { id: 'mv-vrma', name: 'wave.vrma', format: 'vrma', bytes: 2048, loop: true },
    { id: 'mv-vrma2', name: 'spin.vrma', format: 'vrma', bytes: 1024, loop: false },
    { id: 'mv-vmd', name: 'wave.vmd', format: 'vmd', bytes: 4096, loop: true },
  ];
  var spies = { loads: [], maps: [], describe: null, fetches: {}, cleared: 0 };

  // Recorded before the spies replace them: whether the real scene implements
  // this contract at all is the one thing this page cannot test but should say.
  report.sceneMotionApi = {
    loadMotion: typeof widget.scene.loadMotion,
    setMotionMap: typeof widget.scene.setMotionMap,
    describeMotions: typeof widget.scene.describeMotions,
    clearMotions: typeof widget.scene.clearMotions,
  };

  widget.scene.setMotionMap = function (map) { spies.maps.push(cloneMap(map)); };
  widget.scene.loadMotion = function (motionId, buffer, options) {
    spies.loads.push({
      id: motionId,
      bytes: buffer ? buffer.byteLength : 0,
      // The catalog's loop flag has to reach the scene with the bytes: it is the only
      // place that can turn it into LoopOnce, and a one-shot that arrives as a loop
      // waves at the user forever.
      loop: options && options.loop,
    });
    return Promise.resolve({ ok: true, format: 'vrma' });
  };
  widget.scene.describeMotions = function () {
    return spies.describe || { mapped: cloneMap(widget.preferences.motions), available: [], playing: null, reason: null };
  };
  widget.scene.clearMotions = function () { spies.cleared += 1; };

  function cloneMap(map) {
    var out = {};
    Object.keys(map || {}).forEach(function (key) { out[key] = map[key]; });
    return out;
  }

  /** One state's ids as a list, whatever shape the stored map used (a list, or the legacy string). */
  function idsOf(value) {
    if (Array.isArray(value)) return value;
    return typeof value === 'string' && value ? [value] : [];
  }

  /** One state out of a stored map, as a list, for the same reason. */
  function idsIn(map, state) {
    return idsOf(map ? map[state] : null);
  }

  /**
   * Pretend the scene has a different avatar kind loaded.
   *
   * `scene.kind` is set first and the avatar's own kind second: the widget reads
   * `avatar.kind` with `scene.kind` as its fallback, so these checks keep
   * measuring the WIDGET even when the renderer failed to install an avatar.
   */
  function setKind(kind) {
    widget.scene.kind = kind;
    if (widget.scene.avatar) {
      if (kind === 'placeholder') delete widget.scene.avatar.kind;
      else widget.scene.avatar.kind = kind;
    }
    // What the widget REPORTS about the map for this avatar. It is data now: the per-state picker that used to
    // display it is the 通用设置 page's 状态与动作 section, and this half only decides what can drive the pet.
    widget.refreshMotionNotice();
    return kind;
  }

  /**
   * Choose the clips a state draws from, the way the 通用设置 page's 状态与动作 section does.
   *
   * The per-state picker is NOT on the pet any more — it is a field of the settings page — so this writes the
   * same preference the page writes, through the same core helper, and pushes it the same way. What the WIDGET
   * must still get right is the second half, and it is what the checks below assert: the map it is handed
   * reaches the scene, with the catalog's loop flag and the right bytes.
   */
  function chooseMotion(state, value) {
    var wanted = Array.isArray(value) ? value : (value ? [value] : []);
    widget.preferences.motions = CORE.setMotionIds(widget.preferences.motions || {}, state, wanted);
    widget.writeStorage();
    return widget.applyMotions();
  }

  function waitFor(predicate, budgetMs) {
    var deadline = Date.now() + (budgetMs || 1500);
    return new Promise(function (resolve) {
      (function poll() {
        var value = false;
        try { value = predicate(); } catch (error) { value = false; }
        if (value) { resolve(true); return; }
        if (Date.now() > deadline) { resolve(false); return; }
        setTimeout(poll, 10);
      })();
    });
  }

  /**
   * Replace fetch with named routes. A route the map does not name REJECTS,
   * which is how the missing-route degradation is exercised without depending on
   * the real `file://` page having (or not having) a host behind it.
   */
  function stubFetch(routes) {
    var real = window.fetch;
    window.fetch = function (url, options) {
      var path = String(url).split('?')[0];
      if (path === '/pet3d/motion') {
        var match = /[?&]m=([^&]*)/.exec(String(url));
        var id = match ? decodeURIComponent(match[1]) : '';
        spies.fetches[id] = (spies.fetches[id] || 0) + 1;
      }
      var handler = routes[path];
      if (!handler) return Promise.reject(new Error('no route for ' + url));
      return Promise.resolve(handler(String(url), options));
    };
    return function restore() { window.fetch = real; };
  }

  function okBytes(size) {
    return { ok: true, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(size || 64)); } };
  }

  /**
   * Nothing is offered for the avatars a clip cannot drive, and the widget SAYS why.
   *
   * The rule is core's (`motionFormatFor`), the filtering is this half's, and the reason is the notice the
   * settings page's 状态与动作 section shows beside the rows — one answer for "why is this list empty", computed
   * where the format is known.
   */
  check('only the clips the loaded avatar can drive are offered, and the rest is explained', function () {
    widget.motionCatalog = { motions: MOTIONS };
    setKind('vrm');
    var vrm = widget.compatibleMotions().map(function (entry) { return entry.id; });
    setKind('mmd');
    var mmd = widget.compatibleMotions().map(function (entry) { return entry.id; });
    setKind('placeholder');
    var placeholder = widget.compatibleMotions().map(function (entry) { return entry.id; });
    var placeholderNote = widget.motionNotice;
    setKind('vrm');
    report.motionFilter = { vrm: vrm, mmd: mmd, placeholder: placeholder, placeholderNote: placeholderNote };
    return vrm.indexOf('mv-vrma') !== -1 && vrm.indexOf('mv-vrma2') !== -1 && vrm.indexOf('mv-vmd') === -1
      && mmd.indexOf('mv-vmd') !== -1 && mmd.indexOf('mv-vrma') === -1
      && placeholder.length === 0
      && /skeleton/i.test(String(placeholderNote));
  });

  /**
   * A state can hold SEVERAL clips, and the catalog's loop flag is kept per clip.
   *
   * This used to be read off the picker's own DOM (a count beside a folded row, and a 循环/单次 word per box).
   * The picker lives on the 通用设置 page's 状态与动作 section now, so what this half still owns is the MAP: several
   * ids for one state, and the one-shot's flag travelling with its bytes — which the async checks below assert
   * against the scene.
   */
  check('a state can hold several clips, through the same core helper the settings page writes', function () {
    widget.motionCatalog = { motions: MOTIONS };
    setKind('vrm');
    widget.preferences.motions = {};
    chooseMotion('resting', ['mv-vrma', 'mv-vrma2']);
    var stored = idsOf((widget.preferences.motions || {}).resting);
    var reloaded = CORE.cleanPreferences(JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}'));
    var oneShot = widget.motionLoopOfId('mv-vrma2') === false && widget.motionLoopOfId('mv-vrma') !== false;
    report.motionMulti = {
      stored: stored,
      reloaded: idsOf(reloaded.motions.resting),
      oneShot: oneShot,
      summary: CORE.motionIdsFor(reloaded.motions, 'resting').length,
    };
    chooseMotion('resting', '');
    return stored.join(',') === 'mv-vrma,mv-vrma2'
      && idsOf(reloaded.motions.resting).join(',') === 'mv-vrma,mv-vrma2'
      && oneShot;
  });

  check('a scene without the motion API is explained, not thrown over', function () {
    // A scene build that predates the motion half of the contract:
    // `report.sceneMotionApi` above says which methods the real one exposes. The map must be left ALONE rather
    // than half-applied, and the notice has to name the reason instead of the pet sitting silently idle.
    var savedMap = widget.scene.setMotionMap;
    var savedLoad = widget.scene.loadMotion;
    // Assign undefined rather than `delete`: the real methods live on Scene.prototype, so deleting the spy
    // merely re-exposed them and this check passed for the wrong reason the moment the scene half landed.
    widget.scene.setMotionMap = undefined;
    widget.scene.loadMotion = undefined;
    widget.motionCatalog = { motions: MOTIONS };
    var mapsBefore = spies.maps.length;
    var threw = false;
    try {
      widget.applyMotions();
      widget.refreshMotionNotice();
    } catch (error) { threw = true; }
    var noted = /motion API/i.test(String(widget.motionNotice));
    var fedAnyway = spies.maps.length !== mapsBefore;
    widget.scene.setMotionMap = savedMap;
    widget.scene.loadMotion = savedLoad;
    widget.refreshMotionNotice();
    report.motionNoApi = { threw: threw, noted: noted, fedAnyway: fedAnyway, notice: widget.motionNotice };
    return !threw && noted && !fedAnyway;
  });

  /**
   * A saved clip this model cannot drive is NAMED, and never handed to the scene.
   *
   * Which formats are offered is a property of the MODEL, so loading a different one can strand a saved pick.
   * Silently dropping it would leave the preference feeding a clip nothing can build — the pet simply idle,
   * with no explanation anywhere.
   */
  check('a saved clip this model cannot drive is reported and not fed to the scene', function () {
    widget.motionCatalog = { motions: MOTIONS };
    var restoreFetch = stubFetch({});
    setKind('mmd');
    chooseMotion('working', 'mv-vmd');
    setKind('vrm');
    var stale = widget.staleMotionIds();
    var noticed = /cannot drive/i.test(String(widget.motionNotice));
    report.motionStale = { stale: stale, notice: widget.motionNotice };
    // Clean up before the async checks below, which count loads and fetches.
    chooseMotion('working', '');
    setKind('vrm');
    restoreFetch();
    return stale.indexOf('mv-vmd') !== -1 && noticed;
  });

  asyncCheck('choosing a clip writes the preference map and feeds the scene', function () {
    // Wait out the model-load check above before touching the shared spies.
    return Promise.resolve(modelFallback).catch(function () { return null; }).then(function () {
      widget.motionCatalog = { motions: MOTIONS };
      setKind('vrm');
      // The byte and clip caches are cleared first so this check states its own preconditions: the
      // widgets' caches outlive a check, and "it was already loaded by the check above" is exactly the
      // kind of hidden coupling that makes a suite pass for the wrong reason.
      widget.motionBuffers = {};
      widget.motionLoaded = {};
      widget.motionLoadedLoop = {};
      widget.motionPending = {};
      spies.loads.length = 0;
      spies.maps.length = 0;
      spies.fetches = {};
      var restoreFetch = stubFetch({
        '/pet3d/motion': function () { return okBytes(64); },
        '/pet3d/motions': function () { return { ok: true, json: function () { return Promise.resolve({ motions: MOTIONS }); } }; },
      });
      chooseMotion('working', 'mv-vrma');
      return waitFor(function () {
        return idsOf(widget.preferences.motions.working).indexOf('mv-vrma') !== -1 && spies.loads.length === 1;
      }).then(function (settled) {
        restoreFetch();
        var lastMap = spies.maps[spies.maps.length - 1] || {};
        var stored = {};
        try {
          stored = (JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}').motions) || {};
        } catch (error) { stored = {}; }
        var sawSelection = spies.maps.some(function (map) { return idsIn(map, 'working').indexOf('mv-vrma') !== -1; });
        // What a reload would actually see: the same key, through the same
        // cleaner the widget's own readStorage uses, plus the row that reflects
        // it. Asserting only `localStorage` would not prove the round trip.
        var reloaded = CORE.cleanPreferences(JSON.parse(window.localStorage.getItem(CORE.STORAGE_KEY) || '{}'));
        report.motionSelect = {
          settled: settled,
          map: lastMap,
          loads: spies.loads.map(function (load) { return load.id; }),
          fetches: cloneMap(spies.fetches),
          stored: stored,
          reloadedMotions: reloaded.motions,
        };
        return settled && sawSelection &&
          spies.loads.length === 1 && spies.loads[0].id === 'mv-vrma' &&
          spies.fetches['mv-vrma'] === 1 && idsOf(stored.working).indexOf('mv-vrma') !== -1 &&
          idsOf(reloaded.motions.working).indexOf('mv-vrma') !== -1;
      });
    });
  });

  asyncCheck('the declared one-shot reaches the scene with the bytes', function () {
    // The loop flag is a property of the CATALOG, and the scene can only learn it when the bytes are
    // handed over. A clip declared as a one-shot that arrives as a loop waves at the user forever, and
    // nothing on screen would say why.
    widget.motionCatalog = { motions: MOTIONS };
    setKind('vrm');
    spies.loads.length = 0;
    spies.fetches = {};
    var restoreFetch = stubFetch({
      '/pet3d/motion': function () { return okBytes(64); },
      '/pet3d/motions': function () { return { ok: true, json: function () { return Promise.resolve({ motions: MOTIONS }); } }; },
    });
    widget.preferences.motions = { done: ['mv-vrma2'] };
    widget.applyMotions();
    return waitFor(function () { return spies.loads.length > 0; }).then(function (loaded) {
      restoreFetch();
      var entry = spies.loads.filter(function (load) { return load.id === 'mv-vrma2'; })[0];
      report.motionLoopFlag = { loads: spies.loads, entry: entry || null };
      // Leave the caches as they were found: the checks below assert what a fetch and a load do, and a
      // clip left in the cache makes them measure reuse instead.
      widget.preferences.motions = {};
      widget.motionBuffers = {};
      widget.motionLoaded = {};
      widget.motionLoadedLoop = {};
      widget.motionPending = {};
      spies.loads.length = 0;
      spies.fetches = {};
      return loaded && Boolean(entry) && entry.loop === false;
    });
  });

  asyncCheck('an already-loaded clip is reused and clearing a state feeds the scene without it', function () {
    // Self-contained: an empty cache first, so "reused" means THIS check's own load rather than one an
    // earlier check happened to leave behind.
    widget.motionCatalog = { motions: MOTIONS };
    setKind('vrm');
    widget.motionBuffers = {};
    widget.motionLoaded = {};
    widget.motionLoadedLoop = {};
    widget.motionPending = {};
    spies.loads.length = 0;
    spies.fetches = {};
    var restoreFetch = stubFetch({ '/pet3d/motion': function () { return okBytes(64); } });
    chooseMotion('working', 'mv-vrma');
    return waitFor(function () { return spies.loads.length === 1; })
      .then(function () {
        var loadsAfterFirstPick = spies.loads.length;
        var fetchesAfterFirstPick = cloneMap(spies.fetches);
        // The same clip for a second state: it must be REUSED, not rebuilt and not refetched.
        chooseMotion('done', 'mv-vrma');
        return waitFor(function () { return idsOf(widget.preferences.motions.done).indexOf('mv-vrma') !== -1; })
          .then(function () {
            var loadsAfterSecondPick = spies.loads.length;
            chooseMotion('working', '');
            return waitFor(function () { return widget.preferences.motions.working === undefined; })
              .then(function (cleared) {
                restoreFetch();
                var lastMap = spies.maps[spies.maps.length - 1] || {};
                var sawCleared = spies.maps.some(function (map) {
                  return !Object.prototype.hasOwnProperty.call(map, 'working')
                    && idsIn(map, 'done').indexOf('mv-vrma') !== -1;
                });
                report.motionReuse = {
                  loads: spies.loads.map(function (load) { return load.id; }),
                  fetches: fetchesAfterFirstPick,
                  loadsAfterFirstPick: loadsAfterFirstPick,
                  loadsAfterSecondPick: loadsAfterSecondPick,
                  mapAfterClearing: lastMap,
                  cleared: cleared,
                };
                return loadsAfterFirstPick === 1 &&                    // the first pick loads it
                  loadsAfterSecondPick === loadsAfterFirstPick &&      // the second reuses it
                  fetchesAfterFirstPick['mv-vrma'] === 1 &&            // fetched exactly once
                  spies.loads.length === 1 &&                          // clearing loads nothing
                  cleared && sawCleared;
              });
          });
      });
  });

  asyncCheck('a failing motion catalog explains itself and does not throw', function () {
    var real = window.fetch;
    window.fetch = function () { return Promise.reject(new Error('no webServer service in this composition')); };
    var threw = false;
    var promise = null;
    try { promise = widget.refreshMotions(); } catch (error) { threw = true; }
    if (!promise) { window.fetch = real; return false; }
    return promise.then(function (result) {
      window.fetch = real;
      var notice = widget.motionNotice;
      report.motionRouteFailure = {
        resolvesToNull: result === null,
        catalog: widget.motionCatalog,
        notice: notice,
        stillMounted: widget.root !== null,
      };
      return !threw && result === null && widget.root !== null
        && /pet3d\/motions|unavailable/i.test(String(notice));
    }, function (error) {
      window.fetch = real;
      throw error;
    });
  });

  asyncCheck('a failed clip fetch and a scene reason both surface readably', function () {
    widget.motionCatalog = { motions: MOTIONS };
    setKind('vrm');
    // An empty cache, or a clip some earlier check already loaded would be reused and this check would never
    // reach the byte route at all.
    widget.motionBuffers = {};
    widget.motionLoaded = {};
    widget.motionLoadedLoop = {};
    widget.motionPending = {};
    widget.showStatus('');
    // Only the catalog route answers; the byte route is absent, so the failure has to be reported per clip
    // rather than mistaken for a missing catalog.
    var restoreFetch = stubFetch({
      '/pet3d/motions': function () { return { ok: true, json: function () { return Promise.resolve({ motions: MOTIONS }); } }; },
    });
    chooseMotion('done', 'mv-vrma2');
    return waitFor(function () { return /mv-vrma2/.test(widget.badge.textContent || ''); })
      .then(function (reported) {
        restoreFetch();
        var badgeText = widget.badge.textContent;
        // The scene's own reason is the only place "loaded but useless" appears, so the widget has to keep it
        // rather than leave the pet silently idle.
        spies.describe = {
          mapped: cloneMap(widget.preferences.motions), available: [], playing: null,
          reason: 'the clip has no tracks for this avatar',
        };
        widget.refreshMotionNotice();
        var reasonShown = /no tracks/.test(String(widget.motionNotice));
        report.motionFailure = { badge: badgeText, reported: reported, reasonShown: reasonShown, notice: widget.motionNotice };
        return reported && reasonShown;
      });
  });

  /**
   * The floating-window switch, end to end through the panel.
   *
   * The plugin cannot open a window itself — a window is a process, and only the host half may
   * start one (HANDOFF §12) — so what this half must get right is the CONVERSATION: ask the
   * host, show what it answered, and never let the switch claim a state the host did not
   * confirm. All three outcomes are asserted, including the two that leave the pet exactly
   * where it was.
   */
  asyncCheck('the floating-window switch asks the host and keeps its answer', function () {
    /**
     * The SWITCH is the 显示位置 field on the 通用设置 page now; what this surface must still get right is the
     * CONVERSATION — ask the host, keep what it answered, and never claim a state it did not confirm.
     *
     * The answer is DATA (`desktopStatus` / `desktopNote`), because the panel that used to display it is gone.
     * That is not a weaker check: the note text is exactly what a label was rendering, and it is asserted here
     * for all five outcomes the host can report — including the one that used to be invisible (the process is
     * running but its page never rendered).
     */
    var running = function () { return Boolean(widget.desktopStatus && widget.desktopStatus.running); };
    widget.preferences.modelId = 'miku';
    // The switch posts the id the surfaces RESOLVE, so the catalog has to contain it: a request for a model
    // that is not catalogued resolves to the default instead (core.resolveModelId).
    widget.catalog = { models: [{ id: 'miku', name: 'HatsuneMikuNT.vrm' }] };
    var asked = [];

    var restore = stubFetch({
      '/pet3d/desktop': function (url, options) {
        asked.push({ url: url, method: (options && options.method) || 'GET', body: options && options.body });
        if (options && options.method === 'POST') {
          return {
            ok: true,
            json: function () {
              return Promise.resolve({
                state: 'running',
                running: true,
                modelId: 'miku',
                page: { ready: true, webgl2: true, renderer: 'ANGLE (test)', errors: [] },
              });
            },
          };
        }
        return { ok: true, json: function () { return Promise.resolve({ state: 'stopped', running: false }); } };
      },
    });

    return widget.refreshDesktopStatus().then(function () {
      var offState = { running: running(), note: widget.desktopNote };
      return widget.setDesktopWindow(true).then(function (status) {
        var onState = { running: running(), note: widget.desktopNote, status: status };
        var post = asked.filter(function (entry) { return entry.method === 'POST'; })[0];
        var body = post ? JSON.parse(post.body) : null;
        restore();

        // A host that refuses: the state must not claim success and the note must say why.
        var restoreFail = stubFetch({
          '/pet3d/desktop': function () {
            return { ok: false, status: 500, json: function () { return Promise.resolve({ error: 'no Electron to borrow' }); } };
          },
        });
        return widget.setDesktopWindow(true).then(function () {
          var failed = { running: running(), note: widget.desktopNote };
          restoreFail();

          // A host with no such route at all: an honest note rather than a throw.
          var restoreMissing = stubFetch({});
          return widget.refreshDesktopStatus().then(function () {
            var missing = widget.desktopNote;
            restoreMissing();

            // The state that used to be invisible: the process is running but its page never rendered.
            var restoreNoRender = stubFetch({
              '/pet3d/desktop': function () {
                return {
                  ok: true,
                  json: function () {
                    return Promise.resolve({
                      state: 'running',
                      running: true,
                      page: { ready: false, webgl2: false, errors: ["Cannot read properties of undefined (reading 'mount')"] },
                    });
                  },
                };
              },
            });
            return widget.refreshDesktopStatus().then(function () {
              var noRender = { running: running(), note: widget.desktopNote };
              restoreNoRender();

              // Running, with the page not having reported yet: honest, not triumphant.
              var restorePending = stubFetch({
                '/pet3d/desktop': function () {
                  return { ok: true, json: function () { return Promise.resolve({ state: 'running', running: true, page: null }); } };
                },
              });
              return widget.refreshDesktopStatus().then(function () {
                var pending = widget.desktopNote;
                restorePending();
                report.desktopToggle = {
                  off: offState,
                  on: onState,
                  posted: body,
                  failed: failed,
                  missing: missing,
                  noRender: noRender,
                  pending: pending,
                };
                return offState.running === false
                  && /stay|inside/i.test(offState.note)
                  && onState.running === true
                  && /floats above/i.test(onState.note)
                  && body && body.action === 'enable' && body.modelId === 'miku'
                  && failed.running === false
                  && /no Electron to borrow/.test(failed.note)
                  && /not serving/.test(missing)
                  && noRender.running === true
                  && /not drawing/i.test(noRender.note)
                  && /reading 'mount'/.test(noRender.note)
                  && /Starting/i.test(pending);
              });
            });
          });
        });
      });
    });
  });

  /**
   * 调试模式: BOTH surfaces on screen at once (`petSurface: 'both'`).
   *
   * Everywhere else the two are exclusive by design — `auto` hides this copy the moment the window reports
   * itself running — and that is exactly what makes a difference between the two renderers impossible to see:
   * a prompt drawn in one and not the other is invisible by construction. So this drives the host that DOES run
   * a window and asserts both halves:
   *
   *   1. `both` asks for the window (`action: enable`) AND leaves this pet visible — the debug mode itself;
   *   2. `auto`, on the same host, hides this copy — which is what proves the first result is about the
   *      surface rather than about a pet that is never hidden at all;
   *   3. and the STALE-CHUNK rule, which is not hypothetical here: the delivered chunks are cached under a
   *      revision an edit does not change, so a browser ran the new `lib/client.js` against a `client.core.js`
   *      whose cleaner predates `both`, rewrote the store's `both` to `auto`, and hid the pet exactly as if
   *      nobody had asked (measured on the operator's machine, 2026-10-11). A fresh chunk cannot reproduce it,
   *      so what is asserted is the rule the entry applies to the snapshot it is handed.
   */
  asyncCheck('调试模式 shows the floating window and the in-app pet at once', function () {
    var asked = [];
    var restore = stubFetch({
      '/pet3d/desktop': function (url, options) {
        asked.push({ url: url, method: (options && options.method) || 'GET', body: options && options.body });
        return {
          ok: true,
          json: function () {
            return Promise.resolve({ state: 'running', running: true, page: { ready: true, webgl2: true, errors: [] } });
          },
        };
      },
    });
    var before = widget.preferences.petSurface;
    var enabledPosts = 0;
    // The rule, both ways round: a value the core dropped comes back, and a value it kept is untouched.
    var staleRule = CLIENT.petSurfaceFrom('both', 'auto') === 'both'
      && CLIENT.petSurfaceFrom('both', 'both') === 'both'
      && CLIENT.petSurfaceFrom('app', 'app') === 'app'
      && CLIENT.petSurfaceFrom('window', 'window') === 'window'
      && CLIENT.petSurfaceFrom(undefined, 'auto') === 'auto';
    widget.preferences.petSurface = 'both';
    return widget.applySurface('quiet').then(function () {
      enabledPosts = asked.filter(function (entry) {
        return entry.method === 'POST' && /"action":"enable"/.test(String(entry.body));
      }).length;
      var bothVisible = widget.surfaceHidden === false && widget.pet.style.visibility !== 'hidden';
      var applied = widget.appliedSurface;
      asked.length = 0;
      widget.preferences.petSurface = 'auto';
      return widget.applySurface('quiet').then(function () {
        // The ordinary surface must still take this copy away: that is what `both` is an exception to.
        var autoHidden = widget.surfaceHidden === true && widget.pet.style.visibility === 'hidden';
        var autoPosts = asked.filter(function (entry) { return entry.method === 'POST'; }).length;
        restore();
        /**
         * 非debug模式生效, on the menu.
         *
         * 调试模式 has BOTH pets on screen, so 切换回窗口外 has no meaning there: the row must be DISABLED, and it
         * must come back the moment the mode does. A row that still acted would turn the debug mode off without
         * saying so — the one thing this switch must never do quietly.
         */
        widget.preferences.petSurface = 'both';
        widget.openMenuAt(40, 40);
        var debugRow = widget.menu.items().filter(function (item) { return item.id === 'surface'; })[0] || null;
        var surfaceDisabledInDebug = Boolean(debugRow && debugRow.disabled === true);
        widget.closeMenu();
        widget.preferences.petSurface = 'auto';
        widget.openMenuAt(40, 40);
        var normalRow = widget.menu.items().filter(function (item) { return item.id === 'surface'; })[0] || null;
        var surfaceEnabledOutsideDebug = Boolean(normalRow && normalRow.disabled !== true);
        widget.closeMenu();
        widget.preferences.petSurface = before;
        report.debugSurface = {
          bothVisible: bothVisible,
          enablePosts: enabledPosts,
          applied: applied,
          autoHidden: autoHidden,
          autoPosts: autoPosts,
          staleRule: staleRule,
          surfaceDisabledInDebug: surfaceDisabledInDebug,
          surfaceEnabledOutsideDebug: surfaceEnabledOutsideDebug,
        };
        return bothVisible && enabledPosts === 1 && applied === 'both' && autoHidden && staleRule
          && surfaceDisabledInDebug && surfaceEnabledOutsideDebug;
      });
    });
  });

  /**
   * The desktop window's page, driven without Electron.
   *
   * The live suite (`scripts/verify-desktop.mjs`) proves the window itself is real — always on
   * top, transparent, screen-sized, drawing pixels. What it cannot cheaply prove is the
   * INTERACTION: a drag that follows the pointer, a throw that lands on the floor of the screen,
   * a wheel that resizes and stops at the limit, a right-drag that turns the view, a gaze driven
   * by the launcher's cursor rather than by events, and the rectangle the launcher toggles
   * click-through with. All of that is asserted here, against a fake bridge.
   */
  /**
   * The wheel zooms about the CURSOR, asserted exactly and where nothing can interfere.
   *
   * This is the second half of the reported problem ("the pointer ends up on a pixel-less area and
   * continuous zooming stops"): the box must grow around the pointer instead of away from it. The
   * placement here has room on every side, so the clamp that protects a pet parked against the edge
   * of the screen — the case the live window exercises — cannot bend the answer.
   */
  check('zooming grows the pet around the cursor', function () {
    var preferences = CORE.cleanPreferences({ size: 100 });
    var placement = new CLIENT.Placement(preferences, function () { return 0; }, CORE);
    placement.setViewport(2000, 1200);
    placement.setSize(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height);
    placement.x = 0.4;
    placement.y = 0.4;
    placement.clampToViewport();

    var before = placement.pixels();
    var widthBefore = placement.width;
    // A point inside the pet, off-centre in both directions so an unanchored resize is visible.
    var anchor = { x: before.left + 60, y: before.top + 210 };
    var acrossBefore = (anchor.x - before.left) / placement.width;
    var downBefore = (anchor.y - before.top) / placement.height;

    preferences.size = 200;
    placement.preferences = preferences;
    placement.resizeAnchored(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height, anchor.x, anchor.y);

    var after = placement.pixels();
    var acrossAfter = (anchor.x - after.left) / placement.width;
    var downAfter = (anchor.y - after.top) / placement.height;

    // And with no anchor at all, the box's CENTRE is held — that is the panel's stepper, which must
    // not fling the pet across the screen.
    var centredBefore = placement.pixels();
    var centre = { x: centredBefore.left + placement.width / 2, y: centredBefore.top + placement.height / 2 };
    preferences.size = 260;
    placement.preferences = preferences;
    placement.resizeAnchored(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height);
    var centredAfter = placement.pixels();
    var centreAfter = { x: centredAfter.left + placement.width / 2, y: centredAfter.top + placement.height / 2 };

    report.zoomAnchor = {
      anchor: anchor,
      relativeBefore: [+acrossBefore.toFixed(4), +downBefore.toFixed(4)],
      relativeAfter: [+acrossAfter.toFixed(4), +downAfter.toFixed(4)],
      box: [widthBefore, placement.width],
      centreDrift: [centreAfter.x - centre.x, centreAfter.y - centre.y],
    };
    return placement.width > widthBefore
      && Math.abs(acrossAfter - acrossBefore) < 0.01
      && Math.abs(downAfter - downBefore) < 0.01
      && Math.abs(centreAfter.x - centre.x) <= 1
      && Math.abs(centreAfter.y - centre.y) <= 1;
  });

  /**
   * The whole hop: a change made in the settings window reaches the pet that is running.
   *
   * The settings page writes the shared storage key from a DIFFERENT document, and `storage` fires only in
   * the documents that did not write — so this is the mechanism the feature rests on. Here the write is
   * simulated (a stub the test can overwrite plus a real StorageEvent) against a mounted pet page with a
   * real VRM behind it, and the assertion is the pet's own state: the hair chain took the new stiffness
   * and the pinned expression took its weight, with no reload and no polling.
   */
  asyncCheck('a settings change reaches the running pet through storage', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);
    var base64 = globalThis.__PET3D_VRM_BASE64__;
    if (!base64) return Promise.resolve(false);
    var bytes = Uint8Array.from(atob(base64), function (c) { return c.charCodeAt(0); });

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '900px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 600;
    host.appendChild(canvas);

    // A storage stub the test can overwrite: that is 'another document wrote it'.
    var stored = {};
    var storage = {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
      setItem: function (key, value) { stored[key] = value; },
    };
    var restoreFetch = stubFetch({
      '/pet3d/asset': function () {
        return { ok: true, arrayBuffer: function () { return Promise.resolve(bytes.buffer); } };
      },
    });
    var pet = desktop.mount({
      canvas: canvas,
      bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
      modelId: 'settings',
      assetBase: '/pet3d/asset',
      screen: { x: 0, y: 0, width: 900, height: 600 },
      storage: storage,
    });

    return pet.ready.then(function () {
      var chainOf = function (chainList, name) {
        return chainList.filter(function (chain) { return chain.name === name; })[0] || null;
      };
      var before = chainOf(pet.scene.springChains(), 'hair');

      // What the settings window would write for a stiffness slider and a pinned expression. The modelId
      // is part of the write, and it is the model being CONFIGURED — which is what the settings page keeps
      // in step with the pet. Leaving the page's default in here would be a different instruction
      // ('show the placeholder'), and the plugin would be right to obey it.
      var next = JSON.parse(JSON.stringify(pet.preferences));
      next.modelId = 'settings';
      next.springs = { settings: { hair: { stiffness: 3.25 } } };
      next.expressions.weights = { happy: 1 };
      storage.setItem(CORE.STORAGE_KEY, JSON.stringify(next));
      globalThis.dispatchEvent(new StorageEvent('storage', { key: CORE.STORAGE_KEY }));

      var after = chainOf(pet.scene.springChains(), 'hair');
      var painted = pet.scene.expressionValue('happy');
      var followed = Boolean(after)
        && Math.abs(after.current.stiffness - 3.25) < 1e-6
        && Math.abs(after.authored.stiffness - 3.25) > 1e-6
        && Math.abs((painted === null ? -1 : painted) - 1) < 1e-6;

      /**
       * The other half: a stored model switch that names the REMOVED built-in avatar is not an instruction to
       * show a fake pet any more.
       *
       * The operator removed it on 2026-10-10 ("内置的占位模型还是没删掉，把Sample Model设为内置模型"), so a stored
       * `modelId: 'placeholder'` now means "no model chosen": the pet KEEPS the model it already had, with its
       * chains and expressions, rather than being replaced by an avatar nobody can choose in the panel.
       */
      next.modelId = 'placeholder';
      storage.setItem(CORE.STORAGE_KEY, JSON.stringify(next));
      globalThis.dispatchEvent(new StorageEvent('storage', { key: CORE.STORAGE_KEY }));
      var switched = pet.scene.currentModelId;
      report.sync = {
        before: before ? before.current.stiffness : null,
        after: after ? after.current.stiffness : null,
        authored: after ? after.authored.stiffness : null,
        happy: painted,
        switchedTo: switched,
        chainsAfterSwitch: pet.scene.springChains().length,
      };
      // The model stays, and so do its chains: nothing was substituted for it.
      var switchOk = switched !== 'placeholder' && pet.scene.springChains().length > 0;
      followed = followed && switchOk;
      pet.destroy();
      if (host.parentNode) host.remove();
      restoreFetch();
      return followed;
    });
  });

  asyncCheck('the desktop page drags, zooms, orbits and follows the launcher cursor', async function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '900px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 600;
    canvas.style.width = '900px';
    canvas.style.height = '600px';
    host.appendChild(canvas);

    var cursors = [];
    var bridge = {
      reportRect: function () {},
      ready: function () {},
      onCursor: function (callback) { cursors.push(callback); },
    };
    /**
     * A REAL model, not the built-in avatar.
     *
     * This probe used to mount with `modelId: 'placeholder'` and get a procedural pet with no bytes at all. The
     * operator removed that avatar on 2026-10-10 ("内置的占位模型还是没删掉，把Sample Model设为内置模型"), so the page
     * now loads what the launcher names — which is what the real launcher does, and what makes this probe
     * exercise the same path a user's floating window does. The bytes come from the VRM fixture the page's own
     * section above already decodes.
     */
    var fixtureBytes = (function () {
      var encoded = globalThis.__PET3D_VRM_BASE64__;
      if (!encoded) return null;
      var binary = atob(encoded);
      var out = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out.buffer;
    })();
    var restorePageFetch = fixtureBytes ? stubFetch({
      '/pet3d/asset': function () {
        return { ok: true, arrayBuffer: function () { return Promise.resolve(fixtureBytes); } };
      },
    }) : null;
    var pet = desktop.mount({
      canvas: canvas,
      bridge: bridge,
      modelId: 'fixture',
      screen: { x: 0, y: 0, width: 900, height: 600 },
      storage: { getItem: function () { return null; }, setItem: function () {} },
    });
    var placement = pet.placement;
    var scene = pet.scene;
    // What the page told the scene, in order. The drag/click REACTION is the user's report: it must
    // fire when the press starts to move, not when the drag ends.
    var interactions = [];
    var realNoteInteraction = scene.noteInteraction;
    /**
     * The spy FORWARDS BOTH arguments.
     *
     * It used to forward only `reason`, which silently threw the measured PART away — the scene then recorded
     * "clicked somewhere, no part", while the page's own press reaction (which is handed the part directly) still
     * said the right line. `found.pressSpeech.sceneTouch` below is what made that visible: the bubble was right
     * and the diagnostic was empty.
     */
    scene.noteInteraction = function (reason, part) {
      interactions.push(reason);
      return realNoteInteraction.call(scene, reason, part);
    };

    /**
     * One synthetic pointer event.
     *
     * `buttons` is derived from the button rather than hardcoded to 1, and that is not a detail: the widget
     * treats the BUTTON STATE as the honest test for whether a gesture is still alive (a release that arrives
     * somewhere that silences it leaves the pet latched — the operator's "未释放状态", 2026-10-09), so a
     * right-drag has to declare `buttons: 2` the way a real one does.
     */
    function pointer(type, x, y, button, target) {
      var pressed = type === 'pointerup' || type === 'pointercancel'
        ? 0
        : (button === 2 ? 2 : 1);
      (target || canvas).dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        // The drag is computed from the GLOBAL pointer now (the window moves with the pet, so client
        // coordinates would be a feedback loop). This mount's screen origin is 0,0, so the two agree.
        screenX: x, screenY: y,
        button: button === undefined ? 0 : button, pointerId: 7, buttons: pressed,
      }));
    }

    /**
     * `async`, on the `.then` callback rather than only on the check itself, because one step below has to WAIT
     * (the press gap) and a plain callback cannot. The returned promise is what `asyncCheck` awaits either way.
     */
    return pet.ready.then(async function () {
      var found = {};

      // One frame must have been DRAWN before the hit test can say anything: it reads the
      // framebuffer, and `pet.ready` resolves when the model is installed — before the animation
      // loop's first tick. In the window that loop does this sixty times a second; here the frame is
      // asked for explicitly, so the check does not depend on animation frames at all (awaiting a
      // run of them starved the page's two rAF loops of their virtual-time budget and hung the
      // suite, which is what the previous version of this check did).
      scene.tick(1 / 60);

      // The cursor arrives from the launcher, not from events: a click-through window gets no
      // pointer events at all, so the pet's hit state has to come from the cursor stream. The answer
      // is computed synchronously in the cursor callback, against the pixels of the last frame.
      var cursorSink = cursors.length ? cursors[cursors.length - 1] : null;
      var setCursor = function (x, y) {
        if (cursorSink) cursorSink({ x: x, y: y });
        return pet.isOver();
      };

      // Park it where a drag has room, then put the cursor on the pet's CENTRE — the placeholder
      // fills its box there, so those pixels are painted and the pet takes the click.
      placement.x = 0.4;
      placement.y = 0.4;
      pet.reportRect();
      var before = placement.pixels();
      var centre = { x: before.left + Math.round(placement.width / 2), y: before.top + Math.round(placement.height / 2) };
      // A corner of the same box: inside the rectangle, but no model was drawn there.
      var corner = { x: before.left + 3, y: before.top + 3 };

      found.overCentre = setCursor(centre.x, centre.y);
      // The requirement, in one line: the empty part of the pet's box passes the click through,
      // while the painted part takes it.
      found.overCorner = setCursor(corner.x, corner.y);
      found.overAgain = setCursor(centre.x, centre.y);

      pointer('pointerdown', centre.x, centre.y);
      found.dragging = placement.dragging === true;
      pointer('pointermove', centre.x + 40, centre.y - 30);
      // THE REACTION, read BEFORE the release. This is the user's report in one line: the press
      // started to move, so the drag reaction has already happened — it used to wait for pointerup.
      found.dragReactionOnMove = interactions.slice();
      var after = placement.pixels();
      pointer('pointerup', centre.x + 40, centre.y - 30);
      found.drag = [after.left - before.left, after.top - before.top];
      var dragOk = found.dragging && found.drag[0] === 40 && found.drag[1] === -30;
      var dragReactionOk = found.dragReactionOnMove.indexOf('drag') !== -1
        && interactions.filter(function (reason) { return reason === 'drag'; }).length === 1;

      // And a press that does NOT move is still a click, reacted to once, on release — so the timing
      // fix did not turn every press into a drag.
      var afterBox = placement.pixels();
      setCursor(afterBox.left + Math.round(placement.width / 2), afterBox.top + Math.round(placement.height / 2));
      var clicksBefore = interactions.filter(function (reason) { return reason === 'click'; }).length;
      var speechNode = document.querySelector('.pet3d-desktop-speech');
      pointer('pointerdown', afterBox.left + Math.round(placement.width / 2), afterBox.top + Math.round(placement.height / 2));
      pointer('pointerup', afterBox.left + Math.round(placement.width / 2), afterBox.top + Math.round(placement.height / 2));
      found.clickReaction = interactions.filter(function (reason) { return reason === 'click'; }).length;
      var clickReactionOk = found.clickReaction === clicksBefore + 1;
      /**
       * And what the SHIPPED table said about that press — which is the feature of 2026-10-12, measured end to end.
       *
       * The fixture's centre is its `hips` bone, and the name heuristic calls that a 屁股: the shipped 屁股 row
       * answers 变态！/大色狼！ with nothing written in any box, on THIS page's own account (the window owns no
       * machine, so a press here says its line from the part the raycast named). The chain being asserted is the
       * whole one — a live raycast on a real VRM, name → region, the shipped row, the bubble — which is more than
       * the core suite can say, because it never raycasts.
       */
      found.shippedPress = {
        text: speechNode ? speechNode.textContent : null,
        hidden: speechNode ? speechNode.hidden : null,
        state: typeof scene.lastInteractionState === 'function' ? scene.lastInteractionState() : null,
      };
      /**
       * The window applies the same press GAP the app does (`core.PRESS_LIMITS.reactGapSeconds`), and the press
       * that just reacted SPOKE — so the next press, which is the one the 碎碎念 box below is about, would be
       * answered with silence and the bubble would still hold 大色狼！. Waiting the gap out is what makes the
       * part's own line observable rather than a leftover; the wait is derived from the constant, not guessed, so
       * moving the knob cannot silently turn this check into a race.
       */
      await new Promise(function (resolve) {
        setTimeout(resolve, ((CORE.PRESS_LIMITS ? CORE.PRESS_LIMITS.reactGapSeconds : 3) * 1000) + 100);
      });
      /**
       * And a click with a 碎碎念 box of the USER's own SAYS THAT, on this page's own account.
       *
       * This is the window's own path and it is deliberately not the app's: the window draws the line the app
       * publishes, so a press here says its line on this page's own account, from the part the raycast named.
       * The structure that answers is found the hard way — a real raycast through `anatomyAt` on the fixture —
       * so the assertion covers the whole chain: press → part → that part's lines → the bubble.
       */
      var partPrefs = CORE.cleanPreferences({
        parts: {
          // Every region already offered, so the ONLY row here is the user's own: without this the seeding of
          // 2026-10-12 would add the shipped rows, and the fixture's centre (a `hips` bone) would answer as 屁股
          // rather than falling through to 身体 — which is the next check's whole point.
          seeded: CORE.STRUCTURE_REGIONS.slice(),
          items: [
            { id: 'body', label: '身体', region: 'body', speech: { lines: ['别戳我'], prompt: '' } },
          ],
        },
      });
      pet.preferences.parts = partPrefs.parts;
      pet.preferences.speech = CORE.cleanSpeech({ enabled: true, source: 'custom', holdSeconds: 1, lines: {} });
      scene.applyPreferences(pet.preferences);
      var sayBox = placement.pixels();
      var sayAt = {
        x: sayBox.left + Math.round(placement.width / 2),
        y: sayBox.top + Math.round(placement.height / 2),
      };
      setCursor(sayAt.x, sayAt.y);
      pointer('pointerdown', sayAt.x, sayAt.y);
      pointer('pointerup', sayAt.x, sayAt.y);
      pet.publish();
      var published = globalThis.__PET3D_DESKTOP_STATE__ || null;
      found.pressSpeech = {
        text: speechNode ? speechNode.textContent : null,
        hidden: speechNode ? speechNode.hidden : null,
        part: published && published.touch ? published.touch.part : null,
        label: published && published.touch ? published.touch.label : null,
        bone: published && published.touch ? published.touch.bone : null,
        sceneTouch: typeof scene.lastInteractionState === 'function' ? scene.lastInteractionState() : null,
      };
      var pressSpeechOk = found.pressSpeech.text === '别戳我' && found.pressSpeech.hidden === false
        && found.pressSpeech.part === 'body' && found.pressSpeech.label === '身体'
        // And the scene's own record agrees with the bubble: a shot at the part and a said line are the same fact.
        && found.pressSpeech.sceneTouch && found.pressSpeech.sceneTouch.part === 'body'
        && found.pressSpeech.sceneTouch.reason === 'click';
      /**
       * And the SHIPPED 屁股 row is what answered the earlier click, through the same raycast.
       *
       * The two lines are the operator's own (2026-10-12: 「默认碎碎念："变态！""大色狼！"」), the region is read off
       * the scene's record (`hips` is a 屁股 by the name table, and the fixture's centre is that bone), and the
       * bubble has to be SHOWING it — an empty box on that row is the whole feature, so "the defaults exist" and
       * "they reach the pet's bubble" are two different claims and this is the second one.
       */
      var shippedPressOk = Boolean(found.shippedPress && found.shippedPress.state)
        && found.shippedPress.state.region === 'butt'
        && found.shippedPress.hidden === false
        && (found.shippedPress.text === '变态！' || found.shippedPress.text === '大色狼！');
      // Back to the shipped parts, so the checks after this one see the profile a user starts with.
      pet.preferences.parts = CORE.cleanPreferences({}).parts;
      scene.applyPreferences(pet.preferences);
      /**
       * And under 台词来源 = AI the SAME press says nothing from the shipped table — the window's half of
       * 「如果设置了AI碎碎念，就停止输出内置的碎碎念」 (operator, 2026-10-12), which is the one rule the TWO press paths have
       * to agree on: the app's machine reaches it through `partSpeechLines`'s source argument, and this page's
       * `reactToPart` is a second copy of that call.
       *
       * Two claims, measured together because either alone can be satisfied by a bug: the shipped 变态！ is NOT put
       * up (so the source did switch the table off), and the host IS asked about the part (so "silence" is the wait
       * for the model rather than a reaction that stopped happening).
       *
       * The bubble is loaded with a HOST line first, which is the only way to tell "said nothing new" from "still
       * showing the previous press": the window draws the app's published line, and a press of its own is layered
       * over it for `holdSeconds`. So the host line is what must still be up afterwards.
       */
      var sayCalls = 0;
      var realSayFetch = window.fetch;
      window.fetch = function (url, options) {
        if (String(url).split('?')[0] === '/pet3d/say') {
          sayCalls += 1;
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve({ text: null, error: 'probe' }); },
          });
        }
        return realSayFetch.apply(window, arguments);
      };
      pet.setSpeech('宿主的一句话');
      pet.preferences.speech = CORE.cleanSpeech({ enabled: true, source: 'ai', holdSeconds: 1, lines: {} });
      scene.applyPreferences(pet.preferences);
      // The press gap belongs to the page (`reactGapSeconds`), and the press before this one started it.
      await new Promise(function (resolve) {
        setTimeout(resolve, ((CORE.PRESS_LIMITS ? CORE.PRESS_LIMITS.reactGapSeconds : 3) * 1000) + 100);
      });
      var aiBox = placement.pixels();
      var aiAt = {
        x: aiBox.left + Math.round(placement.width / 2),
        y: aiBox.top + Math.round(placement.height / 2),
      };
      setCursor(aiAt.x, aiAt.y);
      pointer('pointerdown', aiAt.x, aiAt.y);
      pointer('pointerup', aiAt.x, aiAt.y);
      pet.publish();
      var aiPublished = globalThis.__PET3D_DESKTOP_STATE__ || null;
      found.shippedPressAi = {
        text: speechNode ? speechNode.textContent : null,
        hidden: speechNode ? speechNode.hidden : null,
        sayCalls: sayCalls,
        state: typeof scene.lastInteractionState === 'function' ? scene.lastInteractionState() : null,
        published: aiPublished && aiPublished.speech ? aiPublished.speech.text : null,
      };
      var shippedPressAiOk = found.shippedPressAi.state && found.shippedPressAi.state.region === 'butt'
        && found.shippedPressAi.hidden === false
        && found.shippedPressAi.text === '宿主的一句话'
        && found.shippedPressAi.sayCalls === 1;
      window.fetch = realSayFetch;
      // Back to what the press before this one left in place, for the bounds checks below.
      pet.preferences.speech = CORE.cleanSpeech({ enabled: true, source: 'custom', holdSeconds: 1, lines: {} });
      scene.applyPreferences(pet.preferences);


      /**
       * The same two bounds the app overlay got, on THIS page: a press that only wobbles is a click and moves
       * nothing, and a press that stays put long enough is a 长按 while it is still down.
       *
       * Both are asserted here because the window keeps its own pointer handling — the two surfaces share the
       * bounds (`core.PRESS_LIMITS`) and the tests have to share the coverage, or one of them will drift.
       */
      var bounds = (CORE.PRESS_LIMITS || { moveThreshold: 4, holdSeconds: 0.6 });
      var wobbleBox = placement.pixels();
      var wobbleAt = {
        x: wobbleBox.left + Math.round(placement.width / 2),
        y: wobbleBox.top + Math.round(placement.height / 2),
      };
      var wobbleFrom = placement.pixels();
      var clicksBeforeWobble = interactions.filter(function (reason) { return reason === 'click'; }).length;
      var dragsBeforeWobble = interactions.filter(function (reason) { return reason === 'drag'; }).length;
      pointer('pointerdown', wobbleAt.x, wobbleAt.y);
      pointer('pointermove', wobbleAt.x + 2, wobbleAt.y + 1);
      var dragsDuringWobble = interactions.filter(function (reason) { return reason === 'drag'; }).length;
      pointer('pointerup', wobbleAt.x + 2, wobbleAt.y + 1);
      var wobbleTo = placement.pixels();
      found.wobbleClick = {
        wobble: [2, 1],
        dragsAdded: dragsDuringWobble - dragsBeforeWobble,
        clicks: interactions.filter(function (reason) { return reason === 'click'; }).length - clicksBeforeWobble,
        moved: [wobbleTo.left - wobbleFrom.left, wobbleTo.top - wobbleFrom.top],
      };
      // COUNTED rather than sliced: the list already holds the reactions of the checks above, so reading its
      // tail measured those instead of this press — which is how the first version of this assertion failed
      // while the behaviour underneath it was correct.
      var wobbleOk = found.wobbleClick.dragsAdded === 0
        && found.wobbleClick.clicks === 1
        && found.wobbleClick.moved[0] === 0 && found.wobbleClick.moved[1] === 0;

      /**
       * THE ANTI-LAG PROPERTY, asserted so it cannot come back.
       *
       * The drag has to be computed from the pointer's GLOBAL position. In the app the window moves
       * with the pet, so `clientX` is measured against a frame whose position is itself a consequence
       * of the drag: feeding it back makes the pet chase the cursor one window-move behind — the
       * reported "dragging the model lags". Here the event carries DELIBERATELY WRONG client
       * coordinates (0,0) and the right screen position, which is exactly what the moving window
       * produces; a build that used clientX would drop the pet in the frame's corner.
       */
      var here = placement.pixels();
      var grabAt = { x: here.left + Math.round(placement.width / 2), y: here.top + Math.round(placement.height / 2) };
      var globalDrag = {
        down: { x: grabAt.x, y: grabAt.y },
        move: { x: grabAt.x - 30, y: grabAt.y - 20 },
      };
      var globalEvent = function (type, at, id) {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: id,
          clientX: 0, clientY: 0, screenX: at.x, screenY: at.y,
        }));
      };
      globalEvent('pointerdown', globalDrag.down, 8);
      globalEvent('pointermove', globalDrag.move, 8);
      globalEvent('pointerup', globalDrag.move, 8);
      var afterGlobal = placement.pixels();
      found.globalDrag = [afterGlobal.left - here.left, afterGlobal.top - here.top];
      var globalDragOk = found.globalDrag[0] === -30 && found.globalDrag[1] === -20;

      // "Drag and place": released where the user let go, and STAYS there — throwing is switched off
      // in this window, so there is no velocity to become a fall. The next frames must not move it.
      found.airborneAfterDrag = placement.isAirborne();
      found.fallAfterDrag = placement.fall || null;
      var placedAt = { x: placement.x, y: placement.y };
      scene.tick(1 / 60);
      scene.tick(1 / 60);
      found.driftAfterFrames = [placement.x - placedAt.x, placement.y - placedAt.y];
      var placeOk = found.airborneAfterDrag === false && found.fallAfterDrag === null
        && found.driftAfterFrames[0] === 0 && found.driftAfterFrames[1] === 0;
      // The switch is per placement: a fresh one has throwing ON, so the feature (and the bounces
      // that come with it) is still there for the later feature that wants it.
      var fresh = new CLIENT.Placement(CORE.cleanPreferences({}), function () { return 0; }, CORE);
      var throwFeatureOk = fresh.throwEnabled !== false;

      // Right-drag turns the view instead of moving the pet.
      var yawBefore = pet.preferences.viewYaw || 0;
      pointer('pointerdown', 400, 300, 2);
      pointer('pointermove', 460, 318, 2);
      pointer('pointerup', 460, 318, 2);
      found.yaw = +(pet.preferences.viewYaw || 0).toFixed(4);
      var orbitOk = Math.abs((pet.preferences.viewYaw || 0) - yawBefore) > 0.1;

      /**
       * This page keeps its OWN pointer handling (it is the floating window's page, not the app's widget), and
       * its canvas IS its window, so the operator's "the pointer left the little frame" case does not arise
       * here — moves anywhere in the window reach its document listeners. The fix for that report lives in the
       * widget (see the two orbit checks in its own section), so this page only has to keep orbiting.
       */
      var yawBeforeAgain = pet.preferences.viewYaw || 0;
      pointer('pointerdown', 400, 300, 2);
      pointer('pointermove', 400 - 20, 300 - 10, 2);
      pointer('pointerup', 400 - 20, 300 - 10, 2);
      var orbitOutsideOk = Math.abs((pet.preferences.viewYaw || 0) - yawBeforeAgain) > 0.001;
      found.orbitAgain = { before: +yawBeforeAgain.toFixed(4), after: +(pet.preferences.viewYaw || 0).toFixed(4) };

      // The wheel resizes, and stops at the FRAME's end. The cursor is put back on the pet first:
      // the wheel is gated on the hit test, and the drag moved the pet out from under it.
      setCursor(after.left + Math.round(placement.width / 2), after.top + Math.round(placement.height / 2));
      var sizeBefore = pet.preferences.windowSize;
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
      found.zoom = [sizeBefore, pet.preferences.windowSize];
      for (var notch = 0; notch < 40; notch += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
      }
      found.maxed = pet.preferences.windowSize;
      // The limits are derived from the FRAME, not from a constant: this page's ceiling is the
      // screen's shortest edge (and here the frame is 900x600, so 600 px of long edge).
      var zoomRange = placement.zoomLimits(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height);
      var longEdge = function (percent) {
        return Math.round(Math.max(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height) * percent / 100);
      };
      found.zoomLimits = {
        range: zoomRange,
        minLongEdge: longEdge(zoomRange.min),
        maxLongEdge: longEdge(zoomRange.max),
        frame: [placement.viewportWidth, placement.viewportHeight],
      };
      // `windowSize`, not `size`: this page's percentage is its own key (see `LOCAL_KEYS`), and the wheel
      // gesture writes that one. Reading the shared key here is exactly how the split would look broken.
      var zoomOk = pet.preferences.windowSize > sizeBefore && pet.preferences.windowSize === zoomRange.max;
      var zoomLimitsOk = longEdge(zoomRange.min) >= CORE.ZOOM_MIN_LONG_EDGE
        && longEdge(zoomRange.max) <= Math.min(placement.viewportWidth, placement.viewportHeight);

      // A zoom GESTURE must survive the cursor landing on a pixel-less spot. That is the reported
      // failure: "once the pointer is over a pixel-less area, continuous zooming stops". The size is
      // reset first because the block above left it at the maximum, where a further notch is a no-op;
      // the wheel is then aimed at a corner of the box, which the placeholder does not paint.
      pet.preferences.windowSize = 100;
      placement.preferences = pet.preferences;
      placement.setSize(CLIENT.BASE_PET_SIZE.width, CLIENT.BASE_PET_SIZE.height);
      placement.clampToViewport();
      pet.layout();
      var boxNow = placement.pixels();
      var cornerNow = { x: boxNow.left + 2, y: boxNow.top + 2 };
      found.overCornerForWheel = setCursor(cornerNow.x, cornerNow.y);
      var sizeBeforeHold = pet.preferences.windowSize;
      canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -100, clientX: cornerNow.x, clientY: cornerNow.y,
      }));
      found.holdZoom = [sizeBeforeHold, pet.preferences.windowSize];
      // The corner is genuinely pixel-less (so clicks pass through), and the notch was still taken
      // because the previous one was moments ago — that is the hold, and it is what keeps a scroll.
      var holdOk = found.overCornerForWheel === false && pet.preferences.windowSize > sizeBeforeHold;

      // ---- the right-click MENU ----------------------------------------------------------
      // The orbit above already proved that a right-DRAG does not open it; that matters, because a turn of
      // the view must not leave a menu behind. A right-click that does not wander does.
      found.menuAfterOrbit = pet.isMenuOpen();
      pointer('pointerdown', 300, 200, 2);
      pointer('pointerup', 300, 200, 2);
      found.menuAfterClick = pet.isMenuOpen();
      var menuOk = found.menuAfterOrbit === false && found.menuAfterClick === true;

      // The menu must be CLICKABLE. It is DOM, so not one of its pixels is in the framebuffer and the
      // per-pixel test cannot see it: the page answers for the menu's rectangle as well. The cursor is in
      // screen coordinates and the menu is positioned in the frame's — the same thing here, because the
      // mount's screen origin is 0,0.
      var menuRect = pet.menuRect();
      found.menuRect = menuRect;
      found.overMenu = menuRect
        ? setCursor(menuRect.left + Math.round(menuRect.width / 2), menuRect.top + Math.round(menuRect.height / 2))
        : null;
      var menuHitOk = found.overMenu === true;

      /**
       * And an entry in it does something: 重置大小 edits THIS page's size (`windowSize`, this surface's own
       * key — reading the shared `size` here would assert a number this page never touches).
       *
       * The click is dispatched on the real item, so this is also the assertion that the entry is WIRED: a
       * menu that opens and does nothing passes every check that only counts its entries.
       */
      var sizeBeforeEntry = pet.preferences.windowSize;
      var entry = Array.prototype.filter.call(
        pet.menu().querySelectorAll('.pet3d-menu-item'),
        function (node) { return node.getAttribute('data-item') === 'resetSize'; },
      )[0];
      if (entry) entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      found.menuEntry = [sizeBeforeEntry, pet.preferences.windowSize, Boolean(entry)];
      var menuControlOk = Boolean(entry) && pet.preferences.windowSize !== sizeBeforeEntry
        && pet.preferences.windowSize === CORE.DEFAULTS.windowSize;
      // The click must not have been taken for a drag: the pet has not moved and is still placed.
      var menuClickSafe = placement.dragging !== true && placement.isAirborne() === false;

      /**
       * Picking an entry closes the menu — and the PAGE has to know, not just the module.
       *
       * The module closes itself before it calls the surface back, so a page listening for an outside press and
       * an Escape key never hears about this third way out. It matters because `menuOpen` is what the WINDOW is
       * sized from: with the flag stuck true, the launcher kept the extra room for a menu that was already gone
       * and `__PET3D_DESKTOP_STATE__.menu.open` kept reporting it. This assertion is the one that caught it
       * (2026-10-12) — every earlier menu check here called `closeMenu()` instead of clicking an entry.
       */
      found.closedByEntry = pet.isMenuOpen() === false;
      // A right-click TOGGLES it back up, and one more gesture closes it — the hit test then goes back to the
      // pet alone, which is what the rest of this check reads.
      pointer('pointerdown', 300, 200, 2);
      pointer('pointerup', 300, 200, 2);
      found.reopened = pet.isMenuOpen() === true;
      pointer('pointerdown', 300, 200, 2);
      pointer('pointerup', 300, 200, 2);
      found.menuClosed = pet.isMenuOpen() === false;
      var menuCloseOk = found.closedByEntry === true && found.reopened === true && found.menuClosed === true;

      // The gaze, from the launcher's cursor rather than from an event: the pet must look at a
      // cursor that is nowhere near it, since a click-through window gets no events at all. The
      // gaze is applied BY the frame loop, so frames have to run before it can be read — reading
      // it straight after the cursor callback sees the previous frame's `null`.
      var sent = cursors.length > 0;
      if (sent) cursors[cursors.length - 1]({ x: 880, y: 20 });
      return nextFrame().then(nextFrame).then(function () {
        var pixels = placement.pixels();
        var aim = CORE.pointerAim({
          pointerX: 880, pointerY: 20,
          centreX: pixels.left + placement.width / 2,
          centreY: pixels.top + placement.height / 2,
          // The page passes its frame's width as the span (full deflection = one frame width), so the
          // expectation has to quote the same span or the two numbers are answering different questions.
          spanX: 900,
        });
        var applied = scene.motion.gaze;
        found.gaze = applied ? [+applied.yaw.toFixed(4), +applied.pitch.toFixed(4)] : null;
        found.aim = aim;
        var gazeOk = Boolean(applied && applied.yaw > 0.2 && applied.pitch > 0.1);

        // The rectangle the launcher sizes the window to (and toggles click-through against) must be the
        // pet's box PLUS the frame margin, centred where the placement puts the pet: the window is bigger
        // than the slot on purpose now, and a report that still claimed the slot's own size would size the
        // window to the slot and crop the raised hand this margin exists for.
        var FRAME_MARGIN = 1.35;
        var last = pet.rect();
        var marginW = placement.width * FRAME_MARGIN;
        var marginH = placement.height * FRAME_MARGIN;
        var rectOk = Boolean(last
          && Math.abs(last.width - marginW) <= 1
          && Math.abs(last.height - marginH) <= 1
          && Math.abs(last.left - (placement.x * placement.viewportWidth - (marginW - placement.width) / 2)) <= 1
          && last.dragging === false);

        // The hit test, and the requirement it exists for: painted pixels take the click, the
        // transparent part of the same box does not.
        var hitOk = found.overCentre === true && found.overCorner === false && found.overAgain === true;

        // And the canvas is the pet's box plus the frame margin — not the screen. The model is framed to its
        // canvas, so a canvas the size of the screen is a pet the size of the screen, which is what the user
        // reported before this was fixed. The margin is ALWAYS on since 2026-10-09, at the operator's request
        // ("把独立宠物窗口大一些，有时候宠物把手举起来会超出框架，多出来的部分正好可以显示文字"): it is what
        // gives a raised hand room and what leaves a band above the head for the 状态 prompt. It used to appear
        // only while a clip was PLAYING, and this assertion runs with nothing playing — the state the operator
        // was actually looking at when a pose outlived its clip and got cropped.
        found.canvas = {
          width: canvas.width,
          height: canvas.height,
          css: canvas.style.width,
          box: [placement.width, placement.height],
          viewport: [placement.viewportWidth, placement.viewportHeight],
          frameMargin: scene.frameMargin,
        };
        var boxOk = Math.abs(parseFloat(canvas.style.width) - placement.width * FRAME_MARGIN) <= 1
          && Math.abs(parseFloat(canvas.style.height) - placement.height * FRAME_MARGIN) <= 1
          && scene.frameMargin === FRAME_MARGIN
          && placement.width <= Math.ceil(placement.viewportWidth * 0.25);

        /**
         * The status prompt: the one thing this page cannot work out for itself.
         *
         * It has no session data — no catalog, no statuses, no boundary stream — so the state arrives from the
         * in-app pet over `/pet3d/state`, and `setState` is that arrival without a network. What is asserted
         * is the three-part contract the window depends on: the text is drawn, the blue sweep exists for the
         * animated state, and the prompt is drawn WHERE IT SAYS IT IS.
         *
         * That last part is the one this check used to get wrong. It compared the page's reported rectangle
         * with the page's reported rectangle (`shownRect` was read straight back out of `pet.rect()`), so it
         * could not fail — while the stylesheet applied `translate(-50%,-100%)` on top of coordinates
         * `layoutStatus` had already centred, drawing the prompt one full height ABOVE the window's top edge
         * and making the reported box describe somewhere nothing was. The launcher sizes the window from that
         * box, so the prompt stayed invisible and nothing failed. For a day. Measured live on 2026-10-09:
         * `/pet3d/desktop` reported `status.rect` at (1633, 832) inside a window at (1584, 838, 288x393) —
         * a box that claims to be inside the window while the element sat 24px above its top.
         *
         * So the assertion is now against the DOM: `getBoundingClientRect` includes any CSS transform, and the
         * page publishes the origin its rectangle is expressed against, which is what makes the two comparable.
         */
        var statusQuiet = pet.status();
        pet.setState('working', { startedAt: Date.now() - (14 * 60000 + 46000), endedAt: null });
        var statusRect = pet.status();
        /**
         * The page's own account of itself. `publish()` does not return it — it assigns it to
         * `__PET3D_DESKTOP_STATE__`, the very global the launcher's self-test reads back — so the readout is
         * taken from there, right after the `setState` above republished it.
         */
        pet.publish();
        var statusReadout = globalThis.__PET3D_DESKTOP_STATE__;
        var statusOrigin = statusReadout && statusReadout.status ? statusReadout.status.origin : null;
        var statusNode = document.querySelector('.pet3d-desktop-status');
        // TWO copies of the line, as DSH's TextShimmer has: the real one and the masked highlight. Both read
        // their words from `data-shimmer-text`.
        var statusTexts = statusNode ? statusNode.querySelectorAll('.pet3d-desktop-status-text') : [];
        var statusTextNode = statusTexts[0] || null;
        var sweepTextNode = statusTexts[1] || null;
        var statusIconNode = statusNode ? statusNode.querySelector('.pet3d-desktop-status-icon') : null;
        var statusDecorationNode = statusNode ? statusNode.querySelector('.pet3d-desktop-status-decoration') : null;
        var sweepNode = statusNode ? statusNode.querySelector('.pet3d-desktop-status-sweep') : null;
        var DESKTOP_FONT_VAR = '--pet3d-desktop-status-font';
        /** The ordinary line's colour, for the tone check below: 工作中 is a state with no tone of its own. */
        var ordinaryStatusColor = statusNode && globalThis.getComputedStyle
          ? globalThis.getComputedStyle(statusNode).color
          : null;
        var statusDomRect = statusNode ? statusNode.getBoundingClientRect() : null;
        var drawnWhereReported = Boolean(statusDomRect && statusOrigin && statusRect)
          && Math.abs(statusDomRect.left - (statusRect.left - statusOrigin.x)) <= 1.5
          && Math.abs(statusDomRect.top - (statusRect.top - statusOrigin.y)) <= 1.5;
        /**
         * And the prompt has to fit inside the window it is drawn in. The window is sized from the rectangle
         * the page reports, so the two must agree — and now that the window carries the frame margin, the
         * prompt belongs INSIDE it rather than above its top edge.
         */
        var windowRect = pet.rect();
        var statusInsideWindow = Boolean(windowRect && statusRect)
          && statusRect.left >= windowRect.left
          && statusRect.top >= windowRect.top
          && statusRect.left + statusRect.width <= windowRect.left + windowRect.width
          && statusRect.top + statusRect.height <= windowRect.top + windowRect.height;
        found.status = {
          quiet: statusQuiet,
          /**
           * The words live in `data-shimmer-text`, not in `textContent`: both copies render the label with
           * `content:attr(data-shimmer-text)`, exactly as DSH's own `TextShimmer` does, so there is one string
           * to keep in step rather than two DOM texts that could drift.
           */
          text: statusTextNode ? statusTextNode.getAttribute('data-shimmer-text') : null,
          highlightText: sweepTextNode ? sweepTextNode.getAttribute('data-shimmer-text') : null,
          iconDrawn: Boolean(statusIconNode) && statusIconNode.hidden === false,
          iconPath: statusIconNode && statusIconNode.querySelector('path')
            ? statusIconNode.querySelector('path').getAttribute('d').slice(0, 8)
            : null,
          decorationVisible: Boolean(statusDecorationNode) && statusDecorationNode.hidden === false,
          sweepVisible: Boolean(sweepNode) && sweepNode.hidden === false,
          fontPx: statusNode ? statusNode.style.getPropertyValue(DESKTOP_FONT_VAR) : null,
          rect: statusRect,
          reported: Boolean(pet.rect() && pet.rect().status),
          reportedRect: pet.rect() ? pet.rect().status : null,
          origin: statusOrigin,
          dom: statusDomRect
            ? { left: Math.round(statusDomRect.left), top: Math.round(statusDomRect.top), width: Math.round(statusDomRect.width), height: Math.round(statusDomRect.height) }
            : null,
          drawnWhereReported: drawnWhereReported,
          insideWindow: statusInsideWindow,
          /**
           * The model's own text-size correction, which the wheel ON THE TEXT drives.
           *
           * The page publishes it so the LAUNCHER can relay it to `/pet3d/desktop`; the launcher copies a
           * fixed list of fields, so a field missing from that list was invisible from outside the window —
           * "the text gesture did nothing" and "it worked and the size is right" looked identical. The
           * launcher's half of that is asserted in `scripts/verify-desktop.mjs`; this is the page's.
           */
          scale: statusReadout && statusReadout.status ? statusReadout.status.scale : null,
        };
        // And it is LIVE, not a constant 1: correcting the text for this model shows up on the next publish.
        var scaleModel = pet.loadedModel() || 'fixture';
        var scaleExpected = CORE.statusScaleFor(pet.preferences, scaleModel);
        pet.preferences.statusScale = CORE.setStatusScale(pet.preferences, scaleModel, 1.3);
        pet.publish();
        found.status.scaleAfterCorrection = globalThis.__PET3D_DESKTOP_STATE__.status.scale;
        found.status.scaleExpected = scaleExpected;
        var statusScaleOk = found.status.scale === scaleExpected
          && Math.abs(found.status.scaleAfterCorrection - 1.3) < 1e-9;
        /**
         * The label itself: DSH's own running line, its whale, and a live clock.
         *
         * The operator asked for the app's label rather than an approximation — "我要的是dsh内部的前面带着一个
         * 鲸鱼尾巴图标的'深度求索中，用时XX分XX秒 ···'" — so this asserts the three things that make it that
         * label and not a lookalike: the wording with a real duration in it, the app's own whale path drawn
         * beside it, and the text sized from the pet's box instead of a fixed 13px.
         */
        var statusLabel = String(found.status.text || '');
        var expectedFontPx = CORE.statusPromptFontPx(placement.height) + 'px';
        var statusOk = statusQuiet === null
          && statusLabel.indexOf('深度求索中，用时 ') === 0
          && /秒 ···$/.test(statusLabel)
          // Both copies carry the SAME string: that is what keeps the moving glyphs on the still ones.
          && found.status.highlightText === statusLabel
          && found.status.iconDrawn === true
          && found.status.iconPath === 'M8.844 1'
          && found.status.decorationVisible === true
          && found.status.sweepVisible === true
          && found.status.fontPx === expectedFontPx
          && Boolean(statusRect && statusRect.width > 0 && statusRect.height > 0)
          && found.status.reported === true
          && found.status.reportedRect.height === statusRect.height
          && drawnWhereReported
          // And it has to fit inside the window it is drawn in. This assertion used to read
          // `statusRect.top < pet.rect().top` — the prompt ABOVE the window's top edge — because the window
          // was exactly the pet's slot and that was the only place a prompt could be. The window now carries
          // the frame margin (the operator asked for a bigger window, and for the extra room to hold this
          // text), so the correct property is containment, and it is the stronger one: a prompt that spills
          // out of its window is clipped whether it spilled upward or sideways.
          && statusInsideWindow;
        pet.setState('resting');
        var statusCleared = pet.status() === null && pet.rect().status === null;
        found.status.cleared = statusCleared;
        /**
         * The two notices, drawn the way the operator asked for on 2026-10-11: 任务达成 in gold and bold, 出错 in
         * red. The tone is DECIDED in core and merely rendered here, so this asserts both halves — the element
         * wears it AND the page publishes it, which is what the launcher's own report copies.
         */
        var toneStyleOf = function (state) {
          pet.setState(state);
          var node = document.querySelector('.pet3d-desktop-status');
          var style = node && globalThis.getComputedStyle ? globalThis.getComputedStyle(node) : null;
          var text = node ? node.querySelector('.pet3d-desktop-status-text') : null;
          var readout = globalThis.__PET3D_DESKTOP_STATE__.status || {};
          return {
            text: text ? text.getAttribute('data-shimmer-text') : null,
            tone: node ? node.getAttribute('data-tone') : null,
            bold: node ? node.getAttribute('data-bold') : null,
            weight: style ? style.fontWeight : null,
            color: style ? style.color : null,
            publishedTone: readout.tone || null,
            publishedBold: readout.bold === true,
          };
        };
        var doneLook = toneStyleOf('done');
        var errorLook = toneStyleOf('error');
        found.status.tones = { done: doneLook, error: errorLook, ordinaryColor: ordinaryStatusColor };
        var toneOk = doneLook.text === '任务达成' && doneLook.tone === 'gold' && doneLook.bold === '1'
          && doneLook.weight === '700' && doneLook.publishedTone === 'gold' && doneLook.publishedBold === true
          && errorLook.text === '遇到问题了...' && errorLook.tone === 'danger' && errorLook.bold === null
          && errorLook.weight !== '700' && errorLook.publishedTone === 'danger'
          && Boolean(doneLook.color) && Boolean(ordinaryStatusColor)
          && doneLook.color !== ordinaryStatusColor && errorLook.color !== ordinaryStatusColor
          && doneLook.color !== errorLook.color;
        pet.setState('resting');
        /**
         * And a channel that reports NO STATE clears the prompt rather than freezing the last one.
         *
         * This is the live failure of 2026-10-11, in one assertion: the app's pet died with a TypeError,
         * `/pet3d/state` carried `state: null` for seventeen minutes, and this page kept drawing 工作中 with the
         * clock counting up — because an invalid state was IGNORED. The state, the prompt and the published
         * readout must all agree that nothing is being reported.
         */
        pet.setState('working', { startedAt: Date.now() - (14 * 60000 + 46000), endedAt: null });
        var promptCameBack = pet.status() !== null;
        pet.setState(null);
        found.status.noState = {
          promptCameBack: promptCameBack,
          cleared: pet.status() === null && pet.rect().status === null,
          published: globalThis.__PET3D_DESKTOP_STATE__.state.published,
          error: globalThis.__PET3D_DESKTOP_STATE__.state.error,
        };
        var noStateClears = promptCameBack === true && found.status.noState.cleared === true
          && found.status.noState.published === null;
        /**
         * The LONG PRESS, last in the block on purpose.
         *
         * It is the one assertion that needs the page's own clock, so it waits on the real timer rather than a
         * faked one — a faked clock would not prove that a timer was armed at all. And it comes LAST because
         * every pointer event after it would replace the press being held (the page's own guard drops a stale
         * timer, correctly), which is exactly how the first version of this test measured zero reactions while
         * the feature worked.
         */
        var holdBox = placement.pixels();
        var holdAt = {
          x: holdBox.left + Math.round(placement.width / 2),
          y: holdBox.top + Math.round(placement.height / 2),
        };
        var holdsBefore = interactions.filter(function (reason) { return reason === 'hold'; }).length;
        var clicksBeforeHold = interactions.filter(function (reason) { return reason === 'click'; }).length;
        pointer('pointerdown', holdAt.x, holdAt.y);
        var holdWait = new Promise(function (resolveHold) {
          setTimeout(function () {
            // Read BEFORE the release: the reaction must not wait for pointerup.
            var whileHeld = interactions.filter(function (reason) { return reason === 'hold'; }).length - holdsBefore;
            pointer('pointerup', holdAt.x, holdAt.y);
            var afterRelease = interactions.filter(function (reason) { return reason === 'hold'; }).length - holdsBefore;
            var clicksAfterHold = interactions.filter(function (reason) { return reason === 'click'; }).length
              - clicksBeforeHold;
            var state = globalThis.__PET3D_DESKTOP_STATE__ || null;
            found.longPress = {
              holdMs: Math.round(bounds.holdSeconds * 1000),
              whileHeld: whileHeld,
              afterRelease: afterRelease,
              clicksAdded: clicksAfterHold,
              touch: state ? state.touch : null,
            };
            resolveHold(whileHeld === 1 && afterRelease === 1 && clicksAfterHold === 0);
          }, Math.round(bounds.holdSeconds * 1000) + 140);
        });
        /**
         * Which sub-assertion failed, recorded because `ok` alone says only that ONE of them did.
         *
         * Not a nicety: when this check fails the report carries twenty measurements and no verdict, and the
         * last failure was a single sub-pixel difference inside `rectOk` that took two runs to find by hand.
         */
        /**
         * And the STREAM-LESS clock: the window must still show a 用时 when no turn frames ever arrive.
         *
         * `'state'` is the sentinel the app sends in that deployment (measured live: `GET /pet3d/state` → `clock: null`
         * for ever, and the label therefore lost its duration — "深度求索中的时间也没了"). Driven here rather than assumed,
         * because the window is a different page with its own reading of the relay.
         */
        pet.setState('working', 'state');
        var stateClockText = (function () {
          var node = document.querySelector('.pet3d-desktop-status-text');
          return node ? node.getAttribute('data-shimmer-text') : null;
        })();
        var stateClockReadout = (globalThis.__PET3D_DESKTOP_STATE__ || {}).state || {};
        var stateClockOk = Boolean(stateClockText)
          && stateClockText.indexOf('深度求索中，用时 ') === 0 && /秒 ···$/.test(stateClockText)
          && stateClockReadout.clock === 'state';

        found.flags = {
          dragOk: dragOk, orbitOk: orbitOk, orbitOutsideOk: orbitOutsideOk, zoomOk: zoomOk,
          zoomLimitsOk: zoomLimitsOk, gazeOk: gazeOk, rectOk: rectOk, hitOk: hitOk, boxOk: boxOk,
          placeOk: placeOk, throwFeatureOk: throwFeatureOk, holdOk: holdOk, dragReactionOk: dragReactionOk,
          clickReactionOk: clickReactionOk, globalDragOk: globalDragOk, menuOk: menuOk,
          menuHitOk: menuHitOk, menuControlOk: menuControlOk, menuClickSafe: menuClickSafe,
          menuCloseOk: menuCloseOk, statusOk: statusOk, statusCleared: statusCleared,
          statusScaleOk: statusScaleOk, noStateClears: noStateClears, toneOk: toneOk,
          wobbleOk: wobbleOk,
          pressSpeechOk: pressSpeechOk,
          shippedPressOk: shippedPressOk,
          shippedPressAiOk: shippedPressAiOk,
          stateClockOk: stateClockOk,
        };
        found.stateClock = { text: stateClockText, clock: stateClockReadout.clock };
        var everythingOk = dragOk && orbitOk && orbitOutsideOk && zoomOk && zoomLimitsOk && gazeOk && rectOk && hitOk && boxOk
          && placeOk && throwFeatureOk && holdOk && dragReactionOk && clickReactionOk && globalDragOk
          && menuOk && menuHitOk && menuControlOk && menuClickSafe && menuCloseOk && statusOk && statusCleared
          && statusScaleOk && noStateClears && toneOk && wobbleOk && pressSpeechOk && shippedPressOk
          && shippedPressAiOk && stateClockOk;
        found.avatar = scene.avatar ? (scene.avatar.kind || 'placeholder') : null;
        found.rect = last;
        report.desktopPage = found;
        // The long press is the one assertion that needs the page's own clock, so the verdict — and the teardown —
        // wait for it. Everything above it has already run.
        return holdWait.then(function (holdOk) {
          found.flags.longPressOk = holdOk;
          report.desktopPage = found;
          pet.destroy();
          host.remove();
          return everythingOk && holdOk;
        });
      });
    });

    /** One animation frame, so the page's own loop gets to run. */
    function nextFrame() {
      return new Promise(function (resolve) {
        globalThis.requestAnimationFrame(function () { resolve(); });
      });
    }
  });

  /**
   * The floating window's size is ITS OWN preference.
   *
   * `size` used to be one key shared with the in-app pet, and the two are framed differently — the app overlay
   * lives in DSH's window, this page's frame is the whole screen — so reloading DSH let the app pet push its
   * percentage over the window's (measured 2026-10-10: the window came back at 202×276 instead of 396×540).
   * This drives the real page with a stored profile that has BOTH numbers, and asserts the three things the
   * split promises: the page is sized by `windowSize`, the wheel writes `windowSize` back, and the patch it
   * pushes to the host names `windowSize` and NOT `size` — because a patch carrying `size` is exactly how the
   * window used to overwrite the app pet's value.
   */
  asyncCheck('the floating window sizes itself from its own preference, never the app pet’s', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '900px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 600;
    host.appendChild(canvas);

    var fixtureBytes = (function () {
      var encoded = globalThis.__PET3D_VRM_BASE64__;
      if (!encoded) return new ArrayBuffer(64);
      var binary = atob(encoded);
      var out = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out.buffer;
    })();

    // A stored profile with the two numbers APART: 100 % for the pet inside DSH, 150 % for this window.
    // 150 % of the 220x300 base slot is 330x450, which fits the 900x600 frame with room to spare, so the
    // assertion measures the preference rather than the frame's clamp. And a parked position, because the
    // page writes one on every drag and used to lose it to the cleaner.
    var stored = { size: 100, windowSize: 150, modelId: 'size-split', placementX: 0.25, placementY: 0.1 };
    var storage = {
      getItem: function () { return JSON.stringify(stored); },
      setItem: function (key, value) { try { stored = JSON.parse(value); } catch (error) { /* leave it */ } },
    };
    var restoreFetch = stubFetch({
      // 404 stops the host poll, which is what "this page keeps its own storage" looks like.
      '/pet3d/settings': function () { return { status: 404, ok: false }; },
      '/pet3d/catalog': function () { return { ok: true, json: function () { return Promise.resolve({ models: [] }); } }; },
      '/pet3d/asset': function () {
        return { ok: true, arrayBuffer: function () { return Promise.resolve(fixtureBytes); } };
      },
    });

    var pet = desktop.mount({
      canvas: canvas,
      bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
      modelId: 'size-split',
      screen: { x: 0, y: 0, width: 900, height: 600 },
      storage: storage,
    });
    // What the page sends the host, captured instead of posted: the patch's KEY LIST is the assertion.
    var pushes = [];
    if (pet.settingsSync) {
      pet.settingsSync.push = function (body) { pushes.push(body); return Promise.resolve(null); };
    }

    var placement = pet.placement;
    var first = { width: placement.width, height: placement.height };
    // The position the profile carried is where the window comes up: `cleanPreferences` keeps
    // `placementX`/`placementY` now, so the page's own `readPreferences` no longer drops them.
    var parked = { x: placement.x, y: placement.y };
    // One wheel notch on the pet, which is the gesture a user resizes the window with.
    pet.zoom(1);
    var zoomed = { width: placement.width, height: placement.height, windowSize: pet.preferences.windowSize };
    /**
     * The MENU, opened on this page's own frame. The size readout the panel used to carry is gone with it,
     * so what is asserted instead is the pair that matters to the LAUNCHER: the menu reports a rectangle (the
     * window has to grow to hold it) and opening it changes no size at all.
     */
    var sizeBeforeMenu = pet.preferences.windowSize;
    var menuOpened = pet.openMenuAt(160, 200);
    var menuRect = pet.menuRect();
    var label = menuRect ? Math.round(menuRect.width) + 'x' + Math.round(menuRect.height) : null;
    var sizeUntouchedByMenu = pet.preferences.windowSize === sizeBeforeMenu;
    pet.closeMenu();
    /**
     * Now DRAG it, the way a user does, and check the position is written AND pushed.
     *
     * The drag handler deliberately does not re-check `over` (the launcher only delivers a press on a painted
     * pixel), so a plain pointer sequence on the canvas is enough here. The assertion is about CONSISTENCY —
     * the fraction moved, and the same number reached both the page's storage and the host patch — rather than
     * about an exact pixel, because how far the box travels depends on where inside it the pointer grabbed it.
     */
    var dragStart = { x: pet.rect().left + 20, y: pet.rect().top + 20 };
    var pointer = function (type, x, y) {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y,
        button: 0, pointerId: 11, buttons: type === 'pointerup' ? 0 : 1,
      }));
    };
    var xBeforeDrag = placement.x;
    pointer('pointerdown', dragStart.x, dragStart.y);
    pointer('pointermove', dragStart.x + 40, dragStart.y + 15);
    pointer('pointerup', dragStart.x + 40, dragStart.y + 15);
    var dragged = { x: placement.x, y: placement.y };
    var patches = pushes.map(function (body) { return (body && body.preferences) || {}; });
    var lastPatch = patches.length ? patches[patches.length - 1] : {};

    report.windowSizeSplit = {
      first: first,
      parked: parked,
      zoomed: zoomed,
      label: label,
      dragged: dragged,
      stored: {
        size: stored.size, windowSize: stored.windowSize,
        placementX: stored.placementX, placementY: stored.placementY,
      },
      patchKeys: Object.keys(lastPatch),
      patchWindowSize: lastPatch.windowSize === undefined ? null : lastPatch.windowSize,
      patchHasSize: Object.prototype.hasOwnProperty.call(lastPatch, 'size'),
      appSizeUntouched: pet.preferences.size,
    };

    var sizedByItsOwnKey = first.width === 330 && first.height === 450;
    var zoomWroteItsOwnKey = zoomed.windowSize === Math.round(150 * CORE.WHEEL_ZOOM_STEP)
      && zoomed.width > first.width
      && pet.preferences.size === 100;
    var menuReported = menuOpened === true && /^[0-9]+x[0-9]+$/.test(String(label)) && sizeUntouchedByMenu;
    var patchIsClean = Object.prototype.hasOwnProperty.call(lastPatch, 'windowSize')
      && !Object.prototype.hasOwnProperty.call(lastPatch, 'size')
      && lastPatch.windowSize === zoomed.windowSize;
    var storageKeptBoth = stored.size === 100 && stored.windowSize === zoomed.windowSize;
    // The parked corner came back, the drag moved it, and the position reached both stores.
    var parkedRestored = Math.abs(parked.x - 0.25) < 1e-9 && Math.abs(parked.y - 0.1) < 1e-9;
    var dragMoved = dragged.x > xBeforeDrag;
    var positionPushed = Object.prototype.hasOwnProperty.call(lastPatch, 'placementX')
      && Object.prototype.hasOwnProperty.call(lastPatch, 'placementY')
      && Math.abs(lastPatch.placementX - dragged.x) < 1e-9;
    var positionStored = Math.abs(stored.placementX - dragged.x) < 1e-9;

    pet.destroy();
    host.remove();
    restoreFetch();
    return sizedByItsOwnKey && zoomWroteItsOwnKey && menuReported && patchIsClean && storageKeptBoth
      && parkedRestored && dragMoved && positionPushed && positionStored;
  });

  /**
   * The floating window's right-click MENU is the shared definition, not a look-alike.
   *
   * It replaced this page's own settings panel (operator, 2026-10-11: 「内置桌宠和独立桌宠各自有一套设置，这样是不
   * 对的。删掉两个单独的设置面板。」) — and before that the page had hand-rolled a panel of its own (a model cycle
   * button, a `-`/`+` pair, a gaze checkbox, a view reset and quit), so "where do I turn physics off" depended on
   * which pet you were looking at. What is asserted here is that this surface really builds the shared module:
   *
   *   * the element carries the SHARED class and the shared stylesheet is injected (so it is not a copy that
   *     happens to look similar);
   *   * the entries are there in the operator's order, from the module's own record;
   *   * and this surface does NOT carry the 切换 row, because its own 关闭独立宠物 is that action (operator,
   *     2026-10-12: 「外置桌宠的'切换回窗口内'选项现在和'关闭独立宠物'功能重复了，移除'切换回窗口内'选项」).
   *     Asserted as an ABSENCE — a check that only counted rows would happily pass a menu that had lost the row
   *     for some other reason;
   *   * the row it still owns is 关闭宠物, whose words come from the module's own table rather than from a
   *     regex on English, because which language a page picks is its own business;
   *   * and the reported rectangle is what the launcher grows the WINDOW from — DOM paints nothing into the
   *     transparent area, so a menu outside that rectangle is clipped.
   */
  asyncCheck('the floating window builds its menu from the shared definition', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    var menuApi = globalThis.__PET3D_MENU__;
    if (!desktop || !desktop.mount || !menuApi) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    var restoreFetch = stubFetch({
      '/pet3d/settings': function () { return { status: 404, ok: false }; },
      '/pet3d/catalog': function () { return { ok: true, json: function () { return Promise.resolve({ models: [] }); } }; },
      '/pet3d/asset': function () { return { ok: true, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(64)); } }; },
    });
    var pet = desktop.mount({
      canvas: canvas,
      bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
      modelId: 'menu-shared',
      screen: { x: 0, y: 0, width: 600, height: 600 },
      storage: { getItem: function () { return null; }, setItem: function () {} },
    });

    return pet.ready.then(function () {
      var opened = pet.openMenuAt(300, 420);
      var element = pet.menu();
      var api = pet.menuApi ? pet.menuApi() : null;
      var items = api ? api.items() : [];
      var ids = items.map(function (item) { return item.id; });
      // The module's own record, by class, and its stylesheet: a page that hand-rolled a look-alike fails here.
      var sharedClass = Boolean(element) && element.classList.contains('pet3d-menu');
      var stylesheet = Boolean(document.getElementById('pet3d-menu-style'));
      /**
       * 这个界面**没有** 切换行 —— 而它以前有的那一行（切换回窗口内）现在由 关闭独立宠物 承担。
       *
       * 两个方向都断言：`surfaceRow === null`（行不在），以及"没有任何一行的文字是那个被移除的说法"（不是换了个
       * id 又回来了）。应用内的那一个仍然保留，那一条在它自己的检查里钉着。
       */
      var surfaceRow = items.filter(function (item) { return item.id === 'surface'; })[0] || null;
      var removedWords = menuApi.strings('zh').surfaceApp;
      var noSwitchRow = surfaceRow === null
        && items.every(function (item) { return item.label !== removedWords; });
      /**
       * And the last row means something DIFFERENT out here: 关闭独立宠物, which hands the pet back inside the
       * app rather than hiding it. Read from the module's table for the same reason as the switch row — and
       * asserted to differ from the app's word, because one shared label is exactly the drift two surfaces
       * produce when nothing checks them.
       */
      var closeRow = items.filter(function (item) { return item.id === 'closePet'; })[0] || null;
      var closeWordsDiffer = Boolean(closeRow)
        && closeRow.label === menuApi.strings('zh').closePetWindow
        && menuApi.strings('zh').closePetWindow !== menuApi.strings('zh').closePetApp;
      // 重力 out here is this surface's OWN state: the window ships with it OFF ("drag and place"), and the
      // mark has to say so before anything is clicked.
      var gravityRow = items.filter(function (item) { return item.id === 'gravity'; })[0] || null;
      var gravityRowOff = Boolean(gravityRow) && gravityRow.checked === false;
      var gravityNode = element ? element.querySelector('[data-item="gravity"]') : null;
      var gravityMarked = Boolean(gravityNode)
        && gravityNode.getAttribute('aria-checked') === 'false'
        && gravityNode.getAttribute('data-toggle') === 'true';
      // And the reported rectangle is what the launcher grows the WINDOW from — DOM paints nothing into the
      // transparent area, so a menu outside that rectangle is clipped.
      var rect = pet.menuRect ? pet.menuRect() : null;
      var box = element ? element.getBoundingClientRect() : null;

      report.sharedMenu = {
        opened: opened,
        ids: ids,
        module: sharedClass,
        stylesheet: stylesheet,
        surfaceLabel: surfaceRow ? surfaceRow.label : null,
        noSwitchRow: noSwitchRow,
        closeLabel: closeRow ? closeRow.label : null,
        closeWordsDiffer: closeWordsDiffer,
        gravityRow: gravityRow,
        gravityMarked: gravityMarked,
        windowGravity: pet.gravity ? pet.gravity() : null,
        rect: rect,
        box: box ? [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)] : null,
      };

      pet.closeMenu();
      var closed = pet.isMenuOpen() === false;
      pet.destroy();
      host.remove();
      restoreFetch();
      return opened === true && closed && sharedClass && stylesheet && noSwitchRow
        && closeWordsDiffer && gravityRowOff && gravityMarked
        && ids.join(',') === 'resetView,resetSize,globalSettings,modelSettings,gravity,closePet'
        && Boolean(rect) && rect.width > 0 && rect.height > 0;
    });
  });

  /**
   * 重力 in the FLOATING WINDOW: its own switch, its own key, and its effect measured on the placement.
   *
   * The app's pet has its own 重力 check (above, driving `gravity`); this one is the other half of 「状态完全
   * 独立」, and the two keys are what make it true. Out here the switch SHIPS OFF — that window is "drag and
   * place" — so the interesting direction is turning it ON: a released drag must then really fall, which is the
   * one thing a preference that never reached `placement.throwEnabled` cannot fake.
   */
  asyncCheck('the floating window\'s 重力 switch drives its own physics, on its own key', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    /**
     * A real store, so `writePreferences` and the push to the host both have somewhere to land — and it starts
     * with the APP pet's key already OFF.
     *
     * That is what makes 「状态完全独立」 measurable rather than assumed: this page writes the WHOLE preference
     * object on every change, so if it re-derived `gravity` from its own key it would silently overwrite the
     * app pet's answer, and the assertion below (`appKeySurvived`) is what a single shared key could not pass.
     */
    var stored = {};
    stored[globalThis.__PET3D_CORE__.STORAGE_KEY] = JSON.stringify({ gravity: false });
    var store = {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
      setItem: function (key, value) { stored[key] = String(value); },
    };
    var restoreFetch = stubFetch({
      '/pet3d/settings': function () { return { status: 404, ok: false }; },
      '/pet3d/catalog': function () { return { ok: true, json: function () { return Promise.resolve({ models: [] }); } }; },
      '/pet3d/asset': function () { return { ok: true, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(64)); } }; },
    });
    var pet = desktop.mount({
      canvas: canvas,
      bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
      modelId: 'window-gravity',
      screen: { x: 0, y: 0, width: 600, height: 600 },
      storage: store,
    });

    return pet.ready.then(function () {
      var shipsOff = pet.gravity();
      // A click on the REAL row, the way a user throws the switch.
      pet.openMenuAt(300, 300);
      var node = pet.menu().querySelector('[data-item="gravity"]');
      if (node) node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      var afterOn = pet.gravity();
      var menuClosed = pet.isMenuOpen() === false;

      // A released drag with 重力 ON: a real fall, out of the real listeners.
      var box = pet.rect ? pet.rect() : null;
      var placement = pet.placement;
      var from = { x: placement.pixels().left + Math.round(placement.width / 2),
        y: placement.pixels().top + Math.round(placement.height / 2) };
      var send = function (type, at, id) {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: id,
          clientX: 0, clientY: 0, screenX: at.x, screenY: at.y,
        }));
      };
      send('pointerdown', from, 91);
      send('pointermove', { x: from.x + 30, y: from.y - 24 }, 91);
      send('pointerup', { x: from.x + 30, y: from.y - 24 }, 91);
      var airborneWithGravityOn = placement.isAirborne();

      // And the switch back OFF ends a fall that is already in progress — "no throwing and no falling" is
      // not "no new throws", and a pet frozen in mid-air is the worse bug.
      pet.openMenuAt(300, 300);
      var offNode = pet.menu().querySelector('[data-item="gravity"]');
      if (offNode) offNode.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      var afterOff = pet.gravity();
      var airborneAfterOff = placement.isAirborne();

      // The APP's key, which this page must never write or re-derive.
      var appKeySurvived = JSON.parse(stored[globalThis.__PET3D_CORE__.STORAGE_KEY] || '{}').gravity === false;

      report.windowGravity = {
        shipsOff: shipsOff, afterOn: afterOn, menuClosed: menuClosed,
        airborneWithGravityOn: airborneWithGravityOn,
        afterOff: afterOff, airborneAfterOff: airborneAfterOff,
        appKeySurvived: appKeySurvived,
      };

      pet.destroy();
      host.remove();
      restoreFetch();
      return shipsOff.preference === false && shipsOff.throwEnabled === false
        && afterOn.preference === true && afterOn.throwEnabled === true && menuClosed
        && airborneWithGravityOn === true
        && afterOff.preference === false && afterOff.throwEnabled === false
        && airborneAfterOff === false
        && appKeySurvived === true;
    });
  });
  /**
   * The FLOATING WINDOW's right-click: a wobbling hand still gets the menu.
   *
   * This window decides the gesture on `pointerup` rather than from the `contextmenu` event, so it never had
   * the app overlay's swallow-a-contextmenu failure — but it shared the same 4 px threshold, and with the menu
   * opening only for a press that did NOT move, a normal hand produced no menu here either (operator,
   * 2026-10-12). The three cases below are the whole rule: still press, wobbling press, real orbit.
   */
  asyncCheck('the floating window opens its menu for a wobbling right-click, not just a still one', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    var restoreFetch = stubFetch({
      '/pet3d/settings': function () { return { status: 404, ok: false }; },
      '/pet3d/catalog': function () { return { ok: true, json: function () { return Promise.resolve({ models: [] }); } }; },
      '/pet3d/asset': function () { return { ok: true, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(64)); } }; },
    });
    /**
     * 旋转取锁这条链的记录器 —— 页面向启动器要"放开焦点"，启动器回答之后再请求锁。
     *
     * 页面自己拿不到锁（Chromium 只给聚焦的文档发锁，而这个窗口刻意 `focusable: false`，启动器自检实测的拒绝
     * 理由就是「The root document of this element is not valid for pointer lock.」），所以"取锁"实际上是三
     * 步：页面 `orbit(true)` → 启动器聚焦并回 `orbit-focus` → 页面 `requestPointerLock()`。这三步的顺序就是
     * 断言的对象，缺任何一步锁都拿不到。
     */
    var orbitCalls = [];
    var rectReports = [];
    var focusListeners = [];
    var lockCalls = 0;
    var exitLockCalls = 0;
    var realRequest = canvas.requestPointerLock;
    var realExit = document.exitPointerLock;
    /**
     * 两个 spy 模拟真实的指针锁语义，而不是各管一半。
     *
     * `pointerLockElement` 同时被页面用在两处：请求前判断"是不是已经锁上了"，以及释放时判断"有没有锁要交
     * 回去"。所以这里让它随两次调用变化 —— 请求成功才置位，退出才清掉 —— 否则任何一半都会假：先把属性置
     * 位会让"取锁"永远不发生（页面以为已经锁了），不置位又会让"释放"永远不发生（页面以为没有锁）。
     * 这个属性是原型上的 getter，用自有属性遮住它。
     */
    canvas.requestPointerLock = function () {
      lockCalls += 1;
      Object.defineProperty(document, 'pointerLockElement', { value: canvas, configurable: true });
      return undefined;
    };
    document.exitPointerLock = function () {
      exitLockCalls += 1;
      try { delete document.pointerLockElement; } catch (_error) { /* frozen */ }
    };

    var pet = desktop.mount({
      canvas: canvas,
      bridge: {
        reportRect: function (rect) { rectReports.push(rect); }, ready: function () {}, onCursor: function () {},
        orbit: function (active) {
          orbitCalls.push(active === true);
          // 启动器聚焦完成后回一条消息；探针同步回答，等于"焦点已经拿到"。
          if (active === true) focusListeners.forEach(function (fn) { fn(); });
        },
        onOrbitFocus: function (cb) { focusListeners.push(cb); },
      },
      modelId: 'window-gesture',
      screen: { x: 0, y: 0, width: 600, height: 600 },
      storage: { getItem: function () { return null; }, setItem: function () {} },
    });

    return pet.ready.then(function () {
      /**
       * A secondary press/release, the way a real one arrives.
       *
       * `clientX/Y` AND `screenX/Y` carry the same numbers, which is what the mount's own gesture helper does
       * and what is true here: this mount's screen origin is (0,0), and the page computes its drag delta from
       * the client pair. Sending screen coordinates alone made an 80 px orbit look like a still press — the
       * first version of this check failed on exactly that, which is the kind of mistake the assertion caught.
       */
      function send(type, x, y, pointerId) {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, button: 2, buttons: type === 'pointerup' ? 0 : 2,
          pointerId: pointerId, clientX: x, clientY: y, screenX: x, screenY: y,
        }));
      }
      function rightClick(wobble, pointerId) {
        send('pointerdown', 300, 300, pointerId);
        if (wobble) send('pointermove', 300 + wobble, 300 + wobble, pointerId);
        send('pointerup', 300 + wobble, 300 + wobble, pointerId);
      }

      pet.closeMenu();
      rightClick(0, 81);
      var afterStill = pet.isMenuOpen() === true;
      // 一次普通右键不碰焦点、也不取锁：这正是主窗上一轮踩过的坑，这里必须一起钉住。
      var noFocusOnStill = orbitCalls.length === 0 && lockCalls === 0;
      pet.closeMenu();

      rightClick(2, 82);
      var afterWobble = pet.isMenuOpen() === true;
      var noFocusOnWobble = orbitCalls.length === 0 && lockCalls === 0;
      pet.closeMenu();

      rightClick(4, 83);
      var afterBigWobble = pet.isMenuOpen() === true;
      var noFocusOnBigWobble = orbitCalls.length === 0 && lockCalls === 0;
      pet.closeMenu();

      /**
       * And a real orbit: it turns the view, leaves no menu, ASKS FOR FOCUS, and only then takes the lock.
       *
       * 「独立桌宠的旋转功能一直都异常，从来没能把鼠标真正锁住过，把窗口内桌宠的锁定鼠标旋转的方法搬到独立桌宠上」
       * (operator, 2026-10-12). Three things in that sentence are asserted here: the orbit really turns the view,
       * it does not leave a menu behind, and the lock is taken — through the launcher, in that order, because a
       * request from an unfocused document is exactly the one Chromium refuses.
       */
      var yawBefore = pet.preferences.viewYaw;
      send('pointerdown', 300, 300, 84);
      send('pointermove', 380, 330, 84);
      var askedForFocus = orbitCalls.length === 1 && orbitCalls[0] === true;
      /**
       * 有启动器时，页面**自己不去请求锁** —— 取锁整件是启动器的事，页面只读结果。
       *
       * 这不是洁癖：页面发出的请求在生产里注定失败（Chromium 要"请求那一刻文档已聚焦且处于用户激活状态"，而
       * 请求前必须先过一次 IPC 让启动器把窗口设为可聚焦）。操作者 2026-10-12 的「并没有成功，光标没有被锁住」正是
       * 页面自己请求的结果，所以这里钉住"页面不再碰它"。
       */
      var pageLeftTheLockAlone = lockCalls === 0 && exitLockCalls === 0;
      send('pointerup', 380, 330, 84);
      var afterOrbit = pet.isMenuOpen() === true;
      var orbited = pet.preferences.viewYaw !== yawBefore;
      var handedFocusBack = orbitCalls.length === 2 && orbitCalls[1] === false;
      pet.closeMenu();

      /**
       * 锁**拿到之后**旋转必须跟着 movement 增量走 —— 否则"锁住"就等于画面僵住。
       *
       * 主窗的 `orbitLock` 检查里是同一件事。这里让页面相信它被锁上了（属性 + `pointerlockchange`），再派发一个
       * `clientX` 完全不动、只有 `movementX` 变化的移动：视角必须转。
       */
      Object.defineProperty(document, 'pointerLockElement', { value: canvas, configurable: true });
      document.dispatchEvent(new Event('pointerlockchange'));
      var yawBeforeLocked = pet.preferences.viewYaw;
      send('pointerdown', 300, 300, 85);
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 85,
        clientX: 300, clientY: 300, screenX: 300, screenY: 300, movementX: 45, movementY: 9,
      }));
      var turnedOnMovement = Math.abs(pet.preferences.viewYaw - yawBeforeLocked) > 0.05;
      /**
       * 旋转期间页面必须把 `orbiting: true` 报给启动器，结束后报回 false。
       *
       * 这是"旋转异常"的修复在页面这一侧的凭据：启动器按"光标是否在宠物像素上"决定要不要让窗口穿透，而旋转时
       * 鼠标必然离开宠物。没有这个字段，窗口会在那一刻穿透、指针事件断掉、旋转停住。
       */
      var orbitingReported = rectReports.some(function (rect) { return rect.orbiting === true; });
      var orbitingCleared = rectReports.some(function (rect) { return rect.orbiting === false; });
      send('pointerup', 300, 300, 85);
      try { delete document.pointerLockElement; } catch (_error) { /* frozen */ }
      document.dispatchEvent(new Event('pointerlockchange'));
      pet.closeMenu();

      report.windowGesture = {
        afterStill: afterStill, afterWobble: afterWobble, afterBigWobble: afterBigWobble,
        noFocusOnStill: noFocusOnStill, noFocusOnWobble: noFocusOnWobble, noFocusOnBigWobble: noFocusOnBigWobble,
        afterOrbit: afterOrbit, orbited: orbited,
        askedForFocus: askedForFocus, pageLeftTheLockAlone: pageLeftTheLockAlone,
        handedFocusBack: handedFocusBack, turnedOnMovement: turnedOnMovement,
        orbitingReported: orbitingReported, orbitingCleared: orbitingCleared,
        orbitCalls: orbitCalls, lockCalls: lockCalls, exitLockCalls: exitLockCalls,
      };

      pet.destroy();
      host.remove();
      restoreFetch();
      canvas.requestPointerLock = realRequest;
      document.exitPointerLock = realExit;
      try { delete document.pointerLockElement; } catch (_error) { /* frozen */ }
      return afterStill === true && afterWobble === true && afterBigWobble === true
        && noFocusOnStill && noFocusOnWobble && noFocusOnBigWobble
        && afterOrbit === false && orbited === true
        && askedForFocus && pageLeftTheLockAlone && handedFocusBack && turnedOnMovement
        && orbitingReported && orbitingCleared;
    });
  });
  /**
   * 外置窗的下坠也要有物理反馈 —— 和窗口内桌宠同一套（操作者：「一起补上」）。
   *
   * 这个窗默认不下坠（它的 重力 出厂是关的），所以缺口平时看不见；这条检查把重力打开，用真实监听器抛一次，
   * 然后**确定性地**逐帧推进（`pet.stepFrame`，不是等真实 rAF 帧），断言飞行速度确实喂进了模型：上升时为负、
   * 越顶之后为正、落地那一帧为 0。
   */
  asyncCheck('a throw in the floating window feeds the flight into the rig, like the in-app pet', async function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    /** 出厂关闭的重力，在这条检查里打开 —— 否则这个窗根本不会飞。 */
    var stored = {};
    stored[globalThis.__PET3D_CORE__.STORAGE_KEY] = JSON.stringify({ windowGravity: true });
    var store = {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
      setItem: function (key, value) { stored[key] = String(value); },
    };
    var restoreFetch = stubFetch({
      '/pet3d/settings': function () { return { status: 404, ok: false }; },
      '/pet3d/catalog': function () { return { ok: true, json: function () { return Promise.resolve({ models: [] }); } }; },
      '/pet3d/asset': function () { return { ok: true, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(64)); } }; },
    });
    var pet = desktop.mount({
      canvas: canvas,
      bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
      modelId: 'window-fall',
      screen: { x: 0, y: 0, width: 600, height: 600 },
      storage: store,
    });

    return pet.ready.then(async function () {
      var placement = pet.placement;
      var samples = [];
      var realSet = pet.scene.setDragMotion;
      pet.scene.setDragMotion = function (vx, vy) {
        samples.push({ vx: Number(vx), vy: Number(vy), airborne: placement.isAirborne() });
        return realSet.call(pet.scene, vx, vy);
      };
      var wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 14); }); };
      var send = function (type, x, y) {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
          pointerId: 97, clientX: x, clientY: y, screenX: x, screenY: y,
        }));
      };

      /**
       * 往**左上**抛，不是右上。
       *
       * 这个窗出厂停在右下角，`placement.maxX()` 已经到顶：向右拖会被 `clampToViewport` 夹住，宠物水平方向纹丝
       * 不动，于是 `moveDrag` 记录的水平速度是 0 —— 探针第一版就是这样，`sideways: 0` 而其余全对，失败在它自己的
       * 起手方向上。
       */
      var here = placement.pixels();
      var from = { x: here.left + Math.round(placement.width / 2), y: here.top + Math.round(placement.height * 0.6) };
      send('pointerdown', from.x, from.y);
      for (var step = 1; step <= 3; step += 1) {
        await wait();
        send('pointermove', from.x - step * 24, from.y - step * 30);
      }
      send('pointerup', from.x - 72, from.y - 90);
      var thrown = placement.isAirborne();

      // 确定性地推进，直到落地（重力是 7 个视口高度/秒²）。
      var guard = 0;
      while (placement.isAirborne() && guard < 240) {
        pet.stepFrame(1 / 60);
        guard += 1;
      }
      pet.scene.setDragMotion = realSet;

      var rising = samples.filter(function (sample) { return sample.airborne && sample.vy < -50; });
      var falling = samples.filter(function (sample) { return sample.airborne && sample.vy > 50; });
      // 方向由起手方向决定（这里向左），所以断言的是量级。
      var sideways = samples.filter(function (sample) { return sample.airborne && Math.abs(sample.vx) > 50; });
      var settled = samples.length ? samples[samples.length - 1] : null;

      report.windowFallMotion = {
        thrown: thrown, frames: guard, samples: samples.length,
        rising: rising.length, falling: falling.length, sideways: sideways.length,
        last: settled,
      };

      pet.destroy();
      host.remove();
      restoreFetch();
      return thrown && rising.length > 0 && falling.length > 0 && sideways.length > 0
        && Boolean(settled) && settled.airborne === false && settled.vx === 0 && settled.vy === 0;
    });
  });
  /**
   * 碎碎念 in the FLOATING WINDOW: the same remark the app's pet published, drawn above the prompt.
   *
   * The window has no session of its own, so the line is driven here exactly as the host delivers it (`setSpeech`
   * is `onState`'s `body.line` without a network). Four things are asserted, and each has its own failure mode
   * in the real window:
   *
   *   * the text is drawn, and it is the text that was published — not a line the page invented;
   *   * its reported rectangle describes where the DOM actually is (the launcher sizes the WINDOW from that
   *     rectangle, so a wrong one clips the bubble it exists to show — the same trap the prompt's rect had);
   *   * the bubble sits ABOVE the 状态 prompt rather than on top of it, so the two are readable together;
   *   * it is NOT in the hit test: the window must grow to show it, but a point on the bubble must stay
   *     click-through, while a point on the prompt stays interactive.
   */
  asyncCheck('the floating window shows the pet’s remark above the prompt and out of the click path', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    if (!desktop || !desktop.mount) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    var restoreFetch = stubFetch({
      '/pet3d/settings': function () { return { status: 404, ok: false }; },
      '/pet3d/catalog': function () { return { ok: true, json: function () { return Promise.resolve({ models: [] }); } }; },
      '/pet3d/asset': function () { return { ok: true, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(64)); } }; },
    });
    var pet = desktop.mount({
      canvas: canvas,
      bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
      modelId: 'speech-window',
      screen: { x: 0, y: 0, width: 600, height: 600 },
      storage: { getItem: function () { return null; }, setItem: function () {} },
    });

    return pet.ready.then(function () {
      // The 状态 prompt up first, so "above it" is a fact about both elements rather than about the head.
      pet.setState('working');
      var promptBox = pet.status();
      var line = '开始干活了';
      var returned = pet.setSpeech(line);
      var node = document.querySelector('.pet3d-desktop-speech');
      /** Read the DOM NOW: the clear below hides it, which is what `cleared` asserts. */
      var drawnText = node ? node.textContent : null;
      var wasVisible = Boolean(node) && node.hidden === false;
      var box = pet.speech();
      var reported = pet.rect() ? pet.rect().speech : null;
      var domRect = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
      var origin = reported && globalThis.__PET3D_DESKTOP_STATE__ && globalThis.__PET3D_DESKTOP_STATE__.speech
        ? globalThis.__PET3D_DESKTOP_STATE__.speech.origin
        : null;
      // The page reports its rectangles in the VIRTUAL frame; the element's page position is that rectangle
      // minus the origin the page also publishes — the same conversion the prompt's own check does, and the
      // reason for publishing both (a rectangle compared with the report alone proves nothing).
      var drawnWhereReported = Boolean(domRect && box && origin)
        && Math.abs(domRect.left - (box.left - origin.x)) <= 1.5
        && Math.abs(domRect.top - (box.top - origin.y)) <= 1.5;
      var abovePrompt = Boolean(box && promptBox)
        && box.top + box.height <= promptBox.top + 1;
      var centre = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
      var promptCentre = promptBox
        ? { x: promptBox.left + promptBox.width / 2, y: promptBox.top + promptBox.height / 2 }
        : null;
      var bubbleClickThrough = centre ? pet.hitTest(centre.x, centre.y) === false : false;
      var promptInteractive = promptCentre ? pet.hitTest(promptCentre.x, promptCentre.y) === true : false;
      var clearedReturn = pet.setSpeech(null);
      var cleared = node ? node.hidden === true : false;
      var clearedRect = pet.rect() ? pet.rect().speech : null;

      report.windowSpeech = {
        text: drawnText,
        visible: wasVisible,
        returned: returned,
        nodes: document.querySelectorAll('.pet3d-desktop-speech').length,
        box: box,
        reported: reported,
        drawnWhereReported: drawnWhereReported,
        abovePrompt: abovePrompt,
        bubbleClickThrough: bubbleClickThrough,
        promptInteractive: promptInteractive,
        cleared: cleared,
        clearedReturn: clearedReturn,
        clearedRect: clearedRect,
      };

      pet.destroy();
      host.remove();
      restoreFetch();
      return node && drawnText === line && wasVisible && returned === line
        && Boolean(box) && box.width > 0 && box.height > 0
        && Boolean(reported) && drawnWhereReported && abovePrompt
        && bubbleClickThrough && promptInteractive
        && cleared && clearedReturn === null && clearedRect === null;
    });
  });

  /**
   * The floating window can PLAY a motion — which it could not before this round.
   *
   * The app overlay has always been able to play an authored clip; the desktop window had no motion path at
   * all, so a `.vrma` a user assigned in the panel worked inside DSH and did nothing in the window they were
   * watching. This drives the page's own path end to end with REAL bytes: the generated wave, the catalog
   * route and the byte route stubbed, a real VRM parsed into the page's scene, and then the assertion that
   * matters — the mixer is running, the clip bound to bones, and a bone's rotation actually changes between
   * two frames.
   */
  asyncCheck('the floating window plays a mapped VRMA on a real avatar', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    var waveBase64 = globalThis.__PET3D_WAVE_BASE64__;
    var vrmBase64 = globalThis.__PET3D_VRM_BASE64__;
    if (!desktop || !desktop.mount || !waveBase64 || !vrmBase64) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    var waveBytes = Uint8Array.from(atob(waveBase64), function (c) { return c.charCodeAt(0); });
    var vrmBytes = Uint8Array.from(atob(vrmBase64), function (c) { return c.charCodeAt(0); });
    var restBase64 = globalThis.__PET3D_REST_BASE64__;
    var restBytes = restBase64
      ? Uint8Array.from(atob(restBase64), function (c) { return c.charCodeAt(0); })
      : waveBytes;
    var found = {};
    var cursors = [];

    /** One animation frame, so the page's own loop runs and advances the mixer. */
    function nextFrame() {
      return new Promise(function (resolve) {
        globalThis.requestAnimationFrame(function () { resolve(); });
      });
    }

    // The page reads its preferences from storage at mount, so the map is an ordinary stored setting.
    //
    // TWO states, two clips, because the per-state MOTION is the half of the 状态 section the floating window
    // was missing: until 2026-10-10 this page sent a hard `resting` for every non-drag frame, so a clip mapped
    // to 工作中 played in the app's pet and never in the window the user was watching. `a1` is the generated
    // wave and `a2` the generated rest clip — different motions, so which one is playing is visible.
    var stored = {
      modelId: 'placeholder',
      motions: { resting: 'a1', working: 'a2' },
    };
    var realFetch = globalThis.fetch;
    globalThis.fetch = function (url) {
      var path = String(url);
      if (path.indexOf('/pet3d/motions') === 0) {
        return Promise.resolve(new Response(JSON.stringify({
          motions: [
            { id: 'a1', name: 'pet3d-wave.vrma', format: 'vrma' },
            { id: 'a2', name: 'pet3d-rest.vrma', format: 'vrma' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.indexOf('/pet3d/motion?m=') === 0) {
        var id = path.slice(path.indexOf('m=') + 2);
        return Promise.resolve(new Response(id === 'a2' ? restBytes : waveBytes, { status: 200 }));
      }
      return realFetch.apply(globalThis, arguments);
    };

    var pet = null;
    return Promise.resolve()
      .then(function () {
        pet = desktop.mount({
          canvas: canvas,
          bridge: { reportRect: function () {}, ready: function () {}, onCursor: function (cb) { cursors.push(cb); } },
          modelId: 'placeholder',
          screen: { x: 0, y: 0, width: 600, height: 600 },
          storage: {
            getItem: function () { return JSON.stringify(stored); },
            setItem: function () {},
          },
        });
        return pet.ready;
      })
      .then(function () {
        // A real VRM, because a VRMA addresses the VRM humanoid rig: without an avatar of that kind the
        // page is RIGHT to offer nothing.
        return pet.scene.parse(vrmBytes.buffer, 'motion-fixture');
      })
      .then(function (parsed) {
        found.parsed = parsed && parsed.ok === true && parsed.kind === 'vrm';
        return globalThis.__PET3D_DESKTOP_MOTIONS__();
      })
      .then(function () { return nextFrame(); })
      .then(function () {
        // The bone this clip drives, before and after a frame of playback. Read on the NORMALIZED rig,
        // which is what a VRMA writes, so this is the same bone the clip addresses.
        var bone = pet.scene.avatar.vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        var rig = globalThis.__PET3D_DESKTOP_STATE__;
        var described = pet.scene.describeMotions();
        found.motion = rig && rig.motion ? rig.motion : null;
        found.describe = described;
        found.boneAtStart = bone ? Array.from(bone.quaternion.toArray()).map(function (v) { return +v.toFixed(4); }) : null;
        found.playingAtStart = described ? described.playing : null;
        // Start the gesture far to the side and level with the pet, so the gaze that lands on the head is
        // pure YAW — which is the axis the user's 70-degree rule is about.
        var slot = pet.placement.pixels();
        var centreX = slot.left + pet.placement.width / 2;
        var centreY = slot.top + pet.placement.height / 2;
        if (cursors.length) cursors[cursors.length - 1]({ x: centreX + 4000, y: centreY });
        return nextFrame().then(nextFrame).then(nextFrame);
      })
      .then(function () {
        /**
         * The frame has to HOLD the pose, and the gaze has to work ON TOP of the clip.
         *
         * Both were the user's report. The hand leaving the window is the first: the canvas is the pet's
         * slot, so a raised arm was drawn into the window's edge. Measured by projecting the hand's world
         * position into canvas pixels every frame for one wave cycle, then asking whether it fits the slot
         * (it should not — that is the complaint) and whether it fits the margin-expanded canvas (it must).
         *
         * The second is the gaze: with a clip driving the head, the addition is capped at
         * `HEAD_LAYER_LIMIT - the clip's own turn`, so at full aim the addition should be exactly that
         * remaining budget, and it must be more than zero.
         */
        var THREE = pet.scene.THREE;
        var scene = pet.scene;
        var humanoid = scene.avatar.vrm.humanoid;
        // The node the GAZE writes, and therefore the one installAvatar recorded the rest quaternion on:
        // vatar.bones.head, which is not the humanoid rig's normalized node (a different tree).
        var gazeHead = scene.avatar.bones && scene.avatar.bones.head ? scene.avatar.bones.head : null;
        var rest = gazeHead ? gazeHead.userData.pet3dRestQuat : null;
        var projected = new THREE.Vector3();
        var extreme = 0;

        /**
         * The frame has to HOLD the pose, and the gaze has to work ON TOP of the clip.
         *
         * Both halves were the user's report. The hand leaving the window is the first: the canvas IS the
         * pet's slot, so a raised arm was drawn into the window's edge. Sampled by posing the clip at 13
         * times across its duration (`mixer.setTime` — no frames, so this is cheap and exact) and projecting
         * the RAW hand bone into canvas pixels; the largest offset from the centre then answers both
         * questions: it must exceed the slot's half width (that is the complaint) and fit inside the
         * margin-expanded canvas (that is the fix).
         *
         * The second is the gaze: the clip's own turn leaves `70 deg - clipTurn` of budget, and at full aim
         * the addition must land on exactly that. Driven through the SCENE rather than the page here — the
         * page's cursor-to-gaze plumbing has its own check above; what is new is the layering.
         */
        var playback = scene.playback;
        var clipDuration = found.wave && found.wave.duration ? found.wave.duration : 2;
        var poseAt = function (time) {
          if (playback && playback.mixer) playback.mixer.setTime(time);
          humanoid.update();
          scene.avatar.root.updateMatrixWorld(true);
        };
        for (var step = 0; step <= 12; step += 1) {
          poseAt((clipDuration * step) / 12);
          var hand = humanoid.getRawBoneNode('rightHand');
          if (hand) {
            projected.setFromMatrixPosition(hand.matrixWorld).project(scene.camera);
            var px = (projected.x * 0.5 + 0.5) * scene.width;
            var py = (projected.y * 0.5 + 0.5) * scene.height;
            extreme = Math.max(extreme, Math.abs(px - scene.width / 2), Math.abs(py - scene.height / 2));
          }
        }
        poseAt(0.4);

        var headAt = function () {
          var node = scene.avatar.bones && scene.avatar.bones.head ? scene.avatar.bones.head : null;
          return node ? [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w] : null;
        };
        var angleBetween = function (a, b) {
          var dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
          return 2 * Math.acos(Math.min(1, dot));
        };

        // The clip's own pose: gaze zeroed, one frame spent so the layering runs.
        scene.motion.lookAtPointer = true;
        scene.motion.setGaze({ yaw: 0, pitch: 0 });
        scene.tick(1 / 60);
        var clipOnly = headAt();
        // Full aim, yaw only: an absurd number, because the scene clamps it to its own limit — this sends
        // "the pointer is as far to the side as it can be", which is what the budget is measured at.
        scene.motion.setGaze({ yaw: 10, pitch: 0 });
        // SETTLED, not one frame in: the gaze now ramps over a second (the operator's "1秒缓冲"), and this check
        // is about the LAYERING BUDGET, not about the ramp — which the motion suite measures frame by frame.
        // Ticking a second here would also advance the clip and mix its own motion into the comparison.
        scene.motion.gazeBlend = 1;
        scene.tick(1 / 60);
        var withGaze = headAt();

        found.frame = {
          extremePx: +extreme.toFixed(1),
          slotHalfWidthPx: +(pet.placement.width / 2).toFixed(1),
          slotHalfHeightPx: +(pet.placement.height / 2).toFixed(1),
          canvasWidthPx: +scene.width.toFixed(1),
          canvasHeightPx: +scene.height.toFixed(1),
          frameMargin: scene.frameMargin,
        };
        var HEAD_LAYER_LIMIT = (70 * Math.PI) / 180;
        var restQuat = rest ? [rest.x, rest.y, rest.z, rest.w] : null;
        var clipTurn = restQuat && clipOnly ? angleBetween(restQuat, clipOnly) : null;
        found.gazeOverClip = {
          addedDegrees: clipOnly && withGaze ? +(angleBetween(clipOnly, withGaze) * 180 / Math.PI).toFixed(2) : null,
          clipTurnDegrees: clipTurn === null ? null : +(clipTurn * 180 / Math.PI).toFixed(2),
          budgetDegrees: clipTurn === null ? null
            : +(Math.max(0, HEAD_LAYER_LIMIT - clipTurn) * 180 / Math.PI).toFixed(2),
        };
        return true;
      })
      .then(function () {
        var bone = pet.scene.avatar.vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        var moved = 0;
        if (bone && found.boneAtStart) {
          var now = bone.quaternion.toArray();
          for (var i = 0; i < 4; i += 1) moved += Math.abs(now[i] - found.boneAtStart[i]);
        }
        found.boneMoved = +moved.toFixed(4);
        var rig = globalThis.__PET3D_DESKTOP_STATE__;
        found.motionAtEnd = rig && rig.motion ? rig.motion : null;
        var published = found.motionAtEnd || {};
        var available = Array.isArray(published.available) ? published.available : [];
        var wave = available.filter(function (entry) { return entry.id === 'a1'; })[0] || null;
        found.wave = wave;
        // The pose reaches past the slot (that is the complaint) and fits the expanded canvas (that is the
        // fix). Both directions are asserted: a margin that was not needed, or one that is not enough, would
        // each fail one half.
        var frame = found.frame || {};
        var frameOk = frame.extremePx > frame.slotHalfWidthPx
          && frame.extremePx < Math.min(frame.canvasWidthPx, frame.canvasHeightPx) / 2
          && frame.frameMargin > 1;
        // The gaze on top of the clip: it must reach the head at all, and at full aim it must land on the
        // remaining budget — `70 - the clip's own turn`, exactly as asked.
        var gaze = found.gazeOverClip || {};
        var gazeOk = typeof gaze.addedDegrees === 'number' && gaze.addedDegrees > 0.5
          && typeof gaze.budgetDegrees === 'number'
          && gaze.addedDegrees <= gaze.budgetDegrees + 3
          && gaze.addedDegrees >= Math.min(gaze.budgetDegrees, 60) * 0.8;
        found.frameOk = frameOk;
        found.gazeOk = gazeOk;
        /**
         * And the per-state MOTION, which this window used to ignore entirely.
         *
         * `setState` is what the host's `/pet3d/state` poll leads to, so this is the whole path from "DSH is
         * thinking" to "the floating pet plays the clip 工作中 is mapped to". What is read is the SCENE's own
         * account (`describeMotions`) rather than the page's readout, because the scene is what draws; the
         * readout is published on demand and is only asked for after the frames have settled, so the two
         * cannot be one frame out of step with each other.
         */
        var beforeSwitch = pet.scene.describeMotions();
        pet.setState('working', { startedAt: Date.now() - (14 * 60000 + 46000), endedAt: null });
        found.stateBefore = { state: pet.scene.state, picked: beforeSwitch ? beforeSwitch.picked : null };
        return nextFrame().then(nextFrame).then(nextFrame).then(function () {
          var after = pet.scene.describeMotions();
          pet.publish();
          var readout = globalThis.__PET3D_DESKTOP_STATE__;
          found.stateSwitch = {
            drawn: pet.scene.state,
            readout: readout ? readout.state : null,
            picked: after ? after.picked : null,
            playing: after ? after.playing : null,
            status: readout ? readout.status : null,
          };
          pet.setState('resting');
          return nextFrame().then(nextFrame).then(function () {
            var back = pet.scene.describeMotions();
            found.stateSwitch.back = { drawn: pet.scene.state, picked: back ? back.picked : null };
            var switchOk = found.stateSwitch.drawn === 'working'
              && found.stateSwitch.readout
              && found.stateSwitch.readout.drawn === 'working'
              && found.stateSwitch.readout.published === 'working'
              // The clip the map assigns to 工作中 is the one that must be drawn there.
              && found.stateSwitch.picked === 'a2'
              && found.stateSwitch.playing === 'a2'
              // ...with its own prompt up at the same time: the two halves of the feature together. The label
              // is DSH's own running line, so the duration inside it is whatever the state's age happens to be
              // — the SHAPE is asserted here, and the wording itself is pinned by the core suite.
              && found.stateSwitch.status
              && String(found.stateSwitch.status.text).indexOf('深度求索中，用时 ') === 0
              && /秒 ···$/.test(String(found.stateSwitch.status.text))
              && found.stateSwitch.status.animation === 'shimmer'
              && found.stateSwitch.status.icon === true
              && found.stateSwitch.back.drawn === 'resting'
              && found.stateSwitch.back.picked === 'a1';
            found.stateSwitch.ok = switchOk;
            return found.parsed === true
              && found.playingAtStart === 'a1'
              && Boolean(wave) && wave.tracks === 7 && wave.duration === 2
              && published.kind === 'vrm' && published.format === 'vrma'
              && found.boneMoved > 0.001
              && frameOk && gazeOk && switchOk;
          });
        });
      })
      .catch(function (error) {
        found.error = String((error && error.message) || error);
        return false;
      })
      .then(function (ok) {
        report.desktopMotion = found;
        globalThis.fetch = realFetch;
        if (pet) pet.destroy();
        if (host.parentNode) host.remove();
        return ok;
      });
  });

  /**
   * The resting pose, measured: arms hanging at the sides, elbows bent, the body turning slowly — and finger
   * tracks in the FILE, because the committed fixture has no finger bones for them to bind to.
   *
   * "自然" is not something a screenshot can be checked against, so each half of the request is turned into a
   * number: the hand's world position relative to the hips (down, and out at the side rather than straight
   * out in a T-pose or crossed in front), the angle between the upper arm and the forearm (an elbow that is
   * actually bent), the range the spine sweeps over the clip (a body that is actually turning), and the
   * declared curl on every finger joint read out of the GLB's own JSON.
   */
  asyncCheck('the resting clip hangs the arms down, bends the elbows and turns the body slowly', function () {
    var desktop = globalThis.__PET3D_DESKTOP__;
    var restBase64 = globalThis.__PET3D_REST_BASE64__;
    var vrmBase64 = globalThis.__PET3D_VRM_BASE64__;
    if (!desktop || !desktop.mount || !restBase64 || !vrmBase64) return Promise.resolve(false);

    var host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '600px';
    host.style.height = '600px';
    document.body.appendChild(host);
    var canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 600;
    host.appendChild(canvas);

    var restBytes = Uint8Array.from(atob(restBase64), function (c) { return c.charCodeAt(0); });
    var vrmBytes = Uint8Array.from(atob(vrmBase64), function (c) { return c.charCodeAt(0); });
    var found = {};

    /** One animation frame, so the page's own loop resolves the state against the motion map. */
    function nextFrame() {
      return new Promise(function (resolve) {
        globalThis.requestAnimationFrame(function () { resolve(); });
      });
    }
    var realFetch = globalThis.fetch;
    globalThis.fetch = function (url) {
      var path = String(url);
      if (path.indexOf('/pet3d/motions') === 0) {
        return Promise.resolve(new Response(JSON.stringify({
          motions: [{ id: 'a2', name: 'pet3d-rest.vrma', format: 'vrma' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (path.indexOf('/pet3d/motion?m=') === 0) {
        return Promise.resolve(new Response(restBytes, { status: 200 }));
      }
      return realFetch.apply(globalThis, arguments);
    };

    var pet = null;
    return Promise.resolve()
      .then(function () {
        pet = desktop.mount({
          canvas: canvas,
          bridge: { reportRect: function () {}, ready: function () {}, onCursor: function () {} },
          modelId: 'placeholder',
          screen: { x: 0, y: 0, width: 600, height: 600 },
          storage: {
            getItem: function () { return JSON.stringify({ modelId: 'placeholder', motions: { resting: 'a2' } }); },
            setItem: function () {},
          },
        });
        return pet.ready;
      })
      .then(function () { return pet.scene.parse(vrmBytes.buffer, 'rest-fixture'); })
      .then(function () { return globalThis.__PET3D_DESKTOP_MOTIONS__(); })
      // The clip is BUILT by that call but not PLAYING until the page's frame loop resolves the state
      // against the map — measuring straight away reads the procedural stand (which is exactly why the first
      // version of this check "passed" while measuring the idle pose: 75 degrees is VRM_ARM_DROP_LIMIT).
      .then(function () { return nextFrame(); })
      .then(function () { return nextFrame(); })
      .then(function () {
        var scene = pet.scene;
        var THREE = scene.THREE;
        var humanoid = scene.avatar.vrm.humanoid;
        var playback = scene.playback;
        var duration = 6;
        var poseAt = function (time) {
          if (playback && playback.mixer) playback.mixer.setTime(time);
          humanoid.update();
          scene.avatar.root.updateMatrixWorld(true);
        };
        var boneAt = function (name) {
          var bone = humanoid.getRawBoneNode(name);
          if (!bone) return null;
          var v = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
          return { x: v.x, y: v.y, z: v.z, bone: bone };
        };
        /** The world direction a bone points in: it is a joint, so it points at its first child. */
        var directionOf = function (name) {
          var bone = humanoid.getRawBoneNode(name);
          if (!bone || !bone.children.length) return null;
          var from = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
          var to = new THREE.Vector3().setFromMatrixPosition(bone.children[0].matrixWorld);
          return to.sub(from).normalize();
        };
        var angleBetweenVectors = function (a, b) {
          if (!a || !b) return null;
          return Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180 / Math.PI;
        };

        poseAt(1.5);
        var height = scene.modelHeight;
        var hips = boneAt('hips');
        var leftHand = boneAt('leftHand');
        var rightHand = boneAt('rightHand');
        var elbowAngle = angleBetweenVectors(directionOf('leftUpperArm'), directionOf('leftLowerArm'));
        // The body turn: the spine's world yaw at four moments across the clip, as the range of the head's
        // lateral position relative to the hips — a cheap, model-agnostic read of "the body is turning".
        var lateral = [];
        for (var i = 0; i < 4; i += 1) {
          poseAt((duration * i) / 4);
          var h = boneAt('head');
          var p = boneAt('hips');
          if (h && p) lateral.push(h.x - p.x);
        }
        poseAt(1.5);
        var swayRange = lateral.length ? (Math.max.apply(null, lateral) - Math.min.apply(null, lateral)) : 0;

        /**
         * The finger curls, read out of the file itself. The fixture model has no finger bones, so the loader
         * drops those tracks here — which means the only place the requirement can be checked is the JSON.
         */
        var view = new DataView(restBytes.buffer);
        var jsonLength = view.getUint32(12, true);
        var gltf = JSON.parse(new TextDecoder().decode(restBytes.subarray(20, 20 + jsonLength)));
        var nodeNames = (gltf.nodes || []).map(function (node) { return node.name; });
        var fingerChannels = (gltf.animations[0].channels || []).filter(function (channel) {
          var name = nodeNames[channel.target.node] || '';
          return /^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(name) && channel.target.path === 'rotation';
        });
        var fingerHands = {};
        fingerChannels.forEach(function (channel) {
          var name = nodeNames[channel.target.node];
          fingerHands[name.slice(0, 5)] = true;
        });

        found = {

          handBelowHips: hips && leftHand ? +(hips.y - leftHand.y).toFixed(3) : null,
          handLateral: leftHand && hips ? +Math.abs(leftHand.x - hips.x).toFixed(3) : null,
          handForward: leftHand && hips ? +Math.abs(leftHand.z - hips.z).toFixed(3) : null,
          elbowAngleDegrees: elbowAngle === null ? null : +elbowAngle.toFixed(1),
          swayRange: +swayRange.toFixed(3),
          fingerTracks: fingerChannels.length,
          fingerHands: Object.keys(fingerHands).sort().join(','),
          playing: pet.scene.describeMotions().playing,
        };
        var hands = found.handBelowHips !== null
          // Down: the hand is well below the hips — `handBelowHips` is hips.y - hand.y, so POSITIVE means the
          // hand hangs lower — and out at the side by less than half the model's height. A T-pose would put
          // it near the full arm span out, and crossed arms would bring it back to the midline.
          && found.handBelowHips > height * 0.05
          && found.handLateral > height * 0.02
          && found.handLateral < height * 0.45
          // Beside the body rather than in front of it or behind it.
          && found.handForward < height * 0.25;
        var elbows = found.elbowAngleDegrees !== null && found.elbowAngleDegrees > 5;
        var turning = found.swayRange > height * 0.002;
        var fingers = found.fingerTracks >= 28
          && found.fingerHands.indexOf('left') !== -1
          && found.fingerHands.indexOf('right') !== -1;
        return found.playing === 'a2' && hands && elbows && turning && fingers;
      })
      .catch(function (error) {
        found.error = String((error && error.message) || error);
        return false;
      })
      .then(function (ok) {
        report.restPose = found;
        globalThis.fetch = realFetch;
        if (pet) pet.destroy();
        if (host.parentNode) host.remove();
        return ok;
      });
  });

  /**
   * The plugin's OWN route from DSH's session hooks to the pet — the one path nothing else in
   * this file can see.
   *
   * Every check above drives a `Pet3DWidget` directly, and drives its aggregate with `setInput`.
   * None of them can fail when the PLUGIN forgets to wire the widget to the store, and that is
   * exactly what happened: `apply` registered `Pet3DRoot`, the component read
   * `props.useSessions` / `props.useSessionStatus` and pushed them in — but the aggregate's
   * `connected` flag, which gates every state except 等待确认, was written only by `setConnected`,
   * a method nothing called. The pet reported 离线 through a whole working turn (measured live
   * 2026-10-09: `/pet3d/state` said `offline` while the agent was streaming), so 工作中 /
   * 任务达成 / 出错 / 空闲 / 睡觉 could not be reached on screen while all ten suites were green.
   *
   * So this mounts the REAL registered component through the REAL `apply`, hands it the two hooks
   * DSH's slot machinery gives every registered component, and asserts that the widget it builds
   * is connected, resolves 工作中, and announces that state on the host channel.
   *
   * It builds its own React rather than reusing `__PET3D_PLUGIN__`: the page's stub deliberately
   * ignores `useEffect` (it exists so the module registration can run at load), and this check is
   * about what the effects do.
   */
  asyncCheck('the plugin wires the session hooks to the pet and announces 工作中', function () {
    var slotHost = document.createElement('div');
    document.body.appendChild(slotHost);

    var effects = [];
    var refs = [];
    var react = {
      createElement: function (type, props) {
        return { type: type, props: props || {}, children: [] };
      },
      /**
       * The component's first ref is the host element the slot's renderer attaches for it; the
       * second holds the widget. Handing the first a real element is what lets the construction
       * effect run its real body instead of its `if (!host) return` early exit.
       */
      useRef: function (initial) {
        var ref = { current: refs.length === 0 && initial === null ? slotHost : initial };
        refs.push(ref);
        return ref;
      },
      useState: function (initial) { return [initial, function () {}]; },
      useEffect: function (fn) { effects.push(fn); },
    };

    var plugin = CLIENT.createPlugin(function (specifier) {
      if (specifier === 'react') return react;
      throw new Error('unexpected require("' + specifier + '")');
    }, Promise.resolve({}));

    var registered = null;
    plugin.apply({
      slots: {
        inject: function (slot, callback) { return callback(); },
        register: function (row, Component) {
          registered = { row: row, Component: Component };
          return function () {};
        },
      },
      effect: function () {},
      get: function () { return undefined; },
      on: function () {},
    });
    if (!registered || registered.row.name !== 'shell.overlay' || registered.row.id !== 'pet3d') {
      report.slotWiring = { registered: registered && registered.row };
      return false;
    }

    // The session standard kit in DSH's own shape: `useSessions` selects from the store state,
    // `useSessionStatus` selects from a Map keyed by session id whose values carry `running` and
    // `pendingInteraction`.
    var store = { byId: { s1: {} }, phase: 'ready' };
    var statuses = new Map([['s1', { running: true }]]);
    registered.Component({
      useSessions: function (select) { return select(store); },
      useSessionStatus: function (select) { return select(statuses); },
    });

    // The pet announces its state by POSTing `/pet3d/state`. That is the channel the floating
    // window polls and the one `scripts/check-profile.mjs` reads, so it is asserted end to end.
    var realFetch = globalThis.fetch;
    var posted = [];
    globalThis.fetch = function (url, init) {
      var path = String(url);
      if (path.indexOf('/pet3d/state') === 0 && init && typeof init.body === 'string') posted.push(init.body);
      if (path.indexOf('/pet3d/catalog') === 0) {
        return Promise.resolve(new Response(JSON.stringify({ models: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        }));
      }
      if (path.indexOf('/pet3d/motions') === 0) {
        return Promise.resolve(new Response(JSON.stringify({ motions: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        }));
      }
      return realFetch.apply(globalThis, arguments);
    };

    var widget = null;
    var cleanup = null;
    function teardown() {
      globalThis.fetch = realFetch;
      try { if (typeof cleanup === 'function') cleanup(); } catch (error) { /* already gone */ }
      if (widget && !widget.disposed) widget.dispose();
      // The last check in this file asserts that no `.pet3d-root` survives disposal, so this
      // mount has to be gone before it runs.
      if (slotHost.parentNode) slotHost.remove();
    }

    return Promise.resolve()
      // Effect 1 constructs the widget once the chunks land, so it runs on its own first.
      .then(function () { cleanup = effects[0](); })
      .then(function () { return null; })
      .then(function () { return null; })
      .then(function () {
        widget = refs.length > 1 ? refs[1].current : null;
        if (!widget) return false;
        // Effect 2 is the push this regression is about.
        effects[1]();
        widget.tick(1 / 60);
        report.slotWiring = {
          connected: widget.connected === true,
          state: widget.machine.state,
          posted: posted.slice(),
        };
        return widget.connected === true
          && widget.machine.state === 'working'
          && posted.some(function (body) { return body.indexOf('"working"') !== -1; });
      })
      .then(function (ok) { teardown(); return ok; }, function (error) { teardown(); throw error; });
  });

  // Dispose comes last and after the async checks settle: they drive the live
  // widget, and the earlier promise-returning model check needs a turn of its
  // own before the report is written.
  setTimeout(function () {
    Promise.all(pending.slice()).then(function () {
      check('dispose removes the DOM and stops the loop', function () {
        widget.dispose();
        return widget.disposed === true && widget.root === null && document.querySelector('.pet3d-root') === null;
      });
      finish();
    }, finish);
  }, 600);
})();

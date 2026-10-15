// The pet's own window: always on top of every other window, transparent, and click-through
// everywhere except over the pet itself.
//
// Started by the plugin's host half (`lib/desktop.js`) with a bare-Electron runtime, so this
// file must not assume anything about DSH: it gets its page URL, its model id and its
// parent's pid on the command line and owns nothing else.
//
// Everything here was measured before it was written (see HANDOFF §12): a transparent
// always-on-top window renders WebGL with a real alpha channel, can be resized to the whole
// screen, and `capturePage()` returns pixels that are mostly fully transparent.
const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** Cursor polling rate. The gaze is smoothed by the idle, so this is about drag latency. */
const CURSOR_HZ = 60;

/** How often to check that the process that started us is still alive. */
const WATCHDOG_MS = 2000;

/**
 * The size the pet's window starts at, before the page has told us where the pet actually is.
 *
 * A placeholder, not a policy: every `vrmpet3d:rect` report re-sizes and re-places the window onto the
 * pet's OWN rectangle, so this only has to be a sane shape for the first frame. The window used to be
 * the whole work area and nothing about the pet's size was involved — see the note on the window
 * options below for the measurement that ended that.
 */
const DEFAULT_PET_WINDOW = { width: 240, height: 320 };

/**
 * The marker both halves agree on for "here is what the page is doing".
 *
 * Duplicated in `lib/desktop.js` because the launcher is a separate process with no imports
 * from the plugin; the `desktop` suite asserts the two copies are identical, so a rename on
 * one side fails a test instead of silently ending the reporting.
 */
const VRMPET3D_STATUS_PREFIX = 'vrmpet3d-desktop: ';

/**
 * The payload the page expects for a cursor sample.
 *
 * `frame` is the window's origin, and it is load-bearing: the page positions its canvas in the VIRTUAL
 * work-area frame it has always used (the pet's placement, its zoom ceiling and its gaze are all
 * measured against that), so it needs the window origin to convert to window coordinates. A sample
 * without it would leave the page laying its canvas out against a stale origin — which is why the
 * self-test's synthetic cursors go through this too, and why it lives at module scope: those probes
 * run outside the `whenReady` scope.
 */
function cursorMessage(target, point, isInteracting) {
  const frame = target && !target.isDestroyed() ? target.getBounds() : { x: 0, y: 0 };
  return {
    x: point.x,
    y: point.y,
    interacting: isInteracting === true,
    frame: { x: frame.x, y: frame.y },
  };
}

function parseArgs(argv) {
  const out = { url: '', modelId: '', parentPid: 0, selfTest: '', config: false };
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) continue;
    if (match[1] === 'url') out.url = match[2];
    else if (match[1] === 'model-id') out.modelId = match[2];
    else if (match[1] === 'parent-pid') out.parentPid = Number(match[2]) || 0;
    else if (match[1] === 'self-test') out.selfTest = match[2];
    else if (match[1] === 'config') out.config = match[2] !== '0';
  }
  return out;
}

/**
 * A parent that stops reading must not put a modal dialog in front of the user.
 *
 * `announce()` writes one status line to stdout per report, and a broken pipe surfaces as an
 * ASYNCHRONOUS `error` event on the stream, not as a throw - so the try/catch around the write
 * cannot see it, and Node turns it into an uncaught exception. Electron then shows
 * "A JavaScript error occurred in the main process" (measured 2026-10-08: killing a probe
 * instance raised EPIPE at Socket._write through announce -> IpcMainImpl, and the dialog stayed on
 * the user's screen). The pet itself is fine in that situation; it simply has nobody to talk to.
 */
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

/**
 * How long the self-test waits for the page's own verdict before it gives up.
 *
 * Without it a page that never sends `vrmpet3d:ready` leaves the window and this process alive for
 * ever (measured twice on 2026-10-08), which is a stray always-on-top window on the user's screen
 * and a self-test that never writes its report. The `desktop` suite waits 60 s for the file, so
 * this has to fire before that.
 */
const SELF_TEST_TIMEOUT_MS = 45_000;

let selfTestTimer = null;

/**
 * Keep drawing even when Windows thinks nobody is looking.
 *
 * A screen-sized, transparent, always-on-top window gets classified as occluded the moment something covers
 * it - or, on Windows, when it is activated by a click - and Chromium then STOPS PAINTING it. What is left on
 * screen is the window's last frame, and for a transparent window that frame carries a snapshot of whatever
 * was behind it, so the desktop appears frozen like a screenshot (reported 2026-10-08: it happened the first
 * time the user clicked the model).
 *
 * Both switches are about that one behaviour: the occlusion calculation is what marks the window occluded, and
 * the backgrounding flag is what lets an occluded window stop rendering. A desk pet is always on top, so it is
 * never 'behind' anything in a way that would justify throttling it.
 */
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
//
// And the compositing path itself.
//
// A screen-sized transparent window is normally presented through DirectComposition / an independent flip
// plane - the shortest path to the screen, and the one that can leave whatever is behind the window showing
// a stale frame when the window stops or changes how it presents (reported again after the occlusion
// switches, so they were necessary but not sufficient). `disable-direct-composition` takes the ordinary
// compositing path, which keeps the desktop behind the pet live. `enable-transparent-visuals` asks for the
// transparency support explicitly rather than relying on the default.
//
app.commandLine.appendSwitch('disable-direct-composition');
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const options = parseArgs(process.argv.slice(2));
const report = {
  startedAt: new Date().toISOString(),
  argv: process.argv.slice(1, 4),
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
  url: options.url,
  modelId: options.modelId,
  checks: {},
  errors: [],
};
let selfTestWritten = false;

/**
 * EVERY window gets its own Chromium profile — not only a self-test.
 *
 * Chromium's process singleton is per `user-data-dir`, so two windows of THIS app that share one either exit at once or — measured,
 * twice, on 2026-10-08 — hang before their page ever mounts, because the shared profile is owned by the live instance. That was
 * handled for self-tests only, which left the case that matters in production: the PET window and the SETTINGS window are the same
 * launcher (`--config=1`) and shared a profile, so whichever started second was the one whose page never mounted.
 *
 * The operator's window on 2026-10-15 was exactly that, and it read as 「弹簧骨状态丢了…头发现在动的感觉不对了」: no mount means no scene,
 * so no spring bones, no motion, and `ready: false` with an empty error list — while the same launcher started by hand, with no second
 * window in the way, mounted normally (`ready: true`, `pageTitle: … > ready:m1`).
 *
 * The directory is kept between runs so Chromium's one-time work happens once, and the mode is in the name so the pet, the settings
 * window and a probe never share one. Set before `app.whenReady()`, which is the only time it takes effect.
 */
const profileSuffix = options.config === true ? '-config' : '-pet';
const ownProfile = `${app.getPath('userData')}${profileSuffix}${options.selfTest ? '-selftest' : ''}`;
try {
  fs.mkdirSync(ownProfile, { recursive: true });
  app.setPath('userData', ownProfile);
} catch (_error) {
  // A window that cannot get its own profile is still worth opening in the shared one.
}

function writeSelfTest(code) {
  if (!options.selfTest || selfTestWritten) return;
  selfTestWritten = true;
  if (selfTestTimer) clearTimeout(selfTestTimer);
  selfTestTimer = null;
  report.finishedAt = new Date().toISOString();
  // Two windows, two definitions of working. The settings window is judged on the things that make it
  // a usable form: it loaded, it is an ordinary window (not always-on-top, not transparent), and it is
  // not trying to be the pet.
  if (options.config === true) {
    report.ok = report.errors.length === 0
      && report.checks.loaded === true
      && report.checks.configWindow === true
      && report.checks.alwaysOnTop === false
      && report.checks.transparent === false;
    try {
      fs.writeFileSync(options.selfTest, JSON.stringify(report, null, 2));
    } catch (error) {
      report.errors.push('self-test write failed: ' + error.message);
    }
    app.exit(report.ok ? 0 : 1);
    return;
  }
  report.ok = report.errors.length === 0
    && report.checks.alwaysOnTop === true
    && report.checks.clickThroughAccepted === true
    && report.checks.transparent === true
    && report.checks.petSized === true
    && report.checks.rendersPixels === true
    && report.checks.hasTransparency === true
    && report.checks.pageReady === true
    // The window taking clicks only where the pet was painted is part of what "it works" means:
    // a window that passes everything through is unusable, and one that swallows the whole screen
    // is worse.
    && report.checks.perPixelHitTest === true
    // And the right-click MENU has to take clicks as well, or a right-click would open a control surface
    // that cannot be touched.
    && report.checks.menuHitTest === true
    // And the wheel has to zoom about the cursor: a resize that walks the pet out from under the
    // pointer is what ends a zoom gesture after one step in a click-through window.
    && report.checks.wheelZoomOk === true;
  try {
    fs.writeFileSync(options.selfTest, JSON.stringify(report, null, 2));
  } catch (error) {
    report.errors.push('self-test write failed: ' + error.message);
  }
  app.exit(code);
}

/** The pet's rectangle on screen, as last reported by the page; null until it mounts. */
let petRect = null;
/** The right-click menu's rectangle in screen coordinates, while it is open. DOM, so the window holds it. */
let menuRect = null;
/** The status prompt's rectangle in screen coordinates, while the pet has something to say. Same reason. */
let statusRect = null;
/**
 * The 碎碎念 bubble's rectangle, while the pet is saying something of its own.
 *
 * The same mechanism as the prompt's — it is DOM above the pet's head, so the window has to hold it — and
 * deliberately NOT part of the interactive test: the launcher grows the window for the bubble, and the page's
 * per-pixel hit test keeps the mouse passing through it.
 */
let speechRect = null;
/** The last cursor this process saw, so a bounds change can re-send it with the new frame origin. */
let lastCursor = null;
/** Whether the cursor is on a pixel the page actually painted — the page's own verdict. */
let overPet = false;
let interacting = false;
/** True while the self-test drives the page with synthetic cursors. */
let probing = false;
/**
 * How long the window stays interactive after a wheel notch, and when that expires.
 *
 * Deliberately longer than the page's own 450 ms hold: the window must still be receiving the wheel
 * when the page is still willing to act on it, or the burst is cut at whichever boundary is shorter.
 */
const ZOOM_HOLD_MS = 700;
let zoomHoldUntil = 0;
let cursorTimer = null;
let watchdogTimer = null;
/** Page console output, kept so a silent page can be explained after the fact. */
const pageLog = [];
/** The page's frame counter as this process last saw it, for the "is it still drawing" watchdog. */
let lastSeenFrames = -1;
let stalledChecks = 0;

app.whenReady().then(async () => {
  try {
    const display = screen.getPrimaryDisplay();
    // The WORK area: the frame the pet is placed in, and the bounds its window is kept inside. The page
    // is handed this rectangle, because its placement is expressed as fractions of it.
    const bounds = display.workArea;
    report.display = { bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor };

    // Which of the two windows this process is: the screen-sized click-through pet, or an ordinary
    // settings form. Read from the argument rather than from a separate entry point, because the rest of
    // the launcher (the borrowed runtime, the watchdog, the parent-pid handshake) is identical for both.
    const isConfig = options.config === true;

    /**
     * Arm the self-test's own deadline before anything can hang.
     *
     * The pet self-test writes its report when the PAGE says it is ready; a page that never gets
     * there (a renderer that cannot get a context, a model that never resolves) leaves the window
     * and this process alive for ever. Measured twice on 2026-10-08, each time as an always-on-top
     * window the user had to get rid of by hand. A report with an error is the honest outcome.
     */
    if (options.selfTest) {
      selfTestTimer = setTimeout(() => {
        report.errors.push(`the page never reported ready within ${SELF_TEST_TIMEOUT_MS} ms`);
        writeSelfTest(1);
      }, SELF_TEST_TIMEOUT_MS);
    }

    const win = new BrowserWindow(isConfig ? {
      /**
       * The settings window: an ordinary window on purpose.
       *
       * Not transparent, not always-on-top, not click-through, resizable and focusable — it is a
       * form, not a pet. Everything the pet window needs (screen-sized, click-through except where it
       * painted, never focused) is exactly what a settings form must not be, which is why the two
       * share the launcher and nothing else.
       */
      width: 780,
      height: 860,
      minWidth: 560,
      minHeight: 420,
      title: 'vrmpet3d - model settings',
      backgroundColor: '#16171c',
      show: true,
      webPreferences: {
        /**
         * The settings page gets the SAME bridge the pet page has, and it needs it for one thing: the
         * model-import section asks for a native FILE picker (`vrmpet3d:pick-path`), which no web page can open
         * for itself. Everything else the page reads over the host's HTTP routes, exactly as before.
         */
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    } : {
      // THE PET'S OWN BOX, not the screen — this is the fix for the freeze.
      //
      // Measured on 2026-10-08 with a local reference window and screen captures: a work-area-sized
      // transparent topmost window that TAKES THE MOUSE freezes everything composed behind it for a
      // second or two (5 of 8 samples after a click on the pet; 0 of 8 with the same click on a
      // pet-sized window). The mechanism fits all three plausible explanations at once — Chromium's
      // occlusion tracker in the window underneath, DWM promoting a fullscreen-shaped layered window
      // to an overlay plane, and a screen-sized layered surface being re-uploaded every frame.
      // All three need a window that covers the screen, so the window no longer does: it is created
      // at a modest default (bottom-right of the work area) and then FOLLOWS the pet's own rectangle,
      // which the page reports on every `vrmpet3d:rect`.
      // THE PET'S OWN BOX, not the screen — the fix for the freeze.
      //
      // Measured with a local reference window and screen captures: with the ORIGINAL screen-sized window a
      // click on the pet froze everything composed behind it for a second or two (5 of 8 samples), and with
      // a pet-sized window the same click did not (0 of 8). The freeze has not been reproduced since the
      // page and the follow logic changed, so size is best treated as "what our window looked like when it
      // happened" rather than a proven cause — see HANDOFF §16, which is explicit about what is measured
      // and what is not. What IS certain: this shape is the one that never froze for the user, and it is
      // what ships.
      x: bounds.x + Math.max(0, bounds.width - DEFAULT_PET_WINDOW.width - 40),
      y: bounds.y + Math.max(0, bounds.height - DEFAULT_PET_WINDOW.height - 40),
      width: DEFAULT_PET_WINDOW.width,
      height: DEFAULT_PET_WINDOW.height,
      frame: false,
      transparent: true,
      // 'screen-saver' rather than a plain always-on-top: the plain level is still below
      // some full-screen-ish windows, which is exactly what a desk pet must not be.
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      focusable: false,
      fullscreenable: false,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    /**
     * Whether the window currently receives the mouse.
     *
     * `null` means "never set", which is not the same as `false`: the point of tracking it is to call
     * `setIgnoreMouseEvents` only when the answer CHANGES. The cursor poll runs at 60 Hz, and repeated
     * SetWindowLong-style updates on a layered window are a known source of stale hit regions — the
     * second of the three fixes the user's freeze report asks for.
     */
    let mouseThrough = null;

    /**
     * Re-assert what a screen-sized topmost window must be, whenever its interactivity changes.
     *
     * ACTIVATION is what starts the freeze: Windows re-evaluates the window's presentation path when
     * its style/layered state changes, and a window that keeps focus is the one that gets the
     * "fullscreen" treatment. `focusable: false` should already mean `WS_EX_NOACTIVATE`; `blur()` is
     * the cheap way to be certain, and re-asserting `screen-saver` after the click-through call puts
     * the window back on top, which is the one thing that API can drop.
     */
    /**
     * 视角旋转期间，这个窗口暂时允许聚焦。
     *
     * Chromium 只给**聚焦的文档**发指针锁 —— 实测（自检里的 `pointerLock` 探测）报的是
     * 「The root document of this element is not valid for pointer lock.」而这个窗口是刻意
     * `focusable: false` 的。操作者要求把窗口内桌宠的"旋转时锁住鼠标"搬到这里（2026-10-12）：
     * 「独立桌宠的旋转功能一直都异常，从来没能把鼠标真正锁住过」，而这个窗口只有宠物那么大，
     * 右拖几个像素鼠标就出窗、事件就断 —— 所以锁在这里比在主窗更重要。
     *
     * 取舍写在明处：只在这**确实开始旋转**（按住右键并移动超过阈值）时聚焦，松手立刻恢复不可聚焦并交回
     * 光标。普通右键点击永远不会碰焦点。
     */
    let orbitFocus = false;

    const keepOnTop = () => {
      if (win.isDestroyed()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      // 旋转期间不 blur：聚焦正是这次旋转要拿指针锁的条件。
      if (!orbitFocus && win.isFocused()) win.blur();
    };

    const setClickThrough = (through) => {
      if (win.isDestroyed() || mouseThrough === through) return;
      mouseThrough = through;
      if (through) win.setIgnoreMouseEvents(true, { forward: true });
      else win.setIgnoreMouseEvents(false);
      keepOnTop();
    };

    if (!isConfig) {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setIgnoreMouseEvents(true, { forward: true });
      mouseThrough = true;
      // A screen-sized transparent topmost window must never hold focus. If Windows hands it one
      // anyway, drop it immediately — this is half of the first fix.
      /**
       * 绝不持有焦点 —— **旋转期间除外**。
       *
       * 这是上一轮指针锁失败的第二个原因，而且是我漏掉的：`keepOnTop()` 里的 blur 我加了 `orbitFocus` 守卫，
       * 这个 focus→blur 的处理器却没有。于是 `win.focus()` 刚成功，这个回调立刻把焦点 blur 掉，页面里的
       * `document.hasFocus()` 一直是 false（操作者机器上的实测：`{"locked":false,"hasFocus":false}`）。
       */
      win.on('focus', () => {
        if (!win.isDestroyed() && !orbitFocus) win.blur();
      });
      report.checks.alwaysOnTop = win.isAlwaysOnTop() === true;
    } else {
      // Recorded so a self-test of the settings window can say what it is, without pretending it
      // has the pet window's properties.
      report.checks.configWindow = true;
      report.checks.alwaysOnTop = false;
      report.checks.transparent = false;
    }
    if (!isConfig) {
      report.checks.transparent = true;
      report.checks.clickThroughAccepted = true;
      // The pet window is the PET'S BOX, not the screen — and it is placed by the page's own report
      // (`vrmpet3d:rect`), so at this moment it still has its default size. What is asserted here is the
      // property that matters and that no longer depends on timing: it does NOT cover the work area.
      const actual = win.getBounds();
      report.checks.petSized = actual.width < bounds.width && actual.height < bounds.height;
      report.checks.startBounds = actual;
      report.checks.workArea = bounds;
    } else {
      // The settings window is none of those things, and it is not asked to be: a form that is
      // transparent, screen-sized or click-through would be unusable.
      report.checks.clickThroughAccepted = false;
      report.checks.petSized = false;
    }

    // A page that throws AFTER it reported ready would otherwise be invisible: the pet would
    // simply never draw. Both channels land in the report the self-test writes.
    win.webContents.on('console-message', (...args) => {
      // Electron 44 hands over ONE event object and warns about the old positional form; older
      // versions pass (event, level, message, line, source). Accepting both keeps the launcher
      // quiet on either.
      const first = args[0];
      const entry = first && typeof first === 'object' && 'message' in first
        ? { level: first.level, message: first.message, line: first.lineNumber, source: first.sourceId }
        : { level: args[1], message: args[2], line: args[3], source: args[4] };
      pageLog.push({
        level: entry.level,
        message: String(entry.message === undefined ? '' : entry.message).slice(0, 400),
        line: entry.line,
        source: entry.source,
      });
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      report.errors.push(`the page's renderer went away: ${details && details.reason}`);
    });

    /**
     * Decide, for this cursor position, whether the window should receive the mouse.
     *
     * The verdict is the PAGE's, not the launcher's: only the page knows which pixels it actually
     * painted, so `over` is a per-pixel hit test — a gap between hair strands is click-through
     * while the hair itself takes the click. The rectangle is kept for the self-test and for
     * diagnostics, and is deliberately NOT what decides this: a rectangle swallows every
     * transparent pixel inside the box, which is what the first version did wrong in both
     * directions (the whole box was retired from the user's report, and before that the whole
     * screen was).
     */
    const applyInteractivity = (cursor) => {
      if (interacting) {
        // While the user holds the pet, the window must receive moves anywhere: the pet follows
        // the cursor, so the cursor leaves the painted pixels immediately.
        setClickThrough(false);
        return;
      }
      if (Date.now() < zoomHoldUntil) {
        // And for a moment after every wheel notch: a scroll is a burst, the model turns while it
        // happens, and one pixel-less frame under the cursor would otherwise hand the rest of the
        // burst to whatever is behind the window.
        setClickThrough(false);
        return;
      }
      setClickThrough(!overPet);
      report.checks.hoverTogglesClickThrough = true;
    };

    /**
     * Tell the page where the cursor is, and where the window is.
     *
     * `frame` is load-bearing: the page positions its canvas in the VIRTUAL work-area frame it has
     * always used, so it needs the window's origin to convert that into window coordinates. The
     * window's bounds change whenever the pet is dragged, zoomed, or the menu opens — which is why
     * this rides the 60 Hz cursor stream rather than an event of its own.
     */
    const sendCursor = (cursor) => {
      if (win.isDestroyed() || !cursor) return;
      lastCursor = { x: cursor.x, y: cursor.y };
      win.webContents.send('vrmpet3d:cursor', cursorMessage(win, cursor, interacting));
    };

    /**
     * Put the window on the pet's own rectangle and tell the page where its canvas goes.
     *
     * This is the whole of the anti-freeze fix, and it is a *follow* rather than a resize: the page
     * keeps working in the virtual work-area frame it has always used (placement fractions, drag,
     * zoom anchoring, gaze), and only the window that shows the result moves and sizes itself to the
     * box the page reports — plus the right-click menu when it is open, which is DOM and therefore has
     * to be inside the window to be visible and clickable.
     *
     * `frame` is the window's origin, which the page needs because its canvas is positioned by CSS in
     * *virtual* coordinates: the canvas goes at `box.left - frame.x` inside the window.
     *
     * Called on every rect report, so it is guarded: `setBounds` only when the rectangle actually
     * changes, and by at least a pixel. A 60 Hz `setBounds` on a layered window is exactly the kind of
     * churn the click-through guard exists to avoid.
     */
    const windowRect = { left: null, top: null, width: null, height: null };
    const followPet = () => {
      if (win.isDestroyed() || !petRect || petRect.width < 1 || petRect.height < 1) return;
      const menu = menuRect && menuRect.width > 1 && menuRect.height > 1 ? menuRect : null;
      /**
       * The window holds the pet, the right-click MENU and the status prompt.
       *
       * All three are unioned rather than assumed to be inside the pet's own box, because two of them are DOM
       * that paints nothing into the framebuffer: a window sized to the pet alone clips a menu beside it and a
       * prompt above its head. The page reports both rectangles in screen coordinates precisely so this process
       * never has to guess where they are.
       */
      const status = statusRect && statusRect.width > 1 && statusRect.height > 1 ? statusRect : null;
      // ...and the 碎碎念 bubble, for exactly the same reason. It is not in the page's hit test, so the window
      // grows to SHOW it without becoming interactive over it.
      const speech = speechRect && speechRect.width > 1 && speechRect.height > 1 ? speechRect : null;
      const extras = [menu, status, speech].filter(Boolean);
      let left = petRect.left;
      let top = petRect.top;
      let right = petRect.left + petRect.width;
      let bottom = petRect.top + petRect.height;
      for (const rect of extras) {
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.left + rect.width);
        bottom = Math.max(bottom, rect.top + rect.height);
      }
      const next = {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.max(1, Math.round(right - left)),
        height: Math.max(1, Math.round(bottom - top)),
      };
      if (windowRect.left === next.left && windowRect.top === next.top
        && windowRect.width === next.width && windowRect.height === next.height) return;
      Object.assign(windowRect, next);
      // `x`/`y`, NOT `left`/`top`: Electron ignores unknown keys, so a bounds object spelled with the
      // names this process uses internally resizes the window and leaves it where it was — measured
      // 2026-10-08, and it cost a clipped canvas (`pixels.left - windowOrigin.x` came out negative).
      win.setBounds({ x: next.left, y: next.top, width: next.width, height: next.height });
      // The cursor stream carries this to the page, so a report that arrived before the bounds settled
      // does not leave the canvas a few pixels out until the next tick.
      //
      // NOT while a self-test is probing: the probe drives the page with its own synthetic cursor, and
      // re-sending the REAL one here overwrote it mid-probe — the wheel check then anchored its resize
      // at the physical mouse position and reported a drifted anchor, with every other number correct.
      if (!probing) sendCursor(lastCursor);
    };

    ipcMain.handle('vrmpet3d:config', () => ({
      modelId: options.modelId,
      assetBase: '/vrmpet3d/asset',
      // The VIRTUAL frame the page places the pet in: still the whole work area, because that is what
      // the placement fractions and the zoom ceiling are measured against. The window is only the part
      // of it the pet occupies, and `vrmpet3d:cursor` carries that window's origin to the page.
      screen: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      selfTest: Boolean(options.selfTest),
    }));
    /**
     * The import picker: a native folder dialog, answered with a path or null.
     *
     * This is the one thing a settings page cannot do for itself — a web page cannot open a native dialog, and
     * this process is the only one with an Electron to open it in. The path goes back to the PAGE, which hands it
     * to the HOST (`/vrmpet3d/models` or `/vrmpet3d/motions` depending on which section asked); the host stays the only
     * writer of every import store, and the `VRMPET3D_*_FILE` overrides the suites rely on are not bypassed.
     *
     * `kind` decides a FILE dialog from a folder one, and the title each shows. A MODEL is a FILE now (the
     * operator: 「选择VRM模型所在的文件…不再是选中一个文件夹了，万一文件夹移位了，也会出bug」), filtered to the three
     * formats the asset routes can serve; a MOTION is a FOLDER, because a pack is a folder of clips filed by
     * state and the host copies the folder.
     *
     * `defaultPath` is the user's home directory rather than a model directory: the launcher does not know where
     * models or motions live, and guessing would open the dialog somewhere surprising.
     */
    ipcMain.handle('vrmpet3d:pick-path', async (_event, options) => {
      const kind = options && typeof options === 'object' && options.kind === 'motion' ? 'motion' : 'model';
      try {
        const result = await dialog.showOpenDialog(win, kind === 'motion' ? {
          title: '导入动作目录',
          properties: ['openDirectory'],
          defaultPath: app.getPath('home'),
        } : {
          title: '导入模型文件',
          properties: ['openFile'],
          filters: [{ name: 'VRM / glTF 模型', extensions: ['vrm', 'glb', 'gltf'] }],
          defaultPath: app.getPath('home'),
        });
        if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths.length) return null;
        return result.filePaths[0];
      } catch (_error) {
        // A dialog that cannot open is not a crash: the page falls back to a typed path.
        return null;
      }
    });
    ipcMain.on('vrmpet3d:rect', (_event, rect) => {
      if (!rect || typeof rect !== 'object') return;
      petRect = {
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        width: Number(rect.width) || 0,
        height: Number(rect.height) || 0,
      };
      overPet = rect.over === true;
      /**
       * 旋转也算"正在交互"。
       *
       * 这个窗口只有宠物那么大，而 `applyInteractivity` 是按"光标是否在宠物像素上"决定穿透的 —— 旋转时鼠标
       * 必然离开宠物，于是窗口穿透、指针事件断掉、旋转停住（操作者：「旋转功能一直都异常」）。整段旋转期间保持
       * 不可穿透，指针才留得住。
       */
      interacting = rect.dragging === true || rect.orbiting === true;
      // The menu's own rectangle, in the same screen coordinates: it is DOM, so it cannot be painted into
      // the window's transparent area — the window has to grow to hold it.
      menuRect = rect.menu && typeof rect.menu === 'object'
        ? {
          left: Number(rect.menu.left) || 0,
          top: Number(rect.menu.top) || 0,
          width: Number(rect.menu.width) || 0,
          height: Number(rect.menu.height) || 0,
        }
        : null;
      // And the status prompt's, for exactly the same reason: it is DOM above the model's head, so a window
      // that were only the pet's box would clip the one thing the feature exists to show.
      statusRect = rect.status && typeof rect.status === 'object'
        ? {
          left: Number(rect.status.left) || 0,
          top: Number(rect.status.top) || 0,
          width: Number(rect.status.width) || 0,
          height: Number(rect.status.height) || 0,
        }
        : null;
      // And the 碎碎念 bubble's, on exactly the same terms — DOM above the head that the window must hold.
      speechRect = rect.speech && typeof rect.speech === 'object'
        ? {
          left: Number(rect.speech.left) || 0,
          top: Number(rect.speech.top) || 0,
          width: Number(rect.speech.width) || 0,
          height: Number(rect.speech.height) || 0,
        }
        : null;
      // Every notch produces a rect report (the page bumps `zoomSeq`), which is what refreshes the
      // hold below — the page's own wheel answer expires after 450 ms, this one after 700 ms, so the
      // window is still interactive while the page is still willing to take the notch.
      if (rect.zooming === true) zoomHoldUntil = Date.now() + ZOOM_HOLD_MS;
      followPet();
      announce();
    });
    ipcMain.on('vrmpet3d:ready', (_event, info) => {
      report.page = info || null;
      report.checks.pageReady = Boolean(info && info.webgl2);
      // One machine-readable line on stdout, which the host half relays and parses into its
      // status. Without it the host can only say "the process is running" — and a window whose
      // page never mounted looks exactly like a working one from there, which is how "I turned
      // it on and nothing happened" stayed silent.
      announce(info);
      if (options.selfTest) finishSelfTest(win);
    });
    /**
     * 开始/结束一次视角旋转 —— 页面唯一的请求，启动器负责让它成立。
     *
     * `true`：允许聚焦并把焦点给窗口，然后回一条 `vrmpet3d:orbit-focus`，页面收到后才请求指针锁
     * （请求必须发生在聚焦之后，否则 Chromium 直接拒绝 —— 上面 `pointerLock` 的实测就是这么来的）。
     * `false`：恢复 `focusable: false`、交回焦点、重新置顶，也就是这个窗口平时的样子。
     */
    /**
     * 页面请求取锁/放锁的脚本 —— 由**主进程**执行，带 `userGesture` 标记。
     *
     * 为什么不能由页面自己请求：Chromium 要求发起请求的那一刻文档既已聚焦、又处于用户激活状态，而这里的请求必须
     * 先过一次 IPC（页面 → 启动器聚焦 → 页面）—— 跨过这一步之后，页面自己发出的请求就不再被认可。操作者
     * 2026-10-12 的反馈「并没有成功，光标没有被锁住」正是这个原因，而自检里唯一稳定拿到锁的那条路径，就是主进程用
     * `userGesture: true` 替页面请求（`locked: true`，见下面的实测）。
     *
     * 取锁脚本还把 `requestPointerLock()` 的 promise **交出来**，而不是自己吞掉：它是"浏览器答复了"的时刻
     * （授予或拒绝），而不是"脚本执行了"的时刻 —— 启动器要等的正是它，才能在授权迟到（请求发出之后这次旋转已经
     * 结束）时把锁收回（见下面那个 `.then`）。返回 `undefined` 的老版 Chromium 等于"立刻答复"，判断退化成
     * "脚本已执行"，也是安全的。
     */
    const ORBIT_LOCK_JS = '(function () {'
      + ' var c = document.querySelector("canvas");'
      + ' if (!c || typeof c.requestPointerLock !== "function") return "no-canvas";'
      + ' try { var r = c.requestPointerLock(); if (r && typeof r.catch === "function") r.catch(function () {}); return r; }'
      + ' catch (error) { return String(error && error.message); }'
      + ' })()';
    /**
     * 交回光标的脚本 —— **无条件**调用 `exitPointerLock()`。
     *
     * 上一版是 `if (document.pointerLockElement) document.exitPointerLock()`，而"交回"恰恰发生在锁还在路上的
     * 时候：页面松手 → 这条 IPC → 启动器发这个脚本，而浏览器可能尚未把锁授予渲染进程（`pointerLockElement`
     * 还是 null）。那一刻这一次释放被自己的判断吞掉，锁随后落地、页面以为没有锁、启动器以为交回过了 —— 操作者
     * 的两句话就是它的两个面：「右键点击后菜单点击没反应」（点击的投递目标是那个被锁的元素，到不了菜单项）和
     * 「没有在拖动，却把右键锁住了」。规范上没锁时 `exitPointerLock()` 什么都不做，所以无条件调用是免费的。
     */
    const ORBIT_UNLOCK_JS = '(function () {'
      + ' if (typeof document.exitPointerLock === "function") document.exitPointerLock();'
      + ' return document.pointerLockElement === null;'
      + ' })()';

    /** 交回光标。旋转结束、以及授权迟到时都走这里，缺一次就是一把没人释放的锁。 */
    const releaseOrbitLock = () => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.executeJavaScript(ORBIT_UNLOCK_JS, true).catch(() => {});
      } catch (_error) { /* the window is going away */ }
    };

    ipcMain.on('vrmpet3d:orbit', (event, active) => {
      if (win.isDestroyed()) return;
      if (active) {
        orbitFocus = true;
        win.setFocusable(true);
        win.focus();
        /**
         * 聚焦之后再请求，并且晚一拍：`focus()` 到渲染进程真正成为聚焦文档之间有一个窗口消息的往返，
         * 早于此发出的请求就是那条 "not valid for pointer lock"。
         */
        setTimeout(() => {
          if (win.isDestroyed() || !orbitFocus) return;
          win.webContents.executeJavaScript(ORBIT_LOCK_JS, true).then(() => {
            /**
             * 浏览器答复时才检查"这次旋转还成立吗"。
             *
             * 页面对同一种迟到也有一道网（它的 `pointerlockchange`：锁落地时 `orbitAsked` 已是 false 就当场交回），
             * 但启动器这一侧的问题是"我请求了一把没人要的锁"，所以它自己也得能收回。两层都留着：卡住的是**全局
             * 输入状态**，一次误判就是鼠标被扣住，不值得只靠一层。
             */
            if (!orbitFocus) releaseOrbitLock();
          }).catch(() => { /* 被拒或页面正在退出：没有锁要交回 */ });
        }, 30);
        return;
      }
      orbitFocus = false;
      win.setFocusable(false);
      if (win.isFocused()) win.blur();
      win.setAlwaysOnTop(true, 'screen-saver');
      releaseOrbitLock();
    });
    ipcMain.on('vrmpet3d:quit', () => app.quit());
    win.on('closed', () => app.quit());

    // The cursor is read from the OS rather than from page events: a click-through window
    // receives no pointer events at all outside the pet, so events cannot drive the gaze,
    // and polling also tells us when to stop being click-through.
    //
    // None of that applies to the settings window: it is an ordinary window that receives its own
    // events, so polling the cursor would only add a timer whose answer nothing consumes — and
    // `applyInteractivity` would make a settings form click-through, which is the opposite of usable.
    if (!isConfig) cursorTimer = setInterval(() => {
      if (win.isDestroyed()) return;
      // The self-test drives the page with synthetic cursors; a real one arriving between them
      // would overwrite the answer being measured.
      if (probing) return;
      const cursor = screen.getCursorScreenPoint();
      applyInteractivity(cursor);
      sendCursor(cursor);
    }, Math.max(4, Math.round(1000 / CURSOR_HZ)));

    if (!options.url) throw new Error('no --url given');
    await win.loadURL(options.url);
    report.checks.loaded = true;

    /**
     * Watch whether the PAGE is still drawing, and say so when it stops.
     *
     * A single throw inside the page's frame loop ends the loop: the window stays open, the last
     * rectangle stays reported, and from the outside it is indistinguishable from a pet that is simply
     * not painted — which is exactly how "I turned it on and nothing happened" stayed silent the first
     * time. The page publishes its frame count and its last error; this asks for them every two
     * seconds and reports a stalled loop as an error the host and the page's own note can show.
     */
    if (!isConfig) setInterval(async () => {
      if (win.isDestroyed() || probing) return;
      const state = await readPageState(win);
      lastPageState = state || lastPageState;
      if (!state || typeof state.frames !== 'number') {
        // No state object at all: the page's mount never got as far as publishing, which is a
        // different fault from a loop that stopped, and worth saying out loud.
        if (!report.errors.some((entry) => entry.startsWith('the page never published'))) {
          report.errors.push('the page never published its state: the frame loop did not start');
        }
        announce();
        return;
      }
      if (state.frames > lastSeenFrames) {
        lastSeenFrames = state.frames;
        stalledChecks = 0;
        announce();
        return;
      }
      stalledChecks += 1;
      // Three checks with no new frame: the loop is gone, not slow.
      if (stalledChecks === 3) {
        const reason = state.lastError ? `: ${state.lastError}` : '';
        if (!report.errors.some((entry) => entry.startsWith('the page stopped drawing'))) {
          report.errors.push(`the page stopped drawing at frame ${state.frames}${reason}`);
        }
      }
      announce();
    }, 2000);

    /**
     * The settings window writes its self-test HERE, not on a message from the page.
     *
     * The pet page drives its own readiness through the preload bridge, which is what the pet self-test
     * waits for. The settings page reads everything it shows over the host's HTTP routes and announces
     * nothing of its own — the bridge it now has exists for the path picker (`vrmpet3d:pick-path`) — so
     * waiting for a message it will never send is how the first version of this mode produced no report at
     * all. The delay is for the page's own fetches, and any error it throws in the meantime is already
     * captured through the console relay.
     */
    if (isConfig && options.selfTest) {
      setTimeout(() => finishSelfTest(win), 1500);
    }
  } catch (error) {
    report.errors.push('launcher failed: ' + (error && error.message));
    writeSelfTest(1);
    app.quit();
  }
});

/**
 * Prove the window really is what it claims, then exit.
 *
 * Used by `scripts/verify-desktop.mjs`, which is the only automated check of the real
 * launcher: the page is asked for pixels (`capturePage`) and the alpha channel is counted,
 * because "transparent: true was accepted" is not evidence of anything.
 */
async function finishSelfTest(win) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    const bitmap = image.toBitmap(); // BGRA
    let opaque = 0;
    let translucent = 0;
    let clear = 0;
    for (let i = 3; i < bitmap.length; i += 4) {
      const alpha = bitmap[i];
      if (alpha === 0) clear += 1;
      else if (alpha === 255) opaque += 1;
      else translucent += 1;
    }
    report.checks.capture = {
      size: size,
      pixels: bitmap.length / 4,
      opaquePixels: opaque,
      translucentPixels: translucent,
      transparentPixels: clear,
    };
    report.checks.rendersPixels = opaque + translucent > 500;
    report.checks.hasTransparency = clear > 500;
    /**
     * The screenshot, beside the report.
     *
     * Pixel COUNTS prove that something was drawn; "the transparent parts of the clothes are black" is a
     * claim about a picture, and the only thing that can settle it is the picture. Written next to the
     * report so a probe leaves evidence a person can open, and taken BEFORE the synthetic cursors below so
     * what is on disk is the pet at rest rather than mid-throw.
     */
    try {
      const pngPath = options.selfTest.replace(/\.json$/i, '') + '.png';
      fs.writeFileSync(pngPath, image.toPNG());
      report.checks.captureFile = pngPath;
    } catch (error) {
      report.errors.push('the capture could not be written: ' + error.message);
    }
    // What the CANVAS holds, independently of what the window composited. If these two disagree,
    // the fault is compositing; if the canvas is empty as well, nothing was drawn at all.
    try {
      const raw = await win.webContents.executeJavaScript('JSON.stringify(window.__VRMPET3D_DESKTOP_SCAN__ ? window.__VRMPET3D_DESKTOP_SCAN__() : null)');
      report.checks.canvasPixels = raw ? JSON.parse(raw) : null;
    } catch (error) {
      report.errors.push('the canvas could not be scanned: ' + error.message);
    }
    /**
     * The RENDERER's pixels, as a file.
     *
     * `capturePage()` above goes through window compositing, and a transparent always-on-top window can come
     * back empty (measured: 353 430 pixels all fully transparent while the canvas held 58 938 painted ones).
     * This asks the page for its own framebuffer instead — the only image that can settle a report about how
     * something LOOKS — and the page composites it over grey, so "transparent" and "black" are different
     * pixels in the file.
     */
    try {
      const raw = await win.webContents.executeJavaScript(
        'JSON.stringify(window.__VRMPET3D_DESKTOP_SNAPSHOT__ ? (function () {'
        + ' var shot = window.__VRMPET3D_DESKTOP_SNAPSHOT__(); var png = shot && shot.png;'
        + ' if (shot) { shot.png = null; } return { fact: shot, png: png }; }()) : null)',
      );
      const shot = raw ? JSON.parse(raw) : null;
      if (shot && shot.png) {
        const pngPath = options.selfTest.replace(/\.json$/i, '') + '-canvas.png';
        fs.writeFileSync(pngPath, Buffer.from(String(shot.png).split(',')[1], 'base64'));
        report.checks.canvasFile = pngPath;
      }
      report.checks.canvasImage = shot ? shot.fact : null;
    } catch (error) {
      report.errors.push('the canvas image could not be written: ' + error.message);
    }
    /**
     * And the same picture under a few deliberate changes, because ONE image cannot say WHICH material painted
     * something: `no-outline` (three-vrm draws each MToon surface twice — the second is an inverted-hull
     * outline, and a cut-out the outline pass still draws is how a see-through garment turns black),
     * `alpha-test-0` (does the cut-out depend on the mask at all), `only-cloth` (is the black even the dress),
     * and `as-loaded` to put visibility back.
     */
    for (const label of ['as-loaded', 'only-cloth', 'alpha-test-2', 'force-define']) {
      try {
        const raw = await win.webContents.executeJavaScript(
          'globalThis.__VRMPET3D_DESKTOP_VARIANT__ ? globalThis.__VRMPET3D_DESKTOP_VARIANT__(' + JSON.stringify(label) + ') : null',
        );
        const shot = raw ? JSON.parse(raw) : null;
        if (!shot) continue;
        const pngPath = options.selfTest.replace(/\.json$/i, '') + '-' + label + '.png';
        if (shot.png) fs.writeFileSync(pngPath, Buffer.from(String(shot.png).split(',')[1], 'base64'));
        report.checks['variant_' + label.replace(/-/g, '_')] = {
          file: pngPath,
          painted: shot.painted,
          black: shot.black,
          average: shot.average,
        };
      } catch (error) {
        report.errors.push('variant ' + label + ' failed: ' + error.message);
      }
    }
    report.checks.bounds = win.getBounds();
    report.checks.petRect = petRect;
    // What the PAGE thinks is happening. Without it, "the window opened but nothing is drawn"
    // is indistinguishable from "the page never ran a second frame".
    try {
      // Two pages, two state objects. The pet page publishes its frames and hit test; the settings page
      // publishes what it rendered (how many expressions and spring chains it found in the model), which
      // is the only way a test can tell "the window opened" from "the window has something in it".
      const globalName = options.config === true ? '__VRMPET3D_CONFIG_STATE__' : '__VRMPET3D_DESKTOP_STATE__';
      const readState = async () => {
        const raw = await win.webContents.executeJavaScript(
          'JSON.stringify(globalThis.' + globalName + ' || null)',
        );
        return raw ? JSON.parse(raw) : null;
      };
      const first = await readState();
      report.pageState = first;
    } catch (error) {
      report.errors.push('the page state could not be read: ' + error.message);
    }
    // The pet probes only make sense for the pet: a settings window has no canvas to hit-test and no
    // wheel-to-zoom to measure, and asking would fill the report with errors about a page that is
    // behaving exactly as designed.
    if (options.config !== true) {
      await probeHitTest(win);
      await probeWheel(win);
    } else {
      /**
       * The 部位 probe runs on the page this window was opened with (the model's), because 部位 is one of the
       * sections that lives there — the navigation below would leave it looking at a page without a part table.
       * The 状态与动作 clip picker lives on the OTHER page, so its probe is injected by `probeOtherPage` after
       * the route swap (see `extraScripts` there).
       */
      await probePartsEditor(win);
      await probeOtherPage(win, report);
    }
  } catch (error) {
    report.errors.push('self-test capture failed: ' + (error && error.message));
  }
  if (pageLog.length) report.pageLog = pageLog.slice(-20);
  writeSelfTest(report.ok === false ? 1 : 0);
}

/**
 * Read the OTHER settings page, and merge the two readouts into one.
 *
 * The settings window is TWO PAGES since 2026-10-11 (`/vrmpet3d/config` for 模型参数 and `/vrmpet3d/global` for 通用设置,
 * operator: "模型参数和通用设置（原总设置）是两个单独的页面"), and a self-test that visited only the page it was
 * launched on would leave half the settings unproven — including every control that lives on the other one. So
 * the window is NAVIGATED to its sibling PAGE (the route, not a query parameter) and read again.
 *
 * The merge is KEYED, not naive: each page runs the same script and publishes the same shape, so a page reports
 * 0/null for the sections it does not carry, and a shallow spread would overwrite the other page's real
 * `speech.stateRows === 6` with this one's 0. The sibling page's own keys win where a section lives there;
 * everything else comes from the page the window opened with.
 *
 * `sizes` and `wind` are in the second list for a reason worth naming: 大小/悬浮窗大小 and the four 鼠标互动
 * controls are sections of the 通用设置 page, so the model page reports `sizes.controls === false` and
 * `wind.rows === 0` — the same "0 for a section I do not carry" shape as above. The model page's own reading of
 * them is kept in `modelPage`, so nothing is thrown away by preferring the page that draws them.
 */
/**
 * Navigate the settings window to its SIBLING page and hand back the state it publishes.
 *
 * Split out of `probeOtherPage` because two things need the other page: reading its published state (the merge
 * below) and driving the 状态与动作 clip picker, whose box sets live only there. Reading it requires the page to
 * have published, so this also waits the moment the page needs.
 */
async function readOtherPageState(win, report) {
  const first = report.pageState;
  if (!first || first.page !== 'model') return { state: null, error: null };
  const current = win.webContents.getURL();
  /**
   * SWAP THE ROUTE rather than rewriting a string that may not be there.
   *
   * The launcher's own URLs name the page they open (`/vrmpet3d/config`, `/vrmpet3d/global`), but a self-test
   * (and the desktop suite) may open the page directly — so this reads the URL's own path and changes only that.
   * The first version of this replaced a `?panel=` query parameter that a URL without it never had, which
   * silently skipped the second reading and proved nothing; a route swap cannot go missing while the first page
   * is the one it was read from.
   */
  const target = (function () {
    try {
      const url = new URL(current);
      url.pathname = first.page === 'model' ? '/vrmpet3d/global' : '/vrmpet3d/config';
      // The model is a 模型参数 parameter: it must not ride along to the page that has no model picker.
      if (url.pathname === '/vrmpet3d/global') url.searchParams.delete('model');
      return url.toString();
    } catch (_error) {
      return current;
    }
  })();
  if (target === current) return { state: null, error: null };
  await win.loadURL(target);
  // The page publishes on its first settings snapshot; a moment here beats reading a half-built DOM.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const raw = await win.webContents.executeJavaScript(
    'JSON.stringify(globalThis.__VRMPET3D_CONFIG_STATE__ || null)',
  );
  const state = raw ? JSON.parse(raw) : null;
  if (!state) {
    report.errors.push('the 通用设置 page could not be read after navigating to it');
    return { state: null, error: 'not readable' };
  }
  return { state, error: null };
}

async function probeOtherPage(win, report) {
  const GLOBAL_KEYS = ['speech', 'import', 'motionImport', 'gaze', 'motions', 'sizes', 'wind'];
  try {
    const first = report.pageState;
    if (!first || first.page !== 'model') return;
    const globalState = (await readOtherPageState(win, report)).state;
    if (!globalState) return;
    /**
     * AND THE CLIP PICKER IS DRIVEN HERE, on this page, which is the whole reason it exists.
     *
     * Operator report, 2026-10-12: "最后一项 idle/touch hair2.vrma 无法选中". `onMotionToggle` collected every
     * checked checkbox in the state's row, including each ticked clip's 凝视 switch — and a checkbox written
     * without a `value` attribute has the DOM default `'on'`, so a tick stored `on` as a clip id. Those junk
     * entries took slots in the per-state list and the clip the operator had just ticked was the one dropped.
     * The ids reach the host as a perfectly valid POST, so only the page itself can be asked.
     */
    await probeMotionPicker(win);
    const merged = Object.assign({}, first);
    for (const key of GLOBAL_KEYS) {
      if (globalState[key] !== undefined) merged[key] = globalState[key];
    }
    merged.page = globalState.page;
    merged.pages = [first.page, globalState.page];
    merged.modelPage = first;
    merged.globalPage = globalState;
    report.pageState = merged;
  } catch (error) {
    report.errors.push('the 通用设置 page could not be read: ' + (error && error.message));
  }
}

/**
 * Drive the 部位 editor the way a user does, and report what the PAGE did with it.
 *
 * The settings window's self-test reads what the page rendered, which answers "the section is there" and nothing
 * about "the section works": a button that does nothing, a structure box that drops what was typed and a chip
 * whose mode toggle does not toggle all publish exactly the same counts. So this performs the four gestures in
 * order — 新增部位, type a structure and commit it, flip its match mode, remove the chip — and re-READS the page
 * state between them, because the page repaints the whole table on every change (a reference held across one is
 * stale, which is what the first version of this probe tripped over).
 *
 * Nothing here is asserted: the numbers travel to `scripts/verify-desktop.mjs`, where the suite decides.
 */
async function probePartsEditor(win) {
  try {
    /**
     * The script is a FILE, not a template literal in this one.
     *
     * It used to be inline, and twice a stray backtick in a comment ended the literal early — which does not fail
     * a test, it breaks the LAUNCHER: `main.js` stops parsing, so the floating window cannot open and the only
     * symptom is an error dialog. Read from disk, the hazard is gone by construction, and the suite can
     * `node --check` the file before it spawns anything.
     */
    const script = fs.readFileSync(path.join(__dirname, 'probe-parts-editor.js'), 'utf8');
    const raw = await win.webContents.executeJavaScript(script);
    report.partsEdit = raw ? JSON.parse(raw) : null;
  } catch (error) {
    report.errors.push('the 部位 editor could not be driven: ' + (error && error.message));
  }
}

/**
 * Drive the 状态与动作 clip picker, and report what it collected.
 *
 * Same file-not-literal rule as `probePartsEditor` above, and the same reason: a broken template literal in
 * `main.js` breaks the launcher rather than a test. The probe ticks the last clip in 空闲 and reports what the
 * page thinks is selected against what the core will keep, which is the pair that exposes a junk clip id.
 */
async function probeMotionPicker(win) {
  try {
    const script = fs.readFileSync(path.join(__dirname, 'probe-motion-picker.js'), 'utf8');
    const raw = await win.webContents.executeJavaScript(script);
    report.motionPick = raw ? JSON.parse(raw) : null;
  } catch (error) {
    report.errors.push('the clip picker could not be driven: ' + (error && error.message));
  }
}

/**
 * Prove the per-pixel hit test without a mouse.
 *
 * The policy under test — "clicks land only on pixels we painted" — cannot be checked by moving a
 * real cursor from a script, so the launcher drives the page with synthetic cursor positions
 * instead: several points inside the pet's box, and one far away. The page answers with its own
 * verdict for each, and the two assertions that matter follow: at least one point inside the box IS
 * painted (the pet takes clicks somewhere) and the far point is not (the transparent desktop passes
 * them through). The real cursor stream is paused for the duration, or it would overwrite the
 * answers being measured.
 */
async function probeHitTest(win) {
  if (!petRect || petRect.width <= 0 || petRect.height <= 0) {
    report.checks.perPixelHitTest = false;
    report.errors.push('the pet never reported a rectangle, so its hit area could not be probed');
    return;
  }
  probing = true;
  try {
    const fractions = [[0.5, 0.5], [0.5, 0.62], [0.42, 0.55], [0.58, 0.55], [0.5, 0.8]];
    const answers = [];
    for (const [fx, fy] of fractions) {
      const point = {
        x: petRect.left + Math.round(petRect.width * fx),
        y: petRect.top + Math.round(petRect.height * fy),
      };
      win.webContents.send('vrmpet3d:cursor', cursorMessage(win, point, false));
      await new Promise((resolve) => setTimeout(resolve, 140));
      // The page's own numbers for this probe, not only its verdict: "no clicks land on the pet"
      // is indistinguishable from "the readback found a transparent pixel" without them, and the
      // two have different causes.
      let detail = null;
      try {
        const raw = await win.webContents.executeJavaScript('JSON.stringify(window.__VRMPET3D_DESKTOP_STATE__ || null)');
        const snapshot = raw ? JSON.parse(raw) : null;
        detail = snapshot ? { lastHit: snapshot.lastHit, hitReads: snapshot.hitReads, over: snapshot.over } : null;
      } catch (_error) {
        detail = null;
      }
      answers.push({ at: [fx, fy], over: overPet, detail: detail });
    }
    // Far outside the pet: the top-left of the screen, where nothing is drawn.
    win.webContents.send('vrmpet3d:cursor', cursorMessage(win, { x: 4, y: 4 }, false));
    await new Promise((resolve) => setTimeout(resolve, 140));
    const overFar = overPet;
    const insidePainted = answers.filter((answer) => answer.over).length;
    report.checks.hitTest = { inside: answers, insidePainted: insidePainted, overFar: overFar };
    report.checks.perPixelHitTest = insidePainted > 0 && overFar === false;

    /*
     * The right-click MENU is DOM, not canvas, so it has its own path into the hit test: none of its pixels
     * are in the framebuffer, and if the page did not answer for its rectangle too the menu would be
     * click-through and unusable. Opened through the page's own hook — which places it at the pet's centre,
     * because a script cannot move a real mouse — and probed with a synthetic cursor on it.
     */
    let menuBoxRect = null;
    let overMenu = null;
    try {
      await win.webContents.executeJavaScript('window.__VRMPET3D_DESKTOP_MENU__ && window.__VRMPET3D_DESKTOP_MENU__(true)');
      await new Promise((resolve) => setTimeout(resolve, 200));
      const raw = await win.webContents.executeJavaScript('JSON.stringify(window.__VRMPET3D_DESKTOP_STATE__ || null)');
      const snapshot = raw ? JSON.parse(raw) : null;
      const origin = (snapshot && snapshot.screen) || { x: 0, y: 0 };
      const box = snapshot && snapshot.menu ? snapshot.menu.rect : null;
      // The page reports the menu in VIRTUAL frame coordinates; this process needs it in screen
      // coordinates, the same system every `vrmpet3d:rect` arrives in, because `followPet` sizes the
      // window to hold it.
      menuBoxRect = box
        ? {
          left: origin.x + Number(box.left || 0),
          top: origin.y + Number(box.top || 0),
          width: Number(box.width || 0),
          height: Number(box.height || 0),
        }
        : null;
      if (menuBoxRect) {
        win.webContents.send('vrmpet3d:cursor', cursorMessage(win, {
          x: menuBoxRect.left + Math.round(menuBoxRect.width / 2),
          y: menuBoxRect.top + Math.round(menuBoxRect.height / 2),
        }, false));
        await new Promise((resolve) => setTimeout(resolve, 160));
        overMenu = overPet;
      }
      report.checks.menu = {
        open: Boolean(snapshot && snapshot.menu && snapshot.menu.open),
        rect: menuBoxRect,
        overMenu: overMenu,
        /**
         * Whether the page built that menu from the SHARED module (`lib/menu.js`) rather than from markup of
         * its own. Recorded because the failure is silent in the other direction: a page whose menu module never
         * loaded still opens *something* — or, as the panel did once, throws deep inside a click — and only this
         * flag says the right code is behind the rectangle.
         */
        module: Boolean(snapshot && snapshot.menu && snapshot.menu.module),
      };
      report.checks.menuHitTest = Boolean(menuBoxRect) && overMenu === true;
    } catch (error) {
      report.checks.menuHitTest = false;
      report.errors.push('the right-click menu could not be probed: ' + error.message);
    } finally {
      try {
        await win.webContents.executeJavaScript('window.__VRMPET3D_DESKTOP_MENU__ && window.__VRMPET3D_DESKTOP_MENU__(false)');
      } catch (_error) {
        // Closing it is tidiness; the window is about to exit either way.
      }
    }
  } catch (error) {
    report.errors.push('the hit test could not be probed: ' + error.message);
  } finally {
    probing = false;
  }

  /**
   * 独立桌宠的旋转到底能不能锁住光标 —— 走**生产路径**实测，因为上一版测错了地方。
   *
   * 上一版由主进程直接 `executeJavaScript(requestPointerLock, true)`，于是它成功了，而生产里页面自己发的请求
   * 失败 —— 操作者 2026-10-12：「并没有成功，光标没有被锁住」。差别就在那个 `userGesture` 标记，以及请求发出时
   * 文档是否已经聚焦。所以这次从页面自己的桥接口出发：`vrmpet3dDesktop.orbit(true)` → preload → 本进程的
   * `vrmpet3d:orbit` 处理（设为可聚焦、聚焦、用 `userGesture` 请求锁）→ 回读 `document.pointerLockElement`，
   * 再 `orbit(false)` 并确认锁被放开。这就是页面在生产里走的每一个环节。
   */
  try {
    const measured = await win.webContents.executeJavaScript(`(function () {
      if (!window.vrmpet3dDesktop || typeof window.vrmpet3dDesktop.orbit !== 'function') {
        return Promise.resolve({ noBridge: true });
      }
      window.vrmpet3dDesktop.orbit(true);
      return new Promise(function (resolve) {
        setTimeout(function () {
          var canvas = document.querySelector('canvas');
          var locked = document.pointerLockElement === canvas;
          var hasFocus = document.hasFocus();
          window.vrmpet3dDesktop.orbit(false);
          setTimeout(function () {
            resolve({
              supported: true,
              locked: locked,
              hasFocus: hasFocus,
              releasedAfter: document.pointerLockElement === null,
            });
          }, 250);
        }, 400);
      });
    })()`, true);
    report.checks.pointerLock = measured;
    report.checks.pointerLockOrbit = Boolean(measured) && measured.locked === true;
  } catch (error) {
    report.checks.pointerLock = { error: String(error && error.message) };
    report.checks.pointerLockOrbit = false;
  }

  /**
   * 真正要断言的那件事：**右键拖动时，视角跟着走。**
   *
   * 上一版把断言押在"窗口能不能拿到指针锁"上，而操作者机器上的实测是
   * `{"locked":false,"hasFocus":false}` —— Windows 的前台窗口规则不允许这个刻意不聚焦的窗口抢焦点，所以锁根本
   * 拿不到。机制不可靠，**能看见的行为**才是要钉住的：按下右键、把指针移到远离宠物的位置，视角必须继续转；松开
   * 之后旋转必须结束。
   *
   * 这里用 `sendInputEvent` 发真实的鼠标事件（和滚轮探测同一条路），坐标逐步远离宠物中心 —— 覆盖"光标离开宠物
   * 像素"这一段，也就是窗口此前会立刻穿透、指针事件断掉的那一段。
   */
  try {
    const view = async () => JSON.parse(
      (await win.webContents.executeJavaScript('JSON.stringify((window.__VRMPET3D_DESKTOP_STATE__ || {}).view || null)')) || 'null',
    );
    /**
     * `sendInputEvent` 的坐标是**窗口客户区**坐标，不是屏幕坐标 —— 第一版把页面上报的屏幕矩形直接喂了进去，
     * 事件落在窗口之外、没有目标，于是"视角没转"看起来像功能坏了。中心点因此从页面自己的 DOM 里问。
     */
    const box = JSON.parse((await win.webContents.executeJavaScript(
      'JSON.stringify((function () { var c = document.querySelector("canvas"); if (!c) return null;'
        + ' var r = c.getBoundingClientRect();'
        + ' return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })())',
    )) || 'null');
    if (!box) throw new Error('the page has no canvas to right-drag');
    const centre = { x: Math.round(box.x), y: Math.round(box.y) };
    const radius = Math.max(6, Math.round(Math.min(box.w, box.h) / 6));
    const before = await view();
    win.webContents.sendInputEvent({ type: 'mouseDown', x: centre.x, y: centre.y, button: 'right', clickCount: 1 });
    // 三段移动，一段比一段远：出宠物中心、出宠物像素、贴近窗口边缘。
    const path = [
      { x: centre.x + radius, y: centre.y + Math.round(radius / 2) },
      { x: centre.x + radius * 2, y: centre.y + radius },
      { x: centre.x + radius * 3, y: centre.y + Math.round(radius * 1.5) },
    ];
    for (const at of path) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x), y: Math.round(at.y), button: 'right' });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const turned = await view();
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(path[path.length - 1].x), y: Math.round(path[path.length - 1].y), button: 'right', clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const after = JSON.parse(
      (await win.webContents.executeJavaScript('JSON.stringify(window.__VRMPET3D_DESKTOP_STATE__ || null)')) || 'null',
    );
    const yawMoved = Boolean(before && turned) && Math.abs(turned.yaw - before.yaw) > 1e-6;
    const stoppedAfterRelease = Boolean(after) && after.rect && after.rect.orbiting === false;
    report.checks.orbit = { before: before && before.yaw, during: turned && turned.yaw, yawMoved: yawMoved, stoppedAfterRelease: stoppedAfterRelease };
    report.checks.orbitFollowsThePointer = yawMoved && stoppedAfterRelease;
  } catch (error) {
    report.checks.orbit = { error: String(error && error.message) };
    report.checks.orbitFollowsThePointer = false;
  } finally {
    // 立刻恢复这个窗口平时的样子：不可聚焦、不持有焦点、置顶。
    try {
      win.setFocusable(false);
      if (win.isFocused()) win.blur();
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch (_error) { /* the window is about to exit */ }
  }
}

/**
 * Prove the wheel in the real window, with a real wheel event.
 *
 * `sendInputEvent` puts a wheel event into the renderer the way a mouse would, so this exercises the
 * whole path — the page's wheel listener, the anchored resize, and the rect report that refreshes the
 * launcher's interactivity hold. It also measures the two things the user asked for: the size grows,
 * and the point under the cursor stays put (the pet is not walked out from under the pointer).
 */
async function probeWheel(win) {
  if (!petRect || petRect.width <= 0 || petRect.height <= 0) {
    report.checks.wheelZoom = false;
    report.errors.push('the pet never reported a rectangle, so the wheel could not be probed');
    return;
  }
  probing = true;
  try {
    // Park the pet where a resize has room to grow. The probe measures whether the point under the
    // cursor STAYS PUT during the resize, and a pet sitting against the frame's edge has that answer
    // bent by the frame's own clamp — which made this check depend on where the operator's last drag
    // left the pet (it went red on 2026-10-08 for exactly that reason, with every number correct).
    try {
      await win.webContents.executeJavaScript(
        'globalThis.__VRMPET3D_DESKTOP_PLACE__ && globalThis.__VRMPET3D_DESKTOP_PLACE__(0.35, 0.35)',
      );
      await new Promise((resolve) => setTimeout(resolve, 220));
    } catch (_error) {
      // The probe still runs; only the anchor half of it is affected.
    }
    const before = await readPageState(win);
    if (!before) throw new Error('the page state could not be read');
    const sizeBefore = before.placement ? before.placement.width : null;
    /**
     * A point on the pet — found by ASKING the page, not by dividing the box.
     *
     * This used to be a fixed 30 % / 70 % of the box, which was painted when the built-in procedural avatar
     * filled its box and is NOT painted on a humanoid VRM, whose silhouette is narrower than the box. The
     * operator removed that avatar on 2026-10-10, and the very next run reported `wheelZoomOk=false` with every
     * number correct — because the cursor was over empty space and the window, by design, ignores a wheel that
     * is not over painted pixels. So the candidates are tried in order and the page's own hit test picks one.
     */
    const candidates = [[0.5, 0.5], [0.5, 0.62], [0.5, 0.38], [0.35, 0.5], [0.65, 0.5], [0.3, 0.7]];
    let at = null;
    for (const [across, down] of candidates) {
      const probe = {
        x: petRect.left + Math.round(petRect.width * across),
        y: petRect.top + Math.round(petRect.height * down),
      };
      win.webContents.send('vrmpet3d:cursor', cursorMessage(win, probe, false));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const state = await readPageState(win);
      // overModel is the page's own hit test against PAINTED PIXELS, which is exactly the question being
      // asked; it lives under hit in the published state.
      if (state && state.hit && state.hit.overModel === true) { at = probe; break; }
    }
    if (!at) {
      // Nothing painted anywhere the candidates look: say so rather than reporting a wheel failure.
      throw new Error('no painted point could be found on the pet to aim the wheel at');
    }
    win.webContents.send('vrmpet3d:cursor', cursorMessage(win, at, false));
    await new Promise((resolve) => setTimeout(resolve, 140));
    const acrossBefore = (at.x - petRect.left) / petRect.width;
    const downBefore = (at.y - petRect.top) / petRect.height;

    for (let notch = 0; notch < 3; notch += 1) {
      // `sendInputEvent` takes WINDOW coordinates, and this process knows the window's origin exactly,
      // so ask IT rather than the page's cached `windowOrigin`: while a probe runs the cursor stream is
      // paused, so the page's copy is stale and the injected point landed outside the window — the
      // notch was dropped and the check reported "the wheel does nothing".
      const origin = win.isDestroyed() ? { x: 0, y: 0 } : win.getBounds();
      win.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: at.x - origin.x,
        y: at.y - origin.y,
        deltaY: 120,
        canScroll: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    const after = await readPageState(win);
    if (!after) throw new Error('the page state could not be read after the notches');
    const rectAfter = after.rect || petRect;
    const acrossAfter = rectAfter.width ? (at.x - rectAfter.left) / rectAfter.width : null;
    const downAfter = rectAfter.height ? (at.y - rectAfter.top) / rectAfter.height : null;
    report.checks.wheelZoom = {
      sizeBefore: sizeBefore,
      sizeAfter: after.placement ? after.placement.width : null,
      anchor: at,
      relativeBefore: [Number(acrossBefore.toFixed(4)), Number(downBefore.toFixed(4))],
      relativeAfter: [Number((acrossAfter || 0).toFixed(4)), Number((downAfter || 0).toFixed(4))],
      zoomingReported: Boolean(after.zoomHolding),
      stillOver: overPet,
    };
    const grew = report.checks.wheelZoom.sizeAfter > report.checks.wheelZoom.sizeBefore;
    /**
     * What has to hold in the real window.
     *
     * The pet is parked on the bottom of the work area, so the vertical anchor CANNOT be honoured
     * exactly: keeping the point under the cursor still would push the box's bottom below the screen,
     * and the clamp wins. That is the documented edge case, and the property that actually matters is
     * the one measured here — the cursor is still on the pet after the notches, so the next notch
     * still reaches it. The exact anchoring is asserted on a placement with room around it, in the
     * core suite, where the clamp cannot interfere.
     */
    const drift = (beforeValue, afterValue) => (afterValue === null ? 1 : Math.abs(afterValue - beforeValue));
    const anchored = acrossAfter !== null && downAfter !== null && drift(acrossBefore, acrossAfter) < 0.05
      && drift(downBefore, downAfter) < 0.15;
    report.checks.wheelZoomOk = grew && anchored && overPet === true;
  } catch (error) {
    report.checks.wheelZoomOk = false;
    report.errors.push('the wheel could not be probed: ' + error.message);
  } finally {
    probing = false;
  }
}

/** Where the PAGE got to, readable even when it never published a state at all. */
let lastPageDiagnostics = null;

/** The page's own account of itself, as an object, or null. */
async function readPageState(win) {
  try {
    /**
     * …and WHY it might have none, read from the window itself rather than from the page's script.
     *
     * The page's inline glue returns silently when the preload BRIDGE is missing (`if (!bridge) return;`) and never calls
     * `bridge.ready` when `config()` does not resolve — and both leave `__VRMPET3D_DESKTOP_STATE__` ABSENT: no pet, no error, and a
     * status line repeating the last good frames. That is what the operator's window did on 2026-10-15 while a window this session
     * launched by hand worked.
     *
     * The four reads below are deliberately INDEPENDENT of the page's own script: the bridge, the sources' global, and the page's
     * `document.title` (which the glue advances one step at a time) all answer even when the glue returned early. They are kept in
     * `lastPageDiagnostics` instead of being returned, because the caller wants the page STATE — and dropping them whenever there is
     * no state is exactly how the first version of this measurement managed to tell us nothing at all.
     */
    const raw = await win.webContents.executeJavaScript(
      'JSON.stringify({'
      + 'state: window.__VRMPET3D_DESKTOP_STATE__ || null,'
      + 'bridge: typeof window.vrmpet3dDesktop === "object" && window.vrmpet3dDesktop !== null,'
      + 'sources: Boolean(globalThis.__VRMPET3D_DESKTOP__),'
      + 'title: String(document.title || ""),'
      + '})',
    );
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed) return null;
    lastPageDiagnostics = {
      bridge: parsed.bridge === true,
      sources: parsed.sources === true,
      title: parsed.title || null,
    };
    return parsed.state;
  } catch (error) {
    lastPageDiagnostics = {
      bridge: null,
      sources: null,
      title: null,
      readError: String(error && error.message ? error.message : error),
    };
    return null;
  }
}

/**
 * Quit when the process that started us is gone.
 *
 * The host half kills this window on dispose, but a host that is killed rather than disposed
 * would otherwise leave a pet floating over the desktop with nothing left to control it.
 */
function startWatchdog() {
  if (!options.parentPid) return;
  watchdogTimer = setInterval(() => {
    try {
      process.kill(options.parentPid, 0);
    } catch (_error) {
      app.quit();
    }
  }, WATCHDOG_MS);
}

/**
 * The page's last published state, kept so `announce` can report the motion without being async.
 *
 * The watchdog reads it every two seconds anyway; the status line is written far more often than that, and
 * making the announcement await a page read would turn a status line into a round trip.
 */
let lastPageState = null;

/**
 * The page's last READY report, kept because the watchdog announces without one.
 *
 * The page reports once, through `bridge.ready(info)`, and that is the only payload that can say `ready: true`. Every two seconds the
 * watchdog announces again for its own reasons and has no `info` — and `announce()` used to fall back to `report.page`, which is the
 * SELF-TEST's page and is null in a normal window. So a mounted, rendering pet was reported as `ready: false` two seconds after it
 * said otherwise, and the host's readout flip-flopped between "mounted" and "never mounted" — which is exactly how this session lost
 * an hour to a window that was working (measured 2026-10-15: `pageTitle` showed `… > ready:m1` in one read and `ready: false` in the
 * next, with the same window).
 */
let lastReadyInfo = null;

/**
 * Tell the host half what the page is doing, on stdout, in one line it can parse.
 *
 * `VRMPET3D_STATUS_PREFIX` is duplicated in `lib/desktop.js`; the pair is asserted by the `desktop`
 * suite so the two cannot drift into silence. The payload carries the hit state as well, because
 * "the window is open but every click goes through it" is otherwise indistinguishable from a
 * working pet when read from the host.
 *
 * @param {object} [info] the page's own ready report, when this call is the first one
 */
function announce(info) {
  /**
   * A bare announcement keeps the last REAL one instead of erasing it.
   *
   * See `lastReadyInfo`: the page reports once, the watchdog announces every two seconds without any report, and falling back to the
   * self-test's `report.page` (null in a normal window) made a working pet report `ready: false` on the next tick.
   */
  if (info) lastReadyInfo = info;
  const effective = info || lastReadyInfo;
  // The page's own notes AND this process's errors. Only the page's used to travel, which is why a
  // launcher-side failure showed up in the host as "running, never ready" with nothing to read.
  const pageErrors = effective && Array.isArray(effective.errors) ? effective.errors.filter(Boolean) : [];
  const ownErrors = Array.isArray(report.errors) ? report.errors.filter(Boolean) : [];
  const payload = {
    ready: effective ? Boolean(effective.ok) : Boolean(report.page && report.page.ok),
    webgl2: effective ? Boolean(effective.webgl2) : Boolean(report.page && report.page.webgl2),
    renderer: (effective && effective.renderer) || (report.page && report.page.renderer) || null,
    errors: [...pageErrors, ...ownErrors].slice(0, 3),
    /**
     * WHERE the page got to, which the fields above cannot say.
     *
     * `ready`/`webgl2` stay false both when the page never mounted and when it mounted without WebGL, and `errors` is empty in both.
     * These split that apart, and they answer even when the page's own glue returned early (the page state being ABSENT is itself one
     * of the answers). `title` is the page's own progress line, walked one step at a time by the glue in `desktop-page.html`.
     */
    bridge: lastPageDiagnostics ? lastPageDiagnostics.bridge : null,
    sources: lastPageDiagnostics ? lastPageDiagnostics.sources : null,
    pageTitle: lastPageDiagnostics ? lastPageDiagnostics.title : null,
    pageReadError: lastPageDiagnostics && lastPageDiagnostics.readError ? lastPageDiagnostics.readError : null,
    /**
     * The page's frame count — so "the loop is alive" is a READOUT rather than an inference.
     *
     * Twice this session a frozen spring bone and an un-stoppable dance were described from outside while the page reported nothing,
     * and the frame count is the one number that separates "the loop stopped" from "the loop runs and the scene is idle". Relayed
     * from the page state, so a page that never published reports `null` rather than a stale number.
     */
    frames: lastPageState && typeof lastPageState.frames === 'number' ? lastPageState.frames : null,
    over: overPet,
    interacting: interacting,
    rect: petRect,
    // What the page's motion path is doing, and this is not decoration: "the pet is playing a clip" and "the
    // pet is standing in its procedural pose" look identical from outside, and the page's own state is the
    // only place that knows. Published here so a single `GET /vrmpet3d/desktop` answers it.
    motion: lastPageState && lastPageState.motion
      ? {
        kind: lastPageState.motion.kind,
        format: lastPageState.motion.format,
        /**
         * How many clips the PAGE's own catalog holds, and whether the route that fills it answered at
         * all. The page publishes both (`lib/desktop-page.js`) and this copy list dropped both, which
         * made the two failures behind "no motion ever plays" indistinguishable from outside: a host
         * that never served `/vrmpet3d/motions` and a window with no clip mapped to a state both reported
         * `mapped: {}` and `available: []`, and nothing else. Measured on the live window on
         * 2026-10-10: 6 clips in the host catalog, `mapped: {}`, `available: []`.
         *
         * An older page without the fields reports `null` rather than a lie, the same rule
         * `status.scale` follows below.
         */
        offered: lastPageState.motion.offered === undefined ? null : lastPageState.motion.offered,
        routed: lastPageState.motion.routed === undefined ? null : lastPageState.motion.routed,
        playing: lastPageState.motion.playing,
        /**
         * The face the window resolved, and whether three is HOLDING the clip's last frame.
         *
         * Relayed for the same reason `status` is: both answer a question the host cannot otherwise read. `face` says whether the
         * per-clip answer (the profile's, else the pack's template) reached this surface at all — 「默认无表情的覆盖没有生效」 is
         * unanswerable without it — and `clamping` says whether the one-shot on screen is being held, which is 「跳支舞之后卡在
         * 最后一帧」 in one boolean. Measured 2026-10-15.
         */
        face: lastPageState.motion.face === undefined ? null : lastPageState.motion.face,
        clamping: lastPageState.motion.clamping === undefined ? null : lastPageState.motion.clamping,
        mapped: lastPageState.motion.mapped,
        available: Array.isArray(lastPageState.motion.available)
          ? lastPageState.motion.available.map((entry) => ({
            id: entry.id,
            tracks: entry.tracks,
            duration: entry.duration,
            // The loop/once flag travels with the entry: without it a diagnostic cannot tell a clip that
            // is meant to play once from one that is meant to repeat, and "the pet waves for ever" and
            // "the pet waved once" look identical from the host.
            loop: entry.loop !== false,
          }))
          : [],
        reason: lastPageState.motion.reason,
        /**
         * Which clip the state DREW, and what the one-shot interval is doing — including WHICH STATE it is
         * armed for. That last field is the whole reason this exists: the interval belongs to a state, so a
         * window configured for `resting` fires nothing while the pet sits in `working` or `offline`, and from
         * outside those two situations look identical ("I set 20–80 seconds and nothing happens").
         */
        picked: lastPageState.motion.picked || null,
        scheduled: lastPageState.motion.scheduled || null,
      }
      : null,
    /**
     * What the 视线 settings currently resolve to IN THE RENDERER, and the aim the last frame fed the head.
     *
     * Published here because the host is where a probe can read it: "the slider reached the renderer" and
     * "the slider did nothing" are indistinguishable from outside otherwise, and this is the one field that
     * says which curve the window is actually using.
     */
    gaze: lastPageState && lastPageState.gaze
      ? {
        curve: lastPageState.gaze.curve,
        spanX: lastPageState.gaze.spanX,
        spanY: lastPageState.gaze.spanY,
        aim: lastPageState.gaze.aim,
      }
      : null,
    /**
     * Whether the spring-bone solver is running, and why it stopped if it did.
     *
     * A thrown physics step disables the chains for the rest of the avatar's life, and a disabled solver
     * looks exactly like "the hair hangs naturally but never moves" — the chains keep the pose they were
     * bound in. That failure has to be visible from outside, so the flag and the reason travel here.
     */
    physics: lastPageState && lastPageState.physics ? lastPageState.physics : null,
    /**
     * The page's own box arithmetic: the slot it thinks it has, the pixels it places it at, the canvas it
     * sized, the virtual frame it was told about, and its device pixel ratio.
     *
     * Published because the window rectangle below (`rect`) is the page's report, and when that report is
     * wrong there is no way to tell WHICH number is wrong from the host: a slot that grew, a canvas that
     * grew, or a frame that was mis-measured all produce the same symptom — a window of the wrong size —
     * and the fix belongs in a different place for each. This is the readout that tells them apart.
     */
    metrics: lastPageState
      ? {
        placement: lastPageState.placement || null,
        pixels: lastPageState.pixels || null,
        canvas: lastPageState.canvas || null,
        screen: lastPageState.screen || null,
        viewport: lastPageState.viewport || null,
        devicePixelRatio: lastPageState.devicePixelRatio || null,
      }
      : null,
    /**
     * The prompt above the model's head, as the PAGE draws it: its rectangle (null while nothing is up),
     * the line, and which animation it uses.
     *
     * Published for the same reason `motion`, `gaze` and `physics` are, and it was the field whose absence
     * cost the most: "the pet never says 深度求索中" has four causes that look identical from the host — the
     * state never reached this page (see `state`), the state has no line, the user's own settings cleared
     * that line, or the line is up but the layout put it where the window cannot show it (the window is
     * sized from this very rectangle). The rectangle is what separates "nothing to say" from "said, but not
     * on screen", and only the renderer knows it.
     */
    status: lastPageState && lastPageState.status
      ? {
        rect: lastPageState.status.rect || null,
        text: lastPageState.status.text || null,
        animation: lastPageState.status.animation || null,
        /** The whale, and the size the label is drawn at — the two halves of "does it look like DSH's". */
        icon: lastPageState.status.icon === true,
        fontPx: lastPageState.status.fontPx || null,
        /**
         * The model's own text-size correction, which the wheel ON THE TEXT drives.
         *
         * Relayed because the page publishes it but this report COPIES a fixed list of fields: without it the
         * correction existed in the page and was invisible from outside, so "the text gesture did nothing" and
         * "it worked and the size is right" could not be told apart without a browser console. Reading it from
         * `/vrmpet3d/settings` (`preferences.statusScale`) is the fallback on a launcher older than this field.
         */
        scale: lastPageState.status.scale === undefined ? null : lastPageState.status.scale,
        /**
         * The look of the line: `gold` + bold for 任务达成, `danger` for 任务失败/出错, null otherwise.
         *
         * Relayed because it is a DECISION the page only renders and this report copies a fixed field list:
         * without it, "the prompt is not gold" cannot be told apart from "the state is not 任务达成" from
         * outside the window — the same reason `scale` above is here.
         */
        tone: lastPageState.status.tone || null,
        bold: lastPageState.status.bold === true,
      }
      : null,
    /**
     * 碎碎念: the pet's own remark, on the same terms as the prompt above.
     *
     * Relayed because the launcher copies a fixed list of fields and the bubble is DOM this process sizes the
     * window around: without it, "the pet said nothing" and "it said something the window did not grow to
     * hold" look identical from outside.
     */
    speech: lastPageState && lastPageState.speech
      ? {
        rect: lastPageState.speech.rect || null,
        text: lastPageState.speech.text || null,
        fontPx: lastPageState.speech.fontPx || null,
      }
      : null,
    /**
     * What state the page is DRAWING, and what it was TOLD — plus why there is none, when the channel said so.
     *
     * Relayed for the same reason `status` is, and learned the hard way on 2026-10-11: the operator reported
     * "the window still says 深度求索中 after the turn ended", and the answer needed BOTH sides — the host's
     * `/vrmpet3d/state` (which said `state: null` with a TypeError from the app's pet) and this page's own view
     * (which was faithfully drawing the last state it had ever received). Without `published` and `error` in
     * this report, those two look identical from outside and the fixed field list made the page's view
     * invisible.
     */
    state: lastPageState && lastPageState.state
      ? {
        drawn: lastPageState.state.drawn || null,
        published: lastPageState.state.published === undefined ? null : lastPageState.state.published,
        at: lastPageState.state.at || null,
        error: lastPageState.state.error || null,
      }
      : null,
    /**
     * The last press the window reacted to, and WHICH PART of the model it landed on.
     *
     * Relayed because the answer lives only in the page: "I clicked its eye" and "I clicked its body" are the
     * same event from the launcher's side, and which one happened decides whether a reaction was configured
     * for it at all.
     */
    touch: lastPageState && lastPageState.touch
      ? {
        reason: lastPageState.touch.reason || null,
        region: lastPageState.touch.region || null,
        bone: lastPageState.touch.bone || null,
        mesh: lastPageState.touch.mesh || null,
      }
      : null,
  };
  try {
    process.stdout.write(`${VRMPET3D_STATUS_PREFIX}${JSON.stringify(payload)}\n`);
  } catch (_error) {
    // A closed stdout must not take the window down with it.
  }
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  if (selfTestTimer) clearTimeout(selfTestTimer);
});

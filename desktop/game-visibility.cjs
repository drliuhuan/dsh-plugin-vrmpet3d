// A focused game temporarily hides only a pet window that was visible beforehand.
// A transparent window can paint and report pixel hits after showInactive while
// Chromium still uses the pre-hide input surface. A real bounds transition (the
// same transition wheel zoom causes) rebuilds that surface without changing the pet.
function refreshInputRegion(win, schedule = setTimeout) {
  if (win.isDestroyed() || !win.isVisible()) return;
  const original = win.getBounds();
  const temporary = { ...original, width: original.width + 1 };
  win.setBounds(temporary, false);
  schedule(() => {
    if (win.isDestroyed()) return;
    const current = win.getBounds();
    // A drag or another layout update owns its new bounds; never move it back.
    if (['x', 'y', 'width', 'height'].every(key => current[key] === temporary[key])) win.setBounds(original, false);
  }, 32);
}
function createVisibilityController(win, hooks = {}) {
  let hiddenByGame = false;
  return function apply(active) {
    if (win.isDestroyed()) return;
    if (active && !hiddenByGame && win.isVisible()) { hiddenByGame = true; hooks.suspend?.(); win.hide(); }
    else if (!active && hiddenByGame) { hiddenByGame = false; win.showInactive(); hooks.resume?.(); }
  };
}
function watchGameVisibility(win, pageURL, interval = 500, hooks = {}) {
  const apply = createVisibilityController(win, hooks);
  const url = new URL('/vrmpet3d/desktop', pageURL);
  // The page and this poll must use the SAME Chromium session (cookies/proxy/TLS).
  // Node's http.get never inherited the window's authentication cookies.
  const session = win.webContents.session;
  let request = null, stopped = false;
  async function poll() {
    if (stopped || request || win.isDestroyed()) return;
    const controller = new AbortController();
    request = controller;
    const deadline = setTimeout(() => controller.abort(), 1500);
    deadline.unref?.();
    try {
      const response = await session.fetch(url.href, {
        credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok || response.redirected || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel();
        throw new Error('game status is not authenticated JSON');
      }
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16384) { await reader.cancel(); throw new Error('game status exceeds limit'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      if (!stopped) apply(JSON.parse(Buffer.concat(chunks).toString('utf8')).gameFocused === true);
    } catch (_) { if (!stopped) apply(false); }
    finally { clearTimeout(deadline); if (request === controller) request = null; }
  }
  const timer = setInterval(poll, interval); timer.unref(); poll();
  return function stop() { stopped = true; clearInterval(timer); if (request) request.abort(); apply(false); };
}
module.exports = { createVisibilityController, watchGameVisibility, refreshInputRegion };

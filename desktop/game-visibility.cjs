// A focused game temporarily hides only a pet window that was visible beforehand.
const http = require('node:http');
const https = require('node:https');
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
  const transport = url.protocol === 'https:' ? https : http;
  let request = null, stopped = false;
  function poll() {
    if (stopped || request || win.isDestroyed()) return;
    request = transport.get(url, { timeout: 1500 }, response => {
      let body = '', failed = response.statusCode !== 200;
      response.on('data', chunk => { body += chunk; if (body.length > 16384) { failed = true; response.destroy(); } });
      response.on('end', () => {
        if (stopped) return;
        try { apply(!failed && JSON.parse(body).gameFocused === true); } catch (_) { apply(false); }
      });
      response.on('error', () => { if (!stopped) apply(false); });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => { if (!stopped) apply(false); });
    request.on('close', () => { request = null; });
  }
  const timer = setInterval(poll, interval); timer.unref(); poll();
  return function stop() { stopped = true; clearInterval(timer); if (request) request.destroy(); apply(false); };
}
module.exports = { createVisibilityController, watchGameVisibility, refreshInputRegion };

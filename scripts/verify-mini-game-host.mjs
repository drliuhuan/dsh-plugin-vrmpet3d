import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { listenOnUsablePort } from './loopback.mjs';
const scratch = mkdtempSync(join(tmpdir(), 'vrmpet-mini-game-'));
for (const [key, name] of Object.entries({ SETTINGS_FILE: 'settings.json', MODEL_DIRS_FILE: 'models.json', MOTION_DIRS_FILE: 'motions.json', IMPORT_DIR: 'imports', SETUP_STATE_FILE: 'setup.json' })) process.env['VRMPET3D_' + key] = join(scratch, name);
const plugin = await import('../lib/index.js');
const { DesktopWindow } = await import('../lib/desktop.js');
const savedOpen = DesktopWindow.prototype.openConfig;
let launched = null;
DesktopWindow.prototype.openConfig = function (options) { launched = options; return { ok: true, pid: 123 }; };
const routes = [], effects = [];
const ctx = { logger: { info() {}, warn() {} },
  get: key => key === 'webServer' || key === 'webserver' ? { register(route) { routes.push(route); return () => {}; } } : key === 'agents' ? { list: () => [], roots: () => [] } : undefined,
  provide() { return () => {}; }, on() { return () => {}; }, effect(callback) { const dispose = callback(); effects.push(dispose); return dispose; } };
plugin.apply(ctx, {});
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const route = routes.find(r => r.kind === 'exact' ? r.path === pathname : pathname.startsWith(r.path + '/'));
  if (route) route.handler(req, res); else { res.statusCode = 404; res.end(); }
});
await listenOnUsablePort(server);
const base = 'http://127.0.0.1:' + server.address().port;
const json = async (path, body) => {
  const response = await fetch(base + '/vrmpet3d/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  assert.equal(response.status, 200); return response.json();
};
let count = 0;
try {
  const page = await fetch(base + '/vrmpet3d/game'); assert.equal(page.status, 200); assert.ok((await page.text()).includes('mini-game-core.js')); count++;
  const css = await fetch(base + '/vrmpet3d/window/lib/mini-game.css'); assert.match(css.headers.get('content-type'), /text\/css/); count++;
  const opened = await json('desktop', { action: 'game', modelId: 'my/model' });
  assert.equal(opened.state, 'game-open'); assert.equal(new URL(launched.url).pathname, '/vrmpet3d/game'); assert.equal(new URL(launched.url).searchParams.get('model'), 'my/model'); count++;
  assert.equal((await json('desktop', { action: 'game-session', sessionId: 'arbitrary' })).ok, false); count++;
  await json('state', { state: 'waiting', unread: 1, why: { statusSessionId: 'attention', waitingSessionIds: ['attention'], completedSessionIds: ['completed'] } });
  assert.equal((await json('desktop', { action: 'game-session', sessionId: 'completed' })).ok, true);
  const preview = await json('preview'); assert.equal(preview.navigation.sessionId, 'completed'); count++;
  assert.equal((await json('desktop', { action: 'game-session', sessionId: 'attention' })).ok, true); count++;
  assert.equal((await json('desktop', { action: 'game-session', sessionId: 'arbitrary' })).ok, false); count++;
  console.log(`mini-game host: ${count} passed`);
} finally {
  DesktopWindow.prototype.openConfig = savedOpen;
  server.closeAllConnections(); server.close(); for (const dispose of effects.reverse()) if (typeof dispose === 'function') dispose();
  // mkdtemp returned this exact task-owned temporary directory.
  if (!scratch.startsWith(join(tmpdir(), 'vrmpet-mini-game-'))) throw new Error('unexpected scratch directory');
  rmSync(scratch, { recursive: true, force: true });
}

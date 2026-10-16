import assert from 'node:assert/strict';
import { createGameDevServer } from './mini-game-dev.mjs';
import { listenOnUsablePort } from './loopback.mjs';
const server = createGameDevServer();
await listenOnUsablePort(server);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const page = await fetch(base + '/');
  assert.ok(page.url.endsWith('/vrmpet3d/game?test=1'));
  const html = await page.text(); assert.ok(html.includes('id="exit"') && html.includes('id="test-controls"'));
  for (const path of ['/vrmpet3d/settings', '/vrmpet3d/catalog', '/vrmpet3d/motions', '/vrmpet3d/state']) {
    const response = await fetch(base + path); assert.equal(response.status, 200); await response.json();
  }
  for (const name of ['mini-game.css', 'mini-game-page.js', 'mini-game-core.js', 'core.js', 'scene.js', 'client.vendor.js']) {
    const response = await fetch(base + '/vrmpet3d/window/lib/' + name); assert.equal(response.status, 200); assert.ok((await response.text()).length > 100);
  }
  const asset = await fetch(base + '/vrmpet3d/asset'); const bytes = new Uint8Array(await asset.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'glTF');
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/vrmpet3d/settings', { method: 'POST' })).status, 405);
  console.log('mini-game dev host: 15 checks passed');
} finally { server.closeAllConnections(); server.close(); }

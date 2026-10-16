// Local-only game host: no DSH installation, credentials or browser launch.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const springs = JSON.parse(readFileSync(new URL('assets/models/vrmpet3d-models.json', root))).springs['BlueFatFish.vrm.br'];
export function createGameDevServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    function json(data) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/') { res.writeHead(302, { location: '/vrmpet3d/game?test=1' }); return res.end(); }
    if (url.pathname === '/vrmpet3d/settings') return json({ preferences: { modelId: 'test-model' } });
    if (url.pathname === '/vrmpet3d/catalog') return json({ models: [{ id: 'test-model' }] });
    if (url.pathname === '/vrmpet3d/motions') return json({ springDefaults: { 'test-model': springs } });
    if (url.pathname === '/vrmpet3d/state') return json({ state: 'resting', why: {} });
    if (url.pathname === '/vrmpet3d/asset') {
      res.setHeader('content-type', 'model/gltf-binary');
      return res.end(brotliDecompressSync(readFileSync(new URL('assets/models/BlueFatFish.vrm.br', root))));
    }
    const name = url.pathname === '/vrmpet3d/game' ? 'mini-game.html' : url.pathname.replace('/vrmpet3d/window/lib/', '');
    if (!['mini-game.html', 'mini-game.css', 'mini-game-page.js', 'mini-game-core.js', 'core.js', 'scene.js', 'client.vendor.js'].includes(name)) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('content-type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(readFileSync(new URL('lib/' + name, root)));
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 4173);
  const server = createGameDevServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`小游戏独立测试：http://127.0.0.1:${server.address().port}/vrmpet3d/game?test=1`));
}

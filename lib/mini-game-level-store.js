// Startup-only, bounded, silent refresh. Remote content is data, never executable code.
import { readFileSync } from 'node:fs';
import './mini-game-core.js';
// The public repository stays fixed when the dev twin rewrites the plugin identity.
const repository = 'dsh-plugin-' + ['vrm', 'pet3d'].join('');
export const LEVEL_URL = `https://raw.githubusercontent.com/drliuhuan/${repository}/refs/heads/ds-ball/assets/game/levels.json`;
const api = globalThis.__VRMPET3D_MINI_GAME__;
export function createLevelStore({ fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const bundled = api.normalizeLevels(JSON.parse(readFileSync(new URL('../assets/game/levels.json', import.meta.url), 'utf8')));
  if (!bundled || bundled.levels.length !== 2) throw new Error('invalid bundled game levels');
  let current = bundled, pending;
  return {
    snapshot() { return current; },
    start() {
      if (pending) return pending;
      pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
        try {
          const response = await fetchImpl(LEVEL_URL, {signal:controller.signal,cache:'no-store',redirect:'error'});
          if (!response.ok || Number(response.headers.get('content-length')) > 2 * 1024 * 1024) return;
          const reader = response.body.getReader(), chunks = []; let size = 0;
          while (true) {
            const {done,value} = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 2 * 1024 * 1024) { await reader.cancel(); return; }
            chunks.push(Buffer.from(value));
          }
          const clean = api.normalizeLevels(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          if (clean) current = clean;
        } catch (_) { /* All remote failures intentionally keep the bundled two levels. */ }
        finally { clearTimeout(timer); controller.abort(); }
      })();
      return pending;
    },
  };
}

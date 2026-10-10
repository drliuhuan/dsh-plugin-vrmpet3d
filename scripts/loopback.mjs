/**
 * Loopback ports a probe may actually use.
 *
 * Every script here that serves a fixture to a browser or to `fetch` starts its
 * server with `listen(0, '127.0.0.1')` and then hands the assigned port back in a
 * URL. That looks safe and is not, for one specific reason:
 *
 *   * the port comes from the machine's **dynamic range**, and this machine's range
 *     starts at 1024 (`netsh int ipv4 show dynamicport tcp` -> start 1024, 13977
 *     ports), not at 49152;
 *   * both `fetch` and Chromium refuse a list of "unsafe" ports — `fetch` fails
 *     with `TypeError: fetch failed` / `cause: Error: bad port` before sending a
 *     byte, and Chromium answers `ERR_UNSAFE_PORT`.
 *
 * So an ephemeral port can collide with one of those, and the failure looks like a
 * broken route, a model that will not load, or a browser that never reports.
 * Measured here: the host suite died with `bad port` on one run and passed
 * unchanged on the next, and the port is the only variable.
 *
 * Every port below 1024 is on the list; the rest are the well-known entries a
 * dynamic range can still hand out.
 */

/** The blocked ports at or above 1024. */
export const BLOCKED_PORTS = new Set([
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** True when neither `fetch` nor Chromium will connect to this port. */
export function isBlockedPort(port) {
  return !Number.isInteger(port) || port < 1024 || BLOCKED_PORTS.has(port);
}

/**
 * Listen on `127.0.0.1` on a port that is usable, and return it.
 *
 * Retries `listen(0)` while the assigned port is blocked — the OS hands out a
 * different one on the next attempt — and gives up loudly rather than returning a
 * URL that is guaranteed to fail. Pass an already-created server.
 */
export async function listenOnUsablePort(server, attempts = 25) {
  for (let attempt = 1; ; attempt += 1) {
    await new Promise((resolveListen, rejectListen) => {
      const onError = (error) => { server.off('listening', onListening); rejectListen(error); };
      const onListening = () => { server.off('error', onError); resolveListen(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, '127.0.0.1');
    });
    const port = server.address().port;
    if (!isBlockedPort(port)) return port;
    await new Promise(resolveClose => server.close(resolveClose));
    if (attempt >= attempts) {
      throw new Error(`no loopback port a browser will accept after ${attempts} attempts (last: ${port})`);
    }
  }
}

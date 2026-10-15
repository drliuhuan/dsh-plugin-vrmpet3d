// Host half: the pet's own window, started as a separate process.
//
// Why a separate process at all (measured, see HANDOFF §12): a plugin cannot ask DSH for a
// window. The host half runs in a child process of the app with no Electron APIs, and the
// client half runs in the app renderer behind a closed IPC surface. The only route to a
// window that floats above every other window is to start one.
//
// Why a "bare Electron" directory: the app's own `DeepSeek Harness.exe` IS an Electron
// binary, but as installed it always loads ITS OWN `resources/app.asar`, so passing it an
// app directory does nothing. Put that same binary in a directory whose `resources/` holds
// only `default_app.asar`, and Electron falls back to the default app — which loads the
// directory given on the command line. That needs the support files next to the exe
// (`icudtl.dat`, the `.pak` files, the snapshot, the DLLs, `locales/`), and they are
// HARD-LINKED rather than copied: zero extra bytes, and the installation itself is never
// written to. Two escape hatches exist for when that cannot work: `VRMPET3D_DESKTOP_RUNTIME`
// names an Electron to use as-is, and a different volume degrades to copying.
//
// Everything decidable without touching the filesystem is a pure function, because that is
// the part worth testing: the environment sanitisation, the command line, the link plan, the
// volume rule, and the install-root search.
import { spawn } from 'node:child_process';
import {
  copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `VRMPET3D_*` with the pre-rename `PET3D_*` names as a fallback — see that module's own note.
import { envVar } from './env.js';

/**
 * Electron decides between "run as Node" and "run a window" by the PRESENCE of this
 * variable, not its value.
 *
 * This is the trap that costs an afternoon: DSH's own host process runs with
 * `ELECTRON_RUN_AS_NODE=1`, every child inherits it, and a launcher started with it set
 * exits immediately with `Cannot find module 'electron'`. Setting it to `0` or `false` does
 * NOT help — both are non-empty strings, both mean "be Node". It has to be deleted.
 */
export const NODE_MODE_VARIABLE = 'ELECTRON_RUN_AS_NODE';

/** Files and directories that must sit beside the exe for Electron to start at all. */
export const RUNTIME_SUPPORT = Object.freeze({
  /** Linked (or copied) verbatim; `locales` is handled as a directory instead. */
  files: Object.freeze([
    'chrome_100_percent.pak',
    'chrome_200_percent.pak',
    'd3dcompiler_47.dll',
    'dxcompiler.dll',
    'dxil.dll',
    'ffmpeg.dll',
    'icudtl.dat',
    'libEGL.dll',
    'libGLESv2.dll',
    'resources.pak',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
    'version',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll',
  ]),
  /** The only member of `resources/` the bare layout may contain. */
  defaultApp: 'default_app.asar',
  locales: 'locales',
});

/** Executable names to look for, in the order they are preferred. */
const EXECUTABLE_HINTS = ['DeepSeek Harness.exe', 'electron.exe', 'DeepSeek Harness', 'electron'];

/**
 * The marker the launcher uses for "here is what the page is doing".
 *
 * Kept identical to `VRMPET3D_STATUS_PREFIX` in `desktop/main.js` — the launcher is a separate
 * process with no imports from here, so the pair is duplicated deliberately and asserted by the
 * `desktop` suite. It exists because "the process is running" is not the same claim as "the pet
 * is drawn": a window whose page failed to mount looked perfectly healthy from the host, which is
 * exactly how the first version of this feature stayed silent while showing nothing.
 */
export const STATUS_PREFIX = 'vrmpet3d-desktop: ';

/**
 * Read one line of the launcher's stdout.
 *
 * Returns the page status it reported, or null for ordinary logging. Never throws: a launcher
 * that prints something unparseable must not take the host half down with it.
 */
export function parseStatusLine(line) {
  const text = String(line == null ? '' : line);
  const at = text.indexOf(STATUS_PREFIX);
  if (at === -1) return null;
  // Cut at the newline first: a stdout chunk routinely carries the status line followed by the
  // next line of logging, and parsing the pair fails — which would lose the status and put the
  // host back to "running, and otherwise silent".
  let json = text.slice(at + STATUS_PREFIX.length);
  const newline = json.indexOf('\n');
  if (newline !== -1) json = json.slice(0, newline);
  json = json.trim();
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

/** A copy of the child's environment with the Node-mode trap removed. */
export function sanitizeSpawnEnv(env) {
  const clean = { ...(env || {}) };
  delete clean[NODE_MODE_VARIABLE];
  // A stale extra-arguments channel from some other Electron would be applied to ours.
  delete clean.ELECTRON_EXTRA_LAUNCH_ARGS;
  return clean;
}

/**
 * The command line for the launcher.
 *
 * Pure, and the shape is asserted by a test: `desktop/main.js` parses `--key=value`, and a
 * stray positional argument would be read by Electron as the application directory.
 */
export function launchArgs(options) {
  const args = [
    `--url=${options.url}`,
    `--model-id=${options.modelId || 'placeholder'}`,
    `--parent-pid=${options.parentPid || 0}`,
  ];
  if (options.selfTest) args.push(`--self-test=${options.selfTest}`);
  // The settings window is the same launcher in a different mode: an ordinary, resizable, focusable
  // window instead of the screen-sized click-through pet.
  if (options.config) args.push('--config=1');
  return args;
}

/** Whether two paths live on the same volume, which is what hard links require. */
export function sameVolume(a, b) {
  if (!a || !b) return false;
  return parse(resolve(a)).root.toLowerCase() === parse(resolve(b)).root.toLowerCase();
}

/**
 * Where the bare-Electron runtime should live.
 *
 * Hard links only work within one volume, so the scratch directory has to be on the
 * installation's own volume or the support files would have to be COPIED — hundreds of
 * megabytes for nothing. The plugin's own state directory is preferred when it happens to be
 * on that volume (it is not on a machine whose profile lives on C: while the app lives on F:),
 * and otherwise a sibling of the installation is used.
 */
export function runtimeDirFor({ installRoot, preferred, stateDir }) {
  if (preferred) return resolve(preferred);
  if (stateDir && sameVolume(stateDir, installRoot)) return resolve(stateDir);
  return join(dirname(resolve(installRoot)), 'vrmpet3d-desktop-runtime');
}

/**
 * Walk up from a path looking for the application installation.
 *
 * The host half runs as `.../resources/runtime/primary-runtime/dependencies/node/bin/node.exe`,
 * so the installation is six levels up — but a future layout may move it, and a wrong guess
 * means "no desktop pet" rather than a crash. Hence: look for the shape, bounded.
 */
export function findInstallRoot(startPath, maxLevels = 8) {
  let current = resolve(startPath);
  for (let level = 0; level < maxLevels; level += 1) {
    if (existsSync(join(current, 'resources')) && findExecutable(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** The Electron executable in a directory, if there is one. */
export function findExecutable(dir) {
  for (const name of EXECUTABLE_HINTS) {
    const candidate = join(dir, name);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * What has to happen for `dir` to look like a bare Electron install.
 *
 * Pure: returns the plan, and `ensureRuntime` carries it out. Splitting them is what lets the
 * suite assert the properties that matter — that `app.asar` is never in the plan, that every
 * support file is accounted for, that `locales` is a directory link — without a filesystem.
 */
export function planRuntimeLinks({ installRoot, dir }) {
  const links = [];
  const missing = [];
  for (const name of RUNTIME_SUPPORT.files) {
    const from = join(installRoot, name);
    if (!existsSync(from)) { missing.push(name); continue; }
    links.push({ from, to: join(dir, name), kind: 'file' });
  }
  const localesFrom = join(installRoot, RUNTIME_SUPPORT.locales);
  links.push({
    from: localesFrom,
    to: join(dir, RUNTIME_SUPPORT.locales),
    kind: existsSync(localesFrom) ? 'dir' : 'skip',
  });
  links.push({
    from: join(installRoot, 'resources', RUNTIME_SUPPORT.defaultApp),
    to: join(dir, 'resources', RUNTIME_SUPPORT.defaultApp),
    kind: 'file',
  });
  return { links, missing, resources: join(dir, 'resources') };
}

/**
 * Create the bare-Electron directory if it is not already usable.
 *
 * Returns `{ dir, exe, created, copied, missing, installRoot }`. `copied` is true when hard
 * links were not possible and the files had to be duplicated — the caller reports that,
 * because it costs real disk and the user should know.
 */
export function ensureRuntime({ installRoot, dir, log } = {}) {
  const root = installRoot
    || findInstallRoot(dirname(process.execPath))
    || findInstallRoot(process.cwd());
  if (!root) throw new Error('could not locate the DSH installation to borrow an Electron runtime from');
  const sourceExe = findExecutable(root);
  if (!sourceExe) throw new Error(`no Electron executable found in ${root}`);
  const target = resolve(dir);
  const targetExe = join(target, basename(sourceExe));
  const plan = planRuntimeLinks({ installRoot: root, dir: target });

  const usable = existsSync(targetExe)
    && plan.links.filter((entry) => entry.kind !== 'skip').every((entry) => existsSync(entry.to));
  if (usable) {
    return { dir: target, exe: targetExe, created: false, copied: false, missing: plan.missing, installRoot: root };
  }

  mkdirSync(plan.resources, { recursive: true });
  const linkable = sameVolume(root, target);
  let copied = false;
  const place = (from, to, kind) => {
    if (existsSync(to)) return;
    if (linkable) {
      try {
        if (kind === 'dir') symlinkSync(from, to, 'junction');
        else linkSync(from, to);
        return;
      } catch (error) {
        log?.(`vrmpet3d: linking ${to} failed (${error.message}); copying instead`);
      }
    }
    copied = true;
    if (kind === 'dir') {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from)) copyFileSync(join(from, entry), join(to, entry));
    } else {
      copyFileSync(from, to);
    }
  };

  place(sourceExe, targetExe, 'file');
  for (const entry of plan.links) {
    if (entry.kind === 'skip') continue;
    place(entry.from, entry.to, entry.kind);
  }
  if (!linkable) copied = true;
  return { dir: target, exe: targetExe, created: true, copied, missing: plan.missing, installRoot: root };
}

/**
 * A standalone Electron, if one is configured.
 *
 * `VRMPET3D_DESKTOP_RUNTIME` names either an Electron executable or a directory containing one.
 * This is the documented escape hatch for a machine where the bare layout cannot be built:
 * no write access beside the installation, a different volume, an installation that moved, or
 * an operator who would rather use the runtime they already have.
 */
export function resolveStandaloneRuntime(value) {
  if (!value) return null;
  const candidate = resolve(value);
  if (!existsSync(candidate)) return null;
  if (statSync(candidate).isFile()) return { dir: dirname(candidate), exe: candidate, external: true, copied: false };
  const exe = findExecutable(candidate);
  return exe ? { dir: candidate, exe, external: true, copied: false } : null;
}

/** Where the window's own state lives, kept out of the installation. */
export function stateDir(profileDir) {
  const base = profileDir || process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop');
  return join(base, 'vrmpet3d-desktop');
}

/** Remove a runtime directory this module created. Never touches the installation. */
export function removeRuntime(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (_error) {
    return false;
  }
}

/** The launcher's directory inside the plugin. */
export function defaultAppDir() {
  const override = envVar('DESKTOP_APP_DIR');
  if (override) return resolve(override);
  return join(fileURLToPath(new URL('..', import.meta.url)), 'desktop');
}

/**
 * The window, as one object the host half can start, stop and describe.
 *
 * Deliberately small and stateful: one child at a time, `start()` is idempotent, and every
 * failure is REPORTED rather than thrown — a pet that cannot open its window must not take
 * the plugin, or the session, down with it.
 */
export class DesktopWindow {
  constructor(options = {}) {
    this.options = options;
    this.child = null;
    this.log = options.log || (() => {});
    this.status = {
      state: 'stopped',
      reason: null,
      pid: null,
      url: null,
      modelId: null,
      runtimeDir: null,
      copied: false,
      externalRuntime: false,
      startedAt: null,
      lastError: null,
      /** What the PAGE last reported: null until it mounts. */
      page: null,
      pageAt: null,
    };
  }

  /** Start the window unless it is already running. Returns the status object. */
  /**
   * Open the model-parameter window.
   *
   * A SEPARATE process on purpose. The pet window and the settings window have nothing in common
   * but the borrowed runtime: one is screen-sized, transparent, click-through and never focused, the
   * other is a form. Tying them together would also mean the settings window disappears whenever the
   * pet is switched off — which is exactly when somebody goes looking for it.
   *
   * The child is not tracked as a pet: it is not the thing this service reports the state of, and it
   * exits with its parent through the same watchdog.
   *
   * @returns {{ ok: boolean, pid?: number, error?: string }}
   */
  openConfig({ url, parentPid = process.pid } = {}) {
    if (!url) return { ok: false, error: 'no page URL to load' };
    try {
      const runtime = this.options.runtime || this.prepareRuntime();
      const spawnImpl = this.options.spawn || spawn;
      const child = spawnImpl(
        runtime.exe,
        [defaultAppDir(), ...launchArgs({ url, parentPid, config: true })],
        {
          cwd: runtime.dir,
          env: this.options.env ? this.options.env(process.env) : sanitizeSpawnEnv(process.env),
          // Detached from this process's stdio: the settings window has no status line to relay, and a
          // pipe nobody reads would fill up and block the child.
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      );
      // Unref so a long-lived settings window cannot hold the host's event loop open if everything
      // else has gone away.
      if (child && typeof child.unref === 'function') child.unref();
      this.log('vrmpet3d: settings window opened');
      return { ok: true, pid: (child && child.pid) || null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('vrmpet3d: settings window failed to open: ' + message);
      return { ok: false, error: message };
    }
  }

  start({ url, modelId, parentPid = process.pid, selfTest = '' } = {}) {
    if (this.child) {
      this.log('vrmpet3d: desktop window is already running');
      return this.describe();
    }
    if (!url) {
      this.status = { ...this.status, state: 'failed', lastError: 'no page URL to load' };
      return this.describe();
    }
    try {
      const runtime = this.options.runtime || this.prepareRuntime();
      const spawnImpl = this.options.spawn || spawn;
      const child = spawnImpl(
        runtime.exe,
        [defaultAppDir(), ...launchArgs({ url, modelId, parentPid, selfTest })],
        {
          cwd: runtime.dir,
          env: this.options.env ? this.options.env(process.env) : sanitizeSpawnEnv(process.env),
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      this.child = child;
      this.status = {
        state: 'running',
        reason: null,
        pid: child.pid || null,
        url,
        modelId: modelId || 'placeholder',
        runtimeDir: runtime.dir,
        copied: runtime.copied === true,
        externalRuntime: runtime.external === true,
        startedAt: Date.now(),
        lastError: null,
      };
      const relay = (stream, level) => {
        if (!stream || typeof stream.on !== 'function') return;
        let carry = '';
        stream.on('data', (chunk) => {
          const text = String(chunk);
          // The status line is looked for in the raw stream rather than in whole lines: a chunk
          // boundary can split it, and losing it would put the host back to "running, and
          // otherwise silent".
          carry = (carry + text).slice(-2048);
          const page = parseStatusLine(carry);
          if (page) this.status = { ...this.status, page, pageAt: Date.now() };
          const trimmed = text.trim();
          if (trimmed) this.log(`vrmpet3d: desktop ${level}: ${trimmed.slice(0, 400)}`);
        });
      };
      relay(child.stdout, 'out');
      relay(child.stderr, 'err');
      child.on('error', (error) => {
        // Only the CURRENT child owns the status: a replaced child's failure must not be reported as
        // the running window's (see the same guard on 'exit').
        if (this.child !== child) return;
        this.status = { ...this.status, state: 'failed', lastError: error.message };
        this.log(`vrmpet3d: desktop window failed to start: ${error.message}`);
      });
      child.on('exit', (code, signal) => {
        /**
         * Only the CURRENT child owns the status.
         *
         * `action: 'restart'` stops the window and starts a new one, and the OLD process's exit event
         * lands after the new start — the host then reported
         * `{state: 'stopped', reason: 'signal SIGTERM', pid: null}` while the new window was on screen
         * and drawing (measured 2026-10-08, on the first live use of `restart`). The page state in the
         * same payload said `ready: true`, which is what gave it away.
         */
        if (this.child !== child) {
          this.log(`vrmpet3d: a replaced desktop window exited (${signal ? `signal ${signal}` : `exit ${code}`})`);
          return;
        }
        this.child = null;
        this.status = {
          ...this.status,
          state: code === 0 || signal ? 'stopped' : 'failed',
          pid: null,
          reason: signal ? `signal ${signal}` : `exit ${code}`,
          lastError: code === 0 || signal ? null : `exit ${code}`,
        };
        this.log(`vrmpet3d: desktop window exited (${signal || code})`);
      });
    } catch (error) {
      this.status = { ...this.status, state: 'failed', lastError: error && error.message };
      this.log(`vrmpet3d: could not start the desktop window: ${error && error.message}`);
    }
    return this.describe();
  }

  /** Build, or find, the runtime this window will be spawned from. */
  prepareRuntime() {
    const external = resolveStandaloneRuntime(envVar('DESKTOP_RUNTIME'));
    if (external) {
      this.log(`vrmpet3d: desktop window using the Electron at ${external.exe}`);
      return external;
    }
    const installRoot = this.options.installRoot || findInstallRoot(dirname(process.execPath));
    const prepared = ensureRuntime({
      installRoot,
      dir: this.options.runtimeDir || runtimeDirFor({
        installRoot: installRoot || process.cwd(),
        preferred: envVar('DESKTOP_HOST_DIR'),
        stateDir: join(stateDir(this.options.profileDir), 'runtime'),
      }),
      log: this.log,
    });
    if (prepared.copied) {
      this.log('vrmpet3d: the desktop runtime had to be copied (hard links unavailable); it costs disk space');
    }
    if (prepared.missing && prepared.missing.length) {
      this.log(`vrmpet3d: the installation is missing ${prepared.missing.join(', ')}; the window may not start`);
    }
    return prepared;
  }

  /** Stop the window, if it is running. Idempotent. */
  stop() {
    if (!this.child) return this.describe();
    const child = this.child;
    this.child = null;
    try {
      child.kill();
    } catch (error) {
      this.log(`vrmpet3d: could not stop the desktop window: ${error && error.message}`);
    }
    this.status = { ...this.status, state: 'stopped', pid: null, reason: 'stopped by the host' };
    return this.describe();
  }

  describe() {
    return { ...this.status, running: Boolean(this.child) };
  }
}

/** A scratch location for tests, outside the plugin. */
export function temporaryRuntimeDir(name = 'vrmpet3d-desktop-test') {
  return join(tmpdir(), name);
}

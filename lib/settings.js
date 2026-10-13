/**
 * The one place the settings live.
 *
 * Why this exists at all: the settings used to be `localStorage`, and `localStorage` does NOT cross
 * application boundaries. The floating pet is a page inside the plugin's OWN Electron app (the launcher,
 * with its own userData directory); the pet inside DSH is a page inside DSH. Same origin, different
 * browser profile, therefore two different stores — so a change made in the settings window reached the
 * floating pet only, and a change made in the app panel reached the app only. The version bump below is
 * what a surface polls to find out that something changed somewhere else.
 *
 * The host is the natural owner: both surfaces already talk to it over HTTP, it outlives them, and it is
 * the only process that can see all of them at once.
 *
 * Two kinds of data are kept apart on purpose:
 *   * `preferences` — the settings themselves, exactly the shape `core.cleanPreferences` defines;
 *   * `live` — which model each surface is showing right now. That matters because a spring override is
 *     keyed BY MODEL ID, and a surface whose stored modelId disagrees with the model it is actually
 *     showing (a fresh profile showing the model the launcher was told to load) would otherwise read its
 *     overrides under a key nobody writes to — which is exactly how "the spring sliders do nothing" was
 *     reported.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import './core.js';
// `VRMPET3D_SETTINGS_FILE` with the pre-rename `PET3D_SETTINGS_FILE` as a fallback.
import { envVar } from './env.js';

const core = globalThis.__VRMPET3D_CORE__;

/** How the store is written: a temp file beside the target, then a rename, so a crash cannot truncate it. */
function readState(file) {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    // A corrupt settings file is a reason to start from defaults, not a reason to refuse to run.
    return null;
  }
}

function writeState(file, payload) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    renameSync(temporary, file);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * How much of the settings the USER authored, as one number.
 *
 * Counts the fields no shipped default fills in: the structures each part owns, the per-part and per-state lines, the
 * per-state AI prompts, a persona that is NOT the shipped one, and the status lines. A fresh profile scores 0; anything
 * the operator typed in the settings window scores above it. `update` uses this to tell a deliberate reset from a page
 * that never loaded the real settings and is about to send its defaults (`authoredWeight` of the incoming patch vs of
 * what is stored).
 *
 * The PERSONA is compared with `core.DEFAULT_SPEECH_PERSONA` rather than merely tested for emptiness, and that is
 * load-bearing: the shipped character is non-empty (2026-10-13), so counting "a persona exists" would make every
 * profile — including a fresh one — score at least 1, which would leave `update`'s refusal with nothing to compare
 * (`wipesAuthored` could never be true) and silently retire the guard that exists to stop a half-booted page from
 * overwriting everything the user wrote. A profile that still carries the shipped character has authored nothing.
 */
export function authoredWeight(preferences) {
  const prefs = preferences && typeof preferences === 'object' ? preferences : {};
  let total = 0;
  const items = prefs.parts && Array.isArray(prefs.parts.items) ? prefs.parts.items : [];
  for (const item of items) {
    total += Array.isArray(item.match) ? item.match.length : 0;
    total += item.speech && Array.isArray(item.speech.lines) ? item.speech.lines.length : 0;
    total += item.speech && typeof item.speech.prompt === 'string' && item.speech.prompt ? 1 : 0;
    total += item.emotion && item.emotion.emotions && item.emotion.emotions.length ? 1 : 0;
  }
  const speech = prefs.speech && typeof prefs.speech === 'object' ? prefs.speech : {};
  const lines = speech.lines && typeof speech.lines === 'object' ? speech.lines : {};
  for (const key of Object.keys(lines)) total += Array.isArray(lines[key]) ? lines[key].length : 0;
  const prompts = speech.ai && speech.ai.prompts && typeof speech.ai.prompts === 'object' ? speech.ai.prompts : {};
  for (const key of Object.keys(prompts)) total += typeof prompts[key] === 'string' && prompts[key] ? 1 : 0;
  total += speech.ai && typeof speech.ai.persona === 'string' && speech.ai.persona
    && speech.ai.persona !== core.DEFAULT_SPEECH_PERSONA ? 1 : 0;
  total += speech.ai && typeof speech.ai.apiKey === 'string' && speech.ai.apiKey ? 1 : 0;
  const status = prefs.status && typeof prefs.status === 'object' ? prefs.status : {};
  for (const key of Object.keys(status)) {
    const entry = status[key] && typeof status[key] === 'object' ? status[key] : {};
    total += typeof entry.text === 'string' && entry.text ? 1 : 0;
    total += typeof entry.tag === 'string' && entry.tag ? 1 : 0;
  }
  return total;
}

/**
 * Merge one patch into the settings.
 *
 * TOP-LEVEL keys only, and a patch value replaces what was there. That is deliberate and predictable: a
 * surface that edits `springs` sends the whole map it has, a surface that flips `physics` sends one
 * boolean, and neither has to know how the other's half is shaped. `null` deletes a key (back to its
 * default), which is what "reset" means in the window.
 */
export function mergePreferences(current, patch) {
  const base = current && typeof current === 'object' ? { ...current } : {};
  if (!patch || typeof patch !== 'object') return core.cleanPreferences(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return core.cleanPreferences(base);
}

export class SettingsStore {
  /**
   * @param {object} options
   *   file  where the settings are remembered between sessions
   *   log   optional logger
   */
  constructor({ file, log } = {}) {
    this.file = file || null;
    this.log = typeof log === 'function' ? log : () => {};
    /**
     * THE RENAME'S MIGRATION POINT (2026-10-12). The file was `pet3d-settings.json` before the project was
     * renamed, and a profile that predates it holds the operator's REAL settings — part structures, per-part
     * 碎碎念, the status lines, the model choice. So when the current file does not exist yet, the old one is read
     * and the first `persist()` (two lines below) writes the same object under the new name: a migration, not a
     * reset. Derived from the shipped file name rather than passed in, so an override — a suite's scratch file,
     * which must NOT read the operator's live store — can never inherit the legacy path.
     *
     * The BASE NAME decides it, not the whole path: `settingsFileFor` builds the path with `path`-style separators,
     * so on Windows the file is `...\vrmpet3d-settings.json` and a test for `/vrmpet3d-settings.json` never matches
     * — which is how this migration was dead on the operator's machine until `verify-model.mjs` group 13c caught it.
     */
    const baseName = typeof this.file === 'string' ? this.file.split(/[\\/]/).pop() : '';
    const legacyFile = baseName === 'vrmpet3d-settings.json'
      ? this.file.slice(0, this.file.length - baseName.length) + 'pet3d-settings.json'
      : null;
    this.legacyFile = legacyFile;
    const stored = this.file ? (readState(this.file) || (legacyFile ? readState(legacyFile) : null)) : null;
    this.preferences = core.cleanPreferences(stored && stored.preferences ? stored.preferences : {});
    this.live = {
      app: stored && stored.live && typeof stored.live.app === 'string' ? stored.live.app : null,
      window: stored && stored.live && typeof stored.live.window === 'string' ? stored.live.window : null,
    };
    // A version rather than a timestamp: a surface polls for "is it not the number I last saw", and two
    // changes inside one poll interval still produce exactly one update on the next look.
    this.version = 1;
    this.persist();
  }

  /** Everything a surface needs to catch up: the settings, who is showing what, and the version. */
  snapshot() {
    return {
      version: this.version,
      preferences: this.preferences,
      live: { ...this.live },
    };
  }

  /**
   * Apply a patch and/or report which model a surface is showing.
   *
   * @param {object} body `{ preferences?: {...}, live?: { app?: string|null } }`
   * @returns {object} the new snapshot
   */
  update(body) {
    const patch = body && typeof body.preferences === 'object' && body.preferences ? body.preferences : null;
    const live = body && typeof body.live === 'object' && body.live ? body.live : null;
    let changed = false;

    if (patch) {
      const next = mergePreferences(this.preferences, patch);
      /**
       * REFUSE to let an all-default patch erase what the user actually wrote.
       *
       * This is the guard for a real data loss (2026-10-11): the settings page stopped booting halfway (eight status
       * elements had been deleted from its markup), so it never adopted the host snapshot; its controls sat at their
       * defaults, and the first patch it sent — its WHOLE preferences object, which is how the page writes — carried
       * those defaults over everything: part structures, per-part 碎碎念, the per-state AI prompts and the status lines.
       * The store had no way to tell that from a deliberate reset, and the operator's real settings were gone.
       *
       * The rule: a patch that leaves EVERY user-authored field empty while the store holds something is a RESET, and a
       * reset has to be asked for (`{ preferences, reset: true }`) rather than arrived at by accident. A store with
       * nothing to lose is unaffected, which is why a fresh profile still works with no ceremony.
       */
      const wipesAuthored = authoredWeight(next) === 0 && authoredWeight(this.preferences) > 0;
      const asked = body && body.reset === true;
      if (wipesAuthored && !asked) {
        this.log('vrmpet3d: REFUSED a patch that would have replaced every authored setting with defaults');
        return this.snapshot();
      }
      if (JSON.stringify(next) !== JSON.stringify(this.preferences)) {
        this.preferences = next;
        changed = true;
      }
    }
    if (live) {
      for (const key of ['app', 'window']) {
        if (!Object.prototype.hasOwnProperty.call(live, key)) continue;
        const value = typeof live[key] === 'string' && live[key] ? live[key] : null;
        if (this.live[key] !== value) {
          this.live[key] = value;
          changed = true;
        }
      }
    }
    if (changed) {
      this.version += 1;
      this.persist();
      this.log(`vrmpet3d: settings updated to version ${this.version}`);
    }
    return this.snapshot();
  }

  persist() {
    if (!this.file) return false;
    return writeState(this.file, {
      version: this.version,
      preferences: this.preferences,
      live: this.live,
    });
  }
}

/**
 * Where the settings file lives, given the plugin's own state directory.
 *
 * `VRMPET3D_SETTINGS_FILE` overrides it, and that override is the whole reason this is a function
 * rather than a template at the call site: a suite that applies the plugin must not write the
 * OPERATOR's settings. Without it, `check-plugin-load.mjs` — which runs on the default profile —
 * constructed a store against the live file and rewrote it with a reset version counter (measured
 * 2026-10-08: the live store said version 13 while the file on disk said version 1). The preferences
 * happened to survive, because the constructor reads the file before it writes it; nothing promised
 * that, and a suite that POSTs a patch would have overwritten them. This is gotcha 37's rule — a test
 * may not read or write state it does not own — applied to the one file that stores them.
 *
 * THE RENAME IS A MIGRATION: this file was `pet3d-settings.json` before 2026-10-12, and `SettingsStore`'s
 * constructor still READS that name when the current one does not exist yet (see the note there). Nothing writes
 * it any more, and an override gets no legacy read at all.
 */
export function settingsFileFor(stateDir) {
  const override = envVar('SETTINGS_FILE');
  if (override) return resolve(override);
  return stateDir ? `${stateDir}/vrmpet3d-settings.json` : null;
}

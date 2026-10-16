/**
 * The 状态与动作 clip picker's probe: ONE script, evaluated in the settings window by `desktop/main.js`.
 *
 * It lives in its own file for the reason `probe-parts-editor.js` documents: a template literal inside `main.js`
 * is one stray backtick away from breaking the LAUNCHER rather than a test, and a plain file can be proved to
 * parse by the suite before anything is spawned.
 *
 * WHY IT EXISTS. The operator reported "the last clip cannot be selected" on 2026-10-12, and the cause was in
 * the page's own collection step: `onMotionToggle` gathered EVERY checked checkbox in the state's row, which
 * included each ticked clip's 凝视 switch — and a checkbox written without a `value` attribute has the DOM
 * default `'on'`, so ticking a clip stored the literal string `on` as a clip id. Those junk entries then took
 * slots in the per-state list, and the clip the operator had just ticked was the one pushed out. Nothing outside
 * the page can see that: the ids arrive at the host as a perfectly valid-looking POST.
 *
 * So this probe drives the real box and compares two numbers that must agree — what the PAGE thinks is selected
 * against what the CORE will keep — and reports the junk. Nothing here is asserted; the numbers travel to
 * `scripts/verify-desktop.mjs`, where the suite decides.
 *
 * It is an EXPRESSION (an immediately-invoked async arrow), so `executeJavaScript` awaits it and hands back the
 * resolved JSON string.
 */
(async () => {
  const state = () => globalThis.__VRMPET3D_DEV_CONFIG_STATE__ || {};
  const row = () => document.querySelector('#motion-list .motion-state[data-state="resting"]');
  const tickBoxes = () => Array.from(row() ? row().querySelectorAll('.picks label.pick input[type=checkbox]') : []);
  const gazeBoxes = () => Array.from(row() ? row().querySelectorAll('label.clip-gaze input[type=checkbox]') : []);

  const out = { error: null };
  if (!row()) { out.error = 'no 空闲 box set'; return JSON.stringify(out); }

  /**
   * THE FOLDER ↔ STATE SCOPING, measured on every state at once.
   *
   * Operator's request (2026-10-12): the folders under `assets/motions` are not a filing convention, they are
   * the mapping — "把对应的动作直接解析到指定目录，这样在选择动作的时候就不会出现很长一串". So each state's box set is
   * offered only its own folder's clips. What is measured here is that promise, per state: which folder the
   * state declares, and whether every box drawn in that row belongs to it. With no `stateFolders` in the
   * payload (an older host) nothing is declared and every state is offered everything — the compatible answer.
   * The suite's stub now declares ONE mapping as well, because the shipped pack declares six and an
   * undeclared-everywhere stub is what let the empty-list defect ship.
   */
  const mappings = (state().motions || {}).stateFolders || {};
  out.stateFolders = mappings;
  out.scoped = (state().motions ? (state().motions.perState || {}) : {});
  // The catalogue as the PAGE holds it, published as id → name, so this needs no second fetch and no guess.
  const byId = new Map(Object.entries((state().motions || {}).offeredNames || {}));
  /**
   * A state's folders as a LIST, whatever the payload carried.
   *
   * A manifest value may be ONE folder or SEVERAL (`"resting": ["idle", "dance"]`), and the host normalises it
   * to a list before serving it. The probe reads either shape, because it measures the PAGE: a page that
   * compared that list to a single folder name is the defect it reported on 2026-10-12.
   */
  const folderList = (value) => (Array.isArray(value) ? value : (value ? [value] : []))
    .filter((name) => typeof name === 'string' && name);
  out.rows = {};
  for (const name of Object.keys(out.scoped)) {
    const stateRow = document.querySelector(`#motion-list .motion-state[data-state="${name}"]`);
    if (!stateRow) continue;
    const all = Array.from(stateRow.querySelectorAll('.picks label.pick input[type=checkbox]'));
    const values = all.map((box) => box.value);
    const folder = mappings[name] || null;
    const folders = folderList(mappings[name]);
    /**
     * What must never be in a scoped row: a clip from ANOTHER folder that the user did not tick. A ticked clip
     * from outside IS drawn, deliberately — a stored mapping is never hidden from the person who made it — so
     * the check is on the unticked rows, which are the list being read when choosing.
     */
    const ticked = new Set(all.filter((box) => box.checked).map((box) => box.value));
    const outside = folders.length
      ? values.filter((id) => !ticked.has(id)
        && !folders.some((dir) => String(byId.get(id) || '').indexOf(dir + '/') === 0))
      : [];
    out.rows[name] = { folder, folders, drawn: values.length, outsideFolder: outside };
  }

  const boxes = tickBoxes();
  out.offered = boxes.length;
  out.gazeRows = gazeBoxes().length;
  /**
   * What the page's own published state says is selected, and what the core would KEEP from the same list.
   *
   * `motions.ticked` is `core.motionIdList(preferences.motions).length` and `motions.stateIds` is the cleaned
   * list for this state, so a junk id shows up here as a value that is not one of the offered ids — which is the
   * check that would have caught the `on` entries immediately.
   */
  out.tickedBefore = (state().motions || {}).ticked;
  const offeredIds = boxes.map((box) => box.value);
  out.offeredIds = offeredIds;
  out.junkBefore = (((state().motions || {}).stateIds || {}).resting || [])
    .filter((id) => offeredIds.indexOf(id) === -1);

  // Tick the LAST clip, exactly as the operator did — a real click on a real box.
  const last = boxes[boxes.length - 1];
  if (!last) { out.error = 'the state offers no clips'; return JSON.stringify(out); }
  out.lastId = last.value;
  out.lastDisabled = last.disabled;
  if (!last.checked) last.click();

  /**
   * Wait for the page to republish rather than reading the state straight away.
   *
   * The published object is rebuilt on a poll, so reading it immediately after the click answers what the page
   * looked like a moment AGO — the same trap `probe-parts-editor.js` documents for the 部位 table.
   */
  const wanted = offeredIds.length;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const seen = (((state().motions || {}).stateIds || {}).resting || []).length;
    if (seen >= wanted) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const after = state().motions || {};
  out.tickedAfter = after.ticked;
  out.stateIdsAfter = ((after.stateIds || {}).resting || []).slice();
  out.junkAfter = out.stateIdsAfter.filter((id) => offeredIds.indexOf(id) === -1);
  // And the DOM's own answer: a tick that did not stick is what the operator actually saw.
  const sameBox = tickBoxes().filter((box) => box.value === out.lastId)[0];
  out.lastStillTicked = Boolean(sameBox && sameBox.checked);
  out.checkedInDom = tickBoxes().filter((box) => box.checked).map((box) => box.value);
  return JSON.stringify(out);
})();

/**
 * The 部位 editor's probe: ONE script, evaluated in the settings window by `desktop/main.js`.
 *
 * It lives in its own file because it used to be a template literal INSIDE main.js — and a stray backtick in a
 * comment (twice: once in a comment mentioning a route, once in one mentioning a `<datalist>`) ended that literal
 * early. The result was not a test failure but a BROKEN LAUNCHER: `main.js` no longer parsed, so the floating
 * window could not open at all, and the only symptom was an Electron error dialog on the operator's screen. A
 * plain file cannot be broken that way, and `node --check desktop/probe-parts-editor.js` can prove it parses —
 * which `scripts/verify-desktop.mjs` now does before it spawns anything.
 *
 * It is an EXPRESSION (an immediately-invoked async arrow), so `executeJavaScript` awaits it and hands back the
 * resolved JSON string.
 *
 * Nothing here is asserted: the numbers travel to `scripts/verify-desktop.mjs`, where the suite decides.
 */
(async () => {
  const state = () => globalThis.__PET3D_CONFIG_STATE__ || {};
  const parts = () => (state().parts || {});
  const rows = () => Array.from(document.querySelectorAll('#part-body tr:not(.part-detail)'));
  // COUNTED FROM THE DOM, not from the published state: that state is republished on a poll, so reading it
  // straight after a click answers what the page looked like a moment AGO — measured as "新增部位 adds a part
  // (5 -> 5)" while the row it had just added was right there in the table.
  const out = { labelsBefore: (parts().labels || []).slice() };
  out.before = rows().length;
  const add = document.getElementById('part-add');
  if (!add) { out.error = 'no 新增部位 button'; return JSON.stringify(out); }
  add.click();
  out.afterAdd = rows().length;
  const last = rows()[rows().length - 1];
  if (!last) { out.error = 'no row after adding'; return JSON.stringify(out); }
  /**
   * THE BROWSER PANEL, driven the way the operator complained about.
   *
   * The report was "添加结构的下拉框无法滚动，也没有滚动条" — a native input+datalist popup, drawn by Chromium and
   * impossible to scroll or inspect from here. The panel that replaced it is the page's own DOM, so these are the
   * things that make it usable: it opens, it is FULL of the model's names, it really scrolls (a scrollTop that
   * moves, against a box shorter than its content), and clicking a row adds that structure to the part.
   */
  const browse = rows()[rows().length - 1].querySelector('.part-browse');
  if (browse) browse.click();
  const list = document.getElementById('part-picker-list');
  const panel = document.getElementById('part-picker');
  out.pickerOpen = Boolean(panel) && panel.hidden === false;
  const names = list ? Array.from(list.querySelectorAll('.part-picker-row')) : [];
  out.pickerRows = names.length;
  out.pickerSample = names.slice(0, 3).map((row) => row.getAttribute('data-structure'));
  out.pickerScrollHeight = list ? list.scrollHeight : 0;
  out.pickerClientHeight = list ? list.clientHeight : 0;
  if (list) {
    list.scrollTop = 60;
    out.pickerScrolledTo = list.scrollTop;
  }
  // The filter narrows the list without touching the table beneath it.
  const filter = document.getElementById('part-picker-filter');
  if (filter) {
    filter.value = 'hair';
    filter.dispatchEvent(new Event('input'));
    out.pickerFilteredRows = list ? list.querySelectorAll('.part-picker-row').length : 0;
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
  }
  // And a click on a row is how a structure is added from the browser.
  const target = list ? list.querySelector('.part-picker-row') : null;
  out.pickerPicked = target ? target.getAttribute('data-structure') : null;
  if (target) target.click();
  out.chipsFromPicker = rows()[rows().length - 1].querySelectorAll('.chip').length;
  const closePicker = document.getElementById('part-picker-close');
  if (closePicker) closePicker.click();
  out.pickerClosed = Boolean(panel) && panel.hidden === true;
  /**
   * And 浏览… opens it AGAIN after 关闭. The structure browser keeps its open state in module state and a static
   * panel, so it has no stale-reference trap to fall into — this is the assertion that says so, right next to the one
   * that caught it in the expression picker.
   */
  const browseAgain = rows()[rows().length - 1].querySelector('.part-browse');
  if (browseAgain) browseAgain.click();
  out.pickerReopened = Boolean(panel) && panel.hidden === false;
  if (closePicker) closePicker.click();
  out.pickerClosedAgain = Boolean(panel) && panel.hidden === true;
  // Back to a clean part for the gestures below, which are about the text box and the chips.
  rows()[rows().length - 1].querySelectorAll('.chip-drop').forEach((drop) => drop.click());
  const box = rows()[rows().length - 1].querySelector('.part-add-structure');
  if (!box) { out.error = 'no structure box'; return JSON.stringify(out); }
  box.value = 'LiuHai';
  box.dispatchEvent(new Event('change'));
  let row = rows()[rows().length - 1];
  const chip = row.querySelector('.chip');
  out.chip = chip ? chip.firstChild.textContent : null;
  out.chipHint = chip ? (chip.querySelector('.note') ? chip.querySelector('.note').textContent.trim() : null) : null;
  out.structures = row.querySelectorAll('.chip').length;
  const mode = row.querySelector('.chip-mode');
  out.modeBefore = mode ? mode.textContent : null;
  if (mode) mode.click();
  row = rows()[rows().length - 1];
  const modeAfter = row.querySelector('.chip-mode');
  out.modeAfter = modeAfter ? modeAfter.textContent : null;
  const drop = row.querySelector('.chip-drop');
  if (drop) drop.click();
  row = rows()[rows().length - 1];
  out.chipsAfterDrop = row.querySelectorAll('.chip').length;
  /**
   * RENAME and DELETE, the other two things the section promises.
   *
   * Both go through a full repaint of the table, so every read below re-queries its row: holding one across a
   * change is what made the first version of this probe report "5 -> 5".
   */
  const label = rows()[rows().length - 1].querySelector('.part-label');
  if (label) {
    label.value = '刘海';
    label.dispatchEvent(new Event('change'));
  }
  out.renamedLabel = rows()[rows().length - 1].querySelector('.part-label').value;
  out.pickerHasModelNames = out.pickerSample.some((entry) => /head|hair|arm|tail|eye/i.test(String(entry)));
  const remove = rows()[rows().length - 1].querySelector('.part-remove');
  if (remove) remove.click();
  out.afterDelete = rows().length;
  out.after = rows().length;
  out.rowsDrawn = rows().length;
  out.publishedCount = parts().count;

  /**
   * THE JUMP — the report this block exists for now: "在部位中勾选或者取消表情时，每次点击都会让页面返回到最上面一条".
   *
   * The page is scrolled down, an expression is ticked from a row's dropdown, and the page has to STAY PUT. The
   * scroll offset is read from `document.scrollingElement` before and after, because the cause was the document
   * momentarily collapsing when a repaint emptied its `<tbody>` — a fact no assertion about the stored value can
   * see.
   *
   * The menu itself is read back as well: one button per row, the choices inside a bounded scrollable panel, and
   * no expression checkbox left in the row (`input[data-name]` outside a `.pick-menu` must be zero).
   */
  const scroller = document.scrollingElement || document.documentElement;
  out.pageScrolls = scroller.scrollHeight > scroller.clientHeight + 20;
  scroller.scrollTop = out.pageScrolls ? 140 : 0;
  out.scrollBefore = scroller.scrollTop;
  const pickButton = document.querySelector('#part-body .pick-select');
  out.pickTriggerBefore = pickButton ? pickButton.textContent : null;
  if (pickButton) pickButton.click();
  const menu = document.querySelector('.pick-menu');
  out.menuOpen = Boolean(menu);
  out.menuBoxes = menu ? menu.querySelectorAll('input[data-name]').length : 0;
  out.menuScrolls = menu ? menu.scrollHeight > menu.clientHeight : false;
  /**
   * BOUNDED, measured here rather than from the page's published state: the page publishes on its own poll, so a menu
   * this probe has just opened may not be in that snapshot yet. `scrollHeight > clientHeight` is the wrong question
   * anyway — it is false on a four-expression model, where the CSS ceiling is still what keeps a twenty-expression
   * one from growing the row.
   */
  const menuStyle = menu && window.getComputedStyle ? window.getComputedStyle(menu) : null;
  out.menuOverflow = menuStyle ? menuStyle.overflowY : null;
  out.menuMaxHeight = menuStyle ? menuStyle.maxHeight : null;
  out.menuBounded = Boolean(menuStyle) && menuStyle.overflowY === 'auto' && /px$/.test(String(menuStyle.maxHeight));
  out.inlineBoxes = document.querySelectorAll('#emotion-body input[data-name], #part-body input[data-name]').length
    - out.menuBoxes;
  const tick = menu ? menu.querySelector('input[data-name]') : null;
  out.tickedName = tick ? tick.getAttribute('data-name') : null;
  if (tick) {
    tick.checked = true;
    tick.dispatchEvent(new Event('change'));
  }
  out.pickTriggerAfter = pickButton ? pickButton.textContent : null;
  out.scrollAfter = scroller.scrollTop;
  out.stayedPut = Math.abs(scroller.scrollTop - out.scrollBefore) <= 2;

  /**
   * AND THE MENU OPENS AGAIN — the reported bug: "选中一个表情后，再点表情的下拉列表就无效了，必须刷新页面重新进".
   *
   * Closing removed the panel but left the row's own reference to it, so every later click on that button took the
   * "close" branch and the row was dead until a repaint (a page reload, since a tick no longer repaints). Three
   * closings are driven here because they take three different paths out: the trigger itself, Escape, and an outside
   * pointerdown — an orphaned outside-click listener is the other half of the same defect.
   */
  const menuOf = () => document.querySelector('.pick-menu');
  if (pickButton) pickButton.click();                       // close it the way the user would
  out.closedByTrigger = !menuOf();
  if (pickButton) pickButton.click();                       // …and open it again: this is the bug
  out.reopenedAfterTrigger = Boolean(menuOf());
  // The rebuilt panel must show the live row, which still has the expression ticked from above.
  const reopenedBox = menuOf() ? menuOf().querySelector('input[data-name]') : null;
  out.reopenedTicked = reopenedBox ? reopenedBox.checked : null;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.closedByEscape = !menuOf();
  if (pickButton) pickButton.click();
  out.reopenedAfterEscape = Boolean(menuOf());
  /**
   * The away listener is attached a TICK AFTER the menu opens (so the click that opened it is not read as an outside
   * click), so the outside click has to happen after that tick — dispatching it immediately is the mistake this
   * block made first, and the three failures that followed were all downstream of it.
   */
  await new Promise((resolve) => setTimeout(resolve, 30));
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  out.closedByOutside = !menuOf();
  if (pickButton) pickButton.click();
  out.reopenedAfterOutside = Boolean(menuOf());

  // Put the row back to 无 so the profile the later checks see is the shipped one, then close the menu.
  const lastTick = menuOf() ? menuOf().querySelector('input[data-name]') : null;
  if (lastTick) {
    lastTick.checked = false;
    lastTick.dispatchEvent(new Event('change'));
  }
  if (pickButton) pickButton.click();
  out.menuClosedAtEnd = !menuOf();
  out.pickTriggerRestored = pickButton ? pickButton.textContent : null;

  /**
   * AND THE SOURCE TAKES THE BUILT-IN VOICE OFF THE 部位 TABLE — the second half of 「如果设置了AI碎碎念，就停止输出内置的
   * 碎碎念」 (operator, 2026-10-12).
   *
   * 胸部 ships answering 变态！/大色狼！ with nothing written in the user's settings, and its box placeholder is what
   * PROMISES that. The promise is a property of the SOURCE, so a source that is not 内置短语 has to take it away.
   *
   * It is driven through the STORE, and that is the honest path for THIS page: the 台词来源 picker lives on the other
   * settings page (通用设置), so a model page can never see it move — there is no `#pref-speech-source` here to drive.
   * What this page does see is another document writing the store, which is exactly what its `storage` listener
   * handles (two open settings windows, or an edit from the app's own panel). The DOM is read back afterwards
   * because the published state is republished on a poll and would answer what the page looked like a moment ago.
   *
   * The store is put back at the end, because a probe must not leave the profile in a state the next suite reads.
   */
  const storeKey = (globalThis.__PET3D_CORE__ || {}).STORAGE_KEY || 'dsh.pet3d.v1';
  const storeBefore = globalThis.localStorage.getItem(storeKey);
  const openWithSource = (source) => {
    let stored = {};
    try { stored = JSON.parse(storeBefore || '{}') || {}; } catch (_error) { stored = {}; }
    stored.speech = Object.assign({}, stored.speech, { source: source });
    globalThis.localStorage.setItem(storeKey, JSON.stringify(stored));
    globalThis.dispatchEvent(new StorageEvent('storage', { key: storeKey }));
  };
  const placeholderOf = (label) => {
    const row = rows().filter((entry) => {
      const box = entry.querySelector('.part-label');
      return box && box.value === label;
    })[0];
    const detail = row ? row.nextElementSibling : null;
    const box = detail ? detail.querySelector('.part-lines') : null;
    return box ? box.placeholder : null;
  };
  out.partLinesBuiltin = placeholderOf('胸部');
  openWithSource('ai');
  out.partLinesAi = placeholderOf('胸部');
  if (storeBefore === null) globalThis.localStorage.removeItem(storeKey);
  else globalThis.localStorage.setItem(storeKey, storeBefore);
  globalThis.dispatchEvent(new StorageEvent('storage', { key: storeKey }));
  out.partLinesRestored = placeholderOf('胸部');
  return JSON.stringify(out);
})()

/**
 * Repair `docs/ARCHITECTURE.md` after a PowerShell accident (2026-10-09).
 *
 * What happened: a count update was run through the shell with a single replacement PAIR, which PowerShell
 * flattened into a two-element STRING array — so the loop took `$p[0]` and `$p[1]` of a STRING, i.e. the
 * characters 'T' and 'e', and replaced every 'T' in the file with 'e'. That is the whole damage: one
 * character, everywhere, and it is recoverable because only the uppercase 'T' moved and English/identifier
 * contexts make the intended word almost always unambiguous.
 *
 * This script applies an explicit table (no guessing beyond the table), then REPORTS every remaining token
 * that still looks damaged, so the leftovers are visible rather than silently left in place.
 *
 * Usage: node build/repair-arch-t.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('docs/ARCHITECTURE.md');
const write = process.argv.includes('--write');
const original = readFileSync(file, 'utf8');

/** Word-initial 'T' in its usual spellings, then identifiers and all-caps tokens. */
const TABLE = [
  ['ehe', 'The'], ['ehis', 'This'], ['ehat', 'That'], ['ehese', 'These'], ['ehose', 'Those'],
  ['eheir', 'Their'], ['ehere', 'There'], ['ehen', 'Then'], ['ehey', 'They'], ['ehose', 'Those'],
  ['ehrough', 'Through'], ['ehree', 'Three'], ['ehread', 'Thread'], ['ehreshold', 'Threshold'],
  ['eo', 'To'], ['eime', 'Time'], ['eimes', 'Times'], ['eimer', 'Timer'], ['eimers', 'Timers'],
  ['eool', 'Tool'], ['eools', 'Tools'], ['eest', 'Test'], ['eests', 'Tests'], ['eested', 'Tested'],
  ['eesting', 'Testing'], ['eype', 'Type'], ['eypes', 'Types'], ['eyped', 'Typed'], ['eypical', 'Typical'],
  ['eoken', 'Token'], ['eokens', 'Tokens'], ['eop', 'Top'], ['eotal', 'Total'], ['eotals', 'Totals'],
  ['erack', 'Track'], ['eracks', 'Tracks'], ['erack', 'Track'], ['erue', 'True'], ['ruth', 'Truth'],
  ['eurn', 'Turn'], ['eurns', 'Turns'], ['eurned', 'Turned'], ['eurning', 'Turning'],
  ['earget', 'Target'], ['eargets', 'Targets'], ['eask', 'Task'], ['easks', 'Tasks'],
  ['eable', 'Table'], ['eables', 'Tables'], ['eag', 'Tag'], ['eags', 'Tags'],
  ['efore', 'Tfore'],
  // All-caps and identifiers.
  ['eHREE', 'THREE'], ['eEST', 'TEST'], ['eRUE', 'TRUE'], ['eODO', 'TODO'], ['eIMER', 'TIMER'],
  ['eS', 'TS'], ['eCP', 'TCP'], ['eHZ', 'THZ'], ['eUI', 'TUI'], ['eBD', 'TBD'],
  ['Meoon', 'MToon'], ['GEe', 'GET'], ['HIe', 'HIT'], ['eWICE', 'TWICE'],
  ['eRANSLAeION', 'TRANSLATION'], ['RECeANGLE', 'RECTANGLE'],
  ['ehe ', 'The '], ['ehe\n', 'The\n'],
];

let text = original;
let changes = 0;
for (const [from, to] of TABLE) {
  const before = text;
  // Anchored on both sides where the token is a word, so `ehe` inside `whether` is not touched. The
  // all-caps and CamelCase entries are distinctive enough to replace anywhere.
  const boundary = /^[A-Za-z]+$/.test(from) && /^[A-Za-z]+$/.test(to) && from !== to;
  const pattern = boundary ? new RegExp(`\\b${from}\\b`, 'g') : new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  text = text.replace(pattern, to);
  if (text !== before) {
    const hits = (before.match(pattern) || []).length;
    changes += hits;
    console.log(`  ${from} -> ${to}   ${hits}`);
  }
}

/**
 * Second pass: identifier-shaped tokens checked against the rest of the repository.
 *
 * The table above covers words; this covers NAMES. `BLINK_LIMITS` came out as `BLINK_LIMIeS` and
 * `TRANSLATION` as `eRANSLAeION`, and a name is only wrong if the correct spelling exists somewhere else in
 * this repository. So the vocabulary is every token the other files use, and a token that is (a) shaped like
 * an identifier, (b) unknown, and (c) becomes KNOWN when one of its `e`s is read as a `T`, is damage.
 */
const vocabulary = new Set();
const sources = ['README.md', 'HANDOFF.md', 'lib/core.js', 'lib/scene.js', 'lib/client.js', 'lib/index.js',
  'lib/desktop-page.js', 'lib/vrm-info.js', 'lib/config-page.js', 'scripts/verify.mjs', 'scripts/verify-model.mjs',
  'scripts/verify-desktop.mjs', 'scripts/verify-motion.mjs', 'docs/ASSET-CONTRACT.md'];
for (const source of sources) {
  let body = '';
  try { body = readFileSync(resolve(source), 'utf8'); } catch { continue; }
  for (const token of body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) vocabulary.add(token);
}

let passTwo = 0;
text = text.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (token) => {
  // Only identifier-shaped tokens: prose is the table's job, and a word like "these" must not be touched.
  const looksLikeName = token.length >= 4 && /[A-Z_$]/.test(token);
  if (!looksLikeName || vocabulary.has(token)) return token;
  for (let at = 0; at < token.length; at += 1) {
    if (token[at] !== 'e') continue;
    for (const upper of ['T', 't']) {
      const candidate = token.slice(0, at) + upper + token.slice(at + 1);
      if (vocabulary.has(candidate)) {
        passTwo += 1;
        console.log(`  name ${token} -> ${candidate}`);
        return candidate;
      }
    }
  }
  return token;
});
console.log(`\nname repairs: ${passTwo}`);

/**
 * Anything that still looks like the accident: a word starting with a lowercase 'e' followed by a capital
 * letter (`eHREE`), one of the mangled words the table knows, or an all-caps identifier containing a
 * lowercase 'e' (caps have no lowercase letters, so that token is damage by definition).
 */
const suspicious = [];
const lines = text.split('\n');
lines.forEach((line, index) => {
  const matches = line.match(/\be[A-Z][A-Za-z]*|\be(?:he|his|hat|hese|hose|heir|here|hen|hey|hrough|hree|hread|hreshold|o|ime|imes|imer|imers|ool|ools|est|ests|ested|esting|ype|ypes|yped|ypical|oken|okens|op|otal|otals|rack|racks|urn|urns|urned|urning|arget|argets|ask|asks|able|ables|ag|ags)\b/g) || [];
  const capsDamage = (line.match(/\b[A-Z0-9_]*e[A-Z0-9_]*\b/g) || [])
    .filter((token) => token.length >= 3 && /^[A-Z0-9_]+$/.test(token.replace(/e/g, 'T')));
  const all = [...new Set([...matches, ...capsDamage])];
  if (all.length) suspicious.push(`  line ${index + 1}: ${all.join(' ')}  |  ${line.trim().slice(0, 78)}`);
});

console.log(`\nreplacements: ${changes}`);
console.log(`remaining suspicious tokens: ${suspicious.length}`);
for (const line of suspicious.slice(0, 40)) console.log(line);
if (suspicious.length > 40) console.log(`  … and ${suspicious.length - 40} more`);

if (write) {
  writeFileSync(file, text, 'utf8');
  console.log(`\nwrote ${file}`);
}

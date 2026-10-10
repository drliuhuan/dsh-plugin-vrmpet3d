// One-shot repair of the encoding damage introduced by a PowerShell Set-Content
// round trip. Writes with explicit UTF-8 and uses \u escapes throughout so the
// repair script itself cannot be mangled the same way.
import { readFileSync, writeFileSync } from 'node:fs';

const REPLACEMENT = '\uFFFD';   // what a lost byte became
const EM_DASH = '\u2014';
const MIDDLE_DOT = '\u00B7';
const ARROW = '\u2192';

/** Replace every remaining replacement character with an em dash. */
function fixProse(text) {
  return text.split(REPLACEMENT).join(EM_DASH);
}

// --- README.md and HANDOFF.md: every loss was an em dash ---------------------
for (const file of ['README.md', 'HANDOFF.md']) {
  const text = readFileSync(file, 'utf8');
  const before = (text.match(/\uFFFD/g) || []).length;
  writeFileSync(file, fixProse(text), 'utf8');
  console.log(`${file}: ${before} replacement char(s) restored to em dashes`);
}

// --- ARCHITECTURE.md: prose em dashes, plus the box-drawing diagram ----------
{
  const file = 'docs/ARCHITECTURE.md';
  let text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  // Locate the fenced diagram and rebuild it. Rebuilding is less error-prone than
  // guessing which box glyph each lost byte was: the diagram's content is known,
  // and a hand-repaired grid of toppled corners would be worse than a redraw.
  const start = lines.findIndex(line => line.includes('DSH host process'));
  const end = lines.findIndex((line, index) => index > start && line.startsWith('```'));
  if (start < 0 || end < 0) throw new Error('could not locate the diagram fences');

  const diagram = [
    '  +------------------------ DSH host process ------------------------+',
    '  |  lib/index.js                                                    |',
    '  |                                                                  |',
    '  |  session events --> Pet3DBoundaryHub --> pet3d service ----------+--+',
    '  |                                                                  |  |',
    '  |  profile config --> buildCatalog(modelDirs) --> /pet3d/asset ----+--+--+',
    '  +------------------------------------------------------------------+  |  |',
    '                                                                        |  |',
    '  +---------------------- DSH browser page ---------------------------+  |  |',
    '  |  GET /pet3d/catalog ---------------------------------------------+--+  |',
    '  |  GET /pet3d/asset?m=..&p=..  (model + sibling textures) <--------+-----+',
    '  |                                                                  |',
    '  |  lib/client.js   React slot "shell.overlay"                      |',
    '  |    |-- session --> pet state (PetMachine, SessionAggregate)      |',
    '  |    |-- pointer --> drag / throw / land (Placement)               |',
    '  |    `-- settings panel, persistence                               |',
    '  |                        |                                         |',
    '  |                        v                                         |',
    '  |  lib/pet3d.js    Scene: renderer, camera, lights, Motion         |',
    '  |    |-- lib/placeholder.js          procedural avatar             |',
    '  |    `-- lib/client.vendor.js        three.js + VRM + MMD loaders  |',
    '  +------------------------------------------------------------------+',
  ];

  // Keep the fences around the rebuilt diagram.
  const fenced = ['```', ...diagram, '```'];
  lines.splice(start - 1, end - (start - 1) + 1, ...fenced);
  text = lines.join('\n');

  const before = (text.match(/\uFFFD/g) || []).length;
  text = fixProse(text);
  // Tidy the em-dash-free table separators are fine; just normalise the middle dot
  // and arrow that the diagram no longer needs.
  text = text.split(MIDDLE_DOT).join(MIDDLE_DOT).split(ARROW).join(ARROW);
  writeFileSync(file, text, 'utf8');
  console.log(`${file}: diagram rebuilt, ${before} remaining replacement char(s) restored`);
}

// --- final sweep: report anything still damaged ------------------------------
let remaining = 0;
for (const file of ['README.md', 'HANDOFF.md', 'docs/ARCHITECTURE.md', 'docs/ASSET-CONTRACT.md', 'vendor/README.md']) {
  const count = (readFileSync(file, 'utf8').match(/\uFFFD/g) || []).length;
  remaining += count;
  if (count) console.error(`  STILL DAMAGED: ${file} (${count})`);
}
if (remaining) {
  console.error(`\n${remaining} replacement character(s) remain`);
  process.exit(1);
}
console.log('\nall documents are valid UTF-8 with no replacement characters');

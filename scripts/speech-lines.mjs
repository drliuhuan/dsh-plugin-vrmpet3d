// 把 `speech-lines-review.md`（操作者审阅并手改过的稿子）写回 `lib/core.js`。
//
//   node scripts/speech-lines.mjs            # 写回
//   node scripts/speech-lines.mjs --check    # 只比：代码里的三处与这份 MD 是否一致
//
// 这是 `part-speech-lines-review.md` 那条链的姊妹件（`scripts/part-lines.mjs`）。之所以要有它：审阅稿
// 第一行就一直写着「改完告诉我，我用 `node build/probe-out/speech-lines-md.mjs import` 写进 `lib/core.js`」，而那个
// 脚本**不在了** —— 也就是说操作者改了 md 也没有工具写回（2026-10-14 发现）。这条链现在接回来了。
//
// 写回三处，都是「出厂默认」，随包分发：
//   1. `SPEECH_LINES`              —— 7 个池 × 中/英
//   2. `DEFAULT_SPEECH_PERSONA`    —— 人格（逐行原文，中文不加工）
//   3. `SPEECH_LIMITS` 的四条节奏  —— 静息/工作的最小与最大秒数
//
// 中文一个字都不动：MD 是权威，这里只做搬运与排版。英文列按操作者的要求重译后同样以 MD 为准。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MD = join(ROOT, 'speech-lines-review.md');
const CORE = join(ROOT, 'lib', 'core.js');

/** 与 `lib/core.js` 的 `SPEECH_LINES` 同序：MD 的 `##` 顺序即代码里的顺序。 */
const POOLS = ['working', 'done', 'error', 'offline', 'waiting', 'approval', 'idle'];
const LANGS = ['zh', 'en'];
/**
 * 长度护栏，和 `parts/import.mjs` 用同一对数字。
 *
 * 用户自己的框会被 `cleanSpeechLineTable` 按 `SPEECH_LIMITS.lineLength = 40` 截断，而**内置池不过那道清理**
 * （`speechLines()` 直接读表）——所以超长只是警告：操作者的原文必须原样进包，能不能像现在这样显示是另一个问题。
 */
const MAX_ZH = 40;
const MAX_EN = 60;

const problems = [];
const warnings = [];

const PERSONA_HEADING = /^##\s+人格/;
const CADENCE_HEADING = /^##\s+节奏/;
const POOL_HEADING = /^##\s+(\S+)/;

/** `## <pool>` 的正文表格 → `{ zh, en }[]`；同时抓人格与节奏两节。 */
function parseReview(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const pools = new Map();
  let pool = null;
  let mode = null;
  let fence = false;
  let cadence = { idleMinSeconds: null, idleMaxSeconds: null, workingMinSeconds: null, workingMaxSeconds: null };
  const persona = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const heading = POOL_HEADING.exec(trimmed);
    if (heading && !trimmed.startsWith('###')) {
      const name = heading[1];
      pool = null;
      mode = null;
      fence = false;
      if (POOLS.includes(name)) {
        pool = name;
        if (pools.has(name)) problems.push(`${index + 1}: 池 ${name} 出现了两次`);
        pools.set(name, []);
        return;
      }
      if (PERSONA_HEADING.test(trimmed)) {
        mode = 'persona';
        return;
      }
      if (CADENCE_HEADING.test(trimmed)) {
        mode = 'cadence';
        return;
      }
      mode = null; // 「当前状态」之类的说明节
      return;
    }
    if (mode === 'persona') {
      // 人格是一段 ```text 围栏里的原文：逐行照搬，空行丢掉，中文不加标点、不改字。
      if (trimmed.startsWith('```')) {
        fence = !fence;
        return;
      }
      if (fence && trimmed) persona.push(trimmed);
      return;
    }
    if (mode === 'cadence') {
      const cells = trimmed.split('|').map((cell) => cell.trim());
      if (cells.length < 5) return;
      if (!/^\d+$/.test(cells[2])) return; // 表头 / 分隔行
      const min = Number(cells[2]);
      const max = Number(cells[3]);
      if (cells[1].includes('静息')) {
        cadence.idleMinSeconds = min;
        cadence.idleMaxSeconds = max;
      } else if (cells[1].includes('工作')) {
        cadence.workingMinSeconds = min;
        cadence.workingMaxSeconds = max;
      } else {
        problems.push(`${index + 1}: 节奏表里认不出的行 → ${trimmed}`);
      }
      return;
    }
    if (!pool) return;
    if (!trimmed.startsWith('|')) return;
    const cells = trimmed.split('|');
    if (cells.length !== 5) {
      problems.push(`${index + 1}: 这一行不是 4 个竖线 → ${trimmed}`);
      return;
    }
    if (!/^\d+$/.test(cells[1].trim())) return; // 表头 / 分隔行
    pools.get(pool).push({ zh: cells[2].trim(), en: cells[3].trim(), line: index + 1 });
  });
  return { pools, persona, cadence };
}

/** 一条台词在 JS 里的样子：单引号字符串，`\` 与 `'` 转义。 */
function js(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function checkPool(name, lang, rows) {
  const where = `${name}/${lang}`;
  if (!rows.length) {
    problems.push(`${where}: 这一池是空的（每个池至少留 1 条）`);
    return;
  }
  // 上限只对用户自己的框生效（`SPEECH_LIMITS.maxLines = 30`），内置池按原样进包 —— working 现在就是 41 条。
  const seen = new Set();
  for (const row of rows) {
    const text = row[lang];
    const limit = lang === 'zh' ? MAX_ZH : MAX_EN;
    if (!text) problems.push(`${where}:${row.line}: ${lang} 列是空的`);
    if (text.includes('|')) problems.push(`${where}:${row.line}: 台词里有竖线，会写坏代码`);
    if (text.length > limit) warnings.push(`${where}:${row.line}: ${lang} 列 ${text.length} 字，超过建议的 ${limit} → ${text}`);
    if (seen.has(text)) problems.push(`${where}:${row.line}: 与同一池里前面的一条完全重复 → ${text}`);
    seen.add(text);
  }
}

const review = parseReview(readFileSync(MD, 'utf8'));
for (const name of POOLS) {
  const rows = review.pools.get(name);
  if (!rows) {
    problems.push(`审阅稿缺少池 ${name}`);
    continue;
  }
  for (const lang of LANGS) checkPool(name, lang, rows);
}
if (!review.persona.length) problems.push('审阅稿里没有人格（```text 围栏是空的）');
for (const key of Object.keys(review.cadence)) {
  if (review.cadence[key] === null) problems.push(`节奏表里没有 ${key}`);
}

if (problems.length) {
  console.error(`审阅稿有 ${problems.length} 个问题，什么都没写：`);
  for (const line of problems) console.error('  ' + line);
  process.exit(1);
}
if (warnings.length) {
  console.log(`${warnings.length} 条超长（只是提醒，照样写回）：`);
  for (const line of warnings.slice(0, 20)) console.log('  ' + line);
}

/** `SPEECH_LINES` 的对象字面量，排版照代码里现在的样子：一池一块，中英各一行。 */
const poolBlocks = POOLS.map((name) => {
  const rows = review.pools.get(name);
  return `    ${name}: {\n`
    + `      zh: [${rows.map((row) => js(row.zh)).join(', ')}],\n`
    + `      en: [${rows.map((row) => js(row.en)).join(', ')}],\n`
    + '    },';
});
const speechLiteral = `  var SPEECH_LINES = {\n${poolBlocks.join('\n')}\n  };`;

const personaLiteral = '  var DEFAULT_SPEECH_PERSONA = [\n'
  + review.persona.map((line) => `      ${js(line)},`).join('\n')
  + '\n  ].join(String.fromCharCode(10));';

const source = readFileSync(CORE, 'utf8');

/** 替换一个「起止标记」包住的块，找不到就报错退出（绝不半改）。 */
function replaceBlock(text, marker, endMarker, literal, label) {
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`在 lib/core.js 里找不到 ${label} 的开头（${marker}）`);
  const tail = text.indexOf(endMarker, start);
  if (tail === -1) throw new Error(`找不到 ${label} 的结尾（${endMarker}）`);
  const end = tail + endMarker.length;
  return text.slice(0, start) + literal + text.slice(end);
}

let next = replaceBlock(source, '  var SPEECH_LINES = {', '\n  };', speechLiteral, 'SPEECH_LINES');
next = replaceBlock(next, '  var DEFAULT_SPEECH_PERSONA = [', '\n  ].join(String.fromCharCode(10));', personaLiteral, 'DEFAULT_SPEECH_PERSONA');

/**
 * 节奏：只动 `SPEECH_LIMITS` 里那四个键，且**只在数字真的不同时**才改。
 *
 * 逐个 `key: value` 替换而不是重写整块，是因为这一块里还有换行宽度、长度上限等一堆与节奏无关的常量，重写会把
 * 它们一起卷进来。四条的键名是唯一的，而数值本身也是它们的一部分，所以「找 `idleMinSeconds: 20,`」是安全的。
 */
const cadenceNow = {
  idleMinSeconds: /idleMinSeconds:\s*(\d+)/.exec(next),
  idleMaxSeconds: /idleMaxSeconds:\s*(\d+)/.exec(next),
  workingMinSeconds: /workingMinSeconds:\s*(\d+)/.exec(next),
  workingMaxSeconds: /workingMaxSeconds:\s*(\d+)/.exec(next),
};
for (const key of Object.keys(review.cadence)) {
  const current = cadenceNow[key] ? Number(cadenceNow[key][1]) : null;
  const wanted = review.cadence[key];
  if (current === null) {
    problems.push(`lib/core.js 的 SPEECH_LIMITS 里找不到 ${key}`);
    continue;
  }
  if (current === wanted) continue;
  next = next.replace(new RegExp(`${key}:\\s*${current},`), `${key}: ${wanted},`);
}

if (problems.length) {
  console.error(`写回前发现 ${problems.length} 个问题，什么都没写：`);
  for (const line of problems) console.error('  ' + line);
  process.exit(1);
}

const total = POOLS.reduce((sum, name) => sum + review.pools.get(name).length, 0);

if (process.argv.includes('--check')) {
  const same = next === source;
  console.log(same
    ? `lib/core.js 与审阅稿一致（${total} 条台词 · ${review.persona.length} 行人格 · 节奏 ${review.cadence.idleMinSeconds}-${review.cadence.idleMaxSeconds}/${review.cadence.workingMinSeconds}-${review.cadence.workingMaxSeconds}）`
    : 'lib/core.js 与审阅稿不一致 —— 跑 node build/probe-out/speech-lines-md.mjs 写回');
  process.exit(same ? 0 : 1);
}

writeFileSync(CORE, next, 'utf8');
console.log(`写回 lib/core.js：${POOLS.length} 个池 × 中英 = ${total * 2} 条台词，人格 ${review.persona.length} 行，节奏 ${review.cadence.idleMinSeconds}-${review.cadence.idleMaxSeconds} / ${review.cadence.workingMinSeconds}-${review.cadence.workingMaxSeconds} 秒`);
for (const name of POOLS) console.log(`  ${name.padEnd(9)} ${review.pools.get(name).length} 条`);

// 把 `part-speech-lines-review.md`（操作者审阅并手改过的稿子）写回 `lib/core.js` 的 `DEFAULT_PART_LINES`。
//
//   node scripts/part-lines.mjs           # 写回
//   node scripts/part-lines.mjs --check   # 只比：仓库里的表与这份 MD 是否一致
//
// 这是这条数据链的另一半：`check.mjs` 管分片的自检，`assemble.mjs` 把分片拼成审阅稿，这里把审阅稿写回代码。
// 审阅稿是**权威**——操作者会直接改它，所以导入只认 MD，不再读分片。正文以外的排版（注释、形状）在代码里手写，
// 这里只替换对象字面量本身。

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MD = join(ROOT, 'part-speech-lines-review.md');
const CORE = join(ROOT, 'lib', 'core.js');

/** 与 `lib/core.js` 的 `STRUCTURE_REGIONS` 同序：标题顺序即代码里的顺序。 */
const REGIONS = [
  ['eye', '眼睛'],
  ['head', '头'],
  ['hand', '手 / 手臂'],
  ['body', '身体'],
  ['upperLeg', '大腿'],
  ['lowerLeg', '小腿'],
  ['foot', '脚'],
  ['chest', '胸部'],
  ['butt', '屁股'],
  ['tail', '尾巴'],
];
const GESTURES = ['click', 'hold'];
const LANGS = ['zh', 'en'];
const MAX_ZH = 40;
const MAX_EN = 60;

const problems = [];

/** `## <id> — <label>` 的正文，按部位切出来。 */
function parseReview(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = new Map();
  let region = null;
  let gesture = null;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const heading = /^##\s+([A-Za-z]+)\s+—/.exec(trimmed);
    if (heading) {
      region = heading[1];
      gesture = null;
      if (!REGIONS.some(([id]) => id === region)) {
        problems.push(`${index + 1}: 审阅稿里的部位 id「${region}」不是自带部位`);
        region = null;
        return;
      }
      if (out.has(region)) problems.push(`${index + 1}: 部位 ${region} 出现了两次`);
      out.set(region, { click: [], hold: [] });
      return;
    }
    const sub = /^###\s+(click|hold)\b/.exec(trimmed);
    if (sub) {
      gesture = sub[1];
      return;
    }
    if (!trimmed.startsWith('|')) return;
    /**
     * 只有部位小节里的表格算数：页首那张「部位与条数」表（6 列）和任何说明表格都在 `##` 之外或没有
     * `###` 手势小节，它们不是台词。
     */
    if (!region || !gesture) return;
    const cells = trimmed.split('|');
    if (cells.length !== 5) {
      problems.push(`${index + 1}: 这一行不是 4 个竖线 → ${trimmed}`);
      return;
    }
    const number = cells[1].trim();
    if (!/^\d+$/.test(number)) return; // 表头 / 分隔行
    out.get(region)[gesture].push({ zh: cells[2].trim(), en: cells[3].trim(), line: index + 1 });
  });
  return out;
}

/** 一条台词在 JS 里的样子：单引号字符串，`\` 与 `'` 转义。 */
function js(text) {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function checkPool(region, gesture, lang, rows) {
  const where = `${region}/${gesture}/${lang}`;
  if (!rows.length) {
    problems.push(`${where}: 这一池是空的（每个小节至少留 1 条）`);
    return;
  }
  if (rows.length > 30) problems.push(`${where}: ${rows.length} 条，超过 SPEECH_LIMITS.maxLines = 30`);
  const seen = new Set();
  for (const row of rows) {
    const text = row[lang];
    const limit = lang === 'zh' ? MAX_ZH : MAX_EN;
    if (!text) problems.push(`${where}:${row.line}: ${lang} 列是空的`);
    if (text.includes('|')) problems.push(`${where}:${row.line}: 台词里有竖线，会写坏代码`);
    if (text.length > limit) {
      problems.push(`${where}:${row.line}: ${lang} 列 ${text.length} 字，超过 ${limit} → ${text}`);
    }
    if (seen.has(text)) problems.push(`${where}:${row.line}: 与同一池里前面的一条完全重复 → ${text}`);
    seen.add(text);
  }
}

const review = parseReview(readFileSync(MD, 'utf8'));
for (const [id] of REGIONS) {
  if (!review.has(id)) {
    problems.push(`审阅稿缺少部位 ${id}`);
    continue;
  }
  const entry = review.get(id);
  for (const gesture of GESTURES) {
    for (const lang of LANGS) checkPool(id, gesture, lang, entry[gesture]);
  }
}

if (problems.length) {
  console.error(`审阅稿有 ${problems.length} 个问题，什么都没写：`);
  for (const line of problems) console.error('  ' + line);
  process.exit(1);
}

/** 生成对象字面量，风格照 `SPEECH_LINES`：一个数组一行，中英一上一下。 */
const entries = [];
let total = 0;
for (const [id, label] of REGIONS) {
  const entry = review.get(id);
  const pools = [];
  for (const gesture of GESTURES) {
    const rows = entry[gesture];
    total += rows.length;
    pools.push(
      `      ${gesture}: {\n`
      + `        zh: [${rows.map((row) => js(row.zh)).join(', ')}],\n`
      + `        en: [${rows.map((row) => js(row.en)).join(', ')}],\n`
      + '      },',
    );
  }
  entries.push(`    // ${label}（${id}）\n    ${id}: {\n${pools.join('\n')}\n    },`);
}
const literal = `  var DEFAULT_PART_LINES = {\n${entries.join('\n')}\n  };`;

const source = readFileSync(CORE, 'utf8');
const marker = '  var DEFAULT_PART_LINES = {';
const start = source.indexOf(marker);
if (start === -1) {
  console.error(`在 ${CORE} 里找不到 ${marker}`);
  process.exit(1);
}
const tail = source.indexOf('\n  };', start);
if (tail === -1) {
  console.error('找不到 DEFAULT_PART_LINES 的结尾 `  };`');
  process.exit(1);
}
const end = tail + '\n  };'.length;
const next = source.slice(0, start) + literal + source.slice(end);

if (process.argv.includes('--check')) {
  const same = next === source;
  console.log(same
    ? `lib/core.js 与审阅稿一致（${total} 条台词）`
    : 'lib/core.js 与审阅稿不一致 —— 跑 node build/probe-out/parts/import.mjs 写回');
  process.exit(same ? 0 : 1);
}

writeFileSync(CORE, next, 'utf8');
console.log(`写回 lib/core.js：10 个部位 × 点击/长按 × 中英 = ${total} 条台词`);
for (const [id] of REGIONS) {
  const entry = review.get(id);
  console.log(`  ${id.padEnd(9)} click ${entry.click.length}  hold ${entry.hold.length}`);
}

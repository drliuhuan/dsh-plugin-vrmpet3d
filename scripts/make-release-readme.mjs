#!/usr/bin/env node
/**
 * Generate main's user README from dev, excluding developer sections.
 * node scripts/make-release-readme.mjs --out <file>
 * node scripts/make-release-readme.mjs --check <file>
 * Unknown sections fail instead of silently publishing developer notes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = ['功能', '运行要求', '安装', '首次使用', '模型、动作与数据', 'License'];
const DROP = ['Verification', 'Project layout', 'Documentation'];
const sections = [];
let current = { title: null, body: [] };
for (const line of readFileSync(join(ROOT, 'README.md'), 'utf8').split(/\r?\n/)) {
  const heading = /^##\s+(.+?)\s*$/.exec(line);
  if (heading) {
    sections.push(current);
    current = { title: heading[1], body: [line] };
  } else current.body.push(line);
}
sections.push(current);
const out = [];
for (const section of sections) {
  if (DROP.includes(section.title)) continue;
  if (section.title !== null && !KEEP.includes(section.title)) {
    throw new Error(`未分类的 README 段落：${section.title}`);
  }
  out.push(...section.body);
}
const badge = /no runtime dependencies · \d+ verification suites · \d+ checks · works offline/;
let text = out.join('\n');
if (!badge.test(text)) throw new Error('README 验证摘要格式变化，请更新发布变换');
text = text.replace(badge, 'no runtime dependencies · works offline').replace(/\n*$/, '\n');
for (const forbidden of ['scripts/', 'docs/', 'HANDOFF', 'AGENTS', 'verify-all', 'verification suites', 'dev branch']) {
  if (text.includes(forbidden)) throw new Error(`发布 README 含开发内容：${forbidden}`);
}
const args = process.argv.slice(2);
const check = args.indexOf('--check');
const output = args.indexOf('--out');
if (check !== -1) {
  const target = args[check + 1];
  const same = readFileSync(target, 'utf8').replace(/\r\n?/g, '\n') === text;
  console.log(same ? `${target} 就是本脚本的产物` : `${target} 与脚本产物不一致`);
  process.exit(same ? 0 : 1);
} else if (output !== -1) {
  writeFileSync(args[output + 1], text, 'utf8');
  console.log(`写出发行版 README：${args[output + 1]}（${text.split('\n').length} 行）`);
} else process.stdout.write(text);

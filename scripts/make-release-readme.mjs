#!/usr/bin/env node
/**
 * 从 **dev 的 README** 生成 **main 的 README**：同一个产品说明，去掉只在开发时成立的部分。
 *
 *   node scripts/make-release-readme.mjs                    # 打印到 stdout
 *   node scripts/make-release-readme.mjs --out <file>        # 写到文件（main worktree 的 README.md）
 *   node scripts/make-release-readme.mjs --check <file>      # 只比：那份文件是否就是本脚本的产物
 *
 * 为什么要一个脚本而不是手写两份：两份文档一定会漂移，而漂移的方向每次都一样 —— dev 修好了事实，main 还留着旧的。
 * 这里把「main 应该长什么样」写成可执行的定义：删掉哪些段落、替换哪几句话，全部锚定在 dev 的原文上，锚点找不到就报错退出。
 *
 * 删掉的三段（操作者，2026-10-14：「main分支不要有任何开发者笔记，同时清理Readme等其他地方的开发者笔记」）：
 * `## Verification`、`## Project layout`、`## Documentation` —— 它们讲的是套件、工具目录和开发笔记。
 * 另外重写的是**安装**（用户走插件管理器，不跑仓库里的安装脚本）与几处会指向 main 上不存在的文件的链接。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'README.md');

/** 保留的段落，按 dev 里的顺序。 */
const KEEP = ['What it does', 'Requirements', 'Install', 'Quick start', 'VRM only', 'License'];
/** 删掉的段落：开发者笔记。 */
const DROP = ['Verification', 'Project layout', 'Documentation'];

/** 逐句替换：每一条都锚定 dev 的原文，找不到就报错。 */
const REWRITES = [
  [
    /no runtime dependencies · \d+ verification suites · \d+ checks · works offline/,
    'no runtime dependencies · works offline',
  ],
  [
    `**VRM and plain glTF only.** A \`.pmx\`/\`.pmd\` model or a \`.vmd\` motion is refused by name — the bytes are still
sniffed, so the error says which format it found — and [docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md) keeps the
retired MMD chapters.`,
    `**VRM and plain glTF only.** A \`.pmx\`/\`.pmd\` model or a \`.vmd\` motion is refused by name: the file's own bytes are
sniffed as it is loaded, so the message names the format it found instead of failing halfway through a load.`,
  ],
  [
    `* For the scripts: **Node 22+**. A Chromium-based browser (Edge or Chrome) for the browser suites.
* A model file.`,
    `* A model file.`,
  ],
  [
    `A \`.pmx\`/\`.pmd\`, or a \`.vmd\` motion, is **refused by name** rather than half-loaded: the file's magic bytes (or the
VMD banner) are still recognised, so the message can name the format and point at
[docs/ASSET-CONTRACT.md](docs/ASSET-CONTRACT.md), where the retired MMD chapters are kept.`,
    `A \`.pmx\`/\`.pmd\`, or a \`.vmd\` motion, is **refused by name** rather than half-loaded: the file's magic bytes (or the
VMD banner) are still recognised, so the message names the format it found.`,
  ],
  [
    `listed as the VRMA it is (marked 已压缩). \`npm run pack:motions <dir>\` is how a clip is packed. Brotli rather than
LZMA2 because Node cannot decode LZMA without a dependency this plugin does not have — the measurements are in
[assets/motions/README.md](assets/motions/README.md).`,
    `listed as the VRMA it is (marked 已压缩). Brotli rather than LZMA2 because Node cannot decode LZMA without a dependency
this plugin does not have; the measurements are in [assets/motions/README.md](assets/motions/README.md).`,
  ],
  [
    '| **States** | `resting` `working` `waiting` `celebrate` `sleeping` `error` `greeting` `offline` `held` `falling` `landing`, all driven by DSH\'s own turn boundaries |',
    '| **States** | `resting` `working` `waiting` `done` `sleeping` `error` `greeting` `offline` `dancing`, plus the pointer poses `held` `falling` `landing` — all driven by DSH\'s own turn boundaries, except 跳舞 which is yours (跳支舞 on the menu) |',
  ],
  [
    '| **One menu** | right-click either pet: 重置视角 / 重置大小 / 通用设置 / 切换模型 / 当前模型参数设置 / 切换表面 / 重力 / 隐藏宠物 |',
    '| **One menu** | right-click either pet: 重置视角 / 重置大小 / 通用设置 / 切换模型 / 跳支舞 / 重载模型 / 当前模型参数设置 / 切换表面 / 重力 / 隐藏宠物 |',
  ],
  [
    '| **Voice** | the status prompt above the head, plus 碎碎念 from built-in tables (20 lines per state, Chinese and English, in the shipped character\'s voice), your own lines, or a model (a DSH provider or any OpenAI-compatible endpoint) |',
    '| **Voice** | the status prompt above the head, plus 碎碎念 from built-in tables (20–41 lines per state, Chinese and English, in the shipped character\'s voice), your own lines, or a model (a DSH provider or any OpenAI-compatible endpoint) — the shipped lines arrive IN your own boxes, so they are yours to edit |',
  ],
];

/** main 的安装段落：只讲用户会走的那条路。 */
const INSTALL = `## Install

The plugin is **not published to npm**. Add it through the running app's **plugin manager** as a bundle with a
\`link:<absolute path to this folder>\` spec, then restart DSH: this build watches no module roots, so a running app
does not pick a new bundle up by itself, and the host half is not hot-reloaded.

A later **edit** to the plugin needs the same restart. To remove it, drop the bundle in the plugin manager — that
reverses the same changes — or restore the \`package.json.bak-<stamp>\` the manager left in your profile directory.

> **⚠️ A restart is not enough: check the PROFILE, not just the code.** A running DSH writes its profile back to disk,
> and **a bundle its in-memory tree does not know about is dropped** — so a plugin that was disabled in the manager and
> then had the app write the profile is gone from \`dsh.profile.bundles\`, and the next restart composes no pet at all:
> no window, no \`/vrmpet3d/*\` routes, nothing on screen to explain it. Open the plugin manager and check that
> \`dsh-plugin-vrmpet3d\` is still listed before you blame the pet.
>
> Disable any other pet first — \`dsh-plugin-fatfish-pet\` and \`dsh-plugin-whale-pet\` register into the same
> \`shell.overlay\` slot.`;

/** main 的「装了什么」段落，替代 dev 的 Project layout。 */
const LAYOUT = `## What ships

\`\`\`
lib/        the plugin: core.js (rules) · index.js (host routes) · scene.js (renderer)
            client.js (in-app pet) · desktop-page.js (floating window) · config-page.js (settings)
            client.*.js — the DELIVERED chunks, generated, never hand-edited
desktop/    the launcher: the window, the always-on-top rules, the self-test
assets/     the two bundled models (BlueFatFish.vrm.br · SampleModel.vrm.br)
            and the motion pack (assets/motions/, one folder per state)
initial-config/  the settings this release was built from, as a record
\`\`\``;

const source = readFileSync(SOURCE, 'utf8');
const lines = source.split(/\r?\n/);

/** 按 `## ` 切段，第一段（标题 + 引言）单独保留。 */
const sections = [];
let current = { title: null, body: [] };
for (const line of lines) {
  const heading = /^##\s+(.+?)\s*$/.exec(line);
  if (heading) {
    sections.push(current);
    current = { title: heading[1], body: [line] };
    continue;
  }
  current.body.push(line);
}
sections.push(current);

const problems = [];
let out = [];
for (const section of sections) {
  if (section.title === null) {
    out.push(...section.body);
    continue;
  }
  if (DROP.includes(section.title)) continue;
  if (!KEEP.includes(section.title)) {
    problems.push(`dev 的 README 里出现了未分类的段落「${section.title}」——请在本脚本的 KEEP/DROP 里表态`);
    continue;
  }
  if (section.title === 'Install') {
    out.push(INSTALL);
    continue;
  }
  if (section.title === 'License') {
    out.push(LAYOUT, '');
  }
  out.push(...section.body);
}

let text = out.join('\n');
for (const [from, to] of REWRITES) {
  if (!(from instanceof RegExp ? from.test(text) : text.includes(from))) {
    problems.push(`找不到要替换的段落：${String(from).split('\n')[0].slice(0, 70)}…`);
    continue;
  }
  text = text.replace(from, to);
}
// 末尾补一个换行，和仓库里其它文件一致。
text = text.replace(/\n*$/, '\n');

if (problems.length) {
  console.error(`生成失败，${problems.length} 个问题：`);
  for (const line of problems) console.error('  ' + line);
  process.exit(1);
}

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const checkIndex = args.indexOf('--check');
if (checkIndex !== -1) {
  const target = args[checkIndex + 1];
  const current = readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
  const same = current === text;
  console.log(same ? `${target} 就是本脚本的产物` : `${target} 与脚本产物不一致 —— 跑 --out 重新生成`);
  process.exit(same ? 0 : 1);
}
if (outIndex !== -1) {
  const target = args[outIndex + 1];
  writeFileSync(target, text, 'utf8');
  console.log(`写出发行版 README：${target}（${text.split('\n').length} 行）`);
} else {
  process.stdout.write(text);
}

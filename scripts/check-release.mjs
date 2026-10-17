#!/usr/bin/env node
/**
 * 发布树自检：一个「只带插件与发布输入」的树该长什么样。
 *
 *   node scripts/check-release.mjs [<树>]            # 默认检查 ../vrmpet3d-main
 *   node scripts/check-release.mjs <树> --prune      # 顺手删掉不该带的未压缩模型/动作
 *
 * WHY. 发布是「路径限定 checkout」（见 main 的 8328e27）：把 dev 的若干路径取到 main 上。这条路有两个反复出现的坑，
 * 两个都真的发生过：
 *
 *   1. **未压缩的 .vrm/.vrma 被一起带过去**。`git checkout dev -- assets` 会把新文件加进 main，但**不会**删掉 main 上
 *      旧的同义文件 —— 于是 2026-10-15 那次 main 同时躺着 28 支 `.br` 和一批旧的 `.vrma`（体积翻倍，而且用户会在
 *      面板里看到同一支动作两遍）。`--prune` 就是为这一步准备的。
 *   2. **开发者材料漏进 main**。`scripts/`、`build/`、`docs/`、`HANDOFF.md`、`AGENTS.md`、`tools/`、`vendor/` 与两份
 *      审阅稿都不该出现（操作者，2026-10-14：「main分支不要有任何开发者笔记」）。
 *
 * 检查而不是「记得删」：这些是手工步骤，而手工步骤的失败方式是静默的。
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TREE = resolve(HERE, '..', '..', 'vrmpet3d-main');

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const tree = resolve(args.find((arg) => !arg.startsWith('--')) || DEFAULT_TREE);

if (!existsSync(join(tree, 'package.json'))) {
  console.error(`不像一棵插件树（没有 package.json）：${tree}`);
  process.exit(2);
}

const failures = [];
const notes = [];
const pruned = [];

/** main 上不该出现的东西，连同它们为什么不该在。 */
const FORBIDDEN = [
  ['scripts', '套件与工具'],
  ['build', '探针与一次性工具'],
  ['docs', '设计文档与资产契约'],
  ['HANDOFF.md', '开发交接笔记'],
  ['MINI_GAME_HANDOFF.md', '小游戏开发交接笔记'],
  ['AGENTS.md', '工作规则'],
  ['tools', 'asar 提取器'],
  ['vendor', '3D 栈构建输入'],
  ['speech-lines-review.md', '台词审阅稿'],
  ['part-speech-lines-review.md', '部位台词审阅稿'],
];

/** 未压缩的模型与动作：包里一律以 `.br` 存放。 */
const UNCOMPRESSED = ['.vrm', '.glb', '.gltf', '.vrma'];

const relativeOf = (path) => relative(tree, path).split(sep).join('/');

/** 递归列出文件（不跟随符号链接：发布树里不该有链接）。 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

// ---- 1. 开发者材料 ------------------------------------------------------------
for (const [name, why] of FORBIDDEN) {
  if (existsSync(join(tree, name))) failures.push(`不该带 ${name}（${why}）`);
}
if (!existsSync(join(tree, 'lib', 'index.js'))) failures.push('缺少 lib/index.js');
if (!existsSync(join(tree, 'cordis.patch.yml'))) failures.push('缺少 cordis.patch.yml');
if (!existsSync(join(tree, 'LICENSE'))) failures.push('缺少 LICENSE');
if (!existsSync(join(tree, 'README.md'))) failures.push('缺少 README.md');

// ---- 2. 未压缩的模型与动作 ----------------------------------------------------
const assetsDir = join(tree, 'assets');
const assetFiles = existsSync(assetsDir) ? walk(assetsDir) : [];
const plain = assetFiles.filter((file) => UNCOMPRESSED.some((ext) => file.toLowerCase().endsWith(ext)));
if (prune) {
  for (const file of plain) {
    rmSync(file, { force: true });
    pruned.push(relativeOf(file));
  }
} else if (plain.length) {
  failures.push(`带上了 ${plain.length} 个未压缩的模型/动作文件：${plain.map(relativeOf).slice(0, 6).join(', ')}${plain.length > 6 ? ' …' : ''}`);
}
for (const file of plain) {
  const twin = file + '.br';
  if (existsSync(twin)) notes.push(`${relativeOf(file)} 已有 .br 版本 —— 正是要删掉的那一种`);
}
const packed = assetFiles.filter((file) => file.toLowerCase().endsWith('.br'));
notes.push(`压缩资产：${packed.length} 个（${pruned.length ? '本次删掉 ' + pruned.length + ' 个未压缩的' : '未压缩的 0 个'}）`);

// ---- 3. 两份清单里的名字都要能解析到文件 --------------------------------------
const motionManifest = join(assetsDir, 'motions', 'vrmpet3d-motions.json');
if (!existsSync(motionManifest)) {
  failures.push('缺少 assets/motions/vrmpet3d-motions.json');
} else {
  const manifest = JSON.parse(readFileSync(motionManifest, 'utf8'));
  const have = new Set(assetFiles.map((file) => relative(join(assetsDir, 'motions'), file).split(sep).join('/')));
  let dangling = 0;
  for (const names of Object.values(manifest.defaults || {})) {
    for (const name of names) if (!have.has(name)) { failures.push(`动作清单 defaults 指向不存在的文件：${name}`); dangling += 1; }
  }
  for (const entries of Object.values(manifest.template || {})) {
    for (const name of Object.keys(entries)) if (!have.has(name)) { failures.push(`动作清单 template 指向不存在的文件：${name}`); dangling += 1; }
  }
  for (const name of Object.keys(manifest.clips || {})) {
    if (!have.has(name)) { failures.push(`动作清单 clips 指向不存在的文件：${name}`); dangling += 1; }
  }
  if (!dangling) notes.push(`动作清单：${Object.keys(manifest.clips || {}).length} 支剪辑，名字全部解析成功`);
}
const modelManifest = join(assetsDir, 'models', 'vrmpet3d-models.json');
if (!existsSync(modelManifest)) {
  failures.push('缺少 assets/models/vrmpet3d-models.json');
} else {
  const models = JSON.parse(readFileSync(modelManifest, 'utf8')).springs || {};
  const have = new Set(assetFiles.map((file) => relative(join(assetsDir, 'models'), file).split(sep).join('/')));
  for (const name of Object.keys(models)) {
    if (!have.has(name)) failures.push(`弹簧骨清单指向不存在的模型：${name}`);
  }
  notes.push(`弹簧骨清单：${Object.keys(models).length} 个模型`);
}

// ---- 4. package.json ---------------------------------------------------------
const pkg = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8'));
if (!pkg.displayName) failures.push('package.json 缺少 displayName（插件管理器显示的名字）');
for (const entry of Array.isArray(pkg.files) ? pkg.files : []) {
  if (entry.startsWith('!')) continue;
  if (!existsSync(join(tree, entry))) failures.push(`files[] 里的 ${entry} 在树里不存在`);
}
if (pkg.scripts && Object.keys(pkg.scripts).length) {
  const referencing = Object.entries(pkg.scripts).filter(([, command]) => String(command).includes('scripts/'));
  if (referencing.length) failures.push(`package.json 仍带着指向 scripts/ 的 npm scripts：${referencing.map(([name]) => name).join(', ')}`);
}
notes.push(`files[]：${(pkg.files || []).join(', ')}`);

// ---- 5. README 里不该有开发者指路 --------------------------------------------
const readme = existsSync(join(tree, 'README.md')) ? readFileSync(join(tree, 'README.md'), 'utf8') : '';
for (const needle of ['scripts/', 'docs/', 'HANDOFF', 'AGENTS', 'verify-all', 'verification suites', 'dev branch']) {
  if (readme.includes(needle)) failures.push(`README 里仍提到「${needle}」`);
}

// ---- 5b. 通用设置里不该显示调试模式 ------------------------------------------
/**
 * The debug switch is a developer tool (two renderers side by side) and never belongs in a release.
 *
 * `lib/global-page.html` carries it in dev, so a plain `git checkout dev -- lib` brings it BACK — which is exactly the kind of
 * silent step this script exists to catch. The release copy is produced by `scripts/make-release-pages.mjs`, and this assertion is
 * what fails when somebody forgets to run it after a sync.
 */
const globalPage = join(tree, 'lib', 'global-page.html');
if (existsSync(globalPage)) {
  const text = readFileSync(globalPage, 'utf8');
  if (text.includes('调试模式') || text.includes('pref-both')) {
    failures.push('通用设置里仍显示调试模式（运行 node scripts/make-release-pages.mjs）');
  }
  notes.push('通用设置：无调试模式');
}

// The production game must ignore URL toggles, not merely hide its debug link.
const gamePage = join(tree, 'lib', 'mini-game-page.js');
if (existsSync(gamePage)) {
  const source = readFileSync(gamePage, 'utf8');
  if (!source.includes('var testMode = false;') || !source.includes('var debugMode = false;')
    || source.includes("get('debug')") || source.includes("get('test')") || source.includes("debugLink")) {
    failures.push('小游戏仍有 debug/test 入口或查询开关（运行 make-release-pages）');
  }
  notes.push('小游戏：debug/test 已关闭；默认关卡解锁限制保留');
}

// ---- 6. initial-config 里不该有本机事实 --------------------------------------
const configFile = join(tree, 'initial-config', 'vrmpet3d-settings.json');
if (existsSync(configFile)) {
  const prefs = (JSON.parse(readFileSync(configFile, 'utf8')).preferences) || {};
  const MACHINE = ['modelId', 'modelFiles', 'modelImports', 'statusScale', 'placementX', 'placementY',
    'x', 'y', 'viewYaw', 'viewPitch', 'springs', 'motions', 'motionClips', 'motionLoop', 'motionEvery', 'petSurface'];
  for (const key of MACHINE) {
    if (prefs[key] !== undefined) failures.push(`initial-config 里仍有本机事实/按 id 的快照：${key}`);
  }
  const live = JSON.parse(readFileSync(configFile, 'utf8')).live;
  if (live !== undefined) failures.push('initial-config 里仍有 live 运行态');
  notes.push('initial-config：只留通用观感设置');
}

// ---- 报告 --------------------------------------------------------------------
console.log(`发布树自检：${tree}`);
for (const line of notes) console.log('  · ' + line);
if (pruned.length) console.log(`  已删除 ${pruned.length} 个未压缩资产（--prune）`);
if (failures.length) {
  console.log(`\n${failures.length} 个问题：`);
  for (const line of failures) console.log('  ✗ ' + line);
  process.exit(1);
}
console.log('\n通过：这是一棵可以发布的树。');

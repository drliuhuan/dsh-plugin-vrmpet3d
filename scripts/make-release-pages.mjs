// 发布变换：把通用设置里的「调试模式（同时显示两个宠物）」从发布树里去掉。
//
//   node scripts/make-release-pages.mjs            # 生成/更新默认目标（../vrmpet3d-main）
//   node scripts/make-release-pages.mjs --check    # 只断言发布树里没有这一行
//   node scripts/make-release-pages.mjs <tree>     # 指定发布树
//
// 为什么不直接在 dev 里删掉：它是**开发者工具**（把两个渲染器并排看），dev 需要它，发布版不该让用户看到 —— 而且操作者自己就曾
// 在「同时显示两个宠物」这个状态下踩到坑（两个窗口抢同一个 Chromium profile）。仓库里同类问题的既有做法是「发布树由 dev 生成」
// （见 `scripts/make-release-readme.mjs` 生成 main 的 README），所以这里同样是一次可复跑、可断言、可 review 的变换。
//
// 只动 MARKUP：`both` 作为 `petSurface` 的取值仍然被 core 支持（`core.PET_SURFACES`），页面脚本对 `pref-both` 的绑定本来就是
// 「元素不在就不绑」，所以删掉这一行不会留下半截接线。
//
// ⚠️ 一处必须知道的行为后果：设置页里**没有**「显示位置」选择器 —— `petSurface` 在设置页只有这个复选框能改（其余入口是右键菜单和首启
// 向导的「桌宠界面」那一步）。所以一个停在 `both` 的 profile 在发布版里，明显的出路就只剩**重新运行引导**。删除前请确认这一点可接受：
// 本次操作者的 profile 正是 `both`，我另行告知了他出路（或用设置路由直接改回 auto）。若将来要让发布版自动收敛，做法是在 core 里写一次
// 迁移（把 `both` 读成 `auto`），而不是在这里偷偷改语义 —— 那会让发布树与 dev 的 `lib` 出现代码级差异。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const target = resolve(args.find((arg) => !arg.startsWith('--')) || join(ROOT, '..', 'vrmpet3d-main'));
const PAGE = join('lib', 'global-page.html');

/**
 * The debug row, exactly as dev carries it: the comment above it and the row itself.
 *
 * Matched as one literal block rather than by line numbers, so a shift in the file does not silently strip the wrong thing — and a
 * miss is a hard failure rather than a no-op, because a release that quietly kept the row would be the bug this exists to prevent.
 */
const DEBUG_BLOCK = `    <!--
      调试模式: the two surfaces at once.

      Normally they are exclusive by design — while the floating window runs, the pet inside the app is hidden —
      which is exactly what makes a difference between the two renderers impossible to see. Switching this on
      shows both, so the same state, prompt, pose or size can be compared side by side. It is the \`both\` value
      of 显示位置, not a second flag (see \`core.PET_SURFACES\`), so clearing it returns the pet to 自动.
    -->
    <div class="row">
      <label class="k" for="pref-both">调试模式</label>
      <label class="inline"><input type="checkbox" id="pref-both"> 独立桌宠与内置桌宠同时显示</label>
    </div>
`;

const MARKER = '调试模式';

if (check) {
  const path = join(target, PAGE);
  if (!existsSync(path)) {
    console.error(`发布树里没有 ${PAGE}：${target}`);
    process.exit(1);
  }
  const text = readFileSync(path, 'utf8');
  const stillThere = text.includes(MARKER) || text.includes('pref-both');
  if (stillThere) {
    console.error(`  ✗ 发布树仍然显示调试模式（${path}）—— 运行 node scripts/make-release-pages.mjs ${target}`);
    process.exit(1);
  }
  console.log('  ✓ 通用设置里没有调试模式');
  process.exit(0);
}

const source = readFileSync(join(ROOT, PAGE), 'utf8');
if (!source.includes(DEBUG_BLOCK)) {
  console.error('dev 的 global-page.html 里找不到调试模式那一块，放弃变换（先确认它是否已被改动）');
  process.exit(1);
}
const stripped = source.replace(DEBUG_BLOCK, '').replace(/\n{3,}/g, '\n\n');
const out = join(target, PAGE);
writeFileSync(out, stripped, 'utf8');
console.log(`  写入 ${out}`);
console.log(`  去掉了 ${DEBUG_BLOCK.split('\n').length - 1} 行；剩余出现次数：${(stripped.match(new RegExp(MARKER, 'g')) || []).length}（应为 0）`);

// 把插件在**本机**留下的记录清干净
//
//   node scripts/purge-plugin-records.mjs          # 先备份，再清
//   node scripts/purge-plugin-records.mjs --dry-run  # 只看它会动什么
//
// 这是「卸载助手」：插件管理器只摘掉登记项，剩下三样（插件自己的 profile 目录、首启向导记录、node_modules 里的目录联接）
// 与浮窗运行时目录都不会被它删。全部清掉之后，扫描应当为空。
//
// 操作者，2026-10-15：「我需要你把插件在本地留下的所有记录和旧依赖都删掉，我必须验证最完整的全新安装」。
//
// 删之前先备份 profile 侧的东西（设置与首启向导记录）；两个 Electron 运行时目录是纯拷贝，不备份（298 MB + 另一份），
// 首次启用浮窗时启动器会重建。
//
// 清点过的位置（会话里逐项勘察）：
//   1. ~/.dsh/profiles/desktop/vrmpet3d-desktop/          插件自己的 profile 目录（设置 + 本地备份）
//   2. ~/.dsh/profiles/desktop/vrmpet3d-setup.json         首启向导的「已完成」记录
//   3. ~/.dsh/profiles/desktop/*.bak-pet3d-2026-10-08*     第一次安装留下的 profile 备份（旧名 pet3d）
//   4. ~/.dsh/profiles/desktop/node_modules/dsh-plugin-vrmpet3d  指向仓库/main 的目录联接
//   5. ~/.dsh/profiles/desktop/pnpm-lock.yaml 里的依赖条目（残留会让 pnpm 把它装回来）
//   6. F:\DeepSeek\vrmpet3d-desktop-runtime                现名的 Electron 运行时
//   7. F:\DeepSeek\pet3d-desktop-runtime                   旧名的运行时
//
// 不动 profile 的 package.json：登记由 DSH 的插件管理器拥有，它退出时会按内存里的树重写该文件，手改会被覆盖。

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop');
const PLUGIN = 'dsh-plugin-vrmpet3d';
/** `--dry-run` reports what it would do and writes nothing — no backup, no delete, no lock edit. */
const DRY = process.argv.includes('--dry-run');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(ROOT, 'build', 'probe-out', 'uninstall-backup-' + stamp);

const removed = [];
const failed = [];
const kept = [];

function dirSize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += dirSize(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

/** 删一个文件或目录，结果记进两份清单；`--dry-run` 时只记录、不动手。 */
function remove(path, label) {
  if (DRY) {
    if (existsSync(path)) removed.push(`${label}（dry-run：会删，未动）`);
    else kept.push(`${label}：本来就不存在`);
    return;
  }
  if (!existsSync(path)) {
    kept.push(`${label}：本来就不存在`);
    return;
  }
  const size = statSync(path).isDirectory() ? dirSize(path) : statSync(path).size;
  try {
    rmSync(path, { recursive: true, force: true });
    if (existsSync(path)) throw new Error('删除后仍存在');
    removed.push(`${label}（${(size / 1024).toFixed(1)} KB）`);
  } catch (error) {
    failed.push(`${label} → ${error.message}`);
  }
}

// ---- 备份 profile 侧的东西 --------------------------------------------------
const settingsDir = join(PROFILE, 'vrmpet3d-desktop');
if (!DRY) {
  mkdirSync(backup, { recursive: true });
  if (existsSync(settingsDir)) copyDir(settingsDir, join(backup, 'vrmpet3d-desktop'));
  for (const name of ['vrmpet3d-setup.json', 'package.json', 'cordis.patch.yml', 'pnpm-lock.yaml']) {
    const from = join(PROFILE, name);
    if (existsSync(from)) copyFileSync(from, join(backup, name));
  }
  console.log('备份: ' + backup);
} else {
  console.log('[dry-run] 备份目录本会是: ' + backup);
}

// ---- 逐项清除 ---------------------------------------------------------------
remove(settingsDir, '插件 profile 目录（设置 + 本地备份）');
remove(join(PROFILE, 'vrmpet3d-setup.json'), '首启向导记录');
remove(join(PROFILE, 'package.json.bak-pet3d-2026-10-08T09-15-28'), '第一次安装的 package.json 备份');
remove(join(PROFILE, 'cordis.patch.yml.bak-pet3d-2026-10-08T09-15-28'), '第一次安装的 cordis.patch.yml 备份');
remove(join(PROFILE, 'node_modules', PLUGIN), 'node_modules 里的目录联接');
remove('F:\\DeepSeek\\vrmpet3d-desktop-runtime', '浮窗运行时（现名）');
remove('F:\\DeepSeek\\pet3d-desktop-runtime', '浮窗运行时（旧名）');

// ---- pnpm-lock.yaml 里的依赖条目 --------------------------------------------
const lockPath = join(PROFILE, 'pnpm-lock.yaml');
if (existsSync(lockPath)) {
  const text = readFileSync(lockPath, 'utf8');
  if (text.includes(PLUGIN)) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let skipped = 0;
    for (const line of lines) {
      // 依赖条目与我们那个 link: 的 importers/… 行一起删；其余一律保留。
      if (line.includes(PLUGIN)) { skipped += 1; continue; }
      out.push(line);
    }
    if (!DRY) writeFileSync(lockPath, out.join('\n'), 'utf8');
    removed.push(`pnpm-lock.yaml 里 ${skipped} 行依赖条目`);
  } else {
    kept.push('pnpm-lock.yaml：本来就没有该依赖');
  }
}

// ---- 报告 -------------------------------------------------------------------
console.log('\n已删除：');
for (const line of removed) console.log('  ✓ ' + line);
if (failed.length) {
  console.log('\n**删除失败**（多半是被正在运行的进程占用）：');
  for (const line of failed) console.log('  ✗ ' + line);
}
if (kept.length) {
  console.log('\n无需处理：');
  for (const line of kept) console.log('  · ' + line);
}

// ---- 复扫 -------------------------------------------------------------------
console.log('\n复扫（应当为空）：');
const leftovers = [];
const scan = (dir, depth) => {
  if (depth < 0 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (/vrmpet|pet3d/i.test(entry.name)) leftovers.push(join(dir, entry.name));
    else if (entry.isDirectory()) scan(join(dir, entry.name), depth - 1);
  }
};
scan(PROFILE, 2);
scan('F:\\DeepSeek', 1);
if (leftovers.length) for (const line of leftovers) console.log('  ✗ ' + line);
else console.log('  （无）');

process.exit(failed.length ? 1 : 0);

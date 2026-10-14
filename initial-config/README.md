# initial-config — 操作者的当前配置（逐步上传，**不是**随包分发的内容）

操作者指令（2026-10-13）：

> 「每一步都要上传到github，包括我还没有构造好的初始配置文件，即当前配置。」
>
> 更早同一天：「我现在在插件里修改的所有和插件相关的配置文件，都要同步到github作为正式版的初始配置下发，记得提醒我配置好初始配置后，
> 把配置文件修改回本地配置，不再影响新用户的初始配置。」

这个目录就是那条通道：插件把配置写在 profile 里（`<profile>/vrmpet3d-desktop/vrmpet3d-settings.json` 及旁边的几个
store），正式版的初始配置应当来自**这里的内容**，而操作者希望每改一步 git 里就有一步——**哪怕还没配完**。

## 为什么放在这里，而不是 `assets/` 或 `docs/`

`package.json` 的 `files[]` 会打包 `lib`、`desktop`、`assets`、`docs`，凡在这四个目录下的东西都会进 npm 包、发给每一个
用户。本目录放的是**操作者本机的配置**（含本机绝对路径），因此刻意放在一个**不随包发布**的目录里。

真正随包下发的是动作包的清单 `assets/motions/vrmpet3d-motions.json`；它的 `defaults` 用**文件名**而不是 profile 里的
id 来指定动作，原因见下面「发布时要做的两件事」。

## 目录内容

| 文件 | 是什么 |
|---|---|
| `vrmpet3d-settings.json` | 面板里改的一切：动作映射、碎碎念（含 AI persona/来源）、表情与触发器、部位、视线、物理、位置等 |
| `vrmpet3d-model-files.json` | 通过 模型导入 复制进来的模型文件记录（含**本机绝对路径**）。本机没有导入过，已删除——里面原先记的是**另一台机器**的 `C:\Users\drliu\…` |
| `vrmpet3d-model-dirs.json` | 旧版导入的目录列表（仍会显示、仍可移除）。同上，本机为空，已删除 |
| `vrmpet3d-motion-imports.json` | 通过 动作导入 复制进来的动作目录（若还没有导入过则不存在） |
| `motion-catalog.json` | **仅在 `--catalog` 时抓取**：运行中的插件对 `/vrmpet3d/motions` 的回答，也就是上面那些 id 对应的**文件名** |

**刻意不抓取**：`vrmpet3d-setup.json`。它存的是初次安装引导的 `completed` 标记——把它下发出去，等于让**每个新用户**的
引导页直接跳过自己。脚本会把这条拒绝理由打印出来，而不是悄悄略过。

## 重新抓取（每改一步都能重跑）

```bash
node scripts/capture-config.mjs              # 抓进本目录（会打印那条拒绝理由与下面的提醒）
node scripts/capture-config.mjs --check      # 只报告：仓库里的副本与运行中的配置是否一致
node scripts/capture-config.mjs --catalog    # 顺带抓取 id → 文件名的对照（需要 app 在运行）
node scripts/capture-config.mjs --source <dir>   # 读别的 profile
```

## 发布时要做的两件事

### 1. 动作映射：从 **id** 翻译成 **文件名**，写进随包清单

`vrmpet3d-settings.json` 里的 `motions` 存的是 id（`a8`、`a9`、…）。这些 id 是**每个 profile 按绝对路径生成的**，
换一台机器就完全不同，所以它们**不能**作为下发的默认值。随包下发的默认值在
`assets/motions/vrmpet3d-motions.json` 的 `defaults` 里，按**文件名**指定：

```json
{
  "defaults": { "resting": ["idle/coolIdleGlance.vrma"], "done": ["success/xxx.vrma"] }
}
```

`motion-catalog.json`（`--catalog` 抓的）给出每个 id 对应的 `name`，翻译就是照它做。示例（在插件运行时）：

```bash
curl -s http://127.0.0.1:19387/vrmpet3d/motions   # { motions: [{ id, name, ... }] }
```

> 操作者说过这一步由他自己配（「我不写入 assets/motions/vrmpet3d-motions.json 的 defaults」），所以这个仓库**没有**
> 替他写。要我在你确认后按当前映射生成一版候选，说一声即可。

> ⚠️ **id 不只会换机器，还会随「包里的文件数」变。** id 是 `a` + base36（发现顺序里的**下标**），所以往动作包里加一个
> 文件，就会把它之后的所有 id 往后挪一位。实例（2026-10-14）：`dance/Dancing.vrma` 插在索引 4，于是本目录快照里从旧 `a4`
> 起的每个 id 都指向**前一个**文件 —— 把那份快照应用回本机，会把「出错」「落地」映射到 `dance/极乐净土.vrma.br`、「离线」
> 映射到 `idle/touch hair2.vrma`、「完成」映射到 `offline/sleeping.vrma` + 两支 jump。**面板上看不出来**：它显示的是存量
> 映射，名字看着都对，只有按文件名翻译才发现指错了文件。
>
> 判断与修复都靠**文件名**这把尺：用 `motion-catalog.json`（或运行中的 `/vrmpet3d/motions`）翻译快照里的 id，与清单
> `defaults` 逐状态比对；对不上时，把旧索引 ≥ 插入位置的 id 整体 +N（N = 之后新增的文件数）再比一次，两项都对上才算修好。
> 修的时候除了「动作集合」，还要交叉验证每条 `loop`（与清单 `clips` 对该文件的声明比对）——两者同时对上，才说明平移量猜对了。
> 2026-10-14 那次修复就是这么做的：平移后 14/3/3/2/1 与 15 条 loop/gaze 全部与清单吻合，随后才写回 profile 并重新抓取本目录。

### 2. 把本机专有的值改回"新用户应当得到的值"

以下字段是本机事实，不能作为新用户起点：`modelId`（指向你导入的模型）、`model-files`/`model-imports` 里的绝对路径与
`source`、`statusScale`（按 modelId 存）、以及 `placementX/Y`、`viewYaw/viewPitch` 这类你随手调过的视角/位置。

**操作者的标准提醒（重复一次）**：正式版初始配置配好之后，把插件里的这些配置文件**改回本地值**再提交，别让你本机的
设置成为新用户的初始配置。

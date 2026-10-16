# 小游戏模块 · 开饭啦

2026-10-16。分支 `mini-game`，基于 `dev` 的 `76ab042`；本次提交包含小游戏首版实现及验证记录。

## 已实现

- 内置和独立桌宠的右键菜单都有「小游戏 · 开饭啦」。游戏页面为 `/vrmpet3d/game`。
- 浏览器通过同步点击打开新标签页，首次发射请求全屏；Electron 使用独立普通窗口并以全屏启动。
- 鼠标控制横杆，左键发射。读取入口桌宠当前模型，建立独立 WebGL 场景，缩小后围绕屏幕 Z 轴快速旋转。
- 米饭碗砖块、碰撞、吃饭粒子、计分、三条生命、清空后自动进入下一关；关卡逐渐增加行数和速度。
- Esc 暂停，暂停界面可继续、重开、前往有消息的 DSH 会话。失焦、隐藏标签页或退出浏览器全屏也会暂停。
- 游戏只读取现有状态通道。任务完成或需要处理时背景缓慢闪光，显示消息入口；多个会话逐项列出。
- Electron 向现有导航通道提交目标会话，并调用已有 `focusHost` 唤起 DSH。网页端新开 `/?vrmpet3d-session=<id>`，插件客户端等待 workspace 槽就绪后打开该会话并移除参数。
- 模型加载失败时用饭团球继续游玩；通知断线自动重试；关闭页面释放渲染器、轮询和动画。
- 独立物理规则在 `lib/mini-game-core.js`，页面、样式、控制器分别为 `lib/mini-game.html`、`lib/mini-game.css`、`lib/mini-game-page.js`。没有修改桌宠拖拽、重力和模型运动反馈。

## 验证与复现

- `node scripts/verify-mini-game.mjs`：8 项通过，覆盖碰撞、速度、暂停、生命、升级和消息筛选。
- `node scripts/verify-mini-game-host.mjs`：7 项通过，使用真实插件路由验证页面、CSS、游戏启动、通知会话白名单和导航通道；Electron 启动被测试替身替代。
- `node scripts/verify-mini-game-browser.mjs`：桌面桥接路径 10 项通过。
- `node scripts/verify-mini-game-browser.mjs --web`：网页跳转路径 10 项通过。
- 上述浏览器专项使用真实 Edge、真实页面及随包 VRM，DSH 状态与 focusHost 为测试替身。`--preview` 输出无遮挡游戏截图。
- `node scripts/verify-model.mjs`：815 项通过（新增三份页面源，白名单遍历比原基线多 3 项）。
- `node scripts/verify-browser.mjs --page client-test`：111 项通过。
- `node scripts/verify-desktop.mjs --no-window`：162 项通过，跳过真实窗口。
- `node scripts/check-plugin-load.mjs`：通过。同步更新了 22 条路由与菜单顺序断言；修正原 dev 已过期的 unread 字段源码断言，使它检查当前 `snapshot.completedUnreadCount`。
- `node scripts/client-chunks.mjs --check`：3/3 最新。dev 孪生生成检查 22 项通过，新鲜度检查 23 项通过。
- 未运行全量验证及 `check-docs`；后者会重跑各套件并强制开启真实置顶桌宠窗口，沿用原 HANDOFF 的处理方式，留给操作者安排。

测试输出与截图位于 git 忽略的 `build/probe/`：`game-*.log`、`mini-game-preview.png`、`mini-game-play-preview.png`。

## 尚需现场确认

尚未安装到正在运行的 DSH，也没有改动用户的 DSH 配置或现有插件。真实 DSH 会话的桌面激活和网页新标签页直达需要安装后的现场联调；目前通过的是路由和桥接测试替身。浏览器全屏依赖用户点击授权，浏览器可能保留首次进入全屏的提示。

开发包入口为 `build/dev-package`；正常路径 `/vrmpet3d/game` 在 dev 孪生中会变成 `/vrmpet3d-dev/game`。两个入口不会共享游戏状态。

## 额度约束

用户要求：任一可用额度窗口剩余小于 2% 时停止，并将代码、进度和未完成项保存到本地。开发期间持续检查；交付前 5 小时窗口已刷新，剩余 99%，周窗口剩余 52%。后续继续时也应遵守。

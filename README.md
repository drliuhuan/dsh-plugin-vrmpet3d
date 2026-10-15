# 桌宠 3D · VRM Pet 3D

为 **DeepSeek Harness（DSH）** 添加一只随任务状态活动的 3D 桌宠。支持应用内显示，以及 DSH Desktop 上独立的透明悬浮窗；任务进行、等待确认、完成或出错时，宠物会显示对应状态并播放配置的动作。

自带两款模型和 VRMA 动作包，安装后即可使用。可导入自己的模型，设置动作、表情、视线和物理效果，也可以让宠物说预设台词或使用 AI 生成碎碎念。

[安装与使用](#安装) · [问题反馈](https://github.com/drliuhuan/dsh-plugin-vrmpet3d/issues) · [MIT 许可证](LICENSE)

> 当前为早期版本，仍在修复和完善。3D 渲染会占用 GPU 与内存；遇到异常时，请附上 DSH 版本、显示方式和复现步骤反馈。

```
no runtime dependencies · works offline
```

## 效果展示

空闲、工作中、等待确认与任务完成的状态展示合成图：

![桌宠空闲、工作中、等待确认与任务完成](assets/screenshots/states-overview.png)

碎碎念与鼠标凝视的实机演示：

![碎碎念与鼠标凝视演示](assets/screenshots/chatter-gaze.gif)

展示模型为 **BlueFatFish / 蓝色小肥鱼Deepseek**，作者 **木子恶魔**，
[原始发布页](https://www.aplaybox.com/details/model/ayXkRzVflmnd)。**经作者授权随本插件分发，需注明来源与作者。**
模型版权归原作者，其授权独立于插件代码的 MIT 许可证。模型选择页及首次引导的模型步骤也展示相同署名、授权与来源。

市场截图顺序由根目录 [screenshots.json](screenshots.json) 声明，包含合成展示图和四张原始截图。

## 功能

| 功能 | 说明 |
| --- | --- |
| 两种显示方式 | 应用内宠物；Desktop 端自动开启独立悬浮窗，支持置顶和透明区域鼠标穿透 |
| 任务状态联动 | 空闲、工作中、等待确认、完成、出错与离线；空闲保持 idle，不自动进入休眠 |
| 模型 | VRM 1.0 / 0.x，兼容普通 glTF/GLB；人体动作播放需要 VRM 骨架 |
| 动作 | 自带 VRMA 动作包，可按状态配置循环、单次、速度、表情、口型和凝视 |
| 跳支舞 | 右键随机播放一支舞蹈；播完、双击或开始工作时结束 |
| 互动 | 点击与长按部位触发表情和碎碎念；拖动、缩放、旋转视角、视线跟随和弹簧骨物理 |
| 碎碎念 | 内置台词、自定义台词，或使用 DSH 模型 / OpenAI 兼容接口生成 AI 台词 |
| 导入 | 模型以文件导入、动作包以文件夹导入，复制到插件存储后不依赖原路径 |

## 运行要求

- DeepSeek Harness **0.2.0-rc.2 或更高版本**；本项目是 DSH 插件，不能作为独立应用运行。
- 支持 WebGL2 的图形环境。独立悬浮窗需可用的 Electron 运行时，由启动器从 DSH 安装目录复用；无法启动时回退到应用内显示。
- 无需安装运行时 npm 依赖。默认台词和模型动画可离线使用；AI 碎碎念取决于所选服务的网络与额度。

## 安装

请使用本仓库的 **main 分支**安装。项目尚未发布到 npm。

1. 在 DSH 插件管理器中添加本仓库；支持 GitHub 包来源时，使用：

   ```text
   github:drliuhuan/dsh-plugin-vrmpet3d#main
   ```

2. 也可以[下载 main 分支 ZIP](https://github.com/drliuhuan/dsh-plugin-vrmpet3d/archive/refs/heads/main.zip)，解压后在插件管理器中添加包含 `package.json` 的文件夹，或填写 `link:<插件文件夹的绝对路径>`。
3. 确认插件已启用，然后重启 DSH。更新插件后也请重启，确保宿主代码和页面代码使用同一版本。

请先停用其他占用同一桌宠显示位置的插件，例如 `dsh-plugin-fatfish-pet`、`dsh-plugin-whale-pet`。卸载时从插件管理器移除本插件。

## 首次使用

首次引导会依次配置偏好模型、桌宠界面和 AI 碎碎念。可稍后配置，也可在 **通用设置 → 其他 → 重新运行引导** 再次打开。

- **切换显示方式**：Desktop 的通用设置最上方可选“内置宠物”或“自动”；自动优先使用独立悬浮窗。右键菜单也可以切换。
- **切换模型**：右键 → 切换模型，点击缩略图；可拖入自己的模型文件，加载进度结束后再继续切换。
- **设置动作**：通用设置 → 状态与动作。默认映射、表情和播放方式已随动作包提供，可以自行修改。
- **设置台词**：通用设置 → 碎碎念。选择内置、自定义或 AI 来源；AI 模式需要先选择可用服务和模型。
- **设置表情与部位**：右键 → 当前模型参数设置。模型结构不同，可用表情、部位和弹簧骨链也会不同。

### 鼠标操作

| 操作 | 效果 |
| --- | --- |
| 点击 / 原地长按 | 触发部位互动与碎碎念，保留正在播放的动作 |
| 左键拖动 | 移动宠物；开启对应界面的重力后，松开可触发抛掷和落地 |
| 滚轮经过宠物 | 调整宠物及其文字大小 |
| 滚轮经过文字 | 单独调整文字大小 |
| 右键拖动 | 旋转观察视角 |
| 右键点击 | 打开菜单：显示切换、模型切换、跳舞、重载、设置、重力和隐藏等 |
| 双击 | 结束当前跳舞 |

## 模型、动作与数据

自带默认模型 **蓝色小肥鱼Deepseek（木子恶魔）**，以及备用模型 **ヴィータ（VRoid プロジェクト）**。来源和授权见下方许可证说明及[模型说明](assets/models/README.md)。

### BlueFatFish 模型署名与授权

| 项目 | 信息 |
| --- | --- |
| 模型文件 | `BlueFatFish.vrm.br`（加载时解压为 VRM） |
| 模型名称 | 蓝色小肥鱼Deepseek |
| 作者 | 木子恶魔 |
| 来源 | [Aplaybox 原始发布页](https://www.aplaybox.com/details/model/ayXkRzVflmnd) |
| 分发授权 | 经作者授权随本插件分发，需注明来源与作者 |

本项目的 MIT 许可证不替代模型作者的授权；其他用途仍以作者原始发布页的条款和另行授权为准。

模型支持 `.vrm`、`.glb`、`.gltf`，动作支持 `.vrma`；不支持 PMX/PMD 或 VMD。普通 glTF/GLB 没有 VRM 人体骨架时，不能播放 VRMA 人体动作。自带模型与动作使用 Brotli 压缩存储，加载时自动解压。

导入内容与配置保存在 DSH profile 的插件存储目录中。移除导入只删除插件持有的副本，不删除原文件。随包动作的默认设置按文件名解析，不依赖其他机器上的模型或动作 ID。

### AI 与隐私

宠物通过任务状态、会话标识和计时信息判断当前状态，不需要读取会话正文、工具参数或附件。启用 AI 碎碎念后，所配置的人格、状态提示词和部位信息会发送给你选择的 AI 服务；费用与数据处理规则由该服务决定。

### 常见问题与反馈

- **没有宠物**：检查插件管理器里是否仍已启用，重启 DSH，并确认未被其他桌宠插件占用显示位置。
- **没有独立窗口**：在通用设置中选择“自动”；若运行时不可用，仍可使用内置宠物。
- **模型不播放动作**：确认使用 VRM 模型，状态下选有动作，并开启模型动作。反馈时请附上完整错误提示。
- **AI 不说话**：检查台词来源、服务、模型和访问额度；可以先切回内置台词确认气泡显示正常。

请通过 [GitHub Issues](https://github.com/drliuhuan/dsh-plugin-vrmpet3d/issues) 提交问题，附上 DSH 版本、操作系统、内置/外置显示方式、复现顺序与预期结果。请勿上传 API Key 或私人会话内容。


## License

插件代码与本项目原创动作采用 MIT 许可证。模型资源仍遵守各自作者的授权，不因随本仓库分发而自动改为 MIT。

MIT — see [LICENSE](LICENSE). It bundles other MIT-licensed software as one generated file
([lib/client.vendor.js](lib/client.vendor.js)): three.js, `@pixiv/three-vrm` and `@pixiv/three-vrm-animation`. It
ships exactly two 3D model files, and both may be redistributed with it:

| file | model | author | source | terms |
| --- | --- | --- | --- | --- |
| [assets/models/BlueFatFish.vrm.br](assets/models/BlueFatFish.vrm.br) | 蓝色小肥鱼Deepseek | 木子恶魔 | <https://www.aplaybox.com/details/model/ayXkRzVflmnd> | 经作者授权分发 — credited here as the author asks |
| [assets/models/SampleModel.vrm.br](assets/models/SampleModel.vrm.br) | ヴィータ | VRoid プロジェクト | <https://vroid.com/en/studio> | its own embedded licence: redistribution, modification and commercial use allowed, no attribution required |

The first is what a fresh profile resolves to; the second is the fallback. Every other model is the user's and stays
under its own author's terms.

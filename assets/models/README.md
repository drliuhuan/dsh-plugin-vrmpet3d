# assets/models/

Drop your own `.vrm`, `.glb` or `.gltf` files here (or point the
plugin at a folder elsewhere with the `modelDirs` config). This build is **VRM and plain glTF/GLB only**
(2026-10-12): a `.pmx`/`.pmd` is recognised by its magic bytes and refused by name, and a `.vmd` motion
likewise, so neither belongs here.

## What ships here: two models, and both may be redistributed with the plugin

`BlueFatFish.vrm` is the model a fresh profile resolves to; `SampleModel.vrm` is the fallback. Each ships for a
reason named here, and each is credited below with its **source and author** — the operator asked for that on
2026-10-13 (「需要注明来源和作者」). The picker prints the same two credits under its grid, on 切换模型 and on the guide's
② 偏好模型 step, because both mount one component and the credit comes from the host
(`BUNDLED_MODEL_CREDITS` in `lib/index.js`).

### `BlueFatFish.vrm` — 蓝色小肥鱼Deepseek, by 木子恶魔

| | |
| --- | --- |
| model | 蓝色小肥鱼Deepseek |
| author | 木子恶魔 |
| source | <https://www.aplaybox.com/details/model/ayXkRzVflmnd> |
| terms | 经作者授权分发，需注明来源与作者 — it ships inside this plugin with the author's permission, and this credit travels with it |
| file | VRM 1.0 (`VRMC_vrm`), 18 480 432 bytes, 152 nodes, 6 meshes, 53 humanoid bones, 18 preset expressions plus one custom (`TiePen`), 22 spring chains |

It became the plugin's default model on 2026-10-13 (「把BlueFatFish作为默认模型」). The permission covers distribution as
part of this plugin and nothing else: a copy taken from this repository is still the author's work, under the
author's terms, credited above.

**授权说明：** BlueFatFish / 蓝色小肥鱼Deepseek 的作者为 **木子恶魔**，来源为上方 Aplaybox 原始发布页。
本项目获得的是随本插件分发模型的授权，并保留来源与作者署名；模型不因收录于本仓库而改用 MIT 许可证。
其他用途以模型作者的原始条款和另行授权为准。README 展示区、模型选择页和首次引导的模型步骤均保留这些信息。

### `SampleModel.vrm` — ヴィータ, by VRoid プロジェクト

**Committed on purpose** since 2026-10-10, and the reason it can be shipped is the file's own embedded licence — not
a judgement call made here. Its `extensions.VRM.meta.otherLicenseUrl` is a VRoid Hub licence query string that
reads:

| term | value |
| --- | --- |
| `redistribution` | `allow` |
| `modification` | `allow` |
| `personal_commercial_use` | `profit` |
| `corporate_commercial_use` | `allow` |
| `credit` | `unnecessary` |
| `allowed_to_use_user` | `everyone` |
| `characterization_allowed_user` | `everyone` |
| `sexual_expression` / `violent_expression` | `allow` |

So it may be redistributed, modified, used commercially by individuals and
corporations, and **needs no attribution**. It also has what a bundled model needs
in order to exercise this plugin: a standard VRM humanoid rig, 15 expressions, and 18
spring chains (hair and skirt), which is why the settings window has something real
to show on a fresh install.

Source: <https://vroid.com/en/studio> sample models / VRoid Hub. Author
`VRoidプロジェクト`, title `ヴィータ`, 14 159 872 bytes.

## Every OTHER file here

The rule below is unchanged for anything you add, and it is why the assertion in
`scripts/check-docs.mjs` now names the one bundled file instead of requiring the
folder to be empty:

* **No other model file may be committed here.** Most VRM models on the
  internet forbid redistribution, and many forbid commercial use; committing one
  would make this repository undistributable.
* Read [`../../docs/ASSET-CONTRACT.md`](../../docs/ASSET-CONTRACT.md) before adding
  anything: check the model's **embedded** metadata (`extensions.VRMC_vrm.meta`) as
  well as the author's published rules, and when the two disagree take the
  conservative reading.
* Do **not** commit a model whose licence you have not read, and do not commit
  frames rendered from one.

## Prefer a folder outside the repo

For your own models, `modelDirs` in the plugin config is the better route: it keeps
licensed third-party assets out of version control entirely, and it lets you keep
several collections in their own folders.

```yaml
- id: vrmpet3d
  name: dsh-plugin-vrmpet3d
  config:
    modelDirs:
      - D:/models/vrm
      - F:/models/mine
```

## How the default is chosen

`preferences.modelId` ships EMPTY, which means "resolve one". `core.resolveModelId`
picks the catalogued model named `BlueFatFish.vrm` first — the bundled one, or yours
if you have a file by that name — then `SampleModel.vrm`, then the first VRM, then the first model of any
kind (and the kinds it catalogues are `.vrm`, `.glb` and `.gltf`; a `.pmx`/`.pmd` is left out of the
catalogue entirely since 2026-10-12). With nothing catalogued at all the pet shows nothing and says so; it
does not fall back to a stand-in avatar (that was removed on 2026-10-10), and `lib/placeholder.js` survives
only as the fixture the geometry probes and the browser suite build an avatar with.

# assets/models/

Drop your own `.vrm`, `.glb` or `.gltf` files here (or point the
plugin at a folder elsewhere with the `modelDirs` config). This build is **VRM and plain glTF/GLB only**
(2026-10-12): a `.pmx`/`.pmd` is recognised by its magic bytes and refused by name, and a `.vmd` motion
likewise, so neither belongs here.

## What ships here: exactly one model, and it is redistributable

`SampleModel.vrm` (VRoid プロジェクト's ヴィータ) is **committed on purpose** and is the
plugin's built-in default model. The operator asked for it on 2026-10-10, and the
reason it can be shipped is the file's own embedded licence — not a judgement call
made here. Its `extensions.VRM.meta.otherLicenseUrl` is a VRoid Hub licence query
string that reads:

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
corporations, and **needs no attribution**. It also has what a default model needs
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
picks the catalogued model named `SampleModel.vrm` first — the bundled one, or yours
if you have a file by that name — then the first VRM, then the first model of any
kind (and the kinds it catalogues are `.vrm`, `.glb` and `.gltf`; a `.pmx`/`.pmd` is left out of the
catalogue entirely since 2026-10-12). With nothing catalogued at all the pet shows nothing and says so; it
does not fall back to a stand-in avatar (that was removed on 2026-10-10), and `lib/placeholder.js` survives
only as the fixture the geometry probes and the browser suite build an avatar with.

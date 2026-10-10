# vendor/ — the pinned 3D stack

**The plugin has no runtime dependencies.** This folder exists only to rebuild the
one file the browser half actually loads.

## What is committed, and what is not

| Path | Committed | Purpose |
|---|---|---|
| `vendor/package.json` | yes | exact version pins for `esbuild` + the 3D stack |
| `vendor/entry.js` | yes | the bundle's entry point; one place listing what is exposed |
| `vendor/manifest.json` | yes | generated: versions, size and SHA-256 of the built chunk |
| `vendor/node_modules/` | **no** | only needed to rebuild |
| `lib/client.vendor.js` | **yes** | the built chunk, ~2.5 MB, served to the browser |

Committing the built chunk is deliberate. It means installing the plugin needs no
Node toolchain, no network and no `npm install` — and it means the shipped bytes are
verifiable, because `vendor/manifest.json` records the hash and versions that
produced them.

## Rebuilding

```bash
cd vendor
npm install          # esbuild + three + @pixiv/three-vrm + @pixiv/three-vrm-animation + @moeru/three-mmd + mmd-parser
cd ..
node scripts/vendor-build.mjs
```

Check that the committed chunk matches a fresh build from the pins:

```bash
node scripts/vendor-build.mjs --check     # also part of scripts/verify-all.mjs
```

`--check` fails if the file is missing or differs from a rebuild, so a pin change
that was not followed by a rebuild cannot be committed silently.

## Pinned versions

| Package | Version | Why this one |
|---|---|---|
| `three` | 0.186.1 | the `three/addons/*` subpath layout the entry imports from |
| `@pixiv/three-vrm` | 3.5.5 | VRM 1.0 and 0.x, MToon, SpringBone, node constraints |
| `@pixiv/three-vrm-animation` | 3.5.5 | `.vrma` playback: parses `VRMC_vrm_animation` and retargets a clip onto a loaded VRM. Pinned to the same version as `three-vrm` because it must agree with it about humanoid bone names |
| `@moeru/three-mmd` | 0.2.0-beta.2 | parses PMX/PMD itself and builds VMD clips; requires `three >= 0.184` |
| `mmd-parser` | 1.1.1 | pinned for reproducibility. `@moeru/three-mmd` bundles its own reader, so this is not in the shipped graph |
| `esbuild` | 0.25.12 | the bundler |

## Three things that will bite you

### 1. Do not add DRACOLoader or KTX2Loader

Both construct decoder URLs from `import.meta.url` **as a module side effect**.
An IIFE bundle has no `import.meta`, so merely importing either throws

```
TypeError: Invalid URL
```

at chunk load and takes the whole thing down — the pet renders nothing and the
console blames neither loader. Neither is used by VRM or PMX, so the fix is to omit
them rather than ship a shim. If you ever do need DRACO, define `import.meta.url` in
`vendor-build.mjs` and re-verify in a browser; do not assume the import is harmless.

### 2. The chunk is loaded through the module system, and also publishes a global

The built chunk carries both deliveries, and neither is redundant.

* **The module-system registration** is what works in the app.
  `lib/client.js` asks for it with `require.async('./client.vendor.js')`; the loader
  composes `/plugins/<package>/client.vendor.js?rev=<current>` and the server refuses
  anything else. The registration carries the **full module id**
  (`<package>/client.vendor.js`) because the loader reads `registration.id`
  unconditionally — a `chunk`-only registration throws, and passing both appends the
  file name twice.
* **The `globalThis.__PET3D_VENDOR__` assignment** written by `vendor/entry.js` is what
  the inline browser harnesses read, and what any plain `<script src>` path would see.
  A `<script src>` cannot work in the app: a relative URL drops the `?rev=` the server
  requires, and the plugin's own script is served through a combo URL whose pathname is
  `/plugins/`, so a sibling resolves with the plugin id lost.

`lib/pet3d.js`'s `loadVendor()` prefers the module system and keeps the `<script src>`
route as a fallback. It polls the global after `onload` rather than trusting the event:
a chunk served from cache can fire `onload` without re-executing, and a silent
"loaded but nothing happened" is the worst possible failure here.

### 3. An export that nothing calls is not in the chunk

esbuild tree-shakes, and `vendor/entry.js` is the **only** thing keeping a symbol
alive. The browser code never imports from the packages directly — it reads them off
the global bag — so a symbol that is missing from `entry.js` is a symbol that does
not exist at runtime.

This has already bitten once. `@moeru/three-mmd`'s `VMDLoader.load()` hands back a
parsed `VmdObject`, and the function that turns that into a playable
`AnimationClip` is a **separate export**, `buildAnimation`. It was imported nowhere,
so esbuild dropped it and the plugin shipped a `.vmd` parser with no way to build a
clip from it — a failure that appears only when a user picks a motion, long after
the build, and looks like a broken motion file rather than a missing function.

**Rule: every symbol the browser code reads off `__PET3D_VENDOR__` must be listed in
`vendor/entry.js`, and the list is the contract.** When a feature starts using a new
part of a vendored package, add the import and the bag entry in the same change, then
confirm the name survived the build:

```bash
grep -c 'buildAnimation' lib/client.vendor.js     # 0 means it was shaken out
```

## Reproducibility caveat

esbuild output is reproducible for a fixed esbuild version and a fixed dependency
tree, which is why both are pinned exactly and the lockfile is committed. A rebuild
on a different esbuild version will produce different bytes and `--check` will
(correctly) fail. Regenerate the chunk and `manifest.json` together when you
deliberately move a pin.

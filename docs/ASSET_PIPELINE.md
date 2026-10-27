# Asset pipeline

## Where things live

| Folder | Kind | In git? | Shipped to Pages? |
| --- | --- | --- | --- |
| `art/*.py`, `art/build.sh` | **Source**: Blender Python scripts that generate every current 3D asset | yes | yes (harmless, not loaded) |
| `art/source/` | **Source**: original third-party/generated models (FBX + `.fbm` texture folders), not used by the game yet | no (gitignored) | no |
| `art/reference/` | **Reference**: concept art and character turnarounds | no (gitignored) | no |
| `assets/*.glb` | **Game-ready**: meshopt-compressed glTF loaded at runtime | yes | yes |
| `assets/img/*.jpg` | **Game-ready**: landing-page images and the social preview (`og.jpg`) | yes | yes |

Rule: only files the game actually loads go in `assets/`. Everything in `assets/` is public on the deployed site.

`art/source/` and `art/reference/` exist only on the owner's machine; back them up separately. If a decision is made to version them, prefer Git LFS or external storage over plain git (≈22 MB of binaries today).

## Current pipeline: procedural Blender scripts

No hand-made `.blend` files exist. Every `.glb` in `assets/` is built from code:

| Script | Output | Contents |
| --- | --- | --- |
| `art/rlib.py` | — | Shared toolkit: `Geo` (merges primitives into one mesh), `Chibi` (toy character with named pivots), materials, keyframe helpers, props |
| `art/menu_scene.py` | `menu.glb` | Main-menu terrace diorama + one looping animation clip |
| `art/sports.py` | `characters.glb`, `tennis_court.glb`, `tt_hall.glb` | Recolorable characters (`ch_tennis`, `ch_tt`, `ch_chef`), stadium, sports hall |
| `art/kitchen.py` | `kitchen.glb` | Kitchen room, station and ingredient templates (`k_*`, `i_*`) |

Rebuild:

```bash
pip install bpy                    # Blender as a Python module; needs the matching Python (3.13 for bpy 5.x)
npm install                        # provides gltf-transform locally
BPY=python3.13 npm run assets      # runs art/build.sh
```

`build.sh` exports raw `.glb` to a temp dir, then runs `gltf-transform optimize --compress meshopt` with texture compression, simplification, instancing, joining, palette and flattening **off** (they would break node names and hierarchy the game relies on), writing into `assets/`.

Not verified in this repo snapshot: `bpy` is not installed on the current dev machine, so the rebuild has not been run since the last commit.

### Contract between Blender and the game

The JS finds things by name, so these are an API:

- **Characters**: root `ch_<name>` with pivots `ch_<name>_head`, `_armL`, `_armR`, `_legL`, `_legR` (rotated procedurally in JS; no skinning). Materials named `shirt`, `accent`, `hair` are recolored per player.
- **Menu**: platform empties `plat_tennis`, `plat_tt`, `plat_cook`, `plat_soon`, rim meshes `rim_*`, `env_city` (hidden on the landing page).
- **Kitchen**: templates listed in the `art/kitchen.py` docstring; material `soup` is tinted at runtime.
- Units are meters, Blender Z-up → glTF Y-up (`export_yup=True`). Courts: long axis along Blender Y, net at y = 0.

Renaming any of these requires updating the matching `getObjectByName` calls (`js/games/*.js`, `js/landing.js`).

## Integrating new source models (e.g. the FBX characters)

Not done yet; there is no established, tested procedure. A proposed outline, to be verified and then recorded in `knowledge/`:

1. Keep the original in `art/source/…` untouched; work on a copy.
2. Import into Blender, check scale (meters), orientation (facing −Y like `Chibi`), poly count and whether there is a rig (see [knowledge/fbx-source-assets.md](../knowledge/fbx-source-assets.md)).
3. Downsize textures: the base colors are 4096², which is far heavier than any current runtime asset (the largest `.glb` is ~1 MB).
4. If the model should be animated by the existing engine, either split it into the pivot hierarchy above or move the games to skinned animation (an architecture change: decide first).
5. Export `.glb`, run it through the same `gltf-transform` settings, place the result in `assets/`, and load it via `Kit3D.load`.
6. Prefer a script in `art/` that performs the conversion, so the asset is reproducible like the others.

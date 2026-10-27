# FBX source assets (`art/source/`)

Verified 2026-10-27 by inspecting the files with `file`, `sips`, `strings` and `shasum` (not yet opened in Blender).

| Model | FBX | Texture |
| --- | --- | --- |
| `characters/bunny/cartoon_bunny_3d_model.fbx` | 380 KB, binary | `cartoon_bunny_3d_model.fbm/…_basecolor.jpg`, 4096², 2.4 MB |
| `characters/dog/cartoon_dog_3d_model.fbx` | 400 KB, binary | `cartoon_dog_3d_model.fbm/…_basecolor.jpg`, 3.0 MB |
| `environments/tennis/island_tennis_court_3d_model.fbx` | 320 KB, binary | `island_tennis_court_3d_model.fbm/…_basecolor.jpg`, 3.7 MB |

## Verified

- **Textures are linked by a relative path** `<name>.fbm/<name>_basecolor.jpg`. Keep each `.fbx` and its `.fbm/` folder side by side, and don't rename either; renaming parent folders is safe (they were moved from `assets/3D Character/…` with checksums unchanged).
- Only a base-color map is present; no normal, roughness or other maps.
- Each texture is 4096², which is heavy for the web: one of these JPGs is larger than all five current `assets/*.glb` files combined (~2.3 MB).

## Unverified (string scan only)

- **No rig or animation**: the files contain no `LimbNode`, `Deformer` or `AnimationStack` strings, which suggests static meshes. Confirm in Blender before planning animation.
- Poly count, scale, up-axis and facing are unknown.

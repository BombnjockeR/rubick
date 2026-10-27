# FBX source assets (`art/source/`)

Verified 2026-10-27 by inspecting the files with `file`, `sips`, `strings` and `shasum`, then importing them in Blender 5.3 (headless) and rendering them.

| Model | FBX | Mesh | Texture |
| --- | --- | --- | --- |
| `characters/bunny/cartoon_bunny_3d_model.fbx` | 380 KB, binary | 5,506 verts, 10,734 tris, 15 separate pieces | `cartoon_bunny_3d_model.fbm/…_basecolor.jpg`, 4096², 2.4 MB |
| `characters/dog/cartoon_dog_3d_model.fbx` | 400 KB, binary | 5,550 verts, 11,045 tris, 1 main piece + racket strings | `cartoon_dog_3d_model.fbm/…_basecolor.jpg`, 4096², 3.0 MB |
| `environments/tennis/island_tennis_court_3d_model.fbx` | 320 KB, binary | 5,572 verts, 6,856 tris, 394 pieces | `island_tennis_court_3d_model.fbm/…_basecolor.jpg`, 4096², 3.7 MB |
| `environments/landingpage/floating island game 3d model/floating_island_game_3d_model.fbx` | 356 KB, binary | 5,565 verts, 4,960 faces (3,184 quads), 311 pieces | `floating_island_game_3d_model.fbm/…_basecolor.jpg`, 4096², 4.2 MB |

SHA-256 of the originals (to check they're untouched): bunny FBX `97f19229…`, dog FBX `78fc448f…`, island FBX `18b785b1…`, floating island FBX `52dfff64…`.

## Verified

- **No rig, no animation**: one mesh object each, no armature, vertex groups, shape keys or actions.
- **Scale and orientation**: normalized so the largest dimension is 1.0 (characters 1.0 tall including ears / hair; island 1.0 across), feet on z = 0, facing −Y in Blender (the "front" view), Z up after import. The bodies are not centred on the origin (bunny pelvis at x 0.037, y 0.045; dog at x 0.03, y −0.045).
- **Pose**: both characters stand arms-down. The racket is in the right hand: three separate pieces for the bunny, fused into the fist for the dog. The bunny's left fist rests on its hip; the dog's left hand is sunk into its shorts pocket.
- **Materials**: one material per model; only a base-color map (sRGB) is linked, roughness 0.9, plus unused Mapping / Normal Map nodes. Face normals are consistent (0–3 faces flip on "recalculate outside"); custom split normals are present.
- **Textures are linked by a relative path** `<name>.fbm/<name>_basecolor.jpg`. Keep each `.fbx` and its `.fbm/` folder side by side, and don't rename either; renaming parent folders is safe.
- **Frame rate**: importing sets the scene to 24 fps (see [blender-headless-pipeline.md](blender-headless-pipeline.md)).
- **Island**: the court is not regulation-shaped and has a hole at one corner; measurements in [island-court.md](island-court.md).
- **Floating island** (landing page; verified 2026-10-27 by inspection and renders): one object, 1 unit across, Z up, the entrance bridge towards −Y. The landmass (islands, plaza, bridges) is one connected piece of 1,250 vertices; props are loose pieces. The islands are open shells (no underside: from below you see the back of the courts). Broken parts: the plaza statue is a spike of stretched faces, two blimps overlap with their fins floating beside them and a rope to the tennis island, the windmill is a bare pole with a floating vane, several "islets" are plain cubes, and some pennant strings are flat strips fused into the landmass. The tennis court and the table tops are thin separate sheets (6 and 8 vertices), easy to find by colour. `art/landing_island.py` handles all of this by rule.

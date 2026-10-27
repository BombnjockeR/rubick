# Asset pipeline

## Where things live

| Folder | Kind | In git? | Shipped to Pages? |
| --- | --- | --- | --- |
| `art/*.py`, `art/build.sh` | **Source**: Blender Python scripts that generate every 3D asset | yes | yes (harmless, not loaded) |
| `art/source/` | **Source**: original third-party/AI-generated models (FBX + `.fbm` texture folders), read by `animals.py`, `island.py` and `landing_island.py` | no (gitignored) | no |
| `art/reference/` | **Reference**: concept art and character turnarounds | no (gitignored) | no |
| `art/build/` | **Derived, local**: rigged `.blend` files and raw exports for inspection (`animals.py art/build --blend`) | no (gitignored) | no |
| `assets/*.glb` | **Game-ready**: meshopt-compressed glTF loaded at runtime | yes | yes |
| `assets/img/*.jpg` | **Game-ready**: landing-page images and the social preview (`og.jpg`) | yes | yes |

Rule: only files the game actually loads go in `assets/`. Everything in `assets/` is public on the deployed site.

`art/source/` and `art/reference/` exist only on the owner's machine; back them up separately. The build scripts only read them. If a decision is made to version them, prefer Git LFS or external storage over plain git (≈22 MB of binaries today). Without `art/source/`, the `animals` and `island` targets can't be rebuilt, but the committed `.glb` files keep working.

## Scripts and outputs

| Script | Output | Contents |
| --- | --- | --- |
| `art/rlib.py` | — | Procedural toolkit: `Geo` (merges primitives into one mesh), `Chibi` (toy character with named pivots), materials, keyframe helpers, props |
| `art/menu_scene.py` | `menu.glb` | Main-menu terrace diorama + one looping animation clip |
| `art/sports.py` | `characters.glb`, `tennis_court.glb`, `tt_hall.glb` | Recolorable chibis (`ch_tennis`, `ch_tt`, `ch_chef`), stadium (now Tennis's fallback venue), sports hall |
| `art/kitchen.py` | `kitchen.glb` | Kitchen room, station and ingredient templates (`k_*`, `i_*`) |
| `art/rig.py` | — | Rigging toolkit: FBX import, mesh repairs (`lift_limb`, `replace_hand`, `delete_faces`, `apply_pose_as_rest`), shared animal skeleton, skinning rules, prop split, paddle, keyframing (`Anim`: body-axis rotations, aim, two-bone IK `reach`, `level`, ground solver), glTF export |
| `art/clips.py` | — | The eleven clips every animal gets, generated from code |
| `art/animals.py` | `bunny.glb`, `dog.glb` | The rigged, animated animals built from `art/source/characters/` (per-character landmarks live here) |
| `art/island.py` | `island_court.glb` | Tennis venue built from `art/source/environments/tennis/` |
| `art/landing_island.py` | `landing_island.glb` | The landing page's floating island built from `art/source/environments/landingpage/`: cleaned up, completed (rock undersides, statue, airship, windmill, islets, nets, pennants, clouds) and animated (one 10 s loop) |
| `art/preview_clips.py` | PNG | Contact sheet of every clip of a rigged `.blend`, for review |

## Rebuilding

```bash
npm install                                   # provides gltf-transform locally
npm run assets:animals                        # bunny.glb, dog.glb, island_court.glb (needs art/source/)
npm run assets:landing                        # landing_island.glb (needs art/source/)
npm run assets                                # everything (also regenerates the procedural assets)
./art/build.sh menu kitchen                   # any subset of: menu sports kitchen animals island landing
```

`build.sh` runs each script with Blender headless: by default `/Applications/Blender.app/Contents/MacOS/Blender` (verified with Blender 5.3), or another binary via `BLENDER=/path/to/blender`, or the pip `bpy` module via `BPY=python3.13`. Scripts take their output path after `--` (Blender CLI) or as the first argument (`bpy` module). It exports raw `.glb` to a temp dir, then runs `gltf-transform optimize --compress meshopt` with texture compression, simplification, instancing, joining, palette and flattening **off** (they would break node names and hierarchy the game relies on), writing into `assets/`. For `landing_island.glb` it also passes `--prune false`: pruning drops empty leaf nodes, and the landing page's hotspot anchors are exactly that.

Verified 2026-10-27: all six targets run with Blender 5.3 from the CLI. The procedural ones (`menu`, `sports`, `kitchen`) were only exported to a temp dir; their committed `.glb` files were not regenerated or compared, so `npm run assets` (all targets) would replace them with Blender 5.3 output: check the result before committing.

## Contract between Blender and the game

The JS finds things by name, so these are an API:

- **Chibi characters** (`characters.glb`): root `ch_<name>` with pivots `ch_<name>_head`, `_armL`, `_armR`, `_legL`, `_legR` (rotated procedurally in JS; no skinning). Materials named `shirt`, `accent`, `hair` are recolored per player.
- **Animal characters** (`bunny.glb`, `dog.glb`): an armature `ch_<id>` with the bone set in `art/rig.py` (`BONES`): `hips`, `spine`, `chest`, `head`, `earL1/2`, `earR1/2`, `armL/R`, `forearmL/R`, `handL/R`, `thighL/R`, `shinL/R`, `footL/R`, `tail1/2`, plus the sockets `sockHat`, `sockBack`, `sockHandL`, `sockHandR` (no weights; accessories attach there). Meshes: `<id>_body` (material `body`, the character's texture), `prop_racket`, `prop_paddle` (one tool is shown at a time). Clips: `idle`, `ready`, `walk`, `run`, `strafeL`, `strafeR`, `jump`, `victory`, `defeat`, `swing`, `serve`. Models face +Z (glTF), feet on y = 0, 1 unit tall; the racket is in the right hand (−X), the opposite side to the chibis' racket arm.
- **Island** (`island_court.glb`): nodes `island`, `island_court`, `sea`; the court follows the racket engine's coordinates (below).
- **Menu**: platform empties `plat_tennis`, `plat_tt`, `plat_cook`, `plat_soon`, rim meshes `rim_*`, `env_city`.
- **Landing island** (`landing_island.glb`, read by `js/landing.js`): hotspot anchors `hot_tennis`, `hot_tt`, `hot_cook`, `hot_plaza`, `hot_entry`, `hot_airship`, `hot_clock` (empties; the pins on the page follow them); `land` (the textured landmass, with `rocks`, `fountain`, `statue`, `nets`, `windmill` and the pennant strings as children) and `rocks` are what hides a pin seen from behind; `tree_*` (origin at the trunk's base) sway, `bunt_*` meshes flutter through their morph target `wave`, `cloud_*` drift, all in JS; `islet_*`, `balloon_*`, `airship` (child `prop`), `mill`, `ball_*`, `steam_*` move in the baked clip. The fountain is at the origin, the plaza floor at y = 0, the scene about 24 m across.
- **Kitchen**: templates listed in the `art/kitchen.py` docstring; material `soup` is tinted at runtime.
- Units are meters, Blender Z-up → glTF Y-up (`export_yup=True`). Courts: long axis along Blender Y, net at y = 0, playing surface at z = 0.

Renaming any of these requires updating the matching lookups (`js/games/*.js`, `js/landing.js`, `js/character.js`).

## Animal character pipeline (`art/animals.py`)

Each step is a function in `art/rig.py`; nothing is done by hand in Blender.

1. **Import** the FBX (only read), join meshes, bake transforms, and move the pelvis centre to the origin. The importer switches the scene to the file's 24 fps; the script switches back to 30.
2. **Remodel** (`CHARACTERS[id]['remodel']`), for limbs the source model fused to the body. Both animals were modelled with the left hand on the hip (bunny) or buried in a pocket (pup), which no ready position or two-handed grip can use:
   - `hand` (pup): the buried hand is replaced by a mirrored copy of the right one (`replace_hand`, `mirror_map`); with `forearm` (a radius) the whole forearm from the elbow down is mirrored too, laid along the old forearm's line, the buried forearm's fur is deleted, and the wrist / fist / grip joints move onto the new geometry;
   - `free_arm` (both): the forearm and hand are copied off the body (`lift_limb`, skipped with `lift: False` when `hand` already rebuilt them as a separate piece). The face selection (near the bone line, facing away from it, not shorts-coloured) is speckled on these sculpts, so `tidy_selection` drops selected specks and adds small unselected patches that the selection surrounds; after the cut, `drop_fragments` deletes loose bits the cut created (pieces that were already separate, like buttons, stay). The copy is tagged in a `part` vertex attribute; holes are patched with fans in the colour around them, preferring the shorts colour where a limb left the body. After skinning, the forearm is turned `pitch`° forward and `out`° outward and that pose is applied as the new rest pose (`apply_pose_as_rest`), so it rests clear of the body.
   A model delivered in a T-pose (or any pose with free hands) needs no `remodel`. Check the result close up: `art/preview_clips.py` sheets, or orthographic renders of the arm in `idle`, `ready` and `run`.
3. **Skeleton** from a per-character landmark table (`CHARACTERS[id]['joints']`, joint positions measured on the source model in its own coordinates): 22 deform bones + 4 sockets + `root`.
4. **Skin weights**: Blender's heat diffusion (automatic weights; if it fails on enclosed pieces it is retried without the small ones), then rules for what heat gets wrong on these models:
   - vertices it misses (small separate pieces) copy their nearest neighbour's weights;
   - arms modelled hanging against the body: below the armpit, a vertex counts as arm only if its normal faces away from the arm more than from the spine (smoothed over the mesh), so raising an arm no longer drags the shirt;
   - the fists and the racket are rigid on their hand bones;
   - the shorts never follow the arms (a hand rested on them in the source pose); the lifted forearm copy follows only its arm, and what it was lifted from never does;
   - no weights cross from one leg to the other; shoes are rigid on their foot; small pieces (laces, eye highlights) move as one; light smoothing, at most 4 influences, normalized.
   (`pin`, which glued a pocketed hand to the hips, is still supported but no longer used.)
5. **Tools**: the modelled racket is split into its own mesh `prop_racket`; a table-tennis paddle `prop_paddle` is generated in the same grip, aligned with the racket's shaft and face.
6. **Clips** (`art/clips.py`) keyed on the pose bones from code: body-axis rotations, limbs aimed at directions, two-bone IK (`reach`: the left hand on the racket throat in the ready position), a ground solver that keeps the lowest sole on the floor, key poses joined by eased slerps. Per-character traits: ear style (upright / floppy), tail wag strength (`pocket` keeps a left hand in a pocket, unused now). **Foot planting**: `walk`, `run` (`plant_legs`) and `strafeL/R` place each foot with IK so that, while it is down, it moves back under the body at a constant speed; the game plays each clip faster or slower so its speed matches. Those speeds are `walkSpeed` 0.375, `runSpeed` 0.99 and `strafeSpeed` 0.44 model units/s in `js/character.js`; they follow from `WALK_STRIDE`, `RUN_STRIDE` and `STRAFE_STEP`, so change both together.
7. **Texture** downsized from 4096² to 1024² JPEG; one material.
8. **Export** the armature, body and both tools with every action as a named glTF animation, then meshopt via `build.sh`.

Review tools: `art/animals.py art/build bunny --blend` writes `art/build/bunny_rigged.blend` (open it in Blender, scrub the actions); `blender -b art/build/bunny_rigged.blend --python art/preview_clips.py -- clips.png` renders a contact sheet of every clip; `tools/characters.html` plays the exported `.glb` in the browser (with *Move the character* ticked it travels at the chosen velocity over a grid, to judge foot sliding); `npm run smoke` measures how far the planted foot slides while walking, running and side-stepping.

### Adding or replacing a character

1. Put the model in `art/source/characters/<id>/` with its `.fbm/` texture folder next to it (unrigged, one mesh, standing, facing the camera's front view). A T-pose or A-pose with the hands free of the body is best; arms down works if they don't touch the body (otherwise see *Remodel* above).
2. Copy an entry in `CHARACTERS` (`art/animals.py`): FBX path, `center`, and the joint table. Measure joints on front/side orthographic renders with a grid (Blender front view = −Y): hips, spine, chest, neck, head top, back, hip/knee/ankle/toe per side, shoulder/elbow/wrist/fist per side, ear and tail chains, `grip` points. Joints must sit inside the limb they bend.
3. Set the tool region (`racket` box; `whole_parts` if the racket is separate pieces, `keep` = the fist sphere if it is fused), `shorts` (colour and tolerance of the clothing the arms must never drag), `remodel` if a hand is fused to the body, and `traits`.
4. `./art/build.sh animals`, then check deformation (`preview_clips.py`, the `--blend` file), the browser (`tools/characters.html`) and `npm run smoke`.
5. Register it in `js/character.js` (`defs`) and list it in a game config (`characters: [...]`).

To replace the bunny or the pup with a new model of the same character, steps 2–4 are enough; keep the id so the game picks it up.

## Island venue (`art/island.py`)

The source island's court is squat (1.30:1 instead of 2.17:1), rotated about 9°, bumpy, and has a hole at one corner. The script aligns and scales the island around its court (scale ≈ 90 so the court is 23.77 m long, rotated so the grandstand sits behind the far baseline), lowers it under a new regulation court on a terracotta plinth (same layout as the stadium), removes the original net and low court geometry, flattens ground that would poke through, fills the hole with a plate, adds a sea, and downsizes the texture to 2048². The court measurements are constants at the top of the script (how they were measured: [knowledge/island-court.md](../knowledge/island-court.md)).

## Landing island (`art/landing_island.py`)

The source model (`art/source/environments/landingpage/`, an AI-generated FBX: one low-poly mesh of three game islands around a plaza, 311 loose pieces, a 4096² texture) is read, never modified. The script works on the loose pieces by rule rather than by hand-picked ids, so a regenerated model with the same layout should still build:

1. **Analysis**: connected components, the texture colour under each face, and what each piece stands on (ray casts straight down, under its centre and four sides).
2. **Removed**: the plaza statue (a spike of stretched faces around the fountain), two overlapping blimps with their loose fins and gondolas, the rope mooring them to the tennis island, the bare windmill pole with its floating vane, and cube-shaped "islets" hanging in the air (with whatever sat on them).
3. **Split off** as their own nodes: the three hot-air balloons (with their baskets), the clock-tower islet, and the trees (greenish pieces standing on ground), so they can move.
4. **Transform**: scaled ×24 (meters), the fountain centre at the origin and the plaza floor at z = 0; the texture downsized to 2048².
5. **Added** (procedural, flat-coloured in the toy palette): rock cones closing the islands' open undersides (built on the open rims of the landmass, skipping flat quads such as table tops, roofs, and the long narrow bridges), a fountain with a gold cat holding a racket, an airship with striped gores, fins, gondola and a propeller, a windmill with turning sails, mini islets with a tree or a lamp where the cubes were, a tennis net and table-tennis nets (the court is a thin green sheet, the tables thin blue sheets: found by colour and shape), pennant strings between lamp posts (catenaries that avoid crossing the courts; each string has a morph target that swings alternate flags sideways), low-poly clouds in three rings, a tennis ball and a table-tennis ball lobbing back and forth, and steam puffs over the stoves.
6. **Animation**: one 10 s loop keyed from code and exported as a single clip (`export_animation_mode='ACTIVE_ACTIONS'`): the landmass bobs and tilts, islets and balloons bob and drift, the airship cruises, the propeller and sails turn, the balls fly, the steam rises and fades (scale). Wind on trees, flags and clouds is left to `js/landing.js`.
7. **Export** with hotspot anchor empties, then meshopt via `build.sh` (`--prune false`, see above).

`art/landing_island.py out.glb preview.png` also renders Workbench previews (two frames of the loop and a top view) for a quick look; the real check is `index.html` in a browser.

## Sizes (game-ready, meshopt)

| Asset | Size | Triangles | Texture |
| --- | --- | --- | --- |
| `bunny.glb` | ~530 KB | 10.2k body, 0.7k racket, 0.4k paddle | 1024² JPEG |
| `dog.glb` | ~660 KB | 10.7k body, 0.6k racket, 0.4k paddle | 1024² JPEG |
| `island_court.glb` | ~840 KB | ~7k island + court | 2048² JPEG |
| `tennis_court.glb` (fallback) | ~1 MB | — | none |
| `landing_island.glb` | ~1.26 MB | ~27k (11k landmass, the rest undersides, props, clouds, 80 meshes) | 2048² JPEG |

Each character's eleven clips take ~56 KB together (sampled every frame, 27 bones, meshopt; measured with `gltf-transform inspect`).

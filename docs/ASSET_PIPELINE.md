# Asset pipeline

## Where things live

| Folder | Kind | In git? | Shipped to Pages? |
| --- | --- | --- | --- |
| `art/*.py`, `art/build.sh` | **Source**: Blender Python scripts that generate every 3D asset | yes | yes (harmless, not loaded) |
| `art/source/` | **Source**: original third-party/AI-generated models (FBX + `.fbm` texture folders: six characters, five environments), read by `animals.py`, `island.py`, `kitchens.py` and `landing_island.py` | no (gitignored) | no |
| `art/reference/` | **Reference**: concept art and character turnarounds | no (gitignored) | no |
| `art/build/` | **Derived, local**: rigged `.blend` files and raw exports for inspection (`animals.py art/build --blend`) | no (gitignored) | no |
| `assets/*.glb` | **Game-ready**: meshopt-compressed glTF loaded at runtime | yes | yes |
| `assets/img/*.jpg` | **Game-ready**: landing-page images and the social preview (`og.jpg`) | yes | yes |

Rule: only files the game actually loads go in `assets/`. Everything in `assets/` is public on the deployed site.

`art/source/` and `art/reference/` exist only on the owner's machine; back them up separately. The build scripts only read them. If a decision is made to version them, prefer Git LFS or external storage over plain git (≈22 MB of binaries today). Without `art/source/`, the `animals`, `island`, `landing` and `kitchens` targets can't be rebuilt, but the committed `.glb` files keep working.

## Scripts and outputs

| Script | Output | Contents |
| --- | --- | --- |
| `art/rlib.py` | — | Procedural toolkit: `Geo` (merges primitives into one mesh), `Chibi` (toy character with named pivots), materials, keyframe helpers, props |
| `art/menu_scene.py` | `menu.glb` | Main-menu terrace diorama + one looping animation clip |
| `art/sports.py` | `characters.glb`, `tennis_court.glb`, `tt_hall.glb` | Recolorable chibis (`ch_tennis`, `ch_tt`, `ch_chef`), stadium (now Tennis's fallback venue), sports hall |
| `art/kitchen.py` | `kitchen.glb` | Cooking templates: stations (`k_*`), the eleven ingredients in every state (`i_*`), containers, the nine finished dishes (`d_*`), particles (`fx_*`), a plain fallback room |
| `art/kitchens.py` | `kitchen_paddy.glb`, `kitchen_beach.glb`, `kitchen_city.glb` | The three cooking dioramas from `art/source/environments/cooking/`, levelled, cleared on the station tiles of `js/games/kitchens.js`, bridged, with trees, banners, boats and gulls split off or added |
| `art/rig.py` | — | Rigging toolkit: FBX import, mesh repairs (`tidy_mesh`, `lift_limb`, `replace_hand`, `delete_faces`, `apply_pose_as_rest`), shared animal skeleton, skinning rules, tools (`ToolFrame`, a modelled racket split off or a generated `build_racket`, `build_paddle`), keyframing (`Anim`: body-axis rotations, `aim` with a face normal, two-bone IK `reach`, `level`, ground solver), glTF export |
| `art/landmarks.py` | — | Joint positions measured automatically on a T-posed character mesh (`auto_joints`) |
| `art/clips.py` | — | The eleven clips every animal gets, generated from code |
| `art/animals.py` | `bunny.glb`, `dog.glb`, `cat.glb`, `panda.glb`, `chimp.glb`, `lioness.glb` | The rigged, animated animals built from `art/source/characters/`: two measured by hand (arms-down models), four T-posed ones with automatic landmarks |
| `art/island.py` | `island_court.glb` | Tennis venue built from `art/source/environments/tennis/`: cleaned up, with new grandstands, a crowd, pennants, gulls, clouds and a sea; one baked loop |
| `art/landing_island.py` | `landing_island.glb` | The landing page's floating island built from `art/source/environments/landingpage/`: cleaned up, completed (rock undersides, statue, airship, windmill, islets, nets, pennants, clouds) and animated (one 10 s loop) |
| `art/preview_clips.py` | PNG | Contact sheet of every clip of a rigged `.blend`, for review |

## Rebuilding

```bash
npm install                                   # provides gltf-transform locally
npm run assets:animals                        # the six animals and island_court.glb (needs art/source/)
npm run assets:island                         # island_court.glb only
npm run assets:kitchens                       # kitchen.glb (templates) and the three kitchen_*.glb dioramas (needs art/source/)
npm run assets:landing                        # landing_island.glb (needs art/source/)
npm run assets                                # everything (also regenerates the procedural assets)
./art/build.sh menu kitchen                   # any subset of: menu sports kitchen animals island landing kitchens
```

`build.sh` runs each script with Blender headless: by default `/Applications/Blender.app/Contents/MacOS/Blender` (verified with Blender 5.3), or another binary via `BLENDER=/path/to/blender`, or the pip `bpy` module via `BPY=python3.13`. Scripts take their output path after `--` (Blender CLI) or as the first argument (`bpy` module). It exports raw `.glb` to a temp dir, then runs `gltf-transform optimize --compress meshopt` with texture compression, simplification, instancing, joining, palette and flattening **off** (they would break node names and hierarchy the game relies on), writing into `assets/`. For `landing_island.glb` it also passes `--prune false`: pruning drops empty leaf nodes, and the landing page's hotspot anchors are exactly that.

Verified 2026-10-28: all seven targets run with Blender 5.3 from the CLI. The procedural ones (`menu`, `sports`, `kitchen`) were only exported to a temp dir; their committed `.glb` files were not regenerated or compared, so `npm run assets` (all targets) would replace them with Blender 5.3 output: check the result before committing.

## Contract between Blender and the game

The JS finds things by name, so these are an API:

- **Chibi characters** (`characters.glb`): root `ch_<name>` with pivots `ch_<name>_head`, `_armL`, `_armR`, `_legL`, `_legR` (rotated procedurally in JS; no skinning). Materials named `shirt`, `accent`, `hair` are recolored per player.
- **Animal characters** (`bunny.glb`, `dog.glb`, `cat.glb`, `panda.glb`, `chimp.glb`, `lioness.glb`): an armature `ch_<id>` with the bone set in `art/rig.py` (`BONES`): `hips`, `spine`, `chest`, `head`, `earL1/2`, `earR1/2`, `armL/R`, `forearmL/R`, `handL/R`, `thighL/R`, `shinL/R`, `footL/R`, `tail1/2`, plus the sockets `sockHat`, `sockBack`, `sockHandL`, `sockHandR` (no weights; accessories attach there). Meshes: `<id>_body` (material `body`, the character's texture), `prop_racket`, `prop_paddle` (one tool is shown at a time, or none: a plain avatar). Clips: `idle`, `ready`, `walk`, `run`, `strafeL`, `strafeR`, `jump`, `victory`, `defeat`, `swing`, `serve`, `smash`, `lungeL`, `lungeR`, `diveL`, `diveR`. The hitting clips' contact frames (`swing` 4, `serve` 9, `smash` 7, lunges and dives 5, at 30 fps) are part of the contract: `art/clips.py` `CONTACT` and `js/character.js` `CONTACT` must agree, because the game times each stroke so that frame lands on the ball and places the player from where the racket head is on it (`MabarChars.reachOf`). The dives run in place (the game flies the character sideways); the lunges shift the hips in the clip. Models face +Z (glTF), feet on y = 0, 1 unit tall; the racket is in the right hand (−X), the opposite side to the chibis' racket arm.
- **Island** (`island_court.glb`): `island` (the source landmass), `island_court`, `sea` (materials `sea`, `shallows`), `stand_*`, `crowd_*`, `umbrella_*`, `bunt_*` and `flag_*` (morph target `wave`), `tree_*` (origin at the trunk's base), `cloud_*`, `boat`, `bird_*` (> `wing_l`, `wing_r`); the court follows the racket engine's coordinates (below). `Kit3D.liven` (js/kit3d.js) animates these by name; the file's one clip (boat, gulls) plays on a mixer.
- **Menu**: platform empties `plat_tennis`, `plat_tt`, `plat_cook`, `plat_soon`, rim meshes `rim_*`, `env_city`.
- **Landing island** (`landing_island.glb`, read by `js/landing.js`): hotspot anchors `hot_tennis`, `hot_tt`, `hot_cook`, `hot_plaza`, `hot_entry`, `hot_airship`, `hot_clock` (empties; the pins on the page follow them); `land` (the textured landmass, with `rocks`, `fountain`, `statue`, `nets`, `windmill` and the pennant strings as children) and `rocks` are what hides a pin seen from behind; `tree_*` (origin at the trunk's base) sway, `bunt_*` meshes flutter through their morph target `wave`, `cloud_*` drift, all in JS; `islet_*`, `balloon_*`, `airship` (child `prop`), `mill`, `ball_*`, `steam_*` move in the baked clip. The fountain is at the origin, the plaza floor at y = 0, the scene about 24 m across.
- **Kitchen templates** (`kitchen.glb`): listed in the `art/kitchen.py` docstring. Stations `k_*` with animated children (`k_board > knife`, `k_sink > water`, `k_pot > soup, lid`, `k_fryer > oil, basket`, `k_crate > label`), food `i_<ingredient>[_<state>]`, containers `i_plate / i_bowl / i_glass`, dishes `d_<recipe>`, particles `fx_steam / fx_smoke / fx_splash`; materials `soup` and `label` are tinted at runtime.
- **Kitchens** (`kitchen_<id>.glb`, ids and tile maps in `js/games/kitchens.js`): `land`, `bridge_*`, `tree_*`, `flag_*`, `boat_*`, `bird_*`; tile (c, r) of the map sits at x = c − (cols−1)/2, glTF z = r − (rows−1)/2, floor at y = 0. The game places the templates on the station tiles itself.
- Units are meters, Blender Z-up → glTF Y-up (`export_yup=True`). Courts: long axis along Blender Y, net at y = 0, playing surface at z = 0.

Renaming any of these requires updating the matching lookups (`js/games/*.js`, `js/landing.js`, `js/character.js`, `js/kit3d.js`).

`build.sh` optimizes with quantization: a mesh node in the shipped `.glb` carries a scale and an offset. JS that animates a template's child must add to the node's existing `position` / `scale` rather than set them (the fryer's oil became a 2 m slab when its scale was set to 1).

## Animal character pipeline (`art/animals.py`)

Each step is a function in `art/rig.py`; nothing is done by hand in Blender. Two kinds of source model go through it: the **measured** ones (bunny, pup: modelled arms-down holding a racket, joints measured by hand) and the **T-posed** ones (cat, panda, chimp, lioness: `'auto'` entries, no racket), which skip the remodelling and get their joints, rest pose and tools from the steps marked *T-pose*.

1. **Import** the FBX (only read), join meshes, bake transforms, and move the pelvis centre to the origin. The importer switches the scene to the file's 24 fps; the script switches back to 30. *T-pose*: `rig.tidy_mesh` first removes loose scraps of under 8 vertices (the chimp had a stray cone on each cuff), faces of no area, and makes face normals consistent; then `art/landmarks.py` measures the joints (below) and the pelvis centre comes from them.
2. **Remodel** (`CHARACTERS[id]['remodel']`), for limbs the source model fused to the body. Both animals were modelled with the left hand on the hip (bunny) or buried in a pocket (pup), which no ready position or two-handed grip can use:
   - `hand` (pup): the buried hand is replaced by a mirrored copy of the right one (`replace_hand`, `mirror_map`); with `forearm` (a radius) the whole forearm from the elbow down is mirrored too, laid along the old forearm's line, the buried forearm's fur is deleted, and the wrist / fist / grip joints move onto the new geometry;
   - `free_arm` (both): the forearm and hand are copied off the body (`lift_limb`, skipped with `lift: False` when `hand` already rebuilt them as a separate piece). The face selection (near the bone line, facing away from it, not shorts-coloured) is speckled on these sculpts, so `tidy_selection` drops selected specks and adds small unselected patches that the selection surrounds; after the cut, `drop_fragments` deletes loose bits the cut created (pieces that were already separate, like buttons, stay). The copy is tagged in a `part` vertex attribute; holes are patched with fans in the colour around them, preferring the shorts colour where a limb left the body. After skinning, the forearm is turned `pitch`° forward and `out`° outward and that pose is applied as the new rest pose (`apply_pose_as_rest`), so it rests clear of the body.
   A model delivered in a T-pose (or any pose with free hands) needs no `remodel`. Check the result close up: `art/preview_clips.py` sheets, or orthographic renders of the arm in `idle`, `ready` and `run`.
3. **Skeleton** from a per-character landmark table (`CHARACTERS[id]['joints']`, joint positions measured on the source model in its own coordinates): 22 deform bones + 4 sockets + `root`. *T-pose*: `landmarks.auto_joints` reads them off the mesh: the arms are the band of heights the hands occupy, the shoulder sits 3 cm inside the first column (walking in from the fingertips) that reaches far below the arm, wrist and fist a hand's length in from the tips, elbow halfway; the crotch is the lowest slice where the legs join, hips just above, the ankle where the slices stop being shoe-deep, the toe the shoe's foremost point; chest just under the shoulders, neck the narrowest slice above them, head top the highest slice still head-deep. Ears and tails are given per character in `overrides` (the rules for them were unreliable: hair, hats and pouches look like them), characters without them get stub bones with no weights. Checked by rendering the bones over the mesh.
4. **Skin weights**: Blender's heat diffusion (automatic weights; if it fails on enclosed pieces it is retried without the small ones), then rules for what heat gets wrong on these models:
   - vertices it misses (small separate pieces) copy their nearest neighbour's weights;
   - arms modelled hanging against the body: below the armpit, a vertex counts as arm only if its normal faces away from the arm more than from the spine (smoothed over the mesh), so raising an arm no longer drags the shirt;
   - the fists and the racket are rigid on their hand bones;
   - the shorts never follow the arms (a hand rested on them in the source pose); the lifted forearm copy follows only its arm, and what it was lifted from never does;
   - no weights cross from one leg to the other; shoes are rigid on their foot; small pieces (laces, eye highlights) move as one; light smoothing, at most 4 influences, normalized.
   - small separate pieces (a tool on a belt, laces, eye highlights) take the weights of the nearest vertex of the bigger piece they sit on (`attach_small`; heat diffusion gave the lioness's belt tool to an arm), unless heat gave them mostly to an ear or tail bone (the panda's pom-pom).
   *T-pose*: the arm-against-body and shorts rules are skipped (the arms are clear of the body).
   (`pin`, which glued a pocketed hand to the hips, is still supported but no longer used.)
5. **Tools**: the modelled racket is split into its own mesh `prop_racket`; a table-tennis paddle `prop_paddle` is generated in the same grip, aligned with the racket's shaft and face (`rig.ToolFrame.from_points`). *T-pose*: first the arms are dropped into a relaxed rest pose (`relax_arms`: `rest.out` degrees from vertical, forearms forward, hands turned so their backs face out), then a toy racket (`rig.build_racket`, in the character's `racket.color`) and the paddle are generated in the right fist, hanging beside the leg with the strings in the sagittal plane. The grip is described per character (`grip.shaft`: which way a stick would run through the modelled fist in the T-pose, `grip.back`: the back of the hand).
   Every clip's racket pose also states which way the strings face (`racket_up(..., normal=)` → `Anim.aim`), so all six hold the racket the same way whatever their modelled grip; the values were read off the bunny's original clips, which are unchanged.
6. **Clips** (`art/clips.py`) keyed on the pose bones from code: body-axis rotations, limbs aimed at directions, two-bone IK (`reach`: the left hand on the racket throat in the ready position), a ground solver that keeps the lowest sole on the floor, key poses joined by eased slerps. Per-character traits: ear style (upright / floppy), tail wag strength (`pocket` keeps a left hand in a pocket, unused now). **Foot planting**: `walk`, `run` (`plant_legs`) and `strafeL/R` place each foot with IK so that, while it is down, it moves back under the body at a constant speed; the game plays each clip faster or slower so its speed matches. Those speeds are `walkSpeed` 0.375, `runSpeed` 0.99 and `strafeSpeed` 0.44 model units/s in `js/character.js`; they follow from `WALK_STRIDE`, `RUN_STRIDE` and `STRAFE_STEP`, so change both together.
7. **Texture** downsized from 4096² to 1024² JPEG; one material.
8. **Export** the armature, body and both tools with every action as a named glTF animation, then meshopt via `build.sh`.

Review tools: `art/animals.py art/build bunny --blend` writes `art/build/bunny_rigged.blend` (open it in Blender, scrub the actions); `blender -b art/build/bunny_rigged.blend --python art/preview_clips.py -- clips.png` renders a contact sheet of every clip; `tools/characters.html` plays the exported `.glb` in the browser (with *Move the character* ticked it travels at the chosen velocity over a grid, to judge foot sliding); `npm run smoke` measures how far the planted foot slides while walking, running and side-stepping.

### Adding or replacing a character

1. Put the model in `art/source/characters/<id>/` with its `.fbm/` texture folder next to it (unrigged, one mesh, standing in a T-pose, facing the camera's front view, no racket). That is the cheap path; an arms-down model with a modelled racket needs the measured path below.
2. Copy an `'auto'` entry in `CHARACTERS` (`art/animals.py`): FBX path, `grip` (how the modelled fist would hold a stick), `overrides` for the ear and tail chains (measured on front/side renders with a 10 cm grid; Blender front view = −Y), `rest` angles, the racket colour and `traits` (`ears`: `'up'`, `'floppy'` or `'none'`; `tail` strength, 0 for none).
3. `./art/build.sh animals` (or `art/animals.py <dir> <id> --blend` for one), look at the skeleton over the mesh and the clips (`preview_clips.py`, the `--blend` file, `tools/characters.html`), fix a wrong joint with an override, then `npm run smoke`.
4. Register it in `js/character.js` (`defs`) and add it to the games' `characters` pool.

Measured path (arms-down models): the entry needs `center` and the full joint table instead, measured on orthographic renders (hips, spine, chest, neck, head top, back, hip/knee/ankle/toe, shoulder/elbow/wrist/fist, ears, tail, `grip` points; joints must sit inside the limb they bend), the `racket` box (`whole_parts` if separate pieces, `keep` = the fist sphere if fused), `shorts` (colour and tolerance of the clothing the arms must never drag) and `remodel` if a hand is fused to the body.

To replace the bunny or the pup with a new model of the same character, steps 2–4 are enough; keep the id so the game picks it up.

## Island venue (`art/island.py`)

The source island's court is squat (1.30:1 instead of 2.17:1), rotated about 9°, bumpy, and has a hole at one corner; its stands are stretched boxes, one hidden under a 40 m tarp of stretched faces, its streamers single triangles, its trees faceted canopies with the shading baked into the texture. The script works on the loose pieces by rule (connected components, the texture colour under each face, what each piece stands on by ray cast, fill = surface area over bounding-box area), so a regenerated model with the same layout still builds:

1. **Removed**: the three stand boxes with everything that stood on them, loose spectator blobs and umbrellas around the court, every stretched sheet (fill < 0.1), the cyan torn pennant line, the draped cloths strung between the banner poles (thin or almost area-less sheets that are wide, or saturated blue), the long rails and the plank deck, the old court sheet and net, all 41 trees and green scraps, the yellow ball crates, and any loose prop left inside the court-and-stands band (lamp and fence posts).
2. **Split off**: the whitish hanging banners (thin sheets taller than wide, origin at the top edge, morph target `wave` that bends the cloth toward the hem) and the boat (every piece inside the hull's footprint).
3. **Transform**: aligned and scaled around the court (×89.9, court 23.77 m long, rotated so the source's grandstand side is the far baseline), lowered onto a regulation court on a coral plinth, the old court's ground removed and flattened under the plinth, the corner hole plated. The texture is colour-graded (saturation ×1.32 about the luminance, gamma 0.86, a touch of warmth) before being downsized to 2048², which lifts the AI model's muddy baked shading toward the reference's palette.
4. **Added**: four grandstands hugging the court in light wood (three tiers with umbrellas along the sides 3.8 m outside the doubles lines, two behind each baseline 5.1 m past them, below the chase cameras); ~110 toy-animal spectators of six species (bunny, bear, cat, pig, panda, fox: shirts from the palette, eyes with highlights, blush, paws, some caps and flags; `crowd_*`, one node each); pennant strings along every front rail and between the tall banner poles (`bunt_*`, morph target `wave`); stylised coconut palms (ringed curving trunks, 8–10 rising-then-drooping fronds, coconuts) and flowering bushes where the model's trees stood (`tree_*`, origin at the base), bushes at the stands' ends; ball baskets by the net posts; three gulls; fourteen cartoon clouds (a far ring and a few near ones); a turquoise sea with planar UVs for the ripple texture.
5. **Animation**: a 20 s baked loop (the boat rocks, the gulls circle and flap). `Kit3D.liven` moves the rest by node name at runtime, and `racket.js` calls `cheer()` on every point. The sky gradient (`Kit3D.skyDome`), the fog and the lighting balance are the game's (`js/games/tennis.js`: `skyDome`, `light`, `exposure`, `fog`).

The court measurements are constants at the top of the script (how they were measured: [knowledge/island-court.md](../knowledge/island-court.md)). `art/island.py out.glb preview.png` renders four Workbench previews (overview, the far end, the main camera's view, a stand close up).

## Kitchens (`art/kitchens.py`)

The three cooking dioramas (`art/source/environments/cooking/`, AI-generated from isometric pictures) lean back by 12–37° and carry their stations as painted boxes. The build reads each kitchen's entry in `js/games/kitchens.js` (the file is JavaScript, but the object literal is strict JSON and the script parses it) and:

1. **Levels** the model with the plane fitted through the counter bottoms (`level.plane`, `level.floor`), scales it so a counter pitch is one metre (`scale`) and centres it on the tile grid (`x0`, `y0`: where tile (0,0)'s top-left corner falls in the levelled model). These numbers were fitted once with a scratch script and are stored, so the grid never drifts.
2. **Removes** every loose piece whose centre lies on a station, counter or bridge tile (the game puts its own templates there), small props (< 0.8 m) on walkable tiles, pieces straddling bridge tiles, and whatever stood on a removed piece.
3. **Flattens** the ground under walkable and station tiles to z = 0 (vertices within 0.3 m of it).
4. **Adds** plank bridges with rails on `=` tiles (oriented by the walkable neighbours) and, on the beach, two gulls.
5. **Splits off** trees (`tree_*`), banners (`flag_*`, morph target `wave`) and boats (`boat_*`, big deep pieces afloat on scenery tiles; they rock in a 16 s baked loop).

Painted water stays painted: a translucent ripple sheet built from the ground's blue faces turned into blue blocks, because the low-poly ground triangles mix water and land. `--preview` renders an overview, an oblique view and a top view per kitchen. Re-fit the grid (and the constants) only if a source model is replaced.

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
| `cat.glb`, `panda.glb`, `chimp.glb`, `lioness.glb` | 580–725 KB | 11–13k body, generated racket ~1.3k, paddle 0.4k | 1024² JPEG |
| `island_court.glb` | ~2.2 MB | ~7k island; ~85k in the crowd, palms, stands, pennants, sea, gulls and clouds (~290 nodes) | 2048² JPEG |
| `tennis_court.glb` (fallback) | ~1 MB | — | none |
| `landing_island.glb` | ~1.26 MB | ~27k (11k landmass, the rest undersides, props, clouds, 80 meshes) | 2048² JPEG |
| `kitchen.glb` | ~330 KB | 54 templates | none |
| `kitchen_paddy.glb`, `kitchen_beach.glb`, `kitchen_city.glb` | 845–870 KB | 4–5k each | 2048² JPEG |

Each character's eleven clips take ~56 KB together (sampled every frame, 27 bones, meshopt; measured with `gltf-transform inspect`).

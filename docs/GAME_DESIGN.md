# Game design

Status labels: **Established** = shipped in code. **Direction** = suggested by assets or references, not implemented. **Undecided** = no decision recorded.

## Concept (Established)

*Mabar* (Indonesian *main bareng*, "playing together") is a couch party-game platform. One laptop or TV is the shared screen; every player uses their own phone as the controller by scanning a QR code. No app, no account, nothing to install. Friends who aren't in the room can watch a live stream on their own screen and still join with their phone.

Core experience goals visible in the product:
- **Seconds to start**: open the page, scan, play.
- **Drop-in, drop-out**: phones stay connected across games; AI fills empty seats and takes over when someone leaves.
- **Physical, readable input**: swing the phone like a racket, or use a familiar Xbox-style gamepad.
- **Bright, toy-like presentation** that reads well on a TV from the couch.

## Games (Established)

| Game | Controls | Players | Shape |
| --- | --- | --- | --- |
| Main menu | Gamepad / keyboard | any | 3D island diorama; characters play each game on a loop; "Coming soon" slot |
| Tennis | Motion | 1–4 (singles/doubles, AI fill) | Auto-run; timing aims, swing strength sets speed; real tennis scoring, first to 2 games |
| Table Tennis | Motion | 1–4 (AI fill) | Same engine; first to 5; split screen when both sides are human |
| Cooking | Gamepad | 1–4 co-op | Chop, cook soups, plate, serve orders against timers; 3-minute shift, 1–3 stars |

Each game opens with a waiting room showing the join QR and room code. Removed earlier: Snake and Arena (commit `45b5e62`).

## Visual direction

**Established (in code):** rounded, saturated "toy diorama" look; warm hemisphere + key lighting; chibi human characters built procedurally in Blender; player identity by shirt/accent color and a floating name tag. Fonts: Fredoka/Rubik.

**Direction (references in `art/reference/`, models in `art/source/`, not integrated):**
- Anthropomorphic animal characters: a cream **Bunny** with olive cargo shorts, white tee and sneakers holding a tennis racket, and a **Puppy** (the model file is named "dog"), each with front/left/right/back turnarounds.
- A **Tropical Bunny Tennis Island** environment: a tennis court on a cliff island with palm trees, wooden stands full of animal spectators, piers, a waterfall, and bunny banners.
- Matching FBX models exist for the bunny, dog and island court (textured, apparently unrigged; see [knowledge/fbx-source-assets.md](../knowledge/fbx-source-assets.md)).

## Character system

**Established:** three character templates (`ch_tennis`, `ch_tt`, `ch_chef`), all the same chibi body with different outfits. Animated procedurally through named pivots; colors assigned per player slot (8 slot colors). Players don't choose a character.

**Undecided:**
- Whether the animal characters replace the chibi humans, or become selectable alongside them.
- Whether players pick a character (and where: phone or lobby), and how that interacts with slot colors.
- Whether characters will be rigged/skinned (needed for the FBX models to animate like the reference) or adapted to the current pivot system.
- Whether the island environment replaces the tennis stadium or becomes an additional venue.
- Which character goes with which game, and whether the Bunny is the brand mascot (the banners in the island reference suggest it).

## Other open product decisions (Undecided)

- What fills the menu's "Coming soon" slot.
- Real popularity ratings: the menu's star ratings are placeholders "for a future popularity vote".
- Audio: there is no sound or music in the code.
- Monetization, accounts, persistence: none exist; no direction recorded.
- Final product name for the GitHub repo (currently `rubick`, the MVP's name).

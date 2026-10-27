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
| Tennis | Motion | 1–4 (any lineup, AI fill) | Island court, Team Bunny vs Team Pup; auto-move (side steps, runs for long dashes); timing aims, swing strength sets speed; overhead serve; real tennis scoring, first to 2 games |
| Table Tennis | Motion | 1–4 (any lineup, AI fill) | Same engine and animals (with paddles); sports hall; first to 5; split screen when both sides are human |
| Cooking | Gamepad | 1–4 co-op | Chop, cook soups, plate, serve orders against timers; 3-minute shift, 1–3 stars |

Each game opens with a waiting room showing the join QR and room code. In the racket games the host chooses the lineup (owner request, 2026-10-27): each empty seat can be closed or reopened (× / +, keys 1–4), so 1v1, 2v2, 1v2 and so on all work, as long as each side keeps a player; AI plays the open seats. *Start now* (`F`) starts immediately; with nobody joined it runs an AI-only demo that repeats, for watching the game and its animations without phones. Removed earlier: Snake and Arena (commit `45b5e62`).

## Visual direction

**Established (in code):** rounded, saturated "toy diorama" look; warm hemisphere + key lighting; player identity by a floating name tag in the player's color (plus shirt color on chibis, a colored ring under the animals). Fonts: Fredoka/Rubik.
- Anthropomorphic animal characters in the racket games: a cream **Bunny** (olive cargo shorts, white tee, sneakers) and a **Pup** (red varsity jacket; the model file is named "dog"), rigged and animated from the AI-generated models in `art/source/` (turnarounds in `art/reference/`).
- Tennis is played on the **Tropical Bunny Tennis Island** (palm trees, wooden stands of animal spectators, bunny banners, sea), with a regulation court laid over the model's own.
- Chibi human characters (procedural, in Blender) remain in Cooking and as the fallback when the animal files can't load.
- The landing page is a floating-island diorama in the sky (the AI-generated "floating island game" model, cleaned up and completed in `art/landing_island.py`): the three game islands around a plaza with a gold cat statue, an airship, hot-air balloons, a windmill, pennants and clouds. Page chrome: sky gradient, glass cards, Fredoka headlines (owner reference: HKDI's "Design Island" page, 2026-10-27).

## Character system

**Established (owner decision, 2026-10-27):** Tennis and Table Tennis use the skinned animals (clips: idle, ready, walk, run, strafeL/R, jump, victory, defeat, swing, serve); the near side (side 0) is the Bunny, the far side the Pup, so doubles is Team Bunny vs Team Pup. Tennis uses the island; Table Tennis keeps the sports hall for now ("update the table tennis environment later") with the same animals holding paddles instead of rackets. Cooking keeps its chibi chefs (`ch_chef`), colored per player slot. Players don't choose a character.

**Established (owner request, 2026-10-27: "fix anything odd or unnatural, even if the model has to change"):** players behave like tennis players. They wait in a two-handed ready position during play, side-step for short moves and run only for long dashes, without sliding feet; servers toss and serve overhead in Tennis (Table Tennis serves with the forehand); the ball arrives on the racket side; winners celebrate and losers hang their heads. Both models originally had the left hand fused to the hip or a pocket; it was cut free and re-posed in the build (`art/animals.py`). The owner will supply future characters in a T-pose.

The character system already supports per-character tools, accessories on sockets (hat, back, hands) and outfits (texture swap and/or accessories), but no cosmetics exist yet.

**Undecided:**
- Whether players pick their animal (and where: phone or lobby), and how that interacts with slot colors.
- More animals, and whether Cooking gets animal chefs.
- The Table Tennis environment.
- Whether the Bunny is the brand mascot (the island banners suggest it).

## Other open product decisions (Undecided)

- What fills the menu's "Coming soon" slot.
- Real popularity ratings: the menu's star ratings are placeholders "for a future popularity vote".
- Audio: there is no sound or music in the code.
- Monetization, accounts, persistence: none exist; no direction recorded.
- Final product name for the GitHub repo (currently `rubick`, the MVP's name).

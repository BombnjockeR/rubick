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
| Tennis | Motion | 1–4 (any lineup, AI fill) | Island court, one animal per player; auto-move across and in depth at a capped speed (sideline to sideline in ~1.7 s), so placement wins; timing aims, swing strength sets speed and depth, the phone's swing direction pulls the ball and lobs or smashes, tilt moves the player in or back; nets and long balls; overhead serve; real tennis scoring, first to 2 games |
| Table Tennis | Motion | 1–4 (any lineup, AI fill) | Same engine and animals (with paddles) at table speed; sports hall; first to 5; split screen when both sides are human |
| Cooking | Gamepad | 1–4 co-op | Three Indonesian kitchens (Paddy Field, Beach, Pontianak City) chosen in the waiting room; nine dishes from eleven crates and five station types; chop, rinse, boil, fry, plate, serve against order patience; burning blocks the station until it is scraped; 4-minute shift, combo tips, 1–3 stars against a par per chef count |

Each game opens with a waiting room showing the join QR and room code. In the racket games the host chooses the lineup (owner request, 2026-10-27): each empty seat can be closed or reopened (× / +, keys 1–4), so 1v1, 2v2, 1v2 and so on all work, as long as each side keeps a player; AI plays the open seats. *Start now* (`F`) starts immediately; with nobody joined it runs an AI-only demo that repeats, for watching the game and its animations without phones. Removed earlier: Snake and Arena (commit `45b5e62`).

## Visual direction

**Established (in code):** rounded, saturated "toy diorama" look; warm hemisphere + key lighting; player identity by a floating name tag in the player's color (plus shirt color on chibis, a colored ring under the animals). Fonts: Fredoka/Rubik.
- Anthropomorphic animal characters in the racket games: a cream **Bunny** (olive cargo shorts, white tee, sneakers), a **Pup** (red varsity jacket; the model file is named "dog"), a **Cat** (purple cap, blue tee), a **Panda** (blue jacket and cap), a **Chimp** (yellow hoodie; the reference calls it a gorilla) and a **Lioness** (hard hat, overalls; the model file says cheetah), rigged and animated from the AI-generated models in `art/source/` (turnarounds in `art/reference/`). The four newer ones came in a T-pose without a racket; their rackets and paddles are generated in the build, in a colour per character.
- Tennis is played on the **Tropical Bunny Tennis Island** (palm trees, bunny banners, sea), with a regulation court laid over the model's own and, since 2026-10-28, four generated grandstands in light wood hugging the court with about a hundred toy-animal spectators of six species who bob, jump on every point and go wild at the end, umbrellas, pennants along every rail, stylised coconut palms and flowering bushes in place of the model's muddy trees, ball baskets, gulls, cartoon clouds, a rocking boat and a turquoise rippling sea under a gradient sky, with the island's own texture colour-graded toward the reference's palette (owner direction, same day: "like a professional environment artist's work"; trees, viewers, sky and lighting first). The model's own stands, benches, rails, trees, crates, posts near the court and every draped or stretched sheet were removed by rule.
- Cooking is played in three dioramas built from the AI-generated models in `art/source/environments/cooking/` (the owner's concept references: Field Kitchen, Seafood Kitchen, Pontianak Riverside): levelled, cleared on the station tiles and completed with grid-aligned bridges; palms sway, banners flutter, boats rock, gulls circle the beach.
- Chibi human characters (procedural, in Blender) remain only as the fallback when the animal files can't load.
- The landing page is a floating-island diorama in the sky (the AI-generated "floating island game" model, cleaned up and completed in `art/landing_island.py`): the three game islands around a plaza with a gold cat statue, an airship, hot-air balloons, a windmill, pennants and clouds. Page chrome: sky gradient, glass cards, Fredoka headlines (owner reference: HKDI's "Design Island" page, 2026-10-27).

## Character system

**Established (owner decision, 2026-10-27; six animals 2026-10-28):** Tennis and Table Tennis use the skinned animals (clips: idle, ready, walk, run, strafeL/R, jump, victory, defeat, swing, serve). Each phone plays as the animal of its seat slot (bunny, pup, cat, panda, chimp, lioness in that order), the same one in every game; AI seats take the animals nobody in the match has. Tennis uses the island; Table Tennis keeps the sports hall for now ("update the table tennis environment later") with the same animals holding paddles instead of rackets. Cooking (2026-10-28) uses the same animals empty-handed (`tool: null`), by seat slot; the chibi chef is the fallback. Players don't choose a character yet.

**Established (owner request, 2026-10-27: "fix anything odd or unnatural, even if the model has to change"):** players behave like tennis players. They wait in a two-handed ready position during play, side-step for short moves and run only for long dashes, without sliding feet; servers toss and serve overhead in Tennis (Table Tennis serves with the forehand); the ball arrives on the racket side; winners celebrate and losers hang their heads. The bunny and pup originally had the left hand fused to the hip or a pocket; it was cut free and re-posed in the build (`art/animals.py`). The owner now supplies characters in a T-pose, which the build handles by itself (automatic joints, arms dropped to a relaxed rest, generated tools). Their arms are short next to their big heads, so the overhead serve and the two-handed ready grip are stylised on them.

## Racket gameplay

**Established (owner request, 2026-10-28: make the games more engaging; the court-to-character size question is about how long a run takes, not proportions):**
- Movement has a speed limit, set per game as the time to run from sideline to sideline (`crossTime`: Tennis ~1.7 s, Table Tennis ~0.9 s), and players move in depth too (forward for short balls, back for lobs, the phone's tilt shifts their spot toward the net or deeper). A swing only counts within reach of the ball, so a well-placed ball against a player who is late getting back wins the point.
- The ball has real flight: a landing spot (depth from power and the swing's lift; past the baseline or table end = long), a bounce, hops, a net fault when it crosses the net too low (very late hits), and a contact point the receiver runs to.
- Shot shaping: timing aims left/right (late also short), power sets speed and depth, the direction the phone moves (read from the gyroscope and accelerometer against gravity) pulls the ball left or right and lifts it into a lob or drives it down into a smash, and running into the ball carries it along.
- The phone-direction and tilt readings have not been checked on real phones yet (see the development log); the keyboard player has the same controls for testing.

The character system already supports per-character tools, accessories on sockets (hat, back, hands) and outfits (texture swap and/or accessories), but no cosmetics exist yet.

## Cooking gameplay

**Established (owner brief 2026-10-28: "as good as Overcooked 2"; the full design with rationale and playtest questions is in [docs/gdd/GDD.html](gdd/GDD.html) §08):**
- **Loop**: orders with patience bars; take → prepare (chop at a board, rinse rice at the sink; held X) → cook when the dish needs it (a pot boils up to three things together in 8 s, a fryer one in 6 s) → plate → serve at the hatch. One item per chef, one item per counter tile; plates combine with what is on a counter in either direction.
- **Vocabulary**: 8 ingredient families as 11 crates (rice, noodles, vegetables, tofu, fish, squid, shrimp, crab, chili, citrus, peanut sauce), 5 station types (board, sink, cooker, fryer, dish stack) plus the hatch and the bin, 9 dishes with 6 spicy / extra variants, 3 kitchens of 3 dishes each. Plates, bowls and glasses are one "plate" in play; the matched dish decides what is drawn.
- **Orders**: two at the start, then a gap of 26 / 20 / 16 / 13 s for 1–4 chefs that shrinks by a quarter over the shift, at most 3 / 4 / 5 / 5 waiting; three-part dishes rare in the first 40 s, variants after 90 s, never three alike in a row; patience 50–84 s × 1.3 for a solo chef, × 1.1 for two.
- **Mistakes**: ready food waits 12 s in the pot (10 s in the fryer), smokes, then burns: the station is blocked until scraped (X, 2 s). Chopped food never spoils. Wrong dish at the hatch: bounced, no penalty. Missed order: −10 and the combo is lost. Every refusal says why on the TV; the phone's hint line says what to do with what you hold.
- **Scoring**: 20 a dish + a tip up to 12 for speed + combo bonus (5 from the third dish in a row, 10 from the fifth). Three stars at 26 × (6 + 3 per extra chef), two at 65 %, one at 35 %.
- **Map choice**: the host clicks a card or presses ← → in the waiting room; any phone's d-pad left / right flips it; `?map=` opens one directly. The room card lists the kitchen's recipes as one-line steps.
- **Shift**: 4 minutes, results for 12 s, back to the room with the same kitchen selected.

**Tuned on paper only** (no playtest yet): every number above. First questions: can two chefs reach two stars on the Paddy Field in their second shift; is the pot's grace enough with four chefs and two cookers on the Beach; do people pass across counters.

**Undecided:**
- Whether players pick their animal (and where: phone or lobby) instead of getting it by seat, and how that interacts with slot colors.
- A second cooking shift on the same map with a higher par; washing-up (dirty plates) and fire, both Overcooked staples left out on purpose until a playtest.
- The Table Tennis environment.
- Whether the Bunny is the brand mascot (the island banners suggest it).

## Other open product decisions (Undecided)

- What fills the menu's "Coming soon" slot.
- Real popularity ratings: the menu's star ratings are placeholders "for a future popularity vote".
- Audio: there is no sound or music in the code.
- Monetization, accounts, persistence: none exist; no direction recorded.
- Final product name for the GitHub repo (currently `rubick`, the MVP's name).

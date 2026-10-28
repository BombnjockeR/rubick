# Architecture

How the pieces fit together, kept in step with the source (last checked 2026-10-28, after the kitchens; when they disagree, the source wins and this file gets fixed). Message formats, setup and the game-authoring snippet live in [README.md](../README.md).

## Stack

| Concern | What | Where |
| --- | --- | --- |
| Pages | 4 static HTML files, classic `<script>` tags, no build | repo root |
| 3D | Three.js 0.186 (custom bundle incl. `GLTFLoader` + `MeshoptDecoder`), WebGL | `vendor/three.mabar.min.js`, `js/kit3d.js`, `js/character.js` |
| 2D HUD | Canvas 2D on `#arena`, layered over the WebGL canvas | `js/screen.js`, each game's `draw()` |
| Networking | PeerJS 1.5.5 over WebRTC data channels; public PeerJS broker for the handshake; Metered TURN relay | `vendor/peerjs.min.js`, `js/common.js` |
| QR codes | qrcode-generator 2.0.4 | `vendor/qrcode.js` |
| Hosting | GitHub Pages, repo root, `.nojekyll` | — |
| Dev tools | `http-server`, `@gltf-transform/cli` (devDependencies only) | `package.json` |

Nothing at runtime comes from npm; the site only needs the files in the repo plus the PeerJS broker, Metered and Google Fonts.

## Pages and script order

Globals are created in load order, so order in the HTML is significant.

| Page | Scripts (in order) | Role |
| --- | --- | --- |
| `index.html` | common → landing (lazy-loads three → kit3d → `assets/landing_island.glb`; a still image without WebGL) | Landing page: a full-screen island you can turn, with pins that open floating panels; join-by-code redirects to `controller.html?room=CODE` |
| `play.html` | peerjs, qrcode, three → common → kit3d → character → games/menu, racket, tennis, pingpong, kitchens, cooking → **screen** | Host hub (must load last: it starts the menu and the room) |
| `controller.html` | peerjs → common → controller | Phone gamepad / motion paddle |
| `watch.html` | peerjs, qrcode → common → watch | Remote viewer: receives a video stream, shows a join QR |
| `tools/characters.html` | three → kit3d → character (inline script; `<base href="../">`) | Dev tool: character viewer, used by `tools/smoke.mjs`; not linked from the site |

Globals: `MABAR` (constants, button bits, PeerJS/TURN options, room codes) and `MabarGames` (registry) in `js/common.js`; `Kit3D` in `js/kit3d.js`; `MabarChars` (animated characters) in `js/character.js`; `MabarRacket` in `js/games/racket.js`; `MabarKitchens` (the cooking maps, a JSON literal) in `js/games/kitchens.js`; `window.__mabar` (debug handle) in `js/screen.js`.

## Host hub (`js/screen.js`)

- Creates the room: random 4-letter code → PeerJS id `MABAR.PREFIX + code`; rerolls on `unavailable-id`, reconnects to the broker on `disconnected` (connected phones keep playing).
- **Players**: each controller connection gets a slot (0–7, `MAX_PLAYERS = 8`), a color and a player object `{ id, slot, name, color, conn, sx, sy, b, rtt, remote, ... }` in `hub.players`. A keyboard player (`id 'kb'`) is added on first key press (WASD, Space = A, E = B, X = X).
- **Input**: `{t:'in'}` updates stick/buttons; newly pressed bits go to `game.press(p, bits)`. Input from a phone that's silent for 1.5 s is zeroed.
- **Games**: `setGame(id)` stops the current instance, calls `def.create(hub)`, `start()`, re-`join()`s every player and tells phones the control mode (`'pad'` | `'motion'`). The current game is mirrored in `?game=`. Every phone stays connected across switches; `menu` is the home game.
- **Loop**: one `requestAnimationFrame` loop calls `game.update(dt)` (dt capped at 0.1 s) and `game.draw(ctx, now)`, then composites the remote-screen frame. Hints/action labels are pushed to phones every 150 ms, only when changed.
- **Remote screens**: a connection with `metadata.role === 'viewer'` gets no seat; the hub calls it back with a `captureStream(30)` of a mix canvas (all `canvas.gl-layer` + the HUD canvas, ≤1280 px wide, ~2.5 Mbps cap) and sends a 1 s heartbeat.

### Game instance interface

`create(hub)` returns an object with any of: `start, stop, join(p), leave(p), press(p, bits), swing(p, power), action(p), actionLabel(p), hint(p), meta(p), update(dt), draw(ctx, timeMs), resize()`. The `hub` exposes `players, B, ctx, W, H, UNIT, send, rumble, dir(p), font, drawJoin, showLobby, setGame, goMenu, code, joinUrl, refreshRoster`.

### Games

| File | Notes |
| --- | --- |
| `games/menu.js` | Hidden from lists; 3D diorama with animated characters (`AnimationMixer` on `menu.glb` clips), selectable cards on the HUD. Card list (and placeholder star ratings) is hard-coded in `GAMES`. |
| `games/racket.js` | Shared engine: waiting room (60 s, 4 seats alternating sides, vote to start; the host can close / reopen empty seats for any lineup, and *Start now* / `F` starts at once or runs an AI-only demo), singles/doubles, AI seats, ball flight, player movement, swing timing and direction, scoring (`'tennis'` or `'points'`), chase cameras, split screen when both sides are human. Remote players get a wider timing window (`lagOf`). Players are animated animals when the config lists `characters` (a pool: each phone gets one by its seat slot, AI seats take the rest) and they loaded, otherwise chibis; `envFallback` is loaded if `env` fails. Debug hooks on the game object: `_forceStart`, `_toggleSeat(i)`, `_lineup()`, `_debug()`, and for stroke tests `_place`, `_shot`, `_slow`, `_flight`. |
| `games/tennis.js`, `games/pingpong.js` | Pure config objects for `MabarRacket.define` (court dimensions incl. `landMax`, `net` and `walls`, env `.glb`, the character pool and tool, chibi fallback node, camera, `crossTime`, `step`, `dive`, the ball's flight (`ball`: drag, bounce, spin, lob and pop-up heights) and the shot pace). Tennis: island court, rackets, dives. Table Tennis: sports hall, the same animals with paddles, lunges only. |
| `games/kitchens.js` | Data only: the three kitchens (`MabarKitchens`): name, diorama `.glb`, the fitted levelling of the source model, the tile `map` (floor, water, bridges, counters, station letters, crates), spawns, recipe list. Strict JSON inside, so `art/kitchens.py` reads the same file. |
| `games/cooking.js` | Co-op kitchen. Phases: `room` (join QR, practice, votes) → `pick` (once all voted or the clock ran out: the three kitchens as miniature dioramas on 3D cards in a separate scene, `buildPick3D`; left / right or the stick moves the highlight, A / the phone button / a click confirms, `PICK_TIME` auto-confirms; the real `kitchen_<id>.glb` scenes are reparented into the cards and back) → `countdown` → `play` → `over`. `?map=` sets the practice kitchen. Rules: `ING` (each ingredient's prep step and what the pot / fryer turn it into), `RECIPES` (parts as `ingredient:state`, container, patience, variants), `PACE` (order gap, cap and patience per chef count), `par()` for stars. Stations are cloned from `kitchen.glb` templates onto the station tiles; the diorama from `kitchen_<id>.glb` is livened by `Kit3D.liven`; chefs are the animals (`MabarChars`, empty-handed) or the chibi fallback. Debug hooks: `_debug` (incl. `pick`), `_order, _give, _teleport, _tick, _press, _setMap` (swaps the practice kitchen in the room, moves the highlight in the pick), `_fastForward`. |

## Rendering

- `Kit3D.renderer(hub)` inserts a full-screen WebGL canvas (`.gl-layer`) *behind* the 2D `#arena` HUD canvas; games dispose it in `stop()`. Settings: shadows on, `NeutralToneMapping`, exposure 1.05, sRGB output, pixel ratio ≤ 2.
- `Kit3D.lights()` gives the shared "toy diorama" lighting (hemisphere + shadowed key + rim).
- `Kit3D.skyDome({ zenith, horizon })` returns an inside-out sphere with a vertex-colour gradient (fog-free, drawn first) for games that want a day sky instead of a flat background; `Kit3D.lights()` takes `hemi`, `ground`, `hemiIntensity`, `keyIntensity`, `keyColor` so a venue can set its own balance (Tennis: a cooler, dimmer hemisphere with sea-bounce and a stronger warm sun, exposure 1.12).
- `Kit3D.liven(gltf)` animates an environment by node name (the contract the Blender scripts follow): plays the file's baked clips on a mixer; `tree_*` sway about their base; meshes under `flag_*` / `bunt_*` flutter through their `wave` morph target; `crowd_*` bob and jump on `cheer()`; `umbrella_*` wobble; `cloud_*` drift; `steam_*` rise; materials named `sea`, `shallows` or `water` get a scrolling ripple texture. Returns `{ update(dt, t), cheer(strength), dispose() }`; nothing is required of the file. Rest poses are kept in each node's `userData.rest` and restored by `dispose()`, so the same loaded file can be livened again (Cooking does: the kitchen pick, then the shift). Used by the racket engine (the tennis island) and Cooking (the kitchens).
- Two kinds of characters:
  - **Animals** (all three games): skinned meshes with baked clips, driven by `MabarChars` (below); six of them (bunny, dog, cat, panda, chimp, lioness), one per player by seat slot; in Cooking they carry no tool and the held item rides in front of the chest. Player identity: the colored name tag and a ring in the player's color under the feet.
  - **Chibis** (the fallback when the animal files can't load): hierarchies of named pivots (`<char>_head`, `_armL/R`, `_legL/R`, a tool socket on the right arm) that the game rotates procedurally each frame. Player colors are applied by cloning materials named `shirt`, `accent`, `hair`.

## Characters (`js/character.js`)

`MabarChars` holds the character definitions (`defs`: `url`, `height`, `scale`, `offset`, `rotationY`, the walk / run / side-step reference speeds, default `tool`, `outfits`) and loads each `.glb` once through `Kit3D.load`. `load(id)` rejects if the file is missing or has no skinned mesh; games catch that and use their fallback. `create(id, { position, rotationY, scale, tool })` returns an instance:

- `root` (add to the scene, move/turn/scale freely) containing a skeleton-aware clone of the asset (`SkeletonUtils.clone` isn't in the vendor bundle, so the module rebinds cloned skeletons itself). Skinned meshes have `frustumCulled = false`: their bounds move with the animation.
- **Locomotion**: `setSpeed(m/s)` (forward) or `setVelocity(vx, vz)` (world; split into forward and sideways by the root's facing). Forward motion blends standing → `walk`, then switches to `run` with hysteresis; sideways motion (more than ~45° off the facing) plays `strafeL` / `strafeR`. Standing still is `idle` or, after `setStance('ready')`, the tennis ready position. Weights ease toward their targets; playback speed follows the actual speed against the definition's `walkSpeed` / `runSpeed` / `strafeSpeed` (the speeds at which each clip's planted foot stays put, clamped), and walk and run stay phase-synced. Walk and run are not mixed for long: they plant their feet at different points of the stride, so a steady blend would slide. `strafeLimit()` is the fastest sideways speed the side step keeps up with.
- **Full-body one-shots**: `play('jump')` (fades out at its end), `play('victory')` and `play('defeat')` (loop until `stop()`), and the strokes `smash`, `lungeL` / `lungeR`, `diveL` / `diveR`; locomotion (and the upper-body layer) fades out underneath.
- **Upper-body layer**: the `swing` and `serve` clips are sampled per bone and slerped over the base pose for the spine, chest, head and arms, so the legs keep moving. `setReady(k, clip)` holds a clip's first frame with weight k (`swing`: racket back; `serve`: trophy pose, ball tossed); `swing(seconds, clip, from)` plays one once. `raise(dy)` lifts (or drops) the racket arm about the shoulder for the swing under way, easing in to the contact frame, so the head meets a ball off the clip's own contact height.
- **Timed strokes**: `MabarChars.CONTACT` gives each hitting clip's contact moment (seconds in; `art/clips.py` CONTACT). `play(clip, { contact })` and `swing(seconds, clip, from, contact)` run the clip faster or slower (0.4–2.5×) until that frame, or start it part-way in, so the racket arrives exactly `contact` seconds from now, then play on at normal speed.
- **Where the racket is**: `toolHead()` is the shown tool's head (racket strings, paddle blade) in the world, from the prop's vertices in its hand bone's frame (props are skinned rigidly to one bone). `MabarChars.reachOf(id, clip, time, tool)` poses a hidden copy and returns that point at a clip's contact frame relative to the root (model units, facing +Z, x = the character's left); the racket engine places players from it.
- `look(yaw)` turns the head after animation; `setTool('racket' | 'paddle' | null)` shows one `prop_*` mesh; `attach(socket, object, { position, rotation, scale })` parents an accessory to a socket bone in the character's own axes; `wear(outfit)` applies an outfit from the definition (texture swap and/or accessories). `dispose()` stops the mixer and frees the cloned skeletons.

In the racket engine (`poseAnimal`): each player's spot is where their forehand's racket head meets the ball; the body stands off it by the measured offset (`reachOf`; the chibis, without clips, by `cfg.reach` on their racket side). Velocity comes from the body's movement. During serve and rally the stance is `ready`, otherwise `idle`. The character stays square to the net and side-steps; only for dashes faster than `strafeLimit()` does it turn into a run toward wherever it is going (sideways, or right around for a lob), turning back when the ball approaches (ready weight) or for a stroke. Under a ball coming down for an overhead it holds the serve's trophy pose. Strokes start when the sim says (`m.anim`), timed to the ball; lunges, dives and smashes are played square to the net, and a diver's body is lifted or lowered a little (`leapY`) to meet a ball above or below its racket. The head follows the ball. The server holds the first frame of `cfg.serveClip` (Tennis: the overhead `serve`; default `swing`) while the toss bobs over the strings; the swing drops it onto them and the serve leaves from there. Point winners play `jump` (not while down after a dive); at the end the winners play `victory`, the losers `defeat`.

## Racket engine (`js/games/racket.js`)

The ball flies in meters (x across, z along the court, h above the playing surface); the players' spots use normalized court coordinates (`nx` −1..1 along the court, contact line to contact line; `ny` −1..1 across), converted with `toX`, `toZ`.

- **Ball flight**: a shot is a chain of closed-form free flights (`fly(segment, t)`): gravity, linear air drag (`cfg.ball.drag`), and spin as extra vertical pull on the first flight (topspin dips, backspin floats). `strike()` solves the launch velocity that lands the ball at a spot (`depth` 0..1 of the opponent's half, scaled by `court.landMax`; past 1.02 = long, `|aimY| > 1` = wide) in a time set by the pace (`shotT`/`shotTP`: seconds line to line) or by how high it should go (lobs, pop-ups), lifting it until it clears the net tape by `clear` (late hits are aimed lower, into the net when very late). Bounces keep `ball.rest` of the vertical and `ball.keep` of the horizontal speed (more with topspin, less with backspin); a ball off a table's edge falls to the floor; `court.walls` (the stands' rails) stop it. `ballAt(t)` gives the position `t` seconds after the stroke.
- **Contact point** (`contactFor`): where the receiver meets it, at the heights their clips put the racket (`strikeH`, `overH`, from `reachOf`): overhead before the bounce for a lob they can get under; else after the bounce at forehand height on the way down; if that is past `deepest`, overhead while still that high or on the rise; the top of a low bounce. `ball.contact.t - ball.t` is the time to contact that the swing timing is judged on.
- **Strokes** (`planHit`): a swing in the timing window (−0.10..+0.30 s, plus `lagOf` for remote players) picks how the body gets the racket there: a forehand (`swing`) within `step` plus what a run covers by then, a `lunge` a step further, a `dive` that flies up to `cfg.dive` meters (Tennis only), a `smash` for an overhead contact. It meets the ball when the ball is at that stroke's racket height (`meetTime`, with a lifted arm or a diver's leap), no sooner than the stroke can get there (`LEAD`). `approach()` steers the body there for the contact moment, a dive takes off `CONTACT` seconds before and flies the rest; `finishHit()` strikes only if the body got there (else "So close!"), then a diver slides and stays down (`m.down`), a lunge pushes back. The 3D side plays the stroke timed to the ball (`m.anim`), and records how close the racket head came to the ball (`_debug().hits`).
- **Shots** (`returnShot`, from where the racket met the ball): timing offset → left/right (late also short and low, so very late hits net), power → pace and depth, the phone's `dx`/`dy` → sideways pull and a lob (`dy > 0.45`, high and slow) or a flat drive (`dy < −0.3`, faster and lower, less spin); an overhead is a smash (fast, steep, landing deep); a dive pops it back high, slow and short; the player's lateral run carries the ball along.
- **Players**: each member has a spot (`py` across, `px` deep, 1 = the contact line): where their forehand's racket head meets the ball. The receiver runs to the contact point (offset for an overhead), others to their lane (and the hitter shades toward the ball), the phone's tilt (stick `y`) moves the spot up to half a court toward the net. Speed is capped at the court's width per `cfg.crossTime`, so placement wins points.
- **AI**: `cpuPlan` picks a timing, power and direction per incoming ball and swings through `planHit` like a phone (in good time when it has to stretch); it misses by physics (too far) and now and then by chance (`cfg.cpuHard`).
- **Test hooks**: `_place(i, py, px)`, `_shot({ s, y, depth, kind, power })` (a shot as if side `s` struck it), `_slow(k)` (slow motion), `_flight()` (the current ball's segments).

## Asset loading

`Kit3D.load(url, onProgress)` loads a `.glb` once per page (promise cache keyed by URL, resolved against `document.baseURI`), sets the meshopt decoder, and enables cast/receive shadows on every mesh. Games then `getObjectByName(...)` and `clone(true)` the templates they need. All runtime URLs are hard-coded relative paths:

| Asset | Loaded by |
| --- | --- |
| `assets/menu.glb` | `games/menu.js` |
| `assets/landing_island.glb` | `landing.js` |
| `assets/characters.glb` | `games/racket.js`, `games/cooking.js` (chibi fallback) |
| `assets/bunny.glb`, `dog.glb`, `cat.glb`, `panda.glb`, `chimp.glb`, `lioness.glb` | `js/character.js` (Tennis, Table Tennis, Cooking, `tools/characters.html`) |
| `assets/island_court.glb` | `games/tennis.js` (via `cfg.env`) |
| `assets/tennis_court.glb` | `games/tennis.js` (via `cfg.envFallback`, only if the island fails) |
| `assets/tt_hall.glb` | `games/pingpong.js` (via `cfg.env`) |
| `assets/kitchen.glb` | `games/cooking.js` (station, food, dish and particle templates) |
| `assets/kitchen_paddy.glb`, `kitchen_beach.glb`, `kitchen_city.glb` | `games/cooking.js` (the chosen kitchen's diorama; a plain tiled floor if it fails) |
| `assets/img/*.jpg` | `index.html` (`hero`, `hero-phone`: the island still, shown without WebGL; game panels; `og`) |

How these files are produced: [ASSET_PIPELINE.md](ASSET_PIPELINE.md).

## Landing page (`js/landing.js`)

`index.html` is one full-screen stage, in the spirit of a 3D "explore the island" site: the CSS sky behind a transparent WebGL canvas, glass cards floating over it (headline + join form, a dock of chips, a hint, one panel per spot), nothing to scroll.

- **Spots** are declared in the HTML: each `.panel` names its 3D anchor (`data-anchor`, a `hot_*` node of `landing_island.glb`), title and colour. `landing.js` makes a pin and a dock chip for each; a pin, a chip, the header's *How it works* button and the Escape key all go through one `select(id)`. Panels work without the 3D (the dock still opens them).
- **Orbit camera** (own implementation; the vendor bundle has no OrbitControls): spherical coordinates around a target, eased toward goal values, which also gives the intro dolly (starts far out) and the flight to a pin. Drag turns (pointer events, capture, a flick adds inertia), wheel or pinch zooms within limits, the island turns slowly by itself after 3 s idle. On wide screens the centre of the view is pushed left so the island sits right of the headline card; on tall screens it is pushed down so the island rides above the cards (and above the bottom sheet when a panel is open). A selected spot is framed left of centre (above centre on phones).
- **Pins** are HTML buttons placed every frame by projecting their anchor's world position; every fourth frame a ray from the camera to the anchor against `land` and `rocks` dims pins that the island hides.
- **Motion**: the baked clip plays through an `AnimationMixer`; wind is procedural by node name (`tree_*` sway about their base, `bunt_*` flags through their morph target, `cloud_*` drift around the island) under a slow gust envelope. `prefers-reduced-motion` stops all of it and the auto-turn.
- Phones (coarse pointer, narrow) get a 1.5 pixel ratio, no shadows, the join form first; no WebGL or a failed load shows `assets/img/hero*.jpg` (stills of this very scene, captured in headless Chrome).

## Multiplayer

```
phone (controller.html) ──data channel──▶ host (play.html) ──video call──▶ watch.html
             ╲                               │                           ╱
              ╲── PeerJS broker (handshake only; ?peer=host:port to self-host)
```

- Topology is a star around the host; the host is authoritative for all game state. Phones only send input and receive hints/mode/rumble.
- ICE: `MABAR.peerOptionsAsync()` fetches short-lived TURN credentials from `MABAR.TURN_URL` (4 s timeout) and prepends Google STUN; on failure it falls back to PeerJS defaults. `?relay=1` forces relay-only.
- Motion controls: the phone detects swings locally (gyro > 220°/s or linear accel > 12 m/s², peak over 70 ms) and sends `{t:'swing', power, dx, dy}`: the direction comes from the rotation about gravity (left / right) and the acceleration along it (up / down) during the peak window; the phone's forward/back tilt goes out as the stick's `y`. Timing is judged on the host (README has the details). The controller asks iPhones for motion permission at the Join tap, checks `isSecureContext` and the Permissions API (`accelerometer` / `gyroscope`) to explain a silent sensor, accepts `accelerationIncludingGravity`-only phones, and shows a live sensor readout (`#mSense`); `window.__motion.state()` exposes it.

## Known constraints

- No unit tests or linting. `npm run smoke` (with `npm run dev` running) drives headless Chrome through the character viewer (clips, stance, serve, where each stroke's racket reaches, the dive, foot grip while walking, running and side-stepping), the racket games' waiting room (seats, force start), both racket games (every return struck at the racket head), swing direction, forced strokes (a lob smashed, a wide ball dived for, an early swing whiffing, lob vs drive flight, bounces), the asset fallbacks, the three kitchens (one recipe through chop, fry, plate and serve; rinse, boil, burn and scrape; expiring orders; the end of a shift) and every page; `--only <section>` runs one part. Everything else is verified by playing with the keyboard player.
- Motion sensors require HTTPS (production Pages or `npm run dev:https`).
- The host tab is the whole game server: closing it ends the room.

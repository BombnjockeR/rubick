# Architecture

Derived from the source as of commit `d0fdd1d`. Message formats, setup and the game-authoring snippet live in [README.md](../README.md); this file covers how the pieces fit together.

## Stack

| Concern | What | Where |
| --- | --- | --- |
| Pages | 4 static HTML files, classic `<script>` tags, no build | repo root |
| 3D | Three.js 0.186 (custom bundle incl. `GLTFLoader` + `MeshoptDecoder`), WebGL | `vendor/three.mabar.min.js`, `js/kit3d.js` |
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
| `index.html` | common → landing (lazy-loads three → kit3d → `assets/menu.glb` on desktop) | Landing page; join-by-code redirects to `controller.html?room=CODE` |
| `play.html` | peerjs, qrcode, three → common → kit3d → games/menu, racket, tennis, pingpong, cooking → **screen** | Host hub (must load last: it starts the menu and the room) |
| `controller.html` | peerjs → common → controller | Phone gamepad / motion paddle |
| `watch.html` | peerjs, qrcode → common → watch | Remote viewer: receives a video stream, shows a join QR |

Globals: `MABAR` (constants, button bits, PeerJS/TURN options, room codes) and `MabarGames` (registry) in `js/common.js`; `Kit3D` in `js/kit3d.js`; `MabarRacket` in `js/games/racket.js`; `window.__mabar` (debug handle) in `js/screen.js`.

## Host hub (`js/screen.js`)

- Creates the room: random 4-letter code → PeerJS id `MABAR.PREFIX + code`; rerolls on `unavailable-id`, reconnects to the broker on `disconnected` (connected phones keep playing).
- **Players**: each controller connection gets a slot (0–7, `MAX_PLAYERS = 8`), a color and a player object `{ id, slot, name, color, conn, sx, sy, b, rtt, remote, ... }` in `hub.players`. A keyboard player (`id 'kb'`) is added on first key press.
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
| `games/racket.js` | Shared engine: waiting room (60 s, 4 seats, vote to start), singles/doubles, AI seats, swing timing, scoring (`'tennis'` or `'points'`), chase cameras, split screen when both sides are human. Remote players get a wider timing window (`lagOf`). |
| `games/tennis.js`, `games/pingpong.js` | Pure config objects for `MabarRacket.define` (court dimensions, env `.glb`, character node, camera, physics tuning). |
| `games/cooking.js` | Co-op kitchen; layout is the text `MAP` at the top; stations are cloned from `kitchen.glb` templates by node name. |

## Rendering

- `Kit3D.renderer(hub)` inserts a full-screen WebGL canvas (`.gl-layer`) *behind* the 2D `#arena` HUD canvas; games dispose it in `stop()`. Settings: shadows on, `NeutralToneMapping`, exposure 1.05, sRGB output, pixel ratio ≤ 2.
- `Kit3D.lights()` gives the shared "toy diorama" lighting (hemisphere + shadowed key + rim).
- Characters are not skinned: they're hierarchies of named pivots (`<char>_head`, `_armL/R`, `_legL/R`, a tool socket on the right arm) that the game rotates procedurally each frame. Player colors are applied by cloning materials named `shirt`, `accent`, `hair`.

## Asset loading

`Kit3D.load(url, onProgress)` loads a `.glb` once per page (promise cache keyed by URL), sets the meshopt decoder, and enables cast/receive shadows on every mesh. Games then `getObjectByName(...)` and `clone(true)` the templates they need. All runtime URLs are hard-coded relative paths:

| Asset | Loaded by |
| --- | --- |
| `assets/menu.glb` | `games/menu.js`, `landing.js` |
| `assets/characters.glb` | `games/racket.js`, `games/cooking.js` |
| `assets/tennis_court.glb` | `games/tennis.js` (via `cfg.env`) |
| `assets/tt_hall.glb` | `games/pingpong.js` (via `cfg.env`) |
| `assets/kitchen.glb` | `games/cooking.js` |
| `assets/img/*.jpg` | `index.html` (`hero`, `hero-phone`, game cards, `og`) |

How these files are produced: [ASSET_PIPELINE.md](ASSET_PIPELINE.md).

## Multiplayer

```
phone (controller.html) ──data channel──▶ host (play.html) ──video call──▶ watch.html
             ╲                               │                           ╱
              ╲── PeerJS broker (handshake only; ?peer=host:port to self-host)
```

- Topology is a star around the host; the host is authoritative for all game state. Phones only send input and receive hints/mode/rumble.
- ICE: `MABAR.peerOptionsAsync()` fetches short-lived TURN credentials from `MABAR.TURN_URL` (4 s timeout) and prepends Google STUN; on failure it falls back to PeerJS defaults. `?relay=1` forces relay-only.
- Motion controls: the phone detects swings locally (gyro > 260°/s or linear accel > 14 m/s², peak over 70 ms) and sends `{t:'swing', power}`; timing is judged on the host.

## Known constraints

- No automated tests or linting; behaviour is verified by loading pages and playing with the keyboard player.
- Motion sensors require HTTPS (production Pages or `npm run dev:https`).
- The host tab is the whole game server: closing it ends the room.

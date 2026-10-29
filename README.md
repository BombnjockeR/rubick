# Mabar

Party games on the big screen, where every phone is a controller. *Mabar* is short for *main bareng*: playing together.

Open Mabar on a laptop (or a laptop plugged into the TV), pick a game, and friends scan the QR code in its lobby. No app, no account.

## Pages

| Page | Who opens it | What it does |
| --- | --- | --- |
| `index.html` | Anyone | Landing page: the island in 3D (drag to turn it, tap a pin for each game and feature). **Host a game** goes to `play.html`; phones get a room-code box instead. |
| `play.html` | The host (laptop/TV) | Opens a room, shows the 3D main menu, runs the games. |
| `controller.html` | Each player's phone | Gamepad or motion "paddle", depending on the game. |
| `watch.html` | A friend far away (laptop/iPad) | Live video of the host's screen plus a QR for their phone. |

## Games

The host screen opens on a **3D main menu** (a toy-diorama island built in Blender, with characters playing each game on a loop). Pick with the arrow keys and Enter or a click; once phones have joined they can choose too (stick + **A**). Each game opens with a **waiting room** that shows the QR code and room code; friends join there. The phone's ⌂ button or `Esc` on the laptop goes back to the menu, and everyone stays connected.

In the Tennis and Table Tennis waiting rooms each empty seat has a **×** (close it) or **+** (reopen it) button, also keys `1`–`4` on the host laptop, so any lineup works: 1v1, 2v2, 1v2… AI plays the open seats. **Start now** (or `F`) starts at once; with nobody joined it becomes **Watch AI play**, an AI-only match that repeats until someone joins (`F` goes back to the waiting room). Handy for checking the characters and animations without phones.

The Cooking waiting room works the same way for a kitchen crew: the host picks a room of **2 or 4 chefs** (`R`) and **Easy or Hard** AI teammates (`L`); phones take seats as they join and every other open seat gets an **AI chef** (× / + or `1`–`4` close and reopen seats). The card shows the lineup, e.g. `Players: 2/4 | Human: 1 | AI: 1 | Free: 2 | Difficulty: Easy`. A phone that joins takes over an AI chef; one that leaves mid-shift is taken over by one. **Start now** (`F`) goes to the kitchen pick at once, or with nobody joined becomes **Watch AI cook**: AI-only shifts, one kitchen after another.

| Game | How to play |
| --- | --- |
| **Tennis** | Full-size court on a tropical island, motion controls. Each phone plays as its own animal (bunny, pup, cat, panda, chimp or lioness, by seat; AI takes the rest). Your character gets to the ball by itself (side steps for short moves, a run for long ones, forward for short balls and back for lobs) but no faster than about 1.7 s from sideline to sideline, so a ball placed away from a player who is late getting back is a winner. You time the swing: *when* aims it (early = your left, late = your right and short, very late = into the net, way off = out), *how hard* sets the speed and depth, the direction you swing the phone pulls the ball that way and lifts it into a high lob or flattens it into a fast low drive, and running into the ball carries it along. The racket only hits the ball when the ball gets to it: a swing in time is held until then, one far too early misses. A ball a step too far is taken with a lunge, one further out with a full-length dive that only pops it back up (and leaves you on the ground for a moment); a ball above your head is smashed. The ball flies under real gravity, drag and spin and bounces accordingly: lobs climb high and slow and bounce high, drives skim the net, smashes go steeply down. Tilt the phone forward or back to play closer to the net or deeper. Servers toss the ball and serve overhead. Winning a point earns a hop; at the end the winners dance and the losers hang their heads. Real scoring (15–30–40, deuce, advantage), first to 2 games. |
| **Table Tennis** | Sports hall, motion controls, first to 5. The same animals, holding paddles, with the same swing rules at table speed (about 0.9 s from one side of the table to the other; balls past the end are long, low ones hit the net; lunges but no diving at the table). By default 1–2 players play singles and 3–4 doubles (the seat buttons change that); AI fills open seats and takes over if someone leaves. With humans on both sides the screen splits in two. |
| **Cooking** | Overcooked-style co-op for 1–4 chefs on the phone gamepad, in one of three Indonesian kitchens. Once everyone in the waiting room has voted, the three kitchens appear as miniature 3D dioramas on floating cards, menu-style: left / right moves the highlight, **A** (or the phone's button) picks it, and the highlighted one is taken after 30 s (Paddy Field: gado-gado, nasi liwet, tahu goreng; Beach: ikan bakar, cumi goreng, udang saus padang; Pontianak City: bakmi kepiting, selade, es jeruk nipis). Take ingredients from the crates, chop them at a board or rinse rice at the sink (hold **X**), boil in a pot (up to three things together) or fry, put the parts on a plate from the dish stack and serve it at the hatch while the order's patience lasts. Ready food waits a while, smokes, then burns: hold **X** to scrape the pot. **A** grabs, drops and uses, **B** dashes; every counter holds one item, so pass things across them. Spicy variants add a chili. 4-minute shift, tips for speed and combos, 1–3 stars. AI chefs fill the empty seats of a room of 2 or 4 and cook by the same rules (Easy: slower, first come first served, the odd poor choice; Hard: quick, ranks orders by urgency, splits the work, rescues pots); the order pace and the stars count an AI chef as half a chef (Easy) or 0.85 (Hard). |

Stars on the menu cards are placeholders for a future popularity vote.

No phone handy? On the host laptop `WASD` moves, `Space` is A, `E` is B, `X` is X (chop, rinse, scrape in Cooking; `←` `→` and `Enter` pick the kitchen on its cards), `H` shows the side panel. In the racket games `Space` swings and `E` swings hard, with `A`/`D` held for left/right and `W`/`S` for a lob or a flat drive (they also move you toward the net or back); in the waiting room `F` starts (or watches the AI play) and `1`–`4` close or reopen seats. In the Cooking room `F`, `1`–`4`, `R` (room of 2 or 4) and `L` (Easy / Hard AI) do the same for the kitchen crew.

The phone pad works held sideways or upright (stick bottom-left, A/B/X/Y bottom-right when upright). The stick floats: it centres where the thumb lands, follows the thumb past its rim (so turning round is instant) and lets go the moment the thumb lifts, the touch is cancelled, the browser loses focus or the phone turns. If the link drops, the phone lets go of everything, says *Reconnecting…* and rejoins by itself (for ~25 s), back in its own seat.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:8080 (landing) and /play.html (host)
```

Phones can't open `localhost` on your laptop. To test with real phones on the same Wi-Fi, open the host page using the network address that `npm run dev` prints (e.g. `http://192.168.1.20:8080/play.html`), so the QR code points somewhere phones can reach.

**Motion games on phones need HTTPS** (browsers only expose the gyroscope on secure pages). Either test motion on the deployed site, or run a local HTTPS server:

```bash
brew install mkcert && mkcert -install   # once
npm run cert                             # makes .cert/ for localhost + your network address
npm run dev:https                        # https://<your-ip>:8443/play.html
```

Phones will warn about the certificate unless you install mkcert's root certificate on them; the gamepad games work fine over plain HTTP.

VS Code: **Terminal → Run Task → Mabar: dev server**, or use the launch configs to open Chrome with the debugger attached.

### Rebuilding the 3D art

All models are generated by Blender scripts in `art/` (no hand-made `.blend` files). The animals, the tennis island, the three kitchens and the landing page's island are built from the source FBX models in `art/source/` (kept on the owner's machine only); the rest is procedural.

```bash
npm run assets:animals     # the six animals (bunny, dog, cat, panda, chimp, lioness) and island_court.glb: rig, animate, compress
npm run assets:island      # island_court.glb: the tennis island with its stands, crowd and sea
npm run assets:kitchens    # kitchen.glb (stations, food, dishes) and the three kitchen_*.glb dioramas
npm run assets:landing     # landing_island.glb: the landing page's island, cleaned up and animated
npm run assets             # every asset
```

The scripts run in Blender headless: the macOS app by default, `BLENDER=/path/to/blender` for another install, or `BPY=python3.13` with `pip install bpy`. See [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md), including how to add or replace a character.

### Checking it in a browser

```bash
npm run dev                # in one terminal
npm run smoke              # in another: headless Chrome tests the characters (clips, poses, foot sliding), the waiting room, both racket games (strokes meet the ball at the racket, smash, dive, ball flight), the three kitchens, the AI chefs, the phone controller (layouts, touch, a real phone-to-screen session), fallbacks and every page (--only cooking, --only ai, --only controller for one section)
```

`tools/characters.html` (e.g. `http://localhost:8080/tools/characters.html`) previews each character: every clip (the strokes too: smash, lunges, dives), relaxed or ready stance, forward and sideways speed (tick *Move the character* and watch the floor grid to judge foot sliding), the held serve and racket-back poses, tools, transforms and a test accessory.

## How it connects

```
phone (controller.html) ──WebRTC data channel──▶ laptop (play.html)
            ╲                                       ╱
             ╲──── PeerJS lobby server (handshake) ╱
```

- Everything is static files, so it runs on GitHub Pages with no backend of our own.
- Every host gets its own random 4-letter room (`ABCD` is the PeerJS id `mabar-v1-ABCD`), so groups never collide.
- The free public [PeerJS](https://peerjs.com) server only introduces devices. After that, input goes straight from phone to laptop over WebRTC.
- Up to 8 controllers per room (4 seats per game; the rest watch). Phones vibrate on hits (Android only).

### Relays for players on other networks

On the same Wi-Fi, phone and laptop connect directly. Across the internet, many networks (mobile carriers with CGNAT especially) block direct links, so the connection needs a **TURN relay**. `TURN_URL` in `js/common.js` points at a Metered credentials endpoint; every page fetches short-lived relay credentials before connecting. If it's empty or unreachable, PeerJS's built-in servers are used. Add `&relay=1` to a controller or watch URL to force the relay for testing. The Metered free plan includes 20 GB/month; a relayed remote-screen video uses about 1 GB per hour per viewer.

### Friends who aren't in the room

They open `watch.html` on their own screen and enter your room code; your laptop streams the game to them (720p, ~2.5 Mbps each, peer-to-peer). Their screen shows a QR for their phone. Phones that join from a watch page are marked **remote**, and the racket games widen their timing window by the video delay (~0.18 s plus half their ping).

### Self-hosting the lobby

Add `?peer=host:port` to the host URL to use your own [PeerJS server](https://github.com/peers/peerjs-server). The QR code passes it along to phones automatically.

## Project layout

| Path | What |
| --- | --- |
| `index.html`, `js/landing.js`, `css/landing.css`, `assets/img/` | Landing page: the island in 3D with pins and floating panels (a still image without WebGL) |
| `play.html`, `js/screen.js`, `css/screen.css` | Host hub: room, players, game switching, remote-screen streaming, `hub.drawJoin()` QR painter |
| `js/games/menu.js` | 3D main menu |
| `js/games/racket.js` | Shared engine for Tennis and Table Tennis (room, AI, ball flight, player movement, swing timing and direction, scoring, chase cameras); `tennis.js` / `pingpong.js` are configs |
| `js/games/cooking.js`, `js/games/kitchens.js`, `js/games/chefai.js` | Cooking (rules, stations, orders, seats, HUD), its three kitchens (tile maps, recipes, how each diorama is placed) and the AI chefs |
| `js/kit3d.js` | Three.js renderer, lighting, cached meshopt `.glb` loader, `liven()` (environment animation by node name: trees, flags, crowd, clouds, water) |
| `js/character.js` | Animated characters (`MabarChars`): loading, cloning, stance and walk / run / side-step blending, swing and serve layer, tools, accessory sockets |
| `js/common.js` | Shared constants, button bitmask, PeerJS + TURN options, game registry (`MabarGames`) |
| `controller.html`, `js/controller.js`, `css/controller.css` | Phone controller (gamepad + motion) |
| `watch.html`, `js/watch.js`, `css/watch.css` | Remote screen |
| `art/*.py`, `art/build.sh`, `assets/*.glb` | Blender scripts and the models they export (`rig.py`, `landmarks.py`, `clips.py`, `animals.py`: the rigged animals; `island.py`: the tennis island; `kitchen.py`, `kitchens.py`: the cooking templates and dioramas; `landing_island.py`: the landing page's island) |
| `tools/` | Dev only: character viewer (`characters.html`), browser smoke test (`smoke.mjs`, `cdp.mjs`) |
| `art/source/`, `art/reference/` | Original FBX models and concept art (gitignored, local only; read by the build, never by the game) |
| `docs/`, `knowledge/`, `CLAUDE.md` | Architecture, asset pipeline, design notes, dev log, verified technical notes |
| `vendor/` | PeerJS 1.5.5, qrcode-generator 2.0.4, a Three.js 0.186 bundle with GLTFLoader + MeshoptDecoder (all MIT) |

## Writing a game

Register it in `js/games/yourgame.js` and add a `<script>` tag to `play.html`:

```js
MabarGames.register({
  id: 'yourgame', name: 'Your Game', controls: 'pad', // or 'motion'
  create(hub) {
    return {
      start() {}, stop() {}, join(p) {}, leave(p) {},
      press(p, bits) {},          // newly pressed buttons (hub.B.A, hub.B.X, ...)
      swing(p, power) {},         // motion games
      action(p) {},               // the phone's big button (e.g. "Vote to start")
      actionLabel(p) { return ''; },
      hint(p) { return ''; },     // one line shown on the phone
      update(dt) {}, draw(ctx, timeMs) {}, resize() {},
    };
  },
});
```

`hub.players` holds connected phones (`p.sx`, `p.sy` stick, `p.b` buttons, `p.color`, `p.name`); `hub.dir(p)` gives stick-or-d-pad direction; `hub.rumble(p, ms)` vibrates; `hub.drawJoin(ctx, x, y, size)` paints the join QR.

## Message format

Phone → host: `{t:'in', x, y, b, s}` (stick −1..1, button bitmask; in motion mode `y` is the phone's forward/back tilt; `s` numbers the messages so a late one is dropped, optional), `{t:'swing', power, dx, dy}` (`dx`/`dy` −1..1: which way the phone moved, optional), `{t:'action'}`, `{t:'menu'}`, `{t:'ping', ts}`, `{t:'rtt', ms}`
Host → phone: `{t:'welcome', slot, color, name}`, `{t:'mode', mode}` (`'pad'` | `'motion'`), `{t:'hint', text}`, `{t:'action', label}`, `{t:'rumble', ms}`, `{t:'pong', ts}`, `{t:'full'}`

Buttons: A, B, X, Y, LB, RB, View, Menu, Up, Down, Left, Right = bits 0–11.

The phone connects with metadata `{ name, remote, cid }`: `cid` is a random id kept for the tab (sessionStorage), so a phone that reconnects gets its own player back (same slot, colour, seat) instead of a second one; a phone that sends nothing for 1.5 s has its stick and buttons released, and buttons still held when it is heard again don't count as a new press. `s` and `cid` are optional, so older controllers still join (the prefix stays `mabar-v1-`).

### Motion controls

In motion mode the phone reads the gyroscope and linear acceleration. A swing starts when rotation passes 220°/s or acceleration passes 12 m/s²; the phone takes the peak over the next 70 ms and sends `{t:'swing', power, dx, dy}`: `dx` is how far the phone turned about the vertical during the swing (negative = toward your left, which is where the ball goes), `dy` how much it moved up or down (up = lob, down = a flat drive; a smash is any swing at a ball above your head). Up is read from gravity while the phone is still, so the grip doesn't matter. Tilting the phone forward or back from how it was held is sent as the stick's `y` and moves the player closer to the net or deeper. Timing is judged on the host. iPhones ask for motion permission at the Join tap (and again from an *Enable motion* button if that was skipped or refused); it needs HTTPS. Phones without a gyroscope still swing (straight ahead, from the accelerometer); phones without sensors get a tap-to-swing area (tap its left, middle or right to aim). The motion screen says why nothing arrives (plain `http://`, motion blocked for the site, a browser without sensor events) and shows a live readout: which sensors it has, the event rate, the recent peaks next to the swing thresholds, and what it read from your last swing, so a real device can be checked at a glance.

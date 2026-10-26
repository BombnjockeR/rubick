# Rubick

Turn your phone into a game controller. The laptop shows the game, phones join with a 4-letter room code (or by scanning a QR code) and get an Xbox-style pad.

## Play

1. Open the site on the laptop (`index.html`). It shows a room code and a QR code.
2. On your phone, scan the QR code or open `controller.html` and type the code.
3. Turn the phone sideways and play. Friends scan the same QR code to join (up to 8).

Pick the game in the panel on the laptop. Switching games keeps everyone connected.

| Game | How to play |
| --- | --- |
| **Snake** | Everyone presses **A** to ready up. Steer with stick or d-pad, eat white apples to grow. Hit a wall or any snake and you're out; your body turns into pellets. Last snake standing wins. |
| **Table Tennis** | 3D, motion controls. Scan in to a **waiting room** (60s, 4 seats); tap **Vote to start** on your phone or let the timer run out. 1–2 players play singles, 3–4 play doubles (each covers half the table); **AI fills empty seats** and takes over if someone leaves. Hold your phone like a paddle and swing: *when* you swing aims (early = your left, late = your right, way off = out), *how hard* sets speed. The camera sits behind your end and follows the ball; with humans on both sides the screen splits in two. First to 5. |
| **Arena** | Free roam. Grab coins, **A** dashes (and knocks friends back), **B** honks. |

No phone? On the laptop, `WASD` moves, `Space` is A, `E` is B, `H` hides the panel.

## How it connects

```
phone (controller.html) ──WebRTC data channel──▶ laptop (index.html)
            ╲                                       ╱
             ╲──── PeerJS lobby server (handshake) ╱
```

- Everything is static files, so it runs on GitHub Pages with no backend of our own.
- The free public [PeerJS](https://peerjs.com) server only introduces the two devices. After that, input goes straight from phone to laptop over WebRTC, usually a few milliseconds on the same Wi-Fi.
- Room code `ABCD` is the laptop's PeerJS id `rubick-v1-ABCD`.
- Up to 8 controllers per room. Phones get a short vibration on dash, coin pickup and bumps (Android only; iOS Safari doesn't support vibration).

### Self-hosting the lobby

Add `?peer=host:port` to the screen URL to use your own [PeerJS server](https://github.com/peers/peerjs-server) instead of the public one. The QR code passes it along to phones automatically.

## Files

| Path | What |
| --- | --- |
| `index.html`, `js/screen.js`, `css/screen.css` | Laptop hub: room, QR, roster, game switching |
| `js/games/*.js` | One file per game (see the interface in `js/common.js`) |
| `controller.html`, `js/controller.js`, `css/controller.css` | Phone gamepad |
| `js/common.js` | Shared constants, button bitmask, PeerJS options |
| `vendor/` | PeerJS 1.5.5, qrcode-generator 2.0.4, and a trimmed Three.js 0.186 build (all MIT). Three.js loads only when a 3D game starts. |

## Message format

Phone → screen: `{t:'in', x, y, b}` (stick −1..1, button bitmask), `{t:'swing', power}` (motion, 0..1), `{t:'ping', ts}`, `{t:'rtt', ms}`
Screen → phone: `{t:'welcome', slot, color, name}`, `{t:'mode', mode}` (`'pad'` or `'motion'`), `{t:'pong', ts}`, `{t:'rumble', ms}`, `{t:'hint', text}`, `{t:'action', label}` (shows a button, e.g. "Vote to start"; empty hides it), `{t:'full'}`

Phone → screen also: `{t:'action'}` when that button is tapped.

### Motion controls

Each game declares `controls: 'pad' | 'motion'`; the phone switches screens automatically. In motion mode the phone reads the gyroscope (`devicemotion` rotation rate) and linear acceleration. A swing starts when rotation passes 260°/s or acceleration passes 14 m/s²; the phone takes the peak over the next 70 ms and sends `{t:'swing', power}`. Timing is judged on the laptop. iPhones ask for motion permission once (the "Enable motion" button), which needs HTTPS — GitHub Pages provides it. Phones without sensors get a tap-to-swing area.

Buttons: A, B, X, Y, LB, RB, View, Menu, Up, Down, Left, Right = bits 0–11.

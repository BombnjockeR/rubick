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
| `vendor/` | PeerJS 1.5.5 and qrcode-generator 2.0.4 (MIT) |

## Message format

Phone → screen: `{t:'in', x, y, b}` (stick −1..1, button bitmask), `{t:'ping', ts}`, `{t:'rtt', ms}`
Screen → phone: `{t:'welcome', slot, color, name}`, `{t:'pong', ts}`, `{t:'rumble', ms}`, `{t:'hint', text}`, `{t:'full'}`

Buttons: A, B, X, Y, LB, RB, View, Menu, Up, Down, Left, Right = bits 0–11.

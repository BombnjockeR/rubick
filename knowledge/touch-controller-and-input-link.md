# Touch stick, input link and testing them in headless Chrome

Verified 2026-10-29 in headless Chrome (CDP touch emulation, mobile viewports) against `controller.html` before and after the controller rework, and with a real phone-to-screen session over the public PeerJS broker. Nothing here was checked on a real phone.

## What made the old stick feel wrong (measured, `git show e1be74c:js/controller.js`)

Same touch sequence on the old and new controller (landscape 844×390, stick zone at the left):

| Touch | Old `{x, y}` | New |
| --- | --- | --- |
| down 10 px inside the zone's left edge | **−0.75**, 0 (moving left at once) | 0, 0 |
| then 40 px to the right | **0**, 0 (stopped) | 0.72, 0 |
| 300 px right (outside the zone) | 1, 0 | 1, 0 |
| back left by 2 × radius + 6 px | **1**, 0 (still right) | −1, 0 |
| then 60 px up | 0.92, **−0.38** | −0.66, −0.75 |

Causes: the floating base was clamped inside the zone while the centre stayed off the thumb, so a touch near an edge started at up to ~97 % deflection; and a thumb dragged past the rim had to come all the way back to reverse, with directions skewed by the overshoot. Fix: centre on the touch point, and drag the centre along when the thumb passes the rim.

Also missing before: any reset on `blur` / `pagehide`, a fallback when a release lands outside the element (now: window-level `pointerup` / `pointercancel` and "no finger left on the screen" on `touchend`), and a second finger taking over the stick.

## PeerJS 1.5.5 data channels

`reliable` only becomes `createDataChannel(label, { ordered: !!reliable })` (read in `vendor/peerjs.min.js`); there is no `maxRetransmits`, so `reliable: false` is unordered but still fully reliable. An unreliable input channel would need a different library build or raw `RTCPeerConnection`. Mabar keeps one reliable ordered channel and numbers input messages (`s`).

## Testing touch and two pages with CDP

- `Input.dispatchTouchEvent`: `touchStart` / `touchMove` take every finger still down; **`touchEnd` / `touchCancel` release the fingers listed** (an empty list releases all). Chrome maps them to pointer events with `pointerType: 'touch'` and implicit capture.
- Read the page state a frame later (~40 ms): moves dispatched right before a `Runtime.evaluate` may not have been handled yet.
- A page in a background tab has no `requestAnimationFrame` (the hub's game loop and its 1.5 s silence check stop), and touch dispatched to a background tab can hang. Open the second page in its own window: `Target.createTarget({ url, newWindow: true })` (`b.page(url, { window: true })` in `tools/cdp.mjs`), and launch with `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`.
- Replacing `RTCDataChannel.prototype.send` in the page did **not** stop PeerJS's sends (the patched function was never called; cause not established). To simulate a stalled link the controller has a test hook, `__pad.mute(ms)`.
- `navigator.vibrate` before a user gesture logs a console error in Chrome ("Blocked call to navigator.vibrate"); harmless, filtered in the smoke test.

Measured input latency phone → screen, both tabs on one machine: 0–10 ms for a stick change, 4–23 ms per direction flip.

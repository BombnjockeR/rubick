# Phone motion sensors for swing direction and tilt

**Proposed, not verified on devices** (2026-10-28). What `js/controller.js` assumes; check it on a real phone with the controller's "Last swing" readout and fix this note.

- `devicemotion` gives `rotationRate` (deg/s about the phone's x, y, z; right-hand rule per the W3C spec), `acceleration` (m/s², gravity removed) and `accelerationIncludingGravity`. Phone axes: x to the right of the screen, y up the screen, z out of the screen.
- **Up in phone axes** = the low-passed `accelerationIncludingGravity` while the phone is still (filtered with a 0.5 s time constant only while rotation < 100°/s and acceleration < 6 m/s²). By the spec a phone held upright reads about +9.8 on y; older iOS Safari is reported to give the values with the opposite sign (−9.8). The controller treats the sign of the filtered y (or z when the phone lies flat) as the convention and applies it to `acceleration` too. `rotationRate` is assumed to follow the spec on both platforms.
- **Swing direction**: over the 70 ms peak window, ∫ (rotationRate · up) dt in degrees → `dx = −clamp(yaw / 40°)` (a forehand sweeps counter-clockwise seen from above, so dx < 0 means the ball goes to the player's left); ∫ (acceleration · up) dt in m/s → `dy = clamp(v / 1 m/s)` (up = lob, down = smash). Both are rough: the window is short and the acceleration includes the arm's swing arc.
- **Tilt**: pitch = atan2(up.z, up.y) in degrees; the baseline is the pitch while quiet, adapting with a 20 s time constant; beyond an 8° dead zone, up to 30°, it goes out as the stick's `y` (−1 = tipped forward = toward the net).
- Permission: iOS needs `DeviceMotionEvent.requestPermission()` from a tap and HTTPS (unchanged).

# Skinned characters in three.js r186 (vendor bundle)

Verified 2026-10-27 in headless Chrome (ANGLE Metal, Apple M5) while building `js/character.js`.

- The vendor bundle includes `SkinnedMesh`, `Skeleton`, `AnimationMixer`, `AnimationUtils` and `LoopOnce`, but not `SkeletonUtils`. `Object3D.clone(true)` copies bones but leaves cloned skinned meshes bound to the original skeleton; rebind each clone to a new `Skeleton` built from the cloned bones (`cloneSkinned` in `js/character.js`).
- Skinned meshes keep their bind-pose bounds, so animated poses (a jump) can be frustum-culled at screen edges; the characters set `frustumCulled = false`.
- `AnimationMixer` blends actions by weight; when the weights of the actions touching a property sum to less than 1, the remainder comes from the bind pose. The character system normalizes locomotion weights and fades overlays explicitly.
- A layered (masked) clip without a second mixer: `track.createInterpolant().evaluate(t)` gives a bone's quaternion at time t; slerp the bone toward it after `mixer.update()`. Used for the upper-body swing and serve.
- Walk and run with matching phase conventions can be blended without foot scramble by setting the weaker clip's `time` from the stronger one's normalized phase each frame.
- **But a steady blend of walk and run still slides** when they plant their feet for different shares of the stride (here 60 % vs 38 %): at speeds between them the planted foot slid 30–40 % of the distance travelled (ankle-bone measurement), although each clip alone held it to 1–3 %. Switching walk ↔ run with hysteresis and letting the weight smoothing cross-fade (~0.2 s) fixed it. Measured 2026-10-27 in the character viewer (below).
- **Measuring foot sliding in the browser**: track skinned vertices, not bones. The ankle bone of a planted foot wobbles as the leg tilts (it reported 16–25 % slide for a side step whose sole, measured in Blender, moved at exactly the body's speed); the lowest centimetre of shoe vertices reported 7–14 %. `SkinnedMesh.getVertexPosition(i, v)` works on the meshopt files, but their position attributes are quantized, so pick the sole vertices by their skinned world height (after `root.updateMatrixWorld(true)`), not by the raw attribute values.
- `THREE.Clock` logs a deprecation warning in r186; use `performance.now()` or `THREE.Timer`.
- `Kit3D.load` previously resolved URLs against `window.location.href`, which ignores a `<base>` element; it now uses `document.baseURI` (identical for the game pages).
- Headless Chrome (`--headless=new`) on Apple silicon gets hardware WebGL2 ("ANGLE Metal Renderer: Apple M5"), so screenshots of WebGL pages are real renders. Returning a live three.js object from `Runtime.evaluate` with `returnByValue` fails; coerce to a boolean.

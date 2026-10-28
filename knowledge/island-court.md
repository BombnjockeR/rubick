# Island court measurements (`art/island.py`)

Measured 2026-10-27 on `art/source/environments/tennis/island_tennis_court_3d_model.fbx` (source units, Blender Z-up after import).

Method: flat-shaded top-down orthographic render at 4096², colour masks for the court green (plus its white lines) and the terracotta surround, then the minimum-area rotated rectangle of each mask (0.05° steps). Court height: ray casts on a 1 m grid after scaling.

| Measure | Value |
| --- | --- |
| Court centre | x 0.0364, y −0.0856 |
| Court rotation | −8.9° (across-axis from +X) |
| Court size | 0.203 across × 0.264 baseline to baseline (1.30:1; a real court is 2.17:1) |
| Surround (red) | 0.311 × 0.368, rotated −11.05° |
| Court surface | z ≈ 0.060; after scaling ×89.9 it is 5.40 m up with bumps to 5.92 m |
| Original net | a tall panel ~1.2 m off the court's centre line, box posts outside the court |
| Hole | at one court corner, reaching past the surround |

Scaling the court length to 23.77 m gives ×89.9 (island ≈ 90 m across). Because the court's proportions can't match a real one, the build covers it with a regulation court on a plinth; the measured numbers only position and scale the island around it. The red surround is then 28 × 33 m around an 11 × 24 m court; since 2026-10-28 the generated grandstands stand on it 3.8 m outside the doubles lines and 5.1 m behind the baselines, which fills the width and keeps the end stands below the chase cameras (at |z| ≈ 21–23 m, 6.3 m up).

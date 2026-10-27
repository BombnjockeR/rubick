"""Kitchen assets for the Cooking game (meters; 1 tile = 1 m; counters 0.55 m tall).

    python art/kitchen.py assets/kitchen.glb

Every template sits at the origin with its base on the floor; the game places
copies on the layout grid (js/games/cooking.js). Names:
  k_room                       floor + walls around a 12 x 8 tile kitchen
  k_counter k_board k_stove k_plates k_serve k_bin
  k_crate_tomato k_crate_lettuce k_crate_onion
  k_pot (soup disk material 'soup' is tinted by the game)
  i_tomato i_tomato_cut i_lettuce i_lettuce_cut i_onion i_onion_cut i_plate i_soup
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from rlib import Geo, mat, glow, reset, empty, bush, crate  # noqa: E402

OUT = [a for a in sys.argv[1:] if not a.startswith('-')]
OUT = OUT[0] if OUT else 'kitchen.glb'
PI = math.pi
reset()
rng = random.Random(9)

H = 0.55            # counter height
TOP = '#f6f1e8'     # counter top
WOOD = '#d9965a'
WOOD_D = '#b0713c'
STEEL = mat('#cfd6df', rough=0.3, metal=0.5)
COLS, ROWS = 12, 8

templates = []


def T(name):
    o = empty(name, loc=(0, 0, 0))
    templates.append(o)
    return o


def counter_body(g, top=TOP, body=WOOD):
    g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), mat(body), bevel=0.03)
    g.box((0.96, 0.02, 0.18), (0, -0.49, H * 0.55), mat(WOOD_D), bevel=0.01)       # drawer front
    g.sphere(0.025, (0, -0.505, H * 0.55), mat('#3a3f4a'), seg=8)
    g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat(top), bevel=0.02)


# ---------------------------------------------------------------- items
def tomato(g, z=0.0, s=1.0, cut=False):
    if cut:
        for i in range(3):
            g.cyl(0.07 * s, 0.025, (-0.06 + i * 0.06, 0, z + 0.015 + i * 0.004), mat('#ff3b30', rough=0.35), seg=14,
                  rot=(0, 0.35, 0))
            g.cyl(0.05 * s, 0.027, (-0.06 + i * 0.06, 0, z + 0.016 + i * 0.004), mat('#ff8a80', rough=0.4), seg=12,
                  rot=(0, 0.35, 0))
    else:
        g.sphere(0.1 * s, (0, 0, z + 0.09 * s), mat('#ff3b30', rough=0.3), scale=(1, 1, 0.85), seg=16)
        for a in range(5):
            g.sphere(0.03 * s, (math.cos(a * 1.26) * 0.03 * s, math.sin(a * 1.26) * 0.03 * s, z + 0.17 * s),
                     mat('#2ecc71'), scale=(1.6, 0.6, 0.4), seg=8, rot=(0, 0, a * 1.26))


def lettuce(g, z=0.0, s=1.0, cut=False):
    if cut:
        for i in range(6):
            a = i / 6 * math.tau
            g.sphere(0.05 * s, (math.cos(a) * 0.05, math.sin(a) * 0.05, z + 0.03), mat('#7bed9f' if i % 2 else '#55d17a'),
                     scale=(1.3, 1, 0.45), seg=10, rot=(0, 0, a))
    else:
        for i, r in enumerate((0.12, 0.1, 0.08)):
            g.sphere(r * s, (0, 0, z + (0.08 + i * 0.03) * s), mat(['#55d17a', '#7bed9f', '#a8f0b8'][i]), scale=(1, 1, 0.8),
                     seg=16)


def onion(g, z=0.0, s=1.0, cut=False):
    if cut:
        for i in range(4):
            g.cyl(0.06 * s - i * 0.01, 0.025, (0, 0, z + 0.013), mat('#f5e6c8' if i % 2 else '#e8c48a'), seg=14)
    else:
        g.sphere(0.1 * s, (0, 0, z + 0.09 * s), mat('#e8a94a', rough=0.35), scale=(1, 1, 0.9), seg=16)
        g.cone(0.03 * s, 0.07 * s, (0, 0, z + 0.2 * s), mat('#c98a3a'), seg=8)


def plate(g, z=0.0):
    g.cyl(0.19, 0.025, (0, 0, z + 0.013), mat('#ffffff', rough=0.3), seg=24, bevel=0.008)
    g.cyl(0.13, 0.027, (0, 0, z + 0.016), mat('#eef2f6', rough=0.3), seg=24)


# ---------------------------------------------------------------- stations
o = T('k_counter')
g = Geo(); counter_body(g); g.build('k_counter_m', o)

for kind, fn, col in (('tomato', tomato, '#ff3b30'), ('lettuce', lettuce, '#2ecc71'), ('onion', onion, '#e8a94a')):
    o = T(f'k_crate_{kind}')
    g = Geo()
    counter_body(g)
    g.box((0.82, 0.82, 0.22), (0, 0, H + 0.11), mat('#d39a5c'), bevel=0.02)
    g.box((0.7, 0.7, 0.1), (0, 0, H + 0.17), mat('#8a5a34'), bevel=0.01)
    for (dx, dy) in ((-0.18, -0.16), (0.18, -0.14), (-0.15, 0.18), (0.17, 0.17)):
        sub = Geo()
        fn(sub, z=0, s=0.9)
        sub.build(f'k_crate_{kind}_{dx}', o, loc=(dx, dy, H + 0.2))
    g.box((0.42, 0.04, 0.2), (0, -0.43, H + 0.12), mat(col), bevel=0.02)          # label plate
    g.build(f'k_crate_{kind}_m', o)

o = T('k_board')
g = Geo(); counter_body(g)
g.box((0.62, 0.48, 0.04), (0, 0, H + 0.02), mat('#e8c08a'), bevel=0.012)
g.box((0.04, 0.2, 0.012), (0.36, -0.1, H + 0.01), mat('#2d3340'), bevel=0.004)
g.box((0.05, 0.16, 0.004), (0.36, 0.08, H + 0.01), mat('#dfe4ea', rough=0.25, metal=0.6), bevel=0.002)
g.build('k_board_m', o)

o = T('k_stove')
g = Geo()
g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), mat('#3a3f4a'), bevel=0.03)
g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat('#5b6270', rough=0.35, metal=0.3), bevel=0.02)
for dx in (-0.25, 0, 0.25):
    g.cyl(0.035, 0.03, (dx, -0.5, H * 0.6), mat('#ffd32a'), seg=12, rot=(PI / 2, 0, 0))
g.cyl(0.26, 0.012, (0, 0, H + 0.006), mat('#22252c'), seg=24)
g.cyl(0.18, 0.014, (0, 0, H + 0.008), glow('#ff6b3d', 1.6), seg=24)
g.build('k_stove_m', o)

o = T('k_pot')
g = Geo()
g.cyl(0.24, 0.3, (0, 0, 0.16), mat('#c9d1db', rough=0.25, metal=0.6), seg=28, bevel=0.02)
g.cyl(0.22, 0.02, (0, 0, 0.3), mat('#8d97a5', rough=0.3, metal=0.5), seg=28)
for dx in (-0.27, 0.27):
    g.box((0.08, 0.05, 0.04), (dx, 0, 0.27), mat('#2d3340'), bevel=0.012)
g.build('k_pot_m', o)
soup = Geo()
soup.cyl(0.215, 0.02, (0, 0, 0), mat('#ff6b4a', rough=0.25, name='soup'), seg=28)
soup.build('k_pot_soup', o, loc=(0, 0, 0.12))

o = T('k_plates')
g = Geo(); counter_body(g)
for i in range(5):
    plate(g, z=H + i * 0.03)
g.build('k_plates_m', o)

o = T('k_serve')
g = Geo()
g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), mat('#2ed573'), bevel=0.03)
g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat('#1e9e57'), bevel=0.02)
for i in range(6):
    g.cyl(0.04, 0.9, (-0.4 + i * 0.16, 0, H + 0.02), mat('#cfd6df', metal=0.5, rough=0.3), seg=10, rot=(PI / 2, 0, 0))
g.cone(0.14, 0.03, (0, -0.32, H + 0.08), mat('#ffffff'), seg=3, rot=(0, 0, PI / 2))
g.sphere(0.07, (0.36, 0.36, H + 0.05), mat('#ffd32a', rough=0.25, metal=0.6), scale=(1, 1, 0.7), seg=14)
g.build('k_serve_m', o)

o = T('k_bin')
g = Geo()
g.cyl(0.32, 0.62, (0, 0, 0.31), mat('#5b6270', rough=0.4), seg=24, r2=0.36, bevel=0.03)
g.cyl(0.37, 0.05, (0, 0, 0.63), mat('#3a3f4a', rough=0.4), seg=24, bevel=0.015)
g.cyl(0.29, 0.02, (0, 0, 0.66), mat('#1d1f24'), seg=24)
g.build('k_bin_m', o)

# ---------------------------------------------------------------- loose items
for nm, fn, cut in (('i_tomato', tomato, False), ('i_tomato_cut', tomato, True), ('i_lettuce', lettuce, False),
                    ('i_lettuce_cut', lettuce, True), ('i_onion', onion, False), ('i_onion_cut', onion, True)):
    o = T(nm)
    g = Geo(); fn(g, z=0, s=1.0, cut=cut); g.build(nm + '_m', o)
o = T('i_plate')
g = Geo(); plate(g); g.build('i_plate_m', o)
o = T('i_soup')
g = Geo()
g.cyl(0.13, 0.08, (0, 0, 0.065), mat('#ffffff', rough=0.3), seg=24, r2=0.1, bevel=0.01)
g.build('i_soup_m', o)
s2 = Geo()
s2.cyl(0.115, 0.015, (0, 0, 0), mat('#ff6b4a', rough=0.25, name='soup'), seg=24)
s2.build('i_soup_top', o, loc=(0, 0, 0.1))

# ---------------------------------------------------------------- room
o = T('k_room')
g = Geo()
W, D = COLS, ROWS
for c in range(W):
    for r in range(D):
        g.box((1.0, 1.0, 0.02), (c - W / 2 + 0.5, r - D / 2 + 0.5, -0.01),
              mat('#fff4e2' if (c + r) % 2 else '#ffd7a8'), bevel=0)
g.box((W + 8, D + 8, 0.1), (0, 0, -0.07), mat('#e9a35f'), bevel=0)            # wooden floor outside
# Back wall with windows, shelves; side walls lower
g.box((W + 1, 0.3, 2.4), (0, D / 2 + 0.65, 1.2), mat('#ff8a5c'), bevel=0.05)
for i in range(4):
    x = -4.5 + i * 3
    g.box((1.6, 0.1, 0.9), (x, D / 2 + 0.48, 1.45), mat('#d6f0ff', rough=0.15), bevel=0.04)
    g.box((1.7, 0.14, 0.08), (x, D / 2 + 0.45, 0.98), mat('#ffffff'), bevel=0.02)
for i in range(8):
    g.box((0.38, 0.6, 0.03), (-W / 2 + 0.5 + i * (W / 8) + 0.5, D / 2 + 0.35, 2.15), mat('#ff4b3e' if i % 2 else '#ffffff'),
          bevel=0.01, rot=(-0.4, 0, 0))
for x in (-W / 2 - 0.65, W / 2 + 0.65):
    g.box((0.3, D + 1.6, 1.0), (x, 0.15, 0.5), mat('#ff8a5c'), bevel=0.05)
# Decor outside the play area
for (x, y) in ((-W / 2 - 1.6, D / 2 + 0.6), (W / 2 + 1.6, D / 2 + 0.6), (-W / 2 - 1.6, -D / 2 - 0.4), (W / 2 + 1.6, -D / 2 - 0.4)):
    g.cyl(0.3, 0.5, (x, y, 0.25), mat('#ff7f50'), seg=16, r2=0.24)
    bush(g, (x, y, 0.45), 3)
crate(g, (-W / 2 - 1.6, 0.5, 0), 0.5, 0.3)
crate(g, (-W / 2 - 1.5, -0.4, 0), 0.4, 0.8)
g.build('k_room_m', o)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_animations=False,
                          export_lights=False, export_cameras=False, export_yup=True)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

"""Kitchen assets for the Cooking game (meters; 1 tile = 1 m; counters 0.55 m tall).

    blender -b --factory-startup --python art/kitchen.py -- assets/kitchen.glb

Every template sits at the origin with its base on the floor; the game clones
them onto the tile grid of the chosen map (js/games/kitchens.js, built into
kitchen_*.glb by art/kitchens.py). Names are an API for js/games/cooking.js:
  k_room                       floor + walls of a plain 12 x 8 kitchen (fallback venue)
  k_counter k_board (> knife)  plain counter; prep board with a knife that chops
  k_sink (> water)             rinse basin; `water` shows while rinsing
  k_cooker                     stove; the game puts a k_pot on it
  k_pot (> soup, lid)          pot; `soup` (material 'soup') is tinted by what's in it, `lid` rattles
  k_fryer (> oil, basket)      oil basin; `basket` dips while frying
  k_plates                     assembly counter with a stack of clean dishes
  k_serve                      serving hatch (awning, bell)
  k_bin
  k_crate (> label)            ingredient crate; `label` (material 'label') is tinted, the
                               game stacks the ingredient's i_* model on top
  i_<ingredient>[_<state>]     rice, noodles, veg, tofu, fish, squid, shrimp, crab, chili,
                               citrus, peanut; states cut, rinsed, cooked, fried (where they exist)
  i_plate i_bowl i_glass       containers
  d_<recipe>                   the nine finished dishes: gado, liwet, tahu, ikan, cumi, udang,
                               bakmi, selade, jeruk (the game shows one when a plate matches)
  fx_steam fx_smoke fx_splash  particles the game moves (steam over cooking, smoke when burning,
                               a splash while rinsing)
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from rlib import Geo, mat, glow, reset, empty, bush, crate  # noqa: E402

OUT = [a for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]) if not a.startswith('-')]
OUT = OUT[0] if OUT else 'kitchen.glb'
PI = math.pi
TAU = math.tau
reset()
rng = random.Random(9)

H = 0.55            # counter height
TOP = '#f1e3c8'     # counter top (bamboo)
WOOD = '#c98b52'
WOOD_D = '#8f5a31'
STEEL = mat('#cfd6df', rough=0.3, metal=0.5)
DARK = mat('#3a3f4a', rough=0.5)
WHITE = mat('#ffffff', rough=0.3)
CREAM = mat('#fff4dc', rough=0.4)
WATER = mat('#5fc8ec', rough=0.15, name='water')
OIL = mat('#e8b84a', rough=0.2, name='oil')
GREEN = mat('#5fc96a', rough=0.6)
GREEN_D = mat('#3f9a4a', rough=0.6)
RED = mat('#e8382c', rough=0.45)
ORANGE = mat('#ff8a3d', rough=0.5)
YELLOW = mat('#f7d04b', rough=0.5)
PINK = mat('#f7a6c0', rough=0.5)
BLUE = mat('#4f90e8', rough=0.5)
BROWN = mat('#8d5a2b', rough=0.6)
TAN = mat('#e9c898', rough=0.7)
RICE = mat('#f6f2e8', rough=0.8)
COLS, ROWS = 12, 8

templates = []


def T(name):
    o = empty(name, loc=(0, 0, 0))
    templates.append(o)
    return o


def counter_body(g, top=TOP, body=WOOD):
    g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), mat(body), bevel=0.03)
    for i in range(6):                                                               # bamboo slats
        g.box((0.11, 0.02, H - 0.14), (-0.4 + i * 0.16, -0.49, (H - 0.06) / 2), mat(WOOD_D), bevel=0.008)
    g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat(top), bevel=0.02)


# ---------------------------------------------------------------- ingredients (built at z = 0, ~0.2 m wide)
def rice(g, z=0.0, state=None):
    if state is None:                                                                # a cloth sack
        g.sphere(0.11, (0, 0, z + 0.1), TAN, scale=(1, 0.9, 0.9), seg=12)
        g.cyl(0.04, 0.06, (0, 0, z + 0.2), TAN, seg=8)
        g.cyl(0.05, 0.015, (0, 0, z + 0.2), BROWN, seg=8)
    else:                                                                            # in a bowl: wet, or cooked and mounded
        g.cyl(0.11, 0.07, (0, 0, z + 0.035), CREAM, seg=16, r2=0.08)
        g.sphere(0.09, (0, 0, z + 0.07), WATER if state == 'rinsed' else RICE, scale=(1, 1, 0.5 if state == 'rinsed' else 0.8), seg=12)


def noodles(g, z=0.0, state=None):
    col = mat('#f5d36b', rough=0.5) if state is None else mat('#f7dc8a', rough=0.25)
    for i in range(7):
        a = i / 7 * TAU
        g.cyl(0.013, 0.17, (math.cos(a) * 0.06, math.sin(a) * 0.06, z + 0.03), col, seg=6, rot=(PI / 2, 0, a + 0.4))
    g.sphere(0.07, (0, 0, z + 0.05), col, scale=(1.3, 1.3, 0.6), seg=10)


def veg(g, z=0.0, state=None):
    if state is None:                                                                # bok choy
        for i in range(5):
            a = i / 5 * TAU
            g.sphere(0.05, (math.cos(a) * 0.035, math.sin(a) * 0.035, z + 0.07), mat('#e9f2cf', rough=0.6), scale=(0.7, 0.7, 1.6), seg=8)
            g.sphere(0.055, (math.cos(a) * 0.06, math.sin(a) * 0.06, z + 0.16), GREEN_D, scale=(1, 1, 0.55), seg=8, rot=(0.4 * math.sin(a), -0.4 * math.cos(a), 0))
    else:
        for i in range(6):
            a = i / 6 * TAU
            g.sphere(0.045, (math.cos(a) * 0.05, math.sin(a) * 0.05, z + 0.03), GREEN if i % 2 else GREEN_D, scale=(1.3, 1, 0.45), seg=8, rot=(0, 0, a))


def tofu(g, z=0.0, state=None):
    if state is None:
        g.box((0.17, 0.17, 0.11), (0, 0, z + 0.055), CREAM, bevel=0.012)
    else:
        col = {'cut': CREAM, 'cooked': mat('#fff8ea', rough=0.25), 'fried': mat('#e6a23c', rough=0.4)}[state]
        for i, (dx, dy) in enumerate(((-0.05, -0.05), (0.05, -0.05), (-0.05, 0.05), (0.05, 0.05), (0, 0))):
            g.box((0.07, 0.07, 0.06), (dx, dy, z + 0.03 + (0.06 if i == 4 else 0)), col, bevel=0.008)


def fish(g, z=0.0, state=None):
    if state is None:
        g.sphere(0.1, (0, 0, z + 0.04), BLUE, scale=(1.9, 0.9, 0.7), seg=12)
        g.cone(0.05, 0.08, (-0.2, 0, z + 0.04), BLUE, seg=4, rot=(0, -PI / 2, 0))
        g.sphere(0.015, (0.12, -0.05, z + 0.06), DARK, seg=6)
    else:
        col = mat('#f6d9c0', rough=0.5) if state == 'cut' else mat('#f1c3a0', rough=0.4)
        for i in range(3):
            g.box((0.09, 0.05, 0.03), (-0.07 + i * 0.07, 0, z + 0.015 + i * 0.005), col, bevel=0.006, rot=(0, 0, 0.3))


def squid(g, z=0.0, state=None):
    if state is None:
        g.sphere(0.06, (0, 0, z + 0.08), PINK, scale=(0.9, 1.6, 0.9), seg=10)
        for i in range(6):
            a = i / 6 * TAU
            g.cyl(0.012, 0.09, (math.cos(a) * 0.03, -0.12, z + 0.03), PINK, seg=5, rot=(PI / 2.4, 0, a))
        g.cone(0.045, 0.1, (0, 0.11, z + 0.08), PINK, seg=6, rot=(-PI / 2, 0, 0))
    else:
        col = PINK if state == 'cut' else mat('#f0b35a', rough=0.4)
        for i in range(4):
            g.cyl(0.045, 0.02, (-0.08 + i * 0.055, 0, z + 0.01 + i * 0.004), col, seg=12, r2=0.045)
            g.cyl(0.028, 0.022, (-0.08 + i * 0.055, 0, z + 0.01 + i * 0.004), CREAM, seg=10)


def shrimp(g, z=0.0, state=None):
    col = ORANGE if state is None else mat('#ff6b3d', rough=0.4)
    n = 3 if state is None else 5
    for i in range(n):
        a = i / n * TAU
        x, y = math.cos(a) * 0.06, math.sin(a) * 0.06
        for k in range(4):
            g.sphere(0.028 - k * 0.004, (x + math.cos(a + k * 0.6) * k * 0.025, y + math.sin(a + k * 0.6) * k * 0.025, z + 0.025), col, seg=7)


def crab(g, z=0.0, state=None):
    col = RED if state is None else mat('#ff7a52', rough=0.4)
    if state is None:
        g.sphere(0.09, (0, 0, z + 0.05), col, scale=(1.4, 1, 0.6), seg=12)
        for sx in (-1, 1):
            g.sphere(0.035, (sx * 0.14, 0.07, z + 0.05), col, scale=(1.2, 1.4, 0.8), seg=8)
            for k in range(3):
                g.cyl(0.012, 0.08, (sx * (0.1 + k * 0.02), -0.04 + k * 0.03, z + 0.03), col, seg=5, rot=(0, sx * 1.0, k * 0.3))
            g.sphere(0.015, (sx * 0.04, 0.09, z + 0.09), DARK, seg=6)
    else:
        for i in range(4):
            a = i / 4 * TAU
            g.sphere(0.04, (math.cos(a) * 0.06, math.sin(a) * 0.06, z + 0.03), col, scale=(1.4, 0.8, 0.6), seg=8, rot=(0, 0, a))


def chili(g, z=0.0, state=None):
    if state is None:
        for i in range(4):
            a = i / 4 * TAU + 0.3
            g.sphere(0.03, (math.cos(a) * 0.05, math.sin(a) * 0.05, z + 0.03), RED, scale=(3.2, 0.8, 0.8), seg=8, rot=(0, 0, a))
            g.cyl(0.008, 0.03, (math.cos(a) * 0.05 - math.cos(a) * 0.1, math.sin(a) * 0.05 - math.sin(a) * 0.1, z + 0.03), GREEN_D, seg=5, rot=(0, PI / 2, a))
    else:
        for i in range(9):
            a = i / 9 * TAU
            r = 0.04 + 0.03 * (i % 2)
            g.cyl(0.018, 0.012, (math.cos(a) * r, math.sin(a) * r, z + 0.006), RED, seg=8)


def citrus(g, z=0.0, state=None):
    lime = mat('#8fd14f', rough=0.5)
    if state is None:
        for dx, dy in ((-0.06, -0.03), (0.06, -0.02), (0, 0.06)):
            g.sphere(0.05, (dx, dy, z + 0.05), lime, seg=10)
    else:                                                                            # squeezed halves and a cup of juice
        for sx in (-1, 1):
            g.sphere(0.045, (sx * 0.08, 0.02, z + 0.025), lime, scale=(1, 1, 0.5), seg=10)
            g.cyl(0.04, 0.01, (sx * 0.08, 0.02, z + 0.045), mat('#d7f4a2', rough=0.4), seg=10)
        g.cyl(0.035, 0.07, (0, -0.07, z + 0.035), mat('#c8f07a', rough=0.2), seg=12)


def peanut(g, z=0.0, state=None):
    g.cyl(0.1, 0.07, (0, 0, z + 0.035), BROWN, seg=16, r2=0.075)
    g.cyl(0.085, 0.02, (0, 0, z + 0.075), mat('#b8783a', rough=0.35), seg=16)
    g.cyl(0.012, 0.16, (0.04, 0, z + 0.1), mat('#dcbf98', rough=0.5), seg=6, rot=(0, 0.5, 0))


INGREDIENTS = {
    'rice': (rice, (None, 'rinsed', 'cooked')),
    'noodles': (noodles, (None, 'cooked')),
    'veg': (veg, (None, 'cut')),
    'tofu': (tofu, (None, 'cut', 'cooked', 'fried')),
    'fish': (fish, (None, 'cut', 'cooked')),
    'squid': (squid, (None, 'cut', 'fried')),
    'shrimp': (shrimp, (None, 'cut', 'cooked')),
    'crab': (crab, (None, 'cut', 'cooked')),
    'chili': (chili, (None, 'cut')),
    'citrus': (citrus, (None, 'cut')),
    'peanut': (peanut, (None,)),
}
for name, (fn, states) in INGREDIENTS.items():
    for st in states:
        o = T(f'i_{name}' + (f'_{st}' if st else ''))
        g = Geo()
        fn(g, z=0, state=st)
        g.build(o.name + '_m', o)


# ---------------------------------------------------------------- containers and dishes
def plate(g, z=0.0):
    g.cyl(0.19, 0.025, (0, 0, z + 0.013), WHITE, seg=24, bevel=0.008)
    g.cyl(0.13, 0.027, (0, 0, z + 0.016), mat('#eef2f6', rough=0.3), seg=24)


def bowl(g, z=0.0):
    g.cyl(0.15, 0.09, (0, 0, z + 0.045), WHITE, seg=24, r2=0.09, bevel=0.01)
    g.cyl(0.12, 0.02, (0, 0, z + 0.085), mat('#eef2f6', rough=0.3), seg=24)


def glass(g, z=0.0):
    g.cyl(0.055, 0.16, (0, 0, z + 0.08), mat('#d6f2ff', rough=0.1), seg=14, r2=0.045)


o = T('i_plate'); g = Geo(); plate(g); g.build('i_plate_m', o)
o = T('i_bowl'); g = Geo(); bowl(g); g.build('i_bowl_m', o)
o = T('i_glass'); g = Geo(); glass(g); g.build('i_glass_m', o)


def mound(g, z, col, r=0.1, h=0.07):
    g.sphere(r, (0, 0, z), col, scale=(1, 1, h / r), seg=12)


def dish(name, build):
    o = T(f'd_{name}')
    g = Geo()
    build(g)
    g.build(o.name + '_m', o)


def d_gado(g):                                   # vegetables and tofu under peanut sauce, on a plate
    plate(g)
    veg(g, z=0.03, state='cut')
    for dx, dy in ((-0.04, 0.03), (0.05, -0.02)):
        g.box((0.06, 0.06, 0.05), (dx, dy, 0.065), CREAM, bevel=0.006)
    mound(g, 0.07, mat('#b8783a', rough=0.35), r=0.09, h=0.04)


def d_liwet(g):                                  # rice bowl with greens and chili
    bowl(g)
    mound(g, 0.09, RICE, r=0.1, h=0.06)
    g.sphere(0.035, (-0.04, 0.03, 0.15), GREEN_D, scale=(1.3, 1, 0.5), seg=8)
    g.sphere(0.035, (0.04, -0.02, 0.15), GREEN, scale=(1.3, 1, 0.5), seg=8)
    for a in (0.4, 2.5, 4.4):
        g.cyl(0.015, 0.01, (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.16), RED, seg=6)


def d_tahu(g):                                   # fried tofu with sambal
    plate(g)
    tofu(g, z=0.03, state='fried')
    g.cyl(0.05, 0.015, (0.02, -0.09, 0.035), mat('#d8231c', rough=0.35), seg=10)


def d_ikan(g):                                   # grilled-fish rice bowl with lime
    bowl(g)
    mound(g, 0.09, RICE, r=0.1, h=0.05)
    g.box((0.12, 0.06, 0.035), (0, 0.01, 0.15), mat('#d9935a', rough=0.45), bevel=0.006, rot=(0, 0, 0.3))
    g.sphere(0.03, (0.07, -0.06, 0.14), mat('#8fd14f', rough=0.5), scale=(1, 1, 0.5), seg=8)


def d_cumi(g):                                   # fried squid rings with chili
    plate(g)
    squid(g, z=0.03, state='fried')
    for a in (0.7, 2.6):
        g.cyl(0.015, 0.01, (math.cos(a) * 0.11, math.sin(a) * 0.11, 0.035), RED, seg=6)


def d_udang(g):                                  # shrimp in red sauce, in a bowl
    bowl(g)
    g.cyl(0.11, 0.03, (0, 0, 0.1), mat('#d8231c', rough=0.3), seg=16)
    shrimp(g, z=0.1, state='cooked')
    g.sphere(0.03, (0.05, 0.05, 0.15), GREEN_D, scale=(1.3, 1, 0.5), seg=8)


def d_bakmi(g):                                  # crab noodles
    bowl(g)
    noodles(g, z=0.07, state='cooked')
    crab(g, z=0.12, state='cooked')
    g.sphere(0.03, (-0.07, 0.04, 0.15), GREEN, scale=(1.3, 1, 0.5), seg=8)


def d_selade(g):                                 # salad plate with fried tofu and sauce
    plate(g)
    veg(g, z=0.03, state='cut')
    g.box((0.06, 0.06, 0.05), (0.05, 0.03, 0.065), mat('#e6a23c', rough=0.4), bevel=0.006)
    g.box((0.06, 0.06, 0.05), (-0.05, -0.03, 0.065), mat('#e6a23c', rough=0.4), bevel=0.006)
    g.cyl(0.05, 0.012, (0, 0, 0.09), mat('#b8783a', rough=0.35), seg=10)


def d_jeruk(g):                                  # lime juice with ice and a straw
    glass(g)
    g.cyl(0.042, 0.12, (0, 0, 0.065), mat('#c8f07a', rough=0.15), seg=12)
    g.box((0.03, 0.03, 0.03), (0.01, 0.01, 0.14), mat('#e8f8ff', rough=0.1), bevel=0.004)
    g.cyl(0.006, 0.2, (0.02, -0.02, 0.17), RED, seg=5, rot=(0.2, 0.3, 0))
    g.sphere(0.025, (-0.04, 0.03, 0.165), mat('#8fd14f', rough=0.5), scale=(1, 1, 0.5), seg=8)


for nm, fn in (('gado', d_gado), ('liwet', d_liwet), ('tahu', d_tahu), ('ikan', d_ikan), ('cumi', d_cumi),
               ('udang', d_udang), ('bakmi', d_bakmi), ('selade', d_selade), ('jeruk', d_jeruk)):
    dish(nm, fn)

# ---------------------------------------------------------------- stations
o = T('k_counter')
g = Geo(); counter_body(g); g.build('k_counter_m', o)

o = T('k_crate')
g = Geo()
counter_body(g)
g.box((0.82, 0.82, 0.22), (0, 0, H + 0.11), mat('#d39a5c'), bevel=0.02)
g.box((0.7, 0.7, 0.1), (0, 0, H + 0.17), mat('#8a5a34'), bevel=0.01)
g.build('k_crate_m', o)
lab = Geo()
lab.box((0.42, 0.04, 0.2), (0, 0, 0), mat('#ffffff', name='label'), bevel=0.02)
lab.build('label', o, loc=(0, -0.43, H + 0.12))

o = T('k_board')
g = Geo(); counter_body(g)
g.box((0.62, 0.48, 0.04), (0, 0, H + 0.02), mat('#e8c08a'), bevel=0.012)
g.build('k_board_m', o)
kn = Geo()
kn.box((0.04, 0.2, 0.012), (0, -0.1, 0), DARK, bevel=0.004)
kn.box((0.05, 0.16, 0.004), (0, 0.08, 0), mat('#dfe4ea', rough=0.25, metal=0.6), bevel=0.002)
kn.build('knife', o, loc=(0.3, 0, H + 0.05))

o = T('k_sink')
g = Geo(); counter_body(g)
g.box((0.7, 0.6, 0.3), (0, 0, H + 0.1), STEEL, bevel=0.02)
g.box((0.6, 0.5, 0.26), (0, 0, H + 0.14), mat('#9aa4b2', rough=0.35, metal=0.4), bevel=0.0)
g.cyl(0.025, 0.3, (0, 0.33, H + 0.3), STEEL, seg=10)
g.cyl(0.02, 0.22, (0, 0.22, H + 0.45), STEEL, seg=10, rot=(PI / 2, 0, 0))
g.build('k_sink_m', o)
w = Geo()
w.cyl(0.26, 0.02, (0, 0, 0), WATER, seg=18)
w.build('water', o, loc=(0, 0, H + 0.2))

o = T('k_cooker')
g = Geo()
g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), DARK, bevel=0.03)
g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat('#5b6270', rough=0.35, metal=0.3), bevel=0.02)
for dx in (-0.25, 0, 0.25):
    g.cyl(0.035, 0.03, (dx, -0.5, H * 0.6), YELLOW, seg=12, rot=(PI / 2, 0, 0))
g.cyl(0.26, 0.012, (0, 0, H + 0.006), mat('#22252c'), seg=24)
g.cyl(0.18, 0.014, (0, 0, H + 0.008), glow('#ff6b3d', 1.6), seg=24)
for i in range(3):                                                                   # firewood under the hob
    g.cyl(0.05, 0.6, (-0.15 + i * 0.15, -0.3, 0.14 + (i % 2) * 0.05), BROWN, seg=7, rot=(PI / 2, 0, 0.2))
g.build('k_cooker_m', o)

o = T('k_pot')
g = Geo()
g.cyl(0.24, 0.3, (0, 0, 0.16), mat('#4a4f5a', rough=0.35, metal=0.5), seg=28, bevel=0.02)
g.cyl(0.22, 0.02, (0, 0, 0.3), mat('#2d3340', rough=0.3, metal=0.5), seg=28)
for dx in (-0.27, 0.27):
    g.box((0.08, 0.05, 0.04), (dx, 0, 0.27), DARK, bevel=0.012)
g.build('k_pot_m', o)
soup = Geo()
soup.cyl(0.215, 0.02, (0, 0, 0), mat('#ff6b4a', rough=0.25, name='soup'), seg=28)
soup.build('soup', o, loc=(0, 0, 0.12))
lid = Geo()
lid.cyl(0.235, 0.03, (0, 0, 0), mat('#3b404b', rough=0.35, metal=0.5), seg=28, bevel=0.01)
lid.sphere(0.035, (0, 0, 0.04), DARK, seg=8)
lid.build('lid', o, loc=(0, 0, 0.32))

o = T('k_fryer')
g = Geo()
g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), DARK, bevel=0.03)
g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat('#5b6270', rough=0.35, metal=0.3), bevel=0.02)
g.box((0.66, 0.56, 0.28), (0, 0, H + 0.1), STEEL, bevel=0.02)
g.box((0.56, 0.46, 0.26), (0, 0, H + 0.14), mat('#9aa4b2', rough=0.35, metal=0.4), bevel=0.0)
g.cyl(0.03, 0.04, (0.4, -0.3, H + 0.02), RED, seg=10)
g.build('k_fryer_m', o)
oil = Geo()
oil.box((0.5, 0.4, 0.02), (0, 0, 0), OIL, bevel=0)
oil.build('oil', o, loc=(0, 0, H + 0.2))
bk = Geo()
for i in range(5):
    bk.box((0.44, 0.01, 0.16), (0, -0.17 + i * 0.085, 0.08), STEEL, bevel=0)
    bk.box((0.01, 0.36, 0.16), (-0.2 + i * 0.1, 0, 0.08), STEEL, bevel=0)
bk.box((0.44, 0.36, 0.01), (0, 0, 0.0), STEEL, bevel=0)
bk.cyl(0.015, 0.4, (0.32, 0, 0.3), DARK, seg=8, rot=(0, 0.9, 0))
bk.build('basket', o, loc=(0, 0, H + 0.1))

o = T('k_plates')
g = Geo(); counter_body(g)
for i in range(4):
    plate(g, z=H + i * 0.03)
bowl(g, z=H + 0.12)
g.cyl(0.05, 0.15, (0.33, -0.3, H + 0.075), mat('#d6f2ff', rough=0.1), seg=12, r2=0.04)
g.cyl(0.05, 0.15, (0.33, 0.3, H + 0.075), mat('#d6f2ff', rough=0.1), seg=12, r2=0.04)
g.build('k_plates_m', o)

o = T('k_serve')
g = Geo()
g.box((0.98, 0.98, H - 0.06), (0, 0, (H - 0.06) / 2), mat('#2ed573'), bevel=0.03)
g.box((1.0, 1.0, 0.06), (0, 0, H - 0.03), mat('#1e9e57'), bevel=0.02)
for dx in (-0.45, 0.45):
    g.cyl(0.03, 1.6, (dx, 0.35, 0.8), mat(WOOD_D), seg=8)
for i in range(6):                                                                   # striped awning
    g.box((0.17, 0.7, 0.03), (-0.42 + i * 0.17, 0.0, 1.62), RED if i % 2 else WHITE, bevel=0.0, rot=(0.35, 0, 0))
g.sphere(0.07, (0.36, 0.36, H + 0.05), mat('#ffd32a', rough=0.25, metal=0.6), scale=(1, 1, 0.7), seg=14)
g.build('k_serve_m', o)

o = T('k_bin')
g = Geo()
g.cyl(0.32, 0.62, (0, 0, 0.31), mat('#5b6270', rough=0.4), seg=24, r2=0.36, bevel=0.03)
g.cyl(0.37, 0.05, (0, 0, 0.63), DARK, seg=24, bevel=0.015)
g.cyl(0.29, 0.02, (0, 0, 0.66), mat('#1d1f24'), seg=24)
g.build('k_bin_m', o)

# ---------------------------------------------------------------- effects
o = T('fx_steam')
g = Geo()
g.sphere(0.1, (0, 0, 0), mat('#ffffff', rough=1.0), seg=8)
g.sphere(0.07, (0.08, 0.02, 0.06), mat('#ffffff', rough=1.0), seg=8)
g.build('fx_steam_m', o)
o = T('fx_smoke')
g = Geo()
g.sphere(0.12, (0, 0, 0), mat('#4a4a4a', rough=1.0), seg=8)
g.sphere(0.08, (-0.09, 0.03, 0.07), mat('#5c5c5c', rough=1.0), seg=8)
g.build('fx_smoke_m', o)
o = T('fx_splash')
g = Geo()
for i in range(6):
    a = i / 6 * TAU
    g.sphere(0.03, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0), mat('#bfe9ff', rough=0.2), seg=6)
g.build('fx_splash_m', o)

# ---------------------------------------------------------------- room (fallback venue)
o = T('k_room')
g = Geo()
W, D = COLS, ROWS
for c in range(W):
    for r in range(D):
        g.box((1.0, 1.0, 0.02), (c - W / 2 + 0.5, r - D / 2 + 0.5, -0.01),
              mat('#fff4e2' if (c + r) % 2 else '#ffd7a8'), bevel=0)
g.box((W + 8, D + 8, 0.1), (0, 0, -0.07), mat('#e9a35f'), bevel=0)            # wooden floor outside
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
for (x, y) in ((-W / 2 - 1.6, D / 2 + 0.6), (W / 2 + 1.6, D / 2 + 0.6), (-W / 2 - 1.6, -D / 2 - 0.4), (W / 2 + 1.6, -D / 2 - 0.4)):
    g.cyl(0.3, 0.5, (x, y, 0.25), mat('#ff7f50'), seg=16, r2=0.24)
    bush(g, (x, y, 0.45), 3)
crate(g, (-W / 2 - 1.6, 0.5, 0), 0.5, 0.3)
crate(g, (-W / 2 - 1.5, -0.4, 0), 0.4, 0.8)
g.build('k_room_m', o)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_animations=False,
                          export_lights=False, export_cameras=False, export_yup=True)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB', '-', len(templates), 'templates')

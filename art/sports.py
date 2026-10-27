"""Builds the in-game sports assets (real-world meters; Blender Z-up -> glTF Y-up).

    python art/sports.py assets/

Outputs:
  characters.glb   ch_tennis, ch_tt, ch_chef  (recolorable: 'shirt', 'accent', 'hair')
  tennis_court.glb stadium + court, long axis along Blender Y, net at y = 0
  tt_hall.glb      sports hall + table, long axis along Blender Y, net at y = 0
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from rlib import Geo, Chibi, mat, glow, reset, racket, tree, pine, bush, lamp, TAU  # noqa: E402

OUT = [a for a in (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]) if not a.startswith('-')]
OUT = OUT[0] if OUT else 'assets'
os.makedirs(OUT, exist_ok=True)
PI = math.pi


def export(name):
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_animations=False,
                              export_lights=False, export_cameras=False, export_yup=True)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')


# ======================================================================
# Characters (unit scale; the game scales them up)
# ======================================================================
reset()
rng = random.Random(3)
t = Chibi('ch_tennis', None, (0, 0, 0), shirt='#ffffff', shorts='#ffffff', hair='#4a2c1d', hat='band', tint=True, rng=rng)
racket(t.socket, 'ch_tennis_racket', '#ff4757', tennis=True)
p = Chibi('ch_tt', None, (0, 0, 0), shirt='#ffffff', shorts='#2d3340', hair='#4a2c1d', tint=True, rng=rng)
racket(p.socket, 'ch_tt_paddle', tennis=False)
c = Chibi('ch_chef', None, (0, 0, 0), shirt='#ffffff', shorts='#2d3340', hair='#4a2c1d', outfit='chef', hat='chef',
          tint=True, rng=rng)
export('characters.glb')


def crowd(g, x0, x1, y, z, facing_y, rows=6, step=0.75, rise=0.55, depth=0.85, rng=random):
    """Stepped stands along X at depth y, rising away from the court."""
    seat_cols = ['#ff4757', '#2f7dff', '#ffd32a', '#2ed573', '#a55eea', '#ff9f43']
    away = -facing_y  # stands rise away from the court
    for r in range(rows):
        yy = y + away * r * depth
        zz = z + r * rise
        g.box((x1 - x0, depth, 0.12), ((x0 + x1) / 2, yy, zz), mat('#e9e2d6'), bevel=0.03)
        g.box((x1 - x0, 0.08, rise), ((x0 + x1) / 2, yy + away * depth / 2, zz + rise / 2 - 0.06), mat('#d8cfc0'), bevel=0.02)
        n = int((x1 - x0) / step)
        for i in range(n):
            x = x0 + (i + 0.5) * step
            col = seat_cols[(i + r) % len(seat_cols)]
            if rng.random() < 0.55:
                # a fan: body + head, in a random shirt
                shirt = rng.choice(['#ff6b81', '#70a1ff', '#7bed9f', '#ffd32a', '#ffffff', '#ff9f43', '#a29bfe'])
                g.box((0.42, 0.3, 0.5), (x, yy, zz + 0.31), mat(shirt), bevel=0.1, seg=1)
                g.sphere(0.24, (x, yy - facing_y * 0.02, zz + 0.78), mat('#ffd2b0'), seg=8)
                g.sphere(0.25, (x, yy + away * 0.04, zz + 0.86), mat(rng.choice(['#4a2c1d', '#2b1d16', '#7a4a2a', '#c58b4a'])),
                         scale=(1, 1, 0.75), seg=8)
            else:
                g.box((0.5, 0.42, 0.12), (x, yy, zz + 0.12), mat(col), bevel=0.03, seg=1)
                g.box((0.5, 0.08, 0.4), (x, yy + away * 0.2, zz + 0.3), mat(col), bevel=0.03, seg=1)


# ======================================================================
# Tennis stadium (court: 23.77 x 10.97 doubles, singles 8.23)
# ======================================================================
reset()
rng = random.Random(11)
g = Geo()
L, WD, WS = 23.77 / 2, 10.97 / 2, 8.23 / 2
line = mat('#ffffff', rough=0.5)
g.box((60, 80, 0.2), (0, 0, -0.1), mat('#57b85a'), bevel=0)                 # grass outside
g.rbox((WD * 2 + 9, L * 2 + 14, 0.04), (0, 0, 0.02), mat('#3fae5a'), radius=0.8, bevel=0.01)   # outer court
g.box((WD * 2, L * 2, 0.012), (0, 0, 0.046), mat('#2f7dff'), bevel=0)        # playing area
LW = 0.08
for x in (-WD, WD, -WS, WS):
    g.box((LW, L * 2, 0.006), (x, 0, 0.055), line, bevel=0)
for y in (-L, L):
    g.box((WD * 2, LW, 0.006), (0, y, 0.055), line, bevel=0)
for y in (-6.4, 6.4):
    g.box((WS * 2, LW, 0.006), (0, y, 0.055), line, bevel=0)
g.box((LW, 12.8, 0.006), (0, 0, 0.055), line, bevel=0)
for y in (-L, L):
    g.box((LW, 0.3, 0.006), (0, y - 0.15 * (1 if y > 0 else -1), 0.055), line, bevel=0)
# Net (posts 0.914 m outside doubles lines)
for x in (-WD - 0.914, WD + 0.914):
    g.cyl(0.05, 1.07, (x, 0, 0.535), mat('#2d3340'), seg=12)
    g.sphere(0.06, (x, 0, 1.08), mat('#2d3340'), seg=10)
g.box(((WD + 0.914) * 2, 0.03, 0.86), (0, 0, 0.48), mat('#262a33', rough=0.95), bevel=0)
g.box(((WD + 0.914) * 2, 0.06, 0.07), (0, 0, 0.93), line, bevel=0.02)
g.box((0.05, 0.035, 0.9), (0, 0, 0.47), line, bevel=0)
# Back and side boards with the MABAR name
board = mat('#1f3f8a', rough=0.5)
for y in (-L - 6.5, L + 6.5):
    g.box((WD * 2 + 9, 0.2, 1.0), (0, y, 0.5), board, bevel=0.05)
    for xx in (-6, 0, 6):
        g.text('MABAR', 0.62, (xx, y - 0.11 * (1 if y > 0 else -1), 0.52), mat('#ffffff'), depth=0.02,
               rot=(PI / 2, 0, 0 if y > 0 else PI))
for x in (-WD - 4.6, WD + 4.6):
    g.box((0.2, L * 2 + 13, 1.0), (x, 0, 0.5), mat('#2f7dff', rough=0.5), bevel=0.05)
# Stands on all four sides
crowd(g, -WD - 4.5, WD + 4.5, L + 7.2, 0.2, facing_y=-1, rows=7, rng=rng)
crowd(g, -WD - 4.5, WD + 4.5, -L - 7.2, 0.2, facing_y=1, rows=7, rng=rng)
for sign in (-1, 1):
    # side stands: build along X then rotate by swapping axes via a helper Geo
    sg = Geo()
    crowd(sg, -L - 6, L + 6, 0, 0.2, facing_y=-1, rows=6, rng=rng)
    sg.build(f'stand_side_{sign}', None, loc=(sign * (WD + 5.4), 0, 0), rot=(0, 0, PI / 2 * sign))
# Umpire chair (side, at the net)
ux = WD + 2.2
for dx in (-0.3, 0.3):
    for dy in (-0.25, 0.25):
        g.cyl(0.04, 1.9, (ux + dx, dy, 0.95), mat('#ffffff'), seg=8)
g.box((0.8, 0.7, 0.1), (ux, 0, 1.92), mat('#ffffff'), bevel=0.03)
g.box((0.1, 0.7, 0.6), (ux + 0.38, 0, 2.25), mat('#ffffff'), bevel=0.03)
g.cyl(0.03, 1.4, (ux + 0.2, 0.3, 2.6), mat('#ffffff'), seg=8)
for i in range(8):
    g.cone(0.9, 0.4, (ux + 0.2, 0.3, 3.35), mat('#2f7dff' if i % 2 else '#ffffff'), seg=3, rot=(0, 0, i / 8 * TAU))
# Scoreboards behind each end
for y, rotz in ((L + 15, 0), (-L - 15, PI)):
    g.box((0.3, 0.3, 6), (-4, y, 3), mat('#2d3340'), bevel=0.04)
    g.box((0.3, 0.3, 6), (4, y, 3), mat('#2d3340'), bevel=0.04)
    g.box((10, 0.5, 3.4), (0, y, 7), mat('#24334f'), bevel=0.15)
    g.box((9.2, 0.1, 2.6), (0, y - 0.26 * (1 if y > 0 else -1), 7), glow('#2b4c8c', 0.6), bevel=0.05)
# Light towers
for x in (-WD - 9, WD + 9):
    for y in (-L - 9, L + 9):
        g.cyl(0.2, 13, (x, y, 6.5), mat('#c9ced6', metal=0.4, rough=0.35), seg=10)
        g.box((2.4, 0.5, 1.4), (x, y, 13.2), mat('#2d3340'), bevel=0.06)
        for i in range(3):
            for j in range(2):
                g.box((0.6, 0.12, 0.5), (x - 0.75 + i * 0.75, y - 0.27 * (1 if y > 0 else -1), 12.9 + j * 0.6),
                      glow('#fff3c4', 4), bevel=0.04)
# Trees, bushes outside the stadium
for i in range(22):
    a = rng.random() * TAU
    d = 27 + rng.random() * 10
    x, y = math.cos(a) * d * 0.75, math.sin(a) * d
    tree(g, (x, y, 0), 9 + rng.random() * 5, rng) if rng.random() < 0.6 else pine(g, (x, y, 0), 10 + rng.random() * 6)
for (x, y) in ((-WD - 3.2, -L - 3), (WD + 3.2, -L - 3), (-WD - 3.2, L + 3), (WD + 3.2, L + 3)):
    bush(g, (x, y, 0.04), 4)
# Bench + ball baskets courtside
for sign in (-1, 1):
    g.box((2.2, 0.5, 0.12), (-(WD + 2.6), sign * 2.2, 0.48), mat('#ff9f43'), bevel=0.04)
    for dx in (-0.9, 0.9):
        g.box((0.12, 0.45, 0.45), (-(WD + 2.6) + dx, sign * 2.2, 0.22), mat('#c47a2c'), bevel=0.02)
    g.box((0.6, 0.45, 0.5), (WD + 2.6, sign * 6, 0.25), mat('#3a3f4a'), bevel=0.05)
    for i in range(6):
        g.sphere(0.1, (WD + 2.45 + (i % 3) * 0.15, sign * 6 - 0.1 + (i // 3) * 0.2, 0.55), mat('#d7f53b'), seg=10)
g.build('tennis_stadium')
export('tennis_court.glb')


# ======================================================================
# Table tennis hall (table: 2.74 x 1.525 x 0.76)
# ======================================================================
reset()
rng = random.Random(5)
g = Geo()
TL, TW, TH = 2.74 / 2, 1.525 / 2, 0.76
g.box((22, 30, 0.2), (0, 0, -0.1), mat('#e9a35f'), bevel=0)                  # wooden floor
for i in range(-10, 11):
    g.box((0.02, 30, 0.004), (i * 1.0, 0, 0.002), mat('#d38e4c'), bevel=0)     # plank lines
g.rbox((7.0, 12.0, 0.02), (0, 0, 0.01), mat('#e84a5f'), radius=0.3, bevel=0.005)  # play-area mat
# Barriers around the play area
bar_m = mat('#7c4dff', rough=0.45)
for (cx, cy, w, d) in ((0, 6.0, 7.0, 0.12), (0, -6.0, 7.0, 0.12), (3.5, 0, 0.12, 12.0), (-3.5, 0, 0.12, 12.0)):
    g.box((w, d, 0.7), (cx, cy, 0.35), bar_m, bevel=0.04)
for y in (6.0, -6.0):
    for xx in (-2, 2):
        g.text('PING PONG', 0.32, (xx, y - 0.07 * (1 if y > 0 else -1), 0.38), mat('#ffffff'), depth=0.01,
               rot=(PI / 2, 0, 0 if y > 0 else PI))
# Table
top = mat('#1f5fd1', rough=0.4)
g.box((TW * 2, TL * 2, 0.04), (0, 0, TH - 0.02), top, bevel=0.012)
for x in (-TW + 0.012, TW - 0.012):
    g.box((0.02, TL * 2, 0.003), (x, 0, TH + 0.002), mat('#ffffff'), bevel=0)
for y in (-TL + 0.012, TL - 0.012):
    g.box((TW * 2, 0.02, 0.003), (0, y, TH + 0.002), mat('#ffffff'), bevel=0)
g.box((0.006, TL * 2, 0.003), (0, 0, TH + 0.002), mat('#ffffff'), bevel=0)
for x in (-TW + 0.15, TW - 0.15):
    for y in (-TL + 0.35, TL - 0.35):
        g.box((0.06, 0.06, TH - 0.04), (x, y, (TH - 0.04) / 2), mat('#2d3340'), bevel=0.01)
    g.box((0.05, TL * 2 - 0.8, 0.05), (x, 0, 0.2), mat('#2d3340'), bevel=0.01)
g.box((TW * 2 + 0.3, 0.012, 0.15), (0, 0, TH + 0.075), mat('#f6f2e6', rough=0.95), bevel=0.002)
g.box((TW * 2 + 0.3, 0.02, 0.02), (0, 0, TH + 0.155), mat('#ffffff'), bevel=0.004)
for x in (-TW - 0.15, TW + 0.15):
    g.box((0.04, 0.06, 0.18), (x, 0, TH + 0.08), mat('#2d3340'), bevel=0.008)
# Walls with windows and banners
wall_m = mat('#b794f6')
for y in (15, -15):
    g.box((22, 0.3, 4.5), (0, y, 2.25), wall_m, bevel=0.05)
    for i in range(5):
        g.box((2.6, 0.1, 1.6), (-8 + i * 4, y - 0.18 * (1 if y > 0 else -1), 2.6), mat('#d6f0ff', rough=0.15), bevel=0.04)
for x in (11, -11):
    g.box((0.3, 30, 4.5), (x, 0, 2.25), wall_m, bevel=0.05)
    for i, c in enumerate(('#ffd32a', '#2ed573', '#ff6b81', '#4bcffa')):
        g.box((0.1, 2.2, 1.4), (x - 0.18 * (1 if x > 0 else -1), -9 + i * 6, 2.8), mat(c), bevel=0.06)
# Scoreboard (flip) and umpire table at the side
g.box((1.2, 0.6, 0.75), (4.6, 0, 0.375), mat('#ff9f43'), bevel=0.04)
g.box((0.5, 0.12, 0.45), (4.4, -0.15, 1.0), mat('#ffffff'), bevel=0.02, rot=(0, 0, PI / 2))
g.box((0.5, 0.12, 0.45), (4.4, 0.35, 1.0), mat('#ffffff'), bevel=0.02, rot=(0, 0, PI / 2))
# Benches, bottles, plants, ball boxes
for sign in (-1, 1):
    g.box((0.5, 2.6, 0.1), (-4.6, sign * 3.5, 0.45), mat('#4bcffa'), bevel=0.03)
    for dy in (-1.1, 1.1):
        g.box((0.45, 0.12, 0.42), (-4.6, sign * 3.5 + dy, 0.21), mat('#2d3340'), bevel=0.02)
    for i, c in enumerate(('#36d1dc', '#ff6b81')):
        g.cyl(0.05, 0.24, (-4.55, sign * 3.5 - 0.6 + i * 0.2, 0.62), mat(c, rough=0.2), seg=12)
    g.box((0.5, 0.4, 0.35), (3.0, sign * 5.3, 0.175), mat('#ffb020'), bevel=0.04)
for (x, y) in ((-9.5, 13.5), (9.5, 13.5), (-9.5, -13.5), (9.5, -13.5), (-9.5, 0), (9.5, 0)):
    g.cyl(0.35, 0.6, (x, y, 0.3), mat('#ff7f50'), seg=16, r2=0.28)
    bush(g, (x, y, 0.5), 3.5)
g.build('tt_hall')
# A few spectators on the benches
for i, (y, col) in enumerate(((-3.0, '#ff6b81'), (-4.2, '#ffd32a'), (3.2, '#70a1ff'), (4.4, '#7bed9f'))):
    fan = Chibi(f'tt_fan{i}', None, (-4.75, y, 0.5), face=-PI / 2, shirt=col, s=2.6, rng=rng)
    fan.legL.rotation_euler = (-1.4, 0, 0)
    fan.legR.rotation_euler = (-1.4, 0, 0)
    fan.armL.rotation_euler = (-0.6, 0, -0.2)
    fan.armR.rotation_euler = (-0.6, 0, 0.2)
export('tt_hall.glb')

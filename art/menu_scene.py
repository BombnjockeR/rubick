"""Builds the main-menu diorama and exports assets/menu.glb.

    python art/menu_scene.py assets/menu.glb [preview.png]

Four platforms step down a terrace (Blender Z-up; glTF converts to Y-up):
  plat_tennis, plat_tt, plat_cook, plat_soon  (empties the menu lifts/highlights)
  rim_*                                       (rim meshes, own material for glow)
One looping animation clip (LOOP frames @ 30fps) drives every character.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from rlib import (Geo, Chibi, mat, glow, empty, key, smooth, bounce_arc, tree, pine, bush,  # noqa: E402
                  lamp, fence, crate, traffic_cone, racket, knife, pan, hammer, reset, TAU)

args = [a for a in sys.argv[1:] if not a.startswith('-')]
OUT_GLB = args[0] if args else 'menu.glb'
PREVIEW = args[1] if len(args) > 1 else None

rng = random.Random(7)
reset()
LOOP = 96  # 3.2 s
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 0, LOOP

PI = math.pi
CREAM, CREAM_D, CREAM_L = '#f6eddf', '#e7d9c3', '#fbf6ee'

# Platform layout: (key, world xy, top z, rim color, floor color)
PLATS = [
    ('tennis', (1.9, 6.4), 1.5, '#2f7dff', '#5cc24f'),
    ('tt', (0.6, 2.2), 1.0, '#8b5cf6', '#f2b36b'),
    ('cook', (-0.7, -2.0), 0.5, '#ff4b3e', '#fff4e2'),
    ('soon', (-2.0, -6.2), 0.0, '#b9b1a4', '#ece4d6'),
]
PW, PD = 4.4, 3.1          # platform footprint
GROUND = -1.4


def platform(keyname, xy, top, rim, floor):
    root = empty(f'plat_{keyname}', loc=(xy[0], xy[1], top))
    g = Geo()
    g.rbox((PW + 0.3, PD + 0.3, 0.32), (0, 0, -0.36), mat(CREAM), radius=0.55, bevel=0.04)
    g.rbox((PW - 0.1, PD - 0.1, 0.05), (0, 0, -0.025), mat(floor), radius=0.42, bevel=0.015)
    base = g.build(f'base_{keyname}', root)
    r = Geo()
    r.rbox((PW + 0.12, PD + 0.12, 0.17), (0, 0, -0.12), mat(rim, rough=0.45, name=f'rim_{keyname}'),
           radius=0.5, bevel=0.03)
    r.build(f'rim_{keyname}', root)
    return root, base


# ======================================================================
# Environment: terraces, stairs, lamps, city, clouds
# ======================================================================
env = Geo()     # terraces, stairs, lamps: the floating island itself
city = Geo()    # ground + distant blocks (the landing page hides these)
sky = Geo()     # clouds
city.box((80, 80, 0.2), (0, 0, GROUND - 0.1), mat('#f3ece1'), bevel=0)
for (k, (x, y), top, *_r) in PLATS:
    h = top - 0.52 - GROUND
    env.rbox((PW + 1.3, PD + 1.0, h), (x + 0.25, y, GROUND + h / 2), mat(CREAM_D), radius=0.7, bevel=0.05)
    env.rbox((PW + 1.1, PD + 0.8, 0.06), (x + 0.25, y, top - 0.52 + 0.03), mat(CREAM_L), radius=0.65, bevel=0.02)
# Stairs on the right side between terraces
for i in range(len(PLATS) - 1):
    (_, (x0, y0), t0, *_a), (_, (x1, y1), t1, *_b) = PLATS[i], PLATS[i + 1]
    n = 6
    for s in range(n):
        f = (s + 0.5) / n
        x = x0 + (x1 - x0) * f + 2.75
        y = y0 + (y1 - y0) * f
        z = (t0 - 0.52) + ((t1 - 0.52) - (t0 - 0.52)) * f
        env.box((0.75, 0.42, 0.08), (x, y, z - 0.04), mat(CREAM_L), bevel=0.015)
    fence(env, (x0 + 3.15, y0 - 1.3), (x1 + 3.15, y1 + 1.3), min(t0, t1) - 0.52, color='#c9925a')
# Lamps, bushes, pines on the terrace edges
for i, (k, (x, y), top, *_r) in enumerate(PLATS):
    z = top - 0.46
    lamp(env, (x + 2.75, y - 1.75, z), 0.85)
    lamp(env, (x - 2.45, y + 1.6, z), 0.75)
    pine(env, (x - 2.55, y - 1.4, z), 1.2)
    bush(env, (x + 2.85, y + 1.6, z), 1.4)
    bush(env, (x - 2.6, y + 0.3, z), 1.1)
    tree(env, (x + 2.95, y + 0.9, z), 1.3, rng)

# Distant city blocks (soft, cream) and clouds
for i in range(60):
    a = rng.random() * TAU
    d = 12 + rng.random() * 14
    x, y = math.cos(a) * d + 1, math.sin(a) * d
    # keep the view toward the camera (front-right, -Y/+X) clear
    if x > 2 and y < 2:
        continue
    w, dd, h = 1 + rng.random() * 1.6, 1 + rng.random() * 1.6, 0.4 + rng.random() * 1.4
    city.box((w, dd, h), (x, y, GROUND + h / 2), mat(rng.choice([CREAM, CREAM_D, CREAM_L])), bevel=0.06, seg=1)
    if rng.random() < 0.4:
        city.box((w * 0.5, dd * 0.5, 0.3), (x, y, GROUND + h + 0.15), mat(CREAM_L), bevel=0.04)
    if rng.random() < 0.35:
        tree(city, (x + w * 0.6, y, GROUND), 1.6, rng)
cloud_m = mat('#ffffff', rough=0.9, emit=('#fff8ee', 0.35), name='cloud')
for cx, cy, cz, s in ((-10, 4, 1.2, 1.5), (-9, -8, 0.8, 1.3), (4, 15, 1.6, 1.8), (-6, 14, 1.4, 1.6), (12, 10, 1.0, 1.4),
                      (-13, -1, 1.0, 1.2)):
    for j in range(7):
        sky.sphere((0.5 + rng.random() * 0.5) * s, (cx + (rng.random() - 0.5) * 2.6 * s, cy + (rng.random() - 0.5) * 1.0 * s,
                                                    cz + rng.random() * 0.35 * s), cloud_m, scale=(1, 1, 0.65), seg=14)
env.build('environment')
city.build('env_city')
sky.build('env_clouds')


# ======================================================================
# 01 TENNIS
# ======================================================================
root, _ = platform('tennis', *PLATS[0][1:])
g = Geo()
CW, CD = 3.1, 1.5
line = mat('#ffffff', rough=0.5)
g.rbox((CW + 0.45, CD + 0.45, 0.02), (0, 0, 0.01), mat('#3da64a'), radius=0.08, bevel=0.005)
g.box((CW, CD, 0.022), (0, 0, 0.012), mat('#4cc35a'), bevel=0.0)
for yy in (-CD / 2, CD / 2, -CD / 2 + 0.17, CD / 2 - 0.17):
    g.box((CW, 0.025, 0.004), (0, yy, 0.025), line, bevel=0)
for xx in (-CW / 2, CW / 2):
    g.box((0.025, CD, 0.004), (xx, 0, 0.025), line, bevel=0)
for xx in (-0.8, 0.8):
    g.box((0.025, CD - 0.34, 0.004), (xx, 0, 0.025), line, bevel=0)
g.box((1.6, 0.025, 0.004), (0, 0, 0.025), line, bevel=0)
# Net
for yy in (-CD / 2 - 0.1, CD / 2 + 0.1):
    g.cyl(0.022, 0.3, (0, yy, 0.15), mat('#2d3340'), seg=10)
g.box((0.012, CD + 0.2, 0.2), (0, 0, 0.12), mat('#30343f', rough=0.95), bevel=0)
g.box((0.024, CD + 0.2, 0.03), (0, 0, 0.225), line, bevel=0.005)
# Umpire chair + umbrella (back side, +Y)
ux, uy = 0.0, 1.15
for dx in (-0.09, 0.09):
    for dy in (-0.07, 0.07):
        g.cyl(0.014, 0.52, (ux + dx, uy + dy, 0.26), mat('#ffffff'), seg=8)
g.box((0.26, 0.2, 0.04), (ux, uy, 0.53), mat('#ffffff'), bevel=0.01)
g.box((0.26, 0.03, 0.18), (ux, uy + 0.1, 0.63), mat('#ffffff'), bevel=0.01)
g.cyl(0.012, 0.55, (ux + 0.16, uy + 0.12, 0.8), mat('#ffffff'), seg=8)
for i in range(8):
    a = i / 8 * TAU
    g.cone(0.3, 0.13, (ux + 0.16, uy + 0.12, 1.1), mat('#2f7dff' if i % 2 else '#ffffff'), seg=3,
           rot=(0, 0, a))
# Scoreboard
g.box((0.05, 0.05, 0.55), (-1.4, 1.35, 0.27), mat('#2d3340'), bevel=0.008)
g.box((0.05, 0.05, 0.55), (-1.0, 1.35, 0.27), mat('#2d3340'), bevel=0.008)
g.box((0.55, 0.08, 0.34), (-1.2, 1.35, 0.68), mat('#24334f'), bevel=0.02)
g.text('2  1', 0.2, (-1.2, 1.3, 0.66), glow('#ffd54a', 2.5), depth=0.01)
# Spectator seats (green) on a little stand
g.box((1.9, 0.5, 0.1), (0.55, 1.3, 0.05), mat(CREAM_L), bevel=0.02)
for i in range(7):
    x = -0.25 + i * 0.27
    g.box((0.2, 0.17, 0.05), (x, 1.25, 0.14), mat('#2ecc71'), bevel=0.02)
    g.box((0.2, 0.04, 0.17), (x, 1.36, 0.23), mat('#27ae60'), bevel=0.02)
# Lights, flags, props
lamp(g, (-2.0, 1.35, 0), 1.0)
lamp(g, (2.0, 1.35, 0), 1.0)
for (x, y) in ((-2.05, -0.6), (2.05, 0.6)):
    g.cyl(0.015, 0.85, (x, y, 0.42), mat('#ffffff'), seg=8)
    g.box((0.02, 0.24, 0.36), (x, y + 0.13, 0.66), mat('#2f7dff'), bevel=0.01)
    g.sphere(0.06, (x + 0.012, y + 0.13, 0.66), mat('#ffffff'), scale=(0.3, 1, 1), seg=12)
g.box((0.42, 0.13, 0.04), (1.35, -1.3, 0.16), mat('#c98a4b'), bevel=0.012)
for dx in (-0.17, 0.17):
    g.box((0.035, 0.1, 0.14), (1.35 + dx, -1.3, 0.07), mat('#8a5a34'), bevel=0.006)
g.box((0.24, 0.18, 0.16), (-1.55, -1.25, 0.08), mat('#3a3f4a'), bevel=0.02)
for i in range(9):
    g.sphere(0.04, (-1.62 + (i % 3) * 0.07, -1.3 + (i // 3) * 0.05, 0.19), mat('#d7f53b'), seg=10)
g.box((0.2, 0.2, 0.12), (1.85, -1.1, 0.06), mat('#e9edf2'), bevel=0.02)
g.box((0.2, 0.2, 0.06), (1.85, -1.1, 0.15), mat('#ff4757'), bevel=0.02)
tree(g, (-2.0, -1.3, 0), 1.0, rng)
tree(g, (2.05, -1.35, 0), 0.9, rng)
bush(g, (-1.8, 1.2, 0), 1.0)
g.build('tennis_props', root)

# Players + animation
pA = Chibi('tn_A', root, (-1.65, 0, 0), face=-PI / 2, shirt='#ffffff', shorts='#2f7dff', hair='#4a2c1d', hat='band', s=1.5, rng=rng)
pB = Chibi('tn_B', root, (1.65, 0, 0), face=PI / 2, shirt='#1f3f8a', shorts='#ffffff', hair='#2b1d16', hat='cap', s=1.5, rng=rng)
racket(pA.socket, 'tn_A_racket', '#ff4757')
racket(pB.socket, 'tn_B_racket', '#ffb020')
ump = Chibi('tn_ump', root, (ux, uy - 0.02, 0.55), face=0, shirt='#2f7dff', shorts='#2d3340', hair='#3a3a46', s=1.15, rng=rng)
fans = [Chibi(f'tn_fan{i}', root, (-0.25 + i * 0.27 * 2, 1.25, 0.15), face=0, shirt=c, shorts='#2d3340', s=0.75, rng=rng)
        for i, c in enumerate(['#ff6b81', '#ffd32a', '#7bed9f', '#70a1ff'])]
for fan in fans:
    fan.root.scale = (1.0, 1.0, 1.0)
ball = Geo().sphere(0.035, (0, 0, 0), glow('#d7f53b', 0.6), seg=14).build('tn_ball', root)


def swing_curve(f, hit, back=12, follow=10):
    """Forehand: 0 rest, rises to backswing, whips through at `hit`."""
    d = f - hit
    if -back <= d < -3:
        return -smooth((d + back) / (back - 3))          # 0 -> -1 (backswing)
    if -3 <= d < 3:
        return -1 + 2 * smooth((d + 3) / 6)               # -1 -> +1 (whip)
    if 3 <= d < 3 + follow:
        return 1 - smooth((d - 3) / follow)               # +1 -> 0 (recover)
    return 0.0


def wrap(f, hit):
    # distance in the loop, choosing the nearest copy of `hit`
    best = None
    for h in (hit - LOOP, hit, hit + LOOP):
        if best is None or abs(f - h) < abs(f - best):
            best = h
    return best


def arm_swing(arm, f, hit, side=1):
    s = swing_curve(f, wrap(f, hit))
    rx = -0.55 - 0.9 * abs(s)
    rz = side * (-1.2 * s)
    key(arm, f, rot=(rx, 0, rz))


H = LOOP // 2
for f in range(LOOP + 1):
    t = f / LOOP
    # Ball: A hits at 0, B at H. Each shot bounces at 62% of the flight.
    if f <= H:
        s = f / H
        x0, x1, y0, y1 = -1.45, 1.45, -0.32, 0.35
    else:
        s = (f - H) / H
        x0, x1, y0, y1 = 1.45, -1.45, 0.35, -0.32
    bx = x0 + (x1 - x0) * s
    by = y0 + (y1 - y0) * s
    bz = 0.04 + bounce_arc(s, 0.42, 0.42, 0.5, 0.62)
    key(ball, f, loc=(bx, by, bz))
    # Players glide to meet the ball, with a small run bounce
    ay = -0.16 - 0.16 * math.cos(TAU * t)
    byy = 0.175 + 0.175 * math.cos(TAU * (t - 0.5))
    hop = 0.012 * abs(math.sin(TAU * t * 4))
    key(pA.root, f, loc=(-1.75, ay - 0.15, hop))
    key(pB.root, f, loc=(1.75, byy + 0.15, hop))
    for p, ph in ((pA, 0), (pB, 0.5)):
        leg = 0.35 * math.sin(TAU * (t * 4 + ph))
        key(p.legL, f, rot=(leg, 0, 0))
        key(p.legR, f, rot=(-leg, 0, 0))
        key(p.armL, f, rot=(-0.4, 0, -0.35 * (1 if p is pA else -1)))
    arm_swing(pA.armR, f, 0, side=1)
    arm_swing(pB.armR, f, H, side=1)
    # Umpire and fans watch the ball
    look = max(-1.0, min(1.0, bx * 0.45))
    key(ump.head, f, rot=(0.15, 0, look))
    for i, fan in enumerate(fans):
        key(fan.head, f, rot=(0.1, 0, look * 0.9 + 0.05 * math.sin(TAU * t * 2 + i)))
        key(fan.root, f, loc=(fan.root.location.x, 1.25, 0.15 + 0.015 * abs(math.sin(TAU * t * 2 + i))))
        key(fan.armL, f, rot=(-0.2 - 0.25 * (math.sin(TAU * t * 2 + i) > 0.6), 0, -0.2))
        key(fan.armR, f, rot=(-0.2, 0, 0.2))
    key(ump.armL, f, rot=(-1.0, 0, 0))
    key(ump.armR, f, rot=(-1.0, 0, 0))
    key(ump.legL, f, rot=(-1.4, 0, 0))
    key(ump.legR, f, rot=(-1.4, 0, 0))


# ======================================================================
# 02 TABLE TENNIS
# ======================================================================
root, _ = platform('tt', *PLATS[1][1:])
g = Geo()
# Back wall with window strips and a banner
g.rbox((PW - 0.5, 0.14, 0.75), (0, PD / 2 - 0.2, 0.37), mat('#b794f6'), radius=0.06, bevel=0.02)
for i in range(4):
    g.box((0.6, 0.02, 0.32), (-1.35 + i * 0.9, PD / 2 - 0.28, 0.45), mat('#d6f0ff', rough=0.15), bevel=0.01)
g.box((1.3, 0.03, 0.2), (0, PD / 2 - 0.3, 0.86), mat('#ffd32a'), bevel=0.02)
g.text('PING PONG', 0.11, (0, PD / 2 - 0.32, 0.86), mat('#5b2bd6'), depth=0.008)
# Mat + table
g.rbox((2.9, 1.7, 0.02), (0, -0.05, 0.01), mat('#5b8def'), radius=0.1, bevel=0.005)
TL, TW, TZ = 1.5, 0.84, 0.24
g.box((TL, TW, 0.035), (0, -0.05, TZ), mat('#1f5fd1', rough=0.4), bevel=0.008)
g.box((TL, 0.012, 0.003), (0, -0.05, TZ + 0.019), mat('#ffffff'), bevel=0)
for yy in (-0.05 - TW / 2 + 0.01, -0.05 + TW / 2 - 0.01):
    g.box((TL, 0.016, 0.004), (0, yy, TZ + 0.019), mat('#ffffff'), bevel=0)
for xx in (-TL / 2 + 0.01, TL / 2 - 0.01):
    g.box((0.016, TW, 0.004), (xx, -0.05, TZ + 0.019), mat('#ffffff'), bevel=0)
for xx in (-0.55, 0.55):
    for yy in (-0.35, 0.25):
        g.box((0.04, 0.04, TZ - 0.02), (xx, yy, (TZ - 0.02) / 2), mat('#2d3340'), bevel=0.006)
g.box((0.015, TW + 0.1, 0.09), (0, -0.05, TZ + 0.06), mat('#f6f2e6', rough=0.95), bevel=0.003)
g.box((0.02, TW + 0.1, 0.014), (0, -0.05, TZ + 0.105), mat('#ffffff'), bevel=0.003)
# Flip scoreboard, bench, bottles, ball box, plants
g.box((0.3, 0.14, 0.03), (-1.75, -0.2, 0.32), mat('#2d3340'), bevel=0.008)
for dx in (-0.1, 0.1):
    g.cyl(0.012, 0.32, (-1.75 + dx, -0.2, 0.16), mat('#2d3340'), seg=8)
g.box((0.13, 0.03, 0.16), (-1.82, -0.28, 0.43), mat('#ffffff'), bevel=0.01, rot=(0.2, 0, 0))
g.box((0.13, 0.03, 0.16), (-1.67, -0.28, 0.43), mat('#ffffff'), bevel=0.01, rot=(0.2, 0, 0))
g.text('3', 0.12, (-1.82, -0.302, 0.43), mat('#e63946'), depth=0.005, rot=(PI / 2 + 0.2, 0, 0))
g.text('2', 0.12, (-1.67, -0.302, 0.43), mat('#1f5fd1'), depth=0.005, rot=(PI / 2 + 0.2, 0, 0))
g.box((0.9, 0.18, 0.05), (0.9, 1.05, 0.17), mat('#ff9f43'), bevel=0.015)
for dx in (-0.36, 0.36):
    g.box((0.04, 0.14, 0.15), (0.9 + dx, 1.05, 0.075), mat('#c47a2c'), bevel=0.006)
for i, c in enumerate(('#36d1dc', '#ff6b81', '#7bed9f')):
    g.cyl(0.025, 0.11, (0.6 + i * 0.12, 1.05, 0.25), mat(c, rough=0.2), seg=12)
    g.cyl(0.015, 0.025, (0.6 + i * 0.12, 1.05, 0.315), mat('#ffffff'), seg=10)
g.box((0.22, 0.18, 0.12), (1.85, -1.15, 0.06), mat('#ffb020'), bevel=0.02)
for i in range(6):
    g.sphere(0.028, (1.78 + (i % 3) * 0.07, -1.18 + (i // 3) * 0.06, 0.13), mat('#ffffff'), seg=10)
for (x, y) in ((-1.95, 1.1), (1.95, 1.05)):
    g.cyl(0.09, 0.14, (x, y, 0.07), mat('#ff7f50'), seg=14, r2=0.07)
    bush(g, (x, y, 0.12), 1.0)
tree(g, (-1.95, -1.25, 0), 0.85, rng)
g.build('tt_props', root)

tA = Chibi('tt_A', root, (-1.0, -0.05, 0), face=-PI / 2, shirt='#ff4757', shorts='#2d3340', hair='#7a4a2a', s=1.45, rng=rng)
tB = Chibi('tt_B', root, (1.0, -0.05, 0), face=PI / 2, shirt='#2ed573', shorts='#2d3340', hair='#2b1d16', hat='band', s=1.45, rng=rng)
racket(tA.socket, 'tt_A_paddle', tennis=False)
racket(tB.socket, 'tt_B_paddle', tennis=False)
coach = Chibi('tt_coach', root, (-0.9, 0.95, 0.0), face=0.3, shirt='#ffd32a', shorts='#2d3340', s=1.2, rng=rng)
tball = Geo().sphere(0.022, (0, 0, 0), glow('#ffffff', 0.4), seg=12).build('tt_ball', root)
Q = LOOP // 4   # 4 shots per loop
for f in range(LOOP + 1):
    t = f / LOOP
    shot = min(3, f // Q)
    s = (f - shot * Q) / Q
    fwd = shot % 2 == 0
    x0, x1 = (-0.85, 0.85) if fwd else (0.85, -0.85)
    ys = [-0.18, 0.1, -0.05, 0.15, -0.18]
    y0, y1 = ys[shot], ys[shot + 1]
    key(tball, f, loc=(x0 + (x1 - x0) * s, -0.05 + y0 + (y1 - y0) * s,
                       TZ + 0.03 + bounce_arc(s, 0.12, 0.12, 0.13, 0.58)))
    for p, base_x, hits, yi in ((tA, -1.12, (0, 2 * Q), 0), (tB, 1.12, (Q, 3 * Q), 1)):
        yy = -0.05 + 0.12 * math.sin(TAU * (t * 2 + yi * 0.25))
        key(p.root, f, loc=(base_x, yy, 0.008 * abs(math.sin(TAU * t * 8))))
        sw = sum(swing_curve(f, wrap(f, h), back=8, follow=7) for h in hits)
        key(p.armR, f, rot=(-1.0 - 0.5 * abs(sw), 0, -1.1 * sw))
        key(p.armL, f, rot=(-0.5, 0, -0.3 if p is tA else 0.3))
        leg = 0.2 * math.sin(TAU * t * 8 + yi)
        key(p.legL, f, rot=(leg, 0, 0))
        key(p.legR, f, rot=(-leg, 0, 0))
    # coach claps
    clap = 0.25 * (1 + math.sin(TAU * t * 6))
    key(coach.armL, f, rot=(-1.2, 0, -0.6 + clap))
    key(coach.armR, f, rot=(-1.2, 0, 0.6 - clap))
    key(coach.head, f, rot=(0.1, 0, 0.6 * math.sin(TAU * t * 2)))


# ======================================================================
# 03 COOKING
# ======================================================================
root, _ = platform('cook', *PLATS[2][1:])
g = Geo()
for i in range(10):
    for j in range(7):
        if (i + j) % 2:
            g.box((0.38, 0.38, 0.006), (-1.71 + i * 0.38, -1.14 + j * 0.38, 0.003), mat('#ffd7a8'), bevel=0)
wood, steel = mat('#d9965a'), mat('#cfd6df', rough=0.3, metal=0.5)
# Back counter row with shelves
g.box((2.6, 0.45, 0.32), (-0.55, 1.15, 0.16), wood, bevel=0.02)
g.box((2.66, 0.5, 0.04), (-0.55, 1.15, 0.34), mat('#f3f0ea'), bevel=0.012)
for i in range(3):
    g.box((0.6, 0.02, 0.01), (-1.4 + i * 0.85, 1.32, 0.15), mat('#8a5a34'), bevel=0)
g.box((2.6, 0.18, 0.03), (-0.55, 1.28, 0.75), wood, bevel=0.01)
g.box((2.6, 0.18, 0.03), (-0.55, 1.28, 0.98), wood, bevel=0.01)
for i in range(6):
    g.cyl(0.07, 0.025, (-1.6 + i * 0.4, 1.28, 0.78), mat('#ffffff'), seg=16)
    g.cyl(0.06, 0.1, (-1.55 + i * 0.4, 1.28, 1.04), mat(['#ff6b6b', '#4bcffa', '#ffd32a'][i % 3], rough=0.35), seg=14)
# Stove + pot with lid (left)
g.box((0.55, 0.45, 0.33), (-1.55, 1.15, 0.165), mat('#3a3f4a'), bevel=0.02)
g.cyl(0.13, 0.15, (-1.55, 1.12, 0.42), steel, seg=20)
g.cyl(0.135, 0.015, (-1.55, 1.12, 0.5), steel, seg=20)
for dx in (-0.12, 0.12):
    g.cyl(0.05, 0.005, (-1.55 + dx, 0.98, 0.33), glow('#ff6b3d', 2.5), seg=12)
# Fridge (back right)
g.rbox((0.5, 0.42, 0.95), (1.55, 1.1, 0.475), mat('#ff4b3e', rough=0.35), radius=0.1, bevel=0.04)
g.box((0.02, 0.02, 0.3), (1.37, 0.88, 0.6), mat('#ffffff'), bevel=0.005)
g.box((0.46, 0.01, 0.01), (1.55, 0.89, 0.42), mat('#c0392b'), bevel=0)
# Awning over the back-left stall
for i in range(8):
    g.box((0.32, 0.5, 0.025), (-1.85 + i * 0.32, 0.95, 1.25), mat('#ff4b3e' if i % 2 else '#ffffff'), bevel=0.008,
          rot=(-0.35, 0, 0))
for x in (-1.95, 0.55):
    g.cyl(0.02, 1.25, (x, 0.75, 0.62), mat('#8a5a34'), seg=8)
# Island counter with cutting board, veg (center)
g.box((1.1, 0.5, 0.32), (0.05, 0.0, 0.16), wood, bevel=0.02)
g.box((1.16, 0.56, 0.04), (0.05, 0.0, 0.34), mat('#f3f0ea'), bevel=0.012)
g.box((0.32, 0.22, 0.02), (-0.15, -0.05, 0.37), mat('#e8c08a'), bevel=0.006)
for i in range(3):
    g.sphere(0.04, (0.28 + i * 0.09, 0.12, 0.4), mat('#ff3b30', rough=0.3), seg=12)
    g.cone(0.02, 0.02, (0.28 + i * 0.09, 0.12, 0.445), mat('#2ecc71'), seg=6)
g.sphere(0.06, (0.32, -0.1, 0.41), mat('#7bed9f'), scale=(1, 1, 0.8), seg=12)
g.sphere(0.05, (0.45, -0.12, 0.4), mat('#ffb142'), seg=12)
for i in range(4):
    g.cyl(0.03, 0.012, (-0.12 + i * 0.04, -0.12, 0.385), mat('#ff6b6b'), seg=10, rot=(0, PI / 2, 0))
# Serving pass (front right) with plates of food
g.box((0.95, 0.4, 0.32), (1.45, -0.95, 0.16), steel, bevel=0.02)
g.box((1.0, 0.45, 0.04), (1.45, -0.95, 0.34), mat('#ffffff'), bevel=0.012)
for i, food in enumerate(('#ff7f50', '#ffd32a')):
    g.cyl(0.11, 0.015, (1.25 + i * 0.32, -0.95, 0.37), mat('#ffffff'), seg=18)
    g.sphere(0.07, (1.25 + i * 0.32, -0.95, 0.39), mat(food), scale=(1, 1, 0.55), seg=14)
    g.sphere(0.02, (1.27 + i * 0.32, -0.97, 0.43), mat('#2ecc71'), seg=8)
g.box((0.28, 0.04, 0.34), (2.0, -0.45, 0.37), mat('#2d3340'), bevel=0.02, rot=(0, 0, -0.4))
g.cyl(0.07, 0.04, (2.0, -0.48, 0.42), mat('#ffffff'), seg=16, rot=(PI / 2, 0, -0.4))
g.sphere(0.06, (2.0, -0.48, 0.48), mat('#ffffff'), seg=12)
# Plants, cones, crates
for (x, y) in ((-2.0, -1.2), (2.0, 0.3)):
    g.cyl(0.09, 0.14, (x, y, 0.07), mat('#ff7f50'), seg=14, r2=0.07)
    bush(g, (x, y, 0.12), 1.0)
traffic_cone(g, (-1.0, -1.35, 0))
crate(g, (-1.65, -0.55, 0), 0.2, 0.3)
g.build('cook_props', root)

c1 = Chibi('ck_chop', root, (-0.15, -0.38, 0), face=0, shirt='#ffffff', shorts='#2d3340', hair='#2b1d16', outfit='chef',
           hat='chef', s=1.4, rng=rng)
c1.root.rotation_euler = (0, 0, PI)  # faces the island (+Y)
knife(c1.socket, 'ck_knife')
c2 = Chibi('ck_toss', root, (-1.0, 0.55, 0), face=PI * 0.85, shirt='#ffffff', shorts='#2d3340', hair='#7a4a2a',
           outfit='chef', hat='chef', s=1.4, rng=rng)
pan(c2.socket, 'ck_pan')
c3 = Chibi('ck_serve', root, (0.8, -0.5, 0), face=0, shirt='#ffffff', shorts='#2d3340', hair='#c58b4a', outfit='chef',
           hat='chef', s=1.4, rng=rng)
plate = Geo()
plate.cyl(0.1, 0.015, (0, -0.16, 0.2), mat('#ffffff'), seg=18)
plate.sphere(0.06, (0, -0.16, 0.22), mat('#ff7f50'), scale=(1, 1, 0.55), seg=12)
plate.build('ck_plate', c3.root)
foods = [Geo().sphere(0.022, (0, 0, 0), mat(c), seg=10).build(f'ck_food{i}', root)
         for i, c in enumerate(('#ffd32a', '#ff6b6b', '#2ecc71'))]
puffs = [Geo().sphere(0.07, (0, 0, 0), mat('#ffffff', rough=0.9, emit=('#ffffff', 0.4), name='steam'), seg=12)
         .build(f'ck_steam{i}', root) for i in range(3)]

# Path for the serving chef: island side <-> pass
P0, P1 = (0.75, -0.5), (1.35, -0.55)
for f in range(LOOP + 1):
    t = f / LOOP
    # chopping: quick down-strokes
    ch = abs(math.sin(TAU * t * 8))
    key(c1.armR, f, rot=(-1.25 + 0.55 * ch, 0, 0.15))
    key(c1.armL, f, rot=(-1.0, 0, -0.25))
    key(c1.head, f, rot=(0.25, 0, 0.05 * math.sin(TAU * t * 2)))
    # pan toss every 32 frames
    ph = (f % 32) / 32
    flick = math.sin(min(1, ph / 0.25) * PI) if ph < 0.25 else 0
    key(c2.armR, f, rot=(-1.45 + 0.35 * flick, 0, 0.25))
    key(c2.armL, f, rot=(-0.6, 0, -0.3))
    key(c2.head, f, rot=(0.2 * flick, 0, 0))
    # food pieces fly out of the pan and land back
    pan_world = (-1.0 + 0.3 * math.sin(PI * 0.85) - 0.05, 0.55 - 0.3 * math.cos(PI * 0.85) - 0.02, 0.42)
    for i, fd in enumerate(foods):
        q = ((f % 32) / 32 - 0.08 * i) % 1
        hgt = 0.22 * math.sin(min(1, q / 0.55) * PI) if q < 0.55 else 0
        key(fd, f, loc=(pan_world[0] + 0.03 * (i - 1), pan_world[1] + 0.02 * (i - 1), pan_world[2] + hgt))
    # steam from the pot
    for i, pf in enumerate(puffs):
        q = (t * 2 + i / 3) % 1
        key(pf, f, loc=(-1.55 + 0.04 * math.sin(TAU * q + i), 1.12, 0.55 + 0.45 * q),
            scale=max(0.001, math.sin(PI * q) * (0.7 + 0.5 * q)))
    # serving chef walks back and forth carrying a plate
    w = 0.5 - 0.5 * math.cos(TAU * t)
    x = P0[0] + (P1[0] - P0[0]) * w
    y = P0[1] + (P1[1] - P0[1]) * w
    going = math.sin(TAU * t) >= 0
    ang = math.atan2(P1[1] - P0[1], P1[0] - P0[0]) + PI / 2
    face = ang if going else ang + PI
    key(c3.root, f, loc=(x, y, 0.012 * abs(math.sin(TAU * t * 6))), rot=(0, 0, face))
    leg = 0.45 * math.sin(TAU * t * 6) * abs(math.sin(TAU * t))
    key(c3.legL, f, rot=(leg, 0, 0))
    key(c3.legR, f, rot=(-leg, 0, 0))
    key(c3.armL, f, rot=(-1.3, 0, 0.25))
    key(c3.armR, f, rot=(-1.3, 0, -0.25))
for o in (c1.root,):
    o.rotation_euler = (0, 0, PI)


# ======================================================================
# 04 COMING SOON
# ======================================================================
root, _ = platform('soon', *PLATS[3][1:])
g = Geo()
tarp = mat('#fbf9f5', rough=0.95)
g.sphere(0.85, (-0.2, 0.2, 0.05), tarp, scale=(1.25, 1.0, 0.75), seg=28)
for i in range(6):
    a = i / 6 * TAU
    g.sphere(0.22, (-0.2 + math.cos(a) * 0.95, 0.2 + math.sin(a) * 0.75, 0.04), tarp, scale=(1.2, 1.0, 0.4), seg=14)
g.box((0.05, 0.05, 0.5), (-0.2, -0.95, 0.25), mat('#5b6270'), bevel=0.008)
g.box((0.66, 0.08, 0.66), (-0.2, -0.98, 0.74), mat('#3d4452'), bevel=0.05, rot=(0.1, 0, 0.6))
g.text('?', 0.6, (-0.2 + 0.03, -1.03, 0.72), mat('#ffffff'), depth=0.03, rot=(PI / 2 + 0.1, 0, 0.6))
for (x, y, r) in ((0.95, -0.5, 0.2), (1.2, -0.25, 0.6), (1.05, 0.15, 1.0), (-1.4, -0.8, 0.4), (1.55, -0.85, 0.1)):
    crate(g, (x, y, 0), 0.24, r)
crate(g, (1.1, -0.38, 0.24), 0.2, 0.9)
crate(g, (-1.15, -0.95, 0), 0.22, 0.2)
for (x, y) in ((-0.9, -1.2), (0.3, -1.25), (1.9, 0.6)):
    traffic_cone(g, (x, y, 0), 1.1)
# Up-arrow sign
g.box((0.04, 0.04, 0.45), (1.9, -1.15, 0.22), mat('#5b6270'), bevel=0.006)
g.box((0.36, 0.05, 0.36), (1.9, -1.15, 0.55), mat('#3a3f4a'), bevel=0.04)
g.cone(0.1, 0.12, (1.9, -1.18, 0.6), mat('#ffffff'), seg=3, rot=(PI / 2, 0, 0))
g.box((0.06, 0.02, 0.12), (1.9, -1.18, 0.5), mat('#ffffff'), bevel=0.005)
# Fence posts with string lights
posts = [(-2.0, 1.25), (-0.8, 1.35), (0.5, 1.35), (1.8, 1.25), (2.05, 0.1)]
for (x, y) in posts:
    g.box((0.05, 0.05, 0.6), (x, y, 0.3), mat('#a8703c'), bevel=0.008)
bulb = glow('#ffd27a', 5)
for (a, b) in zip(posts, posts[1:]):
    for i in range(6):
        s = (i + 0.5) / 6
        sag = 0.12 * math.sin(PI * s)
        g.sphere(0.022, (a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, 0.57 - sag), bulb, seg=8)
fence(g, (-2.05, -1.35), (-1.0, -1.35), 0)
tree(g, (-1.9, -0.3, 0), 0.95, rng)
pine(g, (2.0, -0.45, 0), 1.0)
g.build('soon_props', root)

wk = Chibi('sn_worker', root, (0.95, -0.95, 0), face=PI * 0.75, shirt='#4bcffa', shorts='#2d3340', outfit='worker',
           hat='hard', s=1.45, rng=rng)
hammer(wk.socket, 'sn_hammer')
for f in range(LOOP + 1):
    q = (f % 24) / 24
    if q < 0.6:
        a = -0.6 - 2.0 * smooth(q / 0.6)        # wind up
    else:
        a = -2.6 + 2.0 * smooth((q - 0.6) / 0.4) ** 0.5  # strike
    key(wk.armR, f, rot=(a, 0, 0.1))
    key(wk.armL, f, rot=(-0.9, 0, -0.3))
    key(wk.head, f, rot=(0.3, 0, 0))


# ======================================================================
# Export
# ======================================================================
os.makedirs(os.path.dirname(os.path.abspath(OUT_GLB)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB', export_apply=True,
    export_animations=True, export_animation_mode='SCENE', export_frame_range=True,
    export_force_sampling=True, export_optimize_animation_size=True,
    export_lights=False, export_cameras=False, export_yup=True,
)
print('exported', OUT_GLB, os.path.getsize(OUT_GLB) // 1024, 'KB')

if PREVIEW:
    from mathutils import Vector
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 0.96, 0.9, 1)
    bpy.ops.object.light_add(type='SUN')
    sun = bpy.context.object
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(30))
    bpy.ops.object.camera_add(location=(13, -9, 11))
    cam = bpy.context.object
    sc.camera = cam
    cam.data.lens = 40
    cam.rotation_euler = (Vector((0, 0, 0.3)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.frame_set(10)
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)

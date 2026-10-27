"""Landing-page island: the "floating island game" source model cleaned up,
completed and animated for index.html.

    blender -b --factory-startup --python art/landing_island.py -- assets/landing_island.glb [preview.png]

The AI-generated model (art/source/environments/landingpage/, never modified) is
one low-poly mesh: three game islands and a plaza joined by bridges, with loose
props. What this build changes:
  removed   the plaza statue (a spike of stretched faces), two overlapping
            blimps with their loose fins and gondolas, a mooring rope, the
            windmill pole, cube "islets"
  added     rock undersides (the islands were open shells), a gold cat statue
            on a fountain, an airship with a spinning propeller, a windmill,
            mini islets, tennis and table-tennis nets, pennant strings, clouds,
            bouncing balls, steam over the stoves
  animated  one 10 s loop: the landmass, islets, balloons and airship bob and
            sway; the propeller, windmill, balls and steam move. Wind (trees,
            flags, clouds) is procedural in js/landing.js, by node name.
Output: Blender Z-up -> glTF Y-up, meters (about 24 m across), the fountain at
the origin and the plaza floor at z = 0. Node names are an API (js/landing.js):
  land (+ rocks), tree_*, islet_*, balloon_*, airship > prop, mill, statue,
  cloud_*, bunt_* (morph target "wave"), ball_*, steam_*, hot_* (hotspot anchors)
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import rig  # noqa: E402
from rlib import Geo, mat, empty, key  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'environments', 'landingpage', 'floating island game 3d model',
                   'floating_island_game_3d_model.fbx')
args = rig.script_args()
OUT = args[0] if args else 'landing_island.glb'
PREVIEW = args[1] if len(args) > 1 else None
S = 24.0        # source units -> meters (the model is 1 unit across)
LOOP = 300      # frames of the loop at 30 fps (10 s)
TAU = math.tau
rng = random.Random(11)

sc = rig.reset()
sc.frame_start, sc.frame_end = 0, LOOP

# ====================================================================== source
land = rig.load_mesh(SRC, 'land')
FC = rig.face_colors(land)                      # texture colour under each face
rig.clean_material(land, 'island', roughness=0.9)
me = land.data
P, E = rig.mesh_arrays(land)
comp = rig.components(len(P), E)
NF = len(me.polygons)
fcomp = comp[np.array([p.vertices[0] for p in me.polygons])]
fcen = np.array([p.center[:] for p in me.polygons])
fnrm = np.array([p.normal[:] for p in me.polygons])
ftop = np.array([max(P[v][2] for v in p.vertices) for p in me.polygons])
ids, counts = np.unique(comp, return_counts=True)
MAIN = int(ids[np.argmax(counts)])
pieces = {}
for cid, n in zip(ids, counts):
    vm = comp == cid
    lo, hi = P[vm].min(0), P[vm].max(0)
    fm = fcomp == cid
    pieces[int(cid)] = dict(id=int(cid), n=int(n), lo=lo, hi=hi, c=(lo + hi) / 2, s=hi - lo, fm=fm,
                            col=FC[fm].mean(0) if fm.any() else np.zeros(3))
others = [p for p in pieces.values() if p['id'] != MAIN]
LAND = [p['id'] for p in pieces.values() if p['s'].max() > 0.1]   # the landmass and the detached islets


def green(p):
    c = p['col']
    return c[1] > c[0] * 1.04 and c[1] > c[2] * 1.15


_dg = bpy.context.evaluated_depsgraph_get()


def ground_of(p, reach=0.12):
    """Component id of what a piece stands on (the first face below it that is
    not its own, probing under its centre and its four sides), or None when it
    hangs in thin air."""
    dx, dy = p['s'][0] * 0.35, p['s'][1] * 0.35
    for ox, oy in ((0, 0), (dx, 0), (-dx, 0), (0, dy), (0, -dy)):
        z = p['lo'][2] + 0.004
        for _ in range(4):
            ok, loc, nrm, idx, *_ = sc.ray_cast(_dg, Vector((p['c'][0] + ox, p['c'][1] + oy, z)), Vector((0, 0, -1)),
                                                distance=reach)
            if not ok:
                break
            if fcomp[idx] != p['id']:
                return int(fcomp[idx])
            z = loc.z - 0.001
    return None


# The plaza: its pool gives the origin, the paving around it the floor height.
up = (fcomp == MAIN) & (fnrm[:, 2] > 0.6)
r0 = np.hypot(fcen[:, 0], fcen[:, 1])
pool = up & (r0 < 0.14) & (FC[:, 2] > FC[:, 0] * 1.25) & (FC[:, 2] > FC[:, 1] * 1.05)
C0 = fcen[pool][:, :2].mean(0) if pool.sum() >= 3 else np.array([-0.04, -0.01])
rc = np.hypot(fcen[:, 0] - C0[0], fcen[:, 1] - C0[1])
plaza = up & (rc > 0.075) & (rc < 0.13)
FLOOR = float(np.median(fcen[plaza][:, 2]))
ORIGIN = np.array([C0[0], C0[1], FLOOR])
print(f'plaza: pool centre {C0.round(3)} ({int(pool.sum())} faces), floor z {FLOOR:.3f}')


def W(p):
    """Source coordinates -> meters in the output frame."""
    return Vector(((np.asarray(p, dtype=float) - ORIGIN) * S).tolist())


# ------------------------------------------------------------------ removals
kill, why = set(), {}


def remove(p, reason):
    kill.add(p['id'])
    why[p['id']] = reason


for p in others:
    c, s = p['c'], p['s']
    if c[0] < -0.345 and -0.27 < c[1] < 0.08 and c[2] > 0.09:
        remove(p, 'blimp')                       # two overlapping blimps, fins, gondolas, basket
    elif s[1] > 0.2 and s[0] < 0.02:
        remove(p, 'rope')                        # the mooring rope up to the tennis island
    elif math.hypot(c[0] + 0.335, c[1] + 0.178) < 0.05 and c[2] > 0.09:
        remove(p, 'windmill')                    # a bare pole with a floating vane
ground = {p['id']: ground_of(p) for p in others}
seeds = []                                       # cube "islets": replaced by modelled ones
for p in others:
    s = p['s']
    if (p['id'] not in kill and p['n'] <= 24 and s.min() > 0.018 and 0.026 < s.max() < 0.075
            and s.max() / s.min() < 2.6 and not green(p) and ground[p['id']] is None):
        remove(p, 'cube')
        if not any(math.hypot(*(p['c'][:2] - q['c'][:2])) < 0.06 for q in seeds):
            seeds.append(p)
seed_ids = {q['id'] for q in seeds} | {i for i in kill if why[i] == 'cube'}
for p in others:
    if p['id'] in kill or p['n'] >= 40 or p['s'].max() > 0.06 or ground[p['id']] not in (None, *seed_ids):
        continue
    for q in seeds:                              # whatever sat on a cube (a house, a sapling)
        if math.hypot(*(p['c'][:2] - q['c'][:2])) < 0.045 and -0.05 < p['c'][2] - q['c'][2] < 0.09:
            remove(p, 'on cube')
            break
spike = (fcomp == MAIN) & (rc < 0.062) & (ftop > FLOOR + 0.012)   # the broken statue
print('removed:', ', '.join(f"{why[i]} {i} ({pieces[i]['n']} v)" for i in sorted(kill)),
      f'+ {int(spike.sum())} statue faces')

pid = me.attributes.new('pid', 'INT', 'POINT')
pid.data.foreach_set('value', comp.astype(np.int32))
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[f for f in bm.faces if fcomp[f.index] in kill or spike[f.index]], context='FACES')
bm.to_mesh(me)
bm.free()


# ------------------------------------------------------------------ split-offs
def vert_pids():
    out = np.empty(len(land.data.vertices), dtype=np.int32)
    land.data.attributes['pid'].data.foreach_get('value', out)
    return out


def split(name, idset):
    return rig.split_off(land, np.isin(vert_pids(), list(idset)), name)


def bits_under(p, r=0.03):
    """Small loose pieces hanging under a piece (a balloon's basket and ropes)."""
    return [q['id'] for q in others if q['id'] not in kill and q['id'] != p['id'] and q['n'] < 40
            and math.hypot(*(q['c'][:2] - p['c'][:2])) < r and p['lo'][2] - 0.06 < q['c'][2] < p['lo'][2] + 0.02]


balloons = []
for p in [q for q in others if q['n'] == 77]:   # the three hot-air balloons
    o = split(f'balloon_{len(balloons)}', {p['id'], *bits_under(p)})
    balloons.append((o, p))
clock_ids = {p['id'] for p in others if p['id'] not in kill and p['n'] < 200
             and math.hypot(p['c'][0] - 0.055, p['c'][1] - 0.335) < 0.07 and p['c'][2] > 0.17}
clock = split('islet_clock', clock_ids)
clock_c = np.mean([pieces[i]['c'] for i in clock_ids], axis=0)
trees = []
for p in others:
    if (p['id'] not in kill and p['id'] not in clock_ids and green(p) and 10 <= p['n'] <= 90
            and 0.025 <= p['s'].max() <= 0.09 and p['s'].min() > 0.012 and ground[p['id']] is not None):
        trees.append((split(f'tree_{len(trees)}', {p['id']}), p))
print(f'split off {len(balloons)} balloons, the clock islet ({len(clock_ids)} pieces), {len(trees)} trees')

M = Matrix.Scale(S, 4) @ Matrix.Translation(-Vector(ORIGIN.tolist()))
for o in [land, clock] + [b for b, _ in balloons] + [t for t, _ in trees]:
    o.data.transform(M)


def set_origin(o, base):
    o.data.transform(Matrix.Translation(-base))
    o.location = base


for o, p in balloons:
    set_origin(o, W(p['c']))
for o, p in trees:
    set_origin(o, W((p['c'][0], p['c'][1], p['lo'][2])))
set_origin(clock, W(clock_c))
rig.downsize_texture(land, 2048, os.path.join(os.path.dirname(os.path.abspath(OUT)), '_tex'), quality=82)

# ====================================================================== materials
ROCK = mat('#c9c3b8', rough=1.0)
ROCK2 = mat('#b1aa9f', rough=1.0)
DIRT = mat('#9a6a44', rough=1.0)
GRASS = mat('#7cbf52', rough=1.0)
GRASS2 = mat('#6aae46', rough=1.0)
WOOD = mat('#a86f3e', rough=0.85)
TRUNK = mat('#8a5a35', rough=0.9)
WHITE = mat('#f7f7f4', rough=0.9)
CLOUD = mat('#ffffff', rough=1.0)
GOLD = mat('#f2c14e', rough=0.32, metal=0.15)
GOLD_D = mat('#d9a53b', rough=0.4, metal=0.15)
STONE = mat('#e3d3b8', rough=0.9)
WATER = mat('#4fb8ec', rough=0.2)
BLUE = mat('#3b7fe0', rough=0.6)
RED = mat('#e04a3c', rough=0.6)
NET = mat('#2b3a3a', rough=0.95)
DARK = mat('#3a3330', rough=0.7)
CREAM = mat('#f4e8d2', rough=0.9)
PALETTE = [mat(c, rough=0.75) for c in ('#ff5a4e', '#ffcf3d', '#3b8cf0', '#ffffff', '#5fd36a', '#ff8fb0')]


def bar(g, a, b, r, m, seg=10):
    """A cylinder from a to b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    g.cyl(r, d.length, (a + b) / 2, m, seg=seg, rot=tuple(d.to_track_quat('Z', 'Y').to_euler()))


# ====================================================================== rock undersides
def boundary_loops(obj):
    """Ordered vertex loops along the open edges of a mesh (world coordinates)."""
    b = bmesh.new()
    b.from_mesh(obj.data)
    b.verts.ensure_lookup_table()
    adj = {}
    for e in b.edges:
        if len(e.link_faces) == 1:
            i, j = e.verts[0].index, e.verts[1].index
            adj.setdefault(i, []).append(j)
            adj.setdefault(j, []).append(i)
    co = {i: obj.matrix_world @ b.verts[i].co for i in adj}
    b.free()
    seen, loops = set(), []
    for v0 in adj:
        if v0 in seen:
            continue
        loop, prev, cur = [v0], None, v0
        seen.add(v0)
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append([co[i] for i in loop])
    return loops


def rock_bottom(g, pts, depth, rings=4, jitter=0.06):
    """Close an open rim (a list of points) with a faceted rock cone hanging below it."""
    pts = np.array([p[:] for p in pts])
    C = pts[:, :2].mean(0)
    n = len(pts)
    levels = [pts]
    for k in range(1, rings):
        t = k / rings
        sh = (1 - t) ** 0.85
        lv = []
        for p in pts:
            x = C[0] + (p[0] - C[0]) * sh + rng.uniform(-jitter, jitter) * depth * (1 - t)
            y = C[1] + (p[1] - C[1]) * sh + rng.uniform(-jitter, jitter) * depth * (1 - t)
            z = p[2] - depth * t ** 1.25 - rng.uniform(0, 0.08) * depth
            lv.append((x, y, z))
        levels.append(np.array(lv))
    apex = (C[0] + rng.uniform(-0.1, 0.1) * depth, C[1] + rng.uniform(-0.1, 0.1) * depth, pts[:, 2].min() - depth * 1.05)
    for k in range(rings):
        b = bmesh.new()
        a_ring = [b.verts.new(Vector(p.tolist())) for p in levels[k]]
        if k < rings - 1:
            b_ring = [b.verts.new(Vector(p.tolist())) for p in levels[k + 1]]
            for i in range(n):
                try:
                    b.faces.new((a_ring[i], a_ring[(i + 1) % n], b_ring[(i + 1) % n], b_ring[i]))
                except ValueError:
                    pass
        else:
            top = b.verts.new(Vector(apex))
            for i in range(n):
                try:
                    b.faces.new((a_ring[i], a_ring[(i + 1) % n], top))
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        g.prim(b, DIRT if k == 0 else (ROCK if k % 2 else ROCK2), smooth=False)


rocks = Geo()
n_rock = 0
for loop in boundary_loops(land):
    if len(loop) < 10:
        continue
    pts = np.array([p[:] for p in loop])
    per = float(np.sum(np.linalg.norm(np.roll(pts, -1, 0) - pts, axis=1)))
    C = pts[:, :2].mean(0)
    R = float(np.hypot(*(pts[:, :2] - C).T).mean())
    zr = float(np.ptp(pts[:, 2]))
    ev = np.linalg.eigvalsh(np.cov((pts[:, :2] - C).T))
    aspect = math.sqrt(max(ev) / max(1e-9, min(ev)))
    if (per < 9.0 or zr < 0.15 or pts[:, 2].min() > 1.0 or aspect > 2.0
            or (np.hypot(*C) < 2.5 and abs(pts[:, 2].mean()) < 0.6)):
        continue    # prop holes, flat open quads (table tops, the court), roofs and signs (high up),
                    # bridges (long and narrow), the hole the statue left (the fountain covers it)
    print(f'  rim: {len(loop)} verts, {per:.1f} m around, z {pts[:, 2].min():.1f}..{pts[:, 2].max():.1f} at ({C[0]:+.1f}, {C[1]:+.1f})')
    rock_bottom(rocks, loop, depth=min(6.0, max(1.6, 0.75 * R)))
    n_rock += 1
rocks.build('rocks', parent=land)
print(f'rock undersides: {n_rock}')

# ====================================================================== fountain + statue
g = Geo()
g.cyl(1.5, 0.55, (0, 0, 0.27), STONE, seg=24, bevel=0.06)
g.cyl(1.25, 0.5, (0, 0, 0.3), WATER, seg=24)
g.build('fountain', parent=land)
g = Geo()
g.cyl(0.95, 0.3, (0, 0, 0.7), GOLD_D, seg=16, bevel=0.03)
g.cyl(0.62, 0.9, (0, 0, 1.3), GOLD, seg=16)
g.cyl(0.8, 0.12, (0, 0, 1.8), GOLD_D, seg=16, bevel=0.03)
# the cat: sitting, facing the entrance bridge (-Y), racket raised in its right paw
g.sphere(0.62, (0, 0.05, 2.5), GOLD, scale=(1, 0.9, 1.15), seg=18)
g.sphere(0.34, (0, -0.25, 2.1), GOLD, scale=(1.6, 1, 0.7), seg=14)          # haunches
g.sphere(0.52, (0, -0.05, 3.45), GOLD, seg=18)                               # head
g.sphere(0.2, (0, -0.47, 3.3), GOLD_D, scale=(1.3, 1, 0.8), seg=12)          # muzzle
for sx in (-1, 1):
    g.cone(0.17, 0.42, (sx * 0.3, -0.02, 3.98), GOLD, seg=10, rot=(0, sx * 0.3, 0))
    g.sphere(0.07, (sx * 0.19, -0.5, 3.52), DARK, seg=8)                     # eyes
for i in range(5):                                                           # tail curling up the back
    a = 0.3 + i * 0.45
    g.sphere(0.11 - i * 0.012, (0.55 + 0.25 * math.sin(a), 0.35 + 0.15 * i, 1.95 + 0.33 * i), GOLD, seg=8)
bar(g, (-0.5, -0.15, 2.9), (-0.85, -0.45, 2.1), 0.12, GOLD)                 # left paw down
bar(g, (0.5, -0.15, 2.9), (0.95, -0.35, 3.6), 0.12, GOLD)                   # right paw up with the racket
bar(g, (0.95, -0.35, 3.6), (1.05, -0.4, 4.35), 0.07, GOLD_D)                 # handle
g.cyl(0.5, 0.05, (1.1, -0.42, 4.85), GOLD_D, seg=18, rot=(math.pi / 2, 0, 0))
g.cyl(0.42, 0.07, (1.1, -0.42, 4.85), GOLD, seg=18, rot=(math.pi / 2, 0, 0))
statue = g.build('statue', parent=land)
statue.scale = (0.52, 0.52, 0.52)

# ====================================================================== nets, balls
court = [p for p in others if p['s'][2] < 0.006 and p['s'][1] > 0.08 and p['s'][0] > 0.04   # a thin green sheet
         and p['c'][0] < -0.1 and p['c'][1] > 0.05 and p['col'][1] > p['col'][0]]
if court:
    court_lo, court_hi = W(court[0]['lo']), W(court[0]['hi'])
else:
    print('WARNING: tennis court not found; using a guess')
    court_lo, court_hi = W((-0.29, 0.2, 0.25)), W((-0.22, 0.31, 0.25))
court_c = (court_lo + court_hi) / 2
court_c.z = court_hi.z
cw, cl = court_hi.x - court_lo.x, court_hi.y - court_lo.y
g = Geo()
g.box((cw + 0.6, 0.05, 0.75), (court_c.x, court_c.y, court_c.z + 0.4), NET, bevel=0)
g.box((cw + 0.6, 0.08, 0.07), (court_c.x, court_c.y, court_c.z + 0.78), WHITE, bevel=0.02)
for sx in (-1, 1):
    g.cyl(0.06, 0.95, (court_c.x + sx * (cw / 2 + 0.3), court_c.y, court_c.z + 0.47), WOOD, seg=8)
tables = []
for p in others:                                  # the two table tops: thin, blue, on the table-tennis island
    c = p['col']
    if p['s'][2] < 0.006 and p['s'][0] > 0.07 and c[2] > c[0] * 1.3 and p['c'][0] > 0.1 and p['c'][1] > 0.0:
        vm = comp == p['id']
        Q = (P[vm] - ORIGIN) * S
        cov = np.cov(Q[:, :2].T)
        w, v = np.linalg.eigh(cov)
        ax = Vector((v[0, 1], v[1, 1], 0)).normalized()        # long axis
        length = float(np.ptp(Q[:, :2] @ np.array((ax.x, ax.y))))
        width = float(np.ptp(Q[:, :2] @ np.array((-ax.y, ax.x))))
        ctr = Vector(Q.mean(0).tolist())
        ctr.z = float(Q[:, 2].max())
        tables.append((ctr, ax, length, width))
        yaw = math.atan2(ax.y, ax.x)
        g.box((0.03, width + 0.3, 0.17), (ctr.x, ctr.y, ctr.z + 0.085), NET, bevel=0, rot=(0, 0, yaw))
        g.box((0.05, width + 0.3, 0.02), (ctr.x, ctr.y, ctr.z + 0.17), WHITE, bevel=0, rot=(0, 0, yaw))
g.build('nets', parent=land)
print(f'tennis court {cw:.1f} x {cl:.1f} m at {tuple(round(v, 2) for v in court_c)}, {len(tables)} tables')


def arc_path(a, b, bounce_t, h_hit, h_peak):
    """Position along a lob from a to b with one bounce at bounce_t (fraction of the way)."""
    def at(t):
        if t < bounce_t:
            u = t / bounce_t
            z = h_hit * (1 - u) + 4 * h_peak * u * (1 - u)
        else:
            u = (t - bounce_t) / (1 - bounce_t)
            z = h_hit * u + 4 * h_peak * 0.6 * u * (1 - u)
        return a.lerp(b, t) + Vector((0, 0, z))
    return at


g = Geo()
g.sphere(0.14, (0, 0, 0), mat('#e8ff3a', rough=0.7), seg=10)
ball_t = g.build('ball_tennis', parent=land)
g = Geo()
g.sphere(0.09, (0, 0, 0), WHITE, seg=8)
ball_p = g.build('ball_tt', parent=land)

# ====================================================================== airship
AIR = W((-0.396, -0.151, 0.239)) + Vector((0, 0, 1.6))
g = Geo()


def gores(parity):
    """The envelope's faces in every other 30-degree segment around its long (Y) axis."""
    b = bmesh.new()
    bmesh.ops.create_uvsphere(b, u_segments=24, v_segments=12, radius=1.0)
    bmesh.ops.scale(b, vec=Vector((1.25, 3.3, 1.25)), verts=b.verts)
    gone = [f for f in b.faces
            if int(((math.atan2(f.calc_center_median().z, f.calc_center_median().x) + TAU) % TAU) / (TAU / 12)) % 2 != parity]
    bmesh.ops.delete(b, geom=gone, context='FACES')
    return b


g.prim(gores(0), WHITE)
g.prim(gores(1), BLUE)
g.box((2.6, 1.0, 0.06), (0, 2.6, 0), RED, bevel=0.01)                        # tail fins
g.box((0.06, 1.0, 1.3), (0, 2.6, 0.3), RED, bevel=0.01)
g.box((2.2, 1.0, 0.75), (0, -0.3, -1.95), WOOD, bevel=0.03)                  # gondola
g.box((2.0, 0.8, 0.08), (0, -0.3, -1.55), DARK, bevel=0.0)
for sx in (-0.9, 0.9):
    for sy in (-0.7, 0.1):
        bar(g, (sx * 0.8, sy, -1.0), (sx, sy - 0.3, -1.6), 0.025, DARK, seg=5)
g.sphere(0.45, (0, -3.1, 0), WHITE, scale=(1, 0.6, 1), seg=12)              # nose cap
airship = g.build('airship', loc=AIR)
airship.scale = (0.8, 0.8, 0.8)
g = Geo()
g.sphere(0.18, (0, 0, 0), DARK, seg=8)
for i in range(3):
    a = i * TAU / 3
    g.box((0.95, 0.06, 0.24), (0.5 * math.cos(a), 0, 0.5 * math.sin(a)), WHITE, bevel=0.01, rot=(0, -a, 0))
prop = g.build('prop', parent=airship, loc=(0, 3.4, 0))

# ====================================================================== windmill
dg = bpy.context.evaluated_depsgraph_get()
MILL = W((-0.335, -0.178, 0.3))
hit, loc, *_ = sc.ray_cast(dg, Vector((MILL.x, MILL.y, 20)), Vector((0, 0, -1)))
MILL.z = loc.z if hit else 0.0
g = Geo()
g.cyl(0.7, 1.9, (MILL.x, MILL.y, MILL.z + 0.95), CREAM, seg=12, r2=0.52)
g.box((0.36, 0.2, 0.65), (MILL.x, MILL.y - 0.62, MILL.z + 0.32), WOOD, bevel=0.02)   # door
g.cone(0.72, 0.8, (MILL.x, MILL.y, MILL.z + 2.25), RED, seg=12)
g.cyl(0.07, 0.5, (MILL.x, MILL.y - 0.6, MILL.z + 1.7), DARK, seg=8, rot=(math.pi / 2, 0, 0))
g.build('windmill', parent=land)
g = Geo()
g.sphere(0.22, (0, 0, 0), DARK, seg=8)
for i in range(4):                                  # four arms, each with a sail on one side
    a = i * TAU / 4
    along, across = Vector((math.sin(a), 0, math.cos(a))), Vector((math.cos(a), 0, -math.sin(a)))
    g.box((0.12, 0.06, 2.5), along * 1.2, DARK, bevel=0.0, rot=(0, a, 0))
    g.box((0.55, 0.04, 1.5), along * 1.6 + across * 0.33, CREAM, bevel=0.0, rot=(0, a, 0))
mill = g.build('mill', parent=land, loc=(MILL.x, MILL.y - 0.85, MILL.z + 1.7))
mill.scale = (0.6, 0.6, 0.6)

# ====================================================================== mini islets
def islet(name, loc, r, with_tree=True):
    g = Geo()
    n = 9
    top = [(r * rng.uniform(0.85, 1.15) * math.cos(TAU * i / n), r * rng.uniform(0.85, 1.15) * math.sin(TAU * i / n),
            rng.uniform(-0.04, 0.04) * r) for i in range(n)]
    g.poly(top, GRASS)
    levels = [top]
    for t, sh in ((0.2, 1.02), (0.55, 0.78), (1.0, 0.48), (1.45, 0.2)):
        levels.append([(x * sh + rng.uniform(-0.1, 0.1) * r, y * sh + rng.uniform(-0.1, 0.1) * r,
                        -t * r + rng.uniform(-0.08, 0.08) * r) for x, y, z in top])
    apex = (0, 0, -1.85 * r)
    for k in range(len(levels)):
        b = bmesh.new()
        a_ring = [b.verts.new(Vector(p)) for p in levels[k]]
        if k < len(levels) - 1:
            b_ring = [b.verts.new(Vector(p)) for p in levels[k + 1]]
            for i in range(n):
                b.faces.new((a_ring[i], a_ring[(i + 1) % n], b_ring[(i + 1) % n], b_ring[i]))
        else:
            tp = b.verts.new(Vector(apex))
            for i in range(n):
                b.faces.new((a_ring[i], a_ring[(i + 1) % n], tp))
        bmesh.ops.recalc_face_normals(b, faces=b.faces)
        g.prim(b, DIRT if k == 0 else (ROCK if k % 2 else ROCK2), smooth=False)
    if with_tree:
        s = r * 0.9
        g.cyl(0.08 * s, 0.7 * s, (0.1 * r, 0, 0.35 * s), TRUNK, seg=7)
        for dx, dy, dz, rr in ((0, 0, 1.0, 0.5), (0.3, 0.1, 0.8, 0.36), (-0.25, -0.15, 0.85, 0.32)):
            g.sphere(rr * s, (0.1 * r + dx * s, dy * s, dz * s), GRASS2 if rr < 0.4 else GRASS, seg=8)
    else:
        g.cyl(0.05, 1.6, (0, 0, 0.8), DARK, seg=6)
        g.box((0.28, 0.28, 0.3), (0, 0, 1.75), mat('#ffd27a', rough=0.5, emit=('#ffd27a', 2.0)), bevel=0.03)
    return g.build(name, loc=loc)


islets = []
for i, p in enumerate(seeds):
    c = W((p['c'][0], p['c'][1], p['hi'][2]))
    islets.append(islet(f'islet_{i}', c, max(0.7, min(1.4, float(p['s'].max()) * S * 0.6)), with_tree=i % 3 != 1))

# ====================================================================== clouds
def cloud(name, loc, s):
    g = Geo()
    for i in range(rng.randint(3, 6)):
        r = s * rng.uniform(0.5, 1.0)
        g.sphere(r, (rng.uniform(-1.3, 1.3) * s, rng.uniform(-0.7, 0.7) * s, rng.uniform(-0.1, 0.4) * s),
                 CLOUD, scale=(1, 1, 0.7), seg=8)
    return g.build(name, loc=loc)


clouds = []
for i in range(9):                               # under the islands
    a = TAU * i / 9 + rng.uniform(-0.2, 0.2)
    r = rng.uniform(6, 20)
    clouds.append(cloud(f'cloud_{len(clouds)}', (r * math.cos(a), r * math.sin(a), rng.uniform(-18, -11)), rng.uniform(1.4, 2.4)))
for i in range(8):                               # far ring, towards the horizon
    a = TAU * i / 8 + rng.uniform(-0.25, 0.25)
    r = rng.uniform(27, 42)
    clouds.append(cloud(f'cloud_{len(clouds)}', (r * math.cos(a), r * math.sin(a), rng.uniform(-10, 2)), rng.uniform(2.2, 3.6)))
for i in range(3):                               # small and nearer: parallax
    a = TAU * i / 3 + rng.uniform(-0.4, 0.4)
    r = rng.uniform(16, 20)
    clouds.append(cloud(f'cloud_{len(clouds)}', (r * math.cos(a), r * math.sin(a), rng.uniform(-5, -1)), rng.uniform(0.7, 1.0)))

# ====================================================================== pennants
lamps = [p for p in others if p['id'] not in kill and p['id'] not in clock_ids
         and 0.075 <= p['s'][2] <= 0.12 and max(p['s'][0], p['s'][1]) <= 0.04]
courts = [(court_lo.x - 0.5, court_hi.x + 0.5, court_lo.y - 0.5, court_hi.y + 0.5)]
for ctr, ax, length, width in tables:
    courts.append((ctr.x - 2.2, ctr.x + 2.2, ctr.y - 2.2, ctr.y + 2.2))


def over_court(p):
    return any(x0 < p.x < x1 and y0 < p.y < y1 for x0, x1, y0, y1 in courts)


def pennant(name, a, b, k):
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    dirn = d.normalized()
    side = Vector((-dirn.y, dirn.x, 0)).normalized()
    sag = min(0.9, max(0.35, 0.12 * L))

    def at(t):
        return a + d * t - Vector((0, 0, sag * 4 * t * (1 - t)))
    g = Geo()
    for i in range(10):
        p0, p1 = at(i / 10), at((i + 1) / 10)
        bar(g, p0, p1, 0.012, DARK, seg=4)
    nf = max(3, int(L / 0.55))
    tips = []
    for i in range(nf):
        m = at((i + 0.5) / nf)
        tip = m - Vector((0, 0, 0.42))
        g.poly((m - dirn * 0.17, m + dirn * 0.17, tip), PALETTE[(i + k) % len(PALETTE)])
        tips.append((tip, 1 if i % 2 == 0 else -1))
    o = g.build(name, parent=land)
    # morph target "wave": every other flag's tip swings the other way; js/landing.js drives it
    o.shape_key_add(name='Basis', from_mix=False)
    sk = o.shape_key_add(name='wave', from_mix=False)
    co = np.array([v.co[:] for v in o.data.vertices])
    for tip, sgn in tips:
        i = int(np.argmin(np.linalg.norm(co - np.array(tip[:]), axis=1)))
        sk.data[i].co = tip + side * (0.18 * sgn) + Vector((0, 0, 0.06))
    sk.value = 0.0
    return o


tops = [W((p['c'][0], p['c'][1], p['hi'][2] - 0.004)) for p in lamps]
used = {}
strings = []
pairs = sorted(((tops[i] - tops[j]).length, i, j) for i in range(len(tops)) for j in range(i + 1, len(tops)))
for dist, i, j in pairs:
    if not 2.4 < dist < 6.2 or used.get(i, 0) >= 2 or used.get(j, 0) >= 2:
        continue
    if abs(tops[i].z - tops[j].z) > 0.8 or over_court((tops[i] + tops[j]) / 2):
        continue
    used[i] = used.get(i, 0) + 1
    used[j] = used.get(j, 0) + 1
    strings.append(pennant(f'bunt_{len(strings)}', tops[i], tops[j], len(strings)))
print(f'{len(lamps)} lamp posts, {len(strings)} pennant strings')

# ====================================================================== steam
yellow = [p for p in others if p['id'] not in kill and p['s'][2] < 0.006 and 0.03 < p['s'][0] < 0.05
          and p['c'][0] > 0.1 and p['c'][1] < -0.1]
kitchen_c = W(np.mean([p['c'] for p in yellow], axis=0)) if yellow else W((0.2, -0.27, 0.16))
steams = []
for i, p in enumerate(yellow[:3]):
    g = Geo()
    g.sphere(0.22, (0, 0, 0), CLOUD, seg=8)
    g.sphere(0.15, (0.18, 0.05, 0.12), CLOUD, seg=8)
    steams.append(g.build(f'steam_{i}', parent=land, loc=W((p['c'][0], p['c'][1], p['hi'][2])) + Vector((0, 0, 0.35))))

# ====================================================================== hotspot anchors
carpet = np.isin(fcomp, LAND) & (fnrm[:, 2] > 0.7) & (FC[:, 0] > FC[:, 1] * 1.6) & (FC[:, 0] > FC[:, 2] * 1.6) & (fcen[:, 1] < -0.3)
entry = W(fcen[carpet].mean(0)) if carpet.any() else W((0.0, -0.4, 0.2))
tt_c = sum((t[0] for t in tables), Vector()) / max(1, len(tables)) if tables else W((0.28, 0.22, 0.26))
for name, loc in (('hot_tennis', court_c + Vector((0, 0, 1.2))),
                  ('hot_tt', tt_c + Vector((0, 0, 1.3))),
                  ('hot_cook', kitchen_c + Vector((0, 0, 1.4))),
                  ('hot_plaza', Vector((0, 0, 3.4))),
                  ('hot_airship', Vector((0, 0, 1.8))),
                  ('hot_clock', Vector((0, 0, 2.3))),
                  ('hot_entry', entry + Vector((0, 0, 1.0)))):
    parent = {'hot_airship': airship, 'hot_clock': clock}.get(name, land)
    empty(name, parent=parent, loc=loc)


# ====================================================================== animation
def fcurves(o):
    act = o.animation_data.action
    fcs = list(getattr(act, 'fcurves', []) or [])
    if fcs:
        return fcs
    for layer in getattr(act, 'layers', []):
        for strip in layer.strips:
            for cb in strip.channelbags:
                fcs += list(cb.fcurves)
    return fcs


def linear(o):
    for fc in fcurves(o):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'


def sway(o, amp=0.12, tilt=0.0, phase=0.0, drift=(0, 0), periods=2, step=5):
    """Bob up and down `periods` times per loop, with an optional tilt and horizontal drift."""
    base = o.location.copy()
    for f in range(0, LOOP + 1, step):
        t = TAU * f / LOOP
        loc = base + Vector((drift[0] * math.sin(t + phase), drift[1] * math.cos(t + phase), amp * math.sin(periods * t + phase)))
        rot = (tilt * math.sin(t + phase + 1.0), tilt * math.cos(t + phase), o.rotation_euler.z)
        key(o, f, loc=loc, rot=rot)


sway(land, amp=0.14, tilt=math.radians(0.5))
for i, o in enumerate(islets):
    sway(o, amp=0.2 + 0.08 * (i % 3), tilt=math.radians(1.5), phase=i * 1.3, periods=1 + i % 2)
sway(clock, amp=0.1, tilt=math.radians(0.6), phase=2.0, periods=1)
for i, (o, p) in enumerate(balloons):
    sway(o, amp=0.35, tilt=math.radians(3), phase=i * 2.1, drift=(0.6, 0.4), periods=1)
sway(airship, amp=0.3, tilt=math.radians(2), phase=0.7, drift=(1.2, 0.5), periods=1)
for f in (0, LOOP):                                   # propeller: 2 turns a second; windmill: one turn in 5 s
    key(prop, f, rot=(0, TAU * 20 * f / LOOP, 0))
    key(mill, f, rot=(0, TAU * 2 * f / LOOP, 0))
linear(prop)
linear(mill)
# balls: tennis lob along the court (4 crossings), table-tennis rally across the first table (6 crossings)
A, B = Vector((court_c.x, court_lo.y + 1.0, court_c.z)), Vector((court_c.x, court_hi.y - 1.0, court_c.z))
for f in range(0, LOOP + 1, 2):
    u = (f / LOOP * 4) % 1.0
    fwd = int(f / LOOP * 4) % 2 == 0
    at = arc_path(A, B, 0.68, 0.9, 1.3) if fwd else arc_path(B, A, 0.68, 0.9, 1.3)
    key(ball_t, f, loc=at(u))
if tables:
    ctr, ax, length, width = tables[0]
    A, B = ctr - ax * (length / 2 + 0.5) + Vector((0, 0, 0.1)), ctr + ax * (length / 2 + 0.5) + Vector((0, 0, 0.1))
    for f in range(0, LOOP + 1, 2):
        u = (f / LOOP * 6) % 1.0
        fwd = int(f / LOOP * 6) % 2 == 0
        at = arc_path(A, B, 0.65, 0.22, 0.42) if fwd else arc_path(B, A, 0.65, 0.22, 0.42)
        key(ball_p, f, loc=at(u))
linear(ball_t)
linear(ball_p)
for i, o in enumerate(steams):                        # puffs rise and fade (scale) every 2.5 s
    base = o.location.copy()
    for f in range(0, LOOP + 1, 3):
        u = ((f / LOOP * 4) + i * 0.33) % 1.0
        s = 0.25 + 0.9 * math.sin(math.pi * u) ** 0.8
        key(o, f, loc=base + Vector((0.15 * math.sin(u * 6 + i), 0, 1.4 * u)), scale=s)
    linear(o)

# ====================================================================== export
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_apply=True,
    export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_frame_range=True,
    export_force_sampling=True, export_optimize_animation_size=True,
    export_morph=True, export_lights=False, export_cameras=False, export_yup=True,
)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

if PREVIEW:
    for m in bpy.data.materials:              # Workbench shows the viewport colour, not the node colour
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.node_tree else None
        if b and not any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes):
            m.diffuse_color = b.inputs['Base Color'].default_value
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_shadows = True
    sc.display.shading.show_cavity = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1100
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.color = (0.66, 0.84, 1.0)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.lens = 32
    cam_data.clip_end = 300
    d = Vector((-0.55, -1.0, 0.72)).normalized()
    look = Vector((0, 0, -1))
    cam.location = look + d * 46
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    for i, f in enumerate((0, LOOP // 3)):
        sc.frame_set(f)
        sc.render.filepath = PREVIEW if i == 0 else PREVIEW.replace('.png', f'_{i}.png')
        bpy.ops.render.render(write_still=True)
    cam.location = (0, 0, 60)
    cam.rotation_euler = (0, 0, 0)
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 30
    sc.frame_set(0)
    sc.render.filepath = PREVIEW.replace('.png', '_top.png')
    bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)

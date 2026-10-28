"""Tennis venue: the "Tropical Bunny Tennis Island" source model turned into a
living court in the racket engine's coordinates.

    blender -b --factory-startup --python art/island.py -- assets/island_court.glb [preview.png]

The AI-generated island (art/source/environments/tennis/, never modified) has a
squat court (1.3:1 instead of 2.17:1), rotated ~9 degrees, bumpy, with a hole at
one corner, and its props are low-poly guesses: the stands are stretched boxes,
one spectator row hides under a 40 m tarp of stretched faces, streamers are
single triangles, a palm canopy floats without a trunk. What this build does:
  removed   the old court, its net and surround ground, the three stand boxes
            with their benches, spectators and umbrellas, every stretched sheet
            (the tarp, the streamers, a torn pennant line), the rails and the
            plank deck that stood in front of them, every tree (muddy, faceted
            canopies with baked-in shading) and the ball crates
  kept      the island, its rock skirt, the islets, piers, banners, lamps,
            fences and the boat; its texture is colour-graded (more saturation,
            lifted midtones) to the reference's bright palette
  added     a regulation court on a coral plinth, four grandstands hugging it
            (three tiers on the long sides with umbrellas, two behind each
            baseline), a crowd of toy animals of six species, pennant strings
            along the rails, stylised palms and bushes where the trees stood,
            flowers, ball baskets, seagulls, clouds and a turquoise sea
  animated  a 20 s baked loop: the boat rocks at its mooring, the gulls circle
            and flap. js/kit3d.js (Kit3D.liven) moves the rest by node name:
            tree_* sway, flag_* and bunt_* flutter through their "wave" morph
            target, crowd_* bob and cheer, umbrella_* wobble, cloud_* drift,
            the sea ripples.
Output (Blender Z-up -> glTF Y-up), meters: court centred on the origin, long
axis along Blender Y, net at y = 0, playing surface at z = 0, side 0's baseline
toward Blender +Y (glTF -Z). Nodes: island, island_court, sea, stand_*, tree_*,
flag_*, bunt_*, crowd_*, umbrella_*, cloud_*, basket_*, boat, bird_* (> wing_l, wing_r).
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
from rlib import Geo, mat, key  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'environments', 'tennis', 'island_tennis_court_3d_model.fbx')
args = rig.script_args()
OUT = args[0] if args else 'island_court.glb'
PREVIEW = args[1] if len(args) > 1 else None
TAU = math.tau
LOOP = 600      # frames of the baked loop at 30 fps (20 s)
rng = random.Random(7)

# Court as measured on the source model (top-down flat render, colour mask of the
# green court + white lines, minimum-area rectangle; see knowledge/island-court.md).
COURT_CENTRE = (0.0364, -0.0856)  # source units (x, y)
COURT_ANGLE = -8.9                # degrees: the court's across-axis, from +X
COURT_LENGTH = 0.2643             # baseline to baseline, source units
SURROUND = (0.3105, 0.3683)       # red surround (across, along), source units, ~2 degrees off the court
L, WD, WS = 23.77 / 2, 10.97 / 2, 8.23 / 2   # regulation half-length, half-widths (doubles, singles)
S = 2 * L / COURT_LENGTH          # ~90: island units -> meters
SPIN = 180.0                      # the source's long grandstand ends up behind side 1 (away from the main camera)

sc = rig.reset()
sc.frame_start, sc.frame_end = 0, LOOP

# ====================================================================== source
island = rig.load_mesh(SRC, 'island')
FC = rig.face_colors(island)                    # texture colour under each face
rig.clean_material(island, 'island', roughness=0.9)
me = island.data
P, E = rig.mesh_arrays(island)
comp = rig.components(len(P), E)
fcomp = comp[np.array([p.vertices[0] for p in me.polygons])]
farea = np.array([p.area for p in me.polygons])
ids, counts = np.unique(comp, return_counts=True)
MAIN = int(ids[np.argmax(counts)])
pieces = {}
for cid, n in zip(ids, counts):
    vm = comp == cid
    lo, hi = P[vm].min(0), P[vm].max(0)
    fm = fcomp == cid
    s = hi - lo
    box = 2 * (s[0] * s[1] + s[1] * s[2] + s[0] * s[2])
    pieces[int(cid)] = dict(id=int(cid), n=int(n), lo=lo, hi=hi, c=(lo + hi) / 2, s=s, fm=fm,
                            col=FC[fm].mean(0) if fm.any() else np.zeros(3),
                            fill=float(farea[fm].sum() / max(box, 1e-9)))   # surface area / bounding box area
others = [p for p in pieces.values() if p['id'] != MAIN]
_dg = bpy.context.evaluated_depsgraph_get()


def ground_of(p, reach=0.1):
    """Component id of what a piece stands on (the first face below it that is not
    its own, probing under its centre and its four sides), or None in thin air."""
    dx, dy = p['s'][0] * 0.35, p['s'][1] * 0.35
    for ox, oy in ((0, 0), (dx, 0), (-dx, 0), (0, dy), (0, -dy)):
        z = p['lo'][2] + 0.003
        for _ in range(4):
            ok, loc, nrm, idx, *_ = sc.ray_cast(_dg, Vector((p['c'][0] + ox, p['c'][1] + oy, z)), Vector((0, 0, -1)),
                                                distance=reach)
            if not ok:
                break
            if fcomp[idx] != p['id']:
                return int(fcomp[idx])
            z = loc.z - 0.001
    return None


ground = {p['id']: ground_of(p) for p in others}


def green(p):
    c = p['col']
    return c[1] > c[0] * 1.04 and c[1] > c[2] * 1.15


def cyan(p):
    c = p['col']
    return c[1] > 0.6 and c[2] > 0.65 and c[0] < 0.5


def sheet(p):
    """A thin cloth: one horizontal extent under 1.5 cm (source units), few vertices."""
    s = p['s']
    return p['n'] <= 12 and s[2] > 0.03 and p['col'].mean() > 0.45 and (min(s[0], s[1]) < 0.015 or (p['n'] <= 10 and s[2] > 0.08))


def banner(p):
    """A hanging banner: a sheet taller than wide in whitish cloth (the draped sails
    the model strung between its poles are saturated blue, and go)."""
    c = p['col']
    return sheet(p) and p['s'][2] >= max(p['s'][0], p['s'][1]) and (c.max() - c.min()) < 0.3


def in_band(p, dx=13.6, dy=20.6):
    """Inside the court, the surround and the new stands: nothing of the model's
    loose props belongs there any more."""
    w = W(p['c'])
    return abs(w.x) < dx and abs(w.y) < dy


# Source -> court frame (meters; the z drop onto the new court comes later).
M = (Matrix.Rotation(math.radians(-COURT_ANGLE + SPIN), 4, 'Z') @ Matrix.Scale(S, 4)
     @ Matrix.Translation(Vector((-COURT_CENTRE[0], -COURT_CENTRE[1], 0))))


def W(p):
    return M @ Vector((float(p[0]), float(p[1]), float(p[2])))


def near_court(p, dx=20.0, dy=27.0):
    w = W(p['c'])
    return abs(w.x) < dx and abs(w.y) < dy


# ------------------------------------------------------------------ removals
kill, why = set(), {}


def remove(p, reason):
    kill.add(p['id'])
    why[p['id']] = reason


for p in others:
    s = p['s']
    if max(s[0], s[1]) > 0.15 and min(s[0], s[1]) > 0.08 and s[2] < 0.06:
        remove(p, 'stand')                       # the three stretched stand boxes (and the old court sheet)
    elif sheet(p) and not banner(p):
        remove(p, 'bunting sheet')               # pennant lines drawn as draped cloths between the banner poles
    elif p['fill'] < 0.15 and 0.02 < s[2] < 0.09 and max(s[0], s[1]) > 0.05 and p['n'] <= 12 and not green(p):
        remove(p, 'draped sheet')                # the same cloths hung diagonally (thick bounding box, almost no area)
    elif in_band(p) and s.max() < 0.15 and not banner(p):
        remove(p, 'in the way')                  # lamp posts, fence posts, crates where the stands now are
    elif p['n'] <= 40 and s.max() > 0.09 and p['fill'] < 0.1:
        remove(p, 'sheet')                       # the tarp, the streamer, the old net's band
    elif cyan(p) and p['fill'] < 0.12:
        remove(p, 'torn pennant line')           # a cyan strip of stretched faces along the near fence
    elif cyan(p) and min(s) < 0.012 and max(s) > 0.15:
        remove(p, 'old net')
    elif s[2] < 0.006 and s[0] > 0.2 and s[1] > 0.2:
        remove(p, 'old court')                   # the court sheet itself
changed = True
while changed:                                   # benches, spectators, umbrellas: whatever stood on a removed piece
    changed = False
    for p in others:
        if p['id'] not in kill and ground[p['id']] in kill:
            remove(p, 'on ' + why[ground[p['id']]].split()[0])
            changed = True
for p in others:
    if p['id'] in kill or not near_court(p):
        continue
    s, c = p['s'], p['col']
    if 0.015 < s.max() < 0.04 and p['fill'] > 0.4 and c[0] > 0.55 and p['n'] >= 12 and not green(p):
        remove(p, 'spectator')                   # loose spectator blobs (remade on the new stands)
    elif p['c'][2] > 0.13 and 0.04 < max(s[0], s[1]) < 0.065 and s[2] < 0.015 and 8 <= p['n'] <= 16 and not green(p):
        remove(p, 'umbrella')
    elif max(s) > 0.15 and s[2] < 0.025 and min(s[0], s[1]) < 0.06 and p['fill'] < 0.3 and not green(p):
        remove(p, 'rail')                        # the long rails that fronted the stands
    elif (s[2] < 0.015 and 0.05 < max(s[0], s[1]) < 0.1 and p['fill'] < 0.35 and p['n'] <= 16 and ground[p['id']] == MAIN
          and c[0] > c[2] * 1.5 and abs(W(p['c']).y) > 19):
        remove(p, 'deck')                        # the plank deck where the near stand goes
    elif c[0] > 0.45 and c[1] > 0.38 and c[2] < 0.28 and s.max() < 0.05 and p['n'] <= 30 and p['fill'] > 0.35:
        remove(p, 'crate')                       # yellow-green boxes of balls and small clutter (baskets replace them)
poles = {q['id']: q for q in others if max(q['s'][0], q['s'][1]) < 0.012 and q['s'][2] > 0.05}
for p in [q for q in others if why.get(q['id']) == 'umbrella']:
    for q in poles.values():                     # the umbrellas' poles
        if q['id'] not in kill and math.hypot(*(q['c'][:2] - p['c'][:2])) < 0.02:
            remove(q, 'umbrella pole')
print('removed:', ', '.join(f"{why[i]} {i} ({pieces[i]['n']} v)" for i in sorted(kill)))

pid = me.attributes.new('pid', 'INT', 'POINT')
pid.data.foreach_set('value', comp.astype(np.int32))
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[f for f in bm.faces if fcomp[f.index] in kill], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me)
bm.free()


# ------------------------------------------------------------------ split-offs
def vert_pids():
    out = np.empty(len(island.data.vertices), dtype=np.int32)
    island.data.attributes['pid'].data.foreach_get('value', out)
    return out


def split(name, idset):
    return rig.split_off(island, np.isin(vert_pids(), list(idset)), name)


taken = set(kill)
# The model's trees go (faceted canopies with the shading baked into the texture);
# stylised palms and bushes are built later where they stood.
tree_spots = []                                  # (base point in source units, canopy size)
for p in sorted(others, key=lambda q: -q['n']):
    s = p['s']
    if (p['id'] in taken or not green(p) or not 10 <= p['n'] <= 90 or not 0.025 <= s.max() <= 0.1 or s.min() < 0.008
            or (ground[p['id']] is not None and pieces[ground[p['id']]].get('tree'))):
        continue
    group = {p['id']}
    base = p['lo'][2]
    g = ground[p['id']]
    if g is not None and g != MAIN and g not in taken:
        q = pieces[g]                            # a trunk under the canopy, or lower fronds
        if (max(q['s'][0], q['s'][1]) < 0.025 and q['s'][2] > 0.02) or green(q):
            group.add(g)
            base = q['lo'][2]
            g2 = ground[g]
            if g2 is not None and g2 != MAIN and g2 not in taken and max(pieces[g2]['s'][0], pieces[g2]['s'][1]) < 0.025:
                group.add(g2)
                base = pieces[g2]['lo'][2]
    for q in others:                             # fronds stacked on this canopy
        if q['id'] not in taken and q['id'] not in group and ground[q['id']] in group and green(q):
            group.add(q['id'])
    for i in group:
        pieces[i]['tree'] = True
        kill.add(i)
        why[i] = 'tree'
    taken |= group
    tree_spots.append(((p['c'][0], p['c'][1], base if ground[p['id']] is not None else None), float(s.max())))
for p in others:                                 # small green scraps left on the ground (fronds, grass tufts)
    if p['id'] not in taken and green(p) and p['n'] < 40 and p['s'].max() < 0.03:
        kill.add(p['id']); why[p['id']] = 'scrap'; taken.add(p['id'])
flags = []
for p in others:
    if p['id'] not in taken and banner(p):    # the hanging banners (the wide and the blue sheets went above)
        taken.add(p['id'])
        flags.append((split(f'flag_{len(flags)}', {p['id']}), p))
hull = [p for p in others if p['id'] not in taken and ground[p['id']] is None and p['lo'][2] < 0.02
        and 0.1 < p['s'].max() < 0.15 and p['s'][2] < 0.03 and not green(p) and p['col'][0] > p['col'][2] * 1.3]
boat = None
if hull:
    h = hull[0]
    crew = {q['id'] for q in others if q['id'] not in taken and np.all(q['c'][:2] > h['lo'][:2] - 0.01)
            and np.all(q['c'][:2] < h['hi'][:2] + 0.01) and q['c'][2] < 0.16}
    taken |= crew
    boat = (split('boat', crew), h)
bm = bmesh.new()                                 # the trees and scraps marked after the first pass
bm.from_mesh(me)
pids_now = vert_pids()
bmesh.ops.delete(bm, geom=[f for f in bm.faces if pids_now[f.verts[0].index] in kill], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me)
bm.free()
print(f'{len(tree_spots)} trees replaced; split off {len(flags)} banners, the boat ({len(crew) if hull else 0} pieces)')

moving = [island] + [f for f, _ in flags] + ([boat[0]] if boat else [])
for o in moving:
    o.data.transform(M)

# Ground under the new court: the old court and its surround are bumpy, so cast
# rays down on a 1 m grid over the area the new court covers and take the
# highest ground hit (props such as benches stand well above it and are ignored).
SLAB = (SURROUND[0] * S + 2.0, SURROUND[1] * S + 2.0)
dg = bpy.context.evaluated_depsgraph_get()
hits = []
for x in np.arange(-SLAB[0] / 2 + 0.5, SLAB[0] / 2, 1.0):
    for y in np.arange(-SLAB[1] / 2 + 0.5, SLAB[1] / 2, 1.0):
        ok, loc, nrm, *_ = sc.ray_cast(dg, Vector((x, y, 100)), Vector((0, 0, -1)))
        if ok and nrm.z > 0.8:
            hits.append(loc.z)
hits = np.array(hits)
surface = float(np.median(hits))
top = float(np.percentile(hits[np.abs(hits - surface) < 0.6], 99))
drop = top + 0.03
for o in moving:
    o.data.transform(Matrix.Translation(Vector((0, 0, -drop))))
print(f'island: scale {S:.1f}, old court at {surface:.2f} m (bumps up to {top:.2f}), lowered by {drop:.2f} m')


def WD_(p):
    """Source point -> final world point."""
    return W(p) - Vector((0, 0, drop))


def set_origin(o, base):
    o.data.transform(Matrix.Translation(-base))
    o.location = base


for o, p in flags:
    set_origin(o, WD_((p['c'][0], p['c'][1], p['hi'][2])))
if boat:
    set_origin(boat[0], WD_((boat[1]['c'][0], boat[1]['c'][1], boat[1]['lo'][2] + 0.01)))

# The island's own net (a tall panel ~1.2 m off the court's centre line, with box
# posts) would stick out of the new court: remove whatever stands above it there.
# The old court surface and anything low on it go too: the plinth replaces them.
bm = bmesh.new()
bm.from_mesh(me)
net = [f for f in bm.faces
       if all(-0.6 < v.co.y < 2.8 and abs(v.co.x) < 11.8 and -0.9 < v.co.z < 2.9 for v in f.verts)
       and max(v.co.z for v in f.verts) > 0.05]
bmesh.ops.delete(bm, geom=net, context='FACES')
fx, fy = SURROUND[0] * S / 2, SURROUND[1] * S / 2
old = [f for f in bm.faces
       if abs(f.calc_center_median().x) < fx and abs(f.calc_center_median().y) < fy
       and max(v.co.z for v in f.verts) < 0.6]
bmesh.ops.delete(bm, geom=old, context='FACES')
# Big, nearly flat ground triangles that reach under the plinth can rise above it
# further out (one of the old court's is 160 m2): keep the ground just below it.
bm.normal_update()
px, py = SLAB[0] / 2, SLAB[1] / 2
flat = 0
for f in bm.faces:
    zs = [v.co.z for v in f.verts]
    if (f.normal.z > 0.85 and min(zs) < 0.05 and max(zs) > -0.03
            and any(abs(v.co.x) < px and abs(v.co.y) < py for v in f.verts)):
        for v in f.verts:
            v.co.z = min(v.co.z, -0.03)
        flat += 1
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(me)
bm.free()
print(f'island: removed {len(net)} faces of the old net, {len(old)} of the old court; flattened {flat} ground faces')


def grade_texture(o, sat=1.32, gamma=0.86, warm=(1.03, 1.0, 0.97)):
    """The AI texture is muddy (shading baked in, low chroma): push it toward the
    reference's bright palette. Saturation about the luminance, a gamma that lifts
    the midtones, a touch of warmth."""
    img = next(n.image for n in o.material_slots[0].material.node_tree.nodes if n.type == 'TEX_IMAGE')
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    rgb = lum[:, None] + (rgb - lum[:, None]) * sat
    rgb = np.clip(rgb, 0, 1) ** gamma * np.array(warm, dtype=np.float32)
    px[:, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.update()


grade_texture(island)
rig.downsize_texture(island, 2048, os.path.join(os.path.dirname(os.path.abspath(OUT)), '_tex'), quality=85)

# ====================================================================== materials
SURF = mat('#d8705a', rough=0.8)          # coral surround, as in the reference
COURT = mat('#3f8f5e', rough=0.75)        # court green
LINE = mat('#ffffff', rough=0.5)
WOOD = mat('#c88d55', rough=0.85)         # light tropical wood
WOOD_D = mat('#9a6435', rough=0.9)
PLANK = mat('#dba772', rough=0.85)
NETM = mat('#1f3b33', rough=0.95)
DARK = mat('#3a3330', rough=0.7)
WHITE = mat('#f7f7f4', rough=0.9)
CLOUD = mat('#ffffff', rough=1.0)
GREY = mat('#d9d9d6', rough=0.9)
TRUNK_A = mat('#a87448', rough=0.9)
TRUNK_B = mat('#8c5c36', rough=0.9)
LEAF_A = mat('#4fb848', rough=0.75)
LEAF_B = mat('#7fd65e', rough=0.75)
LEAF_C = mat('#3d9e3c', rough=0.8)
COCO = mat('#7a4b2a', rough=0.8)
FLOWERS = [mat(c, rough=0.6) for c in ('#ff6fa8', '#ffd54a', '#ffffff', '#ff8a5c', '#c58bff')]
BALL = mat('#d7f53b', rough=0.7)
PALETTE = [mat(c, rough=0.75) for c in ('#ff5a4e', '#ffcf3d', '#3b8cf0', '#ffffff', '#5fd36a', '#ff8fb0')]
UMB = [(mat('#e8463a', rough=0.7), mat('#fff7ee', rough=0.7)), (mat('#3b7fe0', rough=0.7), mat('#fff7ee', rough=0.7)),
       (mat('#f2b705', rough=0.7), mat('#fff7ee', rough=0.7))]
# Spectators: six species, each with its fur, belly and ear style; shirts from the palette.
SPECIES = {
    'bunny': dict(fur=('#f6f1e4', '#d9c9ad', '#e8d5e5'), belly='#fff8f0', ears='tall'),
    'bear': dict(fur=('#b97a4b', '#8d5a33', '#d9a066'), belly='#e8c89a', ears='round'),
    'cat': dict(fur=('#f2a35a', '#c9c9d4', '#f4f4f4'), belly='#fff3e0', ears='point'),
    'pig': dict(fur=('#f5b5c0', '#f7c6cc'), belly='#fbd7dc', ears='flop'),
    'panda': dict(fur=('#f6f6f6',), belly='#ffffff', ears='panda'),
    'fox': dict(fur=('#ea8a3c', '#f29b55'), belly='#fff1dc', ears='point'),
}
SHIRTS = [mat(c, rough=0.7) for c in ('#3b8cf0', '#ff5a4e', '#ffcf3d', '#5fd36a', '#ff8fb0', '#8e6bff', '#2bb3c0', '#ffffff')]
EYE_W = mat('#ffffff', rough=0.3)
EYE_D = mat('#2a2222', rough=0.3)
BLUSH = mat('#ff9aa8', rough=0.7)
PINK = mat('#ffb3c0', rough=0.7)
BLACK = mat('#2a2a2e', rough=0.8)


def bar(g, a, b, r, m, seg=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    g.cyl(r, d.length, (a + b) / 2, m, seg=seg, rot=tuple(d.to_track_quat('Z', 'Y').to_euler()))


# ====================================================================== court
g = Geo()
g.rbox((SLAB[0], SLAB[1], 0.9), (0, 0, -0.45), SURF, radius=2.2, bevel=0.03)   # plinth down to the old ground
g.box((WD * 2, L * 2, 0.01), (0, 0, 0.004), COURT, bevel=0)
LW = 0.08
for x in (-WD, WD, -WS, WS):
    g.box((LW, L * 2, 0.006), (x, 0, 0.011), LINE, bevel=0)
for y in (-L, L):
    g.box((WD * 2, LW, 0.006), (0, y, 0.011), LINE, bevel=0)
for y in (-6.4, 6.4):
    g.box((WS * 2, LW, 0.006), (0, y, 0.011), LINE, bevel=0)
g.box((LW, 12.8, 0.006), (0, 0, 0.011), LINE, bevel=0)
for y in (-L, L):
    g.box((LW, 0.3, 0.006), (0, y - 0.15 * (1 if y > 0 else -1), 0.011), LINE, bevel=0)
for x in (-WD - 0.914, WD + 0.914):          # net posts 0.914 m outside the doubles lines
    g.cyl(0.06, 1.07, (x, 0, 0.535), WOOD_D, seg=12)
    g.sphere(0.07, (x, 0, 1.08), WOOD_D, seg=10)
g.box(((WD + 0.914) * 2, 0.03, 0.86), (0, 0, 0.48), NETM, bevel=0)
g.box(((WD + 0.914) * 2, 0.06, 0.07), (0, 0, 0.93), LINE, bevel=0.02)
g.box((0.05, 0.035, 0.9), (0, 0, 0.47), LINE, bevel=0)
# The source model has a hole at one corner of its court that reaches past the
# plinth's rounded corner; a plate just under the old ground level fills it.
g.cyl(24, 0.1, (0, 0, -0.85), SURF, seg=48)
court = g.build('island_court')

# ====================================================================== grandstands + crowd
TIER_D, TIER_H = 1.15, 0.5
crowd = []
umbrellas = []
bunting_pts = []     # front-rail post tops per stand: pennant strings run between them


def spectator(name, loc, yaw):
    """A toy animal sitting on a bench, facing -Y: one of six species, a bright
    shirt, big eyes with highlights, blush, paws in the lap, now and then a cap."""
    g = Geo()
    kind = rng.choice(list(SPECIES))
    sp = SPECIES[kind]
    fur = mat(rng.choice(sp['fur']), rough=0.8)
    belly = mat(sp['belly'], rough=0.8)
    shirt = rng.choice(SHIRTS)
    g.sphere(0.34, (0, 0, 0.3), shirt, scale=(1, 0.85, 0.95), seg=10)                  # body in a shirt
    g.sphere(0.2, (0, -0.2, 0.34), belly if rng.random() < 0.5 else shirt, scale=(1, 0.45, 0.9), seg=8)
    g.sphere(0.31, (0, 0.02, 0.84), fur, seg=12)                                        # head
    g.sphere(0.16, (0, -0.22, 0.76), belly, scale=(1.25, 0.6, 0.8), seg=8)              # muzzle
    for sx in (-1, 1):
        if kind == 'panda':
            g.sphere(0.1, (sx * 0.12, -0.23, 0.9), BLACK, scale=(1, 0.5, 1.25), seg=8)   # eye patches
        g.sphere(0.065, (sx * 0.12, -0.27, 0.9), EYE_W, scale=(1, 0.6, 1), seg=8)
        g.sphere(0.04, (sx * 0.12, -0.31, 0.9), EYE_D, seg=6)
        g.sphere(0.014, (sx * 0.14, -0.345, 0.925), EYE_W, seg=5)                       # highlight
        g.sphere(0.045, (sx * 0.21, -0.25, 0.79), BLUSH, scale=(1, 0.4, 0.7), seg=6)
        g.sphere(0.1, (sx * 0.36, -0.12, 0.42), fur, seg=7)                             # paws in the lap
    if kind == 'pig':
        g.cyl(0.07, 0.04, (0, -0.36, 0.78), PINK, seg=8, rot=(math.pi / 2, 0, 0))        # snout
    else:
        g.sphere(0.035, (0, -0.36, 0.79), EYE_D if kind != 'bunny' else PINK, scale=(1.3, 0.6, 0.8), seg=6)
    ears = sp['ears']
    for sx in (-1, 1):
        if ears == 'tall':
            g.sphere(0.085, (sx * 0.13, 0.04, 1.3), fur, scale=(1, 0.65, 2.6), seg=8, rot=(0, sx * 0.2, 0))
            g.sphere(0.045, (sx * 0.13, -0.01, 1.3), PINK, scale=(1, 0.5, 2.0), seg=6, rot=(0, sx * 0.2, 0))
        elif ears == 'round':
            g.sphere(0.11, (sx * 0.25, 0.04, 1.05), fur, seg=8)
            g.sphere(0.06, (sx * 0.25, -0.02, 1.05), belly, scale=(1, 0.5, 1), seg=6)
        elif ears == 'panda':
            g.sphere(0.11, (sx * 0.25, 0.04, 1.06), BLACK, seg=8)
        elif ears == 'flop':
            g.cone(0.09, 0.22, (sx * 0.26, 0.02, 1.0), fur, seg=6, rot=(0, sx * 1.2, 0))
        else:
            g.cone(0.1, 0.26, (sx * 0.2, 0.04, 1.12), fur, seg=6, rot=(0, sx * 0.15, 0))
            g.cone(0.05, 0.16, (sx * 0.2, 0.0, 1.11), belly if kind == 'fox' else PINK, seg=5, rot=(0, sx * 0.15, 0))
    if rng.random() < 0.3:                                                              # a cap in a team colour
        cap = rng.choice(SHIRTS)
        g.sphere(0.31, (0, 0.03, 0.9), cap, scale=(1.02, 1.0, 0.75), seg=12)
        g.box((0.3, 0.26, 0.04), (0, -0.3, 0.98), cap, bevel=0.01)
    elif rng.random() < 0.3:                                                            # a little flag
        bar(g, (0.42, -0.1, 0.5), (0.5, -0.1, 1.25), 0.02, WOOD_D, seg=5)
        g.poly(((0.5, -0.1, 1.25), (0.5, -0.1, 1.0), (0.86, -0.1, 1.12)), rng.choice(PALETTE))
    scale = rng.uniform(0.9, 1.08)
    o = g.build(name, loc=loc, rot=(0, 0, yaw))
    o.scale = (scale, scale, scale)
    return o


def umbrella(name, loc):
    red, cream = rng.choice(UMB)
    g = Geo()
    g.cyl(0.04, 3.0, (0, 0, 1.5), WOOD_D, seg=8)
    for i in range(8):                                          # alternating gores
        a0, a1 = TAU * i / 8, TAU * (i + 1) / 8
        rim0 = (1.7 * math.cos(a0), 1.7 * math.sin(a0), 2.75)
        rim1 = (1.7 * math.cos(a1), 1.7 * math.sin(a1), 2.75)
        g.poly(((0, 0, 3.3), rim0, rim1), red if i % 2 else cream)
        g.poly(((0, 0, 3.3), rim1, rim0), red if i % 2 else cream)
    g.sphere(0.08, (0, 0, 3.35), WOOD_D, seg=6)
    return g.build(name, loc=loc)


def grandstand(name, centre, yaw, length, tiers, with_umbrellas):
    """Benches on rising tiers. Local frame: X along the stand, -Y toward the court,
    the front edge at y = 0 on the ground."""
    g = Geo()
    rot = Matrix.Rotation(yaw, 4, 'Z')
    ctr = Vector(centre)

    def world(x, y, z):
        return ctr + rot @ Vector((x, y, z))
    posts = int(length / 4) + 1
    for t in range(tiers):
        y0, z0 = t * TIER_D, t * TIER_H
        g.box((length + 0.4, TIER_D, 0.14), (0, y0 + TIER_D / 2, z0 + 0.07), PLANK, bevel=0.02)     # tread
        g.box((length + 0.4, 0.12, TIER_H), (0, y0 + TIER_D - 0.06, z0 + TIER_H / 2), WOOD, bevel=0.01)  # riser
        g.box((length, 0.46, 0.09), (0, y0 + 0.78, z0 + 0.47), PLANK, bevel=0.02)                   # bench seat
        for i in range(posts + 1):
            x = -length / 2 + i * length / posts
            g.box((0.1, 0.1, 0.4), (x, y0 + 0.78, z0 + 0.22), WOOD_D, bevel=0.01)                   # seat legs
    for sx in (-1, 1):                                          # side boards
        for t in range(tiers):
            g.box((0.12, TIER_D, TIER_H * (t + 1)), (sx * (length / 2 + 0.26), t * TIER_D + TIER_D / 2, TIER_H * (t + 1) / 2), WOOD_D, bevel=0.01)
    back_y, back_z = tiers * TIER_D, tiers * TIER_H
    for i in range(posts + 1):                                  # back rail
        x = -length / 2 + i * length / posts
        g.cyl(0.06, 1.1, (x, back_y - 0.1, back_z + 0.55), WOOD_D, seg=8)
    g.cyl(0.05, length + 0.4, (0, back_y - 0.1, back_z + 1.05), WOOD, seg=8, rot=(0, math.pi / 2, 0))
    front = []
    for i in range(posts + 1):                                  # front rail with pennant strings
        x = -length / 2 + i * length / posts
        g.cyl(0.06, 0.95, (x, -0.12, 0.475), WOOD_D, seg=8)
        g.sphere(0.08, (x, -0.12, 0.98), WOOD_D, seg=6)
        front.append(world(x, -0.12, 0.98))
    g.cyl(0.04, length + 0.4, (0, -0.12, 0.85), WOOD, seg=8, rot=(0, math.pi / 2, 0))
    o = g.build(name, loc=ctr, rot=(0, 0, yaw))
    bunting_pts.append(front)
    # the crowd: a seat every 1.25 m, most of them taken
    for t in range(tiers):
        n = int(length / 1.25)
        for i in range(n):
            if rng.random() > 0.72:
                continue
            x = -length / 2 + (i + 0.5) * length / n + rng.uniform(-0.1, 0.1)
            crowd.append(spectator(f'crowd_{len(crowd)}', world(x, t * TIER_D + 0.78, t * TIER_H + 0.5), yaw + rng.uniform(-0.25, 0.25)))
    if with_umbrellas:
        for i in range(3):
            x = -length / 2 + (i + 0.5) * length / 3
            umbrellas.append(umbrella(f'umbrella_{len(umbrellas)}', world(x, back_y + 0.3, back_z - 0.1)))
    return o


SIDE_X = WD + 3.8           # the long sides' front edge: run-off beyond the doubles lines
END_Y = L + 5.1             # behind the baselines, past the deepest a player stands
stands = [
    grandstand('stand_left', (-SIDE_X, 0, 0), math.pi / 2, 2 * L - 2, 3, True),
    grandstand('stand_right', (SIDE_X, 0, 0), -math.pi / 2, 2 * L - 2, 3, True),
    grandstand('stand_near', (0, END_Y, 0), 0, 2 * WD + 4, 2, False),
    grandstand('stand_far', (0, -END_Y, 0), math.pi, 2 * WD + 4, 2, False),
]
print(f'4 grandstands, {len(crowd)} spectators, {len(umbrellas)} umbrellas')


# ====================================================================== pennant strings
def pennant(name, a, b, k):
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    dirn = d.normalized()
    side = Vector((-dirn.y, dirn.x, 0)).normalized()
    sag = min(0.5, max(0.2, 0.1 * length))

    def at(t):
        return a + d * t - Vector((0, 0, sag * 4 * t * (1 - t)))
    g = Geo()
    for i in range(8):
        p0, p1 = at(i / 8), at((i + 1) / 8)
        bar(g, p0, p1, 0.012, DARK, seg=4)
    nf = max(3, int(length / 0.6))
    tips = []
    for i in range(nf):
        m = at((i + 0.5) / nf)
        tip = m - Vector((0, 0, 0.34))
        g.poly((m - dirn * 0.15, m + dirn * 0.15, tip), PALETTE[(i + k) % len(PALETTE)])
        tips.append((tip, 1 if i % 2 == 0 else -1))
    o = g.build(name)
    # morph target "wave": every other flag's tip swings the other way; Kit3D.liven drives it
    o.shape_key_add(name='Basis', from_mix=False)
    sk = o.shape_key_add(name='wave', from_mix=False)
    co = np.array([v.co[:] for v in o.data.vertices])
    for tip, sgn in tips:
        i = int(np.argmin(np.linalg.norm(co - np.array(tip[:]), axis=1)))
        sk.data[i].co = tip + side * (0.16 * sgn) + Vector((0, 0, 0.05))
    sk.value = 0.0
    return o


strings = []
for front in bunting_pts:
    for i in range(len(front) - 1):
        strings.append(pennant(f'bunt_{len(strings)}', front[i], front[i + 1], len(strings)))
# ... and between the tall banner poles that stand in pairs (where the source hung its draped sheets)
tall = [q for q in poles.values() if q['id'] not in kill and q['s'][2] > 0.1]
tops = [WD_((q['c'][0], q['c'][1], q['hi'][2] - 0.004)) for q in tall]
used = set()
for i in range(len(tops)):
    for j in range(i + 1, len(tops)):
        d = (tops[i] - tops[j]).length
        if i in used or j in used or not 2.5 < d < 8.0 or abs(tops[i].z - tops[j].z) > 1.0:
            continue
        used |= {i, j}
        strings.append(pennant(f'bunt_{len(strings)}', tops[i], tops[j], len(strings)))
print(f'{len(strings)} pennant strings ({len(used) // 2} between banner poles)')

# The source's banners get the same kind of morph target: the cloth below the top
# edge bends sideways (along its thin axis), more toward the hem.
for o, p in flags:
    co = np.array([v.co[:] for v in o.data.vertices])
    if not len(co):
        continue
    thin = 0 if np.ptp(co[:, 0]) < np.ptp(co[:, 1]) else 1
    zmin, zmax = co[:, 2].min(), co[:, 2].max()
    o.shape_key_add(name='Basis', from_mix=False)
    sk = o.shape_key_add(name='wave', from_mix=False)
    for i, v in enumerate(co):
        t = (zmax - v[2]) / max(1e-6, zmax - zmin)
        d = np.zeros(3)
        d[thin] = 0.35 * t * t * (zmax - zmin) / 4.0
        sk.data[i].co = Vector((v + d).tolist())
    sk.value = 0.0

# ====================================================================== palms, bushes, flowers
def palm(name, loc, h, yaw, lean):
    """A stylised coconut palm: a ringed trunk curving `lean` outward, 8-10 fronds that
    rise and droop, coconuts under the crown. Origin at the base (Kit3D.liven sways it)."""
    g = Geo()

    def p(t):
        return Vector((lean * t * t * h * 0.45 * math.cos(yaw), lean * t * t * h * 0.45 * math.sin(yaw), t * h))
    n = 7
    for i in range(n):
        a, b = p(i / n), p((i + 1) / n)
        r = 0.27 * (1 - 0.45 * i / n)
        bar(g, a, b, r, TRUNK_A if i % 2 else TRUNK_B, seg=7)
        g.sphere(r * 1.12, b, TRUNK_B if i % 2 else TRUNK_A, scale=(1, 1, 0.45), seg=7)   # growth rings
    top = p(1)
    g.sphere(0.36, top, LEAF_C, seg=8)
    nf = 8 + rng.randint(0, 2)
    for k in range(nf):
        a = k * TAU / nf + rng.uniform(-0.15, 0.15)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        length = h * rng.uniform(0.4, 0.52)
        lift = rng.uniform(0.35, 0.6)
        m = LEAF_A if k % 2 else LEAF_B
        pts = []
        for j in range(6):
            t = j / 5
            c = top + d * (length * t * 0.95) + Vector((0, 0, length * (lift * t - (lift + 0.5) * t * t)))
            w = 0.085 * h * math.sin(math.pi * min(1.0, t + 0.08)) + 0.03
            pts.append((c, w))
        for j in range(5):
            (c0, w0), (c1, w1) = pts[j], pts[j + 1]
            g.poly((c0 - side * w0, c0 + side * w0, c1 + side * w1, c1 - side * w1), m)
            g.poly((c0 + side * w0, c0 - side * w0, c1 - side * w1, c1 + side * w1), m)   # the underside too
    for i in range(3):
        a = i * TAU / 3 + 0.5
        g.sphere(0.2, top + Vector((0.3 * math.cos(a), 0.3 * math.sin(a), -0.28)), COCO, seg=7)
    return g.build(name, loc=loc)


def bush(name, loc, s):
    g = Geo()
    for i in range(5):
        a = i * TAU / 5 + rng.random()
        r = s * rng.uniform(0.55, 0.8)
        g.sphere(r, (0.45 * s * math.cos(a), 0.45 * s * math.sin(a), r * 0.75), LEAF_A if i % 2 else LEAF_B, seg=8)
    g.sphere(s * 0.8, (0, 0, s * 0.7), LEAF_B, seg=8)
    for i in range(4):                                       # flowers
        a = rng.random() * TAU
        g.sphere(0.09, (0.7 * s * math.cos(a), 0.7 * s * math.sin(a), s * 0.95), rng.choice(FLOWERS), seg=6)
    return g.build(name, loc=loc)


dg = bpy.context.evaluated_depsgraph_get()
trees = []
for i, ((x, y, base_z), size) in enumerate(tree_spots):
    w = W((x, y, 0))
    hit, loc, *_ = sc.ray_cast(dg, Vector((w.x, w.y, 60)), Vector((0, 0, -1)))
    if not hit:
        continue
    base = Vector((w.x, w.y, loc.z - 0.05))
    yaw = math.atan2(w.y, w.x) + rng.uniform(-0.6, 0.6)   # leaning out toward the sea
    if size < 0.045:
        trees.append(bush(f'tree_{len(trees)}', base, rng.uniform(0.7, 1.1)))
    else:
        trees.append(palm(f'tree_{len(trees)}', base, min(9.5, max(4.5, size * S * 1.1)) * rng.uniform(0.85, 1.1), yaw, rng.uniform(0.15, 0.45)))
for o in stands:                                             # bushes with flowers at the stands' ends
    for sx in (-1, 1):
        length = (2 * L - 2) if 'left' in o.name or 'right' in o.name else (2 * WD + 4)
        rot = Matrix.Rotation(o.rotation_euler.z, 4, 'Z')
        pos = Vector(o.location) + rot @ Vector((sx * (length / 2 + 1.1), 1.2, 0))
        trees.append(bush(f'tree_{len(trees)}', pos, rng.uniform(0.6, 0.9)))
print(f'{len(trees)} palms and bushes')

# Ball baskets by the net posts (the model's yellow crates were removed).
for sx in (-1, 1):
    g = Geo()
    g.cyl(0.42, 0.5, (0, 0, 0.25), WOOD_D, seg=12, r2=0.5, bevel=0.02)
    g.cyl(0.52, 0.06, (0, 0, 0.53), WOOD, seg=12, bevel=0.02)
    for i in range(7):
        a = i * TAU / 7
        g.sphere(0.11, (0.26 * math.cos(a), 0.26 * math.sin(a), 0.56), BALL, seg=8)
    g.sphere(0.11, (0, 0, 0.64), BALL, seg=8)
    g.build(f'basket_{0 if sx < 0 else 1}', loc=(sx * (WD + 2.4), 0, 0))

# ====================================================================== sea
Pw = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get('co', Pw)
bottom = float(Pw.reshape(-1, 3)[:, 2].min())
sea_z = bottom + 1.2
g = Geo()
g.cyl(420, 0.2, (0, 0, sea_z - 0.1), mat('#1fa9d4', rough=0.2, name='sea'), seg=64)
g.cyl(80, 0.2, (0, 0, sea_z - 0.02), mat('#5fdcec', rough=0.25, name='shallows'), seg=64)   # turquoise shallows around the island
sea = g.build('sea')
# Planar UVs (one tile per 24 m) so Kit3D.liven can scroll a ripple texture over it.
uvl = sea.data.uv_layers.new(name='uv')
for loop in sea.data.loops:
    co = sea.data.vertices[loop.vertex_index].co
    uvl.data[loop.index].uv = (co.x / 24.0, co.y / 24.0)
print(f'sea at z = {sea_z:.2f} m (island bottom {bottom:.2f} m)')


# ====================================================================== gulls and clouds
def gull(name):
    g = Geo()
    g.sphere(0.22, (0, 0, 0), WHITE, scale=(0.6, 1.4, 0.5), seg=8)
    g.cone(0.06, 0.25, (0, 0.4, 0), mat('#f2b705', rough=0.6), seg=5, rot=(-math.pi / 2, 0, 0))
    body = g.build(name)
    for sx, nm in ((-1, 'wing_l'), (1, 'wing_r')):
        w = Geo()
        w.box((0.9, 0.34, 0.03), (sx * 0.5, 0, 0), WHITE, bevel=0.0)
        w.box((0.3, 0.24, 0.03), (sx * 1.0, 0.02, 0), GREY, bevel=0.0)
        w.build(nm, parent=body, loc=(sx * 0.1, 0, 0.05))
    return body


birds = [gull(f'bird_{i}') for i in range(3)]


def cloud(name, loc, s):
    g = Geo()
    for i in range(rng.randint(3, 6)):
        r = s * rng.uniform(0.5, 1.0)
        g.sphere(r, (rng.uniform(-1.3, 1.3) * s, rng.uniform(-0.7, 0.7) * s, rng.uniform(-0.1, 0.4) * s),
                 CLOUD, scale=(1, 1, 0.65), seg=10)
    g.box((s * 2.6, s * 1.6, s * 0.25), (0, 0, -s * 0.25), CLOUD, bevel=s * 0.1)   # a flat base, like a cartoon cloud
    return g.build(name, loc=loc)


clouds = []
for i in range(10):                                       # a ring of big clouds around the horizon
    a = TAU * i / 10 + rng.uniform(-0.25, 0.25)
    r = rng.uniform(70, 120)
    clouds.append(cloud(f'cloud_{len(clouds)}', (r * math.cos(a), r * math.sin(a), rng.uniform(16, 30)), rng.uniform(5, 9)))
for i in range(4):                                        # smaller ones nearer and lower, for parallax
    a = TAU * i / 4 + rng.uniform(-0.5, 0.5)
    r = rng.uniform(42, 60)
    clouds.append(cloud(f'cloud_{len(clouds)}', (r * math.cos(a), r * math.sin(a), rng.uniform(12, 18)), rng.uniform(2.5, 4)))


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


if boat:                                               # rocking at its mooring, 7 swells per loop
    b = boat[0]
    base = b.location.copy()
    for f in range(0, LOOP + 1, 4):
        t = TAU * f / LOOP
        key(b, f, loc=base + Vector((0, 0, 0.18 * math.sin(7 * t))),
            rot=(math.radians(2.5) * math.sin(7 * t + 1.2), math.radians(1.8) * math.sin(5 * t), 0))
    linear(b)
for i, b in enumerate(birds):                          # circling the island, flapping
    R, H, ph = 34 + 9 * i, 15 + 3 * i, TAU * i / 3
    for f in range(0, LOOP + 1, 3):
        a = TAU * f / LOOP * (1 if i % 2 else -1) + ph
        da = TAU / LOOP * 3 * (1 if i % 2 else -1)
        pos = Vector((R * math.cos(a), R * math.sin(a), H + 1.5 * math.sin(3 * a)))
        nxt = Vector((R * math.cos(a + da), R * math.sin(a + da), H))
        yaw = math.atan2((nxt - pos).y, (nxt - pos).x) - math.pi / 2
        key(b, f, loc=pos, rot=(0, 0, yaw))
    flap = 0.0 if i == 1 else 1.0                       # one gull glides
    for w in b.children:
        sx = -1 if w.name == 'wing_l' else 1
        for f in range(0, LOOP + 1, 4):
            t = TAU * f / LOOP * 30 + ph                 # 1.5 flaps a second
            key(w, f, rot=(0, sx * math.radians(38) * math.sin(t) * flap + sx * math.radians(6), 0))
        linear(w)
    linear(b)

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
    world.color = (0.56, 0.83, 1.0)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.lens = 32
    cam_data.clip_end = 1000
    views = [('', (0.55, 0.9, 0.62), (0, 0, 2), 95), ('_far', (-0.5, -0.9, 0.6), (0, 0, 2), 95),
             ('_cam', (0, 1, 0.3), (0, 0, 1), 34), ('_stand', (0.9, 0.5, 0.45), (-12, 0, 2), 28)]
    for suffix, d, look, dist in views:
        d = Vector(d).normalized()
        cam.location = Vector(look) + d * dist
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.frame_set(0)
        sc.render.filepath = PREVIEW.replace('.png', f'{suffix}.png')
        bpy.ops.render.render(write_still=True)
    print('preview', PREVIEW)

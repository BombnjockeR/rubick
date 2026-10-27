"""Tennis venue: the "Tropical Bunny Tennis Island" source model turned into a
court in the racket engine's coordinates.

    blender -b --factory-startup --python art/island.py -- assets/island_court.glb

The AI-generated island (art/source/environments/tennis/, never modified) has a
squat court (1.3:1 instead of 2.17:1), rotated ~9 degrees, with a bumpy surface
and a hole at one corner. So the island is aligned and scaled around its court,
its court is covered by a crisp regulation court (same layout as the stadium in
sports.py), its net replaced, and a sea added; stands, trees, piers and rocks are
kept as they are. Output (Blender Z-up -> glTF Y-up), meters: court centred on
the origin, long axis along Blender Y, net at y = 0, playing surface at z = 0.
Nodes: island, island_court, sea.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
import rig  # noqa: E402
from rlib import Geo, mat  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'environments', 'tennis', 'island_tennis_court_3d_model.fbx')
args = rig.script_args()
OUT = args[0] if args else 'island_court.glb'

# Court as measured on the source model (top-down flat render, colour mask of the
# green court + white lines, minimum-area rectangle; see knowledge/island-court.md).
COURT_CENTRE = (0.0364, -0.0856)  # source units (x, y)
COURT_ANGLE = -8.9                # degrees: the court's across-axis, from +X
COURT_LENGTH = 0.2643             # baseline to baseline, source units
SURROUND = (0.3105, 0.3683)       # red surround (across, along), source units, ~2 degrees off the court
L, WD, WS = 23.77 / 2, 10.97 / 2, 8.23 / 2   # regulation half-length, half-widths (doubles, singles)
S = 2 * L / COURT_LENGTH          # ~90: island units -> meters
SPIN = 180.0                      # long grandstand behind the far (side 1) baseline, away from the main camera

rig.reset()
island = rig.load_mesh(SRC, 'island')
rig.clean_material(island, 'island', roughness=0.9)
M = (Matrix.Rotation(math.radians(-COURT_ANGLE + SPIN), 4, 'Z') @ Matrix.Scale(S, 4)
     @ Matrix.Translation(Vector((-COURT_CENTRE[0], -COURT_CENTRE[1], 0))))
island.data.transform(M)

# Ground under the new court: the old court and its surround are bumpy, so cast
# rays down on a 1 m grid over the area the new court covers and take the
# highest ground hit (props such as benches stand well above it and are ignored).
SLAB = (SURROUND[0] * S + 2.0, SURROUND[1] * S + 2.0)
me = island.data
dg = bpy.context.evaluated_depsgraph_get()
sc = bpy.context.scene
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
island.data.transform(Matrix.Translation(Vector((0, 0, -drop))))
print(f'island: scale {S:.1f}, old court at {surface:.2f} m (bumps up to {top:.2f}), lowered by {drop:.2f} m')
P = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get('co', P)
P = P.reshape(-1, 3)

# The island's own net (a tall panel ~1.2 m off the court's centre line, with box
# posts) would stick out of the new court: remove whatever stands above it there.
bm = bmesh.new()
bm.from_mesh(me)
net = [f for f in bm.faces
       if all(-0.6 < v.co.y < 2.8 and abs(v.co.x) < 11.8 and -0.9 < v.co.z < 2.9 for v in f.verts)
       and max(v.co.z for v in f.verts) > 0.05]
bmesh.ops.delete(bm, geom=net, context='FACES')
# The old court surface (bumpy, partly higher than the new one in places) and
# anything low on it go too: the new court's plinth replaces that ground.
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
bm.to_mesh(me)
bm.free()
print(f'island: removed {len(net)} faces of the old net, {len(old)} of the old court; flattened {flat} ground faces')

rig.downsize_texture(island, 2048, os.path.join(os.path.dirname(os.path.abspath(OUT)), '_tex'), quality=85)

# ---------------------------------------------------------------- new court
SURF = mat('#c0533f', rough=0.8)          # terracotta surround, sampled from the island texture
COURT = mat('#2a7a55', rough=0.75)        # court green, sampled likewise
LINE = mat('#ffffff', rough=0.5)
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
# Net (posts 0.914 m outside the doubles lines), wooden posts to match the island
wood = mat('#8a5a35', rough=0.8)
for x in (-WD - 0.914, WD + 0.914):
    g.cyl(0.06, 1.07, (x, 0, 0.535), wood, seg=12)
    g.sphere(0.07, (x, 0, 1.08), wood, seg=10)
g.box(((WD + 0.914) * 2, 0.03, 0.86), (0, 0, 0.48), mat('#1f3b33', rough=0.95), bevel=0)
g.box(((WD + 0.914) * 2, 0.06, 0.07), (0, 0, 0.93), LINE, bevel=0.02)
g.box((0.05, 0.035, 0.9), (0, 0, 0.47), LINE, bevel=0)
# The source model has a hole at one corner of its court that reaches past the
# plinth's rounded corner; a plate just under the old ground level fills it.
g.cyl(24, 0.1, (0, 0, -0.85), SURF, seg=48)
court = g.build('island_court')

# ---------------------------------------------------------------- sea
bottom = float(P[:, 2].min())
sea_z = bottom + 1.2
g = Geo()
g.cyl(420, 0.2, (0, 0, sea_z - 0.1), mat('#2fa9dc', rough=0.25), seg=64)
g.cyl(75, 0.2, (0, 0, sea_z - 0.02), mat('#5fd0ec', rough=0.3), seg=64)   # shallows around the island
sea = g.build('sea')
print(f'sea at z = {sea_z:.2f} m (island bottom {bottom:.2f} m)')

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
rig.activate(island, court, sea)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_animations=False, export_lights=False, export_cameras=False, export_yup=True)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

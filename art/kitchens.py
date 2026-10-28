"""Cooking venues: the three AI-generated dioramas in art/source/environments/cooking/
turned into the kitchens described in js/games/kitchens.js.

    blender -b --factory-startup --python art/kitchens.py -- OUTDIR [paddy beach city] [--preview]

Each source model (never modified) was generated from an isometric picture and
leans back by 12-37 degrees, with its stations painted onto counter-sized boxes.
For every kitchen in kitchens.js this build:
  levels    the model (the fitted ground plane becomes horizontal), scales it so a
            counter pitch is one metre and centres it on the tile grid
  removes   whatever stands on station, counter and bridge tiles (the painted
            stations: the game puts its own templates from kitchen.glb there) and
            small props on the walkways (rocks, baskets, posts a chef would trip on)
  flattens  the ground under the walkable and station tiles to z = 0
  adds      plank bridges over the water on `=` tiles, gulls on the beach
  splits    trees (tree_*) and banners (flag_*, morph target "wave") for the wind,
            boats (boat_*) that rock in a 16 s baked loop
Output: Blender Z-up -> glTF Y-up, meters; tile (c, r) of the map sits at
x = c - (cols-1)/2, Blender y = (rows-1)/2 - r (glTF z = r - (rows-1)/2), floor at 0.
Nodes: land, bridge_*, tree_*, flag_*, boat_*, bird_* (beach).
"""
import json
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
import rlib  # noqa: E402
from rlib import Geo, mat, key  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in rig.script_args() if not a.startswith('--')]
PREVIEW = '--preview' in rig.script_args()
OUTDIR = args[0] if args else '.'
TAU = math.tau
LOOP = 480      # 16 s at 30 fps

src = open(os.path.join(HERE, '..', 'js', 'games', 'kitchens.js'), encoding='utf-8').read()
head = 'window.MabarKitchens = '
KITCHENS = json.loads(src[src.index(head) + len(head):].strip().rstrip(';'))
WANT = args[1:] or list(KITCHENS)
STATION = set('#BSCFPWXrnvtfqskclp')


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


def build(kid, k):
    rng = random.Random(3)
    sc = rig.reset()
    rlib._MATS.clear()                               # materials of the previous map's scene are gone
    sc.frame_start, sc.frame_end = 0, LOOP
    MAP = k['map']
    COLS, ROWS = len(MAP[0]), len(MAP)
    land = rig.load_mesh(os.path.join(HERE, 'source', k['source']), 'land')
    FC = rig.face_colors(land)
    rig.clean_material(land, 'kitchen', roughness=0.9)
    me = land.data

    # Level, scale and centre: tile (c, r) -> (c - (COLS-1)/2, (ROWS-1)/2 - r).
    a, b, c0 = k['level']['plane']
    n = Vector((-a, -b, 1.0)).normalized()
    R = n.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
    S = k['scale']
    M = (Matrix.Translation(Vector((-k['x0'] - COLS / 2, -k['y0'] + ROWS / 2, 0))) @ Matrix.Scale(S, 4)
         @ Matrix.Translation(Vector((0, 0, -k['level']['floor']))) @ R)
    me.transform(M)

    P, E = rig.mesh_arrays(land)
    comp = rig.components(len(P), E)
    fcomp = comp[np.array([p.vertices[0] for p in me.polygons])]
    ids, counts = np.unique(comp, return_counts=True)
    MAIN = int(ids[np.argmax(counts)])
    pieces = {}
    for cid, cnt in zip(ids, counts):
        vm = comp == cid
        lo, hi = P[vm].min(0), P[vm].max(0)
        fm = fcomp == cid
        pieces[int(cid)] = dict(id=int(cid), n=int(cnt), lo=lo, hi=hi, c=(lo + hi) / 2, s=hi - lo, fm=fm,
                                col=FC[fm].mean(0) if fm.any() else np.zeros(3))
    others = [p for p in pieces.values() if p['id'] != MAIN]
    dg = bpy.context.evaluated_depsgraph_get()

    def ground_of(p, reach=1.2):
        dx, dy = p['s'][0] * 0.35, p['s'][1] * 0.35
        for ox, oy in ((0, 0), (dx, 0), (-dx, 0), (0, dy), (0, -dy)):
            z = p['lo'][2] + 0.03
            for _ in range(4):
                ok, loc, nrm, idx, *_ = sc.ray_cast(dg, Vector((p['c'][0] + ox, p['c'][1] + oy, z)), Vector((0, 0, -1)), distance=reach)
                if not ok:
                    break
                if fcomp[idx] != p['id']:
                    return int(fcomp[idx])
                z = loc.z - 0.01
        return None
    ground = {p['id']: ground_of(p) for p in others}

    def tile_of(x, y):
        return int(math.floor(x + COLS / 2)), int(math.floor(ROWS / 2 - y))

    def char_at(c, r):
        return MAP[r][c] if 0 <= r < ROWS and 0 <= c < COLS else '~'

    def centre(c, r):
        return Vector((c - (COLS - 1) / 2, (ROWS - 1) / 2 - r, 0.0))

    def green(p):
        col = p['col']
        return col[1] > col[0] * 1.04 and col[1] > col[2] * 1.15

    # ------------------------------------------------------------- removals
    kill, why = set(), {}
    for p in others:
        c, r = tile_of(p['c'][0], p['c'][1])
        ch = char_at(c, r)
        fp = max(p['s'][0], p['s'][1])
        if ch in STATION and fp < 2.6:
            kill.add(p['id']); why[p['id']] = f'on {ch}'
        elif ch == '=' and fp < 3.5:
            kill.add(p['id']); why[p['id']] = 'bridge'
        elif ch == '.' and fp < 0.8 and p['lo'][2] < 0.6 and not green(p):
            kill.add(p['id']); why[p['id']] = 'walkway'
    for p in others:                                   # bridge tiles take everything nearby too (planks straddle tiles)
        if p['id'] in kill or max(p['s'][0], p['s'][1]) > 3.5 or green(p):
            continue
        for r in range(ROWS):
            for c in range(COLS):
                if MAP[r][c] == '=' and (centre(c, r) - Vector((p['c'][0], p['c'][1], 0))).length < 0.75:
                    kill.add(p['id']); why[p['id']] = 'bridge'
    changed = True
    while changed:                                     # and whatever stood on a removed piece
        changed = False
        for p in others:
            if p['id'] not in kill and ground[p['id']] in kill:
                kill.add(p['id']); why[p['id']] = 'on removed'; changed = True
    print(f'{kid}: removed {len(kill)} pieces:', ', '.join(f'{why[i]}' for i in sorted(kill)))

    pid = me.attributes.new('pid', 'INT', 'POINT')
    pid.data.foreach_set('value', comp.astype(np.int32))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if fcomp[f.index] in kill], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me)
    bm.free()

    # ------------------------------------------------------------- split-offs
    def vert_pids():
        out = np.empty(len(land.data.vertices), dtype=np.int32)
        land.data.attributes['pid'].data.foreach_get('value', out)
        return out

    def split(name, idset):
        return rig.split_off(land, np.isin(vert_pids(), list(idset)), name)

    taken = set(kill)
    trees = []
    for p in sorted(others, key=lambda q: -q['n']):
        s = p['s']
        if (p['id'] in taken or not green(p) or p['n'] < 16 or not 0.35 <= max(s[0], s[1]) <= 4.0 or s[2] < 0.3
                or ground[p['id']] is None):
            continue
        group = {p['id']}
        for q in others:
            if q['id'] not in taken and q['id'] != p['id'] and ground[q['id']] == p['id'] and green(q):
                group.add(q['id'])
        taken |= group
        o = split(f'tree_{len(trees)}', group)
        base = Vector((p['c'][0], p['c'][1], p['lo'][2]))
        o.data.transform(Matrix.Translation(-base))
        o.location = base
        trees.append(o)
    flags = []
    for p in others:
        s = p['s']
        if (p['id'] not in taken and p['n'] <= 16 and s[2] > 0.5 and s[2] > max(s[0], s[1]) * 0.8
                and min(s[0], s[1]) < 0.2 and p['col'].mean() > 0.3 and p['lo'][2] > 0.3):
            taken.add(p['id'])
            o = split(f'flag_{len(flags)}', {p['id']})
            top = Vector((p['c'][0], p['c'][1], p['hi'][2]))
            o.data.transform(Matrix.Translation(-top))
            o.location = top
            co = np.array([v.co[:] for v in o.data.vertices])
            thin = 0 if np.ptp(co[:, 0]) < np.ptp(co[:, 1]) else 1
            zmin, zmax = co[:, 2].min(), co[:, 2].max()
            o.shape_key_add(name='Basis', from_mix=False)
            sk = o.shape_key_add(name='wave', from_mix=False)
            for i, v in enumerate(co):
                t = (zmax - v[2]) / max(1e-6, zmax - zmin)
                d = np.zeros(3)
                d[thin] = 0.12 * t * t * (zmax - zmin)
                sk.data[i].co = Vector((v + d).tolist())
            sk.value = 0.0
            flags.append(o)
    boats = []
    for p in sorted(others, key=lambda q: -q['n']):
        s = p['s']
        if (p['id'] in taken or p['n'] < 30 or max(s[0], s[1]) < 2.0 or not 0.4 < s[2] < 2.2 or p['lo'][2] > 0.6
                or green(p) or ground[p['id']] not in (None, MAIN) or char_at(*tile_of(p['c'][0], p['c'][1])) != '~'):
            continue                                   # a hull: big, deep, afloat on a scenery tile (bridges are thin)
        crew = {p['id']} | {q['id'] for q in others if q['id'] not in taken and q['id'] != p['id']
                            and np.all(q['c'][:2] > p['lo'][:2] - 0.3) and np.all(q['c'][:2] < p['hi'][:2] + 0.3)
                            and q['lo'][2] < p['hi'][2] + 1.5}
        taken |= crew
        o = split(f'boat_{len(boats)}', crew)
        base = Vector((p['c'][0], p['c'][1], p['lo'][2] + 0.1))
        o.data.transform(Matrix.Translation(-base))
        o.location = base
        boats.append(o)
    print(f'{kid}: split off {len(trees)} trees, {len(flags)} banners, {len(boats)} boats')

    # ------------------------------------------------------------- floor and water
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    flat = 0
    for v in bm.verts:
        c, r = tile_of(v.co.x, v.co.y)
        if char_at(c, r) != '~' and abs(v.co.z) < 0.3:
            v.co.z = 0.0
            flat += 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(f'{kid}: flattened {flat} ground vertices')
    rig.downsize_texture(land, 2048, os.path.join(OUTDIR, '_tex'), quality=85)

    # ------------------------------------------------------------- bridges
    PLANK = mat('#b8824a', rough=0.85)
    PLANK_D = mat('#8a5a30', rough=0.9)
    nb = 0
    for r in range(ROWS):
        for c in range(COLS):
            if MAP[r][c] != '=':
                continue
            ns = char_at(c, r - 1) in '.=' or char_at(c, r + 1) in '.='   # crossing runs north-south
            ctr = centre(c, r)
            g = Geo()
            for i in range(5):
                t = -0.4 + i * 0.2
                size = (0.19, 1.0, 0.08) if ns else (1.0, 0.19, 0.08)
                loc = (t, 0, 0.04) if ns else (0, t, 0.04)
                g.box(size, loc, PLANK if i % 2 else PLANK_D, bevel=0.01)
            for sgn in (-1, 1):                                            # rails on the water sides
                for e in (-0.42, 0.42):
                    loc = (sgn * 0.5, e, 0.45) if ns else (e, sgn * 0.5, 0.45)
                    g.cyl(0.04, 0.8, loc, PLANK_D, seg=8)
                loc = (sgn * 0.5, 0, 0.82) if ns else (0, sgn * 0.5, 0.82)
                g.cyl(0.03, 1.0, loc, PLANK, seg=8, rot=(math.pi / 2, 0, 0) if ns else (0, math.pi / 2, 0))
            g.build(f'bridge_{nb}', loc=ctr)
            nb += 1

    # ------------------------------------------------------------- gulls (beach)
    birds = []
    if kid == 'beach':
        WHITE = mat('#f7f7f4', rough=0.9)
        for i in range(2):
            g = Geo()
            g.sphere(0.12, (0, 0, 0), WHITE, scale=(0.6, 1.4, 0.5), seg=8)
            g.cone(0.035, 0.14, (0, 0.22, 0), mat('#f2b705', rough=0.6), seg=5, rot=(-math.pi / 2, 0, 0))
            body = g.build(f'bird_{i}')
            for sx, nm in ((-1, 'wing_l'), (1, 'wing_r')):
                w = Geo()
                w.box((0.5, 0.2, 0.02), (sx * 0.28, 0, 0), WHITE, bevel=0.0)
                w.build(nm, parent=body, loc=(sx * 0.05, 0, 0.03))
            birds.append(body)

    # ------------------------------------------------------------- animation
    for i, o in enumerate(boats):
        base = o.location.copy()
        for f in range(0, LOOP + 1, 4):
            t = TAU * f / LOOP
            key(o, f, loc=base + Vector((0, 0, 0.06 * math.sin(5 * t + i))),
                rot=(math.radians(1.5) * math.sin(5 * t + 1.2 + i), math.radians(1.2) * math.sin(4 * t + i), o.rotation_euler.z))
        linear(o)
    for i, bd in enumerate(birds):
        Rr, H, ph = 7 + 3 * i, 5 + i, TAU * i / 2
        for f in range(0, LOOP + 1, 3):
            ang = TAU * f / LOOP * (1 if i % 2 else -1) + ph
            da = TAU / LOOP * 3 * (1 if i % 2 else -1)
            pos = Vector((Rr * math.cos(ang), Rr * math.sin(ang) + 2, H + 0.6 * math.sin(3 * ang)))
            nxt = Vector((Rr * math.cos(ang + da), Rr * math.sin(ang + da) + 2, H))
            yaw = math.atan2((nxt - pos).y, (nxt - pos).x) - math.pi / 2
            key(bd, f, loc=pos, rot=(0, 0, yaw))
        for w in bd.children:
            sx = -1 if w.name == 'wing_l' else 1
            for f in range(0, LOOP + 1, 4):
                t = TAU * f / LOOP * 24 + ph
                key(w, f, rot=(0, sx * math.radians(35) * math.sin(t) + sx * math.radians(6), 0))
            linear(w)
        linear(bd)

    # ------------------------------------------------------------- export
    out = os.path.join(OUTDIR, f'kitchen_{kid}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', export_apply=True,
        export_animations=bool(boats or birds), export_animation_mode='ACTIVE_ACTIONS', export_frame_range=True,
        export_force_sampling=True, export_optimize_animation_size=True,
        export_morph=True, export_lights=False, export_cameras=False, export_yup=True,
    )
    print('exported', out, os.path.getsize(out) // 1024, 'KB')

    if PREVIEW:
        for m in bpy.data.materials:
            bb = next((nd for nd in m.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED'), None) if m.node_tree else None
            if bb and not any(nd.type == 'TEX_IMAGE' for nd in m.node_tree.nodes):
                m.diffuse_color = bb.inputs['Base Color'].default_value
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'STUDIO'
        sc.display.shading.color_type = 'TEXTURE'
        sc.display.shading.show_shadows = True
        sc.display.shading.show_cavity = True
        sc.render.image_settings.file_format = 'PNG'
        sc.render.resolution_x, sc.render.resolution_y = 1600, 1100
        world = bpy.data.worlds.new('w')
        sc.world = world
        world.color = (0.75, 0.88, 1.0)
        cam_data = bpy.data.cameras.new('cam')
        cam = bpy.data.objects.new('cam', cam_data)
        sc.collection.objects.link(cam)
        sc.camera = cam
        cam_data.lens = 35
        cam_data.clip_end = 500
        for suffix, d, dist in (('', (0.0, -0.85, 0.75), 24), ('_iso', (0.6, -0.8, 0.6), 26)):
            d = Vector(d).normalized()
            cam.location = Vector((0, 0, 0)) + d * dist
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(OUTDIR, f'kitchen_{kid}{suffix}.png')
            bpy.ops.render.render(write_still=True)
        cam.location = (0, 0, 60)
        cam.rotation_euler = (0, 0, 0)
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = max(COLS, ROWS) + 1
        sc.render.filepath = os.path.join(OUTDIR, f'kitchen_{kid}_top.png')
        bpy.ops.render.render(write_still=True)


os.makedirs(OUTDIR, exist_ok=True)
for kid in WANT:
    build(kid, KITCHENS[kid])

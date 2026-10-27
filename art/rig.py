"""Character rigging toolkit for Mabar (Blender, run headless).

Turns an unrigged single-mesh character (an AI-generated FBX in art/source/)
into a skinned, animated, game-ready glTF. Used by art/animals.py.

  load_mesh()   import the source FBX (the file itself is only read)
  build_rig()   armature with the bone set shared by every animal (BONES)
  skin()        heat-diffusion weights, then region rules and cleanup
  Anim          keyframe helper: rotate bones about body axes, key whole poses
  export_glb()  one .glb with the skinned mesh and every action

Conventions match rlib.Chibi: meters, Z up, the character faces -Y with its
feet on z = 0, centered on the origin. Body axes used by Anim.rot():
  'pitch'  about +X (the character's left): + tips the top of a bone forward
  'side'   about +Y (the character's back): + tips the top of a bone to its left
  'yaw'    about +Z (up):                   + turns a bone to the character's left
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector, kdtree

TAU = math.tau
AXES = {'pitch': Vector((1, 0, 0)), 'side': Vector((0, 1, 0)), 'yaw': Vector((0, 0, 1))}


def script_args():
    """Arguments after '--' (Blender CLI) or after the script name (bpy module)."""
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]


def reset(fps=30):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = fps
    return sc


def activate(*objs, mode=None):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[-1]
    if mode:
        bpy.ops.object.mode_set(mode=mode)


# ---------------------------------------------------------------- source mesh
def load_mesh(path, name, offset=(0, 0, 0)):
    """Import an FBX, join its meshes, bake transforms, then move it by -offset
    (offset = the point that should become the origin, e.g. the pelvis centre
    projected to the floor)."""
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    before = set(bpy.data.objects)
    sc = bpy.context.scene
    fps = sc.render.fps, sc.render.fps_base
    bpy.ops.import_scene.fbx(filepath=path)
    sc.render.fps, sc.render.fps_base = fps   # the importer switches the scene to the file's 24 fps
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    activate(*meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.transform(Matrix.Translation(-Vector(offset)))
    o.name = o.data.name = name
    return o


def mesh_arrays(o):
    """Vertex positions (N,3) and edge pairs (E,2) as numpy arrays."""
    me = o.data
    P = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', P)
    E = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', E)
    return P.reshape(-1, 3), E.reshape(-1, 2)


def components(n, E):
    """Connected-component id per vertex."""
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b in E:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return np.array([find(i) for i in range(n)])


def downsize_texture(o, size, out_dir, quality=88):
    """Replace the material's base-colour image with a size x size JPEG copy."""
    os.makedirs(out_dir, exist_ok=True)
    for slot in o.material_slots:
        m = slot.material
        if not m or not m.node_tree:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and max(n.image.size) > size:
                src = n.image
                img = src.copy()
                img.scale(size, size)
                path = os.path.join(out_dir, f'{o.name}_basecolor_{size}.jpg')
                sc = bpy.context.scene
                fmt = sc.render.image_settings
                saved = fmt.file_format, fmt.quality
                fmt.file_format = 'JPEG'
                fmt.quality = quality
                img.save_render(path, scene=sc)
                fmt.file_format, fmt.quality = saved
                img2 = bpy.data.images.load(path)
                img2.colorspace_settings.name = 'sRGB'
                n.image = img2
                bpy.data.images.remove(img)
                print(f'  texture {src.name} {tuple(src.size)} -> {size}px, {os.path.getsize(path) // 1024} KB')


def clean_material(o, name, roughness=0.8):
    """One Principled material fed directly by the base-colour image (the FBX
    importer adds unused Mapping / Normal Map nodes the glTF exporter dislikes)."""
    src = o.material_slots[0].material
    img = next((n.image for n in src.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    if img:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    o.data.materials.clear()
    o.data.materials.append(m)
    return m


# ---------------------------------------------------------------- remodelling
# AI-generated characters come with odd details for animation, e.g. a hand modelled
# fused into the shorts. These fix the mesh before rigging (the FBX is only read).
def face_colors(o):
    """Base-colour texture under each face's UV centre, as an (F, 3) array."""
    me = o.data
    img = next(n.image for n in o.material_slots[0].material.node_tree.nodes if n.type == 'TEX_IMAGE')
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3]
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', lt)
    sums = np.zeros((len(lt), 2))
    np.add.at(sums, np.repeat(np.arange(len(lt)), lt), uv)
    c = (sums / lt[:, None]) % 1.0
    return px[np.clip((c[:, 1] * H).astype(int), 0, H - 1), np.clip((c[:, 0] * W).astype(int), 0, W - 1)]


def texture_sampler(o):
    """uv -> base colour (RGB) of the object's texture, or None without one."""
    try:
        img = next(n.image for n in o.material_slots[0].material.node_tree.nodes if n.type == 'TEX_IMAGE')
    except (IndexError, AttributeError, StopIteration):
        return None
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[:, :, :3]
    return lambda uv: px[min(H - 1, max(0, int((uv[1] % 1.0) * H))), min(W - 1, max(0, int((uv[0] % 1.0) * W)))]


def _patch(bm, edges, uvl, color=None, prefer=None):
    """Close the boundary loops among `edges` with faces textured flat in the colour
    of the surface around the hole: with `color` (a texture_sampler), a neighbouring
    face of the `prefer` colour if one borders the hole (e.g. the shorts a limb was
    buried in), else the neighbour closest to the area-weighted mean colour around
    it; without, the largest neighbouring face."""
    if not edges:
        return []
    faces = bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']
    new = set(faces)
    centre = lambda g: sum((lp[uvl].uv for lp in g.loops), g.loops[0][uvl].uv * 0) / len(g.loops)
    for f in faces:
        around = {lp.face for v in f.verts for lp in v.link_loops if lp.face not in new}
        best = None
        if around and color is not None:
            cols = {g: np.asarray(color(centre(g))) for g in around}
            area = {g: g.calc_area() for g in around}
            liked = [g for g in around if prefer is not None and np.linalg.norm(cols[g] - np.asarray(prefer)) < 0.15]
            if liked:
                best = max(liked, key=lambda g: area[g])
            else:
                mean = sum(cols[g] * area[g] for g in around) / max(1e-12, sum(area.values()))
                best = min(around, key=lambda g: float(np.linalg.norm(cols[g] - mean)))
        elif around:
            best = max(around, key=lambda g: g.calc_area())
        # the middle of that face, not its corner (atlas islands have dark gutters)
        uv = centre(best) if best else f.loops[0][uvl].uv * 0
        for lp in f.loops:
            lp[uvl].uv = uv
    if not faces:
        return []
    # fan from a centre vertex: no sliver triangles (they break heat weighting)
    poked = bmesh.ops.poke(bm, faces=faces, center_mode='MEAN')
    for v in poked['verts']:
        uvs = [lp[uvl].uv.copy() for f in v.link_faces for lp in f.loops if lp.vert is not v]
        for lp in v.link_loops:
            lp[uvl].uv = uvs[0] if uvs else (0.0, 0.0)
    return poked['faces']


def detach(o, region, other):
    """Cut the mesh where `region` faces (a fist) meet `other` faces (the shorts it was
    modelled into) and close the opening on each side. Masks are per face."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    side = {f: ('r' if region[f.index] else 'o' if other[f.index] else '') for f in bm.faces}
    cut = [e for e in bm.edges if len(e.link_faces) == 2
           and {side[e.link_faces[0]], side[e.link_faces[1]]} == {'r', 'o'}]
    if not cut:
        bm.free()
        return 0
    bmesh.ops.split_edges(bm, edges=cut)
    for want in ('r', 'o'):
        edges = [e for e in bm.edges if e.is_boundary and e.link_faces and side.get(e.link_faces[0]) == want
                 and any(v.is_boundary for v in e.verts)]
        near = {v for e in cut for v in e.verts}
        edges = [e for e in edges if any((v.co - w.co).length < 1e-6 for v in e.verts for w in near)]
        _patch(bm, edges, uvl, texture_sampler(o))
    bm.to_mesh(o.data)
    bm.free()
    return len(cut)


def cut_free(o, region, others):
    """Separate `region` faces (a forearm and hand) from the `others` faces they were
    modelled fused to (shorts, a jacket hem): split the shared edges, rip any vertex
    still shared by both sides, and patch closed openings on each side."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    side = {f: ('r' if region[f.index] else 'o' if others[f.index] else '') for f in bm.faces}
    cut = [e for e in bm.edges if len(e.link_faces) == 2
           and {side[e.link_faces[0]], side[e.link_faces[1]]} == {'r', 'o'}]
    if cut:
        bmesh.ops.split_edges(bm, edges=cut)
    ripped = 0
    for v in list(bm.verts):
        o_faces = [f for f in v.link_faces if side.get(f) == 'o']
        if o_faces and any(side.get(f) == 'r' for f in v.link_faces):
            copies = [bmesh.utils.face_vert_separate(f, v) for f in o_faces]
            copies = [c for c in copies if c is not v]
            if len(copies) > 1:
                bmesh.ops.pointmerge(bm, verts=copies, merge_co=v.co)
            ripped += 1
    for want in ('r', 'o'):
        edges = [e for e in bm.edges if e.is_boundary and e.link_faces and side.get(e.link_faces[0]) == want]
        _patch(bm, edges, uvl, texture_sampler(o))
    bm.to_mesh(o.data)
    bm.free()
    return len(cut), ripped


def delete_faces(o, mask, patch=False, prefer=None):
    """Delete the masked faces (and vertices left without faces); patch=True closes
    the openings they leave (`prefer`: see _patch)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    gone = [bm.faces[i] for i in np.nonzero(mask)[0]]
    rim = {e for f in gone for e in f.edges}
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    if patch:
        _patch(bm, [e for e in rim if e.is_valid and e.is_boundary], bm.loops.layers.uv.active, texture_sampler(o), prefer)
    bm.to_mesh(o.data)
    bm.free()
    return len(gone)


def face_pieces(o, mask):
    """Connected pieces (sharing an edge) of the faces in `mask`: a list of face-index arrays."""
    me = o.data
    le = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('edge_index', le)
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', lt)
    lf = np.repeat(np.arange(len(lt)), lt)
    parent = {int(f): int(f) for f in np.nonzero(mask)[0]}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    by_edge = {}
    for f, e in zip(lf[mask[lf]], le[mask[lf]]):
        by_edge.setdefault(int(e), []).append(int(f))
    for fs in by_edge.values():
        for g in fs[1:]:
            ra, rb = find(fs[0]), find(g)
            if ra != rb:
                parent[ra] = rb
    groups = {}
    for f in parent:
        groups.setdefault(find(f), []).append(f)
    return [np.array(v) for v in groups.values()]


def tidy_selection(o, sel, band, keep_out=None, min_piece=12, max_hole=20, surround=0.6):
    """A face selection made by geometry tests (distance, normals, colour) comes out
    speckled on sculpted models. Unselected pieces inside `band` of up to `max_hole`
    faces, mostly (`surround`) bordered by the selection, join it (left behind they'd
    be shards on the body); selected pieces under `min_piece` faces that are joined
    to other faces are dropped (lifted they'd be shards on the limb). `keep_out`
    faces never join."""
    sel = sel.copy()
    keep_out = np.zeros(len(sel), bool) if keep_out is None else keep_out
    me = o.data
    le = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('edge_index', le)
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', lt)
    lf = np.repeat(np.arange(len(lt)), lt)
    nbr = [[] for _ in range(len(lt))]
    by_edge = {}
    for f, e in zip(lf, le):
        by_edge.setdefault(int(e), []).append(int(f))
    for fs in by_edge.values():
        for a in fs:
            nbr[a].extend(g for g in fs if g != a)
    added = dropped = 0
    for _ in range(2):
        for piece in face_pieces(o, band & ~sel & ~keep_out):
            inside = set(piece.tolist())
            border = [g for f in piece for g in nbr[f] if g not in inside]
            if len(piece) <= max_hole and border and np.mean(sel[border]) >= surround:
                sel[piece] = True
                added += len(piece)
    for piece in face_pieces(o, sel):
        inside = set(piece.tolist())
        if len(piece) < min_piece and any(g not in inside for f in piece for g in nbr[f]):
            sel[piece] = False
            dropped += len(piece)
    return sel, added, dropped


def mark_islands(o):
    """Store each face's connected piece (1-based) in the face attribute 'island0',
    to tell later which small pieces a cut created (see drop_fragments)."""
    me = o.data
    ids = np.zeros(len(me.polygons), dtype=np.int64)
    for k, piece in enumerate(face_pieces(o, np.ones(len(me.polygons), bool))):
        ids[piece] = k + 1
    a = me.attributes.get('island0') or me.attributes.new('island0', 'INT', 'FACE')
    a.data.foreach_set('value', ids)


def drop_fragments(o, max_faces=40):
    """Delete small loose pieces that cuts made since mark_islands(): a piece of up
    to `max_faces` faces that was part of a piece at least twice its size. Pieces
    that were already separate (buttons, laces) stay."""
    me = o.data
    a = me.attributes.get('island0')
    if a is None:
        return 0
    ids = np.zeros(len(me.polygons), dtype=np.int64)
    a.data.foreach_get('value', ids)
    before = np.bincount(ids)
    gone = np.zeros(len(me.polygons), bool)
    for piece in face_pieces(o, np.ones(len(me.polygons), bool)):
        src = ids[piece]
        src = src[src > 0]
        if len(piece) <= max_faces and len(src) and before[np.bincount(src).argmax()] >= 2 * len(piece):
            gone[piece] = True
    if gone.any():
        delete_faces(o, gone)
    me.attributes.remove(me.attributes['island0'])
    return int(gone.sum())


def lift_limb(o, moving, prefer=None):
    """Turn the masked faces (a forearm and hand modelled touching the body) into
    their own piece: copy them (sharing no vertex with anything), delete the
    originals, patch the openings left in the body and cap the copy. The copy's
    vertices get the int attribute 'part' = 1 so skinning can find them."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    part = bm.verts.layers.int.get('part') or bm.verts.layers.int.new('part')
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    src = [bm.faces[i] for i in np.nonzero(moving)[0]]
    dup = bmesh.ops.duplicate(bm, geom=src)
    nf = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMFace)]
    for g in dup['geom']:
        if isinstance(g, bmesh.types.BMVert):
            g[part] = 1
    rim = {e for f in src for e in f.edges}
    bmesh.ops.delete(bm, geom=src, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    sample = texture_sampler(o)
    body = _patch(bm, [e for e in rim if e.is_valid and e.is_boundary], uvl, sample, prefer)
    caps = _patch(bm, list({e for f in nf for e in f.edges if e.is_boundary}), uvl, sample)
    for f in caps:   # cap centres belong to the copy too
        for v in f.verts:
            v[part] = 1
    bm.to_mesh(me)
    bm.free()
    return len(nf), len(body)


def limb_faces(o, joints, radius):
    """Faces of a limb: within `radius` of the joint polyline and facing away from
    it (the torso surface the limb rests against faces the other way)."""
    me = o.data
    fc = np.array([tuple(p.center) for p in me.polygons])
    fn = np.array([tuple(p.normal) for p in me.polygons])
    c, d = closest_on_polyline(fc, [np.asarray(j, float) for j in joints])
    out = (fc - c) / np.maximum(np.linalg.norm(fc - c, axis=1, keepdims=True), 1e-9)
    return (d < radius) & ((fn * out).sum(1) > 0.0), fc


def repose(o, k, pivot, rot):
    """Rotate vertices about `pivot` by the Quaternion `rot`, each by its share k (0..1):
    moves a modelled limb into a pose that animates better."""
    pivot = Vector(pivot)
    for v in o.data.vertices:
        if k[v.index] > 0:
            v.co = pivot + Quaternion().slerp(rot, float(k[v.index])) @ (v.co - pivot)


def apply_pose_as_rest(meshes, rig_obj, pose):
    """Re-pose a rigged model for good: pose the bones (pose(Anim)), bake the
    deformed meshes and make that pose the armature's rest pose. Used to move a
    modelled limb (a hand resting on the hip) somewhere that animates better."""
    an = Anim(rig_obj)
    an.rest()
    pose(an)
    bpy.context.view_layer.update()
    for m in meshes:
        activate(m)
        mod = next(md for md in m.modifiers if md.type == 'ARMATURE')
        name = mod.name
        bpy.ops.object.modifier_apply(modifier=name)
        new = m.modifiers.new(name, 'ARMATURE')
        new.object = rig_obj
    activate(rig_obj, mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    an.rest()


def stretch_check(mesh, rig_obj, poses, limit=2.5):
    """Worst edge stretch (posed / rest length) per pose, for spotting tearing.
    poses: {name: callable(Anim)}. Returns {name: (max ratio, edges over limit)}."""
    me = mesh.data
    E = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', E)
    E = E.reshape(-1, 2)
    P0 = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', P0)
    P0 = P0.reshape(-1, 3)
    L0 = np.linalg.norm(P0[E[:, 0]] - P0[E[:, 1]], axis=1)
    an = Anim(rig_obj)
    out = {}
    for name, fn in poses.items():
        an.rest()
        fn(an)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        P = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get('co', P)
        P = P.reshape(-1, 3)
        L = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
        r = L / np.maximum(L0, 1e-6)
        r[L0 < 1e-5] = 1
        out[name] = (float(r.max()), int((r > limit).sum()))
    an.rest()
    return out


def mirror_map(frm, to):
    """The map replace_hand uses: mirror across x = 0, then move frame `frm` onto
    frame `to`. A frame is (origin, along, across). Returns p -> p' (Vectors)."""
    def frame(origin, along, across):
        a = Vector(along).normalized()
        b = (Vector(across) - Vector(across).dot(a) * a).normalized()
        return Vector(origin), Matrix((a, b, a.cross(b))).transposed()
    o_from, F_from = frame(*frm)
    o_to, F_to = frame(*to)
    mirror = Matrix.Scale(-1, 3, Vector((1, 0, 0)))
    o_m, F_m = mirror @ o_from, Matrix((mirror @ F_from.col[0], mirror @ F_from.col[1],
                                        (mirror @ F_from.col[0]).cross(mirror @ F_from.col[1]))).transposed()
    R = F_to @ F_m.transposed()
    return lambda p: o_to + R @ (mirror @ Vector(p) - o_m)


def replace_hand(o, remove, donor, frm, to, prefer=None):
    """Give a hand (or forearm) that can't be animated (hidden in a pocket) a real
    one: a mirrored copy of the `donor` faces (the other arm), moved from frame `frm`
    to `to` (see mirror_map; e.g. along = wrist -> fist, across = the grip direction),
    capped. `remove` faces (optional) are deleted and their hole patched."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    part = bm.verts.layers.int.get('part') or bm.verts.layers.int.new('part')
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    gone = [bm.faces[i] for i in np.nonzero(remove)[0]] if remove is not None else []
    give = [bm.faces[i] for i in np.nonzero(donor)[0]]
    move = mirror_map(frm, to)
    dup = bmesh.ops.duplicate(bm, geom=give)
    nf = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMFace)]
    nv = [g for g in dup['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in nv:
        v[part] = 2   # the new hand (rig.lift_limb then makes it part of the limb copy)
    for v in nv:
        v.co = move(v.co)
    bmesh.ops.reverse_faces(bm, faces=nf)
    sample = texture_sampler(o)
    _patch(bm, list({e for f in nf for e in f.edges if e.is_boundary}), uvl, sample)
    if gone:
        rim = {e for f in gone for e in f.edges}
        bmesh.ops.delete(bm, geom=gone, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        _patch(bm, [e for e in rim if e.is_valid and e.is_boundary], uvl, sample, prefer)
    bm.to_mesh(o.data)
    bm.free()
    return len(nf), len(gone)


# ---------------------------------------------------------------- skeleton
# (bone, head joint, tail joint, parent, deform). Joints come from a character's
# landmark table. Sockets (sock*) are attachment points for accessories: they
# carry no weights, but the game can parent props to them.
BONES = [
    ('hips', 'hips', 'spine', 'root', True),
    ('spine', 'spine', 'chest', 'hips', True),
    ('chest', 'chest', 'neck', 'spine', True),
    ('head', 'neck', 'top', 'chest', True),
    ('earL1', 'earL0', 'earL1', 'head', True),
    ('earL2', 'earL1', 'earL2', 'earL1', True),
    ('earR1', 'earR0', 'earR1', 'head', True),
    ('earR2', 'earR1', 'earR2', 'earR1', True),
    ('armL', 'shoulderL', 'elbowL', 'chest', True),
    ('forearmL', 'elbowL', 'wristL', 'armL', True),
    ('handL', 'wristL', 'fistL', 'forearmL', True),
    ('armR', 'shoulderR', 'elbowR', 'chest', True),
    ('forearmR', 'elbowR', 'wristR', 'armR', True),
    ('handR', 'wristR', 'fistR', 'forearmR', True),
    ('thighL', 'hipL', 'kneeL', 'hips', True),
    ('shinL', 'kneeL', 'ankleL', 'thighL', True),
    ('footL', 'ankleL', 'toeL', 'shinL', True),
    ('thighR', 'hipR', 'kneeR', 'hips', True),
    ('shinR', 'kneeR', 'ankleR', 'thighR', True),
    ('footR', 'ankleR', 'toeR', 'shinR', True),
    ('tail1', 'tail0', 'tail1', 'hips', True),
    ('tail2', 'tail1', 'tail2', 'tail1', True),
    ('sockHat', 'top', 'hatUp', 'head', False),
    ('sockBack', 'back', 'backOut', 'chest', False),
    ('sockHandL', 'fistL', 'gripL', 'handL', False),
    ('sockHandR', 'fistR', 'gripR', 'handR', False),
]
DEFORM = [b[0] for b in BONES if b[4]]


def build_rig(name, J):
    """Armature from joint positions J {joint: (x, y, z)}. Each bone's roll is
    set so its local Z points forward (-Y) or, for bones lying along Y, up."""
    J = {k: Vector(v) for k, v in J.items()}
    J.setdefault('hatUp', J['top'] + Vector((0, 0, 0.05)))
    J.setdefault('backOut', J['back'] + Vector((0, 0.05, 0)))
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    activate(ob, mode='EDIT')
    eb = arm.edit_bones
    root = eb.new('root')
    root.head, root.tail = Vector((0, 0, 0)), Vector((0, -0.1, 0))
    root.align_roll(Vector((0, 0, 1)))
    root.use_deform = False
    for bname, h, t, parent, deform in BONES:
        b = eb.new(bname)
        b.head, b.tail = J[h], J[t]
        d = (b.tail - b.head).normalized()
        b.align_roll(Vector((0, 0, 1)) if abs(d.y) > 0.8 else Vector((0, -1, 0)))
        b.parent = eb[parent]
        b.use_connect = False
        b.use_deform = deform
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.show_in_front = True
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


# ---------------------------------------------------------------- skinning
def read_weights(o, names):
    W = np.zeros((len(o.data.vertices), len(names)))
    col = {vg.index: names.index(vg.name) for vg in o.vertex_groups if vg.name in names}
    for v in o.data.vertices:
        for g in v.groups:
            j = col.get(g.group)
            if j is not None:
                W[v.index, j] = g.weight
    return W


def write_weights(o, names, W):
    for vg in list(o.vertex_groups):
        o.vertex_groups.remove(vg)
    for j, n in enumerate(names):
        vg = o.vertex_groups.new(name=n)
        for i in np.nonzero(W[:, j] > 1e-4)[0]:
            vg.add([int(i)], float(W[i, j]), 'REPLACE')


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def seg_param(P, a, b):
    """For points P: parameter along segment a->b (unclamped, 0..1 on the
    segment) and distance to the clamped segment."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a
    L2 = max(float(d @ d), 1e-12)
    t = (P - a) @ d / L2
    q = a + np.clip(t, 0, 1)[:, None] * d
    return t, np.linalg.norm(P - q, axis=1)


def closest_on_polyline(P, pts):
    """Closest point on a joint polyline for each of P, and the distance."""
    best_d = np.full(len(P), np.inf)
    best_c = np.zeros_like(P)
    for a, b in zip(pts[:-1], pts[1:]):
        t, d = seg_param(P, a, b)
        c = a + np.clip(t, 0, 1)[:, None] * (b - a)
        better = d < best_d
        best_d[better] = d[better]
        best_c[better] = c[better]
    return best_c, best_d


class Skin:
    """Weight matrix W (verts x DEFORM bones) with region rules."""

    def __init__(self, o, J):
        self.o = o
        self.J = {k: np.asarray(v, float) for k, v in J.items()}
        self.P, self.E = mesh_arrays(o)
        N = np.empty(len(self.P) * 3)
        o.data.vertices.foreach_get('normal', N)
        self.N = N.reshape(-1, 3)
        self.comp = components(len(self.P), self.E)
        self.names = list(DEFORM)
        self.W = read_weights(o, self.names)
        self.locked = np.zeros(len(self.P), bool)

    def col(self, bone):
        return self.names.index(bone)

    def set_rigid(self, mask, bone, lock=True):
        self.W[mask] = 0
        self.W[mask, self.col(bone)] = 1
        if lock:
            self.locked |= mask

    def in_box(self, box):
        lo, hi = np.asarray(box[0], float), np.asarray(box[1], float)
        return np.all((self.P >= lo) & (self.P <= hi), axis=1)

    def near(self, joint, radius):
        return np.linalg.norm(self.P - self.J[joint], axis=1) < radius

    def rigid_region(self, bone, box, whole_parts=False, keep=None):
        """Props (a racket): everything in `box` follows `bone` rigidly.
        whole_parts: only separate mesh pieces lying entirely in the box.
        keep=(joint, radius): leave that sphere (the gripping fist) to heat weights."""
        inside = self.in_box(box)
        if whole_parts:
            main = np.bincount(self.comp).argmax()
            mask = np.zeros(len(self.P), bool)
            for c in np.unique(self.comp[inside]):
                part = self.comp == c
                if c != main and inside[part].all():
                    mask |= part
        else:
            mask = inside
        if keep:
            mask &= ~self.near(*keep)
        self.set_rigid(mask, bone)
        return mask

    def rigid_hand(self, bone, joint, chain, r_in=0.022, r_out=0.042):
        """A fist gripping a prop stays one solid piece: vertices around the
        fist joint that already belong mostly to the arm chain follow `bone`,
        blending back to their own weights by r_out."""
        d = np.linalg.norm(self.P - self.J[joint], axis=1)
        armish = self.W[:, [self.col(b) for b in chain]].sum(1) > 0.5
        k = (1 - smoothstep(r_in, r_out, d)) * armish * ~self.locked
        rigid = np.zeros(len(self.names))
        rigid[self.col(bone)] = 1
        self.W = self.W * (1 - k)[:, None] + rigid[None, :] * k[:, None]
        return int((k > 0.5).sum())

    def pin_limb(self, joints, limb_bones, to, start=0.3, end=0.85, radius=0.06):
        """A hand stuck in a pocket: along the joint chain (elbow -> wrist -> fist)
        move a growing share of the limb's weights to the bones in `to`
        ({bone: share}), so the hand stays with the hips while the elbow still
        follows the arm."""
        pts = [self.J[j] for j in joints]
        lens = [np.linalg.norm(b - a) for a, b in zip(pts[:-1], pts[1:])]
        total = sum(lens)
        s = np.zeros(len(self.P))
        best = np.full(len(self.P), np.inf)
        acc = 0.0
        for (a, b), L in zip(zip(pts[:-1], pts[1:]), lens):
            t, d = seg_param(self.P, a, b)
            better = d < best
            best[better] = d[better]
            s[better] = (acc + np.clip(t[better], 0, 1.5) * L) / total
            acc += L
        region = best < radius
        k = smoothstep(start, end, s) * region * ~self.locked
        cols = [self.col(b) for b in limb_bones]
        moved = self.W[:, cols].sum(1) * k
        self.W[:, cols] *= (1 - k)[:, None]
        for bone, share in to.items():
            self.W[:, self.col(bone)] += moved * share
        return int((k > 0.01).sum())

    def rigid_feet(self, ankle_z, blend=0.03, center_x=0.0):
        """Shoes don't bend: below the ankle each side follows its foot bone,
        blending into the heat weights just above."""
        for side, foot in ((1, 'footL'), (-1, 'footR')):
            on_side = (self.P[:, 0] - center_x) * side > 0
            z = self.P[:, 2]
            k = 1 - smoothstep(ankle_z[foot] - blend, ankle_z[foot] + blend * 0.5, z)
            mask = on_side & (k > 0)
            kk = k[mask][:, None]
            rigid = np.zeros_like(self.W[mask])
            rigid[:, self.col(foot)] = 1
            self.W[mask] = self.W[mask] * (1 - kk) + rigid * kk
            self.locked |= on_side & (k > 0.999)

    def separate_limb(self, limb_joints, limb_bones, torso_joints, torso_bones, radius=0.09, top=None,
                      fade=0.04, soft=0.3, core=0.03):
        """Arms modelled hanging against the body: heat diffusion lets the arm
        bones drag the shirt's side. Below the armpit (`top`), a vertex counts as
        arm surface only if its normal points away from the arm axis more than
        from the spine; torso-surface vertices hand their arm weights to the
        torso bones."""
        limb = [self.J[j] for j in limb_joints]
        torso = [self.J[j] for j in torso_joints]
        ca, da = closest_on_polyline(self.P, limb)
        ct, _ = closest_on_polyline(self.P, torso)

        def unit(v):
            return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
        score = (self.N * unit(self.P - ca)).sum(1) - (self.N * unit(self.P - ct)).sum(1)
        k = smoothstep(-soft, soft, score)                       # 1 = arm surface
        # Concave spots (curled fingers) fool the normal test: the core of the
        # wrist and fist is always arm, and a smoothing pass lets each vertex
        # follow its neighbourhood's majority.
        for j in limb_joints[-2:]:
            k[self.near(j, core)] = 1
        k = self.smooth_field(k, iters=10)
        z = self.P[:, 2]
        top = self.J[limb_joints[0]][2] if top is None else top
        depth = smoothstep(top, top - fade, z)                   # 0 at the shoulder, 1 below the armpit
        cut = (1 - k) * depth * (da < radius) * ~self.locked
        lc = [self.col(b) for b in limb_bones]
        tc = [self.col(b) for b in torso_bones]
        moved = self.W[:, lc].sum(1) * cut
        self.W[:, lc] *= (1 - cut)[:, None]
        tw = self.W[:, tc]
        tot = tw.sum(1)
        share = np.where(tot[:, None] > 1e-6, tw / np.maximum(tot, 1e-9)[:, None], 0)
        share[tot <= 1e-6, tc.index(self.col(torso_bones[-1]))] = 1
        self.W[:, tc] += share * moved[:, None]
        return int((cut > 0.5).sum())

    def release(self, bones, k, to=('hips', 'spine', 'chest')):
        """Hand a share k (per vertex, 0..1) of `bones`' weights to the `to` bones in
        proportion to what they already have (hips if none): e.g. shorts vertices
        that heat diffusion gave to a hand resting on them."""
        k = np.clip(np.asarray(k, float), 0, 1) * ~self.locked
        bc = [self.col(b) for b in bones]
        tc = [self.col(b) for b in to]
        moved = self.W[:, bc].sum(1) * k
        self.W[:, bc] *= (1 - k)[:, None]
        tw = self.W[:, tc]
        tot = tw.sum(1)
        share = np.where(tot[:, None] > 1e-6, tw / np.maximum(tot, 1e-9)[:, None], 0)
        share[tot <= 1e-6, 0] = 1
        self.W[:, tc] += share * moved[:, None]
        return int((k * (moved > 0) > 0.5).sum())

    def absorb(self, bones, k):
        """Move a share k (per vertex) of all other bones' weights into `bones`, in
        proportion to what they already have (the last bone if none): a part cut
        free from the body follows only its own chain."""
        k = np.clip(np.asarray(k, float), 0, 1) * ~self.locked
        bc = [self.col(b) for b in bones]
        rest = [j for j in range(len(self.names)) if j not in bc]
        moved = self.W[:, rest].sum(1) * k
        self.W[:, rest] *= (1 - k)[:, None]
        bw = self.W[:, bc]
        tot = bw.sum(1)
        share = np.where(tot[:, None] > 1e-6, bw / np.maximum(tot, 1e-9)[:, None], 0)
        share[tot <= 1e-6, -1] = 1
        self.W[:, bc] += share * moved[:, None]

    def keep_side(self, bones, side, center_x=0.0, margin=0.01):
        """Remove weights of left (side=+1) or right (-1) bones from vertices on
        the other side of the body's mid-plane (stops leg-to-leg bleeding)."""
        other = (self.P[:, 0] - center_x) * side < -margin
        for b in bones:
            self.W[other, self.col(b)] = 0

    def fill_unweighted(self):
        """Vertices heat diffusion missed take the weights of the nearest
        weighted vertex in another part, so small separate pieces (eye
        highlights, laces) move rigidly with what they sit on."""
        tot = self.W.sum(1)
        bad = tot < 1e-3
        if not bad.any():
            return 0
        good = np.nonzero(~bad)[0]
        kd = kdtree.KDTree(len(good))
        for i, gi in enumerate(good):
            kd.insert(self.P[gi], i)
        kd.balance()
        for c in np.unique(self.comp[bad]):
            idx = np.nonzero(bad & (self.comp == c))[0]
            centre = self.P[idx].mean(0)
            _, gi, _ = kd.find(centre)
            self.W[idx] = self.W[good[gi]]
        return int(bad.sum())

    def unify_components(self, max_size=200):
        """Small separate pieces (laces, highlights, buttons) get one averaged
        weight set so they can't tear apart from themselves."""
        ids, counts = np.unique(self.comp, return_counts=True)
        for c, n in zip(ids, counts):
            if n <= max_size:
                idx = self.comp == c
                self.W[idx] = self.W[idx].mean(0)

    def smooth_field(self, f, iters=10, alpha=0.5):
        """Laplacian smoothing of a per-vertex scalar over mesh edges."""
        E = self.E
        n = len(f)
        deg = np.bincount(E.ravel(), minlength=n).astype(float)
        f = f.astype(float).copy()
        for _ in range(iters):
            acc = np.bincount(E[:, 0], weights=f[E[:, 1]], minlength=n) + np.bincount(E[:, 1], weights=f[E[:, 0]], minlength=n)
            avg = np.where(deg > 0, acc / np.maximum(deg, 1), f)
            f = (1 - alpha) * f + alpha * avg
        return f

    def smooth(self, iters=6, alpha=0.5):
        W, E = self.W, self.E
        n = len(W)
        deg = np.bincount(E.ravel(), minlength=n).astype(float)
        free = ~self.locked & (deg > 0)
        for _ in range(iters):
            acc = np.zeros_like(W)
            np.add.at(acc, E[:, 0], W[E[:, 1]])
            np.add.at(acc, E[:, 1], W[E[:, 0]])
            avg = acc / np.maximum(deg, 1)[:, None]
            W[free] = (1 - alpha) * W[free] + alpha * avg[free]
        self.W = W

    def finalize(self, max_influences=4):
        W = np.clip(self.W, 0, None)
        if W.shape[1] > max_influences:
            cut = np.argsort(-W, axis=1)[:, max_influences:]
            np.put_along_axis(W, cut, 0, axis=1)
        W[W < 0.01] = 0
        tot = W.sum(1, keepdims=True)
        W = np.where(tot > 0, W / np.maximum(tot, 1e-9), 0)
        self.W = W
        write_weights(self.o, self.names, W)
        return W


def heat_bind(mesh, rig):
    """Parent with automatic (heat-diffusion) weights; returns vertices left unweighted.

    Blender's solver fails for every bone when one separate piece of the mesh can't
    "see" any bone (e.g. a fragment enclosed inside the shorts). Then the small
    pieces are set aside, the rest is weighted, and the pieces are joined back
    unweighted (Skin.fill_unweighted gives them their neighbours' weights)."""
    def unweighted():
        return sum(1 for v in mesh.data.vertices if sum(g.weight for g in v.groups) < 1e-4)
    activate(mesh, rig)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    missed = unweighted()
    if missed < 0.5 * len(mesh.data.vertices):
        return missed
    for vg in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(vg)
    P, E = mesh_arrays(mesh)
    comp = components(len(P), E)
    sizes = np.bincount(comp)
    small = sizes[comp] < 0.05 * len(P)
    pieces = mesh.copy()
    pieces.data = mesh.data.copy()
    bpy.context.scene.collection.objects.link(pieces)
    for obj, drop in ((mesh, small), (pieces, ~small)):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(drop)[0]], context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
    for m in mesh.modifiers[:]:
        mesh.modifiers.remove(m)
    activate(mesh, rig)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for m in pieces.modifiers[:]:
        pieces.modifiers.remove(m)
    activate(pieces, mesh)
    bpy.ops.object.join()
    print(f'  heat weights: solver failed with all {len(np.unique(comp))} pieces; '
          f'retried without {int(small.sum())} vertices in small pieces')
    return unweighted()


# ---------------------------------------------------------------- props
def split_off(o, vert_mask, name):
    """Move the faces whose vertices are all in vert_mask into a new object that
    keeps the material, vertex groups, armature modifier and parent (a prop the
    game can hide, e.g. a racket modelled into the character's hand)."""
    new = o.copy()
    new.data = o.data.copy()
    new.name = new.data.name = name
    bpy.context.scene.collection.objects.link(new)
    for obj, inside in ((new, True), (o, False)):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        faces = [f for f in bm.faces if all(vert_mask[v.index] for v in f.verts) != inside]
        bmesh.ops.delete(bm, geom=faces, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
    return new


def build_paddle(arm, grip, prop_pts, name='prop_paddle', radius=0.06, bone='handR'):
    """A table-tennis paddle in the same hand as a modelled racket: handle in the
    fist (`grip`), blade along the racket's shaft, facing the way its strings did.
    Skinned rigidly to `bone` so it follows every clip."""
    grip = np.asarray(grip, float)
    d = np.linalg.norm(prop_pts - grip, axis=1)
    head = prop_pts[d > np.percentile(d, 55)]
    hc = head.mean(0)
    x = (hc - grip) / np.linalg.norm(hc - grip)                 # along the shaft
    w, V = np.linalg.eigh(np.cov((head - hc).T))
    z = V[:, 0] - (V[:, 0] @ x) * x                             # face normal, orthogonal to the shaft
    z /= np.linalg.norm(z)
    y = np.cross(z, x)
    F = Matrix(((x[0], y[0], z[0]), (x[1], y[1], z[1]), (x[2], y[2], z[2])))   # paddle frame -> armature

    def place(local_rot, offset):
        m = F.to_4x4() @ Matrix.Translation(Vector(offset)) @ local_rot
        m.translation = Vector(grip) + F @ Vector(offset)
        return m
    bm = bmesh.new()
    mats = [mat_color('paddle_wood', '#b07a4a'), mat_color('paddle_red', '#e63946'), mat_color('paddle_black', '#1d1d24')]

    def add(geom_fn, mi, M):
        g = bmesh.new()
        geom_fn(g)
        bmesh.ops.transform(g, matrix=M, verts=g.verts)
        for f in g.faces:
            f.material_index = mi
            f.smooth = True
        tmp = bpy.data.meshes.new('_tmp')
        g.to_mesh(tmp)
        g.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    along = Matrix.Rotation(math.pi / 2, 4, 'Y')               # cylinder axis (Z) -> shaft (X)
    hl = 0.07
    add(lambda g: bmesh.ops.create_cone(g, cap_ends=True, segments=12, radius1=0.012, radius2=0.013, depth=hl),
        0, place(along, (hl / 2 - 0.025, 0, 0)))
    centre = hl - 0.025 + radius * 0.92
    for mi, dz in ((1, 0.0045), (2, -0.0045)):
        add(lambda g: bmesh.ops.create_cone(g, cap_ends=True, segments=32, radius1=radius, radius2=radius, depth=0.006),
            mi, place(Matrix(), (centre, 0, dz)))
    add(lambda g: bmesh.ops.create_cone(g, cap_ends=True, segments=32, radius1=radius * 1.02, radius2=radius * 1.02,
                                        depth=0.004), 0, place(Matrix(), (centre, 0, 0)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return ob


def mat_color(name, hex_color, rough=0.55):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    h = hex_color.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    b.inputs['Base Color'].default_value = (*[v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c], 1)
    b.inputs['Roughness'].default_value = rough
    return m


# ---------------------------------------------------------------- animation
class Anim:
    """Procedural keyframing on an armature's pose bones.

        a = Anim(rig)
        a.begin('walk', frames=24)
        for f in a.frames():
            a.rest()
            a.rot('thighL', pitch=-30)
            a.move('hips', z=0.01)
            a.key(f)
    """

    def __init__(self, rig, soles=None):
        self.rig = rig
        self.rest_rot = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}
        self.actions = []
        # {foot bone: [rest points on the sole]}: ground() keeps the lowest one on z = 0
        self.soles = {k: [Vector(p) for p in v] for k, v in (soles or {}).items()}

    def ground(self, lift=0.0):
        """Move the hips so the lowest sole point touches the floor (+ lift)."""
        bpy.context.view_layer.update()
        low = []
        for foot, pts in self.soles.items():
            pb = self.rig.pose.bones[foot]
            M = pb.matrix @ pb.bone.matrix_local.inverted()
            low += [(M @ p).z for p in pts]
        if low:
            self.move('hips', z=lift - min(low))

    def begin(self, name, frames, loop=True):
        rig = self.rig
        rig.animation_data_create()
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        act.use_frame_range = True
        act.frame_start, act.frame_end = 0, frames
        act.use_cyclic = loop
        rig.animation_data.action = act
        self.n = frames
        self.actions.append(act)
        return act

    def frames(self):
        return range(self.n + 1)

    def rest(self):
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion = Quaternion()
            pb.location = Vector()
            pb.scale = Vector((1, 1, 1))

    def rot(self, bone, pitch=0.0, side=0.0, yaw=0.0):
        """Rotate a bone (degrees) about the body axes, measured in its rest frame;
        applied after (on top of) any rotation already set this frame."""
        pb = self.rig.pose.bones.get(bone)
        if pb is None:
            return
        R = self.rest_rot[bone].inverted()
        q = pb.rotation_quaternion.copy()
        for ax, deg in (('yaw', yaw), ('pitch', pitch), ('side', side)):
            if deg:
                q = Quaternion(R @ AXES[ax], math.radians(deg)) @ q
        pb.rotation_quaternion = q

    def aim(self, bone, direction, ref=None, twist=0.0):
        """Turn `bone` (with its parents as currently posed) so that it, or its
        child `ref` (e.g. a prop socket), points along an armature-space
        direction; then twist about that direction by `twist` degrees."""
        bpy.context.view_layer.update()
        pb = self.rig.pose.bones[bone]
        rb = self.rig.pose.bones[ref or bone]
        cur = (rb.tail - rb.head).normalized()
        d = Vector(direction).normalized()
        q = cur.rotation_difference(d)
        if twist:
            q = Quaternion(d, math.radians(twist)) @ q
        M = pb.matrix.to_3x3()
        pb.rotation_quaternion = pb.rotation_quaternion @ (M.inverted() @ q.to_matrix() @ M).to_quaternion()

    def reach(self, upper, lower, target, pole):
        """Two-bone IK: aim `upper` and `lower` (e.g. arm, forearm) so the lower
        bone's tail lands on `target` (armature space), the joint bending toward
        `pole` (a direction). Out-of-reach targets are approached in a straight line."""
        bpy.context.view_layer.update()
        pu = self.rig.pose.bones[upper]
        L1, L2 = pu.bone.length, self.rig.pose.bones[lower].bone.length
        A = pu.head.copy()
        d = Vector(target) - A
        dist = max(1e-6, min(d.length, (L1 + L2) * 0.999))
        dn = d.normalized()
        cos_a = max(-1.0, min(1.0, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)))
        pole = Vector(pole)
        side = (pole - pole.dot(dn) * dn)
        side = side.normalized() if side.length > 1e-6 else dn.orthogonal().normalized()
        elbow = A + dn * (L1 * cos_a) + side * (L1 * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
        self.aim(upper, elbow - A)
        self.aim(lower, A + dn * dist - elbow)

    def level(self, bone, pitch=0.0):
        """Give `bone` its rest orientation in armature space whatever its parents do
        (a foot flat on the floor and pointing ahead), then tilt it by `pitch` degrees."""
        bpy.context.view_layer.update()
        pb = self.rig.pose.bones[bone]
        M = pb.matrix.to_3x3()
        q = (pb.bone.matrix_local.to_3x3() @ M.inverted()).to_quaternion()
        pb.rotation_quaternion = pb.rotation_quaternion @ (M.inverted() @ q.to_matrix() @ M).to_quaternion()
        if pitch:
            self.rot(bone, pitch=pitch)

    def point(self, bone, at_tail=True):
        """Posed head (or tail) of a bone, armature space."""
        bpy.context.view_layer.update()
        pb = self.rig.pose.bones[bone]
        return (pb.tail if at_tail else pb.head).copy()

    def snapshot(self):
        return {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in self.rig.pose.bones}

    def apply(self, snap):
        for pb in self.rig.pose.bones:
            q, loc = snap[pb.name]
            pb.rotation_quaternion = q
            pb.location = loc

    def blend(self, a, b, t):
        """Pose between snapshots a and b (t = 0..1): slerp rotations, lerp offsets."""
        for pb in self.rig.pose.bones:
            qa, la = a[pb.name]
            qb, lb = b[pb.name]
            pb.rotation_quaternion = qa.slerp(qb, t)
            pb.location = la.lerp(lb, t)

    def move(self, bone, x=0.0, y=0.0, z=0.0):
        """Translate a bone in armature space (meters)."""
        pb = self.rig.pose.bones.get(bone)
        if pb is None:
            return
        pb.location = pb.location + self.rest_rot[bone].inverted() @ Vector((x, y, z))

    def key(self, frame):
        for pb in self.rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            if pb.name in ('hips', 'root'):
                pb.keyframe_insert('location', frame=frame)


# ---------------------------------------------------------------- export
def export_glb(path, objects, animations=True):
    activate(*objects)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=False, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_image_format='AUTO',
        export_skins=True, export_all_influences=False, export_def_bones=False,
        export_animations=animations, export_animation_mode='ACTIONS',
        export_frame_range=False, export_force_sampling=True, export_frame_step=1,
        export_optimize_animation_size=False, export_anim_single_armature=True,
        export_reset_pose_bones=True, export_morph=False,
        export_lights=False, export_cameras=False,
    )
    print('exported', path, os.path.getsize(path) // 1024, 'KB')

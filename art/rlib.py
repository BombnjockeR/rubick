"""Mabar art toolkit for Blender (run headless via the `bpy` module).

Everything is built from code so it can be re-run and tweaked:
  * Geo     - accumulates many primitives into ONE mesh (few draw calls)
  * chibi() - toy-style character with separate pivots for animation
  * key()   - keyframe helper (linear interpolation, loops cleanly)
Style: rounded, saturated "toy diorama" look.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, Euler

TAU = math.tau


# ---------------------------------------------------------------- scene
def reset(fps=30):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()  # materials from the previous scene are gone
    sc = bpy.context.scene
    sc.render.fps = fps
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    return sc


# ---------------------------------------------------------------- materials
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


_MATS = {}


def mat(color, rough=0.62, metal=0.0, emit=None, name=None):
    """Cached Principled material. emit=(hex, strength) makes it glow."""
    key = (color, rough, metal, emit, name)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name or f"m{color.lstrip('#')}")
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(color), 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(emit[0]), 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    _MATS[key] = m
    return m


def glow(color, strength=3.0):
    return mat(color, emit=(color, strength), name=f"glow{color.lstrip('#')}")


# ---------------------------------------------------------------- geometry
def _mx(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


class Geo:
    """Collects primitives (each with its own material) into one mesh."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []
        self._tmp = bpy.data.meshes.new('_tmp')

    def _merge(self, b, material, m4):
        bmesh.ops.transform(b, matrix=m4, verts=b.verts)
        if material not in self.mats:
            self.mats.append(material)
        mi = self.mats.index(material)
        for f in b.faces:
            f.material_index = mi
            f.smooth = True
        b.to_mesh(self._tmp)
        b.free()
        self.bm.from_mesh(self._tmp)
        return self

    # --- primitives (sizes are full extents; loc is the center) ---
    def box(self, size, loc, m, bevel=0.015, seg=2, rot=(0, 0, 0)):
        b = bmesh.new()
        bmesh.ops.create_cube(b, size=1)
        bmesh.ops.scale(b, vec=Vector(size), verts=b.verts)
        if bevel > 0:
            bevel = min(bevel, min(size) * 0.45)
            bmesh.ops.bevel(b, geom=list(b.edges), offset=bevel, segments=seg,
                            affect='EDGES', profile=0.5, clamp_overlap=True)
        return self._merge(b, m, _mx(loc, rot))

    def rbox(self, size, loc, m, radius=0.2, bevel=0.02, rot=(0, 0, 0)):
        """Rounded-rectangle slab (round vertical corners + soft top/bottom)."""
        w, d, h = size
        b = bmesh.new()
        bmesh.ops.create_cube(b, size=1)
        bmesh.ops.scale(b, vec=Vector(size), verts=b.verts)
        radius = min(radius, w * 0.49, d * 0.49)
        vert = [e for e in b.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        bmesh.ops.bevel(b, geom=vert, offset=radius, segments=8, affect='EDGES',
                        profile=0.5, clamp_overlap=True)
        if bevel > 0:
            hor = [e for e in b.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
            bmesh.ops.bevel(b, geom=hor, offset=min(bevel, h * 0.45), segments=2,
                            affect='EDGES', profile=0.5, clamp_overlap=True)
        return self._merge(b, m, _mx(loc, rot))

    def cyl(self, r, h, loc, m, seg=20, rot=(0, 0, 0), r2=None, bevel=0.0):
        b = bmesh.new()
        bmesh.ops.create_cone(b, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r if r2 is None else r2, depth=h)
        if bevel > 0:
            caps = [e for e in b.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
            bmesh.ops.bevel(b, geom=caps, offset=bevel, segments=2, affect='EDGES',
                            profile=0.5, clamp_overlap=True)
        return self._merge(b, m, _mx(loc, rot))

    def cone(self, r, h, loc, m, seg=16, rot=(0, 0, 0)):
        return self.cyl(r, h, loc, m, seg, rot, r2=0.0)

    def sphere(self, r, loc, m, scale=(1, 1, 1), seg=18, rot=(0, 0, 0)):
        b = bmesh.new()
        bmesh.ops.create_uvsphere(b, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
        return self._merge(b, m, _mx(loc, rot, scale))

    def text(self, body, size, loc, m, depth=0.02, rot=(math.pi / 2, 0, 0), align='CENTER'):
        cu = bpy.data.curves.new('t', type='FONT')
        cu.body = body
        cu.size = size
        cu.extrude = depth
        cu.align_x = align
        cu.align_y = 'CENTER'
        ob = bpy.data.objects.new('t', cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob)
        b = bmesh.new()
        b.from_mesh(me)
        bpy.data.meshes.remove(me)
        return self._merge(b, m, _mx(loc, rot))

    # --- output ---
    def build(self, name, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        bpy.data.meshes.remove(self._tmp)
        for m in self.mats:
            me.materials.append(m)
        if hasattr(me, 'set_sharp_from_angle'):
            me.set_sharp_from_angle(angle=math.radians(38))
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = parent
        o.location = loc
        o.rotation_euler = rot
        return o


def empty(name, parent=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.empty_display_size = 0.1
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o


# ---------------------------------------------------------------- animation
def key(o, f, loc=None, rot=None, scale=None):
    if loc is not None:
        o.location = loc
        o.keyframe_insert('location', frame=f)
    if rot is not None:
        o.rotation_euler = rot
        o.keyframe_insert('rotation_euler', frame=f)
    if scale is not None:
        o.scale = scale if hasattr(scale, '__len__') else (scale, scale, scale)
        o.keyframe_insert('scale', frame=f)


def smooth(t):
    return t * t * (3 - 2 * t)


def bounce_arc(t, h0, h1, peak, tb):
    """Ball height along a shot: start h0, bounce at tb (0..1), end h1."""
    if t < tb:
        s = t / tb
        return h0 * (1 - s) + 4 * peak * s * (1 - s)
    s = (t - tb) / (1 - tb)
    return h1 * s + 4 * peak * 0.45 * s * (1 - s)


# ---------------------------------------------------------------- props
SKIN = '#ffd2b0'
LEAF = ['#58c94b', '#43b544', '#6fd655']


def tree(g, loc, s=1.0, rng=random):
    x, y, z = loc
    g.cyl(0.035 * s, 0.22 * s, (x, y, z + 0.11 * s), mat('#9a6a43'), seg=8)
    for i in range(6):
        a = rng.random() * TAU
        r = (0.075 + rng.random() * 0.05) * s
        off = 0.075 * s
        g.sphere(r, (x + math.cos(a) * off, y + math.sin(a) * off, z + (0.27 + rng.random() * 0.13) * s),
                 mat(LEAF[i % 3]), seg=12)
    g.sphere(0.12 * s, (x, y, z + 0.37 * s), mat(LEAF[0]), seg=12)


def pine(g, loc, s=1.0):
    x, y, z = loc
    g.cyl(0.03 * s, 0.12 * s, (x, y, z + 0.06 * s), mat('#9a6a43'), seg=8)
    for i, (r, zz) in enumerate(((0.16, 0.2), (0.12, 0.33), (0.08, 0.44))):
        g.cone(r * s, 0.2 * s, (x, y, z + zz * s), mat('#2f9e4f' if i % 2 else '#3bb35a'), seg=10)


def bush(g, loc, s=1.0):
    x, y, z = loc
    for dx, dy, r in ((0, 0, 0.09), (0.07, 0.02, 0.07), (-0.06, 0.03, 0.065)):
        g.sphere(r * s, (x + dx * s, y + dy * s, z + r * s * 0.8), mat(LEAF[1]), seg=12)


def lamp(g, loc, h=0.75):
    x, y, z = loc
    dark = mat('#2d3340', rough=0.45)
    g.cyl(0.05, 0.05, (x, y, z + 0.025), dark, seg=12)
    g.cyl(0.016, h, (x, y, z + h / 2), dark, seg=10)
    g.box((0.09, 0.09, 0.02), (x, y, z + h + 0.01), dark, bevel=0.005)
    g.box((0.07, 0.07, 0.09), (x, y, z + h + 0.065), glow('#ffd27a', 4), bevel=0.01)
    g.cone(0.07, 0.05, (x, y, z + h + 0.135), dark, seg=4, rot=(0, 0, math.pi / 4))


def fence(g, a, b, z, n=None, color='#b98552'):
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    n = n or max(2, int(length / 0.35) + 1)
    wood = mat(color)
    ang = math.atan2(by - ay, bx - ax)
    for i in range(n):
        t = i / (n - 1)
        g.box((0.035, 0.035, 0.16), (ax + (bx - ax) * t, ay + (by - ay) * t, z + 0.08), wood, bevel=0.006)
    for hz in (0.06, 0.13):
        g.box((length, 0.022, 0.022), ((ax + bx) / 2, (ay + by) / 2, z + hz), wood, bevel=0.005, rot=(0, 0, ang))


def crate(g, loc, s=0.18, rot=0.0):
    x, y, z = loc
    g.box((s, s, s), (x, y, z + s / 2), mat('#d39a5c'), bevel=0.012, rot=(0, 0, rot))
    for dz in (-s * 0.3, s * 0.3):
        g.box((s * 1.02, s * 1.02, s * 0.12), (x, y, z + s / 2 + dz), mat('#a8703c'), bevel=0.006, rot=(0, 0, rot))


def traffic_cone(g, loc, s=1.0):
    x, y, z = loc
    g.box((0.11 * s, 0.11 * s, 0.015 * s), (x, y, z + 0.008 * s), mat('#ff7a1a'), bevel=0.004)
    g.cone(0.045 * s, 0.14 * s, (x, y, z + 0.085 * s), mat('#ff7a1a'), seg=12)
    g.cyl(0.03 * s, 0.025 * s, (x, y, z + 0.09 * s), mat('#ffffff'), seg=12)


# ---------------------------------------------------------------- characters
HAIRS = ['#4a2c1d', '#2b1d16', '#7a4a2a', '#c58b4a', '#3a3a46']


class Chibi:
    """Toy character facing -Y in its local space.

    Pivots (all children of .root) so animation stays simple:
      root  - position / facing / hop
      head  - origin at the neck
      armL / armR - origin at the shoulders, hanging down (-Z)
      legL / legR - origin at the hips
    Attach tools to armR.tool_socket (an empty at the hand).
    """

    def __init__(self, name, parent=None, loc=(0, 0, 0), face=0.0, shirt='#ffffff', shorts='#2c3e66',
                 hair=None, skin=SKIN, outfit='sport', hat=None, s=1.0, rng=random, tint=False, accent='#ff3d57'):
        self.name = name
        hair = hair or rng.choice(HAIRS)
        self.root = empty(f'{name}', parent, loc, (0, 0, face))
        self.root.scale = (s, s, s)
        # tint=True gives the recolorable parts fixed material names so the game
        # can paint them in each player's color ('shirt', 'accent', 'hair').
        skin_m = mat(skin)
        shirt_m = mat(shirt, name='shirt' if tint else None)
        shorts_m = mat(shorts)
        hair_m = mat(hair, rough=0.5, name='hair' if tint else None)
        accent_m = mat(accent, name='accent' if tint else None)

        # legs
        self.legL = self._leg('legL', -0.042, skin_m, shorts_m)
        self.legR = self._leg('legR', 0.042, skin_m, shorts_m)

        # torso (+ shorts / apron)
        g = Geo()
        g.cyl(0.082, 0.07, (0, 0, 0.13), shorts_m, seg=18, bevel=0.02)
        g.cyl(0.08, 0.13, (0, 0, 0.2), shirt_m, seg=18, bevel=0.03, r2=0.07)
        if outfit == 'chef':
            g.box((0.11, 0.02, 0.14), (0, -0.075, 0.17), accent_m if tint else mat('#ffffff'), bevel=0.008)
            g.cyl(0.07, 0.03, (0, -0.01, 0.262), accent_m if tint else mat('#ff4b3e'), seg=16)
            for zz in (0.21, 0.17):
                g.sphere(0.009, (0.03, -0.083, zz), mat('#d9d9d9'), seg=8)
        elif outfit == 'sport':
            g.box((0.024, 0.006, 0.024), (0.04, -0.078, 0.23), mat('#ffffff'), bevel=0.004)
        elif outfit == 'worker':
            g.box((0.12, 0.02, 0.1), (0, -0.075, 0.2), mat('#ffb21f'), bevel=0.006)
        self.torso = g.build(f'{name}_torso', self.root)

        # head (origin at the neck)
        g = Geo()
        g.sphere(0.14, (0, 0, 0.13), skin_m, seg=24)
        g.sphere(0.148, (0, 0.018, 0.165), hair_m, scale=(1.03, 1.0, 0.86), seg=24)
        g.sphere(0.07, (-0.06, -0.09, 0.22), hair_m, scale=(1.2, 0.7, 0.55), seg=14)
        g.sphere(0.06, (0.05, -0.1, 0.23), hair_m, scale=(1.2, 0.6, 0.5), seg=14)
        for ex in (-0.05, 0.05):
            g.sphere(0.022, (ex, -0.128, 0.115), mat('#2a1a14', rough=0.25), scale=(0.75, 0.45, 1.15), seg=12)
            g.sphere(0.007, (ex + 0.006, -0.137, 0.128), mat('#ffffff', rough=0.2), seg=8)
            g.sphere(0.022, (ex * 1.7, -0.118, 0.075), mat('#ff9a9a'), scale=(1.2, 0.3, 0.7), seg=10)
        g.sphere(0.012, (0, -0.138, 0.07), mat('#e98f7c'), scale=(1.6, 0.5, 0.6), seg=8)
        if hat == 'band':
            g.cyl(0.146, 0.03, (0, 0.005, 0.2), accent_m if tint else mat('#ff3d57'), seg=24)
        elif hat == 'chef':
            g.cyl(0.11, 0.07, (0, 0.005, 0.265), mat('#ffffff'), seg=20)
            for dx, dy in ((0, 0), (0.06, 0.03), (-0.06, 0.03), (0.0, 0.06), (0.04, -0.04), (-0.04, -0.04)):
                g.sphere(0.075, (dx, dy, 0.33), mat('#ffffff'), seg=14)
        elif hat == 'hard':
            g.sphere(0.155, (0, 0.01, 0.19), mat('#ffc21f', rough=0.35), scale=(1, 1, 0.7), seg=20)
            g.cyl(0.18, 0.012, (0, -0.01, 0.17), mat('#ffc21f', rough=0.35), seg=24)
        elif hat == 'cap':
            g.sphere(0.15, (0, 0.01, 0.19), mat(shirt), scale=(1, 1, 0.72), seg=20)
            g.box((0.13, 0.1, 0.012), (0, -0.14, 0.2), mat(shirt), bevel=0.005)
        self.head = g.build(f'{name}_head', self.root, loc=(0, 0, 0.265))

        # arms
        self.armL = self._arm('armL', -0.098, skin_m, shirt_m)
        self.armR = self._arm('armR', 0.098, skin_m, shirt_m)
        self.socket = empty(f'{name}_hand', self.armR, (0, 0, -0.125))
        self.socketL = empty(f'{name}_handL', self.armL, (0, 0, -0.125))

    def _leg(self, nm, x, skin_m, shorts_m):
        g = Geo()
        g.sphere(0.034, (0, 0, -0.045), skin_m, scale=(1, 1, 1.5), seg=12)
        g.sphere(0.036, (0, -0.012, -0.098), mat('#ffffff', rough=0.45), scale=(1, 1.45, 0.62), seg=12)
        g.box((0.05, 0.08, 0.01), (0, -0.012, -0.112), mat('#ff5a5f'), bevel=0.004)
        return g.build(f'{self.name}_{nm}', self.root, loc=(x, 0, 0.115))

    def _arm(self, nm, x, skin_m, shirt_m):
        g = Geo()
        g.sphere(0.034, (0, 0, -0.01), shirt_m, seg=12)
        g.sphere(0.026, (0, 0, -0.06), skin_m, scale=(1, 1, 1.9), seg=12)
        g.sphere(0.03, (0, 0, -0.12), skin_m, seg=12)
        return g.build(f'{self.name}_{nm}', self.root, loc=(x, 0, 0.245), rot=(0, 0, 0))


# Tools are built in the hand socket's space: the arm points along -Z.
def racket(parent, name, color='#ff4757', tennis=True):
    g = Geo()
    if tennis:
        g.cyl(0.011, 0.1, (0, 0, -0.04), mat('#2d3340'), seg=8)
        g.cyl(0.075, 0.012, (0, 0, -0.17), mat(color), seg=24, rot=(0, math.pi / 2, 0))
        g.cyl(0.062, 0.014, (0, 0, -0.17), mat('#f6f2e6'), seg=24, rot=(0, math.pi / 2, 0))
    else:
        g.cyl(0.012, 0.06, (0, 0, -0.03), mat('#b07a4a'), seg=8)
        g.cyl(0.055, 0.012, (0, 0, -0.1), mat('#e63946'), seg=24, rot=(0, math.pi / 2, 0))
        g.cyl(0.052, 0.014, (0, 0, -0.1), mat('#1d1d24'), seg=24, rot=(0, math.pi / 2, 0))
    return g.build(name, parent)


def knife(parent, name):
    g = Geo()
    g.cyl(0.01, 0.05, (0, 0, -0.01), mat('#2d3340'), seg=8)
    g.box((0.004, 0.035, 0.09), (0, -0.012, -0.075), mat('#dfe4ea', rough=0.25, metal=0.6), bevel=0.002)
    return g.build(name, parent)


def pan(parent, name):
    g = Geo()
    g.cyl(0.01, 0.1, (0, 0, -0.03), mat('#2d3340'), seg=8)
    g.cyl(0.075, 0.025, (0, 0, -0.14), mat('#3a3f4a', rough=0.35, metal=0.4), seg=24, rot=(math.pi / 2, 0, 0))
    return g.build(name, parent)


def hammer(parent, name):
    g = Geo()
    g.cyl(0.01, 0.12, (0, 0, -0.04), mat('#b07a4a'), seg=8)
    g.box((0.035, 0.08, 0.035), (0, -0.01, -0.105), mat('#5b6270', rough=0.35, metal=0.5), bevel=0.006)
    return g.build(name, parent)

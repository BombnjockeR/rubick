"""Contact sheets for reviewing a rigged character's clips (one row per clip).

    blender -b art/build/bunny_rigged.blend --python art/preview_clips.py -- out.png [frames] [view]

view: 'front' (3/4 front, default), 'side' or 'back'. Needs the .blend written
by `art/animals.py <dir> --blend`.
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = args[0] if args else 'clips.png'
cols = int(args[1]) if len(args) > 1 else 8
view = args[2] if len(args) > 2 else 'front'
sc = bpy.context.scene
rig = next(o for o in sc.objects if o.type == 'ARMATURE')
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.display.shading.show_shadows = True
R = 300
sc.render.resolution_x = sc.render.resolution_y = R
sc.render.image_settings.file_format = 'PNG'
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 1.45
cam = bpy.data.objects.new('cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
d = Vector({'front': (0.55, -1, 0.25), 'side': (1, 0, 0.1), 'back': (-0.5, 1, 0.3)}[view]).normalized()
cam.location = Vector((0, 0, 0.55)) + d * 4
cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
# floor line so hops and foot contact are visible
bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, -0.001))
order = ['idle', 'walk', 'run', 'jump', 'victory', 'swing']
acts = sorted(bpy.data.actions, key=lambda a: order.index(a.name) if a.name in order else 99)
rows = []
tmp = os.path.join(os.path.dirname(os.path.abspath(out)), '_frame.png')
for act in acts:
    rig.animation_data_create()
    rig.animation_data.action = act
    if hasattr(rig.animation_data, 'action_slot') and act.slots:
        rig.animation_data.action_slot = act.slots[0]
    f0, f1 = act.frame_range
    row = []
    for i in range(cols):
        f = f0 + (f1 - f0) * i / (cols - (0 if act.use_cyclic else 1))
        sc.frame_set(int(round(f)))
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        row.append(np.array(img.pixels[:], dtype=np.float32).reshape(R, R, 4))
        bpy.data.images.remove(img)
    rows.append(np.concatenate(row, axis=1))
    print(act.name, int(f0), int(f1), 'loop' if act.use_cyclic else 'once')
sheet = np.concatenate(rows[::-1], axis=0)   # first clip on top
o = bpy.data.images.new('sheet', sheet.shape[1], sheet.shape[0], alpha=True)
o.pixels[:] = sheet.ravel()
o.filepath_raw = out
o.file_format = 'PNG'
o.save()
os.remove(tmp)
print('saved', out)

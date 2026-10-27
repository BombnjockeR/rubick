"""Builds the rigged, animated animal characters from the source FBX files.

    blender -b --factory-startup --python art/animals.py -- <out_dir> [bunny dog]
    python3.13 art/animals.py <out_dir> [bunny dog]          (pip install bpy)

Inputs (local only, never modified): art/source/characters/<id>/*.fbx + .fbm/
Outputs in <out_dir>: <id>.glb (skinned mesh + clips idle, walk, run, jump,
victory, swing) and, with --blend, <id>_rigged.blend for inspection.

Landmarks are joint positions measured on the source model (source FBX
coordinates: meters, Z up, facing -Y). To add a character, copy an entry in
CHARACTERS, measure its joints (see docs/ASSET_PIPELINE.md) and rebuild.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math  # noqa: E402

import numpy as np  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402
import clips  # noqa: E402
import rig  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'characters')

CHARACTERS = {
    'bunny': {
        'fbx': 'bunny/cartoon_bunny_3d_model.fbx',
        'center': (0.037, 0.045),   # pelvis centre on the floor -> new origin
        'joints': {
            'hips': (0.037, 0.045, 0.235), 'spine': (0.037, 0.045, 0.31), 'chest': (0.037, 0.05, 0.38),
            'neck': (0.037, 0.053, 0.455), 'top': (0.045, 0.035, 0.72), 'back': (0.037, 0.10, 0.40),
            'hipL': (0.09, 0.048, 0.225), 'kneeL': (0.108, 0.05, 0.165), 'ankleL': (0.113, 0.058, 0.095),
            'toeL': (0.135, -0.075, 0.035),
            'hipR': (-0.016, 0.042, 0.225), 'kneeR': (-0.038, 0.037, 0.165), 'ankleR': (-0.045, 0.05, 0.095),
            'toeR': (-0.09, -0.065, 0.035),
            'shoulderL': (0.115, 0.05, 0.415), 'elbowL': (0.155, 0.055, 0.345), 'wristL': (0.135, 0.03, 0.30),
            'fistL': (0.132, 0.021, 0.265), 'gripL': (0.132, 0.0, 0.235),
            'shoulderR': (-0.045, 0.05, 0.415), 'elbowR': (-0.10, 0.035, 0.355), 'wristR': (-0.125, -0.03, 0.32),
            'fistR': (-0.132, -0.062, 0.305), 'gripR': (-0.16, -0.085, 0.37),
            'earL0': (0.145, 0.025, 0.70), 'earL1': (0.205, 0.015, 0.84), 'earL2': (0.28, -0.005, 0.945),
            'earR0': (-0.015, 0.05, 0.70), 'earR1': (-0.033, 0.075, 0.84), 'earR2': (-0.055, 0.098, 0.99),
            'tail0': (0.047, 0.10, 0.275), 'tail1': (0.047, 0.15, 0.278), 'tail2': (0.047, 0.19, 0.28),
        },
        # The racket is three separate pieces (frame, strings, handle) next to the right fist.
        'racket': {'box': ((-0.30, -0.20, 0.23), (-0.08, 0.0, 0.66)), 'whole_parts': True},
        'shorts': ((0.43, 0.38, 0.22), 0.14),   # texture colour of the shorts (arms never pull them)
        # The left fist rests on the hip, fused to the shorts and shirt: cut the forearm
        # free and turn it a little forward and out so the hand clears the body.
        'remodel': {'free_arm': {'side': 'L', 'radius': 0.042, 'pitch': -28, 'out': 10}},
        'traits': {'ears': 'up', 'pocket': False, 'tail': 0.6},
    },
    'dog': {
        'fbx': 'dog/cartoon_dog_3d_model.fbx',
        'center': (0.03, -0.045),
        'joints': {
            'hips': (0.03, -0.05, 0.30), 'spine': (0.03, -0.05, 0.40), 'chest': (0.028, -0.04, 0.50),
            'neck': (0.035, -0.03, 0.655), 'top': (0.045, -0.04, 0.95), 'back': (0.03, 0.06, 0.55),
            'hipL': (0.095, -0.05, 0.29), 'kneeL': (0.122, -0.04, 0.205), 'ankleL': (0.122, -0.025, 0.115),
            'toeL': (0.17, -0.185, 0.04),
            'hipR': (-0.035, -0.05, 0.29), 'kneeR': (-0.062, -0.04, 0.205), 'ankleR': (-0.062, -0.025, 0.115),
            'toeR': (-0.115, -0.185, 0.04),
            'shoulderL': (0.125, -0.035, 0.575), 'elbowL': (0.205, -0.02, 0.49), 'wristL': (0.175, -0.06, 0.42),
            'fistL': (0.16, -0.085, 0.385), 'gripL': (0.155, -0.095, 0.35),
            'shoulderR': (-0.075, -0.035, 0.575), 'elbowR': (-0.11, -0.06, 0.47), 'wristR': (-0.145, -0.14, 0.495),
            'fistR': (-0.155, -0.175, 0.51), 'gripR': (-0.19, -0.185, 0.60),
            'earL0': (0.165, 0.0, 0.915), 'earL1': (0.225, 0.005, 0.86), 'earL2': (0.265, 0.0, 0.79),
            'earR0': (-0.067, 0.0, 0.94), 'earR1': (-0.11, 0.005, 0.895), 'earR2': (-0.15, 0.0, 0.845),
            'tail0': (0.05, 0.03, 0.355), 'tail1': (0.058, 0.12, 0.355), 'tail2': (0.065, 0.20, 0.43),
        },
        # The racket is fused to the right fist: everything in the box except the fist itself.
        'racket': {'box': ((-0.31, -0.225, 0.40), (-0.11, -0.125, 0.85)), 'keep': ('fistR', 0.045)},
        # The left forearm was modelled buried in the shorts pocket (only fragments of the
        # hand exist): replace forearm and fist with a mirrored copy of the right ones,
        # then turn it forward and out so the arm can move.
        'shorts': ((0.2, 0.17, 0.16), 0.12),
        'remodel': {'hand': {'side': 'L', 'cut': 0.72, 'radius': 0.06, 'fur': (0.75, 0.5, 0.28), 'tol': 0.22,
                             'donor_radius': 0.045, 'forearm': 0.05},
                    'free_arm': {'side': 'L', 'radius': 0.048, 'pitch': -30, 'out': 12, 'lift': False}},
        'traits': {'ears': 'floppy', 'pocket': False, 'tail': 1.0},
    },
}


def remodel(mesh, cfg, J):
    """Per-character mesh fixes before rigging (see 'remodel' in CHARACTERS).
    Returns the joints, moved where the mesh was re-posed."""
    r = cfg.get('remodel') or {}
    me = mesh.data
    J = {k: np.asarray(v, float) for k, v in J.items()}
    if 'hand' in r:
        d = r['hand']
        fc = np.array([tuple(p.center) for p in me.polygons])
        cols = rig.face_colors(mesh)
        s, o = d['side'], 'R' if d['side'] == 'L' else 'L'
        e, f, w = J['elbow' + s], J['fist' + s], J['wrist' + s]
        ax = f - e
        t = (fc - e) @ ax / (ax @ ax)
        radial = np.linalg.norm((fc - e) - np.outer(t, ax), axis=1)
        fur = np.linalg.norm(cols - np.asarray(d['fur']), axis=1) < d['tol']
        remove = fur & (t > d['cut']) & (t < 1.9) & (radial < d['radius'])
        cx, cy = cfg['center']
        lo, hi = (np.subtract(c, (cx, cy, 0)) for c in cfg['racket']['box'])
        prop = np.all((fc >= lo) & (fc <= hi), axis=1) & (np.linalg.norm(fc - J['fist' + o], axis=1) > d['donor_radius'])
        donor = (np.linalg.norm(fc - J['fist' + o], axis=1) < d['donor_radius']) & ~prop & fur   # fingers, not the grip
        frm = (J['fist' + o], J['fist' + o] - J['wrist' + o], J['grip' + o] - J['fist' + o])
        to = (f, f - w, (0.0, -1.0, 0.0))
        remove = None
        if d.get('forearm'):   # the whole forearm from the elbow down, laid along the old one's line
            eo = J['elbow' + o]
            _, do = rig.closest_on_polyline(fc, [eo, J['wrist' + o], J['fist' + o]])
            to_ = (fc - eo) @ (J['fist' + o] - eo) / ((J['fist' + o] - eo) @ (J['fist' + o] - eo))
            donor |= fur & ~prop & (do < d['forearm']) & (to_ > 0.1)
            _, ds = rig.closest_on_polyline(fc, [e, w, f])
            remove = fur & (ds < d['forearm'] * 1.3) & (t > 0.1)
            frm = (eo, J['wrist' + o] - eo, J['grip' + o] - J['fist' + o])
            to = (e, w - e, (0.0, -1.0, 0.0))
            move = rig.mirror_map(frm, to)
            for j in ('wrist', 'fist', 'grip'):   # the bones follow the new forearm
                J[j + s] = np.array(move(J[j + o]))
        added, removed = rig.replace_hand(mesh, remove, donor, frm, to, prefer=cfg['shorts'][0])
        what = 'forearm and fist' if d.get('forearm') else 'fist'
        print(f'  remodel: {s} hand: {what} mirrored from the {o} arm ({added} faces), {removed} buried faces removed')
    if 'free_arm' in r:
        d = r['free_arm']
        s = d['side']
        shorts_col, shorts_tol = cfg['shorts']
        old = old_hand(mesh, J, r.get('hand'), s)
        region, _ = forearm_parts(mesh, J, d)
        shorts = np.linalg.norm(rig.face_colors(mesh) - np.asarray(shorts_col), axis=1) < shorts_tol
        band = forearm_band(mesh, J, d)
        rig.mark_islands(mesh)
        if d.get('lift', True):   # (a forearm rebuilt by 'hand' is already a separate piece)
            lift, added, dropped = rig.tidy_selection(mesh, region & ~shorts & ~old, band, keep_out=old | shorts)
            print(f'  remodel: {s} forearm selection tidied: {added} faces joined, {dropped} specks dropped')
            n_copy, n_patch = rig.lift_limb(mesh, lift, prefer=shorts_col)
            print(f'  remodel: {s} forearm and hand lifted off the body ({n_copy} faces; {n_patch} patches where they touched)')
        old = old_hand(mesh, J, r.get('hand'), s)
        if old.any():   # the buried hand left on the body: never visible before, now it would be
            print(f'  remodel: removed {rig.delete_faces(mesh, old, patch=True, prefer=shorts_col)} faces of the old buried hand')
        print(f'  remodel: removed {rig.drop_fragments(mesh)} faces of loose fragments the cut left')
    return {k: tuple(float(x) for x in v) for k, v in J.items()}


def old_hand(mesh, J, d, side):
    """Faces of a hand modelled buried in a pocket (see remodel 'hand'), excluding
    the replacement fist and the lifted limb copy."""
    me = mesh.data
    if not d:
        return np.zeros(len(me.polygons), bool)
    J = {k: np.asarray(v, float) for k, v in J.items()}
    e, f = J['elbow' + side], J['fist' + side]
    ax = f - e
    fc = np.array([tuple(p.center) for p in me.polygons])
    t = (fc - e) @ ax / (ax @ ax)
    radial = np.linalg.norm((fc - e) - np.outer(t, ax), axis=1)
    fur = np.linalg.norm(rig.face_colors(mesh) - np.asarray(d['fur']), axis=1) < d['tol']
    part = vertex_part(mesh)
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', lt)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    tagged = np.zeros(len(lt), bool)
    np.logical_or.at(tagged, np.repeat(np.arange(len(lt)), lt), part[lv] > 0)
    return fur & (t > d['cut']) & (t < 1.9) & (radial < d['radius'] + 0.01) & ~tagged


def forearm_parts(mesh, J, d):
    """Faces of a forearm + hand that should move freely (`region`: limb surface past
    the elbow's hinge band) and the body faces touching or near it (`others`)."""
    s = d['side']
    J = {k: np.asarray(v, float) for k, v in J.items()}
    chain = [J['shoulder' + s], J['elbow' + s], J['wrist' + s], J['fist' + s]]
    e, f = J['elbow' + s], J['fist' + s]
    ax = f - e
    me = mesh.data
    limb, fc = rig.limb_faces(mesh, chain, d['radius'])
    t = (fc - e) @ ax / (ax @ ax)
    _, dist = rig.closest_on_polyline(fc, chain[1:])
    region = limb & (t > 0.35)
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', lt)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    fid = np.repeat(np.arange(len(lt)), lt)
    rv = np.zeros(len(me.vertices), bool)
    rv[lv[region[fid]]] = True
    touching = np.zeros(len(lt), bool)
    np.logical_or.at(touching, fid, rv[lv])
    others = ~region & ((touching & (t > 0.42)) | (~limb & (dist < 0.12) & (t > 0.2)))
    return region, others


def forearm_band(mesh, J, d):
    """Faces near the forearm's bone line past the elbow hinge band, whatever their
    normal or colour: where a lifted forearm may take faces from."""
    s = d['side']
    J = {k: np.asarray(v, float) for k, v in J.items()}
    e, f = J['elbow' + s], J['fist' + s]
    fc = np.array([tuple(p.center) for p in mesh.data.polygons])
    t = (fc - e) @ (f - e) / ((f - e) @ (f - e))
    _, dist = rig.closest_on_polyline(fc, [J['elbow' + s], J['wrist' + s], J['fist' + s]])
    return (dist < d['radius'] * 1.25) & (t > 0.35)


def vertex_part(mesh):
    """The 'part' vertex attribute written by rig.lift_limb (1 = lifted limb copy)."""
    me = mesh.data
    a = me.attributes.get('part')
    out = np.zeros(len(me.vertices), dtype=np.int64)
    if a is not None:
        a.data.foreach_get('value', out)
    return out


def centred(cfg):
    cx, cy = cfg['center']
    return {k: (v[0] - cx, v[1] - cy, v[2]) for k, v in cfg['joints'].items()}


def build(cid, out_dir, save_blend=False, tex_size=1024):
    cfg = CHARACTERS[cid]
    rig.reset()
    cx, cy = cfg['center']
    mesh = rig.load_mesh(os.path.join(SRC, cfg['fbx']), f'{cid}_body', offset=(cx, cy, 0))
    rig.clean_material(mesh, 'body')
    J = remodel(mesh, cfg, centred(cfg))
    arm = rig.build_rig(f'ch_{cid}', J)
    missed = rig.heat_bind(mesh, arm)
    print(f'{cid}: heat weights done, {missed} vertices unweighted before cleanup')
    sk = rig.Skin(mesh, J)
    sk.fill_unweighted()
    n_sep = 0
    for s in 'LR':
        n_sep += sk.separate_limb([f'shoulder{s}', f'elbow{s}', f'wrist{s}', f'fist{s}'],
                                  [f'arm{s}', f'forearm{s}', f'hand{s}'],
                                  ['hips', 'spine', 'chest', 'neck'], ['hips', 'spine', 'chest'],
                                  top=J[f'shoulder{s}'][2] - 0.02)
    print(f'{cid}: {n_sep} torso vertices freed from arm bones')
    sk.rigid_hand('handR', 'fistR', ['armR', 'forearmR', 'handR'])
    sk.rigid_hand('handL', 'fistL', ['armL', 'forearmL', 'handL'])
    # Shorts never follow the arms (a hand rested on, or in, them in the source pose).
    shorts_col, shorts_tol = cfg['shorts']
    vshorts = vertex_share(mesh, np.linalg.norm(rig.face_colors(mesh) - np.asarray(shorts_col), axis=1) < shorts_tol)
    for side in 'LR':
        sk.release([f'arm{side}', f'forearm{side}', f'hand{side}'], vshorts, to=('hips', 'spine'))
    turn = (cfg.get('remodel') or {}).get('free_arm')
    if turn:   # the freed forearm moves only with its arm; what it was cut from never does
        s = turn['side']
        lifted = vertex_part(mesh) > 0   # lifted copy (1) or rebuilt hand / forearm (2)
        e, f = np.asarray(J['elbow' + s], float), np.asarray(J['fist' + s], float)
        tv = (sk.P - e) @ (f - e) / ((f - e) @ (f - e))
        _, dv = rig.closest_on_polyline(sk.P, [np.asarray(J[j + s], float) for j in ('elbow', 'wrist', 'fist')])
        chain = [f'arm{s}', f'forearm{s}', f'hand{s}']
        sk.release(chain, ~lifted & (tv > 0.42) & (dv < 0.12), to=('hips', 'spine', 'chest'))
        sk.absorb(chain, lifted)
    rk = cfg['racket']
    box = tuple(tuple(np.subtract(c, (cx, cy, 0))) for c in rk['box'])
    racket_mask = sk.rigid_region('handR', box, whole_parts=rk.get('whole_parts', False), keep=rk.get('keep'))
    n_racket = int(racket_mask.sum())
    pin = cfg.get('pin')
    n_pin = sk.pin_limb(['elbowL', 'wristL', 'fistL'], ['armL', 'forearmL', 'handL'],
                        {b: w * pin['max'] for b, w in pin['to'].items() if w},
                        start=pin['start'], end=pin['end']) if pin else 0
    for side in (1, -1):
        legs = ['thighL', 'shinL', 'footL'] if side > 0 else ['thighR', 'shinR', 'footR']
        sk.keep_side(legs, side, margin=0.0)
    sk.rigid_feet({'footL': J['ankleL'][2], 'footR': J['ankleR'][2]})
    sk.unify_components(max_size=100)
    sk.smooth(iters=4, alpha=0.4)
    sk.finalize()
    print(f'{cid}: racket {n_racket} verts rigid to handR, pocket pin on {n_pin} verts')
    # Tools: the modelled racket becomes its own mesh, and a table-tennis paddle is
    # made for the same grip; the game shows one of them (prop_racket / prop_paddle).
    racket = rig.split_off(mesh, racket_mask, 'prop_racket')
    paddle = rig.build_paddle(arm, J['fistR'], sk.P[racket_mask])
    if turn:   # move the freed forearm forward and out for good (new rest pose)
        s = turn['side']
        sign = 1 if s == 'L' else -1
        rig.apply_pose_as_rest([mesh], arm, lambda a: a.rot(f'forearm{s}', pitch=turn['pitch'], side=-turn['out'] * sign))
        print(f'{cid}: {s} forearm re-posed {turn["pitch"]} deg forward / {turn["out"]} deg out')
    an = rig.Anim(arm, soles=sole_points(sk.P))
    acts = clips.make_all(an, clips.Traits(**cfg['traits']))
    print(f'{cid}: clips ' + ', '.join(f'{a.name} ({int(a.frame_range[1])}f)' for a in acts))
    rig.downsize_texture(mesh, tex_size, os.path.join(out_dir, '_tex'))
    if save_blend:   # rigged, animated character for inspection in Blender (texture packed in)
        import bpy
        bpy.data.orphans_purge(do_recursive=True)   # the FBX's own material and 4096px image
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out_dir, f'{cid}_rigged.blend')))
    rig.export_glb(os.path.join(out_dir, f'{cid}.glb'), [arm, mesh, racket, paddle])
    return mesh, arm


def vertex_share(mesh, face_mask):
    """Per vertex: the fraction of its faces in face_mask."""
    me = mesh.data
    lt = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', lt)
    lv = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    fm = np.repeat(face_mask.astype(float), lt)
    hit = np.bincount(lv, weights=fm, minlength=len(me.vertices))
    cnt = np.bincount(lv, minlength=len(me.vertices))
    return hit / np.maximum(cnt, 1)


def sole_points(P, floor=0.012):
    """Front/back/side extremes of each shoe's sole, for the ground solver."""
    out = {}
    for foot, side in (('footL', 1), ('footR', -1)):
        low = P[(P[:, 2] < floor) & (P[:, 0] * side > 0)]
        pts = [low[low[:, 1].argmin()], low[low[:, 1].argmax()], low[low[:, 0].argmin()], low[low[:, 0].argmax()]]
        out[foot] = [(float(x), float(y), 0.0) for x, y, _ in pts]
    return out


if __name__ == '__main__':
    a = rig.script_args()
    flags = {x for x in a if x.startswith('--')}
    pos = [x for x in a if not x.startswith('--')]
    out = pos[0] if pos else 'assets'
    ids = pos[1:] or list(CHARACTERS)
    os.makedirs(out, exist_ok=True)
    for cid in ids:
        build(cid, out, save_blend='--blend' in flags)

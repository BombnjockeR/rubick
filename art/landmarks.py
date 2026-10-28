"""Joint landmarks measured automatically on a T-posed character mesh.

The AI-generated characters come unrigged, standing in a T-pose (arms straight
out along X), facing -Y, feet on z = 0, 1 unit tall. Instead of measuring every
joint by hand (art/animals.py did that for the bunny and the pup, which stand
arms-down), `auto_joints` reads them off the mesh:

  arms   the arm band is the z range the hands occupy; walking from the hand in,
         the shoulder is where the slice starts to contain torso (its lowest point
         drops well below the arm); the wrist and fist sit a fixed hand length in
         from the fingertips; the elbow is halfway
  legs   the crotch is the lowest slice where the two legs join; hips a little
         above it; each leg's centre is the centroid of its side of the slice;
         the ankle is the top of a separate shoe piece (or the narrowest point of
         the lower leg); the toe is the shoe's foremost point
  spine  hips, spine, chest (just under the shoulders), neck (the narrowest slice
         between the shoulders and the head), head top (the highest slice still as
         deep front-to-back as a head, so ears and tufts don't count)
  ears   anything above the head top, split left / right; without ears, short
         stubs on the sides of the head (no clip can tell)
  tail   a cluster behind the hips; without one, stubs inside the body

Everything is in the mesh's own coordinates; `overrides` replaces single joints
where the rule guesses wrong (checked on renders of the skeleton over the mesh:
tools/… see docs/ASSET_PIPELINE.md). Returns the joint table rig.build_rig wants
plus `center` (pelvis x, y: what should become the origin).
"""
import numpy as np


def _slice(P, z, h=0.01, mask=None):
    m = (P[:, 2] >= z - h / 2) & (P[:, 2] < z + h / 2)
    if mask is not None:
        m &= mask
    return P[m]


def _centroid(pts, default):
    return pts.mean(0) if len(pts) else np.asarray(default, float)


def _middle(pts, default):
    """Centre of a slice that is robust to a pouch or pack hanging on one side: the
    midpoint of the slice's extent, trimmed of the 10 % most extreme points."""
    if not len(pts):
        return np.asarray(default, float)
    lo, hi = np.percentile(pts, 10, axis=0), np.percentile(pts, 90, axis=0)
    return (lo + hi) / 2


def auto_joints(P, comp=None, hand_len=0.075, fist_in=0.035, overrides=None, print_fn=print):
    """P: (N, 3) vertex positions; comp: connected-component id per vertex (for the
    shoes); overrides: {joint: (x, y, z)} applied last."""
    P = np.asarray(P, float)
    H = P[:, 2].max()
    out = {}
    note = []

    # ---- arms: the hands are the outermost vertices
    xmax = np.abs(P[:, 0]).max()
    hands = P[np.abs(P[:, 0]) > xmax - 0.5 * hand_len]
    armZ = float(hands[:, 2].mean())
    band = np.abs(P[:, 2] - armZ) < 0.22          # vertices around arm height
    for side, sgn in (('L', 1), ('R', -1)):
        pts = P[band & (P[:, 0] * sgn > 0)]
        tipX = float(pts[:, 0].max()) if sgn > 0 else float(pts[:, 0].min())
        # walk inward 1 cm at a time: a sleeve's columns stay within arm height; the
        # body's columns (shirt, shorts, legs) reach far below the arm. The joint sits
        # 3 cm inside that edge, as a shoulder does.
        xs = np.arange(abs(tipX), 0.0, -0.01)
        whole = P[P[:, 0] * sgn > 0]
        edge = None
        for x in xs:
            col = whole[(np.abs(whole[:, 0]) >= x - 0.005) & (np.abs(whole[:, 0]) < x + 0.005)]
            if len(col) >= 3 and col[:, 2].min() < armZ - 0.28:
                edge = x
                break
        if edge is None:
            edge = abs(tipX) * 0.45
            note.append(f'shoulder{side}: no torso found, guessed')
        shoulder = edge - 0.03

        def arm_centre(x, r=0.012):
            col = pts[(np.abs(pts[:, 0]) >= x - r) & (np.abs(pts[:, 0]) < x + r) & (np.abs(pts[:, 2] - armZ) < 0.12)]
            c = _centroid(col, (x * sgn, 0.0, armZ))
            return np.array([x * sgn, c[1], c[2]])
        sh = arm_centre(edge + 0.01)
        sh[0] = shoulder * sgn
        wr = arm_centre(abs(tipX) - hand_len)
        fi = arm_centre(abs(tipX) - fist_in, r=0.02)
        el = (sh + wr) / 2
        el[1] = arm_centre((shoulder + abs(tipX) - hand_len) / 2)[1]
        out['shoulder' + side] = sh
        out['elbow' + side] = el
        out['wrist' + side] = wr
        out['fist' + side] = fi
        out['grip' + side] = fi + np.array([0.0, -0.07, 0.0])   # a held racket points forward
    shoulderZ = (out['shoulderL'][2] + out['shoulderR'][2]) / 2

    # ---- legs
    shin = _slice(P, 0.12, h=0.04)
    legY = float(np.median(shin[:, 1])) if len(shin) else 0.0
    low = P[(P[:, 2] < shoulderZ - 0.1) & (np.abs(P[:, 1] - legY) < 0.12)]
    crotch = None
    for z in np.arange(0.06, shoulderZ - 0.1, 0.01):
        s = _slice(low, z)
        if len(s) and np.abs(s[:, 0]).min() < 0.012:
            crotch = z
            break
    if crotch is None:
        crotch = 0.3 * H
        note.append('crotch not found, guessed')
    hipZ = max(crotch + 0.035, 0.36 * shoulderZ)
    for side, sgn in (('L', 1), ('R', -1)):
        legm = (P[:, 0] * sgn > 0.01) & (np.abs(P[:, 1] - legY) < 0.2)
        sole = P[legm & (P[:, 2] < 0.06)]
        shoe_depth = (sole[:, 1].max() - sole[:, 1].min()) if len(sole) else 0.2
        ankleZ = 0.1 * H
        for z in np.arange(0.05, 0.3, 0.01):   # first slice that is leg rather than shoe
            s = _slice(P, z, mask=legm)
            if len(s) >= 4 and (s[:, 1].max() - s[:, 1].min()) < 0.62 * shoe_depth:
                ankleZ = z - 0.005
                break
        ankleZ = min(ankleZ, hipZ - 0.08)
        shoe = P[legm & (P[:, 2] < ankleZ)]
        kneeZ = ankleZ + 0.47 * (hipZ - ankleZ)
        hip = _centroid(_slice(P, hipZ, h=0.02, mask=legm), (0.08 * sgn, 0.0, hipZ))
        knee = _centroid(_slice(P, kneeZ, h=0.02, mask=legm), (hip[0], hip[1], kneeZ))
        ank = _centroid(_slice(P, ankleZ, h=0.02, mask=legm), (knee[0], knee[1], ankleZ))
        toe_y = float(shoe[:, 1].min())
        toe = np.array([float(ank[0]), toe_y + 0.015, 0.03])
        out['hip' + side] = np.array([hip[0], hip[1], hipZ])
        out['knee' + side] = np.array([knee[0], knee[1], kneeZ])
        out['ankle' + side] = np.array([ank[0], ank[1], ankleZ])
        out['toe' + side] = toe

    # ---- spine and head
    torso = np.abs(P[:, 0]) < 0.12
    hips = _middle(_slice(P, hipZ, h=0.03, mask=torso), (0, 0, hipZ))
    chestZ = shoulderZ - 0.03
    chest = _middle(_slice(P, chestZ, h=0.03, mask=torso), (0, 0, chestZ))
    spineZ = hipZ + 0.45 * (chestZ - hipZ)
    spine = _middle(_slice(P, spineZ, h=0.03, mask=torso), (0, 0, spineZ))
    # neck: narrowest slice (x extent of the middle) just above the shoulders; hair,
    # hoods and big heads hide it, so the search window is short
    best, neckZ = 1e9, shoulderZ + 0.06
    for z in np.arange(shoulderZ + 0.02, shoulderZ + 0.13, 0.01):
        s = _slice(P, z, mask=np.abs(P[:, 0]) < 0.2)
        if len(s) < 6:
            continue
        w = s[:, 0].max() - s[:, 0].min()
        if w < best:
            best, neckZ = w, z
    neck = _centroid(_slice(P, neckZ, h=0.02, mask=np.abs(P[:, 0]) < 0.2), (0, 0, neckZ))
    # head top: the highest slice still deep front-to-back (ears, tufts and hair are thin)
    depth = {}
    for z in np.arange(neckZ, H + 0.005, 0.01):
        s = _slice(P, z)
        depth[round(z, 3)] = (s[:, 1].max() - s[:, 1].min()) if len(s) > 2 else 0.0
    head_depth = max(depth.values())
    topZ = max(z for z, d in depth.items() if d > 0.5 * head_depth)
    top_slice = _slice(P, topZ, h=0.02)
    top = np.array([float(top_slice[:, 0].mean()), float(top_slice[:, 1].mean()), topZ + 0.005])
    out['hips'] = np.array([hips[0], hips[1], hipZ])
    out['spine'] = np.array([spine[0], spine[1], spineZ])
    out['chest'] = np.array([chest[0], chest[1], chestZ])
    out['neck'] = np.array([neck[0], neck[1], neckZ])
    out['top'] = top
    back_slice = _slice(P, chestZ, h=0.03, mask=np.abs(P[:, 0]) < 0.08)
    out['back'] = np.array([0.0, float(back_slice[:, 1].max()) if len(back_slice) else chest[1] + 0.1, chestZ])

    # ---- ears: above the head top
    above = P[P[:, 2] > topZ + 0.01]
    for side, sgn in (('L', 1), ('R', -1)):
        e = above[above[:, 0] * sgn > 0.02]
        if len(e) >= 12 and e[:, 2].max() > topZ + 0.03:
            base = e[e[:, 2] < e[:, 2].min() + 0.02]
            tip = e[e[:, 2].argmax()]
            e0 = np.array([base[:, 0].mean(), base[:, 1].mean(), topZ - 0.01])
            e2 = np.array([tip[0], tip[1], tip[2] - 0.005])
            out['ear' + side + '0'], out['ear' + side + '1'], out['ear' + side + '2'] = e0, (e0 + e2) / 2, e2
        else:
            note.append(f'ear{side}: none above the head, stubs added')
            e0 = np.array([0.1 * sgn, top[1], topZ - 0.08])
            out['ear' + side + '0'] = e0
            out['ear' + side + '1'] = e0 + np.array([0.025 * sgn, 0, 0.02])
            out['ear' + side + '2'] = e0 + np.array([0.045 * sgn, 0, 0.04])

    # ---- tail: behind the hips
    backY = out['back'][1]
    hip_back = _slice(P, hipZ, h=0.06, mask=np.abs(P[:, 0]) < 0.1)
    bodyBack = float(hip_back[:, 1].max()) if len(hip_back) else backY
    t = P[(P[:, 1] > bodyBack - 0.02) & (P[:, 2] > 0.12) & (P[:, 2] < shoulderZ) & (np.abs(P[:, 0]) < 0.2)]
    # keep only what sticks out behind the body line
    t = t[t[:, 1] > bodyBack + 0.01]
    if len(t) >= 25:
        root = t[t[:, 1].argmin()]
        d = np.linalg.norm(t - root, axis=1)
        tip = t[d.argmax()]
        # the chain's middle: the cluster point nearest the midpoint, pulled onto the tail's spine
        mid_target = (root + tip) / 2
        mid = t[np.linalg.norm(t - mid_target, axis=1).argmin()]
        t0 = np.array([root[0], bodyBack - 0.01, root[2]])
        out['tail0'], out['tail1'], out['tail2'] = t0, mid, tip
    else:
        note.append('tail: none found, stubs inside the body')
        t0 = np.array([0.0, bodyBack - 0.05, hipZ + 0.02])
        out['tail0'], out['tail1'], out['tail2'] = t0, t0 + np.array([0, 0.02, 0]), t0 + np.array([0, 0.04, 0.005])

    for base in ('shoulder', 'elbow', 'wrist', 'fist', 'grip', 'hip', 'knee', 'ankle', 'toe'):
        a, b = out[base + 'L'], out[base + 'R']
        x = (abs(a[0]) + abs(b[0])) / 2
        m = np.array([x, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])
        out[base + 'L'], out[base + 'R'] = m, m * np.array([-1, 1, 1])
    for k in ('hips', 'spine', 'chest', 'neck', 'top'):
        out[k][0] = 0.0
    for k, v in (overrides or {}).items():
        out[k] = np.asarray(v, float)
    center = (float(out['hips'][0]), float(out['hips'][1]))
    for n in note:
        print_fn('  landmarks: ' + n)
    joints = {k: tuple(float(x) for x in v) for k, v in out.items()}
    return joints, center, {'armZ': armZ, 'crotch': crotch, 'topZ': topZ, 'neckZ': neckZ, 'tail': len(t) if len(t) >= 25 else 0}

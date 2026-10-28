"""Animation clips for the shared animal skeleton (rig.BONES), all generated
from code so they can be tuned and rebuilt.

  idle     2.0 s  loop  relaxed: breathing, small look-around, ear twitch, tail wiggle
  ready    1.2 s  loop  tennis ready position: knees bent, racket in front in both hands
  walk     0.53 s loop  one stride (two steps), in place, feet planted (WALK_STRIDE)
  run      0.4 s  loop  one stride, in place, leaning into it, feet planted (RUN_STRIDE)
  strafeL  0.5 s  loop  side shuffle to the character's left, in the ready position
  strafeR  0.5 s  loop  side shuffle to the character's right
  jump     1.0 s  once  crouch, take off, tuck, land, settle
  victory  1.6 s  loop  two hops with the racket held high
  defeat   2.0 s  loop  head down, shoulders slumped, ears drooping
  swing    0.5 s  once  forehand; frame 0 is the racket-back pose held as the ball comes
  serve    0.7 s  once  overhead serve; frame 0 is the trophy pose (ball tossed, racket back)

Clips run in place: the game moves and turns the character. Loops start and
end on the same pose; one-shots start and end close to idle so cross-fades
are short. Angles are degrees about the body axes described in rig.py.
"""
import math

TAU = math.tau


def S(x):
    return math.sin(TAU * x)


def C(x):
    return math.cos(TAU * x)


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def pulse(p, centre, width):
    """Smooth 0..1..0 bump around `centre` (wraps around the loop)."""
    d = abs(((p - centre + 0.5) % 1.0) - 0.5) / width
    return 0.0 if d >= 1 else 0.5 * (1 + math.cos(math.pi * d))


class Traits:
    """What differs between animals: ear style, a hand kept in a pocket, tail."""

    def __init__(self, ears='up', pocket=False, tail=1.0):
        self.ears = ears        # 'up' (rabbit), 'floppy' (dog) or 'none' (hidden under a hood)
        self.pocket = pocket    # left hand stays in the shorts pocket
        self.tail = tail        # wag strength (0: no tail; the stub bones stay still)


def ears(an, t, back=0.0, out=0.0, tip=0.0):
    """back: ears trail backward; out: spread outward; tip: outer half bends further."""
    if t.ears == 'none':
        return
    if t.ears == 'up':
        an.rot('earL1', pitch=-back, side=out)
        an.rot('earR1', pitch=-back, side=-out)
        an.rot('earL2', pitch=-tip)
        an.rot('earR2', pitch=-tip)
    else:  # hanging ears: tips swing back with +pitch, flap out/up with -side (left)
        an.rot('earL1', pitch=back, side=-out)
        an.rot('earR1', pitch=back, side=out)
        an.rot('earL2', side=-tip)
        an.rot('earR2', side=tip)


def tail(an, t, wag=0.0, up=0.0):
    if not t.tail:
        return
    an.rot('tail1', yaw=wag * t.tail, pitch=up)
    an.rot('tail2', yaw=wag * 0.8 * t.tail, pitch=up * 0.5)


def leg_rest(an):
    """What foot planting needs from the rest pose: ankles, hip joints, leg lengths."""
    an.rest()
    b = an.rig.data.bones
    return {
        'ankle': {s: an.point('shin' + s) for s in 'LR'},
        'hip': {s: an.point('thigh' + s, at_tail=False) for s in 'LR'},
        'leg': {s: b['thigh' + s].length + b['shin' + s].length for s in 'LR'},
    }


def plant_legs(an, rest, p, duty, stride, lift, bend=0.97, spring=0.0, apex=0.0):
    """Legs by foot placement. Each foot is down for `duty` of the loop, moving back
    under its hip at a constant speed (`stride` per stance: a character moved at
    stride / (duty * loop time) keeps it planted), then swings forward, `lift` off the
    floor. Two-bone IK puts the ankles there and the feet stay flat. The hips sit as
    high as the planted leg allows with the knee at `bend` of its full length, sink by
    `spring` at mid-stance and rise by `apex` while both feet are up."""
    from mathutils import Vector
    feet = {}
    for s, off in (('L', 0.0), ('R', 0.5)):
        ph = (p + off) % 1.0
        centre = rest['hip'][s].y - rest['ankle'][s].y      # stride centred under the hip
        if ph < duty:                     # planted: front to back
            u = ph / duty
            feet[s] = (centre + stride * (u - 0.5), 0.0, u)
        else:                             # swinging: back to front
            u = (ph - duty) / (1 - duty)
            feet[s] = (centre + stride * (0.5 - ease(u)), lift * math.sin(math.pi * u), None)
    hip = {s: an.point('thigh' + s, at_tail=False) for s in 'LR'}

    def top(s, y):                        # hips offset that just lets this foot reach y
        a = rest['ankle'][s]
        dx, dy = a.x - hip[s].x, a.y + y - hip[s].y
        return a.z + math.sqrt(max(0.0, (bend * rest['leg'][s]) ** 2 - dx * dx - dy * dy)) - hip[s].z

    down = [top(s, y) - spring * math.sin(math.pi * u) for s, (y, z, u) in feet.items() if u is not None]
    if down:
        hz = min(down)
    else:                                 # both feet up (run): a short flight between steps
        u = ((p % 0.5) - duty) / (0.5 - duty)
        hz = 0.5 * (top('L', feet['L'][0]) + top('R', feet['R'][0])) + apex * math.sin(math.pi * u)
    an.move('hips', z=hz)
    for s in 'LR':
        y, z, _ = feet[s]
        an.reach('thigh' + s, 'shin' + s, rest['ankle'][s] + Vector((0.0, y, z)),
                 pole=(0.15 if s == 'L' else -0.15, -1.0, 0.0))
        an.level('foot' + s)


WALK_STRIDE, WALK_DUTY = 0.12, 0.6   # walk: 16 frames, 0.12 / (0.6 * 0.533 s) = 0.375 units/s
RUN_STRIDE, RUN_DUTY = 0.15, 0.38    # run: 12 frames, 0.15 / (0.38 * 0.4 s) = 0.99 units/s


def legs(an, sw, cw, stride, lift, bend, bias=0.0):
    """Leg cycle. sw = sin(phase) (+1: left foot forward), cw = cos(phase)
    (> 0 while the left leg swings through). Feet stay level with the floor."""
    for leg, s, c in (('L', sw, cw), ('R', -sw, -cw)):
        th = -stride * s - bias                       # negative pitch = thigh forward
        kn = bend + lift * max(0.0, c) ** 1.5         # knee folds in the swing phase
        an.rot('thigh' + leg, pitch=th)
        an.rot('shin' + leg, pitch=kn)
        an.rot('foot' + leg, pitch=-(th + kn))


# ---------------------------------------------------------------- clips
def idle(an, t, n=60):
    an.begin('idle', n)
    for f in an.frames():
        p = f / n
        an.rest()
        an.rot('hips', side=0.8 * S(p))
        an.rot('spine', pitch=1.0 * S(p), side=-0.8 * S(p))
        an.rot('chest', pitch=1.5 * S(p + 0.1))
        an.rot('head', pitch=-2.0 * S(p + 0.15), side=2.5 * S(p + 0.3), yaw=4 * S(p + 0.05))
        an.rot('armR', pitch=2.5 * S(p + 0.25))
        an.rot('forearmR', pitch=-2.5 * S(p + 0.35))
        an.rot('armL', pitch=0.8 * S(p) if t.pocket else 2.0 * S(p))
        twitch = pulse(p, 0.62, 0.06)
        ears(an, t, back=2 * S(p + 0.2), out=2 * S(p + 0.45), tip=-14 * twitch)
        tail(an, t, wag=10 * S(2 * p), up=3 * S(p))
        legs(an, 0, 0, 0, 0, 2)
        an.ground()
        an.key(f)


def walk(an, t, n=16):
    """Quick short-legged steps; the left foot lands at frame 0. Feet planted (plant_legs):
    js/character.js walkSpeed is the speed that keeps them so."""
    rest = leg_rest(an)
    an.begin('walk', n)
    for f in an.frames():
        p = f / n
        sw = C(p)                         # +1: left foot forward, right arm forward
        an.rest()
        an.rot('hips', yaw=-5 * sw)
        an.rot('spine', yaw=3 * sw, pitch=2)
        an.rot('chest', yaw=3 * sw, pitch=1, side=-1.5 * C(2 * p))
        an.rot('head', yaw=-1.5 * sw, pitch=-2 * C(2 * p))
        an.rot('armR', pitch=-14 * sw)
        an.rot('forearmR', pitch=-5 * sw)
        an.rot('armL', pitch=(3 if t.pocket else 12) * sw)
        ears(an, t, back=5 + 5 * C(2 * p - 0.15), tip=6 * C(2 * p - 0.3), out=2 * sw)
        tail(an, t, wag=10 * sw, up=4 * C(2 * p))
        plant_legs(an, rest, p, WALK_DUTY, WALK_STRIDE, lift=0.03, bend=0.97)
        an.key(f)


def run(an, t, n=12):
    """Leaning run with a short flight between steps; the left foot lands at frame 0.
    Feet planted (plant_legs): js/character.js runSpeed keeps them so."""
    rest = leg_rest(an)
    an.begin('run', n)
    for f in an.frames():
        p = f / n
        sw = C(p - 0.05)                  # +1: left foot forward, right arm forward
        an.rest()
        an.rot('hips', yaw=-8 * sw, pitch=6)
        an.rot('spine', yaw=5 * sw, pitch=6)
        an.rot('chest', yaw=5 * sw, pitch=3)
        an.rot('head', yaw=-3 * sw, pitch=-12 - 3 * C(2 * p))
        an.rot('armR', pitch=-28 * sw - 6)
        an.rot('forearmR', pitch=-12 - 8 * sw)
        if t.pocket:
            an.rot('armL', pitch=4 * sw)
        else:
            an.rot('armL', pitch=24 * sw - 4)
            an.rot('forearmL', pitch=-25)
        ears(an, t, back=18 + 7 * C(2 * p), tip=10 + 8 * C(2 * p - 0.2), out=4 * sw)
        tail(an, t, wag=16 * sw, up=12 + 6 * C(2 * p))
        plant_legs(an, rest, p, RUN_DUTY, RUN_STRIDE, lift=0.07, bend=0.95, spring=0.01, apex=0.012)
        an.key(f)


def jump(an, t, n=30):
    """Key poses joined by eased slerps; the airborne part is a real parabola."""
    an.begin('jump', n, loop=False)

    def crouch(depth):
        legs_bent(an, 40 * depth, 70 * depth)
        an.rot('spine', pitch=14 * depth)
        an.rot('chest', pitch=6 * depth)
        an.rot('head', pitch=-10 * depth)
        an.rot('armR', pitch=25 * depth)
        an.rot('armL', pitch=(4 if t.pocket else 22) * depth)
        ears(an, t, back=-6 * depth, tip=-6 * depth)
        tail(an, t, up=-8 * depth)

    def launch():
        legs_bent(an, -6, 4, toes=28)
        an.rot('spine', pitch=-6)
        an.rot('head', pitch=-8)
        racket_up(an, arm=(-0.62, -0.3, 0.72), fore=(-0.35, -0.6, 0.72), racket=(-0.15, -0.25, 0.95), normal=(-0.30, 0.94, 0.14))
        if not t.pocket:
            an.aim('armL', (0.62, -0.25, 0.74))
            an.aim('forearmL', (0.35, -0.55, 0.75))
        ears(an, t, back=22, tip=14)
        tail(an, t, up=-12)

    def tuck():
        legs_bent(an, 52, 88)
        an.rot('spine', pitch=4)
        an.rot('head', pitch=-12)
        racket_up(an, arm=(-0.45, -0.2, 0.87), fore=(-0.2, -0.3, 0.93), racket=(-0.05, 0.0, 1.0), normal=(0.01, 1.0, -0.06))
        if not t.pocket:
            an.aim('armL', (0.45, -0.15, 0.88))
            an.aim('forearmL', (0.2, -0.3, 0.93))
        ears(an, t, back=6, out=8, tip=-4)
        tail(an, t, up=18)

    def land():
        legs_bent(an, 46, 80)
        an.rot('spine', pitch=16)
        an.rot('chest', pitch=6)
        an.rot('head', pitch=-6)
        an.rot('armR', pitch=-18)
        an.rot('armL', pitch=-4 if t.pocket else -20)
        ears(an, t, back=-16, tip=-18)
        tail(an, t, up=-10)

    keys = [  # (frame, pose builder, height above the grounded pose)
        (0, lambda: legs_bent(an, 2, 4), 0.0),
        (7, lambda: crouch(1.0), 0.0),
        (10, launch, 0.035),
        (16, tuck, None),            # apex: parabola below
        (21, launch, 0.035),
        (23, land, 0.0),
        (30, lambda: legs_bent(an, 2, 4), 0.0),
    ]
    snaps = []
    for fr, build, lift in keys:
        an.rest()
        build()
        an.ground(lift=lift or 0.0)
        snaps.append((fr, an.snapshot()))
    takeoff, landing, apex_h = 10, 21, 0.13
    lift0 = (an.rest_rot['hips'] @ snaps[2][1]['hips'][1]).z   # hips height in the take-off pose
    for f in an.frames():
        i = max(k for k in range(len(snaps)) if snaps[k][0] <= f)
        j = min(i + 1, len(snaps) - 1)
        fa, a = snaps[i]
        fb, b = snaps[j]
        u = 0.0 if fb == fa else (f - fa) / (fb - fa)
        an.blend(a, b, ease(u))
        if takeoff <= f <= landing:          # ballistic hips height between take-off and touch-down
            s = (f - takeoff) / (landing - takeoff)
            base = lift0 + 4 * apex_h * s * (1 - s)
            pb = an.rig.pose.bones['hips']
            cur = (an.rest_rot['hips'] @ pb.location).z
            an.move('hips', z=base - cur)
        an.key(f)


def legs_bent(an, thigh, knee, toes=0.0):
    """Both legs bent symmetrically (thigh forward, knee back), feet level (+ toes down)."""
    for leg in 'LR':
        an.rot('thigh' + leg, pitch=-thigh)
        an.rot('shin' + leg, pitch=knee)
        an.rot('foot' + leg, pitch=thigh - knee + toes)


def racket_up(an, arm, fore, racket, twist=0.0, normal=None):
    """Right arm aimed along absolute directions, racket pointing along `racket` with
    the strings facing `normal` (its part square to the shaft), so every character
    holds it the same way whatever its modelled grip. The normals below were read
    off the bunny's clips (the back of its fist), which they leave unchanged."""
    an.aim('armR', arm)
    an.aim('forearmR', fore)
    an.aim('handR', racket, ref='sockHandR', twist=twist, normal=normal)


def two_hands(an, along=0.065):
    """Left hand on the racket's throat, just above the right fist."""
    from mathutils import Vector
    grip = an.point('sockHandR', at_tail=False)
    shaft = (an.point('sockHandR') - grip).normalized()
    target = grip + shaft * along + Vector((0.012, 0.01, 0.0))
    an.reach('armL', 'forearmL', target - shaft * 0.03, pole=(0.6, 0.5, -0.6))
    an.aim('handL', shaft * 0.3 + Vector((-0.1, -0.2, -0.1)))


def stance(an, t, bounce=0.0, width=9.0, bend=24.0, legs=True):
    """Athletic ready position: feet apart, knees bent, weight forward, racket up in
    front held in both hands, eyes on the ball."""
    for leg, sgn in (('L', 1), ('R', -1)) if legs else ():
        an.rot('thigh' + leg, pitch=-(bend + 3 * bounce), side=-sgn * width)
        an.rot('shin' + leg, pitch=1.6 * bend + 5 * bounce)
        an.rot('foot' + leg, pitch=(bend + 3 * bounce) - (1.6 * bend + 5 * bounce), side=sgn * width)
    an.rot('hips', pitch=7)
    an.rot('spine', pitch=6)
    an.rot('chest', pitch=4)
    an.rot('head', pitch=-15)
    racket_up(an, arm=(-0.3, -0.45, -0.84), fore=(0.25, -0.95, 0.12), racket=(0.2, -0.85, 0.48), normal=(-0.97, -0.22, -0.12))
    two_hands(an)


def ready(an, t, n=36):
    an.begin('ready', n)
    for f in an.frames():
        p = f / n
        an.rest()
        stance(an, t, bounce=S(2 * p))        # a light bounce on the toes, twice a second
        an.rot('chest', yaw=2 * S(p))
        an.rot('head', yaw=-2 * S(p), side=1.5 * S(p + 0.25))
        ears(an, t, back=3 + 2 * S(2 * p - 0.2), out=2 * S(p), tip=3 * S(2 * p - 0.35))
        tail(an, t, wag=8 * S(2 * p), up=6)
        an.ground(lift=0.004 * max(0.0, S(2 * p)))
        an.key(f)


STRAFE_STEP = 0.2   # model units per strafe loop (0.5 s); measured ~0.44 units/s = strafeSpeed in js/character.js


def strafe(an, t, d, n=15):
    """Side shuffle in the ready position, toward the character's left (d = 'L', +X)
    or right; the upper body stays square to the net. Each foot is planted for half
    the loop and slides under the body by STRAFE_STEP / 2 at constant speed, so when
    the game moves the character STRAFE_STEP per loop the planted foot stays put. The
    other foot swings across, just off the ground."""
    an.begin('strafe' + d, n)
    sgn = 1 if d == 'L' else -1          # +1: moving toward the character's left (+X)
    an.rest()                             # the foot is kept level, so a thigh angle moves it
    stance(an, t)                         # sideways by the hip-to-ankle height (stance pose)
    leg = an.point('thighL', at_tail=False).z - an.point('shinL').z
    for f in an.frames():
        p = f / n
        an.rest()
        stance(an, t, legs=False)
        for lg in 'LR':
            ph = p if lg == d else (p + 0.5) % 1.0   # lead foot swings first, trail foot second
            if ph < 0.5:                  # swinging toward the travel direction, lifted
                u = ph / 0.5
                off, lift = -1 + 2 * ease(u), math.sin(math.pi * u)
            else:                         # planted: the body passes over it at a steady speed
                off, lift = 1 - 2 * (ph - 0.5) / 0.5, 0.0
            dx = sgn * off * STRAFE_STEP / 4
            side = -(1 if lg == 'L' else -1) * 8 - math.degrees(math.asin(max(-0.9, min(0.9, dx / leg))))
            th, kn = -(22 + 26 * lift), 35 + 56 * lift
            an.rot('thigh' + lg, pitch=th, side=side)
            an.rot('shin' + lg, pitch=kn)
            an.rot('foot' + lg, pitch=-(th + kn), side=-side)
        step = S(p)
        an.rot('chest', side=-sgn * 2 * step, yaw=-sgn * 2 * step)
        ears(an, t, back=6 + 3 * C(2 * p), out=sgn * 4 * step, tip=6 * C(2 * p - 0.25))
        tail(an, t, wag=-sgn * 10 * step, up=6)
        an.ground()
        an.key(f)


def defeat(an, t, n=60):
    an.begin('defeat', n)
    for f in an.frames():
        p = f / n
        sigh = S(p)
        an.rest()
        legs_bent(an, 6, 10)
        an.rot('hips', pitch=4)
        an.rot('spine', pitch=8 + 2 * sigh)
        an.rot('chest', pitch=8 + 3 * sigh)
        an.rot('head', pitch=12 + 3 * sigh, yaw=7 * S(0.5 * p) * pulse(p, 0.5, 0.45))   # slow head shake
        # the racket hangs from a limp arm, its head dragging on the court
        racket_up(an, arm=(-0.25, -0.12, -0.96), fore=(-0.1, -0.35, -0.93), racket=(-0.15, -0.55, -0.82), normal=(-0.95, 0.29, 0.06))
        an.aim('armL', (0.22, -0.05, -0.97))
        an.aim('forearmL', (0.1, -0.25, -0.96))
        if t.ears == 'up':   # long ears fold back and out, deflated
            ears(an, t, back=40, out=14, tip=26 + 4 * sigh)
        else:
            ears(an, t, back=-6, out=-6, tip=-18 - 4 * sigh)
        tail(an, t, wag=4 * S(p), up=-16)
        an.ground()
        an.key(f)


def serve(an, t, n=21):
    """Overhead serve, upper body. Frame 0 (held while the ball is up): the trophy
    pose, left arm pointing at the tossed ball, racket cocked behind the head."""
    an.begin('serve', n, loop=False)

    def trophy():
        stance(an, t, width=7, bend=18)
        an.rot('spine', pitch=-8, yaw=-12)
        an.rot('chest', pitch=-6, yaw=-22)
        an.rot('head', pitch=-30, yaw=16)
        racket_up(an, arm=(-0.9, 0.25, 0.35), fore=(-0.2, 0.25, 0.95), racket=(-0.05, 0.55, 0.83), normal=(0.17, 0.79, -0.59))
        an.aim('armL', (0.7, -0.25, 0.67))      # up and out, so the short arm clears the head
        an.aim('forearmL', (0.45, -0.2, 0.87))

    def drop():
        stance(an, t, width=7, bend=22)
        an.rot('spine', pitch=-10, yaw=-6)
        an.rot('chest', pitch=-8, yaw=-10)
        an.rot('head', pitch=-32, yaw=8)
        racket_up(an, arm=(-0.75, 0.15, 0.62), fore=(0.05, 0.55, 0.83), racket=(0.1, 0.45, -0.88), normal=(-0.81, -0.51, -0.28))
        an.aim('armL', (0.55, -0.6, 0.35))
        an.aim('forearmL', (0.35, -0.85, 0.2))

    def contact():
        stance(an, t, width=7, bend=10)
        an.rot('spine', pitch=-4, yaw=6)
        an.rot('chest', pitch=-2, yaw=10)
        an.rot('head', pitch=-28)
        racket_up(an, arm=(-0.28, -0.32, 0.9), fore=(-0.15, -0.42, 0.9), racket=(-0.1, -0.55, 0.83), normal=(-0.64, 0.70, 0.31))
        an.aim('armL', (0.45, -0.6, -0.65))
        an.aim('forearmL', (-0.2, -0.95, 0.2))

    def follow():
        stance(an, t, width=8, bend=20)
        an.rot('spine', pitch=14, yaw=16)
        an.rot('chest', pitch=10, yaw=24)
        an.rot('head', pitch=-12, yaw=-10)
        racket_up(an, arm=(0.35, -0.75, -0.55), fore=(0.65, -0.35, -0.67), racket=(0.45, 0.25, -0.86), normal=(-0.20, -0.93, -0.30))
        an.aim('armL', (0.6, 0.1, -0.8))
        an.aim('forearmL', (0.2, -0.9, -0.4))

    poses = [(0, trophy), (5, drop), (9, contact), (15, follow), (21, lambda: stance(an, t))]
    snaps = []
    for fr, build in poses:
        an.rest()
        build()
        ears(an, t, back=10 if fr in (9, 15) else 2, tip=8 if fr == 9 else 0)
        an.ground()
        snaps.append((fr, an.snapshot()))
    for f in an.frames():
        i = max(k for k in range(len(snaps)) if snaps[k][0] <= f)
        j = min(i + 1, len(snaps) - 1)
        fa, a = snaps[i]
        fb, b = snaps[j]
        u = 0.0 if fb == fa else (f - fa) / (fb - fa)
        an.blend(a, b, ease(u))
        an.key(f)


def victory(an, t, n=48):
    an.begin('victory', n)
    for f in an.frames():
        p = f / n
        hop = max(0.0, S(2 * p)) ** 0.8                     # two hops per loop
        down = max(0.0, -S(2 * p))                          # landing squash
        an.rest()
        an.rot('spine', pitch=-6, side=3 * S(p))
        if t.pocket:
            an.rot('chest', yaw=5 * S(p))                    # hand stays in the pocket: shoulder shimmy
            an.rot('armL', pitch=3 * S(2 * p))
        pump = S(2 * p + 0.1)                                # racket pumps with the hops
        racket_up(an, arm=(-0.58, 0.02 - 0.08 * pump, 0.8), fore=(-0.42, -0.05 - 0.2 * pump, 0.9),
                  racket=(-0.42, 0.2 - 0.25 * pump, 0.9), normal=(0.25, 0.96, -0.1))
        if not t.pocket:
            an.aim('armL', (0.42, -0.08 - 0.1 * pump, 0.9))
            an.aim('forearmL', (0.15, -0.25 - 0.2 * pump, 0.95))
        an.rot('head', pitch=-14 + 4 * S(2 * p + 0.25), side=6 * S(p))
        ears(an, t, back=8 * S(2 * p - 0.1), out=6 + 4 * S(2 * p), tip=10 * S(2 * p - 0.25))
        tail(an, t, wag=24 * S(4 * p), up=14)
        legs_bent(an, 10 + 20 * down + 14 * hop, 18 + 40 * down + 26 * hop, toes=10 * hop)
        an.ground(lift=0.07 * hop)
        an.key(f)


def swing(an, t, n=15):
    """Forehand. Frame 0 = racket back (the game holds it as the ready pose)."""
    an.begin('swing', n, loop=False)

    def back():
        an.rot('spine', yaw=-18)
        an.rot('chest', yaw=-26, pitch=4)
        an.rot('head', yaw=34)
        racket_up(an, arm=(-0.55, 0.6, -0.35), fore=(-0.4, 0.8, 0.1), racket=(-0.3, 0.5, 0.8), normal=(0.96, 0.02, 0.27))
        if t.pocket:
            an.rot('armL', pitch=-6)
        else:   # the free hand points at the coming ball
            an.aim('armL', (0.35, -0.9, 0.1))
            an.aim('forearmL', (0.2, -0.95, 0.15))
        legs_bent(an, 8, 14)

    def contact():
        an.rot('spine', yaw=2)
        an.rot('chest', yaw=4, pitch=6)
        an.rot('head', yaw=-4)
        racket_up(an, arm=(-0.85, -0.25, -0.45), fore=(-0.6, -0.75, -0.2), racket=(-0.8, -0.5, 0.3), normal=(-0.43, 0.89, 0.13))
        if t.pocket:
            an.rot('armL', pitch=0)
        else:
            an.aim('armL', (0.7, 0.15, -0.7))
            an.aim('forearmL', (0.3, -0.9, -0.3))
        legs_bent(an, 10, 16)

    def follow():
        an.rot('spine', yaw=18)
        an.rot('chest', yaw=28, pitch=2)
        an.rot('head', yaw=-26)
        # finish beside the left shoulder, racket head back and out: clear of the big head
        racket_up(an, arm=(0.45, -0.75, 0.1), fore=(0.85, 0.1, 0.05), racket=(0.6, 0.6, 0.3), normal=(0.01, -0.53, 0.85))
        if t.pocket:
            an.rot('armL', pitch=4)
        else:
            an.aim('armL', (0.55, 0.3, -0.78))
            an.aim('forearmL', (-0.3, -0.85, 0.4))
        legs_bent(an, 6, 10)

    def recover():   # racket comes back low across the body, never past the face
        an.rot('spine', yaw=8)
        an.rot('chest', yaw=12, pitch=4)
        an.rot('head', yaw=-10)
        racket_up(an, arm=(0.15, -0.55, -0.82), fore=(0.35, -0.9, -0.2), racket=(0.25, -0.75, -0.6), normal=(-0.79, 0.26, -0.55))
        if t.pocket:
            an.rot('armL', pitch=2)
        else:
            an.aim('armL', (0.3, -0.3, -0.9))
            an.aim('forearmL', (-0.1, -0.95, -0.25))
        legs_bent(an, 12, 20)

    poses = [(0, back), (4, contact), (9, follow), (12, recover), (15, lambda: stance(an, t))]
    snaps = []
    for fr, build in poses:
        an.rest()
        build()
        ears(an, t, back=6 if fr in (4, 9) else 0, tip=10 if fr == 9 else 0)
        an.ground()
        snaps.append((fr, an.snapshot()))
    for f in an.frames():
        i = max(k for k in range(len(snaps)) if snaps[k][0] <= f)
        j = min(i + 1, len(snaps) - 1)
        fa, a = snaps[i]
        fb, b = snaps[j]
        u = 0.0 if fb == fa else (f - fa) / (fb - fa)
        an.blend(a, b, ease(u) if i > 0 else u)   # whip through contact without easing in
        an.key(f)


ALL = (idle, ready, walk, run, lambda an, t: strafe(an, t, 'L'), lambda an, t: strafe(an, t, 'R'),
       jump, victory, defeat, swing, serve)


def make_all(an, traits):
    for clip in ALL:
        clip(an, traits)
    an.rig.animation_data.action = None
    an.rest()
    return an.actions

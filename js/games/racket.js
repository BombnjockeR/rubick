// Shared engine for racket sports (Tennis, Table Tennis): swing your phone.
//
// Flow: waiting room (60s, up to 4 seats, vote to start) -> match -> back to room.
// Seats alternate sides (1 and 3 near, 2 and 4 far). Humans take seats in join
// order; an empty seat gets an AI unless the host closes it (the [x] on the room
// card, or keys 1-4), so any 1v1, 2v2 or 2v1 lineup works. By default 1-2 players
// get singles and 3-4 doubles. AI takes over for anyone who leaves mid-match.
// "Start now" (button or F) starts at once; with nobody joined it's an AI-only
// demo that repeats until someone joins (F goes back to the waiting room).
//
// Your character runs to the ball by itself (like Wii/Switch Sports), no faster
// than cfg.crossTime allows (seconds from sideline to sideline), so a ball placed
// away from a player who is late getting back is a winner. You time the swing:
// WHEN you swing aims the ball (early = to your left, late = to your right and
// short, way off = out or into the net), HOW HARD sets the speed and depth, the
// direction the phone moves pulls the ball that way and lifts it (lob) or drives
// it flat, and running into the ball carries it along. A ball above your head is
// smashed. Tilting the phone forward or back (or the stick) moves your spot closer
// to the net or deeper.
//
// The racket only meets the ball where the ball is: a swing in time is held until
// the ball reaches the racket (the clip is timed so its contact frame lands then).
// A ball the run can't quite reach is taken with a lunge, one further out with a
// full-length dive (a weak pop-up back, and you lie on the court for a moment);
// beyond that the swing misses.
//
// World units are meters (three.js, Y up). The court's long axis is Z with the
// net at z = 0; side 0 plays from -Z, side 1 from +Z. The ball flies in meters
// under gravity, drag and spin (see "Ball flight"); positions the players aim for
// use normalized coords: nx -1..1 along the court (contact line to contact line),
// ny -1..1 across the playing width. Players' spots (py across, px deep) are where
// their racket meets the ball; the body stands off to the side of it.
window.MabarRacket = {
  define(cfg) {
    MabarGames.register({
      id: cfg.id,
      name: cfg.name,
      blurb: cfg.blurb,
      controls: 'motion',
      create: (hub) => createRacketGame(hub, cfg),
    });
  },
};

function createRacketGame(hub, cfg) {
  const B = hub.B;

  // ---------- Rules / tuning ----------
  const ROOM_TIME = 60;
  const SEATS = 4;
  const EARLY_LIMIT = 0.30;  // swing earlier than this (s before the ball reaches the racket) = whiff
  const LATE_LIMIT = -0.1;   // the ball is past the racket after this = too late
  const IDEAL = 0.08;        // perfect timing (a touch early covers the phone's lag)
  const SPAN = 0.24;         // timing distance that maps to full left/right aim
  const SWING = 0.3;         // swing animation length (s), and the least time between two swings
  const G = 9.8;

  const C = cfg.court;       // { line, halfW, halfWDoubles, surface, onSurface(x,z), landMax, net }
  const A = cfg.arc;         // { contact, over }: default forehand and overhead strike heights above the playing surface (m)
  const DEEPEST = cfg.deepest || 1.25;   // how far behind the contact line (nx) a player takes a ball
  const K = cfg.characterScale || 1.8;   // animal size: the racket offsets from the clips scale with it
  const STEP = cfg.step || 0.35;         // the last stretch (m) a swing closes faster than a run
  const DIVE = cfg.dive || 0;            // how far (m) a dive flies; 0 = no diving in this game
  const CPU_COLORS = ['#ced4da', '#adb5bd'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let clock = 0;             // seconds of play: swing cooldowns, time on the ground

  // ---------- State ----------
  let phase = 'room';        // room | intro | serve | rally | point | over
  let phaseT = 0;
  let roomT = ROOM_TIME;
  const votes = new Set();
  let sides = [newSide(), newSide()];
  let ball = null;
  let cpuPlan = null;
  let rally = 0;
  let result = null;
  let banner = null;
  let doubles = false;
  let demo = false;          // AI-only match (started with nobody seated); repeats
  const seatSet = [null, null, null, null]; // host's choice per seat: 'open' | 'closed' | null = default
  let roomHits = [];         // clickable areas on the room card: { x, y, w, h, act }
  const popups = [];

  function newSide() { return { score: 0, games: 0, members: [] }; }
  const lineN = (s) => (s === 0 ? -1 : 1);
  const leftSign = (s) => (s === 0 ? 1 : -1); // a player's left, in ny, seen from their end (facing the net)
  const halfW = () => (doubles && C.halfWDoubles ? C.halfWDoubles : C.halfW);
  const toZ = (nx) => nx * C.line;
  const toX = (ny) => ny * halfW();

  function memberOf(p) {
    for (let s = 0; s < 2; s++) {
      const m = sides[s].members.find((mm) => !mm.cpu && mm.id === p.id);
      if (m) return { s, m };
    }
    return null;
  }
  const humanSides = () => [0, 1].filter((s) => sides[s].members.some((m) => !m.cpu));
  const teamName = (s) => sides[s].members.map((m) => m.name).join(' & ') || '—';
  const inMatch = () => ['intro', 'serve', 'rally', 'point'].includes(phase);

  function receiverOf(s, arrivalY) {
    const ms = sides[s].members;
    if (ms.length <= 1) return ms[0];
    return ms.find((m) => m.lane === (arrivalY * leftSign(s) < 0 ? -1 : 1)) || ms[0];
  }

  // ---------- Scoring ----------
  const TENNIS = cfg.scoring === 'tennis';
  const CALL = ['0', '15', '30', '40'];

  function serverInfo() {
    if (TENNIS) {
      const g = sides[0].games + sides[1].games;  // one server per game
      const s = g % 2;
      const ms = sides[s].members;
      return { s, m: ms[Math.floor(g / 2) % Math.max(1, ms.length)] };
    }
    const total = sides[0].score + sides[1].score;
    const s = Math.floor(total / 2) % 2;            // serve swaps every 2 points
    const ms = sides[s].members;
    return { s, m: ms[Math.floor(total / 4) % Math.max(1, ms.length)] };
  }

  function tennisCall() {
    const [a, b] = [sides[0].score, sides[1].score];
    if (a >= 3 && b >= 3) {
      if (a === b) return 'Deuce';
      return `Advantage ${teamName(a > b ? 0 : 1)}`;
    }
    const sv = serverInfo().s;
    const mine = sv === 0 ? a : b, theirs = sv === 0 ? b : a;
    if (mine === theirs && mine > 0) return `${CALL[mine]}–all`;
    return `${CALL[Math.min(3, mine)]}–${CALL[Math.min(3, theirs)]}`;
  }

  function pointLabel(s) {
    if (!TENNIS) return String(sides[s].score);
    const a = sides[s].score, b = sides[1 - s].score;
    if (a >= 3 && b >= 3) return a > b ? 'AD' : '40';
    return CALL[Math.min(3, a)];
  }

  // returns winner side if the match is over, else -1
  function award(w, reason) {
    const sd = sides[w], other = sides[1 - w];
    sd.score++;
    let text = reason, matchOver = -1;
    if (TENNIS) {
      if (sd.score >= 4 && sd.score - other.score >= 2) {
        sd.games++;
        sd.score = 0;
        other.score = 0;
        text = `Game ${teamName(w)}!`;
        if (sd.games >= cfg.games) matchOver = w;
      } else {
        text = `${reason}  ·  ${tennisCall()}`;
      }
    } else if (sd.score >= cfg.points) {
      matchOver = w;
    }
    return { text, matchOver };
  }

  // ---------- Room & match flow ----------
  function toRoom() {
    phase = 'room';
    demo = false;
    roomT = ROOM_TIME;
    votes.clear();
    sides = [newSide(), newSide()];
    ball = null;
    cpuPlan = null;
    result = null;
    clearMembers3D();
    hub.showLobby(false); // the QR is in the room card; the side panel stays tucked away
    hub.refreshRoster();
  }

  // hit: the stroke under way ({ at: ball time of contact, clip, R: where the body must
  // be, ok, ... }); anim: a clip for the 3D side to start; down: clock time until which
  // a diver stays down; reach: racket-head offsets measured from the clips (3D).
  function makeMember(p, s, i) {
    const m = p
      ? { id: p.id, cpu: false, name: p.name, color: p.color, slot: p.slot }
      : { id: `cpu${s}${i}`, cpu: true, name: 'CPU', color: CPU_COLORS[i % 2], slot: null };
    return Object.assign(m, { animal: null, lane: 0, py: 0, px: 1, bias: 0, vl: 0, swingT: 0, side: s, vx: 0, run: 0,
      hit: null, anim: null, down: 0, slide: null, leap: null, swingReady: 0, reach: null, chibi: false });
  }

  // Which animal a phone plays as: by its seat slot, so it keeps the same one across
  // games (js/character.js defs, in cfg.characters order). AI seats take the animals
  // nobody in the match has, so no two players look alike.
  const pool = cfg.characters || [];
  const slotAnimal = (slot) => (pool.length ? pool[slot % pool.length] : null);
  function assignAnimals() {
    const all = [...sides[0].members, ...sides[1].members];
    const used = new Set();
    for (const m of all) if (!m.cpu) { m.animal = slotAnimal(m.slot); used.add(m.animal); }
    const free = pool.filter((id) => !used.has(id));
    let i = 0;
    for (const m of all) if (m.cpu) { m.animal = free.length ? free[i % free.length] : slotAnimal(i); i++; }
  }

  // Seat i plays for side i % 2. Each entry: { human } | { ai: true } | null (closed).
  function lineup() {
    const humans = [...hub.players.values()].sort((a, b) => a.slot - b.slot).slice(0, SEATS);
    return [0, 1, 2, 3].map((i) => {
      if (humans[i]) return { human: humans[i] };
      const byDefault = i < 2 || humans.length >= 3 ? 'open' : 'closed';
      return (seatSet[i] || byDefault) === 'open' ? { ai: true } : null;
    });
  }
  const sideCount = (L, s) => (L[s] ? 1 : 0) + (L[s + 2] ? 1 : 0);

  function toggleSeat(i) {
    if (phase !== 'room') return;
    const L = lineup();
    if (L[i] && L[i].human) return;
    const before = seatSet[i];
    seatSet[i] = L[i] ? 'closed' : 'open';
    const L2 = lineup();
    if (!sideCount(L2, 0) || !sideCount(L2, 1)) {
      seatSet[i] = before;
      popup('Each side needs at least one player', null, '#ffd43b', 1.4, 0.7);
    }
    hub.refreshRoster();
  }

  function startMatch() {
    const L = lineup();
    demo = !L.some((x) => x && x.human);
    sides = [newSide(), newSide()];
    L.forEach((x, i) => {
      if (!x) return;
      const s = i % 2;
      sides[s].members.push(makeMember(x.human || null, s, sides[s].members.length));
    });
    doubles = sides.some((sd) => sd.members.length > 1);
    assignAnimals();
    for (const sd of sides) {
      if (sd.members.length === 2) { sd.members[0].lane = -1; sd.members[1].lane = 1; }
    }
    sides.forEach((sd, s) => sd.members.forEach((m) => { m.py = m.lane * 0.5 * leftSign(s); }));
    let n = 0;
    for (const sd of sides) for (const m of sd.members) if (m.cpu) m.name = `CPU${doubles ? ' ' + (++n) : ''}`;

    votes.clear();
    rally = 0;
    phase = 'intro';
    phaseT = 2.6;
    banner = { text: `${teamName(0)}  vs  ${teamName(1)}`, sub: `${formatName(sides[0].members.length, sides[1].members.length)} · ${demo ? 'AI demo' : cfg.matchLabel}`, t: 0, life: 2.6 };
    buildMembers3D();
    hub.showLobby(false);
    for (const p of hub.players.values()) hub.rumble(p, 40);
    hub.refreshRoster();
  }

  function formatName(a, b) {
    if (a === 1 && b === 1) return 'Singles';
    if (a === 2 && b === 2) return 'Doubles';
    return `${a} vs ${b}`;
  }

  function startServe() {
    phase = 'serve';
    phaseT = 0;
    ball = null;
    cpuPlan = null;
    pendingServe = null;
    rally = 0;
    for (const sd of sides) for (const m of sd.members) m.hit = null;
    trailReset();
  }

  function point(winner, reason) {
    const { text, matchOver } = award(winner, reason);
    phase = 'point';
    phaseT = 1.7;
    celebrate(winner, 'jump');
    if (fx) fx.cheer(matchOver >= 0 ? 2 : 1);
    popup(text, null, '#ffffff', 1.7, 1.25);
    for (const m of sides[winner].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 60);
    for (const m of sides[1 - winner].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 160);
    if (matchOver >= 0) {
      result = {
        w: matchOver,
        text: `${teamName(matchOver)} win${sides[matchOver].members.length > 1 ? '' : 's'}!`,
        sub: TENNIS ? `Games ${sides[matchOver].games}–${sides[1 - matchOver].games}` : `${sides[matchOver].score}–${sides[1 - matchOver].score}`,
        color: sides[matchOver].members[0].color,
      };
    }
    hub.refreshRoster();
  }

  function popup(text, side, color, life = 0.9, scale = 1) {
    popups.push({ text, side, color, t: 0, life, scale });
  }

  // ---------- Ball flight ----------
  // A shot is a chain of free flights in meters (x across, z along the court, h = the
  // ball's centre above the playing surface; t0 = when it starts) under gravity and a
  // light linear air drag, so the ball slows down and comes down steeper than it went
  // up. Spin pulls the first flight down harder (topspin, g > 9.8) or holds it up
  // (backspin). A bounce keeps PH.rest of the vertical speed and PH.keep of the
  // horizontal (more with topspin, less with backspin). All of it is closed form, so
  // where the receiver will meet the ball and how high it crosses the net are known
  // the moment it is struck.
  const PH = Object.assign({
    drag: 0.25,                      // 1/s
    rest: 0.72,                      // vertical speed kept through a bounce
    keep: 0.72,                      // horizontal speed kept through a bounce
    topspin: 3,                      // m/s² of extra dip on a full-power drive
    lob: [5.5, 8],                   // top of a lob (m above the surface): a soft lift .. a big one
    pop: 3,                          // top of a diving player's pop-up
    clear: 0.45,                     // how far over the net tape an unhurried shot passes (m)
    smash: 1.5,                      // a smash is this much faster than a drive
  }, cfg.ball);
  const RB = cfg.ballR;              // the ball's centre is this high when it touches down

  function fly(sg, t) {
    const k = sg.k, g = sg.g;
    if (k < 1e-6) return { x: sg.x + sg.vx * t, z: sg.z + sg.vz * t, h: sg.h + sg.vh * t - 0.5 * g * t * t, vx: sg.vx, vz: sg.vz, vh: sg.vh - g * t };
    const e = Math.exp(-k * t), f = (1 - e) / k, gk = g / k;
    return { x: sg.x + sg.vx * f, z: sg.z + sg.vz * f, h: sg.h + (sg.vh + gk) * f - gk * t, vx: sg.vx * e, vz: sg.vz * e, vh: (sg.vh + gk) * e - gk };
  }
  const apexT = (sg) => (sg.vh <= 0 || !sg.g ? 0 : sg.k < 1e-6 ? sg.vh / sg.g : Math.log(1 + sg.k * sg.vh / sg.g) / sg.k);
  const apexH = (sg) => fly(sg, apexT(sg)).h;

  // When the flight passes height h on the way down (not before `from`), or null.
  function down(sg, h, from = 0) {
    let a = Math.max(from, apexT(sg));
    if (!sg.g || fly(sg, a).h < h) return null;
    let b = a + 0.25;
    for (let i = 0; i < 12 && fly(sg, b).h >= h; i++) b += b - a;
    for (let i = 0; i < 36; i++) { const c = (a + b) / 2; if (fly(sg, c).h >= h) a = c; else b = c; }
    return (a + b) / 2;
  }
  // When it passes height h on the way up, or null.
  function up(sg, h) {
    const ta = apexT(sg);
    if (sg.h >= h || fly(sg, ta).h < h) return null;
    let a = 0, b = ta;
    for (let i = 0; i < 36; i++) { const c = (a + b) / 2; if (fly(sg, c).h < h) a = c; else b = c; }
    return (a + b) / 2;
  }

  // Where a flight comes down: on the playing surface, or past a table's edge, the floor.
  function landing(sg) {
    if (sg.floor) { const t = down(sg, RB - C.surface, 1e-4); return t == null ? null : { t, floor: true }; }
    const t = down(sg, RB, 1e-4);
    if (t == null) return null;
    const p = fly(sg, t);
    if (!C.surface || C.onSurface(p.x, p.z)) return { t, floor: false };
    const tf = down(sg, RB - C.surface, t);
    return tf == null ? null : { t: tf, floor: true };
  }

  function bounce(sg, t, floor, spin) {
    const s = fly(sg, t);
    const kv = floor ? 0.5 : PH.rest + (spin > 0 ? 0.04 : spin < 0 ? -0.1 : 0);
    const kh = floor ? 0.6 : PH.keep + (spin > 0 ? 0.08 : spin < 0 ? -0.12 : 0);
    return { t0: sg.t0 + t, x: s.x, z: s.z, h: RB - (floor ? C.surface : 0), vx: s.vx * kh, vz: s.vz * kh, vh: -s.vh * kv, g: G, k: PH.drag, floor };
  }

  // When a flight reaches the venue's walls (C.walls: the stands' rails, |x| and |z| in
  // meters) before `end`, or null.
  function wall(sg, end) {
    const W = C.walls;
    if (!W) return null;
    let hit = null;
    for (const [axis, p, v, lim] of [['x', sg.x, sg.vx, W.x], ['z', sg.z, sg.vz, W.z]]) {
      if (!lim || Math.abs(p) >= lim || Math.abs(v) < 1e-6) continue;
      const f = (Math.sign(v) * lim - p) / v;
      if (sg.k > 1e-6 && sg.k * f >= 1) continue;
      const t = sg.k < 1e-6 ? f : -Math.log(1 - sg.k * f) / sg.k;
      if (t < end && (!hit || t < hit.t)) hit = { t, axis };
    }
    return hit;
  }

  // The flight, its bounces, and a roll once the hops die down; a ball that reaches
  // the stands drops off their rail.
  function chain(first, spin) {
    const segs = [first];
    for (let sg = first, i = 0; i < 9; i++) {
      const L = landing(sg);
      const w = wall(sg, L ? L.t : 6);
      if (w) {
        sg.dur = w.t;
        const p = fly(sg, w.t);
        const nx = { t0: sg.t0 + w.t, x: p.x, z: p.z, h: p.h, vx: p.vx * (w.axis === 'x' ? -0.25 : 0.4), vz: p.vz * (w.axis === 'z' ? -0.25 : 0.4), vh: Math.min(0, p.vh) * 0.5, g: G, k: PH.drag, floor: sg.floor };
        segs.push(nx);
        sg = nx;
        continue;
      }
      if (!L) break;
      sg.dur = L.t;
      const nx = bounce(sg, L.t, L.floor, i ? 0 : spin);
      segs.push(nx);
      if (nx.vh < 0.6) { Object.assign(nx, { vh: 0, g: 0, k: 3, roll: true }); break; }
      sg = nx;
    }
    return segs;
  }

  // The flight from `from` to `to` (both {x, z, h}) that takes T seconds under pull g.
  function flight(from, to, T, g) {
    const k = PH.drag, f = k < 1e-6 ? T : (1 - Math.exp(-k * T)) / k;
    const vh = k < 1e-6 ? (to.h - from.h + 0.5 * g * T * T) / T : (to.h - from.h + (g / k) * T) / f - g / k;
    return { t0: 0, x: from.x, z: from.z, h: from.h, vx: (to.x - from.x) / f, vz: (to.z - from.z) / f, vh, g, k };
  }

  // When and how high a flight crosses the net (z = 0), or null if it doesn't.
  function netCross(sg) {
    if (sg.z * sg.vz >= 0) return null;
    const f = -sg.z / sg.vz;
    if (sg.k > 1e-6 && sg.k * f >= 1) return null;
    const t = sg.k < 1e-6 ? f : -Math.log(1 - sg.k * f) / sg.k;
    return { t, h: fly(sg, t).h };
  }

  // The T between lo and hi where fn(T), rising with T, reaches `want`.
  function solveT(fn, want, lo, hi) {
    if (fn(lo) >= want) return lo;
    if (fn(hi) <= want) return hi;
    for (let i = 0; i < 40; i++) { const c = (lo + hi) / 2; if (fn(c) < want) lo = c; else hi = c; }
    return (lo + hi) / 2;
  }

  // Where the current ball is `t` seconds after it was struck (meters).
  function ballAt(t) {
    const segs = ball.segs;
    let i = segs.length - 1;
    while (i > 0 && segs[i].t0 > t) i--;
    return fly(segs[i], Math.max(0, t - segs[i].t0));
  }

  // ---------- Where the racket meets the ball ----------
  // Racket-head offset from the body at a clip's contact frame, in the character's own
  // axes (x = its left, y = up from the floor, z = ahead; meters): measured from the
  // animal's clips (m.reach, js/character.js reachOf), else rough defaults (the chibis,
  // or before the 3D has loaded).
  const CONTACT = (window.MabarChars && MabarChars.CONTACT) || { swing: 0.133, serve: 0.3, smash: 0.233, lungeL: 0.167, lungeR: 0.167, diveL: 0.167, diveR: 0.167 };
  function off(m, clip) {
    const r = m && m.reach && m.reach[clip];
    if (r) return { x: r[0] * K, y: r[1] * K, z: r[2] * K };
    const side = m && m.chibi ? 1 : -1;            // the chibis hold the racket in the other hand
    const y = C.surface + A.contact;
    if (clip === 'smash' || clip === 'serve') return { x: side * cfg.reach * 0.3, y: C.surface + (A.over || A.contact * 2), z: 0.2 };
    if (/^lunge/.test(clip)) return { x: (clip === 'lungeL' ? 1 : -1) * cfg.reach * 1.6, y: y * 0.8, z: cfg.standBack };
    if (/^dive/.test(clip)) return { x: (clip === 'diveL' ? 1 : -1) * cfg.reach * 1.5, y: y * 0.8, z: cfg.standBack };
    return { x: side * cfg.reach, y, z: cfg.standBack };
  }
  // ... in world axes for side s (side 1 faces the other way)
  function offW(m, s, clip) { const o = off(m, clip), k = s === 0 ? 1 : -1; return { x: o.x * k, y: o.y, z: o.z * k }; }
  const JUMP = 0.12 * K;                                   // a smash jumps this much higher than its clip's own hop
  const strikeH = (m) => off(m, 'swing').y - C.surface;   // forehand contact height above the playing surface
  const overH = (m) => off(m, 'smash').y - C.surface + (m && !m.chibi ? JUMP : 0);   // overhead contact height

  // A player's body position (meters) from their spot (where their forehand meets
  // the ball), and the spot that puts the body at r.
  function rootOf(m, s) {
    const o = offW(m, s, 'swing');
    return { x: toX(m.py) - o.x, z: lineN(s) * C.line * m.px - o.z };
  }
  function setRoot(m, s, r) {
    const o = offW(m, s, 'swing');
    m.py = (r.x + o.x) / halfW();
    m.px = (r.z + o.z) / (lineN(s) * C.line);
  }

  // Could this player's racket get to p (meters) in t seconds at a run?
  function reachable(m, s, p, t) {
    if (!m) return false;
    return Math.hypot(toX(m.py) - p.x, lineN(s) * C.line * m.px - p.z) <= speedLimit() * t * 0.9;
  }

  // Where the receiver meets the ball: overhead before the bounce (a lob they can get
  // under), else after the bounce at their forehand height on the way down; if that
  // would be too deep, overhead while it is still that high, or on the rise; the top of
  // a bounce that never gets that high. { t: ball time, x, y (normalized), h, kind:
  // 'over' | 'ground' | 'rise' | 'low' }
  function contactFor(b, m, s) {
    const hs = strikeH(m), ho = overH(m), dirN = lineN(s);
    const deep = (sg, t) => (fly(sg, t).z * dirN) / C.line;
    const at = (sg, t, kind) => { const p = fly(sg, t); return { t: sg.t0 + t, x: p.z / C.line, y: p.x / halfW(), h: p.h, kind }; };
    const [f0, s1] = b.segs;
    if (b.net || !s1) return at(f0, f0.dur || 0, 'ground');
    if (b.apex >= ho + 1.2) {
      const t = down(f0, ho);
      if (t != null && t < f0.dur && deep(f0, t) >= 0.3 && deep(f0, t) <= DEEPEST && reachable(m, s, fly(f0, t), t)) return at(f0, t, 'over');
    }
    if (s1.roll) return at(s1, 0, 'low');
    const ta = apexT(s1), top = fly(s1, ta).h;
    if (top <= hs) return at(s1, ta, 'low');
    const td = down(s1, hs);
    if (deep(s1, td) <= DEEPEST) return at(s1, td, 'ground');
    if (top >= ho) {
      const t2 = down(s1, ho);
      if (t2 != null && deep(s1, t2) <= DEEPEST) return at(s1, t2, 'over');
      const t3 = up(s1, ho);
      if (t3 != null) return at(s1, t3, 'over');
    }
    const tu = up(s1, hs);
    if (tu != null) return at(s1, tu, 'rise');
    // already above the forehand when it bounces (a racket held low, at a table): play it
    // at the top of the bounce, or where it passes the deepest a player goes if sooner
    const f = (DEEPEST * C.line * dirN - s1.z) / s1.vz;
    const tD = !(f > 0) ? ta : s1.k < 1e-6 ? f : s1.k * f < 1 ? -Math.log(1 - s1.k * f) / s1.k : ta;
    return at(s1, Math.min(ta, tD), 'rise');
  }

  // ---------- Shots ----------
  // Strike the ball from `from` (meters) to land `depth` (0..1) down the other half
  // (1 = the baseline / table end, past 1.02 = long) and `aimY` across (past ±1 =
  // wide). how: { speed: average m/s (a drive) | apex: how high it goes (a lob, a
  // pop-up), spin: extra pull (m/s²), clear: at least this far over the net tape (m),
  // low: exactly this far over it instead (a late hit; below 0 = into the net) }.
  function strike(s, m, from, aimY, depth, how) {
    const land = { x: toX(aimY), z: toZ(lineN(1 - s) * depth * (C.landMax || 1)), h: RB };
    const g = G + (how.spin || 0);
    const make = (T) => flight(from, land, T, g);
    const netH = (T) => { const c = netCross(make(T)); return c ? c.h : 99; };
    const tape = (C.net || 0) + RB;
    const D = Math.hypot(land.x - from.x, land.z - from.z);
    let T = how.apex ? solveT((T) => apexH(make(T)), how.apex, 0.15, 8) : Math.max(0.12, D / how.speed);
    if (how.low != null) T = solveT(netH, tape + how.low, 0.12, T);
    else if (netH(T) < tape + (how.clear || 0)) T = solveT(netH, tape + (how.clear || 0), T, 8);   // lifted over the net
    const sg = make(T);
    const c = netCross(sg);
    const net = !!c && c.h < tape;
    let segs;
    if (net) {   // caught by the net: drops back on the hitter's side
      sg.dur = c.t;
      const p = fly(sg, c.t);
      segs = [sg, ...chain({ t0: c.t, x: p.x, z: -Math.sign(sg.vz) * RB, h: p.h, vx: p.vx * 0.2, vz: -p.vz * 0.1, vh: Math.min(0, p.vh) * 0.3, g: G, k: PH.drag }, 0)];
    } else segs = chain(sg, how.spin || 0);
    const long = depth > 1.02, wide = Math.abs(aimY) > 1;
    ball = { segs, t: 0, hitter: s, color: m.color, kind: how.kind || '', power: how.power == null ? 0.5 : how.power,
      land: { x: land.z / C.line, y: aimY }, Tb: net ? c.t : sg.dur, out: long || wide, long, net, Tn: net ? c.t : 0,
      bounced: false, apex: apexH(sg), T: (2 * C.line * T) / Math.max(1, D) };
    ball.receiver = receiverOf(1 - s, aimY);
    ball.contact = contactFor(ball, ball.receiver, 1 - s);
    cpuPlan = null;
    for (const sd of sides) for (const mm of sd.members) mm.hit = null;
    if (ball.receiver && ball.receiver.cpu && !ball.out && !net) {
      const miss = 0.03 + Math.max(0, cfg.cpuHard - ball.T) * 0.5 + rally * 0.01;
      cpuPlan = {
        u: IDEAL + (Math.random() - 0.5) * 0.3, miss: Math.random() < miss, power: 0.35 + Math.random() * 0.5,
        dir: { x: (Math.random() - 0.5) * 1.4, y: Math.random() < 0.15 ? 0.7 : (Math.random() - 0.5) * 0.6 },   // now and then a lob
        done: false,
      };
    }
    trailReset();
  }

  // The serve: the server swings, the toss drops onto the strings, struck from there.
  let pendingServe = null;   // { at: clock time of contact, power, dir }
  function serveSpot(s, m) {   // where the server's racket meets the toss (meters)
    const r = rootOf(m, s), o = offW(m, s, 'serve');
    return { x: r.x + o.x, z: r.z + o.z, h: o.y - C.surface };
  }

  function serveSwing(s, m, power, dir) {
    if (pendingServe) return;
    const lead = 0.1;
    pendingServe = { at: clock + lead, power, dir };
    m.anim = { clip: 'serve', from: Math.max(0, CONTACT.serve - lead), contact: lead };
    m.swingT = SWING;
  }

  function serve(power, dir = { x: 0, y: 0 }) {
    const { s, m } = serverInfo();
    const from = serveSpot(s, m);
    const depth = clamp(0.35 + Math.random() * 0.3 + power * 0.1, 0.3, 0.75);
    const aimY = clamp((Math.random() - 0.5) * 1.3 - dir.x * 0.5, -0.85, 0.85);
    const pace = cfg.serveT - power * cfg.serveTP;   // seconds line to line
    strike(s, m, from, aimY, depth, { speed: (2 * C.line) / pace, spin: PH.topspin * 0.4, clear: 0.12, kind: 'serve', power });
    phase = 'rally';
    impact(from, m.color, 0.8);
    if (!m.cpu) hub.rumble(hub.players.get(m.id), 25);
  }

  // The return, struck where the racket met the ball. WHEN you swung aims it (early =
  // your left, late = your right, short and low: very late goes into the net), HOW
  // HARD sets the pace and depth, the phone's swing direction pulls it left or right
  // and lifts it into a high lob (up) or flattens it into a fast low drive (down), and
  // running into the ball carries it along. Taken overhead it is a smash, steep and
  // fast; from a dive it only pops back up, high, slow and short.
  function returnShot(s, m, h) {
    const { power, u, dir, clip } = h;
    const offset = clamp((u - IDEAL) / SPAN, -1, 1);                     // + early, − late
    const late = clamp((IDEAL - u) / (IDEAL - LATE_LIMIT), 0, 1);
    const leftward = offset * 0.85 - dir.x * 0.6 + clamp(m.vl / speedLimit(), -1, 1) * 0.3;   // + = the player's left
    let aimY = leftSign(s) * leftward * 1.15 + (Math.random() - 0.5) * 0.1;
    const pace = (cfg.shotT - power * cfg.shotTP) * Math.max(0.78, 1 - rally * 0.02);   // seconds line to line
    const speed = (2 * C.line) / pace;
    let depth, how, kind;
    if (clip === 'smash') {
      kind = 'smash';
      depth = 0.55 + 0.35 * power;
      how = { speed: speed * PH.smash, spin: PH.topspin * 0.5, clear: 0.06 };
    } else if (/^dive/.test(clip)) {
      kind = 'pop';
      aimY = aimY * 0.4 + (Math.random() - 0.5) * 0.5;
      depth = 0.38 + 0.3 * power;
      how = { apex: PH.pop, spin: -PH.topspin * 0.3, clear: 0.3 };
    } else if (dir.y > 0.45) {
      kind = 'lob';
      depth = 0.82 + 0.16 * power - 0.25 * late;
      how = { apex: PH.lob[0] + (PH.lob[1] - PH.lob[0]) * clamp((dir.y - 0.45) / 0.55 + power * 0.3, 0, 1), spin: PH.topspin * 0.3, clear: 0.5 };
    } else {
      kind = 'drive';
      const flat = dir.y < -0.3;     // swung through flat: faster and lower, less spin
      depth = 0.55 + 0.4 * power + 0.12 * Math.max(0, dir.y) - 0.35 * late;
      how = { speed: speed * (flat ? 1.12 : 1), spin: PH.topspin * (0.35 + 0.65 * power) * (flat ? 0.4 : 1), clear: PH.clear * (1.1 - 0.6 * power) * (flat ? 0.6 : 1) };
      if (/^lunge/.test(clip)) { aimY += (Math.random() - 0.5) * 0.3; how.speed *= 0.85; how.clear += 0.15; depth -= 0.08; }
    }
    if (late > 0.35 && kind !== 'pop') how.low = PH.clear * (1 - (1.6 * (late - 0.35)) / 0.65);   // late: low, then into the net
    rally++;
    strike(s, m, h.P, aimY, clamp(depth, 0.12, 1.2), { ...how, kind, power });
    impact(h.P, m.color, kind === 'smash' ? 1.6 : 1);
    if (!m.cpu) hub.rumble(hub.players.get(m.id), kind === 'smash' ? 80 : 35);
    if (kind === 'smash') { popup('SMASH!', s, m.color); if (fx) fx.cheer(0.6); }
    else if (kind === 'pop') popup('What a dive!', s, m.color, 0.9, 0.9);
    else if (kind === 'lob') popup('Lob', s, m.color, 0.7, 0.9);
    else if (Math.abs(offset) < 0.25 && late < 0.3) popup('Perfect', s, m.color, 0.7);
  }

  // Players run at most this fast (m/s): the court's width in cfg.crossTime seconds.
  const speedLimit = () => (2 * halfW()) / (cfg.crossTime || 1.6);

  // Remote players see the game as video (~0.15-0.2s behind) and their swing
  // takes half a ping to arrive; judge them on what they actually saw.
  function lagOf(m) {
    if (!m || m.cpu) return 0;
    const p = hub.players.get(m.id);
    if (!p || !p.remote) return 0;
    const oneWay = (p.rtt == null ? 120 : p.rtt) / 2000;
    return Math.max(0, Math.min(0.45, 0.18 + oneWay));
  }

  // The least time (s) each stroke needs to get its racket to the ball.
  const LEAD = { swing: 0.04, serve: 0.1, smash: 0.08, lungeL: 0.08, lungeR: 0.08, diveL: 0.12, diveR: 0.12 };

  // The ball time, not before t0 and close to `prefer`, when the ball is nearest the
  // heights lo..hi the racket can be at (the height counts more than a few hundredths
  // of a second).
  function meetTime(lo, hi, t0, prefer) {
    let best = Math.max(t0, prefer), cost = Infinity;
    for (let t = t0; t <= Math.max(t0, prefer + 0.15); t += 0.005) {
      const h = ballAt(t).h;
      const c = Math.max(0, lo - h, h - hi) + Math.abs(t - prefer);
      if (c < cost) { cost = c; best = t; }
    }
    return best;
  }
  // How far a diver's flight can be raised or lowered to meet the ball (m)
  const LEAP = [-0.09 * K, 0.25 * K];

  // How high a diver's body is lifted off its clip (m) at clock time t: a dive at a
  // ball above its racket leaps higher (or skims lower under a low one), most at
  // contact, back to the clip's own flight by the landing.
  function leapY(m, t) {
    const L = m.leap;
    if (!L || t <= L.t0 || t >= L.tl) return 0;
    return t <= L.tc ? L.h * Math.sin((Math.PI / 2) * (t - L.t0) / Math.max(1e-3, L.tc - L.t0))
      : L.h * Math.cos((Math.PI / 2) * (t - L.tc) / Math.max(1e-3, L.tl - L.tc));
  }

  // A swing in time: how the player gets the racket to the ball (a plain stroke; a
  // lunge for a ball a step too far; a dive, launched so it flies onto the ball, for
  // one further out; an overhead for a high ball), struck when the ball arrives. A
  // swing that comes late takes the ball a little further on.
  function planHit(s, m, power, u, dir) {
    const now = ball.t, r0 = rootOf(m, s), vmax = speedLimit();
    const choose = (at) => {
      const P = ballAt(at), left = at - now, run = vmax * left;
      const need = (clip) => {
        const o = offW(m, s, clip), R = { x: P.x - o.x, z: P.z - o.z };
        return { clip, R, d: Math.hypot(R.x - r0.x, R.z - r0.z) };
      };
      if (ball.contact.kind === 'over' && !m.chibi) {
        const o = need('smash');
        return { ...o, P, ok: o.d <= STEP + run };
      }
      const f = need('swing');
      const toLeft = (P.x - r0.x) * (s === 0 ? 1 : -1) > 0;   // the ball is on the player's left
      const l = need(toLeft ? 'lungeL' : 'lungeR'), dv = need(toLeft ? 'diveL' : 'diveR');
      const flies = DIVE + Math.max(0, left - CONTACT.diveL) * vmax;   // a run up to the take-off, then the flight
      const sideways = Math.abs(dv.R.z - r0.z) <= Math.max(0.5, Math.abs(dv.R.x - r0.x) * 0.8);   // dives go sideways, never back
      if (f.d <= STEP + run || (m.chibi && f.d <= STEP + run + cfg.reach)) return { ...f, P, ok: true };
      if (m.chibi) return { ...f, P, ok: false };
      if (l.d <= STEP + run) return { ...l, P, ok: true };
      if (DIVE && sideways && dv.d <= flies) return { ...dv, P, ok: true };
      if (DIVE && sideways && dv.d <= flies + DIVE * 0.6) return { ...dv, P, ok: false };   // a dive that falls short
      return { ...f, P, ok: false };
    };
    // Pick the stroke for where the ball will be met, then meet it when it is at that
    // stroke's racket height (a dive's racket is lower than a forehand's), as near the
    // contact moment as that allows but no sooner than the stroke can get there.
    const first = choose(Math.max(now, ball.contact.t));
    const hc = off(m, first.clip).y - C.surface;
    const band = /^dive/.test(first.clip) ? LEAP : first.clip === 'smash' ? [0, JUMP * 1.3]
      : first.clip === 'swing' && !m.chibi ? [-0.12 * K, 0.25 * K] : [0, 0];   // a leap, a jump, a lifted arm
    const at = meetTime(hc + band[0], hc + band[1], now + LEAD[first.clip], ball.contact.t);
    const P = ballAt(at), left = at - now, o = offW(m, s, first.clip);
    const pick = { clip: first.clip, ok: first.ok, R: { x: P.x - o.x, z: P.z - o.z } };
    // still within the stroke's reach at that moment? (a late one may have let it get away)
    const d = Math.hypot(pick.R.x - r0.x, pick.R.z - r0.z), run = vmax * left;
    const most = /^dive/.test(pick.clip) ? DIVE + Math.max(0, left - CONTACT.diveL) * vmax : STEP + run + (m.chibi ? cfg.reach : 0);
    if (d > most + 0.15) pick.ok = false;
    const dive = /^dive/.test(pick.clip);
    m.hit = { at, clip: pick.clip, R: pick.R, ok: pick.ok, power, u, dir, P, launch: dive ? at - CONTACT[pick.clip] : now, started: false, fly: null };
    m.probe = { P: { x: P.x, y: C.surface + P.h, z: P.z }, at: clock + left, best: Infinity, clip: pick.clip, ok: pick.ok };
    m.swingT = SWING;
    if (m.hit.launch <= now) startStroke(s, m);   // a dive in good time waits for its take-off
  }

  // The stroke's clip starts, timed to the ball; a dive takes off toward where it meets
  // the ball (or as far as a dive goes). A late swing steps straight into place.
  function startStroke(s, m) {
    const h = m.hit;
    h.started = true;
    // a forehand lifts (or drops) its racket arm to a ball off its usual contact height
    const dy = h.clip === 'swing' ? clamp(h.P.h + C.surface - off(m, 'swing').y, -0.12 * K, 0.25 * K) : 0;
    m.anim = { clip: h.clip, contact: Math.max(0, h.at - ball.t), dy };
    const r = rootOf(m, s), dx = h.R.x - r.x, dz = h.R.z - r.z, d = Math.hypot(dx, dz) || 1;
    if (/^dive/.test(h.clip)) {
      const reach = Math.min(d, DIVE + 0.1);
      h.fly = { from: r, to: { x: r.x + (dx / d) * reach, z: r.z + (dz / d) * reach }, t0: ball.t };
      const tc = clock + Math.max(0, h.at - ball.t);
      m.leap = { t0: clock, tc, tl: tc + 0.2, h: clamp(h.P.h + C.surface - off(m, h.clip).y, LEAP[0], LEAP[1]) };
    } else {
      if (h.clip === 'smash') {   // the jump up to a ball above the clip's own reach
        const tc = clock + Math.max(0, h.at - ball.t);
        m.leap = { t0: Math.min(clock, tc - 0.12), tc, tl: tc + 0.25, h: clamp(h.P.h + C.surface - off(m, 'smash').y, 0, JUMP * 1.3) };
      }
      if (h.ok && h.at - ball.t < 0.05) setRoot(m, s, h.R);
    }
  }

  // Closing in for a planned stroke: the body heads for where the stroke needs it
  // (h.R), arriving as the ball does; the last stretch (a step, a lunge) can be quicker
  // than a run, and a dive flies the rest of the way once it takes off.
  function approach(s, m, dt) {
    const h = m.hit;
    if (!h.started && ball.t >= h.launch) startStroke(s, m);
    const r = rootOf(m, s);
    let next;
    if (h.fly) {
      const k = h.at > h.fly.t0 ? clamp((ball.t - h.fly.t0) / (h.at - h.fly.t0), 0, 1) : 1;
      next = { x: h.fly.from.x + (h.fly.to.x - h.fly.from.x) * k, z: h.fly.from.z + (h.fly.to.z - h.fly.from.z) * k };
    } else {
      const dx = h.R.x - r.x, dz = h.R.z - r.z, d = Math.hypot(dx, dz);
      if (d < 1e-4) { m.vl = 0; return; }
      const left = Math.max(dt, h.at - ball.t);
      const v = h.ok && !/^dive/.test(h.clip) ? Math.max(speedLimit(), d / left) : speedLimit();
      const step = Math.min(d, v * dt);
      next = { x: r.x + (dx / d) * step, z: r.z + (dz / d) * step };
    }
    m.vl = ((next.x - r.x) / Math.max(dt, 1e-3)) * (s === 0 ? 1 : -1);
    setRoot(m, s, next);
  }

  // The ball reaches the racket (or where it would have): strike, or miss; then a
  // diver slides on and stays down a moment, a lunge pushes back, a smash lands.
  function finishHit(s, m) {
    const h = m.hit;
    m.hit = null;
    // It is a hit if the body got to where this stroke's racket meets the ball.
    const r = rootOf(m, s);
    h.ok = Math.hypot(r.x - h.R.x, r.z - h.R.z) <= (m.chibi ? cfg.reach : Math.max(0.18, STEP * 0.7));
    if (h.ok) {
      const after = ball.t - h.at;
      returnShot(s, m, h);
      ball.t = after;                     // the new flight started at the contact moment
    } else {
      popup(/^dive/.test(h.clip) ? 'So close!' : h.clip === 'smash' ? 'Over your head!' : 'Out of reach', s, '#adb5bd', 0.8, 0.85);
    }
    if (m.probe) m.probe.ok = h.ok;
    if (/^dive/.test(h.clip)) {
      const f = h.fly || { from: r, to: h.R };
      const dx = f.to.x - f.from.x, dz = f.to.z - f.from.z, d = Math.hypot(dx, dz) || 1;
      const slide = 0.18 * K;
      m.slide = { from: r, to: { x: r.x + (dx / d) * slide, z: r.z + (dz / d) * slide }, t0: clock, dur: 0.3 };
      m.down = clock + 0.85;
      dusts.push({ at: clock + 0.2, x: m.slide.to.x, z: m.slide.to.z });
    } else if (/^lunge/.test(h.clip)) m.down = clock + 0.25;
    else if (h.clip === 'smash') m.down = clock + 0.2;
  }

  function whiff(m) { m.anim = { clip: 'swing' }; m.swingT = SWING; }

  function swingBy(s, m, power, dir) {
    if (clock < m.swingReady || clock < m.down) return;     // mid-swing, or down on the court
    m.swingReady = clock + SWING;
    if (phase === 'serve') {
      const sv = serverInfo();
      if (sv.m === m && phaseT > 0.35) serveSwing(sv.s, m, power, dir); else whiff(m);
      return;
    }
    if (phase !== 'rally' || !ball || ball.hitter === s || ball.out || ball.net) { whiff(m); return; }
    if (ball.receiver !== m) { popup('Partner’s ball', s, '#adb5bd', 0.6, 0.8); whiff(m); return; }
    if (m.hit) return;
    const u = ball.contact.t - ball.t + lagOf(m);
    if (u > EARLY_LIMIT) { popup('Too early', s, '#adb5bd', 0.6, 0.8); whiff(m); return; }
    if (u < LATE_LIMIT) { whiff(m); return; }
    planHit(s, m, power, u, dir);
  }

  function toggleVote(p) {
    if (phase !== 'room') return;
    if (votes.has(p.id)) votes.delete(p.id); else votes.add(p.id);
    hub.rumble(p, votes.has(p.id) ? 40 : 15);
    hub.refreshRoster();
  }

  // The server's tossed ball, bobbing over the strings; when the server swings it
  // comes down onto them.
  function tossPos(s, m) {
    const P = serveSpot(s, m);
    let lift = (A.toss || 0.6) * (0.3 + 0.7 * Math.abs(Math.sin(performance.now() / 300)));
    if (pendingServe) lift *= clamp((pendingServe.at - clock) / 0.1, 0, 1);
    return { x: P.x, y: C.surface + P.h + lift, z: P.z };
  }

  function ballWorld() {
    if (phase === 'serve') {
      const { s, m } = serverInfo();
      return tossPos(s, m);
    }
    if (!ball) return null;
    const p = ballAt(ball.t);
    return { x: p.x, y: C.surface + p.h, z: p.z };
  }

  // =====================================================================
  // 3D
  // =====================================================================
  let renderer = null, scene = null, loadError = null, loadP = 0;
  let template = null;
  let fx = null;   // Kit3D.liven: the venue's trees, flags, crowd, sea (nothing in the fallback stadium)
  const cams = [];
  let orbitCam = null;
  const camState = [null, null];
  let ballMesh, blob, ring;
  const trail = [];
  const memberObjs = new Map(); // member -> { root, tag, ch (animated) | armR, armL, legL, legR, head, phase (chibi) }
  let lastFrame = performance.now();
  const hitLog = [];            // how close each stroke's racket head came to the ball (_debug, smoke test)
  const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3();

  function canvasTexture(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // A flash where the racket meets the ball, dust where a diver lands.
  const bursts = [], puffs = [];
  const dusts = [];             // dust due: { at: clock time, x, z }
  let glowTex = null;
  const glow = () => glowTex || (glowTex = canvasTexture(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  }));
  function impact(P, color, size = 1) {
    if (!scene) return;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.position.set(P.x, C.surface + P.h, P.z);
    scene.add(sp);
    bursts.push({ sp, t: 0, life: 0.22, size: size * cfg.ballR * 10 });
  }
  function dust(x, z) {
    if (!scene) return;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 0.8;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: cfg.dustColor || '#e9dcc0', transparent: true, depthWrite: false, opacity: 0.7 }));
      sp.position.set(x + Math.cos(a) * 0.2, C.surface + 0.1, z + Math.sin(a) * 0.2);
      scene.add(sp);
      puffs.push({ sp, t: 0, life: 0.55 + Math.random() * 0.3, vx: Math.cos(a) * v, vy: 0.3 + Math.random() * 0.4, vz: Math.sin(a) * v, size: K * 0.18 });
    }
  }
  function updateFx(dt) {
    for (let i = dusts.length - 1; i >= 0; i--) if (clock >= dusts[i].at) { dust(dusts[i].x, dusts[i].z); dusts.splice(i, 1); }
    for (const list of [bursts, puffs]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.t += dt;
        const k = b.t / b.life;
        if (k >= 1) { scene.remove(b.sp); b.sp.material.dispose(); list.splice(i, 1); continue; }
        if (list === bursts) {
          b.sp.scale.setScalar(b.size * (0.3 + 0.7 * Math.sqrt(k)));
          b.sp.material.opacity = 1 - k;
        } else {
          b.sp.position.x += b.vx * dt; b.sp.position.y += b.vy * dt; b.sp.position.z += b.vz * dt;
          b.vx *= 1 - dt * 3; b.vz *= 1 - dt * 3;
          b.sp.scale.setScalar(b.size * (0.6 + k));
          b.sp.material.opacity = 0.7 * (1 - k);
        }
      }
    }
  }

  function setup(env, chars) {
    renderer = Kit3D.renderer(hub);
    if (cfg.exposure) renderer.toneMappingExposure = cfg.exposure;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(cfg.sky);
    scene.fog = new THREE.Fog(cfg.sky, cfg.fog[0], cfg.fog[1]);
    if (cfg.skyDome) scene.add(Kit3D.skyDome(cfg.skyDome));   // gradient sky behind the venue
    scene.add(env.scene);
    fx = Kit3D.liven(env);
    Kit3D.lights(scene, { size: cfg.shadowSize, target: [0, 0, 0], sun: cfg.sun, ...(cfg.light || {}) });
    template = chars.scene.getObjectByName(cfg.character);

    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(cfg.ballR, 20, 14),
      new THREE.MeshStandardMaterial({ color: cfg.ballColor, roughness: 0.5, emissive: cfg.ballColor, emissiveIntensity: 0.25 }));
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    blob = new THREE.Mesh(new THREE.CircleGeometry(cfg.ballR * 1.5, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    scene.add(blob);
    const trailGeo = new THREE.SphereGeometry(cfg.ballR * 0.8, 10, 8);
    for (let i = 0; i < 14; i++) {
      const tm = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: '#9775fa', transparent: true, opacity: 0, depthWrite: false }));
      tm.visible = false;
      scene.add(tm);
      trail.push({ mesh: tm, x: 0, y: 0, z: 0, live: false });
    }
    ring = new THREE.Mesh(new THREE.TorusGeometry(cfg.reach * 0.35, cfg.reach * 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    scene.add(ring);

    for (let s = 0; s < 2; s++) {
      cams.push(new THREE.PerspectiveCamera(50, 1, 0.05, 400));
      camState[s] = { pos: new THREE.Vector3(0, cfg.cam.height, lineN(s) * (C.line + cfg.cam.back)), look: new THREE.Vector3(0, 0.7, 0) };
    }
    orbitCam = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
    if (inMatch()) buildMembers3D();
  }

  function nameSprite(text, color) {
    const tex = canvasTexture(256, 64, (g, w, h) => {
      g.font = '700 30px Rubik, system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = Math.min(w - 8, g.measureText(text).width + 28);
      g.fillStyle = 'rgba(14,15,19,0.75)';
      g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, 48, 24); g.fill();
      g.fillStyle = color;
      g.fillText(text, w / 2, h / 2 + 1);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sp.scale.set(cfg.tagSize * 4, cfg.tagSize, 1);
    return sp;
  }

  function clearMembers3D() {
    for (const o of memberObjs.values()) {
      if (o.ch) { o.ch.dispose(); o.ring.material.dispose(); }
      if (scene) scene.remove(o.root);
    }
    memberObjs.clear();
  }

  // Each stroke's racket head at its contact frame, from this animal's clips (model
  // units; off() scales them). A clip missing from an older file falls back to defaults.
  function reachFor(id) {
    const clips = { swing: 'swing', serve: cfg.serveClip || 'swing', smash: 'smash', lungeL: 'lungeL', lungeR: 'lungeR', diveL: 'diveL', diveR: 'diveR' };
    const r = {};
    for (const [k, clip] of Object.entries(clips)) r[k] = MabarChars.reachOf(id, clip, undefined, cfg.tool || 'racket');
    return r;
  }

  // Animated character for a member (assignAnimals), or null to use the chibi
  // template: the fallback when no character file loaded. If only this member's
  // file failed, any loaded animal stands in.
  function animalFor(m) {
    if (!pool.length || !window.MabarChars) return null;
    if (m.animal && MabarChars.ready(m.animal)) return m.animal;
    return pool.find((id) => MabarChars.ready(id)) || null;
  }

  // Player colour under the animals' feet (the chibis wear it on their shirts).
  let ringGeo = null;
  function colorRing(color) {
    ringGeo = ringGeo || new THREE.RingGeometry(0.24, 0.31, 40);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;       // just above the stadium court's painted surface
    ring.renderOrder = 1;
    return ring;
  }

  function celebrate(s, clip) {
    for (const m of sides[s].members) {
      const o = memberObjs.get(m);
      // a point hop waits for a diver to get up (the end-of-match clips don't)
      if (o && o.ch && (clip !== 'jump' || (clock >= m.down && !(o.ch.overlay && /^(dive|lunge|smash)/.test(o.ch.overlay.name))))) o.ch.play(clip);
    }
  }

  const HAIR = ['#4a2c1d', '#2b1d16', '#7a4a2a', '#c58b4a', '#3a3a46'];

  function buildMembers3D() {
    if (!scene || !template) return;
    clearMembers3D();
    let i = 0;
    for (let s = 0; s < 2; s++) {
      for (const m of sides[s].members) {
        const animal = animalFor(m);
        if (animal) {
          const k = cfg.characterScale || 1.8;
          const ch = MabarChars.create(animal, { scale: k, rotationY: s === 0 ? 0 : Math.PI, tool: cfg.tool });
          const tag = nameSprite(m.name, m.color);
          tag.position.y = (MabarChars.defs[animal].height || 1) + 0.14;
          tag.scale.multiplyScalar(1 / k);
          const ring = colorRing(m.color);
          ch.root.add(tag, ring);
          scene.add(ch.root);
          m.chibi = false;
          m.reach = reachFor(animal);
          memberObjs.set(m, { root: ch.root, tag, ring, ch, yaw: s === 0 ? 0 : Math.PI, vx: 0, vz: 0, lastX: null, lastZ: null, serving: false });
          continue;
        }
        m.chibi = true;
        m.reach = null;
        const root = template.clone(true);
        const color = new THREE.Color(m.color);
        const hair = new THREE.Color(HAIR[(i++ * 3 + s) % HAIR.length]);
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          const n = o.material.name;
          if (n === 'shirt' || n === 'accent' || n === 'hair') {
            o.material = o.material.clone();
            if (n === 'hair') o.material.color.copy(hair);
            else if (n === 'accent' && m.cpu) o.material.color.set('#2d3340');
            else o.material.color.copy(color);
          }
        });
        root.scale.setScalar(cfg.charScale);
        root.rotation.y = s === 0 ? 0 : Math.PI;
        const tag = nameSprite(m.name, m.color);
        tag.position.y = 0.72;
        tag.scale.multiplyScalar(1 / cfg.charScale);
        root.add(tag);
        scene.add(root);
        const part = (suffix) => root.getObjectByName(`${cfg.character}_${suffix}`);
        memberObjs.set(m, {
          root, tag, armR: part('armR'), armL: part('armL'), legL: part('legL'), legR: part('legR'), head: part('head'), phase: 0,
        });
      }
    }
  }

  function poseAnimal(m, s, o, dt) {
    const dirZ = lineN(s);
    // The body stands off the player's spot so the forehand's racket head meets the
    // ball there (the racket is in the animals' right hand, the chibis' left: off()).
    const { x, z } = rootOf(m, s);
    const vx = o.lastX == null ? 0 : (x - o.lastX) / Math.max(dt, 1e-3);
    const vz = o.lastZ == null ? 0 : (z - o.lastZ) / Math.max(dt, 1e-3);
    o.lastX = x;
    o.lastZ = z;
    o.vx += (vx - o.vx) * Math.min(1, dt * 10);
    o.vz += (vz - o.vz) * Math.min(1, dt * 10);
    o.root.position.set(x, leapY(m, clock), z);
    o.ch.setVelocity(o.vx, o.vz);
    o.ch.setStance(phase === 'serve' || phase === 'rally' ? 'ready' : 'idle');
    // Upper body: racket back as the ball comes, or the trophy pose under a high one.
    // The server holds the first frame of cfg.serveClip ('serve': trophy pose, ball
    // tossed; default 'swing': racket back) until the swing.
    const server = phase === 'serve' && serverInfo().m === m;
    const serveClip = cfg.serveClip || 'swing';
    let ready = 0, readyClip = 'swing';
    if (phase === 'rally' && ball && ball.receiver === m) {
      const u = ball.contact.t - ball.t;
      ready = Math.max(0, Math.min(1, 1 - (u - 0.1) / 0.6));
      if (ball.contact.kind === 'over' && serveClip === 'serve') readyClip = 'serve';
    }
    o.ch.setReady(server ? 1 : ready, server ? serveClip : readyClip);
    // A stroke the sim started, timed so the clip's contact frame lands on the ball.
    const base = s === 0 ? 0 : Math.PI;
    if (m.anim) {
      const a = m.anim;
      m.anim = null;
      const c = a.contact == null ? undefined : a.contact + dt;   // update() below already plays this frame
      if (a.clip === 'serve' && serveClip !== 'swing') o.ch.swing(0.4, serveClip, a.from || 0, c);
      else if (a.clip === 'swing' || a.clip === 'serve' || !o.ch.has(a.clip)) { o.ch.swing(0.42, 'swing', 0, c); o.ch.raise(a.dy); }
      else { o.ch.play(a.clip, { fade: 0.06, contact: c }); o.yaw = base; }   // full-body strokes are played square to the net
    }
    o.serving = server;
    // Square to the net, shuffling sideways; turn into a run (toward wherever it is
    // going, even back for a lob) only for dashes the shuffle can't keep up with, and
    // back to the net to hit, lunge, dive or smash.
    const lim = o.ch.strafeLimit();
    const speed = Math.hypot(o.vx, o.vz);
    const dash = lim ? clamp((speed - lim * 0.8) / (lim * 0.6), 0, 1) : Math.min(1, speed / cfg.runSpeed);
    const heading = speed > 1e-3 ? Math.atan2(o.vx * (s === 0 ? 1 : -1), o.vz * dirZ) : 0;   // + = the character's left
    const stroke = clock < m.down || (m.hit && m.hit.started) || (o.ch.overlay && /^(dive|lunge|smash)/.test(o.ch.overlay.name));
    const turn = stroke ? 0 : heading * dash * (1 - ready) * (m.swingT > 0 ? 0 : 1);
    const want = base + turn;
    o.yaw += (((want - o.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * Math.min(1, dt * 9);
    o.root.rotation.y = o.yaw;
    const bw = ball && ballWorld();
    o.ch.look(bw && !stroke ? Math.max(-0.5, Math.min(0.5, (bw.x - x) * 0.12 * (s === 0 ? 1 : -1))) : 0);
    o.ch.update(dt);
    // How close the racket head came to the ball around a stroke's contact moment.
    const pr = m.probe;
    if (pr) {
      if (Math.abs(clock - pr.at) <= 0.05) {
        const p = o.ch.toolHead(tmpV);
        if (p) pr.best = Math.min(pr.best, p.distanceTo(tmpP.set(pr.P.x, pr.P.y, pr.P.z)));
        if (p && pr.best === p.distanceTo(tmpP)) {
          pr.seen = { root: [o.root.position.x, o.root.position.z].map((v) => +v.toFixed(2)), head: p.toArray().map((v) => +v.toFixed(2)),
            clip: o.ch.overlay ? `${o.ch.overlay.name}@${o.ch.actions[o.ch.overlay.name].time.toFixed(3)} w${o.ch.overlay.w.toFixed(2)}` : `layer@${o.ch.swingT.toFixed(3)}`, dt: +(clock - pr.at).toFixed(3) };
        }
      } else if (clock > pr.at + 0.05) {
        hitLog.push({ who: m.name, clip: pr.clip, ok: pr.ok, gap: pr.best === Infinity ? null : +pr.best.toFixed(3), P: [pr.P.x, pr.P.y, pr.P.z].map((v) => +v.toFixed(2)), ...(pr.seen || {}) });
        if (hitLog.length > 60) hitLog.shift();
        m.probe = null;
      }
    }
  }

  function poseMember(m, s, o, dt) {
    if (o.ch) { poseAnimal(m, s, o, dt); return; }
    // Stand so the racket (held out to the side) meets the ball.
    const { x, z } = rootOf(m, s);
    const prevX = o.root.position.x;
    o.root.position.set(x, 0, z);
    const speed = Math.abs(x - prevX) / Math.max(dt, 1e-3);
    m.run += (Math.min(1, speed / cfg.runSpeed) - m.run) * Math.min(1, dt * 8);
    o.phase += dt * (6 + 8 * m.run);
    const leg = Math.sin(o.phase) * 0.75 * m.run;
    if (o.legL) o.legL.rotation.x = leg;
    if (o.legR) o.legR.rotation.x = -leg;
    o.root.position.y = Math.abs(Math.sin(o.phase)) * 0.04 * m.run * cfg.charScale;

    // Arm: ready pose when the ball is coming, whip through when swinging.
    let rx = -0.35, rz = 0.15;
    const incoming = phase === 'rally' && ball && ball.receiver === m;
    if (incoming) {
      const u = ball.contact.t - ball.t;
      const k = Math.max(0, Math.min(1, 1 - (u - 0.1) / 0.6));
      rx = -0.35 - 1.0 * k;
      rz = 0.15 + 1.15 * k;
    }
    if (phase === 'serve' && serverInfo().m === m) { rx = -1.2; rz = 1.0; }
    if (m.swingT > 0) {
      const p = 1 - m.swingT / SWING;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      rx = -1.4;
      rz = 1.3 - 2.7 * e;
    }
    if (o.armR) o.armR.rotation.set(rx, 0, rz);
    if (o.armL) o.armL.rotation.set(-0.5 - 0.3 * m.run, 0, -0.35);
    if (o.head && ball) {
      const bw = ballWorld();
      if (bw) o.head.rotation.y = Math.max(-0.6, Math.min(0.6, (bw.x - x) * 0.15 * (s === 0 ? 1 : -1)));
    }
  }

  function trailReset() { for (const tr of trail) { tr.live = false; if (tr.mesh) tr.mesh.visible = false; } }

  function updateScene(dt, time) {
    if (fx) fx.update(dt, time / 1000);
    for (let s = 0; s < 2; s++) for (const m of sides[s].members) {
      const o = memberObjs.get(m);
      if (o) poseMember(m, s, o, dt);
    }
    updateFx(dt);

    const bw = ballWorld();
    ballMesh.visible = !!bw && phase !== 'room' && phase !== 'over' && phase !== 'intro';
    blob.visible = ballMesh.visible;
    if (bw && ballMesh.visible) {
      ballMesh.position.set(bw.x, bw.y, bw.z);
      const surf = (C.onSurface(bw.x, bw.z) ? C.surface : 0) + 0.003;
      blob.position.set(bw.x, surf, bw.z);
      const hgt = Math.max(0, bw.y - surf);
      blob.scale.setScalar(1 + hgt * cfg.blobGrow);
      blob.material.opacity = Math.max(0.08, 0.32 - hgt * cfg.blobFade);
    }
    if (ball && bw && (phase === 'rally' || phase === 'point')) {
      trail.unshift(trail.pop());
      const head = trail[0];
      head.x = bw.x; head.y = bw.y; head.z = bw.z; head.live = true;
      head.mesh.material.color.set(ball.color);
    }
    trail.forEach((tr, i) => {
      tr.mesh.visible = tr.live && ballMesh.visible;
      if (!tr.mesh.visible) return;
      tr.mesh.position.set(tr.x, tr.y, tr.z);
      tr.mesh.material.opacity = 0.45 * (1 - i / trail.length);
      tr.mesh.scale.setScalar(1 - (i / trail.length) * 0.6);
    });

    // Timing ring at the receiver's contact point
    ring.material.opacity = 0;
    if (phase === 'rally' && ball && !ball.out && !ball.net && ball.receiver) {
      const u = ball.contact.t - ball.t;
      if (u < 0.6 && u > LATE_LIMIT) {
        const k = u <= EARLY_LIMIT ? 1 - Math.min(1, Math.abs(u - IDEAL) / 0.3) : 0.15;
        ring.position.set(toX(ball.contact.y), C.surface + ball.contact.h, toZ(ball.contact.x));
        ring.rotation.set(0, 0, 0);
        ring.scale.setScalar(1.6 - k * 0.6);
        ring.material.color.set(ball.receiver.color);
        ring.material.opacity = 0.25 + k * 0.7;
      }
    }

    // Chase cameras: behind each team, drifting with the ball, backing up when a
    // player on that side runs deep (so they stay in the picture)
    const ease = 1 - Math.exp(-dt * 3);
    for (let s = 0; s < 2; s++) {
      const dir = lineN(s);
      const b = bw && phase !== 'room' && phase !== 'over' ? bw : null;
      const bx = b ? b.x : 0;
      const near = b ? Math.max(0, Math.min(1, (b.z * dir + C.line) / (2 * C.line))) : 0.3;
      const deep = Math.max(1, ...sides[s].members.map((m) => m.px));
      const want = new THREE.Vector3(bx * cfg.cam.follow, cfg.cam.height + near * cfg.cam.rise, dir * (C.line * deep + cfg.cam.back - near * cfg.cam.push));
      const by = b ? b.y - C.surface : 0;   // a lob tilts the view up so its top stays in the picture
      const look = new THREE.Vector3(bx * cfg.cam.follow * 0.9, cfg.cam.lookY + by * 0.2 + Math.max(0, by - 3 * A.contact) * 0.25, dir * C.line * (cfg.cam.ahead + near * cfg.cam.track));
      const st = camState[s];
      if (phase === 'intro') {
        const k = 1 - Math.max(0, phaseT) / 2.6;
        const e = k * k * (3 - 2 * k);
        st.pos.copy(orbitCam.position).lerp(want, e);
        st.look.set(0, 0.7, 0).lerp(look, e);
      } else {
        st.pos.lerp(want, ease);
        st.look.lerp(look, ease);
      }
      cams[s].position.copy(st.pos);
      cams[s].lookAt(st.look);
    }
    const a = time / 1000 * 0.1;
    orbitCam.position.set(Math.sin(a) * cfg.orbit[0], cfg.orbit[1], Math.cos(a) * cfg.orbit[0]);
    orbitCam.lookAt(0, cfg.orbit[2], 0);
  }

  function views() {
    const { W } = hub;
    if (phase === 'room' || phase === 'over') return [{ cam: orbitCam, x: 0, w: W, side: null }];
    const hs = humanSides();
    if (hs.length === 2) return [{ cam: cams[0], x: 0, w: W / 2, side: 0 }, { cam: cams[1], x: W / 2, w: W / 2, side: 1 }];
    const s = hs.length ? hs[0] : 0;
    return [{ cam: cams[s], x: 0, w: W, side: s }];
  }

  // =====================================================================
  // HUD
  // =====================================================================
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  function centerX() {
    const lobby = document.querySelector('#lobby');
    return lobby.hidden ? hub.W / 2 : Math.max(hub.W / 2, 340 + (hub.W - 340) / 2);
  }

  function drawRoom(ctx) {
    const { W, H } = hub;
    const players = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
    const seated = players.slice(0, SEATS);
    const wide = W >= 760;
    const cw = Math.min(800, W - 32);
    const ch = wide ? 420 : 640;
    const x0 = (W - cw) / 2, y0 = Math.max(12, (H - ch) / 2);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    rr(ctx, x0, y0, cw, ch, 24); ctx.fill();
    ctx.restore();
    ctx.fillStyle = cfg.color;
    rr(ctx, x0, y0, cw, 8, [24, 24, 0, 0]); ctx.fill();

    // Left: the way in. Right: who's here and when it starts.
    const qs = wide ? 210 : 170;
    const qx = wide ? x0 + 34 : x0 + (cw - qs) / 2, qy = y0 + (wide ? 64 : 30);
    hub.drawJoin(ctx, qx, qy, qs, { label: 'Scan with your phone to join' });
    const rx = wide ? x0 + 34 + qs + 34 : x0 + 24;
    const rw = wide ? cw - (rx - x0) - 30 : cw - 48;
    const cx = rx + rw / 2;
    let ty = wide ? y0 + 58 : qy + qs + 90;

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = cfg.color;
    ctx.font = hub.font(800, 30);
    ctx.fillText(cfg.name.toUpperCase(), cx, ty);
    ctx.fillStyle = '#6b665e';
    ctx.font = hub.font(500, 14);
    const L = lineup();
    const a = sideCount(L, 0), b = sideCount(L, 1);
    const fmt = a === b ? `${formatName(a, b)}, ${a} vs ${b}` : `${a} vs ${b}`;
    ctx.fillText(players.length ? `${fmt}. ${cfg.matchLabel}. AI fills open seats.` : `${fmt}. Waiting for players, or watch the AI.`, cx, ty + 30);

    const secs = players.length ? Math.max(0, Math.ceil(roomT)) : ROOM_TIME;
    ctx.fillStyle = '#1d2433';
    ctx.font = hub.font(800, 50);
    ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, cx, ty + 82);
    ctx.fillStyle = '#8a8378';
    ctx.font = hub.font(500, 13);
    ctx.fillText(players.length ? 'until the match starts' : 'the clock starts when someone joins', cx, ty + 114);

    const gap = 8;
    const sw = (rw - gap * (SEATS - 1)) / SEATS;
    const sy = ty + 150, sh = 96;
    roomHits = [];
    // Above each seat: the side it plays for, or the animal its player gets.
    const seatLabel = (i, p) => {
      const def = p && window.MabarChars && MabarChars.defs[slotAnimal(p.slot)];
      return def ? def.name : i % 2 ? 'Far side' : 'Near side';
    };
    for (let i = 0; i < SEATS; i++) {
      const sx = rx + i * (sw + gap);
      const p = seated[i];
      ctx.fillStyle = '#b3aa9c';
      ctx.font = hub.font(700, 10);
      ctx.fillText(seatLabel(i, p).toUpperCase(), sx + sw / 2, sy - 9);
      if (p) {
        ctx.fillStyle = '#f3efe8';
        rr(ctx, sx, sy, sw, sh, 14); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx + sw / 2, sy + 27, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1d2433';
        ctx.font = hub.font(700, 14);
        ctx.fillText(p.name.length > 9 ? p.name.slice(0, 8) + '…' : p.name, sx + sw / 2, sy + 55);
        const voted = votes.has(p.id);
        ctx.fillStyle = voted ? '#1fae4b' : '#9a9286';
        ctx.font = hub.font(600, 12);
        ctx.fillText(voted ? '✓ voted' : 'not voted', sx + sw / 2, sy + 77);
      } else {
        const open = !!L[i];
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = open ? '#d6cfc4' : '#e8e2d8';
        rr(ctx, sx + 0.5, sy + 0.5, sw - 1, sh - 1, 14); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = open ? '#a39c90' : '#cfc8bc';
        ctx.font = hub.font(700, 14);
        ctx.fillText(open ? 'AI' : 'Closed', sx + sw / 2, sy + 40);
        ctx.font = hub.font(500, 11);
        ctx.fillText(open ? 'open seat' : 'no one plays here', sx + sw / 2, sy + 60);
        // [x] closes the seat, [+] reopens it (also keys 1-4)
        const bx = sx + sw - 15, by = sy + 15, hov = hoverHit && hoverHit.seat === i;
        ctx.fillStyle = hov ? (open ? '#ff6b6b' : '#1fae4b') : open ? '#d6cfc4' : '#e3ddd3';
        ctx.beginPath(); ctx.arc(bx, by, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hov ? '#ffffff' : '#5d584f';
        ctx.font = hub.font(800, 16);
        ctx.fillText(open ? '×' : '+', bx, by + 1);
        ctx.fillStyle = '#c4bcb0';
        ctx.font = hub.font(600, 10);
        ctx.fillText(`key ${i + 1}`, sx + sw / 2, sy + 80);
        roomHits.push({ x: sx, y: sy, w: sw, h: sh, seat: i, act: () => toggleSeat(i) });
      }
    }
    ctx.fillStyle = '#5d584f';
    ctx.font = hub.font(500, 14);
    const need = players.length - [...votes].filter((id) => hub.players.has(id)).length;
    const line = !players.length ? 'Up to 4 players. Hold your phone like a racket.'
      : need > 0 ? `Tap “Vote to start” on your phone. ${need} more vote${need > 1 ? 's' : ''} to start now.`
        : 'Starting…';
    ctx.fillText(line, cx, sy + sh + 28);
    if (players.length > SEATS) {
      ctx.fillStyle = '#9a9286';
      ctx.font = hub.font(500, 12);
      ctx.fillText(`${players.length - SEATS} watching. They’ll get the next match.`, cx, sy + sh + 48);
    }
    // Start now (host): starts with AI in the open seats, or an AI-only demo.
    const label = players.length ? '▶  Start now' : '▶  Watch AI play';
    ctx.font = hub.font(700, 14);
    const bw = ctx.measureText(label).width + 64, bh = 34;
    const bx = cx - bw / 2, by = sy + sh + (players.length > SEATS ? 62 : 46);
    const hov = hoverHit && hoverHit.start;
    ctx.fillStyle = hov ? cfg.color : '#1d2433';
    rr(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, cx - 10, by + bh / 2 + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = hub.font(700, 11);
    ctx.fillText('F', bx + bw - 22, by + bh / 2 + 1);
    roomHits.push({ x: bx, y: by, w: bw, h: bh, start: true, act: forceStart });
  }

  function forceStart() { if (phase === 'room') startMatch(); }

  // Host-screen input for the room card (mouse, and keys F / 1-4).
  let hoverHit = null;
  const arena = document.querySelector('#arena');
  const hitAt = (e) => roomHits.find((h) => e.clientX >= h.x && e.clientX <= h.x + h.w && e.clientY >= h.y && e.clientY <= h.y + h.h) || null;
  const onPointer = (e) => {
    hoverHit = phase === 'room' ? hitAt(e) : null;
    arena.style.cursor = hoverHit ? 'pointer' : '';
  };
  const onClick = (e) => { const h = phase === 'room' && hitAt(e); if (h) h.act(); };
  const onKey = (e) => {
    if (e.repeat || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    if (e.code === 'KeyF') {
      if (phase === 'room') forceStart();
      else if (demo) toRoom();
    } else if (phase === 'room' && /^Digit[1-4]$/.test(e.code)) {
      toggleSeat(Number(e.code.slice(5)) - 1);
    }
  };
  arena.addEventListener('pointermove', onPointer);
  arena.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);

  function drawScoreboard(ctx) {
    const { W } = hub;
    const cy = 36, h = 50;
    ctx.font = hub.font(700, 15);
    const n0 = teamName(0), n1 = teamName(1);
    const half = Math.max(ctx.measureText(n0).width, ctx.measureText(n1).width) + (TENNIS ? 130 : 90);
    ctx.fillStyle = 'rgba(14,15,19,0.8)';
    rr(ctx, W / 2 - half, cy - h / 2, half * 2, h, h / 2); ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(244,244,245,0.92)';
    ctx.fillText(n0, W / 2 - (TENNIS ? 104 : 64), cy);
    ctx.textAlign = 'left';
    ctx.fillText(n1, W / 2 + (TENNIS ? 104 : 64), cy);
    ctx.textAlign = 'center';
    if (TENNIS) {
      for (let s = 0; s < 2; s++) {
        const d = s === 0 ? -1 : 1;
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        rr(ctx, W / 2 + d * 78 - 16, cy - 16, 32, 32, 8); ctx.fill();
        ctx.fillStyle = '#ffd32a';
        ctx.font = hub.font(800, 18);
        ctx.fillText(String(sides[s].games), W / 2 + d * 78, cy + 1);
        ctx.fillStyle = sides[s].members[0].color;
        ctx.font = hub.font(800, 24);
        ctx.fillText(pointLabel(s), W / 2 + d * 34, cy + 1);
      }
    } else {
      ctx.font = hub.font(800, 28);
      ctx.fillStyle = sides[0].members[0].color;
      ctx.fillText(String(sides[0].score), W / 2 - 36, cy + 1);
      ctx.fillStyle = sides[1].members[0].color;
      ctx.fillText(String(sides[1].score), W / 2 + 36, cy + 1);
    }
    ctx.fillStyle = 'rgba(244,244,245,0.35)';
    ctx.font = hub.font(700, 18);
    ctx.fillText('–', W / 2, cy);
    if (phase === 'serve') {
      const sv = serverInfo();
      ctx.fillStyle = '#d7f53b';
      ctx.beginPath();
      ctx.arc(W / 2 + (sv.s === 0 ? -1 : 1) * (half - 16), cy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud(ctx, vs) {
    const { W, H } = hub;
    if (vs.length === 2) { ctx.fillStyle = '#0e0f13'; ctx.fillRect(W / 2 - 2, 0, 4, H); }
    if (phase !== 'room' && phase !== 'over' && sides[0].members.length) drawScoreboard(ctx);

    for (const v of vs) {
      if (v.side == null) continue;
      const cx = v.x + v.w / 2;
      if (vs.length === 2) {
        ctx.textAlign = v.side === 0 ? 'left' : 'right';
        ctx.font = hub.font(700, 13);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(teamName(v.side), v.side === 0 ? v.x + 18 : v.x + v.w - 18, H - 22);
      }
      if (phase === 'serve') {
        const sv = serverInfo();
        if (sv.s === v.side && !sv.m.cpu) {
          ctx.textAlign = 'center';
          ctx.font = hub.font(700, 18);
          ctx.fillStyle = 'rgba(14,15,19,0.7)';
          const txt = `${sv.m.name}, swing to serve`;
          const tw = ctx.measureText(txt).width + 36;
          rr(ctx, cx - tw / 2, 78, tw, 38, 19); ctx.fill();
          ctx.fillStyle = '#f4f4f5';
          ctx.fillText(txt, cx, 98);
        }
      }
    }

    for (const pp of popups) {
      const k = pp.t / pp.life;
      let targets = vs;
      if (pp.side != null && vs.length === 2) targets = vs.filter((v) => v.side === pp.side);
      for (const v of targets) {
        ctx.globalAlpha = 1 - k * k;
        ctx.font = hub.font(800, Math.max(20, hub.UNIT * 3.6) * pp.scale);
        ctx.textAlign = 'center';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(14,15,19,0.55)';
        ctx.strokeText(pp.text, v.x + v.w / 2, H * 0.3 - k * 30);
        ctx.fillStyle = pp.color;
        ctx.fillText(pp.text, v.x + v.w / 2, H * 0.3 - k * 30);
      }
    }
    ctx.globalAlpha = 1;

    if (banner) {
      const a = Math.min(1, (banner.life - banner.t) * 2, banner.t * 3);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = 'rgba(14,15,19,0.72)';
      ctx.font = hub.font(800, Math.max(26, hub.UNIT * 4.2));
      const tw = ctx.measureText(banner.text).width + 60;
      rr(ctx, W / 2 - tw / 2, H / 2 - 52, tw, 104, 22); ctx.fill();
      ctx.fillStyle = '#f4f4f5';
      ctx.textAlign = 'center';
      ctx.fillText(banner.text, W / 2, H / 2 - 10);
      ctx.font = hub.font(600, 16);
      ctx.fillStyle = 'rgba(244,244,245,0.65)';
      ctx.fillText(banner.sub || '', W / 2, H / 2 + 26);
      ctx.globalAlpha = 1;
    }

    if (demo) {
      ctx.textAlign = 'center';
      ctx.font = hub.font(600, 13);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('AI demo · F: back to the waiting room · Esc: menu', W / 2, H - 18);
    }

    if (phase === 'over' && result) {
      ctx.fillStyle = 'rgba(14,15,19,0.5)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = result.color;
      ctx.font = hub.font(800, Math.max(34, hub.UNIT * 6.5));
      ctx.fillText(result.text, W / 2, H / 2 - 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = hub.font(700, 22);
      ctx.fillText(result.sub, W / 2, H / 2 + 14);
      ctx.fillStyle = 'rgba(244,244,245,0.7)';
      ctx.font = hub.font(500, 16);
      const next = demo && !hub.players.size ? 'Next AI match' : 'Back to the waiting room';
      ctx.fillText(`${next} in ${Math.ceil(phaseT)}…`, W / 2, H / 2 + 50);
    }
  }

  // =====================================================================
  // Game interface
  // =====================================================================
  let stopped = false;
  let slowMo = 1;               // test hook _slow(k): the whole game at k times speed
  const animals = cfg.characters && window.MabarChars
    ? Promise.all(cfg.characters.map((id) => MabarChars.load(id).catch(() => null))) // failure -> chibi
    : Promise.resolve([]);
  const onP = (p) => { loadP = p; };
  const envP = Kit3D.load(cfg.env, onP).catch((err) => {
    if (!cfg.envFallback) throw err;
    console.warn(`[mabar] ${cfg.env} failed, using ${cfg.envFallback}`, err);
    return Kit3D.load(cfg.envFallback, onP);
  });
  Promise.all([envP, Kit3D.load('assets/characters.glb'), animals])
    .then(([env, chars]) => {
      if (stopped) return;
      try { setup(env, chars); } catch (e) { loadError = '3D isn’t supported on this browser'; console.error(e); }
    })
    .catch((e) => { loadError = 'Couldn’t load the ' + cfg.name + ' assets'; console.error(e); });

  return {
    start() { toRoom(); },

    stop() {
      stopped = true;
      arena.removeEventListener('pointermove', onPointer);
      arena.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      arena.style.cursor = '';
      hub.showLobby(true);
      clearMembers3D();
      if (fx) { fx.dispose(); fx = null; }
      if (scene) scene.clear(); // keep the cached glTF reusable
      if (renderer) { renderer.dispose_(); renderer = null; }
    },

    join() {
      if (phase === 'room' && hub.players.size === 1) roomT = ROOM_TIME;
      hub.refreshRoster();
    },

    leave(p) {
      votes.delete(p.id);
      const mm = memberOf(p);
      if (mm && inMatch()) {
        mm.m.cpu = true;
        mm.m.id = `cpu-${p.id}`;
        popup(`AI takes over for ${mm.m.name}`, null, '#adb5bd', 2, 0.8);
        mm.m.name = 'CPU';
        if (!humanSides().length) toRoom();
        else if (ball && ball.receiver === mm.m && !ball.out && !mm.m.hit) cpuPlan = { u: IDEAL, miss: false, power: 0.5, dir: { x: 0, y: 0 }, done: false };
      }
      hub.refreshRoster();
    },

    // A phone swing: power 0..1 and, when the phone could tell, its direction
    // ({ x: -1 left .. 1 right, y: -1 down .. 1 up }).
    swing(p, power, dir) {
      const mm = memberOf(p);
      const d = dir && typeof dir === 'object' ? { x: clamp(+dir.x || 0, -1, 1), y: clamp(+dir.y || 0, -1, 1) } : { x: 0, y: 0 };
      if (mm) swingBy(mm.s, mm.m, power, d);
    },

    press(p, bits) {
      if (phase === 'room') { if (bits & B.A) toggleVote(p); return; }
      // Gamepad / keyboard: A swings, B smashes; the stick or d-pad held meanwhile is
      // the swing's direction (left / right, up = lob, down = flat).
      if (bits & (B.A | B.B)) {
        const d = hub.dir(p);
        this.swing(p, bits & B.B ? 0.95 : 0.6, { x: d.x, y: -d.y });
      }
    },

    action(p) { toggleVote(p); },

    actionLabel(p) {
      if (phase !== 'room') return '';
      return votes.has(p.id) ? 'Voted ✓ — tap to undo' : 'Vote to start now';
    },

    meta(p) {
      if (phase === 'room') return votes.has(p.id) ? 'voted' : 'waiting';
      const mm = memberOf(p);
      if (!mm) return 'next match';
      return TENNIS ? `${sides[mm.s].games} games` : `${sides[mm.s].score} pts`;
    },

    hint(p) {
      if (phase === 'room') {
        const s = Math.max(0, Math.ceil(roomT));
        return votes.has(p.id) ? `Voted ✓ · starts in ${s}s` : `Waiting room · starts in ${s}s`;
      }
      if (phase === 'over') return result ? result.text : '';
      const mm = memberOf(p);
      if (!mm) return 'Match in progress — you’re in the next one';
      switch (phase) {
        case 'intro': return doubles ? `Doubles — you cover the ${mm.m.lane > 0 ? 'left' : 'right'} side` : 'Get ready!';
        case 'serve': return serverInfo().m === mm.m ? 'Your serve — swing!' : 'Get ready…';
        case 'rally':
          if (!ball) return '';
          if (ball.receiver === mm.m) return 'Swing when the ball reaches you!';
          if (ball.hitter !== mm.s) return 'Partner’s ball';
          return 'Nice — get ready';
        case 'point': return TENNIS ? tennisCall() : `${sides[mm.s].score} – ${sides[1 - mm.s].score}`;
      }
      return '';
    },

    resize() { if (renderer) renderer.setSize(hub.W, hub.H, false); },

    update(dt) {
      dt *= slowMo;
      clock += dt;
      for (const sd of sides) for (const m of sd.members) m.swingT = Math.max(0, m.swingT - dt);
      for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > popups[i].life) popups.splice(i, 1); }
      if (banner) { banner.t += dt; if (banner.t > banner.life) banner = null; }

      if (phase === 'room') {
        const n = hub.players.size;
        if (!n) { roomT = ROOM_TIME; votes.clear(); return; }
        roomT -= dt;
        const allVoted = [...hub.players.keys()].every((id) => votes.has(id));
        if (allVoted || roomT <= 0) startMatch();
        return;
      }
      if (phase === 'intro') {
        phaseT -= dt;
        if (phaseT <= 0) startServe();
      } else if (phase === 'serve') {
        phaseT += dt;
        const { s, m } = serverInfo();
        if (pendingServe) {
          if (clock >= pendingServe.at) { const ps = pendingServe; pendingServe = null; serve(ps.power, ps.dir); }
        } else if (m.cpu && phaseT > 1.3) serveSwing(s, m, 0.45 + Math.random() * 0.25, { x: 0, y: 0 });
        else if (!m.cpu && phaseT > 8) serveSwing(s, m, 0.35, { x: 0, y: 0 }); // auto-serve so nobody stalls
      } else if (phase === 'rally' && ball) {
        ball.t += dt;
        const rs = 1 - ball.hitter;
        if (ball.net && ball.t >= ball.Tn) { point(rs, 'Net!'); return; }
        if (!ball.bounced && ball.t >= ball.Tb) {
          ball.bounced = true;
          if (ball.out) { point(rs, ball.long ? 'Long!' : 'Out!'); return; }
        }
        const u = ball.contact.t - ball.t;
        // the AI swings at its chosen moment, or in good time when it has to stretch for it
        const far = (m) => Math.hypot(toX(m.py) - toX(ball.contact.y), lineN(rs) * C.line * m.px - toZ(ball.contact.x)) - speedLimit() * u > STEP;
        if (cpuPlan && !cpuPlan.done && (u <= cpuPlan.u || (u <= 0.24 && ball.receiver && far(ball.receiver)))) {
          cpuPlan.done = true;
          const r = ball.receiver;
          if (r && !r.hit && clock >= r.down) {
            if (!cpuPlan.miss) planHit(rs, r, cpuPlan.power, u, cpuPlan.dir);
            else whiff(r);
          }
        }
        // Strokes land when the ball gets to the racket (a hit replaces the ball).
        for (const m of sides[rs].members) {
          if (m.hit && ball.hitter !== rs && ball.t >= m.hit.at) finishHit(rs, m);
        }
        const r = ball.receiver;
        if (!(r && r.hit) && ball.t > ball.contact.t - LATE_LIMIT + 0.15 + lagOf(r)) point(ball.hitter, `${r ? r.name : 'Someone'} missed`);
      } else if (phase === 'point') {
        if (ball) ball.t += dt;
        phaseT -= dt;
        if (phaseT <= 0) {
          if (result) {
            phase = 'over';
            phaseT = 6;
            ball = null;
            celebrate(result.w, 'victory');
            celebrate(1 - result.w, 'defeat');
            for (const m of sides[result.w].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 300);
          } else {
            startServe();
          }
        }
      } else if (phase === 'over') {
        phaseT -= dt;
        if (phaseT <= 0) {
          if (demo && !hub.players.size) startMatch(); // AI demo: next match
          else toRoom();
        }
      }

      // Players run to where they will meet the ball (the receiver) or back to their
      // spot, no faster than the speed limit, so placement wins points. The phone's
      // tilt (or the stick) moves the spot up to half a court closer to the net or
      // further back. A stroke under way steers the body itself (approach); a diver
      // slides to a stop and stays down a moment.
      const vmax = speedLimit();
      for (let s = 0; s < 2; s++) {
        for (const m of sides[s].members) {
          const p = m.cpu ? null : hub.players.get(m.id);
          const want = p ? -clamp(hub.dir(p).y, -1, 1) : 0;   // + = toward the net
          m.bias += (want * 0.45 - m.bias) * Math.min(1, dt * 2);
          if (clock < m.down) {
            if (m.slide) {
              const k = clamp((clock - m.slide.t0) / m.slide.dur, 0, 1), e = 1 - (1 - k) * (1 - k);
              setRoot(m, s, { x: m.slide.from.x + (m.slide.to.x - m.slide.from.x) * e, z: m.slide.from.z + (m.slide.to.z - m.slide.from.z) * e });
            }
            m.vl = 0;
            continue;
          }
          m.slide = null;
          if (phase === 'rally' && ball && m.hit) { approach(s, m, dt); continue; }
          let ty = m.lane * 0.5 * leftSign(s), tx = clamp(1 - m.bias, 0.45, 1.3);
          if (phase === 'rally' && ball && ball.receiver === m && !ball.net && !ball.out) {
            // to the contact point; for an overhead, where the smash's racket gets there
            const c = ball.contact, a = c.kind === 'over' ? offW(m, s, 'swing') : null, b = a && offW(m, s, 'smash');
            ty = clamp(c.y + (a ? (a.x - b.x) / halfW() : 0), -1.4, 1.4);
            tx = clamp((c.x + (a ? (a.z - b.z) / C.line : 0)) * lineN(s), 0.25, DEEPEST);
          } else if (phase === 'serve' && serverInfo().m === m) { ty = m.py; tx = 1; }
          else if (phase === 'rally' && ball && ball.hitter === s && sides[s].members.length === 1) ty = ball.land.y * 0.25;
          const vy = clamp((ty - m.py) * cfg.moveRate, -vmax / halfW(), vmax / halfW());
          const vz = clamp((tx - m.px) * cfg.moveRate, -vmax / C.line, vmax / C.line);
          m.py += vy * dt;
          m.px += vz * dt;
          m.vl = vy * halfW() * leftSign(s);   // m/s toward the player's left (returnShot)
        }
      }
    },

    draw(ctx, time) {
      const { W, H } = hub;
      ctx.clearRect(0, 0, W, H);
      const dt = Math.min(0.1, (time - lastFrame) / 1000) * slowMo;
      lastFrame = time;
      if (!renderer) {
        ctx.fillStyle = cfg.sky;
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(30,30,36,0.7)';
        ctx.font = hub.font(600, 18);
        ctx.fillText(loadError || `Setting up the ${cfg.place}… ${Math.round(loadP * 100)}%`, centerX(), H / 2);
        return;
      }
      updateScene(dt, time);
      const vs = views();
      renderer.setScissorTest(true);
      for (const v of vs) {
        renderer.setViewport(v.x, 0, v.w, H);
        renderer.setScissor(v.x, 0, v.w, H);
        v.cam.aspect = v.w / H;
        v.cam.fov = v.cam.aspect < 1.1 ? cfg.cam.fov * 1.3 : cfg.cam.fov;
        v.cam.updateProjectionMatrix();
        renderer.render(scene, v.cam);
      }
      renderer.setScissorTest(false);
      ctx.textBaseline = 'middle';
      if (phase === 'room') drawRoom(ctx);
      else drawHud(ctx, vs);
    },

    _fastForward: (sec) => { roomT -= sec; },
    // Test hooks: put a player somewhere (spot: py across, px deep), and play a shot
    // from side s's contact line ({ s, y, depth, kind: 'drive' | 'lob' | 'smash' |
    // 'pop', power }), as if that side had struck it.
    _place: (i, py, px) => { const m = [...sides[0].members, ...sides[1].members][i]; if (m) { m.py = py; m.px = px; m.hit = null; m.down = 0; m.slide = null; } },
    _slow: (k) => { slowMo = k; },
    _flight: () => ball && ball.segs.map((sg) => Object.fromEntries(Object.entries(sg).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]))),
    _shot: ({ s = 1, y = 0, depth = 0.8, kind = 'drive', power = 0.6, x = 0 } = {}) => {
      const m = sides[s].members[0];
      if (!m || phase === 'room') return false;
      phase = 'rally';
      pendingServe = null;
      const from = { x: toX(x), z: lineN(s) * C.line, h: strikeH(m) };
      const speed = (2 * C.line) / (cfg.shotT - power * cfg.shotTP);
      const how = kind === 'lob' ? { apex: PH.lob[1], spin: PH.topspin * 0.3, clear: 0.5 }
        : kind === 'pop' ? { apex: PH.pop, spin: -PH.topspin * 0.3, clear: 0.3 }
          : kind === 'smash' ? { speed: speed * PH.smash, spin: PH.topspin * 0.5, clear: 0.06 }
            : { speed, spin: PH.topspin * (0.35 + 0.65 * power), clear: PH.clear * (1.1 - 0.6 * power) };
      strike(s, m, from, y, depth, { ...how, kind, power });
      return { contact: ball.contact, receiver: ball.receiver && ball.receiver.name, apex: +ball.apex.toFixed(2) };
    },
    _forceStart: () => forceStart(),
    _toggleSeat: (i) => toggleSeat(i),
    _lineup: () => lineup().map((x) => (x ? (x.human ? x.human.name : 'AI') : 'closed')),
    _debug: () => ({
      phase, roomT: Math.round(roomT * 10) / 10, votes: votes.size, doubles, demo,
      teams: sides.map((sd) => sd.members.map((m) => (m.cpu ? 'AI:' : '') + m.name)),
      scores: [sides[0].score, sides[1].score], games: [sides[0].games, sides[1].games], rally,
      views: renderer ? views().length : 0,
      ball: ball && { t: ball.t, T: ball.T, u: ball.contact.t - ball.t, hitter: ball.hitter, out: ball.out, net: ball.net, kind: ball.kind, land: ball.land, contact: ball.contact, receiver: ball.receiver && ball.receiver.name, apex: ball.apex, pos: ballAt(ball.t) },
      players: sides.flatMap((sd) => sd.members.map((m) => ({ name: m.name, py: +m.py.toFixed(2), px: +m.px.toFixed(2), stroke: m.hit ? m.hit.clip : null, down: clock < m.down }))),
      hits: hitLog.slice(),
      clock,
      server: phase === 'serve' ? serverInfo().m.name : null,
      call: TENNIS ? tennisCall() : null,
      looks: [...memberObjs.values()].map((o) => (o.ch ? `${o.ch.id}:${o.ch.overlay ? o.ch.overlay.name : 'moving'}` : 'chibi')),
      objs: [...memberObjs.values()].map((o) => o.root.position.toArray().map((v) => +v.toFixed(2)).concat([+o.root.rotation.y.toFixed(2), o.root.visible, o.root.parent ? 1 : 0])),
    }),
  };
}

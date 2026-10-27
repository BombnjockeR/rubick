// Shared engine for racket sports (Tennis, Table Tennis): swing your phone.
//
// Flow: waiting room (60s, up to 4 seats, vote to start) -> match -> back to room.
// 1-2 players play singles, 3-4 play doubles; AI fills any empty seat and takes
// over for anyone who leaves mid-match.
//
// Your character runs to the ball by itself (like Wii/Switch Sports). You only
// time the swing: WHEN you swing aims the ball (early = to your left, late = to
// your right, way off = out) and HOW HARD you swing sets the speed.
//
// World units are meters (three.js, Y up). The court's long axis is Z with the
// net at z = 0; side 0 plays from -Z, side 1 from +Z. The sim uses normalized
// coords: nx -1..1 along the court (contact line to contact line), ny -1..1
// across the playing width.
window.RubickRacket = {
  define(cfg) {
    RubickGames.register({
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
  const EARLY_LIMIT = 0.40;  // swing earlier than this (s before contact) = whiff
  const LATE_LIMIT = -0.16;  // ball is past you after this = missed
  const IDEAL = 0.08;        // perfect timing (a touch early covers network lag)
  const SPAN = 0.24;         // timing distance that maps to full left/right aim
  const BOUNCE = 0.75;       // fraction of the flight where the ball bounces
  const SWING = 0.3;         // swing animation length (s)

  const C = cfg.court;       // { line, halfW, halfWDoubles, surface, onSurface(x,z) }
  const A = cfg.arc;         // { contact, peak, peak2 }
  const CPU_COLORS = ['#ced4da', '#adb5bd'];

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
    roomT = ROOM_TIME;
    votes.clear();
    sides = [newSide(), newSide()];
    ball = null;
    cpuPlan = null;
    result = null;
    clearMembers3D();
    hub.showLobby(true);
    hub.refreshRoster();
  }

  function makeMember(p, s, i) {
    return p
      ? { id: p.id, cpu: false, name: p.name, color: p.color, lane: 0, py: 0, swingT: 0, side: s, vx: 0, run: 0 }
      : { id: `cpu${s}${i}`, cpu: true, name: 'CPU', color: CPU_COLORS[i % 2], lane: 0, py: 0, swingT: 0, side: s, vx: 0, run: 0 };
  }

  function startMatch() {
    const humans = [...hub.players.values()].sort((a, b) => a.slot - b.slot).slice(0, SEATS);
    doubles = humans.length >= 3;
    sides = [newSide(), newSide()];
    if (doubles) {
      sides[0].members = [makeMember(humans[0], 0, 0), makeMember(humans[2], 0, 1)];
      sides[1].members = [makeMember(humans[1], 1, 0), makeMember(humans[3], 1, 1)];
    } else {
      sides[0].members = [makeMember(humans[0], 0, 0)];
      sides[1].members = [makeMember(humans[1], 1, 0)];
    }
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
    banner = { text: `${teamName(0)}  vs  ${teamName(1)}`, sub: (doubles ? 'Doubles' : 'Singles') + ' · ' + cfg.matchLabel, t: 0, life: 2.6 };
    buildMembers3D();
    hub.showLobby(false);
    for (const p of hub.players.values()) hub.rumble(p, 40);
    hub.refreshRoster();
  }

  function startServe() {
    phase = 'serve';
    phaseT = 0;
    ball = null;
    cpuPlan = null;
    rally = 0;
    trailReset();
  }

  function point(winner, reason) {
    const { text, matchOver } = award(winner, reason);
    phase = 'point';
    phaseT = 1.7;
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

  // ---------- Shots ----------
  function launch(s, m, fromY, aimY, T, power) {
    const toY = fromY + (aimY - fromY) / BOUNCE; // so the bounce lands at aimY
    ball = { fromX: lineN(s), fromY, toX: lineN(1 - s), toY, t: 0, T, hitter: s, color: m.color, out: Math.abs(aimY) > 1, bounced: false, power };
    ball.receiver = receiverOf(1 - s, toY);
    cpuPlan = null;
    if (ball.receiver && ball.receiver.cpu && !ball.out) {
      const miss = 0.05 + Math.max(0, cfg.cpuHard - T) * 0.7 + rally * 0.012;
      cpuPlan = { u: IDEAL + (Math.random() - 0.5) * 0.3, miss: Math.random() < miss, power: 0.35 + Math.random() * 0.45, done: false };
    }
    trailReset();
  }

  function serve(power) {
    const { s, m } = serverInfo();
    const aimY = Math.max(-0.85, Math.min(0.85, (Math.random() - 0.5) * 1.4));
    launch(s, m, m.py, aimY, cfg.serveT - power * cfg.serveTP, power);
    phase = 'rally';
    m.swingT = SWING;
    if (!m.cpu) hub.rumble(hub.players.get(m.id), 25);
  }

  function returnShot(s, m, power, u) {
    const offset = Math.max(-1, Math.min(1, (u - IDEAL) / SPAN)); // + early, − late
    const aimY = leftSign(s) * offset * 1.15 + (Math.random() - 0.5) * 0.15;
    const speedUp = Math.max(0.72, 1 - rally * 0.025);
    const fromY = ballNorm().y;
    rally++;
    launch(s, m, fromY, aimY, (cfg.shotT - power * cfg.shotTP) * speedUp, power);
    m.swingT = SWING;
    if (!m.cpu) hub.rumble(hub.players.get(m.id), power > 0.85 ? 70 : 35);
    if (power > 0.85) popup('SMASH!', s, m.color);
    else if (Math.abs(offset) < 0.25) popup('Perfect', s, m.color, 0.7);
  }

  // Remote players see the game as video (~0.15-0.2s behind) and their swing
  // takes half a ping to arrive; judge them on what they actually saw.
  function lagOf(m) {
    if (!m || m.cpu) return 0;
    const p = hub.players.get(m.id);
    if (!p || !p.remote) return 0;
    const oneWay = (p.rtt == null ? 120 : p.rtt) / 2000;
    return Math.max(0, Math.min(0.45, 0.18 + oneWay));
  }

  function swingBy(s, m, power) {
    if (m.swingT <= 0) m.swingT = SWING;
    if (phase === 'serve') {
      const sv = serverInfo();
      if (sv.m === m && phaseT > 0.35) serve(power);
      return;
    }
    if (phase !== 'rally' || !ball || ball.hitter === s || ball.out) return;
    if (ball.receiver !== m) { popup('Partner’s ball', s, '#adb5bd', 0.6, 0.8); return; }
    const u = (1 - ball.t) * ball.T + lagOf(m);
    if (u > EARLY_LIMIT) { popup('Too early', s, '#adb5bd', 0.6, 0.8); return; }
    if (u < LATE_LIMIT) return;
    returnShot(s, m, power, u);
  }

  function toggleVote(p) {
    if (phase !== 'room') return;
    if (votes.has(p.id)) votes.delete(p.id); else votes.add(p.id);
    hub.rumble(p, votes.has(p.id) ? 40 : 15);
    hub.refreshRoster();
  }

  // Ball in normalized coords; h = height above the playing surface (meters)
  function ballNorm() {
    if (!ball) return { x: 0, y: 0, h: 0 };
    const t = ball.t;
    const x = ball.fromX + (ball.toX - ball.fromX) * t;
    const y = ball.fromY + (ball.toY - ball.fromY) * t;
    let h;
    if (t < BOUNCE) { const s = t / BOUNCE; h = A.contact * (1 - s) + 4 * A.peak * s * (1 - s); }
    else { const s = Math.min(t, 1.6) - BOUNCE; const k = s / (1 - BOUNCE); h = A.contact * k + 4 * A.peak2 * k * (1 - k); }
    return { x, y, h };
  }

  function ballWorld() {
    if (phase === 'serve') {
      const { s, m } = serverInfo();
      const o = memberObjs.get(m);
      const z = toZ(lineN(s));
      const toss = Math.abs(Math.sin(performance.now() / 300));
      const x = o ? o.root.position.x + (s === 0 ? 1 : -1) * cfg.reach * 0.35 : toX(m.py);
      return { x, y: C.surface + A.contact * (1 + toss * 1.1), z: z + (s === 0 ? 1 : -1) * 0.2 };
    }
    if (!ball) return null;
    const n = ballNorm();
    const x = toX(n.y), z = toZ(n.x);
    const surf = C.onSurface(x, z) && !(ball.out && ball.t > BOUNCE) ? C.surface : 0;
    let y = C.surface + n.h;
    if (ball.out && ball.t > BOUNCE) {
      const dtS = (ball.t - BOUNCE) * ball.T;  // flies off and drops to the floor
      y = C.surface + A.contact * 0.4 + 2.5 * dtS - 4.9 * dtS * dtS;
    } else if (ball.t > 1) {
      const dtS = (ball.t - 1) * ball.T;
      y = C.surface + A.contact - 4.9 * dtS * dtS;
    }
    return { x, y: Math.max(surf + cfg.ballR, y), z };
  }

  // =====================================================================
  // 3D
  // =====================================================================
  let renderer = null, scene = null, loadError = null, loadP = 0;
  let template = null;
  const cams = [];
  let orbitCam = null;
  const camState = [null, null];
  let ballMesh, blob, ring;
  const trail = [];
  const memberObjs = new Map(); // member -> { root, armR, armL, legL, legR, head, tag, phase }
  let lastFrame = performance.now();

  function canvasTexture(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paint(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function setup(env, chars) {
    renderer = Kit3D.renderer(hub);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(cfg.sky);
    scene.fog = new THREE.Fog(cfg.sky, cfg.fog[0], cfg.fog[1]);
    scene.add(env.scene);
    Kit3D.lights(scene, { size: cfg.shadowSize, target: [0, 0, 0], sun: cfg.sun });
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
    for (const o of memberObjs.values()) if (scene) scene.remove(o.root);
    memberObjs.clear();
  }

  const HAIR = ['#4a2c1d', '#2b1d16', '#7a4a2a', '#c58b4a', '#3a3a46'];

  function buildMembers3D() {
    if (!scene || !template) return;
    clearMembers3D();
    let i = 0;
    for (let s = 0; s < 2; s++) {
      for (const m of sides[s].members) {
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

  function poseMember(m, s, o, dt) {
    const dirZ = lineN(s);
    // Stand so the racket (held out to the side) meets the ball.
    const x = toX(m.py) - (s === 0 ? 1 : -1) * cfg.reach;
    const prevX = o.root.position.x;
    o.root.position.set(x, 0, dirZ * (C.line + cfg.standBack));
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
      const u = (1 - ball.t) * ball.T;
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
    for (let s = 0; s < 2; s++) for (const m of sides[s].members) {
      const o = memberObjs.get(m);
      if (o) poseMember(m, s, o, dt);
    }

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
    if (phase === 'rally' && ball && !ball.out && ball.receiver) {
      const u = (1 - ball.t) * ball.T;
      if (u < 0.6 && u > LATE_LIMIT) {
        const k = u <= EARLY_LIMIT ? 1 - Math.min(1, Math.abs(u - IDEAL) / 0.3) : 0.15;
        const rs = 1 - ball.hitter;
        ring.position.set(toX(ball.toY), C.surface + A.contact, toZ(lineN(rs)));
        ring.rotation.set(0, 0, 0);
        ring.scale.setScalar(1.6 - k * 0.6);
        ring.material.color.set(ball.receiver.color);
        ring.material.opacity = 0.25 + k * 0.7;
      }
    }

    // Chase cameras: behind each team, drifting with the ball
    const ease = 1 - Math.exp(-dt * 3);
    for (let s = 0; s < 2; s++) {
      const dir = lineN(s);
      const b = bw && phase !== 'room' && phase !== 'over' ? bw : null;
      const bx = b ? b.x : 0;
      const near = b ? Math.max(0, Math.min(1, (b.z * dir + C.line) / (2 * C.line))) : 0.3;
      const want = new THREE.Vector3(bx * cfg.cam.follow, cfg.cam.height + near * cfg.cam.rise, dir * (C.line + cfg.cam.back - near * cfg.cam.push));
      const look = new THREE.Vector3(bx * cfg.cam.follow * 0.9, cfg.cam.lookY + (b ? (b.y - C.surface) * 0.2 : 0), dir * C.line * (cfg.cam.ahead + near * cfg.cam.track));
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
    const { H } = hub;
    const players = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
    const seated = players.slice(0, SEATS);
    const cx = centerX();
    const cw = Math.min(620, hub.W - 360 - 40 > 420 ? hub.W - 380 : hub.W - 40);
    const ch = 380;
    const x0 = cx - cw / 2, y0 = H / 2 - ch / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    rr(ctx, x0, y0, cw, ch, 24); ctx.fill();
    ctx.restore();
    ctx.fillStyle = cfg.color;
    rr(ctx, x0, y0, cw, 8, [24, 24, 0, 0]); ctx.fill();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = cfg.color;
    ctx.font = hub.font(800, 30);
    ctx.fillText(cfg.name.toUpperCase(), cx, y0 + 46);
    ctx.fillStyle = '#6b665e';
    ctx.font = hub.font(500, 14);
    const mode = seated.length >= 3 ? 'Doubles · 2 vs 2' : 'Singles · 1 vs 1';
    ctx.fillText(players.length ? `${mode} · ${cfg.matchLabel} · AI fills empty seats` : 'Scan the QR code to join', cx, y0 + 76);

    const secs = players.length ? Math.max(0, Math.ceil(roomT)) : ROOM_TIME;
    ctx.fillStyle = '#222';
    ctx.font = hub.font(800, 54);
    ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, cx, y0 + 132);
    ctx.fillStyle = '#8a8378';
    ctx.font = hub.font(500, 13);
    ctx.fillText(players.length ? 'until the match starts' : 'waiting for the first player', cx, y0 + 166);

    const gap = 10;
    const sw = (cw - 48 - gap * (SEATS - 1)) / SEATS;
    const sy = y0 + 192, sh = 104;
    for (let i = 0; i < SEATS; i++) {
      const sx = x0 + 24 + i * (sw + gap);
      const p = seated[i];
      if (p) {
        ctx.fillStyle = '#f3efe8';
        rr(ctx, sx, sy, sw, sh, 14); ctx.fill();
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx + sw / 2, sy + 30, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = hub.font(700, 15);
        ctx.fillText(p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name, sx + sw / 2, sy + 60);
        const voted = votes.has(p.id);
        ctx.fillStyle = voted ? '#1fae4b' : '#9a9286';
        ctx.font = hub.font(600, 12);
        ctx.fillText(voted ? '✓ voted' : 'not voted', sx + sw / 2, sy + 84);
      } else {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#d6cfc4';
        rr(ctx, sx + 0.5, sy + 0.5, sw - 1, sh - 1, 14); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#a39c90';
        ctx.font = hub.font(700, 14);
        ctx.fillText('AI', sx + sw / 2, sy + 42);
        ctx.font = hub.font(500, 11);
        ctx.fillText('open seat', sx + sw / 2, sy + 64);
      }
    }
    ctx.fillStyle = '#5d584f';
    ctx.font = hub.font(500, 14);
    const need = players.length - [...votes].filter((id) => hub.players.has(id)).length;
    const line = !players.length ? 'Up to 4 players. Hold your phone like a racket.'
      : need > 0 ? `Tap “Vote to start” on your phone · ${need} more vote${need > 1 ? 's' : ''} to start now`
        : 'Starting…';
    ctx.fillText(line, cx, y0 + ch - 34);
    if (players.length > SEATS) {
      ctx.fillStyle = '#9a9286';
      ctx.font = hub.font(500, 12);
      ctx.fillText(`${players.length - SEATS} watching — they’ll get the next match`, cx, y0 + ch - 14);
    }
  }

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
      ctx.fillText(`Back to the waiting room in ${Math.ceil(phaseT)}…`, W / 2, H / 2 + 50);
    }
  }

  // =====================================================================
  // Game interface
  // =====================================================================
  let stopped = false;
  Promise.all([Kit3D.load(cfg.env, (p) => { loadP = p; }), Kit3D.load('assets/characters.glb')])
    .then(([env, chars]) => {
      if (stopped) return;
      try { setup(env, chars); } catch (e) { loadError = '3D isn’t supported on this browser'; console.error(e); }
    })
    .catch((e) => { loadError = 'Couldn’t load the ' + cfg.name + ' assets'; console.error(e); });

  return {
    start() { toRoom(); },

    stop() {
      stopped = true;
      hub.showLobby(true);
      clearMembers3D();
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
        else if (ball && ball.receiver === mm.m && !ball.out) cpuPlan = { u: IDEAL, miss: false, power: 0.5, done: false };
      }
      hub.refreshRoster();
    },

    swing(p, power) {
      const mm = memberOf(p);
      if (mm) swingBy(mm.s, mm.m, power);
    },

    press(p, bits) {
      if (!(bits & B.A)) return;
      if (phase === 'room') toggleVote(p);
      else this.swing(p, 0.6); // gamepad / keyboard fallback
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
        const { m } = serverInfo();
        if (m.cpu && phaseT > 1.3) serve(0.45 + Math.random() * 0.25);
        else if (!m.cpu && phaseT > 8) serve(0.35); // auto-serve so nobody stalls
      } else if (phase === 'rally' && ball) {
        ball.t += dt / ball.T;
        const u = (1 - ball.t) * ball.T;
        const rs = 1 - ball.hitter;
        if (!ball.bounced && ball.t >= BOUNCE) {
          ball.bounced = true;
          if (ball.out) { point(rs, 'Out!'); return; }
        }
        if (cpuPlan && !cpuPlan.done && u <= cpuPlan.u) {
          cpuPlan.done = true;
          if (!cpuPlan.miss && ball.receiver) returnShot(rs, ball.receiver, cpuPlan.power, u);
          else if (ball.receiver) ball.receiver.swingT = SWING;
        }
        if (ball && ball.hitter !== rs && u < LATE_LIMIT - lagOf(ball.receiver)) point(ball.hitter, `${ball.receiver ? ball.receiver.name : 'Someone'} missed`);
      } else if (phase === 'point') {
        if (ball) ball.t += dt / ball.T;
        phaseT -= dt;
        if (phaseT <= 0) {
          if (result) {
            phase = 'over';
            phaseT = 6;
            ball = null;
            for (const m of sides[result.w].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 300);
          } else {
            startServe();
          }
        }
      } else if (phase === 'over') {
        phaseT -= dt;
        if (phaseT <= 0) toRoom();
      }

      // Players glide toward where the ball will arrive (receiver) or home.
      for (let s = 0; s < 2; s++) {
        for (const m of sides[s].members) {
          let target = m.lane * 0.5 * leftSign(s);
          if (phase === 'rally' && ball && ball.receiver === m) target = Math.max(-1.3, Math.min(1.3, ball.toY));
          else if (phase === 'serve' && serverInfo().m === m) target = m.py;
          else if (phase === 'rally' && ball && ball.hitter !== s && sides[s].members.length === 1) target = ball.toY * 0.3;
          const step = (target - m.py) * Math.min(1, dt * cfg.moveRate);
          m.py += Math.max(-cfg.maxStep * dt, Math.min(cfg.maxStep * dt, step));
        }
      }
    },

    draw(ctx, time) {
      const { W, H } = hub;
      ctx.clearRect(0, 0, W, H);
      const dt = Math.min(0.1, (time - lastFrame) / 1000);
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
    _debug: () => ({
      phase, roomT: Math.round(roomT * 10) / 10, votes: votes.size, doubles,
      teams: sides.map((sd) => sd.members.map((m) => (m.cpu ? 'AI:' : '') + m.name)),
      scores: [sides[0].score, sides[1].score], games: [sides[0].games, sides[1].games], rally,
      views: renderer ? views().length : 0,
      ball: ball && { t: ball.t, T: ball.T, hitter: ball.hitter, out: ball.out, receiver: ball.receiver && ball.receiver.name },
      server: phase === 'serve' ? serverInfo().m.name : null,
      call: TENNIS ? tennisCall() : null,
    }),
  };
}

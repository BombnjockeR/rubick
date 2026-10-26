// Table Tennis: swing your phone like a paddle.
//
// Flow: waiting room (60s, up to 4 seats, vote to start) -> match -> back to room.
// 1-2 players play singles, 3-4 play doubles; AI fills any empty seat and takes
// over for anyone who leaves mid-match.
//
// Your paddle follows the ball automatically (like Wii Sports). You only time
// the swing: WHEN you swing aims the ball (early = to your left, late = to your
// right, way off = out) and HOW HARD you swing sets the speed.
//
// Rendering is 3D (Three.js, loaded on demand). Each team gets a camera behind
// its end of the table that follows the ball; if both teams have humans, the
// screen splits in two.
RubickGames.register({
  id: 'pingpong',
  name: 'Table Tennis',
  blurb: 'Swing your phone like a paddle. Waiting room seats 4; AI fills empty spots. First to 5.',
  controls: 'motion',

  create(hub) {
    const B = hub.B;

    // ---------- Rules / tuning ----------
    const WIN = 5;
    const ROOM_TIME = 60;      // seconds the waiting room stays open
    const SEATS = 4;
    const EARLY_LIMIT = 0.40;  // swing earlier than this (s before contact) = whiff
    const LATE_LIMIT = -0.16;  // ball is past you after this = missed
    const IDEAL = 0.08;        // perfect timing (a touch early covers network lag)
    const SPAN = 0.24;         // timing distance that maps to full left/right aim
    const BOUNCE = 0.75;       // fraction of the flight where the ball meets the table

    // ---------- World (meters). Sim uses normalized coords: ----------
    //   nx: -1 (side 0 paddle line) .. +1 (side 1 paddle line)  -> world z
    //   ny: -1 .. +1 across the table width                        -> world x
    const HALF_L = 1.37, HALF_W = 0.7625, TABLE_H = 0.76, LINE_Z = 1.72, BALL_R = 0.03;
    const toZ = (nx) => nx * LINE_Z;
    const toX = (ny) => ny * HALF_W;

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

    function newSide() { return { score: 0, members: [] }; }
    const lineX = (s) => (s === 0 ? -1 : 1);
    const leftSign = (s) => (s === 0 ? 1 : -1); // a player's left, in world ny, seen from their end

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
      return ms.find((m) => m.lane === (arrivalY < 0 ? -1 : 1)) || ms[0];
    }

    function serverInfo() {
      const total = sides[0].score + sides[1].score;
      const s = Math.floor(total / 2) % 2;                 // serve swaps every 2 points
      const ms = sides[s].members;
      const m = ms[Math.floor(total / 4) % Math.max(1, ms.length)]; // partners alternate
      return { s, m };
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
        ? { id: p.id, cpu: false, name: p.name, color: p.color, lane: 0, py: 0, swingT: 0, side: s }
        : { id: `cpu${s}${i}`, cpu: true, name: s === 1 && i === 0 ? 'CPU' : `CPU ${s * 2 + i}`, color: CPU_COLORS[i % 2], lane: 0, py: 0, swingT: 0, side: s };
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
        for (const m of sd.members) m.py = m.lane * 0.5;
      }
      // Rename AI so doubles reads well ("CPU 1", "CPU 2")
      let n = 0;
      for (const sd of sides) for (const m of sd.members) if (m.cpu) m.name = `CPU${doubles ? ' ' + (++n) : ''}`;

      votes.clear();
      rally = 0;
      phase = 'intro';
      phaseT = 2.6;
      banner = { text: `${teamName(0)}  vs  ${teamName(1)}`, sub: doubles ? 'Doubles' : 'Singles', t: 0, life: 2.6 };
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
      sides[winner].score++;
      phase = 'point';
      phaseT = 1.5;
      popup(reason, null, '#ffffff', 1.5, 1.4);
      for (const m of sides[winner].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 60);
      for (const m of sides[1 - winner].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 160);
      hub.refreshRoster();
    }

    function popup(text, side, color, life = 0.9, scale = 1) {
      popups.push({ text, side, color, t: 0, life, scale });
    }

    // ---------- Shots ----------
    function launch(s, m, fromY, aimY, T, power) {
      const toY = fromY + (aimY - fromY) / BOUNCE; // so the bounce lands at aimY
      ball = { fromX: lineX(s), fromY, toX: lineX(1 - s), toY, t: 0, T, hitter: s, color: m.color, out: Math.abs(aimY) > 1, bounced: false, power };
      ball.receiver = receiverOf(1 - s, toY);
      cpuPlan = null;
      if (ball.receiver && ball.receiver.cpu && !ball.out) {
        const miss = 0.06 + Math.max(0, 0.75 - T) * 0.7 + rally * 0.012;
        cpuPlan = { u: IDEAL + (Math.random() - 0.5) * 0.3, miss: Math.random() < miss, power: 0.35 + Math.random() * 0.4, done: false };
      }
      trailReset();
    }

    function serve(power) {
      const { s, m } = serverInfo();
      const offset = (Math.random() - 0.5) * 0.8;
      const aimY = Math.max(-0.85, Math.min(0.85, leftSign(s) * offset * 0.8));
      launch(s, m, m.py, aimY, 1.5 - power * 0.6, power);
      phase = 'rally';
      m.swingT = 0.25;
      if (!m.cpu) hub.rumble(hub.players.get(m.id), 25);
    }

    function returnShot(s, m, power, u) {
      const offset = Math.max(-1, Math.min(1, (u - IDEAL) / SPAN)); // + early, − late
      const aimY = leftSign(s) * offset * 1.15 + (Math.random() - 0.5) * 0.15;
      const speedUp = Math.max(0.72, 1 - rally * 0.025);
      const fromY = ballNorm().y;
      rally++;
      launch(s, m, fromY, aimY, (1.35 - power * 0.73) * speedUp, power);
      m.swingT = 0.25;
      if (!m.cpu) hub.rumble(hub.players.get(m.id), power > 0.85 ? 70 : 35);
      if (power > 0.85) popup('SMASH!', s, m.color);
      else if (Math.abs(offset) < 0.25) popup('Perfect', s, m.color, 0.7);
    }

    // Remote players see the game as video (~0.15-0.2s behind) and their swing
    // takes half a ping to arrive. Shift their timing window by that much so
    // they're judged on what they actually saw.
    function lagOf(m) {
      if (!m || m.cpu) return 0;
      const p = hub.players.get(m.id);
      if (!p || !p.remote) return 0;
      const oneWay = (p.rtt == null ? 120 : p.rtt) / 2000;
      return Math.max(0, Math.min(0.45, 0.18 + oneWay));
    }

    function swingBy(s, m, power) {
      m.swingT = Math.max(m.swingT, 0.2);
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

    // Ball position in normalized coords + arc height (0 = table surface)
    function ballNorm() {
      if (!ball) return { x: 0, y: 0, z: 0 };
      const t = ball.t;
      const x = ball.fromX + (ball.toX - ball.fromX) * t;
      const y = ball.fromY + (ball.toY - ball.fromY) * t;
      let z;
      if (t < BOUNCE) { const s = t / BOUNCE; z = 0.3 * (1 - s) + 1.1 * s * (1 - s); }
      else { const s = (t - BOUNCE) / (1 - BOUNCE); z = 0.3 * Math.min(s, 1) + 0.8 * Math.min(s, 1) * (1 - Math.min(s, 1)); }
      return { x, y, z };
    }

    // Ball position in world meters, including falling off the table.
    function ballWorld() {
      if (phase === 'serve') {
        const { s, m } = serverInfo();
        const dir = s === 0 ? 1 : -1;
        return { x: toX(m.py), y: 0.98 + Math.abs(Math.sin(performance.now() / 280)) * 0.18, z: toZ(lineX(s)) + dir * 0.18 };
      }
      if (!ball) return null;
      const n = ballNorm();
      const x = toX(n.y), z = toZ(n.x);
      let y = TABLE_H + BALL_R + n.z * 0.55;
      const onTable = Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_L;
      const g = 9.8;
      if (ball.out && ball.t > BOUNCE) {
        const dtS = (ball.t - BOUNCE) * ball.T;
        y = TABLE_H + BALL_R + 1.0 * dtS - 0.5 * g * dtS * dtS; // bounced off the edge, falls to the floor
      } else if (ball.t > 1) {
        const dtS = (ball.t - 1) * ball.T;
        y -= 0.5 * g * dtS * dtS;
      }
      const floor = onTable && !ball.out ? TABLE_H + BALL_R : BALL_R;
      return { x, y: Math.max(floor, y), z };
    }

    // =====================================================================
    // 3D rendering (Three.js)
    // =====================================================================
    let T3 = null;             // THREE namespace once loaded
    let renderer = null, scene = null, glCanvas = null;
    let loadError = null;
    const cams = [];           // per-side follow cameras
    let orbitCam = null;
    const camState = [null, null];
    let ballMesh, blob, ring;
    const trail = [];
    const memberObjs = new Map(); // member -> { paddle, body }
    let lastFrame = performance.now();

    function loadThree() {
      if (window.THREE) return Promise.resolve(window.THREE);
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL('vendor/three.rubick.min.js', window.location.href).href;
        s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error('THREE missing')));
        s.onerror = () => reject(new Error('Could not load 3D engine'));
        document.head.append(s);
      });
    }

    function canvasTexture(w, h, paint) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      paint(c.getContext('2d'), w, h);
      const tex = new T3.CanvasTexture(c);
      tex.colorSpace = T3.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    }

    function buildScene() {
      const T = T3;
      glCanvas = document.createElement('canvas');
      glCanvas.className = 'gl-layer';
      Object.assign(glCanvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', display: 'block', pointerEvents: 'none' });
      const arena = document.querySelector('#arena');
      arena.parentNode.insertBefore(glCanvas, arena);

      renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(hub.W, hub.H, false);
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;

      scene = new T.Scene();
      scene.background = new T.Color('#8ecae6');
      scene.fog = new T.Fog('#8ecae6', 16, 42);

      scene.add(new T.HemisphereLight('#ffffff', '#3f6e35', 1.15));
      const sun = new T.DirectionalLight('#fff3df', 2.1);
      sun.position.set(2.5, 7, 3.5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
      sun.shadow.bias = -0.0004;
      sun.shadow.camera.layers.enableAll();
      scene.add(sun);

      // Turf with mowing stripes
      const turf = canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#5da94f'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#67b558'; g.fillRect(0, 0, w, h / 2);
      });
      turf.wrapS = turf.wrapT = T.RepeatWrapping;
      turf.repeat.set(1, 24);
      const floor = new T.Mesh(new T.PlaneGeometry(80, 80), new T.MeshLambertMaterial({ map: turf }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);

      // Simple stadium bowl
      const wall = new T.Mesh(new T.CylinderGeometry(15, 15, 1.3, 72, 1, true), new T.MeshLambertMaterial({ color: '#244a6e', side: T.BackSide }));
      wall.position.y = 0.65;
      scene.add(wall);
      const stripe = new T.Mesh(new T.CylinderGeometry(15.02, 15.02, 0.12, 72, 1, true), new T.MeshBasicMaterial({ color: '#e9f5ff', side: T.BackSide }));
      stripe.position.y = 1.25;
      scene.add(stripe);
      const stands = new T.Mesh(new T.CylinderGeometry(24, 15, 6, 72, 1, true), new T.MeshLambertMaterial({ color: '#d8c7a4', side: T.BackSide }));
      stands.position.y = 1.3 + 3;
      scene.add(stands);
      const roof = new T.Mesh(new T.CylinderGeometry(24.5, 24.5, 1.2, 72, 1, true), new T.MeshLambertMaterial({ color: '#f1f3f5', side: T.BackSide }));
      roof.position.y = 7.6;
      scene.add(roof);

      // Table
      const top = canvasTexture(512, 920, (g, w, h) => {
        g.fillStyle = '#d4673f'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
        g.lineWidth = 5; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
      });
      const dark = new T.MeshStandardMaterial({ color: '#232834', roughness: 0.7 });
      const topMats = [dark, dark, new T.MeshStandardMaterial({ map: top, roughness: 0.55 }), dark, dark, dark];
      const tableTop = new T.Mesh(new T.BoxGeometry(HALF_W * 2, 0.035, HALF_L * 2), topMats);
      tableTop.position.y = TABLE_H - 0.0175;
      tableTop.castShadow = true;
      tableTop.receiveShadow = true;
      scene.add(tableTop);
      const skirtTex = canvasTexture(512, 32, (g, w, h) => {
        g.fillStyle = '#232834'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#e9ecef';
        g.font = '700 20px Rubik, system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('RUBICK', w / 2, h / 2 + 1);
      });
      for (const dir of [-1, 1]) {
        const skirt = new T.Mesh(new T.PlaneGeometry(HALF_W * 1.9, 0.08), new T.MeshStandardMaterial({ map: skirtTex, roughness: 0.8 }));
        skirt.position.set(0, TABLE_H - 0.075, dir * (HALF_L - 0.06));
        skirt.rotation.y = dir < 0 ? Math.PI : 0;
        scene.add(skirt);
      }
      for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
        const leg = new T.Mesh(new T.BoxGeometry(0.06, TABLE_H - 0.11, 0.06), dark);
        leg.position.set(lx * (HALF_W - 0.12), (TABLE_H - 0.11) / 2, lz * (HALF_L - 0.25));
        leg.castShadow = true;
        scene.add(leg);
      }
      for (const lz of [-1, 1]) {
        const bar = new T.Mesh(new T.BoxGeometry(HALF_W * 2 - 0.2, 0.05, 0.05), dark);
        bar.position.set(0, 0.12, lz * (HALF_L - 0.25));
        scene.add(bar);
      }

      // Net
      const netTex = canvasTexture(256, 32, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = 'rgba(235,240,245,0.85)';
        g.lineWidth = 1;
        for (let x = 0; x <= w; x += 4) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
        for (let y = 0; y <= h; y += 4) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
      });
      const net = new T.Mesh(new T.PlaneGeometry(HALF_W * 2 + 0.3, 0.1525), new T.MeshBasicMaterial({ map: netTex, transparent: true, side: T.DoubleSide, depthWrite: false }));
      net.position.set(0, TABLE_H + 0.076, 0);
      scene.add(net);
      const tape = new T.Mesh(new T.BoxGeometry(HALF_W * 2 + 0.3, 0.014, 0.012), new T.MeshStandardMaterial({ color: '#f8f9fa' }));
      tape.position.set(0, TABLE_H + 0.1525, 0);
      scene.add(tape);
      for (const px of [-1, 1]) {
        const post = new T.Mesh(new T.BoxGeometry(0.035, 0.18, 0.05), dark);
        post.position.set(px * (HALF_W + 0.15), TABLE_H + 0.08, 0);
        post.castShadow = true;
        scene.add(post);
      }

      // Ball, its blob shadow, trail, timing ring
      ballMesh = new T.Mesh(new T.SphereGeometry(BALL_R, 24, 16), new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: '#2a2a2a' }));
      ballMesh.castShadow = true;
      scene.add(ballMesh);
      blob = new T.Mesh(new T.CircleGeometry(0.045, 24), new T.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.32, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      scene.add(blob);
      const trailGeo = new T.SphereGeometry(BALL_R * 0.8, 10, 8);
      for (let i = 0; i < 14; i++) {
        const tm = new T.Mesh(trailGeo, new T.MeshBasicMaterial({ color: '#9775fa', transparent: true, opacity: 0, depthWrite: false }));
        tm.visible = false;
        scene.add(tm);
        trail.push({ mesh: tm, x: 0, y: 0, z: 0, live: false });
      }
      ring = new T.Mesh(new T.TorusGeometry(0.15, 0.009, 8, 48), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      scene.add(ring);

      // Cameras
      for (let s = 0; s < 2; s++) {
        const cam = new T.PerspectiveCamera(50, 1, 0.05, 80);
        cam.layers.enable(0);
        cam.layers.enable(1 + (1 - s)); // see the other team's bodies, hide your own
        cams.push(cam);
        camState[s] = { pos: new T.Vector3(0, 1.8, (s === 0 ? -1 : 1) * 4), look: new T.Vector3(0, 0.7, 0) };
      }
      orbitCam = new T.PerspectiveCamera(46, 1, 0.05, 80);
      orbitCam.layers.enableAll();

      if (inMatch()) buildMembers3D();
    }

    function trailReset() { for (const tr of trail) { tr.live = false; if (tr.mesh) tr.mesh.visible = false; } }

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
      const sp = new T3.Sprite(new T3.SpriteMaterial({ map: tex, depthWrite: false }));
      sp.scale.set(0.8, 0.2, 1);
      return sp;
    }

    function clearMembers3D() {
      for (const o of memberObjs.values()) {
        scene && scene.remove(o.paddle, o.body);
      }
      memberObjs.clear();
    }

    function buildMembers3D() {
      if (!T3 || !scene) return;
      clearMembers3D();
      const T = T3;
      for (let s = 0; s < 2; s++) {
        for (const m of sides[s].members) {
          const color = new T.Color(m.color);
          // Paddle: blade + handle, blade faces the table
          const paddle = new T.Group();
          const blade = new T.Mesh(new T.CylinderGeometry(0.078, 0.078, 0.014, 32), new T.MeshStandardMaterial({ color, roughness: 0.6 }));
          blade.rotation.x = Math.PI / 2;
          blade.castShadow = true;
          const handle = new T.Mesh(new T.BoxGeometry(0.03, 0.11, 0.024), new T.MeshStandardMaterial({ color: '#a0744b', roughness: 0.8 }));
          handle.position.y = -0.12;
          handle.castShadow = true;
          paddle.add(blade, handle);
          scene.add(paddle);

          // Player body behind the paddle (hidden from your own camera)
          const body = new T.Group();
          const dark = color.clone().multiplyScalar(0.55);
          const torso = new T.Mesh(new T.CapsuleGeometry(0.17, 0.5, 6, 14), new T.MeshStandardMaterial({ color: dark, roughness: 0.8 }));
          torso.position.y = 0.95;
          const head = new T.Mesh(new T.SphereGeometry(0.12, 20, 16), new T.MeshStandardMaterial({ color: '#f0c8a0', roughness: 0.7 }));
          head.position.y = 1.52;
          const cap = new T.Mesh(new T.SphereGeometry(0.125, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color, roughness: 0.6 }));
          cap.position.y = 1.55;
          const tag = nameSprite(m.name, m.color);
          tag.position.y = 1.86;
          torso.castShadow = head.castShadow = true;
          body.add(torso, head, cap, tag);
          body.traverse((o) => o.layers.set(1 + s));
          scene.add(body);

          memberObjs.set(m, { paddle, body, blade });
        }
      }
    }

    function updateScene(dt, time) {
      // Paddles + bodies
      for (let s = 0; s < 2; s++) {
        const dir = s === 0 ? -1 : 1; // which end of the world this side stands at
        for (const m of sides[s].members) {
          const o = memberObjs.get(m);
          if (!o) continue;
          const sw = m.swingT > 0 ? Math.sin((1 - m.swingT / 0.25) * Math.PI) : 0;
          const x = toX(m.py);
          const z = dir * LINE_Z - dir * 0.18 * sw;
          o.paddle.position.set(x, 0.93 + sw * 0.04, z);
          o.paddle.rotation.set(0, (s === 0 ? 0 : Math.PI) + (s === 0 ? 1 : -1) * sw * 0.9 * (m.lane >= 0 ? 1 : -1), -0.25 * (s === 0 ? 1 : -1));
          const bodyX = x + (s === 0 ? 0.22 : -0.22); // stand to the left of the paddle (right-handed)
          o.body.position.set(bodyX, 0, dir * (LINE_Z + 0.32));
          o.body.rotation.y = s === 0 ? 0 : Math.PI;
        }
      }

      // Ball, blob, trail
      const bw = ballWorld();
      ballMesh.visible = !!bw && phase !== 'room' && phase !== 'over' && phase !== 'intro';
      blob.visible = ballMesh.visible;
      if (bw && ballMesh.visible) {
        ballMesh.position.set(bw.x, bw.y, bw.z);
        const onTable = Math.abs(bw.x) <= HALF_W && Math.abs(bw.z) <= HALF_L;
        const surf = onTable ? TABLE_H + 0.002 : 0.004;
        blob.position.set(bw.x, surf, bw.z);
        const hgt = Math.max(0, bw.y - surf);
        blob.scale.setScalar(1 + hgt * 1.2);
        blob.material.opacity = Math.max(0.08, 0.34 - hgt * 0.35);
      }
      // trail follows the flying ball, tinted with the hitter's color
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
        tr.mesh.scale.setScalar(1 - i / trail.length * 0.6);
      });

      // Timing ring around the receiving paddle
      ring.material.opacity = 0;
      if (phase === 'rally' && ball && !ball.out && ball.receiver) {
        const o = memberObjs.get(ball.receiver);
        const u = (1 - ball.t) * ball.T;
        if (o && u < 0.6 && u > LATE_LIMIT) {
          const k = u <= EARLY_LIMIT ? 1 - Math.min(1, Math.abs(u - IDEAL) / 0.3) : 0.15;
          ring.position.copy(o.paddle.position);
          ring.rotation.set(0, 0, 0);
          ring.scale.setScalar(1.6 - k * 0.6);
          ring.material.color.set(ball.receiver.color);
          ring.material.opacity = 0.25 + k * 0.7;
        }
      }

      // Follow cameras
      const ease = 1 - Math.exp(-dt * 3.5);
      for (let s = 0; s < 2; s++) {
        const dir = s === 0 ? -1 : 1;
        const b = bw && phase !== 'room' && phase !== 'over' ? bw : null;
        const bx = b ? b.x : 0;
        const near = b ? Math.max(0, Math.min(1, (b.z * dir + LINE_Z) / (2 * LINE_Z))) : 0.3;
        const want = new T3.Vector3(bx * 0.45, 1.78 + near * 0.08, dir * (HALF_L + 2.3 - near * 0.3));
        const look = new T3.Vector3(bx * 0.4, 0.72 + (b ? (b.y - TABLE_H) * 0.25 : 0), dir * (-0.85 + near * 1.05));
        const st = camState[s];
        if (phase === 'intro') {
          // swoop from the orbit view into position
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
      const a = time / 1000 * 0.12;
      orbitCam.position.set(Math.sin(a) * 4.6, 2.3, Math.cos(a) * 4.6);
      orbitCam.lookAt(0, 0.65, 0);
    }

    // Which camera(s) to show and where.
    function views() {
      const { W } = hub;
      if (phase === 'room' || phase === 'over') return [{ cam: orbitCam, x: 0, w: W, side: null }];
      const hs = humanSides();
      if (hs.length === 2) return [{ cam: cams[0], x: 0, w: W / 2, side: 0 }, { cam: cams[1], x: W / 2, w: W / 2, side: 1 }];
      const s = hs.length ? hs[0] : 0;
      return [{ cam: cams[s], x: 0, w: W, side: s }];
    }

    // =====================================================================
    // HUD (2D canvas on top of the 3D view)
    // =====================================================================
    function rr(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    }

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

      ctx.fillStyle = 'rgba(14,15,19,0.82)';
      rr(ctx, x0, y0, cw, ch, 22); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#4dabf7';
      ctx.font = hub.font(800, 30);
      ctx.fillText('TABLE TENNIS', cx, y0 + 42);
      ctx.fillStyle = 'rgba(244,244,245,0.6)';
      ctx.font = hub.font(500, 14);
      const mode = seated.length >= 3 ? 'Doubles · 2 vs 2' : 'Singles · 1 vs 1';
      ctx.fillText(players.length ? `${mode} · AI fills empty seats` : 'Scan the QR code to join', cx, y0 + 72);

      // Timer
      const secs = players.length ? Math.max(0, Math.ceil(roomT)) : ROOM_TIME;
      ctx.fillStyle = '#f4f4f5';
      ctx.font = hub.font(800, 54);
      ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, cx, y0 + 128);
      ctx.fillStyle = 'rgba(244,244,245,0.5)';
      ctx.font = hub.font(500, 13);
      ctx.fillText(players.length ? 'until the match starts' : 'waiting for the first player', cx, y0 + 162);

      // Seats
      const gap = 10;
      const sw = (cw - 48 - gap * (SEATS - 1)) / SEATS;
      const sy = y0 + 190, sh = 104;
      for (let i = 0; i < SEATS; i++) {
        const sx = x0 + 24 + i * (sw + gap);
        const p = seated[i];
        if (p) {
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          rr(ctx, sx, sy, sw, sh, 14); ctx.fill();
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(sx + sw / 2, sy + 30, 12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f4f4f5';
          ctx.font = hub.font(700, 15);
          ctx.fillText(p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name, sx + sw / 2, sy + 60);
          const voted = votes.has(p.id);
          ctx.fillStyle = voted ? '#7cfc4a' : 'rgba(244,244,245,0.45)';
          ctx.font = hub.font(600, 12);
          ctx.fillText(voted ? '✓ voted' : 'not voted', sx + sw / 2, sy + 84);
        } else {
          ctx.setLineDash([5, 5]);
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          rr(ctx, sx + 0.5, sy + 0.5, sw - 1, sh - 1, 14); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(244,244,245,0.35)';
          ctx.font = hub.font(600, 13);
          ctx.fillText('AI', sx + sw / 2, sy + 42);
          ctx.font = hub.font(500, 11);
          ctx.fillText('open seat', sx + sw / 2, sy + 64);
        }
      }

      ctx.fillStyle = 'rgba(244,244,245,0.7)';
      ctx.font = hub.font(500, 14);
      const need = players.length - [...votes].filter((id) => hub.players.has(id)).length;
      const line = !players.length ? 'Up to 4 players. Hold your phone like a paddle.'
        : need > 0 ? `Tap “Vote to start” on your phone · ${need} more vote${need > 1 ? 's' : ''} to start now`
        : 'Starting…';
      ctx.fillText(line, cx, y0 + ch - 34);
      if (players.length > SEATS) {
        ctx.fillStyle = 'rgba(244,244,245,0.45)';
        ctx.font = hub.font(500, 12);
        ctx.fillText(`${players.length - SEATS} watching — they’ll get the next match`, cx, y0 + ch - 14);
      }
    }

    function drawHud(ctx, vs) {
      const { W, H } = hub;
      // Split divider
      if (vs.length === 2) {
        ctx.fillStyle = '#0e0f13';
        ctx.fillRect(W / 2 - 2, 0, 4, H);
      }

      if (phase !== 'room' && phase !== 'over' && sides[0].members.length) {
        // Scoreboard straddling the center
        const h = 46, cy = 34;
        ctx.font = hub.font(700, 15);
        const n0 = teamName(0), n1 = teamName(1);
        const w0 = ctx.measureText(n0).width, w1 = ctx.measureText(n1).width;
        const half = Math.max(w0, w1) + 90;
        ctx.fillStyle = 'rgba(14,15,19,0.78)';
        rr(ctx, W / 2 - half, cy - h / 2, half * 2, h, h / 2); ctx.fill();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(244,244,245,0.9)';
        ctx.fillText(n0, W / 2 - 64, cy);
        ctx.textAlign = 'left';
        ctx.fillText(n1, W / 2 + 64, cy);
        ctx.font = hub.font(800, 28);
        ctx.textAlign = 'center';
        ctx.fillStyle = sides[0].members[0].color;
        ctx.fillText(String(sides[0].score), W / 2 - 36, cy + 1);
        ctx.fillStyle = sides[1].members[0].color;
        ctx.fillText(String(sides[1].score), W / 2 + 36, cy + 1);
        ctx.fillStyle = 'rgba(244,244,245,0.35)';
        ctx.font = hub.font(700, 18);
        ctx.fillText('–', W / 2, cy);
      }

      // Per-view labels and prompts
      for (const v of vs) {
        if (v.side == null) continue;
        const cx = v.x + v.w / 2;
        if (vs.length === 2) {
          ctx.textAlign = v.side === 0 ? 'left' : 'right';
          ctx.font = hub.font(700, 13);
          ctx.fillStyle = 'rgba(244,244,245,0.75)';
          ctx.fillText(teamName(v.side), v.side === 0 ? v.x + 18 : v.x + v.w - 18, H - 22);
        }
        if (phase === 'serve') {
          const sv = serverInfo();
          if (sv.s === v.side && !sv.m.cpu) {
            ctx.textAlign = 'center';
            ctx.font = hub.font(700, 18);
            ctx.fillStyle = 'rgba(14,15,19,0.65)';
            const txt = `${sv.m.name}, swing to serve`;
            const tw = ctx.measureText(txt).width + 36;
            rr(ctx, cx - tw / 2, H - 92, tw, 38, 19); ctx.fill();
            ctx.fillStyle = '#f4f4f5';
            ctx.fillText(txt, cx, H - 72);
          }
        }
      }

      // Popups: side-specific ones show in that side's view when split
      for (const pp of popups) {
        const k = pp.t / pp.life;
        let targets = vs;
        if (pp.side != null && vs.length === 2) targets = vs.filter((v) => v.side === pp.side);
        for (const v of targets) {
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = pp.color;
          ctx.textAlign = 'center';
          ctx.font = hub.font(800, Math.max(20, hub.UNIT * 3.6) * pp.scale);
          ctx.fillText(pp.text, v.x + v.w / 2, H * 0.3 - k * 30);
        }
      }
      ctx.globalAlpha = 1;

      if (banner) {
        const a = Math.min(1, (banner.life - banner.t) * 2, banner.t * 3);
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = 'rgba(14,15,19,0.7)';
        ctx.font = hub.font(800, Math.max(26, hub.UNIT * 4.2));
        const tw = ctx.measureText(banner.text).width + 60;
        rr(ctx, W / 2 - tw / 2, H / 2 - 52, tw, 104, 22); ctx.fill();
        ctx.fillStyle = '#f4f4f5';
        ctx.textAlign = 'center';
        ctx.fillText(banner.text, W / 2, H / 2 - 10);
        ctx.font = hub.font(600, 16);
        ctx.fillStyle = 'rgba(244,244,245,0.6)';
        ctx.fillText(banner.sub || '', W / 2, H / 2 + 26);
        ctx.globalAlpha = 1;
      }

      if (phase === 'over' && result) {
        ctx.fillStyle = 'rgba(14,15,19,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = 'center';
        ctx.fillStyle = result.color;
        ctx.font = hub.font(800, Math.max(34, hub.UNIT * 6.5));
        ctx.fillText(result.text, W / 2, H / 2 - 16);
        ctx.fillStyle = 'rgba(244,244,245,0.65)';
        ctx.font = hub.font(500, 18);
        ctx.fillText(`Back to the waiting room in ${Math.ceil(phaseT)}…`, W / 2, H / 2 + 30);
      }
    }

    // =====================================================================
    // Game interface
    // =====================================================================
    let stopped = false;
    loadThree()
      .then((THREE) => {
        if (stopped) return;
        T3 = THREE;
        try { buildScene(); } catch (e) { loadError = '3D isn’t supported on this browser'; console.error(e); }
      })
      .catch((e) => { loadError = e.message; });

    return {
      start() { toRoom(); },

      stop() {
        stopped = true;
        hub.showLobby(true);
        if (renderer) { renderer.dispose(); renderer = null; }
        if (glCanvas) { glCanvas.remove(); glCanvas = null; }
      },

      join() {
        if (phase === 'room' && hub.players.size === 1) roomT = ROOM_TIME; // first one in starts the clock
        hub.refreshRoster();
      },

      leave(p) {
        votes.delete(p.id);
        const mm = memberOf(p);
        if (mm && inMatch()) {
          // AI takes over the seat so the match can go on
          mm.m.cpu = true;
          mm.m.id = `cpu-${p.id}`;
          popup(`AI takes over for ${mm.m.name}`, null, '#adb5bd', 2, 0.8);
          mm.m.name = 'CPU';
          if (!humanSides().length) toRoom();
          else if (ball && ball.receiver === mm.m && !ball.out) {
            cpuPlan = { u: IDEAL, miss: false, power: 0.5, done: false };
          }
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
        return mm ? `${sides[mm.s].score} pts` : 'next match';
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
          case 'intro': return doubles ? `Doubles — you cover the ${mm.m.lane * leftSign(mm.s) > 0 ? 'left' : 'right'} side` : 'Get ready!';
          case 'serve': return serverInfo().m === mm.m ? 'Your serve — swing!' : 'Get ready…';
          case 'rally':
            if (!ball) return '';
            if (ball.receiver === mm.m) return 'Swing when the ball reaches you!';
            if (ball.hitter !== mm.s) return 'Partner’s ball';
            return 'Nice — get ready';
          case 'point': return `${sides[mm.s].score} – ${sides[1 - mm.s].score}`;
        }
        return '';
      },

      resize() {
        if (renderer) renderer.setSize(hub.W, hub.H, false);
      },

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
          if (m.cpu && phaseT > 1.2) serve(0.45 + Math.random() * 0.2);
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
            else if (ball.receiver) ball.receiver.swingT = 0.2;
          }
          if (ball && ball.hitter !== rs && u < LATE_LIMIT - lagOf(ball.receiver)) point(ball.hitter, `${ball.receiver ? ball.receiver.name : 'Someone'} missed!`);
        } else if (phase === 'point') {
          if (ball) ball.t += dt / ball.T;
          phaseT -= dt;
          if (phaseT <= 0) {
            const w = sides[0].score >= WIN ? 0 : sides[1].score >= WIN ? 1 : -1;
            if (w >= 0) {
              phase = 'over';
              phaseT = 6;
              ball = null;
              result = { text: `${teamName(w)} win${sides[w].members.length > 1 ? '' : 's'} ${sides[w].score}–${sides[1 - w].score}!`, color: sides[w].members[0].color };
              for (const m of sides[w].members) if (!m.cpu) hub.rumble(hub.players.get(m.id), 300);
            } else {
              startServe();
            }
          }
        } else if (phase === 'over') {
          phaseT -= dt;
          if (phaseT <= 0) toRoom();
        }

        // Paddles glide toward where the ball will arrive (receiver) or home.
        for (let s = 0; s < 2; s++) {
          for (const m of sides[s].members) {
            let target = m.lane * 0.5;
            if (phase === 'rally' && ball && ball.receiver === m) target = Math.max(-1.3, Math.min(1.3, ball.toY));
            else if (phase === 'serve' && serverInfo().m === m) target = m.py;
            m.py += (target - m.py) * Math.min(1, dt * 6);
          }
        }
      },

      draw(ctx, time) {
        const { W, H } = hub;
        ctx.clearRect(0, 0, W, H);
        const dt = Math.min(0.1, (time - lastFrame) / 1000);
        lastFrame = time;

        if (!renderer) {
          ctx.fillStyle = '#0e0f13';
          ctx.fillRect(0, 0, W, H);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(244,244,245,0.6)';
          ctx.font = hub.font(600, 18);
          ctx.fillText(loadError || 'Setting up the table…', centerX(), H / 2);
          return;
        }

        updateScene(dt, time);
        const vs = views();
        renderer.setScissorTest(true);
        for (const v of vs) {
          renderer.setViewport(v.x, 0, v.w, H);
          renderer.setScissor(v.x, 0, v.w, H);
          v.cam.aspect = v.w / H;
          v.cam.fov = v.cam.aspect < 1.1 ? 62 : 48;
          v.cam.updateProjectionMatrix();
          renderer.render(scene, v.cam);
        }
        renderer.setScissorTest(false);

        ctx.textBaseline = 'middle';
        if (phase === 'room') drawRoom(ctx);
        else drawHud(ctx, vs);
      },

      _fastForward: (sec) => { roomT -= sec; }, // tests: skip waiting-room time
      _debug: () => ({
        phase, roomT: Math.round(roomT * 10) / 10, votes: votes.size, doubles,
        teams: sides.map((sd) => sd.members.map((m) => (m.cpu ? 'AI:' : '') + m.name)),
        scores: [sides[0].score, sides[1].score], rally,
        views: renderer ? views().length : 0,
        ball: ball && { t: ball.t, T: ball.T, hitter: ball.hitter, out: ball.out, receiver: ball.receiver && ball.receiver.name },
        server: phase === 'serve' ? serverInfo().m.name : null,
      }),
    };
  },
});

// Rubick screen: hosts a room, accepts phone controllers, runs a tiny arena game.
(() => {
  'use strict';

  const R = window.RUBICK;
  const B = R.BTN;
  const $ = (s) => document.querySelector(s);

  const COLORS = [
    { name: 'Lime',   hex: '#7cfc4a' },
    { name: 'Coral',  hex: '#ff6b6b' },
    { name: 'Sky',    hex: '#4dabf7' },
    { name: 'Sun',    hex: '#ffd43b' },
    { name: 'Violet', hex: '#b197fc' },
    { name: 'Tang',   hex: '#ff922b' },
    { name: 'Teal',   hex: '#38d9a9' },
    { name: 'Pink',   hex: '#f783ac' },
  ];
  const BTN_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'VIEW', 'MENU', '↑', '↓', '←', '→'];

  // ---------- Canvas ----------
  const canvas = $('#arena');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, UNIT = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    UNIT = Math.min(W, H) / 100; // 1 unit = 1% of the short side
    for (const p of players.values()) clampToArena(p);
  }

  // ---------- State ----------
  const players = new Map(); // id -> player
  const coins = [];
  const rings = [];
  const particles = [];
  let peer = null;
  let code = '';

  function freeSlot() {
    const used = new Set([...players.values()].map((p) => p.slot));
    for (let i = 0; i < R.MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }

  function cleanName(raw, slot) {
    const n = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 12);
    return n || `P${slot + 1}`;
  }

  function newPlayer(id, slot, name, conn) {
    return {
      id, slot, conn,
      name: cleanName(name, slot),
      color: COLORS[slot].hex,
      x: W * (0.3 + 0.4 * Math.random()),
      y: H * (0.3 + 0.4 * Math.random()),
      vx: 0, vy: 0,
      fx: 1, fy: 0,            // facing
      lx: 0, ly: 0, btn: 0,    // latest input
      lastInput: performance.now(),
      dashT: 0, dashCd: 0,
      score: 0,
      rtt: null,
      trail: [],
      joinedAt: performance.now(),
    };
  }

  function addPlayer(p) {
    players.set(p.id, p);
    burst(p.x, p.y, p.color, 24);
    renderRoster();
    updateStatus();
  }

  function removePlayer(id) {
    const p = players.get(id);
    if (!p) return;
    burst(p.x, p.y, p.color, 18);
    players.delete(id);
    renderRoster();
    updateStatus();
  }

  function send(p, msg) {
    if (p.conn && p.conn.open) {
      try { p.conn.send(msg); } catch (_) { /* channel closing */ }
    }
  }

  // ---------- Networking ----------
  function setStatus(text, kind = '') {
    const el = $('#status');
    el.textContent = text;
    el.className = 'status ' + kind;
  }

  function updateStatus() {
    if (!peer || !peer.open) return;
    const n = players.size;
    setStatus(n ? `${n} player${n > 1 ? 's' : ''} connected` : 'Room open — waiting for players', 'ok');
  }

  function controllerUrl() {
    return new URL('controller.html', window.location.href).href;
  }

  function showRoom() {
    const join = `${controllerUrl()}?room=${code}` +
      (R.peerServer ? `&peer=${encodeURIComponent(R.peerServer)}` : '');
    $('#code').textContent = code;
    const a = $('#joinUrl');
    a.href = join;
    a.textContent = controllerUrl().replace(/^https?:\/\//, '');
    const qr = window.qrcode(0, 'M');
    qr.addData(join);
    qr.make();
    $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    $('#chip').textContent = code;
    document.title = `Rubick — ${code}`;
  }

  function startHost() {
    code = R.makeCode();
    setStatus('Opening room…');
    peer = new Peer(R.PREFIX + code, R.peerOptions);

    peer.on('open', () => { showRoom(); updateStatus(); });
    peer.on('connection', onConnection);

    peer.on('disconnected', () => {
      // Lost the broker only. Existing players stay connected (peer-to-peer),
      // but new players can't join until we're back.
      setStatus('Lobby server lost — reconnecting…', 'warn');
      setTimeout(() => {
        if (peer && !peer.destroyed && peer.disconnected) {
          try { peer.reconnect(); } catch (_) {}
        }
      }, 1500);
    });

    peer.on('error', (err) => {
      console.warn('[rubick] peer error', err.type, err);
      if (err.type === 'unavailable-id') {
        peer.destroy();
        startHost(); // code collision, roll a new one
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        setStatus('Can’t reach lobby server — retrying…', 'warn');
      } else if (err.type === 'browser-incompatible') {
        setStatus('This browser doesn’t support WebRTC', 'bad');
      }
    });
  }

  function onConnection(conn) {
    conn.on('open', () => {
      const slot = freeSlot();
      if (slot < 0) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 400);
        return;
      }
      const name = conn.metadata && conn.metadata.name;
      const p = newPlayer(conn.peer, slot, name, conn);
      addPlayer(p);
      send(p, { t: 'welcome', slot, color: p.color, colorName: COLORS[slot].name, name: p.name, code });
    });
    conn.on('data', (msg) => onMessage(conn.peer, msg));
    conn.on('close', () => removePlayer(conn.peer));
    conn.on('error', () => removePlayer(conn.peer));
  }

  function onMessage(id, msg) {
    const p = players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'in':
        applyInput(p, msg.x, msg.y, msg.b);
        break;
      case 'ping':
        send(p, { t: 'pong', ts: msg.ts });
        break;
      case 'rtt':
        p.rtt = Math.round(Number(msg.ms) || 0);
        break;
    }
  }

  const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

  function applyInput(p, x, y, b) {
    const prev = p.btn;
    p.lx = clamp1(x);
    p.ly = clamp1(y);
    p.btn = (b | 0) & 0xfff;
    p.lastInput = performance.now();
    const pressed = p.btn & ~prev;
    if (pressed & B.A) dash(p);
    if (pressed & B.B) honk(p);
    if (pressed !== 0 || (prev & ~p.btn) !== 0) rosterDirty = true;
  }

  // ---------- Keyboard player (for testing without a phone) ----------
  const keys = new Set();
  const KB_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE']);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && !e.repeat) { toggleLobby(); return; }
    if (!KB_KEYS.has(e.code)) return;
    e.preventDefault();
    keys.add(e.code);
    if (!players.has('kb')) {
      const slot = freeSlot();
      if (slot >= 0) addPlayer(newPlayer('kb', slot, 'Keyboard', null));
    }
    pumpKeyboard();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); pumpKeyboard(); });
  window.addEventListener('blur', () => { keys.clear(); pumpKeyboard(); });

  function pumpKeyboard() {
    const p = players.get('kb');
    if (!p) return;
    const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const y = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    let b = 0;
    if (keys.has('Space')) b |= B.A;
    if (keys.has('KeyE')) b |= B.B;
    applyInput(p, x, y, b);
  }

  // ---------- Game ----------
  const radius = () => Math.max(14, UNIT * 2.8);
  const speed = () => UNIT * 55; // per second

  function dash(p) {
    if (p.dashCd > 0) return;
    p.dashT = 0.16;
    p.dashCd = 0.55;
    send(p, { t: 'rumble', ms: 18 });
  }

  function honk(p) {
    rings.push({ x: p.x, y: p.y, t: 0, color: p.color });
  }

  function spawnCoin() {
    const m = radius() * 3;
    coins.push({
      x: m + Math.random() * Math.max(1, W - m * 2),
      y: m + Math.random() * Math.max(1, H - m * 2),
      phase: Math.random() * Math.PI * 2,
    });
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = UNIT * (10 + Math.random() * 40);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, t: 0, color });
    }
  }

  function clampToArena(p) {
    const r = radius();
    if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx) * 0.4; }
    if (p.x > W - r) { p.x = W - r; p.vx = -Math.abs(p.vx) * 0.4; }
    if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy) * 0.4; }
    if (p.y > H - r) { p.y = H - r; p.vy = -Math.abs(p.vy) * 0.4; }
  }

  function update(dt) {
    const now = performance.now();
    const r = radius();
    const sp = speed();

    while (coins.length < 3) spawnCoin();

    for (const p of players.values()) {
      // Phone went to sleep or lost focus: stop drifting.
      if (p.conn && now - p.lastInput > 1500) { p.lx = 0; p.ly = 0; p.btn = 0; }

      let ix = p.lx, iy = p.ly;
      if (Math.hypot(ix, iy) < 0.05) {
        // D-pad as a fallback when the stick is idle
        ix = (p.btn & B.RIGHT ? 1 : 0) - (p.btn & B.LEFT ? 1 : 0);
        iy = (p.btn & B.DOWN ? 1 : 0) - (p.btn & B.UP ? 1 : 0);
      }
      const mag = Math.hypot(ix, iy);
      if (mag > 1) { ix /= mag; iy /= mag; }
      if (mag > 0.1) { const m = Math.hypot(ix, iy); p.fx = ix / m; p.fy = iy / m; }

      // Ease toward target velocity so it feels weighty but responsive.
      const k = Math.min(1, dt * 14);
      p.vx += (ix * sp - p.vx) * k;
      p.vy += (iy * sp - p.vy) * k;

      let vx = p.vx, vy = p.vy;
      if (p.dashT > 0) {
        p.dashT -= dt;
        vx += p.fx * sp * 2.6;
        vy += p.fy * sp * 2.6;
        p.trail.push({ x: p.x, y: p.y, t: 0 });
      }
      p.dashCd = Math.max(0, p.dashCd - dt);

      p.x += vx * dt;
      p.y += vy * dt;
      clampToArena(p);

      for (const tr of p.trail) tr.t += dt;
      while (p.trail.length && p.trail[0].t > 0.25) p.trail.shift();

      // Coins
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        if (Math.hypot(c.x - p.x, c.y - p.y) < r + UNIT * 1.6) {
          coins.splice(i, 1);
          p.score += 1;
          burst(c.x, c.y, '#ffd43b', 14);
          send(p, { t: 'rumble', ms: 40 });
          send(p, { t: 'score', score: p.score });
          rosterDirty = true;
        }
      }
    }

    // Player-player pushback
    const list = [...players.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const overlap = r * 2 - d;
        if (overlap > 0) {
          const nx = dx / d, ny = dy / d;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
          b.x += nx * overlap / 2; b.y += ny * overlap / 2;
          const hard = a.dashT > 0 || b.dashT > 0;
          if (hard) {
            const kick = speed() * 1.2;
            a.vx -= nx * kick; a.vy -= ny * kick;
            b.vx += nx * kick; b.vy += ny * kick;
            send(a, { t: 'rumble', ms: 60 });
            send(b, { t: 'rumble', ms: 60 });
          }
        }
      }
    }

    for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.6) rings.splice(i, 1); }
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.t += dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 0.92; q.vy *= 0.92;
      if (q.t > q.life) particles.splice(i, 1);
    }
  }

  function draw(time) {
    ctx.fillStyle = '#0e0f13';
    ctx.fillRect(0, 0, W, H);

    // Grid
    const g = Math.max(32, UNIT * 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (W % g) / 2; x < W; x += g) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = (H % g) / 2; y < H; y += g) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    // Coins
    for (const c of coins) {
      const s = 1 + Math.sin(time / 300 + c.phase) * 0.12;
      const cr = UNIT * 1.3 * s;
      ctx.save();
      ctx.shadowColor = 'rgba(255, 212, 59, 0.7)';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath(); ctx.arc(c.x, c.y, cr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(c.x, c.y, cr * 0.45, 0, Math.PI * 2); ctx.fill();
    }

    // Honk rings
    for (const k of rings) {
      const pr = k.t / 0.6;
      ctx.strokeStyle = k.color;
      ctx.globalAlpha = 1 - pr;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(k.x, k.y, radius() + pr * UNIT * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const r = radius();
    for (const p of players.values()) {
      // Dash trail
      for (const tr of p.trail) {
        ctx.globalAlpha = Math.max(0, 0.35 * (1 - tr.t / 0.25));
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(tr.x, tr.y, r * (1 - tr.t * 2), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Spawn pop
      const age = (performance.now() - p.joinedAt) / 1000;
      const pop = age < 0.35 ? 0.4 + 0.6 * easeOutBack(age / 0.35) : 1;

      // Body
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * pop, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Eye showing facing direction
      const ex = p.x + p.fx * r * 0.45, ey = p.y + p.fy * r * 0.45;
      ctx.fillStyle = '#0e0f13';
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.24 * pop, 0, Math.PI * 2); ctx.fill();

      // Label
      ctx.font = `600 ${Math.max(12, UNIT * 1.6)}px Rubik, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(244,244,245,0.92)';
      ctx.fillText(p.name, p.x, p.y - r - 6);
      if (p.score) {
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffd43b';
        ctx.fillText(String(p.score), p.x, p.y + r + 6);
      }
    }

    for (const q of particles) {
      ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    if (!players.size) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(244,244,245,0.18)';
      ctx.font = `700 ${Math.max(18, UNIT * 4)}px Rubik, system-ui, sans-serif`;
      const cx = $('#lobby').hidden ? W / 2 : Math.max(W / 2, 340 + (W - 340) / 2);
      ctx.fillText('Waiting for controllers', cx, H / 2);
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // ---------- Roster UI ----------
  let rosterDirty = false;

  function renderRoster() {
    rosterDirty = false;
    const ul = $('#roster');
    ul.replaceChildren();
    const list = [...players.values()].sort((a, b) => a.slot - b.slot);
    for (const p of list) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${p.score} ★` + (p.rtt != null ? ` · ${p.rtt}ms` : '');
      const btns = document.createElement('div');
      btns.className = 'btns';
      BTN_LABELS.forEach((label, i) => {
        const s = document.createElement('span');
        s.textContent = label;
        if (p.btn & (1 << i)) s.className = 'on';
        btns.append(s);
      });
      li.append(dot, name, meta, btns);
      ul.append(li);
    }
  }

  // Ping numbers change constantly; refresh the roster a few times a second.
  setInterval(() => { if (players.size) rosterDirty = true; }, 1000);

  function toggleLobby() {
    const lobby = $('#lobby');
    lobby.hidden = !lobby.hidden;
    $('#chip').hidden = !lobby.hidden;
  }
  $('#toggle').addEventListener('click', toggleLobby);
  $('#chip').addEventListener('click', toggleLobby);

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw(now);
    if (rosterDirty) renderRoster();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });

  resize();
  startHost();
  requestAnimationFrame(frame);

  // Exposed for debugging in the console.
  window.__rubick = { players, get code() { return code; } };
})();

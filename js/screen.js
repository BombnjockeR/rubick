// Rubick screen hub: hosts the room, tracks controllers, and runs whichever
// game is selected. Switching games keeps every phone connected.
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

  const canvas = $('#arena');
  const ctx = canvas.getContext('2d');

  // ---------- Hub: the API games use ----------
  const hub = {
    B,
    ctx,
    W: 0, H: 0, UNIT: 1,
    players: new Map(), // id -> { id, slot, name, color, conn, sx, sy, b, lastInput, rtt, joinedAt }
    send(p, msg) {
      if (p && p.conn && p.conn.open) {
        try { p.conn.send(msg); } catch (_) { /* channel closing */ }
      }
    },
    rumble(p, ms) { this.send(p, { t: 'rumble', ms }); },
    refreshRoster() { rosterDirty = true; },
    showLobby(show) { setLobbyVisible(show); },
    // Direction the player is pushing: stick if it's moved, otherwise d-pad.
    dir(p) {
      let x = p.sx, y = p.sy;
      if (Math.hypot(x, y) < 0.05) {
        x = (p.b & B.RIGHT ? 1 : 0) - (p.b & B.LEFT ? 1 : 0);
        y = (p.b & B.DOWN ? 1 : 0) - (p.b & B.UP ? 1 : 0);
      }
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      return { x, y };
    },
    font(weight, px) { return `${weight} ${Math.round(px)}px Rubik, system-ui, sans-serif`; },
  };

  let peer = null;
  let code = '';
  let game = null;
  let gameDef = null;
  let rosterDirty = false;

  // ---------- Canvas ----------
  function resize() {
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    hub.W = window.innerWidth;
    hub.H = window.innerHeight;
    canvas.width = Math.round(hub.W * DPR);
    canvas.height = Math.round(hub.H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    hub.UNIT = Math.min(hub.W, hub.H) / 100;
    if (game && game.resize) game.resize();
  }

  // ---------- Players ----------
  function freeSlot() {
    const used = new Set([...hub.players.values()].map((p) => p.slot));
    for (let i = 0; i < R.MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }

  function cleanName(raw, slot) {
    const n = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 12);
    return n || `P${slot + 1}`;
  }

  function addPlayer(id, slot, name, conn) {
    const p = {
      id, slot, conn,
      name: cleanName(name, slot),
      color: COLORS[slot].hex,
      colorName: COLORS[slot].name,
      sx: 0, sy: 0, b: 0,
      lastInput: performance.now(),
      rtt: null,
      hintSent: null,
      joinedAt: performance.now(),
    };
    hub.players.set(id, p);
    if (game && game.join) game.join(p);
    rosterDirty = true;
    updateStatus();
    return p;
  }

  function removePlayer(id) {
    const p = hub.players.get(id);
    if (!p) return;
    hub.players.delete(id);
    if (game && game.leave) game.leave(p);
    rosterDirty = true;
    updateStatus();
  }

  const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

  function applyInput(p, x, y, b) {
    const prev = p.b;
    p.sx = clamp1(x);
    p.sy = clamp1(y);
    p.b = (b | 0) & 0xfff;
    p.lastInput = performance.now();
    const pressed = p.b & ~prev;
    if (pressed && game && game.press) game.press(p, pressed);
    if (p.b !== prev) rosterDirty = true;
  }

  // ---------- Networking ----------
  function setStatus(text, kind = '') {
    const el = $('#status');
    el.textContent = text;
    el.className = 'status ' + kind;
  }

  function updateStatus() {
    if (!peer || !peer.open) return;
    const n = hub.players.size;
    setStatus(n ? `${n} player${n > 1 ? 's' : ''} connected` : 'Room open — waiting for players', 'ok');
    $('#chip').textContent = n ? `${code} · ${n}` : code;
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
    document.title = `Rubick — ${code}`;
  }

  function startHost() {
    code = R.makeCode();
    setStatus('Opening room…');
    peer = new Peer(R.PREFIX + code, R.peerOptions);

    peer.on('open', () => { showRoom(); updateStatus(); });
    peer.on('connection', onConnection);

    peer.on('disconnected', () => {
      // Lost the broker only. Connected players keep playing (peer-to-peer),
      // but nobody new can join until we're back.
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
      const p = addPlayer(conn.peer, slot, conn.metadata && conn.metadata.name, conn);
      hub.send(p, { t: 'welcome', slot, color: p.color, colorName: p.colorName, name: p.name, code });
      hub.send(p, { t: 'mode', mode: controlMode() });
    });
    conn.on('data', (msg) => onMessage(conn.peer, msg));
    conn.on('close', () => removePlayer(conn.peer));
    conn.on('error', () => removePlayer(conn.peer));
  }

  function onMessage(id, msg) {
    const p = hub.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'in': applyInput(p, msg.x, msg.y, msg.b); break;
      case 'ping': hub.send(p, { t: 'pong', ts: msg.ts }); break;
      case 'rtt': p.rtt = Math.round(Number(msg.ms) || 0); break;
      case 'swing':
        if (game && game.swing) game.swing(p, Math.max(0, Math.min(1, Number(msg.power) || 0)));
        break;
      case 'action':
        if (game && game.action) game.action(p);
        break;
    }
  }

  // ---------- Games ----------
  // 'pad' = Xbox-style gamepad, 'motion' = hold the phone like a paddle and swing.
  const controlMode = () => (gameDef && gameDef.controls) || 'pad';

  function setGame(id) {
    const def = window.RubickGames.get(id) || window.RubickGames.list[0];
    if (game && game.stop) game.stop();
    gameDef = def;
    game = def.create(hub);
    if (game.start) game.start();
    if (game.join) for (const p of hub.players.values()) game.join(p);
    for (const p of hub.players.values()) {
      p.hintSent = null;
      p.actionSent = null;
      hub.send(p, { t: 'mode', mode: controlMode() });
    }
    for (const btn of document.querySelectorAll('#games button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.game === def.id));
    }
    $('#gameBlurb').textContent = def.blurb || '';
    const url = new URL(window.location.href);
    url.searchParams.set('game', def.id);
    history.replaceState(null, '', url);
    rosterDirty = true;
  }

  function buildGamePicker() {
    const wrap = $('#games');
    for (const def of window.RubickGames.list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.game = def.id;
      b.textContent = def.name;
      b.addEventListener('click', () => { if (!gameDef || gameDef.id !== def.id) setGame(def.id); });
      wrap.append(b);
    }
  }

  // Phone hint line ("Press A when ready", …) and optional action button
  // ("Vote to start"). Only sent when they change.
  function pushHints() {
    if (!game) return;
    for (const p of hub.players.values()) {
      const h = (game.hint && game.hint(p)) || '';
      if (h !== p.hintSent) {
        p.hintSent = h;
        hub.send(p, { t: 'hint', text: h });
      }
      const a = (game.actionLabel && game.actionLabel(p)) || '';
      if (a !== p.actionSent) {
        p.actionSent = a;
        hub.send(p, { t: 'action', label: a });
      }
    }
  }
  setInterval(pushHints, 150);

  // ---------- Keyboard player (testing without a phone) ----------
  const keys = new Set();
  const KB_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE', 'Enter']);

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'KeyH' && !e.repeat) { toggleLobby(); return; }
    if (!KB_KEYS.has(e.code)) return;
    e.preventDefault();
    keys.add(e.code);
    if (!hub.players.has('kb')) {
      const slot = freeSlot();
      if (slot >= 0) addPlayer('kb', slot, 'Keyboard', null);
    }
    pumpKeyboard();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); pumpKeyboard(); });
  window.addEventListener('blur', () => { keys.clear(); pumpKeyboard(); });

  function pumpKeyboard() {
    const p = hub.players.get('kb');
    if (!p) return;
    let b = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) b |= B.UP;
    if (keys.has('KeyS') || keys.has('ArrowDown')) b |= B.DOWN;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) b |= B.LEFT;
    if (keys.has('KeyD') || keys.has('ArrowRight')) b |= B.RIGHT;
    if (keys.has('Space') || keys.has('Enter')) b |= B.A;
    if (keys.has('KeyE')) b |= B.B;
    applyInput(p, 0, 0, b);
  }

  // ---------- Roster / lobby panel ----------
  function renderRoster() {
    rosterDirty = false;
    const ul = $('#roster');
    ul.replaceChildren();
    const list = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
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
      const gm = game && game.meta ? game.meta(p) : '';
      meta.textContent = [gm, p.rtt != null ? `${p.rtt}ms` : ''].filter(Boolean).join(' · ');
      const btns = document.createElement('div');
      btns.className = 'btns';
      BTN_LABELS.forEach((label, i) => {
        const s = document.createElement('span');
        s.textContent = label;
        if (p.b & (1 << i)) s.className = 'on';
        btns.append(s);
      });
      li.append(dot, name, meta, btns);
      ul.append(li);
    }
  }
  setInterval(() => { if (hub.players.size) rosterDirty = true; }, 1000);

  function setLobbyVisible(show) {
    $('#lobby').hidden = !show;
    $('#chip').hidden = show;
  }
  function toggleLobby() { setLobbyVisible($('#lobby').hidden); }
  $('#toggle').addEventListener('click', toggleLobby);
  $('#chip').addEventListener('click', toggleLobby);

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // cap so a hiccup doesn't teleport things
    last = now;

    // A phone that went to sleep shouldn't keep steering.
    for (const p of hub.players.values()) {
      if (p.conn && now - p.lastInput > 1500 && (p.sx || p.sy || p.b)) { p.sx = 0; p.sy = 0; p.b = 0; }
    }

    if (game) {
      if (game.update) game.update(dt);
      if (game.draw) game.draw(ctx, now);
    }
    if (rosterDirty) renderRoster();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('beforeunload', () => { if (peer) peer.destroy(); });

  resize();
  buildGamePicker();
  setGame(new URLSearchParams(location.search).get('game') || 'snake');
  startHost();
  requestAnimationFrame(frame);

  // Handy in the browser console.
  window.__rubick = { hub, setGame, get code() { return code; }, get game() { return game; } };
})();

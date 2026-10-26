// Rubick controller: turns the phone into an Xbox-style gamepad.
(() => {
  'use strict';

  const R = window.RUBICK;
  const B = R.BTN;
  const $ = (s) => document.querySelector(s);

  const state = { x: 0, y: 0, b: 0 };
  let peer = null;
  let conn = null;
  let connected = false;
  let leaving = false;
  let lastSentKey = '';
  let lastSentAt = 0;
  let pingTimer = null;
  let wakeLock = null;

  // ---------- Storage (may be unavailable in private mode) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  // ---------- Join screen ----------
  const codeInput = $('#codeInput');
  const nameInput = $('#nameInput');
  const joinBtn = $('#joinBtn');

  const params = new URLSearchParams(location.search);
  codeInput.value = R.normalizeCode(params.get('room'));
  nameInput.value = store.get('rubick.name') || '';
  codeInput.addEventListener('input', () => { codeInput.value = R.normalizeCode(codeInput.value); });

  function setMsg(text, bad = false) {
    const el = $('#joinMsg');
    el.textContent = text;
    el.className = 'msg' + (bad ? ' bad' : '');
  }

  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = R.normalizeCode(codeInput.value);
    if (code.length !== R.CODE_LENGTH) { setMsg('Enter the 4-letter code shown on the screen', true); return; }
    const name = nameInput.value.trim().slice(0, 12);
    store.set('rubick.name', name);
    goFullscreen(); // needs the tap gesture, so do it right here
    join(code, name);
  });

  // ---------- Connection ----------
  function teardown() {
    connected = false;
    clearInterval(pingTimer);
    if (conn) { try { conn.close(); } catch (_) {} }
    if (peer) { try { peer.destroy(); } catch (_) {} }
    conn = null;
    peer = null;
  }

  function join(code, name) {
    teardown();
    leaving = false;
    joinBtn.disabled = true;
    setMsg('Connecting…');

    let settled = false;
    const fail = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      teardown();
      joinBtn.disabled = false;
      setMsg(text, true);
    };
    const timer = setTimeout(() => fail('Couldn’t reach that room. Is the screen page still open?'), 15000);

    peer = new Peer(R.peerOptions);

    peer.on('open', () => {
      conn = peer.connect(R.PREFIX + code, { reliable: true, metadata: { name } });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        onConnected();
      });
      conn.on('data', onData);
      conn.on('close', () => onDropped('Disconnected from the screen.'));
      conn.on('error', () => onDropped('Connection error.'));
    });

    peer.on('error', (err) => {
      console.warn('[rubick] peer error', err.type, err);
      if (connected) return; // broker hiccups don't matter once we're paired
      if (err.type === 'peer-unavailable') fail(`No room called ${code}. Check the code on the screen.`);
      else if (err.type === 'browser-incompatible') fail('This browser doesn’t support WebRTC.');
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) fail('Can’t reach the lobby server. Check your internet.');
      else fail('Couldn’t connect (' + err.type + ').');
    });
  }

  function onConnected() {
    connected = true;
    joinBtn.disabled = false;
    setMsg('');
    $('#join').hidden = true;
    $('#pad').hidden = false;
    checkOrientation();
    requestWakeLock();
    resetStick();
    pingTimer = setInterval(() => sendRaw({ t: 'ping', ts: performance.now() }), 1000);
    flush(true);
  }

  function onDropped(text) {
    if (!connected && !leaving) return;
    const wasLeaving = leaving;
    teardown();
    releaseAll();
    $('#pad').hidden = true;
    $('#rotate').hidden = true;
    $('#join').hidden = false;
    setMsg(wasLeaving ? '' : text + ' Tap Join to reconnect.', !wasLeaving);
    releaseWakeLock();
    leaving = false; // late 'close' events from the old connection are now ignored
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        document.documentElement.style.setProperty('--me', msg.color);
        $('#meName').textContent = msg.name || 'Player';
        $('#meScore').textContent = '';
        haptic([30, 40, 30]);
        break;
      case 'pong': {
        const rtt = Math.round(performance.now() - msg.ts);
        $('#ping').textContent = rtt + 'ms';
        sendRaw({ t: 'rtt', ms: rtt });
        break;
      }
      case 'rumble':
        haptic(Math.max(5, Math.min(400, msg.ms | 0)));
        break;
      case 'score':
        $('#meScore').textContent = '★ ' + msg.score;
        break;
      case 'full':
        leaving = true;
        onDropped('');
        setMsg('That room is full (8 players max).', true);
        break;
    }
  }

  function sendRaw(msg) {
    if (conn && conn.open) {
      try { conn.send(msg); } catch (_) {}
    }
  }

  // Send input when it changes, plus a heartbeat so the screen knows we're alive.
  function flush(force = false) {
    if (!connected) return;
    const now = performance.now();
    const key = state.x + ',' + state.y + ',' + state.b;
    if (force || key !== lastSentKey || now - lastSentAt > 250) {
      sendRaw({ t: 'in', x: state.x, y: state.y, b: state.b });
      lastSentKey = key;
      lastSentAt = now;
    }
  }
  // rAF pauses when the tab is hidden; the timer keeps the heartbeat honest.
  (function loop() { flush(); requestAnimationFrame(loop); })();
  setInterval(() => flush(), 100);

  $('#leaveBtn').addEventListener('click', () => {
    leaving = true;
    onDropped('');
  });

  // ---------- Stick ----------
  const zone = $('#stickZone');
  const base = $('#stickBase');
  const knob = $('#stickKnob');
  const DEADZONE = 0.12;
  let stickId = null;
  let cx = 0, cy = 0, maxR = 1;

  function resetStick() {
    stickId = null;
    zone.classList.remove('active');
    base.style.left = '50%';
    base.style.top = '52%';
    knob.style.transform = 'translate(0px, 0px)';
    state.x = 0;
    state.y = 0;
  }

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch (_) {}
    zone.classList.add('active');

    // Floating stick: the base jumps to where your thumb lands.
    const zr = zone.getBoundingClientRect();
    const half = base.offsetWidth / 2;
    maxR = half * 0.62;
    const px = Math.max(zr.left + half * 0.6, Math.min(zr.right - half * 0.6, e.clientX));
    const py = Math.max(zr.top + half * 0.6, Math.min(zr.bottom - half * 0.6, e.clientY));
    base.style.left = (px - zr.left) + 'px';
    base.style.top = (py - zr.top) + 'px';
    cx = px;
    cy = py;
    moveStick(e);
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    moveStick(e);
  });

  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    resetStick();
    flush();
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);
  zone.addEventListener('lostpointercapture', endStick);

  function moveStick(e) {
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    let nx = dx / maxR, ny = dy / maxR;
    const mag = Math.hypot(nx, ny);
    if (mag < DEADZONE) { nx = 0; ny = 0; }
    else {
      const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
      nx = nx / mag * scaled;
      ny = ny / mag * scaled;
    }
    state.x = Math.round(nx * 100) / 100;
    state.y = Math.round(ny * 100) / 100;
    flush();
  }

  // ---------- Buttons ----------
  const buttons = [...document.querySelectorAll('[data-btn]')];
  // Track which pointers hold which button, so two fingers on one button work.
  const held = new Map(); // pointerId -> element

  function press(el, pointerId) {
    const bit = B[el.dataset.btn];
    held.set(pointerId, el);
    if (!(state.b & bit)) {
      state.b |= bit;
      el.classList.add('pressed');
      haptic(8);
      flush();
    }
  }

  function release(pointerId) {
    const el = held.get(pointerId);
    if (!el) return;
    held.delete(pointerId);
    for (const other of held.values()) if (other === el) return; // still held by another finger
    state.b &= ~B[el.dataset.btn];
    el.classList.remove('pressed');
    flush();
  }

  function releaseAll() {
    held.clear();
    state.b = 0;
    for (const el of buttons) el.classList.remove('pressed');
    resetStick();
  }

  for (const el of buttons) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); press(el, e.pointerId); });
    el.addEventListener('pointerup', (e) => release(e.pointerId));
    el.addEventListener('pointercancel', (e) => release(e.pointerId));
    el.addEventListener('pointerleave', (e) => release(e.pointerId));
  }

  // ---------- Phone niceties ----------
  function haptic(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (_) {} }
  }

  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req || document.fullscreenElement) return;
    Promise.resolve(req.call(el, { navigationUI: 'hide' }))
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => {});
  }
  $('#fsBtn').addEventListener('click', goFullscreen);

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (_) {}
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && connected) requestWakeLock();
    if (document.visibilityState === 'hidden') { releaseAll(); flush(true); }
  });

  const portrait = window.matchMedia('(orientation: portrait)');
  function checkOrientation() {
    $('#rotate').hidden = !(connected && portrait.matches);
  }
  portrait.addEventListener('change', () => { releaseAll(); checkOrientation(); });

  // No long-press menus, pinch zoom or double-tap zoom on the pad.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  if (codeInput.value) nameInput.focus();
})();

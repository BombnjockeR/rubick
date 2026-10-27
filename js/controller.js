// Rubick controller: turns the phone into an Xbox-style gamepad.
(() => {
  'use strict';

  const R = window.RUBICK;
  const B = R.BTN;
  const $ = (s) => document.querySelector(s);
  const setAll = (sel, text) => { for (const el of document.querySelectorAll(sel)) el.textContent = text; };

  const state = { x: 0, y: 0, b: 0 };
  let peer = null;
  let conn = null;
  let connected = false;
  let leaving = false;
  let lastSentKey = '';
  let lastSentAt = 0;
  let pingTimer = null;
  let wakeLock = null;
  let mode = 'pad'; // 'pad' or 'motion', chosen by the game on the screen

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
  // Set when the QR came from a watch page: this player sees the game as video.
  const isRemote = params.get('remote') === '1';
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

  async function join(code, name) {
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
    // If the room didn't exist we'd get 'peer-unavailable' within a second or
    // two, so a timeout means we found the room but the network blocked the link.
    const timer = setTimeout(() => fail('Found the room, but couldn’t connect from this network. Try switching between Wi-Fi and mobile data, or check the screen is still open.'), 20000);

    const opts = await R.peerOptionsAsync();
    if (settled) return;
    peer = new Peer(opts);

    peer.on('open', () => {
      conn = peer.connect(R.PREFIX + code, { reliable: true, metadata: { name, remote: isRemote } });
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
    showMode();
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
    $('#motion').hidden = true;
    $('#rotate').hidden = true;
    mode = 'pad';
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
        setAll('.js-name', msg.name || 'Player');
        setAll('.js-score', '');
        haptic([30, 40, 30]);
        break;
      case 'pong': {
        const rtt = Math.round(performance.now() - msg.ts);
        setAll('.js-ping', rtt + 'ms');
        sendRaw({ t: 'rtt', ms: rtt });
        break;
      }
      case 'rumble':
        haptic(Math.max(5, Math.min(400, msg.ms | 0)));
        break;
      case 'score':
        setAll('.js-score', '★ ' + msg.score);
        break;
      case 'hint':
        setAll('.js-hint', String(msg.text || '').slice(0, 60));
        break;
      case 'action': {
        const label = String(msg.label || '').slice(0, 40);
        for (const btn of document.querySelectorAll('.js-action')) {
          btn.hidden = !label;
          btn.textContent = label;
          btn.classList.toggle('done', label.includes('✓'));
        }
        break;
      }
      case 'mode':
        mode = msg.mode === 'motion' ? 'motion' : 'pad';
        if (connected) showMode();
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

  for (const btn of document.querySelectorAll('.js-leave')) {
    btn.addEventListener('click', () => {
      leaving = true;
      onDropped('');
    });
  }

  for (const btn of document.querySelectorAll('.js-menu')) {
    btn.addEventListener('click', () => { sendRaw({ t: 'menu' }); haptic(15); });
  }

  for (const btn of document.querySelectorAll('.js-action')) {
    btn.addEventListener('click', () => { sendRaw({ t: 'action' }); haptic(20); });
  }

  function showMode() {
    releaseAll();
    $('#pad').hidden = mode !== 'pad';
    $('#motion').hidden = mode !== 'motion';
    checkOrientation();
    // Motion games are played holding the phone upright; the pad wants landscape.
    try {
      const o = screen.orientation;
      if (o && mode === 'motion' && o.unlock) o.unlock();
      else if (o && o.lock && document.fullscreenElement) o.lock('landscape').catch(() => {});
    } catch (_) {}
    if (mode === 'motion') Motion.prepare();
  }

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
    $('#rotate').hidden = !(connected && mode === 'pad' && portrait.matches);
  }
  portrait.addEventListener('change', () => { releaseAll(); checkOrientation(); });

  // No long-press menus, pinch zoom or double-tap zoom on the pad.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // ---------- Motion (swing detection) ----------
  // A swing is a burst of rotation (gyroscope) or linear acceleration.
  // When either crosses a threshold we watch ~70ms for the peak, then send
  // {t:'swing', power 0..1} to the screen. Timing is judged on the screen.
  const Motion = (() => {
    const GYRO_TH = 260;     // deg/s that counts as a swing
    const ACC_TH = 14;       // m/s² of linear acceleration that counts as a swing
    const GYRO_FULL = 1100;  // deg/s for a full-power swing
    const ACC_FULL = 32;     // m/s² for a full-power swing
    const PEAK_WINDOW = 70;  // ms to look for the peak after the swing starts
    const COOLDOWN = 380;    // ms before another swing can register

    const meter = $('#mMeter');
    const paddle = $('#mPaddle');
    const status = $('#mStatus');
    const btn = $('#motionBtn');
    let listening = false, gotData = false;
    let swinging = false, swingStart = 0, peak = 0, coolUntil = 0, level = 0;

    const needsPermission = () =>
      typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';

    function prepare() {
      if (listening) return;
      if (typeof DeviceMotionEvent === 'undefined') {
        status.textContent = 'No motion sensor here — use the tap area below';
        return;
      }
      if (needsPermission()) {
        // iPhone: must be asked from a tap.
        btn.hidden = false;
        status.textContent = 'Tap “Enable motion” so the game can feel your swing';
        return;
      }
      start();
    }

    function start() {
      window.addEventListener('devicemotion', onMotion);
      listening = true;
      btn.hidden = true;
      status.textContent = 'Hold your phone like a paddle and swing';
      setTimeout(() => {
        if (!gotData) status.textContent = 'No motion data from this device — use the tap area below';
      }, 2500);
    }

    btn.addEventListener('click', async () => {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res === 'granted') start();
        else status.textContent = 'Motion was blocked — use the tap area, or allow it in Safari settings';
      } catch (_) {
        status.textContent = 'Couldn’t turn on motion — use the tap area below';
      }
    });

    function onMotion(e) {
      const r = e.rotationRate, a = e.acceleration, g = e.accelerationIncludingGravity;
      let gyro = 0, acc = 0;
      if (r && r.alpha != null) gyro = Math.hypot(r.alpha, r.beta || 0, r.gamma || 0);
      if (a && a.x != null) acc = Math.hypot(a.x, a.y || 0, a.z || 0);
      else if (g && g.x != null) acc = Math.abs(Math.hypot(g.x, g.y || 0, g.z || 0) - 9.81);
      if (r && r.alpha != null) gotData = true;
      if (a && a.x != null) gotData = true;
      feed(gyro, acc);
    }

    function feed(gyro, acc) {
      const now = performance.now();
      const strength = Math.max(gyro / GYRO_FULL, acc / ACC_FULL);
      level = Math.max(level, strength);
      if (mode !== 'motion' || !connected) return;
      if (!swinging && now >= coolUntil && (gyro > GYRO_TH || acc > ACC_TH)) {
        swinging = true;
        swingStart = now;
        peak = strength;
      }
      if (swinging) {
        peak = Math.max(peak, strength);
        if (now - swingStart >= PEAK_WINDOW) {
          swinging = false;
          coolUntil = now + COOLDOWN;
          fire(Math.min(1, Math.max(0.15, (peak - 0.2) / 0.8)));
        }
      }
    }

    function fire(power) {
      if (!connected) return;
      sendRaw({ t: 'swing', power: Math.round(power * 100) / 100 });
      haptic(12);
      paddle.classList.remove('swing');
      void paddle.offsetWidth; // restart the animation
      paddle.classList.add('swing');
      setTimeout(() => paddle.classList.remove('swing'), 220);
    }

    let shown = '';
    (function animate() {
      const w = Math.min(100, level * 100).toFixed(0) + '%';
      if (w !== shown && mode === 'motion') { meter.style.width = w; shown = w; }
      level *= 0.93;
      requestAnimationFrame(animate);
    })();

    $('#tapSwing').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      level = 0.6;
      fire(0.6);
    });

    return { prepare, feed };
  })();
  window.__motion = Motion; // lets tests inject fake sensor readings

  if (codeInput.value) nameInput.focus();
})();

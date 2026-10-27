// Mabar watch page: shows the host laptop's game as live video on a remote
// laptop/iPad, plus a QR code so the remote player can join with their phone.
(() => {
  'use strict';

  const R = window.MABAR;
  const $ = (s) => document.querySelector(s);

  const video = $('#video');
  const codeInput = $('#codeInput');
  const joinBtn = $('#joinBtn');

  let peer = null, conn = null, call = null;
  let code = '';
  let leaving = false;
  let retryTimer = null;

  codeInput.value = R.normalizeCode(new URLSearchParams(location.search).get('room'));
  codeInput.addEventListener('input', () => { codeInput.value = R.normalizeCode(codeInput.value); });

  function setMsg(text, bad = false) {
    const el = $('#joinMsg');
    el.textContent = text;
    el.className = 'msg' + (bad ? ' bad' : '');
  }

  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = R.normalizeCode(codeInput.value);
    if (c.length !== R.CODE_LENGTH) { setMsg('Enter the 4-letter code from the host’s screen', true); return; }
    watch(c);
  });

  function teardown() {
    clearTimeout(retryTimer);
    try { call && call.close(); } catch (_) {}
    try { conn && conn.close(); } catch (_) {}
    try { peer && peer.destroy(); } catch (_) {}
    call = conn = peer = null;
    video.srcObject = null;
    lastBeat = 0;
  }

  async function watch(c) {
    teardown();
    leaving = false;
    code = c;
    joinBtn.disabled = true;
    setMsg('Connecting…');

    let settled = false;
    const fail = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      teardown();
      joinBtn.disabled = false;
      showJoin(text, true);
    };
    const timer = setTimeout(() => fail('Found the room, but couldn’t connect from this network. Try another network, or check the host’s screen is still open.'), 20000);

    const opts = await R.peerOptionsAsync();
    if (settled) return;
    peer = new Peer(opts);

    // The host calls us back with the game video.
    peer.on('call', (incoming) => {
      call = incoming;
      call.answer(); // receive only
      call.on('stream', (stream) => {
        video.srcObject = stream;
        video.play().catch(() => {});
      });
      call.on('close', () => onDropped('The stream ended.'));
    });

    peer.on('open', () => {
      conn = peer.connect(R.PREFIX + code, { reliable: true, metadata: { role: 'viewer' } });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        showStage();
      });
      conn.on('data', onData);
      conn.on('close', () => onDropped('The host closed the room.'));
    });

    peer.on('error', (err) => {
      console.warn('[mabar] peer error', err.type, err);
      if (settled) return;
      if (err.type === 'peer-unavailable') fail(`No room called ${code}. Check the code on the host’s screen.`);
      else if (err.type === 'browser-incompatible') fail('This browser doesn’t support WebRTC.');
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) fail('Can’t reach the lobby server. Check your internet.');
      else fail('Couldn’t connect (' + err.type + ').');
    });
  }

  let lastBeat = 0;
  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    lastBeat = performance.now();
    if (msg.t === 'viewer-welcome' || msg.t === 'game') $('#gameName').textContent = msg.game || '';
  }

  function onDropped(text) {
    if (leaving || !peer) return;
    // One quiet retry covers a brief network blip; otherwise show the reason.
    teardown();
    showJoin(text + ' Reconnecting…');
    joinBtn.disabled = true;
    retryTimer = setTimeout(() => watch(code), 1500);
  }

  // ---------- Views ----------
  function showJoin(text, bad = false) {
    $('#stage').hidden = true;
    $('#join').hidden = false;
    setMsg(text || '', bad);
  }

  function showStage() {
    joinBtn.disabled = false;
    $('#join').hidden = true;
    $('#stage').hidden = false;
    $('#waiting').hidden = false;
    $('#codeLabel').textContent = code;

    // QR for the remote player's phone. remote=1 lets the game give them
    // extra timing allowance for the video delay.
    const ctrl = new URL('controller.html', location.href);
    ctrl.searchParams.set('room', code);
    ctrl.searchParams.set('remote', '1');
    if (R.peerServer) ctrl.searchParams.set('peer', R.peerServer);
    const qr = window.qrcode(0, 'M');
    qr.addData(ctrl.href);
    qr.make();
    $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    document.title = `Mabar — watching ${code}`;
  }

  video.addEventListener('playing', () => { $('#waiting').hidden = true; });

  // Stall detection: if frames stop arriving, say so.
  let lastTime = 0, still = 0;
  setInterval(() => {
    if ($('#stage').hidden || !video.srcObject) return;
    if (video.currentTime === lastTime) still++; else still = 0;
    lastTime = video.currentTime;
    if (lastBeat && performance.now() - lastBeat > 5000) { lastBeat = 0; onDropped('Lost the connection to the host.'); return; }
    const live = $('#live');
    live.textContent = still >= 3 ? '● Stalled' : '● Live';
    live.classList.toggle('stalled', still >= 3);
  }, 1000);

  // ---------- Controls ----------
  $('#cardToggle').addEventListener('click', () => {
    const card = $('#card');
    card.classList.toggle('min');
    $('#cardToggle').textContent = card.classList.contains('min') ? '+' : '–';
  });

  $('#leaveBtn').addEventListener('click', () => {
    leaving = true;
    teardown();
    showJoin('');
  });

  $('#fsBtn').addEventListener('click', () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // older iPad Safari
  });

  // Fade the top bar after a few idle seconds so it doesn't cover the game.
  let idleTimer = null;
  const wake = () => {
    $('#stage').classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => $('#stage').classList.add('idle'), 3000);
  };
  ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, wake));
  wake();

  // Keep the iPad/laptop screen awake while watching.
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();

  window.__watch = { get video() { return video; } };
})();

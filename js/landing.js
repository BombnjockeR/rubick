// Landing page: the island in 3D (turn it, tap a pin), floating panels, join-by-code.
(() => {
  'use strict';
  const R = window.MABAR;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Phones join games; hosting happens on a laptop or TV.
  const isPhone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  document.body.classList.toggle('is-phone', isPhone);

  // ---------- Join with a code ----------
  const input = $('#code');
  input.addEventListener('input', () => { input.value = R.normalizeCode(input.value); $('#joinMsg').textContent = ''; });
  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = R.normalizeCode(input.value);
    if (code.length !== R.CODE_LENGTH) {
      $('#joinMsg').textContent = 'Room codes are 4 letters. You’ll find it under the QR code on the big screen.';
      input.focus();
      return;
    }
    location.href = `controller.html?room=${code}`;
  });

  // ---------- Pins, dock chips and panels ----------
  // Each .panel in the HTML is one spot on the island: a pin on the 3D anchor it
  // names, a chip in the dock, and the panel itself. They work without the 3D too.
  const pinsBox = $('#pins');
  const dock = $('#dock');
  const spots = $$('.panel').map((panel) => {
    const id = panel.dataset.hot;
    const color = panel.dataset.color;
    panel.style.setProperty('--c', color);
    panel.tabIndex = -1;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'panel-x';
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.addEventListener('click', () => select(null));
    panel.prepend(x);
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.hidden = true;
    pin.style.setProperty('--c', color);
    pin.innerHTML = `<span class="pin-dot"></span><span class="pin-label">${panel.dataset.title}</span>`;
    pin.setAttribute('aria-label', `${panel.dataset.title}: look closer`);
    pin.addEventListener('click', () => select(id));
    pinsBox.append(pin);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = panel.dataset.title;
    chip.style.setProperty('--c', color);
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => select(selected === id ? null : id));
    dock.append(chip);
    return { id, panel, pin, chip, anchorName: panel.dataset.anchor, anchor: null };
  });
  let selected = null;
  const onSelect = [];
  function select(id) {
    selected = id;
    for (const s of spots) {
      const on = s.id === id;
      s.panel.hidden = !on;
      s.pin.classList.toggle('on', on);
      s.chip.classList.toggle('on', on);
      s.chip.setAttribute('aria-pressed', String(on));
      if (on) s.panel.focus({ preventScroll: true });
    }
    document.body.classList.toggle('has-panel', !!id);
    for (const fn of onSelect) fn(spots.find((s) => s.id === id) || null);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected) select(null); });
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => select(b.dataset.open)));
  window.__spots = { select, spots };

  // ---------- The island ----------
  const still = $('#islandStill');
  const canvas = $('#island');
  const loading = $('#loading');
  const loadBar = $('#loadBar');
  const hint = $('#hint');
  const gl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (_) { return false; } })();

  function fallback(err) {
    if (err) console.warn('[mabar] island fallback', err);
    canvas.hidden = true;
    still.hidden = false;
    pinsBox.hidden = true;
    document.body.classList.add('no-3d');
    loading.classList.add('done');
  }
  if (!gl) { fallback(); return; }

  function script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.append(s);
    });
  }

  script('vendor/three.mabar.min.js')
    .then(() => script('js/kit3d.js'))
    .then(() => Kit3D.load('assets/landing_island.glb', (p) => { loadBar.style.width = `${Math.round(p * 100)}%`; }))
    .then(start)
    .catch(fallback);

  // Orbit camera: drag to turn, wheel or pinch to zoom, a slow turn by itself when
  // idle. Values ease toward their goals, which also gives the intro dolly and the
  // flight to a pin.
  function makeOrbit(camera) {
    const PHI = [0.42, 1.3];        // from the vertical: 0 = straight down the Y axis
    const RADIUS = [12, 120];
    const view = { theta: -1.5, phi: 1.12, radius: 118 };          // starts far out: the intro
    const goal = { theta: -0.55, phi: 1.02, radius: 44 };
    const target = new THREE.Vector3(0, 0.6, 0);
    const goalT = target.clone();
    // shift: on wide screens the island sits right of centre, clear of the headline card.
    const state = { idle: 0, damp: 2.4, fit: 44, auto: !reduce, busy: false, shift: 0, shiftCur: 0 };
    const eff = new THREE.Vector3();
    const pointers = new Map();
    let drag = null, pinch = 0;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const wake = () => { state.idle = 0; hint.classList.add('gone'); };

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, vx: 0, t: performance.now() };
      else { drag = null; pinch = pinchDist(); }
      wake();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size >= 2) {
        const d = pinchDist();
        if (pinch > 0) goal.radius = clamp(goal.radius * (pinch / d), RADIUS[0], RADIUS[1]);
        pinch = d;
      } else if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        const now = performance.now();
        goal.theta -= dx * 0.0062;
        goal.phi = clamp(goal.phi - dy * 0.0045, PHI[0], PHI[1]);
        drag.vx = dx / Math.max(1, now - drag.t);
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.t = now;
      }
      wake();
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (drag && pointers.size === 0 && performance.now() - drag.t < 60) goal.theta -= drag.vx * 0.9; // flick
      drag = null;
      pinch = 0;
      if (pointers.size === 1) { const p = pointers.values().next().value; drag = { x: p.x, y: p.y, vx: 0, t: performance.now() }; }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      goal.radius = clamp(goal.radius * Math.exp(e.deltaY * 0.0012), RADIUS[0], RADIUS[1]);
      wake();
    }, { passive: false });
    function pinchDist() {
      const [a, b] = Array.from(pointers.values());
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    }

    return {
      goal, view, target, state,
      // The whole island in view, whatever the screen shape (portrait screens back off).
      fit(aspect) {
        state.fit = clamp(44 * Math.max(1, Math.pow(1.25 / aspect, 0.6)), RADIUS[0], RADIUS[1]);
        state.shift = !isPhone && aspect > 1.15 ? 5.5 : 0;
        state.narrow = aspect < 0.9;      // tall screens: the cards sit at the bottom, so the island rides high
        if (!state.busy) goal.radius = state.fit;
      },
      // Fly to a pin: the panel sits on the right (bottom on phones), so the spot is
      // framed left of centre (above centre on phones).
      focus(point) {
        state.busy = true;
        goalT.copy(point);
        if (!state.narrow) goalT.add(new THREE.Vector3(Math.cos(view.theta), 0, -Math.sin(view.theta)).multiplyScalar(3.4));
        goal.radius = state.narrow ? 26 : 18;
        goal.phi = 0.95;
      },
      home() {
        state.busy = false;
        goalT.set(0, 0.6, 0);
        goal.radius = state.fit;
        goal.phi = 1.02;
      },
      update(dt) {
        state.idle += dt;
        if (state.auto && !state.busy && state.idle > 3) goal.theta += 0.045 * dt;
        const k = 1 - Math.exp(-dt * state.damp);
        view.theta += (goal.theta - view.theta) * k;
        view.phi += (goal.phi - view.phi) * k;
        view.radius += (goal.radius - view.radius) * k;
        target.lerp(goalT, k);
        state.shiftCur += ((state.busy ? 0 : state.shift) - state.shiftCur) * k;
        const lift = state.narrow ? (state.busy ? 0.24 : 0.2) : 0;    // fraction of the view height
        state.liftCur = (state.liftCur || 0) + (lift - (state.liftCur || 0)) * k;
        if (state.damp < 6 && Math.abs(view.radius - goal.radius) < 2) state.damp = 6;   // the intro is over
        // the point at the centre of the screen: the target, pushed left along the camera's right
        // axis (wide screens) or down (tall screens), so the island clears the cards
        const visH = 2 * view.radius * Math.tan(camera.fov * Math.PI / 360);
        eff.set(target.x - Math.cos(view.theta) * state.shiftCur, target.y - state.liftCur * visH,
          target.z + Math.sin(view.theta) * state.shiftCur);
        const s = Math.sin(view.phi) * view.radius;
        camera.position.set(eff.x + s * Math.sin(view.theta), eff.y + Math.cos(view.phi) * view.radius, eff.z + s * Math.cos(view.theta));
        camera.lookAt(eff);
      },
    };
  }

  function start(gltf) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 2));
    renderer.shadowMap.enabled = !isPhone;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0); // the CSS sky shows through

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#d9eeff', 75, 160);
    const world = gltf.scene;
    scene.add(world);
    Kit3D.lights(scene, { size: 20, target: [0, 0, 0], sun: [16, 26, 14] });

    // Nodes by name (the contract with art/landing_island.py): pin anchors, what the
    // wind moves, and what hides a pin when the island turns its back.
    const trees = [], flags = [], clouds = [], occluders = [];
    world.traverse((o) => {
      const n = o.name;
      if (n.startsWith('tree_')) trees.push({ o, base: o.rotation.clone(), ph: Math.random() * 7 });
      else if (n.startsWith('bunt_') && o.isMesh && o.morphTargetInfluences) flags.push({ o, ph: Math.random() * 7 });
      else if (n.startsWith('cloud_') && !n.includes('_', 6)) {
        clouds.push({ o, w: 0.006 + Math.random() * 0.012, r: Math.hypot(o.position.x, o.position.z), a: Math.atan2(o.position.x, o.position.z), y: o.position.y });
        o.castShadow = false;
      } else if (n === 'land' || n === 'rocks') occluders.push(o);
    });
    for (const s of spots) {
      s.anchor = world.getObjectByName(s.anchorName);
      if (!s.anchor) console.warn('[mabar] no anchor', s.anchorName);
    }

    const mixer = new THREE.AnimationMixer(world);
    for (const clip of gltf.animations) mixer.clipAction(clip).play();

    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
    const orbit = makeOrbit(camera);
    let W = 1, H = 1;
    function resize() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      orbit.fit(camera.aspect);
      const copy = $('#copy');
      document.documentElement.style.setProperty('--copy-h', `${copy.offsetHeight}px`);
    }
    window.addEventListener('resize', resize);
    resize();
    orbit.view.radius = Math.max(orbit.view.radius, orbit.state.fit * 2.4);

    onSelect.push((spot) => {
      if (spot && spot.anchor) orbit.focus(spot.anchor.getWorldPosition(new THREE.Vector3()));
      else orbit.home();
    });

    // Pins follow their anchors; a pin behind the island (seen from the back) dims.
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector3(), dir = new THREE.Vector3();
    let frame = 0;
    function placePins() {
      const checkOcclusion = frame % 4 === 0;
      for (const s of spots) {
        if (!s.anchor) continue;
        s.anchor.getWorldPosition(v);
        if (checkOcclusion) {
          dir.copy(v).sub(camera.position);
          const dist = dir.length();
          ray.set(camera.position, dir.normalize());
          ray.far = dist - 0.4;
          s.pin.classList.toggle('behind', ray.intersectObjects(occluders, true).length > 0);
        }
        v.project(camera);
        const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        s.pin.hidden = !on;
        if (on) s.pin.style.transform = `translate(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px)`;
      }
    }

    const clock = new THREE.Clock();
    let shown = false;
    function tick() {
      requestAnimationFrame(tick);
      if (document.hidden) { clock.getDelta(); return; }
      const dt = Math.min(0.1, clock.getDelta());
      const t = clock.elapsedTime;
      frame++;
      if (!reduce) {
        mixer.update(dt);
        // Wind: a slow gust envelope over the tree sway, the flags' flutter and the clouds' drift.
        const gust = 0.6 + 0.4 * Math.sin(t * 0.45) * Math.sin(t * 0.13 + 1);
        for (const tr of trees) {
          tr.o.rotation.x = tr.base.x + 0.028 * gust * Math.sin(t * 1.6 + tr.ph);
          tr.o.rotation.z = tr.base.z + 0.022 * gust * Math.sin(t * 1.1 + tr.ph * 1.7);
        }
        for (const f of flags) f.o.morphTargetInfluences[0] = (0.45 + 0.5 * gust) * Math.sin(t * 6.5 + f.ph);
        for (const c of clouds) {
          c.a += c.w * dt;
          c.o.position.set(Math.sin(c.a) * c.r, c.y, Math.cos(c.a) * c.r);
        }
      }
      orbit.update(dt);
      placePins();
      renderer.render(scene, camera);
      if (!shown) {
        shown = true;
        loading.classList.add('done');
        still.hidden = true;
      }
    }
    tick();
    window.__hero = { renderer, scene, camera, orbit, world, select }; // debugging, the still image, smoke tests
  }
})();

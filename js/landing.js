// Landing page: phone detection, join-by-code, and the live 3D island hero.
(() => {
  'use strict';
  const R = window.MABAR;
  const $ = (s) => document.querySelector(s);

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

  // ---------- Hero ----------
  const still = $('#islandStill');
  const canvas = $('#island');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (_) { return false; } })();

  if (isPhone || !gl) {
    // Save the phone's data and battery: a still of the island is enough.
    canvas.hidden = true;
    still.hidden = false;
    return;
  }

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
    .then(() => Kit3D.load('assets/menu.glb'))
    .then(start)
    .catch((e) => { console.warn('[mabar] hero fallback', e); canvas.hidden = true; still.hidden = false; });

  function start(gltf) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#e4f3ff', 34, 62);
    scene.add(gltf.scene);
    // The island floats in the sky here: hide the ground and the distant city.
    const city = gltf.scene.getObjectByName('env_city');
    if (city) city.visible = false;
    Kit3D.lights(scene, { size: 12, target: [0, 0, 0], sun: [9, 16, 6] });

    const mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) mixer.clipAction(clip).play();

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
    const base = new THREE.Vector3(0.42, 0.62, 0.62).normalize();

    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

    const clock = new THREE.Clock();
    let shown = false;
    function frame() {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) { clock.getDelta(); return; }
      const dt = Math.min(0.1, clock.getDelta());
      mixer.update(dt);
      // A slow sway around the island (none if the visitor prefers less motion).
      const t = reduce ? 0 : clock.elapsedTime;
      const yaw = Math.sin(t * 0.12) * 0.22;
      const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const wide = camera.aspect > 1.1;
      const look = new THREE.Vector3(0, 0.6, 0.4);
      // keep the island to the right of the headline on wide screens
      const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
      if (wide) look.addScaledVector(right, -6.2);
      camera.position.copy(look).addScaledVector(dir, wide ? 34 : 36);
      camera.lookAt(look);
      renderer.render(scene, camera);
      if (!shown) { shown = true; still.hidden = true; }
    }
    frame();
    window.__hero = { renderer, scene, camera }; // used to make the still image
  }
})();

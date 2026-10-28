// Shared 3D helpers for the screen: renderer setup, lights and a cached
// glTF loader for the Blender-made assets in assets/*.glb.
(() => {
  'use strict';
  const cache = new Map();

  window.Kit3D = {
    // Load a .glb once; later calls reuse it. onProgress(0..1) is optional.
    load(url, onProgress) {
      if (!cache.has(url)) {
        cache.set(url, new Promise((resolve, reject) => {
          const loader = new THREE.GLTFLoader();
          loader.setMeshoptDecoder(THREE.MeshoptDecoder); // assets are meshopt-compressed
          loader.load(
            new URL(url, document.baseURI).href, // same as the page URL unless a <base> is set
            (gltf) => {
              gltf.scene.traverse((o) => {
                if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
              });
              resolve(gltf);
            },
            (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); },
            (err) => { cache.delete(url); reject(err); },
          );
        }));
      }
      return cache.get(url);
    },

    // A full-screen WebGL canvas behind the 2D HUD canvas (#arena).
    // Class "gl-layer" lets the hub include it in the remote-screen stream.
    renderer(hub) {
      const canvas = document.createElement('canvas');
      canvas.className = 'gl-layer';
      Object.assign(canvas.style, {
        position: 'fixed', inset: '0', width: '100vw', height: '100vh', display: 'block', pointerEvents: 'none',
      });
      const arena = document.querySelector('#arena');
      arena.parentNode.insertBefore(canvas, arena);
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(hub.W, hub.H, false);
      r.shadowMap.enabled = true;
      r.toneMapping = THREE.NeutralToneMapping; // keeps colors saturated ("pop")
      r.toneMappingExposure = 1.05;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.dispose_ = () => {
        try { r.dispose(); r.forceContextLoss(); } catch (_) {}
        canvas.remove();
      };
      return r;
    },

    // Breathes life into an environment .glb by node name (the contract the Blender
    // scripts in art/ follow): baked clips play on a mixer; tree_* sway about their
    // base; meshes under flag_* / bunt_* flutter through their "wave" morph target;
    // crowd_* bob in their seats and jump on cheer(); umbrella_* wobble; cloud_*
    // drift around the origin; steam_* puffs rise and fade; materials named sea,
    // shallows or water get a scrolling ripple texture. Nothing is required: a file
    // without these nodes just plays its clips (or nothing). Returns
    // { update(dt, t), cheer(strength), dispose() }.
    liven(gltf, { wind = 1 } = {}) {
      const root = gltf.scene;
      const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
      if (mixer) for (const clip of gltf.animations) mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
      const trees = [], flags = [], crowd = [], umbrellas = [], clouds = [], steams = [], waters = [];
      const rnd = () => Math.random() * Math.PI * 2;
      root.traverse((o) => {
        const n = o.name || '';
        if (/^tree_\d+$/.test(n)) trees.push({ o, rx: o.rotation.x, rz: o.rotation.z, ph: rnd() });
        else if (/^crowd_\d+$/.test(n)) crowd.push({ o, y: o.position.y, ph: rnd(), cheer: 0, delay: 0 });
        else if (/^umbrella_\d+$/.test(n)) umbrellas.push({ o, ph: rnd() });
        else if (/^cloud_\d+$/.test(n)) clouds.push({ o, a: Math.atan2(o.position.x, o.position.z), r: Math.hypot(o.position.x, o.position.z), w: 0.004 + Math.random() * 0.004 });
        else if (/^steam_\d+$/.test(n)) steams.push({ o, y: o.position.y, ph: Math.random() });
        if (o.isMesh) {
          if (/^(flag|bunt)_\d+/.test(n) && o.morphTargetInfluences && o.morphTargetInfluences.length) {
            flags.push({ m: o, ph: rnd(), rate: 4 + Math.random() * 3, amp: /^flag/.test(n) ? 0.9 : 1 });
          }
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (m && /^(sea|shallows|water)/.test(m.name) && o.geometry.attributes.uv) waters.push(ripple(m));
        }
      });
      // A faint ripple texture (bright streaks on white) multiplied over the water colour.
      function ripple(m) {
        if (!m.userData.ripple) {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const g = c.getContext('2d');
          g.fillStyle = '#e4ecf0';
          g.fillRect(0, 0, 256, 256);
          g.strokeStyle = 'rgba(255,255,255,0.55)';
          g.lineWidth = 3;
          for (let i = 0; i < 46; i++) {
            const x = Math.random() * 256, y = Math.random() * 256, r = 10 + Math.random() * 26;
            g.beginPath(); g.arc(x, y, r, Math.PI * 0.1, Math.PI * 0.6); g.stroke();
            g.beginPath(); g.arc((x + 128) % 256, (y + 128) % 256, r * 0.7, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
          }
          const tex = new THREE.CanvasTexture(c);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          m.map = tex;
          m.needsUpdate = true;
          m.userData.ripple = { tex, speed: m.name === 'shallows' ? 0.05 : 0.025 };
        }
        return m.userData.ripple;
      }
      let gust = 1, t0 = 0;
      return {
        update(dt, t) {
          t0 = t;
          if (mixer) mixer.update(dt);
          gust = wind * (0.6 + 0.4 * Math.sin(t * 0.45) * Math.sin(t * 0.13 + 1));
          for (const e of trees) {
            e.o.rotation.x = e.rx + 0.03 * gust * Math.sin(t * 1.5 + e.ph);
            e.o.rotation.z = e.rz + 0.022 * gust * Math.sin(t * 1.1 + e.ph * 1.7);
          }
          for (const f of flags) f.m.morphTargetInfluences[0] = f.amp * (0.4 + 0.5 * gust) * Math.sin(t * f.rate + f.ph);
          for (const u of umbrellas) {
            u.o.rotation.x = 0.02 * gust * Math.sin(t * 1.3 + u.ph);
            u.o.rotation.z = 0.02 * gust * Math.sin(t * 0.9 + u.ph);
          }
          for (const c of crowd) {
            let y = 0.04 * Math.max(0, Math.sin(t * 2.2 + c.ph));     // a lazy bob while watching
            if (c.delay > 0) c.delay -= dt;
            else if (c.cheer > 0) {                                     // jumps when a point is won
              c.cheer -= dt;
              y += 0.45 * Math.abs(Math.sin(t * 7 + c.ph));
            }
            c.o.position.y = c.y + y;
          }
          for (const c of clouds) {
            c.a += c.w * dt;
            c.o.position.x = Math.sin(c.a) * c.r;
            c.o.position.z = Math.cos(c.a) * c.r;
          }
          for (const s of steams) {
            const u = (t * 0.4 + s.ph) % 1;
            s.o.position.y = s.y + u * 1.2;
            s.o.scale.setScalar(0.25 + 0.9 * Math.pow(Math.sin(Math.PI * u), 0.8));
          }
          for (const w of waters) { w.tex.offset.x = t * w.speed; w.tex.offset.y = t * w.speed * 0.6; }
        },
        // strength 1: a point; 2: the match (everyone, longer).
        cheer(strength = 1) {
          for (const c of crowd) {
            if (strength < 2 && Math.random() > 0.7) continue;
            c.delay = Math.random() * 0.25;
            c.cheer = (strength >= 2 ? 3.5 : 1.4) + Math.random() * 0.5;
          }
        },
        dispose() {
          if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(root); }
          for (const c of crowd) c.o.position.y = c.y;
        },
      };
    },

    // A sky dome: a big inside-out sphere with a vertex-colour gradient from the
    // horizon up to the zenith (fog-free, drawn first). Scenes with a flat
    // background colour look like a studio; this one looks like a day outside.
    skyDome({ zenith = '#2f7fe0', horizon = '#cfeeff', radius = 370, blend = 0.55 } = {}) {
      const geo = new THREE.SphereGeometry(radius, 32, 16);
      const z = new THREE.Color(zenith), h = new THREE.Color(horizon), c = new THREE.Color();
      const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const t = Math.max(0, pos.getY(i) / radius) / blend;
        const k = t >= 1 ? 1 : t * t * (3 - 2 * t);
        c.copy(h).lerp(z, k);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
      mesh.name = 'sky';
      mesh.renderOrder = -1;
      mesh.frustumCulled = false;
      return mesh;
    },

    // Bright, warm "toy diorama" lighting. `hemi` / `ground` tint the sky and
    // bounce light, `hemiIntensity` / `keyIntensity` set the balance (a lower
    // hemisphere and a stronger sun give more shape to an outdoor scene).
    lights(scene, { size = 12, target = [0, 0, 0], sun = [8, 14, 7], hemi = '#fff8ee', ground = '#d9c9ad', hemiIntensity = 1.75, keyIntensity = 2.9, keyColor = '#fff2dc' } = {}) {
      const hemi_ = new THREE.HemisphereLight(hemi, ground, hemiIntensity);
      scene.add(hemi_);
      const key = new THREE.DirectionalLight(keyColor, keyIntensity);
      key.position.set(target[0] + sun[0], target[1] + sun[1], target[2] + sun[2]);
      key.target.position.set(...target);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 60 });
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.02;
      key.shadow.radius = 3;
      scene.add(key, key.target);
      const rim = new THREE.DirectionalLight('#d8e8ff', 0.6);
      rim.position.set(target[0] - 8, target[1] + 6, target[2] - 6);
      scene.add(rim);
      return { hemi: hemi_, key, rim };
    },
  };
})();

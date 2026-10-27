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

    // Bright, warm "toy diorama" lighting.
    lights(scene, { size = 12, target = [0, 0, 0], sun = [8, 14, 7] } = {}) {
      const hemi = new THREE.HemisphereLight('#fff8ee', '#d9c9ad', 1.75);
      scene.add(hemi);
      const key = new THREE.DirectionalLight('#fff2dc', 2.9);
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
      return { hemi, key, rim };
    },
  };
})();

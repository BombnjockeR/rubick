// Main menu: a 3D diorama (assets/menu.glb, built in Blender by art/menu_scene.py)
// with looping animated characters, plus "GAME SELECT" cards drawn on the HUD
// canvas so remote screens see them too.
//
// Controls: phone stick / d-pad up-down to choose, A to play.
// Laptop: arrow keys / WASD + Enter, or click a card.
MabarGames.register({
  id: 'menu',
  name: 'Menu',
  hidden: true,
  controls: 'pad',

  create(hub) {
    const B = hub.B;
    // stars = popularity (placeholder until voting exists)
    const GAMES = [
      { id: 'tennis', title: 'TENNIS', node: 'plat_tennis', rim: 'rim_tennis', color: '#2f7dff', stars: 4.5, tag: 'Swing your phone · 1–4 players' },
      { id: 'pingpong', title: 'TABLE TENNIS', node: 'plat_tt', rim: 'rim_tt', color: '#8b5cf6', stars: 4, tag: 'Swing your phone · 1–4 players' },
      { id: 'cooking', title: 'COOKING', node: 'plat_cook', rim: 'rim_cook', color: '#ff4b3e', stars: 3.5, tag: 'Co-op kitchen chaos · 1–4 players' },
      { id: null, title: 'COMING SOON', node: 'plat_soon', rim: 'rim_soon', color: '#9a9184', stars: 0, tag: 'Something new is being built…' },
    ];

    let sel = 0;
    let renderer = null, scene = null, camera = null, mixer = null;
    let loadP = 0, loadErr = null, stopped = false;
    const plats = [];       // { node, baseY, lift, glow, rimMat, rimColor }
    const cards = [];       // screen rects for hit-testing
    let toast = null;
    let hover = -1;
    const navT = new Map(); // per-player stick repeat timer
    const camLook = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    let lastT = performance.now();

    // ---------------- 3D setup ----------------
    function setup(gltf) {
      renderer = Kit3D.renderer(hub);
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#f8f2e9');
      scene.fog = new THREE.Fog('#f8f2e9', 30, 50);
      scene.add(gltf.scene);
      Kit3D.lights(scene, { size: 12, target: [0, 0, 0], sun: [9, 16, 6] });

      mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) mixer.clipAction(clip).setLoop(THREE.LoopRepeat).play();

      for (const g of GAMES) {
        const node = gltf.scene.getObjectByName(g.node);
        const rim = gltf.scene.getObjectByName(g.rim);
        let rimMat = null, glow = null;
        if (rim) {
          const mesh = rim.isMesh ? rim : rim.getObjectByProperty('isMesh', true);
          if (mesh && mesh.userData.glow) {          // second visit: reuse
            rimMat = mesh.material;
            glow = mesh.userData.glow;
          } else if (mesh) {
            rimMat = mesh.material.clone();
            mesh.material = rimMat;
            // Soft additive halo around the rim for the selected platform
            glow = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
              color: g.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            glow.scale.set(1.035, 1.6, 1.045);
            mesh.add(glow);
            mesh.userData.glow = glow;
          }
        }
        if (node && node.userData.baseY === undefined) node.userData.baseY = node.position.y;
        plats.push({ node, baseY: node ? node.userData.baseY : 0, lift: 0, glow, rimMat, rimColor: new THREE.Color(g.color) });
      }

      camera = new THREE.PerspectiveCamera(30, hub.W / hub.H, 0.1, 120);
      aimCamera(true);
    }

    // Camera sits front-right and high, like an isometric shot, and drifts a
    // little toward the selected platform.
    function aimCamera(snap) {
      const p = plats[sel] && plats[sel].node ? plats[sel].node.position : new THREE.Vector3();
      const wide = hub.W / hub.H;
      const dist = wide < 1.2 ? 32 : 26.5;
      // Looking from the front-right and high up, the terrace runs from the
      // top of the screen down to the bottom-left, like the reference.
      const dir = new THREE.Vector3(0.42, 0.78, 0.62).normalize();
      const look = new THREE.Vector3(p.x * 0.18, 0.9 + p.y * 0.15, 1.3 + p.z * 0.18);
      // push the diorama left so the cards have room on the right
      const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
      if (wide >= 1.2) look.addScaledVector(right, 3.7);
      const pos = look.clone().addScaledVector(dir, dist);
      if (snap) { camLook.copy(look); camPos.copy(pos); } else {
        camLook.lerp(look, 0.06);
        camPos.lerp(pos, 0.06);
      }
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }

    // ---------------- selection ----------------
    function move(d) {
      sel = (sel + d + GAMES.length) % GAMES.length;
      for (const p of hub.players.values()) hub.rumble(p, 10);
    }

    function choose() {
      const g = GAMES[sel];
      if (!g.id || !MabarGames.get(g.id)) {
        toast = { text: g.id ? `${g.title} is coming soon!` : 'This one is still being built!', t: 0 };
        return;
      }
      hub.setGame(g.id);
    }

    // ---------------- mouse ----------------
    const arena = document.querySelector('#arena');
    function hit(e) {
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (c && e.clientX >= c.x && e.clientX <= c.x + c.w && e.clientY >= c.y && e.clientY <= c.y + c.h) return i;
      }
      // or near a platform on screen
      for (let i = 0; i < plats.length; i++) {
        const s = screenOf(i);
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < Math.min(hub.W, hub.H) * 0.12) return i;
      }
      return -1;
    }
    const onMove = (e) => { hover = hit(e); arena.style.cursor = hover >= 0 ? 'pointer' : ''; };
    const onClick = (e) => {
      const i = hit(e);
      if (i < 0) return;
      if (i === sel) choose(); else sel = i;
    };
    arena.addEventListener('pointermove', onMove);
    arena.addEventListener('click', onClick);

    function screenOf(i) {
      const p = plats[i];
      if (!p || !p.node || !camera) return null;
      const v = p.node.getWorldPosition(new THREE.Vector3()).project(camera);
      return { x: (v.x + 1) / 2 * hub.W, y: (1 - v.y) / 2 * hub.H };
    }

    // ---------------- HUD drawing ----------------
    function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

    function slant(ctx, x, y, w, h, k) {
      ctx.beginPath();
      ctx.moveTo(x + k, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w - k, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    }

    function star(ctx, cx, cy, r, fill) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const rr2 = i % 2 ? r * 0.45 : r;
        ctx.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    function stars(ctx, x, y, r, value, on, off) {
      for (let i = 0; i < 5; i++) {
        const cx = x + i * r * 2.4;
        star(ctx, cx, y, r, off);
        const f = Math.max(0, Math.min(1, value - i));
        if (f > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(cx - r, y - r, r * 2 * f, r * 2);
          ctx.clip();
          star(ctx, cx, y, r, on);
          ctx.restore();
        }
      }
    }

    function drawCards(ctx, time) {
      const { W, H } = hub;
      const compact = W < 900;
      const cw = compact ? Math.min(W - 32, 340) : Math.min(520, W * 0.36);
      const ch = compact ? 64 : Math.max(70, Math.min(104, H * 0.11));
      const gap = compact ? 10 : ch * 0.4;
      const total = GAMES.length * ch + (GAMES.length - 1) * gap;
      const top = compact ? H - total - 90 : Math.min(Math.max(H * 0.15, (H - total) / 2 - H * 0.02), H - total - 96);
      cards.length = 0;
      GAMES.forEach((g, i) => {
        const on = i === sel;
        const y = top + i * (ch + gap);
        // cards step left as they go down, like a staircase
        const x = compact ? (W - cw) / 2 : W - cw - W * 0.04 - i * Math.min(70, W * 0.045) + (on ? -18 : 0);
        const k = ch * 0.32;
        cards[i] = { x, y, w: cw, h: ch };
        ctx.save();
        if (on) {
          const grd = ctx.createLinearGradient(x, y, x + cw, y + ch);
          grd.addColorStop(0, '#1e6bff');
          grd.addColorStop(1, '#4f9bff');
          ctx.shadowColor = 'rgba(30,107,255,0.55)';
          ctx.shadowBlur = 28;
          slant(ctx, x, y, cw, ch, k);
          ctx.fillStyle = grd;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 2;
          ctx.stroke();
          // pointer triangle
          if (!compact) {
            const px = x + k * 0.55 + 8, py = y + ch / 2, s = ch * 0.2;
            const pulse = 0.6 + 0.4 * Math.sin(time / 300);
            ctx.beginPath();
            ctx.moveTo(px - s * 0.2, py);
            ctx.lineTo(px + s, py - s);
            ctx.lineTo(px + s, py + s);
            ctx.closePath();
            ctx.strokeStyle = `rgba(255,255,255,${0.7 + 0.3 * pulse})`;
            ctx.lineWidth = 4;
            ctx.shadowColor = '#bfe0ff';
            ctx.shadowBlur = 14 * pulse;
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        } else {
          slant(ctx, x, y, cw, ch, k);
          ctx.fillStyle = i === hover ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.42)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        // number
        const numX = x + (compact ? k + 14 : k + ch * 0.62 + 10);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = hub.font(800, ch * 0.66);
        ctx.fillStyle = on ? '#ffffff' : g.id ? '#3b3b3b' : '#8d877e';
        ctx.fillText(String(i + 1).padStart(2, '0'), numX, y + ch / 2 + 2);
        const nw = ctx.measureText('00').width;
        // title + stars
        const tx = numX + nw + ch * 0.3;
        ctx.font = hub.font(800, ch * 0.28);
        ctx.fillStyle = on ? '#ffffff' : g.id ? '#2a2a2a' : '#7d776e';
        ctx.fillText(g.title, tx, y + ch * 0.36);
        stars(ctx, tx + ch * 0.1, y + ch * 0.7, ch * 0.1, g.stars, '#ffd32a', on ? 'rgba(255,255,255,0.45)' : 'rgba(80,80,80,0.28)');
        ctx.restore();
      });
    }

    function drawHeader(ctx) {
      const { W, H } = hub;
      if (W < 900) return;
      const x = W * 0.05, y = H * 0.1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#2b2b2b';
      ctx.font = hub.font(800, Math.max(34, W * 0.032));
      ctx.fillText('GAME SELECT', x, y);
      ctx.fillStyle = '#8a8378';
      ctx.font = hub.font(500, Math.max(14, W * 0.011));
      ctx.fillText('Pick a game and play with your friends!', x + 2, y + Math.max(24, W * 0.018));
      ctx.fillStyle = '#9b9488';
      ctx.fillRect(x + 2, y + Math.max(42, W * 0.03), 30, 3);
    }

    // No QR on the menu: the host picks a game first, friends join in its
    // lobby. Once people are connected, show who's here.
    function drawJoin(ctx) {
      const { W, H } = hub;
      const players = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
      if (!players.length || W < 900) return;
      const x = W * 0.05, y = H * 0.1 + Math.max(58, W * 0.04);
      ctx.font = hub.font(700, 14);
      let w = 28;
      for (const p of players) w += ctx.measureText(p.name).width + 34;
      rr(ctx, x, y, Math.min(w, W * 0.42), 40, 20);
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.fill();
      let px = x + 16;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const p of players) {
        if (px > x + W * 0.42 - 40) break;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(px + 6, y + 20, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1d2433';
        ctx.fillText(p.name, px + 17, y + 21);
        px += ctx.measureText(p.name).width + 34;
      }
    }

    function drawFooter(ctx) {
      const { W, H } = hub;
      const g = GAMES[sel];
      ctx.textAlign = W < 900 ? 'center' : 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = hub.font(600, 14);
      ctx.fillStyle = 'rgba(60,55,48,0.7)';
      const x = W < 900 ? W / 2 : W - W * 0.04;
      ctx.fillText(g.tag, x, H - 52);
      ctx.fillStyle = 'rgba(60,55,48,0.5)';
      ctx.font = hub.font(500, 13);
      ctx.fillText(hub.players.size
        ? 'Choose with the phone stick and A, or ↑ ↓ and Enter here'
        : 'Pick a game with ↑ ↓ and Enter, or click it. Friends join with a QR code in its lobby.', x, H - 30);
    }

    function drawToast(ctx, dt) {
      if (!toast) return;
      toast.t += dt;
      if (toast.t > 2.2) { toast = null; return; }
      const a = Math.min(1, toast.t * 5, (2.2 - toast.t) * 3);
      ctx.globalAlpha = a;
      ctx.font = hub.font(700, 18);
      const w = ctx.measureText(toast.text).width + 48;
      rr(ctx, (hub.W - w) / 2, hub.H * 0.08, w, 46, 23);
      ctx.fillStyle = 'rgba(30,30,36,0.85)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(toast.text, hub.W / 2, hub.H * 0.08 + 24);
      ctx.globalAlpha = 1;
    }

    // ---------------- load ----------------
    Kit3D.load('assets/menu.glb', (p) => { loadP = p; })
      .then((gltf) => { if (!stopped) setup(gltf); })
      .catch((e) => { loadErr = 'Couldn’t load the menu (' + (e.message || e) + ')'; console.error(e); });

    return {
      start() { hub.showLobby(false, false); },

      stop() {
        stopped = true;
        arena.removeEventListener('pointermove', onMove);
        arena.removeEventListener('click', onClick);
        arena.style.cursor = '';
        if (mixer) mixer.stopAllAction();
        if (renderer) renderer.dispose_();
        // detach the cached scene so the next visit can re-add it cleanly
        if (scene) scene.clear();
      },

      press(p, bits) {
        if (bits & (B.UP | B.LEFT)) move(-1);
        if (bits & (B.DOWN | B.RIGHT)) move(1);
        if (bits & (B.A | B.MENU)) choose();
      },

      hint() {
        const g = GAMES[sel];
        return `Menu: ${g.title.charAt(0) + g.title.slice(1).toLowerCase()} · ↑↓ to choose, A to play`;
      },

      meta() { return 'in menu'; },

      resize() {
        if (renderer) renderer.setSize(hub.W, hub.H, false);
        if (camera) { camera.aspect = hub.W / hub.H; camera.updateProjectionMatrix(); aimCamera(true); }
      },

      update(dt) {
        // analog stick navigation with repeat
        for (const p of hub.players.values()) {
          if (p.id === 'kb') continue;
          const y = p.sy;
          let t = navT.get(p.id) || 0;
          if (Math.abs(y) > 0.6) {
            if (t <= 0) { move(y > 0 ? 1 : -1); t = 0.32; } else t -= dt;
          } else t = 0;
          navT.set(p.id, t);
        }
        if (mixer) mixer.update(dt);
        plats.forEach((pl, i) => {
          const on = i === sel;
          pl.lift += ((on ? 0.22 : 0) - pl.lift) * Math.min(1, dt * 7);
          if (pl.node) pl.node.position.y = pl.baseY + pl.lift;
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350);
          if (pl.rimMat) pl.rimMat.emissive.copy(pl.rimColor).multiplyScalar(on ? 0.35 + 0.25 * pulse : 0);
          if (pl.glow) pl.glow.material.opacity = on ? 0.18 + 0.14 * pulse : Math.max(0, pl.glow.material.opacity - dt);
        });
      },

      draw(ctx, time) {
        const dt = Math.min(0.1, (time - lastT) / 1000);
        lastT = time;
        const { W, H } = hub;
        ctx.clearRect(0, 0, W, H);
        if (!renderer) {
          ctx.fillStyle = '#f4ebdd';
          ctx.fillRect(0, 0, W, H);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#8a8378';
          ctx.font = hub.font(600, 18);
          ctx.fillText(loadErr || `Building the world… ${Math.round(loadP * 100)}%`, W / 2, H / 2);
          rr(ctx, W / 2 - 120, H / 2 + 26, 240, 8, 4);
          ctx.fillStyle = '#e6dccb';
          ctx.fill();
          rr(ctx, W / 2 - 120, H / 2 + 26, 240 * loadP, 8, 4);
          ctx.fillStyle = '#1e6bff';
          ctx.fill();
          return;
        }
        aimCamera(false);
        renderer.render(scene, camera);
        drawHeader(ctx);
        drawCards(ctx, time);
        drawJoin(ctx);
        drawFooter(ctx);
        drawToast(ctx, dt);
      },
    };
  },
});

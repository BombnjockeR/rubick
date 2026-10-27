// Cooking: Overcooked-style co-op kitchen for 1-4 chefs.
//
// Orders arrive at the top of the screen; the team cooks and serves them
// before their timers run out. 3-minute shift, then a star rating.
//   Tomato Soup  - 3 chopped tomatoes in a pot, cooked, onto a plate
//   Onion Soup   - 3 chopped onions in a pot, cooked, onto a plate
//   Salad        - chopped lettuce + chopped tomato on a plate
// Controls (phone gamepad): stick/d-pad move, A pick up / put down,
// X chop (tap or hold), B dash.
//
// Station models come from assets/kitchen.glb (art/kitchen.py, Blender); the
// layout below decides where they go, so new kitchens are just new maps.
MabarGames.register({
  id: 'cooking',
  name: 'Cooking',
  blurb: 'Co-op kitchen chaos: chop, cook, plate and serve orders before time runs out.',
  controls: 'pad',

  create(hub) {
    const B = hub.B;

    // ---------------- layout ----------------
    //  # counter   T/L/O crates (tomato, lettuce, onion)   C chopping board
    //  S stove + pot   P plates   W serving window   X bin   . floor
    const MAP = [
      '#T#L#O#S#S##',
      '#..........W',
      'C..........W',
      'C...####...#',
      '#...P###...#',
      '#..........X',
      '#..........#',
      '##C####P####',
    ];
    const ROWS = MAP.length, COLS = MAP[0].length;
    const TOP = 0.55;            // counter height
    const ROOM_TIME = 30, SHIFT = 180, COOK = 9, BURN = 9, MAX_CHEFS = 4;
    const SPEED = 4.2, RADIUS = 0.3;
    const tileX = (c) => c - (COLS - 1) / 2;
    const tileZ = (r) => r - (ROWS - 1) / 2;
    const toC = (x) => Math.round(x + (COLS - 1) / 2);
    const toR = (z) => Math.round(z + (ROWS - 1) / 2);

    const RECIPES = {
      tomato_soup: { name: 'Tomato Soup', icons: ['tomato', 'tomato', 'tomato'], color: '#ff6b4a', ok: (p) => p.soup === 'tomato' },
      onion_soup: { name: 'Onion Soup', icons: ['onion', 'onion', 'onion'], color: '#f5c26b', ok: (p) => p.soup === 'onion' },
      salad: {
        name: 'Salad', icons: ['lettuce', 'tomato'], color: '#55d17a',
        ok: (p) => !p.soup && p.contents.length === 2 && p.contents.includes('lettuce') && p.contents.includes('tomato'),
      },
    };
    const ING_COLOR = { tomato: '#ff3b30', lettuce: '#2ecc71', onion: '#e8a94a' };
    const SOUP_COLOR = { tomato: '#ff6b4a', onion: '#f5c26b', mixed: '#a0785a', burnt: '#2b2b2b' };
    const CRATE = { T: 'tomato', L: 'lettuce', O: 'onion' };

    // ---------------- state ----------------
    let tiles, chefs, orders, phase, phaseT, roomT, score, served, failed, nextOrderT, shiftT;
    const votes = new Set();
    const popups = [];
    let uid = 1;

    function resetKitchen() {
      tiles = MAP.map((row, r) => [...row].map((ch, c) => ({
        ch, r, c, solid: ch !== '.', item: null, chop: 0,
        pot: ch === 'S' ? { items: [], t: 0, state: 'empty' } : null,
      })));
      orders = [];
      score = 0; served = 0; failed = 0;
      nextOrderT = 2;
      for (const ch of chefs.values()) ch.hold = null;
    }

    const tileAt = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? tiles[r][c] : null);
    const newItem = (type, extra = {}) => ({ id: uid++, type, chopped: false, contents: [], soup: null, ...extra });

    // ---------------- chefs ----------------
    chefs = new Map(); // player id -> chef
    const SPAWNS = [[3, 5], [8, 5], [3, 2], [8, 2]];

    function addChef(p) {
      if (chefs.has(p.id) || chefs.size >= MAX_CHEFS) return;
      const used = new Set([...chefs.values()].map((c) => c.spawn));
      const spawn = [0, 1, 2, 3].find((i) => !used.has(i));
      const [c, r] = SPAWNS[spawn];
      chefs.set(p.id, {
        id: p.id, spawn, x: tileX(c), z: tileZ(r), fx: 0, fz: 1, vx: 0, vz: 0, dash: 0, dashCd: 0,
        hold: null, chopping: 0, walk: 0, moving: 0, color: p.color, name: p.name,
      });
      buildChef3D(p.id);
    }
    function removeChef(id) {
      const ch = chefs.get(id);
      if (!ch) return;
      chefs.delete(id);
      const o = chefObjs.get(id);
      if (o && scene) scene.remove(o.root);
      chefObjs.delete(id);
    }

    // What the chef is facing: the best solid tile in front of them.
    function targetOf(ch) {
      const c0 = toC(ch.x), r0 = toR(ch.z);
      let best = null, bestScore = 0.35;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const t = tileAt(c0 + dc, r0 + dr);
        if (!t || !t.solid) continue;
        const dx = tileX(t.c) - ch.x, dz = tileZ(t.r) - ch.z;
        const d = Math.hypot(dx, dz);
        if (d > 1.25) continue;
        const sc = (dx * ch.fx + dz * ch.fz) / d - d * 0.25;
        if (sc > bestScore) { bestScore = sc; best = t; }
      }
      return best;
    }

    // ---------------- interactions ----------------
    function say(text, x, z, color = '#ffffff') { popups.push({ text, x, z, color, t: 0 }); }

    function interact(ch) {
      const t = targetOf(ch);
      if (!t) return;
      const h = ch.hold;
      const X = tileX(t.c), Z = tileZ(t.r);
      switch (t.ch) {
        case 'T': case 'L': case 'O':
          if (!h && !t.item) { ch.hold = newItem(CRATE[t.ch]); return; }
          break;
        case 'P':
          if (!h) { ch.hold = newItem('plate'); return; }
          if (h.type === 'plate' && !h.soup && !h.contents.length) { ch.hold = null; return; } // put a clean plate back
          if (h.type !== 'plate') {               // drop a chopped ingredient onto a fresh plate
            const pl = newItem('plate');
            if (addToPlate(pl, h, X, Z)) ch.hold = pl;
          }
          return;
        case 'X':
          if (h) {
            if (h.type === 'plate') { h.contents = []; h.soup = null; } else ch.hold = null;
            say('Binned', X, Z, '#adb5bd');
          }
          return;
        case 'W':
          if (h && h.type === 'plate') { deliver(ch, h, X, Z); return; }
          if (h) { say('Plate it first!', X, Z, '#ffd32a'); return; }
          return;
        case 'S': {
          const pot = t.pot;
          if (!h) {
            if (pot.state === 'burnt') { pot.items = []; pot.t = 0; pot.state = 'empty'; say('Scraped', X, Z, '#adb5bd'); }
            else if (pot.state === 'done') say('Grab a plate', X, Z, '#ffd32a');
            return;
          }
          if (h.type === 'plate') {
            if (pot.state === 'done' && !h.soup && !h.contents.length) {
              h.soup = pot.type;
              pot.items = []; pot.t = 0; pot.state = 'empty';
              hub.rumble(hub.players.get(ch.id), 20);
            } else if (pot.state !== 'done') say(pot.items.length ? 'Still cooking' : 'Pot is empty', X, Z, '#ffd32a');
            return;
          }
          if (h.type === 'lettuce') { say('No lettuce soup!', X, Z, '#ffd32a'); return; }
          if (!h.chopped) { say('Chop it first', X, Z, '#ffd32a'); return; }
          if (pot.items.length >= 3 || pot.state === 'done' || pot.state === 'burnt') { say('Pot is full', X, Z, '#ffd32a'); return; }
          pot.items.push(h.type);
          ch.hold = null;
          if (pot.items.length === 3) {
            pot.state = 'cooking';
            pot.t = 0;
            pot.type = pot.items.every((i) => i === pot.items[0]) ? pot.items[0] : 'mixed';
          } else pot.state = 'filling';
          return;
        }
        default: break;
      }
      // Generic surfaces: counters, boards, crate tops
      if (!h && t.item) { ch.hold = t.item; t.item = null; t.chop = 0; return; }
      if (h && !t.item) {
        if (t.ch === 'C' && h.type === 'plate') { say('Plates go on counters', X, Z, '#ffd32a'); return; }
        t.item = h; ch.hold = null; return;
      }
      if (h && t.item) {
        // combine onto a plate (either the held one or the one on the counter)
        const plate = h.type === 'plate' ? h : t.item.type === 'plate' ? t.item : null;
        const ing = h.type === 'plate' ? t.item : h;
        if (plate && ing && ing.type !== 'plate' && addToPlate(plate, ing, X, Z)) {
          if (ing === h) ch.hold = null; else { t.item = null; t.chop = 0; }
        }
      }
    }

    function addToPlate(plate, ing, X, Z) {
      if (plate.soup) { say('Plate is full', X, Z, '#ffd32a'); return false; }
      if (!ing.chopped) { say('Chop it first', X, Z, '#ffd32a'); return false; }
      if (ing.type === 'onion') { say('Onions go in soup', X, Z, '#ffd32a'); return false; }
      if (plate.contents.includes(ing.type)) { say('Already has that', X, Z, '#ffd32a'); return false; }
      plate.contents.push(ing.type);
      return true;
    }

    function chop(ch, amount) {
      const t = targetOf(ch);
      if (!t || t.ch !== 'C' || !t.item || t.item.type === 'plate' || t.item.chopped) return false;
      t.chop += amount;
      ch.chopping = 0.25;
      if (t.chop >= 1) {
        t.item.chopped = true;
        t.chop = 0;
        hub.rumble(hub.players.get(ch.id), 25);
      }
      return true;
    }

    function deliver(ch, plate, X, Z) {
      if (phase !== 'play') { say('Kitchen not open yet', X, Z, '#ffd32a'); return; }
      const i = orders.findIndex((o) => RECIPES[o.key].ok(plate));
      if (i < 0) { say(plate.soup || plate.contents.length ? 'Nobody ordered that!' : 'Empty plate!', X, Z, '#ff6b6b'); return; }
      const o = orders[i];
      const tip = Math.round(8 * (1 - o.t / o.life));
      score += 20 + tip;
      served++;
      orders.splice(i, 1);
      ch.hold = null;
      say(`+${20 + tip}`, X, Z, '#2ed573');
      for (const p of hub.players.values()) hub.rumble(p, 50);
    }

    // ---------------- orders ----------------
    function addOrder() {
      const keys = Object.keys(RECIPES);
      const key = keys[Math.floor(Math.random() * keys.length)];
      orders.push({ id: uid++, key, t: 0, life: 70 + Math.random() * 15, born: performance.now() });
    }

    // ---------------- phases ----------------
    function toRoom() {
      phase = 'room';
      roomT = ROOM_TIME;
      votes.clear();
      resetKitchen();
      hub.showLobby(false, false);
    }
    function startShift() {
      resetKitchen();
      phase = 'countdown';
      phaseT = 3;
      votes.clear();
      for (const p of hub.players.values()) hub.rumble(p, 40);
    }

    // ---------------- 3D ----------------
    let renderer = null, scene = null, camera = null, kit = null, chefTpl = null, loadErr = null, loadP = 0, stopped = false;
    const chefObjs = new Map();
    const itemObjs = new Map(); // item id -> { key, obj, seen }
    const potObjs = [];         // { tile, soup }
    const highlights = new Map();
    let lastT = performance.now();

    function tpl(name) {
      const o = kit.scene.getObjectByName(name);
      return o ? o.clone(true) : new THREE.Group();
    }

    function setup(k, chars) {
      kit = k;
      chefTpl = chars.scene.getObjectByName('ch_chef');
      renderer = Kit3D.renderer(hub);
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#ffe6c7');
      Kit3D.lights(scene, { size: 9, target: [0, 0, 0], sun: [5, 12, 6] });
      scene.add(tpl('k_room'));
      const KIND = { '#': 'k_counter', T: 'k_crate_tomato', L: 'k_crate_lettuce', O: 'k_crate_onion', C: 'k_board', S: 'k_stove', P: 'k_plates', W: 'k_serve', X: 'k_bin' };
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const ch = MAP[r][c];
        if (ch === '.') continue;
        const o = tpl(KIND[ch]);
        o.position.set(tileX(c), 0, tileZ(r));
        scene.add(o);
        if (ch === 'S') {
          const pot = tpl('k_pot');
          pot.position.set(tileX(c), TOP + 0.02, tileZ(r));
          const soup = pot.getObjectByName('k_pot_soup');
          if (soup) soup.traverse((m) => { if (m.isMesh) m.material = m.material.clone(); });
          scene.add(pot);
          potObjs.push({ r, c, soup });
        }
      }
      camera = new THREE.PerspectiveCamera(36, hub.W / hub.H, 0.1, 100);
      placeCamera();
      for (const id of chefs.keys()) buildChef3D(id);
    }

    function placeCamera() {
      if (!camera) return;
      const a = hub.W / hub.H;
      const far = a < 1.3 ? 1.45 : 1;
      camera.aspect = a;
      camera.position.set(0, 11.5 * far, 8.2 * far);
      camera.lookAt(0, 0, 0.55);
      camera.updateProjectionMatrix();
    }

    function nameSprite(text, color) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      g.font = '700 30px Rubik, system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = Math.min(248, g.measureText(text).width + 28);
      g.fillStyle = 'rgba(14,15,19,0.75)';
      g.beginPath(); g.roundRect((256 - tw) / 2, 8, tw, 48, 24); g.fill();
      g.fillStyle = color;
      g.fillText(text, 128, 33);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
      sp.scale.set(1.2, 0.3, 1);
      return sp;
    }

    function buildChef3D(id) {
      if (!scene || !chefTpl) return;
      const ch = chefs.get(id);
      if (!ch || chefObjs.has(id)) return;
      const root = chefTpl.clone(true);
      const color = new THREE.Color(ch.color);
      root.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material.name === 'accent' || o.material.name === 'hair') {
          o.material = o.material.clone();
          o.material.color.copy(o.material.name === 'hair' ? new THREE.Color(['#4a2c1d', '#2b1d16', '#7a4a2a', '#c58b4a'][ch.spawn]) : color);
        }
      });
      root.scale.setScalar(2.4);
      const tag = nameSprite(ch.name, ch.color);
      tag.position.y = 0.8;
      tag.scale.multiplyScalar(1 / 2.4);
      root.add(tag);
      scene.add(root);
      const part = (s) => root.getObjectByName(`ch_chef_${s}`);
      chefObjs.set(id, { root, armR: part('armR'), armL: part('armL'), legL: part('legL'), legR: part('legR') });
      const hl = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), new THREE.MeshBasicMaterial({
        color: ch.color, transparent: true, opacity: 0.35, depthWrite: false,
      }));
      hl.visible = false;
      scene.add(hl);
      highlights.set(id, hl);
    }

    function itemKey(it) {
      if (it.type === 'plate') return `plate:${it.soup || ''}:${[...it.contents].sort().join(',')}`;
      return `${it.type}:${it.chopped ? 1 : 0}`;
    }

    function buildItem(it) {
      if (it.type !== 'plate') return tpl(`i_${it.type}${it.chopped ? '_cut' : ''}`);
      const g = new THREE.Group();
      g.add(tpl('i_plate'));
      if (it.soup) {
        const s = tpl('i_soup');
        s.position.y = 0.02;
        s.traverse((m) => {
          if (m.isMesh && m.material.name === 'soup') { m.material = m.material.clone(); m.material.color.set(SOUP_COLOR[it.soup] || '#999'); }
        });
        g.add(s);
      }
      it.contents.forEach((k, i) => {
        const o = tpl(`i_${k}_cut`);
        o.position.set(i === 0 ? -0.05 : 0.06, 0.025, i === 0 ? 0.02 : -0.03);
        o.scale.setScalar(0.85);
        g.add(o);
      });
      return g;
    }

    function placeItem(it, x, y, z, ry = 0, stamp) {
      let rec = itemObjs.get(it.id);
      const key = itemKey(it);
      if (!rec || rec.key !== key) {
        if (rec) scene.remove(rec.obj);
        rec = { key, obj: buildItem(it) };
        rec.obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        scene.add(rec.obj);
        itemObjs.set(it.id, rec);
      }
      rec.obj.position.set(x, y, z);
      rec.obj.rotation.y = ry;
      rec.seen = stamp;
    }

    function syncScene(dt, time) {
      const stamp = time;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const t = tiles[r][c];
        if (t.item) placeItem(t.item, tileX(c), TOP + (t.ch === 'C' ? 0.04 : 0), tileZ(r), 0, stamp);
      }
      for (const [id, ch] of chefs) {
        const o = chefObjs.get(id);
        if (!o) continue;
        const ry = Math.atan2(ch.fx, ch.fz);
        o.root.position.set(ch.x, Math.abs(Math.sin(ch.walk)) * 0.05 * ch.moving, ch.z);
        o.root.rotation.y = ry;
        const leg = Math.sin(ch.walk) * 0.8 * ch.moving;
        if (o.legL) o.legL.rotation.x = leg;
        if (o.legR) o.legR.rotation.x = -leg;
        const holding = !!ch.hold;
        const chopA = ch.chopping > 0 ? Math.abs(Math.sin(time / 55)) : 0;
        if (o.armR) o.armR.rotation.set(holding ? -1.3 : ch.chopping > 0 ? -1.5 + chopA * 0.8 : -0.2 - 0.4 * ch.moving * Math.sin(ch.walk), 0, holding ? -0.25 : 0.1);
        if (o.armL) o.armL.rotation.set(holding ? -1.3 : -0.2 + 0.4 * ch.moving * Math.sin(ch.walk), 0, holding ? 0.25 : -0.1);
        if (ch.hold) placeItem(ch.hold, ch.x + ch.fx * 0.42, 0.5, ch.z + ch.fz * 0.42, ry, stamp);
        const hl = highlights.get(id);
        const tg = targetOf(ch);
        if (hl) {
          hl.visible = !!tg;
          if (tg) hl.position.set(tileX(tg.c), (tg.ch === 'X' ? 0.66 : TOP) + 0.02, tileZ(tg.r));
        }
      }
      for (const [id, rec] of itemObjs) {
        if (rec.seen !== stamp) { scene.remove(rec.obj); itemObjs.delete(id); }
      }
      for (const po of potObjs) {
        const pot = tiles[po.r][po.c].pot;
        if (!po.soup) continue;
        po.soup.visible = pot.items.length > 0;
        po.soup.position.y = 0.06 + 0.05 * Math.min(3, pot.items.length);
        const col = pot.state === 'burnt' ? SOUP_COLOR.burnt : pot.items.length ? (pot.type ? SOUP_COLOR[pot.type] : ING_COLOR[pot.items[0]]) : '#fff';
        po.soup.traverse((m) => { if (m.isMesh) m.material.color.set(col); });
      }
    }

    // ---------------- HUD ----------------
    function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
    function screenOf(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x + 1) / 2 * hub.W, y: (1 - v.y) / 2 * hub.H };
    }
    function dot(ctx, x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

    function bar(ctx, x, y, w, k, col) {
      rr(ctx, x - w / 2, y, w, 10, 5); ctx.fillStyle = 'rgba(20,20,26,0.75)'; ctx.fill();
      rr(ctx, x - w / 2 + 2, y + 2, Math.max(0, (w - 4) * Math.min(1, k)), 6, 3); ctx.fillStyle = col; ctx.fill();
    }

    function drawWorldUi(ctx, time) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const t = tiles[r][c];
        if (t.ch === 'C' && t.item && !t.item.chopped && t.chop > 0) {
          const s = screenOf(tileX(c), TOP + 0.4, tileZ(r));
          bar(ctx, s.x, s.y, 54, t.chop, '#2ed573');
        }
        if (t.pot && t.pot.items.length) {
          const pot = t.pot;
          const s = screenOf(tileX(c), TOP + 0.75, tileZ(r));
          // ingredient pips
          for (let i = 0; i < 3; i++) dot(ctx, s.x - 16 + i * 16, s.y - 18, 6, pot.items[i] ? ING_COLOR[pot.items[i]] : 'rgba(20,20,26,0.35)');
          if (pot.state === 'cooking') bar(ctx, s.x, s.y - 4, 60, pot.t / COOK, '#ffd32a');
          if (pot.state === 'done') {
            const warn = pot.t > BURN * 0.45;
            const flash = warn && Math.sin(time / 90) > 0;
            rr(ctx, s.x - 26, s.y - 8, 52, 24, 12);
            ctx.fillStyle = flash ? '#ff4757' : '#2ed573';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = hub.font(800, 14);
            ctx.textAlign = 'center';
            ctx.fillText(warn ? '! !' : '✓', s.x, s.y + 5);
          }
          if (pot.state === 'burnt') {
            ctx.font = hub.font(800, 14);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff4757';
            ctx.fillText('BURNT', s.x, s.y + 4);
          }
        }
      }
      for (const pp of popups) {
        const s = screenOf(pp.x, TOP + 0.9, pp.z);
        ctx.globalAlpha = Math.max(0, 1 - pp.t / 1.2);
        ctx.font = hub.font(800, 18);
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(20,20,26,0.6)';
        ctx.strokeText(pp.text, s.x, s.y - pp.t * 30);
        ctx.fillStyle = pp.color;
        ctx.fillText(pp.text, s.x, s.y - pp.t * 30);
      }
      ctx.globalAlpha = 1;
    }

    function drawOrders(ctx) {
      const w = 150, h = 92;
      orders.slice(0, 5).forEach((o, i) => {
        const R = RECIPES[o.key];
        const x = 18 + i * (w + 10), y = 16;
        const k = 1 - o.t / o.life;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 12;
        rr(ctx, x, y, w, h, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
        rr(ctx, x, y, w, 8, [14, 14, 0, 0]);
        ctx.fillStyle = R.color;
        ctx.fill();
        ctx.fillStyle = '#2a2a2a';
        ctx.font = hub.font(800, 15);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(R.name, x + w / 2, y + 28);
        R.icons.forEach((ic, j) => dot(ctx, x + w / 2 - (R.icons.length - 1) * 11 + j * 22, y + 54, 8, ING_COLOR[ic]));
        bar(ctx, x + w / 2, y + 72, w - 24, k, k > 0.5 ? '#2ed573' : k > 0.25 ? '#ffd32a' : '#ff4757');
      });
    }

    function drawTopRight(ctx) {
      const { W } = hub;
      const t = phase === 'play' ? Math.max(0, SHIFT - shiftT) : SHIFT;
      rr(ctx, W - 190, 16, 172, 112, 16);
      ctx.fillStyle = 'rgba(20,20,26,0.82)';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = hub.font(600, 12);
      ctx.textAlign = 'center';
      ctx.fillText(`JOIN CODE ${hub.code || '····'} · H for QR`, W - 104, 112);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd32a';
      ctx.font = hub.font(800, 30);
      ctx.fillText(`★ ${score}`, W - 104, 46);
      ctx.fillStyle = t < 20 && phase === 'play' ? '#ff6b6b' : '#ffffff';
      ctx.font = hub.font(700, 20);
      ctx.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, W - 104, 84);
    }

    function card(ctx, lines, wMax = 560) {
      const { W, H } = hub;
      const w = Math.min(wMax, W - 40), h = 70 + lines.length * 34;
      const x = (W - w) / 2, y = (H - h) / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 30;
      rr(ctx, x, y, w, h, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.fill();
      ctx.restore();
      rr(ctx, x, y, w, 8, [24, 24, 0, 0]);
      ctx.fillStyle = '#ff4b3e';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => {
        ctx.font = hub.font(l.w || 600, l.s || 16);
        ctx.fillStyle = l.c || '#3a3630';
        ctx.fillText(l.t, W / 2, y + 44 + i * 34);
      });
    }

    function drawRoomCard(ctx) {
      const { W, H } = hub;
      const n = Math.min(MAX_CHEFS, hub.players.size);
      const need = [...hub.players.keys()].filter((id) => !votes.has(id)).length;
      const wide = W >= 760;
      const cw = Math.min(780, W - 32), chh = wide ? 330 : 520;
      const x0 = (W - cw) / 2, y0 = Math.max(130, (H - chh) / 2);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 30;
      rr(ctx, x0, y0, cw, chh, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
      ctx.restore();
      rr(ctx, x0, y0, cw, 8, [24, 24, 0, 0]);
      ctx.fillStyle = '#ff4b3e';
      ctx.fill();
      const qs = wide ? 190 : 160;
      const qx = wide ? x0 + 32 : x0 + (cw - qs) / 2, qy = y0 + 34;
      hub.drawJoin(ctx, qx, qy, qs, { label: 'Scan with your phone to join' });
      const rx = wide ? qx + qs + 36 : x0 + 24, rw = wide ? cw - (rx - x0) - 28 : cw - 48;
      const cx = rx + rw / 2;
      let y = wide ? y0 + 58 : qy + qs + 92;
      const line = (t, size, weight, color, gap = 30) => {
        ctx.font = hub.font(weight, size);
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, cx, y);
        y += gap;
      };
      line('COOKING', 30, 800, '#ff4b3e', 44);
      line(n ? `Kitchen opens in ${Math.ceil(roomT)}s` : 'Waiting for the first chef', 22, 800, '#1d2433', 40);
      line('Move with the stick. A grabs and drops, X chops, B dashes.', 14, 600, '#3a3630', 26);
      line('Soup: 3 chopped tomatoes or onions in a pot.', 14, 500, '#6b665e', 22);
      line('Salad: chopped lettuce and tomato on a plate.', 14, 500, '#6b665e', 36);
      line(n ? (need ? `Walk around and practise. ${need} more vote${need > 1 ? 's' : ''} to start now.` : 'Starting…')
        : 'Up to 4 chefs.', 14, 600, '#5d584f');
    }

    function drawOver(ctx) {
      const stars = score >= 160 ? 3 : score >= 100 ? 2 : score >= 40 ? 1 : 0;
      card(ctx, [
        { t: 'SHIFT OVER!', s: 30, w: 800, c: '#ff4b3e' },
        { t: '★'.repeat(stars) + '☆'.repeat(3 - stars), s: 40, w: 800, c: '#ffb020' },
        { t: `${score} points`, s: 24, w: 800, c: '#222' },
        { t: `${served} served · ${failed} missed`, s: 16 },
        { t: `Back to the kitchen in ${Math.ceil(phaseT)}…`, s: 14, c: '#7a7368' },
      ]);
    }

    // ---------------- load ----------------
    Promise.all([Kit3D.load('assets/kitchen.glb', (p) => { loadP = p; }), Kit3D.load('assets/characters.glb')])
      .then(([k, chars]) => { if (!stopped) setup(k, chars); })
      .catch((e) => { loadErr = 'Couldn’t load the kitchen'; console.error(e); });

    toRoom();

    return {
      start() { for (const p of hub.players.values()) addChef(p); hub.showLobby(false, false); },
      stop() {
        stopped = true;
        hub.showLobby(true);
        if (scene) scene.clear();
        if (renderer) renderer.dispose_();
      },
      join(p) { addChef(p); },
      leave(p) { votes.delete(p.id); removeChef(p.id); },

      press(p, bits) {
        const ch = chefs.get(p.id);
        if (!ch) return;
        if (bits & B.A) interact(ch);
        if (bits & B.X) chop(ch, 0.17);
        if (bits & B.B && ch.dashCd <= 0) { ch.dash = 0.18; ch.dashCd = 0.6; }
      },
      action(p) {
        if (phase !== 'room') return;
        if (votes.has(p.id)) votes.delete(p.id); else votes.add(p.id);
        hub.rumble(p, 30);
      },
      actionLabel(p) {
        if (phase !== 'room') return '';
        return votes.has(p.id) ? 'Voted ✓ — tap to undo' : 'Vote to start';
      },
      hint(p) {
        const ch = chefs.get(p.id);
        if (!ch) return 'Kitchen is full — watch and join next shift';
        if (phase === 'over') return 'Shift over!';
        const what = ch.hold ? (ch.hold.type === 'plate'
          ? (ch.hold.soup ? `${ch.hold.soup} soup` : ch.hold.contents.length ? 'salad plate' : 'empty plate')
          : `${ch.hold.chopped ? 'chopped ' : ''}${ch.hold.type}`) : '';
        return (what ? `Holding ${what} · ` : '') + 'A grab · X chop · B dash';
      },
      meta(p) { return chefs.has(p.id) ? (phase === 'room' ? (votes.has(p.id) ? 'voted' : 'chef') : 'chef') : 'watching'; },
      resize() { if (renderer) { renderer.setSize(hub.W, hub.H, false); placeCamera(); } },

      update(dt) {
        for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > 1.2) popups.splice(i, 1); }
        if (phase === 'room') {
          for (const p of hub.players.values()) addChef(p);
          if (hub.players.size) {
            roomT -= dt;
            const allVoted = [...hub.players.keys()].every((id) => votes.has(id));
            if (allVoted || roomT <= 0) startShift();
          } else roomT = ROOM_TIME;
        } else if (phase === 'countdown') {
          phaseT -= dt;
          if (phaseT <= 0) { phase = 'play'; shiftT = 0; addOrder(); addOrder(); nextOrderT = 18; }
        } else if (phase === 'play') {
          shiftT += dt;
          nextOrderT -= dt;
          if (nextOrderT <= 0 && orders.length < 5) { addOrder(); nextOrderT = 16 + Math.random() * 8; }
          if (!orders.length && nextOrderT > 3) nextOrderT = 3;
          for (let i = orders.length - 1; i >= 0; i--) {
            orders[i].t += dt;
            if (orders[i].t >= orders[i].life) {
              orders.splice(i, 1);
              score = Math.max(0, score - 10);
              failed++;
              popups.push({ text: 'Order missed! −10', x: 0, z: -3.5, color: '#ff6b6b', t: 0 });
            }
          }
          if (shiftT >= SHIFT) { phase = 'over'; phaseT = 9; }
        } else if (phase === 'over') {
          phaseT -= dt;
          if (phaseT <= 0) toRoom();
        }

        // pots cook during the shift (and in practice)
        for (const row of tiles) for (const t of row) {
          if (!t.pot) continue;
          if (t.pot.state === 'cooking') {
            t.pot.t += dt;
            if (t.pot.t >= COOK) { t.pot.state = 'done'; t.pot.t = 0; }
          } else if (t.pot.state === 'done') {
            t.pot.t += dt;
            if (t.pot.t >= BURN) { t.pot.state = 'burnt'; t.pot.type = 'burnt'; }
          }
        }

        // movement (frozen during countdown / results)
        const canMove = phase === 'room' || phase === 'play';
        for (const [id, ch] of chefs) {
          const p = hub.players.get(id);
          ch.chopping = Math.max(0, ch.chopping - dt);
          ch.dashCd = Math.max(0, ch.dashCd - dt);
          if (!p) continue;
          if (p.b & B.X) chop(ch, dt * 0.9);  // holding X keeps chopping
          const d = canMove ? hub.dir(p) : { x: 0, y: 0 };
          const m = Math.hypot(d.x, d.y);
          let vx = 0, vz = 0;
          if (m > 0.15) {
            ch.fx = d.x / m; ch.fz = d.y / m;
            vx = d.x * SPEED; vz = d.y * SPEED;
          }
          if (ch.dash > 0) { ch.dash -= dt; vx += ch.fx * 11; vz += ch.fz * 11; }
          ch.moving += ((m > 0.15 ? 1 : 0) - ch.moving) * Math.min(1, dt * 10);
          ch.walk += dt * 12 * ch.moving;
          move(ch, vx * dt, vz * dt);
        }
        // chefs push each other apart
        const list = [...chefs.values()];
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const dx = b.x - a.x, dz = b.z - a.z, dd = Math.hypot(dx, dz) || 0.001;
          const ov = RADIUS * 2 - dd;
          if (ov > 0) { move(a, -dx / dd * ov / 2, -dz / dd * ov / 2); move(b, dx / dd * ov / 2, dz / dd * ov / 2); }
        }
      },

      draw(ctx, time) {
        const dt = Math.min(0.1, (time - lastT) / 1000);
        lastT = time;
        const { W, H } = hub;
        ctx.clearRect(0, 0, W, H);
        if (!renderer) {
          ctx.fillStyle = '#ffe6c7';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#7a7368';
          ctx.font = hub.font(600, 18);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(loadErr || `Opening the kitchen… ${Math.round(loadP * 100)}%`, W / 2, H / 2);
          return;
        }
        syncScene(dt, time);
        renderer.render(scene, camera);
        drawWorldUi(ctx, time);
        drawOrders(ctx);
        drawTopRight(ctx);
        if (phase === 'room') drawRoomCard(ctx);
        if (phase === 'countdown') {
          ctx.font = hub.font(800, 120);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 10;
          ctx.strokeStyle = 'rgba(20,20,26,0.5)';
          const txt = Math.ceil(phaseT) > 0 ? String(Math.ceil(phaseT)) : 'GO!';
          ctx.strokeText(txt, W / 2, H / 2);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(txt, W / 2, H / 2);
        }
        if (phase === 'over') drawOver(ctx);
      },

      _fastForward(sec) { if (phase === 'room') roomT -= sec; else if (phase === 'play') shiftT += sec; },
      _debug: () => ({
        phase, score, served, failed, orders: orders.map((o) => o.key),
        chefs: [...chefs.values()].map((c) => ({ name: c.name, x: +c.x.toFixed(2), z: +c.z.toFixed(2), hold: c.hold && itemKey(c.hold), target: (targetOf(c) || {}).ch })),
        pots: tiles ? tiles[0].filter((t) => t.pot).map((t) => ({ items: t.pot.items.length, state: t.pot.state })) : [],
        boards: tiles ? tiles.flat().filter((t) => t.ch === 'C').map((t) => t.item && itemKey(t.item)) : [],
      }),
      _order(key) { orders.push({ id: uid++, key, t: 0, life: 80 }); },
      _teleport(id, c, r, fx, fz) { const ch = chefs.get(id); if (ch) { ch.x = tileX(c); ch.z = tileZ(r); ch.fx = fx; ch.fz = fz; } },
    };

    // circle-vs-tile collision, one axis at a time
    function move(ch, dx, dz) {
      ch.x += dx;
      collide(ch, 'x');
      ch.z += dz;
      collide(ch, 'z');
    }
    function collide(ch, axis) {
      const c0 = toC(ch.x), r0 = toR(ch.z);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const t = tileAt(c0 + dc, r0 + dr);
        if (t && !t.solid) continue;
        const cx = tileX(c0 + dc), cz = tileZ(r0 + dr);
        const nx = Math.max(cx - 0.5, Math.min(ch.x, cx + 0.5));
        const nz = Math.max(cz - 0.5, Math.min(ch.z, cz + 0.5));
        const ddx = ch.x - nx, ddz = ch.z - nz;
        const d = Math.hypot(ddx, ddz);
        if (d < RADIUS) {
          if (d > 1e-6) {
            const push = RADIUS - d;
            if (axis === 'x') ch.x += (ddx / d) * push; else ch.z += (ddz / d) * push;
          } else if (axis === 'x') ch.x += ch.x < cx ? -RADIUS : RADIUS;
          else ch.z += ch.z < cz ? -RADIUS : RADIUS;
        }
      }
    }
  },
});

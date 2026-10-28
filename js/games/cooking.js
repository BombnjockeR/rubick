// Cooking: Overcooked-style co-op kitchen for 1-4 chefs, on Indonesian menus.
//
// Orders arrive at the top of the screen; the team cooks and serves them before
// their patience runs out. A 4-minute shift, then stars.
//   Paddy Field  gado-gado, nasi liwet, tahu goreng sambal
//   Beach        ikan bakar bowl, cumi goreng tepung, udang saus padang
//   Pontianak    bakmi kepiting, selade pontianak, es jeruk nipis
// The pool is deliberately small: 11 ingredients, five station types (board,
// sink, cooker, fryer, dish stack) plus the serving hatch and the bin, and every
// recipe is "take, prepare, cook, plate, serve". Maps change the layout, not the
// vocabulary (kitchens: js/games/kitchens.js, built into assets/kitchen_*.glb by
// art/kitchens.py; station and food models: assets/kitchen.glb, art/kitchen.py).
//
// Flow: waiting room (join QR, practise, vote) -> once everyone is in, the three
// kitchens float as miniature dioramas on cards, main-menu style, and the team picks
// one (no reading: left / right and A) -> 3-2-1 -> the shift -> stars -> the room.
//
// Controls (phone gamepad): stick/d-pad move, A pick up / put down / use,
// X (hold) chop, rinse or scrape a burnt pot, B dash. Laptop: WASD, Space, X, E.
//
// Rules in one breath: ingredients come from crates; chop at a board (X), rinse
// rice at the sink (X); pots boil up to three things together and fryers fry one;
// cooked food has a grace window, then burns and the pot must be scraped; plates
// come from the dish stack and go back there a while after serving; put anything
// down on a counter; a plate whose parts match an order is served at the hatch.
MabarGames.register({
  id: 'cooking',
  name: 'Cooking',
  blurb: 'Co-op kitchen chaos: chop, cook, plate and serve Indonesian dishes before time runs out.',
  controls: 'pad',

  create(hub) {
    const B = hub.B;
    const K = window.MabarKitchens || {};
    const MAP_IDS = Object.keys(K);

    // ---------------- rules / tuning ----------------
    const ROOM_TIME = 30, PICK_TIME = 30, SHIFT = 240, COUNTDOWN = 3, RESULTS = 12;   // PICK_TIME: the highlighted kitchen is taken when it runs out
    const BOIL = 8, BOIL_GRACE = 12, FRY = 6, FRY_GRACE = 10;    // seconds to cook, then to burn
    const CHOP = 1.6, RINSE = 1.4, SCRAPE = 2.0;                 // seconds of holding X
    const POT_MAX = 3, PLATE_MAX = 4, PLATES = 5, PLATE_RETURN = 9;
    const MAX_CHEFS = 4, SPEED = 3.6, RADIUS = 0.3, DASH = 0.2, DASH_CD = 0.75, DASH_SPEED = 7.5;
    const TOP = 0.55;                                            // counter height (art/kitchen.py)
    const CHAR_SCALE = 1.3;                                      // the animals are 1 m tall at scale 1
    const ANIMALS = ['bunny', 'dog', 'cat', 'panda', 'chimp', 'lioness'];   // one per seat slot, like the racket games

    // Ingredients: how each is prepared before it can be cooked or plated.
    //   prep: the station step a raw one needs (board = chop, sink = rinse)
    //   boil / fry: the state it goes into the pot or fryer with, and what comes out
    const ING = {
      rice: { name: 'rice', color: '#f6f2e8', prep: 'sink', boil: ['rinsed', 'cooked'] },
      noodles: { name: 'noodles', color: '#f5d36b', boil: ['raw', 'cooked'] },
      veg: { name: 'vegetables', color: '#5fc96a', prep: 'board', boil: ['cut', 'cooked'] },
      tofu: { name: 'tofu', color: '#fff4dc', prep: 'board', boil: ['cut', 'cooked'], fry: ['cut', 'fried'] },
      fish: { name: 'fish', color: '#4f90e8', prep: 'board', boil: ['cut', 'cooked'] },
      squid: { name: 'squid', color: '#f7a6c0', prep: 'board', fry: ['cut', 'fried'] },
      shrimp: { name: 'shrimp', color: '#ff8a3d', prep: 'board', boil: ['cut', 'cooked'] },
      crab: { name: 'crab', color: '#e8382c', prep: 'board', boil: ['cut', 'cooked'] },
      chili: { name: 'chili', color: '#d8231c', prep: 'board', boil: ['cut', 'cooked'] },
      citrus: { name: 'lime', color: '#8fd14f', prep: 'board' },
      peanut: { name: 'peanut sauce', color: '#8d5a2b' },
    };
    const CRATE = { r: 'rice', n: 'noodles', v: 'veg', t: 'tofu', f: 'fish', q: 'squid', s: 'shrimp', k: 'crab', c: 'chili', l: 'citrus', p: 'peanut' };
    // What a prepared state is called on the cards, and the glyph for the step.
    const STATE_GLYPH = { raw: '', cut: '✂', rinsed: '≈', cooked: '♨', fried: '✦' };
    const STATE_WORD = { cut: 'chopped', rinsed: 'rinsed', cooked: 'boiled', fried: 'fried', raw: '' };

    // Recipes: parts are "ingredient:state"; `spicy` allows a Pedas variant with an
    // extra chopped chili, `extra` the Es Jeruk Extra Citrus one. `life` is the
    // order's patience in seconds (before the chef-count scaling).
    const RECIPES = {
      gado: { name: 'Gado-Gado', container: 'bowl', parts: ['veg:cut', 'tofu:cooked', 'peanut:raw'], life: 70, spicy: true },
      liwet: { name: 'Nasi Liwet', container: 'bowl', parts: ['rice:cooked', 'veg:cut', 'chili:cut'], life: 78, spicy: true },
      tahu: { name: 'Tahu Goreng Sambal', container: 'plate', parts: ['tofu:fried', 'chili:cut'], life: 60, spicy: true },
      ikan: { name: 'Ikan Bakar Bowl', container: 'bowl', parts: ['fish:cooked', 'rice:cooked', 'citrus:cut'], life: 84, spicy: true },
      cumi: { name: 'Cumi Goreng Tepung', container: 'plate', parts: ['squid:fried', 'chili:cut'], life: 60, spicy: true },
      udang: { name: 'Udang Saus Padang', container: 'bowl', parts: ['shrimp:cooked', 'chili:cooked', 'veg:cooked'], life: 78 },
      bakmi: { name: 'Bakmi Kepiting', container: 'bowl', parts: ['noodles:cooked', 'crab:cooked', 'veg:cut'], life: 78 },
      selade: { name: 'Selade Pontianak', container: 'plate', parts: ['veg:cut', 'tofu:fried', 'peanut:raw'], life: 66 },
      jeruk: { name: 'Es Jeruk Nipis', container: 'glass', parts: ['citrus:cut', 'citrus:cut'], life: 50, extra: true },
    };
    const DISH_NODE = { gado: 'd_gado', liwet: 'd_liwet', tahu: 'd_tahu', ikan: 'd_ikan', cumi: 'd_cumi', udang: 'd_udang', bakmi: 'd_bakmi', selade: 'd_selade', jeruk: 'd_jeruk' };

    // Orders per chef count: seconds between new orders at the start (the gap
    // shrinks by a quarter over the shift), how many can wait at once, and how
    // much more patient they are with a small team.
    const PACE = [
      { gap: 26, max: 3, patience: 1.3 },
      { gap: 20, max: 4, patience: 1.1 },
      { gap: 16, max: 5, patience: 1.0 },
      { gap: 13, max: 5, patience: 1.0 },
    ];
    const paceFor = (n) => PACE[Math.max(0, Math.min(3, n - 1))];
    // Three stars = what a team of n should manage in a shift (first guesses, not playtested).
    const par = (n) => (6 + 3 * (Math.max(1, n) - 1)) * 26;

    const sortedKey = (parts) => [...parts].sort().join(',');
    const RECIPE_KEYS = {};
    for (const [id, r] of Object.entries(RECIPES)) {
      RECIPE_KEYS[sortedKey(r.parts)] = { id, variant: null };
      if (r.spicy) RECIPE_KEYS[sortedKey([...r.parts, 'chili:cut'])] = { id, variant: 'pedas' };
      if (r.extra) RECIPE_KEYS[sortedKey([...r.parts, 'citrus:cut'])] = { id, variant: 'extra' };
    }
    const matchRecipe = (plate) => RECIPE_KEYS[sortedKey(plate.parts)] || null;
    const recipeName = (id, variant) => RECIPES[id].name + (variant === 'pedas' ? ' Pedas' : variant === 'extra' ? ' Extra Citrus' : '');
    const partsOf = (id, variant) => [...RECIPES[id].parts, ...(variant === 'pedas' ? ['chili:cut'] : variant === 'extra' ? ['citrus:cut'] : [])];

    // ---------------- the kitchen ----------------
    let mapId = (new URLSearchParams(location.search).get('map') || MAP_IDS[0]) in K ? new URLSearchParams(location.search).get('map') || MAP_IDS[0] : MAP_IDS[0];
    let kit = null;            // the current kitchen definition
    let MAP, ROWS, COLS, tiles;
    const tileX = (c) => c - (COLS - 1) / 2;
    const tileZ = (r) => r - (ROWS - 1) / 2;
    const toC = (x) => Math.round(x + (COLS - 1) / 2);
    const toR = (z) => Math.round(z + (ROWS - 1) / 2);
    const tileAt = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? tiles[r][c] : null);
    const walkable = (ch) => ch === '.' || ch === '=';

    let chefs, orders, phase, phaseT, roomT, score, served, failed, combo, bestCombo, nextOrderT, shiftT, platesOut, plateReturns, orderCount;
    const votes = new Set();
    const popups = [];
    const bell = [];           // serving animation: plates sliding away
    let uid = 1;
    let lastT = performance.now();

    function newItem(type, state = 'raw') { return { id: uid++, type, state, parts: [] }; }
    const isPlate = (it) => it && it.type === 'plate';
    const partKey = (it) => `${it.type}:${it.state}`;

    function loadKitchen(id) {
      mapId = id;
      kit = K[id];
      MAP = kit.map;
      ROWS = MAP.length;
      COLS = MAP[0].length;
      resetKitchen();
    }

    function resetKitchen() {
      tiles = MAP.map((row, r) => [...row].map((ch, c) => ({
        ch, r, c, solid: !walkable(ch), item: null, work: 0,
        pot: ch === 'C' ? { items: [], t: 0, state: 'empty' } : null,          // state: empty | cooking | done | burnt
        fryer: ch === 'F' ? { item: null, t: 0, state: 'empty' } : null,
      })));
      orders = [];
      score = 0; served = 0; failed = 0; combo = 0; bestCombo = 0; orderCount = 0;
      platesOut = 0; plateReturns = [];
      nextOrderT = 2;
      if (chefs) for (const ch of chefs.values()) { ch.hold = null; ch.working = 0; }
    }

    // ---------------- chefs ----------------
    chefs = new Map(); // player id -> chef

    function spawnOf(i) {
      const s = kit.spawns[i % kit.spawns.length];
      return [tileX(s[0]), tileZ(s[1])];
    }

    function addChef(p) {
      if (chefs.has(p.id) || chefs.size >= MAX_CHEFS) return;
      const used = new Set([...chefs.values()].map((c) => c.spawn));
      const spawn = [0, 1, 2, 3].find((i) => !used.has(i));
      const [x, z] = spawnOf(spawn);
      chefs.set(p.id, {
        id: p.id, spawn, slot: p.slot, x, z, fx: 0, fz: 1, vx: 0, vz: 0, dash: 0, dashCd: 0,
        hold: null, working: 0, workKind: '', color: p.color, name: p.name, bump: 0,
      });
      buildChef3D(p.id);
    }
    function removeChef(id) {
      const ch = chefs.get(id);
      if (!ch) return;
      chefs.delete(id);
      const o = chefObjs.get(id);
      if (o) { if (o.ch) o.ch.dispose(); if (scene) scene.remove(o.root); }
      chefObjs.delete(id);
      const hl = highlights.get(id);
      if (hl && scene) scene.remove(hl);
      highlights.delete(id);
    }
    function respawnChefs() {
      for (const ch of chefs.values()) { const [x, z] = spawnOf(ch.spawn); ch.x = x; ch.z = z; ch.fx = 0; ch.fz = 1; ch.hold = null; ch.working = 0; }
    }

    // What the chef is facing: the best solid tile in front of them.
    function targetOf(ch) {
      const c0 = toC(ch.x), r0 = toR(ch.z);
      let best = null, bestScore = 0.35;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const t = tileAt(c0 + dc, r0 + dr);
        if (!t || !t.solid || t.ch === '~') continue;
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
    const rumble = (ch, ms) => hub.rumble(hub.players.get(ch.id), ms);

    // Can this part go onto a plate, and if not, why?
    function plateable(it) {
      const d = ING[it.type];
      if (!d) return 'That does not go on a plate';
      if (it.state === 'raw' && d.prep === 'board') return `Chop the ${d.name} first`;
      if (it.state === 'raw' && d.prep === 'sink') return `Rinse the ${d.name} first`;
      if (it.type === 'rice' && it.state === 'rinsed') return 'Boil the rice first';
      if (it.type === 'noodles' && it.state === 'raw') return 'Boil the noodles first';
      return null;
    }

    function addToPlate(plate, it, X, Z) {
      const why = plateable(it);
      if (why) { say(why, X, Z, '#ffd32a'); return false; }
      if (plate.parts.length >= PLATE_MAX) { say('Plate is full', X, Z, '#ffd32a'); return false; }
      plate.parts.push(partKey(it));
      return true;
    }

    // A pot takes an ingredient in its boil state; a fryer in its fry state.
    function potAccepts(it) {
      const d = ING[it.type];
      if (!d || !d.boil) return `${d ? d.name[0].toUpperCase() + d.name.slice(1) : 'That'} is not boiled`;
      if (it.state === d.boil[0]) return null;
      if (it.state === 'raw' && d.prep === 'board') return `Chop the ${d.name} first`;
      if (it.state === 'raw' && d.prep === 'sink') return `Rinse the ${d.name} first`;
      return 'Already cooked';
    }
    function fryerAccepts(it) {
      const d = ING[it.type];
      if (!d || !d.fry) return `${d ? d.name[0].toUpperCase() + d.name.slice(1) : 'That'} is not fried`;
      if (it.state === d.fry[0]) return null;
      if (it.state === 'raw') return `Chop the ${d.name} first`;
      return 'Already cooked';
    }

    function interact(ch) {
      const t = targetOf(ch);
      if (!t) return;
      const h = ch.hold;
      const X = tileX(t.c), Z = tileZ(t.r);
      if (CRATE[t.ch]) {
        if (!h) { ch.hold = newItem(CRATE[t.ch]); rumble(ch, 12); }
        else if (!t.item) { t.item = h; ch.hold = null; }           // a crate's rim holds one thing too
        else if (isPlate(h) && !isPlate(t.item)) { if (addToPlate(h, t.item, X, Z)) t.item = null; }
        return;
      }
      switch (t.ch) {
        case 'P': {
          if (!h) {
            if (platesOut >= PLATES) { say('No clean plates yet', X, Z, '#ffd32a'); return; }
            platesOut++;
            ch.hold = newItem('plate');
            rumble(ch, 12);
          } else if (isPlate(h) && !h.parts.length) { platesOut--; ch.hold = null; }   // a clean plate back on the stack
          else if (!isPlate(h)) {
            if (platesOut >= PLATES) { say('No clean plates yet', X, Z, '#ffd32a'); return; }
            const pl = newItem('plate');                              // straight onto a fresh plate
            if (addToPlate(pl, h, X, Z)) { platesOut++; ch.hold = pl; }
          }
          return;
        }
        case 'X':
          if (h) {
            if (isPlate(h)) { if (h.parts.length) { h.parts = []; say('Scraped the plate', X, Z, '#adb5bd'); } }
            else { ch.hold = null; say('Binned', X, Z, '#adb5bd'); }
          }
          return;
        case 'W':
          if (isPlate(h)) deliver(ch, h, X, Z);
          else if (h) say('Plate it first!', X, Z, '#ffd32a');
          return;
        case 'C': {
          const pot = t.pot;
          if (!h) {
            if (pot.state === 'burnt') say('Hold X to scrape it', X, Z, '#ffd32a');
            else if (pot.state === 'done') say('Grab a plate', X, Z, '#ffd32a');
            return;
          }
          if (isPlate(h)) {
            if (pot.state === 'done') {
              if (h.parts.length + pot.items.length > PLATE_MAX) { say('Plate is full', X, Z, '#ffd32a'); return; }
              for (const it of pot.items) h.parts.push(`${it.type}:${ING[it.type].boil[1]}`);
              pot.items = []; pot.t = 0; pot.state = 'empty';
              rumble(ch, 25);
            } else if (pot.state === 'burnt') say('Burnt! Hold X to scrape it', X, Z, '#ff6b6b');
            else say(pot.items.length ? 'Still cooking' : 'Pot is empty', X, Z, '#ffd32a');
            return;
          }
          const why = potAccepts(h);
          if (why) { say(why, X, Z, '#ffd32a'); return; }
          if (pot.state === 'burnt') { say('Scrape the pot first', X, Z, '#ffd32a'); return; }
          if (pot.state === 'done') { say('Plate it before adding more', X, Z, '#ffd32a'); return; }
          if (pot.items.length >= POT_MAX) { say('Pot is full', X, Z, '#ffd32a'); return; }
          pot.items.push(h);
          ch.hold = null;
          pot.state = 'cooking';
          pot.t = pot.items.length === 1 ? 0 : Math.max(0, pot.t - BOIL * 0.4);   // a late addition needs a little longer
          rumble(ch, 15);
          return;
        }
        case 'F': {
          const fr = t.fryer;
          if (!h) {
            if (fr.state === 'done') { ch.hold = fr.item; ch.hold.state = ING[fr.item.type].fry[1]; fr.item = null; fr.state = 'empty'; fr.t = 0; rumble(ch, 15); }
            else if (fr.state === 'burnt') say('Hold X to scrape it', X, Z, '#ffd32a');
            else if (fr.state === 'cooking') say('Still frying', X, Z, '#ffd32a');
            return;
          }
          if (isPlate(h)) {
            if (fr.state === 'done') {
              const it = fr.item;
              it.state = ING[it.type].fry[1];
              if (addToPlate(h, it, X, Z)) { fr.item = null; fr.state = 'empty'; fr.t = 0; rumble(ch, 25); }
            } else if (fr.state === 'burnt') say('Burnt! Hold X to scrape it', X, Z, '#ff6b6b');
            else say(fr.item ? 'Still frying' : 'Fryer is empty', X, Z, '#ffd32a');
            return;
          }
          const why = fryerAccepts(h);
          if (why) { say(why, X, Z, '#ffd32a'); return; }
          if (fr.state !== 'empty') { say(fr.state === 'burnt' ? 'Scrape the fryer first' : 'Fryer is busy', X, Z, '#ffd32a'); return; }
          fr.item = h; ch.hold = null; fr.state = 'cooking'; fr.t = 0;
          rumble(ch, 15);
          return;
        }
        default: break;
      }
      // Counters, boards, the sink: one item each; plates combine with what is there.
      if (!h && t.item) { ch.hold = t.item; t.item = null; t.work = 0; return; }
      if (h && !t.item) {
        if ((t.ch === 'B' || t.ch === 'S') && isPlate(h)) { say('Plates go on counters', X, Z, '#ffd32a'); return; }
        if (t.ch === 'S' && !(h.type === 'rice' && h.state === 'raw')) { say('Only rice gets rinsed', X, Z, '#ffd32a'); return; }
        t.item = h; ch.hold = null; t.work = 0; return;
      }
      if (h && t.item) {
        const plate = isPlate(h) ? h : isPlate(t.item) ? t.item : null;
        const ing = isPlate(h) ? t.item : h;
        if (plate && ing && !isPlate(ing) && addToPlate(plate, ing, X, Z)) {
          if (ing === h) ch.hold = null; else { t.item = null; t.work = 0; }
          rumble(ch, 12);
        } else if (isPlate(h) && isPlate(t.item)) say('Counter is taken', X, Z, '#ffd32a');
      }
    }

    // Holding X: chop at a board, rinse at the sink, scrape a burnt pot or fryer.
    function work(ch, amount) {
      const t = targetOf(ch);
      if (!t) return false;
      let kind = '';
      if (t.ch === 'B' && t.item && !isPlate(t.item) && t.item.state === 'raw' && ING[t.item.type].prep === 'board') kind = 'chop';
      else if (t.ch === 'S' && t.item && t.item.type === 'rice' && t.item.state === 'raw') kind = 'rinse';
      else if (t.ch === 'C' && t.pot.state === 'burnt') kind = 'scrape';
      else if (t.ch === 'F' && t.fryer.state === 'burnt') kind = 'scrape';
      if (!kind || ch.hold) return false;
      const need = kind === 'chop' ? CHOP : kind === 'rinse' ? RINSE : SCRAPE;
      t.work += amount / need;
      ch.working = 0.25;
      ch.workKind = kind;
      if (t.work >= 1) {
        t.work = 0;
        if (kind === 'chop') t.item.state = 'cut';
        else if (kind === 'rinse') t.item.state = 'rinsed';
        else if (t.ch === 'C') { t.pot.items = []; t.pot.t = 0; t.pot.state = 'empty'; say('Scraped', tileX(t.c), tileZ(t.r), '#adb5bd'); }
        else { t.fryer.item = null; t.fryer.t = 0; t.fryer.state = 'empty'; say('Scraped', tileX(t.c), tileZ(t.r), '#adb5bd'); }
        rumble(ch, 30);
      }
      return true;
    }

    function deliver(ch, plate, X, Z) {
      if (phase !== 'play') { say('Kitchen not open yet', X, Z, '#ffd32a'); return; }
      const m = matchRecipe(plate);
      const i = m ? orders.findIndex((o) => o.id === m.id && o.variant === m.variant) : -1;
      if (i < 0) {
        if (!plate.parts.length) say('Empty plate!', X, Z, '#ff6b6b');
        else if (m) say(`Nobody ordered ${recipeName(m.id, m.variant)}`, X, Z, '#ff6b6b');
        else say('That is not a dish', X, Z, '#ff6b6b');
        return;
      }
      const o = orders[i];
      const tip = Math.round(12 * (1 - o.t / o.life));
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      const bonus = combo >= 5 ? 10 : combo >= 3 ? 5 : 0;
      score += 20 + tip + bonus;
      served++;
      orders.splice(i, 1);
      ch.hold = null;
      platesOut--;
      plateReturns.push(PLATE_RETURN);
      bell.push({ x: X, z: Z, t: 0, recipe: m.id, variant: m.variant });
      say(`+${20 + tip + bonus}${bonus ? ` · combo ×${combo}` : ''}`, X, Z, '#2ed573');
      for (const p of hub.players.values()) hub.rumble(p, 50);
    }

    // ---------------- orders ----------------
    // Easy recipes first; three-part dishes from 40 s, variants from 90 s; never
    // three of the same in a row; the gap shrinks as the shift goes on.
    function pickOrder() {
      const pool = kit.recipes.slice();
      const weights = pool.map((id) => {
        const r = RECIPES[id];
        if (r.parts.length >= 3 && shiftT < 40) return 0.15;
        return 1;
      });
      const last = orders.slice(-2).map((o) => o.id);
      if (last.length === 2 && last[0] === last[1]) weights[pool.indexOf(last[0])] = 0;
      let total = weights.reduce((a, b) => a + b, 0), x = Math.random() * total, id = pool[0];
      for (let i = 0; i < pool.length; i++) { x -= weights[i]; if (x <= 0) { id = pool[i]; break; } }
      const r = RECIPES[id];
      let variant = null;
      if (shiftT > 90 && Math.random() < 0.28) variant = r.spicy ? 'pedas' : r.extra ? 'extra' : null;
      return { id, variant };
    }
    function addOrder(forced) {
      const { id, variant } = forced || pickOrder();
      const life = RECIPES[id].life * paceFor(chefs.size).patience * (variant ? 1.1 : 1);
      orders.push({ uid: uid++, id, variant, t: 0, life, parts: partsOf(id, variant), born: performance.now() });
      orderCount++;
    }

    // ---------------- phases ----------------
    function toRoom() {
      phase = 'room';
      roomT = ROOM_TIME;
      votes.clear();
      resetKitchen();
      respawnChefs();
      hub.showLobby(false, false);
    }
    // Everyone is in: choose the kitchen together (the 3D cards, below).
    function toPick() {
      phase = 'pick';
      pickT = PICK_TIME;
      pickSel = Math.max(0, MAP_IDS.indexOf(mapId));
      votes.clear();
      pickNav.clear();
      if (fx) { fx.dispose(); fx = null; }         // the cards liven the dioramas now
      for (const id of MAP_IDS) envPromise(id);   // all three load while the cards appear
      buildPick3D();
      hub.showLobby(false, false);
    }
    function selectCard(i) {
      const n = MAP_IDS.length;
      const next = ((i % n) + n) % n;
      if (phase !== 'pick' || next === pickSel) return;
      pickSel = next;
      for (const p of hub.players.values()) hub.rumble(p, 10);
    }
    // Leaves the pick with `id` as the kitchen; the main scene gets its diorama back.
    function leavePick(id) {
      teardownPick();
      if (id !== mapId) switchKitchen(id);
      else if (scene) buildMap3D();
    }
    function confirmPick() {
      if (phase !== 'pick') return;
      leavePick(MAP_IDS[pickSel]);
      startShift();
    }
    function switchKitchen(id) {
      loadKitchen(id);
      respawnChefs();
      loadEnv(id);
    }
    function startShift() {
      resetKitchen();
      respawnChefs();
      phase = 'countdown';
      phaseT = COUNTDOWN;
      votes.clear();
      for (const p of hub.players.values()) hub.rumble(p, 40);
    }
    function stars() {
      const p = par(Math.max(1, chefs.size));
      return score >= p ? 3 : score >= p * 0.65 ? 2 : score >= p * 0.35 ? 1 : 0;
    }
    function endShift() {
      phase = 'over';
      phaseT = RESULTS;
      const s = stars();
      for (const o of chefObjs.values()) if (o.ch) o.ch.play(s >= 2 ? 'victory' : 'defeat');
      for (const p of hub.players.values()) hub.rumble(p, s >= 2 ? 120 : 60);
    }

    // ---------------- 3D ----------------
    let renderer = null, scene = null, camera = null, kitAsset = null, chars = null, env = null, fx = null;
    let loadErr = null, loadP = 0, stopped = false, envRoot = null;
    const chefObjs = new Map();   // id -> { root, ch (animal) | parts (chibi) }
    const itemObjs = new Map();   // item id -> { key, obj, seen }
    const stationObjs = [];       // everything placed for the current map (to clear on a map change)
    const potObjs = new Map();    // tile -> { soup, lid, steam[], smoke }
    const fryerObjs = new Map();  // tile -> { oil, basket, smoke }
    const sinkObjs = new Map();   // tile -> { water, splash }
    const boardObjs = new Map();  // tile -> { knife }
    const highlights = new Map();
    let sceneMap = null;          // which map the stations in the scene belong to
    const KIND = { '#': 'k_counter', B: 'k_board', S: 'k_sink', C: 'k_cooker', F: 'k_fryer', P: 'k_plates', W: 'k_serve', X: 'k_bin' };
    const FLOOR_GEO = new THREE.BoxGeometry(1, 0.08, 1);   // the plain floor when a diorama is missing
    const FLOOR_MAT = { water: new THREE.MeshStandardMaterial({ color: '#4fb8ec', roughness: 0.9 }), a: new THREE.MeshStandardMaterial({ color: '#f0dcb8', roughness: 0.9 }), b: new THREE.MeshStandardMaterial({ color: '#e6cfa6', roughness: 0.9 }) };

    // ---- the kitchen pick: three miniature kitchens on floating cards ----
    // Like the main menu's platforms: the highlighted card lifts and its rim glows, the
    // camera leans toward it. Nothing is written on the screen; the phone hint says
    // "left / right, A". Each card carries the kitchen's real diorama (the same loaded
    // .glb the shift uses, reparented) with its stations and crates as scenery.
    const CARD = { w: 4.2, d: 4.2, t: 0.26, gap: 4.9, mini: 3.6 };   // metres: slab, thickness, spacing, the miniature's footprint
    const MAP_COLOR = { paddy: '#6cc36a', beach: '#4fb8ec', city: '#ff9f43' };
    let pickSel = 0, pickT = 0, pickScene = null, pickCam = null, pickLights = null, pickHover = -1;
    const pickCards = [];         // { id, group, slab, sideMat, halo, mini, floor, env, fx, lift, own[] }
    const pickNav = new Map();    // per-player stick repeat timer
    const pickLook = new THREE.Vector3(), pickPos = new THREE.Vector3();

    // Stations face the nearest walkable side (their fronts have the slats / the tap).
    function facingOf(M, r, c) {
      const walk = (rr, cc) => !!M[rr] && walkable(M[rr][cc] || '~');
      return walk(r + 1, c) ? 0 : walk(r - 1, c) ? Math.PI : walk(r, c - 1) ? Math.PI / 2 : -Math.PI / 2;
    }
    function tintCrate(o, ing) {
      o.traverse((m) => { if (m.isMesh && m.material.name === 'label') { m.material = m.material.clone(); m.material.color.set(ING[ing].color); } });
    }
    // Three loose ingredients on top of a crate.
    function crateItems(ing, x, z) {
      return [[-0.18, -0.14], [0.17, -0.12], [-0.02, 0.17]].map(([dx, dz]) => {
        const it = tpl(`i_${ing}`);
        it.position.set(x + dx, TOP + 0.2, z + dz);
        it.scale.setScalar(0.8);
        it.rotation.y = Math.random() * 6;
        return it;
      });
    }
    function fallbackFloor(k) {
      const M = k.map, rows = M.length, cols = M[0].length;
      const g = new THREE.Group();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const ch = M[r][c];
        const m = new THREE.Mesh(FLOOR_GEO, ch === '~' ? FLOOR_MAT.water : (c + r) % 2 ? FLOOR_MAT.a : FLOOR_MAT.b);
        m.position.set(c - (cols - 1) / 2, ch === '~' ? -0.2 : -0.04, r - (rows - 1) / 2);
        m.receiveShadow = true;
        g.add(m);
      }
      return g;
    }
    // A kitchen's stations and crates as plain scenery (no game state), for a card.
    function miniStations(root, k) {
      const M = k.map, rows = M.length, cols = M[0].length;
      const tx = (c) => c - (cols - 1) / 2, tz = (r) => r - (rows - 1) / 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const ch = M[r][c];
        const name = KIND[ch] || (CRATE[ch] ? 'k_crate' : null);
        if (!name) continue;
        const o = tpl(name);
        o.position.set(tx(c), 0, tz(r));
        o.rotation.y = facingOf(M, r, c);
        root.add(o);
        if (CRATE[ch]) { tintCrate(o, CRATE[ch]); for (const it of crateItems(CRATE[ch], tx(c), tz(r))) root.add(it); }
        else if (ch === 'C') { const pot = tpl('k_pot'); pot.position.set(tx(c), TOP + 0.02, tz(r)); root.add(pot); }
      }
    }
    function roundedRect(w, d, r) {
      const sh = new THREE.Shape();
      const x = -w / 2, y = -d / 2;
      sh.moveTo(x + r, y);
      sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
      sh.lineTo(x + w, y + d - r); sh.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
      sh.lineTo(x + r, y + d); sh.quadraticCurveTo(x, y + d, x, y + d - r);
      sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
      return sh;
    }
    function buildPick3D() {
      if (pickScene || !renderer) return;
      pickScene = new THREE.Scene();
      pickScene.background = new THREE.Color('#f8f2e9');
      pickScene.fog = new THREE.Fog('#f8f2e9', 30, 60);
      pickLights = Kit3D.lights(pickScene, { size: 11, target: [0, 0, 0], sun: [8, 15, 7] });
      pickCam = new THREE.PerspectiveCamera(30, hub.W / hub.H, 0.1, 120);
      MAP_IDS.forEach((id, i) => {
        const k = K[id];
        const group = new THREE.Group();
        group.position.x = (i - (MAP_IDS.length - 1) / 2) * CARD.gap;
        const color = new THREE.Color(MAP_COLOR[id] || '#ff4b3e');
        // the card: a cream slab with a coloured edge (extrude groups: 0 = caps, 1 = sides)
        const slabGeo = new THREE.ExtrudeGeometry(roundedRect(CARD.w, CARD.d, 0.5), { depth: CARD.t, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
        slabGeo.rotateX(-Math.PI / 2);                // extruded along +z: stand it up so the depth is the thickness
        const topMat = new THREE.MeshStandardMaterial({ color: '#fdf9f2', roughness: 0.55 });
        const sideMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0 });
        const slab = new THREE.Mesh(slabGeo, [topMat, sideMat]);
        slab.castShadow = true;
        slab.receiveShadow = true;
        group.add(slab);
        // a soft halo under the card in its colour (the menu's rim glow)
        const halo = new THREE.Mesh(new THREE.RingGeometry(CARD.w * 0.56, CARD.w * 0.66, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = -0.18;
        group.add(halo);
        const mini = new THREE.Group();
        mini.scale.setScalar(CARD.mini / Math.max(k.map[0].length, k.map.length));
        mini.position.y = CARD.t + 0.03;
        const floor = fallbackFloor(k);               // until the diorama is in
        mini.add(floor);
        miniStations(mini, k);
        group.add(mini);
        pickScene.add(group);
        const card = { id, group, slab, sideMat, halo, mini, floor, env: null, fx: null, lift: 0, own: [slabGeo, topMat, sideMat, halo.geometry, halo.material] };
        pickCards.push(card);
        envPromise(id).then((g) => {
          if (!g || pickCards.indexOf(card) < 0) return;
          card.env = g;
          mini.remove(floor);
          // The diorama is a slice of land: its terrain reaches below the floor (the sea
          // bed, the canal) and can be wider than the tile grid, so size it to fit the
          // card by its own bounds and stand it on the slab, cliffs and all.
          const bb = new THREE.Box3().setFromObject(g.scene);
          const size = bb.getSize(new THREE.Vector3());
          const sc = CARD.mini / Math.max(size.x, size.z, 1);
          mini.scale.setScalar(sc);
          mini.position.set(-(bb.min.x + bb.max.x) / 2 * sc, CARD.t + 0.03 - bb.min.y * sc, -(bb.min.z + bb.max.z) / 2 * sc);
          mini.add(g.scene);
          card.fx = Kit3D.liven(g);
        });
      });
      aimPickCam(true);
    }
    function teardownPick() {
      for (const c of pickCards) {
        if (c.fx) c.fx.dispose();
        if (c.env) c.mini.remove(c.env.scene);      // the main scene adds it back
        for (const o of c.own) o.dispose();
      }
      pickCards.length = 0;
      if (pickLights) pickLights.key.shadow.dispose();
      if (pickScene) pickScene.clear();
      pickScene = null; pickCam = null; pickLights = null; pickHover = -1;
      arena.style.cursor = '';
    }
    // Front and high, far enough back that every card fits whatever the screen's
    // shape, leaning a little toward the highlighted one.
    function aimPickCam(snap) {
      if (!pickCam) return;
      const sel = pickCards[pickSel];
      const sx = sel ? sel.group.position.x : 0;
      pickCam.aspect = hub.W / hub.H;
      pickCam.updateProjectionMatrix();
      const span = (MAP_IDS.length - 1) * CARD.gap + CARD.w + 2.6;
      const half = pickCam.fov * Math.PI / 360;
      const hfov = Math.atan(Math.tan(half) * pickCam.aspect);
      const dist = Math.max(span / 2 / Math.tan(hfov), (CARD.d + 4.5) / 2 / Math.tan(half));
      const look = new THREE.Vector3(sx * 0.22, 0.75, 0);
      const pos = look.clone().addScaledVector(new THREE.Vector3(0, 0.66, 0.75).normalize(), dist);
      if (snap) { pickLook.copy(look); pickPos.copy(pos); } else { pickLook.lerp(look, 0.08); pickPos.lerp(pos, 0.08); }
      pickCam.position.copy(pickPos);
      pickCam.lookAt(pickLook);
    }
    function animatePick(dt, t) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.9);
      pickCards.forEach((c, i) => {
        const on = i === pickSel;
        c.lift += ((on ? 0.3 : 0) - c.lift) * Math.min(1, dt * 7);
        c.group.position.y = c.lift + (on ? 0.04 * Math.sin(t * 2.2) : 0);
        c.mini.rotation.y = on ? 0.08 * Math.sin(t * 0.6) : c.mini.rotation.y * Math.max(0, 1 - dt * 4);
        c.sideMat.emissiveIntensity += ((on ? 0.35 + 0.3 * pulse : 0) - c.sideMat.emissiveIntensity) * Math.min(1, dt * 10);
        c.halo.material.opacity += ((on ? 0.16 + 0.1 * pulse : i === pickHover ? 0.08 : 0) - c.halo.material.opacity) * Math.min(1, dt * 8);
        if (c.fx) c.fx.update(dt, t);
      });
      aimPickCam(false);
    }
    // Where a card is on the screen (centre and half-width), for the host's mouse.
    function pickScreenOf(i) {
      const c = pickCards[i];
      if (!c || !pickCam) return null;
      const v = c.group.getWorldPosition(new THREE.Vector3()).project(pickCam);
      const e = c.group.position.clone().add(new THREE.Vector3(CARD.w / 2, 0, 0)).project(pickCam);
      return { x: (v.x + 1) / 2 * hub.W, y: (1 - v.y) / 2 * hub.H, r: Math.abs(e.x - v.x) / 2 * hub.W };
    }
    function pickHit(e) {
      for (let i = 0; i < pickCards.length; i++) {
        const s = pickScreenOf(i);
        if (s && Math.hypot(e.clientX - s.x, (e.clientY - s.y) * 0.8) < s.r * 1.1) return i;
      }
      return -1;
    }
    // The only HUD on the pick: a slim clock in the highlighted kitchen's colour.
    function drawPickBar(ctx) {
      const { W, H } = hub;
      const w = Math.min(320, W * 0.3), x = (W - w) / 2, y = H - 30;
      rr(ctx, x, y, w, 6, 3);
      ctx.fillStyle = 'rgba(40,36,30,0.18)';
      ctx.fill();
      rr(ctx, x, y, w * Math.max(0, Math.min(1, pickT / PICK_TIME)), 6, 3);
      ctx.fillStyle = MAP_COLOR[MAP_IDS[pickSel]] || '#ff4b3e';
      ctx.fill();
    }

    function tpl(name) {
      const o = kitAsset && kitAsset.scene.getObjectByName(name);
      return o ? o.clone(true) : new THREE.Group();
    }
    // A template's animated child (lid, basket, oil, knife...): the optimized .glb
    // keeps a quantization scale and offset in these nodes, so the game only ever
    // adds to what is there. Returns { o, pos, scale } or null.
    function part(root, name) {
      const o = root.getObjectByName(name);
      return o ? { o, pos: o.position.clone(), scale: o.scale.clone() } : null;
    }

    function setup() {
      renderer = Kit3D.renderer(hub);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(36, hub.W / hub.H, 0.1, 200);
      buildMap3D();
      for (const id of chefs.keys()) buildChef3D(id);
      if (phase === 'pick') buildPick3D();
    }

    // Places the environment, stations and crates of the current map.
    function buildMap3D() {
      if (!scene) return;
      for (const o of stationObjs) scene.remove(o);
      stationObjs.length = 0;
      potObjs.clear(); fryerObjs.clear(); sinkObjs.clear(); boardObjs.clear();
      if (fx) { fx.dispose(); fx = null; }
      if (envRoot) { scene.remove(envRoot); envRoot = null; }
      for (const rec of itemObjs.values()) scene.remove(rec.obj);
      itemObjs.clear();
      scene.background = new THREE.Color(kit.sky || '#cfe9ff');
      scene.fog = new THREE.Fog(kit.sky || '#cfe9ff', 28, 60);
      for (const o of scene.children.filter((c) => c.isLight || c.name === 'lightTarget')) { if (o.shadow) o.shadow.dispose(); scene.remove(o); }
      const lights = Kit3D.lights(scene, { size: Math.max(COLS, ROWS) * 0.6, target: [0, 0, 0], sun: kit.sun || [6, 12, 5] });
      lights.key.target.name = 'lightTarget';
      if (env && env.scene) {
        envRoot = env.scene;
        scene.add(envRoot);
        fx = Kit3D.liven(env);
      } else {                                             // fallback: a flat floor in the map's shape
        envRoot = fallbackFloor(kit);
        scene.add(envRoot);
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const ch = MAP[r][c];
        const name = KIND[ch] || (CRATE[ch] ? 'k_crate' : null);
        if (!name) continue;
        const o = tpl(name);
        o.position.set(tileX(c), 0, tileZ(r));
        const facing = facingOf(MAP, r, c);
        o.rotation.y = facing;
        scene.add(o);
        stationObjs.push(o);
        const t = tiles[r][c];
        if (CRATE[ch]) {
          tintCrate(o, CRATE[ch]);
          for (const it of crateItems(CRATE[ch], tileX(c), tileZ(r))) { scene.add(it); stationObjs.push(it); }
        } else if (ch === 'C') {
          const pot = tpl('k_pot');
          pot.position.set(tileX(c), TOP + 0.02, tileZ(r));
          scene.add(pot);
          stationObjs.push(pot);
          const soup = part(pot, 'soup');
          if (soup) soup.o.traverse((m) => { if (m.isMesh) m.material = m.material.clone(); });
          const steam = [0, 1, 2].map((i) => { const s = tpl('fx_steam'); s.visible = false; scene.add(s); stationObjs.push(s); return { o: s, ph: i / 3 }; });
          const smoke = tpl('fx_smoke'); smoke.visible = false; scene.add(smoke); stationObjs.push(smoke);
          potObjs.set(t, { soup, lid: part(pot, 'lid'), steam, smoke, x: tileX(c), z: tileZ(r) });
        } else if (ch === 'F') {
          const smoke = tpl('fx_smoke'); smoke.visible = false; scene.add(smoke); stationObjs.push(smoke);
          fryerObjs.set(t, { oil: part(o, 'oil'), basket: part(o, 'basket'), smoke, x: tileX(c), z: tileZ(r), facing });
        } else if (ch === 'S') {
          const splash = tpl('fx_splash'); splash.visible = false; scene.add(splash); stationObjs.push(splash);
          sinkObjs.set(t, { water: part(o, 'water'), splash, x: tileX(c), z: tileZ(r) });
        } else if (ch === 'B') {
          boardObjs.set(t, { knife: part(o, 'knife') });
        }
      }
      sceneMap = mapId;
      placeCamera();
    }

    // The camera looks at the walkable part of the map from the near side, far
    // enough back that all of it (and a chef's head) fits the screen.
    function placeCamera() {
      if (!camera) return;
      let c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (MAP[r][c] !== '~') { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
      const cx = (tileX(c0) + tileX(c1)) / 2, cz = (tileZ(r0) + tileZ(r1)) / 2;
      const w = c1 - c0 + 2.2, d = r1 - r0 + 2.2;
      camera.aspect = hub.W / hub.H;
      camera.updateProjectionMatrix();
      const pitch = 0.95;                                  // radians below horizontal
      let dist = 10;
      const corners = [];
      for (const x of [cx - w / 2, cx + w / 2]) for (const z of [cz - d / 2, cz + d / 2]) for (const y of [0, 1.8]) corners.push(new THREE.Vector3(x, y, z));
      for (let i = 0; i < 4; i++) {
        camera.position.set(cx, dist * Math.sin(pitch), cz + 0.9 + dist * Math.cos(pitch));
        camera.lookAt(cx, 0.4, cz + 0.9);
        camera.updateMatrixWorld();
        let worst = 0;
        for (const p of corners) { const v = p.clone().project(camera); worst = Math.max(worst, Math.abs(v.x) / 0.95, Math.abs(v.y) / 0.84); }
        dist *= worst;
      }
      camera.position.set(cx, dist * Math.sin(pitch), cz + 0.9 + dist * Math.cos(pitch));
      camera.lookAt(cx, 0.4, cz + 0.9);
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

    const animalFor = (ch) => (window.MabarChars && MabarChars.ready(ANIMALS[ch.slot % ANIMALS.length]) ? ANIMALS[ch.slot % ANIMALS.length]
      : window.MabarChars ? ANIMALS.find((id) => MabarChars.ready(id)) || null : null);

    function buildChef3D(id) {
      if (!scene) return;
      const ch = chefs.get(id);
      if (!ch || chefObjs.has(id)) return;
      const animal = animalFor(ch);
      let root, rec;
      if (animal) {
        const a = MabarChars.create(animal, { scale: CHAR_SCALE, tool: null });   // a plain avatar: no racket
        root = a.root;
        rec = { root, ch: a };
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.31, 40), new THREE.MeshBasicMaterial({ color: ch.color, transparent: true, opacity: 0.85, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 1;
        ring.scale.setScalar(1 / CHAR_SCALE);
        root.add(ring);
        const tag = nameSprite(ch.name, ch.color);
        tag.position.y = 1.0 + 0.12 / CHAR_SCALE;
        tag.scale.multiplyScalar(1 / CHAR_SCALE);
        root.add(tag);
      } else {
        const tplChef = chars && chars.scene.getObjectByName('ch_chef');
        root = tplChef ? tplChef.clone(true) : new THREE.Group();
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
        const part = (s) => root.getObjectByName(`ch_chef_${s}`);
        rec = { root, armR: part('armR'), armL: part('armL'), legL: part('legL'), legR: part('legR'), walk: 0 };
      }
      scene.add(root);
      chefObjs.set(id, rec);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), new THREE.MeshBasicMaterial({ color: ch.color, transparent: true, opacity: 0.35, depthWrite: false }));
      hl.visible = false;
      scene.add(hl);
      highlights.set(id, hl);
    }

    function itemKey(it) {
      if (isPlate(it)) return `plate:${[...it.parts].sort().join(',')}`;
      return partKey(it);
    }

    function buildItem(it) {
      if (!isPlate(it)) {
        const st = it.state === 'raw' ? '' : `_${it.state}`;
        return tpl(`i_${it.type}${st}`);
      }
      const g = new THREE.Group();
      const m = matchRecipe(it);
      if (m) {
        g.add(tpl(DISH_NODE[m.id]));
        if (m.variant) {                                    // the extra: a chili pile or a lime
          const x = tpl(m.variant === 'pedas' ? 'i_chili_cut' : 'i_citrus_cut');
          x.scale.setScalar(0.5);
          x.position.set(0.13, 0.03, 0.08);
          g.add(x);
        }
        return g;
      }
      g.add(tpl('i_plate'));
      it.parts.forEach((k, i) => {
        const [type, state] = k.split(':');
        const o = tpl(`i_${type}${state === 'raw' ? '' : `_${state}`}`);
        const a = i * 2.1 + 0.4, r = it.parts.length > 1 ? 0.07 : 0;
        o.position.set(Math.cos(a) * r, 0.025, Math.sin(a) * r);
        o.scale.setScalar(0.62);
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

    function soupColor(pot) {
      if (pot.state === 'burnt') return '#2b2b2b';
      const c = new THREE.Color(0, 0, 0);
      for (const it of pot.items) c.add(new THREE.Color(ING[it.type].color));
      c.multiplyScalar(1 / Math.max(1, pot.items.length));
      if (pot.state === 'cooking') c.lerp(new THREE.Color('#f5e6c8'), 0.3);
      return c;
    }

    function syncScene(dt, time) {
      const stamp = time;
      const t = time / 1000;
      if (fx) fx.update(dt, t);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const tl = tiles[r][c];
        if (tl.item) placeItem(tl.item, tileX(c), TOP + (tl.ch === 'B' ? 0.04 : tl.ch === 'S' ? 0.18 : CRATE[tl.ch] ? 0.3 : 0), tileZ(r), 0, stamp);
      }
      for (const [id, ch] of chefs) {
        const o = chefObjs.get(id);
        if (!o) continue;
        const ry = Math.atan2(ch.fx, ch.fz);
        const holding = !!ch.hold;
        if (o.ch) {
          o.root.position.set(ch.x, 0, ch.z);
          const want = ry;
          let d = want - o.root.rotation.y;
          d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          o.root.rotation.y += d * Math.min(1, dt * 14);
          o.ch.setVelocity(ch.vx, ch.vz);
          if (ch.working > 0 && (o.ch.swingT < 0) && ch.workKind !== 'rinse') o.ch.swing(0.38, 'serve', 6 / 30);   // an overhead chop
          if (ch.bump > 0) ch.bump -= dt;
          o.ch.update(dt);
        } else {
          const moving = Math.hypot(ch.vx, ch.vz) > 0.2 ? 1 : 0;
          o.walk = (o.walk || 0) + dt * 12 * moving;
          o.root.position.set(ch.x, Math.abs(Math.sin(o.walk)) * 0.05 * moving, ch.z);
          o.root.rotation.y = ry;
          const leg = Math.sin(o.walk) * 0.8 * moving;
          if (o.legL) o.legL.rotation.x = leg;
          if (o.legR) o.legR.rotation.x = -leg;
          const chopA = ch.working > 0 ? Math.abs(Math.sin(time / 55)) : 0;
          if (o.armR) o.armR.rotation.set(holding ? -1.3 : ch.working > 0 ? -1.5 + chopA * 0.8 : -0.2 - 0.4 * moving * Math.sin(o.walk), 0, holding ? -0.25 : 0.1);
          if (o.armL) o.armL.rotation.set(holding ? -1.3 : -0.2 + 0.4 * moving * Math.sin(o.walk), 0, holding ? 0.25 : -0.1);
        }
        if (ch.hold) placeItem(ch.hold, ch.x + ch.fx * 0.4, o.ch ? 0.62 : 0.5, ch.z + ch.fz * 0.4, ry, stamp);
        const hl = highlights.get(id);
        const tg = targetOf(ch);
        if (hl) {
          hl.visible = !!tg && (phase === 'play' || phase === 'room');
          if (tg) hl.position.set(tileX(tg.c), (tg.ch === 'X' ? 0.66 : TOP) + 0.02, tileZ(tg.r));
        }
      }
      for (const [id, rec] of itemObjs) {
        if (rec.seen !== stamp) { scene.remove(rec.obj); itemObjs.delete(id); }
      }
      // pots: soup colour and level, lid rattling when done, steam while cooking, smoke when burning
      for (const [tile, po] of potObjs) {
        const pot = tile.pot;
        if (po.soup) {
          po.soup.o.visible = pot.items.length > 0;
          po.soup.o.position.y = po.soup.pos.y - 0.07 + 0.05 * Math.min(3, pot.items.length);   // the level rises with each thing added
          const col = soupColor(pot);
          po.soup.o.traverse((m) => { if (m.isMesh) m.material.color.set(col); });
        }
        if (po.lid) {
          const rattle = pot.state === 'done' ? 0.02 * Math.abs(Math.sin(t * 22)) : pot.state === 'cooking' ? 0.008 * Math.abs(Math.sin(t * 14)) : 0;
          po.lid.o.position.y = po.lid.pos.y + rattle;
          po.lid.o.rotation.z = pot.state === 'done' ? 0.06 * Math.sin(t * 22) : 0;
        }
        const cooking = pot.state === 'cooking' || pot.state === 'done';
        po.steam.forEach((s, i) => {
          s.o.visible = cooking;
          if (!cooking) return;
          const u = (t * 0.55 + s.ph) % 1;
          s.o.position.set(po.x + 0.12 * Math.sin(t * 2 + i), TOP + 0.45 + u * 0.9, po.z + 0.1 * Math.cos(t * 1.7 + i * 2));
          s.o.scale.setScalar(0.5 + 1.2 * Math.sin(Math.PI * u));
        });
        const warn = pot.state === 'done' && pot.t > BOIL_GRACE * 0.5;
        po.smoke.visible = pot.state === 'burnt' || warn;
        if (po.smoke.visible) {
          const u = (t * 0.7) % 1;
          po.smoke.position.set(po.x, TOP + 0.5 + u * 1.1, po.z);
          po.smoke.scale.setScalar((pot.state === 'burnt' ? 1.4 : 0.8) * (0.4 + Math.sin(Math.PI * u)));
        }
      }
      for (const [tile, fo] of fryerObjs) {
        const fr = tile.fryer;
        if (fo.basket) fo.basket.o.position.y = fo.basket.pos.y - (fr.state === 'cooking' || fr.state === 'burnt' ? 0.06 : 0) + (fr.state === 'done' ? 0.02 * Math.abs(Math.sin(t * 18)) : 0);
        if (fo.oil) fo.oil.o.scale.y = fo.oil.scale.y * (1 + (fr.state === 'cooking' ? 0.6 * Math.abs(Math.sin(t * 9)) : 0));
        const warn = fr.state === 'done' && fr.t > FRY_GRACE * 0.5;
        fo.smoke.visible = fr.state === 'burnt' || warn;
        if (fo.smoke.visible) {
          const u = (t * 0.7 + 0.3) % 1;
          fo.smoke.position.set(fo.x, TOP + 0.4 + u * 1.1, fo.z);
          fo.smoke.scale.setScalar((fr.state === 'burnt' ? 1.2 : 0.7) * (0.4 + Math.sin(Math.PI * u)));
        }
      }
      for (const [tile, so] of sinkObjs) {
        const rinsing = tile.item && tile.work > 0 && tile.work < 1 && [...chefs.values()].some((ch) => ch.working > 0 && ch.workKind === 'rinse' && targetOf(ch) === tile);
        if (so.water) so.water.o.visible = rinsing || !!tile.item;
        so.splash.visible = rinsing;
        if (rinsing) { so.splash.position.set(so.x, TOP + 0.3 + 0.1 * Math.abs(Math.sin(t * 12)), so.z); so.splash.scale.setScalar(0.8 + 0.4 * Math.abs(Math.sin(t * 12))); }
      }
      for (const [tile, bo] of boardObjs) {
        const chopping = tile.item && tile.work > 0 && tile.work < 1;
        if (bo.knife) { bo.knife.o.rotation.x = chopping ? -0.5 + 0.5 * Math.abs(Math.sin(t * 16)) : 0; bo.knife.o.position.y = bo.knife.pos.y + (chopping ? 0.08 * Math.abs(Math.sin(t * 16)) : 0); }
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
    // An ingredient pip: a coloured dot with the step's glyph on it.
    function pip(ctx, x, y, part, r = 9) {
      const [type, state] = part.split(':');
      dot(ctx, x, y, r, ING[type] ? ING[type].color : '#999');
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      const g = STATE_GLYPH[state];
      if (g) {
        ctx.fillStyle = state === 'cooked' || state === 'fried' ? '#1d2433' : '#1d2433';
        ctx.font = hub.font(800, r * 1.3);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(g, x, y + 1);
      }
    }

    function drawWorldUi(ctx, time) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const t = tiles[r][c];
        if ((t.ch === 'B' || t.ch === 'S') && t.item && t.work > 0) {
          const s = screenOf(tileX(c), TOP + 0.5, tileZ(r));
          bar(ctx, s.x, s.y, 54, t.work, t.ch === 'S' ? '#4dabf7' : '#2ed573');
        }
        if (t.pot && (t.pot.items.length || t.pot.state === 'burnt')) {
          const pot = t.pot;
          const s = screenOf(tileX(c), TOP + 0.85, tileZ(r));
          for (let i = 0; i < POT_MAX; i++) {
            if (pot.items[i]) pip(ctx, s.x - 18 + i * 18, s.y - 20, partKey(pot.items[i]), 7);
            else dot(ctx, s.x - 18 + i * 18, s.y - 20, 6, 'rgba(20,20,26,0.35)');
          }
          if (pot.state === 'cooking') bar(ctx, s.x, s.y - 6, 60, pot.t / BOIL, '#ffd32a');
          if (pot.state === 'done') readyBadge(ctx, s.x, s.y, pot.t > BOIL_GRACE * 0.5, time);
          if (pot.state === 'burnt') { if (t.work > 0) bar(ctx, s.x, s.y - 6, 60, t.work, '#adb5bd'); burntBadge(ctx, s.x, s.y); }
        }
        if (t.fryer && (t.fryer.item || t.fryer.state === 'burnt')) {
          const fr = t.fryer;
          const s = screenOf(tileX(c), TOP + 0.85, tileZ(r));
          if (fr.item) pip(ctx, s.x, s.y - 20, partKey(fr.item), 7);
          if (fr.state === 'cooking') bar(ctx, s.x, s.y - 6, 60, fr.t / FRY, '#ffd32a');
          if (fr.state === 'done') readyBadge(ctx, s.x, s.y, fr.t > FRY_GRACE * 0.5, time);
          if (fr.state === 'burnt') { if (t.work > 0) bar(ctx, s.x, s.y - 6, 60, t.work, '#adb5bd'); burntBadge(ctx, s.x, s.y); }
        }
      }
      for (const pp of popups) {
        const s = screenOf(pp.x, TOP + 0.9, pp.z);
        ctx.globalAlpha = Math.max(0, 1 - pp.t / 1.3);
        ctx.font = hub.font(800, 17);
        ctx.textAlign = 'center';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(20,20,26,0.6)';
        ctx.strokeText(pp.text, s.x, s.y - pp.t * 30);
        ctx.fillStyle = pp.color;
        ctx.fillText(pp.text, s.x, s.y - pp.t * 30);
      }
      for (const b of bell) {                             // the served dish's name floats off the hatch
        const s = screenOf(b.x, TOP + 1.2, b.z);
        ctx.globalAlpha = Math.max(0, 1 - b.t / 1.6);
        ctx.font = hub.font(800, 20);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,20,26,0.6)';
        const txt = `🔔 ${recipeName(b.recipe, b.variant)}`;
        ctx.strokeText(txt, s.x, s.y - b.t * 40);
        ctx.fillText(txt, s.x, s.y - b.t * 40);
      }
      ctx.globalAlpha = 1;
    }
    function readyBadge(ctx, x, y, warn, time) {
      const flash = warn && Math.sin(time / 90) > 0;
      rr(ctx, x - 26, y - 8, 52, 24, 12);
      ctx.fillStyle = flash ? '#ff4757' : '#2ed573';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = hub.font(800, 14);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(warn ? '! !' : '✓', x, y + 4);
    }
    function burntBadge(ctx, x, y) {
      ctx.font = hub.font(800, 14);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff4757';
      ctx.fillText('BURNT', x, y + 4);
    }

    // Order cards: name, container, the parts with their step glyphs, patience.
    function drawOrders(ctx) {
      const w = 164, h = 96;
      orders.slice(0, 6).forEach((o, i) => {
        const R = RECIPES[o.id];
        const x = 18 + i * (w + 10), y = 16;
        const k = 1 - o.t / o.life;
        const shake = k < 0.2 ? Math.sin(performance.now() / 40) * 2 : 0;
        ctx.save();
        ctx.translate(shake, 0);
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur = 12;
        rr(ctx, x, y, w, h, 14);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(shake, 0);
        rr(ctx, x, y, w, 8, [14, 14, 0, 0]);
        ctx.fillStyle = o.variant ? '#ff4b3e' : '#ffb020';
        ctx.fill();
        ctx.fillStyle = '#2a2a2a';
        ctx.font = hub.font(800, 13);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(R.name, x + w / 2, y + 26);
        if (o.variant) {
          ctx.fillStyle = '#ff4b3e';
          ctx.font = hub.font(800, 11);
          ctx.fillText(o.variant === 'pedas' ? '🌶 PEDAS' : '+ CITRUS', x + w / 2, y + 42);
        } else {
          ctx.fillStyle = '#9a9286';
          ctx.font = hub.font(600, 11);
          ctx.fillText(R.container === 'bowl' ? 'in a bowl' : R.container === 'glass' ? 'in a glass' : 'on a plate', x + w / 2, y + 42);
        }
        const n = o.parts.length;
        o.parts.forEach((part, j) => pip(ctx, x + w / 2 - (n - 1) * 11 + j * 22, y + 60, part, 8));
        bar(ctx, x + w / 2, y + 76, w - 24, k, k > 0.5 ? '#2ed573' : k > 0.25 ? '#ffd32a' : '#ff4757');
        ctx.restore();
      });
    }

    function drawTopRight(ctx) {
      const { W } = hub;
      const t = phase === 'play' ? Math.max(0, SHIFT - shiftT) : SHIFT;
      rr(ctx, W - 190, 16, 172, 118, 16);
      ctx.fillStyle = 'rgba(20,20,26,0.82)';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd32a';
      ctx.font = hub.font(800, 30);
      ctx.fillText(`★ ${score}`, W - 104, 44);
      ctx.fillStyle = t < 20 && phase === 'play' ? '#ff6b6b' : '#ffffff';
      ctx.font = hub.font(700, 20);
      ctx.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, W - 104, 78);
      ctx.fillStyle = combo >= 3 ? '#2ed573' : 'rgba(255,255,255,0.55)';
      ctx.font = hub.font(600, 12);
      ctx.fillText(combo >= 3 ? `COMBO ×${combo}` : `${kit.name.toUpperCase()} · ${hub.code || '····'}`, W - 104, 104);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = hub.font(600, 10);
      ctx.fillText('H for the QR', W - 104, 122);
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

    // The waiting room: join QR, the clock, who's in, votes. The kitchen is chosen
    // next, together, on the 3D cards.
    function drawRoomCard(ctx) {
      const { W, H } = hub;
      const chefsIn = [...chefs.values()].sort((a, b) => a.slot - b.slot);
      const n = chefsIn.length;
      const need = [...hub.players.keys()].filter((id) => !votes.has(id)).length;
      const wide = W >= 820;
      const cw = Math.min(760, W - 32), chh = wide ? 296 : 540;
      const x0 = (W - cw) / 2, y0 = Math.max(14, (H - chh) / 2);
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
      const qs = wide ? 180 : 150;
      const qx = wide ? x0 + 30 : x0 + (cw - qs) / 2, qy = y0 + 36;
      hub.drawJoin(ctx, qx, qy, qs, { label: 'Scan with your phone to join' });
      const rx = wide ? qx + qs + 30 : x0 + 20, rw = wide ? cw - (rx - x0) - 26 : cw - 40;
      const cx = rx + rw / 2;
      let y = wide ? y0 + 50 : qy + qs + 86;
      const line = (t, size, weight, color, gap = 28) => {
        ctx.font = hub.font(weight, size);
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t, cx, y);
        y += gap;
      };
      line('COOKING', 28, 800, '#ff4b3e', 36);
      line(n ? `Kitchen opens in ${Math.ceil(roomT)}s` : 'Waiting for the first chef', 20, 800, '#1d2433', 40);
      // who's in: a chip per chef, in their colour
      ctx.font = hub.font(700, 13);
      const chips = chefsIn.map((c) => ({ c, w: Math.min(140, ctx.measureText(c.name).width) + 38 }));
      const total = chips.reduce((a, b) => a + b.w + 8, -8);
      let px = cx - total / 2;
      for (const { c, w } of chips) {
        rr(ctx, px, y - 15, w, 30, 15);
        ctx.fillStyle = '#f3efe8';
        ctx.fill();
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(px + 15, y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1d2433';
        ctx.textAlign = 'left';
        ctx.fillText(c.name, px + 27, y + 1, w - 34);
        px += w + 8;
      }
      y += n ? 46 : 20;
      line('Move with the stick · A grab / put / use · hold X to chop, rinse, scrape · B dash', 12, 600, '#5d584f', 22);
      line('When everyone has voted, the team picks the kitchen together', 12, 600, '#9a9286', 24);
      line(n ? (need ? `${need} more vote${need > 1 ? 's' : ''} to go on now (tap “Vote to start”)` : 'Here we go…') : 'Up to 4 chefs. Walk around and practise while you wait.', 13, 600, '#5d584f');
    }
    // Changes the kitchen: in the room it swaps the practice kitchen (the smoke test
    // uses this), in the pick it moves the highlight.
    function pickMap(id) {
      if (!K[id]) return;
      if (phase === 'pick') { selectCard(MAP_IDS.indexOf(id)); return; }
      if (phase !== 'room' || id === mapId) return;
      switchKitchen(id);
    }

    function drawOver(ctx) {
      const s = stars();
      const p = par(Math.max(1, chefs.size));
      card(ctx, [
        { t: 'SHIFT OVER!', s: 30, w: 800, c: '#ff4b3e' },
        { t: '★'.repeat(s) + '☆'.repeat(3 - s), s: 40, w: 800, c: '#ffb020' },
        { t: `${score} points  (3 stars at ${p})`, s: 22, w: 800, c: '#222' },
        { t: `${served} served · ${failed} missed · best combo ×${bestCombo}`, s: 15 },
        { t: `Back to the kitchen in ${Math.ceil(phaseT)}…`, s: 14, c: '#7a7368' },
      ]);
    }

    // ---------------- loading ----------------
    const envCache = new Map();
    // A kitchen's diorama, loaded once (null if the file can't load: a plain floor then).
    function envPromise(id) {
      const k = K[id];
      if (!k) return Promise.resolve(null);
      if (!envCache.has(id)) {
        envCache.set(id, Kit3D.load(k.env, (p) => { loadP = p; }).catch((e) => {
          console.warn(`[mabar] ${k.env} failed, using a plain floor`, e);
          return null;
        }));
      }
      return envCache.get(id);
    }
    // ... and, if it is still the current kitchen when it arrives, into the scene.
    function loadEnv(id) {
      return envPromise(id).then((g) => {
        if (stopped || id !== mapId) return g;
        env = g;
        if (scene && phase !== 'pick') buildMap3D();
        return g;
      });
    }

    loadKitchen(mapId);
    const animalsP = window.MabarChars ? Promise.all(ANIMALS.map((id) => MabarChars.load(id).catch(() => null))) : Promise.resolve([]);
    Promise.all([Kit3D.load('assets/kitchen.glb', (p) => { loadP = p; }), Kit3D.load('assets/characters.glb').catch(() => null), loadEnv(mapId), animalsP])
      .then(([k, c]) => { if (stopped) return; kitAsset = k; chars = c; setup(); })
      .catch((e) => { loadErr = 'Couldn’t load the kitchen'; console.error(e); });

    toRoom();

    // Host-screen mouse on the pick: hover shows, a click highlights, a second click
    // confirms (the keyboard goes through the keyboard player: ← → and Enter / Space).
    const arena = document.querySelector('#arena');
    const onMove = (e) => {
      pickHover = phase === 'pick' ? pickHit(e) : -1;
      arena.style.cursor = pickHover >= 0 ? 'pointer' : '';
    };
    const onClick = (e) => {
      if (phase !== 'pick') return;
      const i = pickHit(e);
      if (i < 0) return;
      if (i === pickSel) confirmPick(); else selectCard(i);
    };
    arena.addEventListener('pointermove', onMove);
    arena.addEventListener('click', onClick);

    return {
      start() { for (const p of hub.players.values()) addChef(p); hub.showLobby(false, false); },
      stop() {
        stopped = true;
        arena.removeEventListener('pointermove', onMove);
        arena.removeEventListener('click', onClick);
        hub.showLobby(true);
        for (const o of chefObjs.values()) if (o.ch) o.ch.dispose();
        teardownPick();
        if (fx) fx.dispose();
        if (scene) scene.clear();
        if (renderer) renderer.dispose_();
      },
      join(p) { addChef(p); },
      leave(p) { votes.delete(p.id); pickNav.delete(p.id); removeChef(p.id); },

      press(p, bits) {
        const ch = chefs.get(p.id);
        if (!ch) return;
        if (phase === 'pick') {                              // d-pad (the stick repeats in update)
          if (bits & B.LEFT && Math.hypot(p.sx, p.sy) < 0.05) selectCard(pickSel - 1);
          if (bits & B.RIGHT && Math.hypot(p.sx, p.sy) < 0.05) selectCard(pickSel + 1);
          if (bits & B.A) confirmPick();
          return;
        }
        if (bits & B.A) { if (phase === 'over') return; interact(ch); }
        if (bits & B.X) work(ch, 0.2);
        if (bits & B.B && ch.dashCd <= 0 && (phase === 'play' || phase === 'room')) { ch.dash = DASH; ch.dashCd = DASH_CD; rumble(ch, 10); }
      },
      action(p) {
        if (phase === 'pick') { if (chefs.has(p.id)) confirmPick(); return; }
        if (phase !== 'room') return;
        if (votes.has(p.id)) votes.delete(p.id); else votes.add(p.id);
        hub.rumble(p, 30);
      },
      actionLabel(p) {
        if (phase === 'pick') return chefs.has(p.id) ? 'Choose this kitchen' : '';
        if (phase !== 'room') return '';
        return votes.has(p.id) ? 'Voted ✓ — tap to undo' : 'Vote to start';
      },
      hint(p) {
        const ch = chefs.get(p.id);
        if (!ch) return 'Kitchen is full — watch and join next shift';
        if (phase === 'pick') return '← → pick the kitchen · A to confirm';
        if (phase === 'over') return 'Shift over!';
        const h = ch.hold;
        if (!h) return 'A grab · hold X chop/rinse · B dash';
        if (isPlate(h)) {
          const m = matchRecipe(h);
          if (m) return `${recipeName(m.id, m.variant)} · serve it at the hatch (A)`;
          return h.parts.length ? `Plate: ${h.parts.map((k) => { const [tp, st] = k.split(':'); return `${STATE_WORD[st] ? STATE_WORD[st] + ' ' : ''}${ING[tp].name}`; }).join(', ')}` : 'Empty plate · add cooked food';
        }
        const d = ING[h.type];
        const nm = d ? d.name : h.type;
        if (h.state === 'raw' && d && d.prep === 'board') return `${nm}: chop it at a board (A, then hold X)`;
        if (h.state === 'raw' && d && d.prep === 'sink') return `${nm}: rinse it at the sink (A, then hold X)`;
        if (h.state === 'rinsed') return `rinsed ${nm}: boil it in a pot (A)`;
        if (h.type === 'noodles' && h.state === 'raw') return 'noodles: boil them in a pot (A)';
        if (h.state === 'cut' && d && d.boil && d.fry) return `chopped ${nm}: boil, fry, or plate it (A)`;
        if (h.state === 'cut' && d && d.boil) return `chopped ${nm}: boil it, or plate it (A)`;
        if (h.state === 'cut' && d && d.fry) return `chopped ${nm}: fry it (A)`;
        return `${STATE_WORD[h.state] ? STATE_WORD[h.state] + ' ' : ''}${nm}: plate it (A)`;
      },
      meta(p) { return chefs.has(p.id) ? (phase === 'room' ? (votes.has(p.id) ? 'voted' : 'chef') : phase === 'pick' ? 'choosing' : 'chef') : 'watching'; },
      resize() { if (renderer) { renderer.setSize(hub.W, hub.H, false); placeCamera(); aimPickCam(true); } },

      update(dt) {
        for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > 1.3) popups.splice(i, 1); }
        for (let i = bell.length - 1; i >= 0; i--) { bell[i].t += dt; if (bell[i].t > 1.6) bell.splice(i, 1); }
        if (phase === 'room') {
          for (const p of hub.players.values()) addChef(p);
          if (hub.players.size) {
            roomT -= dt;
            const allVoted = [...hub.players.keys()].every((id) => votes.has(id));
            if (allVoted || roomT <= 0) toPick();
          } else roomT = ROOM_TIME;
        } else if (phase === 'pick') {
          if (!hub.players.size) { leavePick(mapId); toRoom(); } else {
            pickT -= dt;
            for (const p of hub.players.values()) {                // stick left / right, with repeat
              let t = pickNav.get(p.id) || 0;
              if (Math.abs(p.sx) > 0.6) { if (t <= 0) { selectCard(pickSel + (p.sx > 0 ? 1 : -1)); t = 0.32; } else t -= dt; } else t = 0;
              pickNav.set(p.id, t);
            }
            if (pickT <= 0) confirmPick();
          }
        } else if (phase === 'countdown') {
          phaseT -= dt;
          if (phaseT <= 0) { phase = 'play'; shiftT = 0; addOrder(); addOrder(); nextOrderT = 12; }
        } else if (phase === 'play') {
          shiftT += dt;
          nextOrderT -= dt;
          const pace = paceFor(chefs.size);
          if (nextOrderT <= 0 && orders.length < pace.max) { addOrder(); nextOrderT = pace.gap * (1 - 0.25 * shiftT / SHIFT) * (0.85 + Math.random() * 0.3); }
          if (!orders.length && nextOrderT > 3) nextOrderT = 3;
          for (let i = orders.length - 1; i >= 0; i--) {
            orders[i].t += dt;
            if (orders[i].t >= orders[i].life) {
              const o = orders.splice(i, 1)[0];
              score = Math.max(0, score - 10);
              failed++;
              combo = 0;
              popups.push({ text: `${recipeName(o.id, o.variant)} missed! −10`, x: 0, z: tileZ(0) + 1, color: '#ff6b6b', t: 0 });
              for (const p of hub.players.values()) hub.rumble(p, 90);
            }
          }
          for (let i = plateReturns.length - 1; i >= 0; i--) { plateReturns[i] -= dt; if (plateReturns[i] <= 0) plateReturns.splice(i, 1); }
          if (shiftT >= SHIFT) endShift();
        } else if (phase === 'over') {
          phaseT -= dt;
          if (phaseT <= 0) toRoom();
        }

        // pots and fryers cook during the shift (and in practice)
        for (const row of tiles) for (const t of row) {
          if (t.pot) {
            const pot = t.pot;
            if (pot.state === 'cooking') { pot.t += dt; if (pot.t >= BOIL) { pot.state = 'done'; pot.t = 0; } }
            else if (pot.state === 'done') { pot.t += dt; if (pot.t >= BOIL_GRACE) { pot.state = 'burnt'; pot.t = 0; t.work = 0; popups.push({ text: 'Burnt!', x: tileX(t.c), z: tileZ(t.r), color: '#ff6b6b', t: 0 }); } }
          }
          if (t.fryer) {
            const fr = t.fryer;
            if (fr.state === 'cooking') { fr.t += dt; if (fr.t >= FRY) { fr.state = 'done'; fr.t = 0; } }
            else if (fr.state === 'done') { fr.t += dt; if (fr.t >= FRY_GRACE) { fr.state = 'burnt'; fr.t = 0; t.work = 0; popups.push({ text: 'Burnt!', x: tileX(t.c), z: tileZ(t.r), color: '#ff6b6b', t: 0 }); } }
          }
        }

        // movement (frozen during the countdown and the results)
        const canMove = phase === 'room' || phase === 'play';
        for (const [id, ch] of chefs) {
          const p = hub.players.get(id);
          ch.working = Math.max(0, ch.working - dt);
          ch.dashCd = Math.max(0, ch.dashCd - dt);
          if (!p) continue;
          const busy = p.b & B.X && canMove && work(ch, dt);   // holding X keeps chopping (and holds you there)
          const d = canMove && !busy ? hub.dir(p) : { x: 0, y: 0 };
          const m = Math.hypot(d.x, d.y);
          let vx = 0, vz = 0;
          if (m > 0.15) {
            ch.fx = d.x / m; ch.fz = d.y / m;
            vx = d.x * SPEED; vz = d.y * SPEED;
          }
          if (ch.dash > 0) { ch.dash -= dt; vx += ch.fx * DASH_SPEED; vz += ch.fz * DASH_SPEED; }
          const px = ch.x, pz = ch.z;
          move(ch, vx * dt, vz * dt);
          ch.vx += ((ch.x - px) / Math.max(dt, 1e-3) - ch.vx) * Math.min(1, dt * 12);
          ch.vz += ((ch.z - pz) / Math.max(dt, 1e-3) - ch.vz) * Math.min(1, dt * 12);
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
        if (phase === 'pick' && pickScene) {
          animatePick(dt, time / 1000);
          renderer.render(pickScene, pickCam);
          drawPickBar(ctx);
          return;
        }
        syncScene(dt, time);
        renderer.render(scene, camera);
        drawWorldUi(ctx, time);
        if (phase === 'play' || phase === 'countdown') drawOrders(ctx);
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

      // Test hooks (tools/smoke.mjs).
      _fastForward(sec) { if (phase === 'room') roomT -= sec; else if (phase === 'pick') pickT -= sec; else if (phase === 'play') { shiftT += sec; for (const o of orders) o.t += sec; } else if (phase === 'countdown') phaseT -= sec; },
      _debug: () => ({
        phase, map: mapId, sceneMap, score, served, failed, combo, orders: orders.map((o) => o.id + (o.variant ? ':' + o.variant : '')),
        pick: phase === 'pick' ? { sel: MAP_IDS[pickSel], cards: pickCards.length, loaded: pickCards.filter((c) => c.env).length, t: Math.round(pickT) } : null,
        chefs: [...chefs.values()].map((c) => ({ name: c.name, x: +c.x.toFixed(2), z: +c.z.toFixed(2), hold: c.hold && itemKey(c.hold), target: (targetOf(c) || {}).ch, animal: (chefObjs.get(c.id) || {}).ch ? chefObjs.get(c.id).ch.id : 'chibi' })),
        pots: tiles.flat().filter((t) => t.pot).map((t) => ({ items: t.pot.items.length, state: t.pot.state })),
        fryers: tiles.flat().filter((t) => t.fryer).map((t) => ({ item: t.fryer.item && itemKey(t.fryer.item), state: t.fryer.state })),
        boards: tiles.flat().filter((t) => t.ch === 'B').map((t) => t.item && itemKey(t.item)),
        env: !!env, stations: stationObjs.length,
      }),
      _order(key, variant = null) { addOrder({ id: key, variant }); },
      _teleport(id, c, r, fx, fz) { const ch = chefs.get(id); if (ch) { ch.x = tileX(c); ch.z = tileZ(r); ch.fx = fx; ch.fz = fz; } },
      _give(id, type, state = 'raw', parts = null) { const ch = chefs.get(id); if (!ch) return; ch.hold = newItem(type, state); if (parts) ch.hold.parts = parts; },
      _setMap(id) { pickMap(id); },
      _tick(sec) {                                           // advance cooking timers without waiting
        for (const row of tiles) for (const t of row) {
          if (t.pot && (t.pot.state === 'cooking' || t.pot.state === 'done')) t.pot.t += sec;
          if (t.fryer && (t.fryer.state === 'cooking' || t.fryer.state === 'done')) t.fryer.t += sec;
        }
      },
      _press(id, bit) { const p = hub.players.get(id); if (p) this.press(p, bit); },
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

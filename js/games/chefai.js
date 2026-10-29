// AI chefs for Cooking: js/games/cooking.js seats one in every open seat no phone has
// taken, and hands a leaver's chef to one mid-shift.
//
// An AI chef plays through the same controls as a phone: each frame its brain returns a
// stick and buttons (A, held X, B to dash), and cooking.js feeds them through the same
// movement, collision and interaction code as a player's. So it can only do what a chef
// can: walk the tile grid, face a station, press A, hold X.
//
// Decisions are utility-based on one shared plan of the kitchen (plan()): every open
// order, in priority, is given a plate, the pots and fryer whose contents fit it, and a
// loose or held item for each remaining part (the most advanced one on its way there);
// parts nothing covers are fetched from a crate. A brain with full hands finishes what
// it holds: the next station on the item's way to its part, or the next ready part for
// the plate, then the hatch. With empty hands it scores the open jobs (order priority x
// step value - walking distance) and takes one no other AI chef has claimed. A failed
// press, a station someone else took or a chef in the way is noticed and the job is
// dropped, blacklisted for a few seconds and replanned.
//
// Difficulty is behaviour, not a dice roll on success (LEVELS):
//   Easy  (rated 50%) serves orders first come first served (one already in the red
//         goes last), thinks ~0.4 s per step, takes a worse job one time in five,
//         sometimes walks a detour, doubles up on a teammate's job one time in five,
//         walks a little slower, never dashes and notices food about to burn 3.5 s late.
//   Hard  (rated 90%) ranks orders by time left against the work still needed and leaves
//         hopeless ones for last, thinks ~0.1 s, respects every claim, routes around
//         other chefs, dashes on straight runs and rescues pots and fryers at once.
window.MabarChefAI = (() => {
  'use strict';

  const LEVELS = {
    easy: { id: 'easy', name: 'Easy', rating: 50, think: [0.25, 0.5], best: 0.8, fifo: true, claims: 0.8, detour: 0.15, speed: 0.9, dash: false, notice: 3.5, crowd: 0, weight: 0.5 },
    hard: { id: 'hard', name: 'Hard', rating: 90, think: [0.06, 0.15], best: 1, fifo: false, claims: 1, detour: 0, speed: 1, dash: true, notice: 0, crowd: 4, weight: 0.85 },
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const counts = (list) => { const m = new Map(); for (const k of list) m.set(k, (m.get(k) || 0) + 1); return m; };
  const fits = (parts, need) => { for (const [k, n] of counts(parts)) if ((need.get(k) || 0) < n) return false; return true; };
  const take = (need, parts) => { for (const k of parts) need.set(k, need.get(k) - 1); };
  const rest = (need) => { const out = []; for (const [k, n] of need) for (let i = 0; i < n; i++) out.push(k); return out; };
  const same = (a, b) => a.length === b.length && fits(a, counts(b));

  // The steps from a crate to a recipe part: tofu:fried = crate (raw), board (cut), fryer (fried).
  function chainOf(ING, part) {
    const [type, state] = part.split(':');
    const d = ING[type], steps = [['crate', 'raw']];
    if (state === 'raw') return steps;
    if (d.prep === 'board') steps.push(['board', 'cut']);
    if (d.prep === 'sink') steps.push(['sink', 'rinsed']);
    if (state === 'cooked') steps.push(['pot', 'cooked']);
    if (state === 'fried') steps.push(['fryer', 'fried']);
    return steps;
  }
  // How far an item is on its way to `part` (its index in the chain), or -1.
  function stageOf(ING, it, part) {
    if (!it || it.type !== part.split(':')[0]) return -1;
    return chainOf(ING, part).findIndex((s) => s[1] === it.state);
  }

  // ---------------- the shared plan ----------------
  const sticky = new WeakMap();   // plate / item / pot tile -> the order (and part) it was planned for: keeps plans steady
  let cache = null;

  function plan(W, L) {
    if (cache && cache.frame === W.frame() && cache.L === L) return cache;
    const ING = W.ING;
    const plates = [], loose = [], pots = [], fryers = [];
    for (const t of W.tiles()) {
      if (t.item) (W.isPlate(t.item) ? plates : loose).push({ it: t.item, tile: t, chef: null });
      if (t.pot && t.pot.items.length && t.pot.state !== 'burnt') pots.push(t);
      if (t.fryer && t.fryer.item && t.fryer.state !== 'burnt') fryers.push(t);
    }
    for (const ch of W.chefs()) if (ch.hold) (W.isPlate(ch.hold) ? plates : loose).push({ it: ch.hold, tile: null, chef: ch });

    let orders = W.orders().slice();
    if (L.fifo) {                  // first come first served, but an order already in the red goes last
      const red = (o) => (o.life - o.t < o.life * 0.15 ? 1 : 0);
      orders.sort((a, b) => red(a) - red(b));
    } else {                 // urgency against the work left; hopeless orders go last
      const work = (o) => o.parts.reduce((s, p) => s + chainOf(ING, p).length * 3.5, 6);
      const key = (o) => { const left = o.life - o.t; return (left < work(o) * 0.4 ? 1000 : 0) + left - work(o); };
      orders.sort((a, b) => key(a) - key(b));
    }
    const used = new Set();
    const ops = orders.map((o) => {
      const need = counts(o.parts);
      const op = { o, plate: null, pots: [], fryers: [], items: [], missing: [] };
      let best = null, bs = -1;
      for (const e of plates) {
        if (used.has(e.it) || !fits(e.it.parts, need)) continue;
        const s = (sticky.get(e.it) === o.uid ? 100 : 0) + e.it.parts.length;
        if (s > bs) { bs = s; best = e; }
      }
      if (best) { used.add(best.it); op.plate = best; take(need, best.it.parts); sticky.set(best.it, o.uid); }
      const mine = (t) => (sticky.get(t) === o.uid ? 0 : 1);
      for (const t of pots.filter((p) => !used.has(p)).sort((a, b) => mine(a) - mine(b))) {
        const ys = t.pot.items.map((it) => `${it.type}:${ING[it.type].boil[1]}`);
        if (fits(ys, need)) { used.add(t); take(need, ys); op.pots.push(t); sticky.set(t, o.uid); }
      }
      for (const t of fryers.filter((p) => !used.has(p)).sort((a, b) => mine(a) - mine(b))) {
        const y = [`${t.fryer.item.type}:${ING[t.fryer.item.type].fry[1]}`];
        if (fits(y, need)) { used.add(t); take(need, y); op.fryers.push(t); sticky.set(t, o.uid); }
      }
      for (const part of rest(need)) {
        let pick = null, ps = -1, st = -1;
        for (const e of loose) {
          if (used.has(e.it)) continue;
          const s0 = stageOf(ING, e.it, part);
          if (s0 < 0) continue;
          const sk = sticky.get(e.it);
          const s = (sk && sk.uid === o.uid && sk.part === part ? 100 : 0) + s0 * 10 + (e.chef ? 5 : 0);
          if (s > ps) { ps = s; pick = e; st = s0; }
        }
        if (!pick) { op.missing.push(part); continue; }
        used.add(pick.it);
        sticky.set(pick.it, { uid: o.uid, part });
        op.items.push({ ...pick, part, next: chainOf(ING, part)[st + 1] || null });
      }
      return op;
    });
    cache = { frame: W.frame(), L, ops, plates, loose, pots, used };
    return cache;
  }

  // ---------------- one AI chef ----------------
  function brain(W, ch, levelId) {
    let L = LEVELS[levelId] || LEVELS.easy;
    const pad = { sx: 0, sy: 0, b: 0 };
    const black = new Map();        // tile / item / job key -> time it may be tried again
    const stats = { ok: 0, fail: 0, stuck: 0, recovered: 0, idle: 0 };
    let mode = 'think', wait = 0.3, clock = 0, lastOk = 0, fails = 0;
    let I = null;                   // the intent: { tile, act: 'A' | 'X' | 'wait' | 'idle', key, item, state0 }
    let path = [], pi = 0, bestD = Infinity, stuckT = 0, stuck = 0, faceT = 0, workT = 0, lastWork = 0, snap = null;
    let focus = null, forOrder = null, dump = null, yieldT = 0, yieldTo = null, waited = 0, letGo = false;

    const tileKey = (t) => `${t.c},${t.r}`;
    const barred = (k) => (black.get(k) || 0) > clock;
    const bar = (k, s) => black.set(k, clock + s);
    const here = () => {
      const c = W.toC(ch.x), r = W.toR(ch.z);
      if (W.walk(c, r)) return [c, r];
      let best = [c, r], bd = Infinity;     // pushed onto an edge: the nearest walkable tile
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!W.walk(c + dc, r + dr)) continue;
        const d = Math.hypot(W.tileX(c + dc) - ch.x, W.tileZ(r + dr) - ch.z);
        if (d < bd) { bd = d; best = [c + dc, r + dr]; }
      }
      return best;
    };
    const others = () => W.chefs().filter((c) => c !== ch);
    // Tiles other chefs stand on cost more to walk through (Hard routes around them).
    function crowdCost(extra = 0) {
      const m = new Map();
      if (!L.crowd && !extra) return m;
      for (const c of others()) m.set(W.toR(c.z) * W.cols() + W.toC(c.x), L.crowd + extra);
      return m;
    }

    // Walking distance (tiles) from `from` to every tile: Dijkstra on the walkable grid.
    function field(from, cost) {
      const C = W.cols(), N = W.rows() * C;
      const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
      const s = from[1] * C + from[0];
      dist[s] = 0;
      const open = [s];
      while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
        const u = open[bi];
        open[bi] = open[open.length - 1]; open.pop();
        if (done[u]) continue;
        done[u] = 1;
        const uc = u % C, ur = (u - uc) / C;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const vc = uc + dc, vr = ur + dr;
          if (!W.walk(vc, vr)) continue;
          const v = vr * C + vc;
          const nd = dist[u] + 1 + (cost.get(v) || 0);
          if (nd < dist[v]) { dist[v] = nd; prev[v] = u; open.push(v); }
        }
      }
      return { dist, prev, C };
    }
    const standsOf = (t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => [t.c + dc, t.r + dr]).filter(([c, r]) => W.walk(c, r));
    function reach(F, t) {
      let best = Infinity, at = null;
      for (const [c, r] of standsOf(t)) { const d = F.dist[r * F.C + c]; if (d < best) { best = d; at = [c, r]; } }
      return { d: best, at };
    }
    function trace(F, at) {
      const out = [];
      for (let u = at[1] * F.C + at[0]; u >= 0; u = F.prev[u]) out.push([u % F.C, Math.floor(u / F.C)]);
      return out.reverse();
    }

    // Stations: the nearest free one of a kind (no item on it, nobody else headed there).
    // Only the ones that hold one thing are reserved; the hatch, dish stack, bin and
    // crates serve anyone.
    const ONE = new Set(['B', 'S', 'C', 'F', '#']);
    const claimedTiles = () => new Set(W.chefs().filter((c) => c !== ch && c.ai && c.ai.intent()).map((c) => c.ai.intent().tile));
    function nearestTile(F, kinds, ok = () => true) {
      const taken = claimedTiles();
      let best = null, bd = Infinity;
      for (const t of W.tiles()) {
        if (!kinds.includes(t.ch) || (taken.has(t) && ONE.has(t.ch)) || barred(tileKey(t)) || !ok(t)) continue;
        const d = reach(F, t).d;
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    }
    // A free plain counter, near `ref` (a tile) if given; when they are all taken, the rim
    // of a crate nobody needs right now (a crate rim holds one thing too).
    function freeCounter(F, ref) {
      const taken = claimedTiles();
      const wanted = new Set(plan(W, L).ops.flatMap((op) => op.missing.map((part) => W.crateOf(part.split(':')[0]))));
      let best = null, bs = Infinity;
      for (const t of W.tiles()) {
        const rim = isCrate(t);
        if ((t.ch !== '#' && !rim) || (rim && wanted.has(t.ch)) || t.item || taken.has(t) || barred(tileKey(t))) continue;
        const d = reach(F, t).d;
        if (!Number.isFinite(d)) continue;
        const s = d + (ref ? 0.6 * (Math.abs(ref.c - t.c) + Math.abs(ref.r - t.r)) : 0) + (rim ? 30 : 0);
        if (s < bs) { bs = s; best = t; }
      }
      return best;
    }
    const crateLetters = new Set();
    const isCrate = (t) => {
      if (!crateLetters.size) for (const type of Object.keys(W.ING)) { const k = W.crateOf(type); if (k) crateLetters.add(k); }
      return crateLetters.has(t.ch);
    };
    const freeCounters = () => W.tiles().filter((t) => t.ch === '#' && !t.item).length;
    const opOf = (P, it) => P.ops.find((op) => op.plate && op.plate.it === it);
    const entryOf = (P, it) => { for (const op of P.ops) { const e = op.items.find((x) => x.it === it); if (e) return { op, e }; } return null; };
    const potReady = (t) => t.pot.state === 'done' && t.pot.t >= L.notice;
    // Boil an order's parts together: a pot starts only when every part it boils is ready
    // to go in (or joins a boil under way), so nothing sits done and burns while the
    // rest is still being fetched.
    const boiled = (part) => part.endsWith(':cooked');
    const potGo = (op) => op.pots.some((t) => t.pot.state === 'cooking')
      || (!op.missing.some(boiled) && op.items.every((e) => !boiled(e.part) || !e.next || e.next[0] === 'pot'));
    const fryReady = (t) => t.fryer.state === 'done' && t.fryer.t >= L.notice;

    // ---------------- deciding ----------------
    function decide() {
      const P = plan(W, L);
      const F = field(here(), crowdCost());
      if (ch.hold && letGo) {                        // stuck holding it: set it down anywhere, or bin it
        letGo = false;
        const t = freeCounter(F, null);
        if (t) return { tile: t, act: 'A', key: `put:${ch.hold.id}` };
        const x = nearestTile(F, ['X']);
        if (x) return { tile: x, act: 'A', key: 'bin' };
      }
      if (ch.hold) return W.isPlate(ch.hold) ? holdingPlate(P, F) : holdingItem(P, F);
      if (focus) {                                   // the item this chef put on a board or in the sink
        const t = W.tiles().find((x) => x.item === focus);
        const it = focus;
        focus = null;
        if (t && (t.ch === 'B' || t.ch === 'S')) {
          if (W.needsWork(t)) { focus = it; return { tile: t, act: 'X', key: `work:${it.id}`, item: it, state0: it.state }; }
          return { tile: t, act: 'A', key: `take:${it.id}` };
        }
      }
      const jobs = jobsFor(P, F).filter((j) => !barred(j.key) && !barred(tileKey(j.tile)) && Number.isFinite(j.d));
      const theirs = new Set(W.chefs().filter((c) => c !== ch && c.ai && c.ai.claim()).map((c) => c.ai.claim()));
      const respect = Math.random() < L.claims;
      const open = jobs.filter((j) => !respect || !theirs.has(j.key)).sort((a, b) => b.score - a.score);
      if (!open.length) return null;
      const j = Math.random() < L.best ? open[0] : open[Math.floor(Math.random() * Math.min(3, open.length))];
      if (j.forOrder) forOrder = j.forOrder;
      if (j.dump) dump = j.dump;
      return { tile: j.tile, act: j.act, key: j.key, item: j.item, state0: j.item ? j.item.state : null };
    }

    function jobsFor(P, F) {
      const jobs = [];
      const add = (tile, act, key, value, extra = {}) => { const r = reach(F, tile); jobs.push({ tile, act, key, d: r.d, score: value - r.d, ...extra }); };
      // where to get a plate: a spare empty one lying around, else the dish stack
      const spare = P.plates.find((e) => e.tile && !e.it.parts.length && !P.used.has(e.it));
      const stack = nearestTile(F, ['P'], () => W.platesFree() > 0);
      const plateFrom = (op) => (op.plate && op.plate.tile ? op.plate.tile : spare ? spare.tile : stack);
      P.ops.forEach((op, i) => {
        const w = L.fifo ? (i === 0 ? 1 : 0.6) : Math.max(0.3, 1 - 0.15 * i);
        const uid = op.o.uid;
        if (op.plate && op.plate.tile && same(op.plate.it.parts, op.o.parts)) add(op.plate.tile, 'A', `serve:${op.plate.it.id}`, 60 * w);
        const heldByOther = op.plate && op.plate.chef && op.plate.chef !== ch;
        for (const t of op.pots) {
          if (!potReady(t) || heldByOther) continue;
          const src = plateFrom(op);
          if (src) add(src, 'A', `pot:${tileKey(t)}`, (30 + 36 * t.pot.t / W.BOIL_GRACE) * Math.max(w, 0.85), { forOrder: uid });
        }
        // food about to burn costs the station: whichever order it is for, it comes first
        for (const t of op.fryers) if (fryReady(t)) add(t, 'A', `fryer:${tileKey(t)}`, (28 + 36 * t.fryer.t / W.FRY_GRACE) * Math.max(w, 0.85));
        for (const e of op.items) {
          if (!e.tile) continue;                    // held: that chef's business
          if (!e.next) add(e.tile, 'A', `take:${e.it.id}`, 22 * w);
          else if (W.needsWork(e.tile)) add(e.tile, 'X', `work:${e.it.id}`, 24 * w, { item: e.it });
          else if (e.next[0] !== 'pot' || potGo(op)) add(e.tile, 'A', `take:${e.it.id}`, 18 * w);
        }
        const seen = new Map();
        if (i >= 2 && freeCounters() <= 1) return;   // little room left: finish the first orders before starting more
        for (const part of op.missing) {
          const k = (seen.get(part) || 0) + 1;
          seen.set(part, k);
          const crate = nearestTile(F, [W.crateOf(part.split(':')[0])], (t) => !t.item);
          if (crate) add(crate, 'A', `fetch:${uid}:${part}:${k}`, (14 + (L.fifo ? 0 : chainOf(W.ING, part).length)) * w);
        }
      });
      // stations to unblock: burnt food, pots no order wants, clutter on boards and sinks
      const waiting = P.ops.some((op) => op.items.some((e) => e.next && (e.next[0] === 'pot' || e.next[0] === 'fryer')));
      for (const t of W.tiles()) {
        if ((t.pot && t.pot.state === 'burnt') || (t.fryer && t.fryer.state === 'burnt')) add(t, 'X', `scrape:${tileKey(t)}`, waiting ? 26 : 12);
        if (t.pot && t.pot.state === 'done' && !P.used.has(t)) {
          const src = spare ? spare.tile : stack;
          if (src) add(src, 'A', `dump:${tileKey(t)}`, waiting ? 24 : 9, { dump: t });
        }
        if (t.item && !P.used.has(t.item) && (t.ch === 'B' || t.ch === 'S')) add(t, 'A', `tidy:${t.item.id}`, waiting ? 10 : 6);
        if (t.item && W.isPlate(t.item) && t.item.parts.length && !P.used.has(t.item)) add(t, 'A', `tidy:${t.item.id}`, 6);
      }
      return jobs;
    }

    function holdingPlate(P, F) {
      const h = ch.hold;
      if (dump && !h.parts.length) {
        const t = dump;
        if (t.pot && t.pot.state === 'done' && !P.used.has(t)) return { tile: t, act: 'A', key: `dump:${tileKey(t)}` };
        dump = null;
      }
      const op = opOf(P, h);
      if (op) {
        if (same(h.parts, op.o.parts)) { const w = nearestTile(F, ['W']); if (w) return { tile: w, act: 'A', key: `serve:${h.id}` }; }
        const pot = op.pots.find((t) => t.pot.state === 'done' && h.parts.length + t.pot.items.length <= W.PLATE_MAX);
        if (pot) return { tile: pot, act: 'A', key: `pot:${tileKey(pot)}` };
        const fr = op.fryers.find((t) => t.fryer.state === 'done');
        if (fr) return { tile: fr, act: 'A', key: `fryer:${tileKey(fr)}` };
        const e = op.items.find((x) => !x.next && x.tile && x.tile.item === x.it);
        if (e) return { tile: e.tile, act: 'A', key: `take:${e.it.id}` };
        if (!L.fifo) {                             // Hard: stays with the plate when food is about to be ready
          const soon = op.pots.find((t) => t.pot.state === 'cooking' && W.BOIL - t.pot.t < 2.5) || op.fryers.find((t) => t.fryer.state === 'cooking' && W.FRY - t.fryer.t < 2.5);
          if (soon) return { tile: soon, act: 'wait', key: `soon:${tileKey(soon)}` };
        }
        const t = freeCounter(F, nearestTile(F, ['W']));
        return t ? { tile: t, act: 'A', key: `put:${h.id}` } : { tile: nearestTile(F, ['W']), act: 'wait', key: 'hold-plate' };
      }
      if (h.parts.length) { const x = nearestTile(F, ['X']); if (x) return { tile: x, act: 'A', key: 'bin' }; }
      const needy = P.ops.find((x) => !x.plate && (x.pots.some(potReady) || x.items.some((e) => !e.next && e.tile)));
      if (needy) { sticky.set(h, needy.o.uid); return { tile: null, act: 'replan', key: 'replan' }; }
      if (P.ops.some((x) => !x.plate) && !L.fifo) { const t = freeCounter(F, nearestTile(F, ['W'])); if (t) return { tile: t, act: 'A', key: `put:${h.id}` }; }
      const stack = nearestTile(F, ['P']);
      return stack ? { tile: stack, act: 'A', key: 'return-plate' } : null;
    }

    function holdingItem(P, F) {
      const h = ch.hold;
      const a = entryOf(P, h);
      if (!a) return dispose(P, F, h);
      const { op, e } = a;
      if (!e.next) {                                 // a ready part: onto its order's plate
        if (op.plate && op.plate.tile) return { tile: op.plate.tile, act: 'A', key: `onto:${op.plate.it.id}` };
        if (op.plate && op.plate.chef && op.plate.chef !== ch) { const t = freeCounter(F, null); if (t) return { tile: t, act: 'A', key: `put:${h.id}` }; }
        const spare = P.plates.find((x) => x.tile && !x.it.parts.length && !P.used.has(x.it));
        if (spare) { sticky.set(spare.it, op.o.uid); return { tile: spare.tile, act: 'A', key: `onto:${spare.it.id}` }; }
        const stack = nearestTile(F, ['P'], () => W.platesFree() > 0);
        if (stack) { forOrder = op.o.uid; return { tile: stack, act: 'A', key: 'plate-it' }; }
        const t = freeCounter(F, null);
        return t ? { tile: t, act: 'A', key: `put:${h.id}` } : { tile: nearestTile(F, ['P']), act: 'wait', key: 'no-plates' };
      }
      const st = e.next[0];
      let t = null;
      if (st === 'board') t = nearestTile(F, ['B'], (x) => !x.item);
      else if (st === 'sink') t = nearestTile(F, ['S'], (x) => !x.item);
      else if (st === 'pot') {
        t = op.pots.find((x) => x.pot.state === 'cooking' && x.pot.items.length < W.POT_MAX && !barred(tileKey(x)));
        if (!t && potGo(op)) t = nearestTile(F, ['C'], (x) => x.pot.state === 'empty' && !x.pot.items.length);
        if (!t && !potGo(op)) {                     // its pot-mates aren't ready: set it down by a cooker
          const c = freeCounter(F, nearestTile(F, ['C']));
          if (c) return { tile: c, act: 'A', key: `put:${h.id}` };
        }
      } else if (st === 'fryer') t = nearestTile(F, ['F'], (x) => x.fryer.state === 'empty');
      if (t) {
        if (st === 'board' || st === 'sink') focus = h;
        return { tile: t, act: 'A', key: `${st}:${h.id}` };
      }
      // the station is busy: Hard sets the item down next to it and does something else,
      // Easy waits by the station with it for a while first
      const kind = { board: 'B', sink: 'S', pot: 'C', fryer: 'F' }[st];
      const near = nearestTile(F, [kind]);
      if (L.fifo && clock - lastOk < 6 && near) return { tile: near, act: 'wait', key: `busy:${st}` };
      const c = freeCounter(F, near);
      if (c) return { tile: c, act: 'A', key: `put:${h.id}` };
      return near ? { tile: near, act: 'wait', key: `busy:${st}` } : null;
    }

    // Holding something no order needs: set it aside if it could be used later, else bin it.
    function dispose(P, F, h) {
      const spareItems = P.loose.filter((e) => e.tile && !P.used.has(e.it)).length;
      if (spareItems < 3 && W.menuParts().some((part) => stageOf(W.ING, h, part) >= 0)) {
        const t = freeCounter(F, null);
        if (t) return { tile: t, act: 'A', key: `put:${h.id}` };
      }
      const x = nearestTile(F, ['X']);
      return x ? { tile: x, act: 'A', key: 'bin' } : null;
    }

    // ---------------- doing ----------------
    function start(intent) {
      I = intent;
      stuck = 0; faceT = 0; workT = 0; bestD = Infinity; stuckT = 0;
      if (!I) {                                      // nothing to do: stand somewhere out of the way
        stats.idle++;
        const home = W.home(ch);
        if (!home) { mode = 'think'; wait = 0.4; return; }
        I = { tile: null, act: 'idle', key: 'idle', at: home };
      }
      if (I.act === 'replan') { I = null; mode = 'think'; wait = 0.02; return; }
      if (!I.tile && I.act !== 'idle') { I = null; mode = 'think'; wait = 0.3; return; }
      route();
    }
    function route(extra = 0) {
      const F = field(here(), crowdCost(extra));
      let at;
      if (I.act === 'idle') at = Number.isFinite(F.dist[I.at[1] * F.C + I.at[0]]) ? I.at : null;
      else at = reach(F, I.tile).at;
      if (!at) { fail('no way there'); return; }
      path = trace(F, at);
      if (Math.random() < L.detour && path.length > 4) path = detour(F, at) || path;
      pi = Math.min(1, path.length - 1);
      bestD = Infinity; stuckT = 0;
      mode = 'move';
    }
    // Easy now and then wanders via a nearby tile instead of the shortest way.
    function detour(F, at) {
      const mid = path[Math.floor(path.length / 2)];
      const opts = [];
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if ((dc || dr) && W.walk(mid[0] + dc, mid[1] + dr)) opts.push([mid[0] + dc, mid[1] + dr]);
      if (!opts.length) return null;
      const via = opts[Math.floor(Math.random() * opts.length)];
      if (!Number.isFinite(F.dist[via[1] * F.C + via[0]])) return null;
      const G = field(via, new Map());
      if (!Number.isFinite(G.dist[at[1] * G.C + at[0]])) return null;
      return [...trace(F, via), ...trace(G, at).slice(1)];
    }

    function steer(dt) {
      const [c, r] = path[pi];
      const tx = W.tileX(c), tz = W.tileZ(r);
      const dx = tx - ch.x, dz = tz - ch.z, d = Math.hypot(dx, dz);
      const last = pi >= path.length - 1;
      if (!last && d < 0.38) { pi++; bestD = Infinity; stuckT = 0; return; }
      if (last && d < 0.14) {
        if (I.act === 'idle') { mode = 'think'; wait = rand(0.6, 1.2); return; }
        mode = 'face'; faceT = 0; return;
      }
      if (d < bestD - 0.03) { bestD = d; stuckT = 0; } else stuckT += dt;
      if (stuckT > 0.7) { unstick(); return; }
      const k = (last ? Math.max(0.35, Math.min(1, d / 0.5)) : 1) * L.speed;
      pad.sx = dx / d * k; pad.sy = dz / d * k;
      if (L.dash && !last && ch.dashCd <= 0 && straightAhead() >= 4) pad.b |= W.B.B;
    }
    function straightAhead() {
      let n = 0;
      const [c0, r0] = path[pi - 1] || here();
      const dc = path[pi][0] - c0, dr = path[pi][1] - r0;
      for (let i = pi; i < path.length && path[i][0] - (path[i - 1] || [c0, r0])[0] === dc && path[i][1] - (path[i - 1] || [c0, r0])[1] === dr; i++) n++;
      return n;
    }
    // No progress: if a chef is in the way, the lower seat (or anyone facing a human)
    // steps aside; otherwise route again around chefs; give up after a few tries.
    function unstick() {
      stuck++; stats.stuck++;
      stuckT = 0;
      if (stuck > 5) { fail('stuck'); return; }
      const ahead = others().find((o) => Math.hypot(o.x - ch.x, o.z - ch.z) < 0.9);
      if (ahead && (!ahead.ai || ahead.spawn < ch.spawn) && stuck <= 3) {
        const [c, r] = here();
        const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dc, dr]) => [c + dc, r + dr])
          .filter(([cc, rr]) => W.walk(cc, rr) && !(W.toC(ahead.x) === cc && W.toR(ahead.z) === rr))
          .sort((a, b) => Math.hypot(W.tileX(b[0]) - ahead.x, W.tileZ(b[1]) - ahead.z) - Math.hypot(W.tileX(a[0]) - ahead.x, W.tileZ(a[1]) - ahead.z));
        if (side.length) { yieldTo = side[0]; yieldT = rand(0.5, 0.9); mode = 'yield'; return; }
      }
      route(6);
    }
    function face(dt) {
      const t = I.tile;
      if (W.targetOf(ch) === t) {
        if (I.act === 'A') { snap = snapshot(t); mode = 'press'; return; }
        if (I.act === 'X') { mode = 'hold'; workT = 0; lastWork = -1; return; }
        waited += 0.55;                                     // 'wait': stand by and look again ...
        if (ch.hold && waited > (L.fifo ? 10 : 6)) { waited = 0; letGo = true; }   // ... but not forever with full hands
        mode = 'think'; wait = 0.55; return;
      }
      faceT += dt;
      if (faceT > 1.4) { fail('cannot face'); return; }
      const dx = W.tileX(t.c) - ch.x, dz = W.tileZ(t.r) - ch.z, d = Math.hypot(dx, dz) || 1;
      pad.sx = dx / d * 0.35; pad.sy = dz / d * 0.35;
    }
    const keyOf = (it) => (it ? `${it.id}:${it.type}:${it.state}:${it.parts.join(',')}` : '');
    const snapshot = (t) => [keyOf(ch.hold), keyOf(t.item), t.pot ? t.pot.items.length + t.pot.state : '', t.fryer ? (t.fryer.item ? 1 : 0) + t.fryer.state : ''].join('|');
    function verify() {
      if (snapshot(I.tile) !== snap) { succeed(); return; }
      fail('nothing happened');
    }
    function hold(dt) {
      const t = I.tile;
      const done = I.key.startsWith('scrape') ? !(t.pot && t.pot.state === 'burnt') && !(t.fryer && t.fryer.state === 'burnt')
        : t.item !== I.item || t.item.state !== I.state0;
      if (done) { succeed(); return; }
      if (W.targetOf(ch) !== t) { mode = 'face'; faceT = 0; return; }
      pad.b |= W.B.X;
      workT += dt;
      if (t.work > lastWork + 1e-4) { lastWork = t.work; workT = 0; }
      if (workT > 0.6) fail('work stalled');
    }
    function succeed() {
      stats.ok++; fails = 0; lastOk = clock; waited = 0;
      if (forOrder && ch.hold && W.isPlate(ch.hold)) { sticky.set(ch.hold, forOrder); forOrder = null; }
      if (I && I.key.startsWith('dump') && ch.hold && ch.hold.parts.length) dump = null;
      I = null; mode = 'think'; wait = rand(L.think[0], L.think[1]);
    }
    function fail(why) {
      stats.fail++; fails++;
      if (I) { bar(I.key, 4); if (I.tile) bar(tileKey(I.tile), 2.5); }
      I = null; forOrder = null; focus = null;
      mode = 'think'; wait = rand(0.15, 0.4);
      brainApi.lastFail = why;
      if (fails >= 4) recover();
    }
    // Several failures in a row, or nothing done for a long time: let go of the plan.
    function recover() {
      stats.recovered++;
      fails = 0; dump = null; focus = null;
      if (ch.hold) letGo = true;
      black.clear();
      lastOk = clock;
    }

    const brainApi = {
      stats, lastFail: '',
      get level() { return L.id; },
      setLevel(id) { L = LEVELS[id] || L; },
      intent: () => I,
      claim: () => (I && I.act !== 'idle' ? I.key : null),
      mode: () => mode,
      reset() { I = null; mode = 'think'; wait = 0.3; focus = null; forOrder = null; dump = null; path = []; },
      update(dt) {
        clock += dt;
        pad.sx = 0; pad.sy = 0; pad.b = 0;
        if (W.phase() !== 'play') { brainApi.reset(); lastOk = clock; return pad; }
        if (clock - lastOk > 14 && W.orders().length) { recover(); I = null; mode = 'think'; wait = 0.1; }
        switch (mode) {
          case 'think': wait -= dt; if (wait <= 0) start(decide()); break;
          case 'move': steer(dt); break;
          case 'face': face(dt); break;
          case 'press': pad.b |= W.B.A; mode = 'verify'; wait = 0.05; break;
          case 'verify': wait -= dt; if (wait <= 0) verify(); break;
          case 'hold': hold(dt); break;
          case 'yield': {
            yieldT -= dt;
            const dx = W.tileX(yieldTo[0]) - ch.x, dz = W.tileZ(yieldTo[1]) - ch.z, d = Math.hypot(dx, dz);
            if (d > 0.1) { pad.sx = dx / d * L.speed; pad.sy = dz / d * L.speed; }
            if (yieldT <= 0) route();
            break;
          }
        }
        return pad;
      },
    };
    return brainApi;
  }

  return { LEVELS, brain, plan, chainOf, stageOf };
})();

// Browser smoke test: characters, both racket games, the waiting room, strokes (smash, dive, early swings,
// ball flight), the three kitchens, fallbacks, every page.
//   npm run dev            (in another terminal)
//   npm run smoke          (or: node tools/smoke.mjs [baseUrl] [--shots dir] [--full])
// Needs Google Chrome (CHROME=/path/to/chrome to override). Exit code 1 if anything fails.
// --full plays whole matches to the victory animation (about 3 minutes).
import { mkdirSync } from 'node:fs';
import { launch } from './cdp.mjs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'http://127.0.0.1:8080').replace(/\/$/, '');
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const FULL = args.includes('--full');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;   // run one section, e.g. --only cooking
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const shot = (p, name) => (SHOTS ? p.shot(`${SHOTS}/${name}.png`) : null);
// The public PeerJS broker sometimes drops idle sockets; the hub reconnects by itself.
const NET = [/PeerJS/, /relay credentials/];
const ALL_CHARS = ['bunny', 'dog', 'cat', 'panda', 'chimp', 'lioness'];
const b = await launch({ port: 9400 + Math.floor(Math.random() * 400), width: 1280, height: 720 });

async function characters() {
  const p = await b.page(`${BASE}/tools/characters.html`);
  await p.waitFor('window.__viewer && __viewer.state.char', 30000);
  const ev = (js) => p.eval(js);
  const MabarCharsDefs = await ev(`(() => { const d = {}; for (const k of Object.keys(MabarChars.defs)) if (k !== 'missing') d[k] = 1; return d; })()`);
  for (const id of Object.keys(MabarCharsDefs)) {
    await ev(`__viewer.show('${id}')`);
    await p.waitFor(`__viewer.state.char && __viewer.state.char.id === '${id}'`);
    await ev(`__viewer.setTransform([0, 0, 0], 0, 1.8); true`);
    const clips = await ev(`Object.keys(__viewer.state.char.actions).sort().join(',')`);
    check(`${id}: all 16 clips`, clips === 'defeat,diveL,diveR,idle,jump,lungeL,lungeR,ready,run,serve,smash,strafeL,strafeR,swing,victory,walk', clips);
    const sk = await ev(`(() => { const r = []; __viewer.state.char.model.traverse(o => { if (o.isSkinnedMesh) r.push(o.skeleton.bones.length); }); return r; })()`);
    check(`${id}: skinned meshes bound to the skeleton`, sk.length >= 3 && sk.every((n) => n === 27), JSON.stringify(sk));
    const tools = await ev(`(() => { const c = __viewer.state.char; const v = (k) => c.props[k].every(o => o.visible); const r = [c.tool, v('racket'), v('paddle')]; c.setTool('paddle'); r.push(v('racket'), v('paddle')); c.setTool('racket'); return r; })()`);
    check(`${id}: racket by default, paddle on request`, JSON.stringify(tools) === '["racket",true,false,false,true]', JSON.stringify(tools));
    const range = (ms) => ev(`new Promise(res => { const z = []; const t0 = performance.now(); (function s() { z.push(__viewer.bonePos('footL')[2]); if (performance.now() - t0 < ${ms}) requestAnimationFrame(s); else res(Math.max(...z) - Math.min(...z)); })(); })`);
    const idle = await range(700);
    await ev(`__viewer.state.char.setSpeed(1.0); true`); await p.sleep(700);
    const walk = await range(900);
    await ev(`__viewer.state.char.setSpeed(3.5); true`); await p.sleep(700);
    const run = await range(900);
    await shot(p, `${id}-run`);
    check(`${id}: idle / walk / run by speed`, idle < 0.03 && walk > 0.08 && run > walk, `foot travel ${idle.toFixed(2)} / ${walk.toFixed(2)} / ${run.toFixed(2)} m`);
    const fade = await ev(`new Promise(res => { const c = __viewer.state.char; c.setSpeed(0); const w = []; (function s() { w.push(c.blend.idle + c.blend.ready); if (w.length < 30) requestAnimationFrame(s); else res(w); })(); })`);
    check(`${id}: run -> idle cross-fade`, fade.every((v, i) => !i || v >= fade[i - 1] - 1e-3) && fade[0] < 0.2 && fade[29] > 0.9);
    await p.sleep(400);
    const jump = await ev(`new Promise(res => { const c = __viewer.state.char; const y0 = __viewer.bonePos('hips')[1]; c.play('jump'); let top = y0; const t0 = performance.now(); (function s() { top = Math.max(top, __viewer.bonePos('hips')[1]); if (performance.now() - t0 < 1500) requestAnimationFrame(s); else res([top - y0, Math.abs(__viewer.bonePos('hips')[1] - y0), c.overlay]); })(); })`);
    check(`${id}: jump takes off and lands`, jump[0] > 0.2 && jump[1] < 0.03 && jump[2] === null, `height ${jump[0].toFixed(2)} m`);
    await ev(`__viewer.state.char.play('victory'); true`); await p.sleep(1200);
    // the fist above the chest (the T-posed animals' arms are too short to clear their big heads)
    const vic = await ev(`[__viewer.bonePos('handR')[1] > __viewer.bonePos('chest')[1] + 0.15, __viewer.state.char.playing('victory')]`);
    await shot(p, `${id}-victory`);
    await ev(`__viewer.state.char.stop(); true`); await p.sleep(500);
    check(`${id}: victory raises the racket, loops until stopped`, vic[0] && vic[1] && (await ev(`__viewer.state.char.overlay === null`)));
    const sw = await ev(`new Promise(res => { const c = __viewer.state.char; c.swing(0.4); const xs = []; const t0 = performance.now(); (function s() { xs.push(__viewer.bonePos('handR')[0]); if (performance.now() - t0 < 600) requestAnimationFrame(s); else res([Math.max(...xs) - Math.min(...xs), c.swingT]); })(); })`);
    check(`${id}: swing sweeps the racket`, sw[0] > 0.3 && sw[1] === -1, `${sw[0].toFixed(2)} m`);
    const hands = `Math.hypot(...__viewer.bonePos('handL').map((v, i) => v - __viewer.bonePos('handR')[i]))`;
    const apart = await ev(hands);
    await ev(`__viewer.state.char.setStance('ready'); true`); await p.sleep(900);
    const together = await ev(hands);
    check(`${id}: ready stance brings the free hand to the racket`, apart > 0.35 && together < apart * 0.78, `hands ${apart.toFixed(2)} -> ${together.toFixed(2)} m apart`);
    const serve = await ev(`new Promise(res => { const c = __viewer.state.char; c.setReady(1, 'serve'); setTimeout(() => { const t = [__viewer.bonePos('handL')[1] > __viewer.bonePos('chest')[1] + 0.15]; c.setReady(0); c.swing(0.7, 'serve'); const ys = []; const t0 = performance.now(); (function s() { ys.push(__viewer.bonePos('handR')[1] - __viewer.bonePos('chest')[1]); if (performance.now() - t0 < 900) requestAnimationFrame(s); else res([t[0], Math.max(...ys), c.swingT]); })(); }, 400); })`);
    check(`${id}: serve: ball arm up in the trophy pose, racket hand high`, serve[0] && serve[1] > 0.12 && serve[2] === -1, `hand ${serve[1].toFixed(2)} m above the chest`);
    // Strokes: the racket head where each one meets the ball (scale 1.8, facing +Z, its right = -X)
    await p.sleep(500);
    const reach = await ev(`(() => { const r = {}; for (const c of ['swing', 'smash', 'lungeR', 'lungeL', 'diveR', 'diveL']) r[c] = MabarChars.reachOf('${id}', c).map((v) => +(v * 1.8).toFixed(2)); return r; })()`);
    check(`${id}: strokes reach where they should (forehand right, smash overhead, lunges and dives further out)`,
      reach.swing[0] < -0.5 && reach.smash[1] > 1.5 && reach.lungeR[0] < reach.swing[0] - 0.15 && reach.lungeL[0] > 0.4 && reach.diveR[0] < reach.swing[0] - 0.15 && reach.diveL[0] > 0.6,
      JSON.stringify(reach));
    // the dive: flat on the court mid-clip, head out to the dive side, back on its feet at the end
    const dive = await ev(`new Promise((res) => { const c = __viewer.state.char; const hat0 = __viewer.bonePos('sockHat'); c.play('diveR', { fade: 0.06 }); const low = []; const t0 = performance.now();
      (function s() { const t = performance.now() - t0; if (t > 350 && t < 650) { const h = __viewer.bonePos('sockHat'), hp = __viewer.bonePos('hips'); low.push([h[1], h[0] - hp[0]]); }
        if (t < 1500) requestAnimationFrame(s); else res([hat0[1], Math.max(...low.map((v) => v[0])), Math.max(...low.map((v) => v[1])), Math.abs(__viewer.bonePos('sockHat')[1] - hat0[1]), c.overlay]); })(); })`);
    await shot(p, `${id}-dive`);
    check(`${id}: dive lies flat toward the ball and gets back up`, dive[1] < dive[0] * 0.5 && dive[2] < -0.3 && dive[3] < 0.05 && dive[4] === null,
      `head top ${dive[0].toFixed(2)} -> ${dive[1].toFixed(2)} m, ${(-dive[2]).toFixed(2)} m to its right of the hips`);
    const tip = await ev(`(() => { const c = __viewer.state.char; return c.toolHead() ? c.toolHead().toArray().map((v) => +v.toFixed(2)) : null; })()`);
    check(`${id}: toolHead() finds the racket's head`, !!tip, JSON.stringify(tip));
    // Feet keep their grip: move the character and measure how far the planted sole
    // (the lowest centimetre of the lower shoe, skinned vertices) slides.
    for (const [label, fwd, side, stance, most] of [['walk 1.0 m/s', 1.0, 0, 'idle', 0.08], ['run 3.0 m/s', 3.0, 0, 'idle', 0.08], ['side shuffle 0.8 m/s', 0, 0.8, 'ready', 0.25]]) {
      await ev(`(() => { const $ = (s) => document.querySelector(s); $('#travel').checked = false; $('#speed').value = 0; $('#side').value = 0; $('#speed').dispatchEvent(new Event('input')); $('#stance').value = 'idle'; $('#stance').dispatchEvent(new Event('change')); return true; })()`);
      await p.sleep(1200);
      const r = await ev(`new Promise((res) => {
        const $ = (s) => document.querySelector(s), c = __viewer.state.char, v = new THREE.Vector3();
        let body = null; c.model.traverse((o) => { if (o.isSkinnedMesh && /_body$/.test(o.name)) body = o; });
        const pos = body.geometry.attributes.position, ys = [];
        c.root.position.set(0, 0, 0); c.root.updateMatrixWorld(true);
        for (let i = 0; i < pos.count; i++) { body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld); ys.push([i, v.x, v.y]); }
        const low = Math.min(...ys.map((e) => e[2])), soles = { L: [], R: [] };
        for (const [i, x, y] of ys) if (y < low + 0.01) (x > 0 ? soles.L : soles.R).push(i);
        const at = (ids) => { const s = new THREE.Vector3(); for (const i of ids) { body.getVertexPosition(i, v); s.add(v.applyMatrix4(body.matrixWorld)); } return s.multiplyScalar(1 / Math.max(1, ids.length)).toArray(); };
        $('#stance').value = '${stance}'; $('#stance').dispatchEvent(new Event('change'));
        $('#speed').value = ${fwd}; $('#side').value = ${side}; $('#speed').dispatchEvent(new Event('input'));
        $('#travel').checked = true;
        const out = []; let t0 = null;
        (function step(now) {
          if (t0 == null) t0 = now;
          if (now - t0 > 1000) out.push({ L: at(soles.L), R: at(soles.R), root: c.root.position.toArray(), strafe: c.blend.strafeL + c.blend.strafeR });
          if (now - t0 < 3000) return requestAnimationFrame(step);
          $('#travel').checked = false; $('#speed').value = 0; $('#side').value = 0; $('#speed').dispatchEvent(new Event('input'));
          const floor = Math.min(...out.map((o) => Math.min(o.L[1], o.R[1])));
          let foot = 0, body2 = 0;
          for (let i = 1; i < out.length; i++) {
            const a = out[i - 1], b = out[i], k = b.L[1] < b.R[1] ? 'L' : 'R';
            const moved = Math.hypot(b.root[0] - a.root[0], b.root[2] - a.root[2]);
            if (moved > 0.5 || a[k][1] > floor + 0.01 || b[k][1] > floor + 0.01) continue;   // wrapped, or not planted
            foot += Math.hypot(b[k][0] - a[k][0], b[k][2] - a[k][2]); body2 += moved;
          }
          res([soles.L.length && soles.R.length && body2 ? foot / body2 : 1, out[out.length - 1].strafe]);
        })(performance.now());
      })`);
      const okBlend = side ? r[1] > 0.9 : r[1] < 0.1;
      check(`${id}: ${label}: planted foot holds`, r[0] < most && okBlend, `sole slides ${(r[0] * 100).toFixed(0)}% of the distance, shuffle weight ${r[1].toFixed(2)}`);
    }
    await ev(`(() => { const s = document.querySelector('#stance'); s.value = 'idle'; s.dispatchEvent(new Event('change')); return true; })()`);
    await p.sleep(600);
    const hat0 = await ev(`__viewer.bonePos('sockHat')[1]`);
    await ev(`__viewer.state.char.play('defeat'); true`); await p.sleep(1200);
    const def = await ev(`[__viewer.bonePos('sockHat')[1], __viewer.state.char.playing('defeat')]`);
    await shot(p, `${id}-defeat`);
    await ev(`__viewer.state.char.stop(); true`); await p.sleep(500);
    check(`${id}: defeat hangs the head, loops until stopped`, hat0 - def[0] > 0.015 && def[1] && (await ev(`__viewer.state.char.overlay === null`)), `head top ${(hat0 - def[0]).toFixed(3)} m lower`);
    await ev(`__viewer.setTransform([1, 0, 2], 90, 2.5); true`); await p.sleep(300);
    const tr = await ev(`(() => { const h = __viewer.bonePos('hips'); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(__viewer.state.char.root.quaternion); return [h[0], h[2], f.x]; })()`);
    check(`${id}: position / rotation / scale`, Math.abs(tr[0] - 1) < 0.1 && Math.abs(tr[1] - 2) < 0.1 && tr[2] > 0.99);
    await ev(`__viewer.setTransform([0, 0, 0], 0, 1.8); document.querySelector('#hat').click(); true`);
    const hat = await ev(`new Promise(res => { const h = __viewer.state.hat, y0 = h.getWorldPosition(new THREE.Vector3()).y; __viewer.state.char.play('jump'); setTimeout(() => res(h.getWorldPosition(new THREE.Vector3()).y - y0), 500); })`);
    check(`${id}: accessory follows the head socket`, hat > 0.15);
    await p.sleep(1200);
    await ev(`document.querySelector('#hat').click(); true`);
  }
  await ev(`__viewer.show('missing'); true`);
  await p.waitFor('!!__viewer.state.error', 10000);
  check('missing character file: reported, page keeps working', true, (await ev('__viewer.state.error')).slice(0, 60));
  const probs = p.problems([/does-not-exist/, /couldn't load missing/]);
  check('character viewer: no console errors', !probs.length, JSON.stringify(probs));
  await p.close();
}

async function match(game, { block = [], expect }) {
  const p = await b.page(`${BASE}/play.html?game=${game}`, { block });
  await p.waitFor('window.__mabar && __mabar.game && __mabar.game._debug && __mabar.game._debug().views > 0', 30000);
  await p.key('Space');                              // keyboard player joins and votes
  await p.eval('__mabar.game._fastForward(120); true');
  await p.eval(`(() => { const hub = __mabar.hub; setInterval(() => { const g = __mabar.game, d = g._debug && g._debug(), kb = hub.players.get('kb'); if (!d || !kb) return;
    if (d.phase === 'serve' && d.server === 'Keyboard') g.swing(kb, 0.6);
    if (d.phase === 'rally' && d.ball && d.ball.receiver === 'Keyboard') { const u = d.ball.u; if (u < 0.12 && u > 0 && Math.random() < 0.5) g.swing(kb, 0.5 + Math.random() * 0.5, { x: Math.random() - 0.5, y: Math.random() - 0.5 }); } }, 16); return true; })()`);
  const label = `${game}${block.length ? ' (fallback)' : ''}`;
  await p.waitFor('__mabar.game._debug().phase === "serve"', 15000);
  const looks = (await p.eval('__mabar.game._debug().looks')).join(',');
  check(`${label}: characters`, looks.replace(/:\w+/g, '') === expect, looks);
  await p.sleep(1200);
  await shot(p, `${label.replace(/\W+/g, '-')}-serve`);
  await p.waitFor('__mabar.game._debug().phase === "point"', 60000);
  const pt = await p.eval('__mabar.game._debug().looks.join(",")');
  if (!block.length) check(`${label}: point winner jumps`, /:jump/.test(pt), pt);
  if (!block.length) {
    // every return is struck where the racket head is: the gap between the two at the contact moment
    await p.sleep(12000);
    const hits = (await p.eval('__mabar.game._debug().hits')).filter((h) => h.ok && h.gap != null);
    const worst = Math.max(0, ...hits.map((h) => h.gap));
    check(`${label}: each return is struck at the racket`, hits.length >= 3 && worst < 0.45, `${hits.length} returns, racket head within ${worst.toFixed(2)} m of the ball (${[...new Set(hits.map((h) => h.clip.split('@')[0]))].join(', ')})`);
  }
  if (FULL && !block.length) {
    await p.waitFor('__mabar.game._debug().phase === "over"', 240000);
    await p.sleep(1200);
    const over = await p.eval('__mabar.game._debug().looks.join(",")');
    await shot(p, `${label}-victory`);
    check(`${label}: match winner plays victory, loser defeat`, /:victory/.test(over) && /:defeat/.test(over), over);
    await p.waitFor('__mabar.game._debug().phase === "room"', 20000);
  }
  const fps = await p.eval(`new Promise(res => { let n = 0; const t = performance.now(); (function f() { n++; if (performance.now() - t < 1500) requestAnimationFrame(f); else res(Math.round(n / 1.5)); })(); })`);
  const probs = p.problems([...NET, ...block.map((u) => u.replace(/\*/g, ''))]);
  check(`${label}: no console errors`, !probs.length, probs.length ? JSON.stringify(probs) : `${fps} fps`);
  await p.close();
}

// Waiting room: seats open / close (1-4 keys), each side keeps a player, F starts an AI
// demo with nobody joined and F leaves it again.
async function room() {
  const p = await b.page(`${BASE}/play.html?game=tennis`);
  await p.waitFor('window.__mabar && __mabar.game && __mabar.game._debug && __mabar.game._debug().views > 0', 30000);
  const L = () => p.eval('__mabar.game._lineup().join(",")');
  const start = await L();
  await p.key('Digit3');
  const opened = await L();
  await p.eval('__mabar.game._toggleSeat(0); true');
  const closed = await L();
  await p.eval('__mabar.game._toggleSeat(2); true');
  const refused = await L();
  check('waiting room: seats open and close, each side keeps a player',
    start === 'AI,AI,closed,closed' && opened === 'AI,AI,AI,closed' && closed === 'closed,AI,AI,closed' && refused === closed,
    [start, opened, closed, refused].join(' | '));
  await p.key('Digit4');                                // seat 4 joins side 2: 1 vs 2
  await p.key('KeyF');
  await p.waitFor('__mabar.game._debug().phase === "intro"', 5000);
  const d = await p.eval('__mabar.game._debug()');
  await p.waitFor('__mabar.game._debug().phase === "serve"', 10000);
  await p.key('KeyF');
  await p.waitFor('__mabar.game._debug().phase === "room"', 5000);
  check('waiting room: F starts an AI demo (1 vs 2 here) and F leaves it', d.demo && JSON.stringify(d.teams) === '[["AI:CPU 1"],["AI:CPU 2","AI:CPU 3"]]', JSON.stringify(d.teams));
  check('waiting room: no console errors', !p.problems(NET).length, JSON.stringify(p.problems(NET)));
  await p.close();
}

// Swing direction: the keyboard player returns balls with a direction and the shot
// goes that way (left / right of the player), lifts into a lob or drives it flat. The
// return leaves when the ball reaches the racket, not when the swing comes.
async function aiming() {
  const p = await b.page(`${BASE}/play.html?game=tennis`);
  await p.waitFor('window.__mabar && __mabar.game && __mabar.game._debug && __mabar.game._debug().views > 0', 30000);
  await p.key('Space');
  await p.eval('__mabar.game._fastForward(120); true');
  const r = await p.eval(`new Promise((res) => {
    const hub = __mabar.hub, want = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    const got = [], t0 = performance.now();
    let i = 0, pending = null;
    const timer = setInterval(() => {
      const g = __mabar.game, d = g._debug(), kb = hub.players.get('kb');
      if (!d || !kb) return;
      if (d.phase === 'serve' && d.server === 'Keyboard') g.swing(kb, 0.6, { x: 0, y: 0 });
      if (pending && d.phase !== 'rally') pending = null;   // missed: next ball
      if (pending && d.ball && d.ball.hitter === 0 && d.rally > pending.rally) {
        got.push({ want: pending.w, landY: +d.ball.land.y.toFixed(2), kind: d.ball.kind, held: pending.held });
        pending = null;
        i++;
      }
      if (!pending && d.phase === 'rally' && d.ball && d.ball.receiver === 'Keyboard' && d.ball.u < 0.1 && d.ball.u > 0.05) {
        const w = want[i % want.length];
        g.swing(kb, w.y < 0 ? 0.95 : 0.6, w);
        const after = g._debug().ball;   // still on its way in: struck when it gets to the racket
        pending = { w, rally: d.rally, held: !!after && after.hitter === 1 };
      }
      if (got.length >= 8 || performance.now() - t0 > 100000) { clearInterval(timer); res(got); }
    }, 10);
  })`);
  // a dive only pops the ball back and a ball above the head is smashed, whatever the swing
  const free = r.filter((g) => g.kind !== 'pop' && g.kind !== 'smash');
  const left = free.filter((g) => g.want.x === -1), right = free.filter((g) => g.want.x === 1);
  const lobs = free.filter((g) => g.want.y === 1), flats = free.filter((g) => g.want.y === -1);
  // side 0's left is +ny
  check('aiming: a leftward swing sends the ball left, a rightward one right', left.length && right.length && left.every((g) => g.landY > 0.2) && right.every((g) => g.landY < -0.2), JSON.stringify(r));
  check('aiming: an upward swing lobs, a hard downward one drives it flat', lobs.length && flats.length && lobs.every((g) => g.kind === 'lob') && flats.every((g) => g.kind === 'drive'));
  check('aiming: a swing in time is held until the ball reaches the racket', r.length && r.every((g) => g.held), JSON.stringify(r.map((g) => g.held)));
  check('aiming: no console errors', !p.problems(NET).length, JSON.stringify(p.problems(NET)));
  await p.close();
}

// Strokes on forced shots at the keyboard player (near side): a lob is smashed, a
// wide ball is dived for, an early swing whiffs instead of returning a ball that is
// still on its way, and each shot flies like one (lob high, drive low, smash down).
async function strokes() {
  const p = await b.page(`${BASE}/play.html?game=tennis`);
  await p.waitFor('window.__mabar && __mabar.game && __mabar.game._debug && __mabar.game._debug().views > 0', 30000);
  await p.key('Space');
  await p.eval('__mabar.game._fastForward(120); true');
  await p.waitFor('__mabar.game._debug().phase === "serve"', 15000);
  // place the player, play the shot at them, swing `u` s before it gets there; report what came back
  const play = async (py, shot, u, dir = { x: 0, y: 0 }, wait = 700) => {
    await p.eval(`__mabar.game._place(0, ${py}, 1); true`);
    await p.sleep(300);
    return p.eval(`new Promise((res) => {
      const g = __mabar.game, kb = __mabar.hub.players.get('kb');
      g._place(0, ${py}, 1);
      const info = g._shot(${JSON.stringify(shot)});
      let tSwing = 0, at = null;
      const it = setInterval(() => {
        const d = g._debug();
        if (!tSwing && d.ball && d.ball.receiver === 'Keyboard' && d.ball.u <= ${u}) {
          g.swing(kb, 0.7, ${JSON.stringify(dir)});
          tSwing = performance.now();
          at = { hitter: g._debug().ball.hitter, u: d.ball.u };
        }
        if (tSwing && performance.now() - tSwing > ${wait}) {
          clearInterval(it);
          const e = g._debug();
          res({ info, at, kind: e.ball && e.ball.kind, hitter: e.ball && e.ball.hitter, phase: e.phase, hit: e.hits[e.hits.length - 1], flight: g._flight(), down: e.players[0].down });
        }
      }, 4);
    })`);
  };
  const lob = await play(0, { y: 0.15, depth: 0.92, kind: 'lob', power: 0.5 }, 0.1);
  const sm = lob.flight[0];
  check('strokes: a lob is smashed overhead, down into the other court', lob.kind === 'smash' && /^smash/.test(lob.hit.clip) && lob.hit.ok && lob.hit.gap < 0.35 && sm.vh < 1,
    `${lob.kind}, ${lob.hit.clip} ${lob.hit.gap} m, struck at ${sm.h} m going ${sm.vh} m/s up`);
  const dive = await play(0.55, { y: -0.9, depth: 0.88, power: 0.9 }, 0.12, { x: 0, y: 0 }, 450);
  check('strokes: a wide ball is dived for and popped back; the diver is still down', dive.kind === 'pop' && /^dive/.test(dive.hit.clip) && dive.hit.ok && dive.hit.gap < 0.35 && dive.down,
    `${dive.kind}, ${dive.hit.clip} ${dive.hit.gap} m, down ${dive.down}`);
  await p.sleep(1500);
  const early = await play(0, { y: 0.1, depth: 0.85, power: 0.5 }, 0.5, { x: 0, y: 0 }, 250);
  check('strokes: a swing far too early whiffs; the ball keeps coming', early.at.hitter === 1 && early.hitter === 1, JSON.stringify({ at: early.at, after: early.hitter }));
  await p.sleep(2500);
  const lobbed = await play(0, { y: 0.1, depth: 0.85, power: 0.5 }, 0.08, { x: 0, y: 0.9 });
  const drive = await play(0, { y: 0.1, depth: 0.85, power: 0.5 }, 0.08, { x: 0, y: -0.6 });
  // apex of the first flight, and what the bounce kept (closed form: gravity + linear drag)
  const flightOf = (r) => {
    const [a, c] = r.flight;
    const e = Math.exp(-a.k * a.dur), gk = a.g / a.k;
    const vhIn = (a.vh + gk) * e - gk, vIn = Math.hypot(a.vx, a.vz) * e;
    const ta = a.vh > 0 ? Math.log(1 + (a.k * a.vh) / a.g) / a.k : 0, ea = Math.exp(-a.k * ta);
    const apex = a.h + (a.vh + gk) * (1 - ea) / a.k - gk * ta;
    return { apex: +apex.toFixed(2), speed: +Math.hypot(a.vx, a.vz, a.vh).toFixed(1), up: c ? +(c.vh / -vhIn).toFixed(2) : null, on: c ? +(Math.hypot(c.vx, c.vz) / vIn).toFixed(2) : null };
  };
  const fl = flightOf(lobbed), fd = flightOf(drive);
  check('strokes: a lob climbs high and slow, a flat drive stays low and fast', lobbed.kind === 'lob' && drive.kind === 'drive' && fl.apex > 5 && fd.apex < 3 && fd.speed > fl.speed * 1.2,
    `lob ${JSON.stringify(fl)}, drive ${JSON.stringify(fd)}`);
  check('strokes: bounces keep about 3/4 of the speed down and along', fd.up > 0.6 && fd.up < 0.85 && fd.on > 0.6 && fd.on < 0.9, JSON.stringify(fd));
  check('strokes: no console errors', !p.problems(NET).length, JSON.stringify(p.problems(NET)));
  await p.close();
}

// Cooking: every kitchen loads with its stations, the kitchen pick shows the three
// miniatures and takes a choice, a keyboard chef cooks one dish per recipe (crates ->
// board / sink -> pot / fryer -> plate -> hatch) through the test hooks, pots burn and
// get scraped, orders expire, the shift ends with stars, the pick's clock picks a kitchen.
async function cooking() {
  const p = await b.page(`${BASE}/play.html?game=cooking&map=paddy`);
  await p.waitFor('window.__mabar && __mabar.game && __mabar.game._debug && __mabar.game._debug().stations > 0', 40000);
  await p.key('KeyW');                                          // the keyboard chef joins
  const ev = (js) => p.eval(js);
  const dbg = () => ev('__mabar.game._debug()');
  const maps = await ev('Object.keys(MabarKitchens)');
  for (const id of maps) {
    await ev(`__mabar.game._setMap('${id}'); true`);
    await p.waitFor(`__mabar.game._debug().sceneMap === '${id}' && __mabar.game._debug().stations > 0`, 30000);
    const d = await dbg();
    check(`cooking ${id}: kitchen loads with its stations and the diorama`, d.env && d.stations > 10, `${d.stations} objects, env ${d.env}`);
  }
  // walk a recipe through the stations on each map, with the kitchen's own tile letters
  const RECIPE_STEPS = await ev(`(() => {
    const K = MabarKitchens, out = {};
    for (const [id, k] of Object.entries(K)) {
      const find = (ch) => { for (let r = 0; r < k.map.length; r++) for (let c = 0; c < k.map[r].length; c++) if (k.map[r][c] === ch) return [c, r]; return null; };
      out[id] = { recipes: k.recipes, at: Object.fromEntries([...'#BSCFPWX'].map((ch) => [ch, find(ch)])) };
    }
    return out; })()`);
  // a walkable tile next to a station, and the facing to use it
  const standBy = `(c, r) => { const k = MabarKitchens[__mabar.game._debug().map]; for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const row = k.map[r + dr]; if (row && '.='.includes(row[c + dc])) return [c + dc, r + dr, -dc, -dr]; } return null; }`;
  const use = async (ch, bit = 1) => ev(`(() => { const g = __mabar.game, d = g._debug(); const k = MabarKitchens[d.map];
    let at = null; for (let r = 0; r < k.map.length && !at; r++) for (let c = 0; c < k.map[r].length; c++) if (k.map[r][c] === '${ch}') { at = [c, r]; break; }
    const s = (${standBy})(at[0], at[1]); g._teleport('kb', s[0], s[1], s[2], s[3]); g._press('kb', ${bit}); return g._debug().chefs[0]; })()`);
  await ev(`__mabar.game._setMap('paddy'); true`);
  await p.waitFor(`__mabar.game._debug().sceneMap === 'paddy'`, 30000);
  await ev('__mabar.game._fastForward(40); true');            // the room clock runs out: the kitchen pick
  await p.waitFor('__mabar.game._debug().phase === "pick"', 5000);
  await p.waitFor('__mabar.game._debug().pick && __mabar.game._debug().pick.loaded === 3', 30000);
  await ev(`__mabar.game._setMap('beach'); true`);            // the highlight moves ...
  await p.sleep(400);
  await shot(p, 'cooking-pick');
  await ev('__mabar.game._press("kb", 2048); true');          // → : the next card
  const sel2 = (await dbg()).pick.sel;
  await ev('__mabar.game._press("kb", 1024); __mabar.game._press("kb", 1024); true');   // ← ← : back to the paddy field
  const pk = (await dbg()).pick;
  check('cooking: the kitchen pick shows the three kitchens and ← → move the highlight', pk.cards === 3 && pk.loaded === 3 && sel2 === 'city' && pk.sel === 'paddy', JSON.stringify({ sel2, pk }));
  await ev('__mabar.game._press("kb", 1); true');             // A confirms
  await p.waitFor('__mabar.game._debug().phase === "countdown"', 5000);
  check('cooking: A confirms the highlighted kitchen', (await dbg()).map === 'paddy' && (await dbg()).sceneMap === 'paddy');
  await ev('__mabar.game._fastForward(4); true');
  await p.waitFor('__mabar.game._debug().phase === "play"', 5000);
  // Tahu Goreng Sambal: tofu -> board (chop) -> fryer; chili -> board (chop); plate both; serve
  await ev(`__mabar.game._order('tahu'); true`);
  await ev(`__mabar.game._give('kb', 'tofu'); true`);
  let c = await use('B');                                      // put the tofu on the board
  for (let i = 0; i < 10; i++) await use('B', 4);              // X: chop
  c = await use('B');                                          // pick it up
  check('cooking: chopping at the board', c.hold === 'tofu:cut', JSON.stringify(c.hold));
  c = await use('F');                                          // into the fryer
  await ev('__mabar.game._tick(7); true');
  await p.sleep(150);
  let d = await dbg();
  check('cooking: the fryer fries', d.fryers[0].state === 'done', JSON.stringify(d.fryers));
  await ev(`__mabar.game._give('kb', 'plate'); true`);
  c = await use('F');                                          // fried tofu onto the plate
  check('cooking: a plate takes the fried tofu', c.hold === 'plate:tofu:fried', JSON.stringify(c.hold));
  c = await use('#');                                          // put the plate down on a counter ...
  await ev(`__mabar.game._give('kb', 'chili', 'cut'); true`);   // (chopped already, for brevity)
  c = await use('#');                                          // ... combine the chili onto it ...
  c = await use('#');                                          // ... and pick the plate up again
  check('cooking: a plate collects chopped and fried parts', c.hold === 'plate:chili:cut,tofu:fried', JSON.stringify(c.hold));
  const before = (await dbg()).served;
  c = await use('W');
  d = await dbg();
  check('cooking: serving a matching order scores', d.served === before + 1 && d.score > 0 && d.combo === 1, `served ${d.served}, score ${d.score}`);
  // the pot: rice needs rinsing first, then boils, then burns and is scraped
  await ev(`__mabar.game._give('kb', 'rice'); true`);
  c = await use('C');
  check('cooking: the pot refuses unrinsed rice', c.hold === 'rice:raw');
  c = await use('S');                                          // rice into the sink
  for (let i = 0; i < 10; i++) await use('S', 4);              // X: rinse
  c = await use('S');
  check('cooking: rinsing at the sink', c.hold === 'rice:rinsed', JSON.stringify(c.hold));
  c = await use('C');
  await ev('__mabar.game._tick(9); true'); await p.sleep(150);
  d = await dbg();
  check('cooking: the pot boils', d.pots[0].state === 'done' && d.pots[0].items === 1, JSON.stringify(d.pots));
  await ev('__mabar.game._tick(13); true'); await p.sleep(150);
  d = await dbg();
  check('cooking: food left in the pot burns', d.pots[0].state === 'burnt', JSON.stringify(d.pots));
  for (let i = 0; i < 12; i++) await use('C', 4);              // X: scrape
  d = await dbg();
  check('cooking: a burnt pot is scraped clean', d.pots[0].state === 'empty', JSON.stringify(d.pots));
  // orders expire, the shift ends with a star rating
  await ev('__mabar.game._fastForward(100); true'); await p.sleep(300);
  d = await dbg();
  check('cooking: unserved orders expire', d.failed >= 1, `${d.failed} missed`);
  await ev('__mabar.game._fastForward(300); true');
  await p.waitFor('__mabar.game._debug().phase === "over"', 5000);
  await shot(p, 'cooking-over');
  await p.waitFor('__mabar.game._debug().phase === "room"', 20000);
  check('cooking: shift over, back to the room', true);
  // the pick's clock: with the beach highlighted and nobody confirming, the shift starts there
  await ev('__mabar.game._fastForward(40); true');
  await p.waitFor('__mabar.game._debug().phase === "pick"', 5000);
  await ev(`__mabar.game._setMap('beach'); __mabar.game._fastForward(40); true`);
  await p.waitFor('__mabar.game._debug().phase === "countdown"', 5000);
  await p.waitFor(`__mabar.game._debug().sceneMap === 'beach' && __mabar.game._debug().stations > 10`, 30000);
  d = await dbg();
  check('cooking: the pick clock takes the highlighted kitchen, whose diorama is back in the scene', d.map === 'beach' && d.env && d.pick === null, JSON.stringify({ map: d.map, env: d.env, stations: d.stations }));
  const fps = await p.eval(`new Promise(res => { let n = 0; const t = performance.now(); (function f() { n++; if (performance.now() - t < 1500) requestAnimationFrame(f); else res(Math.round(n / 1.5)); })(); })`);
  const probs = p.problems(NET);
  check('cooking: no console errors', !probs.length, probs.length ? JSON.stringify(probs) : `${fps} fps`);
  await p.close();
}

async function pages() {
  let p = await b.page(`${BASE}/index.html`);
  await p.waitFor('window.__hero', 30000);
  check('landing page: 3D hero, no errors', !p.problems(NET).length, JSON.stringify(p.problems(NET)));
  await p.close();
  p = await b.page(`${BASE}/play.html`);
  await p.waitFor('window.__mabar && document.querySelector("canvas.gl-layer")', 30000);
  for (const g of ['cooking', 'pingpong', 'tennis', 'menu']) {
    await p.eval(`__mabar.setGame('${g}'); true`);
    await p.sleep(g === 'menu' ? 1500 : 3000);
  }
  const layers = await p.eval('document.querySelectorAll("canvas.gl-layer").length');
  check('host: every game starts and stops cleanly', layers === 1 && !p.problems(NET).length, `${layers} WebGL layer(s) ${JSON.stringify(p.problems(NET))}`);
  await p.close();
  for (const page of ['controller.html', 'watch.html']) {
    p = await b.page(`${BASE}/${page}`);
    await p.sleep(2500);
    check(`${page}: loads without errors`, !p.problems(NET).length, JSON.stringify(p.problems(NET)));
    await p.close();
  }
}

const run = (name, fn) => (!ONLY || ONLY === name ? fn() : Promise.resolve());
try {
  await run('characters', characters);
  await run('room', room);
  await run('tennis', () => match('tennis', { expect: 'bunny,dog' }));
  await run('pingpong', () => match('pingpong', { expect: 'bunny,dog' }));
  await run('aiming', aiming);
  await run('strokes', strokes);
  await run('fallback', () => match('tennis', { block: ['*bunny.glb', '*dog.glb', '*cat.glb', '*panda.glb', '*chimp.glb', '*lioness.glb', '*island_court.glb'], expect: 'chibi,chibi' }));
  await run('cooking', cooking);
  await run('pages', pages);
} catch (e) {
  check('smoke test ran to the end', false, e.message);
} finally {
  b.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

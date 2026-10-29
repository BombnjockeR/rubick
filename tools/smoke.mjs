// Browser smoke test: characters, both racket games, the waiting room, strokes (smash, dive, early swings,
// ball flight), the three kitchens, the AI chefs, the phone controller, fallbacks, every page.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const shot = (p, name) => (SHOTS ? p.shot(`${SHOTS}/${name}.png`) : null);
// The public PeerJS broker sometimes drops idle sockets; the hub reconnects by itself. Google Fonts
// can fail on a flaky network too (the pages fall back to system fonts).
const NET = [/PeerJS/, /relay credentials/, /fonts\.(googleapis|gstatic)\.com/];
const ALL_CHARS = ['bunny', 'dog', 'cat', 'panda', 'chimp', 'lioness'];
// No background throttling: the phone and the screen run side by side in two tabs.
const b = await launch({ port: 9400 + Math.floor(Math.random() * 400), width: 1280, height: 720,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });

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
  await p.eval('for (const i of [1, 2, 3]) __mabar.game._toggleSeat(i); true');   // no AI chefs: this section scripts every step
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
  // a crate's rim is a counter: what was set on it comes back, not a fresh ingredient
  await ev('__mabar.game._simulate(10)');                     // (the plate served above is back on the stack)
  c = await use('P');                                          // a clean plate from the stack
  c = await use('r');                                          // set it on the rice crate
  const onRim = c.hold;
  c = await use('r');                                          // empty hands at the crate: the plate comes back
  check('cooking: a plate set on a crate rim can be picked up again', onRim === null && c.hold === 'plate:', JSON.stringify({ onRim, back: c.hold }));
  // served plates come back to the stack after 9 s (PLATE_RETURN), not at once
  await ev(`__mabar.game._give('kb', 'plate', 'raw', ['chili:cut', 'tofu:fried']); __mabar.game._order('tahu'); true`);
  await use('W');
  const free0 = (await dbg()).platesFree;
  await ev('__mabar.game._simulate(5)');
  const free5 = (await dbg()).platesFree;
  await ev('__mabar.game._simulate(4.5)');
  const free9 = (await dbg()).platesFree;
  check('cooking: a served plate is back on the stack 9 s later', free0 === 4 && free5 === 4 && free9 === 5, JSON.stringify({ free0, free5, free9 }));
  const tpls = await ev(`Kit3D.load('assets/kitchen.glb').then((g) => ['i_veg_cooked', 'i_chili_cooked'].filter((n) => !g.scene.getObjectByName(n)))`);
  check('cooking: every state an ingredient reaches has a model (boiled vegetables and chili too)', !tpls.length, JSON.stringify(tpls));
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

// AI chefs: the lineups (2 and 4 seats, phones joining and leaving), Easy against Hard, and the
// awkward cases: a station taken by something no order wants, a teammate snatching the item an AI
// chef is about to take, a chef standing on the only bridge. Shifts run as logic only (_simulate).
async function aiChefs() {
  const p = await b.page(`${BASE}/play.html?game=cooking&map=paddy`);
  await p.waitFor('window.__mabar && __mabar.game && __mabar.game._debug && __mabar.game._debug().stations > 0', 40000);
  const ev = (js) => p.eval(js);
  const seats = () => ev('__mabar.game._seats()');
  const fake = (id, slot) => ev(`(() => { const p = { id: '${id}', slot: ${slot}, name: 'Phone ${slot}', color: '#ff6b6b', sx: 0, sy: 0, b: 0 }; __mabar.hub.players.set(p.id, p); __mabar.game.join(p); return true; })()`);
  const unfake = (id) => ev(`(() => { const p = __mabar.hub.players.get('${id}'); __mabar.hub.players.delete('${id}'); __mabar.game.leave(p); return true; })()`);
  // from the room into a shift on `map` (the keyboard chef confirms the pick)
  const shift = async (map) => {
    await ev(`__mabar.game._setMap('${map}'); true`);
    await ev('__mabar.game._fastForward(40); true');
    await p.waitFor('__mabar.game._debug().phase === "pick"', 5000);
    await ev(`__mabar.game._setMap('${map}'); __mabar.game._press('kb', 1); true`);
    await p.waitFor('__mabar.game._debug().phase === "countdown"', 5000);
    await ev('__mabar.game._fastForward(4); __mabar.game._simulate(0.05); true');
  };
  const finish = () => ev(`(() => { const g = __mabar.game; for (let i = 0; i < 300 && g._debug().phase !== 'room'; i++) g._simulate(1); return g._debug().phase; })()`);   // the shift's end, the results, back to the room
  const aiServed = (d) => d.log.filter((x) => x.endsWith('@ai')).length;
  const loops = (list) => list.filter((a) => a.fail > 0.25 * (a.ok + a.fail) || a.ok < 20);
  const allAI = [];

  check('AI: an empty room fills its open seats with AI chefs', (await seats()).ai === 4, JSON.stringify(await seats()));
  await p.key('KeyW');
  let s = await seats();
  check('AI: a joining phone takes over an AI chef (no extra chef)', s.humans === 1 && s.ai === 3 && s.seats.length === 4, JSON.stringify(s));

  // 2 seats: 1 human (idle keyboard chef) + 1 AI
  await ev('__mabar.game._setRoom(2); true');
  s = await seats();
  check('AI: room of 2 = the phone + 1 AI chef', s.humans === 1 && s.ai === 1 && s.seats.length === 2, JSON.stringify(s));
  await shift('paddy');
  let d = await ev('__mabar.game._simulate(240)');
  let a = await ev('__mabar.game._ai()');
  allAI.push(...a);
  check('AI: 1 human + 1 AI (Easy) on the Paddy Field: the AI chef serves dishes', aiServed(d) >= 1, `${d.served} served (${aiServed(d)} by AI), ${d.failed} missed`);
  await finish();

  // 4 seats: 1 human + 3 AI (Hard), the Beach
  await ev('__mabar.game._setRoom(4); __mabar.game._setLevel("hard"); true');
  s = await seats();
  check('AI: room of 4 = the phone + 3 AI chefs (Hard)', s.humans === 1 && s.ai === 3 && s.level === 'hard', JSON.stringify(s));
  await shift('beach');
  d = await ev('__mabar.game._simulate(240)');
  a = await ev('__mabar.game._ai()');
  allAI.push(...a);
  check('AI: 1 human + 3 AI (Hard) on the Beach: the team serves most orders', aiServed(d) >= 8 && d.served > 2 * d.failed, `${d.served} served (${aiServed(d)} by AI), ${d.failed} missed`);
  await finish();

  // 4 seats: 2 humans + 2 AI (Easy), Pontianak; a phone leaves mid-shift and comes back
  await ev('__mabar.game._setLevel("easy"); true');
  await fake('phone1', 1);
  s = await seats();
  check('AI: room of 4 with 2 phones = 2 humans + 2 AI chefs', s.humans === 2 && s.ai === 2, JSON.stringify(s));
  await shift('city');
  await ev('__mabar.game._simulate(60)');
  await ev(`__mabar.game._give('phone1', 'tofu'); true`);
  await unfake('phone1');
  s = await seats();
  let chefs = (await ev('__mabar.game._debug()')).chefs;
  const heir = chefs.find((c) => c.seat === 1);
  check('AI: a phone that leaves mid-shift is taken over by an AI chef, holding what it held', s.humans === 1 && s.ai === 3 && chefs.length === 4 && heir.ai && heir.hold === 'tofu:raw', JSON.stringify({ s, heir }));
  await fake('phone2', 1);
  s = await seats();
  chefs = (await ev('__mabar.game._debug()')).chefs;
  check('AI: rejoining takes an AI seat back, no duplicate chef', s.humans === 2 && s.ai === 2 && chefs.length === 4, JSON.stringify(s));
  d = await ev('__mabar.game._simulate(180)');
  a = await ev('__mabar.game._ai()');
  allAI.push(...a);
  check('AI: 2 humans + 2 AI (Easy) in Pontianak: the AI chefs serve dishes', aiServed(d) >= 2, `${d.served} served (${aiServed(d)} by AI), ${d.failed} missed`);
  await finish();
  await unfake('phone2');

  // a full room: 3 phones in a room of 2
  await fake('phone3', 1); await fake('phone4', 2);
  await ev('__mabar.game._setRoom(2); true');
  s = await seats();
  check('AI: never more chefs than seats (3 phones, room of 2: one watches)', s.humans === 2 && s.ai === 0 && s.seats.length === 2, JSON.stringify(s));
  await unfake('phone3'); await unfake('phone4');
  await ev('__mabar.game._setRoom(4); true');

  // Easy against Hard: the same lineup (an idle phone + 3 AI chefs), every kitchen, twice
  const total = { easy: 0, hard: 0, easyMissed: 0, hardMissed: 0 };
  for (const lvl of ['easy', 'hard']) {
    await ev(`__mabar.game._setLevel('${lvl}'); true`);
    for (const map of ['paddy', 'beach', 'city']) for (let i = 0; i < 2; i++) {
      await shift(map);
      d = await ev('__mabar.game._simulate(240)');
      allAI.push(...(await ev('__mabar.game._ai()')));
      total[lvl] += d.served;
      total[`${lvl}Missed`] += d.failed;
      await finish();
    }
  }
  check('AI: Hard serves more than Easy, Easy still cooks (3 kitchens x 2 shifts each)', total.hard > total.easy * 1.15 && total.easy >= 30, JSON.stringify(total));

  // a station taken by something no order wants: noodles in the Paddy Field's only pot
  await ev('__mabar.game._setLevel("hard"); true');
  await shift('paddy');
  const standBy = `(c, r) => { const k = MabarKitchens[__mabar.game._debug().map]; for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const row = k.map[r + dr]; if (row && '.='.includes(row[c + dc])) return [c + dc, r + dr, -dc, -dr]; } return null; }`;
  const useAt = (ch) => ev(`(() => { const g = __mabar.game, k = MabarKitchens[g._debug().map]; let at = null;
    for (let r = 0; r < k.map.length && !at; r++) for (let c = 0; c < k.map[r].length; c++) if (k.map[r][c] === '${ch}') { at = [c, r]; break; }
    const s = (${standBy})(at[0], at[1]); g._teleport('kb', s[0], s[1], s[2], s[3]); g._press('kb', 1); return g._debug().chefs.find((c) => c.id === 'kb').hold; })()`);
  await ev(`__mabar.game._give('kb', 'noodles'); true`);
  await useAt('C');
  const pot0 = (await ev('__mabar.game._debug()')).pots[0];
  await ev(`__mabar.game._order('liwet'); true`);
  d = await ev('__mabar.game._simulate(100)');
  check('AI: the only pot holds noodles no order wants: it is emptied and the rice dish still served', pot0.items === 1 && d.log.some((x) => x.startsWith('liwet')), JSON.stringify({ pot0, log: d.log }));
  allAI.push(...(await ev('__mabar.game._ai()')));
  await finish();

  // a teammate snatches the item an AI chef is about to take (three times), then bins it
  await shift('city');
  let snatched = 0;
  for (let t = 0; t < 150 && snatched < 3; t += 0.2) {
    await ev('__mabar.game._simulate(0.2)');
    const target = (await ev('__mabar.game._ai()')).find((x) => x.intent && x.intent.startsWith('take:') && x.at && x.mode === 'move');
    if (!target) continue;
    const got = await ev(`(() => { const g = __mabar.game; const s = (${standBy})(${target.at[0]}, ${target.at[1]}); if (!s) return null;
      g._teleport('kb', s[0], s[1], s[2], s[3]); g._press('kb', 1); return g._debug().chefs.find((c) => c.id === 'kb').hold; })()`);
    if (got) { snatched++; await useAt('X'); }
  }
  const before = await ev('__mabar.game._ai()');
  d = await ev('__mabar.game._simulate(90)');
  const after = await ev('__mabar.game._ai()');
  allAI.push(...after);
  const kept = after.every((x) => x.ok > (before.find((y) => y.id === x.id) || { ok: 0 }).ok + 5);
  check('AI: an item snatched from under an AI chef: it notices, re-plans and keeps cooking', snatched >= 2 && kept && aiServed(d) >= 2, JSON.stringify({ snatched, served: d.served, byAI: aiServed(d), fails: after.map((x) => x.fail) }));
  await finish();

  // a chef standing on the Beach's only bridge between the stalls for 20 s
  await shift('beach');
  await ev('__mabar.game._simulate(20)');
  const s0 = await ev('__mabar.game._ai()');
  for (let t = 0; t < 20; t += 0.25) await ev(`__mabar.game._teleport('kb', 8, 6, 0, 1); __mabar.game._simulate(0.25); true`);
  const s1 = await ev('__mabar.game._ai()');
  await ev(`__mabar.game._teleport('kb', 14, 8, 0, 1); true`);
  const served1 = (await ev('__mabar.game._debug()')).served;
  d = await ev('__mabar.game._simulate(100)');
  const s2 = await ev('__mabar.game._ai()');
  allAI.push(...s2);
  const blocked = s1.reduce((n, x) => n + x.stuck, 0) - s0.reduce((n, x) => n + x.stuck, 0);
  check('AI: a chef blocking the only bridge: AI chefs yield or re-route, then carry on', s2.every((x) => x.ok > (s1.find((y) => y.id === x.id) || { ok: 0 }).ok + 5) && d.served > served1, JSON.stringify({ stuckWhileBlocked: blocked, servedAfter: d.served - served1 }));
  await finish();

  const bad = loops(allAI);
  check('AI: no AI chef stuck in a loop (fails under a quarter of its actions, every shift)', !bad.length, bad.length ? JSON.stringify(bad.slice(0, 3)) : `${allAI.length} chef-shifts`);
  const probs = p.problems(NET);
  check('AI: no console errors', !probs.length, JSON.stringify(probs));
  await p.close();
}

// The phone controller: its layout at phone and tablet sizes (portrait and landscape), the stick and
// buttons under touch (multi-touch, outside the zone, reversing, letting go, losing focus), and a
// real phone-to-screen session over PeerJS (latency, release, stale messages, a link that drops).
async function controller() {
  const VIEWS = [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932], [568, 320], [667, 375], [740, 360], [812, 300], [844, 390], [932, 430], [768, 1024], [1024, 768]];
  const layout = `(() => { const W = innerWidth, H = innerHeight;
    const els = [...document.querySelectorAll('#pad [data-btn], #pad .js-action, #pad .icon, #stickZone')].filter((e) => e.offsetParent !== null);
    const rs = els.map((e) => { const r = e.getBoundingClientRect(); return { n: e.dataset.btn || e.id || e.className.split(' ')[0], l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
    const out = rs.filter((x) => x.l < -0.5 || x.t < -0.5 || x.r > W + 0.5 || x.b > H + 0.5).map((x) => x.n);
    const over = [];
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], c = rs[j];
      if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 1 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 1) over.push(a.n + '/' + c.n);
    }
    const small = rs.filter((x) => x.n !== 'stickZone' && Math.min(x.w, x.h) < (['A', 'B', 'X', 'Y'].includes(x.n) ? 44 : 34)).map((x) => x.n + ':' + Math.round(Math.min(x.w, x.h)));
    const z = rs.find((x) => x.n === 'stickZone');
    return { out, over, small, zone: z ? [Math.round(z.w), Math.round(z.h)] : null, scroll: document.documentElement.scrollWidth > W + 1 || document.documentElement.scrollHeight > H + 1 }; })()`;
  for (const [w, h] of VIEWS) {
    const p = await b.page(`${BASE}/controller.html`, { w, h, mobile: true });
    await p.waitFor('window.__pad', 10000);
    await p.eval(`__pad.show('pad');
      for (const el of document.querySelectorAll('.js-action')) { el.hidden = false; el.textContent = 'Choose this kitchen'; }
      for (const el of document.querySelectorAll('.js-hint')) el.textContent = 'chopped tofu: boil, fry, or plate it (A)'; true`);
    await p.sleep(150);
    const r = await p.eval(layout);
    check(`controller ${w}×${h}: every control on screen, none overlapping, big enough to touch`, !r.out.length && !r.over.length && !r.small.length && r.zone && r.zone[0] >= 110 && r.zone[1] >= 110 && !r.scroll, JSON.stringify(r));
    await shot(p, `controller-${w}x${h}`);
    await p.close();
  }

  // touch: the stick and the buttons (no room needed)
  for (const [w, h] of [[844, 390], [390, 844]]) {
    const p = await b.page(`${BASE}/controller.html`, { w, h, mobile: true });
    await p.waitFor('window.__pad', 10000);
    await p.eval('__pad.show("pad"); true');
    await p.sleep(200);
    const g = await p.eval(`(() => { const z = document.querySelector('#stickZone').getBoundingClientRect(), a = document.querySelector('.fb.a').getBoundingClientRect();
      return { zx: z.left + 10, zy: z.top + z.height / 2, zw: z.width, ax: a.left + a.width / 2, ay: a.top + a.height / 2, R: document.querySelector('#stickBase').offsetWidth / 2 * 0.62 }; })()`);
    const st = async () => { await p.sleep(40); return p.eval('__pad.state()'); };
    const A = { x: g.ax, y: g.ay, id: 9 };
    const tag = `controller touch ${w}×${h}`;
    await p.touch('touchStart', [{ x: g.zx, y: g.zy, id: 1 }]);
    const s0 = await st();
    await p.touch('touchMove', [{ x: g.zx + g.R * 0.6, y: g.zy, id: 1 }]);
    const s1 = await st();
    check(`${tag}: touching down doesn't move you; pushing does, in proportion`, s0.x === 0 && s0.y === 0 && s1.x > 0.4 && s1.x < 0.7 && Math.abs(s1.y) < 0.05, JSON.stringify({ s0: [s0.x, s0.y], s1: [s1.x, s1.y] }));
    await p.touch('touchMove', [{ x: g.zx + g.zw + 120, y: g.zy, id: 1 }]);
    const s2 = await st();
    await p.touch('touchMove', [{ x: g.zx + g.zw + 120 - 2 * g.R - 6, y: g.zy, id: 1 }]);
    const s3 = await st();
    check(`${tag}: a thumb outside the zone still steers, and turning round is one short flick`, s2.x === 1 && s3.x === -1, JSON.stringify({ outside: s2.x, reversed: s3.x }));
    const xs = [];
    for (let i = 0; i < 8; i++) {
      const dir = i % 2 ? 1 : -1;
      await p.touch('touchMove', [{ x: g.zx + g.zw + 120 - 2 * g.R - 6 + (dir > 0 ? 2 * g.R + 12 : 0), y: g.zy + (i % 3) * 4, id: 1 }]);
      xs.push(Math.sign((await st()).x) === dir);
    }
    check(`${tag}: rapid left-right changes all register`, xs.every(Boolean), JSON.stringify(xs));
    await p.touch('touchStart', [{ x: g.zx + 30, y: g.zy, id: 1 }, A]);
    await p.touch('touchMove', [{ x: g.zx + 30, y: g.zy - 80, id: 1 }, A]);
    const s4 = await st();
    await p.touch('touchEnd', [A]);
    const s5 = await st();
    check(`${tag}: stick and A at once; letting go of A keeps the stick`, s4.b === 1 && s4.y < -0.5 && s5.b === 0 && s5.y < -0.5, JSON.stringify({ both: [s4.y, s4.b], after: [s5.y, s5.b] }));
    await p.touch('touchEnd', [{ x: g.zx + 30, y: g.zy - 80, id: 1 }]);
    const s6 = await st();
    check(`${tag}: lifting the thumb stops at once`, s6.x === 0 && s6.y === 0 && s6.stick === null, JSON.stringify(s6));
    await p.touch('touchStart', [{ x: g.zx + 10, y: g.zy, id: 1 }]);
    await p.touch('touchStart', [{ x: g.zx + 10, y: g.zy, id: 1 }, { x: g.zx + 90, y: g.zy + 40, id: 2 }]);
    await p.touch('touchEnd', [{ x: g.zx + 10, y: g.zy, id: 1 }]);
    await p.touch('touchMove', [{ x: g.zx + 90, y: g.zy + 40 + g.R, id: 2 }]);
    const s7 = await st();
    check(`${tag}: a second thumb on the zone takes over when the first lifts`, s7.fingers === 1 && s7.y > 0.8, JSON.stringify(s7));
    await p.touch('touchEnd', []);
    await p.touch('touchStart', [{ x: g.zx + 10, y: g.zy, id: 3 }, A]);
    await p.touch('touchMove', [{ x: g.zx + 10 + g.R, y: g.zy, id: 3 }, A]);
    await p.eval('window.dispatchEvent(new Event("blur")); true');
    const s8 = await st();
    await p.touch('touchEnd', []);
    await p.touch('touchStart', [{ x: g.zx + 10, y: g.zy, id: 4 }]);
    await p.touch('touchMove', [{ x: g.zx + 10, y: g.zy + g.R, id: 4 }]);
    await p.touch('touchCancel', []);
    const s9 = await st();
    check(`${tag}: losing focus or a cancelled touch lets go of everything`, s8.x === 0 && s8.b === 0 && s8.held === 0 && s9.y === 0 && s9.stick === null, JSON.stringify({ blur: s8, cancel: [s9.y, s9.stick] }));
    const probs = p.problems([...NET, /navigator\.vibrate/]);
    check(`${tag}: no console errors`, !probs.length, JSON.stringify(probs));
    await p.close();
  }

  // the real thing: a phone joins the screen over PeerJS
  const host = await b.page(`${BASE}/play.html?game=cooking&map=paddy`);
  await host.waitFor('window.__mabar && __mabar.code && __mabar.game && __mabar.game._debug && __mabar.game._debug().stations > 0', 40000);
  const code = await host.eval('__mabar.code');
  const ph = await b.page(`${BASE}/controller.html?room=${code}`, { w: 844, h: 390, mobile: true, window: true });   // a window of its own: both keep running
  await ph.waitFor('window.__pad', 10000);
  await ph.eval(`document.querySelector('#nameInput').value = 'Tester'; document.querySelector('#joinForm').requestSubmit(); true`);
  let joined = true;
  try { await ph.waitFor('__pad.state().connected', 30000); await host.waitFor('__mabar.hub.players.size === 1', 10000); } catch { joined = false; }
  check('controller: a phone joins the room from its code (QR link)', joined, `room ${code}`);
  if (!joined) { await ph.close(); await host.close(); return; }
  const pid = await host.eval('[...__mabar.hub.players.keys()][0]');
  const P = `__mabar.hub.players.get('${pid}')`;
  check('controller: the phone gets a chef in Cooking, AI chefs keep the other seats', (await host.eval('__mabar.game._seats().humans')) === 1 && (await host.eval('__mabar.game._seats().ai')) === 3);
  const g = await ph.eval(`(() => { const z = document.querySelector('#stickZone').getBoundingClientRect(), a = document.querySelector('.fb.a').getBoundingClientRect();
    return { zx: z.left + z.width / 2, zy: z.top + z.height / 2, ax: a.left + a.width / 2, ay: a.top + a.height / 2, R: document.querySelector('#stickBase').offsetWidth / 2 * 0.62 }; })()`);
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); for (;;) { if (await host.eval(cond)) return Date.now() - t0; if (Date.now() - t0 > ms) return -1; await sleep(4); } };
  const chefX = () => host.eval(`__mabar.game._debug().chefs.find((c) => c.id === '${pid}').x`);
  const lat = [];
  await ph.touch('touchStart', [{ x: g.zx, y: g.zy, id: 1 }]);
  let t = Date.now();
  await ph.touch('touchMove', [{ x: g.zx + g.R * 1.2, y: g.zy, id: 1 }]);
  lat.push(await until(`${P}.sx > 0.9`) + (Date.now() - t) * 0);
  const x0 = await chefX();
  await sleep(400);
  const x1 = await chefX();
  check('controller: pushing the stick moves the chef on the screen', lat[0] >= 0 && x1 > x0 + 0.3, JSON.stringify({ ms: lat[0], moved: +(x1 - x0).toFixed(2) }));
  await ph.touch('touchEnd', []);
  lat.push(await until(`${P}.sx === 0`));
  const x2 = await chefX();
  await sleep(300);
  const x3 = await chefX();
  check('controller: letting go stops the chef at once', lat[1] >= 0 && Math.abs(x3 - x2) < 0.05, JSON.stringify({ ms: lat[1], drift: +(x3 - x2).toFixed(3) }));
  await ph.touch('touchStart', [{ x: g.zx, y: g.zy, id: 2 }]);
  const flips = [];
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 ? 1 : -1;
    await ph.touch('touchMove', [{ x: g.zx + dir * g.R * 1.2 + (dir > 0 ? 0 : 0), y: g.zy, id: 2 }]);
    flips.push(await until(`Math.sign(${P}.sx) === ${dir}`));
  }
  check('controller: rapid direction changes reach the screen in order', flips.every((ms) => ms >= 0), `${JSON.stringify(flips)} ms`);
  await ph.touch('touchStart', [{ x: g.zx + g.R * 1.2, y: g.zy, id: 2 }, { x: g.ax, y: g.ay, id: 3 }]);
  const both = await until(`(${P}.b & 1) && ${P}.sx > 0.5`);
  await ph.touch('touchEnd', []);
  await until(`${P}.sx === 0 && ${P}.b === 0`);
  check('controller: stick and A at the same time', both >= 0, `${both} ms`);
  await ph.eval(`__pad.raw({ t: 'in', x: 1, y: 0, b: 0, s: 1 }); true`);
  await sleep(150);
  check('controller: a late (out-of-order) input message is ignored', (await host.eval(`${P}.sx`)) === 0);
  // a link that stalls while A is held: the screen lets go after 1.5 s, and A is not pressed
  // a second time when the phone is heard again
  await host.eval(`(() => { const gm = __mabar.game, orig = gm.press; window.__aPresses = 0; gm.press = function (p, bits) { if (bits & 1) window.__aPresses++; return orig.call(this, p, bits); }; return true; })()`);
  await ph.touch('touchStart', [{ x: g.ax, y: g.ay, id: 4 }]);
  await until(`(${P}.b & 1)`);
  await ph.eval('__pad.mute(2200); true');
  const zeroed = await until(`${P}.b === 0`, 3000);
  const back = await until(`(${P}.b & 1)`, 3000);
  const presses = await host.eval('window.__aPresses');
  await ph.touch('touchEnd', []);
  check('controller: a stalled link releases held buttons, and no phantom press when it recovers', zeroed >= 0 && back >= 0 && presses === 1, JSON.stringify({ zeroedAfter: zeroed, heardAgain: back, aPresses: presses }));
  // the link drops while the stick is held: the phone lets go, reconnects by itself, gets its seat back
  await ph.touch('touchStart', [{ x: g.zx, y: g.zy, id: 5 }]);
  await ph.touch('touchMove', [{ x: g.zx + g.R * 1.2, y: g.zy, id: 5 }]);
  await until(`${P}.sx > 0.9`);
  const slot0 = await host.eval(`${P}.slot`);
  await ph.eval('__pad.drop(); true');
  await sleep(60);
  const during = await ph.eval('__pad.state()');
  await ph.touch('touchEnd', []);
  let reconnected = true;
  try { await ph.waitFor('__pad.state().connected', 20000); await host.waitFor('__mabar.hub.players.size === 1', 5000); } catch { reconnected = false; }
  const after = await host.eval(`(() => { const p = [...__mabar.hub.players.values()][0]; return p && { slot: p.slot, sx: p.sx, name: p.name, seats: __mabar.game._seats() }; })()`);
  check('controller: a dropped link lets go of the stick, reconnects by itself, same colour and seat, no duplicate',
    reconnected && during.x === 0 && during.reconnecting && after && after.slot === slot0 && after.sx === 0 && after.seats.humans === 1 && after.seats.ai === 3,
    JSON.stringify({ during: { x: during.x, reconnecting: during.reconnecting }, after }));
  // ... and when the screen never noticed the drop, the new link takes over the same player
  const pid2 = await host.eval('[...__mabar.hub.players.keys()][0]');
  await host.eval(`(() => { const p = __mabar.hub.players.get('${pid2}'); p.conn = { open: false, send() {}, close() {} }; return true; })()`);   // the screen misses the close
  await ph.eval('__pad.drop(); true');
  let retaken = true;
  try { await ph.waitFor('!__pad.state().connected', 5000); await ph.waitFor('__pad.state().connected', 20000); await sleep(300); } catch { retaken = false; }
  const ids = await host.eval('[...__mabar.hub.players.keys()]');
  check('controller: reconnecting while the screen still holds the old link reuses the player (no duplicate input)', retaken && ids.length === 1 && ids[0] === pid2, JSON.stringify(ids));
  // turning the phone while steering lets go (the layout moves under the thumb)
  await ph.touch('touchStart', [{ x: g.zx, y: g.zy, id: 6 }]);
  await ph.touch('touchMove', [{ x: g.zx + g.R * 1.2, y: g.zy, id: 6 }]);
  await until(`[...__mabar.hub.players.values()][0].sx > 0.9`);
  await ph.resize(390, 844);
  const turned = await until(`[...__mabar.hub.players.values()][0].sx === 0`);
  await ph.touch('touchEnd', []);
  check('controller: turning the phone mid-move lets go of the stick', turned >= 0, `${turned} ms`);
  console.log(`      input latency phone -> screen (same machine, public broker for the handshake only): ${JSON.stringify(lat)} ms`);
  const probs = [...ph.problems([...NET, /navigator\.vibrate/, /RTCDataChannel|Connection is not open/]), ...host.problems(NET)];
  check('controller: no console errors on the phone or the screen', !probs.length, JSON.stringify(probs));
  await ph.close();
  await host.close();
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
  await run('ai', aiChefs);
  await run('controller', controller);
  await run('pages', pages);
} catch (e) {
  check('smoke test ran to the end', false, e.message);
} finally {
  b.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

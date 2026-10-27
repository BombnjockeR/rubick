// Browser smoke test: characters, both racket games, the waiting room, fallbacks, every page.
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
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const shot = (p, name) => (SHOTS ? p.shot(`${SHOTS}/${name}.png`) : null);
// The public PeerJS broker sometimes drops idle sockets; the hub reconnects by itself.
const NET = [/PeerJS/, /relay credentials/];
const b = await launch({ port: 9400 + Math.floor(Math.random() * 400), width: 1280, height: 720 });

async function characters() {
  const p = await b.page(`${BASE}/tools/characters.html`);
  await p.waitFor('window.__viewer && __viewer.state.char', 30000);
  const ev = (js) => p.eval(js);
  for (const id of ['bunny', 'dog']) {
    await ev(`__viewer.show('${id}')`);
    await p.waitFor(`__viewer.state.char && __viewer.state.char.id === '${id}'`);
    await ev(`__viewer.setTransform([0, 0, 0], 0, 1.8); true`);
    const clips = await ev(`Object.keys(__viewer.state.char.actions).sort().join(',')`);
    check(`${id}: all 11 clips`, clips === 'defeat,idle,jump,ready,run,serve,strafeL,strafeR,swing,victory,walk', clips);
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
    const vic = await ev(`[__viewer.bonePos('handR')[1] > __viewer.bonePos('head')[1], __viewer.state.char.playing('victory')]`);
    await shot(p, `${id}-victory`);
    await ev(`__viewer.state.char.stop(); true`); await p.sleep(500);
    check(`${id}: victory raises the racket, loops until stopped`, vic[0] && vic[1] && (await ev(`__viewer.state.char.overlay === null`)));
    const sw = await ev(`new Promise(res => { const c = __viewer.state.char; c.swing(0.4); const xs = []; const t0 = performance.now(); (function s() { xs.push(__viewer.bonePos('handR')[0]); if (performance.now() - t0 < 600) requestAnimationFrame(s); else res([Math.max(...xs) - Math.min(...xs), c.swingT]); })(); })`);
    check(`${id}: swing sweeps the racket`, sw[0] > 0.4 && sw[1] === -1, `${sw[0].toFixed(2)} m`);
    const hands = `Math.hypot(...__viewer.bonePos('handL').map((v, i) => v - __viewer.bonePos('handR')[i]))`;
    const apart = await ev(hands);
    await ev(`__viewer.state.char.setStance('ready'); true`); await p.sleep(900);
    const together = await ev(hands);
    check(`${id}: ready stance holds the racket in both hands`, apart > 0.35 && together < 0.25, `hands ${apart.toFixed(2)} -> ${together.toFixed(2)} m apart`);
    const serve = await ev(`new Promise(res => { const c = __viewer.state.char; c.setReady(1, 'serve'); setTimeout(() => { const t = [__viewer.bonePos('handL')[1] > __viewer.bonePos('head')[1]]; c.setReady(0); c.swing(0.7, 'serve'); const ys = []; const t0 = performance.now(); (function s() { ys.push(__viewer.bonePos('handR')[1] - __viewer.bonePos('head')[1]); if (performance.now() - t0 < 900) requestAnimationFrame(s); else res([t[0], Math.max(...ys), c.swingT]); })(); }, 400); })`);
    check(`${id}: serve: ball arm up in the trophy pose, racket over the head`, serve[0] && serve[1] > 0.1 && serve[2] === -1, `hand ${serve[1].toFixed(2)} m above the head`);
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
    check(`${id}: defeat hangs the head, loops until stopped`, hat0 - def[0] > 0.03 && def[1] && (await ev(`__viewer.state.char.overlay === null`)), `head top ${(hat0 - def[0]).toFixed(2)} m lower`);
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
    if (d.phase === 'rally' && d.ball && d.ball.receiver === 'Keyboard') { const u = (1 - d.ball.t) * d.ball.T; if (u < 0.12 && u > 0 && Math.random() < 0.5) g.swing(kb, 0.5 + Math.random() * 0.5); } }, 16); return true; })()`);
  const label = `${game}${block.length ? ' (fallback)' : ''}`;
  await p.waitFor('__mabar.game._debug().phase === "serve"', 15000);
  const looks = (await p.eval('__mabar.game._debug().looks')).join(',');
  check(`${label}: characters`, looks.replace(/:\w+/g, '') === expect, looks);
  await p.sleep(1200);
  await shot(p, `${label.replace(/\W+/g, '-')}-serve`);
  await p.waitFor('__mabar.game._debug().phase === "point"', 60000);
  const pt = await p.eval('__mabar.game._debug().looks.join(",")');
  if (!block.length) check(`${label}: point winner jumps`, /:jump/.test(pt), pt);
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

try {
  await characters();
  await room();
  await match('tennis', { expect: 'bunny,dog' });
  await match('pingpong', { expect: 'bunny,dog' });
  await match('tennis', { block: ['*bunny.glb', '*dog.glb', '*island_court.glb'], expect: 'chibi,chibi' });
  await pages();
} catch (e) {
  check('smoke test ran to the end', false, e.message);
} finally {
  b.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

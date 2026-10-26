// Snake: everyone on one board, last snake standing wins the round.
// Eat white apples to grow. Crash into a wall or any snake and you're out;
// your body breaks into pellets the others can eat.
RubickGames.register({
  id: 'snake',
  name: 'Snake',
  blurb: 'Last snake standing. Press A to ready up, steer with stick or D-pad.',

  create(hub) {
    const B = hub.B;
    const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
    const OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };
    const COUNTDOWN = 3;
    const OVER_TIME = 4.5;
    const START_LEN = 4;

    let phase = 'lobby'; // lobby | countdown | playing | over
    let phaseT = 0;
    let cols = 0, rows = 0, cell = 0, ox = 0, oy = 0;
    let tickAcc = 0, tickLen = 0.115, elapsed = 0;
    let roundSize = 0;
    let result = null; // { text, color }

    const ready = new Set();
    const snakes = new Map(); // player id -> snake
    const food = new Map();   // "x,y" -> { x, y, kind: 'apple' | 'pellet' }
    const wins = new Map();
    const ghosts = [];        // fading bodies of snakes that just died
    const particles = [];

    const key = (x, y) => x + ',' + y;

    // ---------- Board layout ----------
    function layout(keepDims) {
      const { W, H, UNIT } = hub;
      const margin = Math.max(16, UNIT * 3);
      const top = 44; // room for the scoreboard strip
      const availW = W - margin * 2;
      const availH = H - margin * 2 - top;
      if (!keepDims || !cols) {
        cell = Math.max(12, Math.floor(Math.min(availW, availH) / 26));
        cols = Math.max(16, Math.floor(availW / cell));
        rows = Math.max(12, Math.floor(availH / cell));
      } else {
        cell = Math.max(4, Math.floor(Math.min(availW / cols, availH / rows)));
      }
      ox = Math.floor((W - cols * cell) / 2);
      oy = Math.floor(margin + top + (availH - rows * cell) / 2);
    }

    // ---------- Round flow ----------
    function startCountdown() {
      layout(false);
      snakes.clear();
      food.clear();
      ghosts.length = 0;
      result = null;

      const list = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
      const n = list.length;
      list.forEach((p, i) => {
        const y = Math.round(((i + 1) * rows) / (n + 1));
        const leftSide = i % 2 === 0;
        const headX = leftSide ? START_LEN + 2 : cols - START_LEN - 3;
        const dir = leftSide ? 'R' : 'L';
        const body = [];
        for (let k = 0; k < START_LEN; k++) body.push({ x: headX + (leftSide ? -k : k), y });
        snakes.set(p.id, { body, dir, queue: [], grow: 0, alive: true, lastWant: null, eaten: 0 });
      });

      roundSize = snakes.size;
      fillApples();
      phase = 'countdown';
      phaseT = COUNTDOWN;
      hub.showLobby(false);
      for (const p of hub.players.values()) hub.rumble(p, 30);
    }

    function startPlaying() {
      phase = 'playing';
      elapsed = 0;
      tickAcc = 0;
    }

    function endRound() {
      phase = 'over';
      phaseT = OVER_TIME;
      const alive = [...snakes.entries()].filter(([, s]) => s.alive);
      if (roundSize >= 2) {
        if (alive.length === 1) {
          const p = hub.players.get(alive[0][0]);
          wins.set(alive[0][0], (wins.get(alive[0][0]) || 0) + 1);
          result = { text: `${p ? p.name : 'Someone'} wins!`, color: p ? p.color : '#fff' };
          if (p) hub.rumble(p, 300);
        } else {
          result = { text: 'Draw — nobody survived', color: '#f4f4f5' };
        }
      } else {
        const [id, s] = [...snakes.entries()][0] || [];
        const p = id && hub.players.get(id);
        result = { text: `Length ${s ? s.finalLen || s.body.length : 0}`, color: p ? p.color : '#fff' };
      }
      hub.refreshRoster();
    }

    function backToLobby() {
      phase = 'lobby';
      ready.clear();
      snakes.clear();
      food.clear();
      result = null;
      layout(false);
      hub.showLobby(true);
      hub.refreshRoster();
    }

    // ---------- Board helpers ----------
    function occupied(x, y) {
      if (food.has(key(x, y))) return true;
      for (const s of snakes.values()) {
        if (!s.alive) continue;
        for (const c of s.body) if (c.x === x && c.y === y) return true;
      }
      return false;
    }

    function fillApples() {
      const aliveCount = [...snakes.values()].filter((s) => s.alive).length;
      const target = Math.max(2, aliveCount + 1);
      let apples = 0;
      for (const f of food.values()) if (f.kind === 'apple') apples++;
      let tries = 0;
      while (apples < target && tries++ < 500) {
        const x = 1 + Math.floor(Math.random() * (cols - 2));
        const y = 1 + Math.floor(Math.random() * (rows - 2));
        if (!occupied(x, y)) {
          food.set(key(x, y), { x, y, kind: 'apple', born: performance.now() });
          apples++;
        }
      }
    }

    function kill(id, s) {
      s.alive = false;
      s.finalLen = s.body.length;
      const p = hub.players.get(id);
      const color = p ? p.color : '#fff';
      ghosts.push({ body: s.body.slice(), color, t: 0 });
      s.body.forEach((c, i) => {
        if (i % 2 === 0 && c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows && !food.has(key(c.x, c.y))) {
          food.set(key(c.x, c.y), { x: c.x, y: c.y, kind: 'pellet', born: performance.now() });
        }
      });
      const h = s.body[0];
      if (h) burst(h.x, h.y, color, 26);
      s.body = [];
      if (p) hub.rumble(p, 250);
      for (const other of hub.players.values()) if (other !== p) hub.rumble(other, 25);
      hub.refreshRoster();
    }

    function burst(gx, gy, color, n) {
      const cx = ox + (gx + 0.5) * cell, cy = oy + (gy + 0.5) * cell;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = cell * (2 + Math.random() * 8);
        particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.5 + Math.random() * 0.4, color });
      }
    }

    function enqueue(s, want) {
      const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
      if (want === last || want === OPP[last]) return;
      if (s.queue.length < 2) s.queue.push(want);
    }

    // One step of the simulation. All snakes move at once, so head-on
    // crashes and "chasing your own tail" resolve fairly.
    function tick() {
      const alive = [...snakes.entries()].filter(([, s]) => s.alive);

      for (const [, s] of alive) {
        if (s.queue.length) s.dir = s.queue.shift();
        const [dx, dy] = DIRS[s.dir];
        s.next = { x: s.body[0].x + dx, y: s.body[0].y + dy };
        s.food = food.get(key(s.next.x, s.next.y)) || null;
      }

      // Cells that will still be occupied after tails move forward.
      const occ = new Set();
      for (const [, s] of alive) {
        const keep = s.body.length - (s.grow > 0 || s.food ? 0 : 1);
        for (let i = 0; i < keep; i++) occ.add(key(s.body[i].x, s.body[i].y));
      }
      const heads = new Map();
      for (const [, s] of alive) {
        const k = key(s.next.x, s.next.y);
        heads.set(k, (heads.get(k) || 0) + 1);
      }

      for (const [, s] of alive) {
        const { x, y } = s.next;
        const k = key(x, y);
        s.crash = x < 0 || y < 0 || x >= cols || y >= rows || occ.has(k) || heads.get(k) > 1;
      }

      for (const [id, s] of alive) {
        if (s.crash) { kill(id, s); continue; }
        s.body.unshift(s.next);
        if (s.food) {
          food.delete(key(s.next.x, s.next.y));
          s.grow += s.food.kind === 'apple' ? 2 : 1;
          s.eaten++;
          const p = hub.players.get(id);
          if (p) hub.rumble(p, s.food.kind === 'apple' ? 35 : 15);
          burst(s.next.x, s.next.y, '#ffffff', s.food.kind === 'apple' ? 10 : 4);
        }
        if (s.grow > 0) s.grow--;
        else s.body.pop();
      }

      fillApples();
      hub.refreshRoster();

      const stillAlive = [...snakes.values()].filter((s) => s.alive).length;
      if ((roundSize >= 2 && stillAlive <= 1) || stillAlive === 0) endRound();
    }

    // ---------- Drawing helpers ----------
    function centerX() {
      const lobby = document.querySelector('#lobby');
      return lobby.hidden ? hub.W / 2 : Math.max(hub.W / 2, 340 + (hub.W - 340) / 2);
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawSnake(ctx, body, color, dir, alpha) {
      const n = body.length;
      for (let i = n - 1; i >= 0; i--) {
        const c = body[i];
        const inset = i === 0 ? 1 : 2;
        ctx.globalAlpha = alpha * (1 - (i / Math.max(1, n)) * 0.45);
        ctx.fillStyle = color;
        roundRect(ctx, ox + c.x * cell + inset, oy + c.y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.3);
        ctx.fill();
        // Bridge to the next segment so the body reads as one piece.
        if (i < n - 1) {
          const d = body[i + 1];
          const bx = Math.min(c.x, d.x), by = Math.min(c.y, d.y);
          if (Math.abs(c.x - d.x) + Math.abs(c.y - d.y) === 1) {
            if (c.x !== d.x) ctx.fillRect(ox + bx * cell + cell / 2, oy + by * cell + 2, cell, cell - 4);
            else ctx.fillRect(ox + bx * cell + 2, oy + by * cell + cell / 2, cell - 4, cell);
          }
        }
      }
      ctx.globalAlpha = 1;
      if (!n || !dir) return;
      // Eyes on the head
      const h = body[0];
      const [dx, dy] = DIRS[dir];
      const cx = ox + (h.x + 0.5) * cell, cy = oy + (h.y + 0.5) * cell;
      const fx = dx * cell * 0.18, fy = dy * cell * 0.18;
      const sx = -dy * cell * 0.2, sy = dx * cell * 0.2;
      ctx.fillStyle = '#0e0f13';
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(cx + fx + sx * sgn, cy + fy + sy * sgn, Math.max(1.5, cell * 0.11), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawScoreboard(ctx) {
      const list = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
      if (!list.length) return;
      ctx.font = hub.font(600, 14);
      ctx.textBaseline = 'middle';
      const items = list.map((p) => {
        const s = snakes.get(p.id);
        let tag;
        if (phase === 'lobby') tag = ready.has(p.id) ? '✓ ready' : 'not ready';
        else if (!s) tag = 'next round';
        else if (!s.alive) tag = 'out';
        else tag = String(s.body.length);
        const w = wins.get(p.id) || 0;
        const text = `${p.name}  ${tag}${w ? `  ·  ${w}🏆` : ''}`;
        return { p, s, text, w: ctx.measureText(text).width + 34 };
      });
      const total = items.reduce((a, it) => a + it.w, 0) + (items.length - 1) * 8;
      let x = Math.max(ox, (hub.W - total) / 2);
      const y = oy - 24;
      for (const it of items) {
        const dead = (it.s && !it.s.alive) || (phase !== 'lobby' && !it.s);
        ctx.globalAlpha = dead ? 0.4 : 1;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, x, y - 14, it.w, 28, 14);
        ctx.fill();
        ctx.fillStyle = it.p.color;
        ctx.beginPath(); ctx.arc(x + 14, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f4f4f5';
        ctx.textAlign = 'left';
        ctx.fillText(it.text, x + 26, y + 1);
        x += it.w + 8;
      }
      ctx.globalAlpha = 1;
    }

    function overlayText(ctx, lines) {
      const cx = centerX();
      let y = hub.H / 2 - (lines.length - 1) * 22;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of lines) {
        ctx.font = hub.font(l.weight || 700, l.size);
        ctx.fillStyle = l.color || '#f4f4f5';
        ctx.globalAlpha = l.alpha == null ? 1 : l.alpha;
        ctx.fillText(l.text, cx, y);
        y += l.gap || l.size * 1.3;
      }
      ctx.globalAlpha = 1;
    }

    layout(false);

    // ---------- Game interface ----------
    return {
      stop() { hub.showLobby(true); },

      join() { /* new players start unready; mid-round joiners wait for the next round */ },

      leave(p) {
        ready.delete(p.id);
        const s = snakes.get(p.id);
        if (s) {
          if (s.alive && phase === 'playing') kill(p.id, s);
          snakes.delete(p.id);
          if (phase === 'playing') {
            const alive = [...snakes.values()].filter((x) => x.alive).length;
            if ((roundSize >= 2 && alive <= 1) || alive === 0) endRound();
          } else if (phase === 'countdown' && snakes.size === 0) {
            backToLobby();
          }
        }
      },

      press(p, bits) {
        if (phase === 'lobby' && bits & (B.A | B.MENU)) {
          if (ready.has(p.id)) ready.delete(p.id); else ready.add(p.id);
          hub.rumble(p, ready.has(p.id) ? 40 : 15);
          hub.refreshRoster();
        }
      },

      resize() { layout(phase !== 'lobby'); },

      meta(p) {
        const w = wins.get(p.id) || 0;
        const s = snakes.get(p.id);
        const parts = [];
        if (phase === 'lobby') parts.push(ready.has(p.id) ? 'ready' : 'not ready');
        else if (s) parts.push(s.alive ? `len ${s.body.length}` : 'out');
        if (w) parts.push(`${w} win${w > 1 ? 's' : ''}`);
        return parts.join(' · ');
      },

      hint(p) {
        const s = snakes.get(p.id);
        switch (phase) {
          case 'lobby': return ready.has(p.id) ? 'Ready! Waiting for the others' : 'Press A when you’re ready';
          case 'countdown': return s ? 'Get set — steer with stick or D-pad' : 'You’re in the next round';
          case 'playing':
            if (!s) return 'Round in progress — you’re in the next one';
            return s.alive ? 'Steer with stick or D-pad' : 'You’re out — watch the rest';
          case 'over': return result ? result.text : '';
        }
        return '';
      },

      update(dt) {
        // Steering: turn stick/d-pad direction changes into queued turns.
        for (const [id, s] of snakes) {
          if (!s.alive) continue;
          const p = hub.players.get(id);
          if (!p) continue;
          const d = hub.dir(p);
          let want = null;
          if (Math.abs(d.x) > 0.5 || Math.abs(d.y) > 0.5) {
            want = Math.abs(d.x) > Math.abs(d.y) ? (d.x > 0 ? 'R' : 'L') : (d.y > 0 ? 'D' : 'U');
          }
          if (want && want !== s.lastWant) enqueue(s, want);
          s.lastWant = want;
        }

        if (phase === 'lobby') {
          const n = hub.players.size;
          if (n > 0 && [...hub.players.keys()].every((id) => ready.has(id))) startCountdown();
        } else if (phase === 'countdown') {
          phaseT -= dt;
          if (phaseT <= 0) startPlaying();
        } else if (phase === 'playing') {
          elapsed += dt;
          tickLen = Math.max(0.06, 0.115 - elapsed * 0.0012); // speeds up over ~45s
          tickAcc += dt;
          let guard = 0;
          while (tickAcc >= tickLen && phase === 'playing' && guard++ < 4) {
            tickAcc -= tickLen;
            tick();
          }
        } else if (phase === 'over') {
          phaseT -= dt;
          if (phaseT <= 0) backToLobby();
        }

        for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].t += dt; if (ghosts[i].t > 0.7) ghosts.splice(i, 1); }
        for (let i = particles.length - 1; i >= 0; i--) {
          const q = particles[i];
          q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9;
          if (q.t > q.life) particles.splice(i, 1);
        }
      },

      draw(ctx, time) {
        const { W, H } = hub;
        ctx.fillStyle = '#0e0f13';
        ctx.fillRect(0, 0, W, H);

        // Board
        ctx.fillStyle = '#15161c';
        ctx.fillRect(ox, oy, cols * cell, rows * cell);
        ctx.fillStyle = 'rgba(255,255,255,0.018)';
        for (let y = 0; y < rows; y++) {
          for (let x = (y % 2); x < cols; x += 2) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - 1, oy - 1, cols * cell + 2, rows * cell + 2);

        // Food
        for (const f of food.values()) {
          const cx = ox + (f.x + 0.5) * cell, cy = oy + (f.y + 0.5) * cell;
          const age = Math.min(1, (performance.now() - f.born) / 250);
          if (f.kind === 'apple') {
            const r = cell * 0.32 * age * (1 + Math.sin(time / 260 + f.x) * 0.08);
            ctx.save();
            ctx.shadowColor = 'rgba(255,255,255,0.8)';
            ctx.shadowBlur = cell * 0.7;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.beginPath(); ctx.arc(cx, cy, cell * 0.16 * age, 0, Math.PI * 2); ctx.fill();
          }
        }

        // Dead snakes fading out
        for (const g of ghosts) drawSnake(ctx, g.body, g.color, null, Math.max(0, 0.6 * (1 - g.t / 0.7)));

        // Live snakes
        for (const [id, s] of snakes) {
          if (!s.alive) continue;
          const p = hub.players.get(id);
          if (!p) continue;
          drawSnake(ctx, s.body, p.color, s.queue.length && phase === 'countdown' ? s.queue[s.queue.length - 1] : s.dir, 1);
          if (phase === 'countdown') {
            const h = s.body[0];
            ctx.font = hub.font(700, Math.max(12, cell * 0.6));
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = p.color;
            ctx.fillText(p.name, ox + (h.x + 0.5) * cell, oy + h.y * cell - 4);
          }
        }

        for (const q of particles) {
          ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
          ctx.fillStyle = q.color;
          ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
        }
        ctx.globalAlpha = 1;

        drawScoreboard(ctx);

        // Overlays
        if (phase === 'lobby') {
          ctx.fillStyle = 'rgba(14,15,19,0.55)';
          ctx.fillRect(ox, oy, cols * cell, rows * cell);
          const n = hub.players.size;
          const readyN = [...hub.players.keys()].filter((id) => ready.has(id)).length;
          overlayText(ctx, [
            { text: 'SNAKE', size: Math.max(40, hub.UNIT * 9), weight: 800, color: '#7cfc4a' },
            n
              ? { text: 'Press A on your phone when you’re ready', size: 20, weight: 500, alpha: 0.85 }
              : { text: 'Scan the QR code to join', size: 20, weight: 500, alpha: 0.85 },
            n ? { text: `${readyN} / ${n} ready`, size: 16, weight: 500, alpha: 0.55 } : { text: '', size: 16 },
          ]);
        } else if (phase === 'countdown') {
          const num = Math.ceil(phaseT);
          const frac = phaseT - Math.floor(phaseT);
          overlayText(ctx, [{ text: String(num), size: Math.max(60, hub.UNIT * 16) * (0.85 + frac * 0.3), weight: 800, alpha: 0.35 + frac * 0.6 }]);
        } else if (phase === 'over' && result) {
          ctx.fillStyle = 'rgba(14,15,19,0.5)';
          ctx.fillRect(ox, oy, cols * cell, rows * cell);
          overlayText(ctx, [
            { text: result.text, size: Math.max(34, hub.UNIT * 7), weight: 800, color: result.color },
            { text: `Next round in ${Math.ceil(phaseT)}…`, size: 18, weight: 500, alpha: 0.6 },
          ]);
        }
      },

      // For tests / console poking
      _debug: () => ({ phase, cols, rows, snakes, food, ready }),
    };
  },
});

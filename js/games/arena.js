// Arena: free movement sandbox. Collect coins, dash (A), honk (B).
RubickGames.register({
  id: 'arena',
  name: 'Arena',
  blurb: 'Free roam. Grab coins, A to dash into friends, B to honk.',

  create(hub) {
    const B = hub.B;
    const st = new Map(); // player id -> body
    const coins = [];
    const rings = [];
    const particles = [];

    const radius = () => Math.max(14, hub.UNIT * 2.8);
    const speed = () => hub.UNIT * 55;

    function burst(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = hub.UNIT * (10 + Math.random() * 40);
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, t: 0, color });
      }
    }

    function spawnCoin() {
      const m = radius() * 3;
      coins.push({
        x: m + Math.random() * Math.max(1, hub.W - m * 2),
        y: m + Math.random() * Math.max(1, hub.H - m * 2),
        phase: Math.random() * Math.PI * 2,
      });
    }

    function clampToArena(s) {
      const r = radius();
      if (s.x < r) { s.x = r; s.vx = Math.abs(s.vx) * 0.4; }
      if (s.x > hub.W - r) { s.x = hub.W - r; s.vx = -Math.abs(s.vx) * 0.4; }
      if (s.y < r) { s.y = r; s.vy = Math.abs(s.vy) * 0.4; }
      if (s.y > hub.H - r) { s.y = hub.H - r; s.vy = -Math.abs(s.vy) * 0.4; }
    }

    function easeOutBack(t) {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    return {
      join(p) {
        const s = {
          x: hub.W * (0.3 + 0.4 * Math.random()),
          y: hub.H * (0.3 + 0.4 * Math.random()),
          vx: 0, vy: 0, fx: 1, fy: 0,
          dashT: 0, dashCd: 0, score: 0, trail: [], born: performance.now(),
        };
        st.set(p.id, s);
        burst(s.x, s.y, p.color, 24);
      },

      leave(p) {
        const s = st.get(p.id);
        if (s) burst(s.x, s.y, p.color, 18);
        st.delete(p.id);
      },

      press(p, bits) {
        const s = st.get(p.id);
        if (!s) return;
        if (bits & B.A && s.dashCd <= 0) {
          s.dashT = 0.16;
          s.dashCd = 0.55;
          hub.rumble(p, 18);
        }
        if (bits & B.B) rings.push({ x: s.x, y: s.y, t: 0, color: p.color });
      },

      resize() { for (const s of st.values()) clampToArena(s); },

      meta(p) { const s = st.get(p.id); return s ? `${s.score} ★` : ''; },

      hint() { return 'Move · A dash · B honk'; },

      update(dt) {
        const r = radius(), sp = speed();
        while (coins.length < 3) spawnCoin();

        for (const p of hub.players.values()) {
          const s = st.get(p.id);
          if (!s) continue;
          const d = hub.dir(p);
          if (Math.hypot(d.x, d.y) > 0.1) { const m = Math.hypot(d.x, d.y); s.fx = d.x / m; s.fy = d.y / m; }

          const k = Math.min(1, dt * 14);
          s.vx += (d.x * sp - s.vx) * k;
          s.vy += (d.y * sp - s.vy) * k;

          let vx = s.vx, vy = s.vy;
          if (s.dashT > 0) {
            s.dashT -= dt;
            vx += s.fx * sp * 2.6;
            vy += s.fy * sp * 2.6;
            s.trail.push({ x: s.x, y: s.y, t: 0 });
          }
          s.dashCd = Math.max(0, s.dashCd - dt);
          s.x += vx * dt;
          s.y += vy * dt;
          clampToArena(s);

          for (const tr of s.trail) tr.t += dt;
          while (s.trail.length && s.trail[0].t > 0.25) s.trail.shift();

          for (let i = coins.length - 1; i >= 0; i--) {
            const c = coins[i];
            if (Math.hypot(c.x - s.x, c.y - s.y) < r + hub.UNIT * 1.6) {
              coins.splice(i, 1);
              s.score += 1;
              burst(c.x, c.y, '#ffd43b', 14);
              hub.rumble(p, 40);
              hub.refreshRoster();
            }
          }
        }

        // Bodies push each other apart; a dash knocks the other one back.
        const list = [...hub.players.values()].filter((p) => st.has(p.id));
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const a = st.get(list[i].id), b = st.get(list[j].id);
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 0.001;
            const overlap = r * 2 - d;
            if (overlap > 0) {
              const nx = dx / d, ny = dy / d;
              a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
              b.x += nx * overlap / 2; b.y += ny * overlap / 2;
              if (a.dashT > 0 || b.dashT > 0) {
                const kick = sp * 1.2;
                a.vx -= nx * kick; a.vy -= ny * kick;
                b.vx += nx * kick; b.vy += ny * kick;
                hub.rumble(list[i], 60);
                hub.rumble(list[j], 60);
              }
            }
          }
        }

        for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.6) rings.splice(i, 1); }
        for (let i = particles.length - 1; i >= 0; i--) {
          const q = particles[i];
          q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy *= 0.92;
          if (q.t > q.life) particles.splice(i, 1);
        }
      },

      draw(ctx, time) {
        const { W, H, UNIT } = hub;
        ctx.fillStyle = '#0e0f13';
        ctx.fillRect(0, 0, W, H);

        const g = Math.max(32, UNIT * 6);
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = (W % g) / 2; x < W; x += g) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
        for (let y = (H % g) / 2; y < H; y += g) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
        ctx.stroke();

        for (const c of coins) {
          const cr = UNIT * 1.3 * (1 + Math.sin(time / 300 + c.phase) * 0.12);
          ctx.save();
          ctx.shadowColor = 'rgba(255, 212, 59, 0.7)';
          ctx.shadowBlur = 16;
          ctx.fillStyle = '#ffd43b';
          ctx.beginPath(); ctx.arc(c.x, c.y, cr, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath(); ctx.arc(c.x, c.y, cr * 0.45, 0, Math.PI * 2); ctx.fill();
        }

        for (const k of rings) {
          const pr = k.t / 0.6;
          ctx.strokeStyle = k.color;
          ctx.globalAlpha = 1 - pr;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(k.x, k.y, radius() + pr * UNIT * 14, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }

        const r = radius();
        for (const p of hub.players.values()) {
          const s = st.get(p.id);
          if (!s) continue;
          for (const tr of s.trail) {
            ctx.globalAlpha = Math.max(0, 0.35 * (1 - tr.t / 0.25));
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(tr.x, tr.y, Math.max(0, r * (1 - tr.t * 2)), 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;

          const age = (performance.now() - s.born) / 1000;
          const pop = age < 0.35 ? 0.4 + 0.6 * easeOutBack(age / 0.35) : 1;

          ctx.save();
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 22;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(s.x, s.y, r * pop, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          ctx.fillStyle = '#0e0f13';
          ctx.beginPath(); ctx.arc(s.x + s.fx * r * 0.45, s.y + s.fy * r * 0.45, r * 0.24 * pop, 0, Math.PI * 2); ctx.fill();

          ctx.font = hub.font(600, Math.max(12, UNIT * 1.6));
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(244,244,245,0.92)';
          ctx.fillText(p.name, s.x, s.y - r - 6);
          if (s.score) {
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#ffd43b';
            ctx.fillText(String(s.score), s.x, s.y + r + 6);
          }
        }

        for (const q of particles) {
          ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
          ctx.fillStyle = q.color;
          ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
        }
        ctx.globalAlpha = 1;

        if (!hub.players.size) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(244,244,245,0.18)';
          ctx.font = hub.font(700, Math.max(18, UNIT * 4));
          const lobbyOpen = !document.querySelector('#lobby').hidden;
          ctx.fillText('Waiting for controllers', lobbyOpen ? Math.max(W / 2, 340 + (W - 340) / 2) : W / 2, H / 2);
        }
      },
    };
  },
});

// Table Tennis: swing your phone like a paddle.
// Your paddle follows the ball automatically (like Wii Sports). You only
// time the swing:
//   - when you swing sets the direction: early pulls it to your left, late
//     pushes it to your right. Way too early or late and it lands out.
//   - how hard you swing sets the speed.
// Two players face each other; a solo player gets a CPU opponent.
RubickGames.register({
  id: 'pingpong',
  name: 'Table Tennis',
  blurb: 'Swing your phone like a paddle. Timing aims, strength sets speed. First to 5.',
  controls: 'motion',

  create(hub) {
    const B = hub.B;
    const WIN = 5;
    // Receive window, in seconds until the ball reaches your paddle line.
    const EARLY_LIMIT = 0.40;  // swing earlier than this = whiff
    const LATE_LIMIT = -0.16;  // ball is past you after this = missed
    const IDEAL = 0.08;        // perfect timing (slightly early covers network lag)
    const SPAN = 0.24;         // timing distance that maps to full left/right aim
    const BOUNCE = 0.75;       // fraction of the flight where the ball hits the table

    let phase = 'waiting';     // waiting | serve | rally | point | over
    let phaseT = 0;
    let server = 0, firstServer = 0;
    let rally = 0;
    let banner = null;         // { text, color }
    let result = null;
    const sides = [newSide(), newSide()];
    let ball = null;
    let cpuPlan = null;
    const popups = [];
    const ripples = [];
    const trail = [];

    function newSide() { return { id: null, score: 0, py: 0, swingT: 0 }; }
    const isCpu = (s) => sides[s].id === 'cpu';
    const playerOf = (s) => (isCpu(s) ? null : hub.players.get(sides[s].id));
    const nameOf = (s) => (isCpu(s) ? 'CPU' : (playerOf(s) || {}).name || '—');
    const colorOf = (s) => (isCpu(s) ? '#adb5bd' : (playerOf(s) || {}).color || '#fff');
    const sideOf = (p) => (sides[0].id === p.id ? 0 : sides[1].id === p.id ? 1 : -1);
    const lineX = (s) => (s === 0 ? -1 : 1);
    const leftSign = (s) => (s === 0 ? -1 : 1); // the hitter's left, on screen

    // ---------- Geometry (normalized coords: x -1..1 between paddle lines, y -1..1 table edges) ----------
    function geo() {
      const { W, H } = hub;
      const tw = Math.min(W * 0.68, H * 0.6 * 1.8);
      const th = tw / 1.8;
      const gap = tw * 0.075;
      const cx = W / 2, cy = H / 2 + H * 0.05;
      return {
        tw, th, gap, cx, cy,
        X: (nx) => cx + nx * (tw / 2 + gap),
        Y: (ny) => cy + ny * (th / 2),
        pr: th * 0.085,
        br: Math.max(4, th * 0.022),
      };
    }

    // ---------- Match flow ----------
    function assign() {
      const humans = [...hub.players.values()].sort((a, b) => a.slot - b.slot);
      sides[0] = newSide();
      sides[1] = newSide();
      sides[0].id = humans[0] ? humans[0].id : null;
      sides[1].id = humans[1] ? humans[1].id : 'cpu';
    }

    function newMatch(text) {
      ball = null;
      cpuPlan = null;
      trail.length = 0;
      result = null;
      if (!hub.players.size) {
        phase = 'waiting';
        sides[0] = newSide();
        sides[1] = newSide();
        hub.showLobby(true);
        return;
      }
      assign();
      firstServer = 0;
      server = 0;
      rally = 0;
      banner = text ? { text, color: '#f4f4f5' } : null;
      startServe();
      hub.showLobby(false);
      hub.refreshRoster();
    }

    function startServe() {
      const total = sides[0].score + sides[1].score;
      server = (Math.floor(total / 2) + firstServer) % 2; // serve swaps every 2 points
      phase = 'serve';
      phaseT = 0;
      ball = null;
      cpuPlan = null;
      rally = 0;
      trail.length = 0;
    }

    function point(winner, reason) {
      sides[winner].score++;
      phase = 'point';
      phaseT = 1.4;
      popup(reason, 0, -0.15, '#f4f4f5', 1.4, 1.6);
      const w = playerOf(winner), l = playerOf(1 - winner);
      if (w) hub.rumble(w, 60);
      if (l) hub.rumble(l, 160);
      hub.refreshRoster();
    }

    function popup(text, nx, ny, color, life = 0.9, scale = 1) {
      popups.push({ text, nx, ny, color, t: 0, life, scale });
    }

    // ---------- Shots ----------
    function launch(hitter, fromY, aimY, T, power) {
      const toX = lineX(1 - hitter);
      const fromX = lineX(hitter);
      // Choose the end point so the bounce lands at aimY.
      const toY = fromY + (aimY - fromY) / BOUNCE;
      ball = { fromX, fromY, toX, toY, t: 0, T, hitter, out: Math.abs(aimY) > 1, bounced: false, power };
      cpuPlan = null;
      const receiver = 1 - hitter;
      if (isCpu(receiver) && !ball.out) {
        const miss = 0.06 + Math.max(0, 0.75 - T) * 0.7 + rally * 0.012;
        cpuPlan = {
          u: IDEAL + (Math.random() - 0.5) * 0.3,
          miss: Math.random() < miss,
          power: 0.35 + Math.random() * 0.4,
          done: false,
        };
      }
    }

    function serve(power) {
      const s = server;
      const offset = (Math.random() - 0.5) * 0.8;
      const aimY = Math.max(-0.85, Math.min(0.85, leftSign(s) * offset * 0.8));
      const T = 1.5 - power * 0.6;
      launch(s, sides[s].py, aimY, T, power);
      phase = 'rally';
      sides[s].swingT = 0.25;
      const p = playerOf(s);
      if (p) hub.rumble(p, 25);
    }

    function returnShot(s, power, u) {
      const offset = Math.max(-1, Math.min(1, (u - IDEAL) / SPAN)); // + early, − late
      const aimY = leftSign(s) * offset * 1.15 + (Math.random() - 0.5) * 0.15;
      const speedUp = Math.max(0.72, 1 - rally * 0.025);
      const T = (1.35 - power * 0.73) * speedUp;
      const fromY = ballPos().y;
      rally++;
      launch(s, fromY, aimY, T, power);
      sides[s].swingT = 0.25;
      const p = playerOf(s);
      if (p) hub.rumble(p, power > 0.85 ? 70 : 35);
      if (power > 0.85) popup('SMASH!', lineX(s) * 0.8, -0.6, colorOf(s));
      else if (Math.abs(offset) < 0.25) popup('Perfect', lineX(s) * 0.8, -0.6, colorOf(s), 0.7);
    }

    function swing(s, power) {
      if (s < 0) return;
      if (phase === 'serve') {
        if (s === server && phaseT > 0.35) serve(power);
        return;
      }
      if (phase !== 'rally' || !ball || ball.hitter === s) {
        sides[s].swingT = 0.2;
        return;
      }
      if (ball.out) { sides[s].swingT = 0.2; return; } // let it go, it's out
      const u = (1 - ball.t) * ball.T;
      sides[s].swingT = 0.2;
      if (u > EARLY_LIMIT) {
        popup('Too early', lineX(s) * 0.82, sides[s].py - 0.35, '#adb5bd', 0.6, 0.8);
        return;
      }
      if (u < LATE_LIMIT) return; // already past
      returnShot(s, power, u);
    }

    function ballPos() {
      if (!ball) return { x: 0, y: 0, z: 0 };
      const t = ball.t;
      const x = ball.fromX + (ball.toX - ball.fromX) * t;
      const y = ball.fromY + (ball.toY - ball.fromY) * t;
      let z;
      if (t < BOUNCE) { const s = t / BOUNCE; z = 0.3 * (1 - s) + 1.1 * s * (1 - s); }
      else { const s = (t - BOUNCE) / (1 - BOUNCE); z = Math.max(0, 0.3 * s + 0.8 * s * (1 - s)); }
      return { x, y, z };
    }

    // ---------- Drawing helpers ----------
    function drawPaddle(ctx, g, s) {
      const dir = s === 0 ? 1 : -1; // facing the table
      const sw = sides[s].swingT > 0 ? Math.sin((1 - sides[s].swingT / 0.25) * Math.PI) : 0;
      const x = g.X(lineX(s)) + dir * g.pr * 0.5 * sw;
      const y = g.Y(sides[s].py);
      const color = colorOf(s);
      // handle points away from the table
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-dir * sw * 0.5);
      ctx.fillStyle = '#8a5f3b';
      ctx.fillRect(-dir * g.pr * 0.6 - (dir > 0 ? g.pr * 0.85 : 0), -g.pr * 0.18, g.pr * 0.85, g.pr * 0.36);
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, g.pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function centerText(ctx, lines, cy) {
      let y = cy;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of lines) {
        ctx.font = hub.font(l.weight || 700, l.size);
        ctx.fillStyle = l.color || '#f4f4f5';
        ctx.globalAlpha = l.alpha == null ? 1 : l.alpha;
        ctx.fillText(l.text, hub.W / 2, y);
        y += l.size * 1.35;
      }
      ctx.globalAlpha = 1;
    }

    // ---------- Game interface ----------
    return {
      start() { newMatch(); },
      stop() { hub.showLobby(true); },

      join(p) {
        if (phase === 'waiting') newMatch();
        else if (isCpu(1) && sideOf(p) < 0 && phase !== 'over') newMatch(`New challenger: ${p.name}!`);
      },

      leave(p) {
        if (sides[0].id === p.id || sides[1].id === p.id) newMatch(hub.players.size ? 'Player left — new match' : null);
      },

      swing(p, power) { swing(sideOf(p), power); },
      press(p, bits) { if (bits & B.A) swing(sideOf(p), 0.6); }, // gamepad / keyboard fallback

      meta(p) {
        const s = sideOf(p);
        return s < 0 ? 'next up' : `${sides[s].score} pts`;
      },

      hint(p) {
        const s = sideOf(p);
        if (phase === 'over') return result ? result.text : '';
        if (s < 0) return 'You’re next — watch the match';
        switch (phase) {
          case 'serve': return s === server ? 'Your serve — swing!' : 'Get ready…';
          case 'rally':
            if (!ball) return '';
            return ball.hitter === s ? 'Nice — get ready' : 'Swing when the ball reaches you!';
          case 'point': return `${sides[s].score} – ${sides[1 - s].score}`;
        }
        return '';
      },

      update(dt) {
        for (const sd of sides) sd.swingT = Math.max(0, sd.swingT - dt);
        for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > popups[i].life) popups.splice(i, 1); }
        for (let i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > 0.45) ripples.splice(i, 1); }
        if (banner) { banner.t = (banner.t || 0) + dt; if (banner.t > 2.2) banner = null; }

        if (phase === 'serve') {
          phaseT += dt;
          if (isCpu(server) && phaseT > 1.2) serve(0.45 + Math.random() * 0.2);
          else if (!isCpu(server) && phaseT > 8) serve(0.35); // auto-serve so nobody stalls
        } else if (phase === 'rally' && ball) {
          ball.t += dt / ball.T;
          const receiver = 1 - ball.hitter;
          const u = (1 - ball.t) * ball.T;
          const pos = ballPos();
          trail.push({ x: pos.x, y: pos.y, z: pos.z });
          if (trail.length > 8) trail.shift();

          if (!ball.bounced && ball.t >= BOUNCE) {
            ball.bounced = true;
            ripples.push({ x: pos.x, y: pos.y, t: 0, out: ball.out });
            if (ball.out) { point(receiver, 'Out!'); return; }
          }
          if (cpuPlan && !cpuPlan.done && u <= cpuPlan.u) {
            cpuPlan.done = true;
            if (!cpuPlan.miss) returnShot(receiver, cpuPlan.power, u);
            else sides[receiver].swingT = 0.2;
          }
          if (ball && ball.hitter !== receiver && u < LATE_LIMIT) point(ball.hitter, `${nameOf(receiver)} missed!`);
        } else if (phase === 'point') {
          // Let the ball fly on for a moment, then reset.
          if (ball) ball.t += dt / ball.T;
          phaseT -= dt;
          if (phaseT <= 0) {
            const winner = sides[0].score >= WIN ? 0 : sides[1].score >= WIN ? 1 : -1;
            if (winner >= 0) {
              phase = 'over';
              phaseT = 5;
              result = { text: `${nameOf(winner)} wins ${sides[winner].score}–${sides[1 - winner].score}!`, color: colorOf(winner) };
              const p = playerOf(winner);
              if (p) hub.rumble(p, 300);
            } else {
              startServe();
            }
          }
        } else if (phase === 'over') {
          phaseT -= dt;
          if (phaseT <= 0) newMatch();
        }

        // Paddles glide to where the ball will arrive.
        for (let s = 0; s < 2; s++) {
          let target = 0;
          if (phase === 'rally' && ball && ball.hitter !== s) target = Math.max(-1.3, Math.min(1.3, ball.toY));
          else if (phase === 'serve' && s === server) target = sides[s].py;
          sides[s].py += (target - sides[s].py) * Math.min(1, dt * 6);
        }
      },

      draw(ctx, time) {
        const { W, H } = hub;
        const g = geo();

        ctx.fillStyle = '#0e0f13';
        ctx.fillRect(0, 0, W, H);
        const spot = ctx.createRadialGradient(g.cx, g.cy, g.th * 0.2, g.cx, g.cy, Math.max(W, H) * 0.6);
        spot.addColorStop(0, 'rgba(77,171,247,0.10)');
        spot.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = spot;
        ctx.fillRect(0, 0, W, H);

        if (phase === 'waiting') {
          centerText(ctx, [
            { text: 'TABLE TENNIS', size: Math.max(40, hub.UNIT * 8), weight: 800, color: '#4dabf7' },
            { text: 'Join from your phone, then swing it like a paddle', size: 20, weight: 500, alpha: 0.8 },
            { text: 'Solo? You’ll play the CPU. A second player takes its place.', size: 15, weight: 500, alpha: 0.5 },
          ], H / 2 - 40);
          return;
        }

        // Table
        const tl = g.cx - g.tw / 2, tt = g.cy - g.th / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(tl + 10, tt + 14, g.tw, g.th);
        ctx.fillStyle = '#1c5a88';
        ctx.fillRect(tl, tt, g.tw, g.th);
        const lw = Math.max(2, g.th * 0.012);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = lw;
        ctx.strokeRect(tl + lw / 2, tt + lw / 2, g.tw - lw, g.th - lw);
        ctx.lineWidth = Math.max(1, lw / 2);
        ctx.beginPath(); ctx.moveTo(tl, g.cy); ctx.lineTo(tl + g.tw, g.cy); ctx.stroke();
        // Net
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(g.cx - lw, tt - g.th * 0.06 + 6, lw * 3, g.th * 1.12);
        ctx.fillStyle = '#e9ecef';
        ctx.fillRect(g.cx - lw, tt - g.th * 0.06, lw * 2, g.th * 1.12);
        ctx.fillStyle = '#495057';
        ctx.fillRect(g.cx - lw * 2, tt - g.th * 0.08, lw * 4, lw * 4);
        ctx.fillRect(g.cx - lw * 2, tt + g.th * 1.04, lw * 4, lw * 4);

        // Bounce ripples
        for (const r of ripples) {
          ctx.globalAlpha = 1 - r.t / 0.45;
          ctx.strokeStyle = r.out ? '#ff6b6b' : '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(g.X(r.x), g.Y(r.y), g.br * (1.5 + r.t * 8), 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Timing ring at the receiver's paddle as the ball comes in
        if (phase === 'rally' && ball && !ball.out) {
          const rcv = 1 - ball.hitter;
          const u = (1 - ball.t) * ball.T;
          if (u < 0.6 && u > LATE_LIMIT) {
            const inWindow = u <= EARLY_LIMIT;
            const k = inWindow ? 1 - Math.min(1, Math.abs(u - IDEAL) / 0.3) : 0.15;
            ctx.strokeStyle = colorOf(rcv);
            ctx.globalAlpha = 0.25 + k * 0.6;
            ctx.lineWidth = 2 + k * 3;
            ctx.beginPath(); ctx.arc(g.X(lineX(rcv)), g.Y(sides[rcv].py), g.pr * (1.35 + (1 - k) * 0.6), 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        drawPaddle(ctx, g, 0);
        drawPaddle(ctx, g, 1);

        // Ball
        let bx, by, bz;
        if (phase === 'serve') {
          const dir = server === 0 ? 1 : -1;
          bx = g.X(lineX(server)) + dir * g.pr * 1.25;
          by = g.Y(sides[server].py);
          bz = 0.35 + Math.abs(Math.sin(time / 280)) * 0.35;
        } else if (ball) {
          const p = ballPos();
          for (let i = 0; i < trail.length; i++) {
            const tr = trail[i];
            ctx.globalAlpha = (i / trail.length) * 0.25;
            ctx.fillStyle = '#fff7e6';
            ctx.beginPath();
            ctx.arc(g.X(tr.x), g.Y(tr.y) - tr.z * g.th * 0.22, g.br * 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          bx = g.X(p.x); by = g.Y(p.y); bz = p.z;
        }
        if (bx != null) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath(); ctx.ellipse(bx, by, g.br * 1.1, g.br * 0.7, 0, 0, Math.PI * 2); ctx.fill();
          ctx.save();
          ctx.shadowColor = 'rgba(255,240,200,0.9)';
          ctx.shadowBlur = 10;
          ctx.fillStyle = '#fff7e6';
          ctx.beginPath(); ctx.arc(bx, by - bz * g.th * 0.22, g.br * (1 + bz * 0.35), 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }

        // Scoreboard
        const sy = Math.max(40, tt - g.th * 0.22);
        ctx.textBaseline = 'middle';
        for (let s = 0; s < 2; s++) {
          const dir = s === 0 ? -1 : 1;
          ctx.textAlign = s === 0 ? 'right' : 'left';
          ctx.fillStyle = colorOf(s);
          ctx.font = hub.font(800, Math.max(36, hub.UNIT * 7));
          ctx.fillText(String(sides[s].score), g.cx + dir * hub.UNIT * 3, sy);
          ctx.font = hub.font(600, Math.max(14, hub.UNIT * 2));
          ctx.fillStyle = 'rgba(244,244,245,0.85)';
          const tag = phase === 'serve' && server === s ? ' • serving' : '';
          ctx.fillText(nameOf(s) + tag, g.cx + dir * hub.UNIT * 12, sy);
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(244,244,245,0.3)';
        ctx.font = hub.font(700, Math.max(20, hub.UNIT * 3));
        ctx.fillText('–', g.cx, sy);
        ctx.font = hub.font(500, 13);
        ctx.fillText(`First to ${WIN}`, g.cx, sy + Math.max(28, hub.UNIT * 4.5));

        // Popups
        for (const pp of popups) {
          const k = pp.t / pp.life;
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = pp.color;
          ctx.font = hub.font(800, Math.max(18, hub.UNIT * 3.2) * pp.scale);
          ctx.textAlign = 'center';
          ctx.fillText(pp.text, g.X(pp.nx), g.Y(pp.ny) - k * 30);
        }
        ctx.globalAlpha = 1;

        if (phase === 'serve' && !isCpu(server)) {
          ctx.font = hub.font(600, 16);
          ctx.fillStyle = 'rgba(244,244,245,0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(`${nameOf(server)}, swing your phone to serve`, g.cx, g.cy + g.th / 2 + Math.max(36, g.th * 0.14));
        }
        if (banner) {
          ctx.globalAlpha = Math.min(1, (2.2 - banner.t) * 2);
          ctx.font = hub.font(800, Math.max(24, hub.UNIT * 4));
          ctx.fillStyle = banner.color;
          ctx.textAlign = 'center';
          ctx.fillText(banner.text, g.cx, g.cy);
          ctx.globalAlpha = 1;
        }
        if (phase === 'over' && result) {
          ctx.fillStyle = 'rgba(14,15,19,0.6)';
          ctx.fillRect(0, 0, W, H);
          centerText(ctx, [
            { text: result.text, size: Math.max(34, hub.UNIT * 7), weight: 800, color: result.color },
            { text: `New match in ${Math.ceil(phaseT)}…`, size: 18, weight: 500, alpha: 0.6 },
          ], H / 2 - 20);
        }
      },

      _debug: () => ({ phase, server, rally, scores: [sides[0].score, sides[1].score], ids: [sides[0].id, sides[1].id], ball: ball && { t: ball.t, T: ball.T, hitter: ball.hitter, out: ball.out } }),
    };
  },
});

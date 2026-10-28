# Ball flight with drag, in closed form

Verified 2026-10-28 in `js/games/racket.js` ("Ball flight"; the smoke test's `strokes` section checks apex, speed and bounce numbers).

Quadratic air drag has no closed form; **linear drag** (acceleration −k·v, k ≈ 0.25 /s for a tennis ball at rally speeds, 0.5 /s for a table-tennis ball) does, which keeps every question the game asks answerable at the moment of the stroke (where the ball lands, how high it crosses the net, where the receiver can meet it) without stepping a simulation:

- With `e = exp(−k t)`, `f = (1 − e) / k`, `G = g / k`: `x = x0 + vx·f`, `z = z0 + vz·f`, `h = h0 + (vh + G)·f − G·t`; velocities `vx·e`, `vz·e`, `(vh + G)·e − G`. Spin is folded into `g` for the first flight (topspin: g + a few m/s²).
- **Launch velocity** to reach a point in time T: `vx = Δx / f(T)`, `vz = Δz / f(T)`, `vh = (Δh + G·T) / f(T) − G`.
- **Time to cross a plane** (the net at z = 0, a wall): `f = (zₚ − z0) / vz`, `t = −ln(1 − k·f) / k` (no crossing if `k·f ≥ 1`).
- **Apex**: `t = ln(1 + k·vh / g) / k`. Height is concave in t, so "when does it pass height h going down / up" is a bisection either side of the apex.
- Choosing T: from a pace (distance over an average speed) for drives, by bisection on the apex for lobs and pop-ups, then lengthened until the net crossing clears the tape by a margin (a slower ball is a higher one). Real gravity makes slow shots high: at Mabar's original pace (1.2–2.1 s baseline to baseline) a normal drive peaked at 3–4 m, so Tennis drives were sped up (19–28 m/s at the racket) and Table Tennis made faster to keep its balls low over the net.
- Bounce: vertical speed × restitution (Tennis 0.72, table 0.8), horizontal × "keep" (0.72), each adjusted for spin. A hard drive then hops ~15 m past its bounce before landing again, so receivers mostly take it on the rise or deep; the venue's walls (`court.walls`) stop runaway balls.

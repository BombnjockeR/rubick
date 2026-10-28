// Table Tennis: a table in a sports hall; first to 5. Engine: js/games/racket.js
MabarRacket.define({
  id: 'pingpong',
  name: 'Table Tennis',
  place: 'table',
  blurb: 'Swing your phone like a paddle. Waiting room seats 4; AI fills empty spots. First to 5.',
  color: '#8b5cf6',
  matchLabel: 'First to 5',
  scoring: 'points',
  points: 5,
  env: 'assets/tt_hall.glb',
  character: 'ch_tt',          // chibi fallback (assets/characters.glb)
  charScale: 3.0,
  characters: ['bunny', 'dog', 'cat', 'panda', 'chimp', 'lioness'], // same animals as Tennis (js/character.js)...
  characterScale: 1.8,          // the forehand meets the ball just above the table (lifting the arm when it bounces higher)
  tool: 'paddle',               // ...holding a table-tennis paddle instead of the racket
  court: {
    line: 1.72,
    halfW: 0.7625,
    surface: 0.76,          // table height
    onSurface: (x, z) => Math.abs(x) <= 0.7625 && Math.abs(z) <= 1.37,
    landMax: 0.797,         // the table's end, as a fraction of `line`
    net: 0.1525,
  },
  arc: { contact: 0.2, over: 0.7, toss: 0.15 },   // above the table, until the clips are measured
  ballR: 0.035, ballColor: '#ffffff',
  ball: { drag: 0.5, rest: 0.8, keep: 0.8, topspin: 4, lob: [1.0, 1.6], pop: 0.6, clear: 0.08, smash: 1.4 },
  // A slow ball is a high one under real gravity: table-tennis pace keeps it low over the net.
  serveT: 0.85, serveTP: 0.3, shotT: 0.62, shotTP: 0.27, cpuHard: 0.5,
  reach: 0.55, standBack: 0.35, runSpeed: 1.5, moveRate: 6,
  crossTime: 0.9,         // seconds from one side of the table to the other
  step: 0.15,             // no diving at the table (cfg.dive unset); lunges only
  deepest: 1.35,          // up to ~1 m behind the table
  cam: { back: 3.4, height: 4.1, rise: 0.1, push: 0.3, lookY: 0.6, ahead: -0.45, track: 0.5, follow: 0.4, fov: 50 }, // high enough to see over the big animal heads
  orbit: [6.5, 3.8, 0.6],
  sky: '#f6e8d8', fog: [25, 60], shadowSize: 7, sun: [4, 9, 3],
  tagSize: 0.28, blobGrow: 1.2, blobFade: 0.35,
});

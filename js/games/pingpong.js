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
  character: 'ch_tt',
  charScale: 3.0,
  court: {
    line: 1.72,
    halfW: 0.7625,
    surface: 0.76,          // table height
    onSurface: (x, z) => Math.abs(x) <= 0.7625 && Math.abs(z) <= 1.37,
  },
  arc: { contact: 0.2, peak: 0.24, peak2: 0.12 },
  ballR: 0.035, ballColor: '#ffffff',
  serveT: 1.5, serveTP: 0.6, shotT: 1.35, shotTP: 0.73, cpuHard: 0.75,
  reach: 0.55, standBack: 0.35, runSpeed: 1.5, moveRate: 6, maxStep: 3,
  cam: { back: 3.1, height: 3.0, rise: 0.1, push: 0.3, lookY: 0.55, ahead: -0.45, track: 0.5, follow: 0.4, fov: 50 },
  orbit: [6.5, 3.8, 0.6],
  sky: '#f6e8d8', fog: [25, 60], shadowSize: 7, sun: [4, 9, 3],
  tagSize: 0.28, blobGrow: 1.2, blobFade: 0.35,
});

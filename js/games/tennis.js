// Tennis: a full-size court on a tropical island, played by the bunny and the
// pup. Real scoring (15-30-40, deuce, advantage); first to 2 games wins.
// Engine: js/games/racket.js
MabarRacket.define({
  id: 'tennis',
  name: 'Tennis',
  place: 'island',
  blurb: 'Swing your phone like a racket. Waiting room seats 4; AI fills empty spots. First to 2 games.',
  color: '#2f7dff',
  matchLabel: 'First to 2 games',
  scoring: 'tennis',
  games: 2,
  env: 'assets/island_court.glb',     // art/island.py
  envFallback: 'assets/tennis_court.glb', // the stadium, if the island can't load
  character: 'ch_tennis',   // chibi fallback (assets/characters.glb)
  charScale: 3.3,
  characters: ['bunny', 'dog', 'cat', 'panda', 'chimp', 'lioness'], // animated animals, one per player by seat slot (js/character.js)
  characterScale: 1.8,          // the animal models are 1 m tall
  serveClip: 'serve',           // overhead serve (Table Tennis serves with the forehand)
  court: {
    line: 12.4,             // where players make contact (just behind the baseline)
    halfW: 4.115,           // singles
    halfWDoubles: 5.485,
    surface: 0,
    onSurface: () => true,
    landMax: 0.958,         // the baseline, as a fraction of `line` (balls past it are long)
    net: 0.914,
    walls: { x: 9.2, z: 16.9 },   // the grandstands' front rails (art/island.py SIDE_X, END_Y): a ball drops off them
  },
  // Contact heights above the court until the animals' clips are measured (forehand,
  // overhead) and how high the serve's toss bobs over the strings.
  arc: { contact: 0.85, over: 2.0, toss: 0.6 },
  ballR: 0.11, ballColor: '#d7f53b',
  // Ball flight (js/games/racket.js "Ball flight"): real gravity, so a slow shot is a
  // high one; pace = seconds line to line (shotT - power * shotTP).
  ball: { drag: 0.25, rest: 0.72, keep: 0.72, topspin: 3, lob: [5.5, 8], pop: 3.2, clear: 0.45, smash: 1.5 },
  serveT: 1.7, serveTP: 0.5, shotT: 1.55, shotTP: 0.6, cpuHard: 1.1,
  reach: 1.0, standBack: 0.3, runSpeed: 4, moveRate: 4,
  crossTime: 1.7,         // seconds to run from sideline to sideline: what makes placement count
  step: 0.35,             // the last stretch a stroke closes faster than a run (m)
  dive: 1.6,              // how far a dive flies (m), for the balls a run and a lunge can't reach
  deepest: 1.28,          // a player goes back up to ~4 m behind the baseline to let a ball come down
  cam: { back: 8.5, height: 6.3, rise: 0.5, push: 1.0, lookY: 0.2, ahead: -0.12, track: 0.4, follow: 0.4, fov: 50 },
  orbit: [27, 17, 0],
  // Daylight on the island: a gradient sky dome, a strong warm sun with a cooler
  // sky and sea-bounce hemisphere, fog that only takes the far horizon.
  sky: '#cdeeff', fog: [120, 300], shadowSize: 30, sun: [16, 26, 10],
  skyDome: { zenith: '#2f7fe0', horizon: '#cdeeff' },
  light: { hemi: '#dff1ff', ground: '#6fbdd2', hemiIntensity: 1.2, keyIntensity: 3.3, keyColor: '#fff0d2' },
  exposure: 1.12,
  tagSize: 0.55, blobGrow: 0.4, blobFade: 0.08,
});

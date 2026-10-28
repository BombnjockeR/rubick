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
  },
  arc: { contact: 1.0, peak: 1.75, peak2: 0.9 },
  ballR: 0.11, ballColor: '#d7f53b',
  serveT: 2.0, serveTP: 0.7, shotT: 2.1, shotTP: 0.9, cpuHard: 1.6,
  reach: 1.0, standBack: 0.3, runSpeed: 4, moveRate: 4,
  crossTime: 1.7,         // seconds to run from sideline to sideline: what makes placement count
  deepest: 1.18, bounceSpeed: 0.7,
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

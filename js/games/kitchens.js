// The Cooking game's kitchens: one entry per map, read by js/games/cooking.js at
// runtime and by art/kitchens.py when it builds assets/kitchen_<id>.glb from the
// source diorama (the object literal below must stay valid JSON: double quotes,
// no trailing commas, no comments inside it).
//
// `map` is a tile grid, one character per metre; row 0 is the far side of the
// screen, column 0 the left:
//   .  floor (chefs walk here)        ~  scenery: water, grass, huts (solid, nothing to do)
//   =  bridge (walkable; built over the diorama's water by the asset script)
//   #  counter (put things down)      B  prep board + knife (chop, squeeze)
//   S  rinse sink                     C  cooker (holds a pot: boil)
//   F  fryer                          P  dish stack (clean plates come back here)
//   W  serving hatch                  X  bin
//   crates: r rice  n noodles  v vegetables  t tofu  f fish  q squid  s shrimp
//           k crab  c chili  l citrus  p peanut sauce
// `level` + `scale` + `x0`/`y0` place the source model on this grid (the fitted
// tilt of the AI-generated diorama, the metres per model unit, and where tile
// (0,0)'s top-left corner falls in the levelled model); `spawns` are chef start
// tiles (col, row); `recipes` the orders this map serves (see cooking.js RECIPES).
window.MabarKitchens = {
  "paddy": {
    "name": "Paddy Field",
    "subtitle": "Sawah kitchen",
    "blurb": "Gado-gado, nasi liwet and tahu goreng in a village kitchen among the rice paddies.",
    "env": "assets/kitchen_paddy.glb",
    "source": "environments/cooking/village kitchen 3d model/village_kitchen_3d_model.fbx",
    "level": { "plane": [-0.00242, 0.34110, 0.14657], "floor": 0.14768 },
    "scale": 12.813, "x0": -6.6, "y0": 7.15,
    "sky": "#cfe9ff", "sun": [6, 12, 5],
    "recipes": ["gado", "liwet", "tahu"],
    "spawns": [[6, 3], [6, 5], [2, 6], [11, 7]],
    "map": [
      "~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~",
      "~~~~~##~~~~~~",
      "~~~~.......~~",
      "~~~.CFBPX#.~~",
      "~rS........~~",
      "#....~~.~~..c",
      "B....~~.~~..p",
      "~vt#.......#~",
      "~~~~~#W##~~~~",
      "~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~"
    ]
  },
  "beach": {
    "name": "Beach",
    "subtitle": "Seafood kitchen",
    "blurb": "Ikan bakar, cumi goreng and udang saus padang at a seaside stall, with the catch landing on the sand.",
    "env": "assets/kitchen_beach.glb",
    "source": "environments/cooking/beach market 3d model/beach_market_3d_model.fbx",
    "level": { "plane": [0.01093, 0.75553, 0.22167], "floor": 0.18036 },
    "scale": 15.452, "x0": -8.25, "y0": 12.65,
    "sky": "#bfe8ff", "sun": [7, 12, 4],
    "recipes": ["ikan", "cumi", "udang"],
    "spawns": [[8, 3], [8, 5], [8, 9], [8, 11]],
    "map": [
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~........~~~",
      "~~~~~#SBPCcX.~~~",
      "~~~~~........~~~",
      "~fqs~~~~=~~~~~rv",
      "l...~~~~=~~~~c..",
      "#...=........=..",
      "~~~~~........~~~",
      "~~~~~.FCB#W#.~~~",
      "~~~~~........~~~",
      "~~~~~~......~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~"
    ]
  },
  "city": {
    "name": "Pontianak City",
    "subtitle": "Riverside kitchen",
    "blurb": "Bakmi kepiting, selade and es jeruk nipis on the Kapuas riverside, under the evening lamps.",
    "env": "assets/kitchen_city.glb",
    "source": "environments/cooking/island market 3d model/island_market_3d_model.fbx",
    "level": { "plane": [-0.00091, 0.27026, 0.11037], "floor": 0.10947 },
    "scale": 14.515, "x0": -8.1, "y0": 8.3,
    "sky": "#ffd9b8", "sun": [-6, 10, 7],
    "recipes": ["bakmi", "selade", "jeruk"],
    "spawns": [[8, 3], [8, 5], [4, 9], [12, 9]],
    "map": [
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~.........~~~",
      "~~~~#SCBP#FX.~~~",
      "~~~..........~~~",
      "~v...~~~=~~~..k~",
      "~t...~~~=~~~..p~",
      "~n............l~",
      "~~............~~",
      "~~~~~###W##~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~"
    ]
  }
};

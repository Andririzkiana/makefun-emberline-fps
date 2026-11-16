# EMBERLINE

![make.fun bounty](https://make.fun/badge/threejs-fps-02.svg)
![rank](https://make.fun/badge/threejs-fps-02/Andririzkiana/makefun-emberline-fps/rank.svg)
![reward](https://make.fun/badge/threejs-fps-02/Andririzkiana/makefun-emberline-fps/reward.svg)

An original round-based tactical FPS built with three.js, entered in make.fun's
["Make the best three.js tactical FPS"](https://make.fun/bounty/threejs-fps-02) bounty.

Kindlers (attack) vs Wardens (defence), 3v3 with the player leading the attack — first to 7 round wins.
The map is **Foundry Yard**, an original dusk industrial foundry (56×56 m) with A-long, Mid and B-run
lanes, two plant sites (Kiln and Depot), connectors, a window room and long sightlines, in an
ember-orange/teal palette.

## Features

- Mouse look + WASD movement with acceleration/friction, crouching and map collision
- 4 weapons (P9 Sidearm, Rook-9 SMG, VK-47 Longline, scoped Farshot .50) with recoil,
  movement-punished spread, reloads, ammunition and headshot bonuses
- Ember Frag grenades, a full round economy with a buy menu, bomb plant and defuse
- Waypoint-graph bots that see, hear gunfire, rotate, hold sites, plant and defuse
- HUD with health/armour, ammo, round timer, score, killfeed and hitmarkers
- Fixed 60 Hz simulation split from rendering, pooled effects, no per-frame hot-loop allocations

## Layout

- `game/` — the static game (ES modules, no build step); open `game/index.html` via any static server
- `screenshots/` — genuine renders of the game
- `main.ts` — the entry program: copies `game/` and `screenshots/` to the output and writes the dossier
- `vendor/` — the kit's dossier library, unchanged

## License

MIT — see `LICENSE`. three.js 0.187.0 is vendored in `game/` under its own MIT license.

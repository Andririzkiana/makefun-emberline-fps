// FOUNDRY YARD — the map, as data. Everything solid is an axis-aligned box
// { x1, z1, x2, z2, h, mat } (metres, ground plane XZ, +z toward the Kindler spawn).
// The world builder turns these into meshes; the same list drives collision,
// bullet occlusion and the bot waypoint graph, so the three never disagree.
//
// Layout: Kindler (attack) spawn south, Warden (defence) spawn north-centre.
// Site A "Kiln" north-west, site B "Depot" north-east. Three approach lanes:
// A-long (west corridor), Mid (central hall and plaza with a window room), and
// B-run (east corridor), tied together by the A-short / B-short halls.

const W = (x1, z1, x2, z2, h, mat) => ({ x1, z1, x2, z2, h, mat });

export const WALLS = [
  // Boundary
  W(-28, -28, 28, -27, 4, 'concrete'), W(-28, 27, 28, 28, 4, 'concrete'),
  W(-28, -28, -27, 28, 4, 'concrete'), W(27, -28, 28, 28, 4, 'concrete'),
  // Warehouses flanking the mid-south hall
  W(-16, 0, -8, 17, 4.2, 'slate'), W(8, 0, 16, 17, 4.2, 'slate'),
  // West / east ridges: the outer walls of A-long and B-run
  W(-27, -13, -24, 17, 4, 'concrete'), W(24, -13, 27, 17, 4, 'concrete'),
  // Blocks sealing the A-short / B-short halls from the mid plaza
  W(-16, -8, -8, 0, 4, 'slate'), W(8, -8, 16, 0, 4, 'slate'),
  // Mid block: splits the mid-south hall into two doors
  W(-2, 6, 2, 11, 3, 'concrete'),
  // North band: blocks around the A / B defender halls
  W(-11, -25, -6, -19, 4, 'concrete'), W(-11, -15, -6, -12, 4, 'concrete'),
  W(6, -25, 11, -19, 4, 'concrete'), W(6, -15, 11, -12, 4, 'concrete'),
  // Site south walls, each with one entrance gap
  W(-24, -13, -17, -12, 3, 'concrete'), W(17, -13, 24, -12, 3, 'concrete'),
  // Mid plaza north wall with the window gap at x in [-3, 3]
  W(-6, -13, -3, -12, 3, 'concrete'), W(3, -13, 6, -12, 3, 'concrete'),
  // Warden spawn south wall with the window-room gap
  W(-6, -15, -3, -14, 3, 'concrete'), W(3, -15, 6, -14, 3, 'concrete'),
  // Low plant-cover walls inside the sites
  W(-19, -15, -14, -14.3, 1.6, 'metal'), W(14, -15, 19, -14.3, 1.6, 'metal'),
  // Depot containers on site B
  W(14, -24, 20, -22.6, 2.6, 'container'), W(21, -18, 23, -14, 2.6, 'container'),
  // The kiln on site A (cylinder in the world; this box is its collision)
  W(-19.7, -20.7, -16.3, -17.3, 3.4, 'kiln'),
];

// Timber crates: low cover (1.1 m) scattered through the lanes.
export const CRATES = [
  W(-4.6, -3.4, -3, -1.8, 1.1, 'crate'), W(3, -3.4, 4.6, -1.8, 1.1, 'crate'),
  W(-4.9, -7.6, -2.7, -6.4, 1.1, 'crate'),
  W(-7.4, 9, -6, 10.6, 1.1, 'crate'), W(4.4, 4, 6, 5.6, 1.1, 'crate'),
  W(-23, -2, -21.4, -0.4, 1.1, 'crate'), W(21.4, -2, 23, -0.4, 1.1, 'crate'),
  W(-18.6, 10, -17, 11.6, 1.1, 'crate'), W(17, 10, 18.6, 11.6, 1.1, 'crate'),
  W(-22, -23, -20, -21.4, 1.1, 'crate'), W(-14, -16, -12.4, -14.4, 1.1, 'crate'),
  W(12.4, -16, 14, -14.4, 1.1, 'crate'),
  W(-12, 21, -10.4, 22.6, 1.1, 'crate'), W(10.4, 21, 12, 22.6, 1.1, 'crate'),
  W(-14, -11.8, -12.4, -10.6, 1.1, 'crate'), W(12.4, -11.8, 14, -10.6, 1.1, 'crate'),
];

export const COLLIDERS = WALLS.concat(CRATES);

export const SITES = {
  A: { id: 'A', label: 'Kiln', x1: -24, z1: -25, x2: -11, z2: -13, cx: -17.5, cz: -19 },
  B: { id: 'B', label: 'Depot', x1: 11, z1: -25, x2: 24, z2: -13, cx: 17.5, cz: -19 },
};

export const SPAWNS = {
  atk: [[-3, 23, 0], [0, 24.5, 0], [3, 23, 0]],
  def: [[-3, -21, Math.PI], [0, -22.5, Math.PI], [3, -21, Math.PI]],
};

// Waypoint graph nodes [x, z]; links are derived at load by line-of-sight
// against the colliders, so this list only names the places worth standing.
export const NODES = [
  [0, 14], [-5, 13], [5, 13], [-4.5, 8], [4.5, 8], [0, 3],
  [-5.5, -5], [5.5, -5], [0, -9.5], [-5.5, -10.5], [5.5, -10.5], [0, -13.5],
  [0, -18], [-8.5, -17], [8.5, -17], [-14, -17], [14, -17],
  [-21, -19], [18, -20], [-22, -15.5], [22, -15.5], [-10, -10], [10, -10],
  [-20, -10], [20, -10], [-20.5, -3], [20.5, -3], [-20.5, 5], [20.5, 5],
  [-20.5, 13], [20.5, 13], [-12, 20.5], [12, 20.5], [0, 20],
  [-4, -22], [4, -22], [-15, -21], [13, -20], [-20.5, 19], [20.5, 19],
];

// Defender hold positions per assignment.
export const HOLDS = {
  A: [[-13.5, -21.5], [-22.5, -16]],
  B: [[13.5, -21.5], [22.5, -16]],
  mid: [[4, -10.8], [-4, -10.8]],
};

export function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2) return s;
  }
  return null;
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const dx = NODES[i][0] - x;
    const dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

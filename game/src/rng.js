// A tiny seeded RNG (mulberry32) plus helpers bound to the current stream.
// The game reseeds per match and per screenshot so staged frames are deterministic.

export function mulberry32(initial) {
  let a = initial | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let stream = mulberry32(1);

export function setSeed(seed) {
  stream = mulberry32(seed);
}

export function rand() {
  return stream();
}

// Random float in [a, b).
export function rr(a, b) {
  return a + stream() * (b - a);
}

// Random integer in [a, b].
export function ri(a, b) {
  return a + Math.floor(stream() * (b - a + 1));
}

export function pick(list) {
  return list[Math.floor(stream() * list.length)];
}

export function chance(p) {
  return stream() < p;
}

// Symmetric spread value in [-1, 1], bell-ish (sum of two uniforms).
export function bell() {
  return stream() * 2 - 1 + (stream() * 2 - 1);
}

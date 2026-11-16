// Combat resolution: a shot is a ray. Walls are tested with three's raycaster against
// the occluder meshes; bodies are tested analytically as three spheres (head, chest,
// hips) so the player — who has no mesh — is hit exactly like a bot. The nearer of
// the two wins. Damage falls off with distance, the head multiplies it, and armour
// shaves body hits (and head hits too, when a helmet is worn).

import * as THREE from 'three';
import { sfx } from './audio.js';

const raycaster = new THREE.Raycaster();
const SPHERES = [
  { part: 'head', dy: 1.52, dyCrouch: 1.04, r: 0.21 },
  { part: 'body', dy: 1.06, dyCrouch: 0.74, r: 0.4 },
  { part: 'body', dy: 0.55, dyCrouch: 0.42, r: 0.37 },
];

let occluders = [];
let actors = [];

export function initCombat(occluderMeshes, actorList) {
  occluders = occluderMeshes;
  actors = actorList;
}

// Distance from `from` to the first wall along `dir`, or maxDist when clear.
export function wallDistance(from, dir, maxDist) {
  raycaster.set(from, dir);
  raycaster.far = maxDist;
  const hits = raycaster.intersectObjects(occluders, false);
  return hits.length ? hits[0].distance : maxDist;
}

// Full shot query. Returns a reused record:
// { t, actor|null, part|null, point } — actor null means the ray met a wall (or air).
const hitRecord = { t: 0, actor: null, part: null, point: new THREE.Vector3() };
const sphereC = new THREE.Vector3();

export function rayHit(from, dir, maxDist, ignore) {
  const wallT = wallDistance(from, dir, maxDist);
  let bestT = wallT;
  let bestActor = null;
  let bestPart = null;
  for (let i = 0; i < actors.length; i += 1) {
    const a = actors[i];
    if (!a.alive || a === ignore) continue;
    for (let s = 0; s < SPHERES.length; s += 1) {
      const sph = SPHERES[s];
      sphereC.set(a.pos.x, a.pos.y + (a.crouching ? sph.dyCrouch : sph.dy), a.pos.z);
      const t = raySphere(from, dir, sphereC, sph.r);
      if (t > 0 && t < bestT) {
        bestT = t;
        bestActor = a;
        bestPart = sph.part;
      }
    }
  }
  hitRecord.t = bestT;
  hitRecord.actor = bestActor;
  hitRecord.part = bestPart;
  hitRecord.point.copy(dir).multiplyScalar(bestT).add(from);
  return hitRecord;
}

function raySphere(from, dir, center, r) {
  const ox = from.x - center.x;
  const oy = from.y - center.y;
  const oz = from.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0.05 ? t : -1;
}

export function falloff(def, dist) {
  const f = def.falloff;
  if (dist <= f.near) return 1;
  if (dist >= f.far) return f.minF;
  return 1 - (1 - f.minF) * ((dist - f.near) / (f.far - f.near));
}

// Applies damage to a target. Returns 'hit' | 'kill' | null (already dead).
// Money for a kill and the killfeed are the caller's business; this only moves hp,
// records the hurt direction for the HUD, and plays the victim's sounds.
export function applyDamage(S, target, amount, part, attacker) {
  if (!target.alive || amount <= 0) return null;
  let dmg = amount;
  if (target.armor > 0) {
    if (part === 'head') dmg *= target.armor >= 2 ? 0.8 : 1;
    else dmg *= 0.55;
  }
  target.hp -= dmg;
  target.lastHurtT = S.time;
  target.lastHurtFrom = attacker;
  if (target.isPlayer) sfx.hurt();
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deathT = S.time;
    return 'kill';
  }
  return 'hit';
}

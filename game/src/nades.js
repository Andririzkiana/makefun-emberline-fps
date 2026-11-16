// The Ember Frag: a thrown projectile with gravity and AABB bounces, a 1.5 s fuse,
// and an area blast whose damage is cut by walls (a wall between you and the blast
// keeps you safe) and by distance. Friendly fire is on — a bad throw hurts your own.

import * as THREE from 'three';
import { NADE } from './config.js';
import { COLLIDERS } from './mapdata.js';
import { eyePos } from './actors.js';
import { wallDistance, applyDamage } from './combat.js';
import * as fx from './effects.js';
import { sfx } from './audio.js';

const POOL = 6;
const live = [];
let meshes = [];

export function initNades(scene) {
  meshes = [];
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.5, metalness: 0.4 });
  const band = new THREE.MeshStandardMaterial({ color: 0xff7a26, emissive: 0xff7a26, emissiveIntensity: 0.7 });
  for (let i = 0; i < POOL; i += 1) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(geo, mat);
    g.add(ball);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 6, 14), band);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.visible = false;
    scene.add(g);
    meshes.push(g);
  }
}

export function dirFromYawPitch(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  return out;
}

const dirV = new THREE.Vector3();
const startV = new THREE.Vector3();

export function throwNade(S, actor) {
  if (actor.nades <= 0 || !actor.alive) return false;
  if (S.time < (actor.nadeOkAt || 0)) return false;
  actor.nades -= 1;
  actor.nadeOkAt = S.time + 0.55;
  dirFromYawPitch(actor.yaw, actor.pitch, dirV);
  eyePos(actor, startV).addScaledVector(dirV, 0.4);
  const mesh = meshes.find((m) => !m.visible) || meshes[0];
  mesh.visible = true;
  live.push({
    pos: startV.clone(), vel: dirV.clone().multiplyScalar(15.5).add(new THREE.Vector3(0, 3.2, 0)),
    fuse: NADE.fuse, owner: actor, mesh, spin: Math.random() * 6,
  });
  if (actor.isPlayer) sfx.throwNade();
  return true;
}

function bounceAxis(p, axis, r) {
  for (let i = 0; i < COLLIDERS.length; i += 1) {
    const c = COLLIDERS[i];
    if (p.x > c.x1 - r && p.x < c.x2 + r && p.z > c.z1 - r && p.z < c.z2 + r && p.y < c.h + r && p.y > -0.2) {
      return true;
    }
  }
  return false;
}

const blastDir = new THREE.Vector3();
const chestV = new THREE.Vector3();

function explode(S, n) {
  fx.boomFX(n.pos);
  const distToPlayer = n.pos.distanceTo(S.player.pos);
  sfx.boom(distToPlayer);
  S.noise.push({ x: n.pos.x, z: n.pos.z, t: S.time, r: 40 });
  for (const a of S.actors) {
    if (!a.alive) continue;
    chestV.set(a.pos.x, a.pos.y + 1.0, a.pos.z);
    const d = chestV.distanceTo(n.pos);
    if (d > NADE.radius + 0.5) continue;
    blastDir.copy(chestV).sub(n.pos).normalize();
    const from = n.pos.clone();
    from.y += 0.4;
    const wallT = wallDistance(from, blastDir, d);
    if (wallT < d - 0.6) continue; // a wall eats the blast
    const factor = Math.max(0, 1 - d / (NADE.radius + 1.2));
    const result = applyDamage(S, a, NADE.dmg * factor * factor + NADE.dmg * 0.25 * factor, 'body', n.owner);
    if (result === 'kill' && S.onKill) S.onKill(n.owner, a, { name: 'Ember Frag' }, false);
    if (a.isPlayer) fx.shake(0.35);
  }
}

export function updateNades(S, dt) {
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const n = live[i];
    n.fuse -= dt;
    n.vel.y -= 15.5 * dt;
    // Per-axis move with bounce against colliders and the floor.
    n.pos.x += n.vel.x * dt;
    if (bounceAxis(n.pos, 'x', 0.09)) { n.pos.x -= n.vel.x * dt; n.vel.x *= -0.42; }
    n.pos.z += n.vel.z * dt;
    if (bounceAxis(n.pos, 'z', 0.09)) { n.pos.z -= n.vel.z * dt; n.vel.z *= -0.42; }
    n.pos.y += n.vel.y * dt;
    if (n.pos.y < 0.09) {
      n.pos.y = 0.09;
      n.vel.y = Math.abs(n.vel.y) > 1.2 ? -n.vel.y * 0.42 : 0;
      n.vel.x *= 0.82;
      n.vel.z *= 0.82;
    } else if (bounceAxis(n.pos, 'y', 0.09)) {
      n.pos.y -= n.vel.y * dt;
      n.vel.y *= -0.42;
    }
    n.mesh.position.copy(n.pos);
    n.mesh.rotation.x += dt * 7;
    n.mesh.rotation.z += dt * 5;
    if (n.fuse <= 0) {
      n.mesh.visible = false;
      live.splice(i, 1);
      explode(S, n);
    }
  }
}

export function clearNades() {
  for (const n of live) n.mesh.visible = false;
  live.length = 0;
}

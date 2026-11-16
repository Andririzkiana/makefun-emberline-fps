// Actors: the physical body every combatant shares — the player and each bot are the
// same record, moved by the same fixed-step physics (ground friction, acceleration,
// a small air control, jumping, crouching) and resolved against the map's AABB
// colliders one axis at a time, so bodies slide along walls instead of sticking.

import * as THREE from 'three';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
const RADIUS = 0.38;
const GRAVITY = 22;
const JUMP_VEL = 7.4;

export function makeActor(team, isPlayer, name) {
  return {
    team, isPlayer, name,
    pos: new THREE.Vector3(0, 0, 0), // feet
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    eye: EYE_STAND,
    crouching: false,
    grounded: true,
    hp: 100, armor: 0, alive: true,
    money: 0,
    primary: null, sidearm: null, current: 'sidearm',
    nades: 0, tools: false,
    hasBomb: false,
    deathT: -1, // sim time of death, -1 while alive
    lastHurtT: -9, lastHurtFrom: null,
    brain: null,
  };
}

export function currentWeapon(a) {
  return a.current === 'primary' && a.primary ? a.primary : a.sidearm;
}

export function eyePos(a, out) {
  out.set(a.pos.x, a.pos.y + a.eye, a.pos.z);
  return out;
}

export function speedOf(a) {
  return Math.hypot(a.vel.x, a.vel.z);
}

// Does the circle at (x, z) with the body's radius overlap any collider whose top
// is above the body's feet (plus a small step tolerance)?
function circleBlocked(x, z, feetY, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c.h <= feetY + 0.5) continue;
    const nx = Math.max(c.x1, Math.min(x, c.x2));
    const nz = Math.max(c.z1, Math.min(z, c.z2));
    const dx = x - nx;
    const dz = z - nz;
    if (dx * dx + dz * dz < RADIUS * RADIUS) return true;
  }
  return false;
}

// ctrl: { wishX, wishZ (unit wish direction), speed (target ground speed), jump, crouch }
export function stepBody(a, dt, ctrl, colliders) {
  const targetEye = ctrl.crouch ? EYE_CROUCH : EYE_STAND;
  a.crouching = !!ctrl.crouch;
  a.eye += (targetEye - a.eye) * Math.min(1, dt * 11);

  if (a.grounded) {
    // Ground friction, then accelerate toward the wish direction (Quake-style).
    const speed = Math.hypot(a.vel.x, a.vel.z);
    if (speed > 0) {
      const drop = speed * 9 * dt;
      const keep = Math.max(0, speed - drop) / speed;
      a.vel.x *= keep;
      a.vel.z *= keep;
    }
    const wishSpeed = Math.min(ctrl.speed, ctrl.crouch ? 1.8 : ctrl.speed);
    const along = a.vel.x * ctrl.wishX + a.vel.z * ctrl.wishZ;
    const add = Math.min(Math.max(wishSpeed - along, 0), 52 * wishSpeed * dt);
    a.vel.x += ctrl.wishX * add;
    a.vel.z += ctrl.wishZ * add;
    if (ctrl.jump) {
      a.vel.y = JUMP_VEL;
      a.grounded = false;
    }
  } else {
    // Air control: a whisper of steering, no friction.
    const along = a.vel.x * ctrl.wishX + a.vel.z * ctrl.wishZ;
    const add = Math.min(Math.max(ctrl.speed - along, 0), 3.2 * ctrl.speed * dt);
    a.vel.x += ctrl.wishX * add;
    a.vel.z += ctrl.wishZ * add;
  }
  a.vel.y -= GRAVITY * dt;

  // Integrate and resolve per axis so walls slide.
  const nx = a.pos.x + a.vel.x * dt;
  if (!circleBlocked(nx, a.pos.z, a.pos.y, colliders)) a.pos.x = nx;
  else a.vel.x = 0;
  const nz = a.pos.z + a.vel.z * dt;
  if (!circleBlocked(a.pos.x, nz, a.pos.y, colliders)) a.pos.z = nz;
  else a.vel.z = 0;
  a.pos.y += a.vel.y * dt;
  if (a.pos.y <= 0) {
    a.pos.y = 0;
    a.vel.y = 0;
    a.grounded = true;
  }
}

// 2D segment vs colliders (tops at or above `minH`): used for waypoint links and
// cheap line-of-sight pre-checks. The segment is padded by `pad` metres.
export function segmentBlocked(x1, z1, x2, z2, colliders, minH = 1.3, pad = 0.45) {
  for (let i = 0; i < colliders.length; i += 1) {
    const c = colliders[i];
    if (c.h < minH) continue;
    if (segRect(x1, z1, x2, z2, c.x1 - pad, c.z1 - pad, c.x2 + pad, c.z2 + pad)) return true;
  }
  return false;
}

function segRect(x1, z1, x2, z2, rx1, rz1, rx2, rz2) {
  if (x1 >= rx1 && x1 <= rx2 && z1 >= rz1 && z1 <= rz2) return true;
  if (x2 >= rx1 && x2 <= rx2 && z2 >= rz1 && z2 <= rz2) return true;
  return (
    segSeg(x1, z1, x2, z2, rx1, rz1, rx2, rz1) ||
    segSeg(x1, z1, x2, z2, rx2, rz1, rx2, rz2) ||
    segSeg(x1, z1, x2, z2, rx2, rz2, rx1, rz2) ||
    segSeg(x1, z1, x2, z2, rx1, rz2, rx1, rz1)
  );
}

function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = dir(cx, cz, dx, dz, ax, az);
  const d2 = dir(cx, cz, dx, dz, bx, bz);
  const d3 = dir(ax, az, bx, bz, cx, cz);
  const d4 = dir(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function dir(px, pz, qx, qz, rx, rz) {
  return (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
}

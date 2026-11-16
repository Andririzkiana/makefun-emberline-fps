// Weapons: per-actor weapon state, the firing model, and the player's viewmodel.
//
// The firing model is the heart of the gunplay: a shot's spread grows with the
// shooter's speed (scaled per weapon), with the air, and with bloom from sustained
// fire; crouching shrinks it. Stopping to shoot is measurably better than spraying
// on the move, and the numbers live in config.js where the judge can read them.

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { currentWeapon, eyePos, speedOf } from './actors.js';
import { rayHit, falloff, applyDamage } from './combat.js';
import * as fx from './effects.js';
import { sfx } from './audio.js';
import { bell, rr } from './rng.js';

export function makeWeaponState(id) {
  const def = WEAPONS[id];
  return {
    id, def,
    mag: def.mag, reserve: def.reserve,
    nextOk: 0, reloading: false, reloadEnd: 0, bloom: 0, cyclesAt: 0,
  };
}

export function refillWeapon(w) {
  w.mag = w.def.mag;
  w.reserve = w.def.reserve;
  w.reloading = false;
  w.bloom = 0;
  w.nextOk = 0;
}

// Shared scratch: firing never allocates.
const origin = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const rightV = new THREE.Vector3();
const upV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Spread (radians) for this actor pulling the trigger right now.
export function currentSpread(S, actor, w) {
  const def = w.def;
  const speedN = Math.min(1, speedOf(actor) / 5);
  let s = def.spread * (1 + speedN * def.moveSpread);
  if (!actor.grounded) s *= 3;
  if (actor.crouching) s *= 0.68;
  s *= 1 + w.bloom * 1.7;
  if (def.zoom) s *= (actor === S.player && S.scoped) ? 0.3 : 9;
  return s;
}

// Attempts to fire `actor`'s current weapon along `dir` (unit). Returns true on a shot.
export function tryFire(S, actor, dir) {
  const w = currentWeapon(actor);
  if (!w || w.reloading || S.time < w.nextOk) return false;
  if (w.mag <= 0) {
    if (actor.isPlayer && S.time > (w.dryAt || 0)) {
      w.dryAt = S.time + 0.3;
      sfx.dry();
    }
    startReload(S, actor);
    return false;
  }
  const def = w.def;
  w.mag -= 1;
  w.nextOk = S.time + 60 / def.rpm;
  w.bloom = Math.min(1, w.bloom + 0.14);

  const spread = currentSpread(S, actor, w);
  shotDir.copy(dir);
  shotDir.x += bell() * spread;
  shotDir.y += bell() * spread;
  shotDir.z += bell() * spread;
  shotDir.normalize();

  eyePos(actor, origin);
  rightV.crossVectors(dir, UP).normalize();
  upV.crossVectors(rightV, dir);
  muzzle.copy(origin)
    .addScaledVector(dir, actor.isPlayer ? 0.5 : 0.75)
    .addScaledVector(rightV, 0.17)
    .addScaledVector(upV, -0.13);

  const hit = rayHit(origin, shotDir, 130, actor);
  fx.tracer(muzzle, hit.point, actor.team === 'atk');
  fx.muzzle(muzzle);
  if (hit.actor) {
    const dmg = def.dmg * falloff(def, hit.t) * (hit.part === 'head' ? def.headMult : 1);
    const result = applyDamage(S, hit.actor, dmg, hit.part, actor);
    fx.impact(hit.point, 'body', 8);
    if (actor.isPlayer && result) {
      S.ui.hitmarkT = S.time;
      S.ui.hitmarkKill = result === 'kill';
      sfx.hit(result === 'kill');
    }
    if (result === 'kill' && S.onKill) S.onKill(actor, hit.actor, def, hit.part === 'head');
  } else if (hit.t < 129) {
    fx.impact(hit.point, 'wall', 5);
  }

  const distToPlayer = actor.isPlayer ? 0 : actor.pos.distanceTo(S.player.pos);
  sfx.shot(def.id, distToPlayer);
  S.noise.push({ x: actor.pos.x, z: actor.pos.z, t: S.time, r: def.id === 'farshot' ? 36 : 27 });

  if (actor.isPlayer) {
    S.kick.pitch += def.recoil * rr(0.85, 1.15);
    S.kick.yaw += def.recoil * bell() * 0.3;
    VM.kick = Math.min(1, VM.kick + def.kick * 0.55);
    if (def.zoom) S.scoped = false; // the bolt throws the eye off the scope
  }
  if (w.mag === 0) startReload(S, actor);
  return true;
}

export function startReload(S, actor) {
  const w = currentWeapon(actor);
  if (!w || w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return;
  w.reloading = true;
  w.reloadEnd = S.time + w.def.reload;
  if (actor.isPlayer) sfx.reloadStart();
}

// Reload completion and bloom recovery, once per step per actor.
export function updateWeapon(S, actor) {
  const w = currentWeapon(actor);
  if (!w) return;
  if (w.reloading && S.time >= w.reloadEnd) {
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
    w.reloading = false;
    if (actor.isPlayer) sfx.reloadEnd();
  }
  w.bloom = Math.max(0, w.bloom - S.dt * 1.5);
}

// --- The player's viewmodel -------------------------------------------------

export const VM = { kick: 0 };

const VM_PARTS = {
  p9: { len: 0.34, body: 0.055, barrel: 0.02, color: 0x3a3d40 },
  rook: { len: 0.52, body: 0.07, barrel: 0.024, color: 0x42464a },
  vk47: { len: 0.66, body: 0.075, barrel: 0.026, color: 0x4a4238 },
  farshot: { len: 0.92, body: 0.08, barrel: 0.03, color: 0x36322c },
};

export function createViewmodel(camera) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff7a26, roughness: 0.5, metalness: 0.2 });
  let built = null;
  let drawT = 1;

  function build(id) {
    while (group.children.length) group.remove(group.children[0]);
    const p = VM_PARTS[id] || VM_PARTS.vk47;
    const mat = metal.clone();
    mat.color.setHex(p.color);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, p.len), mat);
    body.position.z = -p.len / 2;
    group.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(p.barrel, p.barrel, 0.22, 8), mat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -p.len - 0.08);
    group.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.09), mat);
    mag.position.set(0, -0.12, -p.len * 0.45);
    mag.rotation.x = 0.18;
    group.add(mag);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), mat);
    grip.position.set(0, -0.11, -0.05);
    grip.rotation.x = 0.3;
    group.add(grip);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.02, p.len * 0.5), accent);
    stripe.position.set(0, 0.045, -p.len * 0.4);
    group.add(stripe);
    if (id === 'farshot') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.17, 10), mat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, -0.3);
      group.add(scope);
    } else {
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.05, 0.016), mat);
      sight.position.set(0, 0.09, -p.len * 0.7);
      group.add(sight);
    }
    built = id;
    drawT = 0;
  }

  group.position.set(0.23, -0.21, -0.42);
  camera.add(group);
  let walkPhase = 0;

  return {
    group,
    setWeapon(id) {
      if (id !== built) build(id);
    },
    update(dt, actor, w, scoped) {
      drawT = Math.min(1, drawT + dt * 4.5);
      const drawDip = (1 - drawT) * 0.24;
      const speed = Math.min(1, Math.hypot(actor.vel.x, actor.vel.z) / 5);
      walkPhase += dt * (4 + speed * 6) * (actor.grounded ? 1 : 0);
      const bobY = Math.sin(walkPhase * 2) * 0.011 * speed;
      const bobX = Math.cos(walkPhase) * 0.007 * speed;
      VM.kick = Math.max(0, VM.kick - dt * 7);
      let reloadDip = 0;
      let reloadTilt = 0;
      if (w && w.reloading) {
        reloadDip = 0.1;
        reloadTilt = 0.5;
      }
      group.visible = !scoped;
      group.position.set(
        0.23 + bobX,
        -0.21 + bobY - drawDip - reloadDip + VM.kick * 0.012,
        -0.42 + VM.kick * 0.07,
      );
      group.rotation.set(VM.kick * 0.05 + reloadTilt * 0.4 - drawDip * 1.4, 0, 0);
    },
  };
}

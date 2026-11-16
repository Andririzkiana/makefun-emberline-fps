// Bots: box-built soldiers driven by one brain per actor. Perception is a vision
// cone plus a wall raycast, refreshed on a staggered think tick; gunfire noise is
// heard through the shared S.noise list. Movement follows a waypoint graph whose
// links are derived from the map colliders, so bots route through the same lanes
// the player uses: pushes down A-long, mid and B-run, holds on the sites, rotates
// on information, and a retake with a defuse once the charge is planted.

import * as THREE from 'three';
import { TEAM } from './config.js';
import { NODES, HOLDS, SITES, COLLIDERS, nearestNode } from './mapdata.js';
import { segmentBlocked, stepBody, eyePos, currentWeapon, speedOf } from './actors.js';
import { wallDistance } from './combat.js';
import { tryFire, startReload } from './weapons.js';
import { dirFromYawPitch, throwNade } from './nades.js';
import { rr, ri, chance, bell } from './rng.js';

// --- Waypoint graph ----------------------------------------------------------

const graph = NODES.map(() => []);
export function buildGraph() {
  for (let i = 0; i < NODES.length; i += 1) {
    for (let j = i + 1; j < NODES.length; j += 1) {
      const [ax, az] = NODES[i];
      const [bx, bz] = NODES[j];
      const d = Math.hypot(bx - ax, bz - az);
      if (d > 17) continue;
      if (!segmentBlocked(ax, az, bx, bz, COLLIDERS, 1.3, 0.45)) {
        graph[i].push(j);
        graph[j].push(i);
      }
    }
  }
}

// Breadth-first next-hop path between two node indices, as a list of indices.
function bfsPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(NODES.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of graph[cur]) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let n = to;
        while (n !== from) {
          n = prev[n];
          path.push(n);
        }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return [to];
}

// --- Meshes ------------------------------------------------------------------

const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.6, metalness: 0.3 });

export function buildBotMesh(team) {
  const color = TEAM[team].color;
  const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.9 });
  const group = new THREE.Group();
  const upper = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.2);
  const legL = new THREE.Mesh(legGeo, vest);
  legL.position.set(-0.13, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, vest);
  legR.position.set(0.13, 0.39, 0);
  group.add(legL, legR);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  torso.position.y = 1.09;
  torso.castShadow = true;
  upper.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.36), vest);
  chest.position.y = 1.12;
  upper.add(chest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
  head.position.y = 1.56;
  head.castShadow = true;
  upper.add(head);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), suit);
  helm.position.y = 1.72;
  upper.add(helm);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.72), darkMat);
  gun.position.set(0.14, 1.24, -0.42);
  upper.add(gun);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.5), suit);
  arm.position.set(0.14, 1.22, -0.2);
  upper.add(arm);
  group.add(upper);
  group.userData = { legL, legR, upper, phase: Math.random() * 6 };
  return group;
}

export function syncBotMesh(bot, dt) {
  const m = bot.mesh;
  if (!m) return;
  const u = m.userData;
  if (!bot.alive) {
    const t = Math.min(1, (performance.now() / 1000 - bot.deathWallT) * 3);
    m.rotation.x = -Math.PI / 2 * t;
    m.position.set(bot.pos.x, bot.pos.y + 0.12 * (1 - t), bot.pos.z);
    return;
  }
  m.rotation.x = 0;
  m.position.copy(bot.pos);
  m.rotation.y = bot.yaw;
  const sp = speedOf(bot);
  u.phase += dt * (3 + sp * 2.1);
  const swing = Math.sin(u.phase) * 0.55 * Math.min(1, sp / 3);
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.upper.position.y = bot.crouching ? -0.36 : 0;
  u.upper.rotation.x = -bot.pitch * 0.55;
}

// --- Brains ------------------------------------------------------------------

export function makeBrain() {
  return {
    role: 'push', state: 'advance',
    path: [], pathI: 0, goalNode: -1, goalPos: new THREE.Vector3(),
    thinkAt: 0, see: null, losNow: false, lastSeenPos: new THREE.Vector3(),
    lastSeenT: -9, reactAt: 0, acquired: null,
    burst: 0, nextBurstAt: 0, strafeDir: 1, strafeFlipAt: 0,
    holdPos: new THREE.Vector3(), holdLook: new THREE.Vector3(),
    investigate: null, crouchUntil: 0, stuckT: 0,
    lastX: 0, lastZ: 0, nadeUsed: false, channeling: false,
  };
}

// Round-start team plans: attackers pick a site (the carrier leads), defenders
// split one per site plus a mid watcher.
export function assignPlans(S) {
  const site = chance(0.5) ? 'A' : 'B';
  S.plan = { site };
  const attackers = S.actors.filter((a) => a.team === 'atk');
  const carrier = S.bomb.carrier;
  for (const a of attackers) {
    if (!a.brain) continue;
    a.brain.role = a === carrier ? 'carrier' : 'push';
    a.brain.state = 'advance';
    a.brain.investigate = null;
  }
  const defenders = S.actors.filter((a) => a.team === 'def' && a.brain);
  const roles = ['holdA', 'holdB', 'mid'];
  defenders.forEach((a, i) => {
    const role = roles[i % roles.length];
    a.brain.role = role;
    a.brain.state = 'hold';
    const holds = role === 'holdA' ? HOLDS.A : role === 'holdB' ? HOLDS.B : HOLDS.mid;
    const hp = holds[i % holds.length];
    a.brain.holdPos.set(hp[0], 0, hp[1]);
    const look = role === 'holdA' ? [-16, -12] : role === 'holdB' ? [16, -12] : [0, 2];
    a.brain.holdLook.set(look[0], 1.2, look[1]);
    setGoal(S, a, a.brain.holdPos);
  });
}

function setGoal(S, bot, pos) {
  const b = bot.brain;
  if (b.goalPos.distanceToSquared(pos) < 0.25 && b.path.length) return;
  b.goalPos.copy(pos);
  const from = nearestNode(bot.pos.x, bot.pos.z);
  const to = nearestNode(pos.x, pos.z);
  b.path = bfsPath(from, to);
  b.pathI = 0;
  b.goalNode = to;
}

const eyeV = new THREE.Vector3();
const chestV = new THREE.Vector3();
const dirV = new THREE.Vector3();

function canSee(S, bot, enemy) {
  eyePos(bot, eyeV);
  chestV.set(enemy.pos.x, enemy.pos.y + (enemy.crouching ? 0.8 : 1.1), enemy.pos.z);
  dirV.copy(chestV).sub(eyeV);
  const dist = dirV.length();
  if (dist > 46) return false;
  dirV.normalize();
  if (dist > 3.6) {
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if (fx * dirV.x + fz * dirV.z < 0.18) return false; // outside the vision cone
  }
  return wallDistance(eyeV, dirV, dist) >= dist - 0.55;
}

function think(S, bot) {
  const b = bot.brain;
  const now = S.time;
  // Perception: nearest visible enemy.
  let seen = null;
  for (const e of S.actors) {
    if (e.team === bot.team || !e.alive) continue;
    if (canSee(S, bot, e)) {
      if (!seen || e.pos.distanceToSquared(bot.pos) < seen.pos.distanceToSquared(bot.pos)) seen = e;
    }
  }
  b.losNow = !!seen;
  if (seen) {
    if (b.acquired !== seen) {
      b.acquired = seen;
      b.reactAt = now + rr(0.3, 0.55);
    }
    b.see = seen;
    b.lastSeenPos.copy(seen.pos);
    b.lastSeenT = now;
  } else if (b.see && (!b.see.alive || now - b.lastSeenT > 2.4)) {
    b.investigate = b.lastSeenPos.clone();
    b.see = null;
    b.acquired = null;
  }

  // Hearing: fresh enemy gunfire pulls a look, or a rotation for a holder.
  if (!b.see) {
    for (const n of S.noise) {
      if (now - n.t > 1.1) continue;
      const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
      if (d < n.r && d > 6) {
        if (bot.team === 'def' && S.bomb.state !== 'planted' && chance(0.5)) {
          b.investigate = new THREE.Vector3(n.x, 0, n.z);
        } else if (bot.team === 'atk') {
          b.investigate = new THREE.Vector3(n.x, 0, n.z);
        }
      }
    }
  }

  // Objective state machine.
  const bomb = S.bomb;
  b.channeling = false;
  if (bot.team === 'def' && bomb.state === 'planted') {
    const dBomb = Math.hypot(bomb.pos.x - bot.pos.x, bomb.pos.z - bot.pos.z);
    const nearest = S.actors
      .filter((a) => a.team === 'def' && a.alive)
      .every((a) => a === bot || Math.hypot(bomb.pos.x - a.pos.x, bomb.pos.z - a.pos.z) >= dBomb);
    if (nearest && dBomb < 1.7 && !b.see) {
      b.state = 'defuse';
      b.channeling = true;
    } else {
      b.state = 'advance';
      setGoal(S, bot, bomb.pos);
    }
    return;
  }
  if (bot.team === 'atk') {
    if (bomb.state === 'ground' && !bot.hasBomb) {
      const carrierless = true;
      if (carrierless) {
        const nearest = S.actors
          .filter((a) => a.team === 'atk' && a.alive && !a.isPlayer)
          .every((a) => a === bot || a.pos.distanceToSquared(bomb.pos) >= bot.pos.distanceToSquared(bomb.pos));
        if (nearest) {
          b.state = 'advance';
          setGoal(S, bot, bomb.pos);
          return;
        }
      }
    }
    if (bot.hasBomb) {
      const site = SITES[S.plan.site];
      const inSite = bot.pos.x >= site.x1 && bot.pos.x <= site.x2 && bot.pos.z >= site.z1 && bot.pos.z <= site.z2;
      if (inSite && !b.see) {
        b.state = 'plant';
        b.channeling = true;
        return;
      }
      b.state = 'advance';
      setGoal(S, bot, new THREE.Vector3(site.cx + rr(-2, 2), 0, site.cz + rr(-2, 2)));
      return;
    }
    if (bomb.state === 'planted') {
      b.state = 'hold';
      b.holdPos.copy(bot.pos);
      b.holdLook.copy(b.lastSeenPos);
      return;
    }
    // Push the planned site, detouring to investigate contacts.
    b.state = b.see ? 'engage' : 'advance';
    if (b.investigate && !b.see) setGoal(S, bot, b.investigate);
    else {
      const site = SITES[S.plan.site];
      setGoal(S, bot, new THREE.Vector3(site.cx, 0, site.cz - 4));
    }
    return;
  }
  // Defenders, nothing planted.
  if (b.see) b.state = 'engage';
  else if (b.investigate) {
    b.state = 'advance';
    setGoal(S, bot, b.investigate);
    if (bot.pos.distanceToSquared(b.investigate) < 4) b.investigate = null;
  } else {
    b.state = 'hold';
    setGoal(S, bot, b.holdPos);
  }
}

const wishV = new THREE.Vector3();
const aimV = new THREE.Vector3();

function faceToward(bot, x, y, z, dt, rate = 9) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  const targetYaw = Math.atan2(-dx, -dz);
  let dy = targetYaw - bot.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  bot.yaw += dy * Math.min(1, dt * rate);
  const hyp = Math.hypot(dx, dz) || 1;
  const targetPitch = Math.atan2(y - (bot.pos.y + bot.eye), hyp);
  bot.pitch += (targetPitch - bot.pitch) * Math.min(1, dt * rate);
}

export function updateBot(S, bot, dt) {
  const b = bot.brain;
  if (!bot.alive) return;
  if (S.time >= b.thinkAt) {
    b.thinkAt = S.time + 0.12 + (bot.id % 5) * 0.013;
    think(S, bot);
  }
  const now = S.time;
  const ctrl = { wishX: 0, wishZ: 0, speed: 0, jump: false, crouch: bot.crouching && now < b.crouchUntil };
  let moveTarget = null;
  let moveSpeed = 0;

  if (b.state === 'engage' && b.see) {
    const e = b.see;
    faceToward(bot, e.pos.x, e.pos.y + 1.15, e.pos.z, dt, 11);
    const d = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
    if (now >= b.strafeFlipAt) {
      b.strafeFlipAt = now + rr(0.6, 1.3);
      b.strafeDir = chance(0.5) ? 1 : -1;
      if (chance(0.3)) b.crouchUntil = now + rr(0.5, 1.1);
    }
    // Strafe sideways; close or back off to keep a fighting distance.
    const px = -(e.pos.z - bot.pos.z);
    const pz = e.pos.x - bot.pos.x;
    const pl = Math.hypot(px, pz) || 1;
    let mx = (px / pl) * b.strafeDir;
    let mz = (pz / pl) * b.strafeDir;
    if (d > 26) { mx += (e.pos.x - bot.pos.x) / d; mz += (e.pos.z - bot.pos.z) / d; }
    if (d < 5) { mx -= (e.pos.x - bot.pos.x) / d; mz -= (e.pos.z - bot.pos.z) / d; }
    const ml = Math.hypot(mx, mz) || 1;
    ctrl.wishX = mx / ml;
    ctrl.wishZ = mz / ml;
    ctrl.speed = 2.7;
    fireControl(S, bot, e, d);
  } else if (b.state === 'plant' || b.state === 'defuse') {
    ctrl.crouch = true;
    faceToward(bot, b.holdLook.x, 1, b.holdLook.z, dt, 4);
    if (b.state === 'plant') faceToward(bot, bot.pos.x - Math.sin(bot.yaw), 1, bot.pos.z - Math.cos(bot.yaw), dt, 2);
  } else if (b.state === 'hold') {
    const d = Math.hypot(b.holdPos.x - bot.pos.x, b.holdPos.z - bot.pos.z);
    if (d > 1.1) {
      moveTarget = b.holdPos;
      moveSpeed = 3.8;
    } else {
      faceToward(bot, b.holdLook.x, 1.2, b.holdLook.z, dt, 3.5);
    }
    if (b.see) fireControl(S, bot, b.see, bot.pos.distanceTo(b.see.pos));
  } else {
    // advance: follow the waypoint path toward the goal.
    moveTarget = b.goalPos;
    moveSpeed = bot.team === 'def' && S.bomb.state === 'planted' ? 4.6 : 4.1;
    if (b.see) {
      faceToward(bot, b.see.pos.x, b.see.pos.y + 1.15, b.see.pos.z, dt, 10);
      fireControl(S, bot, b.see, bot.pos.distanceTo(b.see.pos));
      moveSpeed = 2.4;
    }
  }

  if (moveTarget) {
    followPath(S, bot, moveTarget, ctrl, moveSpeed, dt);
  }

  // Stuck? Hop and re-path.
  const moved = Math.hypot(bot.pos.x - b.lastX, bot.pos.z - b.lastZ);
  if (moveSpeed > 0 && moved < 0.02) b.stuckT += dt;
  else b.stuckT = 0;
  b.lastX = bot.pos.x;
  b.lastZ = bot.pos.z;
  if (b.stuckT > 1.1) {
    b.stuckT = 0;
    ctrl.jump = true;
    b.path = [];
    setGoal(S, bot, b.goalPos);
  }

  stepBody(bot, dt, ctrl, COLLIDERS);
  maybeThrowNade(S, bot);
}

function followPath(S, bot, target, ctrl, speed, dt) {
  const b = bot.brain;
  let tx = target.x;
  let tz = target.z;
  if (b.path.length && b.pathI < b.path.length) {
    const node = NODES[b.path[b.pathI]];
    tx = node[0];
    tz = node[1];
    if (Math.hypot(tx - bot.pos.x, tz - bot.pos.z) < 0.85) {
      b.pathI += 1;
      return;
    }
  }
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.55 && target !== b.holdPos) return;
  if (d > 0.01) {
    ctrl.wishX = dx / d;
    ctrl.wishZ = dz / d;
    ctrl.speed = speed;
    if (!bot.brain.see) faceToward(bot, tx, bot.pos.y + bot.eye, tz, dt, 7);
  }
}

function fireControl(S, bot, enemy, dist) {
  const b = bot.brain;
  const now = S.time;
  if (now < b.reactAt || !b.losNow) return;
  const w = currentWeapon(bot);
  if (!w) return;
  if (w.mag === 0) {
    startReload(S, bot);
    return;
  }
  if (b.burst <= 0) {
    if (now < b.nextBurstAt) return;
    b.burst = ri(2, 5);
  }
  // Aim at the chest, sometimes the head, with an error that grows with range
  // and with both fighters' movement.
  const head = chance(0.22);
  aimV.set(
    enemy.pos.x,
    enemy.pos.y + (head ? 1.5 : 1.05) * (enemy.crouching ? 0.72 : 1),
    enemy.pos.z,
  );
  eyePos(bot, wishV);
  aimV.sub(wishV).normalize();
  const err = 0.02 + dist * 0.0011 + speedOf(enemy) * 0.005 + speedOf(bot) * 0.004;
  aimV.x += bell() * err;
  aimV.y += bell() * err * 0.7;
  aimV.z += bell() * err;
  aimV.normalize();
  if (tryFire(S, bot, aimV)) {
    b.burst -= 1;
    if (b.burst <= 0) b.nextBurstAt = now + rr(0.3, 0.75);
  }
}

function maybeThrowNade(S, bot) {
  const b = bot.brain;
  if (b.nadeUsed || bot.nades <= 0 || !bot.alive) return;
  if (bot.team !== 'atk' || S.bomb.state === 'planted') return;
  const site = SITES[S.plan.site];
  const dSite = Math.hypot(site.cx - bot.pos.x, site.cz - bot.pos.z);
  if (dSite < 13 && chance(0.02)) {
    bot.yaw = Math.atan2(-(site.cx - bot.pos.x), -(site.cz - bot.pos.z));
    bot.pitch = 0.42;
    if (throwNade(S, bot)) b.nadeUsed = true;
  }
}

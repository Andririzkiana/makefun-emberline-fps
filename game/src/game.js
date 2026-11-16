// The game object: owns the central state S (the one place match state lives),
// creates the actors, and runs the fixed-step simulation — player control, bots,
// weapons, grenades, the round machine — apart from rendering, which only reads
// state and syncs meshes, the camera and effects.

import * as THREE from 'three';
import { BOT_NAMES, BUY_ITEMS, ECO } from './config.js';
import { COLLIDERS } from './mapdata.js';
import { makeActor, stepBody, currentWeapon, speedOf } from './actors.js';
import { createWorld } from './world.js';
import { initCombat } from './combat.js';
import { makeWeaponState, tryFire, startReload, updateWeapon, currentSpread, createViewmodel } from './weapons.js';
import { buildGraph, buildBotMesh, syncBotMesh, makeBrain, updateBot } from './bots.js';
import { initNades, throwNade, updateNades, dirFromYawPitch } from './nades.js';
import { createBomb, newMatch, startRound, updateRounds, buyItem } from './rounds.js';
import * as fx from './effects.js';
import { sfx } from './audio.js';
import { setSeed } from './rng.js';

const aimDir = new THREE.Vector3();
const shakeV = new THREE.Vector3();

export function createGame(scene, camera, input) {
  const world = createWorld(scene);
  fx.initEffects(scene);
  initNades(scene);
  buildGraph();

  const player = makeActor('atk', true, 'YOU');
  const actors = [player];
  for (const name of BOT_NAMES.atk) {
    const bot = makeActor('atk', false, name);
    bot.brain = makeBrain();
    actors.push(bot);
  }
  for (const name of BOT_NAMES.def) {
    const bot = makeActor('def', false, name);
    bot.brain = makeBrain();
    actors.push(bot);
  }
  actors.forEach((a, i) => {
    a.id = i;
    if (!a.isPlayer) {
      a.mesh = buildBotMesh(a.team);
      scene.add(a.mesh);
    }
  });
  initCombat(world.occluders, actors);

  const viewmodel = createViewmodel(camera);
  scene.add(camera);

  // The charge's world mesh: a dark brick with a blinking tell-tale.
  const bombMesh = new THREE.Group();
  const brick = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.16, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 }),
  );
  brick.position.y = 0.08;
  bombMesh.add(brick);
  const tell = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  );
  tell.position.set(0.1, 0.18, 0);
  bombMesh.add(tell);
  bombMesh.visible = false;
  scene.add(bombMesh);

  const S = {
    time: 0, dt: 1 / 60,
    phase: 'menu', phaseT: 0, roundT: 0, round: 1,
    score: { atk: 0, def: 0 },
    actors, player,
    bomb: createBomb(),
    noise: [], feed: [],
    ui: { hitmarkT: -9, hitmarkKill: false, banner: null, buyOpen: false, spreadPx: 0, dmgAngle: 0, dmgT: -9 },
    kick: { pitch: 0, yaw: 0 },
    scoped: false, inputPlant: false,
    plan: { site: 'A' },
    spectateName: '', bombBoom: false,
    onKill: null,
  };

  S.onKill = (attacker, victim, def, headshot) => {
    if (attacker && attacker !== victim) {
      attacker.money = Math.min(ECO.cap, (attacker.money || 0) + ECO.kill);
    }
    victim.deathWallT = performance.now() / 1000;
    if (victim.hasBomb) {
      victim.hasBomb = false;
      S.bomb.state = 'ground';
      S.bomb.carrier = null;
      S.bomb.pos.copy(victim.pos);
      S.bomb.plantP = 0;
    }
    if (victim.isPlayer) S.scoped = false;
    const aColor = attacker && attacker.team === 'atk' ? '#ffb35c' : '#7fd8cb';
    S.feed.push({
      text: `${attacker ? attacker.name : '✸'} ▸ ${victim.name} — ${def.name}${headshot ? ' ⌖' : ''}`,
      t: S.time, color: aColor,
    });
    if (S.feed.length > 8) S.feed.shift();
  };

  let prevFiring = false;
  let fov = 74;

  function playerControl(dt) {
    const p = player;
    const keys = input.keys;
    const look = input.takeLook();
    const sens = S.scoped ? 0.00075 : 0.0021;
    p.yaw -= look.x * sens;
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - look.y * sens));

    if (!p.alive || S.phase === 'buy') return;
    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    let wx = (-sin * fwd + cos * strafe);
    let wz = (-cos * fwd - sin * strafe);
    const wl = Math.hypot(wx, wz) || 1;
    wx /= wl;
    wz /= wl;
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    stepBody(p, dt, {
      wishX: wx, wishZ: wz,
      speed: crouch ? 3.2 : walk ? 2.7 : 5.0,
      jump: input.pressed.has('Space'),
      crouch,
    }, COLLIDERS);

    // Weapon handling.
    const w = currentWeapon(p);
    if (input.pressed.has('Digit1') && p.primary) p.current = 'primary';
    if (input.pressed.has('Digit2')) p.current = 'sidearm';
    if (input.pressed.has('KeyR')) startReload(S, p);
    if (input.pressed.has('KeyG')) throwNade(S, p);
    S.inputPlant = keys.has('KeyE') && p.hasBomb;
    S.scoped = !!(input.aiming && w && w.def.zoom && !w.reloading);
    const firing = input.firing;
    const edge = firing && !prevFiring;
    prevFiring = firing;
    if (S.phase === 'live' && (firing && (w && w.def.auto) || edge)) {
      dirFromYawPitch(p.yaw + S.kick.yaw, p.pitch + S.kick.pitch, aimDir);
      tryFire(S, p, aimDir);
    }
    // Damage direction memory for the HUD.
    if (p.lastHurtFrom && S.time - p.lastHurtT < 0.05) {
      const a = p.lastHurtFrom;
      const alpha = Math.atan2(-(a.pos.x - p.pos.x), -(a.pos.z - p.pos.z));
      S.ui.dmgAngle = -(alpha - p.yaw);
      S.ui.dmgT = S.time;
    }
  }

  function buyKeys() {
    if (S.phase !== 'buy') return;
    if (input.pressed.has('KeyB')) S.ui.buyOpen = !S.ui.buyOpen;
    if (!S.ui.buyOpen) return;
    for (const item of BUY_ITEMS) {
      if (input.pressed.has(`Digit${item.key}`)) handleBuy(item);
    }
  }

  function handleBuy(item) {
    if (buyItem(S, player, item)) sfx.buy();
    else sfx.denied();
  }

  function step(dt) {
    S.dt = dt;
    S.time += dt;
    // Expire noise and feed.
    while (S.noise.length && S.time - S.noise[0].t > 3) S.noise.shift();
    while (S.feed.length && S.time - S.feed[0].t > 7) S.feed.shift();
    if (S.phase === 'buy' || S.phase === 'live' || S.phase === 'over') {
      playerControl(dt);
      buyKeys();
    } else {
      input.takeLook(); // drain, so the view does not jump when play resumes
    }
    if (S.phase === 'live') {
      for (const a of actors) if (a.brain) updateBot(S, a, dt);
    }
    if (S.phase === 'buy' || S.phase === 'live' || S.phase === 'over') {
      for (const a of actors) if (a.alive) updateWeapon(S, a);
      updateNades(S, dt);
      updateRounds(S, dt);
    }
    // Recoil recovery.
    S.kick.pitch *= Math.max(0, 1 - dt * 6.5);
    S.kick.yaw *= Math.max(0, 1 - dt * 6.5);
    input.clearPressed();
  }

  function spectateTarget() {
    for (const a of actors) if (a.team === 'atk' && a.brain && a.alive) return a;
    return null;
  }

  function render(dt) {
    world.update(dt, S.time);
    for (const a of actors) if (a.mesh) syncBotMesh(a, dt);
    // Bomb mesh follows its state.
    const bomb = S.bomb;
    if (bomb.state === 'ground' || bomb.state === 'planted') {
      bombMesh.visible = true;
      bombMesh.position.set(bomb.pos.x, bomb.pos.y, bomb.pos.z);
      const urgent = bomb.state === 'planted' && bomb.timer < 10;
      tell.material.color.setHex(Math.sin(S.time * (urgent ? 14 : 5)) > 0 ? 0xff2222 : 0x551111);
    } else if (bomb.state === 'carried' && bomb.carrier && !bomb.carrier.isPlayer) {
      bombMesh.visible = true;
      const c = bomb.carrier;
      bombMesh.position.set(c.pos.x + Math.sin(c.yaw) * 0.3, c.pos.y + 1.15, c.pos.z + Math.cos(c.yaw) * 0.3);
      tell.material.color.setHex(0x551111);
    } else bombMesh.visible = false;
    if (S.bombBoom) {
      S.bombBoom = false;
      fx.boomFX(bomb.pos);
      fx.shake(0.6);
    }

    // Camera.
    const p = player;
    if (S.phase === 'menu') {
      const t = performance.now() / 1000 * 0.05;
      camera.position.set(Math.sin(t) * 20, 10.5, Math.cos(t) * 20 - 4);
      camera.lookAt(-4, 0, -10);
      viewmodel.group.visible = false;
    } else if (p.alive) {
      viewmodel.group.visible = true;
      fx.takeShake(shakeV);
      camera.position.set(p.pos.x + shakeV.x, p.pos.y + p.eye + shakeV.y, p.pos.z);
      camera.rotation.set(p.pitch + S.kick.pitch, p.yaw + S.kick.yaw, 0, 'YXZ');
      const w = currentWeapon(p);
      if (w) {
        viewmodel.setWeapon(w.id);
        viewmodel.update(dt, p, w, S.scoped);
        S.ui.spreadPx = currentSpread(S, p, w) * 15;
      }
      const targetFov = S.scoped ? 24 : 74;
      fov += (targetFov - fov) * Math.min(1, dt * 14);
    } else {
      viewmodel.group.visible = false;
      const ally = spectateTarget();
      if (ally) {
        S.spectateName = ally.name;
        camera.position.set(ally.pos.x, ally.pos.y + ally.eye, ally.pos.z);
        camera.rotation.set(ally.pitch, ally.yaw, 0, 'YXZ');
      } else {
        S.spectateName = '';
        camera.position.set(p.pos.x, p.pos.y + 2.2, p.pos.z);
        camera.rotation.set(-0.4, p.yaw, 0, 'YXZ');
      }
      const targetFov = 74;
      fov += (targetFov - fov) * Math.min(1, dt * 10);
    }
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    fx.updateEffects(dt);
  }

  // --- Screenshot staging -----------------------------------------------------

  function actorByName(name) {
    return actors.find((a) => a.name === name);
  }

  function stageShot(name) {
    setSeed(7);
    newMatch(S);
    S.ui.buyOpen = false;
    S.ui.banner = null;
    if (name === 'buy') {
      player.money = 4600;
      player.primary = makeWeaponState('vk47');
      player.current = 'primary';
      player.armor = 1;
      S.phase = 'buy';
      S.phaseT = 9;
      S.ui.buyOpen = true;
      player.yaw = 0.35;
      return;
    }
    // A match in progress for the action shots.
    S.score.atk = 3;
    S.score.def = 2;
    S.round = 6;
    S.phase = 'live';
    S.roundT = 63;
    player.money = 2350;
    player.primary = makeWeaponState('vk47');
    player.current = 'primary';
    player.armor = 2;
    player.nades = 1;
    if (name === 'combat') {
      player.pos.set(-1.5, 0, 5);
      player.yaw = -0.31;
      player.pitch = -0.06;
      const hale = actorByName('Hale');
      hale.pos.set(1.2, 0, -3.5);
      hale.yaw = Math.PI + 0.3;
      hale.hp = 64;
      const pax = actorByName('Pax');
      pax.pos.set(-4.4, 0, 0.5);
      pax.yaw = 0.1;
      const voss = actorByName('Voss');
      voss.pos.set(6.5, 0, -9.5);
      voss.yaw = Math.PI - 0.4;
      S.feed.push(
        { text: 'Pax ▸ Mira — VK-47 Longline', t: S.time, color: '#ffb35c' },
        { text: 'Hale ▸ Rin — Rook-9 SMG', t: S.time, color: '#7fd8cb' },
      );
      // One live round downrange: tracer, flash, hitmarker.
      dirFromYawPitch(player.yaw, player.pitch, aimDir);
      tryFire(S, player, aimDir);
      S.ui.hitmarkT = S.time;
      return;
    }
    if (name === 'plant') {
      S.score.atk = 4;
      S.score.def = 3;
      S.round = 8;
      S.roundT = 41;
      player.money = 1150;
      player.hp = 82;
      // The player carries and is mid-plant on site A, covered by Pax,
      // with Mira pushing the defender hall.
      const carrier = S.bomb.carrier;
      if (carrier && carrier !== player) {
        carrier.hasBomb = false;
        player.hasBomb = true;
        S.bomb.carrier = player;
      }
      player.pos.set(-16.5, 0, -16.6);
      player.yaw = -Math.PI / 2;
      player.crouching = true;
      player.eye = 1.12;
      S.bomb.plantP = 0.62;
      const pax = actorByName('Pax');
      pax.pos.set(-12.6, 0, -15.6);
      pax.yaw = -Math.PI / 2 - 0.15;
      const mira = actorByName('Mira');
      mira.pos.set(-7.6, 0, -17.4);
      mira.yaw = Math.PI / 2;
      S.feed.push({ text: '⚠ Rin is down — 2 Wardens left', t: S.time, color: '#a89f92' });
      return;
    }
    // 'end': the round just closed on site B.
    S.score.atk = 6;
    S.score.def = 3;
    S.round = 10;
    player.money = 3900;
    player.hp = 47;
    player.pos.set(8.5, 0, -12.5);
    player.yaw = -0.62;
    player.pitch = -0.03;
    for (const [n, x, z] of [['Hale', 12.0, -19.0], ['Voss', 18.0, -23.0]]) {
      const bot = actorByName(n);
      bot.alive = false;
      bot.hp = 0;
      bot.pos.set(x, 0, z);
      bot.deathWallT = performance.now() / 1000 - 0.4;
    }
    S.feed.push(
      { text: 'YOU ▸ Hale — VK-47 Longline ⌖', t: S.time, color: '#ffb35c' },
      { text: 'YOU ▸ Voss — VK-47 Longline', t: S.time, color: '#ffb35c' },
      { text: 'Pax ▸ Mira — P9 Sidearm', t: S.time, color: '#ffb35c' },
    );
    S.phase = 'over';
    S.phaseT = 4;
    S.ui.banner = { title: 'ROUND WON', sub: 'Wardens eliminated — Kindlers take the round', t: S.time, color: '#ffb35c' };
  }

  scene.updateMatrixWorld(true);

  return {
    S,
    step,
    render,
    stageShot,
    handleBuy,
    startMatch() {
      setSeed((Date.now() & 0xffffff) + 11);
      newMatch(S);
    },
  };
}

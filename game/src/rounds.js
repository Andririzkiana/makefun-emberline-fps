// Rounds: the match state machine. Phases run menu -> buy (freeze, shop open) ->
// live -> over (banner, economy paid) -> next buy, until a team reaches firstTo
// round wins or the round cap is hit. The charge (bomb) lives here too: carried,
// dropped, planting as a channel, planted with a countdown, defused as a channel.

import * as THREE from 'three';
import { TIMING, ECO } from './config.js';
import { SPAWNS, SITES, siteAt } from './mapdata.js';
import { makeWeaponState, refillWeapon } from './weapons.js';
import { assignPlans } from './bots.js';
import { clearNades } from './nades.js';
import { sfx } from './audio.js';
import { pick, chance } from './rng.js';

export function createBomb() {
  return {
    state: 'idle', // carried | ground | planted | defused | exploded
    carrier: null, pos: new THREE.Vector3(),
    site: null, timer: 0, plantP: 0, defuseP: 0, beepAt: 0, hurtMark: -1,
  };
}

export function newMatch(S) {
  S.score.atk = 0;
  S.score.def = 0;
  S.round = 1;
  for (const a of S.actors) {
    a.money = ECO.start;
    a.primary = null;
    a.armor = 0;
    a.nades = 0;
    a.tools = false;
  }
  startRound(S);
}

export function startRound(S) {
  clearNades();
  S.feed.length = 0;
  S.noise.length = 0;
  const spawns = { atk: 0, def: 0 };
  for (const a of S.actors) {
    const spot = SPAWNS[a.team][spawns[a.team] % SPAWNS[a.team].length];
    spawns[a.team] += 1;
    const died = !a.alive;
    a.pos.set(spot[0], 0, spot[1]);
    a.vel.set(0, 0, 0);
    a.yaw = spot[2];
    a.pitch = 0;
    a.hp = 100;
    a.alive = true;
    a.deathT = -1;
    a.crouching = false;
    if (!a.sidearm) a.sidearm = makeWeaponState('p9');
    refillWeapon(a.sidearm);
    if (died) {
      a.primary = null;
      a.armor = 0;
      a.nades = 0;
      a.tools = false;
    } else if (a.primary) refillWeapon(a.primary);
    a.current = a.primary ? 'primary' : 'sidearm';
    a.hasBomb = false;
    if (a.brain) {
      a.brain.state = a.team === 'def' ? 'hold' : 'advance';
      a.brain.path = [];
      a.brain.see = null;
      a.brain.acquired = null;
      a.brain.investigate = null;
      a.brain.nadeUsed = false;
      a.brain.channeling = false;
    }
    if (a.mesh) {
      a.mesh.visible = true;
      a.mesh.rotation.set(0, a.yaw, 0);
    }
  }
  // The charge goes to a random Kindler; bots shop for themselves.
  const attackers = S.actors.filter((a) => a.team === 'atk');
  const carrier = pick(attackers);
  carrier.hasBomb = true;
  S.bomb.state = 'carried';
  S.bomb.carrier = carrier;
  S.bomb.site = null;
  S.bomb.plantP = 0;
  S.bomb.defuseP = 0;
  for (const a of S.actors) if (a.brain) botBuy(a);
  assignPlans(S);
  S.phase = 'buy';
  S.phaseT = TIMING.buy;
  S.roundT = TIMING.round;
  S.ui.buyOpen = true;
  S.ui.banner = { title: `ROUND ${S.round}`, sub: 'Buy phase — press B for the shop', t: S.time, color: '#f2ede4' };
}

// A bot's shopping: rifle when rich, SMG when not, armour with what is left.
function botBuy(a) {
  const tryBuy = (price) => {
    if (a.money < price) return false;
    a.money -= price;
    return true;
  };
  if (!a.primary && chance(0.85)) {
    if (a.money >= 2700 && tryBuy(2700)) a.primary = makeWeaponState('vk47');
    else if (a.money >= 1100 && tryBuy(1100)) a.primary = makeWeaponState('rook');
  }
  if (a.primary) a.current = 'primary';
  if (a.armor < 2 && a.money >= 1000 && chance(0.6) && tryBuy(1000)) a.armor = 2;
  else if (a.armor < 1 && a.money >= 650 && chance(0.6) && tryBuy(650)) a.armor = 1;
  if (a.nades < 1 && a.money >= 700 && chance(0.4) && tryBuy(300)) a.nades = 1;
}

// The player's shop, shared by the buy menu UI. Returns true when bought.
export function buyItem(S, a, item) {
  if (S.phase !== 'buy' || !a.alive) return false;
  if (a.money < item.price) return false;
  if (item.kind === 'weapon') {
    if (a.primary && a.primary.id === item.id) return false;
    a.primary = makeWeaponState(item.id);
    a.current = 'primary';
  } else if (item.kind === 'armor') {
    if (a.armor >= item.id) return false;
    a.armor = item.id;
  } else if (item.kind === 'nade') {
    if (a.nades >= 2) return false;
    a.nades += 1;
  } else if (item.kind === 'tools') {
    if (a.tools) return false;
    a.tools = true;
  }
  a.money -= item.price;
  return true;
}

function endRound(S, winner, reason) {
  if (S.phase === 'over' || S.phase === 'matchover') return;
  S.phase = 'over';
  S.phaseT = TIMING.roundEnd;
  S.score[winner] += 1;
  for (const a of S.actors) {
    a.money = Math.min(ECO.cap, a.money + (a.team === winner ? ECO.win : ECO.loss));
  }
  const playerWon = S.player.team === winner;
  S.ui.banner = {
    title: playerWon ? 'ROUND WON' : 'ROUND LOST',
    sub: `${reason} — ${winner === 'atk' ? 'Kindlers' : 'Wardens'} take the round`,
    t: S.time,
    color: playerWon ? '#ffb35c' : '#7fd8cb',
  };
  if (playerWon) sfx.roundWin();
  else sfx.roundLose();
  S.ui.buyOpen = false;
}

function aliveCount(S, team) {
  let n = 0;
  for (const a of S.actors) if (a.team === team && a.alive) n += 1;
  return n;
}

export function updateRounds(S, dt) {
  const bomb = S.bomb;
  if (S.phase === 'buy') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.phase = 'live';
      S.ui.buyOpen = false;
      S.ui.banner = { title: 'LIVE', sub: S.player.hasBomb ? 'You carry the charge — plant it on a site' : 'Eliminate the Wardens or plant the charge', t: S.time, color: '#f2ede4' };
    }
    return;
  }
  if (S.phase === 'over') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      const decided = S.score.atk >= TIMING.firstTo || S.score.def >= TIMING.firstTo || S.round >= TIMING.maxRounds;
      if (decided) {
        S.phase = 'matchover';
      } else {
        S.round += 1;
        startRound(S);
      }
    }
    return;
  }
  if (S.phase !== 'live') return;

  // Bomb pickup: any living Kindler walking over a dropped charge takes it.
  if (bomb.state === 'ground') {
    for (const a of S.actors) {
      if (a.team !== 'atk' || !a.alive) continue;
      if (Math.hypot(a.pos.x - bomb.pos.x, a.pos.z - bomb.pos.z) < 1.0) {
        a.hasBomb = true;
        bomb.state = 'carried';
        bomb.carrier = a;
        bomb.plantP = 0;
        break;
      }
    }
  }

  // Planting channel.
  if (bomb.state === 'carried' && bomb.carrier && bomb.carrier.alive) {
    const carrier = bomb.carrier;
    const site = siteAt(carrier.pos.x, carrier.pos.z);
    const channeling = carrier.isPlayer ? S.inputPlant : !!(carrier.brain && carrier.brain.channeling);
    const still = Math.hypot(carrier.vel.x, carrier.vel.z) < 1.1;
    if (site && channeling && still) {
      if (bomb.hurtMark !== carrier.lastHurtT) {
        bomb.hurtMark = carrier.lastHurtT;
        if (bomb.plantP > 0 && S.time - carrier.lastHurtT < 0.05) bomb.plantP = 0;
      }
      bomb.plantP += dt / (carrier.tools ? TIMING.plantTools : TIMING.plant);
      bomb.site = site.id;
      if (bomb.plantP >= 1) {
        bomb.state = 'planted';
        bomb.timer = TIMING.bomb;
        bomb.pos.copy(carrier.pos);
        carrier.hasBomb = false;
        bomb.carrier = null;
        carrier.money = Math.min(ECO.cap, carrier.money + ECO.plant);
        sfx.plantDone();
        S.ui.banner = { title: 'CHARGE PLANTED', sub: `Site ${site.id} — ${site.label}. Defend it.`, t: S.time, color: '#ffb35c' };
        S.feed.push({ text: `⚠ Charge planted on site ${site.id}`, t: S.time, color: '#ffb35c' });
      }
    } else {
      bomb.plantP = 0;
    }
  }

  // Planted: countdown, beeps, defuse channel, detonation.
  if (bomb.state === 'planted') {
    bomb.timer -= dt;
    const interval = bomb.timer < 10 ? 0.42 : 0.95;
    if (S.time >= bomb.beepAt) {
      bomb.beepAt = S.time + interval;
      sfx.beep(bomb.timer < 10);
    }
    let defuser = null;
    for (const a of S.actors) {
      if (a.team === 'def' && a.alive && a.brain && a.brain.channeling && a.brain.state === 'defuse') defuser = a;
    }
    if (defuser) {
      bomb.defuseP += dt / TIMING.defuse;
      if (Math.floor(bomb.defuseP * 8) !== Math.floor((bomb.defuseP - dt / TIMING.defuse) * 8)) sfx.defuseBeep();
      if (bomb.defuseP >= 1) {
        bomb.state = 'defused';
        defuser.money = Math.min(ECO.cap, defuser.money + ECO.defuse);
        endRound(S, 'def', 'Charge defused');
        return;
      }
    } else {
      bomb.defuseP = Math.max(0, bomb.defuseP - dt * 0.5);
    }
    if (bomb.timer <= 0) {
      bomb.state = 'exploded';
      S.bombBoom = true;
      endRound(S, 'atk', 'Charge detonated');
      return;
    }
  } else if (bomb.state !== 'planted') {
    S.roundT -= dt;
    if (S.roundT <= 0) {
      endRound(S, 'def', 'Time expired');
      return;
    }
  }

  // Elimination wins.
  const defAlive = aliveCount(S, 'def');
  const atkAlive = aliveCount(S, 'atk');
  if (defAlive === 0) {
    endRound(S, 'atk', 'Wardens eliminated');
  } else if (atkAlive === 0 && bomb.state !== 'planted') {
    endRound(S, 'def', 'Kindlers eliminated');
  }
}

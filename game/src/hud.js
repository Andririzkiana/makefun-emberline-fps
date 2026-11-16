// The HUD: plain DOM over the canvas, refreshed from the central state each frame
// with change-cached writes (text and classes only change when values do). Owns the
// top bar (timer, score), health/armour, money/ammo, killfeed, banners, the plant
// progress bar, the buy menu, the scope overlay and the menu/pause/end overlays.

import { BUY_ITEMS, TIMING } from './config.js';
import { currentWeapon } from './actors.js';

const $ = (id) => document.getElementById(id);

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function createHud(S, callbacks) {
  const el = {
    timer: $('timer'), scoreLine: $('score-line'), roundLabel: $('round-label'),
    hpNum: $('hp-num'), hpFill: $('hp-fill'), armor: $('armor'),
    money: $('money'), wepName: $('wep-name'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    nades: $('nades'), feed: $('feed'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    plantWrap: $('plantbar'), plantLabel: $('plant-label'), plantFill: $('plant-fill'),
    bombtag: $('bombtag'), carrytag: $('carrytag'), spectate: $('spectate'),
    hitmarker: $('hitmarker'), crosshair: $('crosshair'), scope: $('scope'),
    vignette: $('vignette'), dmgdir: $('dmgdir'),
    buy: $('buy'), buyItems: $('buy-items'), buyMoney: $('buy-money'),
    overlay: $('overlay'), ovTitle: $('ov-title'), ovCopy: $('ov-copy'), ovBtn: $('ov-btn'),
    hud: $('hud'),
  };

  // Buy menu rows, built once.
  const buyRows = BUY_ITEMS.map((item) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.label}</span><span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => callbacks.onBuy(item));
    el.buyItems.appendChild(row);
    return { item, row, price: row.querySelector('.buy-price') };
  });
  el.ovBtn.addEventListener('click', () => callbacks.onPlay());

  const cache = new Map();
  function setText(node, key, value) {
    if (cache.get(key) !== value) {
      cache.set(key, value);
      node.textContent = value;
    }
  }
  function setClass(node, key, cls, on) {
    const k = `${key}:${cls}`;
    if (cache.get(k) !== on) {
      cache.set(k, on);
      node.classList.toggle(cls, on);
    }
  }

  let bannerSeen = null;
  let bannerWallT = 0;

  function refresh(now) {
    const p = S.player;
    const w = currentWeapon(p);
    // Top bar.
    let timerText = '--:--';
    let timerHot = false;
    if (S.phase === 'buy') timerText = `BUY ${fmtTime(S.phaseT)}`;
    else if (S.phase === 'live') {
      if (S.bomb.state === 'planted') {
        timerText = fmtTime(S.bomb.timer);
        timerHot = true;
      } else timerText = fmtTime(S.roundT);
    }
    setText(el.timer, 'timer', timerText);
    setClass(el.timer, 'timer', 'hot', timerHot);
    setText(el.scoreLine, 'score', `KINDLERS ${S.score.atk} — ${S.score.def} WARDENS`);
    setText(el.roundLabel, 'round', S.phase === 'matchover' ? 'MATCH OVER' : `ROUND ${S.round} · FIRST TO ${TIMING.firstTo}`);

    // Player vitals and kit.
    setText(el.hpNum, 'hp', `${Math.ceil(p.hp)}`);
    const hpPct = `${Math.max(0, p.hp)}%`;
    if (cache.get('hpfill') !== hpPct) {
      cache.set('hpfill', hpPct);
      el.hpFill.style.width = hpPct;
    }
    setClass(el.hpFill, 'hpfill', 'low', p.hp <= 30);
    setText(el.armor, 'armor', p.armor === 2 ? 'VEST + HELMET' : p.armor === 1 ? 'VEST' : '');
    setText(el.money, 'money', `$${p.money}`);
    setText(el.wepName, 'wep', w ? w.def.name.toUpperCase() : '—');
    setText(el.ammoMag, 'mag', w ? `${w.mag}` : '0');
    setText(el.ammoReserve, 'res', w ? `/ ${w.reserve}` : '');
    setClass(el.ammoMag, 'mag', 'empty', !!w && w.mag === 0);
    setText(el.nades, 'nades', p.nades > 0 ? `FRAG ×${p.nades} — G` : '');

    // Bomb tags.
    const planted = S.bomb.state === 'planted';
    setClass(el.bombtag, 'bombtag', 'show', planted);
    if (planted) setText(el.bombtag, 'bombtagtext', `⚠ CHARGE PLANTED — SITE ${S.bomb.site}`);
    setClass(el.carrytag, 'carrytag', 'show', p.hasBomb && S.phase === 'live' && p.alive);
    setClass(el.spectate, 'spectate', 'show', !p.alive && (S.phase === 'live' || S.phase === 'buy'));
    if (!p.alive) setText(el.spectate, 'spectext', `ELIMINATED — SPECTATING ${S.spectateName || ''}`);

    // Plant / defuse progress.
    let prog = 0;
    let label = '';
    if (S.bomb.plantP > 0) {
      prog = S.bomb.plantP;
      label = 'PLANTING CHARGE…';
    } else if (planted && S.bomb.defuseP > 0) {
      prog = S.bomb.defuseP;
      label = 'A WARDEN IS DEFUSING!';
    }
    setClass(el.plantWrap, 'plant', 'show', prog > 0);
    if (prog > 0) {
      setText(el.plantLabel, 'plantlabel', label);
      el.plantFill.style.width = `${Math.round(prog * 100)}%`;
    }

    // Banner (identity changes when rounds.js posts a new one).
    if (S.ui.banner && S.ui.banner !== bannerSeen) {
      bannerSeen = S.ui.banner;
      bannerWallT = now;
      el.bannerTitle.textContent = S.ui.banner.title;
      el.bannerSub.textContent = S.ui.banner.sub;
      el.bannerTitle.style.color = S.ui.banner.color;
    }
    setClass(el.banner, 'banner', 'show', !!bannerSeen && now - bannerWallT < 2.8);

    // Hitmarker, damage direction, vignette, scope, crosshair spread.
    const hmAge = S.time - S.ui.hitmarkT;
    setClass(el.hitmarker, 'hm', 'on', hmAge < 0.16);
    setClass(el.hitmarker, 'hm', 'kill', S.ui.hitmarkKill && hmAge < 0.16);
    const hurtAge = S.time - (p.lastHurtT || -9);
    el.vignette.style.opacity = hurtAge < 0.5 ? `${0.55 * (1 - hurtAge / 0.5)}` : '0';
    if (S.ui.dmgAngle !== undefined && S.time - S.ui.dmgT < 0.9) {
      el.dmgdir.style.opacity = '1';
      el.dmgdir.style.transform = `translate(-50%, -50%) rotate(${S.ui.dmgAngle}rad)`;
    } else el.dmgdir.style.opacity = '0';
    setClass(el.scope, 'scope', 'show', !!S.scoped);
    el.crosshair.style.transform = `translate(-50%, -50%) scale(${1 + (S.ui.spreadPx || 0)})`;
    setClass(el.crosshair, 'ch', 'hide', !!S.scoped || !p.alive);

    // Killfeed: last five entries, fading with age.
    const entries = S.feed.slice(-5);
    const feedKey = entries.map((f) => f.text).join('|');
    if (cache.get('feed') !== feedKey) {
      cache.set('feed', feedKey);
      el.feed.innerHTML = entries
        .map((f) => `<div class="feed-line" style="color:${f.color || '#f2ede4'}">${f.text}</div>`)
        .join('');
    }

    // Buy menu.
    const buyShow = S.ui.buyOpen && S.phase === 'buy' && p.alive;
    setClass(el.buy, 'buy', 'show', buyShow);
    if (buyShow) {
      setText(el.buyMoney, 'buymoney', `$${p.money}`);
      for (const { item, row } of buyRows) {
        const owned = (item.kind === 'weapon' && p.primary && p.primary.id === item.id)
          || (item.kind === 'armor' && p.armor >= item.id)
          || (item.kind === 'nade' && p.nades >= 2)
          || (item.kind === 'tools' && p.tools);
        row.classList.toggle('owned', owned);
        row.classList.toggle('cant', !owned && p.money < item.price);
      }
    }
    setClass(el.hud, 'hud', 'dim', !p.alive && S.phase !== 'menu');
  }

  function setOverlay(mode, data) {
    if (!mode) {
      el.overlay.hidden = true;
      return;
    }
    el.overlay.hidden = false;
    if (mode === 'menu') {
      el.ovTitle.textContent = 'EMBERLINE';
      el.ovCopy.textContent = 'A round-based tactical FPS in the Foundry Yard. Plant the charge on Kiln or Depot — or stop the Wardens from defusing it. First to 7 rounds.';
      el.ovBtn.textContent = 'Deploy';
    } else if (mode === 'pause') {
      el.ovTitle.textContent = 'Paused';
      el.ovCopy.textContent = 'The round waits for no one — but this menu does. Click to jump back in.';
      el.ovBtn.textContent = 'Resume';
    } else if (mode === 'matchover') {
      el.ovTitle.textContent = data.title;
      el.ovCopy.textContent = data.copy;
      el.ovBtn.textContent = 'Play again';
    }
  }

  return { refresh, setOverlay };
}

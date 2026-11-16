// Boot and the frame loop: a fixed 60 Hz simulation (game.step) feeding renders at
// the display's rate. Owns the renderer, the pointer-lock overlays (menu, pause,
// match end) and the screenshot staging hook: ?shot=buy|combat|plant|end&seed=N
// poses a deterministic frame, renders it twice, then freezes with __shotReady set.

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { createInput } from './input.js';
import { createGame } from './game.js';
import { createHud } from './hud.js';
import { sfx } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 24, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);

let started = false;
let paused = false;
let overlayMode = 'menu';

const input = createInput(renderer.domElement, onLockChange);
const game = createGame(scene, camera, input);
const S = game.S;

const hud = createHud(S, {
  onPlay: () => {
    sfx.init();
    if (S.phase === 'menu' || S.phase === 'matchover') game.startMatch();
    started = true;
    paused = false;
    hud.setOverlay(null);
    overlayMode = null;
    input.requestLock();
  },
  onBuy: (item) => game.handleBuy(item),
});
hud.setOverlay('menu');

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    paused = false;
    if (overlayMode) {
      hud.setOverlay(null);
      overlayMode = null;
    }
  } else if (started && S.phase !== 'menu' && S.phase !== 'matchover') {
    paused = true;
    overlayMode = 'pause';
    hud.setOverlay('pause');
  }
}

let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      game.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  if (S.phase === 'matchover' && overlayMode !== 'matchover') {
    overlayMode = 'matchover';
    if (document.pointerLockElement) document.exitPointerLock();
    const won = S.score.atk > S.score.def;
    const drew = S.score.atk === S.score.def;
    hud.setOverlay('matchover', {
      title: drew ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT',
      copy: `Kindlers ${S.score.atk} — ${S.score.def} Wardens after ${S.round} rounds in the Foundry Yard.`,
    });
  }
  game.render(dt);
  hud.refresh(now / 1000);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) {
  hud.setOverlay(null);
  game.stageShot(shot);
  // A frozen clock for the HUD: staged banners and hitmarkers must not age out
  // while the (slow, software-rendered) capture paints its frames.
  const shotNow = performance.now() / 1000;
  let painted = 0;
  const paint = () => {
    requestAnimationFrame(paint);
    game.render(1 / 30);
    hud.refresh(shotNow);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) window.__shotReady = true;
  };
  requestAnimationFrame(paint);
} else {
  requestAnimationFrame(frame);
}

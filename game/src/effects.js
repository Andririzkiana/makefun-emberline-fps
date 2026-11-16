// Transient visuals, all pooled: tracers, impact bursts, muzzle flashes, the frag
// explosion and the planted charge's blink. Nothing here allocates per frame —
// pools are built once and recycled, and updates write into existing objects.

import * as THREE from 'three';
import { PALETTE } from './config.js';

const TRACERS = 28;
const PARTICLES = 420;

let scene = null;
let tracerPool = [];
let tracerI = 0;
let flashLight = null;
let flashSprite = null;
let flashT = 0;
let points = null;
let pGeo = null;
let pVel = null;
let pLife = null;
let pHead = 0;
let boomMesh = null;
let boomLight = null;
let boomT = 1e9;
let shakeAmt = 0;

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export function initEffects(s) {
  scene = s;
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACERS; i += 1) {
    const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
    m.visible = false;
    m.userData.life = 0;
    scene.add(m);
    tracerPool.push(m);
  }

  flashLight = new THREE.PointLight(0xffb35c, 0, 9, 2);
  scene.add(flashLight);
  const flashTex = makeFlashTexture();
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, color: 0xffcf8a, transparent: true, opacity: 0, depthWrite: false,
  }));
  flashSprite.scale.set(0.55, 0.55, 1);
  scene.add(flashSprite);

  pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(PARTICLES * 3);
  const col = new Float32Array(PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pVel = new Float32Array(PARTICLES * 3);
  pLife = new Float32Array(PARTICLES);
  points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);

  boomMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa03c, transparent: true, opacity: 0 }),
  );
  boomMesh.visible = false;
  scene.add(boomMesh);
  boomLight = new THREE.PointLight(0xff8c2e, 0, 22, 1.6);
  scene.add(boomLight);
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.4, 'rgba(255,170,70,0.75)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// A tracer streak from `from` to `to`.
export function tracer(from, to, friendly) {
  const m = tracerPool[tracerI];
  tracerI = (tracerI + 1) % TRACERS;
  tmpV.copy(to).sub(from);
  const len = tmpV.length();
  if (len < 0.5) return;
  m.position.copy(from).addScaledVector(tmpV, 0.5);
  m.scale.set(1, 1, len);
  m.lookAt(to);
  m.material.color.setHex(friendly ? 0xffc37a : 0x9fe8dc);
  m.material.opacity = 0.85;
  m.visible = true;
  m.userData.life = 0.055;
}

// Muzzle flash: a sprite + a short point light at the gun's mouth.
export function muzzle(pos) {
  flashSprite.position.copy(pos);
  flashSprite.material.opacity = 0.95;
  flashSprite.material.rotation = Math.random() * Math.PI;
  flashLight.position.copy(pos);
  flashLight.intensity = 14;
  flashT = 0.045;
}

// A burst of sparks/dust at an impact point. kind: 'wall' | 'body' | 'boom'.
export function impact(point, kind, n = 7) {
  const posAttr = pGeo.getAttribute('position');
  const colAttr = pGeo.getAttribute('color');
  const c = kind === 'body' ? [0.75, 0.16, 0.1] : kind === 'boom' ? [1, 0.55, 0.15] : [0.62, 0.58, 0.5];
  for (let k = 0; k < n; k += 1) {
    const i = pHead;
    pHead = (pHead + 1) % PARTICLES;
    posAttr.setXYZ(i, point.x, point.y, point.z);
    colAttr.setXYZ(i, c[0], c[1], c[2]);
    pVel[i * 3] = (Math.random() - 0.5) * 3.4;
    pVel[i * 3 + 1] = Math.random() * 3.2 + 0.6;
    pVel[i * 3 + 2] = (Math.random() - 0.5) * 3.4;
    pLife[i] = 0.35 + Math.random() * 0.3;
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

export function boomFX(point) {
  boomMesh.position.copy(point);
  boomMesh.visible = true;
  boomT = 0;
  boomLight.position.copy(point).y += 1;
  impact(point, 'boom', 46);
  shake(0.5);
}

export function shake(amount) {
  shakeAmt = Math.min(0.6, shakeAmt + amount);
}

// Consumed by the camera code each render: a decaying random offset.
export function takeShake(out) {
  if (shakeAmt <= 0.002) {
    out.set(0, 0, 0);
    return out;
  }
  out.set((Math.random() - 0.5) * shakeAmt * 0.14, (Math.random() - 0.5) * shakeAmt * 0.14, 0);
  shakeAmt *= 0.86;
  return out;
}

export function updateEffects(dt) {
  for (let i = 0; i < TRACERS; i += 1) {
    const m = tracerPool[i];
    if (!m.visible) continue;
    m.userData.life -= dt;
    if (m.userData.life <= 0) m.visible = false;
    else m.material.opacity = m.userData.life / 0.055 * 0.85;
  }
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) {
      flashLight.intensity = 0;
      flashSprite.material.opacity = 0;
    }
  }
  const posAttr = pGeo.getAttribute('position');
  let any = false;
  for (let i = 0; i < PARTICLES; i += 1) {
    if (pLife[i] <= 0) continue;
    any = true;
    pLife[i] -= dt;
    pVel[i * 3 + 1] -= 7.5 * dt;
    posAttr.setXYZ(
      i,
      posAttr.getX(i) + pVel[i * 3] * dt,
      Math.max(0.03, posAttr.getY(i) + pVel[i * 3 + 1] * dt),
      posAttr.getZ(i) + pVel[i * 3 + 2] * dt,
    );
    if (pLife[i] <= 0) posAttr.setY(i, -10);
  }
  if (any) posAttr.needsUpdate = true;
  if (boomT < 0.6) {
    boomT += dt;
    const k = boomT / 0.6;
    boomMesh.scale.setScalar(0.6 + k * 6.4);
    boomMesh.material.opacity = 0.75 * (1 - k);
    boomLight.intensity = 90 * (1 - k);
    if (boomT >= 0.6) boomMesh.visible = false;
  }
}

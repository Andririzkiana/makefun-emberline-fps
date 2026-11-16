// The world: builds Foundry Yard's meshes from mapdata, with canvas-generated
// textures (asphalt, concrete panels, crate timber, hazard paint), a low dusk sun
// with shadows, the glowing kiln on site A, and painted site markings. Returns the
// occluder meshes bullets test against — exactly the solid boxes of the map.

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { WALLS, CRATES, SITES } from './mapdata.js';

function canvasTexture(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function noiseOn(g, size, base, fleck, n) {
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i += 1) {
    g.fillStyle = fleck[Math.floor(Math.random() * fleck.length)];
    g.globalAlpha = 0.05 + Math.random() * 0.12;
    const s = 2 + Math.random() * 9;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  g.globalAlpha = 1;
}

export function createWorld(scene) {
  const groundTex = canvasTexture(512, (g, s) => {
    noiseOn(g, s, '#35302a', ['#2b2721', '#403a33', '#484239'], 2600);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s - 2);
  }, 14);
  const concreteTex = canvasTexture(512, (g, s) => {
    noiseOn(g, s, '#59524a', ['#4c463f', '#665e54', '#71685c'], 1500);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, 1);
  const crateTex = canvasTexture(256, (g, s) => {
    noiseOn(g, s, '#6e5636', ['#5d472c', '#7d6240'], 700);
    g.strokeStyle = 'rgba(30,20,10,0.8)';
    g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  }, 1);

  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95 }),
    slate: new THREE.MeshStandardMaterial({ map: concreteTex, color: 0x8fa3a8, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x4c4f52, roughness: 0.6, metalness: 0.55 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 }),
    container: new THREE.MeshStandardMaterial({ color: PALETTE.container, roughness: 0.75, metalness: 0.3 }),
    kiln: new THREE.MeshStandardMaterial({ color: 0x54423a, roughness: 0.85 }),
  };

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // One mesh per solid box; these are the bullet occluders.
  const occluders = [];
  const boxGeoCache = new Map();
  function boxGeo(w, h, d) {
    const key = `${w}|${h}|${d}`;
    if (!boxGeoCache.has(key)) boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
    return boxGeoCache.get(key);
  }
  function addBox(b) {
    const w = b.x2 - b.x1;
    const d = b.z2 - b.z1;
    const mesh = new THREE.Mesh(boxGeo(w, b.h, d), mats[b.mat] || mats.concrete);
    mesh.position.set(b.x1 + w / 2, b.h / 2, b.z1 + d / 2);
    mesh.castShadow = b.h > 1.2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    occluders.push(mesh);
    return mesh;
  }
  for (const b of WALLS) if (b.mat !== 'kiln') addBox(b);
  for (const b of CRATES) addBox(b);

  // The kiln: a riveted cylinder with a glowing mouth, plus its light.
  const kiln = new THREE.Group();
  const kilnBody = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 3.4, 18), mats.kiln);
  kilnBody.position.y = 1.7;
  kilnBody.castShadow = true;
  kiln.add(kilnBody);
  const mouth = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 20),
    new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: PALETTE.furnace, emissiveIntensity: 2.6 }),
  );
  mouth.position.set(0, 1.05, 1.83);
  kiln.add(mouth);
  const kilnLight = new THREE.PointLight(PALETTE.furnace, 30, 13, 1.8);
  kilnLight.position.set(0, 1.4, 2.6);
  kiln.add(kilnLight);
  kiln.position.set(-18, 0, -19);
  scene.add(kiln);
  occluders.push(kilnBody);
  kilnBody.updateMatrixWorld(true);
  // Raycast needs world matrices on the cylinder at its real spot.
  kilnBody.position.set(-18, 1.7, -19);
  kiln.remove(kilnBody);
  scene.add(kilnBody);

  // Painted site zones: a tinted pad and a big letter, flat on the ground.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(s.x2 - s.x1, s.z2 - s.z1),
      new THREE.MeshStandardMaterial({
        color: key === 'A' ? PALETTE.ember : PALETTE.warden,
        transparent: true, opacity: 0.1, roughness: 1,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(s.cx, 0.02, s.cz);
    scene.add(pad);
    const letterTex = canvasTexture(256, (g, sz) => {
      g.clearRect(0, 0, sz, sz);
      g.font = `700 190px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = key === 'A' ? 'rgba(255,122,38,0.5)' : 'rgba(53,184,166,0.5)';
      g.fillText(key, sz / 2, sz / 2 + 8);
    }, 1);
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ map: letterTex, transparent: true }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.cx, 0.03, s.cz);
    scene.add(letter);
  }

  // Distant smokestacks: silhouettes outside the fence for depth.
  const stackMat = new THREE.MeshStandardMaterial({ color: 0x2c2622, roughness: 1 });
  for (const [x, z, h] of [[-38, -36, 17], [34, -40, 21], [42, 6, 14], [-40, 14, 15]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, h, 10), stackMat);
    stack.position.set(x, h / 2, z);
    scene.add(stack);
  }

  // Lighting: dusk hemisphere, a low warm sun with shadows, site accents.
  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x241d18, 0.75));
  const sun = new THREE.DirectionalLight(0xffb070, 2.2);
  sun.position.set(-30, 26, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const depotLight = new THREE.PointLight(PALETTE.warden, 16, 14, 1.8);
  depotLight.position.set(17.5, 3.4, -19);
  scene.add(depotLight);

  let flickerT = 0;
  return {
    occluders,
    update(dt, t) {
      flickerT += dt;
      kilnLight.intensity = 27 + Math.sin(flickerT * 11) * 3 + Math.sin(flickerT * 23.7) * 2;
      mouth.material.emissiveIntensity = 2.4 + Math.sin(flickerT * 9.3) * 0.35;
    },
  };
}

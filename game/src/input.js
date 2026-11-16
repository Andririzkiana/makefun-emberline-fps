// Keyboard and mouse state for the player. Poll-based: the game reads `keys` (held),
// `pressed` (went down since the last step; the game clears it), accumulated mouse
// look deltas, and the two mouse buttons. Pointer lock is requested on the canvas.

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const look = { x: 0, y: 0 };
  let firing = false;
  let aiming = false;
  let locked = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    look.x += e.movementX || 0;
    look.y += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
    }
    onLockChange(locked);
  });

  return {
    keys,
    pressed,
    get firing() { return firing; },
    get aiming() { return aiming; },
    get locked() { return locked; },
    takeLook() {
      const out = { x: look.x, y: look.y };
      look.x = 0;
      look.y = 0;
      return out;
    },
    clearPressed() { pressed.clear(); },
    requestLock() {
      if (!locked) canvas.requestPointerLock();
    },
  };
}

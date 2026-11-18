
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_JUMP = 8;
export const ACTION_ATTACK = 32;

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp']);
const BACK_KEYS = new Set(['KeyS', 'ArrowDown']);
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const SPRINT_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const INTERACT_KEYS = new Set(['KeyF', 'KeyE']);
const JUMP_KEYS = new Set(['Space']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter']);

export function createInput(canvas) {
  const down = new Set();
  let actions = 0;
  let mouseDX = 0;
  let mouseDY = 0;

  function press(code) {
    if (INTERACT_KEYS.has(code)) actions |= ACTION_INTERACT;
    else if (JUMP_KEYS.has(code)) actions |= ACTION_JUMP | ACTION_HANDBRAKE;
    else if (PAUSE_KEYS.has(code)) actions |= ACTION_PAUSE;
    else if (CONFIRM_KEYS.has(code)) actions |= ACTION_CONFIRM;
  }

  function isMove(code) {
    return FORWARD_KEYS.has(code) || BACK_KEYS.has(code)
      || LEFT_KEYS.has(code) || RIGHT_KEYS.has(code);
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (isMove(event.code)) event.preventDefault();
      return;
    }
    down.add(event.code);
    press(event.code);
    if (isMove(event.code) || JUMP_KEYS.has(event.code) || INTERACT_KEYS.has(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    down.delete(event.code);
  });
  window.addEventListener('blur', () => {
    down.clear();
    mouseDX = 0;
    mouseDY = 0;
  });

  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas) {
      mouseDX += event.movementX || 0;
      mouseDY += event.movementY || 0;
    }
  });
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) actions |= ACTION_ATTACK;
  });

  function anyDown(set) {
    for (const code of set) if (down.has(code)) return true;
    return false;
  }

  return {
    /** Steering axes from WASD / arrows: forward +1 (W), strafe +1 (D). */
    axes: {
      get forward() {
        return (anyDown(FORWARD_KEYS) ? 1 : 0) - (anyDown(BACK_KEYS) ? 1 : 0);
      },
      get strafe() {
        return (anyDown(RIGHT_KEYS) ? 1 : 0) - (anyDown(LEFT_KEYS) ? 1 : 0);
      },
    },
    get sprint() {
      return anyDown(SPRINT_KEYS);
    },
    get mouseDX() {
      return mouseDX;
    },
    get mouseDY() {
      return mouseDY;
    },
    resetMouse() {
      mouseDX = 0;
      mouseDY = 0;
    },
    /** One-shot presses since the last call, as ACTION_* flags (consumed once). */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}

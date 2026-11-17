// Named input actions, separated from physical keys. Discrete actions are
// buffered: a press slightly before the action is legal still fires when it
// becomes legal (input-systems). Keyboard + mouse only.
export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  run: 'ShiftLeft', jump: 'Space', interact: 'KeyF', attack: 'Mouse0',
  aim: 'Mouse2', reload: 'KeyR', map: 'KeyM', pause: 'Escape',
  handbrake: 'Space',
};

export function createInput() {
  const input = {
    keys: new Set(),
    binds: { ...DEFAULT_BINDS },
    buffers: {},          // action -> performance.now() of last press
    mouseDX: 0, mouseDY: 0, wheel: 0,
    camYaw: Math.PI * 0.75, camPitch: 0.32, camDist: 9,
    locked: false, dragging: false,
    actions: { moveX: 0, moveY: 0, run: false, jump: false, interact: false, attack: false, aim: false, reload: false, map: false, pause: false, handbrake: false },
  };
  input.press = function press(action) { input.buffers[action] = performance.now(); };
  input.pressed = function pressed(action, windowMs = 220) {
    const t = input.buffers[action];
    if (t && performance.now() - t < windowMs) { delete input.buffers[action]; return true; }
    return false;
  };
  input.attach = function attach(canvas) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') e.preventDefault();
      if (!e.repeat) {
        input.keys.add(e.code);
        for (const [action, code] of Object.entries(input.binds)) {
          if (code === e.code) input.press(action);
        }
      }
    });
    window.addEventListener('keyup', (e) => input.keys.delete(e.code));
    window.addEventListener('blur', () => input.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) input.press('attack');
      if (e.button === 2) input.keys.add('Mouse2');
      input.dragging = true;
      if (canvas.requestPointerLock) canvas.requestPointerLock();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) input.keys.delete('Mouse2');
      input.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        input.mouseDX += e.movementX; input.mouseDY += e.movementY;
      } else if (input.dragging) {
        input.mouseDX += e.movementX; input.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { input.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      input.locked = document.pointerLockElement === canvas;
    });
  };
  input.update = function update(settings) {
    const k = input.keys, b = input.binds;
    const sens = 0.0028 * (settings?.sensitivity ?? 1);
    input.camYaw -= input.mouseDX * sens;
    input.camPitch += input.mouseDY * sens * (settings?.invertY ? -1 : 1);
    input.camPitch = Math.max(-0.15, Math.min(1.1, input.camPitch));
    input.mouseDX = 0; input.mouseDY = 0;
    if (input.wheel !== 0) {
      input.camDist = Math.max(5, Math.min(16, input.camDist + input.wheel * 0.005));
      input.wheel = 0;
    }
    const a = input.actions;
    a.moveX = (k.has(b.right) ? 1 : 0) - (k.has(b.left) ? 1 : 0);
    a.moveY = (k.has(b.forward) ? 1 : 0) - (k.has(b.back) ? 1 : 0);
    a.run = k.has(b.run);
    a.aim = k.has(b.aim);
    a.handbrake = k.has(b.handbrake);
    a.jump = input.pressed('jump');
    a.interact = input.pressed('interact');
    a.attack = input.pressed('attack');
    a.reload = input.pressed('reload');
    a.map = input.pressed('map');
    a.pause = input.pressed('pause');
  };
  return input;
}

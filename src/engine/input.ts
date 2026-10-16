/** Frame-independent input bridge shared between React UI, keyboard, and the Babylon scene. */
export interface InputState {
  /** Normalized move vector: x = strafe (-1..1), y = forward (-1..1). */
  moveX: number;
  moveY: number;
  /** Edge-triggered — set by UI/keyboard, consumed (reset) by the controller. */
  jumpPressed: boolean;
  /** Held state, used for crouch / higher ollie. */
  jumpHeld: boolean;
}

export const gameInput: InputState = { moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false };

const keys = new Set<string>();

function recomputeFromKeys() {
  const left = keys.has("a") || keys.has("arrowleft");
  const right = keys.has("d") || keys.has("arrowright");
  const up = keys.has("w") || keys.has("arrowup");
  const down = keys.has("s") || keys.has("arrowdown");
  if (left || right || up || down) {
    gameInput.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    gameInput.moveY = (up ? 1 : 0) - (down ? 1 : 0);
  } else if (!joystickActive) {
    gameInput.moveX = 0;
    gameInput.moveY = 0;
  }
}

let joystickActive = false;
export function setJoystick(x: number, y: number, active: boolean) {
  joystickActive = active;
  if (active) {
    gameInput.moveX = x;
    gameInput.moveY = y;
  } else {
    recomputeFromKeys();
  }
}

export function pressJump() {
  gameInput.jumpPressed = true;
  gameInput.jumpHeld = true;
}
export function releaseJump() {
  gameInput.jumpHeld = false;
}

let attached = false;
export function attachKeyboard() {
  if (attached || typeof window === "undefined") return () => {};
  attached = true;
  const onDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (k === " ") {
      if (!gameInput.jumpHeld) pressJump();
      return;
    }
    keys.add(k);
    recomputeFromKeys();
  };
  const onUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === " ") {
      releaseJump();
      return;
    }
    keys.delete(k);
    recomputeFromKeys();
  };
  const onBlur = () => {
    keys.clear();
    releaseJump();
    recomputeFromKeys();
  };
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onDown);
    window.removeEventListener("keyup", onUp);
    window.removeEventListener("blur", onBlur);
    attached = false;
  };
}

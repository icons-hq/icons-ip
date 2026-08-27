export type HyosanAction = 'attack' | 'skill' | 'dash';

export interface HyosanActionPresses {
  attackPressed: boolean;
  skillPressed: boolean;
  dashPressed: boolean;
}

export interface HyosanMobileInputBridge {
  setMovement(x: number, y: number): void;
  getMovement(): Readonly<{ x: number; y: number }>;
  press(action: HyosanAction): void;
  consumePresses(): HyosanActionPresses;
  reset(): void;
}

export function createHyosanMobileInputBridge(): HyosanMobileInputBridge {
  const movement = { x: 0, y: 0 };
  const presses: HyosanActionPresses = {
    attackPressed: false,
    skillPressed: false,
    dashPressed: false,
  };

  return {
    setMovement(x, y) {
      const length = Math.hypot(x, y);
      const scale = length > 1 ? 1 / length : 1;
      movement.x = x * scale;
      movement.y = y * scale;
    },

    getMovement() {
      return { ...movement };
    },

    press(action) {
      presses[`${action}Pressed`] = true;
    },

    consumePresses() {
      const consumed = { ...presses };
      presses.attackPressed = false;
      presses.skillPressed = false;
      presses.dashPressed = false;
      return consumed;
    },

    reset() {
      movement.x = 0;
      movement.y = 0;
      presses.attackPressed = false;
      presses.skillPressed = false;
      presses.dashPressed = false;
    },
  };
}

import type { GameSession } from "../game/GameSession";
import type { Direction } from "../simulation/types";

const DIRECTION_KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  ArrowLeft: "out",
  KeyA: "out",
  ArrowRight: "in",
  KeyD: "in",
};

const HELD_MOVE_REPEAT_MS = 110;

export class InputController {
  private readonly session: GameSession;
  private enabled = true;
  private lastRepeatedMoveAtMs = -Infinity;
  private readonly pressedDirectionKeys = new Set<string>();

  constructor(session: GameSession) {
    this.session = session;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp, { passive: false });
    window.addEventListener("blur", this.onWindowBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pressedDirectionKeys.clear();
      this.session.dispatch({ type: "interact-up" });
    }
  }

  move(direction: Direction): void {
    if (!this.enabled) return;
    this.session.dispatch({ type: "move", direction });
  }

  interactDown(): void {
    if (!this.enabled) return;
    this.session.dispatch({ type: "interact-down" });
  }

  interactUp(): void {
    this.session.dispatch({ type: "interact-up" });
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select")) return;

    const direction = DIRECTION_KEYS[event.code];
    if (direction) {
      event.preventDefault();
      const now = performance.now();
      const alreadyPressed = this.pressedDirectionKeys.has(event.code);
      this.pressedDirectionKeys.add(event.code);
      if (!alreadyPressed || now - this.lastRepeatedMoveAtMs >= HELD_MOVE_REPEAT_MS) {
        this.lastRepeatedMoveAtMs = now;
        this.move(direction);
      }
      return;
    }

    if ((event.code === "Space" || event.code === "KeyE") && !event.repeat) {
      event.preventDefault();
      this.interactDown();
    } else if ((event.code === "Escape" || event.code === "KeyP") && !event.repeat) {
      event.preventDefault();
      this.session.dispatch({ type: "pause-toggle" });
    } else if (event.code === "KeyR" && !event.repeat) {
      this.session.restart();
      this.session.dispatch({ type: "start" });
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (DIRECTION_KEYS[event.code]) this.pressedDirectionKeys.delete(event.code);
    if (event.code === "Space" || event.code === "KeyE") {
      event.preventDefault();
      this.interactUp();
    }
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) this.pressedDirectionKeys.clear();
    if (document.hidden && this.session.getState().phase === "running") {
      this.session.dispatch({ type: "pause-toggle" });
    }
  };

  private onWindowBlur = (): void => {
    this.pressedDirectionKeys.clear();
    this.session.dispatch({ type: "interact-up" });
  };
}

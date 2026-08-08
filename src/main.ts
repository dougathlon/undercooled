import Phaser from "phaser";
import { GameSession } from "./game/GameSession";
import { PHASER_CONFIG, UndercooledScene } from "./game/UndercooledScene";
import { InputController } from "./input/InputController";
import { replay as simulateReplay } from "./simulation/simulation";
import type { GameState, SimulationCommand } from "./simulation/types";
import { GameUI } from "./ui/GameUI";
import "./styles.css";

interface ReplayCommand {
  atMs: number;
  command: SimulationCommand;
}

interface ReplayDump {
  format: "undercooled-replay-v2";
  levelId: number;
  seed: number;
  commands: ReplayCommand[];
  terminalState: GameState;
}

interface UndercooledDebugApi {
  selectLevel: (levelId: number) => GameState;
  startLevel: (levelId?: number) => GameState;
  state: () => GameState;
  grantJobs: (jobs?: number) => GameState;
  setHeat: (load: number) => GameState;
  dispatch: (command: SimulationCommand) => GameState;
  dumpState: () => string;
  dumpReplay: () => string;
  runReplay: (levelId: number, seed: number, log: ReplayCommand[]) => GameState;
}

declare global {
  interface Window {
    __UNDERCOOLED__: UndercooledDebugApi;
    undercooledDebug: UndercooledDebugApi;
  }
}

class RecordingGameSession extends GameSession {
  private commandLog: ReplayCommand[] = [];

  override selectLevel(levelId: number): void {
    super.selectLevel(levelId);
    this.commandLog = [];
  }

  override restart(): void {
    super.restart();
    this.commandLog = [];
  }

  override dispatch(command: SimulationCommand): void {
    this.commandLog.push({
      atMs: this.getState().simTimeMs,
      command: structuredClone(command),
    });
    super.dispatch(command);
  }

  dumpReplay(): ReplayDump {
    const state = JSON.parse(this.dump()) as GameState;
    return {
      format: "undercooled-replay-v2",
      levelId: state.level.id,
      seed: state.manifest.seed,
      commands: structuredClone(this.commandLog),
      terminalState: state,
    };
  }
}

const gameRoot = document.querySelector<HTMLElement>("#game-root");
const uiRoot = document.querySelector<HTMLElement>("#ui-root");
if (!gameRoot || !uiRoot) throw new Error("Undercooled requires #game-root and #ui-root containers.");

const session = new RecordingGameSession(1);
const input = new InputController(session);
const scene = new UndercooledScene(session);
const game = new Phaser.Game({
  ...PHASER_CONFIG,
  scene: [scene],
});
const ui = new GameUI(uiRoot, session, input);

function stateSnapshot(): GameState {
  return JSON.parse(session.dump()) as GameState;
}

const debugApi: UndercooledDebugApi = {
  selectLevel(levelId) {
    ui.showBriefing(levelId);
    return stateSnapshot();
  },
  startLevel(levelId) {
    if (levelId !== undefined) ui.showBriefing(levelId);
    ui.startCurrentLevel();
    return stateSnapshot();
  },
  state: stateSnapshot,
  grantJobs(jobs) {
    session.debugGrantJobs(jobs);
    return stateSnapshot();
  },
  setHeat(load) {
    session.debugHeat(load);
    return stateSnapshot();
  },
  dispatch(command) {
    session.dispatch(command);
    return stateSnapshot();
  },
  dumpState() {
    return session.dump();
  },
  dumpReplay() {
    return JSON.stringify(session.dumpReplay(), null, 2);
  },
  runReplay(levelId, seed, log) {
    return simulateReplay(levelId, seed, log);
  },
};

window.__UNDERCOOLED__ = debugApi;
window.undercooledDebug = debugApi;

window.addEventListener("resize", () => game.scale.refresh(), { passive: true });

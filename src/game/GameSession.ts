import { LEVELS } from "../simulation/levels";
import {
  advanceSimulation,
  createGameState,
  debugGrantAcceptedJobs,
  debugSetHeat,
  dispatchCommand,
  loadHardwareManifest,
  serializeState,
} from "../simulation/simulation";
import type { ImportedManifestBundle } from "../simulation/manifest";
import type { GameState, SimulationCommand } from "../simulation/types";

export type StateListener = (state: GameState) => void;

export class GameSession {
  private state: GameState;
  private listeners = new Set<StateListener>();
  private lastNotifiedAt = 0;

  constructor(levelId = 1) {
    this.state = createGameState(levelId);
  }

  getState(): GameState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  selectLevel(levelId: number): void {
    if (!LEVELS.some((level) => level.id === levelId)) return;
    this.state = createGameState(levelId);
    this.notify(true);
  }

  restart(): void {
    const seed = this.state.manifest.seed;
    this.state = createGameState(this.state.level.id, seed);
    this.notify(true);
  }

  nextLevel(): void {
    this.selectLevel(Math.min(LEVELS.length, this.state.level.id + 1));
  }

  dispatch(command: SimulationCommand): void {
    dispatchCommand(this.state, command);
    this.notify(true);
  }

  tick(deltaMs: number): void {
    advanceSimulation(this.state, deltaMs);
    this.notify(false);
  }

  importHardwareManifest(bundle: ImportedManifestBundle): void {
    loadHardwareManifest(this.state, bundle);
    this.notify(true);
  }

  debugGrantJobs(jobs = this.state.level.targetJobs): void {
    debugGrantAcceptedJobs(this.state, jobs);
    this.notify(true);
  }

  debugHeat(load: number): void {
    debugSetHeat(this.state, load);
    this.notify(true);
  }

  dump(): string {
    return serializeState(this.state);
  }

  private notify(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastNotifiedAt < 80) return;
    this.lastNotifiedAt = now;
    for (const listener of this.listeners) listener(this.state);
  }
}

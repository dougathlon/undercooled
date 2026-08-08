import {
  PREP_POSITION,
  PULSE_POSITION,
  READOUT_POSITION,
  SUPPLY_POSITIONS,
} from "../../src/simulation/geometry";
import { advanceSimulation, dispatchCommand } from "../../src/simulation/simulation";
import type { Direction, GameState, GridPosition, LaneId } from "../../src/simulation/types";

export function start(state: GameState): GameState {
  dispatchCommand(state, { type: "start" });
  return state;
}

export function pressInteract(state: GameState): void {
  dispatchCommand(state, { type: "interact-down" });
  dispatchCommand(state, { type: "interact-up" });
}

export function holdInteract(state: GameState, durationMs: number): void {
  dispatchCommand(state, { type: "interact-down" });
  advanceFor(state, durationMs);
  dispatchCommand(state, { type: "interact-up" });
}

export function advanceFor(state: GameState, durationMs: number, stepMs = 50): void {
  let remaining = durationMs;
  while (remaining > 0 && state.phase === "running") {
    const step = Math.min(stepMs, remaining);
    advanceSimulation(state, step);
    remaining -= step;
  }
}

export function placeLane(
  state: GameState,
  laneId: LaneId,
  position: GridPosition,
  facing: Direction,
): void {
  state.lanes[laneId].actor.position = { ...position };
  state.lanes[laneId].actor.facing = facing;
  state.lanes[laneId].actor.lastMoveAtMs = state.simTimeMs - 1_000;
}

export function placeBoth(state: GameState, position: GridPosition, facing: Direction): void {
  placeLane(state, "A", position, facing);
  placeLane(state, "B", position, facing);
}

export function acceptAndPrepare(state: GameState): void {
  placeBoth(state, READOUT_POSITION, "up");
  pressInteract(state);
  placeBoth(state, PREP_POSITION, "up");
  holdInteract(state, state.level.heat.preparationHoldMs + 100);
}

export function collectExpectedPulse(state: GameState, laneId: LaneId): void {
  const expected = state.currentJob.definition.pulses[laneId][state.lanes[laneId].job.loadedPulses.length];
  placeLane(state, laneId, SUPPLY_POSITIONS[expected], "out");
}

export function collectAndInstallNextPulses(state: GameState): void {
  for (const laneId of ["A", "B"] as const) collectExpectedPulse(state, laneId);
  pressInteract(state);
  placeBoth(state, PULSE_POSITION, "up");
  pressInteract(state);
}

import { describe, expect, it } from "vitest";

import { advanceSimulation, createGameState, dispatchCommand } from "../../src/simulation/simulation";
import type { Direction, GameState } from "../../src/simulation/types";

function move(state: GameState, direction: Direction, count = 1): void {
  for (let index = 0; index < count; index += 1) {
    dispatchCommand(state, { type: "move", direction });
  }
}

function act(state: GameState): void {
  dispatchCommand(state, { type: "interact-down" });
  dispatchCommand(state, { type: "interact-up" });
}

function holdUntilPrepared(state: GameState): void {
  dispatchCommand(state, { type: "interact-down" });
  while (state.currentJob.stage === "prepare" && state.phase === "running") {
    advanceSimulation(state, 50);
  }
  dispatchCommand(state, { type: "interact-up" });
}

function matchedFrontHalf(state: GameState): void {
  act(state);
  move(state, "out", 3);
  holdUntilPrepared(state);
  move(state, "out");
  act(state);
  expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("pulse-H");
  expect(state.items[state.lanes.B.actor.heldItemId ?? ""]?.kind).toBe("pulse-H");
  expect(state.lanes.A.actor.position).toEqual(state.lanes.B.actor.position);
  move(state, "in", 2);
  act(state);
}

function finishFromPulse(state: GameState): void {
  expect(state.currentJob.stage).toBe("canister");
  move(state, "out", 2);
  move(state, "down", 3);
  act(state);
  finishFromAuxWithCanister(state);
}

function finishFromAuxWithCanister(state: GameState): void {
  move(state, "up", 3);
  move(state, "in", 4);
  act(state);
  expect(state.currentJob.stage).toBe("run");
  for (let attempt = 0; attempt < 4 && state.currentJob.stage === "run"; attempt += 1) {
    act(state);
  }
  expect(state.currentJob.stage).toBe("submission");
  act(state);
  move(state, "out", 4);
  act(state);
  expect(state.currentJob.stage).toBe("reset");
  move(state, "in", 4);
  act(state);
}

function expectCompletedCycle(state: GameState): void {
  expect(state).toMatchObject({
    phase: "complete",
    score: { acceptedJobs: 1, validShots: 1 },
  });
  expect(state.events.some((event) => event.type === "processor-reset")).toBe(true);
}

describe("four complete keyboard-routed demo cycles", () => {
  it.each([1, 2])("runs scene %i from acceptance through reset", (levelId) => {
    const state = createGameState(levelId);
    dispatchCommand(state, { type: "start" });
    matchedFrontHalf(state);
    finishFromPulse(state);
    expectCompletedCycle(state);
  });

  it("runs the protected scene through recovery, resynchronization, and reset", () => {
    const state = createGameState(3);
    dispatchCommand(state, { type: "start" });
    matchedFrontHalf(state);
    expect(state.currentJob.stage).toBe("load");
    expect(state.score.recoveries).toBe(0);

    move(state, "down");
    act(state);
    move(state, "up");
    act(state);
    expect(state.currentJob.stage).toBe("canister");

    move(state, "down", 2);
    move(state, "up");
    expect(state.lanes.A.actor.position).not.toEqual(state.lanes.B.actor.position);
    move(state, "up", 3);
    expect(state.lanes.A.actor.position).toEqual(state.lanes.B.actor.position);

    finishFromPulse(state);
    expectCompletedCycle(state);
    expect(state.events.filter((event) => event.type === "missed-step" && event.lane === "B")).toHaveLength(2);
    expect(state.events.filter((event) => event.type === "fumble" && event.lane === "B")).toHaveLength(2);
  });

  it("runs the joint scene through repeated recoveries, physical cooling, and reset", () => {
    const state = createGameState(4);
    dispatchCommand(state, { type: "start" });
    matchedFrontHalf(state);
    expect(state.currentJob.stage).toBe("load");

    move(state, "down");
    act(state);
    move(state, "up");
    act(state);
    expect(state.currentJob.stage).toBe("couple-install");

    move(state, "out", 2);
    move(state, "down", 3);
    act(state);
    move(state, "up", 3);
    move(state, "in", 3);
    act(state);
    move(state, "down");
    act(state);
    move(state, "up");
    act(state);
    expect(state.currentJob.stage).toBe("couple-install");
    expect(state.lanes.A.job.couplingInstalled).toBe(false);
    expect(state.lanes.B.job.couplingInstalled).toBe(true);
    move(state, "down");
    act(state);
    move(state, "up");
    act(state);
    act(state);
    expect(state.currentJob.stage).toBe("canister");

    move(state, "out", 2);
    move(state, "down", 3);
    act(state);
    expect(state.lanes.A.actor.position).not.toEqual(state.lanes.B.actor.position);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("cryo-lance");
    expect(state.lanes.B.actor.heldItemId).toBeNull();
    move(state, "down");
    expect(state.lanes.A.actor.position).toEqual(state.lanes.B.actor.position);
    act(state);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("cryo-lance");
    expect(state.items[state.lanes.B.actor.heldItemId ?? ""]?.kind).toBe("cryo-lance");
    move(state, "in", 3);
    move(state, "up", 2);
    dispatchCommand(state, { type: "interact-down" });
    for (let index = 0; index < 100 && state.cooling.hotspots.some((hotspot) => hotspot.active); index += 1) {
      advanceSimulation(state, 50);
    }
    dispatchCommand(state, { type: "interact-up" });
    expect(state.cooling.hotspots.every((hotspot) => !hotspot.active)).toBe(true);

    move(state, "down", 2);
    move(state, "out", 3);
    act(state);
    expect(state.lanes.A.actor.heldItemId).toBeNull();
    expect(state.lanes.B.actor.heldItemId).toBeNull();
    move(state, "out");
    act(state);
    finishFromAuxWithCanister(state);
    expectCompletedCycle(state);
    expect(state.events.some((event) => event.type === "fumble" && event.lane === "A")).toBe(true);
    expect(state.events.some((event) => event.type === "fumble" && event.lane === "B")).toBe(true);
    expect(state.events.filter((event) => event.type === "fumble")).toHaveLength(5);
    expect(state.events.filter((event) => event.type === "missed-step" && event.lane === "B")).toHaveLength(1);
    expect(state.score.recoveries).toBe(4);
    expect(state.cooling.completedServices).toBeGreaterThanOrEqual(2);
  });
});

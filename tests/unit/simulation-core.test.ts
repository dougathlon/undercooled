import { describe, expect, it } from "vitest";

import {
  MOVEMENT_RISK_POSITION,
  READOUT_POSITION,
  gridToWorld,
  movementRiskAddress,
} from "../../src/simulation/geometry";
import {
  createGameState,
  dispatchCommand,
  replay,
  serializeState,
} from "../../src/simulation/simulation";
import type { SimulationCommand } from "../../src/simulation/types";
import { advanceFor, placeBoth, start } from "./test-helpers";

describe("deterministic v2 simulation", () => {
  it("replays timestamped semantic commands to an identical state", () => {
    const log: Array<{ atMs: number; command: SimulationCommand }> = [
      { atMs: 0, command: { type: "start" } },
      { atMs: 0, command: { type: "move", direction: "out" } },
      { atMs: 200, command: { type: "move", direction: "out" } },
      { atMs: 400, command: { type: "move", direction: "down" } },
      { atMs: 600, command: { type: "move", direction: "down" } },
      { atMs: 800, command: { type: "move", direction: "up" } },
    ];
    const first = replay(3, 867_5309, log);
    const second = replay(3, 867_5309, log);
    const address = movementRiskAddress(3, MOVEMENT_RISK_POSITION);

    expect(serializeState(first)).toBe(serializeState(second));
    expect(first.manifest.riskStreams[address].cursor).toBe(1);
    expect(first.events.some((event) => event.type === "risk-consumed")).toBe(true);
  });

  it("replays a preparation hold spanning more than the simulation delta cap", () => {
    const log: Array<{ atMs: number; command: SimulationCommand }> = [
      { atMs: 0, command: { type: "start" } },
      { atMs: 0, command: { type: "interact-down" } },
      { atMs: 10, command: { type: "interact-up" } },
      { atMs: 200, command: { type: "move", direction: "out" } },
      { atMs: 400, command: { type: "move", direction: "out" } },
      { atMs: 600, command: { type: "move", direction: "out" } },
      { atMs: 800, command: { type: "move", direction: "up" } },
      { atMs: 1_000, command: { type: "interact-down" } },
      { atMs: 2_500, command: { type: "interact-up" } },
    ];
    const state = replay(1, 5050, log);
    expect(state.currentJob.stage).toBe("load");
    expect(state.lanes.A.job.prepared).toBe(true);
    expect(state.lanes.B.job.prepared).toBe(true);
  });

  it("uses mirrored IN/OUT semantics while resolving physical end stops locally", () => {
    const state = start(createGameState(1));
    placeBoth(state, { x: 2, y: 2 }, "in");
    dispatchCommand(state, { type: "move", direction: "in" });
    expect(state.lanes.A.actor.position).toEqual({ x: 3, y: 2 });
    expect(state.lanes.B.actor.position).toEqual({ x: 3, y: 2 });
    expect(gridToWorld("A", state.lanes.A.actor.position).x).toBeLessThan(
      gridToWorld("B", state.lanes.B.actor.position).x,
    );

    state.lanes.A.actor.position = { x: 4, y: 2 };
    state.lanes.B.actor.position = { x: 3, y: 2 };
    state.simTimeMs += 200;
    dispatchCommand(state, { type: "move", direction: "in" });
    expect(state.lanes.A.actor.position).toEqual({ x: 4, y: 2 });
    expect(state.lanes.B.actor.position).toEqual({ x: 4, y: 2 });
    expect(state.events.some((event) => event.type === "local-collision" && event.lane === "A")).toBe(true);
  });

  it("consumes movement risk on every eligible departure, not once per tile", () => {
    const state = start(createGameState(3, 1234));
    const address = movementRiskAddress(3, MOVEMENT_RISK_POSITION);
    state.manifest.riskStreams[address].records[0].bits = [0, 0];
    state.manifest.riskStreams[address].records[1].bits = [0, 0];

    placeBoth(state, MOVEMENT_RISK_POSITION, "out");
    dispatchCommand(state, { type: "move", direction: "out" });
    placeBoth(state, MOVEMENT_RISK_POSITION, "in");
    state.simTimeMs += 200;
    dispatchCommand(state, { type: "move", direction: "in" });

    expect(state.manifest.riskStreams[address].cursor).toBe(2);
    expect(state.events.filter((event) => event.type === "risk-consumed")).toHaveLength(2);
  });

  it("keeps each movement square on an independent coordinate-bound cursor", () => {
    const state = start(createGameState(3, 1234));
    const tiles = state.level.features.movementRiskTiles ?? [];
    const addresses = tiles.map((tile) => movementRiskAddress(3, tile.position));
    for (const address of addresses) state.manifest.riskStreams[address].records[0].bits = [0, 0];

    placeBoth(state, tiles[0].position, "up");
    dispatchCommand(state, { type: "move", direction: "up" });
    placeBoth(state, tiles[1].position, "up");
    dispatchCommand(state, { type: "move", direction: "up" });

    expect(addresses.map((address) => state.manifest.riskStreams[address].cursor)).toEqual([1, 1, 0]);
  });

  it("keeps a no-op readout press from consuming either manifest stream", () => {
    const state = start(createGameState(1));
    placeBoth(state, READOUT_POSITION, "up");
    const before = structuredClone(state.manifest);
    dispatchCommand(state, { type: "interact-down" });
    dispatchCommand(state, { type: "interact-up" });
    // The press accepts the job but is not a risk or shot trigger.
    expect(state.manifest).toEqual(before);
    expect(state.currentJob.stage).toBe("prepare");
  });

  it("does not continue paired preparation after the workers leave their controls", () => {
    const state = start(createGameState(1));
    placeBoth(state, READOUT_POSITION, "up");
    dispatchCommand(state, { type: "interact-down" });
    dispatchCommand(state, { type: "interact-up" });
    placeBoth(state, { x: 1, y: 0 }, "up");
    dispatchCommand(state, { type: "interact-down" });
    dispatchCommand(state, { type: "move", direction: "down" });
    advanceFor(state, 2_000);
    dispatchCommand(state, { type: "interact-up" });
    expect(state.currentJob.stage).toBe("prepare");
    expect(state.lanes.A.job.preparationProgressMs).toBe(0);
  });
});

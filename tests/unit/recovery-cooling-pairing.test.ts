import { describe, expect, it } from "vitest";

import {
  COUPLE_BUFFER_POSITION,
  COUPLE_POSITION,
  LANCE_RACK_POSITION,
  PULSE_BUFFER_POSITION,
  PULSE_POSITION,
  READOUT_POSITION,
  SUBMIT_POSITION,
  SUPPLY_POSITIONS,
  riskAddress,
} from "../../src/simulation/geometry";
import {
  createGameState,
  debugSetHeat,
  dispatchCommand,
} from "../../src/simulation/simulation";
import {
  acceptAndPrepare,
  advanceFor,
  collectAndInstallNextPulses,
  placeBoth,
  placeLane,
  pressInteract,
  start,
} from "./test-helpers";

describe("whole paired service workflow", () => {
  it("accepts, prepares, loads, measures, submits, and completes only after reset", () => {
    const state = start(createGameState(1, 111));
    acceptAndPrepare(state);
    expect(state.currentJob.stage).toBe("load");
    expect(state.lanes.A.job.prepared).toBe(true);
    expect(state.lanes.B.job.prepared).toBe(true);

    collectAndInstallNextPulses(state);
    expect(state.currentJob.stage).toBe("canister");
    expect(state.lanes.A.job.loadedPulses).toEqual(["H"]);
    expect(state.lanes.B.job.loadedPulses).toEqual(["H"]);

    const courier = state.currentJob.definition.courierLane;
    placeLane(state, courier, SUPPLY_POSITIONS.AUX, "out");
    placeLane(state, courier === "A" ? "B" : "A", { x: 1, y: 3 }, "down");
    pressInteract(state);
    placeLane(state, courier, READOUT_POSITION, "up");
    pressInteract(state);
    expect(state.currentJob.stage).toBe("run");

    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);
    expect(state.currentJob.shotAttempts).toHaveLength(1);
    expect(state.currentJob.validShots).toBe(1);
    expect(state.currentJob.stage).toBe("submission");
    const loadedPulseIds = [...state.lanes.A.job.pulseItemIds, ...state.lanes.B.job.pulseItemIds];
    expect(loadedPulseIds.every((id) => state.items[id].location.kind === "installed")).toBe(true);

    placeLane(state, courier, READOUT_POSITION, "up");
    pressInteract(state);
    placeLane(state, courier, SUBMIT_POSITION, "up");
    pressInteract(state);

    expect(state.score.acceptedJobs).toBe(1);
    expect(state.score.validShots).toBe(1);
    expect(state.laneBRevealed).toBe(false);
    expect(state.currentJob.stage).toBe("reset");
    expect(state.phase).toBe("running");

    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);
    expect(state.phase).toBe("complete");
    expect(state.currentJob.stage).toBe("reset");
    expect(state.events.some((event) => event.type === "processor-reset")).toBe(true);
  });

  it("installs two coupling halves before the paired timing-window action", () => {
    const state = start(createGameState(4, 222));
    state.currentJob.stage = "couple-install";
    state.manifest.riskStreams[riskAddress(4, "COUPLE", "interaction")].records[0].bits = [0, 0];
    for (const laneId of ["A", "B"] as const) {
      state.lanes[laneId].job.prepared = true;
      state.lanes[laneId].job.loadedPulses = [...state.currentJob.definition.pulses[laneId]];
    }

    placeBoth(state, SUPPLY_POSITIONS.AUX, "out");
    pressInteract(state);
    placeBoth(state, COUPLE_POSITION, "up");
    pressInteract(state);
    expect(state.currentJob.stage).toBe("couple-arm");
    expect(state.lanes.A.job.couplingInstalled).toBe(true);
    expect(state.lanes.B.job.couplingInstalled).toBe(true);

    pressInteract(state);
    expect(state.currentJob.stage).toBe("canister");
    expect(state.events.some((event) => event.type === "coupling-armed")).toBe(true);
  });

  it("collects the same H cartridge from matching supplies on both sides", () => {
    const state = start(createGameState(2, 223));
    state.currentJob.stage = "load";

    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("pulse-H");
    expect(state.items[state.lanes.B.actor.heldItemId ?? ""]?.kind).toBe("pulse-H");
    expect(state.lanes.A.actor.position).toEqual(state.lanes.B.actor.position);
  });

  it("keeps the hidden coworker mechanically active and reveals it at run two start", () => {
    const hidden = start(createGameState(1));
    expect(hidden.laneBRevealed).toBe(false);
    placeBoth(hidden, { x: 2, y: 2 }, "in");
    dispatchCommand(hidden, { type: "move", direction: "in" });
    expect(hidden.lanes.A.actor.position).toEqual({ x: 3, y: 2 });
    expect(hidden.lanes.B.actor.position).toEqual({ x: 3, y: 2 });
    expect(hidden.laneBRevealed).toBe(false);

    const revealed = createGameState(2);
    expect(revealed.laneBRevealed).toBe(false);
    start(revealed);
    expect(revealed.laneBRevealed).toBe(true);
    expect(revealed.events.some((event) => event.type === "lane-revealed")).toBe(true);
  });
});

describe("persistent risk recovery", () => {
  it("records only the channel that actually activates an out-of-phase risk address", () => {
    const state = start(createGameState(3));
    acceptAndPrepare(state);
    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    placeLane(state, "B", { x: 1, y: 3 }, "down");
    placeLane(state, "A", PULSE_POSITION, "up");
    pressInteract(state);

    const risk = state.events.find((event) => event.type === "risk-consumed");
    expect(risk?.bits).toEqual([0, 1]);
    expect(risk?.participants).toEqual(["A"]);
    expect(state.lanes.A.job.loadedPulses).toEqual(["H"]);
    expect(state.lanes.B.job.loadedPulses).toEqual([]);
    expect(state.events.some((event) => event.type === "fumble")).toBe(false);
  });

  it("recovers the scripted one-sided pulse fumble and retries with the next cached record", () => {
    const state = start(createGameState(3));
    const address = riskAddress(3, "PULSE", "interaction");
    acceptAndPrepare(state);
    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    placeBoth(state, PULSE_POSITION, "up");
    pressInteract(state);

    expect(state.lanes.A.job.loadedPulses).toEqual(["H"]);
    const dropped = Object.values(state.items).find(
      (item) => item.lane === "B" && item.location.kind === "dropped",
    );
    expect(dropped?.location.kind === "dropped" ? dropped.location.position : null).toEqual(
      PULSE_BUFFER_POSITION,
    );
    expect(state.manifest.riskStreams[address].cursor).toBe(1);

    placeLane(state, "A", { x: 4, y: 3 }, "down");
    placeLane(state, "B", PULSE_BUFFER_POSITION, "down");
    pressInteract(state);
    expect(state.lanes.B.actor.heldItemId).toBe(dropped?.id);

    placeLane(state, "B", PULSE_POSITION, "up");
    pressInteract(state);
    expect(state.lanes.B.job.loadedPulses).toEqual(["H"]);
    expect(state.currentJob.stage).toBe("canister");
    expect(state.phase).toBe("running");
    expect(state.manifest.riskStreams[address].cursor).toBe(2);
    expect(state.score.recoveries).toBe(1);
  });

  it("expires dropped coupling halves and authorizes exactly those replacements", () => {
    const state = start(createGameState(4, 444));
    state.currentJob.stage = "couple-install";
    for (const laneId of ["A", "B"] as const) {
      state.lanes[laneId].job.prepared = true;
      state.lanes[laneId].job.loadedPulses = [...state.currentJob.definition.pulses[laneId]];
    }
    placeBoth(state, SUPPLY_POSITIONS.AUX, "out");
    pressInteract(state);
    placeBoth(state, COUPLE_POSITION, "up");
    pressInteract(state);
    expect(Object.values(state.items).filter((item) => item.location.kind === "dropped")).toHaveLength(2);
    expect(state.lanes.B.replacementKind).toBeNull();

    advanceFor(state, state.level.dropLifetimeMs + 100);

    expect(state.lanes.A.replacementKind).toBe("coupling-half");
    expect(state.lanes.B.replacementKind).toBe("coupling-half");
    expect(state.score.expiries).toBe(2);
    expect(state.events.some((event) => event.type === "object-expired")).toBe(true);
  });
});

describe("classical cooling and cached shot integrity", () => {
  it("returns and reissues cryo lances without counting the rack action as cooling", () => {
    const state = start(createGameState(4, 554));
    state.currentJob.stage = "couple-install";
    state.manifest.riskStreams[riskAddress(4, "COUPLE", "interaction")].records[0].bits = [0, 0];
    for (const laneId of ["A", "B"] as const) {
      state.lanes[laneId].job.prepared = true;
      state.lanes[laneId].job.loadedPulses = [...state.currentJob.definition.pulses[laneId]];
    }

    placeBoth(state, SUPPLY_POSITIONS.AUX, "out");
    pressInteract(state);
    placeBoth(state, COUPLE_POSITION, "up");
    pressInteract(state);
    pressInteract(state);
    placeBoth(state, LANCE_RACK_POSITION, "down");
    pressInteract(state);
    const completedServicesBeforeReturn = state.cooling.completedServices;

    pressInteract(state);

    expect(state.lanes.A.actor.heldItemId).toBeNull();
    expect(state.lanes.B.actor.heldItemId).toBeNull();
    expect(state.cooling.completedServices).toBe(completedServicesBeforeReturn);
    expect(state.events.filter((event) => event.type === "item-returned")).toHaveLength(2);

    pressInteract(state);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("cryo-lance");
    expect(state.items[state.lanes.B.actor.heldItemId ?? ""]?.kind).toBe("cryo-lance");

    for (const hotspot of state.cooling.hotspots) hotspot.active = false;
    placeLane(state, "A", LANCE_RACK_POSITION, "down");
    placeLane(state, "B", { x: 4, y: 1 }, "in");
    pressInteract(state);
    expect(state.lanes.A.actor.heldItemId).toBeNull();
    expect(state.items[state.lanes.B.actor.heldItemId ?? ""]?.kind).toBe("cryo-lance");

    placeBoth(state, LANCE_RACK_POSITION, "down");
    pressInteract(state);
    expect(state.lanes.B.actor.heldItemId).toBeNull();
    expect(state.cooling.completedServices).toBe(completedServicesBeforeReturn);
  });

  it("carries and aims the cryo lance while leaving both manifest cursors untouched", () => {
    const state = start(createGameState(4, 555));
    debugSetHeat(state, 82);
    for (const hotspot of state.cooling.hotspots) hotspot.heat = 60;
    state.currentJob.stage = "couple-install";
    for (const laneId of ["A", "B"] as const) {
      state.lanes[laneId].job.prepared = true;
      state.lanes[laneId].job.loadedPulses = [...state.currentJob.definition.pulses[laneId]];
    }
    state.manifest.riskStreams[riskAddress(4, "COUPLE", "interaction")].records[0].bits = [0, 0];
    placeBoth(state, SUPPLY_POSITIONS.AUX, "out");
    pressInteract(state);
    placeBoth(state, COUPLE_POSITION, "up");
    pressInteract(state);
    pressInteract(state);
    placeBoth(state, LANCE_RACK_POSITION, "down");
    pressInteract(state);
    expect(Object.values(state.items).filter((item) => item.kind === "cryo-lance")).toHaveLength(2);

    placeBoth(state, { x: 4, y: 1 }, "in");
    const manifestBefore = structuredClone(state.manifest);
    const heatBefore = state.cooling.load;
    dispatchCommand(state, { type: "interact-down" });
    advanceFor(state, 1_000);

    expect(state.cooling.load).toBeLessThan(heatBefore);
    expect(state.manifest).toEqual(manifestBefore);
    expect(state.lanes.A.actor.heldItemId).not.toBeNull();
    expect(state.lanes.B.actor.heldItemId).not.toBeNull();

    dispatchCommand(state, { type: "move", direction: "down" });
    expect(state.interactHeld).toBe(false);
    expect(state.activeHoldLanes).toEqual([]);
  });

  it("consumes a shot unchanged when thermal service rejects the attempt", () => {
    const state = start(createGameState(1, 666));
    const job = state.currentJob;
    job.stage = "run";
    job.acceptedAtMs = 0;
    job.deadlineAtMs = 60_000;
    job.canisterAttached = true;
    for (const laneId of ["A", "B"] as const) {
      state.lanes[laneId].job.prepared = true;
      state.lanes[laneId].job.preparationExpiresAtMs = 60_000;
    }
    const expectedShot = state.manifest.shotStreams[job.definition.id].records[0];
    debugSetHeat(state, 80);
    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);

    expect(job.shotAttempts[0].bits).toEqual(expectedShot.bits);
    expect(job.shotAttempts[0]).toMatchObject({
      accepted: false,
      rejectionReason: "thermal-service",
    });
    expect(state.manifest.shotStreams[job.definition.id].cursor).toBe(1);
    expect(state.score.rejectedShots).toBe(1);
  });

  it("preserves banked whole jobs across shutdown", () => {
    const state = start(createGameState(4));
    state.score.acceptedJobs = 3;
    debugSetHeat(state, state.level.heat.maximum);
    advanceFor(state, 50);
    expect(state.phase).toBe("shutdown");
    expect(state.score.acceptedJobs).toBe(3);
    expect(state.score.shutdowns).toBe(1);
    expect(state.events.at(-1)?.type).toBe("emergency-shutdown");
  });
});

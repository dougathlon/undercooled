import { describe, expect, it } from "vitest";

import {
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
  holdInteract,
  placeBoth,
  placeLane,
  pressInteract,
  start,
} from "./test-helpers";

describe("whole paired service workflow", () => {
  it("accepts, prepares, loads once, records repeated shots, submits one job, then resets", () => {
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
    expect(state.laneBRevealed).toBe(true);
    expect(state.currentJob.stage).toBe("reset");

    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);
    expect(state.currentJob.stage).toBe("accept");
    expect(state.currentJob.definition.id).toBe("L1-J2");
    expect(state.events.some((event) => event.type === "processor-reset")).toBe(true);
  });

  it("installs two coupling halves before the paired timing-window action", () => {
    const state = start(createGameState(1, 222));
    state.currentJob.definition = state.level.jobs[2];
    state.currentJob.stage = "couple-install";
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

  it("collects only each lane's next expected pulse under aligned shared movement", () => {
    const state = start(createGameState(1, 223));
    state.currentJob.definition = state.level.jobs[1];
    state.currentJob.stage = "load";

    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("pulse-H");
    expect(state.lanes.B.actor.heldItemId).toBeNull();

    placeBoth(state, SUPPLY_POSITIONS.X, "out");
    pressInteract(state);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]?.kind).toBe("pulse-H");
    expect(state.items[state.lanes.B.actor.heldItemId ?? ""]?.kind).toBe("pulse-X");
  });

  it("stages at most one first pulse per lane for the next job and preserves it through reset", () => {
    const state = start(createGameState(8, 224));
    state.currentJob.stage = "run";
    const upcoming = state.level.jobs[1];

    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    placeBoth(state, SUPPLY_POSITIONS.X, "out");
    pressInteract(state);
    expect(state.items[state.lanes.A.actor.heldItemId ?? ""]).toMatchObject({
      kind: "pulse-H",
      jobId: upcoming.id,
    });
    expect(state.items[state.lanes.B.actor.heldItemId ?? ""]).toMatchObject({
      kind: "pulse-X",
      jobId: upcoming.id,
    });

    placeBoth(state, PULSE_BUFFER_POSITION, "down");
    pressInteract(state);
    const staged = Object.values(state.items).filter(
      (item) => item.jobId === upcoming.id && item.location.kind === "dropped",
    );
    expect(staged).toHaveLength(2);
    expect(staged.every((item) => item.expiresAtMs === null)).toBe(true);

    // Returning to either rack cannot mint another prestaged pulse.
    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    expect(Object.values(state.items).filter((item) => item.jobId === upcoming.id)).toHaveLength(2);

    state.currentJob.stage = "reset";
    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);
    expect(state.currentJob.definition.id).toBe(upcoming.id);
    expect(staged.every((item) => item.location.kind === "dropped")).toBe(true);

    placeBoth(state, PULSE_BUFFER_POSITION, "down");
    pressInteract(state);
    expect(state.lanes.A.actor.heldItemId).toBe(staged.find((item) => item.lane === "A")?.id);
    expect(state.lanes.B.actor.heldItemId).toBe(staged.find((item) => item.lane === "B")?.id);
  });
});

describe("persistent risk recovery", () => {
  it("recovers the scripted one-sided pulse fumble and retries with the next cached record", () => {
    const state = start(createGameState(2, 333));
    acceptAndPrepare(state);
    const address = riskAddress(2, "PULSE", "interaction");
    state.manifest.riskStreams[address].records[1].bits = [0, 0];
    collectAndInstallNextPulses(state);

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
    expect(state.currentJob.stage).toBe("canister");
    expect(state.manifest.riskStreams[address].cursor).toBe(2);
    expect(state.score.recoveries).toBe(1);
  });

  it("expires a dropped cartridge and authorizes exactly that replacement kind", () => {
    const state = start(createGameState(4, 444));
    acceptAndPrepare(state);
    const address = riskAddress(4, "PULSE", "interaction");
    state.manifest.riskStreams[address].records[0].bits = [0, 1];
    collectAndInstallNextPulses(state);
    expect(state.lanes.B.replacementKind).toBeNull();

    advanceFor(state, state.level.dropLifetimeMs + 100);

    expect(state.lanes.B.replacementKind).toBe("pulse-H");
    expect(state.score.expiries).toBe(1);
    expect(state.events.some((event) => event.type === "object-expired")).toBe(true);
  });
});

describe("classical cooling and cached shot integrity", () => {
  it("carries and aims the cryo lance while leaving both manifest cursors untouched", () => {
    const state = start(createGameState(10, 555));
    debugSetHeat(state, 82);
    for (const hotspot of state.cooling.hotspots) hotspot.heat = 60;
    placeBoth(state, LANCE_RACK_POSITION, "down");
    pressInteract(state);
    expect(Object.values(state.items).filter((item) => item.kind === "cryo-lance")).toHaveLength(2);

    placeBoth(state, { x: 4, y: 1 }, "in");
    const manifestBefore = structuredClone(state.manifest);
    const heatBefore = state.cooling.load;
    holdInteract(state, 1_000);

    expect(state.cooling.load).toBeLessThan(heatBefore);
    expect(state.manifest).toEqual(manifestBefore);
    expect(state.lanes.A.actor.heldItemId).not.toBeNull();
    expect(state.lanes.B.actor.heldItemId).not.toBeNull();
  });

  it("consumes a shot unchanged when thermal service rejects the attempt", () => {
    const state = start(createGameState(3, 666));
    const job = state.currentJob;
    job.stage = "run";
    job.acceptedAtMs = 0;
    job.deadlineAtMs = 60_000;
    job.canisterAttached = true;
    for (const laneId of ["A", "B"] as const) {
      state.lanes[laneId].job.prepared = true;
      state.lanes[laneId].job.preparationExpiresAtMs = 60_000;
    }
    const riskAddressId = riskAddress(3, "READOUT", "interaction");
    state.manifest.riskStreams[riskAddressId].records[0].bits = [0, 0];
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
    const state = start(createGameState(10));
    state.score.acceptedJobs = 3;
    debugSetHeat(state, state.level.heat.maximum);
    advanceFor(state, 50);
    expect(state.phase).toBe("shutdown");
    expect(state.score.acceptedJobs).toBe(3);
    expect(state.score.shutdowns).toBe(1);
    expect(state.events.at(-1)?.type).toBe("emergency-shutdown");
  });
});

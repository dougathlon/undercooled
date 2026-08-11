import { describe, expect, it } from "vitest";

import { guidanceFor } from "../../src/game/guidance";
import { resultTrace } from "../../src/ui/GameUI";
import {
  COUPLE_BUFFER_POSITION,
  COUPLE_POSITION,
  LANCE_RACK_POSITION,
  MOVEMENT_RISK_POSITION,
  PULSE_BUFFER_POSITION,
  PULSE_POSITION,
  READOUT_POSITION,
  SUBMIT_POSITION,
  SUPPLY_POSITIONS,
  riskAddress,
} from "../../src/simulation/geometry";
import { createGameState, dispatchCommand } from "../../src/simulation/simulation";
import {
  acceptAndPrepare,
  collectAndInstallNextPulses,
  finishJobFromCanister,
  holdInteract,
  placeBoth,
  pressInteract,
  start,
} from "./test-helpers";

describe("one-objective demo guidance", () => {
  it("does not expose a second worker during the hidden first scene", () => {
    const state = start(createGameState(1));
    const guide = guidanceFor(state);
    expect(guide.headline).toBe("ACTIVATE THE READOUT");
    expect(guide.targets.A).toBeDefined();
    expect(guide.targets.B).toBeUndefined();
  });

  it("guides matching H/H work through measurement, submission, and reset", () => {
    const state = start(createGameState(2));
    acceptAndPrepare(state);
    placeBoth(state, SUPPLY_POSITIONS.H, "out");

    expect(guidanceFor(state)).toMatchObject({
      headline: "FETCH H ON BOTH SIDES",
      command: "PRESS ACTION",
      focus: "supply",
    });
    expect(guidanceFor(state).targets.A?.label).toBe("TAKE H");
    expect(guidanceFor(state).targets.B?.label).toBe("TAKE H");
    pressInteract(state);
    expect(guidanceFor(state)).toMatchObject({
      headline: "INSTALL THE CARTRIDGES",
      focus: "station",
    });

    placeBoth(state, PULSE_POSITION, "up");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("FETCH THE RED CANISTER");
    placeBoth(state, SUPPLY_POSITIONS.AUX, "out");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("CARRY THE CANISTER TO READOUT");
    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("RUN AND MEASURE ONE SHOT");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("DETACH THE RESULT CANISTER");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("CARRY THE RESULT TO SUBMIT");
    placeBoth(state, SUBMIT_POSITION, "up");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("RETURN BOTH WORKERS TO READOUT");
    placeBoth(state, READOUT_POSITION, "up");
    pressInteract(state);
    expect(state.phase).toBe("complete");
    expect(resultTrace(state)).toContainEqual({ label: "SERVICE CYCLE", value: "SUBMITTED + RESET" });
  });

  it("turns the protected 01 drop and missed step into explicit recovery goals", () => {
    const state = start(createGameState(3));
    acceptAndPrepare(state);
    placeBoth(state, SUPPLY_POSITIONS.H, "out");
    pressInteract(state);
    placeBoth(state, PULSE_POSITION, "up");
    expect(guidanceFor(state)).toMatchObject({
      eyebrow: "RISK ADDRESS ARMED",
      headline: "COMMIT AT THE PULSE ADDRESS",
    });
    expect(guidanceFor(state).detail).not.toContain("01");

    pressInteract(state);
    expect(guidanceFor(state)).toMatchObject({
      headline: "RECOVER THE CARTRIDGE",
      urgent: true,
      focus: "buffer",
    });
    expect(guidanceFor(state).targets.B?.position).toEqual(PULSE_BUFFER_POSITION);

    placeBoth(state, PULSE_BUFFER_POSITION, "down");
    pressInteract(state);
    expect(guidanceFor(state)).toMatchObject({
      eyebrow: "RETRY — NEXT RECORD READY",
      headline: "RETRY THE FAILED SIDE",
    });
    expect(guidanceFor(state).targets.A?.label).toBe("H ALREADY INSTALLED");
    placeBoth(state, PULSE_POSITION, "up");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("ENTER THE MARKED SQUARE");

    placeBoth(state, MOVEMENT_RISK_POSITION, "down");
    expect(guidanceFor(state).headline).toBe("LEAVE THE MARKED SQUARE");
    expect(guidanceFor(state).detail).not.toContain("01");
    expect(guidanceFor(state).targets.B?.label).toBe("OUTCOME HIDDEN");
    dispatchCommand(state, { type: "move", direction: "up" });
    expect(guidanceFor(state)).toMatchObject({
      headline: "RESYNCHRONIZE AT THE BARRIER",
      command: "TAP UP",
      urgent: true,
    });

    dispatchCommand(state, { type: "move", direction: "up" });
    dispatchCommand(state, { type: "move", direction: "up" });
    dispatchCommand(state, { type: "move", direction: "up" });
    expect(state.phase).toBe("running");
    expect(state.currentJob.stage).toBe("canister");
    expect(guidanceFor(state).headline).toBe("FETCH THE BLUE CANISTER");
    expect(state.lanes.A.actor.position).toEqual({ x: 2, y: 0 });
    expect(state.lanes.B.actor.position).toEqual({ x: 2, y: 0 });
    finishJobFromCanister(state);
    expect(state.phase).toBe("complete");
    expect(resultTrace(state)).toEqual(expect.arrayContaining([
      { label: "SCRIPTED · PULSE 01", value: "B FUMBLES" },
      { label: "SIMULATOR · TRANSFER 01", value: "B MISSES A STEP" },
      { label: "SCRIPTED · READOUT 01", value: "B FUMBLES" },
      { label: "SERVICE CYCLE", value: "SUBMITTED + RESET" },
    ]));
  });

  it("keeps joint risk and classical cooling as consecutive, distinct tasks", () => {
    const state = start(createGameState(4));
    acceptAndPrepare(state);
    state.manifest.riskStreams[riskAddress(4, "PULSE", "interaction")].records[0].bits = [0, 0];
    collectAndInstallNextPulses(state);
    placeBoth(state, SUPPLY_POSITIONS.AUX, "out");
    pressInteract(state);
    placeBoth(state, COUPLE_POSITION, "up");
    expect(guidanceFor(state)).toMatchObject({
      eyebrow: "JOINT RISK ADDRESS ARMED",
      headline: "COMMIT AT THE COUPLED ADDRESS",
    });
    expect(guidanceFor(state).detail).not.toContain("11");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("RECOVER BOTH HALVES");

    placeBoth(state, COUPLE_BUFFER_POSITION, "down");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("RETRY BOTH COUPLING HALVES");
    placeBoth(state, COUPLE_POSITION, "up");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("RECOVER THE COUPLING HALF");

    placeBoth(state, COUPLE_BUFFER_POSITION, "down");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("RETRY THE FAILED COUPLING HALF");
    expect(guidanceFor(state).targets.B?.label).toBe("PORT ALREADY LOCKED");
    placeBoth(state, COUPLE_POSITION, "up");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("ARM BOTH PORTS TOGETHER");
    pressInteract(state);
    expect(guidanceFor(state)).toMatchObject({
      headline: "FETCH THE CRYO LANCES",
      focus: "cooling",
    });

    placeBoth(state, LANCE_RACK_POSITION, "down");
    pressInteract(state);
    expect(guidanceFor(state)).toMatchObject({
      headline: "SPRAY THE GLOWING MANIFOLDS",
      command: "MOVE TO HOTSPOTS",
    });
    placeBoth(state, { x: 4, y: 1 }, "in");
    holdInteract(state, 4_000);
    expect(guidanceFor(state).headline).toBe("RETURN THE CRYO LANCES");
    placeBoth(state, LANCE_RACK_POSITION, "down");
    pressInteract(state);
    expect(guidanceFor(state).headline).toBe("FETCH THE RED CANISTER");
    finishJobFromCanister(state);
    expect(state.phase).toBe("complete");
    expect(resultTrace(state)).toEqual(expect.arrayContaining([
      { label: "SCRIPTED · COUPLE 11", value: "A + B FUMBLES" },
      { label: "SCRIPTED · COUPLE 10", value: "A FUMBLES" },
      { label: "SCRIPTED · READOUT 01", value: "B FUMBLES" },
      { label: "SIMULATED · QUANTUM BLUR", value: "VISUALIZES HEAT ONLY" },
      { label: "CLASSICAL · CRYO SPRAY", value: "LOWERS HEAT ONLY" },
      { label: "SERVICE CYCLE", value: "SUBMITTED + RESET" },
    ]));
  });
});

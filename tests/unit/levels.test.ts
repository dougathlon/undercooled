import { describe, expect, it } from "vitest";

import { LEVELS, getLevel, starsForJobs } from "../../src/simulation/levels";
import { createGameState } from "../../src/simulation/simulation";
import { riskAddress } from "../../src/simulation/geometry";

describe("four-run Moth demonstration", () => {
  it("defines four ordered, single-cycle demo runs", () => {
    expect(LEVELS).toHaveLength(4);
    expect(LEVELS.map((level) => level.id)).toEqual([1, 2, 3, 4]);
    expect(new Set(LEVELS.map((level) => level.slug)).size).toBe(4);

    for (const level of LEVELS) {
      expect(level.targetJobs).toBe(1);
      expect(level.jobs).toHaveLength(1);
      expect(level.jobs[0].shotQuota).toBe(1);
      expect(level.jobs[0].maxAttempts).toBeGreaterThan(level.jobs[0].shotQuota);
      expect(level.jobs[0].pulses.A.length).toBeGreaterThan(0);
      expect(level.jobs[0].pulses.B.length).toBeGreaterThan(0);
      expect(starsForJobs(level, 0)).toBe(0);
      expect(starsForJobs(level, 1)).toBe(3);
    }

    for (const level of LEVELS.slice(0, 3)) {
      expect(level.durationMs).toBeNull();
      expect(level.jobs[0].deadlineMs).toBeNull();
      expect(level.heat.preparationValidityMs).toBeNull();
    }
    expect(getLevel(4).durationMs).toBe(140_000);
    expect(getLevel(4).jobs[0].deadlineMs).toBe(140_000);
  });

  it("progresses from hidden deterministic control to protected and full joint risk", () => {
    const levels = Object.fromEntries(LEVELS.map((candidate) => [candidate.id, candidate]));
    expect(levels[1].features).toMatchObject({
      laneBPresentation: "veiled",
      interactionRisk: false,
      movementRisk: false,
    });
    expect(levels[2].features).toMatchObject({
      laneBPresentation: "reveal-on-start",
      interactionRisk: false,
      movementRisk: false,
    });
    expect(levels[3]).toMatchObject({
      jointProfile: "protected",
      manifestSeed: 31,
      features: {
        laneBPresentation: "visible",
        interactionRisk: true,
        movementRisk: true,
        scriptedPulseFirst: [0, 1],
      },
    });
    expect(levels[4]).toMatchObject({
      jointProfile: "full-joint",
      manifestSeed: 19_695,
      features: {
        laneBPresentation: "visible",
        interactionRisk: true,
        movementRisk: true,
        reciprocalRisk: true,
        allowBothFail: true,
        dropExpiryEnabled: true,
      },
    });
  });

  it("authors legible pickup differences and a coupled later-game run", () => {
    expect(getLevel(1).jobs[0].pulses).toEqual({ A: ["H"], B: ["H"] });
    expect(getLevel(2).jobs[0].pulses).toEqual({ A: ["H"], B: ["X"] });
    expect(getLevel(3).jobs[0].pulses).toEqual({ A: ["H", "P"], B: ["X", "H"] });
    expect(getLevel(4).jobs[0].coupledGate).toBe("CX");
    expect(() => getLevel(0)).toThrow("Unknown level 0");
    expect(() => getLevel(5)).toThrow("Unknown level 5");
  });

  it("prevalidates illustrative cached risk sequences for runs three and four", () => {
    const protectedState = createGameState(3);
    const protectedPulse = protectedState.manifest.riskStreams[riskAddress(3, "PULSE", "interaction")];
    const protectedTransfer = protectedState.manifest.riskStreams[riskAddress(3, "TRANSFER", "movement")];
    expect(protectedPulse.records.slice(0, 3).map((record) => [record.source, record.bits])).toEqual([
      ["scripted", [0, 1]],
      ["simulator", [0, 0]],
      ["simulator", [0, 0]],
    ]);
    expect(protectedTransfer.records.slice(0, 2).map((record) => record.bits)).toEqual([
      [0, 1],
      [0, 0],
    ]);

    const jointState = createGameState(4);
    expect(
      jointState.manifest.riskStreams[riskAddress(4, "PULSE", "interaction")].records
        .slice(0, 4)
        .map((record) => record.bits),
    ).toEqual([
      [1, 0],
      [0, 0],
      [0, 1],
      [0, 0],
    ]);
    expect(
      jointState.manifest.riskStreams[riskAddress(4, "COUPLE", "interaction")].records
        .slice(0, 2)
        .map((record) => record.bits),
    ).toEqual([
      [1, 1],
      [0, 0],
    ]);
  });
});

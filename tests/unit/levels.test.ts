import { describe, expect, it } from "vitest";

import { LEVELS, getLevel, starsForJobs } from "../../src/simulation/levels";

describe("ten-level whole-job progression", () => {
  it("defines ten ordered levels with complete job manifests and reachable thresholds", () => {
    expect(LEVELS).toHaveLength(10);
    expect(LEVELS.map((level) => level.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(LEVELS.map((level) => level.slug)).size).toBe(10);

    for (const level of LEVELS) {
      expect(level.jobs.length).toBeGreaterThanOrEqual(level.targetJobs);
      expect(level.starThresholds[0]).toBeLessThanOrEqual(level.starThresholds[1]);
      expect(level.starThresholds[1]).toBeLessThanOrEqual(level.starThresholds[2]);
      expect(level.starThresholds[2]).toBeLessThanOrEqual(level.targetJobs);
      expect(starsForJobs(level, 0)).toBe(0);
      expect(starsForJobs(level, level.starThresholds[2])).toBe(3);
      for (const job of level.jobs) {
        expect(job.shotQuota).toBeGreaterThan(0);
        expect(job.maxAttempts).toBeGreaterThan(job.shotQuota);
        expect(job.pulses.A.length).toBeGreaterThan(0);
        expect(job.pulses.B.length).toBeGreaterThan(0);
      }
    }
  });

  it("introduces recovery, movement, reciprocity, parallel work, and compound cooling in order", () => {
    const levels = Object.fromEntries(LEVELS.map((candidate) => [candidate.id, candidate]));
    expect(levels[1].features).toMatchObject({
      interactionRisk: false,
      movementRisk: false,
      revealLaneBAfterJobs: 1,
      guidedCoolingAfterJobs: 1,
    });
    expect(levels[2].features.scriptedPulseFirst).toEqual([0, 1]);
    expect(levels[2].jointProfile).toBe("protected");
    expect(levels[3].features.dropExpiryEnabled).toBe(false);
    expect(levels[4].features.dropExpiryEnabled).toBe(true);
    expect(levels[4].dropLifetimeMs).toBe(5_000);
    expect(levels[5].features.scriptedMovementFirst).toEqual([0, 1]);
    expect(levels[6].features.usefulOffset).toBe(true);
    expect(levels[7].jointProfile).toBe("reciprocal-no-double");
    expect(levels[7].features.scriptedPulseFirst).toEqual([1, 0]);
    expect(levels[8].features).toMatchObject({ allowPrestage: true, pumpTrips: true });
    expect(levels[9].features).toMatchObject({
      allowBothFail: true,
      blockedLines: true,
      multipleHotspots: true,
    });
    expect(levels[10].targetJobs).toBe(5);
    expect(LEVELS.slice(0, 2).every((candidate) => candidate.durationMs === null)).toBe(true);
    expect(LEVELS.slice(2).every((candidate) => (candidate.durationMs ?? 0) > 0)).toBe(true);
  });

  it("starts with the legible H/H reveal job and rejects unknown identifiers", () => {
    expect(getLevel(1).jobs[0].pulses).toEqual({ A: ["H"], B: ["H"] });
    expect(getLevel(10).title).toBe("The Full Nerveworks");
    expect(() => getLevel(0)).toThrow("Unknown level 0");
    expect(() => getLevel(11)).toThrow("Unknown level 11");
  });
});

import type { HeatProfile, JobDefinition, LevelConfig, PulseKind } from "./types";

export const THERMAL_STANDARD: HeatProfile = {
  maximum: 100,
  baselinePerSecond: 0.34,
  activeJobPerSecond: 0.72,
  executionImpulse: 5.5,
  fumbleImpulse: 2.5,
  expiryImpulse: 5,
  coolingPerSecond: 19,
  reservoirDrainPerSecond: 0.42,
  preparationHoldMs: 1_150,
  pumpRestartHoldMs: 1_300,
};

const THERMAL_TUTORIAL: HeatProfile = {
  ...THERMAL_STANDARD,
  baselinePerSecond: 0.12,
  activeJobPerSecond: 0.24,
  executionImpulse: 3,
  coolingPerSecond: 24,
};

interface JobPattern {
  label: string;
  left: PulseKind[];
  right: PulseKind[];
  coupled: JobDefinition["coupledGate"];
  shots: number;
  courier: JobDefinition["courierLane"];
}

const JOB_PATTERNS: readonly JobPattern[] = [
  { label: "Symmetry Check", left: ["H"], right: ["H"], coupled: null, shots: 1, courier: "A" },
  { label: "State Exchange", left: ["H"], right: ["X"], coupled: null, shots: 2, courier: "B" },
  { label: "Bell Service", left: ["H", "P"], right: ["X", "H"], coupled: "CX", shots: 2, courier: "A" },
  { label: "Phase Audit", left: ["P", "H"], right: ["H", "P"], coupled: "CZ", shots: 3, courier: "B" },
  { label: "Cross-Talk Survey", left: ["X", "H", "P"], right: ["H", "P", "X"], coupled: "CX", shots: 3, courier: "A" },
  { label: "Cold Joint Batch", left: ["H", "P", "H"], right: ["X", "H", "P"], coupled: "CZ", shots: 4, courier: "B" },
] as const;

function makeJobs(levelId: number, count: number): JobDefinition[] {
  return Array.from({ length: count }, (_, index) => {
    const pattern = JOB_PATTERNS[index % JOB_PATTERNS.length];
    const pressure = Math.max(0, levelId - 2);
    return {
      id: `L${levelId}-J${index + 1}`,
      label: pattern.label,
      pulses: { A: [...pattern.left], B: [...pattern.right] },
      coupledGate: pattern.coupled,
      shotQuota: Math.min(5, pattern.shots + Math.floor(pressure / 4)),
      maxAttempts: Math.min(9, pattern.shots + 3 + Math.floor(pressure / 3)),
      maxRejectionRate: levelId < 4 ? 0.55 : levelId < 8 ? 0.4 : 0.34,
      deadlineMs: levelId < 3 ? 180_000 : Math.max(48_000, 92_000 - pressure * 4_000),
      courierLane: pattern.courier,
    };
  });
}

function level(
  config: Omit<LevelConfig, "jobs"> & { jobCount?: number },
): LevelConfig {
  const { jobCount = Math.max(5, config.targetJobs + 1), ...rest } = config;
  return { ...rest, jobs: makeJobs(config.id, jobCount) };
}

export const LEVELS: readonly LevelConfig[] = [
  level({
    id: 1,
    slug: "reveal",
    title: "The Other Pair",
    subtitle: "One job, two output channels",
    briefing:
      "Accept the shared circuit, prepare both hidden channels, load its pulse symbols, collect shots, submit one paired service job, then discover who has mirrored every command.",
    objective: "Reveal Channel B, service the cryogenic plant, and accept 3 paired jobs.",
    durationMs: null,
    starThresholds: [1, 2, 3],
    targetJobs: 3,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_400,
    interactionFailureRate: 0,
    movementFailureRate: 0,
    jointProfile: "protected",
    features: {
      revealLaneBAfterJobs: 1,
      interactionRisk: false,
      movementRisk: false,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: false,
      guidedCoolingAfterJobs: 1,
      dropExpiryEnabled: false,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_TUTORIAL,
  }),
  level({
    id: 2,
    slug: "first-fumble",
    title: "The First Fumble",
    subtitle: "A protected one-bit fault",
    briefing:
      "The first pulse installation uses a scripted risk record: Channel B drops its cartridge while Channel A succeeds. Recover the cartridge; the next activation consumes the next cached record.",
    objective: "Recover the scripted pulse fumble and accept 2 paired jobs.",
    durationMs: null,
    starThresholds: [1, 2, 2],
    targetJobs: 2,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_200,
    interactionFailureRate: 0.3,
    movementFailureRate: 0,
    jointProfile: "protected",
    features: {
      interactionRisk: true,
      movementRisk: false,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: false,
      scriptedPulseFirst: [0, 1],
      dropExpiryEnabled: false,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_TUTORIAL,
  }),
  level({
    id: 3,
    slug: "thermal-pressure",
    title: "Keep It Cold",
    subtitle: "Recovery under one pressure variable",
    briefing:
      "Protected pulse faults now recur while the processor warms. Break from production to carry the cryo lance to a hot manifold and hold the spray on it.",
    objective: "Accept 3 jobs while recovering interactions and controlling thermal load.",
    durationMs: 96_000,
    starThresholds: [1, 2, 3],
    targetJobs: 3,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_100,
    interactionFailureRate: 0.32,
    movementFailureRate: 0,
    jointProfile: "protected",
    features: {
      interactionRisk: true,
      movementRisk: false,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: false,
      dropExpiryEnabled: false,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 4,
    slug: "expiry",
    title: "Five-Second Viability",
    subtitle: "Dropped hardware does not wait",
    briefing:
      "A dropped stage item remains viable for five seconds. Recover it from its reserved buffer or fetch a lane-specific replacement after it expires.",
    objective: "Accept 3 jobs without letting recovery and cooling deadlock one another.",
    durationMs: 98_000,
    starThresholds: [1, 2, 3],
    targetJobs: 3,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 2_000,
    interactionFailureRate: 0.34,
    movementFailureRate: 0,
    jointProfile: "protected",
    features: {
      interactionRisk: true,
      movementRisk: false,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: false,
      dropExpiryEnabled: true,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 5,
    slug: "missed-step",
    title: "Missed Step",
    subtitle: "The lanes leave correspondence",
    briefing:
      "The first transfer tile maps a cached bit onto Channel B missing its move. Use the physical end stop as a deterministic local no-op while the other worker catches up.",
    objective: "Repair spatial offset, then accept 3 jobs.",
    durationMs: 104_000,
    starThresholds: [1, 2, 3],
    targetJobs: 3,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 1_900,
    interactionFailureRate: 0.27,
    movementFailureRate: 0.27,
    jointProfile: "protected",
    features: {
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: false,
      scriptedMovementFirst: [0, 1],
      dropExpiryEnabled: true,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 6,
    slug: "useful-offset",
    title: "Useful Offset",
    subtitle: "Misalignment becomes a working state",
    briefing:
      "A forced missed step leaves the pair one cell apart. Let that offset place the workers at different useful fixtures, then resynchronize at a stopping bay.",
    objective: "Use rather than merely repair an offset while accepting 3 jobs.",
    durationMs: 108_000,
    starThresholds: [1, 2, 3],
    targetJobs: 3,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 1_850,
    interactionFailureRate: 0.3,
    movementFailureRate: 0.3,
    jointProfile: "protected",
    features: {
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: true,
      scriptedMovementFirst: [0, 1],
      dropExpiryEnabled: true,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 7,
    slug: "reciprocal",
    title: "Blame Reversed",
    subtitle: "Neither channel stays protected",
    briefing:
      "Prepared joint risk records can now place the fumble on either worker, although both will not fail together yet. The first record turns the old hierarchy around.",
    objective: "Recover reciprocal faults and accept 3 jobs.",
    durationMs: 112_000,
    starThresholds: [1, 2, 3],
    targetJobs: 3,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 1_750,
    interactionFailureRate: 0.36,
    movementFailureRate: 0.25,
    jointProfile: "reciprocal-no-double",
    features: {
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: true,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: true,
      scriptedPulseFirst: [1, 0],
      dropExpiryEnabled: true,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 8,
    slug: "parallel-service",
    title: "Limited Parallel Work",
    subtitle: "The plant interrupts the circuit",
    briefing:
      "Prestage the next useful object during safe gaps, restart tripped pumps, and keep the current job legible. Production and cooling now compete for the same hands.",
    objective: "Accept 4 jobs while servicing pump trips and limited parallel work.",
    durationMs: 122_000,
    starThresholds: [2, 3, 4],
    targetJobs: 4,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 1_650,
    interactionFailureRate: 0.37,
    movementFailureRate: 0.27,
    jointProfile: "reciprocal-no-double",
    features: {
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: true,
      allowBothFail: false,
      allowPrestage: true,
      usefulOffset: true,
      dropExpiryEnabled: true,
      pumpTrips: true,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 9,
    slug: "compound-state",
    title: "Compound State",
    subtitle: "Temporal and spatial offset coexist",
    briefing:
      "Full joint risk records can fumble both lanes. Multiple hot zones, a blocked coolant line, movement misses, and expired objects can now overlap without changing the basic controls.",
    objective: "Untangle compound offsets and accept 4 jobs.",
    durationMs: 128_000,
    starThresholds: [2, 3, 4],
    targetJobs: 4,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 1_550,
    interactionFailureRate: 0.4,
    movementFailureRate: 0.31,
    jointProfile: "full-joint",
    features: {
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: true,
      allowBothFail: true,
      allowPrestage: true,
      usefulOffset: true,
      dropExpiryEnabled: true,
      pumpTrips: true,
      blockedLines: true,
      multipleHotspots: true,
    },
    heat: THERMAL_STANDARD,
  }),
  level({
    id: 10,
    slug: "full-system",
    title: "The Full Nerveworks",
    subtitle: "Sustain the undercooled machine",
    briefing:
      "All established systems remain active. Finish whole paired service jobs—not isolated shots—while preserving cached quantum results and maintaining the classical cryogenic plant.",
    objective: "Accept 5 paired service jobs before the processor shuts down.",
    durationMs: 142_000,
    starThresholds: [3, 4, 5],
    targetJobs: 5,
    dropLifetimeMs: 5_000,
    couplingWindowMs: 1_450,
    interactionFailureRate: 0.43,
    movementFailureRate: 0.34,
    jointProfile: "full-joint",
    features: {
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: true,
      allowBothFail: true,
      allowPrestage: true,
      usefulOffset: true,
      dropExpiryEnabled: true,
      pumpTrips: true,
      blockedLines: true,
      multipleHotspots: true,
    },
    heat: THERMAL_STANDARD,
  }),
];

export function getLevel(levelId: number): LevelConfig {
  const found = LEVELS.find((candidate) => candidate.id === levelId);
  if (!found) throw new Error(`Unknown level ${levelId}`);
  return found;
}

export function starsForJobs(levelConfig: LevelConfig, acceptedJobs: number): number {
  if (acceptedJobs >= levelConfig.starThresholds[2]) return 3;
  if (acceptedJobs >= levelConfig.starThresholds[1]) return 2;
  if (acceptedJobs >= levelConfig.starThresholds[0]) return 1;
  return 0;
}

/** Temporary source compatibility for consumers migrating from the v1 cycle terminology. */
export const starsForCycles = starsForJobs;

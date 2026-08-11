import type { HeatProfile, JobDefinition, LevelConfig, PulseKind } from "./types";

const THERMAL_DEMO: HeatProfile = {
  maximum: 100,
  baselinePerSecond: 0,
  activeJobPerSecond: 0,
  executionImpulse: 2.8,
  fumbleImpulse: 2,
  expiryImpulse: 4,
  coolingPerSecond: 25,
  reservoirDrainPerSecond: 0.08,
  preparationHoldMs: 650,
  preparationValidityMs: null,
  pumpRestartHoldMs: 900,
};

const THERMAL_LATER_GAME: HeatProfile = {
  ...THERMAL_DEMO,
  baselinePerSecond: 0.12,
  activeJobPerSecond: 0.25,
  executionImpulse: 4.5,
  fumbleImpulse: 3,
  coolingPerSecond: 21,
  reservoirDrainPerSecond: 0.34,
  preparationHoldMs: 750,
};

interface DemoJobInput {
  levelId: number;
  label: string;
  left: PulseKind[];
  right: PulseKind[];
  coupledGate?: JobDefinition["coupledGate"];
  courierLane?: JobDefinition["courierLane"];
  deadlineMs?: number | null;
}

function demoJob({
  levelId,
  label,
  left,
  right,
  coupledGate = null,
  courierLane = "A",
  deadlineMs = null,
}: DemoJobInput): JobDefinition {
  return {
    id: `L${levelId}-J1`,
    label,
    pulses: { A: [...left], B: [...right] },
    coupledGate,
    shotQuota: 1,
    maxAttempts: 4,
    maxRejectionRate: 0.55,
    deadlineMs,
    courierLane,
  };
}

function demoLevel(config: Omit<LevelConfig, "targetJobs" | "starThresholds">): LevelConfig {
  return {
    ...config,
    targetJobs: 1,
    starThresholds: [1, 1, 1],
  };
}

export const LEVELS: readonly LevelConfig[] = [
  demoLevel({
    id: 1,
    slug: "solo-service",
    title: "Solo Service",
    subtitle: "One visible worker; two active channels",
    briefing:
      "Complete one short service cycle with Channel B hidden. The second worker still receives every mirrored command behind the signal veil.",
    objective: "Accept, prepare, load H/H, measure one shot, submit, and reset.",
    durationMs: null,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_400,
    interactionFailureRate: 0,
    movementFailureRate: 0,
    jointProfile: "protected",
    demo: {
      lesson: "hidden-pair",
      showHeat: false,
      initialHeat: 12,
      initialHotspotHeat: 16,
    },
    features: {
      laneBPresentation: "veiled",
      interactionRisk: false,
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
    heat: THERMAL_DEMO,
    jobs: [demoJob({ levelId: 1, label: "Hidden Symmetry", left: ["H"], right: ["H"] })],
  }),
  demoLevel({
    id: 2,
    slug: "revealed-pair",
    title: "The Other Pair",
    subtitle: "The same controls; the same service routine",
    briefing:
      "Channel B is revealed. One shared input moves both workers through matching service positions, where each collects and installs the same H cartridge.",
    objective: "Complete one deterministic paired service cycle with both workers visible.",
    durationMs: null,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_300,
    interactionFailureRate: 0,
    movementFailureRate: 0,
    jointProfile: "protected",
    demo: {
      lesson: "synchronous-pair",
      showHeat: false,
      initialHeat: 12,
      initialHotspotHeat: 16,
    },
    features: {
      laneBPresentation: "reveal-on-start",
      interactionRisk: false,
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
    heat: THERMAL_DEMO,
    jobs: [
      demoJob({ levelId: 2, label: "Synchronous Pulse Check", left: ["H"], right: ["H"], courierLane: "B" }),
    ],
  }),
  demoLevel({
    id: 3,
    slug: "protected-risk",
    title: "Protected Risk",
    subtitle: "Quantum-derived faults enter Channel B",
    briefing:
      "Complete the same service cycle. A remains protected while hidden records can disrupt B at the pulse bay and any marked movement address; recover, realign, then finish the job.",
    objective: "Complete the full paired service cycle while recovering the protected action and movement faults.",
    durationMs: null,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_150,
    interactionFailureRate: 0.32,
    movementFailureRate: 0.32,
    jointProfile: "protected",
    // This simulator seed prefetches 01, 01, 00 at the central transfer tile;
    // the stopping rail makes the two delayed steps recoverable.
    manifestSeed: 205,
    demo: {
      lesson: "protected-risk",
      showHeat: false,
      initialHeat: 12,
      initialHotspotHeat: 16,
    },
    features: {
      laneBPresentation: "visible",
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: true,
      scriptedPulseFirst: [0, 1],
      scriptedPulseRecords: [[0, 1], [0, 0]],
      scriptedReadoutRecords: [[0, 0], [0, 1], [0, 0]],
      movementRiskTiles: [
        { position: { x: 1, y: 2 } },
        { position: { x: 2, y: 2 } },
        { position: { x: 3, y: 2 } },
      ],
      dropExpiryEnabled: false,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_DEMO,
    jobs: [
      demoJob({
        levelId: 3,
        label: "Protected Transfer",
        left: ["H"],
        right: ["H"],
        courierLane: "A",
      }),
    ],
  }),
  demoLevel({
    id: 4,
    slug: "joint-risk",
    title: "Joint Risk",
    subtitle: "No protected side; coupled failure and physical cooling",
    briefing:
      "Complete the whole service cycle with protection removed. Recover joint and movement faults, then cool the glowing manifolds as the simulated Quantum Blur thermal view clears.",
    objective: "Complete the full paired service cycle through joint risk and hands-on cooling.",
    durationMs: 150_000,
    dropLifetimeMs: 12_000,
    couplingWindowMs: 1_750,
    interactionFailureRate: 0.4,
    movementFailureRate: 0.31,
    jointProfile: "full-joint",
    // This simulator seed keeps the established pulse fault and prepares
    // recoverable movement records across the three distinct tile addresses.
    manifestSeed: 21_557,
    demo: {
      lesson: "joint-risk",
      showHeat: true,
      initialHeat: 64,
      initialHotspotHeat: 80,
    },
    features: {
      laneBPresentation: "visible",
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: true,
      allowBothFail: true,
      allowPrestage: false,
      usefulOffset: true,
      scriptedCoupleRecords: [[1, 1], [1, 0], [0, 0]],
      scriptedReadoutRecords: [[0, 0], [0, 1], [0, 0]],
      movementRiskTiles: [
        { position: { x: 1, y: 2 } },
        { position: { x: 2, y: 2 } },
        { position: { x: 3, y: 2 } },
      ],
      dropExpiryEnabled: true,
      pumpTrips: false,
      blockedLines: false,
      multipleHotspots: false,
    },
    heat: THERMAL_LATER_GAME,
    jobs: [
      demoJob({
        levelId: 4,
        label: "Coupled Stress Test",
        left: ["H"],
        right: ["H"],
        coupledGate: "CX",
        courierLane: "B",
        deadlineMs: null,
      }),
    ],
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

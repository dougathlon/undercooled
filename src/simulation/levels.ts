import type { HeatProfile, JobDefinition, LevelConfig, PulseKind } from "./types";

const THERMAL_DEMO: HeatProfile = {
  maximum: 100,
  baselinePerSecond: 0.08,
  activeJobPerSecond: 0.16,
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
  baselinePerSecond: 0.28,
  activeJobPerSecond: 0.54,
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
    subtitle: "The same controls; different local work",
    briefing:
      "Channel B is revealed. One shared input moves the workers in mirrored screen directions, while contextual actions let A fetch H and B fetch X.",
    objective: "Complete one deterministic paired service cycle with both workers visible.",
    durationMs: null,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_300,
    interactionFailureRate: 0,
    movementFailureRate: 0,
    jointProfile: "protected",
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
      demoJob({ levelId: 2, label: "Asymmetric Pulse Check", left: ["H"], right: ["X"], courierLane: "B" }),
    ],
  }),
  demoLevel({
    id: 3,
    slug: "protected-risk",
    title: "Protected Risk",
    subtitle: "Quantum-derived faults enter Channel B",
    briefing:
      "A remains protected. The first scripted demonstration record drops B's cartridge; later prefetched simulator records can make B miss a transfer step.",
    objective: "Recover B's drop, resynchronize at the stopping rail, then finish and reset one cycle.",
    durationMs: null,
    dropLifetimeMs: 9_000,
    couplingWindowMs: 2_150,
    interactionFailureRate: 0.32,
    movementFailureRate: 0.32,
    jointProfile: "protected",
    manifestSeed: 31,
    features: {
      laneBPresentation: "visible",
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: false,
      allowBothFail: false,
      allowPrestage: false,
      usefulOffset: true,
      scriptedPulseFirst: [0, 1],
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
        left: ["H", "P"],
        right: ["X", "H"],
        courierLane: "A",
      }),
    ],
  }),
  demoLevel({
    id: 4,
    slug: "joint-risk",
    title: "Joint Risk",
    subtitle: "No protected side; later-game pressure",
    briefing:
      "Prepared joint risk records can now affect A, B, or both. A coupled gate, expiring drops, transfer misses, and rising thermal load make this the busy later-game demonstration.",
    objective: "Complete a coupled cycle while recovering bilateral faults and maintaining the external cooling plant.",
    durationMs: 140_000,
    dropLifetimeMs: 6_500,
    couplingWindowMs: 1_750,
    interactionFailureRate: 0.4,
    movementFailureRate: 0.31,
    jointProfile: "full-joint",
    manifestSeed: 19_695,
    features: {
      laneBPresentation: "visible",
      interactionRisk: true,
      movementRisk: true,
      reciprocalRisk: true,
      allowBothFail: true,
      allowPrestage: false,
      usefulOffset: true,
      dropExpiryEnabled: true,
      pumpTrips: true,
      blockedLines: false,
      multipleHotspots: true,
    },
    heat: THERMAL_LATER_GAME,
    jobs: [
      demoJob({
        levelId: 4,
        label: "Coupled Stress Test",
        left: ["H", "P"],
        right: ["X", "H"],
        coupledGate: "CX",
        courierLane: "B",
        deadlineMs: 140_000,
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

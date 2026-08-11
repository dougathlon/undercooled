export type LaneId = "A" | "B";
export type Direction = "up" | "down" | "in" | "out";
export type TriggerType = "interaction" | "movement";
export type Provenance = "scripted" | "hardware" | "simulator";
export type ManifestDerivation = "protected-single" | "prepared-joint" | "circuit-shot";
export type Bit = 0 | 1;
export type BitPair = readonly [Bit, Bit];
export type PulseKind = "H" | "X" | "P";
export type CoupledGate = "CX" | "CZ";

export interface GridPosition {
  x: number;
  y: number;
}

export type ItemKind =
  | "pulse-H"
  | "pulse-X"
  | "pulse-P"
  | "coupling-half"
  | "empty-canister"
  | "result-canister"
  | "coolant-cell"
  | "cryo-lance";

export type ItemLocation =
  | { kind: "held"; lane: LaneId }
  | { kind: "dropped"; lane: LaneId; position: GridPosition }
  | { kind: "installed"; lane: LaneId; fixture: "pulse" | "couple" | "readout" }
  | { kind: "discarded" };

export interface ItemState {
  id: string;
  kind: ItemKind;
  lane: LaneId;
  jobId: string | null;
  location: ItemLocation;
  charge: number | null;
  expiresAtMs: number | null;
  faultId: number | null;
}

export type ActorPose =
  | "idle"
  | "carry"
  | "success"
  | "fumble"
  | "recover"
  | "missed"
  | "operate"
  | "spray";

export interface ActorState {
  position: GridPosition;
  facing: Direction;
  heldItemId: string | null;
  pose: ActorPose;
  poseUntilMs: number;
  lastMoveAtMs: number;
}

export interface LaneJobState {
  prepared: boolean;
  preparationProgressMs: number;
  preparationExpiresAtMs: number | null;
  loadedPulses: PulseKind[];
  pulseItemIds: string[];
  couplingInstalled: boolean;
  couplingItemId: string | null;
  couplingArmedAtMs: number | null;
  pumpProgressMs: number;
  resetArmed: boolean;
  consecutiveFailures: number;
}

export interface LaneState {
  actor: ActorState;
  job: LaneJobState;
  replacementKind: ItemKind | null;
}

export interface JobDefinition {
  id: string;
  label: string;
  pulses: Record<LaneId, PulseKind[]>;
  coupledGate: CoupledGate | null;
  shotQuota: number;
  maxAttempts: number;
  maxRejectionRate: number;
  deadlineMs: number | null;
  courierLane: LaneId;
}

export type JobStage =
  | "accept"
  | "prepare"
  | "load"
  | "couple-install"
  | "couple-arm"
  | "canister"
  | "run"
  | "submission"
  | "reset";

export interface ShotAttempt {
  recordId: string;
  bits: BitPair;
  source: Provenance;
  accepted: boolean;
  rejectionReason: "thermal-service" | "wrong-circuit" | "stale-preparation" | null;
}

export interface JobState {
  definition: JobDefinition;
  stage: JobStage;
  acceptedAtMs: number | null;
  deadlineAtMs: number | null;
  canisterItemId: string | null;
  canisterAttached: boolean;
  canisterValid: boolean;
  shotAttempts: ShotAttempt[];
  validShots: number;
  rejectedAttempts: number;
  wrongCircuit: boolean;
  resultReady: boolean;
}

export type ProcessorPhase = "idle" | "armed" | "executing" | "readout" | "resetting";

export interface ProcessorState {
  phase: ProcessorPhase;
  phaseEndsAtMs: number | null;
  completedJobs: number;
  rejectedJobs: number;
}

export interface HotspotState {
  id: string;
  lane: LaneId;
  position: GridPosition;
  heat: number;
  active: boolean;
  blockedLine: boolean;
}

export type ThermalBand = "nominal" | "warm" | "hot" | "critical";

export interface CoolingPlantState {
  load: number;
  band: ThermalBand;
  reservoir: Record<LaneId, number>;
  pumpTripped: Record<LaneId, boolean>;
  hotspots: HotspotState[];
  completedServices: number;
  alarmed: boolean;
}

export interface RiskRecord {
  id: string;
  sampleIndex: number;
  address: string;
  trigger: TriggerType;
  bits: BitPair;
  derivation: Exclude<ManifestDerivation, "circuit-shot">;
  source: Provenance;
  circuitId?: string;
  measuredAt?: string;
}

export interface ShotRecord {
  id: string;
  jobId: string;
  sampleIndex: number;
  bits: BitPair;
  derivation: "circuit-shot";
  source: Provenance;
  circuitId?: string;
  measuredAt?: string;
}

export interface RiskStreamState {
  address: string;
  trigger: TriggerType;
  records: RiskRecord[];
  cursor: number;
}

export interface ShotStreamState {
  jobId: string;
  records: ShotRecord[];
  cursor: number;
}

export interface ManifestBundle {
  format: "undercooled-manifest-v2";
  seed: number;
  riskStreams: Record<string, RiskStreamState>;
  shotStreams: Record<string, ShotStreamState>;
  lastRisk: RiskRecord | null;
  lastShot: ShotRecord | null;
}

export interface ScoreState {
  acceptedJobs: number;
  rejectedJobs: number;
  validShots: number;
  rejectedShots: number;
  recoveries: number;
  expiries: number;
  bypasses: number;
  shutdowns: number;
  mixedActions: number;
}

export type RunPhase = "briefing" | "running" | "paused" | "complete" | "shutdown";

export type GameEventType =
  | "level-started"
  | "lane-revealed"
  | "job-accepted"
  | "stage-changed"
  | "risk-consumed"
  | "shot-consumed"
  | "item-collected"
  | "item-installed"
  | "item-returned"
  | "fumble"
  | "missed-step"
  | "recovery-picked-up"
  | "object-expired"
  | "preparation-complete"
  | "coupling-armed"
  | "shot-accepted"
  | "shot-rejected"
  | "canister-ready"
  | "job-submitted"
  | "job-rejected"
  | "processor-reset"
  | "cooling-started"
  | "cooling-completed"
  | "coolant-installed"
  | "pump-restarted"
  | "maintenance-lock"
  | "local-collision"
  | "mixed-context"
  | "emergency-shutdown"
  | "level-completed"
  | "level-failed"
  | "abandoned";

export interface GameEvent {
  id: number;
  atMs: number;
  type: GameEventType;
  message: string;
  lane?: LaneId;
  address?: string;
  bits?: BitPair;
  source?: Provenance;
  participants?: LaneId[];
  itemId?: string;
  jobId?: string;
}

export type JointProfile = "protected" | "reciprocal-no-double" | "full-joint";
export type LaneBPresentation = "veiled" | "reveal-on-start" | "visible";
export type DemoLesson = "hidden-pair" | "synchronous-pair" | "protected-risk" | "joint-risk";

export interface DemoFlowConfig {
  lesson: DemoLesson;
  showHeat: boolean;
  initialHeat: number;
  initialHotspotHeat: number;
}

export interface HeatProfile {
  maximum: number;
  baselinePerSecond: number;
  activeJobPerSecond: number;
  executionImpulse: number;
  fumbleImpulse: number;
  expiryImpulse: number;
  coolingPerSecond: number;
  reservoirDrainPerSecond: number;
  preparationHoldMs: number;
  preparationValidityMs: number | null;
  pumpRestartHoldMs: number;
}

export interface MovementRiskTile {
  position: GridPosition;
  scriptedRecords?: readonly BitPair[];
}

export interface LevelFeatures {
  laneBPresentation: LaneBPresentation;
  interactionRisk: boolean;
  movementRisk: boolean;
  reciprocalRisk: boolean;
  allowBothFail: boolean;
  allowPrestage: boolean;
  usefulOffset: boolean;
  guidedCoolingAfterJobs?: number;
  scriptedPulseFirst?: BitPair;
  scriptedMovementFirst?: BitPair;
  scriptedPulseRecords?: readonly BitPair[];
  scriptedCoupleRecords?: readonly BitPair[];
  scriptedReadoutRecords?: readonly BitPair[];
  scriptedMovementRecords?: readonly BitPair[];
  movementRiskTiles?: readonly MovementRiskTile[];
  dropExpiryEnabled: boolean;
  pumpTrips: boolean;
  blockedLines: boolean;
  multipleHotspots: boolean;
}

export interface LevelConfig {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  briefing: string;
  objective: string;
  durationMs: number | null;
  starThresholds: readonly [number, number, number];
  targetJobs: number;
  dropLifetimeMs: number;
  couplingWindowMs: number;
  interactionFailureRate: number;
  movementFailureRate: number;
  jointProfile: JointProfile;
  manifestSeed?: number;
  demo: DemoFlowConfig;
  features: LevelFeatures;
  heat: HeatProfile;
  jobs: JobDefinition[];
}

export interface GameState {
  format: "undercooled-state-v2";
  phase: RunPhase;
  level: LevelConfig;
  simTimeMs: number;
  shiftRemainingMs: number | null;
  currentJobIndex: number;
  currentJob: JobState;
  processor: ProcessorState;
  lanes: Record<LaneId, LaneState>;
  items: Record<string, ItemState>;
  manifest: ManifestBundle;
  cooling: CoolingPlantState;
  score: ScoreState;
  interactHeld: boolean;
  activeHoldLanes: LaneId[];
  laneBRevealed: boolean;
  nextItemId: number;
  nextFaultId: number;
  nextEventId: number;
  events: GameEvent[];
}

export type SimulationCommand =
  | { type: "start" }
  | { type: "move"; direction: Direction }
  | { type: "interact-down" }
  | { type: "interact-up" }
  | { type: "pause-toggle" }
  | { type: "abandon" };

export const LANE_IDS: readonly LaneId[] = ["A", "B"];

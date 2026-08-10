import {
  COUPLE_POSITION,
  LANCE_RACK_POSITION,
  MOVEMENT_RISK_POSITION,
  PREP_POSITION,
  PULSE_POSITION,
  PUMP_POSITION,
  READOUT_POSITION,
  RESERVOIR_POSITION,
  START_POSITION,
  SUBMIT_POSITION,
  SUPPLY_POSITIONS,
  bufferForFixture,
  isBlocked,
  moveTarget,
  riskAddress,
  samePosition,
} from "./geometry";
import { LEVELS, getLevel, starsForJobs } from "./levels";
import {
  consumeRisk,
  consumeShot,
  createManifestBundle,
  importHardwareBundle,
  type ImportedManifestBundle,
} from "./manifest";
import type {
  ActorPose,
  BitPair,
  Direction,
  GameEvent,
  GameEventType,
  GameState,
  ItemKind,
  ItemState,
  JobDefinition,
  JobStage,
  JobState,
  LaneId,
  LaneJobState,
  LaneState,
  LevelConfig,
  PulseKind,
  RiskRecord,
  SimulationCommand,
  ThermalBand,
} from "./types";
import { LANE_IDS } from "./types";

const POSE_DURATION_MS = 620;
const MOVE_LOCK_MS = 135;
const THERMAL_REJECTION_THRESHOLD = 75;
const LANCE_CHARGE_PER_SECOND = 15;
const RESERVOIR_CELL_CAPACITY = 48;
const MAX_EVENTS = 900;
const CLASSICAL_BYPASS_AFTER = 3;

type Fixture = "pulse" | "couple" | "readout";

type InteractionIntent =
  | { kind: "pickup-dropped"; itemId: string }
  | { kind: "pickup-lance" }
  | { kind: "return-lance" }
  | { kind: "pickup-pulse"; pulse: PulseKind }
  | { kind: "pickup-prestage"; pulse: PulseKind; jobId: string }
  | { kind: "pickup-aux"; itemKind: ItemKind }
  | { kind: "stage-prepulse" }
  | { kind: "install-pulse" }
  | { kind: "install-couple" }
  | { kind: "install-canister" }
  | { kind: "install-coolant" }
  | { kind: "prepare" }
  | { kind: "arm-couple" }
  | { kind: "run" }
  | { kind: "pickup-result" }
  | { kind: "submit" }
  | { kind: "reset" }
  | { kind: "pump" }
  | { kind: "spray" }
  | { kind: "accept" }
  | { kind: "noop" };

function laneBit(bits: BitPair, laneId: LaneId): 0 | 1 {
  return bits[laneId === "A" ? 0 : 1];
}

function pulseItemKind(pulse: PulseKind): ItemKind {
  return `pulse-${pulse}`;
}

function itemPulse(kind: ItemKind): PulseKind | null {
  if (kind === "pulse-H") return "H";
  if (kind === "pulse-X") return "X";
  if (kind === "pulse-P") return "P";
  return null;
}

function createLaneJobState(): LaneJobState {
  return {
    prepared: false,
    preparationProgressMs: 0,
    preparationExpiresAtMs: null,
    loadedPulses: [],
    pulseItemIds: [],
    couplingInstalled: false,
    couplingItemId: null,
    couplingArmedAtMs: null,
    pumpProgressMs: 0,
    resetArmed: false,
    consecutiveFailures: 0,
  };
}

function createLane(): LaneState {
  return {
    actor: {
      position: { ...START_POSITION },
      facing: "up",
      heldItemId: null,
      pose: "idle",
      poseUntilMs: 0,
      lastMoveAtMs: -MOVE_LOCK_MS,
    },
    job: createLaneJobState(),
    replacementKind: null,
  };
}

function createJobState(definition: JobDefinition): JobState {
  return {
    definition,
    stage: "accept",
    acceptedAtMs: null,
    deadlineAtMs: null,
    canisterItemId: null,
    canisterAttached: false,
    canisterValid: true,
    shotAttempts: [],
    validShots: 0,
    rejectedAttempts: 0,
    wrongCircuit: false,
    resultReady: false,
  };
}

function thermalBand(load: number): ThermalBand {
  if (load < 60) return "nominal";
  if (load < 75) return "warm";
  if (load < 90) return "hot";
  return "critical";
}

export function createGameState(levelId: number, seed?: number): GameState {
  const level = getLevel(levelId);
  const manifestSeed = seed ?? level.manifestSeed ?? levelId * 10_007;
  const hotspots = LANE_IDS.flatMap((laneId) => {
    const primary = {
      id: `${laneId}-manifold-1`,
      lane: laneId,
      position: { x: 4, y: 1 },
      heat: 16,
      active: true,
      blockedLine: level.features.blockedLines && laneId === "B",
    };
    if (!level.features.multipleHotspots) return [primary];
    return [
      primary,
      {
        id: `${laneId}-manifold-2`,
        lane: laneId,
        position: { x: 4, y: 2 },
        heat: 12,
        active: true,
        blockedLine: level.features.blockedLines && laneId === "A",
      },
    ];
  });

  return {
    format: "undercooled-state-v2",
    phase: "briefing",
    level,
    simTimeMs: 0,
    shiftRemainingMs: level.durationMs,
    currentJobIndex: 0,
    currentJob: createJobState(level.jobs[0]),
    processor: {
      phase: "idle",
      phaseEndsAtMs: null,
      completedJobs: 0,
      rejectedJobs: 0,
    },
    lanes: { A: createLane(), B: createLane() },
    items: {},
    manifest: createManifestBundle(level, manifestSeed),
    cooling: {
      load: 12,
      band: "nominal",
      reservoir: { A: 100, B: 100 },
      pumpTripped: { A: false, B: false },
      hotspots,
      completedServices: 0,
      alarmed: false,
    },
    score: {
      acceptedJobs: 0,
      rejectedJobs: 0,
      validShots: 0,
      rejectedShots: 0,
      recoveries: 0,
      expiries: 0,
      bypasses: 0,
      shutdowns: 0,
      mixedActions: 0,
    },
    interactHeld: false,
    activeHoldLanes: [],
    laneBRevealed: level.features.laneBPresentation === "visible",
    nextItemId: 1,
    nextFaultId: 1,
    nextEventId: 1,
    events: [],
  };
}

function addEvent(
  state: GameState,
  type: GameEventType,
  message: string,
  details: Partial<Omit<GameEvent, "id" | "atMs" | "type" | "message">> = {},
): void {
  state.events.push({
    id: state.nextEventId,
    atMs: state.simTimeMs,
    type,
    message,
    ...details,
  });
  state.nextEventId += 1;
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function setPose(state: GameState, laneId: LaneId, pose: ActorPose, durationMs = POSE_DURATION_MS): void {
  const actor = state.lanes[laneId].actor;
  actor.pose = pose;
  actor.poseUntilMs = state.simTimeMs + durationMs;
}

function heldItem(state: GameState, laneId: LaneId): ItemState | null {
  const id = state.lanes[laneId].actor.heldItemId;
  return id === null ? null : state.items[id] ?? null;
}

function createItem(
  state: GameState,
  laneId: LaneId,
  kind: ItemKind,
  jobId: string | null,
  charge: number | null = null,
): ItemState {
  const id = `item-${state.nextItemId}`;
  state.nextItemId += 1;
  const item: ItemState = {
    id,
    kind,
    lane: laneId,
    jobId,
    location: { kind: "held", lane: laneId },
    charge,
    expiresAtMs: null,
    faultId: null,
  };
  state.items[id] = item;
  state.lanes[laneId].actor.heldItemId = id;
  setPose(state, laneId, "carry", 300);
  addEvent(state, "item-collected", `Channel ${laneId} collected ${kind}.`, {
    lane: laneId,
    itemId: id,
    jobId: jobId ?? undefined,
  });
  return item;
}

function discardItem(state: GameState, item: ItemState): void {
  item.location = { kind: "discarded" };
  if (state.lanes[item.lane].actor.heldItemId === item.id) {
    state.lanes[item.lane].actor.heldItemId = null;
  }
}

function setStage(state: GameState, stage: JobStage): void {
  if (state.currentJob.stage === stage) return;
  state.currentJob.stage = stage;
  addEvent(state, "stage-changed", `Job advanced to ${stage}.`, {
    jobId: state.currentJob.definition.id,
  });
}

function topCounterReady(state: GameState, laneId: LaneId, position: { x: number; y: number }): boolean {
  const actor = state.lanes[laneId].actor;
  return samePosition(actor.position, position) && actor.facing === "up";
}

function droppedAtActor(state: GameState, laneId: LaneId): ItemState | null {
  const actor = state.lanes[laneId].actor;
  if (actor.heldItemId !== null) return null;
  return (
    Object.values(state.items).find(
      (item) =>
        item.lane === laneId &&
        item.jobId === state.currentJob.definition.id &&
        item.location.kind === "dropped" &&
        samePosition(item.location.position, actor.position),
    ) ?? null
  );
}

function nextJob(state: GameState): JobDefinition {
  return state.level.jobs[(state.currentJobIndex + 1) % state.level.jobs.length];
}

function hasPrestageItem(state: GameState, laneId: LaneId, jobId: string): boolean {
  return Object.values(state.items).some(
    (item) =>
      item.lane === laneId &&
      item.jobId === jobId &&
      itemPulse(item.kind) !== null &&
      item.location.kind !== "discarded",
  );
}

function replacementAtSupply(state: GameState, laneId: LaneId): ItemKind | null {
  const replacement = state.lanes[laneId].replacementKind;
  if (replacement === null) return null;
  const actor = state.lanes[laneId].actor;
  if (replacement.startsWith("pulse-")) {
    const pulse = itemPulse(replacement);
    if (pulse && samePosition(actor.position, SUPPLY_POSITIONS[pulse]) && actor.facing === "out") {
      return replacement;
    }
    return null;
  }
  if (samePosition(actor.position, SUPPLY_POSITIONS.AUX) && actor.facing === "out") {
    return replacement;
  }
  return null;
}

function interactionIntent(state: GameState, laneId: LaneId): InteractionIntent {
  const lane = state.lanes[laneId];
  const actor = lane.actor;
  const item = heldItem(state, laneId);
  const dropped = droppedAtActor(state, laneId);
  if (dropped) return { kind: "pickup-dropped", itemId: dropped.id };

  if (item?.kind === "cryo-lance") {
    if (samePosition(actor.position, LANCE_RACK_POSITION) && actor.facing === "down") {
      return { kind: "return-lance" };
    }
    return { kind: "spray" };
  }

  if (
    item?.kind === "coolant-cell" &&
    samePosition(actor.position, RESERVOIR_POSITION) &&
    actor.facing === "in"
  ) {
    return { kind: "install-coolant" };
  }

  if (
    item === null &&
    samePosition(actor.position, PUMP_POSITION) &&
    actor.facing === "down" &&
    state.cooling.pumpTripped[laneId]
  ) {
    return { kind: "pump" };
  }

  if (item === null && samePosition(actor.position, LANCE_RACK_POSITION) && actor.facing === "down") {
    return { kind: "pickup-lance" };
  }

  const replacement = item === null ? replacementAtSupply(state, laneId) : null;
  if (replacement !== null) {
    const pulse = itemPulse(replacement);
    return pulse ? { kind: "pickup-pulse", pulse } : { kind: "pickup-aux", itemKind: replacement };
  }

  const job = state.currentJob;
  if (job.stage === "accept" && item === null && topCounterReady(state, laneId, READOUT_POSITION)) {
    return { kind: "accept" };
  }
  if (job.stage === "prepare" && item === null && topCounterReady(state, laneId, PREP_POSITION)) {
    return { kind: "prepare" };
  }
  if (job.stage === "load") {
    if (itemPulse(item?.kind ?? "empty-canister") && topCounterReady(state, laneId, PULSE_POSITION)) {
      return { kind: "install-pulse" };
    }
    if (item === null && actor.facing === "out") {
      const expected = job.definition.pulses[laneId][lane.job.loadedPulses.length];
      const expectedItemAlreadyExists = Object.values(state.items).some(
        (candidate) =>
          candidate.lane === laneId &&
          candidate.jobId === job.definition.id &&
          candidate.kind === pulseItemKind(expected) &&
          candidate.location.kind !== "discarded" &&
          candidate.location.kind !== "installed",
      );
      if (
        expected !== undefined &&
        !expectedItemAlreadyExists &&
        samePosition(actor.position, SUPPLY_POSITIONS[expected])
      ) {
        return { kind: "pickup-pulse", pulse: expected };
      }
    }
  }
  if (job.stage === "couple-install") {
    if (item?.kind === "coupling-half" && topCounterReady(state, laneId, COUPLE_POSITION)) {
      return { kind: "install-couple" };
    }
    if (
      item === null &&
      samePosition(actor.position, SUPPLY_POSITIONS.AUX) &&
      actor.facing === "out" &&
      !lane.job.couplingInstalled
    ) {
      return { kind: "pickup-aux", itemKind: "coupling-half" };
    }
  }
  if (job.stage === "couple-arm" && item === null && topCounterReady(state, laneId, COUPLE_POSITION)) {
    return { kind: "arm-couple" };
  }
  if (job.stage === "canister") {
    if (item?.kind === "empty-canister" && topCounterReady(state, laneId, READOUT_POSITION)) {
      return { kind: "install-canister" };
    }
    if (
      laneId === job.definition.courierLane &&
      item === null &&
      samePosition(actor.position, SUPPLY_POSITIONS.AUX) &&
      actor.facing === "out"
    ) {
      return { kind: "pickup-aux", itemKind: "empty-canister" };
    }
  }
  if (job.stage === "run" && item === null && topCounterReady(state, laneId, READOUT_POSITION)) {
    return { kind: "run" };
  }
  if (job.stage === "submission") {
    if (
      laneId === job.definition.courierLane &&
      item === null &&
      topCounterReady(state, laneId, READOUT_POSITION) &&
      job.resultReady
    ) {
      return { kind: "pickup-result" };
    }
    if (item?.kind === "result-canister" && topCounterReady(state, laneId, SUBMIT_POSITION)) {
      return { kind: "submit" };
    }
  }
  if (job.stage === "reset" && item === null && topCounterReady(state, laneId, READOUT_POSITION)) {
    return { kind: "reset" };
  }

  if (state.level.features.allowPrestage && (job.stage === "run" || job.stage === "submission")) {
    const upcoming = nextJob(state);
    const firstPulse = upcoming.pulses[laneId][0];
    if (
      item !== null &&
      item.jobId === upcoming.id &&
      item.kind === pulseItemKind(firstPulse) &&
      samePosition(actor.position, bufferForFixture("pulse"))
    ) {
      return { kind: "stage-prepulse" };
    }
    if (
      item === null &&
      actor.facing === "out" &&
      !hasPrestageItem(state, laneId, upcoming.id) &&
      samePosition(actor.position, SUPPLY_POSITIONS[firstPulse])
    ) {
      return { kind: "pickup-prestage", pulse: firstPulse, jobId: upcoming.id };
    }
  }

  if (
    item === null &&
    samePosition(actor.position, SUPPLY_POSITIONS.AUX) &&
    actor.facing === "out" &&
    state.cooling.reservoir[laneId] < 65
  ) {
    return { kind: "pickup-aux", itemKind: "coolant-cell" };
  }
  return { kind: "noop" };
}

function pickUpDropped(state: GameState, laneId: LaneId, itemId: string): void {
  const actor = state.lanes[laneId].actor;
  const item = state.items[itemId];
  if (!item || actor.heldItemId !== null || item.location.kind !== "dropped") return;
  item.location = { kind: "held", lane: laneId };
  item.expiresAtMs = null;
  actor.heldItemId = item.id;
  state.score.recoveries += 1;
  setPose(state, laneId, "recover", 760);
  addEvent(state, "recovery-picked-up", `Channel ${laneId} recovered ${item.kind}.`, {
    lane: laneId,
    itemId,
    jobId: item.jobId ?? undefined,
  });
}

function returnLance(state: GameState, laneId: LaneId): void {
  const item = heldItem(state, laneId);
  if (item?.kind !== "cryo-lance") return;
  discardItem(state, item);
  state.cooling.completedServices += 1;
  setPose(state, laneId, "success");
  addEvent(state, "item-returned", `Channel ${laneId} returned the cryo lance for recharge.`, {
    lane: laneId,
    itemId: item.id,
  });
}

function collectSupply(state: GameState, laneId: LaneId, kind: ItemKind): void {
  if (heldItem(state, laneId)) return;
  createItem(
    state,
    laneId,
    kind,
    kind === "cryo-lance" || kind === "coolant-cell" ? null : state.currentJob.definition.id,
    kind === "cryo-lance" ? 100 : kind === "coolant-cell" ? RESERVOIR_CELL_CAPACITY : null,
  );
  if (state.lanes[laneId].replacementKind === kind) state.lanes[laneId].replacementKind = null;
}

function collectPrestage(
  state: GameState,
  laneId: LaneId,
  pulse: PulseKind,
  jobId: string,
): void {
  if (heldItem(state, laneId) || hasPrestageItem(state, laneId, jobId)) return;
  createItem(state, laneId, pulseItemKind(pulse), jobId);
}

function stagePrepulse(state: GameState, laneId: LaneId): void {
  const item = heldItem(state, laneId);
  if (!item || itemPulse(item.kind) === null || item.jobId !== nextJob(state).id) return;
  item.location = {
    kind: "dropped",
    lane: laneId,
    position: bufferForFixture("pulse"),
  };
  item.expiresAtMs = null;
  item.faultId = null;
  state.lanes[laneId].actor.heldItemId = null;
  setPose(state, laneId, "success");
  addEvent(state, "item-installed", `Channel ${laneId} staged ${item.kind} for ${item.jobId}.`, {
    lane: laneId,
    itemId: item.id,
    jobId: item.jobId ?? undefined,
  });
}

function consumeRiskFor(
  state: GameState,
  fixture: string,
  participants: LaneId[],
): RiskRecord | null {
  if (!state.level.features.interactionRisk) return null;
  const address = riskAddress(state.level.id, fixture, "interaction");
  const record = consumeRisk(state.manifest, address);
  if (record) {
    addEvent(state, "risk-consumed", `${record.source.toUpperCase()} risk ${record.sampleIndex}: ${record.bits.join("")}.`, {
      address,
      bits: record.bits,
      source: record.source,
      participants: [...participants],
      jobId: state.currentJob.definition.id,
    });
  }
  return record;
}

function dropHeldItem(state: GameState, laneId: LaneId, fixture: Fixture): void {
  const item = heldItem(state, laneId);
  if (!item) return;
  const faultId = state.nextFaultId;
  state.nextFaultId += 1;
  item.location = { kind: "dropped", lane: laneId, position: bufferForFixture(fixture) };
  item.expiresAtMs = state.level.features.dropExpiryEnabled
    ? state.simTimeMs + state.level.dropLifetimeMs
    : null;
  item.faultId = faultId;
  state.lanes[laneId].actor.heldItemId = null;
  state.lanes[laneId].job.consecutiveFailures += 1;
  state.cooling.load += state.level.heat.fumbleImpulse;
  setPose(state, laneId, "fumble", 940);
  addEvent(state, "fumble", `Channel ${laneId} fumbled ${item.kind} into its reserved buffer.`, {
    lane: laneId,
    itemId: item.id,
    jobId: item.jobId ?? undefined,
  });
}

function installItem(state: GameState, laneId: LaneId, fixture: Fixture): void {
  const item = heldItem(state, laneId);
  if (!item) return;
  item.location = { kind: "installed", lane: laneId, fixture };
  item.expiresAtMs = null;
  item.faultId = null;
  state.lanes[laneId].actor.heldItemId = null;
  state.lanes[laneId].job.consecutiveFailures = 0;
  setPose(state, laneId, "success");
  addEvent(state, "item-installed", `Channel ${laneId} installed ${item.kind}.`, {
    lane: laneId,
    itemId: item.id,
    jobId: item.jobId ?? undefined,
  });
}

function installationFailed(state: GameState, laneId: LaneId, record: RiskRecord | null): boolean {
  const lane = state.lanes[laneId];
  if (lane.job.consecutiveFailures >= CLASSICAL_BYPASS_AFTER) {
    lane.job.consecutiveFailures = 0;
    state.score.bypasses += 1;
    addEvent(state, "maintenance-lock", `Channel ${laneId} received a classical safety bypass.`, {
      lane: laneId,
    });
    return false;
  }
  return record !== null && laneBit(record.bits, laneId) === 1;
}

function installPulses(state: GameState, lanes: LaneId[]): void {
  if (lanes.length === 0) return;
  const record = consumeRiskFor(state, "PULSE", lanes);
  for (const laneId of lanes) {
    const item = heldItem(state, laneId);
    const pulse = item ? itemPulse(item.kind) : null;
    if (!item || !pulse) continue;
    if (installationFailed(state, laneId, record)) {
      dropHeldItem(state, laneId, "pulse");
      continue;
    }
    const expected = state.currentJob.definition.pulses[laneId][state.lanes[laneId].job.loadedPulses.length];
    if (pulse !== expected) state.currentJob.wrongCircuit = true;
    installItem(state, laneId, "pulse");
    state.lanes[laneId].job.loadedPulses.push(pulse);
    state.lanes[laneId].job.pulseItemIds.push(item.id);
  }
  const loaded = LANE_IDS.every(
    (laneId) =>
      state.lanes[laneId].job.loadedPulses.length >=
      state.currentJob.definition.pulses[laneId].length,
  );
  if (loaded) setStage(state, state.currentJob.definition.coupledGate ? "couple-install" : "canister");
}

function installCoupling(state: GameState, lanes: LaneId[]): void {
  if (lanes.length === 0) return;
  const record = consumeRiskFor(state, "COUPLE", lanes);
  for (const laneId of lanes) {
    const item = heldItem(state, laneId);
    if (item?.kind !== "coupling-half") continue;
    if (installationFailed(state, laneId, record)) {
      dropHeldItem(state, laneId, "couple");
      continue;
    }
    installItem(state, laneId, "couple");
    state.lanes[laneId].job.couplingInstalled = true;
    state.lanes[laneId].job.couplingItemId = item.id;
  }
  if (LANE_IDS.every((laneId) => state.lanes[laneId].job.couplingInstalled)) {
    setStage(state, "couple-arm");
  }
}

function installCanister(state: GameState, lanes: LaneId[]): void {
  if (lanes.length === 0 || state.currentJob.canisterAttached) return;
  const courier = state.currentJob.definition.courierLane;
  if (!lanes.includes(courier)) return;
  const item = heldItem(state, courier);
  if (item?.kind !== "empty-canister") return;
  const record = consumeRiskFor(state, "READOUT", lanes);
  if (installationFailed(state, courier, record)) {
    dropHeldItem(state, courier, "readout");
    return;
  }
  installItem(state, courier, "readout");
  state.currentJob.canisterItemId = item.id;
  state.currentJob.canisterAttached = true;
  state.processor.phase = "armed";
  setStage(state, "run");
}

function acceptJob(state: GameState, lanes: LaneId[]): void {
  if (lanes.length !== 2) return;
  const job = state.currentJob;
  job.acceptedAtMs = state.simTimeMs;
  job.deadlineAtMs =
    job.definition.deadlineMs === null ? null : state.simTimeMs + job.definition.deadlineMs;
  state.processor.phase = "armed";
  setStage(state, "prepare");
  setPose(state, "A", "success");
  setPose(state, "B", "success");
  addEvent(state, "job-accepted", `Accepted ${job.definition.label} on both output channels.`, {
    jobId: job.definition.id,
  });
}

function armCoupling(state: GameState, lanes: LaneId[]): void {
  if (lanes.length === 0) return;
  const windowScale = state.cooling.band === "hot" ? 0.7 : state.cooling.band === "critical" ? 0.5 : 1;
  const windowMs = state.level.couplingWindowMs * windowScale;
  for (const laneId of lanes) {
    state.lanes[laneId].job.couplingArmedAtMs = state.simTimeMs;
    setPose(state, laneId, "operate", 420);
  }
  const a = state.lanes.A.job.couplingArmedAtMs;
  const b = state.lanes.B.job.couplingArmedAtMs;
  if (a !== null && b !== null && Math.abs(a - b) <= windowMs) {
    addEvent(state, "coupling-armed", "Both coupling halves armed inside the synchronization window.", {
      jobId: state.currentJob.definition.id,
    });
    setStage(state, "canister");
  }
}

function preparationIsFresh(state: GameState): boolean {
  return LANE_IDS.every((laneId) => {
    const lane = state.lanes[laneId].job;
    return lane.prepared &&
      (lane.preparationExpiresAtMs === null || lane.preparationExpiresAtMs >= state.simTimeMs);
  });
}

function thermalServiceRejects(state: GameState): boolean {
  return (
    state.cooling.load >= THERMAL_REJECTION_THRESHOLD ||
    LANE_IDS.some((laneId) => state.cooling.pumpTripped[laneId]) ||
    state.cooling.hotspots.some((hotspot) => hotspot.blockedLine && hotspot.heat >= 35)
  );
}

function rejectionRate(job: JobState): number {
  if (job.shotAttempts.length === 0) return 0;
  return job.rejectedAttempts / job.shotAttempts.length;
}

function ensureResultCanister(state: GameState): ItemState {
  const job = state.currentJob;
  const existing = job.canisterItemId ? state.items[job.canisterItemId] : null;
  if (existing) {
    existing.kind = "result-canister";
    existing.location = { kind: "installed", lane: job.definition.courierLane, fixture: "readout" };
    return existing;
  }
  const courier = job.definition.courierLane;
  const item = createItem(state, courier, "result-canister", job.definition.id);
  state.lanes[courier].actor.heldItemId = null;
  item.location = { kind: "installed", lane: courier, fixture: "readout" };
  job.canisterItemId = item.id;
  return item;
}

function makeCanisterReady(state: GameState, valid: boolean): void {
  if (state.currentJob.resultReady) return;
  if (!valid) {
    // A failed terminal validation must not strand the courier behind an obsolete stage item.
    for (const item of Object.values(state.items)) {
      if (item.jobId === state.currentJob.definition.id && item.kind !== "result-canister") {
        discardItem(state, item);
      }
    }
  }
  const canister = ensureResultCanister(state);
  state.currentJob.resultReady = true;
  state.currentJob.canisterValid = valid;
  state.currentJob.canisterAttached = false;
  state.processor.phase = "armed";
  setStage(state, "submission");
  addEvent(
    state,
    "canister-ready",
    valid ? "The accepted shot quota condensed into a result canister." : "The canister failed service validation.",
    { itemId: canister.id, jobId: state.currentJob.definition.id },
  );
}

function runShot(state: GameState, lanes: LaneId[]): void {
  if (lanes.length !== 2 || state.processor.phase === "readout") return;
  const risk = consumeRiskFor(state, "READOUT", lanes);
  const failed: LaneId[] = [];
  for (const laneId of LANE_IDS) {
    if (risk === null || laneBit(risk.bits, laneId) === 0) continue;
    if (state.lanes[laneId].job.consecutiveFailures >= CLASSICAL_BYPASS_AFTER) {
      state.lanes[laneId].job.consecutiveFailures = 0;
      state.score.bypasses += 1;
      addEvent(state, "maintenance-lock", `Channel ${laneId} received a classical readout assist.`, {
        lane: laneId,
      });
      continue;
    }
    failed.push(laneId);
  }
  if (failed.length > 0) {
    for (const laneId of failed) {
      state.lanes[laneId].job.consecutiveFailures += 1;
      setPose(state, laneId, "fumble", 760);
      addEvent(state, "fumble", `Channel ${laneId} missed the readout control; no shot was consumed.`, {
        lane: laneId,
        jobId: state.currentJob.definition.id,
      });
    }
    return;
  }
  for (const laneId of LANE_IDS) state.lanes[laneId].job.consecutiveFailures = 0;

  const shot = consumeShot(state.manifest, state.currentJob.definition.id);
  const stale = !preparationIsFresh(state);
  const wrong = state.currentJob.wrongCircuit;
  const thermal = thermalServiceRejects(state);
  const rejectionReason = wrong ? "wrong-circuit" : stale ? "stale-preparation" : thermal ? "thermal-service" : null;
  const accepted = rejectionReason === null;
  state.currentJob.shotAttempts.push({
    recordId: shot.id,
    bits: shot.bits,
    source: shot.source,
    accepted,
    rejectionReason,
  });
  state.cooling.load += state.level.heat.executionImpulse;
  state.processor.phase = "readout";
  state.processor.phaseEndsAtMs = state.simTimeMs + 360;
  addEvent(state, "shot-consumed", `${shot.source.toUpperCase()} shot ${shot.sampleIndex}: ${shot.bits.join("")}.`, {
    bits: shot.bits,
    source: shot.source,
    jobId: state.currentJob.definition.id,
  });

  if (accepted) {
    state.currentJob.validShots += 1;
    state.score.validShots += 1;
    setPose(state, "A", "success", 430);
    setPose(state, "B", "success", 430);
    addEvent(state, "shot-accepted", `Accepted measured result ${shot.bits.join("")}.`, {
      bits: shot.bits,
      source: shot.source,
      jobId: state.currentJob.definition.id,
    });
  } else {
    state.currentJob.rejectedAttempts += 1;
    state.score.rejectedShots += 1;
    addEvent(
      state,
      "shot-rejected",
      `Rejected ${shot.bits.join("")} for ${rejectionReason}; cached bits were not altered.`,
      { bits: shot.bits, source: shot.source, jobId: state.currentJob.definition.id },
    );
  }

  const job = state.currentJob;
  const quotaMet = job.validShots >= job.definition.shotQuota;
  const errorAcceptable = rejectionRate(job) <= job.definition.maxRejectionRate;
  if (quotaMet && errorAcceptable) {
    makeCanisterReady(state, true);
  } else if (job.shotAttempts.length >= job.definition.maxAttempts) {
    makeCanisterReady(state, false);
  }
}

function pickupResult(state: GameState, laneId: LaneId): void {
  const itemId = state.currentJob.canisterItemId;
  const item = itemId ? state.items[itemId] : null;
  if (!item || item.kind !== "result-canister" || heldItem(state, laneId)) return;
  item.location = { kind: "held", lane: laneId };
  state.lanes[laneId].actor.heldItemId = item.id;
  setPose(state, laneId, "carry");
  addEvent(state, "item-collected", `Channel ${laneId} detached the result canister.`, {
    lane: laneId,
    itemId: item.id,
    jobId: state.currentJob.definition.id,
  });
}

function submitResult(state: GameState, laneId: LaneId): void {
  const item = heldItem(state, laneId);
  if (item?.kind !== "result-canister") return;
  const accepted = state.currentJob.canisterValid;
  discardItem(state, item);
  if (accepted) {
    state.score.acceptedJobs += 1;
    state.processor.completedJobs += 1;
    addEvent(state, "job-submitted", `Accepted paired service job ${state.currentJob.definition.id}.`, {
      lane: laneId,
      itemId: item.id,
      jobId: state.currentJob.definition.id,
    });
    const coolingAt = state.level.features.guidedCoolingAfterJobs;
    if (coolingAt !== undefined && state.score.acceptedJobs >= coolingAt && state.cooling.completedServices === 0) {
      state.cooling.load = Math.max(state.cooling.load, 66);
      for (const hotspot of state.cooling.hotspots) hotspot.heat = Math.max(hotspot.heat, 48);
      addEvent(state, "cooling-started", "The external manifolds demand hands-on cooling; cached data is unchanged.");
    }
  } else {
    state.score.rejectedJobs += 1;
    state.processor.rejectedJobs += 1;
    addEvent(state, "job-rejected", `Rejected canister ${state.currentJob.definition.id} entered the entropy chute.`, {
      lane: laneId,
      itemId: item.id,
      jobId: state.currentJob.definition.id,
    });
  }

  state.processor.phase = "resetting";
  setStage(state, "reset");
}

function installCoolant(state: GameState, laneId: LaneId): void {
  const item = heldItem(state, laneId);
  if (item?.kind !== "coolant-cell") return;
  const charge = item.charge ?? RESERVOIR_CELL_CAPACITY;
  state.cooling.reservoir[laneId] = Math.min(100, state.cooling.reservoir[laneId] + charge);
  discardItem(state, item);
  state.cooling.completedServices += 1;
  setPose(state, laneId, "success");
  addEvent(state, "coolant-installed", `Channel ${laneId} refilled its external coolant reservoir.`, {
    lane: laneId,
    itemId: item.id,
  });
}

function resetProcessor(state: GameState, lanes: LaneId[]): void {
  for (const laneId of lanes) state.lanes[laneId].job.resetArmed = true;
  if (!LANE_IDS.every((laneId) => state.lanes[laneId].job.resetArmed)) return;

  const finishedJobId = state.currentJob.definition.id;
  for (const item of Object.values(state.items)) {
    if (item.jobId === finishedJobId && item.location.kind !== "discarded") discardItem(state, item);
  }
  for (const laneId of LANE_IDS) {
    state.lanes[laneId].job = createLaneJobState();
    state.lanes[laneId].replacementKind = null;
  }
  state.processor.phase = "idle";
  state.processor.phaseEndsAtMs = null;
  addEvent(state, "processor-reset", `Cleared ${finishedJobId}; qubits returned to their starting state.`);
  if (state.score.acceptedJobs >= state.level.targetJobs) {
    completeLevel(state, "level-completed");
    return;
  }
  state.currentJobIndex = (state.currentJobIndex + 1) % state.level.jobs.length;
  state.currentJob = createJobState(state.level.jobs[state.currentJobIndex]);
}

function processInteraction(state: GameState): void {
  const intents: Record<LaneId, InteractionIntent> = {
    A: interactionIntent(state, "A"),
    B: interactionIntent(state, "B"),
  };
  const activeKinds = LANE_IDS.map((laneId) => intents[laneId].kind).filter((kind) => kind !== "noop");
  if (activeKinds.length === 2 && activeKinds[0] !== activeKinds[1]) {
    state.score.mixedActions += 1;
    addEvent(state, "mixed-context", `${activeKinds[0]} / ${activeKinds[1]} shared one action input.`);
  }

  for (const laneId of LANE_IDS) {
    const intent = intents[laneId];
    if (intent.kind === "pickup-dropped") pickUpDropped(state, laneId, intent.itemId);
    if (intent.kind === "return-lance") returnLance(state, laneId);
    if (intent.kind === "pickup-lance") collectSupply(state, laneId, "cryo-lance");
    if (intent.kind === "pickup-pulse") collectSupply(state, laneId, pulseItemKind(intent.pulse));
    if (intent.kind === "pickup-prestage") {
      collectPrestage(state, laneId, intent.pulse, intent.jobId);
    }
    if (intent.kind === "pickup-aux") collectSupply(state, laneId, intent.itemKind);
    if (intent.kind === "stage-prepulse") stagePrepulse(state, laneId);
    if (intent.kind === "install-coolant") installCoolant(state, laneId);
  }

  installPulses(
    state,
    LANE_IDS.filter((laneId) => intents[laneId].kind === "install-pulse"),
  );
  installCoupling(
    state,
    LANE_IDS.filter((laneId) => intents[laneId].kind === "install-couple"),
  );
  installCanister(
    state,
    LANE_IDS.filter((laneId) => intents[laneId].kind === "install-canister"),
  );

  acceptJob(state, LANE_IDS.filter((laneId) => intents[laneId].kind === "accept"));
  armCoupling(state, LANE_IDS.filter((laneId) => intents[laneId].kind === "arm-couple"));
  runShot(state, LANE_IDS.filter((laneId) => intents[laneId].kind === "run"));
  for (const laneId of LANE_IDS) {
    if (intents[laneId].kind === "pickup-result") pickupResult(state, laneId);
    if (intents[laneId].kind === "submit") submitResult(state, laneId);
  }
  resetProcessor(state, LANE_IDS.filter((laneId) => intents[laneId].kind === "reset"));

  state.activeHoldLanes = LANE_IDS.filter((laneId) => {
    const kind = intents[laneId].kind;
    return kind === "prepare" || kind === "pump" || kind === "spray";
  });
  for (const laneId of state.activeHoldLanes) {
    const kind = intents[laneId].kind;
    setPose(state, laneId, kind === "spray" ? "spray" : "operate", 10_000);
  }
}

function consumeMovementRisk(
  state: GameState,
  participants: LaneId[],
): RiskRecord | null {
  const address = riskAddress(state.level.id, "TRANSFER", "movement");
  const record = consumeRisk(state.manifest, address);
  if (record) {
    addEvent(state, "risk-consumed", `${record.source.toUpperCase()} transfer ${record.sampleIndex}: ${record.bits.join("")}.`, {
      address,
      bits: record.bits,
      source: record.source,
      participants: [...participants],
      jobId: state.currentJob.definition.id,
    });
  }
  return record;
}

function processMove(state: GameState, direction: Direction): void {
  const targets = {
    A: moveTarget(state.lanes.A.actor.position, direction),
    B: moveTarget(state.lanes.B.actor.position, direction),
  };
  const legal: Record<LaneId, boolean> = { A: false, B: false };
  const riskEligible: LaneId[] = [];

  for (const laneId of LANE_IDS) {
    const actor = state.lanes[laneId].actor;
    actor.facing = direction;
    if (state.simTimeMs - actor.lastMoveAtMs < MOVE_LOCK_MS) continue;
    actor.lastMoveAtMs = state.simTimeMs;
    legal[laneId] = !isBlocked(targets[laneId]);
    if (!legal[laneId]) {
      addEvent(state, "local-collision", `Channel ${laneId} met its stopping bay.`, { lane: laneId });
      continue;
    }
    if (state.level.features.movementRisk && samePosition(actor.position, MOVEMENT_RISK_POSITION)) {
      riskEligible.push(laneId);
    }
  }

  const risk = riskEligible.length > 0 ? consumeMovementRisk(state, riskEligible) : null;
  for (const laneId of LANE_IDS) {
    if (!legal[laneId]) continue;
    const lane = state.lanes[laneId];
    const missed = risk !== null && riskEligible.includes(laneId) && laneBit(risk.bits, laneId) === 1;
    if (missed && lane.job.consecutiveFailures < CLASSICAL_BYPASS_AFTER) {
      lane.job.consecutiveFailures += 1;
      setPose(state, laneId, "missed", 720);
      addEvent(state, "missed-step", `Channel ${laneId} missed a movement step.`, {
        lane: laneId,
        address: risk.address,
        bits: risk.bits,
        source: risk.source,
      });
      continue;
    }
    if (missed) {
      lane.job.consecutiveFailures = 0;
      state.score.bypasses += 1;
      addEvent(state, "maintenance-lock", `Channel ${laneId} received a deterministic movement assist.`, {
        lane: laneId,
      });
    }
    lane.actor.position = targets[laneId];
    if (heldItem(state, laneId)) setPose(state, laneId, "carry", 220);
  }
}

function completeLevel(state: GameState, eventType: "level-completed" | "level-failed"): void {
  if (state.phase === "complete") return;
  state.phase = "complete";
  state.interactHeld = false;
  state.activeHoldLanes = [];
  const stars = starsForJobs(state.level, state.score.acceptedJobs);
  addEvent(
    state,
    eventType,
    stars > 0 ? `Shift complete: ${state.score.acceptedJobs} paired jobs, ${stars} star${stars === 1 ? "" : "s"}.` : "Shift ended below the job threshold.",
  );
}

export function dispatchCommand(state: GameState, command: SimulationCommand): GameState {
  if (command.type === "start" && state.phase === "briefing") {
    state.phase = "running";
    addEvent(state, "level-started", `Level ${state.level.id}: ${state.level.title}`);
    if (state.level.features.laneBPresentation === "reveal-on-start") {
      state.laneBRevealed = true;
      addEvent(state, "lane-revealed", "Channel B was receiving the mirrored half of every command.");
    }
    return state;
  }
  if (command.type === "pause-toggle") {
    if (state.phase === "running") {
      state.phase = "paused";
      state.interactHeld = false;
      state.activeHoldLanes = [];
    } else if (state.phase === "paused") {
      state.phase = "running";
    }
    return state;
  }
  if (command.type === "abandon" && (state.phase === "running" || state.phase === "paused")) {
    state.phase = "complete";
    state.interactHeld = false;
    state.activeHoldLanes = [];
    addEvent(state, "abandoned", "The shift was abandoned.");
    return state;
  }
  if (command.type === "interact-up") {
    state.interactHeld = false;
    state.activeHoldLanes = [];
    return state;
  }
  if (state.phase !== "running") return state;

  if (command.type === "move") processMove(state, command.direction);
  if (command.type === "interact-down") {
    state.interactHeld = true;
    processInteraction(state);
  }
  return state;
}

function updatePreparation(state: GameState, deltaMs: number): void {
  if (
    state.currentJob.stage !== "prepare" ||
    !state.interactHeld ||
    !LANE_IDS.every(
      (laneId) =>
        state.activeHoldLanes.includes(laneId) &&
        topCounterReady(state, laneId, PREP_POSITION) &&
        heldItem(state, laneId) === null,
    )
  ) {
    return;
  }
  const rate = state.cooling.band === "nominal" ? 1 : state.cooling.band === "warm" ? 0.86 : state.cooling.band === "hot" ? 0.65 : 0.45;
  for (const laneId of LANE_IDS) {
    state.lanes[laneId].job.preparationProgressMs += deltaMs * rate;
  }
  if (
    LANE_IDS.every(
      (laneId) => state.lanes[laneId].job.preparationProgressMs >= state.level.heat.preparationHoldMs,
    )
  ) {
    for (const laneId of LANE_IDS) {
      const job = state.lanes[laneId].job;
      job.prepared = true;
      job.preparationExpiresAtMs = state.level.heat.preparationValidityMs === null
        ? null
        : state.simTimeMs + state.level.heat.preparationValidityMs;
      setPose(state, laneId, "success");
    }
    addEvent(state, "preparation-complete", "Both internal qubits were initialized together.", {
      jobId: state.currentJob.definition.id,
    });
    setStage(state, "load");
  }
}

function updatePumpHolds(state: GameState, deltaMs: number): void {
  if (!state.interactHeld) return;
  for (const laneId of LANE_IDS) {
    const actor = state.lanes[laneId].actor;
    if (
      !state.activeHoldLanes.includes(laneId) ||
      !state.cooling.pumpTripped[laneId] ||
      heldItem(state, laneId) !== null ||
      !samePosition(actor.position, PUMP_POSITION) ||
      actor.facing !== "down"
    ) {
      continue;
    }
    const lane = state.lanes[laneId];
    lane.job.pumpProgressMs += deltaMs;
    if (lane.job.pumpProgressMs >= state.level.heat.pumpRestartHoldMs) {
      lane.job.pumpProgressMs = 0;
      state.cooling.pumpTripped[laneId] = false;
      state.cooling.completedServices += 1;
      state.cooling.load = Math.max(0, state.cooling.load - 6);
      setPose(state, laneId, "success");
      addEvent(state, "pump-restarted", `Channel ${laneId} restarted its external coolant pump.`, {
        lane: laneId,
      });
    }
  }
}

function updateSpray(state: GameState, deltaMs: number): void {
  if (!state.interactHeld) return;
  for (const laneId of LANE_IDS) {
    if (!state.activeHoldLanes.includes(laneId)) continue;
    const actor = state.lanes[laneId].actor;
    const lance = heldItem(state, laneId);
    if (lance?.kind !== "cryo-lance" || (lance.charge ?? 0) <= 0 || actor.facing !== "in") continue;
    const target = state.cooling.hotspots.find(
      (hotspot) =>
        hotspot.lane === laneId &&
        hotspot.active &&
        hotspot.position.y === actor.position.y &&
        actor.position.x >= 3,
    );
    if (!target) continue;
    const seconds = deltaMs / 1_000;
    const effectiveness = target.blockedLine ? 0.45 : 1;
    const reduction = state.level.heat.coolingPerSecond * seconds * effectiveness;
    target.heat = Math.max(0, target.heat - reduction);
    state.cooling.load = Math.max(0, state.cooling.load - reduction * 0.72);
    lance.charge = Math.max(0, (lance.charge ?? 0) - LANCE_CHARGE_PER_SECOND * seconds);
    state.cooling.reservoir[laneId] = Math.max(0, state.cooling.reservoir[laneId] - seconds * 0.2);
    setPose(state, laneId, "spray", 400);
    if (target.blockedLine && target.heat <= 18) {
      target.blockedLine = false;
      state.cooling.completedServices += 1;
      addEvent(state, "cooling-completed", `Channel ${laneId} cleared a blocked coolant line.`, {
        lane: laneId,
      });
    }
  }
}

function updateThermalPlant(state: GameState, deltaMs: number): void {
  const seconds = deltaMs / 1_000;
  const activeJob = state.currentJob.stage !== "accept" && state.currentJob.stage !== "reset";
  let increase = state.level.heat.baselinePerSecond;
  if (activeJob) increase += state.level.heat.activeJobPerSecond;
  if (state.cooling.pumpTripped.A) increase += 0.75;
  if (state.cooling.pumpTripped.B) increase += 0.75;
  if (state.cooling.reservoir.A <= 0) increase += 0.85;
  if (state.cooling.reservoir.B <= 0) increase += 0.85;
  state.cooling.load += increase * seconds;

  for (const laneId of LANE_IDS) {
    const drain = state.level.heat.reservoirDrainPerSecond * seconds * (activeJob ? 1 : 0.35);
    state.cooling.reservoir[laneId] = Math.max(0, state.cooling.reservoir[laneId] - drain);
  }
  for (const hotspot of state.cooling.hotspots) {
    const lanePenalty = state.cooling.pumpTripped[hotspot.lane] ? 1.2 : 0;
    hotspot.heat = Math.min(100, hotspot.heat + (0.25 + (activeJob ? 0.55 : 0) + lanePenalty) * seconds);
  }

  updateSpray(state, deltaMs);
  state.cooling.load = Math.min(state.level.heat.maximum, Math.max(0, state.cooling.load));
  state.cooling.band = thermalBand(state.cooling.load);
  const alarmed = state.cooling.load >= 60;
  if (alarmed && !state.cooling.alarmed) {
    addEvent(state, "cooling-started", "Thermal margin is narrowing; service the external plant.");
  }
  state.cooling.alarmed = alarmed;

  if (state.level.features.pumpTrips && state.cooling.load >= 68 + state.cooling.completedServices * 7) {
    const laneId: LaneId = state.cooling.completedServices % 2 === 0 ? "B" : "A";
    if (!state.cooling.pumpTripped[laneId]) {
      state.cooling.pumpTripped[laneId] = true;
      addEvent(state, "cooling-started", `Channel ${laneId} coolant pump tripped.`, { lane: laneId });
    }
  }

  if (state.cooling.load >= state.level.heat.maximum && state.phase === "running") {
    state.phase = "shutdown";
    state.interactHeld = false;
    state.activeHoldLanes = [];
    state.score.shutdowns += 1;
    addEvent(state, "emergency-shutdown", "The undercooled processor shut down; banked jobs remain accepted.");
  }
}

function expireDroppedItems(state: GameState): void {
  for (const item of Object.values(state.items)) {
    if (
      item.location.kind !== "dropped" ||
      item.expiresAtMs === null ||
      state.simTimeMs <= item.expiresAtMs
    ) {
      continue;
    }
    item.location = { kind: "discarded" };
    state.lanes[item.lane].replacementKind = item.kind;
    state.score.expiries += 1;
    state.cooling.load += state.level.heat.expiryImpulse;
    addEvent(state, "object-expired", `Channel ${item.lane}'s ${item.kind} expired; replacement authorized.`, {
      lane: item.lane,
      itemId: item.id,
      jobId: item.jobId ?? undefined,
    });
  }
}

function expireCouplingArms(state: GameState): void {
  if (state.currentJob.stage !== "couple-arm") return;
  const scale = state.cooling.band === "hot" ? 0.7 : state.cooling.band === "critical" ? 0.5 : 1;
  const windowMs = state.level.couplingWindowMs * scale;
  for (const laneId of LANE_IDS) {
    const armedAt = state.lanes[laneId].job.couplingArmedAtMs;
    if (armedAt !== null && state.simTimeMs - armedAt > windowMs) {
      state.lanes[laneId].job.couplingArmedAtMs = null;
    }
  }
}

function updateProcessorPhase(state: GameState): void {
  if (state.processor.phaseEndsAtMs !== null && state.simTimeMs >= state.processor.phaseEndsAtMs) {
    state.processor.phaseEndsAtMs = null;
    if (state.processor.phase === "readout") state.processor.phase = "armed";
  }
}

function expireJobDeadline(state: GameState): void {
  const job = state.currentJob;
  if (
    job.deadlineAtMs !== null &&
    state.simTimeMs > job.deadlineAtMs &&
    !job.resultReady &&
    job.stage !== "reset"
  ) {
    makeCanisterReady(state, false);
  }
}

function resetExpiredPoses(state: GameState): void {
  for (const laneId of LANE_IDS) {
    const actor = state.lanes[laneId].actor;
    if (actor.poseUntilMs > 0 && state.simTimeMs >= actor.poseUntilMs) {
      actor.pose = actor.heldItemId ? "carry" : "idle";
      actor.poseUntilMs = 0;
    }
  }
}

export function advanceSimulation(state: GameState, deltaMs: number): GameState {
  if (state.phase !== "running" || deltaMs <= 0) return state;
  const boundedDelta = Math.min(deltaMs, 250);
  state.simTimeMs += boundedDelta;
  if (state.shiftRemainingMs !== null) {
    state.shiftRemainingMs = Math.max(0, state.shiftRemainingMs - boundedDelta);
  }

  updateProcessorPhase(state);
  updatePreparation(state, boundedDelta);
  updatePumpHolds(state, boundedDelta);
  updateThermalPlant(state, boundedDelta);
  expireDroppedItems(state);
  expireCouplingArms(state);
  expireJobDeadline(state);
  resetExpiredPoses(state);

  if (state.phase === "running" && state.shiftRemainingMs === 0) {
    completeLevel(
      state,
      starsForJobs(state.level, state.score.acceptedJobs) > 0 ? "level-completed" : "level-failed",
    );
  }
  return state;
}

export function debugGrantAcceptedJobs(state: GameState, jobs: number): GameState {
  state.score.acceptedJobs = Math.max(state.score.acceptedJobs, jobs);
  state.processor.completedJobs = Math.max(state.processor.completedJobs, state.score.acceptedJobs);
  if (state.score.acceptedJobs >= state.level.targetJobs) completeLevel(state, "level-completed");
  return state;
}

/** Temporary source compatibility for the old debug surface. */
export const debugGrantAcceptedCycles = debugGrantAcceptedJobs;

export function debugSetHeat(state: GameState, load: number): GameState {
  state.cooling.load = Math.min(state.level.heat.maximum, Math.max(0, load));
  state.cooling.band = thermalBand(state.cooling.load);
  return state;
}

export function loadHardwareManifest(state: GameState, bundle: ImportedManifestBundle): GameState {
  importHardwareBundle(state.manifest, bundle);
  // Tutorial records remain pedagogically first; hardware then replaces the simulator tail.
  for (const stream of Object.values(state.manifest.riskStreams)) {
    const scripted = stream.records.filter((record) => record.source === "scripted");
    if (scripted.length === 0) continue;
    const hardware = stream.records.filter((record) => record.source === "hardware");
    const simulator = stream.records.filter((record) => record.source === "simulator");
    stream.records = [...scripted, ...hardware, ...simulator];
  }
  return state;
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function replay(
  levelId: number,
  seed: number,
  log: Array<{ atMs: number; command: SimulationCommand }>,
): GameState {
  const state = createGameState(levelId, seed);
  let cursorMs = 0;
  for (const entry of log) {
    const targetMs = Math.max(cursorMs, entry.atMs);
    while (cursorMs < targetMs) {
      const step = Math.min(50, targetMs - cursorMs);
      advanceSimulation(state, step);
      cursorMs += step;
    }
    dispatchCommand(state, entry.command);
  }
  return state;
}

export function nextLevelId(levelConfig: LevelConfig): number {
  return Math.min(LEVELS.length, levelConfig.id + 1);
}

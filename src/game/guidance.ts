import {
  COUPLE_POSITION,
  GRID_MAX_X,
  GRID_MAX_Y,
  LANCE_RACK_POSITION,
  MOVEMENT_RISK_POSITION,
  PREP_POSITION,
  PULSE_POSITION,
  READOUT_POSITION,
  SUBMIT_POSITION,
  SUPPLY_POSITIONS,
  samePosition,
} from "../simulation/geometry";
import type { GameState, GridPosition, ItemKind, LaneId, PulseKind } from "../simulation/types";
import { LANE_IDS } from "../simulation/types";

export interface LaneGuide {
  position: GridPosition;
  label: string;
}

export interface DemoGuidance {
  eyebrow: string;
  headline: string;
  detail: string;
  command: string;
  urgent: boolean;
  focus: "station" | "supply" | "buffer" | "floor" | "cooling";
  targets: Partial<Record<LaneId, LaneGuide>>;
}

function pulseLabel(pulse: PulseKind): string {
  return pulse === "P" ? "PHASE" : pulse;
}

function itemLabel(kind: ItemKind): string {
  if (kind.startsWith("pulse-")) return `${pulseLabel(kind.slice(-1) as PulseKind)} CARTRIDGE`;
  if (kind === "coupling-half") return "COUPLING HALF";
  if (kind === "empty-canister") return "EMPTY CANISTER";
  if (kind === "result-canister") return "RESULT CANISTER";
  if (kind === "coolant-cell") return "COOLANT CELL";
  return "CRYO LANCE";
}

function visibleLanes(state: GameState): readonly LaneId[] {
  return state.laneBRevealed ? LANE_IDS : (["A"] as const);
}

function sharedTargets(
  state: GameState,
  position: GridPosition,
  labels: Partial<Record<LaneId, string>>,
): Partial<Record<LaneId, LaneGuide>> {
  return Object.fromEntries(
    visibleLanes(state).map((laneId) => [
      laneId,
      { position: { ...position }, label: labels[laneId] ?? "MOVE WITH PAIR" },
    ]),
  ) as Partial<Record<LaneId, LaneGuide>>;
}

function allVisibleAt(state: GameState, position: GridPosition): boolean {
  return visibleLanes(state).every((laneId) => samePosition(state.lanes[laneId].actor.position, position));
}

function hasEvent(state: GameState, type: "fumble" | "missed-step" | "coupling-armed"): boolean {
  return state.events.some((event) => event.type === type);
}

function hasRiskAt(state: GameState, fixture: "PULSE" | "COUPLE"): boolean {
  return state.events.some(
    (event) => event.type === "risk-consumed" && event.address?.includes(`/${fixture}/`),
  );
}

function pairAligned(state: GameState): boolean {
  return samePosition(state.lanes.A.actor.position, state.lanes.B.actor.position);
}

function movementOffsetGuidance(state: GameState): DemoGuidance | null {
  if (pairAligned(state) || !hasEvent(state, "missed-step")) return null;
  const a = state.lanes.A.actor.position;
  const b = state.lanes.B.actor.position;
  const axis = a.x !== b.x ? "x" : "y";
  const aValue = a[axis];
  const bValue = b[axis];
  const minimum = Math.min(aValue, bValue);
  const maximum = Math.max(aValue, bValue);
  const boundaryMaximum = axis === "x" ? GRID_MAX_X : GRID_MAX_Y;
  const towardMinimum = minimum <= boundaryMaximum - maximum;
  const direction = axis === "x"
    ? towardMinimum ? "OUT" : "IN"
    : towardMinimum ? "UP" : "DOWN";
  const boundary = towardMinimum ? 0 : boundaryMaximum;
  const leader = (towardMinimum ? aValue < bValue : aValue > bValue) ? "A" : "B";
  const targets = Object.fromEntries(
    LANE_IDS.map((laneId) => {
      const position = { ...state.lanes[laneId].actor.position, [axis]: boundary };
      return [laneId, { position, label: laneId === leader ? "STOP AT RAIL" : "CATCH UP" }];
    }),
  ) as Record<LaneId, LaneGuide>;
  return guidance(
    "PAIR OUT OF STEP",
    "RESYNCHRONIZE AT THE BARRIER",
    `Tap ${direction} until the leading worker stops against the rail while the delayed worker catches up.`,
    `TAP ${direction}`,
    targets,
    true,
    "floor",
  );
}

function pulsesInstalled(state: GameState): boolean {
  return LANE_IDS.every(
    (laneId) =>
      state.lanes[laneId].job.loadedPulses.length >=
      state.currentJob.definition.pulses[laneId].length,
  );
}

function guidance(
  eyebrow: string,
  headline: string,
  detail: string,
  command: string,
  targets: Partial<Record<LaneId, LaneGuide>>,
  urgent = false,
  focus: DemoGuidance["focus"] = "station",
): DemoGuidance {
  return { eyebrow, headline, detail, command, targets, urgent, focus };
}

function droppedGuidance(state: GameState): DemoGuidance | null {
  const dropped = Object.values(state.items).filter(
    (item) => item.location.kind === "dropped" && item.faultId !== null,
  );
  if (dropped.length === 0) return null;
  const focus = dropped[0];
  if (focus.location.kind !== "dropped") return null;
  const remaining = focus.expiresAtMs === null
    ? null
    : Math.max(0, Math.ceil((focus.expiresAtMs - state.simTimeMs) / 1_000));
  const labels: Partial<Record<LaneId, string>> = {};
  for (const laneId of visibleLanes(state)) {
    const laneDrop = dropped.find((item) => item.lane === laneId);
    labels[laneId] = laneDrop ? `RECOVER ${itemLabel(laneDrop.kind)}` : "MOVE WITH PAIR";
  }
  const atBuffer = visibleLanes(state).some((laneId) => {
    const laneDrop = dropped.find((item) => item.lane === laneId);
    return laneDrop?.location.kind === "dropped" &&
      samePosition(state.lanes[laneId].actor.position, laneDrop.location.position);
  });
  return guidance(
    "FAULT — OBJECT DROPPED",
    dropped.length === 2
      ? "RECOVER BOTH HALVES"
      : focus.kind === "coupling-half"
        ? "RECOVER THE COUPLING HALF"
        : focus.kind.includes("canister")
          ? "RECOVER THE CANISTER"
          : "RECOVER THE CARTRIDGE",
    `${dropped.length === 2 ? "Both workers fumbled." : `Channel ${focus.lane} fumbled.`} Move onto the striped buffer${remaining === null ? "." : ` before ${remaining}s expires.`}`,
    atBuffer ? "PRESS ACTION" : "MOVE TO BUFFER",
    sharedTargets(state, focus.location.position, labels),
    true,
    "buffer",
  );
}

function replacementGuidance(state: GameState): DemoGuidance | null {
  const laneId = LANE_IDS.find((candidate) => state.lanes[candidate].replacementKind !== null);
  if (!laneId) return null;
  const kind = state.lanes[laneId].replacementKind;
  if (!kind) return null;
  const pulse = kind.startsWith("pulse-") ? (kind.slice(-1) as PulseKind) : null;
  const position = pulse ? SUPPLY_POSITIONS[pulse] : SUPPLY_POSITIONS.AUX;
  return guidance(
    "RECOVERY EXPIRED",
    "FETCH A REPLACEMENT",
    `The discarded ${itemLabel(kind).toLowerCase()} has been replaced at the outer bench.`,
    allVisibleAt(state, position) ? "PRESS ACTION" : "MOVE TO BENCH",
    sharedTargets(state, position, { [laneId]: `TAKE ${itemLabel(kind)}` }),
    true,
    "supply",
  );
}

function protectedRecoveryGuidance(state: GameState): DemoGuidance | null {
  if (state.level.demo.lesson !== "protected-risk" || !pulsesInstalled(state)) return null;
  const missedStep = hasEvent(state, "missed-step");
  if (!missedStep) {
    const onRisk = LANE_IDS.every((laneId) => samePosition(state.lanes[laneId].actor.position, MOVEMENT_RISK_POSITION));
    const target = onRisk ? { x: MOVEMENT_RISK_POSITION.x, y: MOVEMENT_RISK_POSITION.y - 1 } : MOVEMENT_RISK_POSITION;
    return guidance(
      "NEXT TEST — MOVEMENT ADDRESS",
      onRisk ? "LEAVE THE MARKED SQUARE" : "ENTER THE MARKED SQUARE",
      onRisk
        ? "Tap UP. Leaving this cyan address consumes its next hidden two-channel record."
        : "Move DOWN onto the cyan address. Occupancy is safe; its next record is consumed only when the pair leaves.",
      onRisk ? "TAP UP" : "MOVE DOWN",
      sharedTargets(state, target, { A: "PROTECTED", B: onRisk ? "OUTCOME HIDDEN" : "RISK ADDRESS" }),
      false,
      "floor",
    );
  }
  return null;
}

function jointCoolingGuidance(state: GameState): DemoGuidance | null {
  if (state.level.demo.lesson !== "joint-risk" || !hasEvent(state, "coupling-armed")) return null;
  const activeHotspot = state.cooling.hotspots.find((hotspot) => hotspot.active);
  if (!activeHotspot) {
    const carryingLanes = LANE_IDS.filter((laneId) => {
      const heldId = state.lanes[laneId].actor.heldItemId;
      return heldId !== null && state.items[heldId]?.kind === "cryo-lance";
    });
    if (carryingLanes.length === 0) return null;
    const labels = Object.fromEntries(
      LANE_IDS.map((laneId) => [
        laneId,
        carryingLanes.includes(laneId) ? "RETURN LANCE" : "LANCE RETURNED",
      ]),
    ) as Record<LaneId, string>;
    return guidance(
      "COOLING COMPLETE — CLEAR HANDS",
      carryingLanes.length === 1 ? "RETURN THE FINAL CRYO LANCE" : "RETURN THE CRYO LANCES",
      "The external manifolds are stable. Return every remaining tool before collecting the result canister.",
      allVisibleAt(state, LANCE_RACK_POSITION) ? "PRESS ACTION" : "MOVE TO LANCE RACK",
      sharedTargets(state, LANCE_RACK_POSITION, labels),
      false,
      "cooling",
    );
  }
  const missingLance = LANE_IDS.find((laneId) => {
    const heldId = state.lanes[laneId].actor.heldItemId;
    return heldId === null || state.items[heldId]?.kind !== "cryo-lance";
  });
  if (missingLance) {
    const labels = Object.fromEntries(
      LANE_IDS.map((laneId) => {
        const heldId = state.lanes[laneId].actor.heldItemId;
        const carrying = heldId !== null && state.items[heldId]?.kind === "cryo-lance";
        return [laneId, carrying ? "HOLD LANCE" : "TAKE LANCE"];
      }),
    ) as Record<LaneId, string>;
    return guidance(
      "THERMAL LOAD — CLASSICAL MAINTENANCE",
      "FETCH THE CRYO LANCES",
      "The simulated Quantum Blur view intensifies with heat. Cooling clears the image but does not change the cached quantum result.",
      allVisibleAt(state, LANCE_RACK_POSITION) ? "PRESS ACTION" : "MOVE TO LANCE RACK",
      sharedTargets(state, LANCE_RACK_POSITION, labels),
      state.cooling.band === "critical",
      "cooling",
    );
  }
  const position = activeHotspot.position;
  const atHotspot = LANE_IDS.every((laneId) => {
    const actor = state.lanes[laneId].actor;
    return actor.position.x >= 3 && actor.position.y === position.y;
  });
  return guidance(
    "THERMAL LOAD — CLASSICAL MAINTENANCE",
    "SPRAY THE GLOWING MANIFOLDS",
    "Carry each lance beside the hot inner manifold, then hold ACTION until the glow turns cold and the simulated blur clears.",
    atHotspot ? "HOLD ACTION" : "MOVE TO HOTSPOTS",
    sharedTargets(state, position, { A: "SPRAY MANIFOLD", B: "SPRAY MANIFOLD" }),
    state.cooling.band === "critical",
    "cooling",
  );
}

function loadGuidance(state: GameState): DemoGuidance {
  const matchedMissing = LANE_IDS.every((laneId) => {
    const lane = state.lanes[laneId];
    return lane.actor.heldItemId === null &&
      lane.job.loadedPulses.length < state.currentJob.definition.pulses[laneId].length;
  });
  const nextPulses = Object.fromEntries(
    LANE_IDS.map((laneId) => [
      laneId,
      state.currentJob.definition.pulses[laneId][state.lanes[laneId].job.loadedPulses.length],
    ]),
  ) as Record<LaneId, PulseKind | undefined>;
  if (matchedMissing && nextPulses.A !== undefined && nextPulses.A === nextPulses.B) {
    const pulse = nextPulses.A;
    const target = SUPPLY_POSITIONS[pulse];
    return guidance(
      "ASSEMBLE MATCHED PULSE SEQUENCE",
      `FETCH ${pulseLabel(pulse)} ON BOTH SIDES`,
      state.laneBRevealed
        ? "The same ACTION collects the same cartridge from the matching place in both mirrored lanes."
        : "The visible worker collects H; the hidden service bay receives the same command at the matching supply.",
      allVisibleAt(state, target) ? "PRESS ACTION" : "MOVE TO MATCHED BENCHES",
      sharedTargets(state, target, { A: `TAKE ${pulseLabel(pulse)}`, B: `TAKE ${pulseLabel(pulse)}` }),
      false,
      "supply",
    );
  }

  const missingLane = LANE_IDS.find((laneId) => {
    const lane = state.lanes[laneId];
    return lane.actor.heldItemId === null &&
      lane.job.loadedPulses.length < state.currentJob.definition.pulses[laneId].length;
  });
  if (missingLane) {
    const index = state.lanes[missingLane].job.loadedPulses.length;
    const pulse = state.currentJob.definition.pulses[missingLane][index];
    const target = SUPPLY_POSITIONS[pulse];
    const labels: Partial<Record<LaneId, string>> = {
      [missingLane]: `TAKE ${pulseLabel(pulse)}`,
    };
    for (const laneId of visibleLanes(state)) {
      if (laneId !== missingLane) {
        const heldId = state.lanes[laneId].actor.heldItemId;
        labels[laneId] = heldId ? `CARRYING ${itemLabel(state.items[heldId].kind)}` : "STAY IN STEP";
      }
    }
    const atSupply = samePosition(state.lanes[missingLane].actor.position, target);
    return guidance(
      "ASSEMBLE PULSE SEQUENCE",
      `FETCH ${pulseLabel(pulse)} FOR ${missingLane === "A" ? "BLUE" : "RED"}`,
      state.laneBRevealed
        ? "One ACTION is shared, but each worker follows the object and station at their own position."
        : "Move to the lit outer bench. The remote service bay receives the same command.",
      atSupply ? "PRESS ACTION" : "MOVE TO LIT BENCH",
      sharedTargets(state, target, labels),
      false,
      "supply",
    );
  }

  const labels = Object.fromEntries(
    visibleLanes(state).map((laneId) => {
      const heldId = state.lanes[laneId].actor.heldItemId;
      const held = heldId ? state.items[heldId] : null;
      return [laneId, held ? `INSTALL ${itemLabel(held.kind)}` : "HOLD POSITION"];
    }),
  ) as Partial<Record<LaneId, string>>;

  if (state.level.demo.lesson === "protected-risk") {
    const retrying = hasRiskAt(state, "PULSE");
    const pulse = state.currentJob.definition.pulses.B[state.lanes.B.job.loadedPulses.length] ?? "H";
    const protectedLabels: Partial<Record<LaneId, string>> = retrying
      ? { A: "H ALREADY INSTALLED", B: `REINSTALL ${pulseLabel(pulse)}` }
      : { A: "INSTALL H", B: "INSTALL H" };
    return guidance(
      retrying ? "RETRY — NEXT RECORD READY" : "RISK ADDRESS ARMED",
      retrying ? "RETRY THE FAILED SIDE" : "COMMIT AT THE PULSE ADDRESS",
      retrying
        ? "Return to PULSE. Blue's H remains installed while red consumes the next record."
        : "The gold address will consume one hidden two-channel record when ACTION is pressed. Its bits determine which local installs succeed or fumble.",
      allVisibleAt(state, PULSE_POSITION) ? "PRESS ACTION" : "MOVE TO PULSE",
      sharedTargets(state, PULSE_POSITION, protectedLabels),
    );
  }

  return guidance(
    "ASSEMBLE PULSE SEQUENCE",
    "INSTALL THE CARTRIDGES",
    "Move both workers to PULSE. Press ACTION once: each side installs the cartridge it is carrying.",
    allVisibleAt(state, PULSE_POSITION) ? "PRESS ACTION" : "MOVE TO PULSE",
    sharedTargets(state, PULSE_POSITION, labels),
  );
}

function couplingGuidance(state: GameState): DemoGuidance {
  if (state.currentJob.stage === "couple-arm") {
    return guidance(
      "COUPLED OPERATION",
      "ARM BOTH PORTS TOGETHER",
      "Both halves are installed. One shared ACTION now activates the paired operation inside the timing window.",
      allVisibleAt(state, COUPLE_POSITION) ? "PRESS ACTION" : "MOVE TO COUPLE",
      sharedTargets(state, COUPLE_POSITION, { A: "ARM LEFT", B: "ARM RIGHT" }),
    );
  }

  const missingLane = LANE_IDS.find(
    (laneId) => !state.lanes[laneId].job.couplingInstalled && state.lanes[laneId].actor.heldItemId === null,
  );
  if (missingLane) {
    return guidance(
      "COUPLED OPERATION",
      `FETCH ${missingLane === "A" ? "BLUE" : "RED"} COUPLING HALF`,
      "The coupled gate becomes available only after both physical halves are installed.",
      samePosition(state.lanes[missingLane].actor.position, SUPPLY_POSITIONS.AUX) ? "PRESS ACTION" : "MOVE TO AUX",
      sharedTargets(state, SUPPLY_POSITIONS.AUX, { [missingLane]: "TAKE COUPLING HALF" }),
      false,
      "supply",
    );
  }
  if (state.level.demo.lesson === "joint-risk") {
    const retrying = hasRiskAt(state, "COUPLE");
    const pending = LANE_IDS.filter((laneId) => !state.lanes[laneId].job.couplingInstalled);
    const labels: Partial<Record<LaneId, string>> = Object.fromEntries(
      LANE_IDS.map((laneId) => [
        laneId,
        state.lanes[laneId].job.couplingInstalled
          ? "PORT ALREADY LOCKED"
          : laneId === "A"
            ? "INSTALL LEFT HALF"
            : "INSTALL RIGHT HALF",
      ]),
    );
    return guidance(
      retrying ? "RETRY — NEXT JOINT RECORD READY" : "JOINT RISK ADDRESS ARMED",
      retrying
        ? pending.length === 1
          ? "RETRY THE FAILED COUPLING HALF"
          : "RETRY BOTH COUPLING HALVES"
        : "COMMIT AT THE COUPLED ADDRESS",
      retrying
        ? pending.length === 1
          ? "The installed port stays locked. Return the remaining half to COUPLE to consume the next joint record."
          : "Return both recovered halves to COUPLE. The next shared ACTION consumes the next joint record."
        : "This shared ACTION consumes one hidden joint record. Its two bits determine which local installations succeed or fumble.",
      allVisibleAt(state, COUPLE_POSITION) ? "PRESS ACTION" : "MOVE TO COUPLE",
      sharedTargets(state, COUPLE_POSITION, labels),
    );
  }
  return guidance(
    "COUPLED OPERATION",
    "INSTALL BOTH COUPLING HALVES",
    "Carry the two halves to the matching processor ports. The next shared ACTION is a risk trigger.",
    allVisibleAt(state, COUPLE_POSITION) ? "PRESS ACTION" : "MOVE TO COUPLE",
    sharedTargets(state, COUPLE_POSITION, { A: "INSTALL LEFT HALF", B: "INSTALL RIGHT HALF" }),
  );
}

function canisterGuidance(state: GameState): DemoGuidance {
  const courier = state.currentJob.definition.courierLane;
  const heldId = state.lanes[courier].actor.heldItemId;
  const held = heldId ? state.items[heldId] : null;
  if (held?.kind === "empty-canister") {
    return guidance(
      "RESULT SERVICE — ATTACH CANISTER",
      "CARRY THE CANISTER TO READOUT",
      `${courier === "A" ? "Blue" : "Red"} is the courier. Move the pair to READOUT, then attach the empty result canister.`,
      allVisibleAt(state, READOUT_POSITION) ? "PRESS ACTION" : "MOVE TO READOUT",
      sharedTargets(state, READOUT_POSITION, {
        [courier]: "ATTACH CANISTER",
        [courier === "A" ? "B" : "A"]: "STAY WITH COURIER",
      }),
    );
  }
  return guidance(
    "RESULT SERVICE — COLLECT CANISTER",
    `FETCH THE ${courier === "A" ? "BLUE" : "RED"} CANISTER`,
    `Move both workers to AUX. ${courier === "A" ? "Blue" : "Red"} collects the empty canister; the other side stays synchronized.`,
    allVisibleAt(state, SUPPLY_POSITIONS.AUX) ? "PRESS ACTION" : "MOVE TO AUX",
    sharedTargets(state, SUPPLY_POSITIONS.AUX, {
      [courier]: "TAKE EMPTY CANISTER",
      [courier === "A" ? "B" : "A"]: "STAY WITH COURIER",
    }),
    false,
    "supply",
  );
}

function runGuidance(state: GameState): DemoGuidance {
  const quota = state.currentJob.definition.shotQuota;
  let readoutRiskIndex = -1;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (event.type === "risk-consumed" && event.address?.includes("/READOUT/")) {
      readoutRiskIndex = index;
      break;
    }
  }
  const retrying = readoutRiskIndex >= 0 &&
    state.currentJob.shotAttempts.length === 0 &&
    state.events.slice(readoutRiskIndex + 1).some((event) => event.type === "fumble");
  return guidance(
    `RUN CIRCUIT — VALID SHOTS ${state.currentJob.validShots}/${quota}`,
    retrying ? "RETRY THE READOUT CONTROLS" : "RUN AND MEASURE ONE SHOT",
    retrying
      ? "The preceding readout record prevented a shot. Press together again; the next cached record is consumed."
      : "Both controls trigger the loaded circuit. Measurement deposits one classical two-bit result into the attached canister.",
    allVisibleAt(state, READOUT_POSITION) ? "PRESS ACTION" : "MOVE TO READOUT",
    sharedTargets(state, READOUT_POSITION, { A: "RUN + MEASURE", B: "RUN + MEASURE" }),
  );
}

function submissionGuidance(state: GameState): DemoGuidance {
  const courier = state.currentJob.definition.courierLane;
  const heldId = state.lanes[courier].actor.heldItemId;
  const held = heldId ? state.items[heldId] : null;
  if (held?.kind === "result-canister") {
    return guidance(
      "SUBMIT ACCEPTED RESULT",
      "CARRY THE RESULT TO SUBMIT",
      `${courier === "A" ? "Blue" : "Red"} carries the measured result. Move the pair to SUBMIT and deliver it.`,
      allVisibleAt(state, SUBMIT_POSITION) ? "PRESS ACTION" : "MOVE TO SUBMIT",
      sharedTargets(state, SUBMIT_POSITION, {
        [courier]: "SUBMIT RESULT",
        [courier === "A" ? "B" : "A"]: "STAY WITH COURIER",
      }),
    );
  }
  return guidance(
    "SUBMIT ACCEPTED RESULT",
    "DETACH THE RESULT CANISTER",
    `${courier === "A" ? "Blue" : "Red"} must collect the measured canister from READOUT before the pair can submit it.`,
    allVisibleAt(state, READOUT_POSITION) ? "PRESS ACTION" : "MOVE TO READOUT",
    sharedTargets(state, READOUT_POSITION, {
      [courier]: "DETACH RESULT",
      [courier === "A" ? "B" : "A"]: "STAY WITH COURIER",
    }),
  );
}

function resetGuidance(state: GameState): DemoGuidance {
  return guidance(
    "FINAL STEP — RESET PROCESSOR",
    "RETURN BOTH WORKERS TO READOUT",
    "A job is complete only after both reset controls clear the circuit and return the internal qubits to their starting state.",
    allVisibleAt(state, READOUT_POSITION) ? "PRESS ACTION" : "MOVE TO READOUT",
    sharedTargets(state, READOUT_POSITION, { A: "RESET LEFT", B: "RESET RIGHT" }),
  );
}

export function guidanceFor(state: GameState): DemoGuidance {
  const dropped = droppedGuidance(state);
  if (dropped) return dropped;
  const replacement = replacementGuidance(state);
  if (replacement) return replacement;
  const movementOffset = movementOffsetGuidance(state);
  if (movementOffset) return movementOffset;
  const protectedRecovery = protectedRecoveryGuidance(state);
  if (protectedRecovery) return protectedRecovery;
  const jointCooling = jointCoolingGuidance(state);
  if (jointCooling) return jointCooling;

  if (state.currentJob.stage === "accept") {
    return guidance(
      "STEP 1 — ACCEPT JOINT JOB",
      "ACTIVATE THE READOUT",
      "One shared ACTION accepts the computation for both processor channels.",
      allVisibleAt(state, READOUT_POSITION) ? "PRESS ACTION" : "MOVE TO READOUT",
      sharedTargets(state, READOUT_POSITION, { A: "ACCEPT JOB", B: "ACCEPT JOB" }),
    );
  }
  if (state.currentJob.stage === "prepare") {
    return guidance(
      "STEP 2 — PREPARE INTERNAL QUBITS",
      "HOLD BOTH PREP PORTS",
      "Move OUT to PREP, then hold ACTION until the paired initialization ring completes.",
      allVisibleAt(state, PREP_POSITION) ? "HOLD ACTION" : "MOVE TO PREP",
      sharedTargets(state, PREP_POSITION, { A: "HOLD PREP", B: "HOLD PREP" }),
    );
  }
  if (state.currentJob.stage === "load") return loadGuidance(state);
  if (state.currentJob.stage === "couple-install" || state.currentJob.stage === "couple-arm") {
    return couplingGuidance(state);
  }
  if (state.currentJob.stage === "canister") return canisterGuidance(state);
  if (state.currentJob.stage === "run") return runGuidance(state);
  if (state.currentJob.stage === "submission") return submissionGuidance(state);
  return resetGuidance(state);
}

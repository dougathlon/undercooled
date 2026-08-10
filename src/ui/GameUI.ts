import type { GameSession } from "../game/GameSession";
import type { InputController } from "../input/InputController";
import { LEVELS } from "../simulation/levels";
import type {
  Direction,
  GameEvent,
  GameState,
  ItemKind,
  JobStage,
  LaneId,
  LevelConfig,
  Provenance,
  PulseKind,
} from "../simulation/types";
import { LANE_IDS } from "../simulation/types";

type OverlayMode = "title" | "briefing" | "pause" | "result" | null;

const PROVENANCE_LABELS: Record<Provenance, string> = {
  simulator: "Simulator cache",
  scripted: "Scripted demo",
  hardware: "Hardware-derived cache",
};

const DEMO_LIMIT = 4;

interface DemoFrame {
  mode: string;
  change: string;
  rule: string;
  takeaway: string;
}

const DEMO_FRAMES: Record<number, DemoFrame> = {
  1: {
    mode: "Solo",
    change: "One visible worker completes a short deterministic service cycle.",
    rule: "No risk records are consumed. Follow the highlighted station and supply nest.",
    takeaway: "A second channel was receiving every mirrored command behind the screen.",
  },
  2: {
    mode: "Pair revealed",
    change: "The second worker is now visible. One command still controls both lanes.",
    rule: "The cycle remains deterministic; each side may need a different cartridge.",
    takeaway: "Shared mirrored controls can produce two different contextual actions.",
  },
  3: {
    mode: "B-side risk",
    change: "Later-game slice: marked actions and movement squares now consume cached risk records.",
    rule: "Channel A is protected. Channel B may drop an item or miss a movement step.",
    takeaway: "Prefetched records disrupted Channel B while Channel A remained protected.",
  },
  4: {
    mode: "Joint risk",
    change: "The protection is removed. Marked actions and squares can now affect either lane.",
    rule: "A two-bit record may affect A, B, both workers, or neither worker.",
    takeaway: "Joint risk records can place a fault on A, B, both workers, or neither.",
  },
};

const STAGE_LABELS: Record<JobStage, string> = {
  accept: "Accept job",
  prepare: "Prepare both",
  load: "Load pulses",
  "couple-install": "Install coupling",
  "couple-arm": "Arm together",
  canister: "Attach canister",
  run: "Run / measure",
  submission: "Submit result",
  reset: "Reset processor",
};

const EVENT_SIGILS: Partial<Record<GameEvent["type"], string>> = {
  "risk-consumed": "◇",
  "shot-consumed": "00",
  fumble: "!",
  "missed-step": "↯",
  "shot-accepted": "+",
  "shot-rejected": "×",
  "job-submitted": "✓",
  "job-rejected": "⊘",
  "cooling-started": "❄",
  "cooling-completed": "❄",
  "emergency-shutdown": "■",
  "lane-revealed": "II",
};

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatClock(milliseconds: number | null): string {
  if (milliseconds === null) return "OPEN";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function bitLabel(bits: readonly [number, number]): string {
  return `${bits[0]}${bits[1]}`;
}

function pulseLabel(pulse: PulseKind): string {
  return pulse === "P" ? "Φ" : pulse;
}

function itemLabel(kind: ItemKind): string {
  if (kind.startsWith("pulse-")) return `${pulseLabel(kind.slice(-1) as PulseKind)} cartridge`;
  if (kind === "coupling-half") return "coupling half";
  if (kind === "empty-canister") return "empty result canister";
  if (kind === "result-canister") return "result canister";
  if (kind === "coolant-cell") return "coolant cell";
  return "cryo lance";
}

function demoFrame(level: LevelConfig): DemoFrame {
  return DEMO_FRAMES[level.id] ?? {
    mode: `Order ${level.id}`,
    change: level.briefing,
    rule: level.objective,
    takeaway: `The processor accepted ${level.title}.`,
  };
}

function riskKey(level: LevelConfig): string {
  if (!level.features.interactionRisk && !level.features.movementRisk) {
    return "RISK OFF · no marked square or action consumes a risk record";
  }
  if (!level.features.reciprocalRisk) {
    return "00 → both succeed · 01 → B fumbles or misses · A remains protected";
  }
  return "00 → both succeed · 10 → A · 01 → B · 11 → both";
}

function mostRecentRiskCause(state: GameState, event: GameEvent): GameEvent | null {
  if (!["risk-consumed", "fumble", "missed-step", "item-installed"].includes(event.type)) return null;
  if (event.type === "risk-consumed") return event;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const candidate = state.events[index];
    if (candidate.atMs < event.atMs) break;
    if (candidate.type === "risk-consumed" && candidate.atMs === event.atMs) return candidate;
  }
  return null;
}

function riskEventMessage(state: GameState, event: GameEvent): string | null {
  const risk = mostRecentRiskCause(state, event);
  if (!risk?.source || !risk.bits) return null;
  const consequences = state.events.filter(
    (candidate) =>
      candidate.id > risk.id &&
      candidate.atMs === risk.atMs &&
      (candidate.type === "fumble" || candidate.type === "missed-step"),
  );
  const lanes = [...new Set(consequences.flatMap((candidate) => candidate.lane ?? []))];
  const participants = risk.participants ?? [...LANE_IDS];
  const outcome =
    consequences.length === 0
      ? participants.length === 2
        ? "BOTH SUCCEED"
        : `${participants[0]} SUCCEEDS · OTHER SIDE NO ACTION`
      : consequences.every((candidate) => candidate.type === "missed-step")
        ? `${lanes.join(" + ")} MISS${lanes.length === 1 ? "ES" : ""} A STEP`
        : `${lanes.join(" + ")} FUMBLE${lanes.length === 1 ? "S" : ""}`;
  const fixture = risk.address?.split("/")[1] ?? "RISK";
  return `${PROVENANCE_LABELS[risk.source].toUpperCase()} · ${risk.bits.join("")} · ${fixture} → ${outcome}`;
}

function circuitTrack(pulses: PulseKind[], loaded: PulseKind[], lane: LaneId): string {
  return pulses
    .map((pulse, index) => {
      const complete = loaded[index] === pulse;
      return `<span class="uc-gate${complete ? " is-loaded" : ""}" title="Channel ${lane} ${pulse}">${pulseLabel(pulse)}</span>`;
    })
    .join('<i class="uc-wire"></i>');
}

function laneStatus(state: GameState, lane: LaneId): string {
  if (lane === "B" && !state.laneBRevealed) return "COWORKER VEILED";
  const actor = state.lanes[lane].actor;
  const job = state.lanes[lane].job;
  if (actor.pose === "spray") return "COOLING MANIFOLD";
  if (actor.pose === "fumble") return "FUMBLED — RECOVER";
  if (actor.pose === "missed") return "MISSED STEP";
  if (actor.heldItemId) {
    const item = state.items[actor.heldItemId];
    return item ? `CARRYING ${item.kind.replaceAll("-", " ").toUpperCase()}` : "HANDS OCCUPIED";
  }
  if (state.currentJob.stage === "prepare") {
    const percent = Math.round((job.preparationProgressMs / state.level.heat.preparationHoldMs) * 100);
    return job.prepared ? "PREPARED" : `PREPARING ${Math.min(100, percent)}%`;
  }
  if (state.currentJob.stage === "load") {
    return `PULSES ${job.loadedPulses.length}/${state.currentJob.definition.pulses[lane].length}`;
  }
  if (state.currentJob.stage.startsWith("couple")) return job.couplingInstalled ? "COUPLER INSTALLED" : "NEEDS COUPLER";
  if (state.currentJob.stage === "reset") return job.resetArmed ? "RESET ARMED" : "RESET REQUIRED";
  return STAGE_LABELS[state.currentJob.stage].toUpperCase();
}

function mechanicLabels(level: LevelConfig): string[] {
  const labels = ["Mirrored shared controls", "Measured circuit shots", "Continuous cooling"];
  if (level.features.interactionRisk) labels.push("Pulse-install risk");
  if (level.features.movementRisk) labels.push("Movement risk");
  if (level.features.reciprocalRisk) labels.push("Reciprocal joint faults");
  if (level.features.allowPrestage) labels.push("Limited parallel work");
  if (level.features.pumpTrips) labels.push("Pump service");
  if (level.features.blockedLines) labels.push("Blocked coolant lines");
  return labels;
}

export class GameUI {
  private overlayMode: OverlayMode = "title";
  private lastEventId = 0;
  private unsubscribe: (() => void) | null = null;
  private readonly cleanupCallbacks: Array<() => void> = [];
  private readonly shell: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly session: GameSession,
    private readonly input: InputController,
  ) {
    this.root.innerHTML = this.shellMarkup();
    this.shell = query(this.root, ".uc-shell");
    this.overlay = query(this.root, "[data-testid='overlay']");
    this.pauseButton = query(this.root, "[data-action='pause']");
    this.pauseButton.addEventListener("click", this.onPause);
    this.bindTouchControls();
    this.showTitle();
    this.unsubscribe = this.session.subscribe(this.renderState);
  }

  showTitle(): void {
    this.input.setEnabled(false);
    this.overlayMode = "title";
    this.shell.dataset.screen = "title";
    this.overlay.hidden = false;
    this.overlay.innerHTML = this.titleMarkup();
    query<HTMLButtonElement>(this.overlay, "[data-action='begin']").addEventListener("click", () => {
      this.showBriefing(this.session.getState().level.id);
    });
    for (const button of this.overlay.querySelectorAll<HTMLButtonElement>("[data-level]")) {
      button.addEventListener("click", () => this.showBriefing(Number(button.dataset.level)));
    }
  }

  showBriefing(levelId: number): void {
    this.session.selectLevel(levelId);
    this.lastEventId = 0;
    const level = this.session.getState().level;
    this.input.setEnabled(false);
    this.overlayMode = "briefing";
    this.shell.dataset.screen = "briefing";
    this.overlay.hidden = false;
    this.overlay.innerHTML = this.briefingMarkup(level);
    query<HTMLButtonElement>(this.overlay, "[data-action='start']").addEventListener("click", () => this.startCurrentLevel());
    query<HTMLButtonElement>(this.overlay, "[data-action='back']").addEventListener("click", () => this.showTitle());
  }

  startCurrentLevel(): void {
    if (this.session.getState().phase !== "briefing") this.session.restart();
    this.session.dispatch({ type: "start" });
    this.input.setEnabled(true);
    this.hideOverlay();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.pauseButton.removeEventListener("click", this.onPause);
    for (const cleanup of this.cleanupCallbacks) cleanup();
    this.root.replaceChildren();
  }

  private shellMarkup(): string {
    return `
      <div class="uc-shell" data-screen="title" data-thermal="nominal">
        <header class="uc-hud" data-testid="hud">
          <div class="uc-brandplate"><span class="uc-brandplate__mark">U</span><strong>UNDERCOOLED</strong><small>V0.4 FOUR-RUN DEMO</small></div>
          <div class="uc-stat"><small>Demo</small><strong data-ui="level">01 — Solo Service</strong></div>
          <div class="uc-stat"><small>Accepted cycles</small><strong data-ui="jobs" data-testid="jobs">0 / 1</strong></div>
          <div class="uc-stat uc-stat--heat"><small>Thermal load</small><strong data-ui="thermal">00% · NOMINAL</strong><i><b data-ui="thermal-fill"></b></i></div>
          <div class="uc-stat"><small>Shift</small><strong data-ui="clock">OPEN</strong></div>
          <div class="uc-provenance"><span data-ui="risk-source" data-source="simulator"><i></i><small>Risk</small><b>Awaiting trigger</b></span><span data-ui="shot-source" data-source="simulator"><i></i><small>Shot</small><b>Awaiting measurement</b></span></div>
          <button class="uc-pause" type="button" data-action="pause" data-testid="pause" aria-label="Pause">Ⅱ</button>
        </header>

        <section class="uc-jobstrip" data-testid="job-display">
          <div class="uc-jobstrip__title"><small>Joint job</small><strong data-ui="job-label">AWAITING ACCEPTANCE</strong></div>
          <div class="uc-track"><b>A</b><span data-ui="circuit-a"></span></div>
          <div class="uc-stage"><small>Current operation</small><strong data-ui="stage">ACCEPT JOB</strong><span data-ui="shots">SHOTS 0 / 1</span><span class="uc-stage__mobile" data-ui="mobile-status">Accept the job at the central readout.</span></div>
          <div class="uc-track uc-track--b"><b>B</b><span data-ui="circuit-b"></span></div>
        </section>

        <div class="uc-lane-state uc-lane-state--a"><b>A</b><span data-ui="lane-a">ACCEPT JOB</span></div>
        <div class="uc-lane-state uc-lane-state--b"><b>B</b><span data-ui="lane-b">COWORKER VEILED</span></div>
        <div class="uc-objective"><b>NEXT</b><span data-ui="objective">Accept the job at the central readout.</span></div>
        <div class="uc-event" data-ui="event" role="status" aria-live="polite"><b data-ui="event-sigil">◆</b><span data-ui="event-message">The service plant is standing by.</span></div>

        <div class="uc-key-help"><span><kbd>↑↓</kbd> VERTICAL</span><span><kbd>→ / D</kbd> IN</span><span><kbd>← / A</kbd> OUT</span><span><kbd>SPACE / E</kbd> ACTION · HOLD TO OPERATE OR SPRAY</span></div>
        <div class="uc-touch" data-testid="touch-controls" aria-label="Shared mirrored controls">
          <button type="button" data-move="up" aria-label="Move both workers up">UP</button>
          <button type="button" data-move="out" aria-label="Move both workers away from processor">OUT</button>
          <span class="uc-touch__core">Ⅱ</span>
          <button type="button" data-move="in" aria-label="Move both workers toward processor">IN</button>
          <button type="button" data-move="down" aria-label="Move both workers down">DOWN</button>
          <button class="uc-action-button" type="button" data-action="interact" data-testid="interact"><strong>ACTION</strong><small>PRESS / HOLD</small></button>
        </div>

        <div class="uc-orientation-gate"><div><b>TURN THE WORKSHOP</b><span>Undercooled uses both complete service lanes. Rotate your phone to landscape.</span></div></div>
        <section class="uc-overlay" data-testid="overlay" aria-live="polite"></section>
      </div>`;
  }

  private titleMarkup(): string {
    const current = this.session.getState().level.id;
    const cards = LEVELS.slice(0, DEMO_LIMIT).map((level) => {
      const frame = demoFrame(level);
      return `
      <button class="uc-level-card${level.id === current ? " is-current" : ""}" type="button" data-level="${level.id}" data-testid="level-${level.id}">
        <b>${String(level.id).padStart(2, "0")}</b><span><strong>${escapeHtml(level.title)}</strong><small>${escapeHtml(frame.change)}</small></span><i>${escapeHtml(frame.mode)}</i>
      </button>`;
    }).join("");
    return `
      <div class="uc-panel uc-panel--title">
        <section class="uc-title-copy">
          <p class="uc-kicker">Four-run Moth Quantum demonstration <b>PROTOTYPE 0.4</b></p>
          <h1><span>UNDER</span>COOLED</h1>
          <p class="uc-deck">Learn one short service cycle, reveal the mirrored coworker, then watch prefetched quantum records enter marked actions and movement squares.</p>
          <div class="uc-contract"><b>DEMO CONTRACT</b><p>Measured shot records and a separate risk stream are cached before play. The runtime consumes them in order. Cooling remains classical maintenance and never changes a cached bit.</p></div>
          <button class="uc-primary" type="button" data-action="begin" data-testid="begin">Inspect selected demo <span>→</span></button>
        </section>
        <section class="uc-level-select"><header><b>FOUR DEMO RUNS</b><small>all unlocked for live presentation</small></header><div>${cards}</div></section>
      </div>`;
  }

  private briefingMarkup(level: LevelConfig): string {
    const frame = demoFrame(level);
    const mechanics = mechanicLabels(level).slice(0, 5).map((label) => `<li>${escapeHtml(label)}</li>`).join("");
    const workflow = [
      "Accept",
      "Prepare",
      "Load",
      ...(level.jobs[0]?.coupledGate ? ["Couple"] : []),
      "Canister",
      "Run / Measure",
      "Submit",
      "Reset",
    ];
    return `
      <div class="uc-panel uc-panel--briefing">
        <div class="uc-order-stamp"><strong>${String(level.id).padStart(2, "0")}</strong><small>DEMO / 04</small></div>
        <section>
          <p class="uc-kicker">${escapeHtml(frame.mode)} / ${level.durationMs === null ? "untimed" : `${Math.round(level.durationMs / 1000)} second shift`}</p>
          <h2>${escapeHtml(level.title)}</h2><p class="uc-subtitle">${escapeHtml(level.subtitle)}</p>
          <div class="uc-demo-change"><b>WHAT CHANGES</b><span>${escapeHtml(frame.change)}</span></div>
          <div class="uc-workflow">${workflow.map((step) => `<span>${step}</span>`).join("<i>→</i>")}</div>
          <div class="uc-order-objective"><b>FINISH</b><span>${escapeHtml(level.objective)}</span></div>
          <div class="uc-risk-key"><b>RISK KEY</b><span>${escapeHtml(riskKey(level))}</span></div>
          <ul class="uc-mechanics">${mechanics}</ul>
        </section>
        <aside>
          <dl><div><dt>Visible rule</dt><dd>${escapeHtml(frame.rule)}</dd></div><div><dt>Accepted cycle</dt><dd>${level.targetJobs} paired service job${level.targetJobs === 1 ? "" : "s"}</dd></div><div><dt>Shared controls</dt><dd>IN and OUT mirror across the processor; ACTION follows local context.</dd></div></dl>
          <p>Take cartridges from the outer benches and carry them to the highlighted station. A scripted opening is labelled as scripted; later simulator or hardware-cache records retain their own provenance.</p>
          <div class="uc-modal-actions"><button class="uc-secondary" type="button" data-action="back">Demo menu</button><button class="uc-primary" type="button" data-action="start" data-testid="start-level">Begin demo ${level.id} <span>→</span></button></div>
        </aside>
      </div>`;
  }

  private pauseMarkup(state: GameState): string {
    return `<div class="uc-panel uc-panel--modal"><p class="uc-kicker">Local control interrupt</p><h2>SHIFT HELD</h2><p>The clock and external refrigeration plant are paused. Neither cached stream has advanced.</p><div class="uc-mini-ledger"><span><small>Jobs</small><b>${state.score.acceptedJobs}</b></span><span><small>Valid shots</small><b>${state.score.validShots}</b></span><span><small>Heat</small><b>${Math.round(state.cooling.load)}%</b></span></div><div class="uc-modal-actions"><button class="uc-primary" type="button" data-action="resume" data-testid="resume">Resume <span>→</span></button><button class="uc-secondary" type="button" data-action="restart">Restart</button><button class="uc-text-button" type="button" data-action="menu">Orders</button></div></div>`;
  }

  private resultMarkup(state: GameState): string {
    const shutdown = state.phase === "shutdown";
    const complete = state.phase === "complete";
    const frame = demoFrame(state.level);
    const lastDemoId = Math.min(DEMO_LIMIT, LEVELS.length);
    const nextLevel = state.level.id < lastDemoId ? LEVELS.find((level) => level.id === state.level.id + 1) : undefined;
    const heading = shutdown ? "PLANT SHUTDOWN" : complete ? `DEMO ${state.level.id} COMPLETE` : "SHIFT ABANDONED";
    const takeaway = shutdown
      ? "The external refrigeration plant lost its service margin. Cached quantum records remain unaltered."
      : frame.takeaway;
    const nextLabel = nextLevel ? `Start demo ${nextLevel.id}: ${demoFrame(nextLevel).mode}` : "All four demos complete";
    return `<div class="uc-panel uc-panel--result"><div class="uc-result-seal">${shutdown ? "△" : String(state.level.id).padStart(2, "0")}</div><p class="uc-kicker">Demo ${String(state.level.id).padStart(2, "0")} of ${String(lastDemoId).padStart(2, "0")} / takeaway</p><h2>${heading}</h2><p class="uc-result-takeaway">${escapeHtml(takeaway)}</p><div class="uc-result-ledger"><span><small>Accepted cycles</small><b>${state.score.acceptedJobs}</b></span><span><small>Valid shots</small><b>${state.score.validShots}</b></span><span><small>Recoveries</small><b>${state.score.recoveries}</b></span></div><div class="uc-next-preview"><b>NEXT</b><span>${escapeHtml(nextLevel ? demoFrame(nextLevel).change : "The four-step demonstration is complete.")}</span></div><div class="uc-modal-actions"><button class="uc-primary" type="button" data-action="next" data-testid="next-level" ${nextLevel ? "" : "disabled"}>${escapeHtml(nextLabel)}<span>→</span></button><button class="uc-secondary" type="button" data-action="retry">Replay demo</button><button class="uc-text-button" type="button" data-action="menu">Demo menu</button></div></div>`;
  }

  private hideOverlay(): void {
    this.overlayMode = null;
    this.shell.dataset.screen = "running";
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private renderState = (state: GameState): void => {
    const job = state.currentJob;
    query(this.root, "[data-ui='level']").textContent = `${String(state.level.id).padStart(2, "0")} — ${state.level.title}`;
    query(this.root, "[data-ui='jobs']").textContent = `${state.score.acceptedJobs} / ${state.level.targetJobs}`;
    query(this.root, "[data-ui='job-label']").textContent = job.definition.label;
    query(this.root, "[data-ui='stage']").textContent = STAGE_LABELS[job.stage].toUpperCase();
    query(this.root, "[data-ui='shots']").textContent = `SHOTS ${job.validShots} / ${job.definition.shotQuota} · ATTEMPTS ${job.shotAttempts.length}/${job.definition.maxAttempts}`;
    query(this.root, "[data-ui='circuit-a']").innerHTML = circuitTrack(job.definition.pulses.A, state.lanes.A.job.loadedPulses, "A");
    query(this.root, "[data-ui='circuit-b']").innerHTML = state.laneBRevealed
      ? circuitTrack(job.definition.pulses.B, state.lanes.B.job.loadedPulses, "B")
      : '<em class="uc-channel-unknown">REMOTE CHANNEL OCCLUDED</em>';
    query(this.root, "[data-ui='lane-a']").textContent = laneStatus(state, "A");
    query(this.root, "[data-ui='lane-b']").textContent = laneStatus(state, "B");
    const instruction = this.nextInstruction(state);
    query(this.root, "[data-ui='objective']").textContent = instruction;
    query(this.root, "[data-ui='clock']").textContent = formatClock(state.shiftRemainingMs);

    const load = Math.max(0, Math.min(state.level.heat.maximum, state.cooling.load));
    const ratio = state.level.heat.maximum > 0 ? load / state.level.heat.maximum : 0;
    query(this.root, "[data-ui='thermal']").textContent = `${String(Math.round(ratio * 100)).padStart(2, "0")}% · ${state.cooling.band.toUpperCase()}`;
    (query<HTMLElement>(this.root, "[data-ui='thermal-fill']")).style.width = `${ratio * 100}%`;
    this.shell.dataset.thermal = state.cooling.band;

    this.renderRiskProvenance(state);
    this.renderProvenance("shot", state.manifest.lastShot?.source ?? "simulator", state.manifest.lastShot ? `${bitLabel(state.manifest.lastShot.bits)} · ${state.manifest.lastShot.jobId}` : "Awaiting measurement");

    const event = state.events.at(-1);
    const eventSummary = event ? riskEventMessage(state, event) : null;
    query(this.root, "[data-ui='mobile-status']").textContent =
      event && state.simTimeMs - event.atMs <= 3_500
        ? `${eventSummary ? EVENT_SIGILS["risk-consumed"] : EVENT_SIGILS[event.type] ?? "◆"} ${eventSummary ?? event.message}`
        : instruction;
    if (event && event.id !== this.lastEventId) this.renderEvent(event, eventSummary);
    if (state.phase === "paused" && this.overlayMode !== "pause") this.showPause(state);
    else if (state.phase === "running") {
      this.input.setEnabled(true);
      if (this.overlayMode !== null) this.hideOverlay();
    } else if (["complete", "shutdown"].includes(state.phase) && this.overlayMode !== "result") this.showResult(state);
  };

  private nextInstruction(state: GameState): string {
    if (state.cooling.band === "critical") return "COOLING EMERGENCY — fetch a cryo lance, face an active exterior manifold, and hold ACTION.";
    const dropped = Object.values(state.items).find(
      (item) => item.location.kind === "dropped" && item.faultId !== null,
    );
    if (dropped?.location.kind === "dropped") {
      const remaining = dropped.expiresAtMs === null
        ? ""
        : ` · ${Math.max(0, Math.ceil((dropped.expiresAtMs - state.simTimeMs) / 1_000))}s remaining`;
      const buffer = dropped.kind.startsWith("pulse-")
        ? "PULSE"
        : dropped.kind === "coupling-half"
          ? "COUPLE"
          : "READOUT";
      return `RECOVER — Channel ${dropped.lane}'s ${itemLabel(dropped.kind)} is in the striped ${buffer} buffer${remaining}. Move onto it and press ACTION.`;
    }
    const replacementLane = LANE_IDS.find((laneId) => state.lanes[laneId].replacementKind !== null);
    if (replacementLane) {
      const kind = state.lanes[replacementLane].replacementKind;
      if (kind) return `REPLACEMENT — Channel ${replacementLane}: fetch a fresh ${itemLabel(kind)} from its outer supply nest.`;
    }
    if (
      state.laneBRevealed &&
      (state.lanes.A.actor.position.x !== state.lanes.B.actor.position.x ||
        state.lanes.A.actor.position.y !== state.lanes.B.actor.position.y)
    ) {
      return "RESYNCHRONIZE — the workers are out of step. Move toward an end stop until one worker collides while the other catches up.";
    }
    const stage = state.currentJob.stage;
    if (stage === "accept") return "Face the central READOUT and press ACTION to accept the displayed job.";
    if (stage === "prepare") return "Move OUT to PREP, face the counter, and hold ACTION until both channels initialize.";
    if (stage === "load") {
      const visibleLanes = state.laneBRevealed ? LANE_IDS : (["A"] as const);
      const laneSteps = visibleLanes.map((laneId) => {
        const actor = state.lanes[laneId].actor;
        const held = actor.heldItemId ? state.items[actor.heldItemId] : null;
        if (held) return `${laneId}: carry ${itemLabel(held.kind)} to PULSE`;
        const index = state.lanes[laneId].job.loadedPulses.length;
        const nextPulse = state.currentJob.definition.pulses[laneId][index];
        return nextPulse ? `${laneId}: face OUT at the ${pulseLabel(nextPulse)} bench and take it` : `${laneId}: pulse sequence ready`;
      });
      return `NEXT CARTRIDGE — ${laneSteps.join(" · ")}. At a nest, face OUT before ACTION; then carry it to PULSE.`;
    }
    if (stage === "couple-install") return "Face OUT at both AUX benches, fetch the coupling halves, and install them at COUPLE.";
    if (stage === "couple-arm") return "Stand at both coupling ports and activate within the synchronization window.";
    if (stage === "canister") return `Channel ${state.currentJob.definition.courierLane}: face OUT at AUX, fetch the empty canister, and attach it at READOUT.`;
    if (stage === "run") return "Both channels activate READOUT. Repeat Run → Measure until the valid-shot quota is complete.";
    if (stage === "submission") return "Carry the detached result canister OUT to SUBMIT; invalid canisters belong in the entropy chute.";
    return "Return IN to the readout and activate both reset controls before accepting another job.";
  }

  private renderProvenance(kind: "risk" | "shot", source: Provenance, text: string): void {
    const panel = query<HTMLElement>(this.root, `[data-ui='${kind}-source']`);
    panel.dataset.source = source;
    query(panel, "b").textContent = `${PROVENANCE_LABELS[source]} · ${text}`;
  }

  private renderRiskProvenance(state: GameState): void {
    const panel = query<HTMLElement>(this.root, "[data-ui='risk-source']");
    const riskEnabled = state.level.features.interactionRisk || state.level.features.movementRisk;
    if (!riskEnabled) {
      panel.dataset.source = "inactive";
      query(panel, "b").textContent = "Not used in this demo";
      return;
    }
    const record = state.manifest.lastRisk;
    if (record) {
      panel.dataset.source = record.source;
      query(panel, "b").textContent = `${PROVENANCE_LABELS[record.source]} · ${bitLabel(record.bits)} · ${record.address}`;
      return;
    }
    const scriptedOpening = Object.values(state.manifest.riskStreams).some(
      (stream) => stream.records[stream.cursor]?.source === "scripted",
    );
    panel.dataset.source = scriptedOpening ? "scripted" : "simulator";
    query(panel, "b").textContent = scriptedOpening
      ? "Scripted demo · opening ready"
      : "Simulator cache · prefetched";
  }

  private renderEvent(event: GameEvent, summary: string | null = null): void {
    this.lastEventId = event.id;
    const toast = query<HTMLElement>(this.root, "[data-ui='event']");
    toast.dataset.kind = event.type;
    query(toast, "[data-ui='event-sigil']").textContent = summary ? EVENT_SIGILS["risk-consumed"] ?? "◇" : EVENT_SIGILS[event.type] ?? "◆";
    query(toast, "[data-ui='event-message']").textContent = summary ?? event.message;
    toast.classList.remove("is-fresh");
    void toast.offsetWidth;
    toast.classList.add("is-fresh");
  }

  private showPause(state: GameState): void {
    this.overlayMode = "pause";
    this.input.setEnabled(false);
    this.overlay.hidden = false;
    this.overlay.innerHTML = this.pauseMarkup(state);
    query<HTMLButtonElement>(this.overlay, "[data-action='resume']").addEventListener("click", () => this.session.dispatch({ type: "pause-toggle" }));
    query<HTMLButtonElement>(this.overlay, "[data-action='restart']").addEventListener("click", () => { this.session.restart(); this.startCurrentLevel(); });
    query<HTMLButtonElement>(this.overlay, "[data-action='menu']").addEventListener("click", () => { this.session.selectLevel(state.level.id); this.showTitle(); });
  }

  private showResult(state: GameState): void {
    this.overlayMode = "result";
    this.input.setEnabled(false);
    this.overlay.hidden = false;
    this.overlay.innerHTML = this.resultMarkup(state);
    const next = query<HTMLButtonElement>(this.overlay, "[data-action='next']");
    if (!next.disabled) next.addEventListener("click", () => {
      this.showBriefing(state.level.id + 1);
      this.startCurrentLevel();
    });
    query<HTMLButtonElement>(this.overlay, "[data-action='retry']").addEventListener("click", () => { this.session.restart(); this.startCurrentLevel(); });
    query<HTMLButtonElement>(this.overlay, "[data-action='menu']").addEventListener("click", () => { this.session.selectLevel(state.level.id); this.showTitle(); });
  }

  private bindTouchControls(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-move]")) {
      const direction = button.dataset.move as Direction;
      const down = (event: PointerEvent): void => { event.preventDefault(); this.input.move(direction); };
      button.addEventListener("pointerdown", down);
      this.cleanupCallbacks.push(() => button.removeEventListener("pointerdown", down));
    }
    const interact = query<HTMLButtonElement>(this.root, "[data-action='interact']");
    const down = (event: PointerEvent): void => { event.preventDefault(); interact.classList.add("is-held"); this.input.interactDown(); };
    const up = (): void => { interact.classList.remove("is-held"); this.input.interactUp(); };
    interact.addEventListener("pointerdown", down);
    interact.addEventListener("pointerup", up);
    interact.addEventListener("pointercancel", up);
    interact.addEventListener("lostpointercapture", up);
    this.cleanupCallbacks.push(() => { interact.removeEventListener("pointerdown", down); interact.removeEventListener("pointerup", up); interact.removeEventListener("pointercancel", up); interact.removeEventListener("lostpointercapture", up); });
  }

  private onPause = (): void => {
    if (["running", "paused"].includes(this.session.getState().phase)) this.session.dispatch({ type: "pause-toggle" });
  };
}

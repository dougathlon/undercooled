import type { GameSession } from "../game/GameSession";
import type { InputController } from "../input/InputController";
import { LEVELS } from "../simulation/levels";
import type {
  Direction,
  GameEvent,
  GameState,
  JobStage,
  LaneId,
  LevelConfig,
  Provenance,
  PulseKind,
} from "../simulation/types";

type OverlayMode = "title" | "briefing" | "pause" | "result" | null;

const PROVENANCE_LABELS: Record<Provenance, string> = {
  simulator: "Simulator cache",
  scripted: "Scripted tutorial",
  hardware: "Hardware-derived cache",
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
  const labels = ["Mirrored shared controls", "Repeated circuit shots", "Continuous cooling"];
  if (level.features.interactionRisk) labels.push("Pulse-install risk");
  if (level.features.movementRisk) labels.push("Movement risk");
  if (level.features.reciprocalRisk) labels.push("Reciprocal joint faults");
  if (level.features.allowPrestage) labels.push("Limited parallel work");
  if (level.features.pumpTrips) labels.push("Pump service");
  if (level.features.blockedLines) labels.push("Blocked coolant lines");
  return labels;
}

function starCount(state: GameState): number {
  const value = state.score.acceptedJobs;
  return state.level.starThresholds.reduce((total, threshold) => total + (value >= threshold ? 1 : 0), 0);
}

function stars(value: number): string {
  return Array.from({ length: 3 }, (_, index) => (index < value ? "★" : "☆")).join("");
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
          <div class="uc-brandplate"><span class="uc-brandplate__mark">U</span><strong>UNDERCOOLED</strong><small>V0.2 SERVICE BUILD</small></div>
          <div class="uc-stat"><small>Order</small><strong data-ui="level">01 — The Other Pair</strong></div>
          <div class="uc-stat"><small>Accepted jobs</small><strong data-ui="jobs" data-testid="jobs">0 / 3</strong></div>
          <div class="uc-stat uc-stat--heat"><small>Thermal load</small><strong data-ui="thermal">00% · NOMINAL</strong><i><b data-ui="thermal-fill"></b></i></div>
          <div class="uc-stat"><small>Shift</small><strong data-ui="clock">OPEN</strong></div>
          <div class="uc-provenance"><span data-ui="risk-source" data-source="simulator"><i></i><small>Risk</small><b>Awaiting trigger</b></span><span data-ui="shot-source" data-source="simulator"><i></i><small>Shot</small><b>Awaiting measurement</b></span></div>
          <button class="uc-pause" type="button" data-action="pause" data-testid="pause" aria-label="Pause">Ⅱ</button>
        </header>

        <section class="uc-jobstrip" data-testid="job-display">
          <div class="uc-jobstrip__title"><small>Joint job</small><strong data-ui="job-label">AWAITING ACCEPTANCE</strong></div>
          <div class="uc-track"><b>A</b><span data-ui="circuit-a"></span></div>
          <div class="uc-stage"><small>Current operation</small><strong data-ui="stage">ACCEPT JOB</strong><span data-ui="shots">SHOTS 0 / 1</span></div>
          <div class="uc-track uc-track--b"><b>B</b><span data-ui="circuit-b"></span></div>
        </section>

        <div class="uc-lane-state uc-lane-state--a"><b>A</b><span data-ui="lane-a">ACCEPT JOB</span></div>
        <div class="uc-lane-state uc-lane-state--b"><b>B</b><span data-ui="lane-b">COWORKER VEILED</span></div>
        <div class="uc-objective"><b>NEXT</b><span data-ui="objective">Accept the job at the central readout.</span></div>
        <div class="uc-event" data-ui="event" role="status" aria-live="polite"><b data-ui="event-sigil">◆</b><span data-ui="event-message">The nerveworks is standing by.</span></div>

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
    const cards = LEVELS.map((level) => `
      <button class="uc-level-card${level.id === current ? " is-current" : ""}" type="button" data-level="${level.id}" data-testid="level-${level.id}">
        <b>${String(level.id).padStart(2, "0")}</b><span><strong>${escapeHtml(level.title)}</strong><small>${escapeHtml(level.subtitle)}</small></span><i>${level.features.reciprocalRisk ? "◇◇" : "◇"}</i>
      </button>`).join("");
    return `
      <div class="uc-panel uc-panel--title">
        <section class="uc-title-copy">
          <p class="uc-kicker">A grotesque two-channel quantum service comedy <b>PROTOTYPE 0.2</b></p>
          <h1><span>UNDER</span>COOLED</h1>
          <p class="uc-deck">One set of commands. Two mirrored workers. Keep a baroque processor cold while preparing circuits, loading pulses, coupling channels, collecting variable shots, and deciding which body has time to fix the damage.</p>
          <div class="uc-contract"><b>WHAT THE QPU DOES</b><p>Shot records supply valid measured bit-pairs. A separate prefetched risk stream maps joint records onto movement and handling fumbles. Cooling is classical infrastructure and never changes cached bits.</p></div>
          <button class="uc-primary" type="button" data-action="begin" data-testid="begin">Inspect service order <span>→</span></button>
        </section>
        <section class="uc-level-select"><header><b>TEN SERVICE ORDERS</b><small>all unlocked for prototype testing</small></header><div>${cards}</div></section>
      </div>`;
  }

  private briefingMarkup(level: LevelConfig): string {
    const mechanics = mechanicLabels(level).map((label) => `<li>${escapeHtml(label)}</li>`).join("");
    const workflow = "Accept → Prepare → Load → Couple → Run / Measure → Submit → Reset";
    return `
      <div class="uc-panel uc-panel--briefing">
        <div class="uc-order-stamp"><strong>${String(level.id).padStart(2, "0")}</strong><small>SERVICE ORDER</small></div>
        <section>
          <p class="uc-kicker">Accepted paired service job / ${level.durationMs === null ? "untimed" : `${Math.round(level.durationMs / 1000)} second shift`}</p>
          <h2>${escapeHtml(level.title)}</h2><p class="uc-subtitle">${escapeHtml(level.subtitle)}</p>
          <p class="uc-briefing-text">${escapeHtml(level.briefing)}</p>
          <div class="uc-workflow">${workflow.split(" → ").map((step) => `<span>${step}</span>`).join("<i>→</i>")}</div>
          <div class="uc-order-objective"><b>REQUIRED</b><span>${escapeHtml(level.objective)}</span></div>
          <ul class="uc-mechanics">${mechanics}</ul>
        </section>
        <aside>
          <dl><div><dt>Accepted jobs</dt><dd>${level.targetJobs}</dd></div><div><dt>Drop recovery</dt><dd>${level.features.dropExpiryEnabled ? `${level.dropLifetimeMs / 1000}s before expiry` : "no expiry"}</dd></div><div><dt>Cooling</dt><dd>Carry, aim, and hold the cryo lance at exterior manifolds</dd></div><div><dt>Controls</dt><dd>IN and OUT mirror across the processor</dd></div></dl>
          <p>The cartridges are classical control programs for pulses. The qubits stay sealed inside the processor. Identical runs may legitimately produce different measured bit-pairs.</p>
          <div class="uc-modal-actions"><button class="uc-secondary" type="button" data-action="back">Orders</button><button class="uc-primary" type="button" data-action="start" data-testid="start-level">Begin shift <span>→</span></button></div>
        </aside>
      </div>`;
  }

  private pauseMarkup(state: GameState): string {
    return `<div class="uc-panel uc-panel--modal"><p class="uc-kicker">Local control interrupt</p><h2>SHIFT HELD</h2><p>The clock and external refrigeration plant are paused. Neither cached stream has advanced.</p><div class="uc-mini-ledger"><span><small>Jobs</small><b>${state.score.acceptedJobs}</b></span><span><small>Valid shots</small><b>${state.score.validShots}</b></span><span><small>Heat</small><b>${Math.round(state.cooling.load)}%</b></span></div><div class="uc-modal-actions"><button class="uc-primary" type="button" data-action="resume" data-testid="resume">Resume <span>→</span></button><button class="uc-secondary" type="button" data-action="restart">Restart</button><button class="uc-text-button" type="button" data-action="menu">Orders</button></div></div>`;
  }

  private resultMarkup(state: GameState): string {
    const shutdown = state.phase === "shutdown";
    const complete = state.phase === "complete";
    const heading = shutdown ? "PLANT SHUTDOWN" : complete ? "ORDER ACCEPTED" : "SHIFT ABANDONED";
    return `<div class="uc-panel uc-panel--result"><div class="uc-result-seal">${shutdown ? "△" : "Q"}</div><p class="uc-kicker">Service order ${String(state.level.id).padStart(2, "0")} / final ledger</p><h2>${heading}</h2><div class="uc-stars">${stars(shutdown ? 0 : starCount(state))}</div><p>${shutdown ? "The external refrigeration plant lost its service margin. Cached quantum records remain unaltered." : `The processor accepted ${state.score.acceptedJobs} paired service job${state.score.acceptedJobs === 1 ? "" : "s"}.`}</p><div class="uc-result-ledger"><span><small>Accepted jobs</small><b>${state.score.acceptedJobs}</b></span><span><small>Valid shots</small><b>${state.score.validShots}</b></span><span><small>Rejected shots</small><b>${state.score.rejectedShots}</b></span><span><small>Recoveries</small><b>${state.score.recoveries}</b></span><span><small>Mixed actions</small><b>${state.score.mixedActions}</b></span></div><div class="uc-modal-actions"><button class="uc-primary" type="button" data-action="next" data-testid="next-level" ${state.level.id >= LEVELS.length ? "disabled" : ""}>${state.level.id >= LEVELS.length ? "All orders complete" : "Next order"}<span>→</span></button><button class="uc-secondary" type="button" data-action="retry">Retry</button><button class="uc-text-button" type="button" data-action="menu">Orders</button></div></div>`;
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
    query(this.root, "[data-ui='objective']").textContent = this.nextInstruction(state);
    query(this.root, "[data-ui='clock']").textContent = formatClock(state.shiftRemainingMs);

    const load = Math.max(0, Math.min(state.level.heat.maximum, state.cooling.load));
    const ratio = state.level.heat.maximum > 0 ? load / state.level.heat.maximum : 0;
    query(this.root, "[data-ui='thermal']").textContent = `${String(Math.round(ratio * 100)).padStart(2, "0")}% · ${state.cooling.band.toUpperCase()}`;
    (query<HTMLElement>(this.root, "[data-ui='thermal-fill']")).style.width = `${ratio * 100}%`;
    this.shell.dataset.thermal = state.cooling.band;

    this.renderProvenance("risk", state.manifest.lastRisk?.source ?? "simulator", state.manifest.lastRisk ? `${bitLabel(state.manifest.lastRisk.bits)} · ${state.manifest.lastRisk.address}` : "Awaiting trigger");
    this.renderProvenance("shot", state.manifest.lastShot?.source ?? "simulator", state.manifest.lastShot ? `${bitLabel(state.manifest.lastShot.bits)} · ${state.manifest.lastShot.jobId}` : "Awaiting measurement");

    const event = state.events.at(-1);
    if (event && event.id !== this.lastEventId) this.renderEvent(event);
    if (state.phase === "paused" && this.overlayMode !== "pause") this.showPause(state);
    else if (state.phase === "running") {
      this.input.setEnabled(true);
      if (this.overlayMode !== null) this.hideOverlay();
    } else if (["complete", "shutdown"].includes(state.phase) && this.overlayMode !== "result") this.showResult(state);
  };

  private nextInstruction(state: GameState): string {
    if (state.cooling.band === "critical") return "COOLING EMERGENCY — fetch a cryo lance, face an active exterior manifold, and hold ACTION.";
    const stage = state.currentJob.stage;
    if (stage === "accept") return "Both workers: face the central readout and press ACTION to accept the displayed job.";
    if (stage === "prepare") return "Move OUT to PREP, face the counter, and hold ACTION until both channels initialize.";
    if (stage === "load") return "Fetch the next H, X, or Φ cartridge from each outer bench; carry it to PULSE and install in order.";
    if (stage === "couple-install") return "Fetch both coupling halves from AUX and install them at COUPLE.";
    if (stage === "couple-arm") return "Stand at both coupling ports and activate within the synchronization window.";
    if (stage === "canister") return "The courier channel fetches an empty canister from AUX and attaches it at READOUT.";
    if (stage === "run") return "Both channels activate READOUT. Repeat Run → Measure until the valid-shot quota is complete.";
    if (stage === "submission") return "Carry the detached result canister OUT to SUBMIT; invalid canisters belong in the entropy chute.";
    return "Return IN to the readout and activate both reset controls before accepting another job.";
  }

  private renderProvenance(kind: "risk" | "shot", source: Provenance, text: string): void {
    const panel = query<HTMLElement>(this.root, `[data-ui='${kind}-source']`);
    panel.dataset.source = source;
    query(panel, "b").textContent = `${PROVENANCE_LABELS[source]} · ${text}`;
  }

  private renderEvent(event: GameEvent): void {
    this.lastEventId = event.id;
    const toast = query<HTMLElement>(this.root, "[data-ui='event']");
    toast.dataset.kind = event.type;
    query(toast, "[data-ui='event-sigil']").textContent = EVENT_SIGILS[event.type] ?? "◆";
    query(toast, "[data-ui='event-message']").textContent = event.message;
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
    if (!next.disabled) next.addEventListener("click", () => this.showBriefing(state.level.id + 1));
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

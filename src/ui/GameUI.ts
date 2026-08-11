import type { GameSession } from "../game/GameSession";
import { guidanceFor } from "../game/guidance";
import { quantumBlurPresentation } from "../game/quantumBlur";
import type { InputController } from "../input/InputController";
import { riskFixtureLabel } from "../simulation/geometry";
import { LEVELS } from "../simulation/levels";
import { LANE_IDS } from "../simulation/types";
import type {
  GameEvent,
  GameState,
  JobStage,
  LaneId,
  LevelConfig,
  Provenance,
  PulseKind,
} from "../simulation/types";

type OverlayMode = "title" | "pause" | "result" | null;

const DEMO_LIMIT = 4;

const PROVENANCE_LABELS: Record<Provenance, string> = {
  simulator: "SIMULATOR FALLBACK",
  scripted: "SCRIPTED TEACHING RECORD",
  hardware: "HARDWARE-DERIVED CACHE",
};

const STAGE_LABELS: Record<JobStage, string> = {
  accept: "Accept",
  prepare: "Prepare",
  load: "Load pulses",
  "couple-install": "Install coupling",
  "couple-arm": "Arm pair",
  canister: "Attach canister",
  run: "Run / measure",
  submission: "Submit",
  reset: "Reset",
};

const EVENT_SIGILS: Partial<Record<GameEvent["type"], string>> = {
  "risk-consumed": "◇",
  fumble: "!",
  "missed-step": "↯",
  "recovery-picked-up": "↺",
  "item-installed": "✓",
  "preparation-complete": "✓",
  "coupling-armed": "∞",
  "cooling-completed": "❄",
  "emergency-shutdown": "■",
  "lane-revealed": "Ⅱ",
};

const VISIBLE_EVENT_TYPES = new Set<GameEvent["type"]>([
  "lane-revealed",
  "risk-consumed",
  "fumble",
  "missed-step",
  "recovery-picked-up",
  "object-expired",
  "coupling-armed",
  "cooling-completed",
  "emergency-shutdown",
  "level-completed",
]);

interface DemoFrame {
  mode: string;
  title: string;
  premise: string;
  takeaway: string;
}

const DEMO_FRAMES: Record<number, DemoFrame> = {
  1: {
    mode: "LEARN",
    title: "ONE VISIBLE WORKER",
    premise: "Complete a whole job: accept, prepare, load H, attach a canister, measure, submit, and reset. Every command also travels somewhere you cannot yet see.",
    takeaway: "The complete service cycle ran on two channels even though only one worker was visible.",
  },
  2: {
    mode: "REVEAL",
    title: "MATCHED WORKERS, MATCHED ROUTINE",
    premise: "The hidden worker is revealed. Blue and red collect H from matching benches, install it at matching ports, and complete the same full service cycle.",
    takeaway: "One command produced visibly synchronous work at the same relative place on both sides.",
  },
  3: {
    mode: "DISRUPT",
    title: "ONE SIDE LOSES CERTAINTY",
    premise: "Complete the same job while protected records resolve at action and movement addresses. Recover the object, realign, then measure, submit, and reset.",
    takeaway: "The prefetched record disrupted red inside a complete service cycle; recovery returned the job to a finishable state.",
  },
  4: {
    mode: "COMBINE",
    title: "JOINT RECORD + PHYSICAL COOLING",
    premise: "Complete the whole job with protection removed. Recover the joint fault, cool the processor with cryo lances, then measure, submit, and reset.",
    takeaway: "A joint record produced bilateral failure inside a completed job; cooling remained a separate physical maintenance problem.",
  },
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

function pulseLabel(pulse: PulseKind): string {
  return pulse === "P" ? "Φ" : pulse;
}

function circuitTrack(pulses: PulseKind[], loaded: PulseKind[]): string {
  return pulses
    .map((pulse, index) => `<span class="uc-gate${loaded[index] === pulse ? " is-loaded" : ""}">${pulseLabel(pulse)}</span>`)
    .join('<i class="uc-wire"></i>');
}

function formatClock(milliseconds: number | null): string {
  if (milliseconds === null) return "UNTIMED";
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function demoFrame(level: LevelConfig): DemoFrame {
  return DEMO_FRAMES[level.id] ?? {
    mode: "DEMO",
    title: level.title.toUpperCase(),
    premise: level.briefing,
    takeaway: level.objective,
  };
}

function laneStatus(state: GameState, laneId: LaneId, targetLabel?: string): string {
  if (laneId === "B" && !state.laneBRevealed) return "SIGNAL UNAVAILABLE";
  const actor = state.lanes[laneId].actor;
  const held = actor.heldItemId ? state.items[actor.heldItemId] : null;
  if (actor.pose === "fumble") return "FUMBLED — RECOVER";
  if (actor.pose === "missed") return "MISSED STEP";
  if (actor.pose === "spray") return "SPRAYING MANIFOLD";
  if (held) return `CARRYING ${held.kind.replaceAll("-", " ").toUpperCase()}`;
  if (targetLabel) return targetLabel;
  return STAGE_LABELS[state.currentJob.stage].toUpperCase();
}

function mostRecentRiskCause(state: GameState, event: GameEvent): GameEvent | null {
  if (!["risk-consumed", "fumble", "missed-step", "item-installed"].includes(event.type)) return null;
  if (event.type === "risk-consumed") return event;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const candidate = state.events[index];
    if (candidate.id >= event.id) continue;
    if (candidate.type === "risk-consumed") return candidate;
  }
  return null;
}

function riskConsequence(state: GameState, risk: GameEvent): string {
  const nextRisk = state.events.find(
    (candidate) => candidate.id > risk.id && candidate.type === "risk-consumed",
  );
  const consequences = state.events.filter(
    (candidate) =>
      candidate.id > risk.id &&
      candidate.id < (nextRisk?.id ?? Number.POSITIVE_INFINITY) &&
      (candidate.type === "fumble" || candidate.type === "missed-step"),
  );
  if (consequences.length === 0) {
    const participants = risk.participants ?? [...LANE_IDS];
    return participants.length === 1 ? `${participants[0]} SUCCEEDS` : "BOTH SUCCEED";
  }
  const lanes = [...new Set(consequences.flatMap((candidate) => candidate.lane ?? []))];
  return consequences.every((candidate) => candidate.type === "missed-step")
    ? `${lanes.join(" + ")} MISSES A STEP`
    : `${lanes.join(" + ")} FUMBLES`;
}

function riskEventMessage(state: GameState, event: GameEvent): string | null {
  const risk = mostRecentRiskCause(state, event);
  if (!risk?.source || !risk.bits) return null;
  const fixture = riskFixtureLabel(risk.address);
  return `${PROVENANCE_LABELS[risk.source]}  •  ${risk.bits.join("")} AT ${fixture}  →  ${riskConsequence(state, risk)}`;
}

function eventIsVisible(state: GameState, event: GameEvent): boolean {
  if (!VISIBLE_EVENT_TYPES.has(event.type)) return false;
  if (state.laneBRevealed) return true;
  if (event.lane === "B" || event.type === "mixed-context") return false;
  return !/Channel B|both output channels|Both internal/i.test(event.message);
}

function displayedStage(state: GameState, headline: string): string {
  if (headline.includes("CRYO") || headline.includes("MANIFOLD")) return "COOL PROCESSOR";
  if (headline.startsWith("RECOVER")) return "RECOVERY";
  if (headline.includes("MARKED SQUARE")) return "MOVEMENT TEST";
  if (headline.includes("RESYNCHRONIZE")) return "REALIGN PAIR";
  return STAGE_LABELS[state.currentJob.stage].toUpperCase();
}

interface ResultTraceEntry {
  label: string;
  value: string;
}

export function resultTrace(state: GameState): ResultTraceEntry[] {
  const completionEntries = (): ResultTraceEntry[] => {
    const shot = [...state.events].reverse().find((event) => event.type === "shot-consumed" && event.bits);
    return [
      ...(shot?.bits
        ? [{ label: `${shot.source?.toUpperCase() ?? "CACHED"} · MEASURED SHOT`, value: shot.bits.join("") }]
        : []),
      ...(state.events.some((event) => event.type === "processor-reset")
        ? [{ label: "SERVICE CYCLE", value: "SUBMITTED + RESET" }]
        : []),
    ];
  };
  const risks = state.events.filter(
    (event) => event.type === "risk-consumed" && event.source && event.bits,
  );
  if (risks.length > 0) {
    const entries = risks.map((risk) => ({
      label: `${risk.source?.toUpperCase()} · ${riskFixtureLabel(risk.address)} ${risk.bits?.join("")}`,
      value: riskConsequence(state, risk),
    }));
    if (state.level.demo.lesson === "joint-risk") {
      entries.push({ label: "SIMULATED · QUANTUM BLUR", value: "VISUALIZES HEAT ONLY" });
      entries.push({ label: "CLASSICAL · CRYO SPRAY", value: "LOWERS HEAT ONLY" });
    }
    return [...entries, ...completionEntries()];
  }
  if (state.level.id === 1) {
    return [
      { label: "INPUT", value: "ONE COMMAND" },
      { label: "BLUE", value: "INSTALLS H" },
      { label: "REMOTE", value: "MIRRORS H" },
      ...completionEntries(),
    ];
  }
  return [
    { label: "INPUT", value: "ONE COMMAND" },
    { label: "BLUE", value: "INSTALLS H" },
    { label: "RED", value: "INSTALLS H" },
    ...completionEntries(),
  ];
}

export class GameUI {
  private overlayMode: OverlayMode = "title";
  private lastEventId = 0;
  private unsubscribe: (() => void) | null = null;
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
      this.session.selectLevel(1);
      this.startCurrentLevel();
    });
    query<HTMLButtonElement>(this.overlay, "[data-action='skip-fault']").addEventListener("click", () => {
      this.session.selectLevel(3);
      this.startCurrentLevel();
    });
    for (const button of this.overlay.querySelectorAll<HTMLButtonElement>("[data-level]")) {
      button.addEventListener("click", () => {
        this.session.selectLevel(Number(button.dataset.level));
        this.startCurrentLevel();
      });
    }
  }

  /** Presenter/debug selection keeps a scene in briefing state until startCurrentLevel is called. */
  showBriefing(levelId: number): void {
    this.session.selectLevel(levelId);
    this.lastEventId = 0;
  }

  startCurrentLevel(): void {
    if (this.session.getState().phase !== "briefing") this.session.restart();
    this.lastEventId = 0;
    this.session.dispatch({ type: "start" });
    this.input.setEnabled(true);
    this.hideOverlay();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.pauseButton.removeEventListener("click", this.onPause);
    this.root.replaceChildren();
  }

  private shellMarkup(): string {
    return `
      <div class="uc-shell" data-screen="title" data-thermal="nominal" data-b-revealed="false">
        <header class="uc-hud" data-testid="hud">
          <div class="uc-brandplate"><span>U</span><strong>UNDERCOOLED</strong><small>DESKTOP DEMO · V0.5</small></div>
          <div class="uc-scene-id"><small>SCENE</small><strong data-ui="level">01 · LEARN</strong></div>
          <div class="uc-heat" data-ui="heat-panel" hidden><small data-ui="heat-label">PROCESSOR HEAT</small><strong data-ui="thermal">72% · WARM</strong><i><b data-ui="thermal-fill"></b></i></div>
          <div class="uc-clock" data-ui="clock-panel" hidden><small>TIME</small><strong data-ui="clock">01:30</strong></div>
          <button class="uc-pause" type="button" data-action="pause" data-testid="pause" aria-label="Pause">Ⅱ</button>
        </header>

        <section class="uc-jobstrip" data-testid="job-display">
          <div class="uc-track"><b>A</b><span data-ui="circuit-a"></span></div>
          <div class="uc-jobstrip__center"><small data-ui="job-label">HIDDEN SYMMETRY</small><strong data-ui="stage">ACCEPT</strong></div>
          <div class="uc-track uc-track--b"><b data-ui="b-marker">?</b><span data-ui="circuit-b"><em>SIGNAL OFFLINE</em></span></div>
        </section>

        <div class="uc-lane-state uc-lane-state--a"><b>BLUE</b><span data-ui="lane-a">ACCEPT</span></div>
        <div class="uc-lane-state uc-lane-state--b"><b data-ui="b-label">REMOTE</b><span data-ui="lane-b">SIGNAL UNAVAILABLE</span></div>

        <section class="uc-guidance" data-ui="guidance" data-testid="guidance">
          <div><small data-ui="eyebrow">STEP 1</small><strong data-ui="headline">ACTIVATE THE READOUT</strong><p data-ui="detail">One shared ACTION accepts the computation.</p></div>
          <kbd data-ui="command">PRESS ACTION</kbd>
        </section>

        <div class="uc-event" data-ui="event" role="status" aria-live="polite" hidden><b data-ui="event-sigil">◆</b><span data-ui="event-message"></span></div>
        <div class="uc-key-help"><span><kbd>W S / ↑ ↓</kbd> VERTICAL</span><span><kbd>A / ←</kbd> OUT</span><span><kbd>D / →</kbd> IN</span><span><kbd>SPACE / E</kbd> ACTION · HOLD WHEN ASKED</span><span><kbd>R</kbd> RESTART</span></div>
        <section class="uc-overlay" data-testid="overlay" aria-live="polite"></section>
      </div>`;
  }

  private titleMarkup(): string {
    const sceneButtons = LEVELS.slice(0, DEMO_LIMIT).map((level) => {
      const frame = demoFrame(level);
      return `<button type="button" data-level="${level.id}" data-testid="level-${level.id}"><b>${level.id}</b><span><strong>${escapeHtml(frame.mode)}</strong><small>${escapeHtml(frame.title)}</small></span></button>`;
    }).join("");
    return `
      <div class="uc-panel uc-panel--title">
        <section class="uc-title-copy">
          <p class="uc-kicker">MOTH QUANTUM · FOUR-SCENE DESKTOP DEMO</p>
          <h1><span>UNDER</span>COOLED</h1>
          <p class="uc-deck">One command controls two mirrored service workers. Their local situations—and later cached quantum records—make that command resolve differently.</p>
          <div class="uc-title-actions">
            <button class="uc-primary" type="button" data-action="begin" data-testid="begin">START DEMO <span>→</span></button>
            <button class="uc-secondary" type="button" data-action="skip-fault">SKIP TO FIRST QUANTUM FAULT</button>
          </div>
          <p class="uc-controls-note">Keyboard: WASD or arrows to move · Space or E to act</p>
        </section>
        <aside class="uc-demo-map"><header><b>PRESENTER SHORTCUTS</b><small>The demo teaches itself in sequence. These buttons are only for live jumping.</small></header><div>${sceneButtons}</div></aside>
      </div>`;
  }

  private pauseMarkup(): string {
    return `<div class="uc-panel uc-panel--modal"><p class="uc-kicker">DEMO PAUSED</p><h2>PROCESS HELD</h2><p>No cached record advances while paused.</p><div class="uc-modal-actions"><button class="uc-primary" type="button" data-action="resume" data-testid="resume">RESUME <span>→</span></button><button class="uc-secondary" type="button" data-action="restart">RESTART SCENE</button><button class="uc-text-button" type="button" data-action="menu">DEMO MENU</button></div></div>`;
  }

  private resultMarkup(state: GameState): string {
    const shutdown = state.phase === "shutdown";
    const frame = demoFrame(state.level);
    const nextLevel = state.level.id < DEMO_LIMIT ? LEVELS.find((level) => level.id === state.level.id + 1) : undefined;
    const nextFrame = nextLevel ? demoFrame(nextLevel) : null;
    const trace = resultTrace(state)
      .map((entry) => `<span><small>${escapeHtml(entry.label)}</small><b>${escapeHtml(entry.value)}</b></span>`)
      .join("");
    return `
      <div class="uc-panel uc-panel--result">
        <div class="uc-result-seal">${shutdown ? "△" : String(state.level.id).padStart(2, "0")}</div>
        <p class="uc-kicker">${shutdown ? "THERMAL FAILURE" : `SCENE ${state.level.id} COMPLETE`}</p>
        <h2>${shutdown ? "PROCESSOR SHUTDOWN" : escapeHtml(frame.title)}</h2>
        <p class="uc-result-takeaway">${escapeHtml(shutdown ? "The external cooling margin failed. The cached quantum record itself was not changed." : frame.takeaway)}</p>
        <div class="uc-result-ledger">${trace}</div>
        ${nextFrame ? `<div class="uc-next-preview"><b>NEXT · ${escapeHtml(nextFrame.mode)}</b><span>${escapeHtml(nextFrame.premise)}</span></div>` : '<div class="uc-next-preview"><b>DEMO COMPLETE</b><span>The central rule has progressed from hidden shared control to bilateral quantum-derived failure.</span></div>'}
        <div class="uc-modal-actions"><button class="uc-primary" type="button" data-action="next" data-testid="next-level" ${nextLevel ? "" : "disabled"}>${nextLevel ? `START SCENE ${nextLevel.id}` : "ALL FOUR SCENES COMPLETE"}<span>→</span></button><button class="uc-secondary" type="button" data-action="retry">REPLAY</button><button class="uc-text-button" type="button" data-action="menu">DEMO MENU</button></div>
      </div>`;
  }

  private hideOverlay(): void {
    this.overlayMode = null;
    this.shell.dataset.screen = "running";
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
  }

  private renderState = (state: GameState): void => {
    const frame = demoFrame(state.level);
    const guide = guidanceFor(state);
    this.shell.dataset.bRevealed = String(state.laneBRevealed);
    this.shell.dataset.thermal = state.cooling.band;
    query(this.root, "[data-ui='level']").textContent = `${String(state.level.id).padStart(2, "0")} · ${frame.mode}`;
    query(this.root, "[data-ui='job-label']").textContent = state.currentJob.definition.label.toUpperCase();
    query(this.root, "[data-ui='stage']").textContent = displayedStage(state, guide.headline);
    query(this.root, "[data-ui='circuit-a']").innerHTML = circuitTrack(state.currentJob.definition.pulses.A, state.lanes.A.job.loadedPulses);
    query(this.root, "[data-ui='circuit-b']").innerHTML = state.laneBRevealed
      ? circuitTrack(state.currentJob.definition.pulses.B, state.lanes.B.job.loadedPulses)
      : "<em>SIGNAL OFFLINE</em>";
    query(this.root, "[data-ui='b-marker']").textContent = state.laneBRevealed ? "B" : "?";
    query(this.root, "[data-ui='b-label']").textContent = state.laneBRevealed ? "RED" : "REMOTE";
    query(this.root, "[data-ui='lane-a']").textContent = laneStatus(state, "A", guide.targets.A?.label);
    query(this.root, "[data-ui='lane-b']").textContent = laneStatus(state, "B", guide.targets.B?.label);
    query(this.root, "[data-ui='eyebrow']").textContent = guide.eyebrow;
    query(this.root, "[data-ui='headline']").textContent = guide.headline;
    query(this.root, "[data-ui='detail']").textContent = guide.detail;
    query(this.root, "[data-ui='command']").textContent = guide.command;
    query<HTMLElement>(this.root, "[data-ui='guidance']").dataset.urgent = String(guide.urgent);

    const heatPanel = query<HTMLElement>(this.root, "[data-ui='heat-panel']");
    const clockPanel = query<HTMLElement>(this.root, "[data-ui='clock-panel']");
    heatPanel.hidden = !state.level.demo.showHeat;
    clockPanel.hidden = !state.level.demo.showHeat;
    const load = Math.max(0, Math.min(state.level.heat.maximum, state.cooling.load));
    const ratio = load / Math.max(1, state.level.heat.maximum);
    const quantumBlur = quantumBlurPresentation(state);
    this.shell.dataset.quantumBlur = quantumBlur.active ? "simulated" : "off";
    query(this.root, "[data-ui='heat-label']").textContent = quantumBlur.active
      ? "QUANTUM BLUR · SIMULATED"
      : "PROCESSOR HEAT";
    query(this.root, "[data-ui='thermal']").textContent = quantumBlur.active
      ? `${Math.round(ratio * 100)}% · ${state.cooling.band.toUpperCase()} · BLUR ${quantumBlur.blurPixels.toFixed(1)}`
      : `${Math.round(ratio * 100)}% · ${state.cooling.band.toUpperCase()}`;
    query<HTMLElement>(this.root, "[data-ui='thermal-fill']").style.width = `${ratio * 100}%`;
    query(this.root, "[data-ui='clock']").textContent = formatClock(state.shiftRemainingMs);

    const newestId = state.events.at(-1)?.id ?? 0;
    const visibleEvent = [...state.events].reverse().find(
      (event) => event.id > this.lastEventId && eventIsVisible(state, event),
    );
    if (visibleEvent) this.renderEvent(state, visibleEvent);
    this.lastEventId = Math.max(this.lastEventId, newestId);

    if (state.phase === "paused" && this.overlayMode !== "pause") this.showPause(state);
    else if (state.phase === "running") {
      this.input.setEnabled(true);
      if (this.overlayMode !== null) this.hideOverlay();
    } else if (["complete", "shutdown"].includes(state.phase) && this.overlayMode !== "result") {
      this.showResult(state);
    }
  };

  private renderEvent(state: GameState, event: GameEvent): void {
    const toast = query<HTMLElement>(this.root, "[data-ui='event']");
    const summary = riskEventMessage(state, event);
    toast.hidden = false;
    toast.dataset.kind = event.type;
    query(toast, "[data-ui='event-sigil']").textContent = summary ? "◇" : EVENT_SIGILS[event.type] ?? "◆";
    query(toast, "[data-ui='event-message']").textContent = summary ?? event.message;
    toast.classList.remove("is-fresh");
    void toast.offsetWidth;
    toast.classList.add("is-fresh");
  }

  private showPause(_state: GameState): void {
    this.overlayMode = "pause";
    this.input.setEnabled(false);
    this.overlay.hidden = false;
    this.overlay.innerHTML = this.pauseMarkup();
    query<HTMLButtonElement>(this.overlay, "[data-action='resume']").addEventListener("click", () => this.session.dispatch({ type: "pause-toggle" }));
    query<HTMLButtonElement>(this.overlay, "[data-action='restart']").addEventListener("click", () => {
      this.session.restart();
      this.startCurrentLevel();
    });
    query<HTMLButtonElement>(this.overlay, "[data-action='menu']").addEventListener("click", () => this.showTitle());
  }

  private showResult(state: GameState): void {
    this.overlayMode = "result";
    this.input.setEnabled(false);
    this.overlay.hidden = false;
    this.overlay.innerHTML = this.resultMarkup(state);
    const next = query<HTMLButtonElement>(this.overlay, "[data-action='next']");
    if (!next.disabled) next.addEventListener("click", () => {
      this.session.selectLevel(state.level.id + 1);
      this.startCurrentLevel();
    });
    query<HTMLButtonElement>(this.overlay, "[data-action='retry']").addEventListener("click", () => {
      this.session.restart();
      this.startCurrentLevel();
    });
    query<HTMLButtonElement>(this.overlay, "[data-action='menu']").addEventListener("click", () => this.showTitle());
  }

  private onPause = (): void => {
    if (["running", "paused"].includes(this.session.getState().phase)) {
      this.session.dispatch({ type: "pause-toggle" });
    }
  };
}

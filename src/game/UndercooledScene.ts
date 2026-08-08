import Phaser from "phaser";
import {
  COUPLE_BUFFER_POSITION,
  COUPLE_POSITION,
  LANCE_RACK_POSITION,
  MOVEMENT_RISK_POSITION,
  PREP_POSITION,
  PULSE_BUFFER_POSITION,
  PULSE_POSITION,
  PUMP_POSITION,
  READOUT_BUFFER_POSITION,
  READOUT_POSITION,
  RESERVOIR_POSITION,
  SUPPLY_POSITIONS,
  counterToWorld,
  gridToWorld,
  laneWorldDelta,
  supplyToWorld,
} from "../simulation/geometry";
import type {
  ActorPose,
  Direction,
  GameEvent,
  GameState,
  GridPosition,
  ItemState,
  JobStage,
  LaneId,
  Provenance,
} from "../simulation/types";
import { LANE_IDS } from "../simulation/types";
import type { GameSession } from "./GameSession";

const WORLD_WIDTH = 1_600;
const WORLD_HEIGHT = 900;

const COLORS = {
  void: 0x090807,
  soot: 0x17130f,
  gold: 0xb77b24,
  hotGold: 0xf2bd4b,
  whiteGold: 0xffe8a6,
  cyan: 0x45e3df,
  frost: 0xc5ffff,
  plum: 0x44243d,
  alarm: 0xe44f39,
  accepted: 0xaadf7a,
};

const PROVENANCE_COLORS: Record<Provenance, number> = {
  scripted: COLORS.whiteGold,
  hardware: COLORS.hotGold,
  simulator: COLORS.cyan,
};

const POSE_FRAME: Record<ActorPose, number> = {
  idle: 1,
  carry: 2,
  success: 3,
  fumble: 4,
  missed: 4,
  recover: 5,
  operate: 5,
  spray: 2,
};

const STATION_LABELS = ["SUBMIT", "PREP", "PULSE", "COUPLE", "READOUT"] as const;
const STAGE_STATION: Record<JobStage, number> = {
  accept: 4,
  prepare: 1,
  load: 2,
  "couple-install": 3,
  "couple-arm": 3,
  canister: 4,
  run: 4,
  submission: 0,
  reset: 4,
};

type TextPair = Record<LaneId, Phaser.GameObjects.Text[]>;

export class UndercooledScene extends Phaser.Scene {
  private readonly session: GameSession;
  private heatGhost!: Phaser.GameObjects.Image;
  private staticLayer!: Phaser.GameObjects.Graphics;
  private stateLayer!: Phaser.GameObjects.Graphics;
  private laneBVeil!: Phaser.GameObjects.Rectangle;
  private laneBVeilText!: Phaser.GameObjects.Text;
  private stationTexts!: TextPair;
  private actors!: Record<LaneId, Phaser.GameObjects.Image>;
  private shadows!: Record<LaneId, Phaser.GameObjects.Ellipse>;
  private renderedState: GameState | null = null;
  private renderedLevelId = 0;
  private lastEventId = 0;

  constructor(session: GameSession) {
    super({ key: "undercooled" });
    this.session = session;
  }

  preload(): void {
    const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
    this.load.setBaseURL(baseUrl);
    this.load.image(
      "undercooled-workshop-v2",
      "assets/environment/undercooled-central-workshop-v2.png",
    );
    for (const laneId of LANE_IDS) {
      const worker = laneId === "A" ? "worker-a" : "worker-b";
      for (let frame = 1; frame <= 5; frame += 1) {
        this.load.image(
          `${worker}-${frame}`,
          `assets/characters/${worker}-frames/${String(frame).padStart(2, "0")}.png`,
        );
      }
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.void);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.add
      .image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "undercooled-workshop-v2")
      .setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT)
      .setDepth(0);
    this.heatGhost = this.add
      .image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "undercooled-workshop-v2")
      .setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT)
      .setTint(COLORS.hotGold)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setDepth(1);

    this.staticLayer = this.add.graphics().setDepth(8);
    this.stateLayer = this.add.graphics().setDepth(95);
    this.stationTexts = { A: [], B: [] };
    this.createStationText();

    this.laneBVeil = this.add
      .rectangle(1_220, 566, 758, 650, COLORS.void, 0.94)
      .setStrokeStyle(3, COLORS.gold, 0.45)
      .setDepth(80);
    this.laneBVeilText = this.add
      .text(1_220, 560, "CHANNEL B\nSIGNAL OCCLUDED", {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "24px",
        align: "center",
        color: "#f2bd4b",
        stroke: "#090807",
        strokeThickness: 6,
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setDepth(81);

    this.shadows = {
      A: this.add.ellipse(0, 0, 108, 30, 0x000000, 0.62).setDepth(68),
      B: this.add.ellipse(0, 0, 108, 30, 0x000000, 0.62).setDepth(68),
    };
    this.actors = {
      A: this.add.image(0, 0, "worker-a-1").setOrigin(0.5, 0.9).setDepth(70),
      B: this.add.image(0, 0, "worker-b-1").setOrigin(0.5, 0.9).setDepth(70),
    };

    this.createSparkTexture();
    const state = this.session.getState();
    this.redrawStatic(state);
    this.snapActors(state);
    this.syncView(state, 16);
  }

  update(_time: number, delta: number): void {
    this.session.tick(delta);
    const state = this.session.getState();
    if (state !== this.renderedState || state.level.id !== this.renderedLevelId) {
      this.redrawStatic(state);
      this.snapActors(state);
    }
    this.syncView(state, delta);
    this.consumePresentationEvents(state);
  }

  private createSparkTexture(): void {
    if (this.textures.exists("gold-spark")) return;
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(COLORS.whiteGold, 1);
    graphics.fillCircle(4, 4, 4);
    graphics.generateTexture("gold-spark", 8, 8);
    graphics.destroy();
  }

  private createStationText(): void {
    for (const laneId of LANE_IDS) {
      this.stationTexts[laneId] = STATION_LABELS.map((label, index) => {
        const point = counterToWorld(laneId, index);
        return this.add
          .text(point.x, point.y - 7, label, {
            fontFamily: "Arial Black, Arial, sans-serif",
            fontSize: "14px",
            color: "#b77b24",
            stroke: "#090807",
            strokeThickness: 5,
            align: "center",
          })
          .setOrigin(0.5)
          .setDepth(14);
      });

      for (const [label, localY] of [
        ["H", 0],
        ["X", 1],
        ["P", 2],
        ["AUX", 3],
      ] as const) {
        const point = supplyToWorld(laneId, localY);
        this.add
          .text(point.x, point.y + 39, label, {
            fontFamily: "Arial Black, Arial, sans-serif",
            fontSize: "13px",
            color: label === "H" ? "#45e3df" : label === "X" ? "#f2bd4b" : "#ffe8a6",
            stroke: "#090807",
            strokeThickness: 5,
          })
          .setOrigin(0.5)
          .setDepth(14);
      }
      const rack = gridToWorld(laneId, LANCE_RACK_POSITION);
      this.add
        .text(rack.x + (laneId === "A" ? 35 : -35), rack.y + 69, "LANCE", {
          fontFamily: "Arial Black, Arial, sans-serif",
          fontSize: "11px",
          color: "#c5ffff",
          stroke: "#090807",
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(14);
    }
  }

  private redrawStatic(state: GameState): void {
    this.renderedState = state;
    this.renderedLevelId = state.level.id;
    this.lastEventId = 0;
    this.staticLayer.clear();

    this.drawProcessorFrame();
    for (const laneId of LANE_IDS) {
      this.drawLaneGrid(laneId);
      this.drawCounterStations(laneId);
      this.drawBuffers(laneId);
      this.drawSupplies(laneId);
      this.drawCoolingFixtures(laneId);
      this.drawSafeStops(laneId);
      this.drawRiskAddresses(state, laneId);
    }
  }

  private drawProcessorFrame(): void {
    this.staticLayer.fillStyle(COLORS.void, 0.55);
    this.staticLayer.fillRoundedRect(725, 399, 150, 75, 20);
    this.staticLayer.lineStyle(4, COLORS.hotGold, 0.72);
    this.staticLayer.strokeRoundedRect(725, 399, 150, 75, 20);
    this.staticLayer.lineStyle(2, COLORS.cyan, 0.55);
    this.staticLayer.strokeCircle(800, 437, 26);
    this.staticLayer.lineBetween(616, 437, 725, 437);
    this.staticLayer.lineBetween(875, 437, 984, 437);
    for (const y of [481, 589, 697, 805]) {
      this.staticLayer.lineStyle(3, COLORS.cyan, 0.2);
      this.staticLayer.lineBetween(647, y, 690, y);
      this.staticLayer.lineBetween(910, y, 953, y);
    }
  }

  private drawLaneGrid(laneId: LaneId): void {
    for (let y = 0; y <= 3; y += 1) {
      for (let x = 0; x <= 4; x += 1) {
        const point = gridToWorld(laneId, { x, y });
        this.staticLayer.fillStyle(COLORS.void, 0.07);
        this.staticLayer.fillRoundedRect(point.x - 47, point.y - 40, 94, 80, 7);
        this.staticLayer.lineStyle(1.5, COLORS.gold, 0.25);
        this.staticLayer.strokeRoundedRect(point.x - 47, point.y - 40, 94, 80, 7);
      }
    }
    const outer = gridToWorld(laneId, { x: 0, y: 0 });
    const inner = gridToWorld(laneId, { x: 4, y: 0 });
    this.staticLayer.lineStyle(4, COLORS.gold, 0.42);
    this.staticLayer.lineBetween(outer.x, 392, inner.x, 392);
  }

  private drawCounterStations(laneId: LaneId): void {
    for (let index = 0; index < STATION_LABELS.length; index += 1) {
      const counter = counterToWorld(laneId, index);
      const floor = gridToWorld(laneId, { x: index, y: 0 });
      this.staticLayer.fillStyle(COLORS.void, 0.84);
      this.staticLayer.fillRoundedRect(counter.x - 49, counter.y - 22, 98, 38, 7);
      this.staticLayer.lineStyle(2, COLORS.gold, 0.76);
      this.staticLayer.strokeRoundedRect(counter.x - 49, counter.y - 22, 98, 38, 7);
      this.staticLayer.lineStyle(3, index === 4 ? COLORS.cyan : COLORS.hotGold, 0.62);
      this.staticLayer.strokeCircle(counter.x, counter.y + 34, 17);
      this.staticLayer.lineStyle(2, COLORS.gold, 0.4);
      this.staticLayer.lineBetween(counter.x, counter.y + 51, floor.x, floor.y - 43);
    }
  }

  private drawBuffers(laneId: LaneId): void {
    for (const position of [PULSE_BUFFER_POSITION, COUPLE_BUFFER_POSITION, READOUT_BUFFER_POSITION]) {
      const point = gridToWorld(laneId, position);
      this.staticLayer.fillStyle(COLORS.void, 0.48);
      this.staticLayer.fillRoundedRect(point.x - 39, point.y - 26, 78, 52, 9);
      this.staticLayer.lineStyle(3, COLORS.whiteGold, 0.42);
      this.staticLayer.strokeRoundedRect(point.x - 39, point.y - 26, 78, 52, 9);
      this.staticLayer.lineStyle(2, COLORS.gold, 0.48);
      this.staticLayer.lineBetween(point.x - 28, point.y, point.x + 28, point.y);
      this.staticLayer.lineBetween(point.x, point.y - 16, point.x, point.y + 16);
    }
  }

  private drawSupplies(laneId: LaneId): void {
    const supplies = [
      { pulse: "H", position: SUPPLY_POSITIONS.H, color: COLORS.cyan },
      { pulse: "X", position: SUPPLY_POSITIONS.X, color: COLORS.hotGold },
      { pulse: "P", position: SUPPLY_POSITIONS.P, color: COLORS.whiteGold },
      { pulse: "AUX", position: SUPPLY_POSITIONS.AUX, color: COLORS.accepted },
    ] as const;

    for (const supply of supplies) {
      const point = supplyToWorld(laneId, supply.position.y);
      this.staticLayer.fillStyle(COLORS.void, 0.88);
      this.staticLayer.fillRoundedRect(point.x - 39, point.y - 30, 78, 60, 9);
      this.staticLayer.lineStyle(3, supply.color, 0.86);
      this.staticLayer.strokeRoundedRect(point.x - 39, point.y - 30, 78, 60, 9);
      if (supply.pulse === "AUX") {
        this.drawAuxGlyph(this.staticLayer, point.x, point.y, 0.82, supply.color);
      } else {
        this.drawPulseGlyph(this.staticLayer, supply.pulse, point.x, point.y, 1, supply.color);
      }
    }

    const rack = gridToWorld(laneId, LANCE_RACK_POSITION);
    const lanceX = rack.x + (laneId === "A" ? 35 : -35);
    this.staticLayer.fillStyle(COLORS.void, 0.74);
    this.staticLayer.fillRoundedRect(lanceX - 26, rack.y + 31, 52, 30, 8);
    this.staticLayer.lineStyle(3, COLORS.cyan, 0.9);
    this.staticLayer.strokeRoundedRect(lanceX - 26, rack.y + 31, 52, 30, 8);
    this.drawLanceGlyph(this.staticLayer, lanceX, rack.y + 46, 0.85, COLORS.frost);
  }

  private drawCoolingFixtures(laneId: LaneId): void {
    const reservoir = gridToWorld(laneId, RESERVOIR_POSITION);
    const pump = gridToWorld(laneId, PUMP_POSITION);
    this.staticLayer.fillStyle(COLORS.void, 0.7);
    this.staticLayer.fillCircle(reservoir.x, reservoir.y, 34);
    this.staticLayer.lineStyle(4, COLORS.cyan, 0.72);
    this.staticLayer.strokeCircle(reservoir.x, reservoir.y, 34);
    this.staticLayer.lineStyle(2, COLORS.frost, 0.58);
    this.staticLayer.strokeCircle(reservoir.x, reservoir.y, 19);

    this.staticLayer.fillStyle(COLORS.void, 0.7);
    this.staticLayer.fillRoundedRect(pump.x - 34, pump.y - 29, 68, 58, 11);
    this.staticLayer.lineStyle(4, COLORS.cyan, 0.7);
    this.staticLayer.strokeRoundedRect(pump.x - 34, pump.y - 29, 68, 58, 11);
    this.staticLayer.lineStyle(3, COLORS.frost, 0.5);
    this.staticLayer.strokeCircle(pump.x, pump.y, 13);
  }

  private drawSafeStops(laneId: LaneId): void {
    for (const localX of [0, 4]) {
      const point = gridToWorld(laneId, { x: localX, y: 0 });
      const side = localX === 0 ? (laneId === "A" ? -1 : 1) : laneId === "A" ? 1 : -1;
      const railX = point.x + side * 48;
      this.staticLayer.fillStyle(COLORS.gold, 0.9);
      this.staticLayer.fillRoundedRect(railX - 7, point.y - 42, 14, 84, 5);
      this.staticLayer.lineStyle(2, COLORS.void, 0.85);
      for (let y = point.y - 33; y <= point.y + 27; y += 15) {
        this.staticLayer.lineBetween(railX - 5, y, railX + 5, y + 10);
      }
    }
  }

  private drawRiskAddresses(state: GameState, laneId: LaneId): void {
    if (state.level.features.interactionRisk) {
      for (const position of [PULSE_POSITION, COUPLE_POSITION, READOUT_POSITION]) {
        const point = gridToWorld(laneId, position);
        this.staticLayer.lineStyle(4, COLORS.hotGold, 0.82);
        this.staticLayer.strokeRoundedRect(point.x - 45, point.y - 38, 90, 76, 9);
        this.staticLayer.lineStyle(2, COLORS.whiteGold, 0.5);
        this.staticLayer.strokeCircle(point.x, point.y, 12);
      }
    }
    if (state.level.features.movementRisk) {
      const point = gridToWorld(laneId, MOVEMENT_RISK_POSITION);
      this.staticLayer.fillStyle(COLORS.cyan, 0.08);
      this.staticLayer.fillRoundedRect(point.x - 45, point.y - 38, 90, 76, 9);
      this.staticLayer.lineStyle(4, COLORS.cyan, 0.9);
      this.staticLayer.strokeRoundedRect(point.x - 45, point.y - 38, 90, 76, 9);
      for (let offset = -22; offset <= 22; offset += 22) {
        this.staticLayer.lineStyle(3, COLORS.frost, 0.62);
        this.staticLayer.beginPath();
        this.staticLayer.moveTo(point.x + offset - 9, point.y + 8);
        this.staticLayer.lineTo(point.x + offset, point.y - 8);
        this.staticLayer.lineTo(point.x + offset + 9, point.y + 8);
        this.staticLayer.strokePath();
      }
    }
  }

  private snapActors(state: GameState): void {
    for (const laneId of LANE_IDS) {
      const point = gridToWorld(laneId, state.lanes[laneId].actor.position);
      this.actors[laneId].setPosition(point.x, point.y);
      this.shadows[laneId].setPosition(point.x, point.y - 4);
    }
  }

  private syncView(state: GameState, delta: number): void {
    const smoothing = Math.min(1, delta / 78);
    for (const laneId of LANE_IDS) {
      const actorState = state.lanes[laneId].actor;
      const point = gridToWorld(laneId, actorState.position);
      const image = this.actors[laneId];
      const shadow = this.shadows[laneId];
      image.x = Phaser.Math.Linear(image.x || point.x, point.x, smoothing);
      image.y = Phaser.Math.Linear(image.y || point.y, point.y, smoothing);
      image
        .setScale(point.scale)
        .setFlipX(actorState.facing === "out")
        .setDepth(70 + point.y / 30)
        .setTexture(`${laneId === "A" ? "worker-a" : "worker-b"}-${POSE_FRAME[actorState.pose]}`);
      shadow.x = image.x;
      shadow.y = image.y - 4;
      shadow.setScale(point.scale * 1.72, point.scale * 1.2).setDepth(image.depth - 1);
    }

    const obscured = !state.laneBRevealed;
    const veilTarget = obscured ? 0.94 : 0;
    this.laneBVeil.alpha = Phaser.Math.Linear(this.laneBVeil.alpha, veilTarget, smoothing * 0.3);
    this.laneBVeilText.alpha = Phaser.Math.Linear(
      this.laneBVeilText.alpha,
      obscured ? 1 : 0,
      smoothing * 0.3,
    );
    this.actors.B.setAlpha(obscured ? 0 : 1);
    this.shadows.B.setAlpha(obscured ? 0 : 0.62);

    const heatRatio = Phaser.Math.Clamp(
      state.cooling.load / Math.max(1, state.level.heat.maximum),
      0,
      1,
    );
    this.heatGhost.setTint(state.cooling.alarmed ? COLORS.alarm : COLORS.hotGold);
    this.heatGhost.alpha = Math.max(0, (heatRatio - 0.35) * 0.25);
    this.heatGhost.x = WORLD_WIDTH / 2 + Math.sin(state.simTimeMs / 170) * heatRatio * 7;
    this.heatGhost.y = WORLD_HEIGHT / 2 + Math.cos(state.simTimeMs / 230) * heatRatio * 1.5;
    this.cameras.main.setZoom(
      heatRatio > 0.86 && state.phase === "running"
        ? 1 + Math.sin(state.simTimeMs / 120) * 0.0018
        : 1,
    );

    this.syncStationText(state);
    this.drawDynamicState(state);
  }

  private syncStationText(state: GameState): void {
    const activeStation = STAGE_STATION[state.currentJob.stage];
    for (const laneId of LANE_IDS) {
      for (let index = 0; index < this.stationTexts[laneId].length; index += 1) {
        const active = index === activeStation;
        let label: string = STATION_LABELS[index];
        if (index === 4 && state.currentJob.stage === "accept") label = "ACCEPT";
        if (index === 4 && state.currentJob.stage === "reset") label = "RESET";
        this.stationTexts[laneId][index]
          .setText(label)
          .setColor(active ? "#ffe8a6" : "#b77b24")
          .setAlpha(laneId === "B" && !state.laneBRevealed ? 0 : active ? 1 : 0.75);
      }
    }
  }

  private drawDynamicState(state: GameState): void {
    this.stateLayer.clear();
    this.drawStageHighlight(state);
    for (const laneId of LANE_IDS) {
      if (laneId === "B" && !state.laneBRevealed) continue;
      this.drawLaneJobState(state, laneId);
      this.drawCoolingState(state, laneId);
    }
    this.drawItems(state);
    this.drawProcessorState(state);
    this.drawThermalAlarm(state);
  }

  private drawStageHighlight(state: GameState): void {
    const station = STAGE_STATION[state.currentJob.stage];
    const pulse = 0.65 + Math.sin(state.simTimeMs / 180) * 0.24;
    for (const laneId of LANE_IDS) {
      if (laneId === "B" && !state.laneBRevealed) continue;
      const counter = counterToWorld(laneId, station);
      const floor = gridToWorld(laneId, { x: station, y: 0 });
      this.stateLayer.lineStyle(5, COLORS.whiteGold, pulse);
      this.stateLayer.strokeRoundedRect(counter.x - 54, counter.y - 27, 108, 48, 9);
      this.stateLayer.lineStyle(4, COLORS.hotGold, pulse * 0.82);
      this.stateLayer.strokeRoundedRect(floor.x - 49, floor.y - 42, 98, 84, 10);
    }
  }

  private drawLaneJobState(state: GameState, laneId: LaneId): void {
    const lane = state.lanes[laneId];
    const prep = counterToWorld(laneId, PREP_POSITION.x);
    const pulse = counterToWorld(laneId, PULSE_POSITION.x);
    const couple = counterToWorld(laneId, COUPLE_POSITION.x);
    const readout = counterToWorld(laneId, READOUT_POSITION.x);

    if (lane.job.prepared || lane.job.preparationProgressMs > 0) {
      const progress = lane.job.prepared
        ? 1
        : Phaser.Math.Clamp(
            lane.job.preparationProgressMs / Math.max(1, state.level.heat.preparationHoldMs),
            0,
            1,
          );
      this.drawProgressArc(prep.x, prep.y + 34, 24, progress, lane.job.prepared ? COLORS.accepted : COLORS.cyan);
    }

    lane.job.loadedPulses.forEach((kind, index) => {
      const direction = laneId === "A" ? 1 : -1;
      this.drawPulseGlyph(
        this.stateLayer,
        kind,
        pulse.x + direction * (index - (lane.job.loadedPulses.length - 1) / 2) * 21,
        pulse.y + 34,
        0.52,
        kind === "H" ? COLORS.cyan : kind === "X" ? COLORS.hotGold : COLORS.whiteGold,
      );
    });

    if (lane.job.couplingInstalled) {
      this.drawCouplingGlyph(this.stateLayer, couple.x, couple.y + 34, 0.72, COLORS.whiteGold, laneId);
    }
    if (lane.job.couplingArmedAtMs !== null) {
      this.stateLayer.lineStyle(4, COLORS.accepted, 0.9);
      this.stateLayer.strokeCircle(couple.x, couple.y + 34, 25);
    }
    if (lane.job.resetArmed) {
      this.stateLayer.lineStyle(5, COLORS.cyan, 0.92);
      this.stateLayer.strokeCircle(readout.x, readout.y + 34, 26);
      this.stateLayer.lineBetween(readout.x - 11, readout.y + 34, readout.x, readout.y + 44);
      this.stateLayer.lineBetween(readout.x, readout.y + 44, readout.x + 15, readout.y + 25);
    }
  }

  private drawCoolingState(state: GameState, laneId: LaneId): void {
    const reservoir = gridToWorld(laneId, RESERVOIR_POSITION);
    const reservoirLevel = Phaser.Math.Clamp(state.cooling.reservoir[laneId] / 100, 0, 1);
    this.drawProgressArc(reservoir.x, reservoir.y, 40, reservoirLevel, COLORS.cyan);

    const pump = gridToWorld(laneId, PUMP_POSITION);
    if (state.cooling.pumpTripped[laneId]) {
      const blink = 0.55 + Math.sin(state.simTimeMs / 95) * 0.4;
      this.stateLayer.lineStyle(6, COLORS.alarm, blink);
      this.stateLayer.strokeRoundedRect(pump.x - 39, pump.y - 34, 78, 68, 12);
    } else if (state.lanes[laneId].job.pumpProgressMs > 0) {
      const progress = Phaser.Math.Clamp(
        state.lanes[laneId].job.pumpProgressMs / Math.max(1, state.level.heat.pumpRestartHoldMs),
        0,
        1,
      );
      this.drawProgressArc(pump.x, pump.y, 39, progress, COLORS.frost);
    }

    for (const hotspot of state.cooling.hotspots) {
      if (hotspot.lane !== laneId) continue;
      const point = gridToWorld(laneId, hotspot.position);
      const ratio = Phaser.Math.Clamp(hotspot.heat / 100, 0, 1);
      const color = ratio > 0.72 ? COLORS.alarm : ratio > 0.35 ? COLORS.hotGold : COLORS.cyan;
      if (hotspot.active) {
        this.stateLayer.fillStyle(color, 0.08 + ratio * 0.16);
        this.stateLayer.fillCircle(point.x, point.y, 30 + ratio * 15);
        this.stateLayer.lineStyle(4, color, 0.55 + ratio * 0.4);
        this.stateLayer.strokeCircle(point.x, point.y, 22 + ratio * 10);
      }
      if (hotspot.blockedLine) {
        this.stateLayer.lineStyle(6, COLORS.alarm, 0.95);
        this.stateLayer.lineBetween(point.x - 21, point.y - 21, point.x + 21, point.y + 21);
        this.stateLayer.lineBetween(point.x + 21, point.y - 21, point.x - 21, point.y + 21);
      }
    }

    const actor = state.lanes[laneId].actor;
    const held = actor.heldItemId ? state.items[actor.heldItemId] : null;
    if (
      actor.pose === "spray" ||
      (held?.kind === "cryo-lance" && state.interactHeld && state.activeHoldLanes.includes(laneId))
    ) {
      this.drawCryoSpray(laneId, actor.facing);
    }
  }

  private drawCryoSpray(laneId: LaneId, facing: Direction): void {
    const actor = this.actors[laneId];
    const delta = laneWorldDelta(laneId, facing);
    const length = 126;
    const dx = delta.x * length;
    const dy = delta.y * length * 0.72;
    const startX = actor.x + delta.x * 24;
    const startY = actor.y - 48 + delta.y * 12;
    const endX = startX + dx;
    const endY = startY + dy;
    const normalX = delta.y * 18;
    const normalY = -delta.x * 18;
    this.stateLayer.fillStyle(COLORS.cyan, 0.16);
    this.stateLayer.fillTriangle(
      startX,
      startY,
      endX + normalX,
      endY + normalY,
      endX - normalX,
      endY - normalY,
    );
    this.stateLayer.lineStyle(5, COLORS.frost, 0.8);
    this.stateLayer.lineBetween(startX, startY, endX, endY);
    for (let index = 0; index < 4; index += 1) {
      const amount = 0.48 + index * 0.14;
      const flutter = Math.sin(this.session.getState().simTimeMs / 60 + index) * 9;
      this.stateLayer.fillStyle(index % 2 === 0 ? COLORS.frost : COLORS.cyan, 0.75);
      this.stateLayer.fillCircle(
        Phaser.Math.Linear(startX, endX, amount) + normalX * (flutter / 18),
        Phaser.Math.Linear(startY, endY, amount) + normalY * (flutter / 18),
        4 + index,
      );
    }
  }

  private drawItems(state: GameState): void {
    const installedOffsets = new Map<string, number>();
    for (const item of Object.values(state.items)) {
      if (item.location.kind === "discarded") continue;
      let x: number;
      let y: number;
      let scale = 1;

      if (item.location.kind === "held") {
        if (item.location.lane === "B" && !state.laneBRevealed) continue;
        const actor = this.actors[item.location.lane];
        x = actor.x + (item.location.lane === "A" ? 29 : -29);
        y = actor.y - 71;
        scale = 0.82;
      } else if (item.location.kind === "dropped") {
        if (item.location.lane === "B" && !state.laneBRevealed) continue;
        const point = gridToWorld(item.location.lane, item.location.position);
        x = point.x;
        y = point.y - 5;
        scale = 1;
      } else {
        if (item.location.lane === "B" && !state.laneBRevealed) continue;
        const localX =
          item.location.fixture === "pulse"
            ? PULSE_POSITION.x
            : item.location.fixture === "couple"
              ? COUPLE_POSITION.x
              : READOUT_POSITION.x;
        const point = counterToWorld(item.location.lane, localX);
        const key = `${item.location.lane}/${item.location.fixture}`;
        const index = installedOffsets.get(key) ?? 0;
        installedOffsets.set(key, index + 1);
        const direction = item.location.lane === "A" ? 1 : -1;
        x = point.x + direction * (index - 1) * 19;
        y = point.y + 34;
        scale = 0.66;
      }

      this.drawItemGlyph(this.stateLayer, item, x, y, scale);
      if (item.location.kind === "dropped" && item.expiresAtMs !== null) {
        const lifetime = Math.max(1, state.level.dropLifetimeMs);
        const remaining = Phaser.Math.Clamp((item.expiresAtMs - state.simTimeMs) / lifetime, 0, 1);
        this.drawProgressArc(x, y, 34, remaining, remaining < 0.3 ? COLORS.alarm : COLORS.whiteGold);
      }
    }
  }

  private drawProcessorState(state: GameState): void {
    const heatRatio = Phaser.Math.Clamp(
      state.cooling.load / Math.max(1, state.level.heat.maximum),
      0,
      1,
    );
    const pulse = 0.65 + Math.sin(state.simTimeMs / 115) * 0.22;
    const color = heatRatio > 0.85 ? COLORS.alarm : state.processor.phase === "readout" ? COLORS.cyan : COLORS.hotGold;
    this.stateLayer.lineStyle(state.processor.phase === "idle" ? 3 : 6, color, pulse);
    this.stateLayer.strokeCircle(800, 437, 31 + (state.processor.phase === "executing" ? pulse * 8 : 0));

    if (state.processor.phase !== "idle") {
      this.stateLayer.lineStyle(4, color, 0.58);
      this.stateLayer.lineBetween(616, 437, 765, 437);
      this.stateLayer.lineBetween(835, 437, 984, 437);
    }
    if (state.currentJob.resultReady) {
      this.stateLayer.lineStyle(5, COLORS.accepted, pulse);
      this.stateLayer.strokeRoundedRect(741, 395, 118, 84, 16);
    }
  }

  private drawThermalAlarm(state: GameState): void {
    if (!state.cooling.alarmed) return;
    const heatRatio = Phaser.Math.Clamp(
      state.cooling.load / Math.max(1, state.level.heat.maximum),
      0,
      1,
    );
    const pulse = 0.24 + (Math.sin(state.simTimeMs / 145) + 1) * 0.14;
    this.stateLayer.lineStyle(9, heatRatio > 0.92 ? COLORS.alarm : COLORS.hotGold, pulse);
    this.stateLayer.strokeRoundedRect(12, 12, WORLD_WIDTH - 24, WORLD_HEIGHT - 24, 18);
  }

  private drawProgressArc(x: number, y: number, radius: number, progress: number, color: number): void {
    this.stateLayer.lineStyle(6, color, 0.94);
    this.stateLayer.beginPath();
    this.stateLayer.arc(
      x,
      y,
      radius,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * Phaser.Math.Clamp(progress, 0, 1),
      false,
    );
    this.stateLayer.strokePath();
  }

  private drawItemGlyph(
    graphics: Phaser.GameObjects.Graphics,
    item: ItemState,
    x: number,
    y: number,
    scale: number,
  ): void {
    if (item.kind.startsWith("pulse-")) {
      const pulse = item.kind.slice(-1) as "H" | "X" | "P";
      const color = pulse === "H" ? COLORS.cyan : pulse === "X" ? COLORS.hotGold : COLORS.whiteGold;
      this.drawPulseGlyph(graphics, pulse, x, y, scale, color);
      return;
    }
    if (item.kind === "coupling-half") {
      this.drawCouplingGlyph(graphics, x, y, scale, COLORS.whiteGold, item.lane);
      return;
    }
    if (item.kind === "empty-canister" || item.kind === "result-canister") {
      this.drawCanisterGlyph(graphics, x, y, scale, item.kind === "result-canister");
      return;
    }
    if (item.kind === "coolant-cell") {
      this.drawCoolantCellGlyph(graphics, x, y, scale);
      return;
    }
    this.drawLanceGlyph(graphics, x, y, scale, COLORS.frost);
    if (item.charge !== null) {
      const charge = Phaser.Math.Clamp(item.charge / 100, 0, 1);
      graphics.fillStyle(COLORS.void, 0.88);
      graphics.fillRect(x - 20 * scale, y + 16 * scale, 40 * scale, 5 * scale);
      graphics.fillStyle(COLORS.cyan, 0.9);
      graphics.fillRect(x - 20 * scale, y + 16 * scale, 40 * scale * charge, 5 * scale);
    }
  }

  private drawPulseGlyph(
    graphics: Phaser.GameObjects.Graphics,
    pulse: "H" | "X" | "P",
    x: number,
    y: number,
    scale: number,
    color: number,
  ): void {
    const width = 38 * scale;
    const height = 27 * scale;
    graphics.fillStyle(COLORS.void, 0.94);
    graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, 5 * scale);
    graphics.lineStyle(3 * scale, color, 1);
    graphics.strokeRoundedRect(x - width / 2, y - height / 2, width, height, 5 * scale);
    const left = x - 7 * scale;
    const right = x + 7 * scale;
    const top = y - 7 * scale;
    const bottom = y + 7 * scale;
    graphics.lineStyle(2.8 * scale, color, 1);
    if (pulse === "H") {
      graphics.lineBetween(left, top, left, bottom);
      graphics.lineBetween(right, top, right, bottom);
      graphics.lineBetween(left, y, right, y);
    } else if (pulse === "X") {
      graphics.lineBetween(left, top, right, bottom);
      graphics.lineBetween(right, top, left, bottom);
    } else {
      graphics.lineBetween(left, top, left, bottom);
      graphics.beginPath();
      graphics.arc(left, y - 2 * scale, 8 * scale, -Math.PI / 2, Math.PI / 2, false);
      graphics.strokePath();
    }
  }

  private drawAuxGlyph(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    scale: number,
    color: number,
  ): void {
    graphics.lineStyle(3 * scale, color, 0.95);
    graphics.strokeCircle(x, y, 13 * scale);
    graphics.lineBetween(x - 8 * scale, y, x + 8 * scale, y);
    graphics.lineBetween(x, y - 8 * scale, x, y + 8 * scale);
  }

  private drawCouplingGlyph(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    scale: number,
    color: number,
    laneId: LaneId,
  ): void {
    const direction = laneId === "A" ? 1 : -1;
    graphics.fillStyle(COLORS.void, 0.94);
    graphics.fillCircle(x, y, 14 * scale);
    graphics.lineStyle(3 * scale, color, 1);
    graphics.beginPath();
    graphics.arc(
      x,
      y,
      12 * scale,
      laneId === "A" ? -Math.PI / 2 : Math.PI / 2,
      laneId === "A" ? Math.PI / 2 : (Math.PI * 3) / 2,
      false,
    );
    graphics.strokePath();
    graphics.lineBetween(x, y, x + direction * 22 * scale, y);
    graphics.fillCircle(x + direction * 22 * scale, y, 4 * scale);
  }

  private drawCanisterGlyph(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    scale: number,
    full: boolean,
  ): void {
    graphics.fillStyle(COLORS.void, 0.95);
    graphics.fillRoundedRect(x - 15 * scale, y - 18 * scale, 30 * scale, 36 * scale, 8 * scale);
    graphics.lineStyle(3 * scale, full ? COLORS.accepted : COLORS.whiteGold, 1);
    graphics.strokeRoundedRect(x - 15 * scale, y - 18 * scale, 30 * scale, 36 * scale, 8 * scale);
    graphics.lineBetween(x - 9 * scale, y - 10 * scale, x + 9 * scale, y - 10 * scale);
    if (full) {
      graphics.fillStyle(COLORS.cyan, 0.9);
      for (const offsetX of [-6, 6]) {
        for (const offsetY of [0, 10]) graphics.fillCircle(x + offsetX * scale, y + offsetY * scale, 2.8 * scale);
      }
    }
  }

  private drawCoolantCellGlyph(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    scale: number,
  ): void {
    graphics.fillStyle(COLORS.cyan, 0.22);
    graphics.fillRoundedRect(x - 12 * scale, y - 22 * scale, 24 * scale, 44 * scale, 11 * scale);
    graphics.lineStyle(3 * scale, COLORS.frost, 0.95);
    graphics.strokeRoundedRect(x - 12 * scale, y - 22 * scale, 24 * scale, 44 * scale, 11 * scale);
    graphics.lineBetween(x - 7 * scale, y, x + 7 * scale, y);
  }

  private drawLanceGlyph(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    scale: number,
    color: number,
  ): void {
    graphics.lineStyle(6 * scale, COLORS.void, 0.95);
    graphics.lineBetween(x - 19 * scale, y + 10 * scale, x + 17 * scale, y - 11 * scale);
    graphics.lineStyle(3 * scale, color, 1);
    graphics.lineBetween(x - 19 * scale, y + 10 * scale, x + 17 * scale, y - 11 * scale);
    graphics.fillStyle(COLORS.cyan, 0.95);
    graphics.fillCircle(x + 20 * scale, y - 13 * scale, 4 * scale);
    graphics.lineStyle(4 * scale, COLORS.hotGold, 0.9);
    graphics.lineBetween(x - 17 * scale, y + 8 * scale, x - 8 * scale, y + 17 * scale);
  }

  private consumePresentationEvents(state: GameState): void {
    const events = state.events.filter((event) => event.id > this.lastEventId);
    for (const event of events) this.presentEvent(event);
    if (events.length > 0) this.lastEventId = events[events.length - 1].id;
  }

  private presentEvent(event: GameEvent): void {
    if ((event.type === "risk-consumed" || event.type === "shot-consumed") && event.source) {
      const color = PROVENANCE_COLORS[event.source];
      if (event.type === "shot-consumed") {
        this.presentationPulse(800, 437, 46, color);
      } else {
        const position = this.positionForAddress(event.address);
        const laneIds = event.lane ? [event.lane] : [...LANE_IDS];
        for (const laneId of laneIds) {
          if (laneId === "B" && !this.session.getState().laneBRevealed) continue;
          const point = gridToWorld(laneId, position);
          this.presentationPulse(point.x, point.y, 49, color);
        }
      }
    }

    if ((event.type === "fumble" || event.type === "missed-step") && event.lane) {
      const actor = this.actors[event.lane];
      this.cameras.main.shake(150, 0.0045);
      const echo = this.add
        .image(actor.x - 12, actor.y, actor.texture.key)
        .setOrigin(0.5, 0.9)
        .setScale(actor.scaleX)
        .setTint(COLORS.plum)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(0.42)
        .setDepth(actor.depth - 0.5);
      this.tweens.add({
        targets: echo,
        x: actor.x + 18,
        alpha: 0,
        duration: 310,
        ease: "Quad.easeOut",
        onComplete: () => echo.destroy(),
      });
    }

    if (event.type === "job-submitted" || event.type === "level-completed") {
      const particles = this.add.particles(800, 500, "gold-spark", {
        speed: { min: 80, max: 250 },
        angle: { min: 195, max: 345 },
        lifespan: 700,
        quantity: 26,
        scale: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      particles.setDepth(110);
      particles.explode(28);
      this.time.delayedCall(800, () => particles.destroy());
    }

    if (event.type === "cooling-completed" || event.type === "coolant-installed") {
      const flash = this.add
        .rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, COLORS.cyan, 0.14)
        .setDepth(120);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 420,
        onComplete: () => flash.destroy(),
      });
    }

    if (event.type === "emergency-shutdown") {
      this.cameras.main.flash(500, 228, 79, 57, true);
      this.cameras.main.shake(520, 0.008);
    }
    if (event.type === "lane-revealed") this.cameras.main.flash(620, 243, 200, 93, true);
  }

  private positionForAddress(address: string | undefined): GridPosition {
    if (address?.includes("PULSE")) return PULSE_POSITION;
    if (address?.includes("COUPLE")) return COUPLE_POSITION;
    if (address?.includes("READOUT")) return READOUT_POSITION;
    if (address?.includes("TRANSFER") || address?.includes("movement")) return MOVEMENT_RISK_POSITION;
    return PULSE_POSITION;
  }

  private presentationPulse(x: number, y: number, radius: number, color: number): void {
    const pulse = this.add.graphics().setPosition(x, y).setDepth(115);
    pulse.lineStyle(7, color, 0.94);
    pulse.strokeCircle(0, 0, radius);
    this.tweens.add({
      targets: pulse,
      alpha: 0,
      scaleX: 1.28,
      scaleY: 1.28,
      duration: 440,
      ease: "Quad.easeOut",
      onComplete: () => pulse.destroy(),
    });
  }
}

export const PHASER_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  backgroundColor: "#090807",
  transparent: false,
  antialias: true,
  pixelArt: false,
  render: {
    powerPreference: "high-performance",
    antialias: true,
    roundPixels: false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  },
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
};

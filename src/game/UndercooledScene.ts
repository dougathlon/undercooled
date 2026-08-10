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
} from "../simulation/geometry";
import type {
  ActorPose,
  Direction,
  GameEvent,
  GameState,
  GridPosition,
  ItemKind,
  LaneId,
  Provenance,
  PulseKind,
} from "../simulation/types";
import { LANE_IDS } from "../simulation/types";
import type { GameSession } from "./GameSession";
import { STAGE_STATION_INDEX, STATIONS } from "./presentationContract";
import {
  GRID_COLUMNS,
  GRID_ROWS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  counterToWorld,
  gridToWorld,
  laneWorldDelta,
  supplyToWorld,
} from "./visualLayout";

const COLORS = {
  void: 0x132126,
  gold: 0xa85f2b,
  hotGold: 0xd9943b,
  whiteGold: 0xf7e8c7,
  cyan: 0x35bfc6,
  frost: 0xd9fffb,
  plum: 0x654459,
  alarm: 0xdf4c3e,
  accepted: 0x72b875,
  laneA: 0x2b7f9a,
  laneB: 0xa44a3f,
  floor: 0xe8e4d6,
  floorShade: 0xd5ddcf,
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

const ITEM_TEXTURES: Record<Exclude<ItemKind, "cryo-lance">, string> = {
  "pulse-H": "item-pulse-H-v3",
  "pulse-X": "item-pulse-X-v3",
  "pulse-P": "item-pulse-P-v3",
  "coupling-half": "item-coupling-half-v3",
  "empty-canister": "item-empty-canister-v3",
  "result-canister": "item-result-canister-v3",
  "coolant-cell": "item-coolant-cell-v3",
};

type TextPair = Record<LaneId, Phaser.GameObjects.Text[]>;
type ImagePair = Record<LaneId, Phaser.GameObjects.Image[]>;
type SupplyCueState = "inactive" | "active" | "empty";

export class UndercooledScene extends Phaser.Scene {
  private readonly session: GameSession;
  private staticLayer!: Phaser.GameObjects.Graphics;
  private stateLayer!: Phaser.GameObjects.Graphics;
  private laneBVeil!: Phaser.GameObjects.Rectangle;
  private laneBVeilText!: Phaser.GameObjects.Text;
  private stationTexts!: TextPair;
  private stationProps!: ImagePair;
  private pulseSupplySprites!: Record<LaneId, Record<PulseKind, Phaser.GameObjects.Image>>;
  private auxSupplySprites!: Record<LaneId, Phaser.GameObjects.Image>;
  private readonly itemSprites = new Map<string, Phaser.GameObjects.Image>();
  private lanceRackSprites!: Record<LaneId, Phaser.GameObjects.Image>;
  private lanceItemSprites!: Record<LaneId, Phaser.GameObjects.Image>;
  private actors!: Record<LaneId, Phaser.GameObjects.Image>;
  private shadows!: Record<LaneId, Phaser.GameObjects.Ellipse>;
  private renderedState: GameState | null = null;
  private renderedLevelId = 0;
  private lastEventId = 0;
  private lastSimulationTickAtMs = 0;

  constructor(session: GameSession) {
    super({ key: "undercooled" });
    this.session = session;
  }

  preload(): void {
    const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
    this.load.setBaseURL(baseUrl);
    this.load.image(
      "undercooled-workshop-v3",
      "assets/environment/undercooled-workshop-shell-v3.png",
    );
    for (const station of STATIONS) {
      this.load.image(`station-${station.kind}-v3`, `assets/stations-v3/${station.kind}.png`);
    }
    for (const [kind, texture] of Object.entries(ITEM_TEXTURES)) {
      this.load.image(texture, `assets/items-v3/${kind.toLowerCase()}.png`);
    }
    this.load.image("cryo-lance-v3", "assets/tools-v3/cryo-lance.png");
    for (const laneId of LANE_IDS) {
      const worker = laneId === "A" ? "worker-a" : "worker-b";
      for (let frame = 1; frame <= 5; frame += 1) {
        this.load.image(
          `${worker}-${frame}`,
          `assets/characters-v4/${worker}-frames/${String(frame).padStart(2, "0")}.png`,
        );
      }
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.void);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.add
      .image(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, "undercooled-workshop-v3")
      .setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT)
      .setDepth(0);

    this.staticLayer = this.add.graphics().setDepth(8);
    this.stateLayer = this.add.graphics().setDepth(100);
    this.createStationProps();
    this.stationTexts = { A: [], B: [] };
    this.createStationText();
    this.createSupplySprites();
    this.createLanceSprites();

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
    this.lastSimulationTickAtMs = performance.now();
  }

  update(_time: number, delta: number): void {
    const now = performance.now();
    const elapsedMs = Math.max(0, now - this.lastSimulationTickAtMs);
    this.lastSimulationTickAtMs = now;

    // Phaser smooths render delta aggressively when the renderer is slow. The
    // service simulation must follow elapsed play time instead; its own 250 ms
    // cap prevents a hidden or stalled tab from jumping through deadlines.
    this.session.tick(elapsedMs);
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
      const laneColor = laneId === "A" ? "#2b7f9a" : "#a44a3f";
      this.stationTexts[laneId] = STATIONS.map((station) => {
        const point = counterToWorld(laneId, station.localX);
        return this.add
          .text(point.x, point.y + 8, station.label, {
            fontFamily: "Arial Black, Arial, sans-serif",
            fontSize: "13px",
            color: "#fff7e4",
            backgroundColor: laneColor,
            stroke: laneColor,
            strokeThickness: 2,
            align: "center",
            padding: { x: 7, y: 3 },
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
            color: label === "H" ? "#167f8d" : label === "X" ? "#b0602c" : "#5a4530",
            stroke: "#fff7e4",
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(14);
      }
      const rack = gridToWorld(laneId, LANCE_RACK_POSITION);
      this.add
        .text(rack.x + (laneId === "A" ? 35 : -35), rack.y + 69, "LANCE", {
          fontFamily: "Arial Black, Arial, sans-serif",
          fontSize: "11px",
          color: "#167f8d",
          stroke: "#fff7e4",
          strokeThickness: 4,
        })
        .setOrigin(0.5)
        .setDepth(14);
    }
  }

  private createStationProps(): void {
    this.stationProps = { A: [], B: [] };
    for (const laneId of LANE_IDS) {
      this.stationProps[laneId] = STATIONS.map((station) => {
        const point = counterToWorld(laneId, station.localX);
        return this.add
          .image(point.x, point.y - 72, `station-${station.kind}-v3`)
          .setOrigin(0.5)
          .setScale(0.42)
          .setFlipX(laneId === "B")
          .setDepth(12);
      });
    }
  }

  private createLanceSprites(): void {
    this.lanceRackSprites = { A: this.createLanceSprite(), B: this.createLanceSprite() };
    this.lanceItemSprites = { A: this.createLanceSprite(), B: this.createLanceSprite() };

    for (const laneId of LANE_IDS) {
      const rack = gridToWorld(laneId, LANCE_RACK_POSITION);
      this.lanceRackSprites[laneId]
        .setPosition(rack.x + (laneId === "A" ? 32 : -32), rack.y + 42)
        .setDisplaySize(76, 76)
        .setFlipX(laneId === "A")
        .setDepth(13);
      this.lanceItemSprites[laneId].setVisible(false).setDepth(101);
    }
  }

  private createLanceSprite(): Phaser.GameObjects.Image {
    return this.add.image(0, 0, "cryo-lance-v3").setOrigin(0.5);
  }

  private createSupplySprites(): void {
    this.pulseSupplySprites = {
      A: this.createPulseSupplySet("A"),
      B: this.createPulseSupplySet("B"),
    };
    this.auxSupplySprites = {
      A: this.add.image(0, 0, ITEM_TEXTURES["coupling-half"]).setOrigin(0.5).setDepth(13),
      B: this.add.image(0, 0, ITEM_TEXTURES["coupling-half"]).setOrigin(0.5).setDepth(13),
    };
    for (const laneId of LANE_IDS) {
      const aux = supplyToWorld(laneId, SUPPLY_POSITIONS.AUX.y);
      this.auxSupplySprites[laneId]
        .setPosition(aux.x, aux.y)
        .setDisplaySize(60, 60)
        .setFlipX(laneId === "B");
    }
  }

  private createPulseSupplySet(laneId: LaneId): Record<PulseKind, Phaser.GameObjects.Image> {
    const create = (kind: PulseKind): Phaser.GameObjects.Image => {
      const point = supplyToWorld(laneId, SUPPLY_POSITIONS[kind].y);
      return this.add
        .image(point.x, point.y, ITEM_TEXTURES[`pulse-${kind}`])
        .setOrigin(0.5)
        .setDisplaySize(60, 60)
        .setFlipX(laneId === "B")
        .setDepth(13);
    };
    return { H: create("H"), X: create("X"), P: create("P") };
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
    this.staticLayer.fillStyle(COLORS.void, 0.88);
    this.staticLayer.fillRoundedRect(742, 401, 116, 72, 18);
    this.staticLayer.lineStyle(4, COLORS.hotGold, 0.92);
    this.staticLayer.strokeRoundedRect(742, 401, 116, 72, 18);
    this.staticLayer.lineStyle(3, COLORS.cyan, 0.72);
    this.staticLayer.strokeCircle(800, 437, 24);
    this.staticLayer.lineBetween(646, 437, 742, 437);
    this.staticLayer.lineBetween(858, 437, 954, 437);
    for (const y of [481, 589, 697, 805]) {
      this.staticLayer.lineStyle(3, COLORS.cyan, 0.3);
      this.staticLayer.lineBetween(654, y, 684, y);
      this.staticLayer.lineBetween(916, y, 946, y);
    }
  }

  private drawLaneGrid(laneId: LaneId): void {
    const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLUMNS; x += 1) {
        const point = gridToWorld(laneId, { x, y });
        this.staticLayer.fillStyle(y % 2 === 0 ? COLORS.floor : COLORS.floorShade, 0.82);
        this.staticLayer.fillRoundedRect(point.x - 48, point.y - 41, 96, 82, 8);
        this.staticLayer.lineStyle(2, laneColor, 0.34);
        this.staticLayer.strokeRoundedRect(point.x - 48, point.y - 41, 96, 82, 8);
      }
    }
    const outer = gridToWorld(laneId, { x: 0, y: 0 });
    const inner = gridToWorld(laneId, { x: 4, y: 0 });
    this.staticLayer.lineStyle(5, laneColor, 0.72);
    this.staticLayer.lineBetween(outer.x, 392, inner.x, 392);
  }

  private drawCounterStations(laneId: LaneId): void {
    const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;
    for (const station of STATIONS) {
      const counter = counterToWorld(laneId, station.localX);
      const floor = gridToWorld(laneId, { x: station.localX, y: 0 });
      this.staticLayer.lineStyle(3, laneColor, 0.65);
      this.staticLayer.lineBetween(counter.x, counter.y + 25, floor.x, floor.y - 44);
    }
  }

  private drawBuffers(laneId: LaneId): void {
    const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;
    for (const position of [PULSE_BUFFER_POSITION, COUPLE_BUFFER_POSITION, READOUT_BUFFER_POSITION]) {
      const point = gridToWorld(laneId, position);
      this.staticLayer.fillStyle(COLORS.cyan, 0.13);
      this.staticLayer.fillRoundedRect(point.x - 39, point.y - 26, 78, 52, 9);
      this.staticLayer.lineStyle(3, laneColor, 0.7);
      this.staticLayer.strokeRoundedRect(point.x - 39, point.y - 26, 78, 52, 9);
      this.staticLayer.lineStyle(3, COLORS.cyan, 0.68);
      for (const offset of [-22, 0, 22]) {
        this.staticLayer.lineBetween(point.x + offset - 8, point.y + 13, point.x + offset + 8, point.y - 13);
      }
    }
  }

  private drawSupplies(laneId: LaneId): void {
    const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;
    const supplies = [
      { pulse: "H", position: SUPPLY_POSITIONS.H, color: COLORS.cyan },
      { pulse: "X", position: SUPPLY_POSITIONS.X, color: COLORS.hotGold },
      { pulse: "P", position: SUPPLY_POSITIONS.P, color: COLORS.whiteGold },
      { pulse: "AUX", position: SUPPLY_POSITIONS.AUX, color: COLORS.accepted },
    ] as const;

    for (const supply of supplies) {
      const point = supplyToWorld(laneId, supply.position.y);
      this.staticLayer.fillStyle(COLORS.whiteGold, 0.97);
      this.staticLayer.fillRoundedRect(point.x - 39, point.y - 31, 78, 62, 11);
      this.staticLayer.lineStyle(4, laneColor, 0.88);
      this.staticLayer.strokeRoundedRect(point.x - 39, point.y - 31, 78, 62, 11);
      this.staticLayer.lineStyle(2, supply.color, 0.75);
      this.staticLayer.lineBetween(point.x - 29, point.y + 23, point.x + 29, point.y + 23);
    }

    const rack = gridToWorld(laneId, LANCE_RACK_POSITION);
    const lanceX = rack.x + (laneId === "A" ? 32 : -32);
    this.staticLayer.fillStyle(COLORS.whiteGold, 0.96);
    this.staticLayer.fillRoundedRect(lanceX - 34, rack.y + 8, 68, 69, 12);
    this.staticLayer.lineStyle(4, laneColor, 0.86);
    this.staticLayer.strokeRoundedRect(lanceX - 34, rack.y + 8, 68, 69, 12);
  }

  private drawCoolingFixtures(laneId: LaneId): void {
    const reservoir = gridToWorld(laneId, RESERVOIR_POSITION);
    const pump = gridToWorld(laneId, PUMP_POSITION);
    const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;

    this.staticLayer.fillStyle(COLORS.whiteGold, 0.96);
    this.staticLayer.fillRoundedRect(reservoir.x - 38, reservoir.y - 35, 76, 70, 18);
    this.staticLayer.lineStyle(4, laneColor, 0.82);
    this.staticLayer.strokeRoundedRect(reservoir.x - 38, reservoir.y - 35, 76, 70, 18);
    this.staticLayer.fillStyle(COLORS.cyan, 0.25);
    this.staticLayer.fillCircle(reservoir.x, reservoir.y, 25);
    this.staticLayer.lineStyle(4, COLORS.cyan, 0.86);
    this.staticLayer.strokeCircle(reservoir.x, reservoir.y, 25);
    this.staticLayer.lineStyle(2, COLORS.frost, 0.8);
    this.staticLayer.strokeCircle(reservoir.x, reservoir.y, 14);

    this.staticLayer.fillStyle(COLORS.whiteGold, 0.96);
    this.staticLayer.fillRoundedRect(pump.x - 37, pump.y - 33, 74, 66, 13);
    this.staticLayer.lineStyle(4, laneColor, 0.82);
    this.staticLayer.strokeRoundedRect(pump.x - 37, pump.y - 33, 74, 66, 13);
    this.staticLayer.fillStyle(COLORS.void, 0.88);
    this.staticLayer.fillCircle(pump.x, pump.y, 19);
    this.staticLayer.lineStyle(4, COLORS.cyan, 0.82);
    this.staticLayer.strokeCircle(pump.x, pump.y, 19);
    for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
      this.staticLayer.lineBetween(
        pump.x + Math.cos(angle) * 5,
        pump.y + Math.sin(angle) * 5,
        pump.x + Math.cos(angle) * 15,
        pump.y + Math.sin(angle) * 15,
      );
    }
  }

  private drawSafeStops(laneId: LaneId): void {
    for (const localX of [0, 4]) {
      const point = gridToWorld(laneId, { x: localX, y: 0 });
      const side = localX === 0 ? (laneId === "A" ? -1 : 1) : laneId === "A" ? 1 : -1;
      const railX = point.x + side * 48;
      this.staticLayer.fillStyle(laneId === "A" ? COLORS.laneA : COLORS.laneB, 0.9);
      this.staticLayer.fillRoundedRect(railX - 7, point.y - 42, 14, 84, 5);
      this.staticLayer.lineStyle(2, COLORS.whiteGold, 0.85);
      for (let y = point.y - 33; y <= point.y + 27; y += 15) {
        this.staticLayer.lineBetween(railX - 5, y, railX + 5, y + 10);
      }
    }
  }

  private drawRiskAddresses(state: GameState, laneId: LaneId): void {
    const protectedLane = state.level.jointProfile === "protected" && laneId === "A";
    if (state.level.features.interactionRisk) {
      for (const position of [PULSE_POSITION, COUPLE_POSITION, READOUT_POSITION]) {
        const point = gridToWorld(laneId, position);
        const color = protectedLane ? COLORS.accepted : COLORS.hotGold;
        this.staticLayer.fillStyle(color, protectedLane ? 0.08 : 0.16);
        this.staticLayer.fillRoundedRect(point.x - 44, point.y - 37, 88, 74, 10);
        this.staticLayer.lineStyle(protectedLane ? 3 : 5, color, protectedLane ? 0.62 : 0.92);
        for (const [cornerX, cornerY, directionX, directionY] of [
          [-40, -33, 1, 1],
          [40, -33, -1, 1],
          [-40, 33, 1, -1],
          [40, 33, -1, -1],
        ] as const) {
          this.staticLayer.lineBetween(point.x + cornerX, point.y + cornerY, point.x + cornerX + directionX * 15, point.y + cornerY);
          this.staticLayer.lineBetween(point.x + cornerX, point.y + cornerY, point.x + cornerX, point.y + cornerY + directionY * 15);
        }
        if (protectedLane) {
          this.drawProtectedAddressGlyph(point.x, point.y);
        } else {
          this.staticLayer.lineStyle(3, COLORS.gold, 0.82);
          this.staticLayer.strokeCircle(point.x, point.y, 10);
          this.staticLayer.lineBetween(point.x - 5, point.y - 5, point.x + 5, point.y + 5);
          this.staticLayer.lineBetween(point.x + 5, point.y - 5, point.x - 5, point.y + 5);
        }
      }
    }
    if (state.level.features.movementRisk) {
      const point = gridToWorld(laneId, MOVEMENT_RISK_POSITION);
      const color = protectedLane ? COLORS.accepted : COLORS.cyan;
      this.staticLayer.fillStyle(color, protectedLane ? 0.08 : 0.17);
      this.staticLayer.fillRoundedRect(point.x - 45, point.y - 38, 90, 76, 9);
      this.staticLayer.lineStyle(protectedLane ? 3 : 5, color, protectedLane ? 0.62 : 0.9);
      this.staticLayer.strokeRoundedRect(point.x - 45, point.y - 38, 90, 76, 9);
      if (protectedLane) {
        this.drawProtectedAddressGlyph(point.x, point.y);
      } else {
        for (let offset = -22; offset <= 22; offset += 22) {
          this.staticLayer.lineStyle(3, COLORS.frost, 0.72);
          this.staticLayer.beginPath();
          this.staticLayer.moveTo(point.x + offset - 9, point.y + 8);
          this.staticLayer.lineTo(point.x + offset, point.y - 8);
          this.staticLayer.lineTo(point.x + offset + 9, point.y + 8);
          this.staticLayer.strokePath();
        }
      }
    }
  }

  private drawProtectedAddressGlyph(x: number, y: number): void {
    this.staticLayer.lineStyle(3, COLORS.frost, 0.86);
    this.staticLayer.beginPath();
    this.staticLayer.moveTo(x, y - 15);
    this.staticLayer.lineTo(x + 13, y - 9);
    this.staticLayer.lineTo(x + 10, y + 8);
    this.staticLayer.lineTo(x, y + 16);
    this.staticLayer.lineTo(x - 10, y + 8);
    this.staticLayer.lineTo(x - 13, y - 9);
    this.staticLayer.closePath();
    this.staticLayer.strokePath();
    this.staticLayer.lineBetween(x - 6, y, x - 1, y + 6);
    this.staticLayer.lineBetween(x - 1, y + 6, x + 8, y - 6);
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
        .setFlipX(
          laneId === "A"
            ? actorState.facing === "out"
            : actorState.facing !== "out",
        )
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
    this.cameras.main.setZoom(
      heatRatio > 0.86 && state.phase === "running"
        ? 1 + Math.sin(state.simTimeMs / 120) * 0.0012
        : 1,
    );

    this.syncStationText(state);
    this.syncSupplySprites(state);
    this.drawDynamicState(state);
  }

  private syncStationText(state: GameState): void {
    const activeStation = STAGE_STATION_INDEX[state.currentJob.stage];
    for (const laneId of LANE_IDS) {
      for (let index = 0; index < this.stationTexts[laneId].length; index += 1) {
        const active = index === activeStation;
        this.stationTexts[laneId][index]
          .setText(STATIONS[index].label)
          .setColor(active ? "#ffffff" : "#f7e8c7")
          .setAlpha(laneId === "B" && !state.laneBRevealed ? 0 : active ? 1 : 0.82)
          .setScale(active ? 1.07 : 1);
        this.stationProps[laneId][index]
          .setAlpha(laneId === "B" && !state.laneBRevealed ? 0 : active ? 1 : 0.9)
          .setScale(active ? 0.45 : 0.42);
      }
    }
  }

  private syncSupplySprites(state: GameState): void {
    const pulse = 0.5 + (Math.sin(state.simTimeMs / 150) + 1) * 0.5;
    for (const laneId of LANE_IDS) {
      const visible = laneId !== "B" || state.laneBRevealed;
      for (const pulseKind of ["H", "X", "P"] as const) {
        const cue = this.pulseSupplyCue(state, laneId, pulseKind);
        const sprite = this.pulseSupplySprites[laneId][pulseKind];
        sprite
          .setVisible(visible && cue !== "empty")
          .setAlpha(cue === "active" ? 0.9 + pulse * 0.1 : 0.16)
          .setDisplaySize(
            cue === "active" ? 64 + pulse * 5 : 52,
            cue === "active" ? 64 + pulse * 5 : 52,
          );
        if (cue === "active") sprite.clearTint();
        else sprite.setTint(0x706a5f);
      }
      const auxKind = this.auxSupplyKind(state, laneId);
      const auxCue = this.auxSupplyCue(state, laneId, auxKind);
      const auxSprite = this.auxSupplySprites[laneId];
      auxSprite
        .setVisible(visible && auxCue !== "empty")
        .setTexture(auxKind === null ? ITEM_TEXTURES["coupling-half"] : ITEM_TEXTURES[auxKind])
        .setAlpha(auxCue === "active" ? 0.9 + pulse * 0.1 : 0.12)
        .setDisplaySize(
          auxCue === "active" ? 64 + pulse * 5 : 52,
          auxCue === "active" ? 64 + pulse * 5 : 52,
        );
      if (auxCue === "active") auxSprite.clearTint();
      else auxSprite.setTint(0x706a5f);
    }
  }

  private pulseSupplyCue(
    state: GameState,
    laneId: LaneId,
    pulse: PulseKind,
  ): SupplyCueState {
    const replacement = state.lanes[laneId].replacementKind;
    const replacementPulse: PulseKind | null =
      replacement === "pulse-H"
        ? "H"
        : replacement === "pulse-X"
          ? "X"
          : replacement === "pulse-P"
            ? "P"
            : null;
    const required = replacementPulse ?? (
      state.currentJob.stage === "load"
        ? state.currentJob.definition.pulses[laneId][state.lanes[laneId].job.loadedPulses.length]
        : null
    );
    if (required !== pulse) return "inactive";
    return this.hasPendingSupplyItem(
      state,
      laneId,
      `pulse-${pulse}`,
      state.currentJob.definition.id,
    )
      ? "empty"
      : "active";
  }

  private auxSupplyCue(
    state: GameState,
    laneId: LaneId,
    kind: "coupling-half" | "empty-canister" | "coolant-cell" | null,
  ): SupplyCueState {
    if (kind === null) return "inactive";
    return this.hasPendingSupplyItem(
      state,
      laneId,
      kind,
      kind === "coolant-cell" ? null : state.currentJob.definition.id,
    )
      ? "empty"
      : "active";
  }

  private hasPendingSupplyItem(
    state: GameState,
    laneId: LaneId,
    kind: ItemKind,
    jobId: string | null,
  ): boolean {
    return Object.values(state.items).some(
      (item) =>
        item.lane === laneId &&
        item.kind === kind &&
        item.jobId === jobId &&
        item.location.kind !== "discarded" &&
        item.location.kind !== "installed",
    );
  }

  private auxSupplyKind(
    state: GameState,
    laneId: LaneId,
  ): "coupling-half" | "empty-canister" | "coolant-cell" | null {
    const replacement = state.lanes[laneId].replacementKind;
    if (
      replacement === "coupling-half" ||
      replacement === "empty-canister" ||
      replacement === "coolant-cell"
    ) {
      return replacement;
    }
    if (state.currentJob.stage === "couple-install" && !state.lanes[laneId].job.couplingInstalled) {
      return "coupling-half";
    }
    if (
      state.currentJob.stage === "canister" &&
      laneId === state.currentJob.definition.courierLane &&
      !state.currentJob.canisterAttached
    ) {
      return "empty-canister";
    }
    if (state.cooling.reservoir[laneId] < 65) return "coolant-cell";
    return null;
  }

  private drawDynamicState(state: GameState): void {
    this.stateLayer.clear();
    this.drawSupplyCues(state);
    this.drawStageHighlight(state);
    for (const laneId of LANE_IDS) {
      if (laneId === "B" && !state.laneBRevealed) continue;
      this.drawLaneJobState(state, laneId);
      this.drawCoolingState(state, laneId);
    }
    this.drawItems(state);
    this.syncLanceSprites(state);
    this.drawProcessorState(state);
    this.drawThermalAlarm(state);
  }

  private drawSupplyCues(state: GameState): void {
    for (const laneId of LANE_IDS) {
      if (laneId === "B" && !state.laneBRevealed) continue;
      for (const pulse of ["H", "X", "P"] as const) {
        const cue = this.pulseSupplyCue(state, laneId, pulse);
        if (cue === "inactive") continue;
        const point = supplyToWorld(laneId, SUPPLY_POSITIONS[pulse].y);
        this.drawSupplyCueMarker(state, laneId, point.x, point.y, cue);
      }
      const auxKind = this.auxSupplyKind(state, laneId);
      const auxCue = this.auxSupplyCue(state, laneId, auxKind);
      if (auxCue !== "inactive") {
        const point = supplyToWorld(laneId, SUPPLY_POSITIONS.AUX.y);
        this.drawSupplyCueMarker(state, laneId, point.x, point.y, auxCue);
      }
    }
  }

  private drawSupplyCueMarker(
    state: GameState,
    laneId: LaneId,
    x: number,
    y: number,
    cue: Exclude<SupplyCueState, "inactive">,
  ): void {
    if (cue === "empty") {
      this.stateLayer.fillStyle(COLORS.void, 0.72);
      this.stateLayer.fillCircle(x, y, 25);
      this.stateLayer.lineStyle(3, COLORS.whiteGold, 0.46);
      this.stateLayer.strokeCircle(x, y, 25);
      for (const offset of [-12, 0, 12]) {
        this.stateLayer.lineBetween(x + offset - 7, y + 9, x + offset + 7, y - 9);
      }
      return;
    }

    const pulse = 0.62 + (Math.sin(state.simTimeMs / 145) + 1) * 0.17;
    const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;
    this.stateLayer.fillStyle(COLORS.whiteGold, 0.12 + pulse * 0.08);
    this.stateLayer.fillRoundedRect(x - 44, y - 36, 88, 72, 13);
    this.stateLayer.lineStyle(6, COLORS.whiteGold, pulse);
    this.stateLayer.strokeRoundedRect(x - 44, y - 36, 88, 72, 13);
    this.stateLayer.lineStyle(3, laneColor, 0.92);
    this.stateLayer.strokeRoundedRect(x - 38, y - 30, 76, 60, 10);
    this.stateLayer.fillStyle(COLORS.whiteGold, pulse);
    this.stateLayer.fillTriangle(x - 13, y - 51, x + 13, y - 51, x, y - 38);
  }

  private drawStageHighlight(state: GameState): void {
    const station = STAGE_STATION_INDEX[state.currentJob.stage];
    const pulse = 0.65 + Math.sin(state.simTimeMs / 180) * 0.24;
    for (const laneId of LANE_IDS) {
      if (laneId === "B" && !state.laneBRevealed) continue;
      const counter = counterToWorld(laneId, station);
      const floor = gridToWorld(laneId, { x: station, y: 0 });
      const laneColor = laneId === "A" ? COLORS.laneA : COLORS.laneB;
      this.stateLayer.lineStyle(5, COLORS.whiteGold, pulse);
      this.stateLayer.strokeRoundedRect(counter.x - 47, counter.y - 112, 94, 80, 13);
      this.stateLayer.lineStyle(4, laneColor, pulse * 0.9);
      this.stateLayer.strokeRoundedRect(floor.x - 49, floor.y - 42, 98, 84, 10);
    }
  }

  private drawLaneJobState(state: GameState, laneId: LaneId): void {
    const lane = state.lanes[laneId];
    const prep = counterToWorld(laneId, PREP_POSITION.x);
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
      this.drawProgressArc(prep.x, prep.y - 72, 34, progress, lane.job.prepared ? COLORS.accepted : COLORS.cyan);
    }

    if (lane.job.couplingArmedAtMs !== null) {
      this.stateLayer.lineStyle(4, COLORS.accepted, 0.9);
      this.stateLayer.strokeCircle(couple.x, couple.y - 72, 25);
    }
    if (lane.job.resetArmed) {
      this.stateLayer.lineStyle(5, COLORS.cyan, 0.92);
      this.stateLayer.strokeCircle(readout.x, readout.y - 72, 26);
      this.stateLayer.lineBetween(readout.x - 11, readout.y - 72, readout.x, readout.y - 62);
      this.stateLayer.lineBetween(readout.x, readout.y - 62, readout.x + 15, readout.y - 81);
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
    for (const [itemId, sprite] of this.itemSprites) {
      const item = state.items[itemId];
      if (item === undefined || item.location.kind === "discarded") {
        sprite.destroy();
        this.itemSprites.delete(itemId);
      } else {
        sprite.setVisible(false);
      }
    }

    const installedOffsets = new Map<string, number>();
    for (const item of Object.values(state.items)) {
      if (item.location.kind === "discarded") continue;
      if (item.kind === "cryo-lance") continue;
      let x: number;
      let y: number;
      let size: number;

      if (item.location.kind === "held") {
        if (item.location.lane === "B" && !state.laneBRevealed) continue;
        const actor = this.actors[item.location.lane];
        x = actor.x + (item.location.lane === "A" ? 35 : -35);
        y = actor.y - 71;
        size = 56;
      } else if (item.location.kind === "dropped") {
        if (item.location.lane === "B" && !state.laneBRevealed) continue;
        const point = gridToWorld(item.location.lane, item.location.position);
        x = point.x;
        y = point.y - 18;
        size = 60 * (point.scale / 0.37);
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
        y = point.y - 72;
        size = item.kind.startsWith("pulse-") ? 42 : 48;
      }

      const texture = ITEM_TEXTURES[item.kind as Exclude<ItemKind, "cryo-lance">];
      const sprite = this.itemSprites.get(item.id) ?? this.createItemSprite(item.id, texture);
      sprite
        .setVisible(true)
        .setTexture(texture)
        .setPosition(x, y)
        .setDisplaySize(size, size)
        .setFlipX(item.lane === "B")
        .setDepth(101 + y / 30);
      if (item.charge !== null) {
        const charge = Phaser.Math.Clamp(item.charge / 100, 0, 1);
        this.stateLayer.fillStyle(COLORS.void, 0.88);
        this.stateLayer.fillRoundedRect(x - 24, y + size * 0.42, 48, 6, 3);
        this.stateLayer.fillStyle(COLORS.cyan, 0.94);
        this.stateLayer.fillRoundedRect(x - 24, y + size * 0.42, 48 * charge, 6, 3);
      }
      if (item.location.kind === "dropped" && item.expiresAtMs !== null) {
        const lifetime = Math.max(1, state.level.dropLifetimeMs);
        const remaining = Phaser.Math.Clamp((item.expiresAtMs - state.simTimeMs) / lifetime, 0, 1);
        this.drawProgressArc(x, y, 34, remaining, remaining < 0.3 ? COLORS.alarm : COLORS.whiteGold);
      }
    }
  }

  private createItemSprite(itemId: string, texture: string): Phaser.GameObjects.Image {
    const sprite = this.add.image(0, 0, texture).setOrigin(0.5).setVisible(false);
    this.itemSprites.set(itemId, sprite);
    return sprite;
  }

  private syncLanceSprites(state: GameState): void {
    for (const laneId of LANE_IDS) {
      const obscured = laneId === "B" && !state.laneBRevealed;
      const activeLance = Object.values(state.items).find(
        (item) => item.lane === laneId && item.kind === "cryo-lance" && item.location.kind !== "discarded",
      );
      const rackSprite = this.lanceRackSprites[laneId];
      const itemSprite = this.lanceItemSprites[laneId];
      rackSprite.setVisible(!obscured && activeLance === undefined);

      if (obscured || activeLance === undefined) {
        itemSprite.setVisible(false);
        continue;
      }

      let x: number;
      let y: number;
      let size: number;
      let flipX: boolean;
      if (activeLance.location.kind === "held") {
        const actorState = state.lanes[laneId].actor;
        const actorImage = this.actors[laneId];
        x = actorImage.x + (laneId === "A" ? 38 : -38);
        y = actorImage.y - 72;
        size = 76;
        flipX = laneId === "A" ? actorState.facing !== "out" : actorState.facing === "out";
      } else if (activeLance.location.kind === "dropped") {
        const point = gridToWorld(laneId, activeLance.location.position);
        x = point.x;
        y = point.y - 18;
        size = 74 * (point.scale / 0.37);
        flipX = laneId === "A";
      } else {
        itemSprite.setVisible(false);
        continue;
      }

      itemSprite
        .setVisible(true)
        .setPosition(x, y)
        .setDisplaySize(size, size)
        .setFlipX(flipX)
        .setDepth(101 + y / 30);

      if (activeLance.charge !== null) {
        const charge = Phaser.Math.Clamp(activeLance.charge / 100, 0, 1);
        this.stateLayer.fillStyle(COLORS.void, 0.88);
        this.stateLayer.fillRoundedRect(x - 30, y + size * 0.44, 60, 7, 3);
        this.stateLayer.fillStyle(COLORS.cyan, 0.95);
        this.stateLayer.fillRoundedRect(x - 30, y + size * 0.44, 60 * charge, 7, 3);
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
      this.stateLayer.lineBetween(646, 437, 765, 437);
      this.stateLayer.lineBetween(835, 437, 954, 437);
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

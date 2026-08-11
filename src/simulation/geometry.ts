import type { Direction, GridPosition, LaneId, TriggerType } from "./types";

export const GRID_MIN_X = 0;
export const GRID_MAX_X = 4;
export const GRID_MIN_Y = 0;
export const GRID_MAX_Y = 3;

export const START_POSITION: GridPosition = { x: 4, y: 0 };
export const SUBMIT_POSITION: GridPosition = { x: 0, y: 0 };
export const PREP_POSITION: GridPosition = { x: 1, y: 0 };
export const PULSE_POSITION: GridPosition = { x: 2, y: 0 };
export const COUPLE_POSITION: GridPosition = { x: 3, y: 0 };
export const READOUT_POSITION: GridPosition = { x: 4, y: 0 };
export const PULSE_BUFFER_POSITION: GridPosition = { x: 2, y: 1 };
export const COUPLE_BUFFER_POSITION: GridPosition = { x: 3, y: 1 };
export const READOUT_BUFFER_POSITION: GridPosition = { x: 4, y: 1 };
export const MOVEMENT_RISK_POSITION: GridPosition = { x: 2, y: 2 };
export const RESERVOIR_POSITION: GridPosition = { x: 4, y: 3 };
export const PUMP_POSITION: GridPosition = { x: 3, y: 3 };
export const LANCE_RACK_POSITION: GridPosition = { x: 1, y: 3 };

export const SUPPLY_POSITIONS = {
  H: { x: 0, y: 0 },
  X: { x: 0, y: 1 },
  P: { x: 0, y: 2 },
  AUX: { x: 0, y: 3 },
} as const satisfies Record<string, GridPosition>;

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

export function moveTarget(position: GridPosition, direction: Direction): GridPosition {
  const delta: Record<Direction, GridPosition> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    in: { x: 1, y: 0 },
    out: { x: -1, y: 0 },
  };
  return {
    x: position.x + delta[direction].x,
    y: position.y + delta[direction].y,
  };
}

export function isBlocked(position: GridPosition): boolean {
  return (
    position.x < GRID_MIN_X ||
    position.x > GRID_MAX_X ||
    position.y < GRID_MIN_Y ||
    position.y > GRID_MAX_Y
  );
}

export function riskAddress(levelId: number, fixture: string, trigger: TriggerType): string {
  return `L${levelId}/${fixture}/${trigger}`;
}

export function movementRiskFixture(position: GridPosition): string {
  return `TRANSFER@${position.x},${position.y}`;
}

export function movementRiskAddress(levelId: number, position: GridPosition): string {
  return riskAddress(levelId, movementRiskFixture(position), "movement");
}

export function movementRiskPositionFromAddress(address: string | undefined): GridPosition | null {
  if (!address) return null;
  const match = address.match(/\/TRANSFER@(\d+),(\d+)\/movement$/);
  if (!match) return address.includes("/TRANSFER/movement") ? { ...MOVEMENT_RISK_POSITION } : null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function riskFixtureLabel(address: string | undefined): string {
  const fixture = address?.split("/")[1] ?? "RISK";
  return fixture.startsWith("TRANSFER@") ? "TRANSFER" : fixture;
}

export function bufferForFixture(fixture: "pulse" | "couple" | "readout"): GridPosition {
  if (fixture === "pulse") return { ...PULSE_BUFFER_POSITION };
  if (fixture === "couple") return { ...COUPLE_BUFFER_POSITION };
  return { ...READOUT_BUFFER_POSITION };
}

export interface WorldPoint {
  x: number;
  y: number;
  scale: number;
}

export function gridToWorld(lane: LaneId, position: GridPosition): WorldPoint {
  const outwardX = lane === "A" ? 160 : 1_440;
  const direction = lane === "A" ? 1 : -1;
  const x = outwardX + direction * position.x * 108;
  const y = 438 + position.y * 108;
  return {
    x,
    y,
    scale: 0.37 + position.y * 0.018,
  };
}

export function counterToWorld(lane: LaneId, localX: number): WorldPoint {
  const floor = gridToWorld(lane, { x: localX, y: 0 });
  return { x: floor.x, y: 342, scale: 1 };
}

export function supplyToWorld(lane: LaneId, localY: number): WorldPoint {
  const floor = gridToWorld(lane, { x: 0, y: localY });
  const x = lane === "A" ? 92 : 1_508;
  return { x, y: floor.y - 12, scale: 1 };
}

export function laneWorldDelta(lane: LaneId, direction: Direction): GridPosition {
  if (direction === "in") return { x: lane === "A" ? 1 : -1, y: 0 };
  if (direction === "out") return { x: lane === "A" ? -1 : 1, y: 0 };
  return { x: 0, y: direction === "up" ? -1 : 1 };
}

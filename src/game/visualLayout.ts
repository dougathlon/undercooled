import type { Direction, GridPosition, LaneId } from "../simulation/types";

export const WORLD_WIDTH = 1_600;
export const WORLD_HEIGHT = 900;
export const GRID_COLUMNS = 5;
export const GRID_ROWS = 4;
export const GRID_PITCH = 108;

const GRID_OUTER_X: Record<LaneId, number> = {
  A: 214,
  B: 1_386,
};

const GRID_DIRECTION: Record<LaneId, 1 | -1> = {
  A: 1,
  B: -1,
};

export interface WorldPoint {
  x: number;
  y: number;
  scale: number;
}

export function gridToWorld(lane: LaneId, position: GridPosition): WorldPoint {
  return {
    x: GRID_OUTER_X[lane] + GRID_DIRECTION[lane] * position.x * GRID_PITCH,
    y: 438 + position.y * GRID_PITCH,
    scale: 0.37 + position.y * 0.018,
  };
}

export function counterToWorld(lane: LaneId, localX: number): WorldPoint {
  const floor = gridToWorld(lane, { x: localX, y: 0 });
  return { x: floor.x, y: 304, scale: 1 };
}

export function supplyToWorld(lane: LaneId, localY: number): WorldPoint {
  const floor = gridToWorld(lane, { x: 0, y: localY });
  return { x: lane === "A" ? 96 : 1_504, y: floor.y - 12, scale: 1 };
}

export function laneWorldDelta(lane: LaneId, direction: Direction): GridPosition {
  if (direction === "in") return { x: lane === "A" ? 1 : -1, y: 0 };
  if (direction === "out") return { x: lane === "A" ? -1 : 1, y: 0 };
  return { x: 0, y: direction === "up" ? -1 : 1 };
}

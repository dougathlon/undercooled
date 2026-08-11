import { describe, expect, it } from "vitest";
import {
  COUPLE_BUFFER_POSITION,
  LANCE_RACK_POSITION,
  PULSE_BUFFER_POSITION,
  READOUT_BUFFER_POSITION,
  SUPPLY_POSITIONS,
} from "../../src/simulation/geometry";
import {
  BUFFER_STATION_INDICES,
  STAGE_STATION_INDEX,
  STATIONS,
} from "../../src/game/presentationContract";
import {
  GRID_COLUMNS,
  GRID_ROWS,
  gridToWorld,
} from "../../src/game/visualLayout";

describe("visual layout contract", () => {
  it("projects exactly two mirrored five-by-four service lanes", () => {
    for (const lane of ["A", "B"] as const) {
      const cells = Array.from({ length: GRID_ROWS }, (_, y) =>
        Array.from({ length: GRID_COLUMNS }, (_, x) => gridToWorld(lane, { x, y })),
      ).flat();
      expect(cells).toHaveLength(20);
      expect(new Set(cells.map(({ x, y }) => `${x}/${y}`)).size).toBe(20);
    }

    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      const a = gridToWorld("A", { x, y: 0 });
      const b = gridToWorld("B", { x, y: 0 });
      expect(a.x + b.x).toBe(1_600);
      expect(a.y).toBe(b.y);
    }
  });

  it("keeps five semantically distinct stations in local workflow order", () => {
    expect(STATIONS.map(({ label }) => label)).toEqual([
      "SUBMIT",
      "PREP",
      "PULSE",
      "COUPLE",
      "READOUT",
    ]);
    expect(new Set(STATIONS.map(({ kind }) => kind)).size).toBe(5);
    expect(STATIONS.map(({ localX }) => localX)).toEqual([0, 1, 2, 3, 4]);
    expect(BUFFER_STATION_INDICES).toEqual([2, 3, 4]);
  });

  it("maps every job stage to its visible station", () => {
    expect(STAGE_STATION_INDEX).toEqual({
      accept: 4,
      prepare: 1,
      load: 2,
      "couple-install": 3,
      "couple-arm": 3,
      canister: 4,
      run: 4,
      submission: 0,
      reset: 4,
    });
  });

  it("retains only three reserved buffers and four outer supply addresses", () => {
    expect([
      PULSE_BUFFER_POSITION,
      COUPLE_BUFFER_POSITION,
      READOUT_BUFFER_POSITION,
    ]).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]);
    expect(SUPPLY_POSITIONS).toEqual({
      H: { x: 0, y: 0 },
      X: { x: 0, y: 1 },
      P: { x: 0, y: 2 },
      AUX: { x: 0, y: 3 },
    });
    expect(LANCE_RACK_POSITION).toEqual({ x: 1, y: 3 });
    expect(LANCE_RACK_POSITION).not.toEqual(SUPPLY_POSITIONS.AUX);
  });
});

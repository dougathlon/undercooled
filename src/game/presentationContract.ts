import type { JobStage } from "../simulation/types";

export type StationKind = "submit" | "prep" | "pulse" | "couple" | "readout";

export interface StationDescriptor {
  readonly label: string;
  readonly kind: StationKind;
  readonly localX: number;
}

export const STATIONS = [
  { label: "SUBMIT", kind: "submit", localX: 0 },
  { label: "PREP", kind: "prep", localX: 1 },
  { label: "PULSE", kind: "pulse", localX: 2 },
  { label: "COUPLE", kind: "couple", localX: 3 },
  { label: "READOUT", kind: "readout", localX: 4 },
] as const satisfies readonly StationDescriptor[];

export const STAGE_STATION_INDEX: Readonly<Record<JobStage, number>> = {
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

export const BUFFER_STATION_INDICES = [2, 3, 4] as const;

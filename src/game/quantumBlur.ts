import type { GameState } from "../simulation/types";

export interface QuantumBlurPresentation {
  active: boolean;
  heatRatio: number;
  blurPixels: number;
  saturation: number;
}

export function quantumBlurPresentation(state: GameState): QuantumBlurPresentation {
  const heatRatio = Math.max(
    0,
    Math.min(1, state.cooling.load / Math.max(1, state.level.heat.maximum)),
  );
  const couplingArmed = state.events.some((event) => event.type === "coupling-armed");
  const lanceInService = Object.values(state.items).some(
    (item) => item.kind === "cryo-lance" && item.location.kind !== "discarded",
  );
  const coolingPending = state.cooling.hotspots.some((hotspot) => hotspot.active);
  const active =
    state.level.demo.lesson === "joint-risk" &&
    couplingArmed &&
    (coolingPending || lanceInService);

  return {
    active,
    heatRatio,
    blurPixels: active ? 0.35 + heatRatio * 4.25 : 0,
    saturation: active ? 1 + heatRatio * 0.16 : 1,
  };
}

import { describe, expect, it } from "vitest";

import { quantumBlurPresentation } from "../../src/game/quantumBlur";
import { createGameState, debugSetHeat } from "../../src/simulation/simulation";

function armCouplingPresentation(levelId: number) {
  const state = createGameState(levelId);
  state.events.push({
    id: (state.events.at(-1)?.id ?? 0) + 1,
    atMs: state.simTimeMs,
    type: "coupling-armed",
    message: "Coupling armed for presentation test.",
  });
  return state;
}

describe("simulated Quantum Blur thermal view", () => {
  it("activates only in the joint-risk lance section and strengthens with heat", () => {
    const state = armCouplingPresentation(4);
    debugSetHeat(state, 82);
    const hot = quantumBlurPresentation(state);
    debugSetHeat(state, 24);
    const cool = quantumBlurPresentation(state);

    expect(hot.active).toBe(true);
    expect(hot.blurPixels).toBeGreaterThan(cool.blurPixels);
    expect(cool.blurPixels).toBeGreaterThan(0);

    for (const hotspot of state.cooling.hotspots) hotspot.active = false;
    expect(quantumBlurPresentation(state).active).toBe(false);
  });

  it("never presents ordinary levels as Quantum Blur", () => {
    const state = armCouplingPresentation(3);
    debugSetHeat(state, 100);
    expect(quantumBlurPresentation(state)).toMatchObject({ active: false, blurPixels: 0 });
  });
});

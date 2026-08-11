import { expect, test as base, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

interface BrowserState {
  phase: string;
  levelId: number;
  stage: string;
  laneBRevealed: boolean;
  recoveries: number;
  riskCount: number;
  coolingServices: number;
  validShots: number;
  acceptedJobs: number;
  resetCount: number;
  fumbleCount: number;
  held: { A: string | null; B: string | null };
  positions: { A: { x: number; y: number }; B: { x: number; y: number } };
}

const applicationOrigin = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173/undercooled/",
).origin;
const SCREENSHOT_DIRECTORY = resolve(process.cwd(), "test-results/screenshots");

const test = base.extend<RuntimeFixtures>({
  runtimeErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) => {
      errors.push(`request: ${request.url()} (${request.failure()?.errorText ?? "failed"})`);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === applicationOrigin && response.status() >= 400) {
        errors.push(`response: ${response.status()} ${response.url()}`);
      }
    });

    await use(errors);
    expect(errors, "The production build emitted runtime, console, request, or asset errors.").toEqual([]);
  },
});

async function boot(page: Page): Promise<void> {
  await page.goto("./", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => Boolean((window as typeof window & { __UNDERCOOLED__?: unknown }).__UNDERCOOLED__),
  );
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    return canvas instanceof HTMLCanvasElement && canvas.width === 1_600 && canvas.height === 900;
  });
}

async function capture(page: Page, filename: string): Promise<void> {
  await mkdir(SCREENSHOT_DIRECTORY, { recursive: true });
  await page.screenshot({
    path: resolve(SCREENSHOT_DIRECTORY, filename),
    fullPage: true,
    animations: "disabled",
  });
}

async function browserState(page: Page): Promise<BrowserState> {
  return page.evaluate(() => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { state: () => unknown };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    const state = api.state() as {
      phase: string;
      level: { id: number };
      currentJob: { stage: string };
      laneBRevealed: boolean;
      score: { recoveries: number; validShots: number; acceptedJobs: number };
      manifest: { riskStreams: Record<string, { cursor: number }> };
      cooling: { completedServices: number };
      lanes: Record<"A" | "B", { actor: { position: { x: number; y: number }; heldItemId: string | null } }>;
      items: Record<string, { kind: string }>;
      events: Array<{ type: string }>;
    };
    return {
      phase: state.phase,
      levelId: state.level.id,
      stage: state.currentJob.stage,
      laneBRevealed: state.laneBRevealed,
      recoveries: state.score.recoveries,
      riskCount: Object.values(state.manifest.riskStreams).reduce((sum, stream) => sum + stream.cursor, 0),
      coolingServices: state.cooling.completedServices,
      validShots: state.score.validShots,
      acceptedJobs: state.score.acceptedJobs,
      resetCount: state.events.filter((event) => event.type === "processor-reset").length,
      fumbleCount: state.events.filter((event) => event.type === "fumble").length,
      held: {
        A: state.lanes.A.actor.heldItemId ? state.items[state.lanes.A.actor.heldItemId]?.kind ?? null : null,
        B: state.lanes.B.actor.heldItemId ? state.items[state.lanes.B.actor.heldItemId]?.kind ?? null : null,
      },
      positions: {
        A: state.lanes.A.actor.position,
        B: state.lanes.B.actor.position,
      },
    };
  });
}

async function simulationTime(page: Page): Promise<number> {
  return page.evaluate(() => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { state: () => { simTimeMs: number } };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    return api.state().simTimeMs;
  });
}

async function startLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate((id) => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { startLevel: (selectedLevel: number) => unknown };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    api.startLevel(id);
  }, levelId);
  await expect.poll(() => browserState(page)).toMatchObject({ phase: "running", levelId });
}

async function move(
  page: Page,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  count = 1,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const before = await simulationTime(page);
    await page.keyboard.press(key);
    await expect.poll(async () => {
      const state = await browserState(page);
      return state.phase !== "running" || (await simulationTime(page)) >= before + 160;
    }, { timeout: 8_000 }).toBe(true);
  }
}

async function act(page: Page): Promise<void> {
  await page.keyboard.press("Space");
  await page.waitForTimeout(120);
}

async function holdUntilStage(page: Page, stage: string): Promise<void> {
  await page.keyboard.down("Space");
  try {
    await expect.poll(() => browserState(page), { timeout: 12_000 }).toMatchObject({ stage });
  } finally {
    await page.keyboard.up("Space");
  }
  await page.waitForTimeout(100);
}

async function runMatchedFrontHalf(page: Page): Promise<void> {
  await act(page);
  await move(page, "ArrowLeft", 3);
  await holdUntilStage(page, "load");
  await move(page, "ArrowLeft");
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({ held: { A: "pulse-H", B: "pulse-H" } });
  await move(page, "ArrowRight", 2);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({ stage: "canister" });
}

async function runUntilSubmission(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await act(page);
    if ((await browserState(page)).stage === "submission") break;
  }
  await expect.poll(() => browserState(page)).toMatchObject({ stage: "submission", validShots: 1 });
}

async function finishJobFromPulse(page: Page): Promise<void> {
  await expect(page.locator("[data-ui='headline']")).toContainText("CANISTER");
  await move(page, "ArrowLeft", 2);
  await move(page, "ArrowDown", 3);
  await act(page);
  await move(page, "ArrowUp", 3);
  await move(page, "ArrowRight", 4);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({ stage: "run" });
  await runUntilSubmission(page);
  await act(page);
  await move(page, "ArrowLeft", 4);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({ stage: "reset", acceptedJobs: 1 });
  await move(page, "ArrowRight", 4);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({
    phase: "complete",
    acceptedJobs: 1,
    validShots: 1,
    resetCount: 1,
  });
}

async function finishJobFromAuxWithCanister(page: Page): Promise<void> {
  await act(page);
  await move(page, "ArrowUp", 3);
  await move(page, "ArrowRight", 4);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({ stage: "run" });
  await runUntilSubmission(page);
  await act(page);
  await move(page, "ArrowLeft", 4);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({ stage: "reset", acceptedJobs: 1 });
  await move(page, "ArrowRight", 4);
  await act(page);
  await expect.poll(() => browserState(page)).toMatchObject({
    phase: "complete",
    acceptedJobs: 1,
    validShots: 1,
    resetCount: 1,
  });
}

test.describe("desktop clarity demo", () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test("boots from the Pages subpath with one desktop start action", async ({ page }) => {
    const documentBase = new URL("./", page.url());
    expect(documentBase.pathname).toMatch(/\/$/);
    expect(documentBase.pathname).not.toBe("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByTestId("begin")).toHaveText(/START DEMO/);
    await expect(page.locator("[data-testid^='level-']")).toHaveCount(4);
    await expect(page.locator(".uc-touch, .uc-orientation-gate")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/rotate your phone|touch controls/i);
    await capture(page, "desktop-v5-title.png");

    await page.getByTestId("begin").click();
    await expect.poll(() => browserState(page)).toMatchObject({ phase: "running", levelId: 1 });
    await expect(page.getByTestId("overlay")).toBeHidden();
    await expect(page.locator("[data-ui='headline']")).toHaveText("ACTIVATE THE READOUT");
    await capture(page, "desktop-v5-scene-1-start.png");
  });

  test("scene one teaches a full service cycle without leaking the hidden coworker", async ({ page }) => {
    await page.getByTestId("begin").click();
    await expect(page.locator("[data-ui='circuit-b']")).toContainText("SIGNAL OFFLINE");
    await runMatchedFrontHalf(page);
    await finishJobFromPulse(page);

    await expect.poll(() => browserState(page)).toMatchObject({
      phase: "complete",
      levelId: 1,
      laneBRevealed: false,
    });
    await expect(page.getByTestId("overlay")).toContainText("complete service cycle ran on two channels");
    await expect(page.getByTestId("overlay")).toContainText("ONE COMMAND");
    await expect(page.getByTestId("overlay")).toContainText("MIRRORS H");
    await expect(page.getByTestId("overlay")).toContainText("SUBMITTED + RESET");
    await expect(page.getByTestId("overlay")).not.toContainText("Accepted cycles");
    await capture(page, "desktop-v5-scene-1-complete.png");
  });

  test("scene two reveals matched H/H work and completes the same full cycle", async ({ page }) => {
    await startLevel(page, 2);
    await expect.poll(() => browserState(page)).toMatchObject({ laneBRevealed: true });
    await expect(page.locator("[data-ui='b-marker']")).toHaveText("B");
    await runMatchedFrontHalf(page);
    await finishJobFromPulse(page);

    await expect.poll(() => browserState(page)).toMatchObject({ phase: "complete", levelId: 2 });
    await expect(page.getByTestId("overlay")).toContainText("visibly synchronous work");
    await expect(page.getByTestId("overlay")).toContainText("INSTALLS H");
    await expect(page.getByTestId("overlay")).not.toContainText("INSTALLS X");
    await expect(page.getByTestId("overlay")).toContainText("SUBMITTED + RESET");
    await capture(page, "desktop-v5-scene-2-complete.png");
  });

  test("scene three stages one-sided drops, repeated missed steps, readout recovery, and resynchronization", async ({ page }) => {
    await startLevel(page, 3);
    await act(page);
    await move(page, "ArrowLeft", 3);
    await holdUntilStage(page, "load");
    await move(page, "ArrowLeft");
    await act(page);
    await expect.poll(() => browserState(page)).toMatchObject({ held: { A: "pulse-H", B: "pulse-H" } });
    await move(page, "ArrowRight", 2);
    await expect(page.locator("[data-ui='headline']")).toHaveText("COMMIT AT THE PULSE ADDRESS");
    await expect(page.locator("[data-ui='detail']")).not.toContainText("01");
    await act(page);

    await expect(page.locator("[data-ui='event-message']")).toContainText(/SCRIPTED TEACHING RECORD.*01 AT PULSE.*B FUMBLES/);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RECOVER THE CARTRIDGE");
    await expect(page.locator("[data-ui='command']")).toHaveText("MOVE TO BUFFER");
    await capture(page, "desktop-v5-scene-3-drop.png");

    await move(page, "ArrowDown");
    await act(page);
    await expect.poll(() => browserState(page)).toMatchObject({ recoveries: 1 });
    await expect(page.locator("[data-ui='headline']")).toHaveText("RETRY THE FAILED SIDE");
    await expect(page.locator("[data-ui='lane-a']")).toHaveText("H ALREADY INSTALLED");
    await move(page, "ArrowUp");
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("ENTER THE MARKED SQUARE");
    await move(page, "ArrowDown", 2);
    await expect(page.locator("[data-ui='headline']")).toHaveText("LEAVE THE MARKED SQUARE");
    await expect(page.locator("[data-ui='lane-b']")).toHaveText("OUTCOME HIDDEN");
    await move(page, "ArrowUp");

    await expect.poll(() => browserState(page)).toMatchObject({
      riskCount: 3,
      positions: { A: { x: 2, y: 1 }, B: { x: 2, y: 2 } },
    });
    await expect(page.locator("[data-ui='event-message']")).toContainText(/SIMULATOR FALLBACK.*01 AT TRANSFER.*B MISSES A STEP/);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RESYNCHRONIZE AT THE BARRIER");
    await capture(page, "desktop-v5-scene-3-offset.png");

    await move(page, "ArrowUp", 3);
    await expect.poll(() => browserState(page)).toMatchObject({ phase: "running", levelId: 3, stage: "canister" });
    await finishJobFromPulse(page);
    await expect(page.getByTestId("overlay")).toContainText("SCRIPTED · PULSE 01");
    await expect(page.getByTestId("overlay")).toContainText("SIMULATOR · TRANSFER 00");
    await expect(page.getByTestId("overlay")).toContainText("SCRIPTED · READOUT 01");
    await expect(page.getByTestId("overlay")).toContainText("B SUCCEEDS");
    await expect(page.getByTestId("overlay")).toContainText("SUBMITTED + RESET");
  });

  test("scene four separates repeated joint faults from physical cryo-lance cooling", async ({ page }) => {
    test.setTimeout(120_000);
    await startLevel(page, 4);
    await act(page);
    await move(page, "ArrowLeft", 3);
    await holdUntilStage(page, "load");
    await move(page, "ArrowLeft");
    await act(page);
    await move(page, "ArrowRight", 2);
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RECOVER THE CARTRIDGE");
    await move(page, "ArrowDown");
    await act(page);
    await move(page, "ArrowUp");
    await act(page);
    await expect.poll(() => browserState(page)).toMatchObject({ stage: "couple-install" });
    await move(page, "ArrowLeft", 2);
    await move(page, "ArrowDown", 3);
    await act(page);
    await move(page, "ArrowUp", 3);
    await move(page, "ArrowRight", 3);
    await expect(page.locator("[data-ui='headline']")).toHaveText("COMMIT AT THE COUPLED ADDRESS");
    await expect(page.locator("[data-ui='detail']")).not.toContainText("11");
    await act(page);
    await expect(page.locator("[data-ui='event-message']")).toContainText(/SCRIPTED TEACHING RECORD.*11 AT COUPLE.*A \+ B FUMBLES/);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RECOVER BOTH HALVES");
    await capture(page, "desktop-v5-scene-4-joint-drop.png");

    await move(page, "ArrowDown");
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RETRY BOTH COUPLING HALVES");
    await move(page, "ArrowUp");
    await act(page);
    await expect(page.locator("[data-ui='event-message']")).toContainText(/SCRIPTED TEACHING RECORD.*10 AT COUPLE.*A FUMBLES/);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RECOVER THE COUPLING HALF");
    await move(page, "ArrowDown");
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RETRY THE FAILED COUPLING HALF");
    await expect(page.locator("[data-ui='lane-b']")).toHaveText("PORT ALREADY LOCKED");
    await move(page, "ArrowUp");
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("ARM BOTH PORTS TOGETHER");
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("FETCH THE CRYO LANCES");
    await expect(page.locator("[data-ui='detail']")).toContainText("does not change the cached quantum result");
    await expect(page.locator("[data-ui='heat-panel']")).toBeVisible();
    await expect(page.locator("[data-ui='heat-label']")).toHaveText("QUANTUM BLUR · SIMULATED");
    await expect(page.locator("canvas")).toHaveAttribute("data-quantum-blur", "simulated");
    const hotBlur = await page.locator("canvas").evaluate((canvas) =>
      Number.parseFloat((canvas as HTMLCanvasElement).style.getPropertyValue("--uc-quantum-blur")),
    );
    expect(hotBlur).toBeGreaterThan(2);

    await move(page, "ArrowLeft", 2);
    await move(page, "ArrowDown", 3);
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("RESYNCHRONIZE AT THE BARRIER");
    await move(page, "ArrowDown");
    await act(page);
    await expect(page.locator("[data-ui='headline']")).toHaveText("SPRAY THE GLOWING MANIFOLDS");
    await move(page, "ArrowRight", 3);
    await move(page, "ArrowUp", 2);
    await expect(page.locator("[data-ui='command']")).toHaveText("HOLD ACTION");
    await page.keyboard.down("Space");
    try {
      await expect(page.locator("[data-ui='headline']")).toHaveText("RETURN THE CRYO LANCES", { timeout: 12_000 });
      await capture(page, "desktop-v5-scene-4-cooling.png");
    } finally {
      await page.keyboard.up("Space");
    }
    await move(page, "ArrowDown", 2);
    await move(page, "ArrowLeft", 3);
    await act(page);
    await expect(page.locator("canvas")).toHaveAttribute("data-quantum-blur", "off");
    await expect(page.locator("[data-ui='headline']")).toHaveText("FETCH THE RED CANISTER");
    await move(page, "ArrowLeft");
    await finishJobFromAuxWithCanister(page);
    expect(await browserState(page)).toMatchObject({ coolingServices: expect.any(Number), fumbleCount: 5 });
    expect((await browserState(page)).coolingServices).toBeGreaterThan(0);
    await expect(page.getByTestId("overlay")).toContainText("SCRIPTED · COUPLE 10");
    await expect(page.getByTestId("overlay")).toContainText("SCRIPTED · READOUT 01");
    await expect(page.getByTestId("overlay")).toContainText("SIMULATED · QUANTUM BLUR");
    await expect(page.getByTestId("overlay")).toContainText("VISUALIZES HEAT ONLY");
    await expect(page.getByTestId("overlay")).toContainText("CLASSICAL · CRYO SPRAY");
    await expect(page.getByTestId("overlay")).toContainText("LOWERS HEAT ONLY");
    await expect(page.getByTestId("overlay")).toContainText("SUBMITTED + RESET");
  });

  test("all four openings and the replay contract remain stable", async ({ page }) => {
    const expectedStages = ["accept", "accept", "accept", "accept"];
    for (let levelId = 1; levelId <= 4; levelId += 1) {
      await startLevel(page, levelId);
      await expect.poll(() => browserState(page)).toMatchObject({ stage: expectedStages[levelId - 1] });
    }
    const contracts = await page.evaluate(() => {
      const api = (window as typeof window & {
        __UNDERCOOLED__?: { state: () => unknown; dumpReplay: () => string };
      }).__UNDERCOOLED__;
      if (!api) throw new Error("Undercooled debug API is unavailable.");
      const state = api.state() as { format: string; manifest: { format: string } };
      return {
        state: state.format,
        manifest: state.manifest.format,
        replay: (JSON.parse(api.dumpReplay()) as { format: string }).format,
      };
    });
    expect(contracts).toEqual({
      state: "undercooled-state-v2",
      manifest: "undercooled-manifest-v2",
      replay: "undercooled-replay-v2",
    });
  });

  test("pause and resume preserve the active scene", async ({ page }) => {
    await startLevel(page, 1);
    await page.keyboard.press("Escape");
    await expect.poll(() => browserState(page)).toMatchObject({ phase: "paused", levelId: 1 });
    await expect(page.getByTestId("resume")).toBeVisible();
    await page.getByTestId("resume").click();
    await expect.poll(() => browserState(page)).toMatchObject({ phase: "running", levelId: 1 });
  });
});

import { expect, test as base, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

interface RuntimeFixtures {
  runtimeErrors: string[];
}

interface ActorPositions {
  A: { x: number; y: number };
  B: { x: number; y: number };
}

interface StateMeta {
  phase: string;
  levelId: number;
}

interface GameplaySummary {
  stage: string;
  acceptedJobs: number;
  validShots: number;
  laneBRevealed: boolean;
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

async function stateMeta(page: Page): Promise<StateMeta> {
  return page.evaluate(() => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { state: () => unknown };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    const state = api.state() as {
      phase?: unknown;
      level?: { id?: unknown };
      levelId?: unknown;
    };
    const levelId = state.level?.id ?? state.levelId;
    if (typeof state.phase !== "string" || typeof levelId !== "number") {
      throw new Error("Debug state does not expose stable phase and level identifiers.");
    }
    return { phase: state.phase, levelId };
  });
}

async function startLevel(page: Page, levelId: number): Promise<StateMeta> {
  await page.evaluate((id) => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { startLevel: (selectedLevel: number) => unknown };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    api.startLevel(id);
  }, levelId);
  return stateMeta(page);
}

async function actorPositions(page: Page): Promise<ActorPositions> {
  return page.evaluate(() => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { state: () => unknown };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    const state = api.state() as {
      actors?: Record<"A" | "B", { position?: { x: number; y: number } }>;
      lanes?: Record<"A" | "B", { actor?: { position?: { x: number; y: number } } }>;
    };
    const actorA = state.actors?.A ?? state.lanes?.A?.actor;
    const actorB = state.actors?.B ?? state.lanes?.B?.actor;
    if (!actorA?.position || !actorB?.position) {
      throw new Error("Debug state does not expose both actor positions.");
    }
    return { A: actorA.position, B: actorB.position };
  });
}

async function gameplaySummary(page: Page): Promise<GameplaySummary> {
  return page.evaluate(() => {
    const api = (window as typeof window & {
      __UNDERCOOLED__?: { state: () => unknown };
    }).__UNDERCOOLED__;
    if (!api) throw new Error("Undercooled debug API is unavailable.");
    const state = api.state() as {
      currentJob?: { stage?: unknown };
      score?: { acceptedJobs?: unknown; validShots?: unknown };
      laneBRevealed?: unknown;
    };
    if (
      typeof state.currentJob?.stage !== "string" ||
      typeof state.score?.acceptedJobs !== "number" ||
      typeof state.score.validShots !== "number" ||
      typeof state.laneBRevealed !== "boolean"
    ) {
      throw new Error("Debug state does not expose the v2 gameplay summary.");
    }
    return {
      stage: state.currentJob.stage,
      acceptedJobs: state.score.acceptedJobs,
      validShots: state.score.validShots,
      laneBRevealed: state.laneBRevealed,
    };
  });
}

async function pressMovement(
  page: Page,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  count = 1,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
  }
}

async function pressAction(page: Page): Promise<void> {
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
}

async function holdAction(page: Page, durationMs: number): Promise<void> {
  await page.keyboard.down("Space");
  await page.waitForTimeout(durationMs);
  await page.keyboard.up("Space");
  await page.waitForTimeout(100);
}

async function dispatchPointer(
  page: Page,
  selector: string,
  type: "pointerdown" | "pointerup",
  pointerId: number,
): Promise<void> {
  await page.locator(selector).dispatchEvent(type, {
    pointerType: "touch",
    pointerId,
    isPrimary: pointerId === 1,
    buttons: type === "pointerdown" ? 1 : 0,
  });
}

test.describe("desktop production build", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-only coverage.");
    await boot(page);
  });

  test("boots from its deployment subpath with public-safe metadata and assets", async ({ page }) => {
    const documentBase = new URL("./", page.url());
    expect(documentBase.pathname).toMatch(/\/$/);
    expect(documentBase.pathname).not.toBe("/");

    const assetPaths = await page.locator('script[src], link[rel="stylesheet"][href]').evaluateAll((nodes) =>
      nodes.map((node) => {
        if (node instanceof HTMLScriptElement) return new URL(node.src).pathname;
        return new URL((node as HTMLLinkElement).href).pathname;
      }),
    );
    expect(assetPaths.length).toBeGreaterThan(0);
    for (const assetPath of assetPaths) {
      expect(assetPath.startsWith(documentBase.pathname)).toBe(true);
    }

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator("body")).not.toContainText(/control[- ]cassette|Moth auxiliary/i);
  });

  test("offers ten orders and enters Level 1 through the player-facing flow", async ({ page }) => {
    const levelCards = page.locator("[data-testid^='level-']");
    await expect(levelCards).toHaveCount(10);
    for (let levelId = 1; levelId <= 10; levelId += 1) {
      await expect(page.getByTestId(`level-${levelId}`)).toBeVisible();
    }
    await capture(page, "desktop-v2-title.png");

    await page.getByTestId("begin").click();
    await page.getByTestId("start-level").click();
    await expect.poll(() => stateMeta(page)).toEqual({ phase: "running", levelId: 1 });
    await expect(page.getByTestId("overlay")).toBeHidden();
    await capture(page, "desktop-v2-level-1-start.png");
  });

  test("completes the first paired job through player controls", async ({ page }) => {
    await page.getByTestId("begin").click();
    await page.getByTestId("start-level").click();

    // Accept at the readout, then walk outward to PREP and face its counter.
    await pressAction(page);
    await expect.poll(() => gameplaySummary(page)).toMatchObject({ stage: "prepare" });
    await pressMovement(page, "ArrowLeft", 3);
    await pressMovement(page, "ArrowUp");
    await holdAction(page, 1_500);
    await expect.poll(() => gameplaySummary(page)).toMatchObject({ stage: "load" });

    // The first circuit is H/H. Fetch from both outer benches and install at PULSE.
    await pressMovement(page, "ArrowLeft");
    await pressAction(page);
    await pressMovement(page, "ArrowRight", 2);
    await pressMovement(page, "ArrowUp");
    await pressAction(page);
    await expect.poll(() => gameplaySummary(page)).toMatchObject({ stage: "canister" });

    // Only the designated courier picks up the canister at AUX; both return to READOUT.
    await pressMovement(page, "ArrowLeft", 2);
    await pressMovement(page, "ArrowDown", 3);
    await pressMovement(page, "ArrowLeft");
    await pressAction(page);
    await pressMovement(page, "ArrowUp", 3);
    await pressMovement(page, "ArrowRight", 4);
    await pressMovement(page, "ArrowUp");
    await pressAction(page);
    await expect.poll(() => gameplaySummary(page)).toMatchObject({ stage: "run" });

    // Run one valid shot, detach its result, submit it, and reset both processor faces.
    await pressAction(page);
    await expect.poll(() => gameplaySummary(page)).toMatchObject({ stage: "submission", validShots: 1 });
    await pressAction(page);
    await pressMovement(page, "ArrowLeft", 4);
    await pressMovement(page, "ArrowUp");
    await pressAction(page);
    await expect.poll(() => gameplaySummary(page)).toMatchObject({ stage: "reset", acceptedJobs: 1 });
    await pressMovement(page, "ArrowRight", 4);
    await pressMovement(page, "ArrowUp");
    await pressAction(page);

    await expect.poll(() => gameplaySummary(page)).toEqual({
      stage: "accept",
      acceptedJobs: 1,
      validShots: 1,
      laneBRevealed: true,
    });
    await capture(page, "desktop-v2-first-job-complete.png");
  });

  test("keeps all ten authored levels bootable and emits replay v2", async ({ page }) => {
    for (let levelId = 1; levelId <= 10; levelId += 1) {
      expect(await startLevel(page, levelId)).toEqual({ phase: "running", levelId });
      await expect(page.getByTestId("overlay")).toBeHidden();
    }

    const versionContract = await page.evaluate(() => {
      const api = (window as typeof window & {
        __UNDERCOOLED__?: { state: () => unknown; dumpReplay: () => string };
      }).__UNDERCOOLED__;
      if (!api) throw new Error("Undercooled debug API is unavailable.");
      const state = api.state() as {
        format?: unknown;
        currentJob?: { stage?: unknown };
        manifest?: { format?: unknown };
      };
      return {
        state: state.format,
        manifest: state.manifest?.format,
        stage: state.currentJob?.stage,
        replay: (JSON.parse(api.dumpReplay()) as { format?: unknown }).format,
      };
    });
    expect(versionContract).toEqual({
      state: "undercooled-state-v2",
      manifest: "undercooled-manifest-v2",
      stage: "accept",
      replay: "undercooled-replay-v2",
    });
    await capture(page, "desktop-v2-level-10.png");
  });

  test("pause and resume preserve the active shift", async ({ page }) => {
    await startLevel(page, 1);
    await page.keyboard.press("Escape");
    await expect.poll(() => stateMeta(page)).toEqual({ phase: "paused", levelId: 1 });
    await expect(page.getByTestId("resume")).toBeVisible();

    await page.getByTestId("resume").click();
    await expect.poll(() => stateMeta(page)).toEqual({ phase: "running", levelId: 1 });
    await expect(page.getByTestId("overlay")).toBeHidden();
  });
});

test.describe("Pixel 7 landscape production build", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "pixel-7-landscape-chromium",
      "Pixel-landscape-only touch coverage.",
    );
    await boot(page);
    await startLevel(page, 1);
  });

  test("shows semantic mirrored controls without horizontal overflow", async ({ page }) => {
    const touchControls = page.getByTestId("touch-controls");
    const inward = page.locator('[data-move="in"]');
    const outward = page.locator('[data-move="out"]');
    await expect(touchControls).toBeVisible();
    await expect(inward).toBeVisible();
    await expect(outward).toBeVisible();

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.width).toBeGreaterThan(viewport.height);
    expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
  });

  test("IN advances both mirrored local coordinates toward the processor", async ({ page }) => {
    const processorEdge = await actorPositions(page);
    await page.locator('[data-move="out"]').tap();
    const outward = await actorPositions(page);
    expect(outward).toEqual({
      A: { x: processorEdge.A.x - 1, y: processorEdge.A.y },
      B: { x: processorEdge.B.x - 1, y: processorEdge.B.y },
    });

    await page.locator('[data-move="in"]').tap();
    await expect.poll(() => actorPositions(page)).toEqual(processorEdge);
  });

  test("keeps the held action active while a second touch moves", async ({ page }) => {
    const before = await actorPositions(page);
    await dispatchPointer(page, '[data-testid="interact"]', "pointerdown", 1);
    await dispatchPointer(page, '[data-move="down"]', "pointerdown", 2);
    await dispatchPointer(page, '[data-move="down"]', "pointerup", 2);
    await dispatchPointer(page, '[data-testid="interact"]', "pointerup", 1);

    await expect(page.getByTestId("touch-controls")).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await expect.poll(() => actorPositions(page)).toEqual({
      A: { x: before.A.x, y: before.A.y + 1 },
      B: { x: before.B.x, y: before.B.y + 1 },
    });
    await capture(page, "pixel-7-landscape-v2-active.png");
  });
});

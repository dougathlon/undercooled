import { defineConfig, devices } from "@playwright/test";

function directoryUrl(value: string): string {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

const baseURL = directoryUrl(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173/undercooled/",
);
const testingExternalDeployment = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  // The prototype is intentionally desktop-only. Its full two-lane playfield
  // is validated at the 1600 x 1000 presenter viewport.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Explicit screenshots and retry traces are the release evidence. Recording
    // every 1600 x 900 Phaser frame starves the simulation clock on CI's
    // software renderer and makes held-input timing unrepresentative.
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1_600, height: 1_000 },
      },
    },
  ],
  webServer: testingExternalDeployment
    ? undefined
    : {
        command: "pnpm run preview:pages",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

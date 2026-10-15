import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // The 4-vCPU runner also hosts the Docker stack and the site suite; 4 workers starved relay round trips.
  workers: process.env.CI ? 3 : undefined,
  timeout: 120000,
  use: {
    headless: true,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  projects: [
    {
      // Runs against the local docker stack with the app served as a
      // production build. Deliberately no webServer — compose owns the app;
      // `bun run e2e` (scripts/e2e.sh) starts it and runs this project.
      name: "local-stack",
      // Three cold app boots plus a full offer state machine; the slowest test
      // takes about a minute in CI.
      timeout: 150_000,
      // Nostr waits until the account's data has arrived from the Evolu relay,
      // which a cold boot can stretch past the default 5s expect timeout.
      expect: { timeout: 20_000 },
      use: {
        // No slow-motion knob: per-action delays miss topup quote and offer phase deadlines.
        // Prefer --ui or the trace over --headed.
        baseURL: `http://localhost:${process.env.LINKY_E2E_WEB_PORT ?? 5176}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
      },
    },
  ],
});

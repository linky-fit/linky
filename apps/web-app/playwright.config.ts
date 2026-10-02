import { defineConfig } from "@playwright/test";

const LOCAL_STACK_SPECS = [
  "**/boot-recovery.spec.ts",
  "**/browser-compat.spec.ts",
  "**/sqlite-crash-recovery.spec.ts",
  "**/appshell-parity.spec.ts",
  "**/shards.spec.ts",
  "**/wallet-lease.spec.ts",
  "**/lane-migration.spec.ts",
  "**/private-attachments.spec.ts",
  "**/chat-payment-request.spec.ts",
  "**/chat-recovery.spec.ts",
  "**/evolu-sync.spec.ts",
  "**/evolu-servers.spec.ts",
  "**/evolu-quota-recovery.spec.ts",
  "**/cashu-sync.spec.ts",
  "**/proxy-payment.spec.ts",
  "**/issued-token-to-contact.spec.ts",
  "**/linkshu-migration.spec.ts",
  "**/mint-management.spec.ts",
  "**/password-manager-save.spec.ts",
  "**/profile-tilt-permission.spec.ts",
  "**/spayd-response.spec.ts",
  "**/security-policy.spec.ts",
  "**/seed-restore-chat-tokens.spec.ts",
  "**/receive-deferred.spec.ts",
  "**/receive-deferred-actions.spec.ts",
];

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
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
      testMatch: LOCAL_STACK_SPECS,
      // Three cold app boots plus a full offer state machine; the slowest test
      // takes about a minute in CI.
      timeout: 150_000,
      // The app deliberately does nothing relay-facing for the first ~2.5-8s
      // (useEvoluNostrBootstrapReady), so the default 5s expect timeout can
      // expire inside that quiet window.
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

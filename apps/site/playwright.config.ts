import { defineConfig } from "@playwright/test";

const port = process.env.LINKY_E2E_SITE_PORT ?? 5180;
const webAppPort = process.env.LINKY_E2E_WEB_PORT ?? 5176;
const nostrPort = process.env.LINKY_E2E_NOSTR_PORT ?? 7777;
// A throwaway receiving key for the demo login; it protects nothing.
const demoAuthSecretKey = "d".repeat(64);

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: `VITE_ALLOW_INSECURE_LOCALHOST_RELAYS=1 VITE_NOSTR_RELAYS=ws://localhost:${nostrPort} VITE_LINKY_APP_URL=http://localhost:${webAppPort} VITE_ALLOW_TEST_MINT=1 bun run build && LINKY_DEMO_AUTH_SECRET_KEY=${demoAuthSecretKey} LINKY_DEMO_AUTH_RELAYS=ws://localhost:${nostrPort} bun run preview --host localhost --port ${port}`,
    url: `http://localhost:${port}/cashu/`,
    reuseExistingServer: false,
    // CI builds the site while the web-app suite holds the CPU.
    timeout: 240_000,
  },
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5180",
    trace: "on",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command:
      "VITE_NOSTR_RELAYS=ws://localhost:7777 VITE_ALLOW_TEST_MINT=1 bun run build && bun run preview --host localhost --port 5180",
    url: "http://localhost:5180/cashu/",
    reuseExistingServer: false,
  },
});

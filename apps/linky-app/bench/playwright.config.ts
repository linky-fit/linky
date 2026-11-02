import { defineConfig } from "@playwright/test";

// Runs against `bun run dev` (vite + the dev docker stack), which also records the inspector events the bench reads.
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.bench.ts",
  timeout: 60 * 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.BENCH_BASE_URL ?? "http://localhost:5173",
    headless: process.env.BENCH_HEADED !== "1",
  },
});

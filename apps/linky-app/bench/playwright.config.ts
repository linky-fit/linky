import { defineConfig } from "@playwright/test";

// contactSend runs against `bun run dev`, which records the inspector events it reads; payments runs through `bun run journey bench`.
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

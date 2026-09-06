import { defineConfig } from "vitest/config";

// Requires docker-compose.dev.yml cashu-mint and cashu-mint-target.
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});

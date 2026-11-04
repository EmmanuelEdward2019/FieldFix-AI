import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB-backed files share one test database and truncate it between
    // tests, so files must not run concurrently with each other.
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

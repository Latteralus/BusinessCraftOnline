import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(appRoot, "src"),
    },
  },
  test: {
    environment: "node",
    // Finance integration tests hit a real local Postgres/PostgREST instance
    // (`supabase start`) rather than mocks, per AccountingFixPlan Phase A --
    // give RPC round trips room before timing out.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/finance/setup-env.ts"],
  },
});

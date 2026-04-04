import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/main/agents/scoring.ts",
        "src/main/agents/handoff.ts",
        "src/main/agents/spawn-env.ts",
        "src/main/agents/status-parser.ts",
        "src/main/terminal/ring-buffer.ts",
        "src/main/memory/extractor.ts",
        "src/main/memory/store.ts",
        "src/main/pipeline/context.ts",
      ],
      reportsDirectory: "../../coverage",
    },
    alias: {
      "@exegol/shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  resolve: {
    alias: {
      "@main/*": path.resolve(__dirname, "src/main/*"),
    },
  },
});

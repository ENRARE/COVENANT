import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@covenant/agent": resolve(import.meta.dirname, "../agent/src/index.ts"),
      "@covenant/authority": resolve(
        import.meta.dirname,
        "../authority/src/index.ts",
      ),
      "@covenant/executor": resolve(
        import.meta.dirname,
        "../executor/src/index.ts",
      ),
      "@covenant/spec": resolve(
        import.meta.dirname,
        "../../packages/spec/src/index.ts",
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: { reporter: ["text", "json", "html"] },
  },
});

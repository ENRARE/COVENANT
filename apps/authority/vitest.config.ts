import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@covenant/spec": resolve(
        import.meta.dirname,
        "../../packages/spec/src/index.ts",
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 10_000,
    coverage: { reporter: ["text", "json", "html"] },
  },
});

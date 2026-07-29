import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalRuntimeStore } from "../src/storage/local-runtime-store.js";
import { createDemoRuntimeWithDependencies } from "../src/runtime.js";

export const TEST_NOW = 2_100_000_000n;
export const TEST_RUNTIME_ID =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export async function createTestRoot(): Promise<{
  root: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "covenant-demo-test-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "covenant", private: true }),
    "utf8",
  );
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function createTestRuntime(
  root: string,
  overrides?: {
    now?: () => bigint;
    createRuntimeId?: () => unknown;
    runComposition?: Parameters<
      typeof createDemoRuntimeWithDependencies
    >[0]["runComposition"];
    storeHooks?: NonNullable<
      Parameters<typeof createLocalRuntimeStore>[0]["testHooks"]
    >;
  },
) {
  const now = overrides?.now ?? (() => TEST_NOW);
  return createDemoRuntimeWithDependencies({
    store: createLocalRuntimeStore({
      repositoryRoot: root,
      ...(overrides?.storeHooks === undefined
        ? {}
        : { testHooks: overrides.storeHooks }),
    }),
    now,
    createRuntimeId: overrides?.createRuntimeId ?? (() => TEST_RUNTIME_ID),
    ...(overrides?.runComposition === undefined
      ? {}
      : { runComposition: overrides.runComposition }),
  });
}

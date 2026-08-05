import {
  createDefaultLifecycleRuntime,
  runE2eLifecycle,
} from "./playwright-e2e-lifecycle.mjs";

try {
  process.exitCode = await runE2eLifecycle(
    process.argv.slice(2),
    createDefaultLifecycleRuntime(),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "COV-016 E2E failed.");
  process.exitCode = 1;
}

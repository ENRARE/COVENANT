import { validateCovenantBuildEnvironment } from "./build-environment.mjs";

try {
  validateCovenantBuildEnvironment();
  process.stdout.write("[OK] Canonical Foundry build environment verified.\n");
} catch {
  process.stderr.write(
    "[FAILED] Canonical Foundry build environment could not be verified.\n",
  );
  process.exitCode = 1;
}

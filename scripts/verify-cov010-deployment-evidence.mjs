import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyCov010DeploymentEvidence } from "../packages/spec/dist/cov010-deployment-evidence.js";

const manifestPath = resolve(
  import.meta.dirname,
  "../evidence/arc-testnet/cov-010/deployment-manifest.json",
);

try {
  const input = JSON.parse(readFileSync(manifestPath, "utf8"));

  verifyCov010DeploymentEvidence(input);

  process.stdout.write("COV-010 deployment evidence verified.\n");
} catch {
  process.stderr.write("COV-010 deployment evidence verification failed.\n");

  process.exitCode = 1;
}

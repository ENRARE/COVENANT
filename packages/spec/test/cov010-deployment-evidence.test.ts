import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COV010_CANONICAL_MANIFEST_DIGEST,
  cov010CanonicalManifestDigest,
  verifyCov010DeploymentEvidence,
} from "../src/cov010-deployment-evidence.js";

const manifestPath = fileURLToPath(
  new URL(
    "../../../evidence/arc-testnet/cov-010/deployment-manifest.json",
    import.meta.url,
  ),
);

function loadManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
}

describe("COV-010 deployment evidence", () => {
  it("verifies the committed public manifest", () => {
    const verified = verifyCov010DeploymentEvidence(loadManifest());

    expect(cov010CanonicalManifestDigest(verified)).toBe(
      COV010_CANONICAL_MANIFEST_DIGEST,
    );
  });

  it("rejects a changed deployment anchor", () => {
    expect(() =>
      verifyCov010DeploymentEvidence({
        ...loadManifest(),
        deploymentBlockNumber: "54829530",
      }),
    ).toThrow("COV-010 deployment evidence anchor mismatch");
  });

  it("rejects changes covered by the canonical digest", () => {
    expect(() =>
      verifyCov010DeploymentEvidence({
        ...loadManifest(),
        verificationTimestamp: "2000-01-01T00:00:00.000Z",
      }),
    ).toThrow("COV-010 deployment evidence digest mismatch");
  });

  it("rejects unknown fields", () => {
    expect(() =>
      verifyCov010DeploymentEvidence({
        ...loadManifest(),
        unexpectedField: true,
      }),
    ).toThrow();
  });

  it("rejects corrupted immutable linkage", () => {
    const manifest = loadManifest();

    expect(() =>
      verifyCov010DeploymentEvidence({
        ...manifest,
        immutableValues: {
          ...(manifest.immutableValues as Record<string, unknown>),
          totalBudget: "1",
        },
      }),
    ).toThrow();
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  COV010_DEPLOYMENT_MANIFEST_PATH,
  COV010_RUNTIME_TRUST_ANCHOR_PATH,
  verifyCov010RuntimeTrustAnchor,
} from "./verify-cov010-runtime-trust-anchor.mjs";

const root = resolve(import.meta.dirname, "..");
const anchor = JSON.parse(
  readFileSync(resolve(root, COV010_RUNTIME_TRUST_ANCHOR_PATH), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(resolve(root, COV010_DEPLOYMENT_MANIFEST_PATH), "utf8"),
);
const executorDockerfile = readFileSync(
  resolve(root, "Dockerfile.executor"),
  "utf8",
);

test("COV-010 runtime trust anchor matches every recoverable deployment field", () => {
  assert.doesNotThrow(() => verifyCov010RuntimeTrustAnchor(anchor, manifest));
});

test("COV-010 runtime trust anchor declares reconstructed provenance", () => {
  assert.equal(anchor.provenance.historicalCovenantSpecRecovered, false);
  assert.equal(
    anchor.provenance.createdAtProvenance,
    "NORMALIZED_TO_VALID_AFTER_FOR_RUNTIME_SCHEMA_ONLY",
  );
  assert.equal(anchor.covenantSpec.createdAt, anchor.covenantSpec.validAfter);
});

test("executor image copies only the reviewed trust anchor to its stable runtime path", () => {
  assert.match(
    executorDockerfile,
    /^COPY --from=build --chown=node:node \/workspace\/deployment\/arc-testnet\/cov010-runtime-trust-anchor\.json \/app\/deployment\/arc-testnet\/cov010-runtime-trust-anchor\.json$/mu,
  );
  assert.doesNotMatch(executorDockerfile, /COPY .*\/workspace\/evidence\//u);
});

for (const [name, field, replacement] of [
  ["agent signer", "agentSigner", "0x9000000000000000000000000000000000000009"],
  ["policy hash", "policyHash", `0x${"90".repeat(32)}`],
]) {
  test(`modified ${name} fails manifest verification`, () => {
    const modified = structuredClone(anchor);
    modified.covenantSpec[field] = replacement;
    assert.throws(
      () => verifyCov010RuntimeTrustAnchor(modified, manifest),
      new RegExp(field),
    );
  });
}

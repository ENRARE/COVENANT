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
const authorizationSpecPath = resolve(
  root,
  "deployment/arc-testnet/cov010-api-authorization-spec.json",
);
const authorizationSpec = JSON.parse(
  readFileSync(authorizationSpecPath, "utf8"),
);
const runtimeTrustAnchor = JSON.parse(
  readFileSync(resolve(root, COV010_RUNTIME_TRUST_ANCHOR_PATH), "utf8"),
);
const deploymentManifest = JSON.parse(
  readFileSync(resolve(root, COV010_DEPLOYMENT_MANIFEST_PATH), "utf8"),
);
const apiDockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const projectId =
  "0x7bf8f28b510a05cf48b7a239b35e6e8e0cde9db7371fa33f8e9e1c06c84177ee";

function verifyAuthorizationSpec(candidate) {
  assert.deepEqual(Object.keys(candidate), ["entries"]);
  assert.ok(Array.isArray(candidate.entries));
  assert.equal(candidate.entries.length, 1);
  assert.deepEqual(Object.keys(candidate.entries[0]), [
    "projectId",
    "covenantSpec",
  ]);
  assert.equal(candidate.entries[0].projectId, projectId);
  assert.deepEqual(
    candidate.entries[0].covenantSpec,
    runtimeTrustAnchor.covenantSpec,
  );
}

test("API authorization artifact exactly wraps the reviewed COV-010 CovenantSpec", () => {
  assert.doesNotThrow(() =>
    verifyCov010RuntimeTrustAnchor(runtimeTrustAnchor, deploymentManifest),
  );
  assert.doesNotThrow(() => verifyAuthorizationSpec(authorizationSpec));
  assert.equal(
    authorizationSpec.entries[0].covenantSpec.covenantId,
    deploymentManifest.constructor.covenantId,
  );
});

test("modified API authorization signer fails exact-source verification", () => {
  const modified = structuredClone(authorizationSpec);
  modified.entries[0].covenantSpec.authorizationSigner =
    "0x9000000000000000000000000000000000000009";
  assert.throws(() => verifyAuthorizationSpec(modified));
});

test("API authorization artifact contains no secret-bearing fields", () => {
  const forbiddenField =
    /(?:apiKey|credential|entitySecret|mnemonic|password|privateKey|recovery|seedPhrase)/iu;
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      assert.doesNotMatch(key, forbiddenField);
      visit(nested);
    }
  };
  visit(authorizationSpec);
});

test("API image copies only the reviewed public authorization artifact", () => {
  assert.match(
    apiDockerfile,
    /^COPY --from=build --chown=node:node \/workspace\/deployment\/arc-testnet\/cov010-api-authorization-spec\.json \/app\/deployment\/arc-testnet\/cov010-api-authorization-spec\.json$/mu,
  );
  assert.equal(
    apiDockerfile.match(/\/workspace\/deployment\/arc-testnet\//gu)?.length,
    1,
  );
  assert.doesNotMatch(apiDockerfile, /COPY .*\/workspace\/evidence\//u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { privateArtifactReason } from "./check-private-artifacts.mjs";

test("private-artifact checker blocks exact Covenant filenames", () => {
  assert.equal(
    privateArtifactReason("temporary/role-wallets.local.json"),
    "role wallet registry",
  );

  assert.equal(
    privateArtifactReason("archive/cov-010-deployment-operation.local.json"),
    "private Circle deployment operation",
  );
});

test("private-artifact checker blocks bootstrap directories", () => {
  assert.equal(
    privateArtifactReason("temporary/covenant-circle-bootstrap/operation.json"),
    "private bootstrap directory",
  );
});

test("private-artifact checker blocks recovery and credential artifacts", () => {
  assert.equal(
    privateArtifactReason("backups/wallet-recovery.json"),
    "recovery artifact",
  );

  assert.equal(
    privateArtifactReason("private/entity-secret.local.txt"),
    "entity-secret artifact",
  );

  assert.equal(
    privateArtifactReason("private/circle-api-key.local.txt"),
    "Circle API-key artifact",
  );
});

test("private-artifact checker permits documentation filenames", () => {
  assert.equal(privateArtifactReason("docs/recovery-procedure.md"), undefined);

  assert.equal(
    privateArtifactReason("docs/entity-secret-handling.md"),
    undefined,
  );
});

test("private-artifact checker permits public deployment evidence", () => {
  assert.equal(
    privateArtifactReason(
      "evidence/arc-testnet/cov-010/deployment-manifest.json",
    ),
    undefined,
  );
});

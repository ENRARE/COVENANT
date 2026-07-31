import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  deriveSemanticImmutableMap,
  expectedCovenantImmutableValues,
  semanticImmutableMapDigest,
  validateSemanticImmutableMap,
  validateSemanticImmutableValues,
} from "./semantic-immutables.mjs";
import { loadReviewedCovenantVaultArtifact } from "./artifact-attestation.mjs";

function variable(id, name, mutability = "immutable") {
  return {
    id,
    nodeType: "VariableDeclaration",
    name,
    mutability,
    typeDescriptions: { typeString: "bytes32" },
  };
}

function buildInfo(
  declarations,
  contractName = "Example",
  sourceUnit = "src/Example.sol",
) {
  return {
    output: {
      sources: {
        [sourceUnit]: {
          ast: {
            nodeType: "SourceUnit",
            nodes: [
              {
                nodeType: "ContractDefinition",
                name: contractName,
                nodes: declarations,
              },
            ],
          },
        },
      },
    },
  };
}

test("AST identifiers never participate in semantic immutable identity", () => {
  const first = deriveSemanticImmutableMap(
    { 10: [{ start: 1, length: 32 }] },
    buildInfo([variable(10, "value")]),
    64,
  );
  const second = deriveSemanticImmutableMap(
    { 999: [{ start: 1, length: 32 }] },
    buildInfo(
      [variable(999, "value")],
      "Example",
      "different/source-unit/Example.sol",
    ),
    64,
  );
  assert.deepEqual(first, second);
  assert.equal(
    semanticImmutableMapDigest(first),
    semanticImmutableMapDigest(second),
  );
});

test("semantic labels and ranges are security commitments", () => {
  const map = deriveSemanticImmutableMap(
    { 10: [{ start: 1, length: 32 }] },
    buildInfo([variable(10, "value")]),
    64,
  );
  const changedLabel = [{ ...map[0], label: "Example.other:bytes32" }];
  const changedRange = [{ ...map[0], ranges: [{ start: "2", length: "32" }] }];
  assert.notEqual(
    semanticImmutableMapDigest(map),
    semanticImmutableMapDigest(changedLabel),
  );
  assert.notEqual(
    semanticImmutableMapDigest(map),
    semanticImmutableMapDigest(changedRange),
  );
});

test("semantic map canonical form fails closed", () => {
  const map = deriveSemanticImmutableMap(
    { 10: [{ start: 1, length: 32 }] },
    buildInfo([variable(10, "value")]),
    64,
  );
  assert.doesNotThrow(() => validateSemanticImmutableMap(map, 64));
  for (const invalid of [
    [],
    [{ ...map[0], label: "unstable" }],
    [map[0], map[0]],
    [{ ...map[0], ranges: [] }],
    [{ ...map[0], ranges: [{ start: "01", length: "32" }] }],
    [{ ...map[0], ranges: [{ start: "1e0", length: "32" }] }],
    [{ ...map[0], ranges: [{ start: "1", length: "0" }] }],
    [{ ...map[0], ranges: [{ start: "40", length: "32" }] }],
    [
      {
        ...map[0],
        ranges: [
          { start: "2", length: "32" },
          { start: "1", length: "32" },
        ],
      },
    ],
  ]) {
    assert.throws(() => validateSemanticImmutableMap(invalid, 64));
  }
});

test("AST and raw-range resolution fails closed", () => {
  assert.throws(() =>
    deriveSemanticImmutableMap(
      { 11: [{ start: 1, length: 32 }] },
      buildInfo([variable(10, "value")]),
      64,
    ),
  );
  assert.throws(() =>
    deriveSemanticImmutableMap(
      { 10: [{ start: 1, length: 32 }] },
      buildInfo([variable(10, "value", "mutable")]),
      64,
    ),
  );
  assert.throws(() =>
    deriveSemanticImmutableMap(
      {
        10: [{ start: 1, length: 32 }],
        11: [{ start: 40, length: 16 }],
      },
      buildInfo([variable(10, "value"), variable(11, "value")]),
      64,
    ),
  );
  assert.throws(() =>
    deriveSemanticImmutableMap(
      {
        10: [
          { start: 1, length: 32 },
          { start: 1, length: 32 },
        ],
      },
      buildInfo([variable(10, "value")]),
      64,
    ),
  );
  assert.throws(() =>
    deriveSemanticImmutableMap(
      {
        10: [{ start: 1, length: 32 }],
        11: [{ start: 16, length: 32 }],
      },
      buildInfo([variable(10, "left"), variable(11, "right")]),
      64,
    ),
  );
  assert.throws(() =>
    deriveSemanticImmutableMap(
      { 10: [{ start: 40, length: 32 }] },
      buildInfo([variable(10, "value")]),
      64,
    ),
  );
});

test("reviewed Covenant and inherited immutables all bind expected values", () => {
  const artifact = loadReviewedCovenantVaultArtifact();
  const fixture = JSON.parse(
    readFileSync(
      resolve("tests/fixtures/arc/deployment-plan-input.json"),
      "utf8",
    ),
  );
  const values = expectedCovenantImmutableValues({
    constructor: fixture.constructor,
    chainId: "5042002",
    contractAddress: "0x820e038c1ea23f9aee2db4d83ae07c5f23f39b75",
  });
  assert.doesNotThrow(() =>
    validateSemanticImmutableValues(artifact.semanticImmutableMap, values),
  );
  assert.ok(
    artifact.semanticImmutableMap.some(({ label }) =>
      label.startsWith("EIP712._cachedDomainSeparator:"),
    ),
  );
  assert.equal(
    Object.keys(values).length,
    artifact.semanticImmutableMap.length,
  );
});

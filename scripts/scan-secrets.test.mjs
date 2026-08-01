import assert from "node:assert/strict";
import test from "node:test";
import { findingsForText } from "./scan-secrets.mjs";

function syntheticUuid() {
  return ["11111111", "2222", "4333", "8444", "555555555555"].join("-");
}

test("secret scanner detects representative synthetic credentials", () => {
  const githubToken = ["gh", "p_", "A".repeat(36)].join("");
  const privateKey = ["-----BEGIN ", "PRIVATE KEY-----"].join("");

  assert.ok(findingsForText(githubToken, "fixture.md").length > 0);

  assert.ok(findingsForText(privateKey, "fixture.yml").length > 0);

  const assignedCredential = ["api", "_key=", '"synthetic-test-value"'].join(
    "",
  );

  assert.ok(findingsForText(assignedCredential, "fixture.json").length > 0);
});

test("secret scanner detects Covenant credential families", () => {
  const samples = [
    ["CIRCLE_API", "_KEY=", "circle_test_", "A".repeat(24)].join(""),

    ["CIRCLE_ENTITY", "_SECRET=", "B".repeat(64)].join(""),

    [
      "SUPABASE_SERVICE_ROLE",
      "_KEY=eyJ",
      "C".repeat(48),
      ".",
      "D".repeat(24),
    ].join(""),

    ["github", "_pat_", "E".repeat(40)].join(""),

    ["gh", "p_", "F".repeat(36)].join(""),

    ["npm", "_", "G".repeat(32)].join(""),

    ["//registry.npmjs.org/:_auth", "Token=", "H".repeat(32)].join(""),

    ["sk", "-proj-", "I".repeat(32)].join(""),

    ["AUTHORIZATION", "_KEY=0x", "ab".repeat(32)].join(""),
  ];

  for (const sample of samples) {
    assert.ok(
      findingsForText(sample, "synthetic.fixture").length > 0,
      `expected scanner finding for ${sample.slice(0, 24)}`,
    );
  }
});

test("secret scanner detects complete Circle server API keys", () => {
  const testKey = [
    "TEST",
    "_API_KEY:",
    "identifier1234",
    ":",
    "secretvalue567890",
  ].join("");

  const liveKey = [
    "LIVE",
    "_API_KEY:",
    "identifier5678",
    ":",
    "secretvalue123456",
  ].join("");

  assert.ok(findingsForText(testKey, "output.txt").length > 0);
  assert.ok(findingsForText(liveKey, "output.txt").length > 0);
});

test("secret scanner detects contextual Circle resource IDs", () => {
  const id = syntheticUuid();

  const samples = [
    ["wallet", 'Id: "', id, '"'].join(""),
    ["wallet", 'SetId: "', id, '"'].join(""),
    ["transaction", 'Id: "', id, '"'].join(""),
    ["contract", 'Id: "', id, '"'].join(""),
    ["contract", 'Ids: ["', id, '"]'].join(""),
  ];

  for (const sample of samples) {
    assert.ok(findingsForText(sample, "circle-response.json").length > 0);
  }
});

test("secret scanner detects raw entity secrets and ciphertext", () => {
  const rawEntitySecret = ["entity", 'Secret: "', "ab".repeat(32), '"'].join(
    "",
  );

  const ciphertext = [
    "entity",
    'SecretCiphertext: "',
    "Q".repeat(256),
    '"',
  ].join("");

  assert.ok(findingsForText(rawEntitySecret, "operation.json").length > 0);

  assert.ok(findingsForText(ciphertext, "operation.json").length > 0);
});

test("secret scanner detects recovery contents", () => {
  const recovery = [
    "recovery",
    'Phrase: "',
    ["alpha", "bravo", "charlie", "delta", "echo"].join(" "),
    '"',
  ].join("");

  assert.ok(findingsForText(recovery, "recovery.json").length > 0);
});

test("secret scanner does not ban unrelated UUID fields", () => {
  const id = syntheticUuid();

  const safeText = [
    ["request", 'Id: "', id, '"'].join(""),
    ["idempotency", 'Key: "', id, '"'].join(""),
  ].join("\n");

  assert.deepEqual(findingsForText(safeText, "request.json"), []);
});

test("secret scanner does not flag public chain evidence", () => {
  const publicEvidence = [
    `contractAddress=0x${"12".repeat(20)}`,
    `transactionHash=0x${"ab".repeat(32)}`,
    `blockHash=0x${"cd".repeat(32)}`,
    `planDigest=0x${"ef".repeat(32)}`,
  ].join("\n");

  assert.deepEqual(findingsForText(publicEvidence, "manifest.json"), []);
});

test("secret scanner does not flag hashes without secret context", () => {
  assert.deepEqual(
    findingsForText(`intentHash=0x${"ab".repeat(32)}`, "vectors.ts"),
    [],
  );
});

test("secret scanner permits variable names without values", () => {
  assert.deepEqual(findingsForText("CIRCLE_API_KEY=", ".env.example"), []);
});

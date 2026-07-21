import assert from "node:assert/strict";
import test from "node:test";
import { findingsForText } from "./scan-secrets.mjs";

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

test("secret scanner does not flag hashes without secret assignment context", () => {
  assert.deepEqual(
    findingsForText(`intentHash=0x${"ab".repeat(32)}`, "vectors.ts"),
    [],
  );
});

test("secret scanner permits variable names without values", () => {
  assert.deepEqual(findingsForText("CIRCLE_API_KEY=", ".env.example"), []);
});

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

test("secret scanner permits variable names without values", () => {
  assert.deepEqual(findingsForText("CIRCLE_API_KEY=", ".env.example"), []);
});

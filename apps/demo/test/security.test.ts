import { describe, expect, it } from "vitest";
import { DemoError, sanitizeDemoError } from "../src/errors.js";
import { createTestRoot, createTestRuntime } from "./helpers.js";

describe("public security boundary", () => {
  it("serializes only fixed error fields and suppresses stacks", () => {
    const error = new DemoError("RUNTIME_FAILURE");
    expect(error.stack).toBeUndefined();
    expect(Object.keys(error.toJSON())).toEqual(["name", "code", "message"]);
    const sanitized = sanitizeDemoError(
      new Error("secret path private key signature calldata"),
    );
    expect(JSON.stringify(sanitized)).not.toMatch(
      /secret|path|private key|signature|calldata/i,
    );
  });

  it("returns defensive recursively frozen state", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      const seeded = await runtime.executeDemoAction("SEED");
      const copy = structuredClone(seeded);
      copy.availableActions.length = 0;
      const reread = await runtime.executeDemoAction("GET_STATE");
      expect(reread.availableActions.length).toBeGreaterThan(0);
      expect(Object.isFrozen(reread.health)).toBe(true);
      expect(Object.isFrozen(reread.timeline[0])).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });
});

import { describe, expect, it } from "vitest";
import { DEMO_ACTIONS, parseDemoAction } from "../src/actions.js";
import { createTestRoot, createTestRuntime } from "./helpers.js";

describe("strict demo actions", () => {
  it.each(DEMO_ACTIONS)("accepts %s", (action) => {
    expect(parseDemoAction(action)).toBe(action);
  });

  it.each([
    {},
    [],
    " RUN_DEMO",
    "RUN_DEMO ",
    "RUN_HAPPY_PATH",
    1,
    true,
    null,
    undefined,
  ])("rejects non-enumerated action %#", (value) => {
    let failure: unknown;
    try {
      parseDemoAction(value);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "MALFORMED_ACTION" });
  });

  it.each([
    { arguments_: [] },
    { arguments_: ["RUN_DEMO", {}] },
    { arguments_: ["GET_STATE", undefined] },
    { arguments_: ["RESET", null, true] },
  ] as const)(
    "rejects the actual JavaScript argument tuple $arguments_",
    async ({ arguments_ }) => {
      const fixture = await createTestRoot();
      try {
        const runtime = createTestRuntime(fixture.root);
        const executeDemoAction = runtime.executeDemoAction.bind(runtime);
        await expect(
          Reflect.apply(executeDemoAction, undefined, arguments_),
        ).rejects.toMatchObject({
          name: "DemoError",
          code: "MALFORMED_ACTION",
          message: "Demo action is malformed",
        });
      } finally {
        await fixture.cleanup();
      }
    },
  );
});

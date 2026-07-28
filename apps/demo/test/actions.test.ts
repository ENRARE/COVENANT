import { describe, expect, it } from "vitest";
import { DEMO_ACTIONS, parseDemoAction } from "../src/actions.js";

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
});

import {
  executeAuditCommand,
  MAX_AUDIT_COMMAND_INPUT_BYTES,
} from "../src/index.js";
import { describe, expect, it } from "vitest";
import { approvedDemoSource, bundle } from "./fixtures.js";

describe("COV-015 JSON-only offline command", () => {
  it("returns one canonical JSON document and no command metadata", () => {
    const result = executeAuditCommand(
      JSON.stringify(bundle(approvedDemoSource())),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output.endsWith("\n")).toBe(true);
    expect(result.output.trimEnd()).not.toContain("\n");
    expect(JSON.parse(result.output)).toMatchObject({
      mode: "OFFLINE_AUDIT_TIMELINE",
      authoritative: false,
    });
    expect(result.output).not.toContain("generatedAt");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns only a fixed sanitized JSON error", () => {
    for (const result of [
      executeAuditCommand("not-json"),
      executeAuditCommand(JSON.stringify(bundle(approvedDemoSource())), true),
      executeAuditCommand("x".repeat(MAX_AUDIT_COMMAND_INPUT_BYTES + 1)),
    ]) {
      expect(result).toEqual({
        exitCode: 1,
        output:
          '{"code":"MALFORMED_AUDIT_SOURCE","message":"Audit source is malformed","name":"AuditProjectionError"}\n',
      });
      expect(result.output).not.toContain("not-json");
      expect(result.output).not.toContain("stack");
      expect(result.output).not.toContain("cause");
    }
  });
});

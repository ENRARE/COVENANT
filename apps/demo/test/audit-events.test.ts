import { describe, expect, it } from "vitest";
import {
  createAuditEvent,
  deepFreeze,
  deterministicEventIdGenerator,
} from "../src/audit-events.js";
import { auditEventSchema } from "../src/schemas.js";
import { TEST_NOW, TEST_RUNTIME_ID } from "./helpers.js";

describe("strict sanitized audit events", () => {
  it("creates deterministic strict event identifiers", () => {
    const input = {
      runtimeId: TEST_RUNTIME_ID,
      sequence: "1",
      eventType: "RUNTIME_INITIALIZED" as const,
      occurredAt: TEST_NOW.toString(),
      eventIdGenerator: deterministicEventIdGenerator,
    };
    const first = createAuditEvent(input);
    const second = createAuditEvent(input);
    expect(first).toEqual(second);
    expect(first.eventId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects unknown fields and noncanonical common values", () => {
    const event = createAuditEvent({
      runtimeId: TEST_RUNTIME_ID,
      sequence: "1",
      eventType: "RUNTIME_INITIALIZED",
      occurredAt: TEST_NOW.toString(),
    });
    expect(() => auditEventSchema.parse({ ...event, extra: true })).toThrow();
    expect(() =>
      auditEventSchema.parse({ ...event, sequence: "01" }),
    ).toThrow();
    expect(() =>
      auditEventSchema.parse({ ...event, occurredAt: "0" }),
    ).toThrow();
  });

  it("recursively freezes projections", () => {
    const value = deepFreeze({ child: { list: [{ value: "safe" }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.child)).toBe(true);
    expect(Object.isFrozen(value.child.list)).toBe(true);
    expect(Object.isFrozen(value.child.list[0])).toBe(true);
  });
});

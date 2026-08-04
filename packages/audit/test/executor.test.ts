import {
  AuditProjectionError,
  auditSourceBundleSchema,
  projectAuditTimeline,
} from "../src/index.js";
import { describe, expect, it } from "vitest";
import { bundle, executorSource, signedFlowSource } from "./fixtures.js";

describe("COV-015 executor result classification", () => {
  it.each([
    ["PREPARED", executorSource({ status: "PREPARED" }), undefined],
    [
      "SIMULATED",
      executorSource({ status: "SIMULATED" }),
      "TRANSPORT_SIMULATION_ACCEPTED",
    ],
    [
      "SUBMITTED",
      executorSource({ status: "SUBMITTED", transactionId: "opaque-1" }),
      "TRANSPORT_SUBMISSION_ACCEPTED",
    ],
  ])(
    "maps the real %s output without inventing execution evidence",
    (_name, source, expected) => {
      const timeline = projectAuditTimeline(bundle(signedFlowSource(), source));
      expect(timeline.events).toContainEqual(
        expect.objectContaining({ eventType: "EXECUTOR_REQUEST_PREPARED" }),
      );
      if (expected !== undefined) {
        expect(
          timeline.events.some(({ eventType }) => eventType === expected),
        ).toBe(true);
      }
      expect(
        timeline.events.some(({ stage }) => stage === "TRANSACTION_SUBMISSION"),
      ).toBe(false);
      expect(
        timeline.events.some(({ stage }) => stage === "EXECUTION_EVIDENCE"),
      ).toBe(false);
      expect(
        timeline.events.some(({ stage }) => stage === "SETTLEMENT_EVIDENCE"),
      ).toBe(false);
    },
  );

  it.each([
    { status: "REJECTED", noSubmission: true, errorCode: "SUBMISSION_FAILURE" },
    { status: "AMBIGUOUS", errorCode: "EXECUTION_RESULT_AMBIGUOUS" },
    { status: "ERROR", errorCode: "SIMULATION_FAILURE" },
  ])("rejects unsupported executor failure source shape $status", (result) => {
    const input = bundle({
      kind: "EXECUTOR_RESULT",
      result: {
        ...result,
        execution: executorSource({ status: "PREPARED" }).result.execution,
      },
    });
    expect(auditSourceBundleSchema.safeParse(input).success).toBe(false);
    let thrown: unknown;
    try {
      projectAuditTimeline(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuditProjectionError);
    expect(thrown).toMatchObject({ code: "MALFORMED_AUDIT_SOURCE" });
  });

  it("rejects conflicting transaction identifiers for one execution", () => {
    let thrown: unknown;
    try {
      projectAuditTimeline(
        bundle(
          signedFlowSource(),
          executorSource({ status: "SUBMITTED", transactionId: "opaque-1" }),
          executorSource({ status: "SUBMITTED", transactionId: "opaque-2" }),
        ),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuditProjectionError);
    if (!(thrown instanceof AuditProjectionError)) {
      throw new Error("Expected AuditProjectionError");
    }
    expect(thrown.code).toBe("AUDIT_SOURCE_CONFLICT");
  });
});

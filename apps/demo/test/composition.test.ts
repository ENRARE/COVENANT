import { CANONICAL_RULE_IDS } from "@covenant/spec";
import { describe, expect, it } from "vitest";
import { runFrozenComposition } from "../src/composition.js";
import { TEST_NOW } from "./helpers.js";

describe("fixed production-service composition", () => {
  it("approves the happy path and rejects redirected payment", async () => {
    const events: {
      eventType: string;
      scenarioId: string;
      fields: Readonly<Record<string, unknown>>;
    }[] = [];
    await runFrozenComposition({
      now: TEST_NOW,
      emit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    expect(events.map(({ eventType }) => eventType)).toEqual([
      "INVOICE_RECEIVED",
      "PAYMENT_INTENT_PROPOSED",
      "RULES_EVALUATED",
      "DECISION_APPROVED",
      "AUTHORIZATION_ISSUED",
      "EXECUTOR_REQUEST_PREPARED",
      "SIMULATION_ACCEPTED",
      "SUBMISSION_SIMULATED",
      "SCENARIO_COMPLETED",
      "INVOICE_RECEIVED",
      "PAYMENT_INTENT_PROPOSED",
      "RULES_EVALUATED",
      "DECISION_REJECTED",
      "SCENARIO_COMPLETED",
    ]);
    const happyRules = events[2]?.fields.ruleResults as {
      ruleId: string;
      status: string;
    }[];
    expect(happyRules).toHaveLength(CANONICAL_RULE_IDS.length);
    expect(happyRules.every(({ status }) => status === "PASS")).toBe(true);
    const rejectedRules = events[11]?.fields.ruleResults as {
      ruleId: string;
      status: string;
    }[];
    expect(
      rejectedRules.find(({ ruleId }) => ruleId === "recipient_allowed"),
    ).toMatchObject({ status: "FAIL" });
    expect(
      events
        .slice(12)
        .some(({ eventType }) =>
          [
            "AUTHORIZATION_ISSUED",
            "EXECUTOR_REQUEST_PREPARED",
            "SIMULATION_ACCEPTED",
            "SUBMISSION_SIMULATED",
          ].includes(eventType),
        ),
    ).toBe(false);
  });

  it("directly rejects the frozen excessive amount", async () => {
    const events: {
      eventType: string;
      scenarioId: string;
      fields: Readonly<Record<string, unknown>>;
    }[] = [];
    await runFrozenComposition({
      now: TEST_NOW,
      compromisedAmount: "5000.000001",
      emit: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    });
    const rejectedRules = events[11]?.fields.ruleResults as {
      ruleId: string;
      status: string;
    }[];
    expect(
      rejectedRules.find(({ ruleId }) => ruleId === "amount_within_limit"),
    ).toMatchObject({ status: "FAIL" });
  });
});

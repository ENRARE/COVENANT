import { CANONICAL_RULE_IDS } from "@covenant/spec";
import { describe, expect, it } from "vitest";
import { createIntegrationFixture } from "./fixtures.js";
import {
  IntegrationHandoffError,
  mapApprovedAuthorityResultToExecutorRequest,
} from "./handoff.js";

describe("COV-006 isolated compromised proposer", () => {
  it.each([
    {
      name: "unauthorized recipient",
      input: (
        fixture: Awaited<ReturnType<typeof createIntegrationFixture>>,
      ) => ({
        recipient: fixture.addresses.attacker,
        amount: "1.25",
      }),
      failedRule: "recipient_allowed",
    },
    {
      name: "amount above the Covenant maximum",
      input: (
        fixture: Awaited<ReturnType<typeof createIntegrationFixture>>,
      ) => ({
        recipient: fixture.addresses.recipient,
        amount: "5000.000001",
      }),
      failedRule: "amount_within_limit",
    },
  ])("rejects $name before transport", async ({ input, failedRule }) => {
    const fixture = await createIntegrationFixture();
    expect(Object.keys(fixture.compromisedProposer)).toEqual([
      "createPaymentRequest",
    ]);
    expect(fixture.compromisedProposer).not.toHaveProperty(
      "signAuthorizationReceipt",
    );
    expect(fixture.compromisedProposer).not.toHaveProperty("transport");
    expect(fixture.compromisedProposer).not.toHaveProperty("submit");
    expect(fixture.compromisedProposer).not.toHaveProperty("credentials");

    const maliciousRequest =
      await fixture.compromisedProposer.createPaymentRequest(input(fixture));
    const authorityResult =
      await fixture.authority.processPaymentRequest(maliciousRequest);
    expect(authorityResult.status).toBe("REJECTED");
    expect("authorizationReceipt" in authorityResult).toBe(false);
    expect(authorityResult.ruleResults).toHaveLength(CANONICAL_RULE_IDS.length);
    expect(
      authorityResult.ruleResults.find(
        (result) => result.ruleId === failedRule,
      ),
    ).toMatchObject({ status: "FAIL" });
    expect(fixture.transport.simulations).toHaveLength(0);
    expect(fixture.transport.submissions).toHaveLength(0);

    let failure: unknown;
    try {
      mapApprovedAuthorityResultToExecutorRequest(
        maliciousRequest,
        authorityResult,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(IntegrationHandoffError);
    expect(failure).toMatchObject({
      code: "AUTHORITY_RESULT_NOT_APPROVED",
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(
      maliciousRequest.signedPaymentIntent.signature,
    );
    expect(serialized).not.toContain(maliciousRequest.signedInvoice.signature);
    expect(serialized).not.toContain("typedData");
    expect(serialized).not.toContain("stack");
    expect(fixture.transport.simulations).toHaveLength(0);
    expect(fixture.transport.submissions).toHaveLength(0);
  });
});

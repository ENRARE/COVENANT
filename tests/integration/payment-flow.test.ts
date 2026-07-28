import { createAgentService, type AgentProposalResult } from "@covenant/agent";
import {
  CANONICAL_RULE_IDS,
  covenantSpecSchema,
  signedAuthorizationReceiptSchema,
  signedPaymentIntentSchema,
} from "@covenant/spec";
import {
  createAuthorityService,
  type ProcessResult,
} from "@covenant/authority";
import {
  createExecutorService,
  type AuthorizedTransactionRequest,
} from "@covenant/executor";
import { decodeFunctionData, getAddress, type Abi } from "viem";
import { describe, expect, it } from "vitest";
import covenantVaultAbi from "../../packages/contracts/abi/CovenantVault.json";
import { EXPECTED_AMOUNT, createIntegrationFixture } from "./fixtures.js";
import { mapApprovedAuthorityResultToExecutorRequest } from "./handoff.js";
import { SIMULATED_SUBMISSION_ID } from "./deterministic-transaction-transport.js";

function expectExactTransaction(
  request: AuthorizedTransactionRequest,
  expected: Readonly<{
    vault: string;
    data: string;
  }>,
): void {
  expect(Object.keys(request)).toEqual(["chainId", "to", "value", "data"]);
  expect(request).toEqual({
    chainId: 5_042_002n,
    to: expected.vault,
    value: 0n,
    data: expected.data,
  });
  expect(Object.isFrozen(request)).toBe(true);
}

describe("COV-006 built-package integration contract", () => {
  it("imports every application boundary through its built package export", () => {
    expect(createAgentService).toBeTypeOf("function");
    expect(createAuthorityService).toBeTypeOf("function");
    expect(createExecutorService).toBeTypeOf("function");
    expect(covenantSpecSchema).toBeDefined();
  });

  it("composes Invoice through exact simulated submission", async () => {
    const fixture = await createIntegrationFixture();
    const agentResult = await fixture.agent.proposePayment({
      signedInvoice: fixture.signedInvoice,
      procurementRequest: {
        productId: "gpu-h100-hour",
        expectedAmount: fixture.expectedAmount,
      },
    });
    expect(agentResult.signedInvoice).toEqual(fixture.signedInvoice);

    const authorityResult =
      await fixture.authority.processPaymentRequest(agentResult);
    expect(authorityResult.status).toBe("APPROVED");
    expect(authorityResult.ruleResults).toHaveLength(CANONICAL_RULE_IDS.length);
    expect(
      authorityResult.ruleResults.map(({ ruleId, status }) => ({
        ruleId,
        status,
      })),
    ).toEqual(CANONICAL_RULE_IDS.map((ruleId) => ({ ruleId, status: "PASS" })));

    const executorRequest = mapApprovedAuthorityResultToExecutorRequest(
      agentResult,
      authorityResult,
    );
    expect(Object.keys(executorRequest)).toEqual([
      "signedPaymentIntent",
      "ruleResults",
      "decisionReceipt",
      "authorizationReceipt",
    ]);
    expect(executorRequest.signedPaymentIntent).toBe(
      agentResult.signedPaymentIntent,
    );
    expect(executorRequest.ruleResults).toBe(authorityResult.ruleResults);
    expect(executorRequest.decisionReceipt).toBe(
      authorityResult.decisionReceipt,
    );
    if (authorityResult.status !== "APPROVED") {
      throw new Error("Expected approved authority result");
    }
    expect(executorRequest.authorizationReceipt).toBe(
      authorityResult.authorizationReceipt,
    );

    const simulation =
      await fixture.executor.simulateAuthorizedPayment(executorRequest);
    expect(simulation.status).toBe("SIMULATED");
    expect(fixture.transport.simulations).toHaveLength(1);
    expect(fixture.transport.submissions).toHaveLength(0);
    expectExactTransaction(fixture.transport.simulations[0]!, {
      vault: fixture.addresses.vault,
      data: simulation.execution.data,
    });

    const submission =
      await fixture.executor.executeAuthorizedPayment(executorRequest);
    expect(submission).toMatchObject({
      status: "SUBMITTED",
      transactionId: SIMULATED_SUBMISSION_ID,
    });
    expect(Object.keys(submission)).toEqual([
      "status",
      "execution",
      "transactionId",
    ]);
    expect(submission).not.toHaveProperty("transactionHash");
    expect(submission).not.toHaveProperty("receipt");
    expect(submission).not.toHaveProperty("confirmation");
    expect(submission).not.toHaveProperty("settlement");
    expect(fixture.transport.simulations).toHaveLength(2);
    expect(fixture.transport.submissions).toHaveLength(1);
    for (const simulated of fixture.transport.simulations) {
      expectExactTransaction(simulated, {
        vault: fixture.addresses.vault,
        data: submission.execution.data,
      });
    }
    expectExactTransaction(fixture.transport.submissions[0]!, {
      vault: fixture.addresses.vault,
      data: submission.execution.data,
    });
    expect(fixture.transport.simulations[1]).toEqual(
      fixture.transport.submissions[0],
    );
  });

  it("reconstructs calldata with bigint scalars equal to signed sources", async () => {
    const fixture = await createIntegrationFixture();
    const agentResult = await fixture.agent.proposePayment({
      signedInvoice: fixture.signedInvoice,
      procurementRequest: {
        productId: "gpu-h100-hour",
        expectedAmount: fixture.expectedAmount,
      },
    });
    const authorityResult =
      await fixture.authority.processPaymentRequest(agentResult);
    const request = mapApprovedAuthorityResultToExecutorRequest(
      agentResult,
      authorityResult,
    );
    const prepared = await fixture.executor.prepareExecution(request);
    const decoded = decodeFunctionData({
      abi: covenantVaultAbi as Abi,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("executePayment");
    const args = decoded.args as readonly [
      Record<string, unknown>,
      string,
      Record<string, unknown>,
      string,
    ];
    const intent = signedPaymentIntentSchema.parse(request.signedPaymentIntent);
    const authorization = signedAuthorizationReceiptSchema.parse(
      request.authorizationReceipt,
    );
    expect(args[0]).toMatchObject({
      amount: intent.payload.amount,
      createdAt: intent.payload.createdAt,
      expiresAt: intent.payload.expiresAt,
      nonce: intent.payload.nonce,
    });
    expect(args[1]).toBe(intent.signature);
    expect(args[2]).toMatchObject({
      chainId: authorization.payload.chainId,
      authorizationNonce: authorization.payload.authorizationNonce,
      validUntil: authorization.payload.validUntil,
    });
    expect(args[3]).toBe(authorization.signature);
    expect(intent.payload.amount).toBe(fixture.expectedAmountBaseUnits);
    expect(intent.payload.amount).toBe(EXPECTED_AMOUNT);
    for (const value of [
      args[0].amount,
      args[0].createdAt,
      args[0].expiresAt,
      args[0].nonce,
      args[2].chainId,
      args[2].authorizationNonce,
      args[2].validUntil,
    ]) {
      expect(typeof value).toBe("bigint");
    }
  });

  it("rejects the complete authority result at the strict executor boundary", async () => {
    const fixture = await createIntegrationFixture();
    const agentResult = await fixture.agent.proposePayment({
      signedInvoice: fixture.signedInvoice,
      procurementRequest: {
        productId: "gpu-h100-hour",
        expectedAmount: fixture.expectedAmount,
      },
    });
    const authorityResult =
      await fixture.authority.processPaymentRequest(agentResult);
    let failure: unknown;
    try {
      await fixture.executor.prepareExecution(authorityResult);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "MALFORMED_EXECUTION_REQUEST",
    });
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(agentResult.signedPaymentIntent.signature);
    expect(serialized).not.toContain("typedData");
    expect(serialized).not.toContain("stack");
    expect(fixture.transport.simulations).toHaveLength(0);
    expect(fixture.transport.submissions).toHaveLength(0);
  });

  it("keeps all configured identities distinct and canonical", async () => {
    const fixture = await createIntegrationFixture();
    const roleAddresses = [
      fixture.addresses.issuer,
      fixture.addresses.agent,
      fixture.addresses.authorization,
      fixture.addresses.vendor,
      fixture.addresses.attacker,
    ];
    expect(new Set(roleAddresses).size).toBe(roleAddresses.length);
    for (const address of Object.values(fixture.addresses)) {
      expect(getAddress(address)).toBe(address);
    }
  });

  it("exposes no override surface in the explicit executor handoff", async () => {
    const fixture = await createIntegrationFixture();
    const agentResult: AgentProposalResult = await fixture.agent.proposePayment(
      {
        signedInvoice: fixture.signedInvoice,
        procurementRequest: {
          productId: "gpu-h100-hour",
          expectedAmount: fixture.expectedAmount,
        },
      },
    );
    const authorityResult: ProcessResult =
      await fixture.authority.processPaymentRequest(agentResult);
    const request = mapApprovedAuthorityResultToExecutorRequest(
      agentResult,
      authorityResult,
    );
    expect(request).not.toHaveProperty("chainId");
    expect(request).not.toHaveProperty("target");
    expect(request).not.toHaveProperty("value");
    expect(request).not.toHaveProperty("functionName");
    expect(request).not.toHaveProperty("abi");
    expect(request).not.toHaveProperty("data");
    expect(Object.isFrozen(request)).toBe(true);
  });
});

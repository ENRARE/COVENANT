import {
  signedAuthorizationReceiptSchema,
  signedPaymentIntentSchema,
  EIP712_DOMAIN_NAMES,
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  deriveSigningDomainForCovenant,
} from "@covenant/spec";
import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  covenantVaultExecutePaymentAbi,
  EXECUTE_PAYMENT_SELECTOR,
  verifyExecutePaymentCalldata,
} from "../src/calldata/prepare-execute-payment.js";
import { cloneRequest, createTestHarness } from "./fixtures.js";

describe("executor preparation and exact call construction", () => {
  it("prepares the exact generated-ABI CovenantVault call", async () => {
    const harness = await createTestHarness();
    const prepared = await harness.service.prepareExecution(harness.request);
    expect(prepared).toMatchObject({
      chainId: 5_042_002n,
      target: harness.covenant.vaultAddress,
      value: 0n,
    });
    expect(prepared.data.slice(0, 10)).toBe(EXECUTE_PAYMENT_SELECTOR);
    const decoded = decodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      data: prepared.data,
    });
    expect(decoded.functionName).toBe("executePayment");
    const args = decoded.args as readonly [
      Record<string, unknown>,
      string,
      Record<string, unknown>,
      string,
    ];
    expect(args[0]).toMatchObject({
      version: harness.intent.version,
      intentId: harness.intent.intentId,
      covenantId: harness.intent.covenantId,
      agentSigner: harness.intent.agentSigner,
      recipient: harness.intent.recipient,
      token: harness.intent.token,
      amount: 1_250_000n,
      invoiceHash: harness.intent.invoiceHash,
      purpose: harness.intent.purpose,
      createdAt: BigInt(harness.intent.createdAt),
      expiresAt: BigInt(harness.intent.expiresAt),
      nonce: 0n,
    });
    expect(args[1]).toBe(harness.request.signedPaymentIntent.signature);
    expect(args[2]).toMatchObject({
      authorizationId: harness.authorizationReceipt.authorizationId,
      decisionId: harness.authorizationReceipt.decisionId,
      covenantId: harness.authorizationReceipt.covenantId,
      intentHash: harness.authorizationReceipt.intentHash,
      vaultAddress: harness.authorizationReceipt.vaultAddress,
      chainId: 5_042_002n,
      policyVersion: harness.authorizationReceipt.policyVersion,
      authorizationNonce: 0n,
      validUntil: BigInt(harness.authorizationReceipt.validUntil),
      signer: harness.authorizationReceipt.signer,
    });
    expect(args[3]).toBe(harness.request.authorizationReceipt.signature);
    expect(
      encodeFunctionData({
        abi: covenantVaultExecutePaymentAbi,
        functionName: decoded.functionName,
        args: decoded.args,
      }),
    ).toBe(prepared.data);
    expect(harness.clock.calls).toBe(1);
    expect(harness.transportState.simulations).toHaveLength(0);
    expect(harness.transportState.submissions).toHaveLength(0);
  });

  it("freezes the selector and tuple widths to the generated ABI", () => {
    expect(
      toFunctionSelector(
        "executePayment((string,bytes32,bytes32,address,address,address,uint256,bytes32,string,uint256,uint256,uint256),bytes,(string,bytes32,bytes32,bytes32,bytes32,address,uint256,string,uint256,uint256,address),bytes)",
      ),
    ).toBe("0x7ee0e4da");
    const item = covenantVaultExecutePaymentAbi[0];
    expect(item).toMatchObject({
      type: "function",
      name: "executePayment",
      stateMutability: "nonpayable",
    });
  });

  it("rejects every direct calldata mutation at the internal verification boundary", async () => {
    const harness = await createTestHarness();
    const prepared = await harness.service.prepareExecution(harness.request);
    const signedPaymentIntent = signedPaymentIntentSchema.parse(
      harness.request.signedPaymentIntent,
    );
    const signedAuthorizationReceipt = signedAuthorizationReceiptSchema.parse(
      harness.request.authorizationReceipt,
    );
    const decoded = decodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      data: prepared.data,
    });
    if (decoded.args === undefined) throw new Error("Expected decoded args");
    const validArgs = structuredClone(decoded.args) as [
      Record<string, unknown>,
      Hex,
      Record<string, unknown>,
      Hex,
    ];
    const alternateSignature: Hex = `0x${"ab".repeat(65)}`;
    const encodeAlternate = (
      mutate: (
        args: [Record<string, unknown>, Hex, Record<string, unknown>, Hex],
      ) => void,
    ) => {
      const args = structuredClone(validArgs);
      mutate(args);
      return encodeFunctionData({
        abi: covenantVaultExecutePaymentAbi,
        functionName: "executePayment",
        args,
      });
    };
    const mutations: [string, Hex][] = [
      ["changed selector", `0xdeadbeef${prepared.data.slice(10)}`],
      ["appended byte", `${prepared.data}00`],
      ["truncated byte", prepared.data.slice(0, -2) as Hex],
      [
        "changed PaymentIntent scalar",
        encodeAlternate((args) => {
          args[0].purpose = "Changed purpose";
        }),
      ],
      [
        "changed same-type PaymentIntent field",
        encodeAlternate((args) => {
          args[0].intentId = `0x${"bb".repeat(32)}`;
        }),
      ],
      [
        "changed intent signature",
        encodeAlternate((args) => {
          args[1] = alternateSignature;
        }),
      ],
      [
        "changed AuthorizationReceipt scalar",
        encodeAlternate((args) => {
          args[2].policyVersion = "gpu-policy-2";
        }),
      ],
      [
        "changed same-type AuthorizationReceipt field",
        encodeAlternate((args) => {
          args[2].authorizationId = `0x${"cc".repeat(32)}`;
        }),
      ],
      [
        "changed authorization signature",
        encodeAlternate((args) => {
          args[3] = alternateSignature;
        }),
      ],
      [
        "ERC-20 transfer",
        encodeFunctionData({
          abi: parseAbi(["function transfer(address,uint256)"]),
          functionName: "transfer",
          args: [harness.covenant.recipientAddress, 1n],
        }),
      ],
      [
        "ERC-20 approval",
        encodeFunctionData({
          abi: parseAbi(["function approve(address,uint256)"]),
          functionName: "approve",
          args: [harness.covenant.vaultAddress, 1n],
        }),
      ],
      [
        "representative multicall",
        encodeFunctionData({
          abi: parseAbi(["function multicall(bytes[])"]),
          functionName: "multicall",
          args: [[prepared.data]],
        }),
      ],
    ];

    for (const [name, data] of mutations) {
      let caught: unknown;
      try {
        verifyExecutePaymentCalldata({
          data,
          signedPaymentIntent,
          signedAuthorizationReceipt,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught, name).toMatchObject({ code: "EXECUTION_CALL_MISMATCH" });
    }
    expect(harness.transportState.simulations).toHaveLength(0);
    expect(harness.transportState.submissions).toHaveLength(0);
  });

  it("simulates and submits the same frozen scalar transaction object", async () => {
    const harness = await createTestHarness();
    const result = await harness.service.executeAuthorizedPayment(
      harness.request,
    );
    expect(result.status).toBe("SUBMITTED");
    expect(harness.clock.calls).toBe(2);
    expect(harness.transportState.simulations).toHaveLength(1);
    expect(harness.transportState.submissions).toHaveLength(1);
    expect(harness.transportState.submissions[0]).toBe(
      harness.transportState.simulations[0],
    );
    expect(Object.isFrozen(harness.transportState.submissions[0])).toBe(true);
  });

  it("keeps all decoded numeric fields as bigint", async () => {
    const harness = await createTestHarness();
    const prepared = await harness.service.prepareExecution(harness.request);
    const decoded = decodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      data: prepared.data,
    });
    const args = decoded.args as readonly [
      Record<string, unknown>,
      string,
      Record<string, unknown>,
      string,
    ];
    for (const field of ["amount", "createdAt", "expiresAt", "nonce"]) {
      expect(typeof args[0][field]).toBe("bigint");
    }
    for (const field of ["chainId", "authorizationNonce", "validUntil"]) {
      expect(typeof args[2][field]).toBe("bigint");
    }
  });

  it("rejects a modified and re-signed DecisionReceipt", async () => {
    const harness = await createTestHarness();
    const request = cloneRequest(harness.request);
    request.decisionReceipt.payload.decisionId = `0x${"99".repeat(32)}`;
    const domain = deriveSigningDomainForCovenant(
      harness.covenant,
      EIP712_DOMAIN_NAMES.decisionReceipt,
    );
    request.decisionReceipt.signature =
      await harness.accounts.authorization.signTypedData(
        buildDecisionReceiptTypedData(request.decisionReceipt.payload, domain),
      );
    await expect(
      harness.service.prepareExecution(request),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION_CHAIN" });
  });

  it("rejects a modified and re-signed AuthorizationReceipt", async () => {
    const harness = await createTestHarness();
    const request = cloneRequest(harness.request);
    request.authorizationReceipt.payload.authorizationNonce = "1";
    const domain = deriveSigningDomainForCovenant(
      harness.covenant,
      EIP712_DOMAIN_NAMES.authorizationReceipt,
    );
    request.authorizationReceipt.signature =
      await harness.accounts.authorization.signTypedData(
        buildAuthorizationReceiptTypedData(
          request.authorizationReceipt.payload,
          domain,
        ),
      );
    const prepared = await harness.service.prepareExecution(request);
    expect(prepared.executionId).not.toBe(
      (await harness.service.prepareExecution(harness.request)).executionId,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  EIP712_DOMAIN_NAMES,
  buildDecisionReceiptTypedData,
  deriveSigningDomainForCovenant,
  hashRuleResults,
} from "@covenant/spec";
import { cloneRequest, createTestHarness, TEST_NOW } from "./fixtures.js";
import {
  createExecutorService,
  type ExecutionRepository,
} from "../src/index.js";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected test object");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected test array");
  return value;
}

function setPath(
  value: unknown,
  path: readonly string[],
  replacement: unknown,
) {
  let target = record(value);
  for (const segment of path.slice(0, -1)) target = record(target[segment]);
  const final = path.at(-1);
  if (final === undefined) throw new Error("Mutation path is empty");
  target[final] = replacement;
}

function expectedChainMutationCode(name: string): string {
  switch (name) {
    case "wrong chain":
      return "MALFORMED_EXECUTION_REQUEST";
    case "wrong vault":
      return "EXECUTION_TARGET_MISMATCH";
    case "wrong token":
      return "EXECUTION_TOKEN_MISMATCH";
    case "wrong recipient":
      return "EXECUTION_RECIPIENT_MISMATCH";
    default:
      return "INVALID_AUTHORIZATION_CHAIN";
  }
}

function expectSafeExecutorError(
  error: unknown,
  code: string,
  message: string,
  secrets: readonly string[],
): void {
  expect(error).toMatchObject({ code, message });
  expect(error).not.toHaveProperty("cause");
  expect(error).not.toHaveProperty("stack");
  const serialized = JSON.stringify(error);
  expect(serialized).toBe(
    JSON.stringify({ name: "ExecutorError", code, message }),
  );
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

describe("strict executor boundaries", () => {
  it.each([
    ["outer", ["target"]],
    ["intent envelope", ["signedPaymentIntent", "target"]],
    ["intent payload", ["signedPaymentIntent", "payload", "target"]],
    ["decision envelope", ["decisionReceipt", "target"]],
    ["authorization payload", ["authorizationReceipt", "payload", "target"]],
  ] as const)(
    "rejects an unknown %s field before dependencies",
    async (_name, path) => {
      const harness = await createTestHarness();
      const request: unknown = cloneRequest(harness.request);
      setPath(request, path, "bad");
      await expect(
        harness.service.prepareExecution(request),
      ).rejects.toMatchObject({ code: "MALFORMED_EXECUTION_REQUEST" });
      expect(harness.provider.calls).toBe(0);
      expect(harness.clock.calls).toBe(0);
    },
  );

  it("rejects an unknown RuleResult field before dependencies", async () => {
    const harness = await createTestHarness();
    const request: unknown = cloneRequest(harness.request);
    const rules = array(record(request).ruleResults);
    record(rules[0]).target = "bad";
    await expect(
      harness.service.prepareExecution(request),
    ).rejects.toMatchObject({ code: "MALFORMED_EXECUTION_REQUEST" });
    expect(harness.provider.calls).toBe(0);
  });

  it.each(["missing", "duplicate", "reordered", "extra"] as const)(
    "rejects %s canonical rules with no side effects",
    async (kind) => {
      const harness = await createTestHarness();
      const request: unknown = cloneRequest(harness.request);
      const rules = array(record(request).ruleResults);
      const first = rules[0];
      const second = rules[1];
      if (first === undefined || second === undefined)
        throw new Error("Canonical rule fixture is incomplete");
      if (kind === "missing") rules.pop();
      if (kind === "duplicate") rules[1] = structuredClone(first);
      if (kind === "reordered") [rules[0], rules[1]] = [second, first];
      if (kind === "extra") rules.push(structuredClone(first));
      await expect(
        harness.service.executeAuthorizedPayment(request),
      ).rejects.toMatchObject({ code: "MALFORMED_EXECUTION_REQUEST" });
      expect(harness.transportState.simulations).toHaveLength(0);
      expect(harness.transportState.submissions).toHaveLength(0);
    },
  );

  it.each([
    [
      "wrong covenant",
      ["signedPaymentIntent", "payload", "covenantId"],
      `0x${"aa".repeat(32)}`,
    ],
    [
      "wrong signer",
      ["signedPaymentIntent", "payload", "agentSigner"],
      "0x9000000000000000000000000000000000000009",
    ],
    [
      "wrong recipient",
      ["signedPaymentIntent", "payload", "recipient"],
      "0x9000000000000000000000000000000000000009",
    ],
    [
      "wrong token",
      ["signedPaymentIntent", "payload", "token"],
      "0x9000000000000000000000000000000000000009",
    ],
    ["wrong purpose", ["signedPaymentIntent", "payload", "purpose"], "other"],
    ["wrong amount", ["signedPaymentIntent", "payload", "amount"], "2"],
    [
      "wrong decision",
      ["authorizationReceipt", "payload", "decisionId"],
      `0x${"ab".repeat(32)}`,
    ],
    [
      "wrong authorization",
      ["authorizationReceipt", "payload", "intentHash"],
      `0x${"ac".repeat(32)}`,
    ],
    [
      "wrong vault",
      ["authorizationReceipt", "payload", "vaultAddress"],
      "0x9000000000000000000000000000000000000009",
    ],
    ["wrong chain", ["authorizationReceipt", "payload", "chainId"], "1"],
    [
      "wrong policy version",
      ["authorizationReceipt", "payload", "policyVersion"],
      "gpu-policy-2",
    ],
  ] as const)(
    "rejects a %s chain mutation before transport",
    async (_name, path, replacement) => {
      const harness = await createTestHarness();
      const request: unknown = cloneRequest(harness.request);
      setPath(request, path, replacement);
      await expect(
        harness.service.executeAuthorizedPayment(request),
      ).rejects.toMatchObject({
        code: expectedChainMutationCode(_name),
      });
      expect(harness.transportState.simulations).toHaveLength(0);
      expect(harness.transportState.submissions).toHaveLength(0);
    },
  );

  it("rejects a PaymentIntent signature created under the wrong domain", async () => {
    const {
      EIP712_DOMAIN_NAMES,
      buildPaymentIntentTypedData,
      deriveSigningDomainForCovenant,
    } = await import("@covenant/spec");
    const harness = await createTestHarness();
    const request = cloneRequest(harness.request);
    const wrongCovenant = {
      ...harness.covenant,
      vaultAddress: "0x9000000000000000000000000000000000000009",
    };
    const wrongDomain = deriveSigningDomainForCovenant(
      wrongCovenant,
      EIP712_DOMAIN_NAMES.paymentIntent,
    );
    request.signedPaymentIntent.signature =
      await harness.accounts.agent.signTypedData(
        buildPaymentIntentTypedData(
          request.signedPaymentIntent.payload,
          wrongDomain,
        ),
      );
    await expect(
      harness.service.prepareExecution(request),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION_CHAIN" });
  });

  it("rejects cross-intent and cross-decision object swaps", async () => {
    const first = await createTestHarness();
    const second = await createTestHarness();
    await expect(
      first.service.prepareExecution({
        ...first.request,
        signedPaymentIntent: second.request.signedPaymentIntent,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION_CHAIN" });
    await expect(
      first.service.prepareExecution({
        ...first.request,
        decisionReceipt: second.request.decisionReceipt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION_CHAIN" });
  });

  it("rejects a cross-request AuthorizationReceipt before coordination or transport", async () => {
    const first = await createTestHarness();
    const second = await createTestHarness();
    const repositoryCalls = { simulations: 0, executions: 0 };
    const repository: ExecutionRepository = {
      coordinateSimulation: (_id, operation) => {
        repositoryCalls.simulations += 1;
        return operation();
      },
      coordinateExecution: (_id, operation) => {
        repositoryCalls.executions += 1;
        return operation();
      },
    };
    const service = createExecutorService({
      ...first.dependencies,
      executionRepository: repository,
    });
    await expect(
      service.executeAuthorizedPayment({
        ...first.request,
        authorizationReceipt: second.request.authorizationReceipt,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION_CHAIN" });
    expect(repositoryCalls).toEqual({ simulations: 0, executions: 0 });
    expect(first.transportState.simulations).toHaveLength(0);
    expect(first.transportState.submissions).toHaveLength(0);
  });

  it.each([
    ["authenticated rejection", "REJECTED", "FAIL", "DECISION_NOT_APPROVED"],
    ["inconsistent approved rules", "APPROVED", "FAIL", "RULES_NOT_APPROVED"],
  ] as const)(
    "maps %s to its stable executor error",
    async (_name, decisionStatus, ruleStatus, expectedCode) => {
      const harness = await createTestHarness();
      const request: unknown = cloneRequest(harness.request);
      const rules = array(record(request).ruleResults);
      const firstRule = record(rules[0]);
      firstRule.status = ruleStatus;
      firstRule.actual = "failed";
      firstRule.reason = "covenant_active failed";
      const decisionEnvelope = record(record(request).decisionReceipt);
      const decisionPayload = record(decisionEnvelope.payload);
      decisionPayload.decision = decisionStatus;
      decisionPayload.ruleResultsHash = hashRuleResults(rules);
      const domain = deriveSigningDomainForCovenant(
        harness.covenant,
        EIP712_DOMAIN_NAMES.decisionReceipt,
      );
      decisionEnvelope.signature =
        await harness.accounts.authorization.signTypedData(
          buildDecisionReceiptTypedData(decisionPayload, domain),
        );
      await expect(
        harness.service.executeAuthorizedPayment(request),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(harness.transportState.simulations).toHaveLength(0);
      expect(harness.transportState.submissions).toHaveLength(0);
    },
  );

  it.each([
    ["expired Covenant", TEST_NOW + 1_000n],
    ["future Covenant", TEST_NOW - 101n],
    ["expired intent", TEST_NOW + 600n],
    ["future intent", TEST_NOW - 11n],
    ["future decision", TEST_NOW - 6n],
    ["expired authorization", TEST_NOW + 300n],
  ] as const)(
    "rejects %s at the current-time boundary",
    async (_name, currentTime) => {
      const harness = await createTestHarness();
      harness.clock.value = currentTime;
      await expect(
        harness.service.prepareExecution(harness.request),
      ).rejects.toMatchObject({ code: "EXECUTION_EXPIRED" });
    },
  );

  it("sanitizes malformed Covenant results and provider exceptions identically", async () => {
    const first = await createTestHarness();
    const second = await createTestHarness();
    first.dependencies.covenantProvider.getCovenant = () =>
      Promise.resolve({ secret: "provider-secret" });
    second.dependencies.covenantProvider.getCovenant = () =>
      Promise.reject(new Error("provider-secret"));
    for (const harness of [first, second]) {
      let caught: unknown;
      try {
        await harness.service.prepareExecution(harness.request);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "COVENANT_PROVIDER_FAILURE",
        message: "Trusted Covenant provider failed",
      });
      expect(caught).not.toHaveProperty("cause");
      expect(caught).not.toHaveProperty("stack");
      expect(JSON.stringify(caught)).not.toContain("provider-secret");
    }
  });

  it.each(["exception", "malformed"] as const)(
    "sanitizes %s clock output",
    async (kind) => {
      const harness = await createTestHarness();
      harness.dependencies.clock.now = () => {
        if (kind === "exception")
          throw new Error("clock-secret https://clock.invalid");
        return "2000000000";
      };
      const service = createExecutorService(harness.dependencies);
      let caught: unknown;
      try {
        await service.prepareExecution(harness.request);
      } catch (error) {
        caught = error;
      }
      expectSafeExecutorError(
        caught,
        "CLOCK_FAILURE",
        "Executor clock failed",
        [
          "clock-secret",
          "https://clock.invalid",
          harness.request.signedPaymentIntent.signature,
        ],
      );
      expect(harness.transportState.simulations).toHaveLength(0);
      expect(harness.transportState.submissions).toHaveLength(0);
    },
  );

  it.each(["exception", "malformed"] as const)(
    "sanitizes %s simulation output",
    async (kind) => {
      const harness = await createTestHarness();
      if (kind === "exception") {
        harness.transportState.simulationError = new Error(
          "simulation-secret https://rpc.invalid",
        );
      } else {
        harness.transportState.simulationResult = {
          status: "SIMULATED",
          response: "simulation-secret",
        };
      }
      let caught: unknown;
      try {
        await harness.service.simulateAuthorizedPayment(harness.request);
      } catch (error) {
        caught = error;
      }
      expectSafeExecutorError(
        caught,
        "SIMULATION_FAILURE",
        "Authorized transaction simulation failed",
        [
          "simulation-secret",
          "https://rpc.invalid",
          harness.request.signedPaymentIntent.signature,
        ],
      );
      expect(harness.transportState.simulations).toHaveLength(1);
      expect(harness.transportState.submissions).toHaveLength(0);
    },
  );

  it("rejects caller transaction and calldata override attempts as unknown fields", async () => {
    const fields = [
      "recipient",
      "token",
      "amount",
      "vault",
      "chainId",
      "functionName",
      "abi",
      "calldata",
      "value",
      "erc20Transfer",
      "approval",
      "multicall",
      "appendedCalldata",
      "truncatedCalldata",
    ];
    for (const field of fields) {
      const harness = await createTestHarness();
      await expect(
        harness.service.prepareExecution({
          ...harness.request,
          [field]: "0xdeadbeef",
        }),
      ).rejects.toMatchObject({ code: "MALFORMED_EXECUTION_REQUEST" });
      expect(harness.provider.calls).toBe(0);
    }
  });
});

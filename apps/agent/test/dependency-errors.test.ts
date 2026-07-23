import { AgentError, createAgentService } from "../src/index.js";
import { describe, expect, it } from "vitest";
import {
  CountingReservationRepository,
  createAgentHarness,
} from "./fixtures.js";

function expectSanitized(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(AgentError);
  expect(error).toMatchObject({ code });
  expect((error as AgentError).stack).toBeUndefined();
  expect((error as AgentError).toJSON()).toEqual({
    name: "AgentError",
    code,
    message: (error as AgentError).message,
  });
  const serialized = JSON.stringify(error);
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("stack");
  expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
    "name",
    "code",
    "message",
  ]);
}

describe("sanitized injected dependency boundary", () => {
  it("suppresses stack access on the public AgentError contract", () => {
    const error = new AgentError("CLOCK_FAILURE");
    expect(error.stack).toBeUndefined();
    expect(error.toJSON()).toEqual({
      name: "AgentError",
      code: "CLOCK_FAILURE",
      message: "Agent clock failed",
    });
    expect(Object.keys(error.toJSON())).toEqual(["name", "code", "message"]);
    expect(JSON.stringify(error)).toBe(
      '{"name":"AgentError","code":"CLOCK_FAILURE","message":"Agent clock failed"}',
    );
  });

  it.each([
    ["approved vendor", { approvedVendor: "secret-invalid" }],
    ["approved product", { approvedProductId: "gpu-a100-hour" }],
    ["intent TTL", { intentTtlSeconds: 601n }],
  ])("strictly rejects invalid %s configuration", async (_label, override) => {
    const harness = await createAgentHarness();
    let caught: unknown;
    try {
      createAgentService({
        ...harness.dependencies,
        ...override,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "CONFIGURATION_INVALID" });
  });

  it("sanitizes Covenant provider exceptions", async () => {
    const harness = await createAgentHarness();
    const service = createAgentService({
      ...harness.dependencies,
      covenantProvider: {
        getCovenant: () =>
          Promise.reject(new Error("secret provider URL and response")),
      },
    });
    let caught: unknown;
    try {
      await service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "COVENANT_PROVIDER_FAILURE");
  });

  it("sanitizes malformed Covenant output", async () => {
    const harness = await createAgentHarness();
    const service = createAgentService({
      ...harness.dependencies,
      covenantProvider: {
        getCovenant: () =>
          Promise.resolve({ ...harness.covenant, chainId: "1" }),
      },
    });
    let caught: unknown;
    try {
      await service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "COVENANT_INVALID");
  });

  it.each([
    [
      "exception",
      () => {
        throw new Error("secret clock");
      },
    ],
    ["malformed output", () => "2000000000"],
  ])("sanitizes clock %s", async (_label, now) => {
    const harness = await createAgentHarness({
      clock: { value: 0n, now },
    });
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "CLOCK_FAILURE");
    expect(harness.counts).toMatchObject({
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("sanitizes signer address exceptions", async () => {
    const harness = await createAgentHarness();
    const signer = {
      get address(): unknown {
        throw new Error("secret signer adapter");
      },
      signPaymentIntent: () => Promise.resolve(`0x${"00".repeat(65)}`),
    };
    const service = createAgentService({ ...harness.dependencies, signer });
    let caught: unknown;
    try {
      await service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "SIGNER_ADDRESS_FAILURE");
  });

  it.each([
    ["exception", () => Promise.reject(new Error("secret identifier"))],
    ["malformed output", () => Promise.resolve("not-bytes32")],
  ])("sanitizes identifier %s", async (_label, createId) => {
    const harness = await createAgentHarness({
      identifierGenerator: { createId },
    });
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "IDENTIFIER_GENERATION_FAILURE");
    expect(harness.counts).toMatchObject({ signer: 0, completion: 0 });
  });

  it("sanitizes reservation failures", async () => {
    const harness = await createAgentHarness({
      reservationRepository: {
        get: () => Promise.resolve(undefined),
        reserve: () =>
          Promise.reject(new Error("secret repository state and URL")),
        storeCompleted: () => Promise.resolve(undefined),
      },
    });
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "RESERVATION_REPOSITORY_FAILURE");
  });

  it.each([
    ["exception", new Error("secret signing adapter")],
    ["timeout-shaped exception", new Error("ETIMEDOUT secret endpoint")],
  ])("sanitizes signer %s", async (_label, failure) => {
    const harness = await createAgentHarness();
    harness.signer.failure = failure;
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "PAYMENT_INTENT_SIGNING_FAILURE");
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      completion: 0,
    });
  });

  it("sanitizes malformed signer output", async () => {
    const harness = await createAgentHarness();
    harness.signer.output = "secret malformed signature";
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "PAYMENT_INTENT_SIGNING_FAILURE");
  });

  it("sanitizes completion storage failure", async () => {
    const delegate = new CountingReservationRepository();
    const harness = await createAgentHarness({
      reservationRepository: {
        get: (identity) => delegate.get(identity),
        reserve: (identity, create) => delegate.reserve(identity, create),
        storeCompleted: () =>
          Promise.reject(new Error("secret completion state")),
      },
    });
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "RESERVATION_REPOSITORY_FAILURE");
  });

  it("sanitizes proposal repository failure before callback invocation", async () => {
    const harness = await createAgentHarness({
      proposalRepository: {
        coordinate: () =>
          Promise.reject(new Error("secret coordination state")),
      },
    });
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSanitized(caught, "PROPOSAL_REPOSITORY_FAILURE");
    expect(harness.counts).toMatchObject({
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });
});

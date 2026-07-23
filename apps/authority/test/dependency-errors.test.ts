import { describe, expect, it } from "vitest";
import {
  AUTHORITY_ERROR_MESSAGES,
  AuthorityError,
  createAuthorityService,
  type AuthorityDependencies,
  type AuthorityErrorCode,
} from "../src/index.js";
import { authorizationInput, createTestHarness } from "./fixtures.js";

const SECRET = "adapter-secret-12345";

async function sanitizedFailure(
  operation: () => Promise<unknown>,
  code: AuthorityErrorCode,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AuthorityError);
  expect(caught).toMatchObject({
    code,
    message: AUTHORITY_ERROR_MESSAGES[code],
  });
  const serialized = JSON.stringify(caught);
  expect(serialized).not.toContain(SECRET);
  expect(serialized.toLowerCase()).not.toContain("stack");
  expect(serialized.toLowerCase()).not.toContain("typeddata");
  expect(serialized.toLowerCase()).not.toContain("signature");
}

describe("sanitized injected dependency boundary", () => {
  it.each([
    [
      "Covenant provider",
      "COVENANT_PROVIDER_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        covenantProvider: {
          getCovenant: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
    [
      "clock",
      "CLOCK_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        clock: {
          now: () => {
            throw new Error(SECRET);
          },
        },
      }),
    ],
    [
      "evidence reader",
      "EVIDENCE_READER_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        evidenceReader: {
          ...dependencies.evidenceReader,
          readEvidence: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
    [
      "signer address",
      "SIGNER_ADDRESS_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        signer: {
          get address() {
            throw new Error(SECRET);
          },
          signDecisionReceipt: dependencies.signer.signDecisionReceipt.bind(
            dependencies.signer,
          ),
          signAuthorizationReceipt:
            dependencies.signer.signAuthorizationReceipt.bind(
              dependencies.signer,
            ),
        },
      }),
    ],
    [
      "decision identifier generator",
      "IDENTIFIER_GENERATION_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        identifierGenerator: {
          createId: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
    [
      "decision signer",
      "DECISION_SIGNING_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        signer: {
          address: dependencies.signer.address,
          signDecisionReceipt: () => Promise.reject(new Error(SECRET)),
          signAuthorizationReceipt:
            dependencies.signer.signAuthorizationReceipt.bind(
              dependencies.signer,
            ),
        },
      }),
    ],
    [
      "approved decision repository",
      "DECISION_REPOSITORY_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        decisionRepository: {
          getOrCreate: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
  ] as const)(
    "%s failures are stable and secret-free",
    async (_name, code, edit) => {
      const harness = await createTestHarness();
      const service = createAuthorityService(edit(harness.dependencies));
      await sanitizedFailure(
        () => service.evaluatePaymentRequest(harness.request),
        code,
      );
    },
  );

  it.each([
    [
      "authorization identifier generator",
      "IDENTIFIER_GENERATION_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        identifierGenerator: {
          createId: (kind: "decision" | "authorization", context: string) =>
            kind === "authorization"
              ? Promise.reject(new Error(`${SECRET}:${context}`))
              : dependencies.identifierGenerator.createId(kind, context),
        },
      }),
    ],
    [
      "authorization signer",
      "AUTHORIZATION_SIGNING_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        signer: {
          address: dependencies.signer.address,
          signDecisionReceipt: dependencies.signer.signDecisionReceipt.bind(
            dependencies.signer,
          ),
          signAuthorizationReceipt: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
    [
      "authorization repository",
      "AUTHORIZATION_REPOSITORY_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        authorizationRepository: {
          getOrCreate: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
    [
      "nonce repository",
      "NONCE_REPOSITORY_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        nonceRepository: {
          reserve: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
    [
      "authorization nonce evidence",
      "EVIDENCE_READER_FAILURE",
      (dependencies: AuthorityDependencies) => ({
        ...dependencies,
        evidenceReader: {
          ...dependencies.evidenceReader,
          isAuthorizationNonceUsed: () => Promise.reject(new Error(SECRET)),
        },
      }),
    ],
  ] as const)(
    "%s failures are stable and secret-free",
    async (_name, code, edit) => {
      const harness = await createTestHarness();
      const approved = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      const service = createAuthorityService(edit(harness.dependencies));
      await sanitizedFailure(
        () =>
          service.issueAuthorization(
            authorizationInput(harness.request, approved),
          ),
        code,
      );
    },
  );

  it("sanitizes identifier failure while issuing a rejected decision", async () => {
    const harness = await createTestHarness();
    harness.evidence.revoked = true;
    const service = createAuthorityService({
      ...harness.dependencies,
      identifierGenerator: {
        createId: () => Promise.reject(new Error(SECRET)),
      },
    });
    await sanitizedFailure(
      () => service.evaluatePaymentRequest(harness.request),
      "IDENTIFIER_GENERATION_FAILURE",
    );
    expect(harness.signer.decisionCalls).toBe(0);
  });
});

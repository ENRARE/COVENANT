import { describe, expect, it } from "vitest";
import { FROZEN_SIGNED_FIELD_NAMES } from "../src/constants.js";
import {
  CovenantVerificationError,
  type VerificationErrorCode,
} from "../src/errors.js";
import {
  authorizationReceiptDomainFixture,
  covenantSpecDomainFixture,
  decisionReceiptDomainFixture,
  expectedVectorHashes,
  fixtureAddresses,
  invoiceDomainFixture,
  paymentIntentDomainFixture,
  rawApprovedDecisionReceiptFixture,
  rawApprovedRuleResultsFixture,
  rawAuthorizationReceiptFixture,
  rawCovenantSpecFixture,
  rawInvoiceFixture,
  rawPaymentIntentFixture,
} from "../src/fixtures.js";
import {
  AUTHORIZATION_RECEIPT_SCHEMA_FIELD_NAMES,
  COVENANT_SPEC_SCHEMA_FIELD_NAMES,
  DECISION_RECEIPT_SCHEMA_FIELD_NAMES,
  INVOICE_SCHEMA_FIELD_NAMES,
  PAYMENT_INTENT_SCHEMA_FIELD_NAMES,
} from "../src/schemas.js";
import {
  AUTHORIZATION_RECEIPT_EIP712_FIELDS,
  COVENANT_SPEC_EIP712_FIELDS,
  DECISION_RECEIPT_EIP712_FIELDS,
  INVOICE_EIP712_FIELDS,
  PAYMENT_INTENT_EIP712_FIELDS,
  buildAuthorizationReceiptTypedData,
  buildCovenantSpecTypedData,
  buildDecisionReceiptTypedData,
  buildInvoiceTypedData,
  buildPaymentIntentTypedData,
  hashAuthorizationReceipt,
  hashCovenantSpec,
  hashDecisionReceipt,
  hashInvoice,
  hashPaymentIntent,
  hashPaymentIntentStruct,
  hashAuthorizationReceiptStruct,
  hashSigningDomain,
  hashRuleResult,
  hashRuleResults,
  validateSigningDomainForCovenant,
} from "../src/typed-data.js";

const signedBoundaries = [
  [
    buildCovenantSpecTypedData,
    hashCovenantSpec,
    rawCovenantSpecFixture,
    covenantSpecDomainFixture,
  ],
  [
    buildPaymentIntentTypedData,
    hashPaymentIntent,
    rawPaymentIntentFixture,
    paymentIntentDomainFixture,
  ],
  [buildInvoiceTypedData, hashInvoice, rawInvoiceFixture, invoiceDomainFixture],
  [
    buildDecisionReceiptTypedData,
    hashDecisionReceipt,
    rawApprovedDecisionReceiptFixture,
    decisionReceiptDomainFixture,
  ],
  [
    buildAuthorizationReceiptTypedData,
    hashAuthorizationReceipt,
    rawAuthorizationReceiptFixture,
    authorizationReceiptDomainFixture,
  ],
] as const;

function expectVerificationCode(
  operation: () => unknown,
  code: VerificationErrorCode,
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CovenantVerificationError);
    if (!(error instanceof CovenantVerificationError)) throw error;
    expect(error.code).toBe(code);
  }
}

describe("strict parse-before-hash boundaries", () => {
  it.each(signedBoundaries)(
    "rejects unknown payload fields in builder and hash",
    (build, hash, payload, domain) => {
      const malformed = { ...payload, executeNow: true };
      expect(() => build(malformed, domain)).toThrow();
      expect(() => hash(malformed, domain)).toThrow();
    },
  );

  it.each(signedBoundaries)(
    "rejects malformed addresses, unsupported versions, and invalid domains",
    (build, hash, payload, domain) => {
      const addressField = Object.keys(payload).find(
        (field) =>
          field.toLowerCase().includes("signer") ||
          field.toLowerCase().includes("address") ||
          field === "recipient" ||
          field === "vendor",
      );
      if (!addressField)
        throw new Error("fixture must contain an address field");
      expect(() =>
        build({ ...payload, [addressField]: "bad" }, domain),
      ).toThrow();
      expect(() => hash({ ...payload, version: "2" }, domain)).toThrow();
      expect(() => build(payload, { ...domain, chainId: "1" })).toThrow();
      expect(() => hash(payload, { ...domain, unknown: true })).toThrow();
    },
  );

  it("rejects malformed hashes, decimal numbers, and nested rule fields", () => {
    expect(() =>
      hashPaymentIntent(
        { ...rawPaymentIntentFixture, invoiceHash: "0x12" },
        paymentIntentDomainFixture,
      ),
    ).toThrow();
    expect(() =>
      hashPaymentIntent(
        { ...rawPaymentIntentFixture, amount: 1.25 },
        paymentIntentDomainFixture,
      ),
    ).toThrow();
    expect(() =>
      hashRuleResult({ ...rawApprovedRuleResultsFixture[0], hidden: true }),
    ).toThrow();
    const nested = rawApprovedRuleResultsFixture.map((rule) => ({ ...rule }));
    (nested[0] as Record<string, unknown>).executeNow = true;
    expect(() => hashRuleResults(nested)).toThrow();
  });

  it("directly validates both exported RuleResult hash functions", () => {
    expect(hashRuleResult(rawApprovedRuleResultsFixture[0])).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
    expect(hashRuleResults(rawApprovedRuleResultsFixture)).toBe(
      expectedVectorHashes.approvedRuleResults,
    );
    expect(() => hashRuleResult(null)).toThrow();
    expect(() => hashRuleResults(null)).toThrow();
  });
});

describe("schema and EIP-712 field parity", () => {
  it.each([
    [
      COVENANT_SPEC_SCHEMA_FIELD_NAMES,
      COVENANT_SPEC_EIP712_FIELDS,
      FROZEN_SIGNED_FIELD_NAMES.covenantSpec,
    ],
    [
      PAYMENT_INTENT_SCHEMA_FIELD_NAMES,
      PAYMENT_INTENT_EIP712_FIELDS,
      FROZEN_SIGNED_FIELD_NAMES.paymentIntent,
    ],
    [
      INVOICE_SCHEMA_FIELD_NAMES,
      INVOICE_EIP712_FIELDS,
      FROZEN_SIGNED_FIELD_NAMES.invoice,
    ],
    [
      DECISION_RECEIPT_SCHEMA_FIELD_NAMES,
      DECISION_RECEIPT_EIP712_FIELDS,
      FROZEN_SIGNED_FIELD_NAMES.decisionReceipt,
    ],
    [
      AUTHORIZATION_RECEIPT_SCHEMA_FIELD_NAMES,
      AUTHORIZATION_RECEIPT_EIP712_FIELDS,
      FROZEN_SIGNED_FIELD_NAMES.authorizationReceipt,
    ],
  ] as const)(
    "matches the schema and EIP-712 fields to the independent frozen list",
    (schemaNames, fields, frozenNames) => {
      expect(schemaNames).toEqual(frozenNames);
      expect(fields.map(({ name }) => name)).toEqual(frozenNames);
      expect(new Set(fields.map(({ name }) => name)).size).toBe(fields.length);
    },
  );

  it("constructs deterministically independent of property order", () => {
    const reversed = Object.fromEntries(
      Object.entries(rawPaymentIntentFixture).reverse(),
    );
    expect(
      buildPaymentIntentTypedData(reversed, paymentIntentDomainFixture),
    ).toEqual(
      buildPaymentIntentTypedData(
        rawPaymentIntentFixture,
        paymentIntentDomainFixture,
      ),
    );
  });
});

describe("signed-field mutation coverage", () => {
  const covenantMutations: Record<string, unknown> = {
    covenantId: `0x${"10".repeat(32)}`,
    issuer: fixtureAddresses.vendor,
    agentSigner: fixtureAddresses.attacker,
    authorizationSigner: fixtureAddresses.vendor,
    tokenAddress: fixtureAddresses.attacker,
    recipientAddress: "0x8000000000000000000000000000000000000008",
    maxAmountPerPayment: "4000",
    totalBudget: "11000",
    maxPaymentCount: "3",
    validAfter: "1784563210",
    validUntil: "1785167990",
    purpose: "Changed purpose",
    policyHash: `0x${"11".repeat(32)}`,
    policyVersion: "gpu-policy-2",
    createdAt: "1784563130",
  };
  const paymentMutations: Record<string, unknown> = {
    intentId: `0x${"12".repeat(32)}`,
    covenantId: `0x${"13".repeat(32)}`,
    agentSigner: fixtureAddresses.vendor,
    recipient: fixtureAddresses.attacker,
    token: fixtureAddresses.attacker,
    amount: "2",
    invoiceHash: `0x${"14".repeat(32)}`,
    purpose: "Changed purpose",
    createdAt: "1784563270",
    expiresAt: "1784563550",
    nonce: "2",
  };
  const invoiceMutations: Record<string, unknown> = {
    invoiceId: `0x${"15".repeat(32)}`,
    vendor: fixtureAddresses.issuer,
    recipient: fixtureAddresses.attacker,
    token: fixtureAddresses.attacker,
    amount: "2",
    productId: "gpu-h100-hour",
    purpose: "Changed purpose",
    issuedAt: "1784563210",
    expiresAt: "1784563490",
    nonce: "2",
  };
  const decisionMutations: Record<string, unknown> = {
    decisionId: `0x${"16".repeat(32)}`,
    covenantId: `0x${"17".repeat(32)}`,
    intentId: `0x${"18".repeat(32)}`,
    intentHash: `0x${"19".repeat(32)}`,
    decision: "REJECTED",
    ruleResultsHash: `0x${"20".repeat(32)}`,
    policyVersion: "gpu-policy-2",
    createdAt: "1784563301",
    signer: fixtureAddresses.issuer,
  };
  const authorizationMutations: Record<string, unknown> = {
    authorizationId: `0x${"21".repeat(32)}`,
    decisionId: `0x${"22".repeat(32)}`,
    covenantId: `0x${"23".repeat(32)}`,
    intentHash: `0x${"24".repeat(32)}`,
    policyVersion: "gpu-policy-2",
    authorizationNonce: "2",
    validUntil: "1784563430",
    signer: fixtureAddresses.issuer,
  };

  it.each(Object.entries(covenantMutations))(
    "CovenantSpec.%s changes its digest",
    (field, value) => {
      expect(
        hashCovenantSpec(
          { ...rawCovenantSpecFixture, [field]: value },
          covenantSpecDomainFixture,
        ),
      ).not.toBe(expectedVectorHashes.covenantSpec);
    },
  );

  it("CovenantSpec.vaultAddress and AuthorizationReceipt.vaultAddress change with their domain", () => {
    const domain = {
      ...covenantSpecDomainFixture,
      verifyingContract: fixtureAddresses.attacker,
    };
    expect(
      hashCovenantSpec(
        { ...rawCovenantSpecFixture, vaultAddress: fixtureAddresses.attacker },
        domain,
      ),
    ).not.toBe(expectedVectorHashes.covenantSpec);
    expect(
      hashAuthorizationReceipt(
        {
          ...rawAuthorizationReceiptFixture,
          vaultAddress: fixtureAddresses.attacker,
        },
        {
          ...authorizationReceiptDomainFixture,
          verifyingContract: fixtureAddresses.attacker,
        },
      ),
    ).not.toBe(expectedVectorHashes.authorizationReceipt);
  });

  it.each(Object.entries(paymentMutations))(
    "PaymentIntent.%s changes its digest",
    (field, value) => {
      expect(
        hashPaymentIntent(
          { ...rawPaymentIntentFixture, [field]: value },
          paymentIntentDomainFixture,
        ),
      ).not.toBe(expectedVectorHashes.paymentIntent);
    },
  );
  it.each(Object.entries(invoiceMutations))(
    "Invoice.%s changes its digest",
    (field, value) => {
      expect(
        hashInvoice(
          { ...rawInvoiceFixture, [field]: value },
          invoiceDomainFixture,
        ),
      ).not.toBe(expectedVectorHashes.invoice);
    },
  );
  it.each(Object.entries(decisionMutations))(
    "DecisionReceipt.%s changes its digest",
    (field, value) => {
      expect(
        hashDecisionReceipt(
          { ...rawApprovedDecisionReceiptFixture, [field]: value },
          decisionReceiptDomainFixture,
        ),
      ).not.toBe(expectedVectorHashes.approvedDecisionReceipt);
    },
  );
  it.each(Object.entries(authorizationMutations))(
    "AuthorizationReceipt.%s changes its digest",
    (field, value) => {
      expect(
        hashAuthorizationReceipt(
          { ...rawAuthorizationReceiptFixture, [field]: value },
          authorizationReceiptDomainFixture,
        ),
      ).not.toBe(expectedVectorHashes.authorizationReceipt);
    },
  );

  it("rejects immutable MVP version and chain mutations", () => {
    for (const [, hash, payload, domain] of signedBoundaries) {
      expect(() => hash({ ...payload, version: "2" }, domain)).toThrow();
    }
    expect(() =>
      hashCovenantSpec(
        { ...rawCovenantSpecFixture, chainId: "1" },
        covenantSpecDomainFixture,
      ),
    ).toThrow();
    expect(() =>
      hashAuthorizationReceipt(
        { ...rawAuthorizationReceiptFixture, chainId: "1" },
        authorizationReceiptDomainFixture,
      ),
    ).toThrow();
  });
});

describe("domain separation and vectors", () => {
  it("keeps the frozen AuthorizationReceipt digest while rejecting a zero decision linkage", () => {
    expect(
      hashAuthorizationReceipt(
        rawAuthorizationReceiptFixture,
        authorizationReceiptDomainFixture,
      ),
    ).toBe(expectedVectorHashes.authorizationReceipt);
    expect(() =>
      hashAuthorizationReceipt(
        {
          ...rawAuthorizationReceiptFixture,
          decisionId: `0x${"00".repeat(32)}`,
        },
        authorizationReceiptDomainFixture,
      ),
    ).toThrow();
  });
  it("validates low-level domains against Covenant deployment context", () => {
    expect(
      validateSigningDomainForCovenant(
        paymentIntentDomainFixture,
        rawCovenantSpecFixture,
        paymentIntentDomainFixture.name,
      ),
    ).toMatchObject({
      chainId: 5_042_002n,
      verifyingContract: fixtureAddresses.vault,
    });
    expectVerificationCode(
      () =>
        validateSigningDomainForCovenant(
          { ...paymentIntentDomainFixture, chainId: "1" },
          rawCovenantSpecFixture,
          paymentIntentDomainFixture.name,
        ),
      "DOMAIN_CHAIN_MISMATCH",
    );
    expectVerificationCode(
      () =>
        validateSigningDomainForCovenant(
          {
            ...paymentIntentDomainFixture,
            verifyingContract: fixtureAddresses.attacker,
          },
          rawCovenantSpecFixture,
          paymentIntentDomainFixture.name,
        ),
      "DOMAIN_CONTRACT_MISMATCH",
    );
    expect(() =>
      validateSigningDomainForCovenant(
        { ...paymentIntentDomainFixture, name: "Covenant Invoice" },
        rawCovenantSpecFixture,
        paymentIntentDomainFixture.name,
      ),
    ).toThrow();
    expect(() =>
      validateSigningDomainForCovenant(
        { ...paymentIntentDomainFixture, version: "2" },
        rawCovenantSpecFixture,
        paymentIntentDomainFixture.name,
      ),
    ).toThrow();
  });

  it("commits to name, version, chain, and verifying contract", () => {
    const base = hashPaymentIntent(
      rawPaymentIntentFixture,
      paymentIntentDomainFixture,
    );
    expect(() =>
      hashPaymentIntent(rawPaymentIntentFixture, {
        ...paymentIntentDomainFixture,
        name: "Covenant Invoice",
      }),
    ).toThrow();
    expect(() =>
      hashPaymentIntent(rawPaymentIntentFixture, {
        ...paymentIntentDomainFixture,
        version: "2",
      }),
    ).toThrow();
    expect(() =>
      hashPaymentIntent(rawPaymentIntentFixture, {
        ...paymentIntentDomainFixture,
        chainId: "5042003",
      }),
    ).toThrow();
    expect(
      hashPaymentIntent(rawPaymentIntentFixture, {
        ...paymentIntentDomainFixture,
        verifyingContract: fixtureAddresses.attacker,
      }),
    ).not.toBe(base);
  });

  it("matches every frozen digest vector", () => {
    expect(
      hashCovenantSpec(rawCovenantSpecFixture, covenantSpecDomainFixture),
    ).toBe(expectedVectorHashes.covenantSpec);
    expect(
      hashPaymentIntent(rawPaymentIntentFixture, paymentIntentDomainFixture),
    ).toBe(expectedVectorHashes.paymentIntent);
    expect(hashInvoice(rawInvoiceFixture, invoiceDomainFixture)).toBe(
      expectedVectorHashes.invoice,
    );
    expect(
      hashDecisionReceipt(
        rawApprovedDecisionReceiptFixture,
        decisionReceiptDomainFixture,
      ),
    ).toBe(expectedVectorHashes.approvedDecisionReceipt);
    expect(
      hashAuthorizationReceipt(
        rawAuthorizationReceiptFixture,
        authorizationReceiptDomainFixture,
      ),
    ).toBe(expectedVectorHashes.authorizationReceipt);
  });

  it("freezes runtime Solidity struct and domain parity vectors", () => {
    expect(hashPaymentIntentStruct(rawPaymentIntentFixture)).toBe(
      "0xc4d6004a5a72ff6ba840c5014d828e81e9e16788c2baf954f495e6b7f8b7832a",
    );
    expect(hashAuthorizationReceiptStruct(rawAuthorizationReceiptFixture)).toBe(
      "0x2479a55ed11ca406ec56959c34702ddf28f5fe9f369e7274fe5bdf396be727ee",
    );
    expect(hashSigningDomain(paymentIntentDomainFixture)).toBe(
      "0x7a1af5478e03f72ecac4236c8393fc2165719699035608183c206460166564c8",
    );
    expect(hashSigningDomain(authorizationReceiptDomainFixture)).toBe(
      "0xc79bc72a231f2f20430a2c95ddb5f16b592c201615cc98af2a4d7603d9de9ea2",
    );
  });
});

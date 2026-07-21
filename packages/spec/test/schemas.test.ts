import { getAddress, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { CANONICAL_RULE_IDS, UINT256_MAX_DECIMAL } from "../src/constants.js";
import {
  fixtureAddresses,
  rawApprovedDecisionReceiptFixture,
  rawApprovedRuleResultsFixture,
  rawAuthorizationReceiptFixture,
  rawCovenantSpecFixture,
  rawInvoiceFixture,
  rawPaymentIntentFixture,
  rawSignedAuthorizationReceiptFixture,
  rawSignedInvoiceFixture,
  rawSignedPaymentIntentFixture,
} from "../src/fixtures.js";
import {
  authorizationReceiptSchema,
  canonicalRuleResultsSchema,
  covenantSpecSchema,
  decisionReceiptSchema,
  invoiceSchema,
  paymentIntentSchema,
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  signedInvoiceSchema,
  signedPaymentIntentSchema,
} from "../src/schemas.js";

describe("security-critical schemas", () => {
  it("accepts all separated-role fixtures", () => {
    expect(covenantSpecSchema.parse(rawCovenantSpecFixture).chainId).toBe(
      5_042_002n,
    );
    expect(paymentIntentSchema.parse(rawPaymentIntentFixture).amount).toBe(
      1_250_000n,
    );
    expect(invoiceSchema.parse(rawInvoiceFixture).amount).toBe(1_250_000n);
    expect(
      decisionReceiptSchema.parse(rawApprovedDecisionReceiptFixture).decision,
    ).toBe("APPROVED");
    expect(
      authorizationReceiptSchema.parse(rawAuthorizationReceiptFixture)
        .authorizationNonce,
    ).toBe(1n);
  });

  it.each([
    ["issuer", "agentSigner"],
    ["issuer", "authorizationSigner"],
    ["agentSigner", "authorizationSigner"],
  ] as const)("rejects role collision %s = %s", (left, right) => {
    const equivalent = rawCovenantSpecFixture[left].toLowerCase();
    expect(
      covenantSpecSchema.safeParse({
        ...rawCovenantSpecFixture,
        [right]: equivalent,
      }).success,
    ).toBe(false);
  });

  it.each([
    "issuer",
    "agentSigner",
    "authorizationSigner",
    "vaultAddress",
    "tokenAddress",
  ] as const)("rejects recipientAddress equal to %s", (field) => {
    expect(
      covenantSpecSchema.safeParse({
        ...rawCovenantSpecFixture,
        recipientAddress: rawCovenantSpecFixture[field].toLowerCase(),
      }).success,
    ).toBe(false);
  });

  it("normalizes lowercase and accepts a correct checksum", () => {
    const lowercase = fixtureAddresses.issuer.toLowerCase();
    expect(
      covenantSpecSchema.parse({ ...rawCovenantSpecFixture, issuer: lowercase })
        .issuer,
    ).toBe(getAddress(lowercase));
    expect(covenantSpecSchema.safeParse(rawCovenantSpecFixture).success).toBe(
      true,
    );
  });

  it("rejects an incorrect mixed-case checksum", () => {
    const invalid = "0x7564105e977516C53bE337314c7E53838967bDaC";
    expect(invalid).not.toBe(invalid.toLowerCase());
    expect(
      covenantSpecSchema.safeParse({
        ...rawCovenantSpecFixture,
        issuer: invalid,
      }).success,
    ).toBe(false);
  });

  it.each([
    [covenantSpecSchema, rawCovenantSpecFixture, "issuer"],
    [covenantSpecSchema, rawCovenantSpecFixture, "agentSigner"],
    [covenantSpecSchema, rawCovenantSpecFixture, "authorizationSigner"],
    [covenantSpecSchema, rawCovenantSpecFixture, "vaultAddress"],
    [covenantSpecSchema, rawCovenantSpecFixture, "tokenAddress"],
    [covenantSpecSchema, rawCovenantSpecFixture, "recipientAddress"],
    [invoiceSchema, rawInvoiceFixture, "vendor"],
    [paymentIntentSchema, rawPaymentIntentFixture, "recipient"],
  ] as const)("rejects zero address in %s", (schema, fixture, field) => {
    expect(schema.safeParse({ ...fixture, [field]: zeroAddress }).success).toBe(
      false,
    );
  });

  it.each(["5042003", "1", "0", UINT256_MAX_DECIMAL, 5_042_002])(
    "rejects non-MVP chain ID %j",
    (chainId) => {
      expect(
        covenantSpecSchema.safeParse({ ...rawCovenantSpecFixture, chainId })
          .success,
      ).toBe(false);
      expect(
        authorizationReceiptSchema.safeParse({
          ...rawAuthorizationReceiptFixture,
          chainId,
        }).success,
      ).toBe(false);
    },
  );

  it("bounds uint256 strings lexically before BigInt conversion", () => {
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        nonce: UINT256_MAX_DECIMAL,
      }).success,
    ).toBe(true);
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        nonce: (BigInt(UINT256_MAX_DECIMAL) + 1n).toString(),
      }).success,
    ).toBe(false);
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        nonce: "9".repeat(1_000_000),
      }).success,
    ).toBe(false);
  });

  it.each([
    [covenantSpecSchema, rawCovenantSpecFixture],
    [paymentIntentSchema, rawPaymentIntentFixture],
    [invoiceSchema, rawInvoiceFixture],
    [decisionReceiptSchema, rawApprovedDecisionReceiptFixture],
    [authorizationReceiptSchema, rawAuthorizationReceiptFixture],
  ] as const)("rejects unsupported versions", (schema, fixture) => {
    expect(schema.safeParse({ ...fixture, version: "2" }).success).toBe(false);
  });

  it("rejects malformed hashes, numbers, and unsigned extra fields", () => {
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        invoiceHash: "0x12",
      }).success,
    ).toBe(false);
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        amount: 1.25,
      }).success,
    ).toBe(false);
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        executeNow: true,
      }).success,
    ).toBe(false);
  });

  it("rejects zero payment amounts and zero timestamps", () => {
    expect(
      paymentIntentSchema.safeParse({ ...rawPaymentIntentFixture, amount: "0" })
        .success,
    ).toBe(false);
    expect(
      invoiceSchema.safeParse({ ...rawInvoiceFixture, amount: "0.000000" })
        .success,
    ).toBe(false);
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        createdAt: "0",
      }).success,
    ).toBe(false);
  });

  it("enforces single-object timestamp ordering", () => {
    expect(
      covenantSpecSchema.safeParse({
        ...rawCovenantSpecFixture,
        validUntil: rawCovenantSpecFixture.validAfter,
      }).success,
    ).toBe(false);
    expect(
      paymentIntentSchema.safeParse({
        ...rawPaymentIntentFixture,
        expiresAt: rawPaymentIntentFixture.createdAt,
      }).success,
    ).toBe(false);
    expect(
      invoiceSchema.safeParse({
        ...rawInvoiceFixture,
        expiresAt: rawInvoiceFixture.issuedAt,
      }).success,
    ).toBe(false);
  });

  it("requires the exact canonical rule sequence", () => {
    expect(
      canonicalRuleResultsSchema.safeParse(rawApprovedRuleResultsFixture)
        .success,
    ).toBe(true);
    const duplicate = rawApprovedRuleResultsFixture.map((rule) => ({
      ...rule,
    }));
    const duplicateSecond = duplicate.at(1);
    if (!duplicateSecond) throw new Error("fixture must include a second rule");
    duplicateSecond.ruleId = CANONICAL_RULE_IDS[0];
    expect(canonicalRuleResultsSchema.safeParse(duplicate).success).toBe(false);
    expect(
      canonicalRuleResultsSchema.safeParse(
        rawApprovedRuleResultsFixture.slice(1),
      ).success,
    ).toBe(false);
    expect(canonicalRuleResultsSchema.safeParse([]).success).toBe(false);
    expect(
      canonicalRuleResultsSchema.safeParse([
        ...rawApprovedRuleResultsFixture,
        {
          ...rawApprovedRuleResultsFixture[0],
          ruleId: "extra",
        },
      ]).success,
    ).toBe(false);
    expect(
      canonicalRuleResultsSchema.safeParse(
        [...rawApprovedRuleResultsFixture].reverse(),
      ).success,
    ).toBe(false);
  });

  it.each([
    [signedPaymentIntentSchema, rawSignedPaymentIntentFixture],
    [signedInvoiceSchema, rawSignedInvoiceFixture],
    [
      signedDecisionReceiptSchema,
      {
        payload: rawApprovedDecisionReceiptFixture,
        signature: rawSignedPaymentIntentFixture.signature,
      },
    ],
    [signedAuthorizationReceiptSchema, rawSignedAuthorizationReceiptFixture],
  ] as const)(
    "enforces strict 65-byte detached envelopes",
    (schema, envelope) => {
      expect(schema.safeParse(envelope).success).toBe(true);
      expect(schema.safeParse({ ...envelope, signature: "0x12" }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...envelope, executeNow: true }).success).toBe(
        false,
      );
    },
  );
});

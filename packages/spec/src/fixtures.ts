import { CANONICAL_RULE_IDS } from "./constants.js";
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
} from "./schemas.js";
import {
  EIP712_DOMAIN_NAMES,
  hashPaymentIntent,
  hashRuleResults,
  signingDomainSchema,
} from "./typed-data.js";

export const fixtureAddresses = {
  issuer: "0x7564105E977516C53bE337314c7E53838967bDaC",
  agentSigner: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  authorizationSigner: "0x1563915e194D8CfBA1943570603F7606A3115508",
  vendor: "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB",
  vault: "0x4000000000000000000000000000000000000004",
  token: "0x5000000000000000000000000000000000000005",
  recipient: "0x6000000000000000000000000000000000000006",
  attacker: "0x9000000000000000000000000000000000000009",
} as const;

export const rawCovenantSpecFixture = {
  version: "1",
  covenantId: `0x${"01".repeat(32)}`,
  issuer: fixtureAddresses.issuer,
  agentSigner: fixtureAddresses.agentSigner,
  authorizationSigner: fixtureAddresses.authorizationSigner,
  vaultAddress: fixtureAddresses.vault,
  chainId: "5042002",
  tokenAddress: fixtureAddresses.token,
  recipientAddress: fixtureAddresses.recipient,
  maxAmountPerPayment: "5000.000000",
  totalBudget: "10000",
  maxPaymentCount: "2",
  validAfter: "1784563200",
  validUntil: "1785168000",
  purpose: "Purchase approved GPU compute",
  policyHash: `0x${"07".repeat(32)}`,
  policyVersion: "gpu-policy-1",
  createdAt: "1784563140",
} as const;

export const rawPaymentIntentFixture = {
  version: "1",
  intentId: `0x${"02".repeat(32)}`,
  covenantId: rawCovenantSpecFixture.covenantId,
  agentSigner: fixtureAddresses.agentSigner,
  recipient: fixtureAddresses.recipient,
  token: fixtureAddresses.token,
  amount: "1.25",
  invoiceHash: `0x${"08".repeat(32)}`,
  purpose: "Purchase approved GPU compute",
  createdAt: "1784563260",
  expiresAt: "1784563560",
  nonce: "1",
} as const;

export const rawInvoiceFixture = {
  version: "1",
  invoiceId: `0x${"03".repeat(32)}`,
  vendor: fixtureAddresses.vendor,
  recipient: fixtureAddresses.recipient,
  token: fixtureAddresses.token,
  amount: "1.25",
  productId: "gpu-a100-hour",
  purpose: "Purchase approved GPU compute",
  issuedAt: "1784563200",
  expiresAt: "1784563500",
  nonce: "1",
} as const;

export const rawApprovedRuleResultsFixture = CANONICAL_RULE_IDS.map(
  (ruleId) => ({
    ruleId,
    status: "PASS" as const,
    expected: "policy requirement satisfied",
    actual: "policy requirement satisfied",
    reason: `${ruleId} passed`,
  }),
);

export const rawRejectedRuleResultsFixture = CANONICAL_RULE_IDS.map(
  (ruleId) => ({
    ruleId,
    status:
      ruleId === "recipient_allowed" ? ("FAIL" as const) : ("PASS" as const),
    expected:
      ruleId === "recipient_allowed"
        ? fixtureAddresses.recipient
        : "policy requirement satisfied",
    actual:
      ruleId === "recipient_allowed"
        ? fixtureAddresses.attacker
        : "policy requirement satisfied",
    reason:
      ruleId === "recipient_allowed"
        ? "Recipient is not the approved GPU vendor"
        : `${ruleId} passed`,
  }),
);

export const covenantSpecDomainFixture = {
  name: EIP712_DOMAIN_NAMES.covenantSpec,
  version: "1",
  chainId: "5042002",
  verifyingContract: fixtureAddresses.vault,
} as const;

export const paymentIntentDomainFixture = {
  ...covenantSpecDomainFixture,
  name: EIP712_DOMAIN_NAMES.paymentIntent,
} as const;

export const invoiceDomainFixture = {
  ...covenantSpecDomainFixture,
  name: EIP712_DOMAIN_NAMES.invoice,
} as const;

export const decisionReceiptDomainFixture = {
  ...covenantSpecDomainFixture,
  name: EIP712_DOMAIN_NAMES.decisionReceipt,
} as const;

export const authorizationReceiptDomainFixture = {
  ...covenantSpecDomainFixture,
  name: EIP712_DOMAIN_NAMES.authorizationReceipt,
} as const;

const fixtureIntentHash = hashPaymentIntent(
  rawPaymentIntentFixture,
  paymentIntentDomainFixture,
);
const approvedRuleResultsHash = hashRuleResults(rawApprovedRuleResultsFixture);
const rejectedRuleResultsHash = hashRuleResults(rawRejectedRuleResultsFixture);

export const rawApprovedDecisionReceiptFixture = {
  version: "1",
  decisionId: `0x${"04".repeat(32)}`,
  covenantId: rawCovenantSpecFixture.covenantId,
  intentId: rawPaymentIntentFixture.intentId,
  intentHash: fixtureIntentHash,
  decision: "APPROVED",
  ruleResultsHash: approvedRuleResultsHash,
  policyVersion: rawCovenantSpecFixture.policyVersion,
  createdAt: "1784563300",
  signer: fixtureAddresses.authorizationSigner,
} as const;

export const rawRejectedDecisionReceiptFixture = {
  ...rawApprovedDecisionReceiptFixture,
  decisionId: `0x${"05".repeat(32)}`,
  decision: "REJECTED",
  ruleResultsHash: rejectedRuleResultsHash,
  createdAt: "1784563310",
} as const;

export const rawAuthorizationReceiptFixture = {
  version: "1",
  authorizationId: `0x${"06".repeat(32)}`,
  decisionId: rawApprovedDecisionReceiptFixture.decisionId,
  covenantId: rawCovenantSpecFixture.covenantId,
  intentHash: fixtureIntentHash,
  vaultAddress: fixtureAddresses.vault,
  chainId: "5042002",
  policyVersion: rawCovenantSpecFixture.policyVersion,
  authorizationNonce: "1",
  validUntil: "1784563440",
  signer: fixtureAddresses.authorizationSigner,
} as const;

export const rawSignedPaymentIntentFixture = {
  payload: rawPaymentIntentFixture,
  signature:
    "0xd8fad9df5ebd761b7469ab590b249fad05a2a971f718cae81205d4ffb5f9236c7bbb9af877aeb54656b61d6fe19a3952f6dfa4da0d12309d546a89fe957778bf1c",
} as const;

export const rawSignedInvoiceFixture = {
  payload: rawInvoiceFixture,
  signature:
    "0x58d28230adc85e6794192f92c06ae48c20eb3f305951088d6bb47e8697648ecb6b5243992ddbb2a2c0507a94cae2a82e0f6fad1418f76361ce770f419992a71a1c",
} as const;

export const rawApprovedSignedDecisionReceiptFixture = {
  payload: rawApprovedDecisionReceiptFixture,
  signature:
    "0x6e9729450e49eafc39953bbe7c3671a78c15c0262a075115d526c6eb7ce100677832b9db0affd4073ce4db47c1d40ac66c81810fed9772efd22466e0f9f4fda71c",
} as const;

export const rawRejectedSignedDecisionReceiptFixture = {
  payload: rawRejectedDecisionReceiptFixture,
  signature:
    "0xb0a2f0be212f2bc27ce568c7270803336ca5dd051701a3f0618d4fc05a2935b2215139d688d45c8b8cdd67e97fa88885760ddae280393d9f987fa8eb003e613d1c",
} as const;

export const rawSignedAuthorizationReceiptFixture = {
  payload: rawAuthorizationReceiptFixture,
  signature:
    "0xf88740efc167d96127919530780f413ae144c749e00a6423f0d2ec49d3751077165cbac06f828b11ce3a7075d4156f82432a33f9984f865d61871dfb0e35866b1c",
} as const;

export const covenantSpecFixture = covenantSpecSchema.parse(
  rawCovenantSpecFixture,
);
export const paymentIntentFixture = paymentIntentSchema.parse(
  rawPaymentIntentFixture,
);
export const invoiceFixture = invoiceSchema.parse(rawInvoiceFixture);
export const approvedRuleResultsFixture = canonicalRuleResultsSchema.parse(
  rawApprovedRuleResultsFixture,
);
export const rejectedRuleResultsFixture = canonicalRuleResultsSchema.parse(
  rawRejectedRuleResultsFixture,
);
export const approvedDecisionReceiptFixture = decisionReceiptSchema.parse(
  rawApprovedDecisionReceiptFixture,
);
export const rejectedDecisionReceiptFixture = decisionReceiptSchema.parse(
  rawRejectedDecisionReceiptFixture,
);
export const authorizationReceiptFixture = authorizationReceiptSchema.parse(
  rawAuthorizationReceiptFixture,
);
export const signedPaymentIntentFixture = signedPaymentIntentSchema.parse(
  rawSignedPaymentIntentFixture,
);
export const signedInvoiceFixture = signedInvoiceSchema.parse(
  rawSignedInvoiceFixture,
);
export const approvedSignedDecisionReceiptFixture =
  signedDecisionReceiptSchema.parse(rawApprovedSignedDecisionReceiptFixture);
export const rejectedSignedDecisionReceiptFixture =
  signedDecisionReceiptSchema.parse(rawRejectedSignedDecisionReceiptFixture);
export const signedAuthorizationReceiptFixture =
  signedAuthorizationReceiptSchema.parse(rawSignedAuthorizationReceiptFixture);

export const signingDomainFixtures = {
  covenantSpec: signingDomainSchema.parse(covenantSpecDomainFixture),
  paymentIntent: signingDomainSchema.parse(paymentIntentDomainFixture),
  invoice: signingDomainSchema.parse(invoiceDomainFixture),
  decisionReceipt: signingDomainSchema.parse(decisionReceiptDomainFixture),
  authorizationReceipt: signingDomainSchema.parse(
    authorizationReceiptDomainFixture,
  ),
} as const;

export const expectedVectorHashes = {
  covenantSpec:
    "0xa1dd0772ae9fb7371abcef970ff4367958d64de1b7a46dd0992ce85ee58dd431",
  paymentIntent: fixtureIntentHash,
  invoice: "0x789f308e11729368021340828de895ca62552af322203d78bd0cfb05a0c2260c",
  approvedDecisionReceipt:
    "0x3dbcb2219a4a2b2dd8eae06fdb8c15d322ab0aa206705e5cff3e66c89a8eb77f",
  rejectedDecisionReceipt:
    "0xe2eca112bfc69f9d9ff3c3f22b31fb3d1d142487f935278afd8d314fea31d38e",
  authorizationReceipt:
    "0x8d0587bee7b740a10b9ea4ae96568c119f855ab45aa66ef2d7850d49f9303be4",
  approvedRuleResults: approvedRuleResultsHash,
  rejectedRuleResults: rejectedRuleResultsHash,
} as const;

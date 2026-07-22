import {
  concat,
  encodeAbiParameters,
  hashDomain,
  hashStruct,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID_STRING,
  SCHEMA_VERSION,
} from "./constants.js";
import { verificationFailure } from "./errors.js";
import {
  authorizationReceiptSchema,
  canonicalRuleResultsSchema,
  covenantSpecSchema,
  decisionReceiptSchema,
  invoiceSchema,
  paymentIntentSchema,
  ruleResultSchema,
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  signedInvoiceSchema,
  signedPaymentIntentSchema,
  type CanonicalRuleResults,
  type CovenantSpec,
  type DecisionReceipt,
} from "./schemas.js";
import { vaultAddressSchema } from "./primitives.js";

const SECP256K1_HALF_CURVE_ORDER = BigInt(
  "0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0",
);

function assertCanonicalSignature(signature: Hex): void {
  const r = BigInt(`0x${signature.slice(2, 66)}`);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);

  if (r === 0n || s === 0n) {
    throw new Error("Signature r and s must be nonzero");
  }
  if (s > SECP256K1_HALF_CURVE_ORDER) {
    throw new Error("Signature s must be canonical low-s");
  }
  if (v !== 27 && v !== 28) {
    throw new Error("Signature v must be 27 or 28");
  }
}

async function requireNonzeroRecoveredSigner(
  recovery: Promise<Address>,
): Promise<Address> {
  const recovered = await recovery;
  if (recovered === zeroAddress) {
    throw new Error("Signature recovered the zero address");
  }
  return recovered;
}

export const EIP712_DOMAIN_NAMES = {
  covenantSpec: "Covenant CovenantSpec",
  paymentIntent: "Covenant PaymentIntent",
  invoice: "Covenant Invoice",
  decisionReceipt: "Covenant DecisionReceipt",
  authorizationReceipt: "Covenant AuthorizationReceipt",
} as const;

const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

const domainNameSchema = z.enum([
  EIP712_DOMAIN_NAMES.covenantSpec,
  EIP712_DOMAIN_NAMES.paymentIntent,
  EIP712_DOMAIN_NAMES.invoice,
  EIP712_DOMAIN_NAMES.decisionReceipt,
  EIP712_DOMAIN_NAMES.authorizationReceipt,
]);

const covenantDomainCandidateSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    chainId: z.string(),
    verifyingContract: vaultAddressSchema,
  })
  .strict();

export const signingDomainSchema = z
  .object({
    name: domainNameSchema,
    version: z.literal(SCHEMA_VERSION),
    chainId: z.literal("5042002").transform(() => ARC_TESTNET_CHAIN_ID),
    verifyingContract: vaultAddressSchema,
  })
  .strict();

export type SigningDomain = z.infer<typeof signingDomainSchema>;

function signingDomainForParsedCovenant(
  covenantSpec: CovenantSpec,
  name: SigningDomain["name"],
) {
  return {
    name,
    version: SCHEMA_VERSION,
    chainId: ARC_TESTNET_CHAIN_ID_STRING,
    verifyingContract: covenantSpec.vaultAddress,
  } as const;
}

export function deriveSigningDomainForCovenant(
  covenant: unknown,
  name: SigningDomain["name"],
) {
  const covenantSpec = covenantSpecSchema.parse(covenant);
  return signingDomainForParsedCovenant(covenantSpec, name);
}

export function validateSigningDomainForCovenant(
  domain: unknown,
  covenant: unknown,
  expectedName: SigningDomain["name"],
): SigningDomain {
  const covenantSpec = covenantSpecSchema.parse(covenant);
  const candidate = covenantDomainCandidateSchema.parse(domain);
  if (
    candidate.chainId !== ARC_TESTNET_CHAIN_ID_STRING ||
    covenantSpec.chainId !== ARC_TESTNET_CHAIN_ID
  ) {
    verificationFailure(
      "DOMAIN_CHAIN_MISMATCH",
      "Signing domain chainId does not match CovenantSpec.chainId",
    );
  }
  if (candidate.verifyingContract !== covenantSpec.vaultAddress) {
    verificationFailure(
      "DOMAIN_CONTRACT_MISMATCH",
      "Signing domain verifyingContract does not match CovenantSpec.vaultAddress",
    );
  }
  return parseDomain(candidate, expectedName);
}

export const COVENANT_SPEC_EIP712_FIELDS = [
  { name: "version", type: "string" },
  { name: "covenantId", type: "bytes32" },
  { name: "issuer", type: "address" },
  { name: "agentSigner", type: "address" },
  { name: "authorizationSigner", type: "address" },
  { name: "vaultAddress", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "tokenAddress", type: "address" },
  { name: "recipientAddress", type: "address" },
  { name: "maxAmountPerPayment", type: "uint256" },
  { name: "totalBudget", type: "uint256" },
  { name: "maxPaymentCount", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validUntil", type: "uint256" },
  { name: "purpose", type: "string" },
  { name: "policyHash", type: "bytes32" },
  { name: "policyVersion", type: "string" },
  { name: "createdAt", type: "uint256" },
] as const;

export const PAYMENT_INTENT_EIP712_FIELDS = [
  { name: "version", type: "string" },
  { name: "intentId", type: "bytes32" },
  { name: "covenantId", type: "bytes32" },
  { name: "agentSigner", type: "address" },
  { name: "recipient", type: "address" },
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "invoiceHash", type: "bytes32" },
  { name: "purpose", type: "string" },
  { name: "createdAt", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
  { name: "nonce", type: "uint256" },
] as const;

export const INVOICE_EIP712_FIELDS = [
  { name: "version", type: "string" },
  { name: "invoiceId", type: "bytes32" },
  { name: "vendor", type: "address" },
  { name: "recipient", type: "address" },
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "productId", type: "string" },
  { name: "purpose", type: "string" },
  { name: "issuedAt", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
  { name: "nonce", type: "uint256" },
] as const;

export const DECISION_RECEIPT_EIP712_FIELDS = [
  { name: "version", type: "string" },
  { name: "decisionId", type: "bytes32" },
  { name: "covenantId", type: "bytes32" },
  { name: "intentId", type: "bytes32" },
  { name: "intentHash", type: "bytes32" },
  { name: "decision", type: "string" },
  { name: "ruleResultsHash", type: "bytes32" },
  { name: "policyVersion", type: "string" },
  { name: "createdAt", type: "uint256" },
  { name: "signer", type: "address" },
] as const;

export const AUTHORIZATION_RECEIPT_EIP712_FIELDS = [
  { name: "version", type: "string" },
  { name: "authorizationId", type: "bytes32" },
  { name: "decisionId", type: "bytes32" },
  { name: "covenantId", type: "bytes32" },
  { name: "intentHash", type: "bytes32" },
  { name: "vaultAddress", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "policyVersion", type: "string" },
  { name: "authorizationNonce", type: "uint256" },
  { name: "validUntil", type: "uint256" },
  { name: "signer", type: "address" },
] as const;

const COVENANT_SPEC_TYPES = {
  CovenantSpec: COVENANT_SPEC_EIP712_FIELDS,
} as const;
const PAYMENT_INTENT_TYPES = {
  PaymentIntent: PAYMENT_INTENT_EIP712_FIELDS,
} as const;
const INVOICE_TYPES = { Invoice: INVOICE_EIP712_FIELDS } as const;
const DECISION_RECEIPT_TYPES = {
  DecisionReceipt: DECISION_RECEIPT_EIP712_FIELDS,
} as const;
const AUTHORIZATION_RECEIPT_TYPES = {
  AuthorizationReceipt: AUTHORIZATION_RECEIPT_EIP712_FIELDS,
} as const;

function parseDomain(
  value: unknown,
  expectedName: SigningDomain["name"],
): SigningDomain {
  const parsed = signingDomainSchema.parse(value);
  if (parsed.name !== expectedName) {
    throw new Error(`Expected EIP-712 domain name ${expectedName}`);
  }
  return parsed;
}

function eip712Domain(value: SigningDomain) {
  return {
    name: value.name,
    version: value.version,
    chainId: value.chainId,
    verifyingContract: value.verifyingContract,
  } as const;
}

export function buildCovenantSpecTypedData(payload: unknown, domain: unknown) {
  const value = covenantSpecSchema.parse(payload);
  const parsedDomain = parseDomain(domain, EIP712_DOMAIN_NAMES.covenantSpec);
  if (
    value.chainId !== parsedDomain.chainId ||
    value.vaultAddress !== parsedDomain.verifyingContract
  ) {
    throw new Error(
      "CovenantSpec deployment fields do not match the signing domain",
    );
  }
  return {
    domain: eip712Domain(parsedDomain),
    types: COVENANT_SPEC_TYPES,
    primaryType: "CovenantSpec",
    message: {
      version: value.version,
      covenantId: value.covenantId,
      issuer: value.issuer,
      agentSigner: value.agentSigner,
      authorizationSigner: value.authorizationSigner,
      vaultAddress: value.vaultAddress,
      chainId: value.chainId,
      tokenAddress: value.tokenAddress,
      recipientAddress: value.recipientAddress,
      maxAmountPerPayment: value.maxAmountPerPayment,
      totalBudget: value.totalBudget,
      maxPaymentCount: value.maxPaymentCount,
      validAfter: value.validAfter,
      validUntil: value.validUntil,
      purpose: value.purpose,
      policyHash: value.policyHash,
      policyVersion: value.policyVersion,
      createdAt: value.createdAt,
    },
  } as const;
}

export function buildPaymentIntentTypedData(payload: unknown, domain: unknown) {
  const value = paymentIntentSchema.parse(payload);
  const parsedDomain = parseDomain(domain, EIP712_DOMAIN_NAMES.paymentIntent);
  return {
    domain: eip712Domain(parsedDomain),
    types: PAYMENT_INTENT_TYPES,
    primaryType: "PaymentIntent",
    message: {
      version: value.version,
      intentId: value.intentId,
      covenantId: value.covenantId,
      agentSigner: value.agentSigner,
      recipient: value.recipient,
      token: value.token,
      amount: value.amount,
      invoiceHash: value.invoiceHash,
      purpose: value.purpose,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      nonce: value.nonce,
    },
  } as const;
}

export function buildInvoiceTypedData(payload: unknown, domain: unknown) {
  const value = invoiceSchema.parse(payload);
  const parsedDomain = parseDomain(domain, EIP712_DOMAIN_NAMES.invoice);
  return {
    domain: eip712Domain(parsedDomain),
    types: INVOICE_TYPES,
    primaryType: "Invoice",
    message: {
      version: value.version,
      invoiceId: value.invoiceId,
      vendor: value.vendor,
      recipient: value.recipient,
      token: value.token,
      amount: value.amount,
      productId: value.productId,
      purpose: value.purpose,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      nonce: value.nonce,
    },
  } as const;
}

export function buildDecisionReceiptTypedData(
  payload: unknown,
  domain: unknown,
) {
  const value = decisionReceiptSchema.parse(payload);
  const parsedDomain = parseDomain(domain, EIP712_DOMAIN_NAMES.decisionReceipt);
  return {
    domain: eip712Domain(parsedDomain),
    types: DECISION_RECEIPT_TYPES,
    primaryType: "DecisionReceipt",
    message: {
      version: value.version,
      decisionId: value.decisionId,
      covenantId: value.covenantId,
      intentId: value.intentId,
      intentHash: value.intentHash,
      decision: value.decision,
      ruleResultsHash: value.ruleResultsHash,
      policyVersion: value.policyVersion,
      createdAt: value.createdAt,
      signer: value.signer,
    },
  } as const;
}

export function buildAuthorizationReceiptTypedData(
  payload: unknown,
  domain: unknown,
) {
  const value = authorizationReceiptSchema.parse(payload);
  const parsedDomain = parseDomain(
    domain,
    EIP712_DOMAIN_NAMES.authorizationReceipt,
  );
  if (
    value.chainId !== parsedDomain.chainId ||
    value.vaultAddress !== parsedDomain.verifyingContract
  ) {
    throw new Error(
      "AuthorizationReceipt deployment fields do not match the signing domain",
    );
  }
  return {
    domain: eip712Domain(parsedDomain),
    types: AUTHORIZATION_RECEIPT_TYPES,
    primaryType: "AuthorizationReceipt",
    message: {
      version: value.version,
      authorizationId: value.authorizationId,
      decisionId: value.decisionId,
      covenantId: value.covenantId,
      intentHash: value.intentHash,
      vaultAddress: value.vaultAddress,
      chainId: value.chainId,
      policyVersion: value.policyVersion,
      authorizationNonce: value.authorizationNonce,
      validUntil: value.validUntil,
      signer: value.signer,
    },
  } as const;
}

export function hashCovenantSpec(payload: unknown, domain: unknown): Hex {
  return hashTypedData(buildCovenantSpecTypedData(payload, domain));
}

export function hashPaymentIntent(payload: unknown, domain: unknown): Hex {
  return hashTypedData(buildPaymentIntentTypedData(payload, domain));
}

export function hashInvoice(payload: unknown, domain: unknown): Hex {
  return hashTypedData(buildInvoiceTypedData(payload, domain));
}

export function hashDecisionReceipt(payload: unknown, domain: unknown): Hex {
  return hashTypedData(buildDecisionReceiptTypedData(payload, domain));
}

export function hashAuthorizationReceipt(
  payload: unknown,
  domain: unknown,
): Hex {
  return hashTypedData(buildAuthorizationReceiptTypedData(payload, domain));
}

export function hashPaymentIntentStruct(payload: unknown): Hex {
  const value = paymentIntentSchema.parse(payload);
  return hashStruct({
    data: {
      version: value.version,
      intentId: value.intentId,
      covenantId: value.covenantId,
      agentSigner: value.agentSigner,
      recipient: value.recipient,
      token: value.token,
      amount: value.amount,
      invoiceHash: value.invoiceHash,
      purpose: value.purpose,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      nonce: value.nonce,
    },
    primaryType: "PaymentIntent",
    types: PAYMENT_INTENT_TYPES,
  });
}

export function hashAuthorizationReceiptStruct(payload: unknown): Hex {
  const value = authorizationReceiptSchema.parse(payload);
  return hashStruct({
    data: {
      version: value.version,
      authorizationId: value.authorizationId,
      decisionId: value.decisionId,
      covenantId: value.covenantId,
      intentHash: value.intentHash,
      vaultAddress: value.vaultAddress,
      chainId: value.chainId,
      policyVersion: value.policyVersion,
      authorizationNonce: value.authorizationNonce,
      validUntil: value.validUntil,
      signer: value.signer,
    },
    primaryType: "AuthorizationReceipt",
    types: AUTHORIZATION_RECEIPT_TYPES,
  });
}

export function hashSigningDomain(domain: unknown): Hex {
  const value = signingDomainSchema.parse(domain);
  const normalized = eip712Domain(value);
  return hashDomain({
    domain: normalized,
    types: {
      EIP712Domain: EIP712_DOMAIN_FIELDS,
    },
  });
}

const RULE_RESULT_TYPE_HASH = keccak256(
  stringToHex(
    "RuleResult(string ruleId,string status,string expected,string actual,string reason)",
  ),
);

export function hashRuleResult(payload: unknown): Hex {
  const value = ruleResultSchema.parse(payload);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        RULE_RESULT_TYPE_HASH,
        keccak256(stringToHex(value.ruleId)),
        keccak256(stringToHex(value.status)),
        keccak256(stringToHex(value.expected)),
        keccak256(stringToHex(value.actual)),
        keccak256(stringToHex(value.reason)),
      ],
    ),
  );
}

export function hashRuleResults(payload: unknown): Hex {
  const values = canonicalRuleResultsSchema.parse(payload);
  return keccak256(concat(values.map((value) => hashRuleResult(value))));
}

function assertDecisionMatchesRules(
  decision: DecisionReceipt["decision"],
  ruleResults: CanonicalRuleResults,
): void {
  const allPass = ruleResults.every((result) => result.status === "PASS");
  if ((decision === "APPROVED") !== allPass) {
    verificationFailure(
      "RULE_RESULTS_NOT_ALL_PASSING",
      "Decision must be APPROVED exactly when every canonical rule passes",
    );
  }
}

export async function recoverPaymentIntentSigner(
  envelope: unknown,
  domain: unknown,
): Promise<Address> {
  const signed = signedPaymentIntentSchema.parse(envelope);
  const rawPayload = (envelope as { payload: unknown }).payload;
  const typedData = buildPaymentIntentTypedData(rawPayload, domain);
  assertCanonicalSignature(signed.signature);
  return requireNonzeroRecoveredSigner(
    recoverTypedDataAddress({
      ...typedData,
      signature: signed.signature,
    }),
  );
}

export async function recoverInvoiceSigner(
  envelope: unknown,
  domain: unknown,
): Promise<Address> {
  const signed = signedInvoiceSchema.parse(envelope);
  const rawPayload = (envelope as { payload: unknown }).payload;
  const typedData = buildInvoiceTypedData(rawPayload, domain);
  assertCanonicalSignature(signed.signature);
  return requireNonzeroRecoveredSigner(
    recoverTypedDataAddress({
      ...typedData,
      signature: signed.signature,
    }),
  );
}

export async function recoverDecisionReceiptSigner(
  envelope: unknown,
  domain: unknown,
): Promise<Address> {
  const signed = signedDecisionReceiptSchema.parse(envelope);
  const rawPayload = (envelope as { payload: unknown }).payload;
  const typedData = buildDecisionReceiptTypedData(rawPayload, domain);
  assertCanonicalSignature(signed.signature);
  return requireNonzeroRecoveredSigner(
    recoverTypedDataAddress({
      ...typedData,
      signature: signed.signature,
    }),
  );
}

export async function recoverAuthorizationReceiptSigner(
  envelope: unknown,
  domain: unknown,
): Promise<Address> {
  const signed = signedAuthorizationReceiptSchema.parse(envelope);
  const rawPayload = (envelope as { payload: unknown }).payload;
  const typedData = buildAuthorizationReceiptTypedData(rawPayload, domain);
  assertCanonicalSignature(signed.signature);
  return requireNonzeroRecoveredSigner(
    recoverTypedDataAddress({
      ...typedData,
      signature: signed.signature,
    }),
  );
}

async function recoverOrFail(
  recover: () => Promise<Address>,
  objectName: string,
): Promise<Address> {
  try {
    return await recover();
  } catch (error) {
    verificationFailure(
      "SIGNATURE_INVALID",
      `${objectName} signature recovery failed`,
      error,
    );
  }
}

export async function verifySignedPaymentIntentForCovenant(
  envelope: unknown,
  covenant: unknown,
) {
  const signed = signedPaymentIntentSchema.parse(envelope);
  const covenantSpec = covenantSpecSchema.parse(covenant);
  if (signed.payload.covenantId !== covenantSpec.covenantId) {
    verificationFailure(
      "COVENANT_ID_MISMATCH",
      "PaymentIntent.covenantId does not match CovenantSpec.covenantId",
    );
  }
  if (signed.payload.agentSigner !== covenantSpec.agentSigner) {
    verificationFailure(
      "UNTRUSTED_AGENT_SIGNER",
      "PaymentIntent.agentSigner is not CovenantSpec.agentSigner",
    );
  }
  const domain = signingDomainForParsedCovenant(
    covenantSpec,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const recovered = await recoverOrFail(
    () => recoverPaymentIntentSigner(envelope, domain),
    "PaymentIntent",
  );
  if (
    recovered !== signed.payload.agentSigner ||
    recovered !== covenantSpec.agentSigner
  ) {
    verificationFailure(
      "UNTRUSTED_AGENT_SIGNER",
      "Recovered PaymentIntent signer is not CovenantSpec.agentSigner",
    );
  }
  return signed;
}

export async function verifySignedDecisionReceiptForCovenant(
  envelope: unknown,
  ruleResults: unknown,
  covenant: unknown,
) {
  const signed = signedDecisionReceiptSchema.parse(envelope);
  const covenantSpec = covenantSpecSchema.parse(covenant);
  const canonicalRules = canonicalRuleResultsSchema.parse(ruleResults);
  if (signed.payload.covenantId !== covenantSpec.covenantId) {
    verificationFailure(
      "COVENANT_ID_MISMATCH",
      "DecisionReceipt.covenantId does not match CovenantSpec.covenantId",
    );
  }
  if (signed.payload.policyVersion !== covenantSpec.policyVersion) {
    verificationFailure(
      "POLICY_VERSION_MISMATCH",
      "DecisionReceipt.policyVersion does not match CovenantSpec.policyVersion",
    );
  }
  if (signed.payload.signer !== covenantSpec.authorizationSigner) {
    verificationFailure(
      "UNTRUSTED_AUTHORIZATION_SIGNER",
      "DecisionReceipt.signer is not CovenantSpec.authorizationSigner",
    );
  }
  const computedRuleResultsHash = hashRuleResults(canonicalRules);
  if (computedRuleResultsHash !== signed.payload.ruleResultsHash) {
    verificationFailure(
      "RULE_RESULTS_MISMATCH",
      "DecisionReceipt.ruleResultsHash does not match canonical results",
    );
  }
  assertDecisionMatchesRules(signed.payload.decision, canonicalRules);
  const domain = signingDomainForParsedCovenant(
    covenantSpec,
    EIP712_DOMAIN_NAMES.decisionReceipt,
  );
  const recovered = await recoverOrFail(
    () => recoverDecisionReceiptSigner(envelope, domain),
    "DecisionReceipt",
  );
  if (
    recovered !== signed.payload.signer ||
    recovered !== covenantSpec.authorizationSigner
  ) {
    verificationFailure(
      "UNTRUSTED_AUTHORIZATION_SIGNER",
      "Recovered DecisionReceipt signer is not CovenantSpec.authorizationSigner",
    );
  }
  return { envelope: signed, ruleResults: canonicalRules } as const;
}

export async function verifySignedAuthorizationReceiptForCovenant(
  envelope: unknown,
  covenant: unknown,
) {
  const signed = signedAuthorizationReceiptSchema.parse(envelope);
  const covenantSpec = covenantSpecSchema.parse(covenant);
  if (signed.payload.covenantId !== covenantSpec.covenantId) {
    verificationFailure(
      "COVENANT_ID_MISMATCH",
      "AuthorizationReceipt.covenantId does not match CovenantSpec.covenantId",
    );
  }
  if (signed.payload.vaultAddress !== covenantSpec.vaultAddress) {
    verificationFailure(
      "VAULT_MISMATCH",
      "AuthorizationReceipt.vaultAddress does not match CovenantSpec.vaultAddress",
    );
  }
  if (signed.payload.chainId !== covenantSpec.chainId) {
    verificationFailure(
      "CHAIN_MISMATCH",
      "AuthorizationReceipt.chainId does not match CovenantSpec.chainId",
    );
  }
  if (signed.payload.policyVersion !== covenantSpec.policyVersion) {
    verificationFailure(
      "POLICY_VERSION_MISMATCH",
      "AuthorizationReceipt.policyVersion does not match CovenantSpec.policyVersion",
    );
  }
  if (signed.payload.signer !== covenantSpec.authorizationSigner) {
    verificationFailure(
      "UNTRUSTED_AUTHORIZATION_SIGNER",
      "AuthorizationReceipt.signer is not CovenantSpec.authorizationSigner",
    );
  }
  const domain = signingDomainForParsedCovenant(
    covenantSpec,
    EIP712_DOMAIN_NAMES.authorizationReceipt,
  );
  const recovered = await recoverOrFail(
    () => recoverAuthorizationReceiptSigner(envelope, domain),
    "AuthorizationReceipt",
  );
  if (
    recovered !== signed.payload.signer ||
    recovered !== covenantSpec.authorizationSigner
  ) {
    verificationFailure(
      "UNTRUSTED_AUTHORIZATION_SIGNER",
      "Recovered AuthorizationReceipt signer is not CovenantSpec.authorizationSigner",
    );
  }
  return signed;
}

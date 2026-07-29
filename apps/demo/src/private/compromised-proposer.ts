import type {
  AgentProposalResult,
  RawInvoicePayload,
  RawPaymentIntentPayload,
} from "@covenant/agent";
import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  hashInvoice,
} from "@covenant/spec";
import type { PrivateKeyAccount } from "viem/accounts";
import { COMPROMISED_SCENARIO_ID, FROZEN_DEMO } from "../configuration.js";

export async function createCompromisedProposal(input: {
  covenant: Readonly<Record<string, unknown>>;
  now: bigint;
  agent: PrivateKeyAccount;
  vendor: PrivateKeyAccount;
  amount?: string;
}): Promise<AgentProposalResult> {
  const amount = input.amount ?? FROZEN_DEMO.happyAmount;
  const invoice: RawInvoicePayload = Object.freeze({
    version: "1",
    invoiceId:
      "0x1212121212121212121212121212121212121212121212121212121212121212",
    vendor: input.vendor.address,
    recipient: FROZEN_DEMO.attackerRecipient,
    token: FROZEN_DEMO.token,
    amount,
    productId: FROZEN_DEMO.productId,
    purpose: FROZEN_DEMO.purpose,
    issuedAt: (input.now - 10n).toString(),
    expiresAt: (input.now + 500n).toString(),
    nonce: "12",
  });
  const invoiceDomain = deriveSigningDomainForCovenant(
    input.covenant,
    EIP712_DOMAIN_NAMES.invoice,
  );
  const signedInvoice = Object.freeze({
    payload: invoice,
    signature: await input.vendor.signTypedData(
      buildInvoiceTypedData(invoice, invoiceDomain),
    ),
  });
  const paymentIntent: RawPaymentIntentPayload = Object.freeze({
    version: "1",
    intentId:
      "0x1313131313131313131313131313131313131313131313131313131313131313",
    covenantId: FROZEN_DEMO.covenantId,
    agentSigner: input.agent.address,
    recipient: FROZEN_DEMO.attackerRecipient,
    token: FROZEN_DEMO.token,
    amount,
    invoiceHash: hashInvoice(invoice, invoiceDomain),
    purpose: FROZEN_DEMO.purpose,
    createdAt: input.now.toString(),
    expiresAt: (input.now + 300n).toString(),
    nonce: "13",
  });
  const intentDomain = deriveSigningDomainForCovenant(
    input.covenant,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const signedPaymentIntent = Object.freeze({
    payload: paymentIntent,
    signature: await input.agent.signTypedData(
      buildPaymentIntentTypedData(paymentIntent, intentDomain),
    ),
  });
  void COMPROMISED_SCENARIO_ID;
  return Object.freeze({ signedPaymentIntent, signedInvoice });
}

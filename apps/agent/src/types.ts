export type RawInvoicePayload = Readonly<{
  version: string;
  invoiceId: string;
  vendor: string;
  recipient: string;
  token: string;
  amount: string;
  productId: string;
  purpose: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}>;

export type RawSignedInvoice = Readonly<{
  payload: RawInvoicePayload;
  signature: string;
}>;

export type RawPaymentIntentPayload = Readonly<{
  version: string;
  intentId: string;
  covenantId: string;
  agentSigner: string;
  recipient: string;
  token: string;
  amount: string;
  invoiceHash: string;
  purpose: string;
  createdAt: string;
  expiresAt: string;
  nonce: string;
}>;

export type RawSignedPaymentIntent = Readonly<{
  payload: RawPaymentIntentPayload;
  signature: string;
}>;

export type AgentProposalResult = Readonly<{
  signedPaymentIntent: RawSignedPaymentIntent;
  signedInvoice: RawSignedInvoice;
}>;

export type ProposalReservation = Readonly<{
  intentId: string;
  nonce: string;
  rawPaymentIntentPayload: RawPaymentIntentPayload;
  completedResult?: AgentProposalResult;
}>;

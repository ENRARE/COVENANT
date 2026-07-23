import {
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  hashInvoice,
  recoverInvoiceSigner,
  type CovenantSpec,
  type SignedInvoice,
  type SignedPaymentIntent,
} from "@covenant/spec";

export type InvoiceVerification = {
  invoiceHash: `0x${string}`;
  signatureValid: boolean;
  signatureReason: string;
  matchesIntent: boolean;
  matchReason: string;
};

export async function verifyInvoice(input: {
  rawCovenant: unknown;
  covenant: CovenantSpec;
  rawSignedInvoice: unknown;
  invoice: SignedInvoice;
  intent: SignedPaymentIntent;
  approvedVendor: string;
  approvedProductId: string;
}): Promise<InvoiceVerification> {
  const domain = deriveSigningDomainForCovenant(
    input.rawCovenant,
    EIP712_DOMAIN_NAMES.invoice,
  );
  const rawInvoicePayload = (input.rawSignedInvoice as { payload: unknown })
    .payload;
  const invoiceHash = hashInvoice(rawInvoicePayload, domain);

  let recoveredSigner: string | undefined;
  try {
    recoveredSigner = await recoverInvoiceSigner(
      input.rawSignedInvoice,
      domain,
    );
  } catch {
    recoveredSigner = undefined;
  }

  const signatureCryptographicallyValid = recoveredSigner !== undefined;
  const vendorAuthorized =
    recoveredSigner === input.approvedVendor &&
    input.invoice.payload.vendor === input.approvedVendor;
  const signatureValid = signatureCryptographicallyValid && vendorAuthorized;
  const signatureReason = !signatureCryptographicallyValid
    ? "invalid_signature"
    : vendorAuthorized
      ? "invoice_signature_valid"
      : "unauthorized_vendor";

  const payload = input.invoice.payload;
  const intent = input.intent.payload;
  let matchReason = "invoice_matches_intent";
  if (intent.invoiceHash !== invoiceHash) matchReason = "invoice_hash_mismatch";
  else if (payload.recipient !== intent.recipient)
    matchReason = "invoice_recipient_mismatch";
  else if (payload.token !== intent.token)
    matchReason = "invoice_token_mismatch";
  else if (payload.amount !== intent.amount)
    matchReason = "invoice_amount_mismatch";
  else if (payload.productId !== input.approvedProductId)
    matchReason = "product_not_allowed";

  return {
    invoiceHash,
    signatureValid,
    signatureReason,
    matchesIntent: matchReason === "invoice_matches_intent",
    matchReason,
  };
}

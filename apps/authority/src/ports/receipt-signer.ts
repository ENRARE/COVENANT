export type ReceiptSigner = {
  readonly address: unknown;
  signDecisionReceipt(typedData: unknown): Promise<unknown>;
  signAuthorizationReceipt(typedData: unknown): Promise<unknown>;
};

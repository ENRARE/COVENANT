export type EvidenceQuery = {
  covenantId: string;
  intentHash: string;
  intentId: string;
  agentNonce: bigint;
};

export type EvidenceReader = {
  readEvidence(query: EvidenceQuery): Promise<unknown>;
  isAuthorizationNonceUsed(nonce: bigint): Promise<unknown>;
};

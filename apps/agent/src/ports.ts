import type { AgentProposalResult, ProposalReservation } from "./types.js";

export type Clock = {
  now(): unknown;
};

export type CovenantProvider = {
  getCovenant(): Promise<unknown>;
};

export type PaymentIntentSigner = {
  readonly address: unknown;
  signPaymentIntent(typedData: unknown): Promise<unknown>;
};

export type PaymentIntentIdentifierGenerator = {
  createId(identity: string): Promise<unknown>;
};

export type ProposalReservationRepository = {
  reserve(
    identity: string,
    createReservation: (nonce: unknown) => Promise<ProposalReservation>,
  ): Promise<unknown>;
  get(identity: string): Promise<unknown>;
  storeCompleted(
    identity: string,
    result: AgentProposalResult,
  ): Promise<unknown>;
};

export type ProposalRepository = {
  coordinate(
    identity: string,
    operation: () => Promise<AgentProposalResult>,
  ): Promise<unknown>;
};

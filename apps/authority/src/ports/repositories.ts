import type { CanonicalRuleResults } from "@covenant/spec";
import type {
  RawSignedAuthorizationReceipt,
  RawSignedDecisionReceipt,
} from "../types.js";

export type ApprovedDecisionRecord = {
  ruleResults: CanonicalRuleResults;
  decisionReceipt: RawSignedDecisionReceipt;
};

export type ApprovedDecisionRepository = {
  getOrCreate(
    identity: string,
    create: () => Promise<ApprovedDecisionRecord>,
  ): Promise<ApprovedDecisionRecord>;
};

export type AuthorizationReservation = {
  authorizationId: `0x${string}`;
  authorizationNonce: bigint;
};

export type AuthorizationRepository = {
  getOrCreate(
    identity: string,
    reserve: () => Promise<AuthorizationReservation>,
    issue: (
      reservation: AuthorizationReservation,
    ) => Promise<RawSignedAuthorizationReceipt>,
  ): Promise<RawSignedAuthorizationReceipt>;
};

export type AuthorizationNonceRepository = {
  reserve(
    identity: string,
    isConsumed: (nonce: bigint) => Promise<boolean>,
  ): Promise<bigint>;
};

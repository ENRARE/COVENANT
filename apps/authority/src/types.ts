import {
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  type CanonicalRuleResults,
} from "@covenant/spec";
import type { z } from "zod";

export type RawSignedDecisionReceipt = z.input<
  typeof signedDecisionReceiptSchema
>;
export type RawSignedAuthorizationReceipt = z.input<
  typeof signedAuthorizationReceiptSchema
>;

export type EvaluationResult = {
  status: "APPROVED" | "REJECTED";
  ruleResults: CanonicalRuleResults;
  decisionReceipt: RawSignedDecisionReceipt;
};

export type ApprovedProcessResult = EvaluationResult & {
  status: "APPROVED";
  authorizationReceipt: RawSignedAuthorizationReceipt;
};

export type RejectedProcessResult = EvaluationResult & {
  status: "REJECTED";
};

export type ProcessResult = ApprovedProcessResult | RejectedProcessResult;

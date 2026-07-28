import type { AgentProposalResult } from "@covenant/agent";
import type { ProcessResult } from "@covenant/authority";
import { DemoError } from "./errors.js";

export function mapApprovedResult(
  agentResult: AgentProposalResult,
  authorityResult: ProcessResult,
) {
  if (authorityResult.status !== "APPROVED") {
    throw new DemoError("HAPPY_PATH_REJECTED");
  }
  return Object.freeze({
    signedPaymentIntent: agentResult.signedPaymentIntent,
    ruleResults: authorityResult.ruleResults,
    decisionReceipt: authorityResult.decisionReceipt,
    authorizationReceipt: authorityResult.authorizationReceipt,
  });
}

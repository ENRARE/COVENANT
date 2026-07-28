import type { AgentProposalResult } from "@covenant/agent";
import type { ProcessResult } from "@covenant/authority";

export class IntegrationHandoffError extends Error {
  readonly code = "AUTHORITY_RESULT_NOT_APPROVED";

  constructor() {
    super("Only an approved authority result can enter execution");
    this.name = "IntegrationHandoffError";
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function mapApprovedAuthorityResultToExecutorRequest(
  agentResult: AgentProposalResult,
  authorityResult: ProcessResult,
) {
  if (authorityResult.status !== "APPROVED") {
    throw new IntegrationHandoffError();
  }
  return Object.freeze({
    signedPaymentIntent: agentResult.signedPaymentIntent,
    ruleResults: authorityResult.ruleResults,
    decisionReceipt: authorityResult.decisionReceipt,
    authorizationReceipt: authorityResult.authorizationReceipt,
  });
}

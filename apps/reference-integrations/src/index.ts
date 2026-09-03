import { Covenant } from "@covenant/sdk";
import type {
  AuthorizationEvidenceSubmission,
  AuditResource,
  CovenantResource,
  CreateCovenantInput,
  ExecutionAccepted,
  ExecutionResource,
} from "@covenant/sdk";

export type ReferencePaymentResult = Readonly<{
  created: CovenantResource;
  listed: readonly CovenantResource[];
  retrieved: CovenantResource;
  requested: CovenantResource;
  authorized: CovenantResource;
  operation: ExecutionAccepted;
  execution: ExecutionResource;
  audit: AuditResource;
}>;

export type EvidenceSource =
  | AuthorizationEvidenceSubmission
  | ((
      covenant: CovenantResource,
    ) =>
      | AuthorizationEvidenceSubmission
      | Promise<AuthorizationEvidenceSubmission>);

async function runPayment(
  client: Covenant,
  input: CreateCovenantInput,
  evidence: EvidenceSource,
  prefix: string,
): Promise<ReferencePaymentResult> {
  const created = await client.covenants.create(input, {
    idempotencyKey: `${prefix}-create`,
  });
  const listed = await client.covenants.list({ limit: 100 });
  const retrieved = await client.covenants.retrieve(created.id);
  const requested = await client.covenants.authorize(created.id, {
    idempotencyKey: `${prefix}-authorize`,
  });
  const authorityEvidence =
    typeof evidence === "function" ? await evidence(created) : evidence;
  const authorized = await client.covenants.submitAuthorizationEvidence(
    created.id,
    authorityEvidence,
    { idempotencyKey: `${prefix}-evidence` },
  );
  const operation = await client.covenants.execute(authorized.id, {
    idempotencyKey: `${prefix}-execute`,
  });
  const execution = await client.executions.retrieve(operation.execution.id);
  const audit = await client.covenants.audit(created.id);
  return {
    created,
    listed: listed.data,
    retrieved,
    requested,
    authorized,
    operation,
    execution,
    audit,
  };
}

/** Own application dogfood: every Platform operation crosses only @covenant/sdk. */
export function runOwnAppPayment(
  client: Covenant,
  input: CreateCovenantInput,
  evidence: EvidenceSource,
): Promise<ReferencePaymentResult> {
  return runPayment(client, input, evidence, "own-app");
}

/** Milestone payment example: release one bounded milestone after evidence. */
export function runMilestonePayment(
  client: Covenant,
  input: CreateCovenantInput,
  evidence: EvidenceSource,
): Promise<ReferencePaymentResult> {
  return runPayment(client, input, evidence, "milestone");
}

/** Marketplace payment example: settle a buyer/seller Covenant through the API. */
export function runMarketplacePayment(
  client: Covenant,
  input: CreateCovenantInput,
  evidence: EvidenceSource,
): Promise<ReferencePaymentResult> {
  return runPayment(client, input, evidence, "marketplace");
}

/** Agent Covenant example: the agent receives no signer or execution credential. */
export function runAgentCovenant(
  client: Covenant,
  input: CreateCovenantInput,
  evidence: EvidenceSource,
): Promise<ReferencePaymentResult> {
  return runPayment(client, input, evidence, "agent");
}

/** Valid cancellation path used by the own-app integration. */
export async function cancelBeforeAuthorization(
  client: Covenant,
  input: CreateCovenantInput,
): Promise<CovenantResource> {
  const created = await client.covenants.create(input, {
    idempotencyKey: "cancel-create",
  });
  return client.covenants.cancel(created.id, {
    idempotencyKey: "cancel-before-authorization",
  });
}

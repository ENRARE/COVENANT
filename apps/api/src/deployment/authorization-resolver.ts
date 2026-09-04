import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bytes32Schema,
  covenantSpecSchema,
  formatUsdc,
  type CovenantSpec,
} from "@covenant/spec";
import type {
  AuthorizationVerificationContext,
  PlatformCovenant,
} from "@covenant/core";
import { z } from "zod";

const projectIdSchema = bytes32Schema.transform(
  (value) => value.toLowerCase() as `0x${string}`,
);

const trustAnchorEntrySchema = z
  .object({ projectId: projectIdSchema, covenantSpec: covenantSpecSchema })
  .strict();

const trustAnchorFileSchema = z
  .object({ entries: z.array(trustAnchorEntrySchema).min(1) })
  .strict();

type DeploymentCovenantSpec = Readonly<{
  covenantId: string;
  [key: string]: unknown;
}>;

export type AuthorizationTrustAnchor = Readonly<{
  projectId: `0x${string}`;
  covenantSpec: DeploymentCovenantSpec;
}>;

export type AuthorizationContextResolver = (
  projectId: string,
  covenant: PlatformCovenant,
) => AuthorizationVerificationContext | undefined;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function parseTrustAnchors(
  value: unknown,
): readonly AuthorizationTrustAnchor[] {
  const parsed = trustAnchorFileSchema.parse(value);
  const keys = new Set<string>();
  for (const entry of parsed.entries) {
    const key =
      `${entry.projectId}:${entry.covenantSpec.covenantId}`.toLowerCase();
    if (keys.has(key)) throw new Error("Duplicate authorization trust anchor");
    keys.add(key);
  }
  return deepFreeze(
    parsed.entries.map((entry) =>
      deepFreeze({
        projectId: entry.projectId,
        covenantSpec: normalizeCovenantSpec(entry.covenantSpec),
      }),
    ),
  );
}

/**
 * The spec schema intentionally exposes bigint values to typed-data code. The
 * deployment file is JSON, however, and the public verifier accepts the
 * canonical string representation. Normalize validated values back to that
 * detached JSON form before freezing the trust anchor.
 */
function normalizeCovenantSpec(value: CovenantSpec): DeploymentCovenantSpec {
  return {
    version: value.version,
    covenantId: value.covenantId,
    issuer: value.issuer,
    agentSigner: value.agentSigner,
    authorizationSigner: value.authorizationSigner,
    vaultAddress: value.vaultAddress,
    chainId: value.chainId.toString(),
    tokenAddress: value.tokenAddress,
    recipientAddress: value.recipientAddress,
    maxAmountPerPayment: formatUsdc(value.maxAmountPerPayment),
    totalBudget: formatUsdc(value.totalBudget),
    maxPaymentCount: value.maxPaymentCount.toString(),
    validAfter: value.validAfter.toString(),
    validUntil: value.validUntil.toString(),
    purpose: value.purpose,
    policyHash: value.policyHash,
    policyVersion: value.policyVersion,
    createdAt: value.createdAt.toString(),
  };
}

/** Load immutable, deployment-owned CovenantSpec trust anchors. */
export function createAuthorizationContextResolver(
  filename: string,
): AuthorizationContextResolver {
  if (typeof filename !== "string" || filename.trim() === "")
    throw new Error("Authorization trust-anchor file is required");
  const path = resolve(filename);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Authorization trust-anchor file could not be loaded");
  }
  const anchors = parseTrustAnchors(parsed);
  const byIdentity = new Map(
    anchors.map((entry) => [
      `${entry.projectId}:${entry.covenantSpec.covenantId}`.toLowerCase(),
      entry.covenantSpec,
    ]),
  );
  return (projectId, covenant) => {
    const spec = byIdentity.get(`${projectId}:${covenant.id}`.toLowerCase());
    return spec === undefined ? undefined : { covenantSpec: spec };
  };
}

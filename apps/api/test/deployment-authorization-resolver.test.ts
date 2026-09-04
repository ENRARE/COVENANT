import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createCovenant, verifyAuthorizationEvidence } from "@covenant/core";
import { createAuthorizationContextResolver } from "../src/deployment/authorization-resolver.js";
import {
  createEvidence,
  tamperSignature,
} from "./authorization-evidence-fixtures.js";
import type { PlatformCovenant } from "@covenant/core";

const payer = "0x1111111111111111111111111111111111111111";
const beneficiary = "0x2222222222222222222222222222222222222222";
const policyHash = `0x${"ab".repeat(32)}`;

function bytes32(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function resource(): PlatformCovenant {
  return createCovenant({
    version: "2",
    id: bytes32(1),
    projectId: bytes32(9),
    payer,
    beneficiary,
    asset: {
      symbol: "USDC",
      decimals: 6,
      address: "0x3600000000000000000000000000000000000000",
    },
    amount: "1.25",
    network: { id: "arc-testnet", chainId: "5042002" },
    conditions: { policyHash, policyVersion: "1" },
    createdAt: "1700000000",
    expiresAt: "1700001000",
  });
}

function writeAnchors(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "covenant-resolver-"));
  const filename = join(directory, "anchors.json");
  writeFileSync(filename, JSON.stringify(value), "utf8");
  return filename;
}

function cleanup(filename: string): void {
  rmSync(join(filename, ".."), { recursive: true, force: true });
}

describe("deployment authorization resolver", () => {
  it("selects only the exact project and Covenant trust anchor", async () => {
    const covenant = resource();
    const evidence = await createEvidence(covenant);
    const filename = writeAnchors({
      entries: [
        {
          projectId: covenant.projectId,
          covenantSpec: evidence.context.covenantSpec,
        },
      ],
    });
    try {
      const resolver = createAuthorizationContextResolver(filename);
      const context = resolver(covenant.projectId, covenant);
      expect(context).toBeDefined();
      expect(context?.covenantSpec).toEqual(evidence.context.covenantSpec);
      expect(resolver(bytes32(10), covenant)).toBeUndefined();
      expect(
        resolver(covenant.projectId, { ...covenant, id: bytes32(2) }),
      ).toBeUndefined();
    } finally {
      cleanup(filename);
    }
  });

  it("loads strict immutable anchors and reuses core signature verification", async () => {
    const covenant = resource();
    const evidence = await createEvidence(covenant);
    const filename = writeAnchors({
      entries: [
        {
          projectId: covenant.projectId,
          covenantSpec: evidence.context.covenantSpec,
        },
      ],
    });
    try {
      const resolver = createAuthorizationContextResolver(filename);
      const context = resolver(covenant.projectId, covenant);
      if (context === undefined) throw new Error("missing test context");
      await expect(
        verifyAuthorizationEvidence(covenant, evidence.submission, context),
      ).resolves.toEqual(evidence.submission);
      await expect(
        verifyAuthorizationEvidence(
          covenant,
          tamperSignature(evidence.submission),
          context,
        ),
      ).rejects.toThrow();
    } finally {
      cleanup(filename);
    }
  });

  it("rejects duplicate or unknown trust-anchor configuration", () => {
    const covenant = resource();
    const spec = {
      version: "1",
      covenantId: covenant.id,
      issuer: covenant.payer,
      agentSigner: "0x3333333333333333333333333333333333333333",
      authorizationSigner: "0x4444444444444444444444444444444444444444",
      vaultAddress: "0x4000000000000000000000000000000000000004",
      chainId: "5042002",
      tokenAddress: "0x3600000000000000000000000000000000000000",
      recipientAddress: covenant.beneficiary,
      maxAmountPerPayment: covenant.amount,
      totalBudget: covenant.amount,
      maxPaymentCount: "1",
      validAfter: covenant.createdAt,
      validUntil: covenant.expiresAt,
      purpose: "COV-026 reference payment",
      policyHash,
      policyVersion: "1",
      createdAt: covenant.createdAt,
    };
    const duplicate = writeAnchors({
      entries: [
        { projectId: covenant.projectId, covenantSpec: spec },
        { projectId: covenant.projectId, covenantSpec: spec },
      ],
    });
    try {
      expect(() => createAuthorizationContextResolver(duplicate)).toThrow();
    } finally {
      cleanup(duplicate);
    }

    const unknown = writeAnchors({
      entries: [
        { projectId: covenant.projectId, covenantSpec: spec, extra: true },
      ],
    });
    try {
      expect(() => createAuthorizationContextResolver(unknown)).toThrow();
    } finally {
      cleanup(unknown);
    }
  });
});

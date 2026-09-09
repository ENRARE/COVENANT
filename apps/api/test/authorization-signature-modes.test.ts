import { describe, expect, it, vi } from "vitest";
import {
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  hashAuthorizationReceipt,
  hashDecisionReceipt,
  hashPaymentIntent,
  recoverDigestSigner,
  signedPaymentIntentSchema,
  type CovenantSpec,
} from "@covenant/spec";
import { createCovenant, verifyAuthorizationEvidence } from "@covenant/core";
import {
  createArcTestnetSignatureVerifier,
  type ArcSignatureVerificationClient,
} from "../src/deployment/arc-signature-verifier.js";
import { createEvidence } from "./authorization-evidence-fixtures.js";
import type { Hex } from "viem";

const payer = "0x1111111111111111111111111111111111111111";
const beneficiary = "0x2222222222222222222222222222222222222222";

function bytes32(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function resource() {
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
    conditions: { policyHash: bytes32(7), policyVersion: "1" },
    createdAt: "1700000000",
    expiresAt: "1700001000",
  });
}

function validatingClient(contractSigners: ReadonlySet<string>) {
  const calls: {
    address: string;
    digest: Hex;
    signature: Hex;
  }[] = [];
  const client: ArcSignatureVerificationClient = {
    getChainId: vi.fn(() => Promise.resolve(5_042_002)),
    getCode: vi.fn(
      (
        input: Parameters<ArcSignatureVerificationClient["getCode"]>[0],
      ): Promise<Hex | undefined> =>
        Promise.resolve(
          contractSigners.has(input.address.toLowerCase())
            ? "0x6000"
            : undefined,
        ),
    ),
    readContract: vi.fn(
      async (
        input: Parameters<ArcSignatureVerificationClient["readContract"]>[0],
      ) => {
        const { address, args } = input;
        calls.push({ address, digest: args[0], signature: args[1] });
        try {
          const recovered = await recoverDigestSigner(args[0], args[1]);
          return recovered === address ? "0x1626ba7e" : "0xffffffff";
        } catch {
          return "0xffffffff";
        }
      },
    ),
  };
  return { client, calls };
}

describe("authorization evidence signer modes", () => {
  it.each([
    ["SCA agent + EOA authorization", true, false],
    ["EOA agent + SCA authorization", false, true],
    ["SCA agent + SCA authorization", true, true],
  ] as const)(
    "verifies %s with immutable CovenantSpec signers",
    async (_label, agentIsContract, authorizationIsContract) => {
      const covenant = resource();
      const evidence = await createEvidence(covenant);
      const covenantSpec = evidence.context.covenantSpec as CovenantSpec;
      const contractSigners = new Set<string>();
      if (agentIsContract)
        contractSigners.add(covenantSpec.agentSigner.toLowerCase());
      if (authorizationIsContract)
        contractSigners.add(covenantSpec.authorizationSigner.toLowerCase());
      const { client, calls } = validatingClient(contractSigners);
      const signatureVerifier = createArcTestnetSignatureVerifier(client);

      await expect(
        verifyAuthorizationEvidence(covenant, evidence.submission, {
          covenantSpec,
          signatureVerifier,
        }),
      ).resolves.toEqual(evidence.submission);

      const intentDomain = deriveSigningDomainForCovenant(
        covenantSpec,
        EIP712_DOMAIN_NAMES.paymentIntent,
      );
      const decisionDomain = deriveSigningDomainForCovenant(
        covenantSpec,
        EIP712_DOMAIN_NAMES.decisionReceipt,
      );
      const authorizationDomain = deriveSigningDomainForCovenant(
        covenantSpec,
        EIP712_DOMAIN_NAMES.authorizationReceipt,
      );
      const exactDigests = [
        hashPaymentIntent(
          (evidence.submission.signedPaymentIntent as { payload: unknown })
            .payload,
          intentDomain,
        ),
        hashDecisionReceipt(
          (
            evidence.submission.evidence.signedDecisionReceipt as {
              payload: unknown;
            }
          ).payload,
          decisionDomain,
        ),
        hashAuthorizationReceipt(
          (
            evidence.submission.evidence.signedAuthorizationReceipt as {
              payload: unknown;
            }
          ).payload,
          authorizationDomain,
        ),
      ];
      for (const digest of exactDigests) {
        if (calls.some((call) => call.digest === digest)) continue;
        // EOA paths use the same digest inside the offline recovery helper.
        expect(contractSigners.size).toBeLessThan(2);
      }
      for (const call of calls) expect(exactDigests).toContain(call.digest);
    },
  );

  it("fails closed on wrong Covenant, domain, digest, payload, or signer", async () => {
    const covenant = resource();
    const evidence = await createEvidence(covenant);
    const covenantSpec = evidence.context.covenantSpec as CovenantSpec;
    const { client } = validatingClient(
      new Set([
        covenantSpec.agentSigner.toLowerCase(),
        covenantSpec.authorizationSigner.toLowerCase(),
      ]),
    );
    const context = {
      covenantSpec,
      signatureVerifier: createArcTestnetSignatureVerifier(client),
    };
    const originalIntent = signedPaymentIntentSchema.parse(
      evidence.submission.signedPaymentIntent,
    );

    await expect(
      verifyAuthorizationEvidence(
        { ...covenant, id: bytes32(99) },
        evidence.submission,
        context,
      ),
    ).rejects.toThrow();
    await expect(
      verifyAuthorizationEvidence(covenant, evidence.submission, {
        ...context,
        covenantSpec: { ...covenantSpec, vaultAddress: payer },
      }),
    ).rejects.toThrow();
    await expect(
      verifyAuthorizationEvidence(
        covenant,
        {
          ...evidence.submission,
          signedPaymentIntent: {
            ...originalIntent,
            payload: { ...originalIntent.payload, invoiceHash: bytes32(88) },
          },
        },
        context,
      ),
    ).rejects.toThrow();
    await expect(
      verifyAuthorizationEvidence(
        covenant,
        {
          ...evidence.submission,
          signedPaymentIntent: {
            ...originalIntent,
            payload: { ...originalIntent.payload, agentSigner: payer },
          },
        },
        context,
      ),
    ).rejects.toThrow();
    await expect(
      verifyAuthorizationEvidence(covenant, evidence.submission, {
        ...context,
        covenantSpec: { ...covenantSpec, chainId: "1" },
      }),
    ).rejects.toThrow();
  });
});

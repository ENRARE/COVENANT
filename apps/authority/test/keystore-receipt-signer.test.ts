import {
  EIP712_DOMAIN_NAMES,
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  recoverAuthorizationReceiptSigner,
  recoverDecisionReceiptSigner,
} from "@covenant/spec";
import { afterEach, describe, expect, it } from "vitest";
import { runAuthoritySignerCli } from "../src/signer-cli.js";
import { createKeystoreReceiptSigner } from "../src/signers/keystore-receipt-signer.js";
import { createFakeKeystore } from "./fake-keystore.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () =>
  Promise.all(cleanups.splice(0).map((cleanup) => cleanup())),
);

describe("isolated authority receipt signer", () => {
  it("recovers both exact receipt signatures and exposes no generic capability", async () => {
    const fake = await createFakeKeystore();
    cleanups.push(fake.cleanup);
    const vault = "0x4000000000000000000000000000000000000004";
    const signer = createKeystoreReceiptSigner({
      keystorePath: fake.keystorePath,
      passwordFilePath: fake.passwordFilePath,
      expectedAddress: fake.account.address,
    });
    const decision = {
      version: "1",
      decisionId: `0x${"11".repeat(32)}`,
      covenantId: `0x${"22".repeat(32)}`,
      intentId: `0x${"33".repeat(32)}`,
      intentHash: `0x${"44".repeat(32)}`,
      decision: "APPROVED",
      ruleResultsHash: `0x${"55".repeat(32)}`,
      policyVersion: "policy-1",
      createdAt: "2100000000",
      signer: fake.account.address,
    };
    const decisionDomain = {
      name: EIP712_DOMAIN_NAMES.decisionReceipt,
      version: "1",
      chainId: "5042002",
      verifyingContract: vault,
    } as const;
    const decisionSignature = await signer.signDecisionReceipt(
      buildDecisionReceiptTypedData(decision, decisionDomain),
    );
    await expect(
      recoverDecisionReceiptSigner(
        { payload: decision, signature: decisionSignature },
        decisionDomain,
      ),
    ).resolves.toBe(fake.account.address);
    const authorization = {
      version: "1",
      authorizationId: `0x${"66".repeat(32)}`,
      decisionId: decision.decisionId,
      covenantId: decision.covenantId,
      intentHash: decision.intentHash,
      vaultAddress: vault,
      chainId: "5042002",
      policyVersion: "policy-1",
      authorizationNonce: "1",
      validUntil: "2100000300",
      signer: fake.account.address,
    };
    const authorizationDomain = {
      name: EIP712_DOMAIN_NAMES.authorizationReceipt,
      version: "1",
      chainId: "5042002",
      verifyingContract: vault,
    } as const;
    const authorizationSignature = await signer.signAuthorizationReceipt(
      buildAuthorizationReceiptTypedData(authorization, authorizationDomain),
    );
    await expect(
      recoverAuthorizationReceiptSigner(
        { payload: authorization, signature: authorizationSignature },
        authorizationDomain,
      ),
    ).resolves.toBe(fake.account.address);
    expect(Object.keys(signer)).toEqual([
      "address",
      "signDecisionReceipt",
      "signAuthorizationReceipt",
    ]);
    expect(signer).not.toHaveProperty("signTypedData");
    expect(signer).not.toHaveProperty("sendTransaction");
    await expect(
      signer.signDecisionReceipt({
        domain: {},
        types: {},
        primaryType: "DecisionReceipt",
        message: decision,
      }),
    ).rejects.toThrow();
  });

  it("rejects Circle-bearing environments", async () => {
    await expect(
      runAuthoritySignerCli({
        ["CIRCLE_ENTITY_" + "SECRET_HEX"]: "forbidden",
      }),
    ).rejects.toThrow("forbidden");
  });
});

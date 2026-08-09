import {
  EIP712_DOMAIN_NAMES,
  buildPaymentIntentTypedData,
  recoverPaymentIntentSigner,
} from "@covenant/spec";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentSignerCli } from "../src/signer-cli.js";
import { createKeystorePaymentIntentSigner } from "../src/signers/keystore-payment-intent-signer.js";
import { createFakeKeystore } from "./fake-keystore.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () =>
  Promise.all(cleanups.splice(0).map((cleanup) => cleanup())),
);

describe("isolated PaymentIntent signer", () => {
  it("signs only exact PaymentIntent typed data", async () => {
    const fake = await createFakeKeystore();
    cleanups.push(fake.cleanup);
    const signer = createKeystorePaymentIntentSigner({
      keystorePath: fake.keystorePath,
      passwordFilePath: fake.passwordFilePath,
      expectedAddress: fake.account.address,
    });
    const domain = {
      name: EIP712_DOMAIN_NAMES.paymentIntent,
      version: "1",
      chainId: "5042002",
      verifyingContract: "0x4000000000000000000000000000000000000004",
    } as const;
    const payload = {
      version: "1",
      intentId: `0x${"11".repeat(32)}`,
      covenantId: `0x${"22".repeat(32)}`,
      agentSigner: fake.account.address,
      recipient: "0x6000000000000000000000000000000000000006",
      token: "0x5000000000000000000000000000000000000005",
      amount: "0.01",
      invoiceHash: `0x${"33".repeat(32)}`,
      purpose: "approved purpose",
      createdAt: "2100000000",
      expiresAt: "2100000300",
      nonce: "1",
    };
    const signature = await signer.signPaymentIntent(
      buildPaymentIntentTypedData(payload, domain),
    );
    await expect(
      recoverPaymentIntentSigner({ payload, signature }, domain),
    ).resolves.toBe(fake.account.address);
    expect(Object.keys(signer)).toEqual(["address", "signPaymentIntent"]);
    expect(signer).not.toHaveProperty("signTypedData");
    expect(signer).not.toHaveProperty("sendTransaction");
    await expect(
      signer.signPaymentIntent({
        domain: {},
        types: {},
        primaryType: "PaymentIntent",
        message: payload,
      }),
    ).rejects.toThrow();
  });

  it("rejects Circle-bearing environments", async () => {
    await expect(
      runAgentSignerCli({ ["CIRCLE_ENTITY_" + "SECRET"]: "forbidden" }),
    ).rejects.toThrow("forbidden");
  });
});

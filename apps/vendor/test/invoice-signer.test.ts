import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  recoverInvoiceSigner,
} from "@covenant/spec";
import { afterEach, describe, expect, it } from "vitest";
import { runVendorSignerCli } from "../src/cli.js";
import { createKeystoreInvoiceSigner } from "../src/invoice-signer.js";
import { createFakeKeystore } from "./fake-keystore.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () =>
  Promise.all(cleanups.splice(0).map((cleanup) => cleanup())),
);

function domain() {
  return {
    name: EIP712_DOMAIN_NAMES.invoice,
    version: "1",
    chainId: "5042002",
    verifyingContract: "0x4000000000000000000000000000000000000004",
  } as const;
}

describe("isolated vendor invoice signer", () => {
  it("recovers the configured vendor and exposes no generic capability", async () => {
    const fake = await createFakeKeystore();
    cleanups.push(fake.cleanup);
    const options = {
      keystorePath: fake.keystorePath,
      passwordFilePath: fake.passwordFilePath,
      expectedAddress: fake.account.address,
      recipient: "0x6000000000000000000000000000000000000006",
      token: "0x5000000000000000000000000000000000000005",
      productId: "gpu-h100-hour",
      purpose: "approved purpose",
      maximumAmountBaseUnits: 1_000_000n,
    };
    const signer = createKeystoreInvoiceSigner(options);
    const payload = {
      version: "1",
      invoiceId: `0x${"11".repeat(32)}`,
      vendor: fake.account.address,
      recipient: options.recipient,
      token: options.token,
      amount: "0.01",
      productId: options.productId,
      purpose: options.purpose,
      issuedAt: "2100000000",
      expiresAt: "2100000300",
      nonce: "1",
    };
    const signingDomain = domain();
    const signature = await signer.signInvoice(
      buildInvoiceTypedData(payload, signingDomain),
    );
    await expect(
      recoverInvoiceSigner({ payload, signature }, signingDomain),
    ).resolves.toBe(fake.account.address);
    expect(Object.keys(signer)).toEqual(["address", "signInvoice"]);
    expect(signer).not.toHaveProperty("signTypedData");
    expect(signer).not.toHaveProperty("sendTransaction");
  });

  it.each([
    ["recipient", "0x7000000000000000000000000000000000000007"],
    ["token", "0x7000000000000000000000000000000000000007"],
    ["productId", "wrong-product"],
    ["purpose", "wrong-purpose"],
  ])("rejects wrong %s linkage", async (field, value) => {
    const fake = await createFakeKeystore();
    cleanups.push(fake.cleanup);
    const signer = createKeystoreInvoiceSigner({
      keystorePath: fake.keystorePath,
      passwordFilePath: fake.passwordFilePath,
      expectedAddress: fake.account.address,
      recipient: "0x6000000000000000000000000000000000000006",
      token: "0x5000000000000000000000000000000000000005",
      productId: "gpu-h100-hour",
      purpose: "approved purpose",
      maximumAmountBaseUnits: 1_000_000n,
    });
    const payload = {
      version: "1",
      invoiceId: `0x${"11".repeat(32)}`,
      vendor: fake.account.address,
      recipient: "0x6000000000000000000000000000000000000006",
      token: "0x5000000000000000000000000000000000000005",
      amount: "0.01",
      productId: "gpu-h100-hour",
      purpose: "approved purpose",
      issuedAt: "2100000000",
      expiresAt: "2100000300",
      nonce: "1",
      [field]: value,
    };
    await expect(
      signer.signInvoice(buildInvoiceTypedData(payload, domain())),
    ).rejects.toThrow("approved configuration");
  });

  it("rejects wrong type/domain and Circle-bearing environments", async () => {
    const fake = await createFakeKeystore();
    cleanups.push(fake.cleanup);
    const signer = createKeystoreInvoiceSigner({
      keystorePath: fake.keystorePath,
      passwordFilePath: fake.passwordFilePath,
      expectedAddress: fake.account.address,
      recipient: "0x6000000000000000000000000000000000000006",
      token: "0x5000000000000000000000000000000000000005",
      productId: "gpu-h100-hour",
      purpose: "approved purpose",
      maximumAmountBaseUnits: 1_000_000n,
    });
    await expect(
      signer.signInvoice({
        domain: {},
        types: {},
        primaryType: "PaymentIntent",
        message: {},
      }),
    ).rejects.toThrow();
    await expect(
      signer.signInvoice({
        domain: {},
        types: {},
        primaryType: "Invoice",
        message: {},
      }),
    ).rejects.toThrow();
    await expect(
      runVendorSignerCli({ ["CIRCLE_API_" + "KEY"]: "forbidden" }),
    ).rejects.toThrow("forbidden");
  });
});

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";

export type EphemeralSigners = Readonly<{
  issuer: PrivateKeyAccount;
  agent: PrivateKeyAccount;
  authorization: PrivateKeyAccount;
  vendor: PrivateKeyAccount;
  attacker: PrivateKeyAccount;
}>;

export type SignerFactory = {
  create(): EphemeralSigners;
};

export const ephemeralSignerFactory: SignerFactory = {
  create() {
    for (;;) {
      const signers = Object.freeze({
        issuer: privateKeyToAccount(generatePrivateKey()),
        agent: privateKeyToAccount(generatePrivateKey()),
        authorization: privateKeyToAccount(generatePrivateKey()),
        vendor: privateKeyToAccount(generatePrivateKey()),
        attacker: privateKeyToAccount(generatePrivateKey()),
      });
      const addresses = Object.values(signers).map((signer) => signer.address);
      if (new Set(addresses).size === addresses.length) return signers;
    }
  },
};

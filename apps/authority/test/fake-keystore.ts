import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export async function createFakeKeystore() {
  const directory = await mkdtemp(join(tmpdir(), "covenant-cov018-"));
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const passphrase = Buffer.from(randomBytes(24).toString("hex"), "utf8");
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const derived = pbkdf2Sync(passphrase, salt, 10_000, 32, "sha256");
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey.slice(2), "hex")),
    cipher.final(),
  ]);
  const mac = keccak256(
    new Uint8Array(Buffer.concat([derived.subarray(16), ciphertext])),
  ).slice(2);
  const keystorePath = join(directory, "signer.json");
  const passwordFilePath = join(directory, "password");
  await writeFile(
    keystorePath,
    JSON.stringify({
      address: account.address.slice(2).toLowerCase(),
      crypto: {
        cipher: "aes-128-ctr",
        cipherparams: { iv: iv.toString("hex") },
        ciphertext: ciphertext.toString("hex"),
        kdf: "pbkdf2",
        kdfparams: {
          c: 10_000,
          dklen: 32,
          prf: "hmac-sha256",
          salt: salt.toString("hex"),
        },
        mac,
      },
      id: "00000000-0000-4000-8000-000000000018",
      version: 3,
    }),
  );
  await writeFile(
    passwordFilePath,
    Buffer.concat([passphrase, Buffer.from("\n")]),
  );
  derived.fill(0);
  passphrase.fill(0);
  return {
    account,
    keystorePath,
    passwordFilePath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

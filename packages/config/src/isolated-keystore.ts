import {
  createDecipheriv,
  pbkdf2 as pbkdf2Callback,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";

const MAXIMUM_KEYSTORE_BYTES = 128 * 1024;
const MAXIMUM_PASSWORD_BYTES = 4096;
const MAXIMUM_SCRYPT_MEMORY_BYTES = 1024 * 1024 * 1024;

const hexSchema = (bytes: number) =>
  z.string().regex(new RegExp(`^[0-9a-fA-F]{${String(bytes * 2)}}$`, "u"));

const scryptParametersSchema = z
  .object({
    dklen: z.literal(32),
    n: z.number().int().min(1024).max(1_048_576),
    p: z.number().int().min(1).max(16),
    r: z.number().int().min(1).max(32),
    salt: hexSchema(32),
  })
  .strict()
  .refine((value) => (value.n & (value.n - 1)) === 0, {
    message: "Scrypt n must be a power of two",
    path: ["n"],
  });

const pbkdf2ParametersSchema = z
  .object({
    c: z.number().int().min(10_000).max(10_000_000),
    dklen: z.literal(32),
    prf: z.literal("hmac-sha256"),
    salt: hexSchema(32),
  })
  .strict();

const commonCryptoSchema = z.object({
  cipher: z.literal("aes-128-ctr"),
  cipherparams: z.object({ iv: hexSchema(16) }).strict(),
  ciphertext: z.string().regex(/^(?:[0-9a-fA-F]{2})+$/u),
  mac: hexSchema(32),
});

const cryptoSchema = z.union([
  commonCryptoSchema
    .extend({ kdf: z.literal("scrypt"), kdfparams: scryptParametersSchema })
    .strict(),
  commonCryptoSchema
    .extend({ kdf: z.literal("pbkdf2"), kdfparams: pbkdf2ParametersSchema })
    .strict(),
]);

const keystoreSchema = z
  .object({
    address: hexSchema(20),
    crypto: cryptoSchema.optional(),
    Crypto: cryptoSchema.optional(),
    id: z.string().uuid(),
    version: z.literal(3),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.crypto === undefined) === (value.Crypto === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["crypto"],
        message: "Exactly one crypto property is required",
      });
    }
  });

export type IsolatedKeystoreInput = Readonly<{
  keystorePath: string;
  passwordFilePath: string;
  expectedAddress: unknown;
}>;

async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Signer material must be a regular non-link file");
  }
  if (metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error("Signer material file size is invalid");
  }
  return readFile(path);
}

async function resolveRegularFile(
  path: string,
  maximumBytes: number,
): Promise<{ bytes: Buffer; path: string }> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Signer material must be a regular non-link file");
  }
  if (metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error("Signer material file size is invalid");
  }
  const canonicalPath = await realpath(path);
  return {
    bytes: await readBoundedRegularFile(canonicalPath, maximumBytes),
    path: canonicalPath,
  };
}

function passwordBytes(input: Buffer): Buffer {
  let end = input.length;
  if (end > 0 && input[end - 1] === 0x0a) end -= 1;
  if (end > 0 && input[end - 1] === 0x0d) end -= 1;
  if (end === 0 || input.subarray(0, end).includes(0)) {
    throw new Error("Keystore password file is invalid");
  }
  return Buffer.from(input.subarray(0, end));
}

function scrypt(
  passphrase: Buffer,
  salt: Buffer,
  length: number,
  options: { N: number; p: number; r: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(passphrase, salt, length, options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function pbkdf2(
  passphrase: Buffer,
  salt: Buffer,
  iterations: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2Callback(
      passphrase,
      salt,
      iterations,
      32,
      "sha256",
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

async function deriveKey(
  crypto: z.infer<typeof cryptoSchema>,
  passphrase: Buffer,
): Promise<Buffer> {
  const salt = Buffer.from(crypto.kdfparams.salt, "hex");
  if (crypto.kdf === "pbkdf2") {
    return pbkdf2(passphrase, salt, crypto.kdfparams.c);
  }
  const requiredMemory = 128 * crypto.kdfparams.n * crypto.kdfparams.r;
  if (requiredMemory > MAXIMUM_SCRYPT_MEMORY_BYTES) {
    throw new Error("Scrypt memory requirement exceeds the signer limit");
  }
  return scrypt(passphrase, salt, 32, {
    N: crypto.kdfparams.n,
    p: crypto.kdfparams.p,
    r: crypto.kdfparams.r,
    maxmem: Math.max(requiredMemory * 2, 32 * 1024 * 1024),
  });
}

async function decryptKeystore(
  keystoreBytes: Buffer,
  passphrase: Buffer,
): Promise<{ account: PrivateKeyAccount; address: `0x${string}` }> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(keystoreBytes.toString("utf8"));
  } catch {
    throw new Error("Keystore JSON is invalid");
  }
  const parsed = keystoreSchema.parse(decoded);
  const crypto = parsed.crypto ?? parsed.Crypto;
  if (crypto === undefined) throw new Error("Keystore crypto is missing");
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");
  const derivedKey = await deriveKey(crypto, passphrase);
  let privateKey: Buffer | undefined;
  try {
    const computedMac = keccak256(
      new Uint8Array(Buffer.concat([derivedKey.subarray(16, 32), ciphertext])),
    );
    if (
      !timingSafeEqual(
        Buffer.from(computedMac.slice(2), "hex"),
        Buffer.from(crypto.mac, "hex"),
      )
    ) {
      throw new Error("Keystore authentication failed");
    }
    const decipher = createDecipheriv(
      "aes-128-ctr",
      derivedKey.subarray(0, 16),
      Buffer.from(crypto.cipherparams.iv, "hex"),
    );
    privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (privateKey.length !== 32 || privateKey.every((byte) => byte === 0)) {
      throw new Error("Decrypted private key is invalid");
    }
    const account = privateKeyToAccount(`0x${privateKey.toString("hex")}`);
    const recordedAddress = getAddress(`0x${parsed.address}`);
    if (account.address !== recordedAddress) {
      throw new Error("Keystore address does not match its private key");
    }
    return { account, address: recordedAddress };
  } finally {
    derivedKey.fill(0);
    privateKey?.fill(0);
  }
}

export async function withIsolatedKeystoreAccount<T>(
  input: IsolatedKeystoreInput,
  operation: (account: PrivateKeyAccount) => Promise<T> | T,
): Promise<T> {
  const [keystoreFile, passwordFile] = await Promise.all([
    resolveRegularFile(input.keystorePath, MAXIMUM_KEYSTORE_BYTES),
    resolveRegularFile(input.passwordFilePath, MAXIMUM_PASSWORD_BYTES),
  ]);
  if (keystoreFile.path === passwordFile.path) {
    throw new Error("Keystore and password paths must differ");
  }
  const expectedAddress = getAddress(String(input.expectedAddress));
  const keystoreBytes = keystoreFile.bytes;
  const rawPassphrase = passwordFile.bytes;
  const passphrase = passwordBytes(rawPassphrase);
  rawPassphrase.fill(0);
  try {
    const decrypted = await decryptKeystore(keystoreBytes, passphrase);
    if (decrypted.address !== expectedAddress) {
      throw new Error("Keystore does not match the configured signer");
    }
    return await operation(decrypted.account);
  } finally {
    passphrase.fill(0);
    keystoreBytes.fill(0);
  }
}

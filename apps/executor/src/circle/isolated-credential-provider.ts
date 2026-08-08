import { createHash } from "node:crypto";
import { ExecutorError } from "../errors.js";
import { parseCircleApiKey, parseCircleCiphertext } from "./schemas.js";
import type { CircleCredentialProvider } from "./types.js";

export function createIsolatedCircleCredentialProvider(
  source: CircleCredentialProvider,
): CircleCredentialProvider {
  const consumedCiphertextDigests = new Set<string>();
  let generationTail: Promise<void> = Promise.resolve();

  return Object.freeze({
    async getApiKey(): Promise<string> {
      try {
        return parseCircleApiKey(await source.getApiKey());
      } catch {
        throw new ExecutorError("CREDENTIAL_UNAVAILABLE");
      }
    },

    createEntitySecretCiphertext(): Promise<string> {
      const generated = generationTail.then(async () => {
        let ciphertext: string;
        try {
          ciphertext = parseCircleCiphertext(
            await source.createEntitySecretCiphertext(),
          );
        } catch {
          throw new ExecutorError("CREDENTIAL_UNAVAILABLE");
        }
        const digest = createHash("sha256").update(ciphertext).digest("hex");
        if (consumedCiphertextDigests.has(digest)) {
          throw new ExecutorError("CREDENTIAL_UNAVAILABLE");
        }
        consumedCiphertextDigests.add(digest);
        return ciphertext;
      });
      generationTail = generated.then(
        () => undefined,
        () => undefined,
      );
      return generated;
    },
  });
}

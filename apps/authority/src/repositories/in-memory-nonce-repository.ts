import { AuthorityError } from "../errors.js";
import type { AuthorizationNonceRepository } from "../ports/repositories.js";

export class InMemoryNonceRepository implements AuthorizationNonceRepository {
  readonly #reservedByIdentity = new Map<string, bigint>();
  readonly #identitiesByNonce = new Map<bigint, string>();
  #nextCandidate: bigint;
  #tail: Promise<void> = Promise.resolve();

  constructor(firstNonce = 1n) {
    this.#nextCandidate = firstNonce;
  }

  reserve(
    identity: string,
    isConsumed: (nonce: bigint) => Promise<boolean>,
  ): Promise<bigint> {
    const operation = this.#tail.then(async () => {
      const existing = this.#reservedByIdentity.get(identity);
      if (existing !== undefined) return existing;

      for (let attempts = 0; attempts < 10_000; attempts += 1) {
        const candidate = this.#nextCandidate;
        this.#nextCandidate += 1n;
        if (this.#identitiesByNonce.has(candidate)) continue;
        if (await isConsumed(candidate)) continue;
        this.#reservedByIdentity.set(identity, candidate);
        this.#identitiesByNonce.set(candidate, identity);
        return candidate;
      }
      throw new AuthorityError(
        "NONCE_EXHAUSTED",
        "No unused authorization nonce is available",
      );
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

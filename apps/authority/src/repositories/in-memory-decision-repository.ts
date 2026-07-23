import { AuthorityError } from "../errors.js";
import type {
  ApprovedDecisionRecord,
  ApprovedDecisionRepository,
} from "../ports/repositories.js";

export class InMemoryDecisionRepository implements ApprovedDecisionRepository {
  readonly #records = new Map<string, Promise<ApprovedDecisionRecord>>();

  async getOrCreate(
    identity: string,
    create: () => Promise<ApprovedDecisionRecord>,
  ): Promise<ApprovedDecisionRecord> {
    const existing = this.#records.get(identity);
    if (existing !== undefined) return existing;

    const pending = Promise.resolve().then(create);
    this.#records.set(identity, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.#records.get(identity) === pending)
        this.#records.delete(identity);
      if (error instanceof AuthorityError) throw error;
      throw new AuthorityError(
        "IDEMPOTENCY_CONFLICT",
        "Approved decision repository operation failed",
      );
    }
  }
}

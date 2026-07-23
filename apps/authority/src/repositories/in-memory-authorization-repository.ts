import { AuthorityError } from "../errors.js";
import type {
  AuthorizationRepository,
  AuthorizationReservation,
} from "../ports/repositories.js";
import type { RawSignedAuthorizationReceipt } from "../types.js";

type AuthorizationRecord = {
  reservation?: AuthorizationReservation;
  pending: Promise<RawSignedAuthorizationReceipt> | undefined;
  completed?: RawSignedAuthorizationReceipt;
};

export class InMemoryAuthorizationRepository implements AuthorizationRepository {
  readonly #records = new Map<string, AuthorizationRecord>();

  async getOrCreate(
    identity: string,
    reserve: () => Promise<AuthorizationReservation>,
    issue: (
      reservation: AuthorizationReservation,
    ) => Promise<RawSignedAuthorizationReceipt>,
  ): Promise<RawSignedAuthorizationReceipt> {
    let record = this.#records.get(identity);
    if (record === undefined) {
      record = { pending: undefined };
      this.#records.set(identity, record);
    }
    if (record.completed !== undefined) return record.completed;
    if (record.pending !== undefined) return record.pending;

    const operation = (async () => {
      record.reservation ??= await reserve();
      const receipt = await issue(record.reservation);
      record.completed = receipt;
      return receipt;
    })();
    record.pending = operation;
    try {
      return await operation;
    } catch (error) {
      if (error instanceof AuthorityError) throw error;
      throw new AuthorityError(
        "IDEMPOTENCY_CONFLICT",
        "Authorization repository operation failed",
      );
    } finally {
      if (record.pending === operation) record.pending = undefined;
    }
  }
}

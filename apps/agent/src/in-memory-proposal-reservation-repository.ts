import type { ProposalReservationRepository } from "./ports.js";
import type { AgentProposalResult, ProposalReservation } from "./types.js";

type MutableRecord = {
  reservation?: ProposalReservation;
  pending: Promise<ProposalReservation> | undefined;
};

export class InMemoryProposalReservationRepository implements ProposalReservationRepository {
  readonly #records = new Map<string, MutableRecord>();
  #nextNonce = 0n;

  async reserve(
    identity: string,
    createReservation: (nonce: unknown) => Promise<ProposalReservation>,
  ): Promise<unknown> {
    let record = this.#records.get(identity);
    if (record === undefined) {
      record = { pending: undefined };
      this.#records.set(identity, record);
    }
    if (record.reservation !== undefined) return record.reservation;
    if (record.pending !== undefined) return record.pending;

    const nonce = this.#nextNonce;
    this.#nextNonce += 1n;
    const operation = createReservation(nonce).then((reservation) => {
      record.reservation = reservation;
      return reservation;
    });
    record.pending = operation;
    try {
      return await operation;
    } finally {
      if (record.pending === operation) record.pending = undefined;
    }
  }

  get(identity: string): Promise<unknown> {
    return Promise.resolve(this.#records.get(identity)?.reservation);
  }

  storeCompleted(
    identity: string,
    result: AgentProposalResult,
  ): Promise<unknown> {
    const record = this.#records.get(identity);
    if (record?.reservation === undefined) {
      throw new Error("Cannot complete an unreserved proposal");
    }
    record.reservation = Object.freeze({
      ...record.reservation,
      completedResult: result,
    });
    return Promise.resolve(undefined);
  }
}

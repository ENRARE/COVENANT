import type { AuditEvent, RuntimeProjection } from "../schemas.js";

export type LockState = "AVAILABLE" | "BUSY" | "STALE";

export type JournalSnapshot = Readonly<{
  timeline: readonly AuditEvent[];
  lock: LockState;
}>;

export type MutationSession = {
  readonly timeline: readonly AuditEvent[];
  append(event: AuditEvent): Promise<void>;
};

export type RuntimeStore = {
  read(): Promise<JournalSnapshot>;
  mutate<T>(
    runtimeId: string | null,
    operation: (session: MutationSession) => Promise<T>,
  ): Promise<T>;
  reset(): Promise<void>;
};

export type RuntimeStateReader = {
  getState(): Promise<RuntimeProjection>;
};

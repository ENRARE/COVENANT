import { keccak256, stringToHex } from "viem";
import {
  auditEventSchema,
  type AuditEvent,
  type AuditEventType,
} from "./schemas.js";
import type { ScenarioId } from "./configuration.js";

export type EventClock = { now(): unknown };
export type EventIdGenerator = {
  createEventId(input: {
    schemaVersion: "1";
    runtimeId: string;
    sequence: string;
    eventType: AuditEventType;
    scenarioId: ScenarioId | "";
  }): unknown;
};

export const deterministicEventIdGenerator: EventIdGenerator = {
  createEventId(input) {
    return keccak256(
      stringToHex(
        [
          input.schemaVersion,
          input.runtimeId,
          input.sequence,
          input.eventType,
          input.scenarioId,
        ].join(":"),
      ),
    );
  },
};

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function parseAndFreezeEvent(value: unknown): AuditEvent {
  return deepFreeze(auditEventSchema.parse(structuredClone(value)));
}

export function createAuditEvent(input: {
  runtimeId: string;
  sequence: string;
  eventType: AuditEventType;
  scenarioId?: ScenarioId;
  occurredAt: string;
  fields?: Readonly<Record<string, unknown>>;
  eventIdGenerator?: EventIdGenerator;
}): AuditEvent {
  const generator = input.eventIdGenerator ?? deterministicEventIdGenerator;
  const eventId = generator.createEventId({
    schemaVersion: "1",
    runtimeId: input.runtimeId,
    sequence: input.sequence,
    eventType: input.eventType,
    scenarioId: input.scenarioId ?? "",
  });
  return parseAndFreezeEvent({
    schemaVersion: "1",
    runtimeId: input.runtimeId,
    eventId,
    sequence: input.sequence,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
    ...(input.fields ?? {}),
  });
}

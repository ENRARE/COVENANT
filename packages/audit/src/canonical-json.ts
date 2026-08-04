import { keccak256, stringToHex, type Hex } from "viem";
import { AuditProjectionError } from "./errors.js";

export type CanonicalJsonValue =
  | boolean
  | null
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function canonicalize(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) {
    return (value as readonly CanonicalJsonValue[]).map((item) =>
      canonicalize(item),
    );
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(
      value as Readonly<Record<string, CanonicalJsonValue>>,
    ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(
      entries.map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: CanonicalJsonValue): string {
  try {
    return JSON.stringify(canonicalize(value));
  } catch {
    throw new AuditProjectionError("AUDIT_SERIALIZATION_FAILURE");
  }
}

export function canonicalDigest(value: CanonicalJsonValue): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

import {
  parseArcExecutionEvidence,
  parseCircleProviderEvidence,
} from "./schemas.js";
import type {
  ArcExecutionEvidence,
  CircleProviderEvidence,
  ExecutionReconciliation,
} from "./types.js";

const PROVIDER_FAILURE_STATES = new Set(["FAILED", "DENIED", "CANCELLED"]);
const PROVIDER_EXECUTION_LIKE_STATES = new Set([
  "SENT",
  "CONFIRMED",
  "COMPLETE",
]);

export function reconcileCircleAndArcEvidence(
  rawProvider: unknown,
  rawArc: unknown,
): ExecutionReconciliation {
  let arc: ArcExecutionEvidence;
  try {
    arc = parseArcExecutionEvidence(rawArc);
  } catch {
    arc = Object.freeze({
      status: "EVIDENCE_CONFLICT",
      reason: "MALFORMED_ARC_EVIDENCE",
    });
  }
  let provider: CircleProviderEvidence;
  try {
    provider = parseCircleProviderEvidence(rawProvider);
  } catch {
    return Object.freeze({
      classification: "EVIDENCE_CONFLICT",
      provider: Object.freeze({ status: "UNKNOWN" }),
      arc,
    });
  }

  let classification: ExecutionReconciliation["classification"];
  if (arc.status === "EVIDENCE_CONFLICT") {
    classification = "EVIDENCE_CONFLICT";
  } else if (arc.status === "OBSERVATION_UNAVAILABLE") {
    classification = "OBSERVATION_UNAVAILABLE";
  } else if (arc.status === "NOT_OBSERVED") {
    classification =
      provider.status === "OBSERVED" ? "PROVIDER_ONLY" : "ARC_NOT_OBSERVED";
  } else {
    const hashConflict =
      provider.status === "OBSERVED" &&
      provider.transactionHash !== undefined &&
      provider.transactionHash !== arc.transactionHash;
    const stateConflict =
      provider.status === "OBSERVED" &&
      (arc.status === "OBSERVED_SUCCESS"
        ? PROVIDER_FAILURE_STATES.has(provider.providerState)
        : PROVIDER_EXECUTION_LIKE_STATES.has(provider.providerState));
    if (hashConflict || stateConflict) {
      classification = "EVIDENCE_CONFLICT";
    } else {
      classification =
        arc.status === "OBSERVED_SUCCESS"
          ? "ARC_EXECUTION_SUCCEEDED"
          : "ARC_EXECUTION_REVERTED";
    }
  }
  return Object.freeze({ classification, provider, arc });
}

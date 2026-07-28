import { DEMO_ACTIONS, type DemoAction } from "./actions.js";
import { deepFreeze } from "./audit-events.js";
import {
  COMPROMISED_SCENARIO_ID,
  DEMO_MODE,
  FROZEN_DEMO,
  HAPPY_SCENARIO_ID,
  type ScenarioId,
} from "./configuration.js";
import {
  runtimeProjectionSchema,
  type AuditEvent,
  type RuntimeProjection,
} from "./schemas.js";
import type { LockState } from "./storage/runtime-store.js";

function availableActions(
  status: RuntimeProjection["status"],
): readonly DemoAction[] {
  if (status === "UNINITIALIZED") {
    return ["RESET", "SEED", "GET_HEALTH", "GET_STATE"];
  }
  if (status === "SEEDED") return [...DEMO_ACTIONS];
  if (status === "COMPLETED") {
    return ["RESET", "RUN_DEMO", "GET_HEALTH", "GET_STATE"];
  }
  return ["RESET", "GET_HEALTH", "GET_STATE"];
}

function currentScenario(
  timeline: readonly AuditEvent[],
  status: RuntimeProjection["status"],
): ScenarioId | null {
  if (status === "COMPLETED" || timeline.length <= 2) return null;
  const lastScenario = [...timeline]
    .reverse()
    .find((event) => "scenarioId" in event);
  return lastScenario !== undefined && "scenarioId" in lastScenario
    ? lastScenario.scenarioId
    : null;
}

export function projectRuntimeState(input: {
  timeline: readonly AuditEvent[];
  lock: LockState;
}): RuntimeProjection {
  const timeline = input.timeline;
  const runtimeId = timeline[0]?.runtimeId ?? null;
  let status: RuntimeProjection["status"];
  if (timeline.length === 0) status = "UNINITIALIZED";
  else if (timeline.length === 2) status = "SEEDED";
  else if (timeline.length === 17) status = "COMPLETED";
  else status = input.lock === "BUSY" ? "RUNNING" : "INTERRUPTED";

  const lastDecision = [...timeline]
    .reverse()
    .find(
      (event) =>
        event.eventType === "DECISION_APPROVED" ||
        event.eventType === "DECISION_REJECTED",
    );
  let latestDecision: RuntimeProjection["latestDecision"] = null;
  if (
    lastDecision?.eventType === "DECISION_APPROVED" ||
    lastDecision?.eventType === "DECISION_REJECTED"
  ) {
    const rules = [...timeline]
      .reverse()
      .find(
        (event) =>
          event.eventType === "RULES_EVALUATED" &&
          event.scenarioId === lastDecision.scenarioId,
      );
    latestDecision = {
      scenarioId: lastDecision.scenarioId,
      status:
        lastDecision.eventType === "DECISION_APPROVED"
          ? "APPROVED"
          : "REJECTED",
      decisionId: lastDecision.decisionId,
      failedRuleIds:
        rules?.eventType === "RULES_EVALUATED"
          ? rules.ruleResults
              .filter((result) => result.status === "FAIL")
              .map((result) => result.ruleId)
          : [],
    };
  }
  const submission = [...timeline]
    .reverse()
    .find((event) => event.eventType === "SUBMISSION_SIMULATED");
  const latestSubmission =
    submission?.eventType === "SUBMISSION_SIMULATED"
      ? {
          status: "SIMULATED_SUBMISSION" as const,
          reference: submission.submissionReference,
        }
      : null;
  const projection = runtimeProjectionSchema.parse({
    schemaVersion: "1",
    runtimeId,
    mode: DEMO_MODE,
    status,
    currentScenario: currentScenario(timeline, status),
    health: {
      storage: timeline.length === 0 ? "MISSING" : "READY",
      lock: input.lock,
      seeded: timeline.length >= 2,
      arc: "NOT_CONFIGURED",
      circle: "NOT_CONFIGURED",
    },
    covenant:
      timeline.length >= 2
        ? {
            covenantId: FROZEN_DEMO.covenantId,
            productId: FROZEN_DEMO.productId,
            tokenSymbol: "USDC",
            chainId: FROZEN_DEMO.chainId.toString(),
          }
        : null,
    latestDecision,
    latestSubmission,
    timeline: structuredClone(timeline),
    availableActions: availableActions(status),
  });
  return deepFreeze(projection);
}

export { HAPPY_SCENARIO_ID, COMPROMISED_SCENARIO_ID };

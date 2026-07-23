import {
  CANONICAL_RULE_IDS,
  canonicalRuleResultsSchema,
  ruleResultSchema,
  type CanonicalRuleResults,
  type RuleResult,
} from "@covenant/spec";

export type RuleResultInput = {
  ruleId: (typeof CANONICAL_RULE_IDS)[number];
  passed: boolean;
  expected: string;
  actual: string;
  passReason?: string;
  failReason: string;
};

export function createRuleResult(input: RuleResultInput): RuleResult {
  return ruleResultSchema.parse({
    ruleId: input.ruleId,
    status: input.passed ? "PASS" : "FAIL",
    expected: input.expected,
    actual: input.actual,
    reason: input.passed
      ? (input.passReason ?? input.ruleId)
      : input.failReason,
  });
}

export function createCanonicalRuleResults(
  inputs: readonly RuleResultInput[],
): CanonicalRuleResults {
  if (inputs.length !== CANONICAL_RULE_IDS.length) {
    throw new Error("Canonical rule construction is incomplete");
  }
  return canonicalRuleResultsSchema.parse(inputs.map(createRuleResult));
}

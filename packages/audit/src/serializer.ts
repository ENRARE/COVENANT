import { canonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import { projectAuditTimeline } from "./projector.js";

export function projectAuditTimelineJson(input: unknown): string {
  return `${canonicalJson(
    projectAuditTimeline(input) as unknown as CanonicalJsonValue,
  )}\n`;
}

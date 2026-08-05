import "server-only";
import canonicalTimeline from "@/data/audit-timeline.json";
import { createAuditDisplayModel } from "@/lib/audit-display";

const fixture: unknown = canonicalTimeline;

export function loadCanonicalAuditDisplayModel() {
  return createAuditDisplayModel(fixture);
}

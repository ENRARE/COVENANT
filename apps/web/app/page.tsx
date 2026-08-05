import { AuditConsole } from "@/components/audit-console";
import { TimelineUnavailable } from "@/components/timeline-unavailable";
import { loadCanonicalAuditDisplayModel } from "@/lib/audit-fixture.server";

export default function AuditConsolePage() {
  try {
    return <AuditConsole model={loadCanonicalAuditDisplayModel()} />;
  } catch {
    return <TimelineUnavailable />;
  }
}

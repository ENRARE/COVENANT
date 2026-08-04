import {
  canonicalJson,
  deepFreeze,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import { sanitizeAuditError } from "./errors.js";
import { projectAuditTimelineJson } from "./serializer.js";

export const MAX_AUDIT_COMMAND_INPUT_BYTES = 1_048_576;

export type AuditCommandResult = Readonly<{
  exitCode: 0 | 1;
  output: string;
}>;

export function executeAuditCommand(
  inputText: string,
  hasArguments = false,
): AuditCommandResult {
  try {
    if (
      hasArguments ||
      new TextEncoder().encode(inputText).byteLength >
        MAX_AUDIT_COMMAND_INPUT_BYTES
    ) {
      throw new Error("malformed command input");
    }
    const input: unknown = JSON.parse(inputText);
    return deepFreeze({
      exitCode: 0,
      output: projectAuditTimelineJson(input),
    });
  } catch (error) {
    return deepFreeze({
      exitCode: 1,
      output: `${canonicalJson(
        sanitizeAuditError(error).toJSON() as unknown as CanonicalJsonValue,
      )}\n`,
    });
  }
}

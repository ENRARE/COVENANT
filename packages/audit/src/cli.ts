import {
  executeAuditCommand,
  MAX_AUDIT_COMMAND_INPUT_BYTES,
} from "./command.js";

async function readStandardInput(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (Buffer.byteLength(input, "utf8") > MAX_AUDIT_COMMAND_INPUT_BYTES) {
      throw new Error("input limit exceeded");
    }
  }
  return input;
}

async function main(): Promise<void> {
  let text = "";
  try {
    text = await readStandardInput();
  } catch {
    text = "x".repeat(MAX_AUDIT_COMMAND_INPUT_BYTES + 1);
  }
  const result = executeAuditCommand(text, process.argv.length !== 2);
  process.exitCode = result.exitCode;
  process.stdout.write(result.output);
}

void main();

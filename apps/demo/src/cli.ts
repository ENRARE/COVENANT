import { createDemoRuntime } from "./runtime.js";
import { DemoError, sanitizeDemoError } from "./errors.js";

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  try {
    if (arguments_.length !== 1) throw new DemoError("MALFORMED_ACTION");
    const result = await createDemoRuntime().executeDemoAction(arguments_[0]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.exitCode = 1;
    process.stdout.write(`${JSON.stringify(sanitizeDemoError(error))}\n`);
  }
}

void main();

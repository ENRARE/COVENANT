import { pathToFileURL } from "node:url";
import { createKeystorePaymentIntentSigner } from "./signers/keystore-payment-intent-signer.js";

const CIRCLE_VARIABLES = [
  "CIRCLE_API_KEY",
  "CIRCLE_ENTITY_SECRET",
  "CIRCLE_ENTITY_SECRET_HEX",
] as const;

async function readInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 128 * 1024) throw new Error("Signer request is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function runAgentSignerCli(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (CIRCLE_VARIABLES.some((name) => environment[name] !== undefined)) {
    throw new Error("Circle credentials are forbidden in signer processes");
  }
  const keystorePath = environment.COVENANT_AGENT_KEYSTORE_PATH;
  const passwordFilePath = environment.COVENANT_AGENT_PASSWORD_FILE;
  const expectedAddress = environment.COVENANT_AGENT_SIGNER_ADDRESS;
  if (!keystorePath || !passwordFilePath || !expectedAddress) {
    throw new Error("Agent signer configuration is unavailable");
  }
  const signature = await createKeystorePaymentIntentSigner({
    keystorePath,
    passwordFilePath,
    expectedAddress,
  }).signPaymentIntent(await readInput());
  return String(signature);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runAgentSignerCli().then(
    (signature) => process.stdout.write(`${signature}\n`),
    () => {
      process.stderr.write("Agent signing failed\n");
      process.exitCode = 1;
    },
  );
}

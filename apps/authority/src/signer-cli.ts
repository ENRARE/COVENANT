import { pathToFileURL } from "node:url";
import { createKeystoreReceiptSigner } from "./signers/keystore-receipt-signer.js";

const CIRCLE_VARIABLES = [
  "CIRCLE_API_KEY",
  "CIRCLE_ENTITY_SECRET",
  "CIRCLE_ENTITY_SECRET_HEX",
] as const;

async function readInput(): Promise<{ kind: unknown; typedData: unknown }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > 128 * 1024) throw new Error("Signer request is too large");
    chunks.push(bytes);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    kind?: unknown;
    typedData?: unknown;
  };
  return { kind: value.kind, typedData: value.typedData };
}

export async function runAuthoritySignerCli(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (CIRCLE_VARIABLES.some((name) => environment[name] !== undefined)) {
    throw new Error("Circle credentials are forbidden in signer processes");
  }
  const keystorePath = environment.COVENANT_AUTHORIZATION_KEYSTORE_PATH;
  const passwordFilePath = environment.COVENANT_AUTHORIZATION_PASSWORD_FILE;
  const expectedAddress = environment.COVENANT_AUTHORIZATION_SIGNER_ADDRESS;
  if (!keystorePath || !passwordFilePath || !expectedAddress) {
    throw new Error("Authorization signer configuration is unavailable");
  }
  const request = await readInput();
  const signer = createKeystoreReceiptSigner({
    keystorePath,
    passwordFilePath,
    expectedAddress,
  });
  if (request.kind === "decision") {
    return String(await signer.signDecisionReceipt(request.typedData));
  }
  if (request.kind === "authorization") {
    return String(await signer.signAuthorizationReceipt(request.typedData));
  }
  throw new Error("Authorization signer operation is invalid");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runAuthoritySignerCli().then(
    (signature) => process.stdout.write(`${signature}\n`),
    () => {
      process.stderr.write("Authorization signing failed\n");
      process.exitCode = 1;
    },
  );
}

import { pathToFileURL } from "node:url";
import { createKeystoreInvoiceSigner } from "./invoice-signer.js";

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

export async function runVendorSignerCli(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (CIRCLE_VARIABLES.some((name) => environment[name] !== undefined)) {
    throw new Error("Circle credentials are forbidden in signer processes");
  }
  const keystorePath = environment.COVENANT_VENDOR_KEYSTORE_PATH;
  const passwordFilePath = environment.COVENANT_VENDOR_PASSWORD_FILE;
  const expectedAddress = environment.COVENANT_VENDOR_SIGNER_ADDRESS;
  const recipient = environment.COVENANT_VENDOR_RECIPIENT;
  const token = environment.COVENANT_VENDOR_TOKEN;
  const productId = environment.COVENANT_VENDOR_PRODUCT_ID;
  const purpose = environment.COVENANT_VENDOR_PURPOSE;
  const maximum = environment.COVENANT_VENDOR_MAXIMUM_BASE_UNITS;
  if (
    !keystorePath ||
    !passwordFilePath ||
    !expectedAddress ||
    !recipient ||
    !token ||
    !productId ||
    !purpose ||
    !maximum ||
    !/^(0|[1-9]\d*)$/u.test(maximum)
  ) {
    throw new Error("Vendor signer configuration is unavailable");
  }
  const signature = await createKeystoreInvoiceSigner({
    keystorePath,
    passwordFilePath,
    expectedAddress,
    recipient,
    token,
    productId,
    purpose,
    maximumAmountBaseUnits: BigInt(maximum),
  }).signInvoice(await readInput());
  return String(signature);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runVendorSignerCli().then(
    (signature) => process.stdout.write(`${signature}\n`),
    () => {
      process.stderr.write("Vendor signing failed\n");
      process.exitCode = 1;
    },
  );
}

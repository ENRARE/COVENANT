import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const COV010_RUNTIME_TRUST_ANCHOR_PATH =
  "deployment/arc-testnet/cov010-runtime-trust-anchor.json";
export const COV010_DEPLOYMENT_MANIFEST_PATH =
  "evidence/arc-testnet/cov-010/deployment-manifest.json";

const FIELD_MAPPINGS = Object.freeze([
  ["covenantId", "constructor", "covenantId"],
  ["issuer", "constructor", "issuer"],
  ["agentSigner", "constructor", "agentSigner"],
  ["authorizationSigner", "constructor", "authorizationSigner"],
  ["vaultAddress", null, "contractAddress"],
  ["chainId", null, "chainId"],
  ["tokenAddress", "constructor", "token"],
  ["recipientAddress", "constructor", "recipient"],
  ["maxAmountPerPayment", "constructor", "maxAmountPerPayment"],
  ["totalBudget", "constructor", "totalBudget"],
  ["maxPaymentCount", "constructor", "maxPaymentCount"],
  ["validAfter", "constructor", "validAfter"],
  ["validUntil", "constructor", "validUntil"],
  ["purpose", "constructor", "purpose"],
  ["policyHash", "constructor", "policyHash"],
  ["policyVersion", "constructor", "policyVersion"],
]);

function requireRecord(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

export function verifyCov010RuntimeTrustAnchor(anchorInput, manifestInput) {
  const anchor = requireRecord(anchorInput, "runtime trust anchor");
  const provenance = requireRecord(anchor.provenance, "provenance");
  const covenantSpec = requireRecord(anchor.covenantSpec, "covenantSpec");
  const manifest = requireRecord(manifestInput, "deployment manifest");
  const constructor = requireRecord(
    manifest.constructor,
    "manifest constructor",
  );

  if (anchor.trustAnchorVersion !== "1") {
    throw new Error("Unsupported runtime trust-anchor version");
  }
  if (
    provenance.kind !== "RECONSTRUCTED_RUNTIME_PROJECTION" ||
    provenance.historicalCovenantSpecRecovered !== false ||
    provenance.createdAtProvenance !==
      "NORMALIZED_TO_VALID_AFTER_FOR_RUNTIME_SCHEMA_ONLY"
  ) {
    throw new Error("Runtime trust-anchor provenance mismatch");
  }
  if (
    provenance.sourceManifest !== COV010_DEPLOYMENT_MANIFEST_PATH ||
    provenance.sourceGitCommit !== manifest.sourceGitCommit ||
    provenance.deploymentTransactionHash !==
      manifest.deploymentTransactionHash ||
    provenance.deploymentBlockNumber !== manifest.deploymentBlockNumber ||
    provenance.deploymentBlockHash !== manifest.deploymentBlockHash
  ) {
    throw new Error("Runtime trust-anchor deployment provenance mismatch");
  }

  for (const [anchorField, manifestSection, manifestField] of FIELD_MAPPINGS) {
    const expected =
      manifestSection === "constructor"
        ? constructor[manifestField]
        : manifest[manifestField];
    if (covenantSpec[anchorField] !== expected) {
      throw new Error(`Runtime trust-anchor mismatch: ${anchorField}`);
    }
  }
  if (covenantSpec.createdAt !== covenantSpec.validAfter) {
    throw new Error("Runtime createdAt must equal validAfter");
  }

  return covenantSpec;
}

function main() {
  try {
    const root = resolve(import.meta.dirname, "..");
    const anchor = JSON.parse(
      readFileSync(resolve(root, COV010_RUNTIME_TRUST_ANCHOR_PATH), "utf8"),
    );
    const manifest = JSON.parse(
      readFileSync(resolve(root, COV010_DEPLOYMENT_MANIFEST_PATH), "utf8"),
    );
    verifyCov010RuntimeTrustAnchor(anchor, manifest);
    process.stdout.write("COV-010 runtime trust anchor verified.\n");
  } catch {
    process.stderr.write("COV-010 runtime trust-anchor verification failed.\n");
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const assignedValue = String.raw`(?:["'][^"'\s]{8,}["']|[^\s#"']{12,})`;

const uuid = String.raw`[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}`;

const nonZeroUuid = String.raw`(?!00000000-0000-0000-0000-000000000000\b)${uuid}`;

function contextualUuid(field) {
  return String.raw`["']?${field}["']?\s*[:=]\s*["']?${nonZeroUuid}["']?`;
}

const patternSources = [
  ["private key block", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],

  ["GitHub token", ["gh", "p_[A-Za-z0-9]{30,}"].join("")],

  ["GitHub fine-grained token", ["github", "_pat_[A-Za-z0-9_]{30,}"].join("")],

  ["AWS access key", ["AK", "IA[0-9A-Z]{16}"].join("")],

  ["npm token", ["npm", "_[A-Za-z0-9]{20,}"].join("")],

  ["npmrc auth token", String.raw`_authToken\s*=\s*[^\s#]{8,}`],

  ["OpenAI API key", ["sk", "-(?:proj-)?[A-Za-z0-9_-]{20,}"].join("")],

  [
    "Circle API key assignment",
    String.raw`CIRCLE_API_KEY\s*[:=]\s*${assignedValue}`,
  ],

  [
    "Circle server API key",
    [
      "(?:TEST|LIVE)",
      "_API_KEY:",
      "[A-Za-z0-9_-]{8,}",
      ":",
      "[A-Za-z0-9_-]{8,}",
    ].join(""),
  ],

  [
    "Circle entity secret assignment",
    String.raw`CIRCLE_ENTITY_SECRET(?:_CIPHERTEXT)?\s*[:=]\s*${assignedValue}`,
  ],

  [
    "Circle raw entity secret",
    String.raw`(?:circleEntitySecret|entitySecret|entity_secret)\s*["']?\s*[:=]\s*["']?(?:0x)?[0-9a-f]{64}["']?`,
  ],

  [
    "Circle entity-secret ciphertext",
    String.raw`(?:entitySecretCiphertext|entity_secret_ciphertext)\s*["']?\s*[:=]\s*${assignedValue}`,
  ],

  [
    "Authorization bearer token",
    String.raw`Authorization\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+/=-]{12,}`,
  ],

  ["Circle wallet ID", contextualUuid("walletId")],

  ["Circle wallet-set ID", contextualUuid("walletSetId")],

  ["Circle transaction ID", contextualUuid("transactionId")],

  ["Circle contract ID", contextualUuid("contractId")],

  [
    "Circle contract ID collection",
    String.raw`["']?contractIds["']?\s*[:=]\s*\[[^\]\r\n]{0,512}["']?${nonZeroUuid}["']?`,
  ],

  [
    "recovery material",
    String.raw`(?:recoveryPhrase|recoveryCode|recoveryCodes|recoveryData|recoveryContents?|mnemonic|seedPhrase)\s*["']?\s*[:=]\s*(?:["'][^"'\r\n]{12,}["']|\[[^\]\r\n]{12,}\])`,
  ],

  [
    "Supabase service role key",
    String.raw`SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*${assignedValue}`,
  ],

  [
    "contextual raw private key",
    String.raw`(?:PRIVATE_KEY|SIGNER_KEY|WALLET_KEY|AUTHORIZATION_KEY|AGENT_KEY)\s*[:=]\s*["']?0x[0-9a-f]{64}["']?`,
  ],

  [
    "credential assignment",
    String.raw`(?:password|passwd|api[_-]?key|secret[_-]?key)\s*[:=]\s*${assignedValue}`,
  ],
];

export function findingsForText(text, file = "input") {
  return patternSources.flatMap(([label, source]) =>
    new RegExp(source, "giu").test(text) ? [`${file}: ${label}`] : [],
  );
}

export function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "git ls-files failed");
  }

  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export function scanRepository() {
  return repositoryFiles().flatMap((file) => {
    try {
      const content = readFileSync(file, "utf8");

      return content.includes("\0") ? [] : findingsForText(content, file);
    } catch {
      return [];
    }
  });
}

if (process.argv[1]?.endsWith("scan-secrets.mjs")) {
  const findings = scanRepository();

  if (findings.length > 0) {
    console.error(`Potential credentials detected:\n${findings.join("\n")}`);
    process.exit(1);
  }

  console.log("Repository credential scan passed.");
}

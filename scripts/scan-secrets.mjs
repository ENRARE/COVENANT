import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const assignedValue = String.raw`(?:["'][^"'\s]{8,}["']|[^\s#"']{12,})`;
const patternSources = [
  ["private key block", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
  ["GitHub token", ["gh", "p_[A-Za-z0-9]{30,}"].join("")],
  ["GitHub fine-grained token", ["github", "_pat_[A-Za-z0-9_]{30,}"].join("")],
  ["AWS access key", ["AK", "IA[0-9A-Z]{16}"].join("")],
  ["npm token", ["npm", "_[A-Za-z0-9]{20,}"].join("")],
  ["npmrc auth token", String.raw`_authToken\s*=\s*[^\s#]{8,}`],
  ["OpenAI API key", ["sk", "-(?:proj-)?[A-Za-z0-9_-]{20,}"].join("")],
  ["Circle API key", String.raw`CIRCLE_API_KEY\s*[:=]\s*${assignedValue}`],
  [
    "Circle entity secret",
    String.raw`CIRCLE_ENTITY_SECRET(?:_CIPHERTEXT)?\s*[:=]\s*${assignedValue}`,
  ],
  [
    "Supabase service role key",
    String.raw`SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*${assignedValue}`,
  ],
  [
    "contextual raw private key",
    String.raw`(?:PRIVATE_KEY|SIGNER_KEY|WALLET_KEY|AUTHORIZATION_KEY|AGENT_KEY)\s*[:=]\s*["']?0x[0-9a-fA-F]{64}["']?`,
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
  if (result.status !== 0)
    throw new Error(result.stderr || "git ls-files failed");
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

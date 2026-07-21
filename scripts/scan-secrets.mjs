import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const patternSources = [
  ["private key block", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
  ["GitHub token", ["gh", "p_[A-Za-z0-9]{30,}"].join("")],
  ["AWS access key", ["AK", "IA[0-9A-Z]{16}"].join("")],
  [
    "credential assignment",
    String.raw`(?:password|passwd|api[_-]?key|secret[_-]?key)\s*[:=]\s*["'][^"'\s]{8,}["']`,
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

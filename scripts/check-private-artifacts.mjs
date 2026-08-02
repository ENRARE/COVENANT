import { spawnSync } from "node:child_process";

const exactForbiddenNames = new Map([
  ["role-wallets.local.json", "role wallet registry"],
  [
    "cov-010-deployment-operation.local.json",
    "private Circle deployment operation",
  ],
]);

function gitLines(arguments_) {
  const result = spawnSync("git", arguments_, {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${arguments_.join(" ")} failed`);
  }

  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export function privateArtifactReason(file) {
  const normalized = String(file).replaceAll("\\", "/");
  const name = normalized.split("/").at(-1)?.toLowerCase() ?? "";
  const documentationFile = /\.(?:md|mdx)$/iu.test(name);

  const exactReason = exactForbiddenNames.get(name);

  if (exactReason !== undefined) {
    return exactReason;
  }

  if (/(^|\/)covenant-circle-bootstrap(\/|$)/iu.test(normalized)) {
    return "private bootstrap directory";
  }

  if (!documentationFile && name.includes("recovery")) {
    return "recovery artifact";
  }

  if (!documentationFile && /entity[-_.]?secret/iu.test(name)) {
    return "entity-secret artifact";
  }

  if (!documentationFile && /circle[-_.]?api[-_.]?key/iu.test(name)) {
    return "Circle API-key artifact";
  }

  return undefined;
}

export function candidateRepositoryFiles() {
  const visibleFiles = gitLines(["ls-files", "-co", "--exclude-standard"]);

  const stagedFiles = gitLines([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);

  return [...new Set([...visibleFiles, ...stagedFiles])].sort();
}

export function privateArtifactFindings(files = candidateRepositoryFiles()) {
  return files.flatMap((file) => {
    const reason = privateArtifactReason(file);

    return reason === undefined ? [] : [`${file}: ${reason}`];
  });
}

if (process.argv[1]?.endsWith("check-private-artifacts.mjs")) {
  const findings = privateArtifactFindings();

  if (findings.length > 0) {
    console.error(
      `Forbidden private artifacts detected:\n${findings.join("\n")}`,
    );
    process.exit(1);
  }

  console.log("Private-artifact policy passed.");
}

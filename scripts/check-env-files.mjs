import { spawnSync } from "node:child_process";

const result = spawnSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "--", "*.env", ".env*", "**/.env*"],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}
const unexpected = result.stdout
  .split(/\r?\n/u)
  .filter(Boolean)
  .filter((file) => !file.endsWith(".env.example"));
if (unexpected.length > 0) {
  console.error(`Unexpected environment files:\n${unexpected.join("\n")}`);
  process.exit(1);
}
console.log("Environment-file policy passed.");

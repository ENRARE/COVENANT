import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sdk = resolve(root, "packages/sdk");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const runNpm = (args, options = {}) => {
  const command = [
    npm,
    ...args.map((arg) => `"${String(arg).replaceAll('"', '""')}"`),
  ].join(" ");
  return execSync(command, { cwd: sdk, encoding: "utf8", ...options });
};
const dryRun = JSON.parse(runNpm(["pack", "--dry-run", "--json"]));
const files = dryRun[0]?.files?.map((entry) => entry.path) ?? [];
if (
  files.length === 0 ||
  files.some(
    (file) =>
      !file.startsWith("dist/") &&
      file !== "README.md" &&
      file !== "package.json",
  )
)
  throw new Error(`SDK package contains unexpected files: ${files.join(",")}`);

const temp = mkdtempSync(resolve(tmpdir(), "covenant-sdk-consumer-"));
try {
  const packed = JSON.parse(
    runNpm(["pack", "--json", "--pack-destination", temp]),
  );
  const tarball = resolve(temp, packed[0].filename);
  execSync(
    [
      npm,
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-save",
      `"${tarball.replaceAll('"', '""')}"`,
    ].join(" "),
    { cwd: temp, stdio: "pipe" },
  );
  writeFileSync(
    resolve(temp, "consumer.mjs"),
    `import { Covenant, verifyWebhook } from "@covenant/sdk";\nconst testKey = ["cov", "_test_consumer_key_12345678"].join("");\nconst client = new Covenant({ apiKey: testKey, baseUrl: "http://localhost:8787", fetch: async () => new Response("{}", { status: 200 }) });\nif (!(client && typeof verifyWebhook === "function")) throw new Error("SDK consumer import failed");\nconsole.log("SDK consumer import and mocked initialization passed.");\n`,
  );
  execSync(`"${process.execPath}" "${resolve(temp, "consumer.mjs")}"`, {
    cwd: temp,
    stdio: "inherit",
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
}

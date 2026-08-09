import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createCov020AuditSourceBundle,
  projectAuditTimelineJson,
} from "../packages/audit/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(
    resolve(root, "evidence/arc-testnet/cov-010/deployment-manifest.json"),
    "utf8",
  ),
);
const target = resolve(root, "apps/web/data/audit-timeline.json");

if (process.argv.length !== 2) {
  process.stderr.write("COV-020 fixture generation accepts no arguments.\n");
  process.exitCode = 1;
} else {
  writeFileSync(
    target,
    projectAuditTimelineJson(createCov020AuditSourceBundle(manifest)),
    "utf8",
  );
}

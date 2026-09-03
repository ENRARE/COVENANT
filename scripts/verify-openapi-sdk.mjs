import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const openapi = JSON.parse(
  await readFile(resolve(root, "apps/api/openapi.json"), "utf8"),
);
const { SDK_ROUTE_CONTRACT } = await import(
  pathToFileURL(resolve(root, "packages/sdk/dist/routes.js")).href
);
const expected = new Set(
  SDK_ROUTE_CONTRACT.map(
    ({ method, path }) => `${method.toUpperCase()} ${path}`,
  ),
);
const documented = new Set();
for (const [path, item] of Object.entries(openapi.paths ?? {})) {
  if (path === "/health" || path === "/ready") continue;
  for (const method of Object.keys(item)) {
    if (["get", "post", "delete", "patch", "put"].includes(method))
      documented.add(`${method.toUpperCase()} ${path}`);
  }
}
const missing = [...expected].filter((route) => !documented.has(route));
const unexpected = [...documented].filter((route) => !expected.has(route));
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `OpenAPI/SDK drift: missing=${missing.join(",")} unexpected=${unexpected.join(",")}`,
  );
}
console.log(
  `OpenAPI/SDK route contract aligned (${String(expected.size)} routes).`,
);

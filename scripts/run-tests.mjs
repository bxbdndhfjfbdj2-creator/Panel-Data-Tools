import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const group = process.argv[2] ?? "all";

const ignoredDirectories = new Set([
  ".git",
  ".output",
  ".nitro",
  ".vercel",
  "audit",
  "dist",
  "node_modules",
]);

function findTests(directory, extensions) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : findTests(path, extensions);
    }
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

const typescriptTests = findTests(root, [".test.ts"]);
const platformSourceTest = (path) => {
  const rel = relative(root, path).replaceAll("\\", "/");
  return /^src\/lib\/(app-data|auth)\//.test(rel);
};
const platformTests = [
  ...findTests(join(root, "scripts"), [".test.mjs"]),
  ...typescriptTests.filter(platformSourceTest),
].sort();
const businessTests = typescriptTests.filter((path) => !platformSourceTest(path)).sort();
const groups = {
  business: { files: businessTests },
  platform: { files: platformTests },
};

if (group !== "all" && !(group in groups)) {
  console.error(`Unknown test group: ${group}. Use all, business, or platform.`);
  process.exit(2);
}

const selected = group === "all" ? Object.keys(groups) : [group];
const failures = [];
for (const name of selected) {
  const { files } = groups[name];
  if (files.length === 0) {
    console.error(`${name} test group discovered no test files.`);
    failures.push(name);
    continue;
  }
  const args = ["--import", "tsx", "--test", ...files];
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`${name} tests could not start: ${result.error.message}`);
  }
  if (result.error || result.status !== 0) failures.push(name);
}

for (const name of selected) {
  const state = failures.includes(name) ? "FAIL" : "PASS";
  console.log(`${name} tests: ${state} (${groups[name].files.length} test files)`);
}
if (failures.length) {
  console.error(`Failed test groups: ${failures.join(", ")}`);
  process.exitCode = 1;
}

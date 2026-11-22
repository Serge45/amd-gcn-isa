import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testDir = path.join("out", "test");
const files = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith(".test.js"))
  .sort()
  .map((file) => path.join(testDir, file));

if (files.length === 0) {
  console.error(`No test files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);

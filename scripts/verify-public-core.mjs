#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const steps = [
  ["build:core-public"],
  ["test:core-public"],
  ["test:skill-public"],
  ["cli-contracts:check"],
  ["scan:secrets"],
  ["demo:public-alpha"]
];

for (const [script] of steps) {
  process.stderr.write(`[verify-public-core] ${script}\n`);
  const command = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, "run", script]
    : ["run", script];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Open Insight public Core verification passed.");

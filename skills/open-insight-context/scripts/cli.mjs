#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelFreeChildEnv } from "./child-env.mjs";
import { ensureCoreRoot } from "./core-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function assertReadOnlyCommand(args) {
  const command = args[0];
  if (!command || command === "--help" || command === "-h") return;
  if (["validate", "inspect", "context"].includes(command)) return;
  if (command === "mcp" && args[1] === "serve") return;
  if (command === "version" && (!args[1] || ["status", "log"].includes(args[1]))) return;
  throw new Error(
    "本 Skill 的 CLI wrapper 只开放只读命令：validate、inspect、context、mcp serve、version/status/log。文件夹编译请使用 compile-folder.mjs。"
  );
}

function resolvePathArgument(args, index, invocationRoot) {
  if (typeof args[index] === "string" && args[index] && !args[index].startsWith("--")) {
    args[index] = path.resolve(invocationRoot, args[index]);
  }
}

function resolvePathOption(args, name, invocationRoot) {
  const index = args.indexOf(name);
  if (index >= 0 && typeof args[index + 1] === "string" && !args[index + 1].startsWith("--")) {
    args[index + 1] = path.resolve(invocationRoot, args[index + 1]);
  }
}

function normalizeUserPaths(inputArgs, invocationRoot) {
  const args = [...inputArgs];
  if (["validate", "inspect"].includes(args[0])) resolvePathArgument(args, 1, invocationRoot);
  if (args[0] === "context") resolvePathArgument(args, 2, invocationRoot);
  if (args[0] === "mcp" && args[1] === "serve" && args[2] !== "--unbound") resolvePathArgument(args, 2, invocationRoot);
  if (args[0] === "version" && ["status", "log"].includes(args[1])) resolvePathArgument(args, 2, invocationRoot);
  for (const option of ["--direct-baseline", "--direct-baseline-summary"]) {
    resolvePathOption(args, option, invocationRoot);
  }
  return args;
}

async function main() {
  const invocationRoot = process.cwd();
  const userArgs = process.argv.slice(2);
  assertReadOnlyCommand(userArgs);
  const coreRoot = await ensureCoreRoot({
    scriptDir,
    invocationRoot,
    requiredPaths: ["apps/cli/dist/index.js", "spec/schemas"]
  });
  const args = normalizeUserPaths(userArgs, invocationRoot);
  const result = spawnSync(process.execPath, [path.join(coreRoot, "apps", "cli", "dist", "index.js"), ...args], {
    cwd: coreRoot,
    stdio: "inherit",
    shell: false,
    env: createModelFreeChildEnv({
      INIT_CWD: coreRoot
    })
  });
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

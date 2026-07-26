#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelFreeChildEnv } from "./child-env.mjs";
import { defaultCoreInstallRoot, normalizeCoreRef } from "./core-release.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findCoreRoot() {
  const realScriptDir = await realpath(scriptDir).catch(() => scriptDir);
  const requestedCoreRef = normalizeCoreRef();
  const candidates = [
    process.env.OPEN_INSIGHT_CORE_HOME,
    process.cwd(),
    path.resolve(scriptDir, "../../.."),
    path.resolve(realScriptDir, "../../.."),
    defaultCoreInstallRoot(requestedCoreRef)
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (
      (await exists(path.join(root, "package.json"))) &&
      (await exists(path.join(root, "apps", "cli", "dist", "index.js"))) &&
      (await exists(path.join(root, "spec", "schemas")))
    ) {
      return root;
    }
  }
  return undefined;
}

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
  if (args[0] === "mcp" && args[1] === "serve") resolvePathArgument(args, 2, invocationRoot);
  if (args[0] === "version" && ["status", "log"].includes(args[1])) resolvePathArgument(args, 2, invocationRoot);
  for (const option of ["--direct-baseline", "--direct-baseline-summary"]) {
    resolvePathOption(args, option, invocationRoot);
  }
  return args;
}

async function main() {
  const invocationRoot = process.cwd();
  const coreRoot = await findCoreRoot();
  if (!coreRoot) {
    throw new Error("未找到已构建的 Open Insight Core。请先运行本 Skill 的 bootstrap.mjs。");
  }

  const userArgs = process.argv.slice(2);
  assertReadOnlyCommand(userArgs);
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

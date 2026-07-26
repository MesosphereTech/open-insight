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
    if ((await exists(path.join(root, "package.json"))) && (await exists(path.join(root, "scripts", "compile-context-folder.mjs")))) return root;
  }
  return undefined;
}

async function main() {
  const invocationRoot = process.cwd();
  const coreRoot = await findCoreRoot();
  if (!coreRoot) {
    console.error("未找到 Open Insight Core。请先运行本 Skill 的 bootstrap.mjs。");
    process.exit(1);
  }
  const forwardedArgs = process.argv.slice(2);
  const ocrFlagIndex = forwardedArgs.indexOf("--ocr");
  const allowOcr = ocrFlagIndex >= 0 && forwardedArgs[ocrFlagIndex + 1] === "llm";
  const result = spawnSync(process.execPath, [path.join(coreRoot, "scripts", "compile-context-folder.mjs"), ...forwardedArgs], {
    cwd: coreRoot,
    stdio: "inherit",
    shell: false,
    env: createModelFreeChildEnv(
      {
        OPEN_INSIGHT_SKILL_INVOCATION_ROOT: invocationRoot,
        OPEN_INSIGHT_SKILL_CLI_WRAPPER: path.join(scriptDir, "cli.mjs")
      },
      { allowOcr }
    )
  });
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

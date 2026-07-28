import { spawnSync } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { createModelFreeChildEnv } from "./child-env.mjs";
import { defaultCoreInstallRoot, normalizeCoreRef } from "./core-release.mjs";

const disabledValues = new Set(["0", "false", "no", "off"]);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function candidateRoots(scriptDir) {
  if (process.env.OPEN_INSIGHT_CORE_HOME) {
    return [process.env.OPEN_INSIGHT_CORE_HOME];
  }

  const realScriptDir = await realpath(scriptDir).catch(() => scriptDir);
  return [
    process.cwd(),
    path.resolve(scriptDir, "../../.."),
    path.resolve(realScriptDir, "../../.."),
    defaultCoreInstallRoot(normalizeCoreRef())
  ];
}

export async function findCoreRoot({ scriptDir, requiredPaths }) {
  for (const candidate of await candidateRoots(scriptDir)) {
    const root = path.resolve(candidate);
    if (
      (await exists(path.join(root, "package.json"))) &&
      (await Promise.all(requiredPaths.map((relativePath) => exists(path.join(root, relativePath))))).every(Boolean)
    ) {
      return root;
    }
  }
  return undefined;
}

function autoBootstrapEnabled() {
  return !disabledValues.has(String(process.env.OPEN_INSIGHT_AUTO_BOOTSTRAP ?? "1").trim().toLowerCase());
}

function forwardBootstrapOutput(result) {
  if (result.stdout) process.stderr.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
}

export async function ensureCoreRoot({ scriptDir, requiredPaths, invocationRoot }) {
  const existingCore = await findCoreRoot({ scriptDir, requiredPaths });
  if (existingCore) return existingCore;

  if (!autoBootstrapEnabled()) {
    throw new Error(
      "尚未准备 Open Insight Core，且 OPEN_INSIGHT_AUTO_BOOTSTRAP 已关闭。请删除该设置后重试，或手动运行本 Skill 的 bootstrap.mjs 排障。"
    );
  }

  process.stderr.write("[Open Insight] 首次使用：正在准备固定版本的本地 Open Insight Core。\n");
  const result = spawnSync(process.execPath, [path.join(scriptDir, "bootstrap.mjs")], {
    cwd: invocationRoot,
    encoding: "utf8",
    timeout: 1_200_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    env: createModelFreeChildEnv({
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    })
  });
  forwardBootstrapOutput(result);

  if (result.error || result.status !== 0) {
    const reason = result.error?.message || `退出码 ${result.status ?? 1}`;
    throw new Error(`首次准备 Open Insight Core 失败（${reason}）。请查看上方诊断，修复后直接重试原命令。`);
  }

  const installedCore = await findCoreRoot({ scriptDir, requiredPaths });
  if (!installedCore) {
    throw new Error("Core 准备流程已结束，但仍未找到可用的 Open Insight Core。请运行本 Skill 的 bootstrap.mjs 查看完整诊断。");
  }
  return installedCore;
}

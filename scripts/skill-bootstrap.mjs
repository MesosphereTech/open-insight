#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const checkOnly = process.argv.includes("--check-only");
const outputDirIndex = process.argv.indexOf("--output-dir");
const outputDirValue = outputDirIndex >= 0 ? process.argv[outputDirIndex + 1] : undefined;

if (outputDirIndex >= 0 && (!outputDirValue || outputDirValue.startsWith("--"))) {
  console.error("--output-dir 缺少目录值");
  process.exit(1);
}

const outputDir = path.resolve(repoRoot, outputDirValue || "output");
const jsonPath = path.join(outputDir, "open-insight-skill-bootstrap.json");
const markdownPath = path.join(outputDir, "open-insight-skill-bootstrap.md");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const runtimeArtifacts = [
  "packages/insight-core/dist/index.js",
  "packages/insight-validator/dist/index.js",
  "packages/insight-runtime/dist/index.js",
  "packages/insight-domain-packs/dist/index.js",
  "packages/insight-compiler/dist/index.js",
  "apps/cli/dist/index.js",
  "apps/cli/dist/mcpServer.js"
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/(?:sk)-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/(?:OPEN_INSIGHT_MODEL|XIAOMI)_API_KEY=\S+/gu, "MODEL_API_KEY=[REDACTED]");
}

function createModelFreeChildEnv() {
  const blockedPatterns = [
    /^OPEN_INSIGHT_MODEL_/iu,
    /^XIAOMI_/iu,
    /^OPENAI_/iu,
    /^ANTHROPIC_/iu,
    /^GEMINI_/iu,
    /^DEEPSEEK_/iu,
    /^AZURE_OPENAI_/iu,
    /^(?:GOOGLE|VERTEX)_.*(?:API_KEY|TOKEN)$/iu,
    /^VITE_.*(?:API_KEY|TOKEN|SECRET)$/iu,
    /^CODEX_.*(?:API_KEY|TOKEN|SECRET)$/iu
  ];
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !blockedPatterns.some((pattern) => pattern.test(name)))
  );
}

function run(command, args, label) {
  const actualCommand = process.platform === "win32" ? "cmd.exe" : command;
  const actualArgs = process.platform === "win32" ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(actualCommand, actualArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...createModelFreeChildEnv(), FORCE_COLOR: "0", NO_COLOR: "1" }
  });

  return {
    label,
    command: [command, ...args].join(" "),
    ok: !result.error && result.status === 0,
    exit_code: result.status ?? (result.error ? 1 : 0),
    stdout: redact(result.stdout ?? "").trim().slice(0, 2000),
    stderr: redact(result.stderr ?? "").trim().slice(0, 2000),
    ...(result.error ? { error: redact(result.error.message) } : {})
  };
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const packagePath = path.join(repoRoot, "package.json");
  const skillPath = path.join(repoRoot, "skills", "open-insight-context", "SKILL.md");
  const packageExists = await exists(packagePath);
  let packageName;
  if (packageExists) {
    try {
      packageName = JSON.parse(await readFile(packagePath, "utf8")).name;
    } catch {
      packageName = undefined;
    }
  }

  const skillExists = await exists(skillPath);
  const npmVersion = run(npmCommand, ["--version"], "npm_version");
  const nodeModulesBefore = await exists(path.join(repoRoot, "node_modules"));
  const install =
    !checkOnly && packageName === "open-insight" && !nodeModulesBefore
      ? run(npmCommand, ["install"], "npm_install")
      : undefined;
  const dependenciesReady = await exists(path.join(repoRoot, "node_modules"));
  const artifactsBefore = await Promise.all(
    runtimeArtifacts.map(async (relativePath) => ({ relative_path: relativePath, exists: await exists(path.join(repoRoot, relativePath)) }))
  );
  const build =
    !checkOnly && packageName === "open-insight" && dependenciesReady && artifactsBefore.some((item) => !item.exists)
      ? run(npmCommand, ["run", "build:core"], "build_core")
      : undefined;
  const artifacts = await Promise.all(
    runtimeArtifacts.map(async (relativePath) => ({ relative_path: relativePath, exists: await exists(path.join(repoRoot, relativePath)) }))
  );
  const runtimeReady = artifacts.every((item) => item.exists);
  const cliVersion =
    packageName === "open-insight" && dependenciesReady && runtimeReady
      ? run(npmCommand, ["run", "--silent", "cli", "--", "version"], "cli_version")
      : undefined;
  const cliReady = cliVersion?.ok === true;
  const mcpReady = cliReady && artifacts.some((item) => item.relative_path === "apps/cli/dist/mcpServer.js" && item.exists);

  const status =
    !packageExists || packageName !== "open-insight" || !skillExists
      ? "needs_core"
      : !dependenciesReady
        ? "needs_install"
        : !runtimeReady
          ? "needs_build"
          : !cliReady || !mcpReady
            ? "needs_repair"
            : "ready";

  const report = {
    schema_version: "open-insight.core-skill-bootstrap.v0.1",
    status,
    mode: checkOnly ? "check_only" : "check_and_install",
    core_root_recorded: false,
    package_name: packageName ?? "unknown",
    skill_ready: skillExists,
    dependencies_ready: dependenciesReady,
    runtime_ready: runtimeReady,
    cli_ready: cliReady,
    mcp_ready: mcpReady,
    runtime_artifacts: artifacts,
    install_attempted: Boolean(install),
    build_attempted: Boolean(build),
    checks: {
      npm_version: npmVersion,
      ...(install ? { npm_install: install } : {}),
      ...(build ? { build_core: build } : {}),
      ...(cliVersion ? { cli_version: cliVersion } : {})
    },
    next_actions:
      status === "ready"
        ? ["运行 context Skill 的文件夹编译或 demo:core-context。", "通过 CLI 或 MCP 只读访问生成的 .insight 单文件。"]
        : checkOnly
          ? ["退出 check-only 后重新运行 bootstrap，允许安装依赖和构建本地 Core。"]
          : ["确认当前目录是 Open Insight Core 仓库根目录，并检查 npm install / build:core 诊断。"],
    safety: {
      model_invoked: false,
      model_env_forwarded: false,
      api_key_recorded: false,
      source_files_uploaded: false,
      package_code_executed: false,
      base_package_mutation: false
    },
    outputs: {
      json: path.relative(repoRoot, jsonPath).replaceAll(path.sep, "/"),
      markdown: path.relative(repoRoot, markdownPath).replaceAll(path.sep, "/")
    }
  };

  const markdown = [
    "# Open Insight Core Skill Bootstrap",
    "",
    `- status: \`${report.status}\``,
    `- mode: \`${report.mode}\``,
    `- dependencies_ready: \`${report.dependencies_ready}\``,
    `- runtime_ready: \`${report.runtime_ready}\``,
    `- cli_ready: \`${report.cli_ready}\``,
    `- mcp_ready: \`${report.mcp_ready}\``,
    "",
    "## 下一步",
    "",
    ...report.next_actions.map((item) => `- ${item}`),
    "",
    "## 安全边界",
    "",
    "- 不调用模型，不转发模型环境变量。",
    "- 不上传来源文件，不执行包内代码。",
    "- 不写回 .insight base package。"
  ].join("\n");

  await writeAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeAtomic(markdownPath, `${markdown}\n`);
  console.log(`Open Insight Core Skill bootstrap: ${status}`);
  console.log(`JSON: ${report.outputs.json}`);
  console.log(`Markdown: ${report.outputs.markdown}`);

  if (status !== "ready" && !checkOnly) process.exit(1);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

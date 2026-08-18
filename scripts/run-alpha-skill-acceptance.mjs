#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelFreeChildEnv } from "../skills/open-insight-context/scripts/child-env.mjs";
import { OPEN_INSIGHT_DEFAULT_CORE_REF } from "../skills/open-insight-context/scripts/core-release.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const planOnly = process.argv.includes("--plan-only");
const keepWorkdir = process.argv.includes("--keep-workdir");
const formatIndex = process.argv.indexOf("--format");
const jsonOutput = formatIndex >= 0 && process.argv[formatIndex + 1] === "json";
const gitCommand = process.platform === "win32" ? "git.exe" : "git";
const plannedSteps = [
  "snapshot_current_commit",
  "install_standalone_skill",
  "compile_single_insight",
  "validate_package",
  "read_cli_summary",
  "read_cli_output_recommendations",
  "read_cli_answer_context",
  "read_mcp_answer_context",
  "read_mcp_output_recommendations"
];

function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/(?:sk)-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1[REDACTED]@");
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 900_000,
    shell: false,
    env: options.env ?? createModelFreeChildEnv({ FORCE_COLOR: "0", NO_COLOR: "1" }),
    input: options.input
  });
  return {
    ok: !result.error && result.status === 0,
    exit_code: result.status ?? (result.error ? 1 : 0),
    duration_ms: Date.now() - startedAt,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
    error: result.error ? redact(result.error.message) : undefined
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function equivalentJson(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 没有返回有效 JSON。`);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function publicStep(id, result) {
  return {
    id,
    status: result.ok ? "passed" : "failed",
    duration_ms: result.duration_ms,
    exit_code: result.exit_code,
    ...(result.ok ? {} : { diagnostic_cn: (result.stderr || result.error || "命令失败").trim().slice(-1200) })
  };
}

async function writeReport(report) {
  const outputDir = path.join(repoRoot, "output");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "alpha-skill-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = [
    "# Open Insight Alpha Skill 首次使用彩排",
    "",
    `- status: \`${report.status}\``,
    `- source_commit: \`${report.source_commit ?? "not_checked"}\``,
    `- core_ref: \`${report.core_ref}\``,
    `- acceptance_core_ref: \`${report.acceptance_core_ref ?? "not_created"}\``,
    `- outside_repo: \`${report.environment.outside_repo}\``,
    `- unicode_space_path: \`${report.environment.unicode_space_path}\``,
    `- working_tree_clean: \`${report.environment.working_tree_clean ?? "not_checked"}\``,
    `- single_file_insight: \`${report.results?.single_file_insight ?? false}\``,
    `- cli_mcp_answer_context_parity: \`${report.results?.cli_mcp_answer_context_parity ?? false}\``,
    `- cli_mcp_output_recommendations_parity: \`${report.results?.cli_mcp_output_recommendations_parity ?? false}\``,
    "",
    "## 步骤",
    "",
    ...(report.steps ?? []).map((step) => `- ${step.id}: \`${step.status}\` (${step.duration_ms} ms)`),
    "",
    "## 安全边界",
    "",
    "- 不调用模型，不转发模型密钥。",
    "- 不读取私有业务材料，只使用脚本生成的公开测试文本。",
    "- 不执行 `.insight` 包内代码，不写回 base package。",
    "- 临时安装目录默认在完成后删除。"
  ].join("\n");
  await writeFile(path.join(outputDir, "alpha-skill-acceptance.md"), `${markdown}\n`, "utf8");
}

async function main() {
  if (planOnly) {
    const report = {
      schema_version: "open-insight.alpha-skill-acceptance.v0.1",
      status: "planned",
      core_ref: OPEN_INSIGHT_DEFAULT_CORE_REF,
      steps: plannedSteps,
      environment: { outside_repo: true, unicode_space_path: true },
      safety: { model_invoked: false, private_materials_read: false, base_package_mutation: false }
    };
    console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha Skill acceptance: ${report.status}`);
    return;
  }

  const sourceCommitResult = run(gitCommand, ["rev-parse", "HEAD"]);
  const worktreeResult = run(gitCommand, ["status", "--porcelain", "--untracked-files=normal"]);
  if (!sourceCommitResult.ok || !worktreeResult.ok) {
    const report = {
      schema_version: "open-insight.alpha-skill-acceptance.v0.1",
      status: "failed",
      core_ref: OPEN_INSIGHT_DEFAULT_CORE_REF,
      environment: { outside_repo: true, unicode_space_path: true, working_tree_clean: false },
      steps: [],
      diagnostic_cn: "无法确认当前 Git commit 或工作区状态。",
      safety: { model_invoked: false, model_env_forwarded: false, private_materials_read: false, base_package_mutation: false }
    };
    await writeReport(report);
    console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha Skill acceptance: ${report.status}`);
    process.exit(1);
  }
  const sourceCommit = sourceCommitResult.stdout.trim();
  const acceptanceCoreRef =
    process.env.OPEN_INSIGHT_ACCEPTANCE_CORE_REF?.trim() ||
    `open-insight-alpha-acceptance-${sourceCommit.slice(0, 12)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(acceptanceCoreRef)) {
    throw new Error("OPEN_INSIGHT_ACCEPTANCE_CORE_REF 不是安全的 Git ref。");
  }
  const workingTreeClean = worktreeResult.stdout.trim().length === 0;
  if (!workingTreeClean) {
    const changedFileCount = worktreeResult.stdout.trim().split(/\r?\n/u).filter(Boolean).length;
    const report = {
      schema_version: "open-insight.alpha-skill-acceptance.v0.1",
      status: "dirty_worktree",
      source_commit: sourceCommit,
      core_ref: OPEN_INSIGHT_DEFAULT_CORE_REF,
      acceptance_core_ref: acceptanceCoreRef,
      environment: { outside_repo: true, unicode_space_path: true, working_tree_clean: false },
      steps: [],
      diagnostic_cn: `当前有 ${changedFileCount} 个未提交路径；彩排只验证 commit，已拒绝用旧 HEAD 代表工作区改动。请先提交后重试。`,
      safety: { model_invoked: false, model_env_forwarded: false, private_materials_read: false, base_package_mutation: false }
    };
    await writeReport(report);
    console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha Skill acceptance: ${report.status}`);
    process.exit(1);
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-alpha-acceptance-"));
  const releaseSource = path.join(tempRoot, "release-source");
  const consumerRoot = path.join(tempRoot, "普通用户 首次使用");
  const standaloneSkill = path.join(consumerRoot, "open-insight-context");
  const installRoot = path.join(tempRoot, "installed-core");
  const materialsDir = path.join(consumerRoot, "中文 测试材料");
  const steps = [];
  let report;

  try {
    process.stderr.write("[alpha-skill-acceptance] 1/9 创建当前提交的临时发布快照。\n");
    const snapshot = run(gitCommand, ["clone", "--no-local", "--single-branch", repoRoot, releaseSource], {
      timeoutMs: 300_000
    });
    steps.push(publicStep("snapshot_current_commit", snapshot));
    if (!snapshot.ok) throw new Error(`无法创建临时发布快照。\n${snapshot.stderr}`);
    const snapshotCommit = run(gitCommand, ["rev-parse", "HEAD"], { cwd: releaseSource });
    if (!snapshotCommit.ok || snapshotCommit.stdout.trim() !== sourceCommit) {
      throw new Error("临时发布快照与当前 commit 不一致。");
    }
    const existingTag = run(
      gitCommand,
      ["rev-parse", "--verify", `refs/tags/${acceptanceCoreRef}^{commit}`],
      { cwd: releaseSource }
    );
    if (existingTag.ok) {
      if (existingTag.stdout.trim() !== sourceCommit) {
        throw new Error(
          `验收 tag ${acceptanceCoreRef} 已存在，但没有指向当前 commit。`
        );
      }
    } else {
      const tag = run(gitCommand, ["tag", acceptanceCoreRef], {
        cwd: releaseSource
      });
      if (!tag.ok) throw new Error(`无法为临时发布快照创建固定 tag。\n${tag.stderr}`);
    }

    await mkdir(consumerRoot, { recursive: true });
    await cp(path.join(releaseSource, "skills", "open-insight-context"), standaloneSkill, { recursive: true });
    const env = createModelFreeChildEnv({
      OPEN_INSIGHT_CORE_HOME: installRoot,
      OPEN_INSIGHT_CORE_REPOSITORY: releaseSource,
      OPEN_INSIGHT_CORE_REF: acceptanceCoreRef,
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    });

    process.stderr.write("[alpha-skill-acceptance] 2/9 从独立 Skill 安装固定版本 Core。\n");
    const bootstrap = run(process.execPath, [path.join(standaloneSkill, "scripts", "bootstrap.mjs")], {
      cwd: consumerRoot,
      env,
      timeoutMs: 1_200_000
    });
    steps.push(publicStep("install_standalone_skill", bootstrap));
    if (!bootstrap.ok) throw new Error(`独立 Skill bootstrap 失败。\n${bootstrap.stderr}`);
    const installReport = parseJson(
      await readFile(path.join(consumerRoot, "output", "open-insight-skill-install.json"), "utf8"),
      "Skill install report"
    );
    if (installReport.status !== "ready" || installReport.core_ref_verified !== true) {
      throw new Error(`Skill 安装没有验证固定 Core：status=${installReport.status}。`);
    }
    if (installReport.core_commit !== sourceCommit) throw new Error("Skill 安装的 Core commit 与发布快照不一致。");

    await mkdir(materialsDir, { recursive: true });
    await writeFile(
      path.join(materialsDir, "经营说明.md"),
      "# 经营说明\n\n本期收入为 120 万元。\n\n## 风险\n\n回款周期延长可能影响现金流。\n",
      "utf8"
    );
    const cliWrapper = path.join(standaloneSkill, "scripts", "cli.mjs");
    const packageRelative = path.join("output", "github-alpha.source-bundled.insight");

    process.stderr.write("[alpha-skill-acceptance] 3/9 在仓库外编译单文件 .insight。\n");
    const compile = run(
      process.execPath,
      [
        path.join(standaloneSkill, "scripts", "compile-folder.mjs"),
        "--source-dir", "中文 测试材料",
        "--output-dir", "output",
        "--base-name", "github-alpha",
        "--mode", "source_bundled",
        "--parser", "builtin",
        "--format", "json"
      ],
      { cwd: consumerRoot, env }
    );
    steps.push(publicStep("compile_single_insight", compile));
    if (!compile.ok) throw new Error(`仓库外编译失败。\n${compile.stderr}`);
    const compileReport = parseJson(compile.stdout, "compile report");
    const packagePath = path.join(consumerRoot, packageRelative);
    const singleFileInsight =
      compileReport.packages?.length === 1 &&
      (await exists(packagePath)) &&
      (await stat(packagePath)).isFile() &&
      !(await exists(`${packagePath}.zip`));
    if (!singleFileInsight) throw new Error("编译结果不是唯一的单文件 .insight。");

    process.stderr.write("[alpha-skill-acceptance] 4/9 校验生成包。\n");
    const validate = run(process.execPath, [cliWrapper, "validate", packageRelative, "--format", "json"], {
      cwd: consumerRoot,
      env
    });
    steps.push(publicStep("validate_package", validate));
    const validateReport = validate.ok ? parseJson(validate.stdout, "validate result") : undefined;
    if (!validate.ok || validateReport.status !== "valid") throw new Error(`生成包校验未通过。\n${validate.stderr}`);

    process.stderr.write("[alpha-skill-acceptance] 5/9 通过 CLI 读取上下文摘要。\n");
    const summary = run(process.execPath, [cliWrapper, "context", "summary", packageRelative, "--format", "json"], {
      cwd: consumerRoot,
      env
    });
    steps.push(publicStep("read_cli_summary", summary));
    const summaryReport = summary.ok ? parseJson(summary.stdout, "context summary") : undefined;
    if (!summary.ok || summaryReport.status !== "ok") throw new Error(`CLI summary 读取失败。\n${summary.stderr}`);
    if (summaryReport.source_mode !== "source_bundled") throw new Error("CLI summary 没有确认 source_bundled。");

    process.stderr.write("[alpha-skill-acceptance] 6/9 通过 CLI 读取编译后输出建议。\n");
    const outputRecommendations = run(
      process.execPath,
      [cliWrapper, "context", "recommend-outputs", packageRelative, "--format", "json"],
      { cwd: consumerRoot, env }
    );
    steps.push(publicStep("read_cli_output_recommendations", outputRecommendations));
    const outputRecommendationsReport = outputRecommendations.ok
      ? parseJson(outputRecommendations.stdout, "output recommendations")
      : undefined;
    if (
      !outputRecommendations.ok ||
      outputRecommendationsReport.status !== "ok" ||
      outputRecommendationsReport.recommendations?.length < 3 ||
      outputRecommendationsReport.model_invoked !== false ||
      outputRecommendationsReport.base_package_mutation !== false
    ) {
      throw new Error(`CLI output recommendations 未返回安全的可选内容与格式。\n${outputRecommendations.stderr}`);
    }

    process.stderr.write("[alpha-skill-acceptance] 7/9 通过 CLI 获取有界回答上下文。\n");
    const answerContext = run(
      process.execPath,
      [
        cliWrapper,
        "context", "answer-context", packageRelative,
        "--query", "本期收入是多少？",
        "--token-budget", "1200",
        "--max-follow-up-reads", "2",
        "--format", "json"
      ],
      { cwd: consumerRoot, env }
    );
    steps.push(publicStep("read_cli_answer_context", answerContext));
    const answerReport = answerContext.ok ? parseJson(answerContext.stdout, "answer-context") : undefined;
    if (!answerContext.ok || answerReport.status !== "ready") {
      throw new Error(`CLI answer-context 未返回可消费上下文。\n${answerContext.stderr}`);
    }

    process.stderr.write("[alpha-skill-acceptance] 8/9 通过 MCP 获取等价回答上下文。\n");
    const mcpInput = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "alpha-skill-acceptance", version: "0" } }
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "open_insight_answer_context",
          arguments: { query: "本期收入是多少？", token_budget: 1200, max_follow_up_reads: 2 }
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "open_insight_recommend_outputs", arguments: {} }
      })
    ].join("\n");
    const mcp = run(process.execPath, [cliWrapper, "mcp", "serve", packageRelative, "--transport", "stdio"], {
      cwd: consumerRoot,
      env,
      input: `${mcpInput}\n`
    });
    steps.push(publicStep("read_mcp_answer_context", mcp));
    if (!mcp.ok) throw new Error(`MCP answer-context 调用失败。\n${mcp.stderr}`);
    const mcpFrames = mcp.stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => parseJson(line, "MCP frame"));
    const mcpAnswer = mcpFrames.find((frame) => frame.id === 2)?.result?.structuredContent;
    if (!mcpAnswer || mcpAnswer.status !== "ready") {
      throw new Error("MCP 没有返回可消费的 answer-context。");
    }
    const cliRefs = new Set(answerReport.source_refs ?? []);
    const parity = cliRefs.size > 0 && equivalentJson(answerReport, mcpAnswer);
    if (!parity) throw new Error("CLI 与 MCP 返回的完整 answer-context 不等价。");
    process.stderr.write("[alpha-skill-acceptance] 9/9 核对 MCP 输出建议与 CLI 等价。\n");
    const mcpOutputRecommendations = mcpFrames.find((frame) => frame.id === 3)?.result?.structuredContent;
    const recommendationParity = Boolean(mcpOutputRecommendations) && equivalentJson(outputRecommendationsReport, mcpOutputRecommendations);
    steps.push({
      id: "read_mcp_output_recommendations",
      status: recommendationParity ? "passed" : "failed",
      duration_ms: 0,
      exit_code: recommendationParity ? 0 : 1
    });
    if (!recommendationParity) throw new Error("CLI 与 MCP 返回的输出建议不等价。");

    report = {
      schema_version: "open-insight.alpha-skill-acceptance.v0.1",
      status: "passed",
      source_commit: sourceCommit,
      core_ref: OPEN_INSIGHT_DEFAULT_CORE_REF,
      acceptance_core_ref: acceptanceCoreRef,
      environment: {
        outside_repo: true,
        unicode_space_path: true,
        working_tree_clean: true,
        temporary_install_cleaned: !keepWorkdir
      },
      steps,
      results: {
        install_status: installReport.status,
        core_ref_verified: installReport.core_ref_verified,
        package_status: validateReport.status,
        source_mode: summaryReport.source_mode,
        single_file_insight: singleFileInsight,
        cli_answer_context_status: answerReport.status,
        mcp_answer_context_status: mcpAnswer.status,
        cli_mcp_answer_context_parity: parity,
        output_recommendation_count: outputRecommendationsReport.recommendations.length,
        output_recommendation_formats: [...new Set(outputRecommendationsReport.recommendations.map((item) => item.primary_format))],
        cli_mcp_output_recommendations_parity: recommendationParity,
        source_ref_count: cliRefs.size
      },
      safety: { model_invoked: false, model_env_forwarded: false, private_materials_read: false, base_package_mutation: false }
    };
  } catch (error) {
    report = {
      schema_version: "open-insight.alpha-skill-acceptance.v0.1",
      status: "failed",
      source_commit: sourceCommit,
      core_ref: OPEN_INSIGHT_DEFAULT_CORE_REF,
      acceptance_core_ref: acceptanceCoreRef,
      environment: {
        outside_repo: true,
        unicode_space_path: true,
        working_tree_clean: true,
        temporary_install_cleaned: !keepWorkdir
      },
      steps,
      diagnostic_cn: redact(error instanceof Error ? error.message : String(error)).slice(-1600),
      safety: { model_invoked: false, model_env_forwarded: false, private_materials_read: false, base_package_mutation: false }
    };
  } finally {
    await writeReport(report);
    if (keepWorkdir) process.stderr.write(`[alpha-skill-acceptance] 保留临时目录：${tempRoot}\n`);
    else await rm(tempRoot, { recursive: true, force: true });
  }

  console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha Skill acceptance: ${report.status}`);
  if (report.status !== "passed") process.exit(1);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

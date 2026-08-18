#!/usr/bin/env node
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const normalizedSourceExtensions = new Set([".csv", ".tsv", ".txt", ".md", ".html", ".htm", ".docx", ".xlsx", ".pptx", ".pdf"]);
const ignoredDirectoryNames = new Set([".git", "node_modules", "output", "outputs", "tmp"]);

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function formatElapsed(startedAt) {
  return `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))} 秒`;
}

function writeProgress(enabled, message) {
  if (enabled) process.stderr.write(`[Open Insight] ${message}\n`);
}

async function runWithProgressHeartbeat(task, { enabled, label, intervalMs = 15_000 }) {
  const startedAt = Date.now();
  const heartbeat = enabled
    ? setInterval(() => {
        writeProgress(true, `${label}仍在进行，已用时 ${formatElapsed(startedAt)}。大型 PDF 或 Office 文件可能需要更久。`);
      }, intervalMs)
    : undefined;
  heartbeat?.unref?.();
  try {
    return await task();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

function safeBaseName(value) {
  const normalized = String(value || "context-library")
    .trim()
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "context-library";
}

async function listSources(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name.toLowerCase())) files.push(...(await listSources(root, absolutePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(absolutePath);
  }
  return files;
}

async function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

function parseJsonOutput(result, label) {
  if (result.exitCode !== 0) throw new Error(`${label} 失败：${result.output}`);
  try {
    return JSON.parse(result.output);
  } catch {
    throw new Error(`${label} 未返回有效 JSON`);
  }
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log("用法：node scripts/compile-context-folder.mjs --source-dir <dir> [--output-dir <dir>] [--base-name <name>] [--mode source_light|source_bundled|both] [--parser auto|builtin|markitdown] [--ocr off|llm] [--parser-timeout-ms <ms>] [--max-source-bytes <bytes|KB|MB|GB>] [--max-total-source-bytes <bytes|KB|MB|GB>] [--max-normalized-bytes <bytes|KB|MB|GB>] [--max-total-normalized-bytes <bytes|KB|MB|GB>] [--source-analysis-cache-dir <dir>] [--progress]；parser、显式 OCR、资源上限和 cache 透传给 compile-pack，progress 仅写 stderr，不污染 JSON stdout。");
    return;
  }

  const coreRoot = process.cwd();
  const invocationRoot = path.resolve(process.env.OPEN_INSIGHT_SKILL_INVOCATION_ROOT || coreRoot);
  const skillCliWrapper = process.env.OPEN_INSIGHT_SKILL_CLI_WRAPPER
    ? path.resolve(process.env.OPEN_INSIGHT_SKILL_CLI_WRAPPER)
    : undefined;
  const sourceDir = path.resolve(invocationRoot, readOption("--source-dir"));
  const sourceStat = await stat(sourceDir).catch(() => undefined);
  if (!sourceStat?.isDirectory()) throw new Error(`来源目录不存在：${sourceDir}`);

  const outputDir = path.resolve(invocationRoot, readOption("--output-dir", "output"));
  const baseName = safeBaseName(readOption("--base-name", path.basename(sourceDir)));
  const mode = readOption("--mode", "source_bundled");
  const parser = readOption("--parser", "auto");
  const ocrMode = readOption("--ocr", "off");
  const parserTimeoutMs = readOption("--parser-timeout-ms");
  const maxSourceBytes = readOption("--max-source-bytes");
  const maxTotalSourceBytes = readOption("--max-total-source-bytes");
  const maxNormalizedBytes = readOption("--max-normalized-bytes");
  const maxTotalNormalizedBytes = readOption("--max-total-normalized-bytes");
  const sourceAnalysisCacheDirOption = readOption("--source-analysis-cache-dir");
  const sourceAnalysisCacheDir = sourceAnalysisCacheDirOption
    ? path.resolve(invocationRoot, sourceAnalysisCacheDirOption)
    : undefined;
  const progressEnabled = hasFlag("--progress");
  const format = readOption("--format", "text");
  if (!["source_light", "source_bundled", "both"].includes(mode)) throw new Error("--mode 必须是 source_light、source_bundled 或 both");
  if (!["auto", "builtin", "markitdown"].includes(parser)) throw new Error("--parser 必须是 auto、builtin 或 markitdown");
  if (!["off", "llm"].includes(ocrMode)) throw new Error("--ocr 必须是 off 或 llm");

  const sourceFiles = await listSources(sourceDir);
  if (sourceFiles.length === 0) throw new Error("来源目录中没有可读取的文件");
  const nonstandardSources = sourceFiles
    .filter((filePath) => !normalizedSourceExtensions.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => ({
      relative_path: path.relative(sourceDir, filePath).replaceAll(path.sep, "/"),
      extension: path.extname(filePath).toLowerCase() || "(none)",
      handling: "included_with_metadata_or_parser_diagnostic"
    }));
  await mkdir(outputDir, { recursive: true });
  const workflowStartedAt = Date.now();
  writeProgress(progressEnabled, `阶段 1/4：已发现 ${sourceFiles.length} 个文件，准备本地编译。`);

  const cliModule = path.join(coreRoot, "apps", "cli", "dist", "cli.js");
  const { runCli } = await import(pathToFileURL(cliModule).href);
  const requestedModes = mode === "both" ? ["source_bundled", "source_light"] : [mode];
  const packages = [];
  const previousProgress = process.env.OPEN_INSIGHT_PROGRESS;
  if (progressEnabled) process.env.OPEN_INSIGHT_PROGRESS = "1";

  try {
    for (const sourceMode of requestedModes) {
      const suffix = sourceMode === "source_light" ? "source-light" : "source-bundled";
      const outputPath = path.join(outputDir, `${baseName}.${suffix}.insight`);
      const compileArgs = ["compile-pack", sourceFiles[0], outputPath];
      for (const extraSource of sourceFiles.slice(1)) compileArgs.push("--source", extraSource);
      compileArgs.push("--source-mode", sourceMode, "--parser", parser, "--ocr", ocrMode, "--title", baseName);
      if (parserTimeoutMs !== undefined) compileArgs.push("--parser-timeout-ms", parserTimeoutMs);
      if (maxSourceBytes !== undefined) compileArgs.push("--max-source-bytes", maxSourceBytes);
      if (maxTotalSourceBytes !== undefined) compileArgs.push("--max-total-source-bytes", maxTotalSourceBytes);
      if (maxNormalizedBytes !== undefined) compileArgs.push("--max-normalized-bytes", maxNormalizedBytes);
      if (maxTotalNormalizedBytes !== undefined) {
        compileArgs.push("--max-total-normalized-bytes", maxTotalNormalizedBytes);
      }
      if (sourceAnalysisCacheDir !== undefined) compileArgs.push("--source-analysis-cache-dir", sourceAnalysisCacheDir);
      compileArgs.push("--format", "json");

      writeProgress(
        progressEnabled,
        `阶段 2/4：正在生成 ${sourceMode} 包（${sourceFiles.length} 个文件）。逐文件状态会继续显示。`
      );
      const compileResult = await runWithProgressHeartbeat(() => runCli(compileArgs, coreRoot), {
        enabled: progressEnabled,
        label: `阶段 2/4：${sourceMode} 编译`
      });
      const compile = parseJsonOutput(compileResult, `${sourceMode} compile-pack`);
      writeProgress(progressEnabled, `阶段 3/4：正在校验 ${sourceMode} 包和只读上下文索引。`);
      const validate = parseJsonOutput(await runCli(["validate", outputPath, "--format", "json"], coreRoot), `${sourceMode} validate`);
      const summary = parseJsonOutput(await runCli(["context", "summary", outputPath, "--format", "json"], coreRoot), `${sourceMode} context summary`);
      const outputRecommendations = parseJsonOutput(
        await runCli(["context", "recommend-outputs", outputPath, "--format", "json"], coreRoot),
        `${sourceMode} context recommend-outputs`
      );
      packages.push({
        source_mode: sourceMode,
        package_path: path.relative(invocationRoot, outputPath).replaceAll(path.sep, "/"),
        compile_status: compile.status,
        parser_timeout_ms: compile.parser_timeout_ms,
        ocr_mode: compile.ocr_mode,
        model_invoked: compile.safety?.model_invoked ?? false,
        resource_limits: compile.resource_limits,
        source_analysis_cache_configured: compile.source_analysis_cache?.enabled ?? false,
        validation_status: validate.status,
        context_status: summary.status,
        package_id: summary.package_id,
        source_count: summary.counts?.sources ?? sourceFiles.length,
        query_index_available: summary.query_index?.available ?? summary.capabilities?.query_index ?? summary.availability?.query_index ?? false,
        output_recommendations: outputRecommendations.recommendations,
        proactive_user_message_cn: outputRecommendations.proactive_user_message_cn
      });
    }
  } finally {
    if (previousProgress === undefined) delete process.env.OPEN_INSIGHT_PROGRESS;
    else process.env.OPEN_INSIGHT_PROGRESS = previousProgress;
  }

  const report = {
    schema_version: "open-insight.core-skill-folder-compile.v0.1",
    status:
      nonstandardSources.length === 0 && packages.every((item) => item.validation_status === "valid" && item.context_status === "ok")
        ? "completed"
        : "completed_with_warnings",
    source_dir_recorded: false,
    source_count: sourceFiles.length,
    source_extensions: [...new Set(sourceFiles.map((filePath) => path.extname(filePath).toLowerCase()))].sort(),
    nonstandard_source_count: nonstandardSources.length,
    nonstandard_sources: nonstandardSources,
    parser,
    ocr_mode: packages[0]?.ocr_mode ?? ocrMode,
    parser_timeout_ms: packages[0]?.parser_timeout_ms ?? null,
    resource_limits: packages[0]?.resource_limits ?? null,
    source_analysis_cache_configured: packages.some((item) => item.source_analysis_cache_configured),
    progress_enabled: progressEnabled,
    requested_mode: mode,
    packages,
    access_handoff: {
      available: Boolean(skillCliWrapper),
      local_only: true,
      contains_local_paths: Boolean(skillCliWrapper),
      publish_safe: false,
      packages: packages.map((item) => {
        const packagePath = path.resolve(invocationRoot, item.package_path);
        return {
          source_mode: item.source_mode,
          package_path: item.package_path,
          ...(skillCliWrapper
            ? {
                cli_summary: {
                  command: process.execPath,
                  args: [skillCliWrapper, "context", "summary", packagePath, "--format", "json"]
                },
                cli_search_template: {
                  command: process.execPath,
                  args: [skillCliWrapper, "context", "search-chunks", packagePath, "<query>", "--compact", "--format", "json"]
                },
                cli_recommend_outputs: {
                  command: process.execPath,
                  args: [skillCliWrapper, "context", "recommend-outputs", packagePath, "--format", "json"]
                },
                mcp_stdio: {
                  command: process.execPath,
                  args: [skillCliWrapper, "mcp", "serve", packagePath, "--transport", "stdio"]
                }
              }
            : {})
        };
      })
    },
    safety: {
      model_invoked: packages.some((item) => item.model_invoked === true),
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false,
      zip_suffix_used: false,
      directory_package_used: false
    }
  };
  const jsonPath = path.join(outputDir, `${baseName}.core-skill-compile.json`);
  const markdownPath = path.join(outputDir, `${baseName}.core-skill-compile.md`);
  const markdown = [
    "# Open Insight 文件夹编译报告",
    "",
    `- status: \`${report.status}\``,
    `- source_count: \`${report.source_count}\``,
    `- nonstandard_source_count: \`${report.nonstandard_source_count}\``,
    `- parser: \`${report.parser}\``,
    `- ocr_mode: \`${report.ocr_mode}\``,
    `- parser_timeout_ms: \`${report.parser_timeout_ms}\``,
    `- source_hash_strategy: \`${report.resource_limits?.source_hash_strategy ?? "unknown"}\``,
    `- package_write_strategy: \`${report.resource_limits?.package_write_strategy ?? "unknown"}\``,
    `- source_analysis_cache_configured: \`${report.source_analysis_cache_configured}\``,
    `- progress_enabled: \`${report.progress_enabled}\``,
    `- requested_mode: \`${report.requested_mode}\``,
    "",
    "## Packages",
    "",
    ...packages.map((item) => `- \`${item.source_mode}\`: ${item.package_path}（validate=${item.validation_status}, context=${item.context_status}）`),
    "",
    "## 根据内容结构推荐的下一步",
    "",
    ...packages.flatMap((item) => [
      `### ${item.source_mode}`,
      "",
      ...item.output_recommendations.slice(0, 4).map(
        (recommendation) =>
          `- **${recommendation.title_cn}**：${recommendation.content_suggestion_cn}（建议格式：\`${recommendation.primary_format}\`）`
      ),
      ""
    ]),
    ...(nonstandardSources.length > 0
      ? ["", "## 非标准扩展来源", "", ...nonstandardSources.map((item) => `- \`${item.relative_path}\`：已保留并进入 metadata / parser diagnostic 路径。`)]
      : []),
    "",
    "所有输出都是单文件 `.insight`；没有 `.zip` 后缀，也没有把目录伪装成 `.insight`。",
    ...(report.access_handoff.available
      ? ["", "## CLI / MCP 交接", "", "机器可读 JSON 报告已包含每个 package 的 `cli_summary`、`cli_search_template` 与 `mcp_stdio.command/args`。"]
      : [])
  ].join("\n");
  await writeAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeAtomic(markdownPath, `${markdown}\n`);
  writeProgress(
    progressEnabled,
    `阶段 4/4：编译完成，共处理 ${sourceFiles.length} 个文件，生成 ${packages.length} 个 .insight，用时 ${formatElapsed(workflowStartedAt)}。`
  );
  if (progressEnabled) {
    const firstPackage = packages[0];
    for (const line of firstPackage?.proactive_user_message_cn ?? []) writeProgress(true, line);
  }

  if (format === "json") console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Open Insight 文件夹编译：${report.status}`);
    for (const item of packages) console.log(`- ${item.source_mode}: ${item.package_path}`);
    const firstPackage = packages[0];
    for (const line of firstPackage?.proactive_user_message_cn ?? []) console.log(line);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

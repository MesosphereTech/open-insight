#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicAlphaMaterials, publicAlphaExpectedFacts } from "./public-alpha-fixtures.mjs";

const repoRoot = process.cwd();
const demoRoot = path.join(repoRoot, "output", "public-alpha-demo");
const materialsDir = path.join(demoRoot, "materials");
const packagesDir = path.join(demoRoot, "packages");
const packagePath = path.join(packagesDir, "meridian-renewables-context.source-bundled.insight");
const reportJsonPath = path.join(demoRoot, "public-alpha-demo.json");
const reportMarkdownPath = path.join(demoRoot, "public-alpha-demo.md");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const questions = [
  {
    id: "q1",
    query: "What was total Q2 generation, and which project missed plan?",
    expected_evidence: ["428 GWh", "Aurora Solar", "missed plan by 14 GWh"]
  },
  {
    id: "q2",
    query: "Who owns the transformer delivery risk, and when is the action due?",
    expected_evidence: ["Marcus Reed", "2026-09-30"]
  },
  {
    id: "q3",
    query: "What is projected 2026 total revenue, and which spreadsheet formula calculates it?",
    expected_evidence: ["50000000", "B5", "SUM(B2:B4)"]
  },
  {
    id: "q4",
    query: "What delivery reliability did the supplier assessment report?",
    expected_evidence: ["82 percent", "Northwind Transformers"]
  }
];

function hasFlag(name) {
  return process.argv.includes(name);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function run(command, args, options = {}) {
  const executable = process.platform === "win32" && command === npmCommand ? "cmd.exe" : command;
  const commandArgs = executable === "cmd.exe" ? ["/d", "/s", "/c", npmCommand, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([`${command} ${args.join(" ")} failed`, result.stdout, result.stderr].filter(Boolean).join("\n"));
  }
  return result;
}

function runCliJson(args) {
  const result = run(npmCommand, ["run", "--silent", "cli", "--", ...args]);
  return JSON.parse(result.stdout.trim());
}

function mcpRequest(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function runMcpSearches() {
  const input = [
    mcpRequest(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "open-insight-public-alpha-demo", version: "0.1" }
    }),
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    mcpRequest(2, "tools/call", { name: "open_insight_context_summary", arguments: {} }),
    ...questions.map((item, index) =>
      mcpRequest(index + 3, "tools/call", {
        name: "open_insight_search_chunks",
        arguments: { query: item.query, compact: true, token_budget: 1800, limit: 8 }
      })
    )
  ].join("");
  const result = run(
    npmCommand,
    ["run", "--silent", "cli", "--", "mcp", "serve", packagePath, "--transport", "stdio"],
    { input }
  );
  const responses = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    summary: responses.find((item) => item.id === 2)?.result?.structuredContent,
    searches: questions.map((question, index) => ({
      id: question.id,
      result: responses.find((item) => item.id === index + 3)?.result?.structuredContent
    }))
  };
}

function collectFieldValues(value, field, target = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldValues(item, field, target);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value[field])) target.push(...value[field].filter((item) => typeof item === "string"));
    for (const child of Object.values(value)) collectFieldValues(child, field, target);
  }
  return [...new Set(target)];
}

function visibleText(value) {
  return JSON.stringify(value).toLowerCase();
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildMarkdown(report) {
  return [
    "# Open Insight Public Alpha Demo",
    "",
    `- status: \`${report.status}\``,
    `- fixture: \`${report.fixture.name}\``,
    `- source files: \`${report.fixture.source_count}\``,
    `- package: \`${report.package.path}\``,
    `- package bytes: \`${report.package.size_bytes}\``,
    `- validation: \`${report.package.validation_status}\``,
    `- CLI/MCP parity: \`${report.parity.status}\``,
    `- token evaluation: \`${report.token_evaluation.status}\``,
    `- average estimated savings vs direct files: \`${Math.round(
      report.token_evaluation.average_savings_vs_direct * 1000
    ) / 10}%\``,
    `- model invoked: \`${report.safety.model_invoked}\``,
    `- base package mutation: \`${report.safety.base_package_mutation}\``,
    "",
    "## Questions",
    "",
    ...report.questions.flatMap((item) => [
      `### ${item.id}: ${item.query}`,
      "",
      `- expected evidence found: \`${item.expected_evidence_found}\``,
      `- CLI status: \`${item.cli_status}\``,
      `- MCP status: \`${item.mcp_status}\``,
      `- shared source refs: \`${item.shared_source_refs.length}\``,
      `- parse diagnostic refs: \`${item.parse_diagnostic_ids.length}\``,
      `- direct files estimated tokens: \`${item.token_evaluation.direct_estimated_tokens}\``,
      `- compact estimated tokens: \`${item.token_evaluation.compact_estimated_tokens}\``,
      `- estimated savings vs direct: \`${Math.round(
        item.token_evaluation.savings_vs_direct * 1000
      ) / 10}%\``,
      ""
    ]),
    "## Token evaluation boundary",
    "",
    "Token counts are deterministic estimates, not model billing records. Text files are decoded; Office/PDF binaries use a stable size heuristic. Savings are accepted only when compact context is non-empty, traceable, and preserves the expected evidence.",
    "",
    "## Safety",
    "",
    "This demo uses public synthetic English materials. It does not call a model, read an API key, upload files, execute package code, or write generated answers back into the `.insight` package."
  ].join("\n");
}

async function main() {
  const plan = {
    schema_version: "open-insight.public-alpha-demo-plan.v0.1",
    status: "planned",
    fixture_name: "meridian-renewables",
    language: "en",
    source_count: publicAlphaExpectedFacts.source_count,
    formats: ["md", "csv", "html", "txt", "docx", "xlsx", "pdf"],
    output_package: relative(packagePath),
    questions,
    token_evaluation: {
      direct_baseline: "generated_source_folder",
      compact_token_budget: 1800,
      estimated: true,
      model_billing_usage: false
    },
    safety: {
      public_synthetic_only: true,
      model_invoked: false,
      api_key_required: false,
      base_package_mutation: false
    }
  };
  if (hasFlag("--plan-only")) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  await rm(demoRoot, { recursive: true, force: true });
  await mkdir(packagesDir, { recursive: true });
  const fixture = await createPublicAlphaMaterials(materialsDir);
  run(npmCommand, ["run", "build:core"]);

  const compileResult = run(process.execPath, [
    path.join(repoRoot, "scripts", "compile-context-folder.mjs"),
    "--source-dir",
    materialsDir,
    "--output-dir",
    packagesDir,
    "--base-name",
    "meridian-renewables-context",
    "--mode",
    "source_bundled",
    "--parser",
    "auto",
    "--progress",
    "--format",
    "json"
  ]);
  const compile = JSON.parse(compileResult.stdout.trim());
  const summary = runCliJson(["context", "summary", packagePath, "--format", "json"]);
  const sources = runCliJson(["context", "list-sources", packagePath, "--format", "json"]);
  const diagnostics = runCliJson(["context", "diagnostics", packagePath, "--format", "json"]);
  const cliSearches = questions.map((item) => ({
    id: item.id,
    result: runCliJson([
      "context",
      "search-chunks",
      packagePath,
      item.query,
      "--compact",
      "--token-budget",
      "1800",
      "--limit",
      "8",
      "--format",
      "json"
    ])
  }));
  const tokenEvaluations = questions.map((item) => ({
    id: item.id,
    result: runCliJson([
      "context",
      "token-eval",
      packagePath,
      "--query",
      item.query,
      "--direct-baseline",
      materialsDir,
      "--token-budget",
      "1800",
      "--format",
      "json"
    ])
  }));
  const mcp = runMcpSearches();
  const packageStat = await import("node:fs/promises").then(({ stat }) => stat(packagePath));
  const questionResults = questions.map((question) => {
    const cli = cliSearches.find((item) => item.id === question.id)?.result;
    const mcpResult = mcp.searches.find((item) => item.id === question.id)?.result;
    const cliRefs = collectFieldValues(cli, "source_refs");
    const mcpRefs = collectFieldValues(mcpResult, "source_refs");
    const sharedRefs = cliRefs.filter((item) => mcpRefs.includes(item));
    const tokenEval = tokenEvaluations.find((item) => item.id === question.id)?.result;
    const combinedText = `${visibleText(cli)} ${visibleText(mcpResult)}`;
    return {
      ...question,
      expected_evidence_found: question.expected_evidence.every((item) =>
        combinedText.includes(item.toLowerCase())
      ),
      cli_status: cli?.status,
      mcp_status: mcpResult?.status,
      cli_source_refs: cliRefs,
      mcp_source_refs: mcpRefs,
      shared_source_refs: sharedRefs,
      lineage_refs: collectFieldValues(cli, "lineage_refs"),
      parse_diagnostic_ids: collectFieldValues(cli, "parse_diagnostic_ids"),
      source_map_refs: collectFieldValues(cli, "source_map_refs"),
      token_evaluation: {
        status: tokenEval?.status,
        estimated: tokenEval?.estimated === true,
        direct_estimated_tokens: tokenEval?.direct_full_text?.estimated_tokens,
        full_normalized_estimated_tokens: tokenEval?.insight_full_normalized?.estimated_tokens,
        compact_estimated_tokens: tokenEval?.insight_compact_retrieval?.estimated_tokens,
        savings_vs_direct: tokenEval?.savings_vs_direct,
        source_ref_coverage_rate: tokenEval?.source_ref_coverage_rate,
        parse_diagnostic_coverage_rate: tokenEval?.parse_diagnostic_coverage_rate,
        numeric_preservation_rate: tokenEval?.numeric_preservation_rate,
        non_empty_context: tokenEval?.retrieval_quality?.non_empty_context,
        traceable_context: tokenEval?.retrieval_quality?.traceable_context,
        baseline_quality: tokenEval?.direct_full_text?.baseline_quality
      }
    };
  });
  const parityOk = questionResults.every(
    (item) =>
      item.cli_status === item.mcp_status &&
      item.shared_source_refs.length > 0 &&
      item.parse_diagnostic_ids.length > 0
  );
  const evidenceOk = questionResults.every((item) => item.expected_evidence_found);
  const tokenEvaluationOk = questionResults.every(
    (item) =>
      item.token_evaluation.status === "completed" &&
      item.token_evaluation.estimated === true &&
      item.token_evaluation.non_empty_context === true &&
      item.token_evaluation.traceable_context === true &&
      item.token_evaluation.source_ref_coverage_rate === 1 &&
      item.token_evaluation.parse_diagnostic_coverage_rate === 1 &&
      item.token_evaluation.numeric_preservation_rate === 1
  );
  const averageSavingsVsDirect = round(
    questionResults.reduce(
      (sum, item) => sum + (item.token_evaluation.savings_vs_direct ?? 0),
      0
    ) / questionResults.length
  );
  const report = {
    schema_version: "open-insight.public-alpha-demo.v0.1",
    status:
      compile.status?.startsWith("completed") &&
      summary.status === "ok" &&
      parityOk &&
      evidenceOk &&
      tokenEvaluationOk
        ? "completed"
        : "degraded",
    fixture: {
      name: fixture.fixture_name,
      language: "en",
      source_count: fixture.source_count,
      source_names: fixture.source_names,
      expected_facts: fixture.expected_facts
    },
    package: {
      path: relative(packagePath),
      size_bytes: packageStat.size,
      source_mode: summary.source_mode,
      validation_status: compile.packages?.[0]?.validation_status,
      context_status: summary.status,
      package_id: summary.package_id
    },
    counts: summary.counts,
    query_index: summary.query_index,
    sources,
    diagnostics,
    questions: questionResults,
    token_evaluation: {
      status: tokenEvaluationOk ? "completed_estimated" : "degraded",
      method: "deterministic_mixed_text_and_binary_size_heuristic",
      token_count_is_estimated: true,
      model_billing_usage: false,
      question_count: questionResults.length,
      average_savings_vs_direct: averageSavingsVsDirect,
      minimum_source_ref_coverage_rate: Math.min(
        ...questionResults.map((item) => item.token_evaluation.source_ref_coverage_rate ?? 0)
      ),
      minimum_parse_diagnostic_coverage_rate: Math.min(
        ...questionResults.map(
          (item) => item.token_evaluation.parse_diagnostic_coverage_rate ?? 0
        )
      ),
      minimum_numeric_preservation_rate: Math.min(
        ...questionResults.map((item) => item.token_evaluation.numeric_preservation_rate ?? 0)
      ),
      disclosure:
        "Estimated only: decoded text plus stable binary-size heuristics. This is not API billing usage."
    },
    parity: {
      status: parityOk ? "passed" : "failed",
      cli_mcp_same_package: summary.package_id === mcp.summary?.package_id
    },
    safety: {
      public_synthetic_only: true,
      model_invoked: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    }
  };
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMarkdownPath, `${buildMarkdown(report)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...report, sources: undefined, diagnostics: undefined }, null, 2)}\n`);
}

main().catch(async (error) => {
  const failure = {
    schema_version: "open-insight.public-alpha-demo.v0.1",
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    safety: { model_invoked: false, api_key_recorded: false, base_package_mutation: false }
  };
  await mkdir(demoRoot, { recursive: true }).catch(() => {});
  await writeFile(reportJsonPath, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => {});
  process.stderr.write(`${failure.error}\n`);
  process.exit(1);
});

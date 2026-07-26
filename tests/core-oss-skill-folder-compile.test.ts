import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createModelFreeChildEnv } from "../skills/open-insight-context/scripts/child-env.mjs";

const tempDirs = [];
const repoRoot = path.resolve(".");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Core OSS Skill folder compile", () => {
  it("removes model credentials from Skill child processes", () => {
    const sensitiveEnvNames = [
      ["OPEN_INSIGHT_MODEL", "API", "KEY"].join("_"),
      ["OPEN_INSIGHT_OCR", "API", "KEY"].join("_"),
      ["OPENAI", "API", "KEY"].join("_"),
      ["GEMINI", "API", "KEY"].join("_"),
      ["VITE_OPEN_INSIGHT_MODEL", "API", "KEY"].join("_")
    ];
    const previous = Object.fromEntries(sensitiveEnvNames.map((name) => [name, process.env[name]]));
    for (const name of sensitiveEnvNames) process.env[name] = "model-test-value";
    try {
      const childEnv = createModelFreeChildEnv({ OPEN_INSIGHT_SKILL_INVOCATION_ROOT: "consumer" });
      for (const name of sensitiveEnvNames) expect(childEnv[name]).toBeUndefined();
      expect(childEnv.OPEN_INSIGHT_SKILL_INVOCATION_ROOT).toBe("consumer");
      const ocrEnv = createModelFreeChildEnv(
        { OPEN_INSIGHT_SKILL_INVOCATION_ROOT: "consumer" },
        { allowOcr: true }
      );
      expect(ocrEnv.OPEN_INSIGHT_OCR_API_KEY).toBe("model-test-value");
      expect(ocrEnv.OPEN_INSIGHT_MODEL_API_KEY).toBeUndefined();
      expect(ocrEnv.OPENAI_API_KEY).toBeUndefined();
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("creates bundled and light single-file packages without Surface or model calls", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-insight-core-folder-"));
    tempDirs.push(tempDir);
    const sourceDir = path.join(tempDir, "materials");
    const outputDir = path.join(tempDir, "output");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "说明.md"), "# 项目说明\n\n本项目收入为 120 万元。\n", "utf8");
    await writeFile(path.join(sourceDir, "sales.csv"), "region,revenue\n华东,1200000\n", "utf8");

    const result = spawnSync(
      process.execPath,
      ["scripts/compile-context-folder.mjs", "--source-dir", sourceDir, "--output-dir", outputDir, "--base-name", "alpha-smoke", "--mode", "both", "--parser", "builtin", "--format", "json"],
      { cwd: path.resolve("."), encoding: "utf8" }
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe("completed");
    expect(report.ocr_mode).toBe("off");
    expect(report.source_count).toBe(2);
    expect(report.packages).toHaveLength(2);
    expect(report.packages.map((item) => item.source_mode).sort()).toEqual(["source_bundled", "source_light"]);
    expect(report.packages.every((item) => item.package_path.endsWith(".insight"))).toBe(true);
    expect(report.packages.every((item) => !item.package_path.endsWith(".zip"))).toBe(true);
    expect(report.packages.every((item) => item.query_index_available === true)).toBe(true);
    expect(report.safety).toMatchObject({
      model_invoked: false,
      base_package_mutation: false,
      zip_suffix_used: false,
      directory_package_used: false
    });
    const diskReport = JSON.parse(await readFile(path.join(outputDir, "alpha-smoke.core-skill-compile.json"), "utf8"));
    expect(diskReport.status).toBe("completed");
  });

  it("defaults to one bundled package and keeps nonstandard files in the source inventory", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-insight-core-folder-default-"));
    tempDirs.push(tempDir);
    const sourceDir = path.join(tempDir, "materials");
    const outputDir = path.join(tempDir, "output");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "说明.md"), "# 说明\n\n正文。\n", "utf8");
    await writeFile(path.join(sourceDir, "附件.custom"), "opaque local attachment", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "scripts/compile-context-folder.mjs",
        "--source-dir",
        sourceDir,
        "--output-dir",
        outputDir,
        "--base-name",
        "default-mode",
        "--parser",
        "builtin",
        "--format",
        "json"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      status: "completed_with_warnings",
      requested_mode: "source_bundled",
      source_count: 2,
      nonstandard_source_count: 1,
      nonstandard_sources: [
        {
          relative_path: "附件.custom",
          extension: ".custom",
          handling: "included_with_metadata_or_parser_diagnostic"
        }
      ]
    });
    expect(report.packages).toHaveLength(1);
    expect(report.packages[0]).toMatchObject({
      source_mode: "source_bundled",
      source_count: 2,
      package_path: expect.stringMatching(/default-mode\.source-bundled\.insight$/u)
    });
  });

  it("passes parser controls, reuses the analysis cache, and keeps progress off JSON stdout", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-insight-core-folder-controls-"));
    tempDirs.push(tempDir);
    const sourceDir = path.join(tempDir, "materials");
    const outputDir = path.join(tempDir, "output");
    const cacheDir = path.join(tempDir, "private-source-analysis-cache");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "notes.txt"), "Reusable source text.\n", "utf8");

    const args = [
      "scripts/compile-context-folder.mjs",
      "--source-dir",
      sourceDir,
      "--output-dir",
      outputDir,
      "--base-name",
      "controls",
      "--mode",
      "source_bundled",
      "--parser",
      "builtin",
      "--parser-timeout-ms",
      "5000",
      "--max-source-bytes",
      "2MB",
      "--max-total-source-bytes",
      "4MB",
      "--max-normalized-bytes",
      "1MB",
      "--max-total-normalized-bytes",
      "2MB",
      "--source-analysis-cache-dir",
      cacheDir,
      "--progress",
      "--format",
      "json"
    ];

    const first = spawnSync(process.execPath, args, { cwd: path.resolve("."), encoding: "utf8" });
    const second = spawnSync(process.execPath, args, { cwd: path.resolve("."), encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);

    const firstReport = JSON.parse(first.stdout);
    const secondReport = JSON.parse(second.stdout);
    expect(firstReport).toMatchObject({
      ocr_mode: "off",
      parser_timeout_ms: 5000,
      source_analysis_cache_configured: true,
      progress_enabled: true,
      resource_limits: {
        max_source_bytes: 2 * 1024 * 1024,
        max_total_source_bytes: 4 * 1024 * 1024,
        max_normalized_bytes: 1024 * 1024,
        max_total_normalized_bytes: 2 * 1024 * 1024,
        source_hash_strategy: "streaming_sha256",
        package_write_strategy: "streaming_zip"
      }
    });
    expect(secondReport).toMatchObject(firstReport);
    expect(second.stderr).toContain("cache_hit");
    expect(first.stderr).toContain("[open-insight compile]");
    expect(first.stdout).not.toContain(cacheDir);
    expect(second.stdout).not.toContain(cacheDir);
    expect(firstReport.packages[0].parser_timeout_ms).toBe(5000);
    expect(firstReport.packages[0].source_analysis_cache_configured).toBe(true);
    expect(firstReport.packages[0].resource_limits).toEqual(firstReport.resource_limits);
  });

  it("works from a consumer directory with relative paths and exposes read-only CLI/MCP access", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "open-insight-skill-consumer-"));
    tempDirs.push(tempDir);
    const consumerRoot = path.join(tempDir, "普通用户 空格");
    const sourceDir = path.join(consumerRoot, "中文 材料");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "说明.md"), "# 客户材料\n\n本期收入为 120 万元。\n", "utf8");

    const env = {
      ...process.env,
      OPEN_INSIGHT_CORE_HOME: repoRoot,
      OPEN_INSIGHT_MODEL_API_KEY: "",
      XIAOMI_API_KEY: "",
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    };
    const compileWrapper = path.join(repoRoot, "skills", "open-insight-context", "scripts", "compile-folder.mjs");
    const cliWrapper = path.join(repoRoot, "skills", "open-insight-context", "scripts", "cli.mjs");
    const compile = spawnSync(
      process.execPath,
      [
        compileWrapper,
        "--source-dir",
        "中文 材料",
        "--output-dir",
        "output",
        "--base-name",
        "first-run",
        "--mode",
        "source_light",
        "--parser",
        "builtin",
        "--format",
        "json"
      ],
      { cwd: consumerRoot, encoding: "utf8", env }
    );
    expect(compile.status, `${compile.stdout}\n${compile.stderr}`).toBe(0);
    const compileReport = JSON.parse(compile.stdout);
    const packagePath = path.join("output", "first-run.source-light.insight");
    expect(compileReport.packages[0].package_path).toBe("output/first-run.source-light.insight");
    expect(compileReport.access_handoff).toMatchObject({
      available: true,
      local_only: true,
      contains_local_paths: true,
      publish_safe: false,
      packages: [
        {
          source_mode: "source_light",
          package_path: "output/first-run.source-light.insight",
          cli_summary: { command: process.execPath },
          cli_search_template: { command: process.execPath },
          mcp_stdio: { command: process.execPath }
        }
      ]
    });
    expect(compileReport.access_handoff.packages[0].mcp_stdio.args).toEqual([
      cliWrapper,
      "mcp",
      "serve",
      path.join(consumerRoot, packagePath),
      "--transport",
      "stdio"
    ]);

    const validate = spawnSync(process.execPath, [cliWrapper, "validate", packagePath, "--format", "json"], {
      cwd: consumerRoot,
      encoding: "utf8",
      env
    });
    expect(validate.status, `${validate.stdout}\n${validate.stderr}`).toBe(0);
    expect(JSON.parse(validate.stdout).status).toBe("valid");

    const summary = spawnSync(process.execPath, [cliWrapper, "context", "summary", packagePath, "--format", "json"], {
      cwd: consumerRoot,
      encoding: "utf8",
      env
    });
    expect(summary.status, `${summary.stdout}\n${summary.stderr}`).toBe(0);
    expect(JSON.parse(summary.stdout)).toMatchObject({ status: "ok", source_mode: "source_light" });

    const mcpInput = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "skill-first-run-test", version: "0" } }
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "open_insight_context_summary", arguments: {} }
      })
    ].join("\n");
    const mcp = spawnSync(process.execPath, [cliWrapper, "mcp", "serve", packagePath, "--transport", "stdio"], {
      cwd: consumerRoot,
      encoding: "utf8",
      env,
      input: `${mcpInput}\n`
    });
    expect(mcp.status, `${mcp.stdout}\n${mcp.stderr}`).toBe(0);
    const mcpResponses = mcp.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(mcpResponses[1]?.result?.structuredContent).toMatchObject({ status: "ok", source_mode: "source_light" });

    const blockedWrite = spawnSync(process.execPath, [cliWrapper, "compile-pack", "a.md", "a.insight"], {
      cwd: consumerRoot,
      encoding: "utf8",
      env
    });
    expect(blockedWrite.status).toBe(1);
    expect(blockedWrite.stderr).toContain("只开放只读命令");
  });
});

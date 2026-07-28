import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Core OSS context Skill docs", () => {
  it("provides a concise English-first install, compile, CLI, MCP, and safety contract", async () => {
    const skill = await readFile(path.resolve("skills/open-insight-context/SKILL.md"), "utf8");
    for (const requiredText of [
      "When to use this Skill",
      "avoid re-uploading",
      "every source",
      "not another chat application",
      "must be able to call this Skill",
      "Package these local files",
      "research library",
      "agent handoff snapshot",
      "information collection -> one .insight",
      "Chinese guide: [`SKILL.zh-CN.md`](SKILL.zh-CN.md)",
      "npx -y skills@1.5.9 add",
      "v0.1.0-alpha.2/skills/open-insight-context",
      "bootstrap.mjs\" --check-only",
      "do not ask an ordinary user to run bootstrap",
      "automatically downloads the immutable Core ref",
      "JSON stdout remains",
      "OPEN_INSIGHT_AUTO_BOOTSTRAP=0",
      "Node.js 20.19+",
      "22.12+",
      "npm 10+",
      "The complete Skill directory is required",
      "automatically downloads the immutable Core ref",
      "verifies the resolved commit",
      "compile-folder.mjs",
      "resolved from that directory",
      "scripts/cli.mjs",
      "--parser-timeout-ms",
      "--max-source-bytes",
      "--max-total-source-bytes",
      "--max-normalized-bytes",
      "--max-total-normalized-bytes",
      "--source-analysis-cache-dir",
      "--progress",
      "--ocr llm",
      "markitdown-ocr",
      "OPEN_INSIGHT_OCR_*",
      "source_bundled",
      "source_light",
      "Do not expose a `.zip`",
      "context answer-context",
      "open_insight_answer_context",
      "--document-id",
      "--max-follow-up-reads 12",
      "Do not read every source",
      "context search-chunks",
      "mcp serve",
      "source_refs",
      "lineage_refs",
      "parse_diagnostic_ids",
      "source_map_refs",
      "Do not execute code stored inside an `.insight` package",
      "Do not mutate the base package",
      "spreadsheet_formulas",
      "formula_resolution_status=not_evaluated"
    ]) expect(skill).toContain(requiredText);

    expect(skill).toMatch(/^---\r?\nname: open-insight-context\r?\ndescription: .+\r?\n---/u);
  });

  it("preserves the detailed Chinese operating guide without registering a duplicate Skill", async () => {
    const skill = await readFile(path.resolve("skills/open-insight-context/SKILL.zh-CN.md"), "utf8");
    for (const requiredText of [
      "Agent 发现入口是同目录的英文",
      "system_checks",
      "prerequisite_failed",
      "阶段 1/5",
      "阶段 5/5",
      "整个 `open-insight-context` 目录",
      "npx -y skills@1.5.9 add",
      "https://github.com/MesosphereTech/open-insight/tree/v0.1.0-alpha.2/skills/open-insight-context",
      "普通用户不需要再手工运行 bootstrap",
      "第一次使用时自动下载固定 Core",
      "OPEN_INSIGHT_AUTO_BOOTSTRAP=0",
      "OPEN_INSIGHT_CORE_HOME",
      "OPEN_INSIGHT_CORE_REPOSITORY",
      "OPEN_INSIGHT_CORE_REF",
      "requested_core_ref",
      "resolved_core_commit",
      "core_ref_verified",
      "version_mismatch",
      "以用户运行命令时所在目录为基准",
      "仓库外只读入口",
      "只开放 `validate`、`inspect`、`context`、`mcp serve`",
      "stderr",
      "stdout",
      "open-insight.core-skill-folder-compile.v0.1",
      "query_index_available",
      "streaming_sha256",
      "streaming_zip",
      "不会静默截断",
      "external_normalized_source_model_ocr_no_output",
      "模型 OCR 结果始终写为 `status=warning`",
      "access_handoff",
      "local_only=true",
      "publish_safe=false",
      "source_bundled",
      "source_light",
      "nonstandard_source_count",
      "不会静默丢失",
      "不得输出 `.zip` 后缀",
      "context answer-context",
      "open_insight_answer_context",
      "具体问题的默认入口",
      "--document-id",
      "--max-follow-up-reads 12",
      "不要默认先运行 summary、diagnostics",
      "问题带有明确文档名",
      "degraded",
      "context search-chunks",
      "mcp serve",
      "open_insight_search_chunks",
      "source_refs",
      "lineage_refs",
      "parse_diagnostic_ids",
      "source_map_refs",
      "不执行 `.insight` 包内代码",
      "不写回 base package"
    ]) expect(skill).toContain(requiredText);

    expect(skill).not.toMatch(/^---\r?\nname:/u);
  });

  it("ships discoverable Skill metadata and no stale repository-only consumer commands", async () => {
    const [metadata, recipe] = await Promise.all([
      readFile(path.resolve("skills/open-insight-context/agents/openai.yaml"), "utf8"),
      readFile(path.resolve("skills/open-insight-context/recipes/user-material-consumer.md"), "utf8")
    ]);
    expect(metadata).toContain('display_name: "Open Insight 上下文库"');
    expect(metadata).toContain("$open-insight-context");
    expect(recipe).toContain('node "<skill-root>/scripts/cli.mjs" context summary');
    for (const staleCommand of ["npm run context:token-eval", "npm run demo:compact-context", "npm run demo:context-token-eval"]) {
      expect(recipe).not.toContain(staleCommand);
    }
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public Core English README", () => {
  async function readPublicFile(templatePath: string, exportedPath: string) {
    try {
      return await readFile(path.resolve(templatePath), "utf8");
    } catch {
      return readFile(path.resolve(exportedPath), "utf8");
    }
  }

  async function readPublicReadme() {
    return readPublicFile("docs/public/README.md", "README.md");
  }

  it("defines the English-first one-file user path without unsupported claims", async () => {
    const readme = await readPublicReadme();
    for (const required of [
      "Prepare information once. Use it with any AI.",
      "One File, Any AI",
      "Portable AI Context",
      "Any Information Collection -> One .insight -> Any AI",
      "The problem it solves",
      "What a user actually does",
      "portable context",
      "research corpus",
      "learning library",
      "technical documentation",
      "personal archive",
      "agent to another",
      "the product boundary is the information",
      "collection, not the demo scenario",
      "does not automatically understand the file extension",
      "not a prewritten report",
      "another chat application",
      "MarkItDown converts formats",
      "RAG retrieves knowledge",
      "MCP connects tools to AI",
      "Why not a ZIP file?",
      "node \"<skill-root>/scripts/bootstrap.mjs\"",
      "compile-folder.mjs",
      "context answer-context",
      "source_bundled",
      "source_light",
      "read-only MCP",
      "recommended optional local parser backend",
      "README.zh-CN.md",
      "does not upload source files or call a model on its own",
      "64.1% fewer estimated tokens on average",
      "not model billing usage",
      "not a universal savings guarantee",
      "docs/public/assets/open-insight-alpha-validation.gif",
      "docs/public/assets/open-insight-alpha-contact-sheet.jpg",
      'What "Any AI" means',
      "does not certify every model provider or account",
      "docs/public-alpha-release-notes.md"
    ]) {
      expect(readme).toContain(required);
    }
    for (const unsupportedClaim of [
      "guaranteed accuracy",
      "99% token savings",
      "zero hallucinations",
      "Reader",
      "Studio"
    ]) {
      expect(readme).not.toContain(unsupportedClaim);
    }
  });

  it("publishes an independent Chinese Core README instead of private product history", async () => {
    const readme = await readPublicFile(
      "docs/public/README.zh-CN.md",
      "README.zh-CN.md"
    );
    for (const required of [
      "把信息准备一次，交给任何兼容 AI 反复使用",
      "任意信息集合 -> 一个 .insight -> 任何兼容 AI",
      "单文件 AI 信息库",
      "研究语料",
      "学习资料",
      "技术文档",
      "个人档案",
      "Agent 之间需要交接的上下文快照",
      "项目文件夹只是其中",
      "一种形式",
      "不是 `.zip` 后缀",
      "context answer-context",
      "mcp serve"
    ]) {
      expect(readme).toContain(required);
    }
    for (const historicalProduct of ["Reader", "Studio", "Public Beta"]) {
      expect(readme).not.toContain(historicalProduct);
    }
  });

  it("keeps public narrative documents Core-only", async () => {
    const documents = await Promise.all(
      [
        ["docs/public/AGENTS.md", "AGENTS.md"],
        ["docs/public/README.md", "README.md"],
        ["docs/public/README.zh-CN.md", "README.zh-CN.md"],
        ["docs/core-oss-prd.md", "docs/core-oss-prd.md"],
        ["docs/core-oss-alpha-readiness.md", "docs/core-oss-alpha-readiness.md"],
        ["docs/core-oss-context-kernel.md", "docs/core-oss-context-kernel.md"],
        ["docs/public-alpha-release-notes.md", "docs/public-alpha-release-notes.md"],
        ["docs/public-core-repository-manifest.md", "docs/public-core-repository-manifest.md"],
        ["CONTRIBUTING.md", "CONTRIBUTING.md"],
        ["SECURITY.md", "SECURITY.md"]
      ].map(([templatePath, exportedPath]) =>
        readPublicFile(templatePath, exportedPath)
      )
    );
    for (const document of documents) {
      expect(document).not.toMatch(/\b(?:Reader|Studio)\b|Public Beta/iu);
    }
  });

  it("uses links that remain valid after the template becomes the root README", async () => {
    const readme = await readPublicReadme();
    expect(readme).toContain("(docs/core-oss-prd.md)");
    expect(readme).toContain("(skills/open-insight-context/SKILL.md)");
    expect(readme).toContain("(SECURITY.md)");
    expect(readme).toContain("(CONTRIBUTING.md)");
    expect(readme).toContain(
      "(docs/public/assets/open-insight-alpha-contact-sheet.jpg)"
    );
    expect(readme).toContain("(docs/public-alpha-release-notes.md)");
    expect(readme).not.toContain("](../");
    expect(readme).not.toContain("](../../");
  });

  it("publishes honest all-English candidate notes", async () => {
    const notes = await readFile(
      path.resolve("docs/public-alpha-release-notes.md"),
      "utf8"
    );
    for (const required of [
      "private release candidate",
      "One File, Any AI",
      "64.1% fewer estimated input tokens on average",
      "model billing usage",
      "universal savings guarantee",
      "Codex CLI",
      "Gemini CLI",
      "Claude Code",
      "Externally blocked",
      "Remaining release blockers"
    ]) {
      expect(notes).toContain(required);
    }
    expect(notes).not.toContain("three AI clients passed");
    expect(notes).not.toContain("guaranteed");
  });
});

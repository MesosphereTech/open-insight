import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileInsightDraft } from "./index.js";

describe("insight compiler", () => {
  it("writes a draft package to disk", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "open-insight-compiler-"));
    const result = await compileInsightDraft({
      title: "Compiled Draft",
      packageId: "org.example.compiled",
      outputDir,
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    const manifest = JSON.parse(await fs.readFile(path.join(outputDir, "manifest.json"), "utf8")) as {
      package_id: string;
    };

    expect(result.fileCount).toBe(10);
    expect(result.warnings).toEqual([]);
    expect(manifest.package_id).toBe("org.example.compiled");
  });

  it("returns Chinese warnings when template sections lack source files", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "open-insight-compiler-"));
    const result = await compileInsightDraft({
      title: "Empty Draft",
      packageId: "org.example.empty",
      outputDir,
      template: "留存分析",
      sources: [],
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    expect(result.warnings).toEqual(["部分模板章节暂时没有匹配的来源文件。"]);
    expect(result.warnings.join(" ")).not.toContain("Some template sections");
  });

  it("returns Chinese source profile warnings when tabular sources cannot support metrics or charts", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "open-insight-compiler-"));
    const result = await compileInsightDraft({
      title: "Source Quality Draft",
      packageId: "org.example.source-quality",
      outputDir,
      template: "经营摘要",
      sources: [
        {
          name: "comments.csv",
          type: "csv",
          columns: [{ name: "comment", type: "string" }]
        },
        {
          name: "totals.csv",
          type: "csv",
          columns: [{ name: "revenue", type: "number" }]
        },
        {
          name: "prospectus.pdf",
          type: "pdf"
        }
      ],
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    expect(result.warnings).toEqual([
      "来源 comments.csv 未识别到可聚合数值字段，无法自动生成指标草稿。",
      "来源 totals.csv 未识别到维度字段，无法自动生成图表草稿。"
    ]);
    expect(result.warnings.join(" ")).not.toContain("numeric column");
    expect(result.warnings.join(" ")).not.toContain("dimension");
  });

  it("uses a Chinese default template when no template is provided", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "open-insight-compiler-"));
    const result = await compileInsightDraft({
      title: "默认模板草稿",
      packageId: "org.example.default-template",
      outputDir,
      sources: ["business-review.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    expect(result.plan.templateSections).toEqual(["经营摘要", "关键指标", "证据审阅", "风险与缺口", "预置问答"]);
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("official Surface delivery contract", () => {
  it("ships the long-form HTML consumer with one-line install without redefining the base package", async () => {
    const [prd, manifest, exporter] = await Promise.all([
      readFile(path.resolve("docs/core-oss-prd.md"), "utf8"),
      readFile(path.resolve("docs/public-core-repository-manifest.md"), "utf8"),
      readFile(path.resolve("scripts/export-public-core.mjs"), "utf8")
    ]);

    for (const text of [prd, manifest, exporter]) {
      expect(text).toContain("open-insight-full-document-surface");
    }
    expect(prd).toContain("一行安装必须同时交付 `open-insight-context` Context Skill 与");
    expect(prd).toContain("`open-insight-full-document-surface` Open Insight 官方消费 Surface Skill");
    expect(prd).toContain("Word 与 PPT 在当前 Alpha 仍由用户所选 AI 客户端");
    expect(prd).toContain("不得再要求用户分别安装");
    expect(prd).toContain("注册必须只追加自己的配置、保持幂等并保留原配置备份");
    expect(manifest).toContain("outputs stay outside");
    expect(manifest).toContain("does not exclude the generic official long-form HTML Surface");
  });
});

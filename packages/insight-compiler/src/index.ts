import fs from "node:fs/promises";
import path from "node:path";
import type { DomainPack, DomainPackId } from "@open-insight/domain-packs";
import { buildDraftPackageFiles, buildDraftPlan, buildDraftSourceProfileWarnings, type DraftPlan, type DraftSourceInput } from "./draft.js";

export * from "./draft.js";
export * from "./sourceAnalysis.js";

export interface CompileOptions {
  title: string;
  packageId: string;
  outputDir: string;
  template?: string;
  sources?: DraftSourceInput[];
  createdAt?: string;
  domainPack?: DomainPack | DomainPackId;
}

export interface CompileResult {
  packageRoot: string;
  warnings: string[];
  fileCount: number;
  plan: DraftPlan;
}

const defaultTemplate = `经营摘要
关键指标
证据审阅
风险与缺口
预置问答`;

export async function compileInsightDraft(options: CompileOptions): Promise<CompileResult> {
  const plan = buildDraftPlan({
    title: options.title,
    packageId: options.packageId,
    template: options.template ?? defaultTemplate,
    sources: options.sources ?? [],
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.domainPack ? { domainPack: options.domainPack } : {})
  });
  const files = buildDraftPackageFiles(plan);
  const warnings = buildCompileWarnings(plan);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const outputPath = path.join(options.outputDir, relativePath);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content, "utf8");
    })
  );

  return {
    packageRoot: options.outputDir,
    warnings,
    fileCount: Object.keys(files).length,
    plan
  };
}

function buildCompileWarnings(plan: DraftPlan): string[] {
  const warnings: string[] = [];

  if (plan.questions.some((question) => question.status === "needs_data")) {
    warnings.push("部分模板章节暂时没有匹配的来源文件。");
  }

  return [...warnings, ...buildDraftSourceProfileWarnings(plan.sources)];
}

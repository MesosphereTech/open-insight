import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSIGHT_SPEC_VERSION, listPackageFiles, pathExists, readJsonFile, readJsonlFile, readManifest } from "@open-insight/core";
import { summarizeDataResponsePackage, type DataResponseMergeSummary, type ResponseCompatibilityIssue } from "./responseSummary.js";

export interface MergeDataResponsePackageOptions {
  parentPackageRoot: string;
  responsePackageRoot: string;
  outputDir: string;
  createdAt?: string;
  mergedPackageId?: string;
}

export interface MergeDataResponsePackageResult {
  status: "merged";
  output_dir: string;
  parent_package_id: string;
  response_package_id: string;
  merged_package_id: string;
  response_id: string;
  source_request_id: string;
  file_count: number;
  merge_plan: DataResponseMergeSummary["merge_plan"];
  answerability_changes: DataResponseMergeSummary["answerability_changes"];
  versioning: {
    parents_path: "versioning/parents.json";
    merge_log_path: "versioning/merge_log.jsonl";
    diff_summary_path: "versioning/diff_summary.json";
    review_patches_path: "versioning/review_patches.jsonl";
  };
}

interface IdRecord {
  [key: string]: unknown;
}

interface DataCatalog {
  datasets: Array<IdRecord & { dataset_id: string; path?: string }>;
  [key: string]: unknown;
}

interface MetricsFile {
  metrics: Array<IdRecord & { metric_id: string }>;
  [key: string]: unknown;
}

interface HomepageView {
  blocks: Array<IdRecord & { block_id: string; metric_id?: string; claim_id?: string; evidence_ids?: string[] }>;
  [key: string]: unknown;
}

interface LineageSourcesFile {
  sources: Array<IdRecord & { source_id: string; path?: string }>;
  [key: string]: unknown;
}

export async function mergeDataResponsePackage(options: MergeDataResponsePackageOptions): Promise<MergeDataResponsePackageResult> {
  const parentPackageRoot = path.resolve(options.parentPackageRoot);
  const responsePackageRoot = path.resolve(options.responsePackageRoot);
  const outputDir = path.resolve(options.outputDir);
  const summary = await summarizeDataResponsePackage({ parentPackageRoot, responsePackageRoot });

  if (summary.status !== "ready") {
    throw new Error(`response 包尚未满足合并条件：${summary.compatibility_issues.map(formatCompatibilityIssue).join("; ")}`);
  }

  if (await pathExists(outputDir)) {
    throw new Error(`输出目录已存在：${outputDir}`);
  }

  const parentManifest = await readManifest(parentPackageRoot);
  const responseManifest = await readManifest(responsePackageRoot);
  const responseContext = responseManifest.response_context;

  if (!responseContext) {
    throw new Error(`response 包 '${responsePackageRoot}' 缺少 manifest.response_context。`);
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const mergedPackageId = options.mergedPackageId ?? `${parentManifest.package_id}.merged.${sanitizeId(responseContext.response_id)}`;
  await cp(parentPackageRoot, outputDir, { recursive: true });

  const parentCatalog = await readJsonFile<DataCatalog>(path.join(parentPackageRoot, "data/catalog.json"));
  const responseCatalog = await readJsonFile<DataCatalog>(path.join(responsePackageRoot, "data/catalog.json"));
  const parentMetrics = await readJsonFile<MetricsFile>(path.join(parentPackageRoot, "semantic/metrics.json"));
  const responseMetrics = await readJsonFile<MetricsFile>(path.join(responsePackageRoot, "semantic/metrics.json"));
  const parentHomepage = await readJsonFile<HomepageView>(path.join(parentPackageRoot, "views/homepage.json"));
  const responseHomepage = await readJsonFile<HomepageView>(path.join(responsePackageRoot, "views/homepage.json"));
  const parentClaims = await readJsonlFile<IdRecord & { claim_id: string }>(path.join(parentPackageRoot, "findings/claims.jsonl"));
  const responseClaims = await readJsonlFile<IdRecord & { claim_id: string }>(path.join(responsePackageRoot, "findings/claims.jsonl"));
  const parentEvidence = await readJsonlFile<IdRecord & { evidence_id: string }>(path.join(parentPackageRoot, "evidence/evidence.jsonl"));
  const responseEvidence = await readJsonlFile<IdRecord & { evidence_id: string }>(path.join(responsePackageRoot, "evidence/evidence.jsonl"));
  const parentQuestions = await readJsonlFile<IdRecord & { question_id: string }>(path.join(parentPackageRoot, "qa/prepared_questions.jsonl"));
  const responseQuestions = await readJsonlFile<IdRecord & { question_id: string }>(
    path.join(responsePackageRoot, "qa/prepared_questions.jsonl")
  );
  const parentLineage = await readJsonFile<LineageSourcesFile>(path.join(parentPackageRoot, "lineage/sources.json"));
  const responseLineage = await readJsonFile<LineageSourcesFile>(path.join(responsePackageRoot, "lineage/sources.json"));

  const addedDatasets = filterByIds(responseCatalog.datasets, "dataset_id", summary.merge_plan.additions.datasets);
  const addedMetrics = filterByIds(responseMetrics.metrics, "metric_id", summary.merge_plan.additions.metrics);
  const addedClaims = filterByIds(responseClaims, "claim_id", summary.merge_plan.additions.claims);
  const addedEvidence = filterByIds(responseEvidence, "evidence_id", summary.merge_plan.additions.evidence);
  const addedQuestions = filterByIds(responseQuestions, "question_id", summary.merge_plan.additions.prepared_questions);
  const addedLineageSources = filterByIds(responseLineage.sources, "source_id", summary.merge_plan.additions.lineage_sources);
  const copiedResponsePaths = new Set(
    [...addedDatasets.map((dataset) => dataset.path), ...addedLineageSources.map((source) => source.path)].filter(
      (filePath): filePath is string => typeof filePath === "string" && filePath.length > 0
    )
  );

  for (const relativePath of copiedResponsePaths) {
    await copyResponsePackageFile(responsePackageRoot, outputDir, relativePath);
  }

  const mergedManifest = {
    ...parentManifest,
    spec_version: parentManifest.spec_version || INSIGHT_SPEC_VERSION,
    package_id: mergedPackageId,
    title: `${parentManifest.title} - 合并 ${responseContext.source_request_id}`,
    description: `由母包 ${parentManifest.package_id} 和 response 包 ${responseManifest.package_id} 生成的非破坏性合并结果。`,
    created_at: createdAt,
    optional_capabilities: uniqueSorted([...(parentManifest.optional_capabilities ?? []), "merge"]),
    response_context: undefined,
    request_context: undefined
  };
  const addedHomepageBlocks = selectResponseHomepageBlocks(responseHomepage.blocks, summary.merge_plan.additions, parentHomepage.blocks);
  const versioningParents = {
    parents: [
      {
        role: "base_parent",
        package_id: parentManifest.package_id,
        title: parentManifest.title
      },
      {
        role: "response",
        package_id: responseManifest.package_id,
        title: responseManifest.title,
        response_id: responseContext.response_id,
        source_request_id: responseContext.source_request_id,
        request_package_id: responseContext.request_package_id
      }
    ],
    merged_from: [
      {
        response_id: responseContext.response_id,
        source_request_id: responseContext.source_request_id,
        request_package_id: responseContext.request_package_id,
        response_package_id: responseManifest.package_id,
        affected_findings: responseContext.affected_findings ?? [],
        merged_at: createdAt
      }
    ],
    merge_policy: {
      mode: summary.merge_plan.mode,
      parent_mutation: summary.merge_plan.parent_mutation
    }
  };
  const mergeLogRecord = {
    event_id: `merge_${sanitizeId(responseContext.response_id)}`,
    event_type: "response_merge",
    merged_at: createdAt,
    parent_package_id: parentManifest.package_id,
    response_package_id: responseManifest.package_id,
    merged_package_id: mergedPackageId,
    response_id: responseContext.response_id,
    source_request_id: responseContext.source_request_id,
    parent_mutation: false
  };
  const diffSummary = {
    merge_plan: summary.merge_plan,
    affected_findings: summary.affected_findings,
    answerability_changes: summary.answerability_changes,
    supplement_quality_warnings: summary.supplement_quality_warnings,
    review_tasks: summary.review_tasks,
    compatibility_issues: summary.compatibility_issues
  };
  const reviewPatches = createReviewPatches(summary, responseContext, createdAt);

  await writeJson(path.join(outputDir, "manifest.json"), mergedManifest);
  await writeJson(path.join(outputDir, "data/catalog.json"), { ...parentCatalog, datasets: [...parentCatalog.datasets, ...addedDatasets] });
  await writeJson(path.join(outputDir, "semantic/metrics.json"), { ...parentMetrics, metrics: [...parentMetrics.metrics, ...addedMetrics] });
  await writeJson(path.join(outputDir, "views/homepage.json"), {
    ...parentHomepage,
    blocks: [...parentHomepage.blocks, ...addedHomepageBlocks]
  });
  await writeJsonl(path.join(outputDir, "findings/claims.jsonl"), [...parentClaims, ...addedClaims]);
  await writeJsonl(path.join(outputDir, "evidence/evidence.jsonl"), [...parentEvidence, ...addedEvidence]);
  await writeJsonl(path.join(outputDir, "qa/prepared_questions.jsonl"), [...parentQuestions, ...addedQuestions]);
  await writeJson(path.join(outputDir, "lineage/sources.json"), { ...parentLineage, sources: [...parentLineage.sources, ...addedLineageSources] });
  await writeJson(path.join(outputDir, "versioning/parents.json"), versioningParents);
  await writeJsonl(path.join(outputDir, "versioning/merge_log.jsonl"), [mergeLogRecord]);
  await writeJson(path.join(outputDir, "versioning/diff_summary.json"), diffSummary);
  await writeJsonl(path.join(outputDir, "versioning/review_patches.jsonl"), reviewPatches);

  return {
    status: "merged",
    output_dir: outputDir,
    parent_package_id: parentManifest.package_id,
    response_package_id: responseManifest.package_id,
    merged_package_id: mergedPackageId,
    response_id: responseContext.response_id,
    source_request_id: responseContext.source_request_id,
    file_count: (await listPackageFiles(outputDir)).length,
    merge_plan: summary.merge_plan,
    answerability_changes: summary.answerability_changes,
    versioning: {
      parents_path: "versioning/parents.json",
      merge_log_path: "versioning/merge_log.jsonl",
      diff_summary_path: "versioning/diff_summary.json",
      review_patches_path: "versioning/review_patches.jsonl"
    }
  };
}

function createReviewPatches(
  summary: DataResponseMergeSummary,
  responseContext: NonNullable<Awaited<ReturnType<typeof readManifest>>["response_context"]>,
  createdAt: string
): unknown[] {
  return summary.answerability_changes.finding_updates.map((update) => ({
    patch_id: `review_patch_${sanitizeId(summary.source_request_id)}_${sanitizeId(update.claim_id)}`,
    patch_type: "claim_status_review",
    review_state: "proposed",
    target_claim_id: update.claim_id,
    previous_status: update.previous_status,
    next_status: "needs_review",
    status_change: "review_required_before_apply",
    base_package_mutation: false,
    source_response_id: responseContext.response_id,
    source_request_id: responseContext.source_request_id,
    supporting_response_claim_ids: update.supporting_response_claim_ids,
    supporting_response_evidence_ids: update.supporting_response_evidence_ids,
    reviewer_note:
      "response 已提供新材料；该 patch 只建议把目标结论进入待审阅状态，不会自动改写 base package。人工审阅证据链后，才能生成应用后的新版本。",
    created_at: createdAt,
    created_by: "insight merge-response"
  }));
}

function formatCompatibilityIssue(issue: ResponseCompatibilityIssue): string {
  if (typeof issue === "string") {
    return issue;
  }

  return `${issue.severity} / ${issue.code} / ${issue.path}: ${issue.message}`;
}

function filterByIds<T extends IdRecord>(records: T[], idKey: keyof T & string, ids: string[]): T[] {
  const idSet = new Set(ids);
  return records.filter((record) => idSet.has(String(record[idKey])));
}

function selectResponseHomepageBlocks(
  responseBlocks: HomepageView["blocks"],
  additions: DataResponseMergeSummary["merge_plan"]["additions"],
  parentBlocks: HomepageView["blocks"]
): HomepageView["blocks"] {
  const addedClaimIds = new Set(additions.claims);
  const addedEvidenceIds = new Set(additions.evidence);
  const addedMetricIds = new Set(additions.metrics);
  const reservedBlockIds = new Set(parentBlocks.map((block) => block.block_id));

  return responseBlocks
    .filter(
      (block) =>
        (block.claim_id !== undefined && addedClaimIds.has(block.claim_id)) ||
        (block.metric_id !== undefined && addedMetricIds.has(block.metric_id)) ||
        (block.evidence_ids ?? []).some((evidenceId) => addedEvidenceIds.has(evidenceId))
    )
    .map((block) => {
      const blockId = createUniqueId(block.block_id, reservedBlockIds);
      return blockId === block.block_id ? block : { ...block, block_id: blockId };
    });
}

async function copyResponsePackageFile(responsePackageRoot: string, outputDir: string, relativePath: string): Promise<void> {
  const safeRelativePath = normalizeSafePackagePath(relativePath);
  const sourcePath = path.resolve(responsePackageRoot, safeRelativePath);
  const outputPath = path.resolve(outputDir, safeRelativePath);

  if (!isPathInside(responsePackageRoot, sourcePath)) {
    throw new Error(`拒绝复制 response 包外部路径：${relativePath}`);
  }

  if (!isPathInside(outputDir, outputPath)) {
    throw new Error(`拒绝写入 merged 包外部路径：${relativePath}`);
  }

  if (!(await pathExists(sourcePath))) {
    throw new Error(`合并引用的 response 包文件不存在：${safeRelativePath}`);
  }

  if (await pathExists(outputPath)) {
    throw new Error(`拒绝在合并时覆盖母包已有文件：${safeRelativePath}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await readFile(sourcePath));
}

function normalizeSafePackagePath(relativePath: string): string {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();

  if (
    normalizedPath.length === 0 ||
    normalizedPath.startsWith("/") ||
    /^[a-z]:/i.test(normalizedPath) ||
    normalizedPath.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe package path: ${relativePath}`);
  }

  return normalizedPath;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createUniqueId(baseId: string, reservedIds: Set<string>): string {
  let candidate = baseId;
  let suffix = 2;

  while (reservedIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }

  reservedIds.add(candidate);
  return candidate;
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, values.length === 0 ? "" : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

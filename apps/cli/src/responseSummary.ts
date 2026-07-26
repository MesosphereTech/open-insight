import path from "node:path";
import { pathExists, readJsonFile, readJsonlFile, readManifest } from "@open-insight/core";

export interface SummarizeDataResponsePackageOptions {
  parentPackageRoot: string;
  responsePackageRoot: string;
}

export interface DataResponseMergeSummary {
  status: "ready" | "blocked";
  parent_package_id: string;
  parent_title: string;
  response_package_id: string;
  response_title: string;
  response_id: string;
  response_state: string;
  source_request_id: string;
  parent_request_found: boolean;
  request_question?: string;
  compatibility_issues: ResponseCompatibilityIssue[];
  affected_findings: Array<{
    claim_id: string;
    found: boolean;
    status?: string;
    summary?: string;
  }>;
  answerability_changes: AnswerabilityChangeSummary;
  supplement_quality_warnings: SupplementQualityWarningSummary[];
  review_tasks: ResponseReviewTask[];
  merge_plan: {
    mode: "explicit_non_destructive";
    parent_mutation: false;
    additions: MergeObjectIds;
    duplicates: MergeObjectIds;
  };
}

export type ResponseCompatibilityIssue = string | ResponseCompatibilityIssueRecord;

export interface ResponseCompatibilityIssueRecord {
  severity: "warning" | "error";
  code: string;
  path: string;
  message: string;
}

export interface AnswerabilityChangeSummary {
  policy: {
    mode: "evidence_first_no_auto_promotion";
    parent_mutation: false;
    requires_review_for_status_change: true;
  };
  request_updates: AnswerabilityRequestUpdate[];
  finding_updates: AnswerabilityFindingUpdate[];
}

export interface AnswerabilityRequestUpdate {
  request_id: string;
  previous_status: string;
  next_status: "response_received_needs_review";
  previous_answerability_status: AnswerabilityStatus;
  next_answerability_status: "needs_review";
  status_change: "review_required";
  source_response_id: string;
  added_claim_ids: string[];
  added_evidence_ids: string[];
  affected_findings: string[];
  reviewer_note: string;
}

export interface AnswerabilityFindingUpdate {
  claim_id: string;
  previous_status: string;
  next_status: string;
  previous_answerability_status: AnswerabilityStatus;
  next_answerability_status: "needs_review";
  status_change: "unchanged_requires_review";
  reason: "merged_response_adds_review_material_only";
  supporting_response_claim_ids: string[];
  supporting_response_evidence_ids: string[];
  reviewer_note: string;
}

export type AnswerabilityStatus = "answered" | "partial" | "unanswerable" | "needs_review";

export interface MergeObjectIds {
  datasets: string[];
  metrics: string[];
  claims: string[];
  evidence: string[];
  prepared_questions: string[];
  lineage_sources: string[];
}

export interface SupplementQualityWarningSummary {
  dataset_id: string;
  path?: string | undefined;
  quality_warnings: SupplementQualityWarning[];
}

export interface SupplementQualityWarning {
  code: string;
  message: string;
  requested_fields?: string[] | undefined;
}

export type ResponseReviewTaskKind =
  | "supplement_quality_review"
  | "response_claim_review"
  | "response_evidence_review"
  | "affected_finding_review";

export type ResponseReviewTaskPriority = "high" | "medium" | "low";

export interface ResponseReviewTask {
  task_id: string;
  kind: ResponseReviewTaskKind;
  priority: ResponseReviewTaskPriority;
  title: string;
  action: string;
  target_type: "dataset" | "claim" | "evidence";
  target_id: string;
  related_ids: string[];
  blocking_merge: boolean;
}

interface DataRequest {
  request_id: string;
  question?: string;
  status?: string;
  affected_findings?: string[];
}

interface Dataset {
  dataset_id: string;
  path?: string;
  description?: string;
  quality_warnings?: SupplementQualityWarning[];
}

interface DataCatalog {
  datasets: Dataset[];
}

interface Metric {
  metric_id: string;
}

interface MetricsFile {
  metrics: Metric[];
}

interface Claim {
  claim_id: string;
  status?: string;
  summary?: string;
  evidence_ids?: string[];
}

interface Evidence {
  evidence_id: string;
  type?: string;
  summary?: string;
  source_refs?: Array<{ dataset_id?: string; path?: string }>;
}

interface PreparedQuestion {
  question_id: string;
}

interface LineageSource {
  source_id: string;
  path?: string;
}

interface LineageSourcesFile {
  sources: LineageSource[];
}

export async function summarizeDataResponsePackage(
  options: SummarizeDataResponsePackageOptions
): Promise<DataResponseMergeSummary> {
  const parentPackageRoot = path.resolve(options.parentPackageRoot);
  const responsePackageRoot = path.resolve(options.responsePackageRoot);
  const parentManifest = await readManifest(parentPackageRoot);
  const responseManifest = await readManifest(responsePackageRoot);
  const responseContext = responseManifest.response_context;

  if (!responseContext) {
    throw new Error(`文件包 '${responsePackageRoot}' 缺少 manifest.response_context，无法作为 response 汇总。`);
  }

  const compatibilityIssues: string[] = [];

  if (responseContext.parent_package_id !== parentManifest.package_id) {
    compatibilityIssues.push(
      `PARENT_PACKAGE_MISMATCH: response 指向 '${responseContext.parent_package_id}'，但当前母包是 '${parentManifest.package_id}'`
    );
  }

  const parentRequests = await readOptionalJsonl<DataRequest>(parentPackageRoot, "answerability/data_requests.jsonl");
  const parentRequest = parentRequests.find((request) => request.request_id === responseContext.source_request_id);

  if (!parentRequest) {
    compatibilityIssues.push(`SOURCE_REQUEST_NOT_FOUND: 母包中找不到 '${responseContext.source_request_id}'`);
  }

  const parentCatalog = await readJsonFile<DataCatalog>(path.join(parentPackageRoot, "data/catalog.json"));
  const responseCatalog = await readJsonFile<DataCatalog>(path.join(responsePackageRoot, "data/catalog.json"));
  const parentMetrics = await readJsonFile<MetricsFile>(path.join(parentPackageRoot, "semantic/metrics.json"));
  const responseMetrics = await readJsonFile<MetricsFile>(path.join(responsePackageRoot, "semantic/metrics.json"));
  const parentClaims = await readJsonlFile<Claim>(path.join(parentPackageRoot, "findings/claims.jsonl"));
  const responseClaims = await readJsonlFile<Claim>(path.join(responsePackageRoot, "findings/claims.jsonl"));
  const parentEvidence = await readJsonlFile<Evidence>(path.join(parentPackageRoot, "evidence/evidence.jsonl"));
  const responseEvidence = await readJsonlFile<Evidence>(path.join(responsePackageRoot, "evidence/evidence.jsonl"));
  const parentQuestions = await readJsonlFile<PreparedQuestion>(path.join(parentPackageRoot, "qa/prepared_questions.jsonl"));
  const responseQuestions = await readJsonlFile<PreparedQuestion>(path.join(responsePackageRoot, "qa/prepared_questions.jsonl"));
  const parentLineage = await readJsonFile<LineageSourcesFile>(path.join(parentPackageRoot, "lineage/sources.json"));
  const responseLineage = await readJsonFile<LineageSourcesFile>(path.join(responsePackageRoot, "lineage/sources.json"));

  const parentClaimById = new Map(parentClaims.map((claim) => [claim.claim_id, claim]));
  const affectedFindingIds = responseContext.affected_findings ?? parentRequest?.affected_findings ?? [];
  const affectedFindings = affectedFindingIds.map((claimId) => {
    const claim = parentClaimById.get(claimId);

    if (!claim) {
      compatibilityIssues.push(`AFFECTED_FINDING_NOT_FOUND: 母包中找不到 '${claimId}'`);
    }

    return {
      claim_id: claimId,
      found: claim !== undefined,
      ...(claim?.status ? { status: claim.status } : {}),
      ...(claim?.summary ? { summary: claim.summary } : {})
    };
  });

  const mergePlan = createMergePlan(
    {
      datasets: parentCatalog.datasets.map((dataset) => dataset.dataset_id),
      metrics: parentMetrics.metrics.map((metric) => metric.metric_id),
      claims: parentClaims.map((claim) => claim.claim_id),
      evidence: parentEvidence.map((record) => record.evidence_id),
      prepared_questions: parentQuestions.map((question) => question.question_id),
      lineage_sources: parentLineage.sources.map((source) => source.source_id)
    },
    {
      datasets: responseCatalog.datasets.map((dataset) => dataset.dataset_id),
      metrics: responseMetrics.metrics.map((metric) => metric.metric_id),
      claims: responseClaims.map((claim) => claim.claim_id),
      evidence: responseEvidence.map((record) => record.evidence_id),
      prepared_questions: responseQuestions.map((question) => question.question_id),
      lineage_sources: responseLineage.sources.map((source) => source.source_id)
    }
  );
  const answerabilityChanges = createAnswerabilityChanges({
    parentRequest,
    affectedFindings,
    sourceResponseId: responseContext.response_id,
    addedClaimIds: mergePlan.additions.claims,
    addedEvidenceIds: mergePlan.additions.evidence
  });
  const supplementQualityWarnings = collectSupplementQualityWarnings(responseCatalog.datasets, mergePlan.additions.datasets);
  const hasCompatibilityIssues = compatibilityIssues.length > 0;
  const reviewTasks = hasCompatibilityIssues
    ? []
    : createResponseReviewTasks({
        affectedFindings,
        answerabilityChanges,
        addedDatasetIds: mergePlan.additions.datasets,
        addedClaimIds: mergePlan.additions.claims,
        addedEvidenceIds: mergePlan.additions.evidence,
        responseDatasets: responseCatalog.datasets,
        responseClaims,
        responseEvidence,
        responseLineageSources: responseLineage.sources,
        supplementQualityWarnings
      });

  return {
    status: hasCompatibilityIssues ? "blocked" : "ready",
    parent_package_id: parentManifest.package_id,
    parent_title: parentManifest.title,
    response_package_id: responseManifest.package_id,
    response_title: responseManifest.title,
    response_id: responseContext.response_id,
    response_state: responseContext.response_state,
    source_request_id: responseContext.source_request_id,
    parent_request_found: parentRequest !== undefined,
    ...(parentRequest?.question ? { request_question: parentRequest.question } : {}),
    compatibility_issues: compatibilityIssues,
    affected_findings: affectedFindings,
    answerability_changes: answerabilityChanges,
    supplement_quality_warnings: supplementQualityWarnings,
    review_tasks: reviewTasks,
    merge_plan: {
      mode: "explicit_non_destructive",
      parent_mutation: false,
      ...mergePlan
    }
  };
}

function createResponseReviewTasks(options: {
  affectedFindings: DataResponseMergeSummary["affected_findings"];
  answerabilityChanges: AnswerabilityChangeSummary;
  addedDatasetIds: string[];
  addedClaimIds: string[];
  addedEvidenceIds: string[];
  responseDatasets: Dataset[];
  responseClaims: Claim[];
  responseEvidence: Evidence[];
  responseLineageSources: LineageSource[];
  supplementQualityWarnings: SupplementQualityWarningSummary[];
}): ResponseReviewTask[] {
  const tasks: ResponseReviewTask[] = [];
  const datasetById = new Map(options.responseDatasets.map((dataset) => [dataset.dataset_id, dataset]));
  const claimById = new Map(options.responseClaims.map((claim) => [claim.claim_id, claim]));
  const evidenceById = new Map(options.responseEvidence.map((evidence) => [evidence.evidence_id, evidence]));
  const lineageSourceIdsByPath = new Map<string, string[]>();

  options.responseLineageSources.forEach((source) => {
    const normalizedPath = normalizePackagePath(source.path);

    if (!normalizedPath) {
      return;
    }

    lineageSourceIdsByPath.set(normalizedPath, [...(lineageSourceIdsByPath.get(normalizedPath) ?? []), source.source_id]);
  });

  options.supplementQualityWarnings.forEach((item) => {
    const dataset = datasetById.get(item.dataset_id);
    const normalizedPath = normalizePackagePath(item.path);
    const relatedIds = normalizedPath ? lineageSourceIdsByPath.get(normalizedPath) ?? [] : [];

    tasks.push({
      task_id: `review_supplement_quality_${sanitizeTaskId(item.dataset_id)}`,
      kind: "supplement_quality_review",
      priority: "high",
      title: `复核补充材料质量：${dataset?.description ?? item.dataset_id}`,
      action: `该补充材料存在 ${item.quality_warnings.length} 条质量告警，合并前需要人工确认字段、行数和 request 缺失字段是否真正被补齐。`,
      target_type: "dataset",
      target_id: item.dataset_id,
      related_ids: relatedIds,
      blocking_merge: false
    });
  });

  options.addedClaimIds.forEach((claimId) => {
    const claim = claimById.get(claimId);

    if (!claim) {
      return;
    }

    tasks.push({
      task_id: `review_response_claim_${sanitizeTaskId(claimId)}`,
      kind: "response_claim_review",
      priority: claim.status === "needs_review" ? "high" : "medium",
      title: `审阅 response 新增结论：${claim.summary ?? claimId}`,
      action: "确认新增结论是否被证据支撑，不能因为 response 已合并就自动标记为已验证或已回答。",
      target_type: "claim",
      target_id: claimId,
      related_ids: claim.evidence_ids ?? [],
      blocking_merge: false
    });
  });

  options.addedEvidenceIds.forEach((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);

    if (!evidence) {
      return;
    }

    const sourceDatasetIds = uniqueStrings((evidence.source_refs ?? []).flatMap((sourceRef) => (sourceRef.dataset_id ? [sourceRef.dataset_id] : [])));

    tasks.push({
      task_id: `review_response_evidence_${sanitizeTaskId(evidenceId)}`,
      kind: "response_evidence_review",
      priority: sourceDatasetIds.length > 0 ? "medium" : "high",
      title: `核验 response 新增证据：${evidence.summary ?? evidenceId}`,
      action: "检查证据来源数据集、补充材料和结论之间的追踪关系，确认它能支撑后续 review patch。",
      target_type: "evidence",
      target_id: evidenceId,
      related_ids: sourceDatasetIds,
      blocking_merge: false
    });
  });

  options.answerabilityChanges.finding_updates.forEach((update) => {
    const affectedFinding = options.affectedFindings.find((finding) => finding.claim_id === update.claim_id);

    tasks.push({
      task_id: `review_affected_finding_${sanitizeTaskId(update.claim_id)}`,
      kind: "affected_finding_review",
      priority: "high",
      title: `复核受影响结论：${affectedFinding?.summary ?? update.claim_id}`,
      action: "response 只把该结论推进到待复核状态；必须人工确认新增结论和证据后，才能应用 review patch。",
      target_type: "claim",
      target_id: update.claim_id,
      related_ids: uniqueStrings([...update.supporting_response_claim_ids, ...update.supporting_response_evidence_ids]),
      blocking_merge: false
    });
  });

  return tasks;
}

function collectSupplementQualityWarnings(datasets: Dataset[], addedDatasetIds: string[]): SupplementQualityWarningSummary[] {
  const addedDatasetIdSet = new Set(addedDatasetIds);

  return datasets
    .filter((dataset) => addedDatasetIdSet.has(dataset.dataset_id))
    .filter((dataset) => isSupplementDataset(dataset))
    .flatMap((dataset) => {
      const warnings = dataset.quality_warnings ?? [];

      if (warnings.length === 0) {
        return [];
      }

      return [
        {
          dataset_id: dataset.dataset_id,
          ...(dataset.path ? { path: dataset.path } : {}),
          quality_warnings: warnings
        }
      ];
    });
}

function isSupplementDataset(dataset: Dataset): boolean {
  return dataset.dataset_id.startsWith("supplement_") || normalizePackagePath(dataset.path)?.startsWith("data/supplements/") === true;
}

function normalizePackagePath(value: string | undefined): string | undefined {
  return value?.replace(/\\/g, "/").replace(/^\/+/, "");
}

function sanitizeTaskId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function createAnswerabilityChanges(options: {
  parentRequest: DataRequest | undefined;
  affectedFindings: DataResponseMergeSummary["affected_findings"];
  sourceResponseId: string;
  addedClaimIds: string[];
  addedEvidenceIds: string[];
}): AnswerabilityChangeSummary {
  const affectedFindingIds = options.affectedFindings.map((finding) => finding.claim_id);

  return {
    policy: {
      mode: "evidence_first_no_auto_promotion",
      parent_mutation: false,
      requires_review_for_status_change: true
    },
    request_updates: options.parentRequest
      ? [
          {
            request_id: options.parentRequest.request_id,
            previous_status: options.parentRequest.status ?? "unknown",
            next_status: "response_received_needs_review",
            previous_answerability_status: mapStatusToAnswerabilityStatus(options.parentRequest.status),
            next_answerability_status: "needs_review",
            status_change: "review_required",
            source_response_id: options.sourceResponseId,
            added_claim_ids: options.addedClaimIds,
            added_evidence_ids: options.addedEvidenceIds,
            affected_findings: affectedFindingIds,
            reviewer_note:
              "Response 已合并为新材料，但原不可回答结论不会自动变为 verified；需要人工审阅新增证据后再更新结论状态。"
          }
        ]
      : [],
    finding_updates: options.affectedFindings.map((finding) => ({
      claim_id: finding.claim_id,
      previous_status: finding.status ?? "unknown",
      next_status: finding.status ?? "unknown",
      previous_answerability_status: mapStatusToAnswerabilityStatus(finding.status),
      next_answerability_status: "needs_review",
      status_change: "unchanged_requires_review",
      reason: "merged_response_adds_review_material_only",
      supporting_response_claim_ids: options.addedClaimIds,
      supporting_response_evidence_ids: options.addedEvidenceIds,
      reviewer_note: "新增 response 材料可用于复审该结论，但不能自动替代原证据链。"
    }))
  };
}

function mapStatusToAnswerabilityStatus(status: string | undefined): AnswerabilityStatus {
  const normalized = status?.trim().toLowerCase();

  if (!normalized) {
    return "needs_review";
  }

  if (["verified", "answered", "resolved"].includes(normalized)) {
    return "answered";
  }

  if (["partial", "partially_answered"].includes(normalized)) {
    return "partial";
  }

  if (["unanswerable", "missing_data", "needs_data", "missing_required_data"].includes(normalized)) {
    return "unanswerable";
  }

  return "needs_review";
}

async function readOptionalJsonl<T>(root: string, relativePath: string): Promise<T[]> {
  const filePath = path.join(root, relativePath);

  if (!(await pathExists(filePath))) {
    return [];
  }

  return readJsonlFile<T>(filePath);
}

function createMergePlan(parent: MergeObjectIds, response: MergeObjectIds): { additions: MergeObjectIds; duplicates: MergeObjectIds } {
  return {
    additions: {
      datasets: idsOnlyInResponse(parent.datasets, response.datasets),
      metrics: idsOnlyInResponse(parent.metrics, response.metrics),
      claims: idsOnlyInResponse(parent.claims, response.claims),
      evidence: idsOnlyInResponse(parent.evidence, response.evidence),
      prepared_questions: idsOnlyInResponse(parent.prepared_questions, response.prepared_questions),
      lineage_sources: idsOnlyInResponse(parent.lineage_sources, response.lineage_sources)
    },
    duplicates: {
      datasets: idsAlreadyInParent(parent.datasets, response.datasets),
      metrics: idsAlreadyInParent(parent.metrics, response.metrics),
      claims: idsAlreadyInParent(parent.claims, response.claims),
      evidence: idsAlreadyInParent(parent.evidence, response.evidence),
      prepared_questions: idsAlreadyInParent(parent.prepared_questions, response.prepared_questions),
      lineage_sources: idsAlreadyInParent(parent.lineage_sources, response.lineage_sources)
    }
  };
}

function idsOnlyInResponse(parentIds: string[], responseIds: string[]): string[] {
  const parentIdSet = new Set(parentIds);
  return responseIds.filter((id) => !parentIdSet.has(id)).sort();
}

function idsAlreadyInParent(parentIds: string[], responseIds: string[]): string[] {
  const parentIdSet = new Set(parentIds);
  return responseIds.filter((id) => parentIdSet.has(id)).sort();
}

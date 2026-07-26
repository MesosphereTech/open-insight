import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSIGHT_SPEC_VERSION, listPackageFiles, pathExists, readJsonlFile, readManifest } from "@open-insight/core";

export interface ImportOverlayFollowupOptions {
  packageRoot: string;
  followupFile: string;
  outputDir: string;
  createdAt?: string;
  createdBy?: string;
  importedPackageId?: string;
}

export interface ImportOverlayFollowupResult {
  status: "overlay_followup_imported";
  output_dir: string;
  source_package_id: string;
  imported_package_id: string;
  followup_schema_version: "studio.overlay_qa_followup.v0.1";
  followup_metadata_package_id: string;
  followup_source_name: string;
  prepared_questions_added: number;
  data_requests_added: number;
  base_package_mutation: false;
  file_count: number;
  mappings: {
    prepared_questions: Array<{ source_question_id: string; question_id: string; qa_id: string }>;
    data_requests: Array<{ source_request_id: string; request_id: string; qa_id: string }>;
  };
}

interface PreparedQuestionRecord {
  question_id: string;
  question: string;
  answer: string;
  status: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  [key: string]: unknown;
}

interface DataRequestRecord {
  request_id: string;
  question: string;
  status: string;
  missing_fields: string[];
  why_needed: string;
  required_grain?: string;
  required_time_range?: string;
  priority?: string;
  affected_findings?: string[];
  [key: string]: unknown;
}

interface IdRecord {
  [key: string]: unknown;
}

interface OverlayFollowupExport {
  schema_version?: string;
  metadata?: {
    package_id?: string;
    title?: string;
    domain_pack?: string;
    source_name?: string;
    reviewer?: string;
    exported_at?: string;
    total_candidates?: number;
    exported_candidates?: number;
    prepared_question_candidates?: number;
    data_request_candidates?: number;
    base_package_mutation?: boolean;
    [key: string]: unknown;
  };
  prepared_question_candidates?: OverlayPreparedQuestionCandidate[];
  data_request_candidates?: OverlayDataRequestCandidate[];
  [key: string]: unknown;
}

interface OverlayPreparedQuestionCandidate {
  question_id?: string;
  qa_id?: string;
  question?: string;
  answer?: string;
  status?: string;
  source?: string;
  generation_status?: string;
  review_status?: string;
  claim_ids?: unknown;
  evidence_ids?: unknown;
  data_request_ids?: unknown;
  promotion_policy?: string;
  base_package_mutation?: boolean;
  [key: string]: unknown;
}

interface OverlayDataRequestCandidate {
  request_id?: string;
  qa_id?: string;
  question?: string;
  status?: string;
  missing_fields?: unknown;
  required_grain?: string;
  required_time_range?: string;
  why_needed?: string;
  priority?: string;
  affected_findings?: unknown;
  source?: string;
  base_package_mutation?: boolean;
  [key: string]: unknown;
}

export async function importOverlayFollowup(options: ImportOverlayFollowupOptions): Promise<ImportOverlayFollowupResult> {
  const packageRoot = path.resolve(options.packageRoot);
  const followupFile = path.resolve(options.followupFile);
  const outputDir = path.resolve(options.outputDir);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const createdBy = options.createdBy ?? "insight import-overlay-followup";

  if (await pathExists(outputDir)) {
    throw new Error(`输出目录已存在：${outputDir}`);
  }

  if (isPathInside(packageRoot, outputDir)) {
    throw new Error("输出目录不能位于来源包内部，避免把派生包写回 base package");
  }

  const manifest = await readManifest(packageRoot);
  const followup = await readFollowupExport(followupFile);
  assertFollowupExportIsSafe(followup);

  const existingQuestions = await readJsonlFile<PreparedQuestionRecord>(path.join(packageRoot, "qa/prepared_questions.jsonl"));
  const existingDataRequests = await readJsonlFile<DataRequestRecord>(path.join(packageRoot, "answerability/data_requests.jsonl"));
  const claims = await readJsonlFile<IdRecord & { claim_id: string }>(path.join(packageRoot, "findings/claims.jsonl"));
  const evidence = await readJsonlFile<IdRecord & { evidence_id: string }>(path.join(packageRoot, "evidence/evidence.jsonl"));
  const claimIds = new Set(claims.map((claim) => claim.claim_id));
  const evidenceIds = new Set(evidence.map((item) => item.evidence_id));
  const existingQuestionIds = new Set(existingQuestions.map((question) => question.question_id));
  const existingDataRequestIds = new Set(existingDataRequests.map((request) => request.request_id));
  const requestIdMapping = new Map<string, string>();

  const preparedCandidates = followup.prepared_question_candidates ?? [];
  const requestCandidates = followup.data_request_candidates ?? [];
  validateCandidateReferences(preparedCandidates, requestCandidates, claimIds, evidenceIds, existingDataRequestIds);

  const dataRequestMappings: ImportOverlayFollowupResult["mappings"]["data_requests"] = [];
  const dataRequestsToAdd = requestCandidates.map((candidate, index) => {
    const sourceRequestId = requireNonEmptyString(candidate.request_id, `data_request_candidates/${index}/request_id`);
    const requestId = createUniqueId(sourceRequestId, existingDataRequestIds);
    const affectedFindings = asStringArray(candidate.affected_findings);
    requestIdMapping.set(sourceRequestId, requestId);
    dataRequestMappings.push({
      source_request_id: sourceRequestId,
      request_id: requestId,
      qa_id: requireNonEmptyString(candidate.qa_id, `data_request_candidates/${index}/qa_id`)
    });

    return {
      request_id: requestId,
      question: requireNonEmptyString(candidate.question, `data_request_candidates/${index}/question`),
      status: "draft",
      missing_fields: asStringArray(candidate.missing_fields).length > 0 ? asStringArray(candidate.missing_fields) : ["overlay_followup_context"],
      ...(candidate.required_grain ? { required_grain: candidate.required_grain } : {}),
      ...(candidate.required_time_range ? { required_time_range: candidate.required_time_range } : {}),
      why_needed: requireNonEmptyString(candidate.why_needed, `data_request_candidates/${index}/why_needed`),
      priority: candidate.priority?.trim() || "medium",
      affected_findings: affectedFindings,
      source: "studio_overlay_qa_followup",
      source_qa_id: candidate.qa_id,
      source_request_id: sourceRequestId,
      source_followup_file: normalizePackagePath(path.basename(followupFile)),
      base_package_mutation: false,
      imported_at: createdAt,
      imported_by: createdBy
    } satisfies DataRequestRecord;
  });

  const preparedQuestionMappings: ImportOverlayFollowupResult["mappings"]["prepared_questions"] = [];
  const preparedQuestionsToAdd = preparedCandidates.map((candidate, index) => {
    const sourceQuestionId = requireNonEmptyString(candidate.question_id, `prepared_question_candidates/${index}/question_id`);
    const questionId = createUniqueId(sourceQuestionId, existingQuestionIds);
    const sourceDataRequestIds = asStringArray(candidate.data_request_ids);
    const dataRequestIds = uniqueSorted(
      sourceDataRequestIds.map((requestId) => requestIdMapping.get(requestId) ?? requestId).filter((requestId) => existingDataRequestIds.has(requestId))
    );
    const mappedDataRequestIds = uniqueSorted(sourceDataRequestIds.map((requestId) => requestIdMapping.get(requestId) ?? requestId));
    const qaId = requireNonEmptyString(candidate.qa_id, `prepared_question_candidates/${index}/qa_id`);

    preparedQuestionMappings.push({
      source_question_id: sourceQuestionId,
      question_id: questionId,
      qa_id: qaId
    });

    return {
      question_id: questionId,
      question: requireNonEmptyString(candidate.question, `prepared_question_candidates/${index}/question`),
      answer: requireNonEmptyString(candidate.answer, `prepared_question_candidates/${index}/answer`),
      status: candidate.status === "unanswerable" ? "unanswerable" : "needs_review",
      review_state: "draft_requires_review",
      confirmation_scope: "overlay_followup_candidate",
      review_note:
        "来自 Studio overlay 追问处理建议。该记录只是待审阅草稿，不代表人工确认，也不会回写 base package。",
      edited_by: createdBy,
      claim_ids: asStringArray(candidate.claim_ids),
      evidence_ids: asStringArray(candidate.evidence_ids),
      data_request_ids: mappedDataRequestIds,
      active_data_request_ids: dataRequestIds,
      source: "studio_overlay_qa_followup",
      source_qa_id: qaId,
      source_question_id: sourceQuestionId,
      source_followup_file: normalizePackagePath(path.basename(followupFile)),
      promotion_policy: "draft_requires_review",
      generation_status: candidate.generation_status ?? "unknown",
      review_status: candidate.review_status ?? "needs_review",
      base_package_mutation: false,
      imported_at: createdAt,
      imported_by: createdBy
    } satisfies PreparedQuestionRecord;
  });

  const importedPackageId =
    options.importedPackageId ?? `${manifest.package_id}.followup.${sanitizeId(followup.metadata?.exported_at ?? createdAt)}`;

  await cp(packageRoot, outputDir, { recursive: true });
  await writeJson(path.join(outputDir, "manifest.json"), {
    ...manifest,
    spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
    package_id: importedPackageId,
    title: `${manifest.title} - 追问处理草稿`,
    description: `从 Studio overlay 追问处理建议生成的新派生包；来源包 ${manifest.package_id} 不会被修改，新增问题和补数请求均需人工审阅。`,
    created_at: createdAt,
    optional_capabilities: uniqueSorted([...(manifest.optional_capabilities ?? []), "overlay.followup_import"])
  });
  await writeJsonl(path.join(outputDir, "qa/prepared_questions.jsonl"), [...existingQuestions, ...preparedQuestionsToAdd]);
  await writeJsonl(path.join(outputDir, "answerability/data_requests.jsonl"), [...existingDataRequests, ...dataRequestsToAdd]);

  return {
    status: "overlay_followup_imported",
    output_dir: outputDir,
    source_package_id: manifest.package_id,
    imported_package_id: importedPackageId,
    followup_schema_version: "studio.overlay_qa_followup.v0.1",
    followup_metadata_package_id: requireNonEmptyString(followup.metadata?.package_id, "metadata/package_id"),
    followup_source_name: followup.metadata?.source_name ?? path.basename(followupFile),
    prepared_questions_added: preparedQuestionsToAdd.length,
    data_requests_added: dataRequestsToAdd.length,
    base_package_mutation: false,
    file_count: (await listPackageFiles(outputDir)).length,
    mappings: {
      prepared_questions: preparedQuestionMappings,
      data_requests: dataRequestMappings
    }
  };
}

async function readFollowupExport(filePath: string): Promise<OverlayFollowupExport> {
  const raw = await readFile(filePath, "utf8");
  const value = JSON.parse(raw) as unknown;

  if (!isRecord(value)) {
    throw new Error("追问处理建议必须是 JSON 对象");
  }

  return value as OverlayFollowupExport;
}

function assertFollowupExportIsSafe(followup: OverlayFollowupExport): asserts followup is OverlayFollowupExport & {
  schema_version: "studio.overlay_qa_followup.v0.1";
  metadata: NonNullable<OverlayFollowupExport["metadata"]>;
  prepared_question_candidates: OverlayPreparedQuestionCandidate[];
  data_request_candidates: OverlayDataRequestCandidate[];
} {
  if (followup.schema_version !== "studio.overlay_qa_followup.v0.1") {
    throw new Error("仅支持 studio.overlay_qa_followup.v0.1 追问处理建议");
  }

  if (!isRecord(followup.metadata)) {
    throw new Error("追问处理建议缺少 metadata");
  }

  if (followup.metadata.base_package_mutation !== false) {
    throw new Error("追问处理建议必须声明 metadata.base_package_mutation = false");
  }

  requireNonEmptyString(followup.metadata.package_id, "metadata/package_id");

  if (!Array.isArray(followup.prepared_question_candidates)) {
    throw new Error("追问处理建议缺少 prepared_question_candidates 数组");
  }

  if (!Array.isArray(followup.data_request_candidates)) {
    throw new Error("追问处理建议缺少 data_request_candidates 数组");
  }

  followup.prepared_question_candidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`prepared_question_candidates/${index} 必须是对象`);
    }

    requireNonEmptyString(candidate.question_id, `prepared_question_candidates/${index}/question_id`);
    requireNonEmptyString(candidate.qa_id, `prepared_question_candidates/${index}/qa_id`);
    requireNonEmptyString(candidate.question, `prepared_question_candidates/${index}/question`);
    requireNonEmptyString(candidate.answer, `prepared_question_candidates/${index}/answer`);

    if (candidate.status !== "needs_review" && candidate.status !== "unanswerable") {
      throw new Error(`prepared_question_candidates/${index}/status 必须是 needs_review 或 unanswerable`);
    }

    if (candidate.promotion_policy !== "draft_requires_review") {
      throw new Error(`prepared_question_candidates/${index}/promotion_policy 必须是 draft_requires_review`);
    }

    if (candidate.base_package_mutation !== false) {
      throw new Error(`prepared_question_candidates/${index}/base_package_mutation 必须是 false`);
    }
  });

  followup.data_request_candidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`data_request_candidates/${index} 必须是对象`);
    }

    requireNonEmptyString(candidate.request_id, `data_request_candidates/${index}/request_id`);
    requireNonEmptyString(candidate.qa_id, `data_request_candidates/${index}/qa_id`);
    requireNonEmptyString(candidate.question, `data_request_candidates/${index}/question`);
    requireNonEmptyString(candidate.why_needed, `data_request_candidates/${index}/why_needed`);

    if (candidate.status !== "draft") {
      throw new Error(`data_request_candidates/${index}/status 必须是 draft`);
    }

    if (candidate.base_package_mutation !== false) {
      throw new Error(`data_request_candidates/${index}/base_package_mutation 必须是 false`);
    }
  });
}

function validateCandidateReferences(
  preparedCandidates: OverlayPreparedQuestionCandidate[],
  requestCandidates: OverlayDataRequestCandidate[],
  claimIds: Set<string>,
  evidenceIds: Set<string>,
  existingDataRequestIds: Set<string>
): void {
  const candidateDataRequestIds = new Set(
    requestCandidates.map((candidate) => candidate.request_id).filter((requestId): requestId is string => typeof requestId === "string")
  );

  preparedCandidates.forEach((candidate, index) => {
    for (const claimId of asStringArray(candidate.claim_ids)) {
      if (!claimIds.has(claimId)) {
        throw new Error(`prepared_question_candidates/${index}/claim_ids 引用不存在的 claim：${claimId}`);
      }
    }

    for (const evidenceId of asStringArray(candidate.evidence_ids)) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`prepared_question_candidates/${index}/evidence_ids 引用不存在的 evidence：${evidenceId}`);
      }
    }

    for (const requestId of asStringArray(candidate.data_request_ids)) {
      if (!existingDataRequestIds.has(requestId) && !candidateDataRequestIds.has(requestId)) {
        throw new Error(`prepared_question_candidates/${index}/data_request_ids 引用不存在的 data request：${requestId}`);
      }
    }
  });

  requestCandidates.forEach((candidate, index) => {
    for (const claimId of asStringArray(candidate.affected_findings)) {
      if (!claimIds.has(claimId)) {
        throw new Error(`data_request_candidates/${index}/affected_findings 引用不存在的 claim：${claimId}`);
      }
    }
  });
}

function requireNonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`追问处理建议缺少 ${fieldPath}`);
  }

  return value.trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function createUniqueId(baseId: string, reservedIds: Set<string>): string {
  const sanitizedBaseId = sanitizeId(baseId);
  let candidate = sanitizedBaseId;
  let suffix = 2;

  while (reservedIds.has(candidate)) {
    candidate = `${sanitizedBaseId}_${suffix}`;
    suffix += 1;
  }

  reservedIds.add(candidate);
  return candidate;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, values.length === 0 ? "" : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizePackagePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function sanitizeId(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "item";
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

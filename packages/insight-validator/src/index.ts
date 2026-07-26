import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { getInsightPackagePaths, pathExists, readJsonFile, readManifest } from "@open-insight/core";

const require = createRequire(import.meta.url);

interface JsonSchemaValidateFunction {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

interface JsonSchemaValidator {
  compile(schema: unknown): JsonSchemaValidateFunction;
}

const Ajv2020 = require("ajv/dist/2020.js").default as new (options: {
  allErrors: boolean;
  strict: boolean;
}) => JsonSchemaValidator;

const addFormats = require("ajv-formats").default as (validator: JsonSchemaValidator) => void;

export type ValidationSeverity = "error" | "warning";
export type ValidationStatus = "valid" | "valid_with_warnings" | "invalid";
export type ValidationIssueCode =
  | "MISSING_MANIFEST"
  | "INVALID_MANIFEST_TYPE"
  | "MISSING_MANIFEST_SPEC_VERSION"
  | "MISSING_CORE_CAPABILITY"
  | "MANIFEST_PARSE_ERROR"
  | "MISSING_CORE_FILE"
  | "SCHEMA_ROOT_NOT_FOUND"
  | "SCHEMA_FILE_MISSING"
  | "SCHEMA_PARSE_ERROR"
  | "SCHEMA_VALIDATION_ERROR"
  | "JSON_PARSE_ERROR"
  | "JSONL_PARSE_ERROR"
  | "FILE_READ_ERROR"
  | "DUPLICATE_ID"
  | "DUPLICATE_COLUMN"
  | "UNSAFE_EXTENSION_NAMESPACE"
  | "UNSAFE_OVERLAY"
  | "UNSAFE_MERGE_POLICY"
  | "UNSAFE_ANSWERABILITY_POLICY"
  | "UNSAFE_REVIEW_HISTORY"
  | "UNSAFE_REVIEW_PATCH"
  | "UNKNOWN_DATASET"
  | "UNKNOWN_COLUMN"
  | "UNKNOWN_METRIC"
  | "UNKNOWN_CLAIM"
  | "UNKNOWN_EVIDENCE"
  | "UNKNOWN_DATA_REQUEST"
  | "UNKNOWN_PACKAGE_TARGET"
  | "UNKNOWN_VIEW_BLOCK"
  | "UNKNOWN_QUESTION"
  | "UNLINKED_SUPPORTING_RESPONSE_EVIDENCE"
  | "MISMATCHED_EVIDENCE_SOURCE_PATH"
  | "UNTRACEABLE_DATASET_LINEAGE"
  | "UNTRACEABLE_EVIDENCE_LINEAGE"
  | "UNTRACEABLE_VIEW_BLOCK_CONTEXT"
  | "UNTRACEABLE_VIEW_BLOCK_EVIDENCE"
  | "UNTRACEABLE_VIEW_BLOCK_SOURCE"
  | "MISSING_DOMAIN_PACK_EXTENSION"
  | "MISSING_DOMAIN_PACK_CAPABILITY"
  | "UNSAFE_DOMAIN_PACK_EXTENSION"
  | "INVALID_DOMAIN_PACK_EXTENSION";

export interface ValidationIssue {
  code: ValidationIssueCode;
  severity: ValidationSeverity;
  path: string;
  message: string;
}

export interface ValidationResult {
  schema_version: "open-insight.validation-result.v0.1";
  status: ValidationStatus;
  issues: ValidationIssue[];
}

export interface ValidationOptions {
  schemaRoot?: string;
}

export interface SchemaInspectionFileResult {
  schema_file: string;
  status: "ok" | "missing" | "parse_error";
}

export interface SchemaInspectionResult {
  schema_version: "open-insight.schema-check.v0.1";
  status: "ok" | "invalid";
  schema_root: string;
  files: SchemaInspectionFileResult[];
  issues: ValidationIssue[];
}

interface MetricRecord {
  metric_id: string;
  dataset_id?: string;
}

interface DatasetRecord {
  dataset_id: string;
  path?: string;
  columns?: DatasetColumnRecord[];
}

interface DatasetColumnRecord {
  name?: string;
}

interface DataCatalogFile {
  datasets: DatasetRecord[];
}

interface MetricsFile {
  metrics: MetricRecord[];
}

interface EntityRecord {
  entity_id: string;
  dataset_id?: string;
  primary_key?: string;
}

interface EntitiesFile {
  entities: EntityRecord[];
}

interface HomepageBlock {
  block_id: string;
  metric_id?: string;
  claim_id?: string;
  evidence_ids?: string[];
}

interface HomepageView {
  blocks: HomepageBlock[];
}

interface ClaimRecord {
  claim_id: string;
  metric_ids?: string[];
  evidence_ids?: string[];
  supporting_response_claim_ids?: string[];
  supporting_response_evidence_ids?: string[];
}

interface EvidenceRecord {
  evidence_id: string;
  source_refs?: EvidenceSourceRefRecord[];
}

interface EvidenceSourceRefRecord {
  dataset_id?: string;
  path?: string;
}

interface LineageSourcesFile {
  sources: LineageSourceRecord[];
}

interface LineageSourceRecord {
  source_id: string;
  path?: string;
}

interface PreparedQuestionRecord {
  question_id: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  data_request_ids?: string[];
  active_data_request_ids?: string[];
}

interface DataRequestRecord {
  request_id: string;
  affected_findings?: string[];
}

interface OverlayMetadataFile {
  overlay_id?: string;
  base_package_id?: string;
  base_package_mutation?: boolean;
}

interface OverlayNoteRecord {
  note_id?: string;
  target_type?: "package" | "claim" | "evidence" | "view_block" | "question" | string;
  target_id?: string;
  base_package_mutation?: boolean;
}

interface OverlayQaRecord {
  qa_id?: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  data_request_ids?: string[];
  answerability_status?: string;
  answer_status?: string;
  model_enabled?: boolean;
  generation_status?: string;
  review_status?: string;
  base_package_mutation?: boolean;
}

interface VersioningDiffSummaryFile {
  merge_plan?: {
    mode?: string;
    parent_mutation?: boolean;
  };
  affected_findings?: Array<{ claim_id?: string }>;
  answerability_changes?: {
    policy?: {
      mode?: string;
      parent_mutation?: boolean;
      requires_review_for_status_change?: boolean;
    };
    request_updates?: Array<{
      request_id?: string;
      added_claim_ids?: string[];
      added_evidence_ids?: string[];
      affected_findings?: string[];
    }>;
    finding_updates?: Array<{
      claim_id?: string;
      supporting_response_claim_ids?: string[];
      supporting_response_evidence_ids?: string[];
    }>;
  };
  review_tasks?: VersioningReviewTaskRecord[];
}

interface VersioningReviewTaskRecord {
  task_id?: string;
  target_type?: string;
  target_id?: string;
  related_ids?: string[];
}

interface VersioningReviewPatchRecord {
  patch_id?: string;
  target_claim_id?: string;
  supporting_response_claim_ids?: string[];
  supporting_response_evidence_ids?: string[];
  base_package_mutation?: boolean;
}

interface VersioningReviewHistoryRecord {
  review_id?: string;
  question_id?: string;
  primary_claim_id?: string;
  primary_evidence_id?: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  base_package_mutation?: boolean;
}

interface ManifestExtensionRecord {
  namespace?: string;
  version?: string;
  required?: boolean;
  domain_id?: string;
  title?: string;
}

interface ManifestLike {
  package_id?: string;
  optional_capabilities?: string[];
  extensions?: ManifestExtensionRecord[];
}

const REQUIRED_CORE_FILES = [
  "manifest.json",
  "data/catalog.json",
  "semantic/metrics.json",
  "views/homepage.json",
  "findings/claims.jsonl",
  "evidence/evidence.jsonl",
  "qa/prepared_questions.jsonl",
  "lineage/sources.json"
];

const REQUIRED_CORE_CAPABILITIES = [
  "core.read",
  "data.catalog",
  "semantic.metrics",
  "views.basic",
  "findings.claims",
  "evidence.basic",
  "qa.prepared",
  "lineage.sources"
];

const JSON_SCHEMA_FILES: Array<{ packagePath: string; schemaFile: string }> = [
  { packagePath: "manifest.json", schemaFile: "manifest.schema.json" },
  { packagePath: "data/catalog.json", schemaFile: "data-catalog.schema.json" },
  { packagePath: "semantic/metrics.json", schemaFile: "semantic.schema.json" },
  { packagePath: "semantic/entities.json", schemaFile: "semantic-entities.schema.json" },
  { packagePath: "views/homepage.json", schemaFile: "views.schema.json" },
  { packagePath: "tools/registry.json", schemaFile: "tools.schema.json" },
  { packagePath: "lineage/sources.json", schemaFile: "lineage.schema.json" },
  { packagePath: "overlay/metadata.json", schemaFile: "overlay-metadata.schema.json" },
  { packagePath: "versioning/parents.json", schemaFile: "versioning.schema.json" },
  { packagePath: "versioning/diff_summary.json", schemaFile: "versioning-diff-summary.schema.json" }
];

const JSONL_SCHEMA_FILES: Array<{ packagePath: string; schemaFile: string }> = [
  { packagePath: "findings/claims.jsonl", schemaFile: "findings.schema.json" },
  { packagePath: "evidence/evidence.jsonl", schemaFile: "evidence.schema.json" },
  { packagePath: "qa/prepared_questions.jsonl", schemaFile: "qa.schema.json" },
  { packagePath: "answerability/data_requests.jsonl", schemaFile: "answerability.schema.json" },
  { packagePath: "overlay/notes.jsonl", schemaFile: "overlay-note.schema.json" },
  { packagePath: "overlay/qa.jsonl", schemaFile: "overlay-qa.schema.json" },
  { packagePath: "versioning/review_history.jsonl", schemaFile: "versioning-review-history.schema.json" },
  { packagePath: "versioning/review_patches.jsonl", schemaFile: "versioning-review-patch.schema.json" }
];

const STANDALONE_SCHEMA_FILES = ["domain-pack.schema.json", "overlay.schema.json"];

const REQUIRED_SCHEMA_FILES = [
  ...new Set([
    ...JSON_SCHEMA_FILES.map((entry) => entry.schemaFile),
    ...JSONL_SCHEMA_FILES.map((entry) => entry.schemaFile),
    ...STANDALONE_SCHEMA_FILES
  ])
].sort((left, right) => left.localeCompare(right));

export async function inspectSchemaRoot(schemaRoot: string): Promise<SchemaInspectionResult> {
  const resolvedSchemaRoot = path.resolve(schemaRoot);
  const issues: ValidationIssue[] = [];
  const files: SchemaInspectionFileResult[] = [];

  if (!(await pathExists(resolvedSchemaRoot))) {
    pushIssue(issues, {
      code: "SCHEMA_ROOT_NOT_FOUND",
      severity: "warning",
      path: "spec/schemas",
      message: "未找到 JSON Schema 根目录，无法执行 schema 自检。"
    });

    return {
      schema_version: "open-insight.schema-check.v0.1",
      status: "invalid",
      schema_root: resolvedSchemaRoot,
      files,
      issues
    };
  }

  for (const schemaFile of REQUIRED_SCHEMA_FILES) {
    const schemaPath = path.join(resolvedSchemaRoot, schemaFile);

    if (!(await pathExists(schemaPath))) {
      files.push({ schema_file: schemaFile, status: "missing" });
      pushIssue(issues, {
        code: "SCHEMA_FILE_MISSING",
        severity: "warning",
        path: `spec/schemas/${schemaFile}`,
        message: `未找到 Schema 文件：${schemaFile}`
      });
      continue;
    }

    try {
      await readJsonFile<unknown>(schemaPath);
      files.push({ schema_file: schemaFile, status: "ok" });
    } catch (error) {
      files.push({ schema_file: schemaFile, status: "parse_error" });
      pushIssue(issues, {
        code: "SCHEMA_PARSE_ERROR",
        severity: "error",
        path: `spec/schemas/${schemaFile}`,
        message: error instanceof Error ? `${schemaFile} 解析失败：${error.message}` : `无法解析 schema ${schemaFile}。`
      });
    }
  }

  return {
    schema_version: "open-insight.schema-check.v0.1",
    status: issues.length === 0 ? "ok" : "invalid",
    schema_root: resolvedSchemaRoot,
    files,
    issues
  };
}

export async function validateInsightPackage(root: string, options: ValidationOptions = {}): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const paths = getInsightPackagePaths(root);

  if (!(await pathExists(paths.manifest))) {
    pushIssue(issues, {
      code: "MISSING_MANIFEST",
      severity: "error",
      path: "manifest.json",
      message: "缺少必需的 manifest.json。"
    });

    return resultFromIssues(issues);
  }

  try {
    const manifest = await readManifest(root);

    if (manifest.package_type !== "insight") {
      pushIssue(issues, {
        code: "INVALID_MANIFEST_TYPE",
        severity: "error",
        path: "manifest.json/package_type",
        message: "manifest.package_type 必须是 'insight'。"
      });
    }

    if (!manifest.spec_version) {
      pushIssue(issues, {
        code: "MISSING_MANIFEST_SPEC_VERSION",
        severity: "error",
        path: "manifest.json/spec_version",
        message: "manifest.spec_version 为必填字段。"
      });
    }

    validateRequiredCoreCapabilities(manifest.required_capabilities ?? [], issues);

    validateExtensions(manifest as ManifestLike, issues);
  } catch (error) {
    pushIssue(issues, {
      code: "MANIFEST_PARSE_ERROR",
      severity: "error",
      path: "manifest.json",
      message: error instanceof Error ? `manifest.json 解析失败：${error.message}` : "无法解析 manifest.json。"
    });
  }

  for (const requiredFile of REQUIRED_CORE_FILES) {
    if (!(await pathExists(path.join(paths.root, requiredFile)))) {
      pushIssue(issues, {
        code: "MISSING_CORE_FILE",
        severity: requiredFile === "manifest.json" ? "error" : "warning",
        path: requiredFile,
        message: `缺少 v0.1 核心文件：${requiredFile}`
      });
    }
  }

  await validateSchemas(paths.root, options.schemaRoot, issues);
  await validateReferences(paths.root, issues);

  return resultFromIssues(issues);
}

async function validateSchemas(root: string, schemaRoot: string | undefined, issues: ValidationIssue[]): Promise<void> {
  const resolvedSchemaRoot = schemaRoot ?? findDefaultSchemaRoot(root);

  if (!resolvedSchemaRoot || !(await pathExists(resolvedSchemaRoot))) {
    pushIssue(issues, {
      code: "SCHEMA_ROOT_NOT_FOUND",
      severity: "warning",
      path: "spec/schemas",
      message: "未找到 JSON Schema 根目录，已跳过 schema 校验。"
    });
    return;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  for (const { packagePath, schemaFile } of JSON_SCHEMA_FILES) {
    const packageFilePath = path.join(root, packagePath);

    if (!(await pathExists(packageFilePath))) {
      continue;
    }

    if (packagePath === "manifest.json" && hasIssue(issues, "MANIFEST_PARSE_ERROR", "manifest.json")) {
      continue;
    }

    const schema = await readSchema(resolvedSchemaRoot, schemaFile, issues);
    if (!schema) {
      continue;
    }

    try {
      const data = await readJsonFile<unknown>(packageFilePath);
      const validate = ajv.compile(schema);

      if (!validate(data)) {
        for (const error of validate.errors ?? []) {
          pushIssue(issues, {
            code: "SCHEMA_VALIDATION_ERROR",
            severity: "error",
            path: `${packagePath}${error.instancePath}`,
            message: error.message ?? "Schema 校验失败。"
          });
        }
      }
    } catch (error) {
      pushIssue(issues, {
        code: "JSON_PARSE_ERROR",
        severity: "error",
        path: packagePath,
        message: error instanceof Error ? `${packagePath} 校验失败：${error.message}` : `无法校验 ${packagePath}。`
      });
    }
  }

  for (const { packagePath, schemaFile } of JSONL_SCHEMA_FILES) {
    const packageFilePath = path.join(root, packagePath);

    if (!(await pathExists(packageFilePath))) {
      continue;
    }

    const schema = await readSchema(resolvedSchemaRoot, schemaFile, issues);
    if (!schema) {
      continue;
    }

    const validate = ajv.compile(schema);
    const records = await readOptionalJsonl<unknown>(root, packagePath, issues);

    records.forEach((record, index) => {
      if (!validate(record)) {
        for (const error of validate.errors ?? []) {
          pushIssue(issues, {
            code: "SCHEMA_VALIDATION_ERROR",
            severity: "error",
            path: `${packagePath}:${index + 1}${error.instancePath}`,
            message: error.message ?? "Schema 校验失败。"
          });
        }
      }
    });
  }
}

async function readSchema(schemaRoot: string, schemaFile: string, issues: ValidationIssue[]): Promise<unknown | undefined> {
  const schemaPath = path.join(schemaRoot, schemaFile);

  if (!(await pathExists(schemaPath))) {
    pushIssue(issues, {
      code: "SCHEMA_FILE_MISSING",
      severity: "warning",
      path: `spec/schemas/${schemaFile}`,
      message: `未找到 Schema 文件：${schemaFile}`
    });
    return undefined;
  }

  try {
    return await readJsonFile<unknown>(schemaPath);
  } catch (error) {
    pushIssue(issues, {
      code: "SCHEMA_PARSE_ERROR",
      severity: "error",
      path: `spec/schemas/${schemaFile}`,
      message: error instanceof Error ? `${schemaFile} 解析失败：${error.message}` : `无法解析 schema ${schemaFile}。`
    });
    return undefined;
  }
}

function findDefaultSchemaRoot(packageRoot: string): string | undefined {
  const candidates = [
    path.resolve(process.env["INIT_CWD"] ?? "", "spec/schemas"),
    path.resolve(process.cwd(), "spec/schemas"),
    path.resolve(packageRoot, "../../spec/schemas")
  ];

  return candidates.find((candidate) => candidate && path.isAbsolute(candidate));
}

async function validateReferences(root: string, issues: ValidationIssue[]): Promise<void> {
  const manifest = hasIssue(issues, "MANIFEST_PARSE_ERROR", "manifest.json")
    ? undefined
    : await readOptionalJson<ManifestLike>(root, "manifest.json", issues);
  const catalog = await readOptionalJson<DataCatalogFile>(root, "data/catalog.json", issues);
  const metrics = await readOptionalJson<MetricsFile>(root, "semantic/metrics.json", issues);
  const entities = await readOptionalJson<EntitiesFile>(root, "semantic/entities.json", issues);
  const homepage = await readOptionalJson<HomepageView>(root, "views/homepage.json", issues);
  const lineage = await readOptionalJson<LineageSourcesFile>(root, "lineage/sources.json", issues);
  const claims = await readOptionalJsonl<ClaimRecord>(root, "findings/claims.jsonl", issues);
  const evidence = await readOptionalJsonl<EvidenceRecord>(root, "evidence/evidence.jsonl", issues);
  const questions = await readOptionalJsonl<PreparedQuestionRecord>(root, "qa/prepared_questions.jsonl", issues);
  const dataRequests = await readOptionalJsonl<DataRequestRecord>(root, "answerability/data_requests.jsonl", issues);
  const overlayMetadata = await readOptionalJson<OverlayMetadataFile>(root, "overlay/metadata.json", issues);
  const overlayNotes = await readOptionalJsonl<OverlayNoteRecord>(root, "overlay/notes.jsonl", issues);
  const overlayQa = await readOptionalJsonl<OverlayQaRecord>(root, "overlay/qa.jsonl", issues);
  const versioningDiffSummary = await readOptionalJson<VersioningDiffSummaryFile>(root, "versioning/diff_summary.json", issues);
  const versioningReviewHistory = await readOptionalJsonl<VersioningReviewHistoryRecord>(root, "versioning/review_history.jsonl", issues);
  const versioningReviewPatches = await readOptionalJsonl<VersioningReviewPatchRecord>(root, "versioning/review_patches.jsonl", issues);

  validateUniqueIds("data/catalog.json/datasets", catalog?.datasets ?? [], "dataset_id", issues);
  validateDatasetColumnNames(catalog?.datasets ?? [], issues);
  validateUniqueIds("semantic/metrics.json/metrics", metrics?.metrics ?? [], "metric_id", issues);
  validateUniqueIds("semantic/entities.json/entities", entities?.entities ?? [], "entity_id", issues);
  validateUniqueIds("views/homepage.json/blocks", homepage?.blocks ?? [], "block_id", issues);
  validateUniqueIds("findings/claims.jsonl", claims, "claim_id", issues);
  validateUniqueIds("evidence/evidence.jsonl", evidence, "evidence_id", issues);
  validateUniqueIds("qa/prepared_questions.jsonl", questions, "question_id", issues);
  validateUniqueIds("answerability/data_requests.jsonl", dataRequests, "request_id", issues);
  validateUniqueIds("overlay/notes.jsonl", overlayNotes, "note_id", issues);
  validateUniqueIds("overlay/qa.jsonl", overlayQa, "qa_id", issues);
  validateUniqueIds("versioning/review_history.jsonl", versioningReviewHistory, "review_id", issues);
  validateUniqueIds("versioning/review_patches.jsonl", versioningReviewPatches, "patch_id", issues);

  const metricIds = new Set((metrics?.metrics ?? []).map((metric) => metric.metric_id));
  const datasetIds = new Set((catalog?.datasets ?? []).map((dataset) => dataset.dataset_id));
  const datasetColumnNamesById = new Map(
    (catalog?.datasets ?? []).map((dataset) => [
      dataset.dataset_id,
      new Set((dataset.columns ?? []).map((column) => column.name).filter((columnName): columnName is string => columnName !== undefined))
    ])
  );
  const datasetPathById = new Map(
    (catalog?.datasets ?? [])
      .map((dataset) => [dataset.dataset_id, normalizePackagePath(dataset.path)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
  );
  const claimIds = new Set(claims.map((claim) => claim.claim_id));
  const evidenceIds = new Set(evidence.map((record) => record.evidence_id));
  const questionIds = new Set(questions.map((question) => question.question_id));
  const dataRequestIds = hasJsonlReadFailure(issues, "answerability/data_requests.jsonl")
    ? undefined
    : new Set(dataRequests.map((request) => request.request_id));
  const viewBlockIds = new Set((homepage?.blocks ?? []).map((block) => block.block_id));
  const evidenceById = new Map(evidence.map((record) => [record.evidence_id, record]));
  const lineageSourceIds = new Set((lineage?.sources ?? []).map((source) => source.source_id));
  const lineageSourcePaths = new Set(
    (lineage?.sources ?? []).map((source) => normalizePackagePath(source.path)).filter((filePath): filePath is string => filePath !== undefined)
  );

  for (const metric of metrics?.metrics ?? []) {
    if (metric.dataset_id && !datasetIds.has(metric.dataset_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_DATASET",
        severity: "error",
        path: `semantic/metrics.json/metrics/${metric.metric_id}/dataset_id`,
        message: `未知 dataset_id：'${metric.dataset_id}'`
      });
    }
  }

  for (const entity of entities?.entities ?? []) {
    if (entity.dataset_id && !datasetIds.has(entity.dataset_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_DATASET",
        severity: "error",
        path: `semantic/entities.json/entities/${entity.entity_id}/dataset_id`,
        message: `未知 dataset_id：'${entity.dataset_id}'`
      });
    }

    if (entity.dataset_id && entity.primary_key && datasetIds.has(entity.dataset_id)) {
      const columnNames = datasetColumnNamesById.get(entity.dataset_id) ?? new Set<string>();

      if (!columnNames.has(entity.primary_key)) {
        pushIssue(issues, {
          code: "UNKNOWN_COLUMN",
          severity: "error",
          path: `semantic/entities.json/entities/${entity.entity_id}/primary_key`,
          message: `dataset_id '${entity.dataset_id}' 中不存在 primary_key 字段：'${entity.primary_key}'`
        });
      }
    }
  }

  validateLineageCoverage(catalog?.datasets ?? [], evidence, lineageSourcePaths, lineage !== undefined, issues);

  for (const block of homepage?.blocks ?? []) {
    if (!block.metric_id && !block.claim_id) {
      pushIssue(issues, {
        code: "UNTRACEABLE_VIEW_BLOCK_CONTEXT",
        severity: "warning",
        path: `views/homepage.json/blocks/${block.block_id}`,
        message: `首页展示块 '${block.block_id}' 应至少引用一个 metric_id 或 claim_id。`
      });
    }

    if ((block.evidence_ids ?? []).length === 0) {
      pushIssue(issues, {
        code: "UNTRACEABLE_VIEW_BLOCK_EVIDENCE",
        severity: "warning",
        path: `views/homepage.json/blocks/${block.block_id}/evidence_ids`,
        message: `首页展示块 '${block.block_id}' 应至少引用一个 evidence_id。`
      });
    }

    if (block.metric_id && !metricIds.has(block.metric_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_METRIC",
        severity: "error",
        path: `views/homepage.json/blocks/${block.block_id}/metric_id`,
        message: `未知 metric_id：'${block.metric_id}'`
      });
    }

    if (block.claim_id && !claimIds.has(block.claim_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_CLAIM",
        severity: "error",
        path: `views/homepage.json/blocks/${block.block_id}/claim_id`,
        message: `未知 claim_id：'${block.claim_id}'`
      });
    }

    for (const evidenceId of block.evidence_ids ?? []) {
      const evidenceRecord = evidenceById.get(evidenceId);

      if (!evidenceIds.has(evidenceId)) {
        pushIssue(issues, {
          code: "UNKNOWN_EVIDENCE",
          severity: "error",
          path: `views/homepage.json/blocks/${block.block_id}/evidence_ids`,
          message: `未知 evidence_id：'${evidenceId}'`
        });
      } else if (!Array.isArray(evidenceRecord?.source_refs) || evidenceRecord.source_refs.length === 0) {
        pushIssue(issues, {
          code: "UNTRACEABLE_VIEW_BLOCK_SOURCE",
          severity: "warning",
          path: `views/homepage.json/blocks/${block.block_id}/evidence_ids/${evidenceId}`,
          message: `首页展示块 '${block.block_id}' 使用的证据 '${evidenceId}' 应包含 source_refs。`
        });
      }
    }
  }

  for (const evidenceRecord of evidence) {
    for (const [sourceRefIndex, sourceRef] of (evidenceRecord.source_refs ?? []).entries()) {
      if (typeof sourceRef.dataset_id === "string" && !datasetIds.has(sourceRef.dataset_id)) {
        pushIssue(issues, {
          code: "UNKNOWN_DATASET",
          severity: "error",
          path: `evidence/evidence.jsonl/${evidenceRecord.evidence_id}/source_refs/${sourceRefIndex}/dataset_id`,
          message: `未知 dataset_id：'${sourceRef.dataset_id}'`
        });
        continue;
      }

      const sourceRefPath = normalizePackagePath(sourceRef.path);
      const datasetPath = sourceRef.dataset_id ? datasetPathById.get(sourceRef.dataset_id) : undefined;

      if (sourceRefPath && datasetPath && sourceRefPath !== datasetPath) {
        pushIssue(issues, {
          code: "MISMATCHED_EVIDENCE_SOURCE_PATH",
          severity: "warning",
          path: `evidence/evidence.jsonl/${evidenceRecord.evidence_id}/source_refs/${sourceRefIndex}/path`,
          message: `证据 '${evidenceRecord.evidence_id}' 的来源路径 '${sourceRef.path}' 与数据集 '${sourceRef.dataset_id}' 的路径 '${datasetPath}' 不一致。`
        });
      }
    }
  }

  for (const claim of claims) {
    const directEvidenceIds = new Set(claim.evidence_ids ?? []);

    for (const metricId of claim.metric_ids ?? []) {
      if (!metricIds.has(metricId)) {
        pushIssue(issues, {
          code: "UNKNOWN_METRIC",
          severity: "error",
          path: `findings/claims.jsonl/${claim.claim_id}/metric_ids`,
          message: `未知 metric_id：'${metricId}'`
        });
      }
    }

    for (const evidenceId of claim.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        pushIssue(issues, {
          code: "UNKNOWN_EVIDENCE",
          severity: "error",
          path: `findings/claims.jsonl/${claim.claim_id}/evidence_ids`,
          message: `未知 evidence_id：'${evidenceId}'`
        });
      }
    }

    for (const claimId of claim.supporting_response_claim_ids ?? []) {
      validateClaimReference(claimId, `findings/claims.jsonl/${claim.claim_id}/supporting_response_claim_ids`, claimIds, issues);
    }

    for (const evidenceId of claim.supporting_response_evidence_ids ?? []) {
      validateEvidenceReference(evidenceId, `findings/claims.jsonl/${claim.claim_id}/supporting_response_evidence_ids`, evidenceIds, issues);

      if (evidenceIds.has(evidenceId) && !directEvidenceIds.has(evidenceId)) {
        pushIssue(issues, {
          code: "UNLINKED_SUPPORTING_RESPONSE_EVIDENCE",
          severity: "error",
          path: `findings/claims.jsonl/${claim.claim_id}/supporting_response_evidence_ids`,
          message: `supporting_response_evidence_id '${evidenceId}' 必须同步出现在 claim.evidence_ids，保证 Reader 证据面板可追溯。`
        });
      }
    }
  }

  for (const question of questions) {
    for (const claimId of question.claim_ids ?? []) {
      if (!claimIds.has(claimId)) {
        pushIssue(issues, {
          code: "UNKNOWN_CLAIM",
          severity: "error",
          path: `qa/prepared_questions.jsonl/${question.question_id}/claim_ids`,
          message: `未知 claim_id：'${claimId}'`
        });
      }
    }

    for (const evidenceId of question.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        pushIssue(issues, {
          code: "UNKNOWN_EVIDENCE",
          severity: "error",
          path: `qa/prepared_questions.jsonl/${question.question_id}/evidence_ids`,
          message: `未知 evidence_id：'${evidenceId}'`
        });
      }
    }

    for (const requestId of question.data_request_ids ?? []) {
      validateDataRequestReference(
        requestId,
        `qa/prepared_questions.jsonl/${question.question_id}/data_request_ids`,
        dataRequestIds,
        issues
      );
    }

    for (const requestId of question.active_data_request_ids ?? []) {
      validateDataRequestReference(
        requestId,
        `qa/prepared_questions.jsonl/${question.question_id}/active_data_request_ids`,
        dataRequestIds,
        issues
      );
    }
  }

  for (const request of dataRequests) {
    for (const affectedFindingId of request.affected_findings ?? []) {
      if (!claimIds.has(affectedFindingId)) {
        pushIssue(issues, {
          code: "UNKNOWN_CLAIM",
          severity: "error",
          path: `answerability/data_requests.jsonl/${request.request_id}/affected_findings`,
          message: `未知 affected_finding claim_id：'${affectedFindingId}'`
        });
      }
    }
  }

  validateOverlayReferences(
    overlayMetadata,
    overlayNotes,
    overlayQa,
    manifest?.package_id,
    claimIds,
    evidenceIds,
    questionIds,
    dataRequestIds,
    viewBlockIds,
    issues
  );
  validateVersioningDiffSummarySafety(versioningDiffSummary, issues);
  validateVersioningDiffSummaryReferences(
    versioningDiffSummary,
    {
      datasetIds,
      metricIds,
      claimIds,
      evidenceIds,
      questionIds,
      dataRequestIds,
      viewBlockIds,
      lineageSourceIds
    },
    issues
  );
  validateVersioningReviewHistoryReferences(versioningReviewHistory, questionIds, claimIds, evidenceIds, issues);
  validateVersioningReviewPatchReferences(versioningReviewPatches, claimIds, evidenceIds, issues);
}

function validateOverlayReferences(
  metadata: OverlayMetadataFile | undefined,
  notes: OverlayNoteRecord[],
  qaRecords: OverlayQaRecord[],
  packageId: string | undefined,
  claimIds: Set<string>,
  evidenceIds: Set<string>,
  questionIds: Set<string>,
  dataRequestIds: Set<string> | undefined,
  viewBlockIds: Set<string>,
  issues: ValidationIssue[]
): void {
  const validPackageTargets = new Set(
    [packageId, metadata?.base_package_id].filter((targetId): targetId is string => typeof targetId === "string" && targetId.length > 0)
  );

  if (metadata?.base_package_mutation === true) {
    pushIssue(issues, {
      code: "UNSAFE_OVERLAY",
      severity: "error",
      path: "overlay/metadata.json/base_package_mutation",
      message: "overlay metadata 不得声明修改 base package。"
    });
  }

  notes.forEach((note, index) => {
    const pathIdentity = note.note_id ?? index;

    if (note.base_package_mutation === true) {
      pushIssue(issues, {
        code: "UNSAFE_OVERLAY",
        severity: "error",
        path: `overlay/notes.jsonl/${pathIdentity}/base_package_mutation`,
        message: `overlay note '${pathIdentity}' 不得声明修改 base package。`
      });
    }

    if (typeof note.target_id !== "string" || typeof note.target_type !== "string") {
      return;
    }

    if (note.target_type === "package" && validPackageTargets.size > 0 && !validPackageTargets.has(note.target_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_PACKAGE_TARGET",
        severity: "error",
        path: `overlay/notes.jsonl/${pathIdentity}/target_id`,
        message: `未知 package target_id：'${note.target_id}'`
      });
    }

    if (note.target_type === "claim") {
      validateClaimReference(note.target_id, `overlay/notes.jsonl/${pathIdentity}/target_id`, claimIds, issues);
    }

    if (note.target_type === "evidence") {
      validateEvidenceReference(note.target_id, `overlay/notes.jsonl/${pathIdentity}/target_id`, evidenceIds, issues);
    }

    if (note.target_type === "question" && !questionIds.has(note.target_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_QUESTION",
        severity: "error",
        path: `overlay/notes.jsonl/${pathIdentity}/target_id`,
        message: `未知 question_id：'${note.target_id}'`
      });
    }

    if (note.target_type === "view_block" && !viewBlockIds.has(note.target_id)) {
      pushIssue(issues, {
        code: "UNKNOWN_VIEW_BLOCK",
        severity: "error",
        path: `overlay/notes.jsonl/${pathIdentity}/target_id`,
        message: `未知 block_id：'${note.target_id}'`
      });
    }
  });

  qaRecords.forEach((record, index) => {
    const pathIdentity = record.qa_id ?? index;

    if (record.base_package_mutation === true) {
      pushIssue(issues, {
        code: "UNSAFE_OVERLAY",
        severity: "error",
        path: `overlay/qa.jsonl/${pathIdentity}/base_package_mutation`,
        message: `overlay 问答 '${pathIdentity}' 不得声明修改 base package。`
      });
    }

    if (record.generation_status === "ai_generated" || record.generation_status === "model_error") {
      if (record.model_enabled !== true) {
        pushIssue(issues, {
          code: "UNSAFE_OVERLAY",
          severity: "error",
          path: `overlay/qa.jsonl/${pathIdentity}/model_enabled`,
          message: `overlay 问答 '${pathIdentity}' 是模型生成内容，model_enabled 必须为 true。`
        });
      }

      if (record.review_status !== "needs_review") {
        pushIssue(issues, {
          code: "UNSAFE_OVERLAY",
          severity: "error",
          path: `overlay/qa.jsonl/${pathIdentity}/review_status`,
          message: `overlay 问答 '${pathIdentity}' 是模型生成内容，review_status 必须保持 needs_review。`
        });
      }
    }

    for (const claimId of record.claim_ids ?? []) {
      validateClaimReference(claimId, `overlay/qa.jsonl/${pathIdentity}/claim_ids`, claimIds, issues);
    }

    for (const evidenceId of record.evidence_ids ?? []) {
      validateEvidenceReference(evidenceId, `overlay/qa.jsonl/${pathIdentity}/evidence_ids`, evidenceIds, issues);
    }

    for (const requestId of record.data_request_ids ?? []) {
      validateDataRequestReference(requestId, `overlay/qa.jsonl/${pathIdentity}/data_request_ids`, dataRequestIds, issues);
    }
  });
}

function validateVersioningDiffSummarySafety(diffSummary: VersioningDiffSummaryFile | undefined, issues: ValidationIssue[]): void {
  const mergePlan = diffSummary?.merge_plan;

  if (mergePlan?.mode !== undefined && mergePlan.mode !== "explicit_non_destructive") {
    pushIssue(issues, {
      code: "UNSAFE_MERGE_POLICY",
      severity: "error",
      path: "versioning/diff_summary.json/merge_plan/mode",
      message: "versioning merge_plan.mode 必须保持 explicit_non_destructive，不能替换或污染母包。"
    });
  }

  if (mergePlan?.parent_mutation === true) {
    pushIssue(issues, {
      code: "UNSAFE_MERGE_POLICY",
      severity: "error",
      path: "versioning/diff_summary.json/merge_plan/parent_mutation",
      message: "versioning merge_plan.parent_mutation 必须为 false，不能声明会修改母包。"
    });
  }

  const answerabilityPolicy = diffSummary?.answerability_changes?.policy;

  if (answerabilityPolicy?.mode !== undefined && answerabilityPolicy.mode !== "evidence_first_no_auto_promotion") {
    pushIssue(issues, {
      code: "UNSAFE_ANSWERABILITY_POLICY",
      severity: "error",
      path: "versioning/diff_summary.json/answerability_changes/policy/mode",
      message: "answerability policy 必须保持 evidence_first_no_auto_promotion，不能自动提升结论状态。"
    });
  }

  if (answerabilityPolicy?.parent_mutation === true) {
    pushIssue(issues, {
      code: "UNSAFE_ANSWERABILITY_POLICY",
      severity: "error",
      path: "versioning/diff_summary.json/answerability_changes/policy/parent_mutation",
      message: "answerability policy.parent_mutation 必须为 false，不能声明会修改母包。"
    });
  }

  if (answerabilityPolicy?.requires_review_for_status_change === false) {
    pushIssue(issues, {
      code: "UNSAFE_ANSWERABILITY_POLICY",
      severity: "error",
      path: "versioning/diff_summary.json/answerability_changes/policy/requires_review_for_status_change",
      message: "answerability policy 必须要求状态变化进入人工或受控审阅。"
    });
  }
}

function validateVersioningDiffSummaryReferences(
  diffSummary: VersioningDiffSummaryFile | undefined,
  refs: {
    datasetIds: Set<string>;
    metricIds: Set<string>;
    claimIds: Set<string>;
    evidenceIds: Set<string>;
    questionIds: Set<string>;
    dataRequestIds: Set<string> | undefined;
    viewBlockIds: Set<string>;
    lineageSourceIds: Set<string>;
  },
  issues: ValidationIssue[]
): void {
  const affectedFindings = Array.isArray(diffSummary?.affected_findings) ? diffSummary.affected_findings : [];
  const requestUpdates = Array.isArray(diffSummary?.answerability_changes?.request_updates)
    ? diffSummary.answerability_changes.request_updates
    : [];
  const findingUpdates = Array.isArray(diffSummary?.answerability_changes?.finding_updates)
    ? diffSummary.answerability_changes.finding_updates
    : [];
  const reviewTasks = Array.isArray(diffSummary?.review_tasks) ? diffSummary.review_tasks : [];

  affectedFindings.forEach((finding, index) => {
    validateClaimReference(finding.claim_id, `versioning/diff_summary.json/affected_findings/${index}/claim_id`, refs.claimIds, issues);
  });

  requestUpdates.forEach((update, index) => {
    const pathIdentity = update.request_id ?? index;

    for (const claimId of update.added_claim_ids ?? []) {
      validateClaimReference(
        claimId,
        `versioning/diff_summary.json/answerability_changes/request_updates/${pathIdentity}/added_claim_ids`,
        refs.claimIds,
        issues
      );
    }

    for (const claimId of update.affected_findings ?? []) {
      validateClaimReference(
        claimId,
        `versioning/diff_summary.json/answerability_changes/request_updates/${pathIdentity}/affected_findings`,
        refs.claimIds,
        issues
      );
    }

    for (const evidenceId of update.added_evidence_ids ?? []) {
      validateEvidenceReference(
        evidenceId,
        `versioning/diff_summary.json/answerability_changes/request_updates/${pathIdentity}/added_evidence_ids`,
        refs.evidenceIds,
        issues
      );
    }
  });

  findingUpdates.forEach((update, index) => {
    const pathIdentity = update.claim_id ?? index;
    validateClaimReference(
      update.claim_id,
      `versioning/diff_summary.json/answerability_changes/finding_updates/${index}/claim_id`,
      refs.claimIds,
      issues
    );

    for (const claimId of update.supporting_response_claim_ids ?? []) {
      validateClaimReference(
        claimId,
        `versioning/diff_summary.json/answerability_changes/finding_updates/${pathIdentity}/supporting_response_claim_ids`,
        refs.claimIds,
        issues
      );
    }

    for (const evidenceId of update.supporting_response_evidence_ids ?? []) {
      validateEvidenceReference(
        evidenceId,
        `versioning/diff_summary.json/answerability_changes/finding_updates/${pathIdentity}/supporting_response_evidence_ids`,
        refs.evidenceIds,
        issues
      );
    }
  });

  reviewTasks.forEach((task, index) => {
    const pathIdentity = task.task_id ?? index;
    const targetPath = `versioning/diff_summary.json/review_tasks/${pathIdentity}/target_id`;

    if (task.target_type === "dataset") {
      validateDatasetReference(task.target_id, targetPath, refs.datasetIds, issues);
    } else if (task.target_type === "claim") {
      validateClaimReference(task.target_id, targetPath, refs.claimIds, issues);
    } else if (task.target_type === "evidence") {
      validateEvidenceReference(task.target_id, targetPath, refs.evidenceIds, issues);
    }

    for (const relatedId of task.related_ids ?? []) {
      validatePackageTargetReference(
        relatedId,
        `versioning/diff_summary.json/review_tasks/${pathIdentity}/related_ids`,
        refs,
        issues
      );
    }
  });
}

function validateDatasetReference(value: string | undefined, issuePath: string, datasetIds: Set<string>, issues: ValidationIssue[]): void {
  if (typeof value === "string" && !datasetIds.has(value)) {
    pushIssue(issues, {
      code: "UNKNOWN_DATASET",
      severity: "error",
      path: issuePath,
      message: `未知 dataset_id：'${value}'`
    });
  }
}

function validateClaimReference(value: string | undefined, issuePath: string, claimIds: Set<string>, issues: ValidationIssue[]): void {
  if (typeof value === "string" && !claimIds.has(value)) {
    pushIssue(issues, {
      code: "UNKNOWN_CLAIM",
      severity: "error",
      path: issuePath,
      message: `未知 claim_id：'${value}'`
    });
  }
}

function validateEvidenceReference(value: string | undefined, issuePath: string, evidenceIds: Set<string>, issues: ValidationIssue[]): void {
  if (typeof value === "string" && !evidenceIds.has(value)) {
    pushIssue(issues, {
      code: "UNKNOWN_EVIDENCE",
      severity: "error",
      path: issuePath,
      message: `未知 evidence_id：'${value}'`
    });
  }
}

function validatePackageTargetReference(
  value: string | undefined,
  issuePath: string,
  refs: {
    datasetIds: Set<string>;
    metricIds: Set<string>;
    claimIds: Set<string>;
    evidenceIds: Set<string>;
    questionIds: Set<string>;
    dataRequestIds: Set<string> | undefined;
    viewBlockIds: Set<string>;
    lineageSourceIds: Set<string>;
  },
  issues: ValidationIssue[]
): void {
  if (typeof value !== "string") {
    return;
  }

  const known =
    refs.datasetIds.has(value) ||
    refs.metricIds.has(value) ||
    refs.claimIds.has(value) ||
    refs.evidenceIds.has(value) ||
    refs.questionIds.has(value) ||
    refs.dataRequestIds?.has(value) === true ||
    refs.viewBlockIds.has(value) ||
    refs.lineageSourceIds.has(value);

  if (!known) {
    pushIssue(issues, {
      code: "UNKNOWN_PACKAGE_TARGET",
      severity: "error",
      path: issuePath,
      message: `未知 review task 关联对象：'${value}'`
    });
  }
}

function validateDataRequestReference(
  value: string | undefined,
  issuePath: string,
  dataRequestIds: Set<string> | undefined,
  issues: ValidationIssue[]
): void {
  if (typeof value === "string" && dataRequestIds && !dataRequestIds.has(value)) {
    pushIssue(issues, {
      code: "UNKNOWN_DATA_REQUEST",
      severity: "error",
      path: issuePath,
      message: `未知 request_id：'${value}'`
    });
  }
}

function validateQuestionReference(value: string | undefined, issuePath: string, questionIds: Set<string>, issues: ValidationIssue[]): void {
  if (typeof value === "string" && !questionIds.has(value)) {
    pushIssue(issues, {
      code: "UNKNOWN_QUESTION",
      severity: "error",
      path: issuePath,
      message: `未知 question_id：'${value}'`
    });
  }
}

function validateVersioningReviewHistoryReferences(
  records: VersioningReviewHistoryRecord[],
  questionIds: Set<string>,
  claimIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[]
): void {
  records.forEach((record, index) => {
    const pathIdentity = record.review_id ?? index;

    if (record.base_package_mutation === true) {
      pushIssue(issues, {
        code: "UNSAFE_REVIEW_HISTORY",
        severity: "error",
        path: `versioning/review_history.jsonl/${pathIdentity}/base_package_mutation`,
        message: `review history '${pathIdentity}' 不得声明修改 base package。`
      });
    }

    validateQuestionReference(record.question_id, `versioning/review_history.jsonl/${pathIdentity}/question_id`, questionIds, issues);
    validateClaimReference(record.primary_claim_id, `versioning/review_history.jsonl/${pathIdentity}/primary_claim_id`, claimIds, issues);
    validateEvidenceReference(record.primary_evidence_id, `versioning/review_history.jsonl/${pathIdentity}/primary_evidence_id`, evidenceIds, issues);

    for (const claimId of record.claim_ids ?? []) {
      validateClaimReference(claimId, `versioning/review_history.jsonl/${pathIdentity}/claim_ids`, claimIds, issues);
    }

    for (const evidenceId of record.evidence_ids ?? []) {
      validateEvidenceReference(evidenceId, `versioning/review_history.jsonl/${pathIdentity}/evidence_ids`, evidenceIds, issues);
    }
  });
}

function validateVersioningReviewPatchReferences(
  patches: VersioningReviewPatchRecord[],
  claimIds: Set<string>,
  evidenceIds: Set<string>,
  issues: ValidationIssue[]
): void {
  patches.forEach((patch, index) => {
    const pathIdentity = patch.patch_id ?? index;

    if (patch.base_package_mutation === true) {
      pushIssue(issues, {
        code: "UNSAFE_REVIEW_PATCH",
        severity: "error",
        path: `versioning/review_patches.jsonl/${pathIdentity}/base_package_mutation`,
        message: `review patch '${pathIdentity}' 不得声明修改 base package。`
      });
    }

    validateClaimReference(patch.target_claim_id, `versioning/review_patches.jsonl/${pathIdentity}/target_claim_id`, claimIds, issues);

    for (const claimId of patch.supporting_response_claim_ids ?? []) {
      validateClaimReference(claimId, `versioning/review_patches.jsonl/${pathIdentity}/supporting_response_claim_ids`, claimIds, issues);
    }

    for (const evidenceId of patch.supporting_response_evidence_ids ?? []) {
      validateEvidenceReference(
        evidenceId,
        `versioning/review_patches.jsonl/${pathIdentity}/supporting_response_evidence_ids`,
        evidenceIds,
        issues
      );
    }
  });
}

function validateLineageCoverage(
  datasets: DatasetRecord[],
  evidence: EvidenceRecord[],
  lineageSourcePaths: Set<string>,
  hasLineageFile: boolean,
  issues: ValidationIssue[]
): void {
  if (!hasLineageFile) {
    return;
  }

  for (const dataset of datasets) {
    const datasetPath = normalizePackagePath(dataset.path);

    if (datasetPath && !lineageSourcePaths.has(datasetPath)) {
      pushIssue(issues, {
        code: "UNTRACEABLE_DATASET_LINEAGE",
        severity: "warning",
        path: `data/catalog.json/datasets/${dataset.dataset_id}/path`,
        message: `数据集 '${dataset.dataset_id}' 的路径 '${dataset.path}' 未出现在 lineage/sources.json 中。`
      });
    }
  }

  for (const evidenceRecord of evidence) {
    for (const [sourceRefIndex, sourceRef] of (evidenceRecord.source_refs ?? []).entries()) {
      const sourceRefPath = normalizePackagePath(sourceRef.path);

      if (sourceRefPath && !lineageSourcePaths.has(sourceRefPath)) {
        pushIssue(issues, {
          code: "UNTRACEABLE_EVIDENCE_LINEAGE",
          severity: "warning",
          path: `evidence/evidence.jsonl/${evidenceRecord.evidence_id}/source_refs/${sourceRefIndex}/path`,
          message: `证据 '${evidenceRecord.evidence_id}' 的来源路径 '${sourceRef.path}' 未出现在 lineage/sources.json 中。`
        });
      }
    }
  }
}

function validateDatasetColumnNames(datasets: DatasetRecord[], issues: ValidationIssue[]): void {
  for (const dataset of datasets) {
    const seen = new Map<string, number>();

    dataset.columns?.forEach((column, index) => {
      if (typeof column.name !== "string" || column.name.length === 0) {
        return;
      }

      const firstIndex = seen.get(column.name);
      if (firstIndex !== undefined) {
        pushIssue(issues, {
          code: "DUPLICATE_COLUMN",
          severity: "error",
          path: `data/catalog.json/datasets/${dataset.dataset_id}/columns/${index}/name`,
          message: `数据集 '${dataset.dataset_id}' 中的字段名 '${column.name}' 重复，首次出现在索引 ${firstIndex}。`
        });
        return;
      }

      seen.set(column.name, index);
    });
  }
}

function normalizePackagePath(filePath: string | undefined): string | undefined {
  const normalized = filePath?.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim();

  return normalized ? normalized : undefined;
}

function hasIssue(issues: ValidationIssue[], code: ValidationIssueCode, issuePath?: string): boolean {
  return issues.some((issue) => issue.code === code && (issuePath === undefined || issue.path === issuePath));
}

function hasIssuePathPrefix(issues: ValidationIssue[], code: ValidationIssueCode, pathPrefix: string): boolean {
  return issues.some((issue) => issue.code === code && issue.path.startsWith(pathPrefix));
}

function hasJsonlReadFailure(issues: ValidationIssue[], relativePath: string): boolean {
  return hasIssuePathPrefix(issues, "JSONL_PARSE_ERROR", `${relativePath}:`) || hasIssue(issues, "FILE_READ_ERROR", relativePath);
}

async function readOptionalJson<T>(root: string, relativePath: string, issues: ValidationIssue[]): Promise<T | undefined> {
  const filePath = path.join(root, relativePath);

  if (!(await pathExists(filePath))) {
    return undefined;
  }

  if (hasIssue(issues, "JSON_PARSE_ERROR", relativePath)) {
    return undefined;
  }

  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    pushIssue(issues, {
      code: "JSON_PARSE_ERROR",
      severity: "error",
      path: relativePath,
      message: error instanceof Error ? `${relativePath} 解析失败：${error.message}` : `无法解析 ${relativePath}。`
    });
    return undefined;
  }
}

async function readOptionalJsonl<T>(root: string, relativePath: string, issues: ValidationIssue[]): Promise<T[]> {
  const filePath = path.join(root, relativePath);

  if (!(await pathExists(filePath))) {
    return [];
  }

  if (hasJsonlReadFailure(issues, relativePath)) {
    return [];
  }

  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as T;
        } catch (error) {
          pushIssue(issues, {
            code: "JSONL_PARSE_ERROR",
            severity: "error",
            path: `${relativePath}:${index + 1}`,
            message: error instanceof Error ? `${relativePath} 第 ${index + 1} 行解析失败：${error.message}` : `无法解析 JSONL 第 ${index + 1} 行。`
          });
          return undefined;
        }
      })
      .filter((record): record is T => record !== undefined);
  } catch (error) {
    pushIssue(issues, {
      code: "FILE_READ_ERROR",
      severity: "error",
      path: relativePath,
      message: error instanceof Error ? `${relativePath} 读取失败：${error.message}` : `无法读取 ${relativePath}。`
    });
    return [];
  }
}

function validateExtensions(manifest: ManifestLike, issues: ValidationIssue[]): void {
  const extensions = manifest.extensions ?? [];
  const domainPackExtensions: ManifestExtensionRecord[] = [];
  const hasDomainPackCapability = manifest.optional_capabilities?.includes("domain.pack") ?? false;

  extensions.forEach((extension, index) => {
    const namespace = extension.namespace;

    if (typeof namespace !== "string" || !isSafeExtensionNamespace(namespace)) {
      pushIssue(issues, {
        code: "UNSAFE_EXTENSION_NAMESPACE",
        severity: "error",
        path: `manifest.json/extensions/${index}/namespace`,
        message: `不安全的 extension namespace：'${namespace ?? ""}'`
      });
    }

    if (!isDomainPackExtension(extension)) {
      return;
    }

    domainPackExtensions.push(extension);

    if (extension.required === true) {
      pushIssue(issues, {
        code: "UNSAFE_DOMAIN_PACK_EXTENSION",
        severity: "error",
        path: `manifest.json/extensions/${index}/required`,
        message: `Domain Pack 扩展 '${namespace ?? extension.domain_id ?? index}' 在 v0.1 必须是可选扩展。`
      });
    }

    if (!isValidDomainPackId(extension.domain_id)) {
      pushIssue(issues, {
        code: "INVALID_DOMAIN_PACK_EXTENSION",
        severity: "warning",
        path: `manifest.json/extensions/${index}/domain_id`,
        message: `Domain Pack 扩展 '${namespace ?? index}' 应声明稳定的 domain_id。`
      });
    } else if (typeof namespace === "string" && !namespace.endsWith(`.${extension.domain_id}`)) {
      pushIssue(issues, {
        code: "INVALID_DOMAIN_PACK_EXTENSION",
        severity: "warning",
        path: `manifest.json/extensions/${index}/domain_id`,
        message: `Domain Pack domain_id '${extension.domain_id}' 应匹配 namespace '${namespace}'。`
      });
    }
  });

  if (hasDomainPackCapability && domainPackExtensions.length === 0) {
    pushIssue(issues, {
      code: "MISSING_DOMAIN_PACK_EXTENSION",
      severity: "warning",
      path: "manifest.json/extensions",
      message: "optional_capabilities 声明了 domain.pack，但 manifest.extensions 未标识行业包。"
    });
  }

  if (!hasDomainPackCapability && domainPackExtensions.length > 0) {
    pushIssue(issues, {
      code: "MISSING_DOMAIN_PACK_CAPABILITY",
      severity: "warning",
      path: "manifest.json/optional_capabilities",
      message: "manifest.extensions 标识了行业包，但 optional_capabilities 未包含 domain.pack。"
    });
  }
}

function validateRequiredCoreCapabilities(requiredCapabilities: string[], issues: ValidationIssue[]): void {
  const declaredCapabilities = new Set(requiredCapabilities);

  REQUIRED_CORE_CAPABILITIES.forEach((capability) => {
    if (!declaredCapabilities.has(capability)) {
      pushIssue(issues, {
        code: "MISSING_CORE_CAPABILITY",
        severity: "warning",
        path: "manifest.json/required_capabilities",
        message: `required_capabilities 应包含 ${capability}。`
      });
    }
  });
}

function isSafeExtensionNamespace(namespace: string): boolean {
  if (namespace.includes("/") || namespace.includes("\\") || namespace.includes("..")) {
    return false;
  }

  return /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*)+$/i.test(namespace);
}

function isDomainPackExtension(extension: ManifestExtensionRecord): boolean {
  return extension.namespace?.startsWith("org.openinsight.domain.") === true || typeof extension.domain_id === "string";
}

function isValidDomainPackId(domainId: string | undefined): domainId is string {
  return typeof domainId === "string" && /^[a-z][a-z0-9_]*$/.test(domainId);
}

function validateUniqueIds<T extends object>(
  collectionPath: string,
  records: T[],
  idKey: keyof T & string,
  issues: ValidationIssue[]
): void {
  const seen = new Map<string, number>();

  records.forEach((record, index) => {
    const value = (record as Record<string, unknown>)[idKey];

    if (typeof value !== "string" || value.length === 0) {
      return;
    }

    const firstIndex = seen.get(value);
    if (firstIndex !== undefined) {
      pushIssue(issues, {
        code: "DUPLICATE_ID",
        severity: "error",
        path: `${collectionPath}/${index}/${idKey}`,
        message: `${idKey} '${value}' 重复，首次出现在索引 ${firstIndex}。`
      });
      return;
    }

    seen.set(value, index);
  });
}

function pushIssue(issues: ValidationIssue[], issue: ValidationIssue): void {
  issues.push(issue);
}

function resultFromIssues(issues: ValidationIssue[]): ValidationResult {
  if (issues.some((issue) => issue.severity === "error")) {
    return { schema_version: "open-insight.validation-result.v0.1", status: "invalid", issues };
  }

  if (issues.length > 0) {
    return { schema_version: "open-insight.validation-result.v0.1", status: "valid_with_warnings", issues };
  }

  return { schema_version: "open-insight.validation-result.v0.1", status: "valid", issues };
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSIGHT_SPEC_VERSION, pathExists, readJsonFile, readJsonlFile, readManifest } from "@open-insight/core";
import { analyzeSourceBytes } from "@open-insight/compiler";

const CORE_CAPABILITIES = [
  "core.read",
  "data.catalog",
  "semantic.metrics",
  "views.basic",
  "findings.claims",
  "evidence.basic",
  "qa.prepared",
  "lineage.sources"
];

export interface CreateDataResponsePackageOptions {
  requestPackageRoot: string;
  outputDir: string;
  createdAt?: string;
  responseId?: string;
  supplementPaths?: string[];
}

export interface ResponseSupplementFileSummary {
  original_name: string;
  path: string;
  dataset_id: string;
  source_id: string;
  format: string;
  size_bytes: number;
  column_count: number;
  row_count?: number | undefined;
  quality_warnings?: ResponseSupplementQualityWarning[] | undefined;
}

export interface ResponseSupplementQualityWarning {
  code: string;
  message: string;
  requested_fields?: string[] | undefined;
}

export interface CreateDataResponsePackageResult {
  status: "created";
  output_dir: string;
  parent_package_id: string;
  request_package_id: string;
  request_id: string;
  response_id: string;
  file_count: number;
  copied_context: {
    claims: number;
    evidence: number;
    prepared_questions: number;
    datasets: number;
    metrics: number;
    lineage_sources: number;
  };
  response_additions: {
    claims: number;
    evidence: number;
    prepared_questions: number;
    datasets: number;
    lineage_sources: number;
  };
  supplement_files: ResponseSupplementFileSummary[];
}

interface DataRequest {
  request_id: string;
  question: string;
  status: string;
  missing_fields: string[];
  required_grain?: string;
  required_time_range?: string;
  why_needed: string;
  priority?: string;
  affected_findings?: string[];
}

interface Dataset {
  dataset_id: string;
  path: string;
  format: string;
  columns: Array<{ name: string; type: string; description?: string }>;
  [key: string]: unknown;
}

interface DataCatalog {
  datasets: Dataset[];
}

interface Metric {
  metric_id: string;
  [key: string]: unknown;
}

interface MetricsFile {
  metrics: Metric[];
}

interface Claim {
  claim_id: string;
  status: string;
  summary: string;
  metric_ids?: string[];
  evidence_ids: string[];
  [key: string]: unknown;
}

interface Evidence {
  evidence_id: string;
  type: string;
  summary: string;
  source_refs: Array<{
    dataset_id: string;
    path?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface PreparedQuestion {
  question_id: string;
  question: string;
  answer: string;
  status: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  [key: string]: unknown;
}

interface LineageSource {
  source_id: string;
  type: string;
  description?: string;
  path?: string;
  [key: string]: unknown;
}

interface LineageSourcesFile {
  sources: LineageSource[];
}

export async function createDataResponsePackage(options: CreateDataResponsePackageOptions): Promise<CreateDataResponsePackageResult> {
  const requestPackageRoot = path.resolve(options.requestPackageRoot);
  const outputDir = path.resolve(options.outputDir);
  const manifest = await readManifest(requestPackageRoot);
  const requestContext = manifest.request_context;

  if (!requestContext) {
    throw new Error(`文件包 '${requestPackageRoot}' 缺少 manifest.request_context，无法创建 response 包。`);
  }

  const requestPath = path.join(requestPackageRoot, "answerability/data_requests.jsonl");
  if (!(await pathExists(requestPath))) {
    throw new Error(`请求包 '${requestPackageRoot}' 缺少 answerability/data_requests.jsonl。`);
  }

  const requests = await readJsonlFile<DataRequest>(requestPath);
  const request = requests.find((item) => item.request_id === requestContext.source_request_id);

  if (!request) {
    throw new Error(`在请求包 '${requestPackageRoot}' 中找不到 source request '${requestContext.source_request_id}'。`);
  }

  const catalog = await readJsonFile<DataCatalog>(path.join(requestPackageRoot, "data/catalog.json"));
  const metricsFile = await readJsonFile<MetricsFile>(path.join(requestPackageRoot, "semantic/metrics.json"));
  const claims = await readJsonlFile<Claim>(path.join(requestPackageRoot, "findings/claims.jsonl"));
  const evidence = await readJsonlFile<Evidence>(path.join(requestPackageRoot, "evidence/evidence.jsonl"));
  const preparedQuestions = await readJsonlFile<PreparedQuestion>(path.join(requestPackageRoot, "qa/prepared_questions.jsonl"));
  const lineage = await readJsonFile<LineageSourcesFile>(path.join(requestPackageRoot, "lineage/sources.json"));

  const safeRequestId = sanitizeId(request.request_id) || "request";
  const responseId = sanitizeId(options.responseId ?? `resp_${safeRequestId}`) || `resp_${safeRequestId}`;
  const createdAt = options.createdAt ?? new Date().toISOString();
  const responseDatasetId = createUniqueId(
    `response_payload_${safeRequestId}`,
    new Set(catalog.datasets.map((dataset) => dataset.dataset_id))
  );
  const responseClaimId = createUniqueId(`claim_${responseId}`, new Set(claims.map((claim) => claim.claim_id)));
  const responseEvidenceId = createUniqueId(`ev_${responseId}`, new Set(evidence.map((record) => record.evidence_id)));
  const responseQuestionId = createUniqueId(`q_${responseId}`, new Set(preparedQuestions.map((question) => question.question_id)));
  const responseSourceId = createUniqueId(`source_${responseId}`, new Set(lineage.sources.map((source) => source.source_id)));
  const responsePayloadPath = `data/${responseId}.json`;
  const affectedFindings = requestContext.affected_findings ?? [];
  const preparedSupplementAssets = await prepareSupplementAssets(options.supplementPaths ?? [], {
    createdAt,
    responseId,
    safeRequestId,
    requestMissingFields: request.missing_fields,
    reservedDatasetIds: new Set([...catalog.datasets.map((dataset) => dataset.dataset_id), responseDatasetId]),
    reservedSourceIds: new Set([...lineage.sources.map((source) => source.source_id), responseSourceId])
  });
  const submittedDataFiles = preparedSupplementAssets.map((asset) => asset.payloadRecord);
  const supplementSourceRefs = preparedSupplementAssets.map((asset) => ({ dataset_id: asset.datasetId, path: asset.path }));
  const responsePayload = {
    response_id: responseId,
    response_state: "draft",
    created_at: createdAt,
    parent_package_id: requestContext.parent_package_id,
    request_package_id: manifest.package_id,
    source_request_id: request.request_id,
    request_question: request.question,
    missing_fields: request.missing_fields,
    affected_findings: affectedFindings,
    submitted_data_files: submittedDataFiles,
    note:
      preparedSupplementAssets.length > 0
        ? "这是 response 草稿包，已附加补充材料；合并回母包前仍需要人工审阅证据和结论。"
        : "这是 response 草稿脚手架；合并回母包前需要补充数据集和证据。"
  };
  const responseDataset: Dataset = {
    dataset_id: responseDatasetId,
    path: responsePayloadPath,
    format: "json",
    description: "从 request 包生成的 response 草稿元数据。",
    columns: [
      { name: "response_id", type: "string" },
      { name: "response_state", type: "string" },
      { name: "parent_package_id", type: "string" },
      { name: "request_package_id", type: "string" },
      { name: "source_request_id", type: "string" },
      { name: "request_question", type: "string" },
      { name: "missing_field_count", type: "integer" },
      { name: "affected_finding_count", type: "integer" },
      { name: "note", type: "string" }
    ]
  };
  const responseEvidence: Evidence = {
    evidence_id: responseEvidenceId,
    type: "response_metadata",
    summary: `补数请求 ${request.request_id} 的 response 草稿元数据。`,
    source_refs: [{ dataset_id: responseDatasetId, path: responsePayloadPath }, ...supplementSourceRefs],
    values: [
      {
        response_id: responseId,
        response_state: "draft",
        source_request_id: request.request_id,
        missing_field_count: request.missing_fields.length,
        affected_finding_count: affectedFindings.length,
        submitted_data_file_count: preparedSupplementAssets.length,
        submitted_data_files: submittedDataFiles
      }
    ]
  };
  const responseClaim: Claim = {
    claim_id: responseClaimId,
    status: "needs_review",
    summary:
      preparedSupplementAssets.length > 0
        ? `补数请求 ${request.request_id} 的 response 包草稿已附加 ${preparedSupplementAssets.length} 个补充文件，尚未审阅或合并到母包。`
        : `补数请求 ${request.request_id} 的 response 包草稿，尚未合并到母包。`,
    evidence_ids: [responseEvidenceId],
    response_id: responseId,
    response_to_request_id: request.request_id
  };
  const responseQuestion: PreparedQuestion = {
    question_id: responseQuestionId,
    question: "这个 response 包包含什么？",
    answer:
      preparedSupplementAssets.length > 0
        ? `这是针对请求 ${request.request_id} 的 response 草稿包；它保留请求上下文，并附加 ${preparedSupplementAssets.length} 个补充文件，等待制作方审阅后再合并。`
        : `这是针对请求 ${request.request_id} 的 response 草稿脚手架；它保留请求上下文，并加入合并前复核所需的 response 元数据。`,
    status: "needs_review",
    claim_ids: [responseClaimId],
    evidence_ids: [responseEvidenceId]
  };
  const responseLineageSource: LineageSource = {
    source_id: responseSourceId,
    type: "json",
    description: "参考 CLI 生成的 response 草稿元数据。",
    path: responsePayloadPath
  };
  const responseContext = {
    parent_package_id: requestContext.parent_package_id,
    ...(requestContext.parent_title ? { parent_title: requestContext.parent_title } : {}),
    request_package_id: manifest.package_id,
    source_request_id: request.request_id,
    response_id: responseId,
    response_state: "draft",
    generated_from: "manifest.request_context",
    affected_findings: affectedFindings
  };
  const files: Record<string, string> = {
    "manifest.json": toJson({
      spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
      package_id: `${requestContext.parent_package_id}.response.${safeRequestId}`,
      package_type: "insight",
      title: `${manifest.title} - Response 草稿`,
      description: `从请求包 ${manifest.package_id} 生成的 response 草稿包。`,
      created_at: createdAt,
      required_capabilities: CORE_CAPABILITIES,
      optional_capabilities: ["answerability", "merge"],
      fallbacks: {
        default_view: "views/homepage.json"
      },
      response_context: responseContext
    }),
    "data/catalog.json": toJson({ datasets: [...catalog.datasets, responseDataset, ...preparedSupplementAssets.map((asset) => asset.dataset)] }),
    [responsePayloadPath]: toJson(responsePayload),
    "semantic/metrics.json": toJson({ metrics: metricsFile.metrics }),
    "views/homepage.json": toJson({
      view_id: "response_homepage",
      title: `Response 草稿：${request.question}`,
      audience: "data_provider",
      blocks: [
        {
          block_id: `response_${responseId}`,
          type: "response_summary",
          title: `请求 ${request.request_id} 的 response 草稿`,
          claim_id: responseClaimId,
          evidence_ids: [responseEvidenceId]
        }
      ]
    }),
    "findings/claims.jsonl": toJsonl([...claims, responseClaim]),
    "evidence/evidence.jsonl": toJsonl([...evidence, responseEvidence]),
    "qa/prepared_questions.jsonl": toJsonl([...preparedQuestions, responseQuestion]),
    "lineage/sources.json": toJson({ sources: [...lineage.sources, responseLineageSource, ...preparedSupplementAssets.map((asset) => asset.lineageSource)] }),
    "answerability/data_requests.jsonl": toJsonl([request])
  };

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const outputPath = path.join(outputDir, relativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content, "utf8");
    })
  );
  await Promise.all(
    preparedSupplementAssets.map(async (asset) => {
      const outputPath = path.join(outputDir, asset.path);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, asset.bytes);
    })
  );

  return {
    status: "created",
    output_dir: outputDir,
    parent_package_id: requestContext.parent_package_id,
    request_package_id: manifest.package_id,
    request_id: request.request_id,
    response_id: responseId,
    file_count: Object.keys(files).length + preparedSupplementAssets.length,
    copied_context: {
      claims: claims.length,
      evidence: evidence.length,
      prepared_questions: preparedQuestions.length,
      datasets: catalog.datasets.length,
      metrics: metricsFile.metrics.length,
      lineage_sources: lineage.sources.length
    },
    response_additions: {
      claims: 1,
      evidence: 1,
      prepared_questions: 1,
      datasets: 1 + preparedSupplementAssets.length,
      lineage_sources: 1 + preparedSupplementAssets.length
    },
    supplement_files: preparedSupplementAssets.map((asset) => asset.summary)
  };
}

interface PreparedSupplementAsset {
  bytes: Uint8Array;
  dataset: Dataset;
  datasetId: string;
  lineageSource: LineageSource;
  path: string;
  payloadRecord: Record<string, unknown>;
  summary: ResponseSupplementFileSummary;
}

async function prepareSupplementAssets(
  supplementPaths: string[],
  options: {
    createdAt: string;
    responseId: string;
    safeRequestId: string;
    requestMissingFields: string[];
    reservedDatasetIds: Set<string>;
    reservedSourceIds: Set<string>;
  }
): Promise<PreparedSupplementAsset[]> {
  const reservedPaths = new Set<string>();
  const assets: PreparedSupplementAsset[] = [];

  for (const [index, supplementPath] of supplementPaths.entries()) {
    const resolvedPath = path.resolve(supplementPath);

    if (!(await pathExists(resolvedPath))) {
      throw new Error(`补充文件不存在：${supplementPath}`);
    }

    const bytes = await readFile(resolvedPath);
    const originalName = path.basename(resolvedPath);
    const safeFileName = createUniqueFileName(sanitizeSupplementFileName(originalName, index), reservedPaths);
    const packagePath = `data/supplements/${options.responseId}/${safeFileName}`;
    const sourceProfile = analyzeSourceBytes({
      name: originalName,
      bytes,
      size_bytes: bytes.byteLength
    });
    const fileId = sanitizeId(stripFileExtension(safeFileName)) || `file_${index + 1}`;
    const datasetId = createUniqueId(`supplement_${options.safeRequestId}_${fileId}`, options.reservedDatasetIds);
    const sourceId = createUniqueId(`source_${datasetId}`, options.reservedSourceIds);
    const format = sourceProfile.type ?? inferFormatFromFileName(originalName);
    const columns = (sourceProfile.columns ?? []).map((column) => ({
      name: column.name,
      type: column.type ?? "unknown"
    }));
    const qualityWarnings = buildSupplementQualityWarnings({
      originalName,
      bytes,
      format,
      columns,
      rowCount: sourceProfile.row_count,
      requestMissingFields: options.requestMissingFields
    });
    const dataset: Dataset = {
      dataset_id: datasetId,
      path: packagePath,
      format,
      description: `补数方通过 CLI 提交的补充材料：${originalName}`,
      original_name: originalName,
      size_bytes: bytes.byteLength,
      submitted_at: options.createdAt,
      ...(sourceProfile.mime_type ? { mime_type: sourceProfile.mime_type } : {}),
      ...(sourceProfile.row_count !== undefined ? { row_count: sourceProfile.row_count } : {}),
      ...(sourceProfile.metadata ? { metadata: sourceProfile.metadata } : {}),
      ...(qualityWarnings.length > 0 ? { quality_warnings: qualityWarnings } : {}),
      columns
    };
    const lineageSource: LineageSource = {
      source_id: sourceId,
      type: format,
      description: `补数方通过 CLI 提交的补充材料：${originalName}`,
      path: packagePath,
      original_name: originalName,
      size_bytes: bytes.byteLength,
      submitted_at: options.createdAt
    };
    const payloadRecord = {
      dataset_id: datasetId,
      path: packagePath,
      format,
      original_name: originalName,
      size_bytes: bytes.byteLength,
      column_count: columns.length,
      ...(qualityWarnings.length > 0 ? { quality_warnings: qualityWarnings } : {}),
      ...(sourceProfile.row_count !== undefined ? { row_count: sourceProfile.row_count } : {})
    };

    assets.push({
      bytes,
      dataset,
      datasetId,
      lineageSource,
      path: packagePath,
      payloadRecord,
      summary: {
        original_name: originalName,
        path: packagePath,
        dataset_id: datasetId,
        source_id: sourceId,
        format,
        size_bytes: bytes.byteLength,
        column_count: columns.length,
        ...(qualityWarnings.length > 0 ? { quality_warnings: qualityWarnings } : {}),
        ...(sourceProfile.row_count !== undefined ? { row_count: sourceProfile.row_count } : {})
      }
    });
  }

  return assets;
}

function buildSupplementQualityWarnings(options: {
  originalName: string;
  bytes: Uint8Array;
  format: string;
  columns: Array<{ name: string; type: string }>;
  rowCount?: number | undefined;
  requestMissingFields: string[];
}): ResponseSupplementQualityWarning[] {
  const warnings: ResponseSupplementQualityWarning[] = [];
  const normalizedRequestedFields = options.requestMissingFields.map(normalizeFieldName).filter(Boolean);
  const normalizedColumnNames = new Set(options.columns.map((column) => normalizeFieldName(column.name)).filter(Boolean));
  const isTabular = isTabularSupplementFormat(options.format);

  if (options.bytes.byteLength === 0) {
    warnings.push({
      code: "SUPPLEMENT_EMPTY_FILE",
      message: `补充文件 ${options.originalName} 是空文件，无法支撑结论复核。`
    });
  }

  if (isTabular && options.columns.length === 0) {
    warnings.push({
      code: "SUPPLEMENT_NO_TABULAR_COLUMNS",
      message: `补充文件 ${options.originalName} 没有识别到表格字段。`
    });
  }

  if (isTabular && options.rowCount === 0) {
    warnings.push({
      code: "SUPPLEMENT_NO_DATA_ROWS",
      message: `补充文件 ${options.originalName} 没有有效数据行。`
    });
  }

  if (
    isTabular &&
    normalizedRequestedFields.length > 0 &&
    options.columns.length > 0 &&
    !normalizedRequestedFields.some((field) => normalizedColumnNames.has(field))
  ) {
    warnings.push({
      code: "SUPPLEMENT_NO_REQUESTED_FIELDS",
      message: `补充文件 ${options.originalName} 没有命中当前 request 的缺失字段。`,
      requested_fields: options.requestMissingFields
    });
  }

  return warnings;
}

function isTabularSupplementFormat(format: string): boolean {
  return ["csv", "tsv", "xlsx"].includes(format.toLowerCase());
}

function normalizeFieldName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toJsonl(values: unknown[]): string {
  if (values.length === 0) {
    return "";
  }

  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function sanitizeSupplementFileName(fileName: string, index: number): string {
  const originalName = fileName.split(/[\\/]/).pop()?.trim() ?? "";
  const extension = inferFormatFromFileName(originalName);
  const baseName = stripFileExtension(originalName)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeBaseName = baseName || `supplement_${index + 1}`;

  return extension === "unknown" ? safeBaseName : `${safeBaseName}.${extension}`;
}

function createUniqueFileName(fileName: string, reservedPaths: Set<string>): string {
  const extension = inferFormatFromFileName(fileName);
  const baseName = extension === "unknown" ? fileName : stripFileExtension(fileName);
  let candidate = fileName;
  let suffix = 2;

  while (reservedPaths.has(candidate)) {
    candidate = extension === "unknown" ? `${baseName}_${suffix}` : `${baseName}_${suffix}.${extension}`;
    suffix += 1;
  }

  reservedPaths.add(candidate);
  return candidate;
}

function stripFileExtension(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop()?.trim() ?? "";
  const index = cleanName.lastIndexOf(".");

  return index > 0 ? cleanName.slice(0, index) : cleanName;
}

function inferFormatFromFileName(fileName: string): string {
  const cleanName = fileName.split(/[\\/]/).pop()?.trim().toLowerCase() ?? "";
  const extension = cleanName.includes(".") ? cleanName.split(".").pop() : undefined;

  if (!extension || extension === cleanName) {
    return "unknown";
  }

  return extension === "xls" ? "xlsx" : extension.replace(/[^a-z0-9]+/g, "") || "unknown";
}

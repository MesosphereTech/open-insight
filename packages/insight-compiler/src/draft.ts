import {
  buildTemplateFromDomainPack,
  getDomainPack,
  type DomainPack,
  type DomainPackId,
  type DomainPackMetricAggregation,
  type DomainPackMetricBlueprint,
  type DomainPackMetricFieldRole,
  type DomainPackMetricFieldRoleMapping,
  type DomainPackViewRule
} from "@open-insight/domain-packs";

export type DraftSourceInput = string | DraftSource;

export interface DraftSource {
  name: string;
  path?: string;
  type?: string;
  size_bytes?: number;
  mime_type?: string;
  row_count?: number;
  columns?: DraftSourceColumn[];
  sample_rows?: DraftSourceSampleRow[];
  metadata?: Record<string, DraftSourceSampleValue>;
  normalized_source?: DraftSourceNormalizedSource;
  spreadsheet_formula_evidence?: DraftSpreadsheetFormulaEvidence;
}

export interface DraftSourceNormalizedSource {
  content: string;
  parser: string;
  parser_version?: string;
  parser_role?: string;
  cloud_used: boolean;
  confidence?: number;
  status?: string;
  message?: string;
}

export interface DraftSpreadsheetFormulaCell {
  sheet_name: string;
  cell_address: string;
  formula: string;
  formula_type: "normal" | "shared" | "array" | "data_table" | "unknown";
  formula_resolution_status?: "resolved" | "unresolved_shared";
  cached_value_available: boolean;
  cached_value?: string | number | boolean | null;
  cached_value_raw?: string;
  cached_value_type?: "string" | "number" | "boolean" | "error" | "blank" | "shared_string_index" | "unknown";
  range_ref?: string;
  shared_index?: string;
}

export interface DraftSpreadsheetFormulaEvidence {
  schema_version: "open-insight.spreadsheet-formula-extraction.v0.1";
  extractor: "open_insight_xlsx_formula_xml";
  status: "ok" | "none" | "partial" | "unsupported";
  formula_count: number;
  truncated: boolean;
  max_formulas: number;
  max_output_bytes: number;
  termination_reason?: "timeout" | "resource_limit" | "parse_error";
  message: string;
  cells: DraftSpreadsheetFormulaCell[];
}

export interface DraftSourceColumn {
  name: string;
  type?: string;
}

export type DraftSourceSampleValue = string | number | boolean | null;

export type DraftSourceSampleRow = Record<string, DraftSourceSampleValue>;

export type DraftQuestionStatus = "verified_target" | "needs_data" | "needs_review";
export type DraftQuestionOrigin = "domain_pack" | "template" | "overlay_import";
export type DraftMetricSuggestionOrigin = "domain_blueprint" | "source_profile";
export type DraftQuestionEditor = "open-insight-studio";

export interface DraftDataRequest {
  request_id: string;
  question: string;
  status: string;
  missing_fields: string[];
  required_grain?: string;
  required_time_range?: string;
  why_needed: string;
  priority?: string;
  affected_findings?: string[];
  source?: string;
  source_qa_id?: string;
  source_request_id?: string;
  source_followup_file?: string;
  base_package_mutation?: boolean;
  imported_at?: string;
  imported_by?: string;
}

export interface DraftQuestion {
  id: string;
  section: string;
  question: string;
  status: DraftQuestionStatus;
  answer?: string;
  evidence: string;
  source_name?: string;
  claim_id: string;
  evidence_id: string;
  origin: DraftQuestionOrigin;
  why_required?: string;
  evidence_expectation?: string;
  review_note?: string;
  review_state?: string;
  confirmation_scope?: string;
  edited_by?: DraftQuestionEditor;
  data_request_ids?: string[];
  active_data_request_ids?: string[];
  data_requests?: DraftDataRequest[];
  source?: string;
  source_qa_id?: string;
  source_question_id?: string;
  source_followup_file?: string;
  promotion_policy?: string;
  generation_status?: string;
  review_status?: string;
  base_package_mutation?: boolean;
  imported_at?: string;
  imported_by?: string;
}

export interface DraftMetricSuggestion {
  metric_id: string;
  name: string;
  definition: string;
  formula: string;
  dataset_id: string;
  source_column: string;
  source_columns?: string[];
  status: "suggested";
  origin: DraftMetricSuggestionOrigin;
  aggregation: DomainPackMetricAggregation;
  blueprint_id?: string;
  matched_preferred_column?: string;
  field_role?: DomainPackMetricFieldRole;
  source_field_roles?: DomainPackMetricFieldRole[];
  evidence_requirement?: string;
}

export interface DraftViewSuggestion {
  block_id: string;
  type: "bar_chart";
  title: string;
  metric_id: string;
  evidence_id: string;
  dataset_id: string;
  dimension_column: string;
  value_column: string;
  values: Array<Record<string, string | number>>;
  status: "suggested";
}

export interface DraftDomainViewSuggestion {
  block_id: string;
  type: "domain_view_rule";
  title: string;
  rule_id: string;
  intent: string;
  required_trace: DomainPackViewRule["required_trace"];
  claim_id: string;
  evidence_id: string;
  metric_id?: string;
  status: "suggested";
}

export interface DraftPlan {
  templateSections: string[];
  questions: DraftQuestion[];
  manifest: InsightManifestDraft;
  flow: Array<{ index: string; label: string; output: string }>;
  skills: Array<{ name: string; output: string }>;
  sources: DraftSource[];
  metricSuggestions: DraftMetricSuggestion[];
  viewSuggestions: DraftViewSuggestion[];
  domainViewSuggestions: DraftDomainViewSuggestion[];
}

export interface DraftQuestionOverride {
  question?: string;
  answer?: string;
  status?: DraftQuestionStatus;
  evidence?: string;
  review_note?: string;
  data_request_ids?: string[];
  active_data_request_ids?: string[];
  data_requests?: DraftDataRequest[];
  source?: string;
  base_package_mutation?: boolean;
  imported_at?: string;
  imported_by?: string;
}

export interface InsightManifestDraft {
  spec_version: "0.1.0";
  package_id: string;
  package_type: "insight";
  title: string;
  created_at: string;
  required_capabilities: string[];
  optional_capabilities: string[];
  extensions?: Array<{
    namespace: string;
    version: string;
    required: boolean;
    domain_id?: string;
    title?: string;
  }>;
}

export interface DraftPlanInput {
  title: string;
  packageId: string;
  template: string;
  sources: DraftSourceInput[];
  createdAt?: string;
  domainPack?: DomainPack | DomainPackId;
}

export type DraftPackageValidationStatus = "valid" | "valid_with_warnings" | "invalid";
export type DraftPackageValidationSeverity = "error" | "warning";

export interface DraftPackageValidationIssue {
  severity: DraftPackageValidationSeverity;
  path: string;
  message: string;
}

export interface DraftPackageValidationResult {
  status: DraftPackageValidationStatus;
  issues: DraftPackageValidationIssue[];
  fileCount: number;
}

interface NormalizedSourceFile {
  source: DraftSource;
  source_id: string;
  path: string;
  content: string;
}

interface ParseDiagnosticRecord {
  diagnostic_id: string;
  source_id: string;
  source_refs: string[];
  lineage_refs: string[];
  source_path?: string;
  source_type?: string;
  parser: string;
  parser_version?: string;
  parser_role: string;
  normalized_source_path: string;
  cloud_used: boolean;
  confidence: number;
  status: string;
  message: string;
  spreadsheet_formula_status?: DraftSpreadsheetFormulaEvidence["status"];
  spreadsheet_formula_count?: number;
  spreadsheet_formula_truncated?: boolean;
  spreadsheet_formula_extractor?: DraftSpreadsheetFormulaEvidence["extractor"];
  spreadsheet_formula_termination_reason?: DraftSpreadsheetFormulaEvidence["termination_reason"];
  spreadsheet_formula_message?: string;
}

interface SourceMapRecord {
  schema_version: "open-insight.source-map.v0.1";
  source_map_id: string;
  object_id: string;
  object_type: "normalized_source";
  source_id: string;
  source_path: string;
  raw_source_path: string;
  normalized_source_path: string;
  parse_diagnostic_id: string;
  ranges: Array<{
    kind: "normalized_markdown_full";
    path: string;
    start_line: number;
    end_line: number;
    confidence: number;
  }>;
  provenance_status: "raw_source_bundled_or_external_ref";
}

type PageFurnitureKind = "page_number" | "running_header" | "running_footer" | "watermark" | "legal_footer";
type QueryIndexContentRole = "body" | "table" | "heading" | "page_furniture" | "disclaimer" | "source_overview";
type QueryIndexChunkLevel = "document" | "section" | "paragraph" | "table" | "page_furniture" | "source_overview";
type PageFurnitureRenderPolicy = "deemphasize_in_readable_html" | "preserve_in_reproduction_html" | "review_required";

const QUERY_INDEX_DOCUMENT_PREVIEW_CHAR_LIMIT = 24_000;
const QUERY_INDEX_REBUILD_SQL_INLINE_CHAR_LIMIT = 750_000;
const QUERY_INDEX_PARAGRAPH_CHUNK_CHAR_LIMIT = 1_600;
const QUERY_INDEX_TABLE_CHUNK_CHAR_LIMIT = 4_000;
const QUERY_INDEX_SOURCE_TEXT_CHAR_BUDGET = 450_000;
const QUERY_INDEX_SOURCE_CHUNK_COUNT_LIMIT = 1_500;
const PAGE_FURNITURE_RECORD_LIMIT_PER_SOURCE = 1_000;

interface PageFurnitureRecord {
  schema_version: "open-insight.page-furniture.v0.1";
  artifact_id: string;
  source_id: string;
  normalized_source_path: string;
  kind: PageFurnitureKind;
  text: string;
  line_numbers: number[];
  page_number?: number;
  source_ref: string;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  confidence: number;
  content_role: "page_furniture" | "disclaimer";
  render_policy: PageFurnitureRenderPolicy;
}

interface SpreadsheetFormulaRecord {
  schema_version: "open-insight.spreadsheet-formula.v0.1";
  formula_id: string;
  source_id: string;
  source_path: string;
  normalized_source_path: string;
  sheet_name: string;
  cell_address: string;
  formula: string;
  formula_type: DraftSpreadsheetFormulaCell["formula_type"];
  formula_resolution_status: "resolved" | "unresolved_shared";
  cached_value_available: boolean;
  cached_value?: DraftSpreadsheetFormulaCell["cached_value"];
  cached_value_raw?: string;
  cached_value_type?: DraftSpreadsheetFormulaCell["cached_value_type"];
  range_ref?: string;
  shared_index?: string;
  calculation_status: "not_evaluated";
  content_role: "spreadsheet_formula";
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

interface DigestLedger {
  schema_version: "open-insight.integrity-digests.v0.1";
  algorithm: "sha256";
  role: "integrity_fingerprint";
  source_of_truth: string;
  entries: Array<{
    digest_id: string;
    target_type: "raw_source_metadata" | "normalized_source" | "spreadsheet_formula_evidence";
    target_ref: string;
    path: string;
    hash: string;
    verification_level: "metadata_fingerprint" | "content_hash";
    content_available_in_source_light: boolean;
  }>;
}

const REQUIRED_DRAFT_PACKAGE_FILES = [
  "manifest.json",
  "data/catalog.json",
  "semantic/metrics.json",
  "views/homepage.json",
  "findings/claims.jsonl",
  "evidence/evidence.jsonl",
  "qa/prepared_questions.jsonl",
  "lineage/sources.json"
] as const;

const JSON_DRAFT_PACKAGE_FILES = [
  "manifest.json",
  "data/catalog.json",
  "semantic/metrics.json",
  "views/homepage.json",
  "tools/registry.json",
  "lineage/sources.json",
  "source/inventory.json",
  "integrity/digests.json",
  "query_index/manifest.json"
] as const;

const JSONL_DRAFT_PACKAGE_FILES = [
  "findings/claims.jsonl",
  "evidence/evidence.jsonl",
  "qa/prepared_questions.jsonl",
  "answerability/data_requests.jsonl",
  "versioning/review_history.jsonl",
  "source/parse_diagnostics.jsonl",
  "source/page_furniture.jsonl",
  "source/spreadsheet_formulas.jsonl",
  "lineage/source_map.jsonl",
  "query_index/chunks.jsonl"
] as const;

const REQUIRED_CORE_CAPABILITIES = [
  "core.read",
  "data.catalog",
  "semantic.metrics",
  "views.basic",
  "findings.claims",
  "evidence.basic",
  "qa.prepared",
  "lineage.sources"
] as const;

export function buildDraftPlan(input: DraftPlanInput): DraftPlan {
  const domainPack = resolveDraftDomainPack(input.domainPack);
  const templateContent = input.template.trim().length > 0 ? input.template : domainPack ? buildTemplateFromDomainPack(domainPack) : input.template;
  const templateSections = templateContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sources = input.sources.map(normalizeDraftSource);
  const metricSuggestions = buildMetricSuggestions(sources, domainPack);
  const viewSuggestions = buildViewSuggestions(sources, metricSuggestions);
  const questions = [
    ...buildDomainQuestions(domainPack, sources),
    ...buildTemplateQuestions(templateSections, sources)
  ];
  const domainViewSuggestions = buildDomainViewSuggestions(domainPack, questions, metricSuggestions);
  const homepageSuggestionCount = viewSuggestions.length + domainViewSuggestions.length;

  return {
    templateSections,
    questions,
    sources,
    metricSuggestions,
    viewSuggestions,
    domainViewSuggestions,
    manifest: {
      spec_version: "0.1.0",
      package_id: input.packageId,
      package_type: "insight",
      title: input.title,
      created_at: input.createdAt ?? new Date().toISOString(),
      required_capabilities: [...REQUIRED_CORE_CAPABILITIES],
      optional_capabilities: domainPack ? ["domain.pack", "overlays.personal", "versioning.branch"] : ["overlays.personal", "versioning.branch"],
      ...(domainPack
        ? {
            extensions: [
              {
                namespace: domainPack.namespace,
                version: domainPack.version,
                required: false,
                domain_id: domainPack.domain_id,
                title: domainPack.title
              }
            ]
          }
        : {})
    },
    flow: [
      { index: "01", label: "Template", output: `${templateSections.length} sections` },
      { index: "02", label: "Sources", output: `${sources.length} files` },
      { index: "03", label: "Questions", output: `${questions.length} prepared targets` },
      { index: "04", label: "Views", output: `${homepageSuggestionCount} homepage candidates` }
    ],
    skills: [
      ...(domainPack ? [{ name: "Domain Pack Planner", output: `${domainPack.required_questions.length} domain questions` }] : []),
      { name: "Template Decomposer", output: `${templateSections.length} report slots` },
      { name: "Evidence Indexer", output: `${sources.length} source assets` },
      { name: "Metric Suggester", output: `${metricSuggestions.length} candidate metrics` },
      { name: "Answerability Scanner", output: `${questions.filter((question) => question.status === "needs_data").length} data gaps` },
      { name: "View Synthesizer", output: `${homepageSuggestionCount} homepage candidates` }
    ]
  };
}

export function buildDraftSourceProfileWarnings(sources: DraftSource[]): string[] {
  const warnings: string[] = [];

  for (const source of sources.filter(isTabularDraftSource)) {
    const columns = source.columns ?? [];

    if (columns.length === 0) {
      warnings.push(`来源 ${source.name} 未识别到字段，无法自动生成指标和图表草稿。`);
      continue;
    }

    const hasNumericColumn = columns.some((column) => isAggregatableDraftSourceColumnType(column.type));
    const hasDimensionColumn = columns.some((column) => isDimensionColumnType(column.type));

    if (!hasNumericColumn) {
      warnings.push(`来源 ${source.name} 未识别到可聚合数值字段，无法自动生成指标草稿。`);
    }

    if (hasNumericColumn && !hasDimensionColumn) {
      warnings.push(`来源 ${source.name} 未识别到维度字段，无法自动生成图表草稿。`);
    }
  }

  return warnings;
}

export function applyDraftQuestionOverrides(plan: DraftPlan, overrides: Record<string, DraftQuestionOverride>): DraftPlan {
  const questions = plan.questions.map((question) => {
    const override = overrides[question.id];

    if (!override) {
      return question;
    }

    const nextQuestion: DraftQuestion = {
      ...question,
      question: normalizeOverrideText(override.question, question.question),
      ...(override.answer !== undefined ? { answer: normalizeOverrideText(override.answer, question.answer ?? "") } : {}),
      evidence: normalizeOverrideText(override.evidence, question.evidence),
      status: override.status ?? question.status,
      edited_by: "open-insight-studio",
      ...(override.source ? { source: override.source } : {}),
      ...(override.base_package_mutation !== undefined ? { base_package_mutation: override.base_package_mutation } : {}),
      ...(override.imported_at ? { imported_at: override.imported_at } : {}),
      ...(override.imported_by ? { imported_by: override.imported_by } : {})
    };
    const reviewNote = override.review_note?.trim();
    const dataRequestIds = uniqueStrings([...(question.data_request_ids ?? []), ...(override.data_request_ids ?? [])]);
    const activeDataRequestIds = uniqueStrings([...(question.active_data_request_ids ?? []), ...(override.active_data_request_ids ?? [])]);
    const dataRequests = mergeDraftDataRequests(question.data_requests, override.data_requests);

    return {
      ...nextQuestion,
      ...(reviewNote ? { review_note: reviewNote } : {}),
      ...(dataRequestIds.length > 0 ? { data_request_ids: dataRequestIds } : {}),
      ...(activeDataRequestIds.length > 0 ? { active_data_request_ids: activeDataRequestIds } : {}),
      ...(dataRequests.length > 0 ? { data_requests: dataRequests } : {})
    };
  });
  const answerabilityOutput = `${questions.filter((question) => question.status === "needs_data").length} data gaps`;

  return {
    ...plan,
    questions,
    skills: plan.skills.map((skill) => (skill.name === "Answerability Scanner" ? { ...skill, output: answerabilityOutput } : skill))
  };
}

function resolveDraftDomainPack(domainPack: DomainPack | DomainPackId | undefined): DomainPack | undefined {
  if (domainPack === undefined) {
    return undefined;
  }

  if (typeof domainPack === "string") {
    return getDomainPack(domainPack);
  }

  return domainPack;
}

function normalizeOverrideText(value: string | undefined, fallback: string): string {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : fallback;
}

function mergeDraftDataRequests(baseRequests: DraftDataRequest[] | undefined, overrideRequests: DraftDataRequest[] | undefined): DraftDataRequest[] {
  const requestsById = new Map<string, DraftDataRequest>();

  (baseRequests ?? []).forEach((request) => {
    requestsById.set(request.request_id, request);
  });
  (overrideRequests ?? []).forEach((request) => {
    requestsById.set(request.request_id, request);
  });

  return [...requestsById.values()];
}

function buildDomainQuestions(domainPack: DomainPack | undefined, sources: DraftSource[]): DraftQuestion[] {
  if (!domainPack) {
    return [];
  }

  return domainPack.required_questions.map((question, index) => {
    const source = sources[index % Math.max(1, sources.length)];
    const id = `q_${slugify(question.question_id) || index + 1}`;

    return {
      id,
      section: "行业必答",
      question: question.question,
      status: source ? "needs_review" : "needs_data",
      evidence: source
        ? `行业证据要求：${question.evidence_expectation}；候选来源：${source.name}`
        : `尚未识别到匹配来源。行业证据要求：${question.evidence_expectation}`,
      ...(source ? { source_name: source.name } : {}),
      claim_id: `claim_${slugify(question.question_id) || index + 1}`,
      evidence_id: `ev_${slugify(question.question_id) || index + 1}`,
      origin: "domain_pack",
      why_required: question.why_required,
      evidence_expectation: question.evidence_expectation
    };
  });
}

function buildTemplateQuestions(templateSections: string[], sources: DraftSource[]): DraftQuestion[] {
  return templateSections.slice(0, 12).map((section, index): DraftQuestion => {
    const source = sources[index % Math.max(1, sources.length)];
    const id = `q_${slugify(section) || index + 1}`;
    const hasSource = source !== undefined;

    return {
      id,
      section,
      question: `文件包应如何说明“${section}”？`,
      status: hasSource ? "needs_review" : "needs_data",
      evidence: hasSource ? `候选证据：${source.name}` : "尚未识别到匹配来源。",
      ...(source ? { source_name: source.name } : {}),
      claim_id: `claim_${slugify(section) || index + 1}`,
      evidence_id: `ev_${slugify(section) || index + 1}`,
      origin: "template"
    };
  });
}

function buildDomainViewSuggestions(
  domainPack: DomainPack | undefined,
  questions: DraftQuestion[],
  metrics: DraftMetricSuggestion[]
): DraftDomainViewSuggestion[] {
  if (!domainPack) {
    return [];
  }

  const domainQuestions = questions.filter((question) => question.origin === "domain_pack");
  const traceableQuestions = domainQuestions.length > 0 ? domainQuestions : questions;

  return domainPack.view_rules
    .map((rule, index): DraftDomainViewSuggestion | undefined => {
      const question = traceableQuestions[index % Math.max(1, traceableQuestions.length)];

      if (!question) {
        return undefined;
      }

      const metricPool = metrics.some((metric) => metric.origin === "domain_blueprint")
        ? metrics.filter((metric) => metric.origin === "domain_blueprint")
        : metrics;
      const metric = rule.required_trace.includes("metric_id") ? metricPool[index % Math.max(1, metricPool.length)] : undefined;

      return {
        block_id: `block_domain_${slugify(rule.view_id) || index + 1}`,
        type: "domain_view_rule",
        title: rule.title,
        rule_id: rule.view_id,
        intent: rule.intent,
        required_trace: [...rule.required_trace],
        claim_id: question.claim_id,
        evidence_id: question.evidence_id,
        ...(metric ? { metric_id: metric.metric_id } : {}),
        status: "suggested"
      };
    })
    .filter((suggestion): suggestion is DraftDomainViewSuggestion => suggestion !== undefined);
}

function draftQuestionPackageStatus(question: DraftQuestion): "needs_review" | "unanswerable" {
  return question.status === "needs_data" ? "unanswerable" : "needs_review";
}

function draftQuestionReviewMetadata(question: DraftQuestion): Record<string, boolean | string> {
  const metadata: Record<string, boolean | string> = {};

  if (question.review_state) {
    metadata.review_state = question.review_state;
  } else if (question.status === "verified_target") {
    metadata.review_state = "question_target_confirmed";
  } else if (question.edited_by) {
    metadata.review_state = "edited_needs_review";
  }

  if (question.confirmation_scope) {
    metadata.confirmation_scope = question.confirmation_scope;
  } else if (question.status === "verified_target") {
    metadata.confirmation_scope = "question_target_only";
  }

  if (question.edited_by) {
    metadata.edited_by = question.edited_by;
  }

  if (question.review_note) {
    metadata.review_note = question.review_note;
  }

  if (question.base_package_mutation !== undefined) {
    metadata.base_package_mutation = question.base_package_mutation;
  }

  return metadata;
}

function draftGeneratedContentMetadata(question: DraftQuestion): Record<string, string> {
  return {
    generation_status: question.generation_status ?? "compiler_generated",
    review_status: question.review_status ?? "needs_review"
  };
}

function draftViewBlockMetadata(): Record<string, string> {
  return {
    status: "suggested",
    generation_status: "compiler_generated",
    review_status: "needs_review"
  };
}

function draftPreparedQuestionMetadata(question: DraftQuestion): Record<string, boolean | string | string[]> {
  const metadata: Record<string, boolean | string | string[]> = {
    ...draftQuestionReviewMetadata(question),
    ...draftGeneratedContentMetadata(question)
  };

  if (question.data_request_ids?.length) {
    metadata.data_request_ids = uniqueStrings(question.data_request_ids);
  }

  if (question.active_data_request_ids?.length) {
    metadata.active_data_request_ids = uniqueStrings(question.active_data_request_ids);
  }

  if (question.source) {
    metadata.source = question.source;
  }

  if (question.source_qa_id) {
    metadata.source_qa_id = question.source_qa_id;
  }

  if (question.source_question_id) {
    metadata.source_question_id = question.source_question_id;
  }

  if (question.source_followup_file) {
    metadata.source_followup_file = question.source_followup_file;
  }

  if (question.promotion_policy) {
    metadata.promotion_policy = question.promotion_policy;
  }

  if (question.imported_at) {
    metadata.imported_at = question.imported_at;
  }

  if (question.imported_by) {
    metadata.imported_by = question.imported_by;
  }

  return metadata;
}

function draftClaimSummary(question: DraftQuestion): string {
  if (question.status === "needs_data") {
    return `当前文件包无法回答“${question.question}”，需要先补充匹配来源数据。`;
  }

  if (question.origin === "overlay_import") {
    return `使用方追问“${question.question}”已从私有 overlay 导入，等待 Studio 复核和证据整理。`;
  }

  if (question.status === "verified_target") {
    return `问题目标“${question.question}”已在 Studio 中确认，但回答仍等待证据抽取和人工审阅。`;
  }

  if (question.origin === "domain_pack") {
    return `行业必答问题“${question.question}”已纳入草稿，等待证据抽取和人工审阅。`;
  }

  return `模板章节“${question.section}”的草稿结论等待证据抽取和人工审阅。`;
}

function draftPreparedAnswer(question: DraftQuestion): string {
  const reviewedAnswer = question.answer?.trim();

  if (reviewedAnswer) {
    return reviewedAnswer;
  }

  if (question.status === "needs_data") {
    return "当前文件包还不能回答该问题，因为匹配来源数据尚未补充。";
  }

  if (question.origin === "overlay_import") {
    return "这是从使用方私有 overlay 问答导入的追问素材；发布前需要重新绑定证据、审阅状态和最终回答。";
  }

  if (question.status === "verified_target") {
    return "该问题目标已在 Studio 中确认；发布前仍需完成证据抽取和人工审阅，不能视为已验证结论。";
  }

  if (question.origin === "domain_pack") {
    return `这是行业包要求的必答问题。发布前需要满足证据要求：${question.evidence_expectation ?? "需要绑定可追溯证据"}。`;
  }

  return `模板章节“${question.section}”的草稿回答目标。发布前需要完成证据抽取和人工审阅。`;
}

export function validateDraftPackageFiles(files: Record<string, string>): DraftPackageValidationResult {
  const issues: DraftPackageValidationIssue[] = [];
  const jsonFiles = new Map<string, unknown>();
  const jsonlFiles = new Map<string, unknown[]>();

  for (const filePath of REQUIRED_DRAFT_PACKAGE_FILES) {
    if (files[filePath] === undefined) {
      issues.push({
        severity: "error",
        path: filePath,
        message: `缺少必需草稿包文件：${filePath}`
      });
    }
  }

  for (const filePath of JSON_DRAFT_PACKAGE_FILES) {
    const content = files[filePath];

    if (content === undefined) {
      continue;
    }

    try {
      jsonFiles.set(filePath, JSON.parse(content) as unknown);
    } catch (error) {
      issues.push({
        severity: "error",
        path: filePath,
        message: `JSON 无法解析：${error instanceof Error ? error.message : "解析错误"}`
      });
    }
  }

  for (const filePath of JSONL_DRAFT_PACKAGE_FILES) {
    const content = files[filePath];

    if (content === undefined) {
      continue;
    }

    const records: unknown[] = [];
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    lines.forEach((line, index) => {
      try {
        records.push(JSON.parse(line) as unknown);
      } catch (error) {
        issues.push({
          severity: "error",
          path: `${filePath}:${index + 1}`,
          message: `JSONL 记录无法解析：${error instanceof Error ? error.message : "解析错误"}`
        });
      }
    });

    jsonlFiles.set(filePath, records);
  }

  validateDraftPackageReferences(jsonFiles, jsonlFiles, issues);
  validateSpreadsheetFormulaEvidence(files, jsonFiles, jsonlFiles, issues);

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const hasWarnings = issues.some((issue) => issue.severity === "warning");

  return {
    status: hasErrors ? "invalid" : hasWarnings ? "valid_with_warnings" : "valid",
    issues,
    fileCount: Object.keys(files).length
  };
}

export function buildDraftPackageFiles(plan: DraftPlan): Record<string, string> {
  const datasets = buildDataCatalogDatasets(plan.sources);
  const defaultDatasetId = datasets[0]?.dataset_id ?? "source_placeholder";
  const normalizedSources = buildNormalizedSourceFiles(plan.sources);
  const parseDiagnostics = buildParseDiagnostics(normalizedSources);
  const sourceMapRecords = buildSourceMapRecords(normalizedSources, parseDiagnostics);
  const spreadsheetFormulaRecords = buildSpreadsheetFormulaRecords(normalizedSources, parseDiagnostics, sourceMapRecords);
  const pageFurnitureRecords = buildPageFurnitureRecords(normalizedSources, parseDiagnostics, sourceMapRecords);
  const digestLedger = buildDigestLedger(normalizedSources, spreadsheetFormulaRecords);
  const sourceInventory = buildSourceInventory(normalizedSources, parseDiagnostics, sourceMapRecords, digestLedger);
  const queryIndexFiles = buildQueryIndexFiles(
    normalizedSources,
    parseDiagnostics,
    sourceMapRecords,
    digestLedger,
    pageFurnitureRecords,
    spreadsheetFormulaRecords
  );
  const domainViewBlocks = plan.domainViewSuggestions.slice(0, 3).map((view) => ({
    block_id: view.block_id,
    type: view.type,
    title: view.title,
    ...draftViewBlockMetadata(),
    claim_id: view.claim_id,
    evidence_ids: [view.evidence_id],
    ...(view.metric_id ? { metric_id: view.metric_id } : {}),
    domain_view_rule_id: view.rule_id,
    intent: view.intent,
    required_trace: view.required_trace
  }));
  const sourceViewBlocks = plan.viewSuggestions.slice(0, 3).map((view) => ({
    block_id: view.block_id,
    type: view.type,
    title: view.title,
    ...draftViewBlockMetadata(),
    metric_id: view.metric_id,
    evidence_ids: [view.evidence_id]
  }));
  const questionBlocks = plan.questions
    .filter((question) => question.origin !== "domain_pack")
    .slice(0, Math.max(0, 6 - domainViewBlocks.length - sourceViewBlocks.length))
    .map((question) => ({
      block_id: `block_${question.id.replace(/^q_/, "")}`,
      type: question.status === "needs_data" ? "answerability_card" : "prepared_answer_card",
      title: question.section,
      ...draftViewBlockMetadata(),
      claim_id: question.claim_id,
      evidence_ids: [question.evidence_id]
    }));
  const claims = plan.questions.map((question) => ({
    claim_id: question.claim_id,
    status: draftQuestionPackageStatus(question),
    summary: draftClaimSummary(question),
    evidence_ids: [question.evidence_id],
    ...(question.origin === "domain_pack" ? { origin: question.origin, why_required: question.why_required } : {}),
    ...draftGeneratedContentMetadata(question),
    ...draftQuestionReviewMetadata(question),
    created_by: "open-insight-compiler"
  }));
  const questionEvidence = plan.questions.map((question) => ({
    evidence_id: question.evidence_id,
    type: question.status === "needs_data" ? "data_gap" : "source_candidate",
    summary: question.evidence,
    source_refs: [{ dataset_id: datasetIdForQuestion(question, datasets, defaultDatasetId) }],
    ...(question.status === "needs_data" ? { missing_fields: [slugify(question.section) || "source_data"] } : {})
  }));
  const viewEvidence = plan.viewSuggestions.map((view) => ({
    evidence_id: view.evidence_id,
    type: "source_profile",
    summary: `基于抽样来源行生成的“${view.title}”建议。`,
    query: `GROUP BY ${view.dimension_column}; SUM(${view.value_column})`,
    source_refs: [{ dataset_id: view.dataset_id }],
    values: view.values
  }));
  const evidence = [...viewEvidence, ...questionEvidence];
  const preparedQuestions = plan.questions.map((question) => ({
    question_id: question.id,
    question: question.question,
    answer: draftPreparedAnswer(question),
    status: draftQuestionPackageStatus(question),
    claim_ids: [question.claim_id],
    evidence_ids: [question.evidence_id],
    ...draftPreparedQuestionMetadata(question)
  }));
  const dataRequests = buildDraftDataRequests(plan.questions);

  return {
    "manifest.json": json(plan.manifest),
    "data/catalog.json": json({ datasets }),
    "semantic/metrics.json": json({
      metrics: plan.metricSuggestions.map((metric) => ({
        metric_id: metric.metric_id,
        name: metric.name,
        definition: metric.definition,
        formula: metric.formula,
        dataset_id: metric.dataset_id,
        source_column: metric.source_column,
        ...(metric.source_columns ? { source_columns: metric.source_columns } : {}),
        status: metric.status,
        origin: metric.origin,
        aggregation: metric.aggregation,
        ...(metric.blueprint_id ? { blueprint_id: metric.blueprint_id } : {}),
        ...(metric.matched_preferred_column ? { matched_preferred_column: metric.matched_preferred_column } : {}),
        ...(metric.field_role ? { field_role: metric.field_role } : {}),
        ...(metric.source_field_roles ? { source_field_roles: metric.source_field_roles } : {}),
        ...(metric.evidence_requirement ? { evidence_requirement: metric.evidence_requirement } : {})
      }))
    }),
    "views/homepage.json": json({
      view_id: "homepage",
      title: plan.manifest.title,
      audience: "draft_reviewer",
      blocks: [...domainViewBlocks, ...sourceViewBlocks, ...questionBlocks]
    }),
    "findings/claims.jsonl": jsonl(claims),
    "evidence/evidence.jsonl": jsonl(evidence),
    "qa/prepared_questions.jsonl": jsonl(preparedQuestions),
    "answerability/data_requests.jsonl": jsonl(dataRequests),
    "tools/registry.json": json({
      tools: [
        {
          name: "lookup_evidence",
          description: "按 evidence_id 返回当前草稿包中的证据记录。"
        },
        {
          name: "lookup_prepared_question",
          description: "按 question_id 或文本查询返回当前草稿包中的预置问答记录。"
        }
      ]
    }),
    "lineage/sources.json": json({
      sources: plan.sources.length
        ? plan.sources.map((source, index) => ({
            source_id: datasetIdForSource(source, index),
            type: source.type ?? inferSourceType(source.name),
            description: source.name,
            path: source.path ?? `sources/${source.name}`,
            ...(source.size_bytes !== undefined ? { size_bytes: source.size_bytes } : {}),
            ...(source.mime_type ? { mime_type: source.mime_type } : {}),
            ...(source.row_count !== undefined ? { row_count: source.row_count } : {}),
            ...(source.metadata ? { metadata: source.metadata } : {})
          }))
        : [
            {
              source_id: "source_placeholder",
              type: "pending",
              description: "来源数据尚未补充。",
              path: "sources/pending-source"
            }
          ]
    }),
    ...(normalizedSources.length > 0 ? { "source/inventory.json": json(sourceInventory) } : {}),
    ...(parseDiagnostics.length > 0 ? { "source/parse_diagnostics.jsonl": jsonl(parseDiagnostics) } : {}),
    ...(pageFurnitureRecords.length > 0 ? { "source/page_furniture.jsonl": jsonl(pageFurnitureRecords) } : {}),
    ...(spreadsheetFormulaRecords.length > 0
      ? { "source/spreadsheet_formulas.jsonl": jsonl(spreadsheetFormulaRecords) }
      : {}),
    ...(sourceMapRecords.length > 0 ? { "lineage/source_map.jsonl": jsonl(sourceMapRecords) } : {}),
    ...(digestLedger.entries.length > 0 ? { "integrity/digests.json": json(digestLedger) } : {}),
    ...queryIndexFiles,
    ...Object.fromEntries(normalizedSources.map((source) => [source.path, source.content]))
  };
}

function buildDraftDataRequests(questions: DraftQuestion[]): DraftDataRequest[] {
  const dataRequestsById = new Map<string, DraftDataRequest>();

  for (const question of questions) {
    const explicitRequests = normalizeDraftQuestionDataRequests(question);

    if (explicitRequests.length > 0) {
      for (const request of explicitRequests) {
        if (!dataRequestsById.has(request.request_id)) {
          dataRequestsById.set(request.request_id, request);
        }
      }
      continue;
    }

    if (question.status === "needs_data") {
      const request = buildFallbackDraftDataRequest(question);

      dataRequestsById.set(request.request_id, request);
    }
  }

  return [...dataRequestsById.values()];
}

function normalizeDraftQuestionDataRequests(question: DraftQuestion): DraftDataRequest[] {
  const explicitRequests = question.data_requests ?? [];
  const explicitRequestIds = uniqueStrings([...(question.active_data_request_ids ?? []), ...(question.data_request_ids ?? [])]);
  const requestsById = new Map(explicitRequests.map((request) => [request.request_id, normalizeDraftDataRequest(request, question)]));

  if (explicitRequestIds.length === 0) {
    return [...requestsById.values()];
  }

  return explicitRequestIds.map((requestId) => requestsById.get(requestId) ?? buildFallbackDraftDataRequest(question, requestId));
}

function normalizeDraftDataRequest(request: DraftDataRequest, question: DraftQuestion): DraftDataRequest {
  return {
    request_id: request.request_id,
    question: request.question || question.question,
    status: request.status || "draft",
    missing_fields: request.missing_fields.length > 0 ? request.missing_fields : [slugify(question.section) || "source_data"],
    ...(request.required_grain ? { required_grain: request.required_grain } : {}),
    ...(request.required_time_range ? { required_time_range: request.required_time_range } : {}),
    why_needed: request.why_needed || `用于回答“${question.section}”章节。`,
    ...(request.priority ? { priority: request.priority } : { priority: "medium" }),
    affected_findings: request.affected_findings?.length ? request.affected_findings : [question.claim_id],
    ...(request.source ? { source: request.source } : {}),
    ...(request.source_qa_id ? { source_qa_id: request.source_qa_id } : {}),
    ...(request.source_request_id ? { source_request_id: request.source_request_id } : {}),
    ...(request.source_followup_file ? { source_followup_file: request.source_followup_file } : {}),
    ...(request.base_package_mutation !== undefined ? { base_package_mutation: request.base_package_mutation } : {}),
    ...(request.imported_at ? { imported_at: request.imported_at } : {}),
    ...(request.imported_by ? { imported_by: request.imported_by } : {})
  };
}

function buildFallbackDraftDataRequest(question: DraftQuestion, requestId = `req_${question.id.replace(/^q_/, "")}`): DraftDataRequest {
  return {
    request_id: requestId,
    question: question.question,
    status: "open",
    missing_fields: [slugify(question.section) || "source_data"],
    why_needed: `用于回答“${question.section}”章节。`,
    priority: "medium",
    affected_findings: [question.claim_id]
  };
}

function validateDraftPackageReferences(
  jsonFiles: Map<string, unknown>,
  jsonlFiles: Map<string, unknown[]>,
  issues: DraftPackageValidationIssue[]
) {
  const manifest = asRecord(jsonFiles.get("manifest.json"));
  const catalog = asRecord(jsonFiles.get("data/catalog.json"));
  const metricsFile = asRecord(jsonFiles.get("semantic/metrics.json"));
  const homepage = asRecord(jsonFiles.get("views/homepage.json"));
  const claims = jsonlFiles.get("findings/claims.jsonl") ?? [];
  const evidence = jsonlFiles.get("evidence/evidence.jsonl") ?? [];
  const questions = jsonlFiles.get("qa/prepared_questions.jsonl") ?? [];
  const dataRequests = jsonlFiles.get("answerability/data_requests.jsonl") ?? [];
  const reviewHistory = jsonlFiles.get("versioning/review_history.jsonl") ?? [];
  const datasetIds = new Set(asRecordArray(catalog?.datasets).map((item) => asString(item.dataset_id)).filter(Boolean));
  const metricIds = new Set(asRecordArray(metricsFile?.metrics).map((item) => asString(item.metric_id)).filter(Boolean));
  const claimIds = new Set(claims.map((item) => asString(asRecord(item)?.claim_id)).filter(Boolean));
  const evidenceIds = new Set(evidence.map((item) => asString(asRecord(item)?.evidence_id)).filter(Boolean));
  const questionIds = new Set(questions.map((item) => asString(asRecord(item)?.question_id)).filter(Boolean));
  const dataRequestIds = new Set(dataRequests.map((item) => asString(asRecord(item)?.request_id)).filter(Boolean));

  if (manifest) {
    if (manifest.package_type !== "insight") {
      issues.push({ severity: "error", path: "manifest.json/package_type", message: "manifest.package_type must be insight." });
    }

    validateRequiredCoreCapabilities(manifest.required_capabilities, issues);

    if (typeof manifest.created_at !== "string" || manifest.created_at.length === 0) {
      issues.push({ severity: "error", path: "manifest.json/created_at", message: "manifest.created_at is required." });
    }
  }

  for (const source of asRecordArray(asRecord(jsonFiles.get("lineage/sources.json"))?.sources)) {
    const sourceId = asString(source.source_id);

    if (sourceId && !datasetIds.has(sourceId)) {
      issues.push({
        severity: "warning",
        path: "lineage/sources.json",
        message: `Source ${sourceId} is not represented in data/catalog.json.`
      });
    }
  }

  for (const metric of asRecordArray(metricsFile?.metrics)) {
    const metricId = asString(metric.metric_id) || "unknown";
    const datasetId = asString(metric.dataset_id);

    if (datasetId && !datasetIds.has(datasetId)) {
      issues.push({
        severity: "error",
        path: "semantic/metrics.json",
        message: `指标 ${metricId} 引用了不存在的数据集 ${datasetId}。`
      });
    }
  }

  for (const block of asRecordArray(homepage?.blocks)) {
    const blockId = asString(block.block_id) || "unknown";
    const metricId = asString(block.metric_id);
    const claimId = asString(block.claim_id);

    if (metricId && !metricIds.has(metricId)) {
      issues.push({ severity: "error", path: "views/homepage.json", message: `展示块 ${blockId} 引用了不存在的指标 ${metricId}。` });
    }

    if (claimId && !claimIds.has(claimId)) {
      issues.push({ severity: "error", path: "views/homepage.json", message: `展示块 ${blockId} 引用了不存在的结论 ${claimId}。` });
    }

    for (const evidenceId of asStringArray(block.evidence_ids)) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({ severity: "error", path: "views/homepage.json", message: `展示块 ${blockId} 引用了不存在的证据 ${evidenceId}。` });
      }
    }
  }

  for (const claim of claims) {
    const record = asRecord(claim);
    const claimId = asString(record?.claim_id) || "unknown";

    for (const evidenceId of asStringArray(record?.evidence_ids)) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({ severity: "error", path: "findings/claims.jsonl", message: `结论 ${claimId} 引用了不存在的证据 ${evidenceId}。` });
      }
    }
  }

  for (const evidenceRecord of evidence) {
    const record = asRecord(evidenceRecord);
    const evidenceId = asString(record?.evidence_id) || "unknown";

    for (const sourceRef of asRecordArray(record?.source_refs)) {
      const datasetId = asString(sourceRef.dataset_id);

      if (datasetId && !datasetIds.has(datasetId)) {
      issues.push({
        severity: "error",
        path: "evidence/evidence.jsonl",
        message: `证据 ${evidenceId} 引用了不存在的数据集 ${datasetId}。`
      });
      }
    }
  }

  for (const question of questions) {
    const record = asRecord(question);
    const questionId = asString(record?.question_id) || "unknown";

    for (const claimId of asStringArray(record?.claim_ids)) {
      if (!claimIds.has(claimId)) {
        issues.push({ severity: "error", path: "qa/prepared_questions.jsonl", message: `预置问题 ${questionId} 引用了不存在的结论 ${claimId}。` });
      }
    }

    for (const evidenceId of asStringArray(record?.evidence_ids)) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({
          severity: "error",
          path: "qa/prepared_questions.jsonl",
          message: `预置问题 ${questionId} 引用了不存在的证据 ${evidenceId}。`
        });
      }
    }

    for (const requestId of [...asStringArray(record?.data_request_ids), ...asStringArray(record?.active_data_request_ids)]) {
      if (!dataRequestIds.has(requestId)) {
        issues.push({
          severity: "error",
          path: "qa/prepared_questions.jsonl",
          message: `预置问题 ${questionId} 引用了不存在的补数请求 ${requestId}。`
        });
      }
    }
  }

  for (const request of dataRequests) {
    const record = asRecord(request);
    const requestId = asString(record?.request_id) || "unknown";

    for (const claimId of asStringArray(record?.affected_findings)) {
      if (!claimIds.has(claimId)) {
      issues.push({
        severity: "error",
        path: "answerability/data_requests.jsonl",
        message: `补数请求 ${requestId} 引用了不存在的影响结论 ${claimId}。`
      });
      }
    }
  }

  for (const historyRecord of reviewHistory) {
    const record = asRecord(historyRecord);
    const reviewId = asString(record?.review_id) || "unknown";
    const questionId = asString(record?.question_id);
    const primaryClaimId = asString(record?.primary_claim_id);
    const primaryEvidenceId = asString(record?.primary_evidence_id);

    if (questionId && !questionIds.has(questionId)) {
      issues.push({
        severity: "error",
        path: "versioning/review_history.jsonl",
        message: `审阅记录 ${reviewId} 引用了不存在的问题 ${questionId}。`
      });
    }

    if (primaryClaimId && !claimIds.has(primaryClaimId)) {
      issues.push({
        severity: "error",
        path: "versioning/review_history.jsonl",
        message: `审阅记录 ${reviewId} 引用了不存在的主结论 ${primaryClaimId}。`
      });
    }

    if (primaryEvidenceId && !evidenceIds.has(primaryEvidenceId)) {
      issues.push({
        severity: "error",
        path: "versioning/review_history.jsonl",
        message: `审阅记录 ${reviewId} 引用了不存在的主证据 ${primaryEvidenceId}。`
      });
    }

    for (const claimId of asStringArray(record?.claim_ids)) {
      if (!claimIds.has(claimId)) {
        issues.push({
          severity: "error",
          path: "versioning/review_history.jsonl",
          message: `审阅记录 ${reviewId} 引用了不存在的结论 ${claimId}。`
        });
      }
    }

    for (const evidenceId of asStringArray(record?.evidence_ids)) {
      if (!evidenceIds.has(evidenceId)) {
        issues.push({
          severity: "error",
          path: "versioning/review_history.jsonl",
          message: `审阅记录 ${reviewId} 引用了不存在的证据 ${evidenceId}。`
        });
      }
    }
  }
}

function validateSpreadsheetFormulaEvidence(
  files: Record<string, string>,
  jsonFiles: Map<string, unknown>,
  jsonlFiles: Map<string, unknown[]>,
  issues: DraftPackageValidationIssue[]
): void {
  const formulaPath = "source/spreadsheet_formulas.jsonl";
  const formulaContent = files[formulaPath];

  if (formulaContent === undefined) {
    return;
  }

  const formulaRecords = (jsonlFiles.get(formulaPath) ?? []).map(asRecord).filter(
    (record): record is Record<string, unknown> => record !== undefined
  );
  const sourceIds = new Set(
    asRecordArray(asRecord(jsonFiles.get("lineage/sources.json"))?.sources)
      .map((record) => asString(record.source_id))
      .filter(Boolean)
  );
  const diagnosticIds = new Set(
    (jsonlFiles.get("source/parse_diagnostics.jsonl") ?? [])
      .map((record) => asString(asRecord(record)?.diagnostic_id))
      .filter(Boolean)
  );
  const sourceMapIds = new Set(
    (jsonlFiles.get("lineage/source_map.jsonl") ?? [])
      .map((record) => asString(asRecord(record)?.source_map_id))
      .filter(Boolean)
  );

  for (const [index, record] of formulaRecords.entries()) {
    const formulaId = asString(record.formula_id) || `row_${index + 1}`;
    for (const sourceRef of [...asStringArray(record.source_refs), ...asStringArray(record.lineage_refs)]) {
      if (!sourceIds.has(sourceRef)) {
        issues.push({
          severity: "error",
          path: `${formulaPath}:${index + 1}`,
          message: `公式证据 ${formulaId} 引用了不存在的来源 ${sourceRef}。`
        });
      }
    }
    for (const diagnosticId of asStringArray(record.parse_diagnostic_ids)) {
      if (!diagnosticIds.has(diagnosticId)) {
        issues.push({
          severity: "error",
          path: `${formulaPath}:${index + 1}`,
          message: `公式证据 ${formulaId} 引用了不存在的解析诊断 ${diagnosticId}。`
        });
      }
    }
    for (const sourceMapRef of asStringArray(record.source_map_refs)) {
      if (!sourceMapIds.has(sourceMapRef)) {
        issues.push({
          severity: "error",
          path: `${formulaPath}:${index + 1}`,
          message: `公式证据 ${formulaId} 引用了不存在的 source map ${sourceMapRef}。`
        });
      }
    }
  }

  const digestEntries = asRecordArray(asRecord(jsonFiles.get("integrity/digests.json"))?.entries);
  const formulaDigest = digestEntries.find((entry) => entry.path === formulaPath);
  const expectedFormulaDigest = sha256Digest(formulaContent);

  if (!formulaDigest) {
    issues.push({
      severity: "error",
      path: "integrity/digests.json",
      message: `${formulaPath} 缺少 content digest。`
    });
  } else if (formulaDigest.hash !== expectedFormulaDigest) {
    issues.push({
      severity: "error",
      path: "integrity/digests.json",
      message: `${formulaPath} 的 content digest 与实际内容不一致。`
    });
  }

  const countsBySource = new Map<string, number>();
  for (const record of formulaRecords) {
    const sourceId = asString(record.source_id);
    if (sourceId) {
      countsBySource.set(sourceId, (countsBySource.get(sourceId) ?? 0) + 1);
    }
  }
  for (const inventorySource of asRecordArray(asRecord(jsonFiles.get("source/inventory.json"))?.sources)) {
    const declaredCount =
      typeof inventorySource.spreadsheet_formula_count === "number"
        ? inventorySource.spreadsheet_formula_count
        : undefined;
    const sourceId = asString(inventorySource.source_id);
    if (declaredCount !== undefined && sourceId && declaredCount !== (countsBySource.get(sourceId) ?? 0)) {
      issues.push({
        severity: "error",
        path: "source/inventory.json",
        message:
          `来源 ${sourceId} 声明 spreadsheet_formula_count=${declaredCount}，` +
          `但 ${formulaPath} 实际为 ${countsBySource.get(sourceId) ?? 0}。`
      });
    }
  }

  const queryManifest = asRecord(jsonFiles.get("query_index/manifest.json"));
  if (
    queryManifest &&
    typeof queryManifest.spreadsheet_formula_count === "number" &&
    queryManifest.spreadsheet_formula_count !== formulaRecords.length
  ) {
    issues.push({
      severity: "error",
      path: "query_index/manifest.json",
      message:
        `query index 声明 spreadsheet_formula_count=${queryManifest.spreadsheet_formula_count}，` +
        `但 ${formulaPath} 实际为 ${formulaRecords.length}。`
    });
  }

  const rebuildSql = files["query_index/rebuild.sql"];
  if (rebuildSql !== undefined) {
    for (const [index, record] of formulaRecords.entries()) {
      const formulaId = asString(record.formula_id);
      if (formulaId && !rebuildSql.includes(formulaId)) {
        issues.push({
          severity: "error",
          path: "query_index/rebuild.sql",
          message: `query index 重建 SQL 缺少公式证据 ${formulaId}（JSONL 第 ${index + 1} 条）。`
        });
      }
    }
  }
}

function validateRequiredCoreCapabilities(requiredCapabilities: unknown, issues: DraftPackageValidationIssue[]): void {
  const declaredCapabilities = new Set(Array.isArray(requiredCapabilities) ? requiredCapabilities.filter((item) => typeof item === "string") : []);

  REQUIRED_CORE_CAPABILITIES.forEach((capability) => {
    if (!declaredCapabilities.has(capability)) {
      issues.push({
        severity: "warning",
        path: "manifest.json/required_capabilities",
        message: `required_capabilities 应包含 ${capability}。`
      });
    }
  });
}

function buildDataCatalogDatasets(sources: DraftSource[]) {
  if (sources.length === 0) {
    return [
      {
        dataset_id: "source_placeholder",
        path: "sources/pending-source",
        format: "pending",
        description: "来源数据尚未补充。",
        columns: []
      }
    ];
  }

  return sources.map((source, index) => ({
    dataset_id: datasetIdForSource(source, index),
    path: source.path ?? `sources/${source.name}`,
    format: source.type ?? inferSourceType(source.name),
    description: source.name,
    ...(source.row_count !== undefined ? { row_count: source.row_count } : {}),
    ...(source.size_bytes !== undefined ? { size_bytes: source.size_bytes } : {}),
    ...(source.mime_type ? { mime_type: source.mime_type } : {}),
    ...(source.metadata ? { metadata: source.metadata } : {}),
    columns: (source.columns ?? []).map((column) => ({
      name: column.name,
      type: column.type ?? "unknown"
    }))
  }));
}

function buildNormalizedSourceFiles(sources: DraftSource[]): NormalizedSourceFile[] {
  return sources
    .map((source, index): NormalizedSourceFile | undefined => {
      if (!shouldBuildNormalizedSource(source)) {
        return undefined;
      }

      const sourceId = datasetIdForSource(source, index);

      return {
        source,
        source_id: sourceId,
        path: `source/normalized/${sourceId}.md`,
        content: buildNormalizedSourceMarkdown(source, sourceId)
      };
    })
    .filter((source): source is NormalizedSourceFile => source !== undefined);
}

function shouldBuildNormalizedSource(source: DraftSource): boolean {
  if ((source.normalized_source?.content.trim().length ?? 0) > 0) {
    return true;
  }

  if (source.normalized_source?.parser === "open_insight_builtin_metadata") {
    return true;
  }

  return isTabularDraftSource(source) && ((source.columns?.length ?? 0) > 0 || (source.sample_rows?.length ?? 0) > 0);
}

function buildNormalizedSourceMarkdown(source: DraftSource, sourceId: string): string {
  const externalNormalizedSource = source.normalized_source;

  if (externalNormalizedSource && externalNormalizedSource.content.trim().length > 0) {
    const content = externalNormalizedSource.content.endsWith("\n")
      ? externalNormalizedSource.content
      : `${externalNormalizedSource.content}\n`;
    return appendSpreadsheetFormulaEvidenceMarkdown(content, source);
  }

  const sourceType = source.type ?? inferSourceType(source.name);
  const sourcePath = source.path ?? `sources/${source.name}`;
  const columns = source.columns ?? [];
  const sampleRows = source.sample_rows ?? [];
  const metadataEntries = Object.entries(source.metadata ?? {});

  if (!isTabularDraftSource(source)) {
    const lines = [
      `# Normalized source: ${source.name}`,
      "",
      "> This is a metadata-only normalized source. Open Insight has not extracted the full body text for this file with the current parser.",
      "> 这是 metadata-only normalized source；当前 parser 未抽取正文，不能替代 raw source、MarkItDown 转换结果或人工复核。",
      "",
      "## Source metadata",
      "",
      `- source_id: ${sourceId}`,
      `- source_path: ${sourcePath}`,
      `- source_type: ${sourceType}`,
      ...(source.mime_type ? [`- mime_type: ${source.mime_type}`] : []),
      ...(source.size_bytes !== undefined ? [`- size_bytes: ${source.size_bytes}`] : []),
      ...metadataEntries.map(([key, value]) => `- ${key}: ${String(value)}`),
      "",
      "## Parse boundary",
      "",
      "- status: partial",
      "- parser: open_insight_builtin_metadata",
      "- message: 当前只保留来源元数据和追溯关系；未抽取正文。需要 MarkItDown、OCR 或原始文件复核后，才能把正文内容当作事实证据。",
      "- external_llm_instruction: 可以引用该文件存在、类型、大小和可追溯 ID；不得编造文件正文。"
    ];

    return `${lines.join("\n")}\n`;
  }

  const sampleHeaders = normalizedSampleHeaders(source);
  const semanticHintRows = buildFieldSemanticHintRows(columns);
  const lines = [
    `# Normalized source: ${source.name}`,
    "",
    "> 这是 Open Insight 本地生成的 normalized source，不是 raw source；它用于让 LLM 更高效读取，完整证据仍以 raw source / source map / digest 为准。",
    "",
    "## Source metadata",
    "",
    `- source_id: ${sourceId}`,
    `- source_path: ${sourcePath}`,
    `- source_type: ${sourceType}`,
    ...(source.mime_type ? [`- mime_type: ${source.mime_type}`] : []),
    ...(source.size_bytes !== undefined ? [`- size_bytes: ${source.size_bytes}`] : []),
    ...(source.row_count !== undefined ? [`- row_count: ${source.row_count}`] : []),
    "",
    "## Fields",
    "",
    columns.length > 0 ? markdownTable(["column", "type"], columns.map((column) => [column.name, column.type ?? "unknown"])) : "（没有字段画像）",
    "",
    "## Field semantic hints",
    "",
    semanticHintRows.length > 0 ? markdownTable(["column", "query_terms"], semanticHintRows) : "（没有字段语义提示）",
    "",
    "## Sample rows",
    "",
    sampleRows.length > 0 && sampleHeaders.length > 0
      ? markdownTable(
          sampleHeaders,
          sampleRows.slice(0, 10).map((row) => sampleHeaders.map((header) => row[header] ?? null))
        )
      : "（没有样例行）"
  ];

  return appendSpreadsheetFormulaEvidenceMarkdown(`${lines.join("\n")}\n`, source);
}

function appendSpreadsheetFormulaEvidenceMarkdown(content: string, source: DraftSource): string {
  const evidence = source.spreadsheet_formula_evidence;

  if (!evidence || evidence.status === "none") {
    return content;
  }

  const rows = evidence.cells.map((cell) => [
    cell.sheet_name,
    cell.cell_address,
    cell.formula,
    cell.formula_resolution_status ?? (cell.formula_type === "shared" && !cell.formula ? "unresolved_shared" : "resolved"),
    cell.cached_value_available ? cell.cached_value ?? "" : "（文件未提供缓存值）",
    cell.cached_value_raw ?? "",
    cell.cached_value_type ?? "unknown",
    "not_evaluated"
  ]);
  const boundary = [
    "",
    "## Spreadsheet formula evidence",
    "",
    "> Open Insight 从 XLSX 文件结构中只读提取公式证据；MarkItDown 仍负责可读表格转置。这里不重新计算公式，cached value 仅表示文件内已有缓存结果。",
    `> extraction_status: ${evidence.status}; formula_count: ${evidence.formula_count}; truncated: ${evidence.truncated}; extractor: ${evidence.extractor}`,
    "",
    evidence.message,
    ""
  ];

  if (rows.length > 0) {
    boundary.push(
      markdownTable(
        [
          "sheet",
          "cell",
          "formula",
          "formula_resolution_status",
          "cached_value",
          "cached_value_raw",
          "cached_value_type",
          "calculation_status"
        ],
        rows
      ),
      ""
    );
  }

  return `${content.trimEnd()}\n${boundary.join("\n")}`;
}

function buildFieldSemanticHintRows(columns: DraftSourceColumn[]): string[][] {
  return columns.map((column) => [column.name, fieldSemanticQueryTerms(column.name).join(" ")]);
}

function fieldSemanticQueryTerms(columnName: string): string[] {
  const normalized = columnName.toLowerCase().replace(/[\s-]+/g, "_");
  const terms: string[] = [];

  if (/(^|_)revenue($|_)|sales_amount|amount|gmv|turnover|income/.test(normalized)) {
    terms.push("收入", "营收", "销售额", "金额", "revenue", "sales amount");
  } else if (/order/.test(normalized)) {
    terms.push("订单", "订单数", "order");
  } else if (/region|province|city|area|location/.test(normalized)) {
    terms.push("区域", "地区", "城市", "region");
  } else if (/channel/.test(normalized)) {
    terms.push("渠道", "channel");
  } else if (/customer|client|account/.test(normalized)) {
    terms.push("客户", "客群", "customer");
  } else if (/margin|profit|gross/.test(normalized)) {
    terms.push("毛利", "利润", "margin", "profit");
  } else if (/date|time|month|quarter|year/.test(normalized)) {
    terms.push("日期", "时间", "月份", "季度", "date");
  } else if (/category|product|sku|item/.test(normalized)) {
    terms.push("品类", "产品", "商品", "category", "product");
  }

  terms.push(columnName);

  const readableLabel = formatColumnLabel(columnName);
  if (readableLabel && readableLabel !== columnName) {
    terms.push(readableLabel);
  }

  return Array.from(new Set(terms.filter((term) => term.trim().length > 0)));
}

function normalizedSampleHeaders(source: DraftSource): string[] {
  const columnHeaders = (source.columns ?? []).map((column) => column.name);

  if (columnHeaders.length > 0) {
    return columnHeaders;
  }

  const headers = new Set<string>();

  for (const row of source.sample_rows ?? []) {
    Object.keys(row).forEach((key) => headers.add(key));
  }

  return [...headers];
}

function buildParseDiagnostics(normalizedSources: NormalizedSourceFile[]): ParseDiagnosticRecord[] {
  return normalizedSources.map((normalizedSource) => {
    const source = normalizedSource.source;
    const parser = source.normalized_source;
    const metadataOnly = !parser && !isTabularDraftSource(source);

    return {
      diagnostic_id: `parse_${normalizedSource.source_id}`,
      source_id: normalizedSource.source_id,
      source_refs: [normalizedSource.source_id],
      lineage_refs: [normalizedSource.source_id],
      source_path: source.path ?? `sources/${source.name}`,
      source_type: source.type ?? inferSourceType(source.name),
      parser: parser?.parser ?? (metadataOnly ? "open_insight_builtin_metadata" : "open_insight_builtin_tabular"),
      ...(parser?.parser_version ? { parser_version: parser.parser_version } : {}),
      parser_role: parser?.parser_role ?? (metadataOnly ? "metadata_only_normalized_source" : "markitdown_compatible_normalized_source"),
      normalized_source_path: normalizedSource.path,
      cloud_used: parser?.cloud_used ?? false,
      status: parser?.status ?? (metadataOnly ? "partial" : "ok"),
      confidence: parser?.confidence ?? (metadataOnly ? 0.35 : 0.9),
      message:
        parser?.message ??
        (metadataOnly
          ? "当前只生成 metadata-only normalized source，未抽取正文；需要 MarkItDown、OCR 或原始文件复核后才能把正文内容当作事实证据。"
          : "已生成本地 normalized Markdown；Markdown 是 AI-ready 压缩层，不替代 raw source。"),
      ...(source.spreadsheet_formula_evidence
        ? {
            spreadsheet_formula_status: source.spreadsheet_formula_evidence.status,
            spreadsheet_formula_count: source.spreadsheet_formula_evidence.formula_count,
            spreadsheet_formula_truncated: source.spreadsheet_formula_evidence.truncated,
            spreadsheet_formula_extractor: source.spreadsheet_formula_evidence.extractor,
            ...(source.spreadsheet_formula_evidence.termination_reason
              ? {
                  spreadsheet_formula_termination_reason:
                    source.spreadsheet_formula_evidence.termination_reason
                }
              : {}),
            spreadsheet_formula_message: source.spreadsheet_formula_evidence.message
          }
        : {})
    };
  });
}

function buildSourceMapId(sourceId: string): string {
  return `source_map_${sourceId}`;
}

function sourcePathFor(normalizedSource: NormalizedSourceFile): string {
  return normalizedSource.source.path ?? `sources/${normalizedSource.source.name}`;
}

function countLines(value: string): number {
  return Math.max(1, value.split(/\r?\n/).length);
}

function findParseDiagnosticForSource(parseDiagnostics: ParseDiagnosticRecord[], sourceId: string): ParseDiagnosticRecord | undefined {
  return parseDiagnostics.find((diagnostic) => diagnostic.source_id === sourceId);
}

function buildSourceMapRecords(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[]
): SourceMapRecord[] {
  return normalizedSources.map((normalizedSource) => {
    const diagnostic = findParseDiagnosticForSource(parseDiagnostics, normalizedSource.source_id);
    const sourcePath = sourcePathFor(normalizedSource);

    return {
      schema_version: "open-insight.source-map.v0.1",
      source_map_id: buildSourceMapId(normalizedSource.source_id),
      object_id: `normalized_source.${normalizedSource.source_id}`,
      object_type: "normalized_source",
      source_id: normalizedSource.source_id,
      source_path: sourcePath,
      raw_source_path: sourcePath,
      normalized_source_path: normalizedSource.path,
      parse_diagnostic_id: diagnostic?.diagnostic_id ?? `parse_${normalizedSource.source_id}`,
      ranges: [
        {
          kind: "normalized_markdown_full",
          path: normalizedSource.path,
          start_line: 1,
          end_line: countLines(normalizedSource.content),
          confidence: diagnostic?.confidence ?? normalizedSource.source.normalized_source?.confidence ?? 0.9
        }
      ],
      provenance_status: "raw_source_bundled_or_external_ref"
    };
  });
}

function buildPageFurnitureRecords(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[],
  sourceMapRecords: SourceMapRecord[]
): PageFurnitureRecord[] {
  const diagnosticBySourceId = new Map(parseDiagnostics.map((diagnostic) => [diagnostic.source_id, diagnostic]));
  const sourceMapBySourceId = new Map(sourceMapRecords.map((record) => [record.source_id, record.source_map_id]));
  const records: PageFurnitureRecord[] = [];

  for (const normalizedSource of normalizedSources) {
    const lines = normalizedSource.content.split(/\r?\n/);
    const repeatedCounts = buildRepeatedLineCounts(lines);
    let artifactIndex = 0;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      const classification = classifyPageFurnitureLine(trimmed, repeatedCounts.get(normalizeFurnitureLine(trimmed)) ?? 0);

      if (!classification) {
        return;
      }

      if (artifactIndex >= PAGE_FURNITURE_RECORD_LIMIT_PER_SOURCE) {
        return;
      }

      artifactIndex += 1;
      const diagnostic = diagnosticBySourceId.get(normalizedSource.source_id);
      const sourceMapId = sourceMapBySourceId.get(normalizedSource.source_id) ?? buildSourceMapId(normalizedSource.source_id);

      records.push({
        schema_version: "open-insight.page-furniture.v0.1",
        artifact_id: `page_furniture_${normalizedSource.source_id}_${artifactIndex}`,
        source_id: normalizedSource.source_id,
        normalized_source_path: normalizedSource.path,
        kind: classification.kind,
        text: trimmed,
        line_numbers: [lineNumber],
        ...(classification.page_number !== undefined ? { page_number: classification.page_number } : {}),
        source_ref: normalizedSource.source_id,
        source_refs: [normalizedSource.source_id],
        lineage_refs: [normalizedSource.source_id],
        parse_diagnostic_ids: [diagnostic?.diagnostic_id ?? `parse_${normalizedSource.source_id}`],
        source_map_refs: [sourceMapId],
        confidence: classification.confidence,
        content_role: classification.content_role,
        render_policy: classification.render_policy
      });
    });
  }

  return records;
}

function buildSpreadsheetFormulaRecords(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[],
  sourceMapRecords: SourceMapRecord[]
): SpreadsheetFormulaRecord[] {
  const diagnosticBySourceId = new Map(parseDiagnostics.map((diagnostic) => [diagnostic.source_id, diagnostic]));
  const sourceMapBySourceId = new Map(sourceMapRecords.map((record) => [record.source_id, record.source_map_id]));
  const records: SpreadsheetFormulaRecord[] = [];

  for (const normalizedSource of normalizedSources) {
    const evidence = normalizedSource.source.spreadsheet_formula_evidence;

    if (!evidence || evidence.cells.length === 0) {
      continue;
    }

    const diagnosticId =
      diagnosticBySourceId.get(normalizedSource.source_id)?.diagnostic_id ?? `parse_${normalizedSource.source_id}`;
    const sourceMapId =
      sourceMapBySourceId.get(normalizedSource.source_id) ?? buildSourceMapId(normalizedSource.source_id);

    evidence.cells.forEach((cell, index) => {
      records.push({
        schema_version: "open-insight.spreadsheet-formula.v0.1",
        formula_id: `formula_${normalizedSource.source_id}_${index + 1}`,
        source_id: normalizedSource.source_id,
        source_path: sourcePathFor(normalizedSource),
        normalized_source_path: normalizedSource.path,
        sheet_name: cell.sheet_name,
        cell_address: cell.cell_address,
        formula: cell.formula,
        formula_type: cell.formula_type,
        formula_resolution_status:
          cell.formula_resolution_status ??
          (cell.formula_type === "shared" && !cell.formula ? "unresolved_shared" : "resolved"),
        cached_value_available: cell.cached_value_available,
        ...(cell.cached_value_available ? { cached_value: cell.cached_value ?? null } : {}),
        ...(cell.cached_value_raw !== undefined ? { cached_value_raw: cell.cached_value_raw } : {}),
        ...(cell.cached_value_type ? { cached_value_type: cell.cached_value_type } : {}),
        ...(cell.range_ref ? { range_ref: cell.range_ref } : {}),
        ...(cell.shared_index ? { shared_index: cell.shared_index } : {}),
        calculation_status: "not_evaluated",
        content_role: "spreadsheet_formula",
        source_refs: [normalizedSource.source_id],
        lineage_refs: [normalizedSource.source_id],
        parse_diagnostic_ids: [diagnosticId],
        source_map_refs: [sourceMapId]
      });
    });
  }

  return records;
}

function buildRepeatedLineCounts(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const line of lines) {
    const trimmed = line.trim();

    if (!isPotentialRepeatedFurnitureLine(trimmed)) {
      continue;
    }

    const key = normalizeFurnitureLine(trimmed);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function normalizeFurnitureLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

function isPotentialRepeatedFurnitureLine(line: string): boolean {
  if (!line || line.length > 120) {
    return false;
  }

  if (/^#{1,6}\s+/.test(line) || /^\|.*\|$/.test(line) || /^[-*+]\s+/.test(line)) {
    return false;
  }

  return true;
}

function classifyPageFurnitureLine(
  line: string,
  repeatedCount: number
):
  | {
      kind: PageFurnitureKind;
      page_number?: number;
      confidence: number;
      content_role: "page_furniture" | "disclaimer";
      render_policy: PageFurnitureRenderPolicy;
    }
  | undefined {
  if (!line || /^#{1,6}\s+/.test(line) || /^\|.*\|$/.test(line)) {
    return undefined;
  }

  const pageNumber = parsePageNumberLine(line);

  if (pageNumber !== undefined) {
    return {
      kind: "page_number",
      page_number: pageNumber,
      confidence: 0.92,
      content_role: "page_furniture",
      render_policy: "deemphasize_in_readable_html"
    };
  }

  if (/免责声明|法律声明|保密|机密|仅供|版权所有|confidential|disclaimer|copyright/i.test(line) && line.length <= 160) {
    return {
      kind: "legal_footer",
      confidence: 0.76,
      content_role: "disclaimer",
      render_policy: "review_required"
    };
  }

  if (/草稿|水印|draft|watermark/i.test(line) && line.length <= 80) {
    return {
      kind: "watermark",
      confidence: 0.74,
      content_role: "page_furniture",
      render_policy: "deemphasize_in_readable_html"
    };
  }

  if (repeatedCount >= 2 && isPotentialRepeatedFurnitureLine(line)) {
    return {
      kind: "running_header",
      confidence: 0.78,
      content_role: "page_furniture",
      render_policy: "deemphasize_in_readable_html"
    };
  }

  return undefined;
}

function parsePageNumberLine(line: string): number | undefined {
  const normalized = line.trim();
  const slashPageNumber = normalized.match(/^(\d{1,4})\s*\/\s*(\d{1,4})$/);

  if (slashPageNumber) {
    const value = Number(slashPageNumber[1]);
    const total = Number(slashPageNumber[2]);

    return Number.isInteger(value) && Number.isInteger(total) && value > 0 && total >= value ? value : undefined;
  }

  const match =
    normalized.match(/^[-–—]?\s*(\d{1,4})\s*[-–—]?$/) ??
    normalized.match(/^第\s*(\d{1,4})\s*页$/) ??
    normalized.match(/^page\s+(\d{1,4})(?:\s+of\s+\d{1,4})?$/i);

  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);

  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function pageFurnitureLineNumberSet(records: PageFurnitureRecord[], sourceId: string, roles: QueryIndexContentRole[] = ["page_furniture"]): Set<number> {
  const roleSet = new Set<QueryIndexContentRole>(roles);
  const lineNumbers = new Set<number>();

  for (const record of records) {
    if (record.source_id !== sourceId || !roleSet.has(record.content_role)) {
      continue;
    }

    for (const lineNumber of record.line_numbers) {
      lineNumbers.add(lineNumber);
    }
  }

  return lineNumbers;
}

function removePageFurnitureLines(content: string, records: PageFurnitureRecord[], sourceId: string): string {
  const hiddenLineNumbers = pageFurnitureLineNumberSet(records, sourceId, ["page_furniture"]);
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((_line, index) => !hiddenLineNumbers.has(index + 1));
  const text = filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return text.length > 0 ? `${text}\n` : content;
}

const SHA256_INITIAL_HASH: number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

const SHA256_K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotateRight32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Digest(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = [...SHA256_INITIAL_HASH];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const word15 = words[i - 15] ?? 0;
      const word2 = words[i - 2] ?? 0;
      const s0 = rotateRight32(word15, 7) ^ rotateRight32(word15, 18) ^ (word15 >>> 3);
      const s1 = rotateRight32(word2, 17) ^ rotateRight32(word2, 19) ^ (word2 >>> 10);
      words[i] = ((words[i - 16] ?? 0) + s0 + (words[i - 7] ?? 0) + s1) >>> 0;
    }

    let a = hash[0] ?? 0;
    let b = hash[1] ?? 0;
    let c = hash[2] ?? 0;
    let d = hash[3] ?? 0;
    let e = hash[4] ?? 0;
    let f = hash[5] ?? 0;
    let g = hash[6] ?? 0;
    let h = hash[7] ?? 0;
    for (let i = 0; i < 64; i += 1) {
      const sigma1 = rotateRight32(e, 6) ^ rotateRight32(e, 11) ^ rotateRight32(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + (SHA256_K[i] ?? 0) + (words[i] ?? 0)) >>> 0;
      const sigma0 = rotateRight32(a, 2) ^ rotateRight32(a, 13) ^ rotateRight32(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }

  return `sha256-${hash.map((word) => word.toString(16).padStart(8, "0")).join("")}`;
}

function buildRawSourceMetadataFingerprint(normalizedSource: NormalizedSourceFile): string {
  return JSON.stringify({
    source_id: normalizedSource.source_id,
    name: normalizedSource.source.name,
    path: normalizedSource.source.path,
    type: normalizedSource.source.type ?? inferSourceType(normalizedSource.source.name),
    size_bytes: normalizedSource.source.size_bytes,
    mime_type: normalizedSource.source.mime_type,
    row_count: normalizedSource.source.row_count,
    columns: normalizedSource.source.columns?.map((column) => ({ name: column.name, type: column.type }))
  });
}

function buildDigestLedger(
  normalizedSources: NormalizedSourceFile[],
  spreadsheetFormulaRecords: SpreadsheetFormulaRecord[] = []
): DigestLedger {
  const formulaJsonl = spreadsheetFormulaRecords.length > 0 ? jsonl(spreadsheetFormulaRecords) : undefined;
  return {
    schema_version: "open-insight.integrity-digests.v0.1",
    algorithm: "sha256",
    role: "integrity_fingerprint",
    source_of_truth:
      "Raw source is the primary evidence when bundled; normalized source and metadata digests are recheckable fingerprints.",
    entries: [
      ...normalizedSources.flatMap((normalizedSource) => {
        const sourcePath = sourcePathFor(normalizedSource);

        return [
          {
            digest_id: `digest_raw_metadata_${normalizedSource.source_id}`,
            target_type: "raw_source_metadata" as const,
            target_ref: normalizedSource.source_id,
            path: sourcePath,
            hash: sha256Digest(buildRawSourceMetadataFingerprint(normalizedSource)),
            verification_level: "metadata_fingerprint" as const,
            content_available_in_source_light: false
          },
          {
            digest_id: `digest_normalized_${normalizedSource.source_id}`,
            target_type: "normalized_source" as const,
            target_ref: `normalized_source.${normalizedSource.source_id}`,
            path: normalizedSource.path,
            hash: sha256Digest(normalizedSource.content),
            verification_level: "content_hash" as const,
            content_available_in_source_light: true
          }
        ];
      }),
      ...(formulaJsonl
        ? [
            {
              digest_id: "digest_spreadsheet_formulas",
              target_type: "spreadsheet_formula_evidence" as const,
              target_ref: "source/spreadsheet_formulas",
              path: "source/spreadsheet_formulas.jsonl",
              hash: sha256Digest(formulaJsonl),
              verification_level: "content_hash" as const,
              content_available_in_source_light: true
            }
          ]
        : [])
    ]
  };
}

function buildSourceInventory(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[],
  sourceMapRecords: SourceMapRecord[],
  digestLedger: DigestLedger
) {
  const diagnosticBySource = new Map(parseDiagnostics.map((diagnostic) => [diagnostic.source_id, diagnostic]));
  const sourceMapBySource = new Map(sourceMapRecords.map((record) => [record.source_id, record]));
  const digestEntriesByTarget = new Map(digestLedger.entries.map((entry) => [entry.target_ref, entry]));

  return {
    schema_version: "open-insight.source-inventory.v0.1",
    inventory_role: "source_and_normalized_context_inventory",
    source_mode_required: true,
    sources: normalizedSources.map((normalizedSource) => {
      const diagnostic = diagnosticBySource.get(normalizedSource.source_id);
      const sourceMap = sourceMapBySource.get(normalizedSource.source_id);

      return {
        source_id: normalizedSource.source_id,
        name: normalizedSource.source.name,
        type: normalizedSource.source.type ?? inferSourceType(normalizedSource.source.name),
        raw_source_path: sourcePathFor(normalizedSource),
        normalized_source_path: normalizedSource.path,
        normalized_role: "ai_readable_markdown",
        parse_diagnostic_id: diagnostic?.diagnostic_id ?? `parse_${normalizedSource.source_id}`,
        source_map_id: sourceMap?.source_map_id ?? buildSourceMapId(normalizedSource.source_id),
        digest_ids: [
          digestEntriesByTarget.get(normalizedSource.source_id)?.digest_id,
          digestEntriesByTarget.get(`normalized_source.${normalizedSource.source_id}`)?.digest_id
        ].filter((value): value is string => typeof value === "string"),
        parser: diagnostic?.parser ?? normalizedSource.source.normalized_source?.parser ?? "open_insight_builtin",
        cloud_used: diagnostic?.cloud_used ?? normalizedSource.source.normalized_source?.cloud_used ?? false,
        confidence: diagnostic?.confidence ?? normalizedSource.source.normalized_source?.confidence ?? 0.9,
        status: diagnostic?.status ?? "ok",
        ...(normalizedSource.source.size_bytes !== undefined ? { size_bytes: normalizedSource.source.size_bytes } : {}),
        ...(normalizedSource.source.mime_type ? { mime_type: normalizedSource.source.mime_type } : {}),
        ...(normalizedSource.source.row_count !== undefined ? { row_count: normalizedSource.source.row_count } : {}),
        field_count: normalizedSource.source.columns?.length ?? 0,
        ...(normalizedSource.source.spreadsheet_formula_evidence
          ? {
              spreadsheet_formula_path: "source/spreadsheet_formulas.jsonl",
              spreadsheet_formula_status: normalizedSource.source.spreadsheet_formula_evidence.status,
              spreadsheet_formula_count: normalizedSource.source.spreadsheet_formula_evidence.formula_count,
              spreadsheet_formula_truncated: normalizedSource.source.spreadsheet_formula_evidence.truncated,
              ...(normalizedSource.source.spreadsheet_formula_evidence.termination_reason
                ? {
                    spreadsheet_formula_termination_reason:
                      normalizedSource.source.spreadsheet_formula_evidence.termination_reason
                  }
                : {})
            }
          : {})
      };
    })
  };
}

function buildQueryIndexFiles(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[],
  sourceMapRecords: SourceMapRecord[],
  digestLedger: DigestLedger,
  pageFurnitureRecords: PageFurnitureRecord[],
  spreadsheetFormulaRecords: SpreadsheetFormulaRecord[]
): Record<string, string> {
  if (normalizedSources.length === 0) {
    return {};
  }

  const sourceRefs = normalizedSources.map((source) => source.source_id);
  const parseDiagnosticIds = parseDiagnostics.map((diagnostic) => diagnostic.diagnostic_id);
  const sourceMapRefs = sourceMapRecords.map((record) => record.source_map_id);
  const directChunks = buildQueryIndexDirectChunks(normalizedSources, parseDiagnostics, sourceMapRecords, pageFurnitureRecords);
  const queryIndexTruncated = directChunks.some((chunk) => chunk.query_index_truncated === true);
  writeQueryIndexBuildProgress(directChunks);
  const directIndexJsonl = buildQueryIndexJsonl(directChunks);
  const inlineRebuildSqlChunks = directIndexJsonl.length <= QUERY_INDEX_REBUILD_SQL_INLINE_CHAR_LIMIT;
  const manifest = {
    schema_version: "open-insight.query_index.v0.1",
    status: inlineRebuildSqlChunks ? "rebuild_sql" : "direct_index_jsonl",
    engine: "sqlite",
    fts: true,
    rebuildable: true,
    source_of_truth: false,
    index_role: "query_acceleration",
    database_path: "query_index/index.sqlite",
    database_available: false,
    rebuild_sql_path: "query_index/rebuild.sql",
    rebuild_sql_available: true,
    direct_index_path: "query_index/chunks.jsonl",
    direct_index_available: true,
    direct_index_format: "jsonl",
    query_index_truncated: queryIndexTruncated,
    query_index_source_budget: {
      text_char_budget_per_source: QUERY_INDEX_SOURCE_TEXT_CHAR_BUDGET,
      chunk_count_limit_per_source: QUERY_INDEX_SOURCE_CHUNK_COUNT_LIMIT,
      page_furniture_record_limit_per_source: PAGE_FURNITURE_RECORD_LIMIT_PER_SOURCE
    },
    tables: {
      sources: "context_sources",
      chunks: "context_chunks",
      tables: "context_tables",
      page_furniture: "context_page_furniture",
      spreadsheet_formulas: "context_spreadsheet_formulas",
      chunks_fts: "context_chunks_fts",
      parse_diagnostics: "context_parse_diagnostics",
      source_maps: "context_source_maps",
      digests: "context_digests"
    },
    provenance_tables: ["context_parse_diagnostics", "context_source_maps", "context_digests"],
    annotation_tables: ["context_page_furniture", "context_spreadsheet_formulas"],
    content_roles: ["body", "table", "heading", "page_furniture", "disclaimer", "source_overview"],
    page_furniture_path: "source/page_furniture.jsonl",
    page_furniture_available: pageFurnitureRecords.length > 0,
    page_furniture_count: pageFurnitureRecords.length,
    spreadsheet_formula_path: "source/spreadsheet_formulas.jsonl",
    spreadsheet_formula_available: spreadsheetFormulaRecords.length > 0,
    spreadsheet_formula_count: spreadsheetFormulaRecords.length,
    default_search_excludes_content_roles: ["page_furniture"],
    document_chunk_text_policy: {
      role: "document chunks are navigation previews; source/normalized/*.md remains the complete text source of truth",
      preview_char_limit: QUERY_INDEX_DOCUMENT_PREVIEW_CHAR_LIMIT
    },
    rebuild_sql_policy: {
      inline_chunk_rows: inlineRebuildSqlChunks,
      inline_char_limit: QUERY_INDEX_REBUILD_SQL_INLINE_CHAR_LIMIT,
      direct_index_path: "query_index/chunks.jsonl"
    },
    access_strategy: inlineRebuildSqlChunks ? "rebuild_sql" : "direct_index_jsonl",
    message: "当前包未内置二进制 SQLite 数据库；已提供 query_index/rebuild.sql，可由本地 CLI、MCP 或外部工具重建 SQLite/FTS 索引。",
    large_index_message: inlineRebuildSqlChunks
      ? undefined
      : "大包查询请优先使用 query_index/chunks.jsonl；完整正文仍在 source/normalized/*.md。",
    indexed_paths: normalizedSources.map((source) => source.path),
    source_refs: sourceRefs,
    lineage_refs: sourceRefs,
    parse_diagnostic_ids: parseDiagnosticIds,
    source_map_refs: sourceMapRefs
  };

  return {
    "query_index/manifest.json": json(manifest),
    "query_index/rebuild.sql": buildQueryIndexRebuildSql(
      normalizedSources,
      parseDiagnostics,
      sourceMapRecords,
      digestLedger,
      pageFurnitureRecords,
      spreadsheetFormulaRecords,
      directChunks,
      { inlineChunkRows: inlineRebuildSqlChunks }
    ),
    "query_index/chunks.jsonl": directIndexJsonl
  };
}

function writeQueryIndexBuildProgress(chunks: Array<Record<string, unknown>>): void {
  const raw = process.env.OPEN_INSIGHT_PROGRESS ?? "";
  if (raw !== "1" && raw.toLowerCase() !== "true") {
    return;
  }

  process.stderr.write(`[open-insight compile] query_index ${summarizeQueryIndexChunks(chunks)}\n`);
}

function buildQueryIndexJsonl(chunks: Array<Record<string, unknown>>): string {
  try {
    return jsonl(chunks);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`query_index/chunks.jsonl build failed: ${reason}; ${summarizeQueryIndexChunks(chunks)}`);
  }
}

function summarizeQueryIndexChunks(chunks: Array<Record<string, unknown>>): string {
  const byLevel = new Map<string, number>();
  let textChars = 0;

  for (const chunk of chunks) {
    const level = typeof chunk.chunk_level === "string" ? chunk.chunk_level : "unknown";
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
    if (typeof chunk.text === "string") {
      textChars += chunk.text.length;
    }
  }

  const levelSummary = Array.from(byLevel.entries())
    .map(([level, count]) => `${level}=${count}`)
    .join(", ");

  return `chunks=${chunks.length}; text_chars=${textChars}; ${levelSummary}`;
}

function buildQueryIndexDirectChunks(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[],
  sourceMapRecords: SourceMapRecord[],
  pageFurnitureRecords: PageFurnitureRecord[]
) {
  const diagnosticBySourceId = new Map(parseDiagnostics.map((diagnostic) => [diagnostic.source_id, diagnostic]));
  const sourceMapBySourceId = new Map(sourceMapRecords.map((record) => [record.source_id, record.source_map_id]));
  const chunks: Array<Record<string, unknown>> = [];

  for (const normalizedSource of normalizedSources) {
    const source = normalizedSource.source;
    const diagnostic = diagnosticBySourceId.get(normalizedSource.source_id);
    const parseDiagnosticId = diagnostic?.diagnostic_id ?? `parse_${normalizedSource.source_id}`;
    const sourceMapId = sourceMapBySourceId.get(normalizedSource.source_id) ?? buildSourceMapId(normalizedSource.source_id);
    const recordsForSource = pageFurnitureRecords.filter((record) => record.source_id === normalizedSource.source_id);
    const text = removePageFurnitureLines(normalizedSource.content, recordsForSource, normalizedSource.source_id);
    const baseChunk = {
      schema_version: "open-insight.query_index.chunk.v0.1",
      source_id: normalizedSource.source_id,
      source_path: source.path ?? `sources/${source.name}`,
      source_type: source.type ?? inferSourceType(source.name),
      normalized_source_path: normalizedSource.path,
      normalized_source_retains_page_furniture: recordsForSource.length > 0,
      page_furniture_count: recordsForSource.length,
      field_count: source.columns?.length ?? 0,
      ...(source.row_count !== undefined ? { row_count: source.row_count } : {}),
      source_refs: [normalizedSource.source_id],
      lineage_refs: [normalizedSource.source_id],
      parse_diagnostic_ids: [parseDiagnosticId],
      source_map_refs: [sourceMapId]
    };
    const estimatedTokens = estimateTokenCount(text);
    const documentText = buildQueryIndexDocumentPreview(text);
    const documentTextTruncated = documentText.length < text.length;
    const sourceChunks: Array<Record<string, unknown>> = [];

    sourceChunks.push({
      ...baseChunk,
      chunk_id: `source_overview.${normalizedSource.source_id}`,
      title: source.name,
      text: buildSourceOverviewChunkText(normalizedSource, parseDiagnosticId, text),
      chunk_level: "source_overview",
      heading_path: [],
      content_role: "source_overview",
      render_policy: "query_source_overview",
      char_count: source.name.length,
      estimated_tokens: estimateTokenCount(source.name),
      read_units_estimate: estimateTokenCount(source.name)
    });

    sourceChunks.push({
      ...baseChunk,
      chunk_id: `normalized_source.${normalizedSource.source_id}`,
      title: normalizedSource.path,
      text: documentText,
      chunk_level: "document",
      heading_path: [],
      content_role: "body",
      render_policy: recordsForSource.length > 0 ? "document_without_page_furniture" : "normalized_source_document",
      char_count: text.length,
      indexed_char_count: documentText.length,
      ...(documentTextTruncated
        ? {
            text_truncated: true,
            truncation_policy: "document_preview_only",
            full_text_ref: `normalized_source.${normalizedSource.source_id}`,
            full_text_available_path: normalizedSource.path
          }
        : {}),
      estimated_tokens: estimatedTokens,
      read_units_estimate: estimatedTokens
    });
    sourceChunks.push(...buildGranularQueryChunks(normalizedSource, text, baseChunk));
    chunks.push(...capQueryIndexChunksForSource(sourceChunks, normalizedSource.path));
  }

  return addQueryIndexChunkAddresses(chunks);
}

function addQueryIndexChunkAddresses(chunks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const chunksBySourceId = new Map<string, Array<Record<string, unknown>>>();

  for (const chunk of chunks) {
    const sourceId = typeof chunk.source_id === "string" ? chunk.source_id : "unknown";
    const sourceChunks = chunksBySourceId.get(sourceId) ?? [];
    sourceChunks.push(chunk);
    chunksBySourceId.set(sourceId, sourceChunks);
  }

  return chunks.map((chunk) => {
    const sourceId = typeof chunk.source_id === "string" ? chunk.source_id : "unknown";
    const sourceChunks = chunksBySourceId.get(sourceId) ?? [];
    const index = sourceChunks.indexOf(chunk);
    const previous = index > 0 ? sourceChunks[index - 1] : undefined;
    const next = index >= 0 && index < sourceChunks.length - 1 ? sourceChunks[index + 1] : undefined;
    const documentChunk = sourceChunks.find((candidate) => candidate.chunk_level === "document");
    const chunkId = String(chunk.chunk_id);
    const documentChunkId = typeof documentChunk?.chunk_id === "string" ? documentChunk.chunk_id : undefined;

    return {
      ...chunk,
      read_order: index >= 0 ? index + 1 : undefined,
      ...(typeof previous?.chunk_id === "string" ? { prev_chunk_id: previous.chunk_id } : {}),
      ...(typeof next?.chunk_id === "string" ? { next_chunk_id: next.chunk_id } : {}),
      ...(documentChunkId && documentChunkId !== chunkId ? { parent_chunk_id: documentChunkId } : {})
    };
  });
}

function buildQueryIndexDocumentPreview(text: string): string {
  if (text.length <= QUERY_INDEX_DOCUMENT_PREVIEW_CHAR_LIMIT) {
    return text;
  }

  const candidate = text.slice(0, QUERY_INDEX_DOCUMENT_PREVIEW_CHAR_LIMIT);
  const lastParagraphBreak = Math.max(candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\r\n\r\n"));

  if (lastParagraphBreak >= Math.floor(QUERY_INDEX_DOCUMENT_PREVIEW_CHAR_LIMIT * 0.65)) {
    return candidate.slice(0, lastParagraphBreak).trimEnd();
  }

  const lastLineBreak = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf("\r\n"));

  if (lastLineBreak >= Math.floor(QUERY_INDEX_DOCUMENT_PREVIEW_CHAR_LIMIT * 0.8)) {
    return candidate.slice(0, lastLineBreak).trimEnd();
  }

  return candidate.trimEnd();
}

function buildSourceOverviewChunkText(normalizedSource: NormalizedSourceFile, parseDiagnosticId: string, text: string): string {
  const preview = buildQueryIndexDocumentPreview(text).slice(0, 1_200).trim();
  return [
    `Source: ${normalizedSource.source.name}`,
    `Normalized source path: ${normalizedSource.path}`,
    `Source type: ${normalizedSource.source.type ?? inferSourceType(normalizedSource.source.name)}`,
    `Parse diagnostic: ${parseDiagnosticId}`,
    `Estimated tokens: ${estimateTokenCount(text)}`,
    ...(preview ? ["", "Opening preview:", preview] : []),
    "Use this overview to choose the source, then read paragraph/table chunks or the full normalized source when more context is required."
  ].join("\n");
}

function capQueryIndexChunksForSource(chunks: Array<Record<string, unknown>>, normalizedSourcePath: string): Array<Record<string, unknown>> {
  const kept: Array<Record<string, unknown>> = [];
  let textChars = 0;
  let truncated = false;

  for (const chunk of chunks) {
    const text = typeof chunk.text === "string" ? chunk.text : "";
    const isAlwaysKept = chunk.chunk_level === "source_overview" || chunk.chunk_level === "document";

    if (
      !isAlwaysKept &&
      (kept.length >= QUERY_INDEX_SOURCE_CHUNK_COUNT_LIMIT || textChars + text.length > QUERY_INDEX_SOURCE_TEXT_CHAR_BUDGET)
    ) {
      truncated = true;
      continue;
    }

    kept.push(chunk);
    textChars += text.length;
  }

  if (!truncated) {
    return kept;
  }

  return kept.map((chunk) => {
    if (chunk.chunk_level !== "source_overview") {
      return chunk;
    }

    const currentText = typeof chunk.text === "string" ? chunk.text : "";

    return {
      ...chunk,
      text: [
        currentText,
        "",
        `Query index note: this source index was capped at ${QUERY_INDEX_SOURCE_TEXT_CHAR_BUDGET} characters / ${QUERY_INDEX_SOURCE_CHUNK_COUNT_LIMIT} chunks. Full normalized text remains available at ${normalizedSourcePath}.`
      ].join("\n"),
      query_index_truncated: true,
      truncation_policy: "query_index_source_budget",
      full_text_available_path: normalizedSourcePath
    };
  });
}

function estimateTokenCount(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const otherChars = Math.max(0, text.length - cjkChars);

  return Math.max(1, Math.ceil(cjkChars * 0.8 + otherChars / 4));
}

function buildGranularQueryChunks(
  normalizedSource: NormalizedSourceFile,
  text: string,
  baseChunk: Record<string, unknown>
): Array<Record<string, unknown>> {
  const blocks = splitNormalizedSourceIntoBlocks(text);
  const chunks: Array<Record<string, unknown>> = [];
  const paragraphBuffer: QueryIndexTextBlock[] = [];

  let sectionIndex = 0;
  let paragraphIndex = 0;
  let tableIndex = 0;

  const flushParagraphs = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }

    const grouped = splitTextBlocksBySize(paragraphBuffer, QUERY_INDEX_PARAGRAPH_CHUNK_CHAR_LIMIT);

    for (const group of grouped) {
      const combinedText = group.map((block) => block.text).join("\n\n").trim();

      if (!combinedText) {
        continue;
      }

      paragraphIndex += 1;
      chunks.push(buildGranularQueryChunk(baseChunk, {
        chunk_id: `paragraph.${normalizedSource.source_id}.${paragraphIndex}`,
        title: chooseGranularChunkTitle(group[0], normalizedSource.path),
        text: combinedText,
        chunk_level: "paragraph",
        content_role: "body",
        heading_path: group[0]?.headingPath ?? [],
        line_numbers: flattenLineNumbers(group)
      }));
    }

    paragraphBuffer.length = 0;
  };

  for (const block of blocks) {
    if (block.kind === "heading") {
      flushParagraphs();
      sectionIndex += 1;
      chunks.push(buildGranularQueryChunk(baseChunk, {
        chunk_id: `section.${normalizedSource.source_id}.${sectionIndex}`,
        title: block.text,
        text: buildSectionChunkText(block),
        chunk_level: "section",
        content_role: "heading",
        heading_path: block.headingPath,
        line_numbers: block.lineNumbers
      }));
      continue;
    }

    if (block.kind === "table") {
      flushParagraphs();
      const tableParts = splitLongTextBySize(block.text, QUERY_INDEX_TABLE_CHUNK_CHAR_LIMIT);

      for (const tableText of tableParts) {
        tableIndex += 1;
        chunks.push(buildGranularQueryChunk(baseChunk, {
          chunk_id: `table.${normalizedSource.source_id}.${tableIndex}`,
          title: chooseGranularChunkTitle(block, normalizedSource.path),
          text: tableText,
          chunk_level: "table",
          content_role: "table",
          heading_path: block.headingPath,
          line_numbers: block.lineNumbers
        }));
      }
      continue;
    }

    paragraphBuffer.push(block);
  }

  flushParagraphs();

  return chunks;
}

interface QueryIndexTextBlock {
  kind: "heading" | "paragraph" | "table";
  text: string;
  headingPath: string[];
  lineNumbers: number[];
}

function splitNormalizedSourceIntoBlocks(text: string): QueryIndexTextBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: QueryIndexTextBlock[] = [];
  const headingStack: string[] = [];
  let paragraphLines: string[] = [];
  let paragraphLineNumbers: number[] = [];
  let tableLines: string[] = [];
  let tableLineNumbers: number[] = [];

  const flushParagraph = () => {
    const paragraphText = paragraphLines.join("\n").trim();

    if (paragraphText) {
      blocks.push({
        kind: "paragraph",
        text: paragraphText,
        headingPath: [...headingStack],
        lineNumbers: paragraphLineNumbers
      });
    }

    paragraphLines = [];
    paragraphLineNumbers = [];
  };
  const flushTable = () => {
    const tableText = tableLines.join("\n").trim();

    if (tableText) {
      blocks.push({
        kind: "table",
        text: tableText,
        headingPath: [...headingStack],
        lineNumbers: tableLineNumbers
      });
    }

    tableLines = [];
    tableLineNumbers = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      flushTable();
      flushParagraph();
      return;
    }

    const heading = parseNormalizedHeading(trimmed);

    if (heading) {
      flushTable();
      flushParagraph();
      headingStack.splice(Math.max(0, heading.level - 1));
      headingStack[heading.level - 1] = heading.text;
      blocks.push({
        kind: "heading",
        text: heading.text,
        headingPath: headingStack.filter(Boolean),
        lineNumbers: [lineNumber]
      });
      return;
    }

    if (looksLikeMarkdownTableLine(trimmed)) {
      flushParagraph();
      tableLines.push(line);
      tableLineNumbers.push(lineNumber);
      return;
    }

    flushTable();
    paragraphLines.push(line);
    paragraphLineNumbers.push(lineNumber);
  });

  flushTable();
  flushParagraph();

  return blocks;
}

function parseNormalizedHeading(line: string): { level: number; text: string } | undefined {
  const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);

  if (markdownHeading) {
    const marker = markdownHeading[1];
    const text = markdownHeading[2];

    if (marker && text) {
      return { level: marker.length, text: text.trim() };
    }
  }

  const chineseHeading = line.match(/^(第[一二三四五六七八九十百千万\d]+[章节篇部分][、.\s]?.+|[一二三四五六七八九十]+[、.]\s?.+|（[一二三四五六七八九十\d]+）\s?.+)$/);

  if (chineseHeading && line.length <= 80) {
    return { level: line.startsWith("（") ? 3 : 2, text: line.trim() };
  }

  return undefined;
}

function looksLikeMarkdownTableLine(line: string): boolean {
  if (line.includes("|") && (line.match(/\|/g)?.length ?? 0) >= 2) {
    return true;
  }

  if (/^\s*[-:| ]{3,}\s*$/.test(line)) {
    return true;
  }

  return false;
}

function splitTextBlocksBySize(blocks: QueryIndexTextBlock[], maxChars: number): QueryIndexTextBlock[][] {
  const groups: QueryIndexTextBlock[][] = [];
  let current: QueryIndexTextBlock[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const blockLength = block.text.length;

    if (blockLength > maxChars) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
        currentLength = 0;
      }

      for (const part of splitLongTextBySize(block.text, maxChars)) {
        groups.push([{ ...block, text: part }]);
      }
      continue;
    }

    if (current.length > 0 && currentLength + blockLength > maxChars) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(block);
    currentLength += blockLength;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function splitLongTextBySize(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + maxChars);
    const candidate = text.slice(start, hardEnd);
    const paragraphBreak = candidate.lastIndexOf("\n\n");
    const lineBreak = candidate.lastIndexOf("\n");
    const splitAt = paragraphBreak >= Math.floor(maxChars * 0.45)
      ? paragraphBreak + 2
      : lineBreak >= Math.floor(maxChars * 0.6)
        ? lineBreak + 1
        : candidate.length;
    const end = start + Math.max(1, splitAt);
    const part = text.slice(start, end).trim();

    if (part) {
      parts.push(part);
    }

    start = end;
  }

  return parts.length > 0 ? parts : [text.slice(0, maxChars).trim()];
}

function buildGranularQueryChunk(
  baseChunk: Record<string, unknown>,
  input: {
    chunk_id: string;
    title: string;
    text: string;
    chunk_level: QueryIndexChunkLevel;
    content_role: QueryIndexContentRole;
    heading_path: string[];
    line_numbers: number[];
  }
): Record<string, unknown> {
  const estimatedTokens = estimateTokenCount(input.text);

  return {
    ...baseChunk,
    chunk_id: input.chunk_id,
    title: input.title,
    text: input.text,
    chunk_level: input.chunk_level,
    heading_path: input.heading_path,
    content_role: input.content_role,
    render_policy: input.chunk_level === "table" ? "query_table_chunk" : "query_text_chunk",
    line_numbers: input.line_numbers,
    char_count: input.text.length,
    estimated_tokens: estimatedTokens,
    read_units_estimate: estimatedTokens
  };
}

function chooseGranularChunkTitle(block: QueryIndexTextBlock | undefined, fallback: string): string {
  if (!block) {
    return fallback;
  }

  const heading = block.headingPath.at(-1);

  if (heading) {
    return heading;
  }

  return block.text.split(/\r?\n/)[0]?.trim().slice(0, 80) || fallback;
}

function buildSectionChunkText(headingBlock: QueryIndexTextBlock): string {
  const path = headingBlock.headingPath.filter(Boolean);
  if (path.length <= 1) {
    return headingBlock.text;
  }

  return `${headingBlock.text}\n\nHeading path: ${path.join(" > ")}`;
}

function flattenLineNumbers(blocks: QueryIndexTextBlock[]): number[] {
  return Array.from(new Set(blocks.flatMap((block) => block.lineNumbers))).sort((left, right) => left - right);
}

function buildQueryIndexRebuildSql(
  normalizedSources: NormalizedSourceFile[],
  parseDiagnostics: ParseDiagnosticRecord[],
  sourceMapRecords: SourceMapRecord[],
  digestLedger: DigestLedger,
  pageFurnitureRecords: PageFurnitureRecord[],
  spreadsheetFormulaRecords: SpreadsheetFormulaRecord[],
  directChunks: Array<Record<string, unknown>>,
  options: { inlineChunkRows: boolean }
): string {
  const diagnosticBySourceId = new Map(parseDiagnostics.map((diagnostic) => [diagnostic.source_id, diagnostic]));
  const lines = [
    "-- Open Insight rebuildable SQLite/FTS query index.",
    "-- This index accelerates LLM/Agent reads and is not the package source of truth.",
    "BEGIN;",
    "DROP TABLE IF EXISTS context_digests;",
    "DROP TABLE IF EXISTS context_source_maps;",
    "DROP TABLE IF EXISTS context_parse_diagnostics;",
    "DROP TABLE IF EXISTS context_sources;",
    "DROP TABLE IF EXISTS context_chunks;",
    "DROP TABLE IF EXISTS context_page_furniture;",
    "DROP TABLE IF EXISTS context_spreadsheet_formulas;",
    "DROP TABLE IF EXISTS context_tables;",
    "DROP TABLE IF EXISTS context_chunks_fts;",
    "CREATE TABLE context_sources (source_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_type TEXT NOT NULL, normalized_source_path TEXT NOT NULL, parse_diagnostic_id TEXT NOT NULL);",
    "CREATE TABLE context_chunks (chunk_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, chunk_level TEXT NOT NULL DEFAULT 'document', heading_path_json TEXT NOT NULL DEFAULT '[]', content_role TEXT NOT NULL DEFAULT 'body', render_policy TEXT, page_furniture_kind TEXT, page_number INTEGER, line_numbers_json TEXT NOT NULL DEFAULT '[]', read_order INTEGER, prev_chunk_id TEXT, next_chunk_id TEXT, parent_chunk_id TEXT, estimated_tokens INTEGER NOT NULL DEFAULT 1, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL, parse_diagnostic_ids TEXT NOT NULL, source_map_refs TEXT NOT NULL);",
    "CREATE TABLE context_page_furniture (artifact_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, normalized_source_path TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, line_numbers_json TEXT NOT NULL, page_number INTEGER, content_role TEXT NOT NULL, render_policy TEXT NOT NULL, confidence REAL, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL, parse_diagnostic_ids TEXT NOT NULL, source_map_refs TEXT NOT NULL);",
    "CREATE TABLE context_spreadsheet_formulas (formula_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_path TEXT NOT NULL, normalized_source_path TEXT NOT NULL, sheet_name TEXT NOT NULL, cell_address TEXT NOT NULL, formula TEXT NOT NULL, formula_type TEXT NOT NULL, formula_resolution_status TEXT NOT NULL, cached_value_available INTEGER NOT NULL, cached_value_json TEXT, cached_value_raw TEXT, cached_value_type TEXT, range_ref TEXT, shared_index TEXT, calculation_status TEXT NOT NULL, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL, parse_diagnostic_ids TEXT NOT NULL, source_map_refs TEXT NOT NULL);",
    "CREATE TABLE context_tables (table_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, field_count INTEGER NOT NULL, row_count INTEGER, parse_diagnostic_ids TEXT NOT NULL);",
    "CREATE TABLE context_parse_diagnostics (diagnostic_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, parser TEXT NOT NULL, parser_version TEXT, parser_role TEXT NOT NULL, normalized_source_path TEXT NOT NULL, status TEXT NOT NULL, confidence REAL, cloud_used INTEGER NOT NULL, message TEXT NOT NULL, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL);",
    "CREATE TABLE context_source_maps (source_map_id TEXT PRIMARY KEY, object_id TEXT NOT NULL, object_type TEXT NOT NULL, source_id TEXT NOT NULL, source_path TEXT NOT NULL, raw_source_path TEXT NOT NULL, normalized_source_path TEXT NOT NULL, parse_diagnostic_id TEXT NOT NULL, ranges_json TEXT NOT NULL, provenance_status TEXT NOT NULL);",
    "CREATE TABLE context_digests (digest_id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_ref TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, verification_level TEXT NOT NULL, content_available_in_source_light INTEGER NOT NULL);",
    "CREATE INDEX context_sources_parse_diagnostic_id_idx ON context_sources(parse_diagnostic_id);",
    "CREATE INDEX context_chunks_source_id_idx ON context_chunks(source_id);",
    "CREATE INDEX context_chunks_source_read_order_idx ON context_chunks(source_id, read_order);",
    "CREATE INDEX context_chunks_chunk_level_idx ON context_chunks(chunk_level);",
    "CREATE INDEX context_chunks_content_role_idx ON context_chunks(content_role);",
    "CREATE INDEX context_page_furniture_source_id_idx ON context_page_furniture(source_id);",
    "CREATE INDEX context_page_furniture_kind_idx ON context_page_furniture(kind);",
    "CREATE INDEX context_spreadsheet_formulas_source_id_idx ON context_spreadsheet_formulas(source_id);",
    "CREATE INDEX context_spreadsheet_formulas_sheet_cell_idx ON context_spreadsheet_formulas(sheet_name, cell_address);",
    "CREATE INDEX context_parse_diagnostics_source_id_idx ON context_parse_diagnostics(source_id);",
    "CREATE INDEX context_source_maps_source_id_idx ON context_source_maps(source_id);",
    "CREATE INDEX context_source_maps_parse_diagnostic_id_idx ON context_source_maps(parse_diagnostic_id);",
    "CREATE INDEX context_digests_target_ref_idx ON context_digests(target_ref);",
    "CREATE VIRTUAL TABLE context_chunks_fts USING fts4(chunk_id, title, text, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs);"
  ];

  for (const diagnostic of parseDiagnostics) {
    lines.push(
      `INSERT INTO context_parse_diagnostics (diagnostic_id, source_id, parser, parser_version, parser_role, normalized_source_path, status, confidence, cloud_used, message, source_refs, lineage_refs) VALUES (${sqlString(diagnostic.diagnostic_id)}, ${sqlString(diagnostic.source_id)}, ${sqlString(diagnostic.parser)}, ${sqlStringOrNull(diagnostic.parser_version)}, ${sqlString(diagnostic.parser_role)}, ${sqlString(diagnostic.normalized_source_path)}, ${sqlString(diagnostic.status)}, ${sqlNumberOrNull(diagnostic.confidence)}, ${diagnostic.cloud_used ? 1 : 0}, ${sqlString(diagnostic.message)}, ${sqlString(jsonCompact(diagnostic.source_refs))}, ${sqlString(jsonCompact(diagnostic.lineage_refs))});`
    );
  }

  for (const sourceMap of sourceMapRecords) {
    lines.push(
      `INSERT INTO context_source_maps (source_map_id, object_id, object_type, source_id, source_path, raw_source_path, normalized_source_path, parse_diagnostic_id, ranges_json, provenance_status) VALUES (${sqlString(sourceMap.source_map_id)}, ${sqlString(sourceMap.object_id)}, ${sqlString(sourceMap.object_type)}, ${sqlString(sourceMap.source_id)}, ${sqlString(sourceMap.source_path)}, ${sqlString(sourceMap.raw_source_path)}, ${sqlString(sourceMap.normalized_source_path)}, ${sqlString(sourceMap.parse_diagnostic_id)}, ${sqlString(jsonCompact(sourceMap.ranges))}, ${sqlString(sourceMap.provenance_status)});`
    );
  }

  for (const digest of digestLedger.entries) {
    lines.push(
      `INSERT INTO context_digests (digest_id, target_type, target_ref, path, hash, verification_level, content_available_in_source_light) VALUES (${sqlString(digest.digest_id)}, ${sqlString(digest.target_type)}, ${sqlString(digest.target_ref)}, ${sqlString(digest.path)}, ${sqlString(digest.hash)}, ${sqlString(digest.verification_level)}, ${digest.content_available_in_source_light ? 1 : 0});`
    );
  }

  for (const record of pageFurnitureRecords) {
    lines.push(
      `INSERT INTO context_page_furniture (artifact_id, source_id, normalized_source_path, kind, text, line_numbers_json, page_number, content_role, render_policy, confidence, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (${sqlString(record.artifact_id)}, ${sqlString(record.source_id)}, ${sqlString(record.normalized_source_path)}, ${sqlString(record.kind)}, ${sqlString(record.text)}, ${sqlString(jsonCompact(record.line_numbers))}, ${sqlNumberOrNull(record.page_number)}, ${sqlString(record.content_role)}, ${sqlString(record.render_policy)}, ${sqlNumberOrNull(record.confidence)}, ${sqlString(jsonCompact(record.source_refs))}, ${sqlString(jsonCompact(record.lineage_refs))}, ${sqlString(jsonCompact(record.parse_diagnostic_ids))}, ${sqlString(jsonCompact(record.source_map_refs))});`
    );
  }

  for (const record of spreadsheetFormulaRecords) {
    lines.push(
      `INSERT INTO context_spreadsheet_formulas (formula_id, source_id, source_path, normalized_source_path, sheet_name, cell_address, formula, formula_type, formula_resolution_status, cached_value_available, cached_value_json, cached_value_raw, cached_value_type, range_ref, shared_index, calculation_status, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (${sqlString(record.formula_id)}, ${sqlString(record.source_id)}, ${sqlString(record.source_path)}, ${sqlString(record.normalized_source_path)}, ${sqlString(record.sheet_name)}, ${sqlString(record.cell_address)}, ${sqlString(record.formula)}, ${sqlString(record.formula_type)}, ${sqlString(record.formula_resolution_status)}, ${record.cached_value_available ? 1 : 0}, ${record.cached_value_available ? sqlString(jsonCompact(record.cached_value ?? null)) : "NULL"}, ${sqlStringOrNull(record.cached_value_raw)}, ${sqlStringOrNull(record.cached_value_type)}, ${sqlStringOrNull(record.range_ref)}, ${sqlStringOrNull(record.shared_index)}, ${sqlString(record.calculation_status)}, ${sqlString(jsonCompact(record.source_refs))}, ${sqlString(jsonCompact(record.lineage_refs))}, ${sqlString(jsonCompact(record.parse_diagnostic_ids))}, ${sqlString(jsonCompact(record.source_map_refs))});`
    );
  }

  for (const normalizedSource of normalizedSources) {
    const source = normalizedSource.source;
    const diagnostic = diagnosticBySourceId.get(normalizedSource.source_id);
    const parseDiagnosticId = diagnostic?.diagnostic_id ?? `parse_${normalizedSource.source_id}`;
    const sourcePath = source.path ?? `sources/${source.name}`;
    const sourceType = source.type ?? inferSourceType(source.name);
    const parseDiagnosticIds = jsonCompact([parseDiagnosticId]);

    lines.push(
      `INSERT INTO context_sources (source_id, source_path, source_type, normalized_source_path, parse_diagnostic_id) VALUES (${sqlString(normalizedSource.source_id)}, ${sqlString(sourcePath)}, ${sqlString(sourceType)}, ${sqlString(normalizedSource.path)}, ${sqlString(parseDiagnosticId)});`,
      `INSERT INTO context_tables (table_id, source_id, field_count, row_count, parse_diagnostic_ids) VALUES (${sqlString(normalizedSource.source_id)}, ${sqlString(normalizedSource.source_id)}, ${source.columns?.length ?? 0}, ${source.row_count ?? "NULL"}, ${sqlString(parseDiagnosticIds)});`
    );
  }

  if (options.inlineChunkRows) {
    for (const chunk of directChunks) {
      const sourceRefs = jsonCompact((chunk.source_refs as string[] | undefined) ?? []);
      const lineageRefs = jsonCompact((chunk.lineage_refs as string[] | undefined) ?? []);
      const parseDiagnosticIds = jsonCompact((chunk.parse_diagnostic_ids as string[] | undefined) ?? []);
      const sourceMapRefs = jsonCompact((chunk.source_map_refs as string[] | undefined) ?? []);

      lines.push(
        `INSERT INTO context_chunks (chunk_id, source_id, title, text, chunk_level, heading_path_json, content_role, render_policy, page_furniture_kind, page_number, line_numbers_json, read_order, prev_chunk_id, next_chunk_id, parent_chunk_id, estimated_tokens, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (${sqlString(String(chunk.chunk_id))}, ${sqlString(String(chunk.source_id))}, ${sqlString(String(chunk.title))}, ${sqlString(String(chunk.text))}, ${sqlString(typeof chunk.chunk_level === "string" ? chunk.chunk_level : "document")}, ${sqlString(jsonCompact(Array.isArray(chunk.heading_path) ? chunk.heading_path : []))}, ${sqlString(String(chunk.content_role ?? "body"))}, ${sqlStringOrNull(typeof chunk.render_policy === "string" ? chunk.render_policy : undefined)}, ${sqlStringOrNull(typeof chunk.page_furniture_kind === "string" ? chunk.page_furniture_kind : undefined)}, ${sqlNumberOrNull(typeof chunk.page_number === "number" ? chunk.page_number : undefined)}, ${sqlString(jsonCompact(Array.isArray(chunk.line_numbers) ? chunk.line_numbers : []))}, ${sqlNumberOrNull(typeof chunk.read_order === "number" ? chunk.read_order : undefined)}, ${sqlStringOrNull(typeof chunk.prev_chunk_id === "string" ? chunk.prev_chunk_id : undefined)}, ${sqlStringOrNull(typeof chunk.next_chunk_id === "string" ? chunk.next_chunk_id : undefined)}, ${sqlStringOrNull(typeof chunk.parent_chunk_id === "string" ? chunk.parent_chunk_id : undefined)}, ${sqlNumberOrNull(typeof chunk.estimated_tokens === "number" ? chunk.estimated_tokens : typeof chunk.read_units_estimate === "number" ? chunk.read_units_estimate : undefined)}, ${sqlString(sourceRefs)}, ${sqlString(lineageRefs)}, ${sqlString(parseDiagnosticIds)}, ${sqlString(sourceMapRefs)});`,
        `INSERT INTO context_chunks_fts (chunk_id, title, text, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (${sqlString(String(chunk.chunk_id))}, ${sqlString(String(chunk.title))}, ${sqlString(String(chunk.text))}, ${sqlString(sourceRefs)}, ${sqlString(lineageRefs)}, ${sqlString(parseDiagnosticIds)}, ${sqlString(sourceMapRefs)});`
      );
    }
  } else {
    lines.push(
      "-- Chunk rows are intentionally omitted for large packages.",
      "-- Rebuild SQLite/FTS from query_index/chunks.jsonl to avoid duplicating large normalized text inside rebuild.sql."
    );
  }

  lines.push("COMMIT;", "");

  return lines.join("\n");
}

function sqlStringOrNull(value: string | undefined): string {
  return value === undefined ? "NULL" : sqlString(value);
}

function sqlNumberOrNull(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "NULL" : String(value);
}

function markdownTable(headers: string[], rows: Array<Array<unknown>>): string {
  const headerLine = `| ${headers.map(escapeMarkdownTableCell).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`);

  return [headerLine, separatorLine, ...rowLines].join("\n");
}

function escapeMarkdownTableCell(value: unknown): string {
  return stringifyMarkdownTableCell(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function stringifyMarkdownTableCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function buildMetricSuggestions(sources: DraftSource[], domainPack?: DomainPack): DraftMetricSuggestion[] {
  return sources.flatMap((source, sourceIndex) => {
    const datasetId = datasetIdForSource(source, sourceIndex);
    const columns = source.columns ?? [];
    const domainSuggestions = (domainPack?.metric_blueprints ?? [])
      .map((blueprint) => buildDomainMetricSuggestion(source, datasetId, columns, blueprint))
      .filter((metric): metric is DraftMetricSuggestion => metric !== undefined);
    const domainSourceColumns = new Set(
      domainSuggestions.flatMap((metric) => metric.source_columns ?? [metric.source_column]).map(normalizeColumnMatch).filter(Boolean)
    );
    const sourceProfileSuggestions = columns
      .map((column): DraftMetricSuggestion | undefined => {
        if (!canSuggestSourceProfileMetric(column) || domainSourceColumns.has(normalizeColumnMatch(column.name))) {
          return undefined;
        }

        return {
          metric_id: `metric_${datasetId}_${idTokenForColumn(column.name)}`,
          name: `合计 ${formatColumnLabel(column.name)}`,
          definition: `根据 ${source.name} 的 ${column.name} 字段自动建议合计指标。`,
          formula: `SUM(${column.name})`,
          dataset_id: datasetId,
          source_column: column.name,
          status: "suggested" as const,
          origin: "source_profile" as const,
          aggregation: "sum" as const
        };
      })
      .filter((metric): metric is DraftMetricSuggestion => metric !== undefined);

    return [...domainSuggestions, ...sourceProfileSuggestions];
  });
}

function buildDomainMetricSuggestion(
  source: DraftSource,
  datasetId: string,
  columns: DraftSourceColumn[],
  blueprint: DomainPackMetricBlueprint
): DraftMetricSuggestion | undefined {
  const aggregation = resolveMetricAggregation(blueprint);

  if (aggregation === "ratio") {
    return buildRatioMetricSuggestion(source, datasetId, columns, blueprint);
  }

  const roleSuggestion = buildRoleMappedMetricSuggestion(source, datasetId, columns, blueprint, aggregation);

  if (roleSuggestion) {
    return roleSuggestion;
  }

  const match = findMetricBlueprintColumnMatch(columns, blueprint.preferred_columns);
  const formula = match ? buildBlueprintFormula(aggregation, match.column) : undefined;

  if (!match || !formula) {
    return undefined;
  }

  const sourceColumns = [match.column.name];

  return {
    metric_id: buildDomainMetricId(blueprint, datasetId, sourceColumns),
    name: blueprint.name,
    definition: buildDomainMetricDefinition(blueprint, source.name, sourceColumns),
    formula,
    dataset_id: datasetId,
    source_column: match.column.name,
    source_columns: sourceColumns,
    status: "suggested",
    origin: "domain_blueprint",
    aggregation,
    blueprint_id: blueprint.metric_id,
    matched_preferred_column: match.preferredColumn,
    ...(blueprint.evidence_requirement ? { evidence_requirement: blueprint.evidence_requirement } : {})
  };
}

interface MetricBlueprintColumnMatch {
  column: DraftSourceColumn;
  preferredColumn: string;
}

interface MetricBlueprintFieldRoleMatch extends MetricBlueprintColumnMatch {
  roleMapping: DomainPackMetricFieldRoleMapping;
}

function buildRoleMappedMetricSuggestion(
  source: DraftSource,
  datasetId: string,
  columns: DraftSourceColumn[],
  blueprint: DomainPackMetricBlueprint,
  fallbackAggregation: DomainPackMetricAggregation
): DraftMetricSuggestion | undefined {
  const roleMatch = findMetricBlueprintFieldRoleMatch(columns, blueprint.field_roles ?? [], ["summary_value", "detail_value", "entity_id"]);

  if (!roleMatch) {
    return undefined;
  }

  const aggregation = roleMatch.roleMapping.aggregation ?? fallbackAggregation;
  const formula = buildFieldRoleFormula(roleMatch.roleMapping.role, aggregation, roleMatch.column);

  if (!formula) {
    return undefined;
  }

  const sourceColumns = [roleMatch.column.name];
  const sourceFieldRoles = [roleMatch.roleMapping.role];

  return {
    metric_id: buildDomainMetricId(blueprint, datasetId, sourceColumns),
    name: blueprint.name,
    definition: buildDomainMetricDefinition(blueprint, source.name, sourceColumns, sourceFieldRoles),
    formula,
    dataset_id: datasetId,
    source_column: roleMatch.column.name,
    source_columns: sourceColumns,
    status: "suggested",
    origin: "domain_blueprint",
    aggregation,
    blueprint_id: blueprint.metric_id,
    matched_preferred_column: roleMatch.preferredColumn,
    field_role: roleMatch.roleMapping.role,
    source_field_roles: sourceFieldRoles,
    ...(blueprint.evidence_requirement ? { evidence_requirement: blueprint.evidence_requirement } : {})
  };
}

function buildRatioMetricSuggestion(
  source: DraftSource,
  datasetId: string,
  columns: DraftSourceColumn[],
  blueprint: DomainPackMetricBlueprint
): DraftMetricSuggestion | undefined {
  const directRoleMatch = findMetricBlueprintFieldRoleMatch(columns, blueprint.field_roles ?? [], ["ratio_value"], { allowPartial: false });
  const directMatch = directRoleMatch ?? findMetricBlueprintColumnMatch(columns, blueprint.preferred_columns, { allowPartial: false });

  if (directMatch && isNumericColumnType(directMatch.column.type)) {
    const sourceColumns = [directMatch.column.name];
    const sourceFieldRoles: DomainPackMetricFieldRole[] = ["ratio_value"];

    return {
      metric_id: buildDomainMetricId(blueprint, datasetId, sourceColumns),
      name: blueprint.name,
      definition: buildDomainMetricDefinition(blueprint, source.name, sourceColumns, sourceFieldRoles),
      formula: `LATEST_VALUE(${directMatch.column.name})`,
      dataset_id: datasetId,
      source_column: directMatch.column.name,
      source_columns: sourceColumns,
      status: "suggested",
      origin: "domain_blueprint",
      aggregation: "ratio",
      blueprint_id: blueprint.metric_id,
      matched_preferred_column: directMatch.preferredColumn,
      field_role: "ratio_value",
      source_field_roles: sourceFieldRoles,
      ...(blueprint.evidence_requirement ? { evidence_requirement: blueprint.evidence_requirement } : {})
    };
  }

  const numeratorRoleMatch = findMetricBlueprintFieldRoleMatch(columns, blueprint.field_roles ?? [], ["numerator"]);
  const denominatorRoleMatch = findMetricBlueprintFieldRoleMatch(columns, blueprint.field_roles ?? [], ["denominator"]);
  const numeratorMatch = numeratorRoleMatch ?? findMetricBlueprintColumnMatch(columns, blueprint.numerator_columns ?? [], { allowPartial: false });
  const denominatorMatch = denominatorRoleMatch ?? findMetricBlueprintColumnMatch(columns, blueprint.denominator_columns ?? [], { allowPartial: false });

  if (!numeratorMatch || !denominatorMatch) {
    return undefined;
  }

  const numeratorFormula = buildRatioOperandFormula(numeratorMatch.column);
  const denominatorFormula = buildRatioOperandFormula(denominatorMatch.column);

  if (!numeratorFormula || !denominatorFormula) {
    return undefined;
  }

  const sourceColumns = [numeratorMatch.column.name, denominatorMatch.column.name];
  const sourceFieldRoles: DomainPackMetricFieldRole[] = ["numerator", "denominator"];

  return {
    metric_id: buildDomainMetricId(blueprint, datasetId, sourceColumns),
    name: blueprint.name,
    definition: buildDomainMetricDefinition(blueprint, source.name, sourceColumns, sourceFieldRoles),
    formula: `SAFE_DIVIDE(${numeratorFormula}, ${denominatorFormula})`,
    dataset_id: datasetId,
    source_column: numeratorMatch.column.name,
    source_columns: sourceColumns,
    status: "suggested",
    origin: "domain_blueprint",
    aggregation: "ratio",
    blueprint_id: blueprint.metric_id,
    matched_preferred_column: `${numeratorMatch.preferredColumn}/${denominatorMatch.preferredColumn}`,
    source_field_roles: sourceFieldRoles,
    ...(blueprint.evidence_requirement ? { evidence_requirement: blueprint.evidence_requirement } : {})
  };
}

function findMetricBlueprintColumnMatch(
  columns: DraftSourceColumn[],
  preferredColumns: string[],
  options: { allowPartial?: boolean } = {}
): MetricBlueprintColumnMatch | undefined {
  for (const preferredColumn of preferredColumns) {
    for (const column of columns) {
      if (isMetricBlueprintColumnMatch(column.name, preferredColumn, options.allowPartial ?? true)) {
        return { column, preferredColumn };
      }
    }
  }

  return undefined;
}

function findMetricBlueprintFieldRoleMatch(
  columns: DraftSourceColumn[],
  fieldRoles: DomainPackMetricFieldRoleMapping[],
  roles: DomainPackMetricFieldRole[],
  options: { allowPartial?: boolean } = {}
): MetricBlueprintFieldRoleMatch | undefined {
  const allowedRoles = new Set(roles);

  for (const roleMapping of fieldRoles) {
    if (!allowedRoles.has(roleMapping.role)) {
      continue;
    }

    const match = findMetricBlueprintColumnMatch(columns, roleMapping.preferred_columns, { allowPartial: options.allowPartial ?? false });

    if (match) {
      return { ...match, roleMapping };
    }
  }

  return undefined;
}

function isMetricBlueprintColumnMatch(columnName: string, preferredColumn: string, allowPartial: boolean): boolean {
  const normalizedColumnName = normalizeColumnMatch(columnName);
  const normalizedPreferredColumn = normalizeColumnMatch(preferredColumn);

  if (!normalizedColumnName || !normalizedPreferredColumn) {
    return false;
  }

  return (
    normalizedColumnName === normalizedPreferredColumn ||
    (allowPartial && isSafePartialColumnMatch(normalizedColumnName, normalizedPreferredColumn))
  );
}

function resolveMetricAggregation(blueprint: DomainPackMetricBlueprint): DomainPackMetricAggregation {
  return blueprint.aggregation ?? (isCountMetricBlueprint(blueprint) ? "count" : "sum");
}

function buildBlueprintFormula(aggregation: DomainPackMetricAggregation, column: DraftSourceColumn): string | undefined {
  if (aggregation === "sum") {
    return isNumericColumnType(column.type) ? `SUM(${column.name})` : undefined;
  }

  if (aggregation === "count") {
    return isNumericColumnType(column.type) ? `SUM(${column.name})` : `COUNT_DISTINCT(${column.name})`;
  }

  if (aggregation === "latest_value") {
    return `LATEST_VALUE(${column.name})`;
  }

  return undefined;
}

function buildFieldRoleFormula(
  role: DomainPackMetricFieldRole,
  aggregation: DomainPackMetricAggregation,
  column: DraftSourceColumn
): string | undefined {
  if (role === "entity_id" && aggregation === "count") {
    return `COUNT_DISTINCT(${column.name})`;
  }

  if (role === "ratio_value") {
    return isNumericColumnType(column.type) ? `LATEST_VALUE(${column.name})` : undefined;
  }

  return buildBlueprintFormula(aggregation, column);
}

function buildRatioOperandFormula(column: DraftSourceColumn): string | undefined {
  if (isNumericColumnType(column.type)) {
    return `SUM(${column.name})`;
  }

  if (isDimensionColumnType(column.type)) {
    return `COUNT_DISTINCT(${column.name})`;
  }

  return undefined;
}

function buildDomainMetricId(blueprint: DomainPackMetricBlueprint, datasetId: string, sourceColumns: string[]): string {
  const sourceToken = sourceColumns.map(idTokenForColumn).join("_");

  return `metric_${slugify(blueprint.metric_id) || "domain_metric"}_${datasetId}_${sourceToken}`;
}

function buildDomainMetricDefinition(
  blueprint: DomainPackMetricBlueprint,
  sourceName: string,
  sourceColumns: string[],
  sourceFieldRoles: DomainPackMetricFieldRole[] = []
): string {
  const roleText = sourceFieldRoles.length > 0 ? `；字段角色：${sourceFieldRoles.map(formatDomainMetricFieldRole).join(" + ")}` : "";
  const sourceText = `${sourceColumns.join(" + ")}${roleText}`;
  const evidenceText = blueprint.evidence_requirement ? ` 证据要求：${blueprint.evidence_requirement}` : "";

  return `${blueprint.definition} 来源字段：${sourceName} / ${sourceText}。${evidenceText}`;
}

function formatDomainMetricFieldRole(role: DomainPackMetricFieldRole): string {
  const labels: Record<DomainPackMetricFieldRole, string> = {
    denominator: "分母",
    detail_value: "明细值",
    entity_id: "实体 ID",
    numerator: "分子",
    ratio_value: "已有比率",
    summary_value: "汇总值"
  };

  return labels[role];
}

function isCountMetricBlueprint(blueprint: DomainPackMetricBlueprint): boolean {
  const englishText = `${blueprint.metric_id} ${blueprint.definition}`.toLowerCase();

  return englishText.includes("count") || blueprint.name.includes("数") || blueprint.definition.includes("数量");
}

function normalizeColumnMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()[\]{}（）【】,，。:：;；]+/g, "");
}

function isSafePartialColumnMatch(normalizedColumnName: string, normalizedPreferredColumn: string): boolean {
  const minimumColumnLength = /[a-z0-9]/.test(normalizedColumnName) ? 3 : 2;

  return (
    normalizedColumnName.length >= minimumColumnLength &&
    normalizedPreferredColumn.length >= minimumColumnLength &&
    (normalizedColumnName.includes(normalizedPreferredColumn) || normalizedPreferredColumn.includes(normalizedColumnName))
  );
}

function idTokenForColumn(value: string): string {
  const slug = slugify(value);

  if (slug) {
    return slug;
  }

  return `col_${stableHash(value)}`;
}

function stableHash(value: string): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }

  return hash.toString(36);
}

function buildViewSuggestions(sources: DraftSource[], metrics: DraftMetricSuggestion[]): DraftViewSuggestion[] {
  const suggestions: DraftViewSuggestion[] = [];

  sources.forEach((source, sourceIndex) => {
    const datasetId = datasetIdForSource(source, sourceIndex);
    const dimensionColumn = (source.columns ?? []).find((column) => isDimensionColumnType(column.type));
    const sourceMetrics = metrics.filter((metric) => metric.dataset_id === datasetId && canBuildSampleChart(metric));

    if (!dimensionColumn || !source.sample_rows?.length) {
      return;
    }

    for (const metric of sourceMetrics.slice(0, 3)) {
      const values = aggregateSampleRows(source.sample_rows, dimensionColumn.name, metric.source_column);

      if (values.length === 0) {
        continue;
      }

      suggestions.push({
        block_id: `block_chart_${datasetId}_${idTokenForColumn(metric.source_column)}_by_${idTokenForColumn(dimensionColumn.name)}`,
        type: "bar_chart",
        title: `按 ${formatColumnLabel(dimensionColumn.name)} 汇总 ${formatColumnLabel(metric.source_column)}`,
        metric_id: metric.metric_id,
        evidence_id: `ev_chart_${datasetId}_${idTokenForColumn(metric.source_column)}_by_${idTokenForColumn(dimensionColumn.name)}`,
        dataset_id: datasetId,
        dimension_column: dimensionColumn.name,
        value_column: metric.source_column,
        values,
        status: "suggested"
      });
    }
  });

  return suggestions.slice(0, 8);
}

function canBuildSampleChart(metric: DraftMetricSuggestion): boolean {
  return metric.aggregation === "sum" || metric.aggregation === "count";
}

function aggregateSampleRows(
  sampleRows: DraftSourceSampleRow[],
  dimensionColumn: string,
  valueColumn: string
): Array<Record<string, string | number>> {
  const groupedValues = new Map<string, number>();

  for (const row of sampleRows) {
    const rawLabel = row[dimensionColumn];
    const rawValue = row[valueColumn];
    const label = typeof rawLabel === "string" ? rawLabel.trim() : rawLabel === undefined || rawLabel === null ? "" : String(rawLabel);
    const value = toFiniteNumber(rawValue);

    if (!label || value === undefined) {
      continue;
    }

    groupedValues.set(label, (groupedValues.get(label) ?? 0) + value);
  }

  return [...groupedValues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({
      [dimensionColumn]: label,
      [valueColumn]: Number(value.toFixed(4))
    }));
}

function toFiniteNumber(value: DraftSourceSampleValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/[$,%\s]/g, "");
  const numberValue = Number(normalized);

  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isNumericColumnType(type: string | undefined): boolean {
  return type === "number" || type === "integer" || type === "currency" || type === "percent";
}

function isAggregatableDraftSourceColumnType(type: string | undefined): boolean {
  return type === "number" || type === "integer" || type === "currency";
}

function canSuggestSourceProfileMetric(column: DraftSourceColumn): boolean {
  if (!isNumericColumnType(column.type) || column.type === "percent") {
    return false;
  }

  const normalizedName = normalizeColumnMatch(column.name);

  if (!normalizedName) {
    return false;
  }

  const blockedTokens = [
    "average",
    "avg",
    "flag",
    "max",
    "min",
    "pct",
    "percent",
    "percentage",
    "rate",
    "ratio",
    "score",
    "上限",
    "下限",
    "平均",
    "得分",
    "最大",
    "最小",
    "比例",
    "比率",
    "满分",
    "评分"
  ];

  return !blockedTokens.some((token) => normalizedName.includes(token));
}

function isDimensionColumnType(type: string | undefined): boolean {
  return type === "string" || type === "date" || type === "boolean";
}

function isTabularDraftSource(source: DraftSource): boolean {
  const type = source.type?.toLowerCase();

  return type === "csv" || type === "tsv" || type === "xlsx" || (source.columns?.length ?? 0) > 0;
}

function formatColumnLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function datasetIdForQuestion(question: DraftQuestion, datasets: Array<{ dataset_id: string }>, fallback: string): string {
  if (!question.source_name) {
    return fallback;
  }

  const dataset = datasets.find((item) => item.dataset_id.includes(slugify(question.source_name ?? "")));
  return dataset?.dataset_id ?? fallback;
}

function datasetIdForSource(source: DraftSource, index: number): string {
  return `source_${index + 1}_${slugify(source.name) || "asset"}`;
}

function normalizeDraftSource(source: DraftSourceInput): DraftSource {
  if (typeof source === "string") {
    return {
      name: source,
      path: `sources/${source}`,
      type: inferSourceType(source)
    };
  }

  return {
    name: source.name,
    path: source.path ?? `sources/${source.name}`,
    type: source.type ?? inferSourceType(source.name),
    ...(source.size_bytes !== undefined ? { size_bytes: source.size_bytes } : {}),
    ...(source.mime_type ? { mime_type: source.mime_type } : {}),
    ...(source.row_count !== undefined ? { row_count: source.row_count } : {}),
    ...(source.columns ? { columns: source.columns } : {}),
    ...(source.sample_rows ? { sample_rows: source.sample_rows } : {}),
    ...(source.metadata ? { metadata: source.metadata } : {}),
    ...(source.normalized_source ? { normalized_source: source.normalized_source } : {}),
    ...(source.spreadsheet_formula_evidence
      ? { spreadsheet_formula_evidence: source.spreadsheet_formula_evidence }
      : {})
  };
}

function inferSourceType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (!extension || extension === fileName.toLowerCase()) {
    return "unknown";
  }

  return extension;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== undefined);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function jsonCompact(value: unknown): string {
  return JSON.stringify(value);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + (values.length > 0 ? "\n" : "");
}

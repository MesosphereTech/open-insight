import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import {
  INSIGHT_SPEC_VERSION,
  listPackageFiles,
  packInsightDirectory,
  readJsonFile,
  readManifest,
  unpackInsightArchive
} from "@open-insight/core";
import {
  analyzeSourceBytes,
  compileInsightDraft,
  type DraftSource,
  type DraftSourceColumn,
  type DraftSourceNormalizedSource,
  type DraftSpreadsheetFormulaCell,
  type DraftSpreadsheetFormulaEvidence
} from "@open-insight/compiler";
import { DOMAIN_PACKS, getDomainPack, type DomainPack, type DomainPackId } from "@open-insight/domain-packs";
import {
  answerWithGroundedModel,
  answerWithPreparedContext,
  buildContextUserMaterialContract,
  recommendContextOutputs,
  createOpenAICompatibleModelAdapterFromEnv,
  listOpenAICompatibleModelsFromEnv,
  listContextDiagnostics,
  listContextObjects,
  listContextSources,
  MockModelAdapter,
  queryContextTable,
  resolveOpenAICompatibleModelConfigFromEnv,
  resolveOpenAICompatibleModelEndpointConfigFromEnv,
  resolveContextSource,
  summarizeContextPackage,
  type AnswerEvidenceSourceTrace,
  type ContextChunkSearchResult,
  type ContextDiagnosticsResult,
  type ContextObjectKind,
  type ContextObjectsResult,
  type ContextUserMaterialContractResult,
  type ContextOutputRecommendationsResult,
  type ContextSourceResolveResult,
  type ContextSourcesResult,
  type ContextSummaryResult,
  type ContextTableQueryResult,
  type DataRequestRecord,
  type DeterministicAnswerResult,
  type FetchLike,
  type GroundedModelErrorCode,
  type GroundedModelAnswerResult,
  type OpenAICompatibleModelConfigResolution
} from "@open-insight/runtime";
import type { SchemaInspectionResult, ValidationIssue, ValidationResult } from "@open-insight/validator";
import { inspectSchemaRoot, validateInsightPackage } from "@open-insight/validator";
import { addOverlayNote, type AddOverlayNoteResult, type OverlayTargetType } from "./overlayNote.js";
import { addOverlayQa, type AddOverlayQaResult } from "./overlayQa.js";
import { importOverlayFollowup, type ImportOverlayFollowupResult } from "./overlayFollowup.js";
import { loadLocalEnvFile } from "./localEnv.js";
import { exportDataRequestPackage, type ExportDataRequestPackageResult } from "./requestExport.js";
import { createDataResponsePackage, type CreateDataResponsePackageResult } from "./responseCreate.js";
import { mergeDataResponsePackage, type MergeDataResponsePackageResult } from "./responseMerge.js";
import { summarizeDataResponsePackage, type DataResponseMergeSummary, type ResponseCompatibilityIssue } from "./responseSummary.js";
import { applyReviewPatch, reviewPatch, type ApplyReviewPatchResult, type ReviewPatchDecision, type ReviewPatchResult } from "./reviewPatch.js";
import {
  buildContextAnswerContextForCli,
  buildContextHandoffForCli,
  evaluateContextTokensForCli,
  normalizeExternalBaselineSummary,
  type ExternalBaselineSummary,
  type ExternalBaselineSourceFilter,
  searchContextChunksForCli,
  type ContextAnswerContextResult,
  type ContextCompactRetrievalResult,
  type ContextHandoffResult,
  type ContextTokenEvalResult
} from "./contextSearch.js";
import { readVersionLog, readVersionStatus, type VersionLogResult, type VersionParentsFile, type VersionRefsFile, type VersionStatusResult } from "./versionGraph.js";

export interface CliResult {
  exitCode: number;
  output: string;
}

export interface RunCliOptions {
  loadEnv?: boolean;
  modelFetch?: FetchLike;
  markitdownConvert?: MarkitdownConvert;
  spreadsheetFormulaExtract?: SpreadsheetFormulaExtract;
}

export type CompileOcrMode = "off" | "llm";

export interface MarkitdownConvertInput {
  inputPath: string;
  sourceName: string;
  timeoutMs?: number;
  ocrMode?: CompileOcrMode;
}

export interface MarkitdownConvertResult {
  markdown: string;
  parser_version?: string;
  ocr_plugin_version?: string;
  ocr_model?: string;
  ocr_used?: boolean;
  cloud_used?: boolean;
}

export type MarkitdownConvert = (input: MarkitdownConvertInput) => Promise<MarkitdownConvertResult>;

export interface SpreadsheetFormulaExtractInput {
  inputPath: string;
  sourceName: string;
  timeoutMs: number;
  maxFormulas: number;
  maxOutputBytes: number;
  maxWorksheetXmlBytes: number;
  maxZipEntries: number;
  maxTotalXmlBytes: number;
}

export type SpreadsheetFormulaExtract = (
  input: SpreadsheetFormulaExtractInput
) => Promise<DraftSpreadsheetFormulaEvidence>;

const COMPILE_SQLITE_INDEX_MAX_JSONL_BYTES = 1_500_000;

interface InspectPackageSummary {
  schema_version: "open-insight.inspect-summary.v0.1";
  package_id: string;
  title: string;
  spec_version: string;
  package_type: string;
  required_capabilities: string[];
  optional_capabilities: string[];
  counts: {
    datasets: number;
    metrics: number;
    entities: number;
    view_blocks: number;
    claims: number;
    evidence: number;
    prepared_questions: number;
    data_requests: number;
    lineage_sources: number;
  };
  files: {
    total: number;
    source_assets: number;
    executable_like: number;
  };
  validation: {
    status: string;
    errors: number;
    warnings: number;
    issue_codes: Record<string, number>;
  };
  fallbacks: Record<string, string>;
}

type AskModelMode = "auto" | "deterministic" | "mock" | "real";

const MODEL_STATUS_SCHEMA_VERSION = "open-insight.model-status.v0.1" as const;
const MODEL_LIST_SCHEMA_VERSION = "open-insight.model-list.v0.1" as const;
const MODEL_PING_SCHEMA_VERSION = "open-insight.model-ping.v0.1" as const;
const MODEL_SMOKE_SCHEMA_VERSION = "open-insight.model-smoke.v0.1" as const;
const REQUEST_EXPORT_SCHEMA_VERSION = "open-insight.request-export.v0.1" as const;
const RESPONSE_CREATE_SCHEMA_VERSION = "open-insight.response-create.v0.1" as const;
const RESPONSE_SUMMARY_SCHEMA_VERSION = "open-insight.response-summary.v0.1" as const;
const RESPONSE_MERGE_SCHEMA_VERSION = "open-insight.response-merge.v0.1" as const;
const REVIEW_PATCH_SCHEMA_VERSION = "open-insight.review-patch.v0.1" as const;
const APPLY_REVIEW_PATCH_SCHEMA_VERSION = "open-insight.apply-review-patch.v0.1" as const;
const OVERLAY_NOTE_SCHEMA_VERSION = "open-insight.overlay-note.v0.1" as const;
const OVERLAY_FOLLOWUP_IMPORT_SCHEMA_VERSION = "open-insight.overlay-followup-import.v0.1" as const;
const OVERLAY_QA_SAVE_SCHEMA_VERSION = "open-insight.overlay-qa-save.v0.1" as const;
const COMPILE_DRAFT_SCHEMA_VERSION = "open-insight.compile-draft.v0.1" as const;
const COMPILE_PACK_SCHEMA_VERSION = "open-insight.compile-pack.v0.2" as const;
const SOURCE_MODE_SCHEMA_VERSION = "open-insight.source-mode.v0.1" as const;
const DOMAIN_LIST_SCHEMA_VERSION = "open-insight.domain-list.v0.1" as const;
const PACK_SCHEMA_VERSION = "open-insight.pack.v0.1" as const;
const UNPACK_SCHEMA_VERSION = "open-insight.unpack.v0.1" as const;
const CONTEXT_SUMMARY_SCHEMA_VERSION = "open-insight.context-summary.v0.1" as const;
const CONTEXT_SOURCES_SCHEMA_VERSION = "open-insight.context-sources.v0.1" as const;
const CONTEXT_OBJECTS_SCHEMA_VERSION = "open-insight.context-objects.v0.1" as const;
const CONTEXT_TABLE_QUERY_SCHEMA_VERSION = "open-insight.context-table-query.v0.1" as const;
const CONTEXT_CHUNK_SEARCH_SCHEMA_VERSION = "open-insight.context-chunk-search.v0.1" as const;
const CONTEXT_COMPACT_RETRIEVAL_SCHEMA_VERSION = "open-insight.context-compact-retrieval.v0.1" as const;
const CONTEXT_TOKEN_EVAL_SCHEMA_VERSION = "open-insight.context-token-eval.v0.1" as const;
const CONTEXT_HANDOFF_SCHEMA_VERSION = "open-insight.context-handoff.v0.1" as const;
const CONTEXT_ANSWER_CONTEXT_SCHEMA_VERSION = "open-insight.answer-context.v0.1" as const;
const CONTEXT_SOURCE_RESOLVE_SCHEMA_VERSION = "open-insight.context-source-resolve.v0.1" as const;
const CONTEXT_DIAGNOSTICS_SCHEMA_VERSION = "open-insight.context-diagnostics.v0.1" as const;
const CONTEXT_USER_MATERIAL_CONTRACT_SCHEMA_VERSION = "open-insight.user-material-contract.v0.1" as const;
const CONTEXT_OUTPUT_RECOMMENDATIONS_SCHEMA_VERSION = "open-insight.context-output-recommendations.v0.1" as const;
const VERSION_DERIVE_SCHEMA_VERSION = "open-insight.version-derive.v0.1" as const;
const VERSION_ROLLBACK_SCHEMA_VERSION = "open-insight.version-rollback.v0.1" as const;
const VERSION_MERGE_SCHEMA_VERSION = "open-insight.version-merge.v0.1" as const;

type ContextCliResult =
  | ({ schema_version: typeof CONTEXT_SUMMARY_SCHEMA_VERSION } & ContextSummaryResult)
  | ({ schema_version: typeof CONTEXT_SOURCES_SCHEMA_VERSION } & ContextSourcesResult)
  | ({ schema_version: typeof CONTEXT_OBJECTS_SCHEMA_VERSION } & ContextObjectsResult)
  | ({ schema_version: typeof CONTEXT_TABLE_QUERY_SCHEMA_VERSION } & ContextTableQueryResult)
  | ({ schema_version: typeof CONTEXT_CHUNK_SEARCH_SCHEMA_VERSION } & ContextChunkSearchResult)
  | ({ schema_version: typeof CONTEXT_COMPACT_RETRIEVAL_SCHEMA_VERSION } & ContextCompactRetrievalResult)
  | ({ schema_version: typeof CONTEXT_TOKEN_EVAL_SCHEMA_VERSION } & ContextTokenEvalResult)
  | ({ schema_version: typeof CONTEXT_HANDOFF_SCHEMA_VERSION } & ContextHandoffResult)
  | ({ schema_version: typeof CONTEXT_ANSWER_CONTEXT_SCHEMA_VERSION } & ContextAnswerContextResult)
  | ({ schema_version: typeof CONTEXT_SOURCE_RESOLVE_SCHEMA_VERSION } & ContextSourceResolveResult)
  | ({ schema_version: typeof CONTEXT_DIAGNOSTICS_SCHEMA_VERSION } & ContextDiagnosticsResult)
  | ({ schema_version: typeof CONTEXT_USER_MATERIAL_CONTRACT_SCHEMA_VERSION } & ContextUserMaterialContractResult)
  | ({ schema_version: typeof CONTEXT_OUTPUT_RECOMMENDATIONS_SCHEMA_VERSION } & ContextOutputRecommendationsResult);

type ContextCliHandoffResult = { schema_version: typeof CONTEXT_HANDOFF_SCHEMA_VERSION } & ContextHandoffResult;
type ContextHandoffRouteRecipe = ContextHandoffResult["material_generation_recipes"]["routes"][number];
type ContextHandoffConsumerRoute = ContextHandoffResult["consumer_routes"][number];
type FocusedContextCliResult = ContextCliResult & {
  selected_material_recipe?: ContextHandoffRouteRecipe;
  selected_consumer_route?: ContextHandoffConsumerRoute | null;
};

type VersionWriteSafety = {
  base_package_mutation: false;
  model_invoked: false;
  package_code_execution: false;
};

type VersionWritePaths = {
  parents?: string;
  refs: string;
  commits: string;
  merge_log?: string;
  diff_summary?: string;
  rollback_log?: string;
};

type VersionDeriveResult = {
  schema_version: typeof VERSION_DERIVE_SCHEMA_VERSION;
  status: "derived";
  source_package_id: string;
  source_title: string;
  derived_package_id: string;
  derived_title: string;
  branch_name: string;
  reason: string | null;
  output_file: string;
  commit_id: string;
  source_package_digest: string;
  file_count: number;
  version_paths: VersionWritePaths;
  safety: VersionWriteSafety;
};

type VersionRollbackResult = {
  schema_version: typeof VERSION_ROLLBACK_SCHEMA_VERSION;
  status: "rollback_recorded";
  source_package_id: string;
  source_title: string;
  rollback_package_id: string;
  rollback_title: string;
  rollback_target: string;
  reason: string | null;
  output_file: string;
  commit_id: string;
  source_package_digest: string;
  file_count: number;
  version_paths: VersionWritePaths;
  safety: VersionWriteSafety;
};

type VersionMergeResult = {
  schema_version: typeof VERSION_MERGE_SCHEMA_VERSION;
  status: "merge_recorded";
  base_package_id: string;
  base_title: string;
  other_package_id: string;
  other_title: string;
  merged_package_id: string;
  merged_title: string;
  branch_name: string;
  reason: string | null;
  output_file: string;
  commit_id: string;
  base_package_digest: string;
  other_package_digest: string;
  file_count: number;
  merge_policy: {
    mode: "explicit_non_destructive";
    parent_mutation: false;
    strategy: "record_only";
  };
  version_paths: VersionWritePaths;
  safety: VersionWriteSafety;
};

type DomainListResult = {
  schema_version: typeof DOMAIN_LIST_SCHEMA_VERSION;
  status: "ok";
  count: number;
  domain_packs: Array<{
    domain_id: DomainPackId;
    namespace: string;
    version: string;
    title: string;
    market_focus: string;
    audience: string;
    default_title: string;
    default_package_id: string;
    required_questions: number;
    metric_blueprints: number;
    view_rules: number;
  }>;
};

type CompileSourceAsset = DraftSource & {
  input_path: string;
  path: string;
  type: string;
  size_bytes: number;
};

type CompileSourceMode = "source_bundled" | "source_light";
type CompileParserBackend = "auto" | "builtin" | "markitdown";
const AUTO_MARKITDOWN_SOURCE_TYPES = new Set(["pdf", "docx", "xlsx", "pptx"]);
type CompileParserOptions = {
  timeoutMs: number;
  parserVersion?: string;
  ocrMode: CompileOcrMode;
  ocrPluginVersion?: string;
};

type CompileResourceLimits = {
  schema_version: "open-insight.compile-resource-limits.v0.1";
  max_source_bytes: number;
  max_total_source_bytes: number;
  max_normalized_bytes: number;
  max_total_normalized_bytes: number;
  source_hash_strategy: "streaming_sha256";
  package_write_strategy: "streaming_zip" | "expanded_directory";
};

const DEFAULT_COMPILE_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const DEFAULT_COMPILE_MAX_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_COMPILE_MAX_NORMALIZED_BYTES = 128 * 1024 * 1024;
const DEFAULT_COMPILE_MAX_TOTAL_NORMALIZED_BYTES = 256 * 1024 * 1024;

type CompileSourceAnalysisCache = {
  schema_version: "open-insight.source-analysis-cache.v0.1";
  enabled: boolean;
  cache_dir?: string;
  hits: number;
  misses: number;
  writes: number;
  read_errors: number;
};

type CompileSourceAnalysisCacheOptions = CompileSourceAnalysisCache & {
  cache_dir?: string;
};

type CompileSourceAnalysisCacheRecord = {
  schema_version: "open-insight.source-analysis-cache-record.v0.3";
  cache_key: string;
  source_content_sha256: string;
  source_name: string;
  size_bytes: number;
  mtime_ms: number;
  parser_backend: CompileParserBackend;
  parser_timeout_ms: number;
  parser_version?: string;
  source_mode: CompileSourceMode;
  source: Omit<CompileSourceAsset, "input_path">;
};

type CompileSourceSummary = {
  input_path: string;
  package_path: string;
  name: string;
  type: string;
  size_bytes: number;
  bundled: boolean;
  evidence_boundary: "raw_source_bundled" | "raw_source_external";
  parser?: string;
  parser_version?: string;
  status?: string;
  parser_role?: string;
  cloud_used?: boolean;
  row_count?: number;
  columns?: DraftSourceColumn[];
  spreadsheet_formula_status?: DraftSpreadsheetFormulaEvidence["status"];
  spreadsheet_formula_count?: number;
  spreadsheet_formula_truncated?: boolean;
};

const DEFAULT_SPREADSHEET_FORMULA_MAX_RECORDS = 100_000;
const DEFAULT_SPREADSHEET_FORMULA_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const DEFAULT_SPREADSHEET_FORMULA_MAX_ZIP_ENTRIES = 100_000;
const DEFAULT_SPREADSHEET_FORMULA_MAX_TOTAL_XML_BYTES = 1024 * 1024 * 1024;

type CompilePlanSummary = {
  template_sections: number;
  questions: number;
  metric_suggestions: number;
  view_suggestions: number;
  domain_view_suggestions: number;
  data_gaps: number;
};

type QueryIndexChunkRecord = {
  chunk_id: string;
  source_id: string;
  source_path: string;
  source_type: string;
  normalized_source_path: string;
  title: string;
  text: string;
  chunk_level: "document" | "section" | "paragraph" | "table" | "page_furniture";
  heading_path: string[];
  content_role: "body" | "table" | "heading" | "page_furniture" | "disclaimer" | "unknown";
  render_policy?: string;
  page_furniture_kind?: string;
  page_number?: number;
  line_numbers?: number[];
  estimated_tokens: number;
  field_count?: number;
  row_count?: number;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
};

type QueryIndexPageFurnitureRecord = {
  artifact_id: string;
  source_id: string;
  normalized_source_path: string;
  kind: string;
  text: string;
  line_numbers: number[];
  page_number?: number;
  content_role: "page_furniture" | "disclaimer";
  render_policy: string;
  confidence?: number;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
};

type QueryIndexSpreadsheetFormulaRecord = {
  formula_id: string;
  source_id: string;
  source_path: string;
  normalized_source_path: string;
  sheet_name: string;
  cell_address: string;
  formula: string;
  formula_type: string;
  formula_resolution_status: string;
  cached_value_available: boolean;
  cached_value?: string | number | boolean | null;
  cached_value_raw?: string;
  cached_value_type?: string;
  range_ref?: string;
  shared_index?: string;
  calculation_status: string;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
};

type QueryIndexParseDiagnosticRecord = {
  diagnostic_id: string;
  source_id: string;
  parser: string;
  parser_version?: string;
  parser_role: string;
  normalized_source_path: string;
  status: string;
  confidence?: number;
  cloud_used: boolean;
  message: string;
  source_refs: string[];
  lineage_refs: string[];
};

type QueryIndexSourceMapRecord = {
  source_map_id: string;
  object_id: string;
  object_type: string;
  source_id: string;
  source_path: string;
  raw_source_path: string;
  normalized_source_path: string;
  parse_diagnostic_id: string;
  ranges: unknown[];
  provenance_status: string;
};

type QueryIndexDigestRecord = {
  digest_id: string;
  target_type: string;
  target_ref: string;
  path: string;
  hash: string;
  verification_level: string;
  content_available_in_source_light: boolean;
};

type SqlJsStatement = {
  run(values?: Array<number | string | Uint8Array | null>): void;
  free(): boolean;
};

type SqlJsDatabase = {
  run(sql: string): SqlJsDatabase;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
};

type SqlJsStatic = {
  Database: new () => SqlJsDatabase;
};

type InitSqlJs = () => Promise<SqlJsStatic>;

type CompileDraftCommandResult =
  | {
      schema_version: typeof COMPILE_DRAFT_SCHEMA_VERSION;
      status: "compiled";
      output_dir: string;
      package_id: string;
      title: string;
      domain_pack?: DomainPackId;
      source_mode: CompileSourceMode;
      parser_backend: CompileParserBackend;
      parser_timeout_ms: number;
      ocr_mode: CompileOcrMode;
      resource_limits: CompileResourceLimits;
      source_analysis_cache?: CompileSourceAnalysisCache;
      source_files: CompileSourceSummary[];
      file_count: number;
      warnings: string[];
      plan_summary: CompilePlanSummary;
      validation_status: string;
      validation: ValidationResult;
    }
  | {
      schema_version: typeof COMPILE_DRAFT_SCHEMA_VERSION;
      status: "blocked";
      output_dir?: string;
      reason: string;
    };

type CompileDraftCompiledResult = Extract<CompileDraftCommandResult, { status: "compiled" }>;

type CompilePackSafety = {
  model_invoked: boolean;
  package_code_execution: false;
  browser_key_access: false;
  base_package_mutation: false;
};

type CompilePackPrivacy = {
  path_policy: "invocation_relative_or_external_basename";
  local_paths_redacted: boolean;
  debug_stack_opt_in: boolean;
};

type CompilePackCommandResult =
  | {
      schema_version: typeof COMPILE_PACK_SCHEMA_VERSION;
      status: "compiled";
      output_file: string;
      package_id: string;
      title: string;
      domain_pack?: DomainPackId;
      source_mode: CompileSourceMode;
      parser_backend: CompileParserBackend;
      parser_timeout_ms: number;
      ocr_mode: CompileOcrMode;
      resource_limits: CompileResourceLimits;
      source_analysis_cache?: CompileSourceAnalysisCache;
      source_files: CompileSourceSummary[];
      file_count: number;
      packed_file_count: number;
      single_file_package: true;
      no_zip_output: true;
      query_index: ContextSummaryResult["query_index"];
      warnings: string[];
      plan_summary: CompilePlanSummary;
      validation_status: string;
      validation: ValidationResult;
      safety: CompilePackSafety;
      privacy: CompilePackPrivacy;
    }
  | {
      schema_version: typeof COMPILE_PACK_SCHEMA_VERSION;
      status: "blocked";
      output_file?: string;
      reason: string;
      safety: CompilePackSafety;
      privacy: CompilePackPrivacy;
    };

type AskOverlaySaveResult = AddOverlayQaResult & {
  schema_version: typeof OVERLAY_QA_SAVE_SCHEMA_VERSION;
  validation_status: string;
  validation: ValidationResult;
};

type AskDiagnosticCode = "MODEL_CONFIG_MISSING" | "MODEL_ADAPTER_CREATE_FAILED" | GroundedModelErrorCode;
type AskSource =
  | DeterministicAnswerResult["source"]
  | GroundedModelAnswerResult["source"]
  | "context_answer_model"
  | "context_answer_handoff";
type AskStructuredOutputStatus =
  | GroundedModelAnswerResult["structured_output"]
  | {
      schema_version: "open_insight.context_answer.v0.1";
      parse_status: "valid" | "invalid";
      error?: string;
    };
type AskContextAnswerMetadata = {
  schema_version: "open_insight.context_answer.v0.1";
  context_schema_version: "open-insight.answer-context.v0.1";
  source: "answer-context";
  answer_context_status: ContextAnswerContextResult["status"];
  recommended_mode: ContextAnswerContextResult["recommended_mode"];
  answer_handoff_status: ContextAnswerContextResult["answer_handoff_status"];
  token_budget: number;
  estimated_tokens: number;
  compact_estimated_tokens: number;
  fragment_count: number;
  source_count: number;
  allowed_reference_ids: ContextAnswerContextResult["allowed_reference_ids"];
  source_mode: ContextAnswerContextResult["source_mode"];
  diagnostics: string[];
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  base_package_mutation: false;
};
type ContextModelStructuredOutput = {
  schema_version: "open_insight.context_answer.v0.1";
  status: "answered" | "unanswerable";
  answer: string;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  generation_status: "ai_generated";
  review_status: "needs_review";
};
type ModelListDiagnosticCode = "MODEL_ENDPOINT_CONFIG_MISSING" | "MODEL_LIST_REQUEST_FAILED" | "MODEL_LIST_RESPONSE_INVALID";
type ModelPingDiagnosticCode =
  | "MODEL_CONFIG_MISSING"
  | "MODEL_ADAPTER_CREATE_FAILED"
  | "MODEL_PING_REQUEST_FAILED"
  | "MODEL_PING_RESPONSE_INVALID";

type AskSuccessResult = {
  schema_version: "open-insight.ask-result.v0.1";
  status: "answered" | "unanswerable";
  answerability_status: DeterministicAnswerResult["answerability_status"];
  answer_status: string;
  package_root: string;
  question: string;
  requested_model_mode: AskModelMode;
  resolved_model_mode: "deterministic" | "mock" | "real";
  model_enabled: boolean;
  model_adapter?: string;
  model_config?: {
    source: string;
    baseUrl: string;
    model: string;
    name: string;
  };
  source: AskSource;
  question_id?: string;
  generation_status: "not_model_generated" | GroundedModelAnswerResult["generation_status"];
  review_status: "not_applicable" | GroundedModelAnswerResult["review_status"];
  structured_output?: AskStructuredOutputStatus;
  model_error?: GroundedModelAnswerResult["model_error"];
  diagnostic_code?: AskDiagnosticCode;
  answer: string;
  base_answer?: DeterministicAnswerResult;
  context_answer?: AskContextAnswerMetadata;
  claim_ids: string[];
  evidence_ids: string[];
  evidence_sources: AnswerEvidenceSourceTrace[];
  data_requests: DataRequestRecord[];
  validation_status: string;
  overlay?: AskOverlaySaveResult;
};

type AskBlockedResult = {
  schema_version: "open-insight.ask-result.v0.1";
  status: "blocked";
  package_root: string;
  question: string;
  requested_model_mode: AskModelMode;
  reason: string;
  diagnostic_code?: AskDiagnosticCode;
  validation_status?: string;
  validation?: ValidationResult;
};

type AskCommandResult = AskSuccessResult | AskBlockedResult;

type ModelStatusResult = OpenAICompatibleModelConfigResolution & {
  schema_version: typeof MODEL_STATUS_SCHEMA_VERSION;
};

type ModelPingResult =
  | {
      schema_version: typeof MODEL_PING_SCHEMA_VERSION;
      status: "ok";
      model_enabled: true;
      source: string;
      model_config: {
        source: string;
        baseUrl: string;
        model: string;
        name: string;
      };
      latency_ms: number;
      response_preview: string;
      message: string;
    }
  | {
      schema_version: typeof MODEL_PING_SCHEMA_VERSION;
      status: "blocked" | "failed";
      model_enabled: false;
      source?: string;
      reason: string;
      diagnostic_code?: ModelPingDiagnosticCode;
    };

type ModelListCommandResult =
  | {
      schema_version: typeof MODEL_LIST_SCHEMA_VERSION;
      status: "ok";
      model_enabled: true;
      source: string;
      model_config: {
        source: string;
        baseUrl: string;
        name: string;
      };
      model_count: number;
      models: string[];
      message: string;
    }
  | {
      schema_version: typeof MODEL_LIST_SCHEMA_VERSION;
      status: "blocked" | "failed";
      model_enabled: false;
      source?: string;
      reason: string;
      diagnostic_code?: ModelListDiagnosticCode;
    };

type ModelSmokeDiagnosticCode =
  | "PACKAGE_VALIDATION_FAILED"
  | "OVERLAY_SAVE_FAILED"
  | "OVERLAY_VALIDATION_FAILED"
  | AskDiagnosticCode
  | ModelPingDiagnosticCode;

type ModelSmokeWarning = {
  source: "model-list";
  status: "blocked" | "failed";
  reason: string;
  diagnostic_code?: ModelListDiagnosticCode;
};

type ModelSmokeResult =
  | {
      schema_version: typeof MODEL_SMOKE_SCHEMA_VERSION;
      status: "ok";
      package_root: string;
      question: string;
      model_status: ModelStatusResult;
      model_list: ModelListCommandResult;
      model_list_required: false;
      model_ping: Extract<ModelPingResult, { status: "ok" }>;
      ask: AskSuccessResult;
      warnings: ModelSmokeWarning[];
      overlay?: AskOverlaySaveResult;
      message: string;
    }
  | {
      schema_version: typeof MODEL_SMOKE_SCHEMA_VERSION;
      status: "blocked" | "failed";
      package_root: string;
      question: string;
      reason: string;
      diagnostic_code?: ModelSmokeDiagnosticCode;
      model_status?: ModelStatusResult;
      model_list?: ModelListCommandResult;
      model_list_required?: false;
      model_ping?: ModelPingResult;
      ask?: AskCommandResult;
      warnings: ModelSmokeWarning[];
      validation_status?: string;
      validation?: ValidationResult;
      overlay?: AskOverlaySaveResult;
    };

type ExportRequestCommandResult = ExportDataRequestPackageResult & {
  schema_version: typeof REQUEST_EXPORT_SCHEMA_VERSION;
  validation_status: string;
  validation: ValidationResult;
};

type CreateResponseCommandResult = CreateDataResponsePackageResult & {
  schema_version: typeof RESPONSE_CREATE_SCHEMA_VERSION;
  validation_status: string;
  validation: ValidationResult;
};

type ResponseMergeSummaryCommandResult = DataResponseMergeSummary & {
  schema_version: typeof RESPONSE_SUMMARY_SCHEMA_VERSION;
  validation: { parent_status: string; response_status: string };
};

type MergeResponseCommandResult =
  | (MergeDataResponsePackageResult & {
      schema_version: typeof RESPONSE_MERGE_SCHEMA_VERSION;
      validation_status: string;
      validation: ValidationResult;
    })
  | {
      schema_version: typeof RESPONSE_MERGE_SCHEMA_VERSION;
      status: "blocked";
      output_dir: string;
      summary: ResponseMergeSummaryCommandResult;
    };

type ReviewPatchCommandResult =
  | (ReviewPatchResult & {
      schema_version: typeof REVIEW_PATCH_SCHEMA_VERSION;
      validation_status: string;
      validation: ValidationResult;
    })
  | {
      schema_version: typeof REVIEW_PATCH_SCHEMA_VERSION;
      status: "blocked";
      patch_id: string;
      decision: string;
      output_dir: string;
      reason: string;
      validation_status?: string;
      validation?: ValidationResult;
    };

type ApplyReviewPatchCommandResult =
  | (ApplyReviewPatchResult & {
      schema_version: typeof APPLY_REVIEW_PATCH_SCHEMA_VERSION;
      validation_status: string;
      validation: ValidationResult;
    })
  | {
      schema_version: typeof APPLY_REVIEW_PATCH_SCHEMA_VERSION;
      status: "blocked";
      patch_id: string;
      output_dir: string;
      reason: string;
      validation_status?: string;
      validation?: ValidationResult;
    };

type AddOverlayNoteCommandResult =
  | (AddOverlayNoteResult & {
      schema_version: typeof OVERLAY_NOTE_SCHEMA_VERSION;
      validation_status: string;
      validation: ValidationResult;
    })
  | {
      schema_version: typeof OVERLAY_NOTE_SCHEMA_VERSION;
      status: "blocked";
      output_dir: string;
      reason: string;
      validation_status?: string;
      validation?: ValidationResult;
    };

type ImportOverlayFollowupCommandResult =
  | (ImportOverlayFollowupResult & {
      schema_version: typeof OVERLAY_FOLLOWUP_IMPORT_SCHEMA_VERSION;
      validation_status: string;
      validation: ValidationResult;
    })
  | {
      schema_version: typeof OVERLAY_FOLLOWUP_IMPORT_SCHEMA_VERSION;
      status: "blocked";
      output_dir: string;
      reason: string;
      validation_status?: string;
      validation?: ValidationResult;
    };

type ConformanceAssetKind = "example" | "fixture";
type ConformanceExpectedValidationStatus = ValidationResult["status"];
type ConformanceExpectedIssueCode = ValidationIssue["code"];

interface ConformanceAsset {
  id: string;
  kind: ConformanceAssetKind;
  path: string;
  expected_validation_status: ConformanceExpectedValidationStatus;
  expected_issue_codes?: ConformanceExpectedIssueCode[];
  purpose: string;
  reader_studio_focus: string[];
  tests: string[];
}

interface ConformanceListResult {
  status: "ok";
  schema_version: "open-insight.conformance.v0.1";
  assets: ConformanceAsset[];
  commands: string[];
}

interface ConformanceInspectResult {
  status: "ok" | "mismatch";
  schema_version: "open-insight.conformance.v0.1";
  asset: ConformanceAsset;
  actual_validation_status: ValidationResult["status"];
  matches_expected_status: boolean;
  matches_expected_issue_codes: boolean;
  matches_expected: boolean;
  missing_expected_issue_codes: ConformanceExpectedIssueCode[];
  issue_codes: Record<string, number>;
  issues: ValidationIssue[];
  recommended_behavior: string[];
}

interface ConformanceCheckResult {
  status: "ok" | "failed";
  schema_version: "open-insight.conformance.v0.1";
  total: number;
  passed: number;
  failed: number;
  issue_code_assets: number;
  issue_code_assets_passed: number;
  issue_code_assets_failed: number;
  assets: ConformanceInspectResult[];
}

interface InteropCheckResult {
  schema_version: "open-insight.interop-check.v0.1";
  status: "ok" | "failed";
  summary_only: boolean;
  schema: SchemaInspectionResult;
  conformance: {
    status: "ok" | "failed" | "skipped";
    reason?: string;
    total: number;
    passed: number;
    failed: number;
    issue_code_assets: number;
    issue_code_assets_passed: number;
    issue_code_assets_failed: number;
    assets: ConformanceInspectResult[];
  };
}

const FIXED_CONFORMANCE_ASSETS: ConformanceAsset[] = [
  {
    id: "missing-manifest",
    kind: "fixture",
    path: "tests/fixtures/missing-manifest.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["MISSING_MANIFEST"],
    purpose: "manifest.json 缺失稳定失败 fixture。",
    reader_studio_focus: [
      "Validator 应在读取入口阶段直接返回 MISSING_MANIFEST。",
      "Reader / Studio 可以显示只读诊断，但不得把该目录解释为可发布洞察资产。",
      "第三方生成器必须先写入合法 manifest.json，再进入 schema、证据链和展示层处理。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "missing-spec-version",
    kind: "fixture",
    path: "tests/fixtures/missing-spec-version.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["MISSING_MANIFEST_SPEC_VERSION"],
    purpose: "manifest.spec_version 缺失稳定失败 fixture。",
    reader_studio_focus: [
      "Validator 应判定 manifest 缺少协议版本，返回 MISSING_MANIFEST_SPEC_VERSION。",
      "Reader / Studio 可以显示只读诊断，但不得假定该资产符合 v0.1 或未来任意协议版本。",
      "第三方生成器必须显式写入稳定 spec_version，再进入 schema、证据链和展示层处理。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "manifest-parse-error",
    kind: "fixture",
    path: "tests/fixtures/manifest-parse-error.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["MANIFEST_PARSE_ERROR"],
    purpose: "manifest.json 非法 JSON 稳定失败 fixture。",
    reader_studio_focus: [
      "Validator 应在入口解析阶段返回 MANIFEST_PARSE_ERROR；第三方若附带 JSON_PARSE_ERROR 诊断也不影响 conformance。",
      "Reader / Studio 可以只读显示诊断，但不得继续把损坏 manifest 的目录解释为可发布洞察资产。",
      "第三方生成器必须先修复 manifest.json 的 JSON 完整性，再进入 schema、证据链和展示层处理。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "data-request-jsonl-parse-error",
    kind: "fixture",
    path: "tests/fixtures/data-request-jsonl-parse-error.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["JSONL_PARSE_ERROR"],
    purpose: "answerability/data_requests.jsonl 非法 JSONL 稳定失败 fixture。",
    reader_studio_focus: [
      "Validator 应返回 JSONL_PARSE_ERROR，并指出损坏的 data_requests 行号。",
      "Reader / Studio 可以继续只读打开核心内容，但不得把补数请求链路解释为完整可信。",
      "第三方生成器必须先修复 JSONL 行级完整性，再进入补数流程、展示层和 AI 加工。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "homepage-json-parse-error",
    kind: "fixture",
    path: "tests/fixtures/homepage-json-parse-error.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["JSON_PARSE_ERROR"],
    purpose: "views/homepage.json 非法 JSON 稳定失败 fixture。",
    reader_studio_focus: [
      "Validator 应返回 JSON_PARSE_ERROR，并指出损坏的 homepage 文件路径。",
      "Reader / Studio 可以显示诊断并按只读方式打开其他核心内容，但不得把损坏的 homepage 当作可信默认视图。",
      "第三方生成器必须先修复 homepage.json 的 JSON 完整性，再进入展示层编辑、导出或 AI 加工。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "data-request-file-read-error",
    kind: "fixture",
    path: "tests/fixtures/data-request-file-read-error.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["FILE_READ_ERROR"],
    purpose: "answerability/data_requests.jsonl 读取失败稳定失败 fixture。",
    reader_studio_focus: [
      "Validator 应返回 FILE_READ_ERROR，并指出 data_requests 路径不是可读 JSONL 文件。",
      "Reader / Studio 可以继续只读打开核心内容，但不得把补数请求链路解释为完整可信。",
      "第三方生成器必须先修复 data_requests.jsonl 的文件形态，再进入补数流程、展示层和 AI 加工。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "overlay-followup-import",
    kind: "fixture",
    path: "tests/fixtures/overlay-followup-import.insight",
    expected_validation_status: "valid",
    purpose: "追问处理派生包互操作 fixture。",
    reader_studio_focus: [
      "识别 overlay.followup_import capability。",
      "展示待审 prepared question 和 draft 补数请求。",
      "保持 base_package_mutation = false 的只读语义。"
    ],
    tests: ["tests/overlay-followup-import-conformance.test.ts"]
  },
  {
    id: "followup-unsafe-mutation",
    kind: "fixture",
    path: "tests/fixtures/followup-unsafe-mutation.insight",
    expected_validation_status: "valid",
    purpose: "结构可读但采纳不安全的 followup 回写风险互操作 fixture。",
    reader_studio_focus: [
      "Validator 应判定为 valid，因为该包结构完整且核心对象可追溯。",
      "Reader 必须输出 UNSAFE_FOLLOWUP_IMPORT，只读展示追问和补数请求，不能解释为回写授权。",
      "Studio 可以只读审阅派生包，但必须阻断含 base_package_mutation=true 补数请求的候选自动采纳。"
    ],
    tests: ["tests/followup-unsafe-mutation-conformance.test.ts"]
  },
  {
    id: "structured-compatibility-issue",
    kind: "fixture",
    path: "tests/fixtures/structured-compatibility-issue.insight",
    expected_validation_status: "valid",
    purpose: "结构化 compatibility_issues 合并诊断互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应接受 diff_summary.compatibility_issues[] 中的结构化诊断对象。",
      "结构化 warning 只用于界面分组展示，不应把 valid merged 包降级为 invalid。",
      "第三方工具应同时兼容 CLI 字符串和 Studio 结构化对象两种合并诊断形态。"
    ],
    tests: ["tests/structured-compatibility-issue-conformance.test.ts"]
  },
  {
    id: "unsafe-ai-overlay",
    kind: "fixture",
    path: "tests/fixtures/unsafe-ai-overlay.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNSAFE_OVERLAY"],
    purpose: "不安全 AI overlay 稳定失败 fixture。",
    reader_studio_focus: [
      "核心内容仍可只读打开。",
      "对 model_enabled、review_status 和 base_package_mutation 输出安全告警。",
      "不得把该回答解释为人工确认结果或回写授权。"
    ],
    tests: ["tests/unsafe-ai-overlay-conformance.test.ts"]
  },
  {
    id: "core-readiness-gap",
    kind: "fixture",
    path: "tests/fixtures/core-readiness-gap.insight",
    expected_validation_status: "valid_with_warnings",
    expected_issue_codes: ["MISSING_CORE_CAPABILITY", "MISSING_CORE_FILE"],
    purpose: "v0.1 核心 capability 与核心文件缺口降级 fixture。",
    reader_studio_focus: [
      "Reader 应继续只读打开核心内容，但提示缺少 lineage.sources capability 和 lineage/sources.json。",
      "Studio / 生成器应把该包视为可修复草稿，不应作为完整发布资产。",
      "第三方工具不得静默忽略核心文件缺口导致的来源追踪能力缺失。"
    ],
    tests: ["tests/core-readiness-gap-conformance.test.ts"]
  },
  {
    id: "overlay-target-reference-gap",
    kind: "fixture",
    path: "tests/fixtures/overlay-target-reference-gap.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNKNOWN_PACKAGE_TARGET", "UNKNOWN_VIEW_BLOCK", "UNKNOWN_QUESTION"],
    purpose: "overlay 私有笔记目标引用断裂稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝把无法定位到 package、prepared question 或 view block 的私有笔记合并进可信上下文。",
      "Reader 可以只读显示诊断，但不得把断裂 overlay 注释解释为可追溯证据或展示上下文。",
      "Studio 必须要求制作方修正 overlay target_id，或移除无法定位的私有笔记后再发布。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "unsafe-extension",
    kind: "fixture",
    path: "tests/fixtures/unsafe-extension.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNSAFE_EXTENSION_NAMESPACE"],
    purpose: "不安全扩展 namespace 稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝包含路径穿越语义的 extension namespace。",
      "不加载、不执行、不信任该扩展声明。",
      "核心内容只能在安全降级模式下只读查看。"
    ],
    tests: ["packages/insight-validator/src/index.test.ts"]
  },
  {
    id: "broken-reference",
    kind: "fixture",
    path: "tests/fixtures/broken-reference.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNKNOWN_CLAIM", "UNKNOWN_EVIDENCE", "UNKNOWN_METRIC"],
    purpose: "断裂引用稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝把缺失 claim、metric 或 evidence 的展示块解释为可信证据链。",
      "Reader / Studio 应提示引用断裂，不得静默隐藏缺失证据。",
      "制作方必须修复引用关系后才能发布为 valid 包。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "unlinked-supporting-response-evidence",
    kind: "fixture",
    path: "tests/fixtures/unlinked-supporting-response-evidence.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNLINKED_SUPPORTING_RESPONSE_EVIDENCE"],
    purpose: "Response 支撑证据未同步进入 claim.evidence_ids 的稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝把只写在 supporting_response_evidence_ids、但没有进入普通 evidence_ids 的 response 证据解释为完整证据链。",
      "Reader 可以降级展示诊断，但普通证据面板和 Response 复核绑定必须提示该证据链未完全入链。",
      "Studio / 生成器必须把 response 支撑 evidence 同步追加到目标 claim.evidence_ids 后，才能发布为 valid 包。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "versioning-review-task-reference-gap",
    kind: "fixture",
    path: "tests/fixtures/versioning-review-task-reference-gap.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNKNOWN_CLAIM", "UNKNOWN_PACKAGE_TARGET"],
    purpose: "Response 复核任务目标和关联对象引用断裂稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝把 target_id 无法追到 claim / evidence / dataset 的复核任务展示成可信待办。",
      "Reader 可以只读显示诊断，但不得把断裂 related_ids 解释为可追溯证据、数据或血缘对象。",
      "Studio / 生成器必须修正 review_tasks[] 的目标和关联对象后，才能发布为 valid merged 包。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "semantic-reference-gap",
    kind: "fixture",
    path: "tests/fixtures/semantic-reference-gap.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["DUPLICATE_COLUMN", "UNKNOWN_DATASET", "UNKNOWN_COLUMN"],
    purpose: "data catalog 与 semantic 层引用断裂稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝把重复字段名、未知数据集或未知主键字段解释为可信数据内核。",
      "Reader / Studio 可以展示诊断，但不得继续基于断裂 metric 或 entity 做分析结论。",
      "制作方必须修正 catalog 字段、metric.dataset_id 和 entity.primary_key 后才能发布。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "duplicate-ids",
    kind: "fixture",
    path: "tests/fixtures/duplicate-ids.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["DUPLICATE_ID"],
    purpose: "重复 ID 稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝会破坏对象索引和证据定位的重复 ID。",
      "Reader / Studio 不得任选一个重复对象继续作为可信来源。",
      "制作方必须消除重复 dataset、metric、view block、claim、evidence 和 question ID。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "schema-invalid",
    kind: "fixture",
    path: "tests/fixtures/schema-invalid.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["INVALID_MANIFEST_TYPE", "SCHEMA_VALIDATION_ERROR"],
    purpose: "schema 基础结构不合规稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝缺少必填字段、类型错误或 manifest 类型不正确的包。",
      "Reader / Studio 可以只读诊断错误，但不得把结构不完整内容当作可发布资产。",
      "第三方生成器应先通过 schema 校验，再进入展示和 AI 加工流程。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "prepared-question-missing-data-request",
    kind: "fixture",
    path: "tests/fixtures/prepared-question-missing-data-request.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNKNOWN_DATA_REQUEST"],
    purpose: "prepared question 补数请求引用断裂稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝把缺失 data request 的预置问答解释为完整可追溯问答。",
      "Reader / Studio 应提示 data_request_id 断裂，不能静默隐藏补数请求缺口。",
      "制作方必须补齐 answerability/data_requests.jsonl 或移除无效引用后才能发布。"
    ],
    tests: ["tests/validator-failure-fixtures-conformance.test.ts"]
  },
  {
    id: "traceability-warning",
    kind: "fixture",
    path: "tests/fixtures/traceability-warning.insight",
    expected_validation_status: "valid_with_warnings",
    expected_issue_codes: ["UNTRACEABLE_VIEW_BLOCK_CONTEXT", "UNTRACEABLE_VIEW_BLOCK_EVIDENCE", "UNTRACEABLE_VIEW_BLOCK_SOURCE"],
    purpose: "展示块证据追踪不完整但核心结构可打开的降级 fixture。",
    reader_studio_focus: [
      "Reader 应继续打开核心内容，但必须显示追踪不完整告警。",
      "首页展示块不能被解释为完全证据闭环。",
      "Studio 应提示制作方补齐 metric、claim、evidence 和 source trace。"
    ],
    tests: ["tests/traceability-warning-conformance.test.ts"]
  },
  {
    id: "lineage-gap",
    kind: "fixture",
    path: "tests/fixtures/lineage-gap.insight",
    expected_validation_status: "valid_with_warnings",
    expected_issue_codes: ["UNTRACEABLE_DATASET_LINEAGE", "UNTRACEABLE_EVIDENCE_LINEAGE", "MISMATCHED_EVIDENCE_SOURCE_PATH"],
    purpose: "dataset 与 evidence 来源未完整进入 lineage 的降级 fixture。",
    reader_studio_focus: [
      "Reader 应继续打开核心内容，但必须提示数据集和证据来源血缘不完整。",
      "首页展示块不能被解释为完全来源闭环。",
      "Studio 应要求制作方补齐 lineage/sources.json 或修正 evidence source_refs。"
    ],
    tests: ["tests/lineage-gap-conformance.test.ts"]
  },
  {
    id: "third-party-generator-traceability-gap",
    kind: "fixture",
    path: "tests/fixtures/third-party-generator-traceability-gap.insight",
    expected_validation_status: "valid_with_warnings",
    expected_issue_codes: [
      "UNTRACEABLE_VIEW_BLOCK_CONTEXT",
      "UNTRACEABLE_VIEW_BLOCK_EVIDENCE",
      "UNTRACEABLE_VIEW_BLOCK_SOURCE",
      "UNTRACEABLE_DATASET_LINEAGE",
      "UNTRACEABLE_EVIDENCE_LINEAGE",
      "MISMATCHED_EVIDENCE_SOURCE_PATH"
    ],
    purpose: "第三方生成器草稿缺少 view_block -> claim/metric -> evidence -> source / lineage 完整追踪闭环的降级 fixture。",
    reader_studio_focus: [
      "Reader 可以只读打开核心内容，但必须显示第三方生成器追踪缺口 warning。",
      "Studio / 生成器必须补齐 view_block、claim/metric、evidence、source 和 lineage 后才能发布。",
      "生成内容保持 needs_review / compiler_generated，不得自动 verified、执行包内代码或污染 base package。"
    ],
    tests: ["tests/third-party-generator-traceability-gap-conformance.test.ts"]
  },
  {
    id: "third-party-generator-minimal-success",
    kind: "fixture",
    path: "tests/fixtures/third-party-generator-minimal-success.insight",
    expected_validation_status: "valid",
    purpose: "第三方生成器产出的普通 v0.1 最小成功草稿包，展示 view_block -> claim/metric -> evidence -> source / lineage 完整追踪闭环。",
    reader_studio_focus: [
      "Reader 可以只读打开完整追踪闭环的生成器草稿，并展示待审状态而不是自动确认。",
      "Studio / 生成器发布前仍需保留 needs_review / compiler_generated 状态，不能把 valid 草稿自动解释为 verified。",
      "生成器必须保留 evidence、source、lineage、prepared question 和 data request 链路，且不得执行包内代码或污染 base package。"
    ],
    tests: ["tests/third-party-generator-minimal-success-conformance.test.ts"]
  },
  {
    id: "unknown-optional-capability",
    kind: "fixture",
    path: "tests/fixtures/unknown-optional-capability.insight",
    expected_validation_status: "valid",
    purpose: "未知 optional capability 和安全第三方扩展可被旧工具忽略的开放互操作 fixture。",
    reader_studio_focus: [
      "保留未知 optional_capabilities，但不要求旧工具实现。",
      "只接受安全 namespace，且 required 必须为 false。",
      "Reader / Studio 应继续展示核心内容，不执行扩展逻辑。"
    ],
    tests: ["tests/unknown-optional-capability-conformance.test.ts"]
  },
  {
    id: "sales-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/sales-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "sales_operation Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 sales_operation 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "老客复购缺少历史字段时必须保留 unanswerable 和 data request，不能自动 verified。",
      "经营建议和必答问题必须保留 needs_review 人工复核状态。"
    ],
    tests: ["tests/sales-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "government-project-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/government-project-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "government_project_performance Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 government_project_performance 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "合同节点、验收材料、资金支付凭证和整改闭环证明缺失时必须保留 needs_review、unanswerable 或 data request，不能自动 verified。",
      "财政、审计、问责、正式绩效评价、财政处罚相关结论必须保留 requires_expert_review 和人工复核，不能伪装成正式绩效评价报告、审计意见、财政处罚或问责依据。"
    ],
    tests: ["tests/government-project-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "bond-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/bond-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "bond_analysis Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 bond_analysis 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "契约、评级和担保材料缺失时必须保留 unanswerable 和 data request，不能自动 verified。",
      "投资判断、偿债能力、违约风险和担保有效性必须保留 not_advice 与 requires_expert_review。"
    ],
    tests: ["tests/bond-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "contract-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/contract-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "contract_review Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 contract_review 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "附件、授权文件和历史履约材料缺失时必须保留 unanswerable 和 data request，不能自动 verified。",
      "合同风险、付款违约、争议解决和授权有效性判断必须保留 not_advice 与 requires_expert_review，不能解释为正式法律意见。"
    ],
    tests: ["tests/contract-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "manufacturing-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/manufacturing-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "manufacturing_quality Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 manufacturing_quality 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "设备参数、班组、测试治具、返工成本、客户投诉、停线和 CAPA 闭环材料缺失时必须保留 needs_review 或 data request，不能自动 verified。",
      "CAPA、供应商整改、客户投诉、召回、停线和处罚建议必须保留 requires_expert_review 和人工复核，不能伪装成已完成 8D/CAPA 结论。"
    ],
    tests: ["tests/manufacturing-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "supply-chain-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/supply-chain-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "supply_chain_fulfillment Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 supply_chain_fulfillment 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "库存快照、供应商 ASN、生产排程、承运商轨迹和客户承诺变更记录缺失时必须保留 unanswerable 或 data request，不能自动 verified。",
      "客户赔付、供应商处罚、生产排期调整和履约承诺变更必须保留 requires_expert_review 和人工复核，不能伪装成正式合同责任认定、客户赔付依据或供应商处罚决定。"
    ],
    tests: ["tests/supply-chain-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "channel-inventory-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/channel-inventory-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "channel_inventory_collaboration Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 channel_inventory_collaboration 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "促销计划、销售预测、在途库存、渠道政策、安全库存口径、调拨能力和经销商反馈缺失时必须保留 needs_review、unanswerable 或 data request，不能自动 verified。",
      "补货、调拨、清仓、采购承诺、渠道配额调整、渠道处罚和客户承诺必须保留 requires_expert_review 与人工复核，不能伪装成自动执行指令、采购订单、渠道处罚或客户承诺。"
    ],
    tests: ["tests/channel-inventory-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "healthcare-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/healthcare-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "healthcare_quality_control Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 healthcare_quality_control 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "病案首页、医嘱、手术记录、随访、诊断编码和医保结算材料缺失时必须保留 needs_review、unanswerable 或 data request，不能自动 verified。",
      "医疗安全、诊疗质量、科室责任和医保合规判断必须保留 requires_expert_review 与人工复核，不能伪装成诊断或治疗建议、医疗事故认定、行政处罚依据或医保拒付结论。"
    ],
    tests: ["tests/healthcare-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "education-domain-pack-landing",
    kind: "fixture",
    path: "tests/fixtures/education-domain-pack-landing.insight",
    expected_validation_status: "valid",
    purpose: "education_quality_analysis Domain Pack 声明式规则落到普通 v0.1 核心文件的正向互操作 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应只读展示 education_quality_analysis 规则落地结果。",
      "不能执行 Domain Pack 代码，也不能把行业包当作运行时插件。",
      "基线成绩、缺勤原因、作业迟交原因、课堂观察、家校沟通和个别化支持计划缺失时必须保留 needs_review、unanswerable 或 data request，不能自动 verified。",
      "涉及未成年人、单个学生支持、风险预警、招生录取、分班、升学、纪律处分或教师绩效的判断必须保留 requires_expert_review 与人工复核，不能作为高影响教育决策或单个学生标签化依据。"
    ],
    tests: ["tests/education-domain-pack-landing-conformance.test.ts"]
  },
  {
    id: "domain-pack-capability-gap",
    kind: "fixture",
    path: "tests/fixtures/domain-pack-capability-gap.insight",
    expected_validation_status: "valid_with_warnings",
    expected_issue_codes: ["MISSING_DOMAIN_PACK_EXTENSION"],
    purpose: "domain.pack 能力声明缺少行业包扩展的降级 fixture。",
    reader_studio_focus: [
      "Reader / Studio 应继续打开核心内容，但提示 manifest.extensions 缺少行业包扩展。",
      "旧工具不得因为缺少行业包扩展而阻断基础数据、结论和证据展示。",
      "Studio 应提示制作方补齐 extensions 中的 domain_id、namespace、version 和 required=false。"
    ],
    tests: ["tests/domain-pack-extension-conformance.test.ts"]
  },
  {
    id: "unsafe-domain-pack",
    kind: "fixture",
    path: "tests/fixtures/unsafe-domain-pack.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNSAFE_DOMAIN_PACK_EXTENSION", "MISSING_DOMAIN_PACK_CAPABILITY", "INVALID_DOMAIN_PACK_EXTENSION"],
    purpose: "不安全行业包扩展稳定失败 fixture。",
    reader_studio_focus: [
      "Reader / Studio 不得把 required = true 的行业包扩展解释为必须执行的运行时依赖。",
      "缺少 domain.pack 能力时，应提示能力声明与 extensions 不一致。",
      "domain_id 与 namespace 不匹配时，应要求制作方修正行业包扩展声明。"
    ],
    tests: ["tests/domain-pack-extension-conformance.test.ts"]
  },
  {
    id: "unsafe-versioning",
    kind: "fixture",
    path: "tests/fixtures/unsafe-versioning.insight",
    expected_validation_status: "invalid",
    expected_issue_codes: ["UNSAFE_MERGE_POLICY", "UNSAFE_ANSWERABILITY_POLICY", "UNSAFE_REVIEW_HISTORY", "UNSAFE_REVIEW_PATCH"],
    purpose: "危险 versioning merge policy 稳定失败 fixture。",
    reader_studio_focus: [
      "拒绝 replace_parent、parent_mutation = true 等会污染母包的合并策略。",
      "拒绝 auto_promote_to_verified 等绕过人工审阅的 answerability 变更策略。",
      "拒绝声明 base_package_mutation = true 的 review history 和 review patch。",
      "只允许作为失败样例和安全降级材料读取，不得执行合并。"
    ],
    tests: ["tests/unsafe-versioning-conformance.test.ts", "packages/insight-validator/src/index.test.ts"]
  }
];

export async function runCli(args: string[], invocationRoot: string, options: RunCliOptions = {}): Promise<CliResult> {
  if (options.loadEnv) {
    await loadLocalEnvFile(invocationRoot);
  }

  const [command] = args;
  const commandArgs = args.slice(1);
  const positionalArgs = getPositionalArgs(commandArgs);
  const firstArg = positionalArgs[0] ?? ".";
  const secondArg = positionalArgs[1];
  const thirdArg = positionalArgs[2];
  const fourthArg = positionalArgs[3];
  const fifthArg = positionalArgs[4];
  const packageRoot = path.resolve(invocationRoot, firstArg);
  const schemaRoot = path.resolve(invocationRoot, getFlagValue(commandArgs, "--schema-root") ?? "spec/schemas");
  const flags = new Set(commandArgs.filter((arg) => arg.startsWith("--")));
  const format = getFlagValue(commandArgs, "--format") ?? "json";

  if (command === "version" && positionalArgs.length > 0) {
    return runVersionGraphCommand(commandArgs, invocationRoot, format);
  }

  if (command === "version" || command === "--version" || command === "-v") {
    return {
      exitCode: 0,
      output: await formatVersionInfo(invocationRoot)
    };
  }

  if (command === "context") {
    return runContextCommand(commandArgs, invocationRoot, format);
  }

  if (command === "model-status") {
    const resolution = getModelStatusResult();

    return {
      exitCode: 0,
      output: formatModelStatusResult(resolution, format)
    };
  }

  if (command === "model-list") {
    const result = await listConfiguredModels(options.modelFetch);

    return {
      exitCode: result.status === "ok" ? 0 : 1,
      output: formatModelListResult(result, format)
    };
  }

  if (command === "model-ping") {
    const result = await pingConfiguredModel(options.modelFetch);

    return {
      exitCode: result.status === "ok" ? 0 : 1,
      output: formatModelPingResult(result, format)
    };
  }

  if (command === "model-smoke") {
    const smokePackageArg = positionalArgs[0];
    const smokeQuestion = positionalArgs[1];

    if (!smokePackageArg || !smokeQuestion) {
      throw new Error("用法：insight model-smoke <package-root> <question> [--save-overlay <output-dir>] [--format json|text]");
    }

    const saveOverlayOutput = getFlagValue(commandArgs, "--save-overlay");

    if (flags.has("--save-overlay") && (!saveOverlayOutput || saveOverlayOutput.startsWith("--"))) {
      throw new Error("用法：insight model-smoke <package-root> <question> --save-overlay <output-dir>");
    }

    const result = await runModelSmoke({
      packageRoot,
      question: smokeQuestion,
      schemaRoot,
      ...(saveOverlayOutput ? { saveOverlayOutputDir: path.resolve(invocationRoot, saveOverlayOutput) } : {}),
      ...(options.modelFetch ? { modelFetch: options.modelFetch } : {})
    });

    return {
      exitCode: result.status === "ok" ? 0 : 1,
      output: formatModelSmokeResult(result, format)
    };
  }

  if (command === "domain-list") {
    const result: DomainListResult = {
      schema_version: DOMAIN_LIST_SCHEMA_VERSION,
      status: "ok",
      count: DOMAIN_PACKS.length,
      domain_packs: DOMAIN_PACKS.map(formatDomainPackSummary)
    };

    return {
      exitCode: 0,
      output: formatDomainListResult(result, format)
    };
  }

  if (command === "interop") {
    const subcommand = positionalArgs[0] ?? "check";
    const summaryOnly = flags.has("--summary-only");

    if (subcommand !== "check") {
      throw new Error("用法：insight interop check [--schema-root <dir>] [--summary-only] [--format json|text]");
    }

    const result = await runInteropCheck(invocationRoot, schemaRoot, summaryOnly);

    return {
      exitCode: result.status === "ok" ? 0 : 1,
      output: formatInteropCheckResult(result, format)
    };
  }

  if (command === "conformance") {
    const subcommand = positionalArgs[0] ?? "list";

    if (subcommand === "list") {
      const result = await listConformanceAssets(invocationRoot);

      return {
        exitCode: 0,
        output: formatConformanceListResult(result, format)
      };
    }

    if (subcommand === "check") {
      const result = await checkConformanceAssets(invocationRoot, schemaRoot);

      return {
        exitCode: result.status === "ok" ? 0 : 1,
        output: formatConformanceCheckResult(result, format)
      };
    }

    if (subcommand === "inspect") {
      const target = positionalArgs[1];

      if (!target) {
        return {
          exitCode: 1,
          output: formatConformanceError("用法：insight conformance inspect <asset-id|asset-path> [--format json|text]", format)
        };
      }

      const result = await inspectConformanceAsset(invocationRoot, schemaRoot, target);

      if (!result) {
        return {
          exitCode: 1,
          output: formatConformanceError(`未找到 conformance 资产：${target}`, format)
        };
      }

      return {
        exitCode: result.matches_expected ? 0 : 1,
        output: formatConformanceInspectResult(result, format)
      };
    }

    return {
      exitCode: 1,
      output: formatConformanceError(`未知 conformance 子命令：${subcommand}`, format)
    };
  }

  if (command === "schema") {
    const subcommand = positionalArgs[0] ?? "check";

    if (subcommand !== "check") {
      throw new Error("用法：insight schema check [--schema-root <dir>] [--format json|text]");
    }

    const result = await inspectSchemaRoot(schemaRoot);

    return {
      exitCode: result.status === "ok" ? 0 : 1,
      output: formatSchemaInspectionResult(result, format)
    };
  }

  if (command === "inspect") {
    const summary = await withReadablePackageRoot(packageRoot, (readablePackageRoot) => inspectPackage(readablePackageRoot, schemaRoot));

    return {
      exitCode: 0,
      output: formatInspectResult(summary, format)
    };
  }

  if (command === "validate") {
    const result = await withReadablePackageRoot(packageRoot, (readablePackageRoot) =>
      validateInsightPackage(readablePackageRoot, { schemaRoot })
    );
    return {
      exitCode: result.status === "invalid" ? 1 : 0,
      output: formatValidationResult(result, format)
    };
  }

  if (command === "ask") {
    if (!secondArg) {
      throw new Error(
        "用法：insight ask <package-root> <question> [--model auto|deterministic|mock|real] [--save-overlay <output-dir>] [--format json|text]"
      );
    }

    const modelMode = parseAskModelMode(getFlagValue(commandArgs, "--model") ?? "auto");
    const saveOverlayOutput = getFlagValue(commandArgs, "--save-overlay");

    if (flags.has("--save-overlay") && (!saveOverlayOutput || saveOverlayOutput.startsWith("--"))) {
      throw new Error("用法：insight ask <package-root> <question> --save-overlay <output-dir>");
    }

    return withReadablePackageRoot(packageRoot, async (readablePackageRoot) => {
      const validation = await validateInsightPackage(readablePackageRoot, { schemaRoot });

    if (validation.status === "invalid") {
      return {
        exitCode: 1,
        output: formatAskResult(
          {
            schema_version: "open-insight.ask-result.v0.1",
            status: "blocked",
            package_root: packageRoot,
            question: secondArg,
            requested_model_mode: modelMode,
            reason: `来源包未通过校验：${validation.issues.length} 个问题`,
            validation_status: validation.status,
            validation
          },
          format
        )
      };
    }

    const askResult = rewriteAskPackageRoot(
      await askPackage(readablePackageRoot, secondArg, modelMode, validation.status, options.modelFetch, commandArgs),
      packageRoot
    );

    if (askResult.status !== "blocked" && saveOverlayOutput) {
      const outputDir = path.resolve(invocationRoot, saveOverlayOutput);

      try {
        const result: AskSuccessResult = {
          ...askResult,
          overlay: await saveAskOverlay(readablePackageRoot, outputDir, askResult, schemaRoot)
        };

        return {
          exitCode: result.overlay?.validation_status === "invalid" ? 1 : 0,
          output: formatAskResult(result, format)
        };
      } catch (error) {
        return {
          exitCode: 1,
          output: formatAskResult(
            {
              schema_version: "open-insight.ask-result.v0.1",
              status: "blocked",
              package_root: packageRoot,
              question: secondArg,
              requested_model_mode: modelMode,
              reason: error instanceof Error ? error.message : "保存 overlay 问答失败",
              validation_status: validation.status
            },
            format
          )
        };
      }
    }

    return {
      exitCode: askResult.status === "blocked" ? 1 : 0,
      output: formatAskResult(askResult, format)
    };
    });
  }

  if (command === "compile-pack") {
    const sourceArg = positionalArgs[0];
    const outputArg = positionalArgs[1];
    const outputFile = outputArg ? path.resolve(invocationRoot, outputArg) : undefined;
    const safety: CompilePackSafety = {
      model_invoked: false,
      package_code_execution: false,
      browser_key_access: false,
      base_package_mutation: false
    };

    try {
      if (!sourceArg || !outputArg) {
        throw new Error(
          "用法：insight compile-pack <source-file> <output.insight> [--source <extra-file>] [--title <title>] [--package-id <id>] [--template <text>] [--template-file <file>] [--domain <domain-id>] [--source-mode source_bundled|source_light] [--parser auto|builtin|markitdown] [--ocr off|llm] [--parser-timeout-ms <ms>] [--max-source-bytes <bytes|KB|MB|GB>] [--max-total-source-bytes <bytes|KB|MB|GB>] [--max-normalized-bytes <bytes|KB|MB|GB>] [--max-total-normalized-bytes <bytes|KB|MB|GB>] [--source-analysis-cache-dir <dir>] [--format json|text]"
        );
      }

      if (path.extname(outputFile ?? "").toLowerCase() !== ".insight") {
        throw new Error("compile-pack 输出文件必须使用 .insight 后缀；普通用户路径不会生成 .zip。");
      }

      const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-compile-pack-"));
      try {
        const workingPackageDir = path.join(tempDir, "package.insight");
        const compiled = await compileDraftToDirectory({
          commandArgs,
          invocationRoot,
          sourceArg,
          outputDir: workingPackageDir,
          schemaRoot,
          packageWriteStrategy: "streaming_zip",
          markitdownConvert: options.markitdownConvert,
          spreadsheetFormulaExtract: options.spreadsheetFormulaExtract
        });
        safety.model_invoked = compiled.ocr_mode === "llm";
        const packed = await packInsightDirectory({
          sourceDir: compiled.output_dir,
          outputFile: outputFile as string
        });
        const contextSummary = await summarizeContextPackage(compiled.output_dir);
        const result: CompilePackCommandResult = {
          schema_version: COMPILE_PACK_SCHEMA_VERSION,
          status: "compiled",
          output_file: publicCompilePackPath(packed.outputFile, invocationRoot),
          package_id: compiled.package_id,
          title: compiled.title,
          ...(compiled.domain_pack ? { domain_pack: compiled.domain_pack } : {}),
          source_mode: compiled.source_mode,
          parser_backend: compiled.parser_backend,
          parser_timeout_ms: compiled.parser_timeout_ms,
          ocr_mode: compiled.ocr_mode,
          resource_limits: {
            ...compiled.resource_limits,
            package_write_strategy: packed.packStrategy
          },
          ...(compiled.source_analysis_cache
            ? { source_analysis_cache: publicCompilePackSourceAnalysisCache(compiled.source_analysis_cache, invocationRoot) }
            : {}),
          source_files: compiled.source_files.map((source) => publicCompilePackSourceSummary(source, invocationRoot)),
          file_count: compiled.file_count,
          packed_file_count: packed.fileCount,
          single_file_package: true,
          no_zip_output: true,
          query_index: contextSummary.query_index,
          warnings: compiled.warnings,
          plan_summary: compiled.plan_summary,
          validation_status: compiled.validation_status,
          validation: compiled.validation,
          safety,
          privacy: compilePackPrivacy(false)
        };

        return {
          exitCode: compiled.validation_status === "invalid" ? 1 : 0,
          output: formatCompilePackResult(result, format)
        };
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      const debugStackOptIn = isDebugStackOptIn();
      const debug = formatDebugStack(error);
      return {
        exitCode: 1,
        output: formatCompilePackResult(
          {
            schema_version: COMPILE_PACK_SCHEMA_VERSION,
            status: "blocked",
            ...(outputFile ? { output_file: publicCompilePackPath(outputFile, invocationRoot) } : {}),
            ...debug,
            reason: sanitizeCompilePackError(error instanceof Error ? error.message : "编译单文件 .insight 失败"),
            safety,
            privacy: compilePackPrivacy(debugStackOptIn)
          },
          format
        )
      };
    }
  }

  if (command === "compile") {
    const sourceArg = positionalArgs[0];
    const outputArg = positionalArgs[1];
    const outputDir = outputArg ? path.resolve(invocationRoot, outputArg) : undefined;

    try {
      if (!sourceArg || !outputArg) {
        throw new Error(
          "用法：insight compile <source-file> <output-dir> [--source <extra-file>] [--title <title>] [--package-id <id>] [--template <text>] [--template-file <file>] [--domain <domain-id>] [--source-mode source_bundled|source_light] [--parser auto|builtin|markitdown] [--ocr off|llm] [--parser-timeout-ms <ms>] [--max-source-bytes <bytes|KB|MB|GB>] [--max-total-source-bytes <bytes|KB|MB|GB>] [--max-normalized-bytes <bytes|KB|MB|GB>] [--max-total-normalized-bytes <bytes|KB|MB|GB>] [--source-analysis-cache-dir <dir>] [--format json|text]"
        );
      }

      const result = await compileDraftToDirectory({
        commandArgs,
        invocationRoot,
        sourceArg,
        outputDir: path.resolve(invocationRoot, outputArg),
        schemaRoot,
        packageWriteStrategy: "expanded_directory",
        markitdownConvert: options.markitdownConvert,
        spreadsheetFormulaExtract: options.spreadsheetFormulaExtract
      });

      return {
        exitCode: result.validation_status === "invalid" ? 1 : 0,
        output: formatCompileDraftResult(result, format)
      };
    } catch (error) {
      return {
        exitCode: 1,
        output: formatCompileDraftResult(
          {
            schema_version: COMPILE_DRAFT_SCHEMA_VERSION,
            status: "blocked",
            ...(outputDir ? { output_dir: outputDir } : {}),
            ...formatDebugStack(error),
            reason: error instanceof Error ? error.message : "编译草稿包失败"
          },
          format
        )
      };
    }
  }

  if (command === "pack") {
    if (!secondArg) {
      throw new Error("用法：insight pack <source-dir> <output-file> [--force]");
    }

    const validation = await validateInsightPackage(packageRoot, { schemaRoot });

    if (validation.status === "invalid" && !flags.has("--force")) {
      return {
        exitCode: 1,
        output: JSON.stringify(
          {
            schema_version: PACK_SCHEMA_VERSION,
            status: "refused",
            reason: "文件包未通过校验。如仍需打包，请重新运行并加上 --force。",
            validation
          },
          null,
          2
        )
      };
    }

    const result = await packInsightDirectory({
      sourceDir: packageRoot,
      outputFile: path.resolve(invocationRoot, secondArg)
    });

    return {
      exitCode: 0,
      output: JSON.stringify(
        {
          schema_version: PACK_SCHEMA_VERSION,
          status: "packed",
          ...result,
          validation_status: validation.status,
          forced: validation.status === "invalid" && flags.has("--force")
        },
        null,
        2
      )
    };
  }

  if (command === "unpack") {
    if (!secondArg) {
      throw new Error("用法：insight unpack <archive-file> <output-dir>");
    }

    return {
      exitCode: 0,
      output: JSON.stringify(
        {
          schema_version: UNPACK_SCHEMA_VERSION,
          status: "unpacked",
          ...(await unpackInsightArchive({
            archiveFile: packageRoot,
            outputDir: path.resolve(invocationRoot, secondArg)
          }))
        },
        null,
        2
      )
    };
  }

  if (command === "export-request") {
    if (!secondArg || !thirdArg) {
      throw new Error("用法：insight export-request <package-root> <request-id> <output-dir> [--format json|text]");
    }

    const exportResult = await exportDataRequestPackage({
      packageRoot,
      requestId: secondArg,
      outputDir: path.resolve(invocationRoot, thirdArg)
    });
    const validation = await validateInsightPackage(exportResult.output_dir, { schemaRoot });
    const result = {
      schema_version: REQUEST_EXPORT_SCHEMA_VERSION,
      ...exportResult,
      validation_status: validation.status,
      validation
    };

    return {
      exitCode: validation.status === "invalid" ? 1 : 0,
      output: formatExportRequestResult(result, format)
    };
  }

  if (command === "create-response") {
    if (!secondArg) {
      throw new Error("用法：insight create-response <request-package-root> <output-dir> [--supplement <file>] [--format json|text]");
    }

    const createResult = await createDataResponsePackage({
      requestPackageRoot: packageRoot,
      outputDir: path.resolve(invocationRoot, secondArg),
      supplementPaths: getFlagValues(commandArgs, "--supplement").map((supplementPath) => path.resolve(invocationRoot, supplementPath))
    });
    const validation = await validateInsightPackage(createResult.output_dir, { schemaRoot });
    const result = {
      schema_version: RESPONSE_CREATE_SCHEMA_VERSION,
      ...createResult,
      validation_status: validation.status,
      validation
    };

    return {
      exitCode: validation.status === "invalid" ? 1 : 0,
      output: formatCreateResponseResult(result, format)
    };
  }

  if (command === "summarize-response") {
    if (!secondArg) {
      throw new Error("用法：insight summarize-response <parent-package-root> <response-package-root> [--format json|text]");
    }

    const responsePackageRoot = path.resolve(invocationRoot, secondArg);
    const summary = await summarizeDataResponsePackage({
      parentPackageRoot: packageRoot,
      responsePackageRoot
    });
    const parentValidation = await validateInsightPackage(packageRoot, { schemaRoot });
    const responseValidation = await validateInsightPackage(responsePackageRoot, { schemaRoot });
    const validationIssues = [
      ...(parentValidation.status === "invalid" ? [`PARENT_PACKAGE_INVALID: 母包存在 ${parentValidation.issues.length} 个校验问题`] : []),
      ...(responseValidation.status === "invalid" ? [`RESPONSE_PACKAGE_INVALID: response 包存在 ${responseValidation.issues.length} 个校验问题`] : [])
    ];
    const status: DataResponseMergeSummary["status"] =
      summary.compatibility_issues.length === 0 && validationIssues.length === 0 ? "ready" : "blocked";
    const result = {
      schema_version: RESPONSE_SUMMARY_SCHEMA_VERSION,
      ...summary,
      status,
      validation: {
        parent_status: parentValidation.status,
        response_status: responseValidation.status
      },
      compatibility_issues: [...summary.compatibility_issues, ...validationIssues],
      review_tasks: status === "blocked" ? [] : summary.review_tasks
    };

    return {
      exitCode: result.status === "blocked" ? 1 : 0,
      output: formatResponseMergeSummaryResult(result, format)
    };
  }

  if (command === "merge-response") {
    if (!secondArg || !thirdArg) {
      throw new Error("用法：insight merge-response <parent-package-root> <response-package-root> <output-dir> [--format json|text]");
    }

    const responsePackageRoot = path.resolve(invocationRoot, secondArg);
    const outputDir = path.resolve(invocationRoot, thirdArg);
    const summary = await summarizeDataResponsePackage({
      parentPackageRoot: packageRoot,
      responsePackageRoot
    });
    const parentValidation = await validateInsightPackage(packageRoot, { schemaRoot });
    const responseValidation = await validateInsightPackage(responsePackageRoot, { schemaRoot });
    const validationIssues = [
      ...(parentValidation.status === "invalid" ? [`PARENT_PACKAGE_INVALID: 母包存在 ${parentValidation.issues.length} 个校验问题`] : []),
      ...(responseValidation.status === "invalid" ? [`RESPONSE_PACKAGE_INVALID: response 包存在 ${responseValidation.issues.length} 个校验问题`] : [])
    ];
    const status: DataResponseMergeSummary["status"] =
      summary.compatibility_issues.length === 0 && validationIssues.length === 0 ? "ready" : "blocked";
    const summaryWithValidation = {
      schema_version: RESPONSE_SUMMARY_SCHEMA_VERSION,
      ...summary,
      status,
      validation: {
        parent_status: parentValidation.status,
        response_status: responseValidation.status
      },
      compatibility_issues: [...summary.compatibility_issues, ...validationIssues],
      review_tasks: status === "blocked" ? [] : summary.review_tasks
    };

    if (summaryWithValidation.status === "blocked") {
      return {
        exitCode: 1,
        output: formatMergeResponseResult(
          {
            schema_version: RESPONSE_MERGE_SCHEMA_VERSION,
            status: "blocked",
            output_dir: outputDir,
            summary: summaryWithValidation
          },
          format
        )
      };
    }

    const mergeResult = await mergeDataResponsePackage({
      parentPackageRoot: packageRoot,
      responsePackageRoot,
      outputDir
    });
    const mergedValidation = await validateInsightPackage(mergeResult.output_dir, { schemaRoot });
    const result = {
      schema_version: RESPONSE_MERGE_SCHEMA_VERSION,
      ...mergeResult,
      validation_status: mergedValidation.status,
      validation: mergedValidation
    };

    return {
      exitCode: mergedValidation.status === "invalid" ? 1 : 0,
      output: formatMergeResponseResult(result, format)
    };
  }

  if (command === "review-patch") {
    if (!secondArg || !thirdArg || !fourthArg) {
      throw new Error("用法：insight review-patch <package-root> <patch-id> <approve|reject> <output-dir> [--format json|text]");
    }

    const outputDir = path.resolve(invocationRoot, fourthArg);
    const sourceValidation = await validateInsightPackage(packageRoot, { schemaRoot });

    if (sourceValidation.status === "invalid") {
      return {
        exitCode: 1,
        output: formatReviewPatchResult(
          {
            schema_version: REVIEW_PATCH_SCHEMA_VERSION,
            status: "blocked",
            patch_id: secondArg,
            decision: thirdArg,
            output_dir: outputDir,
            reason: `来源包未通过校验：${sourceValidation.issues.length} 个问题`,
            validation_status: sourceValidation.status,
            validation: sourceValidation
          },
          format
        )
      };
    }

    try {
      const reviewResult = await reviewPatch({
        packageRoot,
        patchId: secondArg,
        decision: thirdArg as ReviewPatchDecision,
        outputDir
      });
      const reviewedValidation = await validateInsightPackage(reviewResult.output_dir, { schemaRoot });
      const result = {
        schema_version: REVIEW_PATCH_SCHEMA_VERSION,
        ...reviewResult,
        validation_status: reviewedValidation.status,
        validation: reviewedValidation
      };

      return {
        exitCode: reviewedValidation.status === "invalid" ? 1 : 0,
        output: formatReviewPatchResult(result, format)
      };
    } catch (error) {
      return {
        exitCode: 1,
        output: formatReviewPatchResult(
          {
            schema_version: REVIEW_PATCH_SCHEMA_VERSION,
            status: "blocked",
            patch_id: secondArg,
            decision: thirdArg,
            output_dir: outputDir,
            reason: error instanceof Error ? error.message : "审阅补丁失败"
          },
          format
        )
      };
    }
  }

  if (command === "apply-review-patch") {
    if (!secondArg || !thirdArg) {
      throw new Error("用法：insight apply-review-patch <package-root> <patch-id> <output-dir> [--format json|text]");
    }

    const outputDir = path.resolve(invocationRoot, thirdArg);
    const sourceValidation = await validateInsightPackage(packageRoot, { schemaRoot });

    if (sourceValidation.status === "invalid") {
      return {
        exitCode: 1,
        output: formatApplyReviewPatchResult(
          {
            schema_version: APPLY_REVIEW_PATCH_SCHEMA_VERSION,
            status: "blocked",
            patch_id: secondArg,
            output_dir: outputDir,
            reason: `来源包未通过校验：${sourceValidation.issues.length} 个问题`,
            validation_status: sourceValidation.status,
            validation: sourceValidation
          },
          format
        )
      };
    }

    try {
      const applyResult = await applyReviewPatch({
        packageRoot,
        patchId: secondArg,
        outputDir
      });
      const appliedValidation = await validateInsightPackage(applyResult.output_dir, { schemaRoot });
      const result = {
        schema_version: APPLY_REVIEW_PATCH_SCHEMA_VERSION,
        ...applyResult,
        validation_status: appliedValidation.status,
        validation: appliedValidation
      };

      return {
        exitCode: appliedValidation.status === "invalid" ? 1 : 0,
        output: formatApplyReviewPatchResult(result, format)
      };
    } catch (error) {
      return {
        exitCode: 1,
        output: formatApplyReviewPatchResult(
          {
            schema_version: APPLY_REVIEW_PATCH_SCHEMA_VERSION,
            status: "blocked",
            patch_id: secondArg,
            output_dir: outputDir,
            reason: error instanceof Error ? error.message : "应用审阅补丁失败"
          },
          format
        )
      };
    }
  }

  if (command === "add-overlay-note") {
    if (!secondArg || !thirdArg || !fourthArg || !fifthArg) {
      throw new Error(
        "用法：insight add-overlay-note <package-root> <target-type> <target-id> <note-body> <output-dir> [--format json|text]"
      );
    }

    const outputDir = path.resolve(invocationRoot, fifthArg);
    const sourceValidation = await validateInsightPackage(packageRoot, { schemaRoot });

    if (sourceValidation.status === "invalid") {
      return {
        exitCode: 1,
        output: formatAddOverlayNoteResult(
          {
            schema_version: OVERLAY_NOTE_SCHEMA_VERSION,
            status: "blocked",
            output_dir: outputDir,
            reason: `来源包未通过校验：${sourceValidation.issues.length} 个问题`,
            validation_status: sourceValidation.status,
            validation: sourceValidation
          },
          format
        )
      };
    }

    try {
      const overlayResult = await addOverlayNote({
        packageRoot,
        targetType: secondArg as OverlayTargetType,
        targetId: thirdArg,
        body: fourthArg,
        outputDir
      });
      const overlayValidation = await validateInsightPackage(overlayResult.output_dir, { schemaRoot });
      const result = {
        schema_version: OVERLAY_NOTE_SCHEMA_VERSION,
        ...overlayResult,
        validation_status: overlayValidation.status,
        validation: overlayValidation
      };

      return {
        exitCode: overlayValidation.status === "invalid" ? 1 : 0,
        output: formatAddOverlayNoteResult(result, format)
      };
    } catch (error) {
      return {
        exitCode: 1,
        output: formatAddOverlayNoteResult(
          {
            schema_version: OVERLAY_NOTE_SCHEMA_VERSION,
            status: "blocked",
            output_dir: outputDir,
            reason: error instanceof Error ? error.message : "添加 overlay 笔记失败"
          },
          format
        )
      };
    }
  }

  if (command === "import-overlay-followup") {
    if (!secondArg || !thirdArg) {
      throw new Error(
        "用法：insight import-overlay-followup <package-root> <followup-json> <output-dir> [--format json|text]"
      );
    }

    const outputDir = path.resolve(invocationRoot, thirdArg);
    const sourceValidation = await validateInsightPackage(packageRoot, { schemaRoot });

    if (sourceValidation.status === "invalid") {
      return {
        exitCode: 1,
        output: formatImportOverlayFollowupResult(
          {
            schema_version: OVERLAY_FOLLOWUP_IMPORT_SCHEMA_VERSION,
            status: "blocked",
            output_dir: outputDir,
            reason: `来源包未通过校验：${sourceValidation.issues.length} 个问题`,
            validation_status: sourceValidation.status,
            validation: sourceValidation
          },
          format
        )
      };
    }

    try {
      const followupResult = await importOverlayFollowup({
        packageRoot,
        followupFile: path.resolve(invocationRoot, secondArg),
        outputDir
      });
      const followupValidation = await validateInsightPackage(followupResult.output_dir, { schemaRoot });
      const result = {
        schema_version: OVERLAY_FOLLOWUP_IMPORT_SCHEMA_VERSION,
        ...followupResult,
        validation_status: followupValidation.status,
        validation: followupValidation
      };

      return {
        exitCode: followupValidation.status === "invalid" ? 1 : 0,
        output: formatImportOverlayFollowupResult(result, format)
      };
    } catch (error) {
      return {
        exitCode: 1,
        output: formatImportOverlayFollowupResult(
          {
            schema_version: OVERLAY_FOLLOWUP_IMPORT_SCHEMA_VERSION,
            status: "blocked",
            output_dir: outputDir,
            reason: error instanceof Error ? error.message : "导入 overlay 追问处理建议失败"
          },
          format
        )
      };
    }
  }

  return {
    exitCode: 0,
    output: `Open Insight CLI

用法：
  insight model-status [--format json|text]
  insight version
  insight version <status|log> <package-file-or-dir> [--format json|text]
  insight version derive <package-file-or-dir> <output.insight> [--branch <name>] [--reason <text>] [--format json|text]
  insight version rollback <package-file-or-dir> <commit-or-ref> <output.insight> [--reason <text>] [--format json|text]
  insight version merge <base-package> <other-package> <output.insight> [--branch <name>] [--reason <text>] [--format json|text]
  insight --version
  insight model-list [--format json|text]
  insight model-ping [--format json|text]
  insight model-smoke <package-root> <question> [--save-overlay <output-dir>] [--format json|text]
  insight domain-list [--format json|text]
  insight interop check [--schema-root <dir>] [--summary-only] [--format json|text]
  insight schema check [--schema-root <dir>] [--format json|text]
  insight conformance list [--format json|text]
  insight conformance check [--format json|text]
  insight conformance inspect <asset-id|asset-path> [--format json|text]
  insight inspect <package-file-or-dir> [--format json|text]
  insight validate <package-file-or-dir> [--format json|text]
  insight context <summary|list-sources|list-objects|query-table|search-chunks|token-eval|handoff|resolve-source|diagnostics|material-contract|recommend-outputs> <package-file-or-dir> [args] [--format json|text]
  insight mcp serve <package-file-or-dir> --transport stdio
  insight mcp serve --unbound --transport stdio
  insight ask <package-root> <question> [--model auto|deterministic|mock|real] [--save-overlay <output-dir>] [--format json|text]
  insight compile-pack <source-file> <output.insight> [--source <extra-file>] [--title <title>] [--package-id <id>] [--template <text>] [--template-file <file>] [--domain <domain-id>] [--source-mode source_bundled|source_light] [--parser auto|builtin|markitdown] [--ocr off|llm] [--parser-timeout-ms <ms>] [--max-source-bytes <bytes|KB|MB|GB>] [--max-total-source-bytes <bytes|KB|MB|GB>] [--max-normalized-bytes <bytes|KB|MB|GB>] [--max-total-normalized-bytes <bytes|KB|MB|GB>] [--source-analysis-cache-dir <dir>] [--format json|text]
  insight compile <source-file> <output-dir> [--source <extra-file>] [--title <title>] [--package-id <id>] [--template <text>] [--template-file <file>] [--domain <domain-id>] [--source-mode source_bundled|source_light] [--parser auto|builtin|markitdown] [--ocr off|llm] [--parser-timeout-ms <ms>] [--max-source-bytes <bytes|KB|MB|GB>] [--max-total-source-bytes <bytes|KB|MB|GB>] [--max-normalized-bytes <bytes|KB|MB|GB>] [--max-total-normalized-bytes <bytes|KB|MB|GB>] [--source-analysis-cache-dir <dir>] [--format json|text]
  insight pack <source-dir> <output-file> [--force]
  insight unpack <archive-file> <output-dir>
  insight export-request <package-root> <request-id> <output-dir> [--format json|text]
  insight create-response <request-package-root> <output-dir> [--supplement <file>] [--format json|text]
  insight summarize-response <parent-package-root> <response-package-root> [--format json|text]
  insight merge-response <parent-package-root> <response-package-root> <output-dir> [--format json|text]
  insight review-patch <package-root> <patch-id> <approve|reject> <output-dir> [--format json|text]
  insight apply-review-patch <package-root> <patch-id> <output-dir> [--format json|text]
  insight add-overlay-note <package-root> <target-type> <target-id> <note-body> <output-dir> [--format json|text]
  insight import-overlay-followup <package-root> <followup-json> <output-dir> [--format json|text]
`
  };
}

async function runContextCommand(args: string[], invocationRoot: string, format: string): Promise<CliResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0] ?? "summary";
  const packageArg = positionalArgs[1];

  if (!packageArg) {
    throw new Error(
      "用法：insight context <summary|list-sources|list-objects|query-table|search-chunks|token-eval|handoff|resolve-source|diagnostics|material-contract|recommend-outputs> <package-root> [args] [--format json|text]"
    );
  }

  const packageInput = path.resolve(invocationRoot, packageArg);

  return withReadablePackageRoot(packageInput, async (packageRoot) => {

  if (subcommand === "summary") {
    const result: ContextCliResult = {
      schema_version: CONTEXT_SUMMARY_SCHEMA_VERSION,
      ...(await summarizeContextPackage(packageRoot))
    };

    return {
      exitCode: result.status === "ok" || result.status === "unsupported" || result.status === "degraded" ? 0 : 1,
      output: formatContextResult(result, format)
    };
  }

  if (subcommand === "list-sources") {
    const result: ContextCliResult = {
      schema_version: CONTEXT_SOURCES_SCHEMA_VERSION,
      ...(await listContextSources(packageRoot))
    };

    return {
      exitCode: result.status === "ok" || result.status === "unsupported" || result.status === "degraded" ? 0 : 1,
      output: formatContextResult(result, format)
    };
  }

  if (subcommand === "list-objects") {
    const kind = getFlagValue(args, "--kind");
    const result: ContextCliResult = {
      schema_version: CONTEXT_OBJECTS_SCHEMA_VERSION,
      ...(await listContextObjects(packageRoot, kind ? { kind: kind as ContextObjectKind } : {}))
    };

    return {
      exitCode: result.status === "ok" || result.status === "unsupported" || result.status === "degraded" ? 0 : 1,
      output: formatContextResult(result, format)
    };
  }

  if (subcommand === "query-table") {
    const tableId = positionalArgs[2];
    const op = getFlagValue(args, "--op");
    const filter = getFlagValue(args, "--filter");

    if (!tableId || !op) {
      throw new Error("用法：insight context query-table <package-root> <table-id> --op sum:<field>|count|average:<field> [--filter field=value] [--format json|text]");
    }

    const result: ContextCliResult = {
      schema_version: CONTEXT_TABLE_QUERY_SCHEMA_VERSION,
      ...(await queryContextTable(packageRoot, tableId, {
        op: op as "count" | `sum:${string}` | `average:${string}`,
        ...(filter ? { filter } : {})
      }))
    };

    return { exitCode: result.status === "ok" || result.status === "unsupported" ? 0 : 1, output: formatContextResult(result, format) };
  }

  if (subcommand === "search-chunks") {
    const query = positionalArgs[2];

    if (!query) {
      throw new Error("用法：insight context search-chunks <package-root> <query> [--document-id <id>]... [--limit 5] [--format json|text]");
    }

    const limit = parseOptionalPositiveInteger(getFlagValue(args, "--limit"), "--limit");
    const compact = hasFlag(args, "--compact");
    const tokenBudget = parseOptionalPositiveInteger(getFlagValue(args, "--token-budget"), "--token-budget");
    const documentIds = getFlagValues(args, "--document-id");
    const includePageFurniture = hasFlag(args, "--include-page-furniture");
    const searchResult = await searchContextChunksForCli(packageRoot, query, {
      ...(documentIds.length > 0 ? { documentIds } : {}),
      ...(includePageFurniture ? { includePageFurniture: true } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(compact ? { compact: true } : {}),
      ...(tokenBudget !== undefined ? { tokenBudget } : {})
    });
    const result = {
      schema_version: compact ? CONTEXT_COMPACT_RETRIEVAL_SCHEMA_VERSION : CONTEXT_CHUNK_SEARCH_SCHEMA_VERSION,
      ...searchResult
    } as ContextCliResult;

    return {
      exitCode: result.status === "ok" || result.status === "unsupported" || result.status === "degraded" ? 0 : 1,
      output: formatContextResult(result, format)
    };
  }

  if (subcommand === "token-eval") {
    const query = getFlagValue(args, "--query") ?? positionalArgs[2];

    if (!query) {
      throw new Error("用法：insight context token-eval <package-root> --query <query> [--document-id <source-id>]... [--token-budget 2000] [--direct-baseline <file-or-dir>] [--format json|text]");
    }

    const tokenBudget = parseOptionalPositiveInteger(getFlagValue(args, "--token-budget"), "--token-budget");
    const documentIds = getFlagValues(args, "--document-id");
    const directBaselinePath = resolveOptionalCliPath(invocationRoot, getFlagValue(args, "--direct-baseline"));
    const directBaselineSummaryPath = resolveOptionalCliPath(invocationRoot, getFlagValue(args, "--direct-baseline-summary"));
    if (directBaselinePath !== undefined && directBaselineSummaryPath !== undefined) {
      throw new Error("--direct-baseline and --direct-baseline-summary cannot be used together.");
    }
    const directBaselineSummary = directBaselineSummaryPath ? await readDirectBaselineSummaryFile(directBaselineSummaryPath) : undefined;
    const directBaselineSourceFilter = getDirectBaselineSourceFilter(args);
    const result: ContextCliResult = {
      schema_version: CONTEXT_TOKEN_EVAL_SCHEMA_VERSION,
      ...(await evaluateContextTokensForCli(packageRoot, query, {
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(directBaselinePath !== undefined ? { directBaselinePath } : {}),
        ...(directBaselineSourceFilter !== undefined ? { directBaselineSourceFilter } : {}),
        ...(directBaselineSummary !== undefined ? { directBaselineSummary } : {})
      }))
    };

    return { exitCode: result.status === "completed" || result.status === "degraded" ? 0 : 1, output: formatContextResult(result, format) };
  }

  if (subcommand === "handoff") {
    const query = getFlagValue(args, "--query") ?? positionalArgs[2];

    if (!query) {
      throw new Error("用法：insight context handoff <package-root> --query <query> [--document-id <source-id>]... [--token-budget 2000] [--direct-baseline <file-or-dir>] [--format json|text]");
    }

    const tokenBudget = parseOptionalPositiveInteger(getFlagValue(args, "--token-budget"), "--token-budget");
    const documentIds = getFlagValues(args, "--document-id");
    const directBaselinePath = resolveOptionalCliPath(invocationRoot, getFlagValue(args, "--direct-baseline"));
    const directBaselineSummaryPath = resolveOptionalCliPath(invocationRoot, getFlagValue(args, "--direct-baseline-summary"));
    if (directBaselinePath !== undefined && directBaselineSummaryPath !== undefined) {
      throw new Error("--direct-baseline and --direct-baseline-summary cannot be used together.");
    }
    const directBaselineSummary = directBaselineSummaryPath ? await readDirectBaselineSummaryFile(directBaselineSummaryPath) : undefined;
    const directBaselineSourceFilter = getDirectBaselineSourceFilter(args);
    const selectedMaterialRouteId = getFlagValue(args, "--route");
    const result: ContextCliResult = {
      schema_version: CONTEXT_HANDOFF_SCHEMA_VERSION,
      ...(await buildContextHandoffForCli(packageRoot, query, {
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(directBaselinePath !== undefined ? { directBaselinePath } : {}),
        ...(directBaselineSourceFilter !== undefined ? { directBaselineSourceFilter } : {}),
        ...(directBaselineSummary !== undefined ? { directBaselineSummary } : {})
      }))
    };

    const focusedResult = focusContextHandoffRoute(result, selectedMaterialRouteId);

    return {
      exitCode: 0,
      output: formatContextResult(focusedResult, format, {
        ...(selectedMaterialRouteId !== undefined ? { selectedMaterialRouteId } : {})
      })
    };
  }

  if (subcommand === "answer-context") {
    const query = getFlagValue(args, "--query") ?? positionalArgs[2];

    if (!query) {
      throw new Error("用法：insight context answer-context <package-root> --query <query> [--document-id <source-id>]... [--token-budget 2000] [--max-follow-up-reads 8] [--direct-baseline <file-or-dir>] [--format json|text]");
    }

    const tokenBudget = parseOptionalPositiveInteger(getFlagValue(args, "--token-budget"), "--token-budget");
    const documentIds = getFlagValues(args, "--document-id");
    const maxFollowUpReads = parseOptionalPositiveInteger(getFlagValue(args, "--max-follow-up-reads"), "--max-follow-up-reads");
    const directBaselinePath = resolveOptionalCliPath(invocationRoot, getFlagValue(args, "--direct-baseline"));
    const directBaselineSummaryPath = resolveOptionalCliPath(invocationRoot, getFlagValue(args, "--direct-baseline-summary"));
    if (directBaselinePath !== undefined && directBaselineSummaryPath !== undefined) {
      throw new Error("--direct-baseline and --direct-baseline-summary cannot be used together.");
    }
    const directBaselineSummary = directBaselineSummaryPath ? await readDirectBaselineSummaryFile(directBaselineSummaryPath) : undefined;
    const directBaselineSourceFilter = getDirectBaselineSourceFilter(args);
    const result: ContextCliResult = {
      schema_version: CONTEXT_ANSWER_CONTEXT_SCHEMA_VERSION,
      ...(await buildContextAnswerContextForCli(packageRoot, query, {
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(maxFollowUpReads !== undefined ? { maxFollowUpReads } : {}),
        ...(directBaselinePath !== undefined ? { directBaselinePath } : {}),
        ...(directBaselineSourceFilter !== undefined ? { directBaselineSourceFilter } : {}),
        ...(directBaselineSummary !== undefined ? { directBaselineSummary } : {})
      }))
    };

    return {
      exitCode: result.status === "ready" || result.status === "needs_more_context" || result.status === "degraded" ? 0 : 1,
      output: formatContextResult(result, format)
    };
  }

  if (subcommand === "resolve-source") {
    const targetId = positionalArgs[2];

    if (!targetId) {
      throw new Error("用法：insight context resolve-source <package-root> <object-or-ref-id> [--format json|text]");
    }

    const result: ContextCliResult = {
      schema_version: CONTEXT_SOURCE_RESOLVE_SCHEMA_VERSION,
      ...(await resolveContextSource(packageRoot, targetId))
    };

    return { exitCode: result.status === "ok" || result.status === "unsupported" ? 0 : 1, output: formatContextResult(result, format) };
  }

  if (subcommand === "diagnostics") {
    const result: ContextCliResult = {
      schema_version: CONTEXT_DIAGNOSTICS_SCHEMA_VERSION,
      ...(await listContextDiagnostics(packageRoot))
    };

    return { exitCode: result.status === "ok" || result.status === "unsupported" ? 0 : 1, output: formatContextResult(result, format) };
  }

  if (subcommand === "material-contract") {
    const result: ContextCliResult = {
      schema_version: CONTEXT_USER_MATERIAL_CONTRACT_SCHEMA_VERSION,
      ...(await buildContextUserMaterialContract(packageRoot))
    };

    return { exitCode: result.status === "ok" || result.status === "unsupported" ? 0 : 1, output: formatContextResult(result, format) };
  }

  if (subcommand === "recommend-outputs") {
    const result: ContextCliResult = {
      schema_version: CONTEXT_OUTPUT_RECOMMENDATIONS_SCHEMA_VERSION,
      ...(await recommendContextOutputs(packageRoot))
    };

    return { exitCode: result.status === "ok" || result.status === "unsupported" ? 0 : 1, output: formatContextResult(result, format) };
  }

  throw new Error(`未知 context 子命令：${subcommand}`);
  });
}

async function runVersionGraphCommand(args: string[], invocationRoot: string, format: string): Promise<CliResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0] ?? "status";
  const packageArg = positionalArgs[1];

  if (!packageArg || !["status", "log", "derive", "rollback", "merge"].includes(subcommand)) {
    throw new Error("用法：insight version <status|log|derive|rollback> <package-root> [args] [--format json|text]");
  }

  const packageInput = path.resolve(invocationRoot, packageArg);

  if (subcommand === "derive") {
    const outputArg = positionalArgs[2];
    if (!outputArg) {
      throw new Error("用法：insight version derive <package-root> <output.insight> [--branch <name>] [--reason <text>] [--format json|text]");
    }

    const outputFile = path.resolve(invocationRoot, outputArg);
    await assertNonMutatingVersionOutput(packageInput, outputFile);
    return withReadablePackageRoot(packageInput, async (packageRoot) => {
      const result = await createDerivedPackage(packageRoot, outputFile, {
        branchName: getFlagValue(args, "--branch") ?? "main",
        reason: getFlagValue(args, "--reason") ?? null
      });
      return { exitCode: 0, output: formatVersionDeriveResult(result, format) };
    });
  }

  if (subcommand === "rollback") {
    const rollbackTarget = positionalArgs[2];
    const outputArg = positionalArgs[3];
    if (!rollbackTarget || !outputArg) {
      throw new Error(
        "用法：insight version rollback <package-root> <commit-or-ref> <output.insight> [--reason <text>] [--format json|text]"
      );
    }

    const outputFile = path.resolve(invocationRoot, outputArg);
    await assertNonMutatingVersionOutput(packageInput, outputFile);
    return withReadablePackageRoot(packageInput, async (packageRoot) => {
      const result = await createRollbackPackage(packageRoot, rollbackTarget, outputFile, {
        reason: getFlagValue(args, "--reason") ?? null
      });
      return { exitCode: 0, output: formatVersionRollbackResult(result, format) };
    });
  }

  if (subcommand === "merge") {
    const otherArg = positionalArgs[2];
    const outputArg = positionalArgs[3];
    if (!otherArg || !outputArg) {
      throw new Error(
        "鐢ㄦ硶锛歩nsight version merge <base-package> <other-package> <output.insight> [--branch <name>] [--reason <text>] [--format json|text]"
      );
    }

    const otherInput = path.resolve(invocationRoot, otherArg);
    const outputFile = path.resolve(invocationRoot, outputArg);
    await assertNonMutatingVersionOutput(packageInput, outputFile);
    await assertNonMutatingVersionOutput(otherInput, outputFile);
    return withReadablePackageRoot(packageInput, async (basePackageRoot) =>
      withReadablePackageRoot(otherInput, async (otherPackageRoot) => {
        const result = await createMergedPackage(basePackageRoot, otherPackageRoot, outputFile, {
          branchName: getFlagValue(args, "--branch") ?? "merge",
          reason: getFlagValue(args, "--reason") ?? null
        });
        return { exitCode: 0, output: formatVersionMergeResult(result, format) };
      })
    );
  }

  return withReadablePackageRoot(packageInput, async (packageRoot) => {
    if (subcommand === "status") {
      const result = await readVersionStatus(packageRoot);
      return { exitCode: 0, output: formatVersionStatusResult(result, format) };
    }

    const result = await readVersionLog(packageRoot);
    return { exitCode: 0, output: formatVersionLogResult(result, format) };
  });
}

async function createDerivedPackage(
  packageRoot: string,
  outputFile: string,
  options: { branchName: string; reason: string | null }
): Promise<VersionDeriveResult> {
  const manifest = await readManifest(packageRoot);
  const branchName = sanitizeVersionSegment(options.branchName);
  const derivedPackageId = `${manifest.package_id}.derived.${branchName}`;
  const derivedTitle = `${manifest.title} - 派生 ${branchName}`;
  const sourcePackageDigest = await hashPackageFiles(packageRoot);
  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-version-derive-"));

  try {
    const workingDir = path.join(tempDir, "package.insight");
    await cp(packageRoot, workingDir, { recursive: true });
    await writePackageManifest(workingDir, {
      package_id: derivedPackageId,
      title: derivedTitle,
      description: appendSentence(manifest.description, `派生自 ${manifest.package_id}，分支 ${branchName}。`)
    });

    const createdAt = new Date().toISOString();
    const commitId = createVersionCommitId("derive", branchName, createdAt);
    await ensureVersionParents(workingDir, {
      role: "base_parent",
      package_id: manifest.package_id,
      title: manifest.title,
      digest: sourcePackageDigest,
      relationship: "derived_from",
      captured_at: createdAt
    });
    await writeVersionRefs(workingDir, {
      packageId: derivedPackageId,
      basePackageId: manifest.package_id,
      currentRef: branchName,
      refName: branchName,
      commitId
    });
    await appendVersionCommit(workingDir, {
      schema_version: "open-insight.version-commit.v0.1",
      event_id: commitId,
      commit_id: commitId,
      event_type: "derive",
      created_at: createdAt,
      package_id: derivedPackageId,
      parent_package_id: manifest.package_id,
      branch_name: branchName,
      reason: options.reason,
      source_package_digest: sourcePackageDigest,
      base_package_mutation: false,
      parent_mutation: false
    });

    const packed = await packInsightDirectory({ sourceDir: workingDir, outputFile });
    return {
      schema_version: VERSION_DERIVE_SCHEMA_VERSION,
      status: "derived",
      source_package_id: manifest.package_id,
      source_title: manifest.title,
      derived_package_id: derivedPackageId,
      derived_title: derivedTitle,
      branch_name: branchName,
      reason: options.reason,
      output_file: path.resolve(outputFile),
      commit_id: commitId,
      source_package_digest: sourcePackageDigest,
      file_count: packed.fileCount,
      version_paths: {
        parents: "versioning/parents.json",
        refs: "versioning/refs.json",
        commits: "versioning/commits.jsonl"
      },
      safety: getVersionWriteSafety()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createRollbackPackage(
  packageRoot: string,
  rollbackTarget: string,
  outputFile: string,
  options: { reason: string | null }
): Promise<VersionRollbackResult> {
  const manifest = await readManifest(packageRoot);
  const targetRef = sanitizeVersionSegment(rollbackTarget);
  const rollbackPackageId = `${manifest.package_id}.rollback.${targetRef}`;
  const rollbackTitle = `${manifest.title} - 回档 ${targetRef}`;
  const sourcePackageDigest = await hashPackageFiles(packageRoot);
  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-version-rollback-"));

  try {
    const workingDir = path.join(tempDir, "package.insight");
    await cp(packageRoot, workingDir, { recursive: true });
    await writePackageManifest(workingDir, {
      package_id: rollbackPackageId,
      title: rollbackTitle,
      description: appendSentence(manifest.description, `记录从 ${manifest.package_id} 回档到 ${rollbackTarget} 的只读派生包。`)
    });

    const createdAt = new Date().toISOString();
    const branchName = `rollback-${targetRef}`;
    const commitId = createVersionCommitId("rollback", targetRef, createdAt);
    await ensureVersionParents(workingDir, {
      role: "derived_parent",
      package_id: manifest.package_id,
      title: manifest.title,
      digest: sourcePackageDigest,
      relationship: "rollback_recorded_from",
      captured_at: createdAt
    });
    await writeVersionRefs(workingDir, {
      packageId: rollbackPackageId,
      basePackageId: manifest.package_id,
      currentRef: branchName,
      refName: branchName,
      commitId
    });
    const rollbackEvent = {
      schema_version: "open-insight.version-commit.v0.1",
      event_id: commitId,
      commit_id: commitId,
      event_type: "rollback",
      created_at: createdAt,
      package_id: rollbackPackageId,
      parent_package_id: manifest.package_id,
      branch_name: branchName,
      rollback_target: rollbackTarget,
      reason: options.reason,
      source_package_digest: sourcePackageDigest,
      base_package_mutation: false,
      parent_mutation: false
    };
    await appendVersionCommit(workingDir, rollbackEvent);
    await appendJsonl(path.join(workingDir, "versioning", "rollback_log.jsonl"), rollbackEvent);

    const packed = await packInsightDirectory({ sourceDir: workingDir, outputFile });
    return {
      schema_version: VERSION_ROLLBACK_SCHEMA_VERSION,
      status: "rollback_recorded",
      source_package_id: manifest.package_id,
      source_title: manifest.title,
      rollback_package_id: rollbackPackageId,
      rollback_title: rollbackTitle,
      rollback_target: rollbackTarget,
      reason: options.reason,
      output_file: path.resolve(outputFile),
      commit_id: commitId,
      source_package_digest: sourcePackageDigest,
      file_count: packed.fileCount,
      version_paths: {
        refs: "versioning/refs.json",
        commits: "versioning/commits.jsonl",
        rollback_log: "versioning/rollback_log.jsonl"
      },
      safety: getVersionWriteSafety()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createMergedPackage(
  basePackageRoot: string,
  otherPackageRoot: string,
  outputFile: string,
  options: { branchName: string; reason: string | null }
): Promise<VersionMergeResult> {
  const baseManifest = await readManifest(basePackageRoot);
  const otherManifest = await readManifest(otherPackageRoot);
  const branchName = sanitizeVersionSegment(options.branchName);
  const mergedPackageId = `${baseManifest.package_id}.merged.${branchName}`;
  const mergedTitle = `${baseManifest.title} - merge ${branchName}`;
  const basePackageDigest = await hashPackageFiles(basePackageRoot);
  const otherPackageDigest = await hashPackageFiles(otherPackageRoot);
  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-version-merge-"));

  try {
    const workingDir = path.join(tempDir, "package.insight");
    await cp(basePackageRoot, workingDir, { recursive: true });
    await writePackageManifest(workingDir, {
      package_id: mergedPackageId,
      title: mergedTitle,
      description: appendSentence(
        baseManifest.description,
        `Record-only non-destructive merge from ${baseManifest.package_id} and ${otherManifest.package_id}.`
      )
    });

    const createdAt = new Date().toISOString();
    const commitId = createVersionCommitId("merge", branchName, createdAt);
    await ensureVersionParents(workingDir, {
      role: "base_parent",
      package_id: baseManifest.package_id,
      title: baseManifest.title,
      digest: basePackageDigest,
      relationship: "merge_base",
      captured_at: createdAt
    });
    await ensureVersionParents(workingDir, {
      role: "derived_parent",
      package_id: otherManifest.package_id,
      title: otherManifest.title,
      digest: otherPackageDigest,
      relationship: "merged_from",
      captured_at: createdAt
    });
    await appendVersionMergedFrom(workingDir, {
      response_id: `version_merge_${commitId}`,
      source_request_id: `manual_version_merge_${commitId}`,
      request_package_id: baseManifest.package_id,
      response_package_id: otherManifest.package_id,
      affected_findings: [],
      merged_at: createdAt,
      relationship: "version_merge",
      source_package_digest: otherPackageDigest
    });
    await writeVersionRefs(workingDir, {
      packageId: mergedPackageId,
      basePackageId: baseManifest.package_id,
      currentRef: branchName,
      refName: branchName,
      commitId
    });

    const mergeEvent = {
      schema_version: "open-insight.version-commit.v0.1",
      event_id: commitId,
      commit_id: commitId,
      event_type: "version_merge",
      created_at: createdAt,
      package_id: mergedPackageId,
      parent_package_id: baseManifest.package_id,
      merged_package_id: otherManifest.package_id,
      branch_name: branchName,
      reason: options.reason,
      base_package_digest: basePackageDigest,
      other_package_digest: otherPackageDigest,
      merge_strategy: "record_only",
      base_package_mutation: false,
      parent_mutation: false
    };
    await appendVersionCommit(workingDir, mergeEvent);
    await appendJsonl(path.join(workingDir, "versioning", "merge_log.jsonl"), mergeEvent);
    await writeVersionDiffSummary(workingDir, {
      schema_version: "open-insight.version-diff-summary.v0.1",
      merge_plan: {
        mode: "explicit_non_destructive",
        parent_mutation: false,
        strategy: "record_only",
        additions: emptyMergeObjectIds(),
        duplicates: emptyMergeObjectIds()
      },
      compatibility_issues: [
        {
          severity: "warning",
          code: "VERSION_MERGE_RECORD_ONLY",
          path: "versioning/merge_log.jsonl",
          message: "version merge records parentage and audit trail only; it does not automatically merge business objects."
        }
      ]
    });

    const packed = await packInsightDirectory({ sourceDir: workingDir, outputFile });
    return {
      schema_version: VERSION_MERGE_SCHEMA_VERSION,
      status: "merge_recorded",
      base_package_id: baseManifest.package_id,
      base_title: baseManifest.title,
      other_package_id: otherManifest.package_id,
      other_title: otherManifest.title,
      merged_package_id: mergedPackageId,
      merged_title: mergedTitle,
      branch_name: branchName,
      reason: options.reason,
      output_file: path.resolve(outputFile),
      commit_id: commitId,
      base_package_digest: basePackageDigest,
      other_package_digest: otherPackageDigest,
      file_count: packed.fileCount,
      merge_policy: {
        mode: "explicit_non_destructive",
        parent_mutation: false,
        strategy: "record_only"
      },
      version_paths: {
        parents: "versioning/parents.json",
        refs: "versioning/refs.json",
        commits: "versioning/commits.jsonl",
        merge_log: "versioning/merge_log.jsonl",
        diff_summary: "versioning/diff_summary.json"
      },
      safety: getVersionWriteSafety()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writePackageManifest(
  packageRoot: string,
  updates: { package_id: string; title: string; description?: string }
): Promise<void> {
  const manifestPath = path.join(packageRoot, "manifest.json");
  const manifest = await readJsonFile<Record<string, unknown>>(manifestPath);
  await writeJsonObject(manifestPath, {
    ...manifest,
    package_id: updates.package_id,
    title: updates.title,
    ...(updates.description ? { description: updates.description } : {})
  });
}

async function ensureVersionParents(packageRoot: string, parentRecord: Record<string, unknown>): Promise<void> {
  const parentsPath = path.join(packageRoot, "versioning", "parents.json");
  const existing = await readOptionalJson<VersionParentsFile>(packageRoot, "versioning/parents.json");
  const parents = existing?.parents ?? [];
  const parentPackageId = typeof parentRecord.package_id === "string" ? parentRecord.package_id : undefined;
  const mergedParents = parentPackageId
    ? [...parents.filter((parent) => parent.package_id !== parentPackageId), parentRecord]
    : [...parents, parentRecord];

  await writeJsonObject(parentsPath, {
    schema_version: "open-insight.version-parents.v0.1",
    ...existing,
    parents: mergedParents,
    merged_from: existing?.merged_from ?? [],
    merge_policy: {
      mode: existing?.merge_policy?.mode ?? "explicit_non_destructive",
      parent_mutation: false,
      ...(existing?.merge_policy?.strategy ? { strategy: existing.merge_policy.strategy } : {})
    }
  });
}

async function appendVersionMergedFrom(packageRoot: string, mergedFromRecord: Record<string, unknown>): Promise<void> {
  const parentsPath = path.join(packageRoot, "versioning", "parents.json");
  const existing = await readOptionalJson<VersionParentsFile>(packageRoot, "versioning/parents.json");
  const responsePackageId = typeof mergedFromRecord.response_package_id === "string" ? mergedFromRecord.response_package_id : undefined;
  const mergedFrom = existing?.merged_from ?? [];
  const nextMergedFrom = responsePackageId
    ? [...mergedFrom.filter((entry) => entry.response_package_id !== responsePackageId), mergedFromRecord]
    : [...mergedFrom, mergedFromRecord];

  await writeJsonObject(parentsPath, {
    schema_version: "open-insight.version-parents.v0.1",
    ...(existing ?? {}),
    parents: existing?.parents ?? [],
    merged_from: nextMergedFrom,
    merge_policy: {
      mode: existing?.merge_policy?.mode ?? "explicit_non_destructive",
      parent_mutation: false,
      strategy: existing?.merge_policy?.strategy ?? "record_only"
    }
  });
}

async function writeVersionDiffSummary(packageRoot: string, diffSummary: Record<string, unknown>): Promise<void> {
  await writeJsonObject(path.join(packageRoot, "versioning", "diff_summary.json"), diffSummary);
}

function emptyMergeObjectIds(): Record<string, string[]> {
  return {
    datasets: [],
    metrics: [],
    claims: [],
    evidence: [],
    prepared_questions: [],
    lineage_sources: []
  };
}

async function writeVersionRefs(
  packageRoot: string,
  options: { packageId: string; basePackageId: string; currentRef: string; refName: string; commitId: string }
): Promise<void> {
  const refsPath = path.join(packageRoot, "versioning", "refs.json");
  const existing = await readOptionalJson<VersionRefsFile>(packageRoot, "versioning/refs.json");
  await writeJsonObject(refsPath, {
    schema_version: "open-insight.version-refs.v0.1",
    package_id: options.packageId,
    base_package_id: existing?.base_package_id ?? options.basePackageId,
    current: options.currentRef,
    refs: {
      ...(existing?.refs ?? {}),
      [options.refName]: options.commitId
    }
  });
}

async function appendVersionCommit(packageRoot: string, event: Record<string, unknown>): Promise<void> {
  await appendJsonl(path.join(packageRoot, "versioning", "commits.jsonl"), event);
}

async function appendJsonl(filePath: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { flag: "a" });
}

async function writeJsonObject(filePath: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function hashPackageFiles(packageRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await listPackageFiles(packageRoot);

  for (const file of files) {
    hash.update(file.relativePath.replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}

function appendSentence(value: string | undefined, sentence: string): string {
  const base = value?.trim();
  return base ? `${base} ${sentence}` : sentence;
}

function createVersionCommitId(kind: "derive" | "rollback" | "merge", segment: string, createdAt: string): string {
  const timestamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14);
  return `commit_${kind}_${timestamp}_${sanitizeVersionSegment(segment)}`;
}

function getVersionWriteSafety(): VersionWriteSafety {
  return {
    base_package_mutation: false,
    model_invoked: false,
    package_code_execution: false
  };
}

async function assertNonMutatingVersionOutput(packageInput: string, outputFile: string): Promise<void> {
  const resolvedPackageInput = path.resolve(packageInput);
  const resolvedOutputFile = path.resolve(outputFile);

  if (resolvedPackageInput === resolvedOutputFile) {
    throw new Error("拒绝覆盖输入 .insight：version derive / rollback / merge 必须写出新的 .insight 文件。");
  }

  try {
    const inputStat = await stat(resolvedPackageInput);
    if (inputStat.isDirectory() && isPathInside(resolvedPackageInput, resolvedOutputFile)) {
      throw new Error("拒绝把派生输出写入输入包目录内部：这会污染 base package。请输出到独立 .insight 文件。");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("污染 base package")) {
      throw error;
    }
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function withReadablePackageRoot<T>(packageInput: string, action: (readablePackageRoot: string) => Promise<T>): Promise<T> {
  const resolvedInput = path.resolve(packageInput);

  let inputStat: Awaited<ReturnType<typeof stat>>;
  try {
    inputStat = await stat(resolvedInput);
  } catch {
    return action(resolvedInput);
  }

  if (inputStat.isDirectory()) {
    return action(resolvedInput);
  }

  if (!inputStat.isFile()) {
    throw new Error(`无法读取 .insight 输入：${resolvedInput}`);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-readable-"));
  try {
    await unpackInsightArchive({ archiveFile: resolvedInput, outputDir: tempDir });
    return await action(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function formatVersionInfo(invocationRoot: string): Promise<string> {
  const version = await readWorkspaceVersion(invocationRoot);

  return [
    `Open Insight ${version}`,
    `.insight spec: ${INSIGHT_SPEC_VERSION}`,
    "Public Beta baseline: conformance 49/49, issue_code_assets 23/23, schema 20/20",
    "说明：该输出为人类可读版本信息，不属于 CLI JSON 机器契约。"
  ].join("\n");
}

async function readWorkspaceVersion(invocationRoot: string): Promise<string> {
  try {
    const raw = await readFile(path.resolve(invocationRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };

    return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function inspectPackage(root: string, schemaRoot: string): Promise<InspectPackageSummary> {
  const manifest = await readManifest(root);
  const catalog = await readOptionalJson<{ datasets?: unknown[] }>(root, "data/catalog.json");
  const metrics = await readOptionalJson<{ metrics?: unknown[] }>(root, "semantic/metrics.json");
  const entities = await readOptionalJson<{ entities?: unknown[] }>(root, "semantic/entities.json");
  const homepage = await readOptionalJson<{ blocks?: unknown[] }>(root, "views/homepage.json");
  const lineage = await readOptionalJson<{ sources?: unknown[] }>(root, "lineage/sources.json");
  const filePaths = (await listPackageFiles(root)).map((file) => normalizePackagePath(file.relativePath));
  const validation = await validateInsightPackage(root, { schemaRoot });

  return {
    schema_version: "open-insight.inspect-summary.v0.1",
    package_id: manifest.package_id,
    title: manifest.title,
    spec_version: manifest.spec_version,
    package_type: manifest.package_type,
    required_capabilities: manifest.required_capabilities,
    optional_capabilities: manifest.optional_capabilities ?? [],
    counts: {
      datasets: catalog?.datasets?.length ?? 0,
      metrics: metrics?.metrics?.length ?? 0,
      entities: entities?.entities?.length ?? 0,
      view_blocks: homepage?.blocks?.length ?? 0,
      claims: await countJsonl(root, "findings/claims.jsonl"),
      evidence: await countJsonl(root, "evidence/evidence.jsonl"),
      prepared_questions: await countJsonl(root, "qa/prepared_questions.jsonl"),
      data_requests: await countJsonl(root, "answerability/data_requests.jsonl"),
      lineage_sources: lineage?.sources?.length ?? 0
    },
    files: {
      total: filePaths.length,
      source_assets: filePaths.filter(isSourceAssetPath).length,
      executable_like: filePaths.filter(isExecutableLookingPath).length
    },
    validation: {
      status: validation.status,
      errors: validation.issues.filter((issue) => issue.severity === "error").length,
      warnings: validation.issues.filter((issue) => issue.severity === "warning").length,
      issue_codes: summarizeIssueCodes(validation.issues)
    },
    fallbacks: manifest.fallbacks ?? {}
  };
}

async function listConformanceAssets(invocationRoot: string): Promise<ConformanceListResult> {
  const exampleNames = (await readdir(path.resolve(invocationRoot, "examples"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".insight"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const exampleAssets: ConformanceAsset[] = exampleNames.map((exampleName) => {
    const fixturePath = `examples/${exampleName}`;
    const id = exampleName.replace(/\.insight$/, "");

    return {
      id,
      kind: "example",
      path: fixturePath,
      expected_validation_status: "valid",
      purpose: id === "sales-basic-overlay" ? "AI overlay 成功样例，覆盖私有问答、待审 AI 草稿和证据来源追踪。" : "valid 示例包。",
      reader_studio_focus:
        id === "sales-basic-overlay"
          ? [
              "展示私有 overlay 注释和问答。",
              "识别 ai_generated + needs_review 的模型草稿。",
              "追到 claim、evidence、dataset 和 lineage source。"
            ]
          : ["能通过 Validator。", "Reader 能展示核心内容。", "不依赖真实模型 key。"],
      tests:
        id === "sales-basic-overlay"
          ? ["tests/example-packages-conformance.test.ts", "tests/model-overlay-example-conformance.test.ts"]
          : ["tests/example-packages-conformance.test.ts"]
    };
  });

  return {
    status: "ok",
    schema_version: "open-insight.conformance.v0.1",
    assets: [...exampleAssets, ...FIXED_CONFORMANCE_ASSETS].map(normalizeConformanceAsset),
    commands: [
      "npm test -- tests/example-packages-conformance.test.ts",
      "npm test -- tests/model-overlay-example-conformance.test.ts tests/overlay-followup-import-conformance.test.ts tests/followup-unsafe-mutation-conformance.test.ts tests/structured-compatibility-issue-conformance.test.ts tests/unsafe-ai-overlay-conformance.test.ts tests/core-readiness-gap-conformance.test.ts tests/traceability-warning-conformance.test.ts tests/lineage-gap-conformance.test.ts tests/third-party-generator-traceability-gap-conformance.test.ts tests/third-party-generator-minimal-success-conformance.test.ts tests/unknown-optional-capability-conformance.test.ts tests/sales-domain-pack-landing-conformance.test.ts tests/government-project-domain-pack-landing-conformance.test.ts tests/bond-domain-pack-landing-conformance.test.ts tests/contract-domain-pack-landing-conformance.test.ts tests/manufacturing-domain-pack-landing-conformance.test.ts tests/supply-chain-domain-pack-landing-conformance.test.ts tests/channel-inventory-domain-pack-landing-conformance.test.ts tests/healthcare-domain-pack-landing-conformance.test.ts tests/education-domain-pack-landing-conformance.test.ts tests/domain-pack-extension-conformance.test.ts tests/unsafe-versioning-conformance.test.ts tests/validator-failure-fixtures-conformance.test.ts tests/conformance-fixture-coverage.test.ts tests/reader-chinese-question-conformance.test.ts packages/insight-validator/src/index.test.ts",
      "npm test -- tests/conformance-docs.test.ts"
    ]
  };
}

function normalizeConformanceAsset(asset: ConformanceAsset): ConformanceAsset {
  return {
    ...asset,
    expected_issue_codes: asset.expected_issue_codes ?? []
  };
}

async function inspectConformanceAsset(
  invocationRoot: string,
  schemaRoot: string,
  target: string
): Promise<ConformanceInspectResult | undefined> {
  const list = await listConformanceAssets(invocationRoot);
  const normalizedTarget = normalizePackagePath(target);
  const asset = list.assets.find((candidate) => candidate.id === target || normalizePackagePath(candidate.path) === normalizedTarget);

  if (!asset) {
    return undefined;
  }

  return inspectConformanceAssetRecord(invocationRoot, schemaRoot, asset);
}

async function checkConformanceAssets(invocationRoot: string, schemaRoot: string): Promise<ConformanceCheckResult> {
  const list = await listConformanceAssets(invocationRoot);
  const assets = await Promise.all(list.assets.map((asset) => inspectConformanceAssetRecord(invocationRoot, schemaRoot, asset)));
  const failed = assets.filter((asset) => !asset.matches_expected).length;
  const issueCodeAssets = assets.filter((asset) => (asset.asset.expected_issue_codes?.length ?? 0) > 0);
  const issueCodeAssetsPassed = issueCodeAssets.filter((asset) => asset.matches_expected_issue_codes).length;
  const issueCodeAssetsFailed = issueCodeAssets.length - issueCodeAssetsPassed;

  return {
    status: failed === 0 ? "ok" : "failed",
    schema_version: "open-insight.conformance.v0.1",
    total: assets.length,
    passed: assets.length - failed,
    failed,
    issue_code_assets: issueCodeAssets.length,
    issue_code_assets_passed: issueCodeAssetsPassed,
    issue_code_assets_failed: issueCodeAssetsFailed,
    assets
  };
}

async function runInteropCheck(invocationRoot: string, schemaRoot: string, summaryOnly = false): Promise<InteropCheckResult> {
  const schema = await inspectSchemaRoot(schemaRoot);

  if (schema.status !== "ok") {
    return {
      schema_version: "open-insight.interop-check.v0.1",
      status: "failed",
      summary_only: summaryOnly,
      schema,
      conformance: {
        status: "skipped",
        reason: "schema check failed",
        total: 0,
        passed: 0,
        failed: 0,
        issue_code_assets: 0,
        issue_code_assets_passed: 0,
        issue_code_assets_failed: 0,
        assets: []
      }
    };
  }

  const conformance = await checkConformanceAssets(invocationRoot, schemaRoot);

  return {
    schema_version: "open-insight.interop-check.v0.1",
    status: conformance.status === "ok" ? "ok" : "failed",
    summary_only: summaryOnly,
    schema,
    conformance: summaryOnly ? { ...conformance, assets: [] } : conformance
  };
}

async function inspectConformanceAssetRecord(
  invocationRoot: string,
  schemaRoot: string,
  asset: ConformanceAsset
): Promise<ConformanceInspectResult> {
  const validation = await validateInsightPackage(path.resolve(invocationRoot, asset.path), { schemaRoot });
  const issueCodes = summarizeIssueCodes(validation.issues);
  const expectedIssueCodes = asset.expected_issue_codes ?? [];
  const missingExpectedIssueCodes = expectedIssueCodes.filter((issueCode) => !issueCodes[issueCode]);
  const matchesExpectedStatus = validation.status === asset.expected_validation_status;
  const matchesExpectedIssueCodes = missingExpectedIssueCodes.length === 0;
  const matchesExpected = matchesExpectedStatus && matchesExpectedIssueCodes;

  return {
    status: matchesExpected ? "ok" : "mismatch",
    schema_version: "open-insight.conformance.v0.1",
    asset,
    actual_validation_status: validation.status,
    matches_expected_status: matchesExpectedStatus,
    matches_expected_issue_codes: matchesExpectedIssueCodes,
    matches_expected: matchesExpected,
    missing_expected_issue_codes: missingExpectedIssueCodes,
    issue_codes: issueCodes,
    issues: validation.issues,
    recommended_behavior: buildConformanceRecommendedBehavior(asset)
  };
}

function buildConformanceRecommendedBehavior(asset: ConformanceAsset): string[] {
  if (asset.id === "missing-manifest") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以只读显示诊断，但不得继续按洞察资产展示。",
      "制作方必须补齐合法 manifest.json 后再进入发布或展示流程。"
    ];
  }

  if (asset.id === "missing-spec-version") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以只读显示诊断，但不得假定该包符合 v0.1 或其他协议版本。",
      "制作方必须补齐稳定 spec_version 后再进入发布、展示或 AI 加工流程。"
    ];
  }

  if (asset.id === "manifest-parse-error") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以只读显示诊断，但不得继续按洞察资产展示或发布。",
      "制作方必须先修复 manifest.json 的 JSON 完整性，再进入 schema 校验或 AI 加工流程。"
    ];
  }

  if (asset.id === "data-request-jsonl-parse-error") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以继续只读打开核心内容，但不得把 data request 列表解释为完整可信的补数链路。",
      "制作方必须先修复损坏的 JSONL 行，再进入补数流程、展示层或 AI 加工。"
    ];
  }

  if (asset.id === "homepage-json-parse-error") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以显示诊断并按只读方式打开其他核心内容，但不得把损坏的 homepage 当作可信默认视图。",
      "制作方必须先修复 homepage.json 的 JSON 完整性，再进入展示层编辑、导出或 AI 加工。"
    ];
  }

  if (asset.id === "data-request-file-read-error") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以继续只读打开核心内容，但不得把 data request 列表解释为完整可信的补数链路。",
      "制作方必须先修复 data_requests.jsonl 的文件形态，再进入补数流程、展示层或 AI 加工。"
    ];
  }

  if (asset.id === "unsafe-ai-overlay") {
    return [
      "Validator 应判定为 invalid。",
      "Reader 应继续展示核心内容，但输出 UNSAFE_OVERLAY warning。",
      "Studio 只能作为待审 AI 草稿素材导入，不得自动确认或回写 base package。"
    ];
  }

  if (asset.id === "unsafe-extension") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得加载或执行不安全 namespace 对应的扩展。",
      "第三方工具应只读展示核心内容，并明确提示该扩展声明不可信。"
    ];
  }

  if (asset.id === "unsafe-versioning") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得执行 replace_parent 或 parent_mutation = true 的合并计划。",
      "任何把补充内容自动提升为 verified 的策略都必须被阻断并进入人工审阅。",
      "review history 或 review patch 声明 base_package_mutation = true 时必须只读诊断，不得应用。"
    ];
  }

  if (asset.id === "broken-reference") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得把缺失 claim、metric 或 evidence 的展示块解释为可信证据链。",
      "制作方必须补齐或删除断裂引用后再发布。"
    ];
  }

  if (asset.id === "duplicate-ids") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得在重复 ID 对象中任选一个作为可信来源。",
      "制作方必须消除重复 ID，保证对象索引和证据定位唯一。"
    ];
  }

  if (asset.id === "schema-invalid") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以展示诊断信息，但不得把 schema 不完整内容当作可发布资产。",
      "第三方生成器应先修复必填字段、类型和 manifest 基础结构。"
    ];
  }

  if (asset.id === "prepared-question-missing-data-request") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得把缺失 data request 的预置问答解释为完整可追溯问答。",
      "制作方必须补齐 answerability/data_requests.jsonl 或删除断裂的 data_request_id。"
    ];
  }

  if (asset.id === "overlay-target-reference-gap") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以只读显示诊断，但不得把无法定位的 overlay 私有笔记合并进可信上下文。",
      "制作方必须修正 package、question 和 view block 的 target_id，或删除断裂笔记。"
    ];
  }

  if (asset.id === "core-readiness-gap") {
    return [
      "Validator 应判定为 valid_with_warnings。",
      "Reader 应继续只读打开核心内容，但必须提示核心 capability 和核心文件缺口。",
      "Studio / 生成器必须补齐 required_capabilities 和 lineage/sources.json 后再作为完整资产发布。"
    ];
  }

  if (asset.id === "semantic-reference-gap") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得基于重复字段名、未知数据集或未知主键字段继续生成可信分析。",
      "制作方必须修正 data/catalog.json、semantic/metrics.json 和 semantic/entities.json 的引用关系。"
    ];
  }

  if (asset.id === "traceability-warning") {
    return [
      "Validator 应判定为 valid_with_warnings。",
      "Reader 可以打开核心内容，但必须提示部分展示块缺少证据或来源追踪。",
      "Studio 应把该包作为可修复草稿处理，要求补齐 view_block、claim/metric、evidence 和 lineage。"
    ];
  }

  if (asset.id === "lineage-gap") {
    return [
      "Validator 应判定为 valid_with_warnings。",
      "Reader 可以打开核心内容，但必须提示 dataset 与 evidence source_refs 没有完整进入 lineage。",
      "Studio 应把该包作为可修复草稿处理，要求补齐 lineage/sources.json 或修正 evidence source_refs。"
    ];
  }

  if (asset.id === "third-party-generator-traceability-gap") {
    return [
      "Validator 应判定为 valid_with_warnings。",
      "Reader 可以只读打开核心内容，但必须展示第三方生成器追踪缺口 warning，不能把该包解释为完整证据闭环。",
      "Studio / 生成器必须补齐 view_block、claim/metric、evidence、source 和 lineage 后才能发布，并保持 needs_review / compiler_generated 状态。"
    ];
  }

  if (asset.id === "third-party-generator-minimal-success") {
    return [
      "Validator 应判定为 valid。",
      "Reader 可以只读打开完整追踪闭环的生成器草稿，但仍应展示 needs_review / compiler_generated 状态。",
      "Studio / 生成器发布前仍需保留 needs_review / compiler_generated 状态，不能自动 verified、执行包内代码或污染 base package。"
    ];
  }

  if (asset.id === "unknown-optional-capability") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应忽略未知 optional capability，同时继续展示核心内容。",
      "任何第三方扩展都不能因为出现在 optional_capabilities 中而被自动执行。"
    ];
  }

  if (asset.id === "domain-pack-capability-gap") {
    return [
      "Validator 应判定为 valid_with_warnings。",
      "Reader / Studio 应继续打开核心内容，但提示 manifest.extensions 缺少行业包扩展。",
      "Studio 应把该包作为可修复草稿处理，要求补齐安全的 domain pack extension。"
    ];
  }

  if (asset.id === "sales-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 sales_operation 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把 unanswerable 的老客复购问题改写成已验证结论。",
      "经营建议和必答问题必须保留 needs_review 人工复核状态，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "government-project-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 government_project_performance 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把缺少合同节点、验收材料、资金支付凭证或整改闭环证明的待审问题改写成已验证结论。",
      "财政、审计、问责、正式绩效评价、财政处罚相关判断必须保留 requires_expert_review 和人工复核，不得伪装成正式绩效评价报告、审计意见、财政处罚或问责依据，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "bond-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 bond_analysis 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把 unanswerable 的契约、评级或担保材料缺口改写成已验证结论。",
      "投资判断、偿债能力、违约风险和担保有效性必须保留 not_advice 与 requires_expert_review，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "contract-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 contract_review 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把 unanswerable 的附件、授权文件或履约材料缺口改写成已验证结论。",
      "合同风险、付款违约、争议解决和授权有效性判断必须保留 not_advice 与 requires_expert_review，不得解释为正式法律意见，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "manufacturing-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 manufacturing_quality 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把缺少设备参数、班组、测试治具、返工成本、客户投诉、停线或 CAPA 闭环材料的待审问题改写成已验证结论。",
      "CAPA、供应商整改、客户投诉、召回、停线和处罚建议必须保留 requires_expert_review 和人工复核，不得伪装成已完成 8D/CAPA 结论，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "supply-chain-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 supply_chain_fulfillment 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把缺少库存快照、供应商 ASN、生产排程、承运商轨迹或客户承诺变更记录的问题改写成已验证结论。",
      "客户赔付、供应商处罚、生产排期调整和履约承诺变更必须保留 requires_expert_review 和人工复核，不得伪装成正式合同责任认定、客户赔付依据或供应商处罚决定，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "channel-inventory-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 channel_inventory_collaboration 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把缺少促销计划、销售预测、在途库存、渠道政策、安全库存口径、调拨能力或经销商反馈的问题改写成已验证结论。",
      "补货、调拨、清仓、采购承诺、渠道配额调整、渠道处罚和客户承诺必须保留 requires_expert_review 和人工复核，不得伪装成自动执行指令、采购订单、渠道处罚或客户承诺，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "healthcare-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 healthcare_quality_control 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把缺少病案首页、医嘱、手术记录、随访、诊断编码或医保结算材料的问题改写成已验证结论。",
      "医疗安全、诊疗质量、科室责任和医保合规判断必须保留 requires_expert_review 与人工复核，不得解释为诊断、治疗建议、医疗事故认定、行政处罚依据或医保拒付结论，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "education-domain-pack-landing") {
    return [
      "Validator 应判定为 valid。",
      "Reader / Studio 应只读展示 education_quality_analysis 规则落地结果。",
      "不能执行 Domain Pack 代码，不能自动 verified，也不能把缺少基线成绩、缺勤原因、作业迟交原因、课堂观察、家校沟通或个别化支持计划的问题改写成已验证结论。",
      "涉及未成年人、单个学生支持、风险预警、招生录取、分班、升学、纪律处分或教师绩效的判断必须保留 requires_expert_review 与人工复核，不得作为高影响教育决策或单个学生标签化依据，并继续追到 view_block、claim/metric、evidence 与 source。"
    ];
  }

  if (asset.id === "unsafe-domain-pack") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 不得把 required = true 的行业包扩展解释为必须执行的运行时依赖。",
      "制作方必须把行业包扩展改为 required=false，补齐 domain.pack 能力，并修正 domain_id 与 namespace。"
    ];
  }

  if (asset.id === "overlay-followup-import") {
    return [
      "Validator 应判定为 valid。",
      "Reader 应展示追问处理派生包上下文、待审追问和补数请求。",
      "Studio 应能导入为审阅计划，并保持 base_package_mutation = false。"
    ];
  }

  if (asset.id === "followup-unsafe-mutation") {
    return [
      "Validator 应判定为 valid。",
      "Reader 应输出 UNSAFE_FOLLOWUP_IMPORT，并只读展示该追问处理补数请求。",
      "Studio 应允许只读审阅派生包，但不得把含 base_package_mutation=true 补数请求的候选自动加入审阅计划。"
    ];
  }

  if (asset.id === "sales-basic-overlay") {
    return [
      "Validator 应判定为 valid。",
      "Reader 应展示 AI 生成且待审阅的 overlay 问答。",
      "Studio 导入时应保留来源状态，但仍作为制作方待审素材。"
    ];
  }

  if (asset.expected_validation_status === "invalid") {
    return [
      "Validator 应判定为 invalid。",
      "Reader / Studio 可以只读展示诊断信息，但不得把该包作为可信可发布资产。",
      "制作方必须修复错误后再重新校验和发布。"
    ];
  }

  if (asset.expected_validation_status === "valid_with_warnings") {
    return [
      "Validator 应判定为 valid_with_warnings。",
      "Reader 可以打开核心内容，但必须显示 warning 并降级解释相关内容。",
      "Studio 应把 warning 作为发布前修复项处理。"
    ];
  }

  return ["Validator 应判定为 valid。", "Reader 应能展示核心内容。", "没有真实模型 key 时仍应可打开和校验。"];
}

async function runModelSmoke(options: {
  packageRoot: string;
  question: string;
  schemaRoot: string;
  saveOverlayOutputDir?: string;
  modelFetch?: FetchLike;
}): Promise<ModelSmokeResult> {
  const warnings: ModelSmokeWarning[] = [];
  const modelStatus = getModelStatusResult();
  const modelList = await listConfiguredModels(options.modelFetch);

  if (modelList.status !== "ok") {
    warnings.push({
      source: "model-list",
      status: modelList.status,
      reason: modelList.reason,
      ...(modelList.diagnostic_code ? { diagnostic_code: modelList.diagnostic_code } : {})
    });
  }

  if (!modelStatus.available) {
    return {
      schema_version: MODEL_SMOKE_SCHEMA_VERSION,
      status: "blocked",
      package_root: options.packageRoot,
      question: options.question,
      reason: modelStatus.message,
      diagnostic_code: "MODEL_CONFIG_MISSING",
      model_status: modelStatus,
      model_list: modelList,
      model_list_required: false,
      warnings
    };
  }

  const validation = await validateInsightPackage(options.packageRoot, { schemaRoot: options.schemaRoot });

  if (validation.status === "invalid") {
    return {
      schema_version: MODEL_SMOKE_SCHEMA_VERSION,
      status: "blocked",
      package_root: options.packageRoot,
      question: options.question,
      reason: `来源包未通过校验：${validation.issues.length} 个问题`,
      diagnostic_code: "PACKAGE_VALIDATION_FAILED",
      model_status: modelStatus,
      model_list: modelList,
      model_list_required: false,
      warnings,
      validation_status: validation.status,
      validation
    };
  }

  const modelPing = await pingConfiguredModel(options.modelFetch);

  if (modelPing.status !== "ok") {
    return {
      schema_version: MODEL_SMOKE_SCHEMA_VERSION,
      status: "failed",
      package_root: options.packageRoot,
      question: options.question,
      reason: modelPing.reason,
      ...(modelPing.diagnostic_code ? { diagnostic_code: modelPing.diagnostic_code } : {}),
      model_status: modelStatus,
      model_list: modelList,
      model_list_required: false,
      model_ping: modelPing,
      warnings,
      validation_status: validation.status,
      validation
    };
  }

  const ask = await askPackage(options.packageRoot, options.question, "real", validation.status, options.modelFetch);

  if (!isModelSmokeAskSuccess(ask)) {
    return {
      schema_version: MODEL_SMOKE_SCHEMA_VERSION,
      status: ask.status === "blocked" ? "blocked" : "failed",
      package_root: options.packageRoot,
      question: options.question,
      reason: describeModelSmokeAskFailure(ask),
      ...(ask.diagnostic_code ? { diagnostic_code: ask.diagnostic_code } : {}),
      model_status: modelStatus,
      model_list: modelList,
      model_list_required: false,
      model_ping: modelPing,
      ask,
      warnings,
      validation_status: validation.status,
      validation
    };
  }

  let overlay: AskOverlaySaveResult | undefined;

  if (options.saveOverlayOutputDir) {
    try {
      overlay = await saveAskOverlay(options.packageRoot, options.saveOverlayOutputDir, ask, options.schemaRoot);
    } catch (error) {
      return {
        schema_version: MODEL_SMOKE_SCHEMA_VERSION,
        status: "failed",
        package_root: options.packageRoot,
        question: options.question,
        reason: error instanceof Error ? error.message : "保存 smoke overlay 失败",
        diagnostic_code: "OVERLAY_SAVE_FAILED",
        model_status: modelStatus,
        model_list: modelList,
        model_list_required: false,
        model_ping: modelPing,
        ask,
        warnings,
        validation_status: validation.status,
        validation
      };
    }

    if (overlay.validation_status === "invalid") {
      return {
        schema_version: MODEL_SMOKE_SCHEMA_VERSION,
        status: "failed",
        package_root: options.packageRoot,
        question: options.question,
        reason: "smoke overlay 保存成功，但输出包未通过校验",
        diagnostic_code: "OVERLAY_VALIDATION_FAILED",
        model_status: modelStatus,
        model_list: modelList,
        model_list_required: false,
        model_ping: modelPing,
        ask,
        warnings,
        validation_status: validation.status,
        validation,
        overlay
      };
    }
  }

  return {
    schema_version: MODEL_SMOKE_SCHEMA_VERSION,
    status: "ok",
    package_root: options.packageRoot,
    question: options.question,
    model_status: modelStatus,
    model_list: modelList,
    model_list_required: false,
    model_ping: modelPing,
    ask,
    warnings,
    ...(overlay ? { overlay } : {}),
    message: overlay ? "真实模型本地 smoke 通过，overlay 已保存并通过校验。" : "真实模型本地 smoke 通过。"
  };
}

async function saveAskOverlay(packageRoot: string, outputDir: string, askResult: AskSuccessResult, schemaRoot: string): Promise<AskOverlaySaveResult> {
  const overlayResult = await addOverlayQa({
    packageRoot,
    outputDir,
    askResult
  });
  const overlayValidation = await validateInsightPackage(overlayResult.output_dir, { schemaRoot });

  return {
    schema_version: OVERLAY_QA_SAVE_SCHEMA_VERSION,
    ...overlayResult,
    validation_status: overlayValidation.status,
    validation: overlayValidation
  };
}

function isModelSmokeAskSuccess(result: AskCommandResult): result is AskSuccessResult {
  return (
    result.status === "answered" &&
    result.resolved_model_mode === "real" &&
    result.model_enabled === true &&
    result.source === "grounded_model" &&
    result.generation_status === "ai_generated" &&
    result.review_status === "needs_review"
  );
}

function describeModelSmokeAskFailure(result: AskCommandResult): string {
  if (result.status === "blocked") {
    return result.reason;
  }

  if (result.generation_status === "model_error") {
    return result.model_error?.message ?? "真实模型问答回退到确定性答案";
  }

  return [
    "真实模型问答未满足 smoke 成功条件",
    `status=${result.status}`,
    `resolved_model_mode=${result.resolved_model_mode}`,
    `model_enabled=${result.model_enabled}`,
    `source=${result.source}`,
    `generation_status=${result.generation_status}`,
    `review_status=${result.review_status}`
  ].join("；");
}

async function hasContextAnswerLayer(packageRoot: string): Promise<boolean> {
  if (await packageRelativePathExists(packageRoot, "query_index/manifest.json")) {
    return true;
  }

  if (await packageDirectoryHasEntries(packageRoot, "source/normalized")) {
    return true;
  }

  return packageRelativePathExists(packageRoot, "kernel/capsule_map.json");
}

async function packageRelativePathExists(packageRoot: string, relativePath: string): Promise<boolean> {
  try {
    await stat(path.join(packageRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function packageDirectoryHasEntries(packageRoot: string, relativePath: string): Promise<boolean> {
  try {
    return (await readdir(path.join(packageRoot, relativePath))).length > 0;
  } catch {
    return false;
  }
}

function rewriteAskPackageRoot(result: AskCommandResult, packageRoot: string): AskCommandResult {
  return {
    ...result,
    package_root: packageRoot
  };
}

async function askContextPackage(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  validationStatus: string,
  modelFetch: FetchLike | undefined,
  commandArgs: string[]
): Promise<AskCommandResult> {
  const tokenBudget = parseOptionalPositiveInteger(getFlagValue(commandArgs, "--token-budget"), "--token-budget") ?? 4000;
  const maxFollowUpReads = parseOptionalPositiveInteger(getFlagValue(commandArgs, "--max-follow-up-reads"), "--max-follow-up-reads") ?? 4;
  const answerContext = await buildContextAnswerContextForCli(packageRoot, question, {
    tokenBudget,
    maxFollowUpReads
  });

  if (answerContext.status === "degraded") {
    return formatContextHandoffAskResult(packageRoot, question, requestedModelMode, "deterministic", answerContext, validationStatus);
  }

  if (requestedModelMode === "deterministic") {
    return formatContextHandoffAskResult(packageRoot, question, requestedModelMode, "deterministic", answerContext, validationStatus);
  }

  if (requestedModelMode === "mock") {
    const modelOutput = buildMockContextModelOutput(question, answerContext);
    return formatContextModelAskResult(packageRoot, question, requestedModelMode, "mock", "mock", answerContext, modelOutput, validationStatus);
  }

  const envResolution = resolveOpenAICompatibleModelConfigFromEnv();

  if (!envResolution.available) {
    if (requestedModelMode === "real") {
      return {
        schema_version: "open-insight.ask-result.v0.1",
        status: "blocked",
        package_root: packageRoot,
        question,
        requested_model_mode: requestedModelMode,
        reason: envResolution.message,
        diagnostic_code: "MODEL_CONFIG_MISSING",
        validation_status: validationStatus
      };
    }

    return formatContextHandoffAskResult(packageRoot, question, requestedModelMode, "deterministic", answerContext, validationStatus);
  }

  let adapter: ReturnType<typeof createOpenAICompatibleModelAdapterFromEnv>;

  try {
    adapter = createOpenAICompatibleModelAdapterFromEnv(undefined, modelFetch ? { fetch: modelFetch } : {});
  } catch {
    adapter = undefined;
  }

  if (!adapter) {
    return {
      schema_version: "open-insight.ask-result.v0.1",
      status: "blocked",
      package_root: packageRoot,
      question,
      requested_model_mode: requestedModelMode,
      reason: "真实模型配置解析成功，但模型适配器创建失败。",
      diagnostic_code: "MODEL_ADAPTER_CREATE_FAILED",
      validation_status: validationStatus
    };
  }

  try {
    const structured = await chatForContextStructuredOutput(adapter, question, answerContext);

    return {
      ...formatContextModelAskResult(packageRoot, question, requestedModelMode, "real", adapter.name, answerContext, structured, validationStatus),
      model_config: {
        source: envResolution.source,
        ...envResolution.config
      }
    };
  } catch (error) {
    return formatContextModelRejectedAskResult(packageRoot, question, requestedModelMode, "real", adapter.name, answerContext, error, validationStatus);
  }
}

async function chatForContextStructuredOutput(
  adapter: NonNullable<ReturnType<typeof createOpenAICompatibleModelAdapterFromEnv>>,
  question: string,
  answerContext: ContextAnswerContextResult
): Promise<ContextModelStructuredOutput> {
  const chat = await adapter.chat({
    messages: buildContextAnswerModelMessages(question, answerContext),
    temperature: 0,
    max_tokens: 3200,
    response_format: { type: "json_object" }
  });

  try {
    return parseContextModelStructuredOutput(chat.content, answerContext);
  } catch (firstError) {
    if (!isRepairableContextJsonError(firstError)) {
      throw firstError;
    }

    const repairChat = await adapter.chat({
      messages: buildContextAnswerModelRepairMessages(question, answerContext, chat.content, firstError),
      temperature: 0,
      max_tokens: 2400,
      response_format: { type: "json_object" }
    });

    try {
      return parseContextModelStructuredOutput(repairChat.content, answerContext);
    } catch (repairError) {
      throw new Error(`模型 JSON 修复重试仍未通过：首次错误=${getCliUnknownErrorMessage(firstError)}；重试错误=${getCliUnknownErrorMessage(repairError)}`);
    }
  }
}

function buildMockContextModelOutput(question: string, answerContext: ContextAnswerContextResult): ContextModelStructuredOutput {
  const sourceRefs = answerContext.allowed_reference_ids.source_refs.slice(0, 3);
  const lineageRefs = answerContext.allowed_reference_ids.lineage_refs.slice(0, 3);
  const parseDiagnosticIds = answerContext.allowed_reference_ids.parse_diagnostic_ids.slice(0, 3);
  const sourceMapRefs = answerContext.allowed_reference_ids.source_map_refs.slice(0, 3);

  return {
    schema_version: "open_insight.context_answer.v0.1",
    status: "answered",
    answer: `模拟模型基于 Open Insight answer-context 回答：${question}。请人工复核；引用 ${sourceRefs.join(", ")}。`,
    source_refs: sourceRefs,
    lineage_refs: lineageRefs,
    parse_diagnostic_ids: parseDiagnosticIds,
    source_map_refs: sourceMapRefs,
    generation_status: "ai_generated",
    review_status: "needs_review"
  };
}

function buildContextAnswerModelMessages(question: string, answerContext: ContextAnswerContextResult): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是读取 Open Insight answer-context 的外部 LLM。",
        "只能根据用户问题、compact_context、context_window.fragments 和 allowed_reference_ids 作答。",
        "必须先直接回答，再列出证据引用；上下文不足时要明确说不足，不能编造。",
        "不得新增、替换或删除 allowed_reference_ids 之外的 source_refs、lineage_refs、parse_diagnostic_ids、source_map_refs。",
        "只返回 JSON 对象，不返回 Markdown、脚本、解释性前后缀或调试内容。",
        "answer 字段控制在 1200 个中文字符以内；如果内容很多，先列要点和引用，不要展开成长报告。",
        "JSON 必须包含 schema_version、status、answer、source_refs、lineage_refs、parse_diagnostic_ids、source_map_refs、generation_status、review_status。",
        "schema_version 必须是 open_insight.context_answer.v0.1；generation_status 必须是 ai_generated；review_status 必须是 needs_review。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          question,
          answer_context: {
            status: answerContext.status,
            source_mode: answerContext.source_mode,
            recommended_mode: answerContext.recommended_mode,
            answer_handoff_status: answerContext.answer_handoff_status,
            compact_context: answerContext.compact_context,
            context_window: answerContext.context_window,
            allowed_reference_ids: answerContext.allowed_reference_ids,
            diagnostics: answerContext.diagnostics,
            answer_policy: answerContext.answer_policy
          },
          output_contract: {
            schema_version: "open_insight.context_answer.v0.1",
            status: "answered | unanswerable",
            generation_status: "ai_generated",
            review_status: "needs_review"
          }
        },
        null,
        2
      )
    }
  ];
}

function buildContextAnswerModelRepairMessages(
  question: string,
  answerContext: ContextAnswerContextResult,
  previousContent: string,
  error: unknown
): Array<{ role: "system" | "user"; content: string }> {
  const compactRepairContext = {
    question,
    allowed_reference_ids: answerContext.allowed_reference_ids,
    compact_context: {
      status: answerContext.compact_context.status,
      facts: answerContext.compact_context.facts.slice(0, 24),
      key_numbers: answerContext.compact_context.key_numbers.slice(0, 24),
      tables: answerContext.compact_context.tables.slice(0, 12),
      source_refs: answerContext.compact_context.source_refs,
      lineage_refs: answerContext.compact_context.lineage_refs,
      parse_diagnostic_ids: answerContext.compact_context.parse_diagnostic_ids,
      source_map_refs: answerContext.compact_context.source_map_refs
    },
    context_window: {
      fragments: answerContext.context_window.fragments.slice(0, 6)
    },
    previous_output: previousContent.slice(0, 4000),
    previous_error: getCliUnknownErrorMessage(error),
    output_contract: {
      schema_version: "open_insight.context_answer.v0.1",
      status: "answered | unanswerable",
      generation_status: "ai_generated",
      review_status: "needs_review"
    }
  };

  return [
    {
      role: "system",
      content: [
        "上一轮输出不是合法的 Open Insight context answer JSON。",
        "现在只做 JSON 修复：只能返回一个 JSON 对象，不要 Markdown fence，不要解释，不要脚本。",
        "所有引用必须来自 allowed_reference_ids；如果无法可靠回答，status 用 unanswerable。",
        "不得新增 compact_context 或 context_window.fragments 之外的事实、主体、金额、日期或 source id。"
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(compactRepairContext, null, 2)
    }
  ];
}

function parseContextModelStructuredOutput(content: string, answerContext: ContextAnswerContextResult): ContextModelStructuredOutput {
  const parsed = parseJsonObjectAllowingFence(content);

  if (!isRecord(parsed)) {
    throw new Error("模型结构化输出必须是 JSON 对象。");
  }

  const schemaVersion = parsed.schema_version;
  const status = parsed.status;
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  const sourceRefs = stringArrayField(parsed.source_refs);
  const lineageRefs = stringArrayField(parsed.lineage_refs);
  const parseDiagnosticIds = stringArrayField(parsed.parse_diagnostic_ids);
  const sourceMapRefs = stringArrayField(parsed.source_map_refs);

  if (schemaVersion !== "open_insight.context_answer.v0.1") {
    throw new Error("模型结构化输出缺少正确的 schema_version。");
  }

  if (status !== "answered" && status !== "unanswerable") {
    throw new Error("模型结构化输出 status 必须是 answered 或 unanswerable。");
  }

  if (!answer) {
    throw new Error("模型结构化输出 answer 不能为空。");
  }

  if (parsed.generation_status !== "ai_generated") {
    throw new Error("模型结构化输出 generation_status 必须是 ai_generated。");
  }

  if (parsed.review_status !== "needs_review") {
    throw new Error("模型结构化输出 review_status 必须是 needs_review。");
  }

  assertReferenceSubset("source_refs", sourceRefs, answerContext.allowed_reference_ids.source_refs);
  assertReferenceSubset("lineage_refs", lineageRefs, answerContext.allowed_reference_ids.lineage_refs);
  assertReferenceSubset("parse_diagnostic_ids", parseDiagnosticIds, answerContext.allowed_reference_ids.parse_diagnostic_ids);
  assertReferenceSubset("source_map_refs", sourceMapRefs, answerContext.allowed_reference_ids.source_map_refs);

  if (status === "answered" && sourceRefs.length === 0) {
    throw new Error("模型回答 status=answered 时必须至少引用一个 source_ref。");
  }

  return {
    schema_version: "open_insight.context_answer.v0.1",
    status,
    answer,
    source_refs: sourceRefs,
    lineage_refs: lineageRefs,
    parse_diagnostic_ids: parseDiagnosticIds,
    source_map_refs: sourceMapRefs,
    generation_status: "ai_generated",
    review_status: "needs_review"
  };
}

function parseJsonObjectAllowingFence(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  return JSON.parse(candidate) as unknown;
}

function isRepairableContextJsonError(error: unknown): boolean {
  const message = getCliUnknownErrorMessage(error);

  return (
    message.includes("JSON") ||
    message.includes("Unexpected") ||
    message.includes("Unterminated") ||
    message.includes("not valid") ||
    message.includes("缺少正确的 schema_version") ||
    message.includes("必须是 JSON")
  );
}

function getCliUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertReferenceSubset(fieldName: string, actual: string[], allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = actual.filter((value) => !allowedSet.has(value));

  if (unknown.length > 0) {
    throw new Error(`模型输出 ${fieldName} 包含未知引用：${unknown.join(", ")}`);
  }
}

function formatContextHandoffAskResult(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  resolvedModelMode: "deterministic" | "mock" | "real",
  answerContext: ContextAnswerContextResult,
  validationStatus: string
): AskSuccessResult {
  const unanswerable = answerContext.status === "degraded";

  return {
    schema_version: "open-insight.ask-result.v0.1",
    status: unanswerable ? "unanswerable" : "answered",
    answerability_status: unanswerable ? "unanswerable" : "needs_review",
    answer_status: unanswerable ? "unanswerable" : "needs_review",
    package_root: packageRoot,
    question,
    requested_model_mode: requestedModelMode,
    resolved_model_mode: resolvedModelMode,
    model_enabled: false,
    source: "context_answer_handoff",
    generation_status: "not_model_generated",
    review_status: "not_applicable",
    answer: buildContextHandoffAnswerText(answerContext),
    context_answer: buildAskContextAnswerMetadata(answerContext),
    claim_ids: [],
    evidence_ids: [],
    evidence_sources: [],
    data_requests: [],
    validation_status: validationStatus
  };
}

function formatContextModelAskResult(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  resolvedModelMode: "mock" | "real",
  modelAdapter: string,
  answerContext: ContextAnswerContextResult,
  output: ContextModelStructuredOutput,
  validationStatus: string
): AskSuccessResult {
  return {
    schema_version: "open-insight.ask-result.v0.1",
    status: output.status,
    answerability_status: output.status === "answered" ? "answered" : "unanswerable",
    answer_status: output.status === "answered" ? "needs_review" : "unanswerable",
    package_root: packageRoot,
    question,
    requested_model_mode: requestedModelMode,
    resolved_model_mode: resolvedModelMode,
    model_enabled: true,
    model_adapter: modelAdapter,
    source: "context_answer_model",
    generation_status: "ai_generated",
    review_status: "needs_review",
    structured_output: {
      schema_version: "open_insight.context_answer.v0.1",
      parse_status: "valid"
    },
    answer: output.answer,
    context_answer: {
      ...buildAskContextAnswerMetadata(answerContext),
      source_refs: output.source_refs,
      lineage_refs: output.lineage_refs,
      parse_diagnostic_ids: output.parse_diagnostic_ids,
      source_map_refs: output.source_map_refs
    },
    claim_ids: [],
    evidence_ids: [],
    evidence_sources: [],
    data_requests: [],
    validation_status: validationStatus
  };
}

function formatContextModelRejectedAskResult(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  resolvedModelMode: "mock" | "real",
  modelAdapter: string,
  answerContext: ContextAnswerContextResult,
  error: unknown,
  validationStatus: string
): AskSuccessResult {
  const message = error instanceof Error ? error.message : "模型输出未通过 context answer 校验。";

  return {
    schema_version: "open-insight.ask-result.v0.1",
    status: "unanswerable",
    answerability_status: "unanswerable",
    answer_status: "unanswerable",
    package_root: packageRoot,
    question,
    requested_model_mode: requestedModelMode,
    resolved_model_mode: resolvedModelMode,
    model_enabled: true,
    model_adapter: modelAdapter,
    source: "context_answer_handoff",
    generation_status: "model_error",
    review_status: "needs_review",
    structured_output: {
      schema_version: "open_insight.context_answer.v0.1",
      parse_status: "invalid",
      error: message
    },
    model_error: {
      message: `模型输出未被采纳：${message}`,
      code: "MODEL_OUTPUT_REJECTED"
    },
    diagnostic_code: "MODEL_OUTPUT_REJECTED",
    answer: buildContextHandoffAnswerText(answerContext),
    context_answer: buildAskContextAnswerMetadata(answerContext),
    claim_ids: [],
    evidence_ids: [],
    evidence_sources: [],
    data_requests: [],
    validation_status: validationStatus
  };
}

function buildAskContextAnswerMetadata(answerContext: ContextAnswerContextResult): AskContextAnswerMetadata {
  return {
    schema_version: "open_insight.context_answer.v0.1",
    context_schema_version: "open-insight.answer-context.v0.1",
    source: "answer-context",
    answer_context_status: answerContext.status,
    recommended_mode: answerContext.recommended_mode,
    answer_handoff_status: answerContext.answer_handoff_status,
    token_budget: answerContext.token_budget,
    estimated_tokens: answerContext.context_window.estimated_tokens,
    compact_estimated_tokens: answerContext.context_window.compact_estimated_tokens,
    fragment_count: answerContext.context_window.fragment_count,
    source_count: answerContext.context_window.source_count,
    allowed_reference_ids: answerContext.allowed_reference_ids,
    source_mode: answerContext.source_mode,
    diagnostics: answerContext.diagnostics,
    source_refs: answerContext.source_refs,
    lineage_refs: answerContext.lineage_refs,
    parse_diagnostic_ids: answerContext.parse_diagnostic_ids,
    source_map_refs: answerContext.source_map_refs,
    base_package_mutation: false
  };
}

function buildContextHandoffAnswerText(answerContext: ContextAnswerContextResult): string {
  const statusText =
    answerContext.status === "degraded"
      ? "当前 answer-context 已降级，不能生成确定性答案。"
      : "已生成可交给外部 LLM 使用的 answer-context；答案必须基于 context_window 与 compact_context，并保持 needs_review。";
  const refs = answerContext.source_refs.slice(0, 8).join(", ") || "暂无 source_refs";

  return [
    statusText,
    `recommended_mode=${answerContext.recommended_mode}`,
    `answer_handoff_status=${answerContext.answer_handoff_status}`,
    `estimated_tokens=${answerContext.context_window.estimated_tokens}`,
    `source_refs=${refs}`
  ].join("\n");
}

async function askPackage(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  validationStatus: string,
  modelFetch?: FetchLike,
  commandArgs: string[] = []
): Promise<AskCommandResult> {
  if (await hasContextAnswerLayer(packageRoot)) {
    return askContextPackage(packageRoot, question, requestedModelMode, validationStatus, modelFetch, commandArgs);
  }

  if (requestedModelMode === "deterministic") {
    return formatDeterministicAskResult(packageRoot, question, requestedModelMode, await answerWithPreparedContext(packageRoot, question), validationStatus);
  }

  if (requestedModelMode === "mock") {
    const grounded = await answerWithGroundedModel(packageRoot, question, new MockModelAdapter());

    return formatGroundedAskResult(packageRoot, question, requestedModelMode, "mock", grounded, validationStatus);
  }

  const envResolution = resolveOpenAICompatibleModelConfigFromEnv();

  if (!envResolution.available) {
    if (requestedModelMode === "real") {
      return {
        schema_version: "open-insight.ask-result.v0.1",
        status: "blocked",
        package_root: packageRoot,
        question,
        requested_model_mode: requestedModelMode,
        reason: envResolution.message,
        diagnostic_code: "MODEL_CONFIG_MISSING",
        validation_status: validationStatus
      };
    }

    return formatDeterministicAskResult(packageRoot, question, requestedModelMode, await answerWithPreparedContext(packageRoot, question), validationStatus);
  }

  let adapter: ReturnType<typeof createOpenAICompatibleModelAdapterFromEnv>;

  try {
    adapter = createOpenAICompatibleModelAdapterFromEnv(undefined, modelFetch ? { fetch: modelFetch } : {});
  } catch {
    adapter = undefined;
  }

  if (!adapter) {
    return {
      schema_version: "open-insight.ask-result.v0.1",
      status: "blocked",
      package_root: packageRoot,
      question,
      requested_model_mode: requestedModelMode,
      reason: "真实模型配置解析成功，但模型适配器创建失败。",
      diagnostic_code: "MODEL_ADAPTER_CREATE_FAILED",
      validation_status: validationStatus
    };
  }

  const grounded = await answerWithGroundedModel(packageRoot, question, adapter);

  return {
    ...formatGroundedAskResult(packageRoot, question, requestedModelMode, "real", grounded, validationStatus),
    model_config: {
      source: envResolution.source,
      ...envResolution.config
    }
  };
}

function formatDeterministicAskResult(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  answer: DeterministicAnswerResult,
  validationStatus: string
): AskSuccessResult {
  return {
    schema_version: "open-insight.ask-result.v0.1",
    status: answer.status,
    answerability_status: answer.answerability_status,
    answer_status: answer.answer_status,
    package_root: packageRoot,
    question,
    requested_model_mode: requestedModelMode,
    resolved_model_mode: "deterministic",
    model_enabled: false,
    source: answer.source,
    ...(answer.question_id ? { question_id: answer.question_id } : {}),
    generation_status: "not_model_generated",
    review_status: "not_applicable",
    answer: answer.answer,
    claim_ids: answer.claim_ids,
    evidence_ids: answer.evidence_ids,
    evidence_sources: answer.evidence_sources,
    data_requests: answer.data_requests,
    validation_status: validationStatus
  };
}

function formatGroundedAskResult(
  packageRoot: string,
  question: string,
  requestedModelMode: AskModelMode,
  resolvedModelMode: "mock" | "real",
  answer: GroundedModelAnswerResult,
  validationStatus: string
): AskSuccessResult {
  const diagnosticCode = answer.model_error?.code ?? inferGroundedModelDiagnosticCode(answer.model_error?.message);
  const modelError = answer.model_error ? { ...answer.model_error, ...(diagnosticCode ? { code: diagnosticCode } : {}) } : undefined;

  return {
    schema_version: "open-insight.ask-result.v0.1",
    status: answer.status,
    answerability_status: answer.answerability_status,
    answer_status: answer.answer_status,
    package_root: packageRoot,
    question,
    requested_model_mode: requestedModelMode,
    resolved_model_mode: resolvedModelMode,
    model_enabled: true,
    model_adapter: answer.model_adapter,
    source: answer.source,
    ...(answer.base_answer.question_id ? { question_id: answer.base_answer.question_id } : {}),
    generation_status: answer.generation_status,
    review_status: answer.review_status,
    structured_output: answer.structured_output,
    ...(modelError ? { model_error: modelError } : {}),
    ...(diagnosticCode ? { diagnostic_code: diagnosticCode } : {}),
    answer: answer.answer,
    base_answer: answer.base_answer,
    claim_ids: answer.claim_ids,
    evidence_ids: answer.evidence_ids,
    evidence_sources: answer.evidence_sources,
    data_requests: answer.data_requests,
    validation_status: validationStatus
  };
}

function inferGroundedModelDiagnosticCode(message: string | undefined): GroundedModelErrorCode | undefined {
  if (!message) {
    return undefined;
  }

  return message.startsWith("模型结构化输出无效") ? "MODEL_OUTPUT_REJECTED" : "MODEL_REQUEST_FAILED";
}

async function readOptionalJson<T>(root: string, relativePath: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path.join(root, relativePath));
  } catch {
    return undefined;
  }
}

async function readOptionalJsonl<T>(root: string, relativePath: string): Promise<T[]> {
  try {
    const raw = await readFile(path.join(root, relativePath), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

async function countJsonl(root: string, relativePath: string): Promise<number> {
  try {
    const raw = await readFile(path.join(root, relativePath), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function compileDraftToDirectory(options: {
  commandArgs: string[];
  invocationRoot: string;
  sourceArg: string;
  outputDir: string;
  schemaRoot: string;
  packageWriteStrategy: CompileResourceLimits["package_write_strategy"];
  markitdownConvert?: MarkitdownConvert | undefined;
  spreadsheetFormulaExtract?: SpreadsheetFormulaExtract | undefined;
}): Promise<CompileDraftCompiledResult> {
  const {
    commandArgs,
    invocationRoot,
    sourceArg,
    outputDir,
    schemaRoot,
    packageWriteStrategy,
    markitdownConvert,
    spreadsheetFormulaExtract
  } = options;
  const resolvedOutputDir = path.resolve(outputDir);
  const templateText = await resolveCompileTemplate(commandArgs, invocationRoot);
  const sourcePaths = [sourceArg, ...getFlagValues(commandArgs, "--source")].map((sourcePath) => path.resolve(invocationRoot, sourcePath));
  const parserBackend = parseCompileParserBackend(getFlagValue(commandArgs, "--parser") ?? "auto");
  const resourceLimits = parseCompileResourceLimits(commandArgs, packageWriteStrategy);
  const sourceStats = await preflightCompileSources(sourcePaths, resourceLimits);
  const parserOptions = await resolveCompileParserOptions(commandArgs, sourcePaths, parserBackend, markitdownConvert);
  const sourceMode = parseCompileSourceMode(getFlagValue(commandArgs, "--source-mode") ?? "source_bundled");
  const sourceAnalysisCache = parseCompileSourceAnalysisCache(commandArgs, invocationRoot);
  const sources = await analyzeCompileSourcesSequentially(
    sourcePaths,
    sourceStats,
    parserBackend,
    parserOptions,
    resourceLimits,
    sourceMode,
    sourceAnalysisCache,
    markitdownConvert,
    spreadsheetFormulaExtract
  );
  const sourcePathWarnings = ensureUniqueCompileSourcePaths(sources);
  const domainPackId = parseCompileDomainPackId(getFlagValue(commandArgs, "--domain"));
  const title = getFlagValue(commandArgs, "--title") ?? `${path.parse(sources[0]?.name ?? "insight").name} 洞察草稿`;
  const packageId =
    getFlagValue(commandArgs, "--package-id") ?? `org.openinsight.drafts.${sanitizeCompileId(path.parse(sources[0]?.name ?? "insight").name)}`;
  const compileResult = await compileInsightDraft({
    title,
    packageId,
    outputDir: resolvedOutputDir,
    ...(templateText !== undefined ? { template: templateText } : {}),
    sources,
    ...(domainPackId ? { domainPack: domainPackId } : {})
  });

  await writeCompileSourceModeFile(resolvedOutputDir, sourceMode);

  if (sourceMode === "source_bundled") {
    await Promise.all(sources.map((source) => copyCompileSourceFile(source, resolvedOutputDir)));
  }

  await writeCompileQueryIndexDatabase(resolvedOutputDir);

  const validation = await validateInsightPackage(resolvedOutputDir, { schemaRoot });
  const fileCount = (await listPackageFiles(resolvedOutputDir)).length;
  const parserWarnings = buildCompileParserWarnings(sources);

  return {
    schema_version: COMPILE_DRAFT_SCHEMA_VERSION,
    status: "compiled",
    output_dir: resolvedOutputDir,
    package_id: packageId,
    title,
    ...(domainPackId ? { domain_pack: domainPackId } : {}),
    source_mode: sourceMode,
    parser_backend: parserBackend,
    parser_timeout_ms: parserOptions.timeoutMs,
    ocr_mode: parserOptions.ocrMode,
    resource_limits: resourceLimits,
    ...(sourceAnalysisCache.enabled ? { source_analysis_cache: publicCompileSourceAnalysisCache(sourceAnalysisCache) } : {}),
    source_files: sources.map((source) => summarizeCompileSource(source, sourceMode)),
    file_count: fileCount,
    warnings: [...compileResult.warnings, ...sourcePathWarnings, ...parserWarnings],
    plan_summary: {
      template_sections: compileResult.plan.templateSections.length,
      questions: compileResult.plan.questions.length,
      metric_suggestions: compileResult.plan.metricSuggestions.length,
      view_suggestions: compileResult.plan.viewSuggestions.length,
      domain_view_suggestions: compileResult.plan.domainViewSuggestions.length,
      data_gaps: compileResult.plan.questions.filter((question) => question.status === "needs_data").length
    },
    validation_status: validation.status,
    validation
  };
}

function buildCompileParserWarnings(sources: CompileSourceAsset[]): string[] {
  return sources.flatMap((source) => {
    const normalized = source.normalized_source;
    const formulaEvidence = source.spreadsheet_formula_evidence;
    const warnings: string[] = [];

    if (normalized && normalized.status !== "ok") {
      warnings.push(`${source.name}: parser=${normalized.parser} status=${normalized.status}；${normalized.message}`);
    }

    if (formulaEvidence?.status === "partial" || formulaEvidence?.status === "unsupported") {
      warnings.push(
        `${source.name}: formula_extractor=${formulaEvidence.extractor} status=${formulaEvidence.status}；${formulaEvidence.message}`
      );
    }

    return warnings;
  });
}

async function analyzeCompileSourcesSequentially(
  sourcePaths: string[],
  sourceStats: Map<string, Awaited<ReturnType<typeof stat>>>,
  parserBackend: CompileParserBackend,
  parserOptions: CompileParserOptions,
  resourceLimits: CompileResourceLimits,
  sourceMode: CompileSourceMode,
  sourceAnalysisCache: CompileSourceAnalysisCacheOptions,
  markitdownConvert?: MarkitdownConvert,
  spreadsheetFormulaExtract?: SpreadsheetFormulaExtract
): Promise<CompileSourceAsset[]> {
  const sources: CompileSourceAsset[] = [];
  let totalNormalizedBytes = 0;
  const total = sourcePaths.length;
  for (const [index, sourcePath] of sourcePaths.entries()) {
    writeCompileProgress(`source ${index + 1}/${total} start: ${path.basename(sourcePath)} (parser=${parserBackend})`);
    const started = performance.now();
    let source: CompileSourceAsset;
    try {
      const sourceStat = sourceStats.get(sourcePath);
      if (!sourceStat) {
        throw new Error(`SOURCE_PREFLIGHT_MISSING：来源 ${path.basename(sourcePath)} 缺少预检元数据。`);
      }
      const cachedSource = await readCompileSourceFromAnalysisCache(sourcePath, sourceStat, parserBackend, parserOptions, sourceMode, sourceAnalysisCache);
      if (cachedSource) {
        source = cachedSource;
        sourceAnalysisCache.hits += 1;
        writeCompileProgress(`source ${index + 1}/${total} cache_hit: ${path.basename(sourcePath)}`);
      } else {
        sourceAnalysisCache.misses += sourceAnalysisCache.enabled ? 1 : 0;
        source = await analyzeCompileSource(
          sourcePath,
          parserBackend,
          parserOptions,
          resourceLimits,
          sourceMode,
          markitdownConvert,
          spreadsheetFormulaExtract,
          sourceStat
        );
        await writeCompileSourceAnalysisCache(sourcePath, sourceStat, parserBackend, parserOptions, sourceMode, source, sourceAnalysisCache);
      }
      const normalizedBytes = estimateCompileSourceNormalizedBytes(source);
      if (normalizedBytes > resourceLimits.max_normalized_bytes) {
        throw new Error(
          `NORMALIZED_SIZE_LIMIT_EXCEEDED：来源 ${path.basename(sourcePath)} 的 normalized 内容为 ${formatProgressBytes(normalizedBytes)}，` +
            `超过单来源上限 ${formatProgressBytes(resourceLimits.max_normalized_bytes)}。` +
            "请检查 parser 是否异常膨胀，或在确认本机内存后通过 --max-normalized-bytes 调整。"
        );
      }
      totalNormalizedBytes += normalizedBytes;
      if (totalNormalizedBytes > resourceLimits.max_total_normalized_bytes) {
        throw new Error(
          `TOTAL_NORMALIZED_SIZE_LIMIT_EXCEEDED：已生成 normalized 内容 ${formatProgressBytes(totalNormalizedBytes)}，` +
            `超过总上限 ${formatProgressBytes(resourceLimits.max_total_normalized_bytes)}。` +
            "请拆分来源批次，或在确认本机内存后通过 --max-total-normalized-bytes 调整。"
        );
      }
    } catch (error) {
      throw new Error(
        `来源文件解析失败（${index + 1}/${total}）：${path.basename(sourcePath)}；原因：${formatMarkitdownError(error)}`
      );
    }
    const durationMs = Math.round(performance.now() - started);
    writeCompileProgress(
      `source ${index + 1}/${total} done: ${source.name}; type=${source.type}; size=${formatProgressBytes(source.size_bytes)}; normalized=${source.normalized_source?.status ?? "none"}; parser=${source.normalized_source?.parser ?? "none"}; duration_ms=${durationMs}`
    );
    sources.push(source);
  }
  return sources;
}

function writeCompileProgress(message: string): void {
  const raw = process.env.OPEN_INSIGHT_PROGRESS ?? "";
  if (raw !== "1" && raw.toLowerCase() !== "true") {
    return;
  }
  process.stderr.write(`[open-insight compile] ${message}\n`);
}

function formatProgressBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function formatDebugStack(error: unknown): { debug_stack?: string } {
  if (!isDebugStackOptIn()) {
    return {};
  }

  if (!(error instanceof Error) || !error.stack) {
    return {};
  }

  return { debug_stack: error.stack };
}

function isDebugStackOptIn(): boolean {
  const raw = process.env.OPEN_INSIGHT_DEBUG_STACK ?? "";
  return raw === "1" || raw.toLowerCase() === "true";
}

function compileSourceAnalysisCacheKey(
  inputPath: string,
  sourceStat: Awaited<ReturnType<typeof stat>>,
  sourceContentSha256: string,
  parserBackend: CompileParserBackend,
  parserOptions: CompileParserOptions,
  sourceMode: CompileSourceMode
): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      schema_version: "open-insight.source-analysis-cache-key.v0.4",
      source_content_sha256: sourceContentSha256,
      source_name: path.basename(inputPath),
      size_bytes: Number(sourceStat.size),
      parser_backend: parserBackend,
      parser_timeout_ms: parserOptions.timeoutMs,
      parser_version: parserOptions.parserVersion ?? "unknown",
      ocr_mode: parserOptions.ocrMode,
      source_mode: sourceMode
    })
  );
  return hash.digest("hex");
}

function sourceAnalysisCacheHasStableParserIdentity(
  inputPath: string,
  parserBackend: CompileParserBackend,
  parserOptions: CompileParserOptions
): boolean {
  const sourceType = path.extname(inputPath).slice(1).toLowerCase();
  const usesMarkitdown =
    parserBackend === "markitdown" ||
    (parserBackend === "auto" && AUTO_MARKITDOWN_SOURCE_TYPES.has(sourceType));
  return !usesMarkitdown || Boolean(parserOptions.parserVersion);
}

async function compileSourceContentSha256(inputPath: string): Promise<string | undefined> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(inputPath)) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

function compileSourceAnalysisCacheFile(cache: CompileSourceAnalysisCacheOptions, cacheKey: string): string | undefined {
  if (!cache.enabled || !cache.cache_dir) {
    return undefined;
  }

  return path.join(cache.cache_dir, `${cacheKey}.json`);
}

async function readCompileSourceFromAnalysisCache(
  inputPath: string,
  sourceStat: Awaited<ReturnType<typeof stat>>,
  parserBackend: CompileParserBackend,
  parserOptions: CompileParserOptions,
  sourceMode: CompileSourceMode,
  cache: CompileSourceAnalysisCacheOptions
): Promise<CompileSourceAsset | undefined> {
  if (!sourceAnalysisCacheHasStableParserIdentity(inputPath, parserBackend, parserOptions)) {
    return undefined;
  }
  const sourceContentSha256 = await compileSourceContentSha256(inputPath);
  if (!sourceContentSha256) {
    return undefined;
  }
  const expectedKey = compileSourceAnalysisCacheKey(inputPath, sourceStat, sourceContentSha256, parserBackend, parserOptions, sourceMode);
  const cacheFile = compileSourceAnalysisCacheFile(cache, expectedKey);
  if (!cacheFile) {
    return undefined;
  }

  try {
    const record = (await readJsonFile<CompileSourceAnalysisCacheRecord>(cacheFile)) as CompileSourceAnalysisCacheRecord;
    if (
      record.schema_version !== "open-insight.source-analysis-cache-record.v0.3" ||
      record.cache_key !== expectedKey ||
      record.source_content_sha256 !== sourceContentSha256 ||
      record.source_name !== path.basename(inputPath) ||
      record.size_bytes !== Number(sourceStat.size) ||
      record.parser_backend !== parserBackend ||
      record.parser_timeout_ms !== parserOptions.timeoutMs ||
      record.parser_version !== parserOptions.parserVersion ||
      record.source_mode !== sourceMode
    ) {
      return undefined;
    }

    return {
      ...record.source,
      input_path: inputPath,
      size_bytes: record.source.size_bytes ?? Number(sourceStat.size)
    };
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return undefined;
    }
    cache.read_errors += 1;
    return undefined;
  }
}

async function writeCompileSourceAnalysisCache(
  inputPath: string,
  sourceStat: Awaited<ReturnType<typeof stat>>,
  parserBackend: CompileParserBackend,
  parserOptions: CompileParserOptions,
  sourceMode: CompileSourceMode,
  source: CompileSourceAsset,
  cache: CompileSourceAnalysisCacheOptions
): Promise<void> {
  if (
    source.spreadsheet_formula_evidence?.status === "partial" ||
    source.spreadsheet_formula_evidence?.truncated === true
  ) {
    return;
  }
  if (!sourceAnalysisCacheHasStableParserIdentity(inputPath, parserBackend, parserOptions)) {
    return;
  }
  const sourceContentSha256 = await compileSourceContentSha256(inputPath);
  if (!sourceContentSha256) {
    return;
  }
  const cacheKey = compileSourceAnalysisCacheKey(inputPath, sourceStat, sourceContentSha256, parserBackend, parserOptions, sourceMode);
  const cacheFile = compileSourceAnalysisCacheFile(cache, cacheKey);
  if (!cacheFile) {
    return;
  }

  const { input_path: _inputPath, ...cacheableSource } = source;
  const record: CompileSourceAnalysisCacheRecord = {
    schema_version: "open-insight.source-analysis-cache-record.v0.3",
    cache_key: cacheKey,
    source_content_sha256: sourceContentSha256,
    source_name: path.basename(inputPath),
    size_bytes: Number(sourceStat.size),
    mtime_ms: Math.round(Number(sourceStat.mtimeMs)),
    parser_backend: parserBackend,
    parser_timeout_ms: parserOptions.timeoutMs,
    ...(parserOptions.parserVersion ? { parser_version: parserOptions.parserVersion } : {}),
    source_mode: sourceMode,
    source: cacheableSource
  };

  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(record, null, 2), "utf8");
  cache.writes += 1;
}

async function analyzeCompileSource(
  inputPath: string,
  parserBackend: CompileParserBackend,
  parserOptions: CompileParserOptions,
  resourceLimits: CompileResourceLimits,
  sourceMode: CompileSourceMode,
  markitdownConvert?: MarkitdownConvert,
  spreadsheetFormulaExtract?: SpreadsheetFormulaExtract,
  existingSourceStat?: Awaited<ReturnType<typeof stat>>
): Promise<CompileSourceAsset> {
  const sourceStat = existingSourceStat ?? (await stat(inputPath));

  if (!sourceStat.isFile()) {
    throw new Error(`来源不是文件：${inputPath}`);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(inputPath);
  } catch (error) {
    if (sourceMode === "source_light") {
      return buildUnreadableSourceLightCompileSource(inputPath, sourceStat, error);
    }
    throw error;
  }
  const source = analyzeSourceBytes({
    name: path.basename(inputPath),
    bytes: new Uint8Array(bytes),
    size_bytes: Number(sourceStat.size)
  });
  const normalizedSource = await buildNormalizedSourceForCompile({
    inputPath,
    source,
    bytes,
    sourceMode,
    parserBackend,
    parserOptions,
    resourceLimits,
    ...(markitdownConvert ? { markitdownConvert } : {})
  });
  const normalizedSourceBytes = Buffer.byteLength(normalizedSource?.content ?? "", "utf8");
  const formulaOutputBudget = Math.max(
    1,
    resourceLimits.max_normalized_bytes - normalizedSourceBytes - 4096
  );
  const spreadsheetFormulaEvidence =
    (source.type ?? path.extname(source.name).replace(/^\./u, "").toLowerCase()) === "xlsx"
      ? await extractSpreadsheetFormulaEvidenceSafely({
          inputPath,
          sourceName: source.name,
          timeoutMs: parserOptions.timeoutMs,
          maxFormulas: DEFAULT_SPREADSHEET_FORMULA_MAX_RECORDS,
          maxOutputBytes: Math.min(
            DEFAULT_SPREADSHEET_FORMULA_MAX_OUTPUT_BYTES,
            formulaOutputBudget
          ),
          maxWorksheetXmlBytes: resourceLimits.max_source_bytes,
          maxZipEntries: DEFAULT_SPREADSHEET_FORMULA_MAX_ZIP_ENTRIES,
          maxTotalXmlBytes: Math.min(
            DEFAULT_SPREADSHEET_FORMULA_MAX_TOTAL_XML_BYTES,
            resourceLimits.max_source_bytes * 8
          ),
          ...(spreadsheetFormulaExtract ? { spreadsheetFormulaExtract } : {})
        })
      : undefined;

  return {
    ...source,
    ...(normalizedSource ? { normalized_source: normalizedSource } : {}),
    ...(spreadsheetFormulaEvidence ? { spreadsheet_formula_evidence: spreadsheetFormulaEvidence } : {}),
    input_path: inputPath,
    path: source.path ?? `sources/${source.name}`,
    type: source.type ?? "unknown",
    size_bytes: source.size_bytes ?? Number(sourceStat.size)
  };
}

function estimateCompileSourceNormalizedBytes(source: CompileSourceAsset): number {
  const normalizedBytes = Buffer.byteLength(source.normalized_source?.content ?? "", "utf8");
  const formulaEvidence = source.spreadsheet_formula_evidence;

  if (!formulaEvidence || formulaEvidence.status === "none") {
    return normalizedBytes;
  }

  return normalizedBytes + 4096 + Buffer.byteLength(JSON.stringify(formulaEvidence.cells), "utf8");
}

function buildUnreadableSourceLightCompileSource(inputPath: string, sourceStat: Awaited<ReturnType<typeof stat>>, error: unknown): CompileSourceAsset {
  const name = path.basename(inputPath);
  const type = path.extname(name).replace(/^\./u, "").toLowerCase() || "unknown";
  const reason = formatMarkitdownError(error);
  const message = `source_light 编译时无法读取该来源文件，已降级为 metadata-only normalized source；原因：${reason}。该包不会伪装拥有完整正文，后续 parser quality / proof report 必须把该来源标记为 degraded。`;

  return {
    name,
    path: `sources/${name}`,
    type,
    size_bytes: Number(sourceStat.size),
    input_path: inputPath,
    normalized_source: {
      content: [
        `# Normalized source: ${name}`,
        "",
        "> Open Insight source_light 编译未能读取该源文件正文，因此只保留 metadata-only normalized source。",
        "",
        "## Source read fallback",
        "",
        message,
        ""
      ].join("\n"),
      parser: "open_insight_source_read_fallback",
      parser_role: "source_read_fallback_metadata_only",
      cloud_used: false,
      confidence: 0.1,
      status: "partial",
      message
    }
  };
}

async function buildNormalizedSourceForCompile(options: {
  inputPath: string;
  source: DraftSource;
  bytes: Buffer;
  sourceMode: CompileSourceMode;
  parserBackend: CompileParserBackend;
  parserOptions: CompileParserOptions;
  resourceLimits: CompileResourceLimits;
  markitdownConvert?: MarkitdownConvert;
}): Promise<DraftSourceNormalizedSource | undefined> {
  const { inputPath, source, bytes, sourceMode, parserBackend, parserOptions, resourceLimits, markitdownConvert } = options;
  const shouldUseMarkitdown = parserBackend === "markitdown" || shouldUseMarkitdownInAutoMode(source, parserBackend);

  if (shouldUseMarkitdown) {
    try {
      const normalized = await buildMarkitdownNormalizedSource(inputPath, source.name, {
        sourceSizeBytes: bytes.byteLength,
        ...(source.type ? { sourceType: source.type } : {}),
        timeoutMs: parserOptions.timeoutMs,
        ocrMode: parserOptions.ocrMode,
        ...(markitdownConvert ? { markitdownConvert } : {})
      });
      return enforceNormalizedSourceSizeLimit(normalized, source.name, resourceLimits.max_normalized_bytes);
    } catch (error) {
      if (isCompileResourceLimitError(error) || parserOptions.ocrMode === "llm") {
        throw error;
      }
      if (parserBackend === "markitdown") {
        if (sourceMode === "source_light") {
          return buildMarkitdownFallbackNormalizedSource(source, error);
        }

        throw error;
      }

      return buildMarkitdownFallbackNormalizedSource(source, error);
    }
  }

  const normalized =
    buildBuiltinTextNormalizedSource(source.name, source.type, bytes) ?? buildBuiltinMetadataNormalizedSource(source);
  return normalized
    ? enforceNormalizedSourceSizeLimit(normalized, source.name, resourceLimits.max_normalized_bytes)
    : undefined;
}

function enforceNormalizedSourceSizeLimit(
  normalized: DraftSourceNormalizedSource,
  sourceName: string,
  maxNormalizedBytes: number
): DraftSourceNormalizedSource {
  const normalizedBytes = Buffer.byteLength(normalized.content, "utf8");
  if (normalizedBytes > maxNormalizedBytes) {
    throw new Error(
      `NORMALIZED_SIZE_LIMIT_EXCEEDED：来源 ${sourceName} 的 normalized 内容为 ${formatProgressBytes(normalizedBytes)}，` +
        `超过单来源上限 ${formatProgressBytes(maxNormalizedBytes)}。` +
        "请检查 parser 是否异常膨胀，或在确认本机内存后通过 --max-normalized-bytes 调整。"
    );
  }
  return normalized;
}

async function extractSpreadsheetFormulaEvidenceSafely(options: SpreadsheetFormulaExtractInput & {
  spreadsheetFormulaExtract?: SpreadsheetFormulaExtract;
}): Promise<DraftSpreadsheetFormulaEvidence> {
  const extract = options.spreadsheetFormulaExtract ?? extractSpreadsheetFormulaEvidenceFromLocalXlsx;

  try {
    return await extract(options);
  } catch (error) {
    const reason = sanitizeCompilePackError(formatMarkitdownError(error));
    return {
      schema_version: "open-insight.spreadsheet-formula-extraction.v0.1",
      extractor: "open_insight_xlsx_formula_xml",
      status: "partial",
      formula_count: 0,
      truncated: true,
      max_formulas: options.maxFormulas,
      max_output_bytes: options.maxOutputBytes,
      termination_reason: classifySpreadsheetFormulaTerminationReason(error),
      message:
        `Open Insight 未能提取 XLSX 公式证据；原因：${reason}。` +
        "MarkItDown 转置内容仍保留，但 LLM 不应据此断言工作簿没有公式，必须回查 source_bundled 原文件或重新编译。",
      cells: []
    };
  }
}

function classifySpreadsheetFormulaTerminationReason(
  error: unknown
): NonNullable<DraftSpreadsheetFormulaEvidence["termination_reason"]> {
  const message = error instanceof Error ? error.message : String(error);

  if (/timeout|timed out|ETIMEDOUT/iu.test(message)) {
    return "timeout";
  }

  if (/SIZE_LIMIT|RESOURCE_LIMIT|MAX_BUFFER|ENOBUFS/iu.test(message)) {
    return "resource_limit";
  }

  return "parse_error";
}

export async function extractSpreadsheetFormulaEvidenceFromLocalXlsx(
  input: SpreadsheetFormulaExtractInput
): Promise<DraftSpreadsheetFormulaEvidence> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-xlsx-formulas-"));
  const outputPath = path.join(tempDir, "formulas.jsonl");
  const script = `
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation
from pathlib import Path

source = Path(sys.argv[1]).resolve(strict=True)
output = Path(sys.argv[2])
max_formulas = int(sys.argv[3])
max_output_bytes = int(sys.argv[4])
max_worksheet_xml_bytes = int(sys.argv[5])
max_zip_entries = int(sys.argv[6])
max_total_xml_bytes = int(sys.argv[7])

def local_name(tag):
    return tag.rsplit("}", 1)[-1]

def attribute_by_local_name(element, name):
    for key, value in element.attrib.items():
        if local_name(key) == name:
            return value
    return None

def normalize_target(target):
    target = target.replace("\\\\", "/")
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))

def read_entry_limited(archive, name, max_bytes, error_code):
    entry = archive.getinfo(name)
    if entry.file_size > max_bytes:
        raise RuntimeError(
            "%s:%s:%d:%d" % (error_code, name, entry.file_size, max_bytes)
        )
    return archive.read(name)

def cached_value(cell_type, value_element):
    if value_element is None:
        return False, None, None, None
    raw = value_element.text
    if raw is None or raw == "":
        return True, None, "blank", raw or ""
    if cell_type == "b":
        return True, raw == "1", "boolean", raw
    if cell_type == "e":
        return True, raw, "error", raw
    if cell_type in ("str", "inlineStr"):
        return True, raw, "string", raw
    if cell_type == "s":
        return True, raw, "shared_string_index", raw
    try:
        decimal_value = Decimal(raw)
        if not decimal_value.is_finite():
            return True, raw, "unknown", raw
        if decimal_value == decimal_value.to_integral_value() and abs(decimal_value) <= 9007199254740991:
            return True, int(decimal_value), "number", raw
        return True, raw, "number", raw
    except InvalidOperation:
        return True, raw, "unknown", raw

def formula_type(raw):
    return {
        None: "normal",
        "normal": "normal",
        "shared": "shared",
        "array": "array",
        "dataTable": "data_table"
    }.get(raw, "unknown")

records_written = 0
bytes_written = 0
truncated = False
blank_shared_formulas = 0

with zipfile.ZipFile(source, "r") as archive:
    entries = archive.infolist()
    if len(entries) > max_zip_entries:
        raise RuntimeError(
            "XLSX_ZIP_ENTRY_LIMIT_EXCEEDED:%d:%d" % (len(entries), max_zip_entries)
        )
    names = set(entry.filename for entry in entries)
    workbook_path = "xl/workbook.xml"
    if workbook_path not in names:
        raise RuntimeError("XLSX_WORKBOOK_XML_MISSING")

    relationship_targets = {}
    relationships_path = "xl/_rels/workbook.xml.rels"
    if relationships_path in names:
        relationships_root = ET.fromstring(
            read_entry_limited(
                archive,
                relationships_path,
                max_worksheet_xml_bytes,
                "XLSX_RELATIONSHIPS_XML_SIZE_LIMIT_EXCEEDED"
            )
        )
        for relationship in relationships_root:
            relationship_id = relationship.attrib.get("Id")
            target = relationship.attrib.get("Target")
            if relationship_id and target:
                relationship_targets[relationship_id] = normalize_target(target)

    workbook_root = ET.fromstring(
        read_entry_limited(
            archive,
            workbook_path,
            max_worksheet_xml_bytes,
            "XLSX_WORKBOOK_XML_SIZE_LIMIT_EXCEEDED"
        )
    )
    sheets = []
    for sheet in workbook_root.iter():
        if local_name(sheet.tag) != "sheet":
            continue
        sheet_name = sheet.attrib.get("name", "Sheet")
        relationship_id = attribute_by_local_name(sheet, "id")
        sheet_path = relationship_targets.get(relationship_id)
        if not sheet_path:
            sheet_path = "xl/worksheets/sheet%d.xml" % (len(sheets) + 1)
        sheets.append((sheet_name, sheet_path))

    xml_paths = {workbook_path}
    if relationships_path in names:
        xml_paths.add(relationships_path)
    xml_paths.update(sheet_path for _sheet_name, sheet_path in sheets if sheet_path in names)
    total_xml_bytes = sum(archive.getinfo(xml_path).file_size for xml_path in xml_paths)
    if total_xml_bytes > max_total_xml_bytes:
        raise RuntimeError(
            "XLSX_TOTAL_XML_SIZE_LIMIT_EXCEEDED:%d:%d"
            % (total_xml_bytes, max_total_xml_bytes)
        )

    with output.open("w", encoding="utf-8", newline="\\n") as target:
        stop = False
        for sheet_name, sheet_path in sheets:
            if sheet_path not in names:
                continue
            entry = archive.getinfo(sheet_path)
            if entry.file_size > max_worksheet_xml_bytes:
                raise RuntimeError(
                    "XLSX_WORKSHEET_XML_SIZE_LIMIT_EXCEEDED:%s:%d:%d"
                    % (sheet_name, entry.file_size, max_worksheet_xml_bytes)
                )

            with archive.open(sheet_path, "r") as worksheet_stream:
                for _event, cell in ET.iterparse(worksheet_stream, events=("end",)):
                    if local_name(cell.tag) != "c":
                        continue
                    formula_element = None
                    value_element = None
                    for child in cell:
                        child_name = local_name(child.tag)
                        if child_name == "f":
                            formula_element = child
                        elif child_name == "v":
                            value_element = child
                    if formula_element is None:
                        cell.clear()
                        continue

                    raw_formula = formula_element.text or ""
                    if raw_formula and not raw_formula.startswith("="):
                        raw_formula = "=" + raw_formula
                    raw_formula_type = formula_element.attrib.get("t")
                    normalized_formula_type = formula_type(raw_formula_type)
                    if normalized_formula_type == "shared" and not raw_formula:
                        blank_shared_formulas += 1
                    available, value, value_type, value_raw = cached_value(cell.attrib.get("t"), value_element)
                    record = {
                        "sheet_name": sheet_name,
                        "cell_address": cell.attrib.get("r", "unknown"),
                        "formula": raw_formula,
                        "formula_type": normalized_formula_type,
                        "formula_resolution_status": (
                            "unresolved_shared"
                            if normalized_formula_type == "shared" and not raw_formula
                            else "resolved"
                        ),
                        "cached_value_available": available
                    }
                    if available:
                        record["cached_value"] = value
                    if value_type:
                        record["cached_value_type"] = value_type
                    if value_raw is not None:
                        record["cached_value_raw"] = value_raw
                    if formula_element.attrib.get("ref"):
                        record["range_ref"] = formula_element.attrib["ref"]
                    if formula_element.attrib.get("si"):
                        record["shared_index"] = formula_element.attrib["si"]

                    encoded = (json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\\n").encode("utf-8")
                    if records_written >= max_formulas or bytes_written + len(encoded) > max_output_bytes:
                        truncated = True
                        stop = True
                        cell.clear()
                        break
                    target.write(encoded.decode("utf-8"))
                    records_written += 1
                    bytes_written += len(encoded)
                    cell.clear()

            if stop:
                break

status = "partial" if truncated or blank_shared_formulas > 0 else ("ok" if records_written > 0 else "none")
if truncated:
    message = "公式证据达到资源上限，已保留前 %d 条；不能把当前记录视为工作簿全部公式。" % records_written
elif blank_shared_formulas > 0:
    message = "已提取 %d 条公式证据；其中 %d 个共享公式单元格未在 XML 中重复保存公式文本，需结合共享公式主单元格或原文件复核。" % (records_written, blank_shared_formulas)
elif records_written > 0:
    message = "已从 XLSX XML 只读提取 %d 条公式证据；未重新计算公式，缓存值仅来自文件已有内容。" % records_written
else:
    message = "XLSX XML 中没有发现公式单元格；这不代表 MarkItDown 负责公式解析。"

sys.stdout.write(json.dumps({
    "status": status,
    "formula_count": records_written,
    "truncated": truncated,
    "blank_shared_formulas": blank_shared_formulas,
    "output_bytes": bytes_written,
    "message": message
}, ensure_ascii=False))
`;

  try {
    const result = await execPythonBuffer(
      [
        "-c",
        script,
        input.inputPath,
        outputPath,
        String(input.maxFormulas),
        String(input.maxOutputBytes),
        String(input.maxWorksheetXmlBytes),
        String(input.maxZipEntries),
        String(input.maxTotalXmlBytes)
      ],
      {
        maxBuffer: 256 * 1024,
        timeout: input.timeoutMs
      }
    );
    const metadata = JSON.parse(decodeMarkitdownOutput(result.stdout)) as {
      status?: DraftSpreadsheetFormulaEvidence["status"];
      formula_count?: number;
      truncated?: boolean;
      message?: string;
    };
    const cells = await readSpreadsheetFormulaCellsFromJsonl(outputPath, input.maxOutputBytes);

    return {
      schema_version: "open-insight.spreadsheet-formula-extraction.v0.1",
      extractor: "open_insight_xlsx_formula_xml",
      status:
        metadata.status === "ok" ||
        metadata.status === "none" ||
        metadata.status === "partial" ||
        metadata.status === "unsupported"
          ? metadata.status
          : cells.length > 0
            ? "ok"
            : "none",
      formula_count: cells.length,
      truncated: metadata.truncated === true,
      max_formulas: input.maxFormulas,
      max_output_bytes: input.maxOutputBytes,
      message:
        typeof metadata.message === "string" && metadata.message.trim()
          ? metadata.message.trim()
          : `已从 XLSX XML 只读提取 ${cells.length} 条公式证据；未重新计算公式。`,
      cells
    };
  } catch (error) {
    const cells = await readSpreadsheetFormulaCellsFromJsonlIfPresent(outputPath, input.maxOutputBytes);

    if (cells.length > 0) {
      const terminationReason = classifySpreadsheetFormulaTerminationReason(error);
      return {
        schema_version: "open-insight.spreadsheet-formula-extraction.v0.1",
        extractor: "open_insight_xlsx_formula_xml",
        status: "partial",
        formula_count: cells.length,
        truncated: true,
        max_formulas: input.maxFormulas,
        max_output_bytes: input.maxOutputBytes,
        termination_reason: terminationReason,
        message:
          `XLSX 公式提取因 ${terminationReason} 提前结束，已保留 ${cells.length} 条已完成记录；` +
          "这些记录不是工作簿全部公式，必须结合原文件复核。",
        cells
      };
    }

    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readSpreadsheetFormulaCellsFromJsonl(
  outputPath: string,
  maxOutputBytes: number
): Promise<DraftSpreadsheetFormulaCell[]> {
  const outputStat = await stat(outputPath);
  if (outputStat.size > maxOutputBytes) {
    throw new Error(
      `XLSX_FORMULA_OUTPUT_SIZE_LIMIT_EXCEEDED：公式证据为 ${formatProgressBytes(outputStat.size)}，` +
        `超过上限 ${formatProgressBytes(maxOutputBytes)}。`
    );
  }
  const raw = await readFile(outputPath, "utf8");
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeSpreadsheetFormulaCell(JSON.parse(line) as Record<string, unknown>));
}

async function readSpreadsheetFormulaCellsFromJsonlIfPresent(
  outputPath: string,
  maxOutputBytes: number
): Promise<DraftSpreadsheetFormulaCell[]> {
  try {
    return await readSpreadsheetFormulaCellsFromJsonl(outputPath, maxOutputBytes);
  } catch {
    return [];
  }
}

function normalizeSpreadsheetFormulaCell(value: Record<string, unknown>): DraftSpreadsheetFormulaCell {
  const formulaType =
    value.formula_type === "normal" ||
    value.formula_type === "shared" ||
    value.formula_type === "array" ||
    value.formula_type === "data_table" ||
    value.formula_type === "unknown"
      ? value.formula_type
      : "unknown";
  const cachedValueType =
    value.cached_value_type === "string" ||
    value.cached_value_type === "number" ||
    value.cached_value_type === "boolean" ||
    value.cached_value_type === "error" ||
    value.cached_value_type === "blank" ||
    value.cached_value_type === "shared_string_index" ||
    value.cached_value_type === "unknown"
      ? value.cached_value_type
      : undefined;
  const cachedValue =
    value.cached_value === null ||
    typeof value.cached_value === "string" ||
    typeof value.cached_value === "number" ||
    typeof value.cached_value === "boolean"
      ? value.cached_value
      : undefined;

  return {
    sheet_name: typeof value.sheet_name === "string" && value.sheet_name.trim() ? value.sheet_name : "Sheet",
    cell_address:
      typeof value.cell_address === "string" && value.cell_address.trim() ? value.cell_address : "unknown",
    formula: typeof value.formula === "string" ? value.formula : "",
    formula_type: formulaType,
    formula_resolution_status:
      value.formula_resolution_status === "unresolved_shared" ? "unresolved_shared" : "resolved",
    cached_value_available: value.cached_value_available === true,
    ...(value.cached_value_available === true ? { cached_value: cachedValue ?? null } : {}),
    ...(typeof value.cached_value_raw === "string" ? { cached_value_raw: value.cached_value_raw } : {}),
    ...(cachedValueType ? { cached_value_type: cachedValueType } : {}),
    ...(typeof value.range_ref === "string" && value.range_ref.trim() ? { range_ref: value.range_ref } : {}),
    ...(typeof value.shared_index === "string" && value.shared_index.trim()
      ? { shared_index: value.shared_index }
      : {})
  };
}

function isCompileResourceLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:SOURCE|TOTAL_SOURCE|NORMALIZED|TOTAL_NORMALIZED)_SIZE_LIMIT_EXCEEDED/u.test(error.message)
  );
}

function buildBuiltinTextNormalizedSource(sourceName: string, sourceType: string | undefined, bytes: Buffer): DraftSourceNormalizedSource | undefined {
  const type = sourceType ?? path.extname(sourceName).replace(/^\./, "").toLowerCase();
  if (!["md", "txt", "html", "htm"].includes(type)) {
    return undefined;
  }

  const text = decodeMarkitdownOutput(bytes).trimEnd();
  if (text.trim().length === 0) {
    return undefined;
  }

  const fenced = type === "html" || type === "htm";
  const body = fenced ? ["```html", text, "```"].join("\n") : text;

  return {
    content: [
      `# Normalized source: ${sourceName}`,
      "",
      "> Open Insight 内置文本解析器生成该 normalized Markdown，用于让 LLM 更高效读取；它不是 raw source。",
      "",
      "## Source text",
      "",
      body,
      ""
    ].join("\n"),
    parser: "open_insight_builtin_text",
    parser_role: "builtin_normalized_source",
    cloud_used: false,
    confidence: 0.8,
    status: "ok",
    message: "Open Insight 内置解析器已从本地可读文本生成 normalized Markdown；Markdown 是 AI-ready 层，不是 raw source。"
  };
}

function buildBuiltinMetadataNormalizedSource(source: DraftSource): DraftSourceNormalizedSource | undefined {
  if ((source.columns?.length ?? 0) > 0 || (source.sample_rows?.length ?? 0) > 0) {
    return undefined;
  }

  const type = source.type ?? path.extname(source.name).replace(/^\./, "").toLowerCase();

  if (["csv", "tsv", "md", "txt", "html", "htm"].includes(type)) {
    return undefined;
  }

  return {
    content: "",
    parser: "open_insight_builtin_metadata",
    parser_role: "metadata_only_normalized_source",
    cloud_used: false,
    confidence: 0.35,
    status: "partial",
    message: "当前只生成 metadata-only normalized source，未抽取正文；需要 MarkItDown、OCR 或原始文件复核后才能把正文内容当作事实证据。"
  };
}

function buildMarkitdownFallbackNormalizedSource(source: DraftSource, error: unknown): DraftSourceNormalizedSource {
  const reason = formatMarkitdownError(error);
  const message = `MarkItDown 本地 parser 未能在 auto 模式下解析该文件，已降级为 metadata-only normalized source；原因：${reason}。raw source / source fingerprint 仍保留，后续可通过 OCR、重跑 parser 或 source_bundled 原文复核补齐。`;

  return {
    content: [
      `# Normalized source: ${source.name}`,
      "",
      "> Open Insight auto 模式优先使用 MarkItDown 生成 normalized Markdown；本文件解析失败，因此只保留 metadata-only normalized source。",
      "",
      "## Parser fallback",
      "",
      message,
      ""
    ].join("\n"),
    parser: "markitdown",
    parser_role: "external_normalized_source_fallback",
    cloud_used: false,
    confidence: 0.2,
    status: "partial",
    message
  };
}

async function buildMarkitdownNormalizedSource(
  inputPath: string,
  sourceName: string,
  options: {
    sourceSizeBytes?: number;
    sourceType?: string;
    timeoutMs?: number;
    ocrMode?: CompileOcrMode;
    markitdownConvert?: MarkitdownConvert;
  } = {}
): Promise<DraftSourceNormalizedSource> {
  const markitdownConvert = options.markitdownConvert ?? convertWithLocalMarkitdown;
  let conversion: MarkitdownConvertResult;

  try {
    conversion = await markitdownConvert({
      inputPath,
      sourceName,
      ...(typeof options.timeoutMs === "number" ? { timeoutMs: options.timeoutMs } : {}),
      ocrMode: options.ocrMode ?? "off"
    });
  } catch (error) {
    if ((options.ocrMode ?? "off") === "llm") {
      throw new Error(
        `MarkItDown 模型 OCR 执行失败：${formatMarkitdownError(error)}。请检查 markitdown-ocr、视觉模型、endpoint、网络和资料权限；未生成可用 OCR 正文。`
      );
    }
    throw new Error(
      `MarkItDown 本地 parser 执行失败：${formatMarkitdownError(error)}。请先安装 pip install "markitdown[all]"，或改用 --parser builtin。`
    );
  }

  const markdown = conversion.markdown.trimEnd();

  if (markdown.trim().length === 0) {
    if ((options.ocrMode ?? "off") === "llm") {
      const parserVersion = formatModelOcrParserVersion(conversion);
      return {
        content: [
          `# Normalized source: ${sourceName}`,
          "",
          "> Open Insight 已请求 MarkItDown 模型 OCR，但没有返回可用正文。",
          "",
          "## OCR empty output",
          "",
          "OCR 输出为空；raw source / source fingerprint 仍保留，不能宣称扫描正文完整。",
          ""
        ].join("\n"),
        parser: "markitdown",
        ...(parserVersion ? { parser_version: parserVersion } : {}),
        parser_role: "external_normalized_source_model_ocr_no_output",
        cloud_used: conversion.cloud_used ?? true,
        confidence: 0.2,
        status: "warning",
        message: "已请求 MarkItDown 模型 OCR，但输出为空；必须回查 raw source 或更换 OCR 模型。"
      };
    }
    return buildEmptyMarkitdownNormalizedSource(sourceName, conversion.parser_version);
  }
  if ((options.ocrMode ?? "off") === "llm") {
    const ocrUsed = conversion.ocr_used ?? /\[Image OCR\]/u.test(markdown);
    const parserVersion = formatModelOcrParserVersion(conversion);
    return {
      content: `${markdown}\n`,
      parser: "markitdown",
      ...(parserVersion ? { parser_version: parserVersion } : {}),
      parser_role: ocrUsed
        ? "external_normalized_source_model_ocr"
        : "external_normalized_source_model_ocr_no_output",
      cloud_used: conversion.cloud_used ?? true,
      confidence: ocrUsed ? 0.65 : 0.3,
      status: "warning",
      message: ocrUsed
        ? `已通过显式启用的 MarkItDown OCR 插件生成模型辅助 OCR 内容${
            conversion.ocr_plugin_version ? `（plugin=${conversion.ocr_plugin_version}）` : ""
          }；结果必须人工复核，不能视为 verified 原文。`
        : "已请求 MarkItDown 模型 OCR，但输出中没有检测到 Image OCR 标记；已保留 parser 输出并标记 warning，不能宣称扫描正文完整。"
    };
  }
  const quality = assessMarkitdownNormalizedQuality(markdown, {
    sourceName,
    ...(typeof options.sourceSizeBytes === "number" ? { sourceSizeBytes: options.sourceSizeBytes } : {}),
    ...(options.sourceType ? { sourceType: options.sourceType } : {})
  });

  return {
    content: `${markdown}\n`,
    parser: "markitdown",
    ...(conversion.parser_version ? { parser_version: conversion.parser_version } : {}),
    parser_role: quality.parserRole,
    cloud_used: false,
    confidence: quality.confidence,
    status: quality.status,
    message: quality.message
  };
}

function buildEmptyMarkitdownNormalizedSource(sourceName: string, parserVersion?: string): DraftSourceNormalizedSource {
  const message =
    "MarkItDown 本地 parser 执行完成，但没有返回可用正文内容；已降级为 metadata-only normalized source。raw source / source fingerprint 仍保留，后续可通过 OCR、重跑 parser 或 source_bundled 原文复核补齐。";

  return {
    content: [
      `# Normalized source: ${sourceName}`,
      "",
      "> Open Insight 已调用 MarkItDown，但该文件没有抽出可用正文，因此只保留 metadata-only normalized source。",
      "",
      "## Parser empty output",
      "",
      message,
      ""
    ].join("\n"),
    parser: "markitdown",
    ...(parserVersion ? { parser_version: parserVersion } : {}),
    parser_role: "external_normalized_source_fallback",
    cloud_used: false,
    confidence: 0.2,
    status: "partial",
    message
  };
}

function assessMarkitdownNormalizedQuality(
  markdown: string,
  input: { sourceName: string; sourceSizeBytes?: number; sourceType?: string }
): {
  status: "ok" | "warning";
  confidence: number;
  parserRole: "external_normalized_source" | "external_normalized_source_weak";
  message: string;
} {
  const sourceType = (input.sourceType ?? path.extname(input.sourceName).replace(/^\./, "")).toLowerCase();
  const sourceSizeBytes = Math.max(0, input.sourceSizeBytes ?? 0);
  const meaningfulChars = markdown.replace(/[^\p{L}\p{N}]/gu, "").length;
  const contentLineCount = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length >= 20 && !line.startsWith("#") && !line.startsWith(">"))
    .length;
  const sourceToTextRatio = sourceSizeBytes > 0 ? meaningfulChars / sourceSizeBytes : 1;
  const isLargePdf = sourceType === "pdf" && sourceSizeBytes >= 128 * 1024;
  const looksWeak =
    isLargePdf &&
    (meaningfulChars < 1_200 || contentLineCount < 6 || (sourceSizeBytes >= 512 * 1024 && sourceToTextRatio < 0.003));

  if (!looksWeak) {
    return {
      status: "ok",
      confidence: 0.85,
      parserRole: "external_normalized_source",
      message: "已通过本地 MarkItDown 生成 normalized Markdown；Markdown 是 AI-ready 压缩层，不替代 raw source。"
    };
  }

  return {
    status: "warning",
    confidence: 0.45,
    parserRole: "external_normalized_source_weak",
    message:
      `MarkItDown 已返回 normalized Markdown，但该 PDF 源文件较大、抽取正文量偏少，疑似弱解析；` +
      `meaningful_chars=${meaningfulChars}，content_lines=${contentLineCount}，source_size_bytes=${sourceSizeBytes}。` +
      "Open Insight 会保留该内容和追溯信息，但 compact retrieval / MCP / token eval 应披露解析质量边界；非图片化 PDF 可优先重跑 MarkItDown，图片化或扫描 PDF 后续进入 OCR 专项。"
  };
}

async function convertWithLocalMarkitdown(input: MarkitdownConvertInput): Promise<MarkitdownConvertResult> {
  const options = {
    maxBuffer: 2 * 1024 * 1024,
    timeout: input.timeoutMs ?? markitdownTimeoutMs()
  };
  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-markitdown-"));
  const outputPath = path.join(tempDir, "normalized.md");

  try {
    let versionOutput: Buffer;
    let ocrPluginVersion: string | undefined;
    try {
      if ((input.ocrMode ?? "off") === "llm") {
        requireOcrModelConfig();
        const result = await execPythonBuffer(
          [
            "-c",
            [
              "import json, os, sys",
              "from pathlib import Path",
              "from importlib.metadata import version",
              "from markitdown import MarkItDown",
              "from openai import OpenAI",
              "source = Path(sys.argv[1]).resolve(strict=True)",
              "output = Path(sys.argv[2])",
              "base_url = os.environ.get('OPEN_INSIGHT_OCR_BASE_URL', '').strip()",
              "client_args = {'api_key': os.environ['OPEN_INSIGHT_OCR_API_KEY']}",
              "client_args.update({'base_url': base_url} if base_url else {})",
              "client = OpenAI(**client_args)",
              "converter = MarkItDown(enable_plugins=True, llm_client=client, llm_model=os.environ['OPEN_INSIGHT_OCR_MODEL'], llm_prompt='逐字提取图像中的全部文字，保留标题、段落、编号和表格结构；不要总结，不要补充图像中不存在的内容。')",
              "result = converter.convert_local(source)",
              "output.write_text(result.markdown, encoding='utf-8')",
              "sys.stdout.write(json.dumps({'markitdown': version('markitdown'), 'markitdown_ocr': version('markitdown-ocr')}))"
            ].join("\n"),
            input.inputPath,
            outputPath
          ],
          options
        );
        const metadata = JSON.parse(decodeMarkitdownOutput(result.stdout)) as {
          markitdown?: string;
          markitdown_ocr?: string;
        };
        versionOutput = Buffer.from(metadata.markitdown ?? "", "utf8");
        ocrPluginVersion = metadata.markitdown_ocr;
      } else {
        versionOutput = (
          await execPythonBuffer(
            [
              "-c",
              [
                "import sys",
                "from pathlib import Path",
                "from importlib.metadata import version",
                "from markitdown import MarkItDown",
                "source = Path(sys.argv[1]).resolve(strict=True)",
                "output = Path(sys.argv[2])",
                "result = MarkItDown(enable_plugins=False).convert_local(source)",
                "output.write_text(result.markdown, encoding='utf-8')",
                "sys.stdout.write(version('markitdown'))"
              ].join(";"),
              input.inputPath,
              outputPath
            ],
            options
          )
        ).stdout;
      }
    } catch (error) {
      if ((input.ocrMode ?? "off") === "llm") {
        throw error;
      }
      if (!isMarkitdownPythonModuleUnavailableError(error) && !isCommandNotFoundError(error)) {
        throw error;
      }

      await execFileBuffer("markitdown", [input.inputPath, "-o", outputPath], options);
      versionOutput = (await execFileBuffer("markitdown", ["--version"], options)).stdout;
    }

    const markdown = decodeMarkitdownOutput(await readFile(outputPath));
    const parserVersion = parseMarkitdownVersion(decodeMarkitdownOutput(versionOutput));
    return {
      markdown,
      ...(parserVersion ? { parser_version: parserVersion } : {}),
      ...(ocrPluginVersion ? { ocr_plugin_version: ocrPluginVersion } : {}),
      ...((input.ocrMode ?? "off") === "llm"
        ? {
            ...(process.env.OPEN_INSIGHT_OCR_MODEL?.trim()
              ? { ocr_model: process.env.OPEN_INSIGHT_OCR_MODEL.trim() }
              : {}),
            ocr_used: /\[Image OCR\]/u.test(markdown),
            cloud_used: isExternalOcrEndpoint(process.env.OPEN_INSIGHT_OCR_BASE_URL)
          }
        : {})
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function formatModelOcrParserVersion(conversion: MarkitdownConvertResult): string | undefined {
  const parts = [
    conversion.parser_version,
    conversion.ocr_plugin_version ? `markitdown-ocr/${conversion.ocr_plugin_version}` : undefined,
    conversion.ocr_model ? `model/${conversion.ocr_model}` : undefined
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.length > 0 ? parts.join("+") : undefined;
}

function isExternalOcrEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) {
    return true;
  }
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return true;
  }
}

async function detectLocalMarkitdownVersion(timeoutMs: number): Promise<string | undefined> {
  const options = {
    maxBuffer: 256 * 1024,
    timeout: Math.min(timeoutMs, 30_000)
  };

  try {
    const result = await execPythonBuffer(
      ["-c", "from importlib.metadata import version; print(version('markitdown'))"],
      options
    );
    return parseMarkitdownVersion(decodeMarkitdownOutput(result.stdout));
  } catch {
    try {
      const result = await execPythonBuffer(["-m", "markitdown", "--version"], options);
      return parseMarkitdownVersion(decodeMarkitdownOutput(result.stdout));
    } catch {
      try {
        const result = await execFileBuffer("markitdown", ["--version"], options);
        return parseMarkitdownVersion(decodeMarkitdownOutput(result.stdout));
      } catch {
        return undefined;
      }
    }
  }
}

async function detectPythonPackageVersion(packageName: string, timeoutMs: number): Promise<string | undefined> {
  try {
    const result = await execPythonBuffer(
      ["-c", "import sys; from importlib.metadata import version; print(version(sys.argv[1]))", packageName],
      {
        maxBuffer: 256 * 1024,
        timeout: Math.min(timeoutMs, 30_000)
      }
    );
    return decodeMarkitdownOutput(result.stdout).trim() || undefined;
  } catch {
    return undefined;
  }
}

function markitdownTimeoutMs(): number {
  const raw = process.env.OPEN_INSIGHT_MARKITDOWN_TIMEOUT_MS;
  if (!raw) {
    return 120_000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 120_000;
  }

  return Math.max(5_000, Math.min(Math.trunc(parsed), 600_000));
}

async function execPythonBuffer(
  args: string[],
  options: { maxBuffer: number; timeout: number }
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  const candidates = [process.env.OPEN_INSIGHT_PYTHON, "python", "python3", "py"].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
  );

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await execFileBuffer(candidate, args, options);
    } catch (error) {
      lastError = error;
      if (!isCommandNotFoundError(error) && !isMarkitdownPythonModuleUnavailableError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Python executable not found.");
}

function execFileBuffer(
  command: string,
  args: string[],
  options: { maxBuffer: number; timeout: number }
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let timedOut = false;
    let killedForMaxBuffer = false;
    let settled = false;

    const killProcessTree = () => {
      if (!child.pid) {
        return;
      }

      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true
        });
        killer.on("error", () => {
          child.kill("SIGKILL");
        });
        return;
      }

      child.kill("SIGKILL");
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree();
    }, options.timeout);

    const cleanup = () => {
      clearTimeout(timer);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    child.on("error", (error) => {
      rejectOnce(error);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLength += chunk.length;
      if (stdoutLength + stderrLength > options.maxBuffer) {
        killedForMaxBuffer = true;
        killProcessTree();
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrLength += chunk.length;
      if (stdoutLength + stderrLength > options.maxBuffer) {
        killedForMaxBuffer = true;
        killProcessTree();
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      cleanup();
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);

      if (timedOut) {
        const error = new Error(`Command timed out after ${options.timeout}ms: ${command} ${args.join(" ")}`);
        (error as NodeJS.ErrnoException).code = "ETIMEDOUT";
        rejectOnce(error);
        return;
      }

      if (killedForMaxBuffer) {
        const error = new Error(`Command output exceeded maxBuffer ${options.maxBuffer}: ${command} ${args.join(" ")}`);
        (error as NodeJS.ErrnoException).code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        rejectOnce(error);
        return;
      }

      if (code !== 0) {
        const stderrPreview = previewCommandOutputForError(decodeMarkitdownOutput(stderr));
        const error = new Error(
          `Command failed with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}: ${command} ${args.join(" ")}${stderrPreview ? `\n${stderrPreview}` : ""}`
        );
        (error as NodeJS.ErrnoException).code = typeof code === "number" ? String(code) : signal ?? "UNKNOWN";
        rejectOnce(error);
        return;
      }

      settled = true;
      resolve({ stdout, stderr });
    });
  });
}

function previewCommandOutputForError(output: string): string {
  const text = String(output ?? "");
  if (text.length <= 1200) {
    return text;
  }

  return `${text.slice(0, 500)}\n...[stderr truncated]...\n${text.slice(-700)}`;
}

function isCommandNotFoundError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | undefined;
  return candidate?.code === "ENOENT" || String(candidate?.message ?? "").includes("ENOENT");
}

function decodeMarkitdownOutput(stdout: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(stdout);
  } catch {
    return new TextDecoder("gb18030").decode(stdout);
  }
}

function parseMarkitdownVersion(output: string): string | undefined {
  const match = String(output ?? "").match(/(?:markitdown\s+)?(\d+\.\d+\.\d+(?:[A-Za-z0-9.+-]*))/iu);
  return match?.[1];
}

function isMarkitdownPythonModuleUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /No module named ['"]?markitdown|ModuleNotFoundError.*markitdown/iu.test(message);
}

export const __markitdownTest = {
  decodeMarkitdownOutput,
  isCommandNotFoundError,
  isMarkitdownPythonModuleUnavailableError,
  markitdownTimeoutMs,
  normalizeSpreadsheetFormulaCell,
  parseMarkitdownVersion,
  sourceAnalysisCacheHasStableParserIdentity,
  formatMarkitdownError
};

function formatMarkitdownError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  let redacted = message;
  for (const name of [
    "OPEN_INSIGHT_OCR_API_KEY",
    "OPEN_INSIGHT_MODEL_API_KEY",
    "OPENAI_API_KEY",
    "XIAOMI_API_KEY"
  ]) {
    const secret = process.env[name]?.trim();
    if (secret && secret.length >= 4) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
  }
  redacted = redacted
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:sk)-[A-Za-z0-9_-]+/g, "[REDACTED]");
  const classification = classifyMarkitdownError(redacted);
  const rawError = previewCommandOutputForError(redacted).slice(0, 900);

  return classification ? `${classification}; raw_error=${rawError}` : rawError;
}

function classifyMarkitdownError(message: string): string | undefined {
  if (/PDFPasswordIncorrect/u.test(message) || (/PdfConverter/u.test(message) && /password/i.test(message))) {
    return "encrypted_or_password_protected_pdf: PDF is encrypted, password protected, or permission restricted; MarkItDown cannot extract body text without an accessible source";
  }
  if (/timed?\s*out|timeout/i.test(message)) {
    return "parser_timeout: MarkItDown exceeded the configured timeout before extracting normalized text";
  }
  if (/FileConversionException/u.test(message)) {
    return "markitdown_file_conversion_failed: MarkItDown could not convert this source into normalized text";
  }
  return undefined;
}

async function copyCompileSourceFile(source: CompileSourceAsset, outputDir: string): Promise<void> {
  const outputPath = path.join(outputDir, source.path);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(source.input_path, outputPath);
}

async function writeCompileSourceModeFile(outputDir: string, sourceMode: CompileSourceMode): Promise<void> {
  const outputPath = path.join(outputDir, "source/source_mode.json");
  const rawSourcesBundled = sourceMode === "source_bundled";
  const record = {
    schema_version: SOURCE_MODE_SCHEMA_VERSION,
    source_mode: sourceMode,
    raw_sources_bundled: rawSourcesBundled,
    normalized_sources_bundled: true,
    query_index_rebuildable: true,
    evidence_boundary: rawSourcesBundled
      ? "原始文件已内置；normalized source 和 query index 仅用于高效读取，完整证据仍以 raw source / source map / digest 为准。"
      : "原始文件未内置；该包可用于上下文读取和追溯到 normalized source，完整原文复核依赖 external refs 或外部系统。"
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function writeCompileQueryIndexDatabase(outputDir: string): Promise<void> {
  const manifestPath = path.join(outputDir, "query_index/manifest.json");
  let manifest: Record<string, unknown>;

  try {
    manifest = await readJsonFile<Record<string, unknown>>(manifestPath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }

  const directIndexPath = stringField(manifest.direct_index_path);
  const databasePath = stringField(manifest.database_path) ?? "query_index/index.sqlite";

  if (!directIndexPath) {
    return;
  }

  const directIndexFullPath = path.join(outputDir, directIndexPath);
  const directIndexStat = await stat(directIndexFullPath);

  if (directIndexStat.size > COMPILE_SQLITE_INDEX_MAX_JSONL_BYTES) {
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          status: "direct_index_jsonl",
          database_available: false,
          access_strategy: "direct_index_jsonl",
          sqlite_builder: "sql.js",
          sqlite_skipped: true,
          sqlite_skip_reason: "direct_index_jsonl_too_large_for_in_memory_sqlite_builder",
          sqlite_skip_threshold_bytes: COMPILE_SQLITE_INDEX_MAX_JSONL_BYTES,
          direct_index_bytes: directIndexStat.size,
          message: "query_index/chunks.jsonl 是当前大包的主查询索引；已跳过内存型 SQLite 构建以避免重复放大索引文本。"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return;
  }

  const chunks = await readQueryIndexChunks(directIndexFullPath);
  const pageFurnitureRecords = await readQueryIndexPageFurniture(path.join(outputDir, "source/page_furniture.jsonl"));
  const spreadsheetFormulaRecords = await readQueryIndexSpreadsheetFormulas(
    path.join(outputDir, "source/spreadsheet_formulas.jsonl")
  );
  const parseDiagnostics = await readQueryIndexParseDiagnostics(path.join(outputDir, "source/parse_diagnostics.jsonl"));
  const sourceMaps = await readQueryIndexSourceMaps(path.join(outputDir, "lineage/source_map.jsonl"));
  const digests = await readQueryIndexDigests(path.join(outputDir, "integrity/digests.json"));
  const sqlJs = await loadSqlJs();
  const db = new sqlJs.Database();
  let databaseBytes: Uint8Array;

  try {
    db.run("PRAGMA user_version = 1;");
    db.run("CREATE TABLE context_sources (source_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_type TEXT NOT NULL, normalized_source_path TEXT NOT NULL, parse_diagnostic_id TEXT NOT NULL);");
    db.run("CREATE TABLE context_chunks (chunk_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, chunk_level TEXT NOT NULL DEFAULT 'document', heading_path_json TEXT NOT NULL DEFAULT '[]', content_role TEXT NOT NULL DEFAULT 'body', render_policy TEXT, page_furniture_kind TEXT, page_number INTEGER, line_numbers_json TEXT NOT NULL DEFAULT '[]', estimated_tokens INTEGER NOT NULL DEFAULT 1, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL, parse_diagnostic_ids TEXT NOT NULL, source_map_refs TEXT NOT NULL);");
    db.run("CREATE TABLE context_page_furniture (artifact_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, normalized_source_path TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, line_numbers_json TEXT NOT NULL, page_number INTEGER, content_role TEXT NOT NULL, render_policy TEXT NOT NULL, confidence REAL, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL, parse_diagnostic_ids TEXT NOT NULL, source_map_refs TEXT NOT NULL);");
    db.run("CREATE TABLE context_spreadsheet_formulas (formula_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_path TEXT NOT NULL, normalized_source_path TEXT NOT NULL, sheet_name TEXT NOT NULL, cell_address TEXT NOT NULL, formula TEXT NOT NULL, formula_type TEXT NOT NULL, formula_resolution_status TEXT NOT NULL, cached_value_available INTEGER NOT NULL, cached_value_json TEXT, cached_value_raw TEXT, cached_value_type TEXT, range_ref TEXT, shared_index TEXT, calculation_status TEXT NOT NULL, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL, parse_diagnostic_ids TEXT NOT NULL, source_map_refs TEXT NOT NULL);");
    db.run("CREATE TABLE context_tables (table_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, field_count INTEGER NOT NULL, row_count INTEGER, parse_diagnostic_ids TEXT NOT NULL);");
    db.run("CREATE TABLE context_parse_diagnostics (diagnostic_id TEXT PRIMARY KEY, source_id TEXT NOT NULL, parser TEXT NOT NULL, parser_version TEXT, parser_role TEXT NOT NULL, normalized_source_path TEXT NOT NULL, status TEXT NOT NULL, confidence REAL, cloud_used INTEGER NOT NULL, message TEXT NOT NULL, source_refs TEXT NOT NULL, lineage_refs TEXT NOT NULL);");
    db.run("CREATE TABLE context_source_maps (source_map_id TEXT PRIMARY KEY, object_id TEXT NOT NULL, object_type TEXT NOT NULL, source_id TEXT NOT NULL, source_path TEXT NOT NULL, raw_source_path TEXT NOT NULL, normalized_source_path TEXT NOT NULL, parse_diagnostic_id TEXT NOT NULL, ranges_json TEXT NOT NULL, provenance_status TEXT NOT NULL);");
    db.run("CREATE TABLE context_digests (digest_id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_ref TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, verification_level TEXT NOT NULL, content_available_in_source_light INTEGER NOT NULL);");
    db.run("CREATE INDEX context_sources_parse_diagnostic_id_idx ON context_sources(parse_diagnostic_id);");
    db.run("CREATE INDEX context_chunks_source_id_idx ON context_chunks(source_id);");
    db.run("CREATE INDEX context_chunks_chunk_level_idx ON context_chunks(chunk_level);");
    db.run("CREATE INDEX context_chunks_content_role_idx ON context_chunks(content_role);");
    db.run("CREATE INDEX context_page_furniture_source_id_idx ON context_page_furniture(source_id);");
    db.run("CREATE INDEX context_page_furniture_kind_idx ON context_page_furniture(kind);");
    db.run("CREATE INDEX context_spreadsheet_formulas_source_id_idx ON context_spreadsheet_formulas(source_id);");
    db.run("CREATE INDEX context_spreadsheet_formulas_sheet_cell_idx ON context_spreadsheet_formulas(sheet_name, cell_address);");
    db.run("CREATE INDEX context_parse_diagnostics_source_id_idx ON context_parse_diagnostics(source_id);");
    db.run("CREATE INDEX context_source_maps_source_id_idx ON context_source_maps(source_id);");
    db.run("CREATE INDEX context_source_maps_parse_diagnostic_id_idx ON context_source_maps(parse_diagnostic_id);");
    db.run("CREATE INDEX context_digests_target_ref_idx ON context_digests(target_ref);");
    db.run("CREATE VIRTUAL TABLE context_chunks_fts USING fts4(chunk_id, title, text, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs);");

    const sourceStatement = db.prepare(
      "INSERT OR IGNORE INTO context_sources (source_id, source_path, source_type, normalized_source_path, parse_diagnostic_id) VALUES (?, ?, ?, ?, ?);"
    );
    const chunkStatement = db.prepare(
      "INSERT INTO context_chunks (chunk_id, source_id, title, text, chunk_level, heading_path_json, content_role, render_policy, page_furniture_kind, page_number, line_numbers_json, estimated_tokens, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
    );
    const pageFurnitureStatement = db.prepare(
      "INSERT OR IGNORE INTO context_page_furniture (artifact_id, source_id, normalized_source_path, kind, text, line_numbers_json, page_number, content_role, render_policy, confidence, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
    );
    const spreadsheetFormulaStatement = db.prepare(
      "INSERT OR IGNORE INTO context_spreadsheet_formulas (formula_id, source_id, source_path, normalized_source_path, sheet_name, cell_address, formula, formula_type, formula_resolution_status, cached_value_available, cached_value_json, cached_value_raw, cached_value_type, range_ref, shared_index, calculation_status, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
    );
    const tableStatement = db.prepare(
      "INSERT OR IGNORE INTO context_tables (table_id, source_id, field_count, row_count, parse_diagnostic_ids) VALUES (?, ?, ?, ?, ?);"
    );
    const ftsStatement = db.prepare(
      "INSERT INTO context_chunks_fts (chunk_id, title, text, source_refs, lineage_refs, parse_diagnostic_ids, source_map_refs) VALUES (?, ?, ?, ?, ?, ?, ?);"
    );
    const parseDiagnosticStatement = db.prepare(
      "INSERT OR IGNORE INTO context_parse_diagnostics (diagnostic_id, source_id, parser, parser_version, parser_role, normalized_source_path, status, confidence, cloud_used, message, source_refs, lineage_refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
    );
    const sourceMapStatement = db.prepare(
      "INSERT OR IGNORE INTO context_source_maps (source_map_id, object_id, object_type, source_id, source_path, raw_source_path, normalized_source_path, parse_diagnostic_id, ranges_json, provenance_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);"
    );
    const digestStatement = db.prepare(
      "INSERT OR IGNORE INTO context_digests (digest_id, target_type, target_ref, path, hash, verification_level, content_available_in_source_light) VALUES (?, ?, ?, ?, ?, ?, ?);"
    );

    try {
      for (const diagnostic of parseDiagnostics) {
        parseDiagnosticStatement.run([
          diagnostic.diagnostic_id,
          diagnostic.source_id,
          diagnostic.parser,
          diagnostic.parser_version ?? null,
          diagnostic.parser_role,
          diagnostic.normalized_source_path,
          diagnostic.status,
          diagnostic.confidence ?? null,
          diagnostic.cloud_used ? 1 : 0,
          diagnostic.message,
          JSON.stringify(diagnostic.source_refs),
          JSON.stringify(diagnostic.lineage_refs)
        ]);
      }

      for (const sourceMap of sourceMaps) {
        sourceMapStatement.run([
          sourceMap.source_map_id,
          sourceMap.object_id,
          sourceMap.object_type,
          sourceMap.source_id,
          sourceMap.source_path,
          sourceMap.raw_source_path,
          sourceMap.normalized_source_path,
          sourceMap.parse_diagnostic_id,
          JSON.stringify(sourceMap.ranges),
          sourceMap.provenance_status
        ]);
      }

      for (const digest of digests) {
        digestStatement.run([
          digest.digest_id,
          digest.target_type,
          digest.target_ref,
          digest.path,
          digest.hash,
          digest.verification_level,
          digest.content_available_in_source_light ? 1 : 0
        ]);
      }

      for (const record of spreadsheetFormulaRecords) {
        spreadsheetFormulaStatement.run([
          record.formula_id,
          record.source_id,
          record.source_path,
          record.normalized_source_path,
          record.sheet_name,
          record.cell_address,
          record.formula,
          record.formula_type,
          record.formula_resolution_status,
          record.cached_value_available ? 1 : 0,
          record.cached_value_available ? JSON.stringify(record.cached_value ?? null) : null,
          record.cached_value_raw ?? null,
          record.cached_value_type ?? null,
          record.range_ref ?? null,
          record.shared_index ?? null,
          record.calculation_status,
          JSON.stringify(record.source_refs),
          JSON.stringify(record.lineage_refs),
          JSON.stringify(record.parse_diagnostic_ids),
          JSON.stringify(record.source_map_refs)
        ]);
      }

      for (const chunk of chunks) {
        const sourceRefs = JSON.stringify(chunk.source_refs);
        const lineageRefs = JSON.stringify(chunk.lineage_refs);
        const parseDiagnosticIds = JSON.stringify(chunk.parse_diagnostic_ids);
        const sourceMapRefs = JSON.stringify(chunk.source_map_refs);
        const lineNumbers = JSON.stringify(chunk.line_numbers ?? []);

        sourceStatement.run([
          chunk.source_id,
          chunk.source_path,
          chunk.source_type,
          chunk.normalized_source_path,
          chunk.parse_diagnostic_ids[0] ?? `parse_${chunk.source_id}`
        ]);
        chunkStatement.run([
          chunk.chunk_id,
          chunk.source_id,
          chunk.title,
          chunk.text,
          chunk.chunk_level,
          JSON.stringify(chunk.heading_path),
          chunk.content_role,
          chunk.render_policy ?? null,
          chunk.page_furniture_kind ?? null,
          chunk.page_number ?? null,
          lineNumbers,
          chunk.estimated_tokens,
          sourceRefs,
          lineageRefs,
          parseDiagnosticIds,
          sourceMapRefs
        ]);
        if (chunk.content_role === "page_furniture" || chunk.content_role === "disclaimer") {
          pageFurnitureStatement.run([
            chunk.chunk_id.replace(/^page_furniture\./, ""),
            chunk.source_id,
            chunk.normalized_source_path,
            chunk.page_furniture_kind ?? chunk.content_role,
            chunk.text,
            lineNumbers,
            chunk.page_number ?? null,
            chunk.content_role,
            chunk.render_policy ?? "deemphasize_in_readable_html",
            null,
            sourceRefs,
            lineageRefs,
            parseDiagnosticIds,
            sourceMapRefs
          ]);
        }
        tableStatement.run([chunk.source_id, chunk.source_id, chunk.field_count ?? 0, chunk.row_count ?? null, parseDiagnosticIds]);
        ftsStatement.run([chunk.chunk_id, chunk.title, chunk.text, sourceRefs, lineageRefs, parseDiagnosticIds, sourceMapRefs]);
      }

      const chunkBySourceId = new Map(chunks.map((chunk) => [chunk.source_id, chunk]));
      for (const record of pageFurnitureRecords) {
        const sourceChunk = chunkBySourceId.get(record.source_id);
        const sourceRefs = JSON.stringify(record.source_refs);
        const lineageRefs = JSON.stringify(record.lineage_refs);
        const parseDiagnosticIds = JSON.stringify(record.parse_diagnostic_ids);
        const sourceMapRefs = JSON.stringify(record.source_map_refs);
        const lineNumbers = JSON.stringify(record.line_numbers);
        const chunkId = `page_furniture.${record.artifact_id}`;

        pageFurnitureStatement.run([
          record.artifact_id,
          record.source_id,
          record.normalized_source_path,
          record.kind,
          record.text,
          lineNumbers,
          record.page_number ?? null,
          record.content_role,
          record.render_policy,
          record.confidence ?? null,
          sourceRefs,
          lineageRefs,
          parseDiagnosticIds,
          sourceMapRefs
        ]);
        chunkStatement.run([
          chunkId,
          record.source_id,
          `${record.kind}: ${record.text}`,
          record.text,
          "page_furniture",
          "[]",
          record.content_role,
          record.render_policy,
          record.kind,
          record.page_number ?? null,
          lineNumbers,
          estimateCliContextTokens(record.text),
          sourceRefs,
          lineageRefs,
          parseDiagnosticIds,
          sourceMapRefs
        ]);
        ftsStatement.run([chunkId, `${record.kind}: ${record.text}`, record.text, sourceRefs, lineageRefs, parseDiagnosticIds, sourceMapRefs]);
        if (sourceChunk) {
          tableStatement.run([record.source_id, record.source_id, sourceChunk.field_count ?? 0, sourceChunk.row_count ?? null, parseDiagnosticIds]);
        }
      }
    } finally {
      sourceStatement.free();
      chunkStatement.free();
      pageFurnitureStatement.free();
      spreadsheetFormulaStatement.free();
      tableStatement.free();
      ftsStatement.free();
      parseDiagnosticStatement.free();
      sourceMapStatement.free();
      digestStatement.free();
    }

    databaseBytes = db.export();
  } catch (error) {
    throw new Error(`SQLite 查询索引构建失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db.close();
  }

  const outputPath = path.join(outputDir, databasePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(databaseBytes));
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        status: "sqlite_database",
        database_available: true,
        access_strategy: "sqlite_database",
        sqlite_builder: "sql.js",
        sqlite_fts: "fts4",
        provenance_tables_available: true,
        sqlite_table_counts: {
          chunks: chunks.length + pageFurnitureRecords.length,
          page_furniture: pageFurnitureRecords.length,
          spreadsheet_formulas: spreadsheetFormulaRecords.length,
          parse_diagnostics: parseDiagnostics.length,
          source_maps: sourceMaps.length,
          digests: digests.length
        },
        message: "已内置可用 SQLite/FTS 查询索引；该索引用于加速 LLM/Agent 读取，不替代 normalized source、source map、parse diagnostics 或 raw source。"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  const sqlJsModule = await import("sql.js");
  const initSqlJs = ((sqlJsModule as { default?: InitSqlJs }).default ?? (sqlJsModule as unknown as InitSqlJs)) as InitSqlJs;

  return initSqlJs();
}

async function readQueryIndexChunks(inputPath: string): Promise<QueryIndexChunkRecord[]> {
  const text = await readFile(inputPath, "utf8");

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => normalizeQueryIndexChunkRecord(parseQueryIndexChunkLine(line, index), index));
}

async function readQueryIndexPageFurniture(inputPath: string): Promise<QueryIndexPageFurnitureRecord[]> {
  const records = await readOptionalJsonlRecords(inputPath, "source/page_furniture.jsonl");

  return records.map((record, index) => normalizeQueryIndexPageFurnitureRecord(record, index));
}

async function readQueryIndexSpreadsheetFormulas(
  inputPath: string
): Promise<QueryIndexSpreadsheetFormulaRecord[]> {
  const records = await readOptionalJsonlRecords(inputPath, "source/spreadsheet_formulas.jsonl");

  return records.map((record, index) => normalizeQueryIndexSpreadsheetFormulaRecord(record, index));
}

async function readQueryIndexParseDiagnostics(inputPath: string): Promise<QueryIndexParseDiagnosticRecord[]> {
  const records = await readOptionalJsonlRecords(inputPath, "source/parse_diagnostics.jsonl");

  return records.map((record, index) => normalizeQueryIndexParseDiagnosticRecord(record, index));
}

async function readQueryIndexSourceMaps(inputPath: string): Promise<QueryIndexSourceMapRecord[]> {
  const records = await readOptionalJsonlRecords(inputPath, "lineage/source_map.jsonl");

  return records.map((record, index) => normalizeQueryIndexSourceMapRecord(record, index));
}

async function readQueryIndexDigests(inputPath: string): Promise<QueryIndexDigestRecord[]> {
  let ledger: Record<string, unknown>;

  try {
    ledger = await readJsonFile<Record<string, unknown>>(inputPath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }

  const entries = Array.isArray(ledger.entries) ? ledger.entries.filter(isRecord) : [];

  return entries.map((record, index) => normalizeQueryIndexDigestRecord(record, index));
}

async function readOptionalJsonlRecords(inputPath: string, label: string): Promise<Array<Record<string, unknown>>> {
  let text: string;

  try {
    text = await readFile(inputPath, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line);

        if (!isRecord(parsed)) {
          throw new Error("not_object");
        }

        return parsed;
      } catch {
        throw new Error(`${label} 第 ${index + 1} 行不是合法 JSON 对象，无法构建 SQLite provenance 索引。`);
      }
    });
}

function parseQueryIndexChunkLine(line: string, index: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_object");
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`query_index/chunks.jsonl 第 ${index + 1} 行不是合法 JSON 对象，无法构建 SQLite 查询索引。`);
  }
}

function normalizeQueryIndexChunkRecord(record: Record<string, unknown>, index: number): QueryIndexChunkRecord {
  const chunkId = requiredStringField(record.chunk_id, "chunk_id", index);
  const sourceId = requiredStringField(record.source_id, "source_id", index);
  const sourcePath = requiredStringField(record.source_path, "source_path", index);
  const sourceType = requiredStringField(record.source_type, "source_type", index);
  const normalizedSourcePath = requiredStringField(record.normalized_source_path, "normalized_source_path", index);
  const title = requiredStringField(record.title, "title", index);
  const text = requiredStringField(record.text, "text", index);
  const fieldCount = optionalNumberField(record.field_count);
  const rowCount = optionalNumberField(record.row_count);
  const pageNumber = optionalNumberField(record.page_number);
  const estimatedTokens = optionalNumberField(record.estimated_tokens) ?? optionalNumberField(record.read_units_estimate) ?? estimateCliContextTokens(text);

  const normalized: QueryIndexChunkRecord = {
    chunk_id: chunkId,
    source_id: sourceId,
    source_path: sourcePath,
    source_type: sourceType,
    normalized_source_path: normalizedSourcePath,
    title,
    text,
    chunk_level: normalizeQueryIndexChunkLevel(record.chunk_level, record.content_role),
    heading_path: stringArrayField(record.heading_path),
    content_role: normalizeQueryIndexContentRole(record.content_role),
    estimated_tokens: estimatedTokens,
    source_refs: stringArrayField(record.source_refs),
    lineage_refs: stringArrayField(record.lineage_refs),
    parse_diagnostic_ids: stringArrayField(record.parse_diagnostic_ids),
    source_map_refs: stringArrayField(record.source_map_refs)
  };

  if (fieldCount !== undefined) {
    normalized.field_count = fieldCount;
  }

  if (rowCount !== undefined) {
    normalized.row_count = rowCount;
  }

  if (typeof record.render_policy === "string" && record.render_policy.trim().length > 0) {
    normalized.render_policy = record.render_policy.trim();
  }

  if (typeof record.page_furniture_kind === "string" && record.page_furniture_kind.trim().length > 0) {
    normalized.page_furniture_kind = record.page_furniture_kind.trim();
  }

  if (pageNumber !== undefined) {
    normalized.page_number = pageNumber;
  }

  if (Array.isArray(record.line_numbers)) {
    const lineNumbers = record.line_numbers.filter((value): value is number => Number.isInteger(value) && value > 0);

    if (lineNumbers.length > 0) {
      normalized.line_numbers = lineNumbers;
    }
  }

  return normalized;
}

function normalizeQueryIndexPageFurnitureRecord(record: Record<string, unknown>, index: number): QueryIndexPageFurnitureRecord {
  const contentRole = normalizeQueryIndexContentRole(record.content_role);
  const normalized: QueryIndexPageFurnitureRecord = {
    artifact_id: requiredStringField(record.artifact_id, "artifact_id", index),
    source_id: requiredStringField(record.source_id, "source_id", index),
    normalized_source_path: requiredStringField(record.normalized_source_path, "normalized_source_path", index),
    kind: requiredStringField(record.kind, "kind", index),
    text: requiredStringField(record.text, "text", index),
    line_numbers: Array.isArray(record.line_numbers)
      ? record.line_numbers.filter((value): value is number => Number.isInteger(value) && value > 0)
      : [],
    content_role: contentRole === "disclaimer" ? "disclaimer" : "page_furniture",
    render_policy:
      typeof record.render_policy === "string" && record.render_policy.trim().length > 0
        ? record.render_policy.trim()
        : "deemphasize_in_readable_html",
    source_refs: stringArrayField(record.source_refs),
    lineage_refs: stringArrayField(record.lineage_refs),
    parse_diagnostic_ids: stringArrayField(record.parse_diagnostic_ids),
    source_map_refs: stringArrayField(record.source_map_refs)
  };
  const pageNumber = optionalNumberField(record.page_number);
  const confidence = optionalNumberField(record.confidence);

  if (pageNumber !== undefined) {
    normalized.page_number = pageNumber;
  }

  if (confidence !== undefined) {
    normalized.confidence = confidence;
  }

  return normalized;
}

function normalizeQueryIndexSpreadsheetFormulaRecord(
  record: Record<string, unknown>,
  index: number
): QueryIndexSpreadsheetFormulaRecord {
  const label = "source/spreadsheet_formulas.jsonl";
  const cachedValueType = stringField(record.cached_value_type);
  const rangeRef = stringField(record.range_ref);
  const sharedIndex = stringField(record.shared_index);
  const cachedValueRaw = typeof record.cached_value_raw === "string" ? record.cached_value_raw : undefined;
  const cachedValue =
    record.cached_value === null ||
    typeof record.cached_value === "string" ||
    typeof record.cached_value === "number" ||
    typeof record.cached_value === "boolean"
      ? record.cached_value
      : undefined;

  return {
    formula_id: requiredRecordString(record, "formula_id", label, index),
    source_id: requiredRecordString(record, "source_id", label, index),
    source_path: requiredRecordString(record, "source_path", label, index),
    normalized_source_path: requiredRecordString(record, "normalized_source_path", label, index),
    sheet_name: requiredRecordString(record, "sheet_name", label, index),
    cell_address: requiredRecordString(record, "cell_address", label, index),
    formula: requiredRecordStringAllowEmpty(record, "formula", label, index),
    formula_type: requiredRecordString(record, "formula_type", label, index),
    formula_resolution_status:
      record.formula_resolution_status === "unresolved_shared" ? "unresolved_shared" : "resolved",
    cached_value_available: record.cached_value_available === true,
    ...(record.cached_value_available === true ? { cached_value: cachedValue ?? null } : {}),
    ...(cachedValueRaw !== undefined ? { cached_value_raw: cachedValueRaw } : {}),
    ...(cachedValueType ? { cached_value_type: cachedValueType } : {}),
    ...(rangeRef ? { range_ref: rangeRef } : {}),
    ...(sharedIndex ? { shared_index: sharedIndex } : {}),
    calculation_status: requiredRecordString(record, "calculation_status", label, index),
    source_refs: stringArrayField(record.source_refs),
    lineage_refs: stringArrayField(record.lineage_refs),
    parse_diagnostic_ids: stringArrayField(record.parse_diagnostic_ids),
    source_map_refs: stringArrayField(record.source_map_refs)
  };
}

function estimateCliContextTokens(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const otherChars = Math.max(0, text.length - cjkChars);

  return Math.max(1, Math.ceil(cjkChars * 0.8 + otherChars / 4));
}

function normalizeQueryIndexChunkLevel(value: unknown, contentRole: unknown): QueryIndexChunkRecord["chunk_level"] {
  if (value === "document" || value === "section" || value === "paragraph" || value === "table" || value === "page_furniture") {
    return value;
  }

  if (contentRole === "table") {
    return "table";
  }

  if (contentRole === "page_furniture" || contentRole === "disclaimer") {
    return "page_furniture";
  }

  return "document";
}

function normalizeQueryIndexContentRole(value: unknown): QueryIndexChunkRecord["content_role"] {
  if (
    value === "body" ||
    value === "table" ||
    value === "heading" ||
    value === "page_furniture" ||
    value === "disclaimer"
  ) {
    return value;
  }

  return "body";
}

function normalizeQueryIndexParseDiagnosticRecord(record: Record<string, unknown>, index: number): QueryIndexParseDiagnosticRecord {
  const parserVersion = stringField(record.parser_version);
  const confidence = optionalNumberField(record.confidence);
  const normalized: QueryIndexParseDiagnosticRecord = {
    diagnostic_id: requiredRecordString(record, "diagnostic_id", "source/parse_diagnostics.jsonl", index),
    source_id: requiredRecordString(record, "source_id", "source/parse_diagnostics.jsonl", index),
    parser: requiredRecordString(record, "parser", "source/parse_diagnostics.jsonl", index),
    parser_role: requiredRecordString(record, "parser_role", "source/parse_diagnostics.jsonl", index),
    normalized_source_path: requiredRecordString(record, "normalized_source_path", "source/parse_diagnostics.jsonl", index),
    status: requiredRecordString(record, "status", "source/parse_diagnostics.jsonl", index),
    cloud_used: record.cloud_used === true,
    message: requiredRecordString(record, "message", "source/parse_diagnostics.jsonl", index),
    source_refs: stringArrayField(record.source_refs),
    lineage_refs: stringArrayField(record.lineage_refs)
  };

  if (parserVersion) {
    normalized.parser_version = parserVersion;
  }

  if (confidence !== undefined) {
    normalized.confidence = confidence;
  }

  return normalized;
}

function normalizeQueryIndexSourceMapRecord(record: Record<string, unknown>, index: number): QueryIndexSourceMapRecord {
  return {
    source_map_id: requiredRecordString(record, "source_map_id", "lineage/source_map.jsonl", index),
    object_id: requiredRecordString(record, "object_id", "lineage/source_map.jsonl", index),
    object_type: requiredRecordString(record, "object_type", "lineage/source_map.jsonl", index),
    source_id: requiredRecordString(record, "source_id", "lineage/source_map.jsonl", index),
    source_path: requiredRecordString(record, "source_path", "lineage/source_map.jsonl", index),
    raw_source_path: requiredRecordString(record, "raw_source_path", "lineage/source_map.jsonl", index),
    normalized_source_path: requiredRecordString(record, "normalized_source_path", "lineage/source_map.jsonl", index),
    parse_diagnostic_id: requiredRecordString(record, "parse_diagnostic_id", "lineage/source_map.jsonl", index),
    ranges: Array.isArray(record.ranges) ? record.ranges : [],
    provenance_status: requiredRecordString(record, "provenance_status", "lineage/source_map.jsonl", index)
  };
}

function normalizeQueryIndexDigestRecord(record: Record<string, unknown>, index: number): QueryIndexDigestRecord {
  return {
    digest_id: requiredRecordString(record, "digest_id", "integrity/digests.json", index),
    target_type: requiredRecordString(record, "target_type", "integrity/digests.json", index),
    target_ref: requiredRecordString(record, "target_ref", "integrity/digests.json", index),
    path: requiredRecordString(record, "path", "integrity/digests.json", index),
    hash: requiredRecordString(record, "hash", "integrity/digests.json", index),
    verification_level: requiredRecordString(record, "verification_level", "integrity/digests.json", index),
    content_available_in_source_light: record.content_available_in_source_light === true
  };
}

function requiredStringField(value: unknown, field: string, index: number): string {
  const normalized = stringField(value);

  if (!normalized) {
    throw new Error(`query_index/chunks.jsonl 第 ${index + 1} 行缺少 ${field}，无法构建 SQLite 查询索引。`);
  }

  return normalized;
}

function requiredRecordString(record: Record<string, unknown>, field: string, label: string, index: number): string {
  const normalized = stringField(record[field]);

  if (!normalized) {
    throw new Error(`${label} 第 ${index + 1} 条缺少 ${field}，无法构建 SQLite provenance 索引。`);
  }

  return normalized;
}

function requiredRecordStringAllowEmpty(
  record: Record<string, unknown>,
  field: string,
  label: string,
  index: number
): string {
  const value = record[field];

  if (typeof value !== "string") {
    throw new Error(`${label} 第 ${index + 1} 条的 ${field} 必须是字符串，无法构建 SQLite provenance 索引。`);
  }

  return value.trim();
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function optionalNumberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

function summarizeCompileSource(source: CompileSourceAsset, sourceMode: CompileSourceMode): CompileSourceSummary {
  const bundled = sourceMode === "source_bundled";

  return {
    input_path: source.input_path,
    package_path: source.path,
    name: source.name,
    type: source.type,
    size_bytes: source.size_bytes,
    bundled,
    evidence_boundary: bundled ? "raw_source_bundled" : "raw_source_external",
    ...(source.normalized_source?.parser ? { parser: source.normalized_source.parser } : {}),
    ...(source.normalized_source?.parser_version ? { parser_version: source.normalized_source.parser_version } : {}),
    ...(source.normalized_source?.status ? { status: source.normalized_source.status } : {}),
    ...(source.normalized_source?.parser_role ? { parser_role: source.normalized_source.parser_role } : {}),
    ...(source.normalized_source ? { cloud_used: source.normalized_source.cloud_used } : {}),
    ...(source.row_count !== undefined ? { row_count: source.row_count } : {}),
    ...(source.columns ? { columns: source.columns } : {}),
    ...(source.spreadsheet_formula_evidence
      ? {
          spreadsheet_formula_status: source.spreadsheet_formula_evidence.status,
          spreadsheet_formula_count: source.spreadsheet_formula_evidence.formula_count,
          spreadsheet_formula_truncated: source.spreadsheet_formula_evidence.truncated
        }
      : {})
  };
}

function parseCompileSourceMode(value: string): CompileSourceMode {
  if (value === "source_bundled" || value === "source_light") {
    return value;
  }

  throw new Error(`未知 source mode：${value}。请使用 source_bundled 或 source_light。`);
}

function parseCompileParserBackend(value: string): CompileParserBackend {
  if (value === "auto" || value === "builtin" || value === "markitdown") {
    return value;
  }

  throw new Error(`未知 parser：${value}。请使用 builtin 或 markitdown。`);
}

function parseCompileParserOptions(commandArgs: string[]): CompileParserOptions {
  return {
    timeoutMs: parseParserTimeoutMs(getFlagValue(commandArgs, "--parser-timeout-ms")),
    ocrMode: parseCompileOcrMode(getFlagValue(commandArgs, "--ocr") ?? "off")
  };
}

function parseCompileResourceLimits(
  commandArgs: string[],
  packageWriteStrategy: CompileResourceLimits["package_write_strategy"]
): CompileResourceLimits {
  return {
    schema_version: "open-insight.compile-resource-limits.v0.1",
    max_source_bytes: parseCompileByteLimit(
      getFlagValue(commandArgs, "--max-source-bytes"),
      "--max-source-bytes",
      DEFAULT_COMPILE_MAX_SOURCE_BYTES
    ),
    max_total_source_bytes: parseCompileByteLimit(
      getFlagValue(commandArgs, "--max-total-source-bytes"),
      "--max-total-source-bytes",
      DEFAULT_COMPILE_MAX_TOTAL_SOURCE_BYTES
    ),
    max_normalized_bytes: parseCompileByteLimit(
      getFlagValue(commandArgs, "--max-normalized-bytes"),
      "--max-normalized-bytes",
      DEFAULT_COMPILE_MAX_NORMALIZED_BYTES
    ),
    max_total_normalized_bytes: parseCompileByteLimit(
      getFlagValue(commandArgs, "--max-total-normalized-bytes"),
      "--max-total-normalized-bytes",
      DEFAULT_COMPILE_MAX_TOTAL_NORMALIZED_BYTES
    ),
    source_hash_strategy: "streaming_sha256",
    package_write_strategy: packageWriteStrategy
  };
}

function parseCompileByteLimit(value: string | undefined, flagName: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/iu);
  if (!match) {
    throw new Error(`${flagName} 必须是正数字节数，或使用 KB、MB、GB 后缀，例如 512MB。`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "B").toUpperCase();
  const multiplier = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : unit === "KB" ? 1024 : 1;
  const bytes = Math.trunc(amount * multiplier);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 64 * 1024 ** 3) {
    throw new Error(`${flagName} 必须在 1B 到 64GB 之间。`);
  }
  return bytes;
}

async function preflightCompileSources(
  sourcePaths: string[],
  resourceLimits: CompileResourceLimits
): Promise<Map<string, Awaited<ReturnType<typeof stat>>>> {
  const sourceStats = new Map<string, Awaited<ReturnType<typeof stat>>>();
  let totalSourceBytes = 0;

  for (const sourcePath of sourcePaths) {
    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(sourcePath);
    } catch (error) {
      throw new Error(
        `SOURCE_PREFLIGHT_FAILED：无法读取来源 ${path.basename(sourcePath)}；原因：${formatMarkitdownError(error)}`
      );
    }
    if (!sourceStat.isFile()) {
      throw new Error(`SOURCE_PREFLIGHT_FAILED：来源 ${path.basename(sourcePath)} 不是普通文件。`);
    }

    const sourceBytes = Number(sourceStat.size);
    if (sourceBytes > resourceLimits.max_source_bytes) {
      throw new Error(
        `SOURCE_SIZE_LIMIT_EXCEEDED：来源 ${path.basename(sourcePath)} 大小为 ${formatProgressBytes(sourceBytes)}，` +
          `超过单文件上限 ${formatProgressBytes(resourceLimits.max_source_bytes)}。` +
          "请拆分文件，或在确认本机内存后通过 --max-source-bytes 调整。"
      );
    }

    totalSourceBytes += sourceBytes;
    if (totalSourceBytes > resourceLimits.max_total_source_bytes) {
      throw new Error(
        `TOTAL_SOURCE_SIZE_LIMIT_EXCEEDED：来源总大小为 ${formatProgressBytes(totalSourceBytes)}，` +
          `超过总上限 ${formatProgressBytes(resourceLimits.max_total_source_bytes)}。` +
          "请拆分编译批次，或在确认磁盘与内存容量后通过 --max-total-source-bytes 调整。"
      );
    }
    sourceStats.set(sourcePath, sourceStat);
  }

  return sourceStats;
}

async function resolveCompileParserOptions(
  commandArgs: string[],
  sourcePaths: string[],
  parserBackend: CompileParserBackend,
  markitdownConvert?: MarkitdownConvert
): Promise<CompileParserOptions> {
  const options = parseCompileParserOptions(commandArgs);
  const needsMarkitdown =
    parserBackend === "markitdown" ||
    (parserBackend === "auto" &&
      sourcePaths.some((sourcePath) => AUTO_MARKITDOWN_SOURCE_TYPES.has(path.extname(sourcePath).slice(1).toLowerCase())));

  if (options.ocrMode === "llm" && parserBackend === "builtin") {
    throw new Error("OCR_REQUIRES_MARKITDOWN：--ocr llm 只能与 --parser auto 或 --parser markitdown 一起使用。");
  }
  if (options.ocrMode === "llm" && !needsMarkitdown) {
    throw new Error("OCR_SOURCE_UNSUPPORTED：本批来源没有 PDF、DOCX、XLSX 或 PPTX，无法使用 MarkItDown OCR。");
  }

  if (!needsMarkitdown) {
    return options;
  }

  if (markitdownConvert) {
    return { ...options, parserVersion: options.ocrMode === "llm" ? "custom-ocr" : "custom" };
  }

  const parserVersion = await detectLocalMarkitdownVersion(options.timeoutMs);
  if (options.ocrMode === "llm") {
    const ocrModel = requireOcrModelConfig();
    const ocrPluginVersion = await detectPythonPackageVersion("markitdown-ocr", options.timeoutMs);
    if (!ocrPluginVersion) {
      throw new Error(
        'OCR_PLUGIN_MISSING：未检测到 markitdown-ocr。请先安装 pip install "markitdown-ocr>=0.1,<0.2" openai。'
      );
    }
    return {
      ...options,
      ...(parserVersion
        ? { parserVersion: `${parserVersion}+markitdown-ocr/${ocrPluginVersion}+model/${ocrModel}` }
        : {}),
      ocrPluginVersion
    };
  }
  return {
    ...options,
    ...(parserVersion ? { parserVersion } : {})
  };
}

function parseCompileOcrMode(value: string): CompileOcrMode {
  if (value === "off" || value === "llm") {
    return value;
  }
  throw new Error("未知 OCR 模式。请使用 --ocr off 或 --ocr llm。");
}

function requireOcrModelConfig(): string {
  const apiKey = process.env.OPEN_INSIGHT_OCR_API_KEY?.trim();
  const model = process.env.OPEN_INSIGHT_OCR_MODEL?.trim();
  const missing = [
    ...(apiKey ? [] : ["OPEN_INSIGHT_OCR_API_KEY"]),
    ...(model ? [] : ["OPEN_INSIGHT_OCR_MODEL"])
  ];
  if (missing.length > 0) {
    throw new Error(
      `OCR_CONFIG_MISSING：缺少 ${missing.join("、")}。OCR 只在显式 --ocr llm 时读取专用本地环境变量。`
    );
  }
  return model as string;
}

function parseCompileSourceAnalysisCache(commandArgs: string[], invocationRoot: string): CompileSourceAnalysisCacheOptions {
  const cacheDir = getFlagValue(commandArgs, "--source-analysis-cache-dir");

  if (!cacheDir) {
    return {
      schema_version: "open-insight.source-analysis-cache.v0.1",
      enabled: false,
      hits: 0,
      misses: 0,
      writes: 0,
      read_errors: 0
    };
  }

  return {
    schema_version: "open-insight.source-analysis-cache.v0.1",
    enabled: true,
    cache_dir: path.resolve(invocationRoot, cacheDir),
    hits: 0,
    misses: 0,
    writes: 0,
    read_errors: 0
  };
}

function publicCompileSourceAnalysisCache(cache: CompileSourceAnalysisCacheOptions): CompileSourceAnalysisCache {
  return {
    schema_version: cache.schema_version,
    enabled: cache.enabled,
    ...(cache.cache_dir ? { cache_dir: cache.cache_dir } : {}),
    hits: cache.hits,
    misses: cache.misses,
    writes: cache.writes,
    read_errors: cache.read_errors
  };
}

function publicCompilePackPath(inputPath: string, invocationRoot: string): string {
  const resolvedRoot = path.resolve(invocationRoot);
  const resolvedPath = path.resolve(inputPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const isInsideInvocationRoot =
    relativePath === "" ||
    (!path.isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`));

  if (isInsideInvocationRoot) {
    return relativePath ? normalizePackagePath(relativePath) : ".";
  }

  return `external/${path.basename(resolvedPath) || "path"}`;
}

function sanitizeCompilePackError(message: string): string {
  return message
    .replace(/file:\/\/{2,3}[^\s"'`]+/giu, "[LOCAL_PATH]")
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\\\\|\/)[^"'\r\n]+\1/gu, "$1[LOCAL_PATH]$1")
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n;；，,]+/gu, "[LOCAL_PATH]");
}

function publicCompilePackSourceSummary(source: CompileSourceSummary, invocationRoot: string): CompileSourceSummary {
  return {
    ...source,
    input_path: publicCompilePackPath(source.input_path, invocationRoot)
  };
}

function publicCompilePackSourceAnalysisCache(
  cache: CompileSourceAnalysisCache,
  invocationRoot: string
): CompileSourceAnalysisCache {
  return {
    ...cache,
    ...(cache.cache_dir ? { cache_dir: publicCompilePackPath(cache.cache_dir, invocationRoot) } : {})
  };
}

function compilePackPrivacy(debugStackOptIn: boolean): CompilePackPrivacy {
  return {
    path_policy: "invocation_relative_or_external_basename",
    local_paths_redacted: !debugStackOptIn,
    debug_stack_opt_in: debugStackOptIn
  };
}

function parseParserTimeoutMs(value: string | undefined): number {
  if (value === undefined) {
    return markitdownTimeoutMs();
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("--parser-timeout-ms 必须是数字毫秒值。");
  }

  const timeoutMs = Math.trunc(parsed);
  if (timeoutMs < 5_000 || timeoutMs > 1_800_000) {
    throw new Error("--parser-timeout-ms 必须在 5000 到 1800000 毫秒之间。");
  }

  return timeoutMs;
}

function shouldUseMarkitdownInAutoMode(source: DraftSource, parserBackend: CompileParserBackend): boolean {
  return parserBackend === "auto" && AUTO_MARKITDOWN_SOURCE_TYPES.has(source.type ?? "");
}

function ensureUniqueCompileSourcePaths(sources: CompileSourceAsset[]): string[] {
  const pathCounts = new Map<string, number>();
  const usedPaths = new Set<string>();
  const warnings: string[] = [];

  for (const source of sources) {
    const normalizedPath = normalizePackagePath(source.path || `sources/${source.name}`);
    const key = normalizedPath.toLowerCase();
    pathCounts.set(key, (pathCounts.get(key) ?? 0) + 1);
  }

  for (const source of sources) {
    const originalPath = normalizePackagePath(source.path || `sources/${source.name}`);
    const originalKey = originalPath.toLowerCase();
    const duplicatePackagePath = (pathCounts.get(originalKey) ?? 0) > 1;
    let candidatePath = originalPath;

    if (duplicatePackagePath || usedPaths.has(originalKey)) {
      const suffix = createCompileSourcePathSuffix(source);
      candidatePath = appendCompileSourcePathSuffix(originalPath, suffix);
      let attempt = 2;
      while (usedPaths.has(candidatePath.toLowerCase())) {
        candidatePath = appendCompileSourcePathSuffix(originalPath, `${suffix}-${attempt}`);
        attempt += 1;
      }
    }

    if (candidatePath !== originalPath) {
      source.path = candidatePath;
      warnings.push(`来源文件名重复：${source.name}；已自动写入 ${candidatePath}，避免 sources/ 中互相覆盖。`);
    }

    usedPaths.add(candidatePath.toLowerCase());
  }

  return warnings;
}

function createCompileSourcePathSuffix(source: CompileSourceAsset): string {
  return createHash("sha256")
    .update(normalizePackagePath(path.resolve(source.input_path)))
    .digest("hex")
    .slice(0, 8);
}

function appendCompileSourcePathSuffix(packagePath: string, suffix: string): string {
  const normalizedPath = normalizePackagePath(packagePath);
  const directory = path.posix.dirname(normalizedPath);
  const extension = path.posix.extname(normalizedPath);
  const basename = path.posix.basename(normalizedPath, extension);
  const filename = `${basename}--${suffix}${extension}`;

  return directory === "." ? filename : `${directory}/${filename}`;
}

async function resolveCompileTemplate(args: string[], invocationRoot: string): Promise<string | undefined> {
  const template = getFlagValue(args, "--template");
  const templateFile = getFlagValue(args, "--template-file");

  if (template && templateFile) {
    throw new Error("不能同时提供 --template 和 --template-file。");
  }

  if (templateFile) {
    return readFile(path.resolve(invocationRoot, templateFile), "utf8");
  }

  return template;
}

function parseCompileDomainPackId(value: string | undefined): DomainPackId | undefined {
  if (!value) {
    return undefined;
  }

  const pack = getDomainPack(value);

  if (!pack) {
    throw new Error(`未知行业包：${value}`);
  }

  return pack.domain_id;
}

function sanitizeCompileId(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "insight";
}

function sanitizeVersionSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized || "main";
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function resolveOptionalCliPath(invocationRoot: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return path.resolve(invocationRoot, value);
}

async function readDirectBaselineSummaryFile(filePath: string): Promise<ExternalBaselineSummary> {
  const payload = await readJsonFile<Record<string, unknown>>(filePath);
  const candidate = isRecord(payload.direct_full_text) ? payload.direct_full_text : payload;
  if (!isRecord(candidate)) {
    throw new Error("--direct-baseline-summary 必须是 token-eval direct_full_text 摘要或包含 direct_full_text 的 JSON。");
  }

  return normalizeExternalBaselineSummary({
    estimated_tokens: Math.max(0, Math.floor(optionalNumberField(candidate.estimated_tokens) ?? 0)),
    file_count: Math.max(0, Math.floor(optionalNumberField(candidate.file_count) ?? 0)),
    total_bytes: Math.max(0, Math.floor(optionalNumberField(candidate.total_bytes) ?? 0)),
    text_file_count: Math.max(0, Math.floor(optionalNumberField(candidate.text_file_count) ?? 0)),
    binary_file_count: Math.max(0, Math.floor(optionalNumberField(candidate.binary_file_count) ?? 0)),
    skipped_file_count: Math.max(0, Math.floor(optionalNumberField(candidate.skipped_file_count) ?? 0)),
    filtered_file_count: Math.max(0, Math.floor(optionalNumberField(candidate.filtered_file_count) ?? 0)),
    included_extensions: stringArrayField(candidate.included_extensions).sort(),
    source_filter: parseDirectBaselineSummarySourceFilter(candidate.source_filter),
    baseline_input_kind: candidate.baseline_input_kind === "file" ? "file" : "directory",
    ...(candidate.baseline_quality === "decoded_text" ||
    candidate.baseline_quality === "mixed" ||
    candidate.baseline_quality === "binary_size_heuristic_only" ||
    candidate.baseline_quality === "large_text_size_heuristic_only" ||
    candidate.baseline_quality === "empty"
      ? { baseline_quality: candidate.baseline_quality }
      : {}),
    ...(typeof candidate.recommended_baseline_action_cn === "string" ? { recommended_baseline_action_cn: candidate.recommended_baseline_action_cn } : {}),
    estimation_methods: parseDirectBaselineSummaryEstimationMethods(candidate.estimation_methods),
    ...(typeof candidate.estimator_version === "string" ? { estimator_version: candidate.estimator_version } : {}),
    ...(typeof candidate.estimation_mode === "string" ? { estimation_mode: candidate.estimation_mode } : {}),
    ...(typeof candidate.input_fingerprint === "string" ? { input_fingerprint: candidate.input_fingerprint } : {}),
    diagnostics: stringArrayField(candidate.diagnostics)
  });
}

function parseDirectBaselineSummarySourceFilter(value: unknown): ExternalBaselineSourceFilter {
  const record = isRecord(value) ? value : {};
  const includeExtensions = Array.isArray(record.include_extensions) ? stringArrayField(record.include_extensions).sort() : null;

  return {
    include_extensions: includeExtensions?.length ? includeExtensions : null,
    exclude_extensions: stringArrayField(record.exclude_extensions).sort(),
    exclude_path_contains: stringArrayField(record.exclude_path_contains).sort()
  };
}

function parseDirectBaselineSummaryEstimationMethods(value: unknown): ExternalBaselineSummary["estimation_methods"] {
  const record = isRecord(value) ? value : {};

  return {
    decoded_text_file_count: Math.max(0, Math.floor(optionalNumberField(record.decoded_text_file_count) ?? 0)),
    binary_size_heuristic_file_count: Math.max(0, Math.floor(optionalNumberField(record.binary_size_heuristic_file_count) ?? 0)),
    large_text_size_heuristic_file_count: Math.max(0, Math.floor(optionalNumberField(record.large_text_size_heuristic_file_count) ?? 0))
  };
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseExtensionFilterList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const extensions = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith(".") ? item : `.${item}`));

  return Array.from(new Set(extensions)).sort();
}

function parsePathContainsFilterList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const fragments = value
    .split(",")
    .map((item) => item.trim().replace(/\\/g, "/").toLowerCase().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .filter((item) => !item.includes(".."));

  return Array.from(new Set(fragments)).sort();
}

function getDirectBaselineSourceFilter(args: string[]): Partial<ExternalBaselineSourceFilter> | undefined {
  const includeExtensions = parseExtensionFilterList(getFlagValue(args, "--direct-baseline-include-ext"));
  const excludeExtensions = parseExtensionFilterList(getFlagValue(args, "--direct-baseline-exclude-ext"));
  const excludePathContains = parsePathContainsFilterList(getFlagValue(args, "--direct-baseline-exclude-path-contains"));

  if (!includeExtensions && !excludeExtensions && !excludePathContains) {
    return undefined;
  }

  return {
    ...(includeExtensions ? { include_extensions: includeExtensions } : {}),
    ...(excludeExtensions ? { exclude_extensions: excludeExtensions } : {}),
    ...(excludePathContains ? { exclude_path_contains: excludePathContains } : {})
  };
}

function getFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1] && !args[index + 1]?.startsWith("--")) {
      values.push(args[index + 1] as string);
      index += 1;
    }
  }

  return values;
}

function parseAskModelMode(value: string): AskModelMode {
  if (value === "auto" || value === "deterministic" || value === "mock" || value === "real") {
    return value;
  }

  throw new Error("用法：--model 必须是 auto、deterministic、mock 或 real。");
}

function getPositionalArgs(args: string[]): string[] {
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--format") {
      index += 1;
      continue;
    }

    if (arg === "--model") {
      index += 1;
      continue;
    }

    if (arg === "--save-overlay") {
      index += 1;
      continue;
    }

    if (
      arg === "--source" ||
      arg === "--branch" ||
      arg === "--reason" ||
      arg === "--title" ||
      arg === "--package-id" ||
      arg === "--template" ||
      arg === "--template-file" ||
      arg === "--domain" ||
      arg === "--supplement" ||
      arg === "--source-analysis-cache-dir" ||
      arg === "--source-mode" ||
      arg === "--parser" ||
      arg === "--ocr" ||
      arg === "--parser-timeout-ms" ||
      arg === "--max-source-bytes" ||
      arg === "--max-total-source-bytes" ||
      arg === "--max-normalized-bytes" ||
      arg === "--max-total-normalized-bytes"
    ) {
      index += 1;
      continue;
    }

    if (arg === "--schema-root") {
      index += 1;
      continue;
    }

    if (
      arg === "--kind" ||
      arg === "--op" ||
      arg === "--filter" ||
      arg === "--document-id" ||
      arg === "--limit" ||
      arg === "--query" ||
      arg === "--token-budget" ||
      arg === "--direct-baseline" ||
      arg === "--direct-baseline-summary" ||
      arg === "--direct-baseline-include-ext" ||
      arg === "--direct-baseline-exclude-ext" ||
      arg === "--direct-baseline-exclude-path-contains" ||
      arg === "--route" ||
      arg === "--max-follow-up-reads"
    ) {
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      continue;
    }

    positional.push(arg);
  }

  return positional;
}

function parseOptionalPositiveInteger(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} 必须是正整数。`);
  }

  return parsed;
}

interface FormatContextOptions {
  selectedMaterialRouteId?: string;
}

function focusContextHandoffRoute(result: ContextCliHandoffResult, selectedRouteId: string | undefined): FocusedContextCliResult {
  if (!selectedRouteId) {
    return result;
  }

  const selectedRecipe = result.material_generation_recipes.routes.find((route) => route.route_id === selectedRouteId);
  if (!selectedRecipe) {
    const availableRoutes = result.material_generation_recipes.routes.map((route) => route.route_id).join(", ");
    throw new Error(`未知 handoff route：${selectedRouteId}。可用 route：${availableRoutes}`);
  }

  return {
    ...result,
    selected_material_recipe: selectedRecipe,
    selected_consumer_route: result.consumer_routes.find((route) => route.route_id === selectedRouteId) ?? null
  };
}

function formatContextResult(result: FocusedContextCliResult, requestedFormat: string, options: FormatContextOptions = {}): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `profile: ${result.profile}`,
    `package_id: ${result.package_id}`,
    `title: ${result.title}`,
    `source_mode: ${result.source_mode}`,
    `source_refs: ${formatInlineList(result.source_refs)}`,
    `lineage_refs: ${formatInlineList(result.lineage_refs)}`,
    `parse_diagnostic_ids: ${formatInlineList(result.parse_diagnostic_ids)}`
  ];

  if ("counts" in result) {
    lines.push("counts:");
    Object.entries(result.counts).forEach(([key, value]) => {
      lines.push(`- ${key}: ${value}`);
    });
  }

  if ("query_index" in result) {
    lines.push("query_index:");
    lines.push(`- available: ${result.query_index.available}`);
    if (result.query_index.available) {
      lines.push(`- database_available: ${result.query_index.database_available}`);
      lines.push(`- rebuild_sql_available: ${result.query_index.rebuild_sql_available}`);
      lines.push(`- direct_index_available: ${result.query_index.direct_index_available}`);
      lines.push(`- access_strategy: ${result.query_index.access_strategy}`);
      lines.push(`- provenance_tables_available: ${result.query_index.provenance_tables_available === true}`);
      lines.push(`- provenance_tables: ${formatInlineList(result.query_index.provenance_tables ?? [])}`);
      lines.push(`- sqlite_table_counts: ${JSON.stringify(result.query_index.sqlite_table_counts ?? {})}`);
      if (result.query_index.rebuild_sql_path) {
        lines.push(`- rebuild_sql_path: ${result.query_index.rebuild_sql_path}`);
      }
      if (result.query_index.direct_index_path) {
        lines.push(`- direct_index_path: ${result.query_index.direct_index_path}`);
      }
    }
  }

  if ("llm_reading_strategy" in result) {
    lines.push("llm_reading_strategy:");
    lines.push(`- preferred_chunk_access: ${result.llm_reading_strategy.preferred_chunk_access}`);
    lines.push(`- evidence_boundary: ${result.llm_reading_strategy.evidence_boundary}`);
    lines.push(`- raw_sources_bundled: ${result.llm_reading_strategy.raw_sources_bundled}`);
    lines.push(`- normalized_sources_available: ${result.llm_reading_strategy.normalized_sources_available}`);
    lines.push(`- query_index_available: ${result.llm_reading_strategy.query_index_available}`);
    lines.push(`- must_disclose_source_light: ${result.llm_reading_strategy.must_disclose_source_light}`);
    lines.push(`- model_required: ${result.llm_reading_strategy.model_required}`);
    lines.push(`- base_package_mutation_allowed: ${result.llm_reading_strategy.base_package_mutation_allowed}`);
  }

  if ("allowed_outputs" in result) {
    lines.push("user_material_contract:");
    lines.push(`- allowed_outputs: ${formatInlineList(result.allowed_outputs)}`);
    lines.push(`- required_citation_fields: ${formatInlineList(result.required_citation_fields)}`);
    lines.push(`- required_sections: ${formatInlineList(result.required_sections)}`);
    lines.push(`- output_boundary: ${result.output_boundary}`);
    lines.push(`- base_package_mutation: ${result.base_package_mutation}`);
    lines.push(`- model_required_by_open_insight: ${result.model_required_by_open_insight}`);
    lines.push(`- source_mode_disclosure_required: ${result.source_mode_disclosure_required}`);
    lines.push(`- preferred_chunk_access: ${result.preferred_chunk_access}`);
    lines.push(`- evidence_boundary: ${result.evidence_boundary}`);
  }

  if ("recommendations" in result) {
    lines.push("output_recommendations:");
    lines.push(`- source_count: ${result.recommendation_basis.source_count}`);
    lines.push(`- source_types: ${formatInlineList(result.recommendation_basis.source_types)}`);
    lines.push(`- dataset_count: ${result.recommendation_basis.dataset_count}`);
    lines.push(`- chunk_count: ${result.recommendation_basis.chunk_count}`);
    lines.push(`- parse_warning_count: ${result.recommendation_basis.parse_warning_count}`);
    for (const item of result.recommendations) {
      lines.push(`- ${item.priority}. ${item.title_cn}: ${item.primary_format}`);
      lines.push(`  - readiness: ${item.readiness}`);
      lines.push(`  - content: ${item.content_suggestion_cn}`);
      lines.push(`  - next_action: ${item.next_action_cn}`);
    }
    lines.push(`- model_invoked: ${result.model_invoked}`);
    lines.push(`- base_package_mutation: ${result.base_package_mutation}`);
  }

  if ("sources" in result) {
    lines.push("sources:");
    lines.push(...formatTextList(result.sources.map((source) => `${source.source_id}: ${source.type}${source.path ? `, ${source.path}` : ""}`)));
  }

  if ("objects" in result) {
    lines.push("objects:");
    lines.push(...formatTextList(result.objects.map((object) => `${object.kind}/${object.object_id}: ${object.title}`)));
  }

  if ("table_id" in result) {
    lines.push(`table_id: ${result.table_id}`);
    lines.push(`operation: ${result.operation}`);
    if (result.field) {
      lines.push(`field: ${result.field}`);
    }
    if (result.filter) {
      lines.push(`filter: ${result.filter}`);
    }
    lines.push(`row_count: ${result.row_count}`);
    lines.push(`value: ${result.value}`);
    lines.push(`contract_refs: ${formatInlineList(result.contract_refs)}`);
  }

  if ("matches" in result) {
    lines.push(`query: ${result.query}`);
    lines.push(`limit: ${result.limit}`);
    lines.push("matches:");
    lines.push(...formatTextList(result.matches.map((match) => `${match.chunk_id}: score=${match.score}; evidence=${formatInlineList(match.evidence_ids)}`)));
  }

  if ("normalized_source_fragment" in result && result.normalized_source_fragment) {
    const fragment = result.normalized_source_fragment;
    lines.push("normalized_source_fragment:");
    lines.push(`- fragment_scope: ${fragment.fragment_scope}`);
    if (fragment.chunk_id) {
      lines.push(`- chunk_id: ${fragment.chunk_id}`);
    }
    if (fragment.normalized_source_path) {
      lines.push(`- normalized_source_path: ${fragment.normalized_source_path}`);
    }
    lines.push(`- estimated_tokens: ${fragment.estimated_tokens}`);
    lines.push(`- truncated: ${fragment.truncated}`);
    lines.push(`- disclosure: ${fragment.source_mode_disclosure_cn}`);
  }

  if ("facts" in result) {
    lines.push(`query: ${result.query}`);
    lines.push(`token_budget: ${result.token_budget}`);
    lines.push(`estimated_tokens: ${result.estimated_tokens}`);
    lines.push(`included_chunk_count: ${result.included_chunk_count}`);
    lines.push("facts:");
    lines.push(...formatTextList(result.facts.map((fact) => `${fact.chunk_id}: ${fact.text.slice(0, 160)}`)));
    if (result.key_numbers.length > 0) {
      lines.push("key_numbers:");
      lines.push(...formatTextList(result.key_numbers.map((item) => `${item.value}: ${item.snippet.slice(0, 120)}`)));
    }
    if (result.tables.length > 0) {
      lines.push("tables:");
      lines.push(...formatTextList(result.tables.map((table) => `${table.chunk_id}: ${table.title}`)));
    }
    lines.push(`page_cues: ${result.page_cues.length}`);
    const firstPageCue = result.page_cues[0];
    if (firstPageCue) {
      lines.push(`page_cue_1: ${firstPageCue.location_label}`);
    }
    if (result.next_fragment_reads.length > 0) {
      lines.push(`next_fragment_reads: ${result.next_fragment_reads.length}`);
      for (const [index, read] of result.next_fragment_reads.slice(0, 3).entries()) {
        lines.push(`- fragment_read_${index + 1}: ${read.chunk_id}`);
        lines.push(`  - cli_command: ${read.cli_command}`);
        lines.push(`  - mcp_tool: ${read.mcp_tool}`);
        lines.push(`  - expected_fragment_field: ${read.expected_fragment_field}`);
      }
    }
    if ("coverage_hints" in result && result.coverage_hints) {
      lines.push("coverage_hints:");
      lines.push(`- recommended_next_action: ${result.coverage_hints.recommended_next_action}`);
      lines.push(`- truncated_by_token_budget: ${result.coverage_hints.truncated_by_token_budget}`);
      lines.push(`- omitted_candidate_count: ${result.coverage_hints.omitted_candidate_count}`);
      lines.push(`- disclosure: ${result.coverage_hints.disclosure_cn}`);
    }
  }

  if ("savings_vs_direct" in result) {
    lines.push(`query: ${result.query}`);
    lines.push(`estimated: ${result.estimated}`);
    lines.push(`token_count_is_estimated: ${result.token_count_is_estimated}`);
    lines.push(`direct_full_text_basis: ${result.direct_full_text_basis}`);
    lines.push(`baseline_disclosure: ${result.baseline_disclosure_cn}`);
    lines.push(`direct_full_text_tokens: ${result.direct_full_text.estimated_tokens}`);
    if (result.direct_full_text.baseline_quality) {
      lines.push(`baseline_quality: ${result.direct_full_text.baseline_quality}`);
    }
    if (result.direct_full_text.recommended_baseline_action_cn) {
      lines.push(`recommended_baseline_action: ${result.direct_full_text.recommended_baseline_action_cn}`);
    }
    if (result.direct_full_text.estimation_methods) {
      lines.push("estimation_methods:");
      lines.push(`- decoded_text_file_count: ${result.direct_full_text.estimation_methods.decoded_text_file_count}`);
      lines.push(`- binary_size_heuristic_file_count: ${result.direct_full_text.estimation_methods.binary_size_heuristic_file_count}`);
      lines.push(`- large_text_size_heuristic_file_count: ${result.direct_full_text.estimation_methods.large_text_size_heuristic_file_count}`);
    }
    lines.push(`insight_full_normalized_tokens: ${result.insight_full_normalized.estimated_tokens}`);
    lines.push(`insight_compact_retrieval_tokens: ${result.insight_compact_retrieval.estimated_tokens}`);
    lines.push(`savings_vs_direct: ${result.savings_vs_direct}`);
    lines.push(`noise_reduction_rate: ${result.noise_reduction_rate}`);
    lines.push(`source_ref_coverage_rate: ${result.source_ref_coverage_rate}`);
    lines.push(`parse_diagnostic_coverage_rate: ${result.parse_diagnostic_coverage_rate}`);
    lines.push(`numeric_preservation_rate: ${result.numeric_preservation_rate}`);
    lines.push(`recommended_mode: ${result.recommended_mode}`);
    if (result.noise_metrics) {
      lines.push("noise_metrics:");
      lines.push(`- measurement_mode: ${result.noise_metrics.measurement_mode}`);
      lines.push(`- estimated_noise_tokens_removed: ${result.noise_metrics.estimated_noise_tokens_removed}`);
      lines.push(`- page_furniture_filtered_count: ${result.noise_metrics.page_furniture_filtered_count}`);
      lines.push(`- document_chunk_excluded_count: ${result.noise_metrics.document_chunk_excluded_count}`);
      lines.push(`- non_returned_fine_grained_chunk_count: ${result.noise_metrics.non_returned_fine_grained_chunk_count}`);
    }
    if (result.diagnostics.length > 0) {
      lines.push("diagnostics:");
      lines.push(...formatTextList(result.diagnostics));
    }
  }

  if ("context_window" in result) {
    lines.push("answer_context:");
    lines.push(`- query: ${result.query}`);
    lines.push(`- token_budget: ${result.token_budget}`);
    lines.push(`- recommended_mode: ${result.recommended_mode}`);
    lines.push(`- answer_handoff_status: ${result.answer_handoff_status}`);
    lines.push(`- compact_tokens: ${result.context_window.compact_estimated_tokens}`);
    lines.push(`- fragment_tokens: ${result.context_window.fragment_estimated_tokens}`);
    lines.push(`- estimated_tokens: ${result.context_window.estimated_tokens}`);
    lines.push(`- fragment_count: ${result.context_window.fragment_count}`);
    lines.push(`- source_count: ${result.context_window.source_count}`);
    lines.push(`- unresolved_reads: ${result.unresolved_reads.length}`);
    lines.push(`- disclose_source_light: ${result.answer_policy.disclose_source_light}`);
    lines.push(`- base_package_mutation: ${result.answer_policy.base_package_mutation}`);
    if (result.source_mode_disclosure) {
      lines.push("source_mode_disclosure:");
      lines.push(`- raw_sources_bundled: ${result.source_mode_disclosure.raw_sources_bundled}`);
      lines.push(`- contains_normalized_source: ${result.source_mode_disclosure.contains_normalized_source}`);
      lines.push(`- contains_source_refs: ${result.source_mode_disclosure.contains_source_refs}`);
      lines.push(`- contains_source_map: ${result.source_mode_disclosure.contains_source_map}`);
      lines.push(`- contains_parse_diagnostics: ${result.source_mode_disclosure.contains_parse_diagnostics}`);
      lines.push(`- disclosure: ${result.source_mode_disclosure.answer_disclosure_cn}`);
    }
    if (result.token_metric_policy) {
      lines.push("token_metric_policy:");
      lines.push(`- preferred_inventory_metric: ${result.token_metric_policy.preferred_inventory_metric}`);
      lines.push(`- query_index_estimated_tokens_are_not_package_totals: ${result.token_metric_policy.query_index_estimated_tokens_are_not_package_totals}`);
      lines.push(`- compact_context_tokens_are_query_scoped: ${result.token_metric_policy.compact_context_tokens_are_query_scoped}`);
      lines.push(`- source_inventory_conservative_estimated_tokens: ${result.token_metric_policy.source_inventory_conservative_estimated_tokens}`);
    }
    if (result.sufficiency_check) {
      lines.push("sufficiency_check:");
      lines.push(`- status: ${result.sufficiency_check.status}`);
      lines.push(`- question_type: ${result.sufficiency_check.question_type}`);
      lines.push(`- safe_conclusion: ${result.sufficiency_check.safe_conclusion_cn}`);
      if (result.sufficiency_check.missing_evidence.length > 0) {
        lines.push(`- missing_evidence: ${formatInlineList(result.sufficiency_check.missing_evidence.map((item) => item.label_cn))}`);
      }
    }
    if (result.context_window.fragments.length > 0) {
      lines.push("fragments:");
      for (const fragment of result.context_window.fragments.slice(0, 3)) {
        lines.push(`- ${fragment.target_id}: ${fragment.title}; tokens=${fragment.estimated_tokens}`);
      }
    }
    if (result.diagnostics.length > 0) {
      lines.push("diagnostics:");
      lines.push(...formatTextList(result.diagnostics));
    }
    return lines.join("\n");
  }

  if ("compact_context" in result) {
    lines.push("handoff:");
    lines.push(`- query: ${result.query}`);
    lines.push(`- token_budget: ${result.token_budget}`);
    lines.push(`- compact_tokens: ${result.compact_context.estimated_tokens}`);
    if (result.answer_handoff) {
      lines.push(`- answer_handoff: ${result.answer_handoff.schema_version}`);
      lines.push(`- answer_status: ${result.answer_handoff.status}`);
      lines.push(`- answer_recommended_mode: ${result.answer_handoff.recommended_mode}`);
      lines.push(`- answer_query_scope: ${result.answer_handoff.query_difficulty.scope}`);
      lines.push(`- answer_parser_quality: ${result.answer_handoff.parser_quality.status}`);
      lines.push(`- quick_answer_readiness: ${result.answer_handoff.answer_modes.quick_answer.readiness}`);
      lines.push(`- audited_answer_readiness: ${result.answer_handoff.answer_modes.audited_answer.readiness}`);
      lines.push(`- audited_follow_up_reads: ${result.answer_handoff.answer_modes.audited_answer.required_follow_up_reads.length}`);
      for (const [index, command] of result.answer_handoff.answer_modes.audited_answer.resolve_source_cli_commands.slice(0, 3).entries()) {
        lines.push(`  - audited_follow_up_${index + 1}: ${command}`);
      }
    }
    lines.push(`- page_cues: ${result.compact_context.page_cues.length}`);
    const firstCompactPageCue = result.compact_context.page_cues[0];
    if (firstCompactPageCue) {
      lines.push(`- page_cue_1: ${firstCompactPageCue.location_label}`);
    }
    if (result.compact_context.next_fragment_reads.length > 0) {
      lines.push(`- next_fragment_reads: ${result.compact_context.next_fragment_reads.length}`);
      for (const [index, read] of result.compact_context.next_fragment_reads.slice(0, 3).entries()) {
        lines.push(`- fragment_read_${index + 1}: ${read.chunk_id}`);
        lines.push(`  - cli_command: ${read.cli_command}`);
        lines.push(`  - mcp_tool: ${read.mcp_tool}`);
        lines.push(`  - expected_fragment_field: ${read.expected_fragment_field}`);
      }
    }
    if (result.compact_context.coverage_hints) {
      lines.push(`- coverage_hints.recommended_next_action: ${result.compact_context.coverage_hints.recommended_next_action}`);
      lines.push(`- coverage_hints.truncated_by_token_budget: ${result.compact_context.coverage_hints.truncated_by_token_budget}`);
      lines.push(`- coverage_hints.disclosure: ${result.compact_context.coverage_hints.disclosure_cn}`);
    }
    lines.push(`- savings_vs_direct: ${result.token_eval.savings_vs_direct}`);
    lines.push(`- token_benchmark: ${result.token_benchmark.schema_version}`);
    lines.push(`- direct_full_text_basis: ${result.token_benchmark.direct_full_text_basis}`);
    lines.push(`- baseline_disclosure: ${result.token_benchmark.baseline_disclosure_cn}`);
    if (result.token_benchmark.baseline_quality) {
      lines.push(`- baseline_quality: ${result.token_benchmark.baseline_quality}`);
    }
    if (result.token_benchmark.recommended_baseline_action_cn) {
      lines.push(`- recommended_baseline_action: ${result.token_benchmark.recommended_baseline_action_cn}`);
    }
    if (result.token_benchmark.estimation_methods) {
      lines.push(`- estimation_methods.decoded_text_file_count: ${result.token_benchmark.estimation_methods.decoded_text_file_count}`);
      lines.push(`- estimation_methods.binary_size_heuristic_file_count: ${result.token_benchmark.estimation_methods.binary_size_heuristic_file_count}`);
      lines.push(`- estimation_methods.large_text_size_heuristic_file_count: ${result.token_benchmark.estimation_methods.large_text_size_heuristic_file_count}`);
    }
    lines.push(`- direct_full_text_tokens: ${result.token_benchmark.direct_full_text_estimated_tokens}`);
    lines.push(`- insight_full_normalized_tokens: ${result.token_benchmark.insight_full_normalized_estimated_tokens}`);
    lines.push(`- compact_context_tokens: ${result.token_benchmark.insight_compact_estimated_tokens}`);
    lines.push(`- savings_vs_normalized: ${result.token_benchmark.savings_vs_normalized}`);
    lines.push(`- token_benchmark_summary: ${result.token_benchmark.user_facing_summary_cn}`);
    lines.push(`- material_generation_readiness: ${result.material_generation_readiness.status}`);
    lines.push(`- readiness_ready_count: ${result.material_generation_readiness.summary.ready_count}`);
    lines.push(`- readiness_needs_fragment_reads_count: ${result.material_generation_readiness.summary.needs_fragment_reads_count}`);
    lines.push(`- readiness_degraded_count: ${result.material_generation_readiness.summary.degraded_count}`);
    for (const route of result.material_generation_readiness.routes) {
      lines.push(`- readiness_${route.route_id}: ${route.readiness}`);
      lines.push(`  - primary_mcp_tool: ${route.primary_mcp_tool}`);
      if (route.missing_refs.length > 0) {
        lines.push(`  - missing_refs: ${formatInlineList(route.missing_refs)}`);
      }
    }
    lines.push(`- material_generation_recipes: ${result.material_generation_recipes.status}`);
    lines.push(`- material_generation_recipe_count: ${result.material_generation_recipes.recipe_count}`);
    const selectedRecipe = options.selectedMaterialRouteId
      ? result.material_generation_recipes.routes.find((recipe) => recipe.route_id === options.selectedMaterialRouteId)
      : undefined;
    if (selectedRecipe) {
      const selectedRoute = result.consumer_routes.find((route) => route.route_id === selectedRecipe.route_id);
      lines.push(`- selected_material_recipe: ${selectedRecipe.route_id}`);
      lines.push(`- selected_output_kind: ${selectedRecipe.output_kind}`);
      lines.push(`- selected_readiness: ${selectedRecipe.readiness}`);
      lines.push(`- selected_context_mode: ${selectedRecipe.recommended_context_mode}`);
      lines.push(`- selected_primary_cli_command: ${selectedRecipe.primary_cli_command}`);
      lines.push(`- selected_primary_mcp_tool: ${selectedRecipe.primary_mcp_tool}`);
      lines.push(`- selected_read_sequence: ${formatInlineList(selectedRecipe.read_sequence)}`);
      lines.push(`- selected_prompt_skeleton:`);
      lines.push(...selectedRecipe.prompt_skeleton_cn.split(/\r?\n/).map((line) => `  ${line}`));
      lines.push(`- selected_required_citation_fields: ${formatInlineList(selectedRecipe.required_citation_fields)}`);
      lines.push(`- selected_output_contract.output_boundary: ${selectedRecipe.output_contract.output_boundary}`);
      lines.push(`- selected_output_contract.base_package_mutation: ${selectedRecipe.output_contract.base_package_mutation}`);
      lines.push(`- selected_output_contract.model_required_by_open_insight: ${selectedRecipe.output_contract.model_required_by_open_insight}`);
      lines.push(`- selected_follow_up.cli_command_template: ${selectedRecipe.follow_up_read_plan.cli_command_template}`);
      lines.push(`- selected_follow_up.mcp_tool: ${selectedRecipe.follow_up_read_plan.mcp_tool}`);
      lines.push(`- selected_follow_up.expected_fragment_field: ${selectedRecipe.follow_up_read_plan.expected_fragment_field}`);
      if (selectedRoute) {
        lines.push(`- selected_fragment_read_plan.mode: ${selectedRoute.fragment_read_plan.mode}`);
        lines.push(`- selected_fragment_read_plan.source_mode_disclosure_required: ${selectedRoute.fragment_read_plan.source_mode_disclosure_required}`);
      }
    } else {
      for (const recipe of result.material_generation_recipes.routes) {
        lines.push(
          `- recipe_${recipe.route_id}: ${recipe.output_kind} (${recipe.readiness}, context=${recipe.recommended_context_mode}, cli=${recipe.primary_cli_command}, mcp=${recipe.primary_mcp_tool}, base_package_mutation=${recipe.output_contract.base_package_mutation})`
        );
      }
    }
    lines.push(`- consumer_routes: ${formatInlineList(result.consumer_routes.map((route) => route.route_id))}`);
    const restoreRoute = result.consumer_routes.find((route) => route.route_id === "html_restore");
    if (restoreRoute) {
      lines.push(`- html_restore_context_mode: ${restoreRoute.recommended_context_mode}`);
      const fragmentReadPlan = restoreRoute.fragment_read_plan;
      lines.push("- fragment_read_plan:");
      lines.push(`  - mode: ${fragmentReadPlan.mode}`);
      lines.push(`  - cli_command_template: ${fragmentReadPlan.cli_command_template}`);
      lines.push(`  - mcp_tool: ${fragmentReadPlan.mcp_tool}`);
      lines.push(`  - expected_fragment_field: ${fragmentReadPlan.expected_fragment_field}`);
      lines.push(`  - source_mode_disclosure_required: ${fragmentReadPlan.source_mode_disclosure_required}`);
    }
    lines.push(`- allowed_outputs: ${formatInlineList(result.output_policy.allowed_outputs)}`);
    lines.push(`- base_package_mutation: ${result.output_policy.base_package_mutation}`);
    lines.push(`- model_required_by_open_insight: ${result.output_policy.model_required_by_open_insight}`);
    lines.push(`- mcp_tools: ${formatInlineList(result.mcp.required_tools.map((tool) => tool.name))}`);
    if (result.diagnostics.length > 0) {
      lines.push("diagnostics:");
      lines.push(...formatTextList(result.diagnostics));
    }
  }

  if ("resolved" in result) {
    lines.push(`target_id: ${result.target_id}`);
    lines.push(`resolved: ${result.resolved}`);
    if (result.object) {
      lines.push(`object: ${result.object.kind}/${result.object.object_id}`);
    }
    if (result.reason) {
      lines.push(`reason: ${result.reason}`);
    }
  }

  if ("diagnostics" in result && !("savings_vs_direct" in result) && !("compact_context" in result)) {
    lines.push("diagnostics:");
    lines.push(...formatTextList(result.diagnostics.map((diagnostic) => `${diagnostic.diagnostic_id}: ${diagnostic.status}; ${diagnostic.message}`)));
  }

  return lines.join("\n");
}

function formatVersionStatusResult(result: VersionStatusResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `package_id: ${result.package_id}`,
    `title: ${result.title}`,
    "versioning:",
    `- available: ${result.versioning.available}`,
    `- parent_count: ${result.versioning.parent_count}`,
    `- merge_log_count: ${result.versioning.merge_log_count}`,
    `- review_patch_count: ${result.versioning.review_patch_count}`,
    `- review_task_count: ${result.versioning.review_task_count}`,
    `- commit_count: ${result.versioning.commit_count}`,
    `- ref_count: ${result.versioning.ref_count}`,
    `- rollback_count: ${result.versioning.rollback_count}`,
    `- base_package_mutation: ${result.versioning.base_package_mutation}`,
    `- merge_policy: ${result.versioning.merge_policy?.mode ?? "n/a"}`,
    "paths:",
    `- parents: ${result.paths.parents ?? "missing"}`,
    `- merge_log: ${result.paths.merge_log ?? "missing"}`,
    `- refs: ${result.paths.refs ?? "missing"}`,
    `- commits: ${result.paths.commits ?? "missing"}`,
    `- rollback_log: ${result.paths.rollback_log ?? "missing"}`,
    `- diff_summary: ${result.paths.diff_summary ?? "missing"}`,
    `- review_patches: ${result.paths.review_patches ?? "missing"}`,
    "safety:",
    `- base_package_mutation: ${result.safety.base_package_mutation}`,
    `- model_invoked: ${result.safety.model_invoked}`,
    `- package_code_execution: ${result.safety.package_code_execution}`
  ].join("\n");
}

function formatVersionDeriveResult(result: VersionDeriveResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `source_package_id: ${result.source_package_id}`,
    `derived_package_id: ${result.derived_package_id}`,
    `branch_name: ${result.branch_name}`,
    `output_file: ${result.output_file}`,
    `commit_id: ${result.commit_id}`,
    `source_package_digest: ${result.source_package_digest}`,
    `reason: ${result.reason ?? "n/a"}`,
    `file_count: ${result.file_count}`,
    "version_paths:",
    `- parents: ${result.version_paths.parents ?? "missing"}`,
    `- refs: ${result.version_paths.refs}`,
    `- commits: ${result.version_paths.commits}`,
    "safety:",
    `- base_package_mutation: ${result.safety.base_package_mutation}`,
    `- model_invoked: ${result.safety.model_invoked}`,
    `- package_code_execution: ${result.safety.package_code_execution}`
  ].join("\n");
}

function formatVersionRollbackResult(result: VersionRollbackResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `source_package_id: ${result.source_package_id}`,
    `rollback_package_id: ${result.rollback_package_id}`,
    `rollback_target: ${result.rollback_target}`,
    `output_file: ${result.output_file}`,
    `commit_id: ${result.commit_id}`,
    `source_package_digest: ${result.source_package_digest}`,
    `reason: ${result.reason ?? "n/a"}`,
    `file_count: ${result.file_count}`,
    "version_paths:",
    `- refs: ${result.version_paths.refs}`,
    `- commits: ${result.version_paths.commits}`,
    `- rollback_log: ${result.version_paths.rollback_log ?? "missing"}`,
    "safety:",
    `- base_package_mutation: ${result.safety.base_package_mutation}`,
    `- model_invoked: ${result.safety.model_invoked}`,
    `- package_code_execution: ${result.safety.package_code_execution}`
  ].join("\n");
}

function formatVersionMergeResult(result: VersionMergeResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `base_package_id: ${result.base_package_id}`,
    `other_package_id: ${result.other_package_id}`,
    `merged_package_id: ${result.merged_package_id}`,
    `branch_name: ${result.branch_name}`,
    `output_file: ${result.output_file}`,
    `commit_id: ${result.commit_id}`,
    `base_package_digest: ${result.base_package_digest}`,
    `other_package_digest: ${result.other_package_digest}`,
    `merge_strategy: ${result.merge_policy.strategy}`,
    `parent_mutation: ${result.merge_policy.parent_mutation}`,
    `reason: ${result.reason ?? "n/a"}`,
    `file_count: ${result.file_count}`,
    "version_paths:",
    `- parents: ${result.version_paths.parents ?? "missing"}`,
    `- refs: ${result.version_paths.refs}`,
    `- commits: ${result.version_paths.commits}`,
    `- merge_log: ${result.version_paths.merge_log ?? "missing"}`,
    `- diff_summary: ${result.version_paths.diff_summary ?? "missing"}`,
    "safety:",
    `- base_package_mutation: ${result.safety.base_package_mutation}`,
    `- model_invoked: ${result.safety.model_invoked}`,
    `- package_code_execution: ${result.safety.package_code_execution}`
  ].join("\n");
}

function formatVersionLogResult(result: VersionLogResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `package_id: ${result.package_id}`,
    `title: ${result.title}`,
    `event_count: ${result.events.length}`,
    "events:",
    ...formatTextList(
      result.events.map((event) => {
        const eventId = typeof event.event_id === "string" ? event.event_id : "unknown";
        const eventType = typeof event.event_type === "string" ? event.event_type : "unknown";
        return `${eventId}: ${eventType}; parent_mutation=${event.parent_mutation === true}`;
      })
    ),
    "safety:",
    `- base_package_mutation: ${result.safety.base_package_mutation}`,
    `- model_invoked: ${result.safety.model_invoked}`,
    `- package_code_execution: ${result.safety.package_code_execution}`
  ].join("\n");
}

function formatValidationResult(result: ValidationResult, requestedFormat: string): string {
  if (requestedFormat === "text") {
    return formatValidationText(result);
  }

  return JSON.stringify(result, null, 2);
}

function formatSchemaInspectionResult(result: SchemaInspectionResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const statusCounts = {
    ok: result.files.filter((file) => file.status === "ok").length,
    missing: result.files.filter((file) => file.status === "missing").length,
    parse_error: result.files.filter((file) => file.status === "parse_error").length
  };

  return [
    "Open Insight schema 自检:",
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `schema_root: ${result.schema_root}`,
    `schema_files_total: ${result.files.length}`,
    `schema_files_ok: ${statusCounts.ok}`,
    `schema_files_missing: ${statusCounts.missing}`,
    `schema_files_parse_error: ${statusCounts.parse_error}`,
    "files:",
    ...(result.files.length === 0 ? ["- 无"] : result.files.map((file) => `- ${file.schema_file}: ${file.status}`)),
    "issues:",
    ...(result.issues.length === 0 ? ["- 无"] : result.issues.map(formatIssueLine))
  ].join("\n");
}

function formatInteropCheckResult(result: InteropCheckResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    "Open Insight 第三方互操作检查:",
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `summary_only: ${result.summary_only}`,
    "schema:",
    `- status: ${result.schema.status}`,
    `- schema_root: ${result.schema.schema_root}`,
    `- schema_files_total: ${result.schema.files.length}`,
    `- issues: ${result.schema.issues.length}`,
    "conformance:",
    `- status: ${result.conformance.status}`,
    ...(result.conformance.reason ? [`- reason: ${result.conformance.reason}`] : []),
    `- total: ${result.conformance.total}`,
    `- passed: ${result.conformance.passed}`,
    `- failed: ${result.conformance.failed}`,
    `- issue_code_assets: ${result.conformance.issue_code_assets}`,
    `- issue_code_assets_passed: ${result.conformance.issue_code_assets_passed}`,
    `- issue_code_assets_failed: ${result.conformance.issue_code_assets_failed}`,
    "commands:",
    "- npm run schema:check",
    "- npm run conformance"
  ].join("\n");
}

function formatDomainPackSummary(pack: DomainPack): DomainListResult["domain_packs"][number] {
  return {
    domain_id: pack.domain_id,
    namespace: pack.namespace,
    version: pack.version,
    title: pack.title,
    market_focus: pack.market_focus,
    audience: pack.audience,
    default_title: pack.default_title,
    default_package_id: pack.default_package_id,
    required_questions: pack.required_questions.length,
    metric_blueprints: pack.metric_blueprints.length,
    view_rules: pack.view_rules.length
  };
}

function formatDomainListResult(result: DomainListResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    "内置行业包:",
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `count: ${result.count}`,
    ...result.domain_packs.map(
      (pack) =>
        `- ${pack.domain_id}: ${pack.title}；默认标题=${pack.default_title}；必答问题=${pack.required_questions}；指标蓝图=${pack.metric_blueprints}`
    )
  ].join("\n");
}

function getModelStatusResult(): ModelStatusResult {
  return {
    schema_version: MODEL_STATUS_SCHEMA_VERSION,
    ...resolveOpenAICompatibleModelConfigFromEnv()
  };
}

async function listConfiguredModels(modelFetch?: FetchLike): Promise<ModelListCommandResult> {
  const resolution = resolveOpenAICompatibleModelEndpointConfigFromEnv();

  if (!resolution.available) {
    return {
      schema_version: MODEL_LIST_SCHEMA_VERSION,
      status: "blocked",
      model_enabled: false,
      source: resolution.source,
      reason: resolution.message,
      diagnostic_code: "MODEL_ENDPOINT_CONFIG_MISSING"
    };
  }

  try {
    const result = await listOpenAICompatibleModelsFromEnv(undefined, modelFetch ? { fetch: modelFetch } : {});

    return {
      schema_version: MODEL_LIST_SCHEMA_VERSION,
      status: "ok",
      model_enabled: true,
      source: result.source,
      model_config: {
        source: result.source,
        baseUrl: result.baseUrl,
        name: result.name
      },
      model_count: result.models.length,
      models: result.models.map((model) => model.id),
      message: "真实模型列表获取成功。"
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "真实模型列表获取失败：未知错误";

    return {
      schema_version: MODEL_LIST_SCHEMA_VERSION,
      status: "failed",
      model_enabled: false,
      source: resolution.source,
      reason,
      diagnostic_code: classifyModelListFailure(reason)
    };
  }
}

async function pingConfiguredModel(modelFetch?: FetchLike): Promise<ModelPingResult> {
  const resolution = resolveOpenAICompatibleModelConfigFromEnv();

  if (!resolution.available) {
    return {
      schema_version: MODEL_PING_SCHEMA_VERSION,
      status: "blocked",
      model_enabled: false,
      source: resolution.source,
      reason: resolution.message,
      diagnostic_code: "MODEL_CONFIG_MISSING"
    };
  }

  const adapter = createOpenAICompatibleModelAdapterFromEnv(undefined, modelFetch ? { fetch: modelFetch } : {});

  if (!adapter) {
    return {
      schema_version: MODEL_PING_SCHEMA_VERSION,
      status: "failed",
      model_enabled: false,
      source: resolution.source,
      reason: "真实模型配置解析成功，但模型适配器创建失败。",
      diagnostic_code: "MODEL_ADAPTER_CREATE_FAILED"
    };
  }

  const startedAt = Date.now();

  try {
    const output = await adapter.chat({
      messages: [
        {
          role: "system",
          content: "你是 Open Insight 的模型连通性测试。不要输出密钥、环境变量或用户数据。"
        },
        {
          role: "user",
          content: "请用一句中文回复：模型连通性正常。"
        }
      ],
      temperature: 0,
      max_tokens: 80
    });

    return {
      schema_version: MODEL_PING_SCHEMA_VERSION,
      status: "ok",
      model_enabled: true,
      source: resolution.source,
      model_config: {
        source: resolution.source,
        ...resolution.config
      },
      latency_ms: Date.now() - startedAt,
      response_preview: output.content.slice(0, 200),
      message: "真实模型连通性测试通过。"
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";

    return {
      schema_version: MODEL_PING_SCHEMA_VERSION,
      status: "failed",
      model_enabled: false,
      source: resolution.source,
      reason: `真实模型连通性测试失败：${errorMessage}`,
      diagnostic_code: classifyModelPingFailure(errorMessage)
    };
  }
}

function classifyModelListFailure(reason: string): ModelListDiagnosticCode {
  return reason.includes("响应格式无法识别") ? "MODEL_LIST_RESPONSE_INVALID" : "MODEL_LIST_REQUEST_FAILED";
}

function classifyModelPingFailure(reason: string): ModelPingDiagnosticCode {
  return reason.includes("响应格式无法识别") ? "MODEL_PING_RESPONSE_INVALID" : "MODEL_PING_REQUEST_FAILED";
}

function formatModelStatusResult(result: ModelStatusResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    "真实模型配置状态:",
    `schema_version: ${result.schema_version}`,
    `- 状态: ${result.available ? "可用" : "未启用"}`,
    `- 来源: ${result.source}`,
    `- 说明: ${result.message}`,
    "安全边界:",
    "- 不会输出 API key。",
    "- 未配置真实模型时，Reader、Validator 和预置问答仍可离线使用。"
  ];

  if (result.available) {
    lines.push("公开配置:");
    lines.push(`- baseUrl: ${result.config.baseUrl}`);
    lines.push(`- model: ${result.config.model}`);
    lines.push(`- adapter: ${result.config.name}`);
  } else {
    lines.push("缺少配置:");
    lines.push(...formatTextList(result.missing));

    if (result.missing.length === 1 && result.missing[0] === "OPEN_INSIGHT_MODEL_NAME 或 XIAOMI_MODEL") {
      lines.push("下一步:");
      lines.push("- 已有 base URL 和 API key 时，运行 insight model-list --format text 获取可用模型名。");
    }
  }

  return lines.join("\n");
}

function formatModelListResult(result: ModelListCommandResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    "真实模型列表:",
    `schema_version: ${result.schema_version}`,
    `- 状态: ${formatModelCommandStatus(result.status)}`,
    ...(result.source ? [`- 来源: ${result.source}`] : []),
    "安全边界:",
    "- 不输出 API key。",
    "- 不读取或发送任何 .insight 包数据。"
  ];

  if (result.status === "ok") {
    lines.push("公开配置:");
    lines.push(`- baseUrl: ${result.model_config.baseUrl}`);
    lines.push(`- adapter: ${result.model_config.name}`);
    lines.push(`- model_count: ${result.model_count}`);
    lines.push("models:");
    lines.push(...formatTextList(result.models));
    lines.push(`说明: ${result.message}`);
  } else {
    lines.push(`原因: ${result.reason}`);
    if (result.diagnostic_code) {
      lines.push(`diagnostic_code: ${result.diagnostic_code}`);
    }
  }

  return lines.join("\n");
}

function formatModelPingResult(result: ModelPingResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    "真实模型连通性测试:",
    `schema_version: ${result.schema_version}`,
    `- 状态: ${formatModelCommandStatus(result.status)}`,
    ...(result.source ? [`- 来源: ${result.source}`] : []),
    "安全边界:",
    "- 不输出 API key。",
    "- 不读取或发送任何 .insight 包数据。"
  ];

  if (result.status === "ok") {
    lines.push("公开配置:");
    lines.push(`- baseUrl: ${result.model_config.baseUrl}`);
    lines.push(`- model: ${result.model_config.model}`);
    lines.push(`- adapter: ${result.model_config.name}`);
    lines.push(`- latency_ms: ${result.latency_ms}`);
    lines.push("response_preview:");
    lines.push(result.response_preview || "无内容");
    lines.push(`说明: ${result.message}`);
  } else {
    lines.push(`原因: ${result.reason}`);
    if (result.diagnostic_code) {
      lines.push(`diagnostic_code: ${result.diagnostic_code}`);
    }
  }

  return lines.join("\n");
}

function formatModelSmokeResult(result: ModelSmokeResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const lines = [
    "真实模型本地 smoke:",
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `package_root: ${result.package_root}`,
    `question: ${result.question}`,
    `model_status: ${result.model_status?.available ? "available" : "unavailable"}`
  ];

  if (result.model_list) {
    lines.push(`model_list: ${result.model_list.status}`);
    if (result.model_list.status !== "ok" && result.model_list.diagnostic_code) {
      lines.push(`model_list_diagnostic_code: ${result.model_list.diagnostic_code}`);
    }
  }

  if (result.model_ping) {
    lines.push(`model_ping: ${result.model_ping.status}`);
    if (result.model_ping.status !== "ok" && result.model_ping.diagnostic_code) {
      lines.push(`model_ping_diagnostic_code: ${result.model_ping.diagnostic_code}`);
    }
  }

  if (result.status === "ok") {
    lines.push(`ask: ${result.ask.status}`);
    lines.push(`source: ${result.ask.source}`);
    lines.push(`generation_status: ${result.ask.generation_status}`);
    lines.push(`review_status: ${result.ask.review_status}`);
    if (result.overlay) {
      lines.push("overlay:");
      lines.push(`- schema_version: ${result.overlay.schema_version}`);
      lines.push(`- output_dir: ${result.overlay.output_dir}`);
      lines.push(`- base_package_mutation: ${result.overlay.base_package_mutation}`);
      lines.push(`- validation_status: ${result.overlay.validation_status}`);
    }
    lines.push(`message: ${result.message}`);
  } else {
    lines.push(`reason: ${result.reason}`);
    if (result.diagnostic_code) {
      lines.push(`diagnostic_code: ${result.diagnostic_code}`);
    }
    if (result.ask) {
      lines.push(`ask: ${result.ask.status}`);
      if (result.ask.status !== "blocked") {
        lines.push(`ask_source: ${result.ask.source}`);
        lines.push(`ask_generation_status: ${result.ask.generation_status}`);
      }
    }
  }

  lines.push("warnings:");
  lines.push(
    ...(result.warnings.length === 0
      ? ["- 无"]
      : result.warnings.map((warning) => `- ${warning.source}: ${warning.status}${warning.diagnostic_code ? ` (${warning.diagnostic_code})` : ""}`))
  );

  return lines.join("\n");
}

function formatModelCommandStatus(status: ModelPingResult["status"] | ModelListCommandResult["status"]): string {
  if (status === "ok") {
    return "通过";
  }

  if (status === "blocked") {
    return "已阻断";
  }

  return "失败";
}

function formatConformanceListResult(result: ConformanceListResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    "Open Insight conformance 自测资产:",
    `schema_version: ${result.schema_version}`,
    "assets:",
    ...result.assets.flatMap((asset) => {
      const expectedIssueCodes = asset.expected_issue_codes?.length ? `; expected_issue_codes=${asset.expected_issue_codes.join(",")}` : "";
      return [
        `- ${asset.id} (${asset.expected_validation_status}${expectedIssueCodes}) ${asset.path}：${asset.purpose}`,
        `  Reader/Studio 重点：${asset.reader_studio_focus.join("；")}`,
        `  测试：${asset.tests.join("；")}`
      ];
    }),
    "commands:",
    ...result.commands.map((command) => `- ${command}`)
  ].join("\n");
}

function formatConformanceInspectResult(result: ConformanceInspectResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  const issueCodeEntries = Object.entries(result.issue_codes);
  const expectedIssueCodes = result.asset.expected_issue_codes ?? [];

  return [
    `conformance_asset: ${result.asset.id}`,
    `path: ${result.asset.path}`,
    `expected_validation_status: ${result.asset.expected_validation_status}`,
    `actual_validation_status: ${result.actual_validation_status}`,
    `matches_expected_status: ${result.matches_expected_status}`,
    `matches_expected_issue_codes: ${result.matches_expected_issue_codes}`,
    `matches_expected: ${result.matches_expected}`,
    "expected_issue_codes:",
    ...(expectedIssueCodes.length === 0 ? ["- 无"] : expectedIssueCodes.map((code) => `- ${code}`)),
    "missing_expected_issue_codes:",
    ...(result.missing_expected_issue_codes.length === 0 ? ["- 无"] : result.missing_expected_issue_codes.map((code) => `- ${code}`)),
    "reader_studio_focus:",
    ...formatTextList(result.asset.reader_studio_focus),
    "tests:",
    ...formatTextList(result.asset.tests),
    "recommended_behavior:",
    ...formatTextList(result.recommended_behavior),
    "issue_codes:",
    ...(issueCodeEntries.length === 0 ? ["- 无"] : issueCodeEntries.map(([code, count]) => `- ${code}: ${count}`)),
    "issues:",
    ...(result.issues.length === 0 ? ["- 无"] : result.issues.map(formatIssueLine))
  ].join("\n");
}

function formatConformanceCheckResult(result: ConformanceCheckResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    "Open Insight conformance 全量检查:",
    `status: ${result.status}`,
    `schema_version: ${result.schema_version}`,
    `total: ${result.total}`,
    `passed: ${result.passed}`,
    `failed: ${result.failed}`,
    `issue_code_assets: ${result.issue_code_assets}`,
    `issue_code_assets_passed: ${result.issue_code_assets_passed}`,
    `issue_code_assets_failed: ${result.issue_code_assets_failed}`,
    "assets:",
    ...result.assets.map((asset) => {
      const expectedIssueCodes = asset.asset.expected_issue_codes ?? [];

      return `- ${asset.asset.id}: expected=${asset.asset.expected_validation_status}; actual=${asset.actual_validation_status}; expected_issue_codes=${formatInlineList(expectedIssueCodes)}; missing_expected_issue_codes=${formatInlineList(asset.missing_expected_issue_codes)}; matches_status=${asset.matches_expected_status}; matches_issue_codes=${asset.matches_expected_issue_codes}; matches=${asset.matches_expected}`;
    })
  ].join("\n");
}

function formatConformanceError(message: string, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify({ status: "blocked", reason: message }, null, 2);
  }

  return ["status: blocked", `reason: ${message}`].join("\n");
}

function formatAskResult(result: AskCommandResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      `question: ${result.question}`,
      `requested_model_mode: ${result.requested_model_mode}`,
      `reason: ${result.reason}`,
      ...(result.diagnostic_code ? [`diagnostic_code: ${result.diagnostic_code}`] : []),
      ...(result.validation_status ? [`validation_status: ${result.validation_status}`] : [])
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `answerability_status: ${result.answerability_status}`,
    `answer_status: ${result.answer_status}`,
    `question: ${result.question}`,
    `requested_model_mode: ${result.requested_model_mode}`,
    `resolved_model_mode: ${result.resolved_model_mode}`,
    `model_enabled: ${result.model_enabled}`,
    ...(result.model_adapter ? [`model_adapter: ${result.model_adapter}`] : []),
    `source: ${result.source}`,
    ...(result.question_id ? [`question_id: ${result.question_id}`] : []),
    `generation_status: ${result.generation_status}`,
    `review_status: ${result.review_status}`,
    ...(result.structured_output ? [`structured_output: ${result.structured_output.parse_status}`] : []),
    ...(result.model_error ? [`model_error: ${result.model_error.message}`] : []),
    ...(result.diagnostic_code ? [`diagnostic_code: ${result.diagnostic_code}`] : []),
    `validation_status: ${result.validation_status}`,
    "answer:",
    result.answer,
    "claim_ids:",
    ...formatTextList(result.claim_ids),
    "evidence_ids:",
    ...formatTextList(result.evidence_ids),
    "evidence_sources:",
    ...formatEvidenceSourceTraceList(result.evidence_sources),
    "data_requests:",
    ...formatAskDataRequests(result.data_requests),
    ...(result.overlay
      ? [
          "overlay:",
          `- schema_version: ${result.overlay.schema_version}`,
          `- status: ${result.overlay.status}`,
          `- qa_id: ${result.overlay.qa_id}`,
          `- overlay_package_id: ${result.overlay.overlay_package_id}`,
          `- output_dir: ${result.overlay.output_dir}`,
          `- base_package_mutation: ${result.overlay.base_package_mutation}`,
          `- validation_status: ${result.overlay.validation_status}`
        ]
      : [])
  ].join("\n");
}

function formatCompileDraftResult(result: CompileDraftCommandResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      ...(result.output_dir ? [`output_dir: ${result.output_dir}`] : []),
      `reason: ${result.reason}`
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    "status: compiled",
    `output_dir: ${result.output_dir}`,
    `package_id: ${result.package_id}`,
    `title: ${result.title}`,
    ...(result.domain_pack ? [`domain_pack: ${result.domain_pack}`] : []),
    `source_mode: ${result.source_mode}`,
    `parser_backend: ${result.parser_backend}`,
    `ocr_mode: ${result.ocr_mode}`,
    "resource_limits:",
    `- max_source_bytes: ${result.resource_limits.max_source_bytes}`,
    `- max_total_source_bytes: ${result.resource_limits.max_total_source_bytes}`,
    `- max_normalized_bytes: ${result.resource_limits.max_normalized_bytes}`,
    `- max_total_normalized_bytes: ${result.resource_limits.max_total_normalized_bytes}`,
    `- source_hash_strategy: ${result.resource_limits.source_hash_strategy}`,
    `- package_write_strategy: ${result.resource_limits.package_write_strategy}`,
    ...(result.source_analysis_cache
      ? [
          "source_analysis_cache:",
          `- enabled: ${result.source_analysis_cache.enabled}`,
          `- hits: ${result.source_analysis_cache.hits}`,
          `- misses: ${result.source_analysis_cache.misses}`,
          `- writes: ${result.source_analysis_cache.writes}`,
          `- read_errors: ${result.source_analysis_cache.read_errors}`
        ]
      : []),
    `file_count: ${result.file_count}`,
    `validation_status: ${result.validation_status}`,
    "source_files:",
    ...formatTextList(
      result.source_files.map(
        (source) =>
          `${source.package_path}: ${source.type}, ${source.size_bytes} bytes, bundled=${source.bundled}, evidence_boundary=${source.evidence_boundary}${
            source.parser ? `, parser=${source.parser}` : ""
          }`
      )
    ),
    "plan_summary:",
    `- template_sections: ${result.plan_summary.template_sections}`,
    `- questions: ${result.plan_summary.questions}`,
    `- metric_suggestions: ${result.plan_summary.metric_suggestions}`,
    `- view_suggestions: ${result.plan_summary.view_suggestions}`,
    `- domain_view_suggestions: ${result.plan_summary.domain_view_suggestions}`,
    `- data_gaps: ${result.plan_summary.data_gaps}`,
    "warnings:",
    ...formatTextList(result.warnings)
  ].join("\n");
}

function formatCompilePackResult(result: CompilePackCommandResult, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      ...(result.output_file ? [`output_file: ${result.output_file}`] : []),
      `reason: ${result.reason}`,
      "safety:",
      `- model_invoked: ${result.safety.model_invoked}`,
      `- package_code_execution: ${result.safety.package_code_execution}`,
      `- browser_key_access: ${result.safety.browser_key_access}`,
      `- base_package_mutation: ${result.safety.base_package_mutation}`
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    "status: compiled",
    `output_file: ${result.output_file}`,
    `package_id: ${result.package_id}`,
    `title: ${result.title}`,
    ...(result.domain_pack ? [`domain_pack: ${result.domain_pack}`] : []),
    `source_mode: ${result.source_mode}`,
    `parser_backend: ${result.parser_backend}`,
    `ocr_mode: ${result.ocr_mode}`,
    "resource_limits:",
    `- max_source_bytes: ${result.resource_limits.max_source_bytes}`,
    `- max_total_source_bytes: ${result.resource_limits.max_total_source_bytes}`,
    `- max_normalized_bytes: ${result.resource_limits.max_normalized_bytes}`,
    `- max_total_normalized_bytes: ${result.resource_limits.max_total_normalized_bytes}`,
    `- source_hash_strategy: ${result.resource_limits.source_hash_strategy}`,
    `- package_write_strategy: ${result.resource_limits.package_write_strategy}`,
    ...(result.source_analysis_cache
      ? [
          "source_analysis_cache:",
          `- enabled: ${result.source_analysis_cache.enabled}`,
          `- hits: ${result.source_analysis_cache.hits}`,
          `- misses: ${result.source_analysis_cache.misses}`,
          `- writes: ${result.source_analysis_cache.writes}`,
          `- read_errors: ${result.source_analysis_cache.read_errors}`
        ]
      : []),
    `single_file_package: ${result.single_file_package}`,
    `no_zip_output: ${result.no_zip_output}`,
    `file_count: ${result.file_count}`,
    `packed_file_count: ${result.packed_file_count}`,
    `validation_status: ${result.validation_status}`,
    "query_index:",
    `- available: ${result.query_index.available}`,
    `- database_available: ${result.query_index.available ? result.query_index.database_available : false}`,
    `- access_strategy: ${result.query_index.available ? result.query_index.access_strategy : "none"}`,
    "source_files:",
    ...formatTextList(
      result.source_files.map(
        (source) =>
          `${source.package_path}: ${source.type}, ${source.size_bytes} bytes, bundled=${source.bundled}, evidence_boundary=${source.evidence_boundary}${
            source.parser ? `, parser=${source.parser}` : ""
          }`
      )
    ),
    "plan_summary:",
    `- template_sections: ${result.plan_summary.template_sections}`,
    `- questions: ${result.plan_summary.questions}`,
    `- metric_suggestions: ${result.plan_summary.metric_suggestions}`,
    `- view_suggestions: ${result.plan_summary.view_suggestions}`,
    `- domain_view_suggestions: ${result.plan_summary.domain_view_suggestions}`,
    `- data_gaps: ${result.plan_summary.data_gaps}`,
    "warnings:",
    ...formatTextList(result.warnings),
    "safety:",
    `- model_invoked: ${result.safety.model_invoked}`,
    `- package_code_execution: ${result.safety.package_code_execution}`,
    `- browser_key_access: ${result.safety.browser_key_access}`,
    `- base_package_mutation: ${result.safety.base_package_mutation}`
  ].join("\n");
}

function formatInspectResult(summary: InspectPackageSummary, requestedFormat: string): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(summary, null, 2);
  }

  const lines = [
    `schema_version: ${summary.schema_version}`,
    `package: ${summary.title}`,
    `package_id: ${summary.package_id}`,
    `spec_version: ${summary.spec_version}`,
    `package_type: ${summary.package_type}`,
    `required_capabilities: ${formatInlineList(summary.required_capabilities)}`,
    `optional_capabilities: ${formatInlineList(summary.optional_capabilities)}`,
    "counts:"
  ];

  Object.entries(summary.counts).forEach(([name, value]) => {
    lines.push(`- ${name}: ${value}`);
  });

  lines.push("files:");
  Object.entries(summary.files).forEach(([name, value]) => {
    lines.push(`- ${name}: ${value}`);
  });

  lines.push("validation:");
  lines.push(`- status: ${summary.validation.status}`);
  lines.push(`- errors: ${summary.validation.errors}`);
  lines.push(`- warnings: ${summary.validation.warnings}`);

  lines.push("validation_issue_codes:");
  const issueCodeEntries = Object.entries(summary.validation.issue_codes);
  if (issueCodeEntries.length === 0) {
    lines.push("- 无");
  } else {
    issueCodeEntries.forEach(([name, value]) => {
      lines.push(`- ${name}: ${value}`);
    });
  }

  lines.push("fallbacks:");

  const fallbackEntries = Object.entries(summary.fallbacks);
  if (fallbackEntries.length === 0) {
    lines.push("- 无");
  } else {
    fallbackEntries.forEach(([name, value]) => {
      lines.push(`- ${name}: ${value}`);
    });
  }

  return lines.join("\n");
}

function formatExportRequestResult(
  result: ExportRequestCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `request_id: ${result.request_id}`,
    `parent_package_id: ${result.parent_package_id}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    "copied_context:",
    `- claims: ${result.copied_context.claims}`,
    `- evidence: ${result.copied_context.evidence}`,
    `- prepared_questions: ${result.copied_context.prepared_questions}`,
    `- datasets: ${result.copied_context.datasets}`,
    `- metrics: ${result.copied_context.metrics}`,
    `- lineage_sources: ${result.copied_context.lineage_sources}`,
    `validation_status: ${result.validation_status}`
  ].join("\n");
}

function formatCreateResponseResult(
  result: CreateResponseCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `request_id: ${result.request_id}`,
    `response_id: ${result.response_id}`,
    `parent_package_id: ${result.parent_package_id}`,
    `request_package_id: ${result.request_package_id}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    "copied_context:",
    `- claims: ${result.copied_context.claims}`,
    `- evidence: ${result.copied_context.evidence}`,
    `- prepared_questions: ${result.copied_context.prepared_questions}`,
    `- datasets: ${result.copied_context.datasets}`,
    `- metrics: ${result.copied_context.metrics}`,
    `- lineage_sources: ${result.copied_context.lineage_sources}`,
    "response_additions:",
    `- claims: ${result.response_additions.claims}`,
    `- evidence: ${result.response_additions.evidence}`,
    `- prepared_questions: ${result.response_additions.prepared_questions}`,
    `- datasets: ${result.response_additions.datasets}`,
    `- lineage_sources: ${result.response_additions.lineage_sources}`,
    "supplement_files:",
    ...formatTextList(
      (result.supplement_files ?? []).map((file) => {
        const warningText = file.quality_warnings && file.quality_warnings.length > 0 ? `；质量告警 ${file.quality_warnings.length} 条` : "";

        return `${file.path}: ${file.format}, ${file.column_count} 列${warningText}`;
      })
    ),
    `validation_status: ${result.validation_status}`
  ].join("\n");
}

function formatResponseMergeSummaryResult(
  result: ResponseMergeSummaryCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `parent_package_id: ${result.parent_package_id}`,
    `response_package_id: ${result.response_package_id}`,
    `response_id: ${result.response_id}`,
    `response_state: ${result.response_state}`,
    `source_request_id: ${result.source_request_id}`,
    `parent_request_found: ${result.parent_request_found}`,
    "validation:",
    `- parent: ${result.validation.parent_status}`,
    `- response: ${result.validation.response_status}`,
    "compatibility_issues:",
    ...formatCompatibilityIssues(result.compatibility_issues),
    "affected_findings:",
    ...formatAffectedFindings(result.affected_findings),
    ...formatAnswerabilityChanges(result.answerability_changes),
    ...formatSupplementQualityWarnings(result.supplement_quality_warnings),
    ...formatResponseReviewTasks(result.review_tasks),
    "merge_plan:",
    `- mode: ${result.merge_plan.mode}`,
    `- parent_mutation: ${result.merge_plan.parent_mutation}`,
    "additions:",
    `- datasets: ${formatInlineList(result.merge_plan.additions.datasets)}`,
    `- metrics: ${formatInlineList(result.merge_plan.additions.metrics)}`,
    `- claims: ${formatInlineList(result.merge_plan.additions.claims)}`,
    `- evidence: ${formatInlineList(result.merge_plan.additions.evidence)}`,
    `- prepared_questions: ${formatInlineList(result.merge_plan.additions.prepared_questions)}`,
    `- lineage_sources: ${formatInlineList(result.merge_plan.additions.lineage_sources)}`,
    "duplicates:",
    `- datasets: ${formatInlineList(result.merge_plan.duplicates.datasets)}`,
    `- metrics: ${formatInlineList(result.merge_plan.duplicates.metrics)}`,
    `- claims: ${formatInlineList(result.merge_plan.duplicates.claims)}`,
    `- evidence: ${formatInlineList(result.merge_plan.duplicates.evidence)}`,
    `- prepared_questions: ${formatInlineList(result.merge_plan.duplicates.prepared_questions)}`,
    `- lineage_sources: ${formatInlineList(result.merge_plan.duplicates.lineage_sources)}`
  ].join("\n");
}

function formatSupplementQualityWarnings(warnings: DataResponseMergeSummary["supplement_quality_warnings"]): string[] {
  if (warnings.length === 0) {
    return ["supplement_quality_warnings:", "- 无"];
  }

  return [
    "supplement_quality_warnings:",
    ...warnings.map((item) => {
      const codes = item.quality_warnings.map((warning) => warning.code).join(", ");
      const pathText = item.path ? `；${item.path}` : "";

      return `- ${item.dataset_id}${pathText}；${item.quality_warnings.length} 条：${codes}`;
    })
  ];
}

function formatResponseReviewTasks(tasks: DataResponseMergeSummary["review_tasks"]): string[] {
  if (tasks.length === 0) {
    return ["review_tasks:", "- 无"];
  }

  return [
    "review_tasks:",
    ...tasks.map((task) => {
      const relatedText = task.related_ids.length > 0 ? `；关联 ${task.related_ids.length} 个对象` : "";

      return `- ${formatResponseReviewTaskKind(task.kind)} / ${formatResponseReviewTaskPriority(task.priority)} / ${task.target_type}:${task.target_id}${relatedText}`;
    })
  ];
}

function formatResponseReviewTaskKind(kind: DataResponseMergeSummary["review_tasks"][number]["kind"]): string {
  const labels: Record<DataResponseMergeSummary["review_tasks"][number]["kind"], string> = {
    affected_finding_review: "受影响结论",
    response_claim_review: "新增结论",
    response_evidence_review: "新增证据",
    supplement_quality_review: "材料质量"
  };

  return labels[kind];
}

function formatResponseReviewTaskPriority(priority: DataResponseMergeSummary["review_tasks"][number]["priority"]): string {
  const labels: Record<DataResponseMergeSummary["review_tasks"][number]["priority"], string> = {
    high: "高优先级",
    medium: "中优先级",
    low: "低优先级"
  };

  return labels[priority];
}

function formatMergeResponseResult(
  result: MergeResponseCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      `output_dir: ${result.output_dir}`,
      `parent_package_id: ${result.summary.parent_package_id}`,
      `response_package_id: ${result.summary.response_package_id}`,
      `response_id: ${result.summary.response_id}`,
      "validation:",
      `- parent: ${result.summary.validation.parent_status}`,
      `- response: ${result.summary.validation.response_status}`,
      "compatibility_issues:",
      ...formatCompatibilityIssues(result.summary.compatibility_issues)
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `merged_package_id: ${result.merged_package_id}`,
    `parent_package_id: ${result.parent_package_id}`,
    `response_package_id: ${result.response_package_id}`,
    `response_id: ${result.response_id}`,
    `source_request_id: ${result.source_request_id}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    `validation_status: ${result.validation_status}`,
    "merge_plan:",
    `- mode: ${result.merge_plan.mode}`,
    `- parent_mutation: ${result.merge_plan.parent_mutation}`,
    "additions:",
    `- datasets: ${formatInlineList(result.merge_plan.additions.datasets)}`,
    `- metrics: ${formatInlineList(result.merge_plan.additions.metrics)}`,
    `- claims: ${formatInlineList(result.merge_plan.additions.claims)}`,
    `- evidence: ${formatInlineList(result.merge_plan.additions.evidence)}`,
    `- prepared_questions: ${formatInlineList(result.merge_plan.additions.prepared_questions)}`,
    `- lineage_sources: ${formatInlineList(result.merge_plan.additions.lineage_sources)}`,
    ...formatAnswerabilityChanges(result.answerability_changes),
    "versioning:",
    `- parents: ${result.versioning.parents_path}`,
    `- merge_log: ${result.versioning.merge_log_path}`,
    `- diff_summary: ${result.versioning.diff_summary_path}`,
    `- review_patches: ${result.versioning.review_patches_path}`
  ].join("\n");
}

function formatReviewPatchResult(
  result: ReviewPatchCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      `patch_id: ${result.patch_id}`,
      `decision: ${result.decision}`,
      `output_dir: ${result.output_dir}`,
      `reason: ${result.reason}`,
      ...(result.validation_status ? [`validation_status: ${result.validation_status}`] : [])
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `decision: ${result.decision}`,
    `patch_id: ${result.patch_id}`,
    `review_state: ${result.review_state}`,
    `target_claim_id: ${result.target_claim_id}`,
    `target_claim_status: ${result.target_claim_status}`,
    `source_package_id: ${result.source_package_id}`,
    `reviewed_package_id: ${result.reviewed_package_id}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    `claim_status_changed: ${result.claim_status_changed}`,
    `validation_status: ${result.validation_status}`
  ].join("\n");
}

function formatApplyReviewPatchResult(
  result: ApplyReviewPatchCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      `patch_id: ${result.patch_id}`,
      `output_dir: ${result.output_dir}`,
      `reason: ${result.reason}`,
      ...(result.validation_status ? [`validation_status: ${result.validation_status}`] : [])
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `patch_id: ${result.patch_id}`,
    `review_state: ${result.review_state}`,
    `target_claim_id: ${result.target_claim_id}`,
    `previous_status: ${result.previous_status}`,
    `next_status: ${result.next_status}`,
    `source_package_id: ${result.source_package_id}`,
    `applied_package_id: ${result.applied_package_id}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    `claim_status_changed: ${result.claim_status_changed}`,
    `validation_status: ${result.validation_status}`
  ].join("\n");
}

function formatAddOverlayNoteResult(
  result: AddOverlayNoteCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      `output_dir: ${result.output_dir}`,
      `reason: ${result.reason}`,
      ...(result.validation_status ? [`validation_status: ${result.validation_status}`] : [])
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `source_package_id: ${result.source_package_id}`,
    `overlay_package_id: ${result.overlay_package_id}`,
    `overlay_id: ${result.overlay_id}`,
    `note_id: ${result.note_id}`,
    `target_type: ${result.target_type}`,
    `target_id: ${result.target_id}`,
    `base_package_mutation: ${result.base_package_mutation}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    `validation_status: ${result.validation_status}`
  ].join("\n");
}

function formatImportOverlayFollowupResult(
  result: ImportOverlayFollowupCommandResult,
  requestedFormat: string
): string {
  if (requestedFormat !== "text") {
    return JSON.stringify(result, null, 2);
  }

  if (result.status === "blocked") {
    return [
      `schema_version: ${result.schema_version}`,
      "status: blocked",
      `output_dir: ${result.output_dir}`,
      `reason: ${result.reason}`,
      ...(result.validation_status ? [`validation_status: ${result.validation_status}`] : [])
    ].join("\n");
  }

  return [
    `schema_version: ${result.schema_version}`,
    `status: ${result.status}`,
    `source_package_id: ${result.source_package_id}`,
    `imported_package_id: ${result.imported_package_id}`,
    `followup_schema_version: ${result.followup_schema_version}`,
    `followup_metadata_package_id: ${result.followup_metadata_package_id}`,
    `followup_source_name: ${result.followup_source_name}`,
    `prepared_questions_added: ${result.prepared_questions_added}`,
    `data_requests_added: ${result.data_requests_added}`,
    `base_package_mutation: ${result.base_package_mutation}`,
    `output_dir: ${result.output_dir}`,
    `file_count: ${result.file_count}`,
    `validation_status: ${result.validation_status}`,
    "prepared_question_mappings:",
    ...formatTextList(
      result.mappings.prepared_questions.map(
        (mapping) => `${mapping.source_question_id} -> ${mapping.question_id}; qa=${mapping.qa_id}`
      )
    ),
    "data_request_mappings:",
    ...formatTextList(
      result.mappings.data_requests.map((mapping) => `${mapping.source_request_id} -> ${mapping.request_id}; qa=${mapping.qa_id}`)
    )
  ].join("\n");
}

function summarizeIssueCodes(issues: ValidationIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};

  issues.forEach((issue) => {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
  });

  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function formatValidationText(result: ValidationResult): string {
  if (result.issues.length === 0) {
    return `status: ${result.status}\nissues: 无`;
  }

  const errors = result.issues.filter((issue) => issue.severity === "error").length;
  const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
  const lines = [`status: ${result.status}`, `errors: ${errors}`, `warnings: ${warnings}`, "issue_codes:"];

  Object.entries(summarizeIssueCodes(result.issues)).forEach(([code, count]) => {
    lines.push(`- ${code}: ${count}`);
  });

  lines.push("issues:");

  result.issues.forEach((issue) => {
    lines.push(formatIssueLine(issue));
  });

  return lines.join("\n");
}

function formatInlineList(values: string[]): string {
  return values.length === 0 ? "无" : values.join(", ");
}

function formatTextList(values: string[]): string[] {
  return values.length === 0 ? ["- 无"] : values.map((value) => `- ${value}`);
}

function formatCompatibilityIssues(values: ResponseCompatibilityIssue[]): string[] {
  return values.length === 0 ? ["- 无"] : values.map((value) => `- ${formatCompatibilityIssue(value)}`);
}

function formatCompatibilityIssue(value: ResponseCompatibilityIssue): string {
  if (typeof value === "string") {
    return value;
  }

  return `${value.severity} / ${value.code} / ${value.path}: ${value.message}`;
}

function formatEvidenceSourceTraceList(values: AnswerEvidenceSourceTrace[]): string[] {
  if (values.length === 0) {
    return ["- 无"];
  }

  return values.map((trace) => {
    const datasetId = trace.dataset?.dataset_id ?? trace.source_ref.dataset_id;
    const sourcePath = trace.resolved_path ?? trace.dataset?.path ?? trace.source_ref.path ?? "未知路径";
    const lineageSource = trace.lineage_source?.source_id ? `; lineage=${trace.lineage_source.source_id}` : "";

    return `- ${trace.evidence_id}: dataset=${datasetId}; path=${sourcePath}${lineageSource}`;
  });
}

function formatAskDataRequests(values: DataRequestRecord[]): string[] {
  if (values.length === 0) {
    return ["- 无"];
  }

  return values.map((request) => {
    const parts = [
      `${request.request_id}: ${request.status}`,
      request.priority ? `优先级=${request.priority}` : undefined,
      request.missing_fields.length > 0 ? `缺失字段=${request.missing_fields.join(", ")}` : undefined,
      request.required_grain ? `粒度=${request.required_grain}` : undefined,
      request.required_time_range ? `时间范围=${request.required_time_range}` : undefined
    ].filter((part): part is string => part !== undefined);

    return `- ${parts.join("; ")}`;
  });
}

function formatAffectedFindings(findings: DataResponseMergeSummary["affected_findings"]): string[] {
  if (findings.length === 0) {
    return ["- 无"];
  }

  return findings.map((finding) => {
    const status = finding.status ? ` status=${finding.status}` : "";
    return `- ${finding.claim_id} found=${finding.found}${status}`;
  });
}

function formatAnswerabilityChanges(changes: DataResponseMergeSummary["answerability_changes"]): string[] {
  const lines = [
    "answerability_changes:",
    `- policy: ${changes.policy.mode}`,
    `- parent_mutation: ${changes.policy.parent_mutation}`,
    `- requires_review_for_status_change: ${changes.policy.requires_review_for_status_change}`,
    "request_updates:"
  ];

  if (changes.request_updates.length === 0) {
    lines.push("- 无");
  } else {
    changes.request_updates.forEach((update) => {
      lines.push(
        `- ${update.request_id}: ${update.previous_status} -> ${update.next_status}; answerability=${update.previous_answerability_status} -> ${update.next_answerability_status}; status_change=${update.status_change}; response=${update.source_response_id}`
      );
    });
  }

  lines.push("finding_updates:");

  if (changes.finding_updates.length === 0) {
    lines.push("- 无");
  } else {
    changes.finding_updates.forEach((update) => {
      lines.push(
        `- ${update.claim_id}: ${update.previous_status} -> ${update.next_status}; answerability=${update.previous_answerability_status} -> ${update.next_answerability_status}; status_change=${update.status_change}`
      );
    });
  }

  return lines;
}

function formatIssueLine(issue: ValidationIssue): string {
  return `- [${issue.severity}] ${issue.code} ${issue.path}: ${issue.message}`;
}

function normalizePackagePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isSourceAssetPath(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();

  if (normalizedPath.startsWith("sources/")) {
    return true;
  }

  return normalizedPath.startsWith("data/") && normalizedPath !== "data/catalog.json";
}

const EXECUTABLE_EXTENSIONS = new Set([
  "bat",
  "cmd",
  "cjs",
  "dll",
  "exe",
  "htm",
  "html",
  "js",
  "jsx",
  "mjs",
  "ps1",
  "py",
  "sh",
  "ts",
  "tsx",
  "wasm"
]);

function isExecutableLookingPath(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();

  return extension !== undefined && EXECUTABLE_EXTENSIONS.has(extension);
}

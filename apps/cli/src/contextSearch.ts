import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  buildContextUserMaterialContract,
  resolveContextSource,
  searchContextChunks,
  summarizeContextPackage,
  type ContextChunkMatch,
  type ContextChunkSearchResult,
  type ContextNormalizedSourceFragment,
  type ContextSourceResolveResult,
  type ContextUserMaterialContractResult,
  type SearchContextChunksOptions
} from "@open-insight/runtime";

type SqlJsStatement = {
  bind(values?: Array<number | string | Uint8Array | null>): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
};

type SqlJsDatabase = {
  prepare(sql: string): SqlJsStatement;
  close(): void;
};

type SqlJsStatic = {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
};

type InitSqlJs = () => Promise<SqlJsStatic>;

const DIRECT_FULL_TEXT_BASIS = "normalized_source_surrogate" as const;
const EXTERNAL_BASELINE_BASIS = "external_baseline_files" as const;
const TOKEN_BASELINE_DISCLOSURE_CN =
  "direct_full_text 当前使用 .insight normalized source 作为可稳定估算的全文替身（normalized source surrogate）；不是模型直接读取原始 Word/PDF 的计费结果，也不等于模型账单。";
const EXTERNAL_BASELINE_DISCLOSURE_CN =
  "direct_full_text 使用 --direct-baseline 指定的外部文件或目录估算；文本文件按可解码文本估算，PDF/Office/图片等二进制文件按文件大小做稳定近似，不等于任何模型的真实计费结果。";
type DirectFullTextBasis = typeof DIRECT_FULL_TEXT_BASIS | typeof EXTERNAL_BASELINE_BASIS;
export type ExternalBaselineQuality = "decoded_text" | "mixed" | "binary_size_heuristic_only" | "large_text_size_heuristic_only" | "empty";
type ContextCompactRetrievalStatus = ContextChunkSearchResult["status"] | "degraded";
type ContextRetrievalSource = "query_index_sqlite" | "query_index_context_window" | "query_index_substring" | "query_index_source_overview";
type ContextRetrievalStrategy =
  | "query_index_exact"
  | "query_index_context_window"
  | "query_index_substring_window"
  | "source_overview_fallback"
  | "normalized_source_fallback";

export interface ExternalBaselineEstimationMethods {
  decoded_text_file_count: number;
  binary_size_heuristic_file_count: number;
  large_text_size_heuristic_file_count: number;
}

export interface ExternalBaselineSourceFilter {
  include_extensions: string[] | null;
  exclude_extensions: string[];
  exclude_path_contains: string[];
}

type IndexedContextChunkMatch = ContextChunkMatch & {
  retrieval_source: ContextRetrievalSource;
  index_path: string;
  source_id?: string;
  normalized_source_path?: string;
  rowid?: number;
  fallback_reason?: string;
};

function getDocumentIds(options: Pick<SearchContextChunksOptions, "documentId" | "documentIds">): string[] {
  return uniqueStrings([...(options.documentIds ?? []), ...(options.documentId ? [options.documentId] : [])].map((id) => id.trim()));
}

function hasDocumentScope(options: Pick<SearchContextChunksOptions, "documentId" | "documentIds">): boolean {
  return getDocumentIds(options).length > 0;
}

function matchesDocumentScope(
  sourceId: string | undefined,
  sourceRefs: string[] | undefined,
  options: Pick<SearchContextChunksOptions, "documentId" | "documentIds">
): boolean {
  const documentIds = getDocumentIds(options);
  return documentIds.length === 0 || documentIds.some((documentId) => sourceId === documentId || sourceRefs?.includes(documentId));
}

function sqliteDocumentScopeFilter(column: string, options: Pick<SearchContextChunksOptions, "documentId" | "documentIds">): string {
  const documentIds = getDocumentIds(options);
  return documentIds.length > 0 ? `AND ${column} IN (${documentIds.map(() => "?").join(", ")})` : "";
}

function scopeContextChunkSearchResult(result: ContextChunkSearchResult, options: SearchContextChunksOptions): ContextChunkSearchResult {
  if (!hasDocumentScope(options)) {
    return result;
  }

  const documentIds = getDocumentIds(options);
  const matches = result.matches.filter((match) => matchesDocumentScope((match as IndexedContextChunkMatch).source_id, match.source_refs, options));
  const sourceRefs = new Set(matches.flatMap((match) => match.source_refs).filter((sourceRef) => documentIds.includes(sourceRef)));
  const lineageRefs = new Set(matches.flatMap((match) => match.lineage_refs));
  const parseDiagnosticIds = new Set(matches.flatMap((match) => match.parse_diagnostic_ids));

  return {
    ...result,
    matches,
    source_refs: [...sourceRefs],
    lineage_refs: [...lineageRefs],
    parse_diagnostic_ids: result.parse_diagnostic_ids.filter((diagnosticId) => parseDiagnosticIds.has(diagnosticId))
  };
}

interface SqliteChunkCapabilities {
  supportsContentRole: boolean;
  supportsChunkLevel: boolean;
  supportsEstimatedTokens: boolean;
  supportsReadOrder: boolean;
  supportsPrevNext: boolean;
  supportsParent: boolean;
  excludeDocumentChunks?: boolean;
  onlyTableChunks?: boolean;
}

export interface ContextCompactFact {
  text: string;
  chunk_id: string;
  title: string;
  content_role?: string;
  chunk_level?: string;
  page_furniture_kind?: string;
  heading_path: string[];
  estimated_tokens: number;
  page_number?: number;
  line_numbers?: number[];
  read_order?: number;
  prev_chunk_id?: string;
  next_chunk_id?: string;
  parent_chunk_id?: string;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextCompactNumber {
  value: string;
  snippet: string;
  chunk_id: string;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextCompactTable {
  chunk_id: string;
  title: string;
  text: string;
  estimated_tokens: number;
  page_number?: number;
  line_numbers?: number[];
  read_order?: number;
  prev_chunk_id?: string;
  next_chunk_id?: string;
  parent_chunk_id?: string;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextCompactPageCue {
  chunk_id: string;
  title: string;
  location_label: string;
  page_number?: number;
  line_numbers?: number[];
  read_order?: number;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextCompactFragmentRead {
  chunk_id: string;
  title: string;
  reason_cn: string;
  cli_command: string;
  mcp_tool: "open_insight_resolve_source";
  mcp_arguments: { target_id: string };
  expected_fragment_field: "normalized_source_fragment";
  source_mode_disclosure_required: true;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextCompactCoverageHints {
  query_scope: "query_scoped_compact_retrieval";
  covered_heading_paths: string[][];
  covered_source_refs: string[];
  partial_source_coverage?: boolean;
  source_coverage_rate?: number;
  source_coverage_reason_cn?: string;
  total_candidate_matches: number;
  included_chunk_count: number;
  truncated_by_token_budget: boolean;
  omitted_candidate_count: number;
  omitted_estimated_tokens: number;
  recommended_next_action: "use_compact_context" | "increase_token_budget" | "read_normalized_source_fragment";
  disclosure_cn: string;
  fallback_used?: boolean;
  fallback_reason_cn?: string;
}

export interface ContextCompactRetrievalResult {
  status: ContextCompactRetrievalStatus;
  profile: ContextChunkSearchResult["profile"];
  package_id: string;
  title: string;
  spec_version: string;
  source_mode: ContextChunkSearchResult["source_mode"];
  query: string;
  token_budget: number;
  estimated_tokens: number;
  compacted_from_match_count: number;
  included_chunk_count: number;
  facts: ContextCompactFact[];
  key_numbers: ContextCompactNumber[];
  tables: ContextCompactTable[];
  page_cues: ContextCompactPageCue[];
  next_fragment_reads: ContextCompactFragmentRead[];
  coverage_hints: ContextCompactCoverageHints;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  retrieval_strategy: ContextRetrievalStrategy;
  fallback_used: boolean;
  fallback_reason?: string;
  source_coverage: {
    included_source_count: number;
    total_source_count: number;
    included_source_refs: string[];
  };
}

export interface ContextTokenEvalResult {
  status: "completed" | "degraded";
  profile: ContextChunkSearchResult["profile"];
  package_id: string;
  title: string;
  spec_version: string;
  source_mode: ContextChunkSearchResult["source_mode"];
  query: string;
  token_budget: number;
  estimated: true;
  token_count_is_estimated: true;
  direct_full_text_basis: DirectFullTextBasis;
  baseline_disclosure_cn: string;
  direct_full_text: {
    estimated_tokens: number;
    basis: DirectFullTextBasis;
    noise_metrics: ContextTokenPathNoiseMetrics;
    file_count?: number;
    total_bytes?: number;
    text_file_count?: number;
    binary_file_count?: number;
    skipped_file_count?: number;
    filtered_file_count?: number;
    included_extensions?: string[];
    source_filter?: ExternalBaselineSourceFilter;
    baseline_input_kind?: "file" | "directory";
    baseline_quality?: ExternalBaselineQuality;
    recommended_baseline_action_cn?: string;
    estimation_methods?: ExternalBaselineEstimationMethods;
    estimator_version?: string;
    estimation_mode?: string;
    input_fingerprint?: string;
    diagnostics?: string[];
  };
  insight_full_normalized: { estimated_tokens: number; normalized_source_count: number; noise_metrics: ContextTokenPathNoiseMetrics };
  insight_compact_retrieval: {
    estimated_tokens: number;
    token_budget: number;
    included_chunk_count: number;
    table_count: number;
    table_candidate_count: number;
    noise_metrics: ContextTokenPathNoiseMetrics;
  };
  savings_vs_direct: number;
  savings_rate: number;
  noise_reduction_rate: number;
  noise_metrics: ContextNoiseMetrics;
  source_ref_coverage_rate: number;
  parse_diagnostic_coverage_rate: number;
  numeric_preservation_rate: number;
  table_context_coverage_rate: number;
  table_context_coverage: {
    applicability: "required" | "advisory" | "not_applicable";
    candidate_count: number;
    required_candidate_count: number;
    covered_required_candidate_count: number;
    required_candidate_coverage_rate: number;
  };
  recommended_mode: "compact_retrieval" | "full_normalized";
  diagnostics: string[];
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  retrieval_quality?: {
    non_empty_context: boolean;
    traceable_context: boolean;
    fallback_used: boolean;
    partial_source_coverage: boolean;
    source_coverage_rate: number;
    included_source_count: number;
    total_source_count: number;
    effective_savings_vs_direct: number;
  };
}

export interface ExternalBaselineSummary {
  estimated_tokens: number;
  file_count: number;
  total_bytes: number;
  text_file_count: number;
  binary_file_count: number;
  skipped_file_count: number;
  filtered_file_count: number;
  included_extensions: string[];
  source_filter: ExternalBaselineSourceFilter;
  baseline_input_kind: "file" | "directory";
  baseline_quality: ExternalBaselineQuality;
  recommended_baseline_action_cn: string;
  estimation_methods: ExternalBaselineEstimationMethods;
  estimator_version: string;
  estimation_mode: string;
  input_fingerprint?: string;
  diagnostics: string[];
}

export interface ContextTokenBenchmarkSummary {
  schema_version: "open-insight.token-benchmark-summary.v0.1";
  status: "pass" | "degraded";
  measurement_mode: "deterministic_estimate";
  noise_measurement_mode: ContextNoiseMetrics["measurement_mode"];
  token_count_is_estimated: true;
  direct_full_text_basis: DirectFullTextBasis;
  baseline_disclosure_cn: string;
  baseline_quality?: ExternalBaselineQuality;
  recommended_baseline_action_cn?: string;
  estimation_methods?: ExternalBaselineEstimationMethods;
  direct_full_text_estimated_tokens: number;
  insight_full_normalized_estimated_tokens: number;
  insight_compact_estimated_tokens: number;
  savings_vs_direct: number;
  savings_vs_normalized: number;
  noise_reduction_rate: number;
  source_ref_coverage_rate: number;
  parse_diagnostic_coverage_rate: number;
  numeric_preservation_rate: number;
  table_context_coverage_rate: number;
  recommended_mode: ContextTokenEvalResult["recommended_mode"];
  user_facing_summary_cn: string;
  external_llm_instruction_cn: string;
}

export interface ContextSourceModeDisclosure {
  source_mode: string;
  raw_sources_bundled: boolean;
  contains_raw_binary: boolean;
  contains_normalized_source: boolean;
  contains_query_index: boolean;
  contains_source_refs: boolean;
  contains_source_map: boolean;
  contains_parse_diagnostics: boolean;
  disclosure_required: boolean;
  answer_disclosure_cn: string;
  llm_instruction_cn: string;
}

export interface ContextSourceInventorySummaryCategory {
  category: string;
  label_cn: string;
  count: number;
  normalized_source_estimated_tokens: number;
  estimated_tokens_conservative: number;
  token_share: number;
  source_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextSourceInventorySummaryFile {
  source_id: string;
  title: string;
  category: string;
  label_cn: string;
  normalized_source_path?: string;
  normalized_source_estimated_tokens: number;
  estimated_tokens_conservative: number;
  source_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextSourceInventorySummary {
  schema_version: "open-insight.source-inventory-summary.v0.1";
  status: "ok" | "unavailable";
  source_count: number;
  normalized_source_count: number;
  normalized_source_estimated_tokens: number;
  normalized_source_conservative_estimated_tokens: number;
  categories: ContextSourceInventorySummaryCategory[];
  files: ContextSourceInventorySummaryFile[];
  disclosure_cn: string;
}

export interface ContextTokenMetricPolicy {
  token_count_is_estimated: true;
  preferred_inventory_metric: "source_inventory_summary.normalized_source_conservative_estimated_tokens";
  query_index_estimated_tokens_are_not_package_totals: true;
  compact_context_tokens_are_query_scoped: true;
  full_normalized_tokens_are_package_reading_estimate: true;
  direct_full_text_basis: DirectFullTextBasis;
  direct_full_text_estimated_tokens: number;
  insight_full_normalized_estimated_tokens: number;
  insight_compact_estimated_tokens: number;
  source_inventory_conservative_estimated_tokens: number;
  instruction_cn: string;
}

export interface ContextSufficiencyEvidence {
  source_ref: string;
  title: string;
  evidence_role_cn: string;
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextMissingEvidence {
  evidence_type: string;
  label_cn: string;
  reason_cn: string;
}

export interface ContextSufficiencyCheck {
  schema_version: "open-insight.sufficiency-check.v0.1";
  status: "not_applicable" | "sufficient_for_current_question" | "partial_requires_more_sources" | "insufficient_context";
  triggered: boolean;
  question_type: "transaction_structure_review" | "general_evidence_sufficiency" | "not_applicable";
  available_evidence: ContextSufficiencyEvidence[];
  missing_evidence: ContextMissingEvidence[];
  safe_conclusion_cn: string;
  source_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextConsumerRoute {
  route_id: "question_answering" | "analysis" | "html_restore" | "word_outline" | "ppt_outline" | "audit_trace";
  user_intent_cn: string;
  recommended_context_mode: "compact_retrieval" | "full_normalized_with_compact_index" | "audit_trace";
  token_policy_cn: string;
  first_read: string[];
  fragment_read_plan: ContextFragmentReadPlan;
  required_refs: string[];
  output_boundary: "external_file_or_overlay_or_derived_package";
  base_package_mutation: false;
}

export interface ContextMaterialGenerationReadinessRoute {
  route_id: ContextConsumerRoute["route_id"];
  user_intent_cn: string;
  readiness: "ready" | "needs_fragment_reads" | "degraded";
  readiness_reason_cn: string;
  recommended_context_mode: ContextConsumerRoute["recommended_context_mode"];
  primary_cli_command: string;
  primary_mcp_tool: "open_insight_search_chunks" | "open_insight_context_handoff";
  primary_mcp_arguments: Record<string, unknown>;
  follow_up_cli_command_template: string;
  follow_up_mcp_tool: "open_insight_resolve_source";
  required_refs: string[];
  required_refs_present: {
    source_refs: boolean;
    lineage_refs: boolean;
    parse_diagnostic_ids: boolean;
    source_map_refs: boolean;
    page_cues: boolean;
  };
  missing_refs: string[];
  token_strategy: {
    recommended_context_mode: ContextConsumerRoute["recommended_context_mode"];
    token_count_is_estimated: true;
    estimated_compact_tokens: number;
    token_budget: number;
    savings_vs_direct: number;
    savings_vs_normalized: number;
    recommended_mode: ContextTokenEvalResult["recommended_mode"];
  };
  output_boundary: ContextConsumerRoute["output_boundary"];
  base_package_mutation: false;
  model_required_by_open_insight: false;
  user_action_cn: string;
}

export interface ContextMaterialGenerationReadiness {
  schema_version: "open-insight.material-generation-readiness.v0.1";
  status: "ready" | "degraded";
  summary: {
    route_count: number;
    ready_count: number;
    needs_fragment_reads_count: number;
    degraded_count: number;
  };
  routes: ContextMaterialGenerationReadinessRoute[];
  safety: {
    model_invoked: false;
    env_recorded: false;
    api_key_recorded: false;
    package_code_executed: false;
    base_package_mutation: false;
  };
}

export interface ContextMaterialGenerationRecipeRoute {
  route_id: ContextConsumerRoute["route_id"];
  output_kind: "qa" | "analysis" | "html" | "word_outline" | "ppt_outline" | "audit_trace";
  user_goal_cn: string;
  readiness: ContextMaterialGenerationReadinessRoute["readiness"];
  recommended_context_mode: ContextConsumerRoute["recommended_context_mode"];
  primary_cli_command: string;
  primary_mcp_tool: ContextMaterialGenerationReadinessRoute["primary_mcp_tool"];
  read_sequence: string[];
  prompt_skeleton_cn: string;
  required_inputs: string[];
  follow_up_read_plan: {
    cli_command_template: string;
    mcp_tool: "open_insight_resolve_source";
    expected_fragment_field: "normalized_source_fragment";
    required_when_cn: string;
  };
  required_citation_fields: string[];
  forbidden: string[];
  output_contract: {
    output_boundary: ContextConsumerRoute["output_boundary"];
    base_package_mutation: false;
    model_required_by_open_insight: false;
    allowed_destination: "external_file";
  };
  validation_checklist_cn: string[];
}

export interface ContextMaterialGenerationRecipes {
  schema_version: "open-insight.material-generation-recipes.v0.1";
  status: ContextMaterialGenerationReadiness["status"];
  recipe_count: number;
  routes: ContextMaterialGenerationRecipeRoute[];
  safety: {
    model_invoked: false;
    env_recorded: false;
    api_key_recorded: false;
    package_code_executed: false;
    base_package_mutation: false;
  };
}

export interface ContextAnswerHandoffMode {
  readiness: "ready" | "needs_fragment_reads" | "degraded";
  reason_cn: string;
  required_inputs: string[];
  prompt_cn: string;
  validation_checklist_cn: string[];
  forbidden: string[];
}

export interface ContextAnswerHandoff {
  schema_version: "open-insight.answer-handoff.v0.1";
  status: "quick_ready" | "audit_required" | "degraded";
  question: string;
  recommended_mode: "quick_answer" | "audited_answer" | "increase_token_budget_or_recompile";
  query_difficulty: {
    scope: "single_source" | "multi_source" | "broad_or_comparative" | "unknown";
    reason_cn: string;
    broad_query_detected: boolean;
    multi_source_context: boolean;
    compact_truncated: boolean;
    fallback_used: boolean;
    source_coverage_rate: number;
  };
  parser_quality: {
    status: "content_ready" | "metadata_only_or_weak" | "unknown";
    markitdown_recommended: boolean;
    diagnostics: string[];
    disclosure_cn: string;
  };
  answer_modes: {
    quick_answer: ContextAnswerHandoffMode & {
      use_compact_context: true;
      max_expected_scope_cn: string;
    };
    audited_answer: ContextAnswerHandoffMode & {
      required_follow_up_reads: ContextCompactFragmentRead[];
      min_required_fragment_reads: number;
      resolve_source_cli_commands: string[];
      resolve_source_mcp_calls: Array<{ name: "open_insight_resolve_source"; arguments: { target_id: string } }>;
    };
  };
  external_llm_instruction_cn: string;
  safety: {
    model_invoked: false;
    env_recorded: false;
    api_key_recorded: false;
    package_code_executed: false;
    base_package_mutation: false;
  };
  diagnostics: string[];
}

export interface ContextFragmentReadPlan {
  mode: "on_demand_resolve_source";
  when_cn: string;
  cli_command_template: string;
  mcp_tool: "open_insight_resolve_source";
  chunk_id_sources: string[];
  expected_fragment_field: "normalized_source_fragment";
  required_fields: string[];
  source_mode_disclosure_required: true;
  max_fragment_policy_cn: string;
}

export interface ContextTokenPathNoiseMetrics {
  estimated_noise_tokens: number;
  estimated_useful_tokens: number;
  noise_ratio: number;
}

export interface ContextNoiseMetrics {
  measurement_mode: "query_index_chunks" | "token_delta_fallback";
  noise_basis: "deterministic_query_scoped_filtering";
  total_index_chunk_count: number;
  included_chunk_count: number;
  excluded_chunk_count: number;
  page_furniture_filtered_count: number;
  page_furniture_filtered_tokens: number;
  disclaimer_filtered_count: number;
  disclaimer_filtered_tokens: number;
  document_chunk_excluded_count: number;
  document_chunk_excluded_tokens: number;
  non_returned_fine_grained_chunk_count: number;
  non_returned_fine_grained_tokens: number;
  compact_noise_tokens: number;
  estimated_noise_tokens_removed: number;
  noise_reduction_rate: number;
  compact_default_excludes: {
    content_roles: string[];
    chunk_levels: string[];
  };
}

interface QueryIndexChunkRecord {
  chunk_id: string;
  source_id?: string;
  source_refs?: string[];
  text: string;
  chunk_level: string;
  content_role: string;
  estimated_tokens: number;
}

export interface ContextHandoffResult {
  status: "ready" | "degraded";
  profile: ContextChunkSearchResult["profile"];
  package_id: string;
  title: string;
  spec_version: string;
  source_mode: ContextChunkSearchResult["source_mode"];
  query: string;
  token_budget: number;
  read_order: string[];
  cli: {
    summary_command: string;
    compact_context_command: string;
    token_eval_command: string;
    material_contract_command: string;
    resolve_source_command: string;
  };
  mcp: {
    required_tools: Array<{ name: string; arguments: Record<string, unknown> }>;
  };
  compact_context: { schema_version: "open-insight.context-compact-retrieval.v0.1" } & ContextCompactRetrievalResult;
  token_eval: { schema_version: "open-insight.context-token-eval.v0.1" } & ContextTokenEvalResult;
  token_benchmark: ContextTokenBenchmarkSummary;
  source_mode_disclosure: ContextSourceModeDisclosure;
  source_inventory_summary: ContextSourceInventorySummary;
  token_metric_policy: ContextTokenMetricPolicy;
  sufficiency_check: ContextSufficiencyCheck;
  answer_handoff: ContextAnswerHandoff;
  consumer_routes: ContextConsumerRoute[];
  material_generation_readiness: ContextMaterialGenerationReadiness;
  material_generation_recipes: ContextMaterialGenerationRecipes;
  material_contract: { schema_version: "open-insight.user-material-contract.v0.1" } & ContextUserMaterialContractResult;
  output_policy: {
    allowed_outputs: string[];
    output_boundary: string;
    base_package_mutation: false;
    model_required_by_open_insight: false;
  };
  user_material_prompt: {
    role: string;
    instruction: string;
    required_citation_fields: string[];
    forbidden: string[];
  };
  safety: {
    model_invoked: false;
    env_recorded: false;
    api_key_recorded: false;
    package_code_executed: false;
    base_package_mutation: false;
  };
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  diagnostics: string[];
}

export interface ContextAnswerContextResolvedFragment {
  target_id: string;
  title: string;
  status: "resolved" | "unresolved";
  reason_cn: string;
  source_mode_disclosure_required: true;
  normalized_source_fragment?: ContextNormalizedSourceFragment;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextAnswerContextWindowFragment {
  target_id: string;
  title: string;
  text: string;
  estimated_tokens: number;
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
}

export interface ContextAnswerContextResult {
  status: "ready" | "needs_more_context" | "degraded";
  profile: ContextHandoffResult["profile"];
  package_id: string;
  title: string;
  spec_version: string;
  source_mode: ContextHandoffResult["source_mode"];
  query: string;
  token_budget: number;
  max_follow_up_reads: number;
  recommended_mode: ContextAnswerHandoff["recommended_mode"];
  answer_handoff_status: ContextAnswerHandoff["status"];
  compact_context: { schema_version: "open-insight.context-compact-retrieval.v0.1" } & ContextCompactRetrievalResult;
  answer_handoff: ContextAnswerHandoff;
  source_mode_disclosure: ContextSourceModeDisclosure;
  source_inventory_summary: ContextSourceInventorySummary;
  token_metric_policy: ContextTokenMetricPolicy;
  sufficiency_check: ContextSufficiencyCheck;
  resolved_fragments: ContextAnswerContextResolvedFragment[];
  unresolved_reads: ContextCompactFragmentRead[];
  context_window: {
    schema_version: "open-insight.answer-context-window.v0.1";
    read_strategy: "compact_plus_bounded_fragments";
    estimated_tokens: number;
    compact_estimated_tokens: number;
    fragment_estimated_tokens: number;
    fragment_count: number;
    source_count: number;
    fragments: ContextAnswerContextWindowFragment[];
  };
  allowed_reference_ids: {
    chunk_ids: string[];
    source_refs: string[];
    lineage_refs: string[];
    parse_diagnostic_ids: string[];
    source_map_refs: string[];
  };
  external_llm_instruction_cn: string;
  answer_policy: {
    answer_must_use_context: true;
    cite_sources: true;
    disclose_source_light: boolean;
    unresolved_fragments_require_uncertainty: true;
    output_boundary: "external_answer_or_user_material";
    base_package_mutation: false;
    model_invoked_by_open_insight: false;
  };
  safety: {
    model_invoked: false;
    env_recorded: false;
    api_key_recorded: false;
    package_code_executed: false;
    base_package_mutation: false;
  };
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs: string[];
  diagnostics: string[];
}

export async function searchContextChunksForCli(
  packageRoot: string,
  query: string,
  options: SearchContextChunksOptions = {}
): Promise<ContextChunkSearchResult | ContextCompactRetrievalResult> {
  const effectiveOptions =
    options.compact === true && options.limit === undefined
      ? { ...options, limit: 24 }
      : options;
  const retrievalQuery = options.compact === true ? buildCompactRetrievalSearchQuery(query) : query;
  const sqliteMatches = await trySearchSqliteQueryIndex(packageRoot, retrievalQuery, effectiveOptions);

  if (sqliteMatches) {
    const summary = await summarizeContextPackage(packageRoot);
    const result: ContextChunkSearchResult = {
      status: summary.status,
      profile: summary.profile,
      package_id: summary.package_id,
      title: summary.title,
      spec_version: summary.spec_version,
      source_mode: summary.source_mode,
      source_refs: summary.source_refs,
      lineage_refs: summary.lineage_refs,
      parse_diagnostic_ids: summary.parse_diagnostic_ids,
      query,
      limit: Math.max(1, effectiveOptions.limit ?? 5),
      matches: sqliteMatches.matches
    };

    return options.compact === true
      ? buildCompactRetrievalResult(result, clampTokenBudget(options.tokenBudget), {
          includePageFurniture: options.includePageFurniture === true,
          ...(hasDocumentScope(options) ? { targetDocumentIds: getDocumentIds(options) } : {})
        })
      : scopeContextChunkSearchResult(result, options);
  }

  const directIndexMatches = await trySearchDirectQueryIndex(packageRoot, retrievalQuery, effectiveOptions);

  if (directIndexMatches) {
    const summary = await summarizeContextPackage(packageRoot);
    const result: ContextChunkSearchResult = {
      status: summary.status,
      profile: summary.profile,
      package_id: summary.package_id,
      title: summary.title,
      spec_version: summary.spec_version,
      source_mode: summary.source_mode,
      source_refs: summary.source_refs,
      lineage_refs: summary.lineage_refs,
      parse_diagnostic_ids: summary.parse_diagnostic_ids,
      query,
      limit: Math.max(1, effectiveOptions.limit ?? 5),
      matches: directIndexMatches.matches
    };

    return options.compact === true
      ? buildCompactRetrievalResult(result, clampTokenBudget(options.tokenBudget), {
          includePageFurniture: options.includePageFurniture === true,
          ...(hasDocumentScope(options) ? { targetDocumentIds: getDocumentIds(options) } : {})
        })
      : scopeContextChunkSearchResult(result, options);
  }

  const result = preferStableIndexedMatchesForCompact(
    refineFallbackNormalizedSourceMatches(await searchContextChunks(packageRoot, retrievalQuery, effectiveOptions), retrievalQuery, effectiveOptions),
    effectiveOptions
  );
  const broadenedResult = await maybeBroadenSourceInventoryCompactResult(packageRoot, result, query, effectiveOptions);

  return options.compact === true
    ? buildCompactRetrievalResult(broadenedResult, clampTokenBudget(options.tokenBudget), {
        includePageFurniture: options.includePageFurniture === true,
        ...(hasDocumentScope(options) ? { targetDocumentIds: getDocumentIds(options) } : {})
      })
    : scopeContextChunkSearchResult(broadenedResult, options);
}

function buildCompactRetrievalSearchQuery(query: string): string {
  if (shouldUseSourceOverviewSearchQuery(query)) {
    return query;
  }

  const terms = extractCompactRetrievalSearchTerms(query);
  const compactQuery = terms.join(" ").trim();

  if (terms.length < 2) {
    return query;
  }

  return compactQuery;
}

function shouldUseSourceOverviewSearchQuery(query: string): boolean {
  if (!isSourceInventoryContextQuery(query) || isSingleSourceContentQuestion(query)) {
    return false;
  }

  return !hasSubstantiveCompactRetrievalIntent(query);
}

function isSingleSourceContentQuestion(query: string): boolean {
  return /(?:\u8be5|\u672c|\u6b64)(?:\u6587\u4ef6|\u6750\u6599|\u6587\u6863|\u62a5\u544a|\u8d44\u6599)/u.test(query);
}

function hasSubstantiveCompactRetrievalIntent(query: string): boolean {
  return /(?:\u804c\u8d23|\u8d23\u4efb|\u4e49\u52a1|\u6743\u5229|\u98ce\u9669|\u4ea4\u6613|\u7ed3\u6784|\u6cbb\u7406|\u91d1\u989d|\u6570\u503c|\u6570\u5b57|\u65e5\u671f|\u671f\u9650|\u6536\u5165|\u8d39\u7528|\u6210\u672c|\u73b0\u91d1\u6d41|\u5206\u914d|\u539f\u56e0|\u5f71\u54cd|\u53d8\u5316|\u5dee\u5f02|\u5bf9\u6bd4|\u8d8b\u52bf|\u6761\u6b3e|manager|trustee|responsibilit|duty|duties|obligation|right|risk|transaction|structure|governance|amount|number|numeric|date|term|revenue|expense|cost|cash\s*flow|distribution|reason|impact|change|difference|compare|trend|clause)/iu.test(
    query
  );
}

function extractCompactRetrievalSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const pushTerm = (term: string) => {
    const cleaned = term.trim().toLowerCase();

    if (cleaned.length < 2 || cleaned.length > 16 || isCompactRetrievalQuestionStopword(cleaned)) {
      return;
    }

    terms.push(cleaned);
  };

  for (const term of segmentCompactRetrievalWords(query)) {
    pushTerm(term);
  }

  for (const term of extractDirectQueryTerms(query)) {
    pushTerm(term);
  }

  for (const term of extractSqliteSubstringQueryTerms(query)) {
    pushTerm(term);
  }

  return uniqueStrings(terms).slice(0, 16);
}

function segmentCompactRetrievalWords(query: string): string[] {
  const segmenterConstructor = (Intl as typeof Intl & {
    Segmenter?: new (
      locale?: string | string[],
      options?: { granularity?: "word" }
    ) => { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> };
  }).Segmenter;

  if (!segmenterConstructor) {
    return [];
  }

  const segmenter = new segmenterConstructor("zh", { granularity: "word" });
  const wordSegments = Array.from(segmenter.segment(query))
    .filter((part) => part.isWordLike !== false)
    .map((part) => part.segment.trim().toLowerCase())
    .filter((part) => part.length >= 2 && !isCompactRetrievalQuestionStopword(part));
  const combinedTerms: string[] = [];

  for (let index = 0; index < wordSegments.length; index += 1) {
    const current = wordSegments[index] ?? "";
    const next = wordSegments[index + 1] ?? "";

    combinedTerms.push(current);

    if (isCjkTerm(current) && isCjkTerm(next)) {
      const pair = `${current}${next}`;

      if (pair.length >= 3 && pair.length <= 10) {
        combinedTerms.push(pair);
      }
    }
  }

  return combinedTerms;
}

function isCjkTerm(value: string): boolean {
  return /^\p{Script=Han}+$/u.test(value);
}

function isCompactRetrievalQuestionStopword(term: string): boolean {
  return (
    isGenericQuestionTerm(term) ||
    isDirectQueryStopword(term) ||
    new Set([
      "the",
      "and",
      "only",
      "based",
      "file",
      "answer",
      "question",
      "\u8bf7",
      "\u57fa\u4e8e",
      "\u8be5",
      "\u8be5\u6587\u4ef6",
      "\u6587\u4ef6",
      "\u8bf4\u660e",
      "\u53e6\u5916",
      "\u5176\u4e2d",
      "\u63d0\u5230",
      "\u4f7f\u7528",
      "\u4e0a\u4e0b\u6587",
      "\u65e0\u6cd5",
      "\u786e\u5b9a",
      "\u5c31",
      "\u548c",
      "\u4e0e",
      "\u6216",
      "\u4ee5\u53ca",
      "\u5206\u522b",
      "\u4ec0\u4e48",
      "\u54ea\u4e9b",
      "\u4e3b\u8981",
      "\u5217\u51fa"
    ]).has(term)
  );
}

function preferStableIndexedMatchesForCompact(
  result: ContextChunkSearchResult,
  options: SearchContextChunksOptions
): ContextChunkSearchResult {
  if (options.compact !== true) {
    return result;
  }

  const stableMatches = result.matches.filter((match) => !isTransientFallbackNormalizedMatch(match));

  if (stableMatches.length === 0 || stableMatches.length === result.matches.length) {
    return result;
  }

  return {
    ...result,
    matches: stableMatches
  };
}

function isTransientFallbackNormalizedMatch(match: ContextChunkMatch): boolean {
  if ((match as { retrieval_source?: string }).retrieval_source === "fallback_normalized_source") {
    return true;
  }

  return /^normalized_source\..+\.(?:section|paragraph|table|page_furniture)\.\d+$/.test(match.chunk_id);
}

async function trySearchDirectQueryIndex(
  packageRoot: string,
  query: string,
  options: SearchContextChunksOptions
): Promise<{ matches: IndexedContextChunkMatch[] } | undefined> {
  const directMatches = await readDirectQueryIndexMatches(packageRoot, options);

  if (directMatches.length === 0) {
    return undefined;
  }

  if (options.compact === true && shouldUseSourceOverviewSearchQuery(query)) {
    const sourceOverviewMatches = directMatches.filter(
      (match) => match.chunk_level === "source_overview" || match.content_role === "source_overview"
    );

    if (sourceOverviewMatches.length > 0) {
      return { matches: sourceOverviewMatches.slice(0, Math.max(1, options.limit ?? 24)) };
    }
  }

  const terms = extractDirectQueryTerms(query);

  if (terms.length === 0) {
    return undefined;
  }

  const scoredMatches = directMatches
    .filter((match) => isDirectQuerySearchCandidate(match, options))
    .map((match) => ({ ...match, score: scoreDirectQueryMatch(match, terms) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if ((left.source_id ?? "") !== (right.source_id ?? "")) {
        return (left.source_id ?? "").localeCompare(right.source_id ?? "");
      }

      return (left.read_order ?? Number.MAX_SAFE_INTEGER) - (right.read_order ?? Number.MAX_SAFE_INTEGER);
    });

  if (scoredMatches.length === 0) {
    return undefined;
  }

  const diversifiedMatches = diversifyContextChunkMatchesBySource(scoredMatches, Math.max(1, options.limit ?? 24), {
    prioritizeCompactContext: options.compact === true
  });

  return { matches: diversifiedMatches };
}

async function maybeBroadenSourceInventoryCompactResult(
  packageRoot: string,
  result: ContextChunkSearchResult,
  query: string,
  options: SearchContextChunksOptions
): Promise<ContextChunkSearchResult> {
  if (options.compact !== true || hasDocumentScope(options) || !shouldUseSourceOverviewSearchQuery(query)) {
    return result;
  }

  const totalSourceCount = result.source_refs.length;

  if (totalSourceCount <= 1) {
    return result;
  }

  const currentSourceCoverage = countContextMatchSources(result.matches as IndexedContextChunkMatch[]);
  const coverageTarget = Math.min(totalSourceCount, Math.max(2, Math.min(options.limit ?? 24, totalSourceCount)));

  if (currentSourceCoverage >= coverageTarget) {
    return result;
  }

  const sourceOverviewMatches = await readQueryIndexSourceOverviewMatches(packageRoot, options);
  const sourceOverviewCoverage = countContextMatchSources(sourceOverviewMatches);

  if (sourceOverviewMatches.length === 0 || sourceOverviewCoverage <= currentSourceCoverage) {
    return result;
  }

  return {
    ...result,
    limit: Math.max(1, options.limit ?? result.limit ?? 24),
    matches: sourceOverviewMatches.slice(0, Math.max(1, options.limit ?? 24))
  };
}

export async function evaluateContextTokensForCli(
  packageRoot: string,
  query: string,
  options: {
    tokenBudget?: number;
    documentId?: string;
    documentIds?: string[];
    directBaselinePath?: string;
    directBaselineSourceFilter?: Partial<ExternalBaselineSourceFilter>;
    directBaselineSummary?: ExternalBaselineSummary;
  } = {}
): Promise<ContextTokenEvalResult> {
  const tokenBudget = clampTokenBudget(options.tokenBudget);
  const summary = await summarizeContextPackage(packageRoot);
  const documentIds = getDocumentIds(options);
  const normalizedSources = (await readNormalizedSourceTexts(packageRoot)).filter(
    (source) => documentIds.length === 0 || documentIds.includes(path.parse(source.path).name)
  );
  const normalizedText = normalizedSources.map((source) => source.text).join("\n\n");
  const normalizedTokens = estimateContextTokens(normalizedText);
  const externalBaseline = options.directBaselineSummary
    ? normalizeExternalBaselineSummary(options.directBaselineSummary)
    : options.directBaselinePath
      ? await readExternalBaselineSummary(options.directBaselinePath, options.directBaselineSourceFilter)
      : undefined;
  const directFullTextTokens = externalBaseline?.estimated_tokens ?? normalizedTokens;
  const directFullTextBasis: DirectFullTextBasis = externalBaseline ? EXTERNAL_BASELINE_BASIS : DIRECT_FULL_TEXT_BASIS;
  const baselineDisclosure = externalBaseline ? EXTERNAL_BASELINE_DISCLOSURE_CN : TOKEN_BASELINE_DISCLOSURE_CN;
  const queryIndexChunks = await readQueryIndexChunkRecords(packageRoot);
  const compact = (await searchContextChunksForCli(packageRoot, query, {
    compact: true,
    tokenBudget,
    limit: 24,
    ...(hasDocumentScope(options) ? { documentIds: getDocumentIds(options) } : {})
  })) as ContextCompactRetrievalResult;
  const compactText = [
    ...compact.facts.map((fact) => fact.text),
    ...compact.tables.map((table) => table.text),
    ...compact.key_numbers.map((number) => number.snippet)
  ].join("\n");
  const savings = directFullTextTokens > 0 ? Math.max(0, (directFullTextTokens - compact.estimated_tokens) / directFullTextTokens) : 0;
  const sourceRefCoverage = compact.included_chunk_count > 0 ? safeRatio(countTraceableFacts(compact, "source_refs"), compact.included_chunk_count) : 0;
  const parseDiagnosticCoverage =
    compact.included_chunk_count > 0 ? safeRatio(countTraceableFacts(compact, "parse_diagnostic_ids"), compact.included_chunk_count) : 0;
  const hasUsableCompactContext = compact.included_chunk_count > 0 && compact.source_refs.length > 0 && compact.parse_diagnostic_ids.length > 0;
  const traceableCompactContext = hasUsableCompactContext && sourceRefCoverage > 0 && parseDiagnosticCoverage > 0;
  const effectiveSavings = traceableCompactContext ? savings : 0;
  const numericPreservation = calculateNumericPreservationRate(normalizedText, compactText);
  const relevantQueryIndexChunks = documentIds.length > 0
    ? queryIndexChunks.filter((chunk) => matchesDocumentScope(chunk.source_id, chunk.source_refs, options))
    : queryIndexChunks;
  const tableContextCoverage = evaluateTableContextCoverage(relevantQueryIndexChunks, query, compact.tables);
  const scopedSourceCount = documentIds.length > 0 ? documentIds.length : compact.source_coverage.total_source_count;
  const scopedIncludedSourceCount = documentIds.length > 0
    ? documentIds.filter((documentId) => compact.source_refs.includes(documentId)).length
    : compact.source_coverage.included_source_count;
  const partialSourceCoverage =
    scopedSourceCount > 1 && scopedIncludedSourceCount > 0 && scopedIncludedSourceCount < scopedSourceCount;
  const broadPartialSourceCoverage = partialSourceCoverage && isOpenEndedCorpusQuestion(query);
  const noiseMetrics = buildContextNoiseMetrics({ normalizedTokens, compact, queryIndexChunks });
  const fullPathNoise = buildTokenPathNoiseMetrics(normalizedTokens, noiseMetrics.estimated_noise_tokens_removed);
  const directPathNoise = buildTokenPathNoiseMetrics(
    directFullTextTokens,
    Math.min(directFullTextTokens, noiseMetrics.estimated_noise_tokens_removed)
  );
  const compactPathNoise = buildTokenPathNoiseMetrics(compact.estimated_tokens, noiseMetrics.compact_noise_tokens);
  const diagnostics: string[] = [...(externalBaseline?.diagnostics ?? [])];

  if (!hasUsableCompactContext) {
    diagnostics.push("compact retrieval 未返回可交给外部 LLM 的可追源上下文，不能把 token 节省视为有效。");
  }
  if (compact.fallback_used) {
    diagnostics.push("compact retrieval 使用了 source_overview fallback：适合宽泛问题的第一轮阅读入口，但不是强关键词命中。");
  }

  if (compact.estimated_tokens >= normalizedTokens && normalizedTokens > 0) {
    diagnostics.push("compact retrieval 没有比完整 normalized source 更省 token，建议检查 chunk 粒度或查询词。");
  }
  if (broadPartialSourceCoverage) {
    diagnostics.push(
      `compact context 只覆盖 ${scopedIncludedSourceCount}/${scopedSourceCount} 个来源；这是跨文件或开放式问题，外部 LLM 不能把当前结果视为全量回答，应补读未覆盖来源或披露限制。`
    );
  }
  if (sourceRefCoverage < 1) {
    diagnostics.push("部分 compact context 缺少 source_refs，外部 LLM 追源能力会下降。");
  }
  if (parseDiagnosticCoverage < 1) {
    diagnostics.push("部分 compact context 缺少 parse_diagnostic_ids，解析质量边界不完整。");
  }
  if (numericPreservation < 0.95) {
    diagnostics.push("compact context 中存在无法在 normalized source 中回查的数字，建议人工复核。");
  }
  if (tableContextCoverage.applicability === "required" && tableContextCoverage.required_candidate_coverage_rate < 1) {
    diagnostics.push("compact context 未覆盖本次查询命中的相关表格，建议提高 token_budget 或补读 resolve-source 片段。");
  } else if (tableContextCoverage.applicability === "advisory" && tableContextCoverage.coverage_rate < 1) {
    diagnostics.push("compact context 未覆盖全部词法命中表格，但正文已覆盖本次查询；表格仅作为可选补充上下文。");
  }

  if (noiseMetrics.measurement_mode === "token_delta_fallback") {
    diagnostics.push("当前包缺少 query_index/chunks.jsonl，噪音降低率使用 token delta fallback 估算；建议用 context-library profile 重新编译。");
  }
  if (noiseMetrics.noise_reduction_rate < 0.7) {
    diagnostics.push("compact retrieval 噪音降低率低于 70%，建议检查 chunk 粒度、查询词或 token_budget。");
  }

  const status =
    traceableCompactContext &&
    compact.status === "ok" &&
    compact.estimated_tokens < directFullTextTokens &&
    noiseMetrics.noise_reduction_rate >= 0.7 &&
    sourceRefCoverage === 1 &&
    parseDiagnosticCoverage === 1 &&
    !broadPartialSourceCoverage &&
    numericPreservation >= 0.95 &&
    (tableContextCoverage.applicability !== "required" || tableContextCoverage.required_candidate_coverage_rate === 1)
      ? "completed"
      : "degraded";

  return {
    status,
    profile: summary.profile,
    package_id: summary.package_id,
    title: summary.title,
    spec_version: summary.spec_version,
    source_mode: summary.source_mode,
    query,
    token_budget: tokenBudget,
    estimated: true,
    token_count_is_estimated: true,
    direct_full_text_basis: directFullTextBasis,
    baseline_disclosure_cn: baselineDisclosure,
    direct_full_text: {
      estimated_tokens: directFullTextTokens,
      basis: directFullTextBasis,
      noise_metrics: directPathNoise,
      ...(externalBaseline
        ? {
            file_count: externalBaseline.file_count,
            total_bytes: externalBaseline.total_bytes,
            text_file_count: externalBaseline.text_file_count,
            binary_file_count: externalBaseline.binary_file_count,
            skipped_file_count: externalBaseline.skipped_file_count,
            filtered_file_count: externalBaseline.filtered_file_count,
            included_extensions: externalBaseline.included_extensions,
            source_filter: externalBaseline.source_filter,
            baseline_input_kind: externalBaseline.baseline_input_kind,
            baseline_quality: externalBaseline.baseline_quality,
            recommended_baseline_action_cn: externalBaseline.recommended_baseline_action_cn,
            estimation_methods: externalBaseline.estimation_methods,
            estimator_version: externalBaseline.estimator_version,
            estimation_mode: externalBaseline.estimation_mode,
            ...(externalBaseline.input_fingerprint ? { input_fingerprint: externalBaseline.input_fingerprint } : {}),
            diagnostics: externalBaseline.diagnostics
          }
        : {})
    },
    insight_full_normalized: {
      estimated_tokens: normalizedTokens,
      normalized_source_count: normalizedSources.length,
      noise_metrics: fullPathNoise
    },
    insight_compact_retrieval: {
      estimated_tokens: compact.estimated_tokens,
      token_budget: compact.token_budget,
      included_chunk_count: compact.included_chunk_count,
      table_count: compact.tables.length,
      table_candidate_count: tableContextCoverage.candidate_count,
      noise_metrics: compactPathNoise
    },
    savings_vs_direct: Number(effectiveSavings.toFixed(4)),
    savings_rate: Number(effectiveSavings.toFixed(4)),
    noise_reduction_rate: Number(noiseMetrics.noise_reduction_rate.toFixed(4)),
    noise_metrics: {
      ...noiseMetrics,
      noise_reduction_rate: Number(noiseMetrics.noise_reduction_rate.toFixed(4))
    },
    source_ref_coverage_rate: Number(sourceRefCoverage.toFixed(4)),
    parse_diagnostic_coverage_rate: Number(parseDiagnosticCoverage.toFixed(4)),
    numeric_preservation_rate: Number(numericPreservation.toFixed(4)),
    table_context_coverage_rate: Number(tableContextCoverage.coverage_rate.toFixed(4)),
    table_context_coverage: {
      applicability: tableContextCoverage.applicability,
      candidate_count: tableContextCoverage.candidate_count,
      required_candidate_count: tableContextCoverage.required_candidate_count,
      covered_required_candidate_count: tableContextCoverage.covered_required_candidate_count,
      required_candidate_coverage_rate: Number(tableContextCoverage.required_candidate_coverage_rate.toFixed(4))
    },
    recommended_mode: traceableCompactContext && compact.estimated_tokens < normalizedTokens ? "compact_retrieval" : "full_normalized",
    diagnostics,
    source_refs: compact.source_refs,
    lineage_refs: compact.lineage_refs,
    parse_diagnostic_ids: compact.parse_diagnostic_ids,
    source_map_refs: compact.source_map_refs,
    retrieval_quality: {
      non_empty_context: compact.included_chunk_count > 0,
      traceable_context: traceableCompactContext,
      fallback_used: compact.fallback_used,
      partial_source_coverage: partialSourceCoverage,
      source_coverage_rate: scopedSourceCount > 0 ? Number((scopedIncludedSourceCount / scopedSourceCount).toFixed(4)) : 1,
      included_source_count: scopedIncludedSourceCount,
      total_source_count: scopedSourceCount,
      effective_savings_vs_direct: Number(effectiveSavings.toFixed(4))
    }
  };
}

async function buildContextSourceInventorySummary(packageRoot: string): Promise<ContextSourceInventorySummary> {
  const inventoryPath = path.join(packageRoot, "source", "inventory.json");
  const inventory = (await readJsonFile(inventoryPath).catch(() => undefined)) as { sources?: unknown[] } | undefined;
  const sources = Array.isArray(inventory?.sources) ? inventory.sources.filter((source): source is Record<string, unknown> => isRecord(source)) : [];

  if (sources.length === 0) {
    return {
      schema_version: "open-insight.source-inventory-summary.v0.1",
      status: "unavailable",
      source_count: 0,
      normalized_source_count: 0,
      normalized_source_estimated_tokens: 0,
      normalized_source_conservative_estimated_tokens: 0,
      categories: [],
      files: [],
      disclosure_cn: "当前包没有可读取的 source/inventory.json；外部 LLM 不应据此推断文件总量或类别。"
    };
  }

  const files: ContextSourceInventorySummaryFile[] = [];

  for (const [index, source] of sources.entries()) {
    const sourceId = readStringField(source.source_id) ?? readStringField(source.id) ?? `source_${index + 1}`;
    const title =
      readStringField(source.title) ??
      readStringField(source.name) ??
      readStringField(source.path) ??
      readStringField(source.raw_source_path) ??
      readStringField(source.normalized_source_path) ??
      sourceId;
    const normalizedSourcePath = readStringField(source.normalized_source_path);
    const normalizedText = normalizedSourcePath ? await readPackageRelativeUtf8(packageRoot, normalizedSourcePath) : undefined;
    const category = inferInventorySourceCategory(source, title);
    const labelCn = inventoryCategoryLabelCn(category);
    const sourceRefs = readStringArrayField(source.source_refs) ?? [sourceId];
    const parseDiagnosticIds =
      readStringArrayField(source.parse_diagnostic_ids) ??
      readStringArrayField(source.parse_diagnostic_refs) ??
      readStringArrayField(source.parse_diagnostic_id) ??
      [];
    const sourceMapRefs =
      readStringArrayField(source.source_map_refs) ??
      readStringArrayField(source.source_map_ids) ??
      readStringArrayField(source.source_map_id) ??
      [];
    const normalizedTokens = normalizedText ? estimateContextTokens(normalizedText) : 0;
    const conservativeTokens = normalizedText ? estimateConservativeContextTokens(normalizedText) : 0;

    files.push({
      source_id: sourceId,
      title,
      category,
      label_cn: labelCn,
      ...(normalizedSourcePath ? { normalized_source_path: normalizedSourcePath } : {}),
      normalized_source_estimated_tokens: normalizedTokens,
      estimated_tokens_conservative: conservativeTokens,
      source_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: sourceMapRefs
    });
  }

  const normalizedSourceCount = files.filter((file) => file.normalized_source_estimated_tokens > 0).length;
  const normalizedTokens = files.reduce((sum, file) => sum + file.normalized_source_estimated_tokens, 0);
  const conservativeTokens = files.reduce((sum, file) => sum + file.estimated_tokens_conservative, 0);
  const categoryMap = new Map<string, ContextSourceInventorySummaryCategory>();

  for (const file of files) {
    const existing =
      categoryMap.get(file.category) ??
      {
        category: file.category,
        label_cn: file.label_cn,
        count: 0,
        normalized_source_estimated_tokens: 0,
        estimated_tokens_conservative: 0,
        token_share: 0,
        source_refs: [],
        parse_diagnostic_ids: [],
        source_map_refs: []
      };
    existing.count += 1;
    existing.normalized_source_estimated_tokens += file.normalized_source_estimated_tokens;
    existing.estimated_tokens_conservative += file.estimated_tokens_conservative;
    existing.source_refs = uniqueStrings([...existing.source_refs, ...file.source_refs]);
    existing.parse_diagnostic_ids = uniqueStrings([...existing.parse_diagnostic_ids, ...file.parse_diagnostic_ids]);
    existing.source_map_refs = uniqueStrings([...existing.source_map_refs, ...file.source_map_refs]);
    categoryMap.set(file.category, existing);
  }

  const categories = Array.from(categoryMap.values())
    .map((category) => ({
      ...category,
      token_share: conservativeTokens > 0 ? Number((category.estimated_tokens_conservative / conservativeTokens).toFixed(4)) : 0
    }))
    .sort((left, right) => right.estimated_tokens_conservative - left.estimated_tokens_conservative || left.category.localeCompare(right.category));

  return {
    schema_version: "open-insight.source-inventory-summary.v0.1",
    status: "ok",
    source_count: files.length,
    normalized_source_count: normalizedSourceCount,
    normalized_source_estimated_tokens: normalizedTokens,
    normalized_source_conservative_estimated_tokens: conservativeTokens,
    categories,
    files,
    disclosure_cn:
      "source_inventory_summary 是文件级读取顺序和 normalized source 规模摘要；回答文件数量、文件类型或全文 token 规模时优先使用这里的类别和 conservative estimate，不要把 compact_context 的 query-scoped token 当成整包总量。"
  };
}

function buildContextSourceModeDisclosure(input: {
  sourceMode: string;
  rawSourcesBundled: boolean;
  normalizedSourcesAvailable: boolean;
  queryIndexAvailable: boolean;
  materialContract: ContextUserMaterialContractResult;
  compact: ContextCompactRetrievalResult;
}): ContextSourceModeDisclosure {
  const sourceLight = input.sourceMode === "source_light" || input.materialContract.source_mode_disclosure_required === true;
  const containsSourceMap = input.compact.source_map_refs.length > 0;
  const containsParseDiagnostics = input.compact.parse_diagnostic_ids.length > 0;
  const containsSourceRefs = input.compact.source_refs.length > 0;

  return {
    source_mode: input.sourceMode,
    raw_sources_bundled: input.rawSourcesBundled,
    contains_raw_binary: input.rawSourcesBundled,
    contains_normalized_source: input.normalizedSourcesAvailable,
    contains_query_index: input.queryIndexAvailable,
    contains_source_refs: containsSourceRefs,
    contains_source_map: containsSourceMap,
    contains_parse_diagnostics: containsParseDiagnostics,
    disclosure_required: sourceLight,
    answer_disclosure_cn: sourceLight
      ? "source_light 包包含 normalized source、query index、source fingerprint、source refs、source map 和 parse diagnostics，可用于问答、检索和追源定位；但不包含原始 PDF/Word/Excel 二进制文件。最终审计或版式复核需要回到 external refs 指向的原文件或 source_bundled 包。"
      : "source_bundled 包声明包含原始来源文件和 normalized source；仍应优先通过 source refs、source map 和 parse diagnostics 追源复核。",
    llm_instruction_cn: sourceLight
      ? "回答时必须说明：当前依据来自 .insight 的 normalized source / query index，并保留 source refs 与 source map；不要把 source_light 说成已经内置完整原始 PDF。"
      : "回答时仍必须引用已有 source refs / source map；不要新增包内不存在的来源 ID。"
  };
}

function buildContextTokenMetricPolicy(input: {
  tokenEval: ContextTokenEvalResult;
  compact: ContextCompactRetrievalResult;
  sourceInventorySummary: ContextSourceInventorySummary;
}): ContextTokenMetricPolicy {
  const inventoryTokens = input.sourceInventorySummary.normalized_source_conservative_estimated_tokens;
  return {
    token_count_is_estimated: true,
    preferred_inventory_metric: "source_inventory_summary.normalized_source_conservative_estimated_tokens",
    query_index_estimated_tokens_are_not_package_totals: true,
    compact_context_tokens_are_query_scoped: true,
    full_normalized_tokens_are_package_reading_estimate: true,
    direct_full_text_basis: input.tokenEval.direct_full_text_basis,
    direct_full_text_estimated_tokens: input.tokenEval.direct_full_text.estimated_tokens,
    insight_full_normalized_estimated_tokens: input.tokenEval.insight_full_normalized.estimated_tokens,
    insight_compact_estimated_tokens: input.compact.estimated_tokens,
    source_inventory_conservative_estimated_tokens: inventoryTokens,
    instruction_cn:
      "token 是 deterministic estimate，不等于模型账单。回答整包规模、文件类别或全文 token 时，优先使用 source_inventory_summary 的文件级 conservative estimate；compact_context.estimated_tokens 只表示本次问题检索交接给 LLM 的 query-scoped 上下文，不是整包总量。"
  };
}

function buildContextSufficiencyCheck(input: {
  query: string;
  compact: ContextCompactRetrievalResult;
  sourceInventorySummary: ContextSourceInventorySummary;
}): ContextSufficiencyCheck {
  const sufficiencyQuery = isSufficiencyReviewQuery(input.query);
  const transactionStructureQuery = isTransactionStructureReviewQuery(input.query);

  if (!sufficiencyQuery) {
    return {
      schema_version: "open-insight.sufficiency-check.v0.1",
      status: "not_applicable",
      triggered: false,
      question_type: "not_applicable",
      available_evidence: [],
      missing_evidence: [],
      safe_conclusion_cn: "当前问题没有触发证据充分性检查；仍应只基于 answer-context 作答。",
      source_refs: [],
      parse_diagnostic_ids: [],
      source_map_refs: []
    };
  }

  const availableEvidence = buildAvailableSufficiencyEvidence(input.compact, input.sourceInventorySummary);
  const missingEvidence = transactionStructureQuery
    ? buildMissingTransactionStructureEvidence(input.sourceInventorySummary)
    : buildGenericMissingEvidence(input.sourceInventorySummary);
  const hasTraceableEvidence = availableEvidence.length > 0 && input.compact.source_refs.length > 0;
  const status: ContextSufficiencyCheck["status"] =
    !hasTraceableEvidence
      ? "insufficient_context"
      : missingEvidence.length > 0
        ? "partial_requires_more_sources"
        : "sufficient_for_current_question";
  const safeConclusion =
    status === "insufficient_context"
      ? "当前 answer-context 没有提供足够的可追溯证据，不能生成确定性结论；应先扩大检索、补读 normalized source 或重新编译来源。"
      : status === "partial_requires_more_sources"
        ? transactionStructureQuery
          ? "当前包可支持初步核对年度报告或招募说明书中的交易结构线索；但不足以完成完整核对，应继续补充法律意见书、基金合同、托管协议等原始交易文件。"
          : "当前包提供了部分可追溯上下文，但不足以完成完整证据核对；应继续补充问题所需的原始来源或使用 source_bundled 包复核。"
        : "当前 answer-context 的可追溯证据足以回答本问题；仍需引用已有 source refs / source map，并保持人工复核边界。";

  return {
    schema_version: "open-insight.sufficiency-check.v0.1",
    status,
    triggered: true,
    question_type: transactionStructureQuery ? "transaction_structure_review" : "general_evidence_sufficiency",
    available_evidence: availableEvidence,
    missing_evidence: missingEvidence,
    safe_conclusion_cn: safeConclusion,
    source_refs: uniqueStrings(availableEvidence.flatMap((evidence) => [evidence.source_ref])),
    parse_diagnostic_ids: uniqueStrings(availableEvidence.flatMap((evidence) => evidence.parse_diagnostic_ids)),
    source_map_refs: uniqueStrings(availableEvidence.flatMap((evidence) => evidence.source_map_refs))
  };
}

export async function buildContextHandoffForCli(
  packageRoot: string,
  query: string,
  options: {
    tokenBudget?: number;
    documentId?: string;
    documentIds?: string[];
    directBaselinePath?: string;
    directBaselineSourceFilter?: Partial<ExternalBaselineSourceFilter>;
    directBaselineSummary?: ExternalBaselineSummary;
  } = {}
): Promise<ContextHandoffResult> {
  const tokenBudget = clampTokenBudget(options.tokenBudget);
  const sourceFilter = normalizeExternalBaselineSourceFilter(options.directBaselineSourceFilter);
  const directBaselineFilterSuffix = [
    ...(sourceFilter.include_extensions?.length ? [" --direct-baseline-include-ext <ext-list>"] : []),
    ...(sourceFilter.exclude_extensions.length ? [" --direct-baseline-exclude-ext <ext-list>"] : [])
  ].join("");
  const directBaselineTokenEvalSuffix = options.directBaselineSummary
    ? " --direct-baseline-summary <json>"
    : options.directBaselinePath
      ? ` --direct-baseline <file-or-dir>${directBaselineFilterSuffix}`
      : "";
  const [summary, compact, tokenEval, materialContract, sourceInventorySummary] = await Promise.all([
    summarizeContextPackage(packageRoot),
    searchContextChunksForCli(packageRoot, query, {
      compact: true,
      tokenBudget,
      limit: 24,
      ...(hasDocumentScope(options) ? { documentIds: getDocumentIds(options) } : {})
    }) as Promise<ContextCompactRetrievalResult>,
    evaluateContextTokensForCli(packageRoot, query, {
      tokenBudget,
      ...(hasDocumentScope(options) ? { documentIds: getDocumentIds(options) } : {}),
      ...(options.directBaselinePath ? { directBaselinePath: options.directBaselinePath } : {}),
      ...(options.directBaselineSourceFilter ? { directBaselineSourceFilter: options.directBaselineSourceFilter } : {}),
      ...(options.directBaselineSummary ? { directBaselineSummary: options.directBaselineSummary } : {})
    }),
    buildContextUserMaterialContract(packageRoot),
    buildContextSourceInventorySummary(packageRoot)
  ]);
  const sourceModeDisclosure = buildContextSourceModeDisclosure({
    sourceMode: summary.source_mode,
    rawSourcesBundled: summary.llm_reading_strategy.raw_sources_bundled,
    normalizedSourcesAvailable: summary.llm_reading_strategy.normalized_sources_available,
    queryIndexAvailable: summary.llm_reading_strategy.query_index_available,
    materialContract,
    compact
  });
  const tokenMetricPolicy = buildContextTokenMetricPolicy({ tokenEval, compact, sourceInventorySummary });
  const sufficiencyCheck = buildContextSufficiencyCheck({ query, compact, sourceInventorySummary });
  const diagnostics = [
    ...tokenEval.diagnostics,
    ...(compact.included_chunk_count === 0 ? ["compact context 没有命中可交给外部 LLM 的片段，请调整 query 或改用 full normalized source。"] : []),
    ...(materialContract.source_mode_disclosure_required ? ["source_light 包不含原始文件，外部 LLM 生成材料时必须披露证据边界。"] : [])
  ];
  const tokenBenchmark = buildContextTokenBenchmarkSummary(tokenEval);
  const consumerRoutes = buildContextConsumerRoutes();
  const materialGenerationReadiness = buildMaterialGenerationReadiness({
    routes: consumerRoutes,
    query,
    tokenBudget,
    compact,
    tokenEval,
    tokenBenchmark,
    materialContract
  });
  const materialGenerationRecipes = buildMaterialGenerationRecipes({
    routes: consumerRoutes,
    readiness: materialGenerationReadiness,
    materialContract
  });
  const answerHandoff = buildContextAnswerHandoff({
    query,
    tokenBudget,
    compact,
    tokenEval,
    tokenBenchmark,
    materialContract
  });

  return {
    status:
      compact.status === "ok" &&
      compact.included_chunk_count > 0 &&
      tokenEval.status !== "degraded" &&
      materialContract.status === "ok" &&
      answerHandoff.status !== "degraded"
        ? "ready"
        : "degraded",
    profile: summary.profile,
    package_id: summary.package_id,
    title: summary.title,
    spec_version: summary.spec_version,
    source_mode: summary.source_mode,
    query,
    token_budget: tokenBudget,
    read_order: [
      "context summary",
      "context material-contract",
      "context search-chunks --compact",
      "answer_handoff",
      "context token-eval",
      "context resolve-source"
    ],
    cli: {
      summary_command: "context summary <package.insight> --format json",
      compact_context_command: `context search-chunks <package.insight> "${query}" --compact --token-budget ${tokenBudget} --format json`,
      token_eval_command: `context token-eval <package.insight> --query "${query}" --token-budget ${tokenBudget}${directBaselineTokenEvalSuffix} --format json`,
      material_contract_command: "context material-contract <package.insight> --format json",
      resolve_source_command: "context resolve-source <package.insight> <source-or-chunk-id> --format json"
    },
    mcp: {
      required_tools: [
        { name: "open_insight_context_summary", arguments: {} },
        { name: "open_insight_material_contract", arguments: {} },
        { name: "open_insight_search_chunks", arguments: { query, compact: true, token_budget: tokenBudget } },
        { name: "open_insight_token_eval", arguments: { query, token_budget: tokenBudget } },
        { name: "open_insight_context_handoff", arguments: { query, token_budget: tokenBudget } },
        { name: "open_insight_resolve_source", arguments: { target_id: "<source-or-chunk-id>" } }
      ]
    },
    compact_context: {
      schema_version: "open-insight.context-compact-retrieval.v0.1",
      ...compact
    },
    token_eval: {
      schema_version: "open-insight.context-token-eval.v0.1",
      ...tokenEval
    },
    token_benchmark: tokenBenchmark,
    source_mode_disclosure: sourceModeDisclosure,
    source_inventory_summary: sourceInventorySummary,
    token_metric_policy: tokenMetricPolicy,
    sufficiency_check: sufficiencyCheck,
    answer_handoff: answerHandoff,
    consumer_routes: consumerRoutes,
    material_generation_readiness: materialGenerationReadiness,
    material_generation_recipes: materialGenerationRecipes,
    material_contract: {
      schema_version: "open-insight.user-material-contract.v0.1",
      ...materialContract
    },
    output_policy: {
      allowed_outputs: materialContract.allowed_outputs,
      output_boundary: materialContract.output_boundary,
      base_package_mutation: false,
      model_required_by_open_insight: false
    },
    user_material_prompt: {
      role: "你是读取 Open Insight .insight 上下文信息库的外部 LLM / Agent。",
      instruction:
        "只基于 compact_context、consumer_routes[].fragment_read_plan、material_contract、normalized_source_fragment 和可解析 source refs 生成用户需要的 HTML、Word 大纲、PPT 大纲、问答或分析材料；先写用户材料，再列引用和待人工复核点。长文复现必须先用 compact_context/page_cues 定位，再通过 resolve-source 按需补读 normalized_source_fragment，不要一次性读取整份 source/normalized。",
      required_citation_fields: uniqueStrings([...materialContract.required_citation_fields, "page_cues"]),
      forbidden: [
        "不要编造 source_refs、lineage_refs、parse_diagnostic_ids 或 source_map_refs。",
        "不要新增 compact_context 中不存在的项目名、主体、金额、日期或结论。",
        "不要把 source_light 或 normalized_source_fragment 说成完整原始文件。",
        "不要把生成材料写回 base package。",
        "不要输出 API key、authorization token、环境变量或本地私密路径。"
      ]
    },
    safety: {
      model_invoked: false,
      env_recorded: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    },
    source_refs: hasDocumentScope(options) ? compact.source_refs : uniqueStrings([...compact.source_refs, ...materialContract.source_refs]),
    lineage_refs: hasDocumentScope(options) ? compact.lineage_refs : uniqueStrings([...compact.lineage_refs, ...materialContract.lineage_refs]),
    parse_diagnostic_ids: hasDocumentScope(options)
      ? compact.parse_diagnostic_ids
      : uniqueStrings([...compact.parse_diagnostic_ids, ...materialContract.parse_diagnostic_ids]),
    source_map_refs: compact.source_map_refs,
    diagnostics
  };
}

export async function buildContextAnswerContextForCli(
  packageRoot: string,
  query: string,
  options: {
    tokenBudget?: number;
    documentId?: string;
    documentIds?: string[];
    directBaselinePath?: string;
    directBaselineSourceFilter?: Partial<ExternalBaselineSourceFilter>;
    directBaselineSummary?: ExternalBaselineSummary;
    maxFollowUpReads?: number;
  } = {}
): Promise<ContextAnswerContextResult> {
  const tokenBudget = clampTokenBudget(options.tokenBudget);
  const maxFollowUpReads = clampAnswerContextReadCount(options.maxFollowUpReads);
  const handoff = await buildContextHandoffForCli(packageRoot, query, {
    tokenBudget,
    ...(hasDocumentScope(options) ? { documentIds: getDocumentIds(options) } : {}),
    ...(options.directBaselinePath ? { directBaselinePath: options.directBaselinePath } : {}),
    ...(options.directBaselineSourceFilter ? { directBaselineSourceFilter: options.directBaselineSourceFilter } : {}),
    ...(options.directBaselineSummary ? { directBaselineSummary: options.directBaselineSummary } : {})
  });
  const selectedReads = selectAnswerContextReads(
    handoff.compact_context,
    handoff.answer_handoff.answer_modes.audited_answer.required_follow_up_reads,
    query,
    maxFollowUpReads
  );
  const readsToResolve = await expandAnswerContextReads(
    packageRoot,
    selectedReads,
    query,
    maxFollowUpReads,
    handoff.compact_context.source_refs
  );
  const resolvedResults = await Promise.all(readsToResolve.map((read) => resolveAnswerContextFragment(packageRoot, read)));
  const resolvedFragments = resolvedResults.filter(
    (fragment): fragment is ContextAnswerContextResolvedFragment & { normalized_source_fragment: ContextNormalizedSourceFragment } =>
      fragment.status === "resolved" && fragment.normalized_source_fragment !== undefined
  );
  const unresolvedReads = readsToResolve.filter((read, index) => resolvedResults[index]?.status !== "resolved");
  const windowFragments = resolvedFragments.flatMap((fragment) => {
    const normalized = fragment.normalized_source_fragment;
    if (!normalized) return [];
    return [
      {
        target_id: fragment.target_id,
        title: fragment.title,
        text: normalized.text,
        estimated_tokens: normalized.estimated_tokens,
        source_refs: normalized.source_refs ?? [],
        lineage_refs: normalized.lineage_refs ?? [],
        parse_diagnostic_ids: normalized.parse_diagnostic_ids ?? [],
        source_map_refs: normalized.source_map_refs ?? []
      }
    ];
  });
  const fragmentTokens = windowFragments.reduce((sum, fragment) => sum + fragment.estimated_tokens, 0);
  const sourceRefs = uniqueStrings([
    ...handoff.source_refs,
    ...windowFragments.flatMap((fragment) => fragment.source_refs)
  ]);
  const lineageRefs = uniqueStrings([
    ...handoff.lineage_refs,
    ...windowFragments.flatMap((fragment) => fragment.lineage_refs)
  ]);
  const parseDiagnosticIds = uniqueStrings([
    ...handoff.parse_diagnostic_ids,
    ...windowFragments.flatMap((fragment) => fragment.parse_diagnostic_ids)
  ]);
  const sourceMapRefs = uniqueStrings([
    ...handoff.source_map_refs,
    ...windowFragments.flatMap((fragment) => fragment.source_map_refs)
  ]);
  const minRequiredReads = handoff.answer_handoff.answer_modes.audited_answer.min_required_fragment_reads;
  const requiredResolvedReads =
    handoff.answer_handoff.recommended_mode === "audited_answer" && readsToResolve.length > 0
      ? Math.min(Math.max(1, minRequiredReads), readsToResolve.length)
      : 0;
  const sourceOverviewSatisfiesQuery = isSourceOverviewSufficientForQuery(handoff.compact_context, query);
  const auditedAnswerHasNoUsableContext =
    handoff.answer_handoff.recommended_mode === "audited_answer" &&
    readsToResolve.length === 0 &&
    resolvedFragments.length === 0 &&
    !sourceOverviewSatisfiesQuery;
  const status: ContextAnswerContextResult["status"] =
    handoff.answer_handoff.status === "degraded" || handoff.answer_handoff.recommended_mode === "increase_token_budget_or_recompile"
      ? "degraded"
      : auditedAnswerHasNoUsableContext || resolvedFragments.length < requiredResolvedReads || unresolvedReads.length > 0
        ? "needs_more_context"
        : "ready";
  const diagnostics = uniqueStrings([
    ...handoff.diagnostics,
    ...resolvedResults.flatMap((fragment) => (fragment.status === "unresolved" ? [fragment.reason_cn] : [])),
    ...(status === "needs_more_context"
      ? ["answer-context 已生成可作答上下文，但仍有 follow-up fragment 未解析；外部 LLM 应披露不确定性或继续 resolve-source。"]
      : []),
    ...(status === "degraded" ? ["answer-context 降级：当前包或 parser 质量不足，不应生成确定性答案。"] : [])
  ]);

  return {
    status,
    profile: handoff.profile,
    package_id: handoff.package_id,
    title: handoff.title,
    spec_version: handoff.spec_version,
    source_mode: handoff.source_mode,
    query,
    token_budget: tokenBudget,
    max_follow_up_reads: maxFollowUpReads,
    recommended_mode: handoff.answer_handoff.recommended_mode,
    answer_handoff_status: handoff.answer_handoff.status,
    compact_context: handoff.compact_context,
    answer_handoff: handoff.answer_handoff,
    source_mode_disclosure: handoff.source_mode_disclosure,
    source_inventory_summary: handoff.source_inventory_summary,
    token_metric_policy: handoff.token_metric_policy,
    sufficiency_check: handoff.sufficiency_check,
    resolved_fragments: resolvedResults,
    unresolved_reads: unresolvedReads,
    context_window: {
      schema_version: "open-insight.answer-context-window.v0.1",
      read_strategy: "compact_plus_bounded_fragments",
      estimated_tokens: handoff.compact_context.estimated_tokens + fragmentTokens,
      compact_estimated_tokens: handoff.compact_context.estimated_tokens,
      fragment_estimated_tokens: fragmentTokens,
      fragment_count: windowFragments.length,
      source_count: sourceRefs.length,
      fragments: windowFragments
    },
    allowed_reference_ids: {
      chunk_ids: uniqueStrings([
        ...readsToResolve.map((read) => read.chunk_id),
        ...resolvedResults.flatMap((fragment) => {
          const chunkId = fragment.normalized_source_fragment?.chunk_id;
          return typeof chunkId === "string" ? [chunkId] : [];
        })
      ]),
      source_refs: sourceRefs,
      lineage_refs: lineageRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: sourceMapRefs
    },
    external_llm_instruction_cn:
      "你是读取 Open Insight answer-context 的外部 LLM。先使用 compact_context 判断问题范围，再只基于 context_window.fragments 与 compact_context 作答；必须引用 allowed_reference_ids 中已有的 source_refs / source_map_refs；如果上下文不足，直接说明缺口并建议继续 resolve-source，不要编造。",
    answer_policy: {
      answer_must_use_context: true,
      cite_sources: true,
      disclose_source_light: handoff.source_mode === "source_light",
      unresolved_fragments_require_uncertainty: true,
      output_boundary: "external_answer_or_user_material",
      base_package_mutation: false,
      model_invoked_by_open_insight: false
    },
    safety: {
      model_invoked: false,
      env_recorded: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    },
    source_refs: sourceRefs,
    lineage_refs: lineageRefs,
    parse_diagnostic_ids: parseDiagnosticIds,
    source_map_refs: sourceMapRefs,
    diagnostics
  };
}

async function resolveAnswerContextFragment(
  packageRoot: string,
  read: ContextCompactFragmentRead
): Promise<ContextAnswerContextResolvedFragment> {
  let result: ContextSourceResolveResult;
  try {
    result = await resolveContextSource(packageRoot, read.chunk_id);
  } catch (error) {
    return {
      target_id: read.chunk_id,
      title: read.title,
      status: "unresolved",
      reason_cn: error instanceof Error ? error.message : "resolve-source 执行失败。",
      source_mode_disclosure_required: true,
      source_refs: read.source_refs,
      lineage_refs: read.lineage_refs,
      parse_diagnostic_ids: read.parse_diagnostic_ids,
      source_map_refs: read.source_map_refs
    };
  }

  if (result.resolved && result.normalized_source_fragment) {
    return {
      target_id: read.chunk_id,
      title: read.title,
      status: "resolved",
      reason_cn: "已解析 normalized_source_fragment，可交给外部 LLM 作答或生成材料。",
      source_mode_disclosure_required: true,
      normalized_source_fragment: result.normalized_source_fragment,
      source_refs: uniqueStrings([...read.source_refs, ...(result.normalized_source_fragment.source_refs ?? [])]),
      lineage_refs: uniqueStrings([...read.lineage_refs, ...(result.normalized_source_fragment.lineage_refs ?? [])]),
      parse_diagnostic_ids: uniqueStrings([...read.parse_diagnostic_ids, ...(result.normalized_source_fragment.parse_diagnostic_ids ?? [])]),
      source_map_refs: uniqueStrings([...read.source_map_refs, ...(result.normalized_source_fragment.source_map_refs ?? [])])
    };
  }

  return {
    target_id: read.chunk_id,
    title: read.title,
    status: "unresolved",
    reason_cn: result.reason ?? "resolve-source 未返回 normalized_source_fragment。",
    source_mode_disclosure_required: true,
    source_refs: read.source_refs,
    lineage_refs: read.lineage_refs,
    parse_diagnostic_ids: read.parse_diagnostic_ids,
    source_map_refs: read.source_map_refs
  };
}

function clampAnswerContextReadCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 8;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function buildContextAnswerHandoff(input: {
  query: string;
  tokenBudget: number;
  compact: ContextCompactRetrievalResult;
  tokenEval: ContextTokenEvalResult;
  tokenBenchmark: ContextTokenBenchmarkSummary;
  materialContract: ContextUserMaterialContractResult;
}): ContextAnswerHandoff {
  const sourceCoverageRate = safeRatio(
    input.compact.source_coverage.included_source_count,
    Math.max(1, input.compact.source_coverage.total_source_count)
  );
  const broadQueryDetected = isBroadAnswerQuery(input.query);
  const multiSourceContext = input.compact.source_coverage.included_source_count > 1;
  const compactTruncated = input.compact.coverage_hints.truncated_by_token_budget === true;
  const fallbackUsed = input.compact.fallback_used === true;
  const parserQuality = inferContextParserQuality(input.compact, input.tokenEval);
  const followUpReads = selectAnswerFollowUpReads(input.compact, 12);
  const sourceOverviewSatisfiesQuery = isSourceOverviewSufficientForQuery(input.compact, input.query);
  const hasTraceableCompact =
    input.compact.included_chunk_count > 0 &&
    input.compact.source_refs.length > 0 &&
    input.compact.parse_diagnostic_ids.length > 0 &&
    input.compact.source_map_refs.length > 0;
  const auditRequired =
    broadQueryDetected ||
    multiSourceContext ||
    compactTruncated ||
    fallbackUsed ||
    input.tokenEval.status === "degraded" ||
    input.compact.coverage_hints.recommended_next_action !== "use_compact_context";
  const parserQualityBlocksAnswer = parserQuality.status === "metadata_only_or_weak" && !sourceOverviewSatisfiesQuery;
  const degraded =
    parserQualityBlocksAnswer ||
    !hasTraceableCompact ||
    (auditRequired && followUpReads.length === 0 && !sourceOverviewSatisfiesQuery);
  const status: ContextAnswerHandoff["status"] = degraded ? "degraded" : auditRequired ? "audit_required" : "quick_ready";
  const recommendedMode: ContextAnswerHandoff["recommended_mode"] =
    parserQualityBlocksAnswer
      ? "increase_token_budget_or_recompile"
      : status === "audit_required"
        ? "audited_answer"
        : status === "quick_ready"
          ? "quick_answer"
          : "increase_token_budget_or_recompile";
  const difficultyScope: ContextAnswerHandoff["query_difficulty"]["scope"] =
    broadQueryDetected
      ? "broad_or_comparative"
      : multiSourceContext
        ? "multi_source"
        : input.compact.included_chunk_count > 0
          ? "single_source"
          : "unknown";
  const diagnostics = uniqueStrings([
    ...parserQuality.diagnostics,
    ...(broadQueryDetected ? ["问题是宽泛/比较/多项枚举型问题，compact context 只能作为第一轮上下文。"] : []),
    ...(multiSourceContext ? ["compact context 覆盖多个 source，外部 LLM 生成正式答案前应补读关键片段。"] : []),
    ...(compactTruncated ? ["compact context 受到 token_budget 截断，正式答案需要补读或提高 token_budget。"] : []),
    ...(fallbackUsed ? ["compact retrieval 使用 fallback，命中质量低于精确检索。"] : []),
    ...(input.tokenEval.status === "degraded" ? ["token eval 已降级，不能只凭 token 节省判断成功。"] : []),
    ...(input.tokenBenchmark.status === "degraded" ? ["token benchmark 未达到当前质量门槛，外部 LLM 应优先走审计回答或补读片段。"] : []),
    ...(input.materialContract.source_mode_disclosure_required ? ["source_light 包不含原始文件，外部 LLM 必须披露证据边界。"] : [])
  ]);
  const quickReadiness: ContextAnswerHandoffMode["readiness"] = degraded ? "degraded" : "ready";
  const auditedReadiness: ContextAnswerHandoffMode["readiness"] = degraded
    ? "degraded"
    : auditRequired && followUpReads.length > 0
      ? "needs_fragment_reads"
      : "ready";

  return {
    schema_version: "open-insight.answer-handoff.v0.1",
    status,
    question: input.query,
    recommended_mode: recommendedMode,
    query_difficulty: {
      scope: difficultyScope,
      reason_cn: buildAnswerDifficultyReason({
        broadQueryDetected,
        multiSourceContext,
        compactTruncated,
        fallbackUsed,
        sourceCoverageRate
      }),
      broad_query_detected: broadQueryDetected,
      multi_source_context: multiSourceContext,
      compact_truncated: compactTruncated,
      fallback_used: fallbackUsed,
      source_coverage_rate: Number(sourceCoverageRate.toFixed(4))
    },
    parser_quality: parserQuality,
    answer_modes: {
      quick_answer: {
        readiness: quickReadiness,
        reason_cn: degraded
          ? "compact context 缺少可追溯正文或 parser 质量不足，不能直接交给外部 LLM 快答。"
          : auditRequired
            ? "可用于第一轮回答草稿，但宽泛/跨文件/截断/fallback 场景不能作为最终可信答案。"
            : "compact context 命中清晰、未截断且引用齐全，可以先交给外部 LLM 快速回答。",
        use_compact_context: true,
        max_expected_scope_cn: auditRequired
          ? "只能作为第一轮回答或问题澄清；正式答案需要 audited_answer 的补读片段。"
          : "适合回答当前 query 范围内的事实，不代表完整原文审计。",
        required_inputs: ["compact_context", "answer_handoff", "material_contract"],
        prompt_cn:
          "请只基于 compact_context 回答用户问题。先给直接答案，再列证据引用；如果 compact_context 不足，请明确说明需要按 answer_handoff.answer_modes.audited_answer.required_follow_up_reads 补读，不要编造。",
        validation_checklist_cn: [
          "答案中的每个事实都能追到 source_refs / parse_diagnostic_ids / source_map_refs。",
          "如果问题跨多个文件，必须说明当前 compact context 覆盖了哪些 source。",
          "不得把 source_light 说成完整原始文件证据。"
        ],
        forbidden: buildAnswerHandoffForbiddenList()
      },
      audited_answer: {
        readiness: auditedReadiness,
        reason_cn: degraded
          ? "当前解析或追源质量不足，建议使用 MarkItDown 重新编译非图片 PDF，或提高 token_budget 后再 handoff。"
          : auditRequired
            ? "正式答案需要先按 required_follow_up_reads 补读 bounded normalized_source_fragment，再综合回答。"
            : "当前 compact context 足够清晰；如用户要求审计级答案，可仍按 required_follow_up_reads 抽查补读。",
        required_inputs: ["answer_handoff", "compact_context", "context resolve-source / open_insight_resolve_source", "material_contract"],
        required_follow_up_reads: followUpReads,
        min_required_fragment_reads: auditRequired ? Math.min(Math.max(1, input.compact.source_coverage.included_source_count), followUpReads.length) : 0,
        resolve_source_cli_commands: followUpReads.map((read) => read.cli_command),
        resolve_source_mcp_calls: followUpReads.map((read) => ({
          name: "open_insight_resolve_source" as const,
          arguments: { target_id: read.chunk_id }
        })),
        prompt_cn:
          "请先读取 compact_context，再按 required_follow_up_reads 调用 resolve-source 补读局部原文窗口。回答时区分：原文事实、你的推理、仍需人工复核的点；不得新增 compact_context 或补读片段之外的主体、金额、日期、项目名或 source id。",
        validation_checklist_cn: [
          "至少补读 min_required_fragment_reads 指定数量的片段，除非 readiness=degraded。",
          "跨文件问题要覆盖多个 source，不能只引用第一个文件。",
          "关键数字和主体名称必须来自 compact_context 或 resolve-source 返回片段。",
          "输出仍是外部答案或材料，base_package_mutation=false。"
        ],
        forbidden: buildAnswerHandoffForbiddenList()
      }
    },
    external_llm_instruction_cn:
      "Open Insight 不在本步骤生成答案，也不调用模型。外部 LLM 应先看 recommended_mode：quick_answer 适合快速草稿；audited_answer 必须先补读 required_follow_up_reads；increase_token_budget_or_recompile 表示当前上下文不适合直接回答。",
    safety: {
      model_invoked: false,
      env_recorded: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    },
    diagnostics
  };
}

function isSourceOverviewOnlyCompact(compact: ContextCompactRetrievalResult): boolean {
  return (
    compact.included_chunk_count > 0 &&
    compact.facts.length > 0 &&
    compact.tables.length === 0 &&
    compact.facts.every((fact) => fact.content_role === "source_overview" || fact.chunk_level === "source_overview")
  );
}

function isSourceOverviewSufficientForQuery(compact: ContextCompactRetrievalResult, query: string): boolean {
  return (
    isSourceOverviewOnlyCompact(compact) &&
    isSourceInventoryContextQuery(query) &&
    !isSingleSourceContentQuestion(query) &&
    !hasSubstantiveCompactRetrievalIntent(query)
  );
}

function isBroadAnswerQuery(query: string): boolean {
  const normalized = query.trim();
  if (normalized.length >= 24) {
    return true;
  }
  return ["哪些", "有哪些", "分别", "这批", "这些", "所有", "主要", "整体", "比较", "差异", "汇总", "总结", "跨", "如何", "为什么"].some(
    (marker) => normalized.includes(marker)
  );
}

function isBroadContextRetrievalQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  const corpusMarkers = [
    "这批",
    "这些",
    "全部",
    "所有",
    "各个",
    "每个",
    "分别",
    "哪些文件",
    "哪些材料",
    "哪些报告",
    "哪些文档",
    "这组",
    "本批",
    "一批",
    "清单",
    "列表",
    "汇总",
    "整体",
    "跨文件",
    "多文件",
    "不同文件",
    "互相印证",
    "相互印证",
    "印证",
    "一致",
    "不一致",
    "口径",
    "复核",
    "人工复核",
    "不能回答",
    "无法回答",
    "不可回答",
    "缺少",
    "缺什么",
    "缺哪些",
    "overview",
    "inventory",
    "all",
    "each",
    "sources",
    "files",
    "documents"
  ];

  return corpusMarkers.some((marker) => normalized.includes(marker));
}

function isOpenEndedCorpusQuestion(query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  const markers = [
    "\u8fd9\u6279",
    "\u8fd9\u4e9b",
    "\u672c\u6279",
    "\u5168\u90e8",
    "\u6240\u6709",
    "\u5404\u4e2a",
    "\u6bcf\u4e2a",
    "\u5206\u522b",
    "\u54ea\u4e9b",
    "\u6709\u54ea\u4e9b",
    "\u662f\u8c01",
    "\u662f\u4ec0\u4e48",
    "\u4e3b\u8981",
    "\u6574\u4f53",
    "\u6c47\u603b",
    "\u6bd4\u8f83",
    "\u8de8\u6587\u4ef6",
    "\u591a\u6587\u4ef6",
    "\u4e0d\u540c\u6587\u4ef6",
    "\u4e92\u76f8\u5370\u8bc1",
    "\u76f8\u4e92\u5370\u8bc1",
    "\u5370\u8bc1",
    "\u4e00\u81f4",
    "\u4e0d\u4e00\u81f4",
    "\u53e3\u5f84",
    "\u590d\u6838",
    "\u4eba\u5de5\u590d\u6838",
    "\u4e0d\u80fd\u56de\u7b54",
    "\u65e0\u6cd5\u56de\u7b54",
    "\u4e0d\u53ef\u56de\u7b54",
    "\u7f3a\u5c11",
    "\u7f3a\u4ec0\u4e48",
    "\u7f3a\u54ea\u4e9b",
    "overview",
    "inventory",
    "all",
    "each",
    "every",
    "these",
    "those",
    "sources",
    "files",
    "documents"
  ];

  return markers.some((marker) => normalized.includes(marker));
}

function isSourceInventoryContextQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  const collectionPattern = /(这批|这些|本批|这组|全部|所有|各个|每个|多份|多个|一批|all|each|every|these|those)/i;
  const sourcePattern = /(文件|材料|文档|报告|资料|来源|source|sources|file|files|document|documents|material|materials|report|reports)/i;
  const inventoryPattern = /(分别|哪些|是什么|有什么|清单|列表|概览|总览|对应|项目|标题|名称|overview|inventory|list|catalog|what are)/i;

  return (
    /\b(?:overview|inventory|catalog)\b/i.test(normalized) ||
    (collectionPattern.test(normalized) && (sourcePattern.test(normalized) || inventoryPattern.test(normalized))) ||
    (sourcePattern.test(normalized) && inventoryPattern.test(normalized))
  );
}

function inferContextParserQuality(
  compact: ContextCompactRetrievalResult,
  tokenEval: ContextTokenEvalResult
): ContextAnswerHandoff["parser_quality"] {
  const compactText = [
    ...compact.facts.map((fact) => fact.text),
    ...compact.tables.map((table) => table.text),
    ...compact.page_cues.map((cue) => cue.location_label),
    ...tokenEval.diagnostics
  ]
    .join("\n")
    .toLowerCase();
  const metadataOnly =
    compactText.includes("metadata-only") ||
    compactText.includes("未抽取正文") ||
    compactText.includes("no body text") ||
    compactText.includes("正文为空") ||
    (compact.included_chunk_count === 0 && compact.source_refs.length > 0);

  if (metadataOnly) {
    return {
      status: "metadata_only_or_weak",
      markitdown_recommended: true,
      diagnostics: ["当前上下文疑似只有元数据或正文抽取不足；非图片化 PDF 应优先用 MarkItDown 重新转置后再编译。"],
      disclosure_cn:
        "这不是内容缺失的最终结论，而是 handoff 层发现可交给 LLM 的正文片段不足；请先用 MarkItDown 生成 normalized source。"
    };
  }

  if (compact.included_chunk_count > 0 && compact.source_refs.length > 0) {
    return {
      status: "content_ready",
      markitdown_recommended: false,
      diagnostics: [],
      disclosure_cn: "当前 handoff 中已有可追溯正文片段；如果源文件是非图片化 PDF，推荐继续保持 MarkItDown 作为默认 parser backend。"
    };
  }

  return {
    status: "unknown",
    markitdown_recommended: true,
    diagnostics: ["当前 handoff 无法确认 parser 正文质量；建议检查 parse diagnostics。"],
    disclosure_cn: "解析质量未知时，外部 LLM 不应把 compact context 当作完整原文。"
  };
}

function selectAnswerFollowUpReads(compact: ContextCompactRetrievalResult, limit: number): ContextCompactFragmentRead[] {
  const selected: ContextCompactFragmentRead[] = [];
  const selectedChunkIds = new Set<string>();
  const coveredSources = new Set<string>();

  for (const read of compact.next_fragment_reads) {
    if (isSourceOverviewFragmentRead(read)) {
      continue;
    }

    const hasNewSource = (read.source_refs ?? []).some((sourceRef) => !coveredSources.has(sourceRef));
    if (!hasNewSource || selectedChunkIds.has(read.chunk_id)) {
      continue;
    }
    selected.push(read);
    selectedChunkIds.add(read.chunk_id);
    for (const sourceRef of read.source_refs ?? []) {
      coveredSources.add(sourceRef);
    }
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const read of compact.next_fragment_reads) {
    if (isSourceOverviewFragmentRead(read)) {
      continue;
    }

    if (selectedChunkIds.has(read.chunk_id)) {
      continue;
    }
    selected.push(read);
    selectedChunkIds.add(read.chunk_id);
    if (selected.length >= limit) {
      return selected;
    }
  }

  return selected;
}

function selectAnswerContextReads(
  compact: ContextCompactRetrievalResult,
  handoffReads: ContextCompactFragmentRead[],
  query: string,
  limit: number
): ContextCompactFragmentRead[] {
  const terms = extractFallbackQueryTerms(query);
  const candidates: Array<{ read: ContextCompactFragmentRead; score: number; sequence: number }> = [];
  const seen = new Set<string>();
  let sequence = 0;

  const addCandidate = (read: ContextCompactFragmentRead, text: string, baseScore: number) => {
    if (seen.has(read.chunk_id)) {
      return;
    }
    seen.add(read.chunk_id);
    candidates.push({
      read,
      score: scoreAnswerContextRead(read, text, terms, baseScore),
      sequence
    });
    sequence += 1;
  };

  for (const fact of compact.facts) {
    const read = compactFactToFragmentRead(fact);

    if (isSourceOverviewFragmentRead(read)) {
      continue;
    }

    addCandidate(read, `${fact.title}\n${fact.text}`, 20);
  }

  for (const table of compact.tables) {
    addCandidate(compactTableToFragmentRead(table), `${table.title}\n${table.text}`, 24);
  }

  for (const read of compact.next_fragment_reads) {
    if (isSourceOverviewFragmentRead(read)) {
      continue;
    }

    addCandidate(read, `${read.title}\n${read.chunk_id}`, 8);
  }

  for (const read of handoffReads) {
    if (isSourceOverviewFragmentRead(read)) {
      continue;
    }

    addCandidate(read, `${read.title}\n${read.chunk_id}`, 6);
  }

  const hasQueryHit = candidates.some((candidate) => candidate.score >= 30);
  if (!hasQueryHit) {
    return handoffReads.filter((read) => !isSourceOverviewFragmentRead(read)).slice(0, limit);
  }

  const sortedCandidates = [...candidates].sort((left, right) => right.score - left.score || left.sequence - right.sequence);
  const selectedCandidates: Array<{ read: ContextCompactFragmentRead; score: number; sequence: number }> = [];
  const selectedChunkIds = new Set<string>();
  const seededSourceIds = new Set<string>();
  const seedLimit = Math.max(1, Math.min(limit, Math.ceil(limit / 2)));

  const selectCandidate = (candidate: { read: ContextCompactFragmentRead; score: number; sequence: number }) => {
    if (selectedCandidates.length >= limit || selectedChunkIds.has(candidate.read.chunk_id)) {
      return;
    }

    selectedCandidates.push(candidate);
    selectedChunkIds.add(candidate.read.chunk_id);
  };

  for (const candidate of [...candidates].sort((left, right) => left.sequence - right.sequence)) {
    if (selectedCandidates.length >= seedLimit) {
      break;
    }

    const sourceId = candidate.read.source_refs[0];
    if (!sourceId || seededSourceIds.has(sourceId)) {
      continue;
    }

    seededSourceIds.add(sourceId);
    selectCandidate(candidate);
  }

  for (const candidate of sortedCandidates) {
    selectCandidate(candidate);
    if (selectedCandidates.length >= limit) {
      break;
    }
  }

  return selectedCandidates.map((candidate) => candidate.read);
}

async function expandAnswerContextReads(
  packageRoot: string,
  reads: ContextCompactFragmentRead[],
  query: string,
  limit: number,
  candidateSourceIds: string[] = []
): Promise<ContextCompactFragmentRead[]> {
  const resolvableReads = reads.filter((read) => !isSourceOverviewFragmentRead(read));
  const expanded: ContextCompactFragmentRead[] = [];
  const seen = new Set<string>();
  const queryTerms = extractDirectQueryTerms(query);
  const scopedSourceIds = uniqueStrings(resolvableReads.flatMap((read) => inferSourceIdsForOverviewRead(read)));
  const dominantCandidateSourceIds = uniqueStrings([...scopedSourceIds, ...candidateSourceIds]);

  const pushRead = (read: ContextCompactFragmentRead) => {
    if (expanded.length >= limit || seen.has(read.chunk_id)) {
      return;
    }

    seen.add(read.chunk_id);
    expanded.push(read);
  };

  if (scopedSourceIds.length > 0 && queryTerms.length > 0) {
    const dominantSourceIds = await selectDominantAnswerContextSourceIds(packageRoot, dominantCandidateSourceIds, query);
    const targetedReads = await buildSourceScopedAnswerContextReadsForSourceIds(
      packageRoot,
      dominantSourceIds.length > 0 ? dominantSourceIds : scopedSourceIds,
      queryTerms,
      limit
    );

    for (const targetedRead of targetedReads) {
      pushRead(targetedRead);
    }

    if (dominantSourceIds.length > 0 && expanded.length > 0) {
      return expanded;
    }
  }

  for (const read of resolvableReads) {
    if (expanded.length >= limit) {
      break;
    }

    const targetedReads = isSourceOverviewFragmentRead(read)
      ? await buildSourceScopedAnswerContextReads(packageRoot, read, queryTerms, Math.max(1, limit - expanded.length))
      : [];

    if (targetedReads.length > 0) {
      for (const targetedRead of targetedReads) {
        pushRead(targetedRead);
      }
      continue;
    }

    pushRead(read);
  }

  return expanded;
}

async function selectDominantAnswerContextSourceIds(packageRoot: string, sourceIds: string[], query: string): Promise<string[]> {
  const uniqueSourceIds = uniqueStrings(sourceIds);
  if (uniqueSourceIds.length < 2) {
    return [];
  }

  const terms = extractAnswerContextAffinityTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const overviewMatches = await readQueryIndexSourceOverviewMatches(packageRoot, { limit: Math.max(64, uniqueSourceIds.length) });
  const overviewBySourceId = new Map<string, IndexedContextChunkMatch>();
  for (const overview of overviewMatches) {
    for (const sourceRef of overview.source_refs ?? []) {
      overviewBySourceId.set(sourceRef, overview);
    }
    if (overview.source_id) {
      overviewBySourceId.set(overview.source_id, overview);
    }
  }

  const sourceHaystacks = uniqueSourceIds.map((sourceId, sequence) => {
    const overview = overviewBySourceId.get(sourceId);
    return {
      sourceId,
      sequence,
      text: overview ? `${overview.title}\n${overview.text}\n${overview.source_id ?? ""}`.toLowerCase() : ""
    };
  });
  const explicitSourceId = selectExplicitAnswerContextSourceIdByLeadingScope(sourceHaystacks, query);
  if (explicitSourceId) {
    return [explicitSourceId];
  }

  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(
      term,
      sourceHaystacks.filter((source) => source.text.includes(term)).length
    );
  }
  const ranked = sourceHaystacks
    .map((source) => ({
      sourceId: source.sourceId,
      score: scoreAnswerContextSourceAffinity(source.text, terms, documentFrequency, uniqueSourceIds.length),
      sequence: source.sequence
    }))
    .sort((left, right) => right.score - left.score || left.sequence - right.sequence);

  const [first, second] = ranked;
  if (!first || first.score < 18) {
    return [];
  }

  if (second && first.score < second.score + 8) {
    return [];
  }

  return [first.sourceId];
}

function extractAnswerContextAffinityTerms(query: string): string[] {
  const terms = new Set<string>();
  const normalized = query.toLowerCase();
  const leadingScope = extractAnswerContextLeadingScope(normalized);
  const affinityText = leadingScope.length >= 2 ? leadingScope : normalized;

  for (const token of affinityText.match(/[a-z0-9_][a-z0-9_-]{1,}/giu) ?? []) {
    if (token.length >= 2) {
      terms.add(token);
    }
  }

  for (const run of affinityText.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length >= 2 && run.length <= 20) {
      terms.add(run);
    }
    const maxGram = Math.min(6, run.length);
    for (let size = maxGram; size >= 2; size -= 1) {
      for (let index = 0; index + size <= run.length; index += 1) {
        terms.add(run.slice(index, index + size));
        if (terms.size >= 96) {
          return [...terms];
        }
      }
    }
  }

  if (normalized.includes("年度报告")) {
    terms.add("annual_report");
  }
  if (normalized.includes("招募说明书")) {
    terms.add("prospectus");
  }

  return [...terms];
}

function extractAnswerContextLeadingScope(normalizedQuery: string): string {
  return (
    normalizedQuery
      .split(/(?:披露|分别|有哪些|是什么|是多少|多少|如何|怎么|请问|请|里|？|\?)/u)[0]
      ?.trim() || normalizedQuery
  );
}

function selectExplicitAnswerContextSourceIdByLeadingScope(
  sources: Array<{ sourceId: string; text: string }>,
  query: string
): string | undefined {
  const leadingScope = extractAnswerContextLeadingScope(query.toLowerCase());
  const terms = uniqueStrings([
    ...(leadingScope.match(/\p{Script=Han}{4,}/gu) ?? []),
    ...(leadingScope.match(/[a-z][a-z0-9_-]{3,}/giu) ?? []).filter((term) => !/^\d+$/.test(term)),
    ...(leadingScope.includes("年度报告") ? ["annual_report"] : []),
    ...(leadingScope.includes("招募说明书") ? ["prospectus"] : [])
  ]);

  if (terms.length === 0) {
    return undefined;
  }

  const ranked = sources
    .map((source, sequence) => {
      const score = terms.reduce((sum, term) => {
        if (!source.text.includes(term)) {
          return sum;
        }

        if (term === "annual_report" || term === "prospectus") {
          return sum + 18;
        }

        return sum + (/^\p{Script=Han}+$/u.test(term) ? Math.min(36, term.length * 6) : Math.min(12, term.length * 2));
      }, 0);

      return { sourceId: source.sourceId, score, sequence };
    })
    .sort((left, right) => right.score - left.score || left.sequence - right.sequence);

  const [first, second] = ranked;
  if (!first || first.score < 24) {
    return undefined;
  }

  if (second && first.score < second.score + 8) {
    return undefined;
  }

  return first.sourceId;
}

function scoreAnswerContextSourceAffinity(text: string, terms: string[], documentFrequency: Map<string, number>, sourceCount: number): number {
  const haystack = text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (!haystack.includes(term)) {
      continue;
    }

    const frequency = documentFrequency.get(term) ?? sourceCount;
    if (sourceCount > 3 && frequency > Math.max(2, Math.floor(sourceCount * 0.35))) {
      continue;
    }

    if (/^\p{Script=Han}+$/u.test(term)) {
      score += (term.length >= 5 ? 12 : term.length >= 3 ? 7 : 3) * answerContextAffinityRarityWeight(frequency, sourceCount);
    } else {
      score += (term.length >= 5 ? 8 : 4) * answerContextAffinityRarityWeight(frequency, sourceCount);
    }
  }

  return score;
}

function answerContextAffinityRarityWeight(documentFrequency: number, sourceCount: number): number {
  if (sourceCount <= 1) {
    return 1;
  }

  return Math.max(0.25, Math.log((sourceCount + 1) / Math.max(1, documentFrequency)));
}

async function buildSourceScopedAnswerContextReads(
  packageRoot: string,
  overviewRead: ContextCompactFragmentRead,
  queryTerms: string[],
  limit: number
): Promise<ContextCompactFragmentRead[]> {
  if (queryTerms.length === 0) {
    return [];
  }

  const sourceIds = inferSourceIdsForOverviewRead(overviewRead);
  if (sourceIds.length === 0) {
    return [];
  }

  return buildSourceScopedAnswerContextReadsForSourceIds(packageRoot, sourceIds, queryTerms, limit);
}

async function buildSourceScopedAnswerContextReadsForSourceIds(
  packageRoot: string,
  sourceIds: string[],
  queryTerms: string[],
  limit: number
): Promise<ContextCompactFragmentRead[]> {
  const selected: ContextCompactFragmentRead[] = [];
  const seen = new Set<string>();
  const sourceReadBuckets: ContextCompactFragmentRead[][] = [];

  for (const sourceId of sourceIds) {
    const matches = await readDirectQueryIndexMatches(packageRoot, {
      documentId: sourceId,
      includePageFurniture: false,
      limit: 200
    });
    const ranked = matches
      .filter(isAnswerContextDirectReadCandidate)
      .map((match) => ({ match, score: scoreDirectQueryMatch(match, queryTerms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return (left.match.read_order ?? Number.MAX_SAFE_INTEGER) - (right.match.read_order ?? Number.MAX_SAFE_INTEGER);
      });

    const matchByChunkId = new Map(matches.map((match) => [match.chunk_id, match]));
    const rankedWithContextWindow = expandRankedDirectMatchesWithContextWindow(
      ranked.map((item) => item.match),
      matchByChunkId,
      limit
    );
    const sourceReads: ContextCompactFragmentRead[] = [];

    for (const item of rankedWithContextWindow) {
      if (sourceReads.length >= limit) {
        break;
      }
      if (seen.has(item.chunk_id)) {
        continue;
      }

      seen.add(item.chunk_id);
      sourceReads.push({
        chunk_id: item.chunk_id,
        title: item.title,
        reason_cn:
          "answer-context 已按用户问题在同一 source 内二次定位，并补入阅读顺序相邻窗口，供外部 LLM 获取完整上下文后作答。",
        cli_command: `context resolve-source <package.insight> ${item.chunk_id} --format json`,
        mcp_tool: "open_insight_resolve_source",
        mcp_arguments: { target_id: item.chunk_id },
        expected_fragment_field: "normalized_source_fragment",
        source_mode_disclosure_required: true,
        source_refs: item.source_refs ?? [],
        lineage_refs: item.lineage_refs ?? [],
        parse_diagnostic_ids: item.parse_diagnostic_ids ?? [],
        source_map_refs: item.source_map_refs ?? []
      });
    }

    if (sourceReads.length > 0) {
      sourceReadBuckets.push(sourceReads);
    }
  }

  const maxBucketLength = Math.max(0, ...sourceReadBuckets.map((bucket) => bucket.length));
  for (let index = 0; index < maxBucketLength && selected.length < limit; index += 1) {
    for (const bucket of sourceReadBuckets) {
      if (selected.length >= limit) {
        break;
      }

      const read = bucket[index];
      if (read) {
        selected.push(read);
      }
    }
  }

  return selected;
}

function expandRankedDirectMatchesWithContextWindow(
  rankedMatches: IndexedContextChunkMatch[],
  matchByChunkId: Map<string, IndexedContextChunkMatch>,
  limit: number
): IndexedContextChunkMatch[] {
  if (limit <= 0) {
    return [];
  }

  const orderedMatches = [...matchByChunkId.values()]
    .filter(isAnswerContextDirectReadCandidate)
    .sort((left, right) => {
      const leftOrder = left.read_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.read_order ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.chunk_id.localeCompare(right.chunk_id);
    });
  const orderedIndexByChunkId = new Map(orderedMatches.map((match, index) => [match.chunk_id, index]));
  const candidates = new Map<
    string,
    { match: IndexedContextChunkMatch; score: number; sequence: number; readOrder: number }
  >();
  let sequence = 0;

  const addCandidate = (match: IndexedContextChunkMatch | undefined, score: number) => {
    if (!match || !isAnswerContextDirectReadCandidate(match)) {
      return;
    }

    const readOrder = match.read_order ?? Number.MAX_SAFE_INTEGER;
    const existing = candidates.get(match.chunk_id);
    if (!existing || score > existing.score) {
      candidates.set(match.chunk_id, {
        match,
        score,
        sequence: existing?.sequence ?? sequence,
        readOrder
      });
    }

    sequence += 1;
  };

  const addLinkedCandidate = (chunkId: string | undefined, score: number) => {
    if (!chunkId) {
      return;
    }

    addCandidate(matchByChunkId.get(chunkId), score);
  };

  const addOrderedWindow = (match: IndexedContextChunkMatch, rankIndex: number) => {
    const orderedIndex = orderedIndexByChunkId.get(match.chunk_id);
    if (orderedIndex === undefined) {
      addLinkedCandidate(match.prev_chunk_id, 94 - rankIndex * 10);
      addLinkedCandidate(match.next_chunk_id, 92 - rankIndex * 10);
      return;
    }

    const previousWindow = rankIndex === 0 ? 2 : 1;
    const nextWindow = rankIndex === 0 ? 4 : 2;

    for (let offset = 1; offset <= previousWindow; offset += 1) {
      addCandidate(orderedMatches[orderedIndex - offset], 96 - rankIndex * 10 - offset);
    }

    for (let offset = 1; offset <= nextWindow; offset += 1) {
      addCandidate(orderedMatches[orderedIndex + offset], 94 - rankIndex * 10 - offset);
    }

    addLinkedCandidate(match.prev_chunk_id, 93 - rankIndex * 10);
    addLinkedCandidate(match.next_chunk_id, 91 - rankIndex * 10);
  };

  const seedMatches = rankedMatches.slice(0, Math.min(rankedMatches.length, 2));
  const topTableMatch = rankedMatches.find((match) => match.chunk_level === "table" || match.content_role === "table");

  if (topTableMatch && !seedMatches.some((match) => match.chunk_id === topTableMatch.chunk_id)) {
    seedMatches.push(topTableMatch);
  }

  for (const [rankIndex, match] of seedMatches.entries()) {
    addCandidate(match, 120 - rankIndex * 12);
    addOrderedWindow(match, rankIndex);
  }

  for (const [rankIndex, match] of rankedMatches.slice(seedMatches.length, 6).entries()) {
    addCandidate(match, 70 - rankIndex);
  }

  for (const match of rankedMatches) {
    addCandidate(match, 40);
  }

  return [...candidates.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.sequence - right.sequence;
    })
    .slice(0, limit)
    .sort((left, right) => {
      if (left.readOrder !== right.readOrder) {
        return left.readOrder - right.readOrder;
      }

      return left.match.chunk_id.localeCompare(right.match.chunk_id);
    })
    .map((candidate) => candidate.match);
}

function isAnswerContextDirectReadCandidate(match: IndexedContextChunkMatch): boolean {
  return isDirectQuerySearchCandidate(match, { includePageFurniture: false }) && match.chunk_level !== "section";
}

function isSourceOverviewFragmentRead(read: ContextCompactFragmentRead): boolean {
  return (
    read.chunk_id.startsWith("source_overview.") ||
    read.source_refs.includes(read.chunk_id) ||
    (read.chunk_id.startsWith("source_") &&
      !read.chunk_id.startsWith("source_map_") &&
      !read.chunk_id.includes(".") &&
      !read.chunk_id.includes("::"))
  );
}

function inferSourceIdsForOverviewRead(read: ContextCompactFragmentRead): string[] {
  return uniqueStrings([
    ...(read.source_refs ?? []),
    ...(read.chunk_id.startsWith("source_") ? [read.chunk_id] : [])
  ]).filter((sourceId) => sourceId.startsWith("source_") && !sourceId.startsWith("source_map_"));
}

function compactFactToFragmentRead(fact: ContextCompactFact): ContextCompactFragmentRead {
  return {
    chunk_id: fact.chunk_id,
    title: fact.title,
    reason_cn: "补读 compact fact 对应的 normalized source 片段，用于把可答上下文交给外部 LLM。",
    cli_command: `context resolve-source <package.insight> ${fact.chunk_id} --format json`,
    mcp_tool: "open_insight_resolve_source",
    mcp_arguments: { target_id: fact.chunk_id },
    expected_fragment_field: "normalized_source_fragment",
    source_mode_disclosure_required: true,
    source_refs: fact.source_refs,
    lineage_refs: fact.lineage_refs,
    parse_diagnostic_ids: fact.parse_diagnostic_ids,
    source_map_refs: fact.source_map_refs
  };
}

function compactTableToFragmentRead(table: ContextCompactTable): ContextCompactFragmentRead {
  return {
    chunk_id: table.chunk_id,
    title: table.title,
    reason_cn: "补读 compact table 对应的 normalized source 片段，用于核对表格、字段和关键数字。",
    cli_command: `context resolve-source <package.insight> ${table.chunk_id} --format json`,
    mcp_tool: "open_insight_resolve_source",
    mcp_arguments: { target_id: table.chunk_id },
    expected_fragment_field: "normalized_source_fragment",
    source_mode_disclosure_required: true,
    source_refs: table.source_refs,
    lineage_refs: table.lineage_refs,
    parse_diagnostic_ids: table.parse_diagnostic_ids,
    source_map_refs: table.source_map_refs
  };
}

function scoreAnswerContextRead(read: ContextCompactFragmentRead, text: string, terms: string[], baseScore: number): number {
  const haystack = text.toLowerCase();
  const matchedTerms = terms.filter((term) => haystack.includes(term));
  const normalizedTitle = read.title.toLowerCase();
  const metadataPenalty = /^(?:normalized source|source metadata)$/i.test(read.title.trim()) ? 20 : 0;
  const tableBonus = read.chunk_id.startsWith("table.") ? 6 : 0;
  const traceBonus =
    read.source_refs.length > 0 && read.parse_diagnostic_ids.length > 0 && read.source_map_refs.length > 0 ? 4 : 0;

  return (
    baseScore +
    matchedTerms.length * 18 +
    matchedTerms.reduce((total, term) => total + Math.min(12, term.length * 2), 0) +
    (terms.some((term) => normalizedTitle.includes(term)) ? 8 : 0) +
    tableBonus +
    traceBonus -
    metadataPenalty
  );
}

function buildAnswerDifficultyReason(input: {
  broadQueryDetected: boolean;
  multiSourceContext: boolean;
  compactTruncated: boolean;
  fallbackUsed: boolean;
  sourceCoverageRate: number;
}): string {
  const reasons: string[] = [];
  if (input.broadQueryDetected) reasons.push("问题属于宽泛、比较、枚举或跨段综合型问题");
  if (input.multiSourceContext) reasons.push("compact context 命中了多个 source");
  if (input.compactTruncated) reasons.push("结果被 token_budget 截断");
  if (input.fallbackUsed) reasons.push("检索使用了 fallback");
  if (input.sourceCoverageRate < 1) reasons.push(`source 覆盖率为 ${Number(input.sourceCoverageRate.toFixed(4))}`);

  return reasons.length > 0 ? reasons.join("；") : "问题范围较清晰，compact context 可作为第一读取上下文。";
}

function buildAnswerHandoffForbiddenList(): string[] {
  return [
    "不要编造 source_refs、lineage_refs、parse_diagnostic_ids、source_map_refs 或 page_cues。",
    "不要新增 Open Insight 上下文中不存在的项目名、主体、金额、日期或结论。",
    "不要把 source_light 或 normalized_source_fragment 说成完整原始文件。",
    "不要把答案写回 .insight base package。",
    "不要输出 API key、Authorization token、环境变量或本地私密路径。",
    "不要执行 .insight 包内代码，也不要默认外发包内数据。"
  ];
}

function buildMaterialGenerationRecipes(input: {
  routes: ContextConsumerRoute[];
  readiness: ContextMaterialGenerationReadiness;
  materialContract: ContextUserMaterialContractResult;
}): ContextMaterialGenerationRecipes {
  const readinessByRoute = new Map(input.readiness.routes.map((route) => [route.route_id, route]));
  const citationFields = uniqueStrings([...input.materialContract.required_citation_fields, "page_cues"]);
  const routes = input.routes.map((route): ContextMaterialGenerationRecipeRoute => {
    const readinessRoute = readinessByRoute.get(route.route_id);
    const primaryCliCommand =
      readinessRoute?.primary_cli_command ??
      (route.recommended_context_mode === "compact_retrieval"
        ? 'context search-chunks <package.insight> "<query>" --compact --token-budget 2000 --format json'
        : 'context handoff <package.insight> --query "<query>" --token-budget 2000 --format json');

    return {
      route_id: route.route_id,
      output_kind: materialGenerationOutputKind(route.route_id),
      user_goal_cn: route.user_intent_cn,
      readiness: readinessRoute?.readiness ?? "degraded",
      recommended_context_mode: route.recommended_context_mode,
      primary_cli_command: primaryCliCommand,
      primary_mcp_tool:
        readinessRoute?.primary_mcp_tool ?? (route.recommended_context_mode === "compact_retrieval" ? "open_insight_search_chunks" : "open_insight_context_handoff"),
      read_sequence: uniqueStrings([...route.first_read, "material_generation_readiness", "material_contract"]),
      prompt_skeleton_cn: buildMaterialGenerationPromptSkeleton(route, citationFields),
      required_inputs: uniqueStrings(["compact_context", ...route.first_read, ...route.required_refs]),
      follow_up_read_plan: {
        cli_command_template: route.fragment_read_plan.cli_command_template,
        mcp_tool: route.fragment_read_plan.mcp_tool,
        expected_fragment_field: route.fragment_read_plan.expected_fragment_field,
        required_when_cn: route.fragment_read_plan.when_cn
      },
      required_citation_fields: citationFields,
      forbidden: buildMaterialGenerationForbiddenList(),
      output_contract: {
        output_boundary: route.output_boundary,
        base_package_mutation: false,
        model_required_by_open_insight: false,
        allowed_destination: "external_file"
      },
      validation_checklist_cn: buildMaterialGenerationValidationChecklist(route)
    };
  });

  return {
    schema_version: "open-insight.material-generation-recipes.v0.1",
    status: input.readiness.status,
    recipe_count: routes.length,
    routes,
    safety: {
      model_invoked: false,
      env_recorded: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    }
  };
}

function materialGenerationOutputKind(routeId: ContextConsumerRoute["route_id"]): ContextMaterialGenerationRecipeRoute["output_kind"] {
  if (routeId === "question_answering") return "qa";
  if (routeId === "html_restore") return "html";

  return routeId;
}

function buildMaterialGenerationPromptSkeleton(route: ContextConsumerRoute, citationFields: string[]): string {
  const citationInstruction = `每个事实性段落、表格或结论后保留 ${citationFields.join(" / ")}；引用只能来自 Open Insight handoff、compact_context 或 resolve-source 返回。`;
  const boundaryInstruction =
    "生成结果是外部用户材料，可以保存为 HTML、Word 大纲、PPT 大纲、问答记录或分析文档；不要写回 .insight base package。";

  if (route.route_id === "html_restore") {
    return [
      "任务：复现正式说明书、年报节选或长文 HTML，不是摘要。",
      "先读取 compact_context.page_cues 和 material_contract，再按章节调用 context resolve-source / open_insight_resolve_source 获取 bounded normalized_source_fragment。",
      "保持原文顺序、编号、标题层级、表格附近上下文和关键数字；表格无法确认时标注为待核对摘录，不要硬造表格。",
      citationInstruction,
      boundaryInstruction
    ].join("\n");
  }

  if (route.route_id === "ppt_outline") {
    return [
      "任务：生成 PPT 大纲或页面结构，不是完整报告正文。",
      "先使用 compact_context 的事实、关键数字、表格摘要和 page_cues，按页组织标题、要点、图表建议和引用。",
      "每页只放必要事实，避免把整篇 normalized source 塞进单页。",
      citationInstruction,
      boundaryInstruction
    ].join("\n");
  }

  if (route.route_id === "word_outline") {
    return [
      "任务：生成 Word 大纲、尽调备忘录或可编辑文档初稿。",
      "先用 compact_context 建结构，再对关键段落调用 resolve-source 补读 normalized_source_fragment。",
      "正文可以整理表达，但不能新增 compact_context 或补读片段之外的主体、金额、日期和结论。",
      citationInstruction,
      boundaryInstruction
    ].join("\n");
  }

  if (route.route_id === "analysis") {
    return [
      "任务：生成分析说明、风险梳理、核查清单或行动建议。",
      "优先使用 compact_context，按主题归并事实、关键数字、表格摘要和页码线索；必要时补读局部 normalized_source_fragment。",
      "区分原文事实、推理判断和待人工复核点。",
      citationInstruction,
      boundaryInstruction
    ].join("\n");
  }

  if (route.route_id === "audit_trace") {
    return [
      "任务：生成审计追源说明，不是客户阅读稿。",
      "读取 diagnostics、source map、parse diagnostics、page_cues 和 resolve-source 片段，逐项说明证据完整性、source_light 边界和待复核问题。",
      "审计字段可以详细展示，但不要混入正式阅读版正文。",
      citationInstruction,
      boundaryInstruction
    ].join("\n");
  }

  return [
    "任务：回答用户的具体问题。",
    "优先使用 compact_context；如果命中不足或需要核对原文，按 next_fragment_reads / fragment_read_plan 调用 resolve-source 补读局部片段。",
    "先给出直接回答，再列证据引用和待人工复核点。",
    citationInstruction,
    boundaryInstruction
  ].join("\n");
}

function buildMaterialGenerationForbiddenList(): string[] {
  return [
    "不要编造 source_refs、lineage_refs、parse_diagnostic_ids、source_map_refs 或 page_cues。",
    "不要新增 Open Insight 上下文中不存在的项目名、主体、金额、日期或结论。",
    "不要把 source_light 或 normalized_source_fragment 说成完整原始文件。",
    "不要把生成材料写回 base package。",
    "不要输出 API key、authorization token、环境变量或本地私密路径。",
    "不要执行 .insight 包内代码，也不要默认外发包内数据。"
  ];
}

function buildMaterialGenerationValidationChecklist(route: ContextConsumerRoute): string[] {
  return [
    "所有事实性输出都带 source_refs / lineage_refs / parse_diagnostic_ids / source_map_refs。",
    "page_cues 或 resolve-source 片段足以定位主要章节和关键数字。",
    "未知引用、未知项目名、未知金额或未知日期必须删除或标记为待复核。",
    "输出目的地是外部文件、overlay 或 derived package；base_package_mutation=false。",
    route.recommended_context_mode === "full_normalized_with_compact_index"
      ? "长文复现必须按章节补读 bounded normalized_source_fragment，不能只用摘要生成。"
      : "优先使用 compact context，只有必要时补读局部 normalized_source_fragment。"
  ];
}

function buildContextConsumerRoutes(): ContextConsumerRoute[] {
  const requiredRefs = ["source_refs", "lineage_refs", "parse_diagnostic_ids", "source_map_refs", "page_cues"];
  const outputBoundary = "external_file_or_overlay_or_derived_package" as const;
  const compactFragmentPlan = buildContextFragmentReadPlan({
    when_cn:
      "当 compact_context.coverage_hints.recommended_next_action 要求 read_normalized_source_fragment，或 facts/tables/page_cues 中的 chunk 需要核对原文时，按需补读局部片段。"
  });
  const restoreFragmentPlan = buildContextFragmentReadPlan({
    when_cn:
      "用于正式说明书、年报节选或长文 HTML 复现：先用 compact_context 和 page_cues 定位章节，再对待复现章节逐个调用 resolve-source 读取 normalized_source_fragment，不要一次性读取整份 normalized source。"
  });
  const auditFragmentPlan = buildContextFragmentReadPlan({
    when_cn:
      "用于审计追源：对每个被引用的 chunk_id、source_ref 或 evidence id 调用 resolve-source，保留局部片段、source_mode_disclosure_cn 和所有引用字段。"
  });

  return [
    {
      route_id: "question_answering",
      user_intent_cn: "回答一个具体问题，或围绕一个主题做追问。",
      recommended_context_mode: "compact_retrieval",
      token_policy_cn: "优先读取 compact_context；只有命中不足或 status=degraded 时再补读 full normalized source。",
      first_read: ["compact_context", "token_benchmark", "material_contract"],
      fragment_read_plan: compactFragmentPlan,
      required_refs: requiredRefs,
      output_boundary: outputBoundary,
      base_package_mutation: false
    },
    {
      route_id: "analysis",
      user_intent_cn: "生成分析说明、风险梳理、核查清单或行动建议。",
      recommended_context_mode: "compact_retrieval",
      token_policy_cn: "先用 compact_context 控制 token，再按 page_cues / resolve-source 补充少量原文位置。",
      first_read: ["compact_context", "token_eval", "context resolve-source"],
      fragment_read_plan: compactFragmentPlan,
      required_refs: requiredRefs,
      output_boundary: outputBoundary,
      base_package_mutation: false
    },
    {
      route_id: "html_restore",
      user_intent_cn: "复现正式说明书、年报节选或长文 HTML，尽量保持原文顺序和章节结构。",
      recommended_context_mode: "full_normalized_with_compact_index",
      token_policy_cn: "长文复现不能只读摘要；先用 compact_context 定位章节和表格，再通过 resolve-source 按需补读 normalized_source_fragment，避免整篇 normalized source 一次性进入模型上下文。",
      first_read: ["material_contract", "compact_context.page_cues", "context resolve-source", "normalized_source_fragment", "source_map"],
      fragment_read_plan: restoreFragmentPlan,
      required_refs: requiredRefs,
      output_boundary: outputBoundary,
      base_package_mutation: false
    },
    {
      route_id: "word_outline",
      user_intent_cn: "生成 Word 大纲、尽调备忘录或可编辑文档初稿。",
      recommended_context_mode: "compact_retrieval",
      token_policy_cn: "先用 compact_context 生成结构，再用 resolve-source 补足关键段落和数字。",
      first_read: ["compact_context", "material_contract", "context resolve-source"],
      fragment_read_plan: compactFragmentPlan,
      required_refs: requiredRefs,
      output_boundary: outputBoundary,
      base_package_mutation: false
    },
    {
      route_id: "ppt_outline",
      user_intent_cn: "生成 PPT 大纲、页面结构或汇报提纲。",
      recommended_context_mode: "compact_retrieval",
      token_policy_cn: "只把每页必要事实、数字和引用交给模型，避免整篇原文进入 PPT 生成上下文。",
      first_read: ["compact_context", "key_numbers", "tables", "page_cues"],
      fragment_read_plan: compactFragmentPlan,
      required_refs: requiredRefs,
      output_boundary: outputBoundary,
      base_package_mutation: false
    },
    {
      route_id: "audit_trace",
      user_intent_cn: "审计追源、检查解析质量、确认 source_light 证据边界。",
      recommended_context_mode: "audit_trace",
      token_policy_cn: "优先读取 diagnostics、source map、parse diagnostics 和 resolve-source；不要把审计字段直接塞进客户阅读稿。",
      first_read: ["context diagnostics", "context resolve-source", "parse_diagnostics", "source_map"],
      fragment_read_plan: auditFragmentPlan,
      required_refs: requiredRefs,
      output_boundary: outputBoundary,
      base_package_mutation: false
    }
  ];
}

function buildMaterialGenerationReadiness(input: {
  routes: ContextConsumerRoute[];
  query: string;
  tokenBudget: number;
  compact: ContextCompactRetrievalResult;
  tokenEval: ContextTokenEvalResult;
  tokenBenchmark: ContextTokenBenchmarkSummary;
  materialContract: ContextUserMaterialContractResult;
}): ContextMaterialGenerationReadiness {
  const requiredRefsPresent = {
    source_refs: input.compact.source_refs.length > 0 || (input.materialContract.source_refs ?? []).length > 0,
    lineage_refs: input.compact.lineage_refs.length > 0 || (input.materialContract.lineage_refs ?? []).length > 0,
    parse_diagnostic_ids:
      input.compact.parse_diagnostic_ids.length > 0 || (input.materialContract.parse_diagnostic_ids ?? []).length > 0,
    source_map_refs: input.compact.source_map_refs.length > 0 || (input.materialContract.source_map_refs ?? []).length > 0,
    page_cues: input.compact.page_cues.length > 0
  };

  const routes = input.routes.map((route): ContextMaterialGenerationReadinessRoute => {
    const missingRefs = route.required_refs.filter((ref) => {
      if (ref === "source_refs") return !requiredRefsPresent.source_refs;
      if (ref === "lineage_refs") return !requiredRefsPresent.lineage_refs;
      if (ref === "parse_diagnostic_ids") return !requiredRefsPresent.parse_diagnostic_ids;
      if (ref === "source_map_refs") return !requiredRefsPresent.source_map_refs;
      if (ref === "page_cues") return !requiredRefsPresent.page_cues;
      return true;
    });
    const needsFragmentReads =
      route.recommended_context_mode === "full_normalized_with_compact_index" || route.recommended_context_mode === "audit_trace";
    const compactTokenDeliveryDegraded =
      route.recommended_context_mode === "compact_retrieval" && input.tokenEval.status === "degraded";
    const readiness =
      missingRefs.length > 0 || compactTokenDeliveryDegraded
        ? "degraded"
        : needsFragmentReads
          ? "needs_fragment_reads"
          : "ready";
    const readinessReasonCn = buildMaterialGenerationReadinessReason({
      route,
      readiness,
      missingRefs,
      compactTokenDeliveryDegraded
    });
    const useHandoffAsPrimary = route.recommended_context_mode !== "compact_retrieval";

    return {
      route_id: route.route_id,
      user_intent_cn: route.user_intent_cn,
      readiness,
      readiness_reason_cn: readinessReasonCn,
      recommended_context_mode: route.recommended_context_mode,
      primary_cli_command: useHandoffAsPrimary
        ? `context handoff <package.insight> --query "${input.query}" --token-budget ${input.tokenBudget} --format json`
        : `context search-chunks <package.insight> "${input.query}" --compact --token-budget ${input.tokenBudget} --format json`,
      primary_mcp_tool: useHandoffAsPrimary ? "open_insight_context_handoff" : "open_insight_search_chunks",
      primary_mcp_arguments: useHandoffAsPrimary
        ? { query: input.query, token_budget: input.tokenBudget }
        : { query: input.query, compact: true, token_budget: input.tokenBudget },
      follow_up_cli_command_template: route.fragment_read_plan.cli_command_template,
      follow_up_mcp_tool: route.fragment_read_plan.mcp_tool,
      required_refs: route.required_refs,
      required_refs_present: requiredRefsPresent,
      missing_refs: missingRefs,
      token_strategy: {
        recommended_context_mode: route.recommended_context_mode,
        token_count_is_estimated: true,
        estimated_compact_tokens: input.compact.estimated_tokens,
        token_budget: input.tokenBudget,
        savings_vs_direct: input.tokenEval.savings_vs_direct,
        savings_vs_normalized: input.tokenBenchmark.savings_vs_normalized,
        recommended_mode: input.tokenBenchmark.recommended_mode
      },
      output_boundary: route.output_boundary,
      base_package_mutation: false,
      model_required_by_open_insight: false,
      user_action_cn: buildMaterialGenerationUserAction(route, readiness, {
        compactTokenDeliveryDegraded
      })
    };
  });

  const readyCount = routes.filter((route) => route.readiness === "ready").length;
  const needsFragmentReadsCount = routes.filter((route) => route.readiness === "needs_fragment_reads").length;
  const degradedCount = routes.filter((route) => route.readiness === "degraded").length;

  return {
    schema_version: "open-insight.material-generation-readiness.v0.1",
    status: degradedCount === 0 ? "ready" : "degraded",
    summary: {
      route_count: routes.length,
      ready_count: readyCount,
      needs_fragment_reads_count: needsFragmentReadsCount,
      degraded_count: degradedCount
    },
    routes,
    safety: {
      model_invoked: false,
      env_recorded: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    }
  };
}

function buildMaterialGenerationReadinessReason(input: {
  route: ContextConsumerRoute;
  readiness: ContextMaterialGenerationReadinessRoute["readiness"];
  missingRefs: string[];
  compactTokenDeliveryDegraded: boolean;
}): string {
  if (input.missingRefs.length > 0) {
    return `当前路线缺少必要引用字段：${input.missingRefs.join(", ")}。外部 LLM 不能直接生成可信材料。`;
  }
  if (input.compactTokenDeliveryDegraded) {
    return "当前 token eval 已降级，compact context 不足以直接支撑该材料路线。";
  }
  if (input.readiness === "needs_fragment_reads") {
    return input.route.route_id === "audit_trace"
      ? "该路线用于审计追源，需要按 fragment_read_plan 继续补读 diagnostics、source map 和 bounded normalized_source_fragment。"
      : "该路线用于长文复现，需要按 fragment_read_plan 补读 bounded normalized_source_fragment 后再生成材料。";
  }
  return "必要引用和 token 评测均满足 compact context 交接条件，可先交给外部 LLM 生成材料骨架。";
}

function buildMaterialGenerationUserAction(
  route: ContextConsumerRoute,
  readiness: ContextMaterialGenerationReadinessRoute["readiness"],
  options: { compactTokenDeliveryDegraded?: boolean } = {}
): string {
  if (readiness === "degraded") {
    if (options.compactTokenDeliveryDegraded) {
      return "当前 token eval 已降级；外部 LLM 应提高 token_budget、调整 query，或按 fragment_read_plan 调用 resolve-source 补读局部原文后再生成材料。";
    }
    return "当前路线缺少必要引用字段；外部 LLM 应先调整 query 或读取 diagnostics，不能直接生成可信材料。";
  }
  if (readiness === "needs_fragment_reads") {
    return route.route_id === "audit_trace"
      ? "先读取 handoff 和 diagnostics，再对被引用对象逐个调用 resolve-source 做审计追源。"
      : "先用 compact context 和 page_cues 定位章节，再按 chunk 调用 resolve-source 读取 bounded normalized_source_fragment。";
  }
  return "先把 compact context 交给外部 LLM 生成材料骨架；如需核对关键事实，再按 chunk 调用 resolve-source。";
}

function buildContextFragmentReadPlan(input: { when_cn: string }): ContextFragmentReadPlan {
  return {
    mode: "on_demand_resolve_source",
    when_cn: input.when_cn,
    cli_command_template: "context resolve-source <package.insight> <chunk-id> --format json",
    mcp_tool: "open_insight_resolve_source",
    chunk_id_sources: ["compact_context.facts[].chunk_id", "compact_context.tables[].chunk_id", "compact_context.page_cues[].chunk_id"],
    expected_fragment_field: "normalized_source_fragment",
    required_fields: ["source_refs", "lineage_refs", "parse_diagnostic_ids", "source_map_refs"],
    source_mode_disclosure_required: true,
    max_fragment_policy_cn: "每次只读取目标 chunk 的 bounded normalized_source_fragment；如仍不够，再追加相邻 chunk，不能默认读取整份 normalized source。"
  };
}

function buildContextTokenBenchmarkSummary(tokenEval: ContextTokenEvalResult): ContextTokenBenchmarkSummary {
  const directTokens = tokenEval.direct_full_text.estimated_tokens;
  const normalizedTokens = tokenEval.insight_full_normalized.estimated_tokens;
  const compactTokens = tokenEval.insight_compact_retrieval.estimated_tokens;
  const directFullTextLabel =
    tokenEval.direct_full_text_basis === EXTERNAL_BASELINE_BASIS ? "external baseline files" : "normalized source 替身";
  const externalBaselineQuality =
    tokenEval.direct_full_text.baseline_quality &&
    tokenEval.direct_full_text.recommended_baseline_action_cn &&
    tokenEval.direct_full_text.estimation_methods
      ? {
          baseline_quality: tokenEval.direct_full_text.baseline_quality,
          recommended_baseline_action_cn: tokenEval.direct_full_text.recommended_baseline_action_cn,
          estimation_methods: tokenEval.direct_full_text.estimation_methods
        }
      : undefined;
  const savingsVsNormalized = Number(Math.max(0, Math.min(1, 1 - safeRatio(compactTokens, normalizedTokens))).toFixed(4));
  const status =
    tokenEval.status === "completed" &&
    tokenEval.savings_vs_direct >= 0.7 &&
    savingsVsNormalized >= 0.7 &&
    tokenEval.noise_reduction_rate >= 0.7 &&
    tokenEval.source_ref_coverage_rate === 1 &&
    tokenEval.parse_diagnostic_coverage_rate === 1 &&
    (tokenEval.table_context_coverage.applicability !== "required" ||
      tokenEval.table_context_coverage.required_candidate_coverage_rate === 1)
      ? "pass"
      : "degraded";

  return {
    schema_version: "open-insight.token-benchmark-summary.v0.1",
    status,
    measurement_mode: "deterministic_estimate",
    noise_measurement_mode: tokenEval.noise_metrics.measurement_mode,
    token_count_is_estimated: true,
    direct_full_text_basis: tokenEval.direct_full_text_basis,
    baseline_disclosure_cn: tokenEval.baseline_disclosure_cn,
    ...(externalBaselineQuality ?? {}),
    direct_full_text_estimated_tokens: directTokens,
    insight_full_normalized_estimated_tokens: normalizedTokens,
    insight_compact_estimated_tokens: compactTokens,
    savings_vs_direct: tokenEval.savings_vs_direct,
    savings_vs_normalized: savingsVsNormalized,
    noise_reduction_rate: tokenEval.noise_reduction_rate,
    source_ref_coverage_rate: tokenEval.source_ref_coverage_rate,
    parse_diagnostic_coverage_rate: tokenEval.parse_diagnostic_coverage_rate,
    numeric_preservation_rate: tokenEval.numeric_preservation_rate,
    table_context_coverage_rate: tokenEval.table_context_coverage_rate,
    recommended_mode: tokenEval.recommended_mode,
    user_facing_summary_cn: `按 ${directFullTextLabel} 估算的全文读取约 ${directTokens} estimated tokens，读取 .insight normalized source 约 ${normalizedTokens} estimated tokens，读取 compact context 约 ${compactTokens} estimated tokens；相对全文基准节省 ${Math.round(
      tokenEval.savings_vs_direct * 100
    )}%，相对 normalized source 节省 ${Math.round(savingsVsNormalized * 100)}%。`,
    external_llm_instruction_cn:
      "优先读取 compact context，再按需调用 resolve-source 追源；direct_full_text 的 basis 会说明当前基准是 normalized source surrogate 还是 CLI 指定的 external baseline files，token 数是 Open Insight 的 deterministic estimate，不是模型计费结果。"
  };
}

async function trySearchSqliteQueryIndex(
  packageRoot: string,
  query: string,
  options: SearchContextChunksOptions
): Promise<{ matches: IndexedContextChunkMatch[] } | undefined> {
  const manifest = await readQueryIndexManifest(packageRoot);
  const databasePath = readStringField(manifest?.database_path) ?? "query_index/index.sqlite";
  const ftsExpression = buildFtsExpression(query);

  if (!manifest || !ftsExpression) {
    return undefined;
  }

  let databaseBytes: Buffer;

  try {
    databaseBytes = await readFile(path.join(packageRoot, databasePath));
  } catch {
    return undefined;
  }

  try {
    const sqlJs = await loadSqlJs();
    const db = new sqlJs.Database(databaseBytes);

    try {
      const supportsContentRole = sqliteTableHasColumn(db, "context_chunks", "content_role");
      const supportsChunkLevel = sqliteTableHasColumn(db, "context_chunks", "chunk_level");
      const supportsEstimatedTokens = sqliteTableHasColumn(db, "context_chunks", "estimated_tokens");
      const supportsReadOrder = sqliteTableHasColumn(db, "context_chunks", "read_order");
      const supportsPrevNext = sqliteTableHasColumn(db, "context_chunks", "prev_chunk_id") && sqliteTableHasColumn(db, "context_chunks", "next_chunk_id");
      const supportsParent = sqliteTableHasColumn(db, "context_chunks", "parent_chunk_id");
      const capabilities = {
        supportsContentRole,
        supportsChunkLevel,
        supportsEstimatedTokens,
        supportsReadOrder,
        supportsPrevNext,
        supportsParent
      };
      const hasAnyRawFtsMatch = hasAnySqliteFtsMatch(db, ftsExpression, options);
      const fineGrainedMatches = supportsChunkLevel
        ? querySqliteChunks(db, ftsExpression, databasePath, options, {
            ...capabilities,
            excludeDocumentChunks: true
          })
        : [];
      const compactTableMatches =
        options.compact === true && (supportsChunkLevel || supportsContentRole)
          ? querySqliteChunks(db, ftsExpression, databasePath, options, {
              ...capabilities,
              excludeDocumentChunks: true,
              onlyTableChunks: true
            })
          : [];
      const compactMatches = uniqueContextChunkMatches([...fineGrainedMatches, ...compactTableMatches]);
      const compactWindowMatches =
        options.compact === true && compactMatches.length > 0
          ? diversifyContextChunkMatchesBySource(
              uniqueContextChunkMatches([...compactMatches, ...querySqliteContextWindowMatches(db, compactMatches, databasePath, options, {
                supportsContentRole,
                supportsChunkLevel,
                supportsEstimatedTokens,
                supportsReadOrder,
                supportsPrevNext,
                supportsParent
              })]),
              Math.max(1, options.limit ?? 24),
              { prioritizeCompactContext: true }
            )
          : compactMatches;
      const totalSourceCount = countSqliteContextSources(db, options);
      const compactWindowSourceCoverage = countContextMatchSources(compactWindowMatches);
      const broadCompactQuery = options.compact === true && isBroadContextRetrievalQuery(query);
      const sourceInventoryCompactQuery = options.compact === true && shouldUseSourceOverviewSearchQuery(query);
      const broadCoverageTarget =
        broadCompactQuery && totalSourceCount > 1 ? Math.min(totalSourceCount, Math.max(2, Math.min(options.limit ?? 24, totalSourceCount))) : 1;
      const shouldBroadenWeakCompactMatches =
        options.compact === true &&
        broadCompactQuery &&
        totalSourceCount > 1 &&
        compactWindowMatches.length > 0 &&
        compactWindowSourceCoverage < broadCoverageTarget;

      if (
        options.compact === true &&
        ((compactWindowMatches.length === 0 && !hasAnyRawFtsMatch) || shouldBroadenWeakCompactMatches || (sourceInventoryCompactQuery && totalSourceCount > 1))
      ) {
        if (sourceInventoryCompactQuery && totalSourceCount > 1) {
          return {
            matches: querySqliteSourceOverviewMatches(db, query, databasePath, options, {
              ...capabilities
            })
          };
        }

        const substringMatches = querySqliteSubstringMatches(db, query, databasePath, options, {
          ...capabilities,
          excludeDocumentChunks: true
        });
        const substringWindowMatches =
          substringMatches.length > 0
            ? diversifyContextChunkMatchesBySource(
                uniqueContextChunkMatches([...substringMatches, ...querySqliteContextWindowMatches(db, substringMatches, databasePath, options, {
                  ...capabilities
                })]),
                Math.max(1, options.limit ?? 24),
                { prioritizeCompactContext: true }
            )
            : [];
        const substringWindowSourceCoverage = countContextMatchSources(substringWindowMatches);
        const substringHasEnoughBroadCoverage =
          !broadCompactQuery || totalSourceCount <= 1 || substringWindowSourceCoverage >= broadCoverageTarget;

        if (
          substringWindowMatches.length > 0 &&
          substringHasEnoughBroadCoverage &&
          (!shouldBroadenWeakCompactMatches || substringWindowSourceCoverage > compactWindowSourceCoverage)
        ) {
          return { matches: substringWindowMatches };
        }

        return {
          matches: querySqliteSourceOverviewMatches(db, query, databasePath, options, {
            ...capabilities
          })
        };
      }

      return {
        matches:
          compactWindowMatches.length > 0
            ? compactWindowMatches
            : querySqliteChunks(db, ftsExpression, databasePath, options, {
                ...capabilities,
                excludeDocumentChunks: false
              })
      };
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function readQueryIndexManifest(packageRoot: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(packageRoot, "query_index/manifest.json"), "utf8"));

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function readQueryIndexSourceOverviewMatches(
  packageRoot: string,
  options: SearchContextChunksOptions
): Promise<IndexedContextChunkMatch[]> {
  const manifest = await readQueryIndexManifest(packageRoot);
  const directIndexPath = normalizeQueryIndexRelativePath(readStringField(manifest?.direct_index_path) ?? "query_index/chunks.jsonl");

  if (!directIndexPath) {
    return [];
  }

  let text: string;

  try {
    text = await readFile(path.join(packageRoot, directIndexPath), "utf8");
  } catch {
    return [];
  }

  const limit = Math.max(1, Math.min(options.limit ?? 24, 64));
  const matches: IndexedContextChunkMatch[] = [];

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    let record: Record<string, unknown>;

    try {
      const parsed = JSON.parse(trimmed);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }

      record = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    const contentRole = normalizeIndexedContentRole(record.content_role);
    const chunkLevel = normalizeIndexedChunkLevel(record.chunk_level);

    if (contentRole !== "source_overview" && chunkLevel !== "source_overview") {
      continue;
    }

    const sourceRefs = parseStringArrayField(record.source_refs);
    const sourceId = readStringField(record.source_id) ?? sourceRefs[0];

    if (!matchesDocumentScope(sourceId, sourceRefs, options)) {
      continue;
    }

    const textValue = readStringField(record.text) ?? "";
    const chunkId = readStringField(record.chunk_id) ?? `source_overview.${sourceId ?? index + 1}`;
    const estimatedTokens =
      typeof record.estimated_tokens === "number" && Number.isFinite(record.estimated_tokens)
        ? Math.max(1, Math.floor(record.estimated_tokens))
        : estimateContextTokens(textValue);
    const renderPolicy = readStringField(record.render_policy);
    const pageFurnitureKind = readStringField(record.page_furniture_kind);
    const normalizedSourcePath = readStringField(record.normalized_source_path);
    const prevChunkId = readStringField(record.prev_chunk_id);
    const nextChunkId = readStringField(record.next_chunk_id);
    const parentChunkId = readStringField(record.parent_chunk_id);

    matches.push({
      chunk_id: chunkId,
      kind: "chunk",
      title: readStringField(record.title) ?? readStringField(record.normalized_source_path) ?? chunkId,
      text: textValue,
      score: Math.max(1, limit - matches.length),
      evidence_ids: [],
      object_id: chunkId,
      content_role: contentRole,
      chunk_level: chunkLevel,
      heading_path: parseStringArrayField(record.heading_path),
      estimated_tokens: estimatedTokens,
      ...(renderPolicy ? { render_policy: renderPolicy } : {}),
      ...(pageFurnitureKind ? { page_furniture_kind: pageFurnitureKind } : {}),
      ...(typeof record.page_number === "number" && Number.isFinite(record.page_number) ? { page_number: record.page_number } : {}),
      line_numbers: parseNumberArrayField(record.line_numbers),
      retrieval_source: "query_index_source_overview",
      index_path: directIndexPath,
      ...(sourceId ? { source_id: sourceId } : {}),
      ...(normalizedSourcePath ? { normalized_source_path: normalizedSourcePath } : {}),
      ...(typeof record.read_order === "number" && Number.isFinite(record.read_order) ? { read_order: record.read_order } : {}),
      ...(prevChunkId ? { prev_chunk_id: prevChunkId } : {}),
      ...(nextChunkId ? { next_chunk_id: nextChunkId } : {}),
      ...(parentChunkId ? { parent_chunk_id: parentChunkId } : {}),
      source_refs: sourceRefs,
      lineage_refs: parseStringArrayField(record.lineage_refs),
      parse_diagnostic_ids: parseStringArrayField(record.parse_diagnostic_ids),
      source_map_refs: parseStringArrayField(record.source_map_refs),
      fallback_reason: "source_inventory_query_source_overview"
    });

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

async function readDirectQueryIndexMatches(
  packageRoot: string,
  options: SearchContextChunksOptions
): Promise<IndexedContextChunkMatch[]> {
  const manifest = await readQueryIndexManifest(packageRoot);
  const directIndexPath = normalizeQueryIndexRelativePath(readStringField(manifest?.direct_index_path) ?? "query_index/chunks.jsonl");

  if (!directIndexPath) {
    return [];
  }

  let text: string;

  try {
    text = await readFile(path.join(packageRoot, directIndexPath), "utf8");
  } catch {
    return [];
  }

  const matches: IndexedContextChunkMatch[] = [];

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    let record: Record<string, unknown>;

    try {
      const parsed = JSON.parse(trimmed);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }

      record = parsed as Record<string, unknown>;
    } catch {
      continue;
    }

    const match = buildDirectQueryIndexMatch(record, index, directIndexPath);

    if (!match) {
      continue;
    }

    if (!matchesDocumentScope(match.source_id, match.source_refs, options)) {
      continue;
    }

    matches.push(match);
  }

  return matches;
}

function buildDirectQueryIndexMatch(
  record: Record<string, unknown>,
  index: number,
  directIndexPath: string
): IndexedContextChunkMatch | undefined {
  const text = readStringField(record.text) ?? "";
  const sourceRefs = parseStringArrayField(record.source_refs);
  const sourceId = readStringField(record.source_id) ?? sourceRefs[0];
  const chunkId = readStringField(record.chunk_id) ?? `query_index.chunk_${index + 1}`;

  if (!chunkId || !text) {
    return undefined;
  }

  const estimatedTokens =
    typeof record.estimated_tokens === "number" && Number.isFinite(record.estimated_tokens)
      ? Math.max(1, Math.floor(record.estimated_tokens))
      : estimateContextTokens(text);
  const renderPolicy = readStringField(record.render_policy);
  const pageFurnitureKind = readStringField(record.page_furniture_kind);
  const normalizedSourcePath = readStringField(record.normalized_source_path);
  const prevChunkId = readStringField(record.prev_chunk_id);
  const nextChunkId = readStringField(record.next_chunk_id);
  const parentChunkId = readStringField(record.parent_chunk_id);

  return {
    chunk_id: chunkId,
    kind: "chunk",
    title: readStringField(record.title) ?? readStringField(record.normalized_source_path) ?? chunkId,
    text,
    score: 0,
    evidence_ids: [],
    object_id: chunkId,
    content_role: normalizeIndexedContentRole(record.content_role),
    chunk_level: normalizeIndexedChunkLevel(record.chunk_level),
    heading_path: parseStringArrayField(record.heading_path),
    estimated_tokens: estimatedTokens,
    ...(renderPolicy ? { render_policy: renderPolicy } : {}),
    ...(pageFurnitureKind ? { page_furniture_kind: pageFurnitureKind } : {}),
    ...(typeof record.page_number === "number" && Number.isFinite(record.page_number) ? { page_number: record.page_number } : {}),
    line_numbers: parseNumberArrayField(record.line_numbers),
    retrieval_source: "query_index_substring",
    index_path: directIndexPath,
    ...(sourceId ? { source_id: sourceId } : {}),
    ...(normalizedSourcePath ? { normalized_source_path: normalizedSourcePath } : {}),
    ...(typeof record.read_order === "number" && Number.isFinite(record.read_order) ? { read_order: record.read_order } : {}),
    ...(prevChunkId ? { prev_chunk_id: prevChunkId } : {}),
    ...(nextChunkId ? { next_chunk_id: nextChunkId } : {}),
    ...(parentChunkId ? { parent_chunk_id: parentChunkId } : {}),
    source_refs: sourceRefs,
    lineage_refs: parseStringArrayField(record.lineage_refs),
    parse_diagnostic_ids: parseStringArrayField(record.parse_diagnostic_ids),
    source_map_refs: parseStringArrayField(record.source_map_refs)
  };
}

function isDirectQuerySearchCandidate(match: IndexedContextChunkMatch, options: SearchContextChunksOptions): boolean {
  if (match.chunk_level === "document" || match.chunk_level === "page_furniture" || match.content_role === "page_furniture") {
    return false;
  }

  if (match.content_role === "disclaimer" && options.includePageFurniture !== true) {
    return false;
  }

  if (match.chunk_level === "source_overview" || match.content_role === "source_overview") {
    return false;
  }

  if (isMetadataOnlyParserFallbackMatch(match)) {
    return false;
  }

  return match.text.trim().length > 0;
}

function isMetadataOnlyParserFallbackMatch(match: ContextChunkMatch): boolean {
  const text = match.text.toLowerCase();

  return (
    text.includes("metadata-only normalized source") ||
    text.includes("markitdown 本地 parser 未能") ||
    text.includes("parser 未能在 auto 模式下解析") ||
    text.includes("只保留 metadata-only")
  );
}

function scoreDirectQueryMatch(match: IndexedContextChunkMatch, terms: string[]): number {
  const text = match.text.toLowerCase();
  const title = match.title.toLowerCase();
  const heading = (match.heading_path ?? []).join(" ").toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (text.includes(term)) {
      score += term.length >= 3 ? 8 : 4;
    }
    if (title.includes(term)) {
      score += term.length >= 3 ? 5 : 2;
    }
    if (heading.includes(term)) {
      score += term.length >= 3 ? 5 : 2;
    }
  }

  if (match.chunk_level === "paragraph") {
    score += 3;
  } else if (match.chunk_level === "table") {
    score += 2;
  } else if (match.chunk_level === "section") {
    score += 1;
  }

  return score;
}

function extractDirectQueryTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/[，。！？、；：;,.!?()[\]{}<>《》“”"'`~|/\\\r\n\t]+/gu, " ")
    .trim();
  const terms: string[] = [];
  const pushTerm = (term: string) => {
    const cleaned = term.trim().toLowerCase();

    if (cleaned.length < 2 || isDirectQueryStopword(cleaned)) {
      return;
    }

    terms.push(cleaned);
  };

  for (const token of normalized.match(/[a-z0-9_][a-z0-9_-]{1,}/giu) ?? []) {
    pushTerm(token);
  }

  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    for (const fragment of splitDirectQueryRun(run)) {
      pushTerm(fragment);

      for (const subFragment of splitDirectQuerySemanticFragment(fragment)) {
        pushTerm(subFragment);
      }
    }

    if (run.length >= 2 && run.length <= 8) {
      pushTerm(run);
    }
  }

  return uniqueStrings(terms).slice(0, 24);
}

function splitDirectQueryRun(run: string): string[] {
  return run
    .split(
      /(?:以及|还有|分别是|分别|哪些|有什么|是什么|是否|有没有|请|列出|对应|这批|这些|文件|材料|报告|年度报告|文档|资料|是谁|主要|多少|如何|情况|信息|内容|一共|可以|能够|需要|说明|总结|分析|相关|一个|和|与|及|或)/u
    )
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function splitDirectQuerySemanticFragment(fragment: string): string[] {
  return fragment
    .split(/(?:的|里|内|中|上|下|通过|取得|披露|显示|包括|关于|对于|按照|根据|基于|作为|为|是|由|把|将|被|对|在|从|到|给|向)/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function isDirectQueryStopword(term: string): boolean {
  return new Set([
    "这个",
    "那个",
    "这些",
    "这批",
    "分别",
    "哪些",
    "什么",
    "是否",
    "有没有",
    "请",
    "列出",
    "对应",
    "文件",
    "材料",
    "报告",
    "年度报告",
    "文档",
    "资料",
    "是谁",
    "主要",
    "多少",
    "如何",
    "情况",
    "信息",
    "内容",
    "一共",
    "可以",
    "能够",
    "需要",
    "说明",
    "总结",
    "分析",
    "相关",
    "一个",
    "overview",
    "inventory",
    "question",
    "comparison",
    "source",
    "sources",
    "file",
    "files",
    "document",
    "documents"
  ]).has(term);
}

function normalizeQueryIndexRelativePath(value: string | undefined): string | undefined {
  const normalized = (value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");

  if (
    !normalized ||
    !normalized.startsWith("query_index/") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  return normalized;
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  const sqlJsModule = await import("sql.js");
  const initSqlJs = ((sqlJsModule as { default?: InitSqlJs }).default ?? (sqlJsModule as unknown as InitSqlJs)) as InitSqlJs;

  return initSqlJs();
}

function hasAnySqliteFtsMatch(db: SqlJsDatabase, ftsExpression: string, options: SearchContextChunksOptions): boolean {
  const documentFilter = sqliteDocumentScopeFilter("c.source_id", options);
  const statement = db.prepare(`
    SELECT 1 AS matched
    FROM context_chunks_fts
    JOIN context_chunks c ON c.chunk_id = context_chunks_fts.chunk_id
    WHERE context_chunks_fts MATCH ?
    ${documentFilter}
    LIMIT 1;
  `);

  try {
    statement.bind([ftsExpression, ...getDocumentIds(options)]);

    return statement.step();
  } finally {
    statement.free();
  }
}

function querySqliteChunks(
  db: SqlJsDatabase,
  ftsExpression: string,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities
): IndexedContextChunkMatch[] {
  const limit = Math.max(1, options.limit ?? 5);
  const documentFilter = sqliteDocumentScopeFilter("c.source_id", options);
  const pageFurnitureFilter =
    capabilities.supportsContentRole && options.includePageFurniture !== true
      ? "AND c.content_role NOT IN ('page_furniture', 'disclaimer')"
      : "";
  const documentChunkFilter =
    capabilities.supportsChunkLevel && capabilities.excludeDocumentChunks ? "AND c.chunk_level != 'document'" : "";
  const tableChunkFilter =
    capabilities.onlyTableChunks === true && (capabilities.supportsChunkLevel || capabilities.supportsContentRole)
      ? `AND (${capabilities.supportsChunkLevel ? "c.chunk_level = 'table'" : "0"} OR ${capabilities.supportsContentRole ? "c.content_role = 'table'" : "0"})`
      : "";
  const roleSelect = capabilities.supportsContentRole
    ? "c.content_role, c.render_policy, c.page_furniture_kind, c.page_number, c.line_numbers_json,"
    : "'body' AS content_role, NULL AS render_policy, NULL AS page_furniture_kind, NULL AS page_number, '[]' AS line_numbers_json,";
  const chunkSelect = capabilities.supportsChunkLevel
    ? "c.chunk_level, c.heading_path_json,"
    : "'document' AS chunk_level, '[]' AS heading_path_json,";
  const tokenSelect = capabilities.supportsEstimatedTokens
    ? "c.estimated_tokens,"
    : "CAST((LENGTH(c.text) + 3) / 4 AS INTEGER) AS estimated_tokens,";
  const addressSelect = [
    "c.rowid AS rowid",
    capabilities.supportsReadOrder ? "c.read_order" : "NULL AS read_order",
    capabilities.supportsPrevNext ? "c.prev_chunk_id" : "NULL AS prev_chunk_id",
    capabilities.supportsPrevNext ? "c.next_chunk_id" : "NULL AS next_chunk_id",
    capabilities.supportsParent ? "c.parent_chunk_id" : "NULL AS parent_chunk_id"
  ].join(", ");
  const roleOrder = capabilities.supportsContentRole || capabilities.supportsChunkLevel
    ? "CASE c.chunk_level WHEN 'section' THEN 0 WHEN 'paragraph' THEN 1 WHEN 'table' THEN 2 WHEN 'document' THEN 8 WHEN 'page_furniture' THEN 9 ELSE 5 END, CASE c.content_role WHEN 'heading' THEN 0 WHEN 'body' THEN 1 WHEN 'table' THEN 2 WHEN 'disclaimer' THEN 7 ELSE 9 END,"
    : "";
  const statement = db.prepare(`
    SELECT
      ${addressSelect},
      c.chunk_id,
      c.source_id,
      c.title,
      c.text,
      ${chunkSelect}
      ${roleSelect}
      ${tokenSelect}
      c.source_refs,
      c.lineage_refs,
      c.parse_diagnostic_ids,
      c.source_map_refs,
      s.normalized_source_path
    FROM context_chunks_fts
    JOIN context_chunks c ON c.chunk_id = context_chunks_fts.chunk_id
    LEFT JOIN context_sources s ON s.source_id = c.source_id
    WHERE context_chunks_fts MATCH ?
    ${documentFilter}
    ${pageFurnitureFilter}
    ${documentChunkFilter}
    ${tableChunkFilter}
    ORDER BY ${roleOrder} context_chunks_fts.rowid ASC
    LIMIT ?;
  `);

  try {
    statement.bind([ftsExpression, ...getDocumentIds(options), limit]);
    const matches: IndexedContextChunkMatch[] = [];

    while (statement.step()) {
      const row = statement.getAsObject();
      const sourceRefs = parseStringArrayField(row.source_refs);
      const lineageRefs = parseStringArrayField(row.lineage_refs);
      const parseDiagnosticIds = parseStringArrayField(row.parse_diagnostic_ids);
      const sourceMapRefs = parseStringArrayField(row.source_map_refs);

      matches.push({
        chunk_id: String(row.chunk_id ?? ""),
        kind: "chunk",
        title: String(row.title ?? ""),
        text: String(row.text ?? ""),
        score: Math.max(1, limit - matches.length),
        evidence_ids: [],
        object_id: String(row.chunk_id ?? ""),
        content_role: normalizeIndexedContentRole(row.content_role),
        chunk_level: normalizeIndexedChunkLevel(row.chunk_level),
        heading_path: parseStringArrayField(row.heading_path_json),
        estimated_tokens: typeof row.estimated_tokens === "number" && Number.isFinite(row.estimated_tokens) ? Math.max(1, Math.floor(row.estimated_tokens)) : estimateContextTokens(String(row.text ?? "")),
        ...(typeof row.render_policy === "string" && row.render_policy ? { render_policy: row.render_policy } : {}),
        ...(typeof row.page_furniture_kind === "string" && row.page_furniture_kind ? { page_furniture_kind: row.page_furniture_kind } : {}),
        ...(typeof row.page_number === "number" && Number.isFinite(row.page_number) ? { page_number: row.page_number } : {}),
        line_numbers: parseNumberArrayField(row.line_numbers_json),
        retrieval_source: "query_index_sqlite",
        index_path: databasePath,
        ...(typeof row.source_id === "string" ? { source_id: row.source_id } : {}),
        ...(typeof row.normalized_source_path === "string" ? { normalized_source_path: row.normalized_source_path } : {}),
        ...(typeof row.rowid === "number" && Number.isFinite(row.rowid) ? { rowid: row.rowid } : {}),
        ...(typeof row.read_order === "number" && Number.isFinite(row.read_order) ? { read_order: row.read_order } : {}),
        ...(typeof row.prev_chunk_id === "string" && row.prev_chunk_id ? { prev_chunk_id: row.prev_chunk_id } : {}),
        ...(typeof row.next_chunk_id === "string" && row.next_chunk_id ? { next_chunk_id: row.next_chunk_id } : {}),
        ...(typeof row.parent_chunk_id === "string" && row.parent_chunk_id ? { parent_chunk_id: row.parent_chunk_id } : {}),
        source_refs: sourceRefs,
        lineage_refs: lineageRefs,
        parse_diagnostic_ids: parseDiagnosticIds,
        source_map_refs: sourceMapRefs
      });
    }

    return matches;
  } finally {
    statement.free();
  }
}

function querySqliteSubstringMatches(
  db: SqlJsDatabase,
  query: string,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities
): IndexedContextChunkMatch[] {
  const terms = extractSqliteSubstringQueryTerms(query);

  if (terms.length === 0) {
    return [];
  }

  const sourceIds = hasDocumentScope(options)
    ? getDocumentIds(options)
    : querySqliteSubstringSourceIds(db, terms, options, capabilities, Math.max(1, Math.min(options.limit ?? 24, 64)));

  if (sourceIds.length === 0) {
    return [];
  }

  const perSourceLimit = Math.max(1, Math.min(3, Math.ceil(Math.max(1, options.limit ?? 24) / sourceIds.length)));
  const matches = sourceIds.flatMap((sourceId) =>
    querySqliteSubstringMatchesForSource(db, terms, sourceId, databasePath, options, capabilities, perSourceLimit)
  );

  return matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if ((left.source_id ?? "") !== (right.source_id ?? "")) {
      return (left.source_id ?? "").localeCompare(right.source_id ?? "");
    }

    return (left.read_order ?? Number.MAX_SAFE_INTEGER) - (right.read_order ?? Number.MAX_SAFE_INTEGER);
  });
}

function querySqliteSubstringSourceIds(
  db: SqlJsDatabase,
  terms: string[],
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities,
  limit: number
): string[] {
  const pageFurnitureFilter =
    capabilities.supportsContentRole && options.includePageFurniture !== true
      ? "AND c.content_role NOT IN ('page_furniture', 'disclaimer')"
      : "";
  const documentChunkFilter =
    capabilities.supportsChunkLevel && capabilities.excludeDocumentChunks ? "AND c.chunk_level != 'document'" : "";
  const substringFilters = buildSqliteSubstringFilters(terms);
  const statement = db.prepare(`
    SELECT
      c.source_id,
      MIN(${capabilities.supportsReadOrder ? "COALESCE(c.read_order, c.rowid)" : "c.rowid"}) AS first_order
    FROM context_chunks c
    LEFT JOIN context_sources s ON s.source_id = c.source_id
    WHERE c.source_id IS NOT NULL
      AND (${substringFilters})
      ${pageFurnitureFilter}
      ${documentChunkFilter}
    GROUP BY c.source_id
    ORDER BY first_order ASC, c.source_id ASC
    LIMIT ?;
  `);

  try {
    statement.bind([...buildSqliteSubstringTermBindings(terms), limit]);
    const sourceIds: string[] = [];

    while (statement.step()) {
      const row = statement.getAsObject();

      if (typeof row.source_id === "string" && row.source_id) {
        sourceIds.push(row.source_id);
      }
    }

    return sourceIds;
  } finally {
    statement.free();
  }
}

function querySqliteSubstringMatchesForSource(
  db: SqlJsDatabase,
  terms: string[],
  sourceId: string,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities,
  limit: number
): IndexedContextChunkMatch[] {
  const candidateLimit = Math.max(limit, Math.min(200, Math.max(24, limit * 24)));
  const documentFilter = sqliteDocumentScopeFilter("c.source_id", options);
  const pageFurnitureFilter =
    capabilities.supportsContentRole && options.includePageFurniture !== true
      ? "AND c.content_role NOT IN ('page_furniture', 'disclaimer')"
      : "";
  const documentChunkFilter =
    capabilities.supportsChunkLevel && capabilities.excludeDocumentChunks ? "AND c.chunk_level != 'document'" : "";
  const substringFilters = buildSqliteSubstringFilters(terms);
  const statement = db.prepare(`
    SELECT
      ${sqliteChunkAddressSelect(capabilities)},
      c.chunk_id,
      c.source_id,
      c.title,
      c.text,
      ${sqliteChunkLevelSelect(capabilities)}
      ${sqliteContentRoleSelect(capabilities)}
      ${sqliteEstimatedTokenSelect(capabilities)}
      c.source_refs,
      c.lineage_refs,
      c.parse_diagnostic_ids,
      c.source_map_refs,
      s.normalized_source_path
    FROM context_chunks c
    LEFT JOIN context_sources s ON s.source_id = c.source_id
    WHERE (${substringFilters})
      AND c.source_id = ?
      ${documentFilter}
      ${pageFurnitureFilter}
      ${documentChunkFilter}
    ORDER BY c.source_id ASC, ${capabilities.supportsReadOrder ? "c.read_order ASC," : ""} c.rowid ASC
    LIMIT ?;
  `);

  try {
    const termBindings = buildSqliteSubstringTermBindings(terms);
    statement.bind([...termBindings, sourceId, ...getDocumentIds(options), candidateLimit]);
    const matches: IndexedContextChunkMatch[] = [];

    while (statement.step()) {
      const row = statement.getAsObject();
      const score = scoreSqliteSubstringMatch(row, terms, limit - matches.length);

      matches.push(mapIndexedContextChunkRow(row, databasePath, score, "query_index_substring"));
    }

    return matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return (left.read_order ?? Number.MAX_SAFE_INTEGER) - (right.read_order ?? Number.MAX_SAFE_INTEGER);
    }).slice(0, limit);
  } finally {
    statement.free();
  }
}

function buildSqliteSubstringFilters(terms: string[]): string {
  return terms
    .map(() => "(INSTR(LOWER(c.title), ?) > 0 OR INSTR(LOWER(c.text), ?) > 0 OR INSTR(LOWER(COALESCE(s.source_path, '')), ?) > 0)")
    .join(" OR ");
}

function buildSqliteSubstringTermBindings(terms: string[]): string[] {
  return terms.flatMap((term) => [term, term, term]);
}

function querySqliteContextWindowMatches(
  db: SqlJsDatabase,
  seedMatches: IndexedContextChunkMatch[],
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities
): IndexedContextChunkMatch[] {
  const windowMatches: IndexedContextChunkMatch[] = [];
  const seedLimit = Math.max(1, Math.min(seedMatches.length, options.limit ?? 24));

  for (const seed of seedMatches.slice(0, seedLimit)) {
    windowMatches.push(...querySqliteNeighborChunks(db, seed, databasePath, options, capabilities));
  }

  return uniqueContextChunkMatches(windowMatches);
}

function querySqliteNeighborChunks(
  db: SqlJsDatabase,
  seed: IndexedContextChunkMatch,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities
): IndexedContextChunkMatch[] {
  if (!seed.source_id || typeof seed.rowid !== "number") {
    return [];
  }

  return [
    querySqliteNeighborChunk(db, seed, databasePath, options, capabilities, "previous"),
    querySqliteNeighborChunk(db, seed, databasePath, options, capabilities, "next")
  ].filter((match): match is IndexedContextChunkMatch => Boolean(match));
}

function querySqliteNeighborChunk(
  db: SqlJsDatabase,
  seed: IndexedContextChunkMatch,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities,
  direction: "previous" | "next"
): IndexedContextChunkMatch | undefined {
  const sourceId = seed.source_id;
  const rowId = seed.rowid;
  if (!sourceId || typeof rowId !== "number") {
    return undefined;
  }

  const operator = direction === "previous" ? "<" : ">";
  const ordering = direction === "previous" ? "DESC" : "ASC";
  const pageFurnitureFilter =
    capabilities.supportsContentRole && options.includePageFurniture !== true
      ? "AND c.content_role NOT IN ('page_furniture', 'disclaimer')"
      : "";
  const documentChunkFilter = capabilities.supportsChunkLevel ? "AND c.chunk_level != 'document'" : "";
  const statement = db.prepare(`
    SELECT
      ${sqliteChunkAddressSelect(capabilities)},
      c.chunk_id,
      c.source_id,
      c.title,
      c.text,
      ${sqliteChunkLevelSelect(capabilities)}
      ${sqliteContentRoleSelect(capabilities)}
      ${sqliteEstimatedTokenSelect(capabilities)}
      c.source_refs,
      c.lineage_refs,
      c.parse_diagnostic_ids,
      c.source_map_refs,
      s.normalized_source_path
    FROM context_chunks c
    LEFT JOIN context_sources s ON s.source_id = c.source_id
    WHERE c.source_id = ?
      AND c.rowid ${operator} ?
      ${pageFurnitureFilter}
      ${documentChunkFilter}
    ORDER BY c.rowid ${ordering}
    LIMIT 1;
  `);

  try {
    statement.bind([sourceId, rowId]);

    if (!statement.step()) {
      return undefined;
    }

    return mapIndexedContextChunkRow(
      statement.getAsObject(),
      databasePath,
      Math.max(0.1, seed.score - 0.25),
      "query_index_context_window"
    );
  } finally {
    statement.free();
  }
}

function querySqliteSourceOverviewMatches(
  db: SqlJsDatabase,
  query: string,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities
): IndexedContextChunkMatch[] {
  const limit = Math.max(1, Math.min(options.limit ?? 12, 24));
  const scanLimit = hasDocumentScope(options) ? limit : Math.max(limit, Math.min(500, limit * 12));
  const documentFilter = hasDocumentScope(options) ? `WHERE s.source_id IN (${getDocumentIds(options).map(() => "?").join(", ")})` : "";
  const statement = db.prepare(`
    SELECT
      s.source_id,
      s.source_path,
      s.source_type,
      s.normalized_source_path,
      s.parse_diagnostic_id
    FROM context_sources s
    ${documentFilter}
    ORDER BY s.rowid ASC
    LIMIT ?;
  `);

  try {
    statement.bind([...getDocumentIds(options), scanLimit]);
    const matches: IndexedContextChunkMatch[] = [];
    const queryTerms = extractDirectQueryTerms(query);

    while (statement.step()) {
      const row = statement.getAsObject();
      const sourceId = String(row.source_id ?? "");

      if (!sourceId) {
        continue;
      }

      const sourcePath = String(row.source_path ?? sourceId);
      const normalizedSourcePath = typeof row.normalized_source_path === "string" ? row.normalized_source_path : undefined;
      const parseDiagnosticId = typeof row.parse_diagnostic_id === "string" && row.parse_diagnostic_id ? row.parse_diagnostic_id : undefined;
      const openingChunks = querySqliteSourceOpeningChunks(db, sourceId, databasePath, options, capabilities);
      const openingText =
        openingChunks.length > 0
          ? openingChunks
              .map((chunk, index) => {
                const title = chunk.title ? `（${chunk.title}）` : "";

                return `开头片段 ${index + 1}${title}：\n${compactChunkText(chunk.text, 900)}`;
              })
              .join("\n\n")
          : "该来源暂未生成可读正文片段；请使用 resolve-source 或 full normalized source 回查。";
      const sourceMapRefs = uniqueStrings([
        ...openingChunks.flatMap((chunk) => chunk.source_map_refs ?? []),
        ...querySqliteSourceMapRefs(db, sourceId)
      ]).slice(0, 12);
      const text = [
        `来源文件：${sourcePath}`,
        `来源类型：${String(row.source_type ?? "unknown")}`,
        normalizedSourcePath ? `规范化文本：${normalizedSourcePath}` : undefined,
        parseDiagnosticId ? `解析诊断：${parseDiagnosticId}` : undefined,
        `阅读入口：按原始阅读顺序从以下开头窗口继续。`,
        openingText
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");

      matches.push({
        chunk_id: sourceId,
        kind: "chunk",
        title: `来源概览：${sourcePath}`,
        text,
        score: Math.max(1, limit - matches.length),
        evidence_ids: [],
        object_id: sourceId,
        content_role: "source_overview",
        chunk_level: "source_overview",
        heading_path: ["来源概览", sourcePath],
        estimated_tokens: estimateContextTokens(text),
        retrieval_source: "query_index_source_overview",
        index_path: databasePath,
        source_id: sourceId,
        ...(normalizedSourcePath ? { normalized_source_path: normalizedSourcePath } : {}),
        fallback_reason: "no_keyword_match_source_overview",
        source_refs: [sourceId],
        lineage_refs: [sourceId],
        parse_diagnostic_ids: parseDiagnosticId ? [parseDiagnosticId] : [],
        source_map_refs: sourceMapRefs
      });
    }

    if (!hasDocumentScope(options) && queryTerms.length > 0) {
      const scoredMatches = matches
        .map((match, index) => {
          const directScore = scoreDirectQueryMatch(match, queryTerms);

          return {
            ...match,
            score: directScore > 0 ? directScore : Math.max(0.01, 0.1 - index / 10000)
          };
        })
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scoredMatches.some((match) => match.score >= 1)) {
        return scoredMatches.slice(0, limit);
      }
    }

    return matches.slice(0, limit);
  } finally {
    statement.free();
  }
}

function querySqliteSourceOpeningChunks(
  db: SqlJsDatabase,
  sourceId: string,
  databasePath: string,
  options: SearchContextChunksOptions,
  capabilities: SqliteChunkCapabilities
): IndexedContextChunkMatch[] {
  const pageFurnitureFilter =
    capabilities.supportsContentRole && options.includePageFurniture !== true
      ? "AND c.content_role NOT IN ('page_furniture', 'disclaimer')"
      : "";
  const documentChunkFilter = capabilities.supportsChunkLevel ? "AND c.chunk_level != 'document'" : "";
  const statement = db.prepare(`
    SELECT
      ${sqliteChunkAddressSelect(capabilities)},
      c.chunk_id,
      c.source_id,
      c.title,
      c.text,
      ${sqliteChunkLevelSelect(capabilities)}
      ${sqliteContentRoleSelect(capabilities)}
      ${sqliteEstimatedTokenSelect(capabilities)}
      c.source_refs,
      c.lineage_refs,
      c.parse_diagnostic_ids,
      c.source_map_refs,
      s.normalized_source_path
    FROM context_chunks c
    LEFT JOIN context_sources s ON s.source_id = c.source_id
    WHERE c.source_id = ?
      ${pageFurnitureFilter}
      ${documentChunkFilter}
    ORDER BY c.rowid ASC
    LIMIT 8;
  `);

  try {
    statement.bind([sourceId]);
    const chunks: IndexedContextChunkMatch[] = [];

    while (statement.step()) {
      chunks.push(mapIndexedContextChunkRow(statement.getAsObject(), databasePath, Math.max(1, 3 - chunks.length), "query_index_context_window"));
    }

    return selectInformativeOpeningChunks(chunks);
  } finally {
    statement.free();
  }
}

function selectInformativeOpeningChunks(chunks: IndexedContextChunkMatch[]): IndexedContextChunkMatch[] {
  const informative = chunks.filter((chunk) => !isLowInformationOpeningChunk(chunk));
  const selected = informative.length > 0 ? informative : chunks;

  return selected.slice(0, 4);
}

function isLowInformationOpeningChunk(chunk: IndexedContextChunkMatch): boolean {
  const text = chunk.text.replace(/\r/g, "").trim();

  if (text.length === 0) {
    return true;
  }

  if (isFallbackNormalizedBoilerplate(text)) {
    return true;
  }

  const compact = text.replace(/\s+/g, "");
  const semanticChars = compact.replace(/[|\-:：_.,，。/\\()[\]{}<>#*`~+＝=]/g, "");
  const cjkChars = semanticChars.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const digitChars = semanticChars.match(/\d/g)?.length ?? 0;
  const pipeCount = (text.match(/\|/g) ?? []).length;
  const tableSeparatorCount = (text.match(/\|\s*-{2,}\s*\|/g) ?? []).length;
  const isTableLike = chunk.chunk_level === "table" || chunk.content_role === "table" || pipeCount >= 6 || tableSeparatorCount > 0;

  if (!isTableLike) {
    return semanticChars.length < 4;
  }

  return cjkChars < 8 && digitChars <= 12;
}

function querySqliteSourceMapRefs(db: SqlJsDatabase, sourceId: string): string[] {
  let statement: SqlJsStatement;

  try {
    statement = db.prepare(`
      SELECT source_map_id
      FROM context_source_maps
      WHERE source_id = ?
      ORDER BY rowid ASC
      LIMIT 8;
    `);
  } catch {
    return [];
  }

  try {
    statement.bind([sourceId]);
    const refs: string[] = [];

    while (statement.step()) {
      const row = statement.getAsObject();

      if (typeof row.source_map_id === "string" && row.source_map_id) {
        refs.push(row.source_map_id);
      }
    }

    return refs;
  } finally {
    statement.free();
  }
}

function mapIndexedContextChunkRow(
  row: Record<string, unknown>,
  databasePath: string,
  score: number,
  retrievalSource: ContextRetrievalSource
): IndexedContextChunkMatch {
  const text = String(row.text ?? "");

  return {
    chunk_id: String(row.chunk_id ?? ""),
    kind: "chunk",
    title: String(row.title ?? ""),
    text,
    score,
    evidence_ids: [],
    object_id: String(row.chunk_id ?? ""),
    content_role: normalizeIndexedContentRole(row.content_role),
    chunk_level: normalizeIndexedChunkLevel(row.chunk_level),
    heading_path: parseStringArrayField(row.heading_path_json),
    estimated_tokens:
      typeof row.estimated_tokens === "number" && Number.isFinite(row.estimated_tokens)
        ? Math.max(1, Math.floor(row.estimated_tokens))
        : estimateContextTokens(text),
    ...(typeof row.render_policy === "string" && row.render_policy ? { render_policy: row.render_policy } : {}),
    ...(typeof row.page_furniture_kind === "string" && row.page_furniture_kind ? { page_furniture_kind: row.page_furniture_kind } : {}),
    ...(typeof row.page_number === "number" && Number.isFinite(row.page_number) ? { page_number: row.page_number } : {}),
    line_numbers: parseNumberArrayField(row.line_numbers_json),
    retrieval_source: retrievalSource,
    index_path: databasePath,
    ...(typeof row.source_id === "string" ? { source_id: row.source_id } : {}),
    ...(typeof row.normalized_source_path === "string" ? { normalized_source_path: row.normalized_source_path } : {}),
    ...(typeof row.rowid === "number" && Number.isFinite(row.rowid) ? { rowid: row.rowid } : {}),
    ...(typeof row.read_order === "number" && Number.isFinite(row.read_order) ? { read_order: row.read_order } : {}),
    ...(typeof row.prev_chunk_id === "string" && row.prev_chunk_id ? { prev_chunk_id: row.prev_chunk_id } : {}),
    ...(typeof row.next_chunk_id === "string" && row.next_chunk_id ? { next_chunk_id: row.next_chunk_id } : {}),
    ...(typeof row.parent_chunk_id === "string" && row.parent_chunk_id ? { parent_chunk_id: row.parent_chunk_id } : {}),
    source_refs: parseStringArrayField(row.source_refs),
    lineage_refs: parseStringArrayField(row.lineage_refs),
    parse_diagnostic_ids: parseStringArrayField(row.parse_diagnostic_ids),
    source_map_refs: parseStringArrayField(row.source_map_refs)
  };
}

function sqliteChunkAddressSelect(capabilities: SqliteChunkCapabilities): string {
  return [
    "c.rowid AS rowid",
    capabilities.supportsReadOrder ? "c.read_order" : "NULL AS read_order",
    capabilities.supportsPrevNext ? "c.prev_chunk_id" : "NULL AS prev_chunk_id",
    capabilities.supportsPrevNext ? "c.next_chunk_id" : "NULL AS next_chunk_id",
    capabilities.supportsParent ? "c.parent_chunk_id" : "NULL AS parent_chunk_id"
  ].join(", ");
}

function sqliteChunkLevelSelect(capabilities: SqliteChunkCapabilities): string {
  return capabilities.supportsChunkLevel ? "c.chunk_level, c.heading_path_json," : "'document' AS chunk_level, '[]' AS heading_path_json,";
}

function sqliteContentRoleSelect(capabilities: SqliteChunkCapabilities): string {
  return capabilities.supportsContentRole
    ? "c.content_role, c.render_policy, c.page_furniture_kind, c.page_number, c.line_numbers_json,"
    : "'body' AS content_role, NULL AS render_policy, NULL AS page_furniture_kind, NULL AS page_number, '[]' AS line_numbers_json,";
}

function sqliteEstimatedTokenSelect(capabilities: SqliteChunkCapabilities): string {
  return capabilities.supportsEstimatedTokens ? "c.estimated_tokens," : "CAST((LENGTH(c.text) + 3) / 4 AS INTEGER) AS estimated_tokens,";
}

function diversifyContextChunkMatchesBySource(
  matches: IndexedContextChunkMatch[],
  limit: number,
  options: { prioritizeCompactContext?: boolean } = {}
): IndexedContextChunkMatch[] {
  const groups = new Map<string, IndexedContextChunkMatch[]>();

  for (const match of matches) {
    const sourceKey = match.source_id ?? match.source_refs?.[0] ?? "unknown";
    const group = groups.get(sourceKey) ?? [];
    group.push(match);
    groups.set(sourceKey, group);
  }

  const diversified: IndexedContextChunkMatch[] = [];
  const groupValues = Array.from(groups.values()).map((group) =>
    options.prioritizeCompactContext === true ? [...group].sort(compareCompactContextCandidateMatches) : group
  );

  while (diversified.length < limit && groupValues.some((group) => group.length > 0)) {
    for (const group of groupValues) {
      const next = group.shift();

      if (!next) {
        continue;
      }

      diversified.push(next);

      if (diversified.length >= limit) {
        break;
      }
    }
  }

  return diversified;
}

function compareCompactContextCandidateMatches(left: IndexedContextChunkMatch, right: IndexedContextChunkMatch): number {
  const priorityDelta = compactContextCandidatePriority(left) - compactContextCandidatePriority(right);

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return (left.read_order ?? left.rowid ?? Number.MAX_SAFE_INTEGER) - (right.read_order ?? right.rowid ?? Number.MAX_SAFE_INTEGER);
}

function compactContextCandidatePriority(match: ContextChunkMatch): number {
  if (isCompactLowValueMatch(match)) {
    return 90;
  }

  if (isCompactTableMatch(match)) {
    return 0;
  }

  if (match.chunk_level === "paragraph" && match.content_role === "body") {
    return 1;
  }

  if (match.chunk_level === "source_overview" || match.content_role === "source_overview") {
    return 2;
  }

  if (match.content_role === "heading" || match.chunk_level === "section") {
    return 80;
  }

  return 10;
}

function countSqliteContextSources(db: SqlJsDatabase, options: SearchContextChunksOptions): number {
  const documentFilter = hasDocumentScope(options) ? `WHERE s.source_id IN (${getDocumentIds(options).map(() => "?").join(", ")})` : "";
  const statement = db.prepare(`
    SELECT COUNT(*) AS source_count
    FROM context_sources s
    ${documentFilter};
  `);

  try {
    statement.bind(getDocumentIds(options));

    if (!statement.step()) {
      return 0;
    }

    const row = statement.getAsObject();
    return typeof row.source_count === "number" && Number.isFinite(row.source_count) ? Math.max(0, Math.floor(row.source_count)) : 0;
  } finally {
    statement.free();
  }
}

function countContextMatchSources(matches: IndexedContextChunkMatch[]): number {
  return uniqueStrings(matches.flatMap((match) => match.source_refs?.length ? match.source_refs : match.source_id ? [match.source_id] : [])).length;
}

function uniqueContextChunkMatches(matches: IndexedContextChunkMatch[]): IndexedContextChunkMatch[] {
  const seen = new Set<string>();
  const uniqueMatches: IndexedContextChunkMatch[] = [];

  for (const match of matches) {
    if (seen.has(match.chunk_id)) {
      continue;
    }

    seen.add(match.chunk_id);
    uniqueMatches.push(match);
  }

  return uniqueMatches;
}

function buildFtsExpression(query: string): string | undefined {
  const rawTerms = Array.from(new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? []))
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
  const terms = Array.from(new Set(rawTerms.flatMap((term) => [term, ...queryTermAliases(term)]))).slice(0, 32);

  if (terms.length === 0) {
    return undefined;
  }

  return terms.map((term) => `${term}*`).join(" OR ");
}

function queryTermAliases(term: string): string[] {
  const normalized = term.toLowerCase();
  const aliases: string[] = [];

  if (["收入", "营收", "销售额", "销售", "金额"].includes(term) || /revenue|sales|amount|income|gmv/.test(normalized)) {
    aliases.push("revenue", "sales", "amount", "income", "gmv");
  }

  if (["订单", "订单数", "单量"].includes(term) || /order/.test(normalized)) {
    aliases.push("order", "orders", "order_id");
  }

  if (["客户", "客群"].includes(term) || /customer|client|account/.test(normalized)) {
    aliases.push("customer", "client", "account");
  }

  if (["区域", "地区", "城市"].includes(term) || /region|area|city|province/.test(normalized)) {
    aliases.push("region", "area", "city", "province");
  }

  if (["渠道"].includes(term) || /channel/.test(normalized)) {
    aliases.push("channel");
  }

  if (["风险", "隐患", "问题"].includes(term) || /risk|issue|warning/.test(normalized)) {
    aliases.push("risk", "issue", "warning");
  }

  if (["毛利", "利润"].includes(term) || /margin|profit|gross/.test(normalized)) {
    aliases.push("margin", "profit", "gross");
  }

  if (["日期", "时间", "月份", "季度"].includes(term) || /date|time|month|quarter|year/.test(normalized)) {
    aliases.push("date", "time", "month", "quarter", "year");
  }

  return aliases;
}

function refineFallbackNormalizedSourceMatches(
  result: ContextChunkSearchResult,
  query: string,
  options: SearchContextChunksOptions
): ContextChunkSearchResult {
  const terms = extractFallbackQueryTerms(query);

  if (terms.length === 0) {
    return result;
  }

  const refinedMatches = result.matches.flatMap((match) => {
    if (!shouldSplitFallbackNormalizedMatch(match)) {
      return [match];
    }

    return splitFallbackNormalizedMatch(match)
      .map((chunk) => ({ ...chunk, score: scoreFallbackChunk(chunk, terms) }))
      .filter((chunk) => chunk.score > 0)
      .filter((chunk) => options.includePageFurniture === true || (chunk.content_role !== "page_furniture" && chunk.content_role !== "disclaimer"));
  });

  const specificTerm = selectSpecificFallbackTerm(terms);
  const specificTermMatches =
    specificTerm.length > 0 ? refinedMatches.filter((match) => match.text.toLowerCase().includes(specificTerm)) : [];
  const rankingPool = specificTermMatches.length > 0 ? specificTermMatches : refinedMatches;

  if (rankingPool.length === 0) {
    return result;
  }

  const limit = Math.max(1, options.limit ?? result.limit ?? 5);
  const sortedMatches = rankingPool
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return fallbackChunkPriority(left) - fallbackChunkPriority(right);
    })
    .slice(0, limit);

  return {
    ...result,
    limit,
    matches: sortedMatches
  };
}

function shouldSplitFallbackNormalizedMatch(match: ContextChunkMatch): boolean {
  return (
    match.chunk_id.startsWith("normalized_source.") &&
    match.chunk_level !== "paragraph" &&
    (match.text.length > 160 || /\n\s*#{1,6}\s+/.test(match.text) || /\n\s*\n/.test(match.text))
  );
}

function splitFallbackNormalizedMatch(match: ContextChunkMatch): ContextChunkMatch[] {
  const lines = match.text.replace(/\r/g, "").split("\n");
  const chunks: ContextChunkMatch[] = [];
  const headingPath: string[] = [];
  let buffer: string[] = [];
  let bufferStartLine = 1;
  let chunkIndex = 0;

  const flush = () => {
    const text = buffer.join("\n").trim();
    const startLine = bufferStartLine;
    const endLine = bufferStartLine + Math.max(0, buffer.length - 1);
    buffer = [];

    if (!text || isFallbackNormalizedBoilerplate(text)) {
      return;
    }

    const contentRole = classifyFallbackContentRole(text);
    const chunkLevel = contentRole === "table" ? "table" : contentRole === "page_furniture" ? "page_furniture" : "paragraph";
    chunkIndex += 1;
    chunks.push({
      ...match,
      chunk_id: `${match.chunk_id}.${chunkLevel}.${chunkIndex}`,
      object_id: `${match.object_id ?? match.chunk_id}.${chunkLevel}.${chunkIndex}`,
      title: headingPath.length > 0 ? `${match.title} > ${headingPath.join(" > ")}` : match.title,
      text,
      score: 0,
      content_role: contentRole,
      chunk_level: chunkLevel,
      heading_path: [...headingPath],
      estimated_tokens: estimateContextTokens(text),
      retrieval_source: "fallback_normalized_source",
      line_numbers: [startLine, endLine]
    } as ContextChunkMatch & { retrieval_source: "fallback_normalized_source" });
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);

    if (heading) {
      flush();
      const title = heading[2]?.trim() ?? "";

      if (!isFallbackNormalizedBoilerplate(title)) {
        const level = Math.max(1, heading[1]?.length ?? 1);
        headingPath.splice(level - 1);
        headingPath[level - 1] = title;
      }

      return;
    }

    if (buffer.length > 0 && isFallbackSectionBoundaryLine(trimmed)) {
      flush();
      bufferStartLine = index + 1;
    }

    if (!trimmed) {
      flush();
      return;
    }

    if (buffer.length === 0) {
      bufferStartLine = index + 1;
    }
    buffer.push(line);
  });
  flush();

  return chunks;
}

function extractFallbackQueryTerms(query: string): string[] {
  return uniqueStrings(query.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

function extractSqliteSubstringQueryTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/[，。！？、；：:;,.!?()[\]{}<>《》“”"'`~|/\\\r\n\t]+/gu, " ")
    .trim();
  const terms: string[] = [];
  const pushTerm = (term: string) => {
    const cleaned = term.trim().toLowerCase();

    if (cleaned.length < 2 || isGenericQuestionTerm(cleaned)) {
      return;
    }

    terms.push(cleaned);
  };

  for (const token of normalized.match(/[a-z0-9_][a-z0-9_-]{1,}/giu) ?? []) {
    pushTerm(token);
  }

  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    for (const fragment of run.split(/(?:以及|还有|分别是|分别|哪些|什么|是否|有没有|请|列出|对应|这批|这些|文件|材料|报告|年度报告|是谁|有哪些|主要|多少|如何|情况|信息|内容|一共|可以|能够|需要|说明|总结|分析|相关|一下|和|与|及|或)/u)) {
      pushTerm(fragment);
    }

    if (run.length >= 2 && run.length <= 8) {
      pushTerm(run);
    }
  }

  return uniqueStrings(terms).slice(0, 12);
}

function isGenericQuestionTerm(term: string): boolean {
  return new Set([
    "这个",
    "那个",
    "这些",
    "这批",
    "分别",
    "哪些",
    "什么",
    "是否",
    "有没有",
    "请",
    "列出",
    "对应",
    "文件",
    "材料",
    "报告",
    "年度报告",
    "是谁",
    "有哪些",
    "主要",
    "多少",
    "如何",
    "情况",
    "信息",
    "内容",
    "一共",
    "可以",
    "能够",
    "需要",
    "说明",
    "总结",
    "分析",
    "相关",
    "一下"
  ]).has(term);
}

function scoreSqliteSubstringMatch(row: Record<string, unknown>, terms: string[], baseScore: number): number {
  const title = String(row.title ?? "").toLowerCase();
  const text = String(row.text ?? "").toLowerCase();
  const matchedTerms = terms.filter((term) => title.includes(term) || text.includes(term));
  const titleMatches = terms.filter((term) => title.includes(term)).length;
  const textMatches = matchedTerms.length;
  const role = normalizeIndexedContentRole(row.content_role);
  const level = normalizeIndexedChunkLevel(row.chunk_level);
  const roleBonus = level === "paragraph" || role === "body" ? 2 : level === "table" || role === "table" ? 1 : 0;

  return Math.max(1, baseScore) + titleMatches * 4 + textMatches * 3 + roleBonus;
}

function selectSpecificFallbackTerm(terms: string[]): string {
  if (terms.length < 2) {
    return "";
  }

  return [...terms].sort((left, right) => right.length - left.length)[0] ?? "";
}

function isFallbackSectionBoundaryLine(text: string): boolean {
  return (
    text.length <= 80 &&
    /^(?:\d{1,2}\u3001|[\uff08(][\p{L}\p{N}]{1,8}[\uff09)]|[\p{Script=Han}]{1,4}\u3001)/u.test(text)
  );
}

function scoreFallbackChunk(chunk: ContextChunkMatch, terms: string[]): number {
  const textHaystack = chunk.text.toLowerCase();
  const headingHaystack = (chunk.heading_path?.join(" ") ?? "").toLowerCase();
  const matchedTerms = terms.filter((term) => textHaystack.includes(term));
  const headingOnlyTerms = terms.filter((term) => !textHaystack.includes(term) && headingHaystack.includes(term));
  const exactPhraseBonus = textHaystack.includes(terms.join(" ")) ? 2 : 0;
  const roleBonus = chunk.chunk_level === "paragraph" ? 2 : chunk.chunk_level === "table" ? 1 : 0;
  const specificityScore = matchedTerms.reduce((total, term) => total + (term.length >= 3 ? 6 : 3), 0);
  const weakHeadingScore = headingOnlyTerms.reduce((total, term) => total + (term.length >= 3 ? 2 : 1), 0);

  return specificityScore + weakHeadingScore + exactPhraseBonus + roleBonus;
}

function fallbackChunkPriority(chunk: ContextChunkMatch): number {
  if (chunk.chunk_level === "paragraph") {
    return 0;
  }
  if (chunk.chunk_level === "table") {
    return 1;
  }
  if (chunk.chunk_level === "section") {
    return 2;
  }
  if (chunk.chunk_level === "page_furniture") {
    return 9;
  }

  return 5;
}

function classifyFallbackContentRole(text: string): NonNullable<ContextChunkMatch["content_role"]> {
  const trimmed = text.trim();

  if (isFallbackPageFurniture(trimmed)) {
    return "page_furniture";
  }
  if (isFallbackDisclaimer(trimmed)) {
    return "disclaimer";
  }
  if (trimmed.includes("|") && /\n\s*\|?\s*:?-{3,}/.test(trimmed)) {
    return "table";
  }

  return "body";
}

function isFallbackPageFurniture(text: string): boolean {
  return /^(?:\d+\s*\/\s*\d+|\d+\s*[-–]\s*\d+|第\s*\d+\s*页(?:\s*共\s*\d+\s*页)?|page\s+\d+)$/i.test(text.trim());
}

function isFallbackDisclaimer(text: string): boolean {
  return /(?:免责声明|风险提示|重要提示|本报告不构成|投资者注意投资风险)/u.test(text) && text.length < 240;
}

function isFallbackNormalizedBoilerplate(text: string): boolean {
  return /^(?:>?\s*)?(?:Normalized source:|Source text(?:\s|$)|Heading path:|Open Insight 内置|Open Insight normalized|source\/normalized\/)/i.test(text.trim());
}

function buildCompactRetrievalResult(
  result: ContextChunkSearchResult,
  tokenBudget: number,
  options: { includePageFurniture?: boolean; targetDocumentIds?: string[] } = {}
): ContextCompactRetrievalResult {
  const fineGrainedMatches = result.matches.filter(
    (match) =>
      match.chunk_level === "paragraph" ||
      match.chunk_level === "table" ||
      match.chunk_level === "source_overview" ||
      match.content_role === "table" ||
      match.content_role === "source_overview" ||
      (options.includePageFurniture === true && match.content_role === "page_furniture") ||
      (match.chunk_level === undefined && match.content_role !== "heading")
  );
  const candidateMatches = fineGrainedMatches.length > 0 ? fineGrainedMatches : result.matches;
  const eligibleCandidateMatches = candidateMatches.filter(
    (match) =>
      !(
        (match.content_role === "page_furniture" && options.includePageFurniture !== true) ||
        match.content_role === "disclaimer" ||
        isCompactLowValueMatch(match)
      )
  );
  const includedMatches: ContextChunkMatch[] = [];
  let usedTokens = 0;

  for (const match of eligibleCandidateMatches) {
    const compactedMatch = compactMatchForRetrieval(match);
    const estimatedTokens = compactedMatch.estimated_tokens ?? estimateContextTokens(compactedMatch.text);

    if (includedMatches.length > 0 && usedTokens + estimatedTokens > tokenBudget) {
      continue;
    }

    includedMatches.push(compactedMatch);
    usedTokens += estimatedTokens;

    if (usedTokens >= tokenBudget) {
      break;
    }
  }

  if (!includedMatches.some(isCompactTableMatch)) {
    const tableCandidate = eligibleCandidateMatches.find(isCompactTableMatch);

    if (tableCandidate) {
      const compactedTable = compactMatchForRetrieval(tableCandidate);
      const tableTokens = compactedTable.estimated_tokens ?? estimateContextTokens(compactedTable.text);

      if (tableTokens <= tokenBudget && !includedMatches.some((match) => match.chunk_id === compactedTable.chunk_id)) {
        while (includedMatches.length > 0 && usedTokens + tableTokens > tokenBudget) {
          const removableIndex = findLastRemovableCompactMatchIndex(includedMatches);

          if (removableIndex < 0) {
            break;
          }

          const [removed] = includedMatches.splice(removableIndex, 1);
          usedTokens -= removed?.estimated_tokens ?? estimateContextTokens(removed?.text ?? "");
        }

        if (usedTokens + tableTokens <= tokenBudget) {
          includedMatches.push(compactedTable);
          usedTokens += tableTokens;
        }
      }
    }
  }

  const facts = includedMatches
    .filter((match) => match.chunk_level !== "table" && match.content_role !== "table")
    .map((match) => buildCompactFact(match));
  const tables = includedMatches
    .filter((match) => match.chunk_level === "table" || match.content_role === "table")
    .map((match) => buildCompactTable(match));
  const keyNumbers = extractCompactNumbers(includedMatches).slice(0, 30);
  const pageCues = buildCompactPageCues(includedMatches);
  const nextFragmentReads = buildCompactFragmentReads(includedMatches);
  const estimatedTokens =
    includedMatches.length === 0
      ? 0
      : Math.min(tokenBudget, estimateContextTokens([...facts.map((fact) => fact.text), ...tables.map((table) => table.text)].join("\n")));
  const retrievalStrategy = inferCompactRetrievalStrategy(includedMatches, result.matches);
  const fallbackUsed = retrievalStrategy === "source_overview_fallback";
  const includedSourceRefs = uniqueStrings(includedMatches.flatMap((match) => match.source_refs ?? []));
  const totalSourceRefs = options.targetDocumentIds?.length ? uniqueStrings(options.targetDocumentIds) : uniqueStrings(result.source_refs ?? []);
  const partialSourceCoverage = totalSourceRefs.length > 1 && includedSourceRefs.length > 0 && includedSourceRefs.length < totalSourceRefs.length;
  const broadPartialSourceCoverage =
    partialSourceCoverage && (isOpenEndedCorpusQuestion(result.query) || isBroadContextRetrievalQuery(result.query));
  const coverageHints = buildCompactCoverageHints({
    eligibleCandidateMatches,
    includedMatches,
    tokenBudget,
    fallbackUsed,
    partialSourceCoverage,
    sourceCoverageRate: totalSourceRefs.length > 0 ? includedSourceRefs.length / totalSourceRefs.length : 1,
    ...(partialSourceCoverage
      ? {
          sourceCoverageReasonCn: `compact context 只覆盖 ${includedSourceRefs.length}/${totalSourceRefs.length} 个来源；跨文件问题需要补读未覆盖来源或披露限制。`
        }
      : {}),
    ...(fallbackUsed ? { fallbackReason: "source_overview_or_normalized_fallback" } : {})
  });

  return {
    status: fallbackUsed || broadPartialSourceCoverage ? "degraded" : result.status,
    profile: result.profile,
    package_id: result.package_id,
    title: result.title,
    spec_version: result.spec_version,
    source_mode: result.source_mode,
    query: result.query,
    token_budget: tokenBudget,
    estimated_tokens: estimatedTokens,
    compacted_from_match_count: result.matches.length,
    included_chunk_count: includedMatches.length,
    facts,
    key_numbers: keyNumbers,
    tables,
    page_cues: pageCues,
    next_fragment_reads: nextFragmentReads,
    coverage_hints: coverageHints,
    source_refs: uniqueStrings(includedMatches.flatMap((match) => match.source_refs ?? [])),
    lineage_refs: uniqueStrings(includedMatches.flatMap((match) => match.lineage_refs ?? [])),
    parse_diagnostic_ids: uniqueStrings(includedMatches.flatMap((match) => match.parse_diagnostic_ids ?? [])),
    source_map_refs: uniqueStrings(includedMatches.flatMap((match) => match.source_map_refs ?? [])),
    retrieval_strategy: retrievalStrategy,
    fallback_used: fallbackUsed,
    ...(fallbackUsed ? { fallback_reason: "no_keyword_match_or_weak_match_source_overview" } : {}),
    source_coverage: {
      included_source_count: includedSourceRefs.length,
      total_source_count: totalSourceRefs.length,
      included_source_refs: includedSourceRefs
    }
  };
}

function inferCompactRetrievalStrategy(includedMatches: ContextChunkMatch[], allMatches: ContextChunkMatch[]): ContextRetrievalStrategy {
  if (
    includedMatches.some(
      (match) => match.chunk_level === "source_overview" || match.content_role === "source_overview"
    )
  ) {
    return "source_overview_fallback";
  }

  const retrievalSources = new Set(
    [...includedMatches, ...allMatches]
      .map((match) => (match as Partial<IndexedContextChunkMatch>).retrieval_source)
      .filter((source): source is ContextRetrievalSource => Boolean(source))
  );

  if (retrievalSources.has("query_index_source_overview")) {
    return "source_overview_fallback";
  }

  if (retrievalSources.has("query_index_substring")) {
    return "query_index_substring_window";
  }

  if (retrievalSources.has("query_index_context_window")) {
    return "query_index_context_window";
  }

  if (retrievalSources.has("query_index_sqlite")) {
    return "query_index_exact";
  }

  return "normalized_source_fallback";
}

function compactMatchForRetrieval(match: ContextChunkMatch): ContextChunkMatch {
  const compactText = compactChunkText(match.text, isCompactTableMatch(match) ? 1200 : 700);
  const estimatedTokens = estimateContextTokens(compactText);

  return { ...match, text: compactText, estimated_tokens: estimatedTokens };
}

function isCompactTableMatch(match: ContextChunkMatch): boolean {
  return match.chunk_level === "table" || match.content_role === "table";
}

function findLastRemovableCompactMatchIndex(matches: ContextChunkMatch[]): number {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];

    if (match && !isCompactTableMatch(match)) {
      return index;
    }
  }

  return -1;
}

function isCompactLowValueMatch(match: ContextChunkMatch): boolean {
  const text = match.text.trim();

  if (isFallbackNormalizedBoilerplate(text)) {
    return true;
  }

  if (
    /(?:不包含本轮问题所需|不是本轮查询重点|不应进入\s*compact context|只用于评估\s*compact context|减少无关\s*token)/u.test(text) &&
    /(?:背景附录|直接把整份材料投喂给\s*LLM|铺垫|重复说明|无关\s*token|默认不应进入)/u.test(text)
  ) {
    return true;
  }

  if (/^(?:背景附录|附录|Appendix)\s*\d*/iu.test(text) && /(?:不包含|无关|铺垫|重复说明|评估\s*compact context)/u.test(text)) {
    return true;
  }

  return false;
}

function buildCompactFact(match: ContextChunkMatch): ContextCompactFact {
  return {
    text: match.text,
    chunk_id: match.chunk_id,
    title: match.title,
    ...(match.content_role ? { content_role: match.content_role } : {}),
    ...(match.chunk_level ? { chunk_level: match.chunk_level } : {}),
    ...(match.page_furniture_kind ? { page_furniture_kind: match.page_furniture_kind } : {}),
    heading_path: match.heading_path ?? [],
    estimated_tokens: match.estimated_tokens ?? estimateContextTokens(match.text),
    ...(match.page_number !== undefined ? { page_number: match.page_number } : {}),
    ...(match.line_numbers && match.line_numbers.length > 0 ? { line_numbers: match.line_numbers } : {}),
    ...(match.read_order !== undefined ? { read_order: match.read_order } : {}),
    ...(match.prev_chunk_id ? { prev_chunk_id: match.prev_chunk_id } : {}),
    ...(match.next_chunk_id ? { next_chunk_id: match.next_chunk_id } : {}),
    ...(match.parent_chunk_id ? { parent_chunk_id: match.parent_chunk_id } : {}),
    source_refs: match.source_refs ?? [],
    lineage_refs: match.lineage_refs ?? [],
    parse_diagnostic_ids: match.parse_diagnostic_ids ?? [],
    source_map_refs: match.source_map_refs ?? []
  };
}

function buildCompactTable(match: ContextChunkMatch): ContextCompactTable {
  const text = compactChunkText(match.text, 1400);

  return {
    chunk_id: match.chunk_id,
    title: match.title,
    text,
    estimated_tokens: estimateContextTokens(text),
    ...(match.page_number !== undefined ? { page_number: match.page_number } : {}),
    ...(match.line_numbers && match.line_numbers.length > 0 ? { line_numbers: match.line_numbers } : {}),
    ...(match.read_order !== undefined ? { read_order: match.read_order } : {}),
    ...(match.prev_chunk_id ? { prev_chunk_id: match.prev_chunk_id } : {}),
    ...(match.next_chunk_id ? { next_chunk_id: match.next_chunk_id } : {}),
    ...(match.parent_chunk_id ? { parent_chunk_id: match.parent_chunk_id } : {}),
    source_refs: match.source_refs ?? [],
    lineage_refs: match.lineage_refs ?? [],
    parse_diagnostic_ids: match.parse_diagnostic_ids ?? [],
    source_map_refs: match.source_map_refs ?? []
  };
}

function buildCompactPageCues(matches: ContextChunkMatch[]): ContextCompactPageCue[] {
  const cues: ContextCompactPageCue[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const sourceMapRefs = match.source_map_refs ?? [];
    const lineNumbers = match.line_numbers ?? [];
    const hasLocation = match.page_number !== undefined || lineNumbers.length > 0 || sourceMapRefs.length > 0;

    if (!hasLocation || seen.has(match.chunk_id)) {
      continue;
    }

    seen.add(match.chunk_id);
    cues.push({
      chunk_id: match.chunk_id,
      title: match.title,
      location_label: formatLocationLabel(match),
      ...(match.page_number !== undefined ? { page_number: match.page_number } : {}),
      ...(lineNumbers.length > 0 ? { line_numbers: lineNumbers } : {}),
      ...(match.read_order !== undefined ? { read_order: match.read_order } : {}),
      source_refs: match.source_refs ?? [],
      lineage_refs: match.lineage_refs ?? [],
      parse_diagnostic_ids: match.parse_diagnostic_ids ?? [],
      source_map_refs: sourceMapRefs
    });
  }

  return cues.slice(0, 30);
}

function buildCompactFragmentReads(matches: ContextChunkMatch[]): ContextCompactFragmentRead[] {
  const reads: ContextCompactFragmentRead[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    if (seen.has(match.chunk_id)) {
      continue;
    }

    seen.add(match.chunk_id);
    reads.push({
      chunk_id: match.chunk_id,
      title: match.title,
      reason_cn: fragmentReadReasonCn(match),
      cli_command: `context resolve-source <package.insight> ${match.chunk_id} --format json`,
      mcp_tool: "open_insight_resolve_source",
      mcp_arguments: { target_id: match.chunk_id },
      expected_fragment_field: "normalized_source_fragment",
      source_mode_disclosure_required: true,
      source_refs: match.source_refs ?? [],
      lineage_refs: match.lineage_refs ?? [],
      parse_diagnostic_ids: match.parse_diagnostic_ids ?? [],
      source_map_refs: match.source_map_refs ?? []
    });
  }

  return reads.slice(0, 20);
}

function fragmentReadReasonCn(match: ContextChunkMatch): string {
  if (match.chunk_level === "table" || match.content_role === "table") {
    return "补读该表格附近的 normalized source 片段，用于核对表格结构、关键数字和上下文。";
  }

  return "补读该正文 chunk 的 normalized source 片段，用于核对事实、恢复章节上下文或生成长文材料。";
}

function buildCompactCoverageHints(input: {
  eligibleCandidateMatches: ContextChunkMatch[];
  includedMatches: ContextChunkMatch[];
  tokenBudget: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  partialSourceCoverage?: boolean;
  sourceCoverageRate?: number;
  sourceCoverageReasonCn?: string;
}): ContextCompactCoverageHints {
  const includedIds = new Set(input.includedMatches.map((match) => match.chunk_id));
  const omittedMatches = input.eligibleCandidateMatches.filter((match) => !includedIds.has(match.chunk_id));
  const omittedEstimatedTokens = omittedMatches.reduce((total, match) => {
    const text = compactChunkText(match.text, match.chunk_level === "table" || match.content_role === "table" ? 1200 : 700);

    return total + estimateContextTokens(text);
  }, 0);
  const truncatedByTokenBudget = omittedMatches.length > 0;
  const recommendedNextAction: ContextCompactCoverageHints["recommended_next_action"] =
    input.includedMatches.length === 0
      ? "read_normalized_source_fragment"
      : truncatedByTokenBudget
        ? "increase_token_budget"
        : "use_compact_context";

  return {
    query_scope: "query_scoped_compact_retrieval",
    covered_heading_paths: uniqueHeadingPaths(input.includedMatches),
    covered_source_refs: uniqueStrings(input.includedMatches.flatMap((match) => match.source_refs ?? [])),
    ...(input.partialSourceCoverage
      ? {
          partial_source_coverage: true,
          source_coverage_rate: Number((input.sourceCoverageRate ?? 0).toFixed(4)),
          source_coverage_reason_cn:
            input.sourceCoverageReasonCn ??
            "compact context 只覆盖部分来源；跨文件问题需要补读未覆盖来源或披露限制。"
        }
      : {}),
    total_candidate_matches: input.eligibleCandidateMatches.length,
    included_chunk_count: input.includedMatches.length,
    truncated_by_token_budget: truncatedByTokenBudget,
    omitted_candidate_count: omittedMatches.length,
    omitted_estimated_tokens: omittedEstimatedTokens,
    recommended_next_action: recommendedNextAction,
    ...(input.fallbackUsed
      ? {
          fallback_used: true,
          fallback_reason_cn: "关键词检索无强命中或命中较弱，已退回到来源概览和阅读顺序入口。"
        }
      : {}),
    disclosure_cn:
      "这是面向当前 query 的 compact context，不是完整原文；若需要复现长文、覆盖全部章节或核对未命中内容，应按 page_cues / resolve-source 补读 normalized source 片段。"
  };
}

function uniqueHeadingPaths(matches: ContextChunkMatch[]): string[][] {
  const seen = new Set<string>();
  const paths: string[][] = [];

  for (const match of matches) {
    const headingPath = (match.heading_path && match.heading_path.length > 0 ? match.heading_path : [match.title]).filter(
      (item) => item.trim().length > 0
    );
    const key = headingPath.join("\u001f");

    if (headingPath.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    paths.push(headingPath);
  }

  return paths.slice(0, 30);
}

function formatLocationLabel(match: ContextChunkMatch): string {
  const parts: string[] = [];

  if (match.page_number !== undefined) {
    parts.push(`page ${match.page_number}`);
  }

  if (match.line_numbers && match.line_numbers.length > 0) {
    const first = match.line_numbers[0];
    const last = match.line_numbers[match.line_numbers.length - 1];
    parts.push(first === last ? `line ${first}` : `lines ${first}-${last}`);
  }

  if (parts.length === 0 && match.source_map_refs && match.source_map_refs.length > 0) {
    parts.push(`source_map ${match.source_map_refs[0]}`);
  }

  return parts.join(", ") || match.chunk_id;
}

function extractCompactNumbers(matches: ContextChunkMatch[]): ContextCompactNumber[] {
  const results: ContextCompactNumber[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const text = match.text;
    const pattern = /[-+]?\d[\d,]*(?:\.\d+)?%?|[一二三四五六七八九十百千万亿]+(?:元|万元|亿元|%|％)?/g;
    let item: RegExpExecArray | null;

    while ((item = pattern.exec(text)) !== null) {
      const value = item[0];

      if (!isCompactKeyNumberCandidate(text, item.index, value)) {
        continue;
      }

      if (seen.has(`${match.chunk_id}:${value}`)) {
        continue;
      }

      seen.add(`${match.chunk_id}:${value}`);
      results.push({
        value,
        snippet: text.slice(Math.max(0, item.index - 60), Math.min(text.length, item.index + value.length + 80)).trim(),
        chunk_id: match.chunk_id,
        source_refs: match.source_refs ?? [],
        lineage_refs: match.lineage_refs ?? [],
        parse_diagnostic_ids: match.parse_diagnostic_ids ?? [],
        source_map_refs: match.source_map_refs ?? []
      });
    }
  }

  return results;
}

function isCompactKeyNumberCandidate(text: string, index: number, value: string): boolean {
  if (!/[0-9一二三四五六七八九十百千万亿]/u.test(value)) {
    return false;
  }

  const previous = index > 0 ? text[index - 1] ?? "" : "";
  const next = text[index + value.length] ?? "";
  const normalized = value.replace(/,/g, "");

  if (!/\d/.test(value)) {
    const hasChineseNumber = /[一二三四五六七八九十百]/u.test(value);
    const hasMeasureUnit = /(元|万元|亿元|%|％)$/u.test(value);

    if (!hasChineseNumber) {
      return false;
    }

    if (!hasMeasureUnit && value.length <= 2) {
      return false;
    }
  }

  if (/^[+-]?\d/.test(value)) {
    if (/[A-Za-z]/.test(previous) || /[A-Za-z]/.test(next)) {
      return false;
    }

    if (previous === "-" || previous === "/" || next === "-" || next === "/") {
      return false;
    }

    if ((value.startsWith("-") || value.startsWith("+")) && /[\dA-Za-z]/.test(previous)) {
      return false;
    }

    if (/^[+-]?0\d+$/.test(normalized)) {
      return false;
    }

    if (/^\d$/.test(normalized)) {
      return false;
    }

    if (/^(?:19|20)\d{2}$/.test(normalized)) {
      return false;
    }
  }

  return true;
}

function compactChunkText(text: string, maxChars: number): string {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trim()}…`;
}

function clampTokenBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 2000;
  }

  return Math.min(12000, Math.max(500, Math.floor(value)));
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readPackageRelativeUtf8(packageRoot: string, relativePath: string): Promise<string | undefined> {
  const root = path.resolve(packageRoot);
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }

  return readFile(absolutePath, "utf8").catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringArrayField(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = uniqueStrings(value.filter((item): item is string => typeof item === "string" && item.length > 0));
    return values.length > 0 ? values : undefined;
  }

  if (typeof value === "string" && value.length > 0) {
    return [value];
  }

  return undefined;
}

function inferInventorySourceCategory(source: Record<string, unknown>, fallbackTitle: string): string {
  const declaredCategory = readStringField(source.category) ?? readStringField(source.document_kind) ?? readStringField(source.kind);
  if (declaredCategory) {
    return normalizeInventoryCategory(declaredCategory);
  }

  const haystack = [
    fallbackTitle,
    readStringField(source.path),
    readStringField(source.normalized_source_path),
    readStringField(source.source_id),
    readStringField(source.type)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/annual[\s_-]?report|年度报告|年报/u.test(haystack)) return "annual_report";
  if (/semi[\s_-]?annual|interim|半年度|半年报/u.test(haystack)) return "semi_annual_report";
  if (/prospectus|招募说明书|募集说明书/u.test(haystack)) return "prospectus";
  if (/legal|law|opinion|法律意见/u.test(haystack)) return "legal_opinion";
  if (/custody|trustee|托管协议|托管/u.test(haystack)) return "custody_agreement";
  if (/contract|agreement|基金合同|合同|协议/u.test(haystack)) return "contract";
  if (/audit|审计/u.test(haystack)) return "audit_report";
  if (/valuation|评估/u.test(haystack)) return "valuation_report";

  const extension = path.extname(haystack).replace(".", "");
  return extension ? `${extension}_source` : "unknown";
}

function normalizeInventoryCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/gu, "") || "unknown";
}

function inventoryCategoryLabelCn(category: string): string {
  const labels: Record<string, string> = {
    annual_report: "年度报告",
    semi_annual_report: "半年度报告",
    prospectus: "招募说明书",
    legal_opinion: "法律意见书",
    custody_agreement: "托管协议",
    contract: "合同或协议",
    audit_report: "审计报告",
    valuation_report: "评估报告",
    pdf_source: "PDF 来源",
    md_source: "Markdown 来源",
    docx_source: "Word 来源",
    xlsx_source: "Excel 来源",
    unknown: "未分类来源"
  };

  return labels[category] ?? category;
}

function isSufficiencyReviewQuery(query: string): boolean {
  return /是否|能否|足够|充分|核对|验证|审查|审计|还缺|缺少|缺哪些|sufficient|enough|verify|audit|missing/i.test(query);
}

function isTransactionStructureReviewQuery(query: string): boolean {
  return /交易结构|结构核对|交易文件|专项计划|基金合同|托管协议|法律意见|transaction\s*structure/i.test(query);
}

function buildAvailableSufficiencyEvidence(
  compact: ContextCompactRetrievalResult,
  sourceInventorySummary: ContextSourceInventorySummary
): ContextSufficiencyEvidence[] {
  const refs = new Set(compact.source_refs);
  const files = sourceInventorySummary.files.length > 0 ? sourceInventorySummary.files : [];
  const evidence = files
    .filter((file) => file.source_refs.some((ref) => refs.has(ref)))
    .map((file) => ({
      source_ref: file.source_refs[0] ?? file.source_id,
      title: file.title,
      evidence_role_cn: file.label_cn,
      parse_diagnostic_ids: file.parse_diagnostic_ids,
      source_map_refs: file.source_map_refs
    }));

  if (evidence.length > 0) {
    return evidence.slice(0, 12);
  }

  return compact.source_refs.slice(0, 12).map((sourceRef) => ({
    source_ref: sourceRef,
    title: sourceRef,
    evidence_role_cn: "compact context 命中来源",
    parse_diagnostic_ids: compact.parse_diagnostic_ids,
    source_map_refs: compact.source_map_refs
  }));
}

function buildMissingTransactionStructureEvidence(sourceInventorySummary: ContextSourceInventorySummary): ContextMissingEvidence[] {
  const categories = new Set(sourceInventorySummary.categories.map((category) => category.category));
  const candidates: ContextMissingEvidence[] = [
    { evidence_type: "legal_opinion", label_cn: "法律意见书", reason_cn: "完整核对交易结构通常需要法律意见书确认结构合法性和关键安排。" },
    { evidence_type: "contract", label_cn: "基金合同", reason_cn: "完整核对交易结构通常需要基金合同或核心交易合同确认权利义务。" },
    { evidence_type: "custody_agreement", label_cn: "托管协议", reason_cn: "完整核对资金监管和托管安排通常需要托管协议。" }
  ];

  return candidates.filter((candidate) => !categories.has(candidate.evidence_type));
}

function buildGenericMissingEvidence(sourceInventorySummary: ContextSourceInventorySummary): ContextMissingEvidence[] {
  if (sourceInventorySummary.status === "unavailable") {
    return [
      { evidence_type: "source_inventory", label_cn: "来源清单", reason_cn: "缺少来源清单时，无法判断当前上下文覆盖了哪些文件。" },
      { evidence_type: "source_bundled_or_external_refs", label_cn: "原始来源或外部引用", reason_cn: "source_light 场景需要外部原始文件或 source_bundled 包完成最终复核。" }
    ];
  }

  return [
    {
      evidence_type: "source_bundled_or_external_refs",
      label_cn: "原始来源或外部引用",
      reason_cn: "如果问题要求审计级结论，应回到原始文件或 source_bundled 包复核版式、签章和完整附件。"
    }
  ];
}

function estimateContextTokens(text: string): number {
  const cjkChars = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  const otherChars = Math.max(0, text.length - cjkChars);

  return Math.max(1, Math.ceil(cjkChars * 0.8 + otherChars / 4));
}

function estimateConservativeContextTokens(text: string): number {
  const asciiChars = text.match(/[A-Za-z0-9_]+/gu)?.join("").length ?? 0;
  const nonAsciiChars = Math.max(0, text.length - asciiChars);

  return Math.max(1, Math.ceil(asciiChars / 4 + nonAsciiChars / 1.7));
}

const TEXT_BASELINE_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".html", ".htm", ".xml", ".yaml", ".yml", ".log", ".sql"]);
const DOCUMENT_BINARY_BASELINE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"]);
const SKIPPED_BASELINE_DIRECTORIES = new Set([".git", "node_modules", ".gemini", "unpacked", "output", "outputs"]);
const MAX_DIRECT_BASELINE_FILES = 200;
const DIRECT_BASELINE_TEXT_ESTIMATOR_VERSION = "open-insight.direct-baseline-text.v1";
const DIRECT_BASELINE_TEXT_ESTIMATION_MODE = "streaming_utf8_allowlisted_text";

function normalizeBaselineExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizeBaselinePath(value: string): string {
  return String(value ?? "").replace(/\\/g, "/").toLowerCase();
}

function normalizePathContainsList(value: string[] | undefined): string[] {
  return uniqueStrings(
    (value ?? [])
      .map((item) => normalizeBaselinePath(item).trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean)
      .filter((item) => !item.includes(".."))
  ).sort();
}

function normalizeExternalBaselineSourceFilter(filter?: Partial<ExternalBaselineSourceFilter>): ExternalBaselineSourceFilter {
  const includeExtensions =
    filter?.include_extensions === null || filter?.include_extensions === undefined
      ? null
      : uniqueStrings(filter.include_extensions.map(normalizeBaselineExtension).filter(Boolean)).sort();
  const excludeExtensions = uniqueStrings((filter?.exclude_extensions ?? []).map(normalizeBaselineExtension).filter(Boolean)).sort();
  const excludePathContains = normalizePathContainsList(filter?.exclude_path_contains);

  return {
    include_extensions: includeExtensions && includeExtensions.length > 0 ? includeExtensions : null,
    exclude_extensions: excludeExtensions,
    exclude_path_contains: excludePathContains
  };
}

function baselineFilePassesSourceFilter(filePath: string, filter: ExternalBaselineSourceFilter): boolean {
  const normalizedPath = normalizeBaselinePath(filePath);
  const extension = normalizeBaselineExtension(path.extname(filePath) || "(none)");

  if (filter.exclude_path_contains.some((fragment) => normalizedPath.includes(fragment))) {
    return false;
  }

  if (filter.include_extensions && !filter.include_extensions.includes(extension)) {
    return false;
  }
  if (filter.exclude_extensions.includes(extension)) {
    return false;
  }

  return true;
}

function getExternalBaselineQuality(methods: ExternalBaselineEstimationMethods): ExternalBaselineQuality {
  if (methods.decoded_text_file_count === 0 && methods.binary_size_heuristic_file_count === 0 && methods.large_text_size_heuristic_file_count === 0) {
    return "empty";
  }
  if (methods.decoded_text_file_count > 0 && methods.binary_size_heuristic_file_count === 0 && methods.large_text_size_heuristic_file_count === 0) {
    return "decoded_text";
  }
  if (methods.decoded_text_file_count === 0 && methods.binary_size_heuristic_file_count > 0 && methods.large_text_size_heuristic_file_count === 0) {
    return "binary_size_heuristic_only";
  }
  if (methods.decoded_text_file_count === 0 && methods.binary_size_heuristic_file_count === 0 && methods.large_text_size_heuristic_file_count > 0) {
    return "large_text_size_heuristic_only";
  }

  return "mixed";
}

function getExternalBaselineAction(quality: ExternalBaselineQuality): string {
  if (quality === "decoded_text") {
    return "当前 direct baseline 来自可解码文本，适合模拟用户直接把 Markdown/text 转置结果交给 LLM 的 token 成本。";
  }
  if (quality === "binary_size_heuristic_only") {
    return "当前 direct baseline 主要按 PDF/Office/图片等二进制文件大小估算；如需更公平比较，请先用 MarkItDown 或同类工具转成 Markdown/text 后再作为 --direct-baseline。";
  }
  if (quality === "large_text_size_heuristic_only") {
    return "当前 direct baseline 是超大文本文件大小近似估算；如需更准确比较，请拆分或传入实际会交给 LLM 的文本片段。";
  }
  if (quality === "mixed") {
    return "当前 direct baseline 混合了可解码文本和大小近似估算；报告可用于粗验收，但建议把 PDF/Office 转成 Markdown/text 后复测。";
  }

  return "当前 direct baseline 没有可估算文件；请检查路径，或传入原文件夹、原文件、Markdown/text 转置结果。";
}

export function normalizeExternalBaselineSummary(summary: Partial<ExternalBaselineSummary>): ExternalBaselineSummary {
  const estimationMethods = summary.estimation_methods ?? {
    decoded_text_file_count: 0,
    binary_size_heuristic_file_count: 0,
    large_text_size_heuristic_file_count: 0
  };
  const baselineQuality = summary.baseline_quality ?? getExternalBaselineQuality(estimationMethods);
  const isLegacySummary = summary.estimator_version !== DIRECT_BASELINE_TEXT_ESTIMATOR_VERSION;
  const diagnostics = uniqueStrings([
    ...(summary.diagnostics ?? []),
    ...(isLegacySummary
      ? ["direct baseline summary 缺少当前 estimator_version；为避免混用旧的大文本 size heuristic 缓存，建议重新执行 direct baseline 扫描后再复用摘要。"]
      : [])
  ]);

  return {
    estimated_tokens: Math.max(0, Math.floor(summary.estimated_tokens ?? 0)),
    file_count: Math.max(0, Math.floor(summary.file_count ?? 0)),
    total_bytes: Math.max(0, Math.floor(summary.total_bytes ?? 0)),
    text_file_count: Math.max(0, Math.floor(summary.text_file_count ?? 0)),
    binary_file_count: Math.max(0, Math.floor(summary.binary_file_count ?? 0)),
    skipped_file_count: Math.max(0, Math.floor(summary.skipped_file_count ?? 0)),
    filtered_file_count: Math.max(0, Math.floor(summary.filtered_file_count ?? 0)),
    included_extensions: uniqueStrings(summary.included_extensions ?? []).sort(),
    source_filter: normalizeExternalBaselineSourceFilter(summary.source_filter),
    baseline_input_kind: summary.baseline_input_kind === "file" ? "file" : "directory",
    baseline_quality: baselineQuality,
    recommended_baseline_action_cn: summary.recommended_baseline_action_cn || getExternalBaselineAction(baselineQuality),
    estimation_methods: {
      decoded_text_file_count: Math.max(0, Math.floor(estimationMethods.decoded_text_file_count ?? 0)),
      binary_size_heuristic_file_count: Math.max(0, Math.floor(estimationMethods.binary_size_heuristic_file_count ?? 0)),
      large_text_size_heuristic_file_count: Math.max(0, Math.floor(estimationMethods.large_text_size_heuristic_file_count ?? 0))
    },
    estimator_version: isLegacySummary ? "legacy_unknown" : DIRECT_BASELINE_TEXT_ESTIMATOR_VERSION,
    estimation_mode: typeof summary.estimation_mode === "string" && summary.estimation_mode.length > 0 ? summary.estimation_mode : "legacy_cached_summary",
    ...(typeof summary.input_fingerprint === "string" && /^[a-f0-9]{64}$/iu.test(summary.input_fingerprint)
      ? { input_fingerprint: summary.input_fingerprint.toLowerCase() }
      : {}),
    diagnostics
  };
}

async function readExternalBaselineSummary(
  inputPath: string,
  sourceFilterInput?: Partial<ExternalBaselineSourceFilter>
): Promise<ExternalBaselineSummary> {
  const absoluteInputPath = path.resolve(inputPath);
  const inputStat = await stat(absoluteInputPath);
  const inputKind = inputStat.isDirectory() ? "directory" : "file";
  const sourceFilter = normalizeExternalBaselineSourceFilter(sourceFilterInput);
  const inventory =
    inputKind === "directory"
      ? await listExternalBaselineFiles(absoluteInputPath, "", { files: [], skipped_file_count: 0, filtered_file_count: 0 }, sourceFilter)
      : baselineFilePassesSourceFilter(absoluteInputPath, sourceFilter)
        ? { files: [""], skipped_file_count: 0, filtered_file_count: 0 }
        : { files: [], skipped_file_count: 0, filtered_file_count: 1 };
  const extensions = new Set<string>();
  let estimatedTokens = 0;
  let totalBytes = 0;
  let textFileCount = 0;
  let binaryFileCount = 0;
  const estimationMethods: ExternalBaselineEstimationMethods = {
    decoded_text_file_count: 0,
    binary_size_heuristic_file_count: 0,
    large_text_size_heuristic_file_count: 0
  };
  const inputFingerprint = createHash("sha256");
  inputFingerprint.update(`${DIRECT_BASELINE_TEXT_ESTIMATOR_VERSION}\0${JSON.stringify(sourceFilter)}\0`);

  for (const relativePath of inventory.files) {
    const absolutePath = inputKind === "directory" ? path.join(absoluteInputPath, relativePath) : absoluteInputPath;
    const fileStat = await stat(absolutePath).catch(() => undefined);

    if (!fileStat?.isFile()) {
      continue;
    }

    const extension = (path.extname(absolutePath).toLowerCase() || "(none)").slice(0, 24);
    extensions.add(extension);
    totalBytes += fileStat.size;
    inputFingerprint.update(`${relativePath.replaceAll("\\", "/")}\0${fileStat.size}\0${Math.floor(fileStat.mtimeMs)}\0${extension}\0`);

    if (TEXT_BASELINE_EXTENSIONS.has(extension)) {
      textFileCount += 1;
      estimationMethods.decoded_text_file_count += 1;
      estimatedTokens += await estimateUtf8FileTokens(absolutePath);
    } else {
      binaryFileCount += 1;
      estimationMethods.binary_size_heuristic_file_count += 1;
      estimatedTokens += Math.max(1, Math.ceil(fileStat.size / 3));
    }
  }

  const diagnostics: string[] = [];
  const baselineQuality = getExternalBaselineQuality(estimationMethods);
  if (binaryFileCount > 0) {
    diagnostics.push("direct baseline 包含二进制或超大文本文件，token 使用文件大小近似估算；如需更接近模型输入，请传入对应 Markdown/text 转置结果。");
  }
  if (estimationMethods.binary_size_heuristic_file_count > 0 && Array.from(extensions).some((extension) => DOCUMENT_BINARY_BASELINE_EXTENSIONS.has(extension))) {
    diagnostics.push("direct baseline 包含 PDF/Office/图片等二进制文件，当前 token 使用文件大小近似；建议先用 MarkItDown 或同类工具生成 normalized Markdown/text 后再复测。");
  }
  if (inventory.skipped_file_count > 0) {
    diagnostics.push(`direct baseline 文件数超过 ${MAX_DIRECT_BASELINE_FILES} 个，已跳过 ${inventory.skipped_file_count} 个文件或目录。`);
  }
  if (inventory.filtered_file_count > 0) {
    diagnostics.push(`direct baseline 已按 source_filter 过滤 ${inventory.filtered_file_count} 个不在本次 proof scope 内的文件。`);
  }
  if (inventory.files.length === 0) {
    diagnostics.push("direct baseline 没有可估算文件，已保留结果但 savings_vs_direct 可能失真。");
  }

  return {
    estimated_tokens: estimatedTokens,
    file_count: inventory.files.length,
    total_bytes: totalBytes,
    text_file_count: textFileCount,
    binary_file_count: binaryFileCount,
    skipped_file_count: inventory.skipped_file_count,
    filtered_file_count: inventory.filtered_file_count,
    included_extensions: Array.from(extensions).sort(),
    source_filter: sourceFilter,
    baseline_input_kind: inputKind,
    baseline_quality: baselineQuality,
    recommended_baseline_action_cn: getExternalBaselineAction(baselineQuality),
    estimation_methods: estimationMethods,
    estimator_version: DIRECT_BASELINE_TEXT_ESTIMATOR_VERSION,
    estimation_mode: getDirectBaselineEstimationMode(estimationMethods),
    input_fingerprint: inputFingerprint.digest("hex"),
    diagnostics
  };
}

async function estimateUtf8FileTokens(filePath: string): Promise<number> {
  let cjkChars = 0;
  let otherChars = 0;

  for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) {
    const text = String(chunk);
    const cjkCount = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
    cjkChars += cjkCount;
    otherChars += Math.max(0, text.length - cjkCount);
  }

  return Math.max(1, Math.ceil(cjkChars * 0.8 + otherChars / 4));
}

function getDirectBaselineEstimationMode(methods: ExternalBaselineEstimationMethods): string {
  if (methods.decoded_text_file_count > 0 && methods.binary_size_heuristic_file_count > 0) {
    return "mixed_streaming_utf8_and_size_heuristic";
  }
  if (methods.decoded_text_file_count > 0) {
    return DIRECT_BASELINE_TEXT_ESTIMATION_MODE;
  }
  if (methods.binary_size_heuristic_file_count > 0) {
    return "size_heuristic_unknown_or_binary";
  }
  return "empty";
}

async function listExternalBaselineFiles(
  root: string,
  prefix = "",
  state: { files: string[]; skipped_file_count: number; filtered_file_count: number } = {
    files: [],
    skipped_file_count: 0,
    filtered_file_count: 0
  },
  sourceFilter: ExternalBaselineSourceFilter = normalizeExternalBaselineSourceFilter()
): Promise<{ files: string[]; skipped_file_count: number; filtered_file_count: number }> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (state.files.length >= MAX_DIRECT_BASELINE_FILES) {
      state.skipped_file_count += 1;
      continue;
    }

    if (entry.isDirectory() && SKIPPED_BASELINE_DIRECTORIES.has(entry.name)) {
      state.skipped_file_count += 1;
      continue;
    }

    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      await listExternalBaselineFiles(root, relativePath, state, sourceFilter);
    } else if (entry.isFile()) {
      if (baselineFilePassesSourceFilter(relativePath, sourceFilter)) {
        state.files.push(relativePath);
      } else {
        state.filtered_file_count += 1;
      }
    }
  }

  return state;
}

async function readNormalizedSourceTexts(packageRoot: string): Promise<Array<{ path: string; text: string }>> {
  const root = path.join(packageRoot, "source/normalized");
  const files = await listFiles(root).catch(() => []);
  const results: Array<{ path: string; text: string }> = [];

  for (const file of files.filter((item) => /\.(md|txt|csv|json)$/i.test(item))) {
    const absolutePath = path.join(root, file);
    results.push({ path: `source/normalized/${file.replace(/\\/g, "/")}`, text: await readFile(absolutePath, "utf8") });
  }

  return results;
}

async function readQueryIndexChunkRecords(packageRoot: string): Promise<QueryIndexChunkRecord[]> {
  const manifest = await readQueryIndexManifest(packageRoot);
  const directIndexPath = readStringField(manifest?.direct_index_path) ?? "query_index/chunks.jsonl";
  let text: string;

  try {
    text = await readFile(path.join(packageRoot, directIndexPath), "utf8");
  } catch {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);

        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? [normalizeQueryIndexChunkRecord(parsed as Record<string, unknown>)]
          : [];
      } catch {
        return [];
      }
    });
}

function normalizeQueryIndexChunkRecord(record: Record<string, unknown>): QueryIndexChunkRecord {
  const text = typeof record.text === "string" ? record.text : "";
  const estimatedTokens =
    typeof record.estimated_tokens === "number" && Number.isFinite(record.estimated_tokens)
      ? Math.max(1, Math.floor(record.estimated_tokens))
      : estimateContextTokens(text);

  return {
    chunk_id: typeof record.chunk_id === "string" ? record.chunk_id : "",
    ...(typeof record.source_id === "string" ? { source_id: record.source_id } : {}),
    ...(Array.isArray(record.source_refs)
      ? { source_refs: record.source_refs.filter((item): item is string => typeof item === "string") }
      : {}),
    text,
    chunk_level: typeof record.chunk_level === "string" ? record.chunk_level : "unknown",
    content_role: typeof record.content_role === "string" ? record.content_role : "unknown",
    estimated_tokens: estimatedTokens
  };
}

function buildContextNoiseMetrics(input: {
  normalizedTokens: number;
  compact: ContextCompactRetrievalResult;
  queryIndexChunks: QueryIndexChunkRecord[];
}): ContextNoiseMetrics {
  const includedChunkIds = new Set([...input.compact.facts.map((fact) => fact.chunk_id), ...input.compact.tables.map((table) => table.chunk_id)]);
  const pageFurnitureChunks = input.queryIndexChunks.filter((chunk) => chunk.content_role === "page_furniture" || chunk.chunk_level === "page_furniture");
  const disclaimerChunks = input.queryIndexChunks.filter((chunk) => chunk.content_role === "disclaimer");
  const documentChunks = input.queryIndexChunks.filter((chunk) => chunk.chunk_level === "document");
  const fineGrainedChunks = input.queryIndexChunks.filter(isFineGrainedQueryChunk);
  const nonReturnedFineGrainedChunks = fineGrainedChunks.filter((chunk) => !includedChunkIds.has(chunk.chunk_id));
  const compactItems = [...input.compact.facts, ...input.compact.tables] as Array<{
    estimated_tokens?: number;
    content_role?: string;
    chunk_level?: string;
  }>;
  const compactNoiseTokens = sumEstimatedTokens(
    compactItems.filter(
      (item) => item.content_role === "page_furniture" || item.content_role === "disclaimer" || item.chunk_level === "document"
    )
  );
  const rawNoiseTokens =
    input.queryIndexChunks.length > 0
      ? sumEstimatedTokens(pageFurnitureChunks) + sumEstimatedTokens(disclaimerChunks) + sumEstimatedTokens(nonReturnedFineGrainedChunks)
      : Math.max(0, input.normalizedTokens - input.compact.estimated_tokens);
  const estimatedNoiseTokensRemoved = Math.min(Math.max(0, input.normalizedTokens), Math.max(0, rawNoiseTokens));
  const noiseReductionRate =
    estimatedNoiseTokensRemoved > 0
      ? Math.max(0, (estimatedNoiseTokensRemoved - compactNoiseTokens) / estimatedNoiseTokensRemoved)
      : input.normalizedTokens > 0
        ? Math.max(0, (input.normalizedTokens - input.compact.estimated_tokens) / input.normalizedTokens)
        : 0;

  return {
    measurement_mode: input.queryIndexChunks.length > 0 ? "query_index_chunks" : "token_delta_fallback",
    noise_basis: "deterministic_query_scoped_filtering",
    total_index_chunk_count: input.queryIndexChunks.length,
    included_chunk_count: input.compact.included_chunk_count,
    excluded_chunk_count: Math.max(0, input.queryIndexChunks.length - input.compact.included_chunk_count),
    page_furniture_filtered_count: pageFurnitureChunks.length,
    page_furniture_filtered_tokens: sumEstimatedTokens(pageFurnitureChunks),
    disclaimer_filtered_count: disclaimerChunks.length,
    disclaimer_filtered_tokens: sumEstimatedTokens(disclaimerChunks),
    document_chunk_excluded_count: documentChunks.length,
    document_chunk_excluded_tokens: sumEstimatedTokens(documentChunks),
    non_returned_fine_grained_chunk_count: nonReturnedFineGrainedChunks.length,
    non_returned_fine_grained_tokens: sumEstimatedTokens(nonReturnedFineGrainedChunks),
    compact_noise_tokens: compactNoiseTokens,
    estimated_noise_tokens_removed: estimatedNoiseTokensRemoved,
    noise_reduction_rate: Number(noiseReductionRate.toFixed(4)),
    compact_default_excludes: {
      content_roles: ["page_furniture", "disclaimer"],
      chunk_levels: ["document", "page_furniture"]
    }
  };
}

function buildTokenPathNoiseMetrics(totalTokens: number, noiseTokens: number): ContextTokenPathNoiseMetrics {
  const boundedNoiseTokens = Math.min(Math.max(0, Math.floor(noiseTokens)), Math.max(0, Math.floor(totalTokens)));

  return {
    estimated_noise_tokens: boundedNoiseTokens,
    estimated_useful_tokens: Math.max(0, Math.floor(totalTokens) - boundedNoiseTokens),
    noise_ratio: Number(safeRatio(boundedNoiseTokens, Math.max(1, Math.floor(totalTokens))).toFixed(4))
  };
}

function isFineGrainedQueryChunk(chunk: QueryIndexChunkRecord): boolean {
  if (chunk.chunk_level === "document" || chunk.chunk_level === "page_furniture") {
    return false;
  }

  if (chunk.content_role === "page_furniture" || chunk.content_role === "disclaimer") {
    return false;
  }

  return chunk.chunk_level === "section" || chunk.chunk_level === "paragraph" || chunk.chunk_level === "table" || chunk.content_role === "table";
}

function evaluateTableContextCoverage(
  chunks: QueryIndexChunkRecord[],
  query: string,
  compactTables: ContextCompactTable[]
): {
  applicability: "required" | "advisory" | "not_applicable";
  candidate_count: number;
  required_candidate_count: number;
  covered_required_candidate_count: number;
  coverage_rate: number;
  required_candidate_coverage_rate: number;
} {
  const terms = extractFallbackQueryTerms(query);
  const tableChunks = chunks.filter((chunk) => chunk.chunk_level === "table" || chunk.content_role === "table");
  const narrativeChunks = chunks.filter(
    (chunk) =>
      chunk.chunk_level !== "table" &&
      chunk.content_role !== "table" &&
      chunk.chunk_level === "paragraph"
  );

  const matchesAnyTerm = (chunk: QueryIndexChunkRecord) => {
    if (terms.length === 0) {
      return true;
    }

    const haystack = chunk.text.toLowerCase();

    return terms.some((term) => haystack.includes(term));
  };
  const matchesAllTerms = (chunk: QueryIndexChunkRecord) => {
    if (terms.length === 0) {
      return false;
    }

    const haystack = chunk.text.toLowerCase();

    return terms.every((term) => haystack.includes(term));
  };
  const tableCandidates = tableChunks.filter(matchesAnyTerm);

  if (tableCandidates.length === 0) {
    return {
      applicability: "not_applicable",
      candidate_count: 0,
      required_candidate_count: 0,
      covered_required_candidate_count: 0,
      coverage_rate: 1,
      required_candidate_coverage_rate: 1
    };
  }

  const requiredCandidates =
    tableCandidates.some(matchesAllTerms) && !narrativeChunks.some(matchesAllTerms)
      ? tableCandidates.filter(matchesAllTerms)
      : [];
  const compactTableIds = new Set(compactTables.map((table) => table.chunk_id));
  const coveredCandidateCount = tableCandidates.filter((chunk) => compactTableIds.has(chunk.chunk_id)).length;
  const coveredRequiredCandidateCount = requiredCandidates.filter((chunk) => compactTableIds.has(chunk.chunk_id)).length;

  return {
    applicability: requiredCandidates.length > 0 ? "required" : "advisory",
    candidate_count: tableCandidates.length,
    required_candidate_count: requiredCandidates.length,
    covered_required_candidate_count: coveredRequiredCandidateCount,
    coverage_rate: Math.min(1, safeRatio(coveredCandidateCount, tableCandidates.length)),
    required_candidate_coverage_rate:
      requiredCandidates.length > 0 ? Math.min(1, safeRatio(coveredRequiredCandidateCount, requiredCandidates.length)) : 1
  };
}

function sumEstimatedTokens(chunks: Array<{ estimated_tokens?: number }>): number {
  return chunks.reduce((total, chunk) => total + Math.max(0, Math.floor(chunk.estimated_tokens ?? 0)), 0);
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function countTraceableFacts(compact: ContextCompactRetrievalResult, key: "source_refs" | "parse_diagnostic_ids"): number {
  return [...compact.facts, ...compact.tables].filter((item) => item[key].length > 0).length;
}

function calculateNumericPreservationRate(fullText: string, compactText: string): number {
  const numbers = uniqueStrings(compactText.match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g) ?? []);

  if (numbers.length === 0) {
    return 1;
  }

  const preserved = numbers.filter((number) => fullText.includes(number)).length;

  return safeRatio(preserved, numbers.length);
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

function readStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseStringArrayField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

function parseNumberArrayField(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is number => Number.isInteger(item) && item > 0);
  }

  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item) && item > 0) : [];
  } catch {
    return [];
  }
}

function normalizeIndexedContentRole(value: unknown): NonNullable<ContextChunkMatch["content_role"]> {
  if (
    value === "body" ||
    value === "table" ||
    value === "heading" ||
    value === "page_furniture" ||
    value === "disclaimer" ||
    value === "source_overview"
  ) {
    return value;
  }

  return "body";
}

function normalizeIndexedChunkLevel(value: unknown): NonNullable<ContextChunkMatch["chunk_level"]> {
  if (
    value === "document" ||
    value === "section" ||
    value === "paragraph" ||
    value === "table" ||
    value === "page_furniture" ||
    value === "source_overview"
  ) {
    return value;
  }

  return "unknown";
}

function sqliteTableHasColumn(db: SqlJsDatabase, tableName: string, columnName: string): boolean {
  const statement = db.prepare(`PRAGMA table_info(${tableName});`);

  try {
    while (statement.step()) {
      const row = statement.getAsObject();

      if (row.name === columnName) {
        return true;
      }
    }
  } finally {
    statement.free();
  }

  return false;
}

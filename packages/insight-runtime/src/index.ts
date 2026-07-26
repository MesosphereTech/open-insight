import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, readJsonlFile, readManifest } from "@open-insight/core";

export interface ModelAdapter {
  name: string;
  chat(input: ModelChatInput): Promise<ModelChatOutput>;
}

export interface ModelChatInput {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}

export interface ModelChatOutput {
  content: string;
}

export class MockModelAdapter implements ModelAdapter {
  readonly name = "mock";

  async chat(input: ModelChatInput): Promise<ModelChatOutput> {
    const lastUserMessage = [...input.messages].reverse().find((message) => message.role === "user");
    const groundedOutput = buildMockGroundedModelOutput(lastUserMessage?.content);

    if (groundedOutput) {
      return {
        content: JSON.stringify(groundedOutput)
      };
    }

    return {
      content: `模拟模型回答：${lastUserMessage?.content ?? "没有用户消息"}`
    };
  }
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleModelAdapterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  name?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

interface ResolvedOpenAICompatibleModelAdapterConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface OpenAICompatibleModelPublicConfig {
  baseUrl: string;
  model: string;
  name: string;
}

export interface OpenAICompatibleModelEndpointPublicConfig {
  baseUrl: string;
  name: string;
}

export type OpenAICompatibleModelEndpointConfigResolution =
  | {
      available: true;
      source: OpenAICompatibleModelEnvSource;
      config: OpenAICompatibleModelEndpointPublicConfig;
      missing: [];
      message: string;
    }
  | {
      available: false;
      source: OpenAICompatibleModelEnvSource;
      missing: string[];
      message: string;
    };

export interface OpenAICompatibleModelListItem {
  id: string;
}

export interface OpenAICompatibleModelListResult {
  source: OpenAICompatibleModelEnvSource;
  baseUrl: string;
  name: string;
  models: OpenAICompatibleModelListItem[];
}

export interface ListOpenAICompatibleModelsFromEnvOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
}

export class OpenAICompatibleModelAdapter implements ModelAdapter {
  readonly name: string;

  private readonly config: ResolvedOpenAICompatibleModelAdapterConfig;
  private readonly fetchImpl: FetchLike;
  private readonly chatCompletionsUrl: string;

  constructor(config: OpenAICompatibleModelAdapterConfig) {
    const baseUrl = normalizeRequiredConfigValue(config.baseUrl, "baseUrl");
    const apiKey = normalizeRequiredConfigValue(config.apiKey, "apiKey");
    const model = normalizeRequiredConfigValue(config.model, "model");
    const defaultFetch = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
    const fetchImpl = config.fetch ?? defaultFetch;

    if (!fetchImpl) {
      throw new Error("OpenAI 兼容模型适配器需要可用的 fetch 实现。");
    }

    this.name = normalizeOptionalConfigValue(config.name) ?? "openai-compatible";
    this.config = {
      baseUrl,
      apiKey,
      model,
      timeoutMs: config.timeoutMs ?? 30000
    };
    this.fetchImpl = fetchImpl;
    this.chatCompletionsUrl = buildChatCompletionsUrl(baseUrl);
  }

  async chat(input: ModelChatInput): Promise<ModelChatOutput> {
    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      messages: input.messages
    };

    if (input.temperature !== undefined) {
      requestBody.temperature = input.temperature;
    }

    if (input.max_tokens !== undefined) {
      requestBody.max_tokens = input.max_tokens;
    }

    if (input.response_format !== undefined) {
      requestBody.response_format = input.response_format;
    }

    const response = await this.fetchWithTimeout(requestBody);

    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : "";
      throw new Error(`模型请求失败：HTTP ${response.status}${statusText}`);
    }

    const payload = await readResponseJson(response);
    const content = extractChatMessageContent(payload);

    if (content === undefined) {
      throw new Error("模型响应格式无法识别：缺少 choices[0].message.content。");
    }

    return { content };
  }

  private async fetchWithTimeout(body: Record<string, unknown>): Promise<Response> {
    const timeoutMs = this.config.timeoutMs;
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : undefined;

    try {
      return await this.fetchImpl(this.chatCompletionsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (error) {
      if (isNamedError(error, "AbortError")) {
        throw new Error(`模型请求超时：超过 ${timeoutMs}ms。`);
      }

      throw new Error(`模型请求失败：${redactSecret(getUnknownErrorMessage(error), this.config.apiKey)}`);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

export type ModelAdapterEnvRecord = Record<string, string | undefined>;

export type OpenAICompatibleModelEnvSource = "open_insight" | "xiaomi";

export type OpenAICompatibleModelConfigResolution =
  | {
      available: true;
      source: OpenAICompatibleModelEnvSource;
      config: OpenAICompatibleModelPublicConfig;
      missing: [];
      message: string;
    }
  | {
      available: false;
      source: OpenAICompatibleModelEnvSource;
      missing: string[];
      message: string;
    };

export interface CreateOpenAICompatibleModelAdapterFromEnvOptions {
  name?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function resolveOpenAICompatibleModelConfigFromEnv(
  env: ModelAdapterEnvRecord = readDefaultEnv()
): OpenAICompatibleModelConfigResolution {
  const envConfig = readOpenAICompatibleEnvConfig(env);

  if (!envConfig.baseUrl || !envConfig.apiKey || !envConfig.model) {
    return {
      available: false,
      source: envConfig.source,
      missing: envConfig.missing,
      message: `真实模型未启用：缺少 ${envConfig.missing.join("、")}。Reader 和预置问答仍可离线使用。`
    };
  }

  return {
    available: true,
    source: envConfig.source,
    config: {
      baseUrl: envConfig.baseUrl,
      model: envConfig.model,
      name: envConfig.name
    },
    missing: [],
    message: "真实模型配置可用。"
  };
}

export function resolveOpenAICompatibleModelEndpointConfigFromEnv(
  env: ModelAdapterEnvRecord = readDefaultEnv()
): OpenAICompatibleModelEndpointConfigResolution {
  const envConfig = readOpenAICompatibleEnvConfig(env);
  const missing = envConfig.missing.filter(
    (item) => item !== "OPEN_INSIGHT_MODEL_NAME 或 XIAOMI_MODEL"
  );

  if (!envConfig.baseUrl || !envConfig.apiKey) {
    return {
      available: false,
      source: envConfig.source,
      missing,
      message: `真实模型列表不可用：缺少 ${missing.join("、")}。该命令不会读取或发送任何 .insight 包数据。`
    };
  }

  return {
    available: true,
    source: envConfig.source,
    config: {
      baseUrl: envConfig.baseUrl,
      name: envConfig.name
    },
    missing: [],
    message: "真实模型列表配置可用。"
  };
}

export async function listOpenAICompatibleModelsFromEnv(
  env: ModelAdapterEnvRecord = readDefaultEnv(),
  options: ListOpenAICompatibleModelsFromEnvOptions = {}
): Promise<OpenAICompatibleModelListResult> {
  const envConfig = readOpenAICompatibleEnvConfig(env);
  const endpointResolution = resolveOpenAICompatibleModelEndpointConfigFromEnv(env);

  if (!endpointResolution.available || !envConfig.baseUrl || !envConfig.apiKey) {
    throw new Error(endpointResolution.message);
  }

  const fetchImpl = options.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);

  if (!fetchImpl) {
    throw new Error("列出真实模型需要可用的 fetch 实现。");
  }

  const modelsUrl = buildModelsUrl(envConfig.baseUrl);

  try {
    const response = await fetchWithTimeout(fetchImpl, modelsUrl, envConfig.apiKey, options.timeoutMs ?? 30000);

    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : "";
      throw new Error(`HTTP ${response.status}${statusText}`);
    }

    const payload = await readResponseJson(response);

    return {
      source: envConfig.source,
      baseUrl: envConfig.baseUrl,
      name: envConfig.name,
      models: extractModelListItems(payload)
    };
  } catch (error) {
    throw new Error(`真实模型列表请求失败：${redactSecret(getUnknownErrorMessage(error), envConfig.apiKey)}`);
  }
}

export function createOpenAICompatibleModelAdapterFromEnv(
  env: ModelAdapterEnvRecord = readDefaultEnv(),
  options: CreateOpenAICompatibleModelAdapterFromEnvOptions = {}
): OpenAICompatibleModelAdapter | undefined {
  const envConfig = readOpenAICompatibleEnvConfig(env);

  if (!envConfig.baseUrl || !envConfig.apiKey || !envConfig.model) {
    return undefined;
  }

  return new OpenAICompatibleModelAdapter({
    baseUrl: envConfig.baseUrl,
    apiKey: envConfig.apiKey,
    model: envConfig.model,
    name: options.name ?? envConfig.name,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
  });
}

export interface EvidenceRecord {
  evidence_id: string;
  type: string;
  summary: string;
  query?: string;
  source_refs?: EvidenceSourceRefRecord[];
  values?: Array<Record<string, string | number>>;
  missing_fields?: string[];
}

export interface EvidenceSourceRefRecord {
  dataset_id: string;
  path?: string;
}

export interface ClaimRecord {
  claim_id: string;
  status: string;
  summary: string;
  metric_ids?: string[];
  evidence_ids?: string[];
  created_by?: string;
}

export interface PreparedQuestionRecord {
  question_id: string;
  question: string;
  answer: string;
  status: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  data_request_ids?: string[];
  active_data_request_ids?: string[];
}

export interface DataRequestRecord {
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

interface MetricsFile {
  metrics: Array<{
    metric_id: string;
    name: string;
    definition: string;
    formula: string;
    unit?: string;
    dataset_id?: string;
  }>;
}

interface DataCatalogFile {
  datasets: DatasetRecord[];
}

export interface DatasetRecord {
  dataset_id: string;
  path?: string;
  format?: string;
  description?: string;
  grain?: string;
  columns?: Array<{ name: string; type?: string; description?: string }>;
}

interface LineageSourcesFile {
  sources: LineageSourceRecord[];
}

export interface LineageSourceRecord {
  source_id: string;
  type: string;
  path?: string;
  description?: string;
}

export interface EvidenceLookupInput {
  evidence_id: string;
}

export interface EvidenceLookupResult {
  found: boolean;
  evidence_id: string;
  evidence?: EvidenceRecord;
}

export interface EvidenceSourcesLookupInput {
  evidence_id: string;
}

export interface EvidenceSourceTrace {
  source_ref: EvidenceSourceRefRecord;
  resolved_path?: string;
  dataset?: {
    dataset_id: string;
    path?: string;
    format?: string;
    column_count?: number;
  };
  lineage_source?: {
    source_id: string;
    type: string;
    path?: string;
  };
}

export interface EvidenceSourcesLookupResult {
  found: boolean;
  evidence_id: string;
  sources: EvidenceSourceTrace[];
}

export interface ClaimLookupInput {
  claim_id: string;
}

export interface ClaimLookupResult {
  found: boolean;
  claim_id: string;
  claim?: ClaimRecord;
}

export interface PreparedQuestionLookupInput {
  question_id?: string;
  query?: string;
}

export interface PreparedQuestionLookupResult {
  found: boolean;
  matches: PreparedQuestionRecord[];
}

export interface AnswerabilityRequestLookupInput {
  request_id?: string;
  affected_finding_id?: string;
  query?: string;
}

export interface AnswerabilityRequestLookupResult {
  found: boolean;
  matches: DataRequestRecord[];
}

export type RuntimeAnswerabilityStatus = "answered" | "partial" | "unanswerable" | "needs_review";

export interface DeterministicAnswerResult {
  status: "answered" | "unanswerable";
  answerability_status: RuntimeAnswerabilityStatus;
  answer_status: string;
  answer: string;
  source: "prepared_question" | "runtime";
  question_id?: string;
  claim_ids: string[];
  evidence_ids: string[];
  evidence_sources: AnswerEvidenceSourceTrace[];
  data_requests: DataRequestRecord[];
}

export interface AnswerEvidenceSourceTrace extends EvidenceSourceTrace {
  evidence_id: string;
}

export interface GroundedModelAnswerOptions {
  systemPrompt?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface GroundedModelStructuredOutput {
  schema_version: "open_insight.grounded_answer.v0.1";
  status: DeterministicAnswerResult["status"];
  answer: string;
  claim_ids: string[];
  evidence_ids: string[];
  data_request_ids: string[];
  generation_status: "ai_generated";
  review_status: "needs_review";
}

export interface GroundedModelStructuredOutputStatus {
  schema_version: "open_insight.grounded_answer.v0.1";
  parse_status: "valid" | "invalid";
  error?: string;
}

export type GroundedModelErrorCode = "MODEL_OUTPUT_REJECTED" | "MODEL_REQUEST_FAILED";

export interface GroundedModelAnswerResult {
  status: DeterministicAnswerResult["status"];
  answerability_status: RuntimeAnswerabilityStatus;
  answer_status: string;
  answer: string;
  source: "grounded_model" | "deterministic_fallback";
  generation_status: "ai_generated" | "model_error";
  review_status: "needs_review";
  model_adapter: string;
  base_answer: DeterministicAnswerResult;
  claim_ids: string[];
  evidence_ids: string[];
  evidence_sources: AnswerEvidenceSourceTrace[];
  data_requests: DataRequestRecord[];
  structured_output: GroundedModelStructuredOutputStatus;
  model_error?: {
    message: string;
    code?: GroundedModelErrorCode;
  };
}

export async function loadEvidenceRecords(packageRoot: string): Promise<EvidenceRecord[]> {
  return readJsonlFile<EvidenceRecord>(path.join(packageRoot, "evidence/evidence.jsonl"));
}

export async function loadClaimRecords(packageRoot: string): Promise<ClaimRecord[]> {
  return readJsonlFile<ClaimRecord>(path.join(packageRoot, "findings/claims.jsonl"));
}

export async function loadPreparedQuestionRecords(packageRoot: string): Promise<PreparedQuestionRecord[]> {
  return readJsonlFile<PreparedQuestionRecord>(path.join(packageRoot, "qa/prepared_questions.jsonl"));
}

export async function loadDataRequestRecords(packageRoot: string): Promise<DataRequestRecord[]> {
  return readJsonlFile<DataRequestRecord>(path.join(packageRoot, "answerability/data_requests.jsonl"));
}

export async function loadDataCatalog(packageRoot: string): Promise<DataCatalogFile> {
  return readJsonFile<DataCatalogFile>(path.join(packageRoot, "data/catalog.json"));
}

export async function loadLineageSources(packageRoot: string): Promise<LineageSourcesFile | undefined> {
  try {
    return await readJsonFile<LineageSourcesFile>(path.join(packageRoot, "lineage/sources.json"));
  } catch {
    return undefined;
  }
}

export async function lookupEvidence(packageRoot: string, input: EvidenceLookupInput): Promise<EvidenceLookupResult> {
  const evidence = await loadEvidenceRecords(packageRoot);
  const record = evidence.find((item) => item.evidence_id === input.evidence_id);

  if (!record) {
    return {
      found: false,
      evidence_id: input.evidence_id
    };
  }

  return {
    found: true,
    evidence_id: input.evidence_id,
    evidence: record
  };
}

export interface RuntimeTool<TInput, TOutput> {
  name: string;
  description: string;
  execute(input: TInput): Promise<TOutput>;
}

export type AnyRuntimeTool = RuntimeTool<unknown, unknown>;

export interface RuntimeToolDeclaration {
  name: string;
  description: string;
}

export interface RuntimeToolCall {
  tool_name: string;
  input?: unknown;
}

export type RuntimeToolCallResult =
  | {
      ok: true;
      tool_name: string;
      output: unknown;
    }
  | {
      ok: false;
      tool_name: string;
      error: {
        code: "UNKNOWN_TOOL";
        message: string;
        available_tools: string[];
      };
    };

export interface RuntimeToolRegistry {
  declarations: RuntimeToolDeclaration[];
  execute(call: RuntimeToolCall): Promise<RuntimeToolCallResult>;
}

export function createEvidenceLookupTool(packageRoot: string): RuntimeTool<EvidenceLookupInput, EvidenceLookupResult> {
  return {
    name: "lookup_evidence",
    description: "按 evidence_id 返回当前 insight 包中的证据记录。",
    execute(input) {
      return lookupEvidence(packageRoot, input);
    }
  };
}

export async function lookupEvidenceSources(
  packageRoot: string,
  input: EvidenceSourcesLookupInput
): Promise<EvidenceSourcesLookupResult> {
  const evidenceResult = await lookupEvidence(packageRoot, input);

  if (!evidenceResult.found || !evidenceResult.evidence) {
    return {
      found: false,
      evidence_id: input.evidence_id,
      sources: []
    };
  }

  const catalog = await loadDataCatalog(packageRoot);
  const lineageSourcesFile = await loadLineageSources(packageRoot);

  return {
    found: true,
    evidence_id: input.evidence_id,
    sources: buildEvidenceSourceTraces(evidenceResult.evidence, catalog, lineageSourcesFile)
  };
}

export function createEvidenceSourcesLookupTool(
  packageRoot: string
): RuntimeTool<EvidenceSourcesLookupInput, EvidenceSourcesLookupResult> {
  return {
    name: "lookup_evidence_sources",
    description: "按 evidence_id 返回当前 insight 包中的数据集和 lineage 来源追踪。",
    execute(input) {
      return lookupEvidenceSources(packageRoot, input);
    }
  };
}

export async function lookupClaim(packageRoot: string, input: ClaimLookupInput): Promise<ClaimLookupResult> {
  const claims = await loadClaimRecords(packageRoot);
  const record = claims.find((item) => item.claim_id === input.claim_id);

  if (!record) {
    return {
      found: false,
      claim_id: input.claim_id
    };
  }

  return {
    found: true,
    claim_id: input.claim_id,
    claim: record
  };
}

export async function lookupPreparedQuestion(
  packageRoot: string,
  input: PreparedQuestionLookupInput
): Promise<PreparedQuestionLookupResult> {
  const questions = await loadPreparedQuestionRecords(packageRoot);

  if (input.question_id) {
    const match = questions.find((item) => item.question_id === input.question_id);
    return {
      found: match !== undefined,
      matches: match ? [match] : []
    };
  }

  const normalizedQuery = normalizeSearchText(input.query ?? "");
  if (!normalizedQuery) {
    return {
      found: false,
      matches: []
    };
  }

  const directMatches = questions.filter((item) => {
    return searchTextIncludes(`${item.question} ${item.answer}`, normalizedQuery);
  });
  const matches = directMatches.length > 0 ? directMatches : selectFuzzyPreparedQuestions(questions, normalizedQuery);

  return {
    found: matches.length > 0,
    matches
  };
}

export async function lookupAnswerabilityRequest(
  packageRoot: string,
  input: AnswerabilityRequestLookupInput
): Promise<AnswerabilityRequestLookupResult> {
  const requests = await loadDataRequestRecords(packageRoot);

  if (input.request_id) {
    const match = requests.find((item) => item.request_id === input.request_id);
    return {
      found: match !== undefined,
      matches: match ? [match] : []
    };
  }

  if (input.affected_finding_id) {
    const affectedFindingId = input.affected_finding_id;
    const matches = requests.filter((item) => (item.affected_findings ?? []).includes(affectedFindingId));
    return {
      found: matches.length > 0,
      matches
    };
  }

  const normalizedQuery = normalizeSearchText(input.query ?? "");
  if (!normalizedQuery) {
    return {
      found: false,
      matches: []
    };
  }

  const directMatches = requests.filter((item) => {
    return searchTextIncludes(formatAnswerabilityRequestSearchText(item), normalizedQuery);
  });
  const matches = directMatches.length > 0 ? directMatches : selectFuzzyAnswerabilityRequests(requests, normalizedQuery);

  return {
    found: matches.length > 0,
    matches
  };
}

export function createClaimLookupTool(packageRoot: string): RuntimeTool<ClaimLookupInput, ClaimLookupResult> {
  return {
    name: "lookup_claim",
    description: "按 claim_id 返回当前 insight 包中的结论记录。",
    execute(input) {
      return lookupClaim(packageRoot, input);
    }
  };
}

export function createPreparedQuestionLookupTool(
  packageRoot: string
): RuntimeTool<PreparedQuestionLookupInput, PreparedQuestionLookupResult> {
  return {
    name: "lookup_prepared_question",
    description: "按 question_id 或文本查询返回当前 insight 包中的预置问答记录。",
    execute(input) {
      return lookupPreparedQuestion(packageRoot, input);
    }
  };
}

export function createAnswerabilityRequestLookupTool(
  packageRoot: string
): RuntimeTool<AnswerabilityRequestLookupInput, AnswerabilityRequestLookupResult> {
  return {
    name: "lookup_answerability_request",
    description: "按 request_id、影响结论或文本查询返回当前 insight 包中的补数请求。",
    execute(input) {
      return lookupAnswerabilityRequest(packageRoot, input);
    }
  };
}

export function createDefaultRuntimeTools(packageRoot: string) {
  return [
    createEvidenceLookupTool(packageRoot),
    createEvidenceSourcesLookupTool(packageRoot),
    createClaimLookupTool(packageRoot),
    createPreparedQuestionLookupTool(packageRoot),
    createAnswerabilityRequestLookupTool(packageRoot)
  ] as const;
}

export function createRuntimeToolRegistry(packageRoot: string): RuntimeToolRegistry {
  return createRuntimeToolRegistryFromTools(createDefaultRuntimeTools(packageRoot));
}

export function createRuntimeToolRegistryFromTools(tools: readonly RuntimeTool<unknown, unknown>[]): RuntimeToolRegistry {
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const declarations = tools.map((tool) => ({
    name: tool.name,
    description: tool.description
  }));

  return {
    declarations,
    async execute(call) {
      const tool = toolByName.get(call.tool_name);

      if (!tool) {
        return {
          ok: false,
          tool_name: call.tool_name,
          error: {
            code: "UNKNOWN_TOOL",
            message: `Runtime 工具 ${call.tool_name} 未在当前文件包中注册。`,
            available_tools: declarations.map((declaration) => declaration.name)
          }
        };
      }

      return {
        ok: true,
        tool_name: call.tool_name,
        output: await tool.execute(call.input)
      };
    }
  };
}

export interface PackageContextSummary {
  package_id: string;
  title: string;
  spec_version: string;
  metrics: Array<{
    metric_id: string;
    name: string;
    definition: string;
    formula: string;
    unit?: string;
  }>;
  claim_status_counts: Record<string, number>;
  prepared_question_count: number;
  data_request_count: number;
  evidence_count: number;
  available_tools: string[];
  tool_declarations: RuntimeToolDeclaration[];
}

export async function buildPackageContextSummary(packageRoot: string): Promise<PackageContextSummary> {
  const manifest = await readManifest(packageRoot);
  const metricsFile = await readJsonFile<MetricsFile>(path.join(packageRoot, "semantic/metrics.json"));
  const claims = await loadClaimRecords(packageRoot);
  const preparedQuestions = await loadPreparedQuestionRecords(packageRoot);
  const dataRequests = await loadDataRequestRecords(packageRoot);
  const evidence = await loadEvidenceRecords(packageRoot);
  const claimStatusCounts: Record<string, number> = {};
  const toolRegistry = createRuntimeToolRegistry(packageRoot);

  claims.forEach((claim) => {
    claimStatusCounts[claim.status] = (claimStatusCounts[claim.status] ?? 0) + 1;
  });

  return {
    package_id: manifest.package_id,
    title: manifest.title,
    spec_version: manifest.spec_version,
    metrics: metricsFile.metrics.map((metric) => ({
      metric_id: metric.metric_id,
      name: metric.name,
      definition: metric.definition,
      formula: metric.formula,
      ...(metric.unit ? { unit: metric.unit } : {})
    })),
    claim_status_counts: claimStatusCounts,
    prepared_question_count: preparedQuestions.length,
    data_request_count: dataRequests.length,
    evidence_count: evidence.length,
    available_tools: toolRegistry.declarations.map((tool) => tool.name),
    tool_declarations: toolRegistry.declarations
  };
}

export function formatPackageContextForPrompt(summary: PackageContextSummary): string {
  const metrics = summary.metrics
    .map((metric) => `- ${metric.metric_id}: ${metric.name}; ${metric.definition}; formula=${metric.formula}`)
    .join("\n");
  const claimStatuses = Object.entries(summary.claim_status_counts)
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
  const toolDeclarations = summary.tool_declarations
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");

  return [
    `文件包：${summary.title}`,
    `文件包 ID：${summary.package_id}`,
    `协议版本：${summary.spec_version}`,
    `结论状态：${claimStatuses || "无"}`,
    `预置问题数：${summary.prepared_question_count}`,
    `补数请求数：${summary.data_request_count}`,
    `证据记录数：${summary.evidence_count}`,
    `可用工具：${summary.available_tools.join(", ")}`,
    "工具声明：",
    toolDeclarations,
    "指标：",
    metrics
  ].join("\n");
}

export type ContextPackageProfile = "semantic_capsule" | "v0_1_compat";
export type ContextSourceMode = "source_bundled" | "source_light" | "unknown";
export type ContextCommandStatus = "ok" | "unsupported";
export type ContextObjectKind =
  | "source"
  | "dataset"
  | "field"
  | "metric"
  | "evidence"
  | "prepared_question"
  | "data_request"
  | "chunk"
  | "query_index";

export interface ContextTraceFields {
  source_refs: string[];
  lineage_refs: string[];
  parse_diagnostic_ids: string[];
  source_map_refs?: string[];
}

export interface ContextBaseResult extends ContextTraceFields {
  status: ContextCommandStatus;
  profile: ContextPackageProfile;
  package_id: string;
  title: string;
  spec_version: string;
  source_mode: ContextSourceMode;
}

export type ContextQueryIndexSummary =
  | {
      available: false;
    }
  | {
      available: true;
      schema_version: string;
      status: string;
      engine: string;
      fts: boolean;
      rebuildable: boolean;
      source_of_truth: boolean;
      index_role?: string;
      database_path?: string;
      database_available: boolean;
      rebuild_sql_path?: string;
      rebuild_sql_available: boolean;
      direct_index_path?: string;
      direct_index_available: boolean;
      direct_index_format?: string;
      access_strategy: "sqlite_database" | "rebuild_sql" | "direct_index_jsonl" | "normalized_source_fallback";
      message: string;
      provenance_tables: string[];
      provenance_tables_available: boolean;
      sqlite_table_counts: ContextQueryIndexSqliteTableCounts;
      spreadsheet_formula_path?: string;
      spreadsheet_formula_available: boolean;
      spreadsheet_formula_count: number;
      indexed_paths: string[];
      source_refs: string[];
      lineage_refs: string[];
      parse_diagnostic_ids: string[];
      source_map_refs: string[];
    };

export interface ContextQueryIndexSqliteTableCounts {
  chunks: number;
  page_furniture?: number;
  spreadsheet_formulas?: number;
  parse_diagnostics: number;
  source_maps: number;
  digests: number;
}

export type ContextPreferredChunkAccess = "sqlite_fts" | "direct_jsonl_index" | "rebuild_sql" | "runtime_fallback";
export type ContextEvidenceBoundary =
  | "raw_and_normalized_sources"
  | "raw_sources_bundled"
  | "normalized_sources_without_raw"
  | "normalized_sources_available"
  | "unknown";

export interface ContextLlmReadingStrategy {
  read_order: string[];
  preferred_chunk_access: ContextPreferredChunkAccess;
  evidence_boundary: ContextEvidenceBoundary;
  raw_sources_bundled: boolean;
  normalized_sources_available: boolean;
  query_index_available: boolean;
  source_verification_required: boolean;
  base_package_mutation_allowed: boolean;
  model_required: boolean;
  must_disclose_source_light: boolean;
  next_cli_commands: string[];
  next_mcp_tools: string[];
}

export interface ContextSummaryResult extends ContextBaseResult {
  counts: {
    sources: number;
    datasets: number;
    fields: number;
    metrics: number;
    evidence: number;
    prepared_questions: number;
    data_requests: number;
    chunks: number;
    parse_diagnostics: number;
  };
  capabilities: {
    table_query: boolean;
    chunk_search: boolean;
    source_resolve: boolean;
    parse_diagnostics: boolean;
    semantic_capsule: boolean;
    query_index: boolean;
  };
  llm_reading_strategy: ContextLlmReadingStrategy;
  query_index: ContextQueryIndexSummary;
}

export interface ContextUserMaterialContractResult extends ContextBaseResult {
  allowed_outputs: string[];
  required_citation_fields: string[];
  required_sections: string[];
  recommended_context_tools: {
    cli: string[];
    mcp: string[];
  };
  output_boundary: "external_file_or_overlay_or_derived_package";
  base_package_mutation: false;
  model_required_by_open_insight: false;
  source_mode_disclosure_required: boolean;
  source_verification_required: boolean;
  preferred_chunk_access: ContextPreferredChunkAccess;
  evidence_boundary: ContextEvidenceBoundary;
}

export interface ContextSourceItem extends ContextTraceFields {
  source_id: string;
  type: string;
  path?: string;
  description?: string;
  dataset_ids: string[];
}

export interface ContextSourcesResult extends ContextBaseResult {
  sources: ContextSourceItem[];
}

export interface ListContextObjectsOptions {
  kind?: ContextObjectKind;
}

export interface ContextObjectItem extends ContextTraceFields {
  object_id: string;
  kind: ContextObjectKind;
  title: string;
  description?: string;
  path?: string;
  dataset_id?: string;
  type?: string;
  format?: string;
  database_path?: string;
  database_available?: boolean;
  rebuild_sql_path?: string;
  rebuild_sql_available?: boolean;
  direct_index_path?: string;
  direct_index_available?: boolean;
  direct_index_format?: string;
  access_strategy?: "sqlite_database" | "rebuild_sql" | "direct_index_jsonl" | "normalized_source_fallback";
  provenance_tables?: string[];
  provenance_tables_available?: boolean;
  sqlite_table_counts?: ContextQueryIndexSqliteTableCounts;
  field_count?: number;
  formula?: string;
  unit?: string;
  status?: string;
}

export interface ContextObjectsResult extends ContextBaseResult {
  objects: ContextObjectItem[];
}

export interface QueryContextTableOptions {
  op: "count" | `sum:${string}` | `average:${string}`;
  filter?: string;
}

export interface ContextTableQueryResult extends ContextBaseResult {
  table_id: string;
  operation: "count" | "sum" | "average";
  field?: string;
  filter?: string;
  row_count: number;
  value: number;
  contract_refs: string[];
  reason?: string;
}

export interface SearchContextChunksOptions {
  documentId?: string;
  documentIds?: string[];
  limit?: number;
  includePageFurniture?: boolean;
  compact?: boolean;
  tokenBudget?: number;
}

export interface ContextChunkMatch extends ContextTraceFields {
  chunk_id: string;
  kind: ContextObjectKind;
  title: string;
  text: string;
  score: number;
  evidence_ids: string[];
  object_id?: string;
  content_role?: "body" | "table" | "heading" | "page_furniture" | "disclaimer" | "source_overview" | "unknown";
  chunk_level?: "document" | "section" | "paragraph" | "table" | "page_furniture" | "source_overview" | "unknown";
  heading_path?: string[];
  estimated_tokens?: number;
  render_policy?: string;
  page_furniture_kind?: string;
  page_number?: number;
  line_numbers?: number[];
  normalized_source_path?: string;
  read_order?: number;
  prev_chunk_id?: string;
  next_chunk_id?: string;
  parent_chunk_id?: string;
}

export interface ContextChunkSearchResult extends ContextBaseResult {
  query: string;
  limit: number;
  matches: ContextChunkMatch[];
}

export interface ContextNormalizedSourceFragment extends ContextTraceFields {
  fragment_scope: "query_index_chunk" | "normalized_source_excerpt";
  text: string;
  estimated_tokens: number;
  truncated: boolean;
  source_mode_disclosure_cn: string;
  chunk_id?: string;
  normalized_source_path?: string;
  content_role?: string;
  chunk_level?: string;
  heading_path?: string[];
  page_number?: number;
  line_numbers?: number[];
}

export interface ContextSourceResolveResult extends ContextBaseResult {
  target_id: string;
  resolved: boolean;
  object?: ContextObjectItem;
  normalized_source_fragment?: ContextNormalizedSourceFragment;
  reason?: string;
}

export interface ContextDiagnosticItem {
  diagnostic_id: string;
  severity: "info" | "warning" | "error";
  status: "ok" | "unsupported" | "warning" | "error";
  message: string;
  source_id?: string;
  source_path?: string;
  source_type?: string;
  parser?: string;
  parser_version?: string;
  parser_role?: string;
  normalized_source_path?: string;
  cloud_used?: boolean;
  confidence?: number;
  parser_quality_status?: "content_ready" | "metadata_only_or_weak";
  recommended_action_cn?: string;
  source_refs?: string[];
  lineage_refs?: string[];
  parse_diagnostic_ids?: string[];
}

export interface ContextDiagnosticsResult extends ContextBaseResult {
  diagnostics: ContextDiagnosticItem[];
}

interface ContextPackageState {
  packageRoot: string;
  manifest: {
    package_id: string;
    title: string;
    spec_version: string;
  };
  catalog: DataCatalogFile;
  lineageSourcesFile: LineageSourcesFile | undefined;
  metricsFile: MetricsFile;
  evidence: EvidenceRecord[];
  preparedQuestions: PreparedQuestionRecord[];
  dataRequests: DataRequestRecord[];
  parseDiagnostics: ContextDiagnosticItem[];
  queryIndex: ContextQueryIndexSummary;
  profile: ContextPackageProfile;
  sourceMode: ContextSourceMode;
}

export async function summarizeContextPackage(packageRoot: string): Promise<ContextSummaryResult> {
  const state = await loadContextPackageState(packageRoot);
  const base = buildContextBaseResult(state);
  const fieldCount = state.catalog.datasets.reduce((total, dataset) => total + (dataset.columns?.length ?? 0), 0);

  return {
    ...base,
    counts: {
      sources: collectContextLineageSourceIds(state).length,
      datasets: state.catalog.datasets.length,
      fields: fieldCount,
      metrics: state.metricsFile.metrics.length,
      evidence: state.evidence.length,
      prepared_questions: state.preparedQuestions.length,
      data_requests: state.dataRequests.length,
      chunks: 0,
      parse_diagnostics: state.parseDiagnostics.length
    },
    capabilities: {
      table_query: true,
      chunk_search: true,
      source_resolve: true,
      parse_diagnostics: state.parseDiagnostics.length > 0,
      semantic_capsule: state.profile === "semantic_capsule",
      query_index: state.queryIndex.available
    },
    llm_reading_strategy: buildContextLlmReadingStrategy(state),
    query_index: state.queryIndex
  };
}

export async function buildContextUserMaterialContract(packageRoot: string): Promise<ContextUserMaterialContractResult> {
  const state = await loadContextPackageState(packageRoot);
  const readingStrategy = buildContextLlmReadingStrategy(state);

  return {
    ...buildContextBaseResult(state),
    allowed_outputs: [
      "brief",
      "html",
      "word_outline",
      "ppt_outline",
      "qa",
      "email",
      "action_list",
      "web_copy",
      "analysis_note"
    ],
    required_citation_fields: ["source_refs", "lineage_refs", "parse_diagnostic_ids", "source_map_refs"],
    required_sections: [
      "summary",
      "key_facts_or_numbers",
      "sources_and_evidence",
      "human_review_points",
      "unanswerable_or_missing_data"
    ],
    recommended_context_tools: {
      cli: [
        "context summary",
        "context list-sources",
        "context diagnostics",
        "version status",
        "version log",
        "context search-chunks",
        "context token-eval",
        "context handoff",
        "context query-table",
        "context resolve-source",
        "context material-contract"
      ],
      mcp: [
        "open_insight_context_summary",
        "open_insight_list_sources",
        "open_insight_validate_context",
        "open_insight_version_status",
        "open_insight_version_log",
        "open_insight_search_chunks",
        "open_insight_token_eval",
        "open_insight_context_handoff",
        "open_insight_query_table",
        "open_insight_resolve_source",
        "open_insight_material_contract"
      ]
    },
    output_boundary: "external_file_or_overlay_or_derived_package",
    base_package_mutation: false,
    model_required_by_open_insight: false,
    source_mode_disclosure_required: readingStrategy.must_disclose_source_light,
    source_verification_required: readingStrategy.source_verification_required,
    preferred_chunk_access: readingStrategy.preferred_chunk_access,
    evidence_boundary: readingStrategy.evidence_boundary
  };
}

function buildContextLlmReadingStrategy(state: ContextPackageState): ContextLlmReadingStrategy {
  const normalizedSourcesAvailable = contextHasNormalizedSources(state);

  return {
    read_order: [
      "context summary",
      "context list-sources",
      "context diagnostics",
      "context list-objects",
      "context query-table/search-chunks",
      "context resolve-source"
    ],
    preferred_chunk_access: choosePreferredChunkAccess(state.queryIndex),
    evidence_boundary: chooseEvidenceBoundary(state.sourceMode, normalizedSourcesAvailable),
    raw_sources_bundled: state.sourceMode === "source_bundled",
    normalized_sources_available: normalizedSourcesAvailable,
    query_index_available: state.queryIndex.available,
    source_verification_required: true,
    base_package_mutation_allowed: false,
    model_required: false,
    must_disclose_source_light: state.sourceMode === "source_light",
    next_cli_commands: [
      "context list-sources",
      "context diagnostics",
      "context list-objects",
      "version status",
      "version log",
      "context search-chunks",
      "context token-eval",
      "context handoff",
      "context resolve-source"
    ],
    next_mcp_tools: [
      "open_insight_list_sources",
      "open_insight_validate_context",
      "open_insight_list_objects",
      "open_insight_version_status",
      "open_insight_version_log",
      "open_insight_search_chunks",
      "open_insight_token_eval",
      "open_insight_context_handoff",
      "open_insight_resolve_source"
    ]
  };
}

function contextHasNormalizedSources(state: ContextPackageState): boolean {
  if (state.parseDiagnostics.some((diagnostic) => Boolean(diagnostic.normalized_source_path))) {
    return true;
  }

  return state.queryIndex.available && state.queryIndex.indexed_paths.length > 0;
}

function choosePreferredChunkAccess(queryIndex: ContextQueryIndexSummary): ContextPreferredChunkAccess {
  if (!queryIndex.available) {
    return "runtime_fallback";
  }

  if (queryIndex.database_available) {
    return "sqlite_fts";
  }

  if (queryIndex.direct_index_available) {
    return "direct_jsonl_index";
  }

  if (queryIndex.rebuild_sql_available) {
    return "rebuild_sql";
  }

  return "runtime_fallback";
}

function chooseEvidenceBoundary(sourceMode: ContextSourceMode, normalizedSourcesAvailable: boolean): ContextEvidenceBoundary {
  if (sourceMode === "source_light") {
    return normalizedSourcesAvailable ? "normalized_sources_without_raw" : "unknown";
  }

  if (sourceMode === "source_bundled") {
    return normalizedSourcesAvailable ? "raw_and_normalized_sources" : "raw_sources_bundled";
  }

  return normalizedSourcesAvailable ? "normalized_sources_available" : "unknown";
}

export async function listContextSources(packageRoot: string): Promise<ContextSourcesResult> {
  const state = await loadContextPackageState(packageRoot);
  const base = buildContextBaseResult(state);
  const lineageSources = getContextLineageSources(state);

  return {
    ...base,
    sources: lineageSources.map((source) => {
      const sourcePath = normalizePackagePath(source.path);
      const datasets = state.catalog.datasets.filter((dataset) => normalizePackagePath(dataset.path) === sourcePath);
      const sourceRefs = [source.source_id];
      const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

      return {
        source_id: source.source_id,
        type: source.type,
        ...(source.path ? { path: source.path } : {}),
        ...(source.description ? { description: source.description } : {}),
        dataset_ids: datasets.map((dataset) => dataset.dataset_id),
        source_refs: sourceRefs,
        lineage_refs: sourceRefs,
        parse_diagnostic_ids: parseDiagnosticIds
      };
    })
  };
}

export async function listContextObjects(
  packageRoot: string,
  options: ListContextObjectsOptions = {}
): Promise<ContextObjectsResult> {
  const state = await loadContextPackageState(packageRoot);
  const base = buildContextBaseResult(state);
  const objects = buildContextObjects(state);

  return {
    ...base,
    objects: options.kind ? objects.filter((object) => object.kind === options.kind) : objects
  };
}

export async function queryContextTable(
  packageRoot: string,
  tableId: string,
  options: QueryContextTableOptions
): Promise<ContextTableQueryResult> {
  const state = await loadContextPackageState(packageRoot);
  const dataset = state.catalog.datasets.find((item) => item.dataset_id === tableId);

  if (!dataset) {
    throw new Error(`未找到表对象：${tableId}`);
  }

  const operation = parseContextTableOperation(options.op);

  if (operation.field && !dataset.columns?.some((column) => column.name === operation.field)) {
    throw new Error(`表 ${tableId} 不存在字段：${operation.field}`);
  }

  const sourceRefs = getDatasetSourceRefs(state, dataset);
  const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);
  const contractRefs = [
    operation.field
      ? `data/catalog.json#datasets/${tableId}/columns/${operation.field}`
      : `data/catalog.json#datasets/${tableId}`
  ];

  if (!dataset.path || normalizePackagePath(dataset.format) !== "csv") {
    return {
      ...buildContextBaseResult(state),
      status: "unsupported",
      table_id: tableId,
      operation: operation.operation,
      ...(operation.field ? { field: operation.field } : {}),
      ...(options.filter ? { filter: options.filter } : {}),
      row_count: 0,
      value: 0,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      contract_refs: contractRefs,
      reason: `当前只支持查询包内 CSV 表：${tableId}`
    };
  }

  let rows: Record<string, string>[];

  try {
    rows = applyContextTableFilter(parseCsvTable(await readFile(path.join(packageRoot, dataset.path), "utf8")), options.filter);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return {
        ...buildContextBaseResult(state),
        status: "unsupported",
        table_id: tableId,
        operation: operation.operation,
        ...(operation.field ? { field: operation.field } : {}),
        ...(options.filter ? { filter: options.filter } : {}),
        row_count: 0,
        value: 0,
        source_refs: sourceRefs,
        lineage_refs: sourceRefs,
        parse_diagnostic_ids: parseDiagnosticIds,
        contract_refs: contractRefs,
        reason: `当前包的 source_mode=${state.sourceMode}，缺少包内原始表文件 ${dataset.path}；请使用 source_bundled 包或提供 normalized/index 查询能力后再执行表查询。`
      };
    }

    throw error;
  }

  const value =
    operation.operation === "count"
      ? rows.length
      : aggregateContextRows(rows, operation.field ?? "", operation.operation);

  return {
    ...buildContextBaseResult(state),
    table_id: tableId,
    operation: operation.operation,
    ...(operation.field ? { field: operation.field } : {}),
    ...(options.filter ? { filter: options.filter } : {}),
    row_count: rows.length,
    value,
    source_refs: sourceRefs,
    lineage_refs: sourceRefs,
    parse_diagnostic_ids: parseDiagnosticIds,
    contract_refs: contractRefs
  };
}

export async function searchContextChunks(
  packageRoot: string,
  query: string,
  options: SearchContextChunksOptions = {}
): Promise<ContextChunkSearchResult> {
  const state = await loadContextPackageState(packageRoot);
  const normalizedQuery = normalizeSearchText(query);
  const limit = Math.max(1, options.limit ?? 5);
  const queryTokens = tokenize(query).filter(isMeaningfulSearchToken);
  const documentIds = Array.from(
    new Set([...(options.documentIds ?? []), ...(options.documentId ? [options.documentId] : [])].map((documentId) => documentId.trim()).filter(Boolean))
  );
  const isInDocumentScope = (candidate: ContextChunkMatch): boolean =>
    documentIds.length === 0 || documentIds.some((documentId) => candidate.source_refs.includes(documentId));
  const matches = (await buildContextSearchCandidates(packageRoot, state))
    .filter(isInDocumentScope)
    .filter((candidate) => options.includePageFurniture === true || candidate.content_role !== "page_furniture")
    .map((candidate, index) => ({
      ...candidate,
      index,
      score: scoreContextSearchCandidate(candidate.text, normalizedQuery, queryTokens)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ index: _index, ...candidate }) => candidate);

  const base = buildContextBaseResult(state);

  return {
    ...base,
    ...(documentIds.length > 0
      ? {
          source_refs: base.source_refs.filter((sourceRef) => documentIds.includes(sourceRef)),
          lineage_refs: base.lineage_refs.filter((lineageRef) => documentIds.includes(lineageRef)),
          parse_diagnostic_ids: base.parse_diagnostic_ids.filter((diagnosticId) =>
            matches.some((match) => match.parse_diagnostic_ids.includes(diagnosticId))
          )
        }
      : {}),
    query,
    limit,
    matches
  };
}

export async function resolveContextSource(packageRoot: string, objectOrRefId: string): Promise<ContextSourceResolveResult> {
  const state = await loadContextPackageState(packageRoot);
  const chunk = (await buildQueryIndexChunkSearchCandidates(packageRoot, state)).find((candidate) => {
    return (
      candidate.chunk_id === objectOrRefId ||
      candidate.object_id === objectOrRefId ||
      candidate.source_refs.includes(objectOrRefId) ||
      candidate.source_map_refs?.includes(objectOrRefId)
    );
  });

  if (chunk) {
    const sourceRefs = chunk.source_refs ?? [];
    const lineageRefs = chunk.lineage_refs?.length ? chunk.lineage_refs : sourceRefs;
    const parseDiagnosticIds = chunk.parse_diagnostic_ids?.length
      ? chunk.parse_diagnostic_ids
      : getParseDiagnosticIdsForSourceRefs(state, sourceRefs);
    const sourceMapRefs = chunk.source_map_refs?.length ? chunk.source_map_refs : getSourceMapRefsForSourceRefs(sourceRefs);

    return {
      ...buildContextBaseResult(state),
      target_id: objectOrRefId,
      resolved: true,
      object: {
        object_id: chunk.chunk_id,
        kind: "chunk",
        title: chunk.title,
        source_refs: sourceRefs,
        lineage_refs: lineageRefs,
        parse_diagnostic_ids: parseDiagnosticIds,
        source_map_refs: sourceMapRefs
      },
      normalized_source_fragment: buildNormalizedSourceFragmentForChunk(state, chunk, {
        sourceRefs,
        lineageRefs,
        parseDiagnosticIds,
        sourceMapRefs
      }),
      source_refs: sourceRefs,
      lineage_refs: lineageRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: sourceMapRefs
    };
  }

  const object = buildContextObjects(state).find(
    (item) => item.object_id === objectOrRefId || item.title === objectOrRefId
  );

  if (object) {
    const sourceMapRefs = object.source_map_refs?.length ? object.source_map_refs : getSourceMapRefsForSourceRefs(object.source_refs);

    return {
      ...buildContextBaseResult(state),
      target_id: objectOrRefId,
      resolved: true,
      object,
      source_refs: object.source_refs,
      lineage_refs: object.lineage_refs,
      parse_diagnostic_ids: object.parse_diagnostic_ids,
      source_map_refs: sourceMapRefs
    };
  }

  return {
    ...buildContextBaseResult(state),
    target_id: objectOrRefId,
    resolved: false,
    reason: `未找到可追溯对象：${objectOrRefId}`
  };
}

export async function listContextDiagnostics(packageRoot: string): Promise<ContextDiagnosticsResult> {
  const state = await loadContextPackageState(packageRoot);
  const compatibilityDiagnostics: ContextDiagnosticItem[] = [
    ...(state.parseDiagnostics.length === 0
      ? [
          {
            diagnostic_id: "v0_1_compat.parse_diagnostics_unavailable",
            severity: "info" as const,
            status: "unsupported" as const,
            message: "v0.1 兼容包没有 source/parse_diagnostics.jsonl；CLI 会按已有 lineage 和 evidence 做只读降级。"
          }
        ]
      : []),
    {
      diagnostic_id: "v0_1_compat.semantic_index_unavailable",
      severity: "info",
      status: "unsupported",
      message: "v0.1 兼容包没有 SQLite/FTS 查询索引；当前表查询和文本搜索由 runtime 从包内文件可重建执行。"
    }
  ];

  return {
    ...buildContextBaseResult(state),
    diagnostics: [...state.parseDiagnostics, ...buildParserQualityDiagnostics(state), ...compatibilityDiagnostics]
  };
}

function buildParserQualityDiagnostics(state: ContextPackageState): ContextDiagnosticItem[] {
  return state.parseDiagnostics.flatMap((diagnostic) => {
    if (!isMetadataOnlyOrWeakParserDiagnostic(diagnostic)) {
      return [];
    }

    const diagnosticId = `${diagnostic.diagnostic_id}.parser_quality`;
    const sourceRefs = diagnostic.source_refs?.length
      ? diagnostic.source_refs
      : diagnostic.source_id
        ? [diagnostic.source_id]
        : [];

    return [
      {
        diagnostic_id: diagnosticId,
        severity: "warning",
        status: "warning",
        message:
          "解析质量警告：该来源的 normalized source 可能只包含元数据或正文抽取不足；CLI/MCP 会保留来源与指纹，但外部 LLM 不应把当前 compact context 视为完整正文。非图片化 PDF 可优先重跑 MarkItDown；图片化或扫描 PDF 后续需要 OCR / 视觉模型专项处理。",
        ...(diagnostic.source_id ? { source_id: diagnostic.source_id } : {}),
        ...(diagnostic.source_path ? { source_path: diagnostic.source_path } : {}),
        ...(diagnostic.source_type ? { source_type: diagnostic.source_type } : {}),
        ...(diagnostic.parser ? { parser: diagnostic.parser } : {}),
        ...(diagnostic.parser_version ? { parser_version: diagnostic.parser_version } : {}),
        ...(diagnostic.parser_role ? { parser_role: diagnostic.parser_role } : {}),
        ...(diagnostic.normalized_source_path ? { normalized_source_path: diagnostic.normalized_source_path } : {}),
        ...(typeof diagnostic.cloud_used === "boolean" ? { cloud_used: diagnostic.cloud_used } : {}),
        ...(typeof diagnostic.confidence === "number" ? { confidence: diagnostic.confidence } : {}),
        parser_quality_status: "metadata_only_or_weak",
        recommended_action_cn:
          "先确认 MarkItDown 是否可用并重跑解析；若仍无正文，标记为 parser 弱解析来源，问答时通过 source_overview / resolve-source 披露证据边界；扫描件或图片化 PDF 进入 OCR 专项。",
        source_refs: sourceRefs,
        lineage_refs: sourceRefs,
        parse_diagnostic_ids: [diagnostic.diagnostic_id]
      }
    ];
  });
}

function isMetadataOnlyOrWeakParserDiagnostic(diagnostic: ContextDiagnosticItem): boolean {
  const parserRole = diagnostic.parser_role?.toLowerCase() ?? "";
  const message = diagnostic.message.toLowerCase();

  return (
    diagnostic.status === "warning" ||
    diagnostic.status === "unsupported" ||
    diagnostic.status === "error" ||
    (diagnostic.confidence !== undefined && diagnostic.confidence < 0.5) ||
    parserRole.includes("metadata_only") ||
    parserRole.includes("fallback") ||
    message.includes("metadata-only") ||
    message.includes("未抽取正文") ||
    message.includes("正文抽取不足")
  );
}

export async function answerWithPreparedContext(
  packageRoot: string,
  question: string
): Promise<DeterministicAnswerResult> {
  const normalizedQuestion = normalizeSearchText(question);
  const preparedQuestions = await loadPreparedQuestionRecords(packageRoot);
  const directMatch = preparedQuestions.find((item) => normalizeSearchText(item.question) === normalizedQuestion);
  const fuzzyMatch = directMatch ?? selectFuzzyPreparedQuestion(preparedQuestions, normalizedQuestion);
  const dataRequests = await loadOptionalDataRequestRecords(packageRoot);

  if (!fuzzyMatch) {
    const matchedDataRequests = selectFuzzyAnswerabilityRequests(dataRequests, normalizedQuestion);

    return {
      status: "unanswerable",
      answerability_status: "unanswerable",
      answer_status: "unanswerable",
      answer:
        matchedDataRequests.length > 0
          ? `当前文件包还没有为这个问题提供预置答案，但已匹配到 ${matchedDataRequests.length} 个补数请求。请先补充数据后再回答。`
          : "当前文件包还没有为这个问题提供预置答案。",
      source: "runtime",
      claim_ids: [],
      evidence_ids: [],
      evidence_sources: [],
      data_requests: matchedDataRequests
    };
  }

  const claimIds = fuzzyMatch.claim_ids ?? [];
  const evidenceIds = fuzzyMatch.evidence_ids ?? [];
  const explicitDataRequestIds = new Set([...(fuzzyMatch.active_data_request_ids ?? []), ...(fuzzyMatch.data_request_ids ?? [])]);
  const evidenceRecords = await loadEvidenceRecords(packageRoot);
  const catalog = await loadDataCatalog(packageRoot);
  const lineageSourcesFile = await loadLineageSources(packageRoot);
  const evidenceById = new Map(evidenceRecords.map((record) => [record.evidence_id, record]));

  return {
    status: fuzzyMatch.status === "unanswerable" ? "unanswerable" : "answered",
    answerability_status: resolveRuntimeAnswerabilityStatus(fuzzyMatch.status),
    answer_status: fuzzyMatch.status,
    answer: fuzzyMatch.answer,
    source: "prepared_question",
    question_id: fuzzyMatch.question_id,
    claim_ids: claimIds,
    evidence_ids: evidenceIds,
    evidence_sources: evidenceIds.flatMap((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);

      if (!evidence) {
        return [];
      }

      return buildEvidenceSourceTraces(evidence, catalog, lineageSourcesFile).map((trace) => ({
        evidence_id: evidenceId,
        ...trace
      }));
    }),
    data_requests: dataRequests.filter((request) => {
      const affectedFindings = request.affected_findings ?? [];

      return explicitDataRequestIds.has(request.request_id) || claimIds.some((claimId) => affectedFindings.includes(claimId));
    })
  };
}

async function loadOptionalDataRequestRecords(packageRoot: string): Promise<DataRequestRecord[]> {
  try {
    return await loadDataRequestRecords(packageRoot);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

async function loadContextPackageState(packageRoot: string): Promise<ContextPackageState> {
  const manifest = await readManifest(packageRoot);
  const catalog = await loadDataCatalog(packageRoot);
  const lineageSourcesFile = await loadLineageSources(packageRoot);
  const metricsFile = await readJsonFile<MetricsFile>(path.join(packageRoot, "semantic/metrics.json"));
  const evidence = await loadEvidenceRecords(packageRoot);
  const preparedQuestions = await loadPreparedQuestionRecords(packageRoot);
  const dataRequests = await loadOptionalDataRequestRecords(packageRoot);
  const parseDiagnostics = await loadContextParseDiagnostics(packageRoot);
  const queryIndex = await loadContextQueryIndex(packageRoot);
  const profile: ContextPackageProfile = (await fileExists(path.join(packageRoot, "kernel/capsule_map.json")))
    ? "semantic_capsule"
    : "v0_1_compat";

  return {
    packageRoot,
    manifest,
    catalog,
    lineageSourcesFile,
    metricsFile,
    evidence,
    preparedQuestions,
    dataRequests,
    parseDiagnostics,
    queryIndex,
    profile,
    sourceMode: await inferContextSourceMode(packageRoot, catalog, lineageSourcesFile)
  };
}

function buildContextBaseResult(state: ContextPackageState): ContextBaseResult {
  const sourceRefs = collectContextLineageSourceIds(state);
  const parseDiagnosticIds = collectContextParseDiagnosticIds(state);

  return {
    status: "ok",
    profile: state.profile,
    package_id: state.manifest.package_id,
    title: state.manifest.title,
    spec_version: state.manifest.spec_version,
    source_mode: state.sourceMode,
    source_refs: sourceRefs,
    lineage_refs: sourceRefs,
    parse_diagnostic_ids: parseDiagnosticIds,
    source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
  };
}

async function loadContextParseDiagnostics(packageRoot: string): Promise<ContextDiagnosticItem[]> {
  try {
    const records = await readJsonlFile<Record<string, unknown>>(path.join(packageRoot, "source/parse_diagnostics.jsonl"));

    return records.map(normalizeContextParseDiagnostic);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function loadContextQueryIndex(packageRoot: string): Promise<ContextQueryIndexSummary> {
  try {
    const manifest = await readJsonFile<Record<string, unknown>>(path.join(packageRoot, "query_index/manifest.json"));
    const indexRole = asNonEmptyString(manifest.index_role);
    const databasePath = asNonEmptyString(manifest.database_path);
    const rebuildSqlPath = asNonEmptyString(manifest.rebuild_sql_path);
    const directIndexPath = asNonEmptyString(manifest.direct_index_path);
    const directIndexFormat = asNonEmptyString(manifest.direct_index_format);
    const spreadsheetFormulaPath = asNonEmptyString(manifest.spreadsheet_formula_path);
    const provenanceTables = asStringArrayValue(manifest.provenance_tables);
    const databaseAvailable = databasePath ? await fileExists(path.join(packageRoot, databasePath)) : false;
    const rebuildSqlAvailable = rebuildSqlPath ? await fileExists(path.join(packageRoot, rebuildSqlPath)) : false;
    const directIndexAvailable = directIndexPath ? await fileExists(path.join(packageRoot, directIndexPath)) : false;
    const declaredAccessStrategy = asNonEmptyString(manifest.access_strategy);
    const accessStrategy = databaseAvailable
      ? "sqlite_database"
      : declaredAccessStrategy === "direct_index_jsonl" && directIndexAvailable
        ? "direct_index_jsonl"
        : rebuildSqlAvailable
          ? "rebuild_sql"
          : directIndexAvailable
            ? "direct_index_jsonl"
            : "normalized_source_fallback";

    return {
      available: true,
      schema_version: asNonEmptyString(manifest.schema_version) ?? "open-insight.query_index.v0.1",
      status: asNonEmptyString(manifest.status) ?? "unknown",
      engine: asNonEmptyString(manifest.engine) ?? "unknown",
      fts: manifest.fts === true,
      rebuildable: manifest.rebuildable === true,
      source_of_truth: manifest.source_of_truth === true,
      ...(indexRole ? { index_role: indexRole } : {}),
      ...(databasePath ? { database_path: databasePath } : {}),
      database_available: databaseAvailable,
      ...(rebuildSqlPath ? { rebuild_sql_path: rebuildSqlPath } : {}),
      rebuild_sql_available: rebuildSqlAvailable,
      ...(directIndexPath ? { direct_index_path: directIndexPath } : {}),
      direct_index_available: directIndexAvailable,
      ...(directIndexFormat ? { direct_index_format: directIndexFormat } : {}),
      access_strategy: accessStrategy,
      message: buildQueryIndexAccessMessage(accessStrategy),
      provenance_tables: provenanceTables,
      provenance_tables_available: manifest.provenance_tables_available === true || provenanceTables.length > 0,
      sqlite_table_counts: normalizeQueryIndexSqliteTableCounts(manifest.sqlite_table_counts),
      ...(spreadsheetFormulaPath ? { spreadsheet_formula_path: spreadsheetFormulaPath } : {}),
      spreadsheet_formula_available: manifest.spreadsheet_formula_available === true,
      spreadsheet_formula_count: asNonNegativeInteger(manifest.spreadsheet_formula_count),
      indexed_paths: asStringArrayValue(manifest.indexed_paths),
      source_refs: asStringArrayValue(manifest.source_refs),
      lineage_refs: asStringArrayValue(manifest.lineage_refs),
      parse_diagnostic_ids: asStringArrayValue(manifest.parse_diagnostic_ids),
      source_map_refs: asStringArrayValue(manifest.source_map_refs)
    };
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { available: false };
    }

    throw error;
  }
}

function buildQueryIndexAccessMessage(accessStrategy: "sqlite_database" | "rebuild_sql" | "direct_index_jsonl" | "normalized_source_fallback"): string {
  if (accessStrategy === "sqlite_database") {
    return "当前包内置可用 SQLite/FTS 查询索引；读取工具仍应保留 source map、parse diagnostics 和 normalized source 复核路径。";
  }

  if (accessStrategy === "direct_index_jsonl") {
    return "当前包使用 query_index/chunks.jsonl 作为主查询索引；适合大包和多文件场景，避免内存型 SQLite 构建重复放大索引文本。";
  }

  if (accessStrategy === "rebuild_sql") {
    return "当前包未内置可用 SQLite 数据库文件，但包含 query_index/rebuild.sql；本地 CLI、MCP 或外部工具可重建 SQLite/FTS 索引。";
  }

  return "query_index/manifest.json 声明了 SQLite/FTS 查询索引，但当前包未内置可用数据库文件，也找不到可重建 SQL；已降级到 normalized source / semantic kernel 读取。";
}

function normalizeContextParseDiagnostic(record: Record<string, unknown>, index: number): ContextDiagnosticItem {
  const diagnosticId = asNonEmptyString(record.diagnostic_id) ?? `parse_diagnostic_${index + 1}`;
  const sourceId = asNonEmptyString(record.source_id);
  const sourceRefs = sourceId ? [sourceId] : [];
  const status = normalizeContextDiagnosticStatus(record.status);
  const severity = normalizeContextDiagnosticSeverity(record.severity, status);
  const sourcePath = asNonEmptyString(record.source_path);
  const sourceType = asNonEmptyString(record.source_type);
  const parser = asNonEmptyString(record.parser);
  const parserVersion = asNonEmptyString(record.parser_version);
  const parserRole = asNonEmptyString(record.parser_role);
  const normalizedSourcePath = asNonEmptyString(record.normalized_source_path);
  const message =
    asNonEmptyString(record.message) ?? `解析诊断 ${diagnosticId} 未提供 message；请复核 parser 输出和 source_map。`;

  return {
    diagnostic_id: diagnosticId,
    severity,
    status,
    message,
    ...(sourceId ? { source_id: sourceId, source_refs: sourceRefs, lineage_refs: sourceRefs } : {}),
    ...(sourcePath ? { source_path: sourcePath } : {}),
    ...(sourceType ? { source_type: sourceType } : {}),
    ...(parser ? { parser } : {}),
    ...(parserVersion ? { parser_version: parserVersion } : {}),
    ...(parserRole ? { parser_role: parserRole } : {}),
    ...(normalizedSourcePath ? { normalized_source_path: normalizedSourcePath } : {}),
    ...(typeof record.cloud_used === "boolean" ? { cloud_used: record.cloud_used } : {}),
    ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    parse_diagnostic_ids: [diagnosticId]
  };
}

function buildNormalizedSourceFragmentForChunk(
  state: ContextPackageState,
  chunk: ContextChunkMatch,
  refs: {
    sourceRefs: string[];
    lineageRefs: string[];
    parseDiagnosticIds: string[];
    sourceMapRefs: string[];
  }
): ContextNormalizedSourceFragment {
  const fragmentText = buildBoundedFragmentText(chunk.text);

  return {
    fragment_scope: "query_index_chunk",
    chunk_id: chunk.chunk_id,
    ...(chunk.normalized_source_path ? { normalized_source_path: chunk.normalized_source_path } : {}),
    text: fragmentText.text,
    estimated_tokens: estimateContextTextTokens(fragmentText.text),
    truncated: fragmentText.truncated,
    source_mode_disclosure_cn: buildContextSourceModeDisclosure(state.sourceMode),
    ...(chunk.content_role ? { content_role: chunk.content_role } : {}),
    ...(chunk.chunk_level ? { chunk_level: chunk.chunk_level } : {}),
    ...(chunk.heading_path && chunk.heading_path.length > 0 ? { heading_path: chunk.heading_path } : {}),
    ...(chunk.page_number !== undefined ? { page_number: chunk.page_number } : {}),
    ...(chunk.line_numbers && chunk.line_numbers.length > 0 ? { line_numbers: chunk.line_numbers } : {}),
    source_refs: refs.sourceRefs,
    lineage_refs: refs.lineageRefs,
    parse_diagnostic_ids: refs.parseDiagnosticIds,
    source_map_refs: refs.sourceMapRefs
  };
}

function buildBoundedFragmentText(text: string): { text: string; truncated: boolean } {
  const normalized = text.trim();
  const maxCharacters = 6000;

  if (normalized.length <= maxCharacters) {
    return { text: normalized, truncated: false };
  }

  return { text: normalized.slice(0, maxCharacters).trimEnd(), truncated: true };
}

function estimateContextTextTokens(text: string): number {
  const cjkCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const nonWhitespaceCharacters = text.replace(/\s+/g, "").length;
  const latinLikeCharacters = Math.max(0, nonWhitespaceCharacters - cjkCharacters);

  return Math.max(1, Math.ceil(cjkCharacters * 0.65 + latinLikeCharacters / 4));
}

function buildContextSourceModeDisclosure(sourceMode: ContextSourceMode): string {
  if (sourceMode === "source_light") {
    return "source_light：当前包不内置完整原始文件；该片段来自 normalized source / query index，原始文件复核依赖 external refs 或外部系统。";
  }

  if (sourceMode === "source_bundled") {
    return "source_bundled：当前包内置原始来源；该片段来自 normalized source / query index，完整证据仍应按 raw source、source map 和 digest 复核。";
  }

  return "source_mode unknown：该片段来自 normalized source / query index，读取方应检查 source inventory、source map 和 parse diagnostics 后再引用。";
}

function normalizeContextDiagnosticStatus(value: unknown): ContextDiagnosticItem["status"] {
  if (value === "ok" || value === "unsupported" || value === "warning" || value === "error") {
    return value;
  }

  return "warning";
}

function normalizeContextDiagnosticSeverity(
  value: unknown,
  status: ContextDiagnosticItem["status"]
): ContextDiagnosticItem["severity"] {
  if (value === "info" || value === "warning" || value === "error") {
    return value;
  }

  if (status === "error") {
    return "error";
  }

  if (status === "warning") {
    return "warning";
  }

  return "info";
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeQueryIndexSqliteTableCounts(value: unknown): ContextQueryIndexSqliteTableCounts {
  const record = isRecord(value) ? value : {};

  return {
    chunks: asNonNegativeInteger(record.chunks),
    ...(typeof record.page_furniture === "number" ? { page_furniture: asNonNegativeInteger(record.page_furniture) } : {}),
    ...(typeof record.spreadsheet_formulas === "number"
      ? { spreadsheet_formulas: asNonNegativeInteger(record.spreadsheet_formulas) }
      : {}),
    parse_diagnostics: asNonNegativeInteger(record.parse_diagnostics),
    source_maps: asNonNegativeInteger(record.source_maps),
    digests: asNonNegativeInteger(record.digests)
  };
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

async function inferContextSourceMode(
  packageRoot: string,
  catalog: DataCatalogFile,
  lineageSourcesFile: LineageSourcesFile | undefined
): Promise<ContextSourceMode> {
  const declaredSourceMode = await readDeclaredContextSourceMode(packageRoot);

  if (declaredSourceMode) {
    return declaredSourceMode;
  }

  const candidatePaths = [
    ...catalog.datasets.map((dataset) => dataset.path),
    ...(lineageSourcesFile?.sources.map((source) => source.path) ?? [])
  ]
    .map(normalizePackagePath)
    .filter((value): value is string => value !== undefined);

  if (candidatePaths.length === 0) {
    return "unknown";
  }

  for (const candidatePath of candidatePaths) {
    if (await fileExists(path.join(packageRoot, candidatePath))) {
      return "source_bundled";
    }
  }

  return "source_light";
}

async function readDeclaredContextSourceMode(packageRoot: string): Promise<ContextSourceMode | undefined> {
  try {
    const record = await readJsonFile<Record<string, unknown>>(path.join(packageRoot, "source/source_mode.json"));
    const sourceMode = record.source_mode;

    if (sourceMode === "source_bundled" || sourceMode === "source_light" || sourceMode === "unknown") {
      return sourceMode;
    }

    return undefined;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function collectContextLineageSourceIds(state: ContextPackageState): string[] {
  return getContextLineageSources(state).map((source) => source.source_id);
}

function collectContextParseDiagnosticIds(state: ContextPackageState): string[] {
  return state.parseDiagnostics.map((diagnostic) => diagnostic.diagnostic_id);
}

function getContextLineageSources(state: ContextPackageState): LineageSourceRecord[] {
  if (state.lineageSourcesFile?.sources.length) {
    return state.lineageSourcesFile.sources;
  }

  return state.catalog.datasets.map((dataset) => ({
    source_id: dataset.dataset_id,
    type: dataset.format ?? "dataset",
    ...(dataset.path ? { path: dataset.path } : {}),
    ...(dataset.description ? { description: dataset.description } : {})
  }));
}

function getDatasetSourceRefs(state: ContextPackageState, dataset: DatasetRecord | undefined): string[] {
  if (!dataset) {
    return collectContextLineageSourceIds(state);
  }

  const datasetPath = normalizePackagePath(dataset.path);
  const matchedSources = getContextLineageSources(state).filter((source) => normalizePackagePath(source.path) === datasetPath);

  if (matchedSources.length > 0) {
    return matchedSources.map((source) => source.source_id);
  }

  return [dataset.dataset_id];
}

function getParseDiagnosticIdsForSourceRefs(state: ContextPackageState, sourceRefs: string[]): string[] {
  const sourceRefSet = new Set(sourceRefs);

  return state.parseDiagnostics
    .filter((diagnostic) => {
      if (diagnostic.source_id && sourceRefSet.has(diagnostic.source_id)) {
        return true;
      }

      return diagnostic.source_refs?.some((sourceRef) => sourceRefSet.has(sourceRef)) ?? false;
    })
    .map((diagnostic) => diagnostic.diagnostic_id);
}

function getSourceMapRefsForSourceRefs(sourceRefs: string[]): string[] {
  return [...new Set(sourceRefs.map((sourceRef) => `source_map_${sourceRef}`))];
}

function getEvidenceSourceRefs(state: ContextPackageState, evidence: EvidenceRecord): string[] {
  const datasetById = new Map(state.catalog.datasets.map((dataset) => [dataset.dataset_id, dataset]));
  const sourceIds = (evidence.source_refs ?? []).flatMap((sourceRef) => getDatasetSourceRefs(state, datasetById.get(sourceRef.dataset_id)));

  return [...new Set(sourceIds)];
}

function buildContextObjects(state: ContextPackageState): ContextObjectItem[] {
  const lineageSources = getContextLineageSources(state);
  const datasetById = new Map(state.catalog.datasets.map((dataset) => [dataset.dataset_id, dataset]));
  const objects: ContextObjectItem[] = [];

  if (state.queryIndex.available) {
    objects.push({
      object_id: "query_index",
      kind: "query_index",
      title: "SQLite/FTS query index",
      description: "可重建查询索引，用于加速外部 LLM / MCP / CLI 读取；不是唯一事实来源。",
      ...(state.queryIndex.rebuild_sql_path ? { path: state.queryIndex.rebuild_sql_path } : {}),
      type: state.queryIndex.engine,
      format: state.queryIndex.fts ? "fts" : "sqlite",
      status: state.queryIndex.status,
      ...(state.queryIndex.database_path ? { database_path: state.queryIndex.database_path } : {}),
      database_available: state.queryIndex.database_available,
      ...(state.queryIndex.rebuild_sql_path ? { rebuild_sql_path: state.queryIndex.rebuild_sql_path } : {}),
      rebuild_sql_available: state.queryIndex.rebuild_sql_available,
      ...(state.queryIndex.direct_index_path ? { direct_index_path: state.queryIndex.direct_index_path } : {}),
      direct_index_available: state.queryIndex.direct_index_available,
      ...(state.queryIndex.direct_index_format ? { direct_index_format: state.queryIndex.direct_index_format } : {}),
      access_strategy: state.queryIndex.access_strategy,
      provenance_tables: state.queryIndex.provenance_tables,
      provenance_tables_available: state.queryIndex.provenance_tables_available,
      sqlite_table_counts: state.queryIndex.sqlite_table_counts,
      source_refs: state.queryIndex.source_refs,
      lineage_refs: state.queryIndex.lineage_refs,
      parse_diagnostic_ids: state.queryIndex.parse_diagnostic_ids,
      source_map_refs: state.queryIndex.source_map_refs
    });
  }

  for (const source of lineageSources) {
    const sourceRefs = [source.source_id];
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    objects.push({
      object_id: source.source_id,
      kind: "source",
      title: source.source_id,
      ...(source.description ? { description: source.description } : {}),
      ...(source.path ? { path: source.path } : {}),
      type: source.type,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    });
  }

  for (const dataset of state.catalog.datasets) {
    const sourceRefs = getDatasetSourceRefs(state, dataset);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    objects.push({
      object_id: dataset.dataset_id,
      kind: "dataset",
      title: dataset.dataset_id,
      ...(dataset.description ? { description: dataset.description } : {}),
      ...(dataset.path ? { path: dataset.path } : {}),
      ...(dataset.format ? { format: dataset.format } : {}),
      field_count: dataset.columns?.length ?? 0,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    });

    for (const column of dataset.columns ?? []) {
      objects.push({
        object_id: `${dataset.dataset_id}.${column.name}`,
        kind: "field",
        title: column.name,
        ...(column.description ? { description: column.description } : {}),
        dataset_id: dataset.dataset_id,
        ...(column.type ? { type: column.type } : {}),
        source_refs: sourceRefs,
        lineage_refs: sourceRefs,
        parse_diagnostic_ids: parseDiagnosticIds,
        source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
      });
    }
  }

  for (const metric of state.metricsFile.metrics) {
    const dataset = metric.dataset_id ? datasetById.get(metric.dataset_id) : undefined;
    const sourceRefs = getDatasetSourceRefs(state, dataset);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    objects.push({
      object_id: metric.metric_id,
      kind: "metric",
      title: metric.name,
      description: metric.definition,
      ...(metric.dataset_id ? { dataset_id: metric.dataset_id } : {}),
      formula: metric.formula,
      ...(metric.unit ? { unit: metric.unit } : {}),
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    });
  }

  for (const evidence of state.evidence) {
    const sourceRefs = getEvidenceSourceRefs(state, evidence);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    objects.push({
      object_id: evidence.evidence_id,
      kind: "evidence",
      title: evidence.evidence_id,
      description: evidence.summary,
      type: evidence.type,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    });
  }

  for (const question of state.preparedQuestions) {
    const evidenceSourceRefs = question.evidence_ids
      ? getSourceRefsForEvidenceIds(state, question.evidence_ids)
      : collectContextLineageSourceIds(state);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, evidenceSourceRefs);

    objects.push({
      object_id: question.question_id,
      kind: "prepared_question",
      title: question.question,
      description: question.answer,
      status: question.status,
      source_refs: evidenceSourceRefs,
      lineage_refs: evidenceSourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(evidenceSourceRefs)
    });
  }

  for (const request of state.dataRequests) {
    const sourceRefs = collectContextLineageSourceIds(state);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    objects.push({
      object_id: request.request_id,
      kind: "data_request",
      title: request.question,
      description: request.why_needed,
      status: request.status,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    });
  }

  return objects;
}

function getSourceRefsForEvidenceIds(state: ContextPackageState, evidenceIds: string[]): string[] {
  const evidenceById = new Map(state.evidence.map((evidence) => [evidence.evidence_id, evidence]));
  const sourceRefs = evidenceIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);

    return evidence ? getEvidenceSourceRefs(state, evidence) : [];
  });

  return [...new Set(sourceRefs)];
}

function parseContextTableOperation(op: QueryContextTableOptions["op"]): {
  operation: ContextTableQueryResult["operation"];
  field?: string;
} {
  if (op === "count") {
    return { operation: "count" };
  }

  const [operation, field] = op.split(":");

  if ((operation !== "sum" && operation !== "average") || !field?.trim()) {
    throw new Error(`不支持的表查询操作：${op}`);
  }

  return {
    operation,
    field: field.trim()
  };
}

function applyContextTableFilter(rows: Array<Record<string, string>>, filter: string | undefined): Array<Record<string, string>> {
  if (!filter) {
    return rows;
  }

  const separatorIndex = filter.indexOf("=");

  if (separatorIndex <= 0) {
    throw new Error(`表过滤条件必须使用 field=value 格式：${filter}`);
  }

  const field = filter.slice(0, separatorIndex).trim();
  const value = filter.slice(separatorIndex + 1).trim();

  return rows.filter((row) => row[field] === value);
}

function aggregateContextRows(
  rows: Array<Record<string, string>>,
  field: string,
  operation: "sum" | "average"
): number {
  const values = rows.map((row) => Number(row[field])).filter((value) => Number.isFinite(value));
  const sum = values.reduce((total, value) => total + value, 0);

  return operation === "average" ? (values.length === 0 ? 0 : sum / values.length) : sum;
}

function parseCsvTable(text: string): Array<Record<string, string>> {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headerLine = lines[0];

  if (!headerLine) {
    return [];
  }

  const headers = parseCsvLine(headerLine);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const record: Record<string, string> = {};

    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });

    return record;
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === "\"" && inQuotes && nextChar === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}

async function buildContextSearchCandidates(packageRoot: string, state: ContextPackageState): Promise<ContextChunkMatch[]> {
  const queryIndexChunkMatches = await buildQueryIndexChunkSearchCandidates(packageRoot, state);
  const normalizedSourceMatches =
    queryIndexChunkMatches.length > 0 ? [] : await buildNormalizedSourceSearchCandidates(packageRoot, state);
  const evidenceMatches = state.evidence.map((evidence) => {
    const sourceRefs = getEvidenceSourceRefs(state, evidence);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    return {
      chunk_id: `v0_1_evidence.${evidence.evidence_id}`,
      kind: "evidence" as const,
      title: evidence.evidence_id,
      text: [evidence.summary, evidence.query].filter((value): value is string => value !== undefined).join("\n"),
      score: 0,
      evidence_ids: [evidence.evidence_id],
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    };
  });

  const metricMatches = state.metricsFile.metrics.map((metric) => {
    const dataset = metric.dataset_id ? state.catalog.datasets.find((item) => item.dataset_id === metric.dataset_id) : undefined;
    const sourceRefs = getDatasetSourceRefs(state, dataset);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    return {
      chunk_id: `v0_1_metric.${metric.metric_id}`,
      kind: "metric" as const,
      title: metric.name,
      text: `${metric.name}\n${metric.definition}\n${metric.formula}`,
      score: 0,
      evidence_ids: [],
      object_id: metric.metric_id,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    };
  });

  const dataRequestMatches = state.dataRequests.map((request) => {
    const sourceRefs = collectContextLineageSourceIds(state);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    return {
      chunk_id: `v0_1_data_request.${request.request_id}`,
      kind: "data_request" as const,
      title: request.question,
      text: [request.question, request.why_needed, ...request.missing_fields].join("\n"),
      score: 0,
      evidence_ids: [],
      object_id: request.request_id,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    };
  });

  const questionMatches = state.preparedQuestions.map((question) => {
    const sourceRefs = question.evidence_ids
      ? getSourceRefsForEvidenceIds(state, question.evidence_ids)
      : collectContextLineageSourceIds(state);
    const parseDiagnosticIds = getParseDiagnosticIdsForSourceRefs(state, sourceRefs);

    return {
      chunk_id: `v0_1_prepared_question.${question.question_id}`,
      kind: "prepared_question" as const,
      title: question.question,
      text: `${question.question}\n${question.answer}`,
      score: 0,
      evidence_ids: question.evidence_ids ?? [],
      object_id: question.question_id,
      source_refs: sourceRefs,
      lineage_refs: sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds,
      source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
    };
  });

  return [...queryIndexChunkMatches, ...normalizedSourceMatches, ...evidenceMatches, ...metricMatches, ...dataRequestMatches, ...questionMatches];
}

async function buildQueryIndexChunkSearchCandidates(
  packageRoot: string,
  state: ContextPackageState
): Promise<ContextChunkMatch[]> {
  if (!state.queryIndex.available) {
    return [];
  }

  const directIndexPath = state.queryIndex.direct_index_path;
  const normalizedPath = normalizePackagePath(directIndexPath);

  if (
    !normalizedPath ||
    !normalizedPath.startsWith("query_index/") ||
    normalizedPath.startsWith("/") ||
    /^[a-z]:/i.test(normalizedPath) ||
    normalizedPath.split("/").some((segment) => segment === "..")
  ) {
    return [];
  }

  const rootPath = path.resolve(packageRoot);
  const resolvedPath = path.resolve(rootPath, normalizedPath);
  const normalizedRoot = rootPath.toLowerCase();
  const normalizedResolved = resolvedPath.toLowerCase();
  const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;

  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(rootPrefix)) {
    return [];
  }

  let records: Array<Record<string, unknown>>;

  try {
    records = await readJsonlFile<Record<string, unknown>>(resolvedPath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }

  return records.map((record, index): ContextChunkMatch => {
    const sourceRefs = asStringArrayValue(record.source_refs);
    const lineageRefs = asStringArrayValue(record.lineage_refs);
    const parseDiagnosticIds = asStringArrayValue(record.parse_diagnostic_ids);
    const sourceMapRefs = asStringArrayValue(record.source_map_refs);
    const chunkId = asNonEmptyString(record.chunk_id) ?? `query_index.chunk_${index + 1}`;
    const renderPolicy = asNonEmptyString(record.render_policy);
    const pageFurnitureKind = asNonEmptyString(record.page_furniture_kind);
    const normalizedSourcePath = asNonEmptyString(record.normalized_source_path);
    const headingPath = asStringArrayValue(record.heading_path);
    const estimatedTokens = asPositiveInteger(record.estimated_tokens);
    const lineNumbers = Array.isArray(record.line_numbers)
      ? record.line_numbers.filter((value): value is number => Number.isInteger(value) && value > 0)
      : [];

    return {
      chunk_id: chunkId,
      kind: "chunk",
      title: asNonEmptyString(record.title) ?? asNonEmptyString(record.normalized_source_path) ?? "query_index chunk",
      text: asNonEmptyString(record.text) ?? "",
      score: 0,
      evidence_ids: [],
      object_id: chunkId,
      content_role: normalizeContextChunkContentRole(record.content_role),
      chunk_level: normalizeContextChunkLevel(record.chunk_level),
      ...(headingPath.length > 0 ? { heading_path: headingPath } : {}),
      ...(estimatedTokens !== undefined ? { estimated_tokens: estimatedTokens } : {}),
      ...(renderPolicy ? { render_policy: renderPolicy } : {}),
      ...(pageFurnitureKind ? { page_furniture_kind: pageFurnitureKind } : {}),
      ...(typeof record.page_number === "number" && Number.isFinite(record.page_number) ? { page_number: record.page_number } : {}),
      ...(lineNumbers.length > 0 ? { line_numbers: lineNumbers } : {}),
      ...(normalizedSourcePath ? { normalized_source_path: normalizedSourcePath } : {}),
      source_refs: sourceRefs,
      lineage_refs: lineageRefs.length ? lineageRefs : sourceRefs,
      parse_diagnostic_ids: parseDiagnosticIds.length ? parseDiagnosticIds : getParseDiagnosticIdsForSourceRefs(state, sourceRefs),
      source_map_refs: sourceMapRefs.length ? sourceMapRefs : getSourceMapRefsForSourceRefs(sourceRefs)
    };
  });
}

function normalizeContextChunkContentRole(value: unknown): NonNullable<ContextChunkMatch["content_role"]> {
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

function normalizeContextChunkLevel(value: unknown): NonNullable<ContextChunkMatch["chunk_level"]> {
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

async function buildNormalizedSourceSearchCandidates(
  packageRoot: string,
  state: ContextPackageState
): Promise<ContextChunkMatch[]> {
  const candidates = await Promise.all(
    state.parseDiagnostics.map(async (diagnostic): Promise<ContextChunkMatch | undefined> => {
      const normalizedSource = resolveNormalizedSourcePath(packageRoot, diagnostic.normalized_source_path);

      if (!normalizedSource) {
        return undefined;
      }

      let text: string;

      try {
        text = await readFile(normalizedSource.resolvedPath, "utf8");
      } catch (error) {
        if (isNodeErrorWithCode(error, "ENOENT")) {
          return undefined;
        }

        throw error;
      }

      const sourceId = diagnostic.source_id ?? diagnostic.source_refs?.[0] ?? diagnostic.diagnostic_id;
      const sourceRefs = diagnostic.source_refs?.length ? diagnostic.source_refs : diagnostic.source_id ? [diagnostic.source_id] : [];

      return {
        chunk_id: `normalized_source.${sourceId}`,
        kind: "chunk",
        title: normalizedSource.normalizedPath,
        text,
        score: 0,
        evidence_ids: [],
        object_id: sourceId,
        source_refs: sourceRefs,
        lineage_refs: diagnostic.lineage_refs?.length ? diagnostic.lineage_refs : sourceRefs,
        parse_diagnostic_ids: [diagnostic.diagnostic_id],
        source_map_refs: getSourceMapRefsForSourceRefs(sourceRefs)
      };
    })
  );

  return candidates.filter((candidate): candidate is ContextChunkMatch => candidate !== undefined);
}

function resolveNormalizedSourcePath(
  packageRoot: string,
  filePath: string | undefined
): { normalizedPath: string; resolvedPath: string } | undefined {
  const normalizedPath = normalizePackagePath(filePath);

  if (
    !normalizedPath ||
    !normalizedPath.startsWith("source/normalized/") ||
    normalizedPath.startsWith("/") ||
    /^[a-z]:/i.test(normalizedPath) ||
    normalizedPath.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  const rootPath = path.resolve(packageRoot);
  const resolvedPath = path.resolve(rootPath, normalizedPath);
  const normalizedRoot = rootPath.toLowerCase();
  const normalizedResolved = resolvedPath.toLowerCase();
  const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;

  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(rootPrefix)) {
    return undefined;
  }

  return { normalizedPath, resolvedPath };
}

function scoreContextSearchCandidate(candidateText: string, normalizedQuery: string, queryTokens: string[]): number {
  if (!normalizedQuery && queryTokens.length === 0) {
    return 0;
  }

  let score = searchTextIncludes(candidateText, normalizedQuery) ? 3 : 0;
  score += countSearchTokenMatches(queryTokens, candidateText);

  return score;
}

export async function answerWithGroundedModel(
  packageRoot: string,
  question: string,
  model: ModelAdapter,
  options: GroundedModelAnswerOptions = {}
): Promise<GroundedModelAnswerResult> {
  const baseAnswer = await answerWithPreparedContext(packageRoot, question);
  const answerStatus = resolveGroundedModelAnswerStatus(baseAnswer.answer_status);

  if (baseAnswer.evidence_ids.length === 0) {
    return buildGroundedModelFallbackResult(baseAnswer, model.name, {
      message: "当前问题没有可绑定的 evidence_id，Runtime 已保留确定性答案；模型不会被用于补造证据。",
      code: "MODEL_OUTPUT_REJECTED"
    });
  }

  const summary = await buildPackageContextSummary(packageRoot);
  const messages = buildGroundedModelMessages(summary, question, baseAnswer, options.systemPrompt);

  try {
    const modelOutput = await model.chat({
      messages,
      temperature: options.temperature ?? 0.2,
      response_format: { type: "json_object" },
      ...(options.max_tokens !== undefined ? { max_tokens: options.max_tokens } : {})
    });
    const structuredOutput = parseGroundedModelStructuredOutput(modelOutput.content, baseAnswer);

    return {
      status: baseAnswer.status,
      answerability_status: baseAnswer.answerability_status,
      answer_status: answerStatus,
      answer: structuredOutput.answer,
      source: "grounded_model",
      generation_status: "ai_generated",
      review_status: "needs_review",
      model_adapter: model.name,
      base_answer: baseAnswer,
      claim_ids: baseAnswer.claim_ids,
      evidence_ids: baseAnswer.evidence_ids,
      evidence_sources: baseAnswer.evidence_sources,
      data_requests: baseAnswer.data_requests,
      structured_output: {
        schema_version: "open_insight.grounded_answer.v0.1",
        parse_status: "valid"
      }
    };
  } catch (error) {
    const message = getGroundedModelFallbackMessage(error);
    const code = getGroundedModelFallbackCode(error);

    return buildGroundedModelFallbackResult(baseAnswer, model.name, { message, code });
  }
}

function resolveGroundedModelAnswerStatus(answerStatus: string): string {
  return answerStatus === "verified" ? "needs_review" : answerStatus;
}

function buildGroundedModelFallbackResult(
  baseAnswer: DeterministicAnswerResult,
  modelAdapter: string,
  modelError: { message: string; code: GroundedModelErrorCode }
): GroundedModelAnswerResult {
  return {
    status: baseAnswer.status,
    answerability_status: baseAnswer.answerability_status,
    answer_status: resolveGroundedModelAnswerStatus(baseAnswer.answer_status),
    answer: baseAnswer.answer,
    source: "deterministic_fallback",
    generation_status: "model_error",
    review_status: "needs_review",
    model_adapter: modelAdapter,
    base_answer: baseAnswer,
    claim_ids: baseAnswer.claim_ids,
    evidence_ids: baseAnswer.evidence_ids,
    evidence_sources: baseAnswer.evidence_sources,
    data_requests: baseAnswer.data_requests,
    structured_output: {
      schema_version: "open_insight.grounded_answer.v0.1",
      parse_status: "invalid",
      error: modelError.message
    },
    model_error: {
      message: modelError.message,
      code: modelError.code
    }
  };
}

function resolveRuntimeAnswerabilityStatus(answerStatus: string): RuntimeAnswerabilityStatus {
  if (answerStatus === "unanswerable") {
    return "unanswerable";
  }

  if (answerStatus === "partial") {
    return "partial";
  }

  if (answerStatus === "needs_review" || answerStatus === "requires_expert_review" || answerStatus === "weakly_supported") {
    return "needs_review";
  }

  return "answered";
}

function parseGroundedModelStructuredOutput(content: string, baseAnswer: DeterministicAnswerResult): GroundedModelStructuredOutput {
  let value: unknown;

  try {
    value = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`模型结构化输出不是有效 JSON：${error instanceof Error ? error.message : "解析失败"}`);
  }

  if (!isRecord(value)) {
    throw new Error("模型结构化输出必须是 JSON 对象。");
  }

  const schemaVersion = value.schema_version;
  const status = value.status;
  const answer = typeof value.answer === "string" ? value.answer.trim() : "";
  const claimIds = asStringArray(value.claim_ids, "claim_ids");
  const evidenceIds = asStringArray(value.evidence_ids, "evidence_ids");
  const dataRequestIds = asStringArray(value.data_request_ids, "data_request_ids");
  const expectedDataRequestIds = baseAnswer.data_requests
    .map((request) => request.request_id)
    .filter((requestId): requestId is string => typeof requestId === "string" && requestId.length > 0);

  if (schemaVersion !== "open_insight.grounded_answer.v0.1") {
    throw new Error("模型结构化输出缺少正确的 schema_version。");
  }

  if (status !== baseAnswer.status) {
    throw new Error(`模型结构化输出 status=${String(status)} 与确定性答案 status=${baseAnswer.status} 不一致。`);
  }

  if (!answer) {
    throw new Error("模型结构化输出 answer 不能为空。");
  }

  assertSameStringSet("claim_ids", claimIds, baseAnswer.claim_ids);
  assertSameStringSet("evidence_ids", evidenceIds, baseAnswer.evidence_ids);
  assertSameStringSet("data_request_ids", dataRequestIds, expectedDataRequestIds);

  if (value.generation_status !== "ai_generated") {
    throw new Error("模型结构化输出 generation_status 必须是 ai_generated。");
  }

  if (value.review_status !== "needs_review") {
    throw new Error("模型结构化输出 review_status 必须是 needs_review。");
  }

  return {
    schema_version: "open_insight.grounded_answer.v0.1",
    status: baseAnswer.status,
    answer,
    claim_ids: baseAnswer.claim_ids,
    evidence_ids: baseAnswer.evidence_ids,
    data_request_ids: expectedDataRequestIds,
    generation_status: "ai_generated",
    review_status: "needs_review"
  };
}

function buildMockGroundedModelOutput(userContent: string | undefined): GroundedModelStructuredOutput | undefined {
  if (!userContent) {
    return undefined;
  }

  try {
    const context = JSON.parse(userContent) as unknown;
    const baseAnswer = isRecord(context) ? context.deterministic_answer : undefined;

    if (!isDeterministicAnswerLike(baseAnswer)) {
      return undefined;
    }

    return {
      schema_version: "open_insight.grounded_answer.v0.1",
      status: baseAnswer.status,
      answer: `模拟模型回答：${baseAnswer.answer}`,
      claim_ids: baseAnswer.claim_ids,
      evidence_ids: baseAnswer.evidence_ids,
      data_request_ids: baseAnswer.data_requests
        .map((request) => request.request_id)
        .filter((requestId): requestId is string => typeof requestId === "string" && requestId.length > 0),
      generation_status: "ai_generated",
      review_status: "needs_review"
    };
  } catch {
    return undefined;
  }
}

function isDeterministicAnswerLike(value: unknown): value is DeterministicAnswerResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.status === "answered" || value.status === "unanswerable") &&
    typeof value.answer === "string" &&
    Array.isArray(value.claim_ids) &&
    Array.isArray(value.evidence_ids) &&
    Array.isArray(value.data_requests)
  );
}

function assertSameStringSet(fieldName: string, actual: string[], expected: string[]): void {
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...new Set(expected)].sort();

  if (actualSorted.length !== expectedSorted.length || actualSorted.some((value, index) => value !== expectedSorted[index])) {
    throw new Error(`模型结构化输出 ${fieldName} 必须与确定性答案一致，不能新增、删除或替换引用。`);
  }
}

function getGroundedModelFallbackMessage(error: unknown): string {
  const message = getUnknownErrorMessage(error);

  if (message.startsWith("模型结构化输出")) {
    return `模型结构化输出无效：${message.replace(/^模型结构化输出/, "")} 已保留确定性答案。`;
  }

  return "模型调用失败，已保留确定性答案。";
}

function getGroundedModelFallbackCode(error: unknown): GroundedModelErrorCode {
  const message = getUnknownErrorMessage(error);

  return message.startsWith("模型结构化输出") ? "MODEL_OUTPUT_REJECTED" : "MODEL_REQUEST_FAILED";
}

function buildEvidenceSourceTraces(
  evidence: EvidenceRecord,
  catalog: DataCatalogFile,
  lineageSourcesFile: LineageSourcesFile | undefined
): EvidenceSourceTrace[] {
  const datasetById = new Map(catalog.datasets.map((dataset) => [dataset.dataset_id, dataset]));
  const lineageSourceByPath = new Map(
    (lineageSourcesFile?.sources ?? [])
      .map((source) => [normalizePackagePath(source.path), source] as const)
      .filter((entry): entry is readonly [string, LineageSourceRecord] => entry[0] !== undefined)
  );

  return (evidence.source_refs ?? []).map((sourceRef) => {
    const dataset = datasetById.get(sourceRef.dataset_id);
    const resolvedPath = normalizePackagePath(sourceRef.path) ?? normalizePackagePath(dataset?.path);
    const lineageSource = resolvedPath ? lineageSourceByPath.get(resolvedPath) : undefined;

    return {
      source_ref: sourceRef,
      ...(resolvedPath ? { resolved_path: resolvedPath } : {}),
      ...(dataset
        ? {
            dataset: {
              dataset_id: dataset.dataset_id,
              ...(dataset.path ? { path: dataset.path } : {}),
              ...(dataset.format ? { format: dataset.format } : {}),
              ...(dataset.columns ? { column_count: dataset.columns.length } : {})
            }
          }
        : {}),
      ...(lineageSource
        ? {
            lineage_source: {
              source_id: lineageSource.source_id,
              type: lineageSource.type,
              ...(lineageSource.path ? { path: lineageSource.path } : {})
            }
          }
        : {})
    };
  });
}

function buildGroundedModelMessages(
  summary: PackageContextSummary,
  question: string,
  baseAnswer: DeterministicAnswerResult,
  systemPrompt: string | undefined
): ModelChatInput["messages"] {
  const defaultSystemPrompt = [
    "你是 Open Insight Runtime 的受控回答器。",
    "只能基于用户问题、deterministic_answer、evidence_ids、evidence_sources 和 data_requests 回答。",
    "不得新增数字、来源、结论或证据；不得把不可回答问题伪装成已回答。",
    "必须只返回 JSON 对象，不要返回 Markdown、解释性前后缀或自由文本。",
    "JSON 必须包含 schema_version、status、answer、claim_ids、evidence_ids、data_request_ids、generation_status、review_status。",
    "schema_version 必须是 open_insight.grounded_answer.v0.1；status 和引用 ID 必须与 deterministic_answer 完全一致。",
    "generation_status 必须是 ai_generated；review_status 必须是 needs_review。",
    "如果 status 是 unanswerable，必须清楚说明当前不能回答，并列出需要补充的数据。",
    "输出使用中文，语气专业、简洁，并保留证据引用。"
  ].join("\n");

  const expectedDataRequestIds = baseAnswer.data_requests
    .map((request) => request.request_id)
    .filter((requestId): requestId is string => typeof requestId === "string" && requestId.length > 0);
  const context = {
    package: {
      package_id: summary.package_id,
      title: summary.title,
      spec_version: summary.spec_version
    },
    question,
    deterministic_answer: baseAnswer,
    output_contract: {
      schema_version: "open_insight.grounded_answer.v0.1",
      status: baseAnswer.status,
      claim_ids: baseAnswer.claim_ids,
      evidence_ids: baseAnswer.evidence_ids,
      data_request_ids: expectedDataRequestIds,
      generation_status: "ai_generated",
      review_status: "needs_review"
    }
  };

  return [
    {
      role: "system",
      content: systemPrompt ?? defaultSystemPrompt
    },
    {
      role: "user",
      content: JSON.stringify(context, null, 2)
    }
  ];
}

function normalizeRequiredConfigValue(value: string, fieldName: string): string {
  const normalized = normalizeOptionalConfigValue(value);

  if (!normalized) {
    throw new Error(`OpenAI 兼容模型配置缺少 ${fieldName}。`);
  }

  return normalized;
}

function normalizeOptionalConfigValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");

  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");

  if (normalized.endsWith("/models")) {
    return normalized;
  }

  if (normalized.endsWith("/chat/completions")) {
    return `${normalized.slice(0, -"/chat/completions".length)}/models`;
  }

  return `${normalized}/models`;
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, apiKey: string, timeoutMs: number): Promise<Response> {
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timeout = controller
    ? setTimeout(() => {
        controller.abort();
      }, timeoutMs)
    : undefined;

  try {
    return await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`
      },
      ...(controller ? { signal: controller.signal } : {})
    });
  } catch (error) {
    if (isNamedError(error, "AbortError")) {
      throw new Error(`请求超时：超过 ${timeoutMs}ms。`);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("模型响应格式无法识别：返回内容不是有效 JSON。");
  }
}

function extractChatMessageContent(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return undefined;
  }

  const firstChoice = payload.choices[0];

  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    return undefined;
  }

  return extractContentText(firstChoice.message.content);
}

function extractModelListItems(payload: unknown): OpenAICompatibleModelListItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("模型列表响应格式无法识别：缺少 data 数组。");
  }

  return payload.data
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== "string" || item.id.trim().length === 0) {
        return undefined;
      }

      return { id: item.id.trim() };
    })
    .filter((item): item is OpenAICompatibleModelListItem => item !== undefined);
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((part) => {
      if (!isRecord(part)) {
        return undefined;
      }

      const partText = part.text;
      return typeof partText === "string" ? partText : undefined;
    })
    .filter((partText): partText is string => partText !== undefined)
    .join("");

  return text ? text : undefined;
}

function asStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`模型结构化输出 ${fieldName} 必须是字符串数组。`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDefaultEnv(): ModelAdapterEnvRecord {
  return typeof process === "undefined" ? {} : process.env;
}

function readOpenAICompatibleEnvConfig(env: ModelAdapterEnvRecord): {
  source: OpenAICompatibleModelEnvSource;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  name: string;
  missing: string[];
} {
  const source = selectOpenAICompatibleEnvSource(env);
  const baseUrl = firstNonBlank(env.OPEN_INSIGHT_MODEL_BASE_URL, env.XIAOMI_API_BASE_URL);
  const apiKey = firstNonBlank(env.OPEN_INSIGHT_MODEL_API_KEY, env.XIAOMI_API_KEY);
  const model = firstNonBlank(env.OPEN_INSIGHT_MODEL_NAME, env.XIAOMI_MODEL);
  const missing: string[] = [];

  if (!baseUrl) {
    missing.push("OPEN_INSIGHT_MODEL_BASE_URL 或 XIAOMI_API_BASE_URL");
  }

  if (!apiKey) {
    missing.push("OPEN_INSIGHT_MODEL_API_KEY 或 XIAOMI_API_KEY");
  }

  if (!model) {
    missing.push("OPEN_INSIGHT_MODEL_NAME 或 XIAOMI_MODEL");
  }

  return {
    source,
    baseUrl,
    apiKey,
    model,
    name: source === "xiaomi" ? "xiaomi-openai-compatible" : "openai-compatible",
    missing
  };
}

function selectOpenAICompatibleEnvSource(env: ModelAdapterEnvRecord): OpenAICompatibleModelEnvSource {
  return hasAnyEnvValue(env, ["XIAOMI_API_BASE_URL", "XIAOMI_API_KEY", "XIAOMI_MODEL"]) &&
    !hasAnyEnvValue(env, ["OPEN_INSIGHT_MODEL_BASE_URL", "OPEN_INSIGHT_MODEL_API_KEY", "OPEN_INSIGHT_MODEL_NAME"])
    ? "xiaomi"
    : "open_insight";
}

function hasAnyEnvValue(env: ModelAdapterEnvRecord, keys: string[]): boolean {
  return keys.some((key) => normalizeOptionalConfigValue(env[key]) !== undefined);
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalConfigValue(value);

    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNamedError(error: unknown, name: string): boolean {
  return isRecord(error) && error.name === name;
}

function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePackagePath(filePath: string | undefined): string | undefined {
  const normalized = filePath?.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/").trim();

  return normalized ? normalized : undefined;
}

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  const latinTokens = normalized.match(/[a-z0-9_]+/giu) ?? [];
  const cjkSequences = normalized.match(/\p{Script=Han}+/gu) ?? [];
  const cjkTokens = cjkSequences.flatMap(buildCjkSearchTokens);

  return [...new Set([...latinTokens, ...cjkTokens].map((token) => token.trim().toLowerCase()).filter(Boolean))];
}

function selectFuzzyPreparedQuestion(
  preparedQuestions: PreparedQuestionRecord[],
  normalizedQuestion: string
): PreparedQuestionRecord | undefined {
  return selectFuzzyPreparedQuestions(preparedQuestions, normalizedQuestion)[0];
}

function selectFuzzyPreparedQuestions(
  preparedQuestions: PreparedQuestionRecord[],
  normalizedQuestion: string
): PreparedQuestionRecord[] {
  return selectFuzzyMatches(preparedQuestions, normalizedQuestion, (record) => `${record.question} ${record.answer}`);
}

function selectFuzzyAnswerabilityRequests(
  requests: DataRequestRecord[],
  normalizedQuery: string
): DataRequestRecord[] {
  return selectFuzzyMatches(requests, normalizedQuery, formatAnswerabilityRequestSearchText);
}

function selectFuzzyMatches<T>(
  records: T[],
  normalizedQuestion: string,
  formatSearchText: (record: T) => string
): T[] {
  const queryTokens = tokenize(normalizedQuestion).filter(isMeaningfulSearchToken);
  const minimumMatches = queryTokens.length === 1 ? 1 : 2;

  if (queryTokens.length === 0) {
    return [];
  }

  return records
    .map((record, index) => ({
      record,
      index,
      matches: countSearchTokenMatches(queryTokens, formatSearchText(record))
    }))
    .filter((match) => match.matches >= minimumMatches)
    .sort((left, right) => right.matches - left.matches || left.index - right.index)
    .map((match) => match.record);
}

function countSearchTokenMatches(queryTokens: string[], haystack: string): number {
  const haystackTokens = new Set(tokenize(haystack).filter(isMeaningfulSearchToken));

  return queryTokens.filter((token) => haystackTokens.has(token)).length;
}

function searchTextIncludes(haystack: string, normalizedNeedle: string): boolean {
  return normalizeSearchText(haystack).includes(normalizedNeedle);
}

function formatAnswerabilityRequestSearchText(request: DataRequestRecord): string {
  return [
    request.question,
    request.status,
    request.why_needed,
    request.required_grain,
    request.required_time_range,
    request.priority,
    ...request.missing_fields,
    ...(request.affected_findings ?? [])
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

const SEARCH_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "from",
  "have",
  "into",
  "that",
  "this",
  "what",
  "when",
  "were",
  "which",
  "with",
  "would"
]);

function isMeaningfulSearchToken(token: string): boolean {
  if (containsCjk(token)) {
    return Array.from(token).length >= 2;
  }

  return token.length >= 4 && !SEARCH_STOPWORDS.has(token);
}

function buildCjkSearchTokens(sequence: string): string[] {
  const chars = Array.from(sequence);

  if (chars.length < 2) {
    return [];
  }

  const tokens: string[] = [];

  if (chars.length <= 4) {
    tokens.push(chars.join(""));
  }

  for (const size of [2, 3]) {
    if (chars.length < size) {
      continue;
    }

    for (let index = 0; index <= chars.length - size; index += 1) {
      tokens.push(chars.slice(index, index + size).join(""));
    }
  }

  return tokens;
}

function containsCjk(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

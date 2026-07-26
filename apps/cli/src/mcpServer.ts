import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { unpackInsightArchive } from "@open-insight/core";
import {
  buildContextUserMaterialContract,
  listContextDiagnostics,
  listContextObjects,
  listContextSources,
  queryContextTable,
  resolveContextSource,
  summarizeContextPackage,
  type ContextObjectKind,
  type QueryContextTableOptions
} from "@open-insight/runtime";
import { validateInsightPackage } from "@open-insight/validator";
import {
  buildContextAnswerContextForCli,
  buildContextHandoffForCli,
  evaluateContextTokensForCli,
  searchContextChunksForCli,
  type ContextAnswerContextResult,
  type ContextHandoffResult
} from "./contextSearch.js";
import { readVersionLog, readVersionStatus } from "./versionGraph.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_SERVER_NAME = "open-insight-context";
const MCP_SERVER_VERSION = "0.0.0";

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
const MCP_VALIDATE_CONTEXT_SCHEMA_VERSION = "open-insight.mcp-validate-context.v0.1" as const;
const MCP_TOKEN_BUDGET_SCHEMA = { type: "number", minimum: 500, maximum: 12000 } as const;

type JsonRpcId = string | number | null;
type JsonObject = Record<string, unknown>;

function readDocumentIds(args: JsonObject): string[] {
  const values = [
    ...(typeof args.document_id === "string" ? [args.document_id] : []),
    ...(Array.isArray(args.document_ids) ? args.document_ids.filter((value): value is string => typeof value === "string") : [])
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: JsonObject;
}

interface McpServerContext {
  packageRoot: string;
  schemaRoot: string;
}

export interface ServeMcpStdioOptions {
  packageRoot: string;
  schemaRoot: string;
  input?: Readable;
  output?: Writable;
}

const toolDefinitions = [
  {
    name: "open_insight_context_summary",
    description: "读取 .insight 上下文信息库摘要，不调用模型、不执行包内代码。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "open_insight_list_sources",
    description: "列出 .insight 包中的来源文件、source refs 和 lineage refs。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "open_insight_list_objects",
    description: "列出 semantic kernel / v0.1 兼容层对象，可按 kind 过滤。",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["table", "document", "chunk", "field", "metric", "evidence", "prepared_question", "data_request", "query_index"]
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "open_insight_query_table",
    description: "对表格执行只读查询，支持 count、sum:<field>、average:<field>。",
    inputSchema: {
      type: "object",
      properties: {
        table_id: { type: "string" },
        op: { type: "string" },
        filter: { type: "string" }
      },
      required: ["table_id", "op"],
      additionalProperties: false
    }
  },
  {
    name: "open_insight_search_chunks",
    description: "检索文档 chunk 或 v0.1 兼容层文本片段。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        document_id: { type: "string" },
        document_ids: { type: "array", items: { type: "string" } },
        limit: { type: "number" },
        compact: { type: "boolean" },
        token_budget: MCP_TOKEN_BUDGET_SCHEMA,
        include_page_furniture: { type: "boolean" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "open_insight_token_eval",
    description: "评估同一 query 下完整文本、normalized source 与 compact context 的估算 token、降噪和追源覆盖率；只读、不调用模型。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        document_id: { type: "string" },
        document_ids: { type: "array", items: { type: "string" } },
        token_budget: MCP_TOKEN_BUDGET_SCHEMA
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "open_insight_resolve_source",
    description: "把对象、evidence、chunk、source ref 解析回可追溯来源。",
    inputSchema: {
      type: "object",
      properties: {
        target_id: { type: "string" }
      },
      required: ["target_id"],
      additionalProperties: false
    }
  },
  {
    name: "open_insight_material_contract",
    description: "读取外部 LLM 生成用户材料时必须遵守的引用、输出和只读边界。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "open_insight_context_handoff",
    description: "一次性返回外部 LLM 生成用户材料所需的 compact context、token eval、material contract 和安全边界。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        document_id: { type: "string" },
        document_ids: { type: "array", items: { type: "string" } },
        token_budget: MCP_TOKEN_BUDGET_SCHEMA,
        route: { type: "string" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "open_insight_answer_context",
    description: "Return compact context plus bounded normalized fragments for an external LLM answer. Read-only; no model call.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        document_id: { type: "string" },
        document_ids: { type: "array", items: { type: "string" } },
        token_budget: MCP_TOKEN_BUDGET_SCHEMA,
        max_follow_up_reads: { type: "number", minimum: 1, maximum: 20 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "open_insight_validate_context",
    description: "运行基础 validate 并返回 context diagnostics，帮助外部 LLM 判断可信边界。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "open_insight_version_status",
    description: "只读读取 .insight 版本图状态：父包、合并、回档、review patch 和 base package mutation 边界。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "open_insight_version_log",
    description: "只读读取 .insight 版本事件日志，供外部 LLM 解释派生、合并和回档来源。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
];

export function parseMcpServeArgs(args: string[], invocationRoot: string): ServeMcpStdioOptions {
  const [command, subcommand] = args;
  if (command !== "mcp" || subcommand !== "serve") {
    throw new Error("用法：insight mcp serve <package-file-or-dir> --transport stdio");
  }

  const transport = getFlagValue(args, "--transport") ?? "stdio";
  if (transport !== "stdio") {
    throw new Error("当前 MCP v0 只支持 --transport stdio");
  }

  const packageArg = getMcpPackageArg(args);
  if (!packageArg) {
    throw new Error("用法：insight mcp serve <package-file-or-dir> --transport stdio");
  }

  return {
    packageRoot: path.resolve(invocationRoot, packageArg),
    schemaRoot: path.resolve(invocationRoot, "spec/schemas")
  };
}

export async function serveMcpStdio(options: ServeMcpStdioOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  await withReadablePackageRoot(options.packageRoot, async (packageRoot) => {
    const context: McpServerContext = {
      packageRoot,
      schemaRoot: options.schemaRoot
    };

    input.setEncoding("utf8");
    let buffer = "";

    for await (const chunk of input) {
      buffer += String(chunk);
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          const response = await handleMcpLine(line, context);
          if (response) {
            output.write(`${JSON.stringify(response)}\n`);
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trim();
    if (tail.length > 0) {
      const response = await handleMcpLine(tail, context);
      if (response) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    }
  });
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

  const tempDir = await mkdtemp(path.join(tmpdir(), "open-insight-mcp-"));
  try {
    await unpackInsightArchive({ archiveFile: resolvedInput, outputDir: tempDir });
    return await action(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function handleMcpLine(line: string, context: McpServerContext): Promise<JsonObject | undefined> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "无法解析 MCP JSON-RPC 请求。");
  }

  if (request.id === undefined) {
    return undefined;
  }

  try {
    const result = await handleMcpRequest(request, context);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result
    };
  } catch (error) {
    return jsonRpcError(request.id, -32000, error instanceof Error ? error.message : "MCP 工具调用失败。");
  }
}

async function handleMcpRequest(request: JsonRpcRequest, context: McpServerContext): Promise<unknown> {
  if (request.method === "initialize") {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION
      }
    };
  }

  if (request.method === "tools/list") {
    return {
      tools: toolDefinitions
    };
  }

  if (request.method === "tools/call") {
    const params = request.params ?? {};
    const toolName = asString(params.name, "MCP tools/call 缺少 tool name。");
    const toolArgs = isObject(params.arguments) ? params.arguments : {};
    const result = await callTool(toolName, toolArgs, context);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ],
      structuredContent: result,
      isError: false
    };
  }

  throw new Error(`未知 MCP 方法：${request.method ?? ""}`);
}

async function callTool(toolName: string, args: JsonObject, context: McpServerContext): Promise<JsonObject> {
  if (toolName === "open_insight_context_summary") {
    return {
      schema_version: CONTEXT_SUMMARY_SCHEMA_VERSION,
      ...(await summarizeContextPackage(context.packageRoot))
    };
  }

  if (toolName === "open_insight_list_sources") {
    return {
      schema_version: CONTEXT_SOURCES_SCHEMA_VERSION,
      ...(await listContextSources(context.packageRoot))
    };
  }

  if (toolName === "open_insight_list_objects") {
    const kind = typeof args.kind === "string" && args.kind.trim().length > 0 ? (args.kind as ContextObjectKind) : undefined;
    return {
      schema_version: CONTEXT_OBJECTS_SCHEMA_VERSION,
      ...(await listContextObjects(context.packageRoot, kind ? { kind } : {}))
    };
  }

  if (toolName === "open_insight_query_table") {
    const tableId = asString(args.table_id, "open_insight_query_table 缺少 table_id。");
    const op = asTableQueryOp(asString(args.op, "open_insight_query_table 缺少 op。"));
    const filter = typeof args.filter === "string" && args.filter.trim().length > 0 ? args.filter : undefined;
    const options: QueryContextTableOptions = filter ? { op, filter } : { op };
    return {
      schema_version: CONTEXT_TABLE_QUERY_SCHEMA_VERSION,
      ...(await queryContextTable(context.packageRoot, tableId, options))
    };
  }

  if (toolName === "open_insight_search_chunks") {
    const query = asString(args.query, "open_insight_search_chunks 缺少 query。");
    const documentIds = readDocumentIds(args);
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : undefined;
    const compact = args.compact === true;
    const tokenBudget = typeof args.token_budget === "number" && Number.isFinite(args.token_budget) ? Math.floor(args.token_budget) : undefined;
    const includePageFurniture = args.include_page_furniture === true;
    return {
      schema_version: compact ? CONTEXT_COMPACT_RETRIEVAL_SCHEMA_VERSION : CONTEXT_CHUNK_SEARCH_SCHEMA_VERSION,
      ...(await searchContextChunksForCli(context.packageRoot, query, {
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(limit ? { limit } : {}),
        ...(includePageFurniture ? { includePageFurniture: true } : {}),
        ...(compact ? { compact: true } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : {})
      }))
    };
  }

  if (toolName === "open_insight_token_eval") {
    const query = asString(args.query, "open_insight_token_eval 缺少 query。");
    const documentIds = readDocumentIds(args);
    const tokenBudget = typeof args.token_budget === "number" && Number.isFinite(args.token_budget) ? Math.floor(args.token_budget) : undefined;
    return {
      schema_version: CONTEXT_TOKEN_EVAL_SCHEMA_VERSION,
      ...(await evaluateContextTokensForCli(context.packageRoot, query, {
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : {})
      }))
    };
  }

  if (toolName === "open_insight_resolve_source") {
    const targetId = asString(args.target_id, "open_insight_resolve_source 缺少 target_id。");
    return {
      schema_version: CONTEXT_SOURCE_RESOLVE_SCHEMA_VERSION,
      ...(await resolveContextSource(context.packageRoot, targetId))
    };
  }

  if (toolName === "open_insight_material_contract") {
    return {
      schema_version: CONTEXT_USER_MATERIAL_CONTRACT_SCHEMA_VERSION,
      ...(await buildContextUserMaterialContract(context.packageRoot))
    };
  }

  if (toolName === "open_insight_context_handoff") {
    const query = asString(args.query, "open_insight_context_handoff 缺少 query。");
    const documentIds = readDocumentIds(args);
    const tokenBudget = typeof args.token_budget === "number" && Number.isFinite(args.token_budget) ? Math.floor(args.token_budget) : undefined;
    const selectedRouteId = typeof args.route === "string" && args.route.trim().length > 0 ? args.route.trim() : undefined;
    const result = {
      schema_version: CONTEXT_HANDOFF_SCHEMA_VERSION,
      ...(await buildContextHandoffForCli(context.packageRoot, query, {
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : {})
      }))
    };
    return focusContextHandoffRoute(result, selectedRouteId);
  }

  if (toolName === "open_insight_answer_context") {
    const query = asString(args.query, "open_insight_answer_context missing query.");
    const documentIds = readDocumentIds(args);
    const tokenBudget = typeof args.token_budget === "number" && Number.isFinite(args.token_budget) ? Math.floor(args.token_budget) : undefined;
    const maxFollowUpReads =
      typeof args.max_follow_up_reads === "number" && Number.isFinite(args.max_follow_up_reads)
        ? Math.floor(args.max_follow_up_reads)
        : undefined;
    const result: McpContextAnswerContextResult = {
      schema_version: CONTEXT_ANSWER_CONTEXT_SCHEMA_VERSION,
      ...(await buildContextAnswerContextForCli(context.packageRoot, query, {
        ...(documentIds.length > 0 ? { documentIds } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        ...(maxFollowUpReads !== undefined ? { maxFollowUpReads } : {})
      }))
    };
    return result as unknown as JsonObject;
  }

  if (toolName === "open_insight_validate_context") {
    const [validation, diagnostics] = await Promise.all([
      validateInsightPackage(context.packageRoot, { schemaRoot: context.schemaRoot }),
      listContextDiagnostics(context.packageRoot)
    ]);

    return {
      schema_version: MCP_VALIDATE_CONTEXT_SCHEMA_VERSION,
      status: validation.status === "invalid" ? "invalid" : "ok",
      validation,
      diagnostics: {
        schema_version: CONTEXT_DIAGNOSTICS_SCHEMA_VERSION,
        ...diagnostics
      },
      source_refs: diagnostics.source_refs,
      lineage_refs: diagnostics.lineage_refs,
      parse_diagnostic_ids: diagnostics.parse_diagnostic_ids,
      source_map_refs: diagnostics.source_map_refs
    };
  }

  if (toolName === "open_insight_version_status") {
    return (await readVersionStatus(context.packageRoot)) as unknown as JsonObject;
  }

  if (toolName === "open_insight_version_log") {
    return (await readVersionLog(context.packageRoot)) as unknown as JsonObject;
  }

  throw new Error(`未知 MCP 工具：${toolName}`);
}

function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function getMcpPackageArg(args: string[]): string | undefined {
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg.startsWith("--")) {
      if (arg === "--transport") {
        index += 1;
      }
      continue;
    }
    return arg;
  }
  return undefined;
}

function asString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

type McpContextHandoffResult = { schema_version: typeof CONTEXT_HANDOFF_SCHEMA_VERSION } & ContextHandoffResult;
type McpContextAnswerContextResult = { schema_version: typeof CONTEXT_ANSWER_CONTEXT_SCHEMA_VERSION } & ContextAnswerContextResult;

function focusContextHandoffRoute(result: McpContextHandoffResult, selectedRouteId: string | undefined): JsonObject {
  if (!selectedRouteId) {
    return result as unknown as JsonObject;
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
  } as unknown as JsonObject;
}

function asTableQueryOp(value: string): QueryContextTableOptions["op"] {
  if (value === "count" || value.startsWith("sum:") || value.startsWith("average:")) {
    return value as QueryContextTableOptions["op"];
  }

  throw new Error("open_insight_query_table 的 op 只支持 count、sum:<field> 或 average:<field>。");
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

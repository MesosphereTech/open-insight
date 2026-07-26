import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSIGHT_SPEC_VERSION, listPackageFiles, pathExists, readJsonFile, readJsonlFile, readManifest } from "@open-insight/core";

export interface AddOverlayQaOptions {
  packageRoot: string;
  outputDir: string;
  askResult: OverlayQaAnswerInput;
  createdAt?: string;
  createdBy?: string;
}

export interface OverlayQaAnswerInput {
  status: "answered" | "unanswerable";
  answerability_status?: "answered" | "partial" | "unanswerable" | "needs_review";
  answer_status?: string;
  question: string;
  answer: string;
  requested_model_mode: "auto" | "deterministic" | "mock" | "real";
  resolved_model_mode: "deterministic" | "mock" | "real";
  model_enabled: boolean;
  model_adapter?: string;
  source: "prepared_question" | "runtime" | "grounded_model" | "deterministic_fallback" | "context_answer_model" | "context_answer_handoff";
  generation_status: "not_model_generated" | "ai_generated" | "model_error";
  review_status: "not_applicable" | "needs_review";
  claim_ids: string[];
  evidence_ids: string[];
  evidence_sources: unknown[];
  data_requests: Array<{ request_id?: string }>;
  base_answer?: unknown;
}

export interface AddOverlayQaResult {
  status: "overlay_qa_added";
  output_dir: string;
  source_package_id: string;
  overlay_package_id: string;
  overlay_id: string;
  qa_id: string;
  question: string;
  base_package_mutation: false;
  file_count: number;
}

interface OverlayMetadata {
  overlay_id?: string;
  overlay_type?: string;
  base_package_id?: string;
  base_title?: string;
  base_package_mutation?: boolean;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
}

interface OverlayQaRecord {
  qa_id?: string;
  visibility?: string;
  question?: string;
  answer?: string;
  status?: string;
  answerability_status?: string;
  answer_status?: string;
  requested_model_mode?: string;
  resolved_model_mode?: string;
  model_enabled?: boolean;
  model_adapter?: string;
  source?: string;
  generation_status?: string;
  review_status?: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  evidence_sources?: unknown[];
  data_request_ids?: string[];
  data_requests?: unknown[];
  base_answer?: unknown;
  base_package_mutation?: boolean;
  created_at?: string;
  created_by?: string;
  source_command?: string;
}

export async function addOverlayQa(options: AddOverlayQaOptions): Promise<AddOverlayQaResult> {
  const packageRoot = path.resolve(options.packageRoot);
  const outputDir = path.resolve(options.outputDir);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const createdBy = options.createdBy ?? "insight ask --save-overlay";
  const question = options.askResult.question.trim();

  if (question.length === 0) {
    throw new Error("overlay 问答问题不能为空");
  }

  if (options.askResult.answer.trim().length === 0) {
    throw new Error("overlay 问答答案不能为空");
  }

  if (await pathExists(outputDir)) {
    throw new Error(`输出目录已存在：${outputDir}`);
  }

  if (isPathInside(packageRoot, outputDir)) {
    throw new Error("输出目录不能位于来源包内部，避免把派生包写回 base package");
  }

  const manifest = await readManifest(packageRoot);
  const existingQa = await readExistingOverlayQa(packageRoot);
  const existingMetadata = await readExistingOverlayMetadata(packageRoot);
  const qaId = createUniqueQaId(question, existingQa);
  const overlayId = existingMetadata?.overlay_id ?? `overlay_${sanitizeId(manifest.package_id)}_${sanitizeId(qaId)}`;
  const overlayPackageId = `${manifest.package_id}.overlay.${sanitizeId(qaId)}`;
  const overlayMetadata: OverlayMetadata = {
    overlay_id: overlayId,
    overlay_type: "user_private_overlay",
    base_package_id: existingMetadata?.base_package_id ?? manifest.package_id,
    base_title: existingMetadata?.base_title ?? manifest.title,
    base_package_mutation: false,
    created_at: existingMetadata?.created_at ?? createdAt,
    created_by: existingMetadata?.created_by ?? createdBy,
    updated_at: createdAt,
    updated_by: createdBy
  };
  const record: OverlayQaRecord = {
    qa_id: qaId,
    visibility: "private",
    question,
    answer: options.askResult.answer.trim(),
    status: options.askResult.status,
    ...(options.askResult.answerability_status ? { answerability_status: options.askResult.answerability_status } : {}),
    ...(options.askResult.answer_status ? { answer_status: options.askResult.answer_status } : {}),
    requested_model_mode: options.askResult.requested_model_mode,
    resolved_model_mode: options.askResult.resolved_model_mode,
    model_enabled: options.askResult.model_enabled,
    ...(options.askResult.model_adapter ? { model_adapter: options.askResult.model_adapter } : {}),
    source: options.askResult.source,
    generation_status: options.askResult.generation_status,
    review_status: options.askResult.review_status,
    claim_ids: uniqueSorted(options.askResult.claim_ids),
    evidence_ids: uniqueSorted(options.askResult.evidence_ids),
    evidence_sources: options.askResult.evidence_sources,
    data_request_ids: uniqueSorted(
      options.askResult.data_requests
        .map((request) => request.request_id)
        .filter((requestId): requestId is string => typeof requestId === "string" && requestId.length > 0)
    ),
    data_requests: options.askResult.data_requests,
    ...(options.askResult.base_answer ? { base_answer: options.askResult.base_answer } : {}),
    base_package_mutation: false,
    created_at: createdAt,
    created_by: createdBy,
    source_command: "insight ask --save-overlay"
  };

  await cp(packageRoot, outputDir, { recursive: true });
  await writeJson(path.join(outputDir, "manifest.json"), {
    ...manifest,
    spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
    package_id: overlayPackageId,
    title: `${manifest.title} - 个人问答`,
    description: `包含用户私有 overlay 问答记录的新派生包；来源包 ${manifest.package_id} 不会被修改。`,
    created_at: createdAt,
    optional_capabilities: uniqueSorted([...(manifest.optional_capabilities ?? []), "overlay"])
  });
  await writeJson(path.join(outputDir, "overlay/metadata.json"), overlayMetadata);
  await writeJsonl(path.join(outputDir, "overlay/qa.jsonl"), [...existingQa, record]);

  return {
    status: "overlay_qa_added",
    output_dir: outputDir,
    source_package_id: manifest.package_id,
    overlay_package_id: overlayPackageId,
    overlay_id: overlayId,
    qa_id: qaId,
    question,
    base_package_mutation: false,
    file_count: (await listPackageFiles(outputDir)).length
  };
}

async function readExistingOverlayQa(packageRoot: string): Promise<OverlayQaRecord[]> {
  const qaPath = path.join(packageRoot, "overlay/qa.jsonl");

  if (!(await pathExists(qaPath))) {
    return [];
  }

  return readJsonlFile<OverlayQaRecord>(qaPath);
}

async function readExistingOverlayMetadata(packageRoot: string): Promise<OverlayMetadata | undefined> {
  const metadataPath = path.join(packageRoot, "overlay/metadata.json");

  if (!(await pathExists(metadataPath))) {
    return undefined;
  }

  return readJsonFile<OverlayMetadata>(metadataPath);
}

function createUniqueQaId(question: string, existingQa: OverlayQaRecord[]): string {
  const existingIds = new Set(existingQa.map((record) => record.qa_id).filter((qaId): qaId is string => qaId !== undefined));
  const baseId = `qa_${sanitizeId(question, "question").slice(0, 48)}`;
  let index = existingQa.length + 1;
  let candidate = `${baseId}_${String(index).padStart(3, "0")}`;

  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${baseId}_${String(index).padStart(3, "0")}`;
  }

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

function sanitizeId(value: string, fallback = "item"): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || fallback;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

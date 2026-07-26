import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  INSIGHT_SPEC_VERSION,
  listPackageFiles,
  pathExists,
  readJsonFile,
  readJsonlFile,
  readManifest
} from "@open-insight/core";

export type OverlayTargetType = "package" | "claim" | "evidence" | "view_block" | "question";

export interface AddOverlayNoteOptions {
  packageRoot: string;
  targetType: OverlayTargetType;
  targetId: string;
  body: string;
  outputDir: string;
  createdAt?: string;
  createdBy?: string;
}

export interface AddOverlayNoteResult {
  status: "overlay_note_added";
  output_dir: string;
  source_package_id: string;
  overlay_package_id: string;
  overlay_id: string;
  note_id: string;
  target_type: OverlayTargetType;
  target_id: string;
  base_package_mutation: false;
  file_count: number;
}

interface IdRecord {
  [key: string]: unknown;
}

interface HomepageView {
  blocks: Array<{ block_id: string }>;
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

interface OverlayNoteRecord {
  note_id?: string;
  note_type?: string;
  visibility?: string;
  target_type?: string;
  target_id?: string;
  body?: string;
  base_package_mutation?: boolean;
  created_at?: string;
  created_by?: string;
  source?: string;
}

export async function addOverlayNote(options: AddOverlayNoteOptions): Promise<AddOverlayNoteResult> {
  const packageRoot = path.resolve(options.packageRoot);
  const outputDir = path.resolve(options.outputDir);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const createdBy = options.createdBy ?? "insight add-overlay-note";
  const targetType = normalizeTargetType(options.targetType);

  if (options.body.trim().length === 0) {
    throw new Error("overlay 笔记内容不能为空");
  }

  if (await pathExists(outputDir)) {
    throw new Error(`输出目录已存在：${outputDir}`);
  }

  if (isPathInside(packageRoot, outputDir)) {
    throw new Error("输出目录不能位于来源包内部，避免把派生包写回 base package");
  }

  const manifest = await readManifest(packageRoot);
  const existingNotes = await readExistingOverlayNotes(packageRoot);
  const existingMetadata = await readExistingOverlayMetadata(packageRoot);
  const targetId = normalizeTargetId(targetType, options.targetId, manifest.package_id);

  await assertOverlayTargetExists(packageRoot, targetType, targetId);

  const noteId = createUniqueNoteId(targetType, targetId, existingNotes);
  const overlayId = existingMetadata?.overlay_id ?? `overlay_${sanitizeId(manifest.package_id)}_${sanitizeId(noteId)}`;
  const overlayPackageId = `${manifest.package_id}.overlay.${sanitizeId(noteId)}`;
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
  const note: OverlayNoteRecord = {
    note_id: noteId,
    note_type: "private_note",
    visibility: "private",
    target_type: targetType,
    target_id: targetId,
    body: options.body.trim(),
    base_package_mutation: false,
    created_at: createdAt,
    created_by: createdBy,
    source: "user_overlay"
  };

  await cp(packageRoot, outputDir, { recursive: true });
  await writeJson(path.join(outputDir, "manifest.json"), {
    ...manifest,
    spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
    package_id: overlayPackageId,
    title: `${manifest.title} - 个人注释`,
    description: `包含用户私有 overlay 笔记的新派生包；来源包 ${manifest.package_id} 不会被修改。`,
    created_at: createdAt,
    optional_capabilities: uniqueSorted([...(manifest.optional_capabilities ?? []), "overlay"])
  });
  await writeJson(path.join(outputDir, "overlay/metadata.json"), overlayMetadata);
  await writeJsonl(path.join(outputDir, "overlay/notes.jsonl"), [...existingNotes, note]);

  return {
    status: "overlay_note_added",
    output_dir: outputDir,
    source_package_id: manifest.package_id,
    overlay_package_id: overlayPackageId,
    overlay_id: overlayId,
    note_id: noteId,
    target_type: targetType,
    target_id: targetId,
    base_package_mutation: false,
    file_count: (await listPackageFiles(outputDir)).length
  };
}

async function readExistingOverlayNotes(packageRoot: string): Promise<OverlayNoteRecord[]> {
  const notesPath = path.join(packageRoot, "overlay/notes.jsonl");

  if (!(await pathExists(notesPath))) {
    return [];
  }

  return readJsonlFile<OverlayNoteRecord>(notesPath);
}

async function readExistingOverlayMetadata(packageRoot: string): Promise<OverlayMetadata | undefined> {
  const metadataPath = path.join(packageRoot, "overlay/metadata.json");

  if (!(await pathExists(metadataPath))) {
    return undefined;
  }

  return readJsonFile<OverlayMetadata>(metadataPath);
}

function normalizeTargetType(value: string): OverlayTargetType {
  if (["package", "claim", "evidence", "view_block", "question"].includes(value)) {
    return value as OverlayTargetType;
  }

  throw new Error(`overlay target_type 不支持：${value}`);
}

function normalizeTargetId(targetType: OverlayTargetType, targetId: string, packageId: string): string {
  if (targetType === "package" && targetId === "package") {
    return packageId;
  }

  if (targetId.trim().length === 0) {
    throw new Error("overlay target_id 不能为空");
  }

  return targetId.trim();
}

async function assertOverlayTargetExists(packageRoot: string, targetType: OverlayTargetType, targetId: string): Promise<void> {
  if (targetType === "package") {
    const manifest = await readManifest(packageRoot);

    if (targetId !== manifest.package_id) {
      throw new Error(`overlay package target_id 必须等于当前 package_id：${manifest.package_id}`);
    }

    return;
  }

  if (targetType === "claim") {
    await assertJsonlIdExists(packageRoot, "findings/claims.jsonl", "claim_id", targetId);
    return;
  }

  if (targetType === "evidence") {
    await assertJsonlIdExists(packageRoot, "evidence/evidence.jsonl", "evidence_id", targetId);
    return;
  }

  if (targetType === "question") {
    await assertJsonlIdExists(packageRoot, "qa/prepared_questions.jsonl", "question_id", targetId);
    return;
  }

  const homepage = await readJsonFile<HomepageView>(path.join(packageRoot, "views/homepage.json"));
  if (!homepage.blocks.some((block) => block.block_id === targetId)) {
    throw new Error(`overlay view_block target_id 不存在：${targetId}`);
  }
}

async function assertJsonlIdExists(packageRoot: string, relativePath: string, idKey: string, targetId: string): Promise<void> {
  const records = await readJsonlFile<IdRecord>(path.join(packageRoot, relativePath));

  if (!records.some((record) => record[idKey] === targetId)) {
    throw new Error(`overlay target_id 不存在：${targetId}`);
  }
}

function createUniqueNoteId(targetType: OverlayTargetType, targetId: string, existingNotes: OverlayNoteRecord[]): string {
  const existingIds = new Set(existingNotes.map((note) => note.note_id).filter((noteId): noteId is string => noteId !== undefined));
  const baseId = `note_${sanitizeId(targetType)}_${sanitizeId(targetId)}`;
  let index = existingNotes.length + 1;
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

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import { unzipSync, Zip, ZipDeflate } from "fflate";

export const INSIGHT_SPEC_VERSION = "0.1.0";

export type InsightCapability =
  | "core.read"
  | "data.catalog"
  | "semantic.metrics"
  | "views.basic"
  | "findings.claims"
  | "evidence.basic"
  | "qa.prepared"
  | "lineage.sources"
  | "answerability"
  | "overlay"
  | "merge"
  | "ai.tool_calling"
  | "charts.echarts"
  | "charts.vega_lite"
  | (string & {});

export interface InsightManifest {
  spec_version: string;
  package_id: string;
  package_type: "insight";
  title: string;
  description?: string;
  created_at: string;
  required_capabilities: InsightCapability[];
  optional_capabilities?: InsightCapability[];
  extensions?: InsightExtension[];
  fallbacks?: Record<string, string>;
  request_context?: RequestPackageContext;
  response_context?: ResponsePackageContext;
}

export interface InsightExtension {
  namespace: string;
  version: string;
  required: boolean;
}

export interface RequestPackageContext {
  parent_package_id: string;
  parent_title?: string;
  source_request_id: string;
  generated_from?: string;
  affected_findings?: string[];
}

export interface ResponsePackageContext {
  parent_package_id: string;
  parent_title?: string;
  request_package_id: string;
  source_request_id: string;
  response_id: string;
  response_state: "draft" | "submitted" | "accepted" | "rejected" | (string & {});
  generated_from?: string;
  affected_findings?: string[];
}

export interface InsightPackagePaths {
  root: string;
  manifest: string;
}

export function getInsightPackagePaths(root: string): InsightPackagePaths {
  const normalizedRoot = path.resolve(root);

  return {
    root: normalizedRoot,
    manifest: path.join(normalizedRoot, "manifest.json")
  };
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export async function readManifest(root: string): Promise<InsightManifest> {
  const paths = getInsightPackagePaths(root);
  return readJsonFile<InsightManifest>(paths.manifest);
}

export interface PackageFileEntry {
  relativePath: string;
  absolutePath: string;
}

export interface PackInsightOptions {
  sourceDir: string;
  outputFile: string;
}

export interface UnpackInsightOptions {
  archiveFile: string;
  outputDir: string;
}

export interface PackInsightResult {
  outputFile: string;
  fileCount: number;
  packStrategy: "streaming_zip";
}

export interface UnpackInsightResult {
  outputDir: string;
  fileCount: number;
}

const IGNORED_PACKAGE_DIRS = new Set(["node_modules", ".git", "dist"]);

export async function listPackageFiles(root: string): Promise<PackageFileEntry[]> {
  const resolvedRoot = path.resolve(root);
  const entries: PackageFileEntry[] = [];

  await collectFiles(resolvedRoot, resolvedRoot, entries);

  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function packInsightDirectory(options: PackInsightOptions): Promise<PackInsightResult> {
  const sourceDir = path.resolve(options.sourceDir);
  const outputFile = path.resolve(options.outputFile);

  if (!(await pathExists(path.join(sourceDir, "manifest.json")))) {
    throw new Error(`无法打包 ${sourceDir}：缺少 manifest.json。`);
  }

  const files = await listPackageFiles(sourceDir);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeStreamingZip(files, outputFile);

  return {
    outputFile,
    fileCount: files.length,
    packStrategy: "streaming_zip"
  };
}

async function writeStreamingZip(files: PackageFileEntry[], outputFile: string): Promise<void> {
  const tempOutput = path.join(
    path.dirname(outputFile),
    `.${path.basename(outputFile)}.${process.pid}.${Date.now()}.tmp`
  );
  const output = createWriteStream(tempOutput);
  let backpressured = false;
  let settled = false;
  let resolveArchive!: () => void;
  let rejectArchive!: (error: Error) => void;
  const archiveCompleted = new Promise<void>((resolve, reject) => {
    resolveArchive = resolve;
    rejectArchive = reject;
  });
  const archive = new Zip((error, data, final) => {
    if (settled) return;
    if (error) {
      settled = true;
      rejectArchive(error);
      output.destroy(error);
      return;
    }
    if (data.byteLength > 0 && !output.write(data)) {
      backpressured = true;
    }
    if (final) {
      settled = true;
      output.end();
      resolveArchive();
    }
  });

  try {
    for (const file of files) {
      if (backpressured) {
        await once(output, "drain");
        backpressured = false;
      }

      const archiveEntry = new ZipDeflate(toArchivePath(file.relativePath), { level: 6 });
      archive.add(archiveEntry);

      for await (const chunk of createReadStream(file.absolutePath)) {
        archiveEntry.push(chunk);
        if (backpressured) {
          await once(output, "drain");
          backpressured = false;
        }
      }

      archiveEntry.push(new Uint8Array(0), true);
    }

    archive.end();
    await archiveCompleted;
    await finished(output);
    await rm(outputFile, { force: true });
    await rename(tempOutput, outputFile);
  } catch (error) {
    archive.terminate();
    output.destroy();
    await rm(tempOutput, { force: true });
    throw error;
  }
}

export async function unpackInsightArchive(options: UnpackInsightOptions): Promise<UnpackInsightResult> {
  const archiveFile = path.resolve(options.archiveFile);
  const outputDir = path.resolve(options.outputDir);
  const archive = unzipSync(await readFile(archiveFile));
  let fileCount = 0;

  await mkdir(outputDir, { recursive: true });

  for (const [archivePath, data] of Object.entries(archive)) {
    const normalizedArchivePath = archivePath.replace(/\\/g, "/");

    if (isUnsafeArchivePath(normalizedArchivePath)) {
      throw new Error(`拒绝解包不安全的归档路径：${archivePath}`);
    }

    const outputPath = path.resolve(outputDir, normalizedArchivePath);

    if (!isPathInside(outputDir, outputPath)) {
      throw new Error(`拒绝将 ${archivePath} 解包到输出目录之外：${outputDir}`);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, data);
    fileCount += 1;
  }

  if (!(await pathExists(path.join(outputDir, "manifest.json")))) {
    throw new Error(`归档文件 ${archiveFile} 不包含根 manifest.json。`);
  }

  return {
    outputDir,
    fileCount
  };
}

async function collectFiles(root: string, currentDir: string, entries: PackageFileEntry[]): Promise<void> {
  const dirEntries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of dirEntries) {
    if (entry.name.startsWith(".") && entry.name !== ".well-known") {
      continue;
    }

    if (entry.isDirectory() && IGNORED_PACKAGE_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await collectFiles(root, absolutePath, entries);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    entries.push({
      absolutePath,
      relativePath: path.relative(root, absolutePath)
    });
  }
}

function toArchivePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isUnsafeArchivePath(archivePath: string): boolean {
  return (
    archivePath.length === 0 ||
    archivePath.startsWith("/") ||
    /^[a-zA-Z]:/.test(archivePath) ||
    archivePath.split("/").some((segment) => segment === "..")
  );
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

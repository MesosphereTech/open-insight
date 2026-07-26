import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, readManifest } from "@open-insight/core";

export const VERSION_STATUS_SCHEMA_VERSION = "open-insight.version-status.v0.1" as const;
export const VERSION_LOG_SCHEMA_VERSION = "open-insight.version-log.v0.1" as const;

export type VersionParentsFile = {
  parents?: Array<Record<string, unknown>>;
  merged_from?: Array<Record<string, unknown>>;
  merge_policy?: {
    mode?: string;
    parent_mutation?: boolean;
    strategy?: string;
  };
};

export type VersionRefsFile = {
  schema_version?: string;
  package_id?: string;
  base_package_id?: string;
  current?: string;
  refs?: Record<string, string>;
};

type VersionDiffSummaryFile = {
  merge_plan?: {
    mode?: string;
    parent_mutation?: boolean;
  };
  review_tasks?: Array<Record<string, unknown>>;
};

export type VersionLogEvent = Record<string, unknown> & {
  event_id?: string;
  event_type?: string;
  parent_mutation?: boolean;
};

export type VersionStatusResult = {
  schema_version: typeof VERSION_STATUS_SCHEMA_VERSION;
  status: "ok";
  package_id: string;
  title: string;
  versioning: {
    available: boolean;
    parent_count: number;
    merge_log_count: number;
    review_patch_count: number;
    review_task_count: number;
    commit_count: number;
    ref_count: number;
    rollback_count: number;
    base_package_mutation: boolean;
    merge_policy?: { mode?: string; parent_mutation?: boolean };
  };
  paths: {
    parents: string | null;
    merge_log: string | null;
    refs: string | null;
    commits: string | null;
    rollback_log: string | null;
    diff_summary: string | null;
    review_patches: string | null;
  };
  safety: {
    base_package_mutation: false;
    model_invoked: false;
    package_code_execution: false;
  };
};

export type VersionLogResult = {
  schema_version: typeof VERSION_LOG_SCHEMA_VERSION;
  status: "ok";
  package_id: string;
  title: string;
  events: VersionLogEvent[];
  safety: {
    base_package_mutation: false;
    model_invoked: false;
    package_code_execution: false;
  };
};

export async function readVersionStatus(packageRoot: string): Promise<VersionStatusResult> {
  const manifest = await readManifest(packageRoot);
  const parents = await readOptionalJson<VersionParentsFile>(packageRoot, "versioning/parents.json");
  const diffSummary = await readOptionalJson<VersionDiffSummaryFile>(packageRoot, "versioning/diff_summary.json");
  const mergeLog = await readOptionalJsonl<VersionLogEvent>(packageRoot, "versioning/merge_log.jsonl");
  const commits = await readOptionalJsonl<VersionLogEvent>(packageRoot, "versioning/commits.jsonl");
  const rollbackLog = await readOptionalJsonl<VersionLogEvent>(packageRoot, "versioning/rollback_log.jsonl");
  const refs = await readOptionalJson<VersionRefsFile>(packageRoot, "versioning/refs.json");
  const reviewPatches = await readOptionalJsonl<Record<string, unknown>>(packageRoot, "versioning/review_patches.jsonl");
  const mergePolicy =
    parents?.merge_policy || diffSummary?.merge_plan ? { ...(diffSummary?.merge_plan ?? {}), ...(parents?.merge_policy ?? {}) } : undefined;
  const basePackageMutation =
    mergePolicy?.parent_mutation === true ||
    mergeLog.some((event) => event.parent_mutation === true) ||
    commits.some((event) => event.base_package_mutation === true || event.parent_mutation === true) ||
    rollbackLog.some((event) => event.base_package_mutation === true || event.parent_mutation === true) ||
    reviewPatches.some((patch) => patch.base_package_mutation === true);

  return {
    schema_version: VERSION_STATUS_SCHEMA_VERSION,
    status: "ok",
    package_id: manifest.package_id,
    title: manifest.title,
    versioning: {
      available: Boolean(parents || diffSummary || mergeLog.length > 0 || reviewPatches.length > 0),
      parent_count: parents?.parents?.length ?? 0,
      merge_log_count: mergeLog.length,
      review_patch_count: reviewPatches.length,
      review_task_count: diffSummary?.review_tasks?.length ?? 0,
      commit_count: commits.length,
      ref_count: Object.keys(refs?.refs ?? {}).length,
      rollback_count: rollbackLog.length,
      base_package_mutation: basePackageMutation,
      ...(mergePolicy ? { merge_policy: mergePolicy } : {})
    },
    paths: {
      parents: (await packageFileExists(packageRoot, "versioning/parents.json")) ? "versioning/parents.json" : null,
      merge_log: (await packageFileExists(packageRoot, "versioning/merge_log.jsonl")) ? "versioning/merge_log.jsonl" : null,
      refs: (await packageFileExists(packageRoot, "versioning/refs.json")) ? "versioning/refs.json" : null,
      commits: (await packageFileExists(packageRoot, "versioning/commits.jsonl")) ? "versioning/commits.jsonl" : null,
      rollback_log: (await packageFileExists(packageRoot, "versioning/rollback_log.jsonl")) ? "versioning/rollback_log.jsonl" : null,
      diff_summary: (await packageFileExists(packageRoot, "versioning/diff_summary.json")) ? "versioning/diff_summary.json" : null,
      review_patches: (await packageFileExists(packageRoot, "versioning/review_patches.jsonl")) ? "versioning/review_patches.jsonl" : null
    },
    safety: {
      base_package_mutation: false,
      model_invoked: false,
      package_code_execution: false
    }
  };
}

export async function readVersionLog(packageRoot: string): Promise<VersionLogResult> {
  const manifest = await readManifest(packageRoot);
  const events = dedupeVersionEvents([
    ...(await readOptionalJsonl<VersionLogEvent>(packageRoot, "versioning/merge_log.jsonl")),
    ...(await readOptionalJsonl<VersionLogEvent>(packageRoot, "versioning/commits.jsonl")),
    ...(await readOptionalJsonl<VersionLogEvent>(packageRoot, "versioning/rollback_log.jsonl"))
  ]);

  return {
    schema_version: VERSION_LOG_SCHEMA_VERSION,
    status: "ok",
    package_id: manifest.package_id,
    title: manifest.title,
    events,
    safety: {
      base_package_mutation: false,
      model_invoked: false,
      package_code_execution: false
    }
  };
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

async function packageFileExists(root: string, relativePath: string): Promise<boolean> {
  try {
    const item = await stat(path.join(root, relativePath));
    return item.isFile();
  } catch {
    return false;
  }
}

function dedupeVersionEvents(events: VersionLogEvent[]): VersionLogEvent[] {
  const seen = new Set<string>();
  const deduped: VersionLogEvent[] = [];

  for (const event of events) {
    const eventId = typeof event.event_id === "string" ? event.event_id : undefined;
    if (eventId) {
      if (seen.has(eventId)) {
        continue;
      }
      seen.add(eventId);
    }
    deduped.push(event);
  }

  return deduped;
}

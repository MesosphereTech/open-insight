import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSIGHT_SPEC_VERSION, listPackageFiles, pathExists, readJsonlFile, readManifest } from "@open-insight/core";

export type ReviewPatchDecision = "approve" | "reject";

export interface ReviewPatchOptions {
  packageRoot: string;
  patchId: string;
  decision: ReviewPatchDecision;
  outputDir: string;
  createdAt?: string;
  reviewedBy?: string;
  reviewedPackageId?: string;
}

export interface ApplyReviewPatchOptions {
  packageRoot: string;
  patchId: string;
  outputDir: string;
  createdAt?: string;
  appliedBy?: string;
  appliedPackageId?: string;
}

export interface ReviewPatchResult {
  status: "reviewed";
  decision: ReviewPatchDecision;
  output_dir: string;
  source_package_id: string;
  reviewed_package_id: string;
  patch_id: string;
  review_state: "approved_pending_apply" | "rejected";
  target_claim_id: string;
  target_claim_status: string;
  claim_status_changed: false;
  file_count: number;
}

export interface ApplyReviewPatchResult {
  status: "applied";
  output_dir: string;
  source_package_id: string;
  applied_package_id: string;
  patch_id: string;
  review_state: "applied";
  target_claim_id: string;
  previous_status: string;
  next_status: string;
  claim_status_changed: true;
  file_count: number;
}

interface ReviewPatchRecord {
  patch_id?: string;
  patch_type?: string;
  review_state?: string;
  target_claim_id?: string;
  previous_status?: string;
  next_status?: string;
  status_change?: string;
  base_package_mutation?: boolean;
  supporting_response_claim_ids?: string[];
  supporting_response_evidence_ids?: string[];
  reviewer_note?: string;
  [key: string]: unknown;
}

interface ClaimRecord {
  claim_id: string;
  status?: string;
  evidence_ids?: string[];
  supporting_response_claim_ids?: string[];
  supporting_response_evidence_ids?: string[];
  review_note?: string;
  [key: string]: unknown;
}

export async function reviewPatch(options: ReviewPatchOptions): Promise<ReviewPatchResult> {
  const packageRoot = path.resolve(options.packageRoot);
  const outputDir = path.resolve(options.outputDir);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const reviewedBy = options.reviewedBy ?? "insight review-patch";

  if (options.decision !== "approve" && options.decision !== "reject") {
    throw new Error(`审阅决策必须是 approve 或 reject，当前为 ${options.decision}`);
  }

  if (await pathExists(outputDir)) {
    throw new Error(`输出目录已存在：${outputDir}`);
  }

  const manifest = await readManifest(packageRoot);
  const patches = await readReviewPatches(packageRoot);
  const patch = findReviewPatch(patches, options.patchId);
  const targetClaim = await readTargetClaim(packageRoot, patch);
  const previousStatus = requireString(patch.previous_status, "previous_status");

  if (patch.review_state !== "proposed") {
    throw new Error(`审阅补丁 ${options.patchId} 当前状态为 ${patch.review_state ?? "unknown"}，只能审阅 proposed 补丁`);
  }

  if ((targetClaim.status ?? "unknown") !== previousStatus) {
    throw new Error(
      `审阅补丁 ${options.patchId} 期望结论状态为 ${previousStatus}，当前为 ${targetClaim.status ?? "unknown"}，请重新生成补丁`
    );
  }

  await cp(packageRoot, outputDir, { recursive: true });

  const nextReviewState = options.decision === "approve" ? "approved_pending_apply" : "rejected";
  const nextStatusChange = options.decision === "approve" ? "review_approved_status_update" : "review_rejected_keep_status";
  const reviewedPackageId =
    options.reviewedPackageId ?? `${manifest.package_id}.review.${sanitizeId(options.patchId)}.${options.decision}`;
  const updatedPatch = {
    ...patch,
    review_state: nextReviewState,
    status_change: nextStatusChange,
    review_decision: options.decision,
    reviewed_at: createdAt,
    reviewed_by: reviewedBy
  };

  await writeJsonl(
    path.join(outputDir, "versioning/review_patches.jsonl"),
    patches.map((record) => (record.patch_id === options.patchId ? updatedPatch : record))
  );
  await writeJson(path.join(outputDir, "manifest.json"), {
    ...manifest,
    spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
    package_id: reviewedPackageId,
    title: `${manifest.title} - 审阅 ${options.patchId}`,
    description:
      options.decision === "approve"
        ? `审阅补丁 ${options.patchId} 已被批准，尚未应用到结论状态；该输出是新包，不会回写来源包。`
        : `审阅补丁 ${options.patchId} 已被拒绝，结论状态保持不变；该输出是新包，不会回写来源包。`,
    created_at: createdAt
  });

  return {
    status: "reviewed",
    decision: options.decision,
    output_dir: outputDir,
    source_package_id: manifest.package_id,
    reviewed_package_id: reviewedPackageId,
    patch_id: options.patchId,
    review_state: nextReviewState,
    target_claim_id: requireString(patch.target_claim_id, "target_claim_id"),
    target_claim_status: targetClaim.status ?? "unknown",
    claim_status_changed: false,
    file_count: (await listPackageFiles(outputDir)).length
  };
}

export async function applyReviewPatch(options: ApplyReviewPatchOptions): Promise<ApplyReviewPatchResult> {
  const packageRoot = path.resolve(options.packageRoot);
  const outputDir = path.resolve(options.outputDir);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const appliedBy = options.appliedBy ?? "insight apply-review-patch";

  if (await pathExists(outputDir)) {
    throw new Error(`输出目录已存在：${outputDir}`);
  }

  const manifest = await readManifest(packageRoot);
  const patches = await readReviewPatches(packageRoot);
  const patch = findReviewPatch(patches, options.patchId);
  const claims = await readJsonlFile<ClaimRecord>(path.join(packageRoot, "findings/claims.jsonl"));
  const targetClaimId = requireString(patch.target_claim_id, "target_claim_id");
  const previousStatus = requireString(patch.previous_status, "previous_status");
  const nextStatus = requireString(patch.next_status, "next_status");
  const targetClaim = claims.find((claim) => claim.claim_id === targetClaimId);

  assertPatchIsSafeClaimStatusReview(patch, options.patchId);

  if (patch.review_state !== "approved_pending_apply") {
    throw new Error(`审阅补丁 ${options.patchId} 当前状态为 ${patch.review_state ?? "unknown"}，必须先被批准才能应用`);
  }

  if (!targetClaim) {
    throw new Error(`审阅补丁 ${options.patchId} 指向不存在的结论 ${targetClaimId}`);
  }

  if ((targetClaim.status ?? "unknown") !== previousStatus) {
    throw new Error(
      `审阅补丁 ${options.patchId} 期望结论状态为 ${previousStatus}，当前为 ${targetClaim.status ?? "unknown"}，请重新生成补丁`
    );
  }

  await cp(packageRoot, outputDir, { recursive: true });

  const appliedPackageId = options.appliedPackageId ?? `${manifest.package_id}.applied.${sanitizeId(options.patchId)}`;
  const updatedPatch = {
    ...patch,
    review_state: "applied",
    status_change: "review_applied_status_update",
    applied_at: createdAt,
    applied_by: appliedBy
  };
  const updatedClaims = claims.map((claim) =>
    claim.claim_id === targetClaimId
      ? applyReviewPatchToClaim(claim, patch, {
          patchId: options.patchId,
          nextStatus,
          createdAt,
          appliedBy
        })
      : claim
  );

  await writeJsonl(path.join(outputDir, "findings/claims.jsonl"), updatedClaims);
  await writeJsonl(
    path.join(outputDir, "versioning/review_patches.jsonl"),
    patches.map((record) => (record.patch_id === options.patchId ? updatedPatch : record))
  );
  await writeJson(path.join(outputDir, "manifest.json"), {
    ...manifest,
    spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
    package_id: appliedPackageId,
    title: `${manifest.title} - 应用 ${options.patchId}`,
    description: `审阅补丁 ${options.patchId} 已应用到结论状态；该输出是新包，不会回写来源包。`,
    created_at: createdAt
  });

  return {
    status: "applied",
    output_dir: outputDir,
    source_package_id: manifest.package_id,
    applied_package_id: appliedPackageId,
    patch_id: options.patchId,
    review_state: "applied",
    target_claim_id: targetClaimId,
    previous_status: previousStatus,
    next_status: nextStatus,
    claim_status_changed: true,
    file_count: (await listPackageFiles(outputDir)).length
  };
}

function applyReviewPatchToClaim(
  claim: ClaimRecord,
  patch: ReviewPatchRecord,
  options: { patchId: string; nextStatus: string; createdAt: string; appliedBy: string }
): ClaimRecord {
  const supportingClaimIds = uniqueStrings([...(claim.supporting_response_claim_ids ?? []), ...(patch.supporting_response_claim_ids ?? [])]);
  const supportingEvidenceIds = uniqueStrings([...(claim.supporting_response_evidence_ids ?? []), ...(patch.supporting_response_evidence_ids ?? [])]);

  return {
    ...claim,
    status: options.nextStatus,
    evidence_ids: uniqueStrings([...(claim.evidence_ids ?? []), ...supportingEvidenceIds]),
    supporting_response_claim_ids: supportingClaimIds,
    supporting_response_evidence_ids: supportingEvidenceIds,
    review_status: "needs_review",
    review_state: "review_patch_applied",
    review_note: createAppliedReviewNote(claim.review_note, patch, options.patchId),
    review_patch_id: options.patchId,
    review_status_changed_at: options.createdAt,
    review_status_changed_by: options.appliedBy
  };
}

function createAppliedReviewNote(existingNote: string | undefined, patch: ReviewPatchRecord, patchId: string): string {
  const patchNote = typeof patch.reviewer_note === "string" && patch.reviewer_note.trim().length > 0 ? patch.reviewer_note.trim() : undefined;
  const note = `已应用审阅补丁 ${patchId}，response 支撑材料已绑定到该结论；当前状态仍需人工复核，不代表已验证。`;

  return [existingNote, patchNote, note].filter((item): item is string => typeof item === "string" && item.length > 0).join(" ");
}

async function readReviewPatches(packageRoot: string): Promise<ReviewPatchRecord[]> {
  const patchPath = path.join(packageRoot, "versioning/review_patches.jsonl");

  if (!(await pathExists(patchPath))) {
    throw new Error("缺少 versioning/review_patches.jsonl，无法审阅补丁");
  }

  return readJsonlFile<ReviewPatchRecord>(patchPath);
}

async function readTargetClaim(packageRoot: string, patch: ReviewPatchRecord): Promise<ClaimRecord> {
  const targetClaimId = requireString(patch.target_claim_id, "target_claim_id");
  const claims = await readJsonlFile<ClaimRecord>(path.join(packageRoot, "findings/claims.jsonl"));
  const targetClaim = claims.find((claim) => claim.claim_id === targetClaimId);

  assertPatchIsSafeClaimStatusReview(patch, patch.patch_id ?? targetClaimId);

  if (!targetClaim) {
    throw new Error(`审阅补丁 ${patch.patch_id ?? "unknown"} 指向不存在的结论 ${targetClaimId}`);
  }

  return targetClaim;
}

function findReviewPatch(patches: ReviewPatchRecord[], patchId: string): ReviewPatchRecord {
  const patch = patches.find((record) => record.patch_id === patchId);

  if (!patch) {
    throw new Error(`找不到审阅补丁：${patchId}`);
  }

  return patch;
}

function assertPatchIsSafeClaimStatusReview(patch: ReviewPatchRecord, patchId: string): void {
  if (patch.patch_type !== "claim_status_review") {
    throw new Error(`审阅补丁 ${patchId} 的 patch_type 不是 claim_status_review`);
  }

  if (patch.base_package_mutation !== false) {
    throw new Error(`审阅补丁 ${patchId} 声明会修改 base package，拒绝执行`);
  }

  requireString(patch.target_claim_id, "target_claim_id");
  requireString(patch.previous_status, "previous_status");
  requireString(patch.next_status, "next_status");
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`审阅补丁缺少 ${fieldName}`);
  }

  return value;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath: string, values: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, values.length === 0 ? "" : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

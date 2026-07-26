#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const planOnly = process.argv.includes("--plan-only");
const formatIndex = process.argv.indexOf("--format");
const jsonOutput = formatIndex >= 0 && process.argv[formatIndex + 1] === "json";
const candidateTag = "v0.1.0-alpha.1";
const gitCommand = process.platform === "win32" ? "git.exe" : "git";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = [
  process.env.npm_execpath,
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
].find((candidate) => candidate && existsSync(candidate));
const maxBuffer = 512 * 1024 * 1024;

const requiredCommunityFiles = [
  "LICENSE",
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/PULL_REQUEST_TEMPLATE.md"
];

const privateLocatorPattern = new RegExp(
  [
    ["Baidu", "Syncdisk"].join(""),
    ["浙商证券", "工作文件夹"].join(""),
    ["中邮", "工作文件夹"].join(""),
    ["厦门国贸", "应收ABS"].join("")
  ].join("|"),
  "giu"
);
const localUserPathPattern = new RegExp(
  [
    ["C:\\\\Users\\\\", "Colin"].join(""),
    ["D:\\\\", "Baidu", "Syncdisk"].join("")
  ].join("|"),
  "giu"
);
const highConfidenceSecretPatterns = [
  { id: "openai_style_secret_32plus", pattern: /sk-[A-Za-z0-9_-]{32,}/gu },
  { id: "bearer_value_32plus", pattern: /Bearer\s+[A-Za-z0-9._~+/-]{32,}/giu }
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    shell: false,
    input: options.input,
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer
  });
  return {
    ok: !result.error && result.status === 0,
    exit_code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message
  };
}

function runNpm(args, options = {}) {
  if (npmCliPath) return run(process.execPath, [npmCliPath, ...args], options);
  return run(npmCommand, args, options);
}

function parseJson(value, label) {
  const trimmed = String(value ?? "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {}
  }

  throw new Error(`${label} 没有返回有效 JSON。`);
}

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].length;
}

function safeBranchName(value) {
  return String(value ?? "").trim() || "detached";
}

async function writeReport(report) {
  const outputDir = path.join(repoRoot, "output");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "core-oss-public-release-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  const markdown = [
    "# Open Insight Core OSS 公开发布审计",
    "",
    `- status: \`${report.status}\``,
    `- candidate_commit: \`${report.candidate_commit ?? "not_checked"}\``,
    `- candidate_tree: \`${report.candidate_tree ?? "not_checked"}\``,
    `- candidate_tag: \`${report.candidate_tag}\``,
    `- candidate_tag_status: \`${report.candidate_tag_status}\``,
    `- repository_strategy: \`${report.repository_strategy}\``,
    `- current_snapshot_ready: \`${report.current_snapshot_ready}\``,
    `- direct_visibility_change_ready: \`${report.direct_visibility_change_ready}\``,
    "",
    "## 自动检查",
    "",
    ...(report.checks ?? []).map(
      (check) => `- ${check.id}: \`${check.status}\`${check.summary_cn ? ` - ${check.summary_cn}` : ""}`
    ),
    "",
    "## 阻断项",
    "",
    ...((report.blockers?.length ?? 0) > 0
      ? report.blockers.map((item) => `- ${item}`)
      : ["- 无"]),
    "",
    "## 发布结论",
    "",
    "- 当前开发仓库继续保持 private。",
    "- 固定候选可以在私有仓库中建立并验证。",
    "- 对外发布应从候选代码树导出清洁历史快照，不直接公开当前完整开发历史。",
    "- 清洁公开仓库仍需匿名 Skill 安装、固定 tag、GitHub Release 和公开 README 验收。"
  ].join("\n");
  await writeFile(
    path.join(outputDir, "core-oss-public-release-audit.md"),
    `${markdown}\n`,
    "utf8"
  );
}

async function main() {
  if (planOnly) {
    const report = {
      schema_version: "open-insight.public-release-audit.v0.1",
      status: "planned",
      candidate_tag: candidateTag,
      repository_strategy: "keep_private_export_clean_public_snapshot",
      planned_checks: [
        "working_tree",
        "current_snapshot_secret_scan",
        "full_history_sensitive_markers",
        "full_history_large_blobs",
        "dependency_audit",
        "community_files",
        "candidate_tag",
        "origin_main_ancestry"
      ],
      safety: {
        model_invoked: false,
        private_materials_read: false,
        secret_values_reported: false,
        repository_visibility_changed: false,
        base_package_mutation: false
      }
    };
    console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight 公开发布审计: ${report.status}`);
    return;
  }

  const checks = [];
  const blockers = [];
  const commit = run(gitCommand, ["rev-parse", "HEAD"]);
  const tree = run(gitCommand, ["rev-parse", "HEAD^{tree}"]);
  const branch = run(gitCommand, ["branch", "--show-current"]);
  const status = run(gitCommand, ["status", "--porcelain", "--untracked-files=normal"]);
  const workingTreeClean = commit.ok && status.ok && status.stdout.trim().length === 0;
  checks.push({
    id: "working_tree",
    status: workingTreeClean ? "passed" : "blocked",
    summary_cn: workingTreeClean ? "候选基于干净 commit。" : "存在未提交或未跟踪变更。"
  });
  if (!workingTreeClean) blockers.push("候选必须基于干净 commit，不能把工作区状态当作发布快照。");

  const secretScan = run(process.execPath, [path.join(scriptDir, "scan-secrets.mjs")]);
  checks.push({
    id: "current_snapshot_secret_scan",
    status: secretScan.ok ? "passed" : "blocked",
    summary_cn: secretScan.ok ? "当前快照未发现已知密钥模式。" : "当前快照密钥扫描失败。"
  });
  if (!secretScan.ok) blockers.push("当前代码树未通过密钥扫描。");

  const history = run(
    gitCommand,
    ["log", "--all", "-p", "--text", "--no-color", "--format=fuller"],
    { timeoutMs: 600_000 }
  );
  if (!history.ok) throw new Error(`无法读取完整 Git 历史：${history.stderr || history.error || "未知错误"}`);
  const historySecretCounts = Object.fromEntries(
    highConfidenceSecretPatterns.map(({ id, pattern }) => [id, countMatches(history.stdout, pattern)])
  );
  const privateLocatorCount = countMatches(history.stdout, privateLocatorPattern);
  const localUserPathCount = countMatches(history.stdout, localUserPathPattern);
  const historySecretCount = Object.values(historySecretCounts).reduce((sum, value) => sum + value, 0);
  const historySensitive = historySecretCount + privateLocatorCount + localUserPathCount;
  checks.push({
    id: "full_history_sensitive_markers",
    status: historySensitive === 0 ? "passed" : "blocked_for_direct_public",
    summary_cn:
      historySensitive === 0
        ? "完整历史未命中高置信密钥或私有测试定位信息。"
        : `历史命中高置信密钥 ${historySecretCount} 处、私有测试定位 ${privateLocatorCount} 处、本机用户路径 ${localUserPathCount} 处；未输出具体值。`,
    metrics: {
      high_confidence_secret_count: historySecretCount,
      private_material_locator_count: privateLocatorCount,
      local_user_path_count: localUserPathCount
    }
  });
  if (historySecretCount > 0) {
    blockers.push("完整 Git 历史命中高置信密钥样式；必须轮换凭据并清洁历史后才能公开。");
  }
  if (privateLocatorCount + localUserPathCount > 0) {
    blockers.push("完整 Git 历史包含私有测试定位或本机路径；当前仓库不能直接切换为 public。");
  }

  const objectList = run(gitCommand, ["rev-list", "--objects", "--all"]);
  const objectSizes = objectList.ok
    ? run(
        gitCommand,
        ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize) %(rest)"],
        { input: objectList.stdout }
      )
    : objectList;
  const largeBlobs = objectSizes.ok
    ? objectSizes.stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [object, type, rawSize, ...rest] = line.split(" ");
          return {
            object: object?.slice(0, 12),
            type,
            size_bytes: Number(rawSize),
            path: rest.join(" ")
          };
        })
        .filter((item) => item.type === "blob" && item.size_bytes >= 10 * 1024 * 1024)
        .sort((left, right) => right.size_bytes - left.size_bytes)
    : [];
  checks.push({
    id: "full_history_large_blobs",
    status: largeBlobs.length === 0 ? "passed" : "blocked_for_direct_public",
    summary_cn:
      largeBlobs.length === 0
        ? "完整历史没有超过 10 MiB 的 blob。"
        : `完整历史包含 ${largeBlobs.length} 个不小于 10 MiB 的 blob。`,
    metrics: {
      large_blob_count: largeBlobs.length,
      largest_blob_bytes: largeBlobs[0]?.size_bytes ?? 0
    }
  });
  if (largeBlobs.length > 0) {
    blockers.push("完整 Git 历史包含大型已删除 blob；直接公开会增加 clone 体积并暴露历史宣传产物。");
  }

  const audit = runNpm(["audit", "--audit-level=high", "--json"], { timeoutMs: 180_000 });
  let auditReport;
  try {
    auditReport = parseJson(audit.stdout, "npm audit");
  } catch {
    auditReport = undefined;
  }
  const dependencyAuditAvailable = Boolean(auditReport);
  const highVulnerabilities = dependencyAuditAvailable
    ? Number(auditReport.metadata?.vulnerabilities?.high ?? 0)
    : null;
  const criticalVulnerabilities = dependencyAuditAvailable
    ? Number(auditReport.metadata?.vulnerabilities?.critical ?? 0)
    : null;
  const dependencyAuditPassed =
    dependencyAuditAvailable &&
    highVulnerabilities + criticalVulnerabilities === 0;
  checks.push({
    id: "dependency_audit",
    status: dependencyAuditPassed
      ? "passed"
      : dependencyAuditAvailable
        ? "blocked"
        : "audit_unavailable",
    summary_cn: !dependencyAuditAvailable
      ? `npm audit 未返回可验证报告，exit_code=${audit.exit_code}。`
      : dependencyAuditPassed
        ? "npm audit 未发现 high / critical 漏洞。"
        : `npm audit 报告 high=${highVulnerabilities}, critical=${criticalVulnerabilities}。`,
    metrics: {
      high: highVulnerabilities,
      critical: criticalVulnerabilities
    }
  });
  if (!dependencyAuditAvailable) {
    blockers.push("依赖审计不可用；必须重新获得有效 npm audit 报告。");
  } else if (!dependencyAuditPassed) {
    blockers.push("依赖树存在 high / critical 漏洞。");
  }

  const missingCommunityFiles = requiredCommunityFiles.filter((entry) => {
    const result = run(gitCommand, ["ls-files", "--error-unmatch", entry]);
    return !result.ok;
  });
  checks.push({
    id: "community_files",
    status: missingCommunityFiles.length === 0 ? "passed" : "blocked",
    summary_cn:
      missingCommunityFiles.length === 0
        ? "LICENSE、README、贡献、安全和 Issue/PR 模板齐全。"
        : `缺少 ${missingCommunityFiles.join(", ")}。`
  });
  if (missingCommunityFiles.length > 0) blockers.push("开源社区治理文件不完整。");

  const tag = run(gitCommand, [
    "rev-parse",
    "--verify",
    `refs/tags/${candidateTag}^{commit}`
  ]);
  const tagStatus = tag.ok
    ? tag.stdout.trim() === commit.stdout.trim()
      ? "verified_current_commit"
      : "points_to_other_commit"
    : "missing";
  checks.push({
    id: "candidate_tag",
    status: tagStatus === "verified_current_commit" ? "passed" : "pending",
    summary_cn:
      tagStatus === "verified_current_commit"
        ? `${candidateTag} 已固定当前 commit。`
        : tagStatus === "missing"
          ? `${candidateTag} 尚未建立。`
          : `${candidateTag} 没有指向当前候选 commit。`
  });

  const ancestry = run(gitCommand, ["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
  checks.push({
    id: "origin_main_ancestry",
    status: ancestry.ok ? "passed" : "blocked",
    summary_cn: ancestry.ok ? "当前候选包含 origin/main。" : "当前候选不是 origin/main 的前向增量。"
  });
  if (!ancestry.ok) blockers.push("候选分支没有包含当前 origin/main。");

  const currentSnapshotReady =
    workingTreeClean &&
    secretScan.ok &&
    dependencyAuditPassed &&
    missingCommunityFiles.length === 0 &&
    ancestry.ok;
  const directVisibilityChangeReady =
    currentSnapshotReady &&
    historySecretCount === 0 &&
    privateLocatorCount + localUserPathCount === 0 &&
    largeBlobs.length === 0;
  const report = {
    schema_version: "open-insight.public-release-audit.v0.1",
    status:
      currentSnapshotReady && directVisibilityChangeReady && tagStatus === "verified_current_commit"
        ? "ready"
        : "blocked",
    candidate_commit: commit.stdout.trim(),
    candidate_tree: tree.stdout.trim(),
    candidate_branch: safeBranchName(branch.stdout),
    candidate_tag: candidateTag,
    candidate_tag_status: tagStatus,
    repository_strategy: directVisibilityChangeReady
      ? "direct_visibility_change_allowed_after_manual_review"
      : "keep_private_export_clean_public_snapshot",
    current_snapshot_ready: currentSnapshotReady,
    direct_visibility_change_ready: directVisibilityChangeReady,
    checks,
    blockers,
    manual_reviews: [
      "确认开源主体、MIT 许可证与雇佣/客户知识产权边界。",
      "确认第三方依赖和文档引用符合各自许可证及 attribution 要求。",
      "轮换曾在聊天、终端或其他非仓库渠道暴露过的模型/API 凭据。",
      "人工检查 GitHub PR、Issue、Actions 日志和 artifacts 是否含私有信息。",
      "在清洁公开仓库中完成匿名 Skill 安装和固定 tag 验收。"
    ],
    safety: {
      model_invoked: false,
      private_materials_read: false,
      secret_values_reported: false,
      repository_visibility_changed: false,
      base_package_mutation: false
    }
  };

  await writeReport(report);
  console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight 公开发布审计: ${report.status}`);
  if (!currentSnapshotReady) process.exitCode = 1;
}

await main();

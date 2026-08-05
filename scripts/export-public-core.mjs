#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const exportMarker = ".open-insight-public-export";

const exactPaths = new Set([
  ".gitignore",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "SECURITY.md",
  "tsconfig.base.json",
  "vitest.public-core.config.ts",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "docs/core-oss-alpha-readiness.md",
  "docs/core-oss-context-access.md",
  "docs/core-oss-context-kernel.md",
  "docs/core-oss-prd.md",
  "docs/public-alpha-demo.md",
  "docs/public-alpha-release-notes.md",
  "docs/public-alpha-release-notes.zh-CN.md",
  "docs/public-core-repository-manifest.md",
  "docs/public/AGENTS.md",
  "docs/public/README.md",
  "docs/public/README.zh-CN.md",
  "docs/public/assets/open-insight-alpha-contact-sheet.jpg",
  "docs/public/assets/open-insight-social-preview.png",
  "docs/public/assets/open-insight-alpha-validation.gif",
  "scripts/audit-core-oss-public-release.mjs",
  "scripts/check-alpha-release-tag.mjs",
  "scripts/compile-context-folder.mjs",
  "scripts/demo-public-alpha.mjs",
  "scripts/export-public-core.mjs",
  "scripts/public-alpha-fixtures.mjs",
  "scripts/run-alpha-parser-acceptance.mjs",
  "scripts/run-alpha-skill-acceptance.mjs",
  "scripts/scan-secrets.mjs",
  "scripts/skill-bootstrap.mjs",
  "scripts/verify-public-core.mjs",
  "tests/core-oss-context-skill-docs.test.ts",
  "tests/core-oss-skill-folder-compile.test.ts",
  "tests/core-oss-skill-standalone-install.test.ts",
  "tests/open-insight-installer.test.ts",
  "tests/public-cli-contracts.test.ts",
  "tests/public-core-readme-docs.test.ts",
  "apps/cli/src/localEnv.test.ts",
  "packages/insight-compiler/src/draft.test.ts",
  "packages/insight-compiler/src/index.test.ts",
  "packages/insight-compiler/src/sourceAnalysis.test.ts",
  "packages/insight-domain-packs/src/index.test.ts"
]);

const historicalProductDocs = new Set([
  "docs/architecture.md",
  "docs/cli-machine-contracts.md",
  "docs/conformance.md",
  "docs/spec-v0.1.md",
  "docs/third-party-implementation-guide.md",
  "docs/third-party-sdk-guide.md",
  "docs/version-migration-strategy.md"
]);

const allowedPrefixes = [
  "apps/cli/",
  "distribution/open-insight/",
  "packages/insight-compiler/",
  "packages/insight-core/",
  "packages/insight-domain-packs/",
  "packages/insight-runtime/",
  "packages/insight-validator/",
  "skills/open-insight-context/",
  "spec/"
];

const deniedPrefixes = [
  "apps/reader/",
  "apps/studio/",
  "apps/manual/",
  "apps/mcp/",
  "packages/insight-ui/",
  "output/",
  "tmp/",
  "unpacked/"
];

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/gu,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}/giu
];

function parseArgs(argv) {
  const options = {
    output: path.join(repoRoot, "output", "public-core-export"),
    force: false,
    dryRun: false,
    skipLockfile: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") options.output = path.resolve(argv[++index] ?? "");
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-lockfile") options.skipLockfile = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.output) throw new Error("--output requires a path.");
  return options;
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, options);
}

function isAllowed(filePath) {
  if (historicalProductDocs.has(filePath)) return false;
  if (filePath.endsWith(".test.ts")) return exactPaths.has(filePath);
  return exactPaths.has(filePath) || allowedPrefixes.some((prefix) => filePath.startsWith(prefix));
}

function exportedPath(sourcePath) {
  if (sourcePath === "docs/public/AGENTS.md") return "AGENTS.md";
  if (sourcePath === "docs/public/README.md") return "README.md";
  if (sourcePath === "docs/public/README.zh-CN.md") return "README.zh-CN.md";
  return sourcePath;
}

function classifyExcluded(filePath) {
  if (deniedPrefixes.some((prefix) => filePath.startsWith(prefix))) return "commercial_or_generated";
  if (filePath.startsWith("tests/") || filePath.startsWith("examples/")) return "private_or_legacy_evidence";
  if (filePath.startsWith("scripts/")) return "private_tooling";
  if (filePath.startsWith("docs/")) return "historical_or_private_docs";
  if (filePath.startsWith(".github/workflows/")) return "private_ci";
  return "outside_public_dependency_closure";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function prepareOutput(outputDir, force) {
  const resolved = path.resolve(outputDir);
  if (resolved === repoRoot || resolved === path.parse(resolved).root) {
    throw new Error("Refusing to export over the repository or filesystem root.");
  }
  if (!(await exists(resolved))) return;
  const entries = await readdir(resolved);
  if (entries.length === 0) return;
  const markerPath = path.join(resolved, exportMarker);
  const manifestPath = path.join(resolved, "public-export-manifest.json");
  if (!force || (!(await exists(markerPath)) && !(await exists(manifestPath)))) {
    throw new Error("Output directory is not an existing Open Insight export. Use an empty directory.");
  }
  await rm(resolved, { recursive: true, force: true });
}

function publicPackageJson(sourcePackage) {
  return {
    name: "open-insight",
    version: sourcePackage.version,
    private: true,
    type: "module",
    engines: sourcePackage.engines,
    workspaces: [
      "packages/insight-core",
      "packages/insight-compiler",
      "packages/insight-validator",
      "packages/insight-runtime",
      "packages/insight-domain-packs",
      "apps/cli"
    ],
    scripts: {
      "build:core": "npm run build:core-public",
      "build:core-public":
        "tsc -b packages/insight-core packages/insight-validator packages/insight-runtime packages/insight-domain-packs packages/insight-compiler apps/cli",
      "test:core-public": "vitest run --config vitest.public-core.config.ts --no-file-parallelism",
      "test:skill-public":
        "vitest run --config vitest.public-core.config.ts tests/open-insight-installer.test.ts tests/core-oss-context-skill-docs.test.ts tests/core-oss-skill-folder-compile.test.ts tests/core-oss-skill-standalone-install.test.ts --no-file-parallelism",
      "verify:core-public": "node scripts/verify-public-core.mjs",
      "demo:public-alpha": "node scripts/demo-public-alpha.mjs",
      "alpha:skill-acceptance": "node scripts/run-alpha-skill-acceptance.mjs",
      "alpha:parser-acceptance": "node scripts/run-alpha-parser-acceptance.mjs",
      "alpha:public-audit": "node scripts/audit-core-oss-public-release.mjs",
      "alpha:release-ref": "node scripts/check-alpha-release-tag.mjs",
      "skill:bootstrap": "node scripts/skill-bootstrap.mjs",
      "skill:compile-folder": "node scripts/compile-context-folder.mjs",
      "cli-contracts:check":
        "vitest run tests/public-cli-contracts.test.ts --no-file-parallelism",
      "scan:secrets": "node scripts/scan-secrets.mjs",
      cli: "npm run dev -w @open-insight/cli --"
    },
    devDependencies: {
      "@types/node": sourcePackage.devDependencies["@types/node"],
      "@types/sql.js": sourcePackage.devDependencies["@types/sql.js"],
      ajv: sourcePackage.devDependencies.ajv,
      fflate: sourcePackage.devDependencies.fflate,
      tsx: sourcePackage.devDependencies.tsx,
      typescript: sourcePackage.devDependencies.typescript,
      vitest: sourcePackage.devDependencies.vitest
    },
    overrides: sourcePackage.overrides
  };
}

async function sha256(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function assertNoSecrets(filePaths, outputDir) {
  const findings = [];
  for (const filePath of filePaths) {
    const absolute = path.join(outputDir, filePath);
    const stats = await stat(absolute);
    if (stats.size > 2_000_000) continue;
    const content = await readFile(absolute);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    for (const pattern of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) findings.push(filePath);
    }
  }
  if (findings.length > 0) throw new Error(`Potential secret in public export: ${findings.join(", ")}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  const selectedSources = tracked.filter(isAllowed);
  const missingRequired = [...exactPaths].filter((filePath) => !tracked.includes(filePath));
  if (missingRequired.length > 0) {
    throw new Error(`Required public paths are missing: ${missingRequired.join(", ")}`);
  }
  for (const sourcePath of selectedSources) {
    if (deniedPrefixes.some((prefix) => sourcePath.startsWith(prefix))) {
      throw new Error(`Denied path entered the public allowlist: ${sourcePath}`);
    }
  }

  const exclusions = {};
  for (const filePath of tracked.filter((item) => !selectedSources.includes(item))) {
    const category = classifyExcluded(filePath);
    exclusions[category] = (exclusions[category] ?? 0) + 1;
  }

  const sourceCommit = git(["rev-parse", "HEAD"]);
  const sourceTree = git(["rev-parse", "HEAD^{tree}"]);
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          schema_version: "open-insight.public-core-export-plan.v0.1",
          status: "planned",
          private_candidate_commit: sourceCommit,
          private_candidate_tree_sha: sourceTree,
          selected_file_count: selectedSources.length + 1,
          excluded_path_categories: exclusions,
          output: "<configured-output>"
        },
        null,
        2
      )
    );
    return;
  }

  await prepareOutput(options.output, options.force);
  await mkdir(options.output, { recursive: true });
  await writeFile(path.join(options.output, exportMarker), "Open Insight public Core export\n", "utf8");

  const copiedPaths = [];
  for (const sourcePath of selectedSources) {
    const destinationPath = exportedPath(sourcePath);
    const destination = path.join(options.output, destinationPath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repoRoot, sourcePath), destination);
    copiedPaths.push(destinationPath);
  }

  const sourcePackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  await writeFile(
    path.join(options.output, "package.json"),
    `${JSON.stringify(publicPackageJson(sourcePackage), null, 2)}\n`,
    "utf8"
  );
  copiedPaths.push("package.json");

  if (!options.skipLockfile) {
    const lockResult = runNpm(["install", "--package-lock-only", "--ignore-scripts"], {
      cwd: options.output,
      encoding: "utf8",
      timeout: 600_000,
      shell: false
    });
    if (lockResult.error || lockResult.status !== 0) {
      throw new Error(`Failed to regenerate public lockfile: ${lockResult.stderr || lockResult.error?.message}`);
    }
    copiedPaths.push("package-lock.json");
  }

  const uniquePaths = [...new Set(copiedPaths)].sort();
  await assertNoSecrets(uniquePaths, options.output);
  const files = [];
  for (const filePath of uniquePaths) {
    files.push({ path: filePath, sha256: await sha256(path.join(options.output, filePath)) });
  }
  const manifestDigest = createHash("sha256")
    .update(files.map((item) => `${item.path}\0${item.sha256}\n`).join(""))
    .digest("hex");
  const report = {
    schema_version: "open-insight.public-core-export.v0.1",
    status: "exported_private_review",
    export_tool_version: "0.1.0",
    private_candidate_commit: sourceCommit,
    private_candidate_tree_sha: sourceTree,
    exported_file_count: files.length,
    files,
    aggregate_manifest_digest: manifestDigest,
    excluded_path_categories: exclusions,
    public_commit: null,
    public_tree_sha: null,
    checks: {
      allowlist_only: true,
      denylist_clear: true,
      secret_scan: "passed",
      license_scan: (await exists(path.join(options.output, "LICENSE"))) ? "present_pending_attribution_review" : "failed",
      anonymous_skill_acceptance: "blocked_repository_private"
    },
    safety: {
      private_materials_exported: false,
      model_invoked: false,
      output_path_recorded: false
    }
  };
  await writeFile(
    path.join(options.output, "public-export-manifest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await rm(path.join(options.output, exportMarker), { force: true });
  console.log(
    JSON.stringify(
      {
        schema_version: report.schema_version,
        status: report.status,
        exported_file_count: report.exported_file_count,
        aggregate_manifest_digest: report.aggregate_manifest_digest,
        anonymous_skill_acceptance: report.checks.anonymous_skill_acceptance,
        output: "<configured-output>"
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

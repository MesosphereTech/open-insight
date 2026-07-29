#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelFreeChildEnv } from "./child-env.mjs";
import {
  OPEN_INSIGHT_DEFAULT_CORE_REPOSITORY,
  OPEN_INSIGHT_DEFAULT_CORE_REF,
  OPEN_INSIGHT_MINIMUM_NODE_VERSION,
  OPEN_INSIGHT_MINIMUM_NPM_MAJOR,
  OPEN_INSIGHT_MODERN_NODE_VERSION,
  OPEN_INSIGHT_SUPPORTED_NODE_RANGE,
  defaultCoreInstallRoot,
  normalizeCoreRef
} from "./core-release.mjs";

const defaultRemoteUrl = OPEN_INSIGHT_DEFAULT_CORE_REPOSITORY;
const remoteUrl = process.env.OPEN_INSIGHT_CORE_REPOSITORY || defaultRemoteUrl;
const remoteDisplay = process.env.OPEN_INSIGHT_CORE_REPOSITORY ? "<configured-repository>" : defaultRemoteUrl;
let requestedCoreRef;
try {
  requestedCoreRef = normalizeCoreRef();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const coreRefSource = process.env.OPEN_INSIGHT_CORE_REF ? "environment_override" : "default_alpha";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes("--check-only");
const nodeCommand = process.execPath;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const gitCommand = process.platform === "win32" ? "git.exe" : "git";
const defaultInstallRoot = defaultCoreInstallRoot(requestedCoreRef);
const managedInstallMarkerName = ".open-insight-managed-install.json";
const bootstrapWrapperPath = path.join(scriptDir, "bootstrap.mjs");
const compileWrapperPath = path.join(scriptDir, "compile-folder.mjs");
const cliWrapperPath = path.join(scriptDir, "cli.mjs");

function redact(value) {
  const sensitiveEnvNames = ["OPEN_INSIGHT_MODEL_" + "API_" + "KEY", "XIAOMI_" + "API_" + "KEY"];
  return sensitiveEnvNames.reduce(
    (current, envName) => current.replace(new RegExp(`${envName}=\\S+`, "g"), `${envName}=[REDACTED]`),
    String(value)
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, "$1[REDACTED]@")
      .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+\b/gi, "[REDACTED]")
      .replace(/(?:sk)-[A-Za-z0-9_-]+/g, "[REDACTED]")
  );
}

function run(command, args, cwd) {
  const useCommandShell = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
  const actualCommand = useCommandShell ? "cmd.exe" : command;
  const actualArgs = useCommandShell ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(actualCommand, actualArgs, {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
    shell: false,
    env: createModelFreeChildEnv({
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    })
  });

  return {
    command: [command, ...args].join(" "),
    exit_code: result.status ?? (result.error ? 1 : 0),
    ok: !result.error && result.status === 0,
    stdout: redact((result.stdout ?? "").trim()),
    stderr: redact((result.stderr ?? "").trim()),
    error: result.error ? redact(result.error.message) : undefined
  };
}

function progress(step, message) {
  process.stderr.write(`[Open Insight] 阶段 ${step}/5：${message}\n`);
}

function numericVersion(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/u);
  return match ? match.slice(1, 4).map(Number) : undefined;
}

function versionAtLeast(actual, minimum) {
  const actualParts = numericVersion(actual);
  const minimumParts = numericVersion(minimum);
  if (!actualParts || !minimumParts) return false;
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true;
    if (actualParts[index] < minimumParts[index]) return false;
  }
  return true;
}

function nodeVersionSupported(actual) {
  const parts = numericVersion(actual);
  if (!parts) return false;
  if (parts[0] === 20) return versionAtLeast(actual, OPEN_INSIGHT_MINIMUM_NODE_VERSION);
  return parts[0] >= 22 && versionAtLeast(actual, OPEN_INSIGHT_MODERN_NODE_VERSION);
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/u)[0].trim();
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageName(root) {
  try {
    const parsed = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

async function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function isOpenInsightRoot(root) {
  if (!root) {
    return false;
  }
  return (await readPackageName(root)) === "open-insight" && (await exists(path.join(root, "scripts", "skill-bootstrap.mjs")));
}

async function candidateRoots() {
  const realScriptDir = await realpath(scriptDir).catch(() => scriptDir);
  if (process.env.OPEN_INSIGHT_CORE_HOME) {
    return [
      {
        source: "OPEN_INSIGHT_CORE_HOME",
        root: process.env.OPEN_INSIGHT_CORE_HOME
      }
    ];
  }
  return [
    { source: "current_working_directory", root: process.cwd() },
    { source: "skill_relative_path", root: path.resolve(scriptDir, "../../..") },
    { source: "skill_realpath_relative_path", root: path.resolve(realScriptDir, "../../..") },
    { source: "default_install_root", root: defaultInstallRoot }
  ];
}

async function readManagedInstallMarker(root) {
  try {
    return JSON.parse(await readFile(path.join(root, managedInstallMarkerName), "utf8"));
  } catch {
    return undefined;
  }
}

async function inspectCoreRevision(root, source) {
  const head = run(gitCommand, ["rev-parse", "--verify", "HEAD"], root);
  const requested = run(gitCommand, ["rev-parse", "--verify", `${requestedCoreRef}^{commit}`], root);
  const marker = await readManagedInstallMarker(root);
  const refRequired =
    source === "git_clone" ||
    source === "default_install_root" ||
    Boolean(process.env.OPEN_INSIGHT_CORE_REF) ||
    marker?.managed === true;
  const verified = refRequired && head.ok && requested.ok && head.stdout === requested.stdout;
  return {
    requested_core_ref: requestedCoreRef,
    core_ref_source: coreRefSource,
    core_ref_policy: refRequired ? "pinned" : "local_override",
    core_ref_status: refRequired ? (verified ? "verified" : "mismatch") : "not_enforced",
    core_ref_verified: refRequired ? verified : null,
    resolved_core_commit: head.ok ? head.stdout : "unknown",
    requested_ref_commit: requested.ok ? requested.stdout : "unknown",
    managed_install: marker?.managed === true
  };
}

async function findCoreRoot() {
  for (const candidate of await candidateRoots()) {
    const resolved = path.resolve(candidate.root);
    if (await isOpenInsightRoot(resolved)) {
      return {
        root: resolved,
        source: candidate.source
      };
    }
  }
  return undefined;
}

async function writeInstallReport(report) {
  const outputDir = path.resolve(process.cwd(), "output");
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "open-insight-skill-install.json");
  const markdownPath = path.join(outputDir, "open-insight-skill-install.md");
  const markdown = [
    "# Open Insight Skill Install",
    "",
    `- status: \`${report.status}\``,
    `- mode: \`${report.mode}\``,
    `- node_status: \`${report.system_checks?.node?.status ?? "not_checked"}\``,
    `- node_version: \`${report.system_checks?.node?.version ?? "unknown"}\``,
    `- npm_status: \`${report.system_checks?.npm?.status ?? "not_checked"}\``,
    `- npm_version: \`${report.system_checks?.npm?.version ?? "unknown"}\``,
    `- git_status: \`${report.system_checks?.git?.status ?? "not_checked"}\``,
    `- git_version: \`${report.system_checks?.git?.version ?? "unknown"}\``,
    `- core_status: \`${report.system_checks?.core?.status ?? "not_checked"}\``,
    `- core_root: \`${report.core_root ?? "not_found"}\``,
    `- core_root_source: \`${report.core_root_source ?? "not_found"}\``,
    `- standalone_skill: \`${report.standalone_skill ?? false}\``,
    `- remote_url: \`${report.remote_url}\``,
    `- requested_core_ref: \`${report.requested_core_ref}\``,
    `- core_ref_source: \`${report.core_ref_source}\``,
    `- core_ref_policy: \`${report.core_ref_policy ?? "not_checked"}\``,
    `- core_ref_status: \`${report.core_ref_status ?? "not_checked"}\``,
    `- core_ref_verified: \`${report.core_ref_verified ?? "not_checked"}\``,
    `- resolved_core_commit: \`${report.resolved_core_commit ?? "not_available"}\``,
    `- install_root: \`${report.install_root}\``,
    `- wrapper_bootstrap_attempted: \`${report.wrapper_bootstrap?.attempted ?? false}\``,
    `- wrapper_bootstrap_ok: \`${report.wrapper_bootstrap?.ok ?? false}\``,
    "",
    "## 下一步",
    "",
    ...report.next_actions.map((item) => `- ${item}`),
    "",
    "## 安全边界",
    "",
    "- 不读取、不输出模型密钥。",
    "- 不调用模型。",
    "- 不上传本地文件。",
    "- 不执行 .insight 包内代码。"
  ].join("\n");

  await writeFileAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFileAtomic(markdownPath, `${markdown}\n`);
  return { jsonPath, markdownPath };
}

async function main() {
  progress(1, "检查 Node.js、npm 和 Git");
  const npmVersionResult = run(npmCommand, ["--version"], process.cwd());
  const gitVersionResult = run(gitCommand, ["--version"], process.cwd());
  const nodeVersion = process.versions.node;
  const npmVersion = firstLine(npmVersionResult.stdout);
  const npmMajor = Number.parseInt(npmVersion.split(".")[0], 10);
  const gitVersion = firstLine(gitVersionResult.stdout).replace(/^git version\s+/iu, "");
  const systemChecks = {
    node: {
      status: nodeVersionSupported(nodeVersion) ? "ready" : "unsupported_version",
      version: nodeVersion,
      minimum_version: OPEN_INSIGHT_MINIMUM_NODE_VERSION,
      supported_versions: OPEN_INSIGHT_SUPPORTED_NODE_RANGE
    },
    npm: {
      status:
        npmVersionResult.ok && npmMajor >= OPEN_INSIGHT_MINIMUM_NPM_MAJOR
          ? "ready"
          : npmVersionResult.ok
            ? "unsupported_version"
            : "missing",
      version: npmVersion || "unavailable",
      minimum_major: OPEN_INSIGHT_MINIMUM_NPM_MAJOR
    },
    git: {
      status: gitVersionResult.ok ? "ready" : "missing",
      version: gitVersion || "unavailable"
    },
    core: {
      status: "not_checked"
    }
  };
  const prerequisitesReady =
    systemChecks.node.status === "ready" &&
    systemChecks.npm.status === "ready" &&
    systemChecks.git.status === "ready";
  const installRoot = path.resolve(process.env.OPEN_INSIGHT_CORE_HOME || defaultInstallRoot);
  const installActions = [];

  if (!prerequisitesReady) {
    const nextActions = [];
    if (systemChecks.node.status !== "ready") {
      nextActions.push(`安装受支持的 Node.js（${OPEN_INSIGHT_SUPPORTED_NODE_RANGE}），然后重新运行 bootstrap。`);
    }
    if (systemChecks.npm.status !== "ready") {
      nextActions.push(`安装 npm ${OPEN_INSIGHT_MINIMUM_NPM_MAJOR} 或更高版本，并确认 npm 已加入 PATH。`);
    }
    if (systemChecks.git.status !== "ready") {
      nextActions.push("安装 Git，并确认 git 已加入 PATH。Bootstrap 需要 Git 下载和校验固定 Core tag。");
    }
    const report = {
      schema_version: "open-insight.skill-install.v0.1",
      status: "prerequisite_failed",
      mode: checkOnly ? "check_only" : "install",
      core_root: undefined,
      core_root_source: undefined,
      standalone_skill: !(await isOpenInsightRoot(process.cwd())),
      remote_url: remoteDisplay,
      requested_core_ref: requestedCoreRef,
      core_ref_source: coreRefSource,
      core_ref_policy: "pinned",
      core_ref_status: "not_checked",
      core_ref_verified: false,
      install_root: installRoot,
      install_actions: installActions,
      system_checks: systemChecks,
      wrapper_bootstrap: {
        attempted: false,
        ok: false,
        exit_code: null,
        core_status: "not_run"
      },
      next_actions: nextActions,
      safety: {
        model_invoked: false,
        env_recorded: false,
        api_key_recorded: false,
        package_code_executed: false,
        base_package_mutation: false
      }
    };
    const outputs = await writeInstallReport(report);
    console.log(`Open Insight Skill install: ${report.status}`);
    console.log(`JSON: ${path.relative(process.cwd(), outputs.jsonPath).replaceAll(path.sep, "/")}`);
    console.log(`Markdown: ${path.relative(process.cwd(), outputs.markdownPath).replaceAll(path.sep, "/")}`);
    process.exit(1);
  }

  progress(2, "查找已安装的固定版本 Core");
  let coreRootMatch = await findCoreRoot();
  let coreRoot = coreRootMatch?.root;
  systemChecks.core.status = coreRoot ? "found" : "not_installed";

  if (!coreRoot && !checkOnly) {
    progress(3, `下载固定 Core ${requestedCoreRef}`);
    await mkdir(path.dirname(installRoot), { recursive: true });
    const clone = run(
      gitCommand,
      ["clone", "--depth", "1", "--branch", requestedCoreRef, "--single-branch", remoteUrl, installRoot],
      process.cwd()
    );
    installActions.push({
      label: "git_clone",
      ...clone,
      command: `${gitCommand} clone --depth 1 --branch ${requestedCoreRef} --single-branch ${remoteDisplay} <install-root>`
    });
    if (!clone.ok) {
      const report = {
        schema_version: "open-insight.skill-install.v0.1",
        status: "blocked",
        mode: "install",
        core_root: undefined,
        remote_url: remoteDisplay,
        requested_core_ref: requestedCoreRef,
        core_ref_source: coreRefSource,
        core_ref_policy: "pinned",
        core_ref_status: "clone_failed",
        core_ref_verified: false,
        install_root: installRoot,
        install_actions: installActions,
        system_checks: systemChecks,
        next_actions: [
          "确认本机已安装 Git，并且可以访问 GitHub。",
          `确认 Core 仓库中存在固定版本 \`${requestedCoreRef}\`。`,
          process.env.OPEN_INSIGHT_CORE_REPOSITORY
            ? "检查 OPEN_INSIGHT_CORE_REPOSITORY 指向的 Core 仓库或镜像是否可访问。"
            : `也可以手动运行：git clone --depth 1 --branch ${requestedCoreRef} --single-branch ${defaultRemoteUrl} ${installRoot}`,
          `完成后重新运行：\`node "${bootstrapWrapperPath}"\`。`
        ]
      };
      const outputs = await writeInstallReport(report);
      console.log(`Open Insight Skill install: ${report.status}`);
      console.log(`JSON: ${path.relative(process.cwd(), outputs.jsonPath).replaceAll(path.sep, "/")}`);
      console.log(`Markdown: ${path.relative(process.cwd(), outputs.markdownPath).replaceAll(path.sep, "/")}`);
      process.exit(1);
    }
    coreRoot = installRoot;
    coreRootMatch = {
      root: coreRoot,
      source: "git_clone"
    };
    systemChecks.core.status = "installed";
  } else if (coreRoot) {
    progress(3, "复用已找到的本地 Core");
  } else {
    progress(3, "检查模式不执行 Core 下载");
  }

  if (!coreRoot) {
    const report = {
      schema_version: "open-insight.skill-install.v0.1",
      status: "needs_install",
      mode: "check_only",
      core_root: undefined,
      core_root_source: undefined,
      standalone_skill: !(await isOpenInsightRoot(process.cwd())),
      remote_url: remoteDisplay,
      requested_core_ref: requestedCoreRef,
      core_ref_source: coreRefSource,
      core_ref_policy: "pinned",
      core_ref_status: "not_installed",
      core_ref_verified: false,
      install_root: installRoot,
      install_actions: installActions,
      system_checks: systemChecks,
      wrapper_bootstrap: {
        attempted: false,
        ok: false,
        exit_code: null
      },
      next_actions: [
        `运行 \`node "${bootstrapWrapperPath}"\`，让 Skill 从 ${remoteDisplay} 安装固定 Core ${requestedCoreRef}。`,
        process.env.OPEN_INSIGHT_CORE_REPOSITORY
          ? "或检查 OPEN_INSIGHT_CORE_REPOSITORY 后重试。"
          : `或手动运行：git clone --depth 1 --branch ${requestedCoreRef} --single-branch ${defaultRemoteUrl} ${installRoot}`,
        `安装后重新运行：\`node "${bootstrapWrapperPath}"\`。`
      ]
    };
    const outputs = await writeInstallReport(report);
    console.log(`Open Insight Skill install: ${report.status}`);
    console.log(`JSON: ${path.relative(process.cwd(), outputs.jsonPath).replaceAll(path.sep, "/")}`);
    console.log(`Markdown: ${path.relative(process.cwd(), outputs.markdownPath).replaceAll(path.sep, "/")}`);
    return;
  }

  progress(4, `校验 Core 是否对应固定版本 ${requestedCoreRef}`);
  const coreRevision = await inspectCoreRevision(coreRoot, coreRootMatch?.source ?? "unknown");
  systemChecks.core.status =
    coreRevision.core_ref_policy === "pinned"
      ? coreRevision.core_ref_verified
        ? "verified"
        : "version_mismatch"
      : "local_override";
  if (coreRevision.core_ref_policy === "pinned" && !coreRevision.core_ref_verified) {
    const report = {
      schema_version: "open-insight.skill-install.v0.1",
      status: "version_mismatch",
      mode: checkOnly ? "check_only" : "check_and_install",
      core_root: coreRoot,
      core_root_source: coreRootMatch?.source ?? "unknown",
      core_commit: coreRevision.resolved_core_commit,
      standalone_skill: !(await isOpenInsightRoot(process.cwd())),
      remote_url: remoteDisplay,
      install_root: installRoot,
      install_actions: installActions,
      system_checks: systemChecks,
      ...coreRevision,
      wrapper_bootstrap: {
        attempted: false,
        ok: false,
        exit_code: null,
        core_status: "not_run"
      },
      next_actions: [
        `当前 Core commit 不对应请求版本 \`${requestedCoreRef}\`，为避免移动分支冒充 Alpha，bootstrap 已停止。`,
        process.env.OPEN_INSIGHT_CORE_HOME
          ? "OPEN_INSIGHT_CORE_HOME 是显式本地 Core；请检出请求 tag，或同时设置 OPEN_INSIGHT_CORE_REF 指向你明确接受的本地 ref。"
          : `请移走旧安装目录 \`${coreRoot}\` 后重新运行 bootstrap，Skill 会重新安装固定版本。`,
        `公开 Alpha 默认版本固定为 \`${OPEN_INSIGHT_DEFAULT_CORE_REF}\`。`
      ],
      safety: {
        model_invoked: false,
        env_recorded: false,
        api_key_recorded: false,
        package_code_executed: false,
        base_package_mutation: false
      }
    };
    const outputs = await writeInstallReport(report);
    console.log(`Open Insight Skill install: ${report.status}`);
    console.log(`JSON: ${path.relative(process.cwd(), outputs.jsonPath).replaceAll(path.sep, "/")}`);
    console.log(`Markdown: ${path.relative(process.cwd(), outputs.markdownPath).replaceAll(path.sep, "/")}`);
    process.exit(checkOnly ? 0 : 1);
  }

  if (coreRootMatch?.source === "git_clone") {
    await writeFileAtomic(
      path.join(coreRoot, managedInstallMarkerName),
      `${JSON.stringify(
        {
          schema_version: "open-insight.managed-core-install.v0.1",
          managed: true,
          requested_core_ref: requestedCoreRef,
          resolved_core_commit: coreRevision.resolved_core_commit
        },
        null,
        2
      )}\n`
    );
    coreRevision.managed_install = true;
  }

  progress(5, "检查依赖并准备 CLI / MCP Core");
  const coreBootstrapOutputDir = path.resolve(process.cwd(), "output", ".open-insight-core-bootstrap");
  const args = [
    "scripts/skill-bootstrap.mjs",
    ...(checkOnly ? ["--check-only"] : []),
    "--output-dir",
    coreBootstrapOutputDir
  ];
  const bootstrap = run(nodeCommand, args, coreRoot);
  const coreBootstrapReportPath = path.join(coreBootstrapOutputDir, "open-insight-skill-bootstrap.json");
  const coreBootstrapReport = await readFile(coreBootstrapReportPath, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => undefined);
  const bootstrapReady = bootstrap.ok && coreBootstrapReport?.status === "ready";
  const report = {
    schema_version: "open-insight.skill-install.v0.1",
    status: bootstrapReady ? "ready" : checkOnly && coreBootstrapReport?.status ? coreBootstrapReport.status : "blocked",
    mode: checkOnly ? "check_only" : "check_and_install",
    core_root: coreRoot,
    core_root_source: coreRootMatch?.source ?? "unknown",
    core_commit: coreRevision.resolved_core_commit,
    ...coreRevision,
    standalone_skill: !(await isOpenInsightRoot(process.cwd())),
    remote_url: remoteDisplay,
    install_root: installRoot,
    install_actions: installActions,
    system_checks: systemChecks,
    wrapper_bootstrap: {
      attempted: true,
      ok: bootstrapReady,
      exit_code: bootstrap.exit_code,
      core_status: coreBootstrapReport?.status ?? "missing_report"
    },
    next_actions: bootstrapReady
      ? [
          `运行 \`node "${compileWrapperPath}" --source-dir <材料目录> --output-dir output --base-name source-context --parser auto\` 生成默认 source_bundled 单文件 .insight；需要轻量包时显式加 \`--mode source_light\`。`,
          `运行 \`node "${cliWrapperPath}" context summary <package.insight> --format json\`，或用同一 wrapper 启动只读 MCP。`,
          "随后让外部 LLM 读取本 Skill，通过 MCP / CLI 查询 `.insight`，再生成用户材料。",
          "遇到 PDF/PPTX/DOCX/XLSX 时，`compile-folder.mjs --parser auto` 会自动在 `~/.open-insight/parsers/` 准备固定版本 MarkItDown；普通用户不需要手工 pip install。本机需要 Python 3.10+。扫描 PDF 的模型 OCR 仍须显式配置 `OPEN_INSIGHT_OCR_*` 并使用 `--ocr llm`。"
        ]
      : [
          "Core 已找到，但 bootstrap 未通过。请查看 Core 仓库中的 `output/open-insight-skill-bootstrap.json`。",
          "修复依赖或 CLI 问题后，重新运行本 Skill wrapper。"
        ],
    safety: {
      model_invoked: false,
      env_recorded: false,
      api_key_recorded: false,
      package_code_executed: false,
      base_package_mutation: false
    }
  };
  const outputs = await writeInstallReport(report);
  console.log(`Open Insight Skill install: ${report.status}`);
  console.log(`JSON: ${path.relative(process.cwd(), outputs.jsonPath).replaceAll(path.sep, "/")}`);
  console.log(`Markdown: ${path.relative(process.cwd(), outputs.markdownPath).replaceAll(path.sep, "/")}`);
  process.stdout.write(bootstrap.stdout ? `${bootstrap.stdout}\n` : "");
  process.stderr.write(bootstrap.stderr ? `${bootstrap.stderr}\n` : "");
  if (bootstrapReady) progress(5, "完成：Core、CLI 和 MCP 已就绪");
  process.exit(bootstrapReady || checkOnly ? 0 : bootstrap.exit_code || 1);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
import {
  OPEN_INSIGHT_DEFAULT_CORE_REF,
  OPEN_INSIGHT_DEFAULT_CORE_REPOSITORY
} from "../skills/open-insight-context/scripts/core-release.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function redactRepository(value) {
  return String(value).replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1[REDACTED]@");
}

function createAnonymousGitEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === "GIT_CONFIG_COUNT" || name.startsWith("GIT_CONFIG_KEY_") || name.startsWith("GIT_CONFIG_VALUE_")) {
      delete env[name];
    }
  }
  for (const name of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GIT_ASKPASS",
    "GIT_SSH_COMMAND",
    "SSH_AUTH_SOCK",
    "SSH_ASKPASS",
    "OPEN_INSIGHT_MODEL_API_KEY",
    "XIAOMI_API_KEY"
  ]) {
    delete env[name];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "Never";
  env.GCM_CREDENTIAL_STORE = "none";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  env.HOME = os.tmpdir();
  env.XDG_CONFIG_HOME = os.tmpdir();
  return env;
}

function verifyRemoteTag(repository, tag) {
  const gitCommand = process.platform === "win32" ? "git.exe" : "git";
  const result = spawnSync(
    gitCommand,
    [
      "-c",
      "credential.helper=",
      "-c",
      "credential.interactive=never",
      "ls-remote",
      "--exit-code",
      repository,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`
    ],
    {
      cwd: os.tmpdir(),
      encoding: "utf8",
      timeout: 30_000,
      shell: false,
      env: createAnonymousGitEnv()
    }
  );
  const entries = String(result.stdout ?? "")
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([hash, ref]) => Boolean(hash && ref));
  const peeled = entries.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  const direct = entries.find(([, ref]) => ref === `refs/tags/${tag}`);
  const resolvedCommit = peeled?.[0] ?? direct?.[0] ?? null;
  const ok = !result.error && result.status === 0 && /^[0-9a-f]{40,64}$/iu.test(resolvedCommit ?? "");
  const remoteStatus = ok
    ? "verified"
    : result.status === 2
      ? "tag_missing"
      : "anonymous_access_failed";
  return {
    ok,
    remote_status: remoteStatus,
    remote_exit_code: result.status ?? (result.error ? 1 : 0),
    resolved_commit: ok ? resolvedCommit : null
  };
}

const actualTag = argumentValue("--tag") || process.env.GITHUB_REF_NAME || "";
const verifyRemote = process.argv.includes("--verify-remote");
const repository =
  argumentValue("--repository") ||
  process.env.OPEN_INSIGHT_CORE_REPOSITORY ||
  OPEN_INSIGHT_DEFAULT_CORE_REPOSITORY;
const tagMatches = actualTag === OPEN_INSIGHT_DEFAULT_CORE_REF;
const remote = tagMatches && verifyRemote ? verifyRemoteTag(repository, actualTag) : undefined;
const status = !tagMatches ? "mismatch" : remote && !remote.ok ? "remote_unavailable" : "ok";
const report = {
  schema_version: "open-insight.alpha-release-ref-check.v0.1",
  status,
  expected_tag: OPEN_INSIGHT_DEFAULT_CORE_REF,
  actual_tag: actualTag || "missing",
  remote_verification: verifyRemote ? "required" : "not_requested",
  repository: redactRepository(repository),
  remote_status: remote?.remote_status ?? "not_checked",
  remote_tag_verified: remote?.ok ?? null,
  anonymous_access_verified: remote?.ok ?? null,
  remote_exit_code: remote?.remote_exit_code ?? null,
  resolved_commit: remote?.resolved_commit ?? null
};

if (argumentValue("--format") === "json") {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Open Insight Alpha release ref: ${report.status}`);
  console.log(`expected_tag: ${report.expected_tag}`);
  console.log(`actual_tag: ${report.actual_tag}`);
  console.log(`remote_verification: ${report.remote_verification}`);
  console.log(`remote_status: ${report.remote_status}`);
  console.log(`remote_tag_verified: ${report.remote_tag_verified ?? "not_checked"}`);
  console.log(`anonymous_access_verified: ${report.anonymous_access_verified ?? "not_checked"}`);
  console.log(`remote_exit_code: ${report.remote_exit_code ?? "not_checked"}`);
  console.log(`resolved_commit: ${report.resolved_commit ?? "not_available"}`);
}

if (!tagMatches) {
  console.error(
    `发布 tag 与 Skill 固定 Core 版本不一致：预期 ${report.expected_tag}，实际 ${report.actual_tag}。请勿发布移动分支或错误版本。`
  );
  process.exit(1);
}

if (remote && !remote.ok) {
  const reason = remote.remote_status === "tag_missing"
    ? `远端仓库中不存在固定 tag ${actualTag}`
    : `固定 tag ${actualTag} 无法匿名读取`;
  console.error(
    `${reason}。Gate 1 尚未通过；请先公开发布来源并创建 tag，再重新运行 --verify-remote。`
  );
  process.exit(1);
}

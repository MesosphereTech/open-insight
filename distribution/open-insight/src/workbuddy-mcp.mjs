import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const OPEN_INSIGHT_MCP_SERVER_NAME = "open-insight-context";

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function findInstalledContextSkill({ homeDir = os.homedir(), cwd = process.cwd() } = {}) {
  const candidates = [
    path.join(homeDir, ".codebuddy", "skills", "open-insight-context"),
    path.join(homeDir, ".agents", "skills", "open-insight-context"),
    path.join(cwd, ".codebuddy", "skills", "open-insight-context"),
    path.join(cwd, ".agents", "skills", "open-insight-context")
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "scripts", "cli.mjs")));
}

export function createWorkBuddyMcpEntry(skillRoot, { nodeExecutable = process.execPath } = {}) {
  return {
    command: nodeExecutable,
    args: [
      path.join(skillRoot, "scripts", "cli.mjs"),
      "mcp",
      "serve",
      "--unbound",
      "--transport",
      "stdio"
    ],
    env: {
      OPEN_INSIGHT_AUTO_BOOTSTRAP: "1",
      OPEN_INSIGHT_MCP_MANAGED: "1",
      NO_COLOR: "1"
    },
    disabled: false
  };
}

export function registerWorkBuddyMcp({
  homeDir = os.homedir(),
  cwd = process.cwd(),
  configPath = path.join(homeDir, ".workbuddy", "mcp.json"),
  nodeExecutable = process.execPath,
  now = () => new Date()
} = {}) {
  const workBuddyRoot = path.dirname(configPath);
  if (!existsSync(workBuddyRoot)) {
    return { status: "unsupported", reason: "workbuddy_not_detected", config_path: configPath };
  }

  const skillRoot = findInstalledContextSkill({ homeDir, cwd });
  if (!skillRoot) {
    return { status: "degraded", reason: "installed_context_skill_not_found", config_path: configPath };
  }

  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      return { status: "degraded", reason: "invalid_workbuddy_mcp_json", config_path: configPath };
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { status: "degraded", reason: "invalid_workbuddy_mcp_shape", config_path: configPath };
  }

  const mcpServers = config.mcpServers;
  if (mcpServers !== undefined && (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers))) {
    return { status: "degraded", reason: "invalid_workbuddy_mcp_servers", config_path: configPath };
  }

  const entry = createWorkBuddyMcpEntry(skillRoot, { nodeExecutable });
  const existing = mcpServers?.[OPEN_INSIGHT_MCP_SERVER_NAME];
  if (existing !== undefined) {
    if (sameValue(existing, entry)) {
      return { status: "ready", reason: "already_registered", config_path: configPath, skill_root: skillRoot };
    }
    return { status: "degraded", reason: "existing_open_insight_mcp_conflict", config_path: configPath };
  }

  const nextConfig = {
    ...config,
    mcpServers: {
      ...(mcpServers ?? {}),
      [OPEN_INSIGHT_MCP_SERVER_NAME]: entry
    }
  };
  mkdirSync(workBuddyRoot, { recursive: true });
  let backupPath;
  if (existsSync(configPath)) {
    const stamp = now().toISOString().replace(/[:.]/gu, "-");
    backupPath = `${configPath}.backup-${stamp}`;
    copyFileSync(configPath, backupPath);
  }
  const tempPath = `${configPath}.open-insight-${process.pid}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(tempPath, configPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    return {
      status: "degraded",
      reason: "workbuddy_mcp_write_failed",
      config_path: configPath,
      ...(backupPath ? { backup_path: backupPath } : {}),
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    status: "ready",
    reason: "registered",
    config_path: configPath,
    skill_root: skillRoot,
    ...(backupPath ? { backup_path: backupPath } : {})
  };
}

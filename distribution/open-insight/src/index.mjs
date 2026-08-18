import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { registerWorkBuddyMcp } from "./workbuddy-mcp.mjs";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const OPEN_INSIGHT_INSTALLER_VERSION = packageJson.version;
export const OPEN_INSIGHT_SKILL_NAME = "open-insight-context";
export const OPEN_INSIGHT_SURFACE_SKILL_NAME = "open-insight-full-document-surface";
export const OPEN_INSIGHT_SKILL_NAMES = [OPEN_INSIGHT_SKILL_NAME, OPEN_INSIGHT_SURFACE_SKILL_NAME];
export const OPEN_INSIGHT_CORE_REF = "v0.1.0-alpha.5";
export const OPEN_INSIGHT_SKILL_SOURCE =
  `https://github.com/MesosphereTech/open-insight/tree/${OPEN_INSIGHT_CORE_REF}/skills`;
export const SKILLS_INSTALLER_VERSION = "1.5.9";

const MODEL_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CODEX_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_ACCESS_TOKEN",
  "OPEN_INSIGHT_MODEL_API_KEY",
  "OPEN_INSIGHT_OCR_API_KEY",
  "OPEN_INSIGHT_OCR_BEARER_TOKEN",
  "XIAOMI_API_KEY"
]);

export function createInstallerEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  for (const key of Object.keys(env)) {
    if (
      MODEL_ENV_KEYS.has(key) ||
      /^(?:ANTHROPIC|CODEX|DEEPSEEK|GEMINI|GOOGLE|OPENAI|XIAOMI)_.*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/u.test(
        key
      ) ||
      /^OPEN_INSIGHT_(?:MODEL|OCR)_.*(?:API_KEY|BEARER_TOKEN|AUTH_TOKEN|ACCESS_TOKEN)$/u.test(
        key
      ) ||
      /^VITE_.*(?:API_KEY|TOKEN)$/u.test(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseInstallerArgs(argv) {
  const options = {
    action: "install",
    scope: "global",
    dryRun: false,
    format: "text",
    passthrough: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.action = "help";
    } else if (arg === "--version" || arg === "-v") {
      options.action = "version";
    } else if (arg === "--project") {
      options.scope = "project";
    } else if (arg === "--global") {
      options.scope = "global";
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--format") {
      options.format = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
    } else if (arg === "--agent" || arg === "-a") {
      const value = requireValue(argv, index, arg);
      options.passthrough.push("--agent", value);
      index += 1;
    } else if (arg.startsWith("--agent=")) {
      const value = arg.slice("--agent=".length);
      if (!value) throw new Error("--agent requires a value.");
      options.passthrough.push("--agent", value);
    } else if (arg === "--copy" || arg === "--yes" || arg === "-y") {
      options.passthrough.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["text", "json"].includes(options.format)) {
    throw new Error("--format must be text or json.");
  }
  return options;
}

export function buildSkillsInstallerArgs(options) {
  const args = [
    "add",
    OPEN_INSIGHT_SKILL_SOURCE
  ];
  for (const skillName of OPEN_INSIGHT_SKILL_NAMES) args.push("--skill", skillName);
  if (options.scope === "global") args.push("--global");
  args.push(...options.passthrough);
  if (!args.some((arg) => arg === "--yes" || arg === "-y")) args.push("--yes");
  return args;
}

export function createInstallerPlan(options) {
  return {
    schema_version: "open-insight.installer-plan.v0.1",
    status: "planned",
    package_name: packageJson.name,
    package_version: OPEN_INSIGHT_INSTALLER_VERSION,
    skill_name: OPEN_INSIGHT_SKILL_NAME,
    skill_names: OPEN_INSIGHT_SKILL_NAMES,
    skill_source: OPEN_INSIGHT_SKILL_SOURCE,
    core_ref: OPEN_INSIGHT_CORE_REF,
    install_scope: options.scope,
    skills_installer_version: SKILLS_INSTALLER_VERSION,
    first_use_auto_bootstrap: true,
    workbuddy_mcp_auto_registration: true,
    model_invoked: false
  };
}

export function renderHelp() {
  return `Open Insight - One File, Any AI

Usage:
  npx open-insight-cli [options]

Options:
  --agent <name>   Install for a specific supported AI client
  --project        Install into the current project instead of globally
  --global         Install globally (default)
  --copy           Ask the underlying Skill installer to copy files
  --yes, -y        Run the underlying installer non-interactively
  --dry-run        Show the pinned installation plan without changing files
  --format <type>  text or json (used with --dry-run)
  --version, -v    Print the installer version
  --help, -h       Show this help

After installation, ask your AI to compile a folder into one .insight file or render a polished long-form HTML reading copy.
The first compile or read prepares and verifies pinned Core ${OPEN_INSIGHT_CORE_REF}.
`;
}

export function renderPostInstallGuide() {
  return [
    "",
    "Open Insight is ready.",
    "The Context Skill and the official long-form HTML Surface Skill are installed together.",
    "You do not need to remember CLI commands. Ask your AI in plain language:",
    '- "Use Open Insight to package this folder into one .insight file. Tell me the output path and any parsing warnings."',
    '- "Read this .insight file and explain what information it contains."',
    '- "Answer my question from this .insight file and cite the source file and location for each important claim."',
    '- "Use the installed Open Insight Surface Skill to turn this .insight into a polished long-form HTML reading copy. Save it separately and preserve source references."',
    '- "Use this .insight to create a Word report or presentation with the current AI client. Save it separately and preserve source references."',
    '- "Use the installed read-only Open Insight MCP to query this .insight file."',
    "",
    "Open Insight 已安装。你不需要记住命令，直接告诉当前 AI 你想做什么：",
    "Context Skill 与官方长文 HTML Surface Skill 已经同时安装。",
    '- “请使用 Open Insight，把这个资料文件夹打包成一个 .insight 文件，并告诉我输出位置和解析警告。”',
    '- “请读取这个 .insight，先告诉我里面有哪些资料和主要内容。”',
    '- “请根据这个 .insight 回答我的问题，每个重要结论都注明来源文件和原文位置。”',
    '- “请使用已经安装的 Open Insight Surface Skill，把这个 .insight 生成一份好看的长文 HTML 阅读稿，另存并保留来源。”',
    '- “请根据这个 .insight，使用当前 AI 客户端生成 Word 报告或 PPT，另存为外部文件，并保留重要内容的来源。”',
    '- “请使用已经安装的 Open Insight 只读 MCP，持续查询这个 .insight。”',
    "",
    "Open Insight only reads a folder or file after you ask. Installation does not scan or upload your files.",
    "Open Insight 只会在你明确提出任务后读取指定资料；安装本身不会扫描或上传文件。",
    `The first compile or read automatically prepares and verifies pinned Core ${OPEN_INSIGHT_CORE_REF}.`
  ].join("\n") + "\n";
}

function resolveSkillsCli() {
  const packagePath = require.resolve("skills/package.json");
  return path.join(path.dirname(packagePath), "bin", "cli.mjs");
}

export function runOpenInsightInstaller(
  argv,
  {
    spawn = spawnSync,
    skillsCli,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    registerMcp = registerWorkBuddyMcp
  } = {}
) {
  const options = parseInstallerArgs(argv);
  if (options.action === "help") {
    stdout.write(renderHelp());
    return { exitCode: 0, status: "help" };
  }
  if (options.action === "version") {
    stdout.write(`${OPEN_INSIGHT_INSTALLER_VERSION}\n`);
    return { exitCode: 0, status: "version" };
  }

  const plan = createInstallerPlan(options);
  if (options.dryRun) {
    stdout.write(
      options.format === "json"
        ? `${JSON.stringify(plan, null, 2)}\n`
        : [
            "Open Insight installation plan",
            `- Skills: ${plan.skill_names.join(", ")}`,
            `- Core: ${plan.core_ref}`,
            `- Scope: ${plan.install_scope}`,
            "- WorkBuddy MCP auto-registration: enabled when WorkBuddy is detected",
            "- Model call: no"
          ].join("\n") + "\n"
    );
    return { exitCode: 0, status: "planned", plan };
  }

  stdout.write(
    [
      "Open Insight - One File, Any AI",
      `Installing the pinned Context and Surface Skills (${OPEN_INSIGHT_CORE_REF}).`,
      "正在安装 Open Insight Context 与长文 HTML Surface Skills。"
    ].join("\n") + "\n"
  );

  const result = spawn(
    process.execPath,
    [skillsCli ?? resolveSkillsCli(), ...buildSkillsInstallerArgs(options)],
    {
      stdio: "inherit",
      shell: false,
      env: createInstallerEnv(env)
    }
  );
  if (result.error || result.status !== 0) {
    stderr.write(
      "Open Insight Skill installation did not complete. " +
        "If the Core repository is private, confirm this machine has GitHub access.\n"
    );
    return {
      exitCode: result.status ?? 1,
      status: "failed",
      error: result.error
    };
  }

  const mcpRegistration = registerMcp();
  if (mcpRegistration.status === "ready") {
    stdout.write("Open Insight read-only MCP was registered for WorkBuddy. Reload WorkBuddy to use it.\n");
    stdout.write("Open Insight 只读 MCP 已为 WorkBuddy 自动配置；重新加载 WorkBuddy 后即可使用。\n");
  } else if (mcpRegistration.status === "degraded") {
    stderr.write(
      `Open Insight Skills are installed, but WorkBuddy MCP registration was not changed (${mcpRegistration.reason}). CLI remains available.\n`
    );
  }
  stdout.write(renderPostInstallGuide());
  return { exitCode: 0, status: "installed", plan, mcpRegistration };
}

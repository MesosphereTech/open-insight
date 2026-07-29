import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const OPEN_INSIGHT_INSTALLER_VERSION = packageJson.version;
export const OPEN_INSIGHT_SKILL_NAME = "open-insight-context";
export const OPEN_INSIGHT_CORE_REF = "v0.1.0-alpha.3";
export const OPEN_INSIGHT_SKILL_SOURCE =
  `https://github.com/MesosphereTech/open-insight/tree/${OPEN_INSIGHT_CORE_REF}/skills/${OPEN_INSIGHT_SKILL_NAME}`;
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
    OPEN_INSIGHT_SKILL_SOURCE,
    "--skill",
    OPEN_INSIGHT_SKILL_NAME
  ];
  if (options.scope === "global") args.push("--global");
  args.push(...options.passthrough);
  return args;
}

export function createInstallerPlan(options) {
  return {
    schema_version: "open-insight.installer-plan.v0.1",
    status: "planned",
    package_name: packageJson.name,
    package_version: OPEN_INSIGHT_INSTALLER_VERSION,
    skill_name: OPEN_INSIGHT_SKILL_NAME,
    skill_source: OPEN_INSIGHT_SKILL_SOURCE,
    core_ref: OPEN_INSIGHT_CORE_REF,
    install_scope: options.scope,
    skills_installer_version: SKILLS_INSTALLER_VERSION,
    first_use_auto_bootstrap: true,
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

After installation, ask your AI to compile a folder into one .insight file.
The first compile or read prepares and verifies pinned Core ${OPEN_INSIGHT_CORE_REF}.
`;
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
    env = process.env
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
            `- Skill: ${plan.skill_name}`,
            `- Core: ${plan.core_ref}`,
            `- Scope: ${plan.install_scope}`,
            "- Model call: no"
          ].join("\n") + "\n"
    );
    return { exitCode: 0, status: "planned", plan };
  }

  stdout.write(
    [
      "Open Insight - One File, Any AI",
      `Installing the pinned Context Skill (${OPEN_INSIGHT_CORE_REF}).`,
      "正在安装 Open Insight Context Skill。"
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

  stdout.write(
    [
      "",
      "Open Insight is ready.",
      "Ask your AI: Package this folder into one .insight file.",
      "Open Insight 已就绪。首次编译或读取会自动准备并校验固定版本 Core。"
    ].join("\n") + "\n"
  );
  return { exitCode: 0, status: "installed", plan };
}

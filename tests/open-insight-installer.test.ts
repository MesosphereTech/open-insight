import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  OPEN_INSIGHT_CORE_REF,
  OPEN_INSIGHT_SKILL_NAMES,
  OPEN_INSIGHT_SKILL_SOURCE,
  OPEN_INSIGHT_SURFACE_SKILL_NAME,
  buildSkillsInstallerArgs,
  createInstallerEnv,
  createInstallerPlan,
  parseInstallerArgs,
  renderPostInstallGuide,
  runOpenInsightInstaller
} from "../distribution/open-insight/src/index.mjs";
import {
  OPEN_INSIGHT_MCP_SERVER_NAME,
  registerWorkBuddyMcp
} from "../distribution/open-insight/src/workbuddy-mcp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repoRoot, "distribution", "open-insight");
const scopedPackageRoot = path.join(packageRoot, "scoped");

describe("open-insight branded installer", () => {
  it("keeps the public command branded while pinning the internal Skill source", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(packageRoot, "package.json"), "utf8")
    );
    expect(packageJson.name).toBe("open-insight-cli");
    expect(packageJson.bin).toEqual({ "open-insight": "bin/open-insight.mjs" });
    expect(packageJson.dependencies.skills).toBe("1.5.9");
    expect(packageJson.license).toBe("MIT");
    expect(packageJson.files).toContain("LICENSE");
    expect(OPEN_INSIGHT_CORE_REF).toBe("v0.1.0-alpha.5");
    expect(OPEN_INSIGHT_SKILL_SOURCE).toContain("/v0.1.0-alpha.5/skills");
    expect(OPEN_INSIGHT_SKILL_NAMES).toEqual([
      "open-insight-context",
      "open-insight-full-document-surface"
    ]);
    expect(OPEN_INSIGHT_SURFACE_SKILL_NAME).toBe("open-insight-full-document-surface");
  });

  it("provides a scoped brand alias without duplicating installer logic", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(scopedPackageRoot, "package.json"), "utf8")
    );
    const wrapper = await readFile(
      path.join(scopedPackageRoot, "bin", "open-insight.mjs"),
      "utf8"
    );

    expect(packageJson.name).toBe("@mesospheretech/open-insight");
    expect(packageJson.version).toBe("0.1.0-alpha.5");
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.dependencies).toEqual({
      "open-insight-cli": "0.1.0-alpha.5"
    });
    expect(packageJson.bin).toEqual({ "open-insight": "bin/open-insight.mjs" });
    expect(wrapper).toContain(
      'import "open-insight-cli/bin/open-insight.mjs"'
    );
    expect(wrapper).not.toContain("../src/index.mjs");
  });

  it("installs the Context and official Surface Skills in one non-interactive transaction", () => {
    const args = buildSkillsInstallerArgs(parseInstallerArgs(["--global"]));
    expect(args.slice(0, 2)).toEqual(["add", OPEN_INSIGHT_SKILL_SOURCE]);
    expect(args.filter((value) => value === "--skill")).toHaveLength(2);
    expect(args).toEqual(expect.arrayContaining(OPEN_INSIGHT_SKILL_NAMES));
    expect(args).not.toContain("--confirm-surface");
    expect(args).toContain("--yes");
  });

  it("defaults to global install and supports isolated project acceptance", () => {
    const globalOptions = parseInstallerArgs([]);
    expect(buildSkillsInstallerArgs(globalOptions)).toContain("--global");

    const projectOptions = parseInstallerArgs([
      "--project",
      "--agent",
      "codex",
      "--copy",
      "--yes"
    ]);
    const args = buildSkillsInstallerArgs(projectOptions);
    expect(args).not.toContain("--global");
    expect(args).toEqual(
      expect.arrayContaining(["--agent", "codex", "--copy", "--yes"])
    );
    expect(createInstallerPlan(projectOptions)).toMatchObject({
      status: "planned",
      install_scope: "project",
      core_ref: "v0.1.0-alpha.5",
      first_use_auto_bootstrap: true,
      skill_names: ["open-insight-context", "open-insight-full-document-surface"],
      model_invoked: false
    });
  });

  it("does not forward model credentials to the generic Skill installer", () => {
    const env = createInstallerEnv({
      PATH: "safe",
      GH_TOKEN: "github-auth-is-required-for-private-acceptance",
      OPENAI_API_KEY: "model-secret",
      ANTHROPIC_AUTH_TOKEN: "model-secret",
      OPEN_INSIGHT_MODEL_API_KEY: "model-secret",
      OPEN_INSIGHT_OCR_BEARER_TOKEN: "ocr-secret",
      VITE_OPEN_INSIGHT_MODEL_API_KEY: "browser-secret"
    });
    expect(env.PATH).toBe("safe");
    expect(env.GH_TOKEN).toBe("github-auth-is-required-for-private-acceptance");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.OPEN_INSIGHT_MODEL_API_KEY).toBeUndefined();
    expect(env.OPEN_INSIGHT_OCR_BEARER_TOKEN).toBeUndefined();
    expect(env.VITE_OPEN_INSIGHT_MODEL_API_KEY).toBeUndefined();
  });

  it("invokes the pinned generic installer without exposing its command to users", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const spawn = vi.fn(() => ({ status: 0 }));
    const result = runOpenInsightInstaller(
      ["--project", "--agent=codex", "--copy", "-y"],
      {
        spawn,
        skillsCli: "<skills-cli>",
        stdout: { write: (value: string) => stdout.push(value) },
        stderr: { write: (value: string) => stderr.push(value) },
        env: { PATH: "safe", OPENAI_API_KEY: "model-secret" },
        registerMcp: () => ({ status: "unsupported", reason: "workbuddy_not_detected" })
      }
    );

    expect(result.status).toBe("installed");
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args[0]).toBe("<skills-cli>");
    expect(args).toEqual(
      expect.arrayContaining([
        "add",
        OPEN_INSIGHT_SKILL_SOURCE,
        "--skill",
        "open-insight-context",
        "--skill",
        "open-insight-full-document-surface",
        "--agent",
        "codex"
      ])
    );
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
    const output = stdout.join("");
    expect(output).toContain("Open Insight is ready");
    expect(output).toContain("official long-form HTML Surface Skill");
    expect(output).toContain("You do not need to remember CLI commands");
    expect(output).toContain("Open Insight 已安装");
    expect(output).toContain("打包成一个 .insight 文件");
    expect(output).toContain("来源文件和原文位置");
    expect(output).toContain("生成 Word 报告或 PPT");
    expect(output).toContain("官方长文 HTML Surface Skill");
    expect(output).toContain("另存为外部文件");
    expect(output).toContain("已经安装的 Open Insight 只读 MCP");
    expect(output).toContain("安装本身不会扫描或上传文件");
    expect(stderr).toEqual([]);
  });

  it("registers an unbound read-only MCP for WorkBuddy without overwriting other servers", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "open-insight-workbuddy-"));
    const skillRoot = path.join(tempHome, ".codebuddy", "skills", "open-insight-context");
    const configPath = path.join(tempHome, ".workbuddy", "mcp.json");
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(path.join(skillRoot, "scripts", "cli.mjs"), "// fixture\n", "utf8");
    await writeFile(configPath, JSON.stringify({ mcpServers: { existing: { command: "keep" } } }), "utf8");

    const registration = registerWorkBuddyMcp({
      homeDir: tempHome,
      configPath,
      nodeExecutable: "node-fixture",
      now: () => new Date("2026-08-13T12:00:00.000Z")
    });
    expect(registration).toMatchObject({ status: "ready", reason: "registered" });
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.mcpServers.existing).toEqual({ command: "keep" });
    expect(config.mcpServers[OPEN_INSIGHT_MCP_SERVER_NAME]).toMatchObject({
      command: "node-fixture",
      args: [
        path.join(skillRoot, "scripts", "cli.mjs"),
        "mcp",
        "serve",
        "--unbound",
        "--transport",
        "stdio"
      ],
      disabled: false
    });
    expect(JSON.stringify(config)).not.toMatch(/API_KEY|Bearer|OPENAI/u);
    expect(registration.backup_path).toBeTruthy();

    const repeated = registerWorkBuddyMcp({ homeDir: tempHome, configPath, nodeExecutable: "node-fixture" });
    expect(repeated).toMatchObject({ status: "ready", reason: "already_registered" });
  });

  it("does not overwrite invalid or conflicting WorkBuddy MCP configuration", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "open-insight-workbuddy-conflict-"));
    const skillRoot = path.join(tempHome, ".agents", "skills", "open-insight-context");
    const configPath = path.join(tempHome, ".workbuddy", "mcp.json");
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(path.join(skillRoot, "scripts", "cli.mjs"), "// fixture\n", "utf8");
    const conflicting = { mcpServers: { [OPEN_INSIGHT_MCP_SERVER_NAME]: { command: "user-owned" } } };
    await writeFile(configPath, JSON.stringify(conflicting), "utf8");
    expect(registerWorkBuddyMcp({ homeDir: tempHome, configPath })).toMatchObject({
      status: "degraded",
      reason: "existing_open_insight_mcp_conflict"
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(conflicting);

    await writeFile(configPath, "{broken", "utf8");
    expect(registerWorkBuddyMcp({ homeDir: tempHome, configPath })).toMatchObject({
      status: "degraded",
      reason: "invalid_workbuddy_mcp_json"
    });
    expect(await readFile(configPath, "utf8")).toBe("{broken");
  });

  it("renders a concise bilingual natural-language quick start", () => {
    const guide = renderPostInstallGuide();
    expect(guide).toContain("package this folder into one .insight file");
    expect(guide).toContain("cite the source file and location");
    expect(guide).toContain("Word report or presentation with the current AI client");
    expect(guide).toContain("polished long-form HTML reading copy");
    expect(guide).toContain("好看的长文 HTML 阅读稿");
    expect(guide).toContain("installed read-only Open Insight MCP");
    expect(guide).toContain("请读取这个 .insight");
    expect(guide).toContain("只会在你明确提出任务后读取指定资料");
    expect(guide).not.toContain("npm run");
    expect(guide).not.toContain("node <skill-root>");
  });

  it("emits a machine-readable dry-run without cloning or installing", () => {
    const output = execFileSync(
      process.execPath,
      [
        path.join(packageRoot, "bin", "open-insight.mjs"),
        "--dry-run",
        "--format",
        "json",
        "--project",
        "--agent",
        "codex",
        "--yes"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    expect(JSON.parse(output)).toMatchObject({
      schema_version: "open-insight.installer-plan.v0.1",
      status: "planned",
      package_name: "open-insight-cli",
      core_ref: "v0.1.0-alpha.5",
      install_scope: "project",
      model_invoked: false
    });
  });

  it("rejects ambiguous options instead of forwarding arbitrary commands", () => {
    expect(() => parseInstallerArgs(["another-package"])).toThrow(
      "Unknown option"
    );
    expect(() => parseInstallerArgs(["--format", "yaml"])).toThrow(
      "text or json"
    );
    expect(() => parseInstallerArgs(["--agent"])).toThrow(
      "requires a value"
    );
  });
});

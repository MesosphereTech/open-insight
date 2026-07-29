import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  OPEN_INSIGHT_CORE_REF,
  OPEN_INSIGHT_SKILL_SOURCE,
  buildSkillsInstallerArgs,
  createInstallerEnv,
  createInstallerPlan,
  parseInstallerArgs,
  runOpenInsightInstaller
} from "../distribution/open-insight/src/index.mjs";

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
    expect(OPEN_INSIGHT_CORE_REF).toBe("v0.1.0-alpha.3");
    expect(OPEN_INSIGHT_SKILL_SOURCE).toContain(
      "/v0.1.0-alpha.3/skills/open-insight-context"
    );
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
    expect(packageJson.version).toBe("0.1.0-alpha.3");
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.dependencies).toEqual({
      "open-insight-cli": "0.1.0-alpha.3"
    });
    expect(packageJson.bin).toEqual({ "open-insight": "bin/open-insight.mjs" });
    expect(wrapper).toContain(
      'import "open-insight-cli/bin/open-insight.mjs"'
    );
    expect(wrapper).not.toContain("../src/index.mjs");
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
      core_ref: "v0.1.0-alpha.3",
      first_use_auto_bootstrap: true,
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
        env: { PATH: "safe", OPENAI_API_KEY: "model-secret" }
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
        "--agent",
        "codex"
      ])
    );
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
    expect(stdout.join("")).toContain("Open Insight is ready");
    expect(stderr).toEqual([]);
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
      core_ref: "v0.1.0-alpha.3",
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

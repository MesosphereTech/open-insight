import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OPEN_INSIGHT_DEFAULT_CORE_REF } from "../skills/open-insight-context/scripts/core-release.mjs";

describe("standalone Context Skill install", () => {
  it("checks without cloning, installs Core once, then reuses the local install", async () => {
    const overrideCoreRef = "v0.1.0-alpha.999";
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-skill-install-"));
    const consumerRoot = path.join(tempRoot, "普通用户 首次安装");
    const standaloneSkill = path.join(consumerRoot, "open-insight-context");
    const fakeRemote = path.join(tempRoot, "fake-core-remote");
    const installRoot = path.join(tempRoot, "installed-core");
    await mkdir(consumerRoot, { recursive: true });
    await cp(path.resolve("skills/open-insight-context"), standaloneSkill, { recursive: true });
    await mkdir(path.join(fakeRemote, "scripts"), { recursive: true });
    await writeFile(path.join(fakeRemote, "package.json"), JSON.stringify({ name: "open-insight", type: "module" }), "utf8");
    await writeFile(
      path.join(fakeRemote, "scripts", "skill-bootstrap.mjs"),
      [
        'import { mkdir, writeFile } from "node:fs/promises";',
        'import path from "node:path";',
        'const index = process.argv.indexOf("--output-dir");',
        'const outputDir = path.resolve(process.argv[index + 1]);',
        'await mkdir(outputDir, { recursive: true });',
        'await writeFile(path.join(outputDir, "open-insight-skill-bootstrap.json"), JSON.stringify({ status: "ready", model_env_visible: Boolean(process.env.OPEN_INSIGHT_MODEL_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) }), "utf8");',
        'console.log("fixture core bootstrap ready");'
      ].join("\n"),
      "utf8"
    );
    const gitCommand = process.platform === "win32" ? "git.exe" : "git";
    const runGit = (args: string[]) => {
      const result = spawnSync(gitCommand, args, { cwd: fakeRemote, encoding: "utf8" });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      return result.stdout.trim();
    };
    for (const args of [
      ["init"],
      ["config", "user.email", "open-insight-test@example.invalid"],
      ["config", "user.name", "Open Insight Test"],
      ["add", "."],
      ["commit", "-m", "fixture core"]
    ]) {
      runGit(args);
    }
    const pinnedCommit = runGit(["rev-parse", "HEAD"]);
    runGit(["tag", OPEN_INSIGHT_DEFAULT_CORE_REF]);
    await writeFile(path.join(fakeRemote, "release-marker.txt"), "next alpha\n", "utf8");
    runGit(["add", "release-marker.txt"]);
    runGit(["commit", "-m", "next fixture core"]);
    const overrideCommit = runGit(["rev-parse", "HEAD"]);
    runGit(["tag", overrideCoreRef]);

    try {
      const env = {
        ...process.env,
        OPEN_INSIGHT_CORE_HOME: installRoot,
        OPEN_INSIGHT_CORE_REPOSITORY: fakeRemote,
        OPEN_INSIGHT_MODEL_API_KEY: "model-test-should-not-reach-child",
        OPENAI_API_KEY: "openai-test-should-not-reach-child",
        GEMINI_API_KEY: "test-should-not-reach-child",
        FORCE_COLOR: "0",
        NO_COLOR: "1"
      };
      const wrapper = path.join(standaloneSkill, "scripts", "bootstrap.mjs");
      const check = spawnSync(process.execPath, [wrapper, "--check-only"], { cwd: consumerRoot, encoding: "utf8", env });
      expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
      expect(check.stderr).toContain("阶段 1/5：检查 Node.js、npm 和 Git");
      expect(check.stderr).toContain("阶段 3/5：检查模式不执行 Core 下载");
      expect(check.stderr).not.toContain("阶段 3/5：复用已找到的本地 Core");
      const reportPath = path.join(consumerRoot, "output", "open-insight-skill-install.json");
      const before = JSON.parse(await readFile(reportPath, "utf8"));
      expect(before).toMatchObject({
        status: "needs_install",
        mode: "check_only",
        remote_url: "<configured-repository>",
        install_actions: [],
        system_checks: {
          node: { status: "ready", minimum_version: "20.19.0" },
          npm: { status: "ready", minimum_major: 10 },
          git: { status: "ready" },
          core: { status: "not_installed" }
        },
        wrapper_bootstrap: { attempted: false }
      });

      const install = spawnSync(process.execPath, [wrapper], { cwd: consumerRoot, encoding: "utf8", env });
      expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
      expect(install.stdout).toContain("fixture core bootstrap ready");
      expect(install.stderr).toContain(`阶段 3/5：下载固定 Core ${OPEN_INSIGHT_DEFAULT_CORE_REF}`);
      expect(install.stderr).toContain("阶段 5/5：完成：Core、CLI 和 MCP 已就绪");
      const installedText = await readFile(reportPath, "utf8");
      const installed = JSON.parse(installedText);
      expect(installed).toMatchObject({
        status: "ready",
        core_root_source: "git_clone",
        core_commit: pinnedCommit,
        requested_core_ref: OPEN_INSIGHT_DEFAULT_CORE_REF,
        core_ref_source: "default_alpha",
        core_ref_policy: "pinned",
        core_ref_status: "verified",
        core_ref_verified: true,
        resolved_core_commit: pinnedCommit,
        remote_url: "<configured-repository>",
        system_checks: {
          node: { status: "ready" },
          npm: { status: "ready" },
          git: { status: "ready" },
          core: { status: "verified" }
        },
        wrapper_bootstrap: { attempted: true, ok: true, exit_code: 0, core_status: "ready" }
      });
      const innerReport = JSON.parse(
        await readFile(path.join(consumerRoot, "output", ".open-insight-core-bootstrap", "open-insight-skill-bootstrap.json"), "utf8")
      );
      expect(innerReport.model_env_visible).toBe(false);
      expect(installedText).not.toContain(fakeRemote);
      expect(installedText).not.toMatch(/Bearer\s|\bsk-[A-Za-z0-9_-]{16,}/u);

      const repeat = spawnSync(process.execPath, [wrapper, "--check-only"], { cwd: consumerRoot, encoding: "utf8", env });
      expect(repeat.status, `${repeat.stdout}\n${repeat.stderr}`).toBe(0);
      expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({
        status: "ready",
        mode: "check_only",
        core_root_source: "OPEN_INSIGHT_CORE_HOME",
        core_ref_policy: "pinned",
        core_ref_status: "verified",
        core_ref_verified: true,
        install_actions: []
      });

      const mismatch = spawnSync(process.execPath, [wrapper, "--check-only"], {
        cwd: consumerRoot,
        encoding: "utf8",
        env: { ...env, OPEN_INSIGHT_CORE_REF: overrideCoreRef }
      });
      expect(mismatch.status, `${mismatch.stdout}\n${mismatch.stderr}`).toBe(0);
      expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({
        status: "version_mismatch",
        requested_core_ref: overrideCoreRef,
        core_ref_policy: "pinned",
        core_ref_status: "mismatch",
        core_ref_verified: false,
        wrapper_bootstrap: { attempted: false, core_status: "not_run" }
      });

      const overrideConsumer = path.join(tempRoot, "override-consumer");
      const overrideSkill = path.join(overrideConsumer, "open-insight-context");
      const overrideInstallRoot = path.join(tempRoot, "override-core");
      await mkdir(overrideConsumer, { recursive: true });
      await cp(path.resolve("skills/open-insight-context"), overrideSkill, { recursive: true });
      const override = spawnSync(process.execPath, [path.join(overrideSkill, "scripts", "bootstrap.mjs")], {
        cwd: overrideConsumer,
        encoding: "utf8",
        env: {
          ...env,
          OPEN_INSIGHT_CORE_HOME: overrideInstallRoot,
          OPEN_INSIGHT_CORE_REF: overrideCoreRef
        }
      });
      expect(override.status, `${override.stdout}\n${override.stderr}`).toBe(0);
      expect(
        JSON.parse(await readFile(path.join(overrideConsumer, "output", "open-insight-skill-install.json"), "utf8"))
      ).toMatchObject({
        status: "ready",
        core_commit: overrideCommit,
        requested_core_ref: overrideCoreRef,
        core_ref_source: "environment_override",
        core_ref_verified: true
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("auto-bootstraps the pinned Core on the first compile or read without polluting JSON stdout", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-skill-auto-bootstrap-"));
    const autoBootstrapRef = "v0.1.0-alpha.99-auto-bootstrap";
    const fakeRemote = path.join(tempRoot, "fake-core-remote");
    const compileConsumer = path.join(tempRoot, "编译用户");
    const readConsumer = path.join(tempRoot, "读取用户");
    const compileSkill = path.join(compileConsumer, "open-insight-context");
    const readSkill = path.join(readConsumer, "open-insight-context");
    const compileInstallRoot = path.join(tempRoot, "compile-core");
    const readInstallRoot = path.join(tempRoot, "read-core");
    await cp(path.resolve("skills/open-insight-context"), compileSkill, { recursive: true });
    await cp(path.resolve("skills/open-insight-context"), readSkill, { recursive: true });
    await mkdir(path.join(fakeRemote, "scripts"), { recursive: true });
    await mkdir(path.join(fakeRemote, "apps", "cli", "dist"), { recursive: true });
    await mkdir(path.join(fakeRemote, "spec", "schemas"), { recursive: true });
    await writeFile(path.join(fakeRemote, "package.json"), JSON.stringify({ name: "open-insight", type: "module" }), "utf8");
    await writeFile(
      path.join(fakeRemote, "scripts", "skill-bootstrap.mjs"),
      [
        'import { mkdir, writeFile } from "node:fs/promises";',
        'import path from "node:path";',
        'const index = process.argv.indexOf("--output-dir");',
        'const outputDir = path.resolve(process.argv[index + 1]);',
        'await mkdir(outputDir, { recursive: true });',
        'await writeFile(path.join(outputDir, "open-insight-skill-bootstrap.json"), JSON.stringify({ status: "ready" }), "utf8");',
        'console.log("fixture bootstrap ready");'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(fakeRemote, "scripts", "compile-context-folder.mjs"),
      [
        'console.log(JSON.stringify({',
        '  status: "compiled",',
        '  model_env_visible: Boolean(process.env.OPEN_INSIGHT_MODEL_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)',
        '}));'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(fakeRemote, "apps", "cli", "dist", "index.js"),
      [
        'console.log(JSON.stringify({',
        '  status: "ok",',
        '  command: process.argv.slice(2, 4).join(" "),',
        '  model_env_visible: Boolean(process.env.OPEN_INSIGHT_MODEL_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)',
        '}));'
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(fakeRemote, "spec", "schemas", ".keep"), "fixture\n", "utf8");

    const gitCommand = process.platform === "win32" ? "git.exe" : "git";
    const runGit = (args: string[]) => {
      const result = spawnSync(gitCommand, args, { cwd: fakeRemote, encoding: "utf8" });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      return result.stdout.trim();
    };
    for (const args of [
      ["init"],
      ["config", "user.email", "open-insight-test@example.invalid"],
      ["config", "user.name", "Open Insight Test"],
      ["add", "."],
      ["commit", "-m", "fixture one-line Core"],
      ["tag", autoBootstrapRef]
    ]) {
      runGit(args);
    }
    const pinnedCommit = runGit(["rev-parse", "HEAD"]);
    const baseEnv = {
      ...process.env,
      OPEN_INSIGHT_CORE_REPOSITORY: fakeRemote,
      OPEN_INSIGHT_CORE_REF: autoBootstrapRef,
      OPEN_INSIGHT_MODEL_API_KEY: "model-test-should-not-reach-child",
      OPENAI_API_KEY: "openai-test-should-not-reach-child",
      GEMINI_API_KEY: "gemini-test-should-not-reach-child",
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    };

    try {
      const compile = spawnSync(
        process.execPath,
        [path.join(compileSkill, "scripts", "compile-folder.mjs"), "--source-dir", "materials", "--format", "json"],
        {
          cwd: compileConsumer,
          encoding: "utf8",
          env: { ...baseEnv, OPEN_INSIGHT_CORE_HOME: compileInstallRoot }
        }
      );
      expect(compile.status, `${compile.stdout}\n${compile.stderr}`).toBe(0);
      expect(JSON.parse(compile.stdout)).toEqual({
        status: "compiled",
        model_env_visible: false
      });
      expect(compile.stderr).toContain("首次使用：正在准备固定版本的本地 Open Insight Core");
      expect(compile.stderr).toContain("fixture bootstrap ready");
      expect(
        JSON.parse(await readFile(path.join(compileConsumer, "output", "open-insight-skill-install.json"), "utf8"))
      ).toMatchObject({
        status: "ready",
        core_commit: pinnedCommit,
        core_ref_verified: true
      });

      const read = spawnSync(
        process.execPath,
        [
          path.join(readSkill, "scripts", "cli.mjs"),
          "context",
          "summary",
          "context.insight",
          "--format",
          "json"
        ],
        {
          cwd: readConsumer,
          encoding: "utf8",
          env: { ...baseEnv, OPEN_INSIGHT_CORE_HOME: readInstallRoot }
        }
      );
      expect(read.status, `${read.stdout}\n${read.stderr}`).toBe(0);
      expect(JSON.parse(read.stdout)).toEqual({
        status: "ok",
        command: "context summary",
        model_env_visible: false
      });
      expect(read.stderr).toContain("首次使用：正在准备固定版本的本地 Open Insight Core");
      expect(read.stderr).toContain("fixture bootstrap ready");
      expect(
        JSON.parse(await readFile(path.join(readConsumer, "output", "open-insight-skill-install.json"), "utf8"))
      ).toMatchObject({
        status: "ready",
        core_commit: pinnedCommit,
        core_ref_verified: true
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("fails before cloning when npm or Git is unavailable and reports Chinese repair actions", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-skill-prerequisite-"));
    const standaloneSkill = path.join(tempRoot, "open-insight-context");
    await cp(path.resolve("skills/open-insight-context"), standaloneSkill, { recursive: true });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path")
    );

    try {
      const result = spawnSync(process.execPath, [path.join(standaloneSkill, "scripts", "bootstrap.mjs"), "--check-only"], {
        cwd: tempRoot,
        encoding: "utf8",
        env: { ...env, PATH: "", FORCE_COLOR: "0", NO_COLOR: "1" }
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.stderr).toContain("阶段 1/5：检查 Node.js、npm 和 Git");
      const reportText = await readFile(path.join(tempRoot, "output", "open-insight-skill-install.json"), "utf8");
      const report = JSON.parse(reportText);
      expect(report).toMatchObject({
        status: "prerequisite_failed",
        mode: "check_only",
        install_actions: [],
        system_checks: {
          node: { status: "ready", minimum_version: "20.19.0" },
          npm: { status: "missing", version: "unavailable", minimum_major: 10 },
          git: { status: "missing", version: "unavailable" },
          core: { status: "not_checked" }
        },
        wrapper_bootstrap: { attempted: false, core_status: "not_run" }
      });
      expect(report.next_actions).toContain("安装 npm 10 或更高版本，并确认 npm 已加入 PATH。");
      expect(report.next_actions).toContain("安装 Git，并确认 git 已加入 PATH。Bootstrap 需要 Git 下载和校验固定 Core tag。");
      expect(reportText).not.toMatch(/Bearer\s|\bsk-[A-Za-z0-9_-]{16,}/u);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not report ready when the inner check-only report says the Core needs a build", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-skill-check-only-"));
    const consumerRoot = path.join(tempRoot, "普通用户 首次安装");
    const standaloneSkill = path.join(consumerRoot, "open-insight-context");
    const coreRoot = path.join(tempRoot, "incomplete-core");
    await cp(path.resolve("skills/open-insight-context"), standaloneSkill, { recursive: true });
    await mkdir(path.join(coreRoot, "scripts"), { recursive: true });
    await writeFile(path.join(coreRoot, "package.json"), JSON.stringify({ name: "open-insight", type: "module" }), "utf8");
    await writeFile(
      path.join(coreRoot, "scripts", "skill-bootstrap.mjs"),
      [
        'import { mkdir, writeFile } from "node:fs/promises";',
        'import path from "node:path";',
        'const index = process.argv.indexOf("--output-dir");',
        'const outputDir = path.resolve(process.argv[index + 1]);',
        'await mkdir(outputDir, { recursive: true });',
        'await writeFile(path.join(outputDir, "open-insight-skill-bootstrap.json"), JSON.stringify({ status: "needs_build" }), "utf8");'
      ].join("\n"),
      "utf8"
    );

    try {
      const result = spawnSync(process.execPath, [path.join(standaloneSkill, "scripts", "bootstrap.mjs"), "--check-only"], {
        cwd: consumerRoot,
        encoding: "utf8",
        env: { ...process.env, OPEN_INSIGHT_CORE_HOME: coreRoot, FORCE_COLOR: "0", NO_COLOR: "1" }
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const report = JSON.parse(await readFile(path.join(consumerRoot, "output", "open-insight-skill-install.json"), "utf8"));
      expect(report).toMatchObject({
        status: "needs_build",
        mode: "check_only",
        wrapper_bootstrap: { attempted: true, ok: false, core_status: "needs_build" }
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe Core refs before running Git", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-skill-invalid-ref-"));
    const standaloneSkill = path.join(tempRoot, "open-insight-context");
    await cp(path.resolve("skills/open-insight-context"), standaloneSkill, { recursive: true });
    try {
      const result = spawnSync(process.execPath, [path.join(standaloneSkill, "scripts", "bootstrap.mjs")], {
        cwd: tempRoot,
        encoding: "utf8",
        env: { ...process.env, OPEN_INSIGHT_CORE_REF: "../moving-main", FORCE_COLOR: "0", NO_COLOR: "1" }
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("不是安全的 Git tag/branch 名称");
      expect(result.stderr).not.toContain(" at ");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

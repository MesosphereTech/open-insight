import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const compileScript = "skills/open-insight-context/scripts/compile-folder.mjs";
const renderScript = "skills/open-insight-full-document-surface/scripts/render-full-document-html.mjs";
const renderWrapper = "scripts/render.mjs";

async function createPackage(tempRoot: string) {
  const sourceDir = path.join(tempRoot, "source");
  const outputDir = path.join(tempRoot, "output");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "plan.md"), ["# Example Plan", "", "## Overview", "", "The amount is 3000 and the ratio is 85%.", "", "## Terms", "", "| Item | Value |", "| --- | ---: |", "| Receivables | 3000 |"].join("\n"), "utf8");
  const result = spawnSync(process.execPath, [compileScript, "--source-dir", sourceDir, "--output-dir", outputDir, "--base-name", "surface-test", "--parser", "builtin", "--format", "json"], { cwd: repoRoot, encoding: "utf8", timeout: 180_000, env: { ...process.env, OPEN_INSIGHT_CORE_HOME: repoRoot, FORCE_COLOR: "0", NO_COLOR: "1" } });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const report = JSON.parse(result.stdout) as { packages: Array<{ source_mode: string; package_path: string }> };
  const sourceLight = report.packages.find((item) => item.source_mode === "source_light") ?? report.packages[0];
  return { outputDir, packagePath: path.resolve(outputDir, sourceLight.package_path) };
}

describe("Open Insight full-document surface", () => {
  it("runs the installed wrapper from a Chinese path outside the repository", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-surface-reading-"));
    try {
      const { outputDir, packagePath } = await createPackage(tempRoot);
      const installedRoot = path.join(tempRoot, "仓库外 用户", ".agents", "skills");
      await cp(path.join(repoRoot, "skills", "open-insight-context"), path.join(installedRoot, "open-insight-context"), { recursive: true });
      await cp(path.join(repoRoot, "skills", "open-insight-full-document-surface"), path.join(installedRoot, "open-insight-full-document-surface"), { recursive: true });
      const htmlPath = path.join(outputDir, "reading.html");
      const result = spawnSync(process.execPath, [path.join(installedRoot, "open-insight-full-document-surface", renderWrapper), "--package", packagePath, "--output", htmlPath, "--title", "Example Plan", "--surface-view", "reading", "--format", "json"], { cwd: path.dirname(installedRoot), encoding: "utf8", timeout: 180_000, env: { ...process.env, OPEN_INSIGHT_CORE_HOME: repoRoot, FORCE_COLOR: "0", NO_COLOR: "1" } });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        render_strategy: "deterministic_reading_html",
        surface_view: "reading",
        reference_validation: { all_cited_refs_allowed: true },
        safety: { model_invoked: false, base_package_mutation: false }
      });
      const html = await readFile(htmlPath, "utf8");
      expect(html).toContain("Example Plan");
      expect(html).toContain("<table>");
      expect(html).toContain("3000");
      expect(html).not.toContain("parse_diagnostic");
      expect(html).not.toContain("source_refs");
    } finally { await rm(tempRoot, { recursive: true, force: true }); }
  }, 180_000);

  it("uses fake Codex for agent-first static HTML and keeps the package immutable", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-surface-codex-"));
    const fakeBin = path.join(tempRoot, "bin");
    try {
      await mkdir(fakeBin, { recursive: true });
      await writeFile(path.join(fakeBin, "fake-codex.js"), ["process.stdin.resume();", "process.stdin.on('end', () => console.log(JSON.stringify({type:'item.completed',item:{item_type:'assistant_message',text:'<!doctype html><html><head><meta charset=\"utf-8\"></head><body><h1>Example Plan</h1><p>3000 and 85%.</p><table><tr><th>Item</th></tr><tr><td>Receivables</td></tr></table></body></html>'}})));"].join("\n"), "utf8");
      await writeFile(path.join(fakeBin, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.js"\r\n`, "utf8");
      const { outputDir, packagePath } = await createPackage(tempRoot);
      const result = spawnSync(process.execPath, [renderScript, "--package", packagePath, "--output", path.join(outputDir, "agent.html"), "--mode", "agent", "--llm-provider", "codex", "--allow-model", "--format", "json"], { cwd: repoRoot, encoding: "utf8", timeout: 180_000, env: { ...process.env, OPEN_INSIGHT_CORE_HOME: repoRoot, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`, FORCE_COLOR: "0", NO_COLOR: "1" } });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ render_strategy: "agent_first_full_html", safety: { model_invoked: true, base_package_mutation: false } });
    } finally { await rm(tempRoot, { recursive: true, force: true }); }
  }, 180_000);
});

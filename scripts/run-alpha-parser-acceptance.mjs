#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createModelFreeChildEnv } from "../skills/open-insight-context/scripts/child-env.mjs";
import { OPEN_INSIGHT_MARKITDOWN_VERSION } from "../skills/open-insight-context/scripts/parser-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const planOnly = process.argv.includes("--plan-only");
const keepWorkdir = process.argv.includes("--keep-workdir");
const formatIndex = process.argv.indexOf("--format");
const jsonOutput = formatIndex >= 0 && process.argv[formatIndex + 1] === "json";
const gitCommand = process.platform === "win32" ? "git.exe" : "git";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath;
const plannedSteps = [
  "snapshot_current_commit",
  "verify_python_runtime",
  "build_core",
  "generate_public_parser_fixtures",
  "compile_source_bundled_insight",
  "verify_resource_limits",
  "verify_parser_evidence"
];
const fixtureExpectations = [
  {
    name: "经营说明.docx",
    type: "docx",
    expected_text: "Quarterly revenue is 1250000 yuan"
  },
  {
    name: "销售明细.xlsx",
    type: "xlsx",
    expected_text: "1200000",
    expected_formula: {
      sheet_name: "Sales",
      cell_address: "B4",
      formula: "=SUM(B2:B3)",
      cached_value: 2100000,
      cached_value_raw: "2100000"
    }
  },
  {
    name: "文本报告.pdf",
    type: "pdf",
    expected_text: "Total assets are 8600000 yuan"
  }
];

function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/(?:sk)-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1[REDACTED]@");
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 900_000,
    shell: false,
    env: options.env ?? createModelFreeChildEnv({ FORCE_COLOR: "0", NO_COLOR: "1" })
  });
  return {
    ok: !result.error && result.status === 0,
    exit_code: result.status ?? (result.error ? 1 : 0),
    duration_ms: Date.now() - startedAt,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
    error: result.error ? redact(result.error.message) : undefined
  };
}

function publicStep(id, result) {
  const diagnostic = [result.stderr, result.error]
    .map((value) => String(value ?? "").trim())
    .find(Boolean);
  return {
    id,
    status: result.ok ? "passed" : "failed",
    duration_ms: result.duration_ms,
    exit_code: result.exit_code,
    ...(result.ok ? {} : { diagnostic_cn: (diagnostic || "命令失败").slice(-1200) })
  };
}

function runNpm(args, options = {}) {
  return npmCliPath
    ? run(process.execPath, [npmCliPath, ...args], options)
    : run(npmCommand, args, options);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} 没有返回有效 JSON。`);
  }
}

function parseJsonl(value, label) {
  try {
    return value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error(`${label} 没有返回有效 JSONL。`);
  }
}

function checkPythonRuntime(cwd) {
  const pythonCandidates = [process.env.OPEN_INSIGHT_PYTHON, "python", "python3", "py"].filter(
    (candidate, index, values) => typeof candidate === "string" && candidate.trim().length > 0 && values.indexOf(candidate) === index
  );
  let lastResult;

  for (const candidate of pythonCandidates) {
    const result = run(candidate, ["-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"], {
      cwd,
      timeoutMs: 30_000
    });
    lastResult = result;
    const [major, minor] = result.stdout.trim().split(".").map((value) => Number.parseInt(value, 10));
    if (result.ok && (major > 3 || (major === 3 && minor >= 10))) {
      return result;
    }
  }

  return lastResult ?? {
    ok: false,
    exit_code: 1,
    duration_ms: 0,
    stdout: "",
    stderr: "Python 3.10+ not found"
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function archiveText(entries, entryPath) {
  const bytes = entries[entryPath];
  if (!bytes) throw new Error(`生成包缺少 ${entryPath}。`);
  return strFromU8(bytes);
}

function sha256Digest(value) {
  return `sha256-${createHash("sha256").update(value).digest("hex")}`;
}

function uniqueMatch(items, predicate) {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

function rawSourceMetadataFingerprint(sourceId, dataset, fieldCount) {
  return JSON.stringify({
    source_id: sourceId,
    name: dataset.description,
    path: dataset.path,
    type: dataset.format,
    size_bytes: dataset.size_bytes,
    mime_type: dataset.mime_type,
    row_count: dataset.row_count,
    columns: fieldCount > 0 && Array.isArray(dataset.columns)
      ? dataset.columns.map((column) => ({ name: column.name, type: column.type }))
      : undefined
  });
}

function createDocxFixture() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Open Insight Parser Acceptance</w:t></w:r></w:p>
    <w:p><w:r><w:t>Quarterly revenue is 1250000 yuan.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Risk</w:t></w:r></w:p>
    <w:p><w:r><w:t>Delayed collection may affect cash flow.</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRelationships),
    "word/document.xml": strToU8(document)
  });
}

function createXlsxFixture() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:C4"/>
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>region</t></is></c><c r="B1" t="inlineStr"><is><t>revenue</t></is></c><c r="C1" t="inlineStr"><is><t>orders</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>East</t></is></c><c r="B2"><v>1200000</v></c><c r="C2"><v>8</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>West</t></is></c><c r="B3"><v>900000</v></c><c r="C3"><v>5</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>2100000</v></c><c r="C4"><f>SUM(C2:C3)</f><v>13</v></c></row>
  </sheetData>
</worksheet>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRelationships),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships),
    "xl/worksheets/sheet1.xml": strToU8(worksheet)
  });
}

function createTextPdfFixture() {
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 780 Td",
    "(Open Insight Parser Acceptance) Tj",
    "0 -24 Td",
    "(Total assets are 8600000 yuan.) Tj",
    "0 -24 Td",
    "(Risk: customer concentration and delayed payment.) Tj",
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const parts = [Buffer.from("%PDF-1.4\n%OpenInsight\n", "ascii")];
  const offsets = [0];
  let offset = parts[0].length;

  for (const [index, body] of objects.entries()) {
    offsets.push(offset);
    const object = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "ascii");
    parts.push(object);
    offset += object.length;
  }

  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((item) => `${String(item).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF\n"
  ].join("\n");
  parts.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(parts);
}

async function writeReport(report) {
  const outputDir = path.join(repoRoot, "output");
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "alpha-parser-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = [
    "# Open Insight Alpha Parser 验收",
    "",
    `- status: \`${report.status}\``,
    `- source_commit: \`${report.source_commit ?? "not_checked"}\``,
    `- markitdown_version: \`${report.markitdown_version ?? "not_checked"}\``,
    `- source_mode: \`${report.results?.source_mode ?? "not_checked"}\``,
    `- source_count: \`${report.results?.source_count ?? 0}\``,
    `- normalized_content_verified: \`${report.results?.normalized_content_verified ?? false}\``,
    `- raw_content_verified: \`${report.results?.raw_content_verified ?? false}\``,
    `- traceability_verified: \`${report.results?.traceability_verified ?? false}\``,
    `- spreadsheet_formula_verified: \`${report.results?.spreadsheet_formula_verified ?? false}\``,
    `- spreadsheet_formula_count: \`${report.results?.spreadsheet_formula_count ?? 0}\``,
    `- spreadsheet_formula_cli_retrieval_verified: \`${report.results?.spreadsheet_formula_cli_retrieval_verified ?? false}\``,
    `- resource_limits_verified: \`${report.results?.resource_limits_verified ?? false}\``,
    `- source_hash_strategy: \`${report.results?.source_hash_strategy ?? "not_checked"}\``,
    `- package_write_strategy: \`${report.results?.package_write_strategy ?? "not_checked"}\``,
    "",
    "## 步骤",
    "",
    ...(report.steps ?? []).map((step) => `- ${step.id}: \`${step.status}\` (${step.duration_ms} ms)`),
    "",
    "## 安全边界",
    "",
    "- 只使用脚本生成的公开 DOCX、XLSX 和文本型 PDF。",
    "- MarkItDown 使用本地文件转换，不启用插件、云端解析或模型 OCR。",
    "- 不读取私有材料，不转发模型密钥，不写回 base package。"
  ].join("\n");
  await writeFile(path.join(outputDir, "alpha-parser-acceptance.md"), `${markdown}\n`, "utf8");
}

async function main() {
  if (planOnly) {
    const report = {
      schema_version: "open-insight.alpha-parser-acceptance.v0.1",
      status: "planned",
      steps: plannedSteps,
      environment: { outside_repo: true, unicode_space_path: true },
      fixture_capabilities: {
        xlsx_formula_evidence: true,
        xlsx_formula_cell: "Sales!B4",
        xlsx_formula: "=SUM(B2:B3)"
      },
      safety: {
        model_invoked: false,
        plugins_enabled: false,
        cloud_used: false,
        private_materials_read: false,
        base_package_mutation: false
      }
    };
    console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha parser acceptance: ${report.status}`);
    return;
  }

  const sourceCommitResult = run(gitCommand, ["rev-parse", "HEAD"]);
  const worktreeResult = run(gitCommand, ["status", "--porcelain", "--untracked-files=normal"]);
  if (!sourceCommitResult.ok || !worktreeResult.ok || worktreeResult.stdout.trim().length > 0) {
    const report = {
      schema_version: "open-insight.alpha-parser-acceptance.v0.1",
      status: worktreeResult.stdout.trim().length > 0 ? "dirty_worktree" : "failed",
      source_commit: sourceCommitResult.stdout.trim() || undefined,
      steps: [],
      diagnostic_cn: "Parser 验收只验证已提交 commit；请先确认 Git 工作区干净后重试。",
      safety: {
        model_invoked: false,
        plugins_enabled: false,
        cloud_used: false,
        private_materials_read: false,
        base_package_mutation: false
      }
    };
    await writeReport(report);
    console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha parser acceptance: ${report.status}`);
    process.exit(1);
  }

  const sourceCommit = sourceCommitResult.stdout.trim();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "open-insight-alpha-parser-"));
  const releaseSource = path.join(tempRoot, "release-source");
  const consumerRoot = path.join(tempRoot, "普通用户 Parser 验收");
  const materialsDir = path.join(consumerRoot, "中文 Office 与 PDF 材料");
  const outputDir = path.join(consumerRoot, "输出");
  const packagePath = path.join(outputDir, "gate2-parser.source-bundled.insight");
  const steps = [];
  let report;

  try {
    process.stderr.write("[alpha-parser-acceptance] 1/7 创建当前提交快照。\n");
    const snapshot = run(gitCommand, ["clone", "--no-local", "--single-branch", repoRoot, releaseSource], {
      timeoutMs: 300_000
    });
    steps.push(publicStep("snapshot_current_commit", snapshot));
    if (!snapshot.ok) throw new Error(`无法创建当前提交快照。\n${snapshot.stderr}`);
    const snapshotCommit = run(gitCommand, ["rev-parse", "HEAD"], { cwd: releaseSource });
    if (!snapshotCommit.ok || snapshotCommit.stdout.trim() !== sourceCommit) {
      throw new Error("临时快照与当前 commit 不一致。");
    }

    process.stderr.write("[alpha-parser-acceptance] 2/7 检查 Python 3.10+；MarkItDown 由 Skill 自动准备。\n");
    await mkdir(consumerRoot, { recursive: true });
    const python = checkPythonRuntime(consumerRoot);
    steps.push(publicStep("verify_python_runtime", python));
    const markitdownVersion = OPEN_INSIGHT_MARKITDOWN_VERSION;
    if (!python.ok) {
      throw new Error("本机缺少 Python 3.10+；安装 Python 后重试，MarkItDown 将由 Skill 自动准备。");
    }

    process.stderr.write("[alpha-parser-acceptance] 3/7 安装依赖并构建 Core。\n");
    const install = runNpm(["ci", "--ignore-scripts"], {
      cwd: releaseSource,
      timeoutMs: 1_200_000
    });
    const build = install.ok
      ? runNpm(["run", "build:core"], { cwd: releaseSource, timeoutMs: 600_000 })
      : { ...install, ok: false };
    const buildStep = {
      ok: install.ok && build.ok,
      exit_code: install.ok ? build.exit_code : install.exit_code,
      duration_ms: install.duration_ms + (install.ok ? build.duration_ms : 0),
      stdout: `${install.stdout}\n${install.ok ? build.stdout : ""}`,
      stderr: `${install.stderr}\n${install.ok ? build.stderr : ""}`,
      error: install.error ?? build.error
    };
    steps.push(publicStep("build_core", buildStep));
    if (!buildStep.ok) throw new Error(`Core 构建失败。\n${buildStep.stderr || buildStep.error || "未知错误"}`);

    process.stderr.write("[alpha-parser-acceptance] 4/7 生成公开 Office/PDF 样本。\n");
    const fixtureStartedAt = Date.now();
    await mkdir(materialsDir, { recursive: true });
    await writeFile(path.join(materialsDir, "经营说明.docx"), createDocxFixture());
    await writeFile(path.join(materialsDir, "销售明细.xlsx"), createXlsxFixture());
    await writeFile(path.join(materialsDir, "文本报告.pdf"), createTextPdfFixture());
    steps.push({
      id: "generate_public_parser_fixtures",
      status: "passed",
      duration_ms: Date.now() - fixtureStartedAt,
      exit_code: 0
    });

    process.stderr.write("[alpha-parser-acceptance] 5/7 使用默认 auto 编译单文件 .insight。\n");
    const env = createModelFreeChildEnv({
      OPEN_INSIGHT_SKILL_INVOCATION_ROOT: consumerRoot,
      OPEN_INSIGHT_CORE_HOME: releaseSource,
      OPEN_INSIGHT_PARSER_HOME: path.join(tempRoot, "managed-parser-runtime"),
      FORCE_COLOR: "0",
      NO_COLOR: "1"
    });
    const compile = run(
      process.execPath,
      [
        path.join(releaseSource, "skills", "open-insight-context", "scripts", "compile-folder.mjs"),
        "--source-dir",
        materialsDir,
        "--output-dir",
        outputDir,
        "--base-name",
        "gate2-parser",
        "--mode",
        "source_bundled",
        "--parser",
        "auto",
        "--format",
        "json"
      ],
      { cwd: releaseSource, env, timeoutMs: 600_000 }
    );
    steps.push(publicStep("compile_source_bundled_insight", compile));
    if (!compile.ok) throw new Error(`Parser 编译失败。\n${compile.stderr}`);
    const compileReport = parseJson(compile.stdout, "compile report");
    if (
      compileReport.status !== "completed" ||
      compileReport.source_count !== 3 ||
      compileReport.packages?.length !== 1 ||
      !(await exists(packagePath)) ||
      !(await stat(packagePath)).isFile() ||
      (await exists(`${packagePath}.zip`))
    ) {
      throw new Error("编译结果不是包含三个来源的唯一单文件 .insight。");
    }

    process.stderr.write("[alpha-parser-acceptance] 6/7 验证大文件资源上限在 parser 前 fail closed。\n");
    const limitedOutputDir = path.join(consumerRoot, "资源上限输出");
    const limitedPackagePath = path.join(limitedOutputDir, "gate2-parser-limit.source-bundled.insight");
    const resourceLimitCheck = run(
      process.execPath,
      [
        path.join(releaseSource, "scripts", "compile-context-folder.mjs"),
        "--source-dir",
        materialsDir,
        "--output-dir",
        limitedOutputDir,
        "--base-name",
        "gate2-parser-limit",
        "--mode",
        "source_bundled",
        "--parser",
        "auto",
        "--max-source-bytes",
        "64B",
        "--format",
        "json"
      ],
      { cwd: releaseSource, env, timeoutMs: 120_000 }
    );
    const resourceLimitsVerified =
      !resourceLimitCheck.ok &&
      resourceLimitCheck.stderr.includes("SOURCE_SIZE_LIMIT_EXCEEDED") &&
      !(await exists(limitedPackagePath));
    steps.push({
      id: "verify_resource_limits",
      status: resourceLimitsVerified ? "passed" : "failed",
      duration_ms: resourceLimitCheck.duration_ms,
      exit_code: resourceLimitCheck.exit_code,
      ...(resourceLimitsVerified
        ? {}
        : {
            diagnostic_cn:
              (resourceLimitCheck.stderr || resourceLimitCheck.error || "资源上限没有按预期阻断").slice(-1200)
          })
    });
    if (!resourceLimitsVerified) {
      throw new Error("单文件资源上限没有在 parser 前阻断，或阻断后仍残留 .insight 输出。");
    }
    if (
      compileReport.resource_limits?.source_hash_strategy !== "streaming_sha256" ||
      compileReport.resource_limits?.package_write_strategy !== "streaming_zip"
    ) {
      throw new Error("正常编译报告没有披露 streaming_sha256 / streaming_zip 资源策略。");
    }

    process.stderr.write("[alpha-parser-acceptance] 7/7 核查正文、诊断、source map、digest 与索引。\n");
    const verifyStartedAt = Date.now();
    const archive = unzipSync(new Uint8Array(await readFile(packagePath)));
    const diagnostics = parseJsonl(archiveText(archive, "source/parse_diagnostics.jsonl"), "parse diagnostics");
    const sourceMaps = parseJsonl(archiveText(archive, "lineage/source_map.jsonl"), "source map");
    const digests = parseJson(archiveText(archive, "integrity/digests.json"), "digests");
    const sourceMode = parseJson(archiveText(archive, "source/source_mode.json"), "source mode");
    const lineage = parseJson(archiveText(archive, "lineage/sources.json"), "lineage sources");
    const inventory = parseJson(archiveText(archive, "source/inventory.json"), "source inventory");
    const catalog = parseJson(archiveText(archive, "data/catalog.json"), "data catalog");
    const formulaRecords = parseJsonl(
      archiveText(archive, "source/spreadsheet_formulas.jsonl"),
      "spreadsheet formula evidence"
    );
    const queryIndexManifest = parseJson(
      archiveText(archive, "query_index/manifest.json"),
      "query index manifest"
    );
    const normalizedEntries = Object.keys(archive).filter((entry) => entry.startsWith("source/normalized/") && entry.endsWith(".md"));
    const rawEntries = Object.keys(archive).filter((entry) => entry.startsWith("sources/"));
    const parserDiagnostics = diagnostics.filter((item) => item.parser === "markitdown");
    const parserVersions = [...new Set(parserDiagnostics.map((item) => item.parser_version).filter(Boolean))];
    const sourceRecords = Array.isArray(lineage.sources) ? lineage.sources : [];
    const inventoryRecords = Array.isArray(inventory.sources) ? inventory.sources : [];
    const datasets = Array.isArray(catalog.datasets) ? catalog.datasets : [];
    const digestEntries = Array.isArray(digests.entries) ? digests.entries : [];
    const expectedFormula = fixtureExpectations.find((fixture) => fixture.type === "xlsx")?.expected_formula;
    const formulaRecord = expectedFormula
      ? uniqueMatch(
          formulaRecords,
          (item) =>
            item.sheet_name === expectedFormula.sheet_name &&
            item.cell_address === expectedFormula.cell_address &&
            item.formula === expectedFormula.formula
        )
      : undefined;
    const formulaSource = formulaRecord
      ? uniqueMatch(sourceRecords, (item) => item.source_id === formulaRecord.source_id)
      : undefined;
    const formulaDiagnostic = formulaRecord
      ? uniqueMatch(parserDiagnostics, (item) => item.source_id === formulaRecord.source_id)
      : undefined;
    const formulaSourceMap = formulaRecord
      ? uniqueMatch(sourceMaps, (item) => item.source_id === formulaRecord.source_id)
      : undefined;
    const formulaInventory = formulaRecord
      ? uniqueMatch(inventoryRecords, (item) => item.source_id === formulaRecord.source_id)
      : undefined;
    const formulaDigest = uniqueMatch(
      digestEntries,
      (item) =>
        item.target_type === "spreadsheet_formula_evidence" &&
        item.target_ref === "source/spreadsheet_formulas"
    );
    const formulaEvidenceBytes = archive["source/spreadsheet_formulas.jsonl"];
    const formulaNormalizedText =
      typeof formulaDiagnostic?.normalized_source_path === "string" &&
      archive[formulaDiagnostic.normalized_source_path]
        ? strFromU8(archive[formulaDiagnostic.normalized_source_path])
        : "";
    const cliEntry = path.join(releaseSource, "apps", "cli", "dist", "index.js");
    const contextSummary = run(
      process.execPath,
      [cliEntry, "context", "summary", packagePath, "--format", "json"],
      { cwd: releaseSource, env, timeoutMs: 120_000 }
    );
    const contextSummaryReport = contextSummary.ok
      ? parseJson(contextSummary.stdout, "context summary")
      : undefined;
    const formulaSearch = run(
      process.execPath,
      [
        cliEntry,
        "context",
        "search-chunks",
        packagePath,
        "B4 SUM B2 B3 2100000",
        "--limit",
        "10",
        "--format",
        "json"
      ],
      { cwd: releaseSource, env, timeoutMs: 120_000 }
    );
    const formulaSearchReport = formulaSearch.ok
      ? parseJson(formulaSearch.stdout, "formula context search")
      : undefined;
    const perSourceEvidence = await Promise.all(
      fixtureExpectations.map(async (fixture) => {
        const source = uniqueMatch(
          sourceRecords,
          (item) => item.description === fixture.name && item.type === fixture.type
        );
        const sourceId = source?.source_id;
        const dataset = uniqueMatch(datasets, (item) => item.dataset_id === sourceId);
        const diagnostic = uniqueMatch(parserDiagnostics, (item) => item.source_id === sourceId);
        const sourceMap = uniqueMatch(sourceMaps, (item) => item.source_id === sourceId);
        const inventoryRecord = uniqueMatch(inventoryRecords, (item) => item.source_id === sourceId);
        const rawDigest = uniqueMatch(
          digestEntries,
          (item) => item.target_type === "raw_source_metadata" && item.target_ref === sourceId
        );
        const normalizedDigest = uniqueMatch(
          digestEntries,
          (item) => item.target_type === "normalized_source" && item.target_ref === `normalized_source.${sourceId}`
        );
        const rawPath = source?.path;
        const normalizedPath = diagnostic?.normalized_source_path;
        const rawArchiveBytes = typeof rawPath === "string" ? archive[rawPath] : undefined;
        const normalizedArchiveBytes = typeof normalizedPath === "string" ? archive[normalizedPath] : undefined;
        const fixtureBytes = await readFile(path.join(materialsDir, fixture.name));
        const normalizedText = normalizedArchiveBytes ? strFromU8(normalizedArchiveBytes) : "";
        const expectedRawMetadataDigest =
          sourceId && dataset
            ? sha256Digest(rawSourceMetadataFingerprint(sourceId, dataset, inventoryRecord?.field_count ?? 0))
            : undefined;
        const expectedNormalizedDigest = normalizedArchiveBytes ? sha256Digest(normalizedArchiveBytes) : undefined;
        const sourceMapRange = Array.isArray(sourceMap?.ranges)
          ? sourceMap.ranges.find(
              (item) =>
                item.kind === "normalized_markdown_full" &&
                item.path === normalizedPath &&
                item.start_line === 1
            )
          : undefined;
        const expectedDigestIds = [rawDigest?.digest_id, normalizedDigest?.digest_id].filter(Boolean).sort();
        const inventoryDigestIds = Array.isArray(inventoryRecord?.digest_ids)
          ? [...inventoryRecord.digest_ids].sort()
          : [];

        return {
          name: fixture.name,
          source_id: sourceId,
          normalized_content_verified: normalizedText.includes(fixture.expected_text),
          raw_content_verified:
            Boolean(rawArchiveBytes) &&
            rawArchiveBytes.length === fixtureBytes.length &&
            sha256Digest(rawArchiveBytes) === sha256Digest(fixtureBytes),
          traceability_verified:
            Boolean(sourceId && dataset && diagnostic && sourceMap && inventoryRecord && rawDigest && normalizedDigest) &&
            source.path === dataset.path &&
            source.path === diagnostic.source_path &&
            source.path === sourceMap.source_path &&
            source.path === sourceMap.raw_source_path &&
            source.path === inventoryRecord.raw_source_path &&
            diagnostic.status === "ok" &&
            diagnostic.cloud_used === false &&
            diagnostic.parser_version === markitdownVersion &&
            diagnostic.diagnostic_id === sourceMap.parse_diagnostic_id &&
            diagnostic.diagnostic_id === inventoryRecord.parse_diagnostic_id &&
            diagnostic.normalized_source_path === sourceMap.normalized_source_path &&
            diagnostic.normalized_source_path === inventoryRecord.normalized_source_path &&
            sourceMap.source_map_id === inventoryRecord.source_map_id &&
            sourceMap.object_id === `normalized_source.${sourceId}` &&
            Boolean(sourceMapRange) &&
            rawDigest.path === source.path &&
            rawDigest.hash === expectedRawMetadataDigest &&
            rawDigest.verification_level === "metadata_fingerprint" &&
            normalizedDigest.path === normalizedPath &&
            normalizedDigest.hash === expectedNormalizedDigest &&
            normalizedDigest.verification_level === "content_hash" &&
            JSON.stringify(inventoryDigestIds) === JSON.stringify(expectedDigestIds)
        };
      })
    );
    const normalizedContentVerified =
      normalizedEntries.length === fixtureExpectations.length &&
      perSourceEvidence.every((item) => item.normalized_content_verified);
    const rawContentVerified =
      rawEntries.length === fixtureExpectations.length &&
      perSourceEvidence.every((item) => item.raw_content_verified);
    const traceabilityVerified =
      parserDiagnostics.length === fixtureExpectations.length &&
      sourceMaps.length === fixtureExpectations.length &&
      sourceRecords.length === fixtureExpectations.length &&
      inventoryRecords.length === fixtureExpectations.length &&
      datasets.length === fixtureExpectations.length &&
      digestEntries.filter((item) => item.target_type === "raw_source_metadata").length === fixtureExpectations.length &&
      digestEntries.filter((item) => item.target_type === "normalized_source").length === fixtureExpectations.length &&
      perSourceEvidence.every((item) => item.traceability_verified);
    const packageStructureVerified =
      rawEntries.length === fixtureExpectations.length &&
      sourceMode.source_mode === "source_bundled" &&
      Boolean(archive["query_index/chunks.jsonl"]) &&
      Boolean(archive["query_index/index.sqlite"]) &&
      Boolean(archive["query_index/manifest.json"]);
    const formulaRefsVerified =
      Boolean(formulaRecord && formulaSource && formulaDiagnostic && formulaSourceMap && formulaInventory) &&
      JSON.stringify(formulaRecord.source_refs) === JSON.stringify([formulaRecord.source_id]) &&
      JSON.stringify(formulaRecord.lineage_refs) === JSON.stringify([formulaRecord.source_id]) &&
      JSON.stringify(formulaRecord.parse_diagnostic_ids) ===
        JSON.stringify([formulaDiagnostic.diagnostic_id]) &&
      JSON.stringify(formulaRecord.source_map_refs) ===
        JSON.stringify([formulaSourceMap.source_map_id]);
    const formulaDigestVerified =
      Boolean(formulaDigest && formulaEvidenceBytes) &&
      formulaDigest.path === "source/spreadsheet_formulas.jsonl" &&
      formulaDigest.verification_level === "content_hash" &&
      formulaDigest.hash === sha256Digest(formulaEvidenceBytes);
    const spreadsheetFormulaVerified =
      Boolean(expectedFormula && formulaRecord) &&
      formulaRecords.length === 2 &&
      formulaRecord.formula_resolution_status === "resolved" &&
      formulaRecord.cached_value === expectedFormula.cached_value &&
      formulaRecord.cached_value_raw === expectedFormula.cached_value_raw &&
      formulaRecord.cached_value_type === "number" &&
      formulaRecord.calculation_status === "not_evaluated" &&
      formulaDiagnostic.spreadsheet_formula_status === "ok" &&
      formulaDiagnostic.spreadsheet_formula_count === 2 &&
      formulaDiagnostic.spreadsheet_formula_truncated === false &&
      formulaInventory.spreadsheet_formula_path === "source/spreadsheet_formulas.jsonl" &&
      formulaInventory.spreadsheet_formula_count === 2 &&
      formulaInventory.spreadsheet_formula_truncated === false &&
      queryIndexManifest.spreadsheet_formula_path === "source/spreadsheet_formulas.jsonl" &&
      queryIndexManifest.spreadsheet_formula_count === 2 &&
      formulaNormalizedText.includes("## Spreadsheet formula evidence") &&
      formulaNormalizedText.includes(expectedFormula.formula) &&
      formulaNormalizedText.includes(expectedFormula.cached_value_raw) &&
      formulaRefsVerified &&
      formulaDigestVerified;
    const spreadsheetFormulaCliRetrievalVerified =
      contextSummary.ok &&
      contextSummaryReport?.status === "ok" &&
      contextSummaryReport?.query_index?.spreadsheet_formula_available === true &&
      contextSummaryReport?.query_index?.spreadsheet_formula_count === 2 &&
      contextSummaryReport?.query_index?.sqlite_table_counts?.spreadsheet_formulas === 2 &&
      formulaSearch.ok &&
      formulaSearchReport?.status === "ok" &&
      Array.isArray(formulaSearchReport.matches) &&
      formulaSearchReport.matches.some(
        (match) =>
          String(match.text ?? "").includes(expectedFormula?.formula ?? "__missing_formula__") &&
          Array.isArray(match.source_refs) &&
          match.source_refs.includes(formulaRecord?.source_id) &&
          Array.isArray(match.lineage_refs) &&
          match.lineage_refs.includes(formulaRecord?.source_id) &&
          Array.isArray(match.parse_diagnostic_ids) &&
          match.parse_diagnostic_ids.includes(formulaDiagnostic?.diagnostic_id) &&
          Array.isArray(match.source_map_refs) &&
          match.source_map_refs.includes(formulaSourceMap?.source_map_id)
      );

    if (!normalizedContentVerified) throw new Error("MarkItDown normalized source 缺少预期正文或表格值。");
    if (!rawContentVerified) throw new Error("source_bundled 中的 raw source 与公开验收材料不一致。");
    if (!traceabilityVerified) throw new Error("Parser 版本、诊断、source map 或 digest 没有形成完整追溯链。");
    if (!packageStructureVerified) throw new Error("source_bundled 原文件或 query index 不完整。");
    if (!spreadsheetFormulaVerified) {
      throw new Error("公开 XLSX 的公式 sidecar、normalized 附录、digest 或追溯引用不完整。");
    }
    if (!spreadsheetFormulaCliRetrievalVerified) {
      throw new Error("公开 XLSX 公式没有进入 SQLite 索引，或 CLI 未返回完整公式引用。");
    }
    steps.push({
      id: "verify_parser_evidence",
      status: "passed",
      duration_ms: Date.now() - verifyStartedAt,
      exit_code: 0
    });

    report = {
      schema_version: "open-insight.alpha-parser-acceptance.v0.1",
      status: "passed",
      source_commit: sourceCommit,
      markitdown_version: markitdownVersion,
      environment: {
        outside_repo: true,
        unicode_space_path: true,
        working_tree_clean: true,
        temporary_install_cleaned: !keepWorkdir
      },
      steps,
      results: {
        source_mode: sourceMode.source_mode,
        source_count: 3,
        source_types: parserDiagnostics.map((item) => item.source_type).sort(),
        parser_versions: parserVersions,
        raw_source_count: rawEntries.length,
        normalized_source_count: normalizedEntries.length,
        parse_diagnostic_count: parserDiagnostics.length,
        source_map_count: sourceMaps.length,
        digest_count: digests.entries?.length ?? 0,
        query_index_available: true,
        normalized_content_verified: normalizedContentVerified,
        raw_content_verified: rawContentVerified,
        traceability_verified: traceabilityVerified,
        spreadsheet_formula_verified: spreadsheetFormulaVerified,
        spreadsheet_formula_count: formulaRecords.length,
        spreadsheet_formula_cli_retrieval_verified: spreadsheetFormulaCliRetrievalVerified,
        spreadsheet_formula_example: {
          sheet_name: formulaRecord.sheet_name,
          cell_address: formulaRecord.cell_address,
          formula: formulaRecord.formula,
          cached_value: formulaRecord.cached_value,
          calculation_status: formulaRecord.calculation_status
        },
        per_source_evidence: perSourceEvidence,
        resource_limits_verified: resourceLimitsVerified,
        source_hash_strategy: compileReport.resource_limits.source_hash_strategy,
        package_write_strategy: compileReport.resource_limits.package_write_strategy,
        single_file_insight: true
      },
      safety: {
        model_invoked: false,
        model_env_forwarded: false,
        plugins_enabled: false,
        cloud_used: false,
        private_materials_read: false,
        base_package_mutation: false
      }
    };
  } catch (error) {
    report = {
      schema_version: "open-insight.alpha-parser-acceptance.v0.1",
      status: "failed",
      source_commit: sourceCommit,
      steps,
      diagnostic_cn: redact(error instanceof Error ? error.message : String(error)),
      safety: {
        model_invoked: false,
        model_env_forwarded: false,
        plugins_enabled: false,
        cloud_used: false,
        private_materials_read: false,
        base_package_mutation: false
      }
    };
  } finally {
    if (!keepWorkdir) {
      await rm(tempRoot, { recursive: true, force: true });
    } else if (report) {
      report.workdir = tempRoot;
    }
  }

  await writeReport(report);
  console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Open Insight Alpha parser acceptance: ${report.status}`);
  if (report.status !== "passed") process.exit(1);
}

await main();

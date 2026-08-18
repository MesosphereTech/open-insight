#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEXT_FILE_RE = /\.(json|jsonl|md|markdown|txt|csv|tsv)$/i;
const TRACE_FIELDS = ["source_refs", "lineage_refs", "parse_diagnostic_ids", "source_map_refs"];

function collectReferenceStrings(value, values) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceStrings(item, values);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectReferenceStrings(item, values);
  } else if (typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(value)) values.add(value);
}

function collectReferenceValues(value, field, values = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceValues(item, field, values);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === field) collectReferenceStrings(item, values);
      else if (item && typeof item === "object") collectReferenceValues(item, field, values);
    }
  }
  return values;
}

function buildAllowedReferences(values) {
  return Object.fromEntries(
    TRACE_FIELDS.map((field) => [field, [...collectReferenceValues(values, field)].sort()])
  );
}

function validateReferenceObjectUsage(value, allowedReferences) {
  const cited = Object.fromEntries(TRACE_FIELDS.map((field) => [field, [...collectReferenceValues(value, field)].sort()]));
  const unknownRefs = Object.fromEntries(
    TRACE_FIELDS.map((field) => [field, cited[field].filter((reference) => !allowedReferences[field].includes(reference))])
  );
  return {
    cited_refs: cited,
    unknown_refs: unknownRefs,
    all_cited_refs_allowed: Object.values(unknownRefs).every((references) => references.length === 0)
  };
}

function usage() {
  return [
    "Usage:",
    "  node render-full-document-html.mjs --package <file.insight> --output <document.html>",
    "",
    "Options:",
    "  --title <title>",
    "  --core-home <dir>         Defaults to OPEN_INSIGHT_CORE_HOME or upward discovery.",
    "  --mode reading|agent      Defaults to reading. agent uses an explicitly enabled local LLM.",
    "  --surface-view reading|audit",
    "  --llm-provider none|codex|gemini",
    "  --allow-model             Required before a local LLM is invoked.",
    "  --agent-model <model>     Optional local model name.",
    "  --gemini-model <model>    Optional Gemini model name.",
    "  --source-match <text>     Limit rendering to matching normalized sources.",
    "  --report <file>           Defaults to <output>.render.json.",
    "  --sidecar <file>          Optional traceability sidecar JSON.",
    "  --format json|text        Defaults to json."
  ].join("\n");
}

function parseArgs(argv) {
  const options = { mode: "reading", surfaceView: "reading", llmProvider: "none", format: "json", allowModel: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} is missing a value.`);
      index += 1;
      return value;
    };
    if (arg === "--package") options.packagePath = next();
    else if (arg === "--output") options.outputPath = next();
    else if (arg === "--title") options.title = next();
    else if (arg === "--core-home") options.coreHome = next();
    else if (arg === "--mode") options.mode = next();
    else if (arg === "--surface-view") options.surfaceView = next();
    else if (arg === "--llm-provider") options.llmProvider = next();
    else if (arg === "--allow-model") options.allowModel = true;
    else if (arg === "--agent-model") options.agentModel = next();
    else if (arg === "--gemini-model") options.geminiModel = next();
    else if (arg === "--source-match") options.sourceMatch = next();
    else if (arg === "--report") options.reportPath = next();
    else if (arg === "--sidecar") options.sidecarPath = next();
    else if (arg === "--format") options.format = next();
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.packagePath || !options.outputPath) throw new Error("--package and --output are required.");
  if (!["reading", "agent"].includes(options.mode)) throw new Error("--mode must be reading or agent.");
  if (!["reading", "audit"].includes(options.surfaceView)) throw new Error("--surface-view must be reading or audit.");
  if (!["none", "codex", "gemini"].includes(options.llmProvider)) throw new Error("--llm-provider must be none, codex, or gemini.");
  if (!["json", "text"].includes(options.format)) throw new Error("--format must be json or text.");
  if (options.mode === "agent" && options.llmProvider === "none") throw new Error("--mode agent requires --llm-provider codex or gemini.");
  if (options.llmProvider !== "none" && !options.allowModel) throw new Error("--allow-model is required before invoking a local LLM.");
  return options;
}

async function findCoreHome(explicit) {
  for (const candidate of [explicit, process.env.OPEN_INSIGHT_CORE_HOME, process.cwd(), path.resolve(SCRIPT_DIR, "../../..")] .filter(Boolean)) {
    let current = path.resolve(candidate);
    while (true) {
      if (existsSync(path.join(current, "apps", "cli", "dist", "index.js"))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error("Cannot find Open Insight Core. Set OPEN_INSIGHT_CORE_HOME or pass --core-home.");
}

function runCli(coreHome, args) {
  const cliEntry = path.join(coreHome, "apps", "cli", "dist", "index.js");
  const result = spawnSync(process.execPath, [cliEntry, ...args], { cwd: coreHome, encoding: "utf8", timeout: 120_000, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  if (result.status !== 0) throw new Error(`Open Insight CLI failed: ${result.stderr || result.stdout}`);
  const output = result.stdout.trim();
  return JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
}

function archivePath(value) { return String(value ?? "").replace(/\\/g, "/"); }
function safeArchivePath(value) { return value && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split("/").includes(".."); }

async function readPackageFiles(packagePath, coreHome) {
  const files = new Map();
  const info = await stat(packagePath);
  if (info.isDirectory()) {
    async function visit(root, current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) await visit(root, absolute);
        else if (entry.isFile()) {
          const relative = archivePath(path.relative(root, absolute));
          if (TEXT_FILE_RE.test(relative)) files.set(relative, await readFile(absolute, "utf8"));
        }
      }
    }
    await visit(packagePath, packagePath);
    return files;
  }
  const requireFromCore = createRequire(path.join(coreHome, "package.json"));
  const { strFromU8, unzipSync } = requireFromCore("fflate");
  for (const [name, data] of Object.entries(unzipSync(await readFile(packagePath)))) {
    const relative = archivePath(name);
    if (!safeArchivePath(relative)) throw new Error(`Unsafe path inside .insight archive: ${name}`);
    if (TEXT_FILE_RE.test(relative)) files.set(relative, strFromU8(data));
  }
  return files;
}

function json(files, relativePath, fallback) {
  const value = files.get(relativePath);
  return value ? JSON.parse(value) : fallback;
}
function jsonl(files, relativePath) {
  return String(files.get(relativePath) ?? "").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function slug(value, fallback) { return String(value ?? fallback).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || fallback; }
function refValues(value) { return Array.isArray(value) ? value.map(String) : value ? [String(value)] : []; }

function normalizedDocuments(files, sourceMatch) {
  const match = sourceMatch?.trim().toLowerCase();
  return [...files.entries()]
    .filter(([name]) => name.startsWith("source/normalized/") && /\.m(?:d|arkdown)$/i.test(name))
    .map(([pathName, text], index) => {
      const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      return { document_id: `document_${index + 1}`, path: pathName, title: heading || path.basename(pathName).replace(/\.m(?:d|arkdown)$/i, ""), text };
    })
    .filter((document) => !match || `${document.path} ${document.title}`.toLowerCase().includes(match));
}

function extractSections(document, trace) {
  const lines = document.text.replace(/\r/g, "").split("\n");
  const sections = [];
  let current = { heading: document.title, level: 1, lines: [] };
  const push = () => {
    const text = current.lines.join("\n").trim();
    if (text) sections.push({ ...current, text, id: `${document.document_id}-${slug(current.heading, `section-${sections.length + 1}`)}`, document });
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { push(); current = { heading: heading[2].trim(), level: heading[1].length, lines: [] }; }
    else current.lines.push(line);
  }
  push();
  return sections.map((section) => ({ ...section, ...trace(section.document.path) }));
}

function markdownTable(lines) {
  const rows = lines.filter((line) => line.includes("|")).map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  if (rows.length < 3 || !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const headers = rows[0];
  const body = rows.slice(2).filter((row) => row.length === headers.length && row.some(Boolean));
  if (!headers.every(Boolean) || !body.length) return null;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) { index += 1; continue; }
    if (lines[index].includes("|") && lines[index + 1]?.includes("|")) {
      const tableLines = [];
      while (index < lines.length && lines[index].includes("|")) tableLines.push(lines[index++]);
      const rendered = markdownTable(tableLines);
      blocks.push(rendered ?? `<blockquote>${escapeHtml(tableLines.join("\n")).replace(/\n/g, "<br />")}</blockquote>`);
      continue;
    }
    if (/^[-*+]\s+/.test(lines[index])) {
      const items = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^[-*+]\s+/, ""));
      blocks.push(`<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !lines[index].includes("|") && !/^[-*+]\s+/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(`<p>${escapeHtml(paragraph.join(" "))}</p>`);
  }
  return blocks.join("\n");
}

function buildStaticHtml({ title, sections, view }) {
  const toc = sections.map((section) => `<li class="level-${Math.min(section.level, 3)}"><a href="#${escapeHtml(section.id)}">${escapeHtml(section.heading)}</a></li>`).join("");
  const body = sections.map((section) => `<section id="${escapeHtml(section.id)}"><h${Math.min(section.level + 1, 4)}>${escapeHtml(section.heading)}</h${Math.min(section.level + 1, 4)}>${renderMarkdown(section.text)}${view === "audit" ? `<footer>来源：${escapeHtml(section.source_refs.join(", ") || "未标注")}</footer>` : ""}</section>`).join("\n");
  const audit = view === "audit" ? `<aside><h2>审计信息</h2><p>本页保留来源引用与解析线索；阅读视图不显示这些工程信息。</p></aside>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#eee9df;color:#24211d;font:18px/1.85 Georgia,"Noto Serif SC","Songti SC",serif}.page{max-width:920px;margin:32px auto;background:#fffdf8;padding:70px 78px;box-shadow:0 18px 56px #0002}h1,h2,h3,h4{color:#183b63;line-height:1.35}h1{font-size:42px;margin:0 0 40px}h2{font-size:28px;margin-top:54px}h3{font-size:23px;margin-top:38px}nav{border-top:1px solid #d8cfbf;border-bottom:1px solid #d8cfbf;padding:20px 0;margin:34px 0}nav ol{margin:0;padding-left:24px}.level-2{margin-left:16px}.level-3{margin-left:32px}a{color:#183b63;text-decoration:none}table{width:100%;border-collapse:collapse;margin:20px 0;font-size:16px}th,td{border:1px solid #d8cfbf;padding:10px;vertical-align:top}th{background:#f3ede1;color:#183b63}.table-wrap{overflow:auto}blockquote{margin:20px 0;padding:14px 18px;background:#f8f4ec;border-left:3px solid #c5b79e}footer,aside{font:13px/1.6 Arial,sans-serif;color:#655f56;border-top:1px solid #d8cfbf;padding-top:12px;margin-top:26px}@media(max-width:700px){.page{margin:0;padding:36px 24px}h1{font-size:32px}}</style></head><body><main class="page" data-open-insight-surface-view="${view}"><header><h1>${escapeHtml(title)}</h1></header><nav aria-label="目录"><ol>${toc}</ol></nav>${audit}${body}</main></body></html>`;
}

function extractHtml(text) {
  const candidate = String(text ?? "").match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1] ?? String(text ?? "");
  const start = candidate.search(/<!doctype html|<html[\s>]/i);
  const end = candidate.toLowerCase().lastIndexOf("</html>");
  return start >= 0 && end >= start ? candidate.slice(start, end + 7).trim() : null;
}

function invokeAgent(prompt, options, cwd) {
  const isCodex = options.llmProvider === "codex";
  const modelArgs = isCodex ? ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only"] : ["--output-format", "text", "--prompt", "Render a complete static HTML document from stdin. Output only HTML."];
  const model = isCodex ? options.agentModel : options.geminiModel;
  if (model) modelArgs.push("--model", model);
  const command = process.platform === "win32" && isCodex ? "cmd.exe" : options.llmProvider;
  const args = process.platform === "win32" && isCodex ? ["/d", "/c", "codex.cmd", ...modelArgs] : modelArgs;
  const result = spawnSync(command, args, { cwd, input: prompt, encoding: "utf8", timeout: 180_000, shell: false, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const stdout = isCodex ? String(result.stdout).split(/\r?\n/).map((line) => { try { const event = JSON.parse(line); return event?.item?.text ?? event?.text ?? ""; } catch { return line; } }).join("\n") : result.stdout;
  return { html: result.status === 0 ? extractHtml(stdout) : null, diagnostic: String(result.stderr ?? "").slice(0, 1000) };
}

function validateAgentHtml(html) {
  const failures = [];
  if (!html) failures.push("complete_html_required");
  if (/<script\b/i.test(html ?? "")) failures.push("script_tag_forbidden");
  if (/\b(fetch|XMLHttpRequest)\s*\(/i.test(html ?? "")) failures.push("runtime_fetch_forbidden");
  if (/type=["']application\/json/i.test(html ?? "")) failures.push("embedded_machine_json_forbidden");
  return { ok: failures.length === 0, failures };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const coreHome = await findCoreHome(options.coreHome);
  const packagePath = path.resolve(options.packagePath);
  const outputPath = path.resolve(options.outputPath);
  const reportPath = path.resolve(options.reportPath ?? outputPath.replace(/\.html?$/i, "") + ".render.json");
  const files = await readPackageFiles(packagePath, coreHome);
  const summary = runCli(coreHome, ["context", "summary", packagePath, "--format", "json"]);
  const diagnostics = jsonl(files, "source/parse_diagnostics.jsonl");
  const sourceMaps = jsonl(files, "lineage/source_map.jsonl");
  const chunks = jsonl(files, "query_index/chunks.jsonl");
  const documents = normalizedDocuments(files, options.sourceMatch);
  if (!documents.length) throw new Error("No matching normalized Markdown source was found in this .insight package.");
  const trace = (sourcePath) => {
    const sourceId = path.basename(sourcePath).replace(/\.m(?:d|arkdown)$/i, "");
    const related = [...diagnostics, ...sourceMaps, ...chunks].filter((row) => JSON.stringify(row).includes(sourceId));
    return Object.fromEntries(
      TRACE_FIELDS.map((field) => [field, [...new Set(related.flatMap((row) => refValues(row[field])))]])
    );
  };
  const sections = documents.flatMap((document) => extractSections(document, trace));
  const title = options.title ?? summary.title ?? documents[0].title;
  const sourcePayload = documents.map((document) => `# ${document.title}\n\n${document.text}`).join("\n\n");
  const prompt = ["Create one complete static HTML reading document.", "Use only the supplied source text. Preserve source order, headings, paragraphs, lists, numbers, and reliable tables.", "Do not summarize, invent facts, add scripts, fetch files, embed JSON, or mention internal tooling.", "Return only <!doctype html>... </html>.", "", "SOURCE TEXT", sourcePayload].join("\n");
  let html;
  let validation = { ok: true, failures: [] };
  if (options.mode === "agent") {
    const result = invokeAgent(prompt, options, coreHome);
    validation = validateAgentHtml(result.html);
    if (!validation.ok) throw new Error(`Agent HTML rejected: ${validation.failures.join(", ")}. ${result.diagnostic}`);
    html = result.html;
  } else html = buildStaticHtml({ title, sections, view: options.surfaceView });
  const allowedReferences = buildAllowedReferences([diagnostics, sourceMaps, chunks]);
  const referenceValidation = validateReferenceObjectUsage({ sections }, allowedReferences, { requiredFields: [] });
  const sidecar = { schema_version: "open-insight.full-document-surface-sidecar.v0.1", package_id: summary.package_id, source_mode: summary.source_mode, documents: documents.map(({ text, ...document }) => document), sections: sections.map(({ text, document, ...section }) => section), diagnostics, source_maps: sourceMaps, safety: { base_package_mutation: false, review_status: "needs_review" } };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  if (options.sidecarPath) { await mkdir(path.dirname(path.resolve(options.sidecarPath)), { recursive: true }); await writeFile(path.resolve(options.sidecarPath), `${JSON.stringify(sidecar, null, 2)}\n`, "utf8"); }
  const report = { schema_version: "open-insight.full-document-html-render.v0.1", status: "completed", render_strategy: options.mode === "agent" ? "agent_first_full_html" : "deterministic_reading_html", surface_view: options.surfaceView, package_id: summary.package_id, source_mode: summary.source_mode, normalized_source_count: documents.length, section_count: sections.length, parse_diagnostic_count: diagnostics.length, source_map_count: sourceMaps.length, output_path: outputPath, core_home: coreHome, validation, allowed_references: allowedReferences, reference_validation: referenceValidation, safety: { model_invoked: options.mode === "agent", browser_model_key_required: false, base_package_mutation: false, package_code_execution: false, auto_verified: false, review_status: "needs_review" } };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (options.format === "json") console.log(JSON.stringify(report, null, 2));
  else console.log(`HTML generated: ${outputPath}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });

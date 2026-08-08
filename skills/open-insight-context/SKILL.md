---
name: open-insight-context
description: Compile a local collection of Word, PDF, Excel, PowerPoint, Markdown, HTML, CSV, and text files into one .insight context library, then expose traceable read-only context to Codex, Gemini, Claude, and other agents through CLI or MCP. Use when a user asks to install Open Insight, package local information, read an .insight file, start the Open Insight MCP server, or retrieve source-backed context.
---

# Open Insight Context

Open Insight turns a local information collection into one portable `.insight`
context library. The collection may be work material, research, learning
content, technical documentation, structured data, a personal archive, or an
agent handoff snapshot. It gives external AI agents bounded, traceable context
through CLI or MCP. It does not answer a fixed set of questions and does not
write generated reports, HTML, Word, PDF, or slides back into the base package.

Chinese guide: [`SKILL.zh-CN.md`](SKILL.zh-CN.md)

## When to use this Skill

Use this Skill when a user needs to reuse a collection of local information
with one or more AI agents, especially when they want to avoid re-uploading
every source, limit context to the current question, or preserve source trace.

The user-facing workflow is:

```text
information collection -> one .insight -> bounded context -> the user's AI output
```

Explain that Open Insight prepares evidence and context; it is not another chat application
and does not generate the final answer by itself. The AI client
must be able to call this Skill, the local CLI, or the MCP server. Do not imply
that every chat website can open an `.insight` file directly.

Good trigger examples:

- "Package these local files so I can use them with different AI tools."
- "Turn this research library into one traceable context file."
- "Prepare a context snapshot that another agent can continue from."
- "Use this `.insight` file to answer my question and cite the source files."
- "Give my agent only the relevant context instead of loading every document."
- "Start a read-only MCP server for this `.insight` file."

## Safety defaults

- Work locally unless the user explicitly enables an external parser.
- Do not upload source files.
- Do not execute code stored inside an `.insight` package.
- Do not read, display, or store model API keys.
- Do not mutate the base package when generating an answer or document.
- Never mark AI output as `verified`.
- Treat SQLite/FTS as a rebuildable index, not the only source of truth.

## 1. Install once, then use it

The complete Skill directory is required. A standalone `SKILL.md` without the
adjacent `scripts/` directory cannot bootstrap, compile, or read packages.

Install the fixed Alpha Skill with one command:

```bash
npx @mesospheretech/open-insight
```

The equivalent short command is `npx open-insight-cli`.

The branded installer pins the generic Skill installer and immutable
`v0.1.0-alpha.4` Skill source internally. The user does not need to copy a
GitHub tree URL. The installer asks which supported AI client should receive
the Skill. The npm package and Core repository remain private candidates until
release approval; after publication, this command must work without repository
credentials.

Requirements:

- Node.js 20.19+ on Node 20, or Node.js 22.12+
- npm 10+
- Git

After Skill installation, do not ask an ordinary user to run bootstrap.
Invoke `compile-folder.mjs` or `cli.mjs` for the requested task. On first use,
the wrapper automatically downloads the immutable Core ref to
`~/.open-insight/core/<version>`, verifies the resolved commit, installs its
dependencies, and builds CLI/MCP. First-use progress goes to stderr; JSON stdout remains
machine-readable throughout setup. It does not install or call an AI model.

Manual checks are only for troubleshooting:

```bash
node "<skill-root>/scripts/bootstrap.mjs" --check-only
node "<skill-root>/scripts/bootstrap.mjs"
```

Set `OPEN_INSIGHT_AUTO_BOOTSTRAP=0` only when an administrator intentionally
manages Core installation. A missing Core then fails with a repair instruction
instead of silently using another version.

When `--parser auto` encounters PDF, DOCX, XLSX, or PPTX, the Skill
automatically creates an isolated parser runtime under
`~/.open-insight/parsers/` and installs the pinned MarkItDown version there.
The user does not run `pip install`. Simple text, Markdown, HTML, and CSV
sources do not trigger this setup. Python 3.10+ must be available; a missing
Python runtime produces a repair instruction instead of a partial success.

Set `OPEN_INSIGHT_AUTO_INSTALL_PARSER=0` only when an administrator manages
the parser runtime. `OPEN_INSIGHT_PYTHON` may point to an already managed
Python environment; Open Insight verifies it but never modifies it.

Open Insight uses MarkItDown locally with plugins disabled by default. Azure
conversion and model OCR are never selected automatically.

## 2. Compile one folder into one file

Run from the user's own working directory. Relative source and output paths are
resolved from that directory, not from the Core checkout.

```bash
node "<skill-root>/scripts/compile-folder.mjs" \
  --source-dir ./materials \
  --output-dir ./output \
  --base-name my-context \
  --mode source_bundled \
  --parser auto \
  --parser-timeout-ms 300000 \
  --source-analysis-cache-dir ./output/.open-insight-cache \
  --progress
```

Modes:

- `source_bundled`: includes original files and normalized content; use for
  local audit and restoration.
- `source_light`: excludes original binaries but keeps normalized content,
  fingerprints, diagnostics, and the reduced evidence boundary.
- `both`: generates one file for each mode.

The deliverable is a real single `.insight` file. Do not expose a `.zip`
suffix and do not use a directory named `*.insight` as the result.

Unknown or unsupported files remain in the source inventory with explicit
diagnostics. Never describe metadata-only extraction as complete text.

## 3. Read for a specific question

For ordinary questions, start with `answer-context`. Do not read every source,
run a full audit, or inject all normalized text by default.

```bash
node "<skill-root>/scripts/cli.mjs" context answer-context \
  ./output/my-context.source-bundled.insight \
  --query "the user's question" \
  --token-budget 2000 \
  --max-follow-up-reads 8 \
  --format json
```

If the question names a document:

1. run `list-sources`;
2. match the filename to a `source_id`;
3. rerun `answer-context` with one or more `--document-id` values.

```bash
node "<skill-root>/scripts/cli.mjs" context list-sources \
  ./output/my-context.source-bundled.insight --format json

node "<skill-root>/scripts/cli.mjs" context answer-context \
  ./output/my-context.source-bundled.insight \
  --query "the user's question" \
  --document-id <matched-source-id> \
  --token-budget 2000 \
  --max-follow-up-reads 12 \
  --format json
```

Only follow `unresolved_reads` or `next_fragment_reads` when the handoff says
more context is required. Use `resolve-source` to retrieve a bounded source
window:

```bash
node "<skill-root>/scripts/cli.mjs" context resolve-source \
  ./output/my-context.source-bundled.insight \
  <chunk-or-source-id> \
  --format json
```

For browsing or audit, use:

```bash
node "<skill-root>/scripts/cli.mjs" context summary <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" context diagnostics <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" context search-chunks <package.insight> "query" --compact --format json
```

If the result is `degraded`, `unsupported`, `needs_more_context`, or
`audit_required`, disclose that boundary. Do not turn an empty or weak context
into a confident answer.

## 4. Start read-only MCP

```bash
node "<skill-root>/scripts/cli.mjs" mcp serve \
  ./output/my-context.source-bundled.insight \
  --transport stdio
```

Recommended minimum tools:

- `open_insight_context_summary`
- `open_insight_list_sources`
- `open_insight_validate_context`
- `open_insight_answer_context`
- `open_insight_resolve_source`

CLI and MCP use the same read-only Runtime. MCP does not call a model, execute
package code, or mutate the package.

## 5. Citation boundary

An external AI may cite only IDs returned by the current tool result:

- `source_refs`
- `lineage_refs`
- `parse_diagnostic_ids`
- `source_map_refs`

Reject or disclose unknown IDs. A `source_light` package may carry all text
successfully extracted by the parser, but it does not contain the original
binary evidence.

## 6. Resource and OCR controls

Large-file controls:

- `--parser-timeout-ms`
- `--max-source-bytes`
- `--max-total-source-bytes`
- `--max-normalized-bytes`
- `--max-total-normalized-bytes`
- `--source-analysis-cache-dir`
- `--progress`

Hashes and package output are streamed. A single parser conversion may still
need memory proportional to that source. Resource-limit failures must stop
honestly; do not truncate silently.

Scanning and image-only PDF require a separate, explicit experimental OCR
path. The Skill may automatically install the pinned `markitdown-ocr` plugin
inside its isolated parser runtime, but only after the user selects
`--parser markitdown --ocr llm`. It never invents an endpoint, model, key, or
data-transfer consent. The user must configure the dedicated
`OPEN_INSIGHT_OCR_*` variables and accept the boundary before execution.
Model OCR remains normalized, review-required content and must record parser,
plugin, model, cloud use, confidence, and warnings.

## 7. Spreadsheet formula fidelity

Open Insight preserves spreadsheet formula evidence in
`context_spreadsheet_formulas` and the SQLite `spreadsheet_formulas` index.
Formula records may include the original formula text and `cached_value_raw`,
but Core does not recalculate workbooks. Treat
`formula_resolution_status=not_evaluated` as an explicit boundary.

Ask formula questions through the same bounded context path:

```bash
node "<skill-root>/scripts/cli.mjs" context answer-context \
  ./output/my-context.source-bundled.insight \
  --query "What are the formula and cached value in cell C12 of the budget sheet?" \
  --token-budget 2000 \
  --format json
```

A `source_light` package may preserve normalized formula evidence, but it does
not contain the raw workbook. Use `source_bundled` when the original workbook
must remain available for audit.

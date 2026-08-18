# Open Insight

## Stop making every AI reread the same files.

**Prepare information once. Use it with any AI.**

Open Insight compiles documents, spreadsheets, presentations, web exports,
technical material, and notes into one local, traceable `.insight` portable context
file that compatible AI agents can search, cite, verify, and reuse.

**One File, Any AI.** We call this **Portable AI Context**.

Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

<p align="center">
  <img
    src="docs/public/assets/open-insight-alpha-validation.gif"
    alt="Open Insight turns nine mixed source files into one traceable context file, then returns smaller query-scoped context through CLI and MCP."
    width="960"
  />
</p>

Install the Context Skill and official long-form HTML Surface Skill:

```bash
npx @mesospheretech/open-insight
```

Then ask your agent:

```text
Package ./materials as research-context.insight.
Use research-context.insight to compare the relevant findings across the files.
Cite the source file for every important fact.
```

- **Reuse context:** prepare a collection once instead of reopening every file
  for every compatible AI.
- **Retrieve less:** send bounded, question-relevant context instead of the
  entire collection.
- **Trace facts:** resolve important claims to source files, diagnostics, and
  source maps.

```text
Any Information Collection -> One .insight -> Any AI
```

Your AI must be able to call the Open Insight Skill, CLI, or read-only MCP
server. An arbitrary chat website does not automatically understand the file extension.
Open Insight prepares and retrieves evidence; your chosen AI writes
the answer, analysis, document, or presentation.

Open Insight is model-agnostic. It does not require a cloud account, bundle a model, or send your files anywhere by default.

## The problem it solves

AI systems are good at using context, but files are not a stable AI context
interface. Given a mixed information collection, every new AI or conversation
has to reopen formats, rediscover structure and reading order, spend context on
unrelated content, and invent its own way to cite the source.

With Open Insight:

```text
Prepare the information once
-> keep sources, normalized content, index, diagnostics, and provenance together
-> retrieve only the context needed for the current question
-> verify important claims against the source
```

The result is a reusable AI context file, not a prewritten report and not
another chat application.

The format is not limited to one industry or to conventional office projects.
It can carry a research corpus, a learning library, technical documentation,
code and operational notes, structured data, a personal archive, or a context
snapshot handed from one agent to another. The Alpha makes claims only for
formats its current parsers support; the product boundary is the information
collection, not the demo scenario.

## What a user actually does

1. Install Open Insight once; the Context and official HTML Surface Skills are
   delivered together.
2. Ask the agent to package local files or a folder into one `.insight` file.
3. Ask that agent, or another compatible AI, to use the `.insight` file for a
   question or deliverable.

The agent uses Open Insight to retrieve bounded context and resolve citations.
It does not need to inject every source into every prompt.

## Why not a ZIP file?

A ZIP keeps files together. An `.insight` file makes the same material easier for AI systems to inspect responsibly.

| ZIP archive | Open Insight `.insight` |
| --- | --- |
| Stores original files | Stores original files when using `source_bundled` |
| Leaves each AI to rediscover structure | Adds normalized content, structured chunks, and query-ready context |
| Has no common evidence interface | Returns source references, source maps, diagnostics, and digests |
| Usually needs every file to be opened | Supports targeted, read-only CLI and MCP retrieval |

The source files remain the facts. Open Insight adds an AI-readable context layer; it does not replace or silently rewrite the source material.

## Where it fits

- **MarkItDown converts formats.** Open Insight uses parser output, then adds a
  portable package, reading order, query index, diagnostics, digests, and
  source-resolution contract.
- **RAG retrieves knowledge.** Open Insight is a portable local context file
  that an AI or RAG system can consume; it is not a hosted vector database or
  an answer service.
- **MCP connects tools to AI.** Open Insight's MCP server is one access method
  for the `.insight` file; MCP is not the stored context itself.
- **The external AI creates the deliverable.** Open Insight supplies bounded,
  traceable material and keeps generated output outside the source package.

## What is inside?

An `.insight` file can contain:

- Original sources, or source fingerprints and external references.
- Normalized Markdown, text, and table content.
- Structured document chunks, table profiles, and query indexes.
- Source maps, digests, and parse diagnostics for traceability.
- A governance boundary that keeps package access read-only by default.

See the [Core product contract](docs/core-oss-prd.md) and
[context access contract](docs/core-oss-context-access.md).

## 10-minute quickstart

### 1. Install Open Insight

Install both official Skills with one command:

```bash
npx @mesospheretech/open-insight
```

The shorter equivalent command is `npx open-insight-cli`. Both packages use the
same pinned installer implementation.

The branded installer pins both the generic Skill installer and the immutable
`v0.1.0-alpha.5` Skill source, so users do not need a GitHub tree URL or a
second confirmation. When WorkBuddy is detected, the same install registers
the generic read-only Open Insight MCP. The `open-insight-cli` npm launcher is
public, and the Core repository is now in a public silent-test window.
Installation no longer requires repository credentials. Anonymous installation,
fixed-Core bootstrap, one-file compilation, validation, and compact retrieval
were verified from a clean directory on 2026-08-08.

The installed HTML Surface can turn a `.insight` into a polished long-form
reading or audit HTML outside the base package. Word and presentation output
currently use the selected AI client's document tools with Open Insight as the
traceable evidence input.

### 2. Compile a folder into one file

Ask your AI agent to use the installed Skill, or run its wrappers directly:

```bash
node "<skill-root>/scripts/compile-folder.mjs" \
  --source-dir ./materials \
  --output-dir ./output \
  --base-name my-context \
  --mode source_bundled \
  --parser auto \
  --progress
```

There is no separate setup command in the normal workflow. The first compile
or read automatically prepares and verifies the pinned local Core. Preparation
progress stays on stderr, while JSON stdout remains clean. Manual
`bootstrap.mjs` is available only for troubleshooting.

The `source_bundled` mode preserves original files inside one `.insight`
output. Validate and inspect it before use:

```bash
node "<skill-root>/scripts/cli.mjs" validate \
  ./output/my-context.source-bundled.insight --format text
```

### 3. Let any AI read targeted context

Use the same `.insight` file with your preferred AI through CLI or MCP:

```bash
node "<skill-root>/scripts/cli.mjs" context answer-context \
  ./output/my-context.source-bundled.insight \
  --query "What evidence in this collection is relevant to my question?" \
  --token-budget 2000 \
  --format json
```

Your AI should cite the returned source references when it generates an answer or a new document.

For the exact Skill workflow and safety rules, see
[`skills/open-insight-context/SKILL.md`](skills/open-insight-context/SKILL.md).

## Public Alpha demo

Run the fully local, English synthetic demo:

```bash
npm install
npm run demo:public-alpha
```

The demo creates a fictional multi-file project, compiles one `.insight` file, and checks equivalent read-only CLI and MCP retrieval. It does not use an API key or send data to a model.

Read the [public Alpha demo guide](docs/public-alpha-demo.md).

The short animation above uses the international launch film's bounded
`about 90%` statement for selected large, multi-file internal tests. It is an
estimated question-driven retrieval result, not model billing or a universal
promise; results vary by material and task. A frame-by-frame review sheet is available in the
[validation contact sheet](docs/public/assets/open-insight-alpha-contact-sheet.jpg).
Both assets contain no customer material. The smaller public fixture below is a
separate reproducible benchmark and therefore reports its own, more conservative
result.

### Measured in the synthetic demo

Across four English questions over nine mixed-format source files, compact
context used **64.1% fewer estimated tokens on average** than the direct source
folder baseline. The four results ranged from 56.5% to 76.9% savings, while
the demo reported non-empty traceable context, 100% source-reference coverage,
100% parse-diagnostic coverage, and 100% numeric preservation.

This is a fixture-specific deterministic estimate, not model billing usage and
not a universal savings guarantee. Office and PDF inputs use a stable
binary-size heuristic. Run the demo on your machine and inspect the JSON report
before citing the result.

## What "Any AI" means

Open Insight does not certify every model provider or account. It exposes one
model-agnostic context package through a Skill, CLI, and read-only MCP server.
Any AI client that can invoke one of those local interfaces can receive the same
traceable context. Provider login, account tier, network access, and model
availability remain the user's responsibility.

The public demo validates the interface and evidence contract without calling a
model. External-model answers are separate consumer outputs and must be checked
against the returned source references.

## Read-only access: CLI and MCP

The CLI is useful for scripts and local agents. The MCP server exposes the same read-only context service to compatible AI clients.

Available operations include:

- Summarize a package and list its sources.
- List documents, chunks, tables, and diagnostics.
- Search relevant content with traceable context.
- Query supported tables.
- Resolve a result back to source and source-map evidence.
- Validate the package before relying on it.

CLI and MCP share the same access behavior. Neither interface executes code stored in a package, calls a model, or writes generated results back into the base `.insight` file.

## Choose a source mode

### `source_bundled`

Includes original source files together with normalized content and indexes. Use it for local work, handoff, audit, and stronger source recovery.

### `source_light`

Omits original source binaries while retaining normalized content, fingerprints, external references, and an explicit evidence boundary. Use it when file size or privacy policy prevents bundling originals.

`source_light` is not presented as complete original-file evidence. Consumers receive a clear limitation when the raw source is absent.

## Parsing and OCR

MarkItDown is the default local parser backend for supported Office documents
and text-based PDFs. On first use, the Skill automatically installs the pinned
version into an isolated runtime under `~/.open-insight/parsers/`; users do not
run `pip install`. Python 3.10+ is required. Its parser name, version, status,
warnings, and source mapping are recorded in package diagnostics.

Scanned or image-only PDFs are not silently treated as text. OCR is an explicit
experimental capability and must be enabled deliberately. See the
[Alpha readiness and limitations](docs/core-oss-alpha-readiness.md).

## Security and privacy

- Local by default: Open Insight does not upload source files or call a model on its own.
- Read-only by default: package content is never executed.
- Traceable: retrieval can include source references, source maps, diagnostics, and digests.
- Honest failures: unsupported or degraded parsing is reported instead of being disguised as a successful result.
- External AI is your choice: use your own Gemini, Codex, Claude, or another compatible agent after Open Insight prepares the context.

Review [SECURITY.md](SECURITY.md) before using Open Insight with sensitive material.

## Alpha status and limitations

This is an Alpha release path. The stable goal is a local, one-file context handoff for external AI, not a guarantee that every input or every AI model will produce a perfect answer.

Current limitations include:

- Scanned documents and OCR are experimental.
- Parser quality varies by source format and document structure.
- AI-generated answers remain external outputs and must be reviewed against cited sources.
- The package format is additive-compatible with existing `.insight v0.1` content while the public Core evolves.

For release scope and verification boundaries, read
[Core OSS Alpha readiness](docs/core-oss-alpha-readiness.md) and the
[public Core repository manifest](docs/public-core-repository-manifest.md).
The current silent-test candidate is summarized in the
[Alpha notes](docs/public-alpha-release-notes.md).

## Contributing

Open Insight welcomes parser, traceability, validator, CLI, MCP, and Skill
contributions. Start with [CONTRIBUTING.md](CONTRIBUTING.md), then review the
[Core product contract](docs/core-oss-prd.md).

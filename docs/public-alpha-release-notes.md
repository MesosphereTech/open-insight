# Open Insight v0.1.0-alpha.3 Candidate Notes

Status: **private release candidate**. This document does not announce a
public release.

## One File, Any AI

Open Insight turns a mixed information collection into one portable,
traceable `.insight` context file. External AI clients can read bounded
context through the Open Insight Context Skill, CLI, or read-only MCP server.

The Alpha is a local context toolchain. It does not bundle a model, upload
source files, execute package content, or write generated answers back into the
base package.

Install the fixed candidate Skill with one command:

```bash
npx @mesospheretech/open-insight
```

The branded installer pins the generic Skill installer and fixed-tag Skill
source internally. The first compile or read prepares the pinned Core
automatically. Manual bootstrap remains available for troubleshooting, not as
a normal user step. `@mesospheretech/open-insight@0.1.0-alpha.3` and its
equivalent short package `open-insight-cli@0.1.0-alpha.3` are published on the
public npm registry. Both the `latest` and `next` distribution tags resolve to
`alpha.3`.
The pinned Core repository remains private during owner
acceptance, so installation still requires authorized GitHub access.

## Candidate contents

- a one-command Skill install whose first compile or read automatically
  prepares and verifies an immutable Core reference;
- one-file compilation with `source_bundled` and `source_light` modes;
- automatic isolated MarkItDown 0.1.6 setup for supported Office files and
  text PDFs, without a separate user `pip install`;
- normalized content, query chunks, reading order, parse diagnostics, source
  maps, digests, and a rebuildable query index;
- additive XLSX formula evidence without formula execution or recalculation;
- shared read-only Runtime behavior for CLI and MCP;
- validation, conformance, machine contracts, and honest degraded or
  unsupported results;
- a fully synthetic English public demo and reviewed launch media.

## Reproducible public demo

`npm run demo:public-alpha` creates nine synthetic English source files across
Markdown, CSV, HTML, TXT, DOCX, XLSX, and a text-based PDF. It compiles them
into one `.insight`, validates the package, checks four CLI/MCP retrieval
questions, and records Direct Files versus compact-context token estimates.

The current fixture reports:

- 75 indexed chunks;
- 9 parse diagnostics;
- 9 source maps;
- 19 content digests;
- 1 preserved spreadsheet formula;
- CLI/MCP source-trace parity across four questions;
- 64.1% fewer estimated input tokens on average for compact context than the
  Direct Files baseline;
- 100% source-reference, parse-diagnostic, and numeric-preservation coverage
  for those four compact results.

The token figures are deterministic estimates for this fixture. They are not
model billing usage, a model-quality result, or a universal savings guarantee.

## Client compatibility boundary

“Any AI” means that Open Insight exposes model-agnostic local interfaces. It
does not mean that every provider account, model, or client version has been
certified.

Private consumer acceptance currently records:

| Client | Result | Interpretation |
| --- | --- | --- |
| Codex CLI | Passed | Read the package through the Skill/CLI path and returned a traceable answer with three source references. |
| Gemini CLI | Externally blocked | The local account returned an account-tier eligibility error, so product consumption was not evaluated. |
| Claude Code | Externally blocked | The local client returned a credential error, so product consumption was not evaluated. |

Provider login, account tier, network access, and model availability are
external preconditions. Blocked clients are not counted as product passes or
failures. The model-free CLI/MCP parity demo remains the reproducible public
contract check.

## Known limitations

- scanned and image-only documents require an explicitly enabled experimental
  OCR path;
- parser quality varies by source format and layout;
- `source_light` retains normalized content but not raw source binaries;
- token estimates are not tokenizer- or invoice-exact;
- external model answers must be reviewed against returned source references;
- visual applications, hosted collaboration, and enterprise controls are not
  part of this public Core candidate.

## Remaining release blockers

1. Keep the development repository private; change only the reviewed Core
   repository to public after final owner approval.
2. Verify `npx @mesospheretech/open-insight` without development-repository
   access after the Core repository becomes public.
3. Verify anonymous Skill installation from the public repository and fixed
   `v0.1.0-alpha.3` tag.
4. Re-run the remote release-reference check and public Core gates after the
   visibility change. The private authorized candidate already passed the Core,
   Skill, CLI contract, secret, and CLI/MCP parity gates.
5. Upload the reviewed social preview and complete MP4 as launch assets.
6. Publish only after the release audit contains no private paths, credentials,
   customer materials, or commercial product code.

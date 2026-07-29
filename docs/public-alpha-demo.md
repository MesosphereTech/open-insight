# Public Alpha Golden Demo

The Open Insight GitHub Alpha demo uses a fully synthetic English data room for
the fictional company **Meridian Renewables**. No customer file, cloud-drive
path, private Proof input, or model credential is required.

The public Skill entry point is English and intentionally concise. The full
Chinese guide remains available as `skills/open-insight-context/SKILL.zh-CN.md`.

## Run

```bash
npm ci
npm run demo:public-alpha
```

The demo uses the same Skill-managed parser runtime as an ordinary user.
Python 3.10+ is required, but a separate MarkItDown `pip install` is not.

The demo creates:

```text
output/public-alpha-demo/materials/
output/public-alpha-demo/packages/meridian-renewables-context.source-bundled.insight
output/public-alpha-demo/public-alpha-demo.json
output/public-alpha-demo/public-alpha-demo.md
```

The source folder contains Markdown, CSV, HTML, TXT, DOCX, XLSX, and a
text-based PDF. The script compiles them into one `.insight`, validates the
package, queries the same package through CLI and MCP, and checks source-trace
parity for four English questions. It also compares estimated Direct Files
tokens with the query-scoped compact context for each question.

## What it proves

- one mixed folder becomes one `.insight` file;
- MarkItDown and built-in parsers produce normalized content and diagnostics;
- the package exposes a query index, source maps, digests, and stable refs;
- CLI and MCP read the same package and return shared source refs;
- formula text and cached workbook values remain traceable;
- the report contains four Direct Files vs compact-context token estimates;
- estimated savings are accepted only with non-empty, traceable context and
  full source-ref, parse-diagnostic, and numeric-preservation coverage;
- the demo is local, model-free, and does not mutate the base package.

## Direct Files vs Insight boundary

Token counts are estimates, not model billing records. Plain text is decoded;
Office and PDF files use a stable binary-size heuristic, and the report
publishes that limitation next to the savings result.

The demo does not prove that an external model will always answer correctly or
that OCR is complete. A fixed token-savings claim requires larger public
materials, real tokenizer/API usage, and independently reviewed answer quality.

## Visual validation

The repository includes two English-only visual assets generated from the same
synthetic demo facts:

- `docs/public/assets/open-insight-alpha-validation.gif`: a 16-second README
  loop covering one-file packaging, targeted retrieval, token comparison, and
  the `One File. Any AI.` boundary;
- `docs/public/assets/open-insight-alpha-contact-sheet.jpg`: eight reviewed
  frames from the complete 64-second validation video.
- `docs/public/assets/open-insight-social-preview.png`: the reviewed 1280x640
  repository social-preview candidate.

The complete MP4 is prepared as a release or launch asset instead of being
required by the Core runtime. The animation is silent, contains no customer
material, and does not imply external-model certification.

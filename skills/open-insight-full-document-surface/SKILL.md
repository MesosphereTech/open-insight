---
name: open-insight-full-document-surface
description: Turn an Open Insight .insight file into a readable long-form HTML document. Use for a source-faithful reading version, a traceable audit version, or optional local Codex/Gemini layout.
---

# Open Insight Full Document Surface

This Skill creates an external HTML document from a `.insight` file. It starts the same local Open Insight Core used by the Context Skill automatically. A user can ask in ordinary language:

- "Make a readable HTML version of this .insight file."
- "Make an audit version and keep the source trace."
- "Use my local Codex or Gemini to improve the document layout."

The `.insight` file is never changed.

## Default reading path

Use this path when a user wants a readable reconstruction of the supplied material. It is deterministic, keeps source order, headings, lists, paragraphs, and structurally reliable Markdown tables.

```powershell
node scripts/render.mjs `
  --package <material.insight> `
  --output <material.html> `
  --surface-view reading `
  --format json
```

The reading HTML does not expose diagnostics, source IDs, or other implementation details. Use `--surface-view audit --sidecar <trace.json>` when a reviewer needs source and parsing traceability.

## Optional local-model layout

Codex or Gemini can create a complete static HTML document from the normalized source. This is opt-in and must be explicitly enabled. The model receives the source text only; it must not read local files, run commands, add facts, load data in the browser, or modify the `.insight` package.

```powershell
node scripts/render.mjs `
  --package <material.insight> `
  --output <material.html> `
  --mode agent `
  --llm-provider codex `
  --allow-model `
  --surface-view reading `
  --sidecar <material.trace.json> `
  --format json
```

Replace `codex` with `gemini` to use Gemini CLI. If no local model is available, omit `--mode agent --llm-provider ... --allow-model`; the Skill still produces a complete readable HTML document. If model output contains scripts, dynamic fetches, or embedded machine JSON, rendering fails rather than producing an unsafe surface.

## Boundaries

- The source of truth is `source/normalized/*.md` inside `.insight`.
- Table rendering is structural: reliable Markdown tables become HTML tables; malformed table fragments remain readable quoted source text.
- `reading` is for users. `audit` is for source checking.
- Generated HTML and sidecars are external artifacts. `base_package_mutation=false` always applies.

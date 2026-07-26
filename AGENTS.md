# Open Insight Core OSS

Open Insight Core OSS has one Alpha goal: **One File, Any AI**.

`.insight` is a portable context file for AI and agents. Core compiles a
collection of supported local files into one verifiable, searchable, and
traceable package, then exposes the same read-only context through a Skill,
CLI, or MCP.

## Product path

```text
install the Open Insight Context Skill
-> bootstrap a pinned local Core
-> compile files or a folder
-> get one .insight file
-> read it through CLI or MCP
-> let the user's AI create answers or materials
```

Open Insight prepares context and evidence. It does not bundle a model, answer
a fixed question set, execute package code, upload sources by default, or write
generated output back into the base package.

## Public Alpha scope

The public Core repository contains:

- the `.insight` package implementation;
- Compiler, Validator, Runtime, and conformance contracts;
- the Open Insight Context Skill;
- CLI and read-only MCP access;
- public synthetic examples and reproducible release evidence.

Visual applications, hosted collaboration, enterprise controls, and
commercial output products are outside the public Core Alpha.

## Engineering rules

- Keep `.insight v0.1` compatibility additive.
- Default to local, read-only, model-agnostic behavior.
- Preserve raw/normalized boundaries, parser diagnostics, source maps, and
  digests.
- Keep CLI and MCP behavior equivalent by sharing the same Runtime.
- Return `unsupported` or `degraded` honestly when evidence is incomplete.
- Do not count empty retrieval as token savings.
- Never commit credentials, customer files, local output, screenshots, or
  private benchmark inputs.
- Keep generated answers and materials outside the base package.

## Change validation

Use the smallest relevant tests while developing. Before a release candidate,
run the public Core build, public tests, CLI contracts, Skill acceptance,
parser acceptance, and secret scan documented in
`docs/core-oss-alpha-readiness.md`.

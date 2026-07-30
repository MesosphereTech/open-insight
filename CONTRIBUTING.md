# Contributing to Open Insight

Thank you for helping improve Open Insight Core OSS Alpha. The current product
path compiles existing files into one traceable `.insight` context file that
LLM agents can read through a Skill, CLI, or MCP.

## Current contribution scope

Contributions are especially useful in these areas:

- `.insight` packages, the Compiler, Validator, CLI, MCP, SDK/Runtime, Skills,
  and conformance assets.
- MarkItDown parser adapters, general parse diagnostics, content addressing,
  reading order, and compact context.
- Source maps, digests, source modes, privacy, security, and interoperability.
- Public, synthetic, reproducible fixtures and benchmarks.

Hosted collaboration, enterprise controls, visual applications, a formal v0.2
schema, browser-side model calls, and production secret management are outside
the current Alpha scope.

## Development setup

Use Node.js 20.19+ on the 20.x line, or Node.js 22.12+, and npm 10+.
MarkItDown is prepared only when parser work requires it.

```bash
npm install
npm run build:core
npm test
```

Read these documents before changing public behavior:

- `README.md`
- `docs/core-oss-prd.md`
- `docs/core-oss-context-kernel.md`
- `docs/core-oss-context-access.md`
- `docs/core-oss-alpha-readiness.md`

## Working agreement

1. Open or reference an Issue that describes the problem, expected behavior,
   and a public reproduction.
2. Keep each branch and pull request focused on one independently testable
   change.
3. Keep protocol fields, CLI commands, IDs, status enums, and schema keys in
   stable English.
4. When a machine contract changes, update its schema, documentation, example,
   and contract tests. Do not silently change the meaning of an existing
   `schema_version`.
5. When the `.insight` structure changes, update the specification, schema,
   validator, fixture, and conformance checks together.
6. AI-generated or derived output must remain reviewable. It must not become
   automatically `verified` or write back to the base package.

Use clear commit prefixes such as `feat:`, `fix:`, `docs:`, `test:`, and
`chore:`. Do not mix unrelated refactors, generated artifacts, and product
changes in one commit.

## Validation

Run tests that match the change. Before a pull request is ready, at minimum run:

```bash
npm run scan:secrets
npm run verify
```

For CLI or SDK changes, also run:

```bash
npm run cli-contracts:check
npm run sdk:ci
```

Proof v1 is frozen except for defects that affect conclusions, security, or
compatibility.

## Data and security

- Do not commit `.env` files, API keys, bearer tokens, customer material,
  personal data, local absolute paths, model logs, screenshots, or generated
  `output/` artifacts.
- Fixtures must be original, sanitized, and licensed for public use.
- Package access is read-only by default. Do not execute package code or send
  source data to external services without an explicit, reviewed interface.
- Report vulnerabilities privately by following `SECURITY.md`.

## Pull requests

Describe the purpose, scope, machine-contract impact, test results, security
impact, and remaining work. Maintainers may ask for a large pull request to be
split into independently verifiable slices.

By contributing, you confirm that you have the right to submit the material and
agree that it is distributed under this repository's `LICENSE`.

## Purpose

<!-- Describe the concrete problem and why it belongs in the current Core OSS Alpha path. -->

## Changes

-

## Boundaries and compatibility

- [ ] Existing `.insight` or CLI/MCP machine-contract semantics were not
      changed silently. Any semantic change uses a new schema version.
- [ ] Source, lineage, parse-diagnostic, digest, or conformance impact is
      documented.
- [ ] This change does not execute package code, read browser model keys, or
      send source data to an external service by default.
- [ ] AI, generated, or overlay results cannot become automatically
      `verified` and cannot write back to the base package.
- [ ] This change contains no customer material, personal data, local absolute
      paths, `.env` content, API keys, or generated output artifacts.

## Validation

```text
List the commands you ran and summarize the results. Do not write only "tests passed."
```

- [ ] `npm run scan:secrets`
- [ ] Tests matching the change scope were run.
- [ ] Public-entry changes were checked with `npm run verify`.
- [ ] CLI or SDK changes were checked with `npm run cli-contracts:check` and
      `npm run sdk:ci`.

## Remaining work

<!-- Record retained limitations, follow-up pull requests, and manual checks. -->

# Security Policy

## Supported versions

Open Insight is currently a Core OSS Alpha. Security fixes target the latest
`main` branch and the current Alpha candidate explicitly identified by the
maintainers. Historical development branches, private experiments, non-Core
applications, and third-party model services are outside this repository's
support scope.

## Report a vulnerability

Use GitHub's **Security -> Report a vulnerability** private reporting flow.
Do not include any of the following in a public Issue, Discussion, pull
request, log, or `.insight` example:

- API keys, bearer tokens, cookies, or `.env` content.
- Customer files, personal information, private directories, or unsanitized
  screenshots.
- Directly exploitable instructions or malicious `.insight` packages.

Include the affected commit, command or interface, a minimal sanitized
reproduction, impact, and a suggested mitigation when available. Maintainers
aim to acknowledge a report within seven days; this is not a commercial SLA.

## Current security boundaries

- `.insight` access is read-only by default and does not execute arbitrary
  package code.
- CLI and MCP do not call a model, read browser model keys, or send source data
  to a remote service by default.
- `source_light` omits raw source binaries, but its normalized content can
  still contain sensitive information.
- Generated, overlay, and response content cannot become automatically
  `verified` and cannot write back to the base package.
- Default machine output must not expose local absolute paths. Explicit debug
  stacks may contain local paths and must not be included in public reports.
- The Alpha does not provide strong signing, enterprise permissions, a remote
  Hub, production secret custody, or a formal security certification.

`npm run scan:secrets` checks known repository secret patterns. It is not an
external security audit, penetration test, or production security guarantee.

## Reports that are not vulnerabilities

Use a regular Issue for feature requests, parse-quality problems, model-answer
quality, or public-fixture corrections. Vulnerabilities in third-party LLMs,
MarkItDown, operating systems, or other dependencies should also be reported
to their upstream maintainers.

# Changelog

Open Insight uses explicit versions for machine contracts. During Alpha,
features and implementation details can still change. Compatibility is
determined by `.insight v0.1` and each CLI JSON `schema_version`, not only by
the repository release number.

## Unreleased - Core OSS Alpha (`0.0.0`)

### Added

- One-file `.insight` context packages with `source_bundled` and
  `source_light` modes.
- A local MarkItDown parser path, normalized sources, parse diagnostics, and
  source maps.
- Rebuildable SQLite/FTS query indexes, content addressing, reading order, and
  compact retrieval.
- CLI context commands, a read-only MCP server, a standalone Skill, and an
  SDK/Runtime access layer.
- The branded `npx @mesospheretech/open-insight` installer, pinned to an
  immutable Core Skill source.
- Proof Gold workflows, CLI/MCP parity, token and quality evaluation, and
  fail-closed claim-safety gates.

### Changed

- The GitHub open-source entry point is now:
  Skill -> Compiler -> `.insight` -> CLI/MCP -> external LLM.
- The first Skill compile or read automatically prepares and verifies the
  pinned Core. Manual bootstrap is retained for troubleshooting.
- `compile-pack` machine output uses
  `open-insight.compile-pack.v0.2` and privacy-safe public path locators.
- The local MarkItDown adapter uses plugin-disabled `convert_local()` for PDF,
  DOCX, XLSX, and PPTX. Parser versions are recorded in diagnostics and source
  analysis cache keys.

### Security

- Package access does not execute package code, send source data to remote
  services, or read browser model keys by default.
- Generated state remains reviewable with `base_package_mutation=false`.
- Secret scanning, dependency auditing, and absolute-path redaction are part
  of the candidate gates.

### Known limitations

- OCR, image-only PDFs, and complex-layout extraction are not stable default
  Alpha capabilities.
- Public accuracy claims require a completed human Gold Lock and cannot be
  inferred from quickstart or token estimates.
- The Alpha does not provide hosted collaboration, enterprise permissions,
  strong signing, desktop packaging, production secret management, or a formal
  v0.2 schema.

No stable release has been published. Historical development details remain in
Git commits and the private development roadmap.

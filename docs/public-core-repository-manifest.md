# Public Core Repository Manifest

Last updated: 2026-07-24

## 1. Purpose

The current development repository stays private. The GitHub Alpha repository
is created from a reviewed **allowlist**, with a clean Git history and its own
public tree SHA. The private candidate commit remains the implementation
baseline; the export manifest records which files were selected and why.

The public Core is the canonical upstream for the `.insight` package and its
Skill/CLI/MCP toolchain. Other applications may consume it as a dependency.

## 2. Allowlist

The first public export may include only paths in these groups, plus files
required by their verified build graph:

### Repository essentials

- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `package.json`, lockfile, and Core TypeScript/build configuration
- public GitHub Issue, PR, and release templates

### Core implementation

- `packages/insight-core`
- `packages/insight-compiler`
- `packages/insight-validator`
- `packages/insight-runtime`
- `packages/insight-domain-packs`
- `apps/cli`
- MCP source in `apps/cli/src/mcpServer.ts` and its verified Runtime dependencies
- `skills/open-insight-context`

`packages/insight-domain-packs` is currently a direct Compiler/CLI dependency,
so it remains in the first public dependency closure. It is not part of the
hero product narrative. A later Core refactor may make domain packs optional,
but the first export must not hide or break the current build graph.

### Contracts and public evidence

- `spec` entries required by the public Compiler, Validator, CLI, and MCP
- conformance assets required by the public validator
- all-English public synthetic examples and fixtures
- reviewed English launch GIFs and contact sheets derived only from public
  synthetic fixtures
- the reviewed 1280x640 English social preview and candidate release notes
- Core-only tests and release scripts
- current Core OSS documentation, public architecture, and security boundaries

## 3. Denylist

These paths and content classes **must not be exported**:

- non-Core visual application directories and UI packages
- obsolete MCP build residue; the tracked MCP implementation lives in
  `apps/cli/src/mcpServer.ts`
- historical product, UI prototype, and pre-Core Beta documentation or tests
- legacy prose specifications and third-party UI guides whose primary contract
  predates the Core OSS context path
- commercial Surface templates or customer-specific presentation assets
- `.env`, `.env.*`, credentials, API keys, and bearer tokens
- `output/`, `tmp/`, `unpacked/`, screenshots, browser profiles, and local logs
- customer materials, private source documents, and private Proof inputs
- private Proof results, model transcripts, reviewer identities, and Gold data
- local absolute paths, cloud-drive locations, or private repository URLs
- generated build caches and external project source trees

The public export must not contain source material merely because it is useful
for an internal benchmark. Public evidence uses public synthetic inputs only.

## 4. Dependency closure rule

The allowlist is not permission to copy a broken subset. Before export:

1. build a package dependency graph from the candidate;
2. include only the transitive Core dependencies needed by Compiler,
   Validator, Runtime, CLI, MCP, and Skill acceptance;
3. replace accidental non-Core application imports with Core-owned interfaces;
4. fail the export if a commercial path remains in the runtime graph;
5. record each exceptional path in the generated manifest.

No path is added simply to make a failing test disappear. Tests tied only to
historical applications are removed from the public test graph; Core behavior
remains covered by Core tests.

The public repository must define Core-only scripts such as
`build:core-public`, `test:core-public`, `test:skill-public`, and
`verify:core-public`. It must not inherit a private monorepo gate whose build
or test graph requires visual applications, browser smoke, commercial output,
or private Proof.

After the workspace list is reduced, the public lockfile is regenerated and
audited. The private monorepo lockfile is not copied as proof that the smaller
workspace has a valid dependency closure.

## 5. Export record

The clean export must produce a machine-readable record containing:

- private candidate commit and tree SHA;
- export tool version;
- sorted exported path list and file count;
- excluded path categories and counts;
- SHA-256 digest for every exported file;
- aggregate manifest digest;
- public commit and public tree SHA after import;
- license and attribution scan result;
- secret scan result;
- anonymous Skill acceptance result.

Because the public repository is an allowlisted subset, its tree SHA is
expected to differ from the full private candidate tree SHA. Reproducibility is
established by the export manifest digest, not by claiming the trees are
identical.

## 6. Required validation

The exported repository must pass, from a clean machine-like directory:

```bash
npm ci
npm run build:core-public
npm run test:core-public
npm run test:skill-public
npm run scan:secrets
npm run verify:core-public
npm run cli-contracts:check
npm run alpha:skill-acceptance
npm run alpha:parser-acceptance
npm run alpha:release-ref -- --tag v0.1.0-alpha.1 --verify-remote
```

The exact public script set may become smaller than the private monorepo set,
but it must preserve schema, conformance, Compiler, Validator, CLI/MCP parity,
Skill bootstrap, parser diagnostics, source maps, digests, and one-file output.

## 7. Repository relationship

After the public repository is created:

```text
public Core repository = canonical upstream
separate applications and hosted products = downstream consumers
```

Core fixes land in public first. The private commercial repository consumes a
versioned Core release and may carry unreleased integration changes on private
branches. Core security fixes must not depend on private product code.

## 8. Current private review status

The private repository provides:

```bash
npm run alpha:public-export -- --output output/public-core-export
```

The exporter selects Git-tracked files before copying, applies explicit
allowlists to test files, writes per-file SHA-256 digests and an aggregate
manifest digest, regenerates the reduced lockfile, and marks anonymous Skill
acceptance as blocked while the repository remains private.

The 2026-07-24 Core-only review exported 154 files. The generated
`public-export-manifest.json` records the aggregate digest without embedding a
self-referential digest in this exported document. The export omits the seven
legacy prose documents listed by the exporter, including historical
architecture, UI conformance, product-era v0.1 prose, and third-party UI
guides. A clean local import installed 66 dependencies with zero reported
vulnerabilities and passed `build:core-public`, 61 public Core tests, 8 Skill
tests, two public CLI contract tests, secret scanning, and the English
synthetic demo. Earlier standalone Skill and MarkItDown parser acceptance
remains valid for the private candidate; this local evidence does not replace
the final anonymous clone and fixed-tag test.

# Public Core Repository Manifest

Last updated: 2026-07-28

## 1. Purpose

`MesosphereTech/open-insight-development` is the permanent private development
repository. `MesosphereTech/open-insight` is the clean Core repository created
from a reviewed **allowlist** with independent Git history. The Core repository
also remains private during final acceptance and becomes public only after
explicit approval. The private candidate commit remains the implementation
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
- `distribution/open-insight`, the small branded npm bootstrap package behind
  the public `npx open-insight-cli` command and its thin
  `@mesospheretech/open-insight` scoped alias

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
- the reviewed 1280x640 English social preview, English candidate release
  notes, and Chinese companion release notes
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
npm run alpha:release-ref -- --tag v0.1.0-alpha.3 --verify-remote
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

## 8. Current private repository status

The private development repository provides:

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

On 2026-07-27 the existing development repository was renamed to
`MesosphereTech/open-insight-development`. A new private
`MesosphereTech/open-insight` repository was created from the reviewed export.
Its bilingual `README.md` and `README.zh-CN.md`, `main`, and immutable
`v0.1.0-alpha.1` tag are present; the tag resolves to
`66916abb9c8544fe59c518c3518019982995df69`. An authenticated repository-outside
Skill install used the default repository and tag, verified the commit, and
compiled nine public synthetic inputs into one valid `.insight`. A fresh clone
of the remote tag passed 61 Core tests, eight Skill tests, two CLI contract
tests, secret scanning, dependency audit with zero reported vulnerabilities,
and the four-question CLI/MCP parity demo. The remaining release check is the
same installation without credentials after the Core repository becomes
public; the development repository must remain private.

The previous private immutable candidate is `v0.1.0-alpha.2`, resolving to
`703c3ca07af049bee3e973a00fee76af9ecaf1a0`. It added a one-command Skill
installation path and makes the first compile or read prepare the pinned Core
automatically. Repository-outside authorized acceptance verified commit
pinning, clean JSON stdout, model-environment isolation, package compilation,
and reuse of the installed Core. Historical `v0.1.0-alpha.1` remains
immutable. The current `v0.1.0-alpha.3` candidate adds automatic isolated
MarkItDown setup and is fixed at
`d7fc4b7a66834c01e5fede03bdb618d91df653bb`. Authorized
repository-outside acceptance passed from a path containing Chinese characters
and spaces: no manual bootstrap or pip command was used, the Skill prepared
MarkItDown `0.1.6` in an isolated runtime, a real PDF compiled into one valid
`.insight`, and diagnostics recorded `cloud_used=false`. The first clean setup
and compile took about 317 seconds; the cached compile took about 4.9 seconds.
Anonymous installation remains blocked until the Core repository is made
public.

The development branch now also carries the published
`open-insight-cli@0.1.0-alpha.3` npm bootstrap package and the thin published
`@mesospheretech/open-insight@0.1.0-alpha.3` scoped alias. Both `latest` and
`next` point to the accepted Alpha 3 packages. The recommended
public command is `npx @mesospheretech/open-insight`; `npx open-insight-cli`
remains equivalent. The underlying installer pins `skills@1.5.9` and the
immutable Alpha Skill source instead of exposing a generic installer plus a
GitHub tree URL. A packed tarball passed repository-outside installation,
first-use Core preparation, one-file compilation, and traceable context access.
Both npm packages are published with the `latest` tag, and both also expose
`next` as `0.1.0-alpha.3`.
Authorized repository-outside registry installs passed, including a
scoped-command install from a path containing Chinese characters and spaces.
The unversioned commands resolve Alpha 3 and report the pinned Alpha 3 Core
without invoking a model. Anonymous installation remains blocked until the Core
repository becomes public. The
updated allowlist dry-run selects 162 files; the increase is limited to the
branded installer package, its license, and its focused test.

The previously recorded clean export contains 163 files after adding the generated
manifest, with aggregate digest
`b2e3f3997ef6197a05e467d6ca35bf7f753b43b5bbcc76698363476f43786eae`.
A clean install used 66 dependencies with zero reported vulnerabilities and
passed 72 Core tests, 19 Skill/installer tests, two CLI contract tests, secret
scanning, and the all-English public demo. The exported installer packs into
six files and a 4,635-byte npm tarball. That export predates the scoped alias
files and must be regenerated before the Core repository changes visibility.
Both npm installer names are now published; the Core repository visibility has
not changed.

### 2026-08-05 private GitHub Launch Pack refresh

The reviewed Launch Pack export was generated from private development commit
`2571b4bb17d971d020fd5271b3002e6dbfb9671d`. It contains 170 allowlisted files
plus `public-export-manifest.json`, for 171 tracked files in the private Core
repository. The aggregate export digest is
`50c2a04f74fd811b1b32d827fa16ea1bafea67ce5b10a27f7baae06526dc85cd`.

The refresh adds the corrected 1280x640 English Social Preview and a Chinese
companion to the English candidate notes. Platform launch copy, repository
metadata, Discussion categories, and six initial contributor issue drafts stay
in the private development launch pack; they are not exported as product code.
The final clean snapshot passed 74 Core tests, 20 Skill/installer tests, two CLI
contract tests, secret scanning, and the all-English synthetic demo.

The verified snapshot is private Core `main` commit
`34fbf6f60304e90563a1fd4c2619abf625b0383d`. Repository visibility remains
private and `v0.1.0-alpha.3` remains immutable at
`d7fc4b7a66834c01e5fede03bdb618d91df653bb`.

The separate English GIF refresh was completed in private development commit
`aea26668a198085ed493aa5d1f0a4d620a26879a`. The 960x540, 16-second loop now
follows the English launch film's value narrative: repeated team rereading cost,
prepare once, targeted traceable evidence, a bounded synthetic token comparison,
Skill / CLI / MCP access, and `One File. Any AI.`. Its contact sheet is generated
from the same final GIF. HyperFrames structure, layout, motion, and contrast checks,
public documentation tests, and secret scanning passed. This media-only refresh is
queued for the next private Core candidate and does not change repository visibility
or move the Alpha tag.

### 2026-07-30 private Core main refresh

The latest reviewed export was generated from private development commit
`87f3753c32595b039d474783dfe1082006f16c6a`. It contains 169 allowlisted files
plus the generated `public-export-manifest.json`, for 170 tracked files in the
Core repository. The aggregate export digest is
`4169db5af5b365333af0d9a489ed4b5014ab1c03e162f58fa96e60f62b404c72`.

The snapshot passed `npm ci` with zero reported vulnerabilities and then passed
`verify:core-public` twice: once in an independent Git directory and once in a
fresh clone of the real private Core repository. The gate covered 73 Core tests,
20 Skill/installer tests, two CLI contract tests, secret scanning, and the
all-English synthetic CLI/MCP parity demo. A separate digest pass matched all
169 allowlisted files.

The verified snapshot is now private Core `main` commit
`976143c8621bf1f8681dfd3b88e0d716537c1bc8`. Repository visibility remains
private. The immutable `v0.1.0-alpha.3` tag was not moved and still resolves to
Core commit `d7fc4b7a66834c01e5fede03bdb618d91df653bb`. Therefore this refresh improves
the private review candidate but does not complete anonymous Skill acceptance.

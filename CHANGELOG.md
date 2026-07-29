# 变更记录

本项目遵循面向机器契约的显式版本策略。Alpha 期间功能和实现仍可能调整；`.insight v0.1` 和各 CLI JSON 的 `schema_version` 是判断兼容性的依据，而不是仅依赖仓库版本号。

## Unreleased - Core OSS Alpha (`0.0.0`)

### Added

- 单文件 `.insight` context package，支持 `source_bundled` 与 `source_light`。
- MarkItDown 本地 parser 路径、normalized source、parse diagnostics 和 source map。
- SQLite/FTS 可重建 query index、内容寻址、阅读顺序和 compact retrieval。
- CLI context、只读 MCP server、standalone Skill 和 SDK/runtime 访问层。
- 品牌化 `open-insight` npm bootstrap 候选，公开入口收敛为
  `npx open-insight`，内部固定通用 Skill 安装器与不可变 Core Skill 来源。
- Proof Gold、CLI/MCP parity、token/质量评测与安全降级门禁。

### Changed

- GitHub 开源主入口调整为 Core OSS：Skill -> Compiler -> `.insight` -> CLI/MCP -> external LLM。
- Skill 首次编译或读取会自动准备并校验固定 Core；手工 bootstrap 仅用于
  排障，安装链路不转发模型、OCR 或浏览器密钥。
- `compile-pack` 机器结果升级为 `open-insight.compile-pack.v0.2`，默认使用隐私安全的公开路径定位符。
- MarkItDown 本地适配对 PDF、DOCX、XLSX、PPTX 使用默认 `auto` 路径，并改为插件关闭的 `convert_local()`；parser version 进入 diagnostics 和 source analysis cache key，大 Markdown 不再通过固定 20MB stdout 缓冲区传递。

### Security

- 默认不执行包内代码、不外发来源数据、不读取浏览器模型密钥。
- generated state 保持待审且 `base_package_mutation=false`。
- 加入密钥扫描、依赖审计和绝对路径脱敏。

### Known limitations

- OCR、图片型 PDF 和复杂版面解析尚未形成稳定 Alpha 能力。
- Proof 的真实准确率结论必须完成人工 Gold Lock，不能由 quickstart 或 token 估算替代。
- 未提供 Hub、企业权限、强签名、桌面安装包、生产级密钥管理或正式 v0.2 schema。

仓库尚未发布稳定版本标签。历史开发详情以 Git 提交和 `docs/roadmap-status.md` 为准。

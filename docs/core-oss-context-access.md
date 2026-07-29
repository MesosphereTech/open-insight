# Open Insight Core OSS 上下文访问层 Alpha

本层叠加在 Core OSS 上下文内核之上，为同一份 `.insight` 提供 CLI 与 MCP 的只读访问接口。它不改变 `.insight v0.1` conformance，也不负责生成答案、报告或 Surface。

产品定位见 [`core-oss-prd.md`](core-oss-prd.md)，当前可交付范围与门禁见 [`core-oss-alpha-readiness.md`](core-oss-alpha-readiness.md)。

## CLI 入口

Alpha 访问层包括：

```text
insight compile-pack
insight validate
insight context summary
insight context list-sources
insight context list-objects
insight context search-chunks
insight context query-table
insight context resolve-source
insight context diagnostics
insight context material-contract
insight context handoff
insight context answer-context
insight context token-eval
insight mcp serve <package-file-or-dir> --transport stdio
```

`context` 命令默认只读。能力不足应返回结构化 `unsupported` 或 `degraded`，损坏包、危险路径和无效参数才返回失败。

### Skill 仓库外入口

普通用户不需要进入 Core 仓库运行 `npm run cli`。完整安装 `open-insight-context` Skill 后，可从自己的材料目录运行：

```text
node "<skill-root>/scripts/compile-folder.mjs" --source-dir ./materials --output-dir ./output --base-name my-context --mode source_bundled --parser auto
node "<skill-root>/scripts/cli.mjs" validate ./output/my-context.source-bundled.insight --format json
node "<skill-root>/scripts/cli.mjs" context summary ./output/my-context.source-bundled.insight --format json
node "<skill-root>/scripts/cli.mjs" mcp serve ./output/my-context.source-bundled.insight --transport stdio
```

普通 PDF、Office 文件默认使用 `--ocr off`，保持本地、插件关闭。Skill 在首次遇到 PDF、DOCX、XLSX 或 PPTX 时，会在 `~/.open-insight/parsers/` 自动准备固定版本的隔离 MarkItDown runtime；普通用户不需要手工 `pip install`。扫描/图片型 PDF 的实验性模型 OCR 仍必须由用户配置专用 `OPEN_INSIGHT_OCR_*` 并在编译时传入 `--parser markitdown --ocr llm`；Skill 只在这个显式动作之后自动补齐隔离的 `markitdown-ocr` 插件。它不会自动选择 Azure、模型或 endpoint，外部地址可能接收页面图像。OCR 不属于 CLI/MCP 只读访问过程，CLI/MCP 读取已生成的 `.insight` 时仍不调用模型、不读取 OCR key。

相对路径以用户运行命令时所在目录为基准。`cli.mjs` 只开放读取、校验和 MCP 服务，不开放写入 base package 的命令。首次编译或读取发现 Core 缺失时，wrapper 会自动调用相邻的 bootstrap，准备固定 tag `v0.1.0-alpha.3`、校验实际 commit 并使用版本化安装目录；普通用户不需要单独执行准备命令。安装进度只写 `stderr`，不污染 JSON stdout。显式 `bootstrap.mjs` 只用于排障，`OPEN_INSIGHT_CORE_REF` 只用于测试其他 tag/branch，不能把移动 `main` 当作正式 Alpha。

Skill 编译报告的 `access_handoff.packages[]` 会给出可直接用于本机 Agent 的 `cli_summary`、`cli_search_template` 和 `mcp_stdio.command/args`。其中包含本机绝对路径，因此标记为 `local_only=true`、`publish_safe=false`，只用于本机配置，不进入 `.insight` base package。

## MCP 等价访问

MCP stdio server 复用 CLI/Runtime 的同一套读取逻辑，不维护第二套事实或检索实现。主要工具包括：

- `open_insight_context_summary`
- `open_insight_list_sources`
- `open_insight_list_objects`
- `open_insight_query_table`
- `open_insight_search_chunks`
- `open_insight_resolve_source`
- `open_insight_validate_context`
- `open_insight_material_contract`
- `open_insight_context_handoff`
- `open_insight_answer_context`
- `open_insight_token_eval`

MCP stdout 只能输出 JSON-RPC 协议帧。日志和诊断不能污染 stdout；MCP 不读取模型 key、不调用模型、不执行包内代码、不修改 base package。

## 机器契约

所有 JSON 输出必须声明稳定的 `schema_version` 和 `status`。涉及上下文内容的结果应披露：

- `package_id`
- `source_mode`
- `source_refs`
- `lineage_refs`
- `parse_diagnostic_ids`
- `source_map_refs`

机器契约位于 `spec/cli-contracts/`。CLI、MCP、文档和 JSON Schema 的字段变化必须一起测试，不能只更新其中一层。

## 查询索引与降级

CLI 可以使用包内 SQLite/FTS 查询索引，但 SQLite 不是事实来源。访问顺序允许降级到 `query_index/chunks.jsonl`、`query_index/rebuild.sql`、normalized source 或 v0.1 兼容文件。

`source_light` 不含 raw source。缺少原始表文件时，`query-table` 必须披露不支持或降级原因；chunk 检索仍要返回 normalized source 的追溯引用和来源模式说明。

### XLSX 公式证据

当 Compiler 检出公式时，精确记录位于 `source/spreadsheet_formulas.jsonl`，可重建 SQLite 表为 `context_spreadsheet_formulas`。记录包含 `sheet_name`、`cell_address`、`formula`、`formula_type`、`formula_resolution_status`、`cached_value`、`cached_value_raw`、`calculation_status` 以及 `source_refs`、`lineage_refs`、`parse_diagnostic_ids`、`source_map_refs`。`unresolved_shared` 表示该共享公式从属单元格在 XLSX XML 中没有独立公式文本，消费者必须补读共享公式主单元格或原文件。

CLI 的 `context search-chunks`、`context answer-context` 与 MCP 的 `open_insight_search_chunks`、`open_insight_answer_context` 可以从 normalized 公式证据中检索单元格与公式；`context summary` 的 `query_index` 会披露 `spreadsheet_formula_path`、`spreadsheet_formula_available`、`spreadsheet_formula_count` 和 `sqlite_table_counts.spreadsheet_formulas`。CLI 与 MCP 读取的是同一事实层。

公式缓存值来自工作簿文件，Core 不重新计算公式，因此消费者必须保留 `calculation_status=not_evaluated`。`source_light` 仍可携带公式证据，但不含 raw workbook；需要原始工作簿审计、宏、外链刷新或重新计算时必须回到 `source_bundled` 或外部原文件。

## 模型边界

`material-contract`、`handoff` 和 `answer-context` 只负责为外部 LLM 组织 bounded、可追源的输入。模型调用属于外部消费者或后续 Proof 层，不属于本访问层。模型输出不得自动写回 `.insight` base package，也不得自动标记为 `verified`。

## 版本与派生包

访问层继续暴露现有非破坏式 version status/log/derive/rollback/merge 命令。任何派生或回滚都生成新包，不原地修改输入包。该能力不改变上下文读取结果的来源边界。

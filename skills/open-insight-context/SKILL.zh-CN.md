# Open Insight Context Skill 中文完整说明

> Agent 发现入口是同目录的英文 [`SKILL.md`](SKILL.md)。本文件保留中文完整操作说明，不作为第二个重复 Skill 注册。

## 作用

把用户的一组本地信息编译成单文件 `.insight` 上下文信息库，再通过 CLI 或 MCP 为外部 LLM 提供更少噪音、可追源的上下文。输入可以是工作资料、研究语料、学习内容、技术文档、结构化数据、个人档案或 Agent 交接快照；项目文件夹只是其中一种形式。

本 Skill 不负责替用户回答固定问题，也不把报告、HTML 或 PPT 写回 base package。

## 第一步：准备本地 Core

安装时必须保留整个 `open-insight-context` 目录；只有 `SKILL.md` 而没有相邻的 `scripts/` 目录不能完成 bootstrap、编译或读取。本文件所在目录记为 `<skill-root>`。

Alpha 固定目录地址为 `https://github.com/MesosphereTech/open-insight/tree/v0.1.0-alpha.1/skills/open-insight-context`。应通过客户端的 Agent Skill 安装器安装整个目录，或完整下载该目录；不能只保存 GitHub 页面上的单个 Markdown 文件，也不应从移动的 `main` 作为 Alpha 安装来源。

Codex 用户可以直接要求：`请安装这个 Skill：https://github.com/MesosphereTech/open-insight/tree/v0.1.0-alpha.1/skills/open-insight-context`。安装成功后应在下一次对话中使用本 Skill；其他支持 Agent Skills 的客户端也应接收同一个固定目录地址。

首次运行需要本机已有 Node.js 20.19+（20.x）或 22.12+、npm 10+、Git，并能访问 Core 仓库。Core 默认固定到 `v0.1.0-alpha.1`，安装在 `~/.open-insight/core/v0.1.0-alpha.1`；安装过程会核对 tag 对应的实际 commit，再运行 `npm install` 与 Core build，但不安装或调用任何模型。

只做检查：

```bash
node "<skill-root>/scripts/bootstrap.mjs" --check-only
```

允许安装本地 Core：

```bash
node "<skill-root>/scripts/bootstrap.mjs"
```

wrapper 先以中文阶段进度检查 Node.js、npm、Git 和 Core；`system_checks` 会记录工具版本与状态，缺少依赖时返回 `prerequisite_failed`，并在任何 clone 或 install 前给出中文修复动作。进度从 `阶段 1/5` 到 `阶段 5/5` 写入 `stderr`，安装报告仍写入 JSON / Markdown 文件。随后依次查找 `OPEN_INSIGHT_CORE_HOME`、当前目录、Skill 所在仓库和当前 ref 的版本化安装目录。找不到时，它只克隆固定 tag `v0.1.0-alpha.1`；`OPEN_INSIGHT_CORE_REPOSITORY` 可显式覆盖安装源，`OPEN_INSIGHT_CORE_REF` 可显式覆盖测试 tag/branch。报告只显示 `<configured-repository>`，不记录凭据 URL，并记录 `requested_core_ref`、`resolved_core_commit` 与 `core_ref_verified`。固定 ref 不匹配时返回 `version_mismatch`，不会把移动分支伪装成 Alpha。显式本地开发 Core 会标记为 `local_override`，不能作为发布版本验证。

Core bootstrap 不调用模型、不安装 Gemini/Claude/Codex、不读取模型 key。MarkItDown 是可选 parser，不是 Skill bootstrap 的隐式安装项。需要 Office 与文本型 PDF 转置时，先安装 `pip install "markitdown[all]>=0.1.6,<0.2"`；Open Insight 使用本地文件专用转换、显式关闭插件，不调用 Azure 或模型 OCR。

## 编译文件夹

```bash
node "<skill-root>/scripts/compile-folder.mjs" \
  --source-dir ./materials \
  --output-dir ./output \
  --base-name my-context \
  --mode source_bundled \
  --parser auto \
  --parser-timeout-ms 300000 \
  --source-analysis-cache-dir output/.open-insight-source-analysis-cache/my-context \
  --progress
```

这些相对路径以用户运行命令时所在目录为基准，不以 Core 仓库为基准。因此用户不需要进入 `~/.open-insight/core`。

安装 MarkItDown 后，默认 `--parser auto` 对 PDF、DOCX、XLSX 和 PPTX 使用本地 MarkItDown；TXT、Markdown、HTML、CSV/TSV 等简单格式继续优先使用内置本地解析。MarkItDown 不可用或正文抽取失败时，Open Insight 会保留来源、指纹和降级 diagnostics，不会把 metadata-only 内容伪装成完整正文。默认 `--ocr off`，不会启用插件、调用模型或上传扫描件。

### 扫描件模型 OCR（实验性、显式启用）

图片型 PDF 可以显式使用 MarkItDown 官方 `markitdown-ocr` 插件。它是视觉模型 OCR，不是普通 PDF 的内存优化，也不是纯本地传统 OCR。只有用户主动安装插件、配置专用 OCR endpoint 并传入 `--ocr llm` 时才会运行：

```powershell
pip install "markitdown-ocr>=0.1,<0.2" openai
$env:OPEN_INSIGHT_OCR_API_KEY="<private-key>"
$env:OPEN_INSIGHT_OCR_MODEL="<vision-model>"
$env:OPEN_INSIGHT_OCR_BASE_URL="<OpenAI-compatible-endpoint>"

node "<skill-root>/scripts/compile-folder.mjs" `
  --source-dir "./扫描材料" `
  --output-dir "./output" `
  --base-name "scanned-context" `
  --mode source_bundled `
  --parser markitdown `
  --ocr llm `
  --format json
```

不设置 `OPEN_INSIGHT_OCR_BASE_URL` 时由配置的 OpenAI-compatible client 使用其默认 endpoint；设置为 `localhost`、`127.0.0.1` 或 `::1` 才能视为本地 endpoint。其他地址可能把页面图像发送给外部服务，必须先确认资料权限和隐私边界。Skill 只在明确出现 `--ocr llm` 时向 Core 子进程传递 `OPEN_INSIGHT_OCR_API_KEY`、`OPEN_INSIGHT_OCR_MODEL`、`OPEN_INSIGHT_OCR_BASE_URL`，不会传递通用模型变量或浏览器 `VITE_*` 密钥。

模型 OCR 结果始终写为 `status=warning`，并在 `source/parse_diagnostics.jsonl` 中记录 `parser_role`、`parser_version`、`cloud_used`、`confidence` 和人工复核说明。输出没有 `[Image OCR]` 标记时使用 `external_normalized_source_model_ocr_no_output`，不能宣称扫描正文完整。编译 JSON 的 `ocr_mode` 会明确记录 `off` 或 `llm`；OCR 文本仍是 normalized source，不是人工确认事实。

`--mode` 可选：

- `source_bundled`：默认；包含 raw source，适合本地审计和还原，只生成一个 `.insight`。
- `source_light`：不包含 raw source，保留 normalized source、fingerprint 和追源降级说明。
- `both`：同时生成两个单文件 `.insight`。

所有普通文件都会进入来源清单。未知或当前无法转置的扩展名不会静默丢失，而会以 metadata / parser diagnostic 方式保留；编译报告通过 `nonstandard_source_count` 和 `nonstandard_sources` 披露这些来源。

大文件或多文件目录可以显式使用以下运行控制参数：

- `--parser-timeout-ms <ms>`：设置每个来源的本地 parser 等待时间；结果记录在 `parser_timeout_ms`。
- `--max-source-bytes` / `--max-total-source-bytes`：分别限制单个来源和本批来源总大小，支持 `B`、`KB`、`MB`、`GB` 后缀；默认分别为 `512MB` 和 `4GB`。
- `--max-normalized-bytes` / `--max-total-normalized-bytes`：分别限制单来源和本批 normalized 内容大小，默认分别为 `128MB` 和 `256MB`，避免 parser 异常膨胀或多文件正文累计耗尽 Node 内存。
- `--source-analysis-cache-dir <dir>`：复用同内容、同文件名和同 parser 配置的 source analysis，减少重复 MarkItDown 转置；缓存不是事实来源，缓存目录不会写入公开 JSON。
- `--progress`：把逐来源开始、结束、耗时和 cache 命中状态写到 `stderr`；即使同时使用 `--format json`，`stdout` 仍保持纯 JSON。

来源内容哈希采用 `streaming_sha256`，最终单文件 `.insight` 采用 `streaming_zip` 写入；超过任一上限时编译会在失控前阻断并给出中文调整建议，不会静默截断、删除正文或伪装成功。当前 parser 仍需在单来源上完成转置，因此调整上限前必须确认本机内存；扫描/图片型 PDF 的 OCR 是独立的显式增强路径，不会随大文件内存优化自动开启。

### XLSX 公式读取

MarkItDown 继续负责把 XLSX 转成适合阅读的 Markdown。Open Insight 会额外只读提取工作簿 XML 中的单元格地址、公式文本、共享公式信息和文件自带缓存值，写入 `source/spreadsheet_formulas.jsonl`、normalized source 与 SQLite `context_spreadsheet_formulas`，方便外部 LLM 询问“某个单元格的公式和缓存值是什么”。

这不是 Excel 计算引擎：不要声称 Core 执行了公式、宏、外链刷新或重算。读取结果中的 `calculation_status=not_evaluated` 表示缓存值只来自文件；高精度数值优先核对 `cached_value_raw`。`formula_resolution_status=unresolved_shared` 表示共享公式从属单元格没有独立公式文本，不能自行补造。`source_light` 可包含公式证据，但不包含 raw workbook；需要核对原始单元格或重新计算时，应使用 `source_bundled` 或回到外部原文件。

公式问题优先使用具体单元格、工作表名或公式函数作为查询词：

```bash
node "<skill-root>/scripts/cli.mjs" context answer-context ./output/my-context.source-light.insight --query "预算明细 C12 的公式和缓存值是什么？" --token-budget 2000 --format json
```

文件夹编译报告使用 `open-insight.core-skill-folder-compile.v0.1`，并通过 `source_analysis_cache_configured`、`progress_enabled`、`resource_limits`、每个 package 的 `source_mode` 和 `query_index_available` 披露本次运行能力。timeout、resource limits 和 cache 会影响运行成本，不改变 `.insight` 的事实边界。

通过 Skill wrapper 编译时，报告还会生成 `access_handoff`：每个包都带只读 CLI 示例和 MCP stdio 的 `command/args`，可交给本地 Codex、Gemini、Claude 或其他 MCP 客户端。该交接块含本机 wrapper 与包路径，固定标记 `local_only=true`、`publish_safe=false`，不得当作公开报告提交。

不得输出 `.zip` 后缀，也不得把名为 `.insight` 的目录当成交付物。

## 读取顺序

具体问答与浏览审计使用不同入口，不要把审计命令作为每次问答的固定前置步骤。

具体问答：

```text
问题包含明确文档名 -> list-sources 匹配 source_id -> scoped answer-context
其他具体问题 -> answer-context
-> 仅在返回 needs_more_context / audit_required 时补读或收窄来源
-> 生成外部用户材料
```

浏览来源或审计：

```text
context summary -> list-sources / diagnostics -> search / resolve-source
```

针对具体问题，不要默认先运行 summary、diagnostics，不要逐个读取所有 source，也不要读取整篇 normalized source；answer-context 已包含回答所需的 source mode、parser quality、引用白名单和有界片段。如果问题带有明确文档名，先只运行 list-sources 并按文件名选择 source_id，再直接执行 scoped answer-context。如果首次无范围 answer-context 返回 `needs_more_context`，才按 `unresolved_reads` / `next_fragment_reads` 补读；返回 `degraded` 或 `recommended_mode=increase_token_budget_or_recompile` 时必须说明解析边界并停止确定性回答。如果首次结果为 `answer_handoff_status=audit_required`、混入无关来源或正文覆盖不足，应从 `source_inventory_summary` 选择文件名明确匹配的 source，使用一个或多个 `--document-id` 再调用一次 answer-context，并把 `--max-follow-up-reads` 提高到 12；不要改为逐个 resolve 全部来源。来源清单、解析诊断和审计任务可以使用 summary、list-sources、diagnostics 与 resolve-source。

CLI 示例：

```bash
node "<skill-root>/scripts/cli.mjs" validate ./output/my-context.source-bundled.insight --format json
node "<skill-root>/scripts/cli.mjs" context summary ./output/my-context.source-bundled.insight --format json
node "<skill-root>/scripts/cli.mjs" context answer-context ./output/my-context.source-bundled.insight --query "用户问题" --token-budget 2000 --max-follow-up-reads 8 --format json
node "<skill-root>/scripts/cli.mjs" context answer-context ./output/my-context.source-bundled.insight --query "用户问题" --document-id <matched-source-id> --token-budget 2000 --max-follow-up-reads 12 --format json
node "<skill-root>/scripts/cli.mjs" context search-chunks ./output/my-context.source-bundled.insight "用户问题" --compact --format json
node "<skill-root>/scripts/cli.mjs" context resolve-source ./output/my-context.source-bundled.insight <chunk-or-source-id> --format json
```

`cli.mjs` 是 Skill 的仓库外只读入口，只开放 `validate`、`inspect`、`context`、`mcp serve` 和只读 `version status/log`；它会定位本地 Core，并把用户目录下的相对包路径转换为正确的绝对路径。写入型 CLI 命令不会通过该 wrapper 暴露，文件夹编译统一使用 `compile-folder.mjs`。

MCP 示例：

```bash
node "<skill-root>/scripts/cli.mjs" mcp serve ./output/my-context.source-bundled.insight --transport stdio
```

推荐问答最小工具集：`open_insight_context_summary`、`open_insight_list_sources`、`open_insight_validate_context`、`open_insight_answer_context`、`open_insight_resolve_source`。`open_insight_answer_context` 是具体问题的默认入口；只有其返回需要补读时才调用 `open_insight_search_chunks` / resolve。完整工具面还包括对象列表、表查询、token eval、material contract、handoff 和版本状态；以 Core 当前 MCP registry 与 `docs/core-oss-context-access.md` 为准。

## 引用与回答边界

外部 LLM 只能引用工具返回的：

- `source_refs`
- `lineage_refs`
- `parse_diagnostic_ids`
- `source_map_refs`

未知 ID 必须拒绝或标记不可回答。`source_light` 的 normalized source 可以完整保留当前 parser 抽取到的文本，但不等于包内拥有 raw source 的完整审计证据。

## 安全边界

- 默认只读，不执行 `.insight` 包内代码。
- CLI/MCP 不读取、不保存、不展示模型 key。
- 不把来源文件上传到云端。
- 外部 LLM 输出不写回 base package。
- AI 输出不能自动 `verified`。
- SQLite/FTS 是可重建查询索引，不是唯一事实来源。

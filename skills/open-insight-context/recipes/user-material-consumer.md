# Open Insight 用户材料生成 Recipe

本 recipe 给外部 LLM、Agent、MCP client 或 CLI 自动化使用。目标是把 `.insight` 当作 AI 上下文信息库读取，然后生成用户需要的简报、PPT 大纲、邮件、网页文案、行动清单或分析说明。

`.insight` 不是固定报告，也不是问答产品本身。生成材料属于外部消费结果，应输出到外部文件、overlay 或 derived package，不写回 base package。

## 读取顺序

固定按这个顺序读取，不要跳过诊断和追源：

```text
manifest -> source inventory -> parse diagnostics -> semantic kernel -> interpretation contract -> targeted query/search -> source map verify
```

推荐命令：

```bash
node "<skill-root>/scripts/cli.mjs" context summary <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" context list-sources <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" context diagnostics <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" version status <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" version log <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" context list-objects <package.insight> --format json
node "<skill-root>/scripts/cli.mjs" context query-table <package.insight> <table-id> --op sum:<field> --format json
node "<skill-root>/scripts/cli.mjs" context answer-context <package.insight> --query "<query>" --token-budget 2000 --max-follow-up-reads 8 --format json
node "<skill-root>/scripts/cli.mjs" context search-chunks <package.insight> "<query>" --limit 5 --format json
node "<skill-root>/scripts/cli.mjs" context search-chunks <package.insight> "<query>" --compact --token-budget 2000 --format json
node "<skill-root>/scripts/cli.mjs" context token-eval <package.insight> --query "<query>" --format json
node "<skill-root>/scripts/cli.mjs" context token-eval <package.insight> --query "<query>" --direct-baseline <file-or-dir> --token-budget 2000 --format json
node "<skill-root>/scripts/cli.mjs" context handoff <package.insight> --query "<query>" --token-budget 2000 --format json
node "<skill-root>/scripts/cli.mjs" context handoff <package.insight> --query "<query>" --token-budget 2000 --format text
node "<skill-root>/scripts/cli.mjs" context handoff <package.insight> --query "<query>" --token-budget 2000 --route html_restore --format text
node "<skill-root>/scripts/cli.mjs" context handoff <package.insight> --query "<query>" --token-budget 2000 --route html_restore --format json
node "<skill-root>/scripts/cli.mjs" context handoff <package.insight> --query "<query>" --token-budget 2000 --direct-baseline <file-or-dir> --format json
node "<skill-root>/scripts/cli.mjs" context resolve-source <package.insight> <object-or-ref-id> --format json
node "<skill-root>/scripts/cli.mjs" context material-contract <package.insight> --format json
# MCP tool: open_insight_material_contract
```

MCP 生成材料前还应调用 `open_insight_version_status` 和 `open_insight_version_log`，只读确认版本图、父包、合并、回档、review patch 与 `base_package_mutation=false` 边界。

MCP 客户端使用同等工具：`open_insight_context_summary`、`open_insight_list_sources`、`open_insight_list_objects`、`open_insight_query_table`、`open_insight_answer_context`、`open_insight_search_chunks`、`open_insight_token_eval`、`open_insight_context_handoff`、`open_insight_resolve_source`、`open_insight_validate_context`。具体问答默认先调用一次 `open_insight_answer_context`，由它组合 compact context 与有界补读片段；`status=ready` 才可基于 `context_window.fragments` 回答，`needs_more_context` 时按 `unresolved_reads` 补读，`degraded` 时停止确定性回答并披露 parser / source mode 边界。如果问题明确指向某份文档，但首次结果为 `answer_handoff_status=audit_required`、混入无关来源或正文覆盖不足，应从 `source_inventory_summary` 选择文件名明确匹配的 source，再用 `document_id` / `document_ids` 和 `max_follow_up_reads=12` 调用一次 `open_insight_answer_context`；不要逐个 resolve 全部来源。需要手动最小检索时，对 `open_insight_search_chunks` 传 `compact=true`、`token_budget=2000`，返回的 compact schema 应为 `open-insight.context-compact-retrieval.v0.1`；生成材料前必须读取 `coverage_hints.recommended_next_action` 和 `next_fragment_reads`，如果是 `increase_token_budget` 或 `read_normalized_source_fragment`，先按 `next_fragment_reads[].mcp_arguments.target_id` 补读上下文，不要把局部 compact context 当成完整原文。需要评估“全文基准”和“compact context”之间的 token 差异时，调用 `open_insight_token_eval`，返回的 schema 应为 `open-insight.context-token-eval.v0.1`，并检查 `token_count_is_estimated=true`、`direct_full_text_basis` 和 `baseline_disclosure_cn`；默认 `direct_full_text_basis=normalized_source_surrogate`，说明 direct_full_text 是 normalized source 替身，不是模型直接读取原始 Word/PDF 的计费结果。CLI 评测可以加 `--direct-baseline <file-or-dir>` 得到 `external_baseline_files` 基准，用于本地比较用户直接投喂原文件或转置文本的估算 token，但 MCP 不接受任意外部 baseline 路径。需要一次性交给外部 LLM 生成用户材料时，调用 `open_insight_context_handoff`，返回的 schema 应为 `open-insight.context-handoff.v0.1`，并读取其中的 `token_benchmark` 判断是否应优先使用 compact context，读取 `consumer_routes[]` 判断当前任务应该走 `compact_retrieval`、`full_normalized_with_compact_index` 还是 `audit_trace`。

如果外部 LLM 或普通用户不想先解析完整 JSON，可以先运行 `context handoff <package.insight> --query "<query>" --token-budget 2000 --format text` 查看全量路线摘要；text 输出会列出 `material_generation_recipes`、`material_generation_recipe_count`、`recipe_html_restore`、`recipe_ppt_outline` 等路线摘要。如果已确定要做正式说明书 / HTML 复现，优先运行 `context handoff <package.insight> --query "<query>" --token-budget 2000 --route html_restore --format json`，它会保留完整 handoff，同时追加 `selected_material_recipe` 与 `selected_consumer_route`，避免外部 LLM 在全量路线里误选 `recipe_ppt_outline`。给人快速查看时可以改用 `--format text`，读取 `selected_material_recipe`、`selected_prompt_skeleton`、`selected_output_contract.*` 和 `selected_follow_up.*`。MCP 客户端调用 `open_insight_context_handoff` 时可传 `route: "html_restore"`，返回同样的 `selected_material_recipe` 与 `selected_consumer_route`。需要真正生成材料时仍以 JSON 为准：读取 `selected_material_recipe.prompt_skeleton_cn`、`selected_material_recipe.output_contract`、`selected_material_recipe.required_citation_fields`、`selected_material_recipe.follow_up_read_plan` 和 `selected_material_recipe.forbidden`；未指定 route 时再读取 `material_generation_recipes.routes[]`，按对应 route 生成 HTML、Word 大纲、PPT 大纲、问答或分析材料。

普通用户要比较“直接投喂材料”和“读取 `.insight` compact context”的估算 token，可直接运行上面的 `context token-eval ... --direct-baseline <file-or-dir>`。结果中的 `direct_full_text_basis=external_baseline_files` 表示基准来自本地文件估算；MCP 不接受任意外部 baseline 路径。该估算不等于模型实际账单。
如果 CLI 使用 `context handoff ... --direct-baseline <file-or-dir>`，外部 LLM 应检查 `token_eval.direct_full_text_basis` 和 `token_benchmark.direct_full_text_basis` 是否为 `external_baseline_files`；这只说明 handoff 的 token 基准来自本地直接输入估算，不代表模型实际计费，也不能泄露完整本地路径。

当 compact 结果中的 `coverage_hints.recommended_next_action` 指向 `read_normalized_source_fragment`，或 `facts[]` / `tables[]` / `page_cues[]` 的某个 `chunk_id` 需要补读时，先使用 `next_fragment_reads[]`：CLI 客户端执行其中的 `cli_command`，MCP 客户端调用 `open_insight_resolve_source` 并传入 `mcp_arguments.target_id`。如果返回 `normalized_source_fragment`，只读取该 bounded 片段及其 `source_mode_disclosure_cn`、`source_refs`、`lineage_refs`、`parse_diagnostic_ids`、`source_map_refs`；不要把它当成完整原文，也不要丢掉 `source_light` 的证据降级说明。

## 决策规则

1. 具体问答不要默认先跑 summary / diagnostics。问题包含明确文档名时，先用一次 `context list-sources` 匹配 source_id，再执行 scoped `context answer-context --document-id <id> --max-follow-up-reads 12`；其他问题直接调用一次 answer-context。
2. 只有浏览包、来源盘点或审计任务才先读 `context summary`、`context list-sources` 与 `context diagnostics`，确认来源、parser、confidence、warning 和 unsupported 内容。
3. 如需数字，用 `context query-table` 获取最小必要字段；answer-context 已包含 source mode、parser quality、引用白名单和有界片段，不要为取得这些字段重复调用 summary / diagnostics。只有材料生成路线选择才用 handoff，只有手动检索或审计才直接组合 search-chunks 与 resolve-source。
4. `status=needs_more_context` 时按返回计划局部补读；`status=degraded` 时停止确定性回答。只有关键事实仍需复核时才用 `context resolve-source`，不要默认逐个 resolve 来源。
5. 生成材料时，显式写出 source mode、证据边界、待核对点和无法回答的部分。
6. 不要一次性读取全部 normalized source，除非用户明确要求全文重组或包很小。

## Source Mode 处理

- `source_bundled`：包内包含原始文件，证据完整性更强。仍应优先使用 semantic kernel、query index 和 source map 降低 token 消耗。
- `source_light`：包内不含完整原始文件，只包含 normalized source、fingerprint、external refs 和追溯降级说明。生成材料时必须提示：原始证据复核需要 external refs 或外部系统。

不能把 normalized Markdown 当作完整原文证据。normalized source 是 AI 读取优化层，不是 raw source。

## Query Index 处理

读取 `query_index` 时关注：

- `query_index.access_strategy`
- `database_available`
- `database_available`
- `database_path`
- `direct_index_available`
- `direct_index_path`
- `rebuild_sql_available`
- `provenance_tables_available`
- `sqlite_table_counts`
- `context_parse_diagnostics`
- `context_source_maps`
- `context_digests`

`database_available=true` 表示可以优先读取 `query_index/index.sqlite` 做本地检索。`direct_index_available=true` 表示可以读取 `query_index/chunks.jsonl`，它是带 `source_refs`、`lineage_refs` 和 `parse_diagnostic_ids` 的轻量读取入口。`query_index.access_strategy=sqlite_database` 表示包内已有可用 SQLite/FTS 数据库；`rebuild_sql` 表示可用 `query_index/rebuild.sql` 重建；`normalized_source_fallback` 表示索引不可用，需要回退到 normalized source、semantic kernel、source map 和 parse diagnostics。`llm_reading_strategy.preferred_chunk_access` 是给外部 LLM 的压缩读取建议，可取 `sqlite_fts`、`direct_jsonl_index`、`rebuild_sql` 或 `runtime_fallback`；`llm_reading_strategy.evidence_boundary=normalized_sources_without_raw` 时必须披露原始文件未内置。

Compact retrieval 的机器契约是 `open-insight.context-compact-retrieval.v0.1`。它只返回和 query 相关的 facts、key_numbers、tables、page_cues、next_fragment_reads 以及必要的 `source_refs`、`lineage_refs`、`parse_diagnostic_ids`、`source_map_refs`，默认避免整篇 document chunk、page_furniture 和重复页眉页脚进入模型上下文。`page_cues` 用于给外部 LLM 提供页码、行号或 source map 的轻量定位线索，客户阅读材料默认不要直接展示工程 ID；`next_fragment_reads` 用于告诉外部 LLM 下一步应补读哪些 bounded normalized source 片段，以及对应 CLI/MCP 调用参数。要评估 token 效率，运行 `context token-eval`，读取 `open-insight.context-token-eval.v0.1`，比较 `direct_full_text`、`insight_full_normalized` 和 `insight_compact_retrieval`；默认 `direct_full_text_basis=normalized_source_surrogate`，也可以在 CLI 用 `--direct-baseline <file-or-dir>` 生成 `external_baseline_files` 本地基准。token 是 deterministic estimate，不等于模型账单，也不是模型直接读取原始 Word/PDF 的真实计费。要把上下文、token eval、token_benchmark、material contract、CLI fallback、MCP 工具调用示例和安全边界一次性交给外部 LLM，运行 `context handoff`，读取 `open-insight.context-handoff.v0.1`；其中 `token_benchmark.schema_version` 应为 `open-insight.token-benchmark-summary.v0.1`，`token_benchmark.user_facing_summary_cn` 和 `external_llm_instruction_cn` 是给外部 LLM 的压缩读取说明。

`context handoff.consumer_routes[]` 是材料生成路线表：普通问答、分析、Word 大纲和 PPT 大纲优先读 `compact_context`；正式说明书、年报节选、长文 HTML 复现先用 compact context 和 `page_cues` 定位，再按 `fragment_read_plan` 补读 `normalized_source_fragment`；审计追源读取 diagnostics、source map 和 resolve-source，不要把这些工程字段直接塞进客户阅读稿。`fragment_read_plan` 会给出 `cli_command_template`、`mcp_tool`、`chunk_id_sources`、`expected_fragment_field` 和 `source_mode_disclosure_required`，外部 LLM 应按这些字段补读局部片段，不要一次性读取整份 `source/normalized`。无论哪条路线，生成结果都只能写到外部文件、overlay 或 derived package，不能修改 base package。

normalized source 可能包含 `Field semantic hints`。看到这类提示时，可以把用户的中文业务词直接用于 `context search-chunks` / `open_insight_search_chunks`；CLI / MCP 会把 `收入`、`订单`、`风险` 等词扩展为 SQLite/FTS 可检索别名，并在命中时返回 `retrieval_source=query_index_sqlite`。生成材料前仍要验证命中的 source refs、lineage refs 和 parse diagnostic ids。

索引不是唯一事实来源。生成材料前仍要用 source refs、lineage refs 和 parse diagnostic ids 核对。

Surface 生成前还要确认 SQLite provenance tables 可用：`sqlite_provenance_status=pass`、`sqlite_provenance_tables_available=true`、`sqlite_parse_diagnostic_count`、`sqlite_source_map_count`、`sqlite_digest_count` 都应大于 0。否则只能输出 preview / limitation disclosure，不要把 HTML / PPT / memo 称为已验收事实材料。

## 用户材料机器契约

`context material-contract` 会返回 `open-insight.user-material-contract.v0.1`。外部 LLM 可以把它当作消费边界读取：

- `required_citation_fields`：生成材料必须保留 `source_refs`、`lineage_refs`、`parse_diagnostic_ids` 和 source map refs。
- `allowed_outputs`：允许生成简报、PPT 大纲、邮件、行动清单、网页文案或分析说明等外部材料。
- `recommended_context_tools`：给出推荐 CLI / MCP 工具顺序。
- `output_boundary=external_file_or_overlay_or_derived_package`：生成结果只能写到外部文件、overlay 或 derived package，不能写回 `.insight` base package。
- `model_required_by_open_insight=false`：Open Insight 只提供上下文读取，不要求也不代替外部模型。

## 输出模板

生成任何用户材料时，至少保留这些段落：

```text
标题
摘要
关键事实或数字
来源与证据
待人工核对点
不可回答或缺失数据
```

每个关键事实后附最小引用，例如：

```text
收入合计为 122400。来源：source_refs=source_1_sales_csv；lineage_refs=source_1_sales_csv；parse_diagnostic_ids=parse_source_1_sales_csv。
```

## 禁止事项

- 不写回 base package。
- 不执行包内代码。
- 不把 AI 生成内容标记为 verified。
- 不隐藏 parse warnings、unsupported 内容或 source_light 降级。
- 不要把 claims / views / prepared_questions / answers 当作 `.insight` 核心；它们只是兼容层或应用层，可作为辅助上下文。
- 不把模型输出当作原始证据。

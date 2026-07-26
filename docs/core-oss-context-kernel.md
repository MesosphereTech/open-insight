# Open Insight Core OSS 上下文内核 Alpha

本文档定义 Core OSS Alpha 的最小上下文内核。它不是新的正式协议版本，也不改变 `.insight v0.1` 的 conformance 条件；它是在现有包中增加的、可忽略和可重建的实验性读取层。

## 目标

同一份旧文件材料应同时保留事实边界和 AI 读取效率：

```text
raw source 或 external fingerprint
-> normalized source
-> parse diagnostics
-> source map / digest
-> query index
-> Runtime 只读访问
```

Runtime 不调用模型、不执行包内代码、不写回 base package。外部 LLM 的回答、报告和 Surface 输出不属于上下文内核。

## 两种来源模式

- `source_bundled`：包内保留 raw source，同时提供 normalized source 和可重建查询索引。适合本地审计、还原和强追源。
- `source_light`：包内不保留 raw source，保留 normalized source、fingerprint、external refs 和追源降级说明。它可以完整保存当前 parser 已抽取的文本内容，但不能宣称拥有 raw source 的完整审计证据。

读取工具必须披露 `source_mode`。当 `source_light` 缺少原始表文件时，表查询必须返回 `unsupported` 或明确降级诊断，不能伪造查询结果。

## Additive 文件层

Compiler 可以追加以下文件；它们不是 `.insight v0.1` 必需文件：

```text
source/source_mode.json
source/inventory.json
source/normalized/*.md
source/parse_diagnostics.jsonl
source/page_furniture.jsonl
lineage/source_map.jsonl
integrity/digests.json
query_index/manifest.json
query_index/chunks.jsonl
query_index/rebuild.sql
```

`query_index` 是可重建索引，不是唯一事实来源。读取方必须能够回到 normalized source、source map、parse diagnostics 和 digest 复核。

## 追溯底线

可检索对象应携带以下引用：

- `source_refs`
- `lineage_refs`
- `parse_diagnostic_ids`
- `source_map_refs`

解析失败或正文不足时必须保留 metadata-only normalized source 和诊断，不得把文件静默丢弃，也不得把元数据占位当成完整正文。

页码、页眉、页脚等版面信息作为 `page_furniture` 保存。默认语义检索可以降低其排序，但复现和审计仍可使用这些定位线索。

## Runtime 读取范围

Runtime Alpha 提供只读上下文摘要、来源列表、对象列表、chunk 检索、来源解析和诊断读取。读取策略按可用能力降级：

```text
SQLite/FTS
-> query_index/chunks.jsonl
-> query_index/rebuild.sql
-> normalized source fallback
-> v0.1 compatibility files
```

任何降级都必须结构化披露，不能把缺失索引、缺失 raw source 或 parser warning 包装成完整能力。

## 兼容与后续

- v0.1 validator 继续按原有必需文件和 schema 判断包是否合规。
- 不理解本实验层的第三方工具可以安全忽略这些 additive 文件。
- CLI/MCP 机器契约、standalone Context Skill 和 Proof 工具链已经作为独立层实现，分别见 [`core-oss-context-access.md`](core-oss-context-access.md)、[`../skills/open-insight-context/SKILL.md`](../skills/open-insight-context/SKILL.md) 和 [`core-oss-alpha-proof.md`](core-oss-alpha-proof.md)。它们复用本内核，不把外部 LLM 的答案写回基础包。
- 当前实现与公开声明边界以 [`core-oss-alpha-readiness.md`](core-oss-alpha-readiness.md) 为准；可视化应用和商业输出产品不属于 Core Alpha 的阻断范围。
- 正式 v0.2 发布前仍需独立 schema、conformance fixture、validator 规则和迁移说明。

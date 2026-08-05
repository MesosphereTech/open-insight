# Open Insight v0.1.0-alpha.3 中文候选说明

状态：**私有发布候选**。本文不代表项目已经公开发布。

## One File, Any AI

Open Insight 把一批混合资料编译成一个可移植、可追溯的 `.insight`
上下文文件。外部 AI 可以通过 Open Insight Context Skill、CLI 或只读 MCP
取得有界上下文。

Alpha 是本地上下文工具链。它不内置模型、不默认上传来源、不执行包内代码，
也不会把生成答案写回基础包。

安装固定候选 Skill：

```bash
npx @mesospheretech/open-insight
```

首次编译或读取时，Skill 会自动准备并校验固定版本 Core。当前 Core 仓库在最终
验收期间仍保持 private，因此安装仍需要获得仓库访问权限。仓库公开后必须重新完成
匿名安装验收，才能删除这条边界说明。

## 当前候选包含

- `source_bundled` 与 `source_light` 两种单文件编译模式；
- 常见 Office 文件和文本型 PDF 的本地 MarkItDown 解析；
- normalized 内容、查询块、阅读顺序、解析诊断、source map 和 digest；
- XLSX 公式证据保留，但不执行或重算公式；
- CLI 与 MCP 共用的只读 Runtime；
- Validator、机器契约和诚实的 `degraded` / `unsupported` 状态；
- 完全合成、英文优先的公开演示材料。

## 可复现公开样本

`npm run demo:public-alpha` 会生成 9 份合成来源，覆盖 Markdown、CSV、HTML、
TXT、DOCX、XLSX 和文本型 PDF，并编译为一个 `.insight`。随后运行校验、
4 个 CLI/MCP 等价检索问题，以及 Direct Files 与 compact context 的 token 估算。

当前样本记录：

- 75 个索引 chunk；
- 9 条解析诊断；
- 9 条 source map；
- 19 条内容 digest；
- 1 条保留的电子表格公式；
- 4 个问题均通过 CLI/MCP source-trace parity；
- compact context 相比 Direct Files 平均减少 64.1% 的 estimated input tokens；
- 该样本的来源引用、解析诊断和关键数字保留覆盖率均为 100%。

token 数字是针对该 fixture 的确定性估算，不是模型账单、模型回答质量，也不是
对所有材料和任务的普遍节省承诺。

## 已知限制

- 图片型或扫描 PDF 需要显式启用实验性 OCR；
- parser 质量会随格式和版式变化；
- `source_light` 保留 normalized 内容，但不包含原始二进制来源；
- token 估算不等同于具体模型 tokenizer 或 API 账单；
- 外部模型回答仍应结合返回的来源引用进行复核；
- 可视化应用、托管协作和企业控制不属于 Core Alpha。

## 公开前剩余动作

1. 仅在最终确认后把 Core 候选仓库切换为 public；开发仓库继续保持 private。
2. 仓库公开后重新验证无授权情况下的 npm 安装、Skill 下载和固定 tag。
3. 重新运行公开审计、Core tests、Skill acceptance 和远端 release-ref 检查。
4. 上传最终 Social Preview、GIF 和 MP4 发布素材。
5. 确认公开内容不包含私有路径、凭据、客户材料或商业产品代码。

英文候选说明见 [public-alpha-release-notes.md](public-alpha-release-notes.md)。

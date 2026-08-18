# Open Insight

## 把信息准备一次，交给任何兼容 AI 反复使用

Open Insight 是一个开源、本地优先的上下文编译器和可移植文件格式。它把
一组异构文件编译成一个可检索、可验证、可追溯的 `.insight` 文件，让
Codex、Gemini、Claude 或其他 Agent 通过 Skill、CLI 或 MCP 读取同一份
上下文。

**One File, Any AI.** 我们把这一类能力称为 **Portable AI Context**
（可移植 AI 上下文）：

```text
任意信息集合 -> 一个 .insight -> 任何兼容 AI
```

这里的“任何 AI”不是指任意聊天网页天然识别 `.insight` 后缀，而是指能够
调用 Open Insight Skill、CLI 或只读 MCP 的 AI 客户端。Open Insight 负责
准备事实、索引、诊断和来源；用户选择的 AI 负责回答、分析或生成材料。

Open Insight 默认不要求云端账号，不内置模型，也不会自行上传来源文件。
从普通用户角度，`.insight` 就是一个单文件 AI 信息库。项目文件夹只是其中
一种形式，它也可以保存 Agent 之间需要交接的上下文快照。

English documentation: [README.md](README.md)

<p align="center">
  <img
    src="docs/public/assets/open-insight-alpha-validation.gif"
    alt="Open Insight 将多种本地文件编译成一个可追溯上下文文件，再通过 CLI 和 MCP 返回问题所需的有限上下文。"
    width="960"
  />
</p>

## 它解决什么问题

AI 很擅长使用上下文，但文件并不是稳定的 AI 上下文接口。面对一批文档、
表格、网页、演示稿、代码说明或记录，每个 AI 和每次会话通常都要重新：

- 打开并解析不同格式；
- 猜测标题、表格和阅读顺序；
- 把大量无关内容塞进上下文；
- 自己发明引用方式；
- 在解析失败时仍给出看似完整的回答。

Open Insight 把这项重复准备工作固化为一个可复用文件：

```text
本地编译一次
-> 保存来源、规范化内容、读取单元、索引、诊断和追溯关系
-> 当前问题只读取必要上下文
-> 关键事实可以回到来源复核
```

它不是预制报告，也不是固定问答库。`.insight` 可以承载工作资料、研究语料、
学习资料、技术文档、代码与日志说明、数据文件、个人档案或 Agent 之间需要
交接的上下文快照。当前 Alpha 只对已实现的文件类型作能力声明，格式的长期
边界不受某个行业或某类办公场景限制。

## 和 ZIP、RAG、解析器有什么区别

| 工具 | 主要职责 |
| --- | --- |
| ZIP | 把文件装入一个容器 |
| MarkItDown 等解析器 | 把单个文件转换成 Markdown 或文本 |
| 向量库 / RAG | 为特定应用建立检索系统 |
| Open Insight | 把来源、规范化内容、读取顺序、索引、诊断和追溯关系封装成一个可跨 AI 携带的上下文文件 |

`.insight` 可以使用 ZIP 作为内部容器，但它的价值不是压缩率，而是稳定的
AI 读取契约。SQLite/FTS 是可重建查询索引，不是唯一事实来源；重要结果仍可
回到 normalized source、source map、parse diagnostics 和 digest 复核。

## 当前 Alpha 能做什么

- 把文本、Markdown、HTML、CSV/TSV、DOCX、XLSX、PPTX 和文本型 PDF
  编译成一个 `.insight` 文件；
- 通过本地 MarkItDown 增强 Office 和 PDF 转置；
- 保存 `source_bundled` 或 `source_light` 的明确证据边界；
- 保存 normalized content、读取顺序、query chunks、parse diagnostics、
  source maps、digests 和可重建 SQLite/FTS 索引；
- 通过 CLI 和 MCP 返回等价、有限、可追溯的上下文；
- 使用随安装交付的官方 Surface，在 base package 之外生成长文 reading / audit HTML；
- 让外部 AI 以 `.insight` 为事实与来源输入，生成 Word、PDF 或演示材料。

图片型 PDF 和扫描件 OCR 仍是显式实验路径，不属于默认 Alpha 能力。任何
token 节省都必须与非空检索、来源覆盖、数字保真和诊断覆盖一起报告。

## 从 Skill 开始

普通用户不需要先理解 monorepo，也不需要手工运行 bootstrap。只运行一条
命令同时安装 [`open-insight-context`](skills/open-insight-context/SKILL.md)
与官方长文 HTML Surface Skill：

```bash
npx @mesospheretech/open-insight
```

短命令 `npx open-insight-cli` 等价可用；两个包使用同一套固定版本安装器。

品牌安装器在内部固定通用 Skill 安装器和不可变的
`v0.1.0-alpha.5` Skill 来源，普通用户不需要看到 GitHub 长路径，也不需要
第二次确认。检测到 WorkBuddy 时，同一安装还会自动注册通用只读 MCP；每次
调用显式指定 `.insight` 路径，不扫描磁盘。`open-insight-cli` npm 安装器
和干净 Core 仓库均已进入 public 静默测试；当前安装不再需要 GitHub 仓库
权限。2026-08-08 已从全新中文空格目录完成匿名安装、固定 Core bootstrap、
单文件编译、校验和 compact 检索。

要求：

- Node.js 20.19+（Node 20）或 Node.js 22.12+
- npm 10+
- Git

安装完成后，直接让 AI 把本地文件或文件夹编译成一个真实的 `.insight`
文件：

```bash
node "<skill-root>/scripts/compile-folder.mjs" \
  --source-dir ./materials \
  --output-dir ./output \
  --base-name my-context \
  --mode source_bundled \
  --parser auto \
  --progress
```

第一次编译或读取时，Skill 会在后台自动下载、校验并准备固定版本 Core。
安装进度只写入 `stderr`，不会污染 JSON 机器输出。手工运行
`bootstrap.mjs` 只用于排障，不属于普通用户流程。

最终结果是一个 `.insight` 文件，不是 `.zip` 后缀，也不是名为
`*.insight` 的目录。

## 让 AI 读取

针对具体问题，优先取得有限上下文：

```bash
node "<skill-root>/scripts/cli.mjs" context answer-context \
  ./output/my-context.source-bundled.insight \
  --query "你的问题" \
  --token-budget 2000 \
  --format json
```

或启动只读 MCP：

```bash
node "<skill-root>/scripts/cli.mjs" mcp serve \
  ./output/my-context.source-bundled.insight \
  --transport stdio
```

CLI 和 MCP 复用同一 Runtime。它们不会调用模型、执行包内代码或修改
`.insight`。外部 AI 只能引用当前结果返回的 `source_refs`、
`lineage_refs`、`parse_diagnostic_ids` 和 `source_map_refs`。

## 两种来源模式

- `source_bundled`：包含原始文件和 normalized 内容，适合本地审计、还原和
  强追溯。
- `source_light`：不包含原始二进制文件，但保留 parser 已提取的 normalized
  内容、fingerprint、external refs 和降级说明，适合减小体积或受限分发。

两种模式都必须声明 `source_mode`。`source_light` 不能被描述为拥有包内
原始文件证据。

## 安全边界

- 默认本地、只读、模型无关；
- 不执行 `.insight` 内的任意代码；
- 不读取或显示模型密钥；
- 不把来源文件发送到外部服务；
- 不把外部 AI 生成内容写回 base package；
- 能力不足时返回 `degraded` 或 `unsupported`，不伪装成功。

显式启用远程 OCR 或外部模型时，数据边界由用户选择的服务决定，运行前必须
单独确认。

## 当前状态

这是 `v0.1.0-alpha.5` 的 public 静默测试版本，不是稳定版本，也未开始
发布宣传。
当前能力和限制见
[`docs/core-oss-alpha-readiness.md`](docs/core-oss-alpha-readiness.md)，
文件格式与产品契约见 [`docs/core-oss-prd.md`](docs/core-oss-prd.md)。

中文候选发布说明见
[`docs/public-alpha-release-notes.zh-CN.md`](docs/public-alpha-release-notes.zh-CN.md)。

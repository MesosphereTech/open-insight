# Open Insight Core OSS PRD

## 1. 用户问题与产品定义

### 1.1 用户问题

Open Insight 首先解决的不是“怎样再做一个聊天软件”，而是一个更基础的
信息使用问题：

> 我有一组分散在不同文件、格式和目录中的信息。我希望 Gemini、Codex、
> Claude 或其他 Agent 能反复使用，但不希望每次重新上传、重新解析、塞入
> 全部上下文，也不希望回答失去原始出处。

大文件、多文件和跨格式资料是这一问题最集中的表现：材料规模越大、参与
用户和 AI 越多，重复解析、重复传输、上下文遗漏和来源核验成本就越高。

直接把文件交给模型通常会产生四类重复成本：

- 每个模型或会话重新识别文件格式、标题层级、表格和阅读顺序。
- 与当前问题无关的正文也占用上下文窗口。
- 文件、段落、表格和数字缺少可跨工具复用的稳定地址。
- 解析失败、扫描件、碎表和缺失原文容易被隐藏在一个看似完整的回答后面。

当材料进入真实工作流后，这些成本还会被重复放大：同一批材料可能依次交给
不同同事、不同 Agent、不同模型和不同交付环节；每个接收者都重新解析文件、
重新建立阅读顺序、重新寻找关键事实和重新核对出处。文件本身可以流转，
但前一个使用者已经付出成本建立的 AI 上下文通常不能一起流转。

这里不能把所有输入 token 都称为“无效”。回答当前问题所必需的事实属于
必要上下文；Open Insight 重点减少的是三类**可避免上下文成本**：

- 为识别文件格式、版面、标题、表格和页码而反复支付的预处理成本。
- 把与当前问题无关的全文反复送入模型产生的无关上下文成本。
- 同一信息集合在不同用户、模型、会话和交付环节中被重复准备的流转成本。

这些重复成本不仅表现为 token 和等待时间，还会造成更严重的业务问题：

- 大文件或大量文件超过模型可稳定处理的上下文后，模型可能漏读内容，而
  用户无法确认究竟读过什么。
- 不同模型和插件对同一来源产生不同转置结果，答案难以复现。
- 关键数字、表格和结论缺少稳定来源地址，生成材料看似完整却难以核验。
- Word、PDF、Excel、PPT、网页等格式需要不同解析能力，用户不得不反复
  组合插件、MCP 和 Skills，才能让不同 AI 重新获得同一批基础事实。

### 1.2 一句话定义

**Open Insight 是一个开源、本地优先的上下文编译器和可移植文件格式：它
把任意一组受支持的信息准备成一个可被 AI 反复检索、引用和复核的
`.insight` 文件。**

面向普通用户，可以把 `.insight` 理解为一个**单文件 AI 信息库**；面向
开发者，它属于 **Portable AI Context**：来源材料、规范化内容、读取顺序、
查询索引、解析诊断和追溯关系共同存在，并通过 Skill、CLI 或 MCP 暴露同一套
只读访问能力。

从产品契约看，`.insight` 是面向 AI 的上下文信息库，也是可在不同用户、
Agent 和工具之间流转的事实与证据底座。

“信息集合”是产品边界，“项目文件夹”只是可能的输入形式之一。研究语料、
学习资料、技术文档、代码与日志说明、结构化数据、个人档案和 Agent 之间的
上下文快照都可以使用同一抽象；Alpha 只对当前 parser 已实现的文件类型作
能力声明，不把某个行业或某种办公流程写进格式定义。

产品价值不是“把文件换一个后缀”，而是：

```text
信息准备一次
-> 得到一个 .insight
-> 不同 AI 按具体问题读取相关上下文
-> 回答、分析和新材料仍能回到来源复核
```

Open Insight 首先服务于 AI 或 Agent 对材料的可靠读取，而不是首先服务于
报告排版。它不预置用户会问什么，也不在 base package 中保存固定答案。

```text
信息集合
-> .insight 上下文信息库
-> Skill / CLI / MCP 只读访问
-> 外部模型或应用生成回答、分析、报告或其他表面形态
```

`.insight` 不是模型、聊天产品、报告格式或云端知识库的替代品；它是这些消费者之间可交换的上下文与证据底座。

完整产品价值可以概括为四个连续动作：

```text
Prepare once
-> Read only what matters
-> Generate from evidence
-> Circulate with provenance
```

- **准备一次**：把跨格式来源转成可验证的 raw / normalized、读取单元、
  索引、诊断、digest 和 source map。
- **按需读取**：外部 AI 按当前问题和 token budget 取得有限上下文，必要时
  按阅读顺序补读，而不是默认重读全部材料。
- **基于证据生成**：回答、分析和办公材料从可寻址事实出发，每个关键内容
  可以保留来源和待核对边界。
- **带着追溯继续流转**：生成结果可以与其采用的证据、父包关系和生成状态
  组成新的派生 `.insight`，供下一个用户或 AI 复现、核验和继续追问。

### 1.3 用户实际怎么使用

普通用户不需要先学习数据库、RAG 或 MCP。GitHub Alpha 的目标交互是：

```text
用户：请安装 Open Insight Context Skill。
用户：把 ./materials 准备成一个可供 AI 使用的 .insight。
Agent：在本地准备固定版本 Core，编译并校验 my-context.insight。
用户：使用 my-context.insight 回答当前问题，并注明来自哪个文件。
Agent：通过 Skill、CLI 或 MCP 取得有限上下文，必要时回查来源，再生成回答。
```

这里的“Any AI”不是指任意聊天网页天然认识 `.insight` 后缀，而是指任何
**能够调用 Open Insight Skill、CLI 或 MCP 的 AI 客户端**都可以消费同一份
文件。模型账号、网络、客户端工具调用能力和最终生成质量仍由用户选择的
外部 AI 负责。

### 1.4 GitHub Alpha 对外定位

GitHub Alpha 使用 **Portable AI Context** 作为品类描述，发布承诺保持
**One File, Any AI**：

```text
Prepare information once. Use it with any AI.
Turn any collection into one portable, traceable context file for any AI.
```

公开发现与首次使用素材采用 **English-first**，包括公开 `README.md`、
仓库简介、Release notes、公开样例、演示问题、截图、GIF、视频和社交素材；
同时保留完整 `README.zh-CN.md` 与中文 CLI 诊断。

公开 `open-insight` Core 仓库是 package、Compiler、Validator、Runtime、
CLI、只读 MCP、Context Skill、conformance 和公开合成样例的
**canonical public Core**。可视化编辑与阅读应用、托管协作、企业控制和
定制输出产品属于独立产品层或外部消费者，不进入 GitHub Alpha 的默认仓库
与首次安装路径。

当前私有开发仓库不直接切换为 public。发布过程必须从私有候选 commit
使用严格 allowlist 导出清洁 Core 快照，重新生成缩小后的 workspace
`package.json` 与 lockfile，并记录每个导出文件的 SHA-256、聚合 manifest
digest、排除类别、安全扫描和匿名 Skill 验收状态。公开 Core 只有在独立
`npm ci`、Core build、公共测试、CLI 契约、Skill/MarkItDown 仓库外彩排均
通过后才可建立 release；仓库保持 private 时，匿名安装必须明确标为
blocked，不能用本机授权访问代替。

### 1.5 与普通 ZIP 的区别

普通 ZIP 只定义文件如何被装入和取出，不定义 AI 应该按什么顺序阅读、如何知道解析质量、怎样按问题取回有限上下文，也不定义生成内容如何回到原始来源。

`.insight` 可以使用 ZIP 作为单文件容器实现，但协议价值来自容器内部的 AI-ready 结构：

- source inventory 与显式 `source_mode`
- raw / normalized 双层来源边界
- document / section / paragraph / table 等通用读取单元
- reading order 与可重建 SQLite/FTS query index
- interpretation contract、parse diagnostics 与 parser identity
- source map、lineage、fingerprint 与 content digest
- Skill、CLI、MCP 共用的只读访问契约

因此，`.insight` 的目标不是比 ZIP 压缩率更高，而是让 AI 在更少重复解析、更少无关上下文和更清楚证据边界下读取同一批材料。任何 token 节省都必须同时报告检索非空、来源覆盖、数字保真和诊断覆盖，不能以空上下文宣称成功。

### 1.6 优先场景与非目标

优先能力场景分为三层：

- **个人与单个 Agent**：把研究资料、学习内容、技术文档、工作记录或个人
  档案准备一次，之后按问题读取，不反复解析全部来源。
- **跨 Agent 与跨工具交接**：让 Gemini、Codex、Claude 和其他兼容 Agent
  使用同一个可寻址、可诊断、可追溯的上下文快照。
- **系统集成**：把 `.insight` 作为本地工作流、自动化、RAG、知识工具或
  其他 AI 应用的可移植输入，而不是把信息锁在某个聊天产品或私有数据库中。

这些场景共同依赖大文件、多文件和跨格式处理、按问题与 token budget 获取
有界上下文、source / lineage / diagnostic / source-map refs、默认本地和
模型无关，以及在 base package 外继续生成任意消费材料。项目资料、年报、
法规库和尽调材料只是验证样本，不是产品边界。

当用户只需要压缩备份时，普通 ZIP 已经足够；当用户要求原始版式和二进制级还原时，必须使用 `source_bundled` 保留 raw source；当 parser 只能提取 metadata 或 OCR 尚未启用时，`.insight` 必须诚实返回 `partial`、`degraded` 或 `unsupported`，不能把索引或模型推断包装成完整原文。

### 1.7 工作流流转与证据化交付

Open Insight 的长期价值不只发生在“一个用户向一个 AI 提问”的瞬间，也发生
在信息集合和工作成果持续流转的过程中。

以尽调工作为例：

```text
原始资料
-> base .insight
-> 用户提示词 / 任务合约
-> 外部 LLM 生成尽调报告
-> 报告 + 引用证据 + 父包关系 + 审阅状态
-> derived .insight
-> 下一个用户复现报告、核验出处并继续追问
```

这里需要明确两种包的职责：

- **base package** 保存来源事实、normalized 内容、索引、诊断和追溯关系。
  外部模型不得直接修改它。
- **derived package** 可以把生成的尽调报告、分析、HTML、Word、PDF、PPT
  或其他交付物作为新的来源对象，同时记录任务说明、父包 digest、采用的
  source refs、证据子集、生成状态、覆盖状态和人工审阅状态。

派生包应形成**证据闭包**：交付物采用的每个关键事实至少能解析到父包中的
来源地址；用于支持交付物的证据要么按 `source_bundled` 规则包含在新包中，
要么按 `source_light` 规则保留 fingerprint、external refs 和明确的追溯
降级说明。派生包不能只保存一篇无法回查的模型正文。

用户可以把“提示词或任务合约 + derived .insight”交给另一个兼容 AI：

- 复现已有交付物的完整章节结构。
- 查看每个关键事实的原始出处和解析边界。
- 针对报告及其底层来源继续追问。
- 在不覆盖父包的前提下生成新的分支、补充、审阅或下一代派生包。

这不是把问题、答案或报告重新定义为所有 `.insight` 的必需核心。没有生成
内容的 base package 仍然是完整、可用的上下文信息库；证据化交付属于建立在
Core 之上的递归派生能力。

“无损文档”也必须使用可验证定义，不能作为笼统承诺：

- `source_bundled` 可以做到原始二进制来源不丢失。
- normalized、reading order、table、page cues 和 source map 用于提高内容
  与结构复现覆盖率。
- derived package 的 citation coverage 和 evidence closure 用于检查交付物
  是否遗漏来源或产生无法追溯的内容。
- AI 重新排版的 HTML、Word、PDF 或 PPT 不承诺与原文件像素级完全一致；
  它追求的是**内容可覆盖、结构可复现、关键数字保真、出处可解析**。

## 2. 用户与核心任务

首要用户是需要让 AI 可靠、重复使用一组信息的个人、知识工作者、开发者、
Agent 构建者和工具集成方。信息可以来自办公文件、网页导出、结构化数据、
技术资料、代码说明、记录或其他 parser 可支持的来源。其核心任务是：

- 将文件夹中的材料编译为单文件 `.insight`。
- 用 Skill、CLI 或 MCP 按问题读取受限上下文，而不是把全部原文无差别投入模型。
- 查看来源模式、来源引用、血缘、解析诊断和 source map，判断答案可以主张到什么程度。
- 在索引不可用或材料不完整时得到明确的 `unsupported` 或 `degraded` 信息，而不是伪造成功结果。

在多人和多 Agent 工作流中，还存在四类角色：

- **上下文准备者**：把原始材料编译为可验证的 base `.insight`。
- **上下文消费者**：通过自己的 AI、Skill、CLI 或 MCP 提问和分析。
- **交付物作者**：基于事实层生成报告、网页、文档、演示稿或其他材料。
- **下游接收者与审阅者**：接收 derived `.insight`，复现交付物、核验来源、
  继续追问或生成新的受控派生包。

### 2.1 用户承诺与当前代码能力

| 用户想完成的事 | 当前 Alpha 代码路径 | 必须披露的边界 |
| --- | --- | --- |
| 把一个混合文件夹准备一次 | Context Skill 调用 `compile-folder.mjs` / Compiler；当前覆盖文本、Markdown、HTML、CSV/TSV、DOCX、XLSX、PPTX 和非图片型 PDF | MarkItDown 是 Office/PDF 推荐本地解析器；扫描件 OCR 仍是显式实验能力 |
| 得到一个真正的文件 | `compile-pack` 生成单文件 `.insight`；`source_bundled` 可同时保留原始文件 | 最终产品不是 `.zip` 后缀，也不是名为 `.insight` 的目录 |
| 让不同 Agent 重复使用 | 同一个包可经 Skill wrapper、CLI 或只读 MCP 访问 | AI 客户端必须能够调用其中一种本地接口；任意聊天网页不会自动识别该格式 |
| 只给模型当前问题需要的内容 | `context answer-context`、`search-chunks --compact`、reading-order window 与 `--token-budget` | token 节省取决于材料和问题；不能把空检索或弱检索计为成功 |
| 检查回答来自哪里 | `source_refs`、`lineage_refs`、`parse_diagnostic_ids`、`source_map_refs` 与 `resolve-source` | 可追溯不等于模型回答自动正确；parser 质量和来源模式必须同时披露 |
| 默认在本地处理 | Core 编译、校验、SQLite/FTS 和 CLI/MCP 默认不调用模型、不上传材料 | 用户显式启用远程 OCR 或外部模型时，适用其自行选择的数据边界 |
| 继续生成回答或办公材料 | 用户自己的 LLM 基于返回的上下文生成分析、HTML、Word、PDF 或演示材料 | 生成物位于 base package 外，不能自动标记为人工验证结果 |

## 3. 主链路：Skill-first，CLI/MCP 可等价访问

Core OSS 的默认体验是 Skill-first：用户或 Agent 先通过 Context Skill 完成本地检查、编译和读取，再按需要调用 CLI 或 MCP。Skill 是面向工作流的入口；CLI 与 MCP 是相同只读事实层的两种接口，不应维护两套检索或两套事实。

### 3.1 Skill-first

Skill 负责把本地材料编译、读取边界和消费者行为说明交给 Agent。普通用户入口必须保持为品牌化的一行命令 `npx @mesospheretech/open-insight`；短命令 `npx open-insight-cli` 作为等价入口保留。两个 npm 包必须复用同一安装器实现，然后直接编译或读取；不能要求用户先克隆开发仓库、理解 monorepo、复制 GitHub tree 长路径，或把手工 bootstrap 当作主流程。品牌安装包内部可以复用固定版本的通用 Skill 安装器，但必须固定不可变 Skill tag、隐藏实现细节、隔离模型与 OCR 密钥，并保持可审计的 dry-run 安装计划。

第一次调用编译或只读 CLI wrapper 时，如果固定版本 Core 尚未存在，Skill 必须自动下载固定 tag、校验实际 commit、安装依赖并构建 CLI/MCP；准备进度写入 `stderr`，不能污染 JSON stdout。显式 `bootstrap.mjs` 只作为排障或管理员管理入口。自动准备不隐式安装模型、不读取模型 key、不调用模型，也不把来源文件上传到外部服务。

当用户显式设置 `OPEN_INSIGHT_CORE_HOME` 时，该路径是唯一 Core 查找和安装位置，不能静默复用其他全局或相邻 Core。设置 `OPEN_INSIGHT_AUTO_BOOTSTRAP=0` 时，缺少 Core 必须诚实阻断并提供修复动作。这样固定版本校验、自动化测试和多项目隔离不会被机器上的旧安装污染。

文件夹编译支持 `source_bundled`、`source_light` 和 `both` 模式，并可选择 `auto`、`builtin` 或 `markitdown` 解析器。MarkItDown 是默认本地增强解析器：`auto` 对 DOCX、XLSX、PPTX 和非图片化 PDF 使用本地 `convert_local()`，默认关闭插件、记录 parser version 和 `cloud_used=false`；文本、Markdown、HTML、CSV/TSV 继续由内置本地解析覆盖。MarkItDown 位于 Skill 管理的隔离 runtime，不进入用户全局 Python，也不在 CLI/MCP 只读阶段安装。

Office 与文本型 PDF 的 MarkItDown 解析属于 Alpha 默认本地能力。Skill 首次遇到 PDF、DOCX、XLSX 或 PPTX 时，必须在 `~/.open-insight/parsers/` 自动准备固定版本的隔离 parser runtime，不能再要求普通用户手工执行 `pip install`；纯文本来源不得无故触发该安装。Python 3.10+ 仍是明确前置条件，缺失时必须给出可执行诊断。管理员可以关闭自动准备，或通过 `OPEN_INSIGHT_PYTHON` 指向自行维护且可校验的环境。

图片与图片型 PDF 的 OCR / 视觉解析是独立的实验性增强路径，不等同于大文件内存优化。默认 `--ocr off`；只有用户配置专用 `OPEN_INSIGHT_OCR_*` 环境变量并传入 `--ocr llm` 时，Core 才允许启用视觉模型 OCR。Skill 可以在该显式动作之后自动把固定版本 `markitdown-ocr` 安装到隔离 runtime，但不得自动选择 Azure、模型、endpoint、密钥或替用户接受数据外发。若 endpoint 不是本机地址，页面图像可能发送到外部服务，必须在运行前由用户确认数据权限。所有模型 OCR 结果都必须记录 `cloud_used`、parser/plugin/model identity、warning 和人工复核边界；未检测到 OCR 输出标记时不能伪装成完整正文。该实验路径不属于 Alpha 的默认能力声明，也不会改变 `.insight v0.1` conformance。

### 3.2 CLI 与 MCP

CLI 提供编译、校验和上下文读取能力；MCP stdio 服务复用相同 Runtime 逻辑，供外部 Agent 调用。上下文读取默认只读，结果应有稳定的 `schema_version`、`status`，并在适用时返回：

- `package_id`
- `source_mode`
- `source_refs`
- `lineage_refs`
- `parse_diagnostic_ids`
- `source_map_refs`

关键读取能力包括来源摘要、来源列表、对象列表、chunk 检索、表查询、来源解析、诊断、material contract、handoff、answer-context 与 token 估算。`answer-context`、handoff 与 material contract 只组织给外部模型的有界输入，不代表 Core OSS 调用模型或保证模型答案正确。

## 4. 来源与索引模型

### 4.1 `source_bundled`

`source_bundled` 在包内保留 raw source，并同时保存 normalized source 与可重建查询索引。它适合本地审计、还原和要求较强追源能力的场景。

### 4.2 `source_light`

`source_light` 不在包内保留 raw source；它保留当前解析器提取的 normalized source、fingerprint、external refs 与追溯降级说明。它可以保存当前已抽取的文本，但不能宣称拥有 raw source 的完整审计证据。

读取方必须披露 `source_mode`。当 `source_light` 缺少原始表文件时，表查询只能返回 `unsupported` 或明确的降级诊断，不能补造查询结果。

### 4.3 `raw` 与 `normalized`

`raw` 是原始材料或其外部可定位证据；`normalized` 是为了稳定读取、检索和上下文压缩而生成的文本层。normalized Markdown 不是 raw source 的同义物，也不能脱离 source map、digest、诊断和来源模式被表述为完整原文证据。

解析无法取得正文时，包应保留 metadata-only normalized source 与解析诊断，不能静默丢弃来源，也不能将元数据占位伪装为正文。

### 4.4 可重建索引

`query_index` 可包含 SQLite/FTS、`chunks.jsonl` 和 `rebuild.sql` 等读取加速物。它是可重建索引，不是唯一事实来源。消费者必须可以回到 normalized source、source map、parse diagnostics 与 digest 进行复核；索引缺失时应按能力降级，而不是宣称完整检索能力。

### 4.5 XLSX 公式保真

XLSX 的默认可读内容仍由本地 MarkItDown 生成。为了避免只保留公式缓存值而丢失单元格公式，Compiler 还会从工作簿 XML 只读提取单元格地址、公式文本、共享公式信息和文件自带的缓存值，写入 normalized source 与 `source/spreadsheet_formulas.jsonl`，并在 SQLite 中建立可重建的 `context_spreadsheet_formulas` 查询表。缓存值同时保留 `cached_value_raw`，避免高精度十进制文本被浮点转换悄然改写。

公式证据不是公式计算引擎。Core 不执行宏、不刷新外链、不重新计算公式，也不能保证缓存值是最新计算结果；`calculation_status=not_evaluated` 必须始终披露这一边界。共享公式从属单元格没有独立公式文本时必须标记 `formula_resolution_status=unresolved_shared`，不能伪装为已解析。公式证据需要携带 source、lineage、parse diagnostic 和 source map 引用，并由独立 content digest 保护；Validator 会检查 digest、记录数量和 refs 一致性。

`source_bundled` 同时保留原工作簿、normalized 内容和公式证据；`source_light` 可以保留当前已提取的公式文本与缓存值，但不包含 raw workbook，因此不能支持原始文件级审计或重新计算。公式数量或提取输出超过资源上限时必须返回 `partial` / `truncated` 诊断，不能静默丢弃后仍宣称完整。

## 5. 可追溯、诊断与治理边界

### 5.1 追溯

每个可检索对象和面向模型的上下文片段应尽可能保留来源、血缘、解析诊断与 source map 的引用。关键事实、数字和结论在被外部消费者采用前，应能通过 `resolve-source` 或等价 MCP 工具回到这些引用。

### 5.2 诊断

解析失败、低正文质量、缺失 raw source、索引回退、表查询不支持等情况必须以结构化状态显式披露。`degraded` 和 `unsupported` 是产品的正常安全输出，不是可以被 UI 或模型隐藏的异常细节。

### 5.3 治理与安全

Core OSS 默认只读：不执行 `.insight` 包内代码、不调用模型、不读取或转发模型 key、不上传来源文件，也不写回 base package。外部模型产生的内容必须保持外部派生、overlay 或新派生包的边界，不能自动伪装为已验证的人类结论。

本 Alpha 不提供企业权限、Hub、强身份签名或外部安全审计保证。哈希、source map 和 reviewer 记录可以帮助复核内容绑定，但不自动构成身份认证或合规背书。

## 6. 产品分层

Core OSS 的交付对象是可编译、可验证、可读取、可追溯的上下文信息库，以及相应的 Skill、CLI、MCP 和 Proof 工具。

可视化编辑、阅读、托管协作和定制输出产品不属于 Core OSS 的主产品承诺：
它们可以作为独立消费者帮助人查看、编辑或呈现 `.insight`，但不能成为
Core 可读性与可验证性的唯一条件。

回答、分析、Word、PDF、PPT、HTML 页面和其他报告都是外部消费者基于 `.insight` 生成的派生产物。它们不得反向定义 base package 的事实，也不得绕过来源、诊断和人工审阅边界。

完整产品分层应保留三个互不混淆的对象：

1. **事实包**：原始/规范化来源、读取单元、索引、诊断、digest 和 source map。
2. **任务与消费合约**：提示词、目标材料类型、读取策略、token budget、
   必需引用字段、禁止事项和输出边界。
3. **证据化派生包**：生成交付物、父包关系、引用闭包、覆盖报告、生成状态
   和审阅状态。

当前 Alpha 已实现事实包、只读访问、material contract、handoff、外部文件 /
overlay / derived package 边界，以及非破坏式 version derive / merge /
rollback 的基础能力；它尚未把“任意生成报告连同其完整证据闭包再次打包并
跨用户复现”声明为已完成产品能力。该闭环需要后续独立 schema、Validator、
conformance、CLI/MCP、Skill 和真实样本验收，不能只靠提示词约定。

## 7. Alpha 成功标准与非目标

Alpha 的成功是：使用者可以在本地把受支持材料编译成 `.insight`，经 Skill、CLI 或 MCP 获得可追源的有界上下文，并清楚看到能力降级和证据边界。

在 Alpha 之外，完整产品应进一步使用以下指标验证价值：

- **准备成本摊销**：同一信息集合被多少用户、模型和任务重复使用，而不重新
  执行全部解析与上下文准备。
- **有效上下文比例**：送入模型的内容中，与当前任务直接相关的 token 比例。
- **读取效率**：从提出问题到取得可用、可追源上下文的时间与 token。
- **信息覆盖**：目标文件、章节、表格、关键数字和必要上下文是否被召回。
- **追溯解析率**：交付物关键事实能够成功解析到来源位置的比例。
- **关键数字保真**：交付物采用的金额、比例、日期和标识符与来源一致的比例。
- **跨 AI 可复现性**：同一个 `.insight` 经 CLI 与 MCP、不同兼容 Agent
  使用时，是否得到一致的事实边界与来源地址。
- **派生证据闭包**：生成交付物的关键内容是否都有父包、来源、诊断和审阅
  状态，而不是形成新的无来源孤岛。

Alpha 不承诺：

- 任意格式均能完整解析，尤其不把 OCR、图片型 PDF 或受保护文件的结果承诺为完整正文。
- `source_light` 等同于包内保存原始材料。
- token 估算等同于模型账单或模型上下文窗口实测。
- 外部模型的回答、报告或 Surface 输出天然正确、完整或已人工确认。
- 任意 AI 生成交付物已经自动形成完整 evidence closure，或可以在没有
  coverage / citation 校验时被称为“无损文档”。
- 可视化应用、托管协作、企业权限、强签名或正式新协议版本已经由 Core OSS Alpha 交付。

# GitHub Core OSS Alpha 就绪度

本文档记录当前分支可在 GitHub Core OSS Alpha 范围内声明的能力、验证入口与明确不能声明的边界。它不是稳定版本公告，也不替代正式发布验收。

## 1. 当前范围

当前 Alpha 由四层组成：Kernel、Access、Skill 与 Proof。它们共同验证本地 `.insight` 上下文信息库的编译、只读访问、Skill-first 使用和可审计证明流程；不把可视化应用、商业输出产品或外部模型生成物纳入 Core OSS 的完成条件。

仓库交付边界已经落地：`MesosphereTech/open-insight-development` 是永久私有
开发仓库；新的 `MesosphereTech/open-insight` 是中英文双语的干净 Core
仓库，已于 2026-08-08 开启 public 静默测试。历史 `v0.1.0-alpha.1` 固定到
`66916abb9c8544fe59c3518019982995df69`；当前私有候选
`v0.1.0-alpha.2` 固定到 `703c3ca07af049bee3e973a00fee76af9ecaf1a0`；
当前私有候选 `v0.1.0-alpha.3` 固定到
`d7fc4b7a66834c01e5fede03bdb618d91df653bb`。
授权用户验收完成后，又在禁用 Git 凭据提示的全新中文空格目录中完成一行匿名
安装、首次调用自动准备固定 Core、单文件编译、校验与 CLI compact 读取。
匿名公开分发验收已通过；开发仓库未进入该公开动作并继续保持 private。

## 2. 已实现并可声明的能力

### Kernel

- 已实现 additive 的上下文内核，不改变 `.insight v0.1` 的 conformance 条件。
- 已实现 `source_bundled` 与 `source_light` 两种来源模式，以及 `raw` / `normalized` 的边界披露。
- 已实现 normalized source、parse diagnostics、source map、digest、page furniture 和 query index 等可读取层。
- 已实现可重建查询索引；索引不是唯一事实来源，读取可降级到 JSONL、重建 SQL、normalized source 或 v0.1 兼容文件。
- 已实现 XLSX 公式证据的 additive 保真：MarkItDown 继续生成工作簿可读 Markdown，Core 从 XLSX XML 只读提取单元格地址、公式文本和文件自带缓存值，写入 `source/spreadsheet_formulas.jsonl`、normalized source、独立 content digest 与 SQLite `context_spreadsheet_formulas`。高精度缓存值保留 `cached_value_raw`，无法展开的共享公式标记 `formula_resolution_status=unresolved_shared`；Validator 检查 digest、记录数量和 refs。该能力不执行宏、不刷新外链、不重新计算公式，固定披露 `calculation_status=not_evaluated`；`source_light` 不包含 raw workbook。

### Access

- 已实现 CLI 的编译、校验与只读上下文命令。
- 已实现 MCP stdio 服务，并复用 CLI/Runtime 的读取逻辑。
- 已实现上下文摘要、来源/对象列表、chunk 检索、表查询、来源解析、诊断、material contract、handoff、answer-context 与 token 估算等访问面。
- 已实现稳定机器契约的 schema 与状态披露，并在适用结果中保留 `source_mode`、`source_refs`、`lineage_refs`、`parse_diagnostic_ids` 和 `source_map_refs`。
- 已实现缺失 raw source、缺少索引或不支持表查询时的 `unsupported` / `degraded` 路径；不会将降级包装为完整能力。

### Skill

- 已提供 `open-insight-context` Context Skill，覆盖 bootstrap、本地文件夹编译、CLI/MCP 读取与安全边界。
- 已提供仓库外只读 `cli.mjs` wrapper；用户可在自己的材料目录使用相对路径完成编译、校验、context summary 和 MCP stdio，不需要切换到 Core 仓库。
- 已支持以 `source_bundled`、`source_light` 或 `both` 编译文件夹材料。
- 已支持 `auto`、`builtin` 与 `markitdown` 本地解析选择。安装 MarkItDown 后，`auto` 对 PDF、DOCX、XLSX、PPTX 使用本地 `convert_local()`，显式禁用插件并记录 parser version；MarkItDown 仍是可选增强解析器，不是 bootstrap 的隐式安装项。
- 已为大文件编译增加 fail-closed 资源边界：来源内容哈希使用 `streaming_sha256`，最终单文件 `.insight` 使用 `streaming_zip`；单来源、来源总量、单来源 normalized 内容与 normalized 总量都有显式可调上限。超限时只返回中文阻断诊断，不截断正文、不生成残缺包。
- 已增加隔离 parser runtime 自动准备：默认 `--parser auto` 遇到 PDF、DOCX、XLSX 或 PPTX 时，在 `~/.open-insight/parsers/` 创建固定 MarkItDown 0.1.6 环境并传递专用 `OPEN_INSIGHT_PYTHON`，普通用户不再手工 `pip install`；简单文本不触发安装。管理员可显式关闭自动准备或指定自管 Python，Core 不修改用户环境。
- 已增加实验性的显式模型 OCR 接口：默认 `ocr_mode=off`；只有 `--parser markitdown --ocr llm` 和专用 `OPEN_INSIGHT_OCR_*` 配置同时存在时才运行。Skill 可在该显式动作后自动安装固定 `markitdown-ocr 0.1.0`，但不自动选择 Azure、模型、endpoint、密钥或数据外发授权。模型 OCR 结果固定为 warning 和人工复核边界，记录 `cloud_used`；没有 OCR 标记时不能宣称扫描正文完整。2026-07-23 在 commit `0d2ba68` 上使用隔离安装的 `markitdown-ocr 0.1.0`、一页图片型 PDF 和本机模拟 OpenAI-compatible 视觉 endpoint 完成了真实插件接线验收：OCR 标记、normalized 正文、复合 parser identity、单文件打包和 `base_package_mutation=false` 均通过，且未外发资料。该验收不评价真实视觉模型 OCR 准确率；真实扫描件、真实 endpoint 和不同版式的识别质量仍待专项测试，因此不属于 Alpha 默认能力声明。
- 已实现 bootstrap 的本地依赖、构建、CLI 与 MCP 就绪检查；该检查不调用模型、不转发模型环境变量、不上传来源文件、不执行包内代码，也不写回 base package。
- 已把普通用户主路径收敛为“一条固定 tag 命令安装完整 Skill，然后直接编译或读取”。首次调用 `compile-folder.mjs` 或只读 `cli.mjs` 时自动准备固定 Core，安装进度只写 `stderr`，JSON stdout 保持纯净；手工 bootstrap 只用于排障。`OPEN_INSIGHT_CORE_HOME` 是唯一显式安装位置，`OPEN_INSIGHT_AUTO_BOOTSTRAP=0` 可由管理员关闭自动准备。
- Skill bootstrap 默认固定 `v0.1.0-alpha.3`，使用版本化安装目录并校验实际 commit；ref 不一致时返回 `version_mismatch`，不会把移动分支伪装成 Alpha。`OPEN_INSIGHT_CORE_REF` 只作为显式测试覆盖入口。
- 已发布品牌化 npm bootstrap `open-insight-cli@0.1.0-alpha.3` 及其官方 scoped 别名 `@mesospheretech/open-insight@0.1.0-alpha.3`；推荐公开命令为 `npx @mesospheretech/open-insight`，短命令 `npx open-insight-cli` 等价可用，两个包的 `latest` 与 `next` 均指向该已验收版本。scoped 包只固定依赖同版本底层安装器，不复制实现；底层安装器固定 `skills@1.5.9` 与 `v0.1.0-alpha.3` Skill 来源，只转发受支持的安装参数，并从子进程环境移除模型、OCR 和浏览器密钥。2026-07-30 两条无版本命令均从公共 registry 返回 `package_version=0.1.0-alpha.3`、`core_ref=v0.1.0-alpha.3` 和 `model_invoked=false`；scoped 命令还在含中文和空格的隔离目录安装了完整 Skill 与 7 个脚本。registry 安装后的真实 PDF 缓存编译约 9 秒，生成单文件有效 `.insight`，CLI compact 检索返回来源引用和解析诊断。无 scope 名称 `open-insight` 因 npm 防混淆规则被拒绝，因此保留 `open-insight-cli` 并增加官方 scoped 品牌入口；2026-08-08 Core 仓库公开后，同一命令的无凭据匿名安装已经通过。

### Proof

- 已提供公开小样本 quickstart、proof scope/plan、parser quality、CLI/MCP parity、token 估算、Gold Answer 工作流、Gold Lock、模型输入冻结、三路径对照与报告生成工具。
- 已实现 `direct`、`full_normalized`、`compact` 三条被测输入路径的边界，以及模型调用前的 Gold Lock fail-closed 门禁。
- 已实现来源范围、字段级证据绑定、解析诊断、source map、digest 和已锁定输入之间的审计关系。
- 已实现公开声明前的双 reviewer 要求：必须是两个不同的 `reviewer_id`，并且 `ready_for_public_claim=true`。
- 已在 Gold Lock 与公开摘要中输出 `reviewer_identity_assurance=self_attested_unverified`。该字段明确表示 reviewer 身份为自我声明、未验证，不能被解释为密码学身份认证、外部见证或强签名。

### Proof v1 冻结边界

自 2026-07-16 起，Proof v1 进入功能冻结：现有 scope/plan、parser quality、CLI/MCP parity、Gold evidence、逐项 evidence bindings、Gold audit、输入冻结、Gold Lock、三路径比较和 claim safety 足以支持 Alpha 内部验证。后续只有发现会改变实验结论的真实缺陷、安全旁路或兼容性回归时才修改 Proof；不再新增研究型评分器、评测编排层或宣传指标。

真实材料尚缺的工作是人工确认 Gold Answer 和独立 reviewer attestation，不是继续扩建 Proof 代码。开发优先级回到普通用户首次使用路径：`一行安装 Skill -> 首次调用自动准备固定 Core -> 编译文件夹为单个 .insight -> CLI/MCP 只读访问 -> 外部 LLM 问答、分析或生成材料`。

代码中的 Skill 与 Core 安装来源已经统一固定为 `v0.1.0-alpha.3`。该 tag
已经在新的干净私有 Core 仓库建立，并完成授权用户的仓库外安装测试：从中文和
空格路径安装完整 Skill 后，未手工运行 bootstrap 或 `pip install`，首次编译
自动准备并校验 Core、创建隔离 MarkItDown `0.1.6` runtime，并生成单一有效
`.insight`。真实 PDF 首次端到端准备与编译耗时约 317 秒；复用固定 Core 和
parser 后，同一 PDF 的缓存编译耗时约 4.9 秒。CLI compact 检索返回来源引用和
解析诊断，diagnostics 记录 `parser=markitdown`、`parser_version=0.1.6`、
`cloud_used=false`。历史 `v0.1.0-alpha.1` 保持不可变。
`npm run alpha:release-ref -- --tag v0.1.0-alpha.3` 只核对待发布 tag 文本；
公开发布门禁必须追加 `--verify-remote`，禁用凭据交互并确认该 tag 可从
匿名可下载的公开来源读取。当前私有 Core 仓库、本地 fake remote 或授权
checkout 测试都不能替代匿名公开分发验收。

首次运行 wrapper 已显式检查 Node.js 20.19+（20.x）或 22.12+、npm 10+、Git 和 Core 状态，并以 `system_checks` 写入安装报告。缺少依赖时返回 `prerequisite_failed`，在 clone / install 前给出中文修复动作；正常路径以 `阶段 1/5` 到 `阶段 5/5` 写入中文进度。检查和子进程环境不会转发模型 key。

2026-08-05 从开发提交
`2571b4bb17d971d020fd5271b3002e6dbfb9671d` 生成 GitHub Launch Pack
候选：170 个 allowlisted 文件加 1 个生成 manifest，共 171 个 Core 仓库
跟踪文件，aggregate digest 为
`50c2a04f74fd811b1b32d827fa16ea1bafea67ce5b10a27f7baae06526dc85cd`。
本次增加无文字重叠的 1280x640 Social Preview、英文候选说明的中文伴随稿，
并在私有开发仓库准备 Show HN、Reddit、X、LinkedIn、知乎、V2EX、仓库
metadata、Discussion 分类和 6 个首批 Issue 草案。最终清洁快照通过 74 项
Core tests、20 项 Skill/installer tests、2 项 CLI contract tests、密钥扫描和
全英文公开 demo，已推送到仍为 private 的 `MesosphereTech/open-insight`
`main` 提交 `34fbf6f60304e90563a1fd4c2619abf625b0383d`。仓库没有切换为
public，`v0.1.0-alpha.3` tag 没有移动。随后在开发提交
`aea26668a198085ed493aa5d1f0a4d620a26879a` 完成独立英文 GIF 重制：成片为
960x540、16 秒、10fps，从团队重复读取资料的时间与 token 成本开始，依次展示
prepare once、按问题读取可追溯证据、与国际视频一致的 `≈90%` selected
large, multi-file internal test estimated token statement、
Skill / CLI / MCP 和 `One File. Any AI.`。同一 GIF 的 8 帧 contact sheet、
HyperFrames 结构/布局/运动/对比度检查、公开文档测试和密钥扫描均已通过；该媒体
切片等待同步到下一份仍为 private 的 Core 候选，不改变仓库可见性或 Alpha tag。

同步完成记录：从开发提交 `5a8c5dceb39f9c505e7086d04b287ad7607f2d87`
生成 170 个 allowlisted 文件，aggregate digest 为
`5bb1c29e8c9152f01102e617a9bc72fb2756d063c6b20866122344e57dc9cd2f`；
加入生成 manifest 后形成 171 个 Core 跟踪文件。完整公开候选门禁通过后，
该快照已推送到仍为 private 的 `MesosphereTech/open-insight` `main` 提交
`522df50c269d7492e8f6e59c46643b8c00bc3f3b`。仓库没有切换为 public，
`v0.1.0-alpha.3` tag 没有移动。

2026-08-07 完成最终 token 陈述对齐：开发提交
`4c55f7d4697e6ae271f0b07be8fec9be39fa0ee8` 将英文 GIF 与国际视频统一为
“部分大型、多文件内部样本约 `90%` estimated token savings”，同时继续把
公开 9 文件合成样例的 `64.1%` 作为独立、可复现实验结果，不把两者混为普遍
承诺。导出包含 170 个 allowlisted 文件，aggregate digest 为
`48fd714487234c09a75646d0abf1cff1933d15dc1acb6e7cd03cb22e86ca7103`；
加入 manifest 后形成 171 个 Core 跟踪文件。75 项 Core tests、20 项
Skill/installer tests、2 项 CLI contract tests、密钥扫描和全英文公开 demo
通过后，快照已推送到仍为 private 的 `MesosphereTech/open-insight` `main`
提交 `eb0957560a67b3393bd6c7b9e08e69b1f24117b1`；
`v0.1.0-alpha.3` tag 没有移动。

2026-07-30 从开发提交
`87f3753c32595b039d474783dfe1082006f16c6a` 重新生成最新干净候选：
169 个 allowlisted 文件加 1 个生成 manifest，共 170 个 Core 仓库跟踪文件，
aggregate digest 为
`4169db5af5b365333af0d9a489ed4b5014ab1c03e162f58fa96e60f62b404c72`。
快照先在独立 Git 目录、再在真实私有 Core 克隆中各完成一次
`verify:core-public`：73 项 Core tests、20 项 Skill/installer tests、2 项 CLI
contract tests、0 vulnerability 依赖审计、密钥扫描和全英文公开 demo 均通过。
逐文件 SHA-256 核对 169/169 一致。该快照已推送到私有
`MesosphereTech/open-insight` 的 `main` 提交
`976143c8621bf1f8681dfd3b88e0d716537c1bc8`；仓库仍为 private，
`v0.1.0-alpha.3` 仍解析到原固定 Core commit
`d7fc4b7a66834c01e5fede03bdb618d91df653bb`，未移动标签。
这些是 private 候选证据；无凭据匿名安装仍未执行。

## 3. 可用的本地验证命令

以下命令来自当前根目录 `package.json`，可作为本地验证入口：

```powershell
npm run test:gates
npm run test:core
npm run test:proof
npm run test:skill
npm run alpha:check
npm run alpha:public-audit
npm run alpha:skill-acceptance
npm run alpha:parser-acceptance
npm run alpha:release-ref -- --tag v0.1.0-alpha.3 --verify-remote
npm run verify
```

命令用途如下：

- `npm run test:gates`：仅输出当前 Core Alpha 测试门禁矩阵，不执行测试。
- `npm run test:core`：Core OSS 的快速反馈测试，覆盖协议、CLI/MCP、包读写、文档护栏、conformance、隐私与追溯引用等范围。
- `npm run test:proof`：Proof、Gold Answer、MCP parity、proof report、claim safety 等专项测试。
- `npm run test:skill`：Skill-first、bootstrap、文件夹编译和普通用户端到端路径的专项测试。
- `npm run alpha:check`：依次检查门禁矩阵、Skill bootstrap check-only、Proof quickstart 与密钥扫描；若必需步骤被跳过或检查未达到 ready，结果为 `incomplete` 或失败，不能作为发布通过证据。
- `npm run alpha:public-audit`：检查当前快照密钥、完整 Git 历史中的高置信密钥/私有测试定位、本机路径、大型历史 blob、high/critical 依赖漏洞、社区文件、候选 tag 和 `origin/main` 祖先关系。报告只输出计数和状态，不输出命中的密钥或私有路径正文。当前开发仓库继续保持 private；若完整历史存在私有定位或已删除大 blob，发布策略必须是导出候选 tree 到清洁历史的公开发行仓库，而不是直接切换现有仓库可见性。
- `npm run alpha:skill-acceptance`：仓库外完整首次使用彩排；要求工作区干净，从当前 commit 制作临时固定 tag，在含中文和空格的独立目录完成 Skill 安装、单文件 `.insight` 编译、校验、CLI answer-context 和 MCP 完整结果等价检查。它不调用模型、不读取私有材料，默认清理临时安装；该真实路径是提交后的独立发布检查，不由 `test:skill` 的轻量计划测试替代，也不能替代匿名公开下载。
- `npm run alpha:parser-acceptance`：仓库外 MarkItDown 真实解析验收；使用脚本生成的公开 DOCX、带公式 XLSX 和文本型 PDF，通过默认 `auto` 编译一个 `source_bundled .insight`，并逐来源核对 raw 字节、normalized 正文、parser version、diagnostics、source map、raw metadata digest、normalized content digest 和 query index。合成工作簿固定包含 `Sales!B4 =SUM(B2:B3)` 与文件自带缓存值 `2100000`；验收还会核对 `source/spreadsheet_formulas.jsonl`、normalized 公式附录、独立公式 digest、SQLite `context_spreadsheet_formulas` 记录、CLI 公式检索和完整 refs。它同时用极小单文件上限验证 parser 前 fail-closed、无残留包，并核对 `streaming_sha256` / `streaming_zip` 披露。它不启用插件、云端转换、公式重算或模型 OCR。2026-07-23 在 commit `1b2742e` 上的隔离彩排已通过：MarkItDown 0.1.6，3 个来源、6 条 digest 和 SQLite/FTS index 完整，实际编译约 5.0 秒，超限路径约 149 毫秒内阻断。2026-07-24 的真实 XLSX 公式回归进一步确认：工作簿中的 `C12 =SUM(C6:C11)` 与缓存值 `864` 可从单文件 `.insight` 经 CLI/MCP 检索并带回完整 refs；公开合成验收用于持续锁住同一能力，该结果只证明公式证据保留，不代表 Core 重新执行了公式。
- `npm run alpha:release-ref -- --tag v0.1.0-alpha.3`：只确认准备发布的 Git tag 文本与 Skill 默认 Core ref 完全一致。
- `npm run alpha:release-ref -- --tag v0.1.0-alpha.3 --verify-remote`：进一步确认固定 tag 存在且可匿名读取；报告必须为 `remote_status=verified`、`remote_tag_verified=true`、`anonymous_access_verified=true`。它不创建 tag，也不能替代完整的仓库外安装 smoke。
- `npm run verify`：完整仓库验收入口，覆盖 build、全量测试、lint、schema 自检、密钥扫描、中文默认文案扫描和 conformance。

私有开发仓库中的非 Core 应用可按其自身影响面运行额外测试，但这些测试不属于当前精简 Core Alpha 主门禁，也不应被描述为 Core OSS 的先决交付。

## 4. Gold Lock 与公开声明

可审计准确率或大上下文声明必须先完成范围固定、人工 Gold Answer、证据绑定、CLI/MCP 检查、模型输入冻结和 Gold Lock。Gold Lock 未通过时，模型 runner 必须保持零调用；任何 parser quality、MCP parity、引用校验或答案评分出现 `degraded` 时，都不能据此声明准确率或大上下文成功。

只有在 Gold Lock 完整、两个不同 reviewer 的审阅有效、`ready_for_public_claim=true` 且报告的 claim safety 允许时，才可以作出该实验范围内的公开声明。即使满足这些条件，也只能声明已锁定材料、问题集、输入路径和测量方法所支持的结论；不能外推为所有材料、所有模型或所有生产场景的保证。

`self_attested_unverified` 是当前治理边界的一部分：内容哈希可以证明绑定关系，但不能证明 reviewer 的真实身份。密码学签名、外部见证、企业身份系统和强签名属于后续治理增强，当前 Alpha 不可声明为已实现。

## 5. 不可声明的能力

当前 GitHub Core OSS Alpha 不可声明：

- 已发布稳定协议版本或完整平台。
- `source_light` 拥有 raw source 的完整审计证据。
- OCR、图片型 PDF、加密或受保护文件已被通用且完整地解析。
- 所有 XLSX 共享公式都已展开；没有独立公式文本的从属单元格只能标记 `unresolved_shared` 并回查主单元格或原文件。
- 大型 XLSX 已实现端到端常量内存流式解析；当前仍受单来源大小上限保护，但 MarkItDown 与既有 Compiler source analysis 仍可能把单个来源读入内存。
- token 估算是模型账单、真实模型上下文使用量或通用性能承诺。
- 外部 LLM 已由 Core OSS 调用、其回答已自动验证，或其输出可自动写回 base package。
- 已提供 Hub、企业权限、协作、外部安全审计、强身份签名或 reviewer 身份验证。
- 可视化应用、商业输出产品、回答或报告已成为 Core OSS Alpha 的完成或发布前提。
- 任何未完成 Gold Lock、双 reviewer 或 claim safety 门禁的真实材料实验，已证明准确率或可公开宣传。

## 6. GitHub Actions 与本地验证

仓库包含 Kernel、Access、Skill、Proof 与 release 对应的 GitHub Actions 工作流，用于持续集成和变更回归。它们提供远端信号，但在当前 Alpha 就绪度判断中不阻断本地验证：维护者应先按影响面运行上述本地命令，并保留本地命令结果作为可复现证据。

Actions 未运行、排队、平台故障或暂未获得远端结果，不能被写成“本地验证失败”；反过来，本地通过也不等于远端工作流、分支保护或发布流程已经通过。准备合并或发布候选时，仍应结合仓库规则检查相应 Actions 状态，并以 `npm run verify` 作为完整本地验收入口。

## 7. Alpha 结论

当前分支可定位为：一个本地优先、Skill-first、可由 CLI/MCP 等价读取、可披露追溯和降级边界的 `.insight` 上下文信息库 Alpha。其公开主张必须受来源模式、诊断状态、Gold Lock、双 reviewer 和 `self_attested_unverified` 治理边界约束。

# 参与 Open Insight

感谢参与 Open Insight Core OSS Alpha。当前主线是把旧文件编译为可由 LLM / Agent 通过 CLI、MCP 和 Skill 高效、可追溯读取的单文件 `.insight` 上下文信息库。

## 当前贡献范围

优先接受以下方向：

- `.insight` package、Compiler、Validator、CLI、MCP、SDK/Runtime、Skills 和 conformance。
- MarkItDown parser adapter、通用解析诊断、内容寻址、阅读顺序和 compact context。
- source map、digest、source mode、隐私、安全和互操作测试。
- 不依赖私有数据、可公开复现的 benchmark 与 fixture。

非 Core 可视化应用、托管协作、企业权限、正式 v0.2 schema、浏览器模型调用和生产级密钥管理不在当前 Alpha 范围。

## 开发准备

需要 Node.js 20+ 和 npm。MarkItDown 只在 parser 相关测试中按需安装。

```bash
npm install
npm run build:core
npm test
```

开始修改前请阅读：

- `README.md`
- `docs/core-oss-context-kernel.md`
- `docs/core-oss-context-access.md`
- `docs/core-oss-proof-experiment-protocol.md`
- `docs/codex-development-workflow.md`

## 工作方式

1. 先创建或关联 Issue，说明问题、预期行为和公开可复现材料。
2. 从最新目标分支创建小而单一的分支。
3. 保持机器字段、CLI 命令、ID 和状态枚举为稳定英文；用户文案和诊断优先中文。
4. 改机器契约时同步 schema、文档、示例和 contract tests；不静默改变同一 schema version 的语义。
5. 改 `.insight` 结构时同步 spec、schema、validator、fixture 和 conformance。
6. AI 或派生结果必须保持待审、不能自动 `verified`、不可写回 base package。

建议提交使用清晰的主题前缀，例如 `feat:`、`fix:`、`docs:`、`test:`、`chore:`。不要把无关重构、生成产物和功能修改放在同一提交。

## 最小验证

根据改动范围运行最小测试，提交前至少运行：

```bash
npm run scan:secrets
npm run verify
```

涉及 CLI / SDK 时额外运行：

```bash
npm run cli-contracts:check
npm run sdk:ci
```

涉及 Proof 时运行相关 proof tests。非 Core 应用使用各自的独立门禁，不进入公开 Core 验证。

## 数据与安全

- 不提交 `.env`、API key、Bearer token、客户目录、真实业务文件、模型日志、截图或 `output/` 产物。
- fixture 必须是原创、脱敏、可公开授权的数据。
- 默认只读，不执行包内代码，不外发来源数据。
- 安全漏洞不要通过公开 Issue 披露，请按 `SECURITY.md` 使用 GitHub 私密报告。

## Pull Request

PR 必须说明：改动目的、边界、机器契约影响、测试结果、安全影响和未完成项。维护者可能要求把过大的 PR 拆分为可独立验证的切片。

提交贡献即表示你有权提交相关代码和材料，并同意其按仓库 `LICENSE` 发布。

# 安全策略

## 支持范围

Open Insight 当前处于 Core OSS Alpha。安全修复只面向最新 `main` 和维护者明确标记的当前 Alpha 候选；历史分支、私有实验、非 Core 应用部署和第三方模型服务不在开源仓库支持范围内。

## 私密报告漏洞

请使用 GitHub 仓库的 **Security -> Report a vulnerability** 私密报告功能。不要在公开 Issue、Discussion、PR、日志或 `.insight` 示例中包含：

- API key、Bearer token、cookie 或 `.env` 内容；
- 客户文件、个人信息、内部目录和未脱敏截图；
- 可直接利用的攻击步骤或恶意 `.insight` 包。

报告应包含受影响 commit、命令或接口、最小脱敏复现、影响范围和建议修复。维护者目标是在 7 天内确认收到报告；这不是商业 SLA。

## 当前安全边界

- `.insight` 默认只读，不执行包内任意代码。
- CLI/MCP 默认不调用模型、不读取浏览器密钥、不外发数据。
- `source_light` 不内嵌原始二进制文件，但 normalized content 仍可能包含敏感信息。
- generated / overlay / response 不能自动 `verified`，不能写回 base package。
- 默认机器输出不得回显本机绝对路径；显式 debug stack 可能包含本地路径，不得进入公开报告。
- Alpha 尚不提供强签名、企业权限、远程 Hub、生产级密钥托管或正式安全认证。

`npm run scan:secrets` 只是仓库内的已知密钥模式门禁，不等同于外部安全审计、渗透测试或生产环境安全保证。

## 不属于漏洞的情况

一般功能建议、解析质量、模型回答质量和公开 fixture 的内容问题请使用普通 Issue。第三方 LLM、MarkItDown 或操作系统自身漏洞应同时报告给相应上游项目。

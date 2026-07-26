## 目的

<!-- 说明这个 PR 解决的具体问题，以及为什么属于当前 Core OSS Alpha 路线。 -->

## 改动

- 

## 边界与兼容性

- [ ] 未静默改变既有 `.insight` 或 CLI/MCP 机器契约语义；如有变化，已升级 schema version。
- [ ] 已说明 source、lineage、parse diagnostics、digest 或 conformance 的影响。
- [ ] 不执行包内代码，不读取浏览器模型 key，不外发来源数据。
- [ ] AI/generated/overlay 结果不会自动 `verified`，不会写回 base package。
- [ ] 未引入真实客户材料、个人信息、绝对本机路径、`.env`、API key 或生成产物。

## 验证

```text
列出实际运行的命令和结果，不要只写“测试通过”。
```

- [ ] `npm run scan:secrets`
- [ ] 已运行与改动范围匹配的最小测试。
- [ ] 公共入口改动已运行 `npm run verify`。
- [ ] CLI / SDK 改动已运行 `npm run cli-contracts:check` 和 `npm run sdk:ci`。

## 未完成项

<!-- 明确保留的限制、后续 PR 和人工确认项。 -->

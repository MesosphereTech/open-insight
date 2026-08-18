# Open Insight

**一个文件，交给任何 AI。**

同时安装 Open Insight Context Skill 与官方长文 HTML Surface Skill：

```powershell
npx open-insight-cli
```

也可以使用官方 scoped 品牌入口：

```powershell
npx @mesospheretech/open-insight
```

安装完成后，直接告诉你的 AI：

> 把这个文件夹打包成一个 `.insight` 文件，然后基于来源引用回答我的问题。

也可以直接用自然语言说：

- “读取这个 `.insight`，告诉我里面有哪些资料和主要内容。”
- “根据这个 `.insight` 回答问题，并注明来源文件和原文位置。”
- “使用 Open Insight Surface Skill，把这个 `.insight` 生成一份好看的长文 HTML 阅读稿。”
- “使用当前 AI 客户端，根据这个 `.insight` 生成 Word 报告或 PPT，并保留重要内容的来源。”
- “为这个 `.insight` 启动只读 MCP，供当前 AI 持续查询。”

Open Insight 内置长文 HTML Surface；Word 或 PPT 当前由用户所用 AI 客户端
使用自身文档能力生成。所有生成物均保存在 base `.insight` 包之外。

检测到 WorkBuddy 时，同一条安装命令还会自动注册通用只读 MCP。它不会扫描
文件；每次工具调用必须明确指定要读取的 `.insight` 路径。

第一次编译或读取时，Skill 会自动下载并校验固定版本的本地 Core。Open
Insight 不安装模型、不读取模型密钥，也不默认上传来源文件。

安装本身不会扫描或上传文件；只有你明确指定文件夹或 `.insight` 后才会读取。

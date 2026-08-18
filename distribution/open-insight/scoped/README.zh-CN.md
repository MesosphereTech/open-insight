# Open Insight

**一个文件，交给任何 AI。**

安装 Open Insight Context Skill：

```powershell
npx @mesospheretech/open-insight
```

安装完成后，直接告诉你的 AI：

> 把这个文件夹打包成一个 `.insight` 文件，然后基于来源引用回答我的问题。

也可以直接让 AI 读取已有 `.insight`、按来源位置回答问题、生成好看的 HTML、
Word 报告或 PPT 并另存为外部文件，或启动只读 MCP。Open Insight 提供事实和
可追溯上下文，最终文件由当前 AI 使用自身的文档能力生成。安装本身不会扫描
或上传文件，只有你明确指定资料后才会读取。

这是 `open-insight-cli` 的官方 scoped 品牌别名，固定使用同一个安装器版本，
不维护第二套实现。

当前公开 npm 包提供 Alpha 安装入口；安装器与 Skill 使用同一固定 Core 版本。

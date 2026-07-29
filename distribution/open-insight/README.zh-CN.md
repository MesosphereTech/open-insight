# Open Insight

**一个文件，交给任何 AI。**

安装 Open Insight Context Skill：

```powershell
npx open-insight-cli
```

也可以使用官方 scoped 品牌入口：

```powershell
npx @mesospheretech/open-insight
```

安装完成后，直接告诉你的 AI：

> 把这个文件夹打包成一个 `.insight` 文件，然后基于来源引用回答我的问题。

第一次编译或读取时，Skill 会自动下载并校验固定版本的本地 Core。Open
Insight 不安装模型、不读取模型密钥，也不默认上传来源文件。

当前仓库仍处于私有验收阶段，因此安装机器需要拥有
`MesosphereTech/open-insight` 的 GitHub 访问权限。仓库公开后，同一条命令
可以匿名使用。当前公开 npm 包仅提供 Alpha 安装入口；Core 仓库和代码仍
保持私有。

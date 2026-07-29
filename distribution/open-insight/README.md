# Open Insight

**One File, Any AI.**

Install the Open Insight Context Skill:

```bash
npx open-insight-cli
```

Official scoped alias:

```bash
npx @mesospheretech/open-insight
```

Then ask your AI:

> Package this folder into one `.insight` file, then use it to answer my
> questions with source references.

The installer uses a pinned Open Insight release. On first compile or read, the
Skill prepares and verifies the matching local Core automatically. Open Insight
does not install a model, read model API keys, or upload source files.

This public npm package is the Alpha installer only. The pinned Core repository
remains private during owner acceptance, so installation currently requires
GitHub access to `MesosphereTech/open-insight`. Once the Core repository becomes
public, the same command will work without repository access.

中文说明见 [README.zh-CN.md](README.zh-CN.md)。

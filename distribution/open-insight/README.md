# Open Insight

**One File, Any AI.**

Install the Open Insight Context and official long-form HTML Surface Skills:

```bash
npx open-insight-cli
```

Official scoped alias:

```bash
npx @mesospheretech/open-insight
```

Then ask your AI:

> Use Open Insight to package this folder into one `.insight` file. Tell me the
> output path and any parsing warnings.

You can also ask naturally:

- "Read this `.insight` and explain what information it contains."
- "Answer my question and cite the source file and location."
- "Use the Open Insight Surface Skill to create a polished long-form HTML reading copy from this `.insight`."
- "Use this `.insight` as evidence to create a Word report or presentation with the current AI client."
- "Start read-only MCP access for this `.insight`."

Open Insight includes the long-form HTML Surface. Your current AI client uses
its own document tools for Word or presentations. Every generated file stays
outside the base `.insight` package.

When WorkBuddy is detected, the same command also registers the generic
read-only Open Insight MCP. It never scans for files: each tool call must name
the `.insight` path explicitly.

The installer uses a pinned Open Insight release. On first compile or read, the
Skill prepares and verifies the matching local Core automatically. Open Insight
does not install a model, read model API keys, or upload source files.

Installation alone does not scan or upload files. Open Insight acts only on the
folder or package you explicitly identify.

中文说明见 [README.zh-CN.md](README.zh-CN.md)。

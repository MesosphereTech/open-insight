#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createModelFreeChildEnv } from "./child-env.mjs";
import { ensureCoreRoot } from "./core-runtime.mjs";
import {
  ensureParserRuntime,
  parserRuntimeRequirement
} from "./parser-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export async function main() {
  const invocationRoot = process.cwd();
  const forwardedArgs = process.argv.slice(2);
  const coreRoot = await ensureCoreRoot({
    scriptDir,
    invocationRoot,
    requiredPaths: ["scripts/compile-context-folder.mjs"]
  });
  const ocrFlagIndex = forwardedArgs.indexOf("--ocr");
  const allowOcr = ocrFlagIndex >= 0 && forwardedArgs[ocrFlagIndex + 1] === "llm";
  const parserRequirement = await parserRuntimeRequirement(forwardedArgs, invocationRoot);
  const parserRuntime = parserRequirement.required
    ? await ensureParserRuntime({
        requireOcr: allowOcr,
        progress: (message) => process.stderr.write(`[Open Insight] ${message}\n`)
      })
    : undefined;
  const result = spawnSync(process.execPath, [path.join(coreRoot, "scripts", "compile-context-folder.mjs"), ...forwardedArgs], {
    cwd: coreRoot,
    stdio: "inherit",
    shell: false,
    env: createModelFreeChildEnv(
      {
        OPEN_INSIGHT_SKILL_INVOCATION_ROOT: invocationRoot,
        OPEN_INSIGHT_SKILL_CLI_WRAPPER: path.join(scriptDir, "cli.mjs"),
        ...(parserRuntime ? { OPEN_INSIGHT_PYTHON: parserRuntime.python_path } : {})
      },
      { allowOcr }
    )
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModelFreeChildEnv } from "./child-env.mjs";
import { ensureCoreRoot } from "./core-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const invocationRoot = process.cwd();
  const coreRoot = await ensureCoreRoot({
    scriptDir,
    invocationRoot,
    requiredPaths: ["scripts/compile-context-folder.mjs"]
  });
  const forwardedArgs = process.argv.slice(2);
  const ocrFlagIndex = forwardedArgs.indexOf("--ocr");
  const allowOcr = ocrFlagIndex >= 0 && forwardedArgs[ocrFlagIndex + 1] === "llm";
  const result = spawnSync(process.execPath, [path.join(coreRoot, "scripts", "compile-context-folder.mjs"), ...forwardedArgs], {
    cwd: coreRoot,
    stdio: "inherit",
    shell: false,
    env: createModelFreeChildEnv(
      {
        OPEN_INSIGHT_SKILL_INVOCATION_ROOT: invocationRoot,
        OPEN_INSIGHT_SKILL_CLI_WRAPPER: path.join(scriptDir, "cli.mjs")
      },
      { allowOcr }
    )
  });
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

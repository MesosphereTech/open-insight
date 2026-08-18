#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureCoreRoot } from "../../open-insight-context/scripts/core-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export async function main() {
  const invocationRoot = process.cwd();
  const requestedArgs = process.argv.slice(2);
  const coreRoot = await ensureCoreRoot({
    scriptDir: path.resolve(scriptDir, "../../open-insight-context/scripts"),
    invocationRoot,
    requiredPaths: ["apps/cli/dist/index.js"]
  });
  const forwardedArgs = requestedArgs.includes("--core-home")
    ? requestedArgs
    : ["--core-home", coreRoot, ...requestedArgs];
  const result = spawnSync(process.execPath, [path.join(scriptDir, "render-full-document-html.mjs"), ...forwardedArgs], {
    cwd: invocationRoot,
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

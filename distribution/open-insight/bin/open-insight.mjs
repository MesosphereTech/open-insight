#!/usr/bin/env node
import { runOpenInsightInstaller } from "../src/index.mjs";

try {
  const result = runOpenInsightInstaller(process.argv.slice(2));
  process.exitCode = result.exitCode;
} catch (error) {
  process.stderr.write(
    `Open Insight installation failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}

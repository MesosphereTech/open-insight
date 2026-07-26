#!/usr/bin/env node
import { runCli } from "./cli.js";
import { parseMcpServeArgs, serveMcpStdio } from "./mcpServer.js";

const invocationRoot = process.env["INIT_CWD"] ?? process.cwd();
const args = process.argv.slice(2);

if (args[0] === "mcp") {
  Promise.resolve()
    .then(async () => {
      const options = parseMcpServeArgs(args, invocationRoot);
      await serveMcpStdio(options);
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
} else {
  runCli(args, invocationRoot, { loadEnv: true })
    .then((result) => {
      console.log(result.output);
      process.exitCode = result.exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@open-insight/domain-packs": fileURLToPath(
        new URL("./packages/insight-domain-packs/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    include: [
      "packages/insight-compiler/src/**/*.test.ts",
      "packages/insight-domain-packs/src/**/*.test.ts",
      "apps/cli/src/localEnv.test.ts",
      "tests/public-core-readme-docs.test.ts",
      "tests/public-cli-contracts.test.ts",
      "tests/core-oss-context-skill-docs.test.ts",
      "tests/core-oss-skill-folder-compile.test.ts",
      "tests/core-oss-skill-standalone-install.test.ts"
    ],
    exclude: ["node_modules/**", "dist/**", "output/**", "tmp/**", "unpacked/**"],
    environment: "node",
    testTimeout: 30_000
  }
});

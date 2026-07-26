import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnvFile, parseEnvLine } from "./localEnv.js";

const modelEnvKeys = [
  "OPEN_INSIGHT_MODEL_BASE_URL",
  "OPEN_INSIGHT_MODEL_API_KEY",
  "OPEN_INSIGHT_MODEL_NAME",
  "XIAOMI_API_BASE_URL",
  "XIAOMI_API_KEY",
  "XIAOMI_MODEL"
];

describe("local model env loader", () => {
  it("parses simple env lines without treating comments as values", () => {
    expect(parseEnvLine("XIAOMI_MODEL = test-chat # local note")).toEqual({
      key: "XIAOMI_MODEL",
      value: "test-chat"
    });
    expect(parseEnvLine('export XIAOMI_API_BASE_URL="https://token-plan-cn.xiaomimimo.com/v1"')).toEqual({
      key: "XIAOMI_API_BASE_URL",
      value: "https://token-plan-cn.xiaomimimo.com/v1"
    });
    expect(parseEnvLine('XIAOMI_API_KEY="replace-with-local-secret" # do not commit real keys')).toEqual({
      key: "XIAOMI_API_KEY",
      value: "replace-with-local-secret"
    });
    expect(parseEnvLine("# XIAOMI_API_KEY=replace-with-local-secret")).toBeUndefined();
  });

  it("loads only model env keys from local .env and does not override existing env", async () => {
    await withModelEnvRestored(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "open-insight-local-env-"));

      try {
        process.env.XIAOMI_MODEL = "already-selected-model";
        await writeFile(
          path.join(dir, ".env"),
          [
            "XIAOMI_API_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1",
            "XIAOMI_API_KEY=replace-with-local-secret",
            "XIAOMI_MODEL=model-from-dot-env",
            "UNRELATED_SETTING=ignored"
          ].join("\n"),
          "utf8"
        );

        const result = await loadLocalEnvFile(dir);

        expect(result.loaded_keys).toEqual(["XIAOMI_API_BASE_URL", "XIAOMI_API_KEY"]);
        expect(process.env.XIAOMI_API_BASE_URL).toBe("https://token-plan-cn.xiaomimimo.com/v1");
        expect(process.env.XIAOMI_API_KEY).toBe("replace-with-local-secret");
        expect(process.env.XIAOMI_MODEL).toBe("already-selected-model");
        expect(process.env.UNRELATED_SETTING).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  it("returns an empty result when .env does not exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "open-insight-no-local-env-"));

    try {
      const result = await loadLocalEnvFile(dir);

      expect(result.loaded_keys).toEqual([]);
      expect(result.file_path).toBe(path.join(dir, ".env"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function withModelEnvRestored(run: () => Promise<void>): Promise<void> {
  const previous = new Map(modelEnvKeys.map((key) => [key, process.env[key]] as const));

  for (const key of modelEnvKeys) {
    delete process.env[key];
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

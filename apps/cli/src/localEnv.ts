import { readFile } from "node:fs/promises";
import path from "node:path";

const MODEL_ENV_KEYS = new Set([
  "OPEN_INSIGHT_MODEL_BASE_URL",
  "OPEN_INSIGHT_MODEL_API_KEY",
  "OPEN_INSIGHT_MODEL_NAME",
  "XIAOMI_API_BASE_URL",
  "XIAOMI_API_KEY",
  "XIAOMI_MODEL"
]);

export interface LoadLocalEnvFileResult {
  file_path: string;
  loaded_keys: string[];
}

export async function loadLocalEnvFile(invocationRoot: string, fileName = ".env"): Promise<LoadLocalEnvFileResult> {
  const filePath = path.resolve(invocationRoot, fileName);
  let content: string;

  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { file_path: filePath, loaded_keys: [] };
    }

    throw new Error(`读取本地模型环境文件失败：${filePath}`);
  }

  const loadedKeys: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);

    if (!parsed || !MODEL_ENV_KEYS.has(parsed.key)) {
      continue;
    }

    if (process.env[parsed.key] !== undefined && process.env[parsed.key] !== "") {
      continue;
    }

    process.env[parsed.key] = parsed.value;
    loadedKeys.push(parsed.key);
  }

  return { file_path: filePath, loaded_keys: loadedKeys };
}

export function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();

  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return undefined;
  }

  const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const equalsIndex = normalized.indexOf("=");

  if (equalsIndex <= 0) {
    return undefined;
  }

  const key = normalized.slice(0, equalsIndex).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    value: parseEnvValue(normalized.slice(equalsIndex + 1).trim())
  };
}

function parseEnvValue(rawValue: string): string {
  const value = stripInlineComment(rawValue).trim();

  if (value.length >= 2) {
    const quote = value[0];

    if ((quote === `"` || quote === `'`) && value.endsWith(quote)) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function stripInlineComment(value: string): string {
  let quote: `"` | `'` | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if ((char === `"` || char === `'`) && (index === 0 || value[index - 1] !== "\\")) {
      quote = quote === char ? undefined : quote ?? char;
      continue;
    }

    if (char === "#" && quote === undefined && (index === 0 || /\s/.test(value[index - 1] ?? ""))) {
      return value.slice(0, index);
    }
  }

  return value;
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

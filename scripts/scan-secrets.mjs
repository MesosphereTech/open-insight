#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const binaryExtensions = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".zip"
]);

const patterns = [
  {
    name: "xiaomi-token-plan-key",
    pattern: /tp-[A-Za-z0-9]{20,}/g
  },
  {
    name: "openai-style-secret-key",
    pattern: /sk-[A-Za-z0-9_-]{20,}/g
  },
  {
    name: "model-api-key-env-assignment",
    pattern:
      /\b(?:OPEN_INSIGHT_MODEL_API_KEY|XIAOMI_API_KEY|VITE_OPEN_INSIGHT_MODEL_API_KEY|VITE_XIAOMI_API_KEY)\s*=\s*(?!["']?(?:replace-with-|test-secret|dummy-secret)\b)(?!\s*$)[^\s#;]+/g
  }
];

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8"
})
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const findings = [];

for (const filePath of files) {
  if (shouldSkip(filePath)) {
    continue;
  }

  const content = readTextFile(filePath);
  if (content === undefined) {
    continue;
  }

  const lineStarts = buildLineStarts(content);

  for (const { name, pattern } of patterns) {
    pattern.lastIndex = 0;

    for (const match of content.matchAll(pattern)) {
      findings.push({
        filePath,
        line: findLineNumber(lineStarts, match.index ?? 0),
        pattern: name
      });
    }
  }
}

if (findings.length > 0) {
  console.error("密钥扫描发现疑似敏感信息。请移除真实密钥，改用本机 .env 或终端环境变量。");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} ${finding.pattern}`);
  }
  process.exitCode = 1;
} else {
  console.log("密钥扫描通过：未发现已跟踪或待提交文件中的模型密钥模式。");
}

function shouldSkip(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");
  const extension = dotIndex >= 0 ? normalized.slice(dotIndex) : "";

  if (binaryExtensions.has(extension)) {
    return true;
  }

  try {
    return statSync(filePath).size > 2_000_000;
  } catch {
    return true;
  }
}

function readTextFile(filePath) {
  try {
    const buffer = readFileSync(filePath);

    if (buffer.includes(0)) {
      return undefined;
    }

    return buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

function buildLineStarts(content) {
  const starts = [0];

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function findLineNumber(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (lineStarts[mid] <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}

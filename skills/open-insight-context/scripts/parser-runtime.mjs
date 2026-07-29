import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OPEN_INSIGHT_MARKITDOWN_VERSION = "0.1.6";
export const OPEN_INSIGHT_MARKITDOWN_OCR_VERSION = "0.1.0";

const parserExtensions = new Set([".pdf", ".docx", ".xlsx", ".pptx"]);
const disabledValues = new Set(["0", "false", "no", "off"]);
const markerName = "open-insight-parser-runtime.json";
const secretNamePattern =
  /(?:API_KEY|TOKEN|SECRET|PASSWORD|BEARER|AUTHORIZATION)/iu;

function parserInstallEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !secretNamePattern.test(name))
  );
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryContainsParserSource(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContainsParserSource(entryPath)) return true;
    } else if (
      entry.isFile() &&
      parserExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

export async function parserRuntimeRequirement(args, invocationRoot = process.cwd()) {
  const parser = readOption(args, "--parser", "auto");
  const ocr = readOption(args, "--ocr", "off");
  if (parser === "builtin") {
    return { required: false, parser, ocr, reason: "builtin_parser_selected" };
  }
  if (parser === "markitdown") {
    return { required: true, parser, ocr, reason: "markitdown_parser_selected" };
  }

  const sourceDirValue = readOption(args, "--source-dir");
  if (!sourceDirValue) {
    return { required: false, parser, ocr, reason: "source_directory_missing" };
  }
  const sourceDir = path.resolve(invocationRoot, sourceDirValue);
  if (!(await pathExists(sourceDir))) {
    return { required: false, parser, ocr, reason: "source_directory_missing" };
  }
  const required = await directoryContainsParserSource(sourceDir);
  return {
    required,
    parser,
    ocr,
    reason: required ? "parser_source_detected" : "simple_sources_only"
  };
}

export function defaultParserRuntimeRoot(env = process.env) {
  return path.resolve(
    env.OPEN_INSIGHT_PARSER_HOME ||
      path.join(os.homedir(), ".open-insight", "parsers"),
    `markitdown-${OPEN_INSIGHT_MARKITDOWN_VERSION}`
  );
}

function runtimePythonPath(runtimeRoot, platform = process.platform) {
  return platform === "win32"
    ? path.join(runtimeRoot, "Scripts", "python.exe")
    : path.join(runtimeRoot, "bin", "python");
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 1_200_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    env: options.env
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
    error: result.error
  };
}

function pythonCandidates(env = process.env, platform = process.platform) {
  if (env.OPEN_INSIGHT_PYTHON) {
    return [{ command: env.OPEN_INSIGHT_PYTHON, prefixArgs: [], source: "explicit" }];
  }
  return platform === "win32"
    ? [
        { command: "python", prefixArgs: [], source: "system" },
        { command: "py", prefixArgs: ["-3"], source: "system" }
      ]
    : [
        { command: "python3", prefixArgs: [], source: "system" },
        { command: "python", prefixArgs: [], source: "system" }
      ];
}

function detectHostPython(run, env, platform) {
  for (const candidate of pythonCandidates(env, platform)) {
    const result = run(
      candidate.command,
      [
        ...candidate.prefixArgs,
        "-c",
        "import sys; print('.'.join(map(str, sys.version_info[:3])))"
      ],
      { env }
    );
    if (!result.ok) continue;
    const [major, minor] = result.stdout
      .split(".")
      .map((value) => Number.parseInt(value, 10));
    if (major > 3 || (major === 3 && minor >= 10)) {
      return { ...candidate, version: result.stdout };
    }
  }
  return undefined;
}

function versionProbe(run, pythonPath, distribution, env) {
  return run(
    pythonPath,
    [
      "-c",
      `from importlib.metadata import version; print(version(${JSON.stringify(distribution)}))`
    ],
    { env }
  );
}

async function readMarker(runtimeRoot) {
  return readFile(path.join(runtimeRoot, markerName), "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => undefined);
}

async function writeMarker(runtimeRoot, marker) {
  const target = path.join(runtimeRoot, markerName);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  await rm(target, { force: true });
  await rename(temporary, target);
}

async function acquireInstallLock(runtimeRoot) {
  const lockPath = `${runtimeRoot}.install.lock`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_200_000) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`,
        "utf8"
      );
      await handle.close();
      return async () => unlink(lockPath).catch(() => {});
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => undefined);
      if (lockStat && Date.now() - lockStat.mtimeMs > 1_800_000) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    "等待 MarkItDown parser runtime 安装锁超时。请确认没有其他 Open Insight 首次编译仍在运行，然后重试。"
  );
}

function installFailure(label, result) {
  const detail = String(
    result.error?.message ||
    result.stderr ||
    result.stdout ||
    `退出码 ${result.status}`
  )
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1[REDACTED]@");
  throw new Error(`${label}失败：${detail}`);
}

export async function ensureParserRuntime(options = {}) {
  const env = options.env ?? process.env;
  const installEnv = parserInstallEnv(env);
  const platform = options.platform ?? process.platform;
  const run = options.run ?? defaultRun;
  const progress = options.progress ?? (() => {});
  const requireOcr = options.requireOcr === true;
  const autoInstallDisabled = disabledValues.has(
    String(env.OPEN_INSIGHT_AUTO_INSTALL_PARSER ?? "1")
      .trim()
      .toLowerCase()
  );

  if (autoInstallDisabled) {
    throw new Error(
      "材料需要 MarkItDown，但 OPEN_INSIGHT_AUTO_INSTALL_PARSER 已关闭。请删除该设置后重试，或通过 OPEN_INSIGHT_PYTHON 指定已安装 MarkItDown 0.1.6 的 Python。"
    );
  }

  if (env.OPEN_INSIGHT_PYTHON) {
    const markitdown = versionProbe(
      run,
      env.OPEN_INSIGHT_PYTHON,
      "markitdown",
      installEnv
    );
    if (!markitdown.ok || markitdown.stdout !== OPEN_INSIGHT_MARKITDOWN_VERSION) {
      throw new Error(
        `OPEN_INSIGHT_PYTHON 指向的环境没有固定版本 MarkItDown ${OPEN_INSIGHT_MARKITDOWN_VERSION}；Open Insight 不会修改用户指定的 Python 环境。`
      );
    }
    if (requireOcr) {
      const ocr = versionProbe(
        run,
        env.OPEN_INSIGHT_PYTHON,
        "markitdown-ocr",
        installEnv
      );
      if (!ocr.ok || ocr.stdout !== OPEN_INSIGHT_MARKITDOWN_OCR_VERSION) {
        throw new Error(
          `已显式启用 --ocr llm，但 OPEN_INSIGHT_PYTHON 环境没有 markitdown-ocr ${OPEN_INSIGHT_MARKITDOWN_OCR_VERSION}。`
        );
      }
    }
    return {
      status: "ready",
      source: "explicit_python",
      python_path: env.OPEN_INSIGHT_PYTHON,
      markitdown_version: markitdown.stdout,
      ocr_plugin_ready: requireOcr
    };
  }

  const runtimeRoot = options.runtimeRoot ?? defaultParserRuntimeRoot(env);
  const pythonPath = runtimePythonPath(runtimeRoot, platform);
  const existingMarker = await readMarker(runtimeRoot);
  const markitdownProbe = (await pathExists(pythonPath))
    ? versionProbe(run, pythonPath, "markitdown", installEnv)
    : { ok: false };
  const ocrProbe =
    requireOcr && markitdownProbe.ok
      ? versionProbe(run, pythonPath, "markitdown-ocr", installEnv)
      : { ok: false };

  if (
    existingMarker?.markitdown_version === OPEN_INSIGHT_MARKITDOWN_VERSION &&
    markitdownProbe.ok &&
    markitdownProbe.stdout === OPEN_INSIGHT_MARKITDOWN_VERSION &&
    (!requireOcr ||
      (ocrProbe.ok && ocrProbe.stdout === OPEN_INSIGHT_MARKITDOWN_OCR_VERSION))
  ) {
    return {
      status: "ready",
      source: "managed_cache",
      python_path: pythonPath,
      markitdown_version: markitdownProbe.stdout,
      ocr_plugin_ready: requireOcr
    };
  }

  await mkdir(path.dirname(runtimeRoot), { recursive: true });
  const releaseLock = await acquireInstallLock(runtimeRoot);
  try {
    const markerAfterLock = await readMarker(runtimeRoot);
    const markitdownAfterLock = (await pathExists(pythonPath))
      ? versionProbe(run, pythonPath, "markitdown", installEnv)
      : { ok: false };
    const ocrAfterLock =
      requireOcr && markitdownAfterLock.ok
        ? versionProbe(run, pythonPath, "markitdown-ocr", installEnv)
        : { ok: false };
    if (
      markerAfterLock?.markitdown_version === OPEN_INSIGHT_MARKITDOWN_VERSION &&
      markitdownAfterLock.ok &&
      markitdownAfterLock.stdout === OPEN_INSIGHT_MARKITDOWN_VERSION &&
      (!requireOcr ||
        (ocrAfterLock.ok &&
          ocrAfterLock.stdout === OPEN_INSIGHT_MARKITDOWN_OCR_VERSION))
    ) {
      return {
        status: "ready",
        source: "managed_cache",
        python_path: pythonPath,
        markitdown_version: markitdownAfterLock.stdout,
        ocr_plugin_ready: requireOcr
      };
    }

    const hostPython = detectHostPython(run, installEnv, platform);
    if (!hostPython) {
      throw new Error(
        "Open Insight 需要 Python 3.10+ 来自动准备 MarkItDown，但当前未找到可用 Python。安装 Python 后重新执行原命令即可，不需要手工 pip install。"
      );
    }

    if (!(await pathExists(pythonPath))) {
      progress("正在创建隔离的 MarkItDown Python 环境");
      const venv = run(
        hostPython.command,
        [...hostPython.prefixArgs, "-m", "venv", runtimeRoot],
        { env: installEnv }
      );
      if (!venv.ok) installFailure("创建隔离 Python 环境", venv);
    }

    progress(`正在安装固定版本 MarkItDown ${OPEN_INSIGHT_MARKITDOWN_VERSION}`);
    const requirements = [`markitdown[all]==${OPEN_INSIGHT_MARKITDOWN_VERSION}`];
    if (requireOcr) {
      requirements.push(
        `markitdown-ocr==${OPEN_INSIGHT_MARKITDOWN_OCR_VERSION}`
      );
    }
    const install = run(
      pythonPath,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        ...requirements
      ],
      { env: installEnv }
    );
    if (!install.ok) installFailure("安装 MarkItDown parser runtime", install);

    const verifiedMarkitdown = versionProbe(
      run,
      pythonPath,
      "markitdown",
      installEnv
    );
    if (
      !verifiedMarkitdown.ok ||
      verifiedMarkitdown.stdout !== OPEN_INSIGHT_MARKITDOWN_VERSION
    ) {
      installFailure("校验 MarkItDown 固定版本", verifiedMarkitdown);
    }

    if (requireOcr) {
      const verifiedOcr = versionProbe(
        run,
        pythonPath,
        "markitdown-ocr",
        installEnv
      );
      if (
        !verifiedOcr.ok ||
        verifiedOcr.stdout !== OPEN_INSIGHT_MARKITDOWN_OCR_VERSION
      ) {
        installFailure("校验 markitdown-ocr 固定版本", verifiedOcr);
      }
    }

    await writeMarker(runtimeRoot, {
      schema_version: "open-insight.parser-runtime.v0.1",
      managed: true,
      markitdown_version: OPEN_INSIGHT_MARKITDOWN_VERSION,
      ocr_plugin_version: requireOcr
        ? OPEN_INSIGHT_MARKITDOWN_OCR_VERSION
        : null,
      python_version: hostPython.version
    });
    return {
      status: "ready",
      source: "managed_install",
      python_path: pythonPath,
      markitdown_version: OPEN_INSIGHT_MARKITDOWN_VERSION,
      ocr_plugin_ready: requireOcr
    };
  } finally {
    await releaseLock();
  }
}

import os from "node:os";
import path from "node:path";

export const OPEN_INSIGHT_DEFAULT_CORE_REF = "v0.1.0-alpha.1";
export const OPEN_INSIGHT_DEFAULT_CORE_REPOSITORY = "https://github.com/MesosphereTech/open-insight.git";
export const OPEN_INSIGHT_MINIMUM_NODE_VERSION = "20.19.0";
export const OPEN_INSIGHT_MODERN_NODE_VERSION = "22.12.0";
export const OPEN_INSIGHT_SUPPORTED_NODE_RANGE = "^20.19.0 || >=22.12.0";
export const OPEN_INSIGHT_MINIMUM_NPM_MAJOR = 10;

export function normalizeCoreRef(value = process.env.OPEN_INSIGHT_CORE_REF || OPEN_INSIGHT_DEFAULT_CORE_REF) {
  const ref = String(value).trim();
  const validShape = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(ref);
  const invalidSequence =
    ref.includes("..") ||
    ref.includes("//") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock");
  if (!validShape || invalidSequence) {
    throw new Error(
      "OPEN_INSIGHT_CORE_REF 不是安全的 Git tag/branch 名称。请使用发布 tag（例如 v0.1.0-alpha.1）或普通分支名。"
    );
  }
  return ref;
}

export function coreRefInstallSegment(ref) {
  return ref.replace(/[^A-Za-z0-9._-]+/gu, "-");
}

export function defaultCoreInstallRoot(ref = normalizeCoreRef()) {
  return path.resolve(os.homedir(), ".open-insight", "core", coreRefInstallSegment(ref));
}

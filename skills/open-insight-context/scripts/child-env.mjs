const blockedModelEnvPatterns = [
  /^OPEN_INSIGHT_MODEL_/iu,
  /^OPEN_INSIGHT_OCR_/iu,
  /^XIAOMI_/iu,
  /^OPENAI_/iu,
  /^ANTHROPIC_/iu,
  /^GEMINI_/iu,
  /^DEEPSEEK_/iu,
  /^AZURE_OPENAI_/iu,
  /^(?:GOOGLE|VERTEX)_.*(?:API_KEY|TOKEN)$/iu,
  /^VITE_.*(?:API_KEY|TOKEN|SECRET)$/iu,
  /^CODEX_.*(?:API_KEY|TOKEN|SECRET)$/iu
];

const allowedOcrEnvNames = new Set([
  "OPEN_INSIGHT_OCR_API_KEY",
  "OPEN_INSIGHT_OCR_MODEL",
  "OPEN_INSIGHT_OCR_BASE_URL"
]);

export function createModelFreeChildEnv(overrides = {}, options = {}) {
  const allowOcr = options.allowOcr === true;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      if (allowOcr && allowedOcrEnvNames.has(name)) {
        return true;
      }
      return !blockedModelEnvPatterns.some((pattern) => pattern.test(name));
    })
  );
  return {
    ...env,
    ...overrides
  };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Surface Skill CLI runtime launch", () => {
  it("uses OPEN_INSIGHT_CORE_HOME and the built CLI", async () => {
    const source = await readFile(path.resolve("skills/open-insight-full-document-surface/scripts/render-full-document-html.mjs"), "utf8");
    const wrapper = await readFile(path.resolve("skills/open-insight-full-document-surface/scripts/render.mjs"), "utf8");
    expect(source).toContain("process.env.OPEN_INSIGHT_CORE_HOME");
    expect(source).toContain('path.join(current, "apps", "cli", "dist", "index.js")');
    expect(source).toContain("spawnSync(process.execPath, [cliEntry, ...args]");
    expect(source).not.toContain('spawnSync("npm"');
    expect(wrapper).toContain("../../open-insight-context/scripts/core-runtime.mjs");
    expect(wrapper).toContain("ensureCoreRoot");
    expect(wrapper).toContain('requiredPaths: ["apps/cli/dist/index.js"]');
  });
});

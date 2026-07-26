import Ajv2020 from "ajv/dist/2020.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type ContractIndex = {
  schema_version: string;
  contracts: Array<{
    id: string;
    command: string;
    schema_file: string;
    result_schema_version: string;
  }>;
};

describe("public CLI machine contracts", () => {
  it("publishes an indexed, unique, compilable JSON schema for every contract", async () => {
    const contractRoot = path.resolve("spec/cli-contracts");
    const index = JSON.parse(
      await readFile(path.join(contractRoot, "index.json"), "utf8")
    ) as ContractIndex;
    expect(index.schema_version).toBe("open-insight.cli-contract-index.v0.1");
    expect(index.contracts.length).toBeGreaterThan(20);

    const ids = new Set<string>();
    const schemaFiles = new Set<string>();
    for (const contract of index.contracts) {
      expect(contract.id).toBeTruthy();
      expect(contract.command).toBeTruthy();
      expect(contract.result_schema_version).toMatch(/^open-insight\./u);
      expect(ids.has(contract.id)).toBe(false);
      expect(schemaFiles.has(contract.schema_file)).toBe(false);
      ids.add(contract.id);
      schemaFiles.add(contract.schema_file);

      const schema = JSON.parse(
        await readFile(path.join(contractRoot, contract.schema_file), "utf8")
      );
      expect(schema.$schema).toContain("json-schema");
      expect(schema.properties?.schema_version).toBeDefined();
      expect(JSON.stringify(schema)).toContain(contract.result_schema_version);
      expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
    }
  });

  it("does not leave unindexed result schemas in the public contract directory", async () => {
    const contractRoot = path.resolve("spec/cli-contracts");
    const index = JSON.parse(
      await readFile(path.join(contractRoot, "index.json"), "utf8")
    ) as ContractIndex;
    const indexed = new Set(index.contracts.map((contract) => contract.schema_file));
    const schemas = (await readdir(contractRoot))
      .filter((name) => name.endsWith(".schema.json"))
      .filter((name) => name !== "index.schema.json")
      .sort();
    expect(schemas.length).toBe(indexed.size);
    expect(schemas.filter((name) => !indexed.has(name))).toEqual([]);
  });
});

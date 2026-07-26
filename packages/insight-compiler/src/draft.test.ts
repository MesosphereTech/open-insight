import { describe, expect, it } from "vitest";
import { requireDomainPack } from "@open-insight/domain-packs";
import { createHash } from "node:crypto";

import {
  applyDraftQuestionOverrides,
  buildDraftPackageFiles,
  buildDraftPlan,
  buildDraftSourceProfileWarnings,
  validateDraftPackageFiles
} from "./draft.js";

describe("insight draft planner", () => {
  it("builds a deterministic question plan from a template and sources", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview\nRisk factors",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    expect(plan.manifest).toMatchObject({
      package_id: "org.example.bond",
      title: "Bond Insight",
      created_at: "2026-04-29T00:00:00.000Z"
    });
    expect(plan.questions.map((question) => question.id)).toEqual(["q_issuer_overview", "q_risk_factors"]);
    expect(plan.questions.every((question) => question.status === "needs_review")).toBe(true);
  });

  it("marks questions as data gaps when no source files are available", () => {
    const plan = buildDraftPlan({
      title: "Empty",
      packageId: "org.example.empty",
      template: "Retention analysis",
      sources: [],
      createdAt: "2026-04-29T00:00:00.000Z"
    });

    expect(plan.questions[0]?.status).toBe("needs_data");
    expect(plan.skills.find((skill) => skill.name === "Answerability Scanner")?.output).toBe("1 data gaps");
  });

  it("returns Chinese source profile warnings for weak tabular sources", () => {
    expect(
      buildDraftSourceProfileWarnings([
        {
          name: "comments.csv",
          type: "csv",
          columns: [{ name: "comment", type: "string" }]
        },
        {
          name: "totals.csv",
          type: "csv",
          columns: [{ name: "revenue", type: "number" }]
        },
        {
          name: "empty.xlsx",
          type: "xlsx"
        },
        {
          name: "prospectus.pdf",
          type: "pdf"
        }
      ])
    ).toEqual([
      "来源 comments.csv 未识别到可聚合数值字段，无法自动生成指标草稿。",
      "来源 totals.csv 未识别到维度字段，无法自动生成图表草稿。",
      "来源 empty.xlsx 未识别到字段，无法自动生成指标和图表草稿。"
    ]);
  });

  it("uses a domain pack as structured generation context", () => {
    const domainPack = requireDomainPack("bond_analysis");
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "",
      sources: [
        {
          name: "issuer-financials.xlsx",
          type: "xlsx",
          columns: [{ name: "debt", type: "number" }]
        }
      ],
      domainPack: "bond_analysis",
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const manifest = JSON.parse(files["manifest.json"]!) as {
      optional_capabilities: string[];
      extensions?: Array<{ namespace: string; domain_id?: string; required: boolean }>;
    };
    const homepage = JSON.parse(files["views/homepage.json"]!) as {
      blocks: Array<{
        type: string;
        title: string;
        claim_id?: string;
        metric_id?: string;
        evidence_ids?: string[];
        domain_view_rule_id?: string;
        required_trace?: string[];
      }>;
    };

    expect(plan.templateSections).toEqual(domainPack.template_sections);
    expect(plan.questions.slice(0, 3).map((question) => question.origin)).toEqual(["domain_pack", "domain_pack", "domain_pack"]);
    expect(plan.questions[0]).toMatchObject({
      id: "q_bond_debt_service_source",
      question: domainPack.required_questions[0]?.question,
      claim_id: "claim_bond_debt_service_source",
      evidence_id: "ev_bond_debt_service_source"
    });
    expect(plan.domainViewSuggestions.map((view) => view.title)).toEqual(domainPack.view_rules.map((rule) => rule.title));
    expect(plan.skills[0]).toEqual({ name: "Domain Pack Planner", output: "3 domain questions" });
    expect(plan.metricSuggestions[0]).toMatchObject({
      metric_id: "metric_debt_balance_source_1_issuer_financials_xlsx_debt",
      name: "有息债务余额",
      formula: "LATEST_VALUE(debt)",
      dataset_id: "source_1_issuer_financials_xlsx",
      source_column: "debt",
      source_columns: ["debt"],
      origin: "domain_blueprint",
      aggregation: "latest_value",
      blueprint_id: "debt_balance",
      matched_preferred_column: "debt",
      field_role: "summary_value",
      source_field_roles: ["summary_value"],
      evidence_requirement: "需要报告期、债务类型或明细来源；若来源为多笔债务明细，发布前必须人工确认是否应改为同一报告期汇总。"
    });
    expect(manifest.optional_capabilities).toContain("domain.pack");
    expect(manifest.extensions).toEqual([
      expect.objectContaining({
        namespace: "org.openinsight.domain.bond_analysis",
        domain_id: "bond_analysis",
        required: false
      })
    ]);
    expect(homepage.blocks[0]).toEqual(
      expect.objectContaining({
        type: "domain_view_rule",
        title: "债券风险总览",
        claim_id: "claim_bond_debt_service_source",
        metric_id: "metric_debt_balance_source_1_issuer_financials_xlsx_debt",
        evidence_ids: ["ev_bond_debt_service_source"],
        domain_view_rule_id: "bond_risk_overview",
        required_trace: expect.arrayContaining(["claim_id", "metric_id", "evidence_id", "source_ref"])
      })
    );
    expect(files["qa/prepared_questions.jsonl"]).toContain(domainPack.required_questions[0]?.question);
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("creates core v0.1 package files from a draft plan", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);

    expect(Object.keys(files)).toEqual([
      "manifest.json",
      "data/catalog.json",
      "semantic/metrics.json",
      "views/homepage.json",
      "findings/claims.jsonl",
      "evidence/evidence.jsonl",
      "qa/prepared_questions.jsonl",
      "answerability/data_requests.jsonl",
      "tools/registry.json",
      "lineage/sources.json"
    ]);
    const manifest = JSON.parse(files["manifest.json"]!) as {
      created_at: string;
      required_capabilities: string[];
    };

    expect(manifest.created_at).toBe("2026-04-29T00:00:00.000Z");
    expect(manifest.required_capabilities).toEqual([
      "core.read",
      "data.catalog",
      "semantic.metrics",
      "views.basic",
      "findings.claims",
      "evidence.basic",
      "qa.prepared",
      "lineage.sources"
    ]);
    expect(files["qa/prepared_questions.jsonl"]).toContain("q_issuer_overview");
  });

  it("carries source metadata into catalog and lineage files", () => {
    const plan = buildDraftPlan({
      title: "CSV Insight",
      packageId: "org.example.csv",
      template: "Sales overview",
      sources: [
        {
          name: "sales.csv",
          type: "csv",
          size_bytes: 42,
          mime_type: "text/csv",
          row_count: 2,
          columns: [
            { name: "region", type: "string" },
            { name: "revenue", type: "number" }
          ],
          sample_rows: [
            { region: "East", revenue: 120 },
            { region: "West", revenue: 80 },
            { region: "East", revenue: 30 }
          ]
        }
      ],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const catalog = JSON.parse(files["data/catalog.json"]!) as {
      datasets: Array<{ columns: Array<{ name: string; type: string }>; row_count: number; size_bytes: number }>;
    };
    const lineage = JSON.parse(files["lineage/sources.json"]!) as {
      sources: Array<{ mime_type: string; row_count: number; size_bytes: number }>;
    };

    expect(catalog.datasets[0]?.columns).toEqual([
      { name: "region", type: "string" },
      { name: "revenue", type: "number" }
    ]);
    expect(catalog.datasets[0]?.row_count).toBe(2);
    expect(catalog.datasets[0]?.size_bytes).toBe(42);
    expect(lineage.sources[0]).toMatchObject({
      mime_type: "text/csv",
      row_count: 2,
      size_bytes: 42
    });
    expect(plan.metricSuggestions).toEqual([
      {
        metric_id: "metric_source_1_sales_csv_revenue",
        name: "合计 revenue",
        definition: "根据 sales.csv 的 revenue 字段自动建议合计指标。",
        formula: "SUM(revenue)",
        dataset_id: "source_1_sales_csv",
        source_column: "revenue",
        status: "suggested",
        origin: "source_profile",
        aggregation: "sum"
      }
    ]);
    expect(plan.viewSuggestions).toEqual([
      {
        block_id: "block_chart_source_1_sales_csv_revenue_by_region",
        type: "bar_chart",
        title: "按 region 汇总 revenue",
        metric_id: "metric_source_1_sales_csv_revenue",
        evidence_id: "ev_chart_source_1_sales_csv_revenue_by_region",
        dataset_id: "source_1_sales_csv",
        dimension_column: "region",
        value_column: "revenue",
        values: [
          { region: "East", revenue: 150 },
          { region: "West", revenue: 80 }
        ],
        status: "suggested"
      }
    ]);
    expect(JSON.parse(files["semantic/metrics.json"]!).metrics).toEqual(plan.metricSuggestions);
    expect(JSON.parse(files["views/homepage.json"]!).blocks[0]).toMatchObject({
      block_id: "block_chart_source_1_sales_csv_revenue_by_region",
      type: "bar_chart",
      metric_id: "metric_source_1_sales_csv_revenue",
      evidence_ids: ["ev_chart_source_1_sales_csv_revenue_by_region"]
    });
    expect(files["evidence/evidence.jsonl"]).toContain("按 region 汇总 revenue");
  });

  it("writes normalized Markdown sources and parse diagnostics for tabular sources", () => {
    const plan = buildDraftPlan({
      title: "CSV Context Library",
      packageId: "org.example.csv_context",
      template: "Sales overview",
      sources: [
        {
          name: "sales.csv",
          type: "csv",
          size_bytes: 42,
          mime_type: "text/csv",
          row_count: 2,
          columns: [
            { name: "region", type: "string" },
            { name: "revenue", type: "number" }
          ],
          sample_rows: [
            { region: "华东", revenue: 120 },
            { region: "华南", revenue: 80 }
          ]
        }
      ],
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const normalizedPath = "source/normalized/source_1_sales_csv.md";
    const diagnostics = files["source/parse_diagnostics.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const sourceInventory = JSON.parse(files["source/inventory.json"]!) as {
      schema_version: string;
      sources: Array<Record<string, unknown>>;
    };
    const sourceMapRows = files["lineage/source_map.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const digests = JSON.parse(files["integrity/digests.json"]!) as {
      schema_version: string;
      entries: Array<Record<string, unknown>>;
    };

    expect(files[normalizedPath]).toContain("# Normalized source: sales.csv");
    expect(files[normalizedPath]).toContain("normalized source，不是 raw source");
    expect(files[normalizedPath]).toContain("| region | revenue |");
    expect(files[normalizedPath]).toContain("## Field semantic hints");
    expect(files[normalizedPath]).toContain("| revenue | 收入 营收 销售额 金额 revenue sales amount |");
    expect(files[normalizedPath]).toContain("| 华东 | 120 |");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        diagnostic_id: "parse_source_1_sales_csv",
        source_id: "source_1_sales_csv",
        parser: "open_insight_builtin_tabular",
        parser_role: "markitdown_compatible_normalized_source",
        normalized_source_path: normalizedPath,
        cloud_used: false,
        status: "ok"
      })
    );
    expect(sourceInventory).toMatchObject({
      schema_version: "open-insight.source-inventory.v0.1",
      source_mode_required: true,
      sources: [
        expect.objectContaining({
          source_id: "source_1_sales_csv",
          normalized_source_path: normalizedPath,
          parse_diagnostic_id: "parse_source_1_sales_csv",
          source_map_id: "source_map_source_1_sales_csv"
        })
      ]
    });
    expect(sourceMapRows).toEqual([
      expect.objectContaining({
        schema_version: "open-insight.source-map.v0.1",
        source_map_id: "source_map_source_1_sales_csv",
        object_id: "normalized_source.source_1_sales_csv",
        source_id: "source_1_sales_csv",
        normalized_source_path: normalizedPath,
        parse_diagnostic_id: "parse_source_1_sales_csv"
      })
    ]);
    expect(sourceMapRows[0]?.ranges).toEqual([
      expect.objectContaining({
        kind: "normalized_markdown_full",
        path: normalizedPath,
        start_line: 1
      })
    ]);
    expect(digests.schema_version).toBe("open-insight.integrity-digests.v0.1");
    expect(digests.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          digest_id: "digest_raw_metadata_source_1_sales_csv",
          target_type: "raw_source_metadata",
          target_ref: "source_1_sales_csv",
          verification_level: "metadata_fingerprint"
        }),
        expect.objectContaining({
          digest_id: "digest_normalized_source_1_sales_csv",
          target_type: "normalized_source",
          target_ref: "normalized_source.source_1_sales_csv",
          path: normalizedPath,
          verification_level: "content_hash",
          content_available_in_source_light: true
        })
      ])
    );
    expect(digests.entries.every((entry) => typeof entry.hash === "string" && String(entry.hash).startsWith("sha256-"))).toBe(true);
    const normalizedDigest = digests.entries.find((entry) => entry.digest_id === "digest_normalized_source_1_sales_csv");
    const expectedNormalizedDigest = createHash("sha256").update(files[normalizedPath]!, "utf8").digest("hex");
    expect(normalizedDigest?.hash).toBe(`sha256-${expectedNormalizedDigest}`);
  });

  it("uses external parser normalized Markdown as a traceable context source", () => {
    const plan = buildDraftPlan({
      title: "PDF Context Library",
      packageId: "org.example.pdf_context",
      template: "Risk overview",
      sources: [
        {
          name: "risk-brief.pdf",
          type: "pdf",
          size_bytes: 128,
          mime_type: "application/pdf",
          normalized_source: {
            content: "# MarkItDown conversion\n\nRisk section: channel concentration and delivery delay.",
            parser: "markitdown",
            parser_version: "0.1.test",
            parser_role: "external_normalized_source",
            cloud_used: false,
            confidence: 0.82,
            message: "Converted by local MarkItDown fixture."
          }
        } as never
      ],
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const normalizedPath = "source/normalized/source_1_risk_brief_pdf.md";
    const diagnostics = files["source/parse_diagnostics.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(files[normalizedPath]).toContain("# MarkItDown conversion");
    expect(files[normalizedPath]).toContain("channel concentration");
    expect(files["query_index/rebuild.sql"]).toContain("channel concentration");
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        diagnostic_id: "parse_source_1_risk_brief_pdf",
        source_id: "source_1_risk_brief_pdf",
        parser: "markitdown",
        parser_version: "0.1.test",
        parser_role: "external_normalized_source",
        normalized_source_path: normalizedPath,
        cloud_used: false,
        confidence: 0.82,
        status: "ok",
        message: "Converted by local MarkItDown fixture."
      })
    );
  });

  it("preserves XLSX formulas as traceable normalized and machine-readable evidence", () => {
    const plan = buildDraftPlan({
      title: "Spreadsheet Formula Context Library",
      packageId: "org.example.spreadsheet_formula_context",
      template: "Budget overview",
      sources: [
        {
          name: "budget.xlsx",
          type: "xlsx",
          size_bytes: 4096,
          normalized_source: {
            content: "# Budget workbook\n\n| item | amount |\n| --- | --- |\n| total | 864 |",
            parser: "markitdown",
            parser_version: "0.1.test",
            parser_role: "external_normalized_source",
            cloud_used: false,
            confidence: 0.85,
            status: "ok",
            message: "Converted by local MarkItDown fixture."
          },
          spreadsheet_formula_evidence: {
            schema_version: "open-insight.spreadsheet-formula-extraction.v0.1",
            extractor: "open_insight_xlsx_formula_xml",
            status: "ok",
            formula_count: 1,
            truncated: false,
            max_formulas: 100_000,
            max_output_bytes: 32 * 1024 * 1024,
            message: "已从 XLSX XML 只读提取 1 条公式证据；未重新计算公式。",
            cells: [
              {
                sheet_name: "预算明细",
                cell_address: "C12",
                formula: "=SUM(C6:C11)",
                formula_type: "normal",
                cached_value_available: true,
                cached_value: 864,
                cached_value_type: "number"
              }
            ]
          }
        }
      ],
      createdAt: "2026-07-24T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const normalizedPath = "source/normalized/source_1_budget_xlsx.md";
    const formulaRows = files["source/spreadsheet_formulas.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const diagnostics = files["source/parse_diagnostics.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const directIndexRows = files["query_index/chunks.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const inventory = JSON.parse(files["source/inventory.json"]!) as {
      sources: Array<Record<string, unknown>>;
    };
    const digests = JSON.parse(files["integrity/digests.json"]!) as {
      entries: Array<Record<string, unknown>>;
    };

    expect(files[normalizedPath]).toContain("## Spreadsheet formula evidence");
    expect(files[normalizedPath]).toContain("预算明细");
    expect(files[normalizedPath]).toContain("C12");
    expect(files[normalizedPath]).toContain("=SUM(C6:C11)");
    expect(files[normalizedPath]).toContain("864");
    expect(formulaRows).toEqual([
      expect.objectContaining({
        schema_version: "open-insight.spreadsheet-formula.v0.1",
        formula_id: "formula_source_1_budget_xlsx_1",
        source_id: "source_1_budget_xlsx",
        sheet_name: "预算明细",
        cell_address: "C12",
        formula: "=SUM(C6:C11)",
        formula_resolution_status: "resolved",
        cached_value_available: true,
        cached_value: 864,
        cached_value_type: "number",
        calculation_status: "not_evaluated",
        source_refs: ["source_1_budget_xlsx"],
        lineage_refs: ["source_1_budget_xlsx"],
        parse_diagnostic_ids: ["parse_source_1_budget_xlsx"],
        source_map_refs: ["source_map_source_1_budget_xlsx"]
      })
    ]);
    expect(diagnostics[0]).toMatchObject({
      spreadsheet_formula_status: "ok",
      spreadsheet_formula_count: 1,
      spreadsheet_formula_truncated: false,
      spreadsheet_formula_extractor: "open_insight_xlsx_formula_xml"
    });
    expect(inventory.sources[0]).toMatchObject({
      spreadsheet_formula_path: "source/spreadsheet_formulas.jsonl",
      spreadsheet_formula_status: "ok",
      spreadsheet_formula_count: 1,
      spreadsheet_formula_truncated: false
    });
    expect(
      directIndexRows.some(
        (row) =>
          row.chunk_level === "table" &&
          String(row.text).includes("=SUM(C6:C11)") &&
          String(row.text).includes("C12")
      )
    ).toBe(true);
    expect(files["query_index/rebuild.sql"]).toContain("CREATE TABLE context_spreadsheet_formulas");
    expect(files["query_index/rebuild.sql"]).toContain("=SUM(C6:C11)");
    expect(files["query_index/rebuild.sql"]).toContain("formula_resolution_status");
    expect(digests.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          digest_id: "digest_spreadsheet_formulas",
          target_type: "spreadsheet_formula_evidence",
          target_ref: "source/spreadsheet_formulas",
          path: "source/spreadsheet_formulas.jsonl",
          verification_level: "content_hash",
          content_available_in_source_light: true
        })
      ])
    );
    const formulaDigest = digests.entries.find((entry) => entry.digest_id === "digest_spreadsheet_formulas");
    const expectedFormulaDigest = createHash("sha256")
      .update(files["source/spreadsheet_formulas.jsonl"]!, "utf8")
      .digest("hex");
    expect(formulaDigest?.hash).toBe(`sha256-${expectedFormulaDigest}`);
    expect(validateDraftPackageFiles(files).status).toBe("valid");

    const tamperedFormulaFiles = {
      ...files,
      "source/spreadsheet_formulas.jsonl": files["source/spreadsheet_formulas.jsonl"]!.replace(
        "=SUM(C6:C11)",
        "=AVERAGE(C6:C11)"
      )
    };
    expect(validateDraftPackageFiles(tamperedFormulaFiles)).toMatchObject({
      status: "invalid",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: "integrity/digests.json",
          message: expect.stringContaining("content digest")
        })
      ])
    });

    const unknownSourceRows = formulaRows.map((row) => ({
      ...row,
      source_refs: ["source_missing"]
    }));
    const unknownSourceFormulaJsonl = `${unknownSourceRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
    const unknownSourceDigests = {
      ...digests,
      entries: digests.entries.map((entry) =>
        entry.digest_id === "digest_spreadsheet_formulas"
          ? {
              ...entry,
              hash: `sha256-${createHash("sha256").update(unknownSourceFormulaJsonl, "utf8").digest("hex")}`
            }
          : entry
      )
    };
    const unknownSourceFiles = {
      ...files,
      "source/spreadsheet_formulas.jsonl": unknownSourceFormulaJsonl,
      "integrity/digests.json": `${JSON.stringify(unknownSourceDigests, null, 2)}\n`
    };
    expect(validateDraftPackageFiles(unknownSourceFiles)).toMatchObject({
      status: "invalid",
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: "source/spreadsheet_formulas.jsonl:1",
          message: expect.stringContaining("source_missing")
        })
      ])
    });
  });

  it("marks shared formula followers without repeated XML text as unresolved", () => {
    const plan = buildDraftPlan({
      title: "Shared formula context",
      packageId: "org.example.shared_formula_context",
      template: "Shared formula evidence",
      sources: [
        {
          name: "shared-formulas.xlsx",
          type: "xlsx",
          normalized_source: {
            content: "# Shared formula workbook",
            parser: "markitdown",
            cloud_used: false,
            status: "ok"
          },
          spreadsheet_formula_evidence: {
            schema_version: "open-insight.spreadsheet-formula-extraction.v0.1",
            extractor: "open_insight_xlsx_formula_xml",
            status: "partial",
            formula_count: 1,
            truncated: false,
            max_formulas: 100_000,
            max_output_bytes: 1024,
            message: "共享公式从属单元格没有独立公式文本。",
            cells: [
              {
                sheet_name: "Sheet1",
                cell_address: "C7",
                formula: "",
                formula_type: "shared",
                shared_index: "0",
                range_ref: "C6:C12",
                cached_value_available: true,
                cached_value: 42,
                cached_value_raw: "42",
                cached_value_type: "number"
              }
            ]
          }
        }
      ],
      createdAt: "2026-07-24T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const rows = files["source/spreadsheet_formulas.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(rows).toEqual([
      expect.objectContaining({
        cell_address: "C7",
        formula: "",
        formula_type: "shared",
        formula_resolution_status: "unresolved_shared",
        shared_index: "0",
        cached_value: 42,
        cached_value_raw: "42"
      })
    ]);
    expect(files["source/normalized/source_1_shared_formulas_xlsx.md"]).toContain("unresolved_shared");
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("preserves page numbers and repeated headers as page furniture sidecar records", () => {
    const normalizedContent = [
      "ABS Repeated Header Token",
      "1/241",
      "# First section",
      "Body paragraph with cash flow coverage and asset pool details.",
      "ABS Repeated Header Token",
      "2/241",
      "# Second section",
      "Body paragraph with senior note ratio and trigger events."
    ].join("\n");
    const plan = buildDraftPlan({
      title: "PDF Page Furniture Context Library",
      packageId: "org.example.pdf_page_furniture",
      template: "ABS overview",
      sources: [
        {
          name: "abs-plan.pdf",
          type: "pdf",
          size_bytes: 256,
          mime_type: "application/pdf",
          normalized_source: {
            content: normalizedContent,
            parser: "markitdown",
            parser_version: "0.1.test",
            parser_role: "external_normalized_source",
            cloud_used: false,
            confidence: 0.84,
            message: "Converted by local MarkItDown fixture."
          }
        } as never
      ],
      createdAt: "2026-06-17T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const pageFurnitureRows = files["source/page_furniture.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const directIndexRows = files["query_index/chunks.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const bodyChunk = directIndexRows.find((row) => row.chunk_id === "normalized_source.source_1_abs_plan_pdf");
    const furnitureChunks = directIndexRows.filter((row) => row.content_role === "page_furniture");

    expect(files["source/normalized/source_1_abs_plan_pdf.md"]).toBe(`${normalizedContent}\n`);
    expect(pageFurnitureRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema_version: "open-insight.page-furniture.v0.1",
          kind: "running_header",
          text: "ABS Repeated Header Token",
          source_id: "source_1_abs_plan_pdf",
          normalized_source_path: "source/normalized/source_1_abs_plan_pdf.md",
          source_ref: "source_1_abs_plan_pdf",
          source_refs: ["source_1_abs_plan_pdf"],
          source_map_refs: ["source_map_source_1_abs_plan_pdf"],
          parse_diagnostic_ids: ["parse_source_1_abs_plan_pdf"],
          content_role: "page_furniture",
          render_policy: "deemphasize_in_readable_html"
        }),
        expect.objectContaining({
          kind: "page_number",
          text: "1/241",
          page_number: 1,
          content_role: "page_furniture"
        })
      ])
    );
    expect(pageFurnitureRows.length).toBeGreaterThanOrEqual(4);
    expect(bodyChunk).toMatchObject({
      content_role: "body",
      normalized_source_retains_page_furniture: true,
      page_furniture_count: pageFurnitureRows.length
    });
    expect(bodyChunk).not.toHaveProperty("page_furniture_artifact_ids");
    expect(directIndexRows.every((row) => !("page_furniture_artifact_ids" in row))).toBe(true);
    expect(String(bodyChunk?.text)).toContain("Body paragraph with cash flow coverage");
    expect(String(bodyChunk?.text)).not.toContain("ABS Repeated Header Token");
    expect(String(bodyChunk?.text)).not.toContain("1/241");
    expect(furnitureChunks).toEqual([]);
    expect(files["query_index/rebuild.sql"]).toContain("CREATE TABLE context_page_furniture");
    expect(files["query_index/rebuild.sql"]).toContain("INSERT INTO context_page_furniture");
    expect(files["query_index/rebuild.sql"]).toContain("ABS Repeated Header Token");
    expect(files["query_index/rebuild.sql"]).toContain("content_role TEXT");
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("writes a rebuildable SQLite/FTS query index manifest for normalized sources", () => {
    const plan = buildDraftPlan({
      title: "CSV Context Library",
      packageId: "org.example.csv_context",
      template: "Sales overview",
      sources: [
        {
          name: "sales.csv",
          type: "csv",
          size_bytes: 42,
          mime_type: "text/csv",
          row_count: 2,
          columns: [
            { name: "region", type: "string" },
            { name: "revenue", type: "number" }
          ],
          sample_rows: [
            { region: "鍗庝笢", revenue: 120 },
            { region: "鍗庡崡", revenue: 80 }
          ]
        }
      ],
      createdAt: "2026-06-13T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const queryIndexManifest = JSON.parse(files["query_index/manifest.json"]!) as {
      schema_version: string;
      status: string;
      engine: string;
      fts: boolean;
      rebuildable: boolean;
      source_of_truth: boolean;
      database_path: string;
      database_available: boolean;
      rebuild_sql_path: string;
      rebuild_sql_available: boolean;
      direct_index_path: string;
      direct_index_available: boolean;
      direct_index_format: string;
      access_strategy: string;
      message: string;
      indexed_paths: string[];
      source_refs: string[];
      lineage_refs: string[];
      parse_diagnostic_ids: string[];
      source_map_refs: string[];
      provenance_tables: string[];
    };
    const rebuildSql = files["query_index/rebuild.sql"]!;
    const directIndexRows = files["query_index/chunks.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(queryIndexManifest).toEqual(
      expect.objectContaining({
        schema_version: "open-insight.query_index.v0.1",
        status: "rebuild_sql",
        engine: "sqlite",
        fts: true,
        rebuildable: true,
        source_of_truth: false,
        database_path: "query_index/index.sqlite",
        database_available: false,
        rebuild_sql_path: "query_index/rebuild.sql",
        rebuild_sql_available: true,
        direct_index_path: "query_index/chunks.jsonl",
        direct_index_available: true,
        direct_index_format: "jsonl",
        access_strategy: "rebuild_sql",
        indexed_paths: ["source/normalized/source_1_sales_csv.md"],
        source_refs: ["source_1_sales_csv"],
        lineage_refs: ["source_1_sales_csv"],
        parse_diagnostic_ids: ["parse_source_1_sales_csv"],
        source_map_refs: ["source_map_source_1_sales_csv"],
        provenance_tables: ["context_parse_diagnostics", "context_source_maps", "context_digests"]
      })
    );
    expect(queryIndexManifest.message).toContain("未内置二进制 SQLite");
    expect(rebuildSql).toContain("CREATE VIRTUAL TABLE context_chunks_fts USING fts4");
    expect(rebuildSql).toContain("CREATE TABLE context_sources");
    expect(rebuildSql).toContain("CREATE TABLE context_parse_diagnostics");
    expect(rebuildSql).toContain("CREATE TABLE context_source_maps");
    expect(rebuildSql).toContain("CREATE TABLE context_digests");
    expect(rebuildSql).toContain("CREATE INDEX context_source_maps_parse_diagnostic_id_idx");
    expect(rebuildSql).toContain("INSERT INTO context_parse_diagnostics");
    expect(rebuildSql).toContain("INSERT INTO context_source_maps");
    expect(rebuildSql).toContain("INSERT INTO context_digests");
    expect(rebuildSql).toContain("'source_1_sales_csv'");
    expect(rebuildSql).toContain("source_map_source_1_sales_csv");
    expect(rebuildSql).toContain("digest_normalized_source_1_sales_csv");
    expect(rebuildSql).toContain("'source/normalized/source_1_sales_csv.md'");
    expect(rebuildSql).toContain("'parse_source_1_sales_csv'");
    expect(rebuildSql).toContain("Normalized source: sales.csv");
    expect(rebuildSql).toContain("收入 营收 销售额 金额 revenue sales amount");
    expect(directIndexRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schema_version: "open-insight.query_index.chunk.v0.1",
          chunk_id: "normalized_source.source_1_sales_csv",
          chunk_level: "document",
          source_id: "source_1_sales_csv",
          normalized_source_path: "source/normalized/source_1_sales_csv.md",
          source_refs: ["source_1_sales_csv"],
          lineage_refs: ["source_1_sales_csv"],
          parse_diagnostic_ids: ["parse_source_1_sales_csv"],
          source_map_refs: ["source_map_source_1_sales_csv"]
        }),
        expect.objectContaining({
          chunk_id: expect.stringMatching(/^section\.source_1_sales_csv\./),
          chunk_level: "section",
          heading_path: expect.arrayContaining(["Normalized source: sales.csv"]),
          estimated_tokens: expect.any(Number)
        }),
        expect.objectContaining({
          chunk_id: expect.stringMatching(/^table\.source_1_sales_csv\./),
          chunk_level: "table",
          content_role: "table",
          source_refs: ["source_1_sales_csv"],
          parse_diagnostic_ids: ["parse_source_1_sales_csv"]
        })
      ])
    );
    expect(directIndexRows.length).toBeGreaterThan(1);
    expect(directIndexRows[0]?.text).toEqual(expect.stringContaining("Normalized source: sales.csv"));
    expect(directIndexRows[0]?.text).toEqual(expect.stringContaining("收入 营收 销售额 金额 revenue sales amount"));
    expect(directIndexRows[0]?.char_count).toEqual(expect.any(Number));
    expect(directIndexRows[0]?.read_units_estimate).toEqual(expect.any(Number));
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("keeps full normalized text while capping large document index previews", () => {
    const largeBody = Array.from({ length: 18_000 }, (_, index) => `Paragraph ${index + 1} cash flow coverage marker ${index + 1}.`).join("\n\n");
    const tailMarker = "TAIL_MARKER_FULL_NORMALIZED_SOURCE_REMAINS_AVAILABLE";
    const plan = buildDraftPlan({
      title: "Large Context Library",
      packageId: "org.example.large_context",
      template: "Large document context",
      sources: [
        {
          name: "large-report.md",
          type: "markdown",
          size_bytes: largeBody.length,
          mime_type: "text/markdown",
          normalized_source: {
            content: `${largeBody}\n\n${tailMarker}`,
            parser: "test_parser",
            parser_role: "normalized_markdown",
            cloud_used: false,
            confidence: 0.99,
            status: "ok",
            message: "test normalized source"
          }
        }
      ],
      createdAt: "2026-07-01T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const normalizedPath = "source/normalized/source_1_large_report_md.md";
    const directIndexRows = files["query_index/chunks.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const documentChunk = directIndexRows.find((row) => row.chunk_level === "document");
    const paragraphChunks = directIndexRows.filter((row) => row.chunk_level === "paragraph");
    const queryIndexManifest = JSON.parse(files["query_index/manifest.json"]!) as {
      status: string;
      access_strategy: string;
      document_chunk_text_policy?: { preview_char_limit?: number };
    };

    expect(files[normalizedPath]).toContain(tailMarker);
    expect(documentChunk).toMatchObject({
      chunk_id: "normalized_source.source_1_large_report_md",
      text_truncated: true,
      truncation_policy: "document_preview_only",
      full_text_available_path: normalizedPath
    });
    expect(String(documentChunk?.text).length).toBeLessThan(String(files[normalizedPath]).length);
    expect(documentChunk?.estimated_tokens).toEqual(expect.any(Number));
    expect(paragraphChunks.length).toBeGreaterThan(1);
    expect(queryIndexManifest).toMatchObject({
      status: "direct_index_jsonl",
      access_strategy: "direct_index_jsonl",
      document_chunk_text_policy: {
        preview_char_limit: expect.any(Number)
      }
    });
    expect(files["query_index/rebuild.sql"]).toContain("Chunk rows are intentionally omitted for large packages");
    expect(files["query_index/rebuild.sql"]).not.toContain(tailMarker);
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("keeps metadata-only unsupported sources in inventory, diagnostics, source map, and query index", () => {
    const plan = buildDraftPlan({
      title: "PDF Context Library",
      packageId: "org.example.pdf_context",
      template: "Policy context",
      sources: [
        {
          name: "policy.pdf",
          type: "pdf",
          size_bytes: 2048,
          mime_type: "application/pdf",
          metadata: {
            pages: 3,
            title: "REITs 新规"
          },
          normalized_source: {
            content: "",
            parser: "open_insight_builtin_metadata",
            parser_role: "metadata_only_normalized_source",
            cloud_used: false,
            confidence: 0.35,
            status: "partial",
            message: "当前只生成 metadata-only normalized source，未抽取正文；需要 MarkItDown、OCR 或原始文件复核后才能把正文内容当作事实证据。"
          }
        }
      ],
      createdAt: "2026-06-16T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const normalizedPath = "source/normalized/source_1_policy_pdf.md";
    const normalized = files[normalizedPath]!;
    const parseDiagnostics = files["source/parse_diagnostics.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const sourceInventory = JSON.parse(files["source/inventory.json"]!) as {
      sources: Array<Record<string, unknown>>;
    };
    const queryIndexManifest = JSON.parse(files["query_index/manifest.json"]!) as {
      indexed_paths: string[];
      parse_diagnostic_ids: string[];
      source_refs: string[];
      source_map_refs: string[];
    };
    const directIndexRows = files["query_index/chunks.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(normalized).toContain("Normalized source: policy.pdf");
    expect(normalized).toContain("metadata-only normalized source");
    expect(normalized).toContain("未抽取正文");
    expect(normalized).toContain("需要 MarkItDown");
    expect(normalized).toContain("source_type: pdf");
    expect(normalized).toContain("pages: 3");
    expect(normalized).toContain("title: REITs 新规");
    expect(parseDiagnostics[0]).toMatchObject({
      diagnostic_id: "parse_source_1_policy_pdf",
      source_id: "source_1_policy_pdf",
      source_type: "pdf",
      parser: "open_insight_builtin_metadata",
      parser_role: "metadata_only_normalized_source",
      normalized_source_path: normalizedPath,
      cloud_used: false,
      status: "partial"
    });
    expect(String(parseDiagnostics[0]?.message)).toContain("未抽取正文");
    expect(sourceInventory.sources[0]).toMatchObject({
      source_id: "source_1_policy_pdf",
      type: "pdf",
      normalized_source_path: normalizedPath,
      parser: "open_insight_builtin_metadata",
      status: "partial"
    });
    expect(queryIndexManifest).toMatchObject({
      indexed_paths: [normalizedPath],
      source_refs: ["source_1_policy_pdf"],
      parse_diagnostic_ids: ["parse_source_1_policy_pdf"],
      source_map_refs: ["source_map_source_1_policy_pdf"]
    });
    const documentIndexRow = directIndexRows.find((row) => row.chunk_id === "normalized_source.source_1_policy_pdf");
    expect(documentIndexRow).toMatchObject({
      chunk_id: "normalized_source.source_1_policy_pdf",
      source_id: "source_1_policy_pdf",
      normalized_source_path: normalizedPath,
      source_refs: ["source_1_policy_pdf"],
      lineage_refs: ["source_1_policy_pdf"],
      parse_diagnostic_ids: ["parse_source_1_policy_pdf"],
      source_map_refs: ["source_map_source_1_policy_pdf"]
    });
    expect(documentIndexRow?.text).toEqual(expect.stringContaining("metadata-only normalized source"));
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("marks compiler-generated claims, questions, and view blocks as needing review", () => {
    const files = buildDraftPackageFiles(
      buildDraftPlan({
        title: "Generated Status Insight",
        packageId: "org.example.generated-status",
        template: "Sales overview",
        sources: [
          {
            name: "sales.csv",
            type: "csv",
            columns: [
              { name: "region", type: "string" },
              { name: "revenue", type: "integer" }
            ],
            sample_rows: [{ region: "East", revenue: 120 }]
          }
        ],
        createdAt: "2026-05-09T00:00:00.000Z"
      })
    );
    const homepage = JSON.parse(files["views/homepage.json"]!) as {
      blocks: Array<{ generation_status?: string; review_status?: string }>;
    };
    const claims = files["findings/claims.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { generation_status?: string; review_status?: string });
    const preparedQuestions = files["qa/prepared_questions.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { generation_status?: string; review_status?: string });

    expect(homepage.blocks.length).toBeGreaterThan(0);
    expect(homepage.blocks.every((block) => block.generation_status === "compiler_generated" && block.review_status === "needs_review")).toBe(true);
    expect(claims.every((claim) => claim.generation_status === "compiler_generated" && claim.review_status === "needs_review")).toBe(true);
    expect(
      preparedQuestions.every((question) => question.generation_status === "compiler_generated" && question.review_status === "needs_review")
    ).toBe(true);
  });

  it("skips unsafe generic totals for scores, rates, flags, and limits", () => {
    const plan = buildDraftPlan({
      title: "Education CSV Insight",
      packageId: "org.example.education.source-profile",
      template: "教学质量概览",
      sources: [
        {
          name: "education-learning.csv",
          type: "csv",
          columns: [
            { name: "class_name", type: "string" },
            { name: "revenue", type: "number" },
            { name: "max_score", type: "number" },
            { name: "survey_score", type: "number" },
            { name: "support_flag", type: "integer" },
            { name: "completion_rate", type: "percent" },
            { name: "average_order_value", type: "number" }
          ],
          sample_rows: [
            {
              class_name: "七年级一班",
              revenue: 1200,
              max_score: 100,
              survey_score: 4.5,
              support_flag: 1,
              completion_rate: 0.9,
              average_order_value: 200
            }
          ]
        }
      ],
      createdAt: "2026-05-06T00:00:00.000Z"
    });

    expect(plan.metricSuggestions).toEqual([
      expect.objectContaining({
        name: "合计 revenue",
        formula: "SUM(revenue)",
        source_column: "revenue",
        origin: "source_profile"
      })
    ]);
    expect(plan.metricSuggestions.map((metric) => metric.source_column)).toEqual(["revenue"]);
  });

  it("matches Chinese source columns against domain metric blueprints", () => {
    const plan = buildDraftPlan({
      title: "合同审阅洞察",
      packageId: "org.example.contract",
      template: "",
      sources: [
        {
          name: "contract-terms.csv",
          type: "csv",
          columns: [
            { name: "条款", type: "string" },
            { name: "合同金额", type: "number" }
          ]
        }
      ],
      domainPack: "contract_review",
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);

    expect(plan.metricSuggestions).toEqual([
      expect.objectContaining({
        metric_id: expect.stringMatching(/^metric_contract_amount_source_1_contract_terms_csv_col_/),
        name: "合同金额",
        formula: "LATEST_VALUE(合同金额)",
        origin: "domain_blueprint",
        aggregation: "latest_value",
        blueprint_id: "contract_amount",
        matched_preferred_column: "合同金额",
        field_role: "summary_value",
        source_field_roles: ["summary_value"]
      })
    ]);
    expect(JSON.parse(files["semantic/metrics.json"]!).metrics[0]).toMatchObject({
      name: "合同金额",
      origin: "domain_blueprint",
      blueprint_id: "contract_amount",
      matched_preferred_column: "合同金额",
      field_role: "summary_value",
      source_field_roles: ["summary_value"]
    });
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("uses explicit domain aggregation for count metrics instead of name heuristics", () => {
    const plan = buildDraftPlan({
      title: "销售经营洞察",
      packageId: "org.example.sales",
      template: "",
      sources: [
        {
          name: "orders.csv",
          type: "csv",
          columns: [
            { name: "region", type: "string" },
            { name: "order_id", type: "string" }
          ]
        }
      ],
      domainPack: "sales_operation",
      createdAt: "2026-05-02T00:00:00.000Z"
    });
    const orderMetric = plan.metricSuggestions.find((metric) => metric.blueprint_id === "order_count");

    expect(orderMetric).toMatchObject({
      name: "订单数",
      formula: "COUNT_DISTINCT(order_id)",
      source_column: "order_id",
      source_columns: ["order_id"],
      origin: "domain_blueprint",
      aggregation: "count",
      matched_preferred_column: "order_id",
      field_role: "entity_id",
      source_field_roles: ["entity_id"]
    });
    expect(plan.metricSuggestions.some((metric) => metric.origin === "source_profile" && metric.source_column === "order_id")).toBe(false);
  });

  it("uses field roles to distinguish summary values from detail rows", () => {
    const salesSummaryPlan = buildDraftPlan({
      title: "销售经营洞察",
      packageId: "org.example.sales.summary",
      template: "",
      sources: [
        {
          name: "orders-summary.csv",
          type: "csv",
          columns: [
            { name: "region", type: "string" },
            { name: "order_count", type: "number" }
          ]
        }
      ],
      domainPack: "sales_operation",
      createdAt: "2026-05-02T00:00:00.000Z"
    });
    const bondDetailPlan = buildDraftPlan({
      title: "债券发行洞察",
      packageId: "org.example.bond.detail",
      template: "",
      sources: [
        {
          name: "debt-detail.csv",
          type: "csv",
          columns: [
            { name: "debt_type", type: "string" },
            { name: "debt_amount", type: "number" }
          ]
        }
      ],
      domainPack: "bond_analysis",
      createdAt: "2026-05-02T00:00:00.000Z"
    });
    const orderMetric = salesSummaryPlan.metricSuggestions.find((metric) => metric.blueprint_id === "order_count");
    const debtMetric = bondDetailPlan.metricSuggestions.find((metric) => metric.blueprint_id === "debt_balance");

    expect(orderMetric).toMatchObject({
      formula: "SUM(order_count)",
      aggregation: "sum",
      field_role: "summary_value",
      source_field_roles: ["summary_value"],
      matched_preferred_column: "order_count"
    });
    expect(debtMetric).toMatchObject({
      formula: "SUM(debt_amount)",
      aggregation: "sum",
      field_role: "detail_value",
      source_field_roles: ["detail_value"],
      matched_preferred_column: "debt_amount"
    });
    expect(salesSummaryPlan.metricSuggestions.some((metric) => metric.origin === "source_profile" && metric.source_column === "order_count")).toBe(false);
    expect(bondDetailPlan.metricSuggestions.some((metric) => metric.origin === "source_profile" && metric.source_column === "debt_amount")).toBe(false);
  });

  it("requires numerator and denominator fields before deriving domain ratio metrics", () => {
    const incompletePlan = buildDraftPlan({
      title: "债券发行洞察",
      packageId: "org.example.bond.partial",
      template: "",
      sources: [
        {
          name: "issuer-financials.csv",
          type: "csv",
          columns: [{ name: "ebitda", type: "number" }]
        }
      ],
      domainPack: "bond_analysis",
      createdAt: "2026-05-02T00:00:00.000Z"
    });
    const completePlan = buildDraftPlan({
      title: "债券发行洞察",
      packageId: "org.example.bond.complete",
      template: "",
      sources: [
        {
          name: "issuer-financials.csv",
          type: "csv",
          columns: [
            { name: "ebitda", type: "number" },
            { name: "interest", type: "number" }
          ]
        }
      ],
      domainPack: "bond_analysis",
      createdAt: "2026-05-02T00:00:00.000Z"
    });
    const debtServiceNameGuardPlan = buildDraftPlan({
      title: "债券发行洞察",
      packageId: "org.example.bond.debt-service-guard",
      template: "",
      sources: [
        {
          name: "issuer-financials.csv",
          type: "csv",
          columns: [
            { name: "debt", type: "number" },
            { name: "cash_flow", type: "number" }
          ]
        }
      ],
      domainPack: "bond_analysis",
      createdAt: "2026-05-02T00:00:00.000Z"
    });
    const coverageMetric = completePlan.metricSuggestions.find((metric) => metric.blueprint_id === "coverage_ratio");

    expect(incompletePlan.metricSuggestions.some((metric) => metric.blueprint_id === "coverage_ratio")).toBe(false);
    expect(debtServiceNameGuardPlan.metricSuggestions.some((metric) => metric.blueprint_id === "coverage_ratio")).toBe(false);
    expect(debtServiceNameGuardPlan.metricSuggestions.map((metric) => metric.blueprint_id)).toEqual(["debt_balance", "cash_flow"]);
    expect(incompletePlan.metricSuggestions).toEqual([
      expect.objectContaining({
        name: "合计 ebitda",
        formula: "SUM(ebitda)",
        origin: "source_profile",
        aggregation: "sum"
      })
    ]);
    expect(coverageMetric).toMatchObject({
      name: "偿债覆盖倍数",
      formula: "SAFE_DIVIDE(SUM(ebitda), SUM(interest))",
      source_column: "ebitda",
      source_columns: ["ebitda", "interest"],
      origin: "domain_blueprint",
      aggregation: "ratio",
      matched_preferred_column: "ebitda/interest",
      source_field_roles: ["numerator", "denominator"],
      evidence_requirement: "必须同时说明分子和分母来源；不能仅用 EBITDA、现金流或利息单列求和来代表覆盖倍数。"
    });
    expect(completePlan.metricSuggestions.some((metric) => metric.origin === "source_profile")).toBe(false);
    expect(completePlan.viewSuggestions).toEqual([]);
  });

  it("generates education quality metrics from anonymized learning process columns", () => {
    const plan = buildDraftPlan({
      title: "教育质量分析草稿",
      packageId: "org.example.education.quality",
      template: "",
      sources: [
        {
          name: "learning-process.csv",
          type: "csv",
          row_count: 4,
          columns: [
            { name: "class_name", type: "string" },
            { name: "student_id", type: "string" },
            { name: "exam_score", type: "number" },
            { name: "max_score", type: "number" },
            { name: "assignment_completed", type: "number" },
            { name: "assignment_assigned", type: "number" },
            { name: "attended_sessions", type: "number" },
            { name: "scheduled_sessions", type: "number" },
            { name: "survey_score", type: "number" },
            { name: "support_flag", type: "integer" }
          ]
        }
      ],
      domainPack: "education_quality_analysis",
      createdAt: "2026-05-06T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const homepage = JSON.parse(files["views/homepage.json"]!) as {
      blocks: Array<{ type: string; domain_view_rule_id?: string; metric_id?: string; claim_id?: string; evidence_ids?: string[] }>;
    };

    expect(plan.metricSuggestions.map((metric) => metric.blueprint_id)).toEqual([
      "student_count",
      "average_score",
      "assignment_completion_rate",
      "attendance_rate"
    ]);
    expect(plan.metricSuggestions).toEqual([
      expect.objectContaining({
        name: "学生人数",
        formula: "COUNT_DISTINCT(student_id)",
        source_column: "student_id",
        source_columns: ["student_id"],
        aggregation: "count",
        matched_preferred_column: "student_id",
        field_role: "entity_id",
        source_field_roles: ["entity_id"]
      }),
      expect.objectContaining({
        name: "平均成绩",
        formula: "SAFE_DIVIDE(SUM(exam_score), COUNT_DISTINCT(student_id))",
        source_column: "exam_score",
        source_columns: ["exam_score", "student_id"],
        aggregation: "ratio",
        matched_preferred_column: "exam_score/student_id",
        source_field_roles: ["numerator", "denominator"]
      }),
      expect.objectContaining({
        name: "作业完成率",
        formula: "SAFE_DIVIDE(SUM(assignment_completed), SUM(assignment_assigned))",
        source_column: "assignment_completed",
        source_columns: ["assignment_completed", "assignment_assigned"],
        aggregation: "ratio",
        matched_preferred_column: "assignment_completed/assignment_assigned",
        source_field_roles: ["numerator", "denominator"]
      }),
      expect.objectContaining({
        name: "出勤率",
        formula: "SAFE_DIVIDE(SUM(attended_sessions), SUM(scheduled_sessions))",
        source_column: "attended_sessions",
        source_columns: ["attended_sessions", "scheduled_sessions"],
        aggregation: "ratio",
        matched_preferred_column: "attended_sessions/scheduled_sessions",
        source_field_roles: ["numerator", "denominator"]
      })
    ]);
    expect(plan.metricSuggestions.some((metric) => metric.origin === "source_profile")).toBe(false);
    expect(homepage.blocks[0]).toEqual(
      expect.objectContaining({
        type: "domain_view_rule",
        domain_view_rule_id: "education_quality_overview",
        metric_id: "metric_student_count_source_1_learning_process_csv_student_id",
        claim_id: "claim_education_learning_outlier",
        evidence_ids: ["ev_education_learning_outlier"]
      })
    );
    expect(files["qa/prepared_questions.jsonl"]).toContain("哪些班级、课程、知识点或学生群体的学习结果存在异常");
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("generates channel inventory metrics with action-boundary review context", () => {
    const plan = buildDraftPlan({
      title: "渠道库存协同草稿",
      packageId: "org.example.channel.inventory",
      template: "",
      sources: [
        {
          name: "channel-inventory.csv",
          type: "csv",
          row_count: 3,
          columns: [
            { name: "channel_name", type: "string" },
            { name: "warehouse_name", type: "string" },
            { name: "sku_id", type: "string" },
            { name: "available_inventory_qty", type: "number" },
            { name: "sold_qty", type: "number" },
            { name: "stockout_flag", type: "integer" }
          ]
        }
      ],
      domainPack: "channel_inventory_collaboration",
      createdAt: "2026-05-06T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const homepage = JSON.parse(files["views/homepage.json"]!) as {
      blocks: Array<{ type: string; domain_view_rule_id?: string; metric_id?: string; claim_id?: string; evidence_ids?: string[] }>;
    };

    expect(plan.metricSuggestions.map((metric) => metric.blueprint_id)).toEqual([
      "sku_count",
      "available_inventory_qty",
      "sell_through_rate",
      "stockout_rate"
    ]);
    expect(plan.metricSuggestions).toEqual([
      expect.objectContaining({
        name: "SKU 数",
        formula: "COUNT_DISTINCT(sku_id)",
        source_column: "sku_id",
        source_field_roles: ["entity_id"]
      }),
      expect.objectContaining({
        name: "可售库存",
        formula: "SUM(available_inventory_qty)",
        source_column: "available_inventory_qty",
        source_field_roles: ["detail_value"]
      }),
      expect.objectContaining({
        name: "库存消化率",
        formula: "SAFE_DIVIDE(SUM(sold_qty), SUM(available_inventory_qty))",
        source_column: "sold_qty",
        source_columns: ["sold_qty", "available_inventory_qty"],
        source_field_roles: ["numerator", "denominator"]
      }),
      expect.objectContaining({
        name: "缺货率",
        formula: "SAFE_DIVIDE(SUM(stockout_flag), COUNT_DISTINCT(sku_id))",
        source_column: "stockout_flag",
        source_columns: ["stockout_flag", "sku_id"],
        source_field_roles: ["numerator", "denominator"]
      })
    ]);
    expect(homepage.blocks[0]).toEqual(
      expect.objectContaining({
        type: "domain_view_rule",
        domain_view_rule_id: "channel_inventory_overview",
        metric_id: "metric_sku_count_source_1_channel_inventory_csv_sku_id",
        claim_id: "claim_channel_inventory_stockout_overstock",
        evidence_ids: ["ev_channel_inventory_stockout_overstock"]
      })
    );
    expect(files["qa/prepared_questions.jsonl"]).toContain("哪些补货、调拨、清仓或采购建议必须人工确认");
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("applies Studio question edits without promoting claims to verified", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const reviewedPlan = applyDraftQuestionOverrides(plan, {
      q_issuer_overview: {
        question: "发行人的主营业务和偿债相关主体是谁？",
        answer: "正式回答草稿：发行人的偿债相关主体包括发行人、担保方和主要经营现金流来源，仍需终审。",
        evidence: "人工审阅要求：必须绑定募集说明书发行人概况章节。",
        status: "verified_target",
        review_note: "问题目标已确认，答案仍待证据抽取。"
      }
    });
    const files = buildDraftPackageFiles(reviewedPlan);
    const claims = files["findings/claims.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const preparedQuestions = files["qa/prepared_questions.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(reviewedPlan.questions[0]).toMatchObject({
      question: "发行人的主营业务和偿债相关主体是谁？",
      answer: "正式回答草稿：发行人的偿债相关主体包括发行人、担保方和主要经营现金流来源，仍需终审。",
      evidence: "人工审阅要求：必须绑定募集说明书发行人概况章节。",
      status: "verified_target",
      review_note: "问题目标已确认，答案仍待证据抽取。",
      edited_by: "open-insight-studio"
    });
    expect(claims[0]).toMatchObject({
      status: "needs_review",
      summary: "问题目标“发行人的主营业务和偿债相关主体是谁？”已在 Studio 中确认，但回答仍等待证据抽取和人工审阅。",
      review_state: "question_target_confirmed",
      confirmation_scope: "question_target_only",
      edited_by: "open-insight-studio",
      review_note: "问题目标已确认，答案仍待证据抽取。"
    });
    expect(preparedQuestions[0]).toMatchObject({
      question: "发行人的主营业务和偿债相关主体是谁？",
      answer: "正式回答草稿：发行人的偿债相关主体包括发行人、担保方和主要经营现金流来源，仍需终审。",
      status: "needs_review",
      review_state: "question_target_confirmed",
      confirmation_scope: "question_target_only",
      edited_by: "open-insight-studio"
    });
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("applies Studio data request drafts without mutating the base package", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const reviewedPlan = applyDraftQuestionOverrides(plan, {
      q_issuer_overview: {
        status: "needs_data",
        review_note: "已从发布处理清单生成补数请求：studio_req_issuer_cashflow。",
        source: "studio_publish_remediation",
        base_package_mutation: false,
        imported_at: "2026-05-09T00:00:00.000Z",
        imported_by: "open-insight-studio",
        data_request_ids: ["studio_req_issuer_cashflow"],
        active_data_request_ids: ["studio_req_issuer_cashflow"],
        data_requests: [
          {
            request_id: "studio_req_issuer_cashflow",
            question: "需要发行人现金流明细吗？",
            status: "draft",
            missing_fields: ["cashflow_statement", "debt_schedule"],
            why_needed: "用于判断偿债来源是否充分。",
            priority: "high",
            affected_findings: ["claim_issuer_overview"],
            source: "studio_publish_remediation",
            base_package_mutation: false,
            imported_at: "2026-05-09T00:00:00.000Z",
            imported_by: "open-insight-studio"
          }
        ]
      }
    });
    const files = buildDraftPackageFiles(reviewedPlan);
    const preparedQuestions = files["qa/prepared_questions.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const dataRequests = files["answerability/data_requests.jsonl"]!
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(reviewedPlan.questions[0]).toMatchObject({
      status: "needs_data",
      data_request_ids: ["studio_req_issuer_cashflow"],
      active_data_request_ids: ["studio_req_issuer_cashflow"],
      edited_by: "open-insight-studio"
    });
    expect(preparedQuestions[0]).toMatchObject({
      status: "unanswerable",
      data_request_ids: ["studio_req_issuer_cashflow"],
      active_data_request_ids: ["studio_req_issuer_cashflow"],
      base_package_mutation: false
    });
    expect(dataRequests).toEqual([
      expect.objectContaining({
        request_id: "studio_req_issuer_cashflow",
        missing_fields: ["cashflow_statement", "debt_schedule"],
        source: "studio_publish_remediation",
        base_package_mutation: false
      })
    ]);
    expect(validateDraftPackageFiles(files).status).toBe("valid");
  });

  it("validates draft package files before export", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const result = validateDraftPackageFiles(files);

    expect(result).toEqual({
      status: "valid",
      issues: [],
      fileCount: 10
    });
  });

  it("validates package review history references before export", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    files["versioning/review_history.jsonl"] = `${JSON.stringify({
      review_id: "studio_review_q_issuer_overview_2026_05_02",
      review_type: "studio_question_review",
      review_state: "recorded",
      target_type: "prepared_question",
      review_scope: "question_target_only",
      package_id: "org.example.bond",
      title: "Bond Insight",
      domain_pack: "none",
      question_id: "q_issuer_overview",
      section: "Issuer overview",
      origin: "template",
      primary_claim_id: "claim_issuer_overview",
      primary_evidence_id: "ev_issuer_overview",
      claim_ids: ["claim_issuer_overview"],
      evidence_ids: ["ev_issuer_overview"],
      reviewer: "张三",
      recorded_at: "2026-05-02T00:00:00.000Z",
      source: "open-insight-studio",
      base_package_mutation: false,
      generated: {
        question: "文件包应如何说明“Issuer overview”？",
        status: "needs_review",
        evidence: "候选证据：prospectus.pdf",
        review_note: ""
      },
      current: {
        question: "发行人概况应该重点说明什么？",
        status: "verified_target",
        evidence: "候选证据：prospectus.pdf",
        review_note: "问题目标已确认。"
      },
      diffs: [{ field: "status", label: "状态", before: "needs_review", after: "verified_target" }]
    })}\n`;

    const result = validateDraftPackageFiles(files);

    expect(result).toEqual({
      status: "valid",
      issues: [],
      fileCount: 11
    });
  });

  it("reports missing files and broken references before export", () => {
    const plan = buildDraftPlan({
      title: "Bond Insight",
      packageId: "org.example.bond",
      template: "Issuer overview",
      sources: ["prospectus.pdf"],
      createdAt: "2026-04-29T00:00:00.000Z"
    });
    const files = buildDraftPackageFiles(plan);
    const brokenFiles: Record<string, string> = {
      ...files,
      "qa/prepared_questions.jsonl":
        '{"question_id":"q_missing","question":"Missing?","answer":"Missing.","status":"needs_review","claim_ids":["claim_missing"],"evidence_ids":["ev_missing"]}\n'
    };
    delete brokenFiles["lineage/sources.json"];
    const result = validateDraftPackageFiles(brokenFiles);

    expect(result.status).toBe("invalid");
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "缺少必需草稿包文件：lineage/sources.json",
      "预置问题 q_missing 引用了不存在的结论 claim_missing。",
      "预置问题 q_missing 引用了不存在的证据 ev_missing。"
    ]);
  });
});

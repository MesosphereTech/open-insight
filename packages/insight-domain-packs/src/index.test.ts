import { describe, expect, it } from "vitest";
import { DOMAIN_PACKS, buildTemplateFromDomainPack, getDefaultDomainPack, requireDomainPack, summarizeDomainPack } from "./index.js";

describe("domain pack registry", () => {
  it("ships the first nine China-market domain packs", () => {
    expect(DOMAIN_PACKS.map((pack) => pack.domain_id)).toEqual([
      "sales_operation",
      "government_project_performance",
      "manufacturing_quality",
      "supply_chain_fulfillment",
      "channel_inventory_collaboration",
      "healthcare_quality_control",
      "education_quality_analysis",
      "bond_analysis",
      "contract_review"
    ]);
    expect(DOMAIN_PACKS.every((pack) => pack.market_focus.includes("中国"))).toBe(true);
  });

  it("uses safe extension namespaces and stable versions", () => {
    DOMAIN_PACKS.forEach((pack) => {
      expect(pack.namespace).toMatch(/^org\.openinsight\.domain\.[a-z_]+$/);
      expect(pack.namespace).not.toMatch(/[\\/]|\.{2}/);
      expect(pack.version).toBe("0.1.0");
    });
  });

  it("provides templates, questions, evidence rules, view rules, and review rules", () => {
    DOMAIN_PACKS.forEach((pack) => {
      const questionIds = new Set(pack.required_questions.map((question) => question.question_id));

      expect(buildTemplateFromDomainPack(pack).split("\n")).toEqual(pack.template_sections);
      expect(pack.template_sections.length).toBeGreaterThanOrEqual(6);
      expect(questionIds.size).toBe(pack.required_questions.length);
      expect(pack.required_questions.length).toBeGreaterThanOrEqual(3);
      expect(pack.evidence_rules.length).toBeGreaterThan(0);
      expect(pack.metric_blueprints.every((blueprint) => blueprint.aggregation && blueprint.evidence_requirement)).toBe(true);
      expect(pack.view_rules.every((rule) => rule.required_trace.includes("evidence_id"))).toBe(true);
      expect(pack.review_rules.length).toBeGreaterThan(0);
      expect(pack.default_sources.length).toBeGreaterThan(0);
    });
  });

  it("declares ratio metrics with enough calculation context", () => {
    const salesRepeatRate = requireDomainPack("sales_operation").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "repeat_customer_rate"
    );
    const qualityDefectRate = requireDomainPack("manufacturing_quality").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "defect_rate"
    );
    const projectBudgetExecution = requireDomainPack("government_project_performance").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "budget_execution_rate"
    );
    const supplyOtifRate = requireDomainPack("supply_chain_fulfillment").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "otif_rate"
    );
    const channelStockoutRate = requireDomainPack("channel_inventory_collaboration").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "stockout_rate"
    );
    const channelSellThroughRate = requireDomainPack("channel_inventory_collaboration").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "sell_through_rate"
    );
    const healthcareReadmissionRate = requireDomainPack("healthcare_quality_control").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "readmission_rate_30d"
    );
    const educationAssignmentCompletion = requireDomainPack("education_quality_analysis").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "assignment_completion_rate"
    );
    const bondCoverage = requireDomainPack("bond_analysis").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "coverage_ratio"
    );

    expect(salesRepeatRate).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["repeat_customer_id"]),
      denominator_columns: expect.arrayContaining(["customer_id"])
    });
    expect(qualityDefectRate).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["defect_qty"]),
      denominator_columns: expect.arrayContaining(["inspection_qty"]),
      evidence_requirement: expect.stringContaining("不能只用单列")
    });
    expect(projectBudgetExecution).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["actual_spend"]),
      denominator_columns: expect.arrayContaining(["approved_budget"]),
      evidence_requirement: expect.stringContaining("不能只用支出金额")
    });
    expect(supplyOtifRate).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["otif_order_count"]),
      denominator_columns: expect.arrayContaining(["order_id"]),
      field_roles: expect.arrayContaining([
        expect.objectContaining({
          role: "numerator",
          preferred_columns: expect.arrayContaining(["on_time_flag", "in_full_flag"])
        })
      ]),
      evidence_requirement: expect.stringContaining("不能只用发货数量")
    });
    expect(channelStockoutRate).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["stockout_flag"]),
      denominator_columns: expect.arrayContaining(["sku_id"]),
      evidence_requirement: expect.stringContaining("不能把单个渠道缺货")
    });
    expect(channelSellThroughRate).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["sold_qty"]),
      denominator_columns: expect.arrayContaining(["available_inventory_qty"]),
      evidence_requirement: expect.stringContaining("不能只用销售数量")
    });
    expect(healthcareReadmissionRate).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["readmission_30d_flag"]),
      denominator_columns: expect.arrayContaining(["discharge_patient_count"]),
      field_roles: expect.arrayContaining([
        expect.objectContaining({
          role: "numerator",
          preferred_columns: expect.arrayContaining(["readmission_30d_flag"])
        })
      ]),
      evidence_requirement: expect.stringContaining("再入院窗口")
    });
    expect(educationAssignmentCompletion).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["completed_assignments"]),
      denominator_columns: expect.arrayContaining(["assigned_assignments"]),
      field_roles: expect.arrayContaining([
        expect.objectContaining({
          role: "numerator",
          preferred_columns: expect.arrayContaining(["on_time_submissions"])
        })
      ]),
      evidence_requirement: expect.stringContaining("不能把成绩变化直接归因")
    });
    expect(bondCoverage).toMatchObject({
      aggregation: "ratio",
      numerator_columns: expect.arrayContaining(["ebitda"]),
      denominator_columns: expect.arrayContaining(["interest"]),
      evidence_requirement: expect.stringContaining("不能仅用")
    });
  });

  it("declares metric field roles for different source grains", () => {
    const salesOrderCount = requireDomainPack("sales_operation").metric_blueprints.find((blueprint) => blueprint.metric_id === "order_count");
    const qualityBatchCount = requireDomainPack("manufacturing_quality").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "inspection_batch_count"
    );
    const qualityFirstPassYield = requireDomainPack("manufacturing_quality").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "first_pass_yield"
    );
    const projectCount = requireDomainPack("government_project_performance").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "project_count"
    );
    const projectProgress = requireDomainPack("government_project_performance").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "milestone_completion_rate"
    );
    const supplyFillRate = requireDomainPack("supply_chain_fulfillment").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "fill_rate"
    );
    const supplyDelayedOrders = requireDomainPack("supply_chain_fulfillment").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "delayed_order_count"
    );
    const channelSkuCount = requireDomainPack("channel_inventory_collaboration").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "sku_count"
    );
    const channelAvailableInventory = requireDomainPack("channel_inventory_collaboration").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "available_inventory_qty"
    );
    const healthcarePatientCount = requireDomainPack("healthcare_quality_control").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "discharge_patient_count"
    );
    const healthcareAverageLos = requireDomainPack("healthcare_quality_control").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "average_length_of_stay"
    );
    const educationStudentCount = requireDomainPack("education_quality_analysis").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "student_count"
    );
    const educationAverageScore = requireDomainPack("education_quality_analysis").metric_blueprints.find(
      (blueprint) => blueprint.metric_id === "average_score"
    );
    const bondDebtBalance = requireDomainPack("bond_analysis").metric_blueprints.find((blueprint) => blueprint.metric_id === "debt_balance");
    const contractAmount = requireDomainPack("contract_review").metric_blueprints.find((blueprint) => blueprint.metric_id === "contract_amount");

    DOMAIN_PACKS.forEach((pack) => {
      pack.metric_blueprints.forEach((blueprint) => {
        blueprint.field_roles?.forEach((fieldRole) => {
          expect(fieldRole.preferred_columns.length).toBeGreaterThan(0);
        });
      });
    });
    expect(salesOrderCount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(qualityBatchCount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(qualityFirstPassYield?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "ratio_value", aggregation: "latest_value" }),
        expect.objectContaining({ role: "numerator", aggregation: "sum" }),
        expect.objectContaining({ role: "denominator", aggregation: "sum" })
      ])
    );
    expect(projectCount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(projectProgress?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "ratio_value", aggregation: "latest_value" }),
        expect.objectContaining({ role: "numerator", aggregation: "sum" }),
        expect.objectContaining({ role: "denominator", aggregation: "sum" })
      ])
    );
    expect(supplyFillRate?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "ratio_value", aggregation: "latest_value" }),
        expect.objectContaining({ role: "numerator", aggregation: "sum" }),
        expect.objectContaining({ role: "denominator", aggregation: "sum" })
      ])
    );
    expect(supplyDelayedOrders?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" }),
        expect.objectContaining({ role: "detail_value", aggregation: "sum" })
      ])
    );
    expect(channelSkuCount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(channelAvailableInventory?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "detail_value", aggregation: "sum" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(healthcarePatientCount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(healthcareAverageLos?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "ratio_value", aggregation: "latest_value" }),
        expect.objectContaining({ role: "numerator", aggregation: "sum" }),
        expect.objectContaining({ role: "denominator", aggregation: "count" })
      ])
    );
    expect(educationStudentCount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "entity_id", aggregation: "count" }),
        expect.objectContaining({ role: "summary_value", aggregation: "sum" })
      ])
    );
    expect(educationAverageScore?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "ratio_value", aggregation: "latest_value" }),
        expect.objectContaining({
          role: "numerator",
          aggregation: "sum",
          preferred_columns: expect.arrayContaining(["exam_score"])
        }),
        expect.objectContaining({
          role: "denominator",
          aggregation: "count",
          preferred_columns: expect.arrayContaining(["student_id"])
        })
      ])
    );
    expect(bondDebtBalance?.field_roles).toEqual(expect.arrayContaining([expect.objectContaining({ role: "detail_value", aggregation: "sum" })]));
    expect(contractAmount?.field_roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "summary_value", aggregation: "latest_value" }),
        expect.objectContaining({ role: "detail_value", aggregation: "sum" })
      ])
    );
  });

  it("keeps high-risk packs conservative for professional use", () => {
    expect(getDefaultDomainPack().domain_id).toBe("bond_analysis");
    expect(requireDomainPack("bond_analysis").review_rules.join(" ")).toContain("not_advice");
    expect(requireDomainPack("contract_review").review_rules.join(" ")).toContain("法律意见");
    expect(requireDomainPack("healthcare_quality_control").review_rules.join(" ")).toContain("诊断、治疗建议");
    expect(requireDomainPack("education_quality_analysis").review_rules.join(" ")).toContain("招生录取、分班、处分");
    expect(requireDomainPack("channel_inventory_collaboration").review_rules.join(" ")).toContain("自动执行指令");
  });

  it("summarizes a pack for Studio display", () => {
    expect(summarizeDomainPack(requireDomainPack("sales_operation"))).toBe("销售经营分析 / 3 个必答问题 / 3 个指标蓝图");
    expect(summarizeDomainPack(requireDomainPack("manufacturing_quality"))).toBe("制造质量追踪 / 3 个必答问题 / 4 个指标蓝图");
    expect(summarizeDomainPack(requireDomainPack("government_project_performance"))).toBe("政府项目绩效评价 / 3 个必答问题 / 4 个指标蓝图");
    expect(summarizeDomainPack(requireDomainPack("supply_chain_fulfillment"))).toBe("供应链履约评价 / 3 个必答问题 / 4 个指标蓝图");
    expect(summarizeDomainPack(requireDomainPack("channel_inventory_collaboration"))).toBe("渠道库存协同 / 3 个必答问题 / 4 个指标蓝图");
    expect(summarizeDomainPack(requireDomainPack("healthcare_quality_control"))).toBe("医疗质控分析 / 3 个必答问题 / 4 个指标蓝图");
    expect(summarizeDomainPack(requireDomainPack("education_quality_analysis"))).toBe("教育质量分析 / 3 个必答问题 / 4 个指标蓝图");
  });
});

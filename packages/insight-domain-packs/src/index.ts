export type DomainPackId =
  | "sales_operation"
  | "government_project_performance"
  | "manufacturing_quality"
  | "supply_chain_fulfillment"
  | "channel_inventory_collaboration"
  | "healthcare_quality_control"
  | "education_quality_analysis"
  | "bond_analysis"
  | "contract_review";

export interface DomainPackSourceHint {
  name: string;
  path: string;
  type: string;
}

export interface DomainPackQuestion {
  question_id: string;
  question: string;
  why_required: string;
  evidence_expectation: string;
}

export type DomainPackMetricAggregation = "sum" | "count" | "latest_value" | "ratio";

export type DomainPackMetricFieldRole = "summary_value" | "detail_value" | "entity_id" | "ratio_value" | "numerator" | "denominator";

export interface DomainPackMetricFieldRoleMapping {
  role: DomainPackMetricFieldRole;
  preferred_columns: string[];
  aggregation?: DomainPackMetricAggregation;
}

export interface DomainPackMetricBlueprint {
  metric_id: string;
  name: string;
  definition: string;
  preferred_columns: string[];
  aggregation?: DomainPackMetricAggregation;
  field_roles?: DomainPackMetricFieldRoleMapping[];
  numerator_columns?: string[];
  denominator_columns?: string[];
  evidence_requirement?: string;
}

export interface DomainPackViewRule {
  view_id: string;
  title: string;
  intent: string;
  required_trace: Array<"view_block_id" | "claim_id" | "metric_id" | "evidence_id" | "source_ref">;
}

export interface DomainPack {
  domain_id: DomainPackId;
  namespace: string;
  version: string;
  title: string;
  market_focus: string;
  audience: string;
  default_title: string;
  default_package_id: string;
  description: string;
  template_sections: string[];
  required_questions: DomainPackQuestion[];
  metric_blueprints: DomainPackMetricBlueprint[];
  evidence_rules: string[];
  view_rules: DomainPackViewRule[];
  review_rules: string[];
  default_sources: DomainPackSourceHint[];
}

export const DOMAIN_PACKS: DomainPack[] = [
  {
    domain_id: "sales_operation",
    namespace: "org.openinsight.domain.sales_operation",
    version: "0.1.0",
    title: "销售经营分析",
    market_focus: "中国企业经营管理",
    audience: "经营负责人、财务 BP、区域负责人",
    default_title: "销售经营洞察",
    default_package_id: "org.openinsight.drafts.sales_operation",
    description: "用于月度、季度销售复盘，重点追踪收入、订单、区域、渠道、客户结构和不可回答的数据缺口。",
    template_sections: ["经营概览", "收入与订单", "区域表现", "渠道结构", "客户留存", "风险与数据缺口", "管理层问答"],
    required_questions: [
      {
        question_id: "sales_revenue_driver",
        question: "本期收入增长或下滑由哪些区域、渠道和客户结构驱动？",
        why_required: "经营复盘必须解释变化来源，避免只展示总额。",
        evidence_expectation: "至少绑定收入、订单、区域或渠道维度的 evidence。"
      },
      {
        question_id: "sales_retention_gap",
        question: "增长是否由老客复购、老客流失或新客贡献变化导致？",
        why_required: "客户结构是销售质量判断的关键。",
        evidence_expectation: "需要客户粒度、首购日期、历史订单或明确的数据请求。"
      },
      {
        question_id: "sales_action_priority",
        question: "下一阶段最应该优先处理哪些区域、渠道或客户问题？",
        why_required: "经营分析需要落到动作优先级。",
        evidence_expectation: "必须引用风险结论、异常指标或不可回答清单。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "revenue",
        name: "收入",
        definition: "指定期间内确认的销售收入总额。",
        preferred_columns: ["revenue", "amount", "sales_amount", "收入", "销售额"],
        aggregation: "sum",
        field_roles: [
          {
            role: "detail_value",
            preferred_columns: ["revenue", "amount", "sales_amount", "收入", "销售额"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要收入字段、期间字段，以及区域、渠道或客户等可解释维度。"
      },
      {
        metric_id: "order_count",
        name: "订单数",
        definition: "指定期间内的订单数量。",
        preferred_columns: ["order_id", "orders", "order_count", "订单数"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["order_id", "订单ID", "订单编号"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["orders", "order_count", "订单数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "优先使用订单 ID 去重计数；若来源已经是订单数量汇总字段，应保留该汇总口径。"
      },
      {
        metric_id: "repeat_customer_rate",
        name: "复购客户占比",
        definition: "有历史购买记录的客户在本期客户中的占比。",
        preferred_columns: ["repeat_customer_rate", "复购率", "复购客户占比"],
        aggregation: "ratio",
        numerator_columns: ["repeat_customer_id", "repeat_customer_count", "prior_orders", "复购客户", "复购"],
        denominator_columns: ["customer_id", "customer_count", "客户数", "客户"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["repeat_customer_rate", "复购率", "复购客户占比"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["repeat_customer_id", "repeat_customer_count", "prior_orders", "复购客户", "复购"],
            aggregation: "count"
          },
          {
            role: "denominator",
            preferred_columns: ["customer_id", "customer_count", "客户数", "客户"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "需要可识别本期客户和复购客户的字段；缺少客户历史时必须生成 data request。"
      }
    ],
    evidence_rules: [
      "收入、订单和区域/渠道判断必须能追到数据集与来源文件。",
      "客户留存结论缺少客户历史时必须生成 data request。",
      "行动建议必须引用至少一个 claim 或 data request。"
    ],
    view_rules: [
      {
        view_id: "sales_overview",
        title: "经营总览",
        intent: "第一屏展示收入、订单、区域/渠道贡献和关键风险。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "sales_breakdown",
        title: "区域与渠道拆解",
        intent: "展示维度贡献和异常变化。",
        required_trace: ["view_block_id", "metric_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: ["管理建议必须人工审阅。", "不可回答问题不能被自动改写为已验证。"],
    default_sources: [
      { name: "sales-orders.csv", path: "sources/sales-orders.csv", type: "csv" },
      { name: "customer-history.xlsx", path: "sources/customer-history.xlsx", type: "xlsx" }
    ]
  },
  {
    domain_id: "government_project_performance",
    namespace: "org.openinsight.domain.government_project_performance",
    version: "0.1.0",
    title: "政府项目绩效评价",
    market_focus: "中国政府项目绩效与公共资金管理",
    audience: "项目主管部门、财政绩效评价团队、审计和实施单位",
    default_title: "政府项目绩效洞察",
    default_package_id: "org.openinsight.drafts.government_project_performance",
    description: "用于政府投资项目、专项资金项目和公共服务项目的预算执行、进度、产出、问题整改和证据追踪，强调财政/审计边界和人工复核。",
    template_sections: ["项目概况", "预算与资金执行", "里程碑进度", "合同与采购", "产出与绩效目标", "问题整改", "绩效评价问答"],
    required_questions: [
      {
        question_id: "project_budget_progress_match",
        question: "预算执行是否与项目进度和产出完成情况匹配？",
        why_required: "绩效评价需要同时看资金执行、进度和产出，避免只看支出比例。",
        evidence_expectation: "至少绑定预算、实际支出、计划/完成里程碑或产出数量的 evidence。"
      },
      {
        question_id: "project_milestone_delay",
        question: "哪些里程碑、合同节点或交付物存在延期、缺证或偏离目标？",
        why_required: "项目延期和证据缺口直接影响绩效评价可信度。",
        evidence_expectation: "需要里程碑、合同节点、延期天数、整改状态或明确的数据请求。"
      },
      {
        question_id: "project_rectification_priority",
        question: "下一阶段应优先整改哪些问题，责任单位和证据材料是什么？",
        why_required: "绩效评价必须形成可追踪的整改闭环。",
        evidence_expectation: "必须引用问题清单、整改责任、证据缺口或不可回答结论。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "budget_execution_rate",
        name: "预算执行率",
        definition: "实际支出金额占批复预算金额的比例。",
        preferred_columns: ["budget_execution_rate", "预算执行率", "资金执行率"],
        aggregation: "ratio",
        numerator_columns: ["actual_spend", "spent_amount", "paid_amount", "实际支出", "已支付金额"],
        denominator_columns: ["approved_budget", "budget_amount", "批复预算", "预算金额"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["budget_execution_rate", "预算执行率", "资金执行率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["actual_spend", "spent_amount", "paid_amount", "实际支出", "已支付金额"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["approved_budget", "budget_amount", "批复预算", "预算金额"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "必须同时说明实际支出和批复预算来源；不能只用支出金额代表预算执行率。"
      },
      {
        metric_id: "milestone_completion_rate",
        name: "里程碑完成率",
        definition: "已完成里程碑数量占计划里程碑数量的比例。",
        preferred_columns: ["milestone_completion_rate", "progress_rate", "里程碑完成率", "进度完成率"],
        aggregation: "ratio",
        numerator_columns: ["completed_milestones", "completed_tasks", "已完成里程碑", "完成节点数"],
        denominator_columns: ["planned_milestones", "planned_tasks", "计划里程碑", "计划节点数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["milestone_completion_rate", "progress_rate", "里程碑完成率", "进度完成率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["completed_milestones", "completed_tasks", "已完成里程碑", "完成节点数"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["planned_milestones", "planned_tasks", "计划里程碑", "计划节点数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要计划里程碑、已完成里程碑和对应验收或交付证据；不能只展示进度文字。"
      },
      {
        metric_id: "project_count",
        name: "项目数量",
        definition: "纳入当前绩效评价范围的项目数量。",
        preferred_columns: ["project_id", "project_count", "项目编号", "项目数量"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["project_id", "项目编号", "项目ID"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["project_count", "项目数量"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "优先使用项目编号去重计数；若来源为汇总项目数，应保留汇总口径和评价范围。"
      },
      {
        metric_id: "open_issue_count",
        name: "未整改问题数",
        definition: "截至当前评价时点仍未完成整改的问题数量。",
        preferred_columns: ["open_issue_count", "issue_count", "未整改问题数", "问题数"],
        aggregation: "sum",
        field_roles: [
          {
            role: "summary_value",
            preferred_columns: ["open_issue_count", "issue_count", "未整改问题数", "问题数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要问题清单、责任单位和整改状态；仅有问题描述而无状态时应生成数据缺口。"
      }
    ],
    evidence_rules: [
      "预算执行、进度和产出判断必须能追到项目台账、资金拨付或验收材料。",
      "整改优先级不能只来自模型推断，必须绑定问题清单、责任单位和整改证据。",
      "缺少合同、验收、资金支付或整改状态时必须生成 data request。"
    ],
    view_rules: [
      {
        view_id: "project_performance_overview",
        title: "绩效总览",
        intent: "第一屏展示预算执行率、进度完成率、问题整改和主要证据缺口。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "rectification_register",
        title: "整改清单",
        intent: "展示未整改问题、责任单位、证据缺口和下一步材料请求。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: [
      "财政、审计和问责相关结论必须人工审阅。",
      "不能把 AI 生成分析伪装成正式绩效评价报告、审计意见或财政处罚依据。"
    ],
    default_sources: [
      { name: "project-ledger.csv", path: "sources/project-ledger.csv", type: "csv" },
      { name: "payment-records.xlsx", path: "sources/payment-records.xlsx", type: "xlsx" },
      { name: "acceptance-materials.pdf", path: "sources/acceptance-materials.pdf", type: "pdf" }
    ]
  },
  {
    domain_id: "manufacturing_quality",
    namespace: "org.openinsight.domain.manufacturing_quality",
    version: "0.1.0",
    title: "制造质量追踪",
    market_focus: "中国制造业质量管理",
    audience: "质量负责人、工厂厂长、生产计划、供应链质量团队",
    default_title: "制造质量洞察",
    default_package_id: "org.openinsight.drafts.manufacturing_quality",
    description: "用于生产批次、质检记录、缺陷分类、返工和供应商质量追踪，强调批次证据、异常原因和人工复核。",
    template_sections: ["质量概览", "批次与产量", "缺陷率与一次合格率", "返工与报废", "供应商与工序", "异常原因与纠正措施", "质量管理问答"],
    required_questions: [
      {
        question_id: "quality_defect_driver",
        question: "本期主要缺陷由哪些产品线、工序、班组或供应商驱动？",
        why_required: "质量复盘不能只看总体缺陷率，必须定位到可处理的责任维度。",
        evidence_expectation: "至少绑定批次、缺陷数量、产量、工序或供应商维度的 evidence。"
      },
      {
        question_id: "quality_rework_scrap_impact",
        question: "返工、报废和让步接收分别对交付和成本造成了什么影响？",
        why_required: "返工和报废直接影响交付、成本和客户投诉风险。",
        evidence_expectation: "需要返工数量、报废数量、批次状态、成本或交付影响字段；缺少时生成 data request。"
      },
      {
        question_id: "quality_corrective_action",
        question: "哪些异常需要 CAPA、供应商整改或工艺参数复核？",
        why_required: "质量分析需要落到纠正预防措施和责任闭环。",
        evidence_expectation: "必须引用异常结论、缺陷分类、供应商/工序来源或不可回答清单。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "inspection_batch_count",
        name: "检验批次数",
        definition: "指定期间内进入质检或放行流程的批次数量。",
        preferred_columns: ["batch_id", "lot_id", "inspection_lot", "批次号", "检验批次"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["batch_id", "lot_id", "inspection_lot", "批次号", "检验批次"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["batch_count", "inspection_batches", "检验批次数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "优先使用批次 ID 去重计数；若来源已经是批次数汇总字段，应保留汇总口径并标明期间。"
      },
      {
        metric_id: "defect_rate",
        name: "缺陷率",
        definition: "缺陷数量占检验数量或生产数量的比例。",
        preferred_columns: ["defect_rate", "不良率", "缺陷率"],
        aggregation: "ratio",
        numerator_columns: ["defect_qty", "defect_count", "ng_qty", "不良数", "缺陷数"],
        denominator_columns: ["inspection_qty", "production_qty", "total_qty", "检验数", "产量"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["defect_rate", "不良率", "缺陷率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["defect_qty", "defect_count", "ng_qty", "不良数", "缺陷数"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["inspection_qty", "production_qty", "total_qty", "检验数", "产量"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "必须同时说明缺陷数量和检验/生产数量来源；不能只用单列缺陷数伪装成缺陷率。"
      },
      {
        metric_id: "first_pass_yield",
        name: "一次合格率",
        definition: "未经过返工即通过检验的数量占总检验数量的比例。",
        preferred_columns: ["first_pass_yield", "fpy", "一次合格率", "一次通过率"],
        aggregation: "ratio",
        numerator_columns: ["first_pass_qty", "pass_qty", "合格数", "一次合格数"],
        denominator_columns: ["inspection_qty", "production_qty", "total_qty", "检验数", "产量"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["first_pass_yield", "fpy", "一次合格率", "一次通过率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["first_pass_qty", "pass_qty", "合格数", "一次合格数"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["inspection_qty", "production_qty", "total_qty", "检验数", "产量"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要一次通过数量和检验总量；返工后合格不能混入一次合格口径。"
      },
      {
        metric_id: "rework_qty",
        name: "返工数量",
        definition: "指定期间内需要返工处理的产品数量。",
        preferred_columns: ["rework_qty", "rework_count", "返工数", "返修数"],
        aggregation: "sum",
        field_roles: [
          {
            role: "detail_value",
            preferred_columns: ["rework_qty", "rework_count", "返工数", "返修数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要返工数量、批次和缺陷原因；若只有返工状态而无数量，应生成数据缺口。"
      }
    ],
    evidence_rules: [
      "缺陷率、一次合格率和返工判断必须能追到批次、工序、产品线或供应商来源。",
      "质量异常原因不能只来自模型推断，必须绑定缺陷分类、质检记录或 CAPA 记录。",
      "缺少批次号、检验数量、缺陷数量或供应商字段时必须生成 data request。"
    ],
    view_rules: [
      {
        view_id: "quality_overview",
        title: "质量总览",
        intent: "第一屏展示缺陷率、一次合格率、返工数量、主要异常和数据缺口。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "defect_breakdown",
        title: "缺陷来源拆解",
        intent: "按工序、供应商、产品线或班组拆解缺陷贡献。",
        required_trace: ["view_block_id", "metric_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: ["客户投诉、召回、停线和供应商处罚建议必须人工审阅。", "不能把 AI 生成的原因分析伪装成已完成的 8D/CAPA 结论。"],
    default_sources: [
      { name: "inspection-lots.csv", path: "sources/inspection-lots.csv", type: "csv" },
      { name: "defect-codes.xlsx", path: "sources/defect-codes.xlsx", type: "xlsx" },
      { name: "capa-log.docx", path: "sources/capa-log.docx", type: "docx" }
    ]
  },
  {
    domain_id: "supply_chain_fulfillment",
    namespace: "org.openinsight.domain.supply_chain_fulfillment",
    version: "0.1.0",
    title: "供应链履约评价",
    market_focus: "中国制造、零售与物流履约管理",
    audience: "供应链计划、采购、物流、销售运营和客户服务团队",
    default_title: "供应链履约洞察",
    default_package_id: "org.openinsight.drafts.supply_chain_fulfillment",
    description: "用于订单履约、供应商交付、库存缺口、运输延迟和客户承诺达成情况分析，强调 OTIF、足量交付、缺货和责任边界。",
    template_sections: ["履约概览", "订单与客户承诺", "准时交付", "足量交付", "缺货与积压", "供应商与物流节点", "履约改善问答"],
    required_questions: [
      {
        question_id: "supply_otif_driver",
        question: "哪些客户、区域、SKU 或供应商导致 OTIF 偏低？",
        why_required: "履约评价不能只看总体交付率，必须定位到可处理的客户、商品和供应节点。",
        evidence_expectation: "至少绑定订单、承诺日期、实际交付日期、足量交付或 SKU/供应商维度 evidence。"
      },
      {
        question_id: "supply_shortage_delay_reason",
        question: "缺货、延期或积压主要来自库存、供应商、生产还是运输节点？",
        why_required: "履约问题需要区分责任环节，否则改善动作会失焦。",
        evidence_expectation: "需要缺货数量、积压数量、延期天数、供应商或物流节点字段；缺少时生成 data request。"
      },
      {
        question_id: "supply_recovery_priority",
        question: "下一阶段应优先保障哪些订单、客户、SKU 或供应商整改？",
        why_required: "履约分析需要转化为可执行的保供和整改优先级。",
        evidence_expectation: "必须引用逾期订单、缺货数量、客户等级、供应商异常或不可回答清单。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "otif_rate",
        name: "准时足量交付率",
        definition: "同时满足准时交付和足量交付的订单占承诺交付订单的比例。",
        preferred_columns: ["otif_rate", "otif", "准时足量交付率", "完美订单率"],
        aggregation: "ratio",
        numerator_columns: ["otif_order_count", "on_time_full_count", "on_time_flag", "in_full_flag", "准时足量订单数"],
        denominator_columns: ["order_id", "order_count", "committed_order_count", "订单编号", "订单数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["otif_rate", "otif", "准时足量交付率", "完美订单率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["otif_order_count", "on_time_full_count", "on_time_flag", "in_full_flag", "准时足量订单数"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["order_id", "order_count", "committed_order_count", "订单编号", "订单数"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "必须同时说明准时、足量和订单范围口径；不能只用发货数量或单一准时字段代表 OTIF。"
      },
      {
        metric_id: "fill_rate",
        name: "订单满足率",
        definition: "实际发货数量占客户订单需求数量的比例。",
        preferred_columns: ["fill_rate", "fulfillment_rate", "订单满足率", "交付满足率"],
        aggregation: "ratio",
        numerator_columns: ["shipped_qty", "delivered_qty", "实际发货数量", "交付数量"],
        denominator_columns: ["ordered_qty", "demand_qty", "订单数量", "需求数量"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["fill_rate", "fulfillment_rate", "订单满足率", "交付满足率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["shipped_qty", "delivered_qty", "实际发货数量", "交付数量"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["ordered_qty", "demand_qty", "订单数量", "需求数量"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "必须同时说明订单需求数量和实际交付数量来源；不能只用发货数量代表满足率。"
      },
      {
        metric_id: "delayed_order_count",
        name: "逾期订单数",
        definition: "超过承诺交付日期仍未准时完成交付的订单数量。",
        preferred_columns: ["delayed_order_count", "delay_days", "late_order_count", "逾期订单数", "延期天数"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["order_id", "订单编号", "销售订单号"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["delayed_order_count", "late_order_count", "逾期订单数"],
            aggregation: "sum"
          },
          {
            role: "detail_value",
            preferred_columns: ["delay_days", "延期天数", "late_days"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要承诺交付日期、实际交付日期或延期天数；只有状态文字时应生成数据缺口。"
      },
      {
        metric_id: "backorder_qty",
        name: "积压数量",
        definition: "因缺货、延期或未完成交付而形成的未满足数量。",
        preferred_columns: ["backorder_qty", "shortage_qty", "积压数量", "缺货数量"],
        aggregation: "sum",
        field_roles: [
          {
            role: "detail_value",
            preferred_columns: ["backorder_qty", "shortage_qty", "积压数量", "缺货数量"],
            aggregation: "sum"
          },
          {
            role: "summary_value",
            preferred_columns: ["total_backorder_qty", "total_shortage_qty", "总积压数量", "总缺货数量"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要缺货或积压数量、SKU 和责任环节；若缺少库存或供应商原因，应生成 data request。"
      }
    ],
    evidence_rules: [
      "OTIF、准时交付和订单满足率必须能追到订单明细、承诺日期、实际交付日期和交付数量。",
      "缺货或积压原因不能只来自模型推断，必须绑定库存、供应商、生产或物流节点数据。",
      "涉及客户赔付、供应商处罚、排产调整或承诺变更的建议必须人工审阅。"
    ],
    view_rules: [
      {
        view_id: "fulfillment_overview",
        title: "履约总览",
        intent: "第一屏展示 OTIF、订单满足率、逾期订单、积压数量和主要缺口。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "shortage_delay_breakdown",
        title: "缺货与延期拆解",
        intent: "按客户、区域、SKU、供应商或物流节点拆解缺货和延期贡献。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: [
      "客户赔付、供应商处罚、生产排期调整和履约承诺变更必须人工审阅。",
      "不能把 AI 生成分析伪装成正式合同责任认定、客户赔付依据或供应商处罚决定。"
    ],
    default_sources: [
      { name: "fulfillment-orders.csv", path: "sources/fulfillment-orders.csv", type: "csv" },
      { name: "inventory-snapshot.xlsx", path: "sources/inventory-snapshot.xlsx", type: "xlsx" },
      { name: "carrier-events.csv", path: "sources/carrier-events.csv", type: "csv" }
    ]
  },
  {
    domain_id: "channel_inventory_collaboration",
    namespace: "org.openinsight.domain.channel_inventory_collaboration",
    version: "0.1.0",
    title: "渠道库存协同",
    market_focus: "中国零售、电商和品牌渠道库存协同",
    audience: "品牌运营、渠道销售、供应链计划、仓配团队和经销商管理团队",
    default_title: "渠道库存协同洞察",
    default_package_id: "org.openinsight.drafts.channel_inventory_collaboration",
    description:
      "用于品牌商、零售商、电商和经销渠道的库存、销售、缺货、积压、调拨和补货协同分析，强调 SKU/渠道/仓门店证据、预测边界和人工确认。",
    template_sections: ["渠道库存概览", "SKU 与渠道结构", "可售库存与安全库存", "缺货与积压", "销售消化与库存周转", "调拨补货与清仓建议", "协同问答与补数请求"],
    required_questions: [
      {
        question_id: "channel_inventory_stockout_overstock",
        question: "哪些渠道、仓库、门店或 SKU 同时存在缺货、积压或结构性错配？",
        why_required: "渠道库存协同必须定位到可执行的 SKU、渠道和库存节点，不能只看总库存。",
        evidence_expectation: "至少绑定 SKU、渠道、仓门店、可售库存、缺货标记或积压数量的 evidence。"
      },
      {
        question_id: "channel_inventory_sell_through_driver",
        question: "库存消化、缺货和销售表现是否与促销、预测、补货周期或渠道结构有关？",
        why_required: "库存问题通常由销售、计划、补货和渠道共同驱动，需要避免单点归因。",
        evidence_expectation: "需要销售数量、可售库存、预测或补货记录；缺少促销、预测或调拨数据时生成 data request。"
      },
      {
        question_id: "channel_inventory_action_boundary",
        question: "哪些补货、调拨、清仓或采购建议必须人工确认，不能自动形成执行指令？",
        why_required: "库存动作会影响现金流、渠道关系和客户承诺，必须明确 AI 建议边界。",
        evidence_expectation: "必须引用补货建议证据、缺失数据、人工复核要求或不可回答清单。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "sku_count",
        name: "SKU 数",
        definition: "纳入当前渠道库存分析范围的 SKU 数量。",
        preferred_columns: ["sku_id", "product_id", "sku_count", "SKU", "商品编码", "货号"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["sku_id", "product_id", "SKU", "商品编码", "货号"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["sku_count", "SKU数", "商品数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "优先使用 SKU 或商品编码去重计数；若来源为汇总 SKU 数，应保留渠道、仓门店和统计时点。"
      },
      {
        metric_id: "available_inventory_qty",
        name: "可售库存",
        definition: "指定时点可用于销售或履约的库存数量。",
        preferred_columns: ["available_inventory_qty", "available_stock", "stock_qty", "on_hand_qty", "可售库存", "库存数量"],
        aggregation: "sum",
        field_roles: [
          {
            role: "detail_value",
            preferred_columns: ["available_inventory_qty", "available_stock", "stock_qty", "on_hand_qty", "可售库存", "库存数量"],
            aggregation: "sum"
          },
          {
            role: "summary_value",
            preferred_columns: ["total_available_inventory", "total_stock_qty", "总可售库存", "总库存"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要库存快照时点、SKU、渠道和仓门店来源；不能把在途、锁定或残次库存默认算作可售库存。"
      },
      {
        metric_id: "sell_through_rate",
        name: "库存消化率",
        definition: "指定期间销售数量占期初可售或可供销售库存数量的比例。",
        preferred_columns: ["sell_through_rate", "sellthrough_rate", "库存消化率", "售罄率"],
        aggregation: "ratio",
        numerator_columns: ["sold_qty", "sales_qty", "销售数量", "已售数量"],
        denominator_columns: ["available_inventory_qty", "opening_stock_qty", "available_stock", "可售库存", "期初库存"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["sell_through_rate", "sellthrough_rate", "库存消化率", "售罄率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["sold_qty", "sales_qty", "销售数量", "已售数量"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["available_inventory_qty", "opening_stock_qty", "available_stock", "可售库存", "期初库存"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "必须同时说明销售数量和可供销售库存来源；不能只用销售数量代表库存消化。"
      },
      {
        metric_id: "stockout_rate",
        name: "缺货率",
        definition: "缺货 SKU、门店或订单行占纳入分析范围对象的比例。",
        preferred_columns: ["stockout_rate", "out_of_stock_rate", "缺货率", "断货率"],
        aggregation: "ratio",
        numerator_columns: ["stockout_flag", "stockout_sku_count", "out_of_stock_count", "缺货标记", "缺货SKU数"],
        denominator_columns: ["sku_id", "sku_count", "store_sku_count", "SKU", "商品编码"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["stockout_rate", "out_of_stock_rate", "缺货率", "断货率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["stockout_flag", "stockout_sku_count", "out_of_stock_count", "缺货标记", "缺货SKU数"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["sku_id", "sku_count", "store_sku_count", "SKU", "商品编码"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "必须说明缺货判断口径、对象范围和统计时点；不能把单个渠道缺货自动解释为全网缺货。"
      }
    ],
    evidence_rules: [
      "库存、缺货和积压判断必须能追到 SKU、渠道、仓门店、库存快照和销售来源。",
      "补货、调拨、清仓和采购建议不能只来自模型推断，必须绑定库存、销售、预测或补货证据。",
      "缺少促销计划、预测、在途库存、渠道政策或安全库存口径时必须生成 data request。"
    ],
    view_rules: [
      {
        view_id: "channel_inventory_overview",
        title: "渠道库存总览",
        intent: "第一屏展示 SKU 数、可售库存、库存消化率、缺货率和主要证据缺口。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "sku_channel_mismatch",
        title: "SKU 与渠道错配",
        intent: "按渠道、仓库、门店、SKU 或商品层级拆解缺货和积压。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "replenishment_action_register",
        title: "补货调拨清单",
        intent: "展示需要人工确认的补货、调拨、清仓和补数请求。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: [
      "补货、调拨、清仓、采购承诺和渠道配额调整必须人工审阅。",
      "Reader/Studio 不能把 AI 生成建议解释为自动执行指令、采购订单、渠道处罚或客户承诺。",
      "涉及经销商政策、价格策略或渠道利益分配的结论必须保留证据边界和人工确认状态。"
    ],
    default_sources: [
      { name: "channel-inventory-snapshot.csv", path: "sources/channel-inventory-snapshot.csv", type: "csv" },
      { name: "sku-sales-orders.xlsx", path: "sources/sku-sales-orders.xlsx", type: "xlsx" },
      { name: "replenishment-plan.xlsx", path: "sources/replenishment-plan.xlsx", type: "xlsx" },
      { name: "promotion-calendar.csv", path: "sources/promotion-calendar.csv", type: "csv" }
    ]
  },
  {
    domain_id: "healthcare_quality_control",
    namespace: "org.openinsight.domain.healthcare_quality_control",
    version: "0.1.0",
    title: "医疗质控分析",
    market_focus: "中国医院质量管理与医保合规",
    audience: "医院质控办、医务科、科室主任、运营管理和医保合规团队",
    default_title: "医疗质控洞察",
    default_package_id: "org.openinsight.drafts.healthcare_quality_control",
    description: "用于住院、门诊和病案质量数据的质控分析，重点追踪平均住院日、再入院、临床路径、病案缺陷和数据缺口，强调隐私保护、专业复核和非诊疗建议边界。",
    template_sections: ["质控概览", "科室与病种结构", "平均住院日", "再入院与安全事件", "临床路径执行", "病案质量与医保合规", "质控问答与补数请求"],
    required_questions: [
      {
        question_id: "healthcare_quality_outlier",
        question: "哪些科室、病种、DRG/DIP 或临床路径存在质控指标异常？",
        why_required: "医疗质控必须定位到可复核的管理维度，避免只看医院总体均值。",
        evidence_expectation: "至少绑定出院人次、平均住院日、病种/科室或 DRG/DIP 维度 evidence。"
      },
      {
        question_id: "healthcare_readmission_safety",
        question: "非计划再入院、并发症、安全事件或病案缺陷是否集中在特定科室或病种？",
        why_required: "质量与安全指标需要识别集中风险，并交由专业人员复核。",
        evidence_expectation: "需要再入院标记、并发症或安全事件、病案质控缺陷和对应科室/病种来源；缺少时生成 data request。"
      },
      {
        question_id: "healthcare_data_compliance_gap",
        question: "哪些质控判断缺少病案首页、医嘱、手术记录、随访或医保结算证据？",
        why_required: "医疗质控结论必须明确证据边界，不能用模型推断替代病历和合规材料。",
        evidence_expectation: "必须引用缺失材料、证据位置、脱敏状态或不可回答清单。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "discharge_patient_count",
        name: "出院人次",
        definition: "指定期间内纳入质控范围的出院病例或患者人次。",
        preferred_columns: ["case_id", "patient_id", "discharge_patient_count", "出院人次", "病案号"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["case_id", "patient_id", "encounter_id", "病案号", "住院号"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["discharge_patient_count", "case_count", "出院人次", "病例数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "优先使用脱敏病例或就诊 ID 去重计数；若来源为汇总人次，应保留统计期间和纳入范围。"
      },
      {
        metric_id: "average_length_of_stay",
        name: "平均住院日",
        definition: "住院天数合计除以出院人次。",
        preferred_columns: ["avg_los", "average_length_of_stay", "平均住院日"],
        aggregation: "ratio",
        numerator_columns: ["length_of_stay_days", "stay_days", "住院天数", "总住院日"],
        denominator_columns: ["discharge_patient_count", "case_id", "patient_id", "出院人次", "病例数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["avg_los", "average_length_of_stay", "平均住院日"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["length_of_stay_days", "stay_days", "住院天数", "总住院日"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["discharge_patient_count", "case_id", "patient_id", "出院人次", "病例数"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "必须同时说明住院天数和出院人次来源；不能只用单列住院天数代表平均住院日。"
      },
      {
        metric_id: "readmission_rate_30d",
        name: "30日再入院率",
        definition: "出院后 30 日内非计划再入院病例占出院病例的比例。",
        preferred_columns: ["readmission_rate_30d", "30日再入院率", "再入院率"],
        aggregation: "ratio",
        numerator_columns: ["readmission_30d_flag", "readmission_count", "再入院标记", "再入院人次"],
        denominator_columns: ["discharge_patient_count", "case_id", "patient_id", "出院人次", "病例数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["readmission_rate_30d", "30日再入院率", "再入院率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["readmission_30d_flag", "readmission_count", "再入院标记", "再入院人次"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["discharge_patient_count", "case_id", "patient_id", "出院人次", "病例数"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "必须说明再入院窗口、排除规则和出院病例范围；不能只用单个再入院标记字段直接生成已确认结论。"
      },
      {
        metric_id: "medical_record_defect_count",
        name: "病案质控缺陷数",
        definition: "病案首页、诊疗记录、编码或医保结算材料中仍未关闭的质控缺陷数量。",
        preferred_columns: ["defect_count", "medical_record_defect_count", "病案缺陷数", "质控缺陷"],
        aggregation: "sum",
        field_roles: [
          {
            role: "summary_value",
            preferred_columns: ["defect_count", "medical_record_defect_count", "病案缺陷数", "质控缺陷"],
            aggregation: "sum"
          },
          {
            role: "entity_id",
            preferred_columns: ["defect_id", "record_issue_id", "缺陷编号", "问题编号"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "需要缺陷清单、责任科室、整改状态和病案来源；只有文字描述而无状态时应生成数据缺口。"
      }
    ],
    evidence_rules: [
      "平均住院日、再入院率和病案缺陷判断必须能追到脱敏病例、病案首页、随访或医保结算来源。",
      "医疗安全、诊疗质量、科室责任和医保合规相关结论必须人工复核，不能只来自模型推断。",
      "缺少病案首页、手术记录、医嘱、随访、诊断编码或医保结算字段时必须生成 data request。"
    ],
    view_rules: [
      {
        view_id: "healthcare_quality_overview",
        title: "质控总览",
        intent: "第一屏展示出院人次、平均住院日、再入院率、病案缺陷和主要证据缺口。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "department_disease_breakdown",
        title: "科室与病种拆解",
        intent: "按科室、病种、DRG/DIP 或临床路径拆解质控异常和补数需求。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "medical_record_gap_register",
        title: "病案与合规缺口",
        intent: "展示缺失病案材料、编码问题、随访缺口和待人工复核事项。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: [
      "医疗安全、诊疗质量、科室责任和医保合规相关结论必须由专业人员人工复核。",
      "Reader/Studio 不能把输出解释为诊断、治疗建议、医疗事故认定、行政处罚依据或医保拒付结论。",
      "所有样例和导出结果应优先使用脱敏数据，不能默认展示患者姓名、身份证号、手机号等直接身份信息。"
    ],
    default_sources: [
      { name: "inpatient-discharges.csv", path: "sources/inpatient-discharges.csv", type: "csv" },
      { name: "drg-dip-settlement.xlsx", path: "sources/drg-dip-settlement.xlsx", type: "xlsx" },
      { name: "medical-record-quality.xlsx", path: "sources/medical-record-quality.xlsx", type: "xlsx" },
      { name: "readmission-followup.csv", path: "sources/readmission-followup.csv", type: "csv" }
    ]
  },
  {
    domain_id: "education_quality_analysis",
    namespace: "org.openinsight.domain.education_quality_analysis",
    version: "0.1.0",
    title: "教育质量分析",
    market_focus: "中国学校教学质量与学生发展支持",
    audience: "校长、教务处、年级组长、教师发展中心和教育集团运营团队",
    default_title: "教育质量洞察",
    default_package_id: "org.openinsight.drafts.education_quality_analysis",
    description: "用于课程、班级、年级和学习过程数据的教学质量分析，重点追踪成绩达成、作业完成、出勤参与、问卷反馈和补数请求，强调未成年人隐私保护和教育专业人工复核。",
    template_sections: ["教学质量概览", "班级与课程结构", "成绩与达成度", "作业与学习过程", "出勤与课堂参与", "问卷反馈与课程改进", "学生支持与补数请求"],
    required_questions: [
      {
        question_id: "education_learning_outlier",
        question: "哪些班级、课程、知识点或学生群体的学习结果存在异常，需要进一步复核？",
        why_required: "教学质量分析必须定位到可改进的教学单元，不能只看总体平均分。",
        evidence_expectation: "至少绑定课程、班级、考试或知识点维度的成绩与达成度 evidence。"
      },
      {
        question_id: "education_process_driver",
        question: "成绩变化是否与作业完成、出勤、课堂参与或学习过程数据有关？",
        why_required: "教育改进需要连接结果和过程，避免把成绩差异直接归因给学生个人。",
        evidence_expectation: "需要作业、出勤、课堂参与或学习行为来源；缺少时生成 data request。"
      },
      {
        question_id: "education_privacy_support_boundary",
        question: "哪些结论只能作为教学支持线索，不能用于纪律处分、招生分班或单个学生标签化？",
        why_required: "教育场景涉及未成年人和高影响决策，必须明确使用边界。",
        evidence_expectation: "必须引用隐私脱敏状态、人工复核要求、不可回答清单或补数请求。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "student_count",
        name: "学生人数",
        definition: "指定课程、班级或年级范围内纳入分析的学生数量。",
        preferred_columns: ["student_id", "student_count", "学生ID", "学生人数", "学号"],
        aggregation: "count",
        field_roles: [
          {
            role: "entity_id",
            preferred_columns: ["student_id", "learner_id", "匿名学生ID", "学号"],
            aggregation: "count"
          },
          {
            role: "summary_value",
            preferred_columns: ["student_count", "学生人数", "人数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "优先使用脱敏学生 ID 去重计数；若来源为汇总人数，应保留班级、课程和统计期间。"
      },
      {
        metric_id: "average_score",
        name: "平均成绩",
        definition: "成绩总分或学生得分合计除以参与测评人数或题目数量后的平均成绩。",
        preferred_columns: ["average_score", "avg_score", "平均分", "平均成绩"],
        aggregation: "ratio",
        numerator_columns: ["score", "exam_score", "score_total", "total_score", "得分", "考试成绩", "总分"],
        denominator_columns: ["student_id", "learner_id", "student_count", "exam_count", "submission_count", "匿名学生ID", "学生人数", "测评人数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["average_score", "avg_score", "平均分", "平均成绩"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["score", "exam_score", "score_total", "total_score", "得分", "考试成绩", "总分"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["student_id", "learner_id", "student_count", "exam_count", "submission_count", "匿名学生ID", "学生人数", "测评人数"],
            aggregation: "count"
          }
        ],
        evidence_requirement: "必须同时说明得分来源、参与人数、测评范围和时间；不能只用单个学生成绩代表班级平均。"
      },
      {
        metric_id: "assignment_completion_rate",
        name: "作业完成率",
        definition: "按时完成或有效提交作业次数占应提交作业次数的比例。",
        preferred_columns: ["assignment_completion_rate", "completion_rate", "作业完成率"],
        aggregation: "ratio",
        numerator_columns: ["completed_assignments", "assignment_completed", "submitted_assignments", "on_time_submissions", "已完成作业", "已提交作业"],
        denominator_columns: ["assigned_assignments", "assignment_assigned", "assignment_count", "应交作业", "作业次数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["assignment_completion_rate", "completion_rate", "作业完成率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["completed_assignments", "assignment_completed", "submitted_assignments", "on_time_submissions", "已完成作业", "已提交作业"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["assigned_assignments", "assignment_assigned", "assignment_count", "应交作业", "作业次数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要应交、已交、迟交或缺交记录；缺少过程数据时不能把成绩变化直接归因于作业完成情况。"
      },
      {
        metric_id: "attendance_rate",
        name: "出勤率",
        definition: "实际出勤或有效参与课次占应出勤课次的比例。",
        preferred_columns: ["attendance_rate", "attendance", "出勤率", "到课率"],
        aggregation: "ratio",
        numerator_columns: ["attended_sessions", "present_count", "实际出勤", "到课次数"],
        denominator_columns: ["scheduled_sessions", "class_sessions", "应出勤", "课次数"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["attendance_rate", "attendance", "出勤率", "到课率"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["attended_sessions", "present_count", "实际出勤", "到课次数"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["scheduled_sessions", "class_sessions", "应出勤", "课次数"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要课程表、考勤记录和统计期间；不能把低出勤率自动解释为个人态度问题。"
      }
    ],
    evidence_rules: [
      "成绩、作业、出勤和问卷判断必须能追到脱敏学生、班级、课程、测评或学习过程来源。",
      "涉及单个学生支持、风险预警、分班、升学、纪律处分或教师绩效的结论必须人工复核。",
      "缺少知识点映射、作业记录、考勤、课堂参与或问卷样本时必须生成 data request。"
    ],
    view_rules: [
      {
        view_id: "education_quality_overview",
        title: "教学质量总览",
        intent: "第一屏展示学生人数、平均成绩、作业完成率、出勤率和主要证据缺口。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "class_course_breakdown",
        title: "班级与课程拆解",
        intent: "按班级、课程、年级、知识点或教师维度拆解学习结果和过程指标。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "student_support_gap_register",
        title: "学生支持与补数清单",
        intent: "展示需要补充学习过程、问卷、家校沟通或人工复核的教学支持问题。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: [
      "涉及未成年人、单个学生支持、风险预警、分班、升学、纪律处分或教师绩效的结论必须人工复核。",
      "Reader/Studio 不能把输出解释为招生录取、分班、处分、教师考核或单个学生标签化依据。",
      "所有样例和导出结果应优先使用脱敏学生 ID，不能默认展示姓名、身份证号、手机号、家庭住址等直接身份信息。"
    ],
    default_sources: [
      { name: "exam-scores.csv", path: "sources/exam-scores.csv", type: "csv" },
      { name: "assignment-submissions.xlsx", path: "sources/assignment-submissions.xlsx", type: "xlsx" },
      { name: "attendance-records.csv", path: "sources/attendance-records.csv", type: "csv" },
      { name: "survey-feedback.xlsx", path: "sources/survey-feedback.xlsx", type: "xlsx" }
    ]
  },
  {
    domain_id: "bond_analysis",
    namespace: "org.openinsight.domain.bond_analysis",
    version: "0.1.0",
    title: "债券发行分析",
    market_focus: "中国债券与企业融资市场",
    audience: "投资人、承销团队、风控和投委会",
    default_title: "债券发行洞察",
    default_package_id: "org.openinsight.drafts.bond_offering",
    description: "用于债券说明书、财务报表和契约材料的结构化分析，强调偿债来源、债务结构、风险因素和人工确认。",
    template_sections: ["发行人概况", "募集资金用途", "债务结构", "偿债来源", "财务约束", "风险因素", "投资人问答"],
    required_questions: [
      {
        question_id: "bond_debt_service_source",
        question: "发行人主要偿债来源是什么，是否与现金流和财务数据相互印证？",
        why_required: "偿债来源是债券分析的核心判断。",
        evidence_expectation: "需要绑定说明书章节、财务表格和现金流相关 evidence。"
      },
      {
        question_id: "bond_covenant_risk",
        question: "是否存在财务约束、担保、交叉违约或重大限制性条款？",
        why_required: "契约条款直接影响投资人风险。",
        evidence_expectation: "必须能追到条款来源或生成缺失材料请求。"
      },
      {
        question_id: "bond_not_investment_advice",
        question: "哪些结论只能作为材料梳理，不能构成投资建议？",
        why_required: "金融场景必须明确风险披露和使用边界。",
        evidence_expectation: "高风险判断必须标记 not_advice 或 requires_expert_review。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "debt_balance",
        name: "有息债务余额",
        definition: "发行人当前有息债务规模。",
        preferred_columns: ["debt", "interest_bearing_debt", "有息债务", "债务余额"],
        aggregation: "latest_value",
        field_roles: [
          {
            role: "summary_value",
            preferred_columns: ["debt", "interest_bearing_debt", "有息债务", "债务余额"],
            aggregation: "latest_value"
          },
          {
            role: "detail_value",
            preferred_columns: ["debt_amount", "debt_detail_amount", "loan_balance", "借款余额", "债务明细金额"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要报告期、债务类型或明细来源；若来源为多笔债务明细，发布前必须人工确认是否应改为同一报告期汇总。"
      },
      {
        metric_id: "cash_flow",
        name: "经营现金流",
        definition: "发行人经营活动产生的现金流量。",
        preferred_columns: ["cash_flow", "operating_cash_flow", "经营现金流"],
        aggregation: "latest_value",
        field_roles: [
          {
            role: "summary_value",
            preferred_columns: ["cash_flow", "operating_cash_flow", "经营现金流"],
            aggregation: "latest_value"
          }
        ],
        evidence_requirement: "需要明确报告期和财务报表来源，优先引用最新报告期口径。"
      },
      {
        metric_id: "coverage_ratio",
        name: "偿债覆盖倍数",
        definition: "现金流、EBITDA 或可用资金对债务服务的覆盖能力。",
        preferred_columns: ["coverage_ratio", "interest_coverage_ratio", "偿债覆盖", "利息覆盖倍数"],
        aggregation: "ratio",
        numerator_columns: ["cash_flow", "operating_cash_flow", "ebitda", "available_funds", "经营现金流", "可用资金"],
        denominator_columns: ["interest", "principal", "debt_service", "利息", "本金", "债务服务"],
        field_roles: [
          {
            role: "ratio_value",
            preferred_columns: ["coverage_ratio", "interest_coverage_ratio", "偿债覆盖", "利息覆盖倍数"],
            aggregation: "latest_value"
          },
          {
            role: "numerator",
            preferred_columns: ["cash_flow", "operating_cash_flow", "ebitda", "available_funds", "经营现金流", "可用资金"],
            aggregation: "sum"
          },
          {
            role: "denominator",
            preferred_columns: ["interest", "principal", "debt_service", "利息", "本金", "债务服务"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "必须同时说明分子和分母来源；不能仅用 EBITDA、现金流或利息单列求和来代表覆盖倍数。"
      }
    ],
    evidence_rules: [
      "所有偿债能力判断必须同时追到财务数据和来源材料。",
      "风险披露不能只来自模型推断，必须绑定说明书、契约或数据表 evidence。",
      "缺少担保、评级、现金流或债务明细时必须生成 data request。"
    ],
    view_rules: [
      {
        view_id: "bond_risk_overview",
        title: "债券风险总览",
        intent: "展示偿债来源、债务结构、关键条款、风险披露和不可回答问题。",
        required_trace: ["view_block_id", "claim_id", "metric_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "bond_evidence_map",
        title: "说明书证据地图",
        intent: "把结论和说明书章节、财务表格、契约材料绑定。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: [
      "任何涉及投资判断的结论必须标记 not_advice。",
      "偿债能力、违约风险和担保有效性必须 requires_expert_review。",
      "不能把 AI 生成内容伪装成人工尽调结论。"
    ],
    default_sources: [
      { name: "bond-prospectus.pdf", path: "sources/bond-prospectus.pdf", type: "pdf" },
      { name: "issuer-financials.xlsx", path: "sources/issuer-financials.xlsx", type: "xlsx" },
      { name: "covenants.docx", path: "sources/covenants.docx", type: "docx" }
    ]
  },
  {
    domain_id: "contract_review",
    namespace: "org.openinsight.domain.contract_review",
    version: "0.1.0",
    title: "合同审阅",
    market_focus: "中国企业法务与合同管理",
    audience: "法务、业务负责人、合规团队",
    default_title: "合同审阅洞察",
    default_package_id: "org.openinsight.drafts.contract_review",
    description: "用于合同条款定位、义务拆解、风险提示和缺失材料请求，强调条款证据和非法律意见边界。",
    template_sections: ["合同概况", "主体与生效", "付款与交付", "违约责任", "终止条款", "争议解决", "缺失材料与问答"],
    required_questions: [
      {
        question_id: "contract_obligation_map",
        question: "合同双方的核心义务、期限和触发条件分别是什么？",
        why_required: "合同审阅首先需要明确义务地图。",
        evidence_expectation: "必须绑定具体条款、页码或段落 evidence。"
      },
      {
        question_id: "contract_risk_terms",
        question: "付款、交付、违约、终止和争议解决条款中有哪些高风险点？",
        why_required: "这些条款直接影响履约风险。",
        evidence_expectation: "风险判断必须能追到条款位置，并标记需人工复核。"
      },
      {
        question_id: "contract_missing_materials",
        question: "是否缺少附件、补充协议、授权文件或历史履约材料？",
        why_required: "缺失材料会限制审阅结论可靠性。",
        evidence_expectation: "缺失时生成结构化 data request。"
      }
    ],
    metric_blueprints: [
      {
        metric_id: "contract_amount",
        name: "合同金额",
        definition: "合同约定的金额、付款总额或费用上限。",
        preferred_columns: ["amount", "fee", "price", "合同金额", "付款"],
        aggregation: "sum",
        field_roles: [
          {
            role: "summary_value",
            preferred_columns: ["contract_total_amount", "total_amount", "合同总额", "合同金额"],
            aggregation: "latest_value"
          },
          {
            role: "detail_value",
            preferred_columns: ["amount", "fee", "price", "付款", "阶段款"],
            aggregation: "sum"
          }
        ],
        evidence_requirement: "需要绑定付款条款、金额字段和币种；多笔付款应说明是否为总价或阶段款。"
      },
      {
        metric_id: "term_days",
        name: "履约期限",
        definition: "从生效到交付、验收或终止的关键天数。",
        preferred_columns: ["effective_date", "delivery_date", "term", "期限"],
        aggregation: "latest_value",
        field_roles: [
          {
            role: "summary_value",
            preferred_columns: ["term", "期限", "term_days", "履约期限"],
            aggregation: "latest_value"
          }
        ],
        evidence_requirement: "需要条款位置、起算条件和截止条件；不能只展示孤立日期。"
      }
    ],
    evidence_rules: [
      "每个风险点必须绑定条款、页码、段落或 OCR 来源。",
      "缺少附件或授权材料时必须生成 data request。",
      "法律风险判断必须保留 not_advice 或 requires_expert_review 状态。"
    ],
    view_rules: [
      {
        view_id: "contract_clause_map",
        title: "条款地图",
        intent: "按主体、义务、付款、违约、终止和争议解决展示条款证据。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      },
      {
        view_id: "contract_risk_register",
        title: "风险清单",
        intent: "展示高风险条款、缺失材料和人工复核状态。",
        required_trace: ["view_block_id", "claim_id", "evidence_id", "source_ref"]
      }
    ],
    review_rules: ["合同风险结论必须人工复核。", "Reader/Studio 不能把输出解释为正式法律意见。"],
    default_sources: [
      { name: "contract.pdf", path: "sources/contract.pdf", type: "pdf" },
      { name: "attachments.zip", path: "sources/attachments.zip", type: "zip" },
      { name: "review-notes.docx", path: "sources/review-notes.docx", type: "docx" }
    ]
  }
];

export function getDomainPack(domainId: string): DomainPack | undefined {
  return DOMAIN_PACKS.find((pack) => pack.domain_id === domainId);
}

export function requireDomainPack(domainId: string): DomainPack {
  const pack = getDomainPack(domainId);

  if (!pack) {
    throw new Error(`未知 Domain Pack：${domainId}`);
  }

  return pack;
}

export function getDefaultDomainPack(): DomainPack {
  return requireDomainPack("bond_analysis");
}

export function buildTemplateFromDomainPack(pack: DomainPack): string {
  return pack.template_sections.join("\n");
}

export function summarizeDomainPack(pack: DomainPack): string {
  return `${pack.title} / ${pack.required_questions.length} 个必答问题 / ${pack.metric_blueprints.length} 个指标蓝图`;
}

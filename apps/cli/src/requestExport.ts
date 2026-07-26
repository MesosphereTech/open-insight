import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSIGHT_SPEC_VERSION, pathExists, readJsonFile, readJsonlFile, readManifest } from "@open-insight/core";

const CORE_CAPABILITIES = [
  "core.read",
  "data.catalog",
  "semantic.metrics",
  "views.basic",
  "findings.claims",
  "evidence.basic",
  "qa.prepared",
  "lineage.sources"
];

export interface ExportDataRequestPackageOptions {
  packageRoot: string;
  requestId: string;
  outputDir: string;
  createdAt?: string;
}

export interface ExportDataRequestPackageResult {
  status: "exported";
  output_dir: string;
  parent_package_id: string;
  request_id: string;
  file_count: number;
  copied_context: {
    claims: number;
    evidence: number;
    prepared_questions: number;
    datasets: number;
    metrics: number;
    lineage_sources: number;
  };
}

interface DataRequest {
  request_id: string;
  question: string;
  status: string;
  missing_fields: string[];
  required_grain?: string;
  required_time_range?: string;
  why_needed: string;
  priority?: string;
  affected_findings?: string[];
}

interface Dataset {
  dataset_id: string;
  path?: string;
  [key: string]: unknown;
}

interface DataCatalog {
  datasets: Dataset[];
}

interface Metric {
  metric_id: string;
  dataset_id?: string;
  [key: string]: unknown;
}

interface MetricsFile {
  metrics: Metric[];
}

interface Claim {
  claim_id: string;
  summary: string;
  status: string;
  metric_ids?: string[];
  evidence_ids: string[];
  [key: string]: unknown;
}

interface Evidence {
  evidence_id: string;
  source_refs?: Array<{
    dataset_id: string;
    path?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface PreparedQuestion {
  question_id: string;
  claim_ids?: string[];
  evidence_ids?: string[];
  data_request_ids?: string[];
  active_data_request_ids?: string[];
  [key: string]: unknown;
}

interface LineageSource {
  source_id: string;
  path?: string;
  [key: string]: unknown;
}

interface LineageSourcesFile {
  sources: LineageSource[];
}

export async function exportDataRequestPackage(options: ExportDataRequestPackageOptions): Promise<ExportDataRequestPackageResult> {
  const packageRoot = path.resolve(options.packageRoot);
  const outputDir = path.resolve(options.outputDir);
  const manifest = await readManifest(packageRoot);
  const requestPath = path.join(packageRoot, "answerability/data_requests.jsonl");

  if (!(await pathExists(requestPath))) {
    throw new Error(`文件包 '${packageRoot}' 缺少 answerability/data_requests.jsonl。`);
  }

  const requests = await readJsonlFile<DataRequest>(requestPath);
  const request = requests.find((item) => item.request_id === options.requestId);

  if (!request) {
    throw new Error(`在文件包 '${packageRoot}' 中找不到补数请求 '${options.requestId}'。`);
  }

  const catalog = await readJsonFile<DataCatalog>(path.join(packageRoot, "data/catalog.json"));
  const metricsFile = await readJsonFile<MetricsFile>(path.join(packageRoot, "semantic/metrics.json"));
  const claims = await readJsonlFile<Claim>(path.join(packageRoot, "findings/claims.jsonl"));
  const evidence = await readJsonlFile<Evidence>(path.join(packageRoot, "evidence/evidence.jsonl"));
  const preparedQuestions = await readJsonlFile<PreparedQuestion>(path.join(packageRoot, "qa/prepared_questions.jsonl"));
  const lineage = await readJsonFile<LineageSourcesFile>(path.join(packageRoot, "lineage/sources.json"));

  const affectedClaimIds = new Set(request.affected_findings ?? []);
  const selectedClaims = claims.filter((claim) => affectedClaimIds.has(claim.claim_id));
  const evidenceIds = new Set(selectedClaims.flatMap((claim) => claim.evidence_ids));
  const selectedEvidence = evidence.filter((record) => evidenceIds.has(record.evidence_id));
  const metricIds = new Set(selectedClaims.flatMap((claim) => claim.metric_ids ?? []));
  const datasetIds = new Set<string>();
  const sourcePaths = new Set<string>();

  selectedEvidence.forEach((record) => {
    record.source_refs?.forEach((sourceRef) => {
      datasetIds.add(sourceRef.dataset_id);

      if (sourceRef.path) {
        sourcePaths.add(sourceRef.path);
      }
    });
  });

  const selectedDatasets = catalog.datasets.filter((dataset) => {
    if (!datasetIds.has(dataset.dataset_id)) {
      return false;
    }

    if (dataset.path) {
      sourcePaths.add(dataset.path);
    }

    return true;
  });

  const selectedMetrics = metricsFile.metrics.filter((metric) => metricIds.has(metric.metric_id));
  const selectedPreparedQuestions = preparedQuestions.filter((question) => {
    const linkedClaimIds = question.claim_ids ?? [];
    const linkedEvidenceIds = question.evidence_ids ?? [];
    const linkedRequestIds = [...(question.data_request_ids ?? []), ...(question.active_data_request_ids ?? [])];

    return (
      linkedClaimIds.some((claimId) => affectedClaimIds.has(claimId)) ||
      linkedEvidenceIds.some((evidenceId) => evidenceIds.has(evidenceId)) ||
      linkedRequestIds.includes(request.request_id)
    );
  });
  const selectedLineageSources = lineage.sources.filter((source) => source.path !== undefined && sourcePaths.has(source.path));
  const firstClaim = selectedClaims[0];
  const safeRequestId = sanitizeId(request.request_id) || "request";
  const homepageBlock: Record<string, unknown> = {
    block_id: `request_${safeRequestId}`,
    type: "answerability_card",
    title: request.question
  };

  if (firstClaim) {
    homepageBlock["claim_id"] = firstClaim.claim_id;
  }

  if (selectedEvidence.length > 0) {
    homepageBlock["evidence_ids"] = selectedEvidence.map((record) => record.evidence_id);
  }

  const files: Record<string, string> = {
    "manifest.json": toJson({
      spec_version: manifest.spec_version || INSIGHT_SPEC_VERSION,
      package_id: `${manifest.package_id}.request.${safeRequestId}`,
      package_type: "insight",
      title: `${manifest.title} - 补数请求 ${request.request_id}`,
      description: `从 ${manifest.package_id} 生成的最小补数请求子包。`,
      created_at: options.createdAt ?? new Date().toISOString(),
      required_capabilities: CORE_CAPABILITIES,
      optional_capabilities: ["answerability"],
      fallbacks: {
        default_view: "views/homepage.json"
      },
      request_context: {
        parent_package_id: manifest.package_id,
        parent_title: manifest.title,
        source_request_id: request.request_id,
        generated_from: "answerability/data_requests.jsonl",
        affected_findings: request.affected_findings ?? []
      }
    }),
    "data/catalog.json": toJson({ datasets: selectedDatasets }),
    "semantic/metrics.json": toJson({ metrics: selectedMetrics }),
    "views/homepage.json": toJson({
      view_id: "request_homepage",
      title: `补数请求：${request.question}`,
      audience: "data_provider",
      blocks: [homepageBlock]
    }),
    "findings/claims.jsonl": toJsonl(selectedClaims),
    "evidence/evidence.jsonl": toJsonl(selectedEvidence),
    "qa/prepared_questions.jsonl": toJsonl(selectedPreparedQuestions),
    "lineage/sources.json": toJson({ sources: selectedLineageSources }),
    "answerability/data_requests.jsonl": toJsonl([request])
  };

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const outputPath = path.join(outputDir, relativePath);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content, "utf8");
    })
  );

  return {
    status: "exported",
    output_dir: outputDir,
    parent_package_id: manifest.package_id,
    request_id: request.request_id,
    file_count: Object.keys(files).length,
    copied_context: {
      claims: selectedClaims.length,
      evidence: selectedEvidence.length,
      prepared_questions: selectedPreparedQuestions.length,
      datasets: selectedDatasets.length,
      metrics: selectedMetrics.length,
      lineage_sources: selectedLineageSources.length
    }
  };
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toJsonl(values: unknown[]): string {
  if (values.length === 0) {
    return "";
  }

  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

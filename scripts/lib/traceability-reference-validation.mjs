export const TRACEABILITY_FIELDS = ["source_refs", "lineage_refs", "parse_diagnostic_ids", "source_map_refs"];

const REQUIRED_TRACEABILITY_FIELDS = ["source_refs", "lineage_refs", "parse_diagnostic_ids"];

export function emptyAllowedReferences() {
  return Object.fromEntries(TRACEABILITY_FIELDS.map((field) => [field, new Set()]));
}

export function toSortedReferenceArrays(references) {
  return Object.fromEntries(
    TRACEABILITY_FIELDS.map((field) => [field, Array.from(references[field] ?? []).sort()])
  );
}

export function isReferenceId(value) {
  const text = String(value ?? "").trim();
  if (!text || ["none", "null", "undefined", "missing", "unknown", "n/a"].includes(text.toLowerCase())) return false;
  return /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(text);
}

export function addReference(references, field, value) {
  const text = String(value ?? "").trim();
  if (isReferenceId(text)) references[field]?.add(text);
}

function referenceValuesFrom(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  const keys = ["source_id", "dataset_id", "object_id", "diagnostic_id", "id", "target_id"];
  return keys.map((key) => value[key]).filter((item) => typeof item === "string");
}

export function collectAllowedReferencesFromObject(value, references = emptyAllowedReferences()) {
  if (Array.isArray(value)) {
    for (const item of value) collectAllowedReferencesFromObject(item, references);
    return references;
  }
  if (!value || typeof value !== "object") return references;

  for (const [key, item] of Object.entries(value)) {
    if (TRACEABILITY_FIELDS.includes(key)) {
      const refs = Array.isArray(item) ? item : [item];
      for (const ref of refs.flatMap(referenceValuesFrom)) addReference(references, key, ref);
    } else if (key === "source_id" || key === "dataset_id") {
      addReference(references, "source_refs", item);
      addReference(references, "source_map_refs", item);
    } else if (key === "diagnostic_id") {
      addReference(references, "parse_diagnostic_ids", item);
    }
    collectAllowedReferencesFromObject(item, references);
  }
  return references;
}

export function collectCitedReferencesFromObject(value, references = emptyAllowedReferences()) {
  if (Array.isArray(value)) {
    for (const item of value) collectCitedReferencesFromObject(item, references);
    return references;
  }
  if (!value || typeof value !== "object") return references;

  for (const [key, item] of Object.entries(value)) {
    if (TRACEABILITY_FIELDS.includes(key)) {
      const refs = Array.isArray(item) ? item : [item];
      for (const ref of refs.flatMap(referenceValuesFrom)) addReference(references, key, ref);
    }
    collectCitedReferencesFromObject(item, references);
  }
  return references;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractReferenceFieldValues(text, field) {
  const values = new Set();
  const regex = new RegExp("`?" + escapeRegExp(field) + "`?\\s*[:：=]\\s*([^\\r\\n]+)", "gi");
  let match;
  while ((match = regex.exec(String(text ?? "")))) {
    let segment = match[1].trim();
    const bracketMatch = segment.match(/^\[([^\]]*)\]/);
    if (bracketMatch) segment = bracketMatch[1];
    const backtickMatch = segment.match(/^`([^`]*)`/);
    if (backtickMatch) segment = backtickMatch[1];
    for (const token of segment.replace(/["'`{}[\]()]/g, " ").split(/[\s,，、；;]+/)) {
      const normalized = token.trim();
      if (isReferenceId(normalized) && !TRACEABILITY_FIELDS.includes(normalized)) values.add(normalized);
    }
  }
  return Array.from(values).sort();
}

export function collectAllowedReferencesFromText(text, references = emptyAllowedReferences()) {
  for (const field of TRACEABILITY_FIELDS) {
    for (const value of extractReferenceFieldValues(text, field)) addReference(references, field, value);
  }
  return references;
}

export function buildAllowedReferences(values) {
  const references = emptyAllowedReferences();
  for (const value of Array.isArray(values) ? values : [values]) {
    if (typeof value === "string") collectAllowedReferencesFromText(value, references);
    else collectAllowedReferencesFromObject(value, references);
  }
  if ((references.source_map_refs?.size ?? 0) === 0) {
    for (const sourceRef of references.source_refs ?? []) addReference(references, "source_map_refs", sourceRef);
  }
  return toSortedReferenceArrays(references);
}

function validateReferenceArrays(citedRefs, allowedReferences, options = {}) {
  const requiredFields = options.requiredFields ?? REQUIRED_TRACEABILITY_FIELDS;
  const unknown_refs = Object.fromEntries(
    TRACEABILITY_FIELDS.map((field) => {
      const allowed = new Set(allowedReferences[field] ?? []);
      return [field, (citedRefs[field] ?? []).filter((value) => !allowed.has(value))];
    })
  );
  const required_reference_categories_present = requiredFields.every(
    (field) =>
      (allowedReferences[field]?.length ?? 0) === 0 ||
      (citedRefs[field] ?? []).some((value) => allowedReferences[field].includes(value))
  );
  const all_cited_refs_allowed = Object.values(unknown_refs).every((items) => items.length === 0);
  const rejected_reason = !all_cited_refs_allowed
    ? "MODEL_OUTPUT_REJECTED: 输出包含上下文允许清单之外的引用 ID。"
    : !required_reference_categories_present
      ? "MODEL_OUTPUT_REJECTED: 输出缺少允许清单中的必要追溯 ID。"
      : null;
  return {
    allowed_references: allowedReferences,
    cited_refs: citedRefs,
    unknown_refs,
    all_cited_refs_allowed,
    required_reference_categories_present,
    rejected_reason
  };
}

export function validateAllowedReferenceUsage(text, allowedReferences, options = {}) {
  const citedRefs = Object.fromEntries(
    TRACEABILITY_FIELDS.map((field) => [field, extractReferenceFieldValues(text, field)])
  );
  return validateReferenceArrays(citedRefs, allowedReferences, options);
}

export function validateReferenceObjectUsage(value, allowedReferences, options = {}) {
  const citedRefs = toSortedReferenceArrays(collectCitedReferencesFromObject(value));
  return validateReferenceArrays(citedRefs, allowedReferences, options);
}

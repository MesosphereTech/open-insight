import { strFromU8, unzipSync } from "fflate";
import type { DraftSource, DraftSourceSampleValue } from "./draft.js";

export interface SourceFileLike {
  name: string;
  size: number;
  type?: string;
  slice(start?: number, end?: number): { text(): Promise<string> };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface SourceBytesInput {
  name: string;
  bytes: Uint8Array;
  size_bytes?: number;
  mime_type?: string;
}

export async function analyzeSourceFile(file: SourceFileLike): Promise<DraftSource> {
  const extension = inferSourceFileType(file.name);
  const baseSource = buildBaseSource({
    name: file.name,
    size_bytes: file.size,
    ...(file.type ? { mime_type: file.type } : {})
  });

  if (extension === "csv" || extension === "tsv") {
    const sample = await file.slice(0, 1_000_000).text();

    return analyzeDelimitedSourceText(sample, extension === "tsv" ? "\t" : ",", baseSource);
  }

  if (extension === "xlsx" || extension === "docx") {
    return analyzeArchiveBackedSource(new Uint8Array(await file.arrayBuffer()), baseSource, extension);
  }

  if (extension === "pdf") {
    const sample = await file.slice(0, 2_000_000).text();

    return analyzePdfSourceText(sample, baseSource);
  }

  return baseSource;
}

export function analyzeSourceBytes(input: SourceBytesInput): DraftSource {
  const extension = inferSourceFileType(input.name);
  const mimeType = input.mime_type ?? inferSourceMimeType(extension);
  const baseSource = buildBaseSource({
    name: input.name,
    size_bytes: input.size_bytes ?? input.bytes.byteLength,
    ...(mimeType ? { mime_type: mimeType } : {})
  });

  if (extension === "csv" || extension === "tsv") {
    const sample = decodeUtf8(input.bytes.slice(0, 1_000_000));

    return analyzeDelimitedSourceText(sample, extension === "tsv" ? "\t" : ",", baseSource);
  }

  if (extension === "xlsx" || extension === "docx") {
    return analyzeArchiveBackedSource(input.bytes, baseSource, extension);
  }

  if (extension === "pdf") {
    const sample = decodeUtf8(input.bytes.slice(0, 2_000_000));

    return analyzePdfSourceText(sample, baseSource);
  }

  return baseSource;
}

export function formatSourceDetails(source: DraftSource): string {
  const details = [
    source.type ?? "未知类型",
    formatBytes(source.size_bytes),
    `${source.columns?.length ?? 0} 列`,
    ...(source.row_count !== undefined ? [`${source.row_count} 行样本`] : []),
    ...formatSourceMetadata(source)
  ];

  return details.join(" / ");
}

export function inferSourceFileType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (!extension || extension === fileName.toLowerCase()) {
    return "unknown";
  }

  if (extension === "xls") {
    return "xlsx";
  }

  return extension;
}

export function inferSourceMimeType(type: string): string | undefined {
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    txt: "text/plain",
    json: "application/json",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip"
  };

  return mimeTypes[type];
}

function buildBaseSource(input: { name: string; size_bytes?: number; mime_type?: string }): DraftSource {
  const type = inferSourceFileType(input.name);

  return {
    name: input.name,
    path: `sources/${input.name}`,
    type,
    ...(input.size_bytes !== undefined ? { size_bytes: input.size_bytes } : {}),
    ...(input.mime_type ? { mime_type: input.mime_type } : {})
  };
}

function analyzeDelimitedSourceText(sample: string, delimiter: "," | "\t", baseSource: DraftSource): DraftSource {
  const rows = sample
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const header = rows[0] ?? "";
  const dataRows = rows.slice(1).map((row) => parseDelimitedLine(row, delimiter));
  const columns = parseDelimitedHeader(header, delimiter).map((name, index) => ({
    name,
    type: inferColumnType(dataRows.map((row) => row[index]))
  }));

  return {
    ...baseSource,
    row_count: Math.max(0, rows.length - 1),
    columns,
    sample_rows: dataRows.slice(0, 50).map((row) =>
      Object.fromEntries(columns.map((column, index) => [column.name, parseCellValue(row[index], column.type)]))
    )
  };
}

function analyzeArchiveBackedSource(bytes: Uint8Array, baseSource: DraftSource, extension: string): DraftSource {
  let archive: Record<string, Uint8Array>;

  try {
    archive = unzipSync(bytes);
  } catch {
    return {
      ...baseSource,
      metadata: { parsing_status: extension === "docx" ? "unreadable_docx" : "unreadable_xlsx" }
    };
  }

  return extension === "docx" ? analyzeDocxArchive(archive, baseSource) : analyzeXlsxArchive(archive, baseSource);
}

function analyzeXlsxArchive(archive: Record<string, Uint8Array>, baseSource: DraftSource): DraftSource {
  const workbookXml = readZipText(archive, "xl/workbook.xml");
  const sharedStrings = parseSharedStrings(readZipText(archive, "xl/sharedStrings.xml") ?? "");
  const sheetNames = parseWorkbookSheetNames(workbookXml ?? "");
  const worksheets = parseXlsxWorksheets(archive, sheetNames, sharedStrings);
  const selectedWorksheet =
    worksheets.find((worksheet) => worksheet.sample_rows.length > 0 && worksheet.columns.some((column) => isNumericColumnType(column.type))) ??
    worksheets.find((worksheet) => worksheet.columns.length > 0) ??
    worksheets[0];

  if (!selectedWorksheet) {
    return {
      ...baseSource,
      metadata: {
        ...(workbookXml ? { sheets: sheetNames.length } : {})
      }
    };
  }

  return {
    ...baseSource,
    row_count: selectedWorksheet.row_count,
    columns: selectedWorksheet.columns,
    sample_rows: selectedWorksheet.sample_rows,
    metadata: {
      sheets: worksheets.length,
      total_rows: worksheets.reduce((total, worksheet) => total + worksheet.row_count, 0),
      ...(sheetNames.length > 0 ? { sheet_names: sheetNames.slice(0, 6).join(", ") } : {}),
      ...(sheetNames[0] ? { first_sheet: sheetNames[0] } : {}),
      ...(selectedWorksheet.name ? { selected_sheet: selectedWorksheet.name } : {})
    }
  };
}

function analyzePdfSourceText(pdfText: string, baseSource: DraftSource): DraftSource {
  const title = extractPdfStringMetadata(pdfText, "Title");
  const author = extractPdfStringMetadata(pdfText, "Author");
  const pageCount = countPdfPages(pdfText);

  return {
    ...baseSource,
    metadata: {
      ...(pageCount > 0 ? { pages: pageCount } : {}),
      ...(title ? { title } : {}),
      ...(author ? { author } : {})
    }
  };
}

function analyzeDocxArchive(archive: Record<string, Uint8Array>, baseSource: DraftSource): DraftSource {
  const coreXml = readZipText(archive, "docProps/core.xml") ?? "";
  const appXml = readZipText(archive, "docProps/app.xml") ?? "";
  const documentXml = readZipText(archive, "word/document.xml") ?? "";
  const title = extractXmlElementText(coreXml, "dc:title") ?? extractXmlElementText(coreXml, "title");
  const creator = extractXmlElementText(coreXml, "dc:creator") ?? extractXmlElementText(coreXml, "creator");
  const subject = extractXmlElementText(coreXml, "dc:subject") ?? extractXmlElementText(coreXml, "subject");
  const pages = parseIntegerMetadata(extractXmlElementText(appXml, "Pages"));
  const words = parseIntegerMetadata(extractXmlElementText(appXml, "Words"));
  const paragraphs = countDocxParagraphs(documentXml);

  return {
    ...baseSource,
    metadata: {
      ...(title ? { title } : {}),
      ...(creator ? { creator } : {}),
      ...(subject ? { subject } : {}),
      ...(pages !== undefined ? { pages } : {}),
      ...(words !== undefined ? { words } : {}),
      ...(paragraphs > 0 ? { paragraphs } : {})
    }
  };
}

function readZipText(archive: Record<string, Uint8Array>, entryPath: string): string | undefined {
  const bytes = archive[entryPath];

  return bytes ? strFromU8(bytes) : undefined;
}

function parseWorkbookSheetNames(workbookXml: string): string[] {
  return [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((match) => decodeXmlEntities(match[1] ?? ""));
}

interface ParsedXlsxWorksheet {
  name: string;
  row_count: number;
  columns: Array<{ name: string; type: string }>;
  sample_rows: Array<Record<string, DraftSourceSampleValue>>;
}

function parseXlsxWorksheets(
  archive: Record<string, Uint8Array>,
  sheetNames: string[],
  sharedStrings: string[]
): ParsedXlsxWorksheet[] {
  const worksheetPaths = Object.keys(archive)
    .filter((entryPath) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entryPath))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return worksheetPaths
    .map((worksheetPath, index) => {
      const worksheetXml = readZipText(archive, worksheetPath);

      if (!worksheetXml) {
        return undefined;
      }

      const worksheetRows = parseWorksheetRows(worksheetXml, sharedStrings);
      const header = worksheetRows[0] ?? [];
      const dataRows = worksheetRows.slice(1);
      const columns = header.map((name, columnIndex) => ({
        name: name || `column_${columnIndex + 1}`,
        type: inferColumnType(dataRows.map((row) => row[columnIndex]))
      }));

      return {
        name: sheetNames[index] ?? `工作表 ${index + 1}`,
        row_count: Math.max(0, parseWorksheetDimensionRowCount(worksheetXml) ?? dataRows.length),
        columns,
        sample_rows: dataRows.slice(0, 50).map((row) =>
          Object.fromEntries(columns.map((column, columnIndex) => [column.name, parseCellValue(row[columnIndex], column.type)]))
        )
      };
    })
    .filter((worksheet): worksheet is ParsedXlsxWorksheet => worksheet !== undefined);
}

function parseSharedStrings(sharedStringsXml: string): string[] {
  return [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const inlineText = [...(match[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXmlEntities(textMatch[1] ?? ""))
      .join("");

    return inlineText;
  });
}

function parseWorksheetRows(worksheetXml: string, sharedStrings: string[]): string[][] {
  return [...worksheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 51).map((rowMatch) => {
    const cells: Array<{ index: number; value: string }> = [];

    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      const value = type === "s" ? sharedStrings[Number(rawValue)] ?? "" : decodeXmlEntities(rawValue);

      cells.push({ index: ref ? columnLettersToIndex(ref) : cells.length, value });
    }

    const maxIndex = Math.max(-1, ...cells.map((cell) => cell.index));
    const row = Array.from({ length: maxIndex + 1 }, () => "");

    cells.forEach((cell) => {
      row[cell.index] = cell.value;
    });

    return row;
  });
}

function parseWorksheetDimensionRowCount(worksheetXml: string): number | undefined {
  const ref = worksheetXml.match(/<dimension\b[^>]*\bref="[^"]*?(\d+)(?::[A-Z]+(\d+))?"/)?.[2];
  const value = ref ? Number(ref) : undefined;

  return value !== undefined && Number.isFinite(value) ? Math.max(0, value - 1) : undefined;
}

function columnLettersToIndex(value: string): number {
  return value.split("").reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractPdfStringMetadata(pdfText: string, key: string): string | undefined {
  const match = pdfText.match(new RegExp(`/${key}\\s*\\(([^)]{1,200})\\)`));
  const value = match?.[1]?.replace(/\\([()\\])/g, "$1").trim();

  return value || undefined;
}

function countPdfPages(pdfText: string): number {
  return [...pdfText.matchAll(/\/Type\s*\/Page\b/g)].length;
}

function extractXmlElementText(xml: string, elementName: string): string | undefined {
  const escapedName = elementName.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/${escapedName}>`));
  const value = match?.[1]?.replace(/<[^>]+>/g, "").trim();

  return value ? decodeXmlEntities(value) : undefined;
}

function parseIntegerMetadata(value: string | undefined): number | undefined {
  const parsedValue = value ? Number(value) : undefined;

  return parsedValue !== undefined && Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function countDocxParagraphs(documentXml: string): number {
  return [...documentXml.matchAll(/<w:p\b/g)].length;
}

function parseDelimitedHeader(header: string, delimiter: string): string[] {
  return parseDelimitedLine(header, delimiter).filter(Boolean);
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    const next = line.charAt(index + 1);

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function inferColumnType(values: Array<string | undefined>): string {
  const presentValues = values.map((value) => value?.trim() ?? "").filter(Boolean);

  if (presentValues.length === 0) {
    return "unknown";
  }

  if (presentValues.every((value) => /^-?\d+$/.test(value))) {
    return "integer";
  }

  if (presentValues.every((value) => /^-?\d+(\.\d+)?$/.test(value))) {
    return "number";
  }

  if (presentValues.every((value) => /^(true|false|yes|no|是|否)$/i.test(value))) {
    return "boolean";
  }

  if (presentValues.every((value) => !Number.isNaN(Date.parse(value)))) {
    return "date";
  }

  return "string";
}

function isNumericColumnType(type: string | undefined): boolean {
  return type === "number" || type === "integer" || type === "currency" || type === "percent";
}

function parseCellValue(value: string | undefined, type: string): DraftSourceSampleValue {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  if (isNumericColumnType(type)) {
    const numericValue = Number(trimmed.replace(/[$,%\s]/g, ""));
    return Number.isFinite(numericValue) ? numericValue : trimmed;
  }

  if (type === "boolean") {
    return /^(true|yes|是)$/i.test(trimmed);
  }

  return trimmed;
}

function formatSourceMetadata(source: DraftSource): string[] {
  const metadata = source.metadata ?? {};
  const details: string[] = [];

  if (typeof metadata["sheets"] === "number") {
    details.push(`${metadata["sheets"]} 个工作表`);
  }

  if (typeof metadata["first_sheet"] === "string") {
    details.push(`首个工作表 ${metadata["first_sheet"]}`);
  }

  if (typeof metadata["selected_sheet"] === "string" && metadata["selected_sheet"] !== metadata["first_sheet"]) {
    details.push(`已选择工作表 ${metadata["selected_sheet"]}`);
  }

  if (typeof metadata["total_rows"] === "number" && metadata["total_rows"] !== source.row_count) {
    details.push(`共 ${metadata["total_rows"]} 行`);
  }

  if (typeof metadata["pages"] === "number") {
    details.push(`${metadata["pages"]} 页`);
  }

  if (typeof metadata["paragraphs"] === "number") {
    details.push(`${metadata["paragraphs"]} 段`);
  }

  if (typeof metadata["words"] === "number") {
    details.push(`${metadata["words"]} 字`);
  }

  if (typeof metadata["title"] === "string") {
    details.push(`标题 ${metadata["title"]}`);
  }

  if (typeof metadata["creator"] === "string") {
    details.push(`作者 ${metadata["creator"]}`);
  }

  if (typeof metadata["parsing_status"] === "string") {
    details.push(formatSourceParsingStatus(metadata["parsing_status"]));
  }

  return details;
}

function formatSourceParsingStatus(status: string): string {
  const labels: Record<string, string> = {
    unreadable_xlsx: "无法读取 XLSX",
    unreadable_docx: "无法读取 DOCX"
  };

  return labels[status] ?? `未知解析状态：${status}`;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "大小未知";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

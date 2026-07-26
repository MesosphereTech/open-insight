import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { analyzeSourceBytes, analyzeSourceFile, formatSourceDetails, inferSourceMimeType } from "./sourceAnalysis.js";

describe("compiler source analysis", () => {
  it("analyzes CSV bytes with typed columns and Chinese boolean values", () => {
    const source = analyzeSourceBytes({
      name: "sales.csv",
      bytes: new TextEncoder().encode("region,revenue,active\n华东,1200,是\n华北,900,否\n")
    });

    expect(source).toMatchObject({
      name: "sales.csv",
      path: "sources/sales.csv",
      type: "csv",
      mime_type: "text/csv",
      row_count: 2,
      columns: [
        { name: "region", type: "string" },
        { name: "revenue", type: "integer" },
        { name: "active", type: "boolean" }
      ],
      sample_rows: [
        { region: "华东", revenue: 1200, active: true },
        { region: "华北", revenue: 900, active: false }
      ]
    });
  });

  it("selects the data worksheet from browser File input", async () => {
    const source = await analyzeSourceFile(
      new File([createMultiSheetXlsx()], "issuer-financials.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      })
    );

    expect(source.columns).toEqual([
      { name: "region", type: "string" },
      { name: "revenue", type: "integer" },
      { name: "orders", type: "integer" }
    ]);
    expect(source.row_count).toBe(4);
    expect(source.sample_rows?.[0]).toEqual({ region: "East", revenue: 1200, orders: 8 });
    expect(source.metadata).toMatchObject({
      sheets: 2,
      total_rows: 5,
      sheet_names: "Cover, SalesData",
      first_sheet: "Cover",
      selected_sheet: "SalesData"
    });
    expect(formatSourceDetails(source)).toContain("已选择工作表 SalesData");
  });

  it("uses Chinese fallback labels for missing workbook names and parsing failures", () => {
    const unnamedWorkbook = analyzeSourceBytes({
      name: "missing-workbook.xlsx",
      bytes: createXlsxWithoutWorkbookNames()
    });
    const brokenWorkbook = analyzeSourceBytes({
      name: "broken.xlsx",
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(unnamedWorkbook.metadata).toMatchObject({
      sheets: 1,
      selected_sheet: "工作表 1"
    });
    expect(formatSourceDetails(unnamedWorkbook)).toContain("已选择工作表 工作表 1");
    expect(formatSourceDetails(unnamedWorkbook)).not.toContain("Sheet 1");
    expect(formatSourceDetails(brokenWorkbook)).toContain("无法读取 XLSX");
    expect(formatSourceDetails(brokenWorkbook)).not.toContain("unreadable_xlsx");
  });

  it("extracts PDF and DOCX document metadata from bytes", () => {
    const pdfSource = analyzeSourceBytes({
      name: "prospectus.pdf",
      bytes: new TextEncoder().encode(
        "%PDF-1.4\n1 0 obj << /Title (Bond Test Prospectus) /Author (Open Insight) >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF\n"
      )
    });
    const docxSource = analyzeSourceBytes({
      name: "covenants.docx",
      bytes: createDocx()
    });

    expect(pdfSource.metadata).toMatchObject({
      title: "Bond Test Prospectus",
      author: "Open Insight",
      pages: 2
    });
    expect(docxSource.metadata).toMatchObject({
      title: "Bond Covenant Memo",
      creator: "Open Insight Studio",
      subject: "Debt review",
      pages: 3,
      words: 420,
      paragraphs: 3
    });
    expect(formatSourceDetails(docxSource)).toContain("标题 Bond Covenant Memo");
  });

  it("exposes stable MIME inference for third-party compilers", () => {
    expect(inferSourceMimeType("csv")).toBe("text/csv");
    expect(inferSourceMimeType("xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(inferSourceMimeType("unknown")).toBeUndefined();
  });
});

function createMultiSheetXlsx(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="SalesData" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="9" uniqueCount="9">
  <si><t>note</t></si><si><t>Management summary only</t></si><si><t>region</t></si><si><t>revenue</t></si><si><t>orders</t></si><si><t>East</t></si><si><t>West</t></si><si><t>South</t></si><si><t>North</t></si>
</sst>`;
  const coverSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>`;
  const salesSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:C5"/>
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="s"><v>3</v></c><c r="C1" t="s"><v>4</v></c></row>
    <row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2"><v>1200</v></c><c r="C2"><v>8</v></c></row>
    <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3"><v>900</v></c><c r="C3"><v>4</v></c></row>
    <row r="4"><c r="A4" t="s"><v>7</v></c><c r="B4"><v>500</v></c><c r="C4"><v>3</v></c></row>
    <row r="5"><c r="A5" t="s"><v>5</v></c><c r="B5"><v>300</v></c><c r="C5"><v>2</v></c></row>
  </sheetData>
</worksheet>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "xl/workbook.xml": strToU8(workbook),
    "xl/sharedStrings.xml": strToU8(sharedStrings),
    "xl/worksheets/sheet1.xml": strToU8(coverSheet),
    "xl/worksheets/sheet2.xml": strToU8(salesSheet)
  });
}

function createXlsxWithoutWorkbookNames(): Uint8Array {
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B3"/>
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>region</t></is></c><c r="B1" t="inlineStr"><is><t>revenue</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>East</t></is></c><c r="B2"><v>1200</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>West</t></is></c><c r="B3"><v>900</v></c></row>
  </sheetData>
</worksheet>`;

  return zipSync({
    "xl/worksheets/sheet1.xml": strToU8(worksheet)
  });
}

function createDocx(): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bond Covenant Memo</dc:title><dc:creator>Open Insight Studio</dc:creator><dc:subject>Debt review</dc:subject></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>3</Pages><Words>420</Words></Properties>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Issuer covenant memo.</w:t></w:r></w:p><w:p><w:r><w:t>Debt service coverage discussion.</w:t></w:r></w:p><w:p><w:r><w:t>Risk review.</w:t></w:r></w:p></w:body></w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "docProps/core.xml": strToU8(core),
    "docProps/app.xml": strToU8(app),
    "word/document.xml": strToU8(document)
  });
}

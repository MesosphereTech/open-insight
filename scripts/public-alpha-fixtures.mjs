import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const textFiles = {
  "01-company-overview.md": `# Meridian Renewables

Meridian Renewables is a synthetic operator of three renewable energy projects in North America. This data room was created only for the Open Insight public Alpha demonstration.

## Portfolio

- Aurora Solar: utility-scale solar in Nevada.
- Harbor Wind: onshore wind in Maine.
- Pine Ridge Storage: battery storage in Colorado.

## Reporting period

The reporting period is the second quarter of 2026. All currency values are in US dollars unless a source says otherwise.
`,
  "02-quarterly-operations.md": `# Q2 2026 Operations Review

## Generation

The portfolio generated 428 GWh during Q2 2026. Aurora Solar generated 186 GWh, Harbor Wind generated 214 GWh, and Pine Ridge Storage discharged 28 GWh.

Harbor Wind exceeded plan by 9 GWh. Aurora Solar missed plan by 14 GWh because an inverter replacement reduced availability during May.

## Actions

The operations team expects the Aurora inverter replacement program to finish by 2026-08-15. No safety incidents were recorded during the quarter.
`,
  "03-risk-register.csv": `risk_id,risk,owner,likelihood,impact,mitigation,due_date
R-101,Aurora inverter availability,Elena Park,Medium,High,Complete replacement program,2026-08-15
R-102,Northwind transformer delivery,Marcus Reed,High,Medium,Qualify alternate supplier,2026-09-30
R-103,Harbor transmission curtailment,Priya Shah,Low,High,Negotiate revised dispatch protocol,2026-10-31
`,
  "04-project-portfolio.csv": `project,technology,location,q2_plan_gwh,q2_actual_gwh,variance_gwh
Aurora Solar,Solar,Nevada,200,186,-14
Harbor Wind,Wind,Maine,205,214,9
Pine Ridge Storage,Battery,Colorado,28,28,0
`,
  "05-data-room-index.html": `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Meridian Renewables Data Room Index</title></head>
<body>
  <h1>Data Room Index</h1>
  <p>Prepared for the Open Insight public Alpha demonstration.</p>
  <ol>
    <li>Company overview</li>
    <li>Q2 operations review</li>
    <li>Risk register</li>
    <li>Project portfolio</li>
    <li>Board memo</li>
    <li>Revenue workbook</li>
    <li>Supplier assessment</li>
  </ol>
</body>
</html>
`,
  "06-governance-policy.txt": `MERIDIAN RENEWABLES - CONTEXT GOVERNANCE POLICY

The source materials are synthetic and may be shared publicly.
Generated answers and presentations must remain outside the base .insight package.
Every material claim should retain source references when the consuming tool supports them.
`
};

function createDocxFixture() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Board Operations Memo</w:t></w:r></w:p>
    <w:p><w:r><w:t>Meeting date: 2026-07-18</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Decisions</w:t></w:r></w:p>
    <w:p><w:r><w:t>The board approved a 450000 dollar contingency for the Aurora inverter replacement program.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Marcus Reed will qualify an alternate transformer supplier by 2026-09-30.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Monitoring</w:t></w:r></w:p>
    <w:p><w:r><w:t>Management will report monthly on project availability, supplier delivery reliability, and transmission curtailment.</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRelationships),
    "word/document.xml": strToU8(document)
  });
}

function createXlsxFixture() {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Revenue" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:C5"/>
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>project</t></is></c><c r="B1" t="inlineStr"><is><t>2026_revenue_usd</t></is></c><c r="C1" t="inlineStr"><is><t>status</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Aurora Solar</t></is></c><c r="B2"><v>18400000</v></c><c r="C2" t="inlineStr"><is><t>forecast</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Harbor Wind</t></is></c><c r="B3"><v>22750000</v></c><c r="C3" t="inlineStr"><is><t>forecast</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Pine Ridge Storage</t></is></c><c r="B4"><v>8850000</v></c><c r="C4" t="inlineStr"><is><t>forecast</t></is></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>Total</t></is></c><c r="B5"><f>SUM(B2:B4)</f><v>50000000</v></c><c r="C5" t="inlineStr"><is><t>forecast</t></is></c></row>
  </sheetData>
</worksheet>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRelationships),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships),
    "xl/worksheets/sheet1.xml": strToU8(worksheet)
  });
}

function createTextPdfFixture() {
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 780 Td",
    "(Meridian Renewables Supplier Assessment) Tj",
    "0 -24 Td",
    "(Vendor: Northwind Transformers.) Tj",
    "0 -24 Td",
    "(On-time delivery reliability was 82 percent.) Tj",
    "0 -24 Td",
    "(The delayed transformer may affect the Aurora commissioning reserve.) Tj",
    "0 -24 Td",
    "(Corrective action is due on 2026-09-30.) Tj",
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const parts = [Buffer.from("%PDF-1.4\n%OpenInsight\n", "ascii")];
  const offsets = [0];
  let offset = parts[0].length;
  for (const [index, body] of objects.entries()) {
    offsets.push(offset);
    const object = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "ascii");
    parts.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  parts.push(
    Buffer.from(
      [
        `xref\n0 ${objects.length + 1}`,
        "0000000000 65535 f ",
        ...offsets.slice(1).map((item) => `${String(item).padStart(10, "0")} 00000 n `),
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
        `startxref\n${xrefOffset}`,
        "%%EOF\n"
      ].join("\n"),
      "ascii"
    )
  );
  return Buffer.concat(parts);
}

export const publicAlphaExpectedFacts = {
  company: "Meridian Renewables",
  source_count: 9,
  q2_generation_gwh: 428,
  project_below_plan: "Aurora Solar",
  project_variance_gwh: -14,
  risk_owner: "Marcus Reed",
  supplier_due_date: "2026-09-30",
  revenue_formula_cell: "B5",
  revenue_formula: "SUM(B2:B4)",
  projected_revenue_usd: 50000000,
  supplier_delivery_reliability_percent: 82
};

export async function createPublicAlphaMaterials(targetDir) {
  await mkdir(targetDir, { recursive: true });
  for (const [name, content] of Object.entries(textFiles)) {
    await writeFile(path.join(targetDir, name), content, "utf8");
  }
  await writeFile(path.join(targetDir, "07-board-operations-memo.docx"), createDocxFixture());
  await writeFile(path.join(targetDir, "08-revenue-forecast.xlsx"), createXlsxFixture());
  await writeFile(path.join(targetDir, "09-supplier-assessment.pdf"), createTextPdfFixture());

  return {
    schema_version: "open-insight.public-alpha-materials.v0.1",
    status: "created",
    fixture_name: "meridian-renewables",
    source_count: publicAlphaExpectedFacts.source_count,
    source_names: [...Object.keys(textFiles), "07-board-operations-memo.docx", "08-revenue-forecast.xlsx", "09-supplier-assessment.pdf"],
    expected_facts: publicAlphaExpectedFacts
  };
}


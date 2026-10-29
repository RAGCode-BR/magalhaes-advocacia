import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractDocument, polygonHectares } from "./documents.ts";

/** Smallest valid one-page PDF with the given text (offsets computed so pdf.js can parse it). */
function tinyPdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return strToU8(pdf);
}

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Fazenda Exemplo</name>
<Placemark><name>Área Pedreira</name><description>Matrícula 123</description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>
-56.0,-11.0,0 -55.99,-11.0,0 -55.99,-11.01,0 -56.0,-11.01,0 -56.0,-11.0,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Sede</name><Point><coordinates>-55.995,-11.005,0</coordinates></Point></Placemark>
</Document></kml>`;

const textOf = (content: { type: string; text?: string }[]) =>
  content.map((part) => part.text ?? "").join("\n");

describe("extractDocument", () => {
  it("returns the text of a PDF instead of an embedded file", async () => {
    const content = await extractDocument("memorando.pdf", "application/pdf", tinyPdf("Analise Fundiaria Preliminar"));
    expect(content?.every((part) => part.type === "text")).toBe(true);
    expect(textOf(content!)).toContain("Analise Fundiaria Preliminar");
    expect(textOf(content!)).toContain("memorando.pdf");
  });

  it("reads placemarks, coordinates and polygon area from a KMZ", async () => {
    const kmz = zipSync({ "doc.kml": strToU8(KML) });
    const text = textOf((await extractDocument("area.kmz", "application/vnd.google-earth.kmz", kmz))!);
    expect(text).toContain("Fazenda Exemplo");
    expect(text).toContain("Área Pedreira");
    expect(text).toContain("Matrícula 123");
    expect(text).toMatch(/Polígono .*ha/);
    expect(text).toContain("Sede");
    expect(text).toContain("-11.005");
  });

  it("reads a plain KML file too", async () => {
    const text = textOf((await extractDocument("area.kml", null, strToU8(KML)))!);
    expect(text).toContain("Área Pedreira");
  });

  it("reads the paragraphs of a Word document", async () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Contrato de honorários</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Cláusula 1 &amp; 2</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const text = textOf((await extractDocument("contrato.docx", null, docx))!);
    expect(text).toContain("Contrato de honorários\nCláusula 1 & 2");
  });

  it("reads the cells of an Excel sheet", async () => {
    const xlsx = zipSync({
      "xl/sharedStrings.xml": strToU8('<sst><si><t>Cliente</t></si><si><t>Valor</t></si><si><t>Ana</t></si></sst>'),
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Honorários" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c></row></sheetData></worksheet>',
      ),
    });
    const text = textOf((await extractDocument("planilha.xlsx", null, xlsx))!);
    expect(text).toContain("Honorários");
    expect(text).toContain("Cliente\tValor");
    expect(text).toContain("Ana\t1500");
  });

  it("leaves unknown formats to the caller", async () => {
    expect(await extractDocument("foto.heic", "image/heic", new Uint8Array([1, 2]))).toBeNull();
  });
});

describe("polygonHectares", () => {
  it("measures a ~1.1 km × 1.1 km square near the equator as ~120 ha", () => {
    const ring: [number, number][] = [
      [-56.0, -11.0],
      [-55.99, -11.0],
      [-55.99, -11.01],
      [-56.0, -11.01],
      [-56.0, -11.0],
    ];
    const hectares = polygonHectares(ring);
    expect(hectares).toBeGreaterThan(118);
    expect(hectares).toBeLessThan(124);
  });
});

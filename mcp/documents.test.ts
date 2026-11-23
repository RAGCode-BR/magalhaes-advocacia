import { describe, expect, it } from "vitest";
import { strToU8, zlibSync, zipSync } from "fflate";
import { readFile, polygonHectares, sniffExtension, type Content } from "./documents.ts";

/** A small JPEG (40×24, gray with a dark box), as a scanner or WhatsApp stores a page. */
const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/wAALCAAYACgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APSfF3i7T/BmlRajqMNzLFLOIAtuqs24qzZ+YjjCmuP/AOF9eFf+gfq//fmL/wCOUf8AC+vCv/QP1f8A78xf/HKtaZ8a/Deq6raadBY6ost3OkEbPFGFDMwUE4c8ZNeh15l8ev8AkR7P/sJJ/wCi5a8AorZ8Gf8AI8aD/wBhK3/9GLX1nWF4u8I6f4z0qLTtRmuYoopxOGt2VW3BWXHzA8YY1x//AAoXwr/0ENX/AO/0X/xuj/hQvhX/AKCGr/8Af6L/AON1a0z4KeG9K1W01GC+1RpbSdJ41eWMqWVgwBwg4yK9Dr//2Q==", "base64"));

type TestPage = {
  text?: string;
  image?: { data: Uint8Array; filter: string; width: number; height: number; colorSpace?: string };
};

/** Valid PDF (offsets computed so pdf.js can parse it) with text and/or one image per page. */
function buildPdf(pages: TestPage[]) {
  const parts: (string | Uint8Array)[] = [];
  const objects: (string | [string, Uint8Array])[] = [];
  const add = (body: string | [string, Uint8Array]) => objects.push(body) && objects.length;
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const page of pages) {
    let ops = "";
    let resources = `/Font << /F1 ${font} 0 R >>`;
    if (page.image) {
      const { data, filter, width, height, colorSpace = "/DeviceGray" } = page.image;
      const image = add([
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>`,
        data,
      ]);
      resources += ` /XObject << /Im0 ${image} 0 R >>`;
      ops += "q 300 0 0 200 0 0 cm /Im0 Do Q ";
    }
    if (page.text) ops += `BT /F1 12 Tf 20 100 Td (${page.text}) Tj ET`;
    const contents = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 300 200] /Contents ${contents} 0 R /Resources << ${resources} >> >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let length = 0;
  const push = (part: string | Uint8Array) => {
    parts.push(part);
    length += typeof part === "string" ? part.length : part.length;
  };
  push("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    if (typeof body === "string") push(`${index + 1} 0 obj\n${body}\nendobj\n`);
    else {
      push(`${index + 1} 0 obj\n${body[0]}\nstream\n`);
      push(body[1]);
      push("\nendstream\nendobj\n");
    }
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    const bytes = typeof part === "string" ? Uint8Array.from(part, (c) => c.charCodeAt(0)) : part;
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

const tinyPdf = (text: string) => buildPdf([{ text }]);
const scannedPage = (): TestPage => ({ image: { data: JPEG, filter: "/DCTDecode", width: 40, height: 24 } });

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Fazenda Exemplo</name>
<Placemark><name>Área Pedreira</name><description>Matrícula 123</description>
<Polygon><outerBoundaryIs><LinearRing><coordinates>
-56.0,-11.0,0 -55.99,-11.0,0 -55.99,-11.01,0 -56.0,-11.01,0 -56.0,-11.0,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
<Placemark><name>Sede</name><Point><coordinates>-55.995,-11.005,0</coordinates></Point></Placemark>
</Document></kml>`;

const textOf = (content: Content[]) => content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
const imagesOf = (content: Content[]) => content.filter((part) => part.type === "image");

describe("readFile", () => {
  it("returns the text of a PDF instead of an embedded file", async () => {
    const content = await readFile("memorando.pdf", "application/pdf", tinyPdf("Analise Fundiaria Preliminar"));
    expect(content?.every((part) => part.type === "text")).toBe(true);
    expect(textOf(content!)).toContain("Analise Fundiaria Preliminar");
    expect(textOf(content!)).toContain("memorando.pdf");
  });

  it("reads placemarks, coordinates and polygon area from a KMZ", async () => {
    const kmz = zipSync({ "doc.kml": strToU8(KML) });
    const text = textOf((await readFile("area.kmz", "application/vnd.google-earth.kmz", kmz))!);
    expect(text).toContain("Fazenda Exemplo");
    expect(text).toContain("Área Pedreira");
    expect(text).toContain("Matrícula 123");
    expect(text).toMatch(/Polígono .*ha/);
    expect(text).toContain("Sede");
    expect(text).toContain("-11.005");
  });

  it("reads a plain KML file too", async () => {
    const text = textOf((await readFile("area.kml", null, strToU8(KML)))!);
    expect(text).toContain("Área Pedreira");
  });

  it("reads the paragraphs of a Word document", async () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Contrato de honorários</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Cláusula 1 &amp; 2</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const text = textOf((await readFile("contrato.docx", null, docx))!);
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
    const text = textOf((await readFile("planilha.xlsx", null, xlsx))!);
    expect(text).toContain("Honorários");
    expect(text).toContain("Cliente\tValor");
    expect(text).toContain("Ana\t1500");
  });

  it("explains image formats Claude cannot open", async () => {
    expect(textOf(await readFile("foto.heic", "image/heic", new Uint8Array([1, 2])))).toMatch(/JPG ou PNG/);
  });

  it("sends the pages of a scanned PDF as the original JPEG images", async () => {
    const content = await readFile("procuracao.pdf", "application/pdf", buildPdf([scannedPage(), scannedPage()]));
    const images = imagesOf(content);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ mimeType: "image/jpeg", data: Buffer.from(JPEG).toString("base64") });
    expect(textOf(content)).toMatch(/imagem para você ler: 1, 2/);
    expect(textOf(content)).toContain('Página 2 de "procuracao.pdf"');
  });

  it("decodes pages stored in other formats into a PNG", async () => {
    const gray = new Uint8Array(160 * 120).fill(200);
    for (let i = 0; i < 160 * 10; i++) gray[i] = 10;
    const pdf = buildPdf([{ image: { data: zlibSync(gray), filter: "/FlateDecode", width: 160, height: 120 } }]);
    const [image] = imagesOf(await readFile("scanner.pdf", null, pdf));
    expect(image).toMatchObject({ mimeType: "image/png" });
    const png = Buffer.from((image as { data: string }).data, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([160, 120]);
  });

  it("explains pages that need conversion when decoding is off", async () => {
    const gray = zlibSync(new Uint8Array(160 * 120).fill(90));
    const pdf = buildPdf([
      scannedPage(),
      { image: { data: gray, filter: "/FlateDecode", width: 160, height: 120 } },
    ]);
    const content = await readFile("misto.pdf", null, pdf, { decodeImages: false });
    expect(imagesOf(content)).toHaveLength(1);
    expect(textOf(content)).toMatch(/Páginas 2 .*precisa ser convertido/);
    expect(textOf(content)).not.toMatch(/em branco/);
  });

  it("mixes text pages and scanned pages in one answer", async () => {
    const content = await readFile("misto.pdf", null, buildPdf([{ text: "Contrato de compra e venda do imovel rural" }, scannedPage()]));
    expect(textOf(content)).toContain("Contrato de compra e venda");
    expect(textOf(content)).toMatch(/imagem para você ler: 2\./);
    expect(imagesOf(content)).toHaveLength(1);
  });

  it("splits long scanned PDFs and continues from a given page", async () => {
    const pdf = buildPdf(Array.from({ length: 23 }, scannedPage));
    const first = await readFile("longo.pdf", null, pdf);
    expect(imagesOf(first)).toHaveLength(20);
    expect(textOf(first)).toContain("a_partir_da_pagina = 21");
    const rest = await readFile("longo.pdf", null, pdf, { fromPage: 21 });
    expect(imagesOf(rest)).toHaveLength(3);
    expect(textOf(rest)).toContain('Página 23 de "longo.pdf"');
  });

  it("reports blank pages instead of failing", async () => {
    const content = await readFile("branco.pdf", null, buildPdf([scannedPage(), {}]));
    expect(imagesOf(content)).toHaveLength(1);
    expect(textOf(content)).toMatch(/Páginas 2 .*em branco/);
    expect(textOf(content)).toMatch(/desenho vetorial/);
  });

  it("recognises a file without extension by its contents", async () => {
    expect(sniffExtension(tinyPdf("x"))).toBe("pdf");
    expect(sniffExtension(JPEG)).toBe("jpg");
    expect(textOf(await readFile("documento", null, tinyPdf("Matricula 4521")))).toContain("Matricula 4521");
  });

  it("reads every file inside a ZIP", async () => {
    const zip = zipSync({
      "docs/leia.txt": strToU8("Lista de documentos pendentes"),
      "docs/rg.jpg": JPEG,
      "__MACOSX/docs/._rg.jpg": strToU8("lixo"),
    });
    const content = await readFile("documentos.zip", "application/zip", zip);
    expect(textOf(content)).toContain("2 arquivo(s)");
    expect(textOf(content)).toContain("Lista de documentos pendentes");
    expect(imagesOf(content)).toHaveLength(1);
    expect(textOf(content)).not.toContain("lixo");
  });

  it("transcribes audio when a transcriber is configured", async () => {
    const ogg = strToU8("OggS fake voice note");
    expect(textOf(await readFile("audio.ogg", "audio/ogg", ogg))).toMatch(/transcrição .* não está configurada/);
    const transcribe = async (_: Uint8Array, mime: string) => `Bom dia, doutor (${mime})`;
    expect(textOf(await readFile("PTT-2026.opus", null, ogg, { transcribe }))).toContain("Bom dia, doutor (audio/ogg)");
  });

  it("explains archives it cannot open", async () => {
    expect(textOf(await readFile("fotos.7z", null, new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])))).toMatch(/ZIP/);
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

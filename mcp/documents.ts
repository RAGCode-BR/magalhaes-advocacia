// Turns attached files into text Claude can read. Claude's apps do not open
// embedded PDF or Office files sent by a connector, so the connector extracts
// the content itself: PDF text, Word/Excel/PowerPoint/OpenDocument, maps
// (KMZ/KML with areas in hectares), RTF, HTML and e-mail. Runs on Node and
// Cloudflare Workers (no native modules).
import { strFromU8, unzipSync } from "fflate";

export type TextContent = { type: "text"; text: string };

/** Keeps a single tool answer within what a conversation can take. */
const TEXT_LIMIT = 120_000;

const has = (name: string, mime: string | null, extensions: RegExp, mimes: RegExp) =>
  extensions.test(name) || (mime ? mimes.test(mime) : false);

const decodeEntities = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");

const stripTags = (xml: string) => decodeEntities(xml.replace(/<[^>]+>/g, ""));

const tidy = (text: string) =>
  text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function answer(fileName: string, kind: string, body: string): TextContent[] {
  const clean = tidy(body);
  if (!clean) return [{ type: "text", text: `"${fileName}" (${kind}) não tem texto legível.` }];
  const cut = clean.length > TEXT_LIMIT;
  return [
    {
      type: "text",
      text: `Conteúdo de "${fileName}" (${kind}):\n\n${cut ? clean.slice(0, TEXT_LIMIT) : clean}${
        cut ? `\n\n… (cortado: o arquivo tem ${clean.length.toLocaleString("pt-BR")} caracteres)` : ""
      }`,
    },
  ];
}

const unzip = (bytes: Uint8Array) => unzipSync(bytes);
const entry = (files: Record<string, Uint8Array>, path: string) =>
  files[path] ? strFromU8(files[path]) : "";

// ---------- PDF ----------

async function pdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((page, index) => `--- Página ${index + 1} ---\n${page.trim()}`);
  return { totalPages, body: pages.join("\n\n"), empty: (text as string[]).every((page) => !page.trim()) };
}

// ---------- Office Open XML / OpenDocument ----------

function wordText(files: Record<string, Uint8Array>) {
  const xml = entry(files, "word/document.xml");
  return stripTags(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t"),
  );
}

function columnIndex(ref: string) {
  const letters = ref.replace(/\d+/g, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function excelText(files: Record<string, Uint8Array>) {
  const shared = [...entry(files, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    stripTags(m[1]),
  );
  const names = [...entry(files, "xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) =>
    decodeEntities(m[1]),
  );
  const sheets = Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheets
    .map((path, sheetIndex) => {
      const rows = [...strFromU8(files[path]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
        const cells: string[] = [];
        for (const cell of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attributes = cell[1];
          const ref = attributes.match(/r="([A-Z]+\d+)"/)?.[1];
          const type = attributes.match(/t="(\w+)"/)?.[1];
          const raw = cell[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? stripTags(cell[2] ?? "");
          const value = type === "s" ? (shared[Number(raw)] ?? "") : decodeEntities(raw);
          cells[ref ? columnIndex(ref) : cells.length] = value;
        }
        return Array.from(cells, (value) => value ?? "").join("\t");
      });
      return `## Planilha: ${names[sheetIndex] ?? `Planilha ${sheetIndex + 1}`}\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

function powerPointText(files: Record<string, Uint8Array>) {
  return Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((path, index) => `--- Slide ${index + 1} ---\n${stripTags(strFromU8(files[path]).replace(/<\/a:p>/g, "\n"))}`)
    .join("\n\n");
}

function openDocumentText(files: Record<string, Uint8Array>) {
  return stripTags(
    entry(files, "content.xml")
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<\/text:(p|h)>/g, "\n")
      .replace(/<\/table:table-cell>/g, "\t")
      .replace(/<\/table:table-row>/g, "\n"),
  );
}

// ---------- Maps (KML / KMZ) ----------

type LonLat = [number, number];
const EARTH_RADIUS = 6_378_137;

/** Geodesic area of a lon/lat ring, in hectares (spherical approximation, < 0.5% error). */
export function polygonHectares(ring: LonLat[]) {
  if (ring.length < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    total += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2) / 10_000;
}

const parseCoordinates = (value: string): LonLat[] =>
  value
    .trim()
    .split(/\s+/)
    .map((point) => point.split(",").map(Number))
    .filter((point) => point.length >= 2 && point.every((n) => Number.isFinite(n)))
    .map(([lon, lat]) => [lon, lat]);

const formatPoint = ([lon, lat]: LonLat) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
const hectares = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function kmlText(kml: string) {
  const lines: string[] = [];
  const documentName = kml.match(/<Document[^>]*>\s*<name>([\s\S]*?)<\/name>/)?.[1];
  if (documentName) lines.push(`Documento: ${stripTags(documentName).trim()}`);
  const placemarks = [...kml.matchAll(/<Placemark[^>]*>([\s\S]*?)<\/Placemark>/g)];
  if (!placemarks.length) lines.push("Nenhum ponto ou área (Placemark) encontrado.");
  for (const [index, [, body]] of placemarks.entries()) {
    const name = stripTags(body.match(/<name>([\s\S]*?)<\/name>/)?.[1] ?? "").trim() || `Item ${index + 1}`;
    lines.push(`\n## ${name}`);
    const description = body.match(/<description>([\s\S]*?)<\/description>/)?.[1];
    if (description) lines.push(`Descrição: ${stripTags(description.replace(/<!\[CDATA\[|\]\]>/g, "")).trim()}`);
    for (const data of body.matchAll(/<(?:Data|SimpleData) name="([^"]*)"[^>]*>([\s\S]*?)<\/(?:Data|SimpleData)>/g))
      lines.push(`${decodeEntities(data[1])}: ${stripTags(data[2]).trim()}`);
    for (const polygon of body.matchAll(/<Polygon[^>]*>([\s\S]*?)<\/Polygon>/g)) {
      const outer = parseCoordinates(
        polygon[1].match(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/)?.[1] ?? "",
      );
      const holes = [...polygon[1].matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)].map(
        (m) => parseCoordinates(m[1]),
      );
      const area = polygonHectares(outer) - holes.reduce((sum, hole) => sum + polygonHectares(hole), 0);
      lines.push(`Polígono com ${outer.length} vértices, área aproximada de ${hectares(area)} ha.`);
      lines.push(`Vértices (lat, lon): ${outer.slice(0, 200).map(formatPoint).join(" | ")}${outer.length > 200 ? " …" : ""}`);
    }
    for (const line of body.matchAll(/<LineString[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const points = parseCoordinates(line[1]);
      lines.push(`Linha com ${points.length} pontos: ${points.slice(0, 100).map(formatPoint).join(" | ")}`);
    }
    for (const point of body.matchAll(/<Point[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const [first] = parseCoordinates(point[1]);
      if (first) lines.push(`Ponto (lat, lon): ${formatPoint(first)}`);
    }
  }
  return lines.join("\n");
}

// ---------- Others ----------

function rtfText(rtf: string) {
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536))
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

function htmlText(html: string) {
  return stripTags(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t"),
  );
}

/** Readable runs of text inside old binary Office files (.doc, .xls, .ppt). */
function legacyOfficeText(bytes: Uint8Array) {
  const runs: string[] = [];
  const utf16 = new TextDecoder("utf-16le").decode(bytes.byteLength % 2 ? bytes.slice(0, -1) : bytes);
  for (const match of utf16.matchAll(/[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]{6,}/gu)) runs.push(match[0]);
  const latin = new TextDecoder("windows-1252").decode(bytes);
  for (const match of latin.matchAll(/[A-Za-zÀ-ÿ0-9 ,.;:()/%$@ºª\-\n\r\t]{12,}/g)) runs.push(match[0]);
  return [...new Set(runs.map((run) => run.trim()).filter((run) => /[A-Za-zÀ-ÿ]{3}/.test(run)))].join("\n");
}

/**
 * Text content for a file Claude cannot open by itself, or null when the format
 * is not a document (images go straight to Claude; truly unknown types are
 * reported by the caller).
 */
export async function extractDocument(
  fileName: string,
  mime: string | null,
  bytes: Uint8Array,
): Promise<TextContent[] | null> {
  const name = fileName.toLowerCase();
  if (has(name, mime, /\.pdf$/, /^application\/pdf$/)) {
    const { totalPages, body, empty } = await pdfText(bytes);
    if (empty)
      return [
        {
          type: "text",
          text: `"${fileName}" é um PDF de ${totalPages} página(s) sem texto selecionável (provavelmente digitalizado/escaneado). Peça à pessoa um print das páginas importantes ou uma versão com texto.`,
        },
      ];
    return answer(fileName, `PDF, ${totalPages} página(s)`, body);
  }
  if (has(name, mime, /\.kmz$/, /kmz/)) {
    const files = unzip(bytes);
    const kml = Object.keys(files).find((path) => path.toLowerCase().endsWith(".kml"));
    return answer(fileName, "mapa KMZ", kml ? kmlText(strFromU8(files[kml])) : "Nenhum KML dentro do KMZ.");
  }
  if (has(name, mime, /\.kml$/, /kml/)) return answer(fileName, "mapa KML", kmlText(strFromU8(bytes)));
  if (has(name, mime, /\.docx$/, /wordprocessingml/)) return answer(fileName, "Word", wordText(unzip(bytes)));
  if (has(name, mime, /\.xlsx$/, /spreadsheetml/)) return answer(fileName, "Excel", excelText(unzip(bytes)));
  if (has(name, mime, /\.pptx$/, /presentationml/))
    return answer(fileName, "PowerPoint", powerPointText(unzip(bytes)));
  if (has(name, mime, /\.(odt|ods|odp)$/, /opendocument/))
    return answer(fileName, "OpenDocument", openDocumentText(unzip(bytes)));
  if (has(name, mime, /\.rtf$/, /rtf/)) return answer(fileName, "RTF", rtfText(strFromU8(bytes, true)));
  if (has(name, mime, /\.html?$/, /^text\/html/)) return answer(fileName, "HTML", htmlText(strFromU8(bytes)));
  if (has(name, mime, /\.eml$/, /^message\/rfc822/)) return answer(fileName, "e-mail", strFromU8(bytes));
  if (has(name, mime, /\.(doc|xls|ppt)$/, /^application\/(msword|vnd\.ms-(excel|powerpoint))$/))
    return answer(fileName, "Office antigo, texto aproximado", legacyOfficeText(bytes));
  return null;
}

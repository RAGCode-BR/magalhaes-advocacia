// Turns any attached file into something Claude can read. Claude's apps read
// text and images from a connector, but not embedded PDF, Office, audio or
// archive files, so the connector converts them: PDF text plus the page images
// of scanned pages, Word/Excel/PowerPoint/OpenDocument, maps (KMZ/KML with areas
// in hectares), RTF, HTML, e-mail, ZIP contents, and audio/video transcripts
// (when a transcriber is configured). Runs on Node and Cloudflare Workers (no
// native modules).
import { strFromU8, unzipSync } from "fflate";
import { IMAGE_LIMIT, pageImages } from "./pdf-images.ts";

export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image"; data: string; mimeType: string };
export type Content = TextContent | ImageContent;

/** Speech-to-text for audio and video files; returns the transcript. */
export type Transcriber = (bytes: Uint8Array, mimeType: string, fileName: string) => Promise<string>;

/** Keeps a single tool answer within what a conversation can take. */
const TEXT_LIMIT = 120_000;
const MAX_IMAGES = 20;
const IMAGE_BYTES_LIMIT = 15 * 1024 * 1024;

/** What is still allowed in this answer (shared by the files inside a ZIP). */
type Budget = { text: number; images: number; imageBytes: number };

export type ReadOptions = {
  /** First PDF page to return (1-based), to read long scanned PDFs in parts. */
  fromPage?: number;
  /**
   * Decode PDF page images that cannot be sent as they are (black-and-white
   * scanner formats, CMYK, photos over 5 MB). CPU-heavy: off on Cloudflare's
   * free plan. Default true.
   */
  decodeImages?: boolean;
  transcribe?: Transcriber;
};

type Context = ReadOptions & { budget: Budget; depth: number };

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

function answer(fileName: string, kind: string, body: string, budget?: Budget): TextContent[] {
  const clean = tidy(body);
  if (!clean) return [{ type: "text", text: `"${fileName}" (${kind}) não tem texto legível.` }];
  const limit = Math.max(2_000, budget ? budget.text : TEXT_LIMIT);
  const cut = clean.length > limit;
  const shown = cut ? clean.slice(0, limit) : clean;
  if (budget) budget.text = Math.max(0, budget.text - shown.length);
  return [
    {
      type: "text",
      text: `Conteúdo de "${fileName}" (${kind}):\n\n${shown}${
        cut ? `\n\n… (cortado: o arquivo tem ${clean.length.toLocaleString("pt-BR")} caracteres)` : ""
      }`,
    },
  ];
}

const unzip = (bytes: Uint8Array) => unzipSync(bytes);
const entry = (files: Record<string, Uint8Array>, path: string) =>
  files[path] ? strFromU8(files[path]) : "";

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


// ---------- Type detection ----------

const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const MEDIA_TYPES: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  amr: "audio/amr",
  weba: "audio/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** Extension implied by the file's first bytes, for files with a missing or wrong name. */
export function sniffExtension(bytes: Uint8Array): string | null {
  if (ascii(bytes, 0, 5) === "%PDF-") return "pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (ascii(bytes, 0, 4) === "GIF8") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "wav";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "AVI ") return "avi";
  if (ascii(bytes, 0, 4) === "OggS") return "ogg";
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  if (ascii(bytes, 4, 8) === "ftyp") return /^(M4A|M4B)/.test(ascii(bytes, 8, 12)) ? "m4a" : "mp4";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(bytes, 0, 6) === "#!AMR\n") return "amr";
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (ascii(bytes, 0, 4) === "Rar!") return "rar";
  if (ascii(bytes, 0, 5) === "{\\rtf") return "rtf";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "doc";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 512));
  if (/^\s*<\?xml[\s\S]*<kml/i.test(head) || /^\s*<kml/i.test(head)) return "kml";
  if (/^\s*(<!doctype html|<html)/i.test(head)) return "html";
  if (/^(From|Received|Return-Path|MIME-Version|Date|Subject):/m.test(head.slice(0, 200))) return "eml";
  return null;
}

/** ZIP-based formats are recognised by their contents. */
function zipKind(files: Record<string, Uint8Array>) {
  const names = Object.keys(files);
  if (names.includes("word/document.xml")) return "docx";
  if (names.includes("xl/workbook.xml")) return "xlsx";
  if (names.some((name) => name.startsWith("ppt/slides/"))) return "pptx";
  if (names.includes("content.xml") && names.includes("mimetype")) return "odt";
  if (names.some((name) => name.toLowerCase().endsWith(".kml")) && names.length <= 3) return "kmz";
  return "zip";
}

const extensionOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";

const KNOWN =
  /^(pdf|jpe?g|png|gif|webp|kmz|kml|docx|xlsx|xlsm|pptx|odt|ods|odp|rtf|html?|eml|doc|xls|ppt|zip|7z|rar|txt|md|csv|json|xml|tsv|log)$/;

const isText = (name: string, mime: string | null) =>
  /\.(txt|md|csv|tsv|json|log|xml)$/.test(name) ||
  (!!mime && /^(text\/(plain|csv|markdown|tab-separated-values)|application\/(json|csv))/.test(mime));

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const megabytes = (bytes: number) => `${(bytes / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

// ---------- PDF ----------

/** Pages with fewer readable characters than this are treated as scanned images. */
const SCANNED_PAGE_CHARS = 30;

async function readPdf(fileName: string, bytes: Uint8Array, context: Context): Promise<Content[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // pdf.js may take over the buffer it receives: give it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((page) => page.trim());
  const from = Math.min(Math.max(1, Math.floor(context.fromPage ?? 1)), Math.max(1, totalPages));
  const numbers = Array.from({ length: totalPages - from + 1 }, (_, index) => from + index);
  const readable = (page: number) => pages[page - 1].replace(/\s/g, "").length;
  // Pages with little or no text are probably scans: their image is what matters.
  const scanned = numbers.filter((page) => readable(page) < SCANNED_PAGE_CHARS);
  const wanted = scanned.slice(0, Math.max(0, context.budget.images));
  const pending = scanned.slice(wanted.length);
  const { images, needsDecoding } = wanted.length
    ? await pageImages(bytes, pdf, wanted, { decode: context.decodeImages !== false })
    : { images: [], needsDecoding: [] };

  const parts: Content[] = [];
  const sent: number[] = [];
  const tooLarge: number[] = [];
  for (const image of images) {
    if (image.data.length > IMAGE_LIMIT) {
      tooLarge.push(image.page);
      continue;
    }
    if (context.budget.images <= 0 || image.data.length > context.budget.imageBytes) {
      pending.unshift(image.page);
      continue;
    }
    context.budget.images--;
    context.budget.imageBytes -= image.data.length;
    const turned = image.rotate % 360 ? ` (a página está girada ${image.rotate % 360}° no PDF)` : "";
    parts.push({ type: "text", text: `Página ${image.page} de "${fileName}"${turned}:` });
    parts.push({ type: "image", data: base64(image.data), mimeType: image.mimeType });
    sent.push(image.page);
  }
  pending.sort((a, b) => a - b);
  const textPages = numbers.filter((page) => readable(page) > 0);
  const empty = wanted.filter(
    (page) => readable(page) === 0 && !images.some((image) => image.page === page) && !needsDecoding.includes(page),
  );

  const content: Content[] = [
    {
      type: "text",
      text:
        `"${fileName}" é um PDF de ${totalPages} página(s)${from > 1 ? `, a partir da página ${from}` : ""}.` +
        (sent.length ? ` Páginas digitalizadas enviadas como imagem para você ler: ${sent.join(", ")}.` : ""),
    },
  ];
  if (textPages.length) {
    const body = textPages.map((page) => `--- Página ${page} ---\n${pages[page - 1]}`).join("\n\n");
    content.push(...answer(fileName, "texto do PDF", body, context.budget));
  }
  content.push(...parts);
  if (empty.length)
    content.push({
      type: "text",
      text: `Páginas ${empty.join(", ")} de "${fileName}": sem texto e sem imagem dentro do arquivo. Ou estão em branco, ou são um desenho vetorial (planta/CAD, com as letras desenhadas como traços), que o conector não consegue transformar em imagem. Se for o caso, peça à pessoa um print ou JPG dessas páginas.`,
    });
  if (needsDecoding.length)
    content.push({
      type: "text",
      text: `Páginas ${needsDecoding.join(", ")} de "${fileName}": são digitalizadas, mas num formato de imagem que precisa ser convertido (scanner preto e branco, CMYK ou foto muito grande), e essa conversão está desligada neste conector. Peça à pessoa um print ou JPG dessas páginas.`,
    });
  if (tooLarge.length)
    content.push({
      type: "text",
      text: `Páginas ${tooLarge.join(", ")} de "${fileName}": a imagem passa de 5 MB, acima do que o Claude aceita.`,
    });
  if (pending.length)
    content.push({
      type: "text",
      text: `Faltam as páginas digitalizadas ${pending.join(", ")} de "${fileName}" (limite de imagens por resposta). Chame ler_anexo de novo com a_partir_da_pagina = ${pending[0]} para continuar.`,
    });
  return content;
}

// ---------- ZIP ----------

const MAX_ARCHIVE_FILES = 60;

async function readZip(fileName: string, files: Record<string, Uint8Array>, context: Context): Promise<Content[]> {
  const entries = Object.entries(files).filter(
    ([path, data]) => !path.endsWith("/") && !/(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/.test(path) && data.length,
  );
  const content: Content[] = [
    {
      type: "text",
      text: `"${fileName}" é um arquivo compactado (ZIP) com ${entries.length} arquivo(s):\n${entries
        .map(([path, data]) => `- ${path} (${megabytes(data.length)})`)
        .join("\n")}`,
    },
  ];
  if (context.depth >= 2) return content;
  for (const [path, data] of entries.slice(0, MAX_ARCHIVE_FILES)) {
    if (context.budget.text <= 2_000 && context.budget.images <= 0) {
      content.push({ type: "text", text: "… (demais arquivos não lidos: limite desta resposta)" });
      break;
    }
    const inner = `${fileName} › ${path}`;
    try {
      // Same budget object: the whole archive shares one answer's limits.
      content.push(...(await readFileContent(inner, null, data, { ...context, depth: context.depth + 1 })));
    } catch {
      content.push({ type: "text", text: `Não foi possível ler "${inner}": arquivo danificado ou protegido.` });
    }
  }
  if (entries.length > MAX_ARCHIVE_FILES)
    content.push({ type: "text", text: `… (${entries.length - MAX_ARCHIVE_FILES} arquivo(s) além do limite não foram lidos)` });
  return content;
}

// ---------- Audio and video ----------

async function readMedia(fileName: string, mimeType: string, bytes: Uint8Array, context: Context): Promise<Content[]> {
  const kind = mimeType.startsWith("video/") ? "vídeo" : "áudio";
  if (!context.transcribe)
    return [
      {
        type: "text",
        text: `"${fileName}" é um ${kind} (${megabytes(bytes.length)}). A transcrição de áudio e vídeo não está configurada neste conector, então o conteúdo não pode ser ouvido aqui.`,
      },
    ];
  try {
    const transcript = await context.transcribe(bytes, mimeType, fileName);
    return answer(fileName, `transcrição do ${kind}`, transcript, context.budget);
  } catch (error) {
    return [
      {
        type: "text",
        text: `Não foi possível transcrever "${fileName}": ${error instanceof Error ? error.message : "erro desconhecido"}.`,
      },
    ];
  }
}

// ---------- Entry point ----------

async function readFileContent(
  fileName: string,
  mime: string | null,
  bytes: Uint8Array,
  context: Context,
): Promise<Content[]> {
  const text = (value: string): Content[] => [{ type: "text", text: value }];
  let name = fileName.toLowerCase();
  // Generic or missing types: trust the bytes.
  if (!mime || /octet-stream|binary|unknown/.test(mime)) mime = null;
  if (!KNOWN.test(extensionOf(name)) && !MEDIA_TYPES[extensionOf(name)] && !mime) {
    const sniffed = sniffExtension(bytes);
    if (sniffed) name = `${name}.${sniffed}`;
  }
  const extension = extensionOf(name);

  if (isText(name, mime)) return answer(fileName, "texto", strFromU8(bytes), context.budget);

  const imageMime = IMAGE_TYPES[extension] ?? (mime && /^image\/(png|jpeg|gif|webp)$/.test(mime) ? mime : null);
  if (imageMime) {
    if (bytes.length > IMAGE_LIMIT)
      return text(`A imagem "${fileName}" tem ${megabytes(bytes.length)}, acima do limite de 5 MB que o Claude aceita.`);
    if (context.budget.images <= 0 || bytes.length > context.budget.imageBytes)
      return text(`Imagem "${fileName}" não enviada: limite de imagens desta resposta.`);
    context.budget.images--;
    context.budget.imageBytes -= bytes.length;
    return [
      { type: "text", text: `Imagem "${fileName}":` },
      { type: "image", data: base64(bytes), mimeType: imageMime },
    ];
  }
  if (mime?.startsWith("image/") || /^(heic|heif|tiff?|bmp|svg)$/.test(extension)) {
    if (extension === "svg" || mime === "image/svg+xml") return answer(fileName, "SVG", htmlText(strFromU8(bytes)), context.budget);
    return text(
      `"${fileName}" é uma imagem em formato ${extension.toUpperCase() || mime} (${megabytes(bytes.length)}), que o Claude não abre. Peça à pessoa para anexar em JPG ou PNG (no iPhone: Ajustes › Câmera › Formatos › Mais Compatível).`,
    );
  }

  const mediaMime = MEDIA_TYPES[extension] ?? (mime && /^(audio|video)\//.test(mime) ? mime.split(";")[0] : null);
  if (mediaMime) return readMedia(fileName, mediaMime, bytes, context);

  if (has(name, mime, /\.pdf$/, /^application\/pdf$/)) return readPdf(fileName, bytes, context);
  if (has(name, mime, /\.kml$/, /kml\+xml/)) return answer(fileName, "mapa KML", kmlText(strFromU8(bytes)), context.budget);
  if (has(name, mime, /\.rtf$/, /rtf/)) return answer(fileName, "RTF", rtfText(strFromU8(bytes, true)), context.budget);
  if (has(name, mime, /\.html?$/, /^text\/html/)) return answer(fileName, "HTML", htmlText(strFromU8(bytes)), context.budget);
  if (has(name, mime, /\.eml$/, /^message\/rfc822/)) return answer(fileName, "e-mail", strFromU8(bytes), context.budget);
  if (has(name, mime, /\.(doc|xls|ppt)$/, /^application\/(msword|vnd\.ms-(excel|powerpoint))$/))
    return answer(fileName, "Office antigo, texto aproximado", legacyOfficeText(bytes), context.budget);
  if (has(name, mime, /\.(7z|rar)$/, /x-7z|rar/))
    return text(
      `"${fileName}" é um arquivo compactado ${extension.toUpperCase()} (${megabytes(bytes.length)}), formato que o conector não descompacta. Peça à pessoa para reenviar em ZIP ou anexar os arquivos soltos.`,
    );

  // Every ZIP-based format (Office, OpenDocument, KMZ, plain ZIP).
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const files = unzip(bytes);
    const kind = zipKind(files);
    if (kind === "docx") return answer(fileName, "Word", wordText(files), context.budget);
    if (kind === "xlsx") return answer(fileName, "Excel", excelText(files), context.budget);
    if (kind === "pptx") return answer(fileName, "PowerPoint", powerPointText(files), context.budget);
    if (kind === "odt") return answer(fileName, "OpenDocument", openDocumentText(files), context.budget);
    if (kind === "kmz") {
      const kml = Object.keys(files).find((path) => path.toLowerCase().endsWith(".kml"))!;
      return answer(fileName, "mapa KMZ", kmlText(strFromU8(files[kml])), context.budget);
    }
    return readZip(fileName, files, context);
  }

  // Unknown binary: show it as text only when it really is text.
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 200_000));
  const printable = decoded.replace(/[^\p{L}\p{N}\p{P}\p{Zs}\n\r\t]/gu, "").length / Math.max(1, decoded.length);
  if (printable > 0.95) return answer(fileName, "texto", decoded, context.budget);
  return text(
    `"${fileName}" (${mime ?? (extension || "tipo desconhecido")}, ${megabytes(bytes.length)}) não é um formato que o conector consiga ler.`,
  );
}

/**
 * Content of any attached file in a form Claude can read: text, images (scanned
 * PDF pages included) and transcripts. Damaged or password-protected files are
 * reported instead of failing the call.
 */
export async function readFile(
  fileName: string,
  mime: string | null,
  bytes: Uint8Array,
  options: ReadOptions = {},
): Promise<Content[]> {
  const context: Context = {
    ...options,
    budget: { text: TEXT_LIMIT, images: MAX_IMAGES, imageBytes: IMAGE_BYTES_LIMIT },
    depth: 0,
  };
  try {
    return await readFileContent(fileName, mime, bytes, context);
  } catch {
    return [
      {
        type: "text",
        text: `Não foi possível ler "${fileName}": o arquivo parece danificado ou protegido por senha.`,
      },
    ];
  }
}

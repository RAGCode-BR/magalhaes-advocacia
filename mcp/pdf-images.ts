// Page images of scanned PDFs, so Claude can read them itself (it reads images,
// not PDFs, from a connector). Scanners and phone apps store each page as one
// JPEG: that stream is copied as is, without decoding, which costs almost no CPU
// (the connector runs on Cloudflare Workers). Pages stored in other formats
// (black-and-white CCITT/JBIG2, Flate, CMYK) are decoded by pdf.js and re-encoded
// as a grayscale PNG.
import { unzlibSync, zlibSync } from "fflate";
type PDFDocumentProxy = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

export type PageImage = {
  page: number;
  data: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  rotate: number;
};

/** Claude rejects images above 5 MB; it also scales anything above ~1568 px down. */
export const IMAGE_LIMIT = 5 * 1024 * 1024;
const PNG_MAX_SIDE = 1568;

// ---------- Minimal PDF object reader ----------

type PdfObject = { body: string; stream?: [number, number] };

const WHITESPACE = /[\0\t\n\f\r ]/;
const DELIMITER = /[\0\t\n\f\r ()<>[\]{}/%]/;

/** Reads one PDF value starting at `i` and returns its raw text and the index after it. */
function readValue(s: string, i: number): [string, number] {
  while (i < s.length && (WHITESPACE.test(s[i]) || s[i] === "%")) {
    if (s[i] === "%") while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    else i++;
  }
  const start = i;
  if (s.startsWith("<<", i)) {
    let depth = 0;
    while (i < s.length) {
      if (s.startsWith("<<", i)) {
        depth++;
        i += 2;
      } else if (s.startsWith(">>", i)) {
        i += 2;
        if (--depth === 0) break;
      } else if (s[i] === "(" || s[i] === "<" || s[i] === "[") i = readValue(s, i)[1];
      else i++;
    }
    return [s.slice(start, i), i];
  }
  if (s[i] === "[") {
    i++;
    while (i < s.length && s[i] !== "]") {
      const next = readValue(s, i)[1];
      i = next > i ? next : i + 1;
      while (i < s.length && WHITESPACE.test(s[i])) i++;
    }
    return [s.slice(start, i + 1), i + 1];
  }
  if (s[i] === "(") {
    let depth = 0;
    for (; i < s.length; i++) {
      if (s[i] === "\\") i++;
      else if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) break;
    }
    return [s.slice(start, i + 1), i + 1];
  }
  if (s[i] === "<") {
    const end = s.indexOf(">", i);
    return [s.slice(start, end + 1), end + 1];
  }
  if (s[i] === "/") i++;
  while (i < s.length && !DELIMITER.test(s[i])) i++;
  // An integer followed by "<gen> R" is a reference.
  const ref = /^\s+(\d+)\s+R(?![^\0\t\n\f\r ()<>[\]{}/%])/.exec(s.slice(i, i + 24));
  if (/^\d+$/.test(s.slice(start, i)) && ref) i += ref[0].length;
  return [s.slice(start, i), i];
}

/** Top-level entries of a dictionary, keyed by name without the slash. */
function parseDict(raw: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const text = raw.trim();
  if (!text.startsWith("<<")) return entries;
  let i = 2;
  const end = text.length - 2;
  while (i < end) {
    const [key, afterKey] = readValue(text, i);
    if (!key.startsWith("/")) break;
    const [value, afterValue] = readValue(text, afterKey);
    entries[key.slice(1)] = value;
    i = afterValue;
    while (i < end && WHITESPACE.test(text[i])) i++;
  }
  return entries;
}

/** Items of an array value. */
function parseArray(raw: string): string[] {
  const text = raw.trim();
  if (!text.startsWith("[")) return [text];
  const items: string[] = [];
  let i = 1;
  while (i < text.length - 1) {
    const [value, next] = readValue(text, i);
    if (!value || next <= i) break;
    items.push(value);
    i = next;
    while (i < text.length - 1 && WHITESPACE.test(text[i])) i++;
  }
  return items;
}

const REF = /^(\d+)\s+\d+\s+R$/;

class PdfReader {
  private objects = new Map<number, PdfObject>();
  private text: string;
  private bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.text = new TextDecoder("latin1").decode(bytes);
    this.indexObjects();
  }

  private indexObjects() {
    const header = /(\d+)\s+\d+\s+obj\b/g;
    const s = this.text;
    let match: RegExpExecArray | null;
    const objectStreams: PdfObject[] = [];
    while ((match = header.exec(s))) {
      const bodyStart = match.index + match[0].length;
      const end = s.indexOf("endobj", bodyStart);
      if (end < 0) break;
      const streamAt = s.indexOf("stream", bodyStart);
      let object: PdfObject;
      if (streamAt >= 0 && streamAt < end && !s.startsWith("endstream", streamAt - 3)) {
        let dataStart = streamAt + "stream".length;
        if (s[dataStart] === "\r") dataStart++;
        if (s[dataStart] === "\n") dataStart++;
        const body = s.slice(bodyStart, streamAt);
        const length = /^\d+$/.test(parseDict(body).Length ?? "")
          ? Number(parseDict(body).Length)
          : -1;
        let dataEnd =
          length >= 0 && /^\s*endstream/.test(s.slice(dataStart + length, dataStart + length + 20))
            ? dataStart + length
            : s.indexOf("endstream", dataStart);
        if (dataEnd < 0) break;
        // Without a usable /Length the end-of-line before "endstream" is not data.
        if (length < 0 && s[dataEnd - 1] === "\n") dataEnd--;
        if (length < 0 && s[dataEnd - 1] === "\r") dataEnd--;
        object = { body, stream: [dataStart, dataEnd] };
        // Binary data may contain "endobj": continue after the stream.
        header.lastIndex = s.indexOf("endobj", dataEnd) + "endobj".length;
        if (/\/Type\s*\/ObjStm\b/.test(body)) objectStreams.push(object);
      } else {
        object = { body: s.slice(bodyStart, end) };
        header.lastIndex = end + "endobj".length;
      }
      // Later definitions (incremental updates) replace earlier ones.
      this.objects.set(Number(match[1]), object);
    }
    // Compressed object streams (PDF 1.5+) hold page and resource dictionaries.
    for (const stream of objectStreams) {
      try {
        const dict = parseDict(stream.body);
        const data = this.streamBytes(stream);
        if (!/FlateDecode/.test(dict.Filter ?? "") || !data) continue;
        const content = new TextDecoder("latin1").decode(unzlibSync(data));
        const first = Number(this.resolve(dict.First ?? "0"));
        const numbers = content.slice(0, first).trim().split(/\s+/).map(Number);
        for (let k = 0; k + 1 < numbers.length; k += 2) {
          const from = first + numbers[k + 1];
          const to = k + 3 < numbers.length ? first + numbers[k + 3] : content.length;
          if (!this.objects.has(numbers[k]))
            this.objects.set(numbers[k], { body: content.slice(from, to) });
        }
      } catch {
        // A damaged object stream only hides the objects inside it.
      }
    }
  }

  streamBytes(object: PdfObject) {
    return object.stream ? this.bytes.subarray(object.stream[0], object.stream[1]) : null;
  }

  object(raw: string) {
    const ref = REF.exec(raw.trim());
    return ref ? this.objects.get(Number(ref[1])) : undefined;
  }

  /** The value itself, or the body of the object a reference points to. */
  resolve(raw: string, depth = 0): string {
    const object = this.object(raw);
    if (!object || depth > 8) return raw.trim();
    return this.resolve(object.body, depth + 1);
  }

  dict(raw: string | undefined) {
    return raw ? parseDict(this.resolve(raw)) : {};
  }

  /** Page dictionaries in reading order, with inherited Resources and Rotate. */
  pages() {
    const root = [...this.text.matchAll(/\/Root\s+(\d+\s+\d+\s+R)/g)].at(-1)?.[1];
    const catalog = this.dict(root);
    const pages: { resources: string | undefined; rotate: number }[] = [];
    const seen = new Set<string>();
    const walk = (raw: string, resources: string | undefined, rotate: number) => {
      if (seen.has(raw) || pages.length > 5000) return;
      seen.add(raw);
      const node = this.dict(raw);
      const nodeResources = node.Resources ?? resources;
      const nodeRotate =
        node.Rotate !== undefined ? Number(this.resolve(node.Rotate)) || 0 : rotate;
      if (node.Kids)
        for (const kid of parseArray(this.resolve(node.Kids))) walk(kid, nodeResources, nodeRotate);
      else pages.push({ resources: nodeResources, rotate: nodeRotate });
    };
    if (catalog.Pages) walk(catalog.Pages, undefined, 0);
    return pages;
  }

  /** Image XObjects a page uses, including those inside its form XObjects. */
  images(
    resources: string | undefined,
    depth = 0,
  ): { raw: string; dict: Record<string, string> }[] {
    if (!resources || depth > 3) return [];
    const xobjects = this.dict(this.dict(resources).XObject);
    return Object.values(xobjects).flatMap((raw) => {
      const dict = this.dict(raw);
      if (dict.Subtype === "/Image") return [{ raw, dict }];
      if (dict.Subtype === "/Form") return this.images(dict.Resources, depth + 1);
      return [];
    });
  }

  /** Number of color components, or 0 when unknown. */
  components(colorSpace: string | undefined): number {
    if (!colorSpace) return 0;
    const value = this.resolve(colorSpace);
    if (value === "/DeviceGray" || value === "/CalGray") return 1;
    if (value === "/DeviceRGB" || value === "/CalRGB") return 3;
    if (value === "/DeviceCMYK") return 4;
    const [family, parameter] = parseArray(value);
    if (family === "/ICCBased" && parameter)
      return Number(this.resolve(this.dict(parameter).N ?? "0")) || 0;
    return 0;
  }
}

/** The JPEG bytes of an image XObject when they can go to Claude untouched. */
function directJpeg(reader: PdfReader, image: { raw: string; dict: Record<string, string> }) {
  const filters = parseArray(reader.resolve(image.dict.Filter ?? "[]"));
  if (filters.length !== 1 || filters[0] !== "/DCTDecode" || image.dict.Decode) return null;
  // CMYK JPEGs need conversion (Adobe stores them inverted).
  if (![1, 3].includes(reader.components(image.dict.ColorSpace))) return null;
  const object = reader.object(image.raw);
  const data = object ? reader.streamBytes(object) : null;
  return data && data[0] === 0xff && data[1] === 0xd8 ? data : null;
}

const area = (dict: Record<string, string>, reader: PdfReader) =>
  (Number(reader.resolve(dict.Width ?? "0")) || 0) *
  (Number(reader.resolve(dict.Height ?? "0")) || 0);

// ---------- PNG fallback ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Reads the gray level (0–255) of one pixel. */
type GrayPixel = (x: number, y: number) => number;

/** Pixel reader for the layouts pdf.js decodes images into (ImageKind 1, 2 and 3). */
export function grayReader(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  kind: number,
): GrayPixel | null {
  if (kind === 1) {
    // 1 bit per pixel, rows padded to whole bytes, set bit = white.
    const rowBytes = Math.ceil(width / 8);
    if (data.length < rowBytes * height) return null;
    return (x, y) => (data[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0);
  }
  const channels = kind === 2 ? 3 : kind === 3 ? 4 : data.length / (width * height);
  if (![1, 3, 4].includes(channels) || data.length < width * height * channels) return null;
  if (channels === 1) return (x, y) => data[y * width + x];
  return (x, y) => {
    const i = (y * width + x) * channels;
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  };
}

/** Grayscale PNG of decoded pixels, shrunk (area average) to what Claude uses anyway. */
export function grayscalePng(gray: GrayPixel, width: number, height: number) {
  const factor = Math.max(1, Math.ceil(Math.max(width, height) / PNG_MAX_SIDE));
  const w = Math.max(1, Math.floor(width / factor));
  const h = Math.max(1, Math.floor(height / factor));
  // Each row: filter byte 2 ("Up") followed by the difference to the row above.
  const raw = new Uint8Array(h * (w + 1));
  const previous = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 2;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++) sum += gray(x * factor + dx, y * factor + dy);
      const value = Math.round(sum / (factor * factor));
      raw[y * (w + 1) + 1 + x] = (value - previous[x]) & 0xff;
      previous[x] = value;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit grayscale
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Decodes the page's largest image with pdf.js (any filter: CCITT, JBIG2, Flate, CMYK JPEG…). */
async function decodedPageImage(pdf: PDFDocumentProxy, page: number) {
  const { getResolvedPDFJS } = await import("unpdf");
  const { OPS } = await getResolvedPDFJS();
  const proxy = await pdf.getPage(page);
  const operators = await proxy.getOperatorList();
  let best: {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
    kind: number;
  } | null = null;
  for (let i = 0; i < operators.fnArray.length; i++) {
    if (operators.fnArray[i] !== OPS.paintImageXObject) continue;
    const key = operators.argsArray[i][0] as string;
    const image = await new Promise<{
      data?: Uint8Array;
      width?: number;
      height?: number;
      kind?: number;
    } | null>((resolve) =>
      (key.startsWith("g_") ? proxy.commonObjs : proxy.objs).get(key, resolve),
    );
    if (!image?.data || !image.width || !image.height) continue;
    if (!best || image.width * image.height > best.width * best.height)
      best = { data: image.data, width: image.width, height: image.height, kind: image.kind ?? 0 };
  }
  if (!best || best.width * best.height < 100 * 100) return null;
  const gray = grayReader(best.data, best.width, best.height, best.kind);
  return gray ? grayscalePng(gray, best.width, best.height) : null;
}

/**
 * The main image of each requested page (1-based numbers). Pages without a
 * readable image are left out.
 */
export async function pageImages(
  bytes: Uint8Array,
  pdf: PDFDocumentProxy,
  pageNumbers: number[],
  { decode = true }: { decode?: boolean } = {},
): Promise<{ images: PageImage[]; needsDecoding: number[] }> {
  let reader: PdfReader | null = null;
  let pages: ReturnType<PdfReader["pages"]> = [];
  try {
    reader = new PdfReader(bytes);
    pages = reader.pages();
  } catch {
    reader = null;
  }
  const images: PageImage[] = [];
  const needsDecoding: number[] = [];
  for (const page of pageNumbers) {
    const info = pages[page - 1];
    let rotate = info?.rotate ?? 0;
    let image: PageImage | null = null;
    let hasImage = !reader || !info;
    if (reader && info) {
      const largest = reader
        .images(info.resources)
        .sort((a, b) => area(b.dict, reader!) - area(a.dict, reader!))[0];
      hasImage = !!largest && area(largest.dict, reader) >= 100 * 100;
      const jpeg = largest && directJpeg(reader, largest);
      // A JPEG over Claude's limit (high-resolution photo) is decoded and shrunk below instead.
      if (jpeg && jpeg.length <= IMAGE_LIMIT)
        image = { page, data: jpeg, mimeType: "image/jpeg", rotate };
    }
    if (!image && !decode) {
      // Decoding is CPU-heavy (Cloudflare's free plan stops the whole call): report instead.
      if (hasImage) needsDecoding.push(page);
      continue;
    }
    if (!image) {
      try {
        const png = await decodedPageImage(pdf, page);
        if (png) {
          if (!info) rotate = (await pdf.getPage(page)).rotate;
          image = { page, data: png, mimeType: "image/png", rotate };
        }
      } catch {
        // Undecodable page: reported by the caller as unreadable.
      }
    }
    if (image) images.push(image);
  }
  return { images, needsDecoding };
}

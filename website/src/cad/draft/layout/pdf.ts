/**
 * BALÍK 3 (layout) – vlastní zapisovač PDF 1.7 pro tisk 2D výkresu: vektorově (úsečky, Bézierovy oblouky, výplně,
 * ořez výřezů), souřadnice v mm papíru s přesností 1 nm (transformace mm → pt jednou na stránku), tloušťky čar v mm,
 * text vloženým písmem Roboto (čeština, Type0 / Identity-H, ToUnicode – text jde v PDF hledat a kopírovat).
 * Bez písma (např. offline) se použije Helvetica a diakritika se odstraní.
 */
import type { PathCmd, PlotItem, PlotPage, RGB } from "./plot";
import { parseTtf, type TtfFont } from "./ttf";

const PT = 72 / 25.4;

/** číslo do PDF: nejvýš 6 desetinných míst, bez zbytečných nul */
export function pn(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 1e6) / 1e6;
  if (Object.is(r, -0) || r === 0) return "0";
  let s = r.toFixed(6);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
const col = (c: RGB) => `${pn(c[0] / 255)} ${pn(c[1] / 255)} ${pn(c[2] / 255)}`;

let fontPromise: Promise<TtfFont | null> | null = null;
let fontOverride: TtfFont | null = null;
/** písmo pro PDF (testy a Node: bajty TTF z disku) */
export function setPdfFont(bytes: Uint8Array | null) {
  fontOverride = bytes ? parseTtf(bytes) : null;
}
/** písmo Roboto z /fonts (prohlížeč); null = nedostupné */
export function loadPdfFont(): Promise<TtfFont | null> {
  if (fontOverride) return Promise.resolve(fontOverride);
  if (!fontPromise) {
    fontPromise =
      typeof fetch === "undefined" || typeof window === "undefined"
        ? Promise.resolve(null)
        : fetch("/fonts/Roboto-Regular.ttf")
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((b) => parseTtf(new Uint8Array(b)))
            .catch(() => {
              fontPromise = null;
              return null;
            });
  }
  return fontPromise;
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
  if (!CS) return null;
  try {
    const cs = new CS("deflate");
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const enc = new TextEncoder();
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** text řetězec PDF (UTF-16BE s BOM, hexadecimálně) */
const pdfText = (s: string) => {
  let h = "FEFF";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      h += (0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    } else h += cp.toString(16).padStart(4, "0");
  }
  return `<${h.toUpperCase()}>`;
};
const latin = (s: string) => {
  let o = "";
  for (const ch of strip(s)) {
    const c = ch.charCodeAt(0);
    const b = c < 256 ? c : 63;
    o += b < 32 || b === 40 || b === 41 || b === 92 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : ch;
  }
  return `(${o})`;
};

function pathOps(cmds: PathCmd[], out: string[]) {
  for (const c of cmds) {
    if (c.k === "M") out.push(`${pn(c.p[0])} ${pn(c.p[1])} m`);
    else if (c.k === "L") out.push(`${pn(c.p[0])} ${pn(c.p[1])} l`);
    else if (c.k === "C") out.push(`${pn(c.c1[0])} ${pn(c.c1[1])} ${pn(c.c2[0])} ${pn(c.c2[1])} ${pn(c.p[0])} ${pn(c.p[1])} c`);
    else out.push("h");
  }
}

/** obsah stránky (operátory PDF); souřadnice v mm, jednotky převede `cm` na začátku */
function pageContent(p: PlotPage, font: TtfFont | null, used: Map<number, number>): string {
  const out: string[] = [`q ${pn(PT)} 0 0 ${pn(PT)} 0 0 cm`, "1 j"];
  type GS = { stroke: string; fill: string; lw: number; cap: string };
  let gs: GS = { stroke: "", fill: "", lw: -1, cap: "" };
  const stack: GS[] = [];
  const items = p.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.k === "stroke") {
      const sc = col(it.color);
      if (gs.stroke !== sc) out.push(`${sc} RG`), (gs.stroke = sc);
      if (gs.lw !== it.lw) out.push(`${pn(it.lw)} w`), (gs.lw = it.lw);
      const cap = it.cap === "butt" ? "0 J" : "1 J";
      if (gs.cap !== cap) out.push(cap), (gs.cap = cap);
      pathOps(it.cmds, out);
      // navazující tahy stejného stylu jednou cestou
      let j = i + 1;
      while (j < items.length) {
        const n = items[j];
        if (n.k !== "stroke" || n.lw !== it.lw || n.cap !== it.cap || col(n.color) !== sc) break;
        pathOps(n.cmds, out);
        j++;
      }
      i = j - 1;
      out.push("S");
    } else if (it.k === "fill") {
      const fc = col(it.color);
      if (gs.fill !== fc) out.push(`${fc} rg`), (gs.fill = fc);
      pathOps(it.cmds, out);
      out.push("f*");
    } else if (it.k === "clip") {
      stack.push({ ...gs });
      out.push("q");
      it.poly.forEach((q, k) => out.push(`${pn(q[0])} ${pn(q[1])} ${k ? "l" : "m"}`));
      out.push("h W n");
    } else if (it.k === "unclip") {
      out.push("Q");
      gs = stack.pop() ?? { stroke: "", fill: "", lw: -1, cap: "" };
    } else if (it.k === "text") {
      const fc = col(it.color);
      if (gs.fill !== fc) out.push(`${fc} rg`), (gs.fill = fc);
      const cap = font ? font.capHeight / font.unitsPerEm : 0.718;
      const fs = it.h / cap;
      const m = [it.x[0] * fs, it.x[1] * fs, it.y[0] * fs, it.y[1] * fs, it.p[0], it.p[1]].map(pn).join(" ");
      let str: string;
      if (font) {
        let hex = "";
        for (const ch of it.s) {
          const cp = ch.codePointAt(0)!;
          const g = font.glyph(cp);
          if (!used.has(g)) used.set(g, cp);
          hex += g.toString(16).padStart(4, "0");
        }
        str = `<${hex}>`;
      } else str = latin(it.s);
      out.push(`BT /F1 1 Tf ${m} Tm ${str} Tj ET`);
    }
  }
  while (stack.length) {
    stack.pop();
    out.push("Q");
  }
  out.push("Q");
  return out.join("\n");
}

function toUnicodeCMap(used: Map<number, number>): string {
  const lines = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap", "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"];
  const entries = [...used.entries()].filter(([g]) => g > 0);
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [g, cp] of chunk) {
      let u: string;
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        u = (0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
      } else u = cp.toString(16).padStart(4, "0");
      lines.push(`<${g.toString(16).padStart(4, "0")}> <${u}>`);
    }
    lines.push("endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return lines.join("\n");
}

export type PdfOpts = { title?: string; font?: TtfFont | null; compress?: boolean };

/** Stránky tisku → PDF (bajty). Každá stránka má svůj formát (MediaBox v pt přesně podle mm). */
export async function pagesToPdf(pages: PlotPage[], opts: PdfOpts = {}): Promise<Uint8Array> {
  const font = opts.font === undefined ? await loadPdfFont() : opts.font;
  const compress = opts.compress !== false;
  const objs: (Uint8Array | null)[] = [null]; // 1-based
  const add = (o: Uint8Array | string | null): number => {
    objs.push(typeof o === "string" ? enc.encode(o) : o);
    return objs.length - 1;
  };
  const set = (i: number, o: Uint8Array | string) => void (objs[i] = typeof o === "string" ? enc.encode(o) : o);
  const stream = async (dict: string, data: Uint8Array, extra = ""): Promise<Uint8Array> => {
    const z = compress ? await deflate(data) : null;
    const body = z ?? data;
    const head = enc.encode(`<< ${[dict, extra.trim(), `/Length ${body.length}`, z ? "/Filter /FlateDecode" : ""].filter(Boolean).join(" ")} >>\nstream\n`);
    const tail = enc.encode("\nendstream");
    const o = new Uint8Array(head.length + body.length + tail.length);
    o.set(head, 0);
    o.set(body, head.length);
    o.set(tail, head.length + body.length);
    return o;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const fontObj = add(null);
  const used = new Map<number, number>();
  const kids: number[] = [];
  for (const p of pages) {
    const content = enc.encode(pageContent(p, font, used));
    const cId = add(await stream("", content));
    const pid = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pn(p.w * PT)} ${pn(p.h * PT)}] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${cId} 0 R >>`);
    kids.push(pid);
  }
  set(pagesObj, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  set(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  if (font) {
    const k = 1000 / font.unitsPerEm;
    const fname = font.name || "Roboto-Regular";
    const ff = add(await stream("", font.bytes, ` /Length1 ${font.bytes.length}`));
    const fd = add(`<< /Type /FontDescriptor /FontName /${fname} /Flags 32 /FontBBox [${font.bbox.map((v) => Math.round(v * k)).join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(font.ascent * k)} /Descent ${Math.round(font.descent * k)} /CapHeight ${Math.round(font.capHeight * k)} /StemV 80 /FontFile2 ${ff} 0 R >>`);
    const gids = [...used.keys()].sort((a, b) => a - b);
    const w = gids.map((g) => `${g} [${Math.round(font.advance(g) * k)}]`).join(" ");
    const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fname} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /DW ${Math.round(font.advance(0) * k)} /W [${w}] /CIDToGIDMap /Identity >>`);
    const tu = add(await stream("", enc.encode(toUnicodeCMap(used))));
    set(fontObj, `<< /Type /Font /Subtype /Type0 /BaseFont /${fname} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
  } else set(fontObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${pdfText(opts.title ?? "Výkres")} /Creator ${pdfText("Mnástrojárna CAD")} /Producer ${pdfText("Mnástrojárna CAD 2D")} >>`);
  // sestavení souboru s tabulkou xref
  const parts: Uint8Array[] = [enc.encode("%PDF-1.7\n%âãÏÓ\n")];
  let off = parts[0].length;
  const offsets: number[] = [0];
  for (let i = 1; i < objs.length; i++) {
    offsets.push(off);
    const head = enc.encode(`${i} 0 obj\n`);
    const body = objs[i] ?? enc.encode("null");
    const tail = enc.encode("\nendobj\n");
    parts.push(head, body, tail);
    off += head.length + body.length + tail.length;
  }
  const xref = [`xref\n0 ${objs.length}\n0000000000 65535 f \n`, ...offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const o = new Uint8Array(total);
  let k = 0;
  for (const p of parts) {
    o.set(p, k);
    k += p.length;
  }
  return o;
}

/** pomocná: čtení obsahu stránek nekomprimovaného PDF (testy) – vrací text operátorů */
export function pdfStreams(pdf: Uint8Array): string[] {
  const s = new TextDecoder("latin1").decode(pdf);
  const out: string[] = [];
  const re = /stream\n([\s\S]*?)\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

export type { PlotItem };

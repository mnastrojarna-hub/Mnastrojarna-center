/**
 * Společné pomůcky převodu 2D model ⇄ DWG / DXF (bez závislosti na acad-ts – používá je i vlastní zapisovač R12).
 */
import { hexRgb } from "../colors";
import type { DraftColor, DraftEntity, DraftLw, TextHAlign, TextVAlign, Vec2 } from "../model";
import { snapLineweight } from "../model";

export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const norm360 = (a: number) => {
  const r = ((a % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-10 ? 0 : r;
};
export const unitV = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** zarovnání textu DXF (72 vodorovně, 73 svisle) */
export const H_ALIGN: TextHAlign[] = ["left", "center", "right", "aligned", "middle", "fit"];
export const V_ALIGN: TextVAlign[] = ["baseline", "bottom", "middle", "top"];

/** barva modelu → ACI (pro R12 a náhradní hodnoty): ByLayer 256, ByBlock 0, pravá barva → nejbližší ACI */
export function aciOf(c: DraftColor | undefined, approx: (rgb: [number, number, number]) => number): number {
  if (c === undefined || c === "ByLayer") return 256;
  if (c === "ByBlock") return 0;
  if (typeof c === "number") return c;
  const rgb = hexRgb(c);
  return rgb ? approx(rgb) : 256;
}

/** tloušťka modelu → kód DXF 370 (setiny mm, -1 ByLayer, -2 ByBlock, -3 Default) */
export function lwCode(lw: DraftLw | undefined): number {
  if (lw === undefined || lw === "ByLayer") return -1;
  if (lw === "ByBlock") return -2;
  if (lw === "Default") return -3;
  return Math.round(snapLineweight(lw) * 100);
}

/** \U+XXXX a %%d / %%c / %%p (stupeň, průměr, ±) – text TEXT / ATTRIB */
export const decodeText = (s: string) =>
  s
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[dD]/g, "°")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[pP]/g, "±")
    .replace(/%%%/g, "%");
/** \U+XXXX v MTEXT (formátovací kódy zůstávají) */
export const decodeMText = (s: string) => s.replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

/**
 * znak jako \U+XXXX (vždy 4 šestnáctkové číslice – čtečky víc nečtou); znak mimo základní rovinu Unicode (emoji…)
 * jako dvojice náhradních kódů UTF-16 (\U+D83D\U+DE00), čtení je zase spojí
 */
export function uEsc(cp: number): string {
  const one = (u: number) => `\\U+${u.toString(16).toUpperCase().padStart(4, "0")}`;
  if (cp <= 0xffff) return one(cp);
  const v = cp - 0x10000;
  return one(0xd800 + (v >> 10)) + one(0xdc00 + (v & 0x3ff));
}
/** znaky mimo ASCII jako \U+XXXX (DXF/DWG před R2007) */
export const encodeU = (s: string) => s.replace(/[^\x00-\x7e]/gu, (ch) => uEsc(ch.codePointAt(0)!));

/**
 * Otisk geometrie entity (bez id, vlastností a ext) – údaje v `ext` (původní hrany šrafy, blok kóty…) platí,
 * jen dokud se otisk nezmění (entitu mezitím někdo upravil).
 */
export function geomKey(e: DraftEntity): string {
  const o = e as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (k === "id" || k === "ext" || k === "layer" || k === "color" || k === "linetype" || k === "lineweight" || k === "ltscale" || k === "transparency") continue;
    parts.push(k + "=" + JSON.stringify(o[k], (_k, v) => (typeof v === "number" ? +v.toPrecision(12) : v)));
  }
  let h = 2166136261;
  const s = parts.join(";");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

/** řetězec do kousků max. `n` znaků (XDATA 1000 má limit 255 bajtů) */
export function chunks(s: string, n = 240): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [""];
}

/** název XDATA aplikace pro vlastní údaje Mnástrojárna CAD (id entity, údaje bez obdoby v DXF) */
export const MNCAD_APP = "MNCAD";

/** obsah MTEXT bez formátovacích kódů (náhrada MTEXT → TEXT pro R12 a hledání) */
export function mtextPlain(s: string): string[] {
  let t = s.replace(/\\[Pp]/g, "\n").replace(/\\~/g, " ");
  t = t.replace(/\\S([^;]*?)[#^/]([^;]*?);/g, "$1/$2");
  t = t.replace(/\\[ACFHQTWfacfhqtw][^;\\{}]*;/g, "").replace(/\\[LlOoKkNX]/g, "");
  t = t.replace(/\\([\\{}])/g, "\u0001$1").replace(/[{}]/g, "").replace(/\u0001/g, "");
  return decodeText(t).split("\n");
}

/** tabulka windows-1250 (čeština) – znak → bajt 0x80–0xFF */
let cp1250: Map<number, number> | null = null;
export function cp1250Map(): Map<number, number> {
  if (cp1250) return cp1250;
  cp1250 = new Map();
  try {
    const dec = new TextDecoder("windows-1250");
    for (let b = 0x80; b <= 0xff; b++) {
      const ch = dec.decode(new Uint8Array([b]));
      if (ch && ch !== "\ufffd") cp1250.set(ch.charCodeAt(0), b);
    }
  } catch {
    /* bez dekodéru – vše mimo ASCII jako \U+ */
  }
  return cp1250;
}
/** znaky, které cp1250 nemá, jako \U+XXXX (DWG / binární DXF před R2007 – čeština zůstane přímo) */
export const encodeNonCp1250 = (s: string) => {
  const map = cp1250Map();
  return s.replace(/[^\x00-\x7f]/gu, (ch) => (map.has(ch.codePointAt(0)!) ? ch : uEsc(ch.codePointAt(0)!)));
};

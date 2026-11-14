/**
 * Zobrazený text kóty (MTEXT z anonymního bloku *D, text kóty, text převzatý z PDF) → hodnota, tolerance, uložení,
 * závit, sražení, počet, příznak průměru / poloměru / informativní kóty. Používá import DWG / DXF (kontrola „text
 * kóty = geometrie“) i knihovna předloh (cad/reference).
 */

/** MTEXT / TEXT → prostý text: formátovací kódy pryč, zlomky \S a^b; → {a|b}, %%c / \U+2205 → Ø, %%d → °, %%p → ± */
export function dimPlain(raw: string): string {
  let s = String(raw ?? "");
  s = s.replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\S([^;]*?)([\^/#])([^;]*);/g, (_, a, _sep, b) => ` \u0001${String(a).trim()}|${String(b).trim()}\u0002 `);
  s = s.replace(/\\[ACcFfHhQqTtWw][^;\\]*;/g, "");
  s = s.replace(/\\[PpXx]/g, " ").replace(/\\[LlOoKk]/g, "").replace(/\\~/g, " ");
  s = s.replace(/[{}]/g, "").replace(/\u0001/g, "{").replace(/\u0002/g, "}");
  s = s.replace(/%%c/gi, "Ø").replace(/%%d/gi, "°").replace(/%%p/gi, "±").replace(/[∅⌀]/g, "Ø");
  return s.replace(/\s+/g, " ").trim();
}

export type DimTextInfo = {
  /** prostý text */
  text: string;
  /** hlavní číslo (s desetinnou tečkou) */
  value?: number;
  /** počet desetinných míst hlavního čísla */
  decimals?: number;
  /** horní / dolní úchylka (mm) */
  tol?: { upper: number; lower: number };
  /** uložení ISO 286 (H7, m6, H7/g6) */
  fit?: string;
  /** informativní (pomocná) kóta v závorce */
  reference?: boolean;
  dia?: boolean;
  radius?: boolean;
  /** závit (M8, M10x1) */
  thread?: string;
  /** sražení: velikost × úhel */
  chamfer?: { size: number; angle: number };
  /** počet („4x Ø8“, „2*“) */
  count?: number;
};

const NUM = /[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)/;
const toN = (s: string) => parseFloat(s.replace(",", "."));
const decOf = (s: string) => (/[.,](\d+)/.exec(s)?.[1] ?? "").length;

/** rozbor zobrazeného textu kóty */
export function parseDimText(raw: string): DimTextInfo {
  const text = dimPlain(raw);
  const out: DimTextInfo = { text };
  let s = text;
  const stack = /\{\s*([+-]?[\d.,]+)\s*\|\s*([+-]?[\d.,]+)\s*\}/.exec(s);
  if (stack) {
    const a = toN(stack[1]);
    const b = toN(stack[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) out.tol = { upper: Math.max(a, b), lower: Math.min(a, b) };
    s = s.replace(stack[0], " ").trim();
  }
  const par = /^\(([^()]*)\)(.*)$/.exec(s);
  if (par) {
    out.reference = true;
    s = `${par[1]} ${par[2]}`.trim();
  }
  const ch = /^(?:(\d+)\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*°/.exec(s);
  if (ch) {
    if (ch[1]) out.count = Number(ch[1]);
    out.chamfer = { size: toN(ch[2]), angle: toN(ch[3]) };
    out.value = toN(ch[2]);
    out.decimals = decOf(ch[2]);
    return out;
  }
  const cnt = /^(\d+)\s*[x×*]\s*(?=[ØMR]|\d)/i.exec(s);
  if (cnt && !/^\d+\s*[x×*]\s*\d+(?:[.,]\d+)?\s*$/.test(s)) {
    out.count = Number(cnt[1]);
    s = s.slice(cnt[0].length);
  }
  if (/Ø/.test(s)) out.dia = true;
  const th = /^(?:Ø\s*)?M\s*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?/.exec(s);
  if (th) {
    out.thread = `M${th[1].replace(",", ".")}${th[2] ? `x${th[2].replace(",", ".")}` : ""}`;
    out.value = toN(th[1]);
    out.decimals = decOf(th[1]);
    return out;
  }
  if (/^R\s*\d/i.test(s)) out.radius = true;
  const body = s.replace(/^[ØR]\s*/i, "");
  const m = NUM.exec(body);
  if (!m) return out;
  out.value = toN(m[0]);
  out.decimals = decOf(m[0]);
  const rest = body.slice((m.index ?? 0) + m[0].length).trim();
  if (!out.tol) {
    const pm = /^±\s*([\d.,]+)/.exec(rest);
    const one = /^([+-]\s*[\d.,]+)(?:\s+([+-]\s*[\d.,]+))?/.exec(rest);
    if (pm) out.tol = { upper: toN(pm[1]), lower: -toN(pm[1]) };
    else if (one) {
      const a = toN(one[1].replace(/\s+/g, ""));
      const b = one[2] ? toN(one[2].replace(/\s+/g, "")) : 0;
      out.tol = { upper: Math.max(a, b), lower: Math.min(a, b) };
    }
  }
  const fit = /^([A-HJKMNP-Za-hjkmnp-z]{1,2}\d{1,2}(?:\s*\/\s*[a-z]{1,2}\d{1,2})?)\b/.exec(rest);
  if (fit) out.fit = fit[1].replace(/\s+/g, "");
  return out;
}

/** výsledek kontroly zobrazeného čísla proti změřené hodnotě */
export type DimTextCheck = "ok" | "rounded" | "mismatch" | "none";

/**
 * Zobrazené číslo vs. hodnota geometrie: „mismatch“ = rozdíl větší než polovina posledního zobrazeného místa (text lže),
 * „rounded“ = text je zaokrouhlený (geometrie má víc desetinných míst), „none“ = text bez čísla (M8, literál).
 */
export function checkDimText(info: DimTextInfo, measured: number): DimTextCheck {
  if (info.value === undefined || !Number.isFinite(measured) || info.thread) return "none";
  const d = Math.abs(info.value - Math.abs(measured));
  const half = 0.5 * Math.pow(10, -(info.decimals ?? 0)) + 1e-9;
  if (d > half) return "mismatch";
  return d > 1e-6 ? "rounded" : "ok";
}

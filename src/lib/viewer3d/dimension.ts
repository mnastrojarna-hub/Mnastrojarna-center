/**
 * Kóty (DIMENSION) společné pro DXF i DWG: hodnota kóty, když ji výkres nenese jako text.
 *
 * Číslo kóty je ve výkresu normálně text (TEXT / MTEXT) v anonymním bloku *D…, který kreslí
 * celou kótu. V praxi ale text často chybí nebo je nečitelný — exportér blok nevytvořil (kóta
 * bez bloku), text v bloku je prázdný / jen formátování / zástupný „<>", výška textu je 0 (= „podle
 * stylu"), nebo LibreDWG text MTEXT nepřečte. Pak se hodnota spočítá z kóty samotné: naměřená
 * hodnota (kód 42), jinak z definičních bodů (13/14/10 délka, úhel, Ø / R, kóta souřadnic),
 * zformátuje se podle stylu kót (DIMDEC, DIMLFAC, DIMPOST, tolerance) a umístí do středu textu
 * kóty (kód 11) ve směru kóty.
 *
 * Desetinný oddělovač: jako ve zbytku výkresu (texty kót, které výkres má), jinak čárka.
 */
import type { Pt } from "./drawing2d";

/** Proměnné stylu kót, které ovlivní text (DIMSTYLE / hlavička $DIM… / přepis v XDATA). */
export interface DimStyle {
  /** DIMDEC — počet desetinných míst délkových kót. */
  dec?: number;
  /** DIMADEC — desetinná místa úhlových kót (−1 = jako DIMDEC). */
  adec?: number;
  /** DIMSCALE — celkové měřítko kót (0 = 1). */
  scale?: number;
  /** DIMTXT — výška textu kóty (před DIMSCALE). */
  txt?: number;
  /** DIMLFAC — měřítko délkových hodnot. */
  lfac?: number;
  /** DIMPOST — předpona / přípona („<> mm"). */
  post?: string;
  /** DIMTOL + DIMTP / DIMTM — tolerance za hodnotou. */
  tol?: boolean;
  tp?: number;
  tm?: number;
  /** DIMTDEC — desetinná místa tolerance. */
  tdec?: number;
  /** DIMASZ — velikost šipky (náhradní kresba kóty bez bloku). */
  asz?: number;
}

/** Spojí styly zleva doprava — pozdější hodnoty (přepis kóty) mají přednost. */
export function mergeDimStyle(...styles: (DimStyle | null | undefined)[]): DimStyle {
  const out: DimStyle = {};
  for (const s of styles) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s) as [keyof DimStyle, DimStyle[keyof DimStyle]][]) {
      if (v !== undefined && v !== null && !(typeof v === "number" && !Number.isFinite(v))) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Druh kóty z kódu 70 (bity 32/64/128 jsou příznaky). */
export type DimKind = "linear" | "aligned" | "angular" | "diameter" | "radius" | "ordinate";

export function dimKind(type: number): DimKind {
  switch ((Number(type) || 0) & 7) {
    case 1: return "aligned";
    case 2:
    case 5: return "angular";
    case 3: return "diameter";
    case 4: return "radius";
    case 6: return "ordinate";
    default: return "linear";
  }
}

/** Kóta v lokálních souřadnicích (bloku / modelu) — body podle kódů DXF. */
export interface DimDef {
  /** Kód 70 (typ + příznaky). */
  type: number;
  /** 10 definiční bod (poloha kótovací čáry / střed u R / protilehlý bod u Ø / počátek u kóty souřadnic). */
  p10?: Pt | null;
  /** 11 střed textu. */
  p11?: Pt | null;
  /** 13 / 14 definiční body (počátky vynášecích čar, u úhlové body ramen). */
  p13?: Pt | null;
  p14?: Pt | null;
  /** 15 bod na kružnici (Ø / R), vrchol úhlové kóty 3 body. */
  p15?: Pt | null;
  /** 16 bod oblouku úhlové kóty. */
  p16?: Pt | null;
  /** 50 natočení otočené kóty (radiány); null = dopočítat z bodů. */
  angle?: number | null;
  /** 53 natočení textu (radiány); null = ve směru kóty. */
  textRotation?: number | null;
  /** 42 naměřená hodnota (délka v jednotkách výkresu / úhel v radiánech). */
  measurement?: number | null;
  /** 1 text zadaný uživatelem („<>" = hodnota, „ " = bez textu). */
  text?: string | null;
}

const TAU = Math.PI * 2;
const ok = (p: Pt | null | undefined): p is Pt => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (v: Pt) => Math.hypot(v[0], v[1]);

/** Směr kótovací čáry délkové kóty (radiány) — z kódu 50, jinak kolmo na 14 → 10. */
export function linearDirection(d: DimDef): number | null {
  const kind = dimKind(d.type);
  if (kind === "aligned" && ok(d.p13) && ok(d.p14) && len(sub(d.p14, d.p13)) > 0) {
    const v = sub(d.p14, d.p13);
    return Math.atan2(v[1], v[0]);
  }
  if (kind !== "linear" && kind !== "aligned") return null;
  if (typeof d.angle === "number" && Number.isFinite(d.angle) && d.angle !== 0) return d.angle;
  // kótovací čára jde bodem 10 kolmo na vynášecí čáru z bodu 14
  if (ok(d.p10) && ok(d.p14)) {
    const v = sub(d.p10, d.p14);
    if (len(v) > 1e-12) return Math.atan2(v[1], v[0]) - Math.PI / 2;
  }
  return typeof d.angle === "number" && Number.isFinite(d.angle) ? d.angle : 0;
}

/** Úhel mezi vektory (0 – π). */
function angleBetween(a: Pt, b: Pt): number | null {
  const la = len(a);
  const lb = len(b);
  if (!(la > 0) || !(lb > 0)) return null;
  const c = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

/** Průsečík přímek a1–a2 a b1–b2 (null = rovnoběžné). */
function intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d1 = sub(a2, a1);
  const d2 = sub(b2, b1);
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / den;
  return [a1[0] + d1[0] * t, a1[1] + d1[1] * t];
}

/**
 * Hodnota kóty: naměřená (42), jinak z definičních bodů. Délka v jednotkách výkresu, úhel v radiánech.
 * null = nejde určit.
 */
export function measureDim(d: DimDef): number | null {
  if (typeof d.measurement === "number" && Number.isFinite(d.measurement) && (d.measurement !== 0 || !hasGeometry(d))) return d.measurement;
  const kind = dimKind(d.type);
  switch (kind) {
    case "linear":
    case "aligned": {
      if (!ok(d.p13) || !ok(d.p14)) return null;
      const v = sub(d.p14, d.p13);
      if (kind === "aligned") return len(v);
      const a = linearDirection(d) ?? 0;
      return Math.abs(v[0] * Math.cos(a) + v[1] * Math.sin(a));
    }
    case "diameter":
      return ok(d.p10) && ok(d.p15) ? len(sub(d.p15, d.p10)) : null;
    case "radius":
      return ok(d.p10) && ok(d.p15) ? len(sub(d.p15, d.p10)) : null;
    case "angular": {
      if (((d.type & 7) === 5) && ok(d.p13) && ok(d.p14) && ok(d.p15)) return angleBetween(sub(d.p13, d.p15), sub(d.p14, d.p15));
      // 2 přímky: 13–14 a 10–15, oblouk bodem 16
      if (ok(d.p13) && ok(d.p14) && ok(d.p10) && ok(d.p15)) {
        const c = intersect(d.p13, d.p14, d.p15, d.p10);
        if (!c) return null;
        const far = (p: Pt, q: Pt) => (len(sub(p, c)) >= len(sub(q, c)) ? p : q);
        let a = angleBetween(sub(far(d.p13, d.p14), c), sub(far(d.p10, d.p15), c));
        if (a === null) return null;
        // oblouk na opačné straně vrcholu → doplňkový úhel
        if (ok(d.p16)) {
          const m = sub(d.p16, c);
          const u = sub(far(d.p13, d.p14), c);
          const w = sub(far(d.p10, d.p15), c);
          const au = angleBetween(m, u) ?? 0;
          const aw = angleBetween(m, w) ?? 0;
          if (Math.abs(au + aw - a) > 1e-6) a = Math.PI - a;
        }
        return a;
      }
      return null;
    }
    case "ordinate": {
      if (!ok(d.p13)) return null;
      const o = ok(d.p10) ? d.p10 : ([0, 0] as Pt);
      return (d.type & 64) !== 0 ? Math.abs(d.p13[0] - o[0]) : Math.abs(d.p13[1] - o[1]);
    }
  }
}

function hasGeometry(d: DimDef): boolean {
  return ok(d.p13) || ok(d.p14) || ok(d.p15);
}

/** Číslo s `decimals` desetinnými místy, bez nul na konci, s oddělovačem `sep`. */
export function formatDimNumber(v: number, decimals: number, sep: string): string {
  const dec = Math.max(0, Math.min(8, Math.round(Number.isFinite(decimals) ? decimals : 2)));
  let s = (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (/^-0(\.0*)?$/.test(s)) s = "0";
  return s.replace(".", sep);
}

/** Text hodnoty kóty (bez uživatelského textu): Ø / R / °, DIMPOST, tolerance. */
export function dimValueText(d: DimDef, style: DimStyle, sep: string): string | null {
  const value = measureDim(d);
  if (value === null || !Number.isFinite(value)) return null;
  const kind = dimKind(d.type);
  const dec = style.dec ?? 2;
  let text: string;
  if (kind === "angular") {
    const adec = style.adec !== undefined && style.adec >= 0 ? style.adec : dec;
    let deg = (value * 180) / Math.PI;
    deg = ((deg % 360) + 360) % 360;
    text = `${formatDimNumber(deg, adec, sep)}°`;
  } else {
    const lfac = style.lfac && Number.isFinite(style.lfac) && style.lfac !== 0 ? Math.abs(style.lfac) : 1;
    let s = formatDimNumber(Math.abs(value) * lfac, dec, sep);
    if (kind === "diameter") s = `Ø${s}`;
    else if (kind === "radius") s = `R${s}`;
    const post = style.post ? style.post.replace(/%%[cC]/g, "Ø").replace(/%%[dD]/g, "°").replace(/%%[pP]/g, "±") : "";
    if (post) s = post.includes("<>") ? post.replace("<>", s) : s + post;
    if (style.tol) {
      const tdec = style.tdec ?? dec;
      const tp = Math.abs(style.tp ?? 0);
      const tm = Math.abs(style.tm ?? 0);
      if (tp > 0 || tm > 0) {
        s += tp === tm
          ? ` ±${formatDimNumber(tp, tdec, sep)}`
          : ` +${formatDimNumber(tp, tdec, sep)}/${tm > 0 ? "−" : ""}${formatDimNumber(tm, tdec, sep)}`;
      }
    }
    text = s;
  }
  return text;
}

/**
 * Text kóty: uživatelský text (kód 1) s „<>" nahrazeným hodnotou, jinak hodnota.
 * null = text potlačený (jedna mezera) nebo nejde určit. Formátovací kódy MTEXT nechává volajícímu.
 */
export function resolveDimText(raw: string | null | undefined, value: string | null): string | null {
  if (raw === " ") return null;
  if (raw && raw.length) {
    if (raw.includes("<>")) return value === null ? raw.replace(/<>/g, "").trim() || null : raw.replace(/<>/g, value);
    return raw;
  }
  return value;
}

/** Desetinný oddělovač podle textů kót výkresu (většina), null = výkres žádné desetinné číslo nemá. */
export function detectDecimalSeparator(texts: Iterable<string>): "," | "." | null {
  let comma = 0;
  let dot = 0;
  for (const t of texts) {
    for (const m of t.matchAll(/\d([.,])\d/g)) {
      if (m[1] === ",") comma++;
      else dot++;
    }
  }
  if (!comma && !dot) return null;
  return comma >= dot ? "," : ".";
}

/** Čitelný směr textu (nikdy vzhůru nohama): úhel v (−90°, 90°]. */
export function readableAngle(a: number): number {
  let r = ((a % TAU) + TAU) % TAU;
  if (r > Math.PI / 2 + 1e-9 && r <= (3 * Math.PI) / 2 + 1e-9) r -= Math.PI;
  if (r > Math.PI) r -= TAU;
  return r;
}

/** Poloha a směr textu kóty (lokálně): střed textu (11), jinak střed kótovací čáry / bod 15. */
export function dimTextFrame(d: DimDef): { p: Pt; rotation: number } | null {
  const kind = dimKind(d.type);
  let rotation = 0;
  if (kind === "linear" || kind === "aligned") rotation = readableAngle(linearDirection(d) ?? 0);
  if (typeof d.textRotation === "number" && Number.isFinite(d.textRotation) && d.textRotation !== 0) rotation = d.textRotation;
  if (ok(d.p11)) return { p: d.p11, rotation };
  const line = dimLineEnds(d);
  if (line) return { p: [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2], rotation };
  if (ok(d.p15)) return { p: d.p15, rotation };
  if (ok(d.p14)) return { p: d.p14, rotation };
  if (ok(d.p10)) return { p: d.p10, rotation };
  return null;
}

/** Konce kótovací čáry délkové kóty (paty vynášecích čar na přímce bodem 10). */
function dimLineEnds(d: DimDef): [Pt, Pt] | null {
  const kind = dimKind(d.type);
  if ((kind !== "linear" && kind !== "aligned") || !ok(d.p13) || !ok(d.p14)) return null;
  const a = linearDirection(d) ?? 0;
  const u: Pt = [Math.cos(a), Math.sin(a)];
  const base = ok(d.p10) ? d.p10 : d.p14;
  const foot = (p: Pt): Pt => {
    const t = (p[0] - base[0]) * u[0] + (p[1] - base[1]) * u[1];
    return [base[0] + u[0] * t, base[1] + u[1] * t];
  };
  return [foot(d.p13), foot(d.p14)];
}

/** Primitiva náhradní kresby kóty (lokálně). */
export type DimPrimitive =
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "polyline"; points: Pt[]; closed: boolean }
  | { kind: "arc"; c: Pt; r: number; start: number; end: number };

/** Plná šipka s hrotem v `tip` směřující ve směru `dir` (radiány). */
function arrow(tip: Pt, dir: number, size: number): DimPrimitive {
  const back = dir + Math.PI;
  const w = Math.PI / 12;
  return {
    kind: "polyline",
    closed: true,
    points: [tip, [tip[0] + size * Math.cos(back - w), tip[1] + size * Math.sin(back - w)], [tip[0] + size * Math.cos(back + w), tip[1] + size * Math.sin(back + w)]],
  };
}

/**
 * Kresba kóty, když výkres nemá její blok (exportéry bez anonymních bloků *D…): vynášecí a kótovací
 * čára se šipkami, u Ø / R čára ke kružnici, u úhlové oblouk, u kóty souřadnic odkazová čára.
 */
export function dimFallbackGeometry(d: DimDef, style: DimStyle): DimPrimitive[] {
  const kind = dimKind(d.type);
  const scale = style.scale && style.scale > 0 ? style.scale : 1;
  const size = (style.asz && style.asz > 0 ? style.asz : 2.5) * scale;
  const out: DimPrimitive[] = [];
  if (kind === "linear" || kind === "aligned") {
    const ends = dimLineEnds(d);
    if (!ends || !ok(d.p13) || !ok(d.p14)) return out;
    const [f1, f2] = ends;
    if (len(sub(f1, d.p13)) > 1e-9) out.push({ kind: "line", a: d.p13, b: f1 });
    if (len(sub(f2, d.p14)) > 1e-9) out.push({ kind: "line", a: d.p14, b: f2 });
    if (len(sub(f2, f1)) > 1e-9) {
      out.push({ kind: "line", a: f1, b: f2 });
      const dir = Math.atan2(f2[1] - f1[1], f2[0] - f1[0]);
      out.push(arrow(f1, dir + Math.PI, size), arrow(f2, dir, size));
    }
    return out;
  }
  if (kind === "radius" || kind === "diameter") {
    if (!ok(d.p10) || !ok(d.p15)) return out;
    out.push({ kind: "line", a: d.p10, b: d.p15 });
    const dir = Math.atan2(d.p15[1] - d.p10[1], d.p15[0] - d.p10[0]);
    out.push(arrow(d.p15, dir, size));
    if (kind === "diameter") out.push(arrow(d.p10, dir + Math.PI, size));
    return out;
  }
  if (kind === "angular") {
    let c: Pt | null = null;
    let p1: Pt | null = null;
    let p2: Pt | null = null;
    let at: Pt | null = null;
    if ((d.type & 7) === 5 && ok(d.p15) && ok(d.p13) && ok(d.p14)) {
      c = d.p15;
      p1 = d.p13;
      p2 = d.p14;
      at = ok(d.p10) ? d.p10 : null;
    } else if (ok(d.p13) && ok(d.p14) && ok(d.p10) && ok(d.p15)) {
      c = intersect(d.p13, d.p14, d.p15, d.p10);
      p1 = d.p14;
      p2 = d.p10;
      at = ok(d.p16) ? d.p16 : null;
    }
    if (!c || !p1 || !p2) return out;
    const r = at ? len(sub(at, c)) : Math.min(len(sub(p1, c)), len(sub(p2, c)));
    if (!(r > 0)) return out;
    let a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    let sweep = ((a1 - a0) % TAU + TAU) % TAU;
    if (sweep > Math.PI) {
      [a0, a1] = [a1, a0];
      sweep = TAU - sweep;
    }
    out.push({ kind: "arc", c, r, start: a0, end: a1 });
    return out;
  }
  // kóta souřadnic: odkazová čára od prvku ke konci
  if (ok(d.p13) && ok(d.p14)) out.push({ kind: "line", a: d.p13, b: d.p14 });
  return out;
}

/** Výška textu kóty (lokálně): DIMTXT × DIMSCALE, výchozí 2,5. */
export function dimTextHeight(style: DimStyle): number {
  const scale = style.scale && style.scale > 0 ? style.scale : 1;
  const txt = style.txt && style.txt > 0 ? style.txt : 2.5;
  return txt * scale;
}

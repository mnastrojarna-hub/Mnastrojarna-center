/**
 * Objekty AutoCAD Mechanical (STDPART2D, ACMPARTLIST, ACMBALLOON, ACMSURFSYM, ACMFCFRAME, ACMDATUMID,
 * AMDTSECTIONSYM…) a jiné vlastní třídy, které acad-ts čte jen jako „neznámé entity“ s náhradní grafikou (proxy
 * graphics). Převod náhradní grafiky na běžné 2D entity (kružnice, oblouky, křivky, plné plochy, texty) a čtení
 * čitelných řetězců z dat třídy (označení normálie, cesta databáze /AMSTD/…, atributy kusovníku).
 *
 * acad-ts vrací texty náhradní grafiky (typy 10, 11, 36, 38) jen jako syrové bajty – dekodér je tady:
 * Text2 = počátek 3×f64, normála 3×f64, směr 3×f64, řetězec ukončený NUL zarovnaný na 4 bajty (kódová stránka výkresu),
 * int32 délka, int32 příznak, f64 výška, šířka, sklon, prostrkání, 5×int32 příznaků, písmo a velké písmo.
 */
import { snapLineweight, type DraftLw, type NewEntity, type Vec2 } from "../model";
import { decodeText } from "./common";

/** záznam náhradní grafiky (tvar podle acad-ts ProxyGraphics) */
type PG = { graphicsType: number; [k: string]: unknown };
type XYZ = { x: number; y: number; z: number };
type M4 = { m00: number; m01: number; m02: number; m03: number; m10: number; m11: number; m12: number; m13: number };

/** typy záznamů (acad-ts GraphicsType) */
const G = {
  Extents: 1, Circle: 2, CirclePt3: 3, CircularArc: 4, CircularArc3Pt: 5, Polyline: 6, Polygon: 7, Mesh: 8, Shell: 9, Text: 10, Text2: 11,
  XLine: 12, Ray: 13, SubentColor: 14, SubentLayer: 16, SubentLineType: 18, SubentMarker: 19, SubentFillon: 20, SubentTrueColor: 22,
  SubentLineWeight: 23, PushModelTransform: 29, PushModelTransform2: 30, PopModelTransform: 31, PolylineWithNormal: 32, UnicodeText: 36, UnicodeText2: 38,
} as const;

/** dekodér řetězců podle kódové stránky výkresu ($DWGCODEPAGE: ANSI_1250 → windows-1250) */
export function codePageDecoder(codePage: string | undefined): TextDecoder {
  const m = /(\d{3,4})/.exec(codePage ?? "");
  const cp = m ? `windows-${m[1]}` : "windows-1252";
  try {
    return new TextDecoder(cp);
  } catch {
    return new TextDecoder("windows-1252");
  }
}

/** řetězec ukončený NUL od `pos`, zarovnaný na 4 bajty → [text, další poloha] */
function padStr(u8: Uint8Array, pos: number, dec: TextDecoder, wide: boolean): [string, number] {
  let end = pos;
  if (wide) {
    while (end + 1 < u8.length && (u8[end] !== 0 || u8[end + 1] !== 0)) end += 2;
    const s = new TextDecoder("utf-16le").decode(u8.subarray(pos, end));
    return [s, pos + ((end - pos + 2 + 3) & ~3)];
  }
  while (end < u8.length && u8[end] !== 0) end++;
  const s = dec.decode(u8.subarray(pos, end));
  return [s, pos + ((end - pos + 1 + 3) & ~3)];
}

export type ProxyText = { p: [number, number, number]; dir: [number, number, number]; s: string; h: number; wf: number; oblique: number };

/** text náhradní grafiky (typ 10 Text, 11 Text2, 36 UnicodeText, 38 UnicodeText2) ze syrových bajtů záznamu */
export function decodeProxyText(type: number, data: Uint8Array, dec: TextDecoder): ProxyText | null {
  if (data.length < 80) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const d = (o: number) => dv.getFloat64(o, true);
  const p: [number, number, number] = [d(0), d(8), d(16)];
  const dir: [number, number, number] = [d(48), d(56), d(64)];
  const wide = type === G.UnicodeText || type === G.UnicodeText2;
  if (type === G.Text || type === G.UnicodeText) {
    // Text: počátek, normála, směr, výška, šířka, sklon, řetězec
    if (data.length < 100) return null;
    const [s] = padStr(data, 96, dec, wide);
    return { p, dir, s, h: d(72), wf: d(80) || 1, oblique: d(88) };
  }
  // Text2: počátek, normála, směr, řetězec, délka, příznak, výška, šířka, sklon, prostrkání, …
  const [s, pos] = padStr(data, 72, dec, wide);
  if (pos + 40 > data.length) return { p, dir, s, h: 2.5, wf: 1, oblique: 0 };
  const at = pos + 8;
  return { p, dir, s, h: d(at), wf: d(at + 8) || 1, oblique: d(at + 16) };
}

/** pravá barva náhradní grafiky (4 bajty: B, G, R, způsob 0xC2 = RGB, 0xC3 = ACI v nejnižším bajtu) */
function trueColor(data: Uint8Array | undefined): number | string | undefined {
  if (!data || data.length < 4) return undefined;
  const method = data[3];
  if (method === 0xc3) return data[0] >= 1 && data[0] <= 255 ? data[0] : undefined;
  if (method !== 0xc2) return undefined;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(data[2])}${hex(data[1])}${hex(data[0])}`;
}

/** kružnice třemi body (null = body na přímce) */
function circle3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}
const degN = (r: number) => {
  let a = (r * 180) / Math.PI;
  a %= 360;
  if (a < 0) a += 360;
  return Math.abs(a - 360) < 1e-9 ? 0 : a;
};

/**
 * Tabulky výkresu pro vlastnosti podřízených entit náhradní grafiky: SubentLayer a SubentLineType nesou INDEX do
 * tabulky hladin / typů čar výkresu v pořadí tabulky (jako ezdxf ProxyGraphic). Typ čáry 32767 = ByLayer, 32766 = ByBlock.
 */
export type ProxyTables = {
  /** názvy hladin v pořadí tabulky (převedené názvy; neznámá hladina = „0“) */
  layers: readonly string[];
  /** názvy typů čar v pořadí tabulky („Continuous“, „ByBlock“; ByLayer = undefined) */
  linetypes: readonly (string | undefined)[];
};

export type ProxyResult = {
  /** entity bloku (souřadnice výkresu); hladina, typ čáry a tloušťka podle podřízených entit grafiky (bez tabulek hladina 0), barva podle bloku, pokud náhradní grafika barvu neurčila */
  entities: NewEntity[];
  /** texty v pořadí grafiky */
  texts: string[];
  /** záznamy, které se nepřevedly (typ → počet) */
  unknown: Record<string, number>;
};

/**
 * Náhradní grafika objektu → 2D entity. Transformace modelu (Push/PopModelTransform) se použijí, barva podřízených
 * entit (SubentColor / SubentTrueColor), plnění (SubentFillon → plná plocha), hladina (SubentLayer), typ čáry
 * (SubentLineType) a tloušťka čáry (SubentLineWeight) taky – hladina a typ čáry jsou indexy do tabulek výkresu
 * (`tables`). Normálie AutoCAD Mechanical tak mají obrys na AM_0, osy na AM_7, závit na AM_4 a pomocné značky na AM_9
 * – porovnání s modelem a výtah děr je od sebe rozliší.
 */
export function proxyToEntities(geoms: readonly unknown[], dec: TextDecoder, tables?: ProxyTables): ProxyResult {
  const out: NewEntity[] = [];
  const texts: string[] = [];
  const unknown: Record<string, number> = {};
  let color: number | string | undefined;
  let layer: string | undefined;
  let linetype: string | undefined;
  let lineweight: DraftLw | undefined;
  let fill = false;
  let M: M4 | null = null;
  const stack: (M4 | null)[] = [];
  const P = (q: XYZ): Vec2 => (M ? [M.m00 * q.x + M.m01 * q.y + M.m02 * q.z + M.m03, M.m10 * q.x + M.m11 * q.y + M.m12 * q.z + M.m13] : [q.x, q.y]);
  const V = (q: XYZ): Vec2 => (M ? [M.m00 * q.x + M.m01 * q.y + M.m02 * q.z, M.m10 * q.x + M.m11 * q.y + M.m12 * q.z] : [q.x, q.y]);
  const scale = () => (M ? Math.sqrt(Math.abs(M.m00 * M.m11 - M.m01 * M.m10)) || 1 : 1);
  const flipped = () => !!M && M.m00 * M.m11 - M.m01 * M.m10 < 0;
  const props = () => ({ ...(color !== undefined ? { color } : { color: "ByBlock" as const }), ...(linetype ? { linetype } : {}), ...(lineweight !== undefined ? { lineweight } : {}) });
  const push = (e: Record<string, unknown>) => out.push({ layer: layer ?? "0", ...props(), ...e } as unknown as NewEntity);
  for (const g0 of geoms) {
    const g = g0 as PG;
    const t = g.graphicsType;
    switch (t) {
      case G.SubentColor: {
        const v = Number(g.value);
        color = v >= 1 && v <= 255 ? v : undefined;
        break;
      }
      case G.SubentTrueColor:
        color = trueColor(g.data as Uint8Array | undefined) ?? color;
        break;
      case G.SubentFillon:
        fill = Number(g.value) !== 0;
        break;
      case G.SubentLayer: {
        if (!tables) break;
        const i = Number(g.value) | 0;
        layer = i >= 0 && i < tables.layers.length ? tables.layers[i] : undefined;
        break;
      }
      case G.SubentLineType: {
        if (!tables) break;
        const i = Number(g.value) | 0;
        linetype = i === 32767 ? undefined : i === 32766 ? "ByBlock" : i >= 0 && i < tables.linetypes.length ? tables.linetypes[i] : undefined;
        break;
      }
      case G.SubentLineWeight: {
        // int32: −1 ByLayer, −2 ByBlock, −3 výchozí, jinak setiny mm
        const v = Number(g.value) | 0;
        lineweight = v === -1 ? undefined : v === -2 ? "ByBlock" : v < 0 ? "Default" : snapLineweight(v / 100);
        break;
      }
      case G.PushModelTransform:
      case G.PushModelTransform2:
        stack.push(M);
        M = (g.matrix as M4) ?? null;
        break;
      case G.PopModelTransform:
        M = stack.length ? stack.pop()! : null;
        break;
      case G.Circle: {
        const c = g.center as XYZ;
        push({ type: "circle", c: P(c), r: Number(g.radius) * scale() });
        break;
      }
      case G.CirclePt3: {
        const k = circle3(P(g.point1 as XYZ), P(g.point2 as XYZ), P(g.point3 as XYZ));
        if (k) push({ type: "circle", c: k.c, r: k.r });
        break;
      }
      case G.CircularArc: {
        const c = P(g.center as XYZ);
        const sv = V(g.startVectorDirection as XYZ);
        const n = g.normal as XYZ | undefined;
        let sweep = Number(g.sweepAngle) || 0;
        if ((n && n.z < 0) !== flipped()) sweep = -sweep;
        const r = Number(g.radius) * scale();
        if (Math.abs(sweep) >= 2 * Math.PI - 1e-9) {
          push({ type: "circle", c, r });
          break;
        }
        const s0 = Math.atan2(sv[1], sv[0]);
        const [a, b] = sweep >= 0 ? [s0, s0 + sweep] : [s0 + sweep, s0];
        push({ type: "arc", c, r, a0: degN(a), a1: degN(b) });
        break;
      }
      case G.CircularArc3Pt: {
        const p1 = P(g.point1 as XYZ);
        const p2 = P(g.point2 as XYZ);
        const p3 = P(g.point3 as XYZ);
        const k = circle3(p1, p2, p3);
        if (!k) {
          push({ type: "line", a: p1, b: p3 });
          break;
        }
        const ccw = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]) > 0;
        const ang = (q: Vec2) => Math.atan2(q[1] - k.c[1], q[0] - k.c[0]);
        const [a, b] = ccw ? [ang(p1), ang(p3)] : [ang(p3), ang(p1)];
        push({ type: "arc", c: k.c, r: k.r, a0: degN(a), a1: degN(b) });
        break;
      }
      case G.Polyline:
      case G.PolylineWithNormal:
      case G.Polygon: {
        const pts = ((g.points as XYZ[]) ?? []).map(P);
        if (pts.length < 2) break;
        if (t === G.Polygon && fill && pts.length >= 3) push({ type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts, outer: true }], ext: { dxf: "PROXY_FILL" } });
        else if (pts.length === 2 && t !== G.Polygon) push({ type: "line", a: pts[0], b: pts[1] });
        else push({ type: "polyline", pts, ...(t === G.Polygon ? { closed: true } : {}) });
        break;
      }
      case G.Text:
      case G.Text2:
      case G.UnicodeText:
      case G.UnicodeText2: {
        const data = (g.data as Uint8Array | undefined) ?? null;
        const x = data ? decodeProxyText(t, data, dec) : null;
        if (!x || !Number.isFinite(x.p[0]) || !Number.isFinite(x.h)) {
          unknown[`text${t}`] = (unknown[`text${t}`] ?? 0) + 1;
          break;
        }
        const s = decodeText(x.s);
        const p = P({ x: x.p[0], y: x.p[1], z: x.p[2] });
        const dv = V({ x: x.dir[0], y: x.dir[1], z: x.dir[2] });
        const rot = Math.hypot(dv[0], dv[1]) > 1e-12 ? degN(Math.atan2(dv[1], dv[0])) : 0;
        texts.push(s);
        if (!s.trim()) break;
        push({ type: "text", p, h: x.h * scale(), s, ...(rot ? { rot } : {}), ...(Math.abs(x.wf - 1) > 1e-9 && x.wf > 0 ? { wf: x.wf } : {}) });
        break;
      }
      case G.Extents:
      case G.SubentMarker:
      case 24:
      case 25:
      case 26:
      case 34:
      case 35:
      case 27:
      case 28:
        break; // jen stav / ořez / materiál
      default:
        unknown[String(t)] = (unknown[String(t)] ?? 0) + 1;
    }
  }
  return { entities: out, texts, unknown };
}

/**
 * Čitelné řetězce v datech třídy (bitový proud DWG – řetězce nemusí začínat na celém bajtu, proto všech 8 posunů).
 * Vrací řetězce v pořadí výskytu bez opakování (alespoň `min` znaků, aspoň tři písmena nebo číslice za sebou).
 */
export function payloadStrings(u8: Uint8Array, dec: TextDecoder, min = 3): string[] {
  const found: [number, string][] = [];
  const seen = new Set<string>();
  for (let sh = 0; sh < 8; sh++) {
    let run: number[] = [];
    let st = 0;
    const flush = () => {
      if (run.length >= min) {
        const s = dec.decode(Uint8Array.from(run)).trim();
        if (s.length >= min && /[A-Za-z0-9]{3,}|%%[cC]\d/.test(s) && !/[\\@`^{}|~[\]]/.test(s) && !seen.has(s)) {
          seen.add(s);
          found.push([st, s]);
        }
      }
      run = [];
    };
    for (let i = 0; i + 1 < u8.length; i++) {
      const b = ((u8[i] << sh) | (u8[i + 1] >> (8 - sh))) & 0xff;
      if ((b >= 0x20 && b < 0x7f) || b >= 0xc0) {
        if (!run.length) st = i * 8 + sh;
        run.push(b);
      } else flush();
    }
    flush();
  }
  return found.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/** údaje normálie AutoCAD Mechanical (STDPART2D) z řetězců dat třídy */
export type StdPartInfo = {
  /** větev databáze normálií, např. /AMSTD/DIN/FEAT/ITHREAD/THRGH/…/T */
  branch?: string;
  /** norma (DIN, CSN, ISO, SYS…) */
  std?: string;
  /** druh: díra se závitem, vrtání, zahloubení, šroub, kolík… (FEAT/ITHREAD, FEAT/BORE/CNBR, FSTN/SCREW…) */
  type?: string;
  /** pohled: T = shora, F = zepředu, B = zezadu, L / R = zleva / zprava */
  view?: string;
  /** označení („DIN 13 T1 - M8“, „ISO 2338 - 8 m6 x 60 - A“, „%%C8.5“) */
  desig?: string;
};

export function stdPartInfo(strs: readonly string[]): StdPartInfo {
  const out: StdPartInfo = {};
  const br = strs.find((s) => /\/AMSTD\//.test(s));
  if (br) {
    const b = br.replace(/^.*?(\/AMSTD\/)/, "$1").replace(/[^\w/.\- ]+$/, "");
    out.branch = b;
    const parts = b.split("/").filter(Boolean);
    out.std = parts[1];
    out.type = parts.slice(2, 5).join("/");
    const last = parts[parts.length - 1];
    if (/^[TFBLR]$/.test(last)) out.view = last;
  }
  const d = strs.map((s) => s.replace(/^[^A-Z%]+/, "").trim()).find((s) => /^(DIN|CSN|ČSN|ISO|EN|ANSI|JIS|GB)\s?\d|^%%[cC]\s*\d/.test(s) && !/gefmsg|AmRul/i.test(s));
  if (d) out.desig = decodeText(d);
  return out;
}

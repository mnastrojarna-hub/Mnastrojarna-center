/**
 * BALÍK 2 (annot) – kótovací styly (DIMSTYLE): výchozí ISO-25 (jako šablona acadiso.dwt), tabulka `model.dimStyles`,
 * aktuální styl `vars.dimstyle`, přepsání u kóty (`overrides`), formát naměřené hodnoty (DIMDEC, DIMZIN, DIMDSEP,
 * DIMLFAC, DIMRND, DIMPOST, DIMAUNIT/DIMADEC/DIMAZIN) a tolerance (DIMTOL ±, DIMLIM meze, DIMTP/DIMTM, DIMTDEC, DIMTFAC).
 */
import { tr } from "../../i18n";
import type { CmdCtx } from "../commands";
import { parseColor } from "../colors";
import { invalidateGeometry } from "../kinds";
import type { DraftColor, DraftDimStyle, DraftModel } from "../model";
import { evalNumber } from "../units";
import type { DDimension } from "./types";

export const ISO25_NAME = "ISO-25";

/** proměnné stylu s hodnotou (po doplnění výchozích) */
export type DimStyleVars = Required<Omit<DraftDimStyle, "name" | "dimclrd" | "dimclre" | "dimclrt" | "dimlwd" | "dimlwe" | "dimtxsty" | "dimblk" | "dimblk1" | "dimblk2">> &
  Pick<DraftDimStyle, "dimclrd" | "dimclre" | "dimclrt" | "dimlwd" | "dimlwe" | "dimtxsty" | "dimblk" | "dimblk1" | "dimblk2"> & { name: string };

/** ISO-25 (acadiso.dwt): text 2,5, šipka 2,5, přesah 1,25, odsazení 0,625, mezera 0,625, 2 des. místa, čárka, bez koncových nul */
export const ISO25: Omit<DimStyleVars, "name"> = {
  dimscale: 1,
  dimtxt: 2.5,
  dimasz: 2.5,
  dimexe: 1.25,
  dimexo: 0.625,
  dimdli: 3.75,
  dimgap: 0.625,
  dimdec: 2,
  dimadec: 0,
  dimlfac: 1,
  dimtad: 1,
  dimjust: 0,
  dimtih: false,
  dimtoh: false,
  dimtofl: true,
  dimse1: false,
  dimse2: false,
  dimsd1: false,
  dimsd2: false,
  dimpost: "",
  dimzin: 8,
  dimazin: 0,
  dimaunit: 0,
  dimdsep: ",",
  dimtol: false,
  dimlim: false,
  dimtp: 0,
  dimtm: 0,
  dimtfac: 1,
  dimcen: 2.5,
  dimrnd: 0,
  dimtdec: 2,
  dimtzin: 0,
  dimarcsym: 0,
  dimfxl: 1,
  dimfxlon: false,
  dimjogang: 45,
  dimanno: false,
  dimlunit: 2,
};

const clean = (o: object | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== null));
/** ISO-25 se všemi proměnnými (tabulka stylů nesmí spoléhat na skryté výchozí hodnoty – DWG / DXF zapisuje jen uložená pole) */
export const iso25Style = (): DraftDimStyle => ({ name: ISO25_NAME, ...ISO25 });
const DEFAULT_STYLES: DraftDimStyle[] = [iso25Style()];
/** tabulka stylů modelu (bez tabulky = jen ISO-25; stejný objekt – porovnání podle identity) */
export const dimStyles = (m: DraftModel): DraftDimStyle[] => (m.dimStyles?.length ? m.dimStyles : DEFAULT_STYLES);
/** styl doplněný o všechny proměnné (chybějící = ISO-25) */
export const fullDimStyle = (s: DraftDimStyle): DraftDimStyle => ({ ...ISO25, ...clean(s), name: s.name }) as DraftDimStyle;
const ISO_KEYS = Object.keys(ISO25) as (keyof typeof ISO25)[];
const isFull = (s: DraftDimStyle) => ISO_KEYS.every((k) => s[k] !== undefined && s[k] !== null);
/**
 * Zhmotní tabulku kótovacích stylů: model bez tabulky dostane ISO-25 se všemi proměnnými a `vars.dimstyle`, neúplné styly
 * (např. ze starších verzí) se doplní. Volá se při vytvoření kóty / odkazu a při každé změně stylů – export DWG / DXF pak
 * zapíše skutečné hodnoty (DIMTXT 2,5, DIMASZ 2,5, DIMDSEP „,“…) místo palcových výchozích hodnot cílového formátu.
 * Vrací tentýž model, když není co měnit.
 */
/** tabulka kótovacích stylů se všemi proměnnými (jednou za příkaz) – export DWG / DXF zapíše skutečné hodnoty stylu */
export function ensureDimStyles(c: CmdCtx) {
  const cc = c as CmdCtx & { _dsDone?: boolean };
  if (cc._dsDone) return;
  c.tx.setModel(materializeDimStyles);
  cc._dsDone = true;
}
export function materializeDimStyles(m: DraftModel): DraftModel {
  const list = m.dimStyles?.length ? m.dimStyles : null;
  if (list && list.every(isFull) && m.vars.dimstyle && findDimStyle(m, m.vars.dimstyle)) return m;
  const full = (list ?? [iso25Style()]).map((s) => (isFull(s) ? s : fullDimStyle(s)));
  const cur = (m.vars.dimstyle && full.find((s) => s.name.toLowerCase() === m.vars.dimstyle!.toLowerCase())?.name) || full[0].name;
  invalidateGeometry();
  return { ...m, dimStyles: full, vars: { ...m.vars, dimstyle: cur } };
}
export const findDimStyle = (m: DraftModel, name: string): DraftDimStyle | undefined => dimStyles(m).find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
/** aktuální kótovací styl (DIMSTYLE) */
export const currentDimStyle = (m: DraftModel): string => {
  const n = m.vars.dimstyle;
  return (n && findDimStyle(m, n)?.name) || dimStyles(m)[0].name;
};


/** styl kóty: ISO-25 ← styl z tabulky ← přepsání u kóty */
export function resolveDimStyle(m: DraftModel, name: string | undefined, overrides?: Partial<DraftDimStyle>): DimStyleVars {
  const st = (name ? findDimStyle(m, name) : undefined) ?? findDimStyle(m, currentDimStyle(m)) ?? dimStyles(m)[0];
  return { ...ISO25, ...clean(st), ...clean(overrides), name: st?.name ?? name ?? ISO25_NAME } as DimStyleVars;
}

// ---------------------------------------------------------------- formát čísel

/**
 * Zaokrouhlení na `dec` desetinných míst „polovina nahoru“ podle zobrazeného desetinného zápisu čísla (nejkratší zápis
 * dvojité přesnosti na 15 platných číslic), ne podle binární hodnoty: 1,005 → 1,01, 2,675 → 2,68, 0,125 → 0,13 (Number.toFixed dává 1,00 / 2,67).
 */
export function roundDec(x: number, dec: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  // 15 platných číslic odstraní šum výpočtu (1,0049999999999999 → 1,005)
  const a = Number(Math.abs(x).toPrecision(15));
  const [mant, ex] = a.toExponential().split("e");
  const shifted = Number(`${mant}e${Number(ex) + dec}`);
  if (!Number.isFinite(shifted) || shifted > 9e15) return x;
  const r = Number(`${Math.round(shifted)}e${-dec}`);
  return x < 0 ? -r : r;
}
/** `toFixed` se zaokrouhlením podle desetinného zápisu (viz roundDec) */
export const toFixedDec = (x: number, dec: number) => roundDec(x, dec).toFixed(dec);

function zeroSuppress(s: string, zin: number, sep: string): string {
  let out = s;
  if (zin & 8 && out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  if (zin & 4) out = out.replace(/^(-?)0\.(?=\d)/, "$1.");
  if (/^-0(\.0*)?$/.test(out)) out = out.slice(1);
  return out.replace(".", sep);
}

/** zlomek s jmenovatelem 2^dec: „2 1/2“ */
function fraction(x: number, dec: number): string {
  const den = 2 ** Math.max(0, Math.min(8, dec));
  const sgn = x < 0 ? "-" : "";
  let w = Math.floor(Math.abs(x));
  let n = Math.round((Math.abs(x) - w) * den);
  if (n === den) (w++, (n = 0));
  if (!n) return `${sgn}${w}`;
  let d = den;
  while (n % 2 === 0 && d > 1) (n /= 2), (d /= 2);
  return `${sgn}${w ? `${w} ` : ""}${n}/${d}`;
}

/** délka podle stylu: DIMLUNIT (1 vědecké, 2 desetinné, 3 inženýrské, 4 architektonické, 5 zlomky), DIMLFAC, DIMRND,
 *  DIMDEC, DIMZIN (4 úvodní, 8 koncové nuly), DIMDSEP */
export function fmtDimLen(v: number, st: DimStyleVars, opts: { dec?: number; zin?: number; lfac?: boolean } = {}): string {
  let x = opts.lfac === false ? v : v * (st.dimlfac || 1);
  if (st.dimrnd > 0) x = roundDec(Math.round(roundDec(x / st.dimrnd, 9)) * st.dimrnd, 12);
  const dec = Math.max(0, Math.min(8, Math.round(opts.dec ?? st.dimdec)));
  const lu = st.dimlunit ?? 2;
  if (lu === 1) return x.toExponential(dec).replace(".", st.dimdsep || ".");
  if (lu === 5) return fraction(x, dec);
  if (lu === 3 || lu === 4) {
    const sgn = x < 0 ? "-" : "";
    const a = Math.abs(x);
    let ft = Math.floor(a / 12 + 1e-12);
    let inch = a - ft * 12;
    if (lu === 4) {
      let fr = fraction(inch, dec);
      if (fr === "12") (ft++, (fr = "0"));
      return `${sgn}${ft}'-${fr}"`;
    }
    let s = toFixedDec(inch, dec);
    if (Number(s) >= 12) (ft++, (inch = 0), (s = (0).toFixed(dec)));
    return `${sgn}${ft}'-${zeroSuppress(s, opts.zin ?? st.dimzin, st.dimdsep || ".")}"`;
  }
  const s = toFixedDec(Math.abs(x) < 0.5 * 10 ** -dec ? 0 : x, dec);
  return zeroSuppress(s, opts.zin ?? st.dimzin, st.dimdsep || ".");
}
/** úhel [°] podle DIMAUNIT (0 desetinné stupně, 1 st/min/s), DIMADEC, DIMAZIN (1 úvodní, 2 koncové nuly) */
export function fmtDimAng(deg: number, st: DimStyleVars): string {
  const dec = Math.max(0, Math.min(8, Math.round(st.dimadec < 0 ? st.dimdec : st.dimadec)));
  if (st.dimaunit === 1) {
    const sgn = deg < 0 ? "-" : "";
    let a = Math.abs(deg);
    let d = Math.floor(a + 1e-9);
    a = (a - d) * 60;
    let mi = Math.floor(a + 1e-9);
    let se = Math.round((a - mi) * 60);
    if (se >= 60) (se -= 60), mi++;
    if (mi >= 60) (mi -= 60), d++;
    return dec <= 0 ? `${sgn}${d}°` : dec <= 2 ? `${sgn}${d}°${mi}'` : `${sgn}${d}°${mi}'${se}"`;
  }
  const s = toFixedDec(Math.abs(deg) < 0.5 * 10 ** -dec ? 0 : deg, dec);
  const zin = (st.dimazin & 2 ? 8 : 0) | (st.dimazin & 1 ? 4 : 0);
  return `${zeroSuppress(s, zin, st.dimdsep || ".")}°`;
}

/** tolerance jako MTEXT (stoh \S nebo ±), výška DIMTFAC (stoh v MTEXT má 70 % výšky) */
function tolText(value: number, st: DimStyleVars, angular: boolean): { main: string; tol: string } {
  const f = (v: number) => (angular ? fmtDimAng(v, st).replace("°", "") : fmtDimLen(v, st, { dec: st.dimtdec, zin: st.dimtzin, lfac: false }));
  const lf = angular ? 1 : st.dimlfac || 1;
  const v = value * lf;
  const hx = (st.dimtfac || 1) / 0.7;
  const H = (s: string) => `{\\H${Math.round(hx * 1e4) / 1e4}x;${s}}`;
  if (st.dimlim) {
    const up = f(v + st.dimtp);
    const lo = f(v - st.dimtm);
    return { main: "", tol: H(`\\S${up}^${lo};`) };
  }
  if (Math.abs(st.dimtp - st.dimtm) < 1e-12) return { main: "", tol: `%%p${f(st.dimtp)}` };
  const sgn = (x: number, pos: boolean) => (Math.abs(x) < 1e-12 ? f(0) : pos ? `+${f(x)}` : `-${f(x)}`);
  return { main: "", tol: H(`\\S${sgn(st.dimtp, true)}^${sgn(st.dimtm, false)};`) };
}

/** naměřená hodnota kóty jako MTEXT (předpona R / Ø, DIMPOST, přepis textu „<>“, tolerance) */
export function dimValueText(e: Pick<DDimension, "kind" | "text">, measured: number, st: DimStyleVars): string {
  const angular = e.kind === "angular" || e.kind === "angular3";
  let base = st.dimlim ? "" : angular ? fmtDimAng(measured, st) : fmtDimLen(measured, st);
  if (st.dimtol || st.dimlim) {
    const t = tolText(measured, st, angular);
    base = st.dimlim ? t.tol : base + t.tol;
  }
  if (!angular) {
    const post = st.dimpost ?? "";
    if (post.includes("<>")) base = post.replace("<>", base);
    else if (post) base += post;
  }
  const prefix = e.kind === "radius" ? "R" : e.kind === "diameter" ? "%%c" : "";
  if (e.text !== undefined && e.text !== "") {
    if (e.text.trim() === "" ) return "";
    return e.text.replace(/<>/g, prefix + base);
  }
  return prefix + base;
}

// ---------------------------------------------------------------- tabulka stylů

/** popis proměnné stylu (panel, příkaz DIMSTYLE, nápověda) */
export type DimVarDef = { key: keyof Omit<DraftDimStyle, "name">; kind: "num" | "int" | "bool" | "str" | "color" | "lw"; label: () => string; min?: number; max?: number };
export const DIM_VARS: DimVarDef[] = [
  { key: "dimscale", kind: "num", label: () => tr("Celkové měřítko (DIMSCALE)"), min: 0 },
  { key: "dimtxt", kind: "num", label: () => tr("Výška textu (DIMTXT)"), min: 0 },
  { key: "dimasz", kind: "num", label: () => tr("Velikost šipky (DIMASZ)"), min: 0 },
  { key: "dimexe", kind: "num", label: () => tr("Přesah vynášecí čáry (DIMEXE)"), min: 0 },
  { key: "dimexo", kind: "num", label: () => tr("Odsazení vynášecí čáry (DIMEXO)"), min: 0 },
  { key: "dimdli", kind: "num", label: () => tr("Rozestup základnicových kót (DIMDLI)"), min: 0 },
  { key: "dimgap", kind: "num", label: () => tr("Mezera textu (DIMGAP, záporná = rámeček)") },
  { key: "dimlunit", kind: "int", label: () => tr("Jednotky délek (DIMLUNIT: 2 desetinné, 5 zlomky, 4 stopy-palce)"), min: 1, max: 6 },
  { key: "dimdec", kind: "int", label: () => tr("Desetinná místa (DIMDEC)"), min: 0, max: 8 },
  { key: "dimdsep", kind: "str", label: () => tr("Desetinný oddělovač (DIMDSEP)") },
  { key: "dimzin", kind: "int", label: () => tr("Potlačení nul (DIMZIN: 4 úvodní, 8 koncové)"), min: 0, max: 15 },
  { key: "dimrnd", kind: "num", label: () => tr("Zaokrouhlení (DIMRND)"), min: 0 },
  { key: "dimlfac", kind: "num", label: () => tr("Měřítko délek (DIMLFAC)") },
  { key: "dimpost", kind: "str", label: () => tr("Předpona / přípona (DIMPOST, <> = hodnota)") },
  { key: "dimadec", kind: "int", label: () => tr("Desetinná místa úhlů (DIMADEC)"), min: 0, max: 8 },
  { key: "dimaunit", kind: "int", label: () => tr("Jednotky úhlů (DIMAUNIT: 0 stupně, 1 st/min/s)"), min: 0, max: 1 },
  { key: "dimazin", kind: "int", label: () => tr("Potlačení nul úhlů (DIMAZIN)"), min: 0, max: 3 },
  { key: "dimtad", kind: "int", label: () => tr("Svislá poloha textu (DIMTAD: 0 na čáře, 1 nad, 4 pod)"), min: 0, max: 4 },
  { key: "dimjust", kind: "int", label: () => tr("Vodorovná poloha textu (DIMJUST: 0 střed, 1 u 1. čáry, 2 u 2. čáry)"), min: 0, max: 4 },
  { key: "dimtih", kind: "bool", label: () => tr("Text uvnitř vodorovně (DIMTIH)") },
  { key: "dimtoh", kind: "bool", label: () => tr("Text vně vodorovně (DIMTOH)") },
  { key: "dimtofl", kind: "bool", label: () => tr("Kótovací čára i při šipkách vně (DIMTOFL)") },
  { key: "dimse1", kind: "bool", label: () => tr("Potlačit 1. vynášecí čáru (DIMSE1)") },
  { key: "dimse2", kind: "bool", label: () => tr("Potlačit 2. vynášecí čáru (DIMSE2)") },
  { key: "dimsd1", kind: "bool", label: () => tr("Potlačit 1. polovinu kótovací čáry (DIMSD1)") },
  { key: "dimsd2", kind: "bool", label: () => tr("Potlačit 2. polovinu kótovací čáry (DIMSD2)") },
  { key: "dimblk", kind: "str", label: () => tr("Šipka (DIMBLK: \"\" plná, _OPEN, _OBLIQUE, _ARCHTICK, _DOT, _NONE…)") },
  { key: "dimblk1", kind: "str", label: () => tr("1. šipka (DIMBLK1)") },
  { key: "dimblk2", kind: "str", label: () => tr("2. šipka (DIMBLK2)") },
  { key: "dimtol", kind: "bool", label: () => tr("Tolerance (DIMTOL)") },
  { key: "dimlim", kind: "bool", label: () => tr("Mezní rozměry (DIMLIM)") },
  { key: "dimtp", kind: "num", label: () => tr("Horní úchylka (DIMTP)") },
  { key: "dimtm", kind: "num", label: () => tr("Dolní úchylka (DIMTM, kladně = minus)") },
  { key: "dimtdec", kind: "int", label: () => tr("Desetinná místa tolerancí (DIMTDEC)"), min: 0, max: 8 },
  { key: "dimtzin", kind: "int", label: () => tr("Potlačení nul tolerancí (DIMTZIN)"), min: 0, max: 15 },
  { key: "dimtfac", kind: "num", label: () => tr("Výška tolerancí × (DIMTFAC)"), min: 0 },
  { key: "dimcen", kind: "num", label: () => tr("Značka středu (DIMCEN, záporná = i osy)") },
  { key: "dimarcsym", kind: "int", label: () => tr("Symbol délky oblouku (DIMARCSYM: 0 před, 1 nad, 2 bez)"), min: 0, max: 2 },
  { key: "dimfxlon", kind: "bool", label: () => tr("Pevná délka vynášecích čar (DIMFXLON)") },
  { key: "dimfxl", kind: "num", label: () => tr("Délka vynášecích čar (DIMFXL)"), min: 0 },
  { key: "dimjogang", kind: "num", label: () => tr("Úhel zalomení (DIMJOGANG)"), min: 5, max: 90 },
  { key: "dimtxsty", kind: "str", label: () => tr("Textový styl (DIMTXSTY)") },
  { key: "dimclrd", kind: "color", label: () => tr("Barva kótovacích čar (DIMCLRD)") },
  { key: "dimclre", kind: "color", label: () => tr("Barva vynášecích čar (DIMCLRE)") },
  { key: "dimclrt", kind: "color", label: () => tr("Barva textu (DIMCLRT)") },
  { key: "dimlwd", kind: "lw", label: () => tr("Tloušťka kótovacích čar (DIMLWD)") },
  { key: "dimlwe", kind: "lw", label: () => tr("Tloušťka vynášecích čar (DIMLWE)") },
  { key: "dimanno", kind: "bool", label: () => tr("Anotativní (měřítko poznámek)") },
];
export const dimVarDef = (k: string) => DIM_VARS.find((d) => d.key === k.toLowerCase().replace(/^\$/, ""));

/** hodnota proměnné stylu ze zadání (chyba = výjimka s důvodem) */
export function parseDimVar(def: DimVarDef, raw: string, m?: DraftModel): unknown {
  const t = raw.trim();
  if (def.kind === "bool") {
    if (/^(1|true|ano|yes|ja|on|zap|ein)$/i.test(t)) return true;
    if (/^(0|false|ne|no|nein|off|vyp|aus)$/i.test(t)) return false;
    throw new Error(tr("{0}: zadejte ano / ne (1 / 0)", def.key.toUpperCase()));
  }
  if (def.kind === "str") {
    if (def.key === "dimpost" || def.key === "dimblk" || def.key === "dimblk1" || def.key === "dimblk2") return raw === '""' ? "" : def.key === "dimpost" ? raw : raw.trim().toUpperCase();
    if (def.key === "dimtxsty" && m) {
      const s = m.textStyles.find((x) => x.name.toLowerCase() === t.toLowerCase());
      if (!s) throw new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", t, m.textStyles.map((x) => x.name).join(", ")));
      return s.name;
    }
    if (def.key === "dimdsep" && t.length !== 1) throw new Error(tr("DIMDSEP: jeden znak (čárka nebo tečka)"));
    return t === '""' ? "" : t;
  }
  if (def.kind === "color") {
    const c = parseColor(t);
    if (c === null) throw new Error(tr("neplatná barva „{0}“ – číslo ACI 1–255, název (červená…), #rrggbb, r,g,b, ByLayer, ByBlock", t));
    return c as DraftColor;
  }
  if (def.kind === "lw") {
    if (/^bylayer$/i.test(t)) return "ByLayer";
    if (/^byblock$/i.test(t)) return "ByBlock";
  }
  const v = evalNumber(t, true);
  if (!Number.isFinite(v)) throw new Error(tr("{0}: očekávám číslo, ne „{1}“", def.key.toUpperCase(), raw));
  if (def.kind === "int" && !Number.isInteger(v)) throw new Error(tr("{0}: očekávám celé číslo", def.key.toUpperCase()));
  if ((def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) throw new Error(tr("{0}: rozsah {1}–{2}", def.key.toUpperCase(), def.min ?? "−∞", def.max ?? "∞"));
  return v;
}

const validName = (n: string) => {
  if (!n.trim() || /[<>/\\":;?*|=`]/.test(n) || n.length > 255) throw new Error(tr("neplatný název stylu „{0}“", n));
  return n.trim();
};
const withStyles = (m: DraftModel, list: DraftDimStyle[], cur?: string): DraftModel => {
  invalidateGeometry();
  return materializeDimStyles({ ...m, dimStyles: list.map((s) => (isFull(s) ? s : fullDimStyle(s))), ...(cur !== undefined ? { vars: { ...m.vars, dimstyle: cur } } : {}) });
};

/** nový kótovací styl (kopie stylu `from`, výchozí aktuální) se změnami */
export function createDimStyle(m: DraftModel, name: string, from?: string, patch: Partial<DraftDimStyle> = {}): DraftModel {
  const n = validName(name);
  if (findDimStyle(m, n)) throw new Error(tr("kótovací styl „{0}“ už existuje", n));
  const src = findDimStyle(m, from ?? currentDimStyle(m));
  if (from && !src) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", from, dimStyles(m).map((s) => s.name).join(", ")));
  return withStyles(m, [...dimStyles(m), { ...fullDimStyle(src ?? iso25Style()), ...clean(patch), name: n }]);
}
/** změní proměnné stylu */
export function modifyDimStyle(m: DraftModel, name: string, patch: Partial<DraftDimStyle>): DraftModel {
  const st = findDimStyle(m, name);
  if (!st) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", name, dimStyles(m).map((s) => s.name).join(", ")));
  const m2 = withStyles(m, dimStyles(m).map((s) => (s === st ? { ...s, ...patch, name: s.name } : s)));
  if (patch.dimanno === undefined) return m2;
  // anotativnost kót se řídí stylem (jako v AutoCADu) – kóty stylu dostanou / ztratí příznak `annotative`
  const n = st.name.toLowerCase();
  const cur = currentDimStyle(m2).toLowerCase();
  return mapDims(m2, (d) => {
    if ((d.style ?? cur).toLowerCase() !== n || !!d.annotative === !!patch.dimanno) return d;
    if (patch.dimanno) return { ...d, annotative: true };
    const { annotative: _a, ...rest } = d;
    void _a;
    return rest;
  });
}
export function renameDimStyle(m: DraftModel, from: string, to: string): DraftModel {
  const st = findDimStyle(m, from);
  if (!st) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", from, dimStyles(m).map((s) => s.name).join(", ")));
  const n = validName(to);
  const ex = findDimStyle(m, n);
  if (ex && ex !== st) throw new Error(tr("kótovací styl „{0}“ už existuje", n));
  const list = dimStyles(m).map((s) => (s === st ? { ...s, name: n } : s));
  const cur = currentDimStyle(m) === st.name ? n : m.vars.dimstyle;
  const re = (x: string | undefined) => (x && x.toLowerCase() === st.name.toLowerCase() ? n : x);
  const m2 = withStyles(m, list, cur);
  return mapDims(m2, (d) => (re(d.style) !== d.style ? { ...d, style: re(d.style) } : d));
}
/** smaže styl – nesmí být aktuální ani použitý (`moveTo` = kóty převést na jiný styl) */
export function deleteDimStyle(m: DraftModel, name: string, moveTo?: string): DraftModel {
  const st = findDimStyle(m, name);
  if (!st) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", name, dimStyles(m).map((s) => s.name).join(", ")));
  if (dimStyles(m).length <= 1) throw new Error(tr("poslední kótovací styl nelze smazat"));
  if (currentDimStyle(m) === st.name) throw new Error(tr("aktuální kótovací styl nelze smazat – nejdřív nastavte jiný"));
  const target = moveTo ? findDimStyle(m, moveTo) : undefined;
  if (moveTo && !target) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", moveTo, dimStyles(m).map((s) => s.name).join(", ")));
  const used = countDims(m, st.name);
  if (used && !target) throw new Error(tr("styl „{0}“ používá {1} kót – zadejte „přesunout-na STYL“", st.name, used));
  const m2 = withStyles(m, dimStyles(m).filter((s) => s !== st));
  return target ? mapDims(m2, (d) => (d.style?.toLowerCase() === st.name.toLowerCase() ? { ...d, style: target.name } : d)) : m2;
}
export function setCurrentDimStyle(m: DraftModel, name: string): DraftModel {
  const st = findDimStyle(m, name);
  if (!st) throw new Error(tr("kótovací styl „{0}“ ve výkresu není – styly: {1}", name, dimStyles(m).map((s) => s.name).join(", ")));
  return materializeDimStyles({ ...m, ...(m.dimStyles?.length ? {} : { dimStyles: dimStyles(m).map((s) => ({ ...s })) }), vars: { ...m.vars, dimstyle: st.name } });
}

function mapDims(m: DraftModel, fn: (d: DDimension) => DDimension): DraftModel {
  const map = (l: DraftModel["entities"]) => {
    let ch = false;
    const out = l.map((e) => {
      if (e.type !== "dimension") return e;
      const n = fn(e as DDimension);
      if (n !== e) ch = true;
      return n;
    });
    return ch ? out : l;
  };
  return { ...m, entities: map(m.entities), ...(m.blocks ? { blocks: m.blocks.map((b) => ({ ...b, entities: map(b.entities) })) } : {}), ...(m.layouts ? { layouts: m.layouts.map((l) => ({ ...l, entities: map(l.entities) })) } : {}) };
}
export function countDims(m: DraftModel, name: string): number {
  const n = name.toLowerCase();
  const cur = currentDimStyle(m).toLowerCase();
  let c = 0;
  const lists = [m.entities, ...(m.blocks ?? []).map((b) => b.entities), ...(m.layouts ?? []).map((l) => l.entities)];
  for (const l of lists) for (const e of l) if (e.type === "dimension" && ((e as DDimension).style ?? cur).toLowerCase() === n) c++;
  return c;
}

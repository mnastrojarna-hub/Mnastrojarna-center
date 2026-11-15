/**
 * Pružiny – registr druhů (výpočet, řádky, výchozí data) a funkce nad dokumentem (stav, tabulky, model pro sestavu).
 */
import { tr } from "../i18n";
import type { CadDoc, Feature, Vec3 } from "../types";
import { calcCompression, compressionDefaults, readCompression } from "./compression";
import { calcDisc, discDefaults, readDisc } from "./disc";
import { calcExtension, extensionDefaults, readExtension } from "./extension";
import { compressionPath, compressionSpec, extensionPieces, piecesPath, torsionPieces, type CoilSpec } from "./path";
import { rowsOf } from "./rows";
import { calcTorsion, readTorsion, torsionDefaults } from "./torsion";
import type { CalcRow, Lang, SpringCalc, SpringData, SpringExt, SpringKind, SpringModel, SpringPath, SpringRow } from "./types";
import { fmt } from "./types";

export type KindDef = {
  kind: SpringKind;
  ext: SpringExt;
  label: () => string;
  standard: string;
  /** slova druhu v příkazu `pružina <druh>` (první = kanonické) */
  words: Record<Lang, string[]>;
  defaults: () => SpringData;
  rows: () => SpringRow[];
  calc: (data: SpringData) => SpringCalc;
};

export const KINDS: Record<SpringKind, KindDef> = {
  compression: { kind: "compression", ext: "spring.compression", label: () => tr("Tlačná pružina"), standard: "EN 13906-1", words: { cs: ["tlačná", "tlacna", "tlačnou", "tlacnou"], en: ["compression"], de: ["druckfeder", "druck"] }, defaults: compressionDefaults, rows: () => rowsOf("compression"), calc: calcCompression },
  extension: { kind: "extension", ext: "spring.extension", label: () => tr("Tažná pružina"), standard: "EN 13906-2", words: { cs: ["tažná", "tazna", "tažnou", "taznou"], en: ["extension", "tension"], de: ["zugfeder", "zug"] }, defaults: extensionDefaults, rows: () => rowsOf("extension"), calc: calcExtension },
  torsion: { kind: "torsion", ext: "spring.torsion", label: () => tr("Zkrutná pružina"), standard: "EN 13906-3", words: { cs: ["zkrutná", "zkrutna", "zkrutnou", "torzní", "torzni"], en: ["torsion"], de: ["drehfeder", "schenkelfeder", "dreh"] }, defaults: torsionDefaults, rows: () => rowsOf("torsion"), calc: calcTorsion },
  disc: { kind: "disc", ext: "spring.disc", label: () => tr("Talířová pružina"), standard: "DIN 2093", words: { cs: ["talířová", "talirova", "talířovou", "talirovou"], en: ["disc", "belleville"], de: ["tellerfeder", "teller"] }, defaults: discDefaults, rows: () => rowsOf("disc"), calc: calcDisc },
};
export const kindOfExt = (ext: string): KindDef | undefined => Object.values(KINDS).find((k) => k.ext === ext);
export const isSpringExt = (ext: string): ext is SpringExt => !!kindOfExt(ext);

/** výpočet pružiny podle id prvku rozšíření (spring.compression …) nebo druhu */
export function springCalc(extOrKind: string, data: SpringData): SpringCalc {
  const k = kindOfExt(extOrKind) ?? KINDS[extOrKind as SpringKind];
  if (!k) throw new Error(tr("Neznámý druh pružiny „{0}“.", extOrKind));
  return k.calc(data);
}

type ExtF = Extract<Feature, { type: "ext" }>;
const isSpringF = (f: Feature): f is ExtF => f.type === "ext" && isSpringExt(f.ext);

/**
 * Jednořádkový souhrn pružiny do stavu dokumentu (zadání + tuhost); "" = prvek není pružina z tabulky. Varování v něm nejsou –
 * řádek stavu je má jednou jako ⚠ ze stavby prvku, spočtené výsledky jsou na řádku „→“ (springResults).
 */
export function springSummary(f: Feature): string {
  if (!isSpringF(f)) return "";
  return springCalc(f.ext, f.data ?? {}).summary;
}

/** Spočtené výsledky pružiny (výsledek prvku ve stromu a řádek „→“ ve stavu) – to, co souhrn neobsahuje. */
export function springResults(c: SpringCalc): string {
  const x = c.v;
  const g = (val: number | undefined, dec = 1) => (val === undefined || !Number.isFinite(val) ? "–" : fmt(val, dec));
  const pc = (a: number | undefined, b: number | undefined) => (a === undefined || !b ? "–" : String(Math.round((a / b) * 100)));
  if (c.kind === "compression")
    return tr("Ln + Sa {0} mm · Fn {1} N · τn {2} % τzul · vzpěr {3} · fe {4} Hz · {5} g", g(x.Lmin, 2), g(x.Fn), pc(x.taun, x.tauzul), x.sK !== undefined && Number.isFinite(x.sK) ? `sK ${fmt(x.sK, 1)} mm` : tr("nevybočí"), g(x.fe, 0), g(x.mass !== undefined ? x.mass * 1000 : undefined));
  if (c.kind === "extension") return tr("Lk {0} mm · největší délka Ln {1} mm · Fn {2} N · {3} g", g(x.Lk, 2), g(x.Ln, 2), g(x.Fn), g(x.mass !== undefined ? x.mass * 1000 : undefined));
  if (c.kind === "torsion") return tr("Lk0 {0} mm · α0 {1}° · největší úhel {2}° · {3} g", g(x.Lk0, 2), g(x.legAngle, 0), g(x.amax, 0), g(x.mass !== undefined ? x.mass * 1000 : undefined));
  return tr("Lc {0} mm · F na dorazu {1} N · {2} g", g(x.Lc, 2), g(x.Fc, 0), g(x.mass !== undefined ? x.mass * 1000 : undefined));
}

export type SpringTable = { featureId: string; name: string; ext: SpringExt; calc: SpringCalc };
/** Pružiny z tabulky v dílu (nepotlačené, pořadí historie). */
export function springTablesOf(doc: CadDoc): SpringTable[] {
  if (doc.kind === "assembly") return [];
  return doc.features.filter((f) => !f.suppressed && isSpringF(f)).map((f) => {
    const e = f as ExtF;
    return { featureId: e.id, name: e.name, ext: e.ext as SpringExt, calc: springCalc(e.ext, e.data ?? {}) };
  });
}

/** Řádky protokolu `pružina tabulka`: název, vstupy, spočtené hodnoty, hlášky. */
export function springTableText(name: string, ext: string, data: SpringData): string[] {
  const k = kindOfExt(ext);
  if (!k) return [];
  const c = k.calc(data);
  const out = [`${tr("Pružina „{0}“", name)} – ${k.label()} (${k.standard}) · ${c.title}`];
  const inputs = k.rows().filter((r) => data[r.key] !== undefined && data[r.key] !== "" && r.kind === "number").map((r) => `${r.symbol ?? r.key} ${fmt(Number(data[r.key]), 3)}${r.unit ? ` ${r.unit}` : ""}`);
  if (inputs.length) out.push(`  ${tr("zadáno")}: ${inputs.join(" · ")}`);
  for (const r of c.rows) out.push(`  ${rowLine(r)}`);
  for (const i of c.issues) out.push(`  ${i.level === "error" ? "✗" : i.level === "warn" ? "⚠" : "ℹ"} ${i.text}`);
  return out;
}
export const rowLine = (r: CalcRow) => `${r.level === "warn" ? "⚠ " : r.level === "error" ? "✗ " : ""}${r.label}: ${r.text}`;

/** Mechanický model pružiny prvku (sestava, dynamika); null = není pružina z tabulky nebo chybí údaje. */
export function springModelOf(f: Feature): SpringModel | null {
  if (!isSpringF(f)) return null;
  return springCalc(f.ext, f.data ?? {}).model;
}

/** Data prvku pro tvar v jiné délce (tlačná: stlačená / protažená pružina v sestavě; výpočet zůstává pro L0). */
export const springDataAt = (data: SpringData, L: number): SpringData => ({ ...data, len: Math.round(L * 1e4) / 1e4 });

/** Tvar závitů tlačné pružiny v délce L (výchozí `data.len`, jinak L0) – null = chybí údaje. */
export function compressionSpecOf(data: SpringData, L?: number): CoilSpec | null {
  const i = readCompression(data);
  if (!(i.d > 0 && i.D > i.d && i.n > 0 && i.L0 > 0)) return null;
  const len = L ?? (typeof data.len === "number" && data.len > 0 ? data.len : i.L0);
  return compressionSpec({ d: i.d, D: i.D, n: i.n, L0: i.L0, ends: i.ends, hand: i.hand, L: len });
}

/**
 * Střednice drátu pružiny v souřadnicích prvku (osa +Z, začátek v počátku) – síť pro přehrávání pohybu, náhled, testy.
 * Tlačná pružina v délce L (výchozí `data.len` / L0); tažná a zkrutná ve volném stavu. Talířová → null (rotační průřez).
 */
export function springPathOf(ext: string, data: SpringData, L?: number, perTurn = 24): SpringPath | null {
  const k = kindOfExt(ext);
  if (!k) return null;
  if (k.kind === "compression") {
    const s = compressionSpecOf(data, L);
    return s ? compressionPath(s, perTurn) : null;
  }
  if (k.kind === "extension") {
    const i = readExtension(data);
    if (!(i.d > 0 && i.D > 2 * i.d && i.n >= 1)) return null;
    return piecesPath(extensionPieces({ d: i.d, D: i.D, turns: i.n, loop: i.loop, loop2: i.loop2, hand: i.hand }));
  }
  if (k.kind === "torsion") {
    const i = readTorsion(data);
    if (!(i.d > 0 && i.D > 2 * i.d && i.n >= 1)) return null;
    return piecesPath(torsionPieces({ d: i.d, D: i.D, turns: i.n, leg1: i.leg1, leg2: i.leg2, l1: i.l1, l2: i.l2, hand: i.hand }));
  }
  return null;
}

/** Talířová pružina – rozměry pro tvar (null = chybí). */
export function discOf(data: SpringData) {
  const i = readDisc(data);
  return i.Di > 0 && i.t > 0 && i.h0 > 0 && i.Di < i.De ? i : null;
}

const AX: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], "-X": [-1, 0, 0], "-Y": [0, -1, 0], "-Z": [0, 0, -1] };
/** Směr osy prvku bez jádra: "X" / "-Z" / {kind:"axis"} / {kind:"vector"} / [x,y,z]; odkaz na geometrii → null. */
export function springAxisOf(data: SpringData): Vec3 | null {
  const a = data.axis;
  const unit = (v: Vec3): Vec3 | null => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null;
  };
  if (a === undefined || a === null || a === "") return [0, 0, 1];
  if (typeof a === "string") return AX[a.toUpperCase()] ?? null;
  if (Array.isArray(a) && a.length >= 3) return unit([Number(a[0]), Number(a[1]), Number(a[2])]);
  const o = a as { kind?: string; axis?: string; v?: Vec3; reverse?: boolean };
  const s = o.reverse ? -1 : 1;
  if (o.kind === "axis" && o.axis) {
    const v = AX[o.axis.toUpperCase()];
    return v ? [v[0] * s, v[1] * s, v[2] * s] : null;
  }
  if (o.kind === "vector" && o.v) {
    const v = unit(o.v);
    return v ? [v[0] * s, v[1] * s, v[2] * s] : null;
  }
  return null;
}

/**
 * Osa a délky pružiny z tabulky v dílu pro sestavu (stejný tvar jako `SpringGeom` v asm-spring-geom.ts): první nepotlačený
 * prvek spring.compression / spring.extension; null = díl takovou pružinu nemá nebo je osa zadaná odkazem na geometrii.
 * `base` = bod na ose v dosedací rovině konce (z = 0 prvku), `length` = délka tvaru (data.len, jinak L0).
 */
export function springPartGeom(doc: CadDoc | undefined): { base: Vec3; axis: Vec3; length: number; free: number; solid?: number; rate?: number; preload?: number; ring: number; featureId: string; ext: SpringExt } | null {
  if (!doc || doc.kind === "assembly") return null;
  const f = doc.features.find((x) => !x.suppressed && x.type === "ext" && (x.ext === "spring.compression" || x.ext === "spring.extension")) as ExtF | undefined;
  if (!f || f.data?.atRef) return null;
  const data = f.data ?? {};
  const axis = springAxisOf(data);
  if (!axis) return null;
  const c = springCalc(f.ext, data);
  if (!c.model) return null;
  const at = Array.isArray(data.at) ? (data.at as number[]).map((x) => Number(x) || 0) : [0, 0, 0];
  const len = typeof data.len === "number" && data.len > 0 ? data.len : c.model.free;
  return { base: [at[0], at[1], at[2]], axis, length: len, free: c.model.free, ...(c.model.solid !== undefined ? { solid: c.model.solid } : {}), rate: c.model.rate, ...(c.model.preload !== undefined ? { preload: c.model.preload } : {}), ring: c.model.D / 2, featureId: f.id, ext: f.ext as SpringExt };
}

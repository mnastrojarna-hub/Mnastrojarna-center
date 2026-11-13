/**
 * Výběr hran / ploch / vrcholů uložený jako indexy topologie – popis polí a otisků (čisté funkce bez jádra, použitelné v UI i ve workeru).
 *
 * Zápis v dokumentu (zpětně kompatibilní): vedle pole indexů leží volitelná mapa „index → otisk“ (`Sig` z refs.ts):
 *  - zaoblení: `edges` + `edgeSigs`, `faces` + `faceSigs`, `faces2` + `faceSigs2` (poloměry `radii`/`radii2` jsou klíčované indexem hrany),
 *  - sražení: `edges` + `edgeSigs`, `vertices` + `vertexSigs`,
 *  - skořepina: `faces` + `faceSigs` (tloušťky `thicknesses` klíčované indexem plochy),
 *  - úkos, vytáhnout/zatlačit, odstranit / odsadit plochu, zesílení: `faces` + `faceSigs`,
 *  - prvky rozšíření: parametr ploch/hran `data[klíč]` + `data[klíč + "Sigs"]`.
 * Klíč mapy je index tak, jak je uložen v poli indexů (řetězec). Otisk popisuje entitu tělesa PŘED prvkem v okamžiku výběru.
 * Mapa místo souběžného pole: přidání nebo odebrání indexu kdekoli v UI nemůže otisky „posunout“ k jiným indexům;
 * index bez otisku (starší dokumenty, ještě neorazítkovaný výběr) se při stavbě použije beze změny – jako dřív.
 */
import { getExt } from "./ext/registry";
import type { Sig } from "./refs";
import type { Feature } from "./types";

export type PickKind = "edge" | "face" | "vertex";
/** otisky vybraných entit: index (jako řetězec) → otisk */
export type SigMap = Record<string, Sig>;
/** pole výběru v prvku: cesta k indexům, cesta k mapě otisků, mapy hodnot klíčované indexem (při přečíslování se překlíčují) */
export type PickField = { kind: PickKind; path: string[]; sigPath: string[]; keyed?: string[][] };

const field = (kind: PickKind, key: string, sigKey: string, keyed: string[] = []): PickField => ({ kind, path: [key], sigPath: [sigKey], keyed: keyed.map((k) => [k]) });

/** Pole výběru indexy, která prvek má (podle typu; u rozšíření podle parametrů ploch/hran a `pick`). */
export function pickFieldsOf(f: Feature): PickField[] {
  switch (f.type) {
    case "fillet":
      return [field("edge", "edges", "edgeSigs", ["radii", "radii2"]), field("face", "faces", "faceSigs"), field("face", "faces2", "faceSigs2")];
    case "chamfer":
      return [field("edge", "edges", "edgeSigs"), field("vertex", "vertices", "vertexSigs")];
    case "shell":
      return [field("face", "faces", "faceSigs", ["thicknesses"])];
    case "draft":
    case "pushPull":
    case "deleteFace":
    case "offsetFace":
    case "thicken":
      return [field("face", "faces", "faceSigs")];
    case "ext": {
      const def = getExt(f.ext);
      if (!def) return [];
      const keys = new Map<string, PickKind>();
      for (const p of def.params ?? []) if (p.kind === "faces" || p.kind === "edges") keys.set(p.key, p.kind === "faces" ? "face" : "edge");
      if (def.pick && !keys.has(def.pick.key)) keys.set(def.pick.key, def.pick.kind === "faces" ? "face" : "edge");
      return [...keys].map(([k, kind]) => ({ kind, path: ["data", k], sigPath: ["data", k + "Sigs"] }));
    }
    default:
      return [];
  }
}

export function getPath(o: unknown, path: string[]): unknown {
  let v = o;
  for (const k of path) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

/** kopie objektu s novou hodnotou na cestě (původní objekt se nemění; `undefined` hodnotu odstraní) */
export function withPath<T>(o: T, path: string[], value: unknown): T {
  const [k, ...rest] = path;
  const src = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...src };
  const v = rest.length ? withPath(src[k], rest, value) : value;
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next as T;
}

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** indexy pole výběru (null = pole není seznam indexů, např. „all“) */
export function pickIndices(f: Feature, fd: PickField): number[] | null {
  const v = getPath(f, fd.path);
  return Array.isArray(v) ? v.filter(isIndex) : null;
}

export function isSig(s: unknown): s is Sig {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return typeof o.t === "string" && Array.isArray(o.c) && o.c.length === 3 && o.c.every((x) => typeof x === "number" && Number.isFinite(x)) && typeof o.s === "number" && Number.isFinite(o.s);
}

/** platné otisky pole výběru (neplatné položky ručně upraveného JSON se ignorují) */
export function pickSigs(f: Feature, fd: PickField): SigMap {
  const v = getPath(f, fd.sigPath);
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: SigMap = {};
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) if (isSig(s)) out[k] = s;
  return out;
}

/** Má prvek u některého vybraného indexu otisk? (bez otisků se stavba chová přesně jako dřív) */
export function hasPickSigs(f: Feature): boolean {
  return pickFieldsOf(f).some((fd) => {
    const idx = pickIndices(f, fd);
    const sigs = pickSigs(f, fd);
    return !!idx?.some((i) => sigs[String(i)]);
  });
}

/** Má prvek vybrané indexy (něco k orazítkování / znovunalezení)? */
export function hasPicks(f: Feature): boolean {
  return pickFieldsOf(f).some((fd) => !!pickIndices(f, fd)?.length);
}

/** Klíč výběru prvku: indexy, otisky a mapy klíčované indexem (pro zjištění, že se výběr mezitím nezměnil). */
export function picksKey(f: Feature): string {
  return JSON.stringify(pickFieldsOf(f).map((fd) => [getPath(f, fd.path) ?? null, getPath(f, fd.sigPath) ?? null, ...(fd.keyed ?? []).map((p) => getPath(f, p) ?? null)]));
}

/** Přenese výběr (indexy, otisky, mapy klíčované indexem) z `from` do `cur` – ostatní parametry `cur` zůstanou. */
export function mergePicks(cur: Feature, from: Feature): Feature {
  let out = cur;
  for (const fd of pickFieldsOf(cur)) for (const p of [fd.path, fd.sigPath, ...(fd.keyed ?? [])]) out = withPath(out, p, getPath(from, p));
  return out;
}

/** Mapa klíčovaná indexem po přečíslování (staré → nové indexy); nové klíče mají přednost před nezměněnými. */
export function rekey<T>(map: Record<string, T> | undefined, remap: Map<number, number>): Record<string, T> | undefined {
  if (!map || !remap.size) return map;
  const out: Record<string, T> = {};
  const moved = new Set([...remap.keys()].map(String));
  for (const [k, v] of Object.entries(map)) if (!moved.has(k)) out[k] = v;
  for (const [a, b] of remap) if (map[String(a)] !== undefined) out[String(b)] = map[String(a)];
  return out;
}

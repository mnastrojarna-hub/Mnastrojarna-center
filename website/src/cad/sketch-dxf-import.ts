/**
 * Import DXF do otevřené skici (Skica › Import DXF…): entity souboru (formats/dxf.ts) s volbou jednotek, posunu počátku
 * a filtrem hladin. Výsledek se přidá k entitám skici jedním krokem historie (Ctrl+Z vrátí celý import).
 */
import { parseDXF } from "./formats/dxf";
import { cadLocale, tr } from "./i18n";
import { arcGeom } from "./sketch";
import { uid, type SketchEntity, type Vec2 } from "./types";

/** Jednotky souboru: „file“ = podle $INSUNITS (bez údaje = mm), jinak vynucené. */
export type DxfUnit = "file" | "mm" | "cm" | "m" | "in";
export const DXF_UNIT_MM: Record<Exclude<DxfUnit, "file">, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };
/** Názvy jednotek podle kódu $INSUNITS. */
const INSUNITS_NAME: Record<number, string> = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 8: "µin", 9: "mil", 10: "yd", 13: "µm", 14: "dm" };

export type DxfSketchOptions = {
  unit?: DxfUnit;
  /** posun přidaných entit [mm skici] (po případném přesunu levého dolního rohu do počátku) */
  offset?: Vec2;
  /** levý dolní roh obálky importu do počátku skici */
  toOrigin?: boolean;
  /** hladiny, které se importují (bez zadání všechny) */
  layers?: readonly string[];
};

export type DxfSketchImport = {
  /** entity k přidání do skici (nová id) */
  entities: SketchEntity[];
  /** entit v souboru (před filtrem hladin) */
  total: number;
  /** přeskočené typy (TEXT, INSERT, DIMENSION…) */
  skipped: Record<string, number>;
  /** hladiny souboru s počtem entit */
  layers: { name: string; count: number }[];
  /** jednotky ze souboru („mm“, „in“…) nebo null = soubor je neuvádí */
  fileUnit: string | null;
  /** měřítko soubor → mm skici */
  scale: number;
  /** obálka přidaných entit v mm skici */
  bbox: [Vec2, Vec2] | null;
};

const mapPts = (e: SketchEntity, f: (p: Vec2) => Vec2, k: number): SketchEntity => {
  switch (e.type) {
    case "line":
      return { ...e, id: uid(), a: f(e.a), b: f(e.b) };
    case "circle": {
      const [cx, cy] = f([e.cx, e.cy]);
      return { ...e, id: uid(), cx, cy, r: e.r * k };
    }
    case "arc":
      return { ...e, id: uid(), a: f(e.a), b: f(e.b), c: f(e.c) };
    case "polyline":
      return { ...e, id: uid(), points: e.points.map(f) };
    default:
      return { ...e, id: uid() };
  }
};

/** rozměr v mm na 2 desetinná místa v jazyce aplikace („17,07“) – souhrn v dialogu i hlášení po importu; −0 = 0 */
export const fmtMm = (n: number) => (Math.round(n * 100) / 100 || 0).toLocaleString(cadLocale());

/** obálka entit (kružnice s poloměrem, oblouk se svými krajními body ve 0°/90°/180°/270°, které leží na oblouku) */
export function entitiesBbox(list: SketchEntity[]): [Vec2, Vec2] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r);
    y0 = Math.min(y0, y - r);
    x1 = Math.max(x1, x + r);
    y1 = Math.max(y1, y + r);
  };
  for (const e of list) {
    if (e.type === "line") [e.a, e.b].forEach((p) => add(p[0], p[1]));
    else if (e.type === "circle") add(e.cx, e.cy, e.r);
    else if (e.type === "arc") {
      [e.a, e.b, e.c].forEach((p) => add(p[0], p[1]));
      const g = arcGeom(e.a, e.b, e.c); // CCW: a0 → a0 + sweep
      if (g)
        for (let q = 0; q < 4; q++) {
          const t = (q * Math.PI) / 2;
          const d = (((t - g.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          if (d <= g.sweep + 1e-12) add(g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t));
        }
    }
    else if (e.type === "polyline") e.points.forEach((p) => add(p[0], p[1]));
  }
  return Number.isFinite(x0) ? [[x0, y0], [x1, y1]] : null;
}

/** Entity DXF pro otevřenou skicu podle voleb (jednotky, hladiny, posun). Chyba = soubor není čitelné DXF. */
export function dxfForSketch(text: string, o: DxfSketchOptions = {}): DxfSketchImport {
  const res = parseDXF(text);
  const counts = new Map<string, number>();
  res.layers.forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1));
  const fileUnit = res.units ? (INSUNITS_NAME[res.units] ?? `#${res.units}`) : null;
  const unit = o.unit ?? "file";
  const scale = unit === "file" ? res.unitScale : DXF_UNIT_MM[unit];
  const k = scale / (res.unitScale || 1); // parseDXF už převedl podle souboru – vynucené jednotky jen přepočítají
  const allow = o.layers ? new Set(o.layers) : null;
  const picked = res.entities.filter((_, i) => !allow || allow.has(res.layers[i] ?? "0"));
  let out = picked.map((e) => mapPts(e, (p) => [p[0] * k, p[1] * k], k));
  const box = entitiesBbox(out);
  const dx = (o.offset?.[0] ?? 0) - (o.toOrigin && box ? box[0][0] : 0);
  const dy = (o.offset?.[1] ?? 0) - (o.toOrigin && box ? box[0][1] : 0);
  if (dx || dy) out = out.map((e) => mapPts(e, (p) => [p[0] + dx, p[1] + dy], 1));
  return {
    entities: out,
    total: res.entities.length,
    skipped: res.skipped,
    layers: [...counts.entries()].map(([name, count]) => ({ name, count })),
    fileUnit,
    scale,
    bbox: entitiesBbox(out),
  };
}

/** Hlášení po importu: kolik entit přibylo, z kolika hladin, co se přeskočilo. */
export function dxfImportMessage(fileName: string, r: DxfSketchImport, layersUsed: number): string {
  const skipped = Object.entries(r.skipped).map(([t, n]) => `${t} ×${n}`);
  const size = r.bbox ? ` · ${fmtMm(r.bbox[1][0] - r.bbox[0][0])} × ${fmtMm(r.bbox[1][1] - r.bbox[0][1])} mm` : "";
  return (
    tr("Do skici přidáno entit: {0} z „{1}“ (hladiny: {2}){3}.", r.entities.length, fileName, layersUsed, size) +
    (skipped.length ? " " + tr("Přeskočeno: {0}.", skipped.join(", ")) : "") +
    " " +
    tr("Ctrl+Z import vrátí.")
  );
}

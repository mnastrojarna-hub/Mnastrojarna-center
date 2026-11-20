/**
 * Tabulka ozubení na výkrese dílu (vlna 19, balík text) – „výkres tabulka ozubení ano“ / přepínač „Tabulka ozubení“.
 *
 * Data jsou čistá (`gearTablesOf(doc)` z `@/cad/gears`, žádné jádro): worker je doplní do `DrawingMeta.gears`, když je volba
 * `gearTable` zapnutá. Tabulka se kreslí stejnými čarami a texty jako tabulka děr (SVG, PDF, DXF i DWG bez další práce) a
 * skládá se nad razítko: razítko → kusovník → tabulka děr → tabulka ozubení. Šířka jedné tabulky 110 mm (zarovnaná vpravo
 * s razítkem), sloupce název 62 | značka 14 | hodnota 34; víc kol v dílu = tabulky vedle sebe doleva, nejvýš dvě (třetí a
 * další = varování). Umístění se odchyluje od ISO 1340 (pravý horní roh) – ten drží tabulka revizí.
 */
import { tr } from "./i18n";
import type { DText, Poly } from "./drawing";
import type { GearTable } from "./gears/data";
import type { GearDataRow } from "./gears/types";

/** výška řádku tabulky [mm listu] (jako tabulka děr) */
export const GEAR_ROW = 5.5;
/** šířka jedné tabulky a sloupců [mm] */
export const GEAR_TABLE_W = 110;
const COLS = [62, 14, 34] as const;
/** nejvýš tolik tabulek vedle sebe */
export const GEAR_TABLES_MAX = 2;

/** řádek tabulky na listu: popis, značka, hodnota s jednotkou */
export type GearSheetRow = { label: string; symbol: string; value: string };

/** hodnota s jednotkou (° bez mezery) */
const withUnit = (r: GearDataRow) => (r.unit ? (r.unit === "°" ? `${r.value}°` : `${r.value} ${r.unit}`) : r.value);

/**
 * Řádky tabulky na listu: údaje ozubení bez pomocných řádků (počet měřených zubů k a průměr kuličky D_M se připíšou
 * k rozměru přes zuby / přes kuličky; rozteč a stoupání šroubovice válcových kol se na list nepíšou – jdou z modulu).
 */
export function gearSheetRows(t: Pick<GearTable, "ext" | "rows">): GearSheetRow[] {
  const by = new Map(t.rows.map((r) => [r.key, r]));
  const cyl = ["gear.spur", "gear.helical", "gear.herringbone", "gear.internal"].includes(t.ext);
  const skip = new Set(["k", "dM", ...(cyl ? ["p", "pz"] : [])]);
  const out: GearSheetRow[] = [];
  for (const r of t.rows) {
    if (skip.has(r.key)) continue;
    let label = r.label;
    if (r.key === "Wk" && by.get("k")) label = tr("{0} (k = {1})", r.label, by.get("k")!.value);
    if (r.key === "MdK" && by.get("dM")) label = tr("{0} (D_M {1})", r.label, withUnit(by.get("dM")!));
    // smysl stoupání ke sklonu: „15,000° pravý“
    if (r.key === "hand" && by.get("beta")) continue;
    let value = withUnit(r);
    if (r.key === "beta" && by.get("hand")) value = `${value} ${by.get("hand")!.value}`;
    out.push({ label, symbol: r.symbol ?? "", value });
  }
  return out;
}

/** tabulky, které se na list vejdou (první dvě) */
const drawn = (tables: GearTable[]) => tables.slice(0, GEAR_TABLES_MAX);

/** výška pásu tabulek ozubení nad ostatními tabulkami [mm] (0 = žádná) – nejvyšší z kreslených tabulek + mezera 4 mm */
export function gearTableHeight(tables: GearTable[]): number {
  const t = drawn(tables);
  return t.length ? Math.max(...t.map((x) => (gearSheetRows(x).length + 1) * GEAR_ROW)) + 4 : 0;
}
/** šířka pásu tabulek [mm] */
export const gearTableWidth = (tables: GearTable[]): number => drawn(tables).length * GEAR_TABLE_W;

/**
 * Nakreslí tabulky ozubení: pravý okraj `xRight`, spodní hrana pásu `yBottom` (horní hrana tabulky děr / kusovníku /
 * razítka). První kolo vpravo, další vlevo od něj. Vrací obdélník pásu a hlášení pro kolo navíc.
 */
export function drawGearTables(xRight: number, yBottom: number, tables: GearTable[], polys: Poly[], texts: DText[]): { x: number; y: number; w: number; h: number; warnings: string[] } {
  const list = drawn(tables);
  const h = gearTableHeight(list) - 4;
  const y0 = yBottom - 4 - h;
  list.forEach((t, k) => {
    const rows = gearSheetRows(t);
    const x0 = xRight - (k + 1) * GEAR_TABLE_W;
    const th = (rows.length + 1) * GEAR_ROW;
    // tabulka sedí na spodní hraně pásu (kratší tabulka vedle delší nemá nad sebou prázdný rámeček)
    const ty = y0 + h - th;
    polys.push({ layer: "frame", width: 0.7, pts: [[x0, ty], [x0 + GEAR_TABLE_W, ty], [x0 + GEAR_TABLE_W, ty + th], [x0, ty + th], [x0, ty]] });
    for (let i = 1; i <= rows.length; i++) polys.push({ layer: "title", width: i === 1 ? 0.5 : undefined, pts: [[x0, ty + i * GEAR_ROW], [x0 + GEAR_TABLE_W, ty + i * GEAR_ROW]] });
    const c1 = x0 + COLS[0];
    const c2 = c1 + COLS[1];
    polys.push({ layer: "title", pts: [[c1, ty + GEAR_ROW], [c1, ty + th]] }, { layer: "title", pts: [[c2, ty + GEAR_ROW], [c2, ty + th]] });
    // hlavička: název kola (zkrácený, aby se vešel)
    const head = tr("Tabulka ozubení – {0}", t.name);
    texts.push({ x: x0 + 1.5, y: ty + GEAR_ROW - 1.6, s: head.length > 62 ? `${head.slice(0, 61)}…` : head, size: 2.6, bold: true, anchor: "start", layer: "text" });
    rows.forEach((r, i) => {
      const yb = ty + (i + 2) * GEAR_ROW - 1.6;
      const label = r.label.length > 40 ? `${r.label.slice(0, 39)}…` : r.label;
      texts.push({ x: x0 + 1.5, y: yb, s: label, size: 2.5, anchor: "start", layer: "text" }, { x: c1 + COLS[1] / 2, y: yb, s: r.symbol, size: 2.5, anchor: "middle", layer: "text" }, { x: c2 + COLS[2] - 1.5, y: yb, s: r.value, size: 2.5, anchor: "end", layer: "text" });
    });
  });
  const warnings = tables.length > GEAR_TABLES_MAX ? [tr("Tabulka ozubení: v dílu je {0} kol, na list se vejdou tabulky prvních {1} – další vypište příkazem kolo tabulka vše.", tables.length, GEAR_TABLES_MAX)] : [];
  return { x: xRight - list.length * GEAR_TABLE_W, y: y0, w: list.length * GEAR_TABLE_W, h, warnings };
}

/** řádky `výkres stav`: jedna na kolo („Tabulka ozubení: Ozubené kolo m2 z24 – mₙ 2 mm, z 24, W3 (k = 3) 15,433 mm …“) */
export function gearTableStatus(tables: GearTable[]): string[] {
  return drawn(tables).map((t) => {
    const rows = gearSheetRows(t);
    const pick = rows.filter((r) => r.symbol).slice(0, 8);
    return tr("Tabulka ozubení: {0} – {1}", t.name, pick.map((r) => `${r.symbol} ${r.value}`).join(", "));
  });
}

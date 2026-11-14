/**
 * Souřadnicové kóty (ISO 129-1 – kótování od společné základny souřadnicemi, „ordinate dimensioning“) pro desky s mnoha
 * dírami (vlna 15, B12): od počátku (levý dolní roh obrysu pohledu) se ke každé poloze kreslí jen vynášecí čára a na jejím
 * konci hodnota (vzdálenost od počátku), počátek nese „0“. Hodnoty polohy x stojí v řadě pod / nad pohledem (text svisle,
 * čitelný zprava), polohy y v řadě vlevo / vpravo (text vodorovně). Blízké hodnoty se rozestoupí zalomením vynášecí čáry
 * (`jog` = posun textu podél řady v mm listu).
 *
 * Kóta je obyčejná délková kóta (`kind` horizontal / vertical, `a` = počátek, `b` = bod, `offset` jako u délkové kóty)
 * s příznakem `ord` – hodnota, popisek, tolerance a hledání kóty (výkres tolerance 57,4 …) fungují beze změny. Geometrii
 * kreslí `annotationGeometry` (cad/drawing.ts) i rozmístění Chytrých kót (cad/drawing-dims-layout.ts) touto funkcí.
 */
import type { DText } from "./drawing";
import type { Vec2 } from "./types";

export type OrdSeg = [Vec2, Vec2];
const SIZE = 3.5;
/** rozestup textů v řadě [mm listu] (výška písma + mezera) */
export const ORD_PITCH = 4.4;
/** délka zalomení vynášecí čáry před řadou [mm listu] */
const KNEE = 3;

/**
 * Geometrie souřadnicové kóty na listu: `B` = bod (mm listu), `dir` "h" = poloha x (řada je vodorovná přímka y = `row`),
 * "v" = poloha y (řada je svislá přímka x = `row`), `jog` = posun textu podél řady, `label` = popisek.
 */
export function ordinateGeom(B: Vec2, dir: "h" | "v", row: number, jog: number, label: string): { segs: OrdSeg[]; text: DText } {
  const along = dir === "h" ? 0 : 1; // souřadnice podél řady
  const across = 1 - along; // souřadnice ke řadě
  const sgn = Math.sign(row - B[across]) || 1; // směr od bodu k řadě
  const at = (a: number, c: number): Vec2 => (along === 0 ? [a, c] : [c, a]);
  const start = at(B[along], B[across] + sgn * 1); // mezera 1 mm od bodu
  const end = at(B[along] + jog, row);
  const segs: OrdSeg[] = [];
  if (Math.abs(jog) < 0.05 || Math.abs(row - B[across]) < KNEE + 1.5) segs.push([start, at(B[along] + (Math.abs(jog) < 0.05 ? 0 : jog), row)]);
  else {
    const knee = at(B[along], row - sgn * KNEE);
    segs.push([start, knee], [knee, end]);
  }
  // text na konci vynášecí čáry, 1 mm za řadou, osou na čáře
  const t = row + sgn * 1;
  const text: DText =
    dir === "h"
      ? { x: end[0] + 0.26 * SIZE, y: t, s: label, size: SIZE, anchor: sgn > 0 ? "end" : "start", rotate: -90, layer: "dim" }
      : { x: t, y: end[1] + 0.26 * SIZE, s: label, size: SIZE, anchor: sgn > 0 ? "start" : "end", layer: "dim" };
  return { segs, text };
}

/**
 * Rozestoupí polohy textů podél řady, aby byly od sebe aspoň `pitch` (shluky se vystředí na své body) – vrátí posuny
 * (`jog`) ve stejném pořadí jako `xs`.
 */
export function spreadOrdinates(xs: number[], pitch = ORD_PITCH): number[] {
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  // shluky: sousední body blíž než pitch se rozloží rovnoměrně kolem středu shluku; shluky, které se po rozložení
  // dotknou, se sloučí (opakuje se, dokud se nic nemění)
  type Cl = { items: { x: number; i: number }[]; c: number };
  let cls: Cl[] = order.map((o) => ({ items: [o], c: o.x }));
  const lo = (k: Cl) => k.c - ((k.items.length - 1) * pitch) / 2;
  const hi = (k: Cl) => k.c + ((k.items.length - 1) * pitch) / 2;
  for (let changed = true; changed; ) {
    changed = false;
    const out: Cl[] = [];
    for (const k of cls) {
      const p = out[out.length - 1];
      if (p && lo(k) < hi(p) + pitch - 1e-9) {
        const items = [...p.items, ...k.items];
        out[out.length - 1] = { items, c: items.reduce((a, o) => a + o.x, 0) / items.length };
        changed = true;
      } else out.push(k);
    }
    cls = out;
  }
  const jog = new Array<number>(xs.length).fill(0);
  for (const k of cls) k.items.forEach((o, j) => (jog[o.i] = lo(k) + j * pitch - o.x));
  return jog;
}

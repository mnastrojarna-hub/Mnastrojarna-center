/**
 * Vlna 22, bod 7 – po importu zůstávaly neaktuální odvozené parametry pružiny (repro: Deska A o 10 mm níž, `spring.length` 25 ponecháno
 * → `stav` „25 mm ✓“, kolize pružina × deska 445,6 mm³). Řídí polohy komponent a dosedací plochy; délka je odvozená: rozpor se zjistí
 * (`springDrift`), ohlásí (uložená × z ploch) a opraví; řádek `stav` řekne, zda je délka z ploch, v rozporu, nebo nezkontrolovaná.
 */
import { afterEach, describe, expect, it } from "vitest";
import { springDrift, springDriftBetween, springDriftText, springStatusLine, withSprings } from "./asm-spring";
import { setLang } from "./i18n";
import { compressionSpring } from "./library/pins";
import type { FaceGeo, GeoProvider } from "./mates";
import { emptyDoc, type CadDoc, type MateRef, type Placement, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

const P = (position: Vec3 = [0, 0, 0]): Placement => ({ position, rotation: [0, 0, 0] });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const G: Record<string, Record<string, FaceGeo>> = {
  A: { f0: { kind: "plane", origin: [50, 50, 0], normal: [0, 0, -1] } },
  H: { f0: { kind: "plane", origin: [30, 30, 8], normal: [0, 0, 1] } },
};
const geo: GeoProvider = (r) => G[r.compId]?.[`f${r.face}`] ?? null;
/** Deska A na Z `az`, přidržovač na 34,5 (horní plocha 42,5), pružina mezi nimi s uloženou délkou `stored` */
function doc(az: number, stored: number | undefined): CadDoc {
  const spring = compressionSpring.make({ d: 2, D: 18, L: 32, n: 6 }) as CadDoc;
  return {
    ...emptyDoc("Mechanika"),
    kind: "assembly",
    components: [
      { id: "A", name: "Deska A", source: { kind: "part", doc: emptyDoc("A") }, placement: P([0, 0, az]) },
      { id: "H", name: "Přidržovač", source: { kind: "part", doc: emptyDoc("H") }, placement: P([20, 20, 34.5]) },
      { id: "S", name: "Pružina", source: { kind: "part", doc: spring }, placement: P([50, 50, 43.5]), spring: { a: f("H", 0), b: f("A", 0), free: 32, solid: 14, rate: 20, ...(stored !== undefined ? { length: stored, offset: 0, seat: stored } : {}) } },
    ],
  };
}

describe("bod 7 – délka pružiny odvozená z dosedacích ploch", () => {
  it("externě posunutá deska (67,5 → 57,5), uložená délka 25: rozpor 25 × 15 mm, oprava na 15 mm", () => {
    const d = doc(57.5, 25);
    const drift = springDrift(d, geo);
    expect(drift).toEqual([{ id: "S", name: "Pružina", stored: 25, derived: 15, seat: 15, offset: 0 }]);
    expect(springDriftText(drift[0])).toBe("pružina „Pružina“: uložená délka 25 mm neodpovídá dosedacím plochám (15 mm) – délka odvozena z ploch; řídí polohy komponent, uložená délka je jen odvozená hodnota");
    const fixed = withSprings(d, geo);
    expect(fixed.components![2].spring).toMatchObject({ length: 15, seat: 15 });
    expect(springDriftBetween(d, fixed)).toHaveLength(1);
    expect(springDrift(fixed, geo)).toEqual([]);
  });

  it("souhlasná délka (deska na 67,5, uloženo 25) a pružina bez uložené délky rozpor nemají", () => {
    expect(springDrift(doc(67.5, 25), geo)).toEqual([]);
    expect(springDrift(doc(57.5, undefined), geo)).toEqual([]);
  });

  it("řádek stavu: bez kontroly dosavadní tvar; ověřeno = „délka odvozená z ploch“; rozpor = ⚠ s oběma délkami; nezkontrolováno = bez ✓", () => {
    const d = doc(57.5, 25);
    const base = "Pružiny: „Pružina“ 25 mm (L0 32 · Ln 14) · F 140 N ✓";
    expect(springStatusLine(d)).toBe(base); // dosavadní tvar (bez kontroly ploch) – hlídá ho i asm-w15
    expect(springStatusLine(d, { checked: true, stale: springDrift(d, geo) })).toBe(`${base} – ⚠ pružina „Pružina“: uložená délka 25 mm neodpovídá dosedacím plochám (15 mm) – délka odvozena z ploch; řídí polohy komponent, uložená délka je jen odvozená hodnota`);
    const ok = withSprings(d, geo);
    expect(springStatusLine(ok, { checked: true, stale: [] })).toBe("Pružiny: „Pružina“ 15 mm (L0 32 · Ln 14) · F 340 N ✓ – délka odvozená z dosedacích ploch (řídí polohy komponent)");
    const unchecked = springStatusLine(d, { checked: false, stale: [] })!;
    expect(unchecked).not.toContain("✓");
    expect(unchecked).toMatch(/– uložená délka, s dosedacími plochami nezkontrolováno$/);
  });

  it("EN / DE: věta rozporu přeložená, čísla s tečkou v EN", () => {
    const dr = springDrift(doc(57.5, 25), geo)[0];
    setLang("en");
    expect(springDriftText(dr)).toMatch(/^spring “Pružina”: stored length 25 mm does not match the seat faces \(15 mm\)/);
    setLang("de");
    expect(springDriftText(dr)).toMatch(/^Feder „Pružina“: gespeicherte Länge 25 mm passt nicht zu den Auflageflächen \(15 mm\)/);
  });
});

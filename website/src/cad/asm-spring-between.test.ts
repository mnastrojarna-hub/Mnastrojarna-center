/**
 * Pružina mezi díly (cad/asm-spring-between.ts) – čisté funkce:
 * - tabulka EN 13906-1: R = G·d⁴ / (8·D³·n), nt = n + 2, Ln = nt·d – ruční výpočet pro DIN 2095 2 × 20 × 44, n = 8 (G 81 500 N/mm²):
 *   D = 18, D³ = 5 832, R = 81 500·16 / (8·5 832·8) = 1 304 000 / 373 248 = 3,4937 N/mm, Ln = 10·2 = 20 mm,
 *   síla v montážní délce 38 mm: F = 3,4937·(44 − 38) = 20,96 N;
 * - předvyplnění z díry Ø21 a vzdálenosti 35 mm: De 19,5 (vůle 5 %), d 2, L0 41 (předpětí 15 %), n 7,5;
 * - díl pružiny: prvek Pružina se stoupáním (L0 − d)/n → délka modelu = L0;
 * - díry vzoru: stejný Ø, rovnoběžná osa, stejná délka a hloubka na stejném dílu (6 kapes stírače, ne díra Ø10 ani jiná hloubka).
 */
import { describe, expect, it } from "vitest";
import type { CompFaceRow } from "./agent-asm";
import { patternHoles, springDefaults, springLite, springPartDoc } from "./asm-spring-between";
import { springGeom } from "./asm-spring-geom";

describe("pružina mezi díly – tabulka a díry vzoru", () => {
  it("EN 13906-1: tuhost, závity, délka na doraz, hlášky", () => {
    const c = springLite({ d: 2, De: 20, L0: 44, n: 8 }, 38);
    expect(c.D).toBe(18);
    expect(c.R).toBeCloseTo(3.4937, 4);
    expect(c.nt).toBe(10);
    expect(c.Ln).toBe(20);
    expect(c.R * (44 - 38)).toBeCloseTo(20.96, 2);
    expect(c.issues).toEqual([]);
    // nerez 1.4310 (G 70 000): R úměrně menší
    expect(springLite({ d: 2, De: 20, L0: 44, n: 8, material: "1.4310" }).R).toBeCloseTo((3.4937 * 70000) / 81500, 4);
    // montáž pod Ln a nedosednutí
    expect(springLite({ d: 2, De: 20, L0: 44, n: 8 }, 18).issues.join()).toMatch(/pod délkou na doraz Ln 20/);
    expect(springLite({ d: 2, De: 20, L0: 44, n: 8 }, 50).issues.join()).toMatch(/nedosedá/);
    expect(springLite({ d: 3, De: 6, L0: 44, n: 8 }).issues.join()).toMatch(/poměr vinutí D\/d = 1/);
  });

  it("předvyplnění podle díry a vzdálenosti dosedacích ploch", () => {
    expect(springDefaults(35, 21)).toEqual({ d: 2, De: 19.5, L0: 41, n: 7.5, material: "SH" });
    // rovina–rovina (bez díry): De 20, L0 ≥ vzdálenost + 2·d
    const s = springDefaults(10);
    expect(s.De).toBe(20);
    expect(s.L0).toBeGreaterThanOrEqual(14);
  });

  it("díl pružiny: tlačná pružina z tabulky (spring.compression) v prohlížeči i v CLI, délka modelu L0, osa Z od počátku", () => {
    // integrace vlny 21: jeden prvek nezávisle na tom, zda je rozšíření zaregistrované (dřív v CLI starý prvek Pružina)
    const doc = springPartDoc({ d: 2, De: 19.5, L0: 41, n: 7.5 }, "Pružina 2×19,5×41");
    const f = doc.features[0];
    expect(f.type).toBe("ext");
    if (f.type !== "ext") return;
    expect(f.ext).toBe("spring.compression");
    expect(f.data).toMatchObject({ d: 2, De: 19.5, L0: 41, n: 7.5, ends: "ground", material: "SH" });
    const g = springGeom(doc)!;
    expect(g.length).toBeCloseTo(41, 9);
    expect(g.solid).toBeCloseTo(19, 9);
    expect(g.ring).toBeCloseTo(8.75, 9);
    expect(g.base).toEqual([0, 0, 0]);
    expect(g.axis).toEqual([0, 0, 1]);
    // nerez: materiál drátu v datech, materiál dílu nerez (hustota, kusovník)
    expect(springPartDoc({ d: 2, De: 19.5, L0: 41, n: 7.5, material: "1.4310" }, "N").material).toBe("nerez");
  });

  it("díry vzoru: 6 kapes Ø21 stejné hloubky, bez díry Ø10, jiné hloubky a jiného dílu", () => {
    const cyl = (face: number, x: number, y: number, r = 10.5, length = 10, leafId = "U", z = 5): CompFaceRow => ({ face, kind: "cylinder", origin: [x, y, z], normal: [0, 0, 1], radius: r, length, leafId });
    const rows: CompFaceRow[] = [cyl(1, 40, 30), cyl(2, 100, 30), cyl(3, 160, 30), cyl(4, 40, 90), cyl(5, 100, 90), cyl(6, 160, 90), cyl(7, 70, 60, 5), cyl(8, 130, 60, 10.5, 20), cyl(9, 10, 10, 10.5, 10, "X"), { face: 10, kind: "plane", origin: [0, 0, 0], normal: [0, 0, -1], leafId: "U" }];
    const list = patternHoles(rows, rows[0]);
    expect(list.map((r) => r.face)).toEqual([1, 4, 2, 5, 3, 6]);
    // osa opačným směrem (díra zrcadlená) je stále ve vzoru, polovina rozdělené válcové plochy se nepočítá dvakrát
    expect(patternHoles([...rows, { ...cyl(11, 40, 30), normal: [0, 0, -1] }], rows[0]).length).toBe(6);
  });
});
